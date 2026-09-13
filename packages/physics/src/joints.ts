/**
 * The §28 joint classes — `FixedJoint`, `HingeJoint`, `SliderJoint`,
 * `RopeJoint`, `SpringJoint`, `SphericalJoint` — and the world-to-local
 * conversion they are registered through (plan P6-1, P6-2, P6-3).
 *
 * §28 declares joints as classes constructed from the objects they constrain:
 *
 * ```ts
 * const hinge = new HingeJoint({
 *   bodyA, bodyB,
 *   anchor: new Vector3(0, 2, 0),
 *   axis: new Vector3(0, 0, 1),
 *   limits: { min: -Math.PI / 2, max: Math.PI / 2 },
 *   motor: { enabled: true, targetVelocity: 2, maxTorque: 50 },
 * });
 * world.addJoint(hinge);
 * ```
 *
 * This module is that surface. It holds **authored state only** — no solver
 * handle beyond the id the world binds, no simulation, no per-frame callbacks —
 * exactly like `RigidBody`, and produces a `JointDescriptor` when a world
 * registers it.
 *
 * ## A joint is not a component (plan P6-3)
 *
 * §6a gives a node one component per type; a joint spans **two** bodies and
 * belongs to neither node. So joints are registered with the world instead —
 * `world.addJoint(joint)` / `world.removeJoint(joint)` — which is also where
 * their solver lifetime naturally sits. `bodyA` and `bodyB` are the `RigidBody`
 * components §28's sketch names, not handles: a user has components, and the
 * world already knows which solver body each one is.
 *
 * ## Anchor and axis space (decision, WP-6.1 — pinned)
 *
 * Everything a joint class is constructed with is in **world space**, because
 * that is where §28's example puts it: `anchor` is the point in the scene where
 * the hinge pin goes and `axis` is the direction it points, both read off the
 * assembled mechanism. The descriptor a solver receives is in **body-local**
 * space, because that is what §37's descriptor says and what every solver wants.
 * The conversion happens **once, at `world.addJoint`**, against each body's pose
 * as the solver holds it at that moment:
 *
 * ```text
 * anchorLocalA = conj(rotationA) · (anchorWorld − positionA)
 * axisLocalA   = normalize(conj(rotationA) · axisWorld)
 * ```
 *
 * Two consequences worth stating plainly. First, **pose the bodies where they
 * belong before adding the joint**: a joint created while the mechanism is
 * disassembled bakes in the wrong local frames, exactly as it would in any
 * solver. Second, the descriptor is pose-independent afterwards, which is what
 * lets it be serialized, replayed (§34), and compared across adapters.
 *
 * ## What may change after registration (decision, WP-6.1)
 *
 * | Property                          | After registration                              |
 * | --------------------------------- | ----------------------------------------------- |
 * | `limits` (hinge, slider)          | {@link HingeJoint.setLimits}, queued            |
 * | `motor` (hinge, slider)           | {@link HingeJoint.setMotor}, queued             |
 * | `collisionEnabled`                | plain setter, queued (PH-22f, 2026-08-08)       |
 * | `anchorA` / `anchorB`             | {@link Joint.setAnchors}, queued (PH-22f)       |
 * | `breakForce` / `breakTorque`      | free — the engine enforces them                 |
 * | axis, rope, spring, cone          | **frozen**; remove and re-add                   |
 *
 * Limits and motors are the two things §28's own example makes live ("limit
 * switches", a motor commanded to a new speed), and both are reconfigurable in
 * the solvers this repository ships, so they queue a command that the world
 * drains into `SolverJointAccess` at the next fixed step — the same
 * commands-not-mutations rule §26 imposes on forces, and for the same reason:
 * the solver may be mid-step and §6b forbids physics work during dispatch.
 * `collisionEnabled` joined them once the seam was checked property by property
 * rather than in bulk. **Anchors joined them once the which-pose decision
 * landed (PH-22f, 2026-09-06):** §28's public API after registration is
 * **body-local**. {@link Joint.setAnchors} (and the field setters) take the
 * same local frames `addJoint` stores after it converts the world-space
 * constructor options. They are *not* re-measured against the current world
 * poses, and they are *not* re-measured against the authoring poses — the
 * caller supplies local-space points. The world drains them into
 * `SolverJointAccess.setJointAnchors`, which Rapier implements as
 * `ImpulseJoint.setAnchor1` / `setAnchor2`.
 *
 * ## Why the rest stays frozen — measured, 2026-08-08 (PH-22f)
 *
 * The 2026-08-01 staging note said "no adapter here can re-anchor or re-axis a
 * live constraint" and asked for a revisit. The revisit happened, against the
 * installed Rapier typings and prototypes (re-checked at 0.20.0):
 *
 * | §28 property         | Rapier                                             | Verdict     |
 * | -------------------- | -------------------------------------------------- | ----------- |
 * | `collisionEnabled`   | `ImpulseJoint.setContactsEnabled` — every type, both 2D/3D | **live**    |
 * | anchors              | `ImpulseJoint.setAnchor1` / `setAnchor2` — every type | **live** (body-local) |
 * | axis                 | no setter on any `ImpulseJoint` subclass           | frozen      |
 * | rope `maxLength`     | `RopeImpulseJoint` declares no members at all      | frozen      |
 * | spring rest/stiffness/damping | `SpringImpulseJoint` declares no members at all | frozen      |
 * | spherical swing cone | `SphericalImpulseJoint` declares no members at all | frozen      |
 *
 * The frozen rows are frozen because changing them is not reconfiguration but a
 * different joint, and a setter that silently did nothing would be worse than
 * no setter. They are `readonly` **class fields**, so writing one is a compile
 * error rather than a runtime rejection — a failure at the earliest moment it
 * can be had. (Until PH-22f, `collisionEnabled` was the sole exception: a
 * mutable property with a runtime throw. Making it live retired both the throw
 * and the `#requireUnregistered` guard that existed only for it. Anchors
 * followed as writable fields plus {@link Joint.setAnchors}.)
 *
 * ## Breakage (plan P6-2)
 *
 * `breakForce` and `breakTorque` are enforced by `PhysicsWorld`, not by a
 * solver: the world reads the joint's reaction impulse after each fixed step,
 * divides by the delta, and destroys the joint when either magnitude *exceeds*
 * its threshold — emitting `"jointbreak"` **on the joint** after the step
 * (§6b, §39 step 9). {@link Joint.broken} stays `true` afterwards and the joint
 * cannot be registered again; build a new one.
 */

