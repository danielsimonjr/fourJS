/**
 * `Texture` (§77, §55, §61) — CPU-side texel data with a stable identity and a
 * version, in the one shape the MVP renderer uploads.
 *
 * §77 asks for 2D, cube, array, and 3D textures; mipmaps; wrap, filter, and
 * anisotropy state; colour-space metadata; compressed containers; render-target
 * textures; video textures; canvas and image-bitmap sources; and asynchronous
 * upload with residency diagnostics. What is here is the **2D, RGBA8** texture
 * built from a plain byte array — what §55's sprite tier and §56's glyph atlas
 * need in order to draw anything at all — grown four times since: the
 * **colour-space tag** §60a needs (R-15, 2026-08-08), which the WebGL 2 backend
 * turns into an sRGB internal format; **wrap and filter modes** (R-30,
 * 2026-08-13); **mipmaps, the min-filter split, and anisotropy** (R-30b,
 * 2026-08-21); and **map roles** (R-30c, 2026-09-09) — an optional colour/data
 * tag so a colour map can default its omitted `colorSpace` to `"srgb"` without
 * moving goldens that never set `role`. What those four have in common is that
 * they are *upload-time state*: a texture is still one image of one size, and
 * the backend still reads every one of them in the same place. The rest are
 * named as deferred on {@link Texture} rather than sketched, because each of
 * them (a cube target, a compressed-format enum) is a public shape the §79
 * scene format and every backend have to agree on.
 *
 * ## Two departures worth stating up front
 *
 * ### 1. No DOM in the source (decision, WP-3a.3)
 *
 * §61 types the renderer's texture entry point as
 * `createTexture(source: TextureSource)` and §77 lists "canvas and image-bitmap
 * sources". {@link TextureSource} here is **structural and DOM-free**: a width,
 * a height, and optional tightly packed RGBA8 bytes. That is deliberate —
 * `@fourjs/render` compiles with no `lib.dom` (see `renderer.ts` on
 * `RendererOptions.canvas`), a glyph atlas rasterized into a byte array is
 * exactly what §56's MVP text tier produces, and a test can build a 2×2
 * checkerboard with no browser at all. `ImageBitmap`/`HTMLImageElement`/video
 * sources are an *adapter* problem, and they land with §76's asset manager,
 * which is the layer that already owns decoding and the main-thread/worker
 * split. When they do, they widen {@link TextureSource} rather than replace it.
 *
 * ### 2. `Renderer.createTexture` stays deferred; backends discover textures
 *
 * §61's interface has `createTexture(source): Texture`, and `renderer.ts`
 * records it as a typed TODO. **This packet does not add it**, and that is a
 * considered decision rather than an omission:
 *
 * - `createTexture` makes the texture a *renderer-owned* object, which means an
 *   application must have a renderer before it can build a texture, must build a
 *   second one for a second renderer, and must re-create all of them by hand
 *   after a §61 context loss. None of that is true of geometries or materials
 *   today, and none of it should be true of textures either.
 * - The backend already solves the same problem for geometry, with a cache keyed
 *   on `id` and validated by `version` (`@fourjs/render-webgl`'s `GeometryCache`).
 *   A texture carries the same two fields for the same reason, so the WebGL
 *   backend discovers textures from the materials in the render list and uploads
 *   them on first use — and a context loss is handled by dropping the cache, not
 *   by asking the application to rebuild anything.
 *
 * The MVP tier therefore reads: **a `Texture` is a CPU-side resource; GPU
 * residency is a backend cache.** §61's `createTexture` stays on the deferred
 * list in `renderer.ts` for the tier that needs renderer-owned textures —
 * render targets (§63) and compressed or GPU-only formats, which have no
 * CPU-side source to discover.
 *
 * ## Ownership (§83)
 *
 * A texture is **shared, not owned by the materials that sample it**: one atlas
 * backs many `SpriteMaterial`s. Whoever created it disposes it, and
 * `SpriteMaterial.dispose()` deliberately does not.
 *
 * Because nothing owns a shared texture, nothing could say how much texture
 * memory the engine held — which is why every texture reports its size
 * ({@link Texture.byteLength}) to the process-wide totals in
 * `resource-memory.ts` at construction, on each source replacement, and on
 * `dispose()` (A-5, 2026-08-07). That accounting is what makes §84's
 * `textureMemory` measurable and a leaked atlas visible; it holds no reference
 * to anything and never runs on a draw path.
 */

import type { Disposable } from "@fourjs/core";
import type {
  MaterialTextureFilter,
  MaterialTextureMinFilter,
  MaterialTextureWrap,
  SpriteTexture,
} from "@fourjs/materials";
import type { ColorSpace, Rectangle2 } from "@fourjs/math";

import { TextureUpdates } from "./texture-updates.js";

import { validateColorSpace } from "./render-target.js";
import {
  noteTexture,
  releaseRenderDisposable,
  trackRenderDisposable,
} from "./resource-memory.js";

