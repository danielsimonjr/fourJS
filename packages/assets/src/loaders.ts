/**
 * The built-in loaders (§76) — text, JSON, binary, image.
 *
 * ```ts
 * const config = await assets.load("/config.json", jsonLoader);
 * const shader = await assets.load("/shaders/basic.frag", textLoader);
 * const bytes  = await assets.load("/data/heights.bin", binaryLoader);
 *
 * // Browser: adapt the platform decoder once, at the edge.
 * const imageLoader = createImageLoader((data) =>
 *   createImageBitmap(new Blob([data])),
 * );
 * const icon = await assets.load("/images/icon.png", imageLoader);
 * ```
 *
 * A loader is a plain value (see `AssetLoader`), so an application's format
 * support is exactly what it imports. The three body loaders are module-level
 * singletons, which is what makes `load(url, jsonLoader)` from two call sites
 * hit one cache slot — cache identity is loader *object* identity.
 *
 * ## Why `createImageLoader` is a factory
 *
 * Image decoding is the one built-in that needs a platform API. `@fourjs/assets`
 * must build and unit-test under plain `lib.es2022` in Node, so this module
 * never names `createImageBitmap`, `Blob`, or `ImageBitmap`: it declares the
 * shapes it needs ({@link ImageDecodeLike}, {@link ImageBitmapLike}) and takes
 * the decoder as an argument. The browser wiring is the two-line adapter above;
 * the tests pass a fake that counts calls and returns a `{ width, height,
 * close() }` object. Nothing about the loader is browser-only — only the
 * decoder the caller supplies is.
 *
 * The factory returns a loader whose asset is an {@link ImageAsset}: a
 * `Disposable` (§83) wrapper that `close()`s the underlying bitmap exactly
 * once. That is deliberate — a raw `ImageBitmap` has `close()`, not
 * `dispose()`, so the asset manager's "release the last reference, dispose the
 * asset" path would silently skip it and leak decoded image memory. Each call
 * to `createImageLoader` produces a **distinct** loader object and therefore a
 * distinct cache slot; hoist it to a module constant if two call sites should
 * share one.
 *
 * ## Other formats
 *
 * `createGltfLoader` in `gltf.ts` parses the landed glTF/GLB tier; `four` owns
 * scene assembly. `createGzipLoader` in `gzip.ts` handles raw gzip bodies with
 * bounded output over an injected streaming decoder (§96).
 */

import { FourError } from "@fourjs/core";

import type { AssetLoader, FetchResponse } from "./asset-manager.js";
import { assertImageDecoderMemory } from "./image-memory.js";
import {
  DEFAULT_MAXIMUM_DECODED_BYTES,
  DEFAULT_MAXIMUM_EXPANSION_RATIO,
  type TextureLoaderOptions,
} from "./texture.js";

/** Loads a response body as UTF-8 text (§76: JSON/SVG/shader sources). */
export const textLoader: AssetLoader<string> = {
  name: "text",
  load(response: FetchResponse): Promise<string> {
    return response.text();
  },
};

/**
 * Loads a response body as parsed JSON (§76).
 *
 * The result is `unknown` on purpose: the bytes came off a network and nothing
 * has validated them. Callers narrow (or run their own schema check) at the one
 * place that knows what the document is supposed to be — a loader that claimed
 * `T` here would be an unchecked cast in a trench coat.
 */
export const jsonLoader: AssetLoader<unknown> = {
  name: "json",
  load(response: FetchResponse): Promise<unknown> {
    return response.json();
  },
};

/**
 * Loads a response body as raw bytes (§76: GLB containers, compressed
 * textures, fonts, audio).
 */
export const binaryLoader: AssetLoader<ArrayBuffer> = {
  name: "binary",
  load(response: FetchResponse): Promise<ArrayBuffer> {
    return response.arrayBuffer();
  },
};

/**
 * The decoded-image shape this package needs: dimensions, and a way to release
 * the decoded memory.
 *
 * The DOM's `ImageBitmap` satisfies it structurally (it has `width`, `height`,
 * and `close()`), so no adapter is needed around a real one.
 */
export interface ImageBitmapLike {
  /** Decoded width in pixels. */
  readonly width: number;
  /** Decoded height in pixels. */
  readonly height: number;
  /** Releases the decoded pixels; idempotent in the DOM. */
  close(): void;
}

/**
 * A `createImageBitmap`-like decoder: encoded bytes in, a decoded bitmap out.
 *
 * Takes an `ArrayBuffer` rather than a `Blob` because that is what a
 * `FetchResponse` yields without naming a DOM type; the browser adapter is
 * `(data) => createImageBitmap(new Blob([data]))`.
 */
export type ImageDecodeLike = (
  data: ArrayBuffer,
) => Promise<ImageBitmapLike> | ImageBitmapLike;

/** RGBA8 size estimates and an optional enforced decoder heap ceiling (§96). */
export interface ImageLoaderOptions extends Pick<
  TextureLoaderOptions,
  "name" | "probe" | "requireProbe" | "maximumWorkingBytes"
