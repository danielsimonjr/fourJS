/**
 * The §27 built-in force fields, MVP tier (plan P9-2, WP-9.2).
 *
 * ```ts
 * const emitter = new ParticleEmitter({
 *   maxParticles: 4096,
 *   emissionRate: 500,
 *   fields: [
 *     uniformGravityField(),                       // (0, −9.81, 0)
 *     dragField(0.4),                              // a = −0.4·v
 *     volumeField(vortexField(new Vector3(), new Vector3(0, 1, 0), 12), {
 *       shape: "sphere",
 *       center: new Vector3(),
 *       radius: 5,
 *       falloff: 1,                                // 1-unit edge fade
 *     }),
 *     turbulenceField(1337, { frequency: 0.5, amplitude: 3 }),
 *   ],
 * });
 * ```
 *
 * Everything here implements {@link ParticleForceField} — §27's `ForceField`,
 * transcribed in `types.ts` — so anything in this module can be handed to
 * `ParticleEmitter`'s `fields` option, and a hand-written field is just as valid
 * as a built-in one. Nothing here knows about emitters, pools, or nodes.
 *
 * ## What a sampled vector means
 *
 * **An acceleration in units/s²** (`types.ts`, WP-9.1: MVP particles carry no
 * mass channel, so a "force" field is authored as an acceleration). Times are
 * seconds, angles radians, and the world is right-handed **Y-up in both 2D and
 * 3D** (§7a) — so "down" is −Y in a 2D scene too.
 *
 * ## §27's built-in list, and what this packet actually ships (honest scope)
 *
 * | §27 built-in            | WP-9.2                                            |
 * | ----------------------- | ------------------------------------------------- |
 * | uniform gravity         | **ships** — {@link uniformGravityField}            |
 * | radial gravity          | **ships** — {@link radialField} (negative strength) |
 * | vortex                  | **ships** — {@link vortexField}                    |
 * | wind                    | **ships** — {@link windField}                      |
 * | drag volume             | **ships** — {@link dragField} + {@link volumeField} |
 * | turbulence/noise        | **ships** — {@link turbulenceField}, with the honesty note below |
 * | spring field            | **staged** — a spring field wants a rest *target* per particle (§27 gives none) and reads as an attractor with a linear law; {@link radialField} is inverse-square only, so shipping "spring" as a relabelled radial would be a lie |
 * | user-defined callback   | **already possible** — an object literal with a `sample` method *is* the interface; no wrapper is shipped because there is nothing for it to do |
 * | GPU field               | **ships** — every built-in here (radial, uniform gravity, drag, wind, vortex, turbulence, one {@link volumeField} over any) carries a `gpuField` record; `simulation: "gpu"` evaluates up to `MAX_GPU_FIELDS` (8) in declaration order with the same formulas (float32). Hand-written callback fields and nested volumes stay CPU-only and are refused |
 * | volume inclusion/filtering | **ships, MVP** — {@link volumeField}: axis-aligned sphere and box, with an edge fade. Rotated boxes, cylinders, capsules, meshes, and inversion are staged |
 *
 * Nothing here is accepted-and-ignored: an option that silently does nothing is
 * worse than one that does not exist yet.
 *
 * ## Shared contract for every field in this module
 *
 * 1. **Constructor arguments are copied.** A `Vector3` passed in is read into
 *    scalars at construction; mutating it afterwards does not change the field.
 *    (Runtime re-authoring is deliberately absent, exactly as in `emitter.ts`.)
 * 2. **Arguments are validated eagerly**, with `RangeError`, at construction —
 *    a field is authored once and sampled millions of times, so a `NaN` strength
 *    should fail where it was written, not as an invisible pool of `NaN`
 *    positions ten seconds later.
 * 3. **`sample` allocates nothing.** Each field owns one scratch `Vector3`,
 *    built at construction, and returns it when the caller omits `out`. Per the
 *    `types.ts` contract that vector is valid only until the next call on the
 *    *same* field.
 * 4. **`sample` never mutates `position` or `velocity`**, and reads every
 *    component it needs into locals *before* writing `out`. Sampling with
 *    `out === position` therefore produces the correct answer rather than
 *    garbage — {@link volumeField} inherits that only if its inner field has it,
 *    which every field here does.
 * 5. **`sample` is a pure function of its arguments** (§33): no clock, no
 *    `Math.random`, no hidden state. {@link turbulenceField} takes an explicit
 *    seed and draws from {@link SeededRandom} once, at construction.
 *
 * ## A note on the emitter's summation order
 *
 * `ParticleEmitter` sums `gravity`, then each field's sample **in declaration
 * order**. Floating-point addition is not associative, so the order of the
 * `fields` array is part of the determinism contract (§33) and not a cosmetic
 * detail. Fields that read `velocity` ({@link dragField}, {@link windField}) see
 * the velocity **at the start of the step** — the emitter samples every field
 * before integrating, so drag never sees another field's contribution within the
 * same step. That is what makes the closed forms in `tests/fields.test.ts`
 * exact.
 */

import { DEFAULT_GRAVITY_Y } from "@fourjs/core";
import { Vector3 } from "@fourjs/math";

import { SeededRandom } from "./random.js";
import type { ParticleForceField, ParticleGpuVolume } from "./types.js";

/**
 * Standard gravity in units/s², as a signed Y component: the default of
 * {@link uniformGravityField}. Appendix A pins `(0, −9.81, 0)` for 3D and
 * `(0, −9.81)` for 2D — the same vector, because §7a puts +Y up in both.
 *
 * `@fourjs/core`'s constant, re-exported (hoisted 2026-08-04; it was duplicated
 * from `@fourjs/physics` while §3.1's missing edge left nothing shared to
 * import).
 */
export { DEFAULT_GRAVITY_Y } from "@fourjs/core";

/**
 * Distance floor of {@link radialField} when `minDistance` is omitted, in world
 * units. See {@link RadialFieldOptions.minDistance} for why a floor exists and
 * why this default is small.
 */
export const DEFAULT_RADIAL_MIN_DISTANCE = 0.01;