/**
 * How a texture is sampled between texel centres (§77's "filter modes"; R-30,
 * 2026-08-13).
 *
 * ```ts
 * new Texture({ ...atlas, filter: "nearest" });   // a crisp bitmap font
 * ```
 *
 * ## Why two values, and why one field rather than `minFilter`/`magFilter`
 *
 * §77 asks for filter modes, and GL offers six — but four of them
 * (`*_MIPMAP_NEAREST`, `*_MIPMAP_LINEAR`) name a choice *between mip levels*,
 * and a texture with one level has none to choose between. This tier generates
 * no mipmaps ({@link Texture}), so the honest set is the two that mean something
 * here, and naming the other four would be accepting a value the backend must
 * then reinterpret.
 *
 * For the same reason there was one field and not two. `minFilter` and
 * `magFilter` are a *pair* precisely because minification is the direction with
 * mip levels in it; with one level the two accept the same two values and
 * differing between them buys nothing an author can describe.
 *
 * **Mipmaps landed on 2026-08-21 (R-30b), and the split landed with them** —
 * exactly where R-30 said it would: beside this field, not instead of it. This
 * field still means "both directions, unless the min side is overridden", and
 * {@link TextureSource.minFilter} is that override, carrying the four
 * mip-choosing values ({@link TextureMinFilter}). There is no `magFilter`,
 * because magnification has no mip levels to choose between and GL accepts only
 * these two values there — so this field *is* the magnification filter.
 */
export type TextureFilter = MaterialTextureFilter;

/**
 * How a texture is sampled when **minified** (§77's mip-choosing filter modes;
 * R-30b, 2026-08-21) — {@link TextureFilter} plus GL's four `*_MIPMAP_*` modes.
 *
 * ```ts
 * // Trilinear: bilinear within each level, blended between two levels.
 * new Texture({ ...ground, mipmaps: true, minFilter: "linear-mipmap-linear" });
 * ```
 *
 * See {@link MaterialTextureMinFilter} for the table of what each value does,
 * and {@link TextureSource.minFilter} for the derived default and the §85
 * refusal that keeps a mip-choosing value off a texture with no mip chain.
 */
export type TextureMinFilter = MaterialTextureMinFilter;

/**
 * How a texture is addressed outside `[0, 1]` (§77's "wrap modes"; R-30,
 * 2026-08-13).
 *
 * One field for both axes — see {@link MaterialTextureWrap} for why, and for how
 * it widens.
 */
export type TextureWrap = MaterialTextureWrap;

/**
 * §77 texture target kinds: `"2d"`, a six-face `"cube"`, a `"array"` of 2D
 * layers, and a `"3d"` volume (R-30c, WP-W5.2).
 */
export type TextureDimension = "2d" | "cube" | "array" | "3d";

/**
 * Whether a texture is a colour map or a data map (§60a, §77; R-30c,
 * 2026-09-09).
 *
 * `"color"` is albedo, emissive, and anything authored in an image editor;
 * `"data"` is a normal, roughness, occlusion, or mask map whose bytes are the
 * numbers they are. The tag is optional: omitting it invents no default role,
 * and leaves {@link TextureSource.colorSpace} at its dated `"linear"` default
 * so every already-authored texture stays byte-identical. See
 * {@link TextureSource.role}.
 */
export type TextureMapRole = "color" | "data";

/** The legal {@link TextureDimension} values, in the §85 message's order. */
const DIMENSIONS: readonly TextureDimension[] = ["2d", "cube", "array", "3d"];

/** The legal {@link TextureMapRole} values, in the §85 message's order. */
const MAP_ROLES: readonly TextureMapRole[] = ["color", "data"];

/** The legal {@link TextureFilter} values, in the §85 message's order. */
const FILTERS: readonly TextureFilter[] = ["nearest", "linear"];

/** The legal {@link TextureMinFilter} values, in the §85 message's order. */
const MIN_FILTERS: readonly TextureMinFilter[] = [
  "nearest",
  "linear",
  "nearest-mipmap-nearest",
  "linear-mipmap-nearest",
  "nearest-mipmap-linear",
  "linear-mipmap-linear",
];

/**
 * Whether a {@link TextureMinFilter} chooses *between* mip levels — i.e.
 * whether it needs the texture to carry a mip chain (R-30b).
 *
 * A substring test rather than a set, because the four values are exactly the
 * ones spelled `*-mipmap-*` and the naming is the union's own convention.
 */
function usesMipLevels(minFilter: TextureMinFilter): boolean {
  return minFilter.includes("-mipmap-");
}

/** The legal {@link TextureWrap} values, in the §85 message's order. */
const WRAPS: readonly TextureWrap[] = [
  "clamp-to-edge",
  "repeat",
  "mirrored-repeat",
];

/**
 * The texel data a {@link Texture} is built from (§61's `TextureSource`, §77).
 *
 * Structural and DOM-free — see the module header for why, and for where
 * `ImageBitmap`-like sources land.
 *
 * ```ts
 * // A 2×2 opaque red/blue checkerboard, bottom row first.
 * const source: TextureSource = {
 *   width: 2,
 *   height: 2,
 *   data: new Uint8Array([
 *     255, 0, 0, 255,   0, 0, 255, 255,
 *     0, 0, 255, 255,   255, 0, 0, 255,
 *   ]),
 * };
 * ```
 */
