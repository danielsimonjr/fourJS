/**
 * `@fourjs/physics` — the stable, solver-independent physics API (§101, Part IV).
 *
 * Application code targets this package and never a solver directly (§20); a
 * concrete engine reaches it through `PhysicsSolverAdapter` (§37).
 *
 * WP-5.1 shipped the **types and the pure functions**: the §20–§34 public
 * vocabulary, the four §37 descriptors, the §24 shape unions, `PhysicsMaterial`
 * and the §25 combination rules, the §29 event payloads, the §30 query records
 * and their filter semantics, the §37 adapter contract, and the §85 validators.
 * WP-5.2 adds the two §6a components — `RigidBody` (§23, §26) and `Collider`
 * (§24, §25) — which hold the authored state a user manipulates and produce the
 * descriptors an adapter is built from. `PhysicsWorld` / `PhysicsSystem`, which
 * register those components and drain their command buffers, arrive in WP-5.3.
 * WP-6.1 adds §28's constraints: the `Joint` classes, the full
 * `JointDescriptor` union of the plan P6-1 tier, the `SolverJointAccess` seam,
 * and the world's `addJoint`/`removeJoint` with plan P6-2 break monitoring.
 * WP-7.2 adds §19's control-mode transitions: `SolverBodyAccess.setBodyType`
 * and `PhysicsWorld.setBodyControlMode`, which re-type a registered body in
 * place with optional velocity inheritance from an animated `PoseTarget`.
 * WP-7.3 adds §19's blend pipeline itself, under the `"blended"` transform
 * authority (§42): the world feeds pose targets to kinematic bodies before the
 * solve and writes the weighted target/solver pose after it, plus
 * `createPoseTargetCaptureSystem` — the §39 step-3−1 system an application must
 * register for the target history the blend's velocity inheritance reads.
 * 2026-08-06 adds the §79 component serializers (`PH-17`):
 * `RIGID_BODY_SERIALIZER` and `COLLIDER_SERIALIZER`, typed against the
 * structural `ComponentSerializerShape` so registering them into
 * `@fourjs/serialization`'s registry needs no new §3.1 edge.
 *
 * `PH-11b` (2026-08-21) adds §12's **solver-backed** character controller:
 * `SweptCharacterController` — a capsule swept through `PhysicsWorld.shapeCast`
 * (§30) with slide-along-wall, step height and a slope limit — the
 * `SweptCharacterSystem` that advances it at §39 step 4 under §42's
 * `"kinematic"` authority, and its §79 serializer. It **holds** a
 * `CharacterController` rather than extending one; the module states why.
 *
 * Named exports only, alphabetical within each module group.
 */

export const PACKAGE_NAME = "@fourjs/physics";

// §81's physics-side capability token (RFC 0002), declared by the package
// that owns the §37 registry; `@fourjs/four`'s `plugins.ts` re-exports the same
// object, so both import paths hand out one identity.
export { SOLVER_REGISTRY } from "./capabilities.js";