/** Distance floor of {@link vortexField} when `minDistance` is omitted, in world units. */
export const DEFAULT_VORTEX_MIN_DISTANCE = 0.01;

/** Lattice frequency of {@link turbulenceField} when `frequency` is omitted, in cells per world unit. */
export const DEFAULT_TURBULENCE_FREQUENCY = 1;

/** Per-component bound of {@link turbulenceField} when `amplitude` is omitted, in units/s². */
export const DEFAULT_TURBULENCE_AMPLITUDE = 1;

/**
 * Half-width of {@link turbulenceField}'s central-difference stencil, in lattice
 * cells (so `TURBULENCE_DIFFERENCE_CELLS / frequency` world units).
 *
 * Exported because it is the one number that decides how tight the amplitude
 * bound is in practice: the bound `|componentᵢ| ≤ amplitude` is derived from the
 * stencil's analytic worst case, and a *smaller* step makes the worst case less
 * attainable, so the typical magnitude falls further below `amplitude`. Half a
 * cell is the compromise this packet pins — see the turbulence honesty note.
 */
export const TURBULENCE_DIFFERENCE_CELLS = 0.5;

/**
 * A constant acceleration everywhere — §27's *uniform gravity*, and the field
 * form of `ParticleEmitterOptions.gravity`.
 *
 * ```ts
 * uniformGravityField();                          // (0, −9.81, 0)
 * uniformGravityField(new Vector3(0, -1.62, 0));  // lunar
 * ```
 *
 * Prefer the emitter's `gravity` option when there is exactly one constant
 * acceleration: it costs no virtual call per particle. Use this when gravity
 * must be wrapped by {@link volumeField}, or ordered against other fields.
 *
 * @param acceleration Units/s², copied. Omitted means `(0, {@link DEFAULT_GRAVITY_Y}, 0)`.
 * @throws RangeError if any component is not finite.
 */
export function uniformGravityField(
  acceleration?: Vector3,
): ParticleForceField {
  const x = assertFinite(acceleration?.x ?? 0, "uniformGravityField", "x");
  const y = assertFinite(
    acceleration?.y ?? DEFAULT_GRAVITY_Y,
    "uniformGravityField",
    "y",
  );
  const z = assertFinite(acceleration?.z ?? 0, "uniformGravityField", "z");
  const scratch = new Vector3();

  const field: ParticleForceField = {
    gpuField: { kind: "uniform", x, y, z },
    sample(_position, _velocity, _time, out = scratch): Vector3 {
      return out.set(x, y, z);
    },
    sampleAll(_positions, _velocities, count, _time, out): void {
      for (let i = 0; i < count; i += 1) {
        const base = i * 3;
        out[base] += x;
        out[base + 1] += y;
        out[base + 2] += z;
      }
    },
  };
  return field;
}

/**
 * Linear drag — §27's *drag volume* without the volume (wrap it in
 * {@link volumeField} to get one):
 *
 * ```text
 * a = −coefficient · v
 * ```
 *
 * **Linear (Stokes) drag, not quadratic.** Real aerodynamic drag goes as `−c|v|v`
 * above a very low Reynolds number; the linear law is chosen because it has an
 * exact closed form under the emitter's semi-implicit Euler step, which is what
 * makes it testable and predictable:
 *
 * ```text
 * vₙ = v₀ · (1 − coefficient · dt)ⁿ
 * ```
 *
 * — geometric decay with ratio `1 − c·dt`, the discrete image of `v₀·e^(−ct)`.
 * Two consequences worth knowing before authoring:
 *
 * - **`coefficient · dt < 1` or the sign flips each step**; at
 *   `coefficient · dt ≥ 2` the magnitude grows and the simulation diverges. At
 *   60 Hz that is `coefficient < 60`. Nothing clamps this — the emitter's `dt`
 *   is not known here, and silently capping a coefficient would make the closed
 *   form false.
 * - **Terminal velocity under a constant `g` is `g / coefficient`**, so
 *   `coefficient` reads as an inverse time constant in s⁻¹, not as a mass- or
 *   area-dependent physical drag coefficient.
 *
 * Quadratic drag is **staged**: it needs a documented low-speed regularisation
 * to avoid a discontinuous derivative at `v = 0`, and §27 asks for a drag volume
 * rather than for a particular law.
 *
 * @param coefficient Inverse time constant in s⁻¹. `0` is a no-op field.
 * Negative values *add* energy (`v` grows geometrically); that is not rejected,
 * on the same footing as the emitter's `restitution > 1`.
 * @throws RangeError if `coefficient` is not finite.
 */
export function dragField(coefficient: number): ParticleForceField {
  const c = assertFinite(coefficient, "dragField", "coefficient");
  const scratch = new Vector3();

  const field: ParticleForceField = {
    gpuField: { kind: "drag", coefficient: c },
    sample(_position, velocity, _time, out = scratch): Vector3 {
      const vx = velocity.x;
      const vy = velocity.y;
      const vz = velocity.z;
      return out.set(-c * vx, -c * vy, -c * vz);
    },
    sampleAll(_positions, velocities, count, _time, out): void {
      for (let i = 0; i < count; i += 1) {
        const base = i * 3;
        out[base] += -c * velocities[base];
        out[base + 1] += -c * velocities[base + 1];
        out[base + 2] += -c * velocities[base + 2];
      }
    },
  };
  return field;
}

/**
 * §27's *wind*: a drag toward a moving air mass rather than toward rest.
 *
 * ```text
 * a = coefficient · (wind − v)
 * ```
 *
 * The fixed point is `v = wind` — a particle released into it accelerates until
 * it drifts with the air and then stops accelerating, which is what
 * distinguishes wind from "a constant sideways push" (that is
 * {@link uniformGravityField} with a horizontal vector). Under the emitter's
 * step the approach is exactly geometric:
 *
 * ```text
 * vₙ = wind + (v₀ − wind) · (1 − coefficient · dt)ⁿ
 * ```
 *
 * so `1 / coefficient` is the e-folding time in seconds, and the same
 * `coefficient · dt < 1` stability note as {@link dragField} applies.
 * `windField(w, c)` and `dragField(c)` differ by exactly the constant
 * `c · w`; both are shipped because authoring "the air moves at 4 m/s east" is
 * not the same act as authoring "damp everything".
 *
 * @param wind Air velocity in units/s, copied.
 * @param coefficient Coupling to the air, in s⁻¹. `0` is a no-op field.
 * @throws RangeError if any component of `wind`, or `coefficient`, is not finite.
 */
