/**
 * Kinematic motion (§12) — the {@link KinematicController} component and the
 * {@link KinematicSystem} that advances it (§39 step 4).
 *
 * §12 defines the controller as a command surface:
 *
 * ```ts
 * interface KinematicController {
 *   moveTo(position: Vector3, options?: MoveOptions): void;
 *   rotateTo(rotation: Quaternion, options?: RotateOptions): void;
 *   followPath(path: Curve, options?: PathFollowOptions): void;
 * }
 * ```
 *
 * "Kinematic controllers directly prescribe movement": nothing here integrates
 * forces or velocities — a command states where the node will be as a function
 * of time, and each fixed step evaluates that function and writes the result.
 * That is the whole difference from `MotionComponent` (§11), which derives
 * position from velocity, and from a solver (§37), which derives it from
 * forces.
 *
 * WP-2.5 implements the three methods above; §12's other required features
 * arrived with the Phase 8 advanced-motion packets (§111) — steering in
 * `steering.ts`, look-at constraints in `constraints.ts`, orbit motion and
 * camera rigs in `camera-rigs.ts`, and **character controllers** in
 * `character-controller.ts`, which {@link KinematicSystem} also advances (see
 * below). `followPath` takes the §13 {@link Trajectory} — the codebase
 * has no `Curve` type, and §13's sampler *is* the path abstraction §12 names
 * (decision, WP-2.5).
 *
 * ## Channels (decision, WP-2.5)
 *
 * A controller owns two independent command channels:
 *
 * | channel     | commands                    | writes                |
 * | ----------- | --------------------------- | --------------------- |
 * | translation | `moveTo`, `followPath`      | `transform.position`  |
 * | rotation    | `rotateTo`                  | `transform.rotation`  |
 *
 * Issuing a command **replaces the active command of its own channel** and
 * leaves the other channel untouched, so `moveTo` and `rotateTo` compose (a
 * node can slide and turn at once) while `followPath` **claims the translation
 * channel** and therefore cancels an in-flight `moveTo` — and is cancelled by
 * the next one. Two commands cannot share a channel: the last one issued wins,
 * immediately and without a warning, because "replace the goal" is the normal
 * way to steer a kinematic object.
 *
 * `followPath` writes position only. Aligning a node's facing to its path is a
 * §12 look-at constraint, i.e. a separate feature that would claim the rotation
 * channel; it is deliberately not folded into path following here.
 *
 * ## Where a move starts, and when that is decided (decision, WP-2.5)
 *
 * `moveTo`/`rotateTo` interpolate from the node's pose **at command start** to
 * the target. That pose is captured **lazily, on the first fixed step after the
 * command is issued** — not inside `moveTo` — because commands are issued from
 * application code, which runs *between* fixed steps (§10: the loop is
 * accumulator-driven, and `update` code is not synchronous with `fixedUpdate`).
 * Code that issues a command and then moves the node itself, or issues one from
 * an event handler that runs before some other system's write, would otherwise
 * interpolate from a pose the node no longer has, producing a visible jump on
 * the first step. Capturing at the first step makes "start from wherever the
 * node actually is when the move begins" true by construction.
 *
 * A consequence worth stating: replacing a command mid-flight restarts from the
 * node's *current* pose, which is where the previous command had reached. Moves
 * therefore chain without discontinuity, and a replaced move never rewinds.
 *
 * ## Timing
 *
 * Each channel accumulates its own elapsed time from
 * `TimeState.fixedDeltaTime` — the injected simulation clock, never a wall
 * clock (§33, ground rule 5). The first processed step already advances the
 * command by one `dt`, so a one-second move at 60 Hz is complete after exactly
 * 60 steps rather than 61, and is at its midpoint after 30.
 *
 * Completion is tested with a **relative tolerance**,
 * {@link KINEMATIC_COMPLETION_TOLERANCE}: summing `duration / dt` floating
 * point deltas does not land exactly on `duration` (60 × 1/60 overshoots by
 * 1.3e-15, 120 × 1/120 undershoots by 1.1e-15), and an exact `>=` test would
 * make "arrives at `duration`" depend on which way the rounding happened to
 * fall. 1e-9 of the duration is far below anything observable — a nanosecond of
 * simulated time on a one-second move — and far above the accumulation error
 * for any sane duration. A command that does trip the tolerance early is not
 * approximate: the completing step **snaps to the exact target**
 * (`position.set(target)`, `rotation.copy(target)`), so a move always finishes
 * *on* its target rather than one lerp step short of it.
 *
 * `duration` defaults to `0`, which means "snap on the next fixed step" — the
 * command still takes effect through the system, under the §42 authority check,
 * one step later; it is not a synchronous teleport.
 *
 * ## Completion is polled, not announced (decision, WP-2.5)
 *
 * Commands emit no events. Components are not `EventEmitter`s (§6b puts the
 * emitter on nodes and the application), and inventing a per-component event
 * surface here would pre-empt that design. The observable state is instead
 * three readonly properties — {@link KinematicController.translationActive},
 * {@link KinematicController.rotationActive}, and
 * {@link KinematicController.commandGeneration} — which cover the two questions
 * callers actually ask: "is it there yet?" and "is *my* command still the one
 * running?" (capture the generation when you issue, compare later; a different
 * value means something else took the channel). A `completed` node event can be
 * added later without changing any of this.
 *
 * ## Transform authority (§42)
 *
 * {@link KinematicSystem} writes as the `"kinematic"` authority, exactly like
 * `MotionSystem`, and refuses to write a node owned by anything else — warning
 * once per node through `warnAuthorityConflict` (§42: the owner keeps the
 * transform). A refused node's command is **frozen, not consumed**: its elapsed
 * time does not advance while the write is refused, so granting authority later
 * runs the command from where it stopped for its full remaining duration rather
 * than teleporting it to wherever it "should" have got to. This mirrors WP-2.3's
 * decision for `MotionComponent`, for the same reason: a refusal must be
 * visible and reversible, never silently accrued.
 *
 * An **idle** controller never warns. §42's rule is about *writing* a transform
 * you do not own, and a controller with no active command does not write; a
 * node that is merely equipped with a controller therefore stays quiet until
 * something actually commands it (decision, WP-2.5). A disabled node (§6
 * `enabled`) is skipped before the check, and its commands freeze too.
 *
 * ## Allocation (plan D7)
 *
 * A controller allocates its scratch vectors and quaternions once, in its
 * constructor; issuing a command copies into them and stepping writes through
 * them. Nothing on the per-step path allocates, including path following, which
 * samples the trajectory with an `out` vector. `moveTo`/`rotateTo` **copy**
 * their targets, so the caller keeps ownership of the vector it passed and may
 * mutate or reuse it immediately. `followPath` keeps a **reference** to the
 * trajectory (§13 trajectories are pure functions of time — copying one is not
 * meaningful), so a trajectory must not be mutated while it is being followed.
 */

