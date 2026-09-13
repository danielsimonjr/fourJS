/**
 * The Rapier 3D solver adapter (§37, §102, plan WP-5.5).
 *
 * `Rapier3dAdapter` is a `PhysicsSolverAdapter` backed by
 * `@dimforge/rapier3d-compat` (pinned at `0.20.0`). It is the 3D
 * sibling of {@link Rapier2dAdapter} and obeys the same rule: it may import
 * *nothing* from scene, motion, or render, because §37's seam exists so a solver
 * knows about bodies and colliders and not about nodes.
 *
 * ## Relationship to the 2D adapter
 *
 * The two classes are deliberately parallel and deliberately **separate**. They
 * wrap different npm packages with different wasm images and different call
 * signatures — 3D rotations are quaternions, 3D angular velocity and torque are
 * vectors, 3D inertia is three principal moments plus a frame — so the shared
 * part is the *shape* of the code, not the code itself. Every attempt to unify
 * them would have to be generic over the vector width and the rotation
 * representation, which is precisely the distinction that matters. What *is*
 * shared is the seam: `Rapier3dAdapter` implements the same
 * {@link RapierBodyAccess} interface the 2D adapter declares, unchanged — see
 * below.
 *
 * ## Rapier behaviour verified for 3D (not assumed from the 2D packet)
 *
 * Every finding WP-5.4 recorded for the 2D build was re-measured against the 3D
 * build for this packet, and all of them hold:
 *
 * - **Rapier handles are not integers and not stable.** Observed 3D values
 *   include `0`, `4.94e-324`, and `2.12e-314` — a packed `(index, generation)`
 *   pair reinterpreted as a float. They are usable as `Map` keys and nothing
 *   else. §33 needs a *monotonic* order that destruction cannot perturb, so this
 *   adapter keeps its own registry — see
 *   {@link Rapier3dAdapter.forEachBody}.
 * - **Colliders are invisible to queries until the next `step`.** A ray cast at
 *   a freshly created collider misses; `propagateModifiedBodyPositionsToColliders()`
 *   does not help; one `step` fixes it. The adapter does not paper over this
 *   with a hidden zero-length step, because that would run collision detection
 *   and manufacture events (§29) that no fixed step asked for.
 * - **Additional mass is applied late.** `setAdditionalMassProperties` leaves
 *   `body.mass()` at `0` until the first `step` or an explicit
 *   `recomputeMassPropertiesFromColliders()`. See
 *   {@link Rapier3dAdapter.createBody}.
 * - **`world.step` integrates in `numSolverIterations` substeps** of
 *   `dt / numSolverIterations` (4 by default in 0.19.3, same as 2D). The
 *   discrete closed form for a free fall is therefore
 *   `y = y₀ + g · h² · K(K+1)/2` with `h = dt/4` and `K = 4N`. Measured against
 *   the closed form over 60 steps: 4.3e-7 of drift.
 * - **A capsule's cylindrical section lies along +Y**, matching §24; a capsule
 *   with `halfHeight = 1, radius = 0.25` rests at `y = 1.2489`.
 * - **`castShape` reports `witness1` in world space and `witness2` in the cast
 *   shape's local frame** — measured, and the reason only `witness1` is used.
 * - **`projectPoint(point, solid: true)` returns the query point itself** when
 *   the point is inside a plain shape, and the surface projection otherwise.
 * - **Sensors are included in queries by default**, which is why §30's
 *   `includeSensors` is applied by `passesQueryFilter` rather than left to
 *   Rapier.
 * - **`ActiveCollisionTypes.DEFAULT` excludes kinematic-vs-fixed** (`DEFAULT` is
 *   15, `ALL` is 60943): a fixed sensor saw zero events from a kinematic body
 *   until `ALL` was set, and two afterwards.
 * - **`version()` throws before `init()`**, and **`IntegrationParameters`
 *   exposes no sleeping thresholds** (its members are `dt`, `contact_erp`,
 *   `lengthUnit`, `normalizedAllowedLinearError`, `normalizedPredictionDistance`,
 *   `numSolverIterations`, `numInternalPgsIterations`, `minIslandSize`,
 *   `maxCcdSubsteps`, `contact_natural_frequency`).
 * - **`World` retains the gravity object it is constructed with** and reads it
 *   every step, so this adapter hands it a fresh literal rather than a scratch
 *   buffer.
 * - **`InteractionGroups` is one `u32`**, 16 bits of membership and 16 of
 *   filter, exactly as in 2D.
 * - **Descriptor setters copy.** `RigidBodyDesc.setRotation`, `setAngvel`, and
 *   `setAdditionalMassProperties` copy their arguments rather than retaining
 *   them (measured), which is what lets the conversions below write into reused
 *   scratch records. `Ray`, by contrast, *does* retain its `origin` and `dir`,
 *   so ray casts build fresh literals.
 *
 * ## Where the scene seam is (§37 `syncSceneToSolver` / `syncSolverToScene`)
 *
 * Both are **documented no-ops**, for the same reason as in 2D: Rapier applies
 * every write immediately, so there is no queue for a flush point to flush, and
 * the adapter cannot know what a "scene" is.
 *
 * What the physics package (WP-5.3) needs instead is a *per-handle* accessor
 * seam, and that is `RapierBodyAccess`, declared in `rapier2d-adapter.ts`. That
 * module says the interface may be promoted into `@fourjs/physics` "once the 3D
 * adapter (WP-5.5) has confirmed the shape is dimension-independent". **It is.**
 * This class implements it verbatim — same method names, same signatures, no
 * additions and no omissions — and imports the type rather than restating it, so
 * the two adapters cannot drift. The only reading that changes with the
 * dimension is what the values *mean*: `outRotation` receives a full
 * orientation rather than a pure-Z quaternion, and the angular `Vector3`s are
 * genuine three-axis quantities rather than Z-only ones. Both are already what
 * the interface's types say.
 *
 * ## Events (§29, §6b)
 *
 * Collision, trigger, and sleep events are collected **inside `step`**, right
 * after `world.step`, and buffered; `drainEvents` hands over the buffer. That
 * ordering is forced by Rapier: the `EventQueue` is auto-drained at the start of
 * the next `step`, and contact manifolds (with their per-contact impulses) are
 * only meaningful immediately after the solve. No user callback is ever invoked
 * from here (§37).
 *
 * `collisionstay` **is** emitted by this adapter, derived from a touching-pair
 * map exactly as in 2D — see {@link Rapier3dAdapter.step}.
 *
 * ## Joints (§28, §37; plan P6-1, WP-6.3)
 *
 * This adapter builds all six shipped 3D joint types and implements
 * `SolverJointAccess`, which is what lets `PhysicsWorld.addJoint` accept it.
 * Everything below was **measured against the installed
 * `@dimforge/rapier3d-compat@0.19.3`** — the typings *and* the wasm — on
 * 2026-08-01, not read off documentation. Four findings shape the mapping, and
 * three of them are gaps that are declared rather than papered over:
 *
 * 1. **Rapier reports no joint reaction.** Neither `ImpulseJoint` nor
 *    `RawImpulseJointSet` has a single member matching `impulse`, `reaction`,
 *    `force`, or `torque` (both prototypes enumerated at runtime; the raw set
 *    offers anchors, frames, body handles, contacts-enabled, limits, and the
 *    four `jointConfigureMotor*` entry points, and nothing else). Plan P6-2's
 *    break thresholds therefore cannot be enforced on this solver, so
 *    {@link Rapier3dAdapter.reportsJointReactions} is `false` and
 *    {@link Rapier3dAdapter.getJointReaction} throws `NOT_IMPLEMENTED`. A world
 *    refuses a breakable joint on this adapter instead of accepting a threshold
 *    that would never fire — breakage is staged, dated, and not faked.
 * 2. **A spherical joint has no limits, and per-axis angular limits are not a
 *    cone.** `SphericalImpulseJoint` is not a `UnitImpulseJoint`: it exposes
 *    neither `setLimits` nor `configureMotor*` (verified —
 *    `typeof joint.setLimits === "undefined"`). The only other route is the raw
 *    set's `jointSetLimits(handle, RawJointAxis, min, max)`, which *does* accept
 *    the angular axes — and does not produce a cone. Measured on a ball joint
 *    limited to ±0.3 rad on every angular axis: a swing in a single plane stops
 *    at 0.2998 rad (correct), but a **diagonal** swing reaches **1.1247 rad**,
 *    almost four times the requested half-angle. A cone built that way would be
 *    a wrong simulation, so {@link Rapier3dAdapter.createJoint} **throws
 *    `NOT_IMPLEMENTED`** for a `spherical` descriptor carrying `limits`, and
 *    builds the unlimited ball joint otherwise. `SphericalJointLimits` says
 *    WP-6.3 "verifies that against Rapier and reports honestly if it cannot be
 *    built"; this is that report.
 * 3. **A motor has no effort cap.** `configureMotorVelocity(targetVel, factor)`
 *    forwards to `jointConfigureMotor(handle, axis, targetPos, targetVel,
 *    stiffness, damping)`, and there is **no** `maxForce` anywhere in the JS or
 *    wasm binding. Rapier's `factor` is the motor's *damping gain*: the effort
 *    it applies is proportional to the velocity error, `≈ factor · (targetVel −
 *    currentVel)` under `MotorModel.ForceBased`. §28's `maxTorque`/`maxForce`
 *    is passed as that gain (see {@link Rapier3dAdapter.setJointMotor}), which
 *    makes a stronger motor stronger — measured: a shaft commanded to 4 rad/s
 *    settles at 3.60 rad/s with a gain of 0.1 and at exactly 4 rad/s from a gain
 *    of 1 upwards — but it is **not** the hard cap the field's name promises.
 *    Documented here rather than hidden, and flagged for a later decision.
 * 4. **A motor gain of exactly zero makes the motor rigid.** With
 *    `stiffness = 0` and `damping = 0` Rapier drives the joint to the target
 *    velocity *exactly* (measured: a loaded arm commanded to 3 rad/s reached
 *    2.91 rad/s with a gain of `0`, against 2.99 with a gain of `0.1`), which is
 *    the opposite of what a zero effort cap means. A disabled motor, or one
 *    whose `maxEffort` is `0`, is therefore configured with
 *    `INERT_MOTOR_GAIN` instead — a gain small enough that the motorized
 *    arm's trajectory is *bit-identical* to the same arm with no motor at all
 *    (verified). That is the only honest reading of "a disabled motor exerts
 *    nothing", because Rapier has no way to *remove* a motor once one is set.
 *
 * The parts that map cleanly, each verified by a test in
 * `tests/rapier3d-joints.test.ts`:
 *
 * - `JointData.fixed(anchor1, frame1, anchor2, frame2)` — 3D fixed joints take
 *   two **quaternion frames**, unlike 2D's scalar angles, and Rapier welds the
 *   bodies so that `q₁·frame1` and `q₂·frame2` coincide. Passing the identity
 *   for both would snap the bodies to a *shared* orientation; §28 says they keep
 *   the relative pose they had at creation, so this adapter passes `frame1 =
 *   identity` and `frame2 = conj(q₂)·q₁`, read off the solver's own poses at
 *   `createJoint`. Measured: a lever rotated 90° about +Z keeps its 90° with the
 *   derived frame and is snapped to 0° with the identity one.
 * - `JointData.revolute(anchor1, anchor2, axis)` /
 *   `JointData.prismatic(anchor1, anchor2, axis)` — **one** axis for both
 *   bodies, which is Rapier's model, not a simplification made here: the
 *   descriptor's `bodyA`-local axis is used as each body's local axis, so two
 *   bodies that are not co-oriented at creation will be aligned by the solver.
 *   Pose the mechanism before adding the joint, which `joints.ts` already says.
 * - `JointData.rope(length, anchor1, anchor2)` — measured: a rope of
 *   `maxLength = 1.5` holds the anchors at 1.500000 m and never further.
 * - `JointData.spring(restLength, stiffness, damping, anchor1, anchor2)` —
 *   measured: a 1 kg bob on `k = 100 N/m` oscillates with a period of 0.62879 s
 *   against the closed form's 0.62832 s (0.07%), and `c = 20 N·s/m` is exactly
 *   the critical damping `2√(km)` the closed form predicts.
 * - `JointData.spherical(anchor1, anchor2)` — three swing degrees of freedom;
 *   measured against a revolute joint on the same rig, the ball swings in both
 *   the XZ and XY planes where the hinge swings in one.
 * - `UnitImpulseJoint.setLimits(min, max)` on revolute and prismatic joints
 *   only, live and after creation; measured to clamp a hinge at its bound
 *   (−0.5043 rad against a −0.5 limit, one solver iteration of overshoot).
 * - Joint state **survives `World.takeSnapshot`/`restoreSnapshot`**: handles,
 *   limits, and motors all come back, and 60 further steps reproduce the
 *   original continuation exactly (max |Δx| = 0). The envelope carries this
 *   adapter's joint registry beside them — see
 *   {@link Rapier3dAdapter.createSnapshot}.
 * - `World.removeRigidBody` **removes the joints attached to that body**
 *   (measured: the joint set empties), so {@link Rapier3dAdapter.destroyBody}
 *   forgets their records rather than leaving handles pointing at nothing.
 */

import { FourError } from "@fourjs/core";
import { Quaternion, Vector3 } from "@fourjs/math";
import type { Matrix3 } from "@fourjs/math";
import {
  ALL_COLLISION_GROUPS,
  DEFAULT_FRICTION,
  DEFAULT_RESTITUTION,
  DETERMINISM_LEVELS,
  passesQueryFilter,
  resolveDensity,
  resolveGravity,
  resolveQueryOptions,
  resolveSleepingConfig,
  sortHitsByDistance,
  validateColliderDescriptor,
  validateJointDescriptor,
  validatePhysicsWorldOptions,
  validateQueryShape,
  validateRigidBodyDescriptor,
  rejectStalePhysicsHandle,
} from "@fourjs/physics";
import type {
  AngularVelocityInput,
  BodyType,
  CCDMode,
  ColliderDescriptor,
  ContactPoint,
  JointDescriptor,
  OverlapHit,
  OverlapQuery,
  PhysicsBodyHandle,
  PhysicsCapabilities,
  PhysicsColliderHandle,
  PhysicsDimension,
  PhysicsEvent,
  PhysicsEventInterest,
  PhysicsJointHandle,
  PhysicsSolverAdapter,
  PhysicsWorldOptions,
  PointHit,
  PointQuery,
  QueryCandidate,
  RaycastHit,
  RaycastQuery,
  ResolvedQueryOptions,
  RigidBodyDescriptor,
  RotationInput,
  ShapeCastHit,
  ShapeCastQuery,
  ShippedJointType,
  SleepingConfig,
  SolverBodyTuningAccess,
  SolverJointAccess,
  SolverJointMotor,
  Vector3Input,
} from "@fourjs/physics";

import { resolveCcdMode } from "./ccd.js";
import {
  createRapierColliderDesc3d,
  createRapierRotation3,
  createRapierShape3d,
  createRapierVector3,
  fromRapierRotation3,
  fromRapierVector3,
  packInteractionGroups3d,
  rotateVectorByRotation3,
  toPrincipalInertia3d,
  toRapierAngularVector3,
  toRapierBodyType3d,
  toRapierRotation3,
  toRapierVector3,
} from "./conversions3d.js";
import { initializeRapier3d } from "./init.js";
import type {
  Rapier3dModule,
  RapierCollider3d,
  RapierColliderDesc3d,
  RapierEventQueue3d,
  RapierRigidBody3d,
  RapierRigidBodyDesc3d,
  RapierRotation3,
  RapierVector3,
  RapierWorld3d,
} from "./init.js";
import type { RapierBodyAccess } from "./rapier2d-adapter.js";

/** See `@fourjs/physics`: §89 has no physics-input code, so misuse is this. */
const ADAPTER_ERROR_CODE = "INVALID_APPLICATION_STATE";

/** §37 `name`. Recorded in snapshots and replays, which refuse other solvers. */
const ADAPTER_NAME = "rapier3d";

/** The one §21 dimension this adapter simulates. */
const ADAPTER_DIMENSION = "3d";

