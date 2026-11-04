/**
 * `StandardMaterial` (§59) — the metallic-roughness workflow, at the tier this
 * engine can honestly shade today.
 *
 * §59 is one sentence and one constructor:
 *
 * ```ts
 * const material = new Four.StandardMaterial({
 *     baseColor: "#a0a0a0",
 *     roughness: 0.6,
 *     metalness: 0.1,
 *     normalMap,
 *     occlusionMap,
 *     emissive: "#000000"
 * });
 * ```
 *
 * — *"StandardMaterial shall implement a metallic-roughness workflow compatible
 * with glTF conventions"* — plus a list of later physical extensions
 * (clearcoat, transmission, IOR, sheen, anisotropy, subsurface, iridescence)
 * that §57 puts on `PhysicalMaterial` above this class.
 *
 * ## What ships, and what is staged with the reason (R-13, 2026-08-08)
 *
 * | §59 names            | here                                            |
 * | -------------------- | ----------------------------------------------- |
 * | `baseColor`          | {@link StandardMaterial.baseColor} (+ optional {@link StandardMaterial.map}) |
 * | `metalness`          | {@link StandardMaterial.metalness} (+ optional packed {@link StandardMaterial.metalRoughnessMap}) |
 * | `roughness`          | {@link StandardMaterial.roughness} (+ the same packed map) |
 * | `emissive`           | {@link StandardMaterial.emissive} (+ optional {@link StandardMaterial.emissiveMap}) |
 * | `normalMap`          | WebGL tangent-space map using a derivative tangent frame |
 * | `occlusionMap`       | WebGL red-channel ambient occlusion |
 *
 * Normal and occlusion textures use linear data, and the geometry's first UV
 * set. Degenerate UVs preserve the geometric normal. Occlusion affects only
 * indirect diffuse lighting; direct lights and emission remain unoccluded.
 * The normal, occlusion and emissive textures sample on both WebGL 2 and
 * WebGPU (the latter through a widened surface bind group).
 *
 * §59's seven physical extensions are `PhysicalMaterial`'s (§57's family puts it
 * above this class) and are not sketched here.
 *
 * ## The BRDF tier, stated (§59, §68)
 *
 * The shading model is real metallic-roughness — Cook-Torrance with a GGX
 * (Trowbridge-Reitz) normal distribution, a height-correlated Smith visibility
 * term, and a Schlick Fresnel over `F0 = mix(0.04, baseColor, metalness)` —
 * evaluated against the **one** directional light and the scene ambient term
 * §68's MVP tier collects (`@fourjs/render`'s `lights.ts`). One light is not a
 * limitation of this material: multi-light needs §68's uniform arrays or its
 * clustered path, staged where `@fourjs/scene`'s `light.ts` records it. A
 * Lambert-versus-GGX difference under one light is still the difference between
 * a plastic and a metal, which is what §59 is for.
 *
 * There is **no image-based lighting**, so a fully metallic surface has nothing
 * to reflect: metals carry no diffuse lobe, and with no environment the ambient
 * term contributes nothing to them. `metalness: 1` under ambient light alone
 * therefore renders black. That is the physically honest answer rather than a
 * bug, and §68's "environment lighting; image-based lighting" is what changes
 * it.
 *
 * ## Colour space (§60a) — the same linear working space `LitMaterial` uses
 *
 * **Superseded 2026-08-08 by R-15.** This block used to read "no colour space
 * attached … tagging a space here would pin half of R-15's design by accident",
 * and that deferral is now resolved rather than still open: §60a's working-space
 * policy is written down (`@fourjs/math`'s `color.ts` module header), and it says
 * these numbers **are linear-light**. Nothing about the values changed — the
 * BRDF multiplied them as linear before the policy existed and multiplies them
 * as linear now — but the space is no longer *untagged*: it is named, and the
 * one thing it was waiting for, an encode on the way out, exists as
 * `@fourjs/render`'s `OutputTransformEffect`.
 *
 * What is unchanged, and stays: no per-material colour-space field. §60a puts
 * its metadata on *resources* — textures (§77) and render targets (§63) — and a
 * material colour is a working-space value by definition, so a tag here would
 * have exactly one legal value. Values outside 0…1 still pass through rather
 * than clamp (the WP-3.3 decision `UnlitMaterial` records), which is how an HDR
 * emissive is authored; non-finite values are still rejected (§85).
 *
 * The match with `LitMaterial` is deliberate, not an oversight: the standard and
 * lit pipelines write straight (non-premultiplied) alpha into the same
 * framebuffer, so the two families **compose in one scene** — a
 * `StandardMaterial` sphere beside a `LitMaterial` floor is shaded in one space
 * and blended by one rule. R-15 moved both at once, as this block promised:
 * neither family encodes its own output, because §60a makes the transform the
 * *final render-graph pass*, not a per-material step.
 *
 * Tone mapping (§68) is still staged — it is the other half of §60a's output
 * transform and needs the HDR float targets R-4 staged; `@fourjs/render`'s
 * `effect-pass.ts` carries the reason.
 *
 * ## Putting one on a node (§49)
 *
 * `new Renderable(geometry, new StandardMaterial())` infers
 * `Renderable<StandardMaterial>` and needs nothing said. A variable *annotated*
 * as a bare `Renderable` is a different thing: that type parameter defaults to
 * `@fourjs/render`'s `SurfaceMaterial`, deliberately still `UnlitMaterial |
 * LitMaterial`, and §59's member is not in it. Widening that union would take
 * `color` and `setColor` off every ordinary renderable's material — the exact
 * argument `renderable.ts` records for keeping `SpriteMaterial` out of it, and
 * it applies unchanged to a base colour. Name the parameter
 * (`Renderable<StandardMaterial>`, or `Renderable<Material>` for a node whose
 * material is swapped between families) and nothing else changes: the render
 * list picks the pipeline off the material's own `kind`, never off the node's
 * type (R-13, 2026-08-08).
 *
 * ## CSS colour strings (§59's own example, R-15, 2026-08-08)
 *
 * `baseColor: "#a0a0a0"` still does not compile against this class — but the
 * parser it needs now exists, and the reason the option is not widened is a
 * spec citation rather than an absence:
 *
 * ```ts
 * const baseColor: ColorRGBA = [0, 0, 0, 1];
 * srgbToLinearRGBA(parseColor("#a0a0a0"), baseColor);   // @fourjs/math
 * new StandardMaterial({ baseColor });                  // §59's example, today
 * ```
 *
 * §60a says a CSS string denotes an **sRGB** value and the pipeline is
 * linear-light, so a string can never be assigned to a working-space slot
 * without the decode above. §101's shipped-name mapping then settles where the
 * decode lives: "Colors are linear RGBA arrays in 0..1 (§60a), **not CSS
 * strings**". Widening these options to `ColorRGBA | string` contradicts that
 * row, so R-15 left it to the owner and shipped the two functions that make the
 * conversion one line (recorded 2026-08-08).
 */

