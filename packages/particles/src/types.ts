/**
 * Shared particle types (§27, §36) — the vocabulary WP-9.1's pool and emitter
 * speak, and the seam WP-9.2's force fields implement against.
 *
 * Nothing here has behaviour: it is the interface plus the option records, kept
 * in one module so `pool.ts`, `emitter.ts`, and (next packet) the built-in field
 * set do not have to import each other to agree on a shape.
 *
 * ## Where `ParticleForceField` comes from — and where it does *not*
 *
 * **The interface is §27's, not this packet's.** §27 (*Force Fields*) declares:
 *
 * ```ts
 * interface ForceField {
 *   sample(
 *     position: Vector3,
 *     velocity: Vector3,
 *     time: number,
 *     out?: Vector3
 *   ): Vector3;
 * }
 * ```
 *
 * {@link ParticleForceField} below is that declaration, transcribed
 * member-for-member. Two honest notes about it:
 *
 * 1. **The name is local.** §27 calls the type `ForceField`; the plan gives its
 *    built-in set (uniform gravity, radial gravity, vortex, wind, drag,
 *    turbulence, …) to **WP-9.2**, in this same package (plan P9-2), and §27
 *    also serves physics force volumes (§26) which are not particles. The
 *    `Particle` prefix marks this declaration as *the particle system's view of*
 *    §27's contract, so that if a later packet lands a general `ForceField` in
 *    another package, the two can be reconciled without a rename churn here.
 *    They are structurally identical, so any §27 field satisfies this type
 *    without an adapter.
 * 2. **This packet implements no fields.** WP-9.1 ships only the *application*
 *    of fields (`emitter.ts` samples every field once per particle per step, in
 *    declaration order). **WP-9.2 ships the implementations** and §27's
 *    volume-based inclusion and filtering. Anything you can write that has a
 *    conforming `sample` works today — that is the point of taking the type as
 *    the seam.
 *
 * ## Units, and what a sampled vector means (decision, WP-9.1)
 *
 * §27 names the type "force field" but MVP particles carry **no mass channel**
 * (see `pool.ts`: position, velocity, age, lifetime, size, colour — no mass), so
 * there is nothing to divide by. WP-9.1 therefore pins: **a sampled vector is
 * applied as an acceleration, in units/s², i.e. particles are unit-mass.** For
 * every field in §27's built-in list this is the same thing up to a constant the
 * author picks anyway (a "gravity" field is authored as −9.81 m/s², not as
 * newtons), and it keeps a per-particle divide off the hot path. If a mass
 * channel is ever added, the interface does not change — the application in
 * `emitter.ts` does.
 *
 * Times are seconds and angles radians throughout (§7a); the world is
 * right-handed and **Y-up in both 2D and 3D**, so the conventional gravity is
 * `(0, −9.81, 0)`.
 */

import type { Vector3 } from "@fourjs/math";

/**
 * §27's `ForceField`, as particles consume it. See the module note for the
 * naming and the units.
 *
 * ```ts
 * const wind: ParticleForceField = {
 *   sample(_position, _velocity, time, out) {
 *     const target = out ?? new Vector3();
 *     return target.set(Math.sin(time), 0, 0);
 *   },
 * };
 * ```
 *
 * Contract for an implementation:
 *
 * - **Do not mutate `position` or `velocity`.** They are the caller's scratch
 *   copies of the particle's live state; writing to them corrupts the step.
 * - **Write into `out` when it is supplied and return it** — the emitter always
 *   supplies one, and doing so is what keeps the hot path allocation-free
 *   (§7b, plan D7). Returning a *different* vector is legal (the caller reads
 *   the return value, never `out`), but that vector must stay valid until the
 *   next call.
 * - **`out` is not zeroed** by the caller. Write every component.
 * - **Be a pure function of its arguments** (§33). No clock — the absolute
 *   simulation time arrives as `time`, in seconds. No `Math.random` — take a
 *   `SeededRandom` at construction if the field is procedural.
 */