/**
 * Prediction distance, in world units, used for `"speculative"` CCD (§31).
 *
 * Rapier's soft-CCD *is* speculative contact generation, but it is parameterized
 * by a distance and §31's `CCDMode` carries no parameter. One metre is the
 * adapter's choice, matching the 2D adapter's so the two dimensions behave the
 * same for the same descriptor: generous enough for the slow-but-thin and
 * moderately fast cases soft-CCD exists for, small enough that the broad-phase
 * cost stays bounded in a metre-scale world (§40). Since 2026-08-04 this is
 * only the **default**: WP-5.4's recorded follow-up (carried into WP-5.5)
 * landed as `RigidBodyDescriptor.ccdPredictionDistance`, which overrides it
 * per body.
 */
const SOFT_CCD_PREDICTION_DISTANCE = 1;

/** Ray and shape casts treat shapes as plain (§30): a cast from inside hits. */
const QUERY_SOLID = true;

/** `castShape` reports a hit as soon as the shapes touch, not before (§30). */
const SHAPE_CAST_TARGET_DISTANCE = 0;

/**
 * The identity `angularInertiaLocalFrame` handed to Rapier's 3D mass API.
 *
 * §23's `inertiaTensor` is accepted only when it is diagonal (see
 * `toPrincipalInertia3d`), and a diagonal tensor is already expressed in its
 * principal axes — so the frame that relates the two is the identity, always.
 * Rapier copies the record, so one frozen constant is safe to share.
 */
const IDENTITY_INERTIA_FRAME: RapierRotation3 = Object.freeze({
  x: 0,
  y: 0,
  z: 0,
  w: 1,
});

/**
 * The motor gain that stands for "this motor exerts nothing" (WP-6.3).
 *
 * Rapier has no way to *remove* a motor once one has been configured, and a
 * gain of exactly `0` is its rigid special case rather than its inert one (see
 * finding 4 in the module header). This value is the inert end of the same
 * dial: measured at 3D 0.19.3, an arm whose hinge motor is configured with
 * `configureMotorVelocity(3, 1e-12)` follows a trajectory **bit-identical** to
 * the same arm with no motor configured at all, over 240 steps. It is used for
 * a disabled motor and for one whose `maxEffort` is `0`.
 */
const INERT_MOTOR_GAIN = 1e-12;

/**
 * The default anchor of a §28 joint: the body's own origin
 * ({@link JointDescriptorBase}'s documented meaning of an omitted anchor).
 *
 * Frozen because it is shared by every `createJoint` that omits an anchor and
 * is only ever read.
 */
const ORIGIN: Vector3 = Object.freeze(new Vector3(0, 0, 0));

/**
 * `RevoluteJointDescriptor`'s `"2d"` default axis (§21).
 *
 * Unreachable in a `"3d"` world — `validateJointDescriptor` rejects a 3D
 * revolute joint that names no axis — and present so that the descriptor-to-
 * Rapier mapping is total rather than resting on an assertion.
 */
const PLUS_Z: Vector3 = Object.freeze(new Vector3(0, 0, 1));

/* ------------------------------------------------------------------------- *
 * Transcribed Rapier 3D joint surface — module-private (WP-6.3).             *
 * ------------------------------------------------------------------------- *
 *
 * `init.ts` holds this package's transcription of the Rapier surface and
 * explains at length why one exists at all (0.19.3's own `.d.ts` files do not
 * resolve under `moduleResolution: NodeNext`). The joint half is declared
 * **here** rather than there for one reason only: WP-6.2 is editing `init.ts`
 * in the same wave for the 2D adapter, and two packets editing one file is how
 * a conflict is made. These interfaces follow that module's rules exactly —
 * transcribed member for member from the installed
 * `@dimforge/rapier3d-compat@0.19.3` declaration files, with the source file
 * named on each block, covering only what this adapter calls, and every member
 * exercised against the real wasm by `tests/rapier3d-joints.test.ts`. **They
 * belong in `init.ts` beside the rest of the 3D surface and should be moved
 * there once WP-6.2 has landed** (reported with this packet).
 */

/** `dynamics/impulse_joint.d.ts`: `JointData`, opaque between build and use. */
type RapierJointData3d = object;

/**
 * `dynamics/impulse_joint.d.ts`: the members of `ImpulseJoint` this adapter
 * calls — the base class every joint type shares.
 */
interface RapierImpulseJoint3d {
  readonly handle: number;
  setContactsEnabled(enabled: boolean): void;
  setAnchor1(newPos: { x: number; y: number; z: number }): void;
  setAnchor2(newPos: { x: number; y: number; z: number }): void;
}

/**
 * `dynamics/impulse_joint.d.ts`: `UnitImpulseJoint`, the base of
 * `RevoluteImpulseJoint` and `PrismaticImpulseJoint` — the only two joint
 * classes in the 0.19.3 build that carry limits and motors.
 *
 * `FixedImpulseJoint`, `RopeImpulseJoint`, `SpringImpulseJoint`,
 * `GenericImpulseJoint`, and `SphericalImpulseJoint` all extend `ImpulseJoint`
 * directly and have none of these members (verified at runtime:
 * `typeof sphericalJoint.setLimits === "undefined"`).
 */
interface RapierUnitImpulseJoint3d extends RapierImpulseJoint3d {
  setLimits(min: number, max: number): void;
  configureMotorModel(model: number): void;
  configureMotorVelocity(targetVelocity: number, factor: number): void;
}

/**
 * `pipeline/world.d.ts`: the three joint members of `World`.
 *
 * `getImpulseJoint` is declared **non-nullable** because that is how
 * `world.d.ts` declares it, and transcription follows the declaration. Note
 * that the implementation delegates to `ImpulseJointSet.get`, whose own
 * declaration *is* `ImpulseJoint | null`, and that an unknown handle returns a
 * live-looking object with `handle === 0` rather than `null` (measured). This
 * adapter therefore only ever passes handles from its own registry.
 *
 * The one place a handle can arrive from *outside* that registry is a restored
 * §34 snapshot envelope, whose joint table is JSON an attacker or a bad merge
 * can have edited. `#rebuildRegistries` widens the return type back to
 * `| null | undefined` there and rejects anything whose `handle` does not match
 * the handle it asked for, so a corrupt envelope raises the §34 "the envelope
 * and its Rapier bytes do not belong together" error instead of installing a
 * joint record pointing at joint zero (2026-08-06).
 */
interface RapierJointWorld3d {
  createImpulseJoint(
    params: RapierJointData3d,
    parent1: RapierRigidBody3d,
    parent2: RapierRigidBody3d,
    wakeUp: boolean,
  ): RapierImpulseJoint3d;
  getImpulseJoint(handle: number): RapierImpulseJoint3d;
  removeImpulseJoint(joint: RapierImpulseJoint3d, wakeUp: boolean): void;
}

/**
 * `dynamics/impulse_joint.d.ts`: the `JointData` factories and the `MotorModel`
 * enum, as they hang off the module namespace.
 *
 * Argument orders are upstream's and are the reason each is named here: a 3D
 * `fixed` takes a quaternion frame after *each* anchor, `spring` leads with its
 * three scalars, `rope` leads with its length, and `revolute`/`prismatic` take
 * one axis that serves both bodies.
 */
interface RapierJointModule3d {
  readonly MotorModel: {
    readonly AccelerationBased: number;
    readonly ForceBased: number;
  };
  readonly JointData: {
    fixed(
      anchor1: RapierVector3,
      frame1: RapierRotation3,
      anchor2: RapierVector3,
      frame2: RapierRotation3,
    ): RapierJointData3d;
    spring(
      restLength: number,
      stiffness: number,
      damping: number,
      anchor1: RapierVector3,
      anchor2: RapierVector3,
    ): RapierJointData3d;
    rope(
      length: number,
      anchor1: RapierVector3,
      anchor2: RapierVector3,
    ): RapierJointData3d;
    spherical(
      anchor1: RapierVector3,
      anchor2: RapierVector3,
    ): RapierJointData3d;
    prismatic(
      anchor1: RapierVector3,
      anchor2: RapierVector3,
      axis: RapierVector3,
    ): RapierJointData3d;
    revolute(
      anchor1: RapierVector3,
      anchor2: RapierVector3,
      axis: RapierVector3,
    ): RapierJointData3d;
  };
}

/**
 * What this adapter can actually do (§37), field by field:
 *
 * - `dimensions: ["3d"]` — this class wraps `@dimforge/rapier3d-compat`; the 2D
 *   build is a separate npm package and a separate adapter.
 * - `jointTypes` — every one of plan P6-1's six shipped types, which in a
 *   `"3d"` world is all of them (`SHIPPED_JOINT_TYPES_3D`), listed literally so
 *   that a later widening of the engine's tier cannot silently enrol this
 *   adapter in a type it does not build. Two caveats live in the joint section
 *   of the module header rather than in this list, because `jointTypes` is
 *   `string[]` (§37) and has nowhere to put them: a `spherical` joint ships
 *   **without** limit support (a limited one is refused, loudly), and a motor's
 *   `maxTorque`/`maxForce` reaches Rapier as a gain rather than as a cap.
 * - `ccdModes` — all three. `"swept"` is Rapier's `RigidBodyDesc.setCcdEnabled`
 *   (motion clamping with `World.maxCcdSubsteps` substeps); `"speculative"` is
 *   `setSoftCcdPrediction` (predictive contacts, see
 *   {@link SOFT_CCD_PREDICTION_DISTANCE}); `"disabled"` is neither, and is
 *   always available. Both entry points exist in the 3D build (verified).
 * - `determinism: "same-runtime"` — Appendix A's target and what Rapier's wasm
 *   gives here: the same build on the same engine reproduces a run exactly
 *   (proven by test). Nothing stronger is claimed: this adapter's own
 *   conversions use JavaScript `Math.sin`/`Math.cos` (for the scalar-angle
 *   rotation form), whose results are not specified across engines, which is
 *   exactly what `"same-platform"` forbids.
 * - `snapshots: true` — `World.takeSnapshot` / `World.restoreSnapshot`, wrapped
 *   in an envelope that carries this adapter's registry too.
 * - `queries` — all four are implemented on Rapier's query entry points. See
 *   {@link Rapier3dAdapter.shapeCast} for the one multiplicity limit.
 * - `tuning` — **all four `false`** (2026-08-06; the fourth added 2026-08-08),
 *   for the same reasons the 2D adapter declares: no rolling or spinning
 *   friction binding in the 3D 0.19.3 build, and no sleeping thresholds
 *   anywhere in `IntegrationParameters` (enumerated at runtime — see this
 *   header's §32 note). `PhysicsWorld` turns the declaration into a
 *   once-per-world warning when such a value is authored;
 *   `SleepingConfig.enabled` *is* honoured and is not part of it.
 *   `jointMotorEffortCap: false` is the odd one out (PH-22e): §28's
 *   `maxTorque`/`maxForce` is *not* dropped here, it is applied as a
 *   `ForceBased` strength gain rather than the hard ceiling §28 describes —
 *   see {@link Rapier3dAdapter.setJointMotor}.
 */
const RAPIER_3D_CAPABILITIES: PhysicsCapabilities = Object.freeze({
  dimensions: Object.freeze<PhysicsDimension[]>([ADAPTER_DIMENSION]),
  jointTypes: Object.freeze<string[]>([
    "fixed",
    "spring",
    "revolute",
    "prismatic",
    "spherical",
    "rope",
  ] satisfies ShippedJointType[]),
  ccdModes: Object.freeze<CCDMode[]>(["disabled", "speculative", "swept"]),
  determinism: "same-runtime",
  snapshots: true,
  queries: Object.freeze({
    raycast: true,
    shapeCast: true,
    overlap: true,
    point: true,
  }),
  tuning: Object.freeze({
    rollingFriction: false,
    spinningFriction: false,
    sleepThresholds: false,
    jointMotorEffortCap: false,
  }),
});

/**
 * `"F4R3"` in ASCII, read as a little-endian `u32` — the first four bytes of
 * every snapshot this adapter produces, so a buffer from somewhere else (a 2D
 * snapshot included, which spells `"F4R2"`) is rejected before it reaches
 * Rapier's deserializer.
 */
const SNAPSHOT_MAGIC = 0x33523446;

/**
 * Version of the snapshot **envelope** (not of Rapier, and not of the physics
 * package). Bumped whenever the header or metadata layout changes.
 *
 * **Version 2 (WP-6.3)** adds the joint registry — `nextJointId` and a
 * `joints` array — to the metadata block; the four-word header is unchanged.
 * The bump is not strictly forced (a version-1 envelope can only have come from
 * an adapter whose `createJoint` threw, so it could never carry a joint), but a
 * metadata schema that changed silently is exactly the kind of thing §34's
 * validity key exists to catch. The 2D adapter's envelope is byte-for-byte the
 * same *layout* and is distinguished by the magic word; its version number
 * moves when its own joints land in WP-6.2.
 */
const SNAPSHOT_FORMAT_VERSION = 2;

/** Four `u32` fields: magic, format version, metadata length, Rapier length. */
const SNAPSHOT_HEADER_BYTES = 16;

/**
 * Decodes and shape-checks the envelope's `meta` JSON (§34). The bytes are
 * content: a malformed or mis-shaped record is `UNTRUSTED_INPUT_REJECTED`,
 * never a `SyntaxError` / `TypeError` escaping from inside the restore.
 */
function parseSnapshotMeta(bytes: Uint8Array): SnapshotMeta {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new FourError(
      "UNTRUSTED_INPUT_REJECTED",
      "Snapshot envelope meta is not valid JSON (§34, §96).",
      { cause: error },
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new FourError(
      "UNTRUSTED_INPUT_REJECTED",
      "Snapshot envelope meta is not an object (§34, §96).",
    );
  }
  const meta = parsed as Record<string, unknown>;
  const ids = [meta["nextBodyId"], meta["nextColliderId"], meta["nextJointId"]];
  if (
    typeof meta["adapter"] !== "string" ||
    typeof meta["version"] !== "string" ||
    ids.some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id < 0)
  ) {
    throw new FourError(
      "UNTRUSTED_INPUT_REJECTED",
      "Snapshot envelope meta is missing a string adapter/version or a non-negative integer id counter (§34, §96).",
    );
  }
  return meta as unknown as SnapshotMeta;
}

/**
 * How a body's mass is decided (§23, §25), resolved once at `createBody` and
 * consumed by every `createCollider` on that body.
 *
 * Rapier's mass model is *additive* — a body's mass is its own additional mass
 * plus the sum of `density × volume` over its colliders — while §23 says an
 * explicit `mass` is authoritative and "overrides the density-derived value".
 * These three modes are how the second is expressed in terms of the first, and
 * they are the same three the 2D adapter resolves; only the triple handed to
 * Rapier differs (a principal-inertia *vector* plus a frame, rather than one
 * scalar moment).
 */
type MassMode =
  /** No explicit mass: every collider contributes `density × volume` (§25). */
  | "collider-density"
  /**
   * Explicit mass, no inertia or centre of mass given. The **first** collider
   * on the body is created with `ColliderDesc.setMass(mass)` so Rapier derives
   * the rotational inertia from that collider's geometry — which is the
   * physically meaningful answer — and every later collider is created massless
   * (`density = 0`). A body in this mode with no collider at all has no mass,
   * exactly as Rapier reports it.
   */
  | "first-collider"
  /**
   * Explicit mass **with** an inertia tensor or a centre of mass. The body
   * carries the whole quadruple through `setAdditionalMassProperties`, and every
   * collider is created massless so nothing is added on top.
   */
  | "body";

/** One body in the adapter's registry. Handles are these records, cast. */
interface BodyRecord {
  /** Monotonic engine-assigned id — the §33 ordering key. Never reused. */
  readonly id: number;
  /** Rapier's own handle. Opaque, non-integral, and reused after removal. */
  rapierHandle: number;
  /** The live Rapier body. Re-pointed by `restoreSnapshot`. */
  body: RapierRigidBody3d;
  /** Last observed `isSleeping()`, for §32's sleep/wake transitions. */
  sleeping: boolean;
  /** How this body's mass is composed. See `MassMode`. */
  massMode: MassMode;
  /** The §23 `mass`, when one was given. */
  explicitMass: number;
  /**
   * Ids of this body's live colliders, in ascending (creation) order — the
   * `"first-collider"` mass mode reads both its length and its head
   * (2026-08-07; a bare `colliderCount` stood here until then, which forced
   * `#firstColliderOf` to scan every collider in the world to find the body's
   * own).
   *
   * Maintained in exactly two places: `createCollider` appends, and
   * `#forgetCollider` removes. Ids are monotonic and never reused, so appending
   * keeps the list sorted and removal preserves that.
   */
  readonly colliderIds: number[];
  /** `false` once destroyed; a handle to a dead record is rejected. */
  alive: boolean;
}

