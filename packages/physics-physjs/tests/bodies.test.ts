import { isFourError } from "@fourjs/core";
import { Matrix3, Quaternion, Vector2, Vector3 } from "@fourjs/math";
import type {
  CollisionShape,
  PhysicsBodyHandle,
  PhysicsEvent,
  PhysicsWorldAdapter,
  RigidBodyDescriptor,
  SolverBodyAccess,
  SolverBodyTuningAccess,
} from "@fourjs/physics";
import { describe, expect, it } from "vitest";

import { PhysJSAdapter2D, PhysJSAdapter3D } from "../src/index.js";

type Adapter = PhysicsWorldAdapter & SolverBodyAccess & SolverBodyTuningAccess;

const DT = 1 / 60;

function make(dimension: "2d" | "3d", options = {}): Adapter {
  const adapter: Adapter =
    dimension === "2d" ? new PhysJSAdapter2D() : new PhysJSAdapter3D();
  void adapter.initialize({ dimension, ...options });
  return adapter;
}

const BALL: Record<"2d" | "3d", CollisionShape> = {
  "2d": { type: "circle", radius: 0.5 },
  "3d": { type: "sphere", radius: 0.5 },
};

function ground(a: Adapter, dimension: "2d" | "3d"): PhysicsBodyHandle {
  const body = a.createBody({
    type: "static",
    position: new Vector3(0, -0.5, 0),
  });
  a.createCollider({
    body,
    shape:
      dimension === "2d"
        ? { type: "rectangle", halfExtents: new Vector2(20, 0.5) }
        : { type: "box", halfExtents: new Vector3(20, 0.5, 20) },
  });
  return body;
}

function ball(
  a: Adapter,
  dimension: "2d" | "3d",
  desc: Partial<RigidBodyDescriptor> = {},
): PhysicsBodyHandle {
  const body = a.createBody({ type: "dynamic", ...desc });
  a.createCollider({ body, shape: BALL[dimension] });
  return body;
}

function pos(a: Adapter, b: PhysicsBodyHandle): Vector3 {
  const p = new Vector3();
  a.getBodyTransform(b, p, new Quaternion());
  return p;
}