import { FourError, type Component, type ComponentHost } from "@fourjs/core";
import { Quaternion, Vector3 } from "@fourjs/math";
import {
  warnAuthorityConflict,
  type Node,
  type Transform,
} from "@fourjs/scene";

import {
  CharacterController,
  FirstPersonLook,
} from "./character-controller.js";
import {
  PRIORITY_KINEMATICS,
  type FixedUpdateContext,
  type SimulationSystem,
} from "./systems.js";
import type { Trajectory } from "./trajectories.js";

/**
 * Relative slack on the "has the command reached its duration?" test.
 *
 * A command completes once `elapsed >= duration - |duration| · tolerance`. See
 * the module note on timing for why the tolerance exists and why `1e-9` is the
 * value: it swamps the worst realistic accumulation error of summing `dt`s
 * (`duration · ε / dt`, about 1.3e-11 relative for a 1000 s command at 60 Hz)
 * while remaining unobservable as time.
 */
export const KINEMATIC_COMPLETION_TOLERANCE = 1e-9;

/** Options for {@link KinematicController.moveTo} (§12 `MoveOptions`). */
export interface MoveOptions {
  /**
   * Travel time in seconds (§7a). Must be finite and `>= 0`. Default `0`,
   * meaning the node snaps to the target on the next fixed step.
   */
  duration?: number;
}