export interface ParticleForceField {
  /**
   * Acceleration contributed at `position`, for a particle moving at
   * `velocity`, at absolute simulation time `time` (seconds).
   */
  sample(
    position: Vector3,
    velocity: Vector3,
    time: number,
    out?: Vector3,
  ): Vector3;

  // --- R-34: §27 batched field sampling (begin) ---
  /**
   * **Optional fast path**: the same contribution as {@link
   * ParticleForceField.sample}, for `count` particles at once, **added into**
   * `out` (R-34, §27/§112).
   *
   * ```ts
   * sampleAll(positions, velocities, count, time, out) {
   *   for (let i = 0; i < count; i += 1) {
   *     const base = i * 3;
   *     out[base] += -c * velocities[base];
   *     out[base + 1] += -c * velocities[base + 1];
   *     out[base + 2] += -c * velocities[base + 2];
   *   }
   * }
   * ```
   *
   * ## Why it exists
   *
   * Measured attribution in `benchmarks/results/particles-100k.json`: the
   * integrator alone costs 1.31 ms per 100 000 particles, and **each** field
   * adds ~5.15 ms — three fields consume the whole 16.67 ms fixed-step budget.
   * Almost none of that is the field's arithmetic. It is one megamorphic
   * `sample()` call, two `Vector3.set`s, and three property reads, per particle
   * per field. A field that loops internally pays the call once per step
   * instead of once per particle, and JIT-inlines its own monomorphic body.
   *
   * ## Contract
   *
   * - **Add, do not assign.** `out` arrives carrying the emitter's gravity and
   *   every earlier field's contribution; overwriting it deletes them. (This is
   *   the one place this entry point departs from §27's `sample`, which
   *   produces a value. Producing here would force the emitter to allocate a
   *   second buffer and make a third pass over 3 × `count` floats per field,
   *   which is most of the win.)
   * - **`out` is a `Float64Array`, not `Float32Array`.** The scalar path
   *   accumulates in JavaScript numbers, i.e. binary64; a binary32 accumulator
   *   would round after every field and make a batched run differ from a scalar
   *   one in the last bits. §33 does not permit "fast, and also slightly
   *   different".
   * - **Be bit-identical to `sample`.** Same arithmetic, same order of
   *   operations, same special cases. A field that ships both owes a test that
   *   pins them against each other — every built-in field has one.
   * - `positions` and `velocities` are the pool's live arrays, `xyz` at stride
   *   3, valid for indices `[0, 3 · count)`. **Read, never write.**
   * - Same purity rules as `sample`: no clock, no `Math.random`.
   *
   * A field that does not implement this is not penalised: the emitter falls
   * back to `sample` for that field alone, in the same declaration order, with
   * the same result.
   */
  sampleAll?(
    positions: Float32Array,
    velocities: Float32Array,
    count: number,
    time: number,
    out: Float64Array,
  ): void;
  // --- R-34: §27 batched field sampling (end) ---

  /**
   * When present, a `simulation: "gpu"` emitter may apply this field on
   * the device. Absent on every built-in except `radialField`.
   */
  readonly gpuField?: ParticleGpuRadialField;
}

/**
 * §36's `simulation` option: who integrates positions and velocities.
 *
 * - `"cpu"` — the emitter's own loop (`emitter.ts`), the default and the
 *   only §33 `same-runtime` tier.
 * - `"gpu"` — a bound {@link ParticleGpuSimulation} integrates on the
 *   device; the pool's position/velocity lanes hold **spawn-time values
 *   only** thereafter. See {@link ParticleGpuSimulation} for the contract
 *   and the determinism posture.
 *
 * Widened from the historical type-level absence in the same change that
 * wired the WebGPU integrator to the emitter (R-31 residue, 2026-08-29) —
 * the recorded WP-9.1 rule: an option that silently does nothing is worse
 * than one that does not exist yet, so the spelling and the function arrive
 * together.
 */
export type ParticleSimulationMode = "cpu" | "gpu";

