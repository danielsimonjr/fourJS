import { DEFAULT_RASTER_MAXIMUM_BYTES } from "./raster-limits.js";
import { isGpuReadbackSource } from "./gpu-readback.js";
import type { RenderTarget } from "./render-target.js";
/**
 * Raster painting (§77a; RFC 0004, accepted 2026-08-21) — a surface an
 * application paints and the engine reads: {@link RasterSource} is the read
 * seam, {@link CanvasTexture} the `MaterialTexture` it produces.
 *
 * ## What this is, and what it deliberately is not
 *
 * §50–§52 specify a vector 2D stack whose content is *scene data*; this module
 * is the sanctioned exception to it, added by amendment rather than by
 * accident: a texture whose texels are produced by something other than the
 * engine — a minimap, a gauge face, procedural art, the §73 canvas view. The
 * engine's whole contribution is **a buffer, a version, a size rule, and a
 * place to put it**. It gains no `fillRect`, no path builder, no font
 * rasterizer, and no compositing model (§77a states this normatively): every
 * pixel is painted by the host or the application, and an engine-defined
 * drawing API is RFC 0004's rejected alternative C — §50–§52 and §58
 * re-invented in raster form.
 *
 * Nor is this §62's Canvas 2D *backend* (`render-canvas`, an unchanged
 * reserved stub). A backend draws the scene into a host canvas; this seam
 * reads arbitrary pixels out of one. The two share a host surface and nothing
 * else — RFC 0004 §2c is the table.
 *
 * ## The seam is structural and DOM-free
 *
 * In the discipline of `TextureSource`, `FetchLike`, `PointerSurface`, and
 * `SurfaceObserver`: the engine names a shape, the host supplies a value, and
 * the browser adapter is a few lines in the application. `@fourjs/render`
 * names no DOM type anywhere in its public surface — a seam rule (RFC 0004,
 * alternative F), not a compiler guarantee: no workspace tsconfig pins `lib`. The adapter the discipline promises:
 *
 * ```ts
 * const canvas = new OffscreenCanvas(256, 256);
 * const ctx = canvas.getContext("2d")!;
 *
 * const source: RasterSource = {
 *   width: 256,
 *   height: 256,
 *   origin: "top-left",                       // what every host 2D API produces
 *   paint: () => drawMinimap(ctx, world),
 *   readPixels: (out) => out.set(ctx.getImageData(0, 0, 256, 256).data),
 * };
 * const texture = new CanvasTexture(source);
 * material.map = texture;                     // it is a MaterialTexture
 *
 * // whenever the minimap should change:
 * texture.invalidate();
 * // once per frame, from render/real time — never from a fixed step (§33):
 * texture.update();                           // repaints and re-reads only if stale
 * ```
 *
 * {@link RasterSource.paint} takes **no parameter**, and that is the seam
 * holding: a callback taking an engine-defined context would make the engine
 * define a drawing API (alternative C), and one taking the host's context
 * would make the engine name a DOM type (alternative F). The source closes
 * over whatever it paints with; the hook exists only so the engine can order
 * the repaint against the read.
 *
 * ## Determinism (§33): painted pixels are display content, never simulation input
 *
 * Host-rendered raster output is not reproducible — font rasterization,
 * anti-aliasing, and GPU-backed `getImageData` all differ by platform and
 * driver — so §77a's rule is §40's display-only rule with one word changed:
 * **nothing inside §33's envelope may read painted pixels.** No value derived
 * from a {@link RasterSource} or a {@link CanvasTexture} may reach a fixed
 * step, a §33 checksum, a §34 snapshot, or a replay document; and
 * {@link RasterSource.paint} / {@link CanvasTexture.update} must never be
 * called from a fixed step (§9: they belong to render or real time — a repaint
 * driven from `fixedUpdate` couples an unreproducible cost to the §10
 * accumulator). `tests/integration/raster-display-only.test.ts` enforces the
 * import half mechanically, in the pattern §40's `units-display` test
 * established; what it cannot enforce — an application branching its own
 * fixed-step logic on `texture.data` — is documented there rather than implied
 * away. A `CanvasTexture` consequently has **no §79 representation**: A-16's
 * resources-are-keys rule leaves a painted surface, which has no key, with
 * nothing to write, so no scene document can carry unreproducible pixels.
 *
 * ## §96: finite limits, and no way in for untrusted content
 *
 * {@link CanvasTextureOptions.maximumBytes} defaults to **64 MiB** — A-23's
 * asset default, exactly a 4096 × 4096 RGBA8 surface, which is also the
 * `maxTextureSize` most WebGL 2 devices report — with
 * `Number.POSITIVE_INFINITY` as the explicit in-source opt-out, per A-23's "a
 * limit defaulting to `Infinity` is documentation, not a limit". A source an
 * application wrote with bad dimensions is a §85 programming error
 * (`RangeError`, matching `Texture`'s validation); a source whose dimensions
 * came from *decoded external content* would be refused with
 * `UNTRUSTED_INPUT_REJECTED` per A-23 — **no such source ships** (decode is
 * deferred with `ImageBitmap` sources, RFC 0004 §6), which is what keeps that
 * distinction honest rather than a stub that refuses nothing. And
 * {@link RasterSource.paint} is **application code the application imported**
 * — a function value, passed to a constructor. It is not loaded content, it is
 * not named by a scene document, and {@link CanvasTexture} accepts no URL and
 * no module specifier (RFC 0002's plugin rule, in a second place).
 *
 * ## Ownership and accounting (§83)
 *
 * The engine owns the buffer; the source owns the pixels. One `Uint8Array` of
 * `width * height * 4` bytes is allocated at construction and reused for the
 * texture's life — no per-frame allocation, and the §83 totals
 * (`textureMemoryBytes`, `liveTextureCount`, via `noteTexture`) have something
 * concrete to count, which is exactly what the application-side repaint recipe
 * this class replaces could not report (§84's `textureMemory` under-reported
 * by the most churn-heavy allocation an application makes).
 */

