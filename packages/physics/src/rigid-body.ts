/**
 * The `RigidBody` component (§6a, §23) and its §26 force/impulse command
 * buffers.
 *
 * §23 declares the body as a class with mass and state properties, `wake()` /
 * `sleep()`, and the six §26 force and impulse methods; §6a makes it a
 * *component* attached with `node.addComponent(new RigidBody(...))` rather than
 * a `Node` subclass. This module is that class. It holds **authored state
 * only** — no solver handle, no simulation, no per-frame callbacks (§6a: "per
 * frame work is driven by systems"). `PhysicsWorld` and `PhysicsSystem`
 * (WP-5.3) read this state, create the solver body from
 * {@link RigidBody.toDescriptor}, consume the command buffers once per fixed
 * step, and write the solved pose back under `"physics"` transform authority
 * (§42).
 *
 * ## Pose lives on the node, not here
 *
 * §23's property list has no position or rotation: a node's `Transform` (§7) is
 * its pose, and exactly one system owns it (§42). The component therefore keeps
 * only the *initial* pose a descriptor happened to carry
 * ({@link RigidBody.initialPosition}, {@link RigidBody.initialRotation}), so a
 * descriptor round-trips through the component unchanged.
 *
 * ## Authored state versus solved state — read this before writing a field
 *
 * The component's state reaches the solver **at registration**: `addBody` calls
 * {@link RigidBody.toDescriptor} once and the adapter builds its body from that
 * record. What happens to a write *after* that depends on the property and on
 * whether the world's adapter implements `SolverBodyTuningAccess` — the §37
 * seam for post-registration property changes, widened 2026-08-07 (PH-1
 * stage 2). Precisely (this header claimed the opposite until 2026-08-06, when
 * the "nothing is pushed" column below was written; the "live" column is
 * stage 2 making that column false on purpose):
 *
 * | State | Adapter with `SolverBodyTuningAccess` | Adapter without |
 * | --- | --- | --- |
 * | {@link RigidBody.mass} (to a number) | **live** — queued on assignment, pushed as §23's whole triple at the top of the next fixed step | component only; warns once |
 * | {@link RigidBody.centerOfMass}, {@link RigidBody.inertiaTensor} | **live** on a body whose mass is **authored**, and only via {@link RigidBody.markMassPropertiesChanged} or a `mass` write — both are edited in place, so no setter can see them, and §23 has no distribution to set without a mass | component only; warns once when marked |
 * | {@link RigidBody.linearDamping}, {@link RigidBody.angularDamping} | **live** (one call for the pair) | component only; warns once |
 * | {@link RigidBody.gravityScale} | **live** | component only; warns once |
 * | {@link RigidBody.ccdMode}, {@link RigidBody.continuousCollisionDetection} | **live**, carrying {@link RigidBody.ccdPredictionDistance} | component only; warns once |
 * | `mass = undefined` (un-authoring) | **nothing** — see below; warns once | nothing; warns once |
 * | {@link RigidBody.linearVelocity} / {@link RigidBody.angularVelocity} | **solver → component** in the publish pass, for every body type. Fed *into* the solver only for a `"kinematic-velocity"` body (§22), which is the one type whose authored velocity is an input. A write on a dynamic body is therefore overwritten by the next step. | unchanged |
 * | {@link RigidBody.type} | component only; warns once. `PhysicsWorld.setBodyControlMode` moves both (§22, plan P7-3). | same |
 * | {@link RigidBody.sleeping} | solver → component (§32). | same |
 * | §26 forces and impulses, `wake()` / `sleep()` | component → solver, once per fixed step, through the command buffers below — the supported way to influence a running body. | same |
 *
 * The **live** rows set a bit in {@link RigidBody.pendingSolverWrites} and cost
 * nothing further; `PhysicsWorld.step` drains the bit set before it applies
 * forces, so the new property is in force for the step that follows the write.
 * A body nobody wrote to makes no extra solver call, which is why turning this
 * on moved no §33 golden.
 *
 * The **warns once** rows keep stage 1's machinery unchanged: the warning fires
 * only when the body is a registered dynamic one **and** the assignment really
 * changes the value (a self-assignment desynchronizes nothing, and the warning
 * is one-shot per body per field — spending it on a no-op would silence the
 * write that follows). It names the two routes that always work: re-register
 * the body (`removeBody` → `addBody`, which rebuilds the descriptor), or reach
 * the solver directly through `PhysicsWorld.getBodyHandle(node)`. A body
 * registered with two worlds warns unless *both* adapters can carry the write
 * (see {@link RigidBody.liveSolverWriteWorldCount}).
 *
 * The §23 mass triple has two more rules. First: a body that never named a
 * mass, a centre of mass, or an inertia tensor is asking the solver to derive
 * all three from collider density and geometry (§23, §25), so
 * {@link RigidBody.toDescriptor} omits what was never authored rather than
 * presenting a default as an instruction. See
 * {@link RigidBody.centerOfMassAuthored} and {@link RigidBody.massAuthored}.
 * Second, and the reason `mass = undefined` has its own row: going *back* to a
 * derived mass means restoring every collider's own density, which only the
 * registration path holds — no seam widening changes that, so it is stated as
 * permanently unreachable rather than staged.
 *
 * ## Commands, not mutations (§26, §32)
 *
 * A force applied by user code cannot reach the solver at the moment of the
 * call — the solver may be mid-step, and §6b forbids physics work during
 * dispatch. Every §26 method therefore **accumulates into a command buffer**
 * that the world drains at the next fixed step, and `wake()` / `sleep()` queue
 * a flag rather than editing {@link RigidBody.sleeping}. See
 * {@link RigidBodyCommands} for the exact clearing semantics.
 *
 * ## Blend weights (§19)
 *
 * {@link RigidBody.physicsWeight} and {@link RigidBody.animationWeight} are
 * §19's two sliders, verbatim from its sketch. They are **engine state, not
 * solver state**: no solver is told about them, {@link RigidBody.toDescriptor}
 * does not carry them, and they change nothing until a node declares
 * `"blended"` transform authority (§42) and the §19 blend system (WP-7.3) reads
 * them. See {@link RigidBody.normalizedWeights}.
 *
 * ## Events (§29, §32)
 *
 * `RigidBody` *is* an `EventEmitter` (§6b), so §29's `body.on("collisionstart",
 * …)` is literal. The emit side is **package-internal**: `PhysicsSystem`
 * normalizes the adapter's `drainEvents` output and emits after the fixed step
 * (§39 step 9). User code subscribes; nothing outside `@fourjs/physics` should
 * call `emit` for these types.
 *
 * ## Dimension (§21, plan P5-3)
 *
 * A component does not know which world it will join, so construction-time
 * validation runs against `"3d"`, the permissive dimension: it adds no rules of
 * its own, so construction performs exactly the dimension-independent checks.
 * The `"2d"` plane constraints are checked by {@link RigidBody.validateFor}
 * when the body is registered with a world, which is the first moment the
 * dimension is known. `Vector2` arguments widen to `z = 0` everywhere (P5-3).
 */

import {
  DEFAULT_SPACE_MODE,
  DEV_WARNING_PREFIX,
  EventEmitter,
  FourError,
  type Component,
  type ComponentHost,
  type SpaceMode,
} from "@fourjs/core";
import { Matrix3, Quaternion, Vector3 } from "@fourjs/math";

import type { RigidBodyDescriptor } from "./descriptors.js";
import {
  resolveAngularVelocity,
  resolveRotation,
  widenToVector3,
} from "./descriptors.js";
import type { SleepEvent } from "./events.js";
import type {
  BodyType,
  CCDMode,
  PhysicsDimension,
  Vector3Input,
} from "./types.js";
import { DEFAULT_CCD_MODE, DEFAULT_ENABLED_CCD_MODE } from "./types.js";
import { validateMass, validateRigidBodyDescriptor } from "./validation.js";

/**
 * The dimension a dimension-agnostic check runs under.
 *
 * `"3d"` is the permissive one: every §21 rule that `"2d"` adds — position in
 * the XY plane, rotation about +Z, angular velocity about +Z — is a *restriction*
 * of the 3D rules, so validating with `"3d"` performs exactly the
 * dimension-independent checks (finiteness, the §23 mass rule, inertia, damping,
 * the §31 CCD reconciliation) and rejects nothing a `"2d"` world would accept.
 */
const WIDENING_DIMENSION: PhysicsDimension = "3d";

/** Appendix A / §23: gravity applies unscaled unless a body says otherwise. */
const DEFAULT_GRAVITY_SCALE = 1;

/**
 * §19 default: a body is fully physical and blends nothing.
 *
 * A plain `RigidBody` is a body the solver owns (§22, §42's `"physics"`
 * authority), and §19's blend is opt-in — it happens only under `"blended"`
 * authority. Defaulting to anything else would mean that merely attaching a
 * body silently mixed some other system's pose into the solve, and the only
 * other system in the mix produces nothing until a `PoseTarget` is animated:
 * the blended pose of an unanimated target is the node's start pose, so a
 * non-zero animation weight by default would pin every new body towards where
 * it was created. `1 / 0` is therefore both the safe default and the one that
 * makes `"physics"` and `"blended"` agree for a body nobody has blended yet.
 */
