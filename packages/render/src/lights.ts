/**
 * Light collection (§68, §64) — scene graph in, one flat light state out.
 *
 * The lit pipeline (§120 "lighting") needs three things a render item does not
 * carry: the scene ambient term, and the direction and color of the
 * directional light. This module gathers them into a {@link SceneLights}
 * record once per frame, the backend-independent way `render-list.ts` gathers
 * draws — a backend uploads the record's values as uniforms and never walks
 * the scene itself.
 *
 * ## The tier (R-17, 2026-08-09)
 *
 * One walk collects three things:
 *
 * - the scene **ambient** term, read off the root only;
 * - the first visible, enabled **directional** light — the sun, with the
 *   dedicated uniforms and the shadow — plus up to
 *   {@link MAX_DIRECTIONAL_LIGHTS}` - 1` **extra** directionals (W5.1),
 *   packed after the punctual lights; scene-graph order decides (§33);
 * - **light layers** (W5.1): `collectSceneLights(root, out, layerMask)` keeps
 *   a light only if `light.layers & layerMask` is non-zero. The mask is
 *   *per frame*, not per item: backends share one light record across the
 *   frame's views, so a renderer passes the union of its views' layer masks.
 *   Per-item light lists would need a per-draw uniform in every shader
 *   family and are not supported;
 * - the first visible, enabled **hemisphere** light — a two-colour
 *   directional ambient (sky / ground) beside the scene term. Exactly
 *   one, the same first-match rule;
 * - up to {@link MAX_PUNCTUAL_LIGHTS} **point and spot** lights, flattened
 *   into the four packed arrays a backend uploads as uniform arrays.
 *
 * and, since R-18 (2026-08-09), the **shadow** the directional light casts
 * when it is asked to (§69): a view-projection, a map size, and two biases,
 * which together are everything a backend needs to render a depth map and
 * compare against it. Only the *directional* light casts at this tier — see
 * `@fourjs/scene`'s `DirectionalLightShadow` for §69's staged remainder.
 *
 * §68's rectangular-area type is still staged, and so are IBL and the
 * clustered/forward-plus path for *many* lights (light layers shipped with
 * W5.1, per frame as described above) — see
 * `@fourjs/scene`'s `light.ts`, which owns that list. Hemisphere ships
 * (2026-09-10) as the fields on {@link SceneLights} below.
 *
 * ## Order, and what happens past the bound
 *
 * The walk is the depth-first, insertion-ordered traversal of §6 — the same
 * order `render-list.ts` builds draws in and the same "first match" rule
 * `Scene.find*` uses — with `visible` and `enabled` pruning **whole subtrees**.
 * A scene with more than {@link MAX_PUNCTUAL_LIGHTS} punctual lights therefore
 * keeps the **first `MAX_PUNCTUAL_LIGHTS` in that order** and skips the rest:
 * a deterministic, authored, reproducible choice (§33), never "the nearest"
 * (which would flicker as the camera moves) and never "the brightest" (which
 * would flicker as a light animates). Sort by moving the nodes.
 *
 * The overflow is reported **once per root**. Development builds go
 * through {@link @fourjs/core!devWarnOnce} (A-4). Production keeps an
 * unconditional `console.warn`: a scene that quietly drops a lamp is
 * the bug nobody finds, and that message is worth more in a shipped
 * build than the bytes it costs (the 2026-08 decision, still in
 * force). Both paths dedup per root.
 *
 * ## Structural contracts, like `particles.ts`
 *
 * Lights are recognised by the {@link DirectionalLightSource} brand and the
 * ambient term is read off the root through {@link AmbientLightSource} —
 * duck-typing rather than `instanceof DirectionalLight` / `instanceof Scene`,
 * even though (unlike the particle case) the render → scene edge exists in
 * the frozen §3.1 matrix. The reason is one layer down: `@fourjs/render-webgl`
 * may depend on `core`, `math`, and `render` only, so its unit tests build
 * scenes from typed doubles, and an `instanceof` here would make a fake light
 * impossible to write there. Unlike the particle contract, drift *is* caught
 * at type level: this package depends on `@fourjs/scene`, and its unit tests
 * pin the real `DirectionalLight` and `Scene` against these shapes with plain
 * assignments.
 */

import { DEV, DEV_WARNING_PREFIX, devWarnOnce } from "@fourjs/core";
import { Matrix4, Vector3 } from "@fourjs/math";
import { viewLayerMask } from "./render-list.js";
import {
  MAX_SHADOWED_PUNCTUAL_LIGHTS,
  MAX_SHADOW_CASCADES,
  MAX_SHADOW_TILES,
  SHADOW_ATLAS_MAX_EDGE,
  SHADOW_KIND_POINT,
  SHADOW_KIND_SPOT,
  computeAtlasGrid,
  fitDirectionalCascades,
  writeCubeFaceShadowMatrix,
  writeSpotShadowMatrix,
  type ShadowFitCamera,
} from "./shadow-atlas.js";
import {
  ALL_LAYERS,
  type LayerMask,
  type Node,
  type Viewport,
} from "@fourjs/scene";

/**
 * What the light collector reads from a directional light node — the
 * structural contract `@fourjs/scene`'s `DirectionalLight` satisfies (§68).
 */
export interface DirectionalLightSource {
  /**
   * The brand {@link collectSceneLights} recognises. A literal `true`, not a
   * method, so the check is one property load per node per frame — exactly
   * `ParticleDrawable.isParticleDrawable`'s design.
   */
  readonly isDirectionalLight: true;

  /**
   * Straight RGB in 0…1, in §60a's **linear-light working space** — uploaded to
   * the shader as it stands (the "no colour space attached" deferral this line
   * carried is resolved by R-15, 2026-08-08; an author with a CSS string decodes
   * it with `@fourjs/math`'s `srgbToLinearRGB(parseColorRGB(css), out)`).
   */
  readonly color: readonly [number, number, number];

  /** Scalar multiplier on the color (§68); dimensionless in this tier. */
  readonly intensity: number;

  /**
   * Writes the world-space unit vector the light travels along into `out`
   * and returns it. `@fourjs/scene`'s implementation derives it from the
   * node's world −Z axis; a double supplies whatever the test needs.
   */
  getWorldDirection(out: Vector3): Vector3;

  /**
   * Whether this light casts shadows (§69; R-18, 2026-08-09). Absent — like
   * every member below — reads as `false`.
   *
   * **Optional, and that is the compatibility contract**, not laziness: this
   * interface is satisfied structurally, and the doubles `@fourjs/render-webgl`'s
   * unit tests build were written before §69 existed. A required member here
   * would have broken every one of them at *compile* time, and a host's own
   * minimal light object at run time — while an optional one reads `undefined`,
   * which {@link collectSceneLights} resolves to "does not cast", i.e. exactly
   * the behaviour every scene had before this field.
   */
  readonly castShadow?: boolean;

