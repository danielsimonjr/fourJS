/**
 * `ParticleSystem` (§39, §36, plan WP-9.4) — the fixed-step driver that steps
 * every tracked {@link ParticleEmitter} once per simulation step.
 *
 * ```ts
 * const particles = new ParticleSystem();
 * app.systems.register(particles);          // priority 500 (§39 step 5)
 *
 * const fountain = new ParticleRenderable(new ParticleEmitter({ … }));
 * app.scene.add(fountain);
 * particles.track(fountain.emitter);        // the emitter, not the renderable
 * ```
 *
 * Everything below is a decision this packet had to make and states its reason:
 * which §39 step particles belong to, what a system tracks, and — the one that
 * is easy to get wrong — which half of the frame repacks the GPU instances.
 *
 * ## `SimulationSystem`, implemented **structurally**
 *
 * §39's extension point is
 *
 * ```ts
 * interface SimulationSystem {
 *   priority: number;
 *   initialize(context: SimulationContext): void;
 *   fixedUpdate(context: FixedUpdateContext): void;
 *   dispose(): void;
 * }
 * ```
 *
 * and it lives in `@fourjs/motion`, which the frozen §3.1 dependency matrix does
 * **not** give `@fourjs/particles` (this package gets `core`, `math`, `scene`, and
 * nothing else; `motion` sits in the same dispatch wave, so an edge to it is not
 * merely undeclared but ordering-illegal). This class therefore implements the
 * shape without naming it — exactly the arrangement `ParticleRenderable` uses
 * for `@fourjs/render`'s `ParticleDrawable`, for the same reason, with the same
 * honest cost:
 *
 * > **Nothing type-checks the two declarations against each other.** A change to
 * > `SimulationSystem` will not fail this package's build; it will fail
 * > `tests/determinism/phase9-particles.test.ts`, which registers a
 * > `ParticleSystem` on a real `Application`'s registry — the one place in the
 * > repository that can see both packages — and which additionally asserts
 * > {@link PRIORITY_PARTICLES} against `@fourjs/motion`'s own constant.
 *
 * {@link ParticleFixedUpdateContext} below is the *narrowest* view of §39's
 * `FixedUpdateContext` that this system actually reads: `time.fixedDeltaTime`
 * and `time.simulationTime`. Narrower is deliberate — it documents the whole
 * dependency in six lines, and TypeScript's method-parameter bivariance makes
 * the class assignable to `SimulationSystem` regardless.
 *
 * ## Priority: 500, §39 step 5 (decision, WP-9.4)
 *
 * §39's step 5 is **force generation**, and a particle step is, precisely, §27
 * force fields sampled and integrated: gravity, drag, wind, vortex, turbulence
 * (`fields.ts`). So {@link PRIORITY_PARTICLES} is `500` — numerically identical
 * to `@fourjs/motion`'s `PRIORITY_FORCES`, restated here because the matrix
 * forbids importing it.
 *
 * What that buys, stated precisely rather than generously:
 *
 * - **After animation (300) and kinematics (400).** An emitter parented under an
 *   animated or path-following node sees *this* step's transform rather than the
 *   previous one, because the node's world matrix is resolved per fixed step
 *   (§7, spec rev 1.3). Today that is a guarantee about the *node*, not about
 *   the simulation: the MVP emitter spawns at a fixed `position` fixed at
 *   construction and simulates in the renderable's local space, so no particle
 *   currently reads an animated transform. The ordering is therefore correct in
 *   advance of a §36 `simulationSpace` option rather than load-bearing today,
 *   and saying otherwise would be inventing a dependency.
 * - **Before the physics solve (600).** Particles are decorative mass: they
 *   never write a rigid body, never enqueue a contact, and never read solver
 *   state — §36's collision tier here is the emitter's own `collisionPlaneY`,
 *   not a solver query. So this is *ordering hygiene*, not a data dependency:
 *   particles could equally run at 650 and nothing would change. It is stated as
 *   a convention so that the day particles do read solver output (§36's
 *   "depth-buffer" and full solver coupling are both staged), the default is
 *   already on the safe side of the solve.
 *
 * Equal priorities run in registration order, so a `ParticleSystem` and a force
 * generator both at 500 are ordered by whoever registered first — deterministic,
 * and irrelevant here because they touch disjoint state. Pass
 * `{ priority: … }` to move it; `PRIORITY_PARTICLES + 10` is the idiom the §39
 * constants are spaced for.
 *
 * ## What this system does **not** do: it never repacks instances
 *
 * The GPU-facing half of a particle system is
 * `ParticleRenderable.updateParticleInstances()`, and it is **not called here**.
 * `@fourjs/render`'s `buildRenderList` calls it itself, from `collect()`, once per
 * list build — read `render-list.ts`: the branch that recognises a
 * `ParticleDrawable` calls `node.updateParticleInstances()` immediately before
 * filling the item that points at the array. That is a *render*-frame cadence,
 * not a fixed-step one, and it is the right one for two independent reasons:
 *
 * 1. **Frequency.** A fixed step at 60 Hz and a render frame at 144 Hz (or a
 *    render frame at 30 Hz and four fixed steps behind it) are different clocks
 *    (§9, §10). Repacking per fixed step would either do work no frame consumes
 *    or hand a frame an array one step stale.
 * 2. **Freshness by construction.** Because the repack happens inside the list
 *    build, the uploaded array physically cannot be older than the item that
 *    references it — including for a caller that stepped the simulation
 *    mid-frame.
 *
 * So the division is: **this system owns simulation, the render list owns
 * presentation**, and an application that registers a `ParticleSystem` and adds
 * a `ParticleRenderable` to the scene has wired both halves. Nothing else is
 * required, and calling `updateParticleInstances()` by hand stays harmless and
 * idempotent between steps.
 *
 * ## No clocks, no randomness of its own (§33)
 *
 * The delta and the time both come from the injected context; nothing here reads
 * `Date.now`, `performance.now`, or `Math.random`. Tracked emitters are iterated
 * in **insertion order** (a `Set`), so a scene with two emitters sharing a seed
 * reproduces step for step.
 */

