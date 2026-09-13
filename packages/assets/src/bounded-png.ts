import { FourError } from "@fourjs/core";

import { registerBoundedImageDecoder } from "./image-memory.js";
import {
  DEFAULT_MAXIMUM_DECODED_BYTES,
  DEFAULT_MAXIMUM_EXPANSION_RATIO,
  type DecodedTexels,
  type TexelDecodeLike,
} from "./texture.js";
import { limitWasmMemory } from "./wasm-memory.js";

/** Default ceiling for the PNG codec's entire linear heap: 128 MiB. */
export const DEFAULT_IMAGE_WORKING_BYTES = 134_217_728;

/** Options for the isolated, runtime-capped PNG codec (§96). */
export interface BoundedPngDecoderOptions {
  /**
   * Application-pinned `squoosh_png_bg.wasm` from `@jsquash/png@3.1.1`.
   * Supply trusted executable bytes, never a module selected by an asset.
   * The adapter owns instantiation; do not initialize jSquash's singleton glue.
   */
  readonly wasmBinary: Uint8Array;
  /** Linear heap ceiling, including input, scratch and native output. Default 128 MiB. */
  readonly maximumWorkingBytes?: number;
  /** RGBA8 output ceiling; default 64 MiB. Must be a positive safe integer. */
  readonly maximumDecodedBytes?: number;
  /** Output bytes per encoded byte; default 1000. Must be positive and finite. */
  readonly maximumExpansionRatio?: number;
}

interface PngExports {
  readonly memory: WebAssembly.Memory;
  readonly decode: (pointer: number, length: number) => number;
  readonly __wbindgen_malloc: (length: number, alignment: number) => number;
  readonly __wbindgen_free: (
    pointer: number,
    length: number,
    alignment: number,
  ) => void;
}

function refuse(message: string, cause?: unknown): FourError {
  return new FourError("UNTRUSTED_INPUT_REJECTED", message, {
    context: { loader: "bounded-png" },
    cause,
  });
}

let crcTable: Uint32Array | undefined;

/** Validate framing and checksums: the pinned codec does not check every CRC. */
function validateChunks(bytes: Uint8Array, view: DataView): void {
  if (crcTable === undefined) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
      }
      crcTable[index] = value;
    }
  }
  let offset = 8;
  let sawData = false;
  let endedData = false;
  let sawPalette = false;
  while (offset <= bytes.length - 12) {
    const length = view.getUint32(offset);
    if (length > bytes.length - offset - 12)
      throw refuse("Truncated PNG chunk.");
    const kind = view.getUint32(offset + 4);
    const end = offset + 8 + length;
    let crc = 0xffffffff;
    for (let index = offset + 4; index < end; index += 1) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[index]) & 255];
    }
    if ((crc ^ 0xffffffff) >>> 0 !== view.getUint32(end)) {
      throw refuse("PNG chunk checksum mismatch.");
    }
    for (let index = offset + 4; index < offset + 8; index += 1) {
      const letter = bytes[index];
      if (!(
        (letter >= 65 && letter <= 90) ||
        (letter >= 97 && letter <= 122)
      )) {
        throw refuse("Invalid PNG chunk name.");
      }
    }
    if (bytes[offset + 6] & 32) throw refuse("Invalid PNG reserved chunk bit.");
    if (kind === 0x49484452) {
      // IHDR
      if (offset !== 8 || length !== 13)
        throw refuse("Duplicate or invalid PNG header.");
    } else if (kind === 0x504c5445) {
      // PLTE
      if (
        sawPalette ||
        sawData ||
        length === 0 ||
        length > 768 ||
        length % 3 !== 0
      ) {
        throw refuse("Invalid PNG palette chunk.");
      }
      sawPalette = true;
    } else if (kind === 0x49444154) {
      // IDAT
      if (endedData) throw refuse("PNG data chunks must be consecutive.");
      sawData = true;
    } else if (kind === 0x49454e44) {
      // IEND
      if (!sawData || length !== 0 || end + 4 !== bytes.length) {
        throw refuse("PNG must end with an empty IEND after its image data.");
      }
      return;
    } else {
      if (kind === 0x6163544c || kind === 0x6663544c || kind === 0x66644154) {
        throw refuse(
          "Animated PNG requires a separate bounded animation decoder.",
        );
      }
      if ((bytes[offset + 4] & 32) === 0)
        throw refuse("Unsupported critical PNG chunk.");
    }
    if (sawData && kind !== 0x49444154) endedData = true;
    offset = end + 4;
  }
  throw refuse("PNG is missing a complete IEND chunk.");
}

/**
 * Creates a PNG → RGBA8 decoder whose Wasm memory maximum is set BEFORE any
 * codec code runs. `memory.grow` cannot exceed the ceiling, even during parsing
 * or decompression. No native browser decoder, DOM object, fetch, or executable
 * JavaScript glue is used. The six imports implement the pinned codec's small
 * wasm-bindgen ABI; they cannot allocate unbounded output on the host.
 *
 * This caps one decoder's linear heap, not browser/process RSS, compiler memory,
 * the caller's encoded buffer, or retained decoded assets. The host RGBA copy is
 * independently bounded before allocation. Texture row flipping may retain a
 * second output-sized buffer. Reuse this function to reuse one bounded heap;
 * decoding is synchronous once the async factory resolves. Use a worker when
 * decode-time preemption is also needed.
 *
 * A codec failure poisons the instance: construct a fresh decoder to recover.
 * Header/budget refusals before codec execution do not poison it. This avoids
 * reusing allocator state after a Wasm trap or exception crossing its stack.
 */