/** Options for {@link KinematicController.rotateTo} (§12 `RotateOptions`). */
export interface RotateOptions {
  /**
   * Rotation time in seconds (§7a). Must be finite and `>= 0`. Default `0`,
   * meaning the node snaps to the target orientation on the next fixed step.
   */
  duration?: number;
}

/** Options for {@link KinematicController.followPath} (§12 `PathFollowOptions`). */
export interface PathFollowOptions {
  /**
   * Restart at the beginning of the trajectory when its `duration` is passed,
   * instead of stopping at the end. Default `false`.
   *
   * A looping path never completes: `translationActive` stays `true` until the
   * command is replaced or cancelled.
   */
  loop?: boolean;
}

/** Which command owns the translation channel. */
type TranslationMode = "none" | "move" | "path";

/** Which command owns the rotation channel. */
type RotationMode = "none" | "rotate";

/** The §42 authority {@link KinematicSystem} writes under. Module-private. */
const KINEMATIC_SYSTEM_AUTHORITY = "kinematic";

/**
 * Whether an elapsed time has reached `duration`, within
 * {@link KINEMATIC_COMPLETION_TOLERANCE}. A `duration` of `0` is reached
 * immediately; a non-finite one is never reached.
 */
function hasReached(elapsed: number, duration: number): boolean {
  return (
    elapsed >= duration - Math.abs(duration) * KINEMATIC_COMPLETION_TOLERANCE
  );
}

