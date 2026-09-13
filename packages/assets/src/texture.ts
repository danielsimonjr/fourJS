/**
 * The texture loader tier (§77's asset half, A-19 — 2026-08-21).
 *
 * ```ts
 * // Browser: one adapter over the platform decoder, hoisted to a constant.
 * const pngLoader = createTextureLoader({
 *   decode: async (data) => {
 *     const bitmap = await createImageBitmap(new Blob([data]));
 *     const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
 *     const context = canvas.getContext("2d")!;
 *     context.drawImage(bitmap, 0, 0);
 *     bitmap.close();
 *     const { data: rgba, width, height } = context.getImageData(
 *       0, 0, canvas.width, canvas.height,
 *     );
 *     return { width, height, data: new Uint8Array(rgba.buffer) };
 *   },
 *   colorSpace: "srgb",
 * });
 *
 * const albedo = await assets.load("/textures/crate.png", pngLoader);
 * const texture = new Texture(albedo);   // @fourjs/render, structurally
 * ```
 *
 * ## What this is and is not
 *
 * It is the **assets half** of §77: fetch → decode → a `TextureSource`-shaped,
 * disposable result with the engine's row order and colour-space metadata
 * attached, bounded per §96. It is not §77 itself — cube, array and 3D targets,
 * mipmaps, anisotropy, compressed containers, render targets and video textures
 * live in `@fourjs/render`'s `Texture` and are still open there (R-30b). Nothing
 * here decodes a format either: PNG, JPEG, WebP and AVIF are the platform's
 * business, and the decoder is injected exactly as `createImageLoader`'s is,
 * for the same reason (this package must build and test under plain
 * `lib.es2022` in Node, so it names no `Blob`, no `ImageBitmap`, no canvas).
 *
 * ## Why it does not import `@fourjs/render`
 *
 * `@fourjs/assets` sits below the renderer in §3.1's dependency matrix, and
 * §62 allows several backends: an asset package that imported one renderer's
 * `TextureSource` would put the whole render tier in the dependency graph of a
 * headless build that only wanted bytes. So {@link TextureAsset} satisfies
 * `TextureSource` **structurally** — same field names, same units, same
 * defaults — and `new Texture(asset)` type-checks with no adapter and no
 * conversion. That is the `PARTICLE_INSTANCE_FLOATS` precedent: a shared
 * contract stated twice, with a test on each side, beats a dependency edge in
 * the wrong direction. `tests/integration/texture-manifest.test.ts` is the test
 * that keeps the two spellings honest.
 *
 * ## Row order: this is where the flip belongs
 *
 * §7a is Y-up and `TextureSource.data` documents row 0 as `v = 0`, the bottom
 * row — while every image codec on earth hands back the *top* row first. That
 * note ends "sources whose first row is the top one … are flipped by the adapter
 * that produces them (§76), not by the backend", and this loader is that
 * adapter: {@link TextureLoaderOptions.flipY} defaults to `true` and reverses
 * the rows once, at load, so a decoded PNG lands the way the engine samples it.
 *
 * ## §96: an input-size limit does not bound a decoder
 *
 * A 16 × 16 PNG can be a few hundred bytes and a 30 000 × 30 000 one can be a
 * few kilobytes: `maximumBytes` bounds what is *downloaded*, and decompression
 * is precisely where that bound stops applying (§96 lists "decompression
 * limits" as its own requirement, and `TODO.md`'s §96 residue has said so since
 * 2026-08-07). This is the first decoder in the engine, so it brings both bounds
 * with it:
 *
 * - {@link TextureLoaderOptions.maximumDecodedBytes} — an absolute output bound
 *   (default {@link DEFAULT_MAXIMUM_DECODED_BYTES}, 64 MiB, exactly a 4096 ×
 *   4096 RGBA8 image).
 * - {@link TextureLoaderOptions.maximumExpansionRatio} — decoded bytes per
 *   encoded byte (default {@link DEFAULT_MAXIMUM_EXPANSION_RATIO}), which is the
 *   bound that actually catches a decompression bomb: the absolute limit alone
 *   lets a 200-byte file legitimately claim 60 MiB.
 *
 * Both are checked **before** the decoder runs when a
 * {@link TextureLoaderOptions.probe} is supplied — a header reader is a dozen
 * bytes of work for PNG, and it is the only way to refuse an allocation that has
 * not happened yet. Without one they are checked on the decoder's output, which
 * bounds what enters the engine but not the decoder's own peak. A platform
 * `createImageBitmap` offers no allocation ceiling. To require one, supply
 * `maximumWorkingBytes` and a decoder directly from a bounded factory such as
 * `createBoundedPngDecoder`; unsupported callbacks are refused at construction.
 * The enforced decoder heap is separate from encoded input and host RGBA/flip
 * buffers, and does not impose a process-wide memory limit.
 */

