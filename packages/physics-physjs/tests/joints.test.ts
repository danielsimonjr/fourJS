import { isFourError } from "@fourjs/core";
import { Quaternion, Vector2, Vector3 } from "@fourjs/math";
import type {
  CollisionShape,
  JointDescriptor,
  PhysicsBodyHandle,
  PhysicsJointHandle,
} from "@fourjs/physics";
import { describe, expect, it } from "vitest";

import { PhysJSAdapter2D, PhysJSAdapter3D } from "../src/index.js";

type Adapter = PhysJSAdapter2D | PhysJSAdapter3D;
type Dim = "2d" | "3d";

const DT = 1 / 60;

function make(dimension: Dim): Adapter {
  const adapter =
    dimension === "2d" ? new PhysJSAdapter2D() : new PhysJSAdapter3D();
  adapter.initialize({ dimension });
  return adapter;
}

const BALL: Record<Dim, CollisionShape> = {
  "2d": { type: "circle", radius: 0.25 },
  "3d": { type: "sphere", radius: 0.25 },
};

const BOX: Record<Dim, CollisionShape> = {
  "2d": { type: "rectangle", halfExtents: new Vector2(1, 0.5) },
  "3d": { type: "box", halfExtents: new Vector3(1, 0.5, 0.5) },
};

function body(
  a: Adapter,
  dimension: Dim,
  type: "static" | "dynamic",
  at: Vector3,
  shape = BALL[dimension],
): PhysicsBodyHandle {
  const handle = a.createBody({ type, position: at });
  a.createCollider({ body: handle, shape });
  return handle;
}

function pos(a: Adapter, b: PhysicsBodyHandle): Vector3 {
  const p = new Vector3();
  a.getBodyTransform(b, p, new Quaternion());
  return p;
}

function run(a: Adapter, steps: number): void {
  for (let i = 0; i < steps; i += 1) {
    a.step(DT);
    a.drainEvents();
  }
}

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return isFourError(error) ? error.code : "other";
  }
  return undefined;
}

function anchorAndBob(a: Adapter, d: Dim) {
  const anchor = body(a, d, "static", new Vector3(0, 5, 0));
  const bob = body(a, d, "dynamic", new Vector3(2, 5, 0));
  return { anchor, bob };
}

