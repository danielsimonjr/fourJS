/**
 * Previous/current pose storage and render interpolation (§43).
 *
 * Physics and every other fixed-step system advance the world at a fixed rate;
 * rendering happens at whatever rate the display runs at, usually somewhere
 * between two simulation steps. §43 states the fix:
 *
 * ```ts
 * renderPosition = lerp(
 *   previousPhysicsPosition,
 *   currentPhysicsPosition,
 *   interpolationAlpha
 * );
 * ```
 *
 * with "rotations should use quaternion spherical interpolation". That needs
 * somewhere to keep the *previous* pose, which is what {@link PoseBuffer} is.
 *
 * ## One store, one owner (§37)
 *
 * §37 says the previous pose used for render interpolation is "the solver's
 * pre-step body state, retained by the physics package". This buffer is that
 * retention, hoisted to the scene so that everything which moves a node —
 * `MotionSystem`, the kinematic controller, an animation track, and from Phase
 * 5 the physics adapter — is interpolated by one mechanism instead of one per
 * subsystem. There is exactly **one** previous/current store in the engine and
 * it lives here; the physics package will write into this same store rather
 * than starting a second one.
 *
 * Physics needs no extra API to do that: by the §39 order the solver publishes
 * solved transforms at step 6 (`PRIORITY_PHYSICS_SOLVE`) and the snapshot slot
 * runs at step 10 (`PRIORITY_SNAPSHOT`), so the capture below already sees the
 * post-solve pose of every body it tracks. See {@link createSnapshotSystem}.
 *
 * ## Local pose, not world pose (decision, WP-2.6)
 *
 * The buffer stores each node's **local** `transform.position` and
 * `transform.rotation`. Two reasons:
 *
 * 1. It is what the simulation systems actually write. `MotionSystem`, the
 *    kinematic controller, and the physics sync all author the local transform
 *    (a body's world pose is written into the local transform of a root-level
 *    node, or converted on the way in), so the local pose is the quantity that
 *    genuinely differs between two fixed steps.
 * 2. It is what §43's formula interpolates: position and rotation as a
 *    lerp/slerp pair. A world *matrix* cannot be interpolated that way at all
 *    without being decomposed first, and a decomposition per node per frame is
 *    exactly the cost this design avoids.
 *
 * A world render pose therefore derives the same way an ordinary world matrix
 * does — by composition through the hierarchy (`world-transforms.ts`) — with
 * interpolated local poses at each level. The consequence to know: if an
 * ancestor is tracked but a descendant is not, the descendant follows the
 * ancestor's interpolated motion (correct) but contributes its own un-lagged
 * local pose (also correct — it did not move). Only a node whose local pose
 * changes per step needs tracking.
 *
 * ## Render poses are presentation-only
 *
 * §43: "the render transform should not feed back into the physics state", and
 * §42 makes the same point from the authority side — interpolation is not a
 * transform writer and never becomes the owner of a node. So:
 *
 * > **A render pose must never be written back into `node.transform`.**
 *
 * {@link PoseBuffer.computeRenderPose} therefore writes into caller-owned `out`
 * objects and this module deliberately offers **no** API that assigns a render
 * pose to a transform. Writing one back would poison the next capture (the
 * interpolated pose would become the next "current" pose, and the simulation
 * would visibly lag and drift), and under §42 it would be a second writer of a
 * transform some other system owns. Renderers consume the `out` values
 * directly when they build their draw data; nothing else needs them.
 *
 * ## Allocation
 *
 * Steady state allocates nothing (§7b, plan D7): the per-node poses are
 * allocated once by {@link PoseBuffer.track} and copied into forever after, and
 * both capture and interpolation take their destinations as parameters. The
 * tracked set is iterated as an array, in insertion order (ground rule 5).
 */

import { Quaternion, Vector3 } from "@fourjs/math";

import type { Node } from "./node.js";

/**
 * Priority of the system returned by {@link createSnapshotSystem}: step 10 of
 * the §39 order, "state snapshot".
 *
 * The value is duplicated from `@fourjs/motion`'s `PRIORITY_SNAPSHOT` rather than
 * imported, because `@fourjs/scene` must not depend on `@fourjs/motion` — the
 * dependency runs the other way (plan §3.1). The two constants must stay equal;
 * `tests/interpolation.test.ts` asserts it so the duplication cannot drift.
 */
export const POSE_SNAPSHOT_PRIORITY = 1000;

/** Per-node storage: the two poses §43 interpolates between. Never reallocated. */
interface PoseEntry {
  readonly node: Node;
  readonly previousPosition: Vector3;
  readonly previousRotation: Quaternion;
  readonly currentPosition: Vector3;
  readonly currentRotation: Quaternion;
  /**
   * False until this entry's first {@link PoseBuffer.capture}, which seeds both
   * poses from the same transform instead of shifting the track-time pose into
   * `previous`.
   */
  captured: boolean;
}