/** One collider in the adapter's registry. Handles are these records, cast. */
interface ColliderRecord {
  /** Monotonic engine-assigned id — the ordering key, as for bodies. */
  readonly id: number;
  /** Rapier's own handle. */
  rapierHandle: number;
  /** The live Rapier collider. Re-pointed by `restoreSnapshot`. */
  collider: RapierCollider3d;
  /** The {@link BodyRecord.id} of the owning body (§24, §37). */
  bodyId: number;
  /** §24 `sensor`. Kept here because §30's filter needs it per candidate. */
  sensor: boolean;
  /** §24 `collisionGroups`, as given — 32 bits, before Rapier's packing. */
  collisionGroups: number;
  /** §24 `collisionMask`, as given. */
  collisionMask: number;
  /** `false` once destroyed. */
  alive: boolean;
}

/** One joint in the adapter's registry (§28). Handles are these records, cast. */
interface JointRecord {
  /** Monotonic engine-assigned id — the §33 ordering key. Never reused. */
  readonly id: number;
  /** Rapier's own handle. Opaque and non-integral, exactly as for bodies. */
  rapierHandle: number;
  /** The live Rapier joint. Re-pointed by `restoreSnapshot`. */
  joint: RapierImpulseJoint3d;
  /**
   * Which §28 constraint this is, kept because Rapier's own `type()` reports a
   * `spherical` joint as `Generic` (measured) and because `setJointLimits` and
   * `setJointMotor` have to name the type they are refusing.
   *
   * Mutable so that `restoreSnapshot` can re-assert it from the envelope, as
   * every other restored field is (2026-08-06); nothing else writes it.
   */
  type: ShippedJointType;
  /** {@link BodyRecord.id} of `bodyA` — `destroyBody` retires the joint by it. */
  bodyIdA: number;
  /** {@link BodyRecord.id} of `bodyB`. Restored from the envelope like `type`. */
  bodyIdB: number;
  /** `false` once destroyed; a handle to a dead record is rejected. */
  alive: boolean;
}

/** A collider pair currently touching, tracked so `collisionstay` can exist. */
interface PairRecord {
  readonly a: ColliderRecord;
  readonly b: ColliderRecord;
  /** Whether either side is a sensor, i.e. whether this is a §29 trigger pair. */
  readonly trigger: boolean;
}

/**
 * The registry half of a snapshot, stored beside Rapier's own bytes.
 *
 * JSON rather than a packed binary block: it is a few hundred bytes next to
 * Rapier's kilobytes, and a snapshot that can be read in a debugger is worth
 * more than one that saves 200 bytes. Rapier handles are non-integral doubles
 * (see the module header); `JSON` round-trips them exactly.
 */
interface SnapshotMeta {
  /** Must equal {@link ADAPTER_NAME} (§34: snapshots are solver-specific). */
  readonly adapter: string;
  /** The Rapier version that produced it (§34's validity key). */
  readonly version: string;
  /** Next monotonic body id, so ids keep increasing across a restore. */
  readonly nextBodyId: number;
  /** Next monotonic collider id. */
  readonly nextColliderId: number;
  /** Next monotonic joint id (§28, envelope version 2). */
  readonly nextJointId: number;
  /**
   * Bodies in insertion order:
   * `[id, rapierHandle, sleeping, massMode, explicitMass, colliderCount]`.
   *
   * The trailing count is part of the pinned format-version-2 layout and is
   * still written; the restore path re-derives each body's collider ids from
   * {@link SnapshotMeta.colliders} instead of reading it (2026-08-07).
   */
  readonly bodies: readonly [
    number,
    number,
    boolean,
    MassMode,
    number,
    number,
  ][];
  /** Colliders in insertion order: `[id, rapierHandle, bodyId, sensor, groups, mask]`. */
  readonly colliders: readonly [
    number,
    number,
    number,
    boolean,
    number,
    number,
  ][];
  /**
   * Joints in insertion order: `[id, rapierHandle, type, bodyIdA, bodyIdB]`
   * (§28, envelope version 2).
   *
   * The joints themselves — their anchors, axes, limits, and motors — are
   * Rapier's business and travel in its own bytes, which carry them faithfully
   * (measured: limits and motors both come back). What Rapier does not know is
   * this adapter's monotonic ids and which §28 type each handle *was*, since it
   * reports a spherical joint as `Generic`.
   */
  readonly joints: readonly [
    number,
    number,
    ShippedJointType,
    number,
    number,
  ][];
}

/**
 * A `PhysicsSolverAdapter` (§37) backed by Rapier 3D.
 *
 * ```ts
 * const adapter = new Rapier3dAdapter();
 * await adapter.initialize({ dimension: "3d", gravity: new Vector3(0, -9.81, 0) });
 * const body = adapter.createBody({ type: "dynamic", position: new Vector3(0, 5, 0) });
 * adapter.createCollider({ body, shape: { type: "sphere", radius: 0.5 } });
 * adapter.step(1 / 60);
 * const events = adapter.drainEvents();
 * adapter.dispose();
 * ```
 *
 * One instance owns exactly one Rapier `World`. `initialize` may be called once;
 * `dispose` is idempotent and terminal.
 */