  /**
   * Resolution and bias of this light's shadow map (§69) — the half
   * {@link SceneLights} carries through to a backend. `@fourjs/scene`'s
   * `DirectionalLightShadow` satisfies it; the volume controls it also carries
   * (`extent`, `near`, `far`) are consumed by
   * {@link DirectionalLightSource.computeShadowMatrix} and never reach a
   * backend, which is why they are not declared here.
   */
  readonly shadow?: DirectionalShadowSource;

  /**
   * Writes the light's world-space **shadow view-projection** into `out` and
   * returns it (§69) — see `@fourjs/scene`'s `DirectionalLight` for the
   * derivation. A light that offers no such method never casts, whatever
   * {@link DirectionalLightSource.castShadow} says: the matrix is the shadow.
   */
  computeShadowMatrix?(out: Matrix4): Matrix4;
}

/**
 * The two shadow numbers a backend needs per frame (§69) — the structural half
 * of `@fourjs/scene`'s `DirectionalLightShadow`.
 *
 * `mapSize` is here rather than derived because a backend has to *allocate* a
 * surface of that size before it can render into one, and `bias`/`normalBias`
 * because both are consumed by the fragment stage that samples it. Everything
 * else on §69's settings object shapes the matrix, which arrives already
 * multiplied out.
 */
export interface DirectionalShadowSource {
  /** Edge of the square shadow map in texels (§69 "configurable resolution"). */
  readonly mapSize: number;

  /** Constant depth offset, in clip-space depth units (§69 "bias"). */
  readonly bias: number;

  /** Offset along the receiver's normal, in metres (§69 "normal-bias"). */
  readonly normalBias: number;

  /**
   * Cascade count `1…4` (W6.3); absent reads as `1`, the pre-W6.3 single
   * volume, so a structural double predating cascades is unaffected.
   */
  readonly cascades?: number;

  /** Practical-split blend `0…1` (W6.3); absent reads as `0.5`. */
  readonly cascadeLambda?: number;

  /** Farthest cascaded view distance, metres (W6.3); absent reads as `100`. */
  readonly cascadeDistance?: number;

  /** Caster reach toward the light beyond a cascade's sphere, metres (W6.3); absent reads as `100`. */
  readonly far?: number;
}

/**
 * The shadow numbers a backend needs for one point or spot light (§69; W6.3) —
 * the structural half of `@fourjs/scene`'s `PunctualLightShadow`.
 */
export interface PunctualShadowSource {
  /** Edge of each square map (per cube face) in texels. */
  readonly mapSize: number;
  /** Depth bias as a fraction of the linear `far − near` range. */
  readonly bias: number;
  /** Offset along the receiver's normal, in metres. */
  readonly normalBias: number;
  /** Near plane of the perspective maps, metres. */
  readonly near: number;
  /** Far plane of the perspective maps, metres. */
  readonly far: number;
}

/**
 * How many of §68's **positional** lights — point and spot together — one
 * frame may shade with (R-17, 2026-08-09).
 *
 * §68 states no number, and Appendix A pins no light defaults, so this is a
 * recorded decision rather than a quotation. **Eight**, because:
 *
 * - it is a *forward* renderer's bound, and the honest ceiling on one is what
 *   the fragment stage can afford to loop over per pixel. §68's own answer to
 *   "many lights" is the clustered/forward-plus extension path, which is where
 *   a scene with dozens of lamps belongs — not a larger array;
 * - the four arrays cost `8 × (3 + 3 + 3 + 4) = 104` floats, i.e. 32 uniform
 *   vectors. GLES 3.0 guarantees 224 fragment uniform vectors, and this
 *   backend's largest pipeline (§59's standard program) spends about 17 on
 *   everything else — so eight lights fit inside the *guaranteed* minimum with
 *   room to spare on every conformant WebGL 2 device, with no capability query
 *   and no shader variant;
 * - it is the number three of the four engines this project's positioning
 *   document compares against settle on for a forward path, so an author
 *   porting a scene meets no surprise.
 *
 * It is a compile-time constant of the *shader*, not a runtime option, which
 * is the point: a `maxLights` option would mean recompiling pipelines at run
 * time and a §61 renderer may not throw inside a frame.
 */
export const MAX_PUNCTUAL_LIGHTS = 8;

/**
 * The most **directional** lights one frame shades with (§68, W5.1,
 * 2026-11-04) — the sun plus up to three fills.
 *
 * Four, because the practical use of a second directional is a key/fill/rim/
 * bounce rig (the classic studio four) and a fifth is a sign the author wants
 * an environment light, which is the staged IBL tier's job. Each extra costs
 * one slot of the shared light arrays, so the budget is small on purpose: the
 * arrays grow by `MAX_DIRECTIONAL_LIGHTS - 1` slots, not by a second set.
 *
 * Only the **first** directional (scene-graph order) is the "primary": it
 * owns the dedicated `direction` / `directionalColor` uniforms and is the one
 * that casts a shadow (§69's directional tier is unchanged). Directionals 2…4
 * are *extras*, packed after the punctual lights into the same arrays with
 * `punctualParams.w == `{@link EXTRA_DIRECTIONAL_FLAG}`, no shadow, and the
 * direction in `punctualDirections`. Past the cap the rest are skipped and a
 * `devWarnOnce` fires, exactly the punctual overflow rule.
 */
export const MAX_DIRECTIONAL_LIGHTS = 4;

/** Slots in the packed light arrays: punctual plus the extra directionals. */
export const MAX_LIGHT_SLOTS = MAX_PUNCTUAL_LIGHTS + MAX_DIRECTIONAL_LIGHTS - 1;

/** `punctualParams.w` value marking a slot as an extra directional light. */
export const EXTRA_DIRECTIONAL_FLAG = 2;

/**
 * What the collector reads from **any** of §68's positional lights — the half
 * `@fourjs/scene`'s `PunctualLight` base class satisfies (R-17, 2026-08-09).
 *
 * Structural, exactly like {@link DirectionalLightSource} and for exactly the
 * same reason: `@fourjs/render-webgl` may depend on `core`, `math`, and `render`
 * only, so its unit tests build lights as typed doubles.
 */
export interface PunctualLightSourceBase {
  /**
   * The brand {@link collectSceneLights} recognises. A literal `true`, not a
   * method, so the check is one property load per node per frame.
   */
  readonly isPunctualLight: true;

  /** Straight RGB in §60a's linear-light working space (§68). */
  readonly color: readonly [number, number, number];

