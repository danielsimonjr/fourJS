/**
 * `Box2dAdapter` — the 2D §37 solver adapter over `@box2d/core` 0.11.0 (W8.1).
 *
 * `@box2d/core` is a pure-TypeScript port of Box2D 2.4: no wasm, so there is no
 * async initialisation and (later) snapshots are plain float64.
 *
 * ## Scope of this packet
 *
 * Implemented: world + gravity, the four §22 body types, circle / rectangle /
 * capsule / convex-polygon colliders, `step`, collision / trigger / sleep event
 * derivation, the whole `SolverBodyAccess` seam, joints and tuning (W8.2), and
 * (W8.3) the four §30 queries (`raycast`, `shapeCast`, `overlap`,
 * `pointQuery`) plus §34 snapshots in an explicit float64 envelope (see
 * `snapshot-codec.ts`). Snapshot restore does not recover warm-start state; see
 * `restoreSnapshot` for exactly which §34 guarantees hold.
 *
 * ## Mappings worth knowing
 *
 * - Box2D has one kinematic type. `"kinematic-velocity"` is driven by
 *   `setBodyVelocities`; `"kinematic-position"` derives a velocity from the
 *   pose to the next target at `step(dt)` and lands exactly on the target.
 * - Box2D 2.4 has no capsule: a capsule collider is a rectangle plus two
 *   circles (three fixtures, one collider handle), which is exact for
 *   geometry and mass. Pair events are aggregated per *collider* pair.
 * - Polygons are limited by Box2D to 8 vertices (`b2_maxPolygonVertices`).
 * - Restitution combines by `max` (Appendix A, Box2D's own rule). Friction
 *   combines by `sqrt(a*b)` in Box2D, not Appendix A's average; this is a
 *   recorded difference, not hidden.
 * - Box2D's step is a single `Step(dt, {velocityIterations, positionIterations})`;
 *   the adapter never sub-divides (§37). `solverIterations` sets velocity
 *   iterations (default 8; position iterations stay 3).
 */

import {
  b2BodyType,
  b2CircleShape,
  b2ContactListener,
  b2DistanceJointDef,
  b2_maxFloat,
  b2PolygonShape,
  b2PrismaticJointDef,
  b2RevoluteJointDef,
  b2Vec2,
  b2WeldJointDef,
  b2World,
  b2WorldManifold,
  b2AABB,
  b2ShapeCast,
  b2Distance,
  b2DistanceInput,
  b2DistanceOutput,
  b2SimplexCache,
  b2ShapeCastInput,
  b2ShapeCastOutput,
  b2TestOverlap,
  b2Transform,
} from "@box2d/core";
import type {
  b2Body,
  b2Contact,
  b2Fixture,
  b2Joint,
  b2PrismaticJoint,
  b2RevoluteJoint,
  b2Shape,
} from "@box2d/core";
import { FourError } from "@fourjs/core";
import {
  SNAPSHOT_FORMAT_VERSION,
  SNAPSHOT_MAGIC,
  SnapshotReader,
  SnapshotWriter,
} from "./snapshot-codec.js";
import { Quaternion, Vector3 } from "@fourjs/math";
import type { Matrix3 } from "@fourjs/math";
import {
  ALL_COLLISION_GROUPS,
  DEFAULT_FRICTION,
  DEFAULT_RESTITUTION,
  DETERMINISM_LEVELS,
  passesQueryFilter,
  rejectStalePhysicsHandle,
  resolveAngularVelocity,
  resolveQueryOptions,
  sortHitsByDistance,
  validateQueryShape,
  resolveDensity,
  resolveGravity,
  resolveRotation,
  resolveSleepingConfig,
  validateColliderDescriptor,
  validateJointDescriptor,
  validatePhysicsWorldOptions,
  validateRigidBodyDescriptor,
} from "@fourjs/physics";
import type {
  AngularVelocityInput,
  BodyType,
  CCDMode,
  ColliderDescriptor,
  ContactPoint,
  JointDescriptor,
  QueryCandidate,
  ResolvedQueryOptions,
  OverlapHit,
  OverlapQuery,
  PhysicsBodyHandle,
  PhysicsCapabilities,
  PhysicsColliderHandle,
  PhysicsEvent,
  PhysicsEventInterest,
  PhysicsJointHandle,
  PhysicsSolverAdapter,
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
  SolverBodyAccess,
  SolverBodyTuningAccess,
  SolverJointAccess,
  SolverJointMotor,
  Vector3Input,
} from "@fourjs/physics";

/** §37 `name`. */
const ADAPTER_NAME = "box2d";

const ADAPTER_ERROR_CODE = "INVALID_APPLICATION_STATE";

/** The installed `@box2d/core` version, exact-pinned in package.json. */
export const BOX2D_CORE_VERSION = "0.11.0";

/** Box2D's own `b2_maxPolygonVertices`. */
const MAX_POLYGON_VERTICES = 8;

const DEFAULT_VELOCITY_ITERATIONS = 8;
const POSITION_ITERATIONS = 3;

/**
 * What this adapter can do, declared honestly for the W8.1 state.
 *
 * - `jointTypes`: the five 2D shipped types (W8.2). `queries` all `true` /
 *   `snapshots: true` (W8.3).
 * - `ccdModes`: Box2D's continuous collision is TOI-based; `"swept"` maps to
 *   `b2Body.SetBullet`. There is no speculative mode.
 * - `tuning.jointMotorEffortCap` is `true`: Box2D's `maxMotorTorque` /
 *   `maxMotorForce` are real hard caps — the impulse is clamped to
 *   `maxEffort * dt` inside the solver (the recorded reason this adapter
 *   exists). Rolling / spinning friction and sleep thresholds stay `false`.
 */
const BOX2D_JOINT_TYPES = [
  "fixed",
  "spring",
  "revolute",
  "prismatic",
  "rope",
] as const satisfies readonly ShippedJointType[];

export const BOX2D_CAPABILITIES: PhysicsCapabilities = Object.freeze({
  dimensions: Object.freeze(["2d"] as const),
  jointTypes: Object.freeze<string[]>([...BOX2D_JOINT_TYPES]),
  ccdModes: Object.freeze<CCDMode[]>(["disabled", "swept"]),
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
    jointMotorEffortCap: true,
  }),
});

interface BodyRecord {
  readonly id: number;
  /** Re-pointed by `restoreSnapshot`, which rebuilds the world under live handles. */
  body: b2Body;
  type: BodyType;
  alive: boolean;
  sleeping: boolean;
  /** Authored mass (§23), re-applied after each collider is added. */
  authoredMass: number | undefined;
  /** Authored body-local centre of mass, if any (`setBodyMassProperties`). */
  authoredCenter: [number, number] | undefined;
  /** Authored rotational inertia about the centre of mass, if any. */
  authoredInertia: number | undefined;
  readonly colliders: ColliderRecord[];
  /** Pending `"kinematic-position"` target: x, y, angle. */
  target: [number, number, number] | undefined;
}

interface ColliderRecord {
  readonly id: number;
  readonly bodyId: number;
  fixtures: b2Fixture[];
  readonly sensor: boolean;
  alive: boolean;
}

/** Everything needed to (re)build a joint: Box2D joints are immutable in shape. */
interface JointConfig {
  anchorA: [number, number];
  anchorB: [number, number];
  collide: boolean;
  /** Prismatic axis in bodyA's frame (unit). */
  axis: [number, number];
  /** `-1` for a revolute joint authored about `-Z`; mirrors limits and motor. */
  sign: 1 | -1;
  referenceAngle: number;
  limits: { min: number; max: number } | undefined;
  motor: SolverJointMotor | undefined;
  maxLength: number;
  restLength: number;
  stiffness: number;
  damping: number;
}

interface JointRecord {
  readonly id: number;
  readonly type: ShippedJointType;
  readonly bodyA: BodyRecord;
  readonly bodyB: BodyRecord;
  readonly config: JointConfig;
  joint: b2Joint;
  alive: boolean;
}

interface PairRecord {
  readonly a: ColliderRecord;
  readonly b: ColliderRecord;
  readonly trigger: boolean;
  /** Touching Box2D contacts between the two colliders (capsules have several). */
  readonly contacts: Set<b2Contact>;
}

/** The `b2Body` members the snapshot reads and writes (private in the typings). */
interface BodyInternals {
  m_sleepTime: number;
  m_xf: b2Transform;
  m_sweep: {
    localCenter: b2Vec2;
    c0: b2Vec2;
    c: b2Vec2;
    a0: number;
    a: number;
    alpha0: number;
  };
  m_linearVelocity: b2Vec2;
  m_angularVelocity: number;
  m_force: b2Vec2;
  m_torque: number;
  m_mass: number;
  m_invMass: number;
  m_I: number;
  m_invI: number;
}

const BODY_TYPES: readonly BodyType[] = [
  "static",
  "dynamic",
  "kinematic-velocity",
  "kinematic-position",
];

interface SnapshotFixture {
  shape: b2Shape;
  friction: number;
  restitution: number;
  restitutionThreshold: number;
  density: number;
  categoryBits: number;
  maskBits: number;
  groupIndex: number;
}

interface SnapshotData {
  gravity: [number, number];
  sleepingEnabled: boolean;
  velocityIterations: number;
  nextBodyId: number;
  nextColliderId: number;
  nextJointId: number;
  bodies: {
    id: number;
    type: BodyType;
    awake: boolean;
    sleeping: boolean;
    sleepTime: number;
    xf: number[];
    sweep: number[];
    dynamics: number[];
    bullet: boolean;
    authoredMass: number | undefined;
    authoredCenter: [number, number] | undefined;
    authoredInertia: number | undefined;
    target: [number, number, number] | undefined;
  }[];
  colliders: {
    id: number;
    bodyId: number;
    sensor: boolean;
    fixtures: SnapshotFixture[];
  }[];
  joints: {
    id: number;
    type: ShippedJointType;
    bodyA: number;
    bodyB: number;
    config: JointConfig;
  }[];
}

function writeOptional(
  w: SnapshotWriter,
  values: readonly number[] | undefined,
): void {
  w.bool(values !== undefined);
  if (values !== undefined) {
    for (const v of values) {
      w.f64(v);
    }
  }
}

function readNumbers(r: SnapshotReader, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(r.f64());
  }
  return out;
}

function readOptional(r: SnapshotReader, count: number): number[] | undefined {
  return r.bool() ? readNumbers(r, count) : undefined;
}

function notImplemented(feature: string): FourError {
  return new FourError(
    "NOT_IMPLEMENTED",
    `Box2dAdapter does not implement ${feature} yet (W8.1 skeleton; a later wave-8 packet adds it). See capabilities (§37).`,
    { context: { adapter: ADAPTER_NAME, feature } },
  );
}