import { FourError, type Disposable } from "@fourjs/core";
import type { MaterialTexture } from "@fourjs/materials";
import type { ColorSpace, Rectangle2 } from "@fourjs/math";

import { TextureUpdates } from "./texture-updates.js";
import { validateTextureSource, type TextureSource } from "./texture.js";

import { validateColorSpace } from "./render-target.js";
import {
  noteTexture,
  releaseRenderDisposable,
  trackRenderDisposable,
} from "./resource-memory.js";

/**
 * Which row a {@link RasterSource} writes first (§77a, §7a).
 *
 * `"bottom-left"` matches `MaterialTexture.data` — row 0 is `v = 0` — and
 * needs no work. `"top-left"` is what every host 2D API produces
 * (`getImageData` returns the top row first), and the engine reverses the rows
 * itself, so the one flip rule is written once here instead of once per
 * application — the vertically mirrored minimap is RFC 0004's motivating bug
 * report.
 */
export type RasterOrigin = "bottom-left" | "top-left";

/** The legal {@link RasterOrigin} values, in the §85 message's order. */
const ORIGINS: readonly RasterOrigin[] = ["bottom-left", "top-left"];

/**
 * A surface an application paints and the engine reads (§77a; RFC 0004).
 *
 * Structural and DOM-free, in the discipline of `TextureSource`, `FetchLike`,
 * `PointerSurface`, and `SurfaceObserver`: the engine names a shape, the host
 * supplies a value, and the browser adapter is a few lines in the application
 * — see the module header for it, and for the §33 and §96 rules every source
 * lives under.
 */
export interface RasterSource {
  /** Width in texels. A finite integer ≥ 1, and constant for this source's life. */
  readonly width: number;

  /** Height in texels. A finite integer ≥ 1, and constant for this source's life. */
  readonly height: number;

  /**
   * Which row {@link RasterSource.readPixels} writes first — see
   * {@link RasterOrigin}. Default `"bottom-left"`. Read once, at
   * {@link CanvasTexture} construction, like the size.
   */
  readonly origin?: RasterOrigin;

