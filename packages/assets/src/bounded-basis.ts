/**
 * Bounded Basis Universal transcoder (§77, §96; R-30c). Mirrors the wave-4
 * raw codecs (`bounded-raw-codec.ts`): application-supplied Wasm bytes, heap
 * cap pinned by `limitWasmMemory` before any codec code runs, a container
 * preflight ({@link parseKtx2}) before any allocation, finite output limits,
 * and fail-closed poisoning after a trap. No dependency, no glue, no network.
 *
 * ## Raw transcoder ABI (no imports)
 *
 * Exports `memory`; `malloc(length) -> ptr`; `free(ptr, length)`; and
 * `transcode(ptr, length, target, infoPtr) -> outPtr` where `ptr/length` is the
 * whole KTX2 file and `target` is {@link BASIS_TARGET_CODES}
 * (0 rgba8, 1 bc7, 2 etc2-rgba8, 3 astc-4x4). The transcoder writes
 * little-endian u32 `width`, `height`, `levelCount` at `infoPtr`, then
 * `levelCount` u32 level byte lengths (at most 16 levels; the host allocates
 * 12 + 4 * 16 bytes for `info`), and returns a pointer to the levels
 * concatenated, level 0 first (0 on failure). The host verifies every length
 * against the block arithmetic, copies, then frees. Supercompression other
 * than none/BasisLZ (zstd, zlib) is refused: the transcoder owns BasisLZ.
 *
 * Output is deterministic (§33): same bytes, same target, same result.
 */
import { FourError } from "@fourjs/core";

import { DEFAULT_IMAGE_WORKING_BYTES } from "./bounded-png.js";
import { registerBoundedImageDecoder } from "./image-memory.js";
import { parseKtx2 } from "./ktx2.js";
import { DEFAULT_MAXIMUM_DECODED_BYTES } from "./texture.js";
import { limitWasmMemory } from "./wasm-memory.js";

export { DEFAULT_IMAGE_WORKING_BYTES } from "./bounded-png.js";

/** Texel formats the transcoder can emit (the render package's `TextureFormat`). */
export type BasisTextureFormat =
  "rgba8unorm" | "bc7-rgba-unorm" | "etc2-rgba8unorm" | "astc-4x4-unorm";

/** `target` argument values of the raw `transcode` export. */
export const BASIS_TARGET_CODES: Readonly<Record<BasisTextureFormat, number>> =
  Object.freeze({
    rgba8unorm: 0,
    "bc7-rgba-unorm": 1,
    "etc2-rgba8unorm": 2,
    "astc-4x4-unorm": 3,
  });

/** Default preference when several compressed formats are supported. */
const PREFERENCE: readonly BasisTextureFormat[] = [
  "bc7-rgba-unorm",
  "astc-4x4-unorm",
  "etc2-rgba8unorm",
];

const MAX_OUTPUT_LEVELS = 16;

export interface BoundedBasisTranscoderOptions {
  /** Application-pinned Basis transcoder Wasm exposing the raw ABI. */
  readonly wasmBinary: Uint8Array;
  /** Linear heap ceiling, including input and output. Default 128 MiB. */
  readonly maximumWorkingBytes?: number;
  /** Transcoded output ceiling (all levels); default 64 MiB. */
  readonly maximumDecodedBytes?: number;
}

export interface BasisTranscodeRequest {
  /**
   * Compressed formats the device supports (e.g. the renderer's
   * `capabilities.compressedTextureFormats` mapped to engine names). Empty or
   * absent selects the uncompressed `"rgba8unorm"` fallback.
   */
  readonly supportedFormats?: readonly BasisTextureFormat[];
}

/** Structurally a `@fourjs/render` `TextureSource`. */
export interface BasisTextureSource {
  readonly width: number;
  readonly height: number;
  readonly format: BasisTextureFormat;
  readonly colorSpace: "srgb" | "linear";
  /** Compressed mip chain, level 0 first (compressed formats only). */
  readonly levels?: readonly Uint8Array[];
  /** RGBA8 level 0 (fallback only). */
  readonly data?: Uint8Array;
  /** Fallback only: ask the backend to build the chain. */
  readonly mipmaps?: boolean;
}

export type BasisTranscoder = (
  ktx2: ArrayBuffer,
  request?: BasisTranscodeRequest,
) => BasisTextureSource;

interface RawExports {
  readonly memory: WebAssembly.Memory;
  readonly malloc: (length: number) => number;
  readonly free: (pointer: number, length: number) => void;
  readonly transcode: (
    pointer: number,
    length: number,
    target: number,
    info: number,
  ) => number;
}

const refuse = (message: string, cause?: unknown): FourError =>
  new FourError("UNTRUSTED_INPUT_REJECTED", message, {
    context: { loader: "bounded-basis" },
    cause,
  });

function levelBytes(
  format: BasisTextureFormat,
  width: number,
  height: number,
): number {
  return format === "rgba8unorm"
    ? width * height * 4
    : Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
}

