/**
 * `MotionComponent` (§11) and the system that advances it (§39 step 4).
 *
 * §11 defines the component verbatim as
 *
 * ```ts
 * interface MotionComponent {
 *   linearVelocity: Vector3;
 *   angularVelocity: Vector3;
 *   linearAcceleration: Vector3;
 *   angularAcceleration: Vector3;
 *   damping: number;
 *   angularDamping: number;
 *   maxSpeed?: number;
 *   maxAngularSpeed?: number;
 * }
 * ```
 *
 * It is "non-physics procedural motion and a bridge to physics solvers": state
 * only, no behaviour. The behaviour is {@link MotionSystem}, registered with the
 * §39 {@link SystemRegistry} at the kinematic-motion slot (plan D5 — features
 * register systems, nothing edits the scheduler).
 *
 * ## The update (pinned by WP-2.2, semi-implicit Euler per §38)
 *
 * Per fixed step, per tracked node, linear and angular parts alike:
 *
 * ```text
 * v += a · dt                  // acceleration
 * v *= 1 / (1 + damping · dt)  // damping
 * clamp |v| to maxSpeed        // speed limit
 * x += v · dt                  // integrate with the *new* velocity
 * ```
 *
 * This is {@link semiImplicitEuler} with damping and the speed clamp inserted
 * between the velocity and position half-updates, which is why the system does
 * not call the integrator: neither operation is expressible through the
 * `acceleration` callback (damping written as a force would be integrated
 * explicitly and could overshoot past zero for `damping · dt > 1`, and a clamp
 * is not a force at all). The closed form of the damping factor after `n` steps
 * is `1 / (1 + damping · dt)ⁿ`, which `tests/motion-component.test.ts` asserts.
 *
 * `damping` and `angularDamping` are per-second rate coefficients and must be
 * `>= 0`; `maxSpeed` and `maxAngularSpeed`, when set, must be `>= 0`. Neither is
 * validated on this per-step path — a negative damping of exactly `-1 / dt`
 * divides by zero, and a negative speed limit reverses the velocity.
 *
 * ## Angular velocity (decision, WP-2.2)
 *
 * `angularVelocity` is an axis-angle rate vector in **radians per second**
 * (§7a): its direction is the rotation axis and its magnitude the rate about
 * that axis, right-handed. Per step the system builds the delta rotation
 * `q = axisAngle(ω̂, |ω| · dt)` and **premultiplies**:
 *
 * ```text
 * rotation = q · rotation
 * ```
 *
 * Premultiplication means ω is expressed in the node's **parent** frame (the
 * frame its local transform is written in), not in its own body frame — the
 * same convention as a physics solver's world-space angular velocity, which
 * matters because §11 calls this component "a bridge to physics solvers". When
 * `|ω| = 0` the rotation is left untouched (no `setFromAxisAngle` call, no
 * version bump). The product is renormalized on scratch storage before being
 * written back, so thousands of steps cannot drift off the unit sphere.
 *
 * Nothing here is a small-angle approximation: one step of `ω = (0, π/2, 0)` at
 * 60 Hz is an exact rotation of `π/120` about +Y, and 60 of them compose to
 * exactly `π/2` because rotations about a fixed axis commute.
 *
 * ## Which nodes the system advances (decision, WP-2.2)
 *
 * Explicit registration: {@link MotionSystem.track} adds a node, and the system
 * looks its `MotionComponent` up each step. The alternative — traversing a
 * scene subtree every fixed step and testing every node for the component — was
 * rejected: it makes the cost of motion proportional to total scene size rather
 * than to the number of moving objects, and it forces the motion system to know
 * about a root node it otherwise has no reason to hold. Consequences:
 *
 * - The set is a `Set<Node>` iterated in **insertion order**, so the update
 *   order is deterministic and reproducible (§33, ground rule 5).
 * - Attaching or removing the component via `node.addComponent` /
 *   `node.removeComponent` takes effect immediately without re-tracking,
 *   because the lookup happens per step; a tracked node with no component is
 *   skipped. That is what makes "add/remove via `Node`" work.
 * - A node with `enabled === false` is skipped (§6: `enabled` is "whether this
 *   node participates in simulation").
 * - Tracking is not automatic on `addComponent`: a component cannot see which
 *   system, if any, should own it. Track the node when you add the component.
 * - Mutating the tracked set *during* a fixed step follows `Set` iteration
 *   semantics — an untracked node is skipped, a newly tracked node runs in the
 *   same step. (Snapshotting the set to defer both, as the §39 registry does
 *   for systems, would allocate every step.) Track and untrack outside the step
 *   if that distinction matters.
 *
 * ## Transform writes
 *
 * Position and rotation are written through the math *methods* `set` and
 * `copy`, so plan D3's change hooks fire and `Transform.version` advances
 * exactly once each per moved node per step. Nothing is written when a node is
 * skipped, and a node with zero velocity still bumps its version (the write is
 * unconditional — testing for a zero delta would cost more than the write).
 *
 * ## Transform authority (§42, WP-2.3)
 *
 * The system writes as the `"kinematic"` authority, so it advances a tracked
 * node only while `node.transformAuthority === "kinematic"`. A tracked node
 * owned by anything else is **skipped** and reported once through
 * `warnAuthorityConflict` (§42: exactly one system owns a transform; conflicts
 * warn and the owner keeps the transform — see `@fourjs/scene`'s `authority.ts`
 * for why the refusal, not just the warning, is the enforcement).
 *
 * A skipped node's `MotionComponent` is not integrated either — not its
 * velocity, not its damping (decision, WP-2.3). The alternative, integrating
 * velocity while refusing only the position/rotation write, would let a refused
 * body silently accumulate speed under gravity and then teleport the instant
 * authority was granted; keeping the whole component frozen makes the refusal
 * visible and reversible. Nodes default to `"manual"` (§42), so a node must be
 * declared `node.transformAuthority = "kinematic"` before this system will move
 * it.
 */