const DEFAULT_PHYSICS_WEIGHT = 1;

/** §19 default: nothing is animated into the solve until asked. See `DEFAULT_PHYSICS_WEIGHT`. */
const DEFAULT_ANIMATION_WEIGHT = 0;

/**
 * The §19 blend split, normalized: two fractions that sum to 1.
 *
 * Produced by {@link RigidBody.normalizedWeights}. A plain mutable record so it
 * can be reused as an `out` parameter on a per-step path (§7b, plan D7).
 */
export interface BlendWeights {
  /** Fraction of the final pose taken from the solver (§19). */
  physics: number;
  /** Fraction taken from the animated target pose (§19). */
  animation: number;
}

/**
 * §85's finiteness rule for a §19 blend weight, on assignment.
 *
 * Local to this module rather than added to `validation.ts` because a weight
 * never reaches a descriptor: it is component-level engine state (see the
 * module header), so there is no descriptor validator for this rule to belong
 * to and nothing else to keep it consistent with.
 *
 * Zero is legal on either weight — a body may be fully physical or fully
 * animated. Both zero at once is legal too, and is resolved (with a warning) at
 * use; see {@link RigidBody.normalizedWeights} for why it is not rejected here.
 */
function validateBlendWeight(field: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      `${field} must be a finite number >= 0; got ${String(value)} (§19, §85).`,
      { context: { field, value } },
    );
  }
}

/**
 * A torque or angular impulse (§26), in the same two forms §23's angular
 * velocity accepts (plan P5-3).
 *
 * A `number` is the scalar about **+Z** — the only angular degree of freedom a
 * `"2d"` world has — and widens to `(0, 0, w)`. Units are newton-metres for a
 * torque and newton-metre-seconds for an angular impulse.
 */
export type TorqueInput = Vector3 | number;

/**
 * One point-applied load: `applyForceAtPoint`'s force or
 * `applyImpulseAtPoint`'s impulse, with the world-space point it acts at (§26).
 *
 * Both vectors are **owned by the body** and are recycled between steps — the
 * command buffers are pools, so the entry you read this step is overwritten the
 * next time the same slot is used. Copy anything you intend to keep.
 */
export interface PointLoad {
  /** The applied vector: newtons for a force, newton-seconds for an impulse. */
  readonly value: Vector3;
  /** World-space point of application (§26). */
  readonly point: Vector3;
}

/** A queued {@link RigidBody.wake} or {@link RigidBody.sleep} (§32). */
export type SleepCommand = "wake" | "sleep";

/**
 * What a body has been asked to do since the world last drained it (§26, §32).
 *
 * Read-only view of live, body-owned storage: the vectors and the pool entries
 * are the body's own instances, so a reference taken here reflects later
 * accumulation and is reset in place when the world clears the buffers. Nothing
 * in this record is simulation state — it is a queue of requests.
 *
 * ## Clearing semantics
 *
 * The world consumes the whole record once per fixed step, hands it to the
 * adapter, and clears it. That single rule produces the two behaviours §26
 * describes:
 *
 * - a **force** or **torque** acts for one step only. To push continuously,
 *   call `applyForce` every step (from a `fixedUpdate` listener, §10) — the
 *   buffer is empty again by the time the next step begins;
 * - an **impulse** is a one-shot change of momentum. Applying it once is
 *   enough, and the same clearing rule guarantees it is not applied twice.
 *
 * ## Point loads are pooled
 *
 * `pointForces` and `pointImpulses` are pools that grow to the high-water mark
 * of a single step and never shrink; only the first `pointForceCount` /
 * `pointImpulseCount` entries are live. Clearing resets the counts, not the
 * arrays, so a steady-state body accumulating point loads every step allocates
 * nothing (§7b, plan D7).
 */
export interface RigidBodyCommands {
  /** Accumulated linear force in newtons (§26 `applyForce`). */
  readonly force: Vector3;

  /** Accumulated torque in newton-metres (§26 `applyTorque`). */
  readonly torque: Vector3;

  /** Accumulated linear impulse in newton-seconds (§26 `applyImpulse`). */
  readonly impulse: Vector3;

  /**
   * Accumulated angular impulse in newton-metre-seconds (§26
   * `applyAngularImpulse`).
   */
  readonly angularImpulse: Vector3;

  /** Pooled `applyForceAtPoint` entries; see the record documentation. */
  readonly pointForces: readonly PointLoad[];

  /** How many entries of {@link RigidBodyCommands.pointForces} are live. */
  readonly pointForceCount: number;

  /** Pooled `applyImpulseAtPoint` entries; see the record documentation. */
  readonly pointImpulses: readonly PointLoad[];

  /** How many entries of {@link RigidBodyCommands.pointImpulses} are live. */
  readonly pointImpulseCount: number;

  /**
   * The last {@link RigidBody.wake} or {@link RigidBody.sleep} of this step, or
   * `null`.
   *
   * Last call wins rather than two independent flags: a body told to wake and
   * then to sleep within one step has to resolve to *something*, and "the most
   * recent instruction" is the only resolution that does not depend on the
   * order in which the world happens to read two booleans (§33).
   */
  readonly sleepCommand: SleepCommand | null;
}

/** The writable face of {@link RigidBodyCommands}; module-private by design. */
interface MutableRigidBodyCommands {
  readonly force: Vector3;
  readonly torque: Vector3;
  readonly impulse: Vector3;
  readonly angularImpulse: Vector3;
  readonly pointForces: PointLoad[];
  pointForceCount: number;
  readonly pointImpulses: PointLoad[];
  pointImpulseCount: number;
  sleepCommand: SleepCommand | null;
}

/**
 * The registry-writable view of {@link RigidBody.sleeping} — the same pattern
 * `@fourjs/core` uses for `Component.host`: the property is `readonly` in the
 * public contract so nothing else assigns it, and one named function in this
 * module performs the write.
 */
interface RigidBodySleepBinding {
  sleeping: boolean;
}

/**
 * The world-writable view of the two mirrors a `PhysicsWorld` maintains on a
 * body: how many worlds hold it, and what mass the solver derived for it. Same
 * arrangement as {@link RigidBodySleepBinding}.
 */
interface RigidBodyWorldBinding {
  registeredWorldCount: number;
  liveSolverWriteWorldCount: number;
  derivedMass: number | undefined;
}

/**
 * The writable view of {@link RigidBody.pendingSolverWrites} — same arrangement
 * as {@link RigidBodySleepBinding}, and the reason the bit set is a `readonly`
 * public field rather than a `#private` one: a `#` field is reachable only from
 * inside the class body, and this module's world-facing writers are free
 * functions by design (see {@link setRigidBodyRegistered} for why).
 */
interface RigidBodyDirtyBinding {
  pendingSolverWrites: number;
}

/**
 * The §37 property writes a `RigidBody` can have pending, as a bit set (PH-1
 * stage 2, 2026-08-07).
 *
 * One bit per **solver call**, not one per property: §23's mass, centre of
 * mass, and rotational inertia are a single triple a solver sets in one go, and
 * the two damping coefficients likewise, so a body that had its mass and both
 * dampings written costs exactly two calls at the next step.
 *
 * A bit set rather than a set of booleans because the whole point is that the
 * common case — nothing was written — is one integer comparison per body per
 * step, which is what keeps a world whose bodies nobody touched on the same
 * solver-call path it took before this existed (§33: the goldens must not
 * move).
 *
 * **Package-internal.** `PhysicsWorld` is the only reader, through
 * {@link drainRigidBodySolverWrites}; nothing outside `@fourjs/physics` should
 * depend on the numbering.
 */
export const RIGID_BODY_MASS_PROPERTIES_DIRTY = 1;

/** §23's two damping coefficients. See {@link RIGID_BODY_MASS_PROPERTIES_DIRTY}. */
export const RIGID_BODY_DAMPING_DIRTY = 2;

/** §23's gravity multiplier. See {@link RIGID_BODY_MASS_PROPERTIES_DIRTY}. */
export const RIGID_BODY_GRAVITY_SCALE_DIRTY = 4;

/** §31's continuous-collision mode. See {@link RIGID_BODY_MASS_PROPERTIES_DIRTY}. */
export const RIGID_BODY_CCD_DIRTY = 8;

/**
 * Set for the duration of `setRigidBodyType`'s write, so the {@link
 * RigidBody.type} setter can tell a `PhysicsWorld` that has *just re-typed the
 * solver body* from application code that has not.
 *
 * A module-level flag rather than a parameter because the write goes through
 * the public setter, which is where §23's mass rule is enforced and which must
 * keep enforcing it. Set and cleared synchronously around one assignment — no
 * `await` and no user callback runs in between — so it can never be observed in
 * the set state by anything else.
 *
 * **The hazard, stated (2026-08-07).** Being module-level, the flag suppresses
 * the type-drift warning for *every* `RigidBody` in the process while it is
 * set, not merely for the one being re-typed. That is safe only because of the
 * "no callback in between" property above: the window is one assignment inside
 * `setRigidBodyType`, so no other body's setter can run in it. It would stop
 * being safe the moment the `type` setter emitted an event, invoked a change
 * hook, or otherwise handed control to application code — a listener re-typing
 * a second body from inside that window would have its own drift warning eaten
 * silently. A setter that gains a callback must take the suppression with it
 * (a parameter, or a per-instance token), not inherit this flag.
 */
