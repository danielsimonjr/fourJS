import { Matrix3, Quaternion, Vector2, Vector3 } from "@fourjs/math";
import {
  supportsSolverBodyTuning,
  supportsSolverJointAccess,
} from "@fourjs/physics";
import type { PhysicsBodyHandle } from "@fourjs/physics";

import { describe, expect, it } from "vitest";

import { Box2dAdapter } from "../src/index.js";

const DT = 1 / 60;

function make(): Box2dAdapter {
  const adapter = new Box2dAdapter();
  adapter.initialize({ dimension: "2d", gravity: new Vector2(0, -9.81) });
  return adapter;
}

function body(
  a: Box2dAdapter,
  x: number,
  y: number,
  type: "dynamic" | "static" = "dynamic",
  extra: { mass?: number } = {},
): PhysicsBodyHandle {
  const h = a.createBody({
    type,
    position: new Vector2(x, y),
    ...extra,
  });
  a.createCollider({
    body: h,
    shape: { type: "circle", radius: 0.25 },
    density: 1,
    sensor: false,
    collisionMask: 0,
  });
  return h;
}

function pos(a: Box2dAdapter, h: PhysicsBodyHandle): Vector3 {
  const p = new Vector3();
  a.getBodyTransform(h, p, new Quaternion());
  return p;
}

function vel(a: Box2dAdapter, h: PhysicsBodyHandle): [number, number] {
  const l = new Vector3();
  const w = new Vector3();
  a.getBodyVelocities(h, l, w);
  return [l.x, w.z];
}

function run(a: Box2dAdapter, n: number): void {
  for (let i = 0; i < n; i += 1) {
    a.step(DT);
  }
}

describe("seams", () => {
  it("is structurally a SolverJointAccess and SolverBodyTuningAccess", () => {
    const a = make();
    expect(supportsSolverJointAccess(a)).toBe(true);
    expect(supportsSolverBodyTuning(a)).toBe(true);
    expect(a.reportsJointReactions).toBe(true);
  });
});

describe("joint constraints under gravity", () => {
  it("revolute: a pendulum keeps its arm length", () => {
    const a = make();
    const anchor = body(a, 0, 0, "static");
    const bob = body(a, 2, 0);
    a.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: bob,
      anchorA: new Vector3(0, 0, 0),
      anchorB: new Vector3(-2, 0, 0),
    });
    let minY = 0;
    for (let i = 0; i < 240; i += 1) {
      a.step(DT);
      const p = pos(a, bob);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(2, 1);
      minY = Math.min(minY, p.y);
    }
    expect(minY).toBeLessThan(-1.9);
  });

  it("prismatic: a slider stays on its axis", () => {
    const a = make();
    const rail = body(a, 0, 0, "static");
    const car = body(a, 0, 0);
    a.createJoint({
      type: "prismatic",
      bodyA: rail,
      bodyB: car,
      axis: new Vector3(1, 0, 0),
    });
    a.setBodyVelocities(car, new Vector3(3, 0, 0), new Vector3());
    run(a, 60);
    const p = pos(a, car);
    expect(Math.abs(p.y)).toBeLessThan(0.01);
    expect(p.x).toBeGreaterThan(2);
  });

  it("prismatic: a vertical slider hangs under gravity unless limited", () => {
    const a = make();
    const rail = body(a, 0, 0, "static");
    const car = body(a, 0, 0);
    a.createJoint({
      type: "prismatic",
      bodyA: rail,
      bodyB: car,
      axis: new Vector3(0, 2, 0),
      limits: { min: -1, max: 1 },
    });
    run(a, 180);
    const p = pos(a, car);
    expect(p.y).toBeCloseTo(-1, 1);
    expect(Math.abs(p.x)).toBeLessThan(0.01);
  });

  it("fixed: a welded body does not fall or turn", () => {
    const a = make();
    const wall = body(a, 0, 0, "static");
    const box = body(a, 1, 0);
    a.createJoint({
      type: "fixed",
      bodyA: wall,
      bodyB: box,
      anchorA: new Vector3(1, 0, 0),
      anchorB: new Vector3(0, 0, 0),
    });
    run(a, 120);
    const p = pos(a, box);
    expect(p.x).toBeCloseTo(1, 1);
    expect(p.y).toBeCloseTo(0, 1);
  });

  it("rope: stops at max length but is slack inside it", () => {
    const a = make();
    const top = body(a, 0, 0, "static");
    const weight = body(a, 0, -1);
    a.createJoint({ type: "rope", bodyA: top, bodyB: weight, maxLength: 3 });
    run(a, 240);
    expect(pos(a, weight).y).toBeCloseTo(-3, 1);
    const free = body(a, 5, 0, "static");
    const slack = body(a, 5, -1);
    a.createJoint({ type: "rope", bodyA: free, bodyB: slack, maxLength: 3 });
    a.step(DT);
    expect(pos(a, slack).y).toBeLessThan(-1.0);
  });

  it("spring: oscillates about the equilibrium extension", () => {
    const a = make();
    const top = body(a, 0, 0, "static");
    const weight = body(a, 0, -2, "dynamic", { mass: 1 });
    a.createJoint({
      type: "spring",
      bodyA: top,
      bodyB: weight,
      restLength: 2,
      stiffness: 40,
      damping: 0.2,
    });
    let min = 0;
    let max = -10;
    for (let i = 0; i < 300; i += 1) {
      a.step(DT);
      const y = pos(a, weight).y;
      min = Math.min(min, y);
      max = Math.max(max, y);
    }
    // equilibrium at -(2 + m g / k)
    const eq = -(2 + 9.81 / 40);
    expect(min).toBeLessThan(eq - 0.1);
    expect(max).toBeGreaterThan(eq + 0.1);
    expect(max).toBeLessThanOrEqual(-2 + 0.05);
  });
});

