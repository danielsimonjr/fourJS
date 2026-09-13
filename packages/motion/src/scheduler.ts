import {
  DEFAULT_FIXED_DELTA_TIME,
  DEFAULT_MAXIMUM_SUB_STEPS,
  assertFixedDeltaTime,
  assertTimeScale,
  createTimeState,
  type ReadonlyTimeState,
  type TimeState,
} from "./clock.js";

/**
 * Fixed-step scheduler (§10).
 *
 * `Scheduler` is the §10 accumulator loop as a pure state machine:
 * `step(elapsedRealSeconds)` advances a {@link TimeState} and invokes three
 * injected callbacks. It is deliberately **event-free** (plan D4): the
 * `Application` composition root in the `four` package owns the driver (rAF, or
 * manual stepping when headless) and re-emits `fixedUpdate` / `update` /
 * `render` as §6b events. Keeping the scheduler callback-based keeps it usable
 * without an emitter, keeps the loop allocation-free, and keeps event
 * semantics (deferral, unsubscribe) out of the deterministic path.
 *
 * Time is injected — the scheduler never reads a wall clock (§33, ground rule
 * 5). Feed it the same elapsed sequence twice and it produces the same
 * `TimeState` sequence, which is what replay (§34) and the determinism suites
 * (§33) rely on.
 *
 * The §10 algorithm, implemented verbatim in {@link Scheduler.step}:
 *
 * ```text
 * accumulator += elapsedRealTime * timeScale;
 * let steps = 0;
 * while (accumulator >= fixedDeltaTime && steps < maximumSubSteps) {
 *   previousState.copy(currentState);
 *   simulate(fixedDeltaTime);
 *   accumulator -= fixedDeltaTime;
 *   steps += 1;
 * }
 * if (accumulator >= fixedDeltaTime) {
 *   droppedTime += accumulator - fixedDeltaTime;
 *   accumulator = fixedDeltaTime;
 * }
 * alpha = accumulator / fixedDeltaTime;
 * render(interpolate(previousState, currentState, alpha));
 * ```
 *
 * The `previousState.copy(currentState)` snapshot is not the scheduler's job:
 * the scheduler owns no simulation state. Systems that are interpolated (§43)
 * snapshot their own previous pose at the top of their fixed step and read
 * {@link TimeState.interpolationAlpha} when rendering. Render interpolation
 * never feeds back into simulation state (§42).
 *
 * Pause (§10): while `paused`, the accumulator stops accumulating and
 * `deltaTime` is 0, while `unscaledDeltaTime`, `onUpdate`, and `onRender`
 * continue. Pause is implemented as exactly `timeScale = 0` for the frame, with
 * `timeScale` itself preserved across pause and resume — so the two are
 * observationally identical apart from the `paused`/`timeScale` fields.
 */

/** A scheduler callback. Receives the live time record; must not mutate it. */
export type SchedulerCallback = (time: ReadonlyTimeState) => void;

/** Construction options. Omitted numeric options take the Appendix A defaults. */
export interface SchedulerOptions {
  /** Fixed simulation step in seconds. Default 1/60 (Appendix A). */
  fixedDeltaTime?: number;
  /** Maximum fixed steps per `step` call. Default 5 (Appendix A). */
  maximumSubSteps?: number;
  /** Invoked once per fixed simulation step, before `onUpdate`. */
  onFixedStep?: SchedulerCallback;
  /** Invoked once per `step` call, after every fixed step of that call. */
  onUpdate?: SchedulerCallback;
  /** Invoked once per `step` call, last. */
  onRender?: SchedulerCallback;
}

export class Scheduler {
  /**
   * Fixed-step callback (§10 `fixedUpdate`). Assignable after construction so
   * a composition root can attach the §39 system registry (plan D5) to an
   * already-built scheduler; nothing else about the loop is configurable.
   */
  onFixedStep?: SchedulerCallback;

  /** Variable-step callback (§10 `update`). */
  onUpdate?: SchedulerCallback;

  /** Render callback (§10 `render`). */
  onRender?: SchedulerCallback;

  readonly #time: TimeState;

  readonly #maximumSubSteps: number;

  /** Unconsumed simulation time, in seconds; always < `fixedDeltaTime` after the clamp. */
  #accumulator = 0;

  /** Fixed steps executed by the most recent `step` call (§34 replay records this). */
  #fixedStepsLastFrame = 0;

  constructor(options: SchedulerOptions = {}) {
    const fixedDeltaTime = options.fixedDeltaTime ?? DEFAULT_FIXED_DELTA_TIME;
    const maximumSubSteps =
      options.maximumSubSteps ?? DEFAULT_MAXIMUM_SUB_STEPS;
    assertFixedDeltaTime(fixedDeltaTime);
    if (!Number.isInteger(maximumSubSteps) || maximumSubSteps < 1) {
      throw new RangeError(
        `maximumSubSteps must be an integer >= 1 (§10); received ${String(maximumSubSteps)}`,
      );
    }
    this.#time = createTimeState({ fixedDeltaTime });
    this.#maximumSubSteps = maximumSubSteps;
    this.onFixedStep = options.onFixedStep;
    this.onUpdate = options.onUpdate;
    this.onRender = options.onRender;
  }