let worldDrivenTypeWrite = false;

/** §32's sleep-state payload as it reaches a node's listeners. */
export type RigidBodySleepEvent = SleepEvent<RigidBody>;

/**
 * What a {@link RigidBody} emits (§29, §32) — §29's five body-facing names,
 * minus the two trigger names, which belong to the sensor collider
 * (`ColliderEventMap`).
 *
 * Declared here with the two §32 sleep names; `collider.ts` merges the three
 * §29 collision names in (declaration merging). Their payload,
 * `RigidBodyCollisionEvent`, names `Collider`, and importing that type here —
 * even type-only — would close an import cycle: `collider.ts` already imports
 * {@link RigidBody} at runtime to resolve `Collider.body`. Everywhere the
 * package is consumed the five keys read as one interface, exactly as
 * `@fourjs/input`'s pointer names merge into `NodeEventMap`.
 *
 * Emission is package-internal (see the module header): `PhysicsSystem`
 * dispatches these after the fixed step, never during it (§6b, §39 step 9).
 */
export interface RigidBodyEventMap {
  /** This body stopped simulating (§32). */
  sleep: RigidBodySleepEvent;
  /** This body resumed simulating (§32). */
  wake: RigidBodySleepEvent;
}

/**
 * Returns pool slot `index`, appending a fresh one when the pool is too short.
 *
 * The append is the only allocation on the point-load path and happens at most
 * once per slot for the lifetime of the body.
 */
function pointLoadSlot(pool: PointLoad[], index: number): PointLoad {
  if (index < pool.length) {
    return pool[index];
  }
  const slot: PointLoad = { value: new Vector3(), point: new Vector3() };
  pool.push(slot);
  return slot;
}

/**
 * Reconciles §23's `continuousCollisionDetection` switch with §31's `ccdMode`
 * (the rule `RigidBodyDescriptor.ccdMode` states, minus the case
 * `validateRigidBodyDescriptor` has already rejected).
 *
 * | `continuousCollisionDetection` | `ccdMode`      | Result                     |
 * | ------------------------------ | -------------- | -------------------------- |
 * | absent                         | absent         | `"disabled"` (Appendix A)  |
 * | `true`                         | absent         | {@link DEFAULT_ENABLED_CCD_MODE} |
 * | absent or `true`               | non-`disabled` | that mode                  |
 * | `false`                        | non-`disabled` | rejected by §85 validation |
 * | `true`                         | `"disabled"`   | {@link DEFAULT_ENABLED_CCD_MODE} |
 * | `false` or absent              | `"disabled"`   | `"disabled"`               |
 *
 * The last-but-one row is a decision (WP-5.2): §23's boolean is the on/off
 * switch and §31's union names the *method*, so "on, with no method" — which is
 * what `true` plus `"disabled"` says — resolves to the default method, exactly
 * as `true` with no mode at all does. The mirrored contradiction (`false` plus
 * a real method) asks for the opposite of the switch and stays an error.
 */
function resolveCCDMode(descriptor: RigidBodyDescriptor): CCDMode {
  const mode = descriptor.ccdMode;
  if (mode !== undefined && mode !== "disabled") {
    return mode;
  }
  return descriptor.continuousCollisionDetection === true
    ? DEFAULT_ENABLED_CCD_MODE
    : DEFAULT_CCD_MODE;
}

/**
 * A simulated body attached to a node (§23), created from a
 * {@link RigidBodyDescriptor}.
 *
 * ```ts
 * const body = node.addComponent(
 *   new RigidBody({ type: "dynamic", mass: 2, linearDamping: 0.1 }),
 * );
 * node.addComponent(new Collider({ shape: { type: "sphere", radius: 0.5 } }));
 *
 * body.on("collisionstart", (event) => {
 *   console.log(event.totalImpulse.length());
 * });
 *
 * body.applyImpulse(new Vector3(0, 5, 0)); // applied at the next fixed step
 * ```
 *
 * One per node (§6a). See the module header for the pose, command, event, and
 * dimension contracts.
 */
