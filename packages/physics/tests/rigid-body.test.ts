import { ComponentRegistry, isFourError } from "@fourjs/core";
import {
  Matrix3,
  Quaternion,
  Vector2,
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@fourjs/math";
import { Group } from "@fourjs/scene";
import { describe, expect, it, vi } from "vitest";

import { MotionComponent } from "@fourjs/motion";

import { Collider } from "../src/collider.js";
import type { RigidBodyDescriptor } from "../src/descriptors.js";
import type { RigidBodyCollisionEvent } from "../src/collider.js";
import {
  RigidBody,
  clearRigidBodyCommands,
  setRigidBodyDerivedMass,
  setRigidBodyRegistered,
  setRigidBodySleeping,
  setRigidBodyType,
} from "../src/rigid-body.js";
import { DEFAULT_ENABLED_CCD_MODE } from "../src/types.js";

/** Runs `run` and asserts it threw the §85 validation error. */
function expectValidationError(run: () => void): Error & { code: string } {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(isFourError(caught)).toBe(true);
  const error = caught as Error & { code: string };
  expect(error.code).toBe("INVALID_APPLICATION_STATE");
  return error;
}

/** A dynamic body with an authored mass — the common case in these tests. */
function dynamicBody(overrides: Partial<RigidBodyDescriptor> = {}): RigidBody {
  return new RigidBody({ type: "dynamic", mass: 2, ...overrides });
}

describe("RigidBody construction (§23)", () => {
  it("applies the neutral defaults for every omitted §23 property", () => {
    const body = new RigidBody({ type: "dynamic" });

    expect(body.type).toBe("dynamic");
    expect(body.mass).toBeUndefined();
    expect(body.centerOfMass).toEqual(new Vector3(0, 0, 0));
    expect(body.centerOfMassAuthored).toBe(false);
    expect(body.linearVelocity).toEqual(new Vector3(0, 0, 0));
    expect(body.angularVelocity).toEqual(new Vector3(0, 0, 0));
    expect(body.inertiaTensor).toBeUndefined();
    expect(body.linearDamping).toBe(0);
    expect(body.angularDamping).toBe(0);
    expect(body.gravityScale).toBe(1);
    expect(body.sleeping).toBe(false);
    expect(body.ccdMode).toBe("disabled");
    expect(body.continuousCollisionDetection).toBe(false);
    expect(body.initialPosition).toBeUndefined();
    expect(body.initialRotation).toBeUndefined();
  });

  it("keeps every §23 property it is given", () => {
    const inertia = new Matrix3().fromArray([2, 0, 0, 0, 3, 0, 0, 0, 4]);
    const body = new RigidBody({
      type: "kinematic-velocity",
      mass: 5,
      centerOfMass: new Vector3(0, 1, 2),
      inertiaTensor: inertia,
      linearVelocity: new Vector3(1, 2, 3),
      angularVelocity: new Vector3(0.1, 0.2, 0.3),
      linearDamping: 0.25,
      angularDamping: 0.5,
      gravityScale: 0,
    });

    expect(body.type).toBe("kinematic-velocity");
    expect(body.mass).toBe(5);
    expect(body.centerOfMass).toEqual(new Vector3(0, 1, 2));
    expect(body.inertiaTensor?.elements[4]).toBe(3);
    expect(body.linearVelocity).toEqual(new Vector3(1, 2, 3));
    expect(body.angularVelocity).toEqual(new Vector3(0.1, 0.2, 0.3));
    expect(body.linearDamping).toBe(0.25);
    expect(body.angularDamping).toBe(0.5);
    expect(body.gravityScale).toBe(0);
  });

  it("copies the vectors and the tensor it is given", () => {
    const velocity = new Vector3(1, 0, 0);
    const inertia = new Matrix3();
    const body = new RigidBody({
      type: "dynamic",
      linearVelocity: velocity,
      inertiaTensor: inertia,
    });

    velocity.set(9, 9, 9);
    inertia.fromArray([7, 0, 0, 0, 7, 0, 0, 0, 7]);

    expect(body.linearVelocity).toEqual(new Vector3(1, 0, 0));
    expect(body.inertiaTensor?.elements[0]).toBe(1);
  });

  it("widens the 2D convenience forms (plan P5-3)", () => {
    const body = new RigidBody({
      type: "dynamic",
      position: new Vector2(3, 4),
      rotation: Math.PI / 2,
      centerOfMass: new Vector2(1, 2),
      linearVelocity: new Vector2(5, 6),
      angularVelocity: 1.5,
    });

    expect(body.initialPosition).toEqual(new Vector3(3, 4, 0));
    expect(body.initialRotation?.z).toBeCloseTo(Math.SQRT1_2, 12);
    expect(body.initialRotation?.w).toBeCloseTo(Math.SQRT1_2, 12);
    expect(body.centerOfMass).toEqual(new Vector3(1, 2, 0));
    expect(body.linearVelocity).toEqual(new Vector3(5, 6, 0));
    expect(body.angularVelocity).toEqual(new Vector3(0, 0, 1.5));
  });

  it("keeps a quaternion initial rotation as given", () => {
    const rotation = new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0),
      0.5,
    );
    const body = new RigidBody({ type: "dynamic", rotation });
    expect(body.initialRotation).toEqual(rotation);
    expect(body.initialRotation).not.toBe(rotation);
  });

  it("rejects a descriptor that fails §23/§85 validation", () => {
    expectValidationError(() => new RigidBody({ type: "dynamic", mass: 0 }));
    expectValidationError(() => new RigidBody({ type: "static", mass: -1 }));
    expectValidationError(
      () => new RigidBody({ type: "dynamic", linearDamping: -0.1 }),
    );
    expectValidationError(
      () => new RigidBody({ type: "dynamic", gravityScale: Number.NaN }),
    );
    expectValidationError(
      () =>
        new RigidBody({
          type: "dynamic",
          inertiaTensor: new Matrix3().fromArray([-1, 0, 0, 0, 1, 0, 0, 0, 1]),
        }),
    );
    expectValidationError(
      () => new RigidBody({ type: "bogus" as RigidBodyDescriptor["type"] }),
    );
  });

  it("rejects §31's contradiction: CCD off but a sweeping mode named", () => {
    const error = expectValidationError(
      () =>
        new RigidBody({
          type: "dynamic",
          continuousCollisionDetection: false,
          ccdMode: "swept",
        }),
    );
    expect(error.message).toContain("continuousCollisionDetection");
  });
});

