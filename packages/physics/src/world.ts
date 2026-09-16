/**
 * `PhysicsWorld` (§20, §30, §32, §33, §34, §37, §39, §42, §43) — the object an
 * application holds and a solver adapter serves.
 *
 * §20's promise is that "users should not need to write solver-specific
 * application code for common tasks". `PhysicsWorld` is where that promise is
 * kept: it owns the registration of §6a components into a solver, the fixed-step
 * pipeline of §37/§39, the §42 transform writes, §30's named queries, §33's
 * checksum, and §34's snapshot metadata — all of it phrased over
 * `PhysicsSolverAdapter` + {@link SolverBodyAccess} and never over a solver.
 *
 * ```ts
 * const world = new PhysicsWorld({ dimension: "2d", adapter, poses: app.poses });
 * await world.initialize();
 *
 * const ball = new Group();
 * ball.transformAuthority = "physics";           // §42: the solver owns the pose
 * ball.transform.position.set(0, 5, 0);
 * ball.addComponent(new RigidBody({ type: "dynamic" }));
 * ball.addComponent(new Collider({ shape: { type: "circle", radius: 0.5 } }));
 * world.addBody(ball);
 *
 * app.systems.register(new PhysicsSystem({ worlds: [world] }));
 * ```
 *
 * ## The fixed step (§37, §39, plan P5-2)
 *
 * {@link PhysicsWorld.step} runs one fixed step in exactly this order, and
 * {@link PhysicsWorld.dispatchEvents} delivers the step's events afterwards:
 *
 * ```text
 * 1. per body, in registration order:
 *      queued §37 property changes → SolverBodyTuningAccess, then cleared
 *        (§23 mass triple, damping, gravity scale, §31 mode; and each dirty
 *         collider's §25 material and §24 filter — PH-1 stage 2)
 *      resetForces → the §26 command buffer → the §32 sleep command → clear
 *      kinematic bodies: setNextKinematicTransform / setBodyVelocities
 *        ("blended" nodes feed the PoseTarget instead of the transform, §19)
 *    per joint, in registration order: queued §28 limit/motor changes
 * 2. adapter.syncSceneToSolver()      ← §37 call-order hook (may be a no-op)
 * 3. adapter.step(fixedDeltaTime)     ← §10: seconds, never milliseconds
 * 4. adapter.syncSolverToScene()      ← §37 call-order hook (may be a no-op)
 * 5. per body, in registration order:
 *      "blended" → node.transform = blend(target pose, solver pose) (§19, §42)
 *      dynamic   → node.transform under "physics" authority (§42)
 *      every body → RigidBody velocities, RigidBody.sleeping (§23, §32)
 * 6. adapter.drainEvents() → translated to component references and queued
 * 7. per breakable joint, in registration order: reaction vs §28 thresholds →
 *      destroy + queue "jointbreak" (plan P6-2)
 * 8. dispatchEvents() → §29 events on node emitters (§39 step 9, §6b)
 * ```
 *
 * The property changes at the top of step 1 come **before** the forces because
 * a force applied in the same frame as a mass change should act on the new
 * mass. A body nobody wrote to costs one integer comparison there and no solver
 * call, which is why a quiet world's call sequence is exactly what it was
 * before that line existed (§33).
 *
 * Step 7 comes after step 6 because a break is the engine's *conclusion* from
 * the solved step, not something that happened during it: the contacts of the
 * step are queued first and the breaks that follow from them last, which is the
 * order a listener reads them in.
 *
 * Step 8 is deliberately a separate call: §39 puts event dispatch after the
 * solve, and `PhysicsSystem` steps *every* world before dispatching any world's
 * events, so a listener that touches a second world always sees a world that has
 * finished its step. A listener may create bodies, destroy bodies, or step
 * nothing at all — the queue was handed over before the first callback ran.
 *
 * ## Poses and §43 interpolation
 *
 * A world given a `PoseBuffer` tracks the node of every **dynamic** body it
 * registers and untracks it on removal. It does not capture: §39 puts the pose
 * snapshot at step 10 (`PRIORITY_SNAPSHOT`, after the solve at step 6), so the
 * engine's one capture — `createSnapshotSystem`, registered by `Application`
 * whenever pose interpolation is on — already records the post-step pose as
 * "current" and the previous step's post-step pose (which *is* the pre-step
 * pose, since nothing else moves a body between steps) as "previous". A second
 * capture from inside the physics step would shift the pair twice per step and
 * flatten interpolation to a constant, which is the artefact §43 exists to
 * remove. See `@fourjs/scene`'s `interpolation.ts`, which states the same
 * arrangement from the buffer's side.
 *
 * An application that drives a world without the snapshot system gets no
 * interpolation and should register `createSnapshotSystem(poses)`.
 *
 * A `"blended"` node is tracked whatever its §22 body type, because the §19
 * pipeline writes its transform every step; a `"physics"` node is tracked
 * exactly while it is dynamic, as before. Tracking follows the node's live
 * authority — it is re-evaluated in the publish pass, so flipping
 * `transformAuthority` after registration is honoured from the next step.
 *
 * ## §19 blending, and the one system this package cannot register itself
 *
 * Under `"blended"` authority (§42) the world runs §19's pipeline for a node:
 * before the solve it feeds the node's `PoseTarget` to a kinematic body, and
 * after the solve it writes the weighted combination of that target and the
 * solver's pose (see {@link PhysicsWorld.step}). It needs the trio — `"blended"`
 * authority, a `RigidBody` registered here, and a `PoseTarget` on the node — and
 * says so with a `FourError` naming the missing piece.
 *
 * §19's finite-difference history (`PoseTarget.previousPosition`, which
 * `setBodyControlMode`'s velocity inheritance reads) needs
 * `PoseTarget.capturePrevious` called **once per fixed step, before that step's
 * animation writes**, which is *earlier* than the solve and therefore cannot
 * happen inside {@link PhysicsWorld.step}. That call site is
 * {@link PhysicsWorld.capturePoseTargets}, wrapped by
 * {@link createPoseTargetCaptureSystem} — a second `SimulationSystem` the
 * application must register alongside `PhysicsSystem`:
 *
 * ```ts
 * const physics = new PhysicsSystem({ worlds: [world] });
 * app.systems.register(createPoseTargetCaptureSystem(physics.worlds));
 * app.systems.register(physics);
 * ```
 *
 * Forgetting it does not break the blend — the blend reads the target's
 * *current* pose — but it leaves every target's history STALE at whatever
 * `copyFrom` seeded, so `setBodyControlMode(..., { inheritVelocityFrom })`
 * divides the target's TOTAL animated displacement by one fixed delta and
 * inherits a wildly inflated velocity (measured: 60 m/s from a 2 m/s
 * animation after half a second — WP-7.5). Zero is inherited only for a
 * never-animated target. Register the capture system whenever inheritance
 * is used.
 *
 * ## What the world does not own
 *
 * The scheduler (§10: the accumulator and the sub-step clamp are the
 * application clock's), the node transforms of anything but registered dynamic
 * bodies, and the adapter's lifetime before construction. `dispose()` does
 * dispose the adapter — a world is the only thing that steps it, and §83 wants
 * one owner.
 */

import {
  DEFAULT_SPACE_MODE,
  DEV_WARNING_PREFIX,
  FourError,
  isSimulationSpaceMode,
} from "@fourjs/core";
import { Quaternion, Vector2, Vector3 } from "@fourjs/math";
import {
  PRIORITY_ANIMATION_TARGETS,
  type SimulationSystem,
} from "@fourjs/motion";
import {
  PoseTarget,
  warnAuthorityConflict,
  type Node,
  type PoseBuffer,
  type TransformAuthority,
} from "@fourjs/scene";

import type {
  PhysicsSolverAdapter,
  PhysicsTuningCapabilities,
} from "./adapter.js";
import { resolveTuningCapabilities } from "./adapter.js";
import type {
  SolverBodyAccess,
  SolverBodyTuningAccess,
  SolverJointAccess,
} from "./body-access.js";
import {
  missingSolverJointAccess,
  supportsSolverBodyTuning,
  supportsSolverJointAccess,
} from "./body-access.js";
import { Collider } from "./collider.js";
import type {
  ColliderTriggerEvent,
  RigidBodyCollisionEvent,
} from "./collider.js";
import type {
  PhysicsWorldOptions,
  RigidBodyDescriptor,
} from "./descriptors.js";
import {
  resolveAngularVelocity,
  resolveGravity,
  resolveRotation,
  resolveSleepingConfig,
  widenToVector3,
} from "./descriptors.js";
import {
  planeToWorld,
  planeToWorldVec,
  resolveLocalPlane,
  worldToPlane,
  worldToPlaneVec,
  type ResolvedLocalPlane,
} from "./local-plane.js";
import {
  fromSiLength,
  fromSiMass,
  resolvePhysicsWorldUnits,
  toSiLength,
  toSiMass,
  type PhysicsWorldUnits,
} from "./world-units.js";
import type { JointBreakEvent, PhysicsEvent } from "./events.js";
import type { Joint, JointBinding, JointBreakPayload } from "./joints.js";
import {
  bindJoint,
  clearJointCommands,
  readJointAnchors,
  readJointLimits,
  readJointMotor,
  setJointBroken,
  unbindJoint,
  worldAnchorToLocal,
  worldAxisToLocal,
} from "./joints.js";
import type {
  OverlapQuery,
  PointQuery,
  QueryOptions,
  RaycastQuery,
  ShapeCastQuery,
} from "./queries.js";
import type { BlendWeights, RigidBodySleepEvent } from "./rigid-body.js";
import {
  RIGID_BODY_CCD_DIRTY,
  RIGID_BODY_DAMPING_DIRTY,
  RIGID_BODY_GRAVITY_SCALE_DIRTY,
  RIGID_BODY_MASS_PROPERTIES_DIRTY,
  RigidBody,
  clearRigidBodyCommands,
  drainRigidBodySolverWrites,
  setRigidBodyDerivedMass,
  setRigidBodyRegistered,
  setRigidBodySleeping,
  setRigidBodyType,
} from "./rigid-body.js";
import type { CollisionShape } from "./shapes.js";
import { shapeMaximumExtent } from "./shapes.js";
import type {
  SolverRegistry,
  SolverRejectionReport,
  SolverSelection,
} from "./solver-registry.js";
import { resolveSolver } from "./solver-registry.js";
import type {
  AngularVelocityInput,
  BodyType,
  DeterminismLevel,
  PhysicsBodyHandle,
  PhysicsColliderHandle,
  PhysicsDimension,
  PhysicsJointHandle,
  RotationInput,
  SleepingConfig,
  Vector3Input,
} from "./types.js";
import {
  DEFAULT_DETERMINISM_LEVEL,
  DEFAULT_SLEEPING_CONFIG,
  DETERMINISM_LEVELS,
} from "./types.js";
import {
  validateJointDescriptor,
  validateMass,
  validatePhysicsWorldOptions,
} from "./validation.js";
import {
  noteSolverBody,
  noteSolverCollider,
  noteSolverJoint,
} from "./resource-memory.js";

/** See the rest of the package: §89 has no physics-input code, so misuse is this. */
const WORLD_ERROR_CODE = "INVALID_APPLICATION_STATE";

/** The §42 authority a solver writes under. */
const PHYSICS_AUTHORITY = "physics";

/** The §42 authority §19's blend pipeline writes under (plan P7-4). */
const BLENDED_AUTHORITY = "blended";

/** Quantization grid of §33's checksum: values snap to multiples of 1e-6. */
const QUANTIZATION_SCALE = 1e6;

/** FNV-1a 32-bit offset basis — also the digest of an empty world. */
const FNV_OFFSET_BASIS = 2166136261;

/** FNV-1a 32-bit prime. */
const FNV_PRIME = 16777619;

/** 2^32, the word boundary of §33's two-word float encoding. */
const TWO_POW_32 = 4294967296;

/**
 * §41's distance-from-origin limit, in world units — the figure
 * `docs/guides/units-and-numerical-stability.md` publishes verbatim, and the
 * envelope release 1.0 supports (PH-22n).
 */
const SUSPICIOUS_COORDINATE = 1e5;

/**
 * The largest a **dynamic** collider may be before §41's world-scale
 * diagnostic fires, in world units.
 *
 * Two decades past the guide's ~10-unit advice: a 40-unit vehicle is a design
 * choice, a 1000-unit dynamic body is a units mistake (PH-22n).
 */
const SUSPICIOUS_EXTENT_MAXIMUM = 1e3;

/** The smallest a dynamic collider may be — two decades past ~0.1 (PH-22n). */
const SUSPICIOUS_EXTENT_MINIMUM = 1e-2;

/**
 * The dynamic mass ratio §41's diagnostic fires at.
 *
 * One decade past the guide's ~100× advice, so the warning means "far enough
 * past the guidance that the solver will show it" rather than "you are near
 * the guidance" (PH-22n).
 */
const SUSPICIOUS_MASS_RATIO = 1000;

/**
 * A solver adapter a world can drive: §37's contract plus the per-handle access
 * of {@link SolverBodyAccess}.
 *
 * Both halves are required. §37 alone cannot move a solved pose onto a node —
 * it has no per-body read — and {@link SolverBodyAccess} alone has no world to
 * read from.
 */
export type PhysicsWorldAdapter = PhysicsSolverAdapter & SolverBodyAccess;

/**
 * What {@link PhysicsWorld.forEachActiveBody} hands its caller for one body:
 * the component, the node it is attached to, and the body's world-space centre
 * of mass (§25).
 *
 * `centerOfMass` is a **shared** vector the world overwrites on every visit —
 * read it or copy it inside the callback, never retain it (§7b).
 */
export type ActiveBodyVisitor = (
  body: RigidBody,
  node: Node,
  centerOfMass: Vector3,
) => void;

/**
 * How a {@link PhysicsWorld} is constructed: §20's world options plus the
 * adapter instance (plan P5-5) and the optional §43 pose store.
 *
 * Named `…Init` rather than `…Options` because `PhysicsWorldOptions` is already
 * §37's own record — the one handed to `adapter.initialize` — and this type is
 * that record *plus* the engine-side wiring, which is not part of what a solver
 * is configured with.
 */
export interface PhysicsWorldInit extends PhysicsWorldOptions {
  /**
   * The solver this world drives, as an instance the application constructed
   * (plan P5-5).
   *
   * Its `capabilities` are checked against `dimension` and `determinism` at
   * construction, so a world that cannot be simulated fails immediately rather
   * than degrading quietly (§37).
   *
   * Exactly one of `adapter` and {@link PhysicsWorldInit.solver} is required;
   * giving both is refused rather than silently preferring one (§85).
   */
  adapter?: PhysicsWorldAdapter;

  /**
   * §20's `solver: "auto"` — or one §102 solver by name — resolved through
   * `@fourjs/physics`'s solver registry (PH-19, 2026-08-07).
   *
   * The alternative to {@link PhysicsWorldInit.adapter}, and the reason it took
   * this long: resolving a name means *something* has to map it to a class, and
   * that something must not be this package, which would then import every
   * solver Rapier and Box2D ship — wasm images included — into every program
   * that ever named `PhysicsWorld`. So a solver package opts in explicitly and
   * this option resolves against whatever the application actually imported:
   *
   * ```ts
   * import { registerRapierSolver } from "@fourjs/physics-rapier";
   *
   * registerRapierSolver();
   * const world = new PhysicsWorld({ dimension: "3d", solver: "auto" });
   * ```
   *
   * `"auto"` takes the first registered solver whose §37 capabilities cover
   * this world's `dimension` and `determinism` (§20, §37); a name is handed
   * back unfiltered, so an unsatisfiable one fails with this constructor's own
   * §21/§33 message. Either way the adapter arrives **uninitialized** and
   * {@link PhysicsWorld.initialize} awaits it exactly as it awaits one you
   * constructed yourself.
   */
  solver?: SolverSelection;

  /**
   * The registry {@link PhysicsWorldInit.solver} resolves against; the shared
   * one by default (§37).
   *
   * Pass one to keep a selection scope to itself — the discipline the tests use
   * so that one world's registrations are invisible to the next.
   */
  solverRegistry?: SolverRegistry;

  /**
   * Called for each solver `solver: "auto"` passes over, with the §37 reason
   * (`"unsupported"`, `"dimension"`, `"determinism"`).
   *
   * The solver-side twin of §62's fallback diagnostics event, delivered as a
   * callback for the same reason: the frozen §3.1 matrix gives `@fourjs/physics`
   * no `@fourjs/diagnostics` edge, so the report is handed to the application to
   * route. Unread for an instance or a named solver.
   */
  onSolverReject?: (report: SolverRejectionReport) => void;

  /**
   * The engine's previous/current pose store (§43). When given, the node of
   * every dynamic body — and of every `"blended"` node, whatever its §22 type
   * — is tracked on registration and untracked on removal; see the module
   * header for why the world never captures into it.
   */
  poses?: PoseBuffer;
}

/** What every world-level query hit identifies: one collider and its body (§30). */
export interface WorldQueryHit {
  /** The collider that was hit, as the §6a component. */
  readonly collider: Collider;
  /** The body owning {@link WorldQueryHit.collider}. */
  readonly body: RigidBody;
}

/** One intersection along a ray (§30 `world.raycast`). */
export interface WorldRaycastHit extends WorldQueryHit {
  /** Intersection point in world space. */
  readonly point: Vector3;
  /** Unit surface normal in world space, pointing out of the hit collider. */
  readonly normal: Vector3;
  /** Distance from the ray origin, in world units. */
  readonly distance: number;
}

/** One impact of a swept shape (§30 `world.shapeCast`). */
export interface WorldShapeCastHit extends WorldQueryHit {
  /** The witness point on the hit collider, in world space. */
  readonly point: Vector3;
  /** Unit contact normal at the impact, in world space. */
  readonly normal: Vector3;
  /** Distance the shape travelled before touching, in world units. */
  readonly distance: number;
}

/** One collider overlapping the query volume (§30 `overlapSphere`/`overlapBox`). */
export type WorldOverlapHit = WorldQueryHit;

/** One collider containing the queried point (§30 `world.pointQuery`). */
export interface WorldPointHit extends WorldQueryHit {
  /** The closest point on the collider's surface, in world space. */
  readonly point: Vector3;
  /** Distance from the query point to that surface; `0` when inside. */
  readonly distance: number;
}

/**
 * A §29 event as it reaches node listeners: the same payload the adapter
 * returned, with handles swapped for the §6a components (§101 "event
 * normalization").
 *
 * `"jointbreak"` (§28, plan P6-2) rides the same union with its handle swapped
 * for the {@link Joint} — the world produces that one itself rather than
 * translating it, but it is queued and dispatched with everything else.
 */
export type WorldPhysicsEvent = PhysicsEvent<RigidBody, Collider, Joint>;

/**
 * A solver snapshot plus the validity key §34 requires.
 *
 * §34: *"Snapshots are opaque adapter data: a snapshot is valid only for the
 * same adapter, adapter version, and world configuration that produced it"*, and
 * a replay "refuses to run against a different solver". The world therefore
 * never hands out a bare `ArrayBuffer`: {@link PhysicsWorld.restoreSnapshot}
 * checks the two recorded fields before the bytes reach the adapter, which turns
 * "restored into the wrong solver" from silent corruption into an error at the
 * call site.
 */
export interface PhysicsSnapshot {
  /** `PhysicsSolverAdapter.name` at capture time, e.g. `"rapier2d"`. */
  readonly adapterName: string;
  /** `PhysicsSolverAdapter.version` at capture time. */
  readonly adapterVersion: string;
  /** The adapter's opaque bytes (§34). */
  readonly data: ArrayBuffer;
  /**
   * The world configuration the bytes were captured under (2026-08-04 —
   * closing the recorded Phase 5 gap "world-configuration mismatch is not
   * refused; name/version only").
   *
   * Optional because two legitimate producers cannot supply it: snapshots
   * decoded from the §34 replay document (whose format records adapter
   * identity, not world configuration) and captures made before the field
   * existed. When present, {@link PhysicsWorld.restoreSnapshot} refuses a
   * mismatch field by field; when absent, the name/version check is the whole
   * §34 guarantee, exactly as before.
   */
  readonly configuration?: PhysicsSnapshotConfiguration;
}

/**
 * The world configuration recorded in a {@link PhysicsSnapshot} (§34).
 *
 * Every field here changes what stepping the restored bytes produces, so a
 * mismatch means the restored run is **not** a continuation of the captured
 * one — the §33/§34 promise — even though the adapter would deserialize the
 * bytes without complaint. Gravity is the resolved 3-tuple, sleeping the
 * resolved §32 record (Appendix A defaults filled in), so two worlds that
 * spell the same configuration differently still compare equal.
 */
export interface PhysicsSnapshotConfiguration {
  /** `"2d"` or `"3d"` (§21). */
  readonly dimension: PhysicsDimension;
  /** Resolved world gravity, m/s² (§21, Appendix A). */
  readonly gravity: readonly [number, number, number];
  /** Resolved §32 sleeping configuration. */
  readonly sleeping: SleepingConfig;
  /** The §33 tier the world asked for. */
  readonly determinism: DeterminismLevel;
  /** §28 solver iterations, when the world set them (absent = solver default). */
  readonly solverIterations?: number;
}

/**
 * How {@link PhysicsWorld.setBodyControlMode} performs a §19 control-mode
 * transition (plan P7-3).
 *
 * Every field is optional: the bare call re-types the body, wakes it, and seeds
 * nothing.
 */
export interface BodyControlModeOptions {
  /**
   * A `PoseTarget` (§19, plan P7-1) whose one-step history seeds the body's
   * velocities as part of the switch — "the ragdoll keeps the motion the
   * animation had".
   *
   * The component's `position`/`previousPosition` and
   * `rotation`/`previousRotation` pair is finite-differenced over the fixed
   * step; see {@link PhysicsWorld.setBodyControlMode} for the exact formula and
   * for which target types accept it.
   */
  inheritVelocityFrom?: PoseTarget;

