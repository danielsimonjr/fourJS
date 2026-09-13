/**
 * §12's look-at constraint and the §39 step-7 system that runs it, together
 * with the §44 rigs (R-36 rig half + PH-11, 2026-08-13).
 *
 * §12 lists "look-at constraints" among the kinematic features and §42 names
 * `"constraint"` as one of the seven transform authorities. Until this module
 * nothing in the engine ever wrote under that authority: it was a legal value
 * with no producer, so a node declared `"constraint"` was a node nothing drove.
 * {@link ConstraintSystem} is that producer — the first one — and
 * {@link LookAtConstraint} is the aim it runs.
 *
 * ```ts
 * const camera = new PerspectiveCamera({ aspect });
 * camera.addComponent(new OrbitRig({ target: player, distance: 6 }));
 * camera.addComponent(new LookAtConstraint({ target: player }));
 * camera.transformAuthority = "constraint";      // §42 — required
 *
 * const constraints = new ConstraintSystem();
 * registry.register(constraints);
 * constraints.track(camera);
 * ```
 *
 * ## One system, one authority (§42)
 *
 * Placement (`OrbitRig`, `FollowRig`), aim (`LookAtConstraint`) and shake
 * (`CameraShake`) are four components but **one** system, because §42 allows
 * exactly one owner per node and these four all write the same node's
 * transform. Splitting them across two systems would mean two writers claiming
 * `"constraint"` over one node, which §42's check cannot catch — it compares
 * the *authority*, not the system instance. Within the step the order is
 * fixed and meaningful:
 *
 * 1. place — `OrbitRig`, then `FollowRig`;
 * 2. aim — `LookAtConstraint`;
 * 3. shake — `CameraShake` (additive, so it layers on the pose 1–2 wrote).
 *
 * so the aim reads the pose written this step rather than last step's, and an
 * orbiting, aimed camera is exact on the first step rather than one frame
 * behind. Shake runs last so a look-at is not asked to cancel the kick.
 * (Attaching both placement rigs to one node is legal and the follow rig
 * wins, being second; they are alternatives, not layers.)
 *
 * §39's step 7 — `PRIORITY_CONSTRAINTS`, 700 — is where the registry runs it:
 * after the solve (600), so a rig following a rigid body sees the pose the
 * solver just wrote, and before the snapshot (1000), so §43's interpolation
 * carries the constrained pose rather than the pre-constraint one.
 *
 * ## Degenerate aims are counted, not thrown and not warned (decision)
 *
 * `Node.lookAt` **throws** on a degenerate aim (§85): a target that coincides
 * with the node, or an `up` parallel to it. That is right for authoring — the
 * mistake is in the call — and wrong inside a fixed step, where the same
 * configuration is reached for one frame by a camera whose target flew through
 * it. So {@link LookAtConstraint} makes `lookAt`'s two tests **itself, before
 * calling it**, and on failure leaves the rotation untouched and bumps a public
 * {@link LookAtConstraint.skippedSteps}.
 *
 * A counter rather than a warning, because a per-step `console.warn` is sixty
 * lines a second, and rather than silence, because a camera that quietly
 * stopped aiming is otherwise indistinguishable from one whose target stopped
 * moving. Refused-authority steps are deliberately *not* counted there: a rig
 * that is being refused by §42 has `skippedSteps === 0` and one warning, a rig
 * that is aiming at itself has no warning and a rising counter, and the two
 * states are worth telling apart.
 *
 * ## Determinism (§33)
 *
 * Tracked nodes are held in a `Set` and iterated in **insertion order**; the
 * per-step path reads its `deltaSeconds` from the injected `TimeState`, calls no
 * clock, allocates nothing, and reaches `Math.acos`/`Math.sin`/`Math.sqrt` —
 * same-runtime tier, like the rest of the engine's floating point.
 */

import { FourError, type Component, type ComponentHost } from "@fourjs/core";
import { Quaternion, Vector3 } from "@fourjs/math";
import {
  resolveWorldTransform,
  warnAuthorityConflict,
  type Node,
} from "@fourjs/scene";