export async function createBoundedPngDecoder(
  options: BoundedPngDecoderOptions,
): Promise<TexelDecodeLike> {
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
      "PNG decoded-byte and expansion limits must be finite and positive.",
    );
  }
  // Snapshot/validate and cap the binary before compilation or instantiation.
  const binary = limitWasmMemory(options.wasmBinary, working);
  let native: PngExports;
  let output: DecodedTexels | undefined;
  let expectedWidth = 0;
  let expectedHeight = 0;
  let encodedLength = 0;
  let poisoned = false;

  const checkOutput = (width: number, height: number, length: number): void => {
    if (
      !Number.isSafeInteger(width) ||
      width < 1 ||
      !Number.isSafeInteger(height) ||
      height < 1 ||
      !Number.isSafeInteger(length) ||
      length !== width * height * 4 ||
      length > decoded ||
      length / encodedLength > ratio
    ) {
      throw refuse(
        "PNG dimensions or decoded-byte/expansion budget were exceeded.",
      );
    }
  };
  const unavailable = (): never => {
    throw refuse(
      "The bounded PNG adapter supports the pinned RGBA8 decode ABI only.",
    );
  };
  const imports = {
    wbg: {
      // Used by the codec's RGBA16 view API, which this adapter does not expose.
      __wbindgen_memory: unavailable,
      __wbg_buffer_a448f833075b71ba: unavailable,
      __wbg_newwithbyteoffsetandlength_099217381c451830: unavailable,
      __wbindgen_object_drop_ref: (_handle: number): void => {},
      __wbindgen_throw: unavailable,
      __wbg_newwithownedu8clampedarrayandsh_91db5987993a08fb: (
        pointer: number,
        length: number,
        width: number,
        height: number,
      ): number => {
        pointer >>>= 0;
        length >>>= 0;
        width >>>= 0;
        height >>>= 0;
        checkOutput(width, height, length);
        const heap = native.memory.buffer;
        if (
          output !== undefined ||
          width !== expectedWidth ||
          height !== expectedHeight ||
          pointer > heap.byteLength ||
          length > heap.byteLength - pointer
        ) {
          throw refuse(
            "PNG output does not match its header or fit its bounded heap.",
          );
        }
        // Validate BEFORE the only output-sized host allocation. The result
        // owns its buffer; later decodes and memory growth cannot change it.
        const data = new Uint8Array(heap, pointer, length).slice();
        native.__wbindgen_free(pointer, length, 1);
        output = { width, height, data };
        return 132; // wasm-bindgen's first non-reserved object handle.
      },
    },
  };

  try {
    const module = await WebAssembly.compile(binary);
    for (const entry of WebAssembly.Module.imports(module)) {
      if (
        entry.module !== "wbg" ||
        entry.kind !== "function" ||
        !Object.hasOwn(imports.wbg, entry.name)
      ) {
        throw refuse(
          "Unsupported PNG codec imports; use the pinned jSquash 3.1.1 binary.",
        );
      }
    }
    const instance = await WebAssembly.instantiate(module, imports);
    const exports = instance.exports;
    if (
      !(exports.memory instanceof WebAssembly.Memory) ||
      typeof exports.decode !== "function" ||
      typeof exports.__wbindgen_malloc !== "function" ||
      typeof exports.__wbindgen_free !== "function"
    ) {
      throw refuse(
        "Unsupported PNG codec exports; use the pinned jSquash 3.1.1 binary.",
      );
    }
    native = exports as unknown as PngExports;
  } catch (cause) {
    throw refuse("Unable to initialize the bounded PNG codec.", cause);
  }

  const decode: TexelDecodeLike = (encoded) => {
    if (poisoned)
      throw refuse(
        "PNG decoder failed previously; construct a fresh bounded decoder.",
      );
    const bytes = new Uint8Array(encoded);
    // IHDR is mandatory and first. Refuse size claims before scanning chunks.
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (
      bytes.length < 33 ||
      signature.some((value, index) => bytes[index] !== value)
    ) {
      throw refuse("Expected a complete PNG signature and IHDR header.");
    }
    const view = new DataView(encoded);
    if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) {
      throw refuse("PNG must begin with a 13-byte IHDR chunk.");
    }
    expectedWidth = view.getUint32(16);
    expectedHeight = view.getUint32(20);
    encodedLength = encoded.byteLength;
    checkOutput(
      expectedWidth,
      expectedHeight,
      expectedWidth * expectedHeight * 4,
    );
    if (encodedLength > working)
      throw refuse("PNG input cannot fit the codec working-memory budget.");
    validateChunks(bytes, view);
    output = undefined;
    try {
      const pointer = native.__wbindgen_malloc(encodedLength, 1) >>> 0;
      const heap = native.memory.buffer;
      if (
        pointer === 0 ||
        pointer > heap.byteLength ||
        encodedLength > heap.byteLength - pointer
      ) {
        throw refuse("PNG input allocation failed inside the bounded codec.");
      }
      new Uint8Array(heap, pointer, encodedLength).set(bytes);
      // The pinned Rust entry point takes ownership of the input allocation.
      const handle = native.decode(pointer, encodedLength);
      const result = output as DecodedTexels | undefined;
      if (handle !== 132 || result === undefined)
        throw refuse("PNG codec did not return RGBA8 pixels.");
      return result;
    } catch (cause) {
      poisoned = true;
      throw refuse(
        "Invalid PNG or exhausted decoder working-memory budget.",
        cause,
      );
    } finally {
      // The caller alone owns a successful output; do not retain an asset.
      output = undefined;
    }
  };
  return registerBoundedImageDecoder(decode, working);
}