describe("limits and motors", () => {
  it("revolute limits clamp and can be changed live", () => {
    const a = make();
    const anchor = body(a, 0, 0, "static");
    const bar = body(a, 1, 0);
    const j = a.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: bar,
      anchorB: new Vector3(-1, 0, 0),
      limits: { min: -0.5, max: 0 },
    });
    run(a, 240);
    const angle = (): number => {
      const p = pos(a, bar);
      return Math.atan2(p.y, p.x);
    };
    expect(angle()).toBeGreaterThan(-0.55);
    a.setJointLimits(j, -1, 0);
    a.wakeBody(bar);
    run(a, 240);
    expect(angle()).toBeLessThan(-0.9);
    expect(angle()).toBeGreaterThan(-1.05);
  });

  it("a -Z revolute mirrors limits and motor rate", () => {
    const a = make();
    const anchor = body(a, 0, 0, "static");
    const bar = body(a, 1, 0);
    const j = a.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: bar,
      anchorB: new Vector3(-1, 0, 0),
      axis: new Vector3(0, 0, -1),
      limits: { min: 0, max: 0.5 },
    });
    run(a, 240);
    const p = pos(a, bar);
    expect(Math.atan2(p.y, p.x)).toBeLessThan(-0.45);
    a.setJointMotor(j, { enabled: true, targetVelocity: 1, maxEffort: 1e6 });
    run(a, 10);
    expect(a.getJointId(j)).toBe(1);
  });

  it("a prismatic motor drives the slider", () => {
    const a = make();
    const rail = body(a, 0, 0, "static");
    const car = body(a, 0, 0);
    a.createJoint({
      type: "prismatic",
      bodyA: rail,
      bodyB: car,
      axis: new Vector3(1, 0, 0),
      motor: { targetVelocity: 2, maxForce: 1000 },
    });
    run(a, 60);
    expect(vel(a, car)[0]).toBeCloseTo(2, 1);
    expect(pos(a, car).x).toBeGreaterThan(1.5);
  });

  it("a revolute motor drives to the target rate, and disabling releases it", () => {
    const a = make();
    const anchor = body(a, 0, 0, "static");
    const wheel = body(a, 0, 0);
    const j = a.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: wheel,
      motor: { targetVelocity: 3, maxTorque: 100 },
    });
    run(a, 60);
    expect(vel(a, wheel)[1]).toBeCloseTo(3, 1);
    a.setJointMotor(j, { enabled: false, targetVelocity: 3, maxEffort: 100 });
    run(a, 30);
    expect(vel(a, wheel)[1]).toBeCloseTo(3, 1);
  });

  it("the motor effort is a hard cap (jointMotorEffortCap)", () => {
    const a = make();
    const anchor = body(a, 0, 0, "static");
    const heavy = a.createBody({
      type: "dynamic",
      position: new Vector2(0, 0),
      mass: 1000,
    });
    a.createCollider({
      body: heavy,
      shape: { type: "circle", radius: 0.5 },
    });
    const cap = 5;
    const j = a.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: heavy,
      motor: { targetVelocity: 50, maxTorque: cap },
    });
    let worst = 0;
    const out = new Vector3();
    const lin = new Vector3();
    for (let i = 0; i < 120; i += 1) {
      a.step(DT);
      a.getJointReaction(j, lin, out);
      worst = Math.max(worst, Math.abs(out.z));
    }
    // Reaction torque is the impulse (N m s) of the last step; the motor
    // cannot exceed cap * dt per step.
    expect(worst).toBeLessThanOrEqual(cap * DT * (1 + 1e-6));
    expect(worst).toBeGreaterThan(cap * DT * 0.99);
    // and the load really did not reach the target rate
    expect(vel(a, heavy)[1]).toBeLessThan(50);

    // prismatic: the same cap on force
    const rail = body(a, 10, 0, "static");
    const mass = a.createBody({
      type: "dynamic",
      position: new Vector2(10, 0),
      mass: 1000,
    });
    a.createCollider({ body: mass, shape: { type: "circle", radius: 0.5 } });
    const p = a.createJoint({
      type: "prismatic",
      bodyA: rail,
      bodyB: mass,
      axis: new Vector3(1, 0, 0),
      motor: { targetVelocity: 50, maxForce: 20 },
    });
    let worstF = 0;
    for (let i = 0; i < 60; i += 1) {
      a.step(DT);
      a.getJointReaction(p, lin, out);
      worstF = Math.max(worstF, Math.abs(lin.x));
    }
    expect(worstF).toBeLessThanOrEqual(20 * DT * (1 + 1e-6));
    expect(vel(a, mass)[0]).toBeLessThan(5);
  });

  it("limits and motors reject joint types without that freedom", () => {
    const a = make();
    const p = body(a, 0, 0, "static");
    const q = body(a, 1, 0);
    const j = a.createJoint({ type: "fixed", bodyA: p, bodyB: q });
    expect(() => {
      a.setJointLimits(j, 0, 1);
    }).toThrow(/fixed joint/);
    expect(() => {
      a.setJointMotor(j, { enabled: true, targetVelocity: 1, maxEffort: 1 });
    }).toThrow(/fixed joint/);
  });
});

