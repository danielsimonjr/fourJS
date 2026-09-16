/**
 * `ParticleEmitter` — the CPU particle simulation (§36, plan P9-1, WP-9.1).
 *
 * ```ts
 * const emitter = new ParticleEmitter({
 *   maxParticles: 10000,
 *   seed: 1337,
 *   emissionRate: 500,                     // particles per second
 *   bursts: [{ time: 0, count: 100 }],
 *   lifetime: { min: 1, max: 3 },          // seconds (§7a)
 *   initialSpeed: { min: 2, max: 5 },
 *   direction: new Vector3(0, 1, 0),       // Y-up (§7a)
 *   spreadAngle: Math.PI / 8,              // radians, cone half-angle
 *   size: { start: 1, end: 0 },
 *   color: { start: { r: 1, g: 1, b: 1, a: 1 }, end: { r: 1, g: 0, b: 0, a: 0 } },
 *   gravity: new Vector3(0, -9.81, 0),
 *   fields: [wind],                        // §27, applied in this order
 *   collisionPlaneY: 0,
 *   restitution: 0.5,
 * });
 *
 * emitter.step(1 / 60, simulationTime);    // one fixed step (§10)
 * ```
 *
 * ## Scope — what §36 this is, and what it is not
 *
 * §36's option sketch is `{ maxParticles, simulation: "gpu", forces, collisions:
 * "depth-buffer" }` and its feature list runs to eleven items. Plan P9-1 pins
 * the MVP tier and this packet ships that tier:
 *
 * | §36 feature                 | WP-9.1                                        |
 * | --------------------------- | --------------------------------------------- |
 * | CPU simulation              | **ships** (this module)                       |
 * | emitters, lifetimes         | **ships**                                     |
 * | velocity distributions      | **ships** — seeded cone, speed range           |
 * | forces                      | **ships** — gravity + §27 fields (WP-9.2 implements the fields) |
 * | colour and size over lifetime | **ships** — two-stop linear ramp            |
 * | collision                   | **MVP tier** — `collisionPlaneY` bounce, plus `collisions: "depth-buffer"` kill-below-ground |
 * | GPU compute simulation      | **integrator tier ships** (R-31 wiring, 2026-08-29): `simulation: "gpu"` + a bound {@link ParticleGpuSimulation} — CPU spawn, GPU semi-implicit Euler under constant gravity plus an optional radial field. `collisions: "depth-buffer"` is accepted; the device rests particles on `y = ground` (a documented stub — true depth-texture collide-and-kill is staged). |
 * | trails, attractors, custom data channels | staged (2026-08-02, P9-1): trails need a per-particle position-history channel (a ring buffer per slot) plus a ribbon render path — neither the SoA pool nor the "particles" render item carries history, and shipping a one-sample "trail" would be a lie; attractors are expressible today as a negative-strength {@link ../fields.js radialField}; custom data channels want a pool-layout extension API |
 *
 * `collisions: "depth-buffer"` is now an accepted option (R-31 residue /
 * R-32): the CPU path kills particles whose `y` falls below the ground
 * (`collisionPlaneY`, or `0` when omitted). A GPU emitter accepts the same
 * spelling; the device kernel rests those particles on the plane rather than
 * sampling a scene depth texture — documented, not silent. Rendering is
 * WP-9.3; nothing in this module draws, owns a node, or reads a clock.
 *
 * ## GPU mode (§36 "GPU compute simulation" — the R-31 wiring, 2026-08-29)
 *
 * With `simulation: "gpu"` this emitter keeps every §33-bearing decision on
 * the CPU — spawn draws, bursts, the accumulator, ageing, expiry, ramps —
 * and delegates the per-particle integration to a bound
 * {@link ParticleGpuSimulation} (`types.ts` owns the contract, the
 * division-of-labour argument, and the §33/§34 posture). Consequences,
 * stated plainly:
 *
 * - **The pool's position/velocity lanes hold spawn-time values only.**
 *   The live state is device-resident and is drawn from the device (the
 *   WebGPU backend binds the simulation's position buffer as the instance
 *   position stream, keyed by the emitting node's id); it is never read
 *   back per frame, because a per-frame readback would forfeit the point.
 * - **A GPU emitter must be bound before it steps or emits** —
 *   {@link ParticleEmitter.bindGpuSimulation}; an unbound `step()`/`emit()`
 *   throws rather than silently simulating nothing (§85, the WP-9.1 rule
 *   again). Binding is once: a driver's device dying takes the particle
 *   state with it (§34 posture in `types.ts`), so recovery is a new
 *   emitter, not a rebind.
 * - **Non-radial `fields` and bounce-only `collisionPlaneY` are refused**
 *   in GPU mode. A `radialField` (the `gpuField` brand) is applied on the
 *   device with the same inverse-square law as the CPU path. `collisions:
 *   "depth-buffer"` is accepted as the ground-rest stub above.
 * - The step order is the CPU order with integration hoisted: one
 *   `integrate()` over the pre-expiry live count (every live particle
 *   integrates exactly once, as on the CPU, where the swap-remove re-process
 *   guarantees the same), then the age/expiry scan mirroring each
 *   swap-remove to the device via `moveSlot`, then spawns via `writeSpawn`.
 *
 * ## The step, in order (pinned, WP-9.1)
 *
 * `step(deltaSeconds, time)` does exactly this, in exactly this order:
 *
 * 1. **Simulate every live particle**, ascending index:
 *    1. acceleration = `gravity` + each field's `sample(...)`, **in declaration
 *       order**;
 *    2. **semi-implicit (symplectic) Euler**: `v += a·dt` then `p += v·dt`;
 *    3. plane collision, if `collisionPlaneY` is set;
 *    4. `age += dt`;
 *    5. if `age >= lifetime`, swap-remove it and re-process the slot (the swap
 *       moved an unprocessed particle in).
 * 2. **Spawn**: bursts whose time falls in `[elapsed, elapsed + dt)`, in
 *    declaration order, then the rate-driven emission for this step.
 * 3. `elapsed += dt`.
 *
 * Simulating before spawning is what gives the age invariant: **a particle's age
 * is exactly `dt` × the number of steps in which it was integrated**, so a
 * particle spawned during step *n* sits at its spawn position with age 0 at the
 * end of step *n*, and first moves in step *n + 1*. That is what makes the
 * closed forms below exact rather than off-by-one-step.
 *
 * ### The integrator, in closed form
 *
 * Semi-implicit Euler under a constant acceleration `g` from `(p₀, v₀)` gives,
 * after *n* steps of `dt`:
 *
 * ```text
 * vₙ = v₀ + n·g·dt
 * pₙ = p₀ + n·v₀·dt + g·dt²·(1 + 2 + … + n)
 *    = p₀ + v₀·t + ½·g·t·(t + dt)          with t = n·dt
 * ```
 *
 * — the continuous `p₀ + v₀t + ½gt²` plus a `½·g·t·dt` discretisation bias that
 * vanishes with `dt`. `tests/emitter.test.ts` pins this exactly; it is the
 * discrete truth, and rounding it to the continuous formula in a test would be
 * pretending the simulation is something it is not.
 *
 * Semi-implicit rather than explicit Euler because it is the engine's default
 * (`@fourjs/motion`'s `DEFAULT_INTEGRATOR`) and does not pump energy into orbiting
 * particles under a radial field. It is **inlined here** rather than delegated to
 * `@fourjs/motion`'s `semiImplicitEuler`: §3.1 gives particles no motion
 * dependency, and the inline form works on `Float32Array` lanes without boxing
 * each particle into an `IntegratorState`.
 *
 * ## Randomness and the per-particle draw order (pinned, WP-9.1)
 *
 * §33 forbids `Math.random`; every spawn draw comes from this emitter's own
 * {@link SeededRandom} (see `random.ts` for why the generator is a copy).
 *
 * **Each successfully spawned particle consumes exactly
 * {@link PARTICLE_DRAWS_PER_SPAWN} = 4 draws, always, in this order:**
 *
 * 1. `lifetime` — `nextRange(lifetime.min, lifetime.max)`
 * 2. `speed` — `nextRange(initialSpeed.min, initialSpeed.max)`
 * 3. cone azimuth `φ` — `nextRange(0, 2π)`
 * 4. cone polar `u` — `nextFloat01()`, mapped to `cos θ = 1 − u·(1 − cos spread)`
 *
 * The count and the order are **fixed, not conditional**: a zero `spreadAngle`
 * or a degenerate range still consumes its draws. That is deliberate — it means
 * widening a cone or changing a lifetime range shifts *those particles'* values
 * and nothing else's, instead of re-phasing the whole stream. Adding a fifth
 * draw later is a breaking change to every §33 golden, by design.
 *
 * Two consequences worth stating plainly:
 *
 * - **Draws are consumed only by *successful* spawns.** A spawn that finds the
 *   pool full is dropped before it draws (it is counted in
 *   {@link ParticleEmitter.droppedCount}). This keeps a saturated
 *   100 000-particle emitter from burning four RNG draws per dropped spawn every
 *   step — but it does mean **`maxParticles` is part of the determinism
 *   contract**: the same seed with a different capacity is a different stream
 *   once the pool saturates.
 * - **The stream is per emitter.** Nothing is module-level, so two emitters with
 *   the same seed reproduce each other regardless of what else the scene does.
 *
 * ## Determinism (§33)
 *
 * Same seed + same `(deltaSeconds, time)` sequence ⇒ **bit-identical pools**,
 * tested over 600 steps with spawns, deaths, fields, and bounces active. The
 * ingredients: a seeded stream, a fixed draw order, ascending-index iteration,
 * a fixed acceleration summation order (gravity, then fields in declaration
 * order — floating-point addition is not associative, so this is a contract and
 * not an implementation detail), and the pool's deterministic swap-remove
 * compaction (see `pool.ts`).
 *
 * ## Allocation (§7b, plan D7)
 *
 * **`step()` allocates nothing.** Three scratch `Vector3`s are built in the
 * constructor and reused: two carry the particle's position and velocity into
 * `ParticleForceField.sample`, one is the `out` it writes. Options are copied
 * into plain number fields and own arrays at construction, so no option object
 * is read on the hot path and later mutation of the caller's arrays cannot
 * change the simulation. Loops are indexed (`for (let i = …)`) rather than
 * `for…of`, which would allocate an iterator per loop.
 *
 * Consequence of the shared scratch: a `ParticleForceField.sample`
 * implementation must not re-enter the *same* emitter's `step()`. Nothing in the
 * engine does.
 */