export function windField(
  wind: Vector3,
  coefficient: number,
): ParticleForceField {
  const wx = assertFinite(wind.x, "windField", "wind.x");
  const wy = assertFinite(wind.y, "windField", "wind.y");
  const wz = assertFinite(wind.z, "windField", "wind.z");
  const c = assertFinite(coefficient, "windField", "coefficient");
  const scratch = new Vector3();

  const field: ParticleForceField = {
    gpuField: {
      kind: "wind",
      windX: wx,
      windY: wy,
      windZ: wz,
      coefficient: c,
    },
    sample(_position, velocity, _time, out = scratch): Vector3 {
      const vx = velocity.x;
      const vy = velocity.y;
      const vz = velocity.z;
      return out.set(c * (wx - vx), c * (wy - vy), c * (wz - vz));
    },
    sampleAll(_positions, velocities, count, _time, out): void {
      for (let i = 0; i < count; i += 1) {
        const base = i * 3;
        out[base] += c * (wx - velocities[base]);
        out[base + 1] += c * (wy - velocities[base + 1]);
        out[base + 2] += c * (wz - velocities[base + 2]);
      }
    },
  };
  return field;
}

/** Options of {@link radialField}. */
export interface RadialFieldOptions {
  /**
   * Distance floor in world units, default {@link DEFAULT_RADIAL_MIN_DISTANCE}.
   * Must be finite and `> 0`.
   *
   * An inverse-square law diverges at the centre, and a particle that wanders
   * within a millimetre of an attractor would be flung across the scene by a
   * single step. The floor caps the magnitude at
   * `|strength| / minDistance²` — **`10⁴ · |strength|` at the default**, which
   * is still enormous. Treat the default as "do not produce infinities", not as
   * "this is stable": for an attractor a particle can actually reach, raise
   * `minDistance` to roughly the visual radius of the attractor.
   */
  readonly minDistance?: number;
}

/**
 * §27's *radial gravity* / attractor / repulsor: an inverse-square field
 * pointing along the line from `center` to the sample point.
 *
 * ```text
 * r = position − center
 * d = |r|
 * a = strength · (r / d) / max(d, minDistance)²
 * ```
 *
 * — magnitude `|strength| / max(d, minDistance)²`, direction radial, **and
 * nothing else**: the returned vector has no tangential component at all, which
 * is what makes it composable with {@link vortexField}.
 *
 * **Sign convention: positive `strength` pushes outward** (a repulsor), negative
 * pulls inward (an attractor). §27's "radial gravity" is therefore
 * `radialField(center, -mu)`. The convention is "along +r̂", chosen because it is
 * the one that can be read off the formula rather than remembered.
 *
 * **Falloff: inverse-square, pinned (WP-9.2).** Linear falloff was the
 * alternative the plan allowed. Inverse-square wins because it is the physical
 * law §27 names ("radial *gravity*"), because `strength` then reads as a
 * standard gravitational parameter `μ = G·M` in units³/s², and because it is the
 * law under which the emitter's semi-implicit integrator is symplectic and
 * therefore does not pump energy into a closed orbit. A configurable falloff
 * exponent is **staged**: one law with an exact closed form is worth more today
 * than three approximate ones.
 *
 * **Exactly at the centre** (`d === 0`) the direction is undefined, so the field
 * contributes `(0, 0, 0)`. Not `NaN`, and not an arbitrary axis — a particle
 * sitting exactly on an attractor stays there, which is the only answer that
 * does not depend on which way the floating-point noise happened to fall.
 *
 * @param center World position of the singularity, copied.
 * @param strength Signed `μ` in units³/s²; positive is outward.
 * @throws RangeError if any component of `center`, or `strength`, or
 * `options.minDistance`, is not finite, or if `minDistance <= 0`.
 */
export function radialField(
  center: Vector3,
  strength: number,
  options?: RadialFieldOptions,
): ParticleForceField {
  const cx = assertFinite(center.x, "radialField", "center.x");
  const cy = assertFinite(center.y, "radialField", "center.y");
  const cz = assertFinite(center.z, "radialField", "center.z");
  const s = assertFinite(strength, "radialField", "strength");
  const minDistance = assertFiniteAbove(
    options?.minDistance ?? DEFAULT_RADIAL_MIN_DISTANCE,
    0,
    "radialField",
    "minDistance",
  );
  const scratch = new Vector3();

  const field: ParticleForceField = {
    gpuField: {
      kind: "radial",
      originX: cx,
      originY: cy,
      originZ: cz,
      strength: s,
      minDistance,
    },
    sample(position, _velocity, _time, out = scratch): Vector3 {
      const rx = position.x - cx;
      const ry = position.y - cy;
      const rz = position.z - cz;
      const distance = Math.sqrt(rx * rx + ry * ry + rz * rz);
      if (distance === 0) {
        return out.set(0, 0, 0);
      }
      const clamped = distance < minDistance ? minDistance : distance;
      // magnitude / distance folds the unit-vector division into the law, so
      // there is one divide rather than two.
      const scale = s / (clamped * clamped * distance);
      return out.set(rx * scale, ry * scale, rz * scale);
    },
    sampleAll(positions, _velocities, count, _time, out): void {
      for (let i = 0; i < count; i += 1) {
        const base = i * 3;
        const rx = positions[base] - cx;
        const ry = positions[base + 1] - cy;
        const rz = positions[base + 2] - cz;
        const distance = Math.sqrt(rx * rx + ry * ry + rz * rz);
        if (distance === 0) {
          // `+= 0`, not an early `continue`: `sample` adds an explicit zero
          // here, and adding a positive zero to a negative-zero accumulator is
          // not the same float as adding nothing. This path exists to be
          // bit-identical, so it adds what the scalar path adds.
          out[base] += 0;
          out[base + 1] += 0;
          out[base + 2] += 0;
          continue;
        }
        const clamped = distance < minDistance ? minDistance : distance;
        const scale = s / (clamped * clamped * distance);
        out[base] += rx * scale;
        out[base + 1] += ry * scale;
        out[base + 2] += rz * scale;
      }
    },
  };
  return field;
}