/**
 * §36's `collisions` option. `"none"` is the default (or the existing
 * `collisionPlaneY` bounce when that field is set). `"depth-buffer"` kills
 * particles that fall below a ground `y` on the CPU; on a GPU emitter the
 * device kernel rests them on that plane (a documented stub — true
 * depth-texture collide-and-kill needs a bound scene depth and is staged).
 */
export type ParticleCollisionMode = "none" | "depth-buffer";

/**
 * Texture-like handle or a boolean flag. A truthy value opts the emitter
 * into the wide instance stream and tells a backend to sample `map` the
 * way unlit sprites do. This package never binds a GPU texture — it only
 * carries the handle through the structural `ParticleDrawable` contract.
 */
export type ParticleTexture = object | true;

/**
 * A §27 field the GPU integrator kernel can apply. Only inverse-square
 * radial gravity ships on the device (uniform gravity is the emitter's
 * `gravity` option). CPU emitters keep {@link ParticleForceField.sample}
 * as the source of truth for every field, including radial.
 */
export interface ParticleGpuRadialField {
  readonly kind: "radial";
  readonly originX: number;
  readonly originY: number;
  readonly originZ: number;
  readonly strength: number;
  readonly minDistance: number;
}

/**
 * Optional extras a `simulation: "gpu"` integrate may carry — radial field
 * plus the depth-buffer collision stub. Omitted on the default gravity-only
 * path so existing 5-argument driver recordings stay byte-identical.
 */
export interface ParticleGpuIntegrateExtras {
  readonly radial?: ParticleGpuRadialField;
  readonly collisionGroundY?: number;
  readonly collisions?: ParticleCollisionMode;
}

/**
 * The GPU integration driver a `simulation: "gpu"` emitter steps through
 * (§36 "GPU compute simulation"; §82; gap row R-31).
 *
 * ## Who implements it, and how the pieces meet
 *
 * A compute-capable backend mints one — `@fourjs/render-webgpu`'s
 * `WebgpuRenderer.createParticleSimulation({ systemId, capacity })` is the
 * implementor today — and the application binds it with
 * `emitter.bindGpuSimulation(...)`. The interface is **structural**, like
 * {@link ParticleForceField} and `@fourjs/render`'s `ParticleDrawable`, because
 * the frozen §3.1 matrix gives this package `core`, `math`, `scene` and
 * nothing render-shaped: the two declarations are pinned against each other
 * by tests on both sides, never by the compiler.
 *
 * ## The division of labour (decision, R-31 wiring)
 *
 * **CPU spawn + GPU integrate.** Every §33-bearing decision stays on the
 * CPU — the seeded RNG stream and its pinned four-draws-per-spawn order,
 * burst scheduling, the emission accumulator, capacity accounting, ageing
 * and expiry, and the §36 ramps (functions of age, which never leaves the
 * CPU). The device takes exactly the O(n)-arithmetic half: one semi-implicit
 * Euler step per particle per fixed step, under constant gravity. That split
 * is what keeps a GPU emitter's *spawn stream* bit-identical to a CPU
 * emitter's with the same seed — pinned by test — while the integrated state
 * lives where the work is.
 *
 * ## Determinism and snapshots — the honest posture (§33, §34)
 *
 * A GPU-simulated system's positions and velocities live **on the device**.
 * They sit outside every §33 tier this engine claims: the kernel's
 * arithmetic order is fixed, but WebGPU promises no cross-adapter float
 * reproducibility, and device f32 arithmetic differs from the CPU
 * integrator's binary64 intermediates by rounding — so GPU simulation is
 * display-tier motion. No §33 golden may checksum a GPU pool, and none
 * does. §34 follows: there is no particle snapshot surface today, this
 * packet deliberately adds none for GPU emitters — a CPU-side snapshot
 * would capture spawn-stale lanes and restoring it would be a lie — and a
 * readback-based snapshot is its own future packet with its own
 * determinism argument (the GPU-readback RFC the R-1 plan names).
 * `reset()` stays valid: an empty pool needs no device state.
 *
 * ## Call contract (what the emitter guarantees the implementor)
 *
 * Per `step(dt, time)`, in order: one {@link ParticleGpuSimulation.integrate}
 * over the pre-expiry live count (skipped when that count or the delta is
 * zero — both are identity steps), then zero or more
 * {@link ParticleGpuSimulation.moveSlot} calls mirroring the pool's
 * swap-remove compaction exactly (never with `from === to`), then one
 * {@link ParticleGpuSimulation.writeSpawn} per successfully spawned
 * particle. All indices are pool slots in `[0, capacity)`.
 */