  /**
   * Scalar multiplier on the colour: the irradiance, over π, at **unit
   * distance** (§68; see `@fourjs/scene`'s `light.ts` for the convention).
   */
  readonly intensity: number;

  /**
   * Distance at which the contribution reaches zero, or `0` for unbounded —
   * the `KHR_lights_punctual` window `@fourjs/scene`'s `PunctualLight` documents.
   */
  readonly range: number;

  /** Writes this light's world-space position into `out` and returns it. */
  getWorldPosition(out: Vector3): Vector3;

  /**
   * Whether this light casts a shadow (§69; W6.3). Optional — absent reads
   * `false` — for {@link DirectionalLightSource.castShadow}'s compatibility
   * reason.
   */
  readonly castShadow?: boolean;

  /** Resolution, bias and planes of this light's maps (§69; W6.3). */
  readonly shadow?: PunctualShadowSource;
}

/** A {@link PunctualLightSourceBase} with no axis — §68's point light. */
export interface PointLightSource extends PunctualLightSourceBase {
  readonly lightType: "point";
}

/** A {@link PunctualLightSourceBase} with a cone — §68's spot light. */
export interface SpotLightSource extends PunctualLightSourceBase {
  readonly lightType: "spot";

  /** Half-angle of the fully-lit core, in radians (§7a). */
  readonly innerConeAngle: number;

  /** Half-angle at which the cone reaches zero, in radians (§7a). */
  readonly outerConeAngle: number;

  /**
   * Writes the world-space unit vector the cone points along into `out` — the
   * node's −Z axis, the same convention {@link DirectionalLightSource} uses.
   */
  getWorldDirection(out: Vector3): Vector3;
}

/** Either of §68's positional light types, as the collector sees them. */
export type PunctualLightSource = PointLightSource | SpotLightSource;

/**
 * Where the scene ambient term comes from (§68 "ambient"): the render root,
 * when it offers one — `Scene.ambientLight` is the engine's carrier. A root
 * that is not a `Scene` (a subtree handed straight to `Renderer.render`)
 * simply has no ambient term, and lit surfaces shade from the directional
 * light alone.
 */
export interface AmbientLightSource {
  /** Straight RGB in 0…1, added uniformly to every lit surface (§68). */
  readonly ambientLight: readonly [number, number, number];
}

/**
 * What the collector reads from a hemisphere light node — the structural
 * contract `@fourjs/scene`'s `HemisphereLight` satisfies (§68).
 *
 * A two-colour directional ambient (sky above, ground below), not a
 * punctual lamp: no position, no falloff, no shadow. The sky axis is the
 * node's +Y in world space.
 */
export interface HemisphereLightSource {
  /** The brand {@link collectSceneLights} recognises. A literal `true`. */
  readonly isHemisphereLight: true;

  /** Sky colour, straight RGB in 0…1 — premultiplied by intensity in the record. */
  readonly color: readonly [number, number, number];

  /** Ground colour, straight RGB in 0…1 — premultiplied by intensity in the record. */
  readonly groundColor: readonly [number, number, number];

  /**
   * Scalar multiplier on both colours: the irradiance, over π, of a
   * surface facing that colour's hemisphere (§68; R-13).
   */
  readonly intensity: number;

  /**
   * Writes the world-space unit vector toward the sky into `out` — the
   * node's +Y axis, §7a's world up on an unrotated node.
   */
  getWorldUp(out: Vector3): Vector3;
}

/**
 * The frame's flattened lighting (§68), as a backend consumes it. One
 * mutable record, rewritten in place by every {@link collectSceneLights}
 * call — the pooling policy every per-frame structure in this package
 * follows (plan D7). Copy anything you need to keep.
 */
export interface SceneLights {
  /** The scene ambient term; `[0, 0, 0]` when the root offers none. */
  readonly ambientColor: [number, number, number];

  /**
   * Whether a directional light was found. When `false` the other two
   * directional fields hold their documented no-light values, so a backend
   * may upload them unconditionally.
   */
  hasDirectionalLight: boolean;

  /**
   * World-space unit vector the light travels along; `(0, 0, -1)` — the
   * direction an unrotated light shines — when there is no light. Owned by
   * the record and rewritten by the next collection.
   */
  readonly direction: Vector3;

  /**
   * The light's color premultiplied by its intensity — the one product every
   * shaded fragment needs, computed once per frame here rather than per
   * fragment there. `[0, 0, 0]` when there is no light, which makes the
   * Lambert term vanish and is why a backend needs no shader variant for the
   * unlit-scene case.
   */
  readonly directionalColor: [number, number, number];

  /**
   * How many entries of the four arrays below are live — `0` through
   * {@link MAX_PUNCTUAL_LIGHTS} (R-17, 2026-08-09).
   *
   * **A backend that sees `0` here must upload nothing at all.** That is not
   * an optimisation, it is the compatibility contract: an `int` uniform's
   * initial value in GL is `0`, so a scene lit the way every scene was lit
   * before this field existed issues byte-for-byte the GL sequence it always
   * did — the same technique R-38's permissive layer mask and R-15's
   * `bool` encode switch used.
   */
  punctualCount: number;

  /**
   * World-space positions, `x, y, z` per light, `MAX_LIGHT_SLOTS` entries
   * long and only the first `punctualCount` of them meaningful.
   *
   * `Float32Array` rather than the `number[]` the fields above use, because
   * these are uploaded **as a block**: a backend hands the array straight to
   * `uniform3fv` with no per-frame copy into scratch, which is the whole
   * reason the packing is done here instead of there. The trailing entries are
   * zeroed by every collection so a transcript of the upload is deterministic
   * rather than showing the previous frame's leftovers.
   */
  readonly punctualPositions: Float32Array;

  /**
   * Each light's colour premultiplied by its intensity, `r, g, b` per light —
   * the same product `directionalColor` carries, for the same reason
   * (computed once per frame here rather than per fragment there).
   */
  readonly punctualColors: Float32Array;

  /**
   * Each light's cone axis, `x, y, z` per light: the world-space unit vector
   * the light **travels along**, matching {@link SceneLights.direction}'s
   * convention. A point light has no axis and writes `(0, 0, 0)`.
   */
  readonly punctualDirections: Float32Array;

  /**
   * Four scalars per light, packed so the fragment stage needs no branching on
   * a light *kind* beyond one comparison:
   *
   * ```text
   * x  range, or 0 for unbounded — the KHR_lights_punctual window
   * y  cos(outerConeAngle);              0 for a point light
   * z  1 / max(cos inner − cos outer, 1e-6);   0 for a point light
   * w  1 for a spot light, 0 for a point light
   * ```
   *
   * The reciprocal in `z` is precomputed **here**, once per light per frame,
   * rather than in the shader once per light per *fragment*; the `max` is what
   * makes an `inner ≥ outer` cone a hard edge instead of a division by zero
   * (see `@fourjs/scene`'s `SpotLight`).
   */
  readonly punctualParams: Float32Array;