export interface TextureSource {
  /** Width in texels. A finite integer ≥ 1. */
  readonly width: number;

  /** Height in texels. A finite integer ≥ 1. */
  readonly height: number;

  /**
   * §77 target kind. Defaults to `"2d"`.
   *
   * `"cube"`, `"array"` (a 2D array), and `"3d"` upload since R-30c
   * (WP-W5.2). `data` holds the layers back to back, layer 0 first, each
   * `width * height * 4` bytes: a cube's six faces in the order +X, -X, +Y,
   * -Y, +Z, -Z (square only), an array's layers, a volume's z slices. Each
   * changes the sampler type, so a backend binds one only through its explicit
   * resource path (`acquireResource`), never as a sprite or unlit map; no
   * material consumes them yet. Regional `markDirty` is 2D only.
   */
  readonly dimension?: TextureDimension;

  /**
   * Layer count for `"array"` (required) and `"3d"` (required: slices).
   * `"cube"` is always 6 (omit, or pass 6); `"2d"` is always 1 (omit, or pass 1).
   */
  readonly depth?: number;

  /**
   * Tightly packed RGBA8 texels — four bytes per texel, exactly
   * `width * height * 4` bytes — or absent for a texture with no CPU-side
   * content (a backend then allocates zero-filled storage of the given size,
   * which samples as transparent black).
   *
   * **Row 0 is `v = 0`**, the bottom row: §7a is Y-up, and GL's default unpack
   * orientation already reads the first row as the bottom one, so the MVP tier
   * needs no flip anywhere. Sources whose first row is the top one — a decoded
   * PNG, an `ImageBitmap` — are flipped by the adapter that produces them
   * (§76), not by the backend.
   *
   * Straight (non-premultiplied) alpha, matching §66's straight-alpha policy
   * for this tier and `UnlitMaterial.color`. Colour-space metadata is carried
   * by {@link TextureSource.colorSpace} since 2026-08-08 (R-15); it was
   * deliberately absent before that, and the note that said so — "tagging a
   * space here would pin half of §60a's design by accident" — is superseded.
   */
  readonly data?: Uint8Array;

  /**
   * The colour space these texels are in — §60a's first bullet: "color textures
   * default to sRGB-encoded and are decoded to linear on sample; data maps
   * (normal, roughness, occlusion) default to linear" (R-15, 2026-08-08).
   *
   * ```ts
   * // An albedo map authored in an image editor: sRGB-encoded bytes.
   * new Texture({ width, height, data, colorSpace: "srgb" });
   * ```
   *
   * `"srgb"` makes the backend allocate an sRGB internal format, so the GPU
   * decodes each sample to linear-light before the shader sees it and §60a's
   * "lighting and blending run in linear space" holds for textured surfaces
   * too. `"linear"` uploads the bytes as the numbers they are — the right tag
   * for a data map, a mask, or texels a program computed.
   *
   * ## The dated deviation from §60a's default (owner decision, R-15)
   *
   * §60a defaults *colour* textures to sRGB. This field **defaults to
   * `"linear"`** when {@link TextureSource.role} is omitted, and the reason is
   * the one this repository applies to every default: flipping the engine-wide
   * default would silently darken every texture already authored against this
   * engine and move every pixel golden, for scenes that never asked for colour
   * management. Opt-in keeps §60a's behaviour available and every existing
   * frame byte-identical. Map roles (R-30c, 2026-09-09) made the faithful
   * default cheap *per texture* — `role: "color"` with no `colorSpace` resolves
   * to `"srgb"` — without flipping the engine-wide default. An owner call can
   * still change the omitted-role default later; this packet does not.
   *
   * §77a's `CanvasTexture` deliberately answers the same question differently
   * — its default is `"srgb"` — because a class born after R-15 has no
   * authored content and no goldens to protect, and a host 2D canvas produces
   * sRGB-encoded bytes unambiguously (RFC 0004 Q3, adopted; the reason is
   * recorded at both defaults).
   */
  readonly colorSpace?: ColorSpace;

  /**
   * Whether these texels are a colour map or a data map (§60a, §77; R-30c,
   * 2026-09-09). Optional: omitting it invents **no** default role.
   *
   * ```ts
   * // An albedo PNG: sRGB-encoded bytes, decoded on sample.
   * new Texture({ width, height, data, role: "color" });
   * // A roughness map: bytes are the numbers they are.
   * new Texture({ width, height, data, role: "data" });
   * ```
   *
   * ## Colour-space resolution (the cheap default this tag exists to make)
   *
   * | `role` | `colorSpace` authored | resolved `colorSpace` |
   * | --- | --- | --- |
   * | omitted | omitted | `"linear"` (R-15, goldens unchanged) |
   * | omitted | `"srgb"` / `"linear"` | the authored tag |
   * | `"color"` | omitted | `"srgb"` |
   * | `"data"` | omitted | `"linear"` |
   * | either | `"srgb"` / `"linear"` | the authored tag wins |
   *
   * Backends still read {@link Texture.colorSpace} only. The role never
   * changes a sampler type, and a source that never sets it is byte-identical
   * to one built before this field existed.
   */
  readonly role?: TextureMapRole;

