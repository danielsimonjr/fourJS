/**
 * Lights (§68) — the multi-light tier: directional, point, and spot nodes.
 *
 * §68's initial light set is ambient, hemisphere, directional, point, spot,
 * and rectangular area. The §120 MVP shipped the two cheapest members
 * (2026-08-04); **R-17 adds the two positional ones on 2026-08-09**;
 * hemisphere lands 2026-09-10. Rectangular area remains staged. What is
 * here, and what is not:
 *
 * - **directional** — {@link DirectionalLight}, this module. Exactly one
 *   illuminates a frame: it is the sun, it has dedicated shader uniforms, and
 *   further directional lights are still ignored (deterministically —
 *   scene-graph order decides which one wins, §33). Widening *that* one means
 *   retiring the dedicated uniforms in favour of a third entry kind in the
 *   light set, which is the clustered/forward-plus path's job (§68) and not
 *   this tier's;
 * - **point** — {@link PointLight}, new. A position, an inverse-square falloff,
 *   and an optional range window;
 * - **spot** — {@link SpotLight}, new. A point light with a cone: an axis (the
 *   node's −Z, as a directional light's) and two half-angles;
 * - **ambient** — still a *scene-wide constant term* on `Scene.ambientLight`
 *   rather than a node: with exactly one value per scene there is nothing
 *   positional about it, and a node would only add a traversal to find it;
 * - **hemisphere** — {@link HemisphereLight}, this module (2026-09-10). A
 *   two-colour directional *ambient* term (sky above, ground below) that
 *   belongs beside `Scene.ambientLight` rather than in the punctual set.
 *   Exactly one illuminates a frame: the first visible, enabled hemisphere
 *   in scene-graph order, the same first-match rule the directional light
 *   uses. It is not a lamp — there is no Lambert `n·L` and it does not
 *   cast. A rectangular area light still needs the linearly-transformed-
 *   cosine machinery §68's "where supported" already hedges on, and stays
 *   absent rather than accepted-and-ignored;
 * - **shadows** (`castShadow` in §68's own example) ship for the *directional*
 *   light only, at §69's directional-shadow-map tier (R-18, 2026-08-09):
 *   {@link DirectionalLight.castShadow} and {@link DirectionalLightShadow}.
 *   A {@link PointLight} and a {@link SpotLight} carry no `castShadow` at all
 *   — absent rather than accepted-and-ignored — because §69's answer for them
 *   is a cube map and a per-light shadow index that the single-map tier has
 *   nowhere to put. See {@link DirectionalLightShadow} for the whole staged
 *   list (cascades, point and spot shadows, atlas, contact shadows);
 * - §68's **CSS color strings** denote sRGB values (§60a). A light option
 *   now accepts either a linear {@link ColorRGB} tuple or a CSS string
 *   (`#rgb`/`#rrggbb`, `rgb()`/`rgba()`); a string is parsed and decoded to
 *   linear-light before it is stored, so the uploaded uniforms stay the
 *   same numbers they have always been;
 * - physically coherent units, light layers, environment/image-based
 *   lighting, tone mapping, and exposure (§68's requirements list) are all
 *   staged with their owning designs.
 *
 * A light is a {@link Node} — the placement decision cameras made (§47,
 * spec rev 1.3 put cameras in `@fourjs/scene`): it sits in the scene graph,
 * is parented, animated, and driven like anything else, and a light on a
 * turntable is a light added under the turntable's node.
 *
 * ## Direction
 *
 * A directional light shines along its node's **−Z axis in world space** —
 * the direction a camera looks (§7a, plan D8), so the same rig conventions
 * aim both. An unrotated light therefore shines toward −Z; a sun overhead is
 * the node rotated −π/2 about X (shining −Y, §7a's "down"). The node's world
 * *position* is irrelevant, as §68's directional model requires. A
 * {@link SpotLight} aims its cone along the same axis, so one rig points
 * either kind; a {@link PointLight} has no axis at all and reads only its
 * node's world *position*. A {@link HemisphereLight} orients its sky along
 * the node's **+Y axis in world space** — §7a's world up — so an unrotated
 * hemisphere is sky-above / ground-below in the Y-up world. That is a
 * different column from the shine axis on purpose: a hemisphere is not a
 * lamp, and "up" is the quantity the shade asks for.
 *
 * ## Intensity, and what a light's numbers mean
 *
 * `color × intensity` is an **irradiance already divided by π** — the
 * radiometric convention R-13 wrote down on 2026-08-08 and the reason neither
 * the Lambert lobe nor the GGX one carries a `1/π`. For a directional light
 * that product *is* the irradiance on a surface facing it. For a point or spot
 * light it is the irradiance at **unit distance** (one metre, §40), which the
 * inverse-square falloff then scales — so a `PointLight` and a
 * `DirectionalLight` of equal `intensity` agree exactly on a surface one metre
 * away and facing both. That is the whole content of the choice: it makes the
 * two kinds comparable without introducing a candela/lumen conversion §68's
 * "physically coherent units *where practical*" does not yet pay for.
 *
 * ## The renderer contract
 *
 * `@fourjs/render` discovers lights **structurally** (its `lights.ts` declares
 * the `DirectionalLightSource` and `PunctualLightSource` shapes) — the same
 * duck-typed pattern as its `ParticleDrawable`, though for the opposite
 * reason: the dependency edge render → scene exists, but the *WebGL backend's*
 * unit tests build scenes from typed doubles and an `instanceof` check would
 * be unfakeable there. `@fourjs/render`'s own tests pin these classes against
 * the contracts, so drift is caught at type level where the particle contract
 * can only catch it by test.
 */