/** Options of {@link vortexField}. */
export interface VortexFieldOptions {
  /**
   * Distance floor in world units, default {@link DEFAULT_VORTEX_MIN_DISTANCE},
   * measured **perpendicular to the axis**. Must be finite and `> 0`.
   *
   * Caps the tangential acceleration at `|strength| / minDistance`
   * (`100 · |strength|` at the default). Same advice as
   * {@link RadialFieldOptions.minDistance}: raise it to the visible radius of
   * the vortex core.
   */
  readonly minDistance?: number;
}

/**
 * §27's *vortex*: a purely tangential swirl around the line through `center`
 * along `axis`.
 *
 * ```text
 * â       = axis / |axis|                     (normalized at construction)
 * r       = position − center
 * r∥      = (r · â) â                         (component along the axis)
 * r⊥      = r − r∥,   d = |r⊥|                (distance from the axis)
 * t       = â × r     = â × r⊥,   |t| = d
 * a       = strength · (t / d) / max(d, minDistance)
 * ```
 *
 * so the **magnitude is `|strength| / max(d, minDistance)`** — inverse-distance,
 * one power gentler than {@link radialField} — and the **direction is `â × r̂⊥`**,
 * a unit vector perpendicular to both the axis and `r`. Two properties follow
 * exactly (both pinned by the tests):
 *
 * - `a · â = 0` — nothing is pushed along the axis;
 * - `a · r = 0` — **no radial component**, so a vortex alone neither sucks
 *   particles in nor throws them out. Pair it with {@link radialField} for an
 *   inward spiral; that separation is the reason the two are distinct fields.
 *
 * **Handedness follows the right-hand rule**: with `axis = +Y`, a particle at
 * `+X` is pushed toward `−Z` (`ŷ × x̂ = −ẑ`), i.e. counter-clockwise when viewed
 * from `+Y` looking down at the XZ plane in a right-handed Y-up world (§7a).
 * Negate `strength` to reverse it.
 *
 * **On the axis** (`d === 0`) the tangent is undefined, so the field contributes
 * `(0, 0, 0)`.
 *
 * @param center A point on the vortex axis, copied.
 * @param axis Axis direction, copied and normalized. Need not be unit length.
 * @param strength Signed tangential strength in units²/s².
 * @throws RangeError if any component of `center` or `axis`, or `strength`, or
 * `options.minDistance`, is not finite; if `minDistance <= 0`; or if `axis` has
 * zero length (unlike a cone direction, a vortex has no sensible default axis).
 */
export function vortexField(
  center: Vector3,
  axis: Vector3,
  strength: number,
  options?: VortexFieldOptions,
): ParticleForceField {
  const cx = assertFinite(center.x, "vortexField", "center.x");
  const cy = assertFinite(center.y, "vortexField", "center.y");
  const cz = assertFinite(center.z, "vortexField", "center.z");
  const rawX = assertFinite(axis.x, "vortexField", "axis.x");
  const rawY = assertFinite(axis.y, "vortexField", "axis.y");
  const rawZ = assertFinite(axis.z, "vortexField", "axis.z");
  const axisLength = Math.sqrt(rawX * rawX + rawY * rawY + rawZ * rawZ);
  if (axisLength === 0) {
    throw new RangeError(
      "vortexField: axis must have non-zero length; received (0, 0, 0)",
    );
  }
  const ax = rawX / axisLength;
  const ay = rawY / axisLength;
  const az = rawZ / axisLength;
  const s = assertFinite(strength, "vortexField", "strength");
  const minDistance = assertFiniteAbove(
    options?.minDistance ?? DEFAULT_VORTEX_MIN_DISTANCE,
    0,
    "vortexField",
    "minDistance",
  );
  const scratch = new Vector3();

  const field: ParticleForceField = {
    gpuField: {
      kind: "vortex",
      centerX: cx,
      centerY: cy,
      centerZ: cz,
      axisX: ax,
      axisY: ay,
      axisZ: az,
      strength: s,
      minDistance,
    },
    sample(position, _velocity, _time, out = scratch): Vector3 {
      const rx = position.x - cx;
      const ry = position.y - cy;
      const rz = position.z - cz;
      // â × r is already perpendicular to the axis and to r, and its length is
      // exactly the distance from the axis — so the perpendicular component of
      // r never has to be formed.
      const tx = ay * rz - az * ry;
      const ty = az * rx - ax * rz;
      const tz = ax * ry - ay * rx;
      const distance = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (distance === 0) {
        return out.set(0, 0, 0);
      }
      const clamped = distance < minDistance ? minDistance : distance;
      const scale = s / (clamped * distance);
      return out.set(tx * scale, ty * scale, tz * scale);
    },
    sampleAll(positions, _velocities, count, _time, out): void {
      for (let i = 0; i < count; i += 1) {
        const base = i * 3;
        const rx = positions[base] - cx;
        const ry = positions[base + 1] - cy;
        const rz = positions[base + 2] - cz;
        const tx = ay * rz - az * ry;
        const ty = az * rx - ax * rz;
        const tz = ax * ry - ay * rx;
        const distance = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (distance === 0) {
          // See `radialField.sampleAll` on why this adds zero rather than
          // skipping.
          out[base] += 0;
          out[base + 1] += 0;
          out[base + 2] += 0;
          continue;
        }
        const clamped = distance < minDistance ? minDistance : distance;
        const scale = s / (clamped * distance);
        out[base] += tx * scale;
        out[base + 1] += ty * scale;
        out[base + 2] += tz * scale;
      }
    },
  };
  return field;
}