import { FourError, type Component, type ComponentHost } from "@fourjs/core";
import { Quaternion, Vector3 } from "@fourjs/math";
import { warnAuthorityConflict, type Node } from "@fourjs/scene";

import {
  PRIORITY_KINEMATICS,
  type FixedUpdateContext,
  type SimulationSystem,
} from "./systems.js";

/**
 * Initial values for a {@link MotionComponent}. Vectors are **copied**, so the
 * caller keeps ownership of whatever it passes in.
 */
export interface MotionComponentOptions {
  /** Initial linear velocity in units per second. Default `(0, 0, 0)`. */
  linearVelocity?: Vector3;
  /** Initial angular velocity in radians per second. Default `(0, 0, 0)`. */
  angularVelocity?: Vector3;
  /** Constant linear acceleration in units per second squared. Default `(0, 0, 0)`. */
  linearAcceleration?: Vector3;
  /** Constant angular acceleration in radians per second squared. Default `(0, 0, 0)`. */
  angularAcceleration?: Vector3;
  /** Linear damping rate per second, `>= 0`. Default `0`. */
  damping?: number;
  /** Angular damping rate per second, `>= 0`. Default `0`. */
  angularDamping?: number;
  /** Optional linear speed limit in units per second, `>= 0`. */
  maxSpeed?: number;
  /** Optional angular speed limit in radians per second, `>= 0`. */
  maxAngularSpeed?: number;
}

/**
 * Procedural motion state attached to a node (§11), advanced by
 * {@link MotionSystem}.
 *
 * A component per plan D2: a class with a `static readonly typeName`, one per
 * node, attached with `node.addComponent(new MotionComponent(...))` exactly as
 * §11's example does. It holds no reference to the node — `host` is assigned by
 * the registry — and no behaviour, so a component that is never tracked simply
 * never moves anything.
 *
 * The four vectors are owned by the component and are never replaced by it;
 * write *into* them (`motion.linearVelocity.set(...)`) or assign a new vector if
 * you prefer — the system re-reads the fields every step either way.
 */