import {
  Matrix4,
  parseColorRGB,
  srgbToLinearRGB,
  type ColorRGB,
  type Vector3,
} from "@fourjs/math";

import { Node } from "./node.js";
import { resolveWorldTransform } from "./world-transforms.js";

/**
 * Straight RGB, each component nominally in 0…1 — `@fourjs/math`'s
 * {@link ColorRGB}, re-exported (hoisted 2026-08-08 by R-15's colour packet,
 * exactly as `ColorRGBA` was hoisted 2026-08-04).
 *
 * The declaration moved; the type did not. A light colour is a **linear-light**
 * value: §60a makes the GPU pipeline linear-light, and `@fourjs/render` uploads
 * these numbers to the shader as they stand. A constructor option may also be
 * a CSS string (§60a: strings denote *sRGB*); it is parsed and decoded with
 * `@fourjs/math`'s `srgbToLinearRGB(parseColorRGB(css), out)` and stored as the
 * same linear tuple, so existing uniform uploads do not change.
 */

/**
 * A light colour as an author may write it: a linear {@link ColorRGB} tuple,
 * or a CSS string that is decoded to linear-light on construction (§60a).
 */
export type LightColorInput = ColorRGB | string;
export type { ColorRGB } from "@fourjs/math";

/**
 * How a {@link DirectionalLight} casts (§69) — the shadow-map resolution, the
 * two bias controls, and the orthographic volume the map covers.
 *
 * ```ts
 * const sun = new DirectionalLight({ intensity: 3, castShadow: true });
 * sun.shadow.mapSize = 2048;
 * sun.shadow.extent = 12;      // a 24 m × 24 m box about the light's position
 * sun.shadow.bias = 0.002;
 * ```
 *
 * Every property is a **validated accessor** (the F14 policy, 2026-08-07): the
 * constructor's §85 check runs again on every write, so a `NaN` map size is a
 * `RangeError` at the assignment that caused it rather than a black frame three
 * systems later. Nothing here is clamped or reordered — WP-3.3's
 * no-silent-rewrites rule — so an unusable value is *refused*, never quietly
 * repaired.
 *
 * ## The volume, and why it is authored rather than fitted
 *
 * A directional light has no position as far as *lighting* is concerned (§68 —
 * see {@link Node.getWorldDirection}), but a shadow map is a
 * rendering of a bounded volume and something has to bound it. This tier takes
 * the volume from the light's own node: the map is rendered from the light's
 * **world position**, looking along its **−Z axis**, through an orthographic
 * box `2 × extent` wide and tall with the near and far planes below. Moving or
 * aiming the light node therefore moves the shadow volume, which is the one
 * control an author already has in their hands.
 *
 * The alternative — fitting the box to the scene's bounds every frame — is
 * *not* this tier's, and deliberately: it needs a world-space bounds pass this
 * engine does not yet run (§87's culling packet owns it), and a volume that
 * silently resizes makes shadow texel density frame-dependent, which is the
 * shimmer §33's determinism language exists to keep out of a recorded run.
 *
 * ## Staged, with the date (2026-08-09, R-18)
 *
 * §69 lists ten features; this settings object is sized for the one tier that
 * ships. Named here rather than sketched, because each is public shape:
 *
 * - **cascaded shadow maps** — one map, one volume. Cascades need a split
 *   scheme, a map per split, and a per-fragment cascade selection, and they
 *   are what make a *large* outdoor volume workable; `extent` is the honest
 *   single-cascade knob until then.
 * - **point-light cubemap shadows** and **spot-light shadows** — neither
 *   {@link PointLight} nor {@link SpotLight} carries `castShadow` at all (see
 *   the module header). A cube map needs six passes and a `samplerCube`; a
 *   spot needs a perspective shadow matrix and a *second* map slot, which is
 *   the shadow-atlas item below.
 * - **shadow atlas management** — one map, one caster light. An atlas is what
 *   turns "a per-light shadow index" into something a bounded uniform set can
 *   address.
 * - **transparent shadow masks** — the depth-only pass writes geometry, not
 *   alpha, so a sprite or a cut-out texture casts nothing here (§55 quads are
 *   skipped by the caster pass entirely rather than casting a hard rectangle).
 * - **contact shadows** — a screen-space effect, and so §70's business rather
 *   than this record's.
 */