import { FourError } from "@fourjs/core";
import { Vector3, Vector4 } from "@fourjs/math";

import { ParticlePool } from "./pool.js";
import { SeededRandom } from "./random.js";
import {
  ParticleTrailStore,
  resolveTrailOptions,
  type ParticleTrailOptions,
} from "./trail.js";
import type {
  ParticleBurst,
  ParticleCollisionMode,
  ParticleColor,
  ParticleForceField,
  ParticleGpuIntegrateExtras,
  ParticleGpuRadialField,
  ParticleGpuSimulation,
  ParticleLifetimeRamp,
  ParticleLifetimeStop,
  ParticleRange,
  ParticleSimulationMode,
  ParticleTexture,
} from "./types.js";
import {
  evaluateLifetimeRampColor,
  evaluateLifetimeRampNumber,
} from "./types.js";

/** `2π`. */
const TAU = Math.PI * 2;

/**
 * Seeded draws consumed per successfully spawned particle — see the module note
 * on draw order. Exported so a test or a §33 golden can assert the stream
 * position instead of hard-coding `4`.
 */
export const PARTICLE_DRAWS_PER_SPAWN = 4;

/** Seed used when {@link ParticleEmitterOptions.seed} is omitted. */
export const DEFAULT_PARTICLE_SEED = 0;

/** Lifetime in seconds used when {@link ParticleEmitterOptions.lifetime} is omitted. */
export const DEFAULT_PARTICLE_LIFETIME_SECONDS = 1;

/** Size used at both ramp ends when {@link ParticleEmitterOptions.size} is omitted. */
export const DEFAULT_PARTICLE_SIZE = 1;

/** Restitution used when {@link ParticleEmitterOptions.restitution} is omitted. */
export const DEFAULT_PARTICLE_RESTITUTION = 0;

/**
 * §36 emitter options, MVP tier. Every field except `maxParticles` is optional;
 * the defaults are listed per field and are all constants, never clocks or
 * `Math.random` (§33).
 *
 * Options are read **once, in the constructor**. Runtime re-authoring
 * (`emitter.emissionRate = 20`) is **staged** (2026-08-02, WP-9.1): the derived
 * cone basis, the burst schedule, and the emission accumulator would all need
 * invalidation rules, and §36 gives none. Build a new emitter, or call
 * {@link ParticleEmitter.emit} for one-off bursts.
 */
export interface ParticleEmitterOptions {
  /**
   * Pool capacity — the most particles that can be live at once. A non-negative
   * safe integer. Spawns beyond it are dropped and counted
   * ({@link ParticleEmitter.droppedCount}); see the draw-order note for why this
   * value is part of the determinism contract.
   */
  readonly maxParticles: number;

  /**
   * Seed for this emitter's stream (§33). Default
   * {@link DEFAULT_PARTICLE_SEED} — a *constant*, so the default is still
   * reproducible; there is deliberately no clock- or entropy-derived default.
   */
  readonly seed?: number;

  /**
   * Who integrates (§36's `simulation` option). Default `"cpu"`. `"gpu"`
   * requires a subsequent {@link ParticleEmitter.bindGpuSimulation} before
   * the first `step()`/`emit()`, refuses non-radial `fields` and bounce-only
   * `collisionPlaneY` (module header, "GPU mode"), and requires
   * `maxParticles > 0` (a zero-capacity device buffer cannot exist, so a
   * zero-capacity GPU emitter could never bind — refused where it was
   * written).
   */
  readonly simulation?: ParticleSimulationMode;

  /**
   * World position particles spawn at. Copied at construction; default the
   * origin. Not spec text — WP-9.1 addition, because an emitter that can only
   * spawn at the origin cannot be tested against a moving frame and scene
   * attachment does not arrive until WP-9.4.
   */
  readonly position?: Vector3;

  /**
   * Continuous emission in **particles per second**. Default `0`. Fractional
   * rates are honoured through an accumulator, so `2.5` emits 2, 3, 2, 3, …
   * across steps rather than truncating to 2.
   */
  readonly emissionRate?: number;

  /**
   * One-shot bursts, each fired the first time emitter-local elapsed time
   * reaches its `time`. Default none. Copied at construction; declaration order
   * is the firing order within a step.
   */
  readonly bursts?: readonly ParticleBurst[];