export interface ParticleGpuSimulation {
  /**
   * The brand, a literal `true` — the `isParticleDrawable` technique, so
   * the cross-package check is one property load.
   */
  readonly isParticleGpuSimulation: true;

  /**
   * Slots the device buffers were allocated for. Must equal the emitter's
   * pool capacity; `bindGpuSimulation` refuses a mismatch.
   */
  readonly capacity: number;

  /**
   * Integrates the first `count` slots by `deltaSeconds` under constant
   * gravity — `v += g·dt`, then `p += v·dt`, the emitter's documented
   * closed form. Never called with `count === 0`.
   */
  integrate(
    count: number,
    deltaSeconds: number,
    gravityX: number,
    gravityY: number,
    gravityZ: number,
    extras?: ParticleGpuIntegrateExtras,
  ): void;

  /**
   * Writes a freshly spawned particle's position and velocity into slot
   * `index` — the CPU-owned spawn state entering device residency.
   */
  writeSpawn(
    index: number,
    positionX: number,
    positionY: number,
    positionZ: number,
    velocityX: number,
    velocityY: number,
    velocityZ: number,
  ): void;

  /**
   * Copies slot `from`'s position and velocity over slot `to` — the device
   * mirror of `ParticlePool.kill`'s swap-remove (`from` is the last live
   * slot, `to` the expired one; `from`'s old contents become dead). Called
   * in exactly the CPU compaction order, never with `from === to`.
   */
  moveSlot(from: number, to: number): void;
}

/**
 * An inclusive-ish numeric interval drawn uniformly at spawn: the draw is
 * `min + (max − min) · u` with `u ∈ [0, 1)`, so `min` is attainable and `max` is
 * not. `min === max` is the way to spell "constant".
 */
export interface ParticleRange {
  /** Lower bound, attainable. */
  readonly min: number;
  /** Upper bound, approached but not attained (unless `min === max`). */
  readonly max: number;
}

/**
 * One stop on a normalized-age ramp (`t ∈ [0, 1]`).
 *
 * Interior stops must lie strictly between `0` and `1` and be sorted ascending
 * when passed to {@link evaluateLifetimeRampNumber} or {@link evaluateLifetimeRampColor}.
 */
export interface ParticleLifetimeStop<T> {
  /** Normalized age in `(0, 1)`. */
  readonly t: number;
  readonly value: T;
}

/**
 * A start/end pair interpolated linearly over a particle's normalized age
 * (§36 "color and size over lifetime"). `start` is the value at age 0, `end` the
 * value at age = lifetime.
 *
 * Optional {@link ParticleLifetimeRamp.stops} add interior breakpoints with
 * piecewise-linear interpolation — enough for simple multi-stop ramps without
 * pulling in §17 curve machinery.
 */
export interface ParticleLifetimeRamp<T> {
  /** Value at normalized age 0. */
  readonly start: T;
  /** Value at normalized age 1. */
  readonly end: T;
  /** Optional interior stops, each with `t ∈ (0, 1)`, sorted ascending. */
  readonly stops?: readonly ParticleLifetimeStop<T>[];
}

/**
 * Piecewise-linear evaluation of a {@link ParticleLifetimeRamp} at normalized
 * age `t ∈ [0, 1]`.
 */