  /**
   * Whether the frame's directional light casts a shadow map (§69; R-18,
   * 2026-08-09) — `true` only when that light exists, sets `castShadow`, and
   * offers a `computeShadowMatrix`.
   *
   * **A backend that sees `false` here must issue no shadow call at all** —
   * not a framebuffer bind, not a uniform, not a texture. That is the same
   * compatibility contract {@link SceneLights.punctualCount} states, kept the
   * same way: a `bool` uniform's initial value in GL is `false`, so a scene lit
   * the way every scene was lit before §69 shipped emits byte-for-byte the GL
   * sequence it always did.
   */
  hasShadow: boolean;

  /**
   * World space → shadow-map clip space (§69), written by the casting light's
   * own `computeShadowMatrix`. Identity when {@link SceneLights.hasShadow} is
   * `false`, and owned by the record — read it, upload it, do not mutate it.
   */
  readonly shadowMatrix: Matrix4;

  /**
   * Edge of one square shadow tile in texels; `0` when nothing casts. With a
   * single map this is the map; with cascades or punctual maps it is the
   * largest `mapSize` of any caster, and the atlas is
   * `shadowAtlasWidth × shadowAtlasHeight`. The backend derives the PCF tap
   * offset from the atlas size.
   */
  shadowMapSize: number;

  /** Constant depth bias, in clip-space depth units (§69); `0` when nothing casts. */
  shadowBias: number;

  /** Normal-space bias, in metres (§69, §40); `0` when nothing casts. */
  shadowNormalBias: number;

  /**
   * How many cascades the directional light renders: `0` when it does not
   * cast, otherwise `1…`{@link MAX_SHADOW_CASCADES} (W6.3). `1` is the
   * pre-W6.3 single volume; the cascade matrices are the first
   * `shadowCascadeCount` entries of {@link SceneLights.shadowTileMatrices}
   * (tile `i` is cascade `i`), and `shadowMatrix` equals tile 0.
   */
  shadowCascadeCount: number;

  /**
   * Far view distance of each cascade, `[c0, c1, c2, c3]`, zero past the live
   * ones. The receiver picks the first cascade whose split is `≥` its view
   * depth, and a depth beyond the last split is lit.
   */
  readonly shadowCascadeSplits: Float32Array;

  /**
   * The fitting camera's view-depth row `[fx, fy, fz, w]`: a world point's view
   * depth is `dot(xyz, p) + w`. Frame state — every view samples the cascades
   * fitted to the first view's camera.
   */
  readonly shadowViewDepth: Float32Array;

  /** The four cascade matrices as 4 × 16 floats, for one uniform upload. */
  readonly shadowCascadeMatrices: Float32Array;

  /**
   * How many point/spot lights cast this frame, `0…`
   * {@link MAX_SHADOWED_PUNCTUAL_LIGHTS}; the first in scene-graph order.
   */
  shadowPunctualCount: number;

  /**
   * Per light slot (`MAX_LIGHT_SLOTS` rounded up to 12 entries): `k + 1` when
   * the slot's light is shadowed with shadow index `k`, else `0`.
   */
  readonly shadowPunctualSlot: Float32Array;

  /**
   * Per shadow index `k`, four floats: `baseTile`, `bias`, `normalBias`, and
   * the kind ({@link SHADOW_KIND_SPOT} `1` or {@link SHADOW_KIND_POINT} `2`).
   * A point light's six faces are tiles `baseTile … baseTile + 5`.
   */
  readonly shadowPunctualParams: Float32Array;

  /** Per shadow index `k`, four floats: `near`, `far`, `0`, `0`. */
  readonly shadowPunctualRange: Float32Array;

  /**
   * The spot lights' view-projections, 4 × 16 floats indexed by shadow index
   * `k`; a point light's entry is zero (its faces are projected analytically).
   */
  readonly shadowSpotMatrices: Float32Array;

  /** Tiles the atlas holds this frame — `0` when nothing casts. */
  shadowTileCount: number;

  /**
   * One view-projection per atlas tile (cascades first, then each punctual
   * light's faces), `MAX_SHADOW_TILES` allocated, the first `shadowTileCount`
   * live. The caster pass of tile `i` uploads `shadowTileMatrices[i]`.
   */
  readonly shadowTileMatrices: readonly Matrix4[];

  /** Atlas grid columns (`ceil(sqrt(tiles))`), `0` when nothing casts. */
  shadowAtlasColumns: number;

  /** Atlas grid rows, `0` when nothing casts. */
  shadowAtlasRows: number;

  /** Atlas width in texels (`columns × shadowMapSize`). */
  shadowAtlasWidth: number;

  /** Atlas height in texels (`rows × shadowMapSize`). */
  shadowAtlasHeight: number;

  /**
   * Whether the receiver needs the atlas path — more than one cascade or any
   * punctual shadow. `false` is the pre-W6.3 single-map path exactly.
   */
  shadowExtended: boolean;

  /**
   * Whether a hemisphere light was found. When `false` the three
   * hemisphere fields hold their documented no-light values (zeros), so a
   * backend may upload them unconditionally — or, on GL, upload nothing
   * at all: a `bool` uniform's initial value is `false`, the same
   * compatibility contract {@link SceneLights.punctualCount} states.
   */
  hasHemisphereLight: boolean;

  /**
   * Sky colour premultiplied by intensity. `[0, 0, 0]` when there is no
   * hemisphere, which makes the mix vanish.
   */
  readonly hemisphereSky: [number, number, number];

  /**
   * Ground colour premultiplied by intensity. `[0, 0, 0]` when there is
   * no hemisphere.
   */
  readonly hemisphereGround: [number, number, number];

  /**
   * World-space unit vector toward the sky; `(0, 1, 0)` — §7a's world up,
   * the direction an unrotated hemisphere faces — when there is no
   * hemisphere. Owned by the record and rewritten by the next collection.
   *
   * The no-light up is the identity axis rather than zero so a backend
   * that uploads unconditionally still has a finite, documented vector;
   * the zero sky and ground are what make the mix contribute nothing.
   */
  readonly hemisphereUp: Vector3;
}

/** Narrows any value to a {@link DirectionalLightSource} — see `isParticleDrawable`. */
export function isDirectionalLightSource(
  value: unknown,
): value is DirectionalLightSource {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<DirectionalLightSource>;
  return (
    candidate.isDirectionalLight === true &&
    typeof candidate.getWorldDirection === "function"
  );
}

