/**
 * The PhysJS solver adapters (RFC 0010, §37, §102) — skeleton.
 *
 * W9.1 lands the package shape behind the §37 seam: the capability record the
 * RFC's gaps table dictates, the adapter names, and a registry opt-in. Every
 * operation refuses with `FourError("NOT_IMPLEMENTED")`; W9.2-W9.4 fill them
 * in. Refusing loudly is the §37 contract for an unbuilt surface — nothing is
 * approximated silently.
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

import { FourError } from "@fourjs/core";
import type { Quaternion, Vector3 } from "@fourjs/math";
import type {
  AngularVelocityInput,
  BodyType,
  CCDMode,
  ColliderDescriptor,
  JointDescriptor,
  OverlapHit,
  OverlapQuery,
  PhysicsBodyHandle,
  PhysicsCapabilities,
  PhysicsColliderHandle,
  PhysicsDimension,
  PhysicsEvent,
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

function notImplemented(adapter: string, operation: string): never {
  throw new FourError(
    "NOT_IMPLEMENTED",
    `${adapter}.${operation} is not implemented yet (RFC 0010 packets W9.2-W9.4).`,
    { context: { adapter, operation } },
  );
}

/**
 * Shared skeleton behind {@link PhysJSAdapter2D} and {@link PhysJSAdapter3D}.
 * Parameters are omitted from the refusing members on purpose: nothing reads
 * them yet, and TypeScript accepts the shorter signatures.
 */
abstract class PhysJSAdapterBase implements PhysicsWorldAdapter {
  abstract readonly name: string;
  readonly version: string = PHYSJS_VERSION;
  readonly capabilities: PhysicsCapabilities = PHYSJS_CAPABILITIES;