function checkVector2(field: string, value: Vector3Input): void {
  const z = "z" in value ? value.z : 0;
  if (z !== 0) {
    throw new FourError(
      ADAPTER_ERROR_CODE,
      `A "2d" world has no z axis, so ${field}.z must be 0; got ${String(z)} (§21, §85).`,
      { context: { field, z } },
    );
  }
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new FourError(
      ADAPTER_ERROR_CODE,
      `${field} must be finite; got (${String(value.x)}, ${String(value.y)}) (§85).`,
      { context: { field } },
    );
  }
}

/** A rigid 2D placement used to apply a collider's local offset to shape points. */
interface Placement {
  readonly x: number;
  readonly y: number;
  readonly cos: number;
  readonly sin: number;
  readonly angle: number;
}

const IDENTITY: Placement = { x: 0, y: 0, cos: 1, sin: 0, angle: 0 };

function place(p: Placement, x: number, y: number): { x: number; y: number } {
  return { x: p.x + p.cos * x - p.sin * y, y: p.y + p.sin * x + p.cos * y };
}

function boxPolygon(
  p: Placement,
  hx: number,
  hy: number,
  cx: number,
  cy: number,
): b2PolygonShape {
  const shape = new b2PolygonShape();
  shape.Set([
    place(p, cx - hx, cy - hy),
    place(p, cx + hx, cy - hy),
    place(p, cx + hx, cy + hy),
    place(p, cx - hx, cy + hy),
  ]);
  return shape;
}

function circleShape(
  p: Placement,
  radius: number,
  cx: number,
  cy: number,
): b2CircleShape {
  const shape = new b2CircleShape(radius);
  const c = place(p, cx, cy);
  shape.Set(c, radius);
  return shape;
}

/**
 * 2D §37 adapter over `@box2d/core`. See the module header for scope.
 */