/** Throws unless `value` is a finite number `>= 0`. */
function assertDuration(value: number, what: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${what} must be a finite number of seconds >= 0 (§7a); received ${String(value)}`,
    );
  }
}

/**
 * Prescribed kinematic motion attached to a node (§12), advanced by
 * {@link KinematicSystem}.
 *
 * ```ts
 * const controller = node.addComponent(new KinematicController());
 * node.transformAuthority = "kinematic"; // §42 — required, see below
 * system.track(node);
 *
 * controller.moveTo(new Vector3(10, 0, 0), { duration: 2 });
 * controller.rotateTo(target, { duration: 1 }); // runs concurrently
 * ```
 *
 * A component per plan D2: a class with a `static readonly typeName`, one per
 * node, holding no reference to its node (`host` is assigned by the registry).
 * All behaviour is in {@link KinematicController.step}, which the system calls
 * once per fixed step.
 *
 * See the module documentation for the channel model, the lazy start-pose
 * capture, completion semantics, and the §42 authority rules.
 */
export class KinematicController implements Component {
  /** Component key (plan D2) and §79 serialization name. */
  static readonly typeName = "kinematic-controller";

  /**
   * The node this component is attached to, or `null`. Written by the
   * `ComponentRegistry` alone (§6a); never assign it.
   */
  host: ComponentHost | null = null;

  // --- translation channel --------------------------------------------------

  #translationMode: TranslationMode = "none";

  /** Seconds of processed simulation since the translation command started. */
  #translationElapsed = 0;

  /** Whether {@link #moveStart} holds this command's captured start position. */
  #translationCaptured = false;

  /** Pose the active `moveTo` interpolates from; captured on its first step. */
  readonly #moveStart = new Vector3();

  /** Target of the active `moveTo`; a copy, so the caller keeps its vector. */
  readonly #moveTarget = new Vector3();

  /** Duration of the active `moveTo`, in seconds. */
  #moveDuration = 0;

  /** Trajectory of the active `followPath`, or `null`. Held by reference. */
  #path: Trajectory | null = null;

  /** Whether the active `followPath` wraps at `path.duration`. */
  #pathLoop = false;

  /** Sample target for path following, so stepping allocates nothing (D7). */
  readonly #pathSample = new Vector3();

  // --- rotation channel -----------------------------------------------------

  #rotationMode: RotationMode = "none";

  /** Seconds of processed simulation since the rotation command started. */
  #rotationElapsed = 0;

  /** Whether {@link #rotateStart} holds this command's captured start rotation. */
  #rotationCaptured = false;

  /** Orientation the active `rotateTo` interpolates from. */
  readonly #rotateStart = new Quaternion();

  /** Target of the active `rotateTo`; a copy. */
  readonly #rotateTarget = new Quaternion();

  /** Duration of the active `rotateTo`, in seconds. */
  #rotateDuration = 0;

  /** Slerp workspace, so the transform's rotation is written exactly once. */
  readonly #rotateScratch = new Quaternion();

  // --- observable state -----------------------------------------------------

  #commandGeneration = 0;

  /**
   * Whether a `moveTo` or `followPath` is currently running.
   *
   * `true` from the moment the command is issued until the step that completes
   * it (inclusive of that step's write); a looping `followPath` keeps it `true`
   * indefinitely. Polled, not announced — see the module note.
   */
  get translationActive(): boolean {
    return this.#translationMode !== "none";
  }

  /** Whether a `rotateTo` is currently running. See {@link translationActive}. */
  get rotationActive(): boolean {
    return this.#rotationMode !== "none";
  }

  /**
   * Number of commands accepted by this controller, counting both channels and
   * every explicit cancel.
   *
   * Monotonic, starts at `0`, and changes **only** through the command API —
   * never when a command completes on its own. Capture it when you issue a
   * command and compare later: an unchanged value means your command is still
   * the one that owns its channel (combine with {@link translationActive} /
   * {@link rotationActive} to tell "still running" from "finished").
   */
  get commandGeneration(): number {
    return this.#commandGeneration;
  }

  // --- commands (§12) -------------------------------------------------------

  /**
   * Moves the node to `position` over `options.duration` seconds, replacing any
   * active translation command (`moveTo` or `followPath`).
   *
   * `position` is copied. Interpolation is linear, from the node's position at
   * the first fixed step after this call to `position`; the completing step
   * writes `position` exactly.
   *
   * @throws RangeError if `duration` is not a finite number `>= 0`.
   */
  moveTo(position: Vector3, options: MoveOptions = {}): void {
    const duration = options.duration ?? 0;
    assertDuration(duration, "MoveOptions.duration");
    this.#moveTarget.copy(position);
    this.#moveDuration = duration;
    this.#path = null;
    this.#pathLoop = false;
    this.#translationMode = "move";
    this.#translationElapsed = 0;
    this.#translationCaptured = false;
    this.#commandGeneration += 1;
  }

  /**
   * Rotates the node to `rotation` over `options.duration` seconds, replacing
   * any active rotation command. Does not touch the translation channel.
   *
   * `rotation` is copied and assumed to be a unit quaternion (as everywhere in
   * `@fourjs/math`). Interpolation is spherical along the **shortest arc** (plan
   * D8 — `Quaternion.slerp` negates the target when the dot product is
   * negative), from the node's rotation at the first fixed step after this call;
   * the completing step writes `rotation`'s components exactly, so the node
   * finishes on the quaternion you asked for rather than on its antipode.
   *
   * @throws RangeError if `duration` is not a finite number `>= 0`.
   */
  rotateTo(rotation: Quaternion, options: RotateOptions = {}): void {
    const duration = options.duration ?? 0;
    assertDuration(duration, "RotateOptions.duration");
    this.#rotateTarget.copy(rotation);
    this.#rotateDuration = duration;
    this.#rotationMode = "rotate";
    this.#rotationElapsed = 0;
    this.#rotationCaptured = false;
    this.#commandGeneration += 1;
  }

  /**
   * Drives the node along `trajectory` (§13), replacing any active translation
   * command — path following **claims the translation channel**, so it cancels
   * an in-flight `moveTo` and is cancelled by the next one.
   *
   * The node is placed at `trajectory.samplePosition(t)` each step, with `t`
   * the seconds of simulation processed since the path started (so the node
   * jumps onto the path on its first step rather than easing onto it — prefix a
   * `moveTo` if you need to approach it). `t` is clamped to
   * `trajectory.duration`, at which point the command completes; with
   * `options.loop` it wraps (`t % duration`) and never completes.
   *
   * A trajectory whose `duration` is not a finite positive number — `Infinity`
   * for an endless path, and any degenerate `0`/negative/`NaN` value — is
   * neither clamped nor wrapped: `t` simply keeps increasing and the command
   * runs until it is replaced or cancelled. §13 trajectories extrapolate their
   * closed form outside `[0, duration]`, so that is well defined.
   *
   * The trajectory is held by reference and must not be mutated while it is
   * being followed. `duration` is read every step, so a trajectory that
   * recomputes its own extent stays honest.
   */
  followPath(trajectory: Trajectory, options: PathFollowOptions = {}): void {
    this.#path = trajectory;
    this.#pathLoop = options.loop ?? false;
    this.#translationMode = "path";
    this.#translationElapsed = 0;
    this.#translationCaptured = false;
    this.#commandGeneration += 1;
  }

  /**
   * Stops the active translation command where it is (the node keeps the
   * position it has reached) and bumps {@link commandGeneration}. A no-op
   * beyond the counter when the channel is already idle.
   */
  cancelTranslation(): void {
    this.#translationMode = "none";
    this.#translationCaptured = false;
    this.#path = null;
    this.#commandGeneration += 1;
  }

  /** Stops the active rotation command where it is. See {@link cancelTranslation}. */
  cancelRotation(): void {
    this.#rotationMode = "none";
    this.#rotationCaptured = false;
    this.#commandGeneration += 1;
  }

  /** Stops both channels. Bumps {@link commandGeneration} twice. */
  cancel(): void {
    this.cancelTranslation();
    this.cancelRotation();
  }

  // --- stepping -------------------------------------------------------------

  /**
   * Advances both channels by `deltaSeconds` and writes the results into
   * `transform`.
   *
   * Called by {@link KinematicSystem} once per fixed step. Calling it directly
   * is supported (a controller driven without a system, or a unit test), but it
   * performs **no §42 authority check** — that belongs to the system, which
   * knows the node; this method only knows a transform.
   *
   * An idle channel costs one comparison and writes nothing, so a controller
   * with no active command never bumps `Transform.version`.
   */
  step(transform: Transform, deltaSeconds: number): void {
    if (this.#translationMode !== "none") {
      this.#stepTranslation(transform, deltaSeconds);
    }
    if (this.#rotationMode !== "none") {
      this.#stepRotation(transform, deltaSeconds);
    }
  }

  /** One translation step: `moveTo` lerp or `followPath` sample. */
  #stepTranslation(transform: Transform, deltaSeconds: number): void {
    const position = transform.position;
    if (this.#translationMode === "move") {
      if (!this.#translationCaptured) {
        // Start pose captured here, not in `moveTo` — see the module note.
        this.#moveStart.copy(position);
        this.#translationCaptured = true;
      }
      const elapsed = this.#translationElapsed + deltaSeconds;
      this.#translationElapsed = elapsed;

      const target = this.#moveTarget;
      if (hasReached(elapsed, this.#moveDuration)) {
        this.#translationMode = "none";
        this.#translationCaptured = false;
        position.set(target.x, target.y, target.z);
        return;
      }
      const u = elapsed / this.#moveDuration;
      const start = this.#moveStart;
      position.set(
        start.x + (target.x - start.x) * u,
        start.y + (target.y - start.y) * u,
        start.z + (target.z - start.z) * u,
      );
      return;
    }

    // --- followPath ---------------------------------------------------------
    const path = this.#path;
    if (path === null) {
      // Unreachable: `#translationMode === "path"` implies a path. Defensive
      // only, so a future edit cannot turn a lost path into a crash.
      this.#translationMode = "none";
      return;
    }
    const elapsed = this.#translationElapsed + deltaSeconds;
    this.#translationElapsed = elapsed;

    const duration = path.duration;
    let time = elapsed;
    let finished = false;
    if (Number.isFinite(duration) && duration > 0) {
      if (this.#pathLoop) {
        time = elapsed % duration;
      } else if (hasReached(elapsed, duration)) {
        time = duration;
        finished = true;
      }
    }
    const sample = path.samplePosition(time, this.#pathSample);
    if (finished) {
      this.#translationMode = "none";
      this.#translationCaptured = false;
      this.#path = null;
    }
    position.set(sample.x, sample.y, sample.z);
  }

  /** One rotation step: shortest-arc slerp toward the target. */
  #stepRotation(transform: Transform, deltaSeconds: number): void {
    const rotation = transform.rotation;
    if (!this.#rotationCaptured) {
      this.#rotateStart.copy(rotation);
      this.#rotationCaptured = true;
    }
    const elapsed = this.#rotationElapsed + deltaSeconds;
    this.#rotationElapsed = elapsed;

    const target = this.#rotateTarget;
    if (hasReached(elapsed, this.#rotateDuration)) {
      this.#rotationMode = "none";
      this.#rotationCaptured = false;
      rotation.copy(target);
      return;
    }
    const u = elapsed / this.#rotateDuration;
    // Slerp on scratch, then one `copy` onto the transform: a single change
    // hook, hence a single `Transform.version` bump per step (plan D3).
    this.#rotateScratch.copy(this.#rotateStart).slerp(target, u);
    rotation.copy(this.#rotateScratch);
  }
}

