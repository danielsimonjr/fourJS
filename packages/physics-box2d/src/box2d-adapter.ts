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
 * derivation, and the whole `SolverBodyAccess` seam. **Not yet** (they throw
 * `FourError("NOT_IMPLEMENTED")`, and the capability record says so): joints,
 * queries, snapshots, and `SolverBodyTuningAccess` / `SolverJointAccess`
 * (absent, so the world keeps its warn-once machinery on).
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
import { Quaternion, Vector3 } from "@fourjs/math";
import type { Matrix3 } from "@fourjs/math";
import {
  ALL_COLLISION_GROUPS,
  DEFAULT_FRICTION,
  DEFAULT_RESTITUTION,
  DETERMINISM_LEVELS,
  rejectStalePhysicsHandle,
  resolveAngularVelocity,
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
 * - `jointTypes`: the five 2D shipped types (W8.2). `queries` all `false` /
 *   `snapshots: false`: later packets.
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
  snapshots: false,
  queries: Object.freeze({
    raycast: false,
    shapeCast: false,
    overlap: false,
    point: false,
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
  readonly body: b2Body;
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
  readonly fixtures: b2Fixture[];
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

  raycast(query: RaycastQuery): RaycastHit[] {
    void query;
    throw notImplemented("raycast");
  }

  shapeCast(query: ShapeCastQuery): ShapeCastHit[] {
    void query;
    throw notImplemented("shapeCast");
  }

  overlap(query: OverlapQuery): OverlapHit[] {
    void query;
    throw notImplemented("overlap");
  }

  pointQuery(query: PointQuery): PointHit[] {
    void query;
    throw notImplemented("pointQuery");
  }

  createSnapshot(): ArrayBuffer {
    throw notImplemented("createSnapshot");
  }

  restoreSnapshot(snapshot: ArrayBuffer): void {
    void snapshot;
    throw notImplemented("restoreSnapshot");
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