> {
  /**
   * Bound on the width × height × 4 RGBA8 size estimate; default 64 MiB.
   * Native bitmap storage can differ and is not measurable through this seam.
   * Positive infinity disables this estimate check.
   */
  readonly maximumDecodedBytes?: number;
  /**
   * Maximum RGBA8 size estimate divided by encoded bytes; default 1000.
   * Positive infinity disables this estimate check.
   */
  readonly maximumExpansionRatio?: number;
}

/**
 * A decoded image with an explicit lifetime (§83).
 *
 * Exists so that releasing the last reference in the asset manager actually
 * frees the bitmap: the manager disposes assets that have `dispose()`, and a
 * platform `ImageBitmap` only has `close()`.
 */
export class ImageAsset implements ImageBitmapLike {
  /** The decoded bitmap, for upload to a texture. */
  readonly bitmap: ImageBitmapLike;

  #closed = false;

  constructor(bitmap: ImageBitmapLike) {
    this.bitmap = bitmap;
  }

  /** Decoded width in pixels. */
  get width(): number {
    return this.bitmap.width;
  }

  /** Decoded height in pixels. */
  get height(): number {
    return this.bitmap.height;
  }

  /** Whether {@link dispose} has already closed the bitmap. */
  get isDisposed(): boolean {
    return this.#closed;
  }

  /** Closes the underlying bitmap. Idempotent (§83). */
  dispose(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.bitmap.close();
  }

  /** {@link ImageBitmapLike} conformance; an alias for {@link dispose}. */
  close(): void {
    this.dispose();
  }
}

/**
 * Builds an image loader around a platform decoder.
 *
 * @param decode - The decoder; `(data) => createImageBitmap(new Blob([data]))`
 *   in a browser, a fake in a unit test. May return the bitmap synchronously.
 * @param nameOrOptions - Diagnostics label, or image-size/probe/memory options.
 *   Native platform decoders cannot satisfy `maximumWorkingBytes` and are
 *   refused before fetching. RGBA8 size estimates do not cap decoder memory
 *   or measure the native bitmap's actual storage.
 * @returns A loader producing a `Disposable` {@link ImageAsset}. Each call
 *   returns a distinct object, hence a distinct asset-manager cache slot.
 */
export function createImageLoader(
  decode: ImageDecodeLike,
  nameOrOptions: string | ImageLoaderOptions = "image",
): AssetLoader<ImageAsset> {
  const options =
    typeof nameOrOptions === "string"
      ? { name: nameOrOptions }
      : { ...nameOrOptions };
  const name = options.name ?? "image";
  assertImageDecoderMemory(decode, options.maximumWorkingBytes, {
    loader: name,
  });
  const maximumDecodedBytes =
    options.maximumDecodedBytes ?? DEFAULT_MAXIMUM_DECODED_BYTES;
  const maximumExpansionRatio =
    options.maximumExpansionRatio ?? DEFAULT_MAXIMUM_EXPANSION_RATIO;
  for (const [limitName, value] of [
    ["maximumDecodedBytes", maximumDecodedBytes],
    ["maximumExpansionRatio", maximumExpansionRatio],
  ] as const) {
    if (!(value > 0)) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `ImageLoaderOptions.${limitName} must be greater than zero.`,
        { context: { loader: name, limitName, found: value } },
      );
    }
  }
  const check = (
    width: number,
    height: number,
    encodedBytes: number,
    url: string,
    stage: "probe" | "decode",
  ): void => {
    const bytes = width * height * 4;
    if (
      !Number.isSafeInteger(width) ||
      width < 1 ||
      !Number.isSafeInteger(height) ||
      height < 1 ||
      !Number.isSafeInteger(bytes)
    ) {
      throw new FourError(
        "UNTRUSTED_INPUT_REJECTED",
        "Image dimensions must be positive safe integers with a safe RGBA8 size.",
        { context: { url, loader: name, stage, width, height } },
      );
    }
    if (
      bytes > maximumDecodedBytes ||
      (encodedBytes > 0 && bytes / encodedBytes > maximumExpansionRatio)
    ) {
      throw new FourError(
        "UNTRUSTED_INPUT_REJECTED",
        "Image RGBA8 size estimate exceeds decoded-byte or expansion limits.",
        {
          context: {
            url,
            loader: name,
            stage,
            bytes,
            encodedBytes,
            maximumDecodedBytes,
            maximumExpansionRatio,
          },
        },
      );
    }
  };
  return {
    name,
    async load(response: FetchResponse, url: string): Promise<ImageAsset> {
      const data = await response.arrayBuffer();
      // Worker adapters may transfer the encoded buffer while decoding.
      const encodedByteLength = data.byteLength;
      const claimed = options.probe?.(data);
      if (claimed === undefined && options.requireProbe === true) {
        throw new FourError(
          "UNTRUSTED_INPUT_REJECTED",
          "A recognized dimension probe is required before image decoding.",
          { context: { url, loader: name, stage: "probe" } },
        );
      }
      if (claimed !== undefined) {
        check(claimed.width, claimed.height, encodedByteLength, url, "probe");
      }
      const bitmap = await decode(data);
      try {
        check(bitmap.width, bitmap.height, encodedByteLength, url, "decode");
        return new ImageAsset(bitmap);
      } catch (cause) {
        try {
          bitmap.close();
        } catch {
          // Preserve the validation failure even if a host cleanup hook fails.
        }
        throw cause;
      }
    },
  };
}