describe("joints hold under gravity", () => {
  it("2D pin pendulum keeps its length", () => {
    const a = make("2d");
    const { anchor, bob } = anchorAndBob(a, "2d");
    a.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: bob,
      anchorA: new Vector3(0, 0, 0),
      anchorB: new Vector3(-2, 0, 0),
    });
    let lowest = 5;
    for (let i = 0; i < 120; i += 1) {
      run(a, 1);
      const p = pos(a, bob);
      lowest = Math.min(lowest, p.y);
      expect(Math.hypot(p.x, p.y - 5)).toBeCloseTo(2, 1);
    }
    expect(lowest).toBeLessThan(3.5);
  });

  it("3D hinge pendulum keeps its length and stays in plane", () => {
    const a = make("3d");
    const { anchor, bob } = anchorAndBob(a, "3d");
    a.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: bob,
      anchorB: new Vector3(-2, 0, 0),
      axis: new Vector3(0, 0, 1),
    });
    let lowest = 5;
    for (let i = 0; i < 120; i += 1) {
      run(a, 1);
      const p = pos(a, bob);
      lowest = Math.min(lowest, p.y);
      expect(Math.abs(Math.hypot(p.x, p.y - 5) - 2)).toBeLessThan(0.1);
      expect(Math.abs(p.z)).toBeLessThan(0.05);
    }
    expect(lowest).toBeLessThan(3.5);
  });

  it("3D spherical joint holds the anchor", () => {
    const a = make("3d");
    const { anchor, bob } = anchorAndBob(a, "3d");
    a.createJoint({
      type: "spherical",
      bodyA: anchor,
      bodyB: bob,
      anchorB: new Vector3(-2, 0, 0),
    });
    run(a, 60);
    const p = pos(a, bob);
    expect(Math.hypot(p.x, p.y - 5, p.z)).toBeCloseTo(2, 1);
  });

  for (const d of ["2d", "3d"] as const) {
    it(`${d} spring oscillates about its equilibrium`, () => {
      const a = make(d);
      const anchor = body(a, d, "static", new Vector3(0, 5, 0));
      const bob = body(a, d, "dynamic", new Vector3(0, 3, 0));
      a.createJoint({
        type: "spring",
        bodyA: anchor,
        bodyB: bob,
        restLength: 1,
        stiffness: 40,
        damping: 0.5,
      });
      let min = 3;
      let max = 3;
      for (let i = 0; i < 240; i += 1) {
        run(a, 1);
        const y = pos(a, bob).y;
        min = Math.min(min, y);
        max = Math.max(max, y);
      }
      expect(min).toBeGreaterThan(2.9);
      expect(max).toBeGreaterThan(3.5);
      expect(max).toBeLessThan(5);
    });

    it(`${d} fixed weld carries the second body`, () => {
      const a = make(d);
      const anchor = body(a, d, "static", new Vector3(0, 5, 0), BOX[d]);
      const weld = body(a, d, "dynamic", new Vector3(2, 5, 0));
      a.createJoint({
        type: "fixed",
        bodyA: anchor,
        bodyB: weld,
        anchorB: new Vector3(-2, 0, 0),
      });
      run(a, 90);
      const p = pos(a, weld);
      expect(p.x).toBeCloseTo(2, 1);
      expect(Math.abs(p.y - 5)).toBeLessThan(0.15);
    });
  }

  it("rotates body-local anchors into world frame", () => {
    const a = make("3d");
    const anchor = a.createBody({
      type: "static",
      position: new Vector3(0, 5, 0),
      rotation: new Quaternion(0, 0, Math.SQRT1_2, Math.SQRT1_2),
    });
    a.createCollider({ body: anchor, shape: BALL["3d"] });
    // local +X of a body turned 90 degrees about Z is world +Y.
    const bob = body(a, "3d", "dynamic", new Vector3(0, 7, 0));
    a.createJoint({
      type: "revolute",
      bodyA: anchor,
      bodyB: bob,
      anchorA: new Vector3(2, 0, 0),
      anchorB: new Vector3(0, 0, 0),
      axis: new Vector3(0, 0, 1),
      collisionEnabled: true,
    });
    run(a, 10);
    expect(pos(a, bob).y).toBeCloseTo(7, 0);
  });
});