import type { ColorRGB, ColorRGBA } from "@fourjs/math";

import { Material, type MaterialOptions } from "./material.js";
import type { MaterialTexture } from "./texture.js";

/**
 * Straight RGB, each component nominally in 0…1 — `@fourjs/math`'s
 * {@link ColorRGB}, re-exported beside `UnlitMaterial`'s `ColorRGBA` (hoisted
 * 2026-08-08 by R-15's colour packet).
 *
 * The type {@link StandardMaterial.emissive} carries, and the type §68's light
 * colours carry: the colours with no opacity of their own.
 */
export type { ColorRGB } from "@fourjs/math";

/**
 * Construction arguments of {@link StandardMaterial} — §59's own parameters,
 * plus §57's shared render state from {@link MaterialOptions}.
 */
export interface StandardMaterialOptions extends MaterialOptions {
  /**
   * Initial {@link StandardMaterial.baseColor}, copied into the material's own
   * array. Defaults to opaque white `[1, 1, 1, 1]`, so an untinted surface
   * shows the lighting and the base colour map alone.
   */
  baseColor?: readonly [number, number, number, number];

  /**
   * Initial {@link StandardMaterial.map} — the base colour (albedo) texture
   * sampled with the geometry's `uvs` (§53, §77). Defaults to `null`.
   */
  map?: MaterialTexture | null;