export class RigidBody
  extends EventEmitter<RigidBodyEventMap>
  implements Component
{
  /** Component key (plan D2) and §79 serialization name. */
  static readonly typeName = "rigid-body";

  /**
   * The node this component is attached to, or `null`. Written by the
   * `ComponentRegistry` alone (§6a); never assign it.
   */
  host: ComponentHost | null = null;

  /**
   * Centre of mass in the body's local frame (§23). Owned by the component and
   * never replaced — write into it. The origin by default.
   *
   * §23 makes this always present, which is *not* the same as always
   * *authored*: a body that never mentioned a centre of mass is asking the
   * solver to derive one from its colliders (§23, §25), and a body that placed
   * one is overriding that derivation. {@link RigidBody.centerOfMassAuthored}
   * is that distinction and {@link RigidBody.toDescriptor} emits the field only
   * when it holds.
   */
  readonly centerOfMass: Vector3;

  /**
   * Linear velocity in metres per second (§23). Authored state going in,
   * solved state coming back — see the module header.
   */
  readonly linearVelocity: Vector3;

  /**
   * Angular velocity in radians per second (§23), as an axis-angle rate vector;
   * in a `"2d"` world only `z` is meaningful (§21).
   */
  readonly angularVelocity: Vector3;

  /**
   * Rotational inertia about the centre of mass (§23), or `undefined` to let
   * the solver derive it from the colliders and the mass.
   *
   * §23 declares this non-optional, but §23 also derives mass (and with it
   * inertia) from collider density when it is not authored — and "derive it"
   * and "the identity tensor" are different instructions. The component keeps
   * them distinguishable: `undefined` **is** this field's authored flag, which
   * is why it needs no companion to
   * {@link RigidBody.centerOfMassAuthored}. In a `"2d"` world only the Z
   * diagonal entry is used (§23).
   *
   * For the same reason a future `syncSolverToScene` must **not** publish a
   * solver-derived tensor back into this field (WP-5.2-fix1): doing so would
   * turn a derivation into an authored mass distribution, which is exactly the
   * defect {@link RigidBody.centerOfMassAuthored} exists to prevent. A derived
   * tensor belongs in a separate read-only field.
   */
  inertiaTensor?: Matrix3;

  /** Backing store for {@link RigidBody.linearDamping}. */
  #linearDamping: number;

  /** Backing store for {@link RigidBody.angularDamping}. */
  #angularDamping: number;

  /** Backing store for {@link RigidBody.gravityScale}. */
  #gravityScale: number;

  /**
   * Whether the solver has put this body to sleep (§23, §32).
   *
   * Read-only state, exactly as §23 requires: {@link RigidBody.wake} and
   * {@link RigidBody.sleep} are the commands, and the flag changes only when
   * the solver reports the transition after a step — at which point the body
   * also emits `"sleep"` or `"wake"` (WP-5.3).
   */
  readonly sleeping: boolean = false;

  /**
   * How many `PhysicsWorld`s currently hold this component (§37), normally `0`
   * or `1`.
   *
   * Read-only state like {@link RigidBody.sleeping}, written by
   * `PhysicsWorld.addBody` and `removeBody`. A count rather than a flag because
   * nothing forbids registering one component with two worlds, and because the
   * body stops being registered only when the *last* of them lets go. It is
   * what turns this class's "that write reaches no solver" warnings on — see
   * the module header's table.
   */
  readonly registeredWorldCount: number = 0;

  /**
   * How many of those worlds can carry a §37 property change into their solver
   * — the subset of {@link RigidBody.registeredWorldCount} whose adapter
   * implements `SolverBodyTuningAccess` (PH-1 stage 2, 2026-08-07).
   *
   * Read-only state, written by the same `addBody` / `removeBody` pair. It is
   * what decides whether a setter in the module header's table **warns** or
   * merely **marks the property dirty**: a write is on the record as
   * unreachable exactly when some world holding this body cannot deliver it, so
   * the two counts differ. Registering a body with a tuning adapter *and* a
   * plain one leaves the warning on, which is the truth — one of the two
   * simulations will not see the change.
   */
  readonly liveSolverWriteWorldCount: number = 0;

  /**
   * Which §37 property writes are waiting for the next fixed step, as a bit set
   * of the `RIGID_BODY_*_DIRTY` flags (PH-1 stage 2, 2026-08-07).
   *
   * Read-only state like {@link RigidBody.sleeping}: the setters in the module
   * header's table set bits, and `PhysicsWorld` clears them at the top of
   * `step` after pushing each one through `SolverBodyTuningAccess`. `0` — the
   * value for a body nobody wrote to — is what the world tests to decide that
   * this body needs no solver call at all.
   *
   * Bits are set whether or not any world can carry them, because the cost is
   * one `|=` and an unregistered body that is later added rebuilds itself from
   * `toDescriptor()` anyway: a stale bit is at worst one redundant solver call
   * with the value the solver already has, never a wrong one.
   */
  readonly pendingSolverWrites: number = 0;

  /**
   * The last mass the **solver** derived for this body, or `undefined` before
   * one was read (§23, §25).
   *
   * Read-only mirror of solver state, written by `PhysicsWorld.addBody`'s mass
   * refresh. It exists so that a derived mass can be *reported* — {@link
   * RigidBody.mass} falls back to it, so `inverseMass` is a number rather than
   * `NaN` for a density-derived body — without being *authored*: only an
   * authored mass is re-emitted by {@link RigidBody.toDescriptor}. See
   * {@link RigidBody.massAuthored}.
   */
  readonly derivedMass?: number;

  /**
   * The initial world position a descriptor carried, or `undefined` (§37).
   *
   * The live pose is the node's `Transform` (§7, §42); this is only what the
   * descriptor asked for, kept so a descriptor round-trips through the
   * component unchanged. A `Vector2` has already been widened to `z = 0`.
   */
  readonly initialPosition?: Vector3;

  /**
   * The initial world rotation a descriptor carried, or `undefined`. A scalar
   * angle has already been resolved to its quaternion about +Z (§7a).
   */
  readonly initialRotation?: Quaternion;

  /** Backing store for {@link RigidBody.type}. */
  #type: BodyType;

  /**
   * The **authored** mass; `undefined` means "derive it from the colliders".
   *
   * Written by the constructor and the {@link RigidBody.mass} setter and by
   * nothing else — see {@link RigidBody.massAuthored} for why a solver-derived
   * mass may not land here. Its definedness *is* the authoredness flag
   * (2026-08-07: a separate `#massAuthored` boolean tracked exactly
   * `#mass !== undefined` at every program point and was deleted rather than
   * kept in step by hand).
   */
  #mass?: number;

  /**
   * Which solver-drift warnings this body has already emitted, allocated on the
   * first one. See {@link RigidBody.mass}.
   */
  #driftWarned?: Set<string>;

  /**
   * Whether a centre of mass was named by the constructor descriptor or by
   * {@link RigidBody.markCenterOfMassAuthored} — the *sticky* half of
   * {@link RigidBody.centerOfMassAuthored}, whose other half is "the vector is
   * not at the origin".
   */
  #centerOfMassAuthored: boolean;

  /** Backing store for {@link RigidBody.ccdMode} (§31). */
  #ccdMode: CCDMode;

  /** Backing store for {@link RigidBody.ccdPredictionDistance} (§31). */
  #ccdPredictionDistance: number | undefined;

  /** Backing store for {@link RigidBody.physicsWeight} (§19). */
  #physicsWeight: number = DEFAULT_PHYSICS_WEIGHT;

  /** Backing store for {@link RigidBody.animationWeight} (§19). */
  #animationWeight: number = DEFAULT_ANIMATION_WEIGHT;

  /**
   * Whether the both-zero warning has already been emitted for this body — the
   * §42-style once-per-subject suppression {@link RigidBody.normalizedWeights}
   * documents. Sticky for the life of the body.
   */
  #zeroWeightsWarned = false;

  /** The §26 command buffers; see {@link RigidBodyCommands}. */
  readonly #commands: MutableRigidBodyCommands = {
    force: new Vector3(),
    torque: new Vector3(),
    impulse: new Vector3(),
    angularImpulse: new Vector3(),
    pointForces: [],
    pointForceCount: 0,
    pointImpulses: [],
    pointImpulseCount: 0,
    sleepCommand: null,
  };

  /**
   * The §8 space this body is **solved in** (PH-12, 2026-08-09).
   * `DEFAULT_SPACE_MODE` (`"world"`) unless the descriptor said otherwise, so
   * every body written before PH-12 means exactly what it meant.
   *
   * §8 gives physics two legal frames — *"physics normally operates in world or
   * local-plane space"* — and forbids a third case outright: *"screen-space UI
   * should not automatically participate in physical simulation unless
   * explicitly mapped to a simulation plane"*. {@link PhysicsWorld.addBody}
   * therefore accepts `"world"` and `"local-plane"` and refuses the rest:
   *
   * - `"screen"`, `"viewport"`, `"camera"`, `"billboard"` — refused **because
   *   §8 says so**. The sentence's escape hatch is a mapping the author
   *   performs: simulate a body on a node in the simulated frame and drive the
   *   presentation node from it.
   * - `"local-plane"` — legal under §8 and **accepted** by `PhysicsWorld.addBody`:
   *   the body's 2D pose lives in `PhysicsWorld.localPlane`'s frame and
   *   feed/publish maps through that basis (§21). Presentation frames stay
   *   refused.
   *
   * Plain and mutable, with no change hook and no validation: `PhysicsWorld` is
   * the only reader and it reads at registration, so writing it on an
   * already-registered body does nothing until the body is registered again.
   * `@fourjs/core`'s `isSimulationSpaceMode` answers §8's own question (world
   * and local-plane pass; presentation frames fail).
   */
  space: SpaceMode;

  /**
   * Widening workspace for the §26 methods, so accumulating a load allocates
   * nothing (§7b, plan D7). Never escapes this class.
   */
  readonly #scratch = new Vector3();

  /**
   * Builds a body from `descriptor`, which is validated against §22, §23, §31,
   * and §85 (dimension-independently — see the module header).
   *
   * Vectors and the inertia tensor are **copied**, so the caller keeps
   * ownership of whatever it passes in.
   */
  constructor(descriptor: RigidBodyDescriptor) {
    super();
    validateRigidBodyDescriptor(descriptor, WIDENING_DIMENSION);

    this.#type = descriptor.type;
    this.#mass = descriptor.mass;
    this.space = descriptor.space ?? DEFAULT_SPACE_MODE;
    this.#ccdMode = resolveCCDMode(descriptor);
    this.#ccdPredictionDistance = descriptor.ccdPredictionDistance;

    this.#centerOfMassAuthored = descriptor.centerOfMass !== undefined;
    this.centerOfMass =
      descriptor.centerOfMass === undefined
        ? new Vector3()
        : widenToVector3(descriptor.centerOfMass);
    this.linearVelocity =
      descriptor.linearVelocity === undefined
        ? new Vector3()
        : widenToVector3(descriptor.linearVelocity);
    this.angularVelocity =
      descriptor.angularVelocity === undefined
        ? new Vector3()
        : resolveAngularVelocity(
            WIDENING_DIMENSION,
            descriptor.angularVelocity,
          );
    if (descriptor.inertiaTensor !== undefined) {
      this.inertiaTensor = new Matrix3().copy(descriptor.inertiaTensor);
    }

    this.#linearDamping = descriptor.linearDamping ?? 0;
    this.#angularDamping = descriptor.angularDamping ?? 0;
    this.#gravityScale = descriptor.gravityScale ?? DEFAULT_GRAVITY_SCALE;

    if (descriptor.position !== undefined) {
      this.initialPosition = widenToVector3(descriptor.position);
    }
    if (descriptor.rotation !== undefined) {
      this.initialRotation = resolveRotation(
        WIDENING_DIMENSION,
        descriptor.rotation,
      );
    }
  }

  // --- §22/§23 state --------------------------------------------------------

  /**
   * Which §22 simulation model this body follows (§23). Settable; the §23 mass
   * rule is re-checked against the new type, so promoting a zero-mass body to
   * `"dynamic"` fails here rather than in the solver.
   *
   * ## After registration, go through the world (plan P7-3)
   *
   * This setter changes the **component**. Once the body is registered with a
   * `PhysicsWorld`, the solver is running a body of the type it was created
   * with, and writing here alone would leave the two disagreeing about what is
   * being simulated — the fixed-step pipeline would keep feeding the old model.
   *
   * `world.setBodyControlMode(node, type, options?)` is the call that changes
   * both: it re-types the solver body **in place** (the id, the checksum order,
   * the colliders, and the pose all survive), moves this property with it, and
   * can seed the new velocities from an animated `PoseTarget` — §19's
   * animated → kinematic → dynamic transitions. WP-5.3's rule that a re-typed
   * body had to be removed and added again is superseded by it.
   *
   * Assigning here while the body is registered is not silently accepted: the
   * setter warns once per body (2026-08-06) naming `setBodyControlMode`, which
   * is the call that moves the solver too. The assignment still happens — the
   * component is the caller's — but the divergence is on the record instead of
   * showing up later as a body that refuses to fall.
   */
  get type(): BodyType {
    return this.#type;
  }

  set type(value: BodyType) {
    validateMass(value, this.mass);
    if (value !== this.#type) {
      this.#warnTypeDrift(
        `A registered RigidBody's type was set to ${JSON.stringify(value)} directly, which changes the component but not the solver: the world keeps simulating the old §22 model and the fixed-step pipeline keeps branching on it. Call world.setBodyControlMode(node, type) instead — it re-types the solver body in place (§22, §23, plan P7-3).`,
      );
    }
    this.#type = value;
  }

  /**
   * Mass in kilograms (§23): the authored mass when there is one, otherwise the
   * last mass the solver derived from collider density times volume (§23, §24,
   * §25), or `undefined` when neither exists.
   *
   * Authoritative when authored and re-validated on assignment: a dynamic
   * body's mass must be positive, and non-simulated mass is expressed through
   * the body *type*, never `mass = 0` (§23, §85). Assigning here **authors** the
   * mass — see {@link RigidBody.massAuthored} — and queues §23's whole triple
   * (mass, centre of mass, rotational inertia) for the next fixed step, which a
   * world whose adapter implements `SolverBodyTuningAccess` pushes into the
   * solver (PH-1 stage 2). See the module header's table for what happens when
   * it does not, and for the one assignment that still reaches nothing:
   * `mass = undefined`.
   */
  get mass(): number | undefined {
    return this.#mass ?? this.derivedMass;
  }

  set mass(value: number | undefined) {
    validateMass(this.#type, value);
    // Only a *change* can drift from the solver, and the warning is one-shot
    // per body per key (2026-08-07): letting `body.mass = body.mass` consume
    // the single warning would spend it on the one assignment that cannot
    // possibly have desynchronized anything. The comparison is against the
    // authored mass, so authoring a value equal to a solver-derived one still
    // counts as a change — it is one, and `toDescriptor` now emits it.
    if (value !== this.#mass) {
      if (value === undefined) {
        // Un-authoring is the one direction the seam cannot express (PH-1
        // stage 2): "derive my mass from collider density again" means
        // restoring every collider's own density, which only the registration
        // path holds. It stays a warning on every adapter.
        this.#warnSolverDrift(
          "mass",
          "A registered RigidBody's mass was set to undefined, asking the solver to derive it from collider density again (§23, §25). That is the one property change SolverBodyTuningAccess cannot express — restoring the colliders' densities needs the registration path — so the solver keeps the mass it has. Re-register the body (world.removeBody(node) then world.addBody(node)) to rebuild it from the descriptor.",
        );
      } else {
        this.#recordSolverWrite(
          RIGID_BODY_MASS_PROPERTIES_DIRTY,
          "mass",
          "A registered RigidBody's mass was assigned, which changes the component but not the solver: this world's adapter does not implement SolverBodyTuningAccess, so §23's mass triple reaches a solver body once, at createBody (§23, §37). Re-register the body (world.removeBody(node) then world.addBody(node)) to rebuild it from the descriptor, or write to the solver through world.getBodyHandle(node).",
        );
      }
    }
    this.#mass = value;
  }

  /**
   * Queues §23's mass triple for the next fixed step after
   * {@link RigidBody.centerOfMass} or {@link RigidBody.inertiaTensor} was
   * edited **in place** (PH-1 stage 2, 2026-08-07).
   *
   * ## Why this has to be asked for
   *
   * `centerOfMass` is a `readonly` vector mutated with `set`/`copy` and
   * `inertiaTensor` is a plain field, so neither edit passes through a setter
   * and nothing can observe it. The alternatives were to compare both against a
   * shadow copy on every body on every step — real per-step cost for a value
   * that changes approximately never — or to say so and give the caller one
   * call. This is that call, and it is the same bargain
   * {@link RigidBody.markCenterOfMassAuthored} strikes for the same field.
   *
   * ## What it queues
   *
   * The whole triple, because a solver sets the three together (§23) — so it
   * also picks up an authored {@link RigidBody.mass} that has not changed.
   * Calling it on a body whose mass was **never authored** queues nothing and
   * warns once: §23 derives centre and inertia from geometry precisely when no
   * mass was named, and an adapter asked for a distribution with no mass to
   * distribute has nothing to do but refuse (the rule
   * {@link RigidBody.centerOfMassAuthored} states at length). Author a mass
   * first.
   *
   * Free to call on an unregistered body, and free to call twice: the bit is
   * already set.
   */
  markMassPropertiesChanged(): void {
    if (!this.massAuthored) {
      this.#warnSolverDrift(
        "massProperties",
        "markMassPropertiesChanged() was called on a registered RigidBody with no authored mass, so nothing was queued: §23 sets mass, centre of mass, and rotational inertia as one triple, and a solver asked for a distribution with no mass to distribute refuses it. Assign body.mass first, then call this (§23, §25).",
      );
      return;
    }
    this.#recordSolverWrite(
      RIGID_BODY_MASS_PROPERTIES_DIRTY,
      "massProperties",
      "markMassPropertiesChanged() was called on a registered RigidBody, but this world's adapter does not implement SolverBodyTuningAccess, so §23's mass triple still reaches a solver body only at createBody (§23, §37). Re-register the body, or write to the solver through world.getBodyHandle(node).",
    );
  }

  /**
   * Whether {@link RigidBody.mass} is an **authored** mass rather than one the
   * solver derived (§23, §25).
   *
   * ## Why the distinction has to exist
   *
   * `PhysicsWorld.addBody` reads the solver's mass back onto the component so
   * that a density-derived body stops reporting `inverseMass === NaN`. Before
   * 2026-08-06 that read went through the `mass` *setter*, which made the
   * derived number indistinguishable from an authored one — so
   * {@link RigidBody.toDescriptor} re-emitted it as `mass`, and re-registering
   * the body (or serializing and reloading it) turned "derive my mass from my
   * colliders" into "my mass is 3.0141594". Scaling a collider afterwards then
   * changed nothing, silently.
   *
   * The two masses are therefore kept apart: `#mass` for what the author said,
   * {@link RigidBody.derivedMass} for what the solver answered, and
   * `toDescriptor` emits the field **only when this holds**. It is the same
   * rule {@link RigidBody.centerOfMassAuthored} states for the centre, with a
   * simpler test: no default value competes with `undefined` here, so an
   * authored mass is exactly a defined `#mass` — which is what this getter
   * derives rather than mirroring in a second field.
   */
  get massAuthored(): boolean {
    return this.#mass !== undefined;
  }

  /**
   * Linear damping coefficient, `>= 0` (§23).
   *
   * Applied to the solver body at `createBody` and, on a world whose adapter
   * implements `SolverBodyTuningAccess`, at the next fixed step after every
   * assignment (PH-1 stage 2). Assigning to a registered dynamic body held by
   * an adapter without that seam warns once instead — see the module header.
   */
  get linearDamping(): number {
    return this.#linearDamping;
  }

  set linearDamping(value: number) {
    // See {@link RigidBody.mass}'s setter: a no-op assignment cannot drift from
    // the solver and must not consume the one-shot warning (2026-08-07).
    if (value !== this.#linearDamping) {
      this.#recordSolverWrite(
        RIGID_BODY_DAMPING_DIRTY,
        "linearDamping",
        "A registered RigidBody's linearDamping was assigned, which changes the component but not the solver: this world's adapter does not implement SolverBodyTuningAccess, so damping reaches a solver body once, at createBody (§23, §37). Re-register the body, or write to the solver through world.getBodyHandle(node).",
      );
    }
    this.#linearDamping = value;
  }

  /** Angular damping coefficient, `>= 0` (§23). See {@link RigidBody.linearDamping}. */
  get angularDamping(): number {
    return this.#angularDamping;
  }

  set angularDamping(value: number) {
    if (value !== this.#angularDamping) {
      this.#recordSolverWrite(
        RIGID_BODY_DAMPING_DIRTY,
        "angularDamping",
        "A registered RigidBody's angularDamping was assigned, which changes the component but not the solver: this world's adapter does not implement SolverBodyTuningAccess, so damping reaches a solver body once, at createBody (§23, §37). Re-register the body, or write to the solver through world.getBodyHandle(node).",
      );
    }
    this.#angularDamping = value;
  }

  /**
   * Multiplier on world gravity for this body (§23). `1` leaves gravity as-is,
   * `0` makes the body weightless, a negative value inverts it.
   *
   * Applied at `createBody`; see {@link RigidBody.linearDamping} for what an
   * assignment to a registered body does and does not do.
   */
  get gravityScale(): number {
    return this.#gravityScale;
  }

  set gravityScale(value: number) {
    if (value !== this.#gravityScale) {
      this.#recordSolverWrite(
        RIGID_BODY_GRAVITY_SCALE_DIRTY,
        "gravityScale",
        "A registered RigidBody's gravityScale was assigned, which changes the component but not the solver: this world's adapter does not implement SolverBodyTuningAccess, so the scale reaches a solver body once, at createBody (§23, §37). Re-register the body, or write to the solver through world.getBodyHandle(node).",
      );
    }
    this.#gravityScale = value;
  }

  /**
   * Derived reciprocal mass (§23), read-only:
   *
   * - `0` for `"static"` and both kinematic types — they do not respond to
   *   forces (§22), which is what an infinite effective mass means;
   * - `1 / mass` for a dynamic body with an authored mass;
   * - `NaN` for a dynamic body whose mass has not been authored and has not yet
   *   been derived from collider density (§23). `NaN` and not `0`: an
   *   unknown mass is not an infinite one, and a value that silently reads as
   *   "immovable" would turn a missing collider into a body that quietly
   *   refuses to move.
   */
  get inverseMass(): number {
    if (this.#type !== "dynamic") {
      return 0;
    }
    // {@link RigidBody.mass}, so a solver-derived mass answers here too — the
    // authored/derived split is about what `toDescriptor` emits, not about what
    // the body reports about itself.
    const mass = this.mass;
    return mass === undefined ? Number.NaN : 1 / mass;
  }

  /**
   * Whether {@link RigidBody.centerOfMass} is an **authored mass
   * distribution** rather than the always-present default §23 gives every body
   * (WP-5.2-fix1).
   *
   * ## Why the distinction has to exist
   *
   * §23 derives a body's mass from collider density times volume whenever
   * `mass` is not authored, and a solver derives the centre of mass and the
   * rotational inertia from the same geometry in the same breath — mass,
   * centre, and inertia are one triple. Naming any part of that triple means
   * "do not derive it", so a component that reported its default origin as an
   * authored centre would make the density-derived mass unreachable: an adapter
   * asked for a distribution with no mass to distribute has nothing to do but
   * refuse.
   *
   * ## The rule, and why it cannot silently drop what a caller asked for
   *
   * A centre of mass counts as authored when **either** holds:
   *
   * 1. the constructor descriptor carried `centerOfMass` (whatever its value,
   *    including the origin), or {@link RigidBody.markCenterOfMassAuthored}
   *    has been called — the sticky half;
   * 2. {@link RigidBody.centerOfMass} is not at the origin right now — the
   *    live half, which catches `body.centerOfMass.set(…)` after construction
   *    without asking the caller to announce it.
   *
   * The union is what makes the omission safe. Rule 1 keeps an explicitly
   * authored origin — the one value rule 2 cannot see — and rule 2 keeps every
   * post-construction edit. The only state that is omitted is a centre that is
   * at the origin *and* was never mentioned, which is precisely the state that
   * carries no instruction. `-0` reads as the origin (`-0 !== 0` is `false`),
   * and a non-finite component reads as authored, so §85 validation rejects it
   * rather than the descriptor quietly losing it.
   *
   * The one case rule 2 alone would get wrong is "pin the centre to the origin
   * even though the colliders sit off it", which is a real instruction that
   * looks identical to the default. Authoring `centerOfMass` in the descriptor
   * states it; {@link RigidBody.markCenterOfMassAuthored} states it after the
   * fact.
   */
  get centerOfMassAuthored(): boolean {
    if (this.#centerOfMassAuthored) {
      return true;
    }
    const { x, y, z } = this.centerOfMass;
    return x !== 0 || y !== 0 || z !== 0;
  }

  /**
   * Declares {@link RigidBody.centerOfMass} an authored mass distribution from
   * now on, so {@link RigidBody.toDescriptor} emits it even at the origin.
   *
   * The escape hatch for the one case the live half of
   * {@link RigidBody.centerOfMassAuthored} cannot infer: a centre deliberately
   * pinned to the body origin while the colliders sit elsewhere. One-way by
   * design — nothing un-authors a distribution, because "forget what I asked
   * for" is the silent data loss this whole mechanism exists to avoid. To go
   * back to a derived centre, build a body whose descriptor omits
   * `centerOfMass`.
   *
   * Remember that an authored distribution needs an authored {@link
   * RigidBody.mass} as well: solvers set mass, centre, and inertia as one
   * triple (§23), and an adapter is entitled to reject half of it.
   */
  markCenterOfMassAuthored(): void {
    this.#centerOfMassAuthored = true;
  }

  // --- §31 continuous collision detection -----------------------------------

  /**
   * Which §31 method sweeps this body, `"disabled"` when it is not swept.
   *
   * This is the authoritative field;
   * {@link RigidBody.continuousCollisionDetection} is §23's on/off view of it.
   *
   * Live on a world whose adapter implements `SolverBodyTuningAccess`: an
   * assignment takes effect at the next fixed step, carrying
   * {@link RigidBody.ccdPredictionDistance} with it for `"speculative"`. On an
   * adapter without that seam it warns once, like the rest of the module
   * header's table (PH-1 stage 2, 2026-08-07 — before which this setter did not
   * even warn).
   */
  get ccdMode(): CCDMode {
    return this.#ccdMode;
  }

  set ccdMode(value: CCDMode) {
    if (value !== this.#ccdMode) {
      this.#recordSolverWrite(
        RIGID_BODY_CCD_DIRTY,
        "ccdMode",
        "A registered RigidBody's ccdMode was assigned, which changes the component but not the solver: this world's adapter does not implement SolverBodyTuningAccess, so the §31 method reaches a solver body once, at createBody (§31, §37). Re-register the body, or write to the solver through world.getBodyHandle(node).",
      );
    }
    this.#ccdMode = value;
  }

  /**
   * §31's `"speculative"` prediction distance, in world units, when authored —
   * `undefined` means the adapter's documented default (1 m on both Rapier
   * adapters). Carried by the component so `world.addBody`'s rebuilt
   * descriptor delivers it to the solver (2026-08-05 review fix: the
   * constructor validated and accepted the field, then `toDescriptor()`
   * silently dropped it, so the authored distance never reached the adapter
   * on the component path).
   *
   * Read-only, like the shape of a collider: the distance is applied at
   * `createBody` and Rapier offers no post-creation re-tune through the seam.
   */
  get ccdPredictionDistance(): number | undefined {
    return this.#ccdPredictionDistance;
  }

  /**
   * §23's switch, expressed over {@link RigidBody.ccdMode} so the two can never
   * disagree: reading it asks whether a method is selected, and
   * `body.continuousCollisionDetection = true` (§31's own example) selects
   * {@link DEFAULT_ENABLED_CCD_MODE} unless a method is already set. Assigning
   * `false` clears the method.
   */
  get continuousCollisionDetection(): boolean {
    return this.#ccdMode !== "disabled";
  }

  set continuousCollisionDetection(value: boolean) {
    // Routed through the `ccdMode` setter rather than the backing field so the
    // §37 dirty bit and its warning cannot be reachable from one of §23's two
    // views of the same state and not the other (PH-1 stage 2).
    if (!value) {
      this.ccdMode = "disabled";
      return;
    }
    if (this.#ccdMode === "disabled") {
      this.ccdMode = DEFAULT_ENABLED_CCD_MODE;
    }
  }

  // --- §19 blend weights ----------------------------------------------------

  /**
   * How much of a `"blended"` node's final pose comes from the solver (§19),
   * relative to {@link RigidBody.animationWeight}.
   *
   * §19's sketch verbatim:
   *
   * ```ts
   * body.transformAuthority = "blended";
   * body.physicsWeight = 0.35;
   * body.animationWeight = 0.65;
   * ```
   *
   * The two weights are **independent settables, normalized at use** — they are
   * not required to sum to 1 and setting one never rewrites the other, so
   * `0.35`/`0.65` and `35`/`65` describe the same blend and a fade can drive
   * either slider alone. {@link RigidBody.normalizedWeights} is where the ratio
   * becomes a pair of fractions.
   *
   * Defaults to `DEFAULT_PHYSICS_WEIGHT`; must be finite and `>= 0`
   * (§85), checked on assignment. Inert under every authority except
   * `"blended"` (§42).
   */
  get physicsWeight(): number {
    return this.#physicsWeight;
  }

  set physicsWeight(value: number) {
    validateBlendWeight("physicsWeight", value);
    this.#physicsWeight = value;
  }

  /**
   * How much of a `"blended"` node's final pose comes from the animated target
   * pose — the `PoseTarget` on the node (§19, P7-1) — relative to
   * {@link RigidBody.physicsWeight}. See that property for the whole contract.
   *
   * Defaults to `DEFAULT_ANIMATION_WEIGHT`: a body nobody has blended is
   * fully physical.
   */
  get animationWeight(): number {
    return this.#animationWeight;
  }

  set animationWeight(value: number) {
    validateBlendWeight("animationWeight", value);
    this.#animationWeight = value;
  }

  /**
   * The two §19 weights as fractions that sum to 1, written into `out` and
   * returned.
   *
   * ```ts
   * const split = body.normalizedWeights(scratch); // per fixed step
   * pose.position
   *   .copy(solverPosition)
   *   .scale(split.physics)
   *   .add(targetScaled);
   * ```
   *
   * Pass an `out` on a per-step path and the call allocates nothing (§7b, plan
   * D7); omit it and one record is allocated per call.
   *
   * ## Both weights zero
   *
   * A body with `physicsWeight === 0` and `animationWeight === 0` has asked for
   * a pose made of nothing, which has no answer. Rather than produce `NaN` — or
   * a zero pose, which would teleport the node to the origin — this **falls
   * back to fully physical** (`{ physics: 1, animation: 0 }`, the constructed
   * default) and warns once per body via `console.warn`, the same development
   * semantics `warnAuthorityConflict` uses in `@fourjs/scene`: the first
   * occurrence names the mistake and every repeat is suppressed, because a
   * misconfigured body would otherwise print once per fixed step forever. The
   * suppression is sticky for the life of the body — fixing the weights and
   * zeroing them again warns no further.
   *
   * It is a warning and not a validation error because the state is reachable
   * one legal assignment at a time (`physicsWeight = 0` while `animationWeight`
   * is still 0 is the first half of every "fade to fully animated"), so
   * rejecting it at the setter would reject the sequence rather than the
   * mistake.
   *
   * Finiteness is guaranteed by the setters, so the only other arithmetic edge
   * is two weights whose sum overflows to infinity; that case is rescaled by
   * the larger weight so the ratio survives instead of collapsing to `0/0`.
   */
  normalizedWeights(
    out: BlendWeights = { physics: 0, animation: 0 },
  ): BlendWeights {
    const physics = this.#physicsWeight;
    const animation = this.#animationWeight;
    const sum = physics + animation;

    if (sum === 0) {
      this.#warnZeroWeights();
      out.physics = DEFAULT_PHYSICS_WEIGHT;
      out.animation = DEFAULT_ANIMATION_WEIGHT;
      return out;
    }

    if (sum === Number.POSITIVE_INFINITY) {
      // Both weights are finite (the setters guarantee it) but their sum
      // overflowed. The larger is finite by definition, so rescaling by it
      // keeps the ratio and brings the sum back into range.
      const scale = physics > animation ? physics : animation;
      const scaledPhysics = physics / scale;
      const scaledAnimation = animation / scale;
      const scaledSum = scaledPhysics + scaledAnimation;
      out.physics = scaledPhysics / scaledSum;
      out.animation = scaledAnimation / scaledSum;
      return out;
    }

    out.physics = physics / sum;
    out.animation = animation / sum;
    return out;
  }

  /**
   * Warns once when authored state that only reaches a solver at `createBody`
   * is assigned on a **registered dynamic** body (2026-08-06; see the module
   * header's table).
   *
   * Dynamic and not every type, because the other types have a live route for
   * the state that matters to them: a `"kinematic-velocity"` body's velocities
   * *are* fed to the solver every step (§22), and a static body's damping
   * changes nothing either way. A dynamic body is the case where the author's
   * write and the simulation genuinely part company.
   *
   * A warning and not an error: the component is the caller's, the assignment
   * is legal, and a body that is about to be removed and re-added is written to
   * exactly like this. Errors would reject the workflow rather than the
   * mistake — the same reasoning `normalizedWeights` documents.
   */
  #warnSolverDrift(key: string, message: string): void {
    if (this.registeredWorldCount === 0 || this.#type !== "dynamic") {
      return;
    }
    this.#warnOnce(key, message);
  }

  /**
   * Queues a §37 property change for the next fixed step, and warns when some
   * world holding this body cannot deliver it (PH-1 stage 2, 2026-08-07).
   *
   * The bit is set unconditionally — it costs one `|=` and a world that never
   * drains it never reads it — while the warning keeps
   * {@link RigidBody.#warnSolverDrift}'s stage-1 conditions **plus** one: every
   * world holding this body must be able to carry the write, or the caller
   * hears about it. `>` and not `!==` because the live count is a subset of the
   * registration count by construction, and a body registered with two worlds
   * of which one has a plain adapter is genuinely half-connected.
   */
  #recordSolverWrite(flag: number, key: string, message: string): void {
    (this as unknown as RigidBodyDirtyBinding).pendingSolverWrites |= flag;
    if (this.registeredWorldCount > this.liveSolverWriteWorldCount) {
      this.#warnSolverDrift(key, message);
    }
  }

  /**
   * Warns once when a **registered** body's `type` is assigned directly, at any
   * §22 type: the mismatch this one produces is between the component's model
   * and the solver's, which is wrong for a static body exactly as it is for a
   * dynamic one. See the {@link RigidBody.type} setter.
   */
  #warnTypeDrift(message: string): void {
    if (worldDrivenTypeWrite || this.registeredWorldCount === 0) {
      return;
    }
    this.#warnOnce("type", message);
  }

  /**
   * `console.warn` at most once per body per `key` — the §42-style
   * once-per-subject suppression {@link RigidBody.normalizedWeights} documents,
   * keyed so that four different mistakes are four different warnings and each
   * repeat is silent. The set is allocated on the first warning, so a body that
   * never warns carries nothing.
   */
  #warnOnce(key: string, message: string): void {
    const warned = (this.#driftWarned ??= new Set<string>());
    if (warned.has(key)) {
      return;
    }
    warned.add(key);
    console.warn(
      `${DEV_WARNING_PREFIX} ${message} Further ${key} occurrences on this body are suppressed.`,
    );
  }

  /** Emits the both-zero warning at most once per body. See {@link RigidBody.normalizedWeights}. */
  #warnZeroWeights(): void {
    if (this.#zeroWeightsWarned) {
      return;
    }
    this.#zeroWeightsWarned = true;
    console.warn(
      `${DEV_WARNING_PREFIX} A RigidBody has physicsWeight = 0 and ` +
        "animationWeight = 0, which describes no pose; falling back to fully " +
        "physical (physicsWeight 1). Set one of the two weights above 0 (§19). " +
        "Further occurrences on this body are suppressed.",
    );
  }

  /** Set by {@link RigidBody.dispose}; disposal is terminal (§83). */
  #disposed = false;

  /**
   * Whether {@link RigidBody.dispose} has run. Disposal is terminal (§83): a
   * disposed component refuses its §26/§32 commands and world registration with
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
        "RigidBody is disposed; commanding or registering a disposed body " +
          "is a lifetime mistake (§83), and a new body is a new RigidBody.",
        { context: { component: "RigidBody" } },
      );
    }
  }

  // --- §26 forces and impulses, §32 sleep commands --------------------------

  /**
   * What this body has been asked to do since the world last drained it (§26,
   * §32). A live read-only view — see {@link RigidBodyCommands}.
   */
  get commands(): RigidBodyCommands {
    return this.#commands;
  }

  /**
   * Requests that the solver wake this body at the next fixed step (§23, §32).
   *
   * Queued, not immediate: {@link RigidBody.sleeping} changes when the solver
   * reports the transition. Calling `wake()` then `sleep()` in the same step
   * leaves the later command standing.
   */
  wake(): void {
    this.#requireLive();
    this.#commands.sleepCommand = "wake";
  }

  /** Requests that the solver put this body to sleep (§23, §32). See {@link RigidBody.wake}. */
  sleep(): void {
    this.#requireLive();
    this.#commands.sleepCommand = "sleep";
  }

  /**
   * Accumulates a force in newtons, applied at the centre of mass (§26).
   *
   * Acts for one fixed step; call it every step to push continuously. Applying
   * a force does not implicitly wake a sleeping body — call
   * {@link RigidBody.wake} as well, so that what wakes a body is always
   * something the caller asked for (decision, WP-5.2).
   *
   * Per-step path: the components are widened but not range-checked, matching
   * §85's allowance that per-step validation may be skipped. A non-finite force
   * is caught by the solver, not here.
   */
  applyForce(force: Vector3Input): void {
    this.#requireLive();
    this.#commands.force.add(widenToVector3(force, this.#scratch));
  }

  /**
   * Accumulates a force in newtons applied at `worldPoint`, a **world-space**
   * position (§26).
   *
   * Kept as a point load rather than being decomposed into a force and a torque
   * at the call site: the lever arm is measured from the *world-space* centre
   * of mass, which the component does not know — §23's `centerOfMass` is in the
   * body's local frame and the pose belongs to the node and the solver. The
   * adapter, which has both, does the decomposition.
   */
  applyForceAtPoint(force: Vector3Input, worldPoint: Vector3Input): void {
    this.#requireLive();
    const commands = this.#commands;
    const slot = pointLoadSlot(commands.pointForces, commands.pointForceCount);
    widenToVector3(force, slot.value);
    widenToVector3(worldPoint, slot.point);
    commands.pointForceCount += 1;
  }

  /**
   * Accumulates a torque in newton-metres (§26). A `number` is the scalar about
   * +Z (plan P5-3). Acts for one fixed step, like {@link RigidBody.applyForce}.
   */
  applyTorque(torque: TorqueInput): void {
    this.#requireLive();
    this.#commands.torque.add(
      resolveAngularVelocity(WIDENING_DIMENSION, torque, this.#scratch),
    );
  }

  /**
   * Accumulates a linear impulse in newton-seconds, applied at the centre of
   * mass (§26).
   *
   * One-shot: the world applies it at the next fixed step and clears the
   * buffer, so a single call changes momentum exactly once.
   */
  applyImpulse(impulse: Vector3Input): void {
    this.#requireLive();
    this.#commands.impulse.add(widenToVector3(impulse, this.#scratch));
  }

  /**
   * Accumulates an impulse in newton-seconds applied at `worldPoint` (§26).
   * See {@link RigidBody.applyForceAtPoint} for why the point is kept.
   */
  applyImpulseAtPoint(impulse: Vector3Input, worldPoint: Vector3Input): void {
    this.#requireLive();
    const commands = this.#commands;
    const slot = pointLoadSlot(
      commands.pointImpulses,
      commands.pointImpulseCount,
    );
    widenToVector3(impulse, slot.value);
    widenToVector3(worldPoint, slot.point);
    commands.pointImpulseCount += 1;
  }

  /**
   * Accumulates an angular impulse in newton-metre-seconds (§26). A `number` is
   * the scalar about +Z (plan P5-3).
   */
  applyAngularImpulse(impulse: TorqueInput): void {
    this.#requireLive();
    this.#commands.angularImpulse.add(
      resolveAngularVelocity(WIDENING_DIMENSION, impulse, this.#scratch),
    );
  }

  // --- world registration ---------------------------------------------------

  /**
   * Re-validates this body against a world of `dimension` (§21, §85).
   *
   * Called when the body is registered with a `PhysicsWorld` (WP-5.3), which is
   * the first moment the dimension is known: a `"2d"` world rejects an
   * out-of-plane centre of mass, initial position, or angular velocity here
   * rather than projecting it away. Not a per-step path — it builds a
   * descriptor.
   */
  validateFor(dimension: PhysicsDimension): void {
    this.#requireLive();
    validateRigidBodyDescriptor(this.toDescriptor(), dimension);
  }

  /**
   * The descriptor an adapter would be handed for this body (§37 `createBody`).
   *
   * A fresh record whose vectors and tensor are **references to this
   * component's live state**, not copies: the adapter reads them during
   * `createBody` and must not retain them. `mass`, `centerOfMass`,
   * `inertiaTensor`, `position`, and `rotation` are present only when authored,
   * so a descriptor that omitted them round-trips unchanged.
   *
   * `centerOfMass` is the subtle one: §23 keeps it always present on the
   * component, so emitting it unconditionally would tell every adapter that
   * every body carries an authored mass distribution and make §23's
   * density-derived mass unreachable (WP-5.2-fix1). It is emitted exactly when
   * {@link RigidBody.centerOfMassAuthored} holds, which that property documents.
   *
   * `mass` follows the same rule against the same defect (2026-08-06): only an
   * **authored** mass is emitted, so a body whose mass a solver derived at
   * registration still asks the next solver to derive it rather than presenting
   * the first solver's answer as an instruction. See
   * {@link RigidBody.massAuthored}.
   *
   * §19's {@link RigidBody.physicsWeight} and {@link RigidBody.animationWeight}
   * are deliberately **absent**: a solver simulates a body, it does not blend
   * one, and the blend happens entirely above the adapter (§37) after the solve
   * (§19 step 5). Putting a weight in the descriptor would tell every adapter
   * it had a say in something it never sees.
   */
  toDescriptor(): RigidBodyDescriptor {
    const descriptor: RigidBodyDescriptor = {
      type: this.#type,
      linearVelocity: this.linearVelocity,
      angularVelocity: this.angularVelocity,
      linearDamping: this.#linearDamping,
      angularDamping: this.#angularDamping,
      gravityScale: this.#gravityScale,
      continuousCollisionDetection: this.continuousCollisionDetection,
      ccdMode: this.#ccdMode,
    };
    // The authored mass only — never {@link RigidBody.derivedMass}, which is
    // the solver's answer and not an instruction to the next solver. `#mass`
    // holds the authored value and nothing else, so its definedness is the
    // whole of {@link RigidBody.massAuthored}.
    if (this.#mass !== undefined) {
      descriptor.mass = this.#mass;
    }
    // Emitted only while the mode is still speculative: the §85 validation
    // this descriptor faces again in validateFor rejects the distance with
    // any other resolved mode, and a body retyped away from "speculative"
    // (via the ccdMode setter) has no use for it.
    if (
      this.#ccdPredictionDistance !== undefined &&
      this.#ccdMode === "speculative"
    ) {
      descriptor.ccdPredictionDistance = this.#ccdPredictionDistance;
    }
    if (this.centerOfMassAuthored) {
      descriptor.centerOfMass = this.centerOfMass;
    }
    if (this.inertiaTensor !== undefined) {
      descriptor.inertiaTensor = this.inertiaTensor;
    }
    // Emitted only when it is not the default, so every descriptor a body
    // produced before PH-12 is spelled exactly as it was — which is what keeps
    // §79's documents and the §37 call sequence byte-identical for the frame
    // every existing body is in.
    if (this.space !== DEFAULT_SPACE_MODE) {
      descriptor.space = this.space;
    }
    if (this.initialPosition !== undefined) {
      descriptor.position = this.initialPosition;
    }
    if (this.initialRotation !== undefined) {
      descriptor.rotation = this.initialRotation;
    }
    return descriptor;
  }

  // --- §6a lifecycle --------------------------------------------------------

  /**
   * Drops every listener and every queued command (§6a, §83).
   *
   * Detaching a component does **not** dispose it (§6a), so this runs only from
   * an explicit `dispose()` or `ComponentRegistry.disposeAll`. Removing the
   * body from its world is the world's business, not the component's.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.removeAllListeners();
    clearRigidBodyCommands(this);
  }
}

/**
 * Empties `body`'s §26 command buffers and its §32 sleep command.
 *
 * **Package-internal**: `PhysicsWorld` calls it once per fixed step, after the
 * commands have been handed to the adapter. Deliberately a free function
 * outside the barrel rather than a public method — clearing another
 * component's queue is not something application code should be able to do by
 * accident. The pools keep their slots (see {@link RigidBodyCommands}).
 */