/**
 * Narrows the render root to an {@link AmbientLightSource}: it must carry an
 * `ambientLight` array of at least three numbers. The element check is on the
 * first component only — one load, like the brand checks — because a root
 * that offers a partially-numeric ambient array is broken in a way §85's
 * development diagnostics own, not this per-frame path.
 */
function isAmbientLightSource(value: unknown): value is AmbientLightSource {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<AmbientLightSource>;
  return (
    Array.isArray(candidate.ambientLight) &&
    candidate.ambientLight.length >= 3 &&
    typeof candidate.ambientLight[0] === "number"
  );
}

/**
 * Narrows any value to a {@link PunctualLightSource} — the point/spot brand,
 * checked exactly as {@link isDirectionalLightSource} checks its own.
 */
export function isHemisphereLightSource(
  value: unknown,
): value is HemisphereLightSource {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<HemisphereLightSource>;
  return (
    candidate.isHemisphereLight === true &&
    typeof candidate.getWorldUp === "function"
  );
}

export function isPunctualLightSource(
  value: unknown,
): value is PunctualLightSource {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<PunctualLightSourceBase>;
  return (
    candidate.isPunctualLight === true &&
    typeof candidate.getWorldPosition === "function"
  );
}

/** Entries of `shadowPunctualSlot`: the light slots rounded up to a whole vec4. */
const SHADOW_SLOT_ENTRIES = Math.ceil(MAX_LIGHT_SLOTS / 4) * 4;

/**
 * Allocates a {@link SceneLights} record holding the documented no-light
 * state. Create one per consumer and reuse it every frame (plan D7).
 */
export function createSceneLights(): SceneLights {
  return {
    ambientColor: [0, 0, 0],
    hasDirectionalLight: false,
    direction: new Vector3(0, 0, -1),
    directionalColor: [0, 0, 0],
    punctualCount: 0,
    punctualPositions: new Float32Array(MAX_LIGHT_SLOTS * 3),
    punctualColors: new Float32Array(MAX_LIGHT_SLOTS * 3),
    punctualDirections: new Float32Array(MAX_LIGHT_SLOTS * 3),
    punctualParams: new Float32Array(MAX_LIGHT_SLOTS * 4),
    hasShadow: false,
    shadowMatrix: new Matrix4(),
    shadowMapSize: 0,
    shadowBias: 0,
    shadowNormalBias: 0,
    shadowCascadeCount: 0,
    shadowCascadeSplits: new Float32Array(4),
    shadowViewDepth: new Float32Array(4),
    shadowCascadeMatrices: new Float32Array(MAX_SHADOW_CASCADES * 16),
    shadowPunctualCount: 0,
    shadowPunctualSlot: new Float32Array(SHADOW_SLOT_ENTRIES),
    shadowPunctualParams: new Float32Array(MAX_SHADOWED_PUNCTUAL_LIGHTS * 4),
    shadowPunctualRange: new Float32Array(MAX_SHADOWED_PUNCTUAL_LIGHTS * 4),
    shadowSpotMatrices: new Float32Array(MAX_SHADOWED_PUNCTUAL_LIGHTS * 16),
    shadowTileCount: 0,
    shadowTileMatrices: Array.from(
      { length: MAX_SHADOW_TILES },
      () => new Matrix4(),
    ),
    shadowAtlasColumns: 0,
    shadowAtlasRows: 0,
    shadowAtlasWidth: 0,
    shadowAtlasHeight: 0,
    shadowExtended: false,
    hasHemisphereLight: false,
    hemisphereSky: [0, 0, 0],
    hemisphereGround: [0, 0, 0],
    hemisphereUp: new Vector3(0, 1, 0),
  };
}

/** Resets `out` to the documented no-light values. */
function clearSceneLights(out: SceneLights): void {
  out.ambientColor[0] = 0;
  out.ambientColor[1] = 0;
  out.ambientColor[2] = 0;
  out.hasDirectionalLight = false;
  out.direction.set(0, 0, -1);
  out.directionalColor[0] = 0;
  out.directionalColor[1] = 0;
  out.directionalColor[2] = 0;
  out.punctualCount = 0;
  // Whole-array fills rather than "clear what the last frame wrote": the dead
  // tail is uploaded along with the live head (one `uniform3fv` per array, no
  // sub-range), so leaving last frame's numbers there would make the upload
  // depend on history and a recorded transcript unreadable.
  out.punctualPositions.fill(0);
  out.punctualColors.fill(0);
  out.punctualDirections.fill(0);
  out.punctualParams.fill(0);
  // §69, and the same argument as the array fills above: the shadow matrix is
  // uploaded whole whenever it is uploaded at all, so leaving last frame's
  // numbers in it would make the upload depend on history. `identity()` costs
  // sixteen stores on a path that already zeroes 104 floats.
  out.hasShadow = false;
  out.shadowMatrix.identity();
  out.shadowMapSize = 0;
  out.shadowBias = 0;
  out.shadowNormalBias = 0;
  // W6.3: the atlas record. Arrays are uploaded whole, so they are zeroed for
  // the same transcript-determinism reason as the light arrays above; the tile
  // matrices are only ever read below `shadowTileCount`, so they are left.
  out.shadowCascadeCount = 0;
  out.shadowCascadeSplits.fill(0);
  out.shadowViewDepth.fill(0);
  out.shadowCascadeMatrices.fill(0);
  out.shadowPunctualCount = 0;
  out.shadowPunctualSlot.fill(0);
  out.shadowPunctualParams.fill(0);
  out.shadowPunctualRange.fill(0);
  out.shadowSpotMatrices.fill(0);
  out.shadowTileCount = 0;
  out.shadowAtlasColumns = 0;
  out.shadowAtlasRows = 0;
  out.shadowAtlasWidth = 0;
  out.shadowAtlasHeight = 0;
  out.shadowExtended = false;
  out.hasHemisphereLight = false;
  out.hemisphereSky[0] = 0;
  out.hemisphereSky[1] = 0;
  out.hemisphereSky[2] = 0;
  out.hemisphereGround[0] = 0;
  out.hemisphereGround[1] = 0;
  out.hemisphereGround[2] = 0;
  out.hemisphereUp.set(0, 1, 0);
}

/** Scratch for the world position and axis reads below (plan D7). */
const lightScratch = new Vector3();

/**
 * Roots already warned about a light-set overflow.
 *
 * Keyed on the **root**, not on a module-level flag, so each scene reports its
 * own overflow once and a second scene in the same process still reports its.
 * A `WeakSet` holds no scene alive.
 */
const warnedOverflowRoots = new WeakSet<object>();
const warnedDirectionalRoots = new WeakSet<object>();