  /**
   * Lifetime range in seconds, drawn per particle. Default
   * `{ min: 1, max: 1 }`. Both bounds must be finite and `> 0`.
   */
  readonly lifetime?: ParticleRange;

  /**
   * Initial speed range in units/s along the spawn direction, drawn per
   * particle. Default `{ min: 0, max: 0 }`. Negative bounds are legal and mean
   * "backwards along the cone axis".
   */
  readonly initialSpeed?: ParticleRange;

  /**
   * Cone axis. Copied and normalized at construction; default `(0, 1, 0)` —
   * **+Y, because the world is Y-up in both 2D and 3D (§7a)**. A zero-length
   * direction falls back to `(0, 1, 0)` rather than throwing, so
   * `new Vector3()` is a usable default in authoring code.
   */
  readonly direction?: Vector3;

  /**
   * Cone **half-angle** in radians (§7a), in `[0, π]`. Default `0` — every
   * particle exactly along `direction`. `π/2` is a hemisphere, `π` the whole
   * sphere. Directions are uniform over the spherical cap, not over the angle.
   */
  readonly spreadAngle?: number;

  /**
   * Size at age 0 and at age = lifetime, linearly interpolated (§36 "size over
   * lifetime"). Default `{ start: 1, end: 1 }`.
   */
  readonly size?: ParticleLifetimeRamp<number>;

  /**
   * Straight RGBA at age 0 and at age = lifetime, linearly interpolated per
   * component (§36 "color over lifetime"). Default opaque white at both ends.
   */
  readonly color?: ParticleLifetimeRamp<ParticleColor>;

  /**
   * Constant acceleration in units/s² applied to every particle, e.g.
   * `(0, −9.81, 0)`. Copied at construction; default none (zero). Summed
   * **before** the fields.
   */
  readonly gravity?: Vector3;

  /**
   * §27 force fields, sampled once per particle per step and summed **in this
   * order**, after gravity. The array is copied at construction. WP-9.1 applies
   * fields; **WP-9.2 implements them** (see `types.ts`).
   */
  readonly fields?: readonly ParticleForceField[];

  /**
   * World `y` of an infinite horizontal collision plane, or omitted for no
   * collision (§36 collision, MVP tier — see
   * {@link ParticleEmitter.collisionPlaneY}).
   */
  readonly collisionPlaneY?: number;

  /**
   * Normal restitution of the collision plane: the fraction of downward speed
   * returned by a bounce. Default {@link DEFAULT_PARTICLE_RESTITUTION} (`0`,
   * i.e. the particle stops descending and slides). Values above `1` add energy
   * and are not rejected.
   */
  readonly restitution?: number;

  /**
   * Optional position-history trail (§36). CPU simulation only; refused when
   * `simulation: "gpu"`. Omit for no trail.
   */
  readonly trail?: ParticleTrailOptions;

  /**
   * Texture-like handle or `true` (R-32). Truthy opts into the wide instance
   * stream and tells the backend to sample `map` like an unlit sprite.
   */
  readonly texture?: ParticleTexture;

  /**
   * Rotate each billboard by `atan2(vy, vx)` of the particle's velocity
   * (R-32). Default `false`. Opts into the wide instance stream.
   */
  readonly alignToVelocity?: boolean;

  /**
   * Soft-particle fade in `[0, 1]` (R-32). `0` / omitted keeps the default
   * 8-float stream. Backends fade by depth difference vs a bound scene
   * depth texture; when none is bound, the honest fallback is
   * `saturate(1 − |viewZ| · softness)`.
   */
  readonly softness?: number;

  /**
   * §36 collision mode. `"depth-buffer"` kills (CPU) or rests (GPU stub)
   * particles below the ground `y` — {@link collisionPlaneY}, or `0`.
   * Default `"none"` (the existing `collisionPlaneY` bounce still applies
   * on CPU when that field is set and this is omitted).
   */
  readonly collisions?: ParticleCollisionMode;
}

/**
 * A seeded, fixed-capacity CPU particle emitter. See the module documentation
 * for the step order, the closed forms, the draw-order contract, and the
 * determinism and allocation guarantees.
 */
export class ParticleEmitter {
  /** The storage this emitter drives. Read it to render, inspect, or checksum. */
  readonly pool: ParticlePool;

  /** This emitter's seeded stream (§33). Exposed for §34-style snapshotting via `clone()`. */
  readonly random: SeededRandom;

  readonly #emissionRate: number;
  readonly #bursts: readonly ParticleBurst[];
  readonly #burstFired: Uint8Array;
  readonly #lifetimeMin: number;
  readonly #lifetimeMax: number;
  readonly #speedMin: number;
  readonly #speedMax: number;
  readonly #sizeRamp: ParticleLifetimeRamp<number>;
  readonly #colorRamp: ParticleLifetimeRamp<ParticleColor>;
  readonly #startSize: number;
  readonly #endSize: number;
  readonly #startColor: ParticleColor;
  readonly #endColor: ParticleColor;

  readonly #originX: number;
  readonly #originY: number;
  readonly #originZ: number;

  /** Normalized cone axis. */
  readonly #dirX: number;
  readonly #dirY: number;
  readonly #dirZ: number;

  /** First cone tangent — unit, perpendicular to the axis. */
  readonly #tanAX: number;
  readonly #tanAY: number;
  readonly #tanAZ: number;

  /** Second cone tangent — unit, `axis × tangentA`, completing a right-handed basis. */
  readonly #tanBX: number;
  readonly #tanBY: number;
  readonly #tanBZ: number;

  /** `cos(spreadAngle)`, precomputed for the cap mapping. */
  readonly #cosSpread: number;

  readonly #gravityX: number;
  readonly #gravityY: number;
  readonly #gravityZ: number;

  readonly #fields: readonly ParticleForceField[];

  // --- R-34: §27 batched field sampling (begin) ---
  /**
   * Per-particle acceleration accumulator, in binary64, allocated **only** when
   * at least one configured field offers `sampleAll` — otherwise `undefined`
   * and the per-particle path below is unchanged, down to the branch it takes.
   *
   * `24 · maxParticles` bytes (2.4 MB at 100 000), which is the price of the
   * batched path and is charged once at construction rather than per step. It
   * is binary64 and not binary32 because the scalar path accumulates in
   * JavaScript numbers; rounding each partial sum to float32 would make a
   * batched run differ from a scalar one in the last bits, and §33 does not
   * permit that (see `ParticleForceField.sampleAll`).
   */
  readonly #fieldAccumulator: Float64Array | undefined;
  // --- R-34: §27 batched field sampling (end) ---

  readonly #hasPlane: boolean;
  readonly #planeY: number;
  readonly #restitution: number;
  readonly #collisions: ParticleCollisionMode;
  readonly #texture: ParticleTexture | undefined;
  readonly #alignToVelocity: boolean;
  readonly #softness: number;
  readonly #instanceFloats: number;
  readonly #gpuRadial: ParticleGpuRadialField | undefined;

  /** §36's `simulation` option, frozen at construction. */
  readonly #simulation: ParticleSimulationMode;

  /** The bound GPU driver, or `null` (always `null` in CPU mode). */
  #gpu: ParticleGpuSimulation | null = null;

  /** Per-slot position history, or `undefined` when trails are off. */
  readonly #trail: ParticleTrailStore | undefined;
  readonly #trailMinDistance: number;
  readonly #trailHeadWidth: number;
  readonly #trailTailWidthFactor: number;