export function clearRigidBodyCommands(body: RigidBody): void {
  const commands = body.commands as MutableRigidBodyCommands;
  commands.force.set(0, 0, 0);
  commands.torque.set(0, 0, 0);
  commands.impulse.set(0, 0, 0);
  commands.angularImpulse.set(0, 0, 0);
  commands.pointForceCount = 0;
  commands.pointImpulseCount = 0;
  commands.sleepCommand = null;
}

/**
 * Records that `body` joined (`true`) or left (`false`) a `PhysicsWorld` (§37).
 *
 * **Package-internal**, and the only writer of the registration count:
 * `PhysicsWorld.addBody` and `removeBody` call it, and the count is what turns
 * the component's "this reaches no solver" warnings on. Deliberately a free
 * function outside the barrel, like `clearRigidBodyCommands` — application code
 * that could claim a body was registered would only be able to manufacture
 * warnings or silence real ones.
 *
 * Increments and decrements are paired by construction — one registration adds
 * one and its teardown removes one — and the floor at zero is belt-and-braces
 * for a caller that ever unpairs them: a negative count would read as
 * "unregistered" and silence warnings that should fire.
 */
export function setRigidBodyRegistered(
  body: RigidBody,
  registered: boolean,
  liveSolverWrites: boolean,
): void {
  const binding = body as unknown as RigidBodyWorldBinding;
  const current = binding.registeredWorldCount;
  binding.registeredWorldCount = registered
    ? current + 1
    : Math.max(current - 1, 0);
  if (liveSolverWrites) {
    const live = binding.liveSolverWriteWorldCount;
    binding.liveSolverWriteWorldCount = registered
      ? live + 1
      : Math.max(live - 1, 0);
  }
}

