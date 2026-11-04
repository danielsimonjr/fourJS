/**
 * The PhysJS solver adapters (RFC 0010, §37, §102).
 *
 * W9.1 landed the package shape behind the §37 seam; W9.2 filled in bodies,
 * shapes, stepping, events and scene sync; W9.3 (this file) adds joints,
 * queries, snapshots and the checksum. Anything PhysJS cannot express is
 * `FourError("NOT_IMPLEMENTED")` - nothing is approximated silently.
 *
 * ## Joints, queries, snapshots (W9.3)
 *
 * - **Joints.** `fixed` -> PhysJS `fixed`; `revolute` -> the 2-D pin
 *   (`spherical`) or the 3-D `hinge`; `spherical` (3-D) -> `spherical`;
 *   `spring` -> `spring`. fourJS anchors/axes are body-local; PhysJS takes
 *   world frame, so they are transformed with the bodies' current poses.
 *   `prismatic` and `rope`, limits and motors are refused (NOT_IMPLEMENTED).
 *   PhysJS exposes no joint reaction, so `reportsJointReactions` is `false`
 *   and a breakable joint is refused by the world.
 * - **Queries** run over PhysJS's `raycast`/`overlap`/`pointQuery` and the
 *   shared \u00a730 filter (`passesQueryFilter`; every collider is all-ones, so
 *   group/mask filters on the *query* still apply). PhysJS `raycast` returns
 *   only the nearest hit; `mode: "all"` (or a filter that rejects the nearest)
 *   re-casts on a scratch copy restored from a snapshot with each hit removed,
 *   so the live world is never touched. `shapeCast` is refused.
 * - **Snapshots** are an envelope: magic, format, JSON meta (adapter name,
 *   PhysJS version, the id registries, running force sums, pending kinematic
 *   targets, touching pairs, sleep flags) and PhysJS's exact float64 bytes.
 *   `restoreSnapshot` refuses a foreign adapter or version, keeps surviving
 *   handles valid, and clears the undrained event queue. `checksum()` is
 *   FNV-1a over PhysJS's own checksum plus the registry in ascending id order.
 *
 * ## What PhysJS 0.5.0 cannot express, and what this adapter does about it
 *
 * - **Persistent forces.** PhysJS zeroes its force/torque accumulators after
 *   every `step`; fourJS `applyForce`/`applyTorque` persist until
 *   `resetForces`. The adapter keeps the persistent sum per body and feeds it
 *   to PhysJS as a one-step load before each `step` (skipped while the body
 *   sleeps, so a standing force does not keep waking it).
 * - **Impulses** are applied as instantaneous velocity changes
 *   (`dv = J / m`, `dw = I^-1 (r x J)`), computed from the body's mass columns.
 * - **Mass.** PhysJS derives mass from collider density and overrides any
 *   authored mass. fourJS says an authored `mass` is authoritative, so the
 *   adapter recomputes the body's mass columns itself after every collider
 *   change (collider records carry their own mass/inertia), scaling the
 *   inertia to the authored mass. A non-zero `centerOfMass`, a non-diagonal
 *   `inertiaTensor`, and colliders with an offset are refused: PhysJS keeps
 *   the centre of mass on the body origin with principal inertia.
 * - **Kinematic-position bodies.** PhysJS has no "next kinematic transform".
 *   For one step the adapter switches the body to kinematic-velocity with the
 *   velocity that lands exactly on the target, so dynamic bodies it touches
 *   see a moving surface, then switches it back and snaps it to the target.
 * - **Sleep.** `sleepBody` writes the asleep column; with
 *   `sleeping.enabled: false` the sleep timers are zeroed before every step.
 *   Sleep/wake events are derived from state changes across a step.
 * - **Events.** PhysJS pair events carry no contact points, so
 *   `collisionstart/stay/end` have `contacts: []` and a zero `totalImpulse`;
 *   `relativeVelocity` is the difference of the bodies' linear velocities.
 *   `collisionstay` is derived while a pair stays touching. `countContacts`
 *   counts touching pairs, not manifold points.
 * - **Material.** PhysJS combines friction as a geometric mean (Appendix A
 *   says average) and restitution as a max (matches).
 * - **Refused (NOT_IMPLEMENTED):** sensors, collision groups/masks other than
 *   all-ones, swept CCD, collider offsets, polygons not centred on their
 *   centroid, a per-world `solverIterations` other than PhysJS's own, and every
 *   shape in the gaps list below.
 *
 * ## Capability record (RFC 0010, decision 4)
 *
 * Declared honestly from PhysJS 0.5.0's surface:
 *
 * - shapes it lacks (cylinder, cone, convex hull, triangle mesh, height field,
 *   polyline, chain) are refused at collider creation; sensors and per-collider
 *   offsets are refused likewise (no `capabilities` field covers them);
 * - joints: `fixed` and `spring` in both dimensions, `revolute` (the 2-D pin /
 *   the 3-D hinge) and `spherical` (3-D only); no `prismatic`, no `rope`, no
 *   limits or motors;
 * - CCD: `disabled` and `speculative` only;
 * - queries: raycast, overlap and point; no `shapeCast`;
 * - tuning: nothing (PhysJS has no rolling/spinning friction, per-world sleep
 *   thresholds, or motor effort caps).
 *
 * One record serves both classes: PhysJS is one engine (`createWorld({ dims })`)
 * and RFC 0010 declares `dimensions: ["2d", "3d"]`. The registry builds the
 * class matching the world's `dimension`.
 */

import * as pj from "@danielsimonjr/physjs";
import { FourError } from "@fourjs/core";
import type { FourErrorCode } from "@fourjs/core";
import { Quaternion, Vector3 } from "@fourjs/math";
import type { Matrix3 } from "@fourjs/math";
import {
  ALL_COLLISION_GROUPS,
  DEFAULT_DENSITY,
  DEFAULT_FRICTION,
  DEFAULT_RESTITUTION,
  DETERMINISM_LEVELS,
  rejectStalePhysicsHandle,
  resolveAngularVelocity,
  resolveGravity,
  resolveRotation,
  resolveSleepingConfig,
  passesQueryFilter,
  resolveQueryOptions,
  validateColliderDescriptor,
  validateJointDescriptor,
  validateQueryShape,
  validatePhysicsWorldOptions,
  validateRigidBodyDescriptor,
  widenToVector3,
} from "@fourjs/physics";
import type {
  AngularVelocityInput,
  BodyType,
  CCDMode,
  ColliderDescriptor,
  CollisionShape,
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
  PhysicsWorldAdapter,
  PhysicsWorldOptions,
  PointHit,
  PointQuery,
  RaycastHit,
  RaycastQuery,
  RigidBodyDescriptor,
  RotationInput,
  ShapeCastHit,
  ShapeCastQuery,
  ShippedJointType,
  SleepingConfig,
  SolverBodyAccess,
  SolverBodyTuningAccess,
  SolverJointAccess,
  SolverJointMotor,
  QueryCandidate,
  Vector3Input,
} from "@fourjs/physics";

/** The pinned `@danielsimonjr/physjs` release this adapter targets. */
export const PHYSJS_VERSION = "0.5.0";