import { FollowRig, OrbitRig } from "./camera-rigs.js";
import { CameraShake } from "./camera-shake.js";
import { resolveTargetPosition, type RigTarget } from "./rig-target.js";
import {
  PRIORITY_CONSTRAINTS,
  type FixedUpdateContext,
  type SimulationSystem,
} from "./systems.js";

/** The §42 authority {@link ConstraintSystem} writes under. Module-private. */
const CONSTRAINT_SYSTEM_AUTHORITY = "constraint";

/** Options for {@link LookAtConstraint} (§12). */
export interface LookAtConstraintOptions {
  /** What the node aims at. Defaults to nothing, which makes the constraint idle. */
  target?: RigTarget;
  /** Reference up direction; **copied**. Default world `+Y` (§7a). */
  up?: Vector3;
  /**
   * Largest turn rate, in radians per second (§7a) — `MotionComponent`'s
   * spelling. Absent means unlimited: the node snaps onto the aim every step.
   */
  maxAngularSpeed?: number;
}

/**
 * §12's look-at constraint: a component that turns its node's `−Z` axis towards
 * a target every fixed step, optionally rate-limited.
 *
 * The aim itself is `Node.lookAt` — the same primitive an application calls, so
 * a constrained camera and a hand-aimed one agree exactly (R-36). What this
 * component adds is the three things a *per-step* aim needs and a one-off call
 * does not: a target that may be a moving node, a survivable answer to the
 * degenerate configurations `lookAt` refuses, and a slew limit.
 *
 * ## The slew limit
 *
 * With `maxAngularSpeed` set, the node turns towards the aim at no more than
 * that many radians per second, along the **shortest arc** (`Quaternion.slerp`'s
 * rule), and never overshoots: a rig that is `θ` radians off arrives in
 * `θ / maxAngularSpeed` seconds and stops there, because the goal is recomputed
 * from the target every step rather than integrated.
 *
 * It is implemented by writing the rotation **twice** on a limited step — once
 * by `lookAt`, which lands on the goal, then once by slerping back from the
 * rotation captured before the call. That is deliberate. The alternative is a
 * second copy of `lookAt`'s world-rotation-to-local-rotation division, which is
 * the one piece of that method with a real subtlety in it (the parent's world
 * rotation, recovered by decomposition), and two copies of it would be two
 * things to keep in agreement. Two writes cost one extra `Transform.version`
 * bump on a step that was already recomputing a world matrix.
 */
export class LookAtConstraint implements Component {
  /** Component key (plan D2) and §79 serialization name. */
  static readonly typeName = "look-at-constraint";

  /**
   * The node this component is attached to, or `null`. Written by the
   * `ComponentRegistry` alone (§6a); never assign it.
   */
  host: ComponentHost | null = null;

  /**
   * What the node aims at, or `null` for an idle constraint — one that writes
   * nothing, and therefore raises no §42 conflict on a node it does not own.
   */
  target: RigTarget | null;

  /**
   * Reference up direction, in world space. The rig's own copy, written in
   * place; a `(0, 0, 0)` or non-finite value is not refused here but makes every
   * step a skipped one, exactly as an aim parallel to it does.
   */
  readonly up = new Vector3(0, 1, 0);

  /** Largest turn rate in rad/s, or `undefined` for an unlimited snap. */
  readonly maxAngularSpeed: number | undefined;

  /**
   * Steps on which the aim was degenerate and the rotation was left untouched.
   *
   * Not incremented by a §42 refusal — see the module note on why the two states
   * are kept apart — and not by an idle constraint.
   */
  skippedSteps = 0;

  /** World-space target position, recomputed every step (D7). */
  readonly #aim = new Vector3();

  /** Rotation captured before `lookAt`, for the slew blend. */
  readonly #previous = new Quaternion();

  /** The unlimited aim `lookAt` wrote, held while the blend overwrites it. */
  readonly #goal = new Quaternion();