  /**
   * How this texture is sampled between texel centres (§77; R-30,
   * 2026-08-13). Defaults to `"linear"`.
   *
   * ```ts
   * // A 6 × 12 bitmap font: every glyph texel stays a square.
   * const atlas = new Texture({ ...buildGlyphAtlas(), filter: "nearest" });
   * ```
   *
   * The default is `"linear"` because that is what this tier sampled with
   * before the field existed: a texture that names no filter issues the
   * identical `texParameteri` pair it always did, so no already-authored scene
   * moves a pixel (the rule R-15's `colorSpace` default follows, for the same
   * reason).
   */
  readonly filter?: TextureFilter;

  /**
   * How this texture is addressed outside `[0, 1]` (§77; R-30, 2026-08-13).
   * Defaults to `"clamp-to-edge"`, this tier's previous fixed choice.
   *
   * ```ts
   * // A tiling ground texture, with uv running 0…8 across the plane.
   * new Texture({ width, height, data, wrap: "repeat" });
   * ```
   *
   * Note that `"repeat"` and `"mirrored-repeat"` are legal on a
   * non-power-of-two texture in WebGL 2 (they were not in WebGL 1), so a
   * backend at §62's WebGL 1 tier would have to refuse the combination rather
   * than silently sample black.
   */
  readonly wrap?: TextureWrap;

  /**
   * Whether the backend builds a full mip chain for this texture at upload
   * (§77's "mipmaps"; R-30b, 2026-08-21). Defaults to `false` — one level,
   * which is what every texture in the engine had before this field existed.
   *
   * ```ts
   * // A ground texture the camera flies away from.
   * new Texture({ width: 512, height: 512, data, mipmaps: true });
   * ```
   *
   * ## What it costs and what it buys
   *
   * It buys **minification**: a 512² texture covering twenty screen pixels
   * takes twenty samples out of a quarter-million texels without a chain, and
   * which twenty depends on the sub-pixel position of the camera — which is the
   * crawling shimmer that appears the moment anything moves. With a chain the
   * hardware samples a level whose texels are about the size of a pixel, and the
   * image holds still.
   *
   * It costs a third more texture memory ({@link Texture.byteLength} counts the
   * chain) and one `generateMipmap` at upload — both paid once per upload, and
   * nothing at all on the draw path.
   *
   * ## No power-of-two constraint (WebGL 2)
   *
   * WebGL 1 could neither mipmap nor `REPEAT` a non-power-of-two texture. WebGL
   * 2 is GLES 3.0 and lifts both restrictions for ordinary uncompressed
   * formats, so a 300 × 173 texture takes a chain here with no padding and no
   * resize. (Compressed containers keep restrictions of their own — they are
   * still deferred, see {@link Texture}.) A backend at §62's WebGL 1 tier is the
   * one that would have to refuse the combination, exactly as it would have to
   * refuse {@link TextureSource.wrap}'s `"repeat"`.
   *
   * A backend whose context cannot generate mipmaps at all uploads the texture
   * with one level and an in-level min filter — degrading rather than leaving
   * a texture GL would treat as incomplete (see `@fourjs/render-webgl`).
   */
  readonly mipmaps?: boolean;

  /**
   * How this texture is sampled when **minified** (§77; R-30b, 2026-08-21) —
   * the mip-level-aware half of {@link TextureSource.filter}, which R-30 staged
   * and this packet lands.
   *
   * ```ts
   * // Crisp within a level, snapped between levels — pixel art at a distance.
   * new Texture({ ...art, filter: "nearest", mipmaps: true,
   *               minFilter: "nearest-mipmap-nearest" });
   * ```
   *
   * **Defaults to the derived value**, never to a constant:
   *
   * - with no mip chain, to {@link TextureSource.filter} — which is what this
   *   field's absence has always meant, and why a texture that names neither
   *   still issues the identical pair of `texParameteri` calls;
   * - with `mipmaps: true`, to that filter's chain-aware form — `"linear"` →
   *   `"linear-mipmap-linear"` (trilinear), `"nearest"` →
   *   `"nearest-mipmap-nearest"`. Building a chain and then not sampling it
   *   would be the one combination nobody asks for on purpose.
   *
   * **A mip-choosing value without `mipmaps: true` is refused** (§85): GL calls
   * such a texture *incomplete* and samples it as opaque black, which is a
   * whole-surface visual failure with nothing anywhere saying why. Refusing is
   * this repository's rule for exactly that class of value.
   */
  readonly minFilter?: TextureMinFilter;