describe("joint refusals and bookkeeping", () => {
  const refused = (
    d: Dim,
    desc: (a: PhysicsBodyHandle, b: PhysicsBodyHandle) => JointDescriptor,
  ) => {
    const a = make(d);
    const { anchor, bob } = anchorAndBob(a, d);
    return code(() => a.createJoint(desc(anchor, bob)));
  };

  for (const d of ["2d", "3d"] as const) {
    it(`${d} refuses prismatic, rope, limits and motors`, () => {
      expect(
        refused(d, (bodyA, bodyB) => ({
          type: "prismatic",
          bodyA,
          bodyB,
          axis: new Vector3(1, 0, 0),
        })),
      ).toBe("NOT_IMPLEMENTED");
      expect(
        refused(d, (bodyA, bodyB) => ({
          type: "rope",
          bodyA,
          bodyB,
          maxLength: 2,
        })),
      ).toBe("NOT_IMPLEMENTED");
      expect(
        refused(d, (bodyA, bodyB) => ({
          type: "revolute",
          bodyA,
          bodyB,
          axis: new Vector3(0, 0, 1),
          limits: { min: -1, max: 1 },
        })),
      ).toBe("NOT_IMPLEMENTED");
      expect(
        refused(d, (bodyA, bodyB) => ({
          type: "revolute",
          bodyA,
          bodyB,
          axis: new Vector3(0, 0, 1),
          motor: { targetVelocity: 1, maxTorque: 1 },
        })),
      ).toBe("NOT_IMPLEMENTED");
    });
  }

  it("refuses spherical limits in 3D and spherical joints in 2D", () => {
    expect(
      refused(
        "3d",
        (bodyA, bodyB) =>
          ({
            type: "spherical",
            bodyA,
            bodyB,
            limits: { coneAngle: 1 },
          }) as never,
      ),
    ).toBe("NOT_IMPLEMENTED");
    expect(
      refused("2d", (bodyA, bodyB) => ({ type: "spherical", bodyA, bodyB })),
    ).toBeDefined();
  });

  it("does not report reactions and refuses live limit/motor edits", () => {
    const a = make("3d");
    expect(a.reportsJointReactions).toBe(false);
    const { anchor, bob } = anchorAndBob(a, "3d");
    const j = a.createJoint({ type: "fixed", bodyA: anchor, bodyB: bob });
    expect(
      code(() => a.getJointReaction(j, new Vector3(), new Vector3())),
    ).toBe("NOT_IMPLEMENTED");
    expect(code(() => a.setJointLimits(j, 0, 1))).toBe("NOT_IMPLEMENTED");
    expect(
      code(() =>
        a.setJointMotor(j, { enabled: true, targetVelocity: 1, maxEffort: 1 }),
      ),
    ).toBe("NOT_IMPLEMENTED");
    expect(a.capabilities.tuning?.jointMotorEffortCap).toBe(false);
  });

  it("registers ids monotonically, destroys, and forgets joints of destroyed bodies", () => {
    const a = make("2d");
    const { anchor, bob } = anchorAndBob(a, "2d");
    const j1 = a.createJoint({ type: "fixed", bodyA: anchor, bodyB: bob });
    a.destroyJoint(j1);
    expect(code(() => a.destroyJoint(j1))).toBeDefined();
    const j2 = a.createJoint({ type: "fixed", bodyA: anchor, bodyB: bob });
    const j3 = a.createJoint({ type: "fixed", bodyA: anchor, bodyB: bob });
    const ids: number[] = [];
    a.forEachJoint((_h: PhysicsJointHandle, id: number) => ids.push(id));
    expect(ids).toEqual([2, 3]);
    expect(a.getJointId(j2)).toBe(2);
    a.destroyBody(bob);
    expect(code(() => a.getJointId(j3))).toBeDefined();
    const none: number[] = [];
    a.forEachJoint((_h: PhysicsJointHandle, id: number) => none.push(id));
    expect(none).toEqual([]);
    a.dispose();
  });

  it("collision flag and anchors can be reconfigured", () => {
    const a = make("3d");
    const anchor = body(a, "3d", "static", new Vector3(0, 5, 0));
    const bob = body(a, "3d", "dynamic", new Vector3(0, 4, 0));
    const j = a.createJoint({
      type: "spring",
      bodyA: anchor,
      bodyB: bob,
      restLength: 1,
      stiffness: 40,
    });
    a.setJointCollisionEnabled(j, true);
    a.setJointAnchors(j, new Vector3(0, 0, 0), new Vector3(0, 1, 0));
    run(a, 120);
    expect(pos(a, bob).y).toBeGreaterThan(3);
    expect(code(() => a.setJointAnchors(j, new Vector3(), new Vector3()))).toBe(
      undefined,
    );
  });

  it("rejects a 2D joint with a z anchor", () => {
    const a = make("2d");
    const { anchor, bob } = anchorAndBob(a, "2d");
    expect(
      code(() =>
        a.createJoint({
          type: "fixed",
          bodyA: anchor,
          bodyB: bob,
          anchorA: new Vector3(0, 0, 1),
        }),
      ),
    ).toBeDefined();
  });
});