  /**
   * @throws RangeError if `up` is zero or not finite, or if `maxAngularSpeed`
   * is not a finite number `> 0` (§85). A limit of exactly zero is refused
   * rather than accepted as "never turn": a constraint that can never reach its
   * aim is a mistake, and it is indistinguishable at runtime from a frozen rig.
   */
  constructor(options: LookAtConstraintOptions = {}) {
    const up = options.up;
    if (up !== undefined) {
      if (!(up.x * up.x + up.y * up.y + up.z * up.z > 0)) {
        throw new RangeError(
          "LookAtConstraintOptions.up must be a non-zero, finite direction (§85)",
        );
      }
      this.up.copy(up);
    }
    const maxAngularSpeed = options.maxAngularSpeed;
    if (maxAngularSpeed !== undefined) {
      if (!Number.isFinite(maxAngularSpeed) || maxAngularSpeed <= 0) {
        throw new RangeError(
          `LookAtConstraintOptions.maxAngularSpeed must be a finite number of rad/s > 0 (§85); received ${String(maxAngularSpeed)}`,
        );
      }
    }
    this.maxAngularSpeed = maxAngularSpeed;
    this.target = options.target ?? null;
  }

  /**
   * Aims `node` at the target. Called by {@link ConstraintSystem} once per fixed
   * step, after the §42 authority check and after the placement components.
   *
   * @param node the node being aimed
   * @param deltaSeconds the fixed step, in seconds (§7a)
   * @returns `true` when the rotation was written. `false` — and a bumped
   * {@link LookAtConstraint.skippedSteps} — when the target's world position is
   * not finite, coincides with the node's own, or leaves the roll undetermined;
   * an idle constraint returns `false` without counting a skip.
   */
  apply(node: Node, deltaSeconds: number): boolean {
    const target = this.target;
    if (target === null) {
      return false;
    }
    const aim = this.#aim;
    if (!resolveTargetPosition(target, aim)) {
      this.skippedSteps += 1;
      return false;
    }

    // `Node.lookAt`'s own two §85 tests, made here so that it cannot throw
    // inside a fixed step. Same values, same order, same world position — the
    // translation column of the resolved world matrix.
    const world = resolveWorldTransform(node).elements;
    const aimX = aim.x - world[12];
    const aimY = aim.y - world[13];
    const aimZ = aim.z - world[14];
    if (!(aimX * aimX + aimY * aimY + aimZ * aimZ > 0)) {
      this.skippedSteps += 1;
      return false;
    }
    const up = this.up;
    const crossX = up.y * aimZ - up.z * aimY;
    const crossY = up.z * aimX - up.x * aimZ;
    const crossZ = up.x * aimY - up.y * aimX;
    if (!(crossX * crossX + crossY * crossY + crossZ * crossZ > 0)) {
      this.skippedSteps += 1;
      return false;
    }

    const limit = this.maxAngularSpeed;
    if (limit === undefined) {
      node.lookAt(aim, up);
      return true;
    }

    const rotation = node.transform.rotation;
    const previous = this.#previous.copy(rotation);
    node.lookAt(aim, up);
    // Shortest-arc angle between two unit quaternions: 2·acos|q₁·q₂|. The
    // absolute value picks the near representative (a quaternion and its
    // negation are the same rotation), and `Math.min(1, …)` is a branchless
    // domain guard — a dot product of 1 + 1 ULP would make `acos` return NaN.
    const dot =
      previous.x * rotation.x +
      previous.y * rotation.y +
      previous.z * rotation.z +
      previous.w * rotation.w;
    const angle = 2 * Math.acos(Math.min(1, Math.abs(dot)));
    const step = limit * deltaSeconds;
    if (angle > step) {
      const goal = this.#goal.copy(rotation);
      rotation.copy(previous).slerp(goal, step / angle);
    }
    return true;
  }
}

/** Options for {@link ConstraintSystem}. */
export interface ConstraintSystemOptions {
  /**
   * Execution order key (§39). Default {@link PRIORITY_CONSTRAINTS} — step 7,
   * "constraint solve". Read once, at registration.
   */
  priority?: number;
}