import { FourError } from "@fourjs/core";

/**
 * Execution order key for particle simulation: §39 step 5, *force generation*.
 *
 * **A deliberate duplicate** of `@fourjs/motion`'s `PRIORITY_FORCES`, which is the
 * normative definition. The §3.1 matrix forbids importing it (see the module
 * header); the value is restated here, exported so an application can order
 * against it without hard-coding `500`, and cross-checked against the original
 * in `tests/determinism/phase9-particles.test.ts` — the one suite that can see
 * both packages.
 */
export const PRIORITY_PARTICLES = 500;

/**
 * The part of §9's `TimeState` a particle step reads.
 *
 * Structural, and deliberately narrow: `@fourjs/motion`'s `ReadonlyTimeState`
 * carries eleven fields and this system reads two. Any `ReadonlyTimeState`
 * satisfies it.
 */
export interface ParticleStepTime {
  /** Constant simulation step in **seconds** (§7a, §10). Appendix A default 1/60. */
  readonly fixedDeltaTime: number;

  /**
   * Deterministic simulation clock in seconds (§9), already advanced to the end
   * of the step being produced — see {@link ParticleSystem.fixedUpdate} for what
   * that means for a §27 field's `time` argument.
   */
  readonly simulationTime: number;
}

/** §39's `FixedUpdateContext`, narrowed to {@link ParticleStepTime}. */
export interface ParticleFixedUpdateContext {
  /** The live time record for the step being executed (§9). */
  readonly time: ParticleStepTime;
}

/**
 * What {@link ParticleSystem} advances: anything that steps by a delta in
 * seconds at an absolute simulation time. `ParticleEmitter` satisfies it.
 *
 * Structural rather than `ParticleEmitter` itself, for the reason
 * `AnimationSystem.Advanceable` gives: the system states its actual requirement,
 * so a future emitter kind (a GPU-backed one, a trail emitter) satisfies it
 * without this file importing it, and a test can drive it with a three-line
 * stub.
 */
export interface SteppableEmitter {
  /**
   * Advances the simulation by `deltaSeconds` at absolute simulation time
   * `time` (both seconds, §7a).
   */
  step(deltaSeconds: number, time: number): void;
}