/** Punctual lights the current walk *saw*, including any past the bound. */
let walkPunctualFound = 0;

/** Directional lights the current walk saw (counted past the cap). */
let walkDirectionalFound = 0;

/** The first directional light of the current walk — the primary. */
let walkPrimary: DirectionalLightSource | null = null;

/** Extra directionals stored so far this walk (they sit at the array tail). */
let walkExtraCount = 0;

/** Punctual lights that asked to cast this walk, in scene order (W6.3). */
const walkShadowLights: (PunctualLightSource | null)[] =
  new Array<PunctualLightSource | null>(MAX_SHADOWED_PUNCTUAL_LIGHTS).fill(
    null,
  );

/** The packed light slot of each entry of {@link walkShadowLights}. */
const walkShadowSlots: number[] = new Array<number>(
  MAX_SHADOWED_PUNCTUAL_LIGHTS,
).fill(0);

/** Entries of {@link walkShadowLights} in use. */
let walkShadowCount = 0;

/** Casting punctual lights the walk saw, counted past the cap. */
let walkShadowFound = 0;

const warnedShadowRoots = new WeakSet<object>();

/** The layer mask the current walk keeps lights for. */
let walkLayerMask: LayerMask = ALL_LAYERS;

/**
 * Whether a light survives the walk's layer mask (W5.1). A node double that
 * predates layers reports `undefined`, which reads as "every layer".
 */
function lightOnLayer(node: Node): boolean {
  return ((node.layers ?? ALL_LAYERS) & walkLayerMask) !== 0;
}

/** Writes extra directional `light` into the tail slot reserved for it. */
function writeExtraDirectional(
  light: DirectionalLightSource,
  out: SceneLights,
): void {
  const slot = MAX_PUNCTUAL_LIGHTS + walkExtraCount;
  walkExtraCount += 1;
  const vector = slot * 3;
  light.getWorldDirection(lightScratch);
  out.punctualDirections[vector] = lightScratch.x;
  out.punctualDirections[vector + 1] = lightScratch.y;
  out.punctualDirections[vector + 2] = lightScratch.z;
  out.punctualColors[vector] = light.color[0] * light.intensity;
  out.punctualColors[vector + 1] = light.color[1] * light.intensity;
  out.punctualColors[vector + 2] = light.color[2] * light.intensity;
  out.punctualParams[slot * 4 + 3] = EXTRA_DIRECTIONAL_FLAG;
}

/**
 * Moves the extras from their reserved tail slots down to sit directly after
 * the live punctual lights, so the shader's single `0…punctualCount` loop
 * covers both. A no-op when the punctual set is full (or there are no extras).
 */
function compactExtraDirectionals(out: SceneLights): void {
  const base = out.punctualCount;
  if (walkExtraCount > 0 && base < MAX_PUNCTUAL_LIGHTS) {
    for (let i = 0; i < walkExtraCount; i += 1) {
      const from = MAX_PUNCTUAL_LIGHTS + i;
      const to = base + i;
      for (let c = 0; c < 3; c += 1) {
        out.punctualDirections[to * 3 + c] =
          out.punctualDirections[from * 3 + c];
        out.punctualColors[to * 3 + c] = out.punctualColors[from * 3 + c];
        out.punctualDirections[from * 3 + c] = 0;
        out.punctualColors[from * 3 + c] = 0;
      }
      out.punctualParams[to * 4 + 3] = EXTRA_DIRECTIONAL_FLAG;
      out.punctualParams[from * 4 + 3] = 0;
    }
  }
  out.punctualCount = base + walkExtraCount;
}

/**
 * Packs one punctual light into the next free slot of `out`.
 *
 * A point light writes its position, its premultiplied colour, and its range;
 * everything else it leaves at the zero {@link clearSceneLights} put there,
 * which is exactly the `w = 0` the fragment stage reads as "no cone". A spot
 * light additionally writes its axis and the two cone scalars.
 */
function writePunctualLight(
  light: PunctualLightSource,
  out: SceneLights,
): void {
  const index = out.punctualCount;
  out.punctualCount = index + 1;
  const vector = index * 3;
  const params = index * 4;

  light.getWorldPosition(lightScratch);
  out.punctualPositions[vector] = lightScratch.x;
  out.punctualPositions[vector + 1] = lightScratch.y;
  out.punctualPositions[vector + 2] = lightScratch.z;

  out.punctualColors[vector] = light.color[0] * light.intensity;
  out.punctualColors[vector + 1] = light.color[1] * light.intensity;
  out.punctualColors[vector + 2] = light.color[2] * light.intensity;

  out.punctualParams[params] = light.range;
  if (light.lightType === "spot") {
    light.getWorldDirection(lightScratch);
    out.punctualDirections[vector] = lightScratch.x;
    out.punctualDirections[vector + 1] = lightScratch.y;
    out.punctualDirections[vector + 2] = lightScratch.z;

    const cosOuter = Math.cos(light.outerConeAngle);
    const cosInner = Math.cos(light.innerConeAngle);
    out.punctualParams[params + 1] = cosOuter;
    // The floor is what makes `inner >= outer` a hard edge instead of a
    // division by zero; see `@fourjs/scene`'s `SpotLight`.
    out.punctualParams[params + 2] = 1 / Math.max(cosInner - cosOuter, 1e-6);
    out.punctualParams[params + 3] = 1;
  }
}

/** Packs the first hemisphere into `out` — sky, ground, and +Y axis. */
function writeHemisphereLight(
  light: HemisphereLightSource,
  out: SceneLights,
): void {
  out.hasHemisphereLight = true;
  light.getWorldUp(out.hemisphereUp);
  out.hemisphereSky[0] = light.color[0] * light.intensity;
  out.hemisphereSky[1] = light.color[1] * light.intensity;
  out.hemisphereSky[2] = light.color[2] * light.intensity;
  out.hemisphereGround[0] = light.groundColor[0] * light.intensity;
  out.hemisphereGround[1] = light.groundColor[1] * light.intensity;
  out.hemisphereGround[2] = light.groundColor[2] * light.intensity;
}

/**
 * One depth-first, insertion-ordered walk (§6) gathering the sun and the
 * light set — `render-list.ts`'s `collect` filtering exactly: `visible` and
 * `enabled` prune **whole subtrees**, so a light under a hidden group does not
 * illuminate, just as a drawable under one does not draw.
 *
 * Unlike the single-light collector this replaces, the walk cannot stop early:
 * a directional light found at the first node says nothing about the point
 * lights further along. That is one extra traversal of the scene per frame
 * *that draws something lit* — the same shape of walk `buildRenderList`
 * already performs, and cheaper per node (two flag loads and two brand loads,
 * no material or geometry access).
 *
 * Punctual lights are written into `out` as they are met; the directional
 * light is **returned** rather than stashed, so "first in scene-graph order"
 * is expressed as "a subtree's answer only counts if everything before it had
 * none" and needs no mutable module state to say so.
 */