import { FourError, type Disposable } from "@fourjs/core";

import type { AssetLoader, FetchResponse } from "./asset-manager.js";
import { assertImageDecoderMemory } from "./image-memory.js";

/**
 * The colour space of a texture's texels — `@fourjs/render`'s `ColorSpace`,
 * spelled structurally (see the module comment).
 */
export type TextureColorSpace = "srgb" | "linear";

/** Sampling between texel centres; `@fourjs/render`'s `TextureFilter`. */
export type TextureFilterMode = "nearest" | "linear";

/** Addressing outside `[0, 1]`; `@fourjs/render`'s `TextureWrap`. */
export type TextureWrapMode = "clamp-to-edge" | "repeat" | "mirrored-repeat";

/**
 * The default {@link TextureLoaderOptions.maximumDecodedBytes}: 64 MiB (§96).
 *
 * A 4096 × 4096 RGBA8 image is 67 108 864 bytes — exactly this — so the default
 * admits every texture size the WebGL 2 tier realistically uploads and refuses
 * the 8K one that would quadruple it.
 */
export const DEFAULT_MAXIMUM_DECODED_BYTES = 67_108_864;

/**
 * The default {@link TextureLoaderOptions.maximumExpansionRatio}: 1000 decoded
 * bytes per encoded byte (§96).
 *
 * A photographic JPEG expands by roughly 10–30×, a flat-colour PNG by a few
 * hundred; 1000 leaves honest content untouched while refusing the pathological
 * ratios — 100 000× and up — that make a decompression bomb worth building.
 */
export const DEFAULT_MAXIMUM_EXPANSION_RATIO = 1000;

/** Decoded RGBA8 texels, as a platform decoder produces them. */
export interface DecodedTexels {
  /** Width in texels; a finite integer ≥ 1. */
  readonly width: number;
  /** Height in texels; a finite integer ≥ 1. */
  readonly height: number;
  /**
   * Tightly packed RGBA8, `width * height * 4` bytes, **top row first** unless
   * {@link TextureLoaderOptions.flipY} says otherwise.
   */
  readonly data: Uint8Array;
}

/** The decode seam: encoded bytes in, RGBA8 texels out. */
export type TexelDecodeLike = (
  data: ArrayBuffer,
) => Promise<DecodedTexels> | DecodedTexels;

/**
 * The optional header reader that makes §96's decoded-size limits *pre*-checks.
 *
 * Returns the dimensions the encoded bytes claim, or `undefined` when this
 * probe does not recognise the format — which is treated as "unknown", not as
 * "fine", so the post-decode check still runs.
 */
export type TexelProbeLike = (
  data: ArrayBuffer,
) => { readonly width: number; readonly height: number } | undefined;