/** Options for {@link ParticleSystem}. */
export interface ParticleSystemOptions {
  /**
   * Execution order key (§39). Default {@link PRIORITY_PARTICLES} — step 5,
   * "force generation". Read **once, at registration**: the registry keeps its
   * systems sorted rather than re-sorting per step, so changing this afterwards
   * does nothing until the system is re-registered.
   */
  readonly priority?: number;
}

/**
 * Steps every tracked particle emitter once per fixed simulation step (§39
 * step 5).
 *
 * ## What it tracks: **emitters**, not renderables (decision, WP-9.4)
 *
 * `track` takes a {@link SteppableEmitter}. It does *not* take a
 * `ParticleRenderable`, and the demo composes accordingly
 * (`particles.track(fountain.emitter)`). Three reasons, in order of weight:
 *
 * 1. **A simulation must be drivable without a renderer.** The §112 benchmark
 *    (`benchmarks/particles-100k.mjs`) and the §33 golden
 *    (`tests/determinism/phase9-particles.test.ts`) both step 100 000 and 100
 *    particles respectively with no scene, no canvas and no render list. If the
 *    system took renderables, headless particle simulation would require
 *    constructing a node purely to throw it away.
 * 2. **The two halves have different owners and different cadences.** The
 *    renderable's per-frame job is driven by `buildRenderList` (see the module
 *    header); the emitter's per-step job is driven here. Tracking the renderable
 *    would suggest this system owns both, which is exactly the confusion the
 *    header exists to prevent.
 * 3. **`ParticleRenderable.emitter` is public for this.** It is documented as
 *    "public because the application steps it"; `system.track(r.emitter)` is
 *    that sentence, spelled.
 *
 * The cost, stated: one extra `.emitter` at the call site, and the possibility
 * of adding a renderable to the scene while forgetting to track its emitter —
 * which draws a static puff of particles rather than throwing. That failure is
 * visible in one frame, and the alternative failure (a headless simulation that
 * cannot be built) is not.
 *
 * ## No auto-untracking (decision, WP-9.4)
 *
 * `AnimationSystem` drops a player that is `finished` or `"stopped"`, because
 * those states are unrecoverable. An emitter has no such state: one with zero
 * live particles and no emission rate is exactly one burst away from being busy
 * again (`emitter.emit(n)`), and `reset()` revives any emitter at all. Dropping
 * a quiet emitter would silently break both. Emitters leave this system only
 * when something calls {@link ParticleSystem.untrack} or
 * {@link ParticleSystem.clear}.
 *
 * ## Mutation during a step
 *
 * The tracked set is a `Set` iterated live, mirroring `AnimationSystem` and
 * `MotionSystem` (a snapshot would allocate every step). Those are `Set`
 * semantics: an emitter untracked during the step is not stepped again in that
 * step, and one tracked during the step *is* stepped in the same step. Track and
 * untrack outside the step if that distinction matters.
 *
 * ## Allocation (§7b, plan D7)
 *
 * `fixedUpdate` allocates one `Set` iterator per step and nothing else — the
 * same one-per-step `AnimationSystem` and `MotionSystem` allocate, and the
 * reason the per-particle work inside `ParticleEmitter.step` is the part that is
 * strictly zero-allocation. At the §112 budget that is one small object against
 * 100 000 particles.
 */
export class ParticleSystem {
  /** Execution order key (§39); default {@link PRIORITY_PARTICLES}. */
  priority: number;

  /** Tracked emitters in insertion order (§33: deterministic iteration). */
  readonly #tracked = new Set<SteppableEmitter>();

  /** Set by {@link ParticleSystem.dispose}; disposal is terminal (§83). */
  #disposed = false;