  /**
   * Initial {@link StandardMaterial.metalRoughnessMap} — glTF's packed
   * metallic-roughness texture (G = roughness, B = metalness). Defaults to
   * `null`.
   */
  metalRoughnessMap?: MaterialTexture | null;

  /**
   * Initial {@link StandardMaterial.emissiveMap} — glTF's emissive texture
   * (sRGB, multiplied by {@link StandardMaterial.emissive}). Defaults to
   * `null`.
   */
  emissiveMap?: MaterialTexture | null;

  /** Linear tangent-space normal texture (WebGL); defaults to null. */
  normalMap?: MaterialTexture | null;

  /** Linear red-channel ambient occlusion texture (WebGL); defaults to null. */
  occlusionMap?: MaterialTexture | null;

  /** Tangent-space normal XY scale; defaults to 1. */
  normalScale?: number;

  /** Ambient occlusion strength; nominally 0–1, defaults to 1. */
  occlusionStrength?: number;

  /**
   * Initial {@link StandardMaterial.metalness}; defaults to `0` (a dielectric).
   */
  metalness?: number;

  /**
   * Initial {@link StandardMaterial.roughness}; defaults to `1` (fully rough).
   */
  roughness?: number;

  /**
   * Initial {@link StandardMaterial.emissive}, copied into the material's own
   * array. Defaults to black `[0, 0, 0]` — §59's own example writes
   * `emissive: "#000000"` — so an unlit-from-within surface emits nothing.
   */
  emissive?: readonly [number, number, number];
}

/**
 * The prefix this family member's ids carry. The counter behind it is the
 * family-wide one in `material.ts` — one counter, one prefix per member, so two
 * members can never mint a colliding cache key (§33).
 */
const ID_PREFIX = "standard-material";

/** Rejects non-finite colour components (§85). */
function requireFiniteColor(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `Color component ${name} must be finite; got ${String(value)} ` +
        "(§85: NaN and infinite values).",
    );
  }
  return value;
}

/**
 * Rejects a non-finite metallic-roughness scalar (§85).
 *
 * **Finite, not in-range.** Both scalars are documented as 0…1 and are *not*
 * clamped, following the decision `UnlitMaterial` records for colour
 * components: clamping silently rewrites authored data, and a value outside the
 * range is a legible mistake (a surface that shades wrong) rather than a
 * corrupted material. A `NaN` is neither — it propagates into `uniform1f` and
 * paints the surface black with nothing to point at — so that one is rejected
 * where the assignment is still on the stack, exactly as `Material.opacity`
 * rejects it (F14).
 */
function requireFiniteScalar(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `StandardMaterial ${name} must be finite; got ${String(value)} ` +
        "(§85: NaN and infinite values).",
    );
  }
  return value;
}

/**
 * A physically based surface: metallic-roughness, shaded by the scene's lights
 * (§57, §59, §68).
 *
 * ```ts
 * const gold = new StandardMaterial({
 *   baseColor: [1, 0.77, 0.34, 1],
 *   metalness: 1,
 *   roughness: 0.25,
 * });
 * const mesh = new Renderable(sphereGeometry(), gold);
 * ```
 *
 * A `Renderable` carrying one produces a `"standard"` render item and draws
 * through the standard pipeline. Like `LitMaterial` it needs the scene to
 * supply the light: with no directional light it shades from the ambient term
 * alone, and a geometry without a `normals` attribute has no surface to shade
 * against and falls back to that same ambient term (see
 * `@fourjs/render-webgl`'s standard fragment stage).
 *
 * `StandardMaterial` sits **above** `LitMaterial` in §57's family, not
 * beside it: the lit tier is one Lambert lobe times a colour, this one is a
 * diffuse and a specular lobe with a Fresnel between them. The two shade in the
 * same space and blend by the same rule (see the module header), so mixing them
 * in one scene is supported and cheap — the cost of a second surface family is
 * one pipeline switch where the render list changes `kind`.
 *
 * Materials are **shared, not owned by nodes** (§83): any number of
 * `Renderable`s may point at one, and disposing it is the job of whoever
 * created it.
 */