/** Options for {@link KinematicSystem}. */
export interface KinematicSystemOptions {
  /**
   * Execution order key (§39). Default {@link PRIORITY_KINEMATICS} — step 4,
   * "kinematic motion". Read once, at registration.
   *
   * `MotionSystem` defaults to the same priority; two systems of equal priority
   * run in **registration order** (§39 registry rule 2). They do not collide in
   * practice — a node driven by a `KinematicController` is prescribing its pose
   * outright, so giving it a `MotionComponent` as well means two writers under
   * one authority, which §42 cannot catch. Pick one per node.
   */
  priority?: number;
}

/**
 * Advances every tracked node's {@link KinematicController} once per fixed step
 * (§39 step 4).
 *
 * ```ts
 * const system = new KinematicSystem();
 * registry.register(system);
 * node.addComponent(new KinematicController());
 * node.transformAuthority = "kinematic"; // §42
 * system.track(node);
 * ```
 *
 * ## Three components, one system, one authority (§42; PH-11 residue, 2026-08-21)
 *
 * This system also advances §12's {@link CharacterController} and §44's
 * {@link FirstPersonLook}, for `ConstraintSystem`'s reason: all three
 * components write a transform under the **same** `"kinematic"` authority, and
 * §42's check compares the authority, not the system instance — so a second
 * system would be a second writer that nothing could catch. Within a node the
 * order is fixed:
 *
 * 1. locomotion — {@link CharacterController} (position and yaw);
 * 2. free look — {@link FirstPersonLook} (rotation only);
 * 3. commands — {@link KinematicController} (`moveTo`, `rotateTo`,
 *    `followPath`).
 *
 * The command channel runs **last** deliberately: a scripted move is what takes
 * a character away from the player, so an active command wins over locomotion
 * for the steps it runs. They are alternatives, not layers — as an `OrbitRig`
 * and a `FollowRig` on one node are.
 *
 * A component is stepped only when it is `active`, and a node whose components
 * are all idle is skipped **before** the §42 check, so it reports no conflict.
 *
 * Tracking is explicit and mirrors `MotionSystem`'s mechanism exactly, for the
 * reasons documented there: the component is looked up every step (so
 * attaching, detaching, or replacing it needs no re-tracking), the tracked set
 * is iterated in **insertion order** (§33), a node with `enabled === false` is
 * skipped, and mutating the set during a step follows `Set` iteration
 * semantics. Stepping allocates nothing (plan D7).
 */
