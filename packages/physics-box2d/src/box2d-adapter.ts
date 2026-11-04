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
  b2PolygonShape,
  b2Vec2,
  b2World,
  b2WorldManifold,
} from "@box2d/core";
import type { b2Body, b2Contact, b2Fixture, b2Shape } from "@box2d/core";
import { FourError } from "@fourjs/core";
import { Quaternion, Vector3 } from "@fourjs/math";
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
  SolverBodyAccess,
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
 * - `jointTypes: []` / `queries` all `false` / `snapshots: false`: later packets.
 * - `ccdModes`: Box2D's continuous collision is TOI-based; `"swept"` maps to
 *   `b2Body.SetBullet`. There is no speculative mode.
 * - `tuning.jointMotorEffortCap` is `false` **today only because there are no
 *   joints**. Box2D's `maxMotorTorque` / `maxMotorForce` are real hard caps (the
 *   recorded reason this adapter exists, TODO "reserved stub" row); W8.2 flips
 *   it to `true` when revolute/prismatic joints land.
 */
export const BOX2D_CAPABILITIES: PhysicsCapabilities = Object.freeze({
  dimensions: Object.freeze(["2d"] as const),
  jointTypes: Object.freeze<string[]>([]),
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
    jointMotorEffortCap: false,
  }),
});

interface BodyRecord {
  readonly id: number;
  readonly body: b2Body;
  type: BodyType;
  alive: boolean;
  sleeping: boolean;
  /** Authored mass (§23), re-applied after each collider is added. */
  readonly authoredMass: number | undefined;
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
export class Box2dAdapter implements PhysicsSolverAdapter, SolverBodyAccess {
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
  #sleepingEnabled = true;
  #velocityIterations = DEFAULT_VELOCITY_ITERATIONS;
  #stayEvents = true;
  #pendingEvents: PhysicsEvent[] = [];
  #suppressContactEvents = false;

  readonly #bodies = new Map<number, BodyRecord>();
  readonly #colliders = new Map<number, ColliderRecord>();
  readonly #recordByFixture = new Map<b2Fixture, ColliderRecord>();
  readonly #activePairs = new Map<number, PairRecord>();
  readonly #startedKeys = new Set<number>();
  readonly #stoppedKeys = new Set<number>();
  readonly #started: PairRecord[] = [];
  readonly #stopped: PairRecord[] = [];
  readonly #scratchVector3 = new Vector3();
  readonly #scratchQuaternion = new Quaternion();
  readonly #worldManifold = new b2WorldManifold();

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

  createJoint(desc: JointDescriptor): PhysicsJointHandle {
    void desc;
    throw notImplemented("createJoint");
  }

  destroyJoint(handle: PhysicsJointHandle): void {
    void handle;
    throw notImplemented("destroyJoint");
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

  // ---------------------------------------------------------------- internals

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
  #applyAuthoredMass(record: BodyRecord): void {
    const { body, authoredMass } = record;
    if (authoredMass === undefined || record.type !== "dynamic") {
      return;
    }
    body.ResetMassData();
    const mass = body.GetMass();
    if (mass <= 0) {
      return;
    }
    const scale = authoredMass / mass;
    body.SetMassData({
      mass: authoredMass,
      center: body.GetLocalCenter().Clone(),
      I: body.GetInertia() * scale,
    });
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