/** Creates a KTX2 (ETC1S/UASTC) -> GPU-texture-source transcoder. */
export async function createBoundedBasisTranscoder(
  options: BoundedBasisTranscoderOptions,
): Promise<BasisTranscoder> {
  const working = options.maximumWorkingBytes ?? DEFAULT_IMAGE_WORKING_BYTES;
  const decoded = options.maximumDecodedBytes ?? DEFAULT_MAXIMUM_DECODED_BYTES;
  if (!Number.isSafeInteger(decoded) || decoded < 1) {
    throw new RangeError(
      "Basis maximumDecodedBytes must be a positive safe integer.",
    );
  }
  const binary = limitWasmMemory(options.wasmBinary, working);
  let native: RawExports;
  let poisoned = false;
  try {
    const module = await WebAssembly.compile(binary);
    if (WebAssembly.Module.imports(module).length > 0) {
      throw refuse(
        "Unsupported Basis transcoder imports; the raw ABI takes none.",
      );
    }
    const exports = (await WebAssembly.instantiate(module, {})).exports;
    if (
      !(exports.memory instanceof WebAssembly.Memory) ||
      typeof exports.malloc !== "function" ||
      typeof exports.free !== "function" ||
      typeof exports.transcode !== "function"
    ) {
      throw refuse(
        "Unsupported Basis transcoder exports; use a binary built for the raw ABI.",
      );
    }
    native = exports as unknown as RawExports;
  } catch (cause) {
    throw refuse("Unable to initialize the bounded Basis transcoder.", cause);
  }

  const transcode: BasisTranscoder = (ktx2, request) => {
    if (poisoned) {
      throw refuse(
        "Basis transcoder failed previously; construct a fresh one.",
      );
    }
    const info = parseKtx2(ktx2, { maximumWorkingBytes: working });
    if (info.dfd?.basis === undefined || info.vkFormat !== 0) {
      throw refuse("KTX2 is not a Basis Universal (ETC1S/UASTC) texture.");
    }
    if (
      info.supercompression !== "none" &&
      info.supercompression !== "basislz"
    ) {
      throw refuse(
        `KTX2 supercompression ${info.supercompression} is not supported by the raw ABI.`,
      );
    }
    if (
      info.depth !== 0 ||
      info.layerCount > 1 ||
      info.faceCount !== 1 ||
      info.height < 1
    ) {
      throw refuse("Only 2D, single-layer Basis textures are supported.");
    }
    const supported = request?.supportedFormats ?? [];
    const format: BasisTextureFormat =
      PREFERENCE.find((one) => supported.includes(one)) ?? "rgba8unorm";
    const levelCount = info.levels.length;
    if (levelCount > MAX_OUTPUT_LEVELS) {
      throw refuse("Basis texture has too many mip levels.");
    }
    const expected: number[] = [];
    let expectedTotal = 0;
    for (let i = 0; i < levelCount; i++) {
      const bytes = levelBytes(
        format,
        Math.max(1, info.width >> i),
        Math.max(1, info.height >> i),
      );
      expected.push(bytes);
      expectedTotal += bytes;
    }
    if (!Number.isSafeInteger(expectedTotal) || expectedTotal > decoded) {
      throw refuse("Basis decoded-byte budget was exceeded.");
    }
    const inputLength = ktx2.byteLength;
    if (inputLength + expectedTotal > working) {
      throw refuse(
        "Basis texture cannot fit the transcoder working-memory budget.",
      );
    }
    const infoBytes = 12 + 4 * MAX_OUTPUT_LEVELS;
    try {
      const inPtr = native.malloc(inputLength) >>> 0;
      let heap = native.memory.buffer;
      if (
        inPtr === 0 ||
        inPtr > heap.byteLength ||
        inputLength > heap.byteLength - inPtr
      ) {
        throw refuse(
          "Basis input allocation failed inside the bounded transcoder.",
        );
      }
      new Uint8Array(heap, inPtr, inputLength).set(new Uint8Array(ktx2));
      const infoPtr = native.malloc(infoBytes) >>> 0;
      heap = native.memory.buffer;
      if (infoPtr === 0 || infoPtr > heap.byteLength - infoBytes) {
        throw refuse(
          "Basis info allocation failed inside the bounded transcoder.",
        );
      }
      const outPtr =
        native.transcode(
          inPtr,
          inputLength,
          BASIS_TARGET_CODES[format],
          infoPtr,
        ) >>> 0;
      heap = native.memory.buffer;
      const view = new DataView(heap);
      let valid =
        outPtr !== 0 &&
        outPtr <= heap.byteLength &&
        expectedTotal <= heap.byteLength - outPtr &&
        view.getUint32(infoPtr, true) === info.width &&
        view.getUint32(infoPtr + 4, true) === info.height &&
        view.getUint32(infoPtr + 8, true) === levelCount;
      for (let i = 0; valid && i < levelCount; i++) {
        valid = view.getUint32(infoPtr + 12 + 4 * i, true) === expected[i];
      }
      if (!valid) {
        throw refuse(
          "Basis output does not match its header or fit its bounded heap.",
        );
      }
      const levels: Uint8Array[] = [];
      let at = outPtr;
      for (const length of expected) {
        levels.push(new Uint8Array(heap, at, length).slice());
        at += length;
      }
      native.free(outPtr, expectedTotal);
      native.free(infoPtr, infoBytes);
      native.free(inPtr, inputLength);
      const colorSpace = info.dfd.transferFunction === 2 ? "srgb" : "linear";
      const base = {
        width: info.width,
        height: info.height,
        format,
        colorSpace,
      } as const;
      return Object.freeze(
        format === "rgba8unorm"
          ? { ...base, data: levels[0], mipmaps: levelCount > 1 }
          : { ...base, levels: Object.freeze(levels) },
      );
    } catch (cause) {
      poisoned = true;
      if (cause instanceof FourError) throw cause;
      throw refuse(
        "Invalid Basis texture or exhausted transcoder working-memory budget.",
        cause,
      );
    }
  };
  return registerBoundedImageDecoder(transcode, working);
}