  /**
   * How many anisotropic samples the backend may take when this texture is
   * minified at a steep angle (§77's "anisotropy"; R-30b, 2026-08-21). An
   * integer ≥ 1; defaults to `1`, which is isotropic filtering and GL's own
   * default.
   *
   * ```ts
   * // A ground plane seen edge-on: mip levels alone blur it to mush.
   * new Texture({ ...ground, mipmaps: true, anisotropy: 8 });
   * ```
   *
   * ## A request, not a guarantee (the §62 decision, R-30b)
   *
   * Anisotropic filtering is an **extension** in WebGL 2 —
   * `EXT_texture_filter_anisotropic` — so a conformant device may not have it,
   * and every device that does has its own maximum. The policy here is §62's,
   * not §85's: the backend clamps the request to the device's maximum, and
   * where the extension is absent it uploads the texture with no anisotropy at
   * all rather than failing. **Presence is the capability**, the stance this
   * package takes for every optional renderer feature.
   *
   * The asymmetry with {@link TextureSource.filter}, which *is* refused when
   * unknown, is deliberate and worth stating: `"nearset"` is a mistake in the
   * scene, and no device will ever honour it; `anisotropy: 16` is a correct
   * request that some devices cannot fill, and a quality knob that turns a scene
   * into an error on half the fleet is worse than one that quietly costs less.
   * What §85 *does* refuse here is a value that is not an integer ≥ 1 — no
   * device could honour that either.
   *
   * Anisotropy above 1 is only worth asking for together with `mipmaps: true`
   * (it selects among mip levels per axis); the combination is not required and
   * not refused, because a driver is free to do something useful with it and
   * the texture is complete either way.
   */
  readonly anisotropy?: number;
}

/**
 * Bytes of a texture and its optional mip chain, all faces/layers/slices
 * included (§83, §84). A cube bills six faces; an array keeps its layer count
 * at every level; a volume halves its depth per level too (GL/WebGPU 3D mips).
 */
export function textureChainBytes(
  width: number,
  height: number,
  depth: number,
  dimension: TextureDimension,
  mipmaps: boolean,
): number {
  let w = width;
  let h = height;
  let d = depth;
  let bytes = w * h * d * 4;
  if (!mipmaps) return bytes;
  while (w > 1 || h > 1 || (dimension === "3d" && d > 1)) {
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
    if (dimension === "3d") d = Math.max(1, d >> 1);
    bytes += w * h * d * 4;
  }
  return bytes;
}

/**
 * Source of texture ids. Monotonic and process-wide, exactly like `Node`'s,
 * `BufferGeometry`'s, and `UnlitMaterial`'s — §33 forbids random or
 * clock-derived identity, and a counter makes two identical construction
 * sequences produce identical ids.
 */
let nextTextureId = 1;

function assignTextureId(): string {
  const id = `texture-${String(nextTextureId)}`;
  nextTextureId += 1;
  return id;
}

/** The source a disposed texture is left holding. */
const EMPTY_SOURCE: TextureSource = Object.freeze({ width: 1, height: 1 });

/**
 * Refuses a sampler-state value the backend has no meaning for (§85).
 *
 * **Refuses; never substitutes.** A misspelled `"nearset"` that quietly became
 * `"linear"` would be a texture sampled the wrong way with nothing anywhere
 * saying so — and the §85 rule this repository applies to every configuration
 * value is that a wrong one is louder than a plausible-looking rewrite.
 */
function validateEnum<T extends string>(
  value: T,
  legal: readonly T[],
  field: string,
): void {
  if (!legal.includes(value)) {
    throw new RangeError(
      `Texture ${field} must be one of ${legal.map((one) => JSON.stringify(one)).join(", ")}; ` +
        `got ${JSON.stringify(value)} (§77, §85).`,
    );
  }
}

/**
 * Layers / faces / slices a source holds: 1 for 2D, 6 for a cube, `depth` for
 * an array or volume. Throws `RangeError` when `depth` contradicts the kind
 * (§85) or a cube is not square.
 */
function layerCount(source: TextureSource): number {
  const kind = source.dimension ?? "2d";
  const depth = source.depth;
  if (kind === "2d" || kind === "cube") {
    const fixed = kind === "2d" ? 1 : 6;
    if (depth !== undefined && depth !== fixed) {
      throw new RangeError(
        `Texture depth for a ${kind} texture is ${String(fixed)}; got ` +
          `${String(depth)} (§77, §85).`,
      );
    }
    if (kind === "cube" && source.width !== source.height) {
      throw new RangeError(
        `A cube texture needs square faces; got ${String(source.width)}×` +
          `${String(source.height)} (§77, §85).`,
      );
    }
    return fixed;
  }
  if (depth === undefined || !Number.isInteger(depth) || depth < 1) {
    throw new RangeError(
      `A ${kind} texture needs an integer depth (layers/slices) of at least 1; ` +
        `got ${String(depth)} (§77, §85).`,
    );
  }
  return depth;
}