  /**
   * The fixed step, in seconds (§7a, §10), that the inherited difference is
   * divided by.
   *
   * Omit it and the world uses the `deltaSeconds` of its **last**
   * {@link PhysicsWorld.step}, which is the fixed delta the target history was
   * actually captured across. It is only needed when no step has run yet — a
   * body activated before the first step of the simulation — or when a caller
   * knows the application's fixed delta better than the world does. Ignored
   * entirely without {@link BodyControlModeOptions.inheritVelocityFrom}.
   */
  fixedDeltaSeconds?: number;

  /**
   * Whether the switch wakes a sleeping body (§32). Defaults to `true`, which
   * is what activating a body means; pass `false` to re-type without disturbing
   * the sleep state.
   */
  wake?: boolean;
}

/** One registered collider: the component, its handle, and its monotonic id. */
interface ColliderRegistration {
  readonly collider: Collider;
  readonly handle: PhysicsColliderHandle;
  readonly id: number;
  readonly body: BodyRegistration;
  /**
   * Whether {@link PhysicsWorld.refreshCollider} has asked for this collider's
   * §24/§25 properties to be re-read at the next fixed step (PH-1 stage 2).
   *
   * A flag on the *registration* and not on the component, unlike
   * `RigidBody.pendingSolverWrites`: `Collider`'s material and filter are plain
   * public fields with no setters to hook, so the request is explicit anyway —
   * and an explicit request belongs to the world that will serve it rather than
   * to a component that may be registered with another.
   */
  dirty: boolean;
}

/** One registered body and everything the per-step pipeline needs about it. */
interface BodyRegistration {
  readonly node: Node;
  readonly body: RigidBody;
  readonly handle: PhysicsBodyHandle;
  readonly id: number;
  /**
   * The §22 type the **solver** is currently running this body as.
   *
   * The pipeline branches on this rather than on the live `body.type` so that a
   * type assigned straight onto the component cannot desynchronize the engine
   * from the solver: `body.type = "dynamic"` changes what the component says,
   * not what the solver does. {@link PhysicsWorld.setBodyControlMode} is the one
   * writer that moves both at once (plan P7-3), and it is what keeps this field
   * equal to the solver's own type.
   */
  type: BodyType;
  /** Registered colliders in creation order; destroyed in reverse. */
  readonly colliders: ColliderRegistration[];
  /**
   * Whether the node is tracked in the §43 pose buffer by this registration.
   *
   * Tracked exactly while the body is dynamic (see
   * {@link PhysicsWorld.addBody}), which is why
   * {@link PhysicsWorld.setBodyControlMode} may flip it: a body re-typed away
   * from `"dynamic"` is no longer a body the solver moves, and one re-typed
   * into it is.
   */
  tracked: boolean;
  /**
   * Captured at registration: whether this body authors its pose in the
   * world's §21 local plane. A later write to `RigidBody.space` does not
   * flip the mapping — the same rule `space` already documents.
   */
  readonly localPlane: boolean;
}

/** One registered joint: the object, its handle, and its monotonic id (§28). */
interface JointRegistration {
  readonly joint: Joint;
  readonly handle: PhysicsJointHandle;
  readonly id: number;
  /** The two body registrations, so removing a body can retire its joints. */
  readonly bodyA: BodyRegistration;
  readonly bodyB: BodyRegistration;
}

/**
 * Quantizes one value to §33's 1e-6 grid, normalizing `-0` to `+0` first.
 *
 * Identical to `@fourjs/diagnostics`'s D6 hasher, which `@fourjs/physics` may not
 * import (the frozen dependency matrix gives this package core, math, scene, and
 * motion only). The two implementations must agree byte for byte; see
 * {@link PhysicsWorld.checksum}.
 */
function quantize(x: number): number {
  if (!Number.isFinite(x)) {
    throw new RangeError(
      `Checksum inputs must be finite numbers (§33 quantization is undefined for ${String(x)}).`,
    );
  }
  const normalized = x === 0 ? 0 : x;
  const q = Math.round(normalized * QUANTIZATION_SCALE);
  if (Math.abs(q) > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(
      `Checksum input ${String(x)} quantizes to ${String(q)}, outside the 53-bit-safe range ` +
        `(±${String(Number.MAX_SAFE_INTEGER)}); §41 supports coordinates within ~1e5 units of the origin.`,
    );
  }
  return q === 0 ? 0 : q;
}

/** Absorbs the four little-endian bytes of a 32-bit word into an FNV-1a state. */
function absorbWord(state: number, word: number): number {
  const w = word >>> 0;
  let h = state;
  h = Math.imul(h ^ (w & 0xff), FNV_PRIME) >>> 0;
  h = Math.imul(h ^ ((w >>> 8) & 0xff), FNV_PRIME) >>> 0;
  h = Math.imul(h ^ ((w >>> 16) & 0xff), FNV_PRIME) >>> 0;
  h = Math.imul(h ^ ((w >>> 24) & 0xff), FNV_PRIME) >>> 0;
  return h;
}

/** Absorbs one float as its quantized low then high uint32 word (§33, D6). */
function absorbFloat(state: number, x: number): number {
  const q = quantize(x);
  let low = q % TWO_POW_32;
  if (low < 0) {
    low += TWO_POW_32;
  }
  const high = (q - low) / TWO_POW_32;
  return absorbWord(absorbWord(state, low), high);
}

/**
 * A simulated world (§20) driven by one solver adapter.
 *
 * See the module header for the pipeline, the pose contract, and what the world
 * does not own.
 */
/**
 * The adapter a {@link PhysicsWorldInit} names: the instance it carries, or the
 * one its `solver` selection resolves to (§20, §37; PH-19).
 *
 * Exactly one of the two, checked here rather than in the type system, because
 * a `PhysicsWorldInit` union would ripple through every caller that builds an
 * init record field by field for the sake of a mistake that costs one `if`.
 * Both and neither are refused with the same §85 loudness: an init carrying an
 * `adapter` *and* a `solver` has two different intentions in it, and silently
 * preferring one would make which solver ran a matter of reading this file.
 */
function selectAdapter(init: PhysicsWorldInit): PhysicsWorldAdapter {
  if (init.adapter !== undefined) {
    if (init.solver !== undefined) {
      throw new FourError(
        WORLD_ERROR_CODE,
        `A PhysicsWorld takes either an \`adapter\` instance or a \`solver\` selection, not both (§20, §37); this init carries an adapter and solver ${JSON.stringify(init.solver)}.`,
        { context: { adapter: init.adapter.name, solver: init.solver } },
      );
    }
    return init.adapter;
  }
  if (init.solver === undefined) {
    throw new FourError(
      WORLD_ERROR_CODE,
      'A PhysicsWorld needs a solver: pass `adapter` (an instance you constructed) or `solver` ("auto", or a §102 solver by name, resolved through the registry a solver package registers itself into) — §20, §37.',
      { context: { dimension: init.dimension } },
    );
  }
  return resolveSolver(
    init.solver,
    {
      // The §37 record the selection reads, spelled out rather than spread:
      // `init` also carries `adapter`, `poses`, and the registry itself, none
      // of which is a world option.
      dimension: init.dimension,
      gravity: init.gravity,
      sleeping: init.sleeping,
      determinism: init.determinism,
      solverIterations: init.solverIterations,
      onReject: init.onSolverReject,
    },
    init.solverRegistry,
  );
}

export class PhysicsWorld {
  /** The adapter this world drives (plan P5-5). */
  readonly #adapter: PhysicsWorldAdapter;

  /** The §21 dimension, fixed at construction. */
  readonly #dimension: PhysicsDimension;

  /** Resolved world gravity in m/s² (§21, Appendix A). Owned; never handed out. */
  readonly #gravity: Vector3;

  /**
   * §40 scale factors, or `undefined` when omitted — the identity path.
   * Pointer-check only; existing worlds never pay a multiply.
   */
  readonly #units: PhysicsWorldUnits | undefined;

  /** §21 simulation plane. Default XY is the shared identity map. */
  readonly #localPlane: ResolvedLocalPlane;

  /** Resolved §32 sleeping configuration, frozen. */
  readonly #sleeping: SleepingConfig;

  /**
   * What the adapter declared it actually applies of §25's rolling/spinning
   * friction and §32's sleeping thresholds — {@link NO_TUNING_CAPABILITIES}
   * when it declared nothing. See {@link PhysicsTuningCapabilities}.
   */
  readonly #tuning: PhysicsTuningCapabilities;

  /**
   * The adapter's §37 property-change seam, or `undefined` when it does not
   * implement one (PH-1 stage 2, 2026-08-07).
   *
   * Resolved once, at construction, by `supportsSolverBodyTuning` — the same
   * structural detection `#jointAccess` uses, and for the same reasons. It is
   * what {@link PhysicsWorld.supportsLiveProperties} reports and what decides
   * whether `RigidBody`'s setters queue a write or warn that it goes nowhere.
   */
  readonly #bodyTuning: SolverBodyTuningAccess | undefined;

  /**
   * How many registered colliders {@link PhysicsWorld.refreshCollider} has
   * marked and no step has served yet.
   *
   * The whole reason it exists is that `0` — the value in every step of every
   * world that never calls `refreshCollider` — lets the step skip the collider
   * scan outright, so this feature adds one integer comparison per step and not
   * one per collider (§33: the goldens must not move).
   */
  #dirtyColliderCount = 0;

  /**
   * Scratch for {@link PhysicsWorld.teleport}'s "keep the current rotation"
   * path, which has to read the solver's pose before it writes one back (§7b,
   * plan D7). Never escapes the method.
   */
  readonly #teleportPosition = new Vector3();

  /** See {@link PhysicsWorld.#teleportPosition}. */
  readonly #teleportRotation = new Quaternion();

  /**
   * Feed/publish scratch for the §21 plane map and §40 SI conversion, so a
   * mapped body allocates nothing (§7b). Unused on the identity path.
   */
  readonly #mapPosition = new Vector3();

  /** @see PhysicsWorld.#mapPosition */
  readonly #mapRotation = new Quaternion();

  /** @see PhysicsWorld.#mapPosition */
  readonly #mapLinear = new Vector3();

  /** @see PhysicsWorld.#mapPosition */
  readonly #mapAngular = new Vector3();

  /**
   * Which accept-and-ignore warnings this world has already emitted, allocated
   * on the first one. Once per world per field: a scene with two hundred
   * rolling-friction colliders has made one mistake, not two hundred.
   */
  #tuningWarned?: Set<string>;

  /**
   * The lightest and heaviest dynamic solver mass this world has registered,
   * for §41's mass-ratio diagnostic (PH-22n). Allocated on the first dynamic
   * body with a positive mass; a world of static geometry never pays for it.
   */
  #massRange?: { minimum: number; maximum: number };

  /** The §33 tier this world asked for, which the adapter can meet. */
  readonly #determinism: DeterminismLevel;

  /** The exact record handed to `adapter.initialize` (§37). */
  readonly #options: PhysicsWorldOptions;

  /** The §43 pose store, when the application supplied one. */
  readonly #poses: PoseBuffer | undefined;

  /**
   * Registered bodies keyed by node, in **registration order** — `Map`
   * iteration is insertion order, which is the only order §33 permits.
   */
  /**
   * Dynamic bodies registered with no collider and no explicit `inertiaTensor`, waiting
   * for the first step to say whether they still have nothing to derive inertia from.
   *
   * Not checked at `addBody`, because PH-5 lets a collider arrive after registration: at
   * that moment a body that will be fine looks exactly like one that never will be.
   */
  readonly #inertialessBodies = new Set<BodyRegistration>();

  readonly #bodiesByNode = new Map<Node, BodyRegistration>();

  /** Registered bodies keyed by the adapter's monotonic id (§33, event mapping). */
  readonly #bodiesById = new Map<number, BodyRegistration>();

  /**
   * Registered bodies keyed by their `RigidBody` component — the lookup
   * {@link PhysicsWorld.addJoint} needs, since §28's joints name components and
   * not nodes.
   */
  readonly #bodiesByComponent = new Map<RigidBody, BodyRegistration>();

  /** Registered colliders keyed by the adapter's monotonic id. */
  readonly #collidersById = new Map<number, ColliderRegistration>();

  /**
   * Registered colliders keyed by their `Collider` component — the index
   * {@link PhysicsWorld.getColliderHandle} answers from, kept in step with
   * {@link PhysicsWorld.addBody} and `#destroyRegistration`.
   */
  readonly #collidersByComponent = new Map<Collider, ColliderRegistration>();

  /** Registered joints in **registration order** (§28, §33). */
  readonly #jointsByJoint = new Map<Joint, JointRegistration>();

  /** Registered joints keyed by the adapter's monotonic id (§33, event mapping). */
  readonly #jointsById = new Map<number, JointRegistration>();

  /** Events drained from the last step, awaiting {@link PhysicsWorld.dispatchEvents}. */
  #queue: WorldPhysicsEvent[] = [];

  #initializeStarted = false;

  #initialized = false;

  #disposed = false;

  /**
   * The one vector {@link PhysicsWorld.forEachActiveBody} hands its visitor, so
   * the walk allocates nothing (§7b, D7). Overwritten on every visit.
   */
  readonly #visitCenterOfMass = new Vector3();

  /** Checksum scratch, so a per-step checksum allocates nothing (§7b, D7). */
  readonly #checksumPosition = new Vector3();

  readonly #checksumRotation = new Quaternion();

  readonly #checksumLinear = new Vector3();

  readonly #checksumAngular = new Vector3();

  /** Break-monitoring scratch, so the per-step joint pass allocates nothing. */
  /** Last `collisionstay` interest forwarded to the adapter; `null` until the first step. */
  #stayInterest: boolean | null = null;

  /** Per-step snapshot scratch for {@link PhysicsWorld.#monitorJointBreakage}. */
  readonly #jointScratch: JointRegistration[] = [];

  readonly #reactionLinear = new Vector3();

  readonly #reactionAngular = new Vector3();

  /**
   * Velocity-inheritance scratch, so a §19 control-mode switch allocates
   * nothing (§7b, D7). See {@link PhysicsWorld.setBodyControlMode}.
   */
  readonly #inheritedLinear = new Vector3();

  readonly #inheritedAngular = new Vector3();

  readonly #inheritedDelta = new Quaternion();

  readonly #inheritedInverse = new Quaternion();

  /**
   * §19 blend scratch, so a blended step allocates nothing (§7b, D7): the
   * solver's pose is read into these and combined with the target *in place*
   * before one copy lands on the node, which also keeps plan D3's change hooks
   * to one bump per member per step. See {@link PhysicsWorld.step}.
   */
  readonly #blendPosition = new Vector3();

  readonly #blendRotation = new Quaternion();

  /** Normalized §19 weight pair, reused per body per step. */
  readonly #blendWeights: BlendWeights = { physics: 1, animation: 0 };

  /**
   * The `deltaSeconds` of the last {@link PhysicsWorld.step}, or `undefined`
   * before the first one — the fixed step a `PoseTarget` history was captured
   * across, and the default divisor of
   * {@link PhysicsWorld.setBodyControlMode}'s finite difference.
   *
   * Remembered, never measured: nothing here reads a clock (§33).
   */
  #lastStepDelta: number | undefined;

  /** Registration-time scratch for the world→local anchor conversion (§28). */
  readonly #bindingPosition = new Vector3();

  readonly #bindingRotation = new Quaternion();

  readonly #bindingScratch = new Quaternion();

  /** Scratch for {@link PhysicsWorld.#applyJointCommands}' body-local anchors. */
  readonly #jointAnchorA = new Vector3();

  readonly #jointAnchorB = new Vector3();

