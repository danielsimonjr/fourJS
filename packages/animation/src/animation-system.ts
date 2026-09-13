/**
 * The fixed-step animation system (§39 step 3, plan decision P4-1).
 *
 * §39 gives the engine one extension point for per-fixed-step work, and its
 * step 3 is "animation target evaluation". {@link AnimationSystem} is that step:
 * a `SimulationSystem` that advances every tracked tween, timeline, and clip
 * mixer once per fixed simulation step.
 *
 * ```ts
 * const animation = new AnimationSystem();
 * app.systems.register(animation);          // priority 300 (§39 step 3)
 * app.systems.register(new MotionSystem()); // priority 400 (§39 step 4)
 *
 * animation.track(animate(node).to({ "transform.position.x": 5 }, 1).play());
 * ```
 *
 * ## Why the fixed step (P4-1)
 *
 * Animation could plausibly run on the variable `update` — it is presentation,
 * not simulation. It does not, for three stated reasons:
 *
 * 1. **§16 deterministic evaluation.** A fixed delta makes the sequence of local
 *    times a tween sees a function of the step count alone, not of frame rate.
 * 2. **§34 replay.** Replaying an injected elapsed-time sequence reproduces the
 *    same fixed steps, so it reproduces the same animation, marker firings
 *    included.
 * 3. **§19 blending.** The physics-animation pipeline is *animation pose →
 *    kinematic modification → physics solve*, all inside one step; an animation
 *    pose produced on a different clock could not feed it.
 *
 * The cost is stated too: a non-transform property (an opacity, a material
 * color) steps at the fixed rate rather than the display rate. At the Appendix A
 * default of 60 Hz that is invisible; a variable-rate tier, if it is ever
 * needed, is a second system rather than a change to this one.
 *
 * Transforms written here reach the screen through the existing §43 pose
 * interpolation, which already interpolates between the previous and current
 * fixed-step pose — nothing in this file knows about rendering.
 *
 * ## Ordering (P4-1: before `MotionSystem`)
 *
 * §19's pipeline requires animation to run **before** kinematic motion. The
 * system cannot enforce that from inside — ordering belongs to the §39 registry
 * — so it declares it the way §39 says to: {@link PRIORITY_ANIMATION_TARGETS}
 * (300) is strictly below `MotionSystem`'s {@link PRIORITY_KINEMATICS} (400),
 * and `SystemRegistry` runs systems in ascending priority **regardless of
 * registration order**. Two systems that share a priority run in registration
 * order. Both facts are asserted in `tests/animation-system.test.ts`, because
 * "registered before MotionSystem" is a claim about the registry, not about a
 * comment.
 *
 * ## No clocks (§33)
 *
 * The delta comes from the injected `FixedUpdateContext`; nothing here reads
 * `Date.now`, `performance.now`, or `Math.random`, and the tracked set is
 * iterated in insertion order only.
 */

import { FourError } from "@fourjs/core";
import {
  PRIORITY_ANIMATION_TARGETS,
  type FixedUpdateContext,
  type SimulationSystem,
} from "@fourjs/motion";

/**
 * Playback state vocabulary shared by every animation player — `TweenState`,
 * `TimelineState`, and `MixerState` are the same five values, deliberately, so
 * one system can hold all three.
 */
export type AnimationPlaybackState =
  "idle" | "running" | "paused" | "finished" | "stopped";

/**
 * What {@link AnimationSystem} can advance: a `Tween`, a `Timeline`, or an
 * `AnimationMixer`.
 *
 * Structural rather than a union of the three classes, for the same reason
 * `TimelineChild` is: the system states its actual requirements — something that
 * moves by a delta in seconds and can say whether it is done — so a future
 * player satisfies it without this file importing it, and a test can drive it
 * with a three-line stub.
 */
export interface Advanceable {
  /** Playback state; see {@link AnimationSystem.fixedUpdate} on auto-untracking. */
  readonly state: AnimationPlaybackState;
  /** Whether playback has reached its end. */
  readonly finished: boolean;
  /** Advances local time by `deltaSeconds`, writing the resulting values. */
  advance(deltaSeconds: number): unknown;
}

/** Options for {@link AnimationSystem}. */
export interface AnimationSystemOptions {
  /**
   * Execution order key (§39). Default {@link @fourjs/motion!PRIORITY_ANIMATION_TARGETS | PRIORITY_ANIMATION_TARGETS} —
   * step 3, "animation target evaluation", which is below `MotionSystem`'s
   * step 4 as P4-1 requires. Read once, at registration.
   */
  priority?: number;
}