  #refuse(operation: string): never {
    return notImplemented(this.name, operation);
  }

  initialize(_options?: PhysicsWorldOptions): never {
    return this.#refuse("initialize");
  }
  createBody(_desc?: RigidBodyDescriptor): PhysicsBodyHandle {
    return this.#refuse("createBody");
  }
  destroyBody(_handle?: PhysicsBodyHandle): void {
    this.#refuse("destroyBody");
  }
  createCollider(_desc?: ColliderDescriptor): PhysicsColliderHandle {
    return this.#refuse("createCollider");
  }
  destroyCollider(_handle?: PhysicsColliderHandle): void {
    this.#refuse("destroyCollider");
  }
  createJoint(_desc?: JointDescriptor): PhysicsJointHandle {
    return this.#refuse("createJoint");
  }
  destroyJoint(_handle?: PhysicsJointHandle): void {
    this.#refuse("destroyJoint");
  }
  step(_delta?: number): void {
    this.#refuse("step");
  }
  drainEvents(): PhysicsEvent[] {
    return this.#refuse("drainEvents");
  }
  syncSceneToSolver(): void {
    this.#refuse("syncSceneToSolver");
  }
  syncSolverToScene(): void {
    this.#refuse("syncSolverToScene");
  }
  raycast(_query?: RaycastQuery): RaycastHit[] {
    return this.#refuse("raycast");
  }
  shapeCast(_query?: ShapeCastQuery): ShapeCastHit[] {
    return this.#refuse("shapeCast");
  }
  overlap(_query?: OverlapQuery): OverlapHit[] {
    return this.#refuse("overlap");
  }
  pointQuery(_query?: PointQuery): PointHit[] {
    return this.#refuse("pointQuery");
  }
  createSnapshot(): ArrayBuffer {
    return this.#refuse("createSnapshot");
  }
  restoreSnapshot(_snapshot?: ArrayBuffer): void {
    this.#refuse("restoreSnapshot");
  }

  /** Idempotent and holds nothing yet, so it is the one member that does not refuse. */
  dispose(): void {}

  // --- SolverBodyAccess ------------------------------------------------------

  getBodyTransform(
    _handle?: PhysicsBodyHandle,
    _outPosition?: Vector3,
    _outRotation?: Quaternion,
  ): void {
    this.#refuse("getBodyTransform");
  }
  setBodyTransform(
    _handle?: PhysicsBodyHandle,
    _position?: Vector3Input,
    _rotation?: RotationInput,
    _wake?: boolean,
  ): void {
    this.#refuse("setBodyTransform");
  }
  getBodyVelocities(
    _handle?: PhysicsBodyHandle,
    _outLinear?: Vector3,
    _outAngular?: Vector3,
  ): void {
    this.#refuse("getBodyVelocities");
  }
  setBodyVelocities(
    _handle?: PhysicsBodyHandle,
    _linear?: Vector3Input,
    _angular?: AngularVelocityInput,
    _wake?: boolean,
  ): void {
    this.#refuse("setBodyVelocities");
  }
  applyForce(_handle?: PhysicsBodyHandle, _force?: Vector3Input): void {
    this.#refuse("applyForce");
  }
  applyForceAtPoint(
    _handle?: PhysicsBodyHandle,
    _force?: Vector3Input,
    _worldPoint?: Vector3Input,
  ): void {
    this.#refuse("applyForceAtPoint");
  }
  applyTorque(
    _handle?: PhysicsBodyHandle,
    _torque?: AngularVelocityInput,
  ): void {
    this.#refuse("applyTorque");
  }
  applyImpulse(_handle?: PhysicsBodyHandle, _impulse?: Vector3Input): void {
    this.#refuse("applyImpulse");
  }
  applyImpulseAtPoint(
    _handle?: PhysicsBodyHandle,
    _impulse?: Vector3Input,
    _worldPoint?: Vector3Input,
  ): void {
    this.#refuse("applyImpulseAtPoint");
  }
  applyAngularImpulse(
    _handle?: PhysicsBodyHandle,
    _angularImpulse?: AngularVelocityInput,
  ): void {
    this.#refuse("applyAngularImpulse");
  }
  resetForces(_handle?: PhysicsBodyHandle): void {
    this.#refuse("resetForces");
  }
  setNextKinematicTransform(
    _handle?: PhysicsBodyHandle,
    _position?: Vector3Input,
    _rotation?: RotationInput,
  ): void {
    this.#refuse("setNextKinematicTransform");
  }
  setBodyType(
    _handle?: PhysicsBodyHandle,
    _type?: BodyType,
    _wake?: boolean,
  ): void {
    this.#refuse("setBodyType");
  }
  wakeBody(_handle?: PhysicsBodyHandle): void {
    this.#refuse("wakeBody");
  }
  sleepBody(_handle?: PhysicsBodyHandle): void {
    this.#refuse("sleepBody");
  }
  isBodySleeping(_handle?: PhysicsBodyHandle): boolean {
    return this.#refuse("isBodySleeping");
  }
  getBodyCcdMode(_handle?: PhysicsBodyHandle): CCDMode {
    return this.#refuse("getBodyCcdMode");
  }
  getBodyMass(_handle?: PhysicsBodyHandle): number {
    return this.#refuse("getBodyMass");
  }
  getBodyCenterOfMass(_handle?: PhysicsBodyHandle, _out?: Vector3): void {
    this.#refuse("getBodyCenterOfMass");
  }
  getBodyId(_handle?: PhysicsBodyHandle): number {
    return this.#refuse("getBodyId");
  }
  forEachBody(_visit?: (handle: PhysicsBodyHandle, id: number) => void): void {
    this.#refuse("forEachBody");
  }
  getColliderBody(_handle?: PhysicsColliderHandle): PhysicsBodyHandle {
    return this.#refuse("getColliderBody");
  }
  getColliderId(_handle?: PhysicsColliderHandle): number {
    return this.#refuse("getColliderId");
  }
  forEachCollider(
    _visit?: (handle: PhysicsColliderHandle, id: number) => void,
  ): void {
    this.#refuse("forEachCollider");
  }
  countContacts(): number {
    return this.#refuse("countContacts");
  }
}

/** PhysJS for `"2d"` worlds (`createWorld({ dims: 2 })`). */
export class PhysJSAdapter2D extends PhysJSAdapterBase {
  readonly name = "physjs2d";
}

/** PhysJS for `"3d"` worlds (`createWorld({ dims: 3 })`). */
export class PhysJSAdapter3D extends PhysJSAdapterBase {
  readonly name = "physjs3d";
}