/** Construction options for {@link createTextureLoader}. */
export interface TextureLoaderOptions {
  /** Require a recognized dimension probe before decoding. Default false. */
  readonly requireProbe?: boolean;
  /** The platform decoder (§77's "canvas and image-bitmap sources"). */
  readonly decode: TexelDecodeLike;
  /** Optional header reader; see {@link TexelProbeLike} and §96, above. */
  readonly probe?: TexelProbeLike;
  /** Diagnostics label used in error `context.loader`. Defaults to `"texture"`. */
  readonly name?: string;
  /**
   * Reverse the decoded rows so row 0 is the bottom one (§7a). Defaults to
   * `true`, because every image codec decodes top-row-first and the engine
   * samples bottom-row-first; pass `false` for a decoder that already flipped
   * (a browser `createImageBitmap` with `imageOrientation: "flipY"`).
   */
  readonly flipY?: boolean;
  /** §60a colour-space tag put on the result. Defaults to none, i.e. linear. */
  readonly colorSpace?: TextureColorSpace;
  /** §77 filter mode put on the result. Defaults to none, i.e. `"linear"`. */
  readonly filter?: TextureFilterMode;
  /** §77 wrap mode put on the result. Defaults to none, i.e. `"clamp-to-edge"`. */
  readonly wrap?: TextureWrapMode;
  /**
   * §96 decoded-size bound in bytes. Defaults to
   * {@link DEFAULT_MAXIMUM_DECODED_BYTES}; `Number.POSITIVE_INFINITY` disables
   * it.
   */
  readonly maximumDecodedBytes?: number;
  /**
   * §96 decompression bound: decoded bytes per encoded byte. Defaults to
   * {@link DEFAULT_MAXIMUM_EXPANSION_RATIO}; `Number.POSITIVE_INFINITY`
   * disables it.
   */
  readonly maximumExpansionRatio?: number;
  /**
   * Require an enforced decoder linear-memory ceiling, in bytes. The decoder
   * must come directly from a bounded factory with a ceiling no larger than
   * this safe integer (64 KiB–4 GiB). Native callbacks are refused at
   * construction. Omit for legacy platform decoding without a heap cap.
   * Encoded input, returned RGBA bytes and row-flip copies are separate from
   * the decoder heap; this is not a process-wide memory limit.
   */
  readonly maximumWorkingBytes?: number;
}

/**
 * A decoded texture with an explicit lifetime (§83), shaped as
 * `@fourjs/render`'s `TextureSource` (§61, §77).
 *
 * `new Texture(asset)` takes it directly. {@link dispose} drops the texel
 * buffer — the one large allocation a texture asset owns — so releasing the
 * last reference in the {@link AssetManager} actually frees it; a disposed
 * asset reports a 1 × 1 empty source rather than throwing, matching the
 * renderer's own post-disposal posture.
 */
export class TextureAsset implements Disposable {
  #width: number;
  #height: number;
  #data: Uint8Array;
  #disposed = false;

  /** §60a colour space, or `undefined` for the renderer's default. */
  readonly colorSpace: TextureColorSpace | undefined;
  /** §77 filter mode, or `undefined` for the renderer's default. */
  readonly filter: TextureFilterMode | undefined;
  /** §77 wrap mode, or `undefined` for the renderer's default. */
  readonly wrap: TextureWrapMode | undefined;

  constructor(
    texels: DecodedTexels,
    options: {
      readonly colorSpace?: TextureColorSpace;
      readonly filter?: TextureFilterMode;
      readonly wrap?: TextureWrapMode;
    } = {},
  ) {
    this.#width = texels.width;
    this.#height = texels.height;
    this.#data = texels.data;
    this.colorSpace = options.colorSpace;
    this.filter = options.filter;
    this.wrap = options.wrap;
  }

  /** Width in texels. */
  get width(): number {
    return this.#width;
  }

  /** Height in texels. */
  get height(): number {
    return this.#height;
  }

  /** Tightly packed RGBA8 texels, bottom row first (§7a). */
  get data(): Uint8Array {
    return this.#data;
  }

  /** Whether {@link dispose} has already released the texels. */
  get isDisposed(): boolean {
    return this.#disposed;
  }

  /** Releases the texel buffer. Idempotent (§83). */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#width = 1;
    this.#height = 1;
    this.#data = EMPTY_TEXELS;
  }
}

/** What a disposed {@link TextureAsset} holds: one transparent-black texel. */
const EMPTY_TEXELS = new Uint8Array(4);

