import { FourError } from "@fourjs/core";

import { registerBoundedImageDecoder } from "./image-memory.js";
import { probeJpeg } from "./image-probe.js";
import {
  DEFAULT_MAXIMUM_DECODED_BYTES,
  DEFAULT_MAXIMUM_EXPANSION_RATIO,
  type DecodedTexels,
  type TexelDecodeLike,
} from "./texture.js";
import { limitWasmMemory } from "./wasm-memory.js";
import { DEFAULT_IMAGE_WORKING_BYTES } from "./bounded-png.js";

export { DEFAULT_IMAGE_WORKING_BYTES };

/** Options for the isolated, runtime-capped JPEG codec (§96). */
export interface BoundedJpegDecoderOptions {
  /**
   * Application-pinned `squoosh_jpg_bg.wasm` from `@jsquash/jpeg@1.6.0`.
   * Supply trusted executable bytes, never a module selected by an asset.
   */
  readonly wasmBinary: Uint8Array;
  /** Linear heap ceiling, including input, scratch and native output. Default 128 MiB. */
  readonly maximumWorkingBytes?: number;
  /** RGBA8 output ceiling; default 64 MiB. Must be a positive safe integer. */
  readonly maximumDecodedBytes?: number;
  /** Output bytes per encoded byte; default 1000. Must be positive and finite. */
  readonly maximumExpansionRatio?: number;
}

interface JpegExports {
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
    context: { loader: "bounded-jpeg" },
    cause,
  });
}

/**
 * Creates a JPEG → RGBA8 decoder whose Wasm memory maximum is set BEFORE any
 * codec code runs. Same contract as {@link createBoundedPngDecoder}: the host
 * RGBA copy is independently bounded, a codec failure poisons the instance,
 * and header/budget refusals before codec execution do not.
 *
 * Pin `@jsquash/jpeg@1.6.0`'s wasm. Native `createImageBitmap` cannot satisfy
 * `maximumWorkingBytes`.
 */
export async function createBoundedJpegDecoder(
  options: BoundedJpegDecoderOptions,
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
      "JPEG decoded-byte and expansion limits must be finite and positive.",
    );
  }
  const binary = limitWasmMemory(options.wasmBinary, working);
  let native: JpegExports;
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
        "JPEG dimensions or decoded-byte/expansion budget were exceeded.",
      );
    }
  };
  const unavailable = (): never => {
    throw refuse(
      "The bounded JPEG adapter supports the pinned RGBA8 decode ABI only.",
    );
  };
  const imports = {
    wbg: {
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
            "JPEG output does not match its header or fit its bounded heap.",
          );
        }
        const data = new Uint8Array(heap, pointer, length).slice();
        native.__wbindgen_free(pointer, length, 1);
        output = { width, height, data };
        return 132;
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
          "Unsupported JPEG codec imports; use the pinned jSquash 1.6.0 binary.",
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
        "Unsupported JPEG codec exports; use the pinned jSquash 1.6.0 binary.",
      );
    }
    native = exports as unknown as JpegExports;
  } catch (cause) {
    throw refuse("Unable to initialize the bounded JPEG codec.", cause);
  }

  const decode: TexelDecodeLike = (encoded) => {
    if (poisoned)
      throw refuse(
        "JPEG decoder failed previously; construct a fresh bounded decoder.",
      );
    const claimed = probeJpeg(encoded);
    if (claimed === undefined) {
      throw refuse("Expected a JPEG Start Of Image and SOF dimensions.");
    }
    expectedWidth = claimed.width;
    expectedHeight = claimed.height;
    encodedLength = encoded.byteLength;
    checkOutput(
      expectedWidth,
      expectedHeight,
      expectedWidth * expectedHeight * 4,
    );
    if (encodedLength > working)
      throw refuse("JPEG input cannot fit the codec working-memory budget.");
    output = undefined;
    try {
      const pointer = native.__wbindgen_malloc(encodedLength, 1) >>> 0;
      const heap = native.memory.buffer;
      if (
        pointer === 0 ||
        pointer > heap.byteLength ||
        encodedLength > heap.byteLength - pointer
      ) {
        throw refuse("JPEG input allocation failed inside the bounded codec.");
      }
      new Uint8Array(heap, pointer, encodedLength).set(new Uint8Array(encoded));
      const handle = native.decode(pointer, encodedLength);
      const result = output as DecodedTexels | undefined;
      if (handle !== 132 || result === undefined)
        throw refuse("JPEG codec did not return RGBA8 pixels.");
      return result;
    } catch (cause) {
      poisoned = true;
      throw refuse(
        "Invalid JPEG or exhausted decoder working-memory budget.",
        cause,
      );
    } finally {
      output = undefined;
    }
  };
  return registerBoundedImageDecoder(decode, working);
}