  /**
   * The colour space of the texels this source produces. Default **`"srgb"`**
   * — a deliberate difference from `TextureSource`'s `"linear"` default, with
   * the reason written at both (RFC 0004 Q3, adopted): R-15's linear default
   * exists only so that already-authored textures and their pixel goldens do
   * not move, a class that did not exist then has neither, and a host 2D
   * canvas produces sRGB-encoded bytes unambiguously. Choosing `"linear"` here
   * for consistency would make the new tier wrong on purpose.
   */
  readonly colorSpace?: ColorSpace;

  /**
   * Repaint, if this source paints on demand. Called by
   * {@link CanvasTexture.update} immediately before
   * {@link RasterSource.readPixels}, and — like `update()` itself — never from
   * a fixed step (§33; see the module header).
   *
   * No parameter, deliberately: the source closes over whatever it paints
   * with, and the engine never learns what that is. The hook exists only so
   * the engine can order the repaint against the read.
   */
  paint?(): void;

  /**
   * Write exactly `width * height * 4` tightly packed RGBA8 bytes into `out`,
   * straight alpha, in the order declared by {@link RasterSource.origin}.
   *
   * `out` is engine-owned and exactly the right length; a source neither
   * allocates nor retains it.
   */
  readPixels(out: Uint8Array): void;
}

/** Construction options for a {@link CanvasTexture}. */
export interface CanvasTextureOptions extends Pick<
  TextureSource,
  "filter" | "wrap" | "mipmaps" | "minFilter" | "anisotropy"
> {
  /**
   * §96 ceiling on `width * height * 4` — refused at construction and, because
   * the size is re-checked there, effectively on every
   * {@link CanvasTexture.update}. Defaults to **64 MiB** (a 4096 × 4096 RGBA8
   * surface); `Number.POSITIVE_INFINITY` is the explicit in-source opt-out.
   * See the module header for the A-23 reasoning.
   */
  readonly maximumBytes?: number;
}

/**
 * The default {@link CanvasTextureOptions.maximumBytes}: 64 MiB, which is
 * exactly `4096 * 4096 * 4` — A-23's asset default, and the `maxTextureSize`
 * most WebGL 2 devices report.
 */
export { DEFAULT_RASTER_MAXIMUM_BYTES } from "./raster-limits.js";

/**
 * Source of canvas-texture ids. Monotonic and process-wide, exactly like
 * `Texture`'s, `Node`'s, and `BufferGeometry`'s — §33 forbids random or
 * clock-derived identity.
 */
let nextCanvasTextureId = 1;

function assignCanvasTextureId(): string {
  const id = `canvas-texture-${String(nextCanvasTextureId)}`;
  nextCanvasTextureId += 1;
  return id;
}

/** Runs the §85 checks for one source and its §96 limit. Throws on the first violation. */
function validate(source: RasterSource, maximumBytes: number): void {
  for (const axis of ["width", "height"] as const) {
    const value = source[axis];
    if (!Number.isInteger(value) || value < 1) {
      throw new RangeError(
        `CanvasTexture ${axis} must be a finite integer of at least 1; got ` +
          `${String(value)} (§77a, §85).`,
      );
    }
  }
  if (source.origin !== undefined && !ORIGINS.includes(source.origin)) {
    throw new RangeError(
      `CanvasTexture origin must be one of ${ORIGINS.map((one) => JSON.stringify(one)).join(", ")}; ` +
        `got ${JSON.stringify(source.origin)} (§77a, §85).`,
    );
  }
  if (source.colorSpace !== undefined) {
    validateColorSpace(source.colorSpace, "CanvasTexture");
  }
  if (Number.isNaN(maximumBytes) || maximumBytes <= 0) {
    throw new RangeError(
      "CanvasTexture maximumBytes must be a positive number of bytes " +
        "(Number.POSITIVE_INFINITY is the explicit opt-out); got " +
        `${String(maximumBytes)} (§96, §85).`,
    );
  }
  const bytes = source.width * source.height * 4;
  if (bytes > maximumBytes) {
    // The size came from the application's own source object, so this is a
    // §85 refusal in §96's clothing — see the module header for where
    // UNTRUSTED_INPUT_REJECTED would apply instead, and why it does not yet.
    throw new RangeError(
      `A ${String(source.width)}×${String(source.height)} RGBA8 raster surface ` +
        `is ${String(bytes)} bytes, over the ${String(maximumBytes)}-byte ` +
        "maximumBytes limit (§96). Raise the limit explicitly if the surface " +
        "is intended.",
    );
  }
}

