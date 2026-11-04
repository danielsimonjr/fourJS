import { FourError } from "@fourjs/core";

import { registerBoundedImageDecoder } from "./image-memory.js";
import type { ImageDimensions } from "./image-probe.js";
import {
  DEFAULT_MAXIMUM_DECODED_BYTES,
  DEFAULT_MAXIMUM_EXPANSION_RATIO,
  type DecodedTexels,
  type TexelDecodeLike,
} from "./texture.js";
import { limitWasmMemory } from "./wasm-memory.js";
import { DEFAULT_IMAGE_WORKING_BYTES } from "./bounded-png.js";

/** Shared option shape of the WebP and AVIF bounded decoders. */
export interface BoundedRawCodecOptions {
  /** Application-pinned codec Wasm exposing the raw ABI (see below). */
  readonly wasmBinary: Uint8Array;
  /** Linear heap ceiling, including input, scratch and native output. Default 128 MiB. */
  readonly maximumWorkingBytes?: number;
  /** RGBA8 output ceiling; default 64 MiB. Must be a positive safe integer. */
  readonly maximumDecodedBytes?: number;
  /** Output bytes per encoded byte; default 1000. Must be positive and finite. */
  readonly maximumExpansionRatio?: number;
}

/**
 * Raw C-style ABI required of the pinned binary (no JS glue, no imports):
 * `memory`; `malloc(length) -> ptr`; `free(ptr, length)`;
 * `decode(ptr, length, infoPtr) -> outPtr` where the codec writes little-endian
 * u32 width and height at `infoPtr` / `infoPtr + 4` and returns a pointer to
 * width*height*4 RGBA8 bytes (0 on failure). The host copies, then frees.
 */
interface RawExports {
  readonly memory: WebAssembly.Memory;
  readonly malloc: (length: number) => number;
  readonly free: (pointer: number, length: number) => void;
  readonly decode: (pointer: number, length: number, info: number) => number;
}

export interface RawCodecSpec {
  readonly label: string;
  readonly loader: string;
  readonly pin: string;
  readonly probe: (data: ArrayBuffer) => ImageDimensions | undefined;
}

/** Internal factory shared by the WebP and AVIF bounded decoders. */
export async function createBoundedRawDecoder(
  spec: RawCodecSpec,
  options: BoundedRawCodecOptions,
): Promise<TexelDecodeLike> {
  const { label } = spec;
  const refuse = (message: string, cause?: unknown): FourError =>
    new FourError("UNTRUSTED_INPUT_REJECTED", message, {
      context: { loader: spec.loader },
      cause,
    });
  const working = options.maximumWorkingBytes ?? DEFAULT_IMAGE_WORKING_BYTES;
  const decoded = options.maximumDecodedBytes ?? DEFAULT_MAXIMUM_DECODED_BYTES;
  const ratio =
    options.maximumExpansionRatio ?? DEFAULT_MAXIMUM_EXPANSION_RATIO;
  if (
    !Number.isSafeInteger(decoded) ||
    decoded < 1 ||
    !Number.isFinite(ratio) ||
    ratio <= 0
  ) {
    throw new RangeError(
      `${label} decoded-byte and expansion limits must be finite and positive.`,
    );
  }
  const binary = limitWasmMemory(options.wasmBinary, working);
  let native: RawExports;
  let poisoned = false;

  const checkOutput = (
    width: number,
    height: number,
    encodedLength: number,
  ): number => {
    const length = width * height * 4;
    if (
      !Number.isSafeInteger(width) ||
      width < 1 ||
      !Number.isSafeInteger(height) ||
      height < 1 ||
      !Number.isSafeInteger(length) ||
      length > decoded ||
      length / encodedLength > ratio
    ) {
      throw refuse(
        `${label} dimensions or decoded-byte/expansion budget were exceeded.`,
      );
    }
    return length;
  };

  try {
    const module = await WebAssembly.compile(binary);
    if (WebAssembly.Module.imports(module).length > 0) {
      throw refuse(
        `Unsupported ${label} codec imports; the raw ABI takes none (${spec.pin}).`,
      );
    }
    const instance = await WebAssembly.instantiate(module, {});
    const exports = instance.exports;
    if (
      !(exports.memory instanceof WebAssembly.Memory) ||
      typeof exports.malloc !== "function" ||
      typeof exports.free !== "function" ||
      typeof exports.decode !== "function"
    ) {
      throw refuse(
        `Unsupported ${label} codec exports; use a binary built for the raw ABI (${spec.pin}).`,
      );
    }
    native = exports as unknown as RawExports;
  } catch (cause) {
    throw refuse(`Unable to initialize the bounded ${label} codec.`, cause);
  }

  const decode: TexelDecodeLike = (encoded) => {
    if (poisoned)
      throw refuse(
        `${label} decoder failed previously; construct a fresh bounded decoder.`,
      );
    const claimed = spec.probe(encoded);
    if (claimed === undefined) {
      throw refuse(`Expected a ${label} header with readable dimensions.`);
    }
    const encodedLength = encoded.byteLength;
    if (encodedLength < 1) throw refuse(`${label} input is empty.`);
    const expected = checkOutput(claimed.width, claimed.height, encodedLength);
    if (encodedLength > working)
      throw refuse(
        `${label} input cannot fit the codec working-memory budget.`,
      );
    try {
      const inPtr = native.malloc(encodedLength) >>> 0;
      let heap = native.memory.buffer;
      if (
        inPtr === 0 ||
        inPtr > heap.byteLength ||
        encodedLength > heap.byteLength - inPtr
      ) {
        throw refuse(
          `${label} input allocation failed inside the bounded codec.`,
        );
      }
      new Uint8Array(heap, inPtr, encodedLength).set(new Uint8Array(encoded));
      const infoPtr = native.malloc(8) >>> 0;
      heap = native.memory.buffer;
      if (infoPtr === 0 || infoPtr > heap.byteLength - 8) {
        throw refuse(
          `${label} info allocation failed inside the bounded codec.`,
        );
      }
      const outPtr = native.decode(inPtr, encodedLength, infoPtr) >>> 0;
      heap = native.memory.buffer;
      const view = new DataView(heap);
      const width = view.getUint32(infoPtr, true);
      const height = view.getUint32(infoPtr + 4, true);
      if (
        outPtr === 0 ||
        width !== claimed.width ||
        height !== claimed.height ||
        outPtr > heap.byteLength ||
        expected > heap.byteLength - outPtr
      ) {
        throw refuse(
          `${label} output does not match its header or fit its bounded heap.`,
        );
      }
      const data = new Uint8Array(heap, outPtr, expected).slice();
      native.free(outPtr, expected);
      native.free(infoPtr, 8);
      native.free(inPtr, encodedLength);
      const result: DecodedTexels = { width, height, data };
      return result;
    } catch (cause) {
      poisoned = true;
      throw refuse(
        `Invalid ${label} or exhausted decoder working-memory budget.`,
        cause,
      );
    }
  };
  return registerBoundedImageDecoder(decode, working);
}
