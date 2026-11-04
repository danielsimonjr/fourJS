import { isFourError } from "@fourjs/core";
import { Quaternion, Vector3 } from "@fourjs/math";
import {
  SolverRegistry,
  registeredSolvers,
  clearRegisteredSolvers,
  type PhysicsBodyHandle,
  type PhysicsColliderHandle,
  type PhysicsJointHandle,
  type PhysicsWorldAdapter,
} from "@fourjs/physics";
import { afterEach, describe, expect, it } from "vitest";

import {
  PACKAGE_NAME,
  PHYSJS_CAPABILITIES,
  PHYSJS_VERSION,
  PhysJSAdapter2D,
  PhysJSAdapter3D,
  createPhysJSAdapter,
  isPhysJSSupported,
  registerPhysJSSolver,
} from "../src/index.js";

afterEach(() => {
  clearRegisteredSolvers();
});

describe("registration", () => {
  it("names the package and pins the engine", () => {
    expect(PACKAGE_NAME).toBe("@fourjs/physics-physjs");
    expect(PHYSJS_VERSION).toBe("0.5.0");
    expect(isPhysJSSupported()).toBe(true);
  });

  it("builds the adapter for the world's dimension", () => {
    expect(createPhysJSAdapter({ dimension: "2d" })).toBeInstanceOf(
      PhysJSAdapter2D,
    );
    expect(createPhysJSAdapter({ dimension: "3d" })).toBeInstanceOf(
      PhysJSAdapter3D,
    );
    expect(new PhysJSAdapter2D().name).toBe("physjs2d");
    expect(new PhysJSAdapter3D().name).toBe("physjs3d");
    expect(new PhysJSAdapter3D().version).toBe("0.5.0");
  });

  it('resolves through "physjs", idempotently', () => {
    const registry = new SolverRegistry();
    expect(registerPhysJSSolver(registry)).toBe(registry);
    registerPhysJSSolver(registry);
    expect(registry.solvers).toEqual(["physjs"]);
    expect(registry.resolve("physjs", { dimension: "2d" })).toBeInstanceOf(
      PhysJSAdapter2D,
    );
    expect(registry.resolve("physjs", { dimension: "3d" })).toBeInstanceOf(
      PhysJSAdapter3D,
    );
  });

  it("registers into the shared registry by default", () => {
    registerPhysJSSolver();
    expect(registeredSolvers()).toEqual(["physjs"]);
  });

  it('is last in the "auto" order behind an earlier solver', () => {
    const registry = new SolverRegistry();
    registry.register({
      name: "rapier",
      isSupported: () => true,
      create: () => {
        const adapter = new PhysJSAdapter3D();
        Object.defineProperty(adapter, "capabilities", {
          value: { ...PHYSJS_CAPABILITIES, dimensions: ["3d"] },
        });
        return adapter;
      },
    });
    registerPhysJSSolver(registry);
    expect(registry.solvers).toEqual(["rapier", "physjs"]);
    // The earlier solver wins in 3D; "auto" falls through to physjs in 2D.
    expect(registry.resolve("auto", { dimension: "3d" })).not.toBeInstanceOf(
      PhysJSAdapter2D,
    );
    expect(registry.resolve("auto", { dimension: "2d" })).toBeInstanceOf(
      PhysJSAdapter2D,
    );
  });

  it('"auto" rejects physjs above its determinism tier', () => {
    const registry = registerPhysJSSolver(new SolverRegistry());
    expect(() =>
      registry.resolve("auto", {
        dimension: "2d",
        determinism: "cross-platform",
      }),
    ).toThrow(/found no solver/);
  });
});

describe("capability record (RFC 0010 decision 4)", () => {
  it("matches the snapshot", () => {
    expect(PHYSJS_CAPABILITIES).toMatchInlineSnapshot(`
      {
        "ccdModes": [
          "disabled",
          "speculative",
        ],
        "determinism": "same-runtime",
        "dimensions": [
          "2d",
          "3d",
        ],
        "jointTypes": [
          "fixed",
          "spring",
          "revolute",
          "spherical",
        ],
        "queries": {
          "overlap": true,
          "point": true,
          "raycast": true,
          "shapeCast": false,
        },
        "snapshots": true,
        "tuning": {
          "jointMotorEffortCap": false,
          "rollingFriction": false,
          "sleepThresholds": false,
          "spinningFriction": false,
        },
      }
    `);
    expect(Object.isFrozen(PHYSJS_CAPABILITIES)).toBe(true);
    expect(new PhysJSAdapter2D().capabilities).toBe(PHYSJS_CAPABILITIES);
  });
});