describe("RigidBody mass rules (§23)", () => {
  it("derives inverseMass from the body type and the mass", () => {
    expect(dynamicBody({ mass: 4 }).inverseMass).toBe(0.25);
    expect(new RigidBody({ type: "static" }).inverseMass).toBe(0);
    expect(new RigidBody({ type: "kinematic-position" }).inverseMass).toBe(0);
    expect(
      new RigidBody({ type: "kinematic-velocity", mass: 3 }).inverseMass,
    ).toBe(0);
  });

  it("reports an underived dynamic mass as NaN, never as 0", () => {
    const body = new RigidBody({ type: "dynamic" });
    expect(body.inverseMass).toBeNaN();
    body.mass = 8;
    expect(body.inverseMass).toBe(0.125);
  });

  it("re-validates the §23 mass rule on assignment", () => {
    const body = dynamicBody();
    expectValidationError(() => {
      body.mass = 0;
    });
    expect(body.mass).toBe(2);

    body.mass = undefined;
    expect(body.mass).toBeUndefined();

    const stationary = new RigidBody({ type: "static", mass: 0 });
    expect(stationary.mass).toBe(0);
  });

  it("re-validates the mass rule when the body type changes", () => {
    const body = new RigidBody({ type: "static", mass: 0 });
    expectValidationError(() => {
      body.type = "dynamic";
    });
    expect(body.type).toBe("static");

    body.mass = 1;
    body.type = "dynamic";
    expect(body.type).toBe("dynamic");
    expect(body.inverseMass).toBe(1);
  });
});

describe("RigidBody continuous collision detection (§23, §31)", () => {
  it("carries ccdPredictionDistance through toDescriptor (2026-08-05 review fix)", () => {
    // The constructor validated and accepted the field but toDescriptor()
    // dropped it, so the authored distance never reached the adapter on the
    // component path and the 1 m default silently stood in.
    const body = new RigidBody({
      type: "dynamic",
      ccdMode: "speculative",
      ccdPredictionDistance: 0.05,
    });
    expect(body.ccdPredictionDistance).toBe(0.05);
    expect(body.toDescriptor().ccdPredictionDistance).toBe(0.05);

    // Never authored: absent from the descriptor (adapter default applies).
    expect(
      new RigidBody({ type: "dynamic", ccdMode: "speculative" }).toDescriptor()
        .ccdPredictionDistance,
    ).toBeUndefined();

    // Retyped away from "speculative": the distance is withheld, so the
    // emitted descriptor stays §85-consistent (validateFor re-validates it).
    body.ccdMode = "swept";
    expect(body.toDescriptor().ccdPredictionDistance).toBeUndefined();
  });

  it("reconciles the §23 switch with the §31 mode at construction", () => {
    expect(new RigidBody({ type: "dynamic" }).ccdMode).toBe("disabled");
    expect(
      new RigidBody({ type: "dynamic", continuousCollisionDetection: true })
        .ccdMode,
    ).toBe(DEFAULT_ENABLED_CCD_MODE);
    expect(
      new RigidBody({ type: "dynamic", ccdMode: "speculative" }).ccdMode,
    ).toBe("speculative");
    expect(
      new RigidBody({
        type: "dynamic",
        continuousCollisionDetection: true,
        ccdMode: "speculative",
      }).ccdMode,
    ).toBe("speculative");
    expect(
      new RigidBody({
        type: "dynamic",
        continuousCollisionDetection: true,
        ccdMode: "disabled",
      }).ccdMode,
    ).toBe(DEFAULT_ENABLED_CCD_MODE);
    expect(
      new RigidBody({
        type: "dynamic",
        continuousCollisionDetection: false,
        ccdMode: "disabled",
      }).ccdMode,
    ).toBe("disabled");
  });

  it("keeps the boolean and the mode in agreement afterwards", () => {
    const body = dynamicBody();

    body.continuousCollisionDetection = true;
    expect(body.ccdMode).toBe(DEFAULT_ENABLED_CCD_MODE);
    expect(body.continuousCollisionDetection).toBe(true);

    body.ccdMode = "speculative";
    expect(body.continuousCollisionDetection).toBe(true);

    // Turning it on again must not overwrite the method already chosen.
    body.continuousCollisionDetection = true;
    expect(body.ccdMode).toBe("speculative");

    body.continuousCollisionDetection = false;
    expect(body.ccdMode).toBe("disabled");
    expect(body.continuousCollisionDetection).toBe(false);
  });
});