function run(a: Adapter, steps: number, sink?: PhysicsEvent[]): void {
  for (let i = 0; i < steps; i += 1) {
    a.step(DT);
    const events = a.drainEvents();
    sink?.push(...events);
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

for (const dimension of ["2d", "3d"] as const) {
  describe(`${dimension} dynamics`, () => {
    it("falls under negative-Y gravity (default -9.81)", () => {
      const a = make(dimension);
      const b = ball(a, dimension, { position: new Vector3(0, 10, 0) });
      run(a, 60);
      const p = pos(a, b);
      expect(p.y).toBeLessThan(10 - 4);
      expect(p.y).toBeGreaterThan(10 - 5.5);
      expect(p.x).toBe(0);
      expect(p.z).toBe(0);
      const lin = new Vector3();
      a.getBodyVelocities(b, lin, new Vector3());
      expect(lin.y).toBeCloseTo(-9.81, 0);
      a.dispose();
    });

    it("honours a custom gravity and gravityScale", () => {
      const a = make(dimension, { gravity: new Vector3(0, -2, 0) });
      const b = ball(a, dimension, { gravityScale: 0 });
      const c = ball(a, dimension, { position: new Vector3(5, 0, 0) });
      run(a, 60);
      expect(pos(a, b).y).toBe(0);
      expect(pos(a, c).y).toBeLessThan(-0.8);
      a.setBodyGravityScale(b, -1);
      run(a, 30);
      expect(pos(a, b).y).toBeGreaterThan(0.1);
    });

    it("rests on the ground with Appendix A friction and restitution", () => {
      const a = make(dimension);
      ground(a, dimension);
      const b = ball(a, dimension, { position: new Vector3(0, 3, 0) });
      run(a, 240);
      expect(pos(a, b).y).toBeCloseTo(0.5, 1);
      expect(a.isBodySleeping(b)).toBe(true);
    });

    it("slides to a stop on friction 0.5 and bounces only with restitution", () => {
      const a = make(dimension);
      ground(a, dimension);
      const slab = a.createBody({
        type: "dynamic",
        position: new Vector3(0, 0.25, 0),
        linearVelocity: new Vector3(3, 0, 0),
      });
      a.createCollider({
        body: slab,
        shape:
          dimension === "2d"
            ? { type: "rectangle", halfExtents: new Vector2(0.5, 0.25) }
            : { type: "box", halfExtents: new Vector3(0.5, 0.25, 0.5) },
      });
      run(a, 120);
      const v = new Vector3();
      a.getBodyVelocities(slab, v, new Vector3());
      expect(Math.abs(v.x)).toBeLessThan(0.05);

      const bouncy = a.createBody({
        type: "dynamic",
        position: new Vector3(10, 2, 0),
      });
      a.createCollider({
        body: bouncy,
        shape: BALL[dimension],
        restitution: 0.9,
      });
      let peakAfter = 0;
      let bounced = false;
      for (let i = 0; i < 150; i += 1) {
        a.step(DT);
        a.drainEvents();
        const y = pos(a, bouncy).y;
        if (y < 0.55) {
          bounced = true;
        }
        if (bounced) {
          peakAfter = Math.max(peakAfter, y);
        }
      }
      expect(peakAfter).toBeGreaterThan(1.2);
    });

    it("reads and writes transforms, teleporting without waking when asked", () => {
      const a = make(dimension);
      const b = ball(a, dimension);
      const q = new Quaternion().set(0, 0, Math.sin(0.4), Math.cos(0.4));
      a.setBodyTransform(b, new Vector3(1, 2, 0), q);
      const p = new Vector3();
      const r = new Quaternion();
      a.getBodyTransform(b, p, r);
      expect([p.x, p.y, p.z]).toEqual([1, 2, 0]);
      expect(r.z).toBeCloseTo(Math.sin(0.4), 9);
      expect(r.w).toBeCloseTo(Math.cos(0.4), 9);
      a.setBodyTransform(b, new Vector2(0, 5), 0.5);
      a.getBodyTransform(b, p, r);
      expect(p.y).toBe(5);
      expect(r.z).toBeCloseTo(Math.sin(0.25), 9);

      a.sleepBody(b);
      expect(a.isBodySleeping(b)).toBe(true);
      a.setBodyTransform(b, new Vector3(0, 6, 0), 0, false);
      expect(a.isBodySleeping(b)).toBe(true);
      a.setBodyTransform(b, new Vector3(0, 7, 0), 0);
      expect(a.isBodySleeping(b)).toBe(false);
    });

    it("sets velocities, ignoring them on static bodies", () => {
      const a = make(dimension, { gravity: new Vector3(0, 0, 0) });
      const b = ball(a, dimension);
      a.setBodyVelocities(b, new Vector3(2, 1, 0), 3);
      const lin = new Vector3();
      const ang = new Vector3();
      a.getBodyVelocities(b, lin, ang);
      expect([lin.x, lin.y]).toEqual([2, 1]);
      expect(ang.z).toBe(3);
      a.sleepBody(b);
      a.setBodyVelocities(b, new Vector2(1, 0), new Vector3(0, 0, 1), false);
      expect(a.isBodySleeping(b)).toBe(true);
      const s = a.createBody({ type: "static" });
      a.setBodyVelocities(s, new Vector3(1, 1, 0), 1);
      a.getBodyVelocities(s, lin, ang);
      expect([lin.x, lin.y, ang.z]).toEqual([0, 0, 0]);
    });

    it("applies impulses as velocity changes, linear and angular", () => {
      const a = make(dimension, { gravity: new Vector3(0, 0, 0) });
      const b = ball(a, dimension);
      const mass = a.getBodyMass(b);
      expect(mass).toBeGreaterThan(0);
      a.applyImpulse(b, new Vector3(mass * 2, 0, 0));
      const lin = new Vector3();
      const ang = new Vector3();
      a.getBodyVelocities(b, lin, ang);
      expect(lin.x).toBeCloseTo(2, 9);

      a.applyAngularImpulse(b, 1);
      a.getBodyVelocities(b, lin, ang);
      expect(ang.z).toBeGreaterThan(0);
      const before = ang.z;
      a.applyImpulseAtPoint(b, new Vector3(0, 1, 0), new Vector3(1, 0, 0));
      a.getBodyVelocities(b, lin, ang);
      expect(ang.z).toBeGreaterThan(before);
      if (dimension === "3d") {
        a.applyAngularImpulse(b, new Vector3(1, 0, 0));
        a.getBodyVelocities(b, lin, ang);
        expect(ang.x).toBeGreaterThan(0);
      }
      const s = a.createBody({ type: "static" });
      a.applyImpulse(s, new Vector3(1, 0, 0));
      a.getBodyVelocities(s, lin, ang);
      expect(lin.x).toBe(0);
    });

    it("integrates persistent forces and torques until reset", () => {
      const a = make(dimension, { gravity: new Vector3(0, 0, 0) });
      const b = ball(a, dimension);
      const mass = a.getBodyMass(b);
      a.applyForce(b, new Vector3(mass, 0, 0));
      run(a, 60);
      const lin = new Vector3();
      const ang = new Vector3();
      a.getBodyVelocities(b, lin, ang);
      expect(lin.x).toBeCloseTo(1, 1);
      a.resetForces(b);
      run(a, 30);
      const after = new Vector3();
      a.getBodyVelocities(b, after, ang);
      expect(after.x).toBeCloseTo(lin.x, 6);

      a.applyTorque(b, 2);
      a.applyForceAtPoint(b, new Vector3(0, 1, 0), new Vector3(1, 0, 0));
      run(a, 10);
      a.getBodyVelocities(b, lin, ang);
      expect(ang.z).toBeGreaterThan(0);
      if (dimension === "3d") {
        a.resetForces(b);
        a.applyTorque(b, new Vector3(1, 0, 0));
        run(a, 5);
        a.getBodyVelocities(b, lin, ang);
        expect(ang.x).toBeGreaterThan(0);
      }
    });

    it("a persistent force does not keep a sleeping body awake", () => {
      const a = make(dimension, { gravity: new Vector3(0, 0, 0) });
      const b = ball(a, dimension);
      a.applyForce(b, new Vector3(1, 0, 0));
      a.sleepBody(b);
      run(a, 5);
      expect(a.isBodySleeping(b)).toBe(true);
      a.wakeBody(b);
      expect(a.isBodySleeping(b)).toBe(false);
    });

    it("applies damping", () => {
      const a = make(dimension, { gravity: new Vector3(0, 0, 0) });
      const free = ball(a, dimension, { linearVelocity: new Vector3(4, 0, 0) });
      const damped = ball(a, dimension, {
        position: new Vector3(0, 10, 0),
        linearVelocity: new Vector3(4, 0, 0),
        linearDamping: 2,
        angularDamping: 1,
        angularVelocity: 2,
      });
      run(a, 60);
      const v1 = new Vector3();
      const v2 = new Vector3();
      const w = new Vector3();
      a.getBodyVelocities(free, v1, w);
      a.getBodyVelocities(damped, v2, w);
      expect(v1.x).toBeCloseTo(4, 6);
      expect(v2.x).toBeLessThan(2);
      a.setBodyDamping(free, 5, 5);
      run(a, 60);
      a.getBodyVelocities(free, v1, w);
      expect(v1.x).toBeLessThan(1);
    });
  });

  describe(`${dimension} body types and mass`, () => {
    it("static bodies never move; kinematic-velocity bodies integrate", () => {
      const a = make(dimension);
      const s = a.createBody({
        type: "static",
        position: new Vector3(1, 1, 0),
      });
      const k = a.createBody({
        type: "kinematic-velocity",
        linearVelocity: new Vector3(1, 0, 0),
        angularVelocity: 1,
      });
      run(a, 60);
      expect(pos(a, s).y).toBe(1);
      expect(pos(a, k).x).toBeCloseTo(1, 1);
      expect(pos(a, k).y).toBe(0);
      expect(a.getBodyMass(k)).toBe(Infinity);
    });

    it("kinematic-position bodies reach their target and push dynamic bodies", () => {
      const a = make(dimension, { gravity: new Vector3(0, 0, 0) });
      const k = a.createBody({ type: "kinematic-position" });
      a.createCollider({
        body: k,
        shape:
          dimension === "2d"
            ? { type: "rectangle", halfExtents: new Vector2(0.5, 2) }
            : { type: "box", halfExtents: new Vector3(0.5, 2, 2) },
      });
      const b = ball(a, dimension, { position: new Vector3(1.2, 0, 0) });
      for (let i = 1; i <= 30; i += 1) {
        a.setNextKinematicTransform(k, new Vector3(i * 0.05, 0, 0), 0.1 * i);
        a.step(DT);
        a.drainEvents();
        expect(pos(a, k).x).toBeCloseTo(i * 0.05, 9);
      }
      expect(pos(a, b).x).toBeGreaterThan(1.2);
      const lin = new Vector3();
      const ang = new Vector3();
      a.getBodyVelocities(k, lin, ang);
      expect([lin.x, ang.z]).toEqual([0, 0]);
      const r = new Quaternion();
      a.getBodyTransform(k, new Vector3(), r);
      expect(2 * Math.atan2(r.z, r.w)).toBeCloseTo(3, 6);
      // Keeping the rotation when none is given.
      a.setNextKinematicTransform(k, new Vector2(2, 0));
      a.step(DT);
      a.getBodyTransform(k, new Vector3(), r);
      expect(2 * Math.atan2(r.z, r.w)).toBeCloseTo(3, 6);
      // On other body types it is a teleport.
      a.setNextKinematicTransform(b, new Vector3(9, 9, 0));
      expect(pos(a, b).x).toBe(9);
    });

    it("changes body type live and rebuilds mass", () => {
      const a = make(dimension);
      ground(a, dimension);
      const b = ball(a, dimension, { position: new Vector3(0, 5, 0) });
      const m = a.getBodyMass(b);
      expect(m).toBeGreaterThan(0);
      a.setBodyType(b, "static");
      expect(a.getBodyMass(b)).toBe(Infinity);
      run(a, 30);
      expect(pos(a, b).y).toBe(5);
      a.setBodyType(b, "kinematic-position", false);
      a.setBodyType(b, "dynamic");
      expect(a.getBodyMass(b)).toBeCloseTo(m, 9);
      run(a, 30);
      expect(pos(a, b).y).toBeLessThan(5);
    });

    it("honours an authored mass over the collider-derived one", () => {
      const a = make(dimension, { gravity: new Vector3(0, 0, 0) });
      const b = ball(a, dimension, { mass: 10 });
      expect(a.getBodyMass(b)).toBe(10);
      a.applyImpulse(b, new Vector3(10, 0, 0));
      const lin = new Vector3();
      a.getBodyVelocities(b, lin, new Vector3());
      expect(lin.x).toBeCloseTo(1, 9);
      a.setBodyMassProperties(b, 2, undefined, undefined);
      expect(a.getBodyMass(b)).toBe(2);
      a.setBodyMassProperties(b, 4, new Vector3(), undefined, false);
      expect(a.getBodyMass(b)).toBe(4);
      // A point mass: authored mass, no collider.
      const p = a.createBody({ type: "dynamic", mass: 3 });
      expect(a.getBodyMass(p)).toBe(3);
    });

    it("authored inertia tensors are principal moments; centre offsets are refused", () => {
      const a = make(dimension, { gravity: new Vector3(0, 0, 0) });
      const tensor = new Matrix3();
      tensor.elements.fill(0);
      tensor.elements[0] = 2;
      tensor.elements[4] = 2;
      tensor.elements[8] = 2;
      const b = ball(a, dimension, { mass: 1, inertiaTensor: tensor });
      a.applyAngularImpulse(b, 4);
      const ang = new Vector3();
      a.getBodyVelocities(b, new Vector3(), ang);
      expect(ang.z).toBeCloseTo(2, 9);

      const skew = new Matrix3();
      skew.elements.fill(0);
      skew.elements[0] = skew.elements[4] = skew.elements[8] = 1;
      skew.elements[1] = 0.5;
      expect(
        code(() =>
          a.createBody({ type: "dynamic", mass: 1, inertiaTensor: skew }),
        ),
      ).toBe("NOT_IMPLEMENTED");
      expect(
        code(() =>
          a.createBody({
            type: "dynamic",
            mass: 1,
            centerOfMass: new Vector3(1, 0, 0),
          }),
        ),
      ).toBe("NOT_IMPLEMENTED");
      expect(
        code(() =>
          a.setBodyMassProperties(b, 1, new Vector3(0, 1, 0), undefined),
        ),
      ).toBe("NOT_IMPLEMENTED");
      const c = a.createBody({
        type: "dynamic",
        mass: 1,
        centerOfMass: new Vector3(0, 0, 0),
      });
      const out = new Vector3(9, 9, 9);
      a.getBodyCenterOfMass(c, out);
      expect([out.x, out.y, out.z]).toEqual([0, 0, 0]);
    });

    it("tracks mass through collider add/remove, density and massless colliders", () => {
      const a = make(dimension);
      const b = a.createBody({ type: "dynamic" });
      expect(a.getBodyMass(b)).toBe(Infinity);
      const c1 = a.createCollider({
        body: b,
        shape: BALL[dimension],
        density: 2,
      });
      const m1 = a.getBodyMass(b);
      const c2 = a.createCollider({
        body: b,
        shape: BALL[dimension],
        density: 0,
      });
      expect(a.getBodyMass(b)).toBeCloseTo(m1, 9);
      a.setColliderMaterial(c1, 0.3, 0.2, 4);
      expect(a.getBodyMass(b)).toBeCloseTo(m1 * 2, 9);
      a.setColliderMaterial(c1, 0.3, 0.2, undefined);
      a.destroyCollider(c1);
      expect(a.getBodyMass(b)).toBe(Infinity);
      a.destroyCollider(c2);
      const e = a.createBody({ type: "dynamic", mass: 5 });
      const c3 = a.createCollider({ body: e, shape: BALL[dimension] });
      a.destroyCollider(c3);
      expect(a.getBodyMass(e)).toBe(5);
    });

    it("setColliderMaterial changes friction and restitution live", () => {
      const a = make(dimension);
      ground(a, dimension);
      const b = a.createBody({
        type: "dynamic",
        position: new Vector3(0, 2, 0),
      });
      const c = a.createCollider({ body: b, shape: BALL[dimension] });
      a.setColliderMaterial(c, 0.5, 0.9, undefined);
      let peak = 0;
      let bounced = false;
      for (let i = 0; i < 120; i += 1) {
        a.step(DT);
        a.drainEvents();
        const y = pos(a, b).y;
        bounced ||= y < 0.55;
        if (bounced) {
          peak = Math.max(peak, y);
        }
      }
      expect(peak).toBeGreaterThan(1);
    });

    it("keeps unrelated pairs when one collider goes, and ignores loads on static bodies", () => {
      const a = make(dimension);
      ground(a, dimension);
      const one = ball(a, dimension, { position: new Vector3(0, 0.5, 0) });
      const two = ball(a, dimension, { position: new Vector3(4, 0.5, 0) });
      run(a, 10);
      expect(a.countContacts()).toBe(2);
      a.destroyBody(one);
      expect(a.countContacts()).toBe(1);
      const s = a.createBody({ type: "static" });
      a.applyForce(s, new Vector3(1, 0, 0));
      a.applyTorque(s, 1);
      run(a, 2);
      const lin = new Vector3();
      a.getBodyVelocities(two, lin, new Vector3());
      expect(lin.x).toBe(0);
    });

    it("applies an inertia tensor and keeps sleep through no-wake mass edits", () => {
      const a = make(dimension);
      const tensor = new Matrix3();
      tensor.elements.fill(0);
      tensor.elements[0] = tensor.elements[4] = tensor.elements[8] = 3;
      const b = ball(a, dimension);
      a.setBodyMassProperties(b, 2, undefined, tensor, false);
      a.applyAngularImpulse(b, 6);
      const w = new Vector3();
      a.getBodyVelocities(b, new Vector3(), w);
      expect(w.z).toBeCloseTo(2, 9);
      a.setBodyGravityScale(b, 0.5, false);
    });

    it("sleeps, wakes, and emits sleep/wake events", () => {
      const a = make(dimension);
      ground(a, dimension);
      const b = ball(a, dimension, { position: new Vector3(0, 0.5, 0) });
      const events: PhysicsEvent[] = [];
      run(a, 90, events);
      expect(a.isBodySleeping(b)).toBe(true);
      expect(events.filter((e) => e.type === "sleep")).toHaveLength(1);
      a.applyImpulse(b, new Vector3(0, 1, 0));
      expect(a.isBodySleeping(b)).toBe(false);
      run(a, 1, events);
      expect(events.filter((e) => e.type === "wake")).toHaveLength(1);
      a.sleepBody(b);
      run(a, 1, events);
      expect(events.filter((e) => e.type === "sleep")).toHaveLength(2);
      // Sleeping a static body is a no-op.
      const s = a.createBody({ type: "static" });
      a.sleepBody(s);
    });

    it("never sleeps when sleeping is disabled", () => {
      const a = make(dimension, { sleeping: { enabled: false } });
      ground(a, dimension);
      const b = ball(a, dimension, { position: new Vector3(0, 0.5, 0) });
      run(a, 180);
      expect(a.isBodySleeping(b)).toBe(false);
    });

    it("records speculative CCD as a label and refuses swept", () => {
      const a = make(dimension);
      const b = ball(a, dimension, { ccdMode: "speculative" });
      expect(a.getBodyCcdMode(b)).toBe("speculative");
      a.setBodyCcdMode(b, "disabled");
      expect(a.getBodyCcdMode(b)).toBe("disabled");
      expect(code(() => a.setBodyCcdMode(b, "swept"))).toBe("NOT_IMPLEMENTED");
      expect(
        code(() =>
          a.createBody({ type: "dynamic", continuousCollisionDetection: true }),
        ),
      ).toBe("NOT_IMPLEMENTED");
      expect(a.getBodyCcdMode(a.createBody({ type: "dynamic" }))).toBe(
        "disabled",
      );
    });
  });

  describe(`${dimension} shapes and refusals`, () => {
    it("builds the supported shapes", () => {
      const a = make(dimension);
      const shapes: CollisionShape[] =
        dimension === "2d"
          ? [
              { type: "circle", radius: 1 },
              { type: "rectangle", halfExtents: new Vector2(1, 2) },
              { type: "capsule", radius: 0.5, halfHeight: 1 },
              // CW triangle centred on its centroid: reversed to CCW.
              {
                type: "polygon",
                vertices: [
                  new Vector2(-1, -1),
                  new Vector2(0, 2),
                  new Vector2(1, -1),
                ],
              },
              {
                type: "polygon",
                vertices: [
                  new Vector2(-1, -1),
                  new Vector2(1, -1),
                  new Vector2(0, 2),
                ],
              },
            ]
          : [
              { type: "sphere", radius: 1 },
              { type: "box", halfExtents: new Vector3(1, 2, 3) },
              { type: "capsule", radius: 0.5, halfHeight: 1 },
            ];
      for (const shape of shapes) {
        const body = a.createBody({ type: "dynamic" });
        a.createCollider({ body, shape });
        expect(a.getBodyMass(body)).toBeGreaterThan(0);
      }
    });

    it("refuses shapes PhysJS lacks", () => {
      const a = make(dimension);
      const body = a.createBody({ type: "dynamic" });
      const bad: CollisionShape[] =
        dimension === "2d"
          ? [
              {
                type: "polyline",
                vertices: [new Vector2(0, 0), new Vector2(1, 0)],
              },
              {
                type: "chain",
                vertices: [
                  new Vector2(0, 0),
                  new Vector2(1, 0),
                  new Vector2(1, 1),
                ],
                closed: true,
              },
              // Off-centre polygon (centroid not at the origin).
              {
                type: "polygon",
                vertices: [
                  new Vector2(1, 1),
                  new Vector2(2, 1),
                  new Vector2(1, 2),
                ],
              },
            ]
          : [
              { type: "cylinder", radius: 1, halfHeight: 1 },
              { type: "cone", radius: 1, halfHeight: 1 },
              {
                type: "convex-hull",
                points: [
                  new Vector3(0, 0, 0),
                  new Vector3(1, 0, 0),
                  new Vector3(0, 1, 0),
                  new Vector3(0, 0, 1),
                ],
              },
            ];
      for (const shape of bad) {
        expect(code(() => a.createCollider({ body, shape }))).toBe(
          "NOT_IMPLEMENTED",
        );
      }
    });

    it("refuses sensors, offsets, collision filters and swept CCD", () => {
      const a = make(dimension);
      const body = a.createBody({ type: "dynamic" });
      const shape = BALL[dimension];
      expect(code(() => a.createCollider({ body, shape, sensor: true }))).toBe(
        "NOT_IMPLEMENTED",
      );
      expect(
        code(() => a.createCollider({ body, shape, collisionGroups: 1 })),
      ).toBe("NOT_IMPLEMENTED");
      expect(
        code(() => a.createCollider({ body, shape, collisionMask: 2 })),
      ).toBe("NOT_IMPLEMENTED");
      expect(
        code(() =>
          a.setColliderFilter(
            a.createCollider({ body, shape }),
            true,
            0xffffffff,
            0xffffffff,
          ),
        ),
      ).toBe("NOT_IMPLEMENTED");
      expect(
        code(() =>
          a.setColliderFilter(
            a.createCollider({ body, shape }),
            false,
            1,
            0xffffffff,
          ),
        ),
      ).toBe("NOT_IMPLEMENTED");
      const c = a.createCollider({ body, shape });
      a.setColliderFilter(c, false, 0xffffffff, 0xffffffff);
      const offset = {
        position: new Vector3(1, 0, 0),
        rotation: new Quaternion(),
      };
      expect(
        code(() => a.createCollider({ body, shape, offset: offset as never })),
      ).toBe("NOT_IMPLEMENTED");
      const turned = {
        position: new Vector3(0, 0, 0),
        rotation: new Quaternion().set(0, 0, Math.sin(0.5), Math.cos(0.5)),
      };
      expect(
        code(() => a.createCollider({ body, shape, offset: turned as never })),
      ).toBe("NOT_IMPLEMENTED");
      const turnedAngle = { position: new Vector3(), rotation: 0.5 };
      expect(
        code(() =>
          a.createCollider({ body, shape, offset: turnedAngle as never }),
        ),
      ).toBe("NOT_IMPLEMENTED");
      // An identity offset is representable.
      const identity = { position: new Vector3(), rotation: new Quaternion() };
      a.createCollider({ body, shape, offset: identity as never });
      expect(
        code(() => a.createBody({ type: "dynamic", ccdMode: "swept" })),
      ).toBe("NOT_IMPLEMENTED");
    });
  });

  describe(`${dimension} events`, () => {
    it("emits start, stay, then end for a pair, in monotonic order", () => {
      const a = make(dimension);
      const g = ground(a, dimension);
      const b = ball(a, dimension, { position: new Vector3(0, 1, 0) });
      const log: string[] = [];
      for (let i = 0; i < 90; i += 1) {
        a.step(DT);
        for (const e of a.drainEvents()) {
          if (e.type.startsWith("collision")) {
            const c = e as Extract<PhysicsEvent, { type: "collisionstart" }>;
            expect(c.bodyA).toBe(g);
            expect(c.bodyB).toBe(b);
            expect(c.contacts).toEqual([]);
            log.push(e.type);
          }
        }
        if (i === 60) {
          a.setBodyTransform(b, new Vector3(0, 5, 0), 0);
          a.setBodyVelocities(b, new Vector3(), 0);
        }
      }
      expect(log[0]).toBe("collisionstart");
      expect(log.slice(1, -1).every((t) => t === "collisionstay")).toBe(true);
      expect(log.length).toBeGreaterThan(5);
      expect(log.at(-1)).toBe("collisionend");
      expect(log.filter((t) => t === "collisionstart")).toHaveLength(1);
      expect(a.countContacts()).toBe(0);
    });

    it("skips stay events when nobody listens, and keeps start/end", () => {
      const a = make(dimension);
      ground(a, dimension);
      ball(a, dimension, { position: new Vector3(0, 0.6, 0) });
      a.setEventInterest?.({ collisionstay: false });
      const events: PhysicsEvent[] = [];
      run(a, 20, events);
      expect(events.some((e) => e.type === "collisionstart")).toBe(true);
      expect(events.some((e) => e.type === "collisionstay")).toBe(false);
      expect(a.countContacts()).toBe(1);
      a.setEventInterest?.({ collisionstay: true });
      run(a, 5, events);
      expect(events.some((e) => e.type === "collisionstay")).toBe(true);
    });

    it("orders several simultaneous starts by collider id and reports relative velocity", () => {
      const a = make(dimension);
      const g = ground(a, dimension);
      const handles = [0, 1, 2].map((i) =>
        ball(a, dimension, { position: new Vector3(i * 3, 0.9, 0) }),
      );
      const events: PhysicsEvent[] = [];
      run(a, 20, events);
      const starts = events.filter(
        (e) => e.type === "collisionstart",
      ) as Extract<PhysicsEvent, { type: "collisionstart" }>[];
      expect(starts).toHaveLength(3);
      expect(starts.map((e) => e.bodyB)).toEqual(handles);
      expect(starts.every((e) => e.bodyA === g)).toBe(true);
      expect(starts[0].relativeVelocity.y).toBeLessThanOrEqual(0.5);
    });

    it("forgets pairs of destroyed bodies without emitting", () => {
      const a = make(dimension);
      ground(a, dimension);
      const b = ball(a, dimension, { position: new Vector3(0, 0.5, 0) });
      run(a, 10);
      expect(a.countContacts()).toBe(1);
      a.destroyBody(b);
      const events: PhysicsEvent[] = [];
      run(a, 3, events);
      expect(events.filter((e) => e.type.startsWith("collision"))).toEqual([]);
      expect(a.countContacts()).toBe(0);
    });

    it("emits collisionend when a collider is destroyed mid-contact only via PhysJS", () => {
      const a = make(dimension);
      ground(a, dimension);
      const b = a.createBody({
        type: "dynamic",
        position: new Vector3(0, 0.5, 0),
      });
      const c = a.createCollider({ body: b, shape: BALL[dimension] });
      run(a, 10);
      a.destroyCollider(c);
      const events: PhysicsEvent[] = [];
      run(a, 3, events);
      expect(events.filter((e) => e.type === "collisionstay")).toEqual([]);
    });
  });

  describe(`${dimension} identity and lifecycle`, () => {
    it("hands out monotonic, never-reused ids and iterates in id order", () => {
      const a = make(dimension);
      const ids: number[] = [];
      const handles: PhysicsBodyHandle[] = [];
      for (let i = 0; i < 4; i += 1) {
        const h = ball(a, dimension);
        handles.push(h);
        ids.push(a.getBodyId(h));
      }
      expect(ids).toEqual([1, 2, 3, 4]);
      a.destroyBody(handles[1]);
      const fresh = ball(a, dimension);
      expect(a.getBodyId(fresh)).toBe(5);
      const seen: number[] = [];
      a.forEachBody((_h, id) => seen.push(id));
      expect(seen).toEqual([1, 3, 4, 5]);
      const colliders: number[] = [];
      a.forEachCollider((h, id) => {
        colliders.push(id);
        expect(a.getColliderBody(h)).toBeDefined();
        expect(a.getColliderId(h)).toBe(id);
      });
      expect(colliders).toEqual([1, 3, 4, 5]);
    });

    it("rejects stale handles, double init, wrong dimension and use after dispose", () => {
      const a = make(dimension);
      const b = ball(a, dimension);
      a.destroyBody(b);
      expect(code(() => a.getBodyId(b))).toBe("INVALID_APPLICATION_STATE");
      const other = make(dimension);
      const foreign = ball(other, dimension);
      expect(code(() => a.getBodyId(foreign))).toBe(
        "INVALID_APPLICATION_STATE",
      );
      expect(code(() => a.getColliderId({} as never))).toBe(
        "INVALID_APPLICATION_STATE",
      );
      expect(code(() => a.initialize({ dimension }))).toBe(
        "INVALID_APPLICATION_STATE",
      );
      expect(code(() => a.step(0))).toBe("INVALID_APPLICATION_STATE");
      expect(code(() => a.step(Number.NaN))).toBe("INVALID_APPLICATION_STATE");
      const fresh =
        dimension === "2d" ? new PhysJSAdapter2D() : new PhysJSAdapter3D();
      expect(code(() => fresh.step(DT))).toBe("INVALID_APPLICATION_STATE");
      a.dispose();
      a.dispose();
      expect(code(() => a.step(DT))).toBe("INVALID_APPLICATION_STATE");
      expect(code(() => a.initialize({ dimension }))).toBe(
        "INVALID_APPLICATION_STATE",
      );
    });

    it("refuses the wrong dimension, an unreachable determinism tier, and solverIterations", () => {
      const wrong = dimension === "2d" ? "3d" : "2d";
      const fresh = (): Adapter =>
        dimension === "2d" ? new PhysJSAdapter2D() : new PhysJSAdapter3D();
      expect(code(() => fresh().initialize({ dimension: wrong }))).toBe(
        "INVALID_APPLICATION_STATE",
      );
      expect(
        code(() =>
          fresh().initialize({ dimension, determinism: "cross-platform" }),
        ),
      ).toBe("INVALID_APPLICATION_STATE");
      expect(
        code(() => fresh().initialize({ dimension, solverIterations: 3 })),
      ).toBe("NOT_IMPLEMENTED");
      void fresh().initialize({
        dimension,
        solverIterations: 10,
        determinism: "same-runtime",
      });
    });

    it("sync hooks are no-ops; dimension checks guard 2d z components", () => {
      const a = make(dimension);
      a.syncSceneToSolver();
      a.syncSolverToScene();
      const b = ball(a, dimension);
      if (dimension === "2d") {
        expect(code(() => a.applyForce(b, new Vector3(0, 0, 1)))).toBe(
          "INVALID_APPLICATION_STATE",
        );
      } else {
        a.applyForce(b, new Vector3(0, 0, 1));
      }
    });
  });
}

describe("3d specifics", () => {
  it("round-trips a full quaternion and rotates impulses by the body frame", () => {
    const a = make("3d", { gravity: new Vector3(0, 0, 0) });
    const q = new Quaternion().set(0.3, 0.4, 0.5, 0.7);
    q.normalize();
    const b = a.createBody({ type: "dynamic", rotation: q, mass: 1 });
    a.createCollider({
      body: b,
      shape: { type: "box", halfExtents: new Vector3(1, 2, 3) },
    });
    const out = new Quaternion();
    a.getBodyTransform(b, new Vector3(), out);
    expect(out.x).toBeCloseTo(q.x, 9);
    expect(out.w).toBeCloseTo(q.w, 9);
    a.applyAngularImpulse(b, new Vector3(1, 1, 1));
    const w = new Vector3();
    a.getBodyVelocities(b, new Vector3(), w);
    expect(Math.hypot(w.x, w.y, w.z)).toBeGreaterThan(0);
    const lin = new Vector3();
    a.setBodyVelocities(b, new Vector3(1, 2, 3), new Vector3(1, 2, 3));
    a.getBodyVelocities(b, lin, w);
    expect([lin.x, lin.y, lin.z]).toEqual([1, 2, 3]);
    expect([w.x, w.y, w.z]).toEqual([1, 2, 3]);
    // Kinematic-position 3-D target with a full rotation.
    const k = a.createBody({ type: "kinematic-position" });
    a.setNextKinematicTransform(k, new Vector3(1, 2, 3), q);
    a.step(DT);
    const p = new Vector3();
    const r = new Quaternion();
    a.getBodyTransform(k, p, r);
    expect([p.x, p.y, p.z]).toEqual([1, 2, 3]);
    expect(r.w).toBeCloseTo(q.w, 9);
    // Opposite hemisphere target takes the short way round.
    const neg = new Quaternion().set(-q.x, -q.y, -q.z, -q.w);
    a.setNextKinematicTransform(k, new Vector3(1, 2, 3), neg);
    a.step(DT);
  });

  it("mixed-shape stack of boxes settles on the ground", () => {
    const a = make("3d");
    ground(a, "3d");
    const bottom = a.createBody({
      type: "dynamic",
      position: new Vector3(0, 0.5, 0),
    });
    a.createCollider({
      body: bottom,
      shape: { type: "box", halfExtents: new Vector3(0.5, 0.5, 0.5) },
    });
    const top = a.createBody({
      type: "dynamic",
      position: new Vector3(0, 1.6, 0),
    });
    a.createCollider({
      body: top,
      shape: { type: "capsule", radius: 0.3, halfHeight: 0.3 },
    });
    run(a, 240);
    expect(pos(a, top).y).toBeGreaterThan(1.0);
    expect(Math.abs(pos(a, bottom).x)).toBeLessThan(0.1);
  });
});

describe("2d specifics", () => {
  it("rejects a quaternion tilted off the Z axis and keeps motion in the plane", () => {
    const a = make("2d");
    const b = ball(a, "2d", { position: new Vector3(0, 3, 0) });
    expect(
      code(() =>
        a.setBodyTransform(
          b,
          new Vector3(),
          new Quaternion().set(0.5, 0, 0, 0.8),
        ),
      ),
    ).toBe("INVALID_APPLICATION_STATE");
    run(a, 30);
    expect(pos(a, b).z).toBe(0);
    const lin = new Vector3();
    a.getBodyVelocities(b, lin, new Vector3());
    expect(lin.z).toBe(0);
  });
});