/** RFC 0010 decision 4, frozen. */
export const PHYSJS_CAPABILITIES: PhysicsCapabilities = Object.freeze({
  dimensions: Object.freeze<PhysicsDimension[]>(["2d", "3d"]),
  jointTypes: Object.freeze<string[]>([
    "fixed",
    "spring",
    "revolute",
    "spherical",
  ] satisfies ShippedJointType[]),
  ccdModes: Object.freeze<CCDMode[]>(["disabled", "speculative"]),
  determinism: "same-runtime",
  snapshots: true,
  queries: Object.freeze({
    raycast: true,
    shapeCast: false,
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

const ADAPTER_ERROR_CODE = "INVALID_APPLICATION_STATE";

/** Scalars below this are treated as zero when checking "is this offset/centre non-zero". */
const ZERO_EPSILON = 1e-9;

/** Refuses something PhysJS 0.5.0 cannot express (RFC 0010 decision 5). */
function unsupported(adapter: string, what: string): never {
  throw new FourError(
    "NOT_IMPLEMENTED",
    `${adapter} (PhysJS ${PHYSJS_VERSION}) does not support ${what} (RFC 0010 decision 5, capability record).`,
    { context: { adapter, unsupported: what } },
  );
}

/** PhysJS body type name for each fourJS `BodyType` (the names are identical). */
const BODY_TYPE_INDEX: Readonly<Record<BodyType, number>> = Object.freeze(
  Object.fromEntries(pj.BODY_TYPES.map((t, i) => [t.name, i])) as Record<
    BodyType,
    number
  >,
);

interface BodyRecord {
  readonly id: number;
  readonly handle: pj.BodyHandle;
  /** Index of the body's slot in PhysJS's struct-of-arrays store. */
  readonly slot: number;
  type: BodyType;
  alive: boolean;
  readonly colliderIds: number[];
  /** Authored mass (kg), authoritative over collider-derived mass. */
  authoredMass: number | undefined;
  /** Authored principal moments `[Ix, Iy, Iz]` (2-D: only `[2]` is read). */
  authoredInertia: [number, number, number] | undefined;
  /** Persistent world force/torque, re-fed to PhysJS before every step. */
  readonly force: [number, number, number];
  readonly torque: [number, number, number];
  sleeping: boolean;
  ccdMode: CCDMode;
  /** Pending kinematic-position target for the next step. */
  target: { position: Vector3; rotation: Quaternion } | undefined;
}

interface ColliderRecord {
  readonly id: number;
  readonly handle: pj.ColliderHandle;
  readonly bodyId: number;
  alive: boolean;
  /** Density the engine asked for (0 = massless). */
  density: number;
  /** Density PhysJS was given (it needs > 0). */
  readonly physDensity: number;
}

interface JointEntry {
  readonly id: number;
  readonly handle: pj.JointHandle;
  readonly type: JointDescriptor["type"];
  readonly bodyIdA: number;
  readonly bodyIdB: number;
  alive: boolean;
}

/** Snapshot envelope: "F4PJ" little-endian, then format, meta length, PhysJS length. */
const SNAPSHOT_MAGIC = 0x4a503446;
const SNAPSHOT_FORMAT_VERSION = 1;
const SNAPSHOT_HEADER_BYTES = 16;

interface SnapshotMeta {
  adapter: string;
  version: string;
  nextBodyId: number;
  nextColliderId: number;
  nextJointId: number;
  /** [id, handle, type, bodyIdA, bodyIdB] in ascending id order. */
  joints: [number, number, string, number, number][];
  bodies: SnapshotBody[];
  /** [id, handle, bodyId, density, physDensity] in ascending id order. */
  colliders: [number, number, number, number, number][];
  /** Touching pairs as collider ids. */
  pairs: [number, number][];
}

interface SnapshotBody {
  id: number;
  handle: number;
  type: BodyType;
  mass: number | null;
  /** `null` entries are Infinity (JSON has no Infinity). */
  inertia: (number | null)[] | null;
  force: number[];
  torque: number[];
  sleeping: boolean;
  ccd: CCDMode;
  target: number[] | null;
}

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

function fnv1a(bytes: Uint8Array): string {
  let hash = FNV_OFFSET;
  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function nullToInfinity(value: number | null): number {
  return value ?? Infinity;
}

interface PairRecord {
  readonly a: ColliderRecord;
  readonly b: ColliderRecord;
}

/**
 * Shared implementation behind {@link PhysJSAdapter2D} and
 * {@link PhysJSAdapter3D}: one engine, one code path, with the dimension
 * deciding the vector widths (2-D is XY with z = 0 and rotation about +Z).
 */
abstract class PhysJSAdapterBase
  implements
    PhysicsWorldAdapter,
    SolverBodyAccess,
    SolverBodyTuningAccess,
    SolverJointAccess
{
  abstract readonly name: string;
  readonly version: string = PHYSJS_VERSION;
  readonly capabilities: PhysicsCapabilities = PHYSJS_CAPABILITIES;
  /** PhysJS exposes no joint reaction impulse; breakable joints are refused by the world. */
  readonly reportsJointReactions = false;

  readonly #dims: 2 | 3;
  readonly #dimension: PhysicsDimension;
  #world: pj.World | undefined;
  #initializeStarted = false;
  #disposed = false;
  #sleeping: SleepingConfig = resolveSleepingConfig();
  #stayEvents = true;

  #nextBodyId = 1;
  #nextColliderId = 1;
  readonly #bodies = new Map<number, BodyRecord>();
  readonly #colliders = new Map<number, ColliderRecord>();
  readonly #collidersByHandle = new Map<pj.ColliderHandle, ColliderRecord>();
  readonly #activePairs = new Map<number, PairRecord>();
  #nextJointId = 1;
  #joints = new Map<number, JointEntry>();
  #pendingEvents: PhysicsEvent[] = [];

  constructor(dimension: PhysicsDimension) {
    this.#dimension = dimension;
    this.#dims = dimension === "2d" ? 2 : 3;
  }

  // --- lifecycle -------------------------------------------------------------

  initialize(options: PhysicsWorldOptions): void {
    this.#assertNotDisposed();
    if (this.#initializeStarted) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `${this.name}.initialize was called twice; one adapter owns one world (§37).`,
      );
    }
    this.#initializeStarted = true;
    validatePhysicsWorldOptions(options);
    if (options.dimension !== this.#dimension) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `${this.name} simulates ${JSON.stringify(this.#dimension)} worlds only; got ${JSON.stringify(options.dimension)} (§21, §37).`,
        { context: { dimension: options.dimension } },
      );
    }
    if (
      options.determinism !== undefined &&
      DETERMINISM_LEVELS.indexOf(options.determinism) >
        DETERMINISM_LEVELS.indexOf(PHYSJS_CAPABILITIES.determinism)
    ) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `${this.name} declares determinism ${JSON.stringify(PHYSJS_CAPABILITIES.determinism)} and the world asked for ${JSON.stringify(options.determinism)} (§33, §37).`,
        { context: { requested: options.determinism } },
      );
    }
    if (
      options.solverIterations !== undefined &&
      options.solverIterations !== pj.SOLVER_DEFAULTS.iterations
    ) {
      unsupported(
        this.name,
        `a per-world solverIterations (PhysJS fixes it at ${String(pj.SOLVER_DEFAULTS.iterations)})`,
      );
    }
    const gravity = resolveGravity(this.#dimension, options.gravity);
    this.#sleeping = resolveSleepingConfig(options.sleeping);
    this.#world = pj.createWorld({
      dims: this.#dims,
      gravity:
        this.#dims === 2
          ? [gravity.x, gravity.y]
          : [gravity.x, gravity.y, gravity.z],
    });
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#world = undefined;
    for (const record of this.#bodies.values()) {
      record.alive = false;
    }
    for (const record of this.#colliders.values()) {
      record.alive = false;
    }
    for (const entry of this.#joints.values()) {
      entry.alive = false;
    }
    this.#joints.clear();
    this.#bodies.clear();
    this.#colliders.clear();
    this.#collidersByHandle.clear();
    this.#activePairs.clear();
    this.#pendingEvents = [];
  }

  // --- bodies and colliders --------------------------------------------------

  createBody(desc: RigidBodyDescriptor): PhysicsBodyHandle {
    const world = this.#requireWorld();
    validateRigidBodyDescriptor(desc, this.#dimension);
    if (desc.centerOfMass !== undefined) {
      this.#requireZeroCentre(desc.centerOfMass);
    }
    const ccdMode = resolveCcd(desc, this.name);
    const inertia =
      desc.inertiaTensor === undefined
        ? undefined
        : this.#diagonalInertia(desc.inertiaTensor);

    const descriptor: pj.BodyDescriptor = { type: desc.type };
    if (desc.position !== undefined) {
      descriptor.position = this.#toVector("position", desc.position);
    }
    if (desc.rotation !== undefined) {
      descriptor.rotation = this.#toRotation(desc.rotation);
    }
    if (desc.linearVelocity !== undefined && integrates(desc.type)) {
      descriptor.linearVelocity = this.#toVector(
        "linearVelocity",
        desc.linearVelocity,
      );
    }
    if (desc.angularVelocity !== undefined && integrates(desc.type)) {
      descriptor.angularVelocity = this.#toAngular(desc.angularVelocity);
    }
    if (desc.linearDamping !== undefined) {
      descriptor.linearDamping = desc.linearDamping;
    }
    if (desc.angularDamping !== undefined) {
      descriptor.angularDamping = desc.angularDamping;
    }
    if (desc.gravityScale !== undefined) {
      descriptor.gravityScale = desc.gravityScale;
    }
    const handle = pj.addBody(world, descriptor);

    const record: BodyRecord = {
      id: this.#nextBodyId,
      handle,
      slot: handle % pj.MAX_BODIES,
      type: desc.type,
      alive: true,
      colliderIds: [],
      authoredMass: desc.mass,
      authoredInertia: inertia,
      force: [0, 0, 0],
      torque: [0, 0, 0],
      sleeping: false,
      ccdMode,
      target: undefined,
    };
    this.#nextBodyId += 1;
    this.#bodies.set(record.id, record);
    this.#recomputeMass(record);
    return record as unknown as PhysicsBodyHandle;
  }

  destroyBody(handle: PhysicsBodyHandle): void {
    const world = this.#requireWorld();
    const record = this.#requireBody(handle);
    for (const id of [...record.colliderIds]) {
      const collider = this.#colliders.get(id);
      if (collider !== undefined) {
        this.#forgetCollider(collider);
      }
    }
    for (const entry of [...this.#joints.values()]) {
      if (entry.bodyIdA === record.id || entry.bodyIdB === record.id) {
        entry.alive = false;
        this.#joints.delete(entry.id);
      }
    }
    pj.removeBody(world, record.handle);
    record.alive = false;
    this.#bodies.delete(record.id);
  }

  createCollider(desc: ColliderDescriptor): PhysicsColliderHandle {
    const world = this.#requireWorld();
    validateColliderDescriptor(desc, this.#dimension);
    const body = this.#requireBody(desc.body);
    if (desc.sensor === true) {
      unsupported(this.name, "sensor colliders (no trigger volumes)");
    }
    if (desc.offset !== undefined) {
      const p = desc.offset.position;
      const r = desc.offset.rotation;
      const rotated =
        typeof r === "number"
          ? Math.abs(r) > ZERO_EPSILON
          : Math.abs(r.x) + Math.abs(r.y) + Math.abs(r.z) > ZERO_EPSILON ||
            Math.abs(r.w - 1) > ZERO_EPSILON;
      const z = "z" in p ? p.z : 0;
      if (
        Math.abs(p.x) + Math.abs(p.y) + Math.abs(z) > ZERO_EPSILON ||
        rotated
      ) {
        unsupported(
          this.name,
          "a non-zero collider offset (colliders are centred on the body origin)",
        );
      }
    }
    if (
      (desc.collisionGroups ?? ALL_COLLISION_GROUPS) !== ALL_COLLISION_GROUPS ||
      (desc.collisionMask ?? ALL_COLLISION_GROUPS) !== ALL_COLLISION_GROUPS
    ) {
      unsupported(
        this.name,
        "collision groups or masks (every collider collides with every other)",
      );
    }
    const shape = this.#toShape(desc.shape);
    const density = desc.density ?? desc.material?.density ?? DEFAULT_DENSITY;
    // PhysJS needs density > 0; a zero-density (massless) collider is added
    // at 1 and excluded from the mass sum in #recomputeMass.
    const physDensity = density > 0 ? density : 1;
    const handle = pj.addCollider(world, body.handle, {
      shape,
      density: physDensity,
      friction: desc.friction ?? desc.material?.friction ?? DEFAULT_FRICTION,
      restitution:
        desc.restitution ?? desc.material?.restitution ?? DEFAULT_RESTITUTION,
    });
    const record: ColliderRecord = {
      id: this.#nextColliderId,
      handle,
      bodyId: body.id,
      alive: true,
      density,
      physDensity,
    };
    this.#nextColliderId += 1;
    this.#colliders.set(record.id, record);
    this.#collidersByHandle.set(handle, record);
    body.colliderIds.push(record.id);
    this.#recomputeMass(body);
    return record as unknown as PhysicsColliderHandle;
  }

  destroyCollider(handle: PhysicsColliderHandle): void {
    this.#requireWorld();
    const record = this.#requireCollider(handle);
    const body = this.#bodies.get(record.bodyId);
    this.#forgetCollider(record);
    if (body !== undefined) {
      this.#recomputeMass(body);
    }
  }

  // --- joints (SolverJointAccess) --------------------------------------------

  createJoint(desc: JointDescriptor): PhysicsJointHandle {
    const world = this.#requireWorld();
    validateJointDescriptor(desc, this.#dimension);
    if (desc.type === "prismatic" || desc.type === "rope") {
      unsupported(this.name, `${desc.type} joints (no such PhysJS joint type)`);
    }
    if (
      (desc.type === "revolute" || desc.type === "spherical") &&
      desc.limits !== undefined
    ) {
      unsupported(this.name, "joint limits");
    }
    if (desc.type === "revolute" && desc.motor !== undefined) {
      unsupported(this.name, "joint motors");
    }
    const bodyA = this.#requireBody(desc.bodyA);
    const bodyB = this.#requireBody(desc.bodyB);
    const base = {
      bodyA: bodyA.handle,
      bodyB: bodyB.handle,
      anchorA: this.#anchorToWorld(bodyA, desc.anchorA),
      anchorB: this.#anchorToWorld(bodyB, desc.anchorB),
      collideConnected: desc.collisionEnabled ?? false,
    };
    let descriptor: pj.JointDescriptor;
    if (desc.type === "fixed") {
      descriptor = { ...base, type: "fixed" };
    } else if (desc.type === "spherical") {
      descriptor = { ...base, type: "spherical" };
    } else if (desc.type === "revolute") {
      descriptor =
        this.#dims === 2
          ? { ...base, type: "spherical" }
          : {
              ...base,
              type: "hinge",
              axis: this.#axisToWorld(bodyA, desc.axis),
            };
    } else {
      descriptor = {
        ...base,
        type: "spring",
        stiffness: desc.stiffness,
        damping: desc.damping ?? 0,
        restLength: desc.restLength,
      };
    }
    const handle = pj.addJoint(world, descriptor);
    const entry: JointEntry = {
      id: this.#nextJointId,
      handle,
      type: desc.type,
      bodyIdA: bodyA.id,
      bodyIdB: bodyB.id,
      alive: true,
    };
    this.#nextJointId += 1;
    this.#joints.set(entry.id, entry);
    return entry as unknown as PhysicsJointHandle;
  }

  destroyJoint(handle: PhysicsJointHandle): void {
    const world = this.#requireWorld();
    const entry = this.#requireJoint(handle);
    pj.removeJoint(world, entry.handle);
    entry.alive = false;
    this.#joints.delete(entry.id);
  }

  getJointReaction(
    _handle: PhysicsJointHandle,
    _outLinear: Vector3,
    _outAngular: Vector3,
  ): void {
    unsupported(this.name, "joint reactions (reportsJointReactions is false)");
  }

  setJointLimits(
    _handle: PhysicsJointHandle,
    _min: number,
    _max: number,
  ): void {
    unsupported(this.name, "joint limits");
  }

  setJointMotor(_handle: PhysicsJointHandle, _motor: SolverJointMotor): void {
    unsupported(this.name, "joint motors");
  }

  setJointCollisionEnabled(handle: PhysicsJointHandle, enabled: boolean): void {
    const stored = this.#storedJoint(handle);
    // JointRecord is plain data and jointExcludes reads the flag each step.
    (stored as { collideConnected: boolean }).collideConnected = enabled;
  }

  setJointAnchors(
    handle: PhysicsJointHandle,
    anchorA: Vector3,
    anchorB: Vector3,
  ): void {
    const stored = this.#storedJoint(handle) as unknown as {
      localAnchorA: [number, number, number];
      localAnchorB: [number, number, number];
    };
    this.#vector3("anchorA", anchorA);
    this.#vector3("anchorB", anchorB);
    stored.localAnchorA = [anchorA.x, anchorA.y, anchorA.z];
    stored.localAnchorB = [anchorB.x, anchorB.y, anchorB.z];
  }

  getJointId(handle: PhysicsJointHandle): number {
    return this.#requireJoint(handle).id;
  }

  forEachJoint(visit: (handle: PhysicsJointHandle, id: number) => void): void {
    this.#requireWorld();
    for (const entry of this.#joints.values()) {
      visit(entry as unknown as PhysicsJointHandle, entry.id);
    }
  }

  // --- queries ---------------------------------------------------------------

  /**
   * Casts a ray (§30). PhysJS returns only the nearest hit, so more than one
   * hit (or a filter rejecting the nearest) is gathered on a scratch world
   * restored from a snapshot: the live world is never written.
   */
  raycast(query: RaycastQuery): RaycastHit[] {
    const world = this.#requireWorld();
    const options = resolveQueryOptions(query);
    const origin = this.#toVector("origin", query.origin);
    const direction = this.#toVector("direction", query.direction);
    if (direction.every((c) => c === 0)) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        "raycast direction must have non-zero length (§30, §85).",
        { context: { adapter: this.name } },
      );
    }
    const maxDistance = query.maxDistance ?? Infinity;
    let hit = pj.raycast(world, origin, direction, maxDistance);
    if (hit === undefined) {
      return [];
    }
    if (options.maxHits === 1 && this.#passes(hit.collider, options)) {
      return [this.#rayHit(hit)];
    }
    const scratch = pj.createWorld({ dims: this.#dims });
    pj.restore(scratch, pj.snapshot(world));
    const hits: RaycastHit[] = [];
    while (hit !== undefined && hits.length < options.maxHits) {
      if (this.#passes(hit.collider, options)) {
        hits.push(this.#rayHit(hit));
      }
      pj.removeCollider(scratch, hit.collider);
      hit = pj.raycast(scratch, origin, direction, maxDistance);
    }
    return hits;
  }

  shapeCast(_query: ShapeCastQuery): ShapeCastHit[] {
    return unsupported(this.name, "shapeCast (capabilities.queries.shapeCast)");
  }

  overlap(query: OverlapQuery): OverlapHit[] {
    const world = this.#requireWorld();
    const options = resolveQueryOptions(query);
    validateQueryShape(query.shape, this.#dimension);
    const handles = pj.overlap(
      world,
      this.#toShape(query.shape),
      this.#toVector("position", query.position),
      query.rotation === undefined
        ? undefined
        : this.#toRotation(query.rotation),
    );
    const hits: OverlapHit[] = [];
    for (const handle of handles) {
      if (hits.length >= options.maxHits) {
        break;
      }
      if (this.#passes(handle, options)) {
        hits.push(this.#queryHit(handle));
      }
    }
    return hits;
  }

  pointQuery(query: PointQuery): PointHit[] {
    const world = this.#requireWorld();
    const options = resolveQueryOptions(query);
    const point = this.#vector3("point", query.point);
    const hits: PointHit[] = [];
    for (const handle of pj.pointQuery(world, this.#toVector("point", point))) {
      if (hits.length >= options.maxHits) {
        break;
      }
      if (this.#passes(handle, options)) {
        // A containing collider: the closest surface point is the query point.
        hits.push({
          ...this.#queryHit(handle),
          point: point.clone(),
          distance: 0,
        });
      }
    }
    return hits;
  }

  // --- snapshots (§34) ---------------------------------------------------------

  /**
   * Envelope: u32 magic "F4PJ", u32 format, u32 meta bytes, u32 PhysJS bytes,
   * UTF-8 JSON meta, then PhysJS's own float64-exact snapshot, verbatim.
   */
  createSnapshot(): ArrayBuffer {
    const world = this.#requireWorld();
    const physBytes = new Uint8Array(pj.snapshot(world));
    const metaBytes = new TextEncoder().encode(
      JSON.stringify(this.#snapshotMeta()),
    );
    const buffer = new ArrayBuffer(
      SNAPSHOT_HEADER_BYTES + metaBytes.byteLength + physBytes.byteLength,
    );
    const header = new DataView(buffer);
    header.setUint32(0, SNAPSHOT_MAGIC, true);
    header.setUint32(4, SNAPSHOT_FORMAT_VERSION, true);
    header.setUint32(8, metaBytes.byteLength, true);
    header.setUint32(12, physBytes.byteLength, true);
    const bytes = new Uint8Array(buffer);
    bytes.set(metaBytes, SNAPSHOT_HEADER_BYTES);
    bytes.set(physBytes, SNAPSHOT_HEADER_BYTES + metaBytes.byteLength);
    return buffer;
  }

  restoreSnapshot(snapshot: ArrayBuffer): void {
    const world = this.#requireWorld();
    const reject = (
      message: string,
      code: FourErrorCode = "UNTRUSTED_INPUT_REJECTED",
    ): never => {
      throw new FourError(code, `${message} (§34, §96).`, {
        context: { adapter: this.name },
      });
    };
    if (snapshot.byteLength < SNAPSHOT_HEADER_BYTES) {
      reject(`Snapshot is too small to be a ${this.name} envelope`);
    }
    const header = new DataView(snapshot);
    if (header.getUint32(0, true) !== SNAPSHOT_MAGIC) {
      reject(
        `Snapshot was not produced by a PhysJS adapter; a snapshot is valid only for the adapter that wrote it`,
        ADAPTER_ERROR_CODE,
      );
    }
    if (header.getUint32(4, true) !== SNAPSHOT_FORMAT_VERSION) {
      reject(
        `Snapshot envelope version ${String(header.getUint32(4, true))} is not ${String(SNAPSHOT_FORMAT_VERSION)}`,
        "SERIALIZATION_VERSION_MISMATCH",
      );
    }
    const metaLength = header.getUint32(8, true);
    const physLength = header.getUint32(12, true);
    if (SNAPSHOT_HEADER_BYTES + metaLength + physLength > snapshot.byteLength) {
      reject("Snapshot envelope declares more bytes than it carries");
    }
    const bytes = new Uint8Array(snapshot);
    let meta: SnapshotMeta | undefined;
    try {
      meta = JSON.parse(
        new TextDecoder().decode(
          bytes.subarray(
            SNAPSHOT_HEADER_BYTES,
            SNAPSHOT_HEADER_BYTES + metaLength,
          ),
        ),
      ) as SnapshotMeta;
    } catch {
      meta = undefined;
    }
    if (meta === undefined || !Array.isArray(meta.bodies)) {
      return reject("Snapshot metadata does not parse");
    }
    if (meta.adapter !== this.name || meta.version !== this.version) {
      reject(
        `Snapshot was written by ${JSON.stringify(meta.adapter)} ${JSON.stringify(meta.version)} and this adapter is ${JSON.stringify(this.name)} ${JSON.stringify(this.version)}`,
        ADAPTER_ERROR_CODE,
      );
    }
    try {
      pj.restore(
        world,
        bytes.slice(
          SNAPSHOT_HEADER_BYTES + metaLength,
          SNAPSHOT_HEADER_BYTES + metaLength + physLength,
        ),
      );
    } catch {
      reject("PhysJS refused the snapshot bytes");
    }
    this.#rebuildRegistry(meta);
  }

  /**
   * 32-bit FNV-1a (8 hex digits) over PhysJS's own FNV-1a checksum and the
   * adapter's registry (ids, handles, force sums) in ascending id order. Equal
   * worlds with equal id histories give equal checksums; reads never change it.
   */
  checksum(): string {
    const world = this.#requireWorld();
    const text = `${pj.checksum(world)}|${JSON.stringify(this.#snapshotMeta())}`;
    return fnv1a(new TextEncoder().encode(text));
  }

  // --- step and events -------------------------------------------------------

  step(delta: number): void {
    const world = this.#requireWorld();
    if (!Number.isFinite(delta) || delta <= 0) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `step(delta) takes a finite positive number of seconds (§7a, §10); got ${String(delta)}.`,
        { context: { adapter: this.name, delta } },
      );
    }
    const fields = world.bodies.fields;
    const driven: BodyRecord[] = [];
    for (const record of this.#bodies.values()) {
      if (!this.#sleeping.enabled) {
        fields.sleepTimer[record.slot] = 0;
      }
      if (record.type === "dynamic") {
        this.#feedPersistentLoads(world, record);
      } else if (
        record.type === "kinematic-position" &&
        record.target !== undefined
      ) {
        this.#driveKinematic(world, record, record.target, delta);
        driven.push(record);
      }
    }

    pj.step(world, delta);

    for (const record of driven) {
      this.#finishKinematic(world, record);
    }
    this.#collectEvents();
  }

  setEventInterest(interest: PhysicsEventInterest): void {
    this.#stayEvents = interest.collisionstay;
  }

  drainEvents(): PhysicsEvent[] {
    const drained = this.#pendingEvents;
    this.#pendingEvents = [];
    return drained;
  }

  /** Documented no-op: every write reaches PhysJS immediately (see {@link SolverBodyAccess}). */
  syncSceneToSolver(): void {
    this.#requireWorld();
  }

  /** Documented no-op: poses are read per body through {@link getBodyTransform}. */
  syncSolverToScene(): void {
    this.#requireWorld();
  }

  // --- SolverBodyAccess ------------------------------------------------------

  getBodyTransform(
    handle: PhysicsBodyHandle,
    outPosition: Vector3,
    outRotation: Quaternion,
  ): void {
    const record = this.#requireBody(handle);
    const world = this.#requireWorld();
    const p = pj.getPosition(world, record.handle);
    outPosition.set(p[0], p[1], this.#dims === 3 ? p[2] : 0);
    const r = pj.getRotation(world, record.handle);
    if (this.#dims === 2) {
      const half = r[0] / 2;
      outRotation.set(0, 0, Math.sin(half), Math.cos(half));
    } else {
      outRotation.set(r[1], r[2], r[3], r[0]);
    }
  }

  setBodyTransform(
    handle: PhysicsBodyHandle,
    position: Vector3Input,
    rotation: RotationInput,
    wake = true,
  ): void {
    const record = this.#requireBody(handle);
    const world = this.#requireWorld();
    const wasSleeping = pj.isSleeping(world, record.handle);
    pj.setPosition(world, record.handle, this.#toVector("position", position));
    pj.setRotation(world, record.handle, this.#toRotation(rotation));
    this.#restoreSleep(record, wasSleeping, wake);
  }

  getBodyVelocities(
    handle: PhysicsBodyHandle,
    outLinear: Vector3,
    outAngular: Vector3,
  ): void {
    const record = this.#requireBody(handle);
    const world = this.#requireWorld();
    const v = pj.getLinearVelocity(world, record.handle);
    outLinear.set(v[0], v[1], this.#dims === 3 ? v[2] : 0);
    const w = pj.getAngularVelocity(world, record.handle);
    if (this.#dims === 2) {
      outAngular.set(0, 0, w[0]);
    } else {
      outAngular.set(w[0], w[1], w[2]);
    }
  }

  setBodyVelocities(
    handle: PhysicsBodyHandle,
    linear: Vector3Input,
    angular: AngularVelocityInput,
    wake = true,
  ): void {
    const record = this.#requireBody(handle);
    const world = this.#requireWorld();
    const lin = this.#toVector("linearVelocity", linear);
    const ang = this.#toAngular(angular);
    if (!integrates(record.type)) {
      return;
    }
    const wasSleeping = pj.isSleeping(world, record.handle);
    pj.setLinearVelocity(world, record.handle, lin);
    pj.setAngularVelocity(world, record.handle, ang);
    this.#restoreSleep(record, wasSleeping, wake);
  }

  applyForce(handle: PhysicsBodyHandle, force: Vector3Input): void {
    const record = this.#requireBody(handle);
    const f = this.#vector3("force", force);
    record.force[0] += f.x;
    record.force[1] += f.y;
    record.force[2] += f.z;
    this.#wakeDynamic(record);
  }

  applyForceAtPoint(
    handle: PhysicsBodyHandle,
    force: Vector3Input,
    worldPoint: Vector3Input,
  ): void {
    const record = this.#requireBody(handle);
    const f = this.#vector3("force", force);
    const r = this.#leverArm(record, worldPoint);
    record.force[0] += f.x;
    record.force[1] += f.y;
    record.force[2] += f.z;
    record.torque[0] += r.y * f.z - r.z * f.y;
    record.torque[1] += r.z * f.x - r.x * f.z;
    record.torque[2] += r.x * f.y - r.y * f.x;
    this.#wakeDynamic(record);
  }

  applyTorque(handle: PhysicsBodyHandle, torque: AngularVelocityInput): void {
    const record = this.#requireBody(handle);
    const t = resolveAngularVelocity(this.#dimension, torque);
    record.torque[0] += t.x;
    record.torque[1] += t.y;
    record.torque[2] += t.z;
    this.#wakeDynamic(record);
  }

  applyImpulse(handle: PhysicsBodyHandle, impulse: Vector3Input): void {
    const record = this.#requireBody(handle);
    this.#addVelocity(record, this.#vector3("impulse", impulse), undefined);
  }

  applyImpulseAtPoint(
    handle: PhysicsBodyHandle,
    impulse: Vector3Input,
    worldPoint: Vector3Input,
  ): void {
    const record = this.#requireBody(handle);
    const j = this.#vector3("impulse", impulse);
    const r = this.#leverArm(record, worldPoint);
    const angular = new Vector3(
      r.y * j.z - r.z * j.y,
      r.z * j.x - r.x * j.z,
      r.x * j.y - r.y * j.x,
    );
    this.#addVelocity(record, j, angular);
  }

  applyAngularImpulse(
    handle: PhysicsBodyHandle,
    angularImpulse: AngularVelocityInput,
  ): void {
    const record = this.#requireBody(handle);
    this.#addVelocity(
      record,
      undefined,
      resolveAngularVelocity(this.#dimension, angularImpulse),
    );
  }

  resetForces(handle: PhysicsBodyHandle): void {
    const record = this.#requireBody(handle);
    record.force.fill(0);
    record.torque.fill(0);
  }

  setNextKinematicTransform(
    handle: PhysicsBodyHandle,
    position: Vector3Input,
    rotation?: RotationInput,
  ): void {
    const record = this.#requireBody(handle);
    const world = this.#requireWorld();
    const p = this.#vector3("position", position);
    const q = new Quaternion();
    if (rotation === undefined) {
      this.#currentRotation(world, record, q);
    } else {
      resolveRotation(this.#dimension, rotation, q);
    }
    if (record.type === "kinematic-position") {
      record.target = { position: p, rotation: q };
    } else {
      // Only kinematic-position bodies are driven by targets; for the others
      // the call is a teleport (the same fallback Rapier's setNext* gives).
      this.setBodyTransform(handle, p, q);
    }
  }

  setBodyType(handle: PhysicsBodyHandle, type: BodyType, wake = true): void {
    const record = this.#requireBody(handle);
    const world = this.#requireWorld();
    const fields = world.bodies.fields;
    record.type = type;
    record.target = undefined;
    world.bodies.typeIndex[record.slot] = BODY_TYPE_INDEX[type];
    if (!integrates(type)) {
      pj.setLinearVelocity(world, record.handle, zeros(this.#dims));
      pj.setAngularVelocity(
        world,
        record.handle,
        zeros(this.#dims === 2 ? 1 : 3),
      );
    }
    this.#recomputeMass(record);
    fields.sleepTimer[record.slot] = 0;
    if (wake) {
      pj.wakeBody(world, record.handle);
    }
  }

  wakeBody(handle: PhysicsBodyHandle): void {
    pj.wakeBody(this.#requireWorld(), this.#requireBody(handle).handle);
  }

  sleepBody(handle: PhysicsBodyHandle): void {
    const record = this.#requireBody(handle);
    const world = this.#requireWorld();
    if (record.type !== "dynamic") {
      return;
    }
    pj.setLinearVelocity(world, record.handle, zeros(this.#dims));
    pj.setAngularVelocity(
      world,
      record.handle,
      zeros(this.#dims === 2 ? 1 : 3),
    );
    world.bodies.fields.asleep[record.slot] = 1;
  }

  isBodySleeping(handle: PhysicsBodyHandle): boolean {
    return pj.isSleeping(
      this.#requireWorld(),
      this.#requireBody(handle).handle,
    );
  }

  getBodyCcdMode(handle: PhysicsBodyHandle): CCDMode {
    return this.#requireBody(handle).ccdMode;
  }

  getBodyMass(handle: PhysicsBodyHandle): number {
    return pj.getMass(this.#requireWorld(), this.#requireBody(handle).handle);
  }

  getBodyCenterOfMass(handle: PhysicsBodyHandle, out: Vector3): void {
    const record = this.#requireBody(handle);
    const p = pj.getPosition(this.#requireWorld(), record.handle);
    out.set(p[0], p[1], this.#dims === 3 ? p[2] : 0);
  }

  getBodyId(handle: PhysicsBodyHandle): number {
    return this.#requireBody(handle).id;
  }

  forEachBody(visit: (handle: PhysicsBodyHandle, id: number) => void): void {
    this.#requireWorld();
    for (const record of this.#bodies.values()) {
      visit(record as unknown as PhysicsBodyHandle, record.id);
    }
  }

  getColliderBody(handle: PhysicsColliderHandle): PhysicsBodyHandle {
    const record = this.#requireCollider(handle);
    return this.#bodies.get(record.bodyId) as unknown as PhysicsBodyHandle;
  }

  getColliderId(handle: PhysicsColliderHandle): number {
    return this.#requireCollider(handle).id;
  }

  forEachCollider(
    visit: (handle: PhysicsColliderHandle, id: number) => void,
  ): void {
    this.#requireWorld();
    for (const record of this.#colliders.values()) {
      visit(record as unknown as PhysicsColliderHandle, record.id);
    }
  }

  /** Touching collider pairs (PhysJS pair events carry no manifold points). */
  countContacts(): number {
    this.#requireWorld();
    return this.#activePairs.size;
  }

  // --- SolverBodyTuningAccess ------------------------------------------------

  setBodyMassProperties(
    handle: PhysicsBodyHandle,
    mass: number,
    centerOfMass: Vector3 | undefined,
    inertiaTensor: Matrix3 | undefined,
    wake = true,
  ): void {
    const record = this.#requireBody(handle);
    const world = this.#requireWorld();
    if (centerOfMass !== undefined) {
      this.#requireZeroCentre(centerOfMass);
    }
    const inertia =
      inertiaTensor === undefined
        ? undefined
        : this.#diagonalInertia(inertiaTensor);
    record.authoredMass = mass;
    record.authoredInertia = inertia;
    this.#recomputeMass(record);
    if (wake) {
      pj.wakeBody(world, record.handle);
    }
  }

  setBodyDamping(
    handle: PhysicsBodyHandle,
    linear: number,
    angular: number,
  ): void {
    const record = this.#requireBody(handle);
    const fields = this.#requireWorld().bodies.fields;
    fields.linearDamping[record.slot] = linear;
    fields.angularDamping[record.slot] = angular;
  }

  setBodyGravityScale(
    handle: PhysicsBodyHandle,
    scale: number,
    wake = true,
  ): void {
    const record = this.#requireBody(handle);
    const world = this.#requireWorld();
    world.bodies.fields.gravityScale[record.slot] = scale;
    if (wake) {
      pj.wakeBody(world, record.handle);
    }
  }

  setBodyCcdMode(
    handle: PhysicsBodyHandle,
    mode: CCDMode,
    _predictionDistance?: number,
  ): void {
    const record = this.#requireBody(handle);
    if (mode === "swept") {
      unsupported(this.name, 'CCD mode "swept"');
    }
    // PhysJS always generates speculative contacts; "disabled" is a label.
    record.ccdMode = mode;
  }

  setColliderMaterial(
    handle: PhysicsColliderHandle,
    friction: number,
    restitution: number,
    density: number | undefined,
  ): void {
    const record = this.#requireCollider(handle);
    const world = this.#requireWorld();
    const stored = pj.getCollider(world, record.handle);
    if (stored === undefined) {
      return;
    }
    // ColliderRecord is plain data; friction/restitution are read each step.
    const mutable = stored as { friction: number; restitution: number };
    mutable.friction = friction;
    mutable.restitution = restitution;
    if (density !== undefined && density !== record.density) {
      this.#replaceDensity(record, density);
    }
  }

  setColliderFilter(
    _handle: PhysicsColliderHandle,
    sensor: boolean,
    collisionGroups: number,
    collisionMask: number,
  ): void {
    if (sensor) {
      unsupported(this.name, "sensor colliders (no trigger volumes)");
    }
    if (
      collisionGroups !== ALL_COLLISION_GROUPS ||
      collisionMask !== ALL_COLLISION_GROUPS
    ) {
      unsupported(
        this.name,
        "collision groups or masks (every collider collides with every other)",
      );
    }
  }

  // --- internals -------------------------------------------------------------

  #requireJoint(handle: PhysicsJointHandle): JointEntry {
    this.#requireWorld();
    const entry = handle as unknown as JointEntry;
    if (!entry.alive || this.#joints.get(entry.id) !== entry) {
      rejectStalePhysicsHandle(
        "joint",
        String(entry.id),
        `Joint handle is not valid for this ${this.name}: it was destroyed, or it was minted by another adapter (§37).`,
        ADAPTER_ERROR_CODE,
        { adapter: this.name },
      );
    }
    return entry;
  }

  #storedJoint(handle: PhysicsJointHandle): pj.JointRecord {
    const world = this.#requireWorld();
    return pj.getJoint(
      world,
      this.#requireJoint(handle).handle,
    ) as pj.JointRecord;
  }

  /** Rotates `v` by the body's current orientation. */
  #bodyFrame(record: BodyRecord): { position: Vector3; rotation: Quaternion } {
    const position = new Vector3();
    const rotation = new Quaternion();
    this.getBodyTransform(
      record as unknown as PhysicsBodyHandle,
      position,
      rotation,
    );
    return { position, rotation };
  }

  #rotate(q: Quaternion, v: Vector3): Vector3 {
    const tx = 2 * (q.y * v.z - q.z * v.y);
    const ty = 2 * (q.z * v.x - q.x * v.z);
    const tz = 2 * (q.x * v.y - q.y * v.x);
    return new Vector3(
      v.x + q.w * tx + (q.y * tz - q.z * ty),
      v.y + q.w * ty + (q.z * tx - q.x * tz),
      v.z + q.w * tz + (q.x * ty - q.y * tx),
    );
  }

  /** A body-local anchor as a world-frame PhysJS vector. */
  #anchorToWorld(
    record: BodyRecord,
    anchor: Vector3Input | undefined,
  ): number[] {
    const local =
      anchor === undefined ? new Vector3() : this.#vector3("anchor", anchor);
    const frame = this.#bodyFrame(record);
    const r = this.#rotate(frame.rotation, local);
    const x = frame.position.x + r.x;
    const y = frame.position.y + r.y;
    return this.#dims === 2 ? [x, y] : [x, y, frame.position.z + r.z];
  }

  /** The bodyA-local hinge axis as a world-frame vector. */
  #axisToWorld(record: BodyRecord, axis: Vector3Input | undefined): number[] {
    const local = this.#vector3("axis", axis ?? new Vector3(0, 0, 1));
    const r = this.#rotate(this.#bodyFrame(record).rotation, local);
    return [r.x, r.y, r.z];
  }

  #candidate(record: ColliderRecord): QueryCandidate {
    return {
      collider: record as unknown as PhysicsColliderHandle,
      body: this.#bodies.get(record.bodyId) as unknown as PhysicsBodyHandle,
      collisionGroups: ALL_COLLISION_GROUPS,
      collisionMask: ALL_COLLISION_GROUPS,
      sensor: false,
    };
  }

  #passes(
    handle: pj.ColliderHandle,
    options: ReturnType<typeof resolveQueryOptions>,
  ): boolean {
    const record = this.#collidersByHandle.get(handle) as ColliderRecord;
    return passesQueryFilter(this.#candidate(record), options);
  }

  #queryHit(handle: pj.ColliderHandle): {
    collider: PhysicsColliderHandle;
    body: PhysicsBodyHandle;
  } {
    const candidate = this.#candidate(
      this.#collidersByHandle.get(handle) as ColliderRecord,
    );
    return { collider: candidate.collider, body: candidate.body };
  }

  #rayHit(hit: pj.RayHit): RaycastHit {
    return {
      ...this.#queryHit(hit.collider),
      point: new Vector3(hit.point[0], hit.point[1], hit.point[2]),
      normal: new Vector3(hit.normal[0], hit.normal[1], hit.normal[2]),
      distance: hit.distance,
    };
  }

  #snapshotMeta(): SnapshotMeta {
    return {
      adapter: this.name,
      version: this.version,
      nextBodyId: this.#nextBodyId,
      nextColliderId: this.#nextColliderId,
      nextJointId: this.#nextJointId,
      joints: [...this.#joints.values()].map((j) => [
        j.id,
        j.handle,
        j.type,
        j.bodyIdA,
        j.bodyIdB,
      ]),
      bodies: [...this.#bodies.values()].map((b) => ({
        id: b.id,
        handle: b.handle,
        type: b.type,
        mass: b.authoredMass ?? null,
        inertia: b.authoredInertia?.map(finiteOrNull) ?? null,
        force: [...b.force],
        torque: [...b.torque],
        sleeping: b.sleeping,
        ccd: b.ccdMode,
        target:
          b.target === undefined
            ? null
            : [
                b.target.position.x,
                b.target.position.y,
                b.target.position.z,
                b.target.rotation.x,
                b.target.rotation.y,
                b.target.rotation.z,
                b.target.rotation.w,
              ],
      })),
      colliders: [...this.#colliders.values()].map((c) => [
        c.id,
        c.handle,
        c.bodyId,
        c.density,
        c.physDensity,
      ]),
      pairs: [...this.#activePairs.values()].map((p) => [p.a.id, p.b.id]),
    };
  }

  /**
   * Rebuilds the registries from the envelope, reusing the record objects whose
   * id and PhysJS handle survive (so handles minted before the snapshot keep
   * working) and killing the rest.
   */
  #rebuildRegistry(meta: SnapshotMeta): void {
    const bodies = new Map<number, BodyRecord>();
    for (const e of meta.bodies) {
      const old = this.#bodies.get(e.id);
      const record: BodyRecord =
        old !== undefined && (old.handle as number) === e.handle
          ? old
          : {
              id: e.id,
              handle: e.handle as pj.BodyHandle,
              slot: e.handle % pj.MAX_BODIES,
              type: e.type,
              alive: true,
              colliderIds: [],
              authoredMass: undefined,
              authoredInertia: undefined,
              force: [0, 0, 0],
              torque: [0, 0, 0],
              sleeping: false,
              ccdMode: e.ccd,
              target: undefined,
            };
      record.type = e.type;
      record.authoredMass = e.mass ?? undefined;
      record.authoredInertia =
        e.inertia === null
          ? undefined
          : [
              nullToInfinity(e.inertia[0]),
              nullToInfinity(e.inertia[1]),
              nullToInfinity(e.inertia[2]),
            ];
      record.force[0] = e.force[0];
      record.force[1] = e.force[1];
      record.force[2] = e.force[2];
      record.torque[0] = e.torque[0];
      record.torque[1] = e.torque[1];
      record.torque[2] = e.torque[2];
      record.sleeping = e.sleeping;
      record.ccdMode = e.ccd;
      record.colliderIds.length = 0;
      record.target =
        e.target === null
          ? undefined
          : {
              position: new Vector3(e.target[0], e.target[1], e.target[2]),
              rotation: new Quaternion(
                e.target[3],
                e.target[4],
                e.target[5],
                e.target[6],
              ),
            };
      bodies.set(e.id, record);
    }
    const colliders = new Map<number, ColliderRecord>();
    const byHandle = new Map<pj.ColliderHandle, ColliderRecord>();
    for (const [id, handle, bodyId, density, physDensity] of meta.colliders) {
      const old = this.#colliders.get(id);
      const record: ColliderRecord =
        old !== undefined &&
        old.handle === handle &&
        old.bodyId === bodyId &&
        old.physDensity === physDensity
          ? old
          : {
              id,
              handle: handle as pj.ColliderHandle,
              bodyId,
              alive: true,
              density,
              physDensity,
            };
      record.density = density;
      colliders.set(id, record);
      byHandle.set(handle as pj.ColliderHandle, record);
      (bodies.get(bodyId) as BodyRecord).colliderIds.push(id);
    }
    const joints = new Map<number, JointEntry>();
    for (const [id, handle, type, bodyIdA, bodyIdB] of meta.joints) {
      const old = this.#joints.get(id);
      joints.set(
        id,
        old !== undefined && old.handle === handle
          ? old
          : {
              id,
              handle: handle as pj.JointHandle,
              type: type as JointEntry["type"],
              bodyIdA,
              bodyIdB,
              alive: true,
            },
      );
    }
    for (const old of this.#bodies.values()) {
      old.alive = bodies.get(old.id) === old;
    }
    for (const old of this.#colliders.values()) {
      old.alive = colliders.get(old.id) === old;
    }
    for (const old of this.#joints.values()) {
      old.alive = joints.get(old.id) === old;
    }
    this.#bodies.clear();
    for (const [id, record] of bodies) {
      this.#bodies.set(id, record);
    }
    this.#colliders.clear();
    for (const [id, record] of colliders) {
      this.#colliders.set(id, record);
    }
    this.#collidersByHandle.clear();
    for (const [handle, record] of byHandle) {
      this.#collidersByHandle.set(handle, record);
    }
    this.#joints = joints;
    this.#activePairs.clear();
    for (const [a, b] of meta.pairs) {
      const first = colliders.get(a) as ColliderRecord;
      const second = colliders.get(b) as ColliderRecord;
      this.#activePairs.set(pairKey(first, second), { a: first, b: second });
    }
    this.#pendingEvents = [];
    this.#nextBodyId = meta.nextBodyId;
    this.#nextColliderId = meta.nextColliderId;
    this.#nextJointId = meta.nextJointId;
  }

  #assertNotDisposed(): void {
    if (this.#disposed) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `${this.name} has been disposed; dispose() is terminal (§37, §83).`,
        { context: { adapter: this.name } },
      );
    }
  }

  #requireWorld(): pj.World {
    this.#assertNotDisposed();
    if (this.#world === undefined) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `${this.name}.initialize has not been called (§37).`,
        { context: { adapter: this.name } },
      );
    }
    return this.#world;
  }

  #requireBody(handle: PhysicsBodyHandle): BodyRecord {
    this.#requireWorld();
    const record = handle as unknown as BodyRecord;
    if (!record.alive || this.#bodies.get(record.id) !== record) {
      rejectStalePhysicsHandle(
        "body",
        String(record.id),
        `Body handle is not valid for this ${this.name}: it was destroyed, or it was minted by another adapter (§37).`,
        ADAPTER_ERROR_CODE,
        { adapter: this.name },
      );
    }
    return record;
  }

  #requireCollider(handle: PhysicsColliderHandle): ColliderRecord {
    this.#requireWorld();
    const record = handle as unknown as ColliderRecord;
    if (!record.alive || this.#colliders.get(record.id) !== record) {
      rejectStalePhysicsHandle(
        "collider",
        String(record.id),
        `Collider handle is not valid for this ${this.name}: it was destroyed, or it was minted by another adapter (§37).`,
        ADAPTER_ERROR_CODE,
        { adapter: this.name },
      );
    }
    return record;
  }

  #forgetCollider(record: ColliderRecord): void {
    const world = this.#requireWorld();
    // pj.removeBody removes colliders itself; only remove when the body lives on.
    if (pj.getCollider(world, record.handle) !== undefined) {
      pj.removeCollider(world, record.handle);
    }
    record.alive = false;
    this.#colliders.delete(record.id);
    this.#collidersByHandle.delete(record.handle);
    const body = this.#bodies.get(record.bodyId);
    if (body !== undefined) {
      const at = body.colliderIds.indexOf(record.id);
      if (at >= 0) {
        body.colliderIds.splice(at, 1);
      }
    }
    for (const [key, pair] of this.#activePairs) {
      if (pair.a === record || pair.b === record) {
        this.#activePairs.delete(key);
      }
    }
  }

  /** Applies a new density by rescaling the collider's mass contribution. */
  #replaceDensity(record: ColliderRecord, density: number): void {
    record.density = density;
    const body = this.#bodies.get(record.bodyId);
    if (body !== undefined) {
      this.#recomputeMass(body);
    }
  }

  /**
   * Rewrites the body's mass columns: PhysJS derives them from collider
   * density, fourJS says an authored mass/inertia wins (see the module header).
   */
  #recomputeMass(record: BodyRecord): void {
    const world = this.#requireWorld();
    const f = world.bodies.fields;
    const s = record.slot;
    const inertiaAt = (axis: number, value: number): void => {
      f.inertia[s * 3 + axis] = value;
      f.inverseInertia[s * 3 + axis] =
        Number.isFinite(value) && value > 0 ? 1 / value : 0;
    };
    if (record.type !== "dynamic") {
      f.mass[s] = Infinity;
      f.inverseMass[s] = 0;
      for (let axis = 0; axis < 3; axis += 1) {
        inertiaAt(axis, Infinity);
      }
      return;
    }
    let mass = 0;
    const inertia = [0, 0, 0];
    for (const id of record.colliderIds) {
      const collider = this.#colliders.get(id);
      const stored =
        collider === undefined
          ? undefined
          : pj.getCollider(world, collider.handle);
      if (
        collider === undefined ||
        stored === undefined ||
        collider.density <= 0
      ) {
        continue;
      }
      // Scale from the density PhysJS was given to the one in force now.
      const k = collider.density / collider.physDensity;
      mass += stored.mass * k;
      inertia[0] += stored.inertia[0] * k;
      inertia[1] += stored.inertia[1] * k;
      inertia[2] += stored.inertia[2] * k;
    }
    let finalMass = mass > 0 ? mass : Infinity;
    const finalInertia = mass > 0 ? inertia : [Infinity, Infinity, Infinity];
    if (record.authoredMass !== undefined && record.authoredMass > 0) {
      if (mass > 0) {
        const scale = record.authoredMass / mass;
        for (let axis = 0; axis < 3; axis += 1) {
          finalInertia[axis] *= scale;
        }
      }
      finalMass = record.authoredMass;
    }
    if (record.authoredInertia !== undefined) {
      for (let axis = 0; axis < 3; axis += 1) {
        finalInertia[axis] = record.authoredInertia[axis];
      }
    }
    if (this.#dims === 2) {
      finalInertia[0] = Infinity;
      finalInertia[1] = Infinity;
    }
    f.mass[s] = finalMass;
    f.inverseMass[s] = Number.isFinite(finalMass) ? 1 / finalMass : 0;
    for (let axis = 0; axis < 3; axis += 1) {
      inertiaAt(axis, finalInertia[axis]);
    }
  }

  #feedPersistentLoads(world: pj.World, record: BodyRecord): void {
    if (pj.isSleeping(world, record.handle)) {
      return;
    }
    const [fx, fy, fz] = record.force;
    const [tx, ty, tz] = record.torque;
    if (fx !== 0 || fy !== 0 || fz !== 0) {
      pj.applyForce(
        world,
        record.handle,
        this.#dims === 2 ? [fx, fy] : [fx, fy, fz],
      );
    }
    if (tx !== 0 || ty !== 0 || tz !== 0) {
      pj.applyTorque(
        world,
        record.handle,
        this.#dims === 2 ? [tz] : [tx, ty, tz],
      );
    }
  }

  /** Turns a kinematic-position target into the one-step velocity that reaches it. */
  #driveKinematic(
    world: pj.World,
    record: BodyRecord,
    target: { position: Vector3; rotation: Quaternion },
    delta: number,
  ): void {
    world.bodies.typeIndex[record.slot] = BODY_TYPE_INDEX["kinematic-velocity"];
    const p = pj.getPosition(world, record.handle);
    const dx = (target.position.x - p[0]) / delta;
    const dy = (target.position.y - p[1]) / delta;
    const dz = this.#dims === 3 ? (target.position.z - p[2]) / delta : 0;
    pj.setLinearVelocity(
      world,
      record.handle,
      this.#dims === 2 ? [dx, dy] : [dx, dy, dz],
    );
    const current = new Quaternion();
    this.#currentRotation(world, record, current);
    const q = target.rotation;
    // delta = target * conj(current); angular velocity = axis * angle / dt.
    const dw =
      q.w * current.w + q.x * current.x + q.y * current.y + q.z * current.z;
    let rx =
      q.w * -current.x + q.x * current.w + q.y * -current.z - q.z * -current.y;
    let ry =
      q.w * -current.y - q.x * -current.z + q.y * current.w + q.z * -current.x;
    let rz =
      q.w * -current.z + q.x * -current.y - q.y * -current.x + q.z * current.w;
    let rw = dw;
    if (rw < 0) {
      rx = -rx;
      ry = -ry;
      rz = -rz;
      rw = -rw;
    }
    const sin = Math.hypot(rx, ry, rz);
    const angle = 2 * Math.atan2(sin, rw);
    const scale = sin > ZERO_EPSILON ? angle / sin / delta : 0;
    const angular =
      this.#dims === 2 ? [rz * scale] : [rx * scale, ry * scale, rz * scale];
    pj.setAngularVelocity(world, record.handle, angular);
  }

  #finishKinematic(world: pj.World, record: BodyRecord): void {
    const target = record.target;
    record.target = undefined;
    world.bodies.typeIndex[record.slot] = BODY_TYPE_INDEX["kinematic-position"];
    pj.setLinearVelocity(world, record.handle, zeros(this.#dims));
    pj.setAngularVelocity(
      world,
      record.handle,
      zeros(this.#dims === 2 ? 1 : 3),
    );
    if (target !== undefined) {
      pj.setPosition(
        world,
        record.handle,
        this.#toVector("position", target.position),
      );
      pj.setRotation(world, record.handle, this.#toRotation(target.rotation));
    }
  }

  #currentRotation(world: pj.World, record: BodyRecord, out: Quaternion): void {
    const r = pj.getRotation(world, record.handle);
    if (this.#dims === 2) {
      const half = r[0] / 2;
      out.set(0, 0, Math.sin(half), Math.cos(half));
    } else {
      out.set(r[1], r[2], r[3], r[0]);
    }
  }

  /** Adds `linear` (impulse) and `angular` (angular impulse) as velocity changes. */
  #addVelocity(
    record: BodyRecord,
    linear: Vector3 | undefined,
    angular: Vector3 | undefined,
  ): void {
    const world = this.#requireWorld();
    if (record.type !== "dynamic") {
      return;
    }
    const f = world.bodies.fields;
    pj.wakeBody(world, record.handle);
    if (linear !== undefined) {
      const inv = f.inverseMass[record.slot];
      const v = pj.getLinearVelocity(world, record.handle);
      pj.setLinearVelocity(
        world,
        record.handle,
        this.#dims === 2
          ? [v[0] + linear.x * inv, v[1] + linear.y * inv]
          : [
              v[0] + linear.x * inv,
              v[1] + linear.y * inv,
              v[2] + linear.z * inv,
            ],
      );
    }
    if (angular !== undefined) {
      const w = pj.getAngularVelocity(world, record.handle);
      if (this.#dims === 2) {
        pj.setAngularVelocity(world, record.handle, [
          w[0] + angular.z * f.inverseInertia[record.slot * 3 + 2],
        ]);
      } else {
        const q = pj.getRotation(world, record.handle);
        const dw = applyInverseInertia(
          q,
          [
            f.inverseInertia[record.slot * 3],
            f.inverseInertia[record.slot * 3 + 1],
            f.inverseInertia[record.slot * 3 + 2],
          ],
          angular,
        );
        pj.setAngularVelocity(world, record.handle, [
          w[0] + dw[0],
          w[1] + dw[1],
          w[2] + dw[2],
        ]);
      }
    }
  }

  #wakeDynamic(record: BodyRecord): void {
    if (record.type === "dynamic") {
      pj.wakeBody(this.#requireWorld(), record.handle);
    }
  }

  #restoreSleep(record: BodyRecord, wasSleeping: boolean, wake: boolean): void {
    if (wasSleeping && !wake) {
      this.#requireWorld().bodies.fields.asleep[record.slot] = 1;
    }
  }

  #leverArm(record: BodyRecord, worldPoint: Vector3Input): Vector3 {
    const p = pj.getPosition(this.#requireWorld(), record.handle);
    const point = this.#vector3("worldPoint", worldPoint);
    return new Vector3(
      point.x - p[0],
      point.y - p[1],
      this.#dims === 3 ? point.z - p[2] : 0,
    );
  }

  #requireZeroCentre(centre: Vector3Input): void {
    const c = this.#vector3("centerOfMass", centre);
    if (Math.abs(c.x) + Math.abs(c.y) + Math.abs(c.z) > ZERO_EPSILON) {
      unsupported(
        this.name,
        "a non-zero centerOfMass (the centre of mass sits on the body origin)",
      );
    }
  }

  /** Principal moments from a tensor; refuses off-diagonal terms. */
  #diagonalInertia(tensor: Matrix3): [number, number, number] {
    const e = tensor.elements;
    const off = [1, 2, 3, 5, 6, 7].reduce((sum, i) => sum + Math.abs(e[i]), 0);
    if (off > ZERO_EPSILON) {
      unsupported(
        this.name,
        "an inertiaTensor with off-diagonal terms (PhysJS takes principal moments)",
      );
    }
    return this.#dims === 2 ? [Infinity, Infinity, e[8]] : [e[0], e[4], e[8]];
  }

  #vector3(field: string, value: Vector3Input): Vector3 {
    const v = widenToVector3(value);
    if (this.#dims === 2 && v.z !== 0) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `${field}.z must be 0 in a "2d" world; got ${String(v.z)} (§21).`,
        { context: { adapter: this.name, field } },
      );
    }
    return v;
  }

  #toVector(field: string, value: Vector3Input): number[] {
    const v = this.#vector3(field, value);
    return this.#dims === 2 ? [v.x, v.y] : [v.x, v.y, v.z];
  }

  #toAngular(value: AngularVelocityInput): number[] {
    const v = resolveAngularVelocity(this.#dimension, value);
    return this.#dims === 2 ? [v.z] : [v.x, v.y, v.z];
  }

  #toRotation(value: RotationInput): number[] {
    const q = resolveRotation(this.#dimension, value);
    return this.#dims === 2 ? [2 * Math.atan2(q.z, q.w)] : [q.w, q.x, q.y, q.z];
  }

  /** RFC 0010 decision 6: one mapping table, keyed by fourJS shape type. */
  #toShape(shape: CollisionShape): pj.ShapeDescriptor {
    switch (shape.type) {
      case "circle":
        return { type: "circle", radius: shape.radius };
      case "rectangle":
        return {
          type: "rectangle",
          halfExtents: [shape.halfExtents.x, shape.halfExtents.y],
        };
      case "sphere":
        return { type: "sphere", radius: shape.radius };
      case "box":
        return {
          type: "box",
          halfExtents: [
            shape.halfExtents.x,
            shape.halfExtents.y,
            shape.halfExtents.z,
          ],
        };
      case "capsule":
        return {
          type: this.#dims === 2 ? "capsule2d" : "capsule",
          radius: shape.radius,
          halfHeight: shape.halfHeight,
        };
      case "polygon":
        return { type: "polygon", vertices: this.#polygon(shape.vertices) };
      default:
        return unsupported(this.name, `the ${shape.type} shape`);
    }
  }

  /** CCW outline centred on its centroid, as PhysJS requires; refuses an off-centre one. */
  #polygon(vertices: readonly { x: number; y: number }[]): number[][] {
    let area2 = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < vertices.length; i += 1) {
      const a = vertices[i];
      const b = vertices[(i + 1) % vertices.length];
      const cross = a.x * b.y - b.x * a.y;
      area2 += cross;
      cx += (a.x + b.x) * cross;
      cy += (a.y + b.y) * cross;
    }
    cx /= 3 * area2;
    cy /= 3 * area2;
    if (Math.abs(cx) + Math.abs(cy) > 1e-6) {
      unsupported(
        this.name,
        "a polygon whose centroid is off the body origin (equivalent to a collider offset)",
      );
    }
    const outline = vertices.map((v) => [v.x, v.y]);
    return area2 < 0 ? outline.reverse() : outline;
  }

  #collectEvents(): void {
    const world = this.#requireWorld();
    const started: ColliderRecord[] = [];
    const stopped: ColliderRecord[] = [];
    const stoppedKeys = new Set<number>();
    for (const event of pj.drainEvents(world)) {
      if (event.type !== "contactBegin" && event.type !== "contactEnd") {
        continue;
      }
      const a = this.#collidersByHandle.get(event.colliderA);
      const b = this.#collidersByHandle.get(event.colliderB);
      if (a === undefined || b === undefined) {
        continue;
      }
      if (event.type === "contactBegin") {
        started.push(a, b);
      } else {
        stopped.push(a, b);
        stoppedKeys.add(pairKey(a, b));
      }
    }

    for (let i = 0; i < started.length; i += 2) {
      this.#emitPair(started[i], started[i + 1], "start");
    }
    if (this.#stayEvents) {
      for (const [key, pair] of this.#activePairs) {
        if (!stoppedKeys.has(key)) {
          this.#emitPair(pair.a, pair.b, "stay");
        }
      }
    }
    for (let i = 0; i < started.length; i += 2) {
      const key = pairKey(started[i], started[i + 1]);
      if (!this.#activePairs.has(key)) {
        this.#activePairs.set(key, { a: started[i], b: started[i + 1] });
      }
    }
    for (let i = 0; i < stopped.length; i += 2) {
      this.#emitPair(stopped[i], stopped[i + 1], "end");
      this.#activePairs.delete(pairKey(stopped[i], stopped[i + 1]));
    }

    for (const record of this.#bodies.values()) {
      const sleeping = pj.isSleeping(world, record.handle);
      if (sleeping !== record.sleeping) {
        record.sleeping = sleeping;
        this.#pendingEvents.push({
          type: sleeping ? "sleep" : "wake",
          body: record as unknown as PhysicsBodyHandle,
        });
      }
    }
  }

  #emitPair(
    a: ColliderRecord,
    b: ColliderRecord,
    phase: "start" | "stay" | "end",
  ): void {
    const world = this.#requireWorld();
    const bodyA = this.#bodies.get(a.bodyId);
    const bodyB = this.#bodies.get(b.bodyId);
    if (bodyA === undefined || bodyB === undefined) {
      return;
    }
    const relativeVelocity = new Vector3();
    if (phase !== "end") {
      const va = pj.getLinearVelocity(world, bodyA.handle);
      const vb = pj.getLinearVelocity(world, bodyB.handle);
      relativeVelocity.set(
        va[0] - vb[0],
        va[1] - vb[1],
        this.#dims === 3 ? va[2] - vb[2] : 0,
      );
    }
    const contacts: ContactPoint[] = [];
    this.#pendingEvents.push({
      type:
        phase === "start"
          ? "collisionstart"
          : phase === "stay"
            ? "collisionstay"
            : "collisionend",
      bodyA: bodyA as unknown as PhysicsBodyHandle,
      bodyB: bodyB as unknown as PhysicsBodyHandle,
      colliderA: a as unknown as PhysicsColliderHandle,
      colliderB: b as unknown as PhysicsColliderHandle,
      contacts,
      relativeVelocity,
      totalImpulse: new Vector3(),
    });
  }
}