describe("every operation refuses with NOT_IMPLEMENTED", () => {
  const body = {} as PhysicsBodyHandle;
  const collider = {} as PhysicsColliderHandle;
  const joint = {} as PhysicsJointHandle;
  const v = new Vector3();
  const q = new Quaternion();
  const visit = (): void => undefined;

  const calls: Record<string, (a: PhysicsWorldAdapter) => unknown> = {
    initialize: (a) => a.initialize({ dimension: "3d" }),
    createBody: (a) => a.createBody({ type: "dynamic" } as never),
    destroyBody: (a) => a.destroyBody(body),
    createCollider: (a) => a.createCollider({} as never),
    destroyCollider: (a) => a.destroyCollider(collider),
    createJoint: (a) => a.createJoint({} as never),
    destroyJoint: (a) => a.destroyJoint(joint),
    step: (a) => a.step(1 / 60),
    drainEvents: (a) => a.drainEvents(),
    syncSceneToSolver: (a) => a.syncSceneToSolver(),
    syncSolverToScene: (a) => a.syncSolverToScene(),
    raycast: (a) => a.raycast({} as never),
    shapeCast: (a) => a.shapeCast({} as never),
    overlap: (a) => a.overlap({} as never),
    pointQuery: (a) => a.pointQuery({} as never),
    createSnapshot: (a) => a.createSnapshot?.(),
    restoreSnapshot: (a) => a.restoreSnapshot?.(new ArrayBuffer(0)),
    getBodyTransform: (a) => a.getBodyTransform(body, v, q),
    setBodyTransform: (a) => a.setBodyTransform(body, v, q),
    getBodyVelocities: (a) => a.getBodyVelocities(body, v, v),
    setBodyVelocities: (a) => a.setBodyVelocities(body, v, v),
    applyForce: (a) => a.applyForce(body, v),
    applyForceAtPoint: (a) => a.applyForceAtPoint(body, v, v),
    applyTorque: (a) => a.applyTorque(body, v),
    applyImpulse: (a) => a.applyImpulse(body, v),
    applyImpulseAtPoint: (a) => a.applyImpulseAtPoint(body, v, v),
    applyAngularImpulse: (a) => a.applyAngularImpulse(body, v),
    resetForces: (a) => a.resetForces(body),
    setNextKinematicTransform: (a) => a.setNextKinematicTransform(body, v),
    setBodyType: (a) => a.setBodyType(body, "static"),
    wakeBody: (a) => a.wakeBody(body),
    sleepBody: (a) => a.sleepBody(body),
    isBodySleeping: (a) => a.isBodySleeping(body),
    getBodyCcdMode: (a) => a.getBodyCcdMode(body),
    getBodyMass: (a) => a.getBodyMass(body),
    getBodyCenterOfMass: (a) => a.getBodyCenterOfMass(body, v),
    getBodyId: (a) => a.getBodyId(body),
    forEachBody: (a) => a.forEachBody(visit),
    getColliderBody: (a) => a.getColliderBody(collider),
    getColliderId: (a) => a.getColliderId(collider),
    forEachCollider: (a) => a.forEachCollider(visit),
    countContacts: (a) => a.countContacts(),
  };

  for (const Adapter of [PhysJSAdapter2D, PhysJSAdapter3D]) {
    for (const [operation, call] of Object.entries(calls)) {
      it(`${new Adapter().name}.${operation}`, () => {
        let thrown: unknown;
        try {
          call(new Adapter());
        } catch (error) {
          thrown = error;
        }
        expect(isFourError(thrown)).toBe(true);
        expect((thrown as { code: string }).code).toBe("NOT_IMPLEMENTED");
        expect((thrown as Error).message).toContain(operation);
      });
    }
  }

  it("dispose is a harmless idempotent no-op", () => {
    const adapter = new PhysJSAdapter3D();
    adapter.dispose();
    adapter.dispose();
  });
});