export class DirectionalLightShadow {
  #mapSize: number;

  #bias: number;

  #normalBias: number;

  #extent: number;

  #near: number;

  #far: number;

  constructor(options: DirectionalLightShadowOptions = {}) {
    this.#mapSize = requireMapSize(options.mapSize ?? DEFAULT_SHADOW_MAP_SIZE);
    this.#bias = requireFinite("shadow bias", options.bias ?? DEFAULT_BIAS);
    this.#normalBias = requireNonNegative(
      "shadow normalBias",
      options.normalBias ?? 0,
    );
    this.#extent = requirePositive(
      "shadow extent",
      options.extent ?? DEFAULT_SHADOW_EXTENT,
    );
    this.#near = requirePositive("shadow near", options.near ?? DEFAULT_NEAR);
    this.#far = requirePositive("shadow far", options.far ?? DEFAULT_FAR);
    requireOrderedPlanes(this.#near, this.#far);
  }

  /**
   * Edge length of the square shadow map in texels (§69 "configurable
   * resolution"). Defaults to `1024`.
   *
   * A finite integer of at least 1; anything else is refused (§85). It is
   * **not** required to be a power of two — the map is sampled with
   * `NEAREST` filtering and never mipmapped, so WebGL 2's non-power-of-two
   * rules do not bite — but a device's `MAX_TEXTURE_SIZE` still does, and a
   * size past it makes the backend's framebuffer incomplete, which skips the
   * shadow rather than the frame (`gl-render-target.ts`).
   */
  get mapSize(): number {
    return this.#mapSize;
  }

  set mapSize(value: number) {
    this.#mapSize = requireMapSize(value);
  }

  /**
   * Constant depth offset subtracted from a receiver's own depth before it is
   * compared against the map (§69 "bias"), in **clip-space depth units**
   * (0…1 across the near-to-far range). Defaults to `0.0015`.
   *
   * Too small and a lit surface shadows itself in stripes (acne); too large
   * and a shadow detaches from its caster (peter-panning). The right value
   * depends on `extent`, `far`, and the map's resolution, which is exactly why
   * §69 makes it an author's control rather than a constant.
   *
   * Any finite number is accepted, negative ones included: a negative bias is
   * a deliberate over-occlusion an author may want, and refusing it would be
   * the silent rewrite WP-3.3 rules out.
   */
  get bias(): number {
    return this.#bias;
  }

  set bias(value: number) {
    this.#bias = requireFinite("shadow bias", value);
  }

  /**
   * Distance, in metres (§40), that a receiver is pushed **along its own
   * surface normal** before its shadow-map coordinate is computed (§69
   * "normal-bias"). Defaults to `0` — off.
   *
   * The other half of the acne fix, and the half that scales with geometry
   * rather than with depth precision: a slope facing away from the light needs
   * an offset proportional to its own size, which a constant depth `bias`
   * cannot express. Must be finite and non-negative — a *negative* normal bias
   * would pull the receiver into its own caster, which is not a look, it is
   * the artefact.
   */
  get normalBias(): number {
    return this.#normalBias;
  }

  set normalBias(value: number) {
    this.#normalBias = requireNonNegative("shadow normalBias", value);
  }

  /**
   * Half-width and half-height of the orthographic shadow volume, in metres
   * (§40). Defaults to `10`, i.e. a 20 m × 20 m box. Must be finite and
   * positive.
   *
   * See the class header for what the volume is centred on and why it is
   * authored rather than fitted to the scene.
   */
  get extent(): number {
    return this.#extent;
  }

  set extent(value: number) {
    this.#extent = requirePositive("shadow extent", value);
  }

  /**
   * Distance in front of the light at which the shadow volume starts, in
   * metres (§40). Defaults to `0.1`. Must be finite, positive, and less than
   * {@link DirectionalLightShadow.far}.
   */
  get near(): number {
    return this.#near;
  }

  set near(value: number) {
    const near = requirePositive("shadow near", value);
    requireOrderedPlanes(near, this.#far);
    this.#near = near;
  }

  /**
   * Distance in front of the light at which the shadow volume ends, in metres
   * (§40). Defaults to `100`. Must be finite, positive, and greater than
   * {@link DirectionalLightShadow.near}.
   *
   * A caster beyond `far`, or nearer than `near`, is simply not in the map;
   * a *receiver* outside the volume is fully lit rather than fully shadowed
   * (see `@fourjs/render-webgl`'s shadow chunk), which is the choice that makes
   * an under-sized volume read as "shadows stop here" rather than as "the
   * world went black".
   */
  get far(): number {
    return this.#far;
  }

  set far(value: number) {
    const far = requirePositive("shadow far", value);
    requireOrderedPlanes(this.#near, far);
    this.#far = far;
  }
}

/** Construction arguments of {@link DirectionalLightShadow} (§69). */
export interface DirectionalLightShadowOptions {
  /** Initial {@link DirectionalLightShadow.mapSize}. Defaults to `1024`. */
  mapSize?: number;
  /** Initial {@link DirectionalLightShadow.bias}. Defaults to `0.0015`. */
  bias?: number;
  /** Initial {@link DirectionalLightShadow.normalBias}. Defaults to `0`. */
  normalBias?: number;
  /** Initial {@link DirectionalLightShadow.extent}. Defaults to `10`. */
  extent?: number;
  /** Initial {@link DirectionalLightShadow.near}. Defaults to `0.1`. */
  near?: number;
  /** Initial {@link DirectionalLightShadow.far}. Defaults to `100`. */
  far?: number;
}

/**
 * Default shadow-map edge in texels. §69 states no number and Appendix A pins
 * no shadow defaults, so this is a recorded decision: 1024² is one megatexel
 * — a 4 MB depth attachment — which is the largest map that is unremarkable on
 * every WebGL 2 device the §90 compatibility tables name, and the size at
 * which a 20 m volume gives roughly 2 cm texels.
 */
const DEFAULT_SHADOW_MAP_SIZE = 1024;

/**
 * Default constant depth bias. Chosen against the other two defaults: a 20 m
 * volume over a 100 m depth range on a 24-bit map needs about `1.5e-3` of
 * clip-space depth to clear its own quantization on a moderately sloped
 * surface. An author who changes `extent` or `far` by an order of magnitude
 * should expect to revisit it — which is the reason §69 makes it a control.
 */
const DEFAULT_BIAS = 0.0015;

/** Default half-extent of the shadow volume, in metres (§40). */
const DEFAULT_SHADOW_EXTENT = 10;

/** Default near plane of the shadow volume, matching §97's camera default. */
const DEFAULT_NEAR = 0.1;

/** Default far plane of the shadow volume, in metres (§40). */
const DEFAULT_FAR = 100;

/** Rejects a non-positive light parameter (§85); `requireFinite` runs first. */
function requirePositive(name: string, value: number): number {
  if (requireFinite(name, value) <= 0) {
    throw new RangeError(
      `Light ${name} must be positive; got ${String(value)} (§85).`,
    );
  }
  return value;
}

/** Rejects a shadow-map size that is not a positive integer (§85). */
function requireMapSize(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(
      "Light shadow mapSize must be a finite integer of at least 1; got " +
        `${String(value)} (§69, §85).`,
    );
  }
  return value;
}