import { EventEmitter, FourError } from "@fourjs/core";
import { Quaternion, Vector3 } from "@fourjs/math";

import type { SolverJointMotor } from "./body-access.js";

import type {
  AngularJointMotor,
  FixedJointDescriptor,
  JointDescriptor,
  JointDescriptorBase,
  JointLimits,
  LinearJointMotor,
  PrismaticJointDescriptor,
  RevoluteJointDescriptor,
  RopeJointDescriptor,
  ShippedJointType,
  SphericalJointDescriptor,
  SphericalJointLimits,
  SpringJointDescriptor,
} from "./descriptors.js";
import { widenToVector3 } from "./descriptors.js";
import type { JointBreakEvent } from "./events.js";
import type { RigidBody } from "./rigid-body.js";
import type {
  PhysicsBodyHandle,
  PhysicsDimension,
  Vector3Input,
} from "./types.js";
import {
  validateAngularJointMotor,
  validateJointBreakThreshold,
  validateJointLimits,
  validateLinearJointMotor,
  validateSphericalJointLimits,
} from "./validation.js";

/** See the rest of the package: §89 has no physics-input code, so misuse is this. */
const JOINT_ERROR_CODE = "INVALID_APPLICATION_STATE";

/** §28's break payload as it reaches a joint's listeners. */
export type JointBreakPayload = JointBreakEvent<Joint>;

/**
 * What a {@link Joint} emits (§28, plan P6-2).
 *
 * One event: a joint breaks once. Emission is **package-internal** —
 * `PhysicsWorld` dispatches it after the fixed step, never during it (§6b, §39
 * step 9) — and user code subscribes.
 */
export interface JointEventMap {
  /** This joint exceeded a break threshold and was destroyed (§28). */
  jointbreak: JointBreakPayload;
}

/**
 * The body-local frames a joint is registered with — everything
 * {@link Joint.toDescriptor} needs that only a world can compute.
 *
 * Built by `PhysicsWorld.addJoint` from the joint's world-space anchors and
 * axis and the bodies' poses (see the module header). Handed straight to
 * `toDescriptor`, whose result the adapter consumes synchronously; the vectors
 * are references, not copies, exactly as `Collider.toDescriptor`'s are.
 */
export interface JointBinding {
  /** Solver handle of {@link Joint.bodyA}. */
  readonly bodyA: PhysicsBodyHandle;

  /** Solver handle of {@link Joint.bodyB}. */
  readonly bodyB: PhysicsBodyHandle;

  /** {@link Joint.anchorA} in `bodyA`'s local frame; the origin when unset. */
  readonly anchorA: Vector3;

  /** {@link Joint.anchorB} in `bodyB`'s local frame; the origin when unset. */
  readonly anchorB: Vector3;

  /**
   * The joint's axis in `bodyA`'s local frame, unit length — zero for a joint
   * type that has no axis, and zero for a hinge in a `"3d"` world that was
   * never given one, which validation then rejects.
   */
  readonly axis: Vector3;
}

/**
 * What a joint has been asked to reconfigure since the world last drained it
 * (§28; the §26 command pattern applied to constraints).
 *
 * A live read-only view of joint-owned storage. `PhysicsWorld` consumes it once
 * per fixed step, pushes the current {@link HingeJoint.limits},
 * {@link HingeJoint.motor}, {@link Joint.collisionEnabled}, and
 * {@link Joint.anchorA} / {@link Joint.anchorB} into `SolverJointAccess`, and
 * clears it — so a joint reconfigured three times between steps costs one
 * solver call, with the last value winning.
 */
export interface JointCommands {
  /** Whether the limits changed and have not reached the solver yet. */
  readonly limitsDirty: boolean;
  /** Whether the motor changed and has not reached the solver yet. */
  readonly motorDirty: boolean;
  /**
   * Whether `collisionEnabled` changed and has not reached the solver yet
   * (PH-22f, 2026-08-08).
   */
  readonly collisionDirty: boolean;
  /**
   * Whether the body-local anchors changed and have not reached the solver yet
   * (PH-22f, 2026-09-06).
   */
  readonly anchorsDirty: boolean;
}

/** The writable face of {@link JointCommands}; module-private by design. */
interface MutableJointCommands {
  limitsDirty: boolean;
  motorDirty: boolean;
  collisionDirty: boolean;
  anchorsDirty: boolean;
}

/**
 * The world-writable view of a joint's registration state — the same pattern
 * `RigidBody.sleeping` uses: `readonly` in the public contract, written by one
 * named function in this module.
 */
interface JointRegistrationBinding {
  broken: boolean;
  id: number | undefined;
}

/** How every {@link Joint} is constructed (§28). Anchors are in world space. */
export interface JointOptions {
  /** First constrained body (§28's `bodyA`). Must differ from `bodyB`. */
  bodyA: RigidBody;

  /** Second constrained body. */
  bodyB: RigidBody;

  /**
   * The attachment point in **world space** (§28's `anchor`), used for both
   * bodies. Omitted means each body's own origin; overridden per body by
   * {@link JointOptions.anchorA} / {@link JointOptions.anchorB}.
   */
  anchor?: Vector3Input;

  /** World-space attachment point on `bodyA`, overriding `anchor`. */
  anchorA?: Vector3Input;

  /** World-space attachment point on `bodyB`, overriding `anchor`. */
  anchorB?: Vector3Input;

  /**
   * Whether the two bodies still collide with each other (§28 "collision
   * enable/disable"). `false` by default.
   */
  collisionEnabled?: boolean;