/** Options of {@link turbulenceField}. */
export interface TurbulenceFieldOptions {
  /**
   * Lattice cells per world unit, default
   * {@link DEFAULT_TURBULENCE_FREQUENCY}. Must be finite and `> 0`. Higher means
   * smaller eddies. It does **not** change the strength of the field — see the
   * honesty note on normalisation.
   */
  readonly frequency?: number;

  /**
   * Hard per-component bound in units/s², default
   * {@link DEFAULT_TURBULENCE_AMPLITUDE}: every returned component satisfies
   * `|componentᵢ| ≤ |amplitude|`. It is a *bound*, not the typical magnitude —
   * see the honesty note. A negative value mirrors the field; the bound uses the
   * absolute value.
   */
  readonly amplitude?: number;

  /**
   * World-space velocity at which the noise lattice drifts, in units/s, copied.
   * Default `(0, 0, 0)`, which makes the field **completely time-independent**.
   *
   * With a non-zero value the field is sampled at `position − scroll · time`, so
   * `sample(p, v, t)` equals `sample(p − scroll·t, v, 0)` exactly. This is
   * advection of a frozen pattern ("Taylor's frozen turbulence hypothesis"), not
   * an evolving flow: an observer drifting with `scroll` sees a *constant* force
   * forever. True 4D evolution is staged — it needs a fourth noise dimension,
   * which costs 16 lattice hashes per scalar sample instead of 8.
   */
  readonly scroll?: Vector3;
}

/**
 * §27's *turbulence/noise*: a smooth, deterministic, seed-driven swirl field.
 *
 * ```ts
 * const gust = turbulenceField(1337, { frequency: 0.5, amplitude: 3 });
 * ```
 *
 * ## Exactly what this is (honesty statement, WP-9.2)
 *
 * It is the **central-difference curl of a three-channel hash-based value-noise
 * vector potential, normalised by the stencil's analytic maximum**. Written out,
 * with `s = (position − scroll·time) · frequency` in lattice space and
 * `d = `{@link TURBULENCE_DIFFERENCE_CELLS}:
 *
 * ```text
 * ψc(s)  = trilinear-interpolated value noise, channel c ∈ {x, y, z},
 *          quintic fade, lattice values hashed from the seed;  |ψc| ≤ 1
 *
 * aₓ = (amplitude / 4) · [ (ψz(s + d·ŷ) − ψz(s − d·ŷ)) − (ψy(s + d·ẑ) − ψy(s − d·ẑ)) ]
 * a_y = (amplitude / 4) · [ (ψx(s + d·ẑ) − ψx(s − d·ẑ)) − (ψz(s + d·x̂) − ψz(s − d·x̂)) ]
 * a_z = (amplitude / 4) · [ (ψy(s + d·x̂) − ψy(s − d·x̂)) − (ψx(s + d·ŷ) − ψx(s − d·ŷ)) ]
 * ```
 *
 * The `/4` is the normalisation: each bracket is a difference of two differences
 * of values in `[−1, 1]`, so it lies in `[−4, 4]`, and hence
 * **`|componentᵢ| ≤ |amplitude|` always**. That bound is what the tests assert.
 *
 * ### Limitations — all of them, stated plainly
 *
 * - **It is value noise, not Perlin or simplex noise.** The lattice values are
 *   scalars hashed from the integer cell corners and interpolated; there are no
 *   gradients. Value noise is cheaper and easier to bound, but it has visible
 *   **axis-aligned structure** and a blockier spectrum than gradient noise. It
 *   is one octave: there is no fBm/fractal sum, so there is exactly one eddy
 *   size, `1 / frequency` world units. Octaves are staged (they multiply the
 *   96-hash cost per sample by the octave count).
 * - **The curl is a finite difference, not an analytic derivative, and the
 *   field is _not_ divergence-free in any useful sense.** Central-difference
 *   operators commute, so the divergence measured with *this very stencil and
 *   step* is zero — measured, 3.4 × 10⁻¹⁵, i.e. float rounding. That is a
 *   lattice identity, not a property of the field: measured with a step of
 *   `0.37·d` instead, the divergence is ≈ 0.54 at the defaults, which is not
 *   small. **No incompressibility claim is made and none is tested.** Treat
 *   "curl of a potential" as a description of the construction — it is what
 *   makes the field swirl instead of converging on sinks — not as physics.
 * - **`amplitude` is an upper bound, not a typical magnitude.** The worst case
 *   needs four lattice corners to hit `±1` in the right pattern. Measured over
 *   20 000 seeded sample points (60 000 components) spread over ±50 world units,
 *   at frequencies 0.25, 1 and 4: the **RMS of a single component is
 *   ≈ 0.186·amplitude** and the **largest component seen is ≈ 0.76·amplitude**,
 *   essentially independent of frequency. Author with that factor in mind, or
 *   measure your own configuration; `tests/fields.test.ts` pins a conservative
 *   version of the same statement.
 * - **Time does nothing unless {@link TurbulenceFieldOptions.scroll} is set.**
 *   See that option: the pattern is frozen and advected, not evolving.
 * - **The lattice is unbounded but not infinite-precision.** Cell indices go
 *   through `ToUint32` inside the hash, so coordinates beyond ±2³¹ cells alias
 *   back onto the pattern. At the default frequency that is ±2 billion world
 *   units.
 * - **Non-finite input gives `NaN` out.** Nothing is guarded on the hot path.
 * - The field is smooth: the quintic fade makes each `ψc` C², so the sampled
 *   acceleration is C² in space and Lipschitz — no popping as a particle
 *   crosses a cell boundary.
 *
 * ## Determinism (§33)
 *
 * `Math.random` is never called. The constructor draws exactly **three**
 * `uint32`s from `new SeededRandom(seed)` — one salt per channel — and every
 * lattice value afterwards is an integer hash of `(cell x, cell y, cell z,
 * salt)` built from `Math.imul`, xor and shift, all of which ECMAScript defines
 * bit-exactly on every engine. The same seed therefore gives the same field
 * everywhere and forever, and two fields with the same seed are
 * indistinguishable. The seed is a uint32 under the same `ToUint32` reduction
 * {@link SeededRandom} documents.
 *
 * ## Cost
 *
 * One sample evaluates 12 scalar noises × 8 lattice hashes = **96 hashes**. It
 * is by a wide margin the most expensive field here; wrap it in
 * {@link volumeField} to pay for it only where it shows.
 *
 * @param seed uint32 stream seed (§33).
 * @throws RangeError if `seed` is not finite (via {@link SeededRandom}), if
 * `frequency` is not finite or not `> 0`, or if `amplitude` or any component of
 * `scroll` is not finite.
 */