/** Rejects a shadow volume whose planes do not bound anything (§85). */
function requireOrderedPlanes(near: number, far: number): void {
  if (!(near < far)) {
    throw new RangeError(
      `Light shadow near (${String(near)}) must be less than far ` +
        `(${String(far)}); a volume of zero or negative depth projects ` +
        "nothing (§69, §85).",
    );
  }
}

/**
 * Scratch for {@link DirectionalLight.computeShadowMatrix} — the light's view
 * matrix, composed once per call and never escaping (plan D7).
 */
const shadowViewScratch = new Matrix4();

/** Construction arguments of {@link DirectionalLight} (§68). */
export interface DirectionalLightOptions {
  /**
   * Initial color, copied into the light's own array as linear-light RGB.
   * A CSS string is parsed as sRGB and decoded first (§60a). Defaults to
   * white `[1, 1, 1]`, §68's own example value.
   */
  color?: LightColorInput;
  /**
   * Initial {@link DirectionalLight.intensity}. Defaults to `1`, so an
   * unconfigured light contributes exactly its color (decision, 2026-08-04:
   * §68's example `intensity: 3` is illustrative and Appendix A pins no light
   * defaults; `1` is the multiplicative identity).
   */
  intensity?: number;
  /**
   * Initial {@link DirectionalLight.castShadow} — §68's own example field,
   * driving §69's machinery. Defaults to `false`; see the property.
   */
  castShadow?: boolean;
  /**
   * Initial {@link DirectionalLight.shadow} settings (§69). Omitted fields
   * take {@link DirectionalLightShadow}'s documented defaults, and the record
   * is constructed whether or not the light casts — so configuring a light
   * before switching it on is a plain assignment rather than an allocation.
   */
  shadow?: DirectionalLightShadowOptions;
}

/**
 * Resolves a light colour option to a stored linear-light {@link ColorRGB}.
 * Numeric tuples are copied as-is (already linear); CSS strings are parsed
 * as sRGB and decoded (§60a) so the GPU still sees the same uniform type.
 */