  /** Break force in newtons (§28), or omitted for a joint that never breaks. */
  breakForce?: number;

  /** Break torque in newton-metres (§28). See {@link JointOptions.breakForce}. */
  breakTorque?: number;
}

/**
 * A constraint between two bodies (§28), registered with a world rather than
 * attached to a node (plan P6-3).
 *
 * Abstract: construct one of {@link FixedJoint}, {@link HingeJoint},
 * {@link SliderJoint}, {@link RopeJoint}, {@link SpringJoint}, or
 * {@link SphericalJoint}. See the module header for the anchor convention, what
 * may change after registration, and how breakage works.
 */
export abstract class Joint extends EventEmitter<JointEventMap> {
  /** Which §28 constraint this is — the descriptor's discriminant. */
  abstract readonly type: ShippedJointType;

  /** First constrained body (§28). */
  readonly bodyA: RigidBody;

  /** Second constrained body (§28). */
  readonly bodyB: RigidBody;

  /**
   * Attachment point on {@link Joint.bodyA}.
   *
   * **World space at construction**, because that is where §28's example puts
   * the pin. **Body-local after {@link Joint.setAnchors} or `world.addJoint`**
   * — registration converts the authored world point into `bodyA`'s local
   * frame once, and every later write is that same local frame (PH-22f).
   * `undefined` means the body's own origin.
   */
  #anchorA: Vector3 | undefined;

  /** Attachment point on {@link Joint.bodyB}. See `anchorA`. */
  #anchorB: Vector3 | undefined;

  /**
   * Whether {@link Joint.anchorA} / {@link Joint.anchorB} are already
   * body-local. `false` after construction (world-space options); `true` after
   * `addJoint` writes the converted frames back, or after {@link Joint.setAnchors}.
   */
  #anchorsAreLocal = false;

  /** Backing store for {@link Joint.collisionEnabled}. */
  #collisionEnabled: boolean;

  /** Backing store for {@link Joint.breakForce}. */
  #breakForce: number | undefined;

  /** Backing store for {@link Joint.breakTorque}. */
  #breakTorque: number | undefined;

  /** Set once when a §28 break threshold is exceeded; never cleared. */
  readonly broken: boolean = false;

  /** The world's monotonic id while registered, `undefined` otherwise. */
  readonly id: number | undefined = undefined;