/**
 * Returns the §37 property writes `body` has pending and clears them (PH-1
 * stage 2, 2026-08-07).
 *
 * **Package-internal**, and the mirror of {@link clearRigidBodyCommands}: the
 * one caller is `PhysicsWorld.step`, at the top of the step, and the value is a
 * bit set of the `RIGID_BODY_*_DIRTY` flags. `0` means nothing was written and
 * the world makes no solver call at all for this body — which is what keeps a
 * quiet world on the exact call sequence it had before this seam existed (§33).
 *
 * Draining **clears**, so a component registered with two worlds hands its
 * pending writes to whichever steps first, exactly as §26's command buffers do.
 * That is the established semantics of this class's other per-step buffer, and
 * the alternative (per-world dirty sets) would make a body's pending state
 * depend on how many worlds hold it.
 */
export function drainRigidBodySolverWrites(body: RigidBody): number {
  const binding = body as unknown as RigidBodyDirtyBinding;
  const pending = binding.pendingSolverWrites;
  binding.pendingSolverWrites = 0;
  return pending;
}

/**
 * Sets `body`'s §22 type **without** the registered-body warning the public
 * setter emits (plan P7-3).
 *
 * **Package-internal**: the one caller is `PhysicsWorld.setBodyControlMode`,
 * which has just re-typed the solver body, so component and solver agree and
 * there is nothing to warn about. Every other route to a registered body's type
 * is the drift the setter reports.
 *
 * The write still goes through the public setter — §23's mass rule is enforced
 * there and must stay enforced — with `worldDrivenTypeWrite` set across it.
 */