/**
 * Reverses the row order of `data` in place — the one flip rule, written once
 * (§7a wants `v = 0` at row 0; a `"top-left"` source wrote the top row first).
 * `row` is a caller-supplied scratch of one row's bytes, so a repaint
 * allocates nothing.
 */
function flipRows(
  data: Uint8Array,
  rowBytes: number,
  height: number,
  row: Uint8Array,
): void {
  for (let top = 0, bottom = height - 1; top < bottom; top += 1, bottom -= 1) {
    const a = top * rowBytes;
    const b = bottom * rowBytes;
    row.set(data.subarray(a, a + rowBytes));
    data.copyWithin(a, b, b + rowBytes);
    data.set(row, b);
  }
}

/**
 * A texture whose texels an application paints (§77a; RFC 0004) — a
 * {@link RasterSource} read into an engine-owned buffer, published through the
 * `MaterialTexture` contract every material and every backend already accept.
 *
 * ```ts
 * const texture = new CanvasTexture(source);
 * material.map = texture;      // any MaterialTexture slot
 * texture.invalidate();        // the surface changed
 * texture.update();            // repaint + re-read, once, before rendering
 * texture.dispose();           // §83: explicit lifetime
 * ```
 *
 * ## No backend changes, none
 *
 * A backend's texture cache keys on {@link CanvasTexture.id} and validates on
 * {@link CanvasTexture.version} (`@fourjs/render-webgl`'s `TextureCache`); a
 * `CanvasTexture` satisfies both and uploads through the path that already
 * exists — R-4's `MaterialTexture` seam paying off a second time, and the
 * strongest single argument for this shape (RFC 0004 §2a). No new duck-typed
 * contract is introduced.
 *
 * ## `update()` is called by the application, never by the engine
 *
 * Nothing polls, nothing subscribes, and no per-frame hook exists — the
 * "version, not events" stance `Texture` records, which also keeps this tier
 * off the render loop's critical path. The consequence is documented rather
 * than papered over (RFC 0004 Q6, adopted: no hook, no staleness warning): an
 * application that forgets `update()` after `invalidate()` sees a stale
 * texture and no diagnostic.
 *
 * ## The size is fixed for the texture's life
 *
 * {@link RasterSource.width}/{@link RasterSource.height} are re-validated on
 * every {@link CanvasTexture.update}; a source that changes size is refused
 * with `INVALID_APPLICATION_STATE` (§89) rather than silently reallocated.
 * Resizing means constructing a new `CanvasTexture` and disposing the old one.
 * This is deliberate and gated, not provisional: §77's change notification is
 * `R-30`'s unshipped half, R-29 recorded that a §55 sprite `frame` is
 * validated against its texture's size only at write time, and a version bump
 * tells a cache to re-read, not a dependent to re-validate — so in-place
 * resize is forbidden precisely so the stale-frame hazard cannot arise, and
 * lifting the restriction is explicitly gated on `R-30` (RFC 0004 Q5,
 * adopted).
 */
export class CanvasTexture implements MaterialTexture, Disposable {
  /**
   * Stable identity (§77, §83), `canvas-texture-<n>` from a monotonic counter
   * (§33 forbids clock-derived identity). Unique within a process, ascending
   * in construction order, never reused.
   */
  readonly id: string = assignCanvasTextureId();

