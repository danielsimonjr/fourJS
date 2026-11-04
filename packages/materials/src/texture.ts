/**
 * The read surface of a texture as a **material** and a rendering backend see
 * it (§77) — implemented by `@fourjs/render`'s `Texture`.
 *
 * ## Why the contract is declared here (decision, WP-3a.3, widened by R-19)
 *
 * The concrete `Texture` class lives in `@fourjs/render`, because a texture is a
 * renderer resource (§61, §77) and `@fourjs/render` is where the renderer
 * interface lives. But the dependency matrix (plan §3.1, frozen) puts
 * `materials` *below* `render` — `render` depends on `materials`, never the
 * other way round — so this package cannot import that class.
 *
 * So the **contract** is declared here and `@fourjs/render`'s `Texture` declares
 * `implements SpriteTexture`: the compiler checks the two agree, the dependency
 * edge stays pointing the one legal way, and a caller writes
 * `new SpriteMaterial({ texture })` or `new UnlitMaterial({ map })` with a real
 * `Texture` and never sees the seam. It is the same technique
 * `@fourjs/render-webgl` uses for the GL context it does not own, one layer down.
 *
 * It lives in a module of its own since R-19 (2026-08-07), when
 * `UnlitMaterial.map` and `LitMaterial.map` made it the *family's* texture
 * contract rather than the sprite's: it was declared in `sprite-material.ts`
 * while sprites were the only textured pipeline, and `SpriteTexture` remains
 * exported from there, as an alias, because it is a published name.
 *
 * {@link MaterialTexture} describes the texture's whole **read** surface, not
 * only the parts a material touches: a backend reaches the texture *through*
 * the material (`item.material.map`), so anything the upload path needs — the
 * texel data above all — has to be visible here.
 *
 * ## Ownership (§83)
 *
 * A material **points at** its texture; it does not own it. One texture atlas
 * routinely backs hundreds of materials, so `Material.dispose()` deliberately
 * does *not* dispose the texture: whoever created the texture disposes it.
 * Tearing it out from under its other users is exactly the bug the ownership
 * rule exists to prevent. This is the same rule `Renderable` follows for its
 * geometry and material.
 */

import type { ColorSpace, Rectangle2 } from "@fourjs/math";

/**
 * How a texture is sampled between texel centres (§77's "filter modes"; R-30,
 * 2026-08-13) — the read side of `@fourjs/render`'s `TextureFilter`.
 *
 * Two values because a texture with one mip level has no choice to make between
 * levels: §77's remaining filter modes (`*_MIPMAP_*`) name exactly that choice.
 * They arrived with mipmaps on 2026-08-21 (R-30b) — on
 * {@link MaterialTextureMinFilter}, the *minification* side, which is the only
 * side that has mip levels in it. This type is unchanged and still means "both
 * directions, unless the min side is overridden".
 */
export type MaterialTextureFilter = "nearest" | "linear";

/**
 * How a texture is sampled when **minified** — the direction that has mip
 * levels in it (§77's remaining filter modes; R-30b, 2026-08-21).
 *
 * The union is {@link MaterialTextureFilter} plus GL's four mip-choosing modes,
 * spelled `<in-level>-mipmap-<between-levels>`:
 *
 * | value | within a level | between levels |
 * | --- | --- | --- |
 * | `"nearest-mipmap-nearest"` | point | pick one |
 * | `"linear-mipmap-nearest"` | bilinear | pick one |
 * | `"nearest-mipmap-linear"` | point | blend two |
 * | `"linear-mipmap-linear"` | bilinear | blend two (trilinear) |
 *
 * A mip-choosing value is only meaningful on a texture that *has* a mip chain:
 * GL leaves a texture with one level and a `*_MIPMAP_*` min filter **incomplete**
 * — it samples as opaque black — which is why `@fourjs/render`'s `Texture` refuses
 * the combination (§85) rather than letting a scene go silently black.
 *
 * There is deliberately **no** `magFilter`: magnification cannot use mip levels
 * (GL accepts only `NEAREST`/`LINEAR` there), so the pair `minFilter` and
 * `magFilter` would be a split in which one half could never carry the four
 * values that motivated the split. {@link MaterialTexture.filter} *is* the
 * magnification filter, and the default for minification too.
 */
export type MaterialTextureMinFilter =
  | MaterialTextureFilter
  | "nearest-mipmap-nearest"
  | "linear-mipmap-nearest"
  | "nearest-mipmap-linear"
  | "linear-mipmap-linear";

/**
 * How a texture is addressed outside `[0, 1]` (§77's "wrap modes"; R-30,
 * 2026-08-13) — the read side of `@fourjs/render`'s `TextureWrap`.
 *
 * One value for both axes: a per-axis split is meaningful, but nothing in the
 * engine authors anisotropic addressing today and a field with no reader is a
 * field that goes wrong silently. It widens to `wrapS`/`wrapT` without moving
 * this one, because `wrap` is exactly "both axes".
 */
export type MaterialTextureWrap =
  "clamp-to-edge" | "repeat" | "mirrored-repeat";

/**
 * The read surface of a texture, as a material and a rendering backend see it
 * (§77) — see the module header for why it is declared in this package rather
 * than imported from the package that owns the class.
 *
 * Everything is `readonly`: a material and a backend observe a texture, they
 * never edit one. Mutation goes through the concrete class, which is what
 * advances {@link MaterialTexture.version}.
 */
export interface MaterialTexture {
  /** Union of changed texels since a backend version; null requires a full upload. */
  getDirtyRegion?(sinceVersion: number): Rectangle2 | null;
  /**
   * Stable identity (§83's resource model). Backends key their upload caches on
   * it and validate the entry with {@link MaterialTexture.version}, exactly as
   * they do for `BufferGeometry`.
   */
  readonly id: string;