describe("joint lifecycle", () => {
  it("destroyJoint frees the bodies, ids stay monotonic, handles go stale", () => {
    const a = make();
    const top = body(a, 0, 0, "static");
    const bob = body(a, 0, -1);
    const j1 = a.createJoint({
      type: "rope",
      bodyA: top,
      bodyB: bob,
      maxLength: 1,
    });
    run(a, 60);
    expect(pos(a, bob).y).toBeGreaterThan(-1.1);
    a.destroyJoint(j1);
    run(a, 60);
    expect(pos(a, bob).y).toBeLessThan(-3);
    expect(() => {
      a.destroyJoint(j1);
    }).toThrow();
    expect(() => a.getJointId(j1)).toThrow();
    const j2 = a.createJoint({
      type: "rope",
      bodyA: top,
      bodyB: bob,
      maxLength: 50,
    });
    expect(a.getJointId(j2)).toBe(2);
    const seen: number[] = [];
    a.forEachJoint((_h, id) => seen.push(id));
    expect(seen).toEqual([2]);
  });

  it("destroying a body retires its joints", () => {
    const a = make();
    const top = body(a, 0, 0, "static");
    const bob = body(a, 0, -1);
    const j = a.createJoint({
      type: "revolute",
      bodyA: top,
      bodyB: bob,
    });
    a.destroyBody(bob);
    expect(() => a.getJointId(j)).toThrow();
    const seen: number[] = [];
    a.forEachJoint((_h, id) => seen.push(id));
    expect(seen).toEqual([]);
  });

  it("rejects stale handles from another adapter and disposed adapters", () => {
    const a = make();
    const b = make();
    const top = body(a, 0, 0, "static");
    const bob = body(a, 0, -1);
    const j = a.createJoint({ type: "fixed", bodyA: top, bodyB: bob });
    expect(() => b.getJointId(j)).toThrow();
    a.dispose();
    expect(() => a.getJointId(j)).toThrow();
  });

  it("validates descriptors and rejects non-planar input", () => {
    const a = make();
    const p = body(a, 0, 0, "static");
    const q = body(a, 1, 0);
    expect(() =>
      a.createJoint({
        type: "spherical",
        bodyA: p,
        bodyB: q,
      } as never),
    ).toThrow();
    expect(() =>
      a.createJoint({
        type: "revolute",
        bodyA: p,
        bodyB: q,
        axis: new Vector3(1, 0, 0),
      }),
    ).toThrow(/±Z/);
    expect(() =>
      a.createJoint({
        type: "revolute",
        bodyA: p,
        bodyB: q,
        axis: new Vector3(0, 0, 0),
      }),
    ).toThrow(/±Z/);
    expect(() =>
      a.createJoint({
        type: "prismatic",
        bodyA: p,
        bodyB: q,
        axis: new Vector3(0, 0, 0),
      }),
    ).toThrow();
    expect(() =>
      a.createJoint({
        type: "fixed",
        bodyA: p,
        bodyB: q,
        anchorA: new Vector3(0, 0, 1),
      }),
    ).toThrow(/z/);
  });

  it("builds an unknown type guard error", () => {
    const a = make();
    const p = body(a, 0, 0, "static");
    const q = body(a, 1, 0);
    expect(() =>
      a.createJoint({ type: "gear", bodyA: p, bodyB: q } as never),
    ).toThrow();
  });
});