/**
 * Runs every tracked node's rigs and constraints once per fixed step, as §42's
 * `"constraint"` authority (§39 step 7).
 *
 * Tracking mirrors `KinematicSystem`'s mechanism exactly, for the reasons
 * documented there: components are looked up every step (so attaching,
 * detaching or replacing one needs no re-tracking), the tracked set is iterated
 * in **insertion order** (§33), a node with `enabled === false` is skipped, and
 * mutating the set during a step follows `Set` iteration semantics. Stepping
 * allocates nothing (plan D7).
 *
 * Per tracked node, in order:
 *
 * 1. skip a disabled node;
 * 2. skip a node whose rigs and constraint are all absent or untargeted — an
 *    idle node writes nothing, so there is no §42 conflict to report;
 *    `CameraShake` has no target and is never idle while attached;
 * 3. refuse a node owned by another authority, reporting it once through
 *    `warnAuthorityConflict` — the owner keeps the transform, and the rigs are
 *    left frozen rather than stepped, so granting authority later resumes from
 *    where the rig stopped;
 * 4. place: `OrbitRig`, then `FollowRig`;
 * 5. aim: `LookAtConstraint`;
 * 6. shake: `CameraShake` — additive, after placement and aim.
 */
export class ConstraintSystem implements SimulationSystem {
  /** Execution order key (§39); default {@link PRIORITY_CONSTRAINTS}. */
  priority: number;

  /** Tracked nodes in insertion order (§33: deterministic iteration). */
  readonly #tracked = new Set<Node>();

  /** Set by {@link ConstraintSystem.dispose}; disposal is terminal (§83). */
  #disposed = false;

  /**
   * Whether {@link ConstraintSystem.dispose} has run. Disposal is terminal
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
        "ConstraintSystem is disposed; constraining nodes through a disposed system is a " +
          "lifetime mistake (§83), and a new system is a new " +
          "ConstraintSystem.",
        { context: { system: "ConstraintSystem" } },
      );
    }
  }

  constructor(options: ConstraintSystemOptions = {}) {
    this.priority = options.priority ?? PRIORITY_CONSTRAINTS;
  }

  /** Number of tracked nodes. */
  get size(): number {
    return this.#tracked.size;
  }

  /** Tracked nodes, in the order they will be processed. */
  get nodes(): IterableIterator<Node> {
    return this.#tracked.values();
  }

  /**
   * Starts constraining `node`. Idempotent — tracking a node twice keeps its
   * original position in the iteration order. Returns `node`.
   *
   * The node need not carry a rig or a constraint yet; they are looked up every
   * step, so tracking first and attaching later is fine.
   */
  track(node: Node): Node {
    this.#requireLive();
    this.#tracked.add(node);
    return node;
  }

  /** Stops constraining `node`. Returns whether it was tracked. */
  untrack(node: Node): boolean {
    return this.#tracked.delete(node);
  }

  /** Whether `node` is tracked. */
  has(node: Node): boolean {
    return this.#tracked.has(node);
  }

  /** Stops constraining every node. The system stays registered. */
  clear(): void {
    this.#tracked.clear();
  }

  /** No per-registration setup is needed (§39). */
  initialize(): void {
    // Intentionally empty: the system owns no resources until nodes are tracked.
  }

  /** Places and aims every tracked node, using `time.fixedDeltaTime`. */
  fixedUpdate(context: FixedUpdateContext): void {
    this.#requireLive();
    const dt = context.time.fixedDeltaTime;
    for (const node of this.#tracked) {
      if (!node.enabled) {
        continue;
      }
      const orbit = node.getComponent(OrbitRig);
      const follow = node.getComponent(FollowRig);
      const aim = node.getComponent(LookAtConstraint);
      const shake = node.getComponent(CameraShake);
      if (
        shake === undefined &&
        (orbit === undefined || orbit.target === null) &&
        (follow === undefined || follow.target === null) &&
        (aim === undefined || aim.target === null)
      ) {
        // Idle: nothing would be written, so there is no §42 conflict to
        // report. `KinematicSystem`'s rule, for the same reason.
        // `CameraShake` has no target — attaching it is enough to write.
        continue;
      }
      // §42: this system writes as `constraint`; anything else owns the
      // transform, so every write is refused and the rigs are left frozen.
      if (node.transformAuthority !== CONSTRAINT_SYSTEM_AUTHORITY) {
        warnAuthorityConflict(node, CONSTRAINT_SYSTEM_AUTHORITY);
        continue;
      }
      orbit?.apply(node);
      follow?.apply(node, dt);
      aim?.apply(node, dt);
      // Additive: the kick is layered on the pose the placement / aim just
      // wrote. Sampled at `simulationTime` so the noise is a function of the
      // physics clock, not of the step rate (§33).
      shake?.apply(node, dt, context.time.simulationTime);
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