export class KinematicSystem implements SimulationSystem {
  /** Execution order key (§39); default {@link PRIORITY_KINEMATICS}. */
  priority: number;

  /** Tracked nodes in insertion order (§33: deterministic iteration). */
  readonly #tracked = new Set<Node>();

  /** Set by {@link KinematicSystem.dispose}; disposal is terminal (§83). */
  #disposed = false;

  /**
   * Whether {@link KinematicSystem.dispose} has run. Disposal is terminal
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
        "KinematicSystem is disposed; advancing nodes through a disposed system is a " +
          "lifetime mistake (§83), and a new system is a new " +
          "KinematicSystem.",
        { context: { system: "KinematicSystem" } },
      );
    }
  }

  constructor(options: KinematicSystemOptions = {}) {
    this.priority = options.priority ?? PRIORITY_KINEMATICS;
  }

  /** Number of tracked nodes. */
  get size(): number {
    return this.#tracked.size;
  }

  /** Tracked nodes, in the order they will be advanced. */
  get nodes(): IterableIterator<Node> {
    return this.#tracked.values();
  }

  /**
   * Starts advancing `node`. Idempotent — tracking a node twice keeps its
   * original position in the iteration order. Returns `node`.
   *
   * The node need not have a {@link KinematicController} yet; it is looked up
   * every step, so tracking first and attaching later is fine.
   */
  track(node: Node): Node {
    this.#requireLive();
    this.#tracked.add(node);
    return node;
  }