/** Runs the §85 checks for one source. Throws on the first violation. */
export function validateTextureSource(source: TextureSource): void {
  if (source.dimension !== undefined) {
    validateEnum(source.dimension, DIMENSIONS, "dimension");
  }
  if (source.colorSpace !== undefined) {
    validateColorSpace(source.colorSpace, "Texture");
  }
  if (source.role !== undefined) {
    // Caller mistake, same as a misspelled `filter`: RangeError via
    // `validateEnum`, not `NOT_IMPLEMENTED`. Both roles are implemented;
    // `"cube"` on `dimension` is the one that is named and refused.
    validateEnum(source.role, MAP_ROLES, "role");
  }
  if (source.filter !== undefined) {
    validateEnum(source.filter, FILTERS, "filter");
  }
  if (source.wrap !== undefined) {
    validateEnum(source.wrap, WRAPS, "wrap");
  }
  if (source.minFilter !== undefined) {
    validateEnum(source.minFilter, MIN_FILTERS, "minFilter");
    if (usesMipLevels(source.minFilter) && source.mipmaps !== true) {
      // GL leaves such a texture incomplete and samples it as opaque black —
      // a silent, whole-surface failure, which is precisely the class §85 says
      // to refuse rather than to substitute around (R-30b).
      throw new RangeError(
        `Texture minFilter ${JSON.stringify(source.minFilter)} samples between ` +
          "mip levels, so the texture needs `mipmaps: true`; without a mip " +
          "chain GL treats it as incomplete and samples it as black (§77, §85).",
      );
    }
  }
  if (
    source.anisotropy !== undefined &&
    (!Number.isInteger(source.anisotropy) || source.anisotropy < 1)
  ) {
    throw new RangeError(
      "Texture anisotropy must be an integer of at least 1; got " +
        `${String(source.anisotropy)} (§77, §85). A device that cannot honour a ` +
        "legal request is a §62 capability, and is clamped rather than refused.",
    );
  }
  for (const axis of ["width", "height"] as const) {
    const value = source[axis];
    if (!Number.isInteger(value) || value < 1) {
      throw new RangeError(
        `Texture ${axis} must be a finite integer of at least 1; got ` +
          `${String(value)} (§85).`,
      );
    }
  }

  const layers = layerCount(source);
  const data = source.data;
  if (data === undefined) {
    return;
  }
  const expected = source.width * source.height * layers * 4;
  if (data.length !== expected) {
    const kind = source.dimension ?? "2d";
    throw new RangeError(
      `A ${String(source.width)}×${String(source.height)} RGBA8 ${kind} texture ` +
        (kind === "2d" ? "" : `with ${String(layers)} layers/faces/slices `) +
        `needs ${String(expected)} bytes; got ${String(data.length)} ` +
        "(§77: four bytes per texel, tightly packed, layer 0 first).",
    );
  }
}

/**
 * A 2D RGBA8 texture (§77) — texel data, an identity, and a version.
 *
 * ```ts
 * const texture = new Texture({ width: 2, height: 2, data: bytes });
 * texture.data![0] = 255;   // in-place edit — invisible to the texture
 * texture.markDirty();      // announce it: version += 1, backends re-upload
 * texture.dispose();        // §83: explicit lifetime
 * ```
 *
 * ## Version, not events
 *
 * Backends cache GPU uploads per texture, keyed on {@link Texture.id} and
 * validated by {@link Texture.version}; regional dirty updates additionally
 * retain a bounded history for independent backend readers — the identical contract
 * `BufferGeometry` offers, and for the identical reason: a renderer that draws
 * a texture every frame compares a number, whereas a change event would cost a
 * subscription per texture per backend for no extra information. Assigning a new
 * {@link Texture.source} validates and bumps the version for you; editing the
 * byte array in place is the fast path and must be announced with
 * {@link Texture.markDirty}.
 *
 * ## Deferred from §77 (named, not dropped)
 *
 * Compressed containers. (Cube/array/3D uploads landed in WP-W5.2.) Render-target textures are implemented in
 * `render-target.ts`; host bitmap/video sources are in `host-texture.ts`, and
 * `Renderer.prepareTexture` waits for GPU completion with cache residency
 * diagnostics. Regional `markDirty` calls preserve allocations where supported.
 * Every one of them adds public state that a backend, the §79 scene format,
 * and §76's asset manager all have to agree on.
 *
 * **Wrap and filter modes left that list on 2026-08-13 (R-30)** — see
 * {@link TextureSource.filter} and {@link TextureSource.wrap}. They were the
 * cheapest member of it by a wide margin, because sampler state is set on the
 * texture object at upload time and read by nothing on the draw path: a
 * `texParameteri` argument became a variable, and no frame does one thing more
 * than it did.
 *
 * **Mipmaps and anisotropy left it on 2026-08-21 (R-30b)** — see
 * {@link TextureSource.mipmaps}, {@link TextureSource.minFilter} and
 * {@link TextureSource.anisotropy} — for the same reason and at the same cost:
 * one more upload-time GL call for the textures that ask, nothing at all for
 * the ones that do not, and no change anywhere on the draw path.
 *
 * **~~Map roles~~ left it on 2026-09-09 (R-30c, the tag)** — see
 * {@link TextureSource.role}. They are a colour/data annotation, not a
 * sampler-type change: a colour map can default its omitted `colorSpace` to
 * `"srgb"` without moving goldens that never set `role`. What is left on the
 * list are the members that are *not* upload-time state: a cube or array
 * target changes the sampler type in every shader that reads it, a compressed
 * container changes the upload call and needs a §62 format report. Video
 * frame notification and asynchronous upload completion now have separate
 * implemented entry points, without changing the CPU resource ownership model.
 */