/** Validates a §96 output bound the way the manager validates its own. */
function positiveBound(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!(value > 0)) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      `TextureLoaderOptions.${name} must be greater than zero (or ` +
        `Number.POSITIVE_INFINITY to disable the limit); got ${String(value)}.`,
      { context: { limitName: name, found: value } },
    );
  }
  return value;
}

/** Refuses an over-budget decode, naming which of §96's two bounds it broke. */
function refuseSize(
  url: string,
  name: string,
  limitName: string,
  limit: number,
  observed: number,
  stage: "probe" | "decode",
): FourError {
  return new FourError(
    "ASSET_LOAD_FAILED",
    `"${url}" decodes to ${String(observed)} ${
      limitName === "maximumExpansionRatio" ? "× its encoded size" : "bytes"
    }, over the ${String(limit)} limit (§96 decompression limits).`,
    {
      context: { url, loader: name, limitName, limit, observed, stage },
    },
  );
}

/** Reverses the rows of a tightly packed RGBA8 image, into a new buffer. */
function flipRows(texels: DecodedTexels): Uint8Array {
  const stride = texels.width * 4;
  const flipped = new Uint8Array(texels.data.length);
  for (let row = 0; row < texels.height; row += 1) {
    const source = row * stride;
    flipped.set(
      texels.data.subarray(source, source + stride),
      (texels.height - 1 - row) * stride,
    );
  }
  return flipped;
}

/**
 * Builds the fetch-free half of the texture tier: encoded bytes in, a
 * checked, flipped, tagged {@link TextureAsset} out (§77, §96).
 *
 * This is {@link createTextureLoader}'s whole decode path as a standalone
 * function, for callers that already hold the encoded bytes — the §78 glTF
 * loader's embedded and buffer-view images are the first (`gltf.ts`), and an
 * application streaming images from somewhere `fetch` cannot reach is the
 * same shape. Every rule is identical because it is literally the same code:
 * the §96 pre-/post-decode bounds, the §85 dimension checks, and the §7a row
 * flip.
 *
 * @param options - As {@link createTextureLoader}.
 * @returns An async `(encoded, url) => TextureAsset` decoder; `url` labels
 *   errors only.
 * @throws FourError `INVALID_APPLICATION_STATE` for a non-positive limit.
 */