  /** Scratch handed to `ParticleForceField.sample` — never allocated per step. */
  readonly #samplePosition = new Vector3();
  readonly #sampleVelocity = new Vector3();
  readonly #sampleForce = new Vector3();
  readonly #evaluateColorStart = new Vector4();
  readonly #evaluateColorEnd = new Vector4();

  #elapsedTime = 0;
  #emissionAccumulator = 0;
  #emittedCount = 0;
  #droppedCount = 0;

  /**
   * Validates and freezes the options into scalar fields, allocates the pool and
   * the scratch vectors, and seeds the stream. This is the only allocating
   * operation on the type.
   *
   * @throws RangeError on any out-of-domain option — see
   * {@link ParticleEmitterOptions} for each field's domain. Options are checked
   * eagerly because an emitter is authored once and stepped thousands of times:
   * a `NaN` lifetime should fail where it was written, not as an invisible
   * never-expiring particle ten seconds later.
   */
  constructor(options: ParticleEmitterOptions) {
    this.pool = new ParticlePool(options.maxParticles);
    this.random = new SeededRandom(options.seed ?? DEFAULT_PARTICLE_SEED);

    const simulation = options.simulation ?? "cpu";
    if (simulation !== "cpu" && simulation !== "gpu") {
      throw new RangeError(
        `ParticleEmitter: simulation must be "cpu" or "gpu" (§36); received ${String(simulation)}`,
      );
    }
    this.#simulation = simulation;
    const collisions = options.collisions ?? "none";
    if (collisions !== "none" && collisions !== "depth-buffer") {
      throw new RangeError(
        `ParticleEmitter: collisions must be "none" or "depth-buffer" (§36); received ${String(collisions)}`,
      );
    }
    this.#collisions = collisions;
    this.#texture =
      options.texture === true || typeof options.texture === "object"
        ? options.texture
        : undefined;
    this.#alignToVelocity = options.alignToVelocity === true;
    this.#softness =
      options.softness === undefined
        ? 0
        : assertFiniteAtLeast(options.softness, 0, "softness");
    if (this.#softness > 1) {
      throw new RangeError(
        `ParticleEmitter: softness must be in [0, 1]; received ${String(this.#softness)}`,
      );
    }
    this.#instanceFloats =
      this.#texture !== undefined || this.#alignToVelocity || this.#softness > 0
        ? 10
        : 8;

    const authoredFields =
      options.fields === undefined ? [] : [...options.fields];
    let gpuRadial: ParticleGpuRadialField | undefined;
    if (simulation === "gpu") {
      if (authoredFields.length > 0) {
        gpuRadial = resolveGpuRadial(authoredFields);
      }
      if (
        options.collisionPlaneY !== undefined &&
        collisions !== "depth-buffer"
      ) {
        throw new RangeError(
          'ParticleEmitter: simulation "gpu" does not accept `collisionPlaneY` (§36 bounce plane is CPU-only; use collisions: "depth-buffer" for the ground stub)',
        );
      }
      if (options.trail !== undefined && options.trail.enabled !== false) {
        throw new RangeError(
          'ParticleEmitter: simulation "gpu" does not accept `trail` (§36 CPU trail history is a follow-up on the device; R-31)',
        );
      }
      if (this.pool.capacity === 0) {
        throw new RangeError(
          'ParticleEmitter: simulation "gpu" requires maxParticles > 0',
        );
      }
    }
    this.#gpuRadial = gpuRadial;

    this.#emissionRate = assertFiniteAtLeast(
      options.emissionRate ?? 0,
      0,
      "emissionRate",
    );

    const bursts = options.bursts ?? [];
    const copiedBursts: ParticleBurst[] = [];
    for (let i = 0; i < bursts.length; i += 1) {
      const burst = bursts[i];
      assertFiniteAtLeast(burst.time, 0, `bursts[${String(i)}].time`);
      if (!Number.isSafeInteger(burst.count) || burst.count < 0) {
        throw new RangeError(
          `ParticleEmitter: bursts[${String(i)}].count must be a non-negative safe integer; received ${String(burst.count)}`,
        );
      }
      copiedBursts.push({ time: burst.time, count: burst.count });
    }
    this.#bursts = copiedBursts;
    this.#burstFired = new Uint8Array(copiedBursts.length);