export type {
  PhysicsCapabilities,
  PhysicsQueryCapabilities,
  PhysicsEventInterest,
  PhysicsSolverAdapter,
  PhysicsTuningCapabilities,
} from "./adapter.js";
export {
  NO_TUNING_CAPABILITIES,
  resolveTuningCapabilities,
} from "./adapter.js";
export type {
  SolverBodyAccess,
  SolverBodyTuningAccess,
  SolverJointAccess,
  SolverJointMotor,
} from "./body-access.js";
export {
  missingSolverBodyTuning,
  missingSolverJointAccess,
  supportsSolverBodyTuning,
  supportsSolverJointAccess,
} from "./body-access.js";
export type {
  ColliderEventMap,
  ColliderOptions,
  ColliderTriggerEvent,
  RigidBodyCollisionEvent,
} from "./collider.js";
export { Collider } from "./collider.js";
export type {
  AngularJointMotor,
  ColliderDescriptor,
  FixedJointDescriptor,
  JointDescriptor,
  JointDescriptorBase,
  JointLimits,
  JointType,
  LinearJointMotor,
  LocalPlane,
  PhysicsWorldOptions,
  PrismaticJointDescriptor,
  RevoluteJointDescriptor,
  RigidBodyDescriptor,
  RopeJointDescriptor,
  ShippedJointType,
  SphericalJointDescriptor,
  SphericalJointLimits,
  SpringJointDescriptor,
  StagedJointType,
} from "./descriptors.js";
export {
  DEFAULT_GRAVITY_Y,
  JOINT_TYPES,
  SHIPPED_JOINT_TYPES,
  SHIPPED_JOINT_TYPES_2D,
  SHIPPED_JOINT_TYPES_3D,
  STAGED_JOINT_TYPES,
  jointTypeSupportsDimension,
  resolveAngularVelocity,
  resolveGravity,
  resolveRotation,
  resolveSleepingConfig,
  widenToVector3,
} from "./descriptors.js";
export type {
  CollisionEvent,
  CollisionPhase,
  ContactPoint,
  JointBreakEvent,
  JointPhase,
  PhysicsEvent,
  PhysicsEventType,
  SleepEvent,
  SleepPhase,
  TriggerEvent,
  TriggerPhase,
} from "./events.js";
// §26/§27 force generation for rigid bodies (PH-8, 2026-08-09) — §39's step-5
// occupant. `ForceField` is §27's interface, structurally identical to
// `@fourjs/particles`' `ParticleForceField`, so a field written for either pillar
// works in both with no dependency edge between them.
export type {
  ForceField,
  ForceFieldAddOptions,
  ForceFieldEntry,
  ForceFieldSystemOptions,
  ForceFieldUnits,
} from "./force-field.js";
export { ForceFieldSystem } from "./force-field.js";
export type {
  HingeJointOptions,
  JointBinding,
  JointBreakPayload,
  JointCommands,
  JointEventMap,
  JointOptions,
  RopeJointOptions,
  SliderJointOptions,
  SphericalJointOptions,
  SpringJointOptions,
} from "./joints.js";
export {
  BallJoint,
  FixedJoint,
  HingeJoint,
  Joint,
  PrismaticJoint,
  RevoluteJoint,
  RopeJoint,
  SliderJoint,
  SphericalJoint,
  SpringJoint,
  worldAnchorToLocal,
  worldAxisToLocal,
} from "./joints.js";
export type { PhysicsMaterialOptions } from "./material.js";
export type { PhysicsEventSystemOptions } from "./physics-event-system.js";
export { PhysicsEventSystem } from "./physics-event-system.js";
export type { PhysicsSystemOptions } from "./physics-system.js";
export { PhysicsSystem } from "./physics-system.js";
export type { StalePhysicsHandleKind } from "./stale-handle.js";
export {
  rejectStalePhysicsHandle,
  resetStaleHandleWarnings,
} from "./stale-handle.js";
export {
  DEFAULT_DENSITY,
  DEFAULT_FRICTION,
  DEFAULT_FRICTION_COMBINE_MODE,
  DEFAULT_RESTITUTION,
  DEFAULT_RESTITUTION_COMBINE_MODE,
  PhysicsMaterial,
  combineFriction,
  combineRestitution,
  combineValues,
  resolveDensity,
} from "./material.js";
export type {
  OverlapHit,
  OverlapQuery,
  PointHit,
  PointQuery,
  QueryCandidate,
  QueryFilter,
  QueryHit,
  QueryHitMode,
  QueryOptions,
  RaycastHit,
  RaycastQuery,
  ResolvedQueryOptions,
  ShapeCastHit,
  ShapeCastQuery,
} from "./queries.js";
export {
  ALL_COLLISION_GROUPS,
  passesQueryFilter,
  resolveQueryOptions,
  sortHitsByDistance,
} from "./queries.js";
export type {
  ColliderDocument,
  PhysicsMaterialDocument,
  RigidBodyDocument,
} from "./serializers.js";
export {
  COLLIDER_SERIALIZER,
  RIGID_BODY_SERIALIZER,
  SWEPT_CHARACTER_CONTROLLER_SERIALIZER,
  deserializeCollisionShape,
  serializeCollisionShape,
} from "./serializers.js";
export type {
  BlendWeights,
  PointLoad,
  RigidBodyCommands,
  RigidBodyEventMap,
  RigidBodySleepEvent,
  SleepCommand,
  TorqueInput,
} from "./rigid-body.js";
export { RigidBody } from "./rigid-body.js";
export type {
  SolverName,
  SolverRegistration,
  SolverRejectionReason,
  SolverRejectionReport,
  SolverResolveOptions,
  SolverSelection,
} from "./solver-registry.js";
export {
  SolverRegistry,
  clearRegisteredSolvers,
  registerSolver,
  registeredSolvers,
  resolveSolver,
} from "./solver-registry.js";
export type {
  BoxShape,
  CapsuleShape,
  ChainShape,
  CircleShape,
  CollisionShape,
  CollisionShape2D,
  CollisionShape3D,
  CollisionShapeType,
  ConeShape,
  ConvexHullShape,
  CylinderShape,
  HeightFieldShape,
  PolygonShape,
  PolylineShape,
  RectangleShape,
  SphereShape,
  TriangleMeshShape,
} from "./shapes.js";
export {
  COLLISION_SHAPE_TYPES_2D,
  COLLISION_SHAPE_TYPES_3D,
  COMPOSITE_COLLISION_SHAPE_TYPES,
  shapeIsConvex,
  shapeMaximumExtent,
  shapeSupportsDimension,
  validateCollisionShape,
  validateQueryShape,
} from "./shapes.js";
export type {
  AngularVelocityInput,
  BodyType,
  CCDMode,
  CombineMode,
  DeterminismLevel,
  PhysicsBodyHandle,
  PhysicsColliderHandle,
  PhysicsDimension,
  PhysicsHandle,
  PhysicsJointHandle,
  RotationInput,
  SleepingConfig,
  Vector3Input,
} from "./types.js";
export {
  BODY_TYPES,
  CCD_MODES,
  COMBINE_MODES,
  DEFAULT_CCD_MODE,
  DEFAULT_DETERMINISM_LEVEL,
  DEFAULT_ENABLED_CCD_MODE,
  DEFAULT_SLEEPING_CONFIG,
  DETERMINISM_LEVELS,
  PHYSICS_DIMENSIONS,
} from "./types.js";
export {
  validateAngularJointMotor,
  validateColliderDescriptor,
  validateInertiaTensor,
  validateJointBreakThreshold,
  validateJointDescriptor,
  validateJointLimits,
  validateLinearJointMotor,
  validateMass,
  validatePhysicsWorldOptions,
  validateRigidBodyDescriptor,
  validateSphericalJointLimits,
} from "./validation.js";
export type {
  SweptCharacterControllerOptions,
  SweptCharacterSystemOptions,
} from "./swept-character-controller.js";
export {
  DEFAULT_GROUND_SNAP_DISTANCE,
  DEFAULT_MAX_SLIDES,
  DEFAULT_PUSH_IMPULSE_SCALE,
  DEFAULT_PUSH_MASS,
  DEFAULT_SKIN_WIDTH,
  DEFAULT_SLOPE_LIMIT,
  DEFAULT_STEP_HEIGHT,
  SweptCharacterController,
  SweptCharacterSystem,
} from "./swept-character-controller.js";
export type { ResolvedLocalPlane } from "./local-plane.js";
export {
  DEFAULT_LOCAL_PLANE,
  isDefaultLocalPlane,
  planeToWorld,
  planeToWorldVec,
  resolveLocalPlane,
  worldToPlane,
  worldToPlaneVec,
} from "./local-plane.js";
export type { PhysicsWorldUnits } from "./world-units.js";
export {
  fromSiLength,
  fromSiMass,
  resolvePhysicsWorldUnits,
  toSiLength,
  toSiMass,
} from "./world-units.js";
export type {
  ActiveBodyVisitor,
  BodyControlModeOptions,
  PhysicsSnapshot,
  PhysicsSnapshotConfiguration,
  PhysicsWorldAdapter,
  PhysicsWorldInit,
  PoseTargetCaptureSystemOptions,
  WorldOverlapHit,
  WorldPhysicsEvent,
  WorldPointHit,
  WorldQueryHit,
  WorldRaycastHit,
  WorldShapeCastHit,
} from "./world.js";
export {
  POSE_TARGET_CAPTURE_PRIORITY,
  PhysicsWorld,
  createPoseTargetCaptureSystem,
} from "./world.js";
export {
  liveSolverBodyCount,
  liveSolverColliderCount,
  liveSolverHandleCount,
  liveSolverJointCount,
} from "./resource-memory.js";