describe("live anchors and collision flag", () => {
  it("re-anchors in place and keeps the handle and id", () => {
    const a = make();
    const top = body(a, 0, 0, "static");
    const bob = body(a, 1, 0);
    const j = a.createJoint({
      type: "revolute",
      bodyA: top,
      bodyB: bob,
      anchorB: new Vector3(-1, 0, 0),
    });
    a.setJointAnchors(j, new Vector3(0, 1, 0), new Vector3(-1, 0, 0));
    expect(a.getJointId(j)).toBe(1);
    run(a, 120);
    const p = pos(a, bob);
    // pivot now at (0, 1) with a 1 m arm
    expect(Math.hypot(p.x, p.y - 1)).toBeCloseTo(1, 1);
  });

  it("toggles collideConnected by rebuilding", () => {
    const a = make();
    const top = body(a, 0, 0, "static");
    const bob = body(a, 0, -1);
    const j = a.createJoint({ type: "fixed", bodyA: top, bodyB: bob });
    a.setJointCollisionEnabled(j, true);
    a.setJointCollisionEnabled(j, false);
    expect(a.getJointId(j)).toBe(1);
    run(a, 10);
  });
});

describe("reactions", () => {
  it("reports the weight carried by a rope as an impulse", () => {
    const a = make();
    const top = body(a, 0, 0, "static");
    const weight = body(a, 0, -3, "dynamic", { mass: 2 });
    const j = a.createJoint({
      type: "rope",
      bodyA: top,
      bodyB: weight,
      maxLength: 3,
    });
    run(a, 120);
    const lin = new Vector3();
    const ang = new Vector3();
    a.getJointReaction(j, lin, ang);
    expect(Math.abs(lin.y) / DT).toBeCloseTo(2 * 9.81, 0);
    expect(ang.z).toBe(0);
  });
});