  /** The §28 reconfiguration queue; see {@link JointCommands}. */
  readonly #commands: MutableJointCommands = {
    limitsDirty: false,
    motorDirty: false,
    collisionDirty: false,
    anchorsDirty: false,
  };

  /**
   * Validates and stores the parts of `options` every joint shares.
   *
   * Vectors are **copied**, so the caller keeps ownership of what it passes in.
   * The `"2d"` plane rules are *not* checked here — a joint does not know which
   * world it will join — and run at `world.addJoint`, which is the first moment
   * the dimension is known (the rule `RigidBody` follows).
   */
  protected constructor(options: JointOptions) {
    super();
    if (options.bodyA === options.bodyB) {
      throw new FourError(
        JOINT_ERROR_CODE,
        "A joint must connect two different bodies; bodyA and bodyB are the same RigidBody (§28).",
      );
    }
    this.bodyA = options.bodyA;
    this.bodyB = options.bodyB;
    this.#anchorA = copyAnchor("anchorA", options.anchorA ?? options.anchor);
    this.#anchorB = copyAnchor("anchorB", options.anchorB ?? options.anchor);
    this.#collisionEnabled = options.collisionEnabled ?? false;
    if (options.breakForce !== undefined) {
      validateJointBreakThreshold("breakForce", options.breakForce);
    }
    if (options.breakTorque !== undefined) {
      validateJointBreakThreshold("breakTorque", options.breakTorque);
    }
    this.#breakForce = options.breakForce;
    this.#breakTorque = options.breakTorque;
  }

  // --- shared state ---------------------------------------------------------

  /**
   * Attachment point on {@link Joint.bodyA}.
   *
   * World space until {@link Joint.setAnchors} or `world.addJoint` converts it
   * to `bodyA`'s local frame. After that, reads and writes are body-local
   * (PH-22f). `undefined` means the body's own origin.
   */
  get anchorA(): Vector3 | undefined {
    return this.#anchorA;
  }

  /**
   * Sets the attachment point on {@link Joint.bodyA} in **body-local** space
   * and queues it when the joint is registered. See {@link Joint.setAnchors}.
   */
  set anchorA(value: Vector3Input | undefined) {
    this.setAnchors(value, this.#anchorB);
  }

  /**
   * Attachment point on {@link Joint.bodyB}. See {@link Joint.anchorA}.
   */
  get anchorB(): Vector3 | undefined {
    return this.#anchorB;
  }

  /**
   * Sets the attachment point on {@link Joint.bodyB} in **body-local** space
   * and queues it when the joint is registered. See {@link Joint.setAnchors}.
   */
  set anchorB(value: Vector3Input | undefined) {
    this.setAnchors(this.#anchorA, value);
  }

  /**
   * Replaces both attachment points with **body-local** vectors and queues
   * them for the solver (§28, PH-22f).
   *
   * The frames are the same ones stored after `world.addJoint` converts the
   * world-space constructor options. They are not re-measured against the
   * current world poses and not re-measured against the authoring poses — the
   * caller supplies local-space points. `undefined` means that body's origin.
   *
   * Takes effect at the next fixed step, like {@link HingeJoint.setLimits}.
   * Writing the values already stored queues nothing. Unregistered, the write
   * is immediate and the next `addJoint` uses these locals as-is (it does not
   * convert them as world-space).
   */
  setAnchors(
    anchorA: Vector3Input | undefined,
    anchorB: Vector3Input | undefined,
  ): void {
    const nextA = copyAnchor("anchorA", anchorA);
    const nextB = copyAnchor("anchorB", anchorB);
    const unchanged =
      sameAnchor(this.#anchorA, nextA) && sameAnchor(this.#anchorB, nextB);
    this.#anchorA = nextA;
    this.#anchorB = nextB;
    this.#anchorsAreLocal = true;
    if (!unchanged && this.registered) {
      this.#commands.anchorsDirty = true;
    }
  }

  /**
   * Whether {@link Joint.anchorA} / {@link Joint.anchorB} are body-local
   * (PH-22f). `false` after construction (world-space options); `true` after
   * `addJoint` writes the converted frames back, or after {@link Joint.setAnchors}.
   */
  get anchorsAreLocal(): boolean {
    return this.#anchorsAreLocal;
  }

  /**
   * Whether the two bodies still collide with each other (§28).
   *
   * **Live since PH-22f (2026-08-08).** Setting it on a registered joint
   * queues the change, exactly as {@link HingeJoint.setLimits} does, and the
   * world drains it into `SolverJointAccess.setJointCollisionEnabled` at the
   * top of the next fixed step (§26's commands-not-mutations rule — the solver
   * may be mid-step, and §6b forbids physics work during dispatch). Writing
   * the value it already holds queues nothing.
   *
   * Anchors joined it as the other live §28 property every shipped solver can
   * change — see {@link Joint.setAnchors}. Axis, rope length, spring terms and
   * the spherical swing cone stay frozen; see the module header's table.
   */
  get collisionEnabled(): boolean {
    return this.#collisionEnabled;
  }

  set collisionEnabled(value: boolean) {
    if (value === this.#collisionEnabled) {
      return;
    }
    this.#collisionEnabled = value;
    if (this.registered) {
      this.#commands.collisionDirty = true;
    }
  }

  /**
   * Reaction force in newtons above which this joint breaks (§28), or
   * `undefined` for a joint that never breaks.
   *
   * Settable at any time, registered or not: the threshold is compared by the
   * world after each step and never reaches the solver, so there is nothing to
   * reconfigure. Setting one on a registered joint whose adapter cannot report
   * reactions is *not* rejected here — the check belongs where the adapter is
   * known, at `world.addJoint`.
   */
  get breakForce(): number | undefined {
    return this.#breakForce;
  }

  set breakForce(value: number | undefined) {
    if (value !== undefined) {
      validateJointBreakThreshold("breakForce", value);
    }
    this.#breakForce = value;
  }

  /** Reaction torque in N·m above which this joint breaks (§28). */
  get breakTorque(): number | undefined {
    return this.#breakTorque;
  }

  set breakTorque(value: number | undefined) {
    if (value !== undefined) {
      validateJointBreakThreshold("breakTorque", value);
    }
    this.#breakTorque = value;
  }

  /** Whether either §28 break threshold is set, so the world must monitor it. */
  get breakable(): boolean {
    return this.#breakForce !== undefined || this.#breakTorque !== undefined;
  }

  /** Whether a world currently holds this joint (its {@link Joint.id} is set). */
  get registered(): boolean {
    return this.id !== undefined;
  }

  /** What this joint has been asked to reconfigure (§28). See {@link JointCommands}. */
  get commands(): JointCommands {
    return this.#commands;
  }

  // --- registration ---------------------------------------------------------

  /**
   * Writes this joint's world-space axis into `out`, or zeroes it when the type
   * has none (§28).
   *
   * `dimension` is passed because the default differs: a hinge in a `"2d"`
   * world has exactly one possible axis (+Z, §21) and needs no author to say
   * so, while a hinge in a `"3d"` world must name one — an unnamed 3D hinge
   * leaves the axis zero, which `validateJointDescriptor` then rejects with the
   * message that explains it.
   */
  worldAxis(dimension: PhysicsDimension, out: Vector3): Vector3 {
    return out.set(0, 0, 0);
  }

  /**
   * The descriptor an adapter is handed for this joint (§37 `createJoint`),
   * with the body-local frames `binding` carries.
   *
   * The record is fresh; its vectors are `binding`'s, which the adapter reads
   * during `createJoint` and must not retain (the contract
   * `RigidBody.toDescriptor` already sets).
   */
  abstract toDescriptor(binding: JointBinding): JointDescriptor;

  /** The fields every descriptor shares, for {@link Joint.toDescriptor}. */
  protected describeBase(binding: JointBinding): JointDescriptorBase {
    this.#requireLive();
    const base: JointDescriptorBase = {
      bodyA: binding.bodyA,
      bodyB: binding.bodyB,
      anchorA: binding.anchorA,
      anchorB: binding.anchorB,
      collisionEnabled: this.#collisionEnabled,
    };
    if (this.#breakForce !== undefined) {
      base.breakForce = this.#breakForce;
    }
    if (this.#breakTorque !== undefined) {
      base.breakTorque = this.#breakTorque;
    }
    return base;
  }

  /** Marks the reconfiguration queue; used by the limit and motor setters. */
  protected queueLimits(): void {
    this.#commands.limitsDirty = true;
  }

  /** Marks the reconfiguration queue; used by the motor setters. */
  protected queueMotor(): void {
    this.#commands.motorDirty = true;
  }

  /** Set by {@link Joint.dispose}; disposal is terminal (§83). */
  #disposed = false;

  /**
   * Whether {@link Joint.dispose} has run. Disposal is terminal (§83): a
   * disposed joint refuses world registration with `INVALID_APPLICATION_STATE`
   * (§89) rather than silently working.
   */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** §83's "disposed resource still in use", made loud (§89). */
  #requireLive(): void {
    if (this.#disposed) {
      throw new FourError(
        JOINT_ERROR_CODE,
        `This ${this.type} joint is disposed; registering a disposed joint ` +
          "is a lifetime mistake (§83), and a new joint is a new Joint.",
        { context: { type: this.type } },
      );
    }
  }

  // --- §83 lifecycle --------------------------------------------------------

  /**
   * Drops every listener (§83). Removing the joint from its world is the
   * world's business, exactly as it is for `RigidBody`.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.removeAllListeners();
  }
}

/**
 * A weld (§28 "fixed"): the two bodies keep the relative pose they had when the
 * joint was registered. Both dimensions.
 *
 * ```ts
 * world.addJoint(new FixedJoint({ bodyA: chassis, bodyB: bracket }));
 * ```
 */
export class FixedJoint extends Joint {
  readonly type = "fixed" as const;

  /** Builds a weld between two bodies. See {@link JointOptions}. */
  constructor(options: JointOptions) {
    super(options);
  }

  toDescriptor(binding: JointBinding): FixedJointDescriptor {
    return { ...this.describeBase(binding), type: "fixed" };
  }
}

/** How a {@link HingeJoint} is constructed (§28's example, field for field). */
export interface HingeJointOptions extends JointOptions {
  /**
   * Hinge axis in **world space**. Required in a `"3d"` world; a `"2d"` world
   * defaults it to +Z, its only rotational freedom (§21).
   */
  axis?: Vector3Input;

  /** Angular travel in radians (§28 "limits"), or free rotation when omitted. */
  limits?: JointLimits;

  /** Velocity motor about the axis (§28 "motors"), or none when omitted. */
  motor?: AngularJointMotor;
}

/**
 * A hinge (§28 "revolute/hinge"): one rotational degree of freedom about
 * {@link HingeJoint.axis}. Both dimensions.
 *
 * ```ts
 * const hinge = new HingeJoint({
 *   bodyA: wall, bodyB: door,
 *   anchor: new Vector3(0, 1, 0),
 *   axis: new Vector3(0, 1, 0),
 *   limits: { min: 0, max: Math.PI / 2 },
 *   motor: { enabled: true, targetVelocity: 1, maxTorque: 20 },
 * });
 * ```
 *
 * §28 names this type twice; {@link RevoluteJoint} is the same class under its
 * other name.
 */
export class HingeJoint extends Joint {
  readonly type = "revolute" as const;

  /** World-space hinge axis at construction, or `undefined` for the default. */
  readonly axis: Vector3 | undefined;

  #limits: JointLimits | undefined;

  #motor: AngularJointMotor | undefined;

  /** Builds a hinge. See {@link HingeJointOptions} and {@link JointOptions}. */
  constructor(options: HingeJointOptions) {
    super(options);
    this.axis = copyAnchor("axis", options.axis);
    if (options.limits !== undefined) {
      validateJointLimits("limits", options.limits);
      this.#limits = { min: options.limits.min, max: options.limits.max };
    }
    if (options.motor !== undefined) {
      validateAngularJointMotor("motor", options.motor);
      this.#motor = copyAngularMotor(options.motor);
    }
  }

  /**
   * The angular travel in radians, or `undefined` when the hinge spins freely
   * (§28). A copy — call {@link HingeJoint.setLimits} to change it.
   */
  get limits(): JointLimits | undefined {
    return this.#limits === undefined ? undefined : { ...this.#limits };
  }

  /**
   * The motor, or `undefined` when the hinge is undriven (§28). A copy — call
   * {@link HingeJoint.setMotor} to change it.
   */
  get motor(): AngularJointMotor | undefined {
    return this.#motor === undefined
      ? undefined
      : copyAngularMotor(this.#motor);
  }

  /**
   * Sets the angular travel in radians and queues it for the solver (§28).
   *
   * Takes effect at the next fixed step, like every other command in this
   * engine. Limits can be *changed* but not removed once the joint is
   * registered: no adapter here can drop a live limit, and a "clearLimits" that
   * silently did nothing would be worse than its absence.
   */
  setLimits(min: number, max: number): void {
    const limits = { min, max };
    validateJointLimits("limits", limits);
    if (this.#limits === undefined && this.registered) {
      throw new FourError(
        JOINT_ERROR_CODE,
        "revolute joint: limits cannot be added to an already-registered joint, only changed (§28; staged 2026-08-01, WP-6.1). Construct the joint with limits, or remove and re-add it.",
        { context: { type: this.type, id: this.id } },
      );
    }
    this.#limits = limits;
    this.queueLimits();
  }

  /**
   * Sets the velocity motor and queues it for the solver (§28's `motor`).
   *
   * `setMotor({ enabled: false, … })` — or {@link HingeJoint.enableMotor} —
   * stops the drive without removing it, which is what "limit switches" and a
   * stopped shaft need. Like limits, a motor cannot be *added* to a registered
   * joint, only reconfigured.
   */
  setMotor(motor: AngularJointMotor): void {
    validateAngularJointMotor("motor", motor);
    if (this.#motor === undefined && this.registered) {
      throw new FourError(
        JOINT_ERROR_CODE,
        "revolute joint: a motor cannot be added to an already-registered joint, only reconfigured (§28; staged 2026-08-01, WP-6.1). Construct the joint with a motor, or remove and re-add it.",
        { context: { type: this.type, id: this.id } },
      );
    }
    this.#motor = copyAngularMotor(motor);
    this.queueMotor();
  }

  /** Turns the motor on or off, keeping its target and effort (§28). */
  enableMotor(enabled: boolean): void {
    const motor = this.#motor;
    if (motor === undefined) {
      throw new FourError(
        JOINT_ERROR_CODE,
        "revolute joint: enableMotor needs a motor to enable; construct the joint with a motor record (§28).",
        { context: { type: this.type, id: this.id } },
      );
    }
    motor.enabled = enabled;
    this.queueMotor();
  }

  /** +Z in a `"2d"` world (§21); the authored axis otherwise, or zero. */
  override worldAxis(dimension: PhysicsDimension, out: Vector3): Vector3 {
    if (this.axis !== undefined) {
      return out.copy(this.axis);
    }
    return dimension === "2d" ? out.set(0, 0, 1) : out.set(0, 0, 0);
  }

  toDescriptor(binding: JointBinding): RevoluteJointDescriptor {
    const descriptor: RevoluteJointDescriptor = {
      ...this.describeBase(binding),
      type: "revolute",
      axis: binding.axis,
    };
    if (this.#limits !== undefined) {
      descriptor.limits = { ...this.#limits };
    }
    if (this.#motor !== undefined) {
      descriptor.motor = copyAngularMotor(this.#motor);
    }
    return descriptor;
  }
}

/** §28 names the hinge twice; this is {@link HingeJoint} under its other name. */
export const RevoluteJoint = HingeJoint;

/** §28's other name for {@link HingeJoint}, as a type. */
export type RevoluteJoint = HingeJoint;

/** How a {@link SliderJoint} is constructed (§28). */
export interface SliderJointOptions extends JointOptions {
  /**
   * Slide axis in **world space**. Required in both dimensions — a slider with
   * no direction has nothing to slide along — and must lie in the XY plane in a
   * `"2d"` world (§21).
   */
  axis: Vector3Input;

  /** Travel in metres (§28 "limits"), or unlimited when omitted. */
  limits?: JointLimits;

  /** Velocity motor along the axis (§28 "motors"), or none when omitted. */
  motor?: LinearJointMotor;
}

/**
 * A slider (§28 "prismatic/slider"): one translational degree of freedom along
 * {@link SliderJoint.axis}. Both dimensions.
 *
 * The linear twin of {@link HingeJoint} in every respect — limits are metres,
 * the motor's effort is a force. {@link PrismaticJoint} is the same class under
 * §28's other name.
 */
export class SliderJoint extends Joint {
  readonly type = "prismatic" as const;

  /** World-space slide axis at construction. */
  readonly axis: Vector3;

  #limits: JointLimits | undefined;

  #motor: LinearJointMotor | undefined;

  /** Builds a slider. See {@link SliderJointOptions} and {@link JointOptions}. */
  constructor(options: SliderJointOptions) {
    super(options);
    const axis = copyAnchor("axis", options.axis);
    if (axis === undefined) {
      throw new FourError(
        JOINT_ERROR_CODE,
        "prismatic joint: axis is required — a slider with no direction has nothing to slide along (§28).",
        { context: { type: "prismatic" } },
      );
    }
    this.axis = axis;
    if (options.limits !== undefined) {
      validateJointLimits("limits", options.limits);
      this.#limits = { min: options.limits.min, max: options.limits.max };
    }
    if (options.motor !== undefined) {
      validateLinearJointMotor("motor", options.motor);
      this.#motor = copyLinearMotor(options.motor);
    }
  }

  /** The travel in metres, or `undefined` when unlimited (§28). A copy. */
  get limits(): JointLimits | undefined {
    return this.#limits === undefined ? undefined : { ...this.#limits };
  }

  /** The motor, or `undefined` when the slider is undriven (§28). A copy. */
  get motor(): LinearJointMotor | undefined {
    return this.#motor === undefined ? undefined : copyLinearMotor(this.#motor);
  }

  /** Sets the travel in metres and queues it (§28). See {@link HingeJoint.setLimits}. */
  setLimits(min: number, max: number): void {
    const limits = { min, max };
    validateJointLimits("limits", limits);
    if (this.#limits === undefined && this.registered) {
      throw new FourError(
        JOINT_ERROR_CODE,
        "prismatic joint: limits cannot be added to an already-registered joint, only changed (§28; staged 2026-08-01, WP-6.1). Construct the joint with limits, or remove and re-add it.",
        { context: { type: this.type, id: this.id } },
      );
    }
    this.#limits = limits;
    this.queueLimits();
  }

  /** Sets the velocity motor and queues it (§28). See {@link HingeJoint.setMotor}. */
  setMotor(motor: LinearJointMotor): void {
    validateLinearJointMotor("motor", motor);
    if (this.#motor === undefined && this.registered) {
      throw new FourError(
        JOINT_ERROR_CODE,
        "prismatic joint: a motor cannot be added to an already-registered joint, only reconfigured (§28; staged 2026-08-01, WP-6.1). Construct the joint with a motor, or remove and re-add it.",
        { context: { type: this.type, id: this.id } },
      );
    }
    this.#motor = copyLinearMotor(motor);
    this.queueMotor();
  }

  /** Turns the motor on or off, keeping its target and effort (§28). */
  enableMotor(enabled: boolean): void {
    const motor = this.#motor;
    if (motor === undefined) {
      throw new FourError(
        JOINT_ERROR_CODE,
        "prismatic joint: enableMotor needs a motor to enable; construct the joint with a motor record (§28).",
        { context: { type: this.type, id: this.id } },
      );
    }
    motor.enabled = enabled;
    this.queueMotor();
  }

  override worldAxis(dimension: PhysicsDimension, out: Vector3): Vector3 {
    return out.copy(this.axis);
  }

  toDescriptor(binding: JointBinding): PrismaticJointDescriptor {
    const descriptor: PrismaticJointDescriptor = {
      ...this.describeBase(binding),
      type: "prismatic",
      axis: binding.axis,
    };
    if (this.#limits !== undefined) {
      descriptor.limits = { ...this.#limits };
    }
    if (this.#motor !== undefined) {
      descriptor.motor = copyLinearMotor(this.#motor);
    }
    return descriptor;
  }
}

/** §28 names the slider twice; this is {@link SliderJoint} under its other name. */
export const PrismaticJoint = SliderJoint;

/** §28's other name for {@link SliderJoint}, as a type. */
export type PrismaticJoint = SliderJoint;

/** How a {@link RopeJoint} is constructed (§28). */
export interface RopeJointOptions extends JointOptions {
  /** Greatest distance between the anchors, in metres. Must be > 0. */
  maxLength: number;
}

/**
 * A rope (§28): the anchors may come no further apart than
 * {@link RopeJoint.maxLength}, and are otherwise unconstrained. Both
 * dimensions.
 *
 * A rope pulls and never pushes, which is what distinguishes it from the staged
 * `distance` joint — see `ShippedJointType` for why that one does not ship.
 */
export class RopeJoint extends Joint {
  readonly type = "rope" as const;

  /** Greatest distance between the anchors, in metres. Frozen after construction. */
  readonly maxLength: number;

  /** Builds a rope. See {@link RopeJointOptions} and {@link JointOptions}. */
  constructor(options: RopeJointOptions) {
    super(options);
    requirePositive("rope", "maxLength", options.maxLength);
    this.maxLength = options.maxLength;
  }

  toDescriptor(binding: JointBinding): RopeJointDescriptor {
    return {
      ...this.describeBase(binding),
      type: "rope",
      maxLength: this.maxLength,
    };
  }
}

/** How a {@link SpringJoint} is constructed (§28 "spring", "damping"). */
export interface SpringJointOptions extends JointOptions {
  /** Distance at which the spring is at rest, in metres. Must be >= 0. */
  restLength: number;

  /** Spring constant in newtons per metre. Must be > 0. */
  stiffness: number;

  /** Damping in newton-seconds per metre. Must be >= 0; `0` by default. */
  damping?: number;
}

/**
 * A spring-damper between the anchors (§28). Both dimensions.
 *
 * Constrains nothing rigidly — it applies a restoring force — so it has neither
 * limits nor a motor, and its parameters are frozen after construction (a
 * solver cannot re-tune a live spring here; remove and re-add).
 */
export class SpringJoint extends Joint {
  readonly type = "spring" as const;

  /** Distance at which the spring exerts no force, in metres. */
  readonly restLength: number;

  /** Spring constant in newtons per metre. */
  readonly stiffness: number;

  /** Damping coefficient in newton-seconds per metre. */
  readonly damping: number;

  /** Builds a spring. See {@link SpringJointOptions} and {@link JointOptions}. */
  constructor(options: SpringJointOptions) {
    super(options);
    requireNonNegative("spring", "restLength", options.restLength);
    requirePositive("spring", "stiffness", options.stiffness);
    if (options.damping !== undefined) {
      requireNonNegative("spring", "damping", options.damping);
    }
    this.restLength = options.restLength;
    this.stiffness = options.stiffness;
    this.damping = options.damping ?? 0;
  }

  toDescriptor(binding: JointBinding): SpringJointDescriptor {
    return {
      ...this.describeBase(binding),
      type: "spring",
      restLength: this.restLength,
      stiffness: this.stiffness,
      damping: this.damping,
    };
  }
}

/** How a {@link SphericalJoint} is constructed (§28). `"3d"` only (plan P6-1). */
export interface SphericalJointOptions extends JointOptions {
  /**
   * Reference axis of the swing cone in **world space**, only meaningful with
   * {@link SphericalJointOptions.limits}. Defaults to +Y, §7a's up.
   */
  axis?: Vector3Input;

  /** Swing cone and optional twist (§28 "limits"), or free rotation when omitted. */
  limits?: SphericalJointLimits;
}

/**
 * A ball joint (§28 "spherical/ball"): three rotational degrees of freedom
 * about a shared point. **`"3d"` only** — a `"2d"` world rejects it at
 * registration, because in a plane it degenerates into the hinge that should
 * have been asked for (plan P6-1).
 *
 * {@link BallJoint} is the same class under §28's other name.
 */
export class SphericalJoint extends Joint {
  readonly type = "spherical" as const;

  /** World-space cone reference axis at construction, or `undefined` for +Y. */
  readonly axis: Vector3 | undefined;

  /** The swing cone and twist, or `undefined` when the joint rotates freely. */
  readonly limits: SphericalJointLimits | undefined;

  /** Builds a ball joint. See {@link SphericalJointOptions}. */
  constructor(options: SphericalJointOptions) {
    super(options);
    this.axis = copyAnchor("axis", options.axis);
    if (options.limits !== undefined) {
      validateSphericalJointLimits("limits", options.limits);
      this.limits = copySphericalLimits(options.limits);
    }
  }

  override worldAxis(dimension: PhysicsDimension, out: Vector3): Vector3 {
    return this.axis === undefined ? out.set(0, 1, 0) : out.copy(this.axis);
  }

  toDescriptor(binding: JointBinding): SphericalJointDescriptor {
    const descriptor: SphericalJointDescriptor = {
      ...this.describeBase(binding),
      type: "spherical",
      axis: binding.axis,
    };
    if (this.limits !== undefined) {
      descriptor.limits = copySphericalLimits(this.limits);
    }
    return descriptor;
  }
}

/** §28 names the ball joint twice; this is {@link SphericalJoint}'s other name. */
export const BallJoint = SphericalJoint;

/** §28's other name for {@link SphericalJoint}, as a type. */
export type BallJoint = SphericalJoint;

/**
 * Converts a **world-space** anchor into a body's local frame (§28; the
 * conversion `PhysicsWorld.addJoint` performs — see the module header).
 *
 * `position` and `rotation` are the body's world pose as the solver holds it.
 * Writes into `out` when given and returns it (§7b, plan D7); `scratch` is the
 * quaternion the inverse rotation is built in, so a caller on a per-frame path
 * can supply its own and allocate nothing.
 */
export function worldAnchorToLocal(
  position: Vector3,
  rotation: Quaternion,
  worldAnchor: Vector3Input,
  out?: Vector3,
  scratch?: Quaternion,
): Vector3 {
  const target = widenToVector3(worldAnchor, out ?? new Vector3());
  target.set(
    target.x - position.x,
    target.y - position.y,
    target.z - position.z,
  );
  const inverse = (scratch ?? new Quaternion()).copy(rotation).conjugate();
  return inverse.rotateVector3(target, target);
}

/**
 * Converts a **world-space** direction into a body's local frame and
 * normalizes it (§28). A zero direction stays zero, which is how an unnamed 3D
 * hinge axis reaches validation as the error it is.
 *
 * Writes into `out` when given (§7b, plan D7).
 */
export function worldAxisToLocal(
  rotation: Quaternion,
  worldAxis: Vector3Input,
  out?: Vector3,
  scratch?: Quaternion,
): Vector3 {
  const target = widenToVector3(worldAxis, out ?? new Vector3());
  const inverse = (scratch ?? new Quaternion()).copy(rotation).conjugate();
  inverse.rotateVector3(target, target);
  return target.normalize();
}

/**
 * Binds `joint` to the monotonic id a world registered it under.
 *
 * **Package-internal** — the same arrangement `setRigidBodySleeping` uses, and
 * outside the barrel for the same reason: nothing but a `PhysicsWorld` may
 * claim a joint. Clears the reconfiguration queue, because the descriptor the
 * solver was just built from already carries the current limits and motor.
 */
export function bindJoint(joint: Joint, id: number): void {
  (joint as unknown as JointRegistrationBinding).id = id;
  clearJointCommands(joint);
}

/** Releases `joint` from its world (`removeJoint`, `dispose`). Package-internal. */
export function unbindJoint(joint: Joint): void {
  (joint as unknown as JointRegistrationBinding).id = undefined;
}

/** Marks `joint` permanently broken (§28, plan P6-2). Package-internal. */
export function setJointBroken(joint: Joint): void {
  (joint as unknown as JointRegistrationBinding).broken = true;
}

/**
 * Empties `joint`'s reconfiguration queue after the world has pushed it into
 * the solver. Package-internal, like `clearRigidBodyCommands`.
 */
export function clearJointCommands(joint: Joint): void {
  const commands = joint.commands as MutableJointCommands;
  commands.limitsDirty = false;
  commands.motorDirty = false;
  commands.collisionDirty = false;
  commands.anchorsDirty = false;
}

/**
 * Copies `joint`'s stored anchors into `outA` / `outB`, using the origin when
 * a side was omitted. Package-internal — the values the world pushes into
 * `SolverJointAccess.setJointAnchors`.
 */
export function readJointAnchors(
  joint: Joint,
  outA: Vector3,
  outB: Vector3,
): void {
  if (joint.anchorA !== undefined) {
    outA.copy(joint.anchorA);
  } else {
    outA.set(0, 0, 0);
  }
  if (joint.anchorB !== undefined) {
    outB.copy(joint.anchorB);
  } else {
    outB.set(0, 0, 0);
  }
}

/**
 * The limits a world pushes into `SolverJointAccess.setJointLimits`, or
 * `undefined` for a joint type that has none. Package-internal.
 */
export function readJointLimits(joint: Joint): JointLimits | undefined {
  if (joint instanceof HingeJoint || joint instanceof SliderJoint) {
    return joint.limits;
  }
  return undefined;
}

/**
 * The motor a world pushes into `SolverJointAccess.setJointMotor`, reduced to
 * the seam's unit-agnostic form: a hinge's `maxTorque` and a slider's
 * `maxForce` are both `maxEffort`, because the joint type already says which
 * one it is. Package-internal.
 */
export function readJointMotor(joint: Joint): SolverJointMotor | undefined {
  if (joint instanceof HingeJoint) {
    const motor = joint.motor;
    return motor === undefined
      ? undefined
      : {
          enabled: motor.enabled !== false,
          targetVelocity: motor.targetVelocity,
          maxEffort: motor.maxTorque,
        };
  }
  if (joint instanceof SliderJoint) {
    const motor = joint.motor;
    return motor === undefined
      ? undefined
      : {
          enabled: motor.enabled !== false,
          targetVelocity: motor.targetVelocity,
          maxEffort: motor.maxForce,
        };
  }
  return undefined;
}

/** True when both sides name the same point, treating omitted as the origin. */
function sameAnchor(
  left: Vector3 | undefined,
  right: Vector3 | undefined,
): boolean {
  const lx = left?.x ?? 0;
  const ly = left?.y ?? 0;
  const lz = left?.z ?? 0;
  const rx = right?.x ?? 0;
  const ry = right?.y ?? 0;
  const rz = right?.z ?? 0;
  return lx === rx && ly === ry && lz === rz;
}

/** Copies an optional world-space vector argument, rejecting a non-finite one. */
function copyAnchor(
  field: string,
  value: Vector3Input | undefined,
): Vector3 | undefined {
  if (value === undefined) {
    return undefined;
  }
  const copy = widenToVector3(value);
  if (
    !Number.isFinite(copy.x) ||
    !Number.isFinite(copy.y) ||
    !Number.isFinite(copy.z)
  ) {
    throw new FourError(
      JOINT_ERROR_CODE,
      `${field} must be finite; got (${String(copy.x)}, ${String(copy.y)}, ${String(copy.z)}) (§28, §85).`,
      { context: { field } },
    );
  }
  return copy;
}

/** A private copy of a motor record, so a caller's object cannot drift into it. */
function copyAngularMotor(motor: AngularJointMotor): AngularJointMotor {
  return {
    enabled: motor.enabled ?? true,
    targetVelocity: motor.targetVelocity,
    maxTorque: motor.maxTorque,
  };
}

/** {@link copyAngularMotor}'s linear twin. */
function copyLinearMotor(motor: LinearJointMotor): LinearJointMotor {
  return {
    enabled: motor.enabled ?? true,
    targetVelocity: motor.targetVelocity,
    maxForce: motor.maxForce,
  };
}

/** A private copy of a cone/twist limit record. */
function copySphericalLimits(
  limits: SphericalJointLimits,
): SphericalJointLimits {
  const copy: SphericalJointLimits = { coneAngle: limits.coneAngle };
  if (limits.twist !== undefined) {
    copy.twist = { min: limits.twist.min, max: limits.twist.max };
  }
  return copy;
}

/** §85: a joint parameter that must be a finite positive number. */
function requirePositive(type: string, field: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new FourError(
      JOINT_ERROR_CODE,
      `${type} joint: ${field} must be a finite positive number; got ${String(value)} (§28, §85).`,
      { context: { type, field, value } },
    );
  }
}

/** §85: a joint parameter that may be zero but never negative or non-finite. */
function requireNonNegative(type: string, field: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new FourError(
      JOINT_ERROR_CODE,
      `${type} joint: ${field} must be a finite number >= 0; got ${String(value)} (§28, §85).`,
      { context: { type, field, value } },
    );
  }
}