function resolveLightColor(color: LightColorInput | undefined): ColorRGB {
  if (typeof color === "string") {
    const linear: ColorRGB = [0, 0, 0];
    srgbToLinearRGB(parseColorRGB(color), linear);
    return [
      requireFinite("color red", linear[0]),
      requireFinite("color green", linear[1]),
      requireFinite("color blue", linear[2]),
    ];
  }
  const rgb = color ?? [1, 1, 1];
  return [
    requireFinite("color red", rgb[0]),
    requireFinite("color green", rgb[1]),
    requireFinite("color blue", rgb[2]),
  ];
}

/** Rejects non-finite light parameters (§85). */
function requireFinite(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `Light ${name} must be finite; got ${String(value)} ` +
        "(§85: NaN and infinite values).",
    );
  }
  return value;
}

/**
 * A light infinitely far away, shining uniformly along its node's −Z world
 * axis (§68) — sunlight.
 *
 * ```ts
 * const sun = new DirectionalLight({ color: [1, 0.98, 0.9], intensity: 3 });
 * // Shine down −Y: rotate the node's −Z axis onto it (−π/2 about X, §7a).
 * sun.transform.rotation.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
 * scene.add(sun);
 * ```
 *
 * A frame shades with **at most one** directional light — the first one in
 * scene-graph order (see `@fourjs/render`'s `collectSceneLights`); further
 * directional lights are still ignored, for the reason the module header
 * gives. {@link PointLight} and {@link SpotLight} are how a scene gets more
 * than one lamp (R-17, 2026-08-09). Visibility
 * follows §6 exactly as it does for drawables: a light under a `visible =
 * false` or `enabled = false` ancestor (or itself hidden or disabled) does
 * not illuminate.
 *
 * There is no version counter, unlike materials and geometry: light uniforms
 * are a handful of floats uploaded per view per frame, so there is no backend
 * cache to invalidate — `color` and `intensity` may simply be written
 * (non-finite values excepted, §85) and take effect next frame.
 */
export class DirectionalLight extends Node {
  /**
   * The brand `@fourjs/render`'s light collection recognises — a literal `true`,
   * one property load per node, exactly as `ParticleDrawable.isParticleDrawable`.
   */
  readonly isDirectionalLight = true as const;

  /**
   * Straight RGB in 0…1; white by default. The array instance is `readonly`
   * — write *into* it — because the renderer may read it every frame and
   * replacing the array would leave a captured reference stale.
   */
  readonly color: ColorRGB;

  /**
   * Scalar multiplier on {@link DirectionalLight.color} (§68). Dimensionless
   * in this tier — §68's "physically coherent units where practical" is
   * staged with the module's dated note. Values outside 0…1 are the point
   * (sunlight is bright); negative values pass through un-clamped like every
   * other color component (WP-3.3's no-silent-rewrites decision). Must be
   * finite; validated at construction, and by contract when written directly.
   */
  intensity: number;

  /**
   * Whether this light casts shadows (§68's example field, §69's feature).
   * **Defaults to `false`.**
   *
   * ```ts
   * const sun = new DirectionalLight({ intensity: 3, castShadow: true });
   * sun.shadow.extent = 15;
   * ```
   *
   * `false` by default because a shadow map is a *whole extra pass* — a
   * depth-only rendering of every caster into an off-screen surface, plus a
   * comparison per shaded fragment — and §61 is explicit that a renderer does
   * not silently spend that. It is also what makes the flag honest as a
   * capability marker: a scene that never sets it emits, to the byte, the GL
   * call sequence it emitted before §69 existed (`multi-light`'s technique,
   * one packet on).
   *
   * At most **one** light casts in a frame, and it is the same one that lights
   * it: `@fourjs/render`'s `collectSceneLights` takes the first visible, enabled
   * directional light in scene-graph order (§33 — authored order decides, not
   * proximity or brightness) and reads this flag off *that* light. A second
   * directional light with `castShadow` set is ignored exactly as its
   * *lighting* is ignored; §69's shadow atlas is what changes that.
   *
   * A plain boolean, not an accessor: there is no invalid value, and R-12's
   * "render state is read per draw, never cached" makes a version bump
   * pointless (F14's rule for the §57 booleans, applied here).
   */
  castShadow: boolean;

  /**
   * Resolution, bias, and volume of this light's shadow map (§69) — see
   * {@link DirectionalLightShadow}.
   *
   * Always present, whatever {@link DirectionalLight.castShadow} says, so that
   * `light.shadow.mapSize = 2048` needs no null check and no allocation on the
   * frame that first switches shadows on. The instance is `readonly` for the
   * reason {@link DirectionalLight.color} is: the renderer may read it every
   * frame, and replacing the object would leave a captured reference stale.
   */
  readonly shadow: DirectionalLightShadow;

  constructor(options: DirectionalLightOptions = {}) {
    super();
    this.color = resolveLightColor(options.color);
    this.intensity = requireFinite("intensity", options.intensity ?? 1);
    this.castShadow = options.castShadow ?? false;
    this.shadow = new DirectionalLightShadow(options.shadow);
  }