export class Rapier3dAdapter
  implements
    PhysicsSolverAdapter,
    RapierBodyAccess,
    SolverBodyTuningAccess,
    SolverJointAccess
{
  /** §37 `name`. */
  readonly name: string = ADAPTER_NAME;

  /** §37 `capabilities`. Readable before `initialize`, and frozen. */
  readonly capabilities: PhysicsCapabilities = RAPIER_3D_CAPABILITIES;

  /**
   * `SolverJointAccess.reportsJointReactions` — **`false`** for Rapier 0.19.3
   * (plan P6-2, finding 1 in the module header).
   *
   * Not a shortcut and not a to-do: the 3D build exposes no joint impulse, no
   * joint reaction, and no joint force anywhere in its typed surface or its raw
   * wasm surface (both prototypes enumerated at runtime on 2026-08-01). A world
   * reads this flag and refuses to register a joint carrying `breakForce` or
   * `breakTorque` rather than accepting a threshold this adapter could never
   * enforce.
   */
  readonly reportsJointReactions = false;

  #rapier: Rapier3dModule | undefined;

  #world: RapierWorld3d | undefined;

  #eventQueue: RapierEventQueue3d | undefined;

  #version = "";

  #sleeping: SleepingConfig = resolveSleepingConfig();

  #initializeStarted = false;

  #disposed = false;

  #nextBodyId = 1;

  #nextColliderId = 1;

  #nextJointId = 1;

  /** Live bodies keyed by monotonic id. `Map` iteration is insertion order. */
  readonly #bodies = new Map<number, BodyRecord>();

  /** Live colliders keyed by monotonic id. */
  readonly #colliders = new Map<number, ColliderRecord>();

  /** Live joints keyed by monotonic id, in creation order (§28, §33). */
  readonly #joints = new Map<number, JointRecord>();

  /** Reverse index for event handling: Rapier body handle → record. */
  readonly #bodiesByRapierHandle = new Map<number, BodyRecord>();

  /** Reverse index for event handling: Rapier collider handle → record. */
  readonly #collidersByRapierHandle = new Map<number, ColliderRecord>();

  /** Pairs currently touching, keyed by `"idA|idB"` with `idA < idB`. */
  readonly #activePairs = new Map<string, PairRecord>();

  /** Events collected during the last `step`, handed over by `drainEvents`. */
  #pendingEvents: PhysicsEvent[] = [];

  /** Flat `[a, b, a, b, …]` scratch for the pairs that started this step. */
  readonly #startedPairs: ColliderRecord[] = [];

  /** Flat `[a, b, a, b, …]` scratch for the pairs that stopped this step. */
  readonly #stoppedPairs: ColliderRecord[] = [];

  /** Keys of the pairs that stopped this step, so `stay` can skip them. */
  readonly #stoppedKeys = new Set<string>();

  /**
   * Whether `collisionstay` events are synthesised for touching pairs (see
   * `PhysicsSolverAdapter.setEventInterest`). `true` until a world says
   * otherwise, so an adapter driven directly keeps reporting everything.
   */
  #stayEvents = true;

  readonly #scratchVector3 = new Vector3();

  readonly #scratchQuaternion = new Quaternion();

  readonly #scratchRapierA: RapierVector3 = createRapierVector3();

  readonly #scratchRapierB: RapierVector3 = createRapierVector3();

  readonly #scratchRapierRotation: RapierRotation3 = createRapierRotation3();

  /**
   * §37 `version` — Rapier's own version string, once it is known.
   *
   * Empty until {@link Rapier3dAdapter.initialize} resolves, because the value
   * lives *inside* the wasm module: calling `version()` before `init()` throws
   * a `TypeError` from the bindings (verified at 3D 0.19.3). This adapter would
   * rather report "not known yet" than invent a number that §34 will bake into
   * a snapshot's validity key.
   */
  get version(): string {
    return this.#version;
  }

  /**
   * Creates the Rapier world (§37).
   *
   * Loads the wasm module (once per process — see `init.ts`), then builds a
   * `World` with the §21-resolved gravity. Options are validated with
   * `@fourjs/physics`'s own validators, so this adapter accepts exactly what the
   * engine accepts and no more.
   *
   * ## §32 sleeping: what maps, and what does not
   *
   * `SleepingConfig.enabled` maps to `RigidBodyDesc.setCanSleep`, applied to
   * every body this adapter creates. `linearThreshold`, `angularThreshold`, and
   * `timeThreshold` **do not map**: `IntegrationParameters` in the 3D 0.19.3
   * build exposes no sleeping thresholds at all (verified by enumerating the
   * prototype — see the module header for the full member list). Rapier's
   * thresholds are compiled into the wasm. The adapter therefore honours the
   * on/off switch and leaves the three thresholds unimplemented rather than
   * pretending — and says so in `capabilities.tuning.sleepThresholds`, which is
   * what makes `PhysicsWorld` warn about an authored threshold instead of
   * dropping it silently (2026-08-06).
   */
  async initialize(options: PhysicsWorldOptions): Promise<void> {
    this.#assertNotDisposed();
    if (this.#initializeStarted) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        "Rapier3dAdapter.initialize was called twice; one adapter owns one world (§37). Create a second adapter instead.",
      );
    }
    this.#initializeStarted = true;

    validatePhysicsWorldOptions(options);
    if (options.dimension !== ADAPTER_DIMENSION) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `Rapier3dAdapter simulates "3d" worlds only; got ${JSON.stringify(options.dimension)} (§21, §37). Use the 2D Rapier adapter for a "2d" world.`,
        { context: { dimension: options.dimension } },
      );
    }
    if (
      options.determinism !== undefined &&
      DETERMINISM_LEVELS.indexOf(options.determinism) >
        DETERMINISM_LEVELS.indexOf(RAPIER_3D_CAPABILITIES.determinism)
    ) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `Rapier3dAdapter declares determinism ${JSON.stringify(RAPIER_3D_CAPABILITIES.determinism)} and the world asked for ${JSON.stringify(options.determinism)} (§33, §37).`,
        { context: { requested: options.determinism } },
      );
    }

    const rapier = await initializeRapier3d();
    const gravity = resolveGravity(
      ADAPTER_DIMENSION,
      options.gravity,
      this.#scratchVector3,
    );
    this.#rapier = rapier;
    this.#version = rapier.version();
    this.#sleeping = resolveSleepingConfig(options.sleeping);
    // A fresh object, never a scratch buffer: Rapier's `World` *retains* the
    // vector it is constructed with as its live `gravity` field and reads it on
    // every step (verified at 3D 0.19.3 — mutating the literal afterwards
    // changed the world's gravity), so handing it a reused buffer would let the
    // next position conversion silently rewrite the world's gravity.
    this.#world = new rapier.World({
      x: gravity.x,
      y: gravity.y,
      z: gravity.z,
    });
    if (options.solverIterations !== undefined) {
      // §28 solver iterations, world-level (2026-08-04) — see the 2D adapter.
      this.#world.numSolverIterations = options.solverIterations;
    }
    this.#eventQueue = new rapier.EventQueue(true);
  }

  /**
   * Creates a body (§37, §22, §23).
   *
   * §22's four types map to Rapier's `Fixed`, `Dynamic`,
   * `KinematicPositionBased`, and `KinematicVelocityBased`. Position, rotation,
   * both velocities, both damping coefficients, and `gravityScale` are applied
   * from the descriptor; §31's CCD mode is resolved from the §23 boolean and the
   * §31 mode together, exactly as `RigidBodyDescriptor.ccdMode` documents.
   *
   * ## Mass and inertia (§23, §25)
   *
   * Rapier composes a body's mass additively, so an explicit `mass` cannot
   * simply be handed to `RigidBodyDesc`: additional mass is *added to* whatever
   * the colliders contribute. §23 says `mass` is authoritative, so the adapter
   * resolves one of three `MassMode`s here and every `createCollider` on
   * this body honours it. In particular, an explicit `mass` with no inertia
   * tensor is carried by the body's *first* collider through
   * `ColliderDesc.setMass`, which gives the requested mass **and** a
   * geometry-derived inertia tensor — measured: a unit cube at `setMass(7)`
   * reports mass 7 and principal inertia (1.1667, 1.1667, 1.1667).
   *
   * The 3D-only wrinkle is the inertia tensor. Rapier wants three principal
   * moments plus the frame they are expressed in, where §23 offers a full
   * `Matrix3`; `toPrincipalInertia3d` accepts a **diagonal** tensor (exact, with
   * the identity frame) and rejects anything else rather than guessing. See its
   * documentation for why an eigendecomposition was not the right answer for
   * this phase.
   *
   * A `centerOfMass` or `inertiaTensor` **without** a `mass` is rejected:
   * Rapier can only set the whole quadruple, and silently dropping the one the
   * caller did supply is the kind of quiet substitution §85 exists to prevent.
   */
  createBody(desc: RigidBodyDescriptor): PhysicsBodyHandle {
    const world = this.#requireWorld();
    const rapier = this.#requireRapier();
    validateRigidBodyDescriptor(desc, ADAPTER_DIMENSION);

    const rigidBodyDesc: RapierRigidBodyDesc3d = new rapier.RigidBodyDesc(
      toRapierBodyType3d(desc.type),
    );

    if (desc.position !== undefined) {
      const position = toRapierVector3(
        "position",
        desc.position,
        this.#scratchRapierA,
      );
      rigidBodyDesc.setTranslation(position.x, position.y, position.z);
    }
    if (desc.rotation !== undefined) {
      rigidBodyDesc.setRotation(
        toRapierRotation3(
          desc.rotation,
          this.#scratchQuaternion,
          this.#scratchRapierRotation,
        ),
      );
    }
    if (desc.linearVelocity !== undefined) {
      const velocity = toRapierVector3(
        "linearVelocity",
        desc.linearVelocity,
        this.#scratchRapierA,
      );
      rigidBodyDesc.setLinvel(velocity.x, velocity.y, velocity.z);
    }
    if (desc.angularVelocity !== undefined) {
      rigidBodyDesc.setAngvel(
        toRapierAngularVector3(
          desc.angularVelocity,
          this.#scratchVector3,
          this.#scratchRapierA,
        ),
      );
    }
    if (desc.linearDamping !== undefined) {
      rigidBodyDesc.setLinearDamping(desc.linearDamping);
    }
    if (desc.angularDamping !== undefined) {
      rigidBodyDesc.setAngularDamping(desc.angularDamping);
    }
    if (desc.gravityScale !== undefined) {
      rigidBodyDesc.setGravityScale(desc.gravityScale);
    }
    rigidBodyDesc.setCanSleep(this.#sleeping.enabled);

    const ccdMode = resolveCcdMode(desc);
    if (ccdMode === "swept") {
      rigidBodyDesc.setCcdEnabled(true);
    } else if (ccdMode === "speculative") {
      rigidBodyDesc.setSoftCcdPrediction(
        desc.ccdPredictionDistance ?? SOFT_CCD_PREDICTION_DISTANCE,
      );
    }

    const massMode = resolveMassMode(desc);
    const explicitMass = desc.mass ?? 0;
    if (massMode === "body") {
      const centerOfMass = toRapierVector3(
        "centerOfMass",
        desc.centerOfMass ?? this.#scratchVector3.set(0, 0, 0),
        this.#scratchRapierA,
      );
      const principalInertia = this.#scratchRapierB;
      if (desc.inertiaTensor === undefined) {
        principalInertia.x = 0;
        principalInertia.y = 0;
        principalInertia.z = 0;
      } else {
        toPrincipalInertia3d(desc.inertiaTensor, principalInertia);
      }
      rigidBodyDesc.setAdditionalMassProperties(
        explicitMass,
        centerOfMass,
        principalInertia,
        IDENTITY_INERTIA_FRAME,
      );
    }

    const body = world.createRigidBody(rigidBodyDesc);
    if (massMode === "body") {
      // `setAdditionalMassProperties` is otherwise not visible in `mass()` until
      // the first step (measured at 3D 0.19.3), which would make `getBodyMass`
      // report 0 for a freshly created body.
      body.recomputeMassPropertiesFromColliders();
    }

    const record: BodyRecord = {
      id: this.#nextBodyId,
      rapierHandle: body.handle,
      body,
      sleeping: body.isSleeping(),
      massMode,
      explicitMass,
      colliderIds: [],
      alive: true,
    };
    this.#nextBodyId += 1;
    this.#bodies.set(record.id, record);
    this.#bodiesByRapierHandle.set(record.rapierHandle, record);
    return record as unknown as PhysicsBodyHandle;
  }

  /**
   * Destroys a body and everything attached to it (§37).
   *
   * Rapier removes the body's colliders **and its joints** with it (both
   * measured), so their records are dropped here too, along with any contact
   * pair they were part of. The monotonic id is *not* reused, which is what
   * keeps {@link Rapier3dAdapter.forEachBody}'s order stable under destruction
   * (§33).
   *
   * `@fourjs/physics` destroys a joint before either of its bodies (§83), so this
   * path is reached only by a caller driving the adapter directly; it exists so
   * that such a caller is left with a registry that matches the solver rather
   * than with joint handles pointing at a constraint Rapier has already freed.
   */
  destroyBody(handle: PhysicsBodyHandle): void {
    const world = this.#requireWorld();
    const record = this.#requireBody(handle);

    for (const joint of [...this.#joints.values()]) {
      if (joint.bodyIdA === record.id || joint.bodyIdB === record.id) {
        this.#forgetJoint(joint);
      }
    }
    for (const collider of [...this.#colliders.values()]) {
      if (collider.bodyId === record.id) {
        this.#forgetCollider(collider);
      }
    }

    world.removeRigidBody(record.body);
    record.alive = false;
    this.#bodies.delete(record.id);
    this.#bodiesByRapierHandle.delete(record.rapierHandle);
  }

  /**
   * Creates a collider on `desc.body` (§37, §24, §25).
   *
   * The full §24 3D shape list — sphere, box, capsule, cylinder, cone, convex
   * hull, triangle mesh, height field — maps to `ColliderDesc.ball`,
   * `.cuboid`, `.capsule`, `.cylinder`, `.cone`, `.convexHull`, `.trimesh`,
   * and `.heightfield`; see `conversions3d.ts` for the capsule/cylinder/cone
   * axis, the hull's degeneracy verdict, and the height field's
   * samples-versus-subdivisions conversion. §24's `compound` is several
   * colliders on one body, which needs nothing here (PH-22a).
   *
   * Friction and restitution come from the explicit fields, then the material,
   * then `@fourjs/physics`'s defaults. Their **combine rules** are set to
   * Appendix A's — friction `Average`, restitution `Max` — because Rapier's own
   * default for restitution is `Average`, which would quietly contradict §25 for
   * every contact in the world. §25's `rollingFriction` and `spinningFriction`
   * have no Rapier 3D binding at 0.19.3 and cannot be applied here — declared
   * in `capabilities.tuning`, so a `PhysicsWorld` registering a collider that
   * carries one warns rather than dropping it in silence (2026-08-06).
   *
   * `collisionGroups`/`collisionMask` are packed into Rapier's single
   * `InteractionGroups` word; `sensor` sets the sensor flag *and* widens
   * `ActiveCollisionTypes` to `ALL`, because Rapier's default excludes
   * kinematic-vs-fixed and fixed-vs-fixed pairs — a static trigger volume would
   * otherwise never notice a kinematic character walking through it (verified in
   * 3D, and a §29 requirement rather than a preference). Solid colliders keep
   * Rapier's default, where those pairs are genuinely uninteresting.
   *
   * `ActiveEvents.COLLISION_EVENTS` is enabled on every collider: §29's five
   * event names are part of the engine's contract, not an opt-in.
   * `CONTACT_FORCE_EVENTS` is deliberately **not** enabled — the contact
   * manifolds read in `step` carry per-contact impulses, which is strictly more
   * information than a contact-force event's summed force and needs no
   * threshold to be configured.
   */
  createCollider(desc: ColliderDescriptor): PhysicsColliderHandle {
    const world = this.#requireWorld();
    const rapier = this.#requireRapier();
    validateColliderDescriptor(desc, ADAPTER_DIMENSION);
    const bodyRecord = this.#requireBody(desc.body);

    const colliderDesc: RapierColliderDesc3d = createRapierColliderDesc3d(
      desc.shape,
    );

    if (desc.offset !== undefined) {
      const offset = toRapierVector3(
        "offset.position",
        desc.offset.position,
        this.#scratchRapierA,
      );
      colliderDesc.setTranslation(offset.x, offset.y, offset.z);
      colliderDesc.setRotation(
        toRapierRotation3(
          desc.offset.rotation,
          this.#scratchQuaternion,
          this.#scratchRapierRotation,
        ),
      );
    }

    colliderDesc.setFriction(
      desc.friction ?? desc.material?.friction ?? DEFAULT_FRICTION,
    );
    colliderDesc.setRestitution(
      desc.restitution ?? desc.material?.restitution ?? DEFAULT_RESTITUTION,
    );
    colliderDesc.setFrictionCombineRule(rapier.CoefficientCombineRule.Average);
    colliderDesc.setRestitutionCombineRule(rapier.CoefficientCombineRule.Max);

    applyColliderMass(colliderDesc, desc, bodyRecord);

    const sensor = desc.sensor ?? false;
    colliderDesc.setSensor(sensor);
    if (sensor) {
      colliderDesc.setActiveCollisionTypes(rapier.ActiveCollisionTypes.ALL);
    }
    colliderDesc.setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS);

    const collisionGroups = desc.collisionGroups ?? ALL_COLLISION_GROUPS;
    const collisionMask = desc.collisionMask ?? ALL_COLLISION_GROUPS;
    colliderDesc.setCollisionGroups(
      packInteractionGroups3d(collisionGroups, collisionMask),
    );

    const collider = world.createCollider(colliderDesc, bodyRecord.body);
    // Keep `getBodyMass` truthful before the first step, as for `createBody`.
    bodyRecord.body.recomputeMassPropertiesFromColliders();

    const record: ColliderRecord = {
      id: this.#nextColliderId,
      rapierHandle: collider.handle,
      collider,
      bodyId: bodyRecord.id,
      sensor,
      collisionGroups,
      collisionMask,
      alive: true,
    };
    this.#nextColliderId += 1;
    this.#colliders.set(record.id, record);
    this.#collidersByRapierHandle.set(record.rapierHandle, record);
    // After the record exists, and after `applyColliderMass` has read the list
    // as it was: this collider is the body's first exactly when the list was
    // empty above.
    bodyRecord.colliderIds.push(record.id);
    return record as unknown as PhysicsColliderHandle;
  }

  /**
   * Destroys a collider (§37). Any contact pair it was part of is forgotten.
   *
   * ## The body's mass is rebuilt, not left behind (2026-08-06)
   *
   * Identical to `Rapier2dAdapter.destroyCollider`, and fixing the same silent
   * pair of defects: the id leaves `BodyRecord.colliderIds` (so a
   * replacement collider on a `"first-collider"` body is created carrying the
   * authored mass instead of `density: 0`), a surviving `"first-collider"` body
   * hands its authored mass to the surviving collider with the lowest monotonic
   * id (§33-stable creation order), and the body's mass properties are
   * recomputed so `getBodyMass` stays truthful before the next step.
   *
   * Re-applying rather than refusing: §23's authored mass belongs to the body,
   * not to whichever collider was holding it. A body left with no collider at
   * all keeps nothing — there is nowhere to hold it — and gets the mass back
   * from the next collider created on it.
   *
   * **Not called when the body itself is going away** (2026-08-07):
   * `PhysicsWorld` tears a registration down with a single `destroyBody`, which
   * §37 defines as taking everything attached with it, so none of this runs for
   * a body one line from destruction — see that method's note.
   */
  destroyCollider(handle: PhysicsColliderHandle): void {
    const world = this.#requireWorld();
    const record = this.#requireCollider(handle);
    const bodyRecord = this.#bodies.get(record.bodyId);
    world.removeCollider(record.collider, true);
    this.#forgetCollider(record);
    if (bodyRecord !== undefined) {
      this.#refreshMassAfterColliderLoss(bodyRecord);
    }
  }

  /**
   * Creates a joint (§37, §28; plan P6-1, WP-6.3).
   *
   * Anchors and axes in `desc` are **body-local**, which is what Rapier's
   * `JointData.*` factories want, so nothing is converted here beyond widening
   * a `Vector2` — `PhysicsWorld.addJoint` already did the world-to-local work
   * once, at registration.
   *
   * The type mapping and every measurement behind it are in the joint section
   * of the module header. Three of its consequences show up as code here:
   *
   * - a `fixed` joint's second frame is derived from the two bodies' current
   *   orientations, so the weld preserves the relative pose §28 promises rather
   *   than snapping the bodies together;
   * - `collisionEnabled` is applied explicitly on every joint, because Rapier's
   *   default is `true` (measured) and §28's is `false`;
   * - a `spherical` descriptor carrying `limits` is **refused**: Rapier 0.19.3
   *   cannot express a swing cone, and per-axis angular limits measurably fail
   *   to bound a diagonal swing.
   *
   * Limits and motors on revolute and prismatic joints are applied immediately
   * after creation through the same `SolverJointAccess` entry points a world
   * uses for a live change, so a joint authored with a motor and a joint
   * reconfigured into one end up in the same solver state.
   */
  createJoint(desc: JointDescriptor): PhysicsJointHandle {
    const world = this.#requireJointWorld();
    validateJointDescriptor(desc, ADAPTER_DIMENSION);
    const bodyA = this.#requireBody(desc.bodyA);
    const bodyB = this.#requireBody(desc.bodyB);

    const data = this.#buildJointData(desc, bodyA, bodyB);
    const joint = world.createImpulseJoint(data, bodyA.body, bodyB.body, true);
    joint.setContactsEnabled(desc.collisionEnabled ?? false);

    const record: JointRecord = {
      id: this.#nextJointId,
      rapierHandle: joint.handle,
      joint,
      type: desc.type,
      bodyIdA: bodyA.id,
      bodyIdB: bodyB.id,
      alive: true,
    };
    this.#nextJointId += 1;
    this.#joints.set(record.id, record);

    if (desc.type === "revolute") {
      if (desc.limits !== undefined) {
        this.#unitJoint(record).setLimits(desc.limits.min, desc.limits.max);
      }
      if (desc.motor !== undefined) {
        this.#applyMotor(record, {
          enabled: desc.motor.enabled ?? true,
          targetVelocity: desc.motor.targetVelocity,
          maxEffort: desc.motor.maxTorque,
        });
      }
    } else if (desc.type === "prismatic") {
      if (desc.limits !== undefined) {
        this.#unitJoint(record).setLimits(desc.limits.min, desc.limits.max);
      }
      if (desc.motor !== undefined) {
        this.#applyMotor(record, {
          enabled: desc.motor.enabled ?? true,
          targetVelocity: desc.motor.targetVelocity,
          maxEffort: desc.motor.maxForce,
        });
      }
    }

    return record as unknown as PhysicsJointHandle;
  }

  /**
   * Destroys a joint (§37, §28). The handle is invalid afterwards.
   *
   * The two bodies survive and are woken, which is what a constraint
   * disappearing under load means physically. Removing a *body* already removes
   * its joints in Rapier (measured), and {@link Rapier3dAdapter.destroyBody}
   * forgets their records for the same reason.
   */
  destroyJoint(handle: PhysicsJointHandle): void {
    const world = this.#requireJointWorld();
    const record = this.#requireJoint(handle);
    world.removeImpulseJoint(record.joint, true);
    this.#forgetJoint(record);
  }

  /**
   * Advances the solver by exactly `delta` seconds (§37, §10) and collects the
   * step's events.
   *
   * The events are gathered here rather than in `drainEvents` for two reasons,
   * both Rapier's: the `EventQueue` is auto-drained at the start of the *next*
   * `step`, and contact manifolds only carry the impulses the solver just
   * applied for as long as no further stepping has happened.
   *
   * ## `collisionstay`, which Rapier does not have
   *
   * Rapier reports only *started* and *stopped*. §29 names three collision
   * phases, so somebody has to derive the middle one, and this adapter does it —
   * the same decision, for the same reason, as the 2D adapter: the contact
   * manifold a `collisionstay` payload needs is only readable *here*,
   * immediately after the solve.
   *
   * The rule: a pair that Rapier reported as started is remembered; on every
   * later step where it has not been reported as stopped, a `collisionstay`
   * carrying a fresh manifold is emitted; when Rapier reports it stopped, a
   * `collisionend` is emitted and the pair is forgotten. Trigger (sensor) pairs
   * are tracked the same way but produce no `stay`, because §29 defines only
   * `triggerenter` and `triggerexit`.
   *
   * ## Ordering (§33)
   *
   * Deterministic and documented: all `collisionstart`/`triggerenter` in
   * Rapier's queue order, then every `collisionstay` in pair-creation order,
   * then all `collisionend`/`triggerexit` in queue order, then every §32
   * `sleep`/`wake` in body-creation order.
   */
  step(delta: number): void {
    const world = this.#requireWorld();
    if (!Number.isFinite(delta) || delta <= 0) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `step(delta) takes a finite positive number of seconds (§7a, §10); got ${String(delta)}.`,
        { context: { adapter: ADAPTER_NAME, delta } },
      );
    }

    world.timestep = delta;
    world.step(this.#eventQueue);
    this.#collectEvents();
  }

  /**
   * Returns and clears the events collected during the preceding `step` (§37).
   *
   * The array is handed over, not shared: the adapter starts a fresh buffer, so
   * a caller may keep, sort, or splice the result. Contact vectors are freshly
   * allocated per event and are never pooled, so they stay valid for as long as
   * the caller holds them.
   */
  setEventInterest(interest: PhysicsEventInterest): void {
    this.#stayEvents = interest.collisionstay;
  }

  drainEvents(): PhysicsEvent[] {
    const drained = this.#pendingEvents;
    this.#pendingEvents = [];
    return drained;
  }

  /**
   * §37's pre-step hook. **A documented no-op for this adapter.**
   *
   * Rapier applies every write the moment it is made — there is no staging
   * buffer for this call to flush. Scene-authored state reaches the solver
   * through `RapierBodyAccess`, which `@fourjs/physics` calls from inside its own
   * `syncSceneToSolver` phase; see the module header.
   */
  syncSceneToSolver(): void {
    this.#requireWorld();
  }

  /**
   * §37's post-step hook. **A documented no-op for this adapter**, for the same
   * reason as {@link Rapier3dAdapter.syncSceneToSolver}: solved transforms are
   * read per body through {@link Rapier3dAdapter.getBodyTransform}, which is the
   * only way an adapter that cannot see the scene graph could publish them.
   */
  syncSolverToScene(): void {
    this.#requireWorld();
  }

  /**
   * Casts a ray (§30).
   *
   * The direction is normalized before the cast, so Rapier's time of impact —
   * which is measured in units of the ray direction's length — equals the
   * distance in world units that `RaycastHit.distance` promises.
   *
   * Filtering is done **entirely** by `@fourjs/physics`'s `passesQueryFilter`
   * rather than by Rapier's own group words: one implementation of §30's filter
   * semantics means Rapier and every future adapter answer a query identically,
   * which is exactly the portability the §37 seam exists for.
   *
   * `mode: "first"` uses Rapier's nearest-hit entry point; `"all"` enumerates
   * and then applies `maxHits` in traversal order and `sorted` afterwards.
   *
   * Note the module header's warning: a collider created since the last `step`
   * is not yet in the broad phase and cannot be hit.
   */
  raycast(query: RaycastQuery): RaycastHit[] {
    const world = this.#requireWorld();
    const rapier = this.#requireRapier();
    const options = resolveQueryOptions(query);

    const origin = toRapierVector3(
      "origin",
      query.origin,
      this.#scratchRapierA,
    );
    const direction = toRapierVector3(
      "direction",
      query.direction,
      this.#scratchRapierB,
    );
    const length = Math.hypot(direction.x, direction.y, direction.z);
    if (length === 0) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        "raycast direction must have non-zero length (§30, §85).",
        { context: { adapter: ADAPTER_NAME } },
      );
    }
    // `Ray` *retains* the two records it is built from (verified), so these are
    // fresh literals rather than the scratch buffers above.
    const ray = new rapier.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      {
        x: direction.x / length,
        y: direction.y / length,
        z: direction.z / length,
      },
    );
    const maxToi = query.maxDistance ?? Number.MAX_VALUE;
    const predicate = (collider: RapierCollider3d): boolean =>
      this.#passesFilter(collider, options);

    const hits: RaycastHit[] = [];
    if (options.mode === "first") {
      const hit = world.castRayAndGetNormal(
        ray,
        maxToi,
        QUERY_SOLID,
        undefined,
        undefined,
        undefined,
        undefined,
        predicate,
      );
      if (hit !== null) {
        const record = this.#collidersByRapierHandle.get(hit.collider.handle);
        if (record !== undefined) {
          hits.push(
            this.#buildRaycastHit(record, ray, hit.timeOfImpact, hit.normal),
          );
        }
      }
      return hits;
    }

    world.intersectionsWithRay(
      ray,
      maxToi,
      QUERY_SOLID,
      (intersection) => {
        const record = this.#collidersByRapierHandle.get(
          intersection.collider.handle,
        );
        if (record !== undefined) {
          hits.push(
            this.#buildRaycastHit(
              record,
              ray,
              intersection.timeOfImpact,
              intersection.normal,
            ),
          );
        }
        return hits.length < options.maxHits;
      },
      undefined,
      undefined,
      undefined,
      undefined,
      predicate,
    );
    if (options.sorted) {
      sortHitsByDistance(hits);
    }
    return hits;
  }

  /**
   * Sweeps a shape (§30).
   *
   * **Multiplicity limit, declared rather than hidden:** Rapier 0.19.3's 3D
   * query surface exposes `castShape`, which returns the *first* impact and
   * nothing else — there is no "all shape-cast hits" entry point, in 3D any more
   * than in 2D. This method therefore returns at most one hit whatever `mode`,
   * `maxHits`, or `sorted` ask for. `capabilities.queries.shapeCast` stays
   * `true` because the query is implemented; the cap is a property of the
   * solver, and a caller that needs every crossing should step the sweep or use
   * `overlap`.
   *
   * `ShapeCastHit.point` is Rapier's `witness1`, which is world-space on the hit
   * collider, and `normal` is `normal1`, pointing out of it (both verified in
   * 3D: sweeping a `0.25` ball down onto a `0.5` ball centred at `y = 3` gives
   * `witness1 = (0, 3.5, 0)` in world space and `witness2 = (0, -0.25, 0)` in
   * the cast shape's local frame, which is why `witness2` is not used).
   */
  shapeCast(query: ShapeCastQuery): ShapeCastHit[] {
    const world = this.#requireWorld();
    const options = resolveQueryOptions(query);
    validateQueryShape(query.shape, ADAPTER_DIMENSION);

    const position = toRapierVector3(
      "position",
      query.position,
      this.#scratchRapierA,
    );
    const start = { x: position.x, y: position.y, z: position.z };
    const rotation =
      query.rotation === undefined
        ? createRapierRotation3()
        : toRapierRotation3(
            query.rotation,
            this.#scratchQuaternion,
            this.#scratchRapierRotation,
          );
    const direction = toRapierVector3(
      "direction",
      query.direction,
      this.#scratchRapierB,
    );
    const length = Math.hypot(direction.x, direction.y, direction.z);
    if (length === 0) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        "shapeCast direction must have non-zero length (§30, §85).",
        { context: { adapter: ADAPTER_NAME } },
      );
    }

    const hit = world.castShape(
      start,
      rotation,
      {
        x: direction.x / length,
        y: direction.y / length,
        z: direction.z / length,
      },
      createRapierShape3d(query.shape),
      SHAPE_CAST_TARGET_DISTANCE,
      query.maxDistance ?? Number.MAX_VALUE,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      (collider) => this.#passesFilter(collider, options),
    );
    if (hit === null) {
      return [];
    }
    const record = this.#collidersByRapierHandle.get(hit.collider.handle);
    if (record === undefined) {
      return [];
    }
    return [
      {
        collider: record as unknown as PhysicsColliderHandle,
        body: this.#bodyHandleOf(record),
        point: new Vector3(hit.witness1.x, hit.witness1.y, hit.witness1.z),
        normal: new Vector3(hit.normal1.x, hit.normal1.y, hit.normal1.z),
        distance: hit.time_of_impact,
      },
    ];
  }

  /**
   * Tests a static shape for overlaps (§30).
   *
   * §30's named forms fall out of the shape union: an overlap with a
   * `"sphere"` is `overlapSphere` and one with a `"box"` is `overlapBox`, whose
   * `rotation` is a full orientation here rather than 2D's single angle. Hits
   * carry no distance, so `sorted` does nothing — `OverlapHit` has nothing to
   * sort by, which `QueryOptions` already says.
   */
  overlap(query: OverlapQuery): OverlapHit[] {
    const world = this.#requireWorld();
    const options = resolveQueryOptions(query);
    validateQueryShape(query.shape, ADAPTER_DIMENSION);

    const position = toRapierVector3(
      "position",
      query.position,
      this.#scratchRapierA,
    );
    const rotation =
      query.rotation === undefined
        ? createRapierRotation3()
        : toRapierRotation3(
            query.rotation,
            this.#scratchQuaternion,
            this.#scratchRapierRotation,
          );

    const hits: OverlapHit[] = [];
    world.intersectionsWithShape(
      { x: position.x, y: position.y, z: position.z },
      rotation,
      createRapierShape3d(query.shape),
      (collider) => {
        const record = this.#collidersByRapierHandle.get(collider.handle);
        if (record !== undefined) {
          hits.push({
            collider: record as unknown as PhysicsColliderHandle,
            body: this.#bodyHandleOf(record),
          });
        }
        return hits.length < options.maxHits;
      },
      undefined,
      undefined,
      undefined,
      undefined,
      (collider) => this.#passesFilter(collider, options),
    );
    return hits;
  }

  /**
   * Tests a point (§30) — every collider that contains it.
   *
   * Each hit's `point` and `distance` come from Rapier's `projectPoint(point,
   * solid: true)`, which returns the query point itself for a point inside a
   * plain shape. Since a point query only ever reports *containing* colliders,
   * `distance` is `0` on every hit; that is `PointHit`'s documented meaning of
   * "the point is inside", not a field this adapter failed to fill.
   */
  pointQuery(query: PointQuery): PointHit[] {
    const world = this.#requireWorld();
    const options = resolveQueryOptions(query);
    const point = toRapierVector3("point", query.point, this.#scratchRapierA);
    const target = { x: point.x, y: point.y, z: point.z };

    const hits: PointHit[] = [];
    world.intersectionsWithPoint(
      target,
      (collider) => {
        const record = this.#collidersByRapierHandle.get(collider.handle);
        if (record !== undefined) {
          const projection = collider.projectPoint(target, QUERY_SOLID);
          const projected = projection?.point ?? target;
          hits.push({
            collider: record as unknown as PhysicsColliderHandle,
            body: this.#bodyHandleOf(record),
            point: new Vector3(projected.x, projected.y, projected.z),
            distance: Math.hypot(
              projected.x - target.x,
              projected.y - target.y,
              projected.z - target.z,
            ),
          });
        }
        return hits.length < options.maxHits;
      },
      undefined,
      undefined,
      undefined,
      undefined,
      (collider) => this.#passesFilter(collider, options),
    );
    if (options.sorted) {
      sortHitsByDistance(hits);
    }
    return hits;
  }

  /**
   * Serializes the world (§34).
   *
   * Rapier's `World.takeSnapshot()` captures the solver — bodies, colliders,
   * contacts, **joints**, integration parameters, gravity — and preserves its
   * own handles across `World.restoreSnapshot` (verified in 3D, joints
   * included: limits and motors both survive and 60 further steps reproduce the
   * original continuation exactly). It does **not** know about this adapter's
   * monotonic ids, mass modes, collision-group values, or which §28 type each
   * joint handle was, all of which §33's checksum, §30's filters, and §28's
   * live reconfiguration depend on. The buffer this method returns is therefore
   * an envelope, byte-compatible in layout with the 2D adapter's and
   * distinguished from it by the magic word:
   *
   * ```text
   * offset  0  u32  magic            0x33523446 ("F4R3", little-endian)
   * offset  4  u32  format version   2  (joint registry added, WP-6.3)
   * offset  8  u32  metadata length  in bytes
   * offset 12  u32  Rapier length    in bytes
   * offset 16  …    metadata         UTF-8 JSON (SnapshotMeta)
   * offset 16+m …   Rapier snapshot  World.takeSnapshot() bytes, verbatim
   * ```
   *
   * The envelope is opaque adapter data in §37's sense: valid only for this
   * adapter, this Rapier version, and this world configuration.
   */
  createSnapshot(): ArrayBuffer {
    const world = this.#requireWorld();
    const rapierBytes = world.takeSnapshot();

    const meta: SnapshotMeta = {
      adapter: ADAPTER_NAME,
      version: this.#version,
      nextBodyId: this.#nextBodyId,
      nextColliderId: this.#nextColliderId,
      nextJointId: this.#nextJointId,
      joints: [...this.#joints.values()].map((record) => [
        record.id,
        record.rapierHandle,
        record.type,
        record.bodyIdA,
        record.bodyIdB,
      ]),
      bodies: [...this.#bodies.values()].map((record) => [
        record.id,
        record.rapierHandle,
        record.sleeping,
        record.massMode,
        record.explicitMass,
        // The envelope keeps carrying the *count* (its layout is pinned by
        // format version 2); the ids themselves are re-derived on restore from
        // the `colliders` table below, which already names each collider's
        // body. Same bytes as before 2026-08-07.
        record.colliderIds.length,
      ]),
      colliders: [...this.#colliders.values()].map((record) => [
        record.id,
        record.rapierHandle,
        record.bodyId,
        record.sensor,
        record.collisionGroups,
        record.collisionMask,
      ]),
    };
    const metaBytes = new TextEncoder().encode(JSON.stringify(meta));

    const buffer = new ArrayBuffer(
      SNAPSHOT_HEADER_BYTES + metaBytes.byteLength + rapierBytes.byteLength,
    );
    const header = new DataView(buffer);
    header.setUint32(0, SNAPSHOT_MAGIC, true);
    header.setUint32(4, SNAPSHOT_FORMAT_VERSION, true);
    header.setUint32(8, metaBytes.byteLength, true);
    header.setUint32(12, rapierBytes.byteLength, true);
    const bytes = new Uint8Array(buffer);
    bytes.set(metaBytes, SNAPSHOT_HEADER_BYTES);
    bytes.set(rapierBytes, SNAPSHOT_HEADER_BYTES + metaBytes.byteLength);
    return buffer;
  }

  /**
   * Restores a world previously captured by
   * {@link Rapier3dAdapter.createSnapshot} (§34).
   *
   * The Rapier world is replaced wholesale — `World.restoreSnapshot` builds a
   * new one — and the old one is freed. The adapter's registry is then rebuilt
   * from the envelope's metadata, **reusing the existing record objects wherever
   * an id survives**: that is what makes handles minted before the snapshot keep
   * working afterwards, so "body identity and ordering survive the round trip"
   * is true in the sense §33's checksum needs. A record whose id is not in the
   * snapshot is marked dead, and its handle is rejected from then on.
   *
   * The touching-pair set is rebuilt from the restored narrow phase, so
   * `collisionstay` and `collisionend` keep working for pairs that were already
   * in contact when the snapshot was taken — Rapier will not re-report those as
   * *started*, so without this they would go silent.
   */
  restoreSnapshot(snapshot: ArrayBuffer): void {
    const rapier = this.#requireRapier();
    const world = this.#requireWorld();

    if (snapshot.byteLength < SNAPSHOT_HEADER_BYTES) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `Snapshot is too small to be a ${ADAPTER_NAME} envelope (§34).`,
        { context: { adapter: ADAPTER_NAME, byteLength: snapshot.byteLength } },
      );
    }
    const header = new DataView(snapshot);
    if (header.getUint32(0, true) !== SNAPSHOT_MAGIC) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `Snapshot was not produced by ${ADAPTER_NAME}; a snapshot is opaque adapter data and is valid only for the adapter that wrote it (§34, §37).`,
        { context: { adapter: ADAPTER_NAME } },
      );
    }
    const formatVersion = header.getUint32(4, true);
    if (formatVersion !== SNAPSHOT_FORMAT_VERSION) {
      throw new FourError(
        "SERIALIZATION_VERSION_MISMATCH",
        `Snapshot envelope version ${String(formatVersion)} is not ${String(SNAPSHOT_FORMAT_VERSION)} (§34).`,
        { context: { adapter: ADAPTER_NAME, formatVersion } },
      );
    }
    const metaLength = header.getUint32(8, true);
    const rapierLength = header.getUint32(12, true);
    if (SNAPSHOT_HEADER_BYTES + metaLength + rapierLength > snapshot.byteLength) {
      throw new FourError(
        "UNTRUSTED_INPUT_REJECTED",
        `Snapshot envelope declares ${String(metaLength)} meta + ${String(rapierLength)} solver bytes but carries ${String(snapshot.byteLength - SNAPSHOT_HEADER_BYTES)} (§34, §96).`,
        { context: { adapter: ADAPTER_NAME, metaLength, rapierLength, byteLength: snapshot.byteLength } },
      );
    }
    const bytes = new Uint8Array(snapshot);
    const meta = parseSnapshotMeta(
      bytes.subarray(SNAPSHOT_HEADER_BYTES, SNAPSHOT_HEADER_BYTES + metaLength),
    );
    if (meta.adapter !== ADAPTER_NAME || meta.version !== this.#version) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `Snapshot was written by ${JSON.stringify(meta.adapter)} ${JSON.stringify(meta.version)} and this adapter is ${JSON.stringify(ADAPTER_NAME)} ${JSON.stringify(this.#version)} (§34).`,
        { context: { adapter: ADAPTER_NAME, snapshotAdapter: meta.adapter } },
      );
    }

    const restored = rapier.World.restoreSnapshot(
      bytes.slice(
        SNAPSHOT_HEADER_BYTES + metaLength,
        SNAPSHOT_HEADER_BYTES + metaLength + rapierLength,
      ),
    );
    world.free();
    this.#world = restored;

    this.#rebuildRegistries(restored, meta);
    this.#eventQueue?.clear();
    this.#pendingEvents = [];
    this.#rebuildActivePairs(restored);
  }

  /**
   * Releases the Rapier world and event queue (§37, §83). Idempotent and
   * terminal: every handle this adapter minted is invalid afterwards, and every
   * other method throws.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#eventQueue?.free();
    this.#eventQueue = undefined;
    this.#world?.free();
    this.#world = undefined;
    this.#rapier = undefined;
    for (const record of this.#bodies.values()) {
      record.alive = false;
    }
    for (const record of this.#colliders.values()) {
      record.alive = false;
    }
    for (const record of this.#joints.values()) {
      record.alive = false;
    }
    this.#bodies.clear();
    this.#colliders.clear();
    this.#joints.clear();
    this.#bodiesByRapierHandle.clear();
    this.#collidersByRapierHandle.clear();
    this.#activePairs.clear();
    this.#pendingEvents = [];
  }

  // ---------------------------------------------------------------- accessors

  /** @inheritDoc */
  getBodyTransform(
    handle: PhysicsBodyHandle,
    outPosition: Vector3,
    outRotation: Quaternion,
  ): void {
    const record = this.#requireBody(handle);
    fromRapierVector3(record.body.translation(), outPosition);
    fromRapierRotation3(record.body.rotation(), outRotation);
  }

  /** @inheritDoc */
  setBodyTransform(
    handle: PhysicsBodyHandle,
    position: Vector3Input,
    rotation: RotationInput,
    wake = true,
  ): void {
    const record = this.#requireBody(handle);
    record.body.setTranslation(
      toRapierVector3("position", position, this.#scratchRapierA),
      wake,
    );
    record.body.setRotation(
      toRapierRotation3(
        rotation,
        this.#scratchQuaternion,
        this.#scratchRapierRotation,
      ),
      wake,
    );
  }

  /** @inheritDoc */
  getBodyVelocities(
    handle: PhysicsBodyHandle,
    outLinear: Vector3,
    outAngular: Vector3,
  ): void {
    const record = this.#requireBody(handle);
    fromRapierVector3(record.body.linvel(), outLinear);
    fromRapierVector3(record.body.angvel(), outAngular);
  }

  /** @inheritDoc */
  setBodyVelocities(
    handle: PhysicsBodyHandle,
    linear: Vector3Input,
    angular: AngularVelocityInput,
    wake = true,
  ): void {
    const record = this.#requireBody(handle);
    record.body.setLinvel(
      toRapierVector3("linearVelocity", linear, this.#scratchRapierA),
      wake,
    );
    record.body.setAngvel(
      toRapierAngularVector3(
        angular,
        this.#scratchVector3,
        this.#scratchRapierB,
      ),
      wake,
    );
  }

  /** @inheritDoc */
  applyForce(handle: PhysicsBodyHandle, force: Vector3Input): void {
    const record = this.#requireBody(handle);
    record.body.addForce(
      toRapierVector3("force", force, this.#scratchRapierA),
      true,
    );
  }

  /** @inheritDoc */
  applyForceAtPoint(
    handle: PhysicsBodyHandle,
    force: Vector3Input,
    worldPoint: Vector3Input,
  ): void {
    const record = this.#requireBody(handle);
    record.body.addForceAtPoint(
      toRapierVector3("force", force, this.#scratchRapierA),
      toRapierVector3("worldPoint", worldPoint, this.#scratchRapierB),
      true,
    );
  }

  /** @inheritDoc */
  applyTorque(handle: PhysicsBodyHandle, torque: AngularVelocityInput): void {
    const record = this.#requireBody(handle);
    record.body.addTorque(
      toRapierAngularVector3(
        torque,
        this.#scratchVector3,
        this.#scratchRapierA,
      ),
      true,
    );
  }

  /** @inheritDoc */
  applyImpulse(handle: PhysicsBodyHandle, impulse: Vector3Input): void {
    const record = this.#requireBody(handle);
    record.body.applyImpulse(
      toRapierVector3("impulse", impulse, this.#scratchRapierA),
      true,
    );
  }

  /** @inheritDoc */
  applyImpulseAtPoint(
    handle: PhysicsBodyHandle,
    impulse: Vector3Input,
    worldPoint: Vector3Input,
  ): void {
    const record = this.#requireBody(handle);
    record.body.applyImpulseAtPoint(
      toRapierVector3("impulse", impulse, this.#scratchRapierA),
      toRapierVector3("worldPoint", worldPoint, this.#scratchRapierB),
      true,
    );
  }

  /** @inheritDoc */
  applyAngularImpulse(
    handle: PhysicsBodyHandle,
    angularImpulse: AngularVelocityInput,
  ): void {
    const record = this.#requireBody(handle);
    record.body.applyTorqueImpulse(
      toRapierAngularVector3(
        angularImpulse,
        this.#scratchVector3,
        this.#scratchRapierA,
      ),
      true,
    );
  }

  /** @inheritDoc */
  resetForces(handle: PhysicsBodyHandle): void {
    const record = this.#requireBody(handle);
    record.body.resetForces(false);
    record.body.resetTorques(false);
  }

  /** @inheritDoc */
  setNextKinematicTransform(
    handle: PhysicsBodyHandle,
    position: Vector3Input,
    rotation?: RotationInput,
  ): void {
    const record = this.#requireBody(handle);
    record.body.setNextKinematicTranslation(
      toRapierVector3("position", position, this.#scratchRapierA),
    );
    if (rotation !== undefined) {
      record.body.setNextKinematicRotation(
        toRapierRotation3(
          rotation,
          this.#scratchQuaternion,
          this.#scratchRapierRotation,
        ),
      );
    }
  }

  /**
   * Re-types a live body in place — `SolverBodyAccess.setBodyType`'s contract
   * (a documented own summary rather than `@inheritDoc`, which cannot carry
   * additional paragraphs).
   *
   * The 3D build's `setBodyType(type, wakeUp)` behaves exactly like the 2D
   * one's — same required `wakeUp`, same preserved handle, colliders, pose, and
   * mass (verified separately against the 3D wasm, WP-7.2). See
   * `Rapier2dAdapter.setBodyType` for why `record.sleeping` is left alone.
   */
  setBodyType(handle: PhysicsBodyHandle, type: BodyType, wake = true): void {
    const record = this.#requireBody(handle);
    record.body.setBodyType(toRapierBodyType3d(type), wake);
  }

  /** @inheritDoc */
  wakeBody(handle: PhysicsBodyHandle): void {
    this.#requireBody(handle).body.wakeUp();
  }

  /** @inheritDoc */
  sleepBody(handle: PhysicsBodyHandle): void {
    this.#requireBody(handle).body.sleep();
  }

  /** @inheritDoc */
  isBodySleeping(handle: PhysicsBodyHandle): boolean {
    return this.#requireBody(handle).body.isSleeping();
  }

  /** @inheritDoc */
  getBodyCcdMode(handle: PhysicsBodyHandle): CCDMode {
    const body = this.#requireBody(handle).body;
    if (body.isCcdEnabled()) {
      return "swept";
    }
    return body.softCcdPrediction() > 0 ? "speculative" : "disabled";
  }

  /** @inheritDoc */
  getBodyMass(handle: PhysicsBodyHandle): number {
    return this.#requireBody(handle).body.mass();
  }

  /** @inheritDoc */
  getBodyCenterOfMass(handle: PhysicsBodyHandle, out: Vector3): void {
    const com = this.#requireBody(handle).body.worldCom();
    out.set(com.x, com.y, com.z);
  }

  /** @inheritDoc */
  getBodyId(handle: PhysicsBodyHandle): number {
    return this.#requireBody(handle).id;
  }

  /** @inheritDoc */
  forEachBody(visit: (handle: PhysicsBodyHandle, id: number) => void): void {
    this.#requireWorld();
    for (const record of this.#bodies.values()) {
      visit(record as unknown as PhysicsBodyHandle, record.id);
    }
  }

  /** @inheritDoc */
  getColliderBody(handle: PhysicsColliderHandle): PhysicsBodyHandle {
    return this.#bodyHandleOf(this.#requireCollider(handle));
  }

  /** @inheritDoc */
  getColliderId(handle: PhysicsColliderHandle): number {
    return this.#requireCollider(handle).id;
  }

  /** @inheritDoc */
  forEachCollider(
    visit: (handle: PhysicsColliderHandle, id: number) => void,
  ): void {
    this.#requireWorld();
    for (const record of this.#colliders.values()) {
      visit(record as unknown as PhysicsColliderHandle, record.id);
    }
  }

  /** Number of contact points across collider manifolds in the current solver world. */
  countContacts(): number {
    const world = this.#requireWorld();
    const narrowPhase = world.narrowPhase;
    let total = 0;
    for (const record of this.#colliders.values()) {
      if (!record.alive) {
        continue;
      }
      const handle = record.rapierHandle;
      narrowPhase.contactPairsWith(handle, (otherHandle) => {
        if (handle < otherHandle) {
          narrowPhase.contactPair(
            handle,
            otherHandle,
            world.bodies,
            (manifold) => {
              total += manifold.numContacts();
            },
          );
        }
      });
    }
    return total;
  }

  // --------------------------------------------- §37 property changes (PH-1)

  /**
   * Replaces §23's mass triple on a live body —
   * `SolverBodyTuningAccess.setBodyMassProperties` (PH-1 stage 2, 2026-08-07).
   *
   * The rule, the mass-mode rewrite, and the trailing
   * `recomputeMassPropertiesFromColliders()` are the 2D adapter's, verbatim:
   * see {@link Rapier2dAdapter.setBodyMassProperties}. What differs is 3D's
   * shape of the distribution — a principal-inertia **vector** plus a frame,
   * which is why `toPrincipalInertia3d` refuses a tensor with off-diagonal
   * terms here and `elements[8]` suffices there (§23, §37).
   */
  setBodyMassProperties(
    handle: PhysicsBodyHandle,
    mass: number,
    centerOfMass: Vector3 | undefined,
    inertiaTensor: Matrix3 | undefined,
    wake = true,
  ): void {
    const record = this.#requireBody(handle);
    const onBody =
      centerOfMass !== undefined ||
      inertiaTensor !== undefined ||
      record.colliderIds.length === 0;

    const principalInertia = this.#scratchRapierB;
    if (onBody) {
      record.massMode = "body";
      for (const colliderId of record.colliderIds) {
        this.#colliders.get(colliderId)?.collider.setDensity(0);
      }
      if (inertiaTensor === undefined) {
        principalInertia.x = 0;
        principalInertia.y = 0;
        principalInertia.z = 0;
      } else {
        toPrincipalInertia3d(inertiaTensor, principalInertia);
      }
      record.body.setAdditionalMassProperties(
        mass,
        toRapierVector3(
          "centerOfMass",
          centerOfMass ?? this.#scratchVector3.set(0, 0, 0),
          this.#scratchRapierA,
        ),
        principalInertia,
        IDENTITY_INERTIA_FRAME,
        wake,
      );
    } else {
      record.massMode = "first-collider";
      // Clears whatever a previous `"body"` mode put on the body itself.
      this.#scratchRapierA.x = 0;
      this.#scratchRapierA.y = 0;
      this.#scratchRapierA.z = 0;
      principalInertia.x = 0;
      principalInertia.y = 0;
      principalInertia.z = 0;
      record.body.setAdditionalMassProperties(
        0,
        this.#scratchRapierA,
        principalInertia,
        IDENTITY_INERTIA_FRAME,
        wake,
      );
      for (let i = 0; i < record.colliderIds.length; i += 1) {
        const collider = this.#colliders.get(record.colliderIds[i])?.collider;
        // Belt-and-braces, like `#forgetCollider`'s guards: `colliderIds` and
        // `#colliders` are written and spliced together, so an id in the list
        // always resolves.
        if (collider === undefined) {
          continue;
        }
        if (i === 0) {
          collider.setMass(mass);
        } else {
          collider.setDensity(0);
        }
      }
    }

    record.explicitMass = mass;
    record.body.recomputeMassPropertiesFromColliders();
  }

  /** @inheritDoc */
  setBodyDamping(
    handle: PhysicsBodyHandle,
    linear: number,
    angular: number,
  ): void {
    const record = this.#requireBody(handle);
    record.body.setLinearDamping(linear);
    record.body.setAngularDamping(angular);
  }

  /** @inheritDoc */
  setBodyGravityScale(
    handle: PhysicsBodyHandle,
    scale: number,
    wake = true,
  ): void {
    this.#requireBody(handle).body.setGravityScale(scale, wake);
  }

  /**
   * Selects §31's method on a live body — the 2D adapter's rule and its
   * reversibility argument unchanged; see
   * {@link Rapier2dAdapter.setBodyCcdMode}.
   */
  setBodyCcdMode(
    handle: PhysicsBodyHandle,
    mode: CCDMode,
    predictionDistance?: number,
  ): void {
    const body = this.#requireBody(handle).body;
    body.enableCcd(mode === "swept");
    body.setSoftCcdPrediction(
      mode === "speculative"
        ? (predictionDistance ?? SOFT_CCD_PREDICTION_DISTANCE)
        : 0,
    );
  }

  /**
   * Replaces a collider's §25 surface properties — see
   * {@link Rapier2dAdapter.setColliderMaterial} for why `density` is optional
   * and what an `undefined` one protects.
   */
  setColliderMaterial(
    handle: PhysicsColliderHandle,
    friction: number,
    restitution: number,
    density: number | undefined,
  ): void {
    const record = this.#requireCollider(handle);
    record.collider.setFriction(friction);
    record.collider.setRestitution(restitution);
    if (density !== undefined) {
      record.collider.setDensity(density);
      this.#bodies
        .get(record.bodyId)
        ?.body.recomputeMassPropertiesFromColliders();
    }
  }

  /**
   * Replaces a collider's §24 participation — see
   * {@link Rapier2dAdapter.setColliderFilter} for the `ActiveCollisionTypes`
   * widening and for what happens to a pair that is already touching.
   */
  setColliderFilter(
    handle: PhysicsColliderHandle,
    sensor: boolean,
    collisionGroups: number,
    collisionMask: number,
  ): void {
    const rapier = this.#requireRapier();
    const record = this.#requireCollider(handle);
    if (sensor && !record.sensor) {
      record.collider.setActiveCollisionTypes(rapier.ActiveCollisionTypes.ALL);
    }
    record.collider.setSensor(sensor);
    record.collider.setCollisionGroups(
      packInteractionGroups3d(collisionGroups, collisionMask),
    );
    record.sensor = sensor;
    record.collisionGroups = collisionGroups;
    record.collisionMask = collisionMask;
  }

  // ----------------------------------------------------------- joint accessors

  /**
   * Never available on this solver: **throws `NOT_IMPLEMENTED`** (plan P6-2,
   * WP-6.3, 2026-08-01).
   *
   * `SolverJointAccess` promises this method is only ever called when
   * {@link Rapier3dAdapter.reportsJointReactions} is `true`, and it is `false`
   * here, so reaching this code means somebody bypassed the flag. It throws
   * rather than writing zeros, because zeros would read as "this joint is under
   * no load" and would silently keep every §28 break threshold from ever firing
   * — the exact failure plan P6-2 forbids faking.
   *
   * Revisit when a Rapier release exposes joint impulses in its JavaScript
   * bindings; nothing else in this adapter has to change when it does.
   */
  getJointReaction(
    handle: PhysicsJointHandle,
    outLinear: Vector3,
    outAngular: Vector3,
  ): void {
    void handle;
    void outLinear;
    void outAngular;
    throw new FourError(
      "NOT_IMPLEMENTED",
      `Rapier ${this.#version || "0.19.3"} reports no joint reaction: neither ImpulseJoint nor RawImpulseJointSet exposes a joint impulse, force, or torque (verified 2026-08-01, WP-6.3). Rapier3dAdapter.reportsJointReactions is false and §28 break thresholds are staged, not faked (plan P6-2).`,
      { context: { adapter: ADAPTER_NAME } },
    );
  }

  /**
   * Reconfigures a revolute or prismatic joint's travel limits (§28), in
   * radians or metres respectively.
   *
   * Only those two types have limits in Rapier 0.19.3 — they are the only
   * `UnitImpulseJoint`s — so any other type throws rather than accepting a
   * limit that would never be enforced.
   */
  setJointLimits(handle: PhysicsJointHandle, min: number, max: number): void {
    this.#unitJoint(this.#requireJoint(handle)).setLimits(min, max);
  }

  /**
   * Reconfigures a revolute or prismatic joint's motor (§28 "motors").
   *
   * ## What `maxEffort` becomes, and what it does not
   *
   * Rapier 0.19.3's JavaScript bindings have **no motor force limit**:
   * `configureMotorVelocity(targetVelocity, factor)` reaches
   * `jointConfigureMotor(handle, axis, targetPos, targetVel, stiffness,
   * damping)` and there is no `maxForce` parameter anywhere in the typed or raw
   * surface (verified 2026-08-01 — see finding 3 in the module header).
   * `SolverJointMotor.maxEffort` is therefore passed as Rapier's **damping
   * gain**: the effort the motor applies is roughly `maxEffort × (targetVelocity
   * − currentVelocity)` under `MotorModel.ForceBased`, so a larger `maxEffort`
   * is a stronger motor, but the number is a gain and not the cap its name
   * promises. A motor commanded to 4 rad/s settles at 3.60 rad/s with a gain of
   * 0.1 and reaches exactly 4 rad/s from a gain of 1 upwards (measured).
   *
   * `MotorModel.ForceBased` is chosen over `AccelerationBased` because §28
   * states the cap in newton-metres and newtons: a force-based motor's effort
   * is what the units describe, where an acceleration-based one scales with the
   * body's inertia.
   *
   * A motor that is disabled, or whose `maxEffort` is `0`, is configured with
   * `INERT_MOTOR_GAIN` and a zero target instead of being removed —
   * Rapier cannot remove a motor, and a gain of exactly `0` is its *rigid* case
   * rather than its inert one. The inert gain reproduces an unmotorized joint
   * bit for bit (measured).
   */
  setJointMotor(handle: PhysicsJointHandle, motor: SolverJointMotor): void {
    this.#applyMotor(this.#requireJoint(handle), motor);
  }

  /**
   * Turns contact generation between the two joined bodies on or off, live
   * (§28 `collisionEnabled`; PH-22f, 2026-08-08).
   *
   * `ImpulseJoint.setContactsEnabled` is on Rapier's **base** joint class, so
   * unlike `setLimits` and the motor configuration it works for every §28 type
   * this adapter builds — which is why this is the one §28 property that could
   * stop being frozen. It is the same call `createJoint` makes, so a joint
   * created with contacts on and a joint switched to contacts on cannot drift
   * apart.
   */
  setJointCollisionEnabled(handle: PhysicsJointHandle, enabled: boolean): void {
    this.#requireJoint(handle).joint.setContactsEnabled(enabled);
  }

  /**
   * Replaces both body-local anchors, live (§28, PH-22f).
   *
   * `ImpulseJoint.setAnchor1` / `setAnchor2` are on Rapier's **base** joint
   * class, so unlike `setLimits` this works for every §28 type this adapter
   * builds. The vectors are already body-local — the same space `createJoint`
   * received — and are not re-measured against any pose.
   */
  setJointAnchors(
    handle: PhysicsJointHandle,
    anchorA: Vector3,
    anchorB: Vector3,
  ): void {
    const record = this.#requireJoint(handle);
    record.joint.setAnchor1(
      toRapierVector3("anchorA", anchorA, createRapierVector3()),
    );
    record.joint.setAnchor2(
      toRapierVector3("anchorB", anchorB, createRapierVector3()),
    );
  }

  /** @inheritDoc */
  getJointId(handle: PhysicsJointHandle): number {
    return this.#requireJoint(handle).id;
  }

  /** @inheritDoc */
  forEachJoint(visit: (handle: PhysicsJointHandle, id: number) => void): void {
    this.#requireWorld();
    for (const record of this.#joints.values()) {
      visit(record as unknown as PhysicsJointHandle, record.id);
    }
  }

  // ------------------------------------------------------------------ private

  #assertNotDisposed(): void {
    if (this.#disposed) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        "Rapier3dAdapter has been disposed; dispose() is terminal (§37, §83).",
        { context: { adapter: ADAPTER_NAME } },
      );
    }
  }

  #requireWorld(): RapierWorld3d {
    this.#assertNotDisposed();
    if (this.#world === undefined) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        "Rapier3dAdapter.initialize has not completed; await it before using the adapter (§37).",
        { context: { adapter: ADAPTER_NAME } },
      );
    }
    return this.#world;
  }

  #requireRapier(): Rapier3dModule {
    this.#assertNotDisposed();
    if (this.#rapier === undefined) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        "Rapier3dAdapter.initialize has not completed; await it before using the adapter (§37).",
        { context: { adapter: ADAPTER_NAME } },
      );
    }
    return this.#rapier;
  }

  /**
   * Recovers a body record from an opaque handle (§37).
   *
   * The handle *is* the record, cast — which is the adapter's whole privilege
   * over handles per `types.ts`. The identity check against the registry is what
   * makes a foreign object, a destroyed body, or a handle from another adapter
   * fail loudly instead of corrupting a world.
   */
  #requireBody(handle: PhysicsBodyHandle): BodyRecord {
    this.#requireWorld();
    const record = handle as unknown as BodyRecord;
    if (!record.alive || this.#bodies.get(record.id) !== record) {
      rejectStalePhysicsHandle(
        "body",
        String(record.id),
        "Body handle is not valid for this Rapier3dAdapter: it was destroyed, or it was minted by another adapter (§37).",
        ADAPTER_ERROR_CODE,
        { adapter: ADAPTER_NAME },
      );
    }
    return record;
  }

  /**
   * The Rapier world under the module-private joint view (WP-6.3).
   *
   * One cast, in one place: `RapierWorld3d` in `init.ts` does not carry the
   * three joint members because that file is owned by another packet this wave
   * — see the transcription block above for why the joint surface lives here
   * and where it should end up.
   */
  #requireJointWorld(): RapierJointWorld3d {
    return this.#requireWorld();
  }

  /** The Rapier module under the module-private joint view. See above. */
  #requireJointModule(): RapierJointModule3d {
    return this.#requireRapier();
  }

  /** Joint counterpart of {@link Rapier3dAdapter.#requireBody} (§28, §37). */
  #requireJoint(handle: PhysicsJointHandle): JointRecord {
    this.#requireWorld();
    const record = handle as unknown as JointRecord;
    if (!record.alive || this.#joints.get(record.id) !== record) {
      rejectStalePhysicsHandle(
        "joint",
        String(record.id),
        "Joint handle is not valid for this Rapier3dAdapter: it was destroyed — possibly with one of its bodies — or it was minted by another adapter (§28, §37).",
        ADAPTER_ERROR_CODE,
        { adapter: ADAPTER_NAME },
      );
    }
    return record;
  }

  /**
   * A joint record as the `UnitImpulseJoint` that carries limits and motors,
   * or a `FourError` naming the type that does not (§28).
   *
   * Rapier 0.19.3 gives `setLimits` and `configureMotor*` to revolute and
   * prismatic joints alone. Refusing here is the honesty
   * `SolverJointAccess.setJointLimits` requires: a limit or a motor command
   * that silently did nothing would be a wrong simulation, and a fixed, rope,
   * spring, or spherical joint has no degree of freedom to drive in the first
   * place.
   */
  #unitJoint(record: JointRecord): RapierUnitImpulseJoint3d {
    if (record.type !== "revolute" && record.type !== "prismatic") {
      throw new FourError(
        "NOT_IMPLEMENTED",
        `A ${record.type} joint has no limits or motor in Rapier ${this.#version || "0.19.3"}: only revolute and prismatic joints are UnitImpulseJoints, and only they carry setLimits/configureMotor (§28, §37, WP-6.3).`,
        { context: { adapter: ADAPTER_NAME, jointType: record.type } },
      );
    }
    return record.joint as RapierUnitImpulseJoint3d;
  }

  /**
   * Pushes one motor configuration into Rapier. See
   * {@link Rapier3dAdapter.setJointMotor} for what `maxEffort` becomes.
   */
  #applyMotor(record: JointRecord, motor: SolverJointMotor): void {
    const joint = this.#unitJoint(record);
    const driving = motor.enabled && motor.maxEffort > 0;
    joint.configureMotorModel(this.#requireJointModule().MotorModel.ForceBased);
    joint.configureMotorVelocity(
      driving ? motor.targetVelocity : 0,
      driving ? motor.maxEffort : INERT_MOTOR_GAIN,
    );
  }

  /**
   * Builds the `JointData` for one descriptor (§28, plan P6-1).
   *
   * Fresh `{ x, y, z }` records rather than the adapter's scratch buffers:
   * `JointData` *retains* the vectors it is handed until `intoRaw` runs inside
   * `createImpulseJoint`, and joint creation is not a per-step path, so the
   * three allocations buy an invariant that is worth more than they cost.
   */
  #buildJointData(
    desc: JointDescriptor,
    bodyA: BodyRecord,
    bodyB: BodyRecord,
  ): RapierJointData3d {
    const jointData = this.#requireJointModule().JointData;
    const anchorA = toRapierVector3(
      "anchorA",
      desc.anchorA ?? ORIGIN,
      createRapierVector3(),
    );
    const anchorB = toRapierVector3(
      "anchorB",
      desc.anchorB ?? ORIGIN,
      createRapierVector3(),
    );

    switch (desc.type) {
      case "fixed":
        // frame1 = identity, frame2 = conj(qB)·qA — see the module header: the
        // weld must preserve the relative pose the bodies have right now, and
        // identity frames would instead force them into a shared orientation.
        return jointData.fixed(
          anchorA,
          createRapierRotation3(),
          anchorB,
          relativeRapierRotation3(
            bodyB.body.rotation(),
            bodyA.body.rotation(),
            createRapierRotation3(),
          ),
        );
      case "revolute":
        return jointData.revolute(
          anchorA,
          anchorB,
          toRapierVector3("axis", desc.axis ?? PLUS_Z, createRapierVector3()),
        );
      case "prismatic":
        return jointData.prismatic(
          anchorA,
          anchorB,
          toRapierVector3("axis", desc.axis, createRapierVector3()),
        );
      case "rope":
        return jointData.rope(desc.maxLength, anchorA, anchorB);
      case "spring":
        return jointData.spring(
          desc.restLength,
          desc.stiffness,
          desc.damping ?? 0,
          anchorA,
          anchorB,
        );
      default:
        if (desc.limits !== undefined) {
          throw new FourError(
            "NOT_IMPLEMENTED",
            `Rapier ${this.#version || "0.19.3"} cannot enforce a spherical joint's swing cone: SphericalImpulseJoint is not a UnitImpulseJoint and has no limit API, and the raw per-axis angular limits are not a cone — a ball joint limited to ±0.3 rad on every angular axis stops a planar swing at 0.2998 rad but lets a diagonal one reach 1.1247 rad (measured 2026-08-01, WP-6.3). Remove the limits to use an unlimited ball joint, or use a revolute joint whose single-axis limit Rapier does enforce (§28, plan P6-1).`,
            { context: { adapter: ADAPTER_NAME, jointType: desc.type } },
          );
        }
        return jointData.spherical(anchorA, anchorB);
    }
  }

  /** Drops a joint from the registry. Rapier-side removal is the caller's. */
  #forgetJoint(record: JointRecord): void {
    record.alive = false;
    this.#joints.delete(record.id);
  }

  /** Collider counterpart of {@link Rapier3dAdapter.#requireBody}. */
  #requireCollider(handle: PhysicsColliderHandle): ColliderRecord {
    this.#requireWorld();
    const record = handle as unknown as ColliderRecord;
    if (!record.alive || this.#colliders.get(record.id) !== record) {
      rejectStalePhysicsHandle(
        "collider",
        String(record.id),
        "Collider handle is not valid for this Rapier3dAdapter: it was destroyed, or it was minted by another adapter (§37).",
        ADAPTER_ERROR_CODE,
        { adapter: ADAPTER_NAME },
      );
    }
    return record;
  }

  /** The handle of a collider's owning body — every event and hit needs it. */
  #bodyHandleOf(record: ColliderRecord): PhysicsBodyHandle {
    const body = this.#bodies.get(record.bodyId);
    if (body === undefined) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        "Collider outlived its body, which cannot happen through the public API (§24, §37).",
        { context: { adapter: ADAPTER_NAME, colliderId: record.id } },
      );
    }
    return body as unknown as PhysicsBodyHandle;
  }

  /**
   * Drops a collider from every index, including any pair it was part of, and
   * from its body's `BodyRecord.colliderIds` — the §23 bookkeeping
   * `applyColliderMass` reads. See {@link Rapier3dAdapter.destroyCollider}.
   *
   * Both guards are belt-and-braces, as in the 2D adapter: a collider cannot
   * outlive its body through the public API, and an id cannot be missing from
   * the list `createCollider` put it in.
   */
  #forgetCollider(record: ColliderRecord): void {
    record.alive = false;
    this.#colliders.delete(record.id);
    this.#collidersByRapierHandle.delete(record.rapierHandle);
    const body = this.#bodies.get(record.bodyId);
    if (body !== undefined) {
      const index = body.colliderIds.indexOf(record.id);
      if (index >= 0) {
        body.colliderIds.splice(index, 1);
      }
    }
    for (const [key, pair] of [...this.#activePairs]) {
      if (pair.a === record || pair.b === record) {
        this.#activePairs.delete(key);
      }
    }
  }

  /**
   * Re-establishes a body's §23 mass after one of its colliders was destroyed.
   * See {@link Rapier3dAdapter.destroyCollider} for the rule and its rationale.
   */
  #refreshMassAfterColliderLoss(body: BodyRecord): void {
    if (body.massMode === "first-collider") {
      const heir = this.#firstColliderOf(body);
      if (heir !== undefined) {
        heir.collider.setMass(body.explicitMass);
      }
    }
    body.body.recomputeMassPropertiesFromColliders();
  }

  /**
   * The surviving collider of `body` with the lowest monotonic id, or
   * `undefined` when the body has none left.
   *
   * `BodyRecord.colliderIds` is that body's own list in ascending id
   * order, so the choice is §33 deterministic — independent of which collider
   * was destroyed and of any Rapier handle — and the lookup costs one map read
   * rather than a scan of every collider in the world (2026-08-07; the previous
   * form walked `#colliders` looking for a matching `bodyId`, which made
   * destroying an N-collider body O(N · M) in a world of M colliders).
   */
  #firstColliderOf(body: BodyRecord): ColliderRecord | undefined {
    const first = body.colliderIds[0];
    return first === undefined ? undefined : this.#colliders.get(first);
  }

  /** §30's filter, applied to one Rapier collider. See `raycast`. */
  #passesFilter(
    collider: RapierCollider3d,
    options: ResolvedQueryOptions,
  ): boolean {
    const record = this.#collidersByRapierHandle.get(collider.handle);
    if (record === undefined) {
      return false;
    }
    const candidate: QueryCandidate = {
      collider: record as unknown as PhysicsColliderHandle,
      body: this.#bodyHandleOf(record),
      collisionGroups: record.collisionGroups,
      collisionMask: record.collisionMask,
      sensor: record.sensor,
    };
    return passesQueryFilter(candidate, options);
  }

  /** Builds one §30 ray hit; `normal` is Rapier's world-space surface normal. */
  #buildRaycastHit(
    record: ColliderRecord,
    ray: { origin: RapierVector3; dir: RapierVector3 },
    timeOfImpact: number,
    normal: RapierVector3,
  ): RaycastHit {
    return {
      collider: record as unknown as PhysicsColliderHandle,
      body: this.#bodyHandleOf(record),
      point: new Vector3(
        ray.origin.x + ray.dir.x * timeOfImpact,
        ray.origin.y + ray.dir.y * timeOfImpact,
        ray.origin.z + ray.dir.z * timeOfImpact,
      ),
      normal: new Vector3(normal.x, normal.y, normal.z),
      distance: timeOfImpact,
    };
  }

  /** The §33-stable key of a collider pair: ascending monotonic ids. */
  #pairKey(a: ColliderRecord, b: ColliderRecord): string {
    return a.id < b.id
      ? `${String(a.id)}|${String(b.id)}`
      : `${String(b.id)}|${String(a.id)}`;
  }

  /**
   * Turns the last step's Rapier events into §29/§32 payloads. See
   * {@link Rapier3dAdapter.step} for the ordering contract.
   */
  #collectEvents(): void {
    const started = this.#startedPairs;
    const stopped = this.#stoppedPairs;
    started.length = 0;
    stopped.length = 0;
    this.#stoppedKeys.clear();

    this.#eventQueue?.drainCollisionEvents((handleA, handleB, isStarted) => {
      const a = this.#collidersByRapierHandle.get(handleA);
      const b = this.#collidersByRapierHandle.get(handleB);
      if (a === undefined || b === undefined) {
        return;
      }
      if (isStarted) {
        started.push(a, b);
      } else {
        stopped.push(a, b);
        this.#stoppedKeys.add(this.#pairKey(a, b));
      }
    });

    for (let i = 0; i < started.length; i += 2) {
      this.#emitPair(started[i], started[i + 1], "start");
    }

    if (this.#stayEvents) {
      for (const pair of this.#activePairs.values()) {
        if (
          pair.trigger ||
          this.#stoppedKeys.has(this.#pairKey(pair.a, pair.b))
        ) {
          continue;
        }
        this.#emitPair(pair.a, pair.b, "stay");
      }
    }

    for (let i = 0; i < started.length; i += 2) {
      const a = started[i];
      const b = started[i + 1];
      const key = this.#pairKey(a, b);
      if (!this.#activePairs.has(key)) {
        this.#activePairs.set(key, { a, b, trigger: a.sensor || b.sensor });
      }
    }

    for (let i = 0; i < stopped.length; i += 2) {
      const a = stopped[i];
      const b = stopped[i + 1];
      this.#emitPair(a, b, "end");
      this.#activePairs.delete(this.#pairKey(a, b));
    }

    for (const record of this.#bodies.values()) {
      const sleeping = record.body.isSleeping();
      if (sleeping !== record.sleeping) {
        record.sleeping = sleeping;
        this.#pendingEvents.push({
          type: sleeping ? "sleep" : "wake",
          body: record as unknown as PhysicsBodyHandle,
        });
      }
    }
  }

  /** Emits the §29 event(s) for one collider pair in one phase. */
  #emitPair(
    a: ColliderRecord,
    b: ColliderRecord,
    phase: "start" | "stay" | "end",
  ): void {
    if (a.sensor || b.sensor) {
      const type = phase === "start" ? "triggerenter" : "triggerexit";
      if (a.sensor) {
        this.#pendingEvents.push({
          type,
          sensor: a as unknown as PhysicsColliderHandle,
          sensorBody: this.#bodyHandleOf(a),
          other: b as unknown as PhysicsColliderHandle,
          otherBody: this.#bodyHandleOf(b),
        });
      }
      if (b.sensor) {
        // §29: when two sensors overlap the pair is reported from each side, so
        // a listener on either sensor sees its own event.
        this.#pendingEvents.push({
          type,
          sensor: b as unknown as PhysicsColliderHandle,
          sensorBody: this.#bodyHandleOf(b),
          other: a as unknown as PhysicsColliderHandle,
          otherBody: this.#bodyHandleOf(a),
        });
      }
      return;
    }

    const contacts: ContactPoint[] = [];
    const totalImpulse = new Vector3();
    const relativeVelocity = new Vector3();
    if (phase !== "end") {
      this.#buildContacts(a, b, contacts, totalImpulse, relativeVelocity);
    }
    this.#pendingEvents.push({
      type:
        phase === "start"
          ? "collisionstart"
          : phase === "stay"
            ? "collisionstay"
            : "collisionend",
      bodyA: this.#bodyHandleOf(a),
      bodyB: this.#bodyHandleOf(b),
      colliderA: a as unknown as PhysicsColliderHandle,
      colliderB: b as unknown as PhysicsColliderHandle,
      contacts,
      relativeVelocity,
      totalImpulse,
    });
  }

  /**
   * Fills a §29 contact manifold from Rapier's narrow phase.
   *
   * Every field is taken from Rapier where Rapier has it, and the two it does
   * not are documented rather than faked:
   *
   * - `pointOnA` / `pointOnB` — `localContactPoint1/2` transformed by each
   *   collider's world isometry, which in 3D means a quaternion rotation
   *   followed by a translation (`rotateVectorByRotation3`). Rapier's manifold
   *   may be *flipped* relative to the pair as this adapter names it; the
   *   `flipped` flag is honoured so `pointOnA` is always on `colliderA`.
   * - `normal` — the manifold's world-space normal, negated when flipped so it
   *   always points **from A towards B**, as `ContactPoint` requires.
   * - `separation` — `contactDist`, negative while interpenetrating.
   * - `impulse` — `contactImpulse`, the normal impulse the solver applied at
   *   that point during the step, in newton-seconds.
   * - `totalImpulse` — the sum of those impulses along the normal, which is
   *   what `CONTACT_FORCE_EVENTS` would report without needing a force
   *   threshold configured per collider.
   * - `relativeVelocity` — **computed by this adapter**, not reported by Rapier:
   *   the difference of the two bodies' velocities at the first contact point,
   *   read *after* the solve. It is therefore the post-impact relative velocity,
   *   not the approach velocity; scale impact responses by `totalImpulse`,
   *   which is the quantity the solver actually applied. Zero when the pair has
   *   no contacts.
   */
  #buildContacts(
    a: ColliderRecord,
    b: ColliderRecord,
    contacts: ContactPoint[],
    totalImpulse: Vector3,
    relativeVelocity: Vector3,
  ): void {
    const world = this.#requireWorld();
    const scratch = this.#scratchRapierB;
    let impulseSum = 0;
    let normalX = 0;
    let normalY = 0;
    let normalZ = 0;

    world.narrowPhase.contactPair(
      a.rapierHandle,
      b.rapierHandle,
      world.bodies,
      (manifold, flipped) => {
        const manifoldNormal = manifold.normal();
        normalX = flipped ? -manifoldNormal.x : manifoldNormal.x;
        normalY = flipped ? -manifoldNormal.y : manifoldNormal.y;
        normalZ = flipped ? -manifoldNormal.z : manifoldNormal.z;
        const first = flipped ? b : a;
        const second = flipped ? a : b;
        const count = manifold.numContacts();
        for (let i = 0; i < count; i += 1) {
          const localFirst = manifold.localContactPoint1(i);
          const localSecond = manifold.localContactPoint2(i);
          if (localFirst === null || localSecond === null) {
            continue;
          }
          const worldFirst = toWorldPoint(first.collider, localFirst, scratch);
          const worldSecond = toWorldPoint(
            second.collider,
            localSecond,
            scratch,
          );
          const impulse = manifold.contactImpulse(i);
          impulseSum += impulse;
          contacts.push({
            pointOnA: flipped ? worldSecond : worldFirst,
            pointOnB: flipped ? worldFirst : worldSecond,
            normal: new Vector3(normalX, normalY, normalZ),
            separation: manifold.contactDist(i),
            impulse,
          });
        }
      },
    );

    totalImpulse.set(
      normalX * impulseSum,
      normalY * impulseSum,
      normalZ * impulseSum,
    );

    const contact = contacts[0];
    if (contact === undefined) {
      return;
    }
    const bodyA = this.#bodies.get(a.bodyId);
    const bodyB = this.#bodies.get(b.bodyId);
    if (bodyA === undefined || bodyB === undefined) {
      return;
    }
    this.#scratchRapierA.x = contact.pointOnA.x;
    this.#scratchRapierA.y = contact.pointOnA.y;
    this.#scratchRapierA.z = contact.pointOnA.z;
    const velocityA = bodyA.body.velocityAtPoint(this.#scratchRapierA);
    const velocityB = bodyB.body.velocityAtPoint(this.#scratchRapierA);
    relativeVelocity.set(
      velocityA.x - velocityB.x,
      velocityA.y - velocityB.y,
      velocityA.z - velocityB.z,
    );
  }

  /** Re-points every surviving record at the restored world. See `restoreSnapshot`. */
  #rebuildRegistries(world: RapierWorld3d, meta: SnapshotMeta): void {
    const survivingBodies = new Map<number, BodyRecord>();
    const survivingColliders = new Map<number, ColliderRecord>();
    this.#bodiesByRapierHandle.clear();
    this.#collidersByRapierHandle.clear();

    // The envelope's per-body collider *count* is deliberately not read: the
    // list of ids is rebuilt from the `colliders` table below, which is the
    // same information in a form that also says *which* ids (2026-08-07).
    for (const [
      id,
      rapierHandle,
      sleeping,
      massMode,
      explicitMass,
    ] of meta.bodies) {
      const existing = this.#bodies.get(id);
      const body = world.getRigidBody(rapierHandle);
      const record: BodyRecord = existing ?? {
        id,
        rapierHandle,
        body,
        sleeping,
        massMode,
        explicitMass,
        colliderIds: [],
        alive: true,
      };
      record.rapierHandle = rapierHandle;
      record.body = body;
      record.sleeping = sleeping;
      record.massMode = massMode;
      record.explicitMass = explicitMass;
      record.colliderIds.length = 0;
      record.alive = true;
      survivingBodies.set(id, record);
      this.#bodiesByRapierHandle.set(rapierHandle, record);
    }

    for (const [
      id,
      rapierHandle,
      bodyId,
      sensor,
      collisionGroups,
      collisionMask,
    ] of meta.colliders) {
      const existing = this.#colliders.get(id);
      const collider = world.getCollider(rapierHandle);
      const record: ColliderRecord = existing ?? {
        id,
        rapierHandle,
        collider,
        bodyId,
        sensor,
        collisionGroups,
        collisionMask,
        alive: true,
      };
      record.rapierHandle = rapierHandle;
      record.collider = collider;
      record.bodyId = bodyId;
      record.sensor = sensor;
      record.collisionGroups = collisionGroups;
      record.collisionMask = collisionMask;
      record.alive = true;
      survivingColliders.set(id, record);
      this.#collidersByRapierHandle.set(rapierHandle, record);
      // Rebuilds the owning body's id list. `meta.colliders` is written in
      // `#colliders` order, i.e. ascending id, so appending keeps the list
      // sorted exactly as `createCollider` does.
      survivingBodies.get(bodyId)?.colliderIds.push(id);
    }

    const survivingJoints = new Map<number, JointRecord>();
    const jointWorld = world as unknown as RapierJointWorld3d;
    for (const [id, rapierHandle, type, bodyIdA, bodyIdB] of meta.joints) {
      // Widened past the transcribed non-nullable declaration on purpose: the
      // 3D `getImpulseJoint` delegates to `ImpulseJointSet.get`, which is
      // declared `ImpulseJoint | null` and which answers an unknown handle with
      // a live-*looking* object whose `handle` is `0` (measured — see
      // `RapierJointWorld3d`). Both shapes have to be caught here.
      const joint: RapierImpulseJoint3d | null | undefined =
        jointWorld.getImpulseJoint(rapierHandle);
      if (
        joint === null ||
        joint === undefined ||
        joint.handle !== rapierHandle
      ) {
        throw new FourError(
          ADAPTER_ERROR_CODE,
          `Snapshot names a ${type} joint that the restored Rapier world does not contain (§34); the envelope and its Rapier bytes do not belong together.`,
          { context: { adapter: ADAPTER_NAME, jointId: id } },
        );
      }
      const existing = this.#joints.get(id);
      const record: JointRecord = existing ?? {
        id,
        rapierHandle,
        joint,
        type,
        bodyIdA,
        bodyIdB,
        alive: true,
      };
      record.rapierHandle = rapierHandle;
      record.joint = joint;
      // Re-asserted like every other restored field (the 2D adapter has always
      // done this): a record reused across a restore must describe the joint
      // the *envelope* names, not the one it happened to describe before. A
      // snapshot restored into a world whose joint ids were rebuilt otherwise
      // kept a stale §28 type — which decides whether limits and motors exist —
      // and stale body links, which is what `destroyBody` retires joints by.
      record.type = type;
      record.bodyIdA = bodyIdA;
      record.bodyIdB = bodyIdB;
      record.alive = true;
      survivingJoints.set(id, record);
    }

    for (const record of this.#bodies.values()) {
      if (!survivingBodies.has(record.id)) {
        record.alive = false;
      }
    }
    for (const record of this.#colliders.values()) {
      if (!survivingColliders.has(record.id)) {
        record.alive = false;
      }
    }
    for (const record of this.#joints.values()) {
      if (!survivingJoints.has(record.id)) {
        record.alive = false;
      }
    }

    this.#bodies.clear();
    for (const [id, record] of survivingBodies) {
      this.#bodies.set(id, record);
    }
    this.#colliders.clear();
    for (const [id, record] of survivingColliders) {
      this.#colliders.set(id, record);
    }
    this.#joints.clear();
    for (const [id, record] of survivingJoints) {
      this.#joints.set(id, record);
    }
    this.#nextBodyId = meta.nextBodyId;
    this.#nextColliderId = meta.nextColliderId;
    this.#nextJointId = meta.nextJointId;
  }

  /** Rebuilds the touching-pair set from a restored narrow phase. */
  #rebuildActivePairs(world: RapierWorld3d): void {
    this.#activePairs.clear();
    const narrowPhase = world.narrowPhase;
    for (const record of this.#colliders.values()) {
      narrowPhase.contactPairsWith(record.rapierHandle, (otherHandle) => {
        const other = this.#collidersByRapierHandle.get(otherHandle);
        if (other === undefined) {
          return;
        }
        let touching = false;
        narrowPhase.contactPair(
          record.rapierHandle,
          otherHandle,
          world.bodies,
          (manifold) => {
            touching ||= manifold.numContacts() > 0;
          },
        );
        if (touching) {
          this.#rememberPair(record, other);
        }
      });
      narrowPhase.intersectionPairsWith(record.rapierHandle, (otherHandle) => {
        const other = this.#collidersByRapierHandle.get(otherHandle);
        if (
          other !== undefined &&
          narrowPhase.intersectionPair(record.rapierHandle, otherHandle)
        ) {
          this.#rememberPair(record, other);
        }
      });
    }
  }

  /** Adds a pair to the active set if it is not already there. */
  #rememberPair(a: ColliderRecord, b: ColliderRecord): void {
    const key = this.#pairKey(a, b);
    if (!this.#activePairs.has(key)) {
      this.#activePairs.set(key, { a, b, trigger: a.sensor || b.sensor });
    }
  }
}