  readonly #source: RasterSource;

  /** Size recorded at construction — the values the source must keep (§2a). */
  readonly #width: number;

  readonly #height: number;

  /** Resolved once, like the size — see {@link RasterSource.origin}. */
  readonly #origin: RasterOrigin;

  readonly #colorSpace: ColorSpace;

  /** The engine-owned pixel buffer; `null` once disposed. */
  #buffer: Uint8Array | null;

  /** One-row scratch for the `"top-left"` flip; `null` when no flip is needed. */
  readonly #row: Uint8Array | null;

  #version = 0;

  readonly #updates = new TextureUpdates();
  readonly #invalidations = new TextureUpdates();
  #invalidationVersion = 0;
  #lastInvalidation = 0;
  readonly #sampler: CanvasTextureOptions;

  /** Born stale, so the first {@link CanvasTexture.update} always reads. */
  #stale = true;

  #disposed = false;

  constructor(source: RasterSource, options: CanvasTextureOptions = {}) {
    validate(source, options.maximumBytes ?? DEFAULT_RASTER_MAXIMUM_BYTES);
    validateTextureSource({
      width: source.width,
      height: source.height,
      ...options,
    });
    this.#sampler = { ...options };
    this.#source = source;
    this.#width = source.width;
    this.#height = source.height;
    this.#origin = source.origin ?? "bottom-left";
    this.#colorSpace = source.colorSpace ?? "srgb";
    this.#buffer = new Uint8Array(this.#width * this.#height * 4);
    this.#row =
      this.#origin === "top-left" ? new Uint8Array(this.#width * 4) : null;
    noteTexture(1, this.byteLength);
    trackRenderDisposable(this, this.id);
  }

  /** Width in texels — constant for this texture's life (§77a). */
  get width(): number {
    return this.#width;
  }

  /** Height in texels — constant for this texture's life (§77a). */
  get height(): number {
    return this.#height;
  }

  /**
   * The colour space of the painted texels (§60a), **`"srgb"`** when the
   * source names none — see {@link RasterSource.colorSpace} for why this
   * default deliberately differs from `TextureSource`'s.
   */
  get colorSpace(): ColorSpace {
    return this.#colorSpace;
  }

  /**
   * The RGBA8 bytes as last read from the source — row 0 is `v = 0` whatever
   * the source's {@link RasterSource.origin} — or `null` once disposed.
   *
   * Engine-owned and reused for the texture's life; readable by anyone holding
   * the texture (the upload path reads it), which is why §77a's display-only
   * rule is an import rule on packages, not a readability rule on this field —
   * see the module header.
   */
  get data(): Uint8Array | null {
    return this.#buffer;
  }

  /**
   * Counter advanced by every completed {@link CanvasTexture.update} (and by
   * {@link CanvasTexture.dispose}). Backends cache GPU uploads against it;
   * compare for inequality, exactly as with `Texture.version`.
   */
  get version(): number {
    return this.#version;
  }