  /**
   * Writes this light's **shadow view-projection** — the matrix that takes a
   * world-space point into the shadow map's clip space — into `out` and
   * returns it (§69, §7b's `out`-parameter convention).
   *
   * ```text
   * out = orthographic(−extent, extent, −extent, extent, near, far)
   *     · inverse(worldMatrix)
   * ```
   *
   * The right factor is the light's **view matrix**, derived exactly as
   * `Camera.updateViewMatrix` derives a camera's — the inverse of the resolved
   * world matrix — so the map is rendered from the light's world position,
   * along its −Z axis, with its +Y as up, and any rig that aims a camera aims
   * this. The left factor is the orthographic box
   * {@link DirectionalLightShadow} documents; a directional light's rays are
   * parallel, so the projection is orthographic and nothing here needs a field
   * of view.
   *
   * `depthRange` is WebGL 2's `[-1, 1]` (plan D8, §120's MVP backend), the
   * default `Matrix4.setOrthographic` already applies; a `"zero-to-one"`
   * backend gets its own overload with the packet that ships it.
   *
   * World transforms are resolved on demand, exactly as
   * {@link Node.getWorldDirection} resolves them. A degenerate
   * light — zero scale up the chain — has a **singular** world matrix, and
   * `Matrix4.invert` documents that it leaves such a matrix unchanged rather
   * than producing `NaN`: the result is a finite matrix describing a collapsed
   * volume that nothing can be inside, so the map comes out empty and every
   * receiver reads as lit. Like a degenerate camera (§47), it costs the frame
   * its shadow rather than its existence, and poisons nothing downstream.
   *
   * Allocates nothing: the view matrix is composed into module scratch.
   */
  computeShadowMatrix(out: Matrix4): Matrix4 {
    const shadow = this.shadow;
    shadowViewScratch.copy(resolveWorldTransform(this)).invert();
    return out
      .setOrthographic(
        -shadow.extent,
        shadow.extent,
        -shadow.extent,
        shadow.extent,
        shadow.near,
        shadow.far,
      )
      .multiply(shadowViewScratch);
  }
}

/** Construction arguments of {@link HemisphereLight} (§68). */
export interface HemisphereLightOptions {
  /**
   * Initial sky colour, copied as linear-light RGB. A CSS string is parsed
   * as sRGB and decoded first (§60a). Defaults to white `[1, 1, 1]`.
   */
  color?: LightColorInput;
  /**
   * Initial ground colour, copied as linear-light RGB. A CSS string is
   * parsed as sRGB and decoded first (§60a). Defaults to black `[0, 0, 0]`,
   * so an unconfigured light is "white sky, no ground fill".
   */
  groundColor?: LightColorInput;
  /**
   * Initial {@link HemisphereLight.intensity}. Defaults to `1` — the
   * multiplicative identity, exactly as {@link DirectionalLightOptions}
   * defaults it.
   */
  intensity?: number;
}

/**
 * A two-colour directional ambient term (§68) — sky above, ground below.
 *
 * ```ts
 * const hemi = new HemisphereLight({
 *   color: [0.6, 0.7, 1],
 *   groundColor: [0.3, 0.2, 0.1],
 *   intensity: 0.4,
 * });
 * scene.add(hemi);
 * ```
 *
 * Not a punctual lamp: there is no position in the shade, no falloff, and
 * no `castShadow`. The node's **+Y world axis** is the sky direction
 * (documented on the module header); `color × intensity` is the sky
 * irradiance and `groundColor × intensity` is the ground irradiance, both
 * already divided by π (R-13), and a fragment mixes them by
 * `0.5 · n·up + 0.5`. A frame shades with **at most one** hemisphere —
 * the first visible, enabled node in scene-graph order, matching the
 * directional light's first-match rule. Visibility follows §6: a
 * hemisphere under a hidden or disabled ancestor does not illuminate.
 *
 * On a `StandardMaterial` the term reaches the **diffuse lobe only**, the
 * same rule `Scene.ambientLight` follows, so a pure metal under hemisphere
 * alone stays black until IBL exists.
 */
export class HemisphereLight extends Node {
  /**
   * The brand `@fourjs/render`'s light collection recognises — a literal
   * `true`, one property load per node, exactly as
   * `DirectionalLight.isDirectionalLight`.
   */
  readonly isHemisphereLight = true as const;

  /**
   * Sky colour, straight RGB in 0…1; white by default. The array instance
   * is `readonly` — write *into* it — because the renderer may read it
   * every frame and replacing the array would leave a captured reference
   * stale.
   */
  readonly color: ColorRGB;

  /**
   * Ground colour, straight RGB in 0…1; black by default. Same ownership
   * rule as {@link HemisphereLight.color}.
   */
  readonly groundColor: ColorRGB;