function collectFrom(node: Node, out: SceneLights): void {
  if (!node.visible || !node.enabled) {
    return;
  }
  if (isDirectionalLightSource(node)) {
    if (lightOnLayer(node)) {
      walkDirectionalFound += 1;
      if (walkPrimary === null) {
        walkPrimary = node;
      } else if (walkExtraCount < MAX_DIRECTIONAL_LIGHTS - 1) {
        writeExtraDirectional(node, out);
      }
    }
  } else if (isHemisphereLightSource(node)) {
    if (!out.hasHemisphereLight && lightOnLayer(node)) {
      writeHemisphereLight(node, out);
    }
  } else if (isPunctualLightSource(node) && lightOnLayer(node)) {
    walkPunctualFound += 1;
    if (out.punctualCount < MAX_PUNCTUAL_LIGHTS) {
      writePunctualLight(node, out);
      if (node.castShadow === true && node.shadow !== undefined) {
        walkShadowFound += 1;
        if (walkShadowCount < MAX_SHADOWED_PUNCTUAL_LIGHTS) {
          walkShadowLights[walkShadowCount] = node;
          walkShadowSlots[walkShadowCount] = out.punctualCount - 1;
          walkShadowCount += 1;
        }
      }
    }
  }
  const children = node.children;
  for (let i = 0; i < children.length; i += 1) {
    collectFrom(children[i], out);
  }
}

/**
 * Assigns the frame's atlas tiles (W6.3): the directional cascades already sit
 * in tiles `0 … C-1`; each accepted punctual shadow follows, in scene-graph
 * order, and receives its perspective matrices. Lights past
 * {@link MAX_SHADOWED_PUNCTUAL_LIGHTS}, or past the atlas's
 * {@link SHADOW_ATLAS_MAX_EDGE}, shade unshadowed with one warning per root.
 */
function allocateShadowAtlas(root: Node, out: SceneLights): void {
  let tileSize = out.shadowMapSize;
  for (let k = 0; k < walkShadowCount; k += 1) {
    const mapSize = (walkShadowLights[k] as PunctualLightSource).shadow
      ?.mapSize as number;
    tileSize = Math.max(tileSize, mapSize);
  }
  if (tileSize <= 0) {
    return;
  }
  const perEdge = Math.max(1, Math.floor(SHADOW_ATLAS_MAX_EDGE / tileSize));
  const maxTiles = Math.min(MAX_SHADOW_TILES, perEdge * perEdge);
  let tiles = out.shadowCascadeCount;
  let accepted = 0;
  for (let k = 0; k < walkShadowCount; k += 1) {
    const light = walkShadowLights[k] as PunctualLightSource;
    const shadow = light.shadow as PunctualShadowSource;
    const kind =
      light.lightType === "spot" ? SHADOW_KIND_SPOT : SHADOW_KIND_POINT;
    const need = kind === SHADOW_KIND_SPOT ? 1 : 6;
    if (tiles + need > maxTiles) {
      warnShadowOverflow(
        root,
        `the shadow atlas holds at most ${String(maxTiles)} tiles of ` +
          `${String(tileSize)} texels (${String(SHADOW_ATLAS_MAX_EDGE)} texel edge); ` +
          "a point or spot light that does not fit is not shadowed.",
      );
      continue;
    }
    const slot = walkShadowSlots[k];
    const vector = slot * 3;
    const px = out.punctualPositions[vector];
    const py = out.punctualPositions[vector + 1];
    const pz = out.punctualPositions[vector + 2];
    out.shadowPunctualSlot[slot] = accepted + 1;
    const params = accepted * 4;
    out.shadowPunctualParams[params] = tiles;
    out.shadowPunctualParams[params + 1] = shadow.bias;
    out.shadowPunctualParams[params + 2] = shadow.normalBias;
    out.shadowPunctualParams[params + 3] = kind;
    out.shadowPunctualRange[params] = shadow.near;
    out.shadowPunctualRange[params + 1] = shadow.far;
    if (kind === SHADOW_KIND_SPOT) {
      const matrix = out.shadowTileMatrices[tiles];
      writeSpotShadowMatrix(
        matrix,
        px,
        py,
        pz,
        out.punctualDirections[vector],
        out.punctualDirections[vector + 1],
        out.punctualDirections[vector + 2],
        (light as SpotLightSource).outerConeAngle,
        shadow.near,
        shadow.far,
      );
      out.shadowSpotMatrices.set(matrix.elements, accepted * 16);
    } else {
      for (let face = 0; face < 6; face += 1) {
        writeCubeFaceShadowMatrix(
          out.shadowTileMatrices[tiles + face],
          face,
          px,
          py,
          pz,
          shadow.near,
          shadow.far,
        );
      }
    }
    tiles += need;
    accepted += 1;
  }
  if (
    walkShadowFound > accepted &&
    walkShadowFound > MAX_SHADOWED_PUNCTUAL_LIGHTS
  ) {
    warnShadowOverflow(
      root,
      `${String(walkShadowFound)} point and spot lights cast shadows, but a ` +
        `frame renders at most ${String(MAX_SHADOWED_PUNCTUAL_LIGHTS)} (§69): ` +
        "the first in scene-graph order are shadowed and the rest are not.",
    );
  }
  for (let k = 0; k < walkShadowCount; k += 1) {
    walkShadowLights[k] = null;
  }
  out.shadowPunctualCount = accepted;
  for (let c = 0; c < out.shadowCascadeCount; c += 1) {
    out.shadowCascadeMatrices.set(out.shadowTileMatrices[c].elements, c * 16);
  }
  out.shadowTileCount = tiles;
  out.hasShadow = tiles > 0;
  out.shadowExtended = out.shadowCascadeCount > 1 || accepted > 0;
  out.shadowMapSize = tiles > 0 ? tileSize : 0;
  const grid = gridScratch;
  computeAtlasGrid(tiles, tileSize, grid);
  out.shadowAtlasColumns = tiles > 0 ? grid[0] : 0;
  out.shadowAtlasRows = tiles > 0 ? grid[1] : 0;
  out.shadowAtlasWidth = tiles > 0 ? grid[2] : 0;
  out.shadowAtlasHeight = tiles > 0 ? grid[3] : 0;
}

const gridScratch: number[] = [0, 0, 0, 0];