    const lifetime = options.lifetime ?? {
      min: DEFAULT_PARTICLE_LIFETIME_SECONDS,
      max: DEFAULT_PARTICLE_LIFETIME_SECONDS,
    };
    this.#lifetimeMin = assertFiniteAbove(lifetime.min, 0, "lifetime.min");
    this.#lifetimeMax = assertFiniteAtLeast(
      lifetime.max,
      this.#lifetimeMin,
      "lifetime.max",
    );

    const speed = options.initialSpeed ?? { min: 0, max: 0 };
    this.#speedMin = assertFinite(speed.min, "initialSpeed.min");
    this.#speedMax = assertFiniteAtLeast(
      speed.max,
      this.#speedMin,
      "initialSpeed.max",
    );

    const size = options.size ?? {
      start: DEFAULT_PARTICLE_SIZE,
      end: DEFAULT_PARTICLE_SIZE,
    };
    this.#sizeRamp = copySizeRamp(size);
    this.#startSize = assertFinite(size.start, "size.start");
    this.#endSize = assertFinite(size.end, "size.end");

    const color = options.color;
    this.#colorRamp = copyColorRamp(color);
    this.#startColor = copyColor(color?.start, "color.start");
    this.#endColor = copyColor(color?.end, "color.end");

    const origin = options.position;
    this.#originX = assertFinite(origin?.x ?? 0, "position.x");
    this.#originY = assertFinite(origin?.y ?? 0, "position.y");
    this.#originZ = assertFinite(origin?.z ?? 0, "position.z");

    // Cone basis, derived once. A zero-length direction falls back to +Y (§7a).
    const dx = assertFinite(options.direction?.x ?? 0, "direction.x");
    const dy = assertFinite(options.direction?.y ?? 1, "direction.y");
    const dz = assertFinite(options.direction?.z ?? 0, "direction.z");
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const axisX = length > 0 ? dx / length : 0;
    const axisY = length > 0 ? dy / length : 1;
    const axisZ = length > 0 ? dz / length : 0;
    this.#dirX = axisX;
    this.#dirY = axisY;
    this.#dirZ = axisZ;

    // tangentA = normalize(axis × e), where e is the world axis least aligned
    // with `axis` — that choice keeps the cross product well away from zero, and
    // being a pure function of `axis` keeps the basis reproducible (§33).
    const absX = Math.abs(axisX);
    const absY = Math.abs(axisY);
    const absZ = Math.abs(axisZ);
    let ex = 0;
    let ey = 0;
    let ez = 0;
    if (absX <= absY && absX <= absZ) {
      ex = 1;
    } else if (absY <= absZ) {
      ey = 1;
    } else {
      ez = 1;
    }
    const crossX = axisY * ez - axisZ * ey;
    const crossY = axisZ * ex - axisX * ez;
    const crossZ = axisX * ey - axisY * ex;
    const crossLength = Math.sqrt(
      crossX * crossX + crossY * crossY + crossZ * crossZ,
    );
    this.#tanAX = crossX / crossLength;
    this.#tanAY = crossY / crossLength;
    this.#tanAZ = crossZ / crossLength;
    // tangentB = axis × tangentA — already unit, since both are unit and
    // perpendicular.
    this.#tanBX = axisY * this.#tanAZ - axisZ * this.#tanAY;
    this.#tanBY = axisZ * this.#tanAX - axisX * this.#tanAZ;
    this.#tanBZ = axisX * this.#tanAY - axisY * this.#tanAX;

    const spreadAngle = assertFinite(options.spreadAngle ?? 0, "spreadAngle");
    if (spreadAngle < 0 || spreadAngle > Math.PI) {
      throw new RangeError(
        `ParticleEmitter: spreadAngle must be a cone half-angle in [0, π] radians (§7a); received ${String(spreadAngle)}`,
      );
    }
    this.#cosSpread = Math.cos(spreadAngle);

    this.#gravityX = assertFinite(options.gravity?.x ?? 0, "gravity.x");
    this.#gravityY = assertFinite(options.gravity?.y ?? 0, "gravity.y");
    this.#gravityZ = assertFinite(options.gravity?.z ?? 0, "gravity.z");

    this.#fields = options.fields === undefined ? [] : [...options.fields];
    this.#fieldAccumulator = this.#fields.some(
      (field) => field.sampleAll !== undefined,
    )
      ? new Float64Array(this.pool.capacity * 3)
      : undefined;

    const planeY = options.collisionPlaneY;
    this.#hasPlane = planeY !== undefined;
    this.#planeY =
      planeY === undefined ? 0 : assertFinite(planeY, "collisionPlaneY");
    this.#restitution = assertFiniteAtLeast(
      options.restitution ?? DEFAULT_PARTICLE_RESTITUTION,
      0,
      "restitution",
    );

    const trail = resolveTrailOptions(options.trail);
    if (trail === undefined) {
      this.#trail = undefined;
      this.#trailMinDistance = 0;
      this.#trailHeadWidth = -1;
      this.#trailTailWidthFactor = 0;
    } else {
      this.#trail = new ParticleTrailStore(this.pool.capacity, trail.length!);
      this.#trailMinDistance = trail.minDistance!;
      this.#trailHeadWidth = trail.width!;
      this.#trailTailWidthFactor = trail.tailWidthFactor!;
    }
  }

  /** Live particle count — `pool.aliveCount`. */
  get particleCount(): number {
    return this.pool.aliveCount;
  }

  /** Emitter-local time in seconds: the sum of every `deltaSeconds` stepped so far. */
  get elapsedTime(): number {
    return this.#elapsedTime;
  }

  /** Particles successfully spawned since construction or {@link ParticleEmitter.reset}. */
  get emittedCount(): number {
    return this.#emittedCount;
  }

  /**
   * Spawns that found the pool full and were discarded. A non-zero value means
   * `maxParticles` is smaller than `emissionRate × lifetime` — the honest signal
   * that the budget, not the authoring, is shaping the effect.
   */
  get droppedCount(): number {
    return this.#droppedCount;
  }

  /** Fractional remainder of the emission accumulator, in `[0, 1)`. */
  get emissionAccumulator(): number {
    return this.#emissionAccumulator;
  }

  /** Plane height for §36 MVP collision, or `undefined` when collision is off. */
  get collisionPlaneY(): number | undefined {
    return this.#hasPlane ? this.#planeY : undefined;
  }

  /** §36 `collisions` option, as constructed. */
  get collisions(): ParticleCollisionMode {
    return this.#collisions;
  }

  /** Texture handle or `true`, or `undefined` when untextured. */
  get texture(): ParticleTexture | undefined {
    return this.#texture;
  }

  /** Whether billboards rotate from velocity (`atan2(vy, vx)`). */
  get alignToVelocity(): boolean {
    return this.#alignToVelocity;
  }

  /** Softness in `[0, 1]`. `0` keeps the default 8-float stream. */
  get softness(): number {
    return this.#softness;
  }

  /**
   * Instance-stream stride this emitter's renderable must allocate —
   * `8` by default, `10` when R-32 appearance is opted in.
   */
  get instanceFloats(): number {
    return this.#instanceFloats;
  }

  /** The GPU-applied radial field, or `undefined`. */
  get gpuRadial(): ParticleGpuRadialField | undefined {
    return this.#gpuRadial;
  }

  /** §36's `simulation` option, as constructed. */
  get simulationMode(): ParticleSimulationMode {
    return this.#simulation;
  }

  /** Whether this emitter records position-history trails. */
  get hasTrail(): boolean {
    return this.#trail !== undefined;
  }

  /** The trail store, or `undefined` when trails are disabled. */
  get trailStore(): ParticleTrailStore | undefined {
    return this.#trail;
  }

  /** Trail ribbon head width in world units, or `-1` to use particle size. */
  get trailHeadWidth(): number {
    return this.#trailHeadWidth;
  }

  /** Tail width as a fraction of the head width. */
  get trailTailWidthFactor(): number {
    return this.#trailTailWidthFactor;
  }

  /**
   * Current size of live particle `index`, including multi-stop ramps when
   * configured. Endpoints come from the pool slot (spawn values).
   */
  evaluateSize(index: number): number {
    const pool = this.pool;
    const t = pool.getNormalizedAge(index);
    const start = pool.getStartSize(index);
    const end = pool.getEndSize(index);
    const stops = this.#sizeRamp.stops;
    if (stops === undefined || stops.length === 0) {
      return start + (end - start) * t;
    }
    return evaluateLifetimeRampNumber({ start, end, stops }, t);
  }

  /**
   * Current colour of live particle `index`, including multi-stop ramps when
   * configured. Writes straight RGBA into `out`; endpoints come from the pool.
   */
  evaluateColor(index: number, out: Vector4): Vector4 {
    const pool = this.pool;
    const t = pool.getNormalizedAge(index);
    pool.getStartColor(index, this.#evaluateColorStart);
    pool.getEndColor(index, this.#evaluateColorEnd);
    const start = {
      r: this.#evaluateColorStart.x,
      g: this.#evaluateColorStart.y,
      b: this.#evaluateColorStart.z,
      a: this.#evaluateColorStart.w,
    };
    const end = {
      r: this.#evaluateColorEnd.x,
      g: this.#evaluateColorEnd.y,
      b: this.#evaluateColorEnd.z,
      a: this.#evaluateColorEnd.w,
    };
    const stops = this.#colorRamp.stops;
    const color =
      stops === undefined || stops.length === 0
        ? {
            r: start.r + (end.r - start.r) * t,
            g: start.g + (end.g - start.g) * t,
            b: start.b + (end.b - start.b) * t,
            a: start.a + (end.a - start.a) * t,
          }
        : evaluateLifetimeRampColor({ start, end, stops }, t);
    return out.set(color.r, color.g, color.b, color.a);
  }

  /**
   * The bound GPU driver, or `null` — non-`null` exactly when this is a
   * `simulation: "gpu"` emitter that has been wired
   * ({@link ParticleEmitter.bindGpuSimulation}).
   */
  get gpuSimulation(): ParticleGpuSimulation | null {
    return this.#gpu;
  }

  /**
   * Wires a `simulation: "gpu"` emitter to its device driver (module header,
   * "GPU mode"; the contract and posture live on
   * {@link ParticleGpuSimulation}).
   *
   * Binding is **once**: the driver owns device state this emitter's whole
   * history flows into, and a mid-life swap would splice two unrelated
   * device histories. A driver whose device died takes the particle state
   * with it — build a new emitter (§34 posture).
   *
   * @throws FourError `INVALID_APPLICATION_STATE` on a CPU-mode emitter, a
   * second bind, or a driver whose `capacity` differs from the pool's.
   */
  bindGpuSimulation(simulation: ParticleGpuSimulation): void {
    if (this.#simulation !== "gpu") {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        'bindGpuSimulation: this emitter is not simulation "gpu" (§36)',
      );
    }
    if (this.#gpu !== null) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        "This emitter already has a GPU simulation bound (binding is once)",
      );
    }
    if (simulation.capacity !== this.pool.capacity) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        "bindGpuSimulation: the driver's capacity must equal the pool's (§36)",
        {
          context: {
            driverCapacity: simulation.capacity,
            poolCapacity: this.pool.capacity,
          },
        },
      );
    }
    this.#gpu = simulation;
  }

  /**
   * Advances the simulation by `deltaSeconds` (§7a: seconds), sampling force
   * fields at absolute simulation time `time`.
   *
   * `time` defaults to {@link ParticleEmitter.elapsedTime}, which makes a
   * standalone emitter self-consistent; the §39 loop passes the simulation
   * clock instead. It is used **only** for field sampling — bursts and emission
   * are scheduled on emitter-local elapsed time, so an emitter behaves the same
   * whether it was created at simulation time 0 or 900.
   *
   * `deltaSeconds === 0` is a legal no-op step: nothing moves, nothing ages, no
   * burst window opens (the window `[elapsed, elapsed)` is empty) and the
   * accumulator gains nothing.
   *
   * @throws RangeError if `deltaSeconds` is not a finite number `>= 0`, or if
   * `time` is not finite. A negative step is rejected rather than run backwards:
   * ageing backwards would resurrect nothing (the particle is already gone) and
   * silently break the age invariant.
   */
  step(deltaSeconds: number, time: number = this.#elapsedTime): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError(
        `ParticleEmitter.step: deltaSeconds must be a finite number >= 0 (§7a: seconds); received ${String(deltaSeconds)}`,
      );
    }
    if (!Number.isFinite(time)) {
      throw new RangeError(
        `ParticleEmitter.step: time must be a finite number of seconds (§7a); received ${String(time)}`,
      );
    }

    if (this.#simulation === "gpu") {
      this.#simulateGpu(this.#requireGpu("step"), deltaSeconds);
    } else {
      this.#simulate(deltaSeconds, time);
    }
    this.#emitBursts(deltaSeconds);
    this.#emitFromRate(deltaSeconds);
    this.#elapsedTime += deltaSeconds;
  }

  /**
   * Spawns up to `count` particles immediately, using the same draw order as
   * automatic emission, and returns how many were actually created (the rest are
   * counted as dropped).
   *
   * This is the §36 "burst" primitive exposed directly, for effects driven by
   * game events rather than by the burst schedule.
   *
   * @throws RangeError if `count` is not a non-negative safe integer.
   */
  emit(count: number): number {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new RangeError(
        `ParticleEmitter.emit: count must be a non-negative safe integer; received ${String(count)}`,
      );
    }
    if (this.#simulation === "gpu") {
      // Same guard as `step` (§85): a spawn the device never received would
      // be a particle that exists on the CPU and nowhere the drawn state
      // lives — the silent half-truth the WP-9.1 rule forbids.
      this.#requireGpu("emit");
    }
    return this.#spawnMany(count);
  }

  /**
   * Returns the emitter to its just-constructed state: pool emptied, stream
   * rewound to its seed, elapsed time, accumulator, burst schedule, and counters
   * zeroed. Stepping a reset emitter with the same deltas reproduces the
   * original run bit for bit (§33, §34).
   */
  reset(): this {
    this.pool.clear();
    this.random.reset();
    this.#burstFired.fill(0);
    this.#elapsedTime = 0;
    this.#emissionAccumulator = 0;
    this.#emittedCount = 0;
    this.#droppedCount = 0;
    this.#trail?.clear();
    return this;
  }

  /** Step phase 1 — integrate, collide, age, expire. See the module step order. */
  #simulate(deltaSeconds: number, time: number): void {
    const pool = this.pool;
    const positions = pool.positions;
    const velocities = pool.velocities;
    const ages = pool.ages;
    const lifetimes = pool.lifetimes;
    const fields = this.#fields;
    const fieldCount = fields.length;

    // --- R-34: §27 batched field sampling (begin) ---
    // One pre-pass over the live range, engaged only when a field offered
    // `sampleAll` at construction. It reads exactly the state the per-particle
    // loop below would have read — nothing has been integrated yet, and a slot
    // the loop later swap-removes into carries its own (still pre-step) values
    // — and it sums in the same order, gravity first and then fields in
    // declaration order, so the result is bit-identical to the scalar path.
    const accumulator =
      fieldCount > 0 && this.#fieldAccumulator !== undefined
        ? this.#fieldAccumulator
        : undefined;
    if (accumulator !== undefined) {
      const live = pool.aliveCount;
      for (let i = 0; i < live; i += 1) {
        const base = i * 3;
        accumulator[base] = this.#gravityX;
        accumulator[base + 1] = this.#gravityY;
        accumulator[base + 2] = this.#gravityZ;
      }
      for (let f = 0; f < fieldCount; f += 1) {
        const field = fields[f];
        if (field.sampleAll !== undefined) {
          field.sampleAll(positions, velocities, live, time, accumulator);
          continue;
        }
        // A field without the fast path is not penalised and does not disable
        // it for its neighbours: it is sampled per particle, in its own place
        // in the declaration order, into the same accumulator.
        for (let i = 0; i < live; i += 1) {
          const base = i * 3;
          const position = this.#samplePosition.set(
            positions[base],
            positions[base + 1],
            positions[base + 2],
          );
          const velocity = this.#sampleVelocity.set(
            velocities[base],
            velocities[base + 1],
            velocities[base + 2],
          );
          const sampled = field.sample(
            position,
            velocity,
            time,
            this.#sampleForce,
          );
          accumulator[base] += sampled.x;
          accumulator[base + 1] += sampled.y;
          accumulator[base + 2] += sampled.z;
        }
      }
    }
    // --- R-34: §27 batched field sampling (end) ---

    let index = 0;
    while (index < pool.aliveCount) {
      const base = index * 3;

      let ax = this.#gravityX;
      let ay = this.#gravityY;
      let az = this.#gravityZ;

      if (accumulator !== undefined) {
        ax = accumulator[base];
        ay = accumulator[base + 1];
        az = accumulator[base + 2];
      } else if (fieldCount > 0) {
        const position = this.#samplePosition.set(
          positions[base],
          positions[base + 1],
          positions[base + 2],
        );
        const velocity = this.#sampleVelocity.set(
          velocities[base],
          velocities[base + 1],
          velocities[base + 2],
        );
        for (let f = 0; f < fieldCount; f += 1) {
          const sampled = fields[f].sample(
            position,
            velocity,
            time,
            this.#sampleForce,
          );
          ax += sampled.x;
          ay += sampled.y;
          az += sampled.z;
        }
      }

      // Semi-implicit Euler: velocity first, then position from the *new*
      // velocity.
      const vx = velocities[base] + ax * deltaSeconds;
      let vy = velocities[base + 1] + ay * deltaSeconds;
      const vz = velocities[base + 2] + az * deltaSeconds;
      const px = positions[base] + vx * deltaSeconds;
      let py = positions[base + 1] + vy * deltaSeconds;
      const pz = positions[base + 2] + vz * deltaSeconds;

      if (this.#collisions === "depth-buffer") {
        // CPU fallback for §36 `collisions: "depth-buffer"`: kill below the
        // ground plane (`collisionPlaneY`, or `y = 0`). True depth-texture
        // collide-and-kill is a backend concern; this is the honest CPU
        // contract so the option is never a silent no-op.
        if (py < this.#planeY) {
          if (accumulator !== undefined) {
            const last = (pool.aliveCount - 1) * 3;
            accumulator[base] = accumulator[last];
            accumulator[base + 1] = accumulator[last + 1];
            accumulator[base + 2] = accumulator[last + 2];
          }
          if (this.#trail !== undefined) {
            const last = pool.aliveCount - 1;
            if (index !== last) {
              this.#trail.copySlot(last, index);
            }
          }
          pool.kill(index);
          continue;
        }
      } else if (this.#hasPlane && py < this.#planeY) {
        // §36 collision, MVP tier: a position projection plus a normal-velocity
        // reflection, evaluated after the step. There is no time-of-impact
        // split, so the particle loses the sub-step distance it would have
        // travelled after the bounce, and no friction, so tangential velocity is
        // untouched. Both are documented approximations, not oversights: a
        // proper TOI split needs the collision solver coupling that P9-1 stages.
        py = this.#planeY;
        if (vy < 0) {
          vy = -vy * this.#restitution;
        }
      }

      velocities[base] = vx;
      velocities[base + 1] = vy;
      velocities[base + 2] = vz;
      positions[base] = px;
      positions[base + 1] = py;
      positions[base + 2] = pz;

      if (this.#trail !== undefined) {
        this.#trail.pushSample(index, px, py, pz, this.#trailMinDistance);
      }

      // Store first, then re-read: the expiry test must use the same float32
      // value `getAge` reports, not the unrounded binary64 sum.
      ages[index] = ages[index] + deltaSeconds;

      if (ages[index] >= lifetimes[index]) {
        // Swap-remove moves an as-yet-unprocessed particle into this slot, so
        // the index is deliberately not advanced (see `pool.ts` on ordering).
        // The accumulator is indexed by slot, so it takes the same swap — the
        // particle that lands here brings the acceleration computed for it.
        if (accumulator !== undefined) {
          const last = (pool.aliveCount - 1) * 3;
          accumulator[base] = accumulator[last];
          accumulator[base + 1] = accumulator[last + 1];
          accumulator[base + 2] = accumulator[last + 2];
        }
        if (this.#trail !== undefined) {
          const last = pool.aliveCount - 1;
          if (index !== last) {
            this.#trail.copySlot(last, index);
          }
        }
        pool.kill(index);
      } else {
        index += 1;
      }
    }
  }

  /**
   * The bound GPU driver, or a loud `INVALID_APPLICATION_STATE` refusal —
   * an unbound GPU emitter must not silently simulate nothing (§85; module
   * header, "GPU mode").
   */
  #requireGpu(method: string): ParticleGpuSimulation {
    const gpu = this.#gpu;
    if (gpu === null) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        `ParticleEmitter.${method}: no GPU simulation bound (§36) — call bindGpuSimulation first`,
      );
    }
    return gpu;
  }

  /**
   * Step phase 1, GPU mode — one `integrate()` over the pre-expiry live
   * count, then the CPU age/expiry scan with each swap-remove mirrored to
   * the device (module header, "GPU mode"; `types.ts` owns the call
   * contract).
   *
   * Integration is hoisted before the scan rather than interleaved as in
   * {@link ParticleEmitter.#simulate}: on the CPU the swap-remove re-process
   * guarantees every live particle integrates exactly once, and one batched
   * dispatch over `[0, aliveCount)` is the same guarantee — expiry reads
   * only ages and lifetimes, never positions, so the order between the two
   * halves is unobservable.
   */
  #simulateGpu(gpu: ParticleGpuSimulation, deltaSeconds: number): void {
    const pool = this.pool;
    const live = pool.aliveCount;
    if (live > 0 && deltaSeconds > 0) {
      const extras = this.#gpuIntegrateExtras();
      if (extras === undefined) {
        gpu.integrate(
          live,
          deltaSeconds,
          this.#gravityX,
          this.#gravityY,
          this.#gravityZ,
        );
      } else {
        gpu.integrate(
          live,
          deltaSeconds,
          this.#gravityX,
          this.#gravityY,
          this.#gravityZ,
          extras,
        );
      }
    }

    const ages = pool.ages;
    const lifetimes = pool.lifetimes;
    let index = 0;
    while (index < pool.aliveCount) {
      // Store first, then re-read — the CPU path's float32 expiry rule.
      ages[index] = ages[index] + deltaSeconds;
      if (ages[index] >= lifetimes[index]) {
        const last = pool.aliveCount - 1;
        if (index !== last) {
          // Mirror the swap the pool is about to perform, in the same
          // order, so slot contents on the device track slot contents in
          // the CPU channels exactly (`types.ts` on chained moves).
          gpu.moveSlot(last, index);
        }
        pool.kill(index);
      } else {
        index += 1;
      }
    }
  }

  /** Step phase 2a — bursts whose time lies in `[elapsed, elapsed + dt)`. */
  #emitBursts(deltaSeconds: number): void {
    const bursts = this.#bursts;
    const from = this.#elapsedTime;
    const to = from + deltaSeconds;
    for (let i = 0; i < bursts.length; i += 1) {
      if (this.#burstFired[i] === 1) {
        continue;
      }
      const burst = bursts[i];
      if (burst.time >= from && burst.time < to) {
        this.#burstFired[i] = 1;
        this.#spawnMany(burst.count);
      }
    }
  }

  /** Step phase 2b — rate-driven emission through the fractional accumulator. */
  #emitFromRate(deltaSeconds: number): void {
    if (this.#emissionRate <= 0) {
      return;
    }
    this.#emissionAccumulator += this.#emissionRate * deltaSeconds;
    if (!Number.isFinite(this.#emissionAccumulator)) {
      // Only reachable when rate × dt overflows binary64 (both astronomically
      // large). Resetting keeps the accumulator from becoming a permanent NaN
      // that silently stops all emission; this step emits nothing.
      this.#emissionAccumulator = 0;
      return;
    }
    const whole = Math.floor(this.#emissionAccumulator);
    if (whole <= 0) {
      return;
    }
    this.#emissionAccumulator -= whole;
    this.#spawnMany(whole);
  }

  /**
   * Spawns `min(count, free capacity)` particles and counts the remainder as
   * dropped. The clamp is computed up front so a saturated emitter costs O(1)
   * rather than O(count).
   */
  #spawnMany(count: number): number {
    const free = this.pool.capacity - this.pool.aliveCount;
    const spawnable = count < free ? count : free;
    for (let i = 0; i < spawnable; i += 1) {
      this.#spawnOne();
    }
    this.#emittedCount += spawnable;
    this.#droppedCount += count - spawnable;
    return spawnable;
  }

  /**
   * Spawns exactly one particle, consuming exactly
   * {@link PARTICLE_DRAWS_PER_SPAWN} draws in the pinned order. The caller has
   * already guaranteed there is a free slot.
   */
  #spawnOne(): void {
    const random = this.random;
    // Draw order is a contract — see the module note. Do not reorder, do not
    // make a draw conditional.
    const lifetime = random.nextRange(this.#lifetimeMin, this.#lifetimeMax);
    const speed = random.nextRange(this.#speedMin, this.#speedMax);
    const azimuth = random.nextRange(0, TAU);
    const polar = random.nextFloat01();

    // Uniform over the spherical cap of half-angle `spreadAngle`: cos θ is
    // uniform in [cos spread, 1], which is Archimedes' theorem — sampling θ
    // uniformly instead would crowd the cone's axis.
    const cosTheta = 1 - polar * (1 - this.#cosSpread);
    const sinThetaSq = 1 - cosTheta * cosTheta;
    const sinTheta = sinThetaSq > 0 ? Math.sqrt(sinThetaSq) : 0;
    const cosAzimuth = Math.cos(azimuth);
    const sinAzimuth = Math.sin(azimuth);

    const dirX =
      this.#dirX * cosTheta +
      (this.#tanAX * cosAzimuth + this.#tanBX * sinAzimuth) * sinTheta;
    const dirY =
      this.#dirY * cosTheta +
      (this.#tanAY * cosAzimuth + this.#tanBY * sinAzimuth) * sinTheta;
    const dirZ =
      this.#dirZ * cosTheta +
      (this.#tanAZ * cosAzimuth + this.#tanBZ * sinAzimuth) * sinTheta;

    const index = this.pool.spawn();
    this.pool.setPosition(index, this.#originX, this.#originY, this.#originZ);
    this.pool.setVelocity(index, dirX * speed, dirY * speed, dirZ * speed);
    this.#trail?.resetSlot(index);
    this.#trail?.pushSample(
      index,
      this.#originX,
      this.#originY,
      this.#originZ,
      0,
    );
    if (this.#gpu !== null) {
      // GPU mode: the spawn state enters device residency here — read back
      // from the pool so the device receives exactly the float32 values the
      // CPU channels hold (`setVelocity` rounded the products above).
      const base = index * 3;
      this.#gpu.writeSpawn(
        index,
        this.pool.positions[base],
        this.pool.positions[base + 1],
        this.pool.positions[base + 2],
        this.pool.velocities[base],
        this.pool.velocities[base + 1],
        this.pool.velocities[base + 2],
      );
    }
    this.pool.setLifetime(index, lifetime);
    this.pool.setSize(index, this.#startSize, this.#endSize);
    this.pool.setColor(
      index,
      this.#startColor.r,
      this.#startColor.g,
      this.#startColor.b,
      this.#startColor.a,
      this.#endColor.r,
      this.#endColor.g,
      this.#endColor.b,
      this.#endColor.a,
    );
  }

  /**
   * GPU integrate extras, or `undefined` on the gravity-only path so a
   * 5-argument driver recording stays identical.
   */
  #gpuIntegrateExtras(): ParticleGpuIntegrateExtras | undefined {
    if (this.#gpuRadial === undefined && this.#collisions !== "depth-buffer") {
      return undefined;
    }
    const extras: {
      radial?: ParticleGpuRadialField;
      collisionGroundY?: number;
      collisions?: ParticleCollisionMode;
    } = {};
    if (this.#gpuRadial !== undefined) {
      extras.radial = this.#gpuRadial;
    }
    if (this.#collisions === "depth-buffer") {
      extras.collisions = "depth-buffer";
      extras.collisionGroundY = this.#planeY;
    }
    return extras;
  }
}

/** Extracts the single GPU-capable radial field, or refuses the rest. */
function resolveGpuRadial(
  fields: readonly ParticleForceField[],
): ParticleGpuRadialField | undefined {
  let radial: ParticleGpuRadialField | undefined;
  for (let i = 0; i < fields.length; i += 1) {
    const gpuField = fields[i]?.gpuField;
    if (gpuField === undefined || gpuField.kind !== "radial") {
      throw new RangeError(
        'ParticleEmitter: simulation "gpu" does not accept `fields` other than radialField (§27 GPU fields; R-31)',
      );
    }
    if (radial !== undefined) {
      throw new RangeError(
        'ParticleEmitter: simulation "gpu" accepts at most one radialField',
      );
    }
    radial = gpuField;
  }
  return radial;
}

/** Rejects a non-finite option. */
function assertFinite(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `ParticleEmitter: ${name} must be a finite number; received ${String(value)}`,
    );
  }
  return value;
}

/** Rejects a non-finite option or one below `bound`. */
function assertFiniteAtLeast(
  value: number,
  bound: number,
  name: string,
): number {
  if (!Number.isFinite(value) || value < bound) {
    throw new RangeError(
      `ParticleEmitter: ${name} must be a finite number >= ${String(bound)}; received ${String(value)}`,
    );
  }
  return value;
}

/** Rejects a non-finite option or one not strictly above `bound`. */
function assertFiniteAbove(value: number, bound: number, name: string): number {
  if (!Number.isFinite(value) || value <= bound) {
    throw new RangeError(
      `ParticleEmitter: ${name} must be a finite number > ${String(bound)}; received ${String(value)}`,
    );
  }
  return value;
}

/** Validates and copies a colour endpoint; `undefined` becomes opaque white. */
function copyColor(
  color: ParticleColor | undefined,
  name: string,
): ParticleColor {
  if (color === undefined) {
    return { r: 1, g: 1, b: 1, a: 1 };
  }
  return {
    r: assertFinite(color.r, `${name}.r`),
    g: assertFinite(color.g, `${name}.g`),
    b: assertFinite(color.b, `${name}.b`),
    a: assertFinite(color.a, `${name}.a`),
  };
}

function copySizeRamp(
  ramp: ParticleLifetimeRamp<number>,
): ParticleLifetimeRamp<number> {
  const stops = ramp.stops;
  if (stops === undefined) {
    return { start: ramp.start, end: ramp.end };
  }
  const copied: ParticleLifetimeStop<number>[] = [];
  for (let i = 0; i < stops.length; i += 1) {
    const stop = stops[i];
    assertFinite(stop.t, `size.stops[${String(i)}].t`);
    if (stop.t <= 0 || stop.t >= 1) {
      throw new RangeError(
        `ParticleEmitter: size.stops[${String(i)}].t must be in (0, 1); received ${String(stop.t)}`,
      );
    }
    if (i > 0 && stop.t <= stops[i - 1].t) {
      throw new RangeError(
        `ParticleEmitter: size.stops must be sorted ascending by t`,
      );
    }
    copied.push({
      t: stop.t,
      value: assertFinite(stop.value, `size.stops[${String(i)}].value`),
    });
  }
  return { start: ramp.start, end: ramp.end, stops: copied };
}

function copyColorRamp(
  ramp: ParticleLifetimeRamp<ParticleColor> | undefined,
): ParticleLifetimeRamp<ParticleColor> {
  const start = copyColor(ramp?.start, "color.start");
  const end = copyColor(ramp?.end, "color.end");
  const stops = ramp?.stops;
  if (stops === undefined) {
    return { start, end };
  }
  const copied: ParticleLifetimeStop<ParticleColor>[] = [];
  for (let i = 0; i < stops.length; i += 1) {
    const stop = stops[i];
    assertFinite(stop.t, `color.stops[${String(i)}].t`);
    if (stop.t <= 0 || stop.t >= 1) {
      throw new RangeError(
        `ParticleEmitter: color.stops[${String(i)}].t must be in (0, 1); received ${String(stop.t)}`,
      );
    }
    if (i > 0 && stop.t <= stops[i - 1].t) {
      throw new RangeError(
        `ParticleEmitter: color.stops must be sorted ascending by t`,
      );
    }
    copied.push({
      t: stop.t,
      value: copyColor(stop.value, `color.stops[${String(i)}]`),
    });
  }
  return { start, end, stops: copied };
}