  /**
   * The live time record (§9). The same object is handed to every callback;
   * copy it with `copyTimeState` to retain a frame's values.
   */
  get time(): ReadonlyTimeState {
    return this.#time;
  }

  /** Fixed simulation step in seconds. Immutable: changing it mid-run would break replay. */
  get fixedDeltaTime(): number {
    return this.#time.fixedDeltaTime;
  }

  /** Substep clamp (§10). Immutable for the same reason. */
  get maximumSubSteps(): number {
    return this.#maximumSubSteps;
  }

  /** Unconsumed simulation time in seconds (diagnostics; `interpolationAlpha` is its normalized form). */
  get accumulator(): number {
    return this.#accumulator;
  }

  /** Fixed steps executed by the most recent `step` call (§10 clamp diagnostics, §34 replay). */
  get fixedStepsLastFrame(): number {
    return this.#fixedStepsLastFrame;
  }

  /** Simulation time scale (§9). Preserved across pause and resume (§10). */
  get timeScale(): number {
    return this.#time.timeScale;
  }

  set timeScale(value: number) {
    assertTimeScale(value);
    this.#time.timeScale = value;
  }

  /** Pause flag (§10). Equivalent to `timeScale = 0` while set, without clobbering `timeScale`. */
  get paused(): boolean {
    return this.#time.paused;
  }

  set paused(value: boolean) {
    this.#time.paused = value;
  }

  /**
   * Advances the loop by `elapsedRealSeconds` of injected wall-clock time.
   *
   * One call is one frame: `frame` increments, the accumulator absorbs the
   * scaled delta, up to `maximumSubSteps` fixed steps run (each invoking
   * `onFixedStep`), the clamp drops any remaining excess into `droppedTime`,
   * `interpolationAlpha` is recomputed, and finally `onUpdate` then `onRender`
   * are invoked. That ordering — `onFixedStep`* → `onUpdate` → `onRender` — is
   * the §10 contract and holds even when zero fixed steps run.
   *
   * `simulationStep` and `simulationTime` are advanced *before* each
   * `onFixedStep` invocation, so inside the callback they describe the state
   * the step is producing (WP-1.9 decision). `interpolationAlpha` is only
   * meaningful in `onUpdate`/`onRender`; during a fixed step it still holds the
   * previous frame's value and must not be read (§42: interpolation never feeds
   * back into simulation).
   *
   * @throws RangeError if `elapsedRealSeconds` is not a finite number >= 0.
   */
  step(elapsedRealSeconds: number): void {
    if (!Number.isFinite(elapsedRealSeconds) || elapsedRealSeconds < 0) {
      throw new RangeError(
        `elapsedRealSeconds must be a finite number of seconds >= 0 (§10); received ${String(elapsedRealSeconds)}`,
      );
    }

    const time = this.#time;
    const fixedDeltaTime = time.fixedDeltaTime;

    time.frame += 1;
    time.realTime += elapsedRealSeconds;
    time.unscaledDeltaTime = elapsedRealSeconds;
    // Pause is `timeScale = 0` for this frame only; `time.timeScale` is untouched (§10).
    time.deltaTime = time.paused ? 0 : elapsedRealSeconds * time.timeScale;
    time.renderTime += time.deltaTime;

    this.#accumulator += time.deltaTime;

    let steps = 0;
    while (
      this.#accumulator >= fixedDeltaTime &&
      steps < this.#maximumSubSteps
    ) {
      time.simulationStep += 1;
      time.simulationTime += fixedDeltaTime;
      try {
        this.onFixedStep?.(time);
      } catch (error) {
        // A throwing step leaves the accumulator holding (the step is re-run
        // next frame — deliberate, §10) — so the counters the callback already
        // saw advanced must step back too, or `simulationStep` runs one ahead
        // of the accumulator for the rest of the session (2026-09-11 audit).
        time.simulationStep -= 1;
        time.simulationTime -= fixedDeltaTime;
        throw error;
      }
      this.#accumulator -= fixedDeltaTime;
      steps += 1;
    }
    this.#fixedStepsLastFrame = steps;

    if (this.#accumulator >= fixedDeltaTime) {
      // Long frame (background tab, debugger pause, GC hitch): drop the excess
      // so simulation cost stays bounded and time falls behind instead of
      // spiralling (§10). The drop surfaces through `droppedTime` (§9).
      time.droppedTime += this.#accumulator - fixedDeltaTime;
      this.#accumulator = fixedDeltaTime;
    }

    // After clamping, alpha remains in [0, 1] (§10); the clamp of the ratio
    // itself only guards floating-point overshoot at the boundary.
    const alpha = this.#accumulator / fixedDeltaTime;
    time.interpolationAlpha = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;

    this.onUpdate?.(time);
    this.onRender?.(time);
  }
}