function integrates(type: BodyType): boolean {
  return type === "dynamic" || type === "kinematic-velocity";
}

function zeros(n: number): number[] {
  return new Array<number>(n).fill(0);
}

function pairKey(a: ColliderRecord, b: ColliderRecord): number {
  const lo = a.id < b.id ? a.id : b.id;
  const hi = a.id < b.id ? b.id : a.id;
  return lo * 0x100000000 + hi;
}

/** §31: PhysJS is always speculative; only `"swept"` is refused. */
function resolveCcd(desc: RigidBodyDescriptor, adapter: string): CCDMode {
  const mode =
    desc.ccdMode ??
    (desc.continuousCollisionDetection === true ? "swept" : "disabled");
  if (mode === "swept") {
    unsupported(
      adapter,
      'CCD mode "swept" (PhysJS offers speculative contacts only)',
    );
  }
  return mode;
}

/** `R diag(inv) R^T v` for a PhysJS quaternion `[w, x, y, z]`. */
function applyInverseInertia(
  q: ArrayLike<number>,
  inv: readonly [number, number, number],
  v: Vector3,
): [number, number, number] {
  const [w, x, y, z] = [q[0], q[1], q[2], q[3]];
  const rotate = (
    px: number,
    py: number,
    pz: number,
    sign: 1 | -1,
  ): [number, number, number] => {
    const s = sign;
    const qx = s * x;
    const qy = s * y;
    const qz = s * z;
    const tx = 2 * (qy * pz - qz * py);
    const ty = 2 * (qz * px - qx * pz);
    const tz = 2 * (qx * py - qy * px);
    return [
      px + w * tx + (qy * tz - qz * ty),
      py + w * ty + (qz * tx - qx * tz),
      pz + w * tz + (qx * ty - qy * tx),
    ];
  };
  const local = rotate(v.x, v.y, v.z, -1);
  return rotate(local[0] * inv[0], local[1] * inv[1], local[2] * inv[2], 1);
}

/** PhysJS for `"2d"` worlds (`createWorld({ dims: 2 })`). */
export class PhysJSAdapter2D extends PhysJSAdapterBase {
  readonly name = "physjs2d";
  constructor() {
    super("2d");
  }
}

/** PhysJS for `"3d"` worlds (`createWorld({ dims: 3 })`). */
export class PhysJSAdapter3D extends PhysJSAdapterBase {
  readonly name = "physjs3d";
  constructor() {
    super("3d");
  }
}