describe("RigidBody force and impulse commands (§26)", () => {
  it("accumulates forces, torques, and impulses into their buffers", () => {
    const body = dynamicBody();

    body.applyForce(new Vector3(1, 2, 3));
    body.applyForce(new Vector2(1, 1));
    body.applyTorque(new Vector3(0, 0, 2));
    body.applyTorque(3);
    body.applyImpulse(new Vector3(0, 5, 0));
    body.applyAngularImpulse(1);
    body.applyAngularImpulse(new Vector3(0, 1, 0));

    const { commands } = body;
    expect(commands.force).toEqual(new Vector3(2, 3, 3));
    expect(commands.torque).toEqual(new Vector3(0, 0, 5));
    expect(commands.impulse).toEqual(new Vector3(0, 5, 0));
    expect(commands.angularImpulse).toEqual(new Vector3(0, 1, 1));
  });

  it("records point loads in insertion order, pooling their storage", () => {
    const body = dynamicBody();

    body.applyForceAtPoint(new Vector3(1, 0, 0), new Vector3(0, 1, 0));
    body.applyForceAtPoint(new Vector2(0, 2), new Vector2(3, 0));
    body.applyImpulseAtPoint(new Vector3(0, 0, 4), new Vector3(5, 0, 0));

    const { commands } = body;
    expect(commands.pointForceCount).toBe(2);
    expect(commands.pointForces[0].value).toEqual(new Vector3(1, 0, 0));
    expect(commands.pointForces[0].point).toEqual(new Vector3(0, 1, 0));
    expect(commands.pointForces[1].value).toEqual(new Vector3(0, 2, 0));
    expect(commands.pointForces[1].point).toEqual(new Vector3(3, 0, 0));
    expect(commands.pointImpulseCount).toBe(1);
    expect(commands.pointImpulses[0].value).toEqual(new Vector3(0, 0, 4));
    expect(commands.pointImpulses[0].point).toEqual(new Vector3(5, 0, 0));
  });

  it("clears every buffer but keeps the pooled slots", () => {
    const body = dynamicBody();
    body.applyForce(new Vector3(1, 1, 1));
    body.applyTorque(1);
    body.applyImpulse(new Vector3(1, 1, 1));
    body.applyAngularImpulse(1);
    body.applyForceAtPoint(new Vector3(1, 0, 0), new Vector3());
    body.applyImpulseAtPoint(new Vector3(1, 0, 0), new Vector3());
    body.sleep();

    const { commands } = body;
    const pooledForce = commands.pointForces[0];
    const pooledImpulse = commands.pointImpulses[0];

    clearRigidBodyCommands(body);

    expect(commands.force).toEqual(new Vector3(0, 0, 0));
    expect(commands.torque).toEqual(new Vector3(0, 0, 0));
    expect(commands.impulse).toEqual(new Vector3(0, 0, 0));
    expect(commands.angularImpulse).toEqual(new Vector3(0, 0, 0));
    expect(commands.pointForceCount).toBe(0);
    expect(commands.pointImpulseCount).toBe(0);
    expect(commands.sleepCommand).toBeNull();
    expect(commands.pointForces).toHaveLength(1);
    expect(commands.pointImpulses).toHaveLength(1);

    body.applyForceAtPoint(new Vector3(2, 0, 0), new Vector3());
    body.applyImpulseAtPoint(new Vector3(2, 0, 0), new Vector3());
    expect(commands.pointForces[0]).toBe(pooledForce);
    expect(commands.pointImpulses[0]).toBe(pooledImpulse);
    expect(pooledForce.value).toEqual(new Vector3(2, 0, 0));
  });

  it("allocates nothing once the pools have grown (§7b, plan D7)", () => {
    const body = dynamicBody();
    const force = new Vector3(1, 0, 0);
    const point = new Vector3(0, 1, 0);

    const accumulate = (): void => {
      body.applyForce(force);
      body.applyTorque(1);
      body.applyImpulse(force);
      body.applyAngularImpulse(force);
      body.applyForceAtPoint(force, point);
      body.applyForceAtPoint(force, point);
      body.applyImpulseAtPoint(force, point);
    };

    accumulate();
    clearRigidBodyCommands(body);

    resetConstructionCount();
    for (let step = 0; step < 4; step += 1) {
      accumulate();
      clearRigidBodyCommands(body);
    }
    expect(constructionCount()).toBe(0);
  });
});

describe("RigidBody sleeping (§23, §32)", () => {
  it("queues wake and sleep commands without changing the state", () => {
    const body = dynamicBody();

    body.wake();
    expect(body.commands.sleepCommand).toBe("wake");
    expect(body.sleeping).toBe(false);

    body.sleep();
    expect(body.commands.sleepCommand).toBe("sleep");
    expect(body.sleeping).toBe(false);
  });

  it("publishes solver-reported transitions through the internal setter", () => {
    const body = dynamicBody();

    expect(setRigidBodySleeping(body, false)).toBe(false);
    expect(setRigidBodySleeping(body, true)).toBe(true);
    expect(body.sleeping).toBe(true);
    expect(setRigidBodySleeping(body, true)).toBe(false);
    expect(setRigidBodySleeping(body, false)).toBe(true);
    expect(body.sleeping).toBe(false);
  });
});