export function turbulenceField(
  seed: number,
  options?: TurbulenceFieldOptions,
): ParticleForceField {
  const frequency = assertFiniteAbove(
    options?.frequency ?? DEFAULT_TURBULENCE_FREQUENCY,
    0,
    "turbulenceField",
    "frequency",
  );
  const amplitude = assertFinite(
    options?.amplitude ?? DEFAULT_TURBULENCE_AMPLITUDE,
    "turbulenceField",
    "amplitude",
  );
  const scrollX = assertFinite(
    options?.scroll?.x ?? 0,
    "turbulenceField",
    "scroll.x",
  );
  const scrollY = assertFinite(
    options?.scroll?.y ?? 0,
    "turbulenceField",
    "scroll.y",
  );
  const scrollZ = assertFinite(
    options?.scroll?.z ?? 0,
    "turbulenceField",
    "scroll.z",
  );

  // Three salts, drawn once. This is the only use of the stream: the noise
  // itself is a pure hash, so no draw order can drift.
  const random = new SeededRandom(seed);
  const saltX = random.nextUint32();
  const saltY = random.nextUint32();
  const saltZ = random.nextUint32();

  const step = TURBULENCE_DIFFERENCE_CELLS;
  const scale = amplitude / 4;
  const scratch = new Vector3();

  const field: ParticleForceField = {
    gpuField: {
      kind: "turbulence",
      saltX,
      saltY,
      saltZ,
      frequency,
      amplitude,
      scrollX,
      scrollY,
      scrollZ,
    },
    sample(position, _velocity, time, out = scratch): Vector3 {
      const sx = (position.x - scrollX * time) * frequency;
      const sy = (position.y - scrollY * time) * frequency;
      const sz = (position.z - scrollZ * time) * frequency;

      const dzy =
        valueNoise(sx, sy + step, sz, saltZ) -
        valueNoise(sx, sy - step, sz, saltZ);
      const dyz =
        valueNoise(sx, sy, sz + step, saltY) -
        valueNoise(sx, sy, sz - step, saltY);
      const dxz =
        valueNoise(sx, sy, sz + step, saltX) -
        valueNoise(sx, sy, sz - step, saltX);
      const dzx =
        valueNoise(sx + step, sy, sz, saltZ) -
        valueNoise(sx - step, sy, sz, saltZ);
      const dyx =
        valueNoise(sx + step, sy, sz, saltY) -
        valueNoise(sx - step, sy, sz, saltY);
      const dxy =
        valueNoise(sx, sy + step, sz, saltX) -
        valueNoise(sx, sy - step, sz, saltX);

      return out.set(
        scale * (dzy - dyz),
        scale * (dxz - dzx),
        scale * (dyx - dxy),
      );
    },
    sampleAll(positions, _velocities, count, time, out): void {
      for (let i = 0; i < count; i += 1) {
        const base = i * 3;
        const sx = (positions[base] - scrollX * time) * frequency;
        const sy = (positions[base + 1] - scrollY * time) * frequency;
        const sz = (positions[base + 2] - scrollZ * time) * frequency;

        const dzy =
          valueNoise(sx, sy + step, sz, saltZ) -
          valueNoise(sx, sy - step, sz, saltZ);
        const dyz =
          valueNoise(sx, sy, sz + step, saltY) -
          valueNoise(sx, sy, sz - step, saltY);
        const dxz =
          valueNoise(sx, sy, sz + step, saltX) -
          valueNoise(sx, sy, sz - step, saltX);
        const dzx =
          valueNoise(sx + step, sy, sz, saltZ) -
          valueNoise(sx - step, sy, sz, saltZ);
        const dyx =
          valueNoise(sx + step, sy, sz, saltY) -
          valueNoise(sx - step, sy, sz, saltY);
        const dxy =
          valueNoise(sx, sy + step, sz, saltX) -
          valueNoise(sx, sy - step, sz, saltX);

        out[base] += scale * (dzy - dyz);
        out[base + 1] += scale * (dxz - dzx);
        out[base + 2] += scale * (dyx - dxy);
      }
    },
  };
  return field;
}

/**
 * An axis-aligned sphere for {@link volumeField}.
 *
 * The weight is `1` at distance `≤ radius − falloff` from `center`, smoothly
 * ramps to `0` at `radius`, and is exactly `0` beyond it.
 */
export interface SphereFieldVolume {
  readonly shape: "sphere";
  /** Centre in world space, copied. */
  readonly center: Vector3;
  /** Radius in world units. Finite and `> 0`. */
  readonly radius: number;
  /**
   * Width of the inward edge fade in world units, default `0` (a hard edge).
   * Finite and `>= 0`. A value larger than `radius` is legal and simply means
   * the weight never reaches `1`, peaking at the centre.
   */
  readonly falloff?: number;
}

/**
 * An **axis-aligned** box for {@link volumeField}. Rotated boxes are staged:
 * they need an inverse transform per sample, and §27 asks for volume inclusion,
 * not for a transform hierarchy.
 */
export interface BoxFieldVolume {
  readonly shape: "box";
  /** Centre in world space, copied. */
  readonly center: Vector3;
  /**
   * **Half**-extents in world units — the box spans `center ± extents`. Every
   * component finite and `> 0`. (Half, not full, so a cube of side 2 is
   * `(1, 1, 1)`; that matches how §22's box collider is authored.)
   */
  readonly extents: Vector3;
  /**
   * Width of the inward edge fade in world units, applied per axis, default `0`.
   * Finite and `>= 0`.
   */
  readonly falloff?: number;
}