/**
 * The engine's previous/current pose store (§37, §43).
 *
 * Lifecycle of one node:
 *
 * ```ts
 * const poses = new PoseBuffer();
 * poses.track(node);                       // both poses = the node's pose now
 * // … per fixed step, after every system has run:
 * poses.capture();                         // previous ← current, current ← node
 * // … per rendered frame:
 * poses.computeRenderPose(node, time.interpolationAlpha, outPos, outRot);
 * poses.untrack(node);                     // when the node stops moving or dies
 * ```
 *
 * The buffer holds **strong** references to the nodes it tracks (it has to
 * iterate them, which a `WeakMap` cannot do), so a tracked node is kept alive
 * until it is untracked or {@link PoseBuffer.clear} is called. Whoever tracks a
 * node owns that call — normally the same component that made the node move.
 */
export class PoseBuffer {
  /** Tracked entries in insertion order; iterated by index, never re-sorted. */
  readonly #entries: PoseEntry[] = [];

  /** Node → entry, so lookup and membership tests are O(1). */
  readonly #index = new Map<Node, PoseEntry>();

  /**
   * Subtree visitor of {@link PoseBuffer.capture}, allocated once per buffer so
   * a per-step subtree capture allocates nothing.
   */
  readonly #captureVisitor = (node: Node): void => {
    const entry = this.#index.get(node);
    if (entry !== undefined) {
      captureEntry(entry);
    }
  };

  /** Number of tracked nodes. */
  get size(): number {
    return this.#entries.length;
  }

  /** Whether `node` is tracked. */
  has(node: Node): boolean {
    return this.#index.has(node);
  }

  /**
   * Starts interpolating `node`, seeding **both** stored poses from its current
   * `transform.position`/`transform.rotation`. Returns `this`.
   *
   * Seeding matters: a tracked node is renderable immediately, at any alpha,
   * and there is never a window in which the buffer holds an uninitialized —
   * or worse, a stale-from-a-previous-tracking — pose to interpolate from. The
   * node's first {@link PoseBuffer.capture} then re-seeds *both* poses from the
   * transform again (see that method), so whatever the node did between being
   * tracked and the first capture is not mistaken for one step of motion.
   *
   * Tracking an already-tracked node is a no-op and keeps its stored poses —
   * re-tracking is not a way to reset them (decision, WP-2.6: `track` is called
   * from component attach paths that may run more than once, and silently
   * discarding a step of motion there would show up as a one-frame jump).
   * Untrack and track again to reset.
   */
  track(node: Node): this {
    if (this.#index.has(node)) {
      return this;
    }
    const { position, rotation } = node.transform;
    const entry: PoseEntry = {
      node,
      previousPosition: position.clone(),
      previousRotation: rotation.clone(),
      currentPosition: position.clone(),
      currentRotation: rotation.clone(),
      captured: false,
    };
    this.#entries.push(entry);
    this.#index.set(node, entry);
    return this;
  }

  /**
   * Stops interpolating `node` and drops its stored poses. Returns whether it
   * was tracked; untracking an untracked node is a no-op, so teardown paths may
   * call it unconditionally.
   */
  untrack(node: Node): boolean {
    const entry = this.#index.get(node);
    if (entry === undefined) {
      return false;
    }
    this.#index.delete(node);
    const index = this.#entries.indexOf(entry);
    if (index !== -1) {
      this.#entries.splice(index, 1);
    }
    return true;
  }

  /** Untracks every node. */
  clear(): void {
    this.#entries.length = 0;
    this.#index.clear();
  }

  /**
   * Shifts every tracked node's pose one step forward: `previous ← current`,
   * then `current ← node.transform`. Allocates nothing.
   *
   * Call it **once per fixed step, after every simulation system has run** —
   * §39 step 10, "state snapshot". {@link createSnapshotSystem} wraps it in a
   * `SimulationSystem` that does exactly that (plan D5). Calling it twice in
   * one step would throw the previous pose away and flatten the interpolation;
   * calling it from a render frame would do the same *and* couple render rate
   * to simulation state, which §42 forbids.
   *
   * On a node's **first** capture both poses are set to the transform's pose,
   * so the pair is `previous === current` and interpolation is constant for
   * that step. Anything else would interpolate from the pose the node happened
   * to have when it was tracked, which is not a simulation step and would
   * render as a jump.
   *
   * `root` restricts the capture to the tracked nodes in that subtree (`root`
   * itself included), depth-first in insertion order; tracked nodes outside it
   * keep the poses they had. Omit it to capture every tracked node, which is
   * the normal case — pass a root only when two subtrees are stepped by
   * different schedulers.
   */
  capture(root?: Node): void {
    if (root !== undefined) {
      root.traverse(this.#captureVisitor);
      return;
    }
    const entries = this.#entries;
    for (let i = 0; i < entries.length; i += 1) {
      captureEntry(entries[i]);
    }
  }

  /**
   * Writes `node`'s interpolated render pose at `alpha` into `outPosition` and
   * `outRotation` — §43's `lerp` for position, `slerp` for rotation — and
   * returns `true`. Allocates nothing.
   *
   * Returns `false` and leaves both outputs **untouched** when `node` is not
   * tracked, so a caller may interpolate optimistically and fall back to
   * `node.transform` on `false` without first clearing its scratch objects.
   *
   * `alpha` is the fraction of a fixed step already elapsed —
   * `TimeState.interpolationAlpha` (§10). It is clamped to `[0, 1]`:
   * extrapolating past the current pose would render a position the simulation
   * has not produced. A non-finite `alpha` clamps to 0 rather than throwing;
   * this runs per node per frame on the presentation path, where the previous
   * pose is always a safe answer and an exception is not (decision, WP-2.6).
   *
   * The outputs must be **scratch objects owned by the caller, never a
   * `Transform`'s `position`/`rotation`** — see this module's header. Passing a
   * transform's members would write a presentation value into simulation state
   * (§42, §43) and bump that transform's version every frame.
   */
  computeRenderPose(
    node: Node,
    alpha: number,
    outPosition: Vector3,
    outRotation: Quaternion,
  ): boolean {
    const entry = this.#index.get(node);
    if (entry === undefined) {
      return false;
    }
    // `!(alpha > 0)` also catches NaN, which Math.max/Math.min would propagate.
    const t = !(alpha > 0) ? 0 : alpha > 1 ? 1 : alpha;
    outPosition.copy(entry.previousPosition).lerp(entry.currentPosition, t);
    outRotation.copy(entry.previousRotation).slerp(entry.currentRotation, t);
    return true;
  }
}