describe("RigidBody events (§29, §32, §6b)", () => {
  it("delivers §29 collision payloads to subscribers in registration order", () => {
    const body = dynamicBody();
    const other = dynamicBody();
    const collider = new Collider({ shape: { type: "sphere", radius: 1 } });
    const otherCollider = new Collider({
      shape: { type: "sphere", radius: 1 },
    });
    const event: RigidBodyCollisionEvent = {
      type: "collisionstart",
      bodyA: body,
      bodyB: other,
      colliderA: collider,
      colliderB: otherCollider,
      contacts: [],
      relativeVelocity: new Vector3(0, -1, 0),
      totalImpulse: new Vector3(0, 2, 0),
    };

    const seen: string[] = [];
    const unsubscribe = body.on("collisionstart", (received) => {
      seen.push("first");
      expect(received).toBe(event);
      expect(received.bodyA).toBe(body);
      expect(received.colliderB).toBe(otherCollider);
    });
    body.on("collisionstart", () => seen.push("second"));

    body.emit("collisionstart", event);
    expect(seen).toEqual(["first", "second"]);

    unsubscribe();
    body.emit("collisionstart", event);
    expect(seen).toEqual(["first", "second", "second"]);
  });

  it("carries the §32 sleep payloads", () => {
    const body = dynamicBody();
    const seen: string[] = [];
    body.on("sleep", (event) => seen.push(event.type));
    body.on("wake", (event) => seen.push(event.type));

    body.emit("sleep", { type: "sleep", body });
    body.emit("wake", { type: "wake", body });
    expect(seen).toEqual(["sleep", "wake"]);
  });
});

describe("RigidBody world registration (§21, §37)", () => {
  it("produces the descriptor an adapter is handed", () => {
    const inertia = new Matrix3();
    const body = new RigidBody({
      type: "dynamic",
      mass: 3,
      // Authored, so the descriptor carries the whole §23 mass triple — which
      // is the only shape in which an adapter accepts a distribution.
      centerOfMass: new Vector3(0, 0.25, 0),
      inertiaTensor: inertia,
      position: new Vector2(1, 2),
      rotation: 0,
      linearDamping: 0.5,
      ccdMode: "swept",
    });

    const descriptor = body.toDescriptor();
    expect(descriptor.type).toBe("dynamic");
    expect(descriptor.mass).toBe(3);
    expect(descriptor.linearDamping).toBe(0.5);
    expect(descriptor.gravityScale).toBe(1);
    expect(descriptor.ccdMode).toBe("swept");
    expect(descriptor.continuousCollisionDetection).toBe(true);
    // Live references, not copies.
    expect(descriptor.centerOfMass).toBe(body.centerOfMass);
    expect(descriptor.linearVelocity).toBe(body.linearVelocity);
    expect(descriptor.angularVelocity).toBe(body.angularVelocity);
    expect(descriptor.inertiaTensor).toBe(body.inertiaTensor);
    expect(descriptor.position).toBe(body.initialPosition);
    expect(descriptor.rotation).toBe(body.initialRotation);
  });

  it("omits the fields that were never authored", () => {
    const descriptor = new RigidBody({ type: "static" }).toDescriptor();
    expect("mass" in descriptor).toBe(false);
    expect("centerOfMass" in descriptor).toBe(false);
    expect("inertiaTensor" in descriptor).toBe(false);
    expect("position" in descriptor).toBe(false);
    expect("rotation" in descriptor).toBe(false);
    // What is left is every §23 field that has a real default.
    expect(Object.keys(descriptor).sort()).toEqual([
      "angularDamping",
      "angularVelocity",
      "ccdMode",
      "continuousCollisionDetection",
      "gravityScale",
      "linearDamping",
      "linearVelocity",
      "type",
    ]);
  });

  it('accepts a planar body in a "2d" world and rejects an out-of-plane one', () => {
    const planar = new RigidBody({
      type: "dynamic",
      mass: 1,
      position: new Vector2(1, 2),
      angularVelocity: 2,
    });
    expect(() => {
      planar.validateFor("2d");
    }).not.toThrow();
    expect(() => {
      planar.validateFor("3d");
    }).not.toThrow();

    const spatial = new RigidBody({
      type: "dynamic",
      mass: 1,
      centerOfMass: new Vector3(0, 0, 1),
    });
    expect(() => {
      spatial.validateFor("3d");
    }).not.toThrow();
    const error = expectValidationError(() => {
      spatial.validateFor("2d");
    });
    expect(error.message).toContain("centerOfMass.z");
  });

  it("keeps an authored out-of-plane centre of mass checkable in 2d", () => {
    // The omission must not create a validation hole: an unauthored centre is
    // at the origin, which is planar, so nothing that a `"2d"` world would have
    // rejected stops being rejected (§21, §85).
    const body = new RigidBody({ type: "dynamic", mass: 1 });
    expect(() => {
      body.validateFor("2d");
    }).not.toThrow();

    body.centerOfMass.set(0, 0, 0.5);
    const error = expectValidationError(() => {
      body.validateFor("2d");
    });
    expect(error.message).toContain("centerOfMass.z");
  });

  it("catches a body type corrupted after construction at registration", () => {
    const body = dynamicBody();
    body.type = "bogus" as RigidBodyDescriptor["type"];
    expectValidationError(() => {
      body.validateFor("3d");
    });
  });
});