/** One development warning per root for a shadow-budget overflow. */
function warnShadowOverflow(root: Node, detail: string): void {
  const message = `Shadow budget exceeded: ${detail} Further overflows in this scene are suppressed.`;
  if (DEV) {
    devWarnOnce(`shadow-overflow:${root.id}`, message);
  } else if (!warnedShadowRoots.has(root)) {
    warnedShadowRoots.add(root);
    console.warn(`${DEV_WARNING_PREFIX} ${message}`);
  }
}

/**
 * Gathers `root`'s lighting into `out` and returns `out` (§68).
 *
 * ```ts
 * const lights = createSceneLights();        // allocated once
 * // per frame, when the render list contains a lit item:
 * collectSceneLights(scene, lights);
 * ```
 *
 * The ambient term is read from the **root only** (see
 * {@link AmbientLightSource}); the directional light is the first one found
 * in scene-graph order, visibility-filtered; the punctual lights are the first
 * {@link MAX_PUNCTUAL_LIGHTS} found in that same order — see the module header
 * for the tier, the ordering rule, and the render-list-identical subtree
 * pruning. A hidden root yields the full no-light state, matching
 * `buildRenderList`'s empty list for a hidden root.
 *
 * Positions and directions are read through `getWorldPosition` /
 * `getWorldDirection`, which resolve the light's own ancestor chain on demand
 * — so the result is correct even before a frame-wide resolve pass, the
 * guarantee `Camera.updateViewMatrix` makes. Neither is **§43-interpolated**
 * (staged, 2026-08-04): a light animated by the simulation reads its last
 * resolved transform, one step behind the interpolated geometry at most — the
 * trade `particles.ts` records for particle positions, made for the same
 * reason.
 *
 * Allocates nothing; every field of `out` is rewritten in place.
 */
export function collectSceneLights(
  root: Node,
  out: SceneLights,
  layerMask: LayerMask = ALL_LAYERS,
  shadowCamera: ShadowFitCamera | null = null,
): SceneLights {
  clearSceneLights(out);

  if (!root.visible || !root.enabled) {
    return out;
  }

  if (isAmbientLightSource(root)) {
    out.ambientColor[0] = root.ambientLight[0];
    out.ambientColor[1] = root.ambientLight[1];
    out.ambientColor[2] = root.ambientLight[2];
  }

  walkPunctualFound = 0;
  walkDirectionalFound = 0;
  walkExtraCount = 0;
  walkPrimary = null;
  walkShadowCount = 0;
  walkShadowFound = 0;
  walkLayerMask = layerMask;
  collectFrom(root, out);
  compactExtraDirectionals(out);
  const light = walkPrimary as DirectionalLightSource | null;
  walkPrimary = null;
  if (light !== null) {
    out.hasDirectionalLight = true;
    light.getWorldDirection(out.direction);
    out.directionalColor[0] = light.color[0] * light.intensity;
    out.directionalColor[1] = light.color[1] * light.intensity;
    out.directionalColor[2] = light.color[2] * light.intensity;
    // §69 (R-18). The shadow belongs to the *same* light that lights the frame
    // — the first one in scene-graph order — so this is read here rather than
    // in the walk: a second directional light's `castShadow` is ignored exactly
    // as its colour is, and for the same recorded reason (§33: authored order
    // decides, never proximity or brightness).
    //
    // All three members are optional on the contract, so all three are checked:
    // a structurally-typed light double predating §69 offers none of them and
    // resolves to "does not cast", which is what keeps a pre-R-18 scene on the
    // pre-R-18 path.
    const shadow = light.shadow;
    if (
      light.castShadow === true &&
      shadow !== undefined &&
      typeof light.computeShadowMatrix === "function"
    ) {
      out.hasShadow = true;
      out.shadowCascadeCount = 1;
      const requested = shadow.cascades ?? 1;
      if (
        requested > 1 &&
        shadowCamera !== null &&
        fitDirectionalCascades(
          shadowCamera,
          out.direction.x,
          out.direction.y,
          out.direction.z,
          Math.min(requested, MAX_SHADOW_CASCADES),
          shadow.cascadeLambda ?? 0.5,
          shadow.cascadeDistance ?? 100,
          shadow.mapSize,
          shadow.far ?? 100,
          out.shadowCascadeSplits,
          out.shadowViewDepth,
          out.shadowTileMatrices,
        )
      ) {
        out.shadowCascadeCount = Math.min(requested, MAX_SHADOW_CASCADES);
        out.shadowMatrix.copy(out.shadowTileMatrices[0]);
      } else {
        light.computeShadowMatrix(out.shadowMatrix);
        out.shadowTileMatrices[0].copy(out.shadowMatrix);
      }
      out.shadowMapSize = shadow.mapSize;
      out.shadowBias = shadow.bias;
      out.shadowNormalBias = shadow.normalBias;
    }
  }
  allocateShadowAtlas(root, out);

  if (walkPunctualFound > MAX_PUNCTUAL_LIGHTS) {
    const message =
      `${String(walkPunctualFound)} point and spot lights, but a frame ` +
      `shades with at most ${String(MAX_PUNCTUAL_LIGHTS)} (§68): the first ` +
      "in scene-graph order are used and the rest are skipped. Reorder the " +
      "nodes to choose differently. Further overflows in this scene are " +
      "suppressed.";
    if (DEV) {
      devWarnOnce(`punctual-overflow:${root.id}`, message);
    } else if (!warnedOverflowRoots.has(root)) {
      warnedOverflowRoots.add(root);
      console.warn(`${DEV_WARNING_PREFIX} ${message}`);
    }
  }
  if (walkDirectionalFound > MAX_DIRECTIONAL_LIGHTS) {
    const message =
      `${String(walkDirectionalFound)} directional lights, but a frame ` +
      `shades with at most ${String(MAX_DIRECTIONAL_LIGHTS)} (§68): the ` +
      "first in scene-graph order are used and the rest are skipped. Only " +
      "the first casts a shadow. Further overflows in this scene are " +
      "suppressed.";
    if (DEV) {
      devWarnOnce(`directional-overflow:${root.id}`, message);
    } else if (!warnedDirectionalRoots.has(root)) {
      warnedDirectionalRoots.add(root);
      console.warn(`${DEV_WARNING_PREFIX} ${message}`);
    }
  }
  return out;
}

/**
 * The union of the layer masks `views` draw (W5.1) — what a backend passes
 * to {@link collectSceneLights} so a light is kept if *any* view of the frame
 * can see its layer. Empty `views` yields `0` (no light survives, nothing is
 * drawn anyway). Allocates nothing.
 */
export function unionViewLayerMask(views: readonly Viewport[]): LayerMask {
  let mask = 0;
  for (let i = 0; i < views.length; i += 1) {
    mask |= viewLayerMask(views[i]);
  }
  return mask >>> 0;
}