  /**
   * Scalar multiplier on both colours (§68). Dimensionless in this tier;
   * must be finite. Validated at construction, and by contract when
   * written directly.
   */
  intensity: number;

  constructor(options: HemisphereLightOptions = {}) {
    super();
    this.color = resolveLightColor(options.color);
    this.groundColor = resolveLightColor(options.groundColor ?? [0, 0, 0]);
    this.intensity = requireFinite("intensity", options.intensity ?? 1);
  }

  /**
   * Writes this light's **sky direction** — the node's +Y axis in world
   * space — into `out` and returns it (§7b's `out`-parameter convention).
   *
   * +Y is §7a's world up, so an unrotated hemisphere is sky-above /
   * ground-below without a rotation. Ancestor scale is divided out by the
   * normalize; a degenerate chain yields the zero vector rather than
   * `NaN`, matching {@link Node.getWorldDirection}.
   *
   * Allocates nothing: the basis column is read from the resolved world
   * matrix.
   */
  getWorldUp(out: Vector3): Vector3 {
    const elements = resolveWorldTransform(this).elements;
    // Column-major Matrix4 (§7b): column 1 — elements 4, 5, 6 — is this
    // node's local +Y axis in world space.
    out.set(elements[4], elements[5], elements[6]);
    return out.normalize();
  }
}

/** Rejects a negative light parameter (§85); `requireFinite` runs first. */
function requireNonNegative(name: string, value: number): number {
  if (requireFinite(name, value) < 0) {
    throw new RangeError(
      `Light ${name} must not be negative; got ${String(value)} (§85).`,
    );
  }
  return value;
}

/** Construction arguments shared by {@link PointLight} and {@link SpotLight}. */
export interface PunctualLightOptions {
  /**
   * Initial color, copied into the light's own array as linear-light RGB.
   * A CSS string is parsed as sRGB and decoded first (§60a). Defaults to
   * white `[1, 1, 1]`, §68's own example value.
   */
  color?: LightColorInput;
  /**
   * Initial {@link PunctualLight.intensity}. Defaults to `1` — the
   * multiplicative identity, exactly as {@link DirectionalLightOptions}
   * defaults it.
   */
  intensity?: number;
  /**
   * Initial {@link PunctualLight.range}, in metres (§40). Defaults to `0`,
   * which means **unbounded**.
   */
  range?: number;
}

/**
 * The shared half of §68's two *positional* light types — a light that has a
 * place in the world and fades with distance from it (R-17, 2026-08-09).
 *
 * Abstract because §68 has no "punctual light" of its own: the class exists so
 * that {@link PointLight} and {@link SpotLight} cannot disagree about what
 * `color × intensity` means, how `range` windows the falloff, or where the
 * light *is*. Concrete subclasses add only what distinguishes them, which for
 * a spot light is exactly a cone.
 *
 * ## Falloff (§68, "physically coherent units where practical")
 *
 * Irradiance at distance `d` is `color × intensity / d²` — the inverse-square
 * law, unmodified, because a point emitter genuinely obeys it and any
 * "smoother" curve would be an art direction rather than a light. The one
 * departure is {@link PunctualLight.range}, glTF's `KHR_lights_punctual`
 * window:
 *
 * ```text
 * attenuation = clamp(1 − (d / range)⁴, 0, 1) / d²          range > 0
 * attenuation = 1 / d²                                       range = 0
 * ```
 *
 * The window is a **culling aid, not physics**: it drives the contribution
 * smoothly to exactly zero at `d = range` so a renderer may one day skip the
 * light beyond it without a visible seam. `range = 0` — the default — declares
 * that no such cut-off exists, which is why the default is the honest one.
 *
 * The `1/d²` term is evaluated in the shader with `d²` floored at a tiny
 * epsilon, so a surface *at* the light's exact position renders very bright
 * rather than `NaN`; the floor lives where the division does, the placement
 * rule R-13 fixed for `roughness`.
 */
export abstract class PunctualLight extends Node {
  /**
   * The brand `@fourjs/render`'s light collection recognises — a literal `true`,
   * one property load per node, exactly as `DirectionalLight.isDirectionalLight`.
   */
  readonly isPunctualLight = true as const;

  /** Which of §68's positional types this is; fixed by the subclass. */
  abstract readonly lightType: "point" | "spot";

  /**
   * Straight linear-light RGB in 0…1; white by default. The array instance is
   * `readonly` — write *into* it — for the reason
   * {@link DirectionalLight.color} records.
   */
  readonly color: ColorRGB;

  /**
   * Scalar multiplier on {@link PunctualLight.color} (§68): the irradiance,
   * over π, this light delivers to a surface **one metre away and facing it**
   * (see the module header). Must be finite; negatives pass through
   * un-clamped, like every other authored colour component.
   */
  intensity: number;