export class StandardMaterial extends Material {
  /**
   * Pipeline discriminant (§57, §64, §66 sort key 3) — see `UnlitMaterial.kind`
   * for why this is a literal string rather than an `instanceof`.
   */
  readonly kind = "standard" as const;

  /**
   * The surface's base colour — glTF's `baseColorFactor` — as straight RGBA in
   * 0…1; opaque white by default.
   *
   * For a dielectric (`metalness: 0`) this is the diffuse albedo; for a metal
   * (`metalness: 1`) it is the specular reflectance `F0`, and the diffuse lobe
   * vanishes. That single field doing two jobs *is* the metallic-roughness
   * workflow, and it is why §59 names one colour rather than a diffuse and a
   * specular one.
   *
   * The array instance is `readonly` — write *into* it — for the reason
   * `UnlitMaterial.color` documents: a backend may keep a reference to it. Use
   * {@link StandardMaterial.setBaseColor}, or write components directly and
   * call {@link Material.markDirty}.
   */
  readonly baseColor: ColorRGBA;

  /**
   * Light this surface emits regardless of the scene's lights (§59), straight
   * RGB; black `[0, 0, 0]` by default, which is §59's own example value.
   *
   * Added to the shaded result **after** both lobes and unaffected by
   * `metalness`, `roughness`, or the ambient term, so an emissive surface reads
   * the same whatever is lighting it. It does not illuminate anything else —
   * that is §68's environment lighting, and light emitted by geometry needs the
   * global-illumination path §69/§68 stage.
   *
   * Components pass through unclamped (see the module header), which is how an
   * HDR emissive is authored today: `[4, 2, 1]` is a value four times over
   * white, waiting for the tone mapping §60a stages. The array instance is
   * `readonly` for the same reason {@link StandardMaterial.baseColor}'s is.
   *
   * The type is {@link ColorRGB} — `@fourjs/math`'s alias, hoisted there
   * 2026-08-08 by R-15's colour packet exactly as this note asked (the tuple was
   * written out inline until then, because a second own-definition of the name
   * is what the duplicate-symbol gate exists to refuse and `@fourjs/scene`'s copy
   * was unreachable across the frozen §3.1 matrix). `@fourjs/scene`'s `ColorRGB`
   * is now the same declaration, re-exported.
   */
  readonly emissive: ColorRGB;

  #map: MaterialTexture | null;

  #metalRoughnessMap: MaterialTexture | null;

  #emissiveMap: MaterialTexture | null;

  #normalMap: MaterialTexture | null;

  #occlusionMap: MaterialTexture | null;
  #normalScale: number;
  #occlusionStrength: number;

  #metalness: number;

  #roughness: number;