/** Chooses the `MassMode` for a body from its §23 descriptor. */
function resolveMassMode(desc: RigidBodyDescriptor): MassMode {
  const hasDistribution =
    desc.centerOfMass !== undefined || desc.inertiaTensor !== undefined;
  if (desc.mass === undefined) {
    if (hasDistribution) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        "Rapier 3D sets mass, centre of mass, and rotational inertia as one quadruple, so centerOfMass or inertiaTensor requires an explicit mass as well (§23, §85).",
        { context: { adapter: ADAPTER_NAME } },
      );
    }
    return "collider-density";
  }
  return hasDistribution ? "body" : "first-collider";
}

/**
 * Applies the body's `MassMode` to a collider descriptor (§23, §25).
 *
 * `Collider.density` is authoritative over `PhysicsMaterial.density` — that rule
 * is `resolveDensity`'s, reused here so the adapter cannot drift from it.
 */
function applyColliderMass(
  colliderDesc: RapierColliderDesc3d,
  desc: ColliderDescriptor,
  body: BodyRecord,
): void {
  switch (body.massMode) {
    case "collider-density":
      colliderDesc.setDensity(resolveDensity(desc.density, desc.material));
      return;
    case "first-collider":
      if (body.colliderIds.length === 0) {
        colliderDesc.setMass(body.explicitMass);
      } else {
        colliderDesc.setDensity(0);
      }
      return;
    case "body":
      colliderDesc.setDensity(0);
      return;
    default: {
      const unknown: never = body.massMode;
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `Unknown mass mode ${String(unknown)}.`,
      );
    }
  }
}