export function setRigidBodyType(body: RigidBody, type: BodyType): void {
  worldDrivenTypeWrite = true;
  try {
    body.type = type;
  } finally {
    worldDrivenTypeWrite = false;
  }
}

/**
 * Publishes the mass the solver derived for `body` onto its
 * {@link RigidBody.derivedMass} mirror (§23, §25).
 *
 * **Package-internal**, and the only writer: `PhysicsWorld.addBody` reads
 * `getBodyMass` back through it after the colliders exist. It must never write
 * {@link RigidBody.mass}, which is the authoring channel — a derived number
 * assigned there is re-emitted by `toDescriptor` as though the author had named
 * it, which is the laundering this pair of fields exists to prevent.
 *
 * `undefined` **un-mirrors** it (PH-5, 2026-08-07): a body whose last collider
 * was removed at runtime has nothing left to derive a mass from, and a mirror
 * left behind would report the mass of colliders that no longer exist.
 */
export function setRigidBodyDerivedMass(
  body: RigidBody,
  mass: number | undefined,
): void {
  (body as unknown as RigidBodyWorldBinding).derivedMass = mass;
}

/**
 * Publishes a solver-reported sleep transition onto `body` (§32).
 *
 * **Package-internal**, and the only writer of {@link RigidBody.sleeping} —
 * mirroring how `@fourjs/core` binds `Component.host`. Returns whether the state
 * actually changed, which is what tells `PhysicsSystem` to emit `"sleep"` or
 * `"wake"`; the emit itself happens after the fixed step (§6b, §39 step 9).
 */
export function setRigidBodySleeping(
  body: RigidBody,
  sleeping: boolean,
): boolean {
  if (body.sleeping === sleeping) {
    return false;
  }
  (body as RigidBodySleepBinding).sleeping = sleeping;
  return true;
}