  /**
   * Builds a world for `init.adapter` — or for the solver `init.solver` names
   * (PH-19) — and validates that the adapter can actually simulate it (§21,
   * §33, §37).
   *
   * The options are checked by `validatePhysicsWorldOptions` (§85) and then
   * *resolved*: gravity is widened to the engine's 3D form (Appendix A's
   * `(0, -9.81, 0)` when omitted, in both dimensions — §7a puts +Y up in both),
   * sleeping is merged over Appendix A's defaults, and determinism defaults to
   * `"same-runtime"`. The resolved record is what `initialize` hands the
   * adapter, so the solver and the engine agree on every value.
   *
   * @throws FourError if the options are invalid (§85), if neither or both of
   * `adapter` and `solver` are given, if `solver` names nothing registered
   * (§37), if the adapter does not declare `dimension` among its
   * `capabilities.dimensions`, or if the requested determinism tier is stronger
   * than the adapter declares (§33, §37).
   */
  constructor(init: PhysicsWorldInit) {
    validatePhysicsWorldOptions(init);

    const adapter = selectAdapter(init);
    const capabilities = adapter.capabilities;
    if (!capabilities.dimensions.includes(init.dimension)) {
      throw new FourError(
        WORLD_ERROR_CODE,
        `Adapter ${JSON.stringify(adapter.name)} declares dimensions [${capabilities.dimensions.join(", ")}] and cannot simulate a ${JSON.stringify(init.dimension)} world (§21, §37).`,
        {
          context: {
            adapter: adapter.name,
            requested: init.dimension,
            supported: [...capabilities.dimensions],
          },
        },
      );
    }

    const determinism = init.determinism ?? DEFAULT_DETERMINISM_LEVEL;
    if (
      DETERMINISM_LEVELS.indexOf(determinism) >
      DETERMINISM_LEVELS.indexOf(capabilities.determinism)
    ) {
      throw new FourError(
        WORLD_ERROR_CODE,
        `Adapter ${JSON.stringify(adapter.name)} declares determinism ${JSON.stringify(capabilities.determinism)}, weaker than the requested ${JSON.stringify(determinism)} (§33, §37). Ask for a tier the solver can reach, or use another solver.`,
        {
          context: {
            adapter: adapter.name,
            requested: determinism,
            declared: capabilities.determinism,
          },
        },
      );
    }

    this.#adapter = adapter;
    this.#dimension = init.dimension;
    this.#units = resolvePhysicsWorldUnits(init.units);
    this.#localPlane = resolveLocalPlane(init.localPlane);
    this.#gravity = resolveGravity(init.dimension, init.gravity);
    // Authored gravity is in world length units / s². Convert into SI for the
    // solver. Appendix A's default is already SI and is left alone so a world
    // that only sets a scale still gets −9.81 m/s².
    if (this.#units !== undefined && init.gravity !== undefined) {
      const length = this.#units.scale.lengthToMeters;
      this.#gravity.x *= length;
      this.#gravity.y *= length;
      this.#gravity.z *= length;
    }
    this.#sleeping = resolveSleepingConfig(init.sleeping);
    this.#tuning = resolveTuningCapabilities(capabilities);
    this.#bodyTuning = supportsSolverBodyTuning(adapter) ? adapter : undefined;
    this.#warnUnhonouredSleepThresholds();
    this.#determinism = determinism;
    this.#poses = init.poses;
    this.#options = Object.freeze({
      dimension: this.#dimension,
      gravity: this.#gravity,
      sleeping: this.#sleeping,
      determinism,
      solverIterations: init.solverIterations,
    });
  }

  // --- configuration --------------------------------------------------------

  /** The solver this world drives (§37). */
  get adapter(): PhysicsWorldAdapter {
    return this.#adapter;
  }

  /** The §21 dimension, fixed at construction. */
  get dimension(): PhysicsDimension {
    return this.#dimension;
  }

  /**
   * Resolved world gravity in m/s² (§21). The world's own vector — read it,
   * copy it, but do not write into it: the solver received it at `initialize`
   * and this object no longer decides what the solver does.
   */
  get gravity(): Vector3 {
    return this.#gravity;
  }

  /**
   * The resolved §32 sleeping configuration, kept accessible because an adapter
   * maps only what its solver exposes — both Rapier adapters honour `enabled`
   * (`setCanSleep`) and apply **none** of the three thresholds, which have no
   * binding at 0.19.3 — so a caller that needs to know what was *asked for* can
   * still read it here.
   *
   * A threshold authored against an adapter that declares it cannot apply one
   * warns once at construction; see `PhysicsCapabilities.tuning`.
   */
  get sleeping(): SleepingConfig {
    return this.#sleeping;
  }

  /** The §33 tier this world asked for and the adapter accepted. */
  get determinism(): DeterminismLevel {
    return this.#determinism;
  }

  /** The exact `PhysicsWorldOptions` record handed to `adapter.initialize` (§37). */
  get options(): PhysicsWorldOptions {
    return this.#options;
  }

  /**
   * §40 scale factors this world converts through, or `undefined` when
   * omitted (identity — internal solver numbers equal authored numbers).
   *
   * Internal solver state is SI. Use {@link PhysicsWorld.toSiLength} and
   * friends at the authoring boundary.
   */
  get units(): PhysicsWorldUnits | undefined {
    return this.#units;
  }

  /**
   * The resolved §21 simulation plane. Default is the world XY plane
   * (origin 0, normal +Z, xAxis +X). Bodies with `space: "local-plane"`
   * author their 2D pose in this frame.
   */
  get localPlane(): ResolvedLocalPlane {
    return this.#localPlane;
  }

  /** Metres from an authored length. Identity when {@link PhysicsWorld.units} is omitted. */
  toSiLength(value: number): number {
    return toSiLength(value, this.#units);
  }

  /** Authored length from metres. Identity when units are omitted. */
  fromSiLength(meters: number): number {
    return fromSiLength(meters, this.#units);
  }

  /** Kilograms from an authored mass. Identity when units are omitted. */
  toSiMass(value: number): number {
    return toSiMass(value, this.#units);
  }

  /** Authored mass from kilograms. Identity when units are omitted. */
  fromSiMass(kilograms: number): number {
    return fromSiMass(kilograms, this.#units);
  }

  /** Whether {@link PhysicsWorld.initialize} has completed. */
  get initialized(): boolean {
    return this.#initialized;
  }

  /** Whether {@link PhysicsWorld.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** How many bodies are registered. */
  get size(): number {
    return this.#bodiesByNode.size;
  }

  /** The registered nodes, in registration order (§33). */
  get nodes(): IterableIterator<Node> {
    return this.#bodiesByNode.keys();
  }

  /**
   * The events drained from the last {@link PhysicsWorld.step} and not yet
   * dispatched, in adapter order. Emptied by
   * {@link PhysicsWorld.dispatchEvents}.
   */
  get queuedEvents(): readonly WorldPhysicsEvent[] {
    return this.#queue;
  }

  // --- lifecycle ------------------------------------------------------------

  /**
   * Creates the solver's world (§37), awaiting the adapter's `initialize`.
   *
   * A WebAssembly-backed solver loads its module here (plan P5-1), which is why
   * this is asynchronous even though nothing in the physics package is. Nothing
   * may be registered or stepped before it resolves.
   *
   * @throws FourError if called twice or after `dispose`.
   */
  async initialize(): Promise<void> {
    this.#assertNotDisposed();
    if (this.#initializeStarted) {
      throw new FourError(
        WORLD_ERROR_CODE,
        "PhysicsWorld.initialize was called twice; one world owns one solver world (§37). Construct a second world with its own adapter instead.",
        { context: { adapter: this.#adapter.name } },
      );
    }
    this.#initializeStarted = true;
    await this.#adapter.initialize(this.#options);
    this.#initialized = true;
  }

  /**
   * Registers `node`'s body and its colliders with the solver (§23, §24, §37).
   *
   * ```ts
   * node.addComponent(new RigidBody({ type: "dynamic" }));
   * node.addComponent(new Collider({ shape: { type: "circle", radius: 0.5 } }));
   * world.addBody(node);
   * ```
   *
   * ## Which colliders are registered (decision, WP-5.3)
   *
   * The **whole subtree** rooted at `node` is scanned, depth-first in child
   * insertion order and to unbounded depth, and a collider joins this body when
   * its own §24 ancestor walk (`Collider.body`: the nearest `RigidBody` at or
   * above its node) names **this** body.
   *
   * So the scan is the exact dual of the resolution a collider already performs,
   * and it needs no second rule: an intermediate node with no body is
   * transparent — a visual grouping node between a body and its collider changes
   * nothing — while a descendant that carries its own `RigidBody` claims its own
   * colliders, which are skipped here and registered by their own
   * `addBody(childNode)` call. That is why several colliders on one body are
   * expressed as child nodes (WP-5.2).
   *
   * The scan happens **once**, here. A `Collider` attached after this call is
   * handed over with {@link PhysicsWorld.addCollider}, which applies the same
   * §24 resolution to one component (PH-5); one attached and never handed over
   * simply is not simulated.
   *
   * ## The initial pose (decision, WP-5.3)
   *
   * An authored `position`/`rotation` on the `RigidBody` descriptor wins; when
   * the descriptor carried neither, the body starts at the node's **local**
   * `transform` — which is where the author put it, and refusing to read it
   * would drop a body at the origin the first time it is registered. Either way
   * the solved pose is written back onto the node after the first step (§42), so
   * the node and the solver converge immediately.
   *
   * Phase 5 reads and writes the *local* transform, so a body node is expected
   * to sit at the scene root or under an identity ancestor chain; a hierarchy
   * that scales or rotates above a body is out of scope until the §19 pipeline
   * of Phase 7.
   *
   * ## Mass (§23, §25; plan §6d note of 2026-08-01)
   *
   * Mass-from-density is the solver's derivation, so after the colliders exist
   * the world reads `getBodyMass` back onto the component: a dynamic body whose
   * mass was never authored stops reporting `inverseMass === NaN`. A solver that
   * reports a non-positive mass — a body with no collider, or a static body —
   * leaves the component alone, because §23 forbids expressing "does not
   * simulate" as a zero mass.
   *
   * The value lands on `RigidBody.derivedMass` and **does not author**
   * `RigidBody.mass` (2026-08-06): `mass` still reports it, `toDescriptor()`
   * still omits it, and a body registered twice derives twice instead of
   * freezing the first solver's answer. See `#refreshMassProperties`.
   *
   * Assigning `body.type` after registration changes the **component** and not
   * the solver — the two would then disagree about what is being simulated. Use
   * {@link PhysicsWorld.setBodyControlMode} to change a registered body's §22
   * model: it re-types the solver body in place and moves the component with it
   * (plan P7-3), and it is what §19's control-mode transitions go through.
   *
   * @returns the registered `RigidBody` component
   * ## The frame the body is registered in (§8, PH-12)
   *
   * `"world"` — the frame every body is solved in unless its `RigidBody`
   * declares `"local-plane"`, which this world maps through
   * {@link PhysicsWorld.localPlane}. Presentation frames (`"screen"`,
   * `"viewport"`, `"camera"`, `"billboard"`) stay refused (§8).
   * See `#requireSimulationSpace`.
   *
   * @throws FourError if the world is not initialized, if `node` has no
   * `RigidBody`, if it is already registered, if the body declares a §8 space
   * mode this world cannot simulate, if a scanned collider has no body (§23),
   * or if the body or a collider is invalid for this dimension (§21, §85)
   */
  addBody(node: Node): RigidBody {
    this.#requireReady();
    if (this.#bodiesByNode.has(node)) {
      throw new FourError(
        WORLD_ERROR_CODE,
        `Node ${node.id} is already registered with this PhysicsWorld; a node carries one RigidBody (§6a) and one solver body (§37).`,
        { context: { node: node.id } },
      );
    }

    const body = node.getComponent(RigidBody);
    if (body === undefined) {
      throw new FourError(
        "INVALID_SCENE_GRAPH",
        `Node ${node.id} has no RigidBody component, so there is nothing to register (§23, §6a). Attach one with node.addComponent(new RigidBody({ type: … })) before calling addBody.`,
        { context: { node: node.id } },
      );
    }

    this.#requireSimulationSpace(node, body);

    // Validate everything before the adapter is touched, so a rejected
    // registration leaves no half-built body in the solver (§85).
    const colliders: Collider[] = [];
    this.#collectColliders(node, body, colliders);
    body.validateFor(this.#dimension);
    for (const collider of colliders) {
      collider.validateFor(this.#dimension);
    }

    const descriptor = body.toDescriptor();
    if (
      descriptor.position === undefined &&
      descriptor.rotation === undefined
    ) {
      descriptor.position = node.transform.position;
      descriptor.rotation = node.transform.rotation;
    }
    const usesPlane = body.space === "local-plane";
    this.#applyAuthoringToSolverDescriptor(descriptor, usesPlane);
    const handle = this.#adapter.createBody(descriptor);
    const id = this.#adapter.getBodyId(handle);

    const tracked =
      this.#poses !== undefined &&
      shouldTrackPose(body.type, node.transformAuthority);
    const registration: BodyRegistration = {
      node,
      body,
      handle,
      id,
      type: body.type,
      colliders: [],
      tracked,
      localPlane: usesPlane,
    };

    for (const collider of colliders) {
      const colliderHandle = this.#adapter.createCollider(
        collider.toDescriptor(handle),
      );
      const colliderRegistration: ColliderRegistration = {
        collider,
        handle: colliderHandle,
        id: this.#adapter.getColliderId(colliderHandle),
        body: registration,
        dirty: false,
      };
      registration.colliders.push(colliderRegistration);
      this.#collidersById.set(colliderRegistration.id, colliderRegistration);
      noteSolverCollider(1);
    }

    this.#bodiesByNode.set(node, registration);
    this.#bodiesById.set(id, registration);
    this.#bodiesByComponent.set(body, registration);
    for (const colliderRegistration of registration.colliders) {
      this.#collidersByComponent.set(
        colliderRegistration.collider,
        colliderRegistration,
      );
    }
    setRigidBodyRegistered(body, true, this.#bodyTuning !== undefined);
    if (tracked) {
      this.#poses?.track(node);
    }

    const solverMass = this.#refreshMassProperties(registration);
    this.#warnUnhonouredMaterials(registration);
    this.#warnSuspiciousNumbers(registration, solverMass);
    if (
      body.type === "dynamic" &&
      colliders.length === 0 &&
      descriptor.inertiaTensor === undefined
    ) {
      this.#inertialessBodies.add(registration);
    }
    noteSolverBody(1);
    return body;
  }

  /**
   * Removes `node`'s body and its colliders from the solver, in reverse
   * creation order (§37, §83).
   *
   * Returns whether the node was registered, so teardown paths may call it
   * unconditionally. The components are left intact and can be registered with
   * another world; only the solver objects and this world's bookkeeping go away.
   * Events already queued for the removed body are still dispatched — they
   * describe a step that happened.
   *
   * **Joints go first.** Any joint this world holds that names the removed body
   * is destroyed before the body is (§83's ordering, and the only order that
   * leaves no constraint pointing at a dead body). Those joints are *not*
   * broken: {@link Joint.broken} means "exceeded its break threshold", and a
   * body that was unregistered broke nothing — they are simply unregistered and
   * may be added again once their bodies are.
   */
  removeBody(node: Node): boolean {
    this.#assertNotDisposed();
    const registration = this.#bodiesByNode.get(node);
    if (registration === undefined) {
      return false;
    }
    this.#destroyJointsOf(registration);
    this.#destroyRegistration(registration);
    this.#bodiesByNode.delete(node);
    this.#bodiesById.delete(registration.id);
    this.#bodiesByComponent.delete(registration.body);
    return true;
  }

  /**
   * Registers **one** `Collider` on a body this world already holds (§24, §37,
   * §83; PH-5, 2026-08-07).
   *
   * ```ts
   * const shield = new Node();
   * shield.addComponent(new Collider({ shape: { type: "circle", radius: 1 } }));
   * player.addChild(shield);
   * world.addCollider(shield.getComponent(Collider)!); // …live from here on
   * ```
   *
   * ## Which body it joins — the same rule `addBody` uses, not a second one
   *
   * There is no `node` parameter and no body parameter: the collider's own §24
   * ancestor walk (`Collider.requireBody`) names its body, exactly as
   * `#collectColliders` tests it during `addBody`. One source of truth means a
   * collider cannot be attached to a body it does not belong to, and moving the
   * node under a different body before calling this changes the answer in the
   * one place §24 says it lives.
   *
   * The body must already be registered **here**. Attaching to an unregistered
   * node is refused rather than quietly registering the body too, because
   * `addBody` is the call that decides a body's pose, tracking, and mass, and
   * inferring all three from a collider would be inventing them.
   *
   * ## Explicit, like `refreshCollider` and for the same reason
   *
   * A `Collider` reaching a node is a plain `addComponent` the world cannot
   * observe (§6a components have no world edge), so the alternative was to
   * re-scan every registered body's subtree every step and diff it — real
   * per-step cost, in a world where colliders almost never appear at runtime.
   * This says so instead. See {@link PhysicsWorld.refreshCollider}, whose
   * explicit-by-design note is the precedent.
   *
   * ## Ordering, mass, and §33
   *
   * The new registration is appended to its body's collider list, which keeps
   * that list in **ascending adapter collider id** — the order the per-step
   * drain and every checksum-visible iteration depend on — because adapter
   * collider ids are monotonic and never reused, so a collider created now
   * outranks every collider created before it.
   *
   * The body's mass is then re-read from the solver, since §23/§25 derive a
   * mass from collider density: a derived-mass body gains this collider's
   * contribution, and an authored-mass body keeps the mass it authored (the
   * adapter is what decides which collider carries it — see
   * `PhysicsSolverAdapter.createCollider`). Nothing is created in the solver
   * until every check has passed, so a rejected call leaves the world exactly
   * as it found it (§85).
   *
   * @returns the registered collider, for chaining
   * @throws FourError if the world is not initialized, if the collider is
   * already registered here, if it has no `RigidBody` above it (§23), if that
   * body is not registered with this world, or if the collider is invalid for
   * this dimension (§21, §85)
   */
  addCollider(collider: Collider): Collider {
    this.#requireReady();
    if (this.#collidersByComponent.has(collider)) {
      throw new FourError(
        WORLD_ERROR_CODE,
        "That Collider is already registered with this PhysicsWorld (§24, §37); a Collider carries one solver collider. Remove it with world.removeCollider(collider) before registering it again.",
        {
          context: { adapter: this.#adapter.name, shape: collider.shape.type },
        },
      );
    }

    // `requireBody` is §24's own resolution — the same one `#collectColliders`
    // applies at `addBody` — so this method adds no second rule about which
    // body a collider belongs to.
    const body = collider.requireBody();
    const registration = this.#bodiesByComponent.get(body);
    if (registration === undefined) {
      throw new FourError(
        WORLD_ERROR_CODE,
        "The RigidBody above that Collider is not registered with this PhysicsWorld, so there is no solver body to attach it to (§23, §24, §37). Call world.addBody(node) for the body's node first — that registers the body and every Collider already in its subtree; addCollider is for the ones attached afterwards.",
        {
          context: { adapter: this.#adapter.name, shape: collider.shape.type },
        },
      );
    }
    collider.validateFor(this.#dimension);

    const handle = this.#adapter.createCollider(
      collider.toDescriptor(registration.handle),
    );
    noteSolverCollider(1);
    const colliderRegistration: ColliderRegistration = {
      collider,
      handle,
      id: this.#adapter.getColliderId(handle),
      body: registration,
      dirty: false,
    };
    registration.colliders.push(colliderRegistration);
    this.#collidersById.set(colliderRegistration.id, colliderRegistration);
    this.#collidersByComponent.set(collider, colliderRegistration);

    this.#refreshMassAfterColliderChange(registration);
    this.#warnUnhonouredMaterial(registration.node, collider);
    return collider;
  }

  /**
   * Removes one registered `Collider` from the solver, leaving its body
   * simulating (§24, §37, §83; PH-5, 2026-08-07).
   *
   * Returns whether it was registered, so teardown paths may call it
   * unconditionally — the shape `removeBody` and `removeJoint` already have. It
   * is deliberately **not** the throwing refusal
   * {@link PhysicsWorld.refreshCollider} uses: a refresh that silently did
   * nothing would be invisible, whereas this call hands the answer back.
   *
   * The `Collider` component survives and may be registered again, here or
   * elsewhere; only the solver object and this world's bookkeeping go away. A
   * pending {@link PhysicsWorld.refreshCollider} request on it is dropped with
   * it, so no later step pays for a scan that can find nothing.
   *
   * ## Mass (§23, §25)
   *
   * The adapter re-establishes the body's mass properties as it destroys the
   * collider — that is precisely the "body survives" case
   * `PhysicsSolverAdapter.destroyCollider` exists for — and the body's mass is
   * then re-read onto the component. A body whose mass was **authored** keeps
   * it, whatever the adapter had to do internally to hold it; a body whose mass
   * was **derived** loses this collider's contribution, and one left with no
   * collider at all loses its derived mass entirely (`RigidBody.mass` reports
   * `undefined` again), because there is nothing left to derive one from.
   */
  removeCollider(collider: Collider): boolean {
    const colliderRegistration = this.#collidersByComponent.get(collider);
    if (colliderRegistration === undefined) {
      return false;
    }
    const registration = colliderRegistration.body;
    this.#adapter.destroyCollider(colliderRegistration.handle);
    noteSolverCollider(-1);
    if (colliderRegistration.dirty) {
      this.#dirtyColliderCount -= 1;
    }
    const index = registration.colliders.indexOf(colliderRegistration);
    registration.colliders.splice(index, 1);
    this.#collidersById.delete(colliderRegistration.id);
    this.#collidersByComponent.delete(collider);
    this.#refreshMassAfterColliderChange(registration);
    return true;
  }

  /** Whether `node` is registered with this world. */
  has(node: Node): boolean {
    return this.#bodiesByNode.has(node);
  }

  /** The `RigidBody` registered for `node`, or `undefined`. */
  getBody(node: Node): RigidBody | undefined {
    return this.#bodiesByNode.get(node)?.body;
  }

  /**
   * The solver handle of `node`'s body, or `undefined` when it is not
   * registered here — **below the stable API** (§20, §37).
   *
   * ```ts
   * const handle = world.getBodyHandle(node);
   * if (handle !== undefined) {
   *   // `world.adapter` is a SolverBodyAccess on both Rapier adapters:
   *   world.adapter.setBodyVelocities(handle, velocity, spin, true);
   * }
   * ```
   *
   * ## What this is for, and what it costs
   *
   * §20's promise is that common tasks need no solver-specific code, not that
   * uncommon ones are forbidden. A `RigidBody` carries authored state that
   * reaches the solver **once**, at `createBody` (see `rigid-body.ts`'s module
   * header): re-tuning damping, gravity scale, or mass on a body that is
   * already simulating has no route through the component. Until the §37 seam
   * widens, the honest answer is a handle plus a documented warning, not a
   * setter that quietly does nothing.
   *
   * A handle taken from here is **opaque and unforgeable** (`types.ts`), and
   * everything below this line is the adapter's contract rather than this
   * package's:
   *
   * - it is valid only while the body is registered with **this** world — a
   *   `removeBody`, a re-registration, or `dispose()` invalidates it, and using
   *   a stale handle is the adapter's error to raise;
   * - what a write does is the *solver's* business: `PhysicsWorld` does not see
   *   it, does not mirror it onto the component, and cannot keep §33's
   *   checksums comparable across runs that did it differently;
   * - a write that changes the simulation makes the component's mirrors
   *   (`mass`, damping, `gravityScale`) stale in the other direction. The
   *   component is not re-read from the solver except for velocities and the
   *   sleep flag.
   *
   * Prefer the supported routes where they exist: §26's force and impulse
   * commands, {@link PhysicsWorld.setBodyControlMode} for §22 types, and
   * `removeBody` + `addBody` to rebuild a body from a changed descriptor.
   */
  getBodyHandle(node: Node): PhysicsBodyHandle | undefined {
    return this.#bodiesByNode.get(node)?.handle;
  }

  /**
   * The solver handle of a registered `Collider` component, or `undefined` —
   * **below the stable API**, with every caveat
   * {@link PhysicsWorld.getBodyHandle} states (§24, §37).
   *
   * The collider must have been registered by this world, which happens when
   * `addBody` scans the body's subtree or when
   * {@link PhysicsWorld.addCollider} hands one over afterwards: a `Collider` on
   * a node this world does not hold has no handle to give. §25's rolling and
   * spinning friction are the
   * motivating case — no shipped solver applies them (see
   * `PhysicsCapabilities.tuning`), and a caller who needs a solver-specific
   * equivalent needs the handle to reach it.
   */
  getColliderHandle(collider: Collider): PhysicsColliderHandle | undefined {
    return this.#collidersByComponent.get(collider)?.handle;
  }

  // --- §37 property changes (PH-1 stage 2) ----------------------------------

  /**
   * Whether this world's adapter can carry a **property change** into its
   * solver after `createBody` — the §37 seam `SolverBodyTuningAccess` (PH-1
   * stage 2, 2026-08-07).
   *
   * Declared, not guessed, and answerable before anything is registered: a
   * caller building a tuning UI can ask once and disable the sliders rather
   * than discovering the limitation from a `console.warn` on the first drag.
   * `false` does not make the writes illegal — `RigidBody`'s setters keep
   * accepting them and keep warning once per body per field, and
   * `removeBody` + `addBody` still rebuilds the solver body from the changed
   * descriptor.
   *
   * The properties this covers are `rigid-body.ts`'s truth table plus
   * {@link PhysicsWorld.refreshCollider}'s §24/§25 fields. It is deliberately
   * one boolean and not six: see `supportsSolverBodyTuning`.
   */
  get supportsLiveProperties(): boolean {
    return this.#bodyTuning !== undefined;
  }

  /**
   * Re-reads a registered `Collider`'s §25 material and §24 filter at the next
   * fixed step (PH-1 stage 2).
   *
   * ```ts
   * ice.friction = 0.02;
   * world.refreshCollider(ice); // …in force from the next step on
   * ```
   *
   * ## Why a collider has to be *asked* and a body does not
   *
   * `RigidBody.mass` and its neighbours are accessors, so the component sees
   * every write and queues it by itself. `Collider.friction`, `restitution`,
   * `density`, `sensor`, `collisionGroups`, and `collisionMask` are plain
   * public fields — §24 and §25 describe them as data — and a plain field
   * assignment is unobservable. The alternatives were to shadow-copy six values
   * per collider and diff them every step, which is real per-step cost for
   * something that changes almost never, or to say so. This says so.
   *
   * Marking is idempotent, costs no allocation, and is served in ascending
   * collider id within ascending body id (§33). A collider this world does not
   * hold is **refused**, rather than silently doing nothing: passing the wrong
   * one is the mistake this call exists to make visible.
   *
   * On an adapter without the §37 property seam
   * ({@link PhysicsWorld.supportsLiveProperties} `false`) the request is
   * accepted and consumed but reaches no solver; the collider's values still
   * take effect on the next `removeBody` + `addBody`. Nothing is warned here —
   * the world-level answer is a property a caller can read, and warning per
   * collider would print once per collider in a scene-wide misconfiguration.
   *
   * @throws FourError if `collider` is not registered with this world (§24, §85)
   */
  refreshCollider(collider: Collider): void {
    const registration = this.#collidersByComponent.get(collider);
    if (registration === undefined) {
      throw new FourError(
        WORLD_ERROR_CODE,
        "That Collider is not registered with this PhysicsWorld, so there is nothing to refresh (§24, §37). A collider is registered when world.addBody scans its body's subtree; one attached afterwards has to be handed over with world.addCollider(collider).",
        { context: { adapter: this.#adapter.name } },
      );
    }
    if (registration.dirty) {
      return;
    }
    registration.dirty = true;
    this.#dirtyColliderCount += 1;
  }

  /**
   * Moves a registered body to a new pose **without deriving the motion that
   * got it there** — §37's "teleports", which had no stable-API route until now
   * (PH-1 stage 2).
   *
   * ```ts
   * world.teleport(player, spawnPoint); // rotation unchanged
   * ```
   *
   * ## Teleport versus drive
   *
   * A teleport sets the pose and nothing else: velocities are untouched, and no
   * contact response is derived for the swept volume, so a body teleported into
   * a wall resolves the overlap from rest rather than arriving with the
   * momentum of the jump. To *push* things on the way, drive a
   * `"kinematic-position"` body by writing its node transform, which the
   * kinematic feed turns into a target pose the solver interpolates towards
   * (§22).
   *
   * ## Immediate, unlike §26's commands
   *
   * The write reaches the solver at the moment of the call, exactly as
   * {@link PhysicsWorld.setBodyControlMode}'s does, because a teleport is a
   * discrete authoring act with no accumulation to buffer and no meaning for
   * "twice in one step" beyond "the last one wins". §6b's rule about not doing
   * physics work during event dispatch is unaffected: this is not dispatch.
   *
   * The node's own transform is **not** written here. Under `"physics"`
   * authority (§42) the publish pass writes it from the solver after the next
   * step, which is the one writer §42 permits; writing it here as well would
   * make this method a second author of the same transform.
   *
   * @param rotation the new orientation, or `undefined` to keep the current one
   * @param wake whether to wake a sleeping body (§32), default `true`
   * @throws FourError if `node` is not registered with this world (§85)
   */
  teleport(
    node: Node,
    position: Vector3Input,
    rotation?: RotationInput,
    wake = true,
  ): void {
    const registration = this.#bodiesByNode.get(node);
    if (registration === undefined) {
      throw new FourError(
        WORLD_ERROR_CODE,
        `Node ${node.id} is not registered with this PhysicsWorld, so there is no solver body to teleport (§37, §85). Call world.addBody(node) first.`,
        { context: { node: node.id } },
      );
    }
    const { handle } = registration;
    if (rotation === undefined) {
      this.#adapter.getBodyTransform(
        handle,
        this.#teleportPosition,
        this.#teleportRotation,
      );
      this.#adapter.setBodyTransform(
        handle,
        position,
        this.#teleportRotation,
        wake,
      );
      return;
    }
    this.#adapter.setBodyTransform(handle, position, rotation, wake);
  }

  /**
   * Writes `node`'s linear velocity into the solver immediately (PH-1).
   *
   * §42-style who-wins: allowed only when `node.transformAuthority ===
   * "physics"` (the solver owns the body). Any other authority refuses the
   * write and warns once via `warnAuthorityConflict` from `@fourjs/motion`. `"static"` bodies
   * refuse — they have no velocity. `"dynamic"` and `"kinematic-velocity"`
   * accept; `"kinematic-position"` refuses the same way as static (velocity is
   * not an input of that model).
   *
   * `v` is in authored world units per second. When {@link PhysicsWorld.units}
   * is set it is converted to SI for the solver; the component stores the
   * authored value and the publish pass converts back.
   *
   * @returns whether the solver was written
   */
  setLinearVelocity(node: Node, v: Vector3Input): boolean {
    const registration = this.#requireVelocityWrite(node, "linear");
    if (registration === undefined) {
      return false;
    }
    this.#adapter.getBodyVelocities(
      registration.handle,
      this.#mapLinear,
      this.#mapAngular,
    );
    widenToVector3(v, registration.body.linearVelocity);
    this.#toSolverVec(
      registration,
      registration.body.linearVelocity,
      this.#mapLinear,
    );
    this.#adapter.setBodyVelocities(
      registration.handle,
      this.#mapLinear,
      this.#mapAngular,
    );
    return true;
  }

  /**
   * Writes `node`'s angular velocity into the solver immediately (PH-1).
   *
   * Same §42 gate as {@link PhysicsWorld.setLinearVelocity}: `"physics"`
   * authority, `"dynamic"` or `"kinematic-velocity"` only. A `number` is the
   * scalar rate about +Z (plan P5-3). Angles stay radians and times stay
   * seconds — only the linear half of a unit scale applies, and not here.
   *
   * @returns whether the solver was written
   */
  setAngularVelocity(node: Node, v: AngularVelocityInput): boolean {
    const registration = this.#requireVelocityWrite(node, "angular");
    if (registration === undefined) {
      return false;
    }
    this.#adapter.getBodyVelocities(
      registration.handle,
      this.#mapLinear,
      this.#mapAngular,
    );
    resolveAngularVelocity(
      this.#dimension,
      v,
      registration.body.angularVelocity,
    );
    this.#toSolverAngular(
      registration,
      registration.body.angularVelocity,
      this.#mapAngular,
    );
    this.#adapter.setBodyVelocities(
      registration.handle,
      this.#mapLinear,
      this.#mapAngular,
    );
    return true;
  }

  /**
   * Switches a registered body between §22's simulation models **in place** —
   * §19's "move between animated, kinematic, and physical control" (§110, plan
   * P7-3).
   *
   * ```ts
   * // A door the animation drove, handed over to the solver when it is hit:
   * world.setBodyControlMode(door, "dynamic", { inheritVelocityFrom: target });
   * ```
   *
   * ## In place, and why that matters (§33)
   *
   * The body is **not** destroyed and re-created. It keeps its solver handle,
   * its monotonic id, its position in the checksum's iteration order, its
   * colliders, its mass properties, and its pose — all that changes is which of
   * §22's models the solver runs it under, plus (optionally) its velocities.
   * Two otherwise identical runs whose only difference is a mid-run switch
   * therefore produce the same body set in the same order, which is what lets a
   * control-mode change appear inside a §33 replay at all. Removing and
   * re-adding the body would mint a fresh id and re-key every registry against
   * it.
   *
   * ## What it updates
   *
   * 1. the solver, through `SolverBodyAccess.setBodyType`;
   * 2. the `RigidBody` component's `type`, so `body.type` and `inverseMass`
   *    report what is actually being simulated;
   * 3. the registration's own record of the type, which is what the fixed-step
   *    pipeline branches on — so the §22 kinematic feed and the §42 transform
   *    write follow the **new** type from the very next step: a body switched to
   *    `"kinematic-position"` starts being fed the node's transform as a target,
   *    and one switched to `"dynamic"` starts publishing the solved pose;
   * 4. §43 pose tracking, which follows dynamic-ness exactly as
   *    {@link PhysicsWorld.addBody} sets it.
   *
   * ## §23's mass rule for the new type
   *
   * A `"dynamic"` body needs a mass, so a switch **to** `"dynamic"` is refused
   * unless one is authored (`RigidBody.mass`) or derivable — that is, unless the
   * solver already reports a positive mass for the body, which it does whenever
   * the body carries a collider with a density (§23, §25). Activating a
   * ragdoll limb that has no collider would otherwise produce a massless
   * dynamic body: Rapier leaves such a body motionless (measured at 0.19.3),
   * which is a silently wrong simulation rather than an error. An authored
   * `mass` is re-validated against the new type as well, by the same
   * `validateMass` the component's setter uses.
   *
   * Nothing is written to the solver until every check has passed (§85).
   *
   * ## Velocity inheritance (§19's ragdoll activation)
   *
   * With `inheritVelocityFrom`, the body's velocities are seeded from one fixed
   * step of the target's own motion, so an activated body continues the
   * animation's trajectory instead of dropping from rest:
   *
   * ```text
   * dt      = the fixed step (see BodyControlModeOptions.fixedDeltaSeconds)
   * linear  = (position − previousPosition) / dt                     [m/s]
   *
   * qDelta  = rotation · previousRotation⁻¹        (world-frame delta, unit)
   * qDelta  ← −qDelta   when qDelta.w < 0          (shortest arc, plan D8)
   * s       = |(qDelta.x, qDelta.y, qDelta.z)|     = |sin(θ/2)|
   * θ       = 2 · atan2(s, qDelta.w)                                 [rad]
   * angular = (qDelta.xyz / s) · (θ / dt)                            [rad/s]
   *           = 0 when s = 0 (no rotation to differentiate)
   * ```
   *
   * `atan2` and not `2·asin(s)`: the arcsine form loses the difference between
   * a rotation and its supplement past a quarter turn per step, and `atan2`
   * stays accurate for the small deltas one fixed step actually produces. The
   * sign flip is the same shortest-arc rule `Quaternion.slerp` documents — `q`
   * and `−q` are the same rotation, and only one of them is the short way
   * round, so without it a target that crossed the quaternion sign boundary
   * would inherit a spin of nearly `2π/dt` in the wrong direction.
   *
   * Left-multiplying by the inverse of the *previous* rotation puts the delta in
   * the **world** frame, which is the frame §23's `angularVelocity` is stated in
   * (`qDelta · previous = current`). In a `"2d"` world a pure-Z target produces
   * an exactly pure-Z result — the Hamilton product's x and y terms cancel to
   * zero — so §21's planar check passes without a fudge; a target carrying
   * off-plane rotation is rejected by that check, as it should be.
   *
   * Inheritance is accepted only for `"dynamic"` and `"kinematic-velocity"`,
   * the two types that *have* a velocity: a `"static"` or
   * `"kinematic-position"` body ignores velocity entirely, so seeding one would
   * be a command that silently does nothing.
   *
   * The seeded velocities are written through `setBodyVelocities`, so they are
   * solver state immediately and are published back onto the component by the
   * next step (§23). Allocates nothing.
   *
   * @returns the `RigidBody` now running under `type`
   * @throws FourError if the world is not initialized, if `node` is not
   * registered here, if §23's mass rule forbids the new type, if inheritance
   * was asked for on a type that has no velocity, or if it was asked for with
   * no usable fixed delta
   */
  setBodyControlMode(
    node: Node,
    type: BodyType,
    options: BodyControlModeOptions = {},
  ): RigidBody {
    this.#requireReady();
    const registration = this.#bodiesByNode.get(node);
    if (registration === undefined) {
      throw new FourError(
        WORLD_ERROR_CODE,
        `Node ${node.id} is not registered with this PhysicsWorld, so there is no solver body to re-type (§22, plan P7-3). Call world.addBody(node) first.`,
        { context: { node: node.id, type } },
      );
    }

    const body = registration.body;
    validateMass(type, body.mass);
    if (type === "dynamic") {
      this.#requireMassForDynamic(registration);
    }

    const target = options.inheritVelocityFrom;
    // Resolve the divisor *before* the solver is touched, so a switch that
    // cannot seed its velocities is refused whole rather than half-applied.
    const delta =
      target === undefined ? 0 : this.#resolveInheritanceDelta(type, options);

    const wake = options.wake ?? true;
    this.#adapter.setBodyType(registration.handle, type, wake);
    // Through the package-internal writer, not `body.type = type`: the public
    // setter warns about exactly this assignment on a registered body, and here
    // the solver has just been re-typed, so there is no divergence to report.
    setRigidBodyType(body, type);
    registration.type = type;
    this.#retrackPose(registration);

    if (target !== undefined) {
      this.#inheritVelocities(registration, target, delta, wake);
    }
    return body;
  }

  // --- §28 joints -----------------------------------------------------------

  /**
   * Whether this world's adapter implements the joint seam at all
   * (`SolverJointAccess`, WP-6.1).
   *
   * `false` means {@link PhysicsWorld.addJoint} will throw: the adapter can
   * create and destroy a joint handle (§37) but cannot be asked for a joint's
   * id, its reaction, or its reconfiguration, so the engine has no way to
   * register one. Detected structurally — see `supportsSolverJointAccess` for
   * why that rather than a capability flag.
   */
  get supportsJoints(): boolean {
    return supportsSolverJointAccess(this.#adapter);
  }

  /** How many joints are registered (§28). */
  get jointCount(): number {
    return this.#jointsByJoint.size;
  }

  /** The registered joints, in registration order (§28, §33). */
  get joints(): IterableIterator<Joint> {
    return this.#jointsByJoint.keys();
  }

  /**
   * Registers a §28 joint with the solver (plan P6-3).
   *
   * ```ts
   * world.addBody(wall);
   * world.addBody(door);
   * world.addJoint(
   *   new HingeJoint({
   *     bodyA: wall.getComponent(RigidBody)!,
   *     bodyB: door.getComponent(RigidBody)!,
   *     anchor: new Vector3(0, 1, 0),
   *     axis: new Vector3(0, 1, 0),
   *     limits: { min: 0, max: Math.PI / 2 },
   *   }),
   * );
   * ```
   *
   * ## What happens here
   *
   * 1. The adapter is checked for the joint seam, and the joint for the things
   *    only a world can check: both bodies registered **with this world**, the
   *    joint not already registered, not broken, and — when it carries a break
   *    threshold — an adapter that can actually report reactions (plan P6-2).
   * 2. The joint's **world-space** anchors and axis are converted into each
   *    body's local frame, from the pose the *solver* holds right now (§28; see
   *    `joints.ts` for the convention and its two consequences).
   * 3. The resulting descriptor is validated against §28 and the world's
   *    dimension — which is where a staged type, a `spherical` in a `"2d"`
   *    world, or an axis pointing out of the plane is rejected — and only then
   *    handed to `createJoint`.
   * 4. The joint is bound to the adapter's monotonic id and appended to the
   *    registry, whose iteration order is registration order (§33).
   *
   * Nothing is created in the solver until every check has passed, so a
   * rejected registration leaves no half-built constraint behind (§85).
   *
   * @returns the registered joint, for chaining
   * @throws FourError if the world is not initialized, if the adapter has no
   * joint seam, if either body is not registered here, if the joint is already
   * registered or has broken, if a break threshold cannot be enforced, or if the
   * descriptor is invalid for this dimension (§21, §28, §85)
   */
  addJoint(joint: Joint): Joint {
    this.#requireReady();
    const access = this.#requireJointAccess();

    if (this.#jointsByJoint.has(joint)) {
      throw new FourError(
        WORLD_ERROR_CODE,
        `This ${joint.type} joint is already registered with this PhysicsWorld (§28).`,
        { context: { type: joint.type, id: joint.id } },
      );
    }
    if (joint.broken) {
      throw new FourError(
        WORLD_ERROR_CODE,
        `This ${joint.type} joint broke under load and cannot be registered again (§28, plan P6-2); construct a new joint.`,
        { context: { type: joint.type } },
      );
    }

    const bodyA = this.#requireRegisteredBody(joint, "bodyA", joint.bodyA);
    const bodyB = this.#requireRegisteredBody(joint, "bodyB", joint.bodyB);

    if (joint.breakable && !access.reportsJointReactions) {
      throw new FourError(
        "NOT_IMPLEMENTED",
        `Adapter ${JSON.stringify(this.#adapter.name)} cannot report joint reactions (SolverJointAccess.reportsJointReactions is false), so a breakForce or breakTorque could never be enforced (§28, plan P6-2). Drop the thresholds or use an adapter that reports reactions — breakage is never faked.`,
        { context: { adapter: this.#adapter.name, type: joint.type } },
      );
    }

    const binding = this.#bindJointFrames(joint, bodyA, bodyB);
    const descriptor = joint.toDescriptor(binding);
    validateJointDescriptor(descriptor, this.#dimension);

    const handle = this.#adapter.createJoint(descriptor);
    noteSolverJoint(1);
    const id = access.getJointId(handle);
    const registration: JointRegistration = {
      joint,
      handle,
      id,
      bodyA,
      bodyB,
    };
    this.#jointsByJoint.set(joint, registration);
    this.#jointsById.set(id, registration);
    bindJoint(joint, id);
    this.#warnUngappedJointMotor(joint);
    return joint;
  }

  /**
   * Removes a joint from the solver (§28, §83).
   *
   * Returns whether it was registered, so teardown paths may call it
   * unconditionally. The joint object survives and can be registered again —
   * removal is not breakage, and nothing about it is marked broken.
   */
  removeJoint(joint: Joint): boolean {
    const registration = this.#jointsByJoint.get(joint);
    if (registration === undefined) {
      return false;
    }
    this.#retireJoint(registration, true);
    return true;
  }

  /** Whether `joint` is registered with this world. */
  hasJoint(joint: Joint): boolean {
    return this.#jointsByJoint.has(joint);
  }

  // --- the fixed step -------------------------------------------------------

  /**
   * Shifts every registered body's `PoseTarget` history one fixed step forward
   * — `PoseTarget.capturePrevious` for each, in registration order (§19, plan
   * P7-4).
   *
   * ## Why this is not part of `step`
   *
   * The history is what `(position − previousPosition) / dt` differences into
   * the velocity an activated ragdoll inherits (§19,
   * {@link PhysicsWorld.setBodyControlMode}), so "previous" has to mean *the
   * target one fixed step ago*. Capturing inside the step would run at §39 step
   * 6, **after** step 3 has written this step's target: `previous` would become
   * this step's pose and every difference would be zero. The capture therefore
   * belongs before animation, which is a different slot in the §39 order and so
   * a different system — {@link createPoseTargetCaptureSystem}, which is the
   * call site and which an application must register (see the module header).
   *
   * ## Every registered body, not only the blended ones
   *
   * A target's history is read by velocity inheritance as well as by the blend,
   * and inheritance is precisely what a body that is *not yet* blended or
   * dynamic uses at the moment it is switched (§19's ragdoll activation). A body
   * whose node carries no `PoseTarget` is skipped; nothing here validates the
   * §19 trio, because a target with no blend is a perfectly ordinary thing to
   * animate and the blend's own error is raised by the step that blends.
   *
   * Capturing bumps no version and touches no solver, so this is safe to call on
   * a world that has not been initialized (a `PhysicsSystem` may well be
   * registered before `initialize` resolves). Calling it twice in one fixed step
   * collapses every difference to zero — see `PoseTarget.capturePrevious`.
   * Allocates nothing.
   */
  capturePoseTargets(): void {
    for (const registration of this.#bodiesByNode.values()) {
      registration.node.getComponent(PoseTarget)?.capturePrevious();
    }
  }

  /**
   * Visits every registered body that is **dynamic and awake**, in registration
   * order (§33), with its node and its world-space centre of mass (§25).
   *
   * ```ts
   * world.forEachActiveBody((body, node, centerOfMass) => {
   *   body.applyForce(wind.sample(centerOfMass, body.linearVelocity, t));
   * });
   * ```
   *
   * This is the iteration a §39 step-5 force generator walks —
   * {@link ForceFieldSystem} is the one this package ships (§26, §27) — and it
   * is public because "the bodies a per-step force can actually move" is a
   * question every such generator asks and none of them should answer by
   * re-deriving it:
   *
   * - **dynamic** (§22): a force on a static or kinematic body does nothing by
   *   definition, so visiting one would be work whose result is discarded;
   * - **awake** (§32): a non-zero force wakes a body — which is why `step`
   *   skips zero-magnitude accumulations — so a generator that visited sleeping
   *   bodies would wake every body every step and §32 would stop meaning
   *   anything. Waking a settled body is `RigidBody.wake()`, an explicit
   *   command, and deliberately not a side effect of ambient wind.
   *
   * The centre of mass, not the transform origin, because it is where §26's
   * `applyForce` acts: for an off-centre or compound body (§24) the origin can
   * be anywhere, including outside the shape, and a generator that sampled
   * there would describe a different place from the one it pushes. It is read
   * from the solver (`SolverBodyAccess.getBodyCenterOfMass`) after mass-property
   * resolution, into **one shared vector that is overwritten on every visit** —
   * copy it if you need it after the callback returns (§7b).
   *
   * Allocates nothing. The visitor may apply forces and impulses freely; adding
   * or removing bodies during the walk is not supported — do it afterwards, as
   * with any iteration over the registration order.
   */
  forEachActiveBody(visit: ActiveBodyVisitor): void {
    const centerOfMass = this.#visitCenterOfMass;
    for (const registration of this.#bodiesByNode.values()) {
      if (registration.type !== "dynamic" || registration.body.sleeping) {
        continue;
      }
      this.#adapter.getBodyCenterOfMass(registration.handle, centerOfMass);
      visit(registration.body, registration.node, centerOfMass);
    }
  }

  /**
   * Visits every registered body that is **dynamic and sleeping**, in
   * registration order (§33), with the same shared centre-of-mass vector
   * {@link PhysicsWorld.forEachActiveBody} uses.
   *
   * The default force-generator walk skips sleepers so ambient wind cannot
   * defeat §32. This is the other half of that filter: a field that opts
   * into `wakesSleepingBodies` walks only the bodies the default pass hid.
   * Static and kinematic bodies are still skipped — a force on those types
   * is discarded by definition (§22).
   *
   * Allocates nothing. Adding or removing bodies during the walk is not
   * supported.
   */
  forEachSleepingDynamicBody(visit: ActiveBodyVisitor): void {
    const centerOfMass = this.#visitCenterOfMass;
    for (const registration of this.#bodiesByNode.values()) {
      if (registration.type !== "dynamic" || !registration.body.sleeping) {
        continue;
      }
      this.#adapter.getBodyCenterOfMass(registration.handle, centerOfMass);
      visit(registration.body, registration.node, centerOfMass);
    }
  }

  /**
   * Advances the simulation by exactly `deltaSeconds` (§10, §37, §39).
   *
   * Runs steps 1–6 of the pipeline in the module header and leaves the step's
   * events queued; call {@link PhysicsWorld.dispatchEvents} afterwards, which is
   * what `PhysicsSystem` does once every world has stepped (§39 step 9).
   *
   * `deltaSeconds` is **seconds** (§7a) and comes from the application clock's
   * fixed delta — the accumulator, the sub-step clamp, and `droppedTime` are
   * §10's business, not the world's. Nothing here reads a clock (§33).
   *
   * ## §37's "property changes" go first (PH-1 stage 2, 2026-08-07)
   *
   * The scene→solver pass now opens with {@link PhysicsWorld.refreshCollider}'s
   * and `RigidBody`'s pending property writes, ahead of §26's forces and the
   * kinematic feed, so that a force applied in the same frame as a mass change
   * acts on the new mass. The drain walks `#bodiesByNode`, which is registration
   * order and therefore ascending solver id (ids are monotonic and a re-added
   * body is appended), and each body's colliders in ascending id within it —
   * §33's ordering rule, applied to a second stream of writes.
   *
   * A body nobody wrote to costs **one integer comparison and no solver call**,
   * and a world in which `refreshCollider` was never called skips the collider
   * scan entirely: a quiet world therefore issues exactly the solver-call
   * sequence it issued before this seam existed, which is why no §33 golden
   * moved.
   *
   * Allocates nothing in steady state: the per-body loops write into the
   * components' and nodes' own vectors, and the event queue is reused unless the
   * step actually produced events.
   */
  step(deltaSeconds: number): void {
    this.#requireReady();
    this.#warnInertialessBodies();
    this.#lastStepDelta = deltaSeconds;
    for (const registration of this.#bodiesByNode.values()) {
      this.#drainSolverWrites(registration);
      this.#applyCommands(registration);
      this.#feedKinematic(registration);
    }
    this.#applyJointCommands();
    this.#publishEventInterest();
    this.#adapter.syncSceneToSolver();
    this.#adapter.step(deltaSeconds);
    this.#adapter.syncSolverToScene();
    for (const registration of this.#bodiesByNode.values()) {
      this.#publishBody(registration);
    }
    this.#collectEvents();
    this.#monitorJointBreakage(deltaSeconds);
  }

  /**
   * Emits every event queued by the last {@link PhysicsWorld.step} on the node
   * emitters §29 names, then empties the queue (§6b, §39 step 9).
   *
   * ## Ordering, in full
   *
   * 1. Events are dispatched **in the adapter's `drainEvents` order**, which
   *    §37 requires to be deterministic for a given step. The world neither
   *    sorts nor derives events — an adapter that reports `collisionstay`
   *    reports it itself.
   * 2. A collision event is emitted on **`bodyA`'s emitter first, then
   *    `bodyB`'s**, with the same payload object both times: §29 fixes no
   *    meaning to the A/B order beyond internal consistency, so re-labelling the
   *    pair per listener would be inventing information. A pair whose colliders
   *    share one body is emitted once.
   * 3. A trigger event is emitted on the **sensor collider's** emitter only —
   *    §29's `sensor.on("triggerenter", …)`. Two overlapping sensors are
   *    reported by the adapter as two events, once from each side, so each
   *    sensor's listeners still fire.
   * 4. A sleep or wake event is emitted on the **body**. `RigidBody.sleeping`
   *    was already refreshed during the step, so a listener sees the state the
   *    event announces.
   * 5. A `"jointbreak"` is emitted on the **joint** (§28, plan P6-2), which is
   *    already destroyed and unregistered by then — a listener sees the joint in
   *    its final state, and `joint.broken` is `true`. It is emitted on the joint
   *    alone and not on the two bodies: §29's body event map is the collision
   *    and sleep vocabulary, and a joint has its own emitter to subscribe to.
   *
   * The queue is handed over before the first callback runs, so a listener may
   * create bodies, remove bodies, or step another world without re-entering
   * this dispatch or losing events; anything a re-entrant step queues is
   * dispatched by that step's own `dispatchEvents`.
   */
  dispatchEvents(): void {
    const queued = this.#queue;
    if (queued.length === 0) {
      return;
    }
    this.#queue = [];
    for (let i = 0; i < queued.length; i += 1) {
      const event = queued[i];
      switch (event.type) {
        case "collisionstart":
        case "collisionstay":
        case "collisionend": {
          const collision: RigidBodyCollisionEvent = event;
          collision.bodyA.emit(collision.type, collision);
          if (collision.bodyB !== collision.bodyA) {
            collision.bodyB.emit(collision.type, collision);
          }
          break;
        }
        case "triggerenter":
        case "triggerexit": {
          const trigger: ColliderTriggerEvent = event;
          trigger.sensor.emit(trigger.type, trigger);
          break;
        }
        case "jointbreak": {
          const broken: JointBreakPayload = event;
          broken.joint.emit(broken.type, broken);
          break;
        }
        default: {
          const sleep: RigidBodySleepEvent = event;
          sleep.body.emit(sleep.type, sleep);
          break;
        }
      }
    }
  }

  // --- §30 queries ----------------------------------------------------------

  /**
   * Casts a ray and returns the hits with component references (§30).
   *
   * ```ts
   * const hits = world.raycast({ origin: new Vector2(0, 0), direction: new Vector2(1, 0) });
   * ```
   *
   * §30's filter semantics — groups, masks, ignored bodies, first/all, sorting,
   * sensor inclusion, custom predicates — live in the query record and are
   * applied by the adapter through the package's own `passesQueryFilter`, so
   * every solver answers a query identically. Hits on colliders this world has
   * not registered are dropped: the world can only report components it knows.
   */
  raycast(query: RaycastQuery): WorldRaycastHit[] {
    this.#requireQuery("raycast");
    const hits: WorldRaycastHit[] = [];
    for (const hit of this.#adapter.raycast(query)) {
      const target = this.#colliderOf(hit.collider);
      if (target !== undefined) {
        hits.push({
          collider: target.collider,
          body: target.body.body,
          point: hit.point,
          normal: hit.normal,
          distance: hit.distance,
        });
      }
    }
    return hits;
  }

  /** Sweeps a shape through the world (§30). See {@link PhysicsWorld.raycast}. */
  shapeCast(query: ShapeCastQuery): WorldShapeCastHit[] {
    this.#requireQuery("shapeCast");
    const hits: WorldShapeCastHit[] = [];
    for (const hit of this.#adapter.shapeCast(query)) {
      const target = this.#colliderOf(hit.collider);
      if (target !== undefined) {
        hits.push({
          collider: target.collider,
          body: target.body.body,
          point: hit.point,
          normal: hit.normal,
          distance: hit.distance,
        });
      }
    }
    return hits;
  }

  /**
   * Everything overlapping a ball centred at `center` (§30 `overlapSphere`).
   *
   * §21's parallel naming: in a `"2d"` world this is a **circle** overlap and in
   * a `"3d"` world a sphere overlap — one call, the shape the dimension implies.
   */
  overlapSphere(
    center: Vector3Input,
    radius: number,
    options?: QueryOptions,
  ): WorldOverlapHit[] {
    const shape: CollisionShape =
      this.#dimension === "2d"
        ? { type: "circle", radius }
        : { type: "sphere", radius };
    return this.#overlap(shape, center, undefined, options);
  }

  /**
   * Everything overlapping a box centred at `center` (§30 `overlapBox`).
   *
   * A **rectangle** in a `"2d"` world — where only `halfExtents.x` and
   * `halfExtents.y` are read, since there is no third axis — and a box in a
   * `"3d"` world (§21).
   */
  overlapBox(
    center: Vector3Input,
    halfExtents: Vector3Input,
    rotation?: RotationInput,
    options?: QueryOptions,
  ): WorldOverlapHit[] {
    const shape: CollisionShape =
      this.#dimension === "2d"
        ? {
            type: "rectangle",
            halfExtents: new Vector2(halfExtents.x, halfExtents.y),
          }
        : {
            type: "box",
            halfExtents: new Vector3(
              halfExtents.x,
              halfExtents.y,
              "z" in halfExtents ? halfExtents.z : 0,
            ),
          };
    return this.#overlap(shape, center, rotation, options);
  }

  /** Everything containing `point` (§30 `world.pointQuery`). */
  pointQuery(point: Vector3Input, options?: QueryOptions): WorldPointHit[] {
    this.#requireQuery("point");
    const query: PointQuery = { ...options, point };
    const hits: WorldPointHit[] = [];
    for (const hit of this.#adapter.pointQuery(query)) {
      const target = this.#colliderOf(hit.collider);
      if (target !== undefined) {
        hits.push({
          collider: target.collider,
          body: target.body.body,
          point: hit.point,
          distance: hit.distance,
        });
      }
    }
    return hits;
  }

  // --- §33 determinism, §34 snapshots ---------------------------------------

  /**
   * The §33 per-step determinism checksum, as a uint32.
   *
   * §33 defines it exactly: *"FNV-1a over each existing body's transform and
   * velocities (sleeping bodies included), quantized to 1e-6, visited in
   * ascending engine-assigned monotonic body id"*. So, per body, thirteen
   * floats in this order — position `x, y, z`, rotation `x, y, z, w`, linear
   * velocity `x, y, z`, angular velocity `x, y, z` — each quantized by
   * `Math.round(v * 1e6)` and absorbed as its low then high uint32 word in
   * little-endian bytes. Sleeping bodies are visited like any other; the sleep
   * *flag* is not hashed, because §33 hashes transforms and velocities.
   *
   * The visit order is `SolverBodyAccess.forEachBody`, which is creation order
   * and therefore ascending id: destroying a body removes it from the sequence
   * and creating one appends, so no destruction can permute the order, and a
   * §34 snapshot restore preserves it. Bodies that belong to the solver but not
   * to this world's registry — there should be none — are still hashed, because
   * §33 says "each existing body".
   *
   * The algorithm is D6's, byte for byte identical to
   * `@fourjs/diagnostics`'s `hashFloats`; it is re-implemented here because the
   * frozen dependency matrix gives `@fourjs/physics` core, math, scene, and motion
   * only. `tests/world.test.ts` pins the digest of a known world so the two
   * cannot drift apart silently.
   *
   * Allocates nothing.
   *
   * @throws RangeError if a body's state contains a non-finite value, which has
   * no meaningful quantization and would silently poison a golden hash
   */
  checksum(): number {
    this.#requireReady();
    const position = this.#checksumPosition;
    const rotation = this.#checksumRotation;
    const linear = this.#checksumLinear;
    const angular = this.#checksumAngular;
    let state = FNV_OFFSET_BASIS >>> 0;
    this.#adapter.forEachBody((handle) => {
      this.#adapter.getBodyTransform(handle, position, rotation);
      this.#adapter.getBodyVelocities(handle, linear, angular);
      state = absorbFloat(state, position.x);
      state = absorbFloat(state, position.y);
      state = absorbFloat(state, position.z);
      state = absorbFloat(state, rotation.x);
      state = absorbFloat(state, rotation.y);
      state = absorbFloat(state, rotation.z);
      state = absorbFloat(state, rotation.w);
      state = absorbFloat(state, linear.x);
      state = absorbFloat(state, linear.y);
      state = absorbFloat(state, linear.z);
      state = absorbFloat(state, angular.x);
      state = absorbFloat(state, angular.y);
      state = absorbFloat(state, angular.z);
    });
    return state >>> 0;
  }

  /**
   * Captures the solver's world with §34's validity metadata.
   *
   * The bytes are the adapter's and opaque; the envelope records the adapter's
   * `name` and `version` so {@link PhysicsWorld.restoreSnapshot} can refuse a
   * buffer from a different solver instead of handing it to a deserializer that
   * would either throw obscurely or, worse, succeed.
   *
   * @throws FourError if the adapter does not implement snapshots
   * (`capabilities.snapshots === false`)
   */
  createSnapshot(): PhysicsSnapshot {
    this.#requireReady();
    if (
      !this.#adapter.capabilities.snapshots ||
      this.#adapter.createSnapshot === undefined
    ) {
      throw new FourError(
        "NOT_IMPLEMENTED",
        `Adapter ${JSON.stringify(this.#adapter.name)} declares capabilities.snapshots: false and cannot capture a world (§34, §37).`,
        { context: { adapter: this.#adapter.name } },
      );
    }
    return {
      adapterName: this.#adapter.name,
      adapterVersion: this.#adapter.version,
      data: this.#adapter.createSnapshot(),
      configuration: {
        dimension: this.#dimension,
        gravity: [this.#gravity.x, this.#gravity.y, this.#gravity.z],
        sleeping: { ...this.#sleeping },
        determinism: this.#determinism,
        ...(this.#options.solverIterations !== undefined && {
          solverIterations: this.#options.solverIterations,
        }),
      },
    };
  }

  /**
   * Restores a snapshot taken from **this adapter and this adapter version**
   * (§34).
   *
   * This world's node ↔ body maps survive the round trip untouched, and they may:
   * §34 requires body identity and ordering to survive a restore, and §37's ids
   * are monotonic, so the id a registration recorded still names the same body
   * afterwards. What a restore *does* change is the state of those bodies —
   * poses, velocities, sleep — which the next step publishes onto the nodes.
   *
   * @throws FourError if the adapter does not implement snapshots, or if the
   * snapshot's `adapterName`/`adapterVersion` do not match this adapter's —
   * §34: "a replay refuses to run against a different solver"
   */
  restoreSnapshot(snapshot: PhysicsSnapshot): void {
    this.#requireReady();
    if (
      !this.#adapter.capabilities.snapshots ||
      this.#adapter.restoreSnapshot === undefined
    ) {
      throw new FourError(
        "NOT_IMPLEMENTED",
        `Adapter ${JSON.stringify(this.#adapter.name)} declares capabilities.snapshots: false and cannot restore a world (§34, §37).`,
        { context: { adapter: this.#adapter.name } },
      );
    }
    if (snapshot.adapterName !== this.#adapter.name) {
      throw new FourError(
        WORLD_ERROR_CODE,
        `Snapshot was taken with adapter ${JSON.stringify(snapshot.adapterName)} and this world runs ${JSON.stringify(this.#adapter.name)}; snapshots are opaque adapter data and are valid only for the adapter that produced them (§34).`,
        {
          context: {
            expected: this.#adapter.name,
            found: snapshot.adapterName,
          },
        },
      );
    }
    if (snapshot.adapterVersion !== this.#adapter.version) {
      throw new FourError(
        WORLD_ERROR_CODE,
        `Snapshot was taken with ${JSON.stringify(snapshot.adapterName)} version ${JSON.stringify(snapshot.adapterVersion)} and this world runs version ${JSON.stringify(this.#adapter.version)}; a snapshot is valid only for the adapter version that produced it (§34).`,
        {
          context: {
            adapter: this.#adapter.name,
            expected: this.#adapter.version,
            found: snapshot.adapterVersion,
          },
        },
      );
    }
    if (snapshot.configuration !== undefined) {
      this.#refuseConfigurationMismatch(snapshot.configuration);
    }
    this.#adapter.restoreSnapshot(snapshot.data);
  }

  /**
   * The §34 world-configuration check of {@link PhysicsWorld.restoreSnapshot}
   * (2026-08-04): every field of a present {@link PhysicsSnapshotConfiguration}
   * must match this world's resolved configuration, or the restored bytes
   * would step under different rules than they were captured under and the
   * run would silently stop being a continuation.
   */
  #refuseConfigurationMismatch(
    configuration: PhysicsSnapshotConfiguration,
  ): void {
    const mismatch = (
      field: string,
      expected: unknown,
      found: unknown,
    ): never => {
      throw new FourError(
        WORLD_ERROR_CODE,
        `Snapshot was captured under a different world configuration: ${field} was ${JSON.stringify(found)} at capture and is ${JSON.stringify(expected)} here. Stepping the restored state under different rules is not a continuation of the captured run (§34); rebuild the world with the captured configuration, or capture a fresh snapshot.`,
        { context: { field, expected, found } },
      );
    };
    if (configuration.dimension !== this.#dimension) {
      mismatch("dimension", this.#dimension, configuration.dimension);
    }
    const [gx, gy, gz] = configuration.gravity;
    if (
      gx !== this.#gravity.x ||
      gy !== this.#gravity.y ||
      gz !== this.#gravity.z
    ) {
      mismatch(
        "gravity",
        [this.#gravity.x, this.#gravity.y, this.#gravity.z],
        configuration.gravity,
      );
    }
    if (configuration.determinism !== this.#determinism) {
      mismatch("determinism", this.#determinism, configuration.determinism);
    }
    if (configuration.solverIterations !== this.#options.solverIterations) {
      mismatch(
        "solverIterations",
        this.#options.solverIterations,
        configuration.solverIterations,
      );
    }
    const sleeping = configuration.sleeping;
    if (
      sleeping.enabled !== this.#sleeping.enabled ||
      sleeping.linearThreshold !== this.#sleeping.linearThreshold ||
      sleeping.angularThreshold !== this.#sleeping.angularThreshold ||
      sleeping.timeThreshold !== this.#sleeping.timeThreshold
    ) {
      mismatch("sleeping", { ...this.#sleeping }, { ...sleeping });
    }
  }

  /**
   * Destroys every registered joint, then every registered body — colliders
   * first, all in reverse registration order — and finally disposes the adapter
   * (§83).
   *
   * **Joints before bodies**, because a constraint refers to two bodies and
   * nothing should be left pointing at a destroyed one; within each kind,
   * reverse registration order, which is the mirror of how they were built.
   *
   * Idempotent and terminal: the world cannot be stepped or registered with
   * afterwards. Nodes are untracked from the pose buffer but their components
   * and transforms are left exactly as they were; the world owns the solver
   * objects, not the scene. Joints are unregistered, not broken — disposal is
   * not a §28 break.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    const joints = [...this.#jointsByJoint.values()].reverse();
    for (const registration of joints) {
      this.#retireJoint(registration, true);
    }
    const registrations = [...this.#bodiesByNode.values()].reverse();
    for (const registration of registrations) {
      this.#destroyRegistration(registration);
    }
    this.#bodiesByNode.clear();
    this.#bodiesById.clear();
    this.#bodiesByComponent.clear();
    this.#collidersById.clear();
    this.#collidersByComponent.clear();
    this.#jointsByJoint.clear();
    this.#jointsById.clear();
    this.#queue = [];
    this.#adapter.dispose();
  }

  // --- internals ------------------------------------------------------------

  /**
   * Whether feed/publish must convert this body's pose. False for every
   * existing world-space body with omitted units — the identity path.
   */
  #needsPoseMap(registration: BodyRegistration): boolean {
    return registration.localPlane || this.#units !== undefined;
  }

  /**
   * Converts an authored descriptor pose/mass into the SI world-space numbers
   * `createBody` receives. Mutates `descriptor` in place; vectors that were
   * references to the node or component are replaced so the node is not scaled.
   */
  #applyAuthoringToSolverDescriptor(
    descriptor: RigidBodyDescriptor,
    usesPlane: boolean,
  ): void {
    if (!usesPlane && this.#units === undefined) {
      return;
    }
    const position = this.#mapPosition;
    const rotation = this.#mapRotation;
    if (descriptor.position !== undefined) {
      widenToVector3(descriptor.position, position);
    } else {
      position.set(0, 0, 0);
    }
    if (descriptor.rotation !== undefined) {
      resolveRotation(this.#dimension, descriptor.rotation, rotation);
    } else {
      rotation.set(0, 0, 0, 1);
    }
    this.#toSolverPoseValues(usesPlane, position, rotation, position, rotation);
    descriptor.position = position;
    descriptor.rotation = rotation;
    if (descriptor.mass !== undefined) {
      descriptor.mass = toSiMass(descriptor.mass, this.#units);
    }
    if (descriptor.linearVelocity !== undefined) {
      widenToVector3(descriptor.linearVelocity, this.#mapLinear);
      this.#toSolverLinearValues(usesPlane, this.#mapLinear, this.#mapLinear);
      descriptor.linearVelocity = this.#mapLinear;
    }
  }

  #feedPose(
    registration: BodyRegistration,
    position: Vector3,
    rotation: Quaternion,
  ): void {
    if (!this.#needsPoseMap(registration)) {
      this.#adapter.setNextKinematicTransform(
        registration.handle,
        position,
        rotation,
      );
      return;
    }
    this.#toSolverPose(
      registration,
      position,
      rotation,
      this.#mapPosition,
      this.#mapRotation,
    );
    this.#adapter.setNextKinematicTransform(
      registration.handle,
      this.#mapPosition,
      this.#mapRotation,
    );
  }

  #feedVelocities(registration: BodyRegistration): void {
    const { body } = registration;
    if (!this.#needsPoseMap(registration)) {
      this.#adapter.setBodyVelocities(
        registration.handle,
        body.linearVelocity,
        body.angularVelocity,
      );
      return;
    }
    this.#toSolverLinear(registration, body.linearVelocity, this.#mapLinear);
    this.#toSolverAngular(registration, body.angularVelocity, this.#mapAngular);
    this.#adapter.setBodyVelocities(
      registration.handle,
      this.#mapLinear,
      this.#mapAngular,
    );
  }

  #publishSolverPose(registration: BodyRegistration): void {
    const { position, rotation } = registration.node.transform;
    if (!this.#needsPoseMap(registration)) {
      this.#adapter.getBodyTransform(registration.handle, position, rotation);
      return;
    }
    this.#adapter.getBodyTransform(
      registration.handle,
      this.#mapPosition,
      this.#mapRotation,
    );
    this.#fromSolverPose(
      registration,
      this.#mapPosition,
      this.#mapRotation,
      position,
      rotation,
    );
  }

  #publishSolverVelocities(registration: BodyRegistration): void {
    const { body } = registration;
    if (!this.#needsPoseMap(registration)) {
      this.#adapter.getBodyVelocities(
        registration.handle,
        body.linearVelocity,
        body.angularVelocity,
      );
      return;
    }
    this.#adapter.getBodyVelocities(
      registration.handle,
      this.#mapLinear,
      this.#mapAngular,
    );
    this.#fromSolverLinear(registration, this.#mapLinear, body.linearVelocity);
    this.#fromSolverAngular(
      registration,
      this.#mapAngular,
      body.angularVelocity,
    );
  }

  #toSolverPose(
    registration: BodyRegistration,
    srcPos: Vector3,
    srcRot: Quaternion,
    destPos: Vector3,
    destRot: Quaternion,
  ): void {
    this.#toSolverPoseValues(
      registration.localPlane,
      srcPos,
      srcRot,
      destPos,
      destRot,
    );
  }

  #fromSolverPose(
    registration: BodyRegistration,
    srcPos: Vector3,
    srcRot: Quaternion,
    destPos: Vector3,
    destRot: Quaternion,
  ): void {
    const units = this.#units;
    if (units !== undefined) {
      const inv = 1 / units.scale.lengthToMeters;
      destPos.set(srcPos.x * inv, srcPos.y * inv, srcPos.z * inv);
    } else if (destPos !== srcPos) {
      destPos.copy(srcPos);
    }
    if (destRot !== srcRot) {
      destRot.copy(srcRot);
    }
    if (registration.localPlane) {
      worldToPlane(this.#localPlane, destPos, destRot, destPos, destRot);
    }
  }

  #toSolverPoseValues(
    usesPlane: boolean,
    srcPos: Vector3,
    srcRot: Quaternion,
    destPos: Vector3,
    destRot: Quaternion,
  ): void {
    if (usesPlane) {
      planeToWorld(this.#localPlane, srcPos, srcRot, destPos, destRot);
    } else {
      if (destPos !== srcPos) {
        destPos.copy(srcPos);
      }
      if (destRot !== srcRot) {
        destRot.copy(srcRot);
      }
    }
    const units = this.#units;
    if (units !== undefined) {
      const scale = units.scale.lengthToMeters;
      destPos.x *= scale;
      destPos.y *= scale;
      destPos.z *= scale;
    }
  }

  #toSolverLinear(
    registration: BodyRegistration,
    src: Vector3,
    dest: Vector3,
  ): void {
    this.#toSolverLinearValues(registration.localPlane, src, dest);
  }

  #toSolverAngular(
    registration: BodyRegistration,
    src: Vector3,
    dest: Vector3,
  ): void {
    if (registration.localPlane) {
      planeToWorldVec(this.#localPlane, src, dest);
    } else if (dest !== src) {
      dest.copy(src);
    }
  }

  #toSolverVec(
    registration: BodyRegistration,
    src: Vector3,
    dest: Vector3,
  ): void {
    this.#toSolverLinear(registration, src, dest);
  }

  #toSolverLinearValues(usesPlane: boolean, src: Vector3, dest: Vector3): void {
    if (usesPlane) {
      planeToWorldVec(this.#localPlane, src, dest);
    } else if (dest !== src) {
      dest.copy(src);
    }
    const units = this.#units;
    if (units !== undefined) {
      dest.x *= units.scale.lengthToMeters;
      dest.y *= units.scale.lengthToMeters;
      dest.z *= units.scale.lengthToMeters;
    }
  }

  #fromSolverLinear(
    registration: BodyRegistration,
    src: Vector3,
    dest: Vector3,
  ): void {
    if (this.#units !== undefined) {
      const inv = 1 / this.#units.scale.lengthToMeters;
      dest.set(src.x * inv, src.y * inv, src.z * inv);
    } else if (dest !== src) {
      dest.copy(src);
    }
    if (registration.localPlane) {
      worldToPlaneVec(this.#localPlane, dest, dest);
    }
  }

  #fromSolverAngular(
    registration: BodyRegistration,
    src: Vector3,
    dest: Vector3,
  ): void {
    if (dest !== src) {
      dest.copy(src);
    }
    if (registration.localPlane) {
      worldToPlaneVec(this.#localPlane, dest, dest);
    }
  }

  /**
   * Shared gate for {@link PhysicsWorld.setLinearVelocity} /
   * {@link PhysicsWorld.setAngularVelocity}: registered, `"physics"`
   * authority, and a body type that actually carries velocity.
   */
  #requireVelocityWrite(
    node: Node,
    kind: "linear" | "angular",
  ): BodyRegistration | undefined {
    this.#requireReady();
    const registration = this.#bodiesByNode.get(node);
    if (registration === undefined) {
      throw new FourError(
        WORLD_ERROR_CODE,
        `Node ${node.id} is not registered with this PhysicsWorld, so there is no solver body whose ${kind} velocity can be written (§23, §85). Call world.addBody(node) first.`,
        { context: { node: node.id, kind } },
      );
    }
    if (node.transformAuthority !== PHYSICS_AUTHORITY) {
      warnAuthorityConflict(node, PHYSICS_AUTHORITY);
      return undefined;
    }
    if (
      registration.type !== "dynamic" &&
      registration.type !== "kinematic-velocity"
    ) {
      throw new FourError(
        WORLD_ERROR_CODE,
        `Node ${node.id} is a ${JSON.stringify(registration.type)} body, which does not accept a live ${kind} velocity write (§22, §23). Only "dynamic" and "kinematic-velocity" bodies carry velocity.`,
        { context: { node: node.id, kind, type: registration.type } },
      );
    }
    return registration;
  }

  /**
   * Enforces §8's one physics sentence at registration (PH-12, 2026-08-09).
   *
   * > Physics normally operates in world or local-plane space. Screen-space UI
   * > should not automatically participate in physical simulation unless
   * > explicitly mapped to a simulation plane.
   *
   * A body declares its frame with `RigidBody.space`, whose default is
   * `"world"`, so **every scene written before this check passes it
   * unchanged** — the check can only fire on a body that went out of its way to
   * say it is solved somewhere else.
   *
   * ## Two refusals, for two different reasons
   *
   * - `"screen"`, `"viewport"`, `"camera"`, `"billboard"` are refused because
   *   §8 says so. The sentence's escape hatch — "unless explicitly mapped to a
   *   simulation plane" — is a mapping the author performs: build the body on a
   *   node in the simulated frame and drive the presentation node from it. A
   *   body silently simulated in pixels is precisely what §8 forbids.
   * - `"local-plane"` is legal under §8 and is **accepted**: the body's 2D pose
   *   lives in {@link PhysicsWorld.localPlane}'s frame and feed/publish maps
   *   through that basis (§21). The default plane is world XY, so a `"2d"`
   *   world that never names a plane gets an identity map.
   *
   * `@fourjs/core`'s `isSimulationSpaceMode` still answers §8's question — world
   * and local-plane pass, presentation frames fail.
   */
  #requireSimulationSpace(node: Node, body: RigidBody): void {
    const mode = body.space;
    if (mode === DEFAULT_SPACE_MODE || mode === "local-plane") {
      return;
    }
    const reason = isSimulationSpaceMode(mode)
      ? `§8 permits it for physics, but this world has no mapping for "${mode}"`
      : `§8 states that screen-space content "should not automatically participate in physical simulation unless explicitly mapped to a simulation plane"`;
    throw new FourError(
      "INVALID_SCENE_GRAPH",
      `The RigidBody on node ${node.id} declares space "${mode}", which this PhysicsWorld cannot simulate: ${reason}. Simulate a body whose space is "world" (the default) or "local-plane" and drive the ${mode}-space node from it.`,
      { context: { node: node.id, spaceMode: mode } },
    );
  }

  /**
   * Collects the colliders belonging to `body`: every `Collider` in the subtree
   * rooted at `node` whose own §24 ancestor walk names `body`.
   *
   * The walk is depth-first in child insertion order and the *test* — not the
   * traversal — is what excludes a nested body's colliders, so the world adds no
   * second rule of its own: a collider is registered by exactly the body
   * `Collider.body` resolves to. `requireBody` supplies that resolution and
   * turns a body-less collider into the §23 error naming the node.
   */
  #collectColliders(node: Node, body: RigidBody, out: Collider[]): void {
    const collider = node.getComponent(Collider);
    if (collider !== undefined && collider.requireBody() === body) {
      out.push(collider);
    }
    for (const child of node.children) {
      this.#collectColliders(child, body, out);
    }
  }

  /**
   * §23's mass rule for a switch **to** `"dynamic"`: the body must have a mass,
   * authored or derivable (plan P7-3). See
   * {@link PhysicsWorld.setBodyControlMode}.
   *
   * Three ways to have one, checked in this order:
   *
   * 1. an **authored** positive `RigidBody.mass`;
   * 2. a **positive mass the solver already reports**, which settles the
   *    question outright;
   * 3. at least one **registered collider**, which is what §23/§25 derive a
   *    mass from (density × volume).
   *
   * The third exists because the second cannot be trusted to answer for a body
   * that is not dynamic *yet*: a solver is entitled to report a non-dynamic
   * body's mass as zero — the structural double does exactly that, and
   * `addBody`'s own refresh is written around it — so a kinematic body about to
   * be activated would be refused on a zero that means "not simulated", not "no
   * mass". Asking after the switch instead would mean rejecting a body the
   * solver had already been told to re-type.
   *
   * What is left uncovered is narrow and stated rather than hidden: a body
   * whose only colliders carry an explicit `density: 0` passes this check and
   * lands on whatever mass its solver then derives. §85 permits a zero density,
   * so this rule cannot treat it as an error; the solver's own mass is the
   * answer in that case.
   */
  #requireMassForDynamic(registration: BodyRegistration): void {
    const authored = registration.body.mass;
    if (authored !== undefined && authored > 0) {
      return;
    }
    const derived = this.#adapter.getBodyMass(registration.handle);
    if (Number.isFinite(derived) && derived > 0) {
      return;
    }
    if (registration.colliders.length > 0) {
      return;
    }
    throw new FourError(
      WORLD_ERROR_CODE,
      `Node ${registration.node.id} cannot become a "dynamic" body: it has no authored mass, the solver reports none, and it carries no collider to derive one from (§23, §25, plan P7-3). Give the RigidBody a positive mass, or give the body a collider with a density, before switching it to dynamic — a massless dynamic body does not move.`,
      {
        context: {
          node: registration.node.id,
          authored,
          derived,
          colliders: registration.colliders.length,
        },
      },
    );
  }

  /**
   * The fixed step a §19 velocity inheritance divides by, with the type check
   * that makes the request meaningful (plan P7-3).
   *
   * See {@link PhysicsWorld.setBodyControlMode} for both rules.
   */
  #resolveInheritanceDelta(
    type: BodyType,
    options: BodyControlModeOptions,
  ): number {
    if (type !== "dynamic" && type !== "kinematic-velocity") {
      throw new FourError(
        WORLD_ERROR_CODE,
        `inheritVelocityFrom has no meaning for a ${JSON.stringify(type)} body, which carries no velocity (§22, §23). Only "dynamic" and "kinematic-velocity" bodies can inherit the target's motion; a "kinematic-position" body follows the target pose itself.`,
        { context: { type } },
      );
    }
    const delta = options.fixedDeltaSeconds ?? this.#lastStepDelta;
    if (delta === undefined) {
      throw new FourError(
        WORLD_ERROR_CODE,
        "inheritVelocityFrom needs the fixed step to divide the target's one-step motion by, and this world has not stepped yet (§10, plan P7-3). Pass fixedDeltaSeconds, or switch the body's control mode after the first step.",
        { context: { type } },
      );
    }
    if (!Number.isFinite(delta) || delta <= 0) {
      throw new FourError(
        WORLD_ERROR_CODE,
        `fixedDeltaSeconds must be a positive, finite number of seconds; got ${String(delta)} (§7a, §10, §85).`,
        { context: { type, fixedDeltaSeconds: delta } },
      );
    }
    return delta;
  }

  /**
   * Seeds a re-typed body's velocities from one fixed step of `target`'s own
   * motion (§19, plan P7-3).
   *
   * The formula, the frame, and the shortest-arc rule are documented on
   * {@link PhysicsWorld.setBodyControlMode}; this is that formula and nothing
   * else. Allocates nothing — every intermediate is world-owned scratch.
   */
  #inheritVelocities(
    registration: BodyRegistration,
    target: PoseTarget,
    delta: number,
    wake: boolean,
  ): void {
    const inverseDelta = 1 / delta;

    const linear = this.#inheritedLinear;
    linear
      .copy(target.position)
      .sub(target.previousPosition)
      .scale(inverseDelta);

    // qDelta = rotation · previousRotation⁻¹, the world-frame one-step delta.
    const rotationDelta = this.#inheritedDelta;
    const inverse = this.#inheritedInverse;
    inverse.copy(target.previousRotation).conjugate();
    rotationDelta.copy(target.rotation).multiply(inverse);

    let { x, y, z, w } = rotationDelta;
    if (w < 0) {
      // `q` and `−q` are the same rotation; only one is the short way round.
      x = -x;
      y = -y;
      z = -z;
      w = -w;
    }
    const angular = this.#inheritedAngular;
    const sinHalf = Math.sqrt(x * x + y * y + z * z);
    if (sinHalf === 0) {
      angular.set(0, 0, 0);
    } else {
      const rate = ((2 * Math.atan2(sinHalf, w)) / sinHalf) * inverseDelta;
      angular.set(x * rate, y * rate, z * rate);
    }

    this.#adapter.setBodyVelocities(registration.handle, linear, angular, wake);
  }

  /**
   * Brings §43 pose tracking back in line with what currently moves the node
   * (plan P7-3, plan P7-4).
   *
   * {@link PhysicsWorld.addBody} tracks exactly the nodes whose transform this
   * world writes — the dynamic bodies, whose solved pose it publishes, plus the
   * `"blended"` nodes, whose pose §19's pipeline writes whatever their §22 type
   * is. A body that stops being one of those stops being tracked and one that
   * becomes one starts.
   *
   * Called from {@link PhysicsWorld.setBodyControlMode} (the type changed) and
   * from the publish pass of every step (the *authority* may have changed, and
   * nothing tells the world when it does). A world with no pose buffer does
   * nothing here.
   */
  #retrackPose(registration: BodyRegistration): void {
    if (this.#poses === undefined) {
      return;
    }
    const shouldTrack = shouldTrackPose(
      registration.type,
      registration.node.transformAuthority,
    );
    if (shouldTrack === registration.tracked) {
      return;
    }
    registration.tracked = shouldTrack;
    if (shouldTrack) {
      this.#poses.track(registration.node);
    } else {
      this.#poses.untrack(registration.node);
    }
  }

  /**
   * Reads the solver's mass back onto the component after registration (§23,
   * §25; plan §6d note of 2026-08-01). See {@link PhysicsWorld.addBody}.
   *
   * The value lands on `RigidBody.derivedMass`, **not** on `RigidBody.mass`
   * (2026-08-06). Until then this assigned the setter, which authored the
   * number: `toDescriptor()` re-emitted the solver's own derivation as though
   * the author had written `mass: 3.0141594`, so re-registering the body — or
   * serializing and reloading the scene — silently froze a mass that was
   * supposed to follow the colliders. `RigidBody.mass` still reports the
   * derived value (it falls back to the mirror), so nothing a caller reads
   * changes; what changes is what the body *asks the next solver for*.
   */
  #refreshMassProperties(registration: BodyRegistration): number {
    const mass = this.#adapter.getBodyMass(registration.handle);
    if (Number.isFinite(mass) && mass > 0) {
      setRigidBodyDerivedMass(registration.body, mass);
    }
    /*
     * Returned, not re-read: §41's mass-ratio diagnostic (PH-22n) wants the
     * same number, and a second `getBodyMass` would put a solver call on the
     * registration path that was not there before. Registration's call
     * sequence is unchanged.
     */
    return mass;
  }

  /**
   * {@link PhysicsWorld.#refreshMassProperties} for a body whose collider set
   * just changed at runtime (PH-5, 2026-08-07).
   *
   * Identical when the solver reports a mass, and it adds the one case
   * registration cannot produce: a body that **had** a derived mass and no
   * longer has anything to derive one from. Leaving the mirror behind would
   * make `RigidBody.mass` report the mass of colliders that are gone — the same
   * class of lie `derivedMass` was split out of `mass` to prevent — so the
   * mirror is cleared and the body reports `undefined` again.
   *
   * The clear is gated on the body having **no colliders left**, and not on the
   * reported mass alone, because a non-positive mass is not by itself evidence
   * of anything: §23 forbids expressing "does not simulate" as a zero mass, yet
   * a solver may still answer `0` for a body it is not simulating — a static
   * body under Rapier, any non-dynamic body under the structural double — and
   * `addBody`'s refresh is written around exactly that. "No colliders" is
   * unambiguous.
   */
  #refreshMassAfterColliderChange(registration: BodyRegistration): void {
    const mass = this.#adapter.getBodyMass(registration.handle);
    if (Number.isFinite(mass) && mass > 0) {
      setRigidBodyDerivedMass(registration.body, mass);
      return;
    }
    if (registration.colliders.length === 0) {
      setRigidBodyDerivedMass(registration.body, undefined);
    }
  }

  /**
   * Warns once per world when this world's §32 sleeping **thresholds** differ
   * from Appendix A's and the adapter has declared it cannot apply them (§32,
   * §37; 2026-08-06).
   *
   * `PhysicsWorldOptions.sleeping` is validated, resolved, and handed to
   * `initialize` in full, and both Rapier adapters read exactly one field of it
   * — `enabled`, through `RigidBodyDesc.setCanSleep`. `linearThreshold`,
   * `angularThreshold`, and `timeThreshold` have no binding at Rapier 0.19.3
   * (verified by enumerating `IntegrationParameters` in both builds), so a
   * world that asks bodies to sleep after 5 s of near-stillness gets Rapier's
   * own compiled-in thresholds and no indication that it did.
   *
   * Only a **departure from Appendix A** warns: passing the defaults — or only
   * `{ enabled: false }`, which every adapter here honours — asks for nothing
   * the solver is not already doing, and warning about it would train callers
   * to ignore the message.
   *
   * Emitted from the constructor, before anything is registered, because that
   * is where the mismatch already exists.
   */
  #warnUnhonouredSleepThresholds(): void {
    if (this.#tuning.sleepThresholds) {
      return;
    }
    const sleeping = this.#sleeping;
    const departures: string[] = [];
    if (sleeping.linearThreshold !== DEFAULT_SLEEPING_CONFIG.linearThreshold) {
      departures.push("linearThreshold");
    }
    if (
      sleeping.angularThreshold !== DEFAULT_SLEEPING_CONFIG.angularThreshold
    ) {
      departures.push("angularThreshold");
    }
    if (sleeping.timeThreshold !== DEFAULT_SLEEPING_CONFIG.timeThreshold) {
      departures.push("timeThreshold");
    }
    if (departures.length === 0) {
      return;
    }
    this.#warnTuning(
      "sleepThresholds",
      `sleeping.${departures.join(", sleeping.")} was authored, but adapter ${JSON.stringify(this.#adapter.name)} declares it applies no §32 sleeping thresholds, so the solver keeps its own. The world's sleeping configuration is readable at world.sleeping and reaches the adapter in full; only these fields stop there. sleeping.enabled is unaffected.`,
    );
  }

  /**
   * Warns once per world when a collider carries, **at registration**, a §25
   * material coefficient the adapter has declared it cannot apply (§25, §37;
   * 2026-08-06).
   *
   * ## Registration time only, and why it stays that way (decision, 2026-08-07)
   *
   * This runs when a collider is *registered* — from `addBody`'s subtree scan
   * and, since PH-5, from {@link PhysicsWorld.addCollider} for a collider
   * attached afterwards — and nowhere else. A `PhysicsMaterial` swapped onto an
   * already-registered collider, or mutated in place (which §25 materials
   * permit), is never re-inspected and never warned about.
   *
   * That is not an oversight to be papered over with a third call site. A
   * material change is unobservable to the world (§24/§25 make these plain
   * public fields — the same reason `refreshCollider` has to be *asked*), so
   * there is nothing to hook; hanging the check off `refreshCollider` would
   * warn about the field the caller had just told the world about and stay
   * silent about the one they had not, which is worse than a stated scope.
   *
   * `PhysicsMaterial.rollingFriction` and `spinningFriction` are §25 fields the
   * stable API accepts and validates, and no Rapier 0.19.3 build has a binding
   * for either. Accepting them silently would mean a ball authored to stop
   * rolling that never stops rolling, with nothing anywhere to explain it.
   *
   * The declaration is per-field, so an adapter that gains one of the two later
   * warns about the other alone.
   */
  #warnUnhonouredMaterials(registration: BodyRegistration): void {
    for (const { collider } of registration.colliders) {
      this.#warnUnhonouredMaterial(registration.node, collider);
    }
  }

  /**
   * {@link PhysicsWorld.#warnUnhonouredMaterials} for a single collider — the
   * form {@link PhysicsWorld.addCollider} needs, since it registers one and
   * must not re-warn for the body's existing set (PH-5, 2026-08-07).
   */
  #warnUnhonouredMaterial(node: Node, collider: Collider): void {
    const material = collider.material;
    if (material === undefined) {
      return;
    }
    if (
      material.rollingFriction !== undefined &&
      !this.#tuning.rollingFriction
    ) {
      this.#warnTuning(
        "rollingFriction",
        `A PhysicsMaterial on node ${node.id} sets rollingFriction, but adapter ${JSON.stringify(this.#adapter.name)} declares it does not apply §25 rolling friction, so the value changes nothing in the simulation. Model the resistance another way (angular damping is the usual stand-in), or reach the solver through world.getColliderHandle(collider).`,
      );
    }
    if (
      material.spinningFriction !== undefined &&
      !this.#tuning.spinningFriction
    ) {
      this.#warnTuning(
        "spinningFriction",
        `A PhysicsMaterial on node ${node.id} sets spinningFriction, but adapter ${JSON.stringify(this.#adapter.name)} declares it does not apply §25 spinning friction, so the value changes nothing in the simulation. Model the resistance another way (angular damping is the usual stand-in), or reach the solver through world.getColliderHandle(collider).`,
      );
    }
  }

  /**
   * §41's "diagnostics should warn about suspicious values", for one
   * newly registered body (PH-22n, 2026-08-08).
   *
   * Three checks, one per bullet of the §41 checklist that a solver-agnostic
   * layer can actually see, with the thresholds
   * `docs/guides/units-and-numerical-stability.md` already publishes:
   *
   * | §41 bullet             | Checked                                             | Warns beyond           |
   * | ---------------------- | --------------------------------------------------- | ---------------------- |
   * | Distance from origin   | the body's registered position                      | `1e5` units on an axis |
   * | World scale            | each **dynamic** collider's largest extent           | outside `[1e-2, 1e3]`  |
   * | Mass ratios            | this world's heaviest ÷ lightest dynamic solver mass | `1000:1`               |
   *
   * ## Why these thresholds and not the guide's own advice
   *
   * The guide *advises* keeping masses within ~100× and sizes within ~0.1–10
   * units. A warning fired at the advice would go off in scenes that are
   * perfectly stable, and the fastest way to make a diagnostic useless is to
   * make it routine. Each threshold here is therefore an order of magnitude
   * past the advice: crossing one does not mean "you ignored the guide", it
   * means "you are far enough past it that the solver is likely to show it".
   *
   * **Static and kinematic colliders are exempt from the scale check.** A
   * 40-unit ground slab or a level's triangle mesh is not a scale mistake; the
   * §41 concern is contact tolerance between things that *move*.
   *
   * **It adds no solver call.** `solverMass` is the number
   * {@link PhysicsWorld.#refreshMassProperties} has just read, threaded through
   * rather than re-read, so a registration's `getBodyMass` sequence is exactly
   * what it was before this diagnostic existed.
   *
   * **Registration time only** — the same scope, and the same reasoning, as
   * {@link PhysicsWorld.#warnUnhonouredMaterials}: a body teleported to 1e9
   * afterwards is invisible to the world (§23 makes the transform the scene's,
   * not the world's), and a per-step check would be a per-step cost for a
   * development-only signal. The mass range is cumulative across every body
   * this world has registered, so the pair that trips it need not arrive
   * together.
   */
  /**
   * Warns for a dynamic body that reaches its first step with nothing to derive an
   * inertia tensor from (§23, §25).
   *
   * `mass` supplies mass, not inertia. With no collider geometry to derive the tensor
   * from and no explicit `inertiaTensor`, angular inertia is zero and the solver will not
   * rotate the body — it translates, it responds to joints in translation, and it never
   * turns. Nothing else says so: `derivedMass` is simply left `undefined`, and a scene of
   * such bodies steps happily and sits perfectly still.
   *
   * Found 2026-09-06 by building a two-cylinder engine as a pure linkage — a reasonable
   * thing to do when the joints are the only constraints. The crank could not turn, so
   * nothing in the mechanism moved, and every accuracy check scored a *perfect* zero
   * error because there was no motion to be wrong about.
   *
   * Deferred from `addBody` to here on purpose. PH-5 allows `addCollider` after
   * registration, so at registration a body that is about to be fine is indistinguishable
   * from one that never will be; by the first step the mass properties are the ones the
   * solver is actually going to use. The set is drained whether or not it warns, so this
   * costs one empty-set check per step thereafter.
   */
  #warnInertialessBodies(): void {
    if (this.#inertialessBodies.size === 0) {
      return;
    }
    for (const registration of this.#inertialessBodies) {
      if (registration.colliders.length > 0) {
        continue;
      }
      const node = registration.node;
      const label = node.name === "" ? node.id : `${node.id} ("${node.name}")`;
      console.warn(
        `${DEV_WARNING_PREFIX} Dynamic body ${label} has no collider and no inertiaTensor, so its ` +
          "angular inertia is zero and the solver will never rotate it (§23, §25): it " +
          "translates and answers joints, but a torque or a motor does nothing. `mass` " +
          "supplies mass, not the inertia tensor. Attach a Collider to derive one from " +
          "geometry, or pass inertiaTensor to RigidBody if the body is deliberately " +
          "collider-free.",
      );
    }
    this.#inertialessBodies.clear();
  }

  #warnSuspiciousNumbers(
    registration: BodyRegistration,
    solverMass: number,
  ): void {
    const node = registration.node;
    const position = node.transform.position;
    const farthest = Math.max(
      Math.abs(position.x),
      Math.abs(position.y),
      Math.abs(position.z),
    );
    if (farthest > SUSPICIOUS_COORDINATE) {
      this.#warnTuning(
        "coordinateRange",
        `Node ${node.id} is registered ${String(farthest)} units from the origin. 32-bit float positions lose sub-millimetre fidelity beyond roughly ${String(SUSPICIOUS_COORDINATE)} units, so contacts and joints near this body will jitter (§41, §85). Keep the simulated region within that envelope, or re-centre the world.`,
      );
    }

    if (registration.type === "dynamic") {
      for (const { collider } of registration.colliders) {
        const extent = shapeMaximumExtent(collider.shape);
        if (extent > SUSPICIOUS_EXTENT_MAXIMUM) {
          this.#warnTuning(
            "worldScale",
            `A dynamic ${collider.shape.type} collider on node ${node.id} is ${String(extent)} units across. Collision margins are absolute, so sizes far outside ~0.1–10 units strain contact tolerances (§41). Scale the whole world consistently rather than one body.`,
          );
        } else if (extent < SUSPICIOUS_EXTENT_MINIMUM) {
          this.#warnTuning(
            "worldScale",
            `A dynamic ${collider.shape.type} collider on node ${node.id} is only ${String(extent)} units across. Collision margins are absolute, so a body this small may never register a stable contact (§41). Model in metres rather than millimetres-as-units.`,
          );
        }
      }

      if (Number.isFinite(solverMass) && solverMass > 0) {
        const range = (this.#massRange ??= {
          minimum: solverMass,
          maximum: solverMass,
        });
        range.minimum = Math.min(range.minimum, solverMass);
        range.maximum = Math.max(range.maximum, solverMass);
        if (range.maximum > range.minimum * SUSPICIOUS_MASS_RATIO) {
          this.#warnTuning(
            "massRatio",
            `This world now holds dynamic bodies of ${String(range.minimum)} and ${String(range.maximum)} — a ratio of ${String(Math.round(range.maximum / range.minimum))}:1. Iterative solvers resolve a contact across a ratio this wide poorly, and the light body will be pushed through the heavy one (§41). Keep interacting bodies within ~100× of each other, or link them through intermediate masses.`,
          );
        }
      }
    }
  }

  /**
   * Warns once per world when an **enabled** §28 joint motor meets an adapter
   * that declares its `maxTorque` / `maxForce` is not a hard cap (§28, §37;
   * PH-22e, 2026-08-08).
   *
   * The other three `tuning` warnings fire because a value never reaches the
   * solver. This one fires because it reaches the solver and means something
   * else: on both Rapier adapters the effort limit is a `ForceBased` strength
   * *gain*, so a mechanism authored to stall at `maxTorque` will instead push
   * through the obstruction, slower. That is a wrong simulation with nothing on
   * screen to explain it — the same failure mode, arrived at from the other
   * direction — so it gets the same one-line-per-world treatment.
   *
   * A **disabled** motor is silent: it exerts nothing, so its effort limit
   * cannot mislead. Both the registration path and the queued
   * {@link HingeJoint.setMotor} drain call this, because a motor added after
   * registration is exactly as misleading as one authored with the joint, and
   * the per-world dedup means the pair still prints at most once.
   */
  #warnUngappedJointMotor(joint: Joint): void {
    if (this.#tuning.jointMotorEffortCap) {
      return;
    }
    const motor = readJointMotor(joint);
    if (motor === undefined || !motor.enabled) {
      return;
    }
    this.#warnTuning(
      "jointMotorEffortCap",
      `A ${joint.type} joint's motor limits its effort to ${String(motor.maxEffort)}, but adapter ${JSON.stringify(this.#adapter.name)} declares that limit is a strength gain rather than §28's hard cap (capabilities.tuning.jointMotorEffortCap is false). The motor is stronger for a larger value and weaker for a smaller one, but it will not stall at this one — do not size a mechanism against it. Model the stall another way, or use an adapter that declares a real cap.`,
    );
  }

  /**
   * `console.warn` at most once per world per `key` — the same development
   * semantics `warnAuthorityConflict` (§42) and `RigidBody`'s drift warnings
   * use: the first occurrence names the mistake and every repeat is suppressed,
   * because a scene-wide misconfiguration would otherwise print once per body
   * forever.
   */
  #warnTuning(key: string, message: string): void {
    const warned = (this.#tuningWarned ??= new Set<string>());
    if (warned.has(key)) {
      return;
    }
    warned.add(key);
    console.warn(
      `${DEV_WARNING_PREFIX} ${message} Further ${key} occurrences in this world are suppressed.`,
    );
  }

  /**
   * Pushes one body's — and its colliders' — pending §37 property changes into
   * the solver, then clears them (§23, §24, §25, §31; PH-1 stage 2,
   * 2026-08-07).
   *
   * ## The two early exits are the feature
   *
   * `drainRigidBodySolverWrites` returns `0` for a body nobody wrote to, and
   * {@link PhysicsWorld.#dirtyColliderCount} is `0` for a world nobody called
   * {@link PhysicsWorld.refreshCollider} on. Both cases fall straight through
   * without touching the adapter, which is the guarantee that turning this on
   * changed no existing simulation: a world whose components were not written
   * between steps makes exactly the solver calls it made before.
   *
   * The mask is drained **even when the adapter cannot serve it**, so a body
   * whose writes were already reported as unreachable (the setters warn, see
   * `rigid-body.ts`'s table) does not accumulate bits forever and then flush
   * them all the moment it is registered with a world that can.
   *
   * ## What is pushed, and what deliberately is not
   *
   * §23's mass triple goes as one call and only when the mass is **authored** —
   * a derived mass belongs to the colliders, and pushing it back would author
   * it, which is exactly PH-4's laundering. `centerOfMass` and `inertiaTensor`
   * ride along in whatever state they are in, since a solver sets the three
   * together. The two dampings are one call. The §31 mode carries the authored
   * prediction distance. Colliders re-present their *effective* §25
   * coefficients — the collider's own field beats its `PhysicsMaterial`, and
   * that precedence stays in `Collider`, never in an adapter — plus their §24
   * filter; density is offered only for a body whose mass is collider-derived,
   * because writing one into a body with an authored mass would silently
   * replace it.
   *
   * Allocates nothing.
   */
  #drainSolverWrites(registration: BodyRegistration): void {
    const tuning = this.#bodyTuning;
    const { body, handle } = registration;
    const pending = drainRigidBodySolverWrites(body);

    if (pending !== 0 && tuning !== undefined) {
      if ((pending & RIGID_BODY_MASS_PROPERTIES_DIRTY) !== 0) {
        const mass = body.mass;
        // `massAuthored` and not `mass !== undefined`: the getter falls back to
        // the solver's own derived mass (§23), and re-authoring that is PH-4.
        if (body.massAuthored && mass !== undefined) {
          tuning.setBodyMassProperties(
            handle,
            mass,
            body.centerOfMassAuthored ? body.centerOfMass : undefined,
            body.inertiaTensor,
          );
        }
      }
      if ((pending & RIGID_BODY_DAMPING_DIRTY) !== 0) {
        tuning.setBodyDamping(handle, body.linearDamping, body.angularDamping);
      }
      if ((pending & RIGID_BODY_GRAVITY_SCALE_DIRTY) !== 0) {
        tuning.setBodyGravityScale(handle, body.gravityScale);
      }
      if ((pending & RIGID_BODY_CCD_DIRTY) !== 0) {
        tuning.setBodyCcdMode(handle, body.ccdMode, body.ccdPredictionDistance);
      }
    }

    if (this.#dirtyColliderCount === 0) {
      return;
    }
    for (const colliderRegistration of registration.colliders) {
      if (!colliderRegistration.dirty) {
        continue;
      }
      colliderRegistration.dirty = false;
      this.#dirtyColliderCount -= 1;
      if (tuning === undefined) {
        continue;
      }
      const { collider } = colliderRegistration;
      tuning.setColliderMaterial(
        colliderRegistration.handle,
        collider.effectiveFriction,
        collider.effectiveRestitution,
        body.massAuthored ? undefined : collider.effectiveDensity,
      );
      tuning.setColliderFilter(
        colliderRegistration.handle,
        collider.sensor,
        collider.collisionGroups,
        collider.collisionMask,
      );
    }
  }

  /**
   * Drains one body's §26 command buffer into the solver and clears it (§26,
   * §32).
   *
   * Forces and torques are reset first, because a solver commonly keeps user
   * forces until they are cleared and §26 makes a force act for exactly one
   * step; impulses are applied as they stand and the buffer's own clearing makes
   * them one-shot. Zero-magnitude accumulations are skipped — nothing was asked
   * for, and calling a solver with a zero force can wake a sleeping body.
   */
  #applyCommands(registration: BodyRegistration): void {
    const adapter = this.#adapter;
    const { handle, body } = registration;
    const commands = body.commands;

    adapter.resetForces(handle);
    if (!isZero(commands.force)) {
      adapter.applyForce(handle, commands.force);
    }
    if (!isZero(commands.torque)) {
      adapter.applyTorque(handle, commands.torque);
    }
    for (let i = 0; i < commands.pointForceCount; i += 1) {
      const load = commands.pointForces[i];
      adapter.applyForceAtPoint(handle, load.value, load.point);
    }
    if (!isZero(commands.impulse)) {
      adapter.applyImpulse(handle, commands.impulse);
    }
    if (!isZero(commands.angularImpulse)) {
      adapter.applyAngularImpulse(handle, commands.angularImpulse);
    }
    for (let i = 0; i < commands.pointImpulseCount; i += 1) {
      const load = commands.pointImpulses[i];
      adapter.applyImpulseAtPoint(handle, load.value, load.point);
    }
    if (commands.sleepCommand === "wake") {
      adapter.wakeBody(handle);
    } else if (commands.sleepCommand === "sleep") {
      adapter.sleepBody(handle);
    }
    clearRigidBodyCommands(body);
  }

  /**
   * Pushes a kinematic body's scene-authored target into the solver before the
   * step — §37's `syncSceneToSolver` role, expressed per handle (§22).
   *
   * - `"kinematic-position"` takes the node's local transform as the target
   *   pose, so the solver derives the motion that lets it push dynamic bodies.
   * - `"kinematic-velocity"` takes the component's authored velocities, which
   *   are §23's input for exactly this body type.
   *
   * A position-driven body whose node is under `"physics"` authority is skipped:
   * that authority means the solver owns the pose, so reading it back as a
   * target would be circular. Every other authority — `"manual"` (user code),
   * `"kinematic"` (`MotionSystem` and the §12 controller), `"animation"` (a clip
   * or timeline), and the externally-driven ones — is a scene-side writer whose
   * pose is precisely what a kinematic body should follow (decision, WP-5.3;
   * the packet named `"kinematic"`/`"animation"`, and the wider rule is the same
   * rule stated by its one exclusion).
   *
   * ## `"blended"` feeds the target, not the transform (§19 steps 1–3)
   *
   * Under `"blended"` authority the node's transform is §19's *output* — the
   * blend of the last step's target and solver poses — so feeding it back would
   * be the same circularity the `"physics"` skip avoids, one step delayed. The
   * `PoseTarget` is the input §19 step 1 names ("animation produces a target
   * pose"), and it is what a kinematic body under this authority is driven to.
   *
   * The target is fed **unweighted**, deliberately: the §19 weights are applied
   * exactly once, in the publish pass. Weighting the feed as well would apply
   * `animationWeight` twice — the solver pose would already be part-way to the
   * target and would then be blended towards it again — which is a low-pass
   * filter nobody asked for, and this packet ships no hidden smoothing. It also
   * makes the degenerate case honest: for a `"kinematic-position"` body the
   * solver *is* the target, so every weight produces the target pose, which is
   * the truth about a body that has no dynamics to contribute.
   *
   * (Plan P7-4 wrote "feeds targets to kinematic bodies (animation-weighted)";
   * the deviation is this paragraph — WP-7.3.)
   */
  #feedKinematic(registration: BodyRegistration): void {
    const { type, node } = registration;
    if (type === "kinematic-position") {
      const authority = node.transformAuthority;
      if (authority === BLENDED_AUTHORITY) {
        const target = this.#requirePoseTarget(registration);
        this.#feedPose(registration, target.position, target.rotation);
        return;
      }
      if (authority === PHYSICS_AUTHORITY) {
        return;
      }
      this.#feedPose(
        registration,
        node.transform.position,
        node.transform.rotation,
      );
      return;
    }
    if (type === "kinematic-velocity") {
      this.#feedVelocities(registration);
    }
  }

  /**
   * Publishes one body's solved state after the step (§23, §32, §42).
   *
   * The transform is written **only for a dynamic body and only under
   * `"physics"` authority**: §42 gives a transform exactly one owner, and the
   * enforcement is the one `@fourjs/scene` documents — the non-owner's write is
   * refused and reported once per node per writer, so the owner keeps the
   * transform. The solved pose goes straight into the node's own
   * `position`/`rotation`, which fires plan D3's change hooks and advances
   * `Transform.version` exactly once each.
   *
   * Velocities and the §32 sleep flag are refreshed for **every** body,
   * including one whose transform write was refused: they are the component
   * mirroring solver state that §23 promises ("the solver owns its velocities;
   * `syncSolverToScene` refreshes these fields"), not a transform write, so §42
   * has nothing to say about them and leaving them stale would make the
   * component lie about the simulation (decision, WP-5.3).
   *
   * ## `"blended"` (§19 step 5, plan P7-4)
   *
   * A node under `"blended"` authority is written by `#publishBlended` instead,
   * **without a warning** — the §19 pipeline is that node's single owner (§42),
   * so this is the owner writing and not a second writer — and **whatever its
   * §22 type is**: nothing else moves a `"blended"` node (animation writes its
   * `PoseTarget`, not its transform), so a blended kinematic or static body
   * whose transform this pass skipped would simply never move.
   *
   * Every other authority behaves exactly as it did before: a dynamic body
   * writes under `"physics"` and warns-and-skips elsewhere, and a non-dynamic
   * body writes no transform at all.
   */
  #publishBody(registration: BodyRegistration): void {
    const { node, body, handle, type } = registration;
    if (node.transformAuthority === BLENDED_AUTHORITY) {
      this.#publishBlended(registration);
    } else if (type === "dynamic") {
      if (node.transformAuthority === PHYSICS_AUTHORITY) {
        this.#publishSolverPose(registration);
      } else {
        warnAuthorityConflict(node, PHYSICS_AUTHORITY);
      }
    }
    this.#publishSolverVelocities(registration);
    setRigidBodySleeping(body, this.#adapter.isBodySleeping(handle));
    this.#retrackPose(registration);
  }

  /**
   * Writes §19's blended pose onto a `"blended"` node — step 5 of §19's
   * pipeline, "optional blending combines animated and physical poses" (plan
   * P7-4).
   *
   * ```text
   * w        = body.normalizedWeights()          (§19's two sliders, summing to 1)
   * position = lerp(solverPosition, targetPosition, w.animation)
   * rotation = slerp(solverRotation, targetRotation, w.animation)   shortest arc
   * scale    = lerp((1, 1, 1), targetScale, w.animation)
   * ```
   *
   * Scale's physical side is identity: a solver body has no scale
   * (decision, 2026-09-06).
   *
   * `Quaternion.slerp` already takes the short way round an antipodal pair (it
   * negates the far end when the dot product is negative, plan D8), so a target
   * and a solver pose that describe the same rotation with opposite quaternion
   * signs blend along the arc between them rather than the long way round.
   *
   * ## The two extremes are exact, by construction
   *
   * A weight pair of `1 / 0` runs the **same `getBodyTransform` call into the
   * same destination** as the plain `"physics"` publish above, and `0 / 1`
   * copies the target's own numbers; neither goes near the interpolators. That
   * is not an optimization — it is the guarantee that switching a node between
   * `"physics"` and a fully-physical `"blended"` changes nothing at all, bit for
   * bit. `lerp(a, b, 0)` is `a + (b − a) · 0`, which is `a` for every finite `a`
   * but turns `-0` into `+0`; `slerp(a, b, 0)` renormalizes and is not exact at
   * all. Interpolating at the endpoints would therefore introduce a
   * one-ulp-scale discontinuity exactly where §110 asks for none.
   *
   * Between the extremes the solver pose is read into scratch and combined
   * **in place**, so the node's own vectors are written once each and plan D3's
   * change hooks fire once each. Allocates nothing.
   */
  #publishBlended(registration: BodyRegistration): void {
    const { node, body, handle } = registration;
    const target = this.#requirePoseTarget(registration);
    const weights = body.normalizedWeights(this.#blendWeights);
    const { position, rotation, scale } = node.transform;

    if (weights.animation === 0) {
      this.#publishSolverPose(registration);
      scale.set(1, 1, 1);
      return;
    }
    if (weights.physics === 0) {
      position.copy(target.position);
      rotation.copy(target.rotation);
      scale.copy(target.scale);
      return;
    }

    const blendedPosition = this.#blendPosition;
    const blendedRotation = this.#blendRotation;
    this.#adapter.getBodyTransform(handle, blendedPosition, blendedRotation);
    if (this.#needsPoseMap(registration)) {
      this.#fromSolverPose(
        registration,
        blendedPosition,
        blendedRotation,
        blendedPosition,
        blendedRotation,
      );
    }
    position.copy(blendedPosition.lerp(target.position, weights.animation));
    rotation.copy(blendedRotation.slerp(target.rotation, weights.animation));
    scale.set(1, 1, 1).lerp(target.scale, weights.animation);
  }

  /**
   * The `PoseTarget` of a `"blended"` node, or the §19 error naming what the
   * trio is missing (plan P7-4).
   *
   * §19's pipeline needs three things a node cannot declare in one place:
   * `"blended"` authority (§42), a `RigidBody` registered with a world — which
   * is given, since this is only ever reached from a registration — and the
   * `PoseTarget` animation writes. The third is the one that can be absent, and
   * it is absent silently: the node would simply be a body whose transform
   * nothing writes. So it throws, at the first step that tried to blend it,
   * naming the node and the missing component.
   */
  #requirePoseTarget(registration: BodyRegistration): PoseTarget {
    const target = registration.node.getComponent(PoseTarget);
    if (target === undefined) {
      throw new FourError(
        "INVALID_SCENE_GRAPH",
        `Node ${registration.node.id} declares "blended" transform authority but has no PoseTarget component, so §19's pipeline has no animated pose to blend against (§19, §42, §6a). Attach one with node.addComponent(new PoseTarget().copyFrom(node.transform)), or choose another authority.`,
        {
          context: { node: registration.node.id, authority: BLENDED_AUTHORITY },
        },
      );
    }
    return target;
  }

  /**
   * Drains the step's events and queues them with component references (§29,
   * §37, §101).
   *
   * Translation happens **here**, immediately after the step and before any
   * listener runs, so a handle is resolved while it is still valid: a listener
   * that removes a body during dispatch cannot invalidate an event that was
   * already normalized. An event naming a body or collider this world has not
   * registered is dropped — there is no component to name in the payload.
   */
  /**
   * Forwards the bodies' `collisionstay` listener presence to the adapter
   * (see `PhysicsSolverAdapter.setEventInterest`), only when it changes, so a
   * quiet world issues no extra adapter call per step. One integer read per
   * body per step; the adapter without the member costs nothing at all.
   */
  #publishEventInterest(): void {
    const adapter = this.#adapter;
    if (adapter.setEventInterest === undefined) {
      return;
    }
    let stay = false;
    for (const registration of this.#bodiesByNode.values()) {
      if (registration.body.listenerCount("collisionstay") > 0) {
        stay = true;
        break;
      }
    }
    if (stay !== this.#stayInterest) {
      this.#stayInterest = stay;
      adapter.setEventInterest({ collisionstay: stay });
    }
  }

  #collectEvents(): void {
    const drained = this.#adapter.drainEvents();
    for (let i = 0; i < drained.length; i += 1) {
      const translated = this.#translate(drained[i]);
      if (translated !== undefined) {
        this.#queue.push(translated);
      }
    }
  }

  /** Swaps one event's handles for components, or `undefined` if unknown here. */
  #translate(event: PhysicsEvent): WorldPhysicsEvent | undefined {
    switch (event.type) {
      case "collisionstart":
      case "collisionstay":
      case "collisionend": {
        const bodyA = this.#bodyOf(event.bodyA);
        const bodyB = this.#bodyOf(event.bodyB);
        const colliderA = this.#colliderOf(event.colliderA);
        const colliderB = this.#colliderOf(event.colliderB);
        if (
          bodyA === undefined ||
          bodyB === undefined ||
          colliderA === undefined ||
          colliderB === undefined
        ) {
          return undefined;
        }
        return {
          type: event.type,
          bodyA: bodyA.body,
          bodyB: bodyB.body,
          colliderA: colliderA.collider,
          colliderB: colliderB.collider,
          contacts: event.contacts,
          relativeVelocity: event.relativeVelocity,
          totalImpulse: event.totalImpulse,
        };
      }
      case "triggerenter":
      case "triggerexit": {
        const sensor = this.#colliderOf(event.sensor);
        const sensorBody = this.#bodyOf(event.sensorBody);
        const other = this.#colliderOf(event.other);
        const otherBody = this.#bodyOf(event.otherBody);
        if (
          sensor === undefined ||
          sensorBody === undefined ||
          other === undefined ||
          otherBody === undefined
        ) {
          return undefined;
        }
        return {
          type: event.type,
          sensor: sensor.collider,
          sensorBody: sensorBody.body,
          other: other.collider,
          otherBody: otherBody.body,
        };
      }
      case "jointbreak": {
        /*
         * Breakage is the world's own (plan P6-2), so this arm is only reached
         * when an adapter's solver broke a joint by itself. Treat the adapter
         * as authoritative — the constraint is already gone on its side — and
         * retire the registration **without** a second `destroyJoint`.
         */
        if (this.#jointsByJoint.size === 0) {
          return undefined;
        }
        const registration = this.#jointsById.get(
          this.#requireJointAccess().getJointId(event.joint),
        );
        if (registration === undefined) {
          return undefined;
        }
        this.#retireJoint(registration, false);
        setJointBroken(registration.joint);
        return {
          type: event.type,
          joint: registration.joint,
          force: event.force,
          torque: event.torque,
        };
      }
      default: {
        const body = this.#bodyOf(event.body);
        if (body === undefined) {
          return undefined;
        }
        return { type: event.type, body: body.body };
      }
    }
  }

  /** The registration for a body handle, by the adapter's monotonic id (§33). */
  #bodyOf(handle: PhysicsBodyHandle): BodyRegistration | undefined {
    return this.#bodiesById.get(this.#adapter.getBodyId(handle));
  }

  /** The registration for a collider handle, by the adapter's monotonic id. */
  #colliderOf(handle: PhysicsColliderHandle): ColliderRegistration | undefined {
    return this.#collidersById.get(this.#adapter.getColliderId(handle));
  }

  /** {@link PhysicsWorld.overlapSphere} and `overlapBox` share this body (§30). */
  #overlap(
    shape: CollisionShape,
    position: Vector3Input,
    rotation: RotationInput | undefined,
    options: QueryOptions | undefined,
  ): WorldOverlapHit[] {
    this.#requireQuery("overlap");
    const query: OverlapQuery = { ...options, shape, position };
    if (rotation !== undefined) {
      query.rotation = rotation;
    }
    const hits: WorldOverlapHit[] = [];
    for (const hit of this.#adapter.overlap(query)) {
      const target = this.#colliderOf(hit.collider);
      if (target !== undefined) {
        hits.push({ collider: target.collider, body: target.body.body });
      }
    }
    return hits;
  }

  /**
   * Pushes every joint's queued §28 reconfiguration into the solver, in
   * registration order, and clears the queues.
   *
   * The joint half of step 1 of the pipeline. A joint nobody touched costs one
   * boolean test: the four dirty bits are only ever set by the
   * setters, and `bindJoint` clears them at registration because the descriptor
   * the solver was just built from already carried the current values.
   */
  #applyJointCommands(): void {
    if (this.#jointsByJoint.size === 0) {
      return;
    }
    const access = this.#requireJointAccess();
    for (const registration of this.#jointsByJoint.values()) {
      const joint = registration.joint;
      const commands = joint.commands;
      if (
        !commands.limitsDirty &&
        !commands.motorDirty &&
        !commands.collisionDirty &&
        !commands.anchorsDirty
      ) {
        continue;
      }
      if (commands.limitsDirty) {
        const limits = readJointLimits(joint);
        if (limits !== undefined) {
          access.setJointLimits(registration.handle, limits.min, limits.max);
        }
      }
      if (commands.motorDirty) {
        const motor = readJointMotor(joint);
        if (motor !== undefined) {
          this.#warnUngappedJointMotor(joint);
          access.setJointMotor(registration.handle, motor);
        }
      }
      if (commands.collisionDirty) {
        access.setJointCollisionEnabled(
          registration.handle,
          joint.collisionEnabled,
        );
      }
      if (commands.anchorsDirty) {
        readJointAnchors(joint, this.#jointAnchorA, this.#jointAnchorB);
        access.setJointAnchors(
          registration.handle,
          this.#jointAnchorA,
          this.#jointAnchorB,
        );
      }
      clearJointCommands(joint);
    }
  }

  /**
   * Destroys every joint whose reaction exceeded its §28 break thresholds and
   * queues a `"jointbreak"` for each (plan P6-2).
   *
   * Step 7 of the pipeline, so it reads the solver *after* the solve. The
   * reaction arrives as the impulses the constraint applied during the step
   * (`SolverJointAccess.getJointReaction`); dividing by `deltaSeconds` turns
   * them into the newtons and newton-metres §28 states its thresholds in, which
   * is the one place that conversion happens.
   *
   * The comparison is **strict**: a joint sitting exactly at its threshold
   * survives, and only a load that exceeds it breaks the joint. Joints are
   * visited in registration order and a broken one is destroyed immediately, so
   * a step that overloads three joints breaks all three, each exactly once —
   * the registry no longer holds them by the next step.
   *
   * Allocates nothing: the reaction vectors are world-owned scratch.
   */
  #monitorJointBreakage(deltaSeconds: number): void {
    if (this.#jointsByJoint.size === 0) {
      return;
    }
    const access = this.#requireJointAccess();
    if (!access.reportsJointReactions) {
      return;
    }
    const linear = this.#reactionLinear;
    const angular = this.#reactionAngular;
    // Snapshot first: a break mutates the registry while it is being walked.
    // Into world-owned scratch (cleared afterwards), not a fresh array — this
    // runs every step for every world with a joint (2026-09-11 audit).
    const registrations = this.#jointScratch;
    for (const registration of this.#jointsByJoint.values()) {
      registrations.push(registration);
    }
    for (const registration of registrations) {
      const joint = registration.joint;
      if (!joint.breakable) {
        continue;
      }
      access.getJointReaction(registration.handle, linear, angular);
      const force = deltaSeconds === 0 ? 0 : linear.length() / deltaSeconds;
      const torque = deltaSeconds === 0 ? 0 : angular.length() / deltaSeconds;
      const overForce =
        joint.breakForce !== undefined && force > joint.breakForce;
      const overTorque =
        joint.breakTorque !== undefined && torque > joint.breakTorque;
      if (!overForce && !overTorque) {
        continue;
      }
      this.#retireJoint(registration, true);
      setJointBroken(joint);
      const event: JointBreakEvent<Joint> = {
        type: "jointbreak",
        joint,
        force,
        torque,
      };
      this.#queue.push(event);
    }
    registrations.length = 0;
  }

  /**
   * Converts `joint`'s world-space anchors and axis into the two bodies' local
   * frames, against the poses the solver holds right now (§28; see `joints.ts`
   * for the convention).
   *
   * The vectors are freshly allocated per registration rather than taken from
   * world scratch: the descriptor holds them by reference, and a shared buffer
   * would rewrite the anchors of the joint registered before this one.
   */
  #bindJointFrames(
    joint: Joint,
    bodyA: BodyRegistration,
    bodyB: BodyRegistration,
  ): JointBinding {
    const position = this.#bindingPosition;
    const rotation = this.#bindingRotation;
    const scratch = this.#bindingScratch;
    const anchorA = new Vector3();
    const anchorB = new Vector3();
    const axis = new Vector3();

    this.#adapter.getBodyTransform(bodyA.handle, position, rotation);
    if (joint.anchorsAreLocal) {
      if (joint.anchorA !== undefined) {
        anchorA.copy(joint.anchorA);
      }
    } else if (joint.anchorA !== undefined) {
      worldAnchorToLocal(position, rotation, joint.anchorA, anchorA, scratch);
    }
    joint.worldAxis(this.#dimension, axis);
    if (axis.lengthSq() > 0) {
      worldAxisToLocal(rotation, axis, axis, scratch);
    }

    this.#adapter.getBodyTransform(bodyB.handle, position, rotation);
    if (joint.anchorsAreLocal) {
      if (joint.anchorB !== undefined) {
        anchorB.copy(joint.anchorB);
      }
    } else if (joint.anchorB !== undefined) {
      worldAnchorToLocal(position, rotation, joint.anchorB, anchorB, scratch);
    }

    if (!joint.anchorsAreLocal) {
      // Write the converted locals back so later setAnchors / field reads are
      // one space. The joint is not registered yet, so this does not queue.
      joint.setAnchors(anchorA, anchorB);
    }

    return { bodyA: bodyA.handle, bodyB: bodyB.handle, anchorA, anchorB, axis };
  }

  /**
   * Drops one joint registration, optionally destroying the solver's constraint
   * (§83).
   *
   * `destroy` is `false` only when the adapter has already removed the joint
   * itself — see the `"jointbreak"` arm of {@link PhysicsWorld.dispatchEvents}'
   * translation.
   */
  #retireJoint(registration: JointRegistration, destroy: boolean): void {
    this.#jointsByJoint.delete(registration.joint);
    this.#jointsById.delete(registration.id);
    unbindJoint(registration.joint);
    if (destroy) {
      this.#adapter.destroyJoint(registration.handle);
    }
    noteSolverJoint(-1);
  }

  /**
   * Destroys every joint naming `body`, in reverse registration order, before
   * the body itself goes away (§83). See {@link PhysicsWorld.removeBody}.
   */
  #destroyJointsOf(body: BodyRegistration): void {
    if (this.#jointsByJoint.size === 0) {
      return;
    }
    const registrations = [...this.#jointsByJoint.values()].reverse();
    for (const registration of registrations) {
      if (registration.bodyA === body || registration.bodyB === body) {
        this.#retireJoint(registration, true);
      }
    }
  }

  /** The registration for `component`, or the §28 error naming what is missing. */
  #requireRegisteredBody(
    joint: Joint,
    field: string,
    component: RigidBody,
  ): BodyRegistration {
    const registration = this.#bodiesByComponent.get(component);
    if (registration === undefined) {
      throw new FourError(
        WORLD_ERROR_CODE,
        `A ${joint.type} joint's ${field} is not registered with this PhysicsWorld (§28). Call world.addBody(node) for both bodies before adding the joint that constrains them.`,
        { context: { type: joint.type, field } },
      );
    }
    return registration;
  }

  /**
   * The adapter as a {@link SolverJointAccess}, or the error explaining what it
   * is missing (WP-6.1).
   *
   * Structural detection, not a capability flag — `supportsSolverJointAccess`
   * documents why. The check runs on every joint entry point rather than once at
   * construction so that a world whose adapter has no joints is still perfectly
   * usable for everything else, which is exactly the Phase 5 situation.
   */
  #requireJointAccess(): SolverJointAccess {
    if (supportsSolverJointAccess(this.#adapter)) {
      return this.#adapter;
    }
    const missing = missingSolverJointAccess(this.#adapter);
    throw new FourError(
      "NOT_IMPLEMENTED",
      `Adapter ${JSON.stringify(this.#adapter.name)} does not implement SolverJointAccess and cannot carry §28 joints; it is missing ${missing.join(", ")} (§37, plan P6-1). Joints need more than §37's createJoint/destroyJoint: an id to order by (§33), a reaction to compare against break thresholds (plan P6-2), and live limit/motor reconfiguration.`,
      { context: { adapter: this.#adapter.name, missing } },
    );
  }

  /**
   * Destroys one registration's solver objects (§37, §83) and releases the
   * component-side bookkeeping that went with them: the component→handle
   * indices {@link PhysicsWorld.getColliderHandle} reads, and the `RigidBody`'s
   * registration count, which is what its "this write reaches no solver"
   * warnings are gated on.
   *
   * The single place both `removeBody` and `dispose` funnel through, so a
   * disposed world leaves no component believing it is still simulated.
   *
   * ## One `destroyBody`, not one call per collider (2026-08-07)
   *
   * §37 defines `destroyBody` as destroying "a body and everything attached to
   * it", so the body's colliders are the adapter's to free and this method
   * frees them by destroying the body. It used to call `destroyCollider` for
   * each of them first, which was work no one could observe and work that cost:
   * every such call re-established the §23 mass of a body that ceased to exist
   * on the next line — on the Rapier adapters a `Collider.setMass` on a
   * collider already being removed plus a `recomputeMassPropertiesFromColliders`
   * per collider, each preceded by a scan for the body's surviving
   * lowest-id collider. Teardown of an N-collider body was quadratic in the
   * world's collider count for a result that was immediately discarded.
   *
   * **Teardown path only, and nothing else moved.** A world registers and
   * unregisters colliders with their body — there is no single-collider
   * removal on this class — so this is the only call site that changed;
   * `PhysicsSolverAdapter.destroyCollider` remains §37's contract for an
   * adapter used directly, and both Rapier adapters keep the mass refresh that
   * matters when a collider is destroyed and its body survives. Step order,
   * event dispatch, and the order of the registry deletions below are
   * untouched: the component→handle indices are still released in reverse
   * registration order, and a stepping world sees exactly the solver calls it
   * saw before.
   *
   * The one thing this leans on is the §37 sentence quoted above. An adapter
   * whose `destroyBody` left its colliders behind was already violating it —
   * and would previously have been rescued by this method's per-collider calls,
   * which is a rescue no contract promised.
   */
  #destroyRegistration(registration: BodyRegistration): void {
    // Body first: §37 makes the adapter responsible for what is attached to it.
    this.#adapter.destroyBody(registration.handle);
    noteSolverCollider(-registration.colliders.length);
    for (let i = registration.colliders.length - 1; i >= 0; i -= 1) {
      const collider = registration.colliders[i];
      // A refresh nobody served does not survive the collider it was asked for
      // (PH-1 stage 2): leaving the count high would make every later step pay
      // for a scan that can find nothing.
      if (collider.dirty) {
        this.#dirtyColliderCount -= 1;
      }
      this.#collidersById.delete(collider.id);
      this.#collidersByComponent.delete(collider.collider);
    }
    registration.colliders.length = 0;
    setRigidBodyRegistered(
      registration.body,
      false,
      this.#bodyTuning !== undefined,
    );
    if (registration.tracked) {
      this.#poses?.untrack(registration.node);
    }
    noteSolverBody(-1);
  }

  /** Guards the §30 surface against an adapter that does not implement it (§37). */
  #requireQuery(
    kind: keyof PhysicsWorldAdapter["capabilities"]["queries"],
  ): void {
    this.#requireReady();
    if (!this.#adapter.capabilities.queries[kind]) {
      throw new FourError(
        "NOT_IMPLEMENTED",
        `Adapter ${JSON.stringify(this.#adapter.name)} declares capabilities.queries.${kind}: false (§30, §37).`,
        { context: { adapter: this.#adapter.name, query: kind } },
      );
    }
  }

  /** Everything but the constructor needs an initialized, undisposed world. */
  #requireReady(): void {
    this.#assertNotDisposed();
    if (!this.#initialized) {
      throw new FourError(
        WORLD_ERROR_CODE,
        "PhysicsWorld has not been initialized; await world.initialize() before registering bodies or stepping (§37: a WebAssembly solver loads its module there).",
        { context: { adapter: this.#adapter.name } },
      );
    }
  }

  /** A disposed world is terminal (§83). */
  #assertNotDisposed(): void {
    if (this.#disposed) {
      throw new FourError(
        WORLD_ERROR_CODE,
        "PhysicsWorld has been disposed; its solver objects are gone and its adapter is disposed (§83). Construct a new world.",
        { context: { adapter: this.#adapter.name } },
      );
    }
  }
}

/** Whether an accumulated §26 command is empty, so the solver is left alone. */
function isZero(value: Vector3): boolean {
  return value.x === 0 && value.y === 0 && value.z === 0;
}

/**
 * Whether a world writes this node's transform every step, and therefore
 * whether §43 should interpolate it (§42, §43; plan P7-4).
 *
 * Exactly the two cases the publish pass writes: a dynamic body under its
 * solver, and a `"blended"` node under §19's pipeline whatever its §22 type.
 */
function shouldTrackPose(
  type: BodyType,
  authority: TransformAuthority,
): boolean {
  return type === "dynamic" || authority === BLENDED_AUTHORITY;
}

/**
 * Priority of the system {@link createPoseTargetCaptureSystem} builds: one
 * notch before §39 step 3, "animation target evaluation"
 * (`PRIORITY_ANIMATION_TARGETS`).
 *
 * §19 step 1 is "animation produces a target pose", so every system that writes
 * a `PoseTarget` runs at step 3 or later, and the history capture has to be the
 * last thing before them: capture at step 3 − 1 and the whole of the §39 order
 * from step 3 onwards is "this step's target motion". Registering a target
 * writer *earlier* than this — anywhere in steps 1–2 — would have its write
 * flattened by the capture, which is the one ordering mistake this constant
 * exists to make nameable.
 */
export const POSE_TARGET_CAPTURE_PRIORITY = PRIORITY_ANIMATION_TARGETS - 1;

/** Options for {@link createPoseTargetCaptureSystem}. */
export interface PoseTargetCaptureSystemOptions {
  /**
   * Execution order key (§39). Defaults to
   * {@link POSE_TARGET_CAPTURE_PRIORITY}. Read once, at registration, like
   * every other system's priority.
   */
  priority?: number;
}

/**
 * Builds the `SimulationSystem` that calls
 * {@link PhysicsWorld.capturePoseTargets} on every world in `worlds`, once per
 * fixed step, before §39 step 3 (plan D5: features register systems, nothing
 * edits the scheduler; plan P7-4).
 *
 * ```ts
 * const physics = new PhysicsSystem({ worlds: [world] });
 * app.systems.register(createPoseTargetCaptureSystem(physics.worlds));
 * app.systems.register(physics);
 * ```
 *
 * `worlds` is **iterated every step, not copied**, so passing
 * `PhysicsSystem.worlds` — the system's own live array — makes the capture
 * follow `track`/`untrack` with nothing to keep in sync. A plain array literal
 * works just as well for an application that steps its worlds itself.
 *
 * ## Register it, or lose the history
 *
 * This is the one part of §19's pipeline `PhysicsWorld` cannot run from inside
 * its own step (see {@link PhysicsWorld.capturePoseTargets}), so it is the one
 * part an application has to wire up. Without it every `PoseTarget` keeps
 * `previous === current` forever: blending still works — it reads the target's
 * current pose — but `setBodyControlMode`'s `inheritVelocityFrom` inherits zero
 * velocity, which is §19's ragdoll dropping from rest instead of continuing the
 * animation's motion.
 *
 * Returns a plain object rather than a class instance: it holds no state of its
 * own beyond the two arguments, and `dispose` deliberately does nothing — the
 * worlds outlive the system.
 */
export function createPoseTargetCaptureSystem(
  worlds: Iterable<PhysicsWorld>,
  options: PoseTargetCaptureSystemOptions = {},
): SimulationSystem {
  const priority = options.priority ?? POSE_TARGET_CAPTURE_PRIORITY;
  return {
    priority,
    initialize(): void {
      // Nothing to set up: the worlds are supplied and own their own state.
    },
    fixedUpdate(): void {
      for (const world of worlds) {
        world.capturePoseTargets();
      }
    },
    dispose(): void {
      // Deliberately empty; see the factory's documentation.
    },
  };
}