export class Box2dAdapter
  implements
    PhysicsSolverAdapter,
    SolverBodyAccess,
    SolverBodyTuningAccess,
    SolverJointAccess
{
  readonly name: string = ADAPTER_NAME;

  readonly capabilities: PhysicsCapabilities = BOX2D_CAPABILITIES;

  get version(): string {
    return BOX2D_CORE_VERSION;
  }

  #world: b2World | undefined;
  #initializeStarted = false;
  #disposed = false;
  #nextBodyId = 1;
  #nextColliderId = 1;
  #nextJointId = 1;
  #sleepingEnabled = true;
  #velocityIterations = DEFAULT_VELOCITY_ITERATIONS;
  #stayEvents = true;
  #pendingEvents: PhysicsEvent[] = [];
  #suppressContactEvents = false;

  readonly #bodies = new Map<number, BodyRecord>();
  readonly #colliders = new Map<number, ColliderRecord>();
  readonly #joints = new Map<number, JointRecord>();
  readonly #recordByFixture = new Map<b2Fixture, ColliderRecord>();
  readonly #activePairs = new Map<number, PairRecord>();
  readonly #startedKeys = new Set<number>();
  readonly #stoppedKeys = new Set<number>();
  readonly #started: PairRecord[] = [];
  readonly #stopped: PairRecord[] = [];
  readonly #scratchVector3 = new Vector3();
  readonly #scratchQuaternion = new Quaternion();
  readonly #worldManifold = new b2WorldManifold();
  readonly #scratchB2 = new b2Vec2();

  initialize(options: PhysicsWorldOptions): void {
    this.#assertNotDisposed();
    if (this.#initializeStarted) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        "Box2dAdapter.initialize was called twice; one adapter owns one world (§37). Create a second adapter instead.",
      );
    }
    this.#initializeStarted = true;
    validatePhysicsWorldOptions(options);
    if (options.dimension !== "2d") {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `Box2dAdapter simulates "2d" worlds only; got ${JSON.stringify(options.dimension)} (§21, §37).`,
        { context: { dimension: options.dimension } },
      );
    }
    if (
      options.determinism !== undefined &&
      DETERMINISM_LEVELS.indexOf(options.determinism) >
        DETERMINISM_LEVELS.indexOf(BOX2D_CAPABILITIES.determinism)
    ) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `Box2dAdapter declares determinism ${JSON.stringify(BOX2D_CAPABILITIES.determinism)} and the world asked for ${JSON.stringify(options.determinism)} (§33, §37).`,
        { context: { requested: options.determinism } },
      );
    }
    const gravity = resolveGravity("2d", options.gravity, this.#scratchVector3);
    const world = b2World.Create({ x: gravity.x, y: gravity.y });
    const sleeping = resolveSleepingConfig(options.sleeping);
    this.#sleepingEnabled = sleeping.enabled;
    world.SetAllowSleeping(sleeping.enabled);
    if (options.solverIterations !== undefined) {
      this.#velocityIterations = options.solverIterations;
    }
    world.SetContactListener(this.#createListener());
    this.#world = world;
  }

  createBody(desc: RigidBodyDescriptor): PhysicsBodyHandle {
    const world = this.#requireWorld();
    validateRigidBodyDescriptor(desc, "2d");
    if (desc.centerOfMass !== undefined || desc.inertiaTensor !== undefined) {
      throw notImplemented("authored centerOfMass / inertiaTensor");
    }
    const ccd =
      desc.ccdMode ??
      (desc.continuousCollisionDetection ? "swept" : "disabled");
    if (ccd === "speculative") {
      throw notImplemented('ccdMode "speculative"');
    }
    const position = { x: 0, y: 0 };
    if (desc.position !== undefined) {
      checkVector2("position", desc.position);
      position.x = desc.position.x;
      position.y = desc.position.y;
    }
    let linear = { x: 0, y: 0 };
    if (desc.linearVelocity !== undefined) {
      checkVector2("linearVelocity", desc.linearVelocity);
      linear = { x: desc.linearVelocity.x, y: desc.linearVelocity.y };
    }
    const body = world.CreateBody({
      type: toB2Type(desc.type),
      position,
      angle: desc.rotation === undefined ? 0 : this.#angleOf(desc.rotation),
      linearVelocity: linear,
      angularVelocity:
        desc.angularVelocity === undefined
          ? 0
          : resolveAngularVelocity(
              "2d",
              desc.angularVelocity,
              this.#scratchVector3,
            ).z,
      linearDamping: desc.linearDamping ?? 0,
      angularDamping: desc.angularDamping ?? 0,
      gravityScale: desc.gravityScale ?? 1,
      allowSleep: this.#sleepingEnabled,
      bullet: ccd === "swept",
    });
    const record: BodyRecord = {
      id: this.#nextBodyId,
      body,
      type: desc.type,
      alive: true,
      sleeping: false,
      authoredMass: desc.mass,
      authoredCenter: undefined,
      authoredInertia: undefined,
      colliders: [],
      target: undefined,
    };
    this.#nextBodyId += 1;
    this.#bodies.set(record.id, record);
    return record as unknown as PhysicsBodyHandle;
  }

  destroyBody(handle: PhysicsBodyHandle): void {
    const record = this.#requireBody(handle);
    for (const collider of record.colliders) {
      this.#dropCollider(collider);
    }
    for (const joint of [...this.#joints.values()]) {
      if (joint.bodyA === record || joint.bodyB === record) {
        // Box2D destroys attached joints with the body; mirror it in the registry.
        joint.alive = false;
        this.#joints.delete(joint.id);
      }
    }
    this.#suppressContactEvents = true;
    this.#requireWorld().DestroyBody(record.body);
    this.#suppressContactEvents = false;
    record.alive = false;
    this.#bodies.delete(record.id);
  }

  createCollider(desc: ColliderDescriptor): PhysicsColliderHandle {
    this.#requireWorld();
    validateColliderDescriptor(desc, "2d");
    const bodyRecord = this.#requireBody(desc.body);
    const placement = this.#placementOf(desc);
    const shapes = this.#shapesOf(desc, placement);

    const sensor = desc.sensor ?? false;
    const groups = desc.collisionGroups ?? ALL_COLLISION_GROUPS;
    const mask = desc.collisionMask ?? ALL_COLLISION_GROUPS;
    const friction =
      desc.friction ?? desc.material?.friction ?? DEFAULT_FRICTION;
    const restitution =
      desc.restitution ?? desc.material?.restitution ?? DEFAULT_RESTITUTION;
    const density = resolveDensity(desc.density, desc.material);

    const fixtures = shapes.map((shape) =>
      bodyRecord.body.CreateFixture({
        shape,
        friction,
        restitution,
        density,
        isSensor: sensor,
        filter: { categoryBits: groups, maskBits: mask },
      }),
    );
    const record: ColliderRecord = {
      id: this.#nextColliderId,
      bodyId: bodyRecord.id,
      fixtures,
      sensor,
      alive: true,
    };
    this.#nextColliderId += 1;
    this.#colliders.set(record.id, record);
    for (const fixture of fixtures) {
      this.#recordByFixture.set(fixture, record);
    }
    bodyRecord.colliders.push(record);
    this.#applyAuthoredMass(bodyRecord);
    return record as unknown as PhysicsColliderHandle;
  }

  destroyCollider(handle: PhysicsColliderHandle): void {
    const record = this.#requireCollider(handle);
    const body = this.#bodies.get(record.bodyId) as BodyRecord;
    this.#suppressContactEvents = true;
    for (const fixture of record.fixtures) {
      body.body.DestroyFixture(fixture);
    }
    this.#suppressContactEvents = false;
    this.#dropCollider(record);
    body.colliders.splice(body.colliders.indexOf(record), 1);
    this.#applyAuthoredMass(body);
  }

  /**
   * Builds a §28 joint. Anchors are body-local (the engine converts world to
   * local once, in `PhysicsWorld.addJoint`).
   *
   * | engine     | Box2D                                                      |
   * | ---------- | ---------------------------------------------------------- |
   * | `fixed`    | `b2WeldJoint` (rigid), reference angle = `angleB - angleA` |
   * | `revolute` | `b2RevoluteJoint`, reference angle 0 (limits are the       |
   * |            | absolute relative angle, as in the Rapier adapters)        |
   * | `prismatic`| `b2PrismaticJoint`, axis in bodyA's frame, reference angle |
   * |            | = `angleB - angleA`                                        |
   * | `rope`     | `b2DistanceJoint`, no spring, `[slop, maxLength]`          |
   * | `spring`   | `b2DistanceJoint` with stiffness (N/m) and damping (N s/m) |
   *
   * A revolute joint about `-Z` mirrors its limits and motor rate. Contacts
   * between the joined bodies are off unless `collisionEnabled` (§28).
   */
  createJoint(desc: JointDescriptor): PhysicsJointHandle {
    this.#requireWorld();
    validateJointDescriptor(desc, "2d");
    const bodyA = this.#requireBody(desc.bodyA);
    const bodyB = this.#requireBody(desc.bodyB);
    const config: JointConfig = {
      anchorA: this.#anchorOf("anchorA", desc.anchorA),
      anchorB: this.#anchorOf("anchorB", desc.anchorB),
      collide: desc.collisionEnabled ?? false,
      axis: [1, 0],
      sign: 1,
      referenceAngle: 0,
      limits: undefined,
      motor: undefined,
      maxLength: 0,
      restLength: 0,
      stiffness: 0,
      damping: 0,
    };
    switch (desc.type) {
      case "fixed":
        config.referenceAngle = bodyB.body.GetAngle() - bodyA.body.GetAngle();
        break;
      case "revolute":
        config.sign = revoluteSign(desc.axis);
        config.limits = desc.limits && { ...desc.limits };
        config.motor = desc.motor && {
          enabled: desc.motor.enabled !== false,
          targetVelocity: desc.motor.targetVelocity,
          maxEffort: desc.motor.maxTorque,
        };
        break;
      case "prismatic": {
        checkVector2("axis", desc.axis);
        const length = Math.hypot(desc.axis.x, desc.axis.y);
        if (length === 0) {
          throw new FourError(
            ADAPTER_ERROR_CODE,
            "axis must be a non-zero direction in the XY plane (§21, §28, §85).",
            { context: { field: "axis" } },
          );
        }
        config.axis = [desc.axis.x / length, desc.axis.y / length];
        config.referenceAngle = bodyB.body.GetAngle() - bodyA.body.GetAngle();
        config.limits = desc.limits && { ...desc.limits };
        config.motor = desc.motor && {
          enabled: desc.motor.enabled !== false,
          targetVelocity: desc.motor.targetVelocity,
          maxEffort: desc.motor.maxForce,
        };
        break;
      }
      case "rope":
        config.maxLength = desc.maxLength;
        break;
      case "spring":
        config.restLength = desc.restLength;
        config.stiffness = desc.stiffness;
        config.damping = desc.damping ?? 0;
        break;
      default:
        throw new FourError(
          ADAPTER_ERROR_CODE,
          `Box2dAdapter builds ${BOX2D_JOINT_TYPES.join(", ")} joints and not ${JSON.stringify((desc as JointDescriptor).type)} (§21, §28).`,
          {
            context: {
              adapter: ADAPTER_NAME,
              jointType: (desc as JointDescriptor).type,
            },
          },
        );
    }
    const record: JointRecord = {
      id: this.#nextJointId,
      type: desc.type,
      bodyA,
      bodyB,
      config,
      joint: undefined as unknown as b2Joint,
      alive: true,
    };
    record.joint = this.#buildJoint(record);
    this.#nextJointId += 1;
    this.#joints.set(record.id, record);
    return record as unknown as PhysicsJointHandle;
  }

  /** Destroys a joint and wakes both bodies, as Box2D does. The handle is stale afterwards. */
  destroyJoint(handle: PhysicsJointHandle): void {
    const record = this.#requireJoint(handle);
    this.#requireWorld().DestroyJoint(record.joint);
    record.alive = false;
    this.#joints.delete(record.id);
  }

  step(delta: number): void {
    const world = this.#requireWorld();
    if (!Number.isFinite(delta) || delta <= 0) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `step(delta) takes a finite positive number of seconds (§7a, §10); got ${String(delta)}.`,
        { context: { adapter: ADAPTER_NAME, delta } },
      );
    }
    this.#started.length = 0;
    this.#stopped.length = 0;
    this.#startedKeys.clear();
    this.#stoppedKeys.clear();

    for (const record of this.#bodies.values()) {
      if (record.target !== undefined) {
        const [x, y, angle] = record.target;
        const p = record.body.GetPosition();
        record.body.SetLinearVelocity({
          x: (x - p.x) / delta,
          y: (y - p.y) / delta,
        });
        record.body.SetAngularVelocity(
          wrapAngle(angle - record.body.GetAngle()) / delta,
        );
        record.body.SetAwake(true);
      }
    }
    world.Step(delta, {
      velocityIterations: this.#velocityIterations,
      positionIterations: POSITION_ITERATIONS,
    });
    for (const record of this.#bodies.values()) {
      if (record.target !== undefined) {
        const [x, y, angle] = record.target;
        record.body.SetTransformXY(x, y, angle);
        record.body.SetLinearVelocity({ x: 0, y: 0 });
        record.body.SetAngularVelocity(0);
        record.target = undefined;
      }
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

  syncSceneToSolver(): void {
    this.#requireWorld();
  }

  syncSolverToScene(): void {
    this.#requireWorld();
  }

  /**
   * Casts a ray (§30) through `b2World.RayCast`.
   *
   * Filtering is `@fourjs/physics`'s `passesQueryFilter` (the same code the
   * Rapier adapters use), not Box2D's filter words. `mode: "first"` clips the
   * ray at every accepted hit so the nearest one wins; `"all"` collects one hit
   * per collider (a capsule's three fixtures report their nearest), applies
   * `maxHits` in traversal order, then sorts if asked.
   *
   * Box2D rule, inherited: a ray that **starts inside** a shape does not hit
   * that shape. The query never mutates the world (it reads the broad phase).
   */
  raycast(query: RaycastQuery): RaycastHit[] {
    const world = this.#requireWorld();
    const options = resolveQueryOptions(query);
    const { x: ox, y: oy } = this.#queryPoint("origin", query.origin);
    const [dx, dy] = this.#queryDirection("raycast", query.direction);
    const length = this.#sweepLength(ox, oy, query.maxDistance, 0);
    if (length === 0) {
      return [];
    }
    const p2 = { x: ox + dx * length, y: oy + dy * length };
    const best = new Map<
      ColliderRecord,
      { fraction: number; nx: number; ny: number }
    >();
    world.RayCast({ x: ox, y: oy }, p2, (fixture, _point, normal, fraction) => {
      const record = this.#recordByFixture.get(fixture);
      if (
        record === undefined ||
        !this.#passesFilter(record, fixture, options)
      ) {
        return -1;
      }
      const known = best.get(record);
      if (known === undefined || fraction < known.fraction) {
        best.set(record, { fraction, nx: normal.x, ny: normal.y });
      }
      // "first": clip the ray to this hit; "all": keep going.
      return options.mode === "first" ? fraction : 1;
    });
    let entries = [...best.entries()];
    if (options.mode === "first") {
      let nearest = entries[0];
      for (const entry of entries) {
        if (entry[1].fraction < nearest[1].fraction) {
          nearest = entry;
        }
      }
      entries = nearest === undefined ? [] : [nearest];
    }
    const hits: RaycastHit[] = entries
      .slice(0, options.maxHits)
      .map(([record, h]) => {
        const distance = h.fraction * length;
        return {
          collider: record as unknown as PhysicsColliderHandle,
          body: this.#bodyHandleOf(record),
          point: new Vector3(ox + dx * distance, oy + dy * distance, 0),
          normal: new Vector3(h.nx, h.ny, 0),
          distance,
        };
      });
    return options.sorted ? sortHitsByDistance(hits) : hits;
  }

  /**
   * Sweeps a shape (§30) with `b2ShapeCast` (GJK ray-cast, Gino van den
   * Bergen) against every fixture the swept AABB reaches. Returns one hit per
   * collider; `mode: "first"` keeps only the nearest.
   *
   * Conventions, all pinned by tests: `distance` is how far the shape travelled
   * before touching; `point` is the witness on the hit collider; `normal` points
   * out of the hit collider. A shape already overlapping at the start reports
   * `distance: 0`, `normal` opposite the sweep and `point` its start centre
   * (Box2D's cast reports nothing for initial overlap, so this adapter
   * synthesises the record `ShapeCastHit` documents). Sweeps are translations
   * only: the shape does not rotate while moving. The query reads the broad
   * phase and never mutates the world.
   */
  shapeCast(query: ShapeCastQuery): ShapeCastHit[] {
    const world = this.#requireWorld();
    const options = resolveQueryOptions(query);
    validateQueryShape(query.shape, "2d");
    const origin = this.#queryPoint("position", query.position);
    const [dx, dy] = this.#queryDirection("shapeCast", query.direction);
    const angle =
      query.rotation === undefined ? 0 : this.#angleOf(query.rotation);
    const shapes = this.#shapesOf(
      { shape: query.shape } as ColliderDescriptor,
      {
        x: origin.x,
        y: origin.y,
        cos: Math.cos(angle),
        sin: Math.sin(angle),
        angle,
      },
    );
    const extent = this.#shapesExtent(shapes);
    const length = this.#sweepLength(
      origin.x,
      origin.y,
      query.maxDistance,
      extent,
    );
    const identity = new b2Transform();
    identity.SetIdentity();
    const swept = new b2AABB();
    const box = new b2AABB();
    swept.lowerBound.Set(Infinity, Infinity);
    swept.upperBound.Set(-Infinity, -Infinity);
    for (const shape of shapes) {
      shape.ComputeAABB(box, identity, 0);
      for (const t of [0, length]) {
        swept.lowerBound.Set(
          Math.min(swept.lowerBound.x, box.lowerBound.x + dx * t),
          Math.min(swept.lowerBound.y, box.lowerBound.y + dy * t),
        );
        swept.upperBound.Set(
          Math.max(swept.upperBound.x, box.upperBound.x + dx * t),
          Math.max(swept.upperBound.y, box.upperBound.y + dy * t),
        );
      }
    }
    const best = new Map<ColliderRecord, ShapeCastHit>();
    const input = new b2ShapeCastInput();
    const output = new b2ShapeCastOutput();
    input.transformB.SetIdentity();
    input.translationB.Set(dx * length, dy * length);
    world.QueryAABB(swept, (fixture) => {
      const record = this.#recordByFixture.get(fixture);
      if (
        record === undefined ||
        !this.#passesFilter(record, fixture, options)
      ) {
        return true;
      }
      const xfA = fixture.GetBody().GetTransform();
      input.transformA.Copy(xfA);
      input.proxyA.SetShape(fixture.GetShape(), 0);
      for (const shape of shapes) {
        input.proxyB.SetShape(shape, 0);
        let hit: ShapeCastHit | undefined;
        if (b2TestOverlap(fixture.GetShape(), 0, shape, 0, xfA, identity)) {
          hit = {
            collider: record as unknown as PhysicsColliderHandle,
            body: this.#bodyHandleOf(record),
            point: new Vector3(origin.x, origin.y, 0),
            normal: new Vector3(-dx, -dy, 0),
            distance: 0,
          };
        } else if (length > 0 && b2ShapeCast(output, input)) {
          hit = {
            collider: record as unknown as PhysicsColliderHandle,
            body: this.#bodyHandleOf(record),
            point: this.#witness(
              input,
              output.lambda,
              dx * length,
              dy * length,
            ),
            normal: new Vector3(output.normal.x, output.normal.y, 0),
            distance: output.lambda * length,
          };
        }
        const known = best.get(record);
        if (
          hit !== undefined &&
          (known === undefined || hit.distance < known.distance)
        ) {
          best.set(record, hit);
        }
      }
      return true;
    });
    let hits = [...best.values()];
    if (options.mode === "first") {
      hits = sortHitsByDistance(hits).slice(0, 1);
    } else {
      hits = hits.slice(0, options.maxHits);
      if (options.sorted) {
        sortHitsByDistance(hits);
      }
    }
    return hits;
  }

  /**
   * Tests a static shape for overlaps (§30): `QueryFixtureShape` (AABB query,
   * then Box2D's exact `b2TestOverlap` on the two shapes). A capsule collider
   * is one hit however many of its three fixtures overlap. Hits are in
   * broad-phase traversal order; `sorted` does nothing (no distance).
   */
  overlap(query: OverlapQuery): OverlapHit[] {
    const world = this.#requireWorld();
    const options = resolveQueryOptions(query);
    validateQueryShape(query.shape, "2d");
    const origin = this.#queryPoint("position", query.position);
    const angle =
      query.rotation === undefined ? 0 : this.#angleOf(query.rotation);
    const shapes = this.#shapesOf(
      { shape: query.shape } as ColliderDescriptor,
      {
        x: origin.x,
        y: origin.y,
        cos: Math.cos(angle),
        sin: Math.sin(angle),
        angle,
      },
    );
    const identity = new b2Transform();
    identity.SetIdentity();
    const found = new Set<ColliderRecord>();
    for (const shape of shapes) {
      world.QueryFixtureShape(shape, 0, identity, (fixture) => {
        const record = this.#recordByFixture.get(fixture);
        if (
          record !== undefined &&
          this.#passesFilter(record, fixture, options)
        ) {
          found.add(record);
        }
        return true;
      });
    }
    return [...found].slice(0, options.maxHits).map((record) => ({
      collider: record as unknown as PhysicsColliderHandle,
      body: this.#bodyHandleOf(record),
    }));
  }

  /**
   * Tests a point (§30): every collider that contains it (`TestPoint` per
   * fixture after a point-AABB query). `distance` is `0` and `point` the query
   * point, as `PointHit` documents for a contained point.
   */
  pointQuery(query: PointQuery): PointHit[] {
    const world = this.#requireWorld();
    const options = resolveQueryOptions(query);
    const p = this.#queryPoint("point", query.point);
    const found = new Set<ColliderRecord>();
    world.QueryFixturePoint(p, (fixture) => {
      const record = this.#recordByFixture.get(fixture);
      if (
        record !== undefined &&
        this.#passesFilter(record, fixture, options)
      ) {
        found.add(record);
      }
      return true;
    });
    return [...found].slice(0, options.maxHits).map((record) => ({
      collider: record as unknown as PhysicsColliderHandle,
      body: this.#bodyHandleOf(record),
      point: new Vector3(p.x, p.y, 0),
      distance: 0,
    }));
  }

  /**
   * Serialises the whole world (§34) into the explicit float64 envelope of
   * `snapshot-codec.ts`: header (magic, format, adapter name, version), world
   * (gravity, sleeping, iterations, the three id counters), then every body,
   * collider (with its fixtures' shapes verbatim) and joint in ascending id
   * order. Body capture includes the exact `b2Sweep`/`b2Transform`, velocities,
   * pending force and torque, sleep state and sleep timer, mass data, damping,
   * gravity scale and bullet flag.
   *
   * **Not captured, and why it matters** (see {@link Box2dAdapter.restoreSnapshot}):
   * contact manifolds / accumulated contact impulses (warm start), joint
   * accumulated impulses, and the broad-phase tree shape. Pending collision
   * events (`drainEvents` backlog) are not part of solver state and are not
   * captured. Reading changes nothing in the world.
   */
  createSnapshot(): ArrayBuffer {
    const world = this.#requireWorld();
    const w = new SnapshotWriter();
    w.u32(SNAPSHOT_MAGIC);
    w.u32(SNAPSHOT_FORMAT_VERSION);
    w.str(this.name);
    w.str(this.version);
    const g = world.GetGravity();
    w.f64(g.x);
    w.f64(g.y);
    w.bool(this.#sleepingEnabled);
    w.u32(this.#velocityIterations);
    w.u32(this.#nextBodyId);
    w.u32(this.#nextColliderId);
    w.u32(this.#nextJointId);

    w.u32(this.#bodies.size);
    for (const record of this.#bodies.values()) {
      const b = record.body;
      const internals = b as unknown as BodyInternals;
      w.u32(record.id);
      w.str(record.type);
      w.bool(b.IsAwake());
      w.bool(record.sleeping);
      w.f64(internals.m_sleepTime);
      const xf = internals.m_xf;
      for (const v of [xf.p.x, xf.p.y, xf.q.s, xf.q.c]) {
        w.f64(v);
      }
      const sw = internals.m_sweep;
      for (const v of [
        sw.localCenter.x,
        sw.localCenter.y,
        sw.c0.x,
        sw.c0.y,
        sw.c.x,
        sw.c.y,
        sw.a0,
        sw.a,
        sw.alpha0,
      ]) {
        w.f64(v);
      }
      const lv = b.GetLinearVelocity();
      for (const v of [
        lv.x,
        lv.y,
        b.GetAngularVelocity(),
        internals.m_force.x,
        internals.m_force.y,
        internals.m_torque,
        b.GetLinearDamping(),
        b.GetAngularDamping(),
        b.GetGravityScale(),
        internals.m_mass,
        internals.m_invMass,
        internals.m_I,
        internals.m_invI,
      ]) {
        w.f64(v);
      }
      w.bool(b.IsBullet());
      writeOptional(
        w,
        record.authoredMass === undefined ? undefined : [record.authoredMass],
      );
      writeOptional(w, record.authoredCenter);
      writeOptional(
        w,
        record.authoredInertia === undefined
          ? undefined
          : [record.authoredInertia],
      );
      writeOptional(w, record.target);
    }

    w.u32(this.#colliders.size);
    for (const record of this.#colliders.values()) {
      w.u32(record.id);
      w.u32(record.bodyId);
      w.bool(record.sensor);
      w.u32(record.fixtures.length);
      for (const fixture of record.fixtures) {
        const shape = fixture.GetShape();
        if (shape instanceof b2CircleShape) {
          w.u8(0);
          w.f64(shape.m_p.x);
          w.f64(shape.m_p.y);
          w.f64(shape.m_radius);
        } else {
          const polygon = shape as b2PolygonShape;
          w.u8(1);
          w.u32(polygon.m_count);
          for (let i = 0; i < polygon.m_count; i += 1) {
            w.f64(polygon.m_vertices[i].x);
            w.f64(polygon.m_vertices[i].y);
            w.f64(polygon.m_normals[i].x);
            w.f64(polygon.m_normals[i].y);
          }
          w.f64(polygon.m_centroid.x);
          w.f64(polygon.m_centroid.y);
          w.f64(polygon.m_radius);
        }
        const filter = fixture.GetFilterData();
        for (const v of [
          fixture.GetFriction(),
          fixture.GetRestitution(),
          fixture.GetRestitutionThreshold(),
          fixture.GetDensity(),
          filter.categoryBits,
          filter.maskBits,
          filter.groupIndex,
        ]) {
          w.f64(v);
        }
      }
    }

    w.u32(this.#joints.size);
    for (const record of this.#joints.values()) {
      const c = record.config;
      w.u32(record.id);
      w.str(record.type);
      w.u32(record.bodyA.id);
      w.u32(record.bodyB.id);
      for (const v of [
        c.anchorA[0],
        c.anchorA[1],
        c.anchorB[0],
        c.anchorB[1],
        c.axis[0],
        c.axis[1],
        c.sign,
        c.referenceAngle,
        c.maxLength,
        c.restLength,
        c.stiffness,
        c.damping,
      ]) {
        w.f64(v);
      }
      w.bool(c.collide);
      writeOptional(w, c.limits && [c.limits.min, c.limits.max]);
      writeOptional(
        w,
        c.motor && [
          Number(c.motor.enabled),
          c.motor.targetVelocity,
          c.motor.maxEffort,
        ],
      );
    }
    return w.finish();
  }

  /**
   * Replaces the world with a snapshot taken by {@link Box2dAdapter.createSnapshot}
   * (§34). The envelope is fully decoded and cross-checked **before** anything
   * is touched, so a refused buffer leaves the live world intact.
   *
   * Refused: a buffer that is not a Box2D envelope (wrong magic / format /
   * adapter name / adapter version / truncated / dangling body references).
   *
   * Handle identity: bodies, colliders and joints whose id survives keep their
   * existing handle object (re-pointed at the rebuilt Box2D objects), so the
   * engine's node-to-body maps stay valid; ids the snapshot lacks go stale and
   * ids the live adapter lacks get fresh handles. Ids and the three id counters
   * are restored, so a later `createBody` continues the original sequence.
   *
   * What §34 guarantees here and what it does not:
   * - Holds: body/collider/joint ids and order, every body's pose, velocities,
   *   sleep state and timer, mass data, shapes, materials and filters, joint
   *   definitions, and the §33 checksum of the restored state equals the
   *   captured one.
   * - Does NOT hold: warm start. Box2D keeps contact manifolds (accumulated
   *   normal / tangent impulses), joint impulses and a history-dependent
   *   broad-phase tree; none are exposed for restoration, so the first step
   *   after a restore starts those from zero / fresh. Stepping after a restore
   *   is bit-identical to continuous stepping only from a state where that
   *   history is irrelevant: no touching contacts and no joint impulses at the
   *   snapshot (bodies in free flight, or asleep, with contacts forming only
   *   after the snapshot between at most one pair at a time). Otherwise the
   *   restored run is a valid simulation but not a bit-for-bit continuation.
   * - Collision events: pairs touching at the snapshot report `collisionstart`
   *   again on the first step after a restore (the contacts are new).
   */
  restoreSnapshot(snapshot: ArrayBuffer): void {
    this.#requireWorld();
    const data = this.#decodeSnapshot(snapshot);

    const world = b2World.Create({ x: data.gravity[0], y: data.gravity[1] });
    this.#sleepingEnabled = data.sleepingEnabled;
    this.#velocityIterations = data.velocityIterations;
    world.SetAllowSleeping(data.sleepingEnabled);
    world.SetContactListener(this.#createListener());
    this.#world = world;

    for (const record of this.#bodies.values()) {
      record.alive = false;
    }
    for (const record of this.#colliders.values()) {
      record.alive = false;
    }
    for (const record of this.#joints.values()) {
      record.alive = false;
    }
    const oldBodies = new Map(this.#bodies);
    const oldColliders = new Map(this.#colliders);
    const oldJoints = new Map(this.#joints);
    this.#bodies.clear();
    this.#colliders.clear();
    this.#joints.clear();
    this.#recordByFixture.clear();
    this.#activePairs.clear();
    this.#startedKeys.clear();
    this.#stoppedKeys.clear();
    this.#started.length = 0;
    this.#stopped.length = 0;
    this.#pendingEvents = [];
    this.#suppressContactEvents = false;
    this.#nextBodyId = data.nextBodyId;
    this.#nextColliderId = data.nextColliderId;
    this.#nextJointId = data.nextJointId;

    for (const d of data.bodies) {
      const body = world.CreateBody({
        type: toB2Type(d.type),
        position: { x: d.xf[0], y: d.xf[1] },
        angle: d.sweep[7],
        allowSleep: data.sleepingEnabled,
      });
      let record = oldBodies.get(d.id);
      if (record === undefined) {
        record = {
          id: d.id,
          body,
          type: d.type,
          alive: true,
          sleeping: d.sleeping,
          authoredMass: undefined,
          authoredCenter: undefined,
          authoredInertia: undefined,
          colliders: [],
          target: undefined,
        };
      }
      record.body = body;
      record.type = d.type;
      record.alive = true;
      record.sleeping = d.sleeping;
      record.authoredMass = d.authoredMass;
      record.authoredCenter = d.authoredCenter;
      record.authoredInertia = d.authoredInertia;
      record.target = d.target;
      record.colliders.length = 0;
      this.#bodies.set(d.id, record);
    }

    for (const d of data.colliders) {
      const bodyRecord = this.#bodies.get(d.bodyId) as BodyRecord;
      const fixtures = d.fixtures.map((f) =>
        bodyRecord.body.CreateFixture({
          shape: f.shape,
          friction: f.friction,
          restitution: f.restitution,
          restitutionThreshold: f.restitutionThreshold,
          density: f.density,
          isSensor: d.sensor,
          filter: {
            categoryBits: f.categoryBits,
            maskBits: f.maskBits,
            groupIndex: f.groupIndex,
          },
        }),
      );
      let record = oldColliders.get(d.id);
      if (record === undefined || record.bodyId !== d.bodyId) {
        record = {
          id: d.id,
          bodyId: d.bodyId,
          fixtures,
          sensor: d.sensor,
          alive: true,
        };
      }
      record.fixtures = fixtures;
      record.alive = true;
      (record as { sensor: boolean }).sensor = d.sensor;
      this.#colliders.set(d.id, record);
      for (const fixture of fixtures) {
        this.#recordByFixture.set(fixture, record);
      }
      bodyRecord.colliders.push(record);
    }

    // Body state goes in last: creating fixtures recomputes mass data and the
    // sweep, and the captured values are the exact ones to land on.
    for (const d of data.bodies) {
      const record = this.#bodies.get(d.id) as BodyRecord;
      const b = record.body;
      const internals = b as unknown as BodyInternals;
      if (b.IsAwake() !== d.awake) {
        b.SetAwake(d.awake);
      }
      internals.m_xf.p.Set(d.xf[0], d.xf[1]);
      internals.m_xf.q.s = d.xf[2];
      internals.m_xf.q.c = d.xf[3];
      internals.m_sweep.localCenter.Set(d.sweep[0], d.sweep[1]);
      internals.m_sweep.c0.Set(d.sweep[2], d.sweep[3]);
      internals.m_sweep.c.Set(d.sweep[4], d.sweep[5]);
      internals.m_sweep.a0 = d.sweep[6];
      internals.m_sweep.a = d.sweep[7];
      internals.m_sweep.alpha0 = d.sweep[8];
      const [
        vx,
        vy,
        av,
        fx,
        fy,
        torque,
        ld,
        ad,
        gs,
        mass,
        invMass,
        inertia,
        invI,
      ] = d.dynamics;
      internals.m_linearVelocity.Set(vx, vy);
      internals.m_angularVelocity = av;
      internals.m_force.Set(fx, fy);
      internals.m_torque = torque;
      b.SetLinearDamping(ld);
      b.SetAngularDamping(ad);
      b.SetGravityScale(gs);
      b.SetBullet(d.bullet);
      internals.m_mass = mass;
      internals.m_invMass = invMass;
      internals.m_I = inertia;
      internals.m_invI = invI;
      internals.m_sleepTime = d.sleepTime;
    }

    for (const d of data.joints) {
      const bodyA = this.#bodies.get(d.bodyA) as BodyRecord;
      const bodyB = this.#bodies.get(d.bodyB) as BodyRecord;
      const old = oldJoints.get(d.id);
      const record: JointRecord =
        old !== undefined && old.bodyA === bodyA && old.bodyB === bodyB
          ? old
          : {
              id: d.id,
              type: d.type,
              bodyA,
              bodyB,
              config: d.config,
              joint: undefined as unknown as b2Joint,
              alive: true,
            };
      record.alive = true;
      Object.assign(record.config, d.config);
      record.joint = this.#buildJoint(record);
      this.#joints.set(d.id, record);
    }
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const record of this.#bodies.values()) {
      record.alive = false;
    }
    for (const record of this.#colliders.values()) {
      record.alive = false;
    }
    this.#bodies.clear();
    for (const record of this.#joints.values()) {
      record.alive = false;
    }
    this.#joints.clear();
    this.#colliders.clear();
    this.#recordByFixture.clear();
    this.#activePairs.clear();
    this.#pendingEvents = [];
    this.#world = undefined;
  }

  // ---------------------------------------------------------------- SolverBodyAccess

  getBodyTransform(
    handle: PhysicsBodyHandle,
    outPosition: Vector3,
    outRotation: Quaternion,
  ): void {
    const { body } = this.#requireBody(handle);
    const p = body.GetPosition();
    outPosition.set(p.x, p.y, 0);
    const half = body.GetAngle() / 2;
    outRotation.set(0, 0, Math.sin(half), Math.cos(half));
  }

  setBodyTransform(
    handle: PhysicsBodyHandle,
    position: Vector3Input,
    rotation: RotationInput,
    wake = true,
  ): void {
    const { body } = this.#requireBody(handle);
    checkVector2("position", position);
    body.SetTransformXY(position.x, position.y, this.#angleOf(rotation));
    if (wake) {
      body.SetAwake(true);
    }
  }

  getBodyVelocities(
    handle: PhysicsBodyHandle,
    outLinear: Vector3,
    outAngular: Vector3,
  ): void {
    const { body } = this.#requireBody(handle);
    const v = body.GetLinearVelocity();
    outLinear.set(v.x, v.y, 0);
    outAngular.set(0, 0, body.GetAngularVelocity());
  }

  setBodyVelocities(
    handle: PhysicsBodyHandle,
    linear: Vector3Input,
    angular: AngularVelocityInput,
    wake = true,
  ): void {
    const { body } = this.#requireBody(handle);
    checkVector2("linearVelocity", linear);
    const wasAwake = body.IsAwake();
    body.SetLinearVelocity({ x: linear.x, y: linear.y });
    body.SetAngularVelocity(
      resolveAngularVelocity("2d", angular, this.#scratchVector3).z,
    );
    // Box2D wakes a body on any non-zero velocity write; `wake: false` puts a
    // sleeping body back to sleep (which also leaves its velocity at zero).
    body.SetAwake(wake || wasAwake);
  }

  applyForce(handle: PhysicsBodyHandle, force: Vector3Input): void {
    checkVector2("force", force);
    this.#requireBody(handle).body.ApplyForceToCenter({
      x: force.x,
      y: force.y,
    });
  }

  applyForceAtPoint(
    handle: PhysicsBodyHandle,
    force: Vector3Input,
    worldPoint: Vector3Input,
  ): void {
    checkVector2("force", force);
    checkVector2("worldPoint", worldPoint);
    this.#requireBody(handle).body.ApplyForce(
      { x: force.x, y: force.y },
      { x: worldPoint.x, y: worldPoint.y },
    );
  }

  applyTorque(handle: PhysicsBodyHandle, torque: AngularVelocityInput): void {
    this.#requireBody(handle).body.ApplyTorque(
      resolveAngularVelocity("2d", torque, this.#scratchVector3).z,
    );
  }

  applyImpulse(handle: PhysicsBodyHandle, impulse: Vector3Input): void {
    checkVector2("impulse", impulse);
    this.#requireBody(handle).body.ApplyLinearImpulseToCenter({
      x: impulse.x,
      y: impulse.y,
    });
  }

  applyImpulseAtPoint(
    handle: PhysicsBodyHandle,
    impulse: Vector3Input,
    worldPoint: Vector3Input,
  ): void {
    checkVector2("impulse", impulse);
    checkVector2("worldPoint", worldPoint);
    this.#requireBody(handle).body.ApplyLinearImpulse(
      { x: impulse.x, y: impulse.y },
      { x: worldPoint.x, y: worldPoint.y },
    );
  }

  applyAngularImpulse(
    handle: PhysicsBodyHandle,
    angularImpulse: AngularVelocityInput,
  ): void {
    this.#requireBody(handle).body.ApplyAngularImpulse(
      resolveAngularVelocity("2d", angularImpulse, this.#scratchVector3).z,
    );
  }

  /** A no-op: Box2D clears accumulated forces itself after every `Step`. */
  resetForces(handle: PhysicsBodyHandle): void {
    this.#requireBody(handle);
  }

  setNextKinematicTransform(
    handle: PhysicsBodyHandle,
    position: Vector3Input,
    rotation?: RotationInput,
  ): void {
    const record = this.#requireBody(handle);
    checkVector2("position", position);
    record.target = [
      position.x,
      position.y,
      rotation === undefined ? record.body.GetAngle() : this.#angleOf(rotation),
    ];
  }

  setBodyType(handle: PhysicsBodyHandle, type: BodyType, wake = true): void {
    const record = this.#requireBody(handle);
    record.type = type;
    record.target = undefined;
    record.body.SetType(toB2Type(type));
    this.#applyAuthoredMass(record);
    if (wake) {
      record.body.SetAwake(true);
    }
  }

  wakeBody(handle: PhysicsBodyHandle): void {
    this.#requireBody(handle).body.SetAwake(true);
  }

  sleepBody(handle: PhysicsBodyHandle): void {
    this.#requireBody(handle).body.SetAwake(false);
  }

  isBodySleeping(handle: PhysicsBodyHandle): boolean {
    return this.#isSleeping(this.#requireBody(handle));
  }

  getBodyCcdMode(handle: PhysicsBodyHandle): CCDMode {
    return this.#requireBody(handle).body.IsBullet() ? "swept" : "disabled";
  }

  getBodyMass(handle: PhysicsBodyHandle): number {
    return this.#requireBody(handle).body.GetMass();
  }

  getBodyCenterOfMass(handle: PhysicsBodyHandle, out: Vector3): void {
    const c = this.#requireBody(handle).body.GetWorldCenter();
    out.set(c.x, c.y, 0);
  }

  getBodyId(handle: PhysicsBodyHandle): number {
    return this.#requireBody(handle).id;
  }

  forEachBody(visit: (handle: PhysicsBodyHandle, id: number) => void): void {
    for (const record of [...this.#bodies.values()]) {
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
    for (const record of [...this.#colliders.values()]) {
      visit(record as unknown as PhysicsColliderHandle, record.id);
    }
  }

  // ---------------------------------------------------------------- SolverBodyTuningAccess

  /**
   * Replaces the §23 mass triple. `centerOfMass` is body-local; the tensor's Z
   * diagonal entry (`elements[8]`) is the rotational inertia about the centre of
   * mass. Omitted centre / tensor are derived from the colliders, scaled to the
   * new mass (the same rule `createBody` applies to an authored mass).
   */
  setBodyMassProperties(
    handle: PhysicsBodyHandle,
    mass: number,
    centerOfMass: Vector3 | undefined,
    inertiaTensor: Matrix3 | undefined,
    wake = true,
  ): void {
    const record = this.#requireBody(handle);
    record.authoredMass = mass;
    record.authoredCenter =
      centerOfMass === undefined ? undefined : [centerOfMass.x, centerOfMass.y];
    record.authoredInertia = inertiaTensor?.elements[8];
    this.#applyAuthoredMass(record);
    if (wake) {
      record.body.SetAwake(true);
    }
  }

  setBodyDamping(
    handle: PhysicsBodyHandle,
    linear: number,
    angular: number,
  ): void {
    const { body } = this.#requireBody(handle);
    body.SetLinearDamping(linear);
    body.SetAngularDamping(angular);
  }

  setBodyGravityScale(
    handle: PhysicsBodyHandle,
    scale: number,
    wake = true,
  ): void {
    const { body } = this.#requireBody(handle);
    body.SetGravityScale(scale);
    if (wake) {
      body.SetAwake(true);
    }
  }

  setBodyCcdMode(
    handle: PhysicsBodyHandle,
    mode: CCDMode,
    predictionDistance?: number,
  ): void {
    void predictionDistance;
    if (mode === "speculative") {
      throw notImplemented('ccdMode "speculative"');
    }
    this.#requireBody(handle).body.SetBullet(mode === "swept");
  }

  setColliderMaterial(
    handle: PhysicsColliderHandle,
    friction: number,
    restitution: number,
    density: number | undefined,
  ): void {
    const record = this.#requireCollider(handle);
    for (const fixture of record.fixtures) {
      fixture.SetFriction(friction);
      fixture.SetRestitution(restitution);
      if (density !== undefined) {
        fixture.SetDensity(density);
      }
    }
    if (density !== undefined) {
      const body = this.#bodies.get(record.bodyId) as BodyRecord;
      this.#applyAuthoredMass(body, true);
    }
  }

  setColliderFilter(
    handle: PhysicsColliderHandle,
    sensor: boolean,
    collisionGroups: number,
    collisionMask: number,
  ): void {
    const record = this.#requireCollider(handle);
    for (const fixture of record.fixtures) {
      fixture.SetSensor(sensor);
      fixture.SetFilterData({
        categoryBits: collisionGroups,
        maskBits: collisionMask,
        groupIndex: 0,
      });
    }
    (record as { sensor: boolean }).sensor = sensor;
  }

  // ---------------------------------------------------------------- SolverJointAccess

  /** Box2D reports the accumulated constraint impulse of the last step. */
  readonly reportsJointReactions = true;

  /**
   * The impulse (N s, N m s) the joint applied during the last `step`, in world
   * space: `GetReactionForce(1)` / `GetReactionTorque(1)`, since Box2D defines
   * force = `inv_dt * impulse`.
   */
  getJointReaction(
    handle: PhysicsJointHandle,
    outLinear: Vector3,
    outAngular: Vector3,
  ): void {
    const { joint } = this.#requireJoint(handle);
    const f = joint.GetReactionForce(1, this.#scratchB2);
    outLinear.set(f.x, f.y, 0);
    outAngular.set(0, 0, joint.GetReactionTorque(1));
  }

  /**
   * Re-limits a revolute (radians) or prismatic (metres) joint. A `-Z` revolute
   * joint's range is mirrored to `[-max, -min]`. Other types have no limited
   * degree of freedom and throw.
   */
  setJointLimits(handle: PhysicsJointHandle, min: number, max: number): void {
    const record = this.#requireJoint(handle);
    this.#requireDrivenType(record, "limits");
    record.config.limits = { min, max };
    this.#applyLimits(record);
    this.#wakeJointBodies(record);
  }

  /**
   * Re-configures a revolute / prismatic velocity motor. `maxEffort` becomes
   * Box2D's `maxMotorTorque` / `maxMotorForce`, a **hard cap** (the solver
   * clamps the accumulated motor impulse to `maxEffort * dt`), unlike the
   * Rapier gain. A `-Z` revolute joint negates the target rate.
   */
  setJointMotor(handle: PhysicsJointHandle, motor: SolverJointMotor): void {
    const record = this.#requireJoint(handle);
    this.#requireDrivenType(record, "motor");
    record.config.motor = { ...motor };
    this.#applyMotor(record);
    this.#wakeJointBodies(record);
  }

  /**
   * Box2D fixes `collideConnected` at creation, so the joint is rebuilt in place
   * (same handle and id; accumulated warm-start impulses are dropped).
   */
  setJointCollisionEnabled(handle: PhysicsJointHandle, enabled: boolean): void {
    const record = this.#requireJoint(handle);
    record.config.collide = enabled;
    this.#rebuildJoint(record);
  }

  /** Body-local anchors; rebuilt in place like {@link Box2dAdapter.setJointCollisionEnabled}. */
  setJointAnchors(
    handle: PhysicsJointHandle,
    anchorA: Vector3,
    anchorB: Vector3,
  ): void {
    const record = this.#requireJoint(handle);
    record.config.anchorA = this.#anchorOf("anchorA", anchorA);
    record.config.anchorB = this.#anchorOf("anchorB", anchorB);
    this.#rebuildJoint(record);
  }

  getJointId(handle: PhysicsJointHandle): number {
    return this.#requireJoint(handle).id;
  }

  forEachJoint(visit: (handle: PhysicsJointHandle, id: number) => void): void {
    this.#requireWorld();
    for (const record of [...this.#joints.values()]) {
      visit(record as unknown as PhysicsJointHandle, record.id);
    }
  }

  // ---------------------------------------------------------------- internals

  // ---------------------------------------------------------------- query helpers

  #queryPoint(field: string, value: Vector3Input): { x: number; y: number } {
    checkVector2(field, value);
    return { x: value.x, y: value.y };
  }

  /** The unit direction of a ray / sweep; a zero vector is rejected (§30, §85). */
  #queryDirection(query: string, value: Vector3Input): [number, number] {
    checkVector2("direction", value);
    const length = Math.hypot(value.x, value.y);
    if (length === 0) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `${query} direction must have non-zero length (§30, §85).`,
        { context: { adapter: ADAPTER_NAME } },
      );
    }
    return [value.x / length, value.y / length];
  }

  /**
   * How far to cast. An explicit finite `maxDistance` is used as is; an omitted
   * (or infinite) one becomes "far enough to leave every fixture behind": the
   * distance from the origin to the farthest corner of the union of all fixture
   * AABBs, plus the swept shape's size. `0` when there is nothing to hit.
   */
  #sweepLength(
    ox: number,
    oy: number,
    maxDistance: number | undefined,
    extent: number,
  ): number {
    if (maxDistance !== undefined && Number.isFinite(maxDistance)) {
      return Math.max(0, maxDistance);
    }
    let reach = 0;
    for (const fixture of this.#recordByFixture.keys()) {
      const box = fixture.GetAABB(0);
      for (const cx of [box.lowerBound.x, box.upperBound.x]) {
        for (const cy of [box.lowerBound.y, box.upperBound.y]) {
          reach = Math.max(reach, Math.hypot(cx - ox, cy - oy));
        }
      }
    }
    return reach === 0 ? 0 : reach + extent + 1;
  }

  /**
   * The contact point on the hit collider at fraction `lambda` of the sweep.
   * `b2ShapeCast`'s own `point` is in the swept shape's frame (it lands at the
   * shape's centre for a circle), so the witness is recomputed with `b2Distance`
   * (radii included) between the target and the shape moved to the impact.
   */
  #witness(
    input: b2ShapeCastInput,
    lambda: number,
    tx: number,
    ty: number,
  ): Vector3 {
    const distanceInput = new b2DistanceInput();
    distanceInput.proxyA.Copy(input.proxyA);
    distanceInput.proxyB.Copy(input.proxyB);
    distanceInput.transformA.Copy(input.transformA);
    distanceInput.transformB.SetIdentity();
    distanceInput.transformB.p.Set(tx * lambda, ty * lambda);
    distanceInput.useRadii = true;
    const out = new b2DistanceOutput();
    b2Distance(out, new b2SimplexCache(), distanceInput);
    return new Vector3(out.pointA.x, out.pointA.y, 0);
  }

  #shapesExtent(shapes: readonly b2Shape[]): number {
    const box = new b2AABB();
    const identity = new b2Transform();
    identity.SetIdentity();
    let extent = 0;
    for (const shape of shapes) {
      shape.ComputeAABB(box, identity, 0);
      extent = Math.max(
        extent,
        Math.hypot(
          box.upperBound.x - box.lowerBound.x,
          box.upperBound.y - box.lowerBound.y,
        ),
      );
    }
    return extent;
  }

  /** §30's filter on one fixture, through the shared `passesQueryFilter`. */
  #passesFilter(
    record: ColliderRecord,
    fixture: b2Fixture,
    options: ResolvedQueryOptions,
  ): boolean {
    const filter = fixture.GetFilterData();
    const candidate: QueryCandidate = {
      collider: record as unknown as PhysicsColliderHandle,
      body: this.#bodyHandleOf(record),
      collisionGroups: filter.categoryBits,
      collisionMask: filter.maskBits,
      sensor: record.sensor,
    };
    return passesQueryFilter(candidate, options);
  }

  // ---------------------------------------------------------------- snapshot decoding

  /** Fully decodes and cross-checks an envelope; touches no adapter state. */
  #decodeSnapshot(snapshot: ArrayBuffer): SnapshotData {
    const r = new SnapshotReader(snapshot);
    const refuse = (
      message: string,
      context: Record<string, unknown> = {},
    ): never => {
      throw new FourError(ADAPTER_ERROR_CODE, `${message} (§34, §37).`, {
        context: { adapter: ADAPTER_NAME, ...context },
      });
    };
    if (snapshot.byteLength < 8 || r.u32() !== SNAPSHOT_MAGIC) {
      refuse(
        `Snapshot was not produced by ${ADAPTER_NAME}; a snapshot is opaque adapter data and is valid only for the adapter that wrote it`,
      );
    }
    const format = r.u32();
    if (format !== SNAPSHOT_FORMAT_VERSION) {
      refuse(
        `Snapshot envelope format ${String(format)} is not ${String(SNAPSHOT_FORMAT_VERSION)}`,
      );
    }
    const name = r.str();
    const version = r.str();
    if (name !== this.name) {
      refuse(
        `Snapshot was taken with adapter ${JSON.stringify(name)} and this is ${JSON.stringify(this.name)}`,
        { found: name },
      );
    }
    if (version !== this.version) {
      refuse(
        `Snapshot was taken with ${JSON.stringify(name)} version ${JSON.stringify(version)} and this adapter is version ${JSON.stringify(this.version)}`,
        { found: version },
      );
    }
    const data: SnapshotData = {
      gravity: [r.f64(), r.f64()],
      sleepingEnabled: r.bool(),
      velocityIterations: r.u32(),
      nextBodyId: r.u32(),
      nextColliderId: r.u32(),
      nextJointId: r.u32(),
      bodies: [],
      colliders: [],
      joints: [],
    };
    const bodyIds = new Set<number>();
    const nBodies = r.u32();
    for (let i = 0; i < nBodies; i += 1) {
      const id = r.u32();
      const type = r.str() as BodyType;
      if (!BODY_TYPES.includes(type)) {
        refuse(
          `Snapshot body ${String(id)} has unknown type ${JSON.stringify(type)}`,
        );
      }
      const awake = r.bool();
      const sleeping = r.bool();
      const sleepTime = r.f64();
      const xf = readNumbers(r, 4);
      const sweep = readNumbers(r, 9);
      const dynamics = readNumbers(r, 13);
      const bullet = r.bool();
      const mass = readOptional(r, 1);
      const center = readOptional(r, 2);
      const inertia = readOptional(r, 1);
      const target = readOptional(r, 3);
      bodyIds.add(id);
      data.bodies.push({
        id,
        type,
        awake,
        sleeping,
        sleepTime,
        xf,
        sweep,
        dynamics,
        bullet,
        authoredMass: mass?.[0],
        authoredCenter: center && [center[0], center[1]],
        authoredInertia: inertia?.[0],
        target: target && [target[0], target[1], target[2]],
      });
    }
    const nColliders = r.u32();
    for (let i = 0; i < nColliders; i += 1) {
      const id = r.u32();
      const bodyId = r.u32();
      if (!bodyIds.has(bodyId)) {
        refuse(
          `Snapshot collider ${String(id)} names missing body ${String(bodyId)}`,
        );
      }
      const sensor = r.bool();
      const count = r.u32();
      const fixtures: SnapshotFixture[] = [];
      for (let j = 0; j < count; j += 1) {
        const kind = r.u8();
        let shape: b2Shape;
        if (kind === 0) {
          const circle = new b2CircleShape();
          circle.m_p.Set(r.f64(), r.f64());
          circle.m_radius = r.f64();
          shape = circle;
        } else if (kind === 1) {
          const n = r.u32();
          if (n < 3 || n > MAX_POLYGON_VERTICES) {
            refuse(`Snapshot polygon has ${String(n)} vertices`);
          }
          const polygon = new b2PolygonShape();
          polygon.m_count = n;
          polygon.m_vertices = [];
          polygon.m_normals = [];
          for (let k = 0; k < n; k += 1) {
            polygon.m_vertices.push(new b2Vec2(r.f64(), r.f64()));
            polygon.m_normals.push(new b2Vec2(r.f64(), r.f64()));
          }
          polygon.m_centroid.Set(r.f64(), r.f64());
          polygon.m_radius = r.f64();
          shape = polygon;
        } else {
          return refuse(
            `Snapshot fixture has unknown shape kind ${String(kind)}`,
          );
        }
        const [
          friction,
          restitution,
          restitutionThreshold,
          density,
          categoryBits,
          maskBits,
          groupIndex,
        ] = readNumbers(r, 7);
        fixtures.push({
          shape,
          friction,
          restitution,
          restitutionThreshold,
          density,
          categoryBits,
          maskBits,
          groupIndex,
        });
      }
      data.colliders.push({ id, bodyId, sensor, fixtures });
    }
    const nJoints = r.u32();
    for (let i = 0; i < nJoints; i += 1) {
      const id = r.u32();
      const type = r.str() as ShippedJointType;
      const bodyA = r.u32();
      const bodyB = r.u32();
      if (
        !(BOX2D_JOINT_TYPES as readonly string[]).includes(type) ||
        !bodyIds.has(bodyA) ||
        !bodyIds.has(bodyB)
      ) {
        refuse(
          `Snapshot joint ${String(id)} has an unknown type or names a missing body`,
        );
      }
      const n = readNumbers(r, 12);
      const collide = r.bool();
      const limits = readOptional(r, 2);
      const motor = readOptional(r, 3);
      data.joints.push({
        id,
        type,
        bodyA,
        bodyB,
        config: {
          anchorA: [n[0], n[1]],
          anchorB: [n[2], n[3]],
          collide,
          axis: [n[4], n[5]],
          sign: n[6] === -1 ? -1 : 1,
          referenceAngle: n[7],
          limits: limits && { min: limits[0], max: limits[1] },
          motor: motor && {
            enabled: motor[0] !== 0,
            targetVelocity: motor[1],
            maxEffort: motor[2],
          },
          maxLength: n[8],
          restLength: n[9],
          stiffness: n[10],
          damping: n[11],
        },
      });
    }
    if (!r.done) {
      refuse("Snapshot has trailing bytes after its declared contents");
    }
    return data;
  }

  #anchorOf(field: string, anchor: Vector3Input | undefined): [number, number] {
    if (anchor === undefined) {
      return [0, 0];
    }
    checkVector2(field, anchor);
    return [anchor.x, anchor.y];
  }

  #requireDrivenType(record: JointRecord, what: "limits" | "motor"): void {
    if (record.type !== "revolute" && record.type !== "prismatic") {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        `A ${record.type} joint has no ${what === "limits" ? "limited" : "motorised"} degree of freedom; only revolute and prismatic joints take ${what} (§28).`,
        { context: { adapter: ADAPTER_NAME, jointType: record.type } },
      );
    }
  }

  #wakeJointBodies(record: JointRecord): void {
    record.bodyA.body.SetAwake(true);
    record.bodyB.body.SetAwake(true);
  }

  #applyLimits(record: JointRecord): void {
    const { limits, sign } = record.config;
    const joint = record.joint as b2RevoluteJoint | b2PrismaticJoint;
    if (limits === undefined) {
      joint.EnableLimit(false);
      return;
    }
    const lower = sign === 1 ? limits.min : -limits.max;
    const upper = sign === 1 ? limits.max : -limits.min;
    joint.SetLimits(lower, upper);
    joint.EnableLimit(true);
  }

  #applyMotor(record: JointRecord): void {
    const { motor, sign } = record.config;
    if (motor === undefined) {
      return;
    }
    const joint = record.joint;
    if (record.type === "revolute") {
      const revolute = joint as b2RevoluteJoint;
      revolute.SetMaxMotorTorque(motor.maxEffort);
      revolute.SetMotorSpeed(sign * motor.targetVelocity);
      revolute.EnableMotor(motor.enabled);
    } else {
      const prismatic = joint as b2PrismaticJoint;
      prismatic.SetMaxMotorForce(motor.maxEffort);
      prismatic.SetMotorSpeed(motor.targetVelocity);
      prismatic.EnableMotor(motor.enabled);
    }
  }

  /** Creates the Box2D joint for `record.config` and applies limits and motor. */
  #buildJoint(record: JointRecord): b2Joint {
    const world = this.#requireWorld();
    const { config, bodyA, bodyB } = record;
    let joint: b2Joint;
    switch (record.type) {
      case "fixed": {
        const def = new b2WeldJointDef();
        def.bodyA = bodyA.body;
        def.bodyB = bodyB.body;
        def.collideConnected = config.collide;
        def.localAnchorA.Set(...config.anchorA);
        def.localAnchorB.Set(...config.anchorB);
        def.referenceAngle = config.referenceAngle;
        joint = world.CreateJoint(def);
        break;
      }
      case "revolute": {
        const def = new b2RevoluteJointDef();
        def.bodyA = bodyA.body;
        def.bodyB = bodyB.body;
        def.collideConnected = config.collide;
        def.localAnchorA.Set(...config.anchorA);
        def.localAnchorB.Set(...config.anchorB);
        joint = world.CreateJoint(def);
        break;
      }
      case "prismatic": {
        const def = new b2PrismaticJointDef();
        def.bodyA = bodyA.body;
        def.bodyB = bodyB.body;
        def.collideConnected = config.collide;
        def.localAnchorA.Set(...config.anchorA);
        def.localAnchorB.Set(...config.anchorB);
        def.localAxisA.Set(...config.axis);
        def.referenceAngle = config.referenceAngle;
        joint = world.CreateJoint(def);
        break;
      }
      default: {
        // rope (unsprung, limited to [slop, maxLength]) and spring (rest length
        // with stiffness and damping, effectively unbounded either side).
        const def = new b2DistanceJointDef();
        def.bodyA = bodyA.body;
        def.bodyB = bodyB.body;
        def.collideConnected = config.collide;
        def.localAnchorA.Set(...config.anchorA);
        def.localAnchorB.Set(...config.anchorB);
        if (record.type === "rope") {
          def.length = config.maxLength;
          def.minLength = 0;
          def.maxLength = config.maxLength;
        } else {
          def.length = config.restLength;
          def.minLength = 0;
          def.maxLength = b2_maxFloat;
          def.stiffness = config.stiffness;
          def.damping = config.damping;
        }
        joint = world.CreateJoint(def);
      }
    }
    record.joint = joint;
    if (record.type === "revolute" || record.type === "prismatic") {
      this.#applyLimits(record);
      this.#applyMotor(record);
    }
    return joint;
  }

  #rebuildJoint(record: JointRecord): void {
    this.#requireWorld().DestroyJoint(record.joint);
    this.#buildJoint(record);
  }

  #requireJoint(handle: PhysicsJointHandle): JointRecord {
    this.#requireWorld();
    const record = handle as unknown as JointRecord;
    if (!record.alive || this.#joints.get(record.id) !== record) {
      rejectStalePhysicsHandle(
        "joint",
        String(record.id),
        "Joint handle is not valid for this Box2dAdapter: it was destroyed (or its body was), or it was minted by another adapter (§37).",
        ADAPTER_ERROR_CODE,
        { adapter: ADAPTER_NAME },
      );
    }
    return record;
  }

  #angleOf(rotation: RotationInput): number {
    if (typeof rotation === "number") {
      return rotation;
    }
    const planar = resolveRotation("2d", rotation, this.#scratchQuaternion);
    return 2 * Math.atan2(planar.z, planar.w);
  }

  #placementOf(desc: ColliderDescriptor): Placement {
    if (desc.offset === undefined) {
      return IDENTITY;
    }
    checkVector2("offset.position", desc.offset.position);
    const angle = this.#angleOf(desc.offset.rotation);
    return {
      x: desc.offset.position.x,
      y: desc.offset.position.y,
      cos: Math.cos(angle),
      sin: Math.sin(angle),
      angle,
    };
  }

  #shapesOf(desc: ColliderDescriptor, p: Placement): b2Shape[] {
    const shape = desc.shape;
    switch (shape.type) {
      case "circle":
        return [circleShape(p, shape.radius, 0, 0)];
      case "rectangle":
        return [boxPolygon(p, shape.halfExtents.x, shape.halfExtents.y, 0, 0)];
      case "capsule":
        return [
          boxPolygon(p, shape.radius, shape.halfHeight, 0, 0),
          circleShape(p, shape.radius, 0, shape.halfHeight),
          circleShape(p, shape.radius, 0, -shape.halfHeight),
        ];
      case "polygon": {
        if (shape.vertices.length > MAX_POLYGON_VERTICES) {
          throw new FourError(
            ADAPTER_ERROR_CODE,
            `Box2D polygons hold at most ${String(MAX_POLYGON_VERTICES)} vertices; got ${String(shape.vertices.length)} (§24). Split the outline into several colliders.`,
            { context: { vertices: shape.vertices.length } },
          );
        }
        const polygon = new b2PolygonShape();
        const ok = polygon.Set(shape.vertices.map((v) => place(p, v.x, v.y)));
        if (!ok) {
          throw new FourError(
            ADAPTER_ERROR_CODE,
            "Box2D rejected the polygon outline as degenerate (§24).",
          );
        }
        return [polygon];
      }
      default:
        throw notImplemented(`collision shape "${shape.type}"`);
    }
  }

  /**
   * Re-applies §23's authored mass after the collider set or body type changed.
   * Inertia is scaled by the same ratio so the body stays physically plausible.
   */
  #applyAuthoredMass(record: BodyRecord, force = false): void {
    const { body, authoredMass } = record;
    if (authoredMass === undefined || record.type !== "dynamic") {
      if (force) {
        body.ResetMassData();
      }
      return;
    }
    body.ResetMassData();
    const mass = body.GetMass();
    if (mass <= 0) {
      return;
    }
    const scale = authoredMass / mass;
    const center = record.authoredCenter
      ? new b2Vec2(record.authoredCenter[0], record.authoredCenter[1])
      : body.GetLocalCenter().Clone();
    // Box2D's `I` is about the body origin (parallel-axis shifted).
    const inertia =
      record.authoredInertia === undefined
        ? body.GetInertia() * scale
        : record.authoredInertia +
          authoredMass * (center.x * center.x + center.y * center.y);
    body.SetMassData({ mass: authoredMass, center, I: inertia });
  }

  /** Forgets a collider in every registry (its Box2D fixtures are destroyed by the caller). */
  #dropCollider(record: ColliderRecord): void {
    for (const fixture of record.fixtures) {
      this.#recordByFixture.delete(fixture);
    }
    for (const [key, pair] of this.#activePairs) {
      if (pair.a === record || pair.b === record) {
        this.#activePairs.delete(key);
      }
    }
    record.alive = false;
    this.#colliders.delete(record.id);
  }

  #recordOf(fixture: b2Fixture): ColliderRecord {
    return this.#recordByFixture.get(fixture) as ColliderRecord;
  }

  #createListener(): b2ContactListener {
    const listener = new b2ContactListener();
    listener.BeginContact = (contact: b2Contact): void => {
      const a = this.#recordOf(contact.GetFixtureA());
      const b = this.#recordOf(contact.GetFixtureB());
      const key = this.#pairKey(a, b);
      let pair = this.#activePairs.get(key);
      if (pair === undefined) {
        pair = { a, b, trigger: a.sensor || b.sensor, contacts: new Set() };
        this.#activePairs.set(key, pair);
        this.#started.push(pair);
        this.#startedKeys.add(key);
      }
      pair.contacts.add(contact);
    };
    // Box2D calls EndContact while destroying a fixture or body; those pairs
    // were already dropped by `#dropCollider`, so those calls are ignored.
    listener.EndContact = (contact: b2Contact): void => {
      if (this.#suppressContactEvents) {
        return;
      }
      const a = this.#recordOf(contact.GetFixtureA());
      const b = this.#recordOf(contact.GetFixtureB());
      const key = this.#pairKey(a, b);
      const pair = this.#activePairs.get(key) as PairRecord;
      pair.contacts.delete(contact);
      if (pair.contacts.size === 0) {
        this.#stopped.push(pair);
        this.#stoppedKeys.add(key);
      }
    };
    return listener;
  }

  #pairKey(a: ColliderRecord, b: ColliderRecord): number {
    return Math.min(a.id, b.id) * 0x100000000 + Math.max(a.id, b.id);
  }

  /**
   * Ordering (§33), identical to the Rapier adapters: every start/enter, then
   * every stay in pair-creation order, then every end/exit, then sleep/wake in
   * body-creation order. A pair that started and stopped within one step emits
   * both, and leaves `#activePairs` once its end is emitted.
   */
  #collectEvents(): void {
    for (const pair of this.#started) {
      this.#emitPair(pair, "start");
    }
    if (this.#stayEvents) {
      for (const [key, pair] of this.#activePairs) {
        if (
          pair.trigger ||
          this.#startedKeys.has(key) ||
          this.#stoppedKeys.has(key)
        ) {
          continue;
        }
        this.#emitPair(pair, "stay");
      }
    }
    for (const pair of this.#stopped) {
      this.#emitPair(pair, "end");
      this.#activePairs.delete(this.#pairKey(pair.a, pair.b));
    }
    for (const record of this.#bodies.values()) {
      const sleeping = this.#isSleeping(record);
      if (sleeping !== record.sleeping) {
        record.sleeping = sleeping;
        this.#pendingEvents.push({
          type: sleeping ? "sleep" : "wake",
          body: record as unknown as PhysicsBodyHandle,
        });
      }
    }
  }

  #emitPair(pair: PairRecord, phase: "start" | "stay" | "end"): void {
    const { a, b } = pair;
    if (pair.trigger) {
      const type = phase === "start" ? "triggerenter" : "triggerexit";
      for (const [sensor, other] of [
        [a, b],
        [b, a],
      ] as const) {
        if (sensor.sensor) {
          this.#pendingEvents.push({
            type,
            sensor: sensor as unknown as PhysicsColliderHandle,
            sensorBody: this.#bodyHandleOf(sensor),
            other: other as unknown as PhysicsColliderHandle,
            otherBody: this.#bodyHandleOf(other),
          });
        }
      }
      return;
    }
    const contacts: ContactPoint[] = [];
    const totalImpulse = new Vector3();
    const relativeVelocity = new Vector3();
    if (phase !== "end") {
      this.#buildContacts(pair, contacts, totalImpulse, relativeVelocity);
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
   * Fills the §29 manifold from Box2D's touching contacts. `pointOnA/B` straddle
   * Box2D's mid-point by half the separation along the A-to-B normal;
   * `relativeVelocity` is velocity(A) - velocity(B) at the first point, read after
   * the solve (the post-impact value, as in the Rapier adapters).
   */
  #buildContacts(
    pair: PairRecord,
    contacts: ContactPoint[],
    totalImpulse: Vector3,
    relativeVelocity: Vector3,
  ): void {
    let impulseSum = 0;
    let normalX = 0;
    let normalY = 0;
    for (const contact of pair.contacts) {
      // Box2D orders a contact's fixtures by its own rule; a capsule's several
      // fixtures can disagree, so orient each contact so A is always `pair.a`.
      const sign =
        1 - 2 * Number(this.#recordOf(contact.GetFixtureA()) !== pair.a);
      contact.GetWorldManifold(this.#worldManifold);
      const manifold = contact.GetManifold();
      const n = this.#worldManifold.normal;
      const nx = n.x * sign;
      const ny = n.y * sign;
      normalX = nx;
      normalY = ny;
      for (let i = 0; i < manifold.pointCount; i += 1) {
        const mid = this.#worldManifold.points[i];
        const separation = this.#worldManifold.separations[i];
        const impulse = manifold.points[i].normalImpulse;
        impulseSum += impulse;
        const half = separation / 2;
        contacts.push({
          pointOnA: new Vector3(mid.x - nx * half, mid.y - ny * half, 0),
          pointOnB: new Vector3(mid.x + nx * half, mid.y + ny * half, 0),
          normal: new Vector3(nx, ny, 0),
          separation,
          impulse,
        });
      }
    }
    totalImpulse.set(normalX * impulseSum, normalY * impulseSum, 0);
    const bodyA = this.#bodies.get(pair.a.bodyId) as BodyRecord;
    const bodyB = this.#bodies.get(pair.b.bodyId) as BodyRecord;
    // At most one iteration: a pair whose contacts all ended within the step has none.
    for (const first of contacts.slice(0, 1)) {
      const point = { x: first.pointOnA.x, y: first.pointOnA.y };
      const va = bodyA.body.GetLinearVelocityFromWorldPoint(
        point,
        new b2Vec2(),
      );
      const vb = bodyB.body.GetLinearVelocityFromWorldPoint(
        point,
        new b2Vec2(),
      );
      relativeVelocity.set(va.x - vb.x, va.y - vb.y, 0);
    }
  }

  /** Static bodies never sleep (Box2D reports them as not awake). */
  #isSleeping(record: BodyRecord): boolean {
    return record.type !== "static" && !record.body.IsAwake();
  }

  #bodyHandleOf(record: ColliderRecord): PhysicsBodyHandle {
    return this.#bodies.get(record.bodyId) as unknown as PhysicsBodyHandle;
  }

  #assertNotDisposed(): void {
    if (this.#disposed) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        "Box2dAdapter has been disposed; dispose() is terminal (§37, §83).",
        { context: { adapter: ADAPTER_NAME } },
      );
    }
  }

  #requireWorld(): b2World {
    this.#assertNotDisposed();
    if (this.#world === undefined) {
      throw new FourError(
        ADAPTER_ERROR_CODE,
        "Box2dAdapter.initialize has not completed; call it before using the adapter (§37).",
        { context: { adapter: ADAPTER_NAME } },
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
        "Body handle is not valid for this Box2dAdapter: it was destroyed, or it was minted by another adapter (§37).",
        ADAPTER_ERROR_CODE,
        { adapter: ADAPTER_NAME },
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
        "Collider handle is not valid for this Box2dAdapter: it was destroyed, or it was minted by another adapter (§37).",
        ADAPTER_ERROR_CODE,
        { adapter: ADAPTER_NAME },
      );
    }
    return record;
  }
}

/** `+Z` (or omitted) is `1`; `-Z` is `-1`; anything off the Z axis is rejected (§21). */
function revoluteSign(axis: Vector3Input | undefined): 1 | -1 {
  if (axis === undefined) {
    return 1;
  }
  const z = "z" in axis ? axis.z : 0;
  if (axis.x !== 0 || axis.y !== 0 || z === 0 || !Number.isFinite(z)) {
    throw new FourError(
      ADAPTER_ERROR_CODE,
      `A "2d" world rotates about +Z only, so a revolute joint's axis must be along ±Z; got (${String(axis.x)}, ${String(axis.y)}, ${String(z)}) (§21, §28).`,
      { context: { field: "axis" } },
    );
  }
  return z > 0 ? 1 : -1;
}

function toB2Type(type: BodyType): b2BodyType {
  switch (type) {
    case "static":
      return b2BodyType.b2_staticBody;
    case "dynamic":
      return b2BodyType.b2_dynamicBody;
    default:
      return b2BodyType.b2_kinematicBody;
  }
}

function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  return angle - twoPi * Math.round(angle / twoPi);
}