  /** Whether {@link CanvasTexture.dispose} has run. */
  /** RFC 0009 provenance for render-graph feedback refusal. */
  get readbackTarget(): RenderTarget | null {
    return isGpuReadbackSource(this.#source) ? this.#source.target : null;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Bytes this surface describes (§83, §84's `textureMemory`) — four per
   * texel, and `0` once disposed, exactly as `Texture.byteLength` answers.
   */
  get byteLength(): number {
    if (this.#disposed) return 0;
    let width = this.#width,
      height = this.#height,
      bytes = width * height * 4;
    if (this.mipmaps)
      while (width > 1 || height > 1) {
        width = Math.max(1, Math.floor(width / 2));
        height = Math.max(1, Math.floor(height / 2));
        bytes += width * height * 4;
      }
    return bytes;
  }

  /**
   * Marks the surface stale, so the next {@link CanvasTexture.update} repaints
   * and re-reads. Cheap, idempotent, allocation-free — call it whenever the
   * painted content should change, from any code that knows it did.
   */
  invalidate(region?: Rectangle2): void {
    this.#invalidations.add(
      this.#invalidationVersion + 1,
      region ?? null,
      this.#width,
      this.#height,
    );
    this.#invalidationVersion += 1;
    this.#stale = true;
  }

  /** Regions use bottom-left texture coordinates, regardless of source origin. */
  getDirtyRegion(sinceVersion: number): Rectangle2 | null {
    return this.#updates.since(sinceVersion, this.#version);
  }

  get filter(): NonNullable<TextureSource["filter"]> {
    return this.#sampler.filter ?? "linear";
  }
  get wrap(): NonNullable<TextureSource["wrap"]> {
    return this.#sampler.wrap ?? "clamp-to-edge";
  }
  get mipmaps(): boolean {
    return this.#sampler.mipmaps === true;
  }
  get minFilter(): NonNullable<TextureSource["minFilter"]> {
    return (
      this.#sampler.minFilter ??
      (this.mipmaps
        ? this.filter === "nearest"
          ? "nearest-mipmap-nearest"
          : "linear-mipmap-linear"
        : this.filter)
    );
  }
  get anisotropy(): number {
    return this.#sampler.anisotropy ?? 1;
  }

  /**
   * If stale: call {@link RasterSource.paint}, read the pixels, bump
   * {@link CanvasTexture.version}, clear the stale flag, and return `true`.
   * Otherwise return `false` and touch nothing — which is the difference
   * between one upload per repaint and one upload per frame.
   *
   * Application-driven, from §9's render or real time domain — **never from a
   * fixed step** (§33; module header). Performs no `Map`/`Set` enumeration.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` on a disposed texture (§83's
   * "disposed resource still in use", made loud), or when the source's size no
   * longer matches the size this texture was constructed at (§2a's
   * constant-size rule; see the class doc for the `R-30` gate)
   */
  update(): boolean {
    if (this.#buffer === null) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `CanvasTexture ${this.id} is disposed; painting into a disposed ` +
          "surface is a lifetime mistake (§83), and a new surface is a new " +
          "CanvasTexture (§77a).",
        { context: { texture: this.id } },
      );
    }
    if (!this.#stale) {
      return false;
    }
    const source = this.#source;
    source.paint?.();
    // Checked after `paint` and before the read: a source resized during its
    // own repaint (the obvious panel-resize hazard) must not be read at the
    // old size, and §2a's rule is enforced rather than merely documented.
    if (source.width !== this.#width || source.height !== this.#height) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `CanvasTexture ${this.id} was constructed ${String(this.#width)}×` +
          `${String(this.#height)} but its source now reports ` +
          `${String(source.width)}×${String(source.height)}; a raster ` +
          "surface's size is constant for its life (§77a) — construct a new " +
          "CanvasTexture and dispose this one. In-place resize is gated on " +
          "§77 change notification (R-30).",
        {
          context: {
            texture: this.id,
            width: this.#width,
            height: this.#height,
            sourceWidth: source.width,
            sourceHeight: source.height,
          },
        },
      );
    }
    source.readPixels(this.#buffer);
    if (this.#row !== null) {
      flipRows(this.#buffer, this.#width * 4, this.#height, this.#row);
    }
    const region =
      this.#version === 0
        ? null
        : this.#invalidations.since(
            this.#lastInvalidation,
            this.#invalidationVersion,
          );
    this.#updates.add(this.#version + 1, region, this.#width, this.#height);
    this.#lastInvalidation = this.#invalidationVersion;
    this.#version += 1;
    this.#stale = false;
    return true;
  }

  /**
   * Releases the pixel buffer and this texture's share of the §83 totals.
   * Idempotent. The version is bumped so any backend cache keyed on it
   * re-reads and — meeting a disposed texture — skips the draw, exactly as
   * `Texture.dispose` arranges.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    const before = this.byteLength;
    this.#disposed = true;
    this.#buffer = null;
    noteTexture(-1, -before);
    releaseRenderDisposable(this);
    this.#version += 1;
  }
}