  /** Stops advancing `node`. Returns whether it was tracked. */
  untrack(node: Node): boolean {
    return this.#tracked.delete(node);
  }

  /** Whether `node` is tracked. */
  has(node: Node): boolean {
    return this.#tracked.has(node);
  }

  /** Stops advancing every node. The system stays registered. */
  clear(): void {
    this.#tracked.clear();
  }

  /** No per-registration setup is needed (§39). */
  initialize(): void {
    // Intentionally empty: the system owns no resources until nodes are tracked.
  }

  /**
   * Advances every tracked node's active locomotion and commands by
   * `time.fixedDeltaTime`, in the order documented on the class.
   */
  fixedUpdate(context: FixedUpdateContext): void {
    this.#requireLive();
    const dt = context.time.fixedDeltaTime;
    for (const node of this.#tracked) {
      if (!node.enabled) {
        continue;
      }
      const character = node.getComponent(CharacterController);
      const look = node.getComponent(FirstPersonLook);
      const controller = node.getComponent(KinematicController);
      const characterActive = character !== undefined && character.active;
      const lookActive = look !== undefined && look.active;
      const commandActive =
        controller !== undefined &&
        (controller.translationActive || controller.rotationActive);
      if (!characterActive && !lookActive && !commandActive) {
        // Idle: no write, so no §42 conflict to report. See the module note.
        continue;
      }
      // §42: this system writes as `kinematic`; anything else owns the
      // transform, so the write is refused and the command is left frozen —
      // its elapsed time only advances on steps that actually write.
      if (node.transformAuthority !== KINEMATIC_SYSTEM_AUTHORITY) {
        warnAuthorityConflict(node, KINEMATIC_SYSTEM_AUTHORITY);
        continue;
      }
      const transform = node.transform;
      if (characterActive) {
        character.step(transform, dt);
      }
      if (lookActive) {
        look.step(transform);
      }
      if (commandActive) {
        controller.step(transform, dt);
      }
    }
  }

  /** Drops every tracked node (§39 teardown). */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#tracked.clear();
  }
}