export class Texture implements Disposable, SpriteTexture {
  /**
   * Stable identity (§77, §83), assigned at construction from a monotonic
   * counter and formatted `texture-<n>`. Unique within a process, ascending in
   * construction order, never reused.
   */
  readonly id: string = assignTextureId();

  #source: TextureSource;

  #version = 0;

  readonly #updates = new TextureUpdates();

  #disposed = false;

  constructor(source: TextureSource) {
    validateTextureSource(source);
    this.#source = source;
    noteTexture(1, this.byteLength);
    trackRenderDisposable(this, this.id);
  }

  /**
   * The texel data this texture holds.
   *
   * The source object and its `data` array are held **by reference**, not
   * copied: a rasterizer that produced the bytes hands over ownership, and a
   * backend uploads straight out of them. Assigning a new source validates it
   * (§85) and bumps {@link Texture.version}; editing the existing array in place
   * is legal and cheap, but invisible here — call {@link Texture.markDirty}.
   */
  get source(): TextureSource {
    return this.#source;
  }

  set source(value: TextureSource) {
    validateTextureSource(value);
    const before = this.byteLength;
    this.#source = value;
    noteTexture(0, this.byteLength - before);
    this.markDirty();
  }

  /** Width in texels. */
  get width(): number {
    return this.#source.width;
  }

  /** Height in texels. */
  get height(): number {
    return this.#source.height;
  }

  /**
   * §77 target kind. `"2d"` when the source names none. See {@link TextureSource.dimension}.
   */
  get dimension(): TextureDimension {
    return this.#source.dimension ?? "2d";
  }

  /**
   * Layers, faces or slices: 1 for 2D, 6 for a cube, the authored `depth` for
   * an array or volume.
   */
  get depth(): number {
    const kind = this.#source.dimension ?? "2d";
    if (kind === "2d") return 1;
    return kind === "cube" ? 6 : this.#source.depth!;
  }

  /**
   * Whether this texture is a colour map or a data map (§60a, §77; R-30c).
   * `null` when the source names none — see {@link TextureSource.role}. No
   * default is invented: omitting the field is how every pre-R-30c texture
   * keeps its dated `"linear"` colour space.
   */
  get role(): TextureMapRole | null {
    return this.#source.role ?? null;
  }

  /**
   * The colour space of the texels (§60a). Resolved here rather than left
   * optional so the backend reads one value and never repeats the `??`;
   * `MaterialTexture.colorSpace` stays optional because a test double and
   * every pre-R-15 texture satisfy it unchanged.
   *
   * **Authored `colorSpace` always wins.** When it is omitted:
   * {@link TextureSource.role} `"color"` resolves to `"srgb"`, and every
   * other case — `"data"`, or no role at all — stays `"linear"`, the dated
   * R-15 default. See {@link TextureSource.role} for the table.
   */
  get colorSpace(): ColorSpace {
    if (this.#source.colorSpace !== undefined) {
      return this.#source.colorSpace;
    }
    return this.#source.role === "color" ? "srgb" : "linear";
  }

  /**
   * How this texture is sampled between texel centres (§77; R-30), `"linear"`
   * when the source names none — see {@link TextureSource.filter}.
   *
   * Resolved here rather than left optional for `colorSpace`'s reason: the
   * backend reads one value and never repeats the `??`, while
   * `MaterialTexture.filter` stays optional so every pre-R-30 texture and every
   * test double satisfies the contract unchanged.
   *
   * **Sampler state is read at upload time.** Changing it on a texture the
   * backend has already uploaded therefore needs {@link Texture.markDirty} (or
   * a new {@link Texture.source}, which bumps the version for you) — the same
   * announcement an in-place texel edit needs, and for the same reason.
   */
  get filter(): TextureFilter {
    return this.#source.filter ?? "linear";
  }

  /**
   * How this texture is addressed outside `[0, 1]` (§77; R-30),
   * `"clamp-to-edge"` when the source names none — see
   * {@link TextureSource.wrap} and {@link Texture.filter}'s note on when a
   * change takes effect.
   */
  get wrap(): TextureWrap {
    return this.#source.wrap ?? "clamp-to-edge";
  }

  /**
   * Whether this texture carries a mip chain (§77; R-30b), `false` when the
   * source says nothing — see {@link TextureSource.mipmaps}.
   *
   * Like every other piece of sampler state, it is read at **upload** time:
   * turning it on for a texture a backend already holds needs
   * {@link Texture.markDirty} (or a new {@link Texture.source}).
   */
  get mipmaps(): boolean {
    return this.#source.mipmaps === true;
  }

  /**
   * How this texture is sampled when minified (§77; R-30b), **derived** when
   * the source names none: {@link Texture.filter} without a mip chain, and its
   * chain-aware form with one — see {@link TextureSource.minFilter}.
   *
   * Resolved here for {@link Texture.filter}'s reason: the backend reads one
   * value and repeats no `??`, and a texture that predates the field resolves
   * to exactly the value the backend wrote before it existed.
   */
  get minFilter(): TextureMinFilter {
    const named = this.#source.minFilter;
    if (named !== undefined) {
      return named;
    }
    const filter = this.filter;
    if (!this.mipmaps) {
      return filter;
    }
    return filter === "nearest"
      ? "nearest-mipmap-nearest"
      : "linear-mipmap-linear";
  }