  /**
   * Distance in metres (§40) at which this light's contribution reaches
   * exactly zero, or `0` for **unbounded** — see the class header for the
   * window this switches on. Must be finite and non-negative.
   */
  range: number;

  constructor(options: PunctualLightOptions = {}) {
    super();
    this.color = resolveLightColor(options.color);
    this.intensity = requireFinite("intensity", options.intensity ?? 1);
    this.range = requireNonNegative("range", options.range ?? 0);
  }

  /**
   * Writes this light's world-space position into `out` and returns it (§7b's
   * `out`-parameter convention) — the translation column of the resolved world
   * matrix.
   *
   * World transforms are resolved on demand, exactly as
   * {@link Node.getWorldDirection} resolves them: O(depth),
   * version-cached, so the render path's prior resolve pass makes this a few
   * comparisons. Unlike a direction, a position needs no normalization and has
   * no degenerate case — a light under a zero scale still sits somewhere.
   */
  getWorldPosition(out: Vector3): Vector3 {
    const elements = resolveWorldTransform(this).elements;
    // Column-major Matrix4 (§7b): elements 12, 13, 14 are the translation.
    return out.set(elements[12], elements[13], elements[14]);
  }
}

/**
 * An omnidirectional light at a point in space (§68) — a bare bulb.
 *
 * ```ts
 * const lamp = new PointLight({ color: [1, 0.9, 0.75], intensity: 4, range: 12 });
 * lamp.transform.position.set(0, 3, 0);
 * scene.add(lamp);
 * ```
 *
 * Everything about it is {@link PunctualLight}'s; the class adds only the
 * discriminant. Visibility follows §6 exactly as a drawable's does: a light
 * under a `visible = false` or `enabled = false` ancestor does not illuminate.
 * There is no version counter, for the reason {@link DirectionalLight} records
 * — light uniforms are a handful of floats uploaded per frame.
 *
 * A frame draws at most {@link @fourjs/render!MAX_PUNCTUAL_LIGHTS} point and
 * spot lights together; the rest are skipped, in a documented order, with one
 * warning. See `@fourjs/render`'s `collectSceneLights`.
 */
export class PointLight extends PunctualLight {
  readonly lightType = "point" as const;
}

/** Construction arguments of {@link SpotLight} (§68). */
export interface SpotLightOptions extends PunctualLightOptions {
  /**
   * Initial {@link SpotLight.innerConeAngle}, in radians (§7a). Defaults to
   * `0` — glTF `KHR_lights_punctual`'s default, i.e. a cone that fades from
   * its axis outward with no fully-lit core.
   */
  innerConeAngle?: number;
  /**
   * Initial {@link SpotLight.outerConeAngle}, in radians (§7a). Defaults to
   * `Math.PI / 4`, glTF's default: a 90° cone.
   */
  outerConeAngle?: number;
}

/**
 * A point light restricted to a cone about its node's −Z axis (§68).
 *
 * ```ts
 * const spot = new SpotLight({
 *   intensity: 8,
 *   outerConeAngle: Math.PI / 6,
 *   innerConeAngle: Math.PI / 8,
 * });
 * spot.transform.position.set(0, 4, 0);
 * // Aim it down −Y, exactly as a directional light is aimed (§7a).
 * spot.transform.rotation.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
 * scene.add(spot);
 * ```
 *
 * ## The cone (§7a: half-angles, in radians)
 *
 * Both angles are measured from the axis, not across the cone, and both are
 * glTF `KHR_lights_punctual`'s — the same parameterization a loaded asset
 * carries, so an importer assigns them straight across. Inside
 * `innerConeAngle` the light is at full strength; between the two it falls off
 * smoothly; outside `outerConeAngle` it contributes nothing:
 *
 * ```text
 * t = clamp((cos θ − cos outer) / (cos inner − cos outer), 0, 1)
 * ```
 *
 * Nothing here clamps or reorders the two angles (WP-3.3's no-silent-rewrites
 * rule). `inner ≥ outer` is therefore expressible and means a **hard-edged**
 * cone: `@fourjs/render` divides by `max(cos inner − cos outer, 1e-6)`, which
 * turns the ramp into a step rather than into a division by zero. An angle
 * past `π/2` is likewise expressible and lights a hemisphere or more — a
 * floodlight, not an error.
 */
export class SpotLight extends PunctualLight {
  readonly lightType = "spot" as const;

  /** Half-angle of the fully-lit core, in radians (§7a). See the class header. */
  innerConeAngle: number;

  /** Half-angle at which the cone reaches zero, in radians (§7a). */
  outerConeAngle: number;

  constructor(options: SpotLightOptions = {}) {
    super(options);
    this.innerConeAngle = requireFinite(
      "innerConeAngle",
      options.innerConeAngle ?? 0,
    );
    this.outerConeAngle = requireFinite(
      "outerConeAngle",
      options.outerConeAngle ?? Math.PI / 4,
    );
  }
}