describe("body tuning", () => {
  it("damping and gravity scale take effect", () => {
    const a = make();
    const free = body(a, 0, 10);
    const light = body(a, 5, 10);
    a.setBodyGravityScale(light, 0);
    a.setBodyGravityScale(free, 1, false);
    a.setBodyDamping(free, 2, 0);
    run(a, 30);
    expect(pos(a, light).y).toBeCloseTo(10, 5);
    const undamped = body(a, 9, 10);
    run(a, 30);
    expect(Math.abs(vel(a, free)[0])).toBeLessThan(1e-9);
    expect(pos(a, undamped).y).toBeLessThan(10);
  });

  it("ccd mode toggles bullet and rejects speculative", () => {
    const a = make();
    const h = body(a, 0, 0);
    a.setBodyCcdMode(h, "swept");
    expect(a.getBodyCcdMode(h)).toBe("swept");
    a.setBodyCcdMode(h, "disabled");
    expect(a.getBodyCcdMode(h)).toBe("disabled");
    expect(() => {
      a.setBodyCcdMode(h, "speculative");
    }).toThrow();
  });

  it("mass properties: mass, centre and inertia", () => {
    const a = make();
    const h = body(a, 0, 0);
    a.setBodyMassProperties(h, 7, undefined, undefined);
    expect(a.getBodyMass(h)).toBeCloseTo(7, 6);
    const inertia = new Matrix3();
    inertia.elements[8] = 3;
    a.setBodyMassProperties(h, 4, new Vector3(0.5, 0, 0), inertia, false);
    expect(a.getBodyMass(h)).toBeCloseTo(4, 6);
    const c = new Vector3();
    a.getBodyCenterOfMass(h, c);
    expect(c.x).toBeCloseTo(0.5, 6);
    // static body keeps the authored values but applies nothing
    const wall = body(a, 3, 3, "static");
    a.setBodyMassProperties(wall, 5, undefined, undefined);
  });

  it("collider material and filter", () => {
    const a = make();
    const h = a.createBody({ type: "dynamic", position: new Vector2(0, 0) });
    const c = a.createCollider({
      body: h,
      shape: { type: "capsule", radius: 0.2, halfHeight: 0.5 },
      density: 1,
    });
    const m0 = a.getBodyMass(h);
    a.setColliderMaterial(c, 0.9, 0.1, undefined);
    expect(a.getBodyMass(h)).toBeCloseTo(m0, 9);
    a.setColliderMaterial(c, 0.9, 0.1, 2);
    expect(a.getBodyMass(h)).toBeCloseTo(m0 * 2, 6);
    a.setColliderFilter(c, true, 0x2, 0x4);
    const other = a.createBody({ type: "static", position: new Vector2(0, 0) });
    a.createCollider({
      body: other,
      shape: { type: "circle", radius: 1 },
      collisionGroups: 0x4,
      collisionMask: 0x2,
      sensor: true,
    });
    a.setEventInterest({ collisionstay: false });
    a.step(DT);
    const events = a.drainEvents();
    expect(events.some((e) => e.type === "triggerenter")).toBe(true);
  });

  it("authored-mass body re-applies mass after a density change", () => {
    const a = make();
    const h = a.createBody({
      type: "dynamic",
      position: new Vector2(0, 0),
      mass: 3,
    });
    const c = a.createCollider({
      body: h,
      shape: { type: "circle", radius: 0.5 },
    });
    a.setColliderMaterial(c, 0.5, 0, 9);
    expect(a.getBodyMass(h)).toBeCloseTo(3, 6);
  });
});