describe("RigidBody authored centre of mass (§23, §25; WP-5.2-fix1)", () => {
  it("treats an unauthored origin centre as no mass distribution at all", () => {
    // The defect this suite pins: `centerOfMass` is always present on the
    // component (§23), so emitting it unconditionally told every adapter that
    // every body carried an authored mass distribution — and a distribution
    // with no mass is refused, which put §23's density-derived mass out of
    // reach of the component API entirely.
    const body = new RigidBody({ type: "dynamic" });
    const descriptor = body.toDescriptor();

    expect(body.centerOfMassAuthored).toBe(false);
    expect("centerOfMass" in descriptor).toBe(false);
    // …and the descriptor carries no mass either, which is what asks the
    // solver to derive one from collider density times volume (§23, §25).
    expect("mass" in descriptor).toBe(false);
    expect("inertiaTensor" in descriptor).toBe(false);
  });

  it("keeps a descriptor-authored centre, even at the origin", () => {
    // Rule 1, the sticky half: an explicit origin is a real instruction ("pin
    // the centre to the body origin, whatever the colliders say") and is the
    // one authored value the live half below cannot see.
    const body = new RigidBody({
      type: "dynamic",
      mass: 2,
      centerOfMass: new Vector3(0, 0, 0),
    });

    expect(body.centerOfMassAuthored).toBe(true);
    expect(body.toDescriptor().centerOfMass).toBe(body.centerOfMass);
  });

  it("detects a centre moved after construction, with no announcement", () => {
    // Rule 2, the live half: mutation is how §23 says a centre is written
    // (`centerOfMass` is a live vector that is never replaced), so the check
    // has to read the vector rather than trust a flag set at construction.
    const body = new RigidBody({ type: "dynamic", mass: 2 });
    expect(body.centerOfMassAuthored).toBe(false);

    body.centerOfMass.set(0.25, 0, 0);
    expect(body.centerOfMassAuthored).toBe(true);
    expect(body.toDescriptor().centerOfMass).toBe(body.centerOfMass);

    // And moving it back stops claiming a distribution: the value is once
    // again indistinguishable from the default, so nothing is being asked for.
    body.centerOfMass.set(0, 0, 0);
    expect(body.centerOfMassAuthored).toBe(false);
    expect("centerOfMass" in body.toDescriptor()).toBe(false);
  });

  it("reads -0 as the origin and a non-finite component as authored", () => {
    const negativeZero = new RigidBody({ type: "dynamic", mass: 1 });
    negativeZero.centerOfMass.set(-0, -0, -0);
    expect(negativeZero.centerOfMassAuthored).toBe(false);

    // Not silently dropped: emitting it is what lets §85 validation reject it.
    const broken = new RigidBody({ type: "dynamic", mass: 1 });
    broken.centerOfMass.set(Number.NaN, 0, 0);
    expect(broken.centerOfMassAuthored).toBe(true);
    expectValidationError(() => {
      broken.validateFor("3d");
    });
  });

  it("pins an origin centre on request, one way (markCenterOfMassAuthored)", () => {
    const body = new RigidBody({ type: "dynamic", mass: 2 });
    expect("centerOfMass" in body.toDescriptor()).toBe(false);

    body.markCenterOfMassAuthored();

    expect(body.centerOfMassAuthored).toBe(true);
    expect(body.toDescriptor().centerOfMass).toBe(body.centerOfMass);
    expect(body.centerOfMass).toEqual(new Vector3(0, 0, 0));
    // One way: moving the vector around cannot un-author it.
    body.centerOfMass.set(1, 0, 0);
    body.centerOfMass.set(0, 0, 0);
    expect(body.centerOfMassAuthored).toBe(true);
  });

  it("has no equivalent latent issue on inertiaTensor", () => {
    // `inertiaTensor` is optional and starts `undefined`, so `undefined` is
    // already its authored flag and `toDescriptor` already omitted it. This
    // case exists so that giving it a non-`undefined` default later fails here
    // rather than in an adapter.
    const body = new RigidBody({ type: "dynamic", mass: 1 });
    expect(body.inertiaTensor).toBeUndefined();
    expect("inertiaTensor" in body.toDescriptor()).toBe(false);

    body.inertiaTensor = new Matrix3();
    expect(body.toDescriptor().inertiaTensor).toBe(body.inertiaTensor);
  });
});