  /**
   * Whether {@link ParticleSystem.dispose} has run. Disposal is terminal (§83):
   * a disposed system refuses its mutating entry points with
   * `INVALID_APPLICATION_STATE` (§89) rather than silently working.
   */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** §83's "disposed resource still in use", made loud (§89). */
  #requireLive(): void {
    if (this.#disposed) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        "ParticleSystem is disposed; stepping emitters through a disposed system is a " +
          "lifetime mistake (§83), and a new system is a new " +
          "ParticleSystem.",
        { context: { system: "ParticleSystem" } },
      );
    }
  }

  /**
   * @throws RangeError if `priority` is given and is not a finite number —
   * checked here as well as by the registry, so an application that builds the
   * system long before registering it fails where the mistake was written.
   */
  constructor(options: ParticleSystemOptions = {}) {
    const priority = options.priority ?? PRIORITY_PARTICLES;
    if (!Number.isFinite(priority)) {
      throw new RangeError(
        `ParticleSystem: priority must be a finite number (§39); received ${String(priority)}`,
      );
    }
    this.priority = priority;
  }

  /** Number of tracked emitters. */
  get size(): number {
    return this.#tracked.size;
  }

  /** Tracked emitters, in the order they will be stepped. */
  get emitters(): IterableIterator<SteppableEmitter> {
    return this.#tracked.values();
  }

  /**
   * Starts stepping `emitter` and returns it, so an emitter can be built and
   * tracked in one expression. Idempotent — tracking twice keeps the original
   * position in the iteration order and steps it once.
   */
  track<T extends SteppableEmitter>(emitter: T): T {
    this.#requireLive();
    this.#tracked.add(emitter);
    return emitter;
  }

  /** Stops stepping `emitter`. Returns whether it was tracked. */
  untrack(emitter: SteppableEmitter): boolean {
    return this.#tracked.delete(emitter);
  }

  /** Whether `emitter` is tracked. */
  has(emitter: SteppableEmitter): boolean {
    return this.#tracked.has(emitter);
  }

  /** Stops stepping everything. The system stays registered. */
  clear(): void {
    this.#tracked.clear();
  }

  /** No per-registration setup is needed (§39). */
  initialize(): void {
    // Intentionally empty: the system owns no resources until an emitter is
    // tracked, and it holds no reference to the registry.
  }

  /**
   * Steps every tracked emitter once, in insertion order.
   *
   * **The delta is `time.fixedDeltaTime`** — the scaled simulation delta. The
   * scheduler already applied `timeScale` when filling its accumulator (§10:
   * `accumulator += elapsedRealTime * timeScale`), so a fixed step *is* one
   * `fixedDeltaTime` of scaled simulation time and `timeScale` changes the
   * number of steps per frame. Multiplying by `time.timeScale` here would scale
   * the same time twice and particles would run at `timeScale²` —
   * `AnimationSystem` states the identical rule.
   *
   * **The time is `time.simulationTime`**, which §39's scheduler advances
   * *before* invoking a fixed step, so it is the time the step being produced
   * **ends** at (step *n* sees `n · fixedDeltaTime`). That value is handed to
   * `ParticleForceField.sample(position, velocity, time, out)` — §27's `time`
   * argument, which an animated field (turbulence, a gusting wind) reads. Two
   * consequences worth stating:
   *
   * - `ParticleEmitter.step`'s own default for that argument is the emitter's
   *   *local* elapsed time, measured from its construction and taken at the
   *   *start* of the step. Driving an emitter from this system therefore feeds
   *   fields the **world** simulation clock, offset by one `fixedDeltaTime`
   *   from the emitter-local default. That is the right choice — two emitters in
   *   one scene must see one clock, or a shared wind field blows in two
   *   different directions — and it is why the argument is passed explicitly
   *   rather than left to default.
   * - It is still injected, never read: §33 is satisfied because the value comes
   *   from the context, not from a wall clock.
   *
   * Emission and death bookkeeping belong to the emitter (`emitter.ts` pins the
   * simulate-then-emit order and the per-spawn RNG draw count); this method adds
   * nothing to them.
   */
  fixedUpdate(context: ParticleFixedUpdateContext): void {
    this.#requireLive();
    const { fixedDeltaTime, simulationTime } = context.time;
    for (const emitter of this.#tracked) {
      emitter.step(fixedDeltaTime, simulationTime);
    }
  }

  /**
   * Drops every tracked emitter (§39 teardown).
   *
   * Deliberately does **not** reset or clear them: the system is a driver, not
   * an owner, and disposing an application should not empty pools the
   * application may still be checksumming, serialising, or drawing one last
   * frame from. `AnimationSystem.dispose` draws the same line.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#tracked.clear();
  }
}