export class MotionComponent implements Component {
  /** Component key (plan D2) and §79 serialization name. */
  static readonly typeName = "motion";

  /**
   * The node this component is attached to, or `null`. Written by the
   * `ComponentRegistry` alone (§6a); never assign it.
   */
  host: ComponentHost | null = null;

  /** Linear velocity in units per second. */
  linearVelocity: Vector3;

  /** Angular velocity as an axis-angle rate vector in radians per second. */
  angularVelocity: Vector3;

  /** Constant linear acceleration in units per second squared. */
  linearAcceleration: Vector3;

  /** Constant angular acceleration in radians per second squared. */
  angularAcceleration: Vector3;

  /** Linear damping rate per second, `>= 0`. `0` disables damping. */
  damping: number;

  /** Angular damping rate per second, `>= 0`. `0` disables damping. */
  angularDamping: number;

  /** Optional linear speed limit in units per second, `>= 0`. */
  maxSpeed?: number;

  /** Optional angular speed limit in radians per second, `>= 0`. */
  maxAngularSpeed?: number;

  constructor(options: MotionComponentOptions = {}) {
    this.linearVelocity = options.linearVelocity?.clone() ?? new Vector3();
    this.angularVelocity = options.angularVelocity?.clone() ?? new Vector3();
    this.linearAcceleration =
      options.linearAcceleration?.clone() ?? new Vector3();
    this.angularAcceleration =
      options.angularAcceleration?.clone() ?? new Vector3();
    this.damping = options.damping ?? 0;
    this.angularDamping = options.angularDamping ?? 0;
    if (options.maxSpeed !== undefined) {
      this.maxSpeed = options.maxSpeed;
    }
    if (options.maxAngularSpeed !== undefined) {
      this.maxAngularSpeed = options.maxAngularSpeed;
    }
  }

  /** Zeroes both velocities and both accelerations. Limits and damping are kept. */
  reset(): this {
    this.linearVelocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.linearAcceleration.set(0, 0, 0);
    this.angularAcceleration.set(0, 0, 0);
    return this;
  }
}

/**
 * The §42 authority {@link MotionSystem} writes under. Module-private: a system
 * declares which authority it *is*, and nothing outside this file needs to
 * configure that.
 */
const MOTION_SYSTEM_AUTHORITY = "kinematic";

/** Options for {@link MotionSystem}. */
export interface MotionSystemOptions {
  /**
   * Execution order key (§39). Default {@link PRIORITY_KINEMATICS} — step 4,
   * "kinematic motion". Read once, at registration.
   */
  priority?: number;
}

/**
 * Advances every tracked node's {@link MotionComponent} once per fixed step
 * (§39 step 4).
 *
 * ```ts
 * const system = new MotionSystem();
 * registry.register(system);
 * node.addComponent(new MotionComponent({ linearVelocity: new Vector3(2, 0, 0) }));
 * node.transformAuthority = "kinematic"; // §42 — required, see below
 * system.track(node);
 * ```
 *
 * See the module documentation for the update rule, the angular-velocity
 * convention, the §42 authority check, and why tracking is explicit. Stepping
 * allocates nothing: the two quaternion temporaries are owned by the system and
 * overwritten in place.
 */
export class MotionSystem implements SimulationSystem {
  /** Execution order key (§39); default {@link PRIORITY_KINEMATICS}. */
  priority: number;

  /** Tracked nodes in insertion order (§33: deterministic iteration). */
  readonly #tracked = new Set<Node>();

  /** Delta rotation for the current node's angular step. */

  /** Set by {@link MotionSystem.dispose}; disposal is terminal (§83). */
  #disposed = false;

  /**
   * Whether {@link MotionSystem.dispose} has run. Disposal is terminal (§83): a
   * disposed system refuses its mutating entry points with
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
        "MotionSystem is disposed; advancing nodes through a disposed system is a " +
          "lifetime mistake (§83), and a new system is a new " +
          "MotionSystem.",
        { context: { system: "MotionSystem" } },
      );
    }
  }

  readonly #deltaRotation = new Quaternion();

  /** `delta · rotation` before it is written back. */
  readonly #composedRotation = new Quaternion();