  constructor(options: StandardMaterialOptions = {}) {
    super(ID_PREFIX, options);
    const baseColor = options.baseColor ?? [1, 1, 1, 1];
    this.baseColor = [
      requireFiniteColor("red", baseColor[0]),
      requireFiniteColor("green", baseColor[1]),
      requireFiniteColor("blue", baseColor[2]),
      requireFiniteColor("alpha", baseColor[3]),
    ];
    const emissive = options.emissive ?? [0, 0, 0];
    this.emissive = [
      requireFiniteColor("emissive red", emissive[0]),
      requireFiniteColor("emissive green", emissive[1]),
      requireFiniteColor("emissive blue", emissive[2]),
    ];
    this.#map = options.map ?? null;
    this.#metalRoughnessMap = options.metalRoughnessMap ?? null;
    this.#emissiveMap = options.emissiveMap ?? null;
    this.#normalMap = options.normalMap ?? null;
    this.#occlusionMap = options.occlusionMap ?? null;
    this.#normalScale = requireFiniteScalar(
      "normalScale",
      options.normalScale ?? 1,
    );
    this.#occlusionStrength = requireFiniteScalar(
      "occlusionStrength",
      options.occlusionStrength ?? 1,
    );
    this.#metalness = requireFiniteScalar("metalness", options.metalness ?? 0);
    this.#roughness = requireFiniteScalar("roughness", options.roughness ?? 1);
  }

  /**
   * The base colour (albedo) texture this material samples with the geometry's
   * `uvs`, or `null` for an untextured surface (§53, §59, §77).
   *
   * The sampled texel **multiplies {@link StandardMaterial.baseColor} before
   * the BRDF**, so it is an albedo and the lights shade it — identical in
   * meaning and in cost to `LitMaterial.map`:
   *
   * ```text
   * base = baseColor × texture(map, uv)
   * ```
   *
   * The packed metallic-roughness map ({@link StandardMaterial.metalRoughnessMap})
   * is a second unit, not a second meaning for this one.
   *
   * Assigning bumps {@link Material.version}. Ownership, disposal, and the
   * uv-less-geometry behaviour are exactly `UnlitMaterial.map`'s — see it.
   */
  get map(): MaterialTexture | null {
    return this.#map;
  }

  set map(value: MaterialTexture | null) {
    this.#map = value;
    this.markDirty();
  }

  /**
   * Packed metallic-roughness texture sampled with the geometry's `uvs`, or
   * `null` (§59, glTF 2.0 `metallicRoughnessTexture`).
   *
   * glTF stores **roughness in G and metalness in B**; R and A are unused at
   * this tier. The sampled channels **multiply the scalar factors**.
   * Sampled on WebGL 2 (unit 2) and on WebGPU (group 3 when albedo occupies
   * group 2, otherwise group 2).
   */
  get metalRoughnessMap(): MaterialTexture | null {
    return this.#metalRoughnessMap;
  }

  set metalRoughnessMap(value: MaterialTexture | null) {
    this.#metalRoughnessMap = value;
    this.markDirty();
  }

  /**
   * Emissive colour texture sampled with the geometry's `uvs`, or `null`
   * (§59, glTF 2.0 `emissiveTexture`).
   *
   * The sampled RGB **multiplies {@link StandardMaterial.emissive}** (glTF:
   * factor × texture). Authored sRGB; WebGL uploads it as `SRGB8_ALPHA8` so
   * the sampler linearizes it. **Sampled on WebGL 2** (unit 3). **Unsampled
   * on WebGPU** this slice: groups 2 and 3 already hold albedo and
   * metallic-roughness when both maps exist, and the four-group budget is
   * full (`wgpu-standard.ts`).
   *
   * Assigning bumps {@link Material.version}. Ownership and disposal are
   * {@link StandardMaterial.map}'s.
   */
  get emissiveMap(): MaterialTexture | null {
    return this.#emissiveMap;
  }

  set emissiveMap(value: MaterialTexture | null) {
    this.#emissiveMap = value;
    this.markDirty();
  }

  /** Linear tangent-space normals sampled on WebGL using UV derivatives. */
  get normalMap(): MaterialTexture | null {
    return this.#normalMap;
  }

  set normalMap(value: MaterialTexture | null) {
    this.#normalMap = value;
    this.markDirty();
  }

  /** Red-channel ambient occlusion; does not attenuate direct light or emission. */
  get occlusionMap(): MaterialTexture | null {
    return this.#occlusionMap;
  }

  set occlusionMap(value: MaterialTexture | null) {
    this.#occlusionMap = value;
    this.markDirty();
  }

  /** Scales tangent-space normal X/Y before normalization; defaults to 1. */
  get normalScale(): number {
    return this.#normalScale;
  }

  set normalScale(value: number) {
    this.#normalScale = requireFiniteScalar("normalScale", value);
    this.markDirty();
  }

  /** Blends between unoccluded (0) and the texture's red channel (1). */
  get occlusionStrength(): number {
    return this.#occlusionStrength;
  }

  set occlusionStrength(value: number) {
    this.#occlusionStrength = requireFiniteScalar("occlusionStrength", value);
    this.markDirty();
  }

  /**
   * How metallic the surface is (§59) — glTF's `metallicFactor`, nominally
   * `0` (dielectric) to `1` (conductor); **`0` by default**.
   *
   * It moves two things at once, which is the whole of the metallic workflow:
   * the diffuse lobe is scaled by `1 − metalness`, and the specular reflectance
   * `F0` is interpolated from a dielectric's 4% toward
   * {@link StandardMaterial.baseColor}. A metal is therefore a surface with no
   * diffuse colour whose *reflection* is tinted.
   *
   * The default is `0`, not glTF's file-format default of `1`: `new
   * StandardMaterial()` should be the surface the material one tier down
   * (`LitMaterial`) already draws, made physical — not an untextured black
   * mirror. A glTF importer reads both factors out of the file and assigns them
   * explicitly, so it can never inherit this difference (decision, R-13).
   *
   * Values outside 0…1 pass through rather than clamp, and non-finite values
   * are rejected on **every** assignment (§85, the F14 discipline) — see
   * `requireFiniteScalar`. Assigning bumps {@link Material.version}: it changes
   * what the surface *is*, exactly as writing its colour does.
   */
  get metalness(): number {
    return this.#metalness;
  }

  set metalness(value: number) {
    this.#metalness = requireFiniteScalar("metalness", value);
    this.markDirty();
  }

  /**
   * How rough the surface is (§59) — glTF's `roughnessFactor`, nominally `0`
   * (a mirror) to `1` (fully diffuse); **`1` by default**.
   *
   * The GGX distribution is parameterized by `α = roughness²`, the
   * perceptually-linear remapping glTF and every metallic-roughness renderer
   * use, so halving this value does not halve the highlight — it is authored to
   * be dragged on a slider.
   *
   * The default is `1` for the reason {@link StandardMaterial.metalness}'s `0`
   * is: a fully rough dielectric is the closest a `StandardMaterial` gets to
   * the `LitMaterial` it sits above, which makes `new StandardMaterial()` a
   * legible starting point rather than a black mirror.
   *
   * Range, validation, and versioning are {@link StandardMaterial.metalness}'s
   * exactly.
   */
  get roughness(): number {
    return this.#roughness;
  }

  set roughness(value: number) {
    this.#roughness = requireFiniteScalar("roughness", value);
    this.markDirty();
  }

  /**
   * Writes {@link StandardMaterial.baseColor} and bumps
   * {@link Material.version} once. Returns `this` for chaining (§7b).
   *
   * `alpha` defaults to `1` rather than to the current alpha, for the reason
   * `UnlitMaterial.setColor` documents. Every component is validated before the
   * first write, so a rejected call leaves the colour exactly as it was (the
   * 2026-08-04 torn-state rule, applied to every material in the family).
   */
  setBaseColor(red: number, green: number, blue: number, alpha = 1): this {
    const validRed = requireFiniteColor("red", red);
    const validGreen = requireFiniteColor("green", green);
    const validBlue = requireFiniteColor("blue", blue);
    const validAlpha = requireFiniteColor("alpha", alpha);
    this.baseColor[0] = validRed;
    this.baseColor[1] = validGreen;
    this.baseColor[2] = validBlue;
    this.baseColor[3] = validAlpha;
    this.markDirty();
    return this;
  }

  /**
   * Writes {@link StandardMaterial.emissive} and bumps {@link Material.version}
   * once. Returns `this` for chaining (§7b).
   *
   * Three components and no alpha: emitted light has no transparency. Validated
   * before the first write, exactly as {@link StandardMaterial.setBaseColor}
   * is.
   */
  setEmissive(red: number, green: number, blue: number): this {
    const validRed = requireFiniteColor("emissive red", red);
    const validGreen = requireFiniteColor("emissive green", green);
    const validBlue = requireFiniteColor("emissive blue", blue);
    this.emissive[0] = validRed;
    this.emissive[1] = validGreen;
    this.emissive[2] = validBlue;
    this.markDirty();
    return this;
  }
}