export function createTextureDecoder(
  options: TextureLoaderOptions,
): (encoded: ArrayBuffer, url: string) => Promise<TextureAsset> {
  // Snapshot the capability and settings: mutating caller-owned options must
  // not substitute an unbounded decoder after the construction-time check.
  options = { ...options };
  const name = options.name ?? "texture";
  assertImageDecoderMemory(options.decode, options.maximumWorkingBytes, {
    loader: name,
  });
  const flipY = options.flipY ?? true;
  const maximumDecodedBytes = positiveBound(
    options.maximumDecodedBytes,
    DEFAULT_MAXIMUM_DECODED_BYTES,
    "maximumDecodedBytes",
  );
  const maximumExpansionRatio = positiveBound(
    options.maximumExpansionRatio,
    DEFAULT_MAXIMUM_EXPANSION_RATIO,
    "maximumExpansionRatio",
  );

  /** Both §96 bounds against a decoded byte count. */
  const check = (
    url: string,
    decodedBytes: number,
    encodedBytes: number,
    stage: "probe" | "decode",
  ): void => {
    if (decodedBytes > maximumDecodedBytes) {
      throw refuseSize(
        url,
        name,
        "maximumDecodedBytes",
        maximumDecodedBytes,
        decodedBytes,
        stage,
      );
    }
    // A zero-byte body cannot decode to anything, so there is no ratio to take;
    // the decoder's own failure is the honest report for it.
    if (encodedBytes > 0 && Number.isFinite(maximumExpansionRatio)) {
      const ratio = decodedBytes / encodedBytes;
      if (ratio > maximumExpansionRatio) {
        throw refuseSize(
          url,
          name,
          "maximumExpansionRatio",
          maximumExpansionRatio,
          Math.round(ratio),
          stage,
        );
      }
    }
  };

  return async (encoded: ArrayBuffer, url: string): Promise<TextureAsset> => {
    // A probe or Worker-backed decoder may transfer and detach this buffer.
    // The expansion denominator is the original input size, not its later state.
    const encodedByteLength = encoded.byteLength;
    // Pre-decode refusal, when the caller gave this loader a way to look.
    const claimed = options.probe?.(encoded);
    if (claimed === undefined && options.requireProbe === true) {
      throw new FourError(
        "UNTRUSTED_INPUT_REJECTED",
        "A recognized dimension probe is required before image decoding.",
        { context: { url, loader: name, stage: "probe" } },
      );
    }
    if (claimed !== undefined) {
      if (
        !Number.isSafeInteger(claimed.width) ||
        claimed.width < 1 ||
        !Number.isSafeInteger(claimed.height) ||
        claimed.height < 1 ||
        !Number.isSafeInteger(claimed.width * claimed.height * 4)
      ) {
        throw new FourError(
          "UNTRUSTED_INPUT_REJECTED",
          "Texture probe returned invalid dimensions.",
          { context: { url, loader: name, stage: "probe" } },
        );
      }
      check(
        url,
        claimed.width * claimed.height * 4,
        encodedByteLength,
        "probe",
      );
    }

    const texels = await options.decode(encoded);
    const { width, height, data } = texels;
    if (
      !Number.isSafeInteger(width) ||
      width < 1 ||
      !Number.isSafeInteger(height) ||
      height < 1 ||
      !Number.isSafeInteger(width * height * 4)
    ) {
      throw new FourError(
        "ASSET_LOAD_FAILED",
        `"${url}" decoded to ${String(width)} × ${String(height)}; a texture ` +
          `needs finite integer dimensions of at least 1 (§85).`,
        { context: { url, loader: name, width, height } },
      );
    }
    if (!(data instanceof Uint8Array)) {
      throw new FourError(
        "ASSET_LOAD_FAILED",
        `"${url}" must decode to RGBA8 Uint8Array data.`,
        { context: { url, loader: name } },
      );
    }
    if (data.length !== width * height * 4) {
      throw new FourError(
        "ASSET_LOAD_FAILED",
        `"${url}" decoded to ${String(data.length)} bytes for a ` +
          `${String(width)} × ${String(height)} RGBA8 image, which needs ` +
          `${String(width * height * 4)} (§77).`,
        {
          context: {
            url,
            loader: name,
            width,
            height,
            observed: data.length,
          },
        },
      );
    }
    check(url, data.length, encodedByteLength, "decode");
    // A small view can retain a much larger decoder allocation. Bound what
    // the asset would actually retain, before creating a row-flip copy.
    check(url, data.buffer.byteLength, encodedByteLength, "decode");

    return new TextureAsset(
      flipY ? { width, height, data: flipRows(texels) } : texels,
      {
        colorSpace: options.colorSpace,
        filter: options.filter,
        wrap: options.wrap,
      },
    );
  };
}

/**
 * Builds a texture loader around a platform decoder (§77, §96).
 *
 * The whole decode path is {@link createTextureDecoder}; this wraps it as an
 * {@link AssetLoader} for the manager's fetch pipeline.
 *
 * @param options - The decoder, the sampler metadata to attach, and the §96
 *   decoded-size bounds. See the module comment for the row-order flip and for
 *   why the bounds are post-decode without a {@link TextureLoaderOptions.probe}.
 * @returns A loader producing a `Disposable`, `TextureSource`-shaped
 *   {@link TextureAsset}. Each call returns a distinct object, hence a distinct
 *   asset-manager cache slot — hoist it to a module constant.
 * @throws FourError `INVALID_APPLICATION_STATE` for a non-positive limit.
 */
export function createTextureLoader(
  options: TextureLoaderOptions,
): AssetLoader<TextureAsset> {
  const decode = createTextureDecoder(options);
  return {
    name: options.name ?? "texture",
    async load(response: FetchResponse, url: string): Promise<TextureAsset> {
      return decode(await response.arrayBuffer(), url);
    },
  };
}