/** Advances one entry by one fixed step. See {@link PoseBuffer.capture}. */
function captureEntry(entry: PoseEntry): void {
  const { position, rotation } = entry.node.transform;
  if (entry.captured) {
    entry.previousPosition.copy(entry.currentPosition);
    entry.previousRotation.copy(entry.currentRotation);
  } else {
    entry.previousPosition.copy(position);
    entry.previousRotation.copy(rotation);
    entry.captured = true;
  }
  entry.currentPosition.copy(position);
  entry.currentRotation.copy(rotation);
}

/** Options for {@link createSnapshotSystem}. */
export interface SnapshotSystemOptions {
  /**
   * Execution order key. Defaults to {@link POSE_SNAPSHOT_PRIORITY} — §39 step
   * 10, after the solve, the sensors, and the event dispatch, and before render
   * interpolation.
   */
  priority?: number;
  /**
   * Restricts the capture to this subtree, as `PoseBuffer.capture(root)` does.
   * Omit to capture every tracked node.
   */
  root?: Node;
}

/**
 * The §39 `SimulationSystem` shape, as `@fourjs/scene` can state it.
 *
 * This is structurally the interface `@fourjs/motion` publishes — an object of
 * this type is assignable to `SimulationSystem` and registers with
 * `SystemRegistry` unchanged — restated here because `@fourjs/scene` must not
 * depend on `@fourjs/motion` (plan §3.1: the edge runs motion → scene). The
 * context parameters are `unknown` for the same reason: this system needs
 * nothing from them, and a wider parameter type stays assignable to the
 * narrower one.
 */
export interface PoseSnapshotSystem {
  /** Execution order key; lower runs first. */
  priority: number;
  /** Called once when the system is registered. This system needs no setup. */
  initialize(context: unknown): void;
  /** Captures the fixed step's poses into the buffer. */
  fixedUpdate(context: unknown): void;
  /** Called once when the system is unregistered. Leaves the buffer intact. */
  dispose(): void;
}

/**
 * Builds the §39 step-10 system that calls {@link PoseBuffer.capture} once per
 * fixed step (plan D5: features register systems, nothing edits the scheduler).
 *
 * ```ts
 * const poses = new PoseBuffer();
 * registry.register(createSnapshotSystem(poses));
 * ```
 *
 * Registering it at the default {@link POSE_SNAPSHOT_PRIORITY} puts the capture
 * after every system that moves a node — kinematics, forces, the physics solve
 * — so the pose it records is the finished pose of that step, which is what
 * §43 interpolates towards.
 *
 * `dispose` does not clear the buffer: the buffer outlives the system (a
 * renderer may still be interpolating from it, and a re-registered system must
 * continue from the poses already stored). Clear it explicitly with
 * {@link PoseBuffer.clear}.
 *
 * The returned object carries **no disposed flag and refuses nothing after
 * `dispose`** (stability audit, 2026-09-11): it owns no state of its own —
 * the buffer is the resource, and `PoseBuffer.clear` is its lifetime call —
 * and `SystemRegistry` never calls an unregistered system again (rule 4 of
 * its mutation contract), so a §83 use-after-dispose cannot reach it and a
 * flag would guard nothing. `PoseBuffer` itself is deliberately not
 * disposable.
 */
export function createSnapshotSystem(
  buffer: PoseBuffer,
  options: SnapshotSystemOptions = {},
): PoseSnapshotSystem {
  const priority = options.priority ?? POSE_SNAPSHOT_PRIORITY;
  const root = options.root;
  return {
    priority,
    initialize(): void {
      // Nothing to set up: the buffer is supplied and owns its own state.
    },
    fixedUpdate(): void {
      buffer.capture(root);
    },
    dispose(): void {
      // Deliberately empty; see the factory's documentation.
    },
  };
}