/** The volume shapes {@link volumeField} understands (§27, MVP tier). */
export type FieldVolume = SphereFieldVolume | BoxFieldVolume;

/**
 * §27's **volume-based inclusion and filtering**: restricts any field to a
 * region, with an optional soft edge.
 *
 * ```ts
 * volumeField(windField(new Vector3(4, 0, 0), 1.5), {
 *   shape: "box",
 *   center: new Vector3(0, 2, 0),
 *   extents: new Vector3(3, 2, 3),   // half-extents
 *   falloff: 0.5,
 * });
 * ```
 *
 * Both halves of §27's phrase are here: **inclusion** is the hard test (outside
 * the volume the field contributes exactly `(0, 0, 0)`), **filtering** is the
 * weight (`out = w · inner.sample(...)` with `w ∈ [0, 1]`).
 *
 * The weight is computed from the **position only** — never from velocity or
 * time — as `smoothstep(t)` where `t` is the normalised depth inside the edge
 * band, `smoothstep(t) = t²(3 − 2t)`. Smoothstep rather than a linear ramp
 * because a linear weight has a discontinuous derivative at both ends of the
 * band, which is visible as a crease when a particle drifts through it. The
 * weight is **monotone non-increasing** as the sample point moves outward along
 * any ray from the centre, on both shapes; for the box, `t` is the *minimum* of
 * the three per-axis depths, so the weight is governed by whichever face is
 * nearest and the fade bands simply overlap in the corners.
 *
 * **Outside the volume the inner field is not sampled at all.** That is the
 * performance point of wrapping {@link turbulenceField}, and it is observable:
 * an inner field that counted its calls would see fewer. Inner fields are
 * required to be pure (§33), so this is not a behavioural difference.
 *
 * Wrapping composes — `volumeField(volumeField(f, a), b)` multiplies the two
 * weights — but each layer costs a virtual call.
 *
 * @param inner The field to restrict. Sampled with the *same* `out` this field
 * was given, so a well-behaved inner field allocates nothing.
 * @param volume Sphere or box, copied.
 * @throws RangeError if any component of `center` or `extents`, or `radius`, or
 * `falloff`, is not finite; if `radius` or any extent is `<= 0`; or if `falloff`
 * is negative.
 */
export function volumeField(
  inner: ParticleForceField,
  volume: FieldVolume,
): ParticleForceField {
  const label = `volumeField(${volume.shape})`;
  const cx = assertFinite(volume.center.x, label, "center.x");
  const cy = assertFinite(volume.center.y, label, "center.y");
  const cz = assertFinite(volume.center.z, label, "center.z");
  const falloff = assertFiniteAtLeast(volume.falloff ?? 0, 0, label, "falloff");
  const hasFade = falloff > 0;
  const scratch = new Vector3();
  // Scratch for the batched path only, so that a `sampleAll` running while a
  // caller still holds the result of a `sample` cannot overwrite it.
  const batchPosition = new Vector3();
  const batchVelocity = new Vector3();
  const batchForce = new Vector3();

  // Half-extents for the box; for the sphere, `radius` in all three so the
  // hard-inclusion test can share a shape (it is not used for the sphere's
  // distance test).
  let ex = 0;
  let ey = 0;
  let ez = 0;
  let radius = 0;
  if (volume.shape === "sphere") {
    radius = assertFiniteAbove(volume.radius, 0, label, "radius");
  } else {
    ex = assertFiniteAbove(volume.extents.x, 0, label, "extents.x");
    ey = assertFiniteAbove(volume.extents.y, 0, label, "extents.y");
    ez = assertFiniteAbove(volume.extents.z, 0, label, "extents.z");
  }
  const isSphere = volume.shape === "sphere";

  // The device record: the inner field's, wrapped. A hand-written inner field
  // (no `gpuField`) or an already-volumed one cannot be expressed, so the
  // wrapper carries none and `simulation: "gpu"` refuses it.
  const innerGpu = inner.gpuField;
  const gpuVolume: ParticleGpuVolume = {
    shape: volume.shape,
    centerX: cx,
    centerY: cy,
    centerZ: cz,
    radius,
    extentX: ex,
    extentY: ey,
    extentZ: ez,
    falloff,
  };

  const field: ParticleForceField = {
    ...(innerGpu !== undefined && innerGpu.volume === undefined
      ? { gpuField: { ...innerGpu, volume: gpuVolume } }
      : {}),
    sample(position, velocity, time, out = scratch): Vector3 {
      const px = position.x - cx;
      const py = position.y - cy;
      const pz = position.z - cz;

      // `depth` is the distance from the sample point to the boundary, measured
      // inward: > 0 inside, <= 0 outside. For the box it is the smallest of the
      // three per-axis depths, which is what makes a corner fade first.
      let depth: number;
      if (isSphere) {
        depth = radius - Math.sqrt(px * px + py * py + pz * pz);
      } else {
        const dx = ex - Math.abs(px);
        const dy = ey - Math.abs(py);
        const dz = ez - Math.abs(pz);
        depth = dx < dy ? dx : dy;
        depth = depth < dz ? depth : dz;
      }

      if (depth <= 0) {
        return out.set(0, 0, 0);
      }

      let weight = 1;
      if (hasFade && depth < falloff) {
        const t = depth / falloff;
        weight = t * t * (3 - 2 * t);
      }

      const sampled = inner.sample(position, velocity, time, out);
      // Read before writing: `sampled` may legitimately *be* `out`.
      const sx = sampled.x;
      const sy = sampled.y;
      const sz = sampled.z;
      return out.set(sx * weight, sy * weight, sz * weight);
    },
    sampleAll(positions, velocities, count, time, out): void {
      // The inner field is sampled **scalar**, deliberately: the weight is
      // per-particle, and the batched entry point is defined to *add* into the
      // accumulator, so there is nowhere for an inner batch to deposit a value
      // this wrapper could still scale. What this batch does win is the one
      // thing a volume is for — a particle outside the volume costs a distance
      // test and nothing else, where the scalar path pays the wrapper call too.
      for (let i = 0; i < count; i += 1) {
        const base = i * 3;
        const px = positions[base] - cx;
        const py = positions[base + 1] - cy;
        const pz = positions[base + 2] - cz;

        let depth: number;
        if (isSphere) {
          depth = radius - Math.sqrt(px * px + py * py + pz * pz);
        } else {
          const dx = ex - Math.abs(px);
          const dy = ey - Math.abs(py);
          const dz = ez - Math.abs(pz);
          depth = dx < dy ? dx : dy;
          depth = depth < dz ? depth : dz;
        }

        if (depth <= 0) {
          out[base] += 0;
          out[base + 1] += 0;
          out[base + 2] += 0;
          continue;
        }

        let weight = 1;
        if (hasFade && depth < falloff) {
          const t = depth / falloff;
          weight = t * t * (3 - 2 * t);
        }

        const position = batchPosition.set(
          positions[base],
          positions[base + 1],
          positions[base + 2],
        );
        const velocity = batchVelocity.set(
          velocities[base],
          velocities[base + 1],
          velocities[base + 2],
        );
        const sampled = inner.sample(position, velocity, time, batchForce);
        out[base] += sampled.x * weight;
        out[base + 1] += sampled.y * weight;
        out[base + 2] += sampled.z * weight;
      }
    },
  };
  return field;
}