  /** Counter advanced by every mutation; the cache-invalidation key (§53, §77). */
  readonly version: number;

  /** Width in texels. */
  readonly width: number;

  /** Height in texels. */
  readonly height: number;

  /**
   * Target kind (§77, R-30c). Absent means `"2d"`. A backend binds a
   * non-`"2d"` texture only through its explicit resource path, never as a
   * sprite or unlit map: the sampler type differs (cube, 2d-array, 3d).
   */
  readonly dimension?: "2d" | "cube" | "array" | "3d";

  /**
   * Layer count: `6` for `"cube"` (faces +X, -X, +Y, -Y, +Z, -Z), the array
   * length for `"array"`, the slice count for `"3d"`; absent means `1`.
   * `data` then holds `depth` tightly packed `width * height * 4` images,
   * layer 0 first.
   */
  readonly depth?: number;

  /**
   * Tightly packed RGBA8 texels — four bytes per texel, `width * height * 4`
   * bytes — or `null` when the texture carries no CPU-side data.
   *
   * **Row 0 is `v = 0`**, i.e. the bottom row in the Y-up convention of §7a and
   * in GL's default unpack orientation. A source whose first row is the *top*
   * one (an `ImageBitmap`, a decoded PNG) is flipped by whoever adapts it, not
   * here — see `@fourjs/render`'s `TextureSource` for the note on where those
   * sources land.
   */
  readonly data: Uint8Array | null;

  /** Whether the texture has been disposed (§83). */
  readonly disposed: boolean;

  /**
   * The colour space the texels are in — §60a's texture metadata, read by the
   * backend on the upload path (R-15, 2026-08-08).
   *
   * **Optional, and absent means `"linear"`.** §60a says colour textures
   * *default* to sRGB-encoded; this tier defaults them to linear instead, and
   * the deviation is deliberate and dated: flipping the default would change
   * what every already-authored texture in the engine looks like — every pixel
   * golden with it — for scenes that never asked for colour management. An
   * author who has sRGB-encoded texels (a decoded PNG, an authored albedo map)
   * says so with `colorSpace: "srgb"` and the backend decodes on sample; the
   * §60a-conformant default is an owner decision, recorded with R-15.
   *
   * Optional rather than required so that a test double, a procedurally
   * generated atlas, and every texture written before this field existed keep
   * satisfying the contract without a line of change. Read it as
   * `texture.colorSpace ?? "linear"`.
   */
  readonly colorSpace?: ColorSpace;

  /**
   * How the backend samples between texel centres (§77; R-30, 2026-08-13).
   *
   * **Optional, and absent means `"linear"`** — the value this tier hard-coded
   * before the field existed, so every texture written against an earlier build
   * and every test double keeps issuing the identical `texParameteri` pair.
   * Read it as `texture.filter ?? "linear"`, exactly as
   * {@link MaterialTexture.colorSpace} is read.
   *
   * `"nearest"` is what a bitmap glyph atlas and pixel art want: a texel drawn
   * at or above 1:1 stays a square instead of being blurred across its
   * neighbours.
   */
  readonly filter?: MaterialTextureFilter;

  /**
   * How the backend addresses texture coordinates outside `[0, 1]` (§77;
   * R-30, 2026-08-13).
   *
   * **Optional, and absent means `"clamp-to-edge"`** — this tier's previous
   * fixed choice, for {@link MaterialTexture.filter}'s reason. Read it as
   * `texture.wrap ?? "clamp-to-edge"`.
   */
  readonly wrap?: MaterialTextureWrap;

  /**
   * Whether the texture carries a full mip chain (§77's "mipmaps"; R-30b,
   * 2026-08-21).
   *
   * **Optional, and absent means `false`** — no chain, exactly the one level
   * this contract described before the field existed, so every texture and test
   * double written earlier uploads the identical call sequence.
   *
   * `true` asks the backend to build the chain at upload time (WebGL 2's
   * `generateMipmap`, which needs no power-of-two size). What the chain is
   * *for* is minification: a 512² texture drawn across twenty pixels samples
   * twenty of its half-million texels without one, which is the shimmer that
   * appears when the camera moves.
   */
  readonly mipmaps?: boolean;

  /**
   * How the backend samples when the texture is **minified** (§77; R-30b,
   * 2026-08-21).
   *
   * **Optional, and absent means "derived"**: without
   * {@link MaterialTexture.mipmaps} it is {@link MaterialTexture.filter}, which
   * is what this contract always meant; with them it is that filter's
   * mip-chain-aware form (`"linear"` → `"linear-mipmap-linear"`, i.e.
   * trilinear). Read it as the concrete class resolves it, or as
   * `texture.minFilter ?? texture.filter ?? "linear"` if the texture is known
   * to carry no chain.
   */
  readonly minFilter?: MaterialTextureMinFilter;

  /**
   * How many anisotropic samples the backend may take (§77's "anisotropy";
   * R-30b, 2026-08-21). An integer ≥ 1.
   *
   * **Optional, and absent means `1`** — isotropic filtering, GL's own default
   * and this contract's previous fixed behaviour.
   *
   * Anisotropic filtering is an *extension* in WebGL 2
   * (`EXT_texture_filter_anisotropic`), so this is a **request, not a
   * guarantee**: a backend clamps it to what the device reports and ignores it
   * entirely where the extension is absent. That is §62's capability tiering
   * rather than §85's refusal — a value the driver merely cannot honour is not
   * an authoring mistake, and refusing it would make the same scene unrunnable
   * on a conformant device. A non-integer or a value below 1 *is* an authoring
   * mistake, and the concrete class refuses it.
   */
  readonly anisotropy?: number;
}