export function evaluateLifetimeRampNumber(
  ramp: ParticleLifetimeRamp<number>,
  t: number,
): number {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const stops = ramp.stops;
  if (stops === undefined || stops.length === 0) {
    return ramp.start + (ramp.end - ramp.start) * clamped;
  }

  let previousT = 0;
  let previousValue = ramp.start;
  for (let i = 0; i < stops.length; i += 1) {
    const stop = stops[i];
    if (clamped <= stop.t) {
      const span = stop.t - previousT;
      if (span <= 0) {
        return stop.value;
      }
      const local = (clamped - previousT) / span;
      return previousValue + (stop.value - previousValue) * local;
    }
    previousT = stop.t;
    previousValue = stop.value;
  }

  const span = 1 - previousT;
  if (span <= 0) {
    return ramp.end;
  }
  const local = (clamped - previousT) / span;
  return previousValue + (ramp.end - previousValue) * local;
}

/**
 * Component-wise {@link evaluateLifetimeRampNumber} for straight RGBA colours.
 * Allocates the returned object; hot paths use
 * {@link evaluateLifetimeRampColorInto}.
 */
export function evaluateLifetimeRampColor(
  ramp: ParticleLifetimeRamp<ParticleColor>,
  t: number,
): ParticleColor {
  return evaluateLifetimeRampColorInto(ramp, t, { r: 0, g: 0, b: 0, a: 0 });
}

/**
 * {@link evaluateLifetimeRampColor} writing into a caller-owned `out` (§7b:
 * allocates nothing). Bit-identical to the allocating form. `out` must not
 * alias a ramp stop or endpoint.
 *
 * @returns `out`.
 */
export function evaluateLifetimeRampColorInto(
  ramp: ParticleLifetimeRamp<ParticleColor>,
  t: number,
  out: MutableParticleColor,
): MutableParticleColor {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const stops = ramp.stops;
  if (stops === undefined || stops.length === 0) {
    return lerpColorInto(ramp.start, ramp.end, clamped, out);
  }

  let previousT = 0;
  let previous = ramp.start;
  for (let i = 0; i < stops.length; i += 1) {
    const stop = stops[i];
    if (clamped <= stop.t) {
      const span = stop.t - previousT;
      if (span <= 0) {
        return copyColorInto(stop.value, out);
      }
      const local = (clamped - previousT) / span;
      return lerpColorInto(previous, stop.value, local, out);
    }
    previousT = stop.t;
    previous = stop.value;
  }

  const span = 1 - previousT;
  if (span <= 0) {
    return copyColorInto(ramp.end, out);
  }
  const local = (clamped - previousT) / span;
  return lerpColorInto(previous, ramp.end, local, out);
}

function copyColorInto(
  src: ParticleColor,
  out: MutableParticleColor,
): MutableParticleColor {
  out.r = src.r;
  out.g = src.g;
  out.b = src.b;
  out.a = src.a;
  return out;
}

function lerpColorInto(
  a: ParticleColor,
  b: ParticleColor,
  t: number,
  out: MutableParticleColor,
): MutableParticleColor {
  out.r = a.r + (b.r - a.r) * t;
  out.g = a.g + (b.g - a.g) * t;
  out.b = a.b + (b.b - a.b) * t;
  out.a = a.a + (b.a - a.a) * t;
  return out;
}

/** Mutable straight RGBA — the `out` type of {@link evaluateLifetimeRampColorInto}. */
export interface MutableParticleColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Straight RGBA, each component nominally in `[0, 1]`. Not validated or clamped. */
export interface ParticleColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/**
 * One §36 burst: `count` particles emitted the first time the emitter's local
 * elapsed time reaches `time`.
 *
 * Fires **once**. See `emitter.ts` for the exact firing window and the ordering
 * against rate-driven emission.
 */
export interface ParticleBurst {
  /** Emitter-local time in seconds at which this burst fires. */
  readonly time: number;
  /** How many particles to spawn. A non-negative safe integer. */
  readonly count: number;
}