// ---------------------------------------------------------------------------
// Value noise — the machinery behind `turbulenceField`. Not exported: it is an
// implementation detail of one field, and pinning it as public API would freeze
// the noise algorithm.
// ---------------------------------------------------------------------------

/** `2³²`, the scale that turns a uint32 hash into a fraction. */
const TWO_POW_32 = 4294967296;

/** Mixing multipliers of {@link hashCell}. Arbitrary odd constants; nothing depends on them beyond "the same seed gives the same field". */
const HASH_MULTIPLIER_X = 0x27d4eb2d;
const HASH_MULTIPLIER_Y = 0x85ebca6b;
const HASH_MULTIPLIER_Z = 0xc2b2ae35;
const HASH_MULTIPLIER_FINAL = 0x9e3779b1;

/**
 * A uint32 hash of one lattice cell corner, salted per channel.
 *
 * Integer-only (`Math.imul`, `^`, `>>>`), so it is bit-identical on every
 * engine (§33). Cell indices are reduced by `ToUint32` inside `Math.imul`, which
 * is where the ±2³¹ aliasing documented on {@link turbulenceField} comes from.
 */
function hashCell(ix: number, iy: number, iz: number, salt: number): number {
  let h = salt | 0;
  h = Math.imul(h ^ ix, HASH_MULTIPLIER_X);
  h ^= h >>> 15;
  h = Math.imul(h ^ iy, HASH_MULTIPLIER_Y);
  h ^= h >>> 13;
  h = Math.imul(h ^ iz, HASH_MULTIPLIER_Z);
  h ^= h >>> 16;
  h = Math.imul(h, HASH_MULTIPLIER_FINAL);
  h ^= h >>> 16;
  return h >>> 0;
}

/** One lattice corner value in `[−1, 1)`. Exact: a uint32 scaled by a power of two. */
function cornerValue(ix: number, iy: number, iz: number, salt: number): number {
  return (hashCell(ix, iy, iz, salt) / TWO_POW_32) * 2 - 1;
}

/**
 * Ken Perlin's quintic fade `6t⁵ − 15t⁴ + 10t³`, whose first *and* second
 * derivatives vanish at `t = 0` and `t = 1` — that is what makes the
 * interpolated field C² and therefore the finite-difference curl smooth.
 */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Trilinearly interpolated value noise at `(x, y, z)` in lattice space, in
 * `[−1, 1]`: eight hashed corner values blended with the quintic fade.
 */
function valueNoise(x: number, y: number, z: number, salt: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const ux = fade(x - ix);
  const uy = fade(y - iy);
  const uz = fade(z - iz);

  const c000 = cornerValue(ix, iy, iz, salt);
  const c100 = cornerValue(ix + 1, iy, iz, salt);
  const c010 = cornerValue(ix, iy + 1, iz, salt);
  const c110 = cornerValue(ix + 1, iy + 1, iz, salt);
  const c001 = cornerValue(ix, iy, iz + 1, salt);
  const c101 = cornerValue(ix + 1, iy, iz + 1, salt);
  const c011 = cornerValue(ix, iy + 1, iz + 1, salt);
  const c111 = cornerValue(ix + 1, iy + 1, iz + 1, salt);

  const x00 = c000 + (c100 - c000) * ux;
  const x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux;
  const x11 = c011 + (c111 - c011) * ux;
  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

// ---------------------------------------------------------------------------
// Argument validation. Deliberately duplicated from `emitter.ts`'s private
// helpers rather than exported from it: they differ in that these carry the
// factory's name, and a shared "assert" module would be a public surface this
// package does not want.
// ---------------------------------------------------------------------------

/** Rejects a non-finite argument. */
function assertFinite(value: number, factory: string, name: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `${factory}: ${name} must be a finite number; received ${String(value)}`,
    );
  }
  return value;
}

/** Rejects a non-finite argument or one below `bound`. */
function assertFiniteAtLeast(
  value: number,
  bound: number,
  factory: string,
  name: string,
): number {
  if (!Number.isFinite(value) || value < bound) {
    throw new RangeError(
      `${factory}: ${name} must be a finite number >= ${String(bound)}; received ${String(value)}`,
    );
  }
  return value;
}

/** Rejects a non-finite argument or one not strictly above `bound`. */
function assertFiniteAbove(
  value: number,
  bound: number,
  factory: string,
  name: string,
): number {
  if (!Number.isFinite(value) || value <= bound) {
    throw new RangeError(
      `${factory}: ${name} must be a finite number > ${String(bound)}; received ${String(value)}`,
    );
  }
  return value;
}