  /**
   * How many anisotropic samples this texture asks for (§77; R-30b), `1` when
   * the source names none.
   *
   * A **request**: the backend clamps it to the device maximum and ignores it
   * where `EXT_texture_filter_anisotropic` is absent — see
   * {@link TextureSource.anisotropy} for why that is §62's answer rather than
   * §85's.
   */
  get anisotropy(): number {
    return this.#source.anisotropy ?? 1;
  }

  /**
   * The RGBA8 bytes, or `null` when the source carries none.
   *
   * A flat accessor rather than `source.data` because it is the field a backend
   * reads on the upload path, and because `SpriteMaterial`'s `SpriteTexture`
   * contract — the seam through which a backend actually sees a texture — is
   * expressed in terms of it. `null` rather than `undefined` for the same
   * reason: the contract is "there is no data", and a backend narrows it with
   * one comparison.
   */
  get data(): Uint8Array | null {
    return this.#source.data ?? null;
  }

  /**
   * Counter incremented on every mutation (§77). Backends cache GPU uploads
   * against it; treat it as opaque and compare for inequality, exactly like
   * `Transform.version`. Monotonic, never wraps in a realistic session.
   */
  get version(): number {
    return this.#version;
  }

  /** Whether {@link Texture.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Bytes this texture describes (§83, §84's `textureMemory`) — four per texel
   * at the current size, which is what an RGBA8 upload costs.
   *
   * ```ts
   * new Texture({ width: 256, height: 256 }).byteLength; // 262144
   * ```
   *
   * Counted from the **size**, not from `data`: a source with no CPU-side bytes
   * still makes the backend allocate zero-filled storage of exactly this size
   * (see {@link TextureSource.data}), so billing it zero would under-report the
   * memory the engine holds.
   *
   * **Mip levels count** since R-30b (2026-08-21): a texture with
   * `mipmaps: true` bills the whole chain, summed level by level down to 1 × 1
   * — about a third more, and exactly a third more only for a square
   * power-of-two texture, which is why it is summed rather than multiplied by
   * `4/3`. A texture with no chain is unchanged, so no existing §84 number
   * moves.
   *
   * ```ts
   * new Texture({ width: 4, height: 4, mipmaps: true }).byteLength;
   * // 64 + 16 + 4 = 84
   * ```
   *
   * **`0` once disposed**, because a disposed texture holds nothing — one rule,
   * so that a write into a disposed texture (already a §83 "disposed resource
   * still in use" mistake) cannot resurrect its bytes in the process-wide
   * totals.
   */
  get byteLength(): number {
    if (this.#disposed) {
      return 0;
    }
    return textureChainBytes(
      this.#source.width,
      this.#source.height,
      this.depth,
      this.dimension,
      this.mipmaps,
    );
  }

  /**
   * Announces a mutation the texture could not see — an in-place write into
   * `source.data`. Bumps {@link Texture.version} by one, which invalidates every
   * backend upload keyed on it.
   *
   * Calling it after assigning {@link Texture.source} is harmless, only
   * wasteful: the version advances again and the texture re-uploads once more.
   */
  markDirty(region?: Rectangle2): void {
    if (region !== undefined && this.dimension !== "2d") {
      throw new RangeError(
        `Regional markDirty is 2D only; a ${this.dimension} texture re-uploads ` +
          "whole (§77, R-30c).",
      );
    }
    this.#updates.add(
      this.#version + 1,
      region ?? null,
      this.width,
      this.height,
    );
    this.#version += 1;
  }

  /** Changed texels since a backend version, or null when a full upload is needed. */
  getDirtyRegion(sinceVersion: number): Rectangle2 | null {
    return this.#updates.since(sinceVersion, this.#version);
  }

  /**
   * Releases this texture's CPU-side data (§83). Idempotent.
   *
   * The byte array is dropped — a 2048² atlas is 16 MB, and its owner should be
   * able to reclaim that the moment nothing needs it — and the version is bumped
   * so any backend cache keyed on it re-reads. A backend that then meets this
   * texture in a render list **skips the draw**: {@link Texture.disposed} is the
   * flag the §83 "disposed resource still in use" diagnostic checks, and drawing
   * a sprite with no texels would paint undefined content rather than report the
   * mistake.
   *
   * Disposing does **not** notify the materials pointing at this texture;
   * ownership is explicit and upwards (§83), so whoever created the texture
   * decides when nothing needs it any more.
   *
   * It **does** remove this texture and its bytes from the process-wide §83
   * totals (`textureMemoryBytes`, `liveTextureCount`), exactly once: the
   * idempotence guard above is what makes a double `dispose()` subtract once
   * rather than twice.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    const before = this.byteLength;
    this.#disposed = true;
    this.#source = EMPTY_SOURCE;
    noteTexture(-1, -before);
    releaseRenderDisposable(this);
    this.markDirty();
  }
}