/**
 * Advances every tracked animation player once per fixed step (§39 step 3).
 *
 * ## Which players it advances (decision, WP-4.6)
 *
 * Explicit registration, exactly as `MotionSystem` tracks nodes: a player is
 * advanced because {@link AnimationSystem.track} was called with it. A tween
 * does not attach itself to a system — it has no way to know which system, or
 * which application, should own it — so `play()` starts a tween and `track()`
 * makes something move it.
 *
 * ## Auto-untracking (decision, WP-4.6)
 *
 * After advancing a player the system drops it if it is `finished` **or**
 * `"stopped"`, because those are precisely the states from which `advance` can
 * never do anything again:
 *
 * | state       | advance does | tracked after the step |
 * | ----------- | ------------ | ---------------------- |
 * | `"running"` | animates     | yes                    |
 * | `"paused"`  | nothing      | yes — `resume()` revives it |
 * | `"idle"`    | nothing      | yes — `play()` revives it   |
 * | `"finished"`| nothing      | **no**                 |
 * | `"stopped"` | nothing      | **no**                 |
 *
 * Keeping a finished tween would cost a call per step forever and hold its
 * target alive; dropping a paused or idle one would silently break the two
 * legitimate ways of resuming. A finished player is *not* stopped by the system:
 * it keeps its values and can still be scrubbed with `seek`, and a caller that
 * wants its §16 property claims released calls `stop()` itself.
 *
 * ## Mutation during a step
 *
 * The tracked set is a `Set` iterated live, mirroring `MotionSystem` (a snapshot
 * would allocate every step). The consequences, which are `Set` semantics:
 * a player untracked during the step — including by the system's own
 * auto-untracking, and by an `onComplete` callback — is not advanced again in
 * that step, and one tracked during the step *is* advanced in the same step.
 * Track and untrack outside the step if that distinction matters.
 */
export class AnimationSystem implements SimulationSystem {
  /** Execution order key (§39); default {@link @fourjs/motion!PRIORITY_ANIMATION_TARGETS | PRIORITY_ANIMATION_TARGETS}. */
  priority: number;

  /** Tracked players in insertion order (§33: deterministic iteration). */
  readonly #tracked = new Set<Advanceable>();

  /** Set by {@link AnimationSystem.dispose}; disposal is terminal (§83). */
  #disposed = false;

  /**
   * Whether {@link AnimationSystem.dispose} has run. Disposal is terminal
   * (§83): a disposed system refuses its mutating entry points with
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
        "AnimationSystem is disposed; advancing players through a disposed system is a " +
          "lifetime mistake (§83), and a new system is a new " +
          "AnimationSystem.",
        { context: { system: "AnimationSystem" } },
      );
    }
  }

  constructor(options: AnimationSystemOptions = {}) {
    this.priority = options.priority ?? PRIORITY_ANIMATION_TARGETS;
  }

  /** Number of tracked players. */
  get size(): number {
    return this.#tracked.size;
  }

  /** Tracked players, in the order they will be advanced. */
  get items(): IterableIterator<Advanceable> {
    return this.#tracked.values();
  }

  /**
   * Starts advancing `item` and returns it, so a player can be built, played,
   * and tracked in one expression. Idempotent — tracking twice keeps the
   * original position in the iteration order.
   *
   * The player need not be playing yet: an `"idle"` tween is advanced (a no-op)
   * until something calls `play()` on it.
   */
  track<T extends Advanceable>(item: T): T {
    this.#requireLive();
    this.#tracked.add(item);
    return item;
  }

  /** Stops advancing `item`. Returns whether it was tracked. */
  untrack(item: Advanceable): boolean {
    return this.#tracked.delete(item);
  }

  /** Whether `item` is tracked. */
  has(item: Advanceable): boolean {
    return this.#tracked.has(item);
  }

  /** Stops advancing everything. The system stays registered. */
  clear(): void {
    this.#tracked.clear();
  }

  /** No per-registration setup is needed (§39). */
  initialize(): void {
    // Intentionally empty: the system owns no resources until players are
    // tracked, and it holds no reference to the registry.
  }

  /**
   * Advances every tracked player by one fixed step, in insertion order, then
   * drops the ones that can never advance again (see the class documentation).
   *
   * The delta is `time.fixedDeltaTime` — the **scaled simulation delta**. The
   * scheduler has already applied `timeScale` when filling its accumulator
   * (§10: `accumulator += elapsedRealTime * timeScale`), so a fixed step *is*
   * one `fixedDeltaTime` of scaled simulation time and the number of steps per
   * frame is what `timeScale` changes. Multiplying by `time.timeScale` here
   * would scale the same time twice, and animation would run at `timeScale²`.
   *
   * Allocates nothing.
   */
  fixedUpdate(context: FixedUpdateContext): void {
    this.#requireLive();
    const dt = context.time.fixedDeltaTime;
    for (const item of this.#tracked) {
      item.advance(dt);
      if (item.finished || item.state === "stopped") {
        this.#tracked.delete(item);
      }
    }
  }

  /**
   * Drops every tracked player (§39 teardown).
   *
   * Deliberately does **not** stop them: the system is a driver, not an owner,
   * and disposing an application should not reach into animations that the
   * application may still be scrubbing or serializing.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#tracked.clear();
  }
}