  constructor(options: MotionSystemOptions = {}) {
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
   * The node need not have a {@link MotionComponent} yet; it is looked up every
   * step, so tracking first and attaching later is fine.
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

  /** Advances every tracked node by `time.fixedDeltaTime` seconds. */
  fixedUpdate(context: FixedUpdateContext): void {
    this.#requireLive();
    const dt = context.time.fixedDeltaTime;
    for (const node of this.#tracked) {
      if (!node.enabled) {
        continue;
      }
      const motion = node.getComponent(MotionComponent);
      if (motion === undefined) {
        continue;
      }
      // §42: this system writes as `kinematic`; anything else owns the
      // transform, so the write is refused rather than silently applied. The
      // component-lookup test comes first on purpose — a tracked node with no
      // `MotionComponent` is not a writer at all and must not warn.
      if (node.transformAuthority !== MOTION_SYSTEM_AUTHORITY) {
        warnAuthorityConflict(node, MOTION_SYSTEM_AUTHORITY);
        continue;
      }
      this.#advance(node, motion, dt);
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

  /** One node, one step. See the module documentation for the rule. */
  #advance(node: Node, motion: MotionComponent, dt: number): void {
    const { transform } = node;

    // --- linear: v += a·dt, damp, clamp, then x += v·dt ---------------------
    const linearVelocity = motion.linearVelocity;
    const linearAcceleration = motion.linearAcceleration;
    const linearFactor = 1 / (1 + motion.damping * dt);
    let vx = (linearVelocity.x + linearAcceleration.x * dt) * linearFactor;
    let vy = (linearVelocity.y + linearAcceleration.y * dt) * linearFactor;
    let vz = (linearVelocity.z + linearAcceleration.z * dt) * linearFactor;

    const maxSpeed = motion.maxSpeed;
    if (maxSpeed !== undefined) {
      const speedSquared = vx * vx + vy * vy + vz * vz;
      if (speedSquared > maxSpeed * maxSpeed) {
        const scale = maxSpeed / Math.sqrt(speedSquared);
        vx *= scale;
        vy *= scale;
        vz *= scale;
      }
    }
    linearVelocity.set(vx, vy, vz);

    const position = transform.position;
    position.set(
      position.x + vx * dt,
      position.y + vy * dt,
      position.z + vz * dt,
    );

    // --- angular: identical shape, applied as an axis-angle premultiply -----
    const angularVelocity = motion.angularVelocity;
    const angularAcceleration = motion.angularAcceleration;
    const angularFactor = 1 / (1 + motion.angularDamping * dt);
    let wx = (angularVelocity.x + angularAcceleration.x * dt) * angularFactor;
    let wy = (angularVelocity.y + angularAcceleration.y * dt) * angularFactor;
    let wz = (angularVelocity.z + angularAcceleration.z * dt) * angularFactor;

    const maxAngularSpeed = motion.maxAngularSpeed;
    let angularSpeedSquared = wx * wx + wy * wy + wz * wz;
    if (
      maxAngularSpeed !== undefined &&
      angularSpeedSquared > maxAngularSpeed * maxAngularSpeed
    ) {
      const scale = maxAngularSpeed / Math.sqrt(angularSpeedSquared);
      wx *= scale;
      wy *= scale;
      wz *= scale;
      angularSpeedSquared = maxAngularSpeed * maxAngularSpeed;
    }
    angularVelocity.set(wx, wy, wz);

    if (angularSpeedSquared > 0) {
      const angle = Math.sqrt(angularSpeedSquared) * dt;
      // `setFromAxisAngle` normalizes the axis itself, so ω is passed as-is.
      this.#deltaRotation.setFromAxisAngle(angularVelocity, angle);
      this.#composedRotation
        .copy(this.#deltaRotation)
        .multiply(transform.rotation)
        .normalize();
      transform.rotation.copy(this.#composedRotation);
    }
  }
}