/**
 * Writes `conj(from) · to` into `out` — the rotation that takes the `from`
 * frame to the `to` frame (§7b, plan D7: an `out` parameter, no allocation).
 *
 * This is the one piece of quaternion algebra a 3D joint needs and 2D does not.
 * `JointData.fixed` welds `q₁·frame1` to `q₂·frame2`, so preserving the pose
 * the two bodies already have means `frame1 = identity` and
 * `frame2 = conj(q₂)·q₁` — see {@link Rapier3dAdapter.createJoint}. Kept
 * module-private rather than added to `conversions3d.ts` because that module's
 * exports are all re-exported from the package barrel, which another packet
 * owns this wave; promoting it is a follow-up.
 */
function relativeRapierRotation3(
  from: RapierRotation3,
  to: RapierRotation3,
  out: RapierRotation3,
): RapierRotation3 {
  // conj(from) = (-x, -y, -z, w), then the Hamilton product with `to`.
  const ax = -from.x;
  const ay = -from.y;
  const az = -from.z;
  const aw = from.w;
  const { x: bx, y: by, z: bz, w: bw } = to;
  out.x = aw * bx + ax * bw + ay * bz - az * by;
  out.y = aw * by - ax * bz + ay * bw + az * bx;
  out.z = aw * bz + ax * by - ay * bx + az * bw;
  out.w = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/**
 * Transforms a collider-local contact point into world space.
 *
 * Rapier gives contact points in each collider's own frame; §29 wants world
 * space. The collider's world isometry is its `translation()` and `rotation()`,
 * which already include the parent body's pose. `scratch` absorbs the rotated
 * offset so the only allocation per contact point is the `Vector3` the event
 * payload keeps.
 */
function toWorldPoint(
  collider: RapierCollider3d,
  local: RapierVector3,
  scratch: RapierVector3,
): Vector3 {
  const translation = collider.translation();
  const rotated = rotateVectorByRotation3(collider.rotation(), local, scratch);
  return new Vector3(
    translation.x + rotated.x,
    translation.y + rotated.y,
    translation.z + rotated.z,
  );
}