describe("RigidBody as a §6a component", () => {
  it("attaches to a node and is found by type", () => {
    const node = new Group();
    const body = node.addComponent(dynamicBody());

    expect(body.host).toBe(node);
    expect(node.getComponent(RigidBody)).toBe(body);

    expect(node.removeComponent(body)).toBe(true);
    expect(body.host).toBeNull();
    expect(node.getComponent(RigidBody)).toBeUndefined();
  });

  it("is one per node, and coexists with other component types", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const node = new Group();
    const first = node.addComponent(dynamicBody());
    const motion = node.addComponent(new MotionComponent());
    const second = node.addComponent(dynamicBody());

    expect(node.getComponent(RigidBody)).toBe(second);
    expect(node.getComponent(MotionComponent)).toBe(motion);
    expect(first.host).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("drops listeners and queued commands on dispose (§83)", () => {
    const registry = new ComponentRegistry();
    const body = registry.add(dynamicBody());
    const seen: string[] = [];
    body.on("wake", () => seen.push("wake"));
    body.applyForce(new Vector3(1, 0, 0));
    body.wake();

    registry.disposeAll();

    expect(body.host).toBeNull();
    expect(body.listenerCount("wake")).toBe(0);
    expect(body.commands.force).toEqual(new Vector3(0, 0, 0));
    expect(body.commands.sleepCommand).toBeNull();
    body.emit("wake", { type: "wake", body });
    expect(seen).toEqual([]);
  });
});

describe("RigidBody blend weights (§19, P7-2)", () => {
  it("defaults to fully physical: physicsWeight 1, animationWeight 0", () => {
    const body = dynamicBody();

    expect(body.physicsWeight).toBe(1);
    expect(body.animationWeight).toBe(0);
    expect(body.normalizedWeights()).toEqual({ physics: 1, animation: 0 });
  });

  it("takes §19's sketch verbatim", () => {
    const body = dynamicBody();
    body.physicsWeight = 0.35;
    body.animationWeight = 0.65;

    expect(body.physicsWeight).toBe(0.35);
    expect(body.animationWeight).toBe(0.65);
    const split = body.normalizedWeights();
    expect(split.physics).toBeCloseTo(0.35, 12);
    expect(split.animation).toBeCloseTo(0.65, 12);
  });

  it("keeps the two weights independent — setting one never rewrites the other", () => {
    const body = dynamicBody();
    body.animationWeight = 0.25;

    expect(body.physicsWeight).toBe(1);
    expect(body.animationWeight).toBe(0.25);
  });

  it("normalizes at use, so unnormalized weights describe the same blend", () => {
    const a = dynamicBody();
    a.physicsWeight = 0.35;
    a.animationWeight = 0.65;
    const b = dynamicBody();
    b.physicsWeight = 35;
    b.animationWeight = 65;

    const first = a.normalizedWeights();
    const second = b.normalizedWeights();
    expect(second.physics).toBeCloseTo(first.physics, 12);
    expect(second.animation).toBeCloseTo(first.animation, 12);
    expect(second.physics + second.animation).toBeCloseTo(1, 12);
  });

  it("supports the two pure ends of the blend", () => {
    const body = dynamicBody();

    body.physicsWeight = 0;
    body.animationWeight = 3;
    expect(body.normalizedWeights()).toEqual({ physics: 0, animation: 1 });

    body.physicsWeight = 3;
    body.animationWeight = 0;
    expect(body.normalizedWeights()).toEqual({ physics: 1, animation: 0 });
  });

  it("writes into an `out` record and allocates nothing on a per-step path", () => {
    const body = dynamicBody();
    body.physicsWeight = 1;
    body.animationWeight = 3;
    const out = { physics: 0, animation: 0 };

    const returned = body.normalizedWeights(out);

    expect(returned).toBe(out);
    expect(out.physics).toBeCloseTo(0.25, 12);
    expect(out.animation).toBeCloseTo(0.75, 12);
  });

  it("rejects negative and non-finite weights (§85)", () => {
    const body = dynamicBody();

    for (const bad of [-1, -0.001, Number.NaN, Number.POSITIVE_INFINITY]) {
      const error = expectValidationError(() => {
        body.physicsWeight = bad;
      });
      expect(error.message).toContain("physicsWeight");
      expectValidationError(() => {
        body.animationWeight = bad;
      });
    }

    // Nothing was applied by a rejected assignment.
    expect(body.physicsWeight).toBe(1);
    expect(body.animationWeight).toBe(0);
  });

  it("accepts zero on either weight", () => {
    const body = dynamicBody();
    body.physicsWeight = 0;
    expect(body.physicsWeight).toBe(0);
    body.animationWeight = 0;
    expect(body.animationWeight).toBe(0);
  });

  it("falls back to fully physical when both weights are zero, warning once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const body = dynamicBody();
    body.physicsWeight = 0;

    expect(body.normalizedWeights()).toEqual({ physics: 1, animation: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("§19");

    for (let i = 0; i < 10; i += 1) {
      body.normalizedWeights();
    }
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("suppresses the both-zero warning per body, not globally", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const first = dynamicBody();
    const second = dynamicBody();
    first.physicsWeight = 0;
    second.physicsWeight = 0;

    first.normalizedWeights();
    second.normalizedWeights();

    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("keeps the suppression sticky once a body has warned", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const body = dynamicBody();
    body.physicsWeight = 0;
    body.normalizedWeights();

    body.physicsWeight = 1;
    expect(body.normalizedWeights()).toEqual({ physics: 1, animation: 0 });
    body.physicsWeight = 0;
    body.normalizedWeights();

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("keeps the ratio when the two weights sum past Number.MAX_VALUE", () => {
    const body = dynamicBody();
    body.physicsWeight = Number.MAX_VALUE;
    body.animationWeight = Number.MAX_VALUE;

    const split = body.normalizedWeights();

    expect(split.physics).toBeCloseTo(0.5, 12);
    expect(split.animation).toBeCloseTo(0.5, 12);
  });

  it("keeps an asymmetric ratio through the same overflow", () => {
    const body = dynamicBody();
    body.physicsWeight = Number.MAX_VALUE;
    body.animationWeight = Number.MAX_VALUE / 3;

    const split = body.normalizedWeights();

    expect(split.physics).toBeCloseTo(0.75, 12);
    expect(split.animation).toBeCloseTo(0.25, 12);
    expect(split.physics + split.animation).toBeCloseTo(1, 12);
  });

  it("keeps blend weights out of the solver descriptor (§37)", () => {
    const body = dynamicBody();
    body.physicsWeight = 0.35;
    body.animationWeight = 0.65;

    const descriptor = body.toDescriptor();

    expect("physicsWeight" in descriptor).toBe(false);
    expect("animationWeight" in descriptor).toBe(false);
  });

  it("is per body, not shared", () => {
    const a = dynamicBody();
    const b = dynamicBody();
    a.animationWeight = 0.5;

    expect(b.animationWeight).toBe(0);
  });
});

describe("RigidBody authored mass (§23, §25; 2026-08-06)", () => {
  it("distinguishes an authored mass from a solver-derived one", () => {
    // The defect this suite pins: `PhysicsWorld.addBody` read the solver's
    // derived mass back through the `mass` *setter*, which authored it — so
    // `toDescriptor()` re-emitted a number the author never wrote, and
    // re-registering the body froze a mass that was meant to follow the
    // colliders. The two are now separate channels.
    const derived = new RigidBody({ type: "dynamic" });
    expect(derived.massAuthored).toBe(false);
    expect(derived.derivedMass).toBeUndefined();

    setRigidBodyDerivedMass(derived, 3.5);
    // Reported — so `inverseMass` is a number, as §23 wants — but not authored.
    expect(derived.mass).toBe(3.5);
    expect(derived.derivedMass).toBe(3.5);
    expect(derived.inverseMass).toBeCloseTo(1 / 3.5, 12);
    expect(derived.massAuthored).toBe(false);
    expect("mass" in derived.toDescriptor()).toBe(false);
  });

  it("emits an authored mass and lets a later derivation stay silent", () => {
    const body = new RigidBody({ type: "dynamic", mass: 2 });
    expect(body.massAuthored).toBe(true);
    expect(body.toDescriptor().mass).toBe(2);

    // A solver may report something else (a collider's own mass properties
    // win in some mass modes); the authored value is still what is re-emitted.
    setRigidBodyDerivedMass(body, 9);
    expect(body.mass).toBe(2);
    expect(body.derivedMass).toBe(9);
    expect(body.toDescriptor().mass).toBe(2);
  });

  it("authors a mass on assignment and un-authors it on undefined", () => {
    const body = new RigidBody({ type: "dynamic" });
    body.mass = 4;
    expect(body.massAuthored).toBe(true);
    expect(body.toDescriptor().mass).toBe(4);

    body.mass = undefined;
    expect(body.massAuthored).toBe(false);
    expect("mass" in body.toDescriptor()).toBe(false);
    // The derived mirror is untouched by authoring: it is the solver's field.
    setRigidBodyDerivedMass(body, 6);
    body.mass = 5;
    expect(body.mass).toBe(5);
    expect(body.derivedMass).toBe(6);
  });
});

describe("RigidBody writes that reach no solver (§23, §37; 2026-08-06)", () => {
  /** A registered dynamic body: the state the drift warnings are gated on. */
  function registeredBody(): RigidBody {
    const body = dynamicBody();
    setRigidBodyRegistered(body, true, false);
    return body;
  }

  it("warns once per property on a registered dynamic body", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const body = registeredBody();

    body.mass = 3;
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("getBodyHandle");
    body.mass = 4;
    body.mass = 5;
    expect(warn).toHaveBeenCalledTimes(1);
    expect(body.mass).toBe(5);

    // A different property is a different mistake and warns on its own.
    body.linearDamping = 0.5;
    body.angularDamping = 0.25;
    body.gravityScale = 0;
    expect(warn).toHaveBeenCalledTimes(4);
    body.linearDamping = 0.75;
    expect(warn).toHaveBeenCalledTimes(4);

    // Every value still landed on the component.
    expect(body.linearDamping).toBe(0.75);
    expect(body.angularDamping).toBe(0.25);
    expect(body.gravityScale).toBe(0);
    warn.mockRestore();
  });

  // 2026-08-07: the warning is one-shot per body per field, and a
  // self-assignment cannot have desynchronized anything — spending the single
  // warning on a no-op would silence the write that follows it.
  it("does not spend the one warning on an assignment that changes nothing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const body = registeredBody();

    // oxlint-disable-next-line no-self-assign -- the test is that a no-op write must not spend the one-shot warning
    body.mass = body.mass;
    // oxlint-disable-next-line no-self-assign -- same: linearDamping slot stays armed
    body.linearDamping = body.linearDamping;
    // oxlint-disable-next-line no-self-assign -- same: angularDamping slot stays armed
    body.angularDamping = body.angularDamping;
    // oxlint-disable-next-line no-self-assign -- same: gravityScale slot stays armed
    body.gravityScale = body.gravityScale;
    expect(warn).not.toHaveBeenCalled();

    // The slots are all still armed: each real change warns exactly once.
    body.mass = 7;
    body.linearDamping = 0.5;
    body.angularDamping = 0.25;
    body.gravityScale = 0;
    expect(warn).toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });

  it("counts authoring a solver-derived mass as a change (§23)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // No authored mass: this body is asking the solver to derive one.
    const body = new RigidBody({ type: "dynamic" });
    setRigidBodyRegistered(body, true, false);
    setRigidBodyDerivedMass(body, 4);
    expect(body.mass).toBe(4);
    expect(body.massAuthored).toBe(false);

    // The *reported* mass is unchanged, but "derive my mass" just became "my
    // mass is 4", which `toDescriptor` now emits — a change, and warned about.
    body.mass = 4;

    expect(warn).toHaveBeenCalledTimes(1);
    expect(body.massAuthored).toBe(true);
    warn.mockRestore();
  });

  it("says nothing for an unregistered body or a non-dynamic one", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const loose = dynamicBody();
    loose.mass = 3;
    loose.linearDamping = 1;
    expect(warn).not.toHaveBeenCalled();

    // Registered, but static: its damping and gravity scale change nothing in
    // any solver, so there is no divergence to report.
    const stationary = new RigidBody({ type: "static" });
    setRigidBodyRegistered(stationary, true, false);
    stationary.linearDamping = 1;
    stationary.gravityScale = 2;
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("stops warning once the last world lets go", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const body = dynamicBody();

    // Two worlds may hold one component; the body stops being registered when
    // the last of them releases it.
    setRigidBodyRegistered(body, true, false);
    setRigidBodyRegistered(body, true, false);
    expect(body.registeredWorldCount).toBe(2);
    setRigidBodyRegistered(body, false, false);
    expect(body.registeredWorldCount).toBe(1);

    body.linearDamping = 1;
    expect(warn).toHaveBeenCalledTimes(1);

    setRigidBodyRegistered(body, false, false);
    expect(body.registeredWorldCount).toBe(0);
    // Floored at zero, so an unpaired release cannot silence a later warning.
    setRigidBodyRegistered(body, false, false);
    expect(body.registeredWorldCount).toBe(0);

    const other = dynamicBody();
    other.angularDamping = 1;
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("warns when a registered body's §22 type is assigned directly", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const body = registeredBody();

    body.type = "kinematic-position";
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("setBodyControlMode");
    expect(body.type).toBe("kinematic-position");

    // Still once, and still warning for a body that is no longer dynamic —
    // the mismatch is between component and solver, whatever the type is.
    body.type = "static";
    expect(warn).toHaveBeenCalledTimes(1);

    // Assigning the type it already has asks for nothing and says nothing.
    const quiet = registeredBody();
    quiet.type = "dynamic";
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("says nothing when the world re-types the body itself", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const body = registeredBody();

    // `PhysicsWorld.setBodyControlMode` goes through this writer *after*
    // re-typing the solver body, so component and solver agree.
    setRigidBodyType(body, "kinematic-velocity");
    expect(body.type).toBe("kinematic-velocity");
    expect(warn).not.toHaveBeenCalled();

    // The §23 mass rule is still enforced on that path, and a rejected write
    // leaves both the flag and the type alone.
    const zero = new RigidBody({ type: "static", mass: 0 });
    setRigidBodyRegistered(zero, true, false);
    expectValidationError(() => {
      setRigidBodyType(zero, "dynamic");
    });
    expect(zero.type).toBe("static");
    zero.type = "kinematic-position";
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("RigidBody disposal (§83 stability audit, 2026-09-11)", () => {
  it("disposes idempotently and refuses commands and registration afterwards", () => {
    const body = dynamicBody();
    const listener = vi.fn();
    body.on("sleep", listener);
    body.applyForce(new Vector3(1, 0, 0));
    expect(body.disposed).toBe(false);

    body.dispose();
    expect(body.disposed).toBe(true);
    expect(body.commands.force).toEqual(new Vector3(0, 0, 0));
    expect(body.listenerCount("sleep")).toBe(0);
    // A second dispose is a no-op (§83: idempotent), not an error.
    expect(() => body.dispose()).not.toThrow();
    expect(body.disposed).toBe(true);

    // Disposal is terminal (§83): the §26/§32 commands and the world's
    // registration gate refuse with §89's INVALID_APPLICATION_STATE.
    expect(
      expectValidationError(() => body.applyForce(new Vector3(1, 0, 0)))
        .message,
    ).toMatch(/RigidBody is disposed.*§83/s);
    expectValidationError(() =>
      body.applyForceAtPoint(new Vector3(), new Vector3()),
    );
    expectValidationError(() => body.applyTorque(1));
    expectValidationError(() => body.applyImpulse(new Vector3(1, 0, 0)));
    expectValidationError(() =>
      body.applyImpulseAtPoint(new Vector3(), new Vector3()),
    );
    expectValidationError(() => body.applyAngularImpulse(1));
    expectValidationError(() => body.wake());
    expectValidationError(() => body.sleep());
    expectValidationError(() => body.validateFor("3d"));
    // Nothing leaked into the queue on the way to the throw.
    expect(body.commands.force).toEqual(new Vector3(0, 0, 0));
    expect(body.commands.sleepCommand).toBeNull();
    // Reads and the descriptor snapshot stay answerable for teardown code.
    expect(body.type).toBe("dynamic");
    expect(body.toDescriptor().type).toBe("dynamic");
  });
});
