import { Quaternion, Vector2, Vector3 } from "@fourjs/math";
import { SolverRegistry } from "@fourjs/physics";
import type {
  ColliderDescriptor,
  PhysicsBodyHandle,
  PhysicsColliderHandle,
  PhysicsEvent,
} from "@fourjs/physics";
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  BOX2D_CAPABILITIES,
  BOX2D_CORE_VERSION,
  Box2dAdapter,
  createBox2dAdapter,
  isBox2dSupported,
  registerBox2dSolver,
} from "../src/index.js";

const DT = 1 / 60;

/** Structural `Transform` stand-in: the adapter reads only position and rotation. */
function offsetOf(position: Vector3, rotation: Quaternion) {
  return { position, rotation } as unknown as NonNullable<
    ColliderDescriptor["offset"]
  >;
}

function make(gravity = new Vector2(0, -9.81)): Box2dAdapter {
  const adapter = new Box2dAdapter();
  adapter.initialize({ dimension: "2d", gravity });
  return adapter;
}

function pos(adapter: Box2dAdapter, h: PhysicsBodyHandle): Vector3 {
  const p = new Vector3();
  adapter.getBodyTransform(h, p, new Quaternion());
  return p;
}

function ball(adapter: Box2dAdapter, y: number, restitution = 0, x = 0) {
  const body = adapter.createBody({
    type: "dynamic",
    position: new Vector2(x, y),
  });
  const collider = adapter.createCollider({
    body,
    shape: { type: "circle", radius: 0.5 },
    restitution,
  });
  return { body, collider };
}

function ground(adapter: Box2dAdapter, restitution = 0) {
  const body = adapter.createBody({ type: "static" });
  const collider = adapter.createCollider({
    body,
    shape: { type: "rectangle", halfExtents: new Vector2(50, 0.5) },
    restitution,
  });
  return { body, collider };
}

describe("registration", () => {
  it("registers and resolves for 2d, refuses 3d under auto", () => {
    const registry = new SolverRegistry();
    expect(registerBox2dSolver(registry)).toBe(registry);
    expect(registry.solvers).toEqual(["box2d"]);
    expect(registry.resolve("box2d", { dimension: "2d" })).toBeInstanceOf(
      Box2dAdapter,
    );
    expect(registry.resolve("auto", { dimension: "2d" })).toBeInstanceOf(
      Box2dAdapter,
    );
    expect(() => registry.resolve("auto", { dimension: "3d" })).toThrow();
    expect(() => registerBox2dSolver(registry)).not.toThrow();
    expect(registry.solvers).toEqual(["box2d"]);
  });

  it("answers isSupported by dimension", () => {
    expect(isBox2dSupported()).toBe(true);
    expect(isBox2dSupported({ dimension: "2d" })).toBe(true);
    expect(isBox2dSupported({ dimension: "3d" })).toBe(false);
    expect(createBox2dAdapter({ dimension: "2d" })).toBeInstanceOf(
      Box2dAdapter,
    );
  });

  it("pins the version to package.json and declares honest capabilities", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@box2d/core"]).toBe(BOX2D_CORE_VERSION);
    const adapter = new Box2dAdapter();
    expect(adapter.version).toBe("0.11.0");
    expect(adapter.name).toBe("box2d");
    expect(adapter.capabilities).toBe(BOX2D_CAPABILITIES);
    expect(BOX2D_CAPABILITIES.dimensions).toEqual(["2d"]);
    expect(BOX2D_CAPABILITIES.jointTypes).toEqual([
      "fixed",
      "spring",
      "revolute",
      "prismatic",
      "rope",
    ]);
    expect(BOX2D_CAPABILITIES.tuning.jointMotorEffortCap).toBe(true);
    expect(BOX2D_CAPABILITIES.tuning.rollingFriction).toBe(false);
    expect(BOX2D_CAPABILITIES.snapshots).toBe(true);
    expect(Object.values(BOX2D_CAPABILITIES.queries)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });
});

describe("lifecycle", () => {
  it("rejects use before initialize, double initialize, 3d, over-strong determinism", () => {
    const adapter = new Box2dAdapter();
    expect(() => adapter.createBody({ type: "static" })).toThrow(/initialize/);
    adapter.initialize({ dimension: "2d" });
    expect(() => adapter.initialize({ dimension: "2d" })).toThrow(/twice/);
    expect(() => new Box2dAdapter().initialize({ dimension: "3d" })).toThrow();
    expect(() =>
      new Box2dAdapter().initialize({
        dimension: "2d",
        determinism: "cross-platform",
      }),
    ).toThrow(/determinism/);
  });

  it("disposes idempotently and terminally", () => {
    const adapter = make();
    const { body } = ball(adapter, 1);
    adapter.dispose();
    adapter.dispose();
    expect(() => adapter.step(DT)).toThrow(/disposed/);
    expect(() => adapter.getBodyId(body)).toThrow();
  });

  it("rejects a bad step delta", () => {
    const adapter = make();
    expect(() => adapter.step(0)).toThrow(/positive/);
    expect(() => adapter.step(Number.NaN)).toThrow();
  });

  it("applies sleeping.enabled and solverIterations", () => {
    const adapter = new Box2dAdapter();
    adapter.initialize({
      dimension: "2d",
      sleeping: { enabled: false },
      solverIterations: 4,
    });
    const { body } = ball(adapter, 5);
    for (let i = 0; i < 5; i += 1) adapter.step(DT);
    expect(adapter.isBodySleeping(body)).toBe(false);
  });
});

describe("dynamics", () => {
  it("falls under Y-up gravity (negative Y)", () => {
    const adapter = make();
    const { body } = ball(adapter, 10);
    for (let i = 0; i < 60; i += 1) adapter.step(DT);
    const p = pos(adapter, body);
    expect(p.y).toBeLessThan(10 - 4);
    expect(p.y).toBeCloseTo(10 - 0.5 * 9.81, 0);
    expect(p.x).toBe(0);
    expect(p.z).toBe(0);
    const lin = new Vector3();
    const ang = new Vector3();
    adapter.getBodyVelocities(body, lin, ang);
    expect(lin.y).toBeLessThan(0);
  });

  it("uses default gravity when none is given", () => {
    const adapter = new Box2dAdapter();
    adapter.initialize({ dimension: "2d" });
    const { body } = ball(adapter, 10);
    adapter.step(DT);
    expect(pos(adapter, body).y).toBeLessThan(10);
  });

  it("combines restitution by maximum", () => {
    const bounce = (ballE: number, groundE: number): number => {
      const adapter = make();
      ground(adapter, groundE);
      const { body } = ball(adapter, 3, ballE);
      let maxVy = 0;
      for (let i = 0; i < 240; i += 1) {
        adapter.step(DT);
        const lin = new Vector3();
        adapter.getBodyVelocities(body, lin, new Vector3());
        maxVy = Math.max(maxVy, lin.y);
      }
      return maxVy;
    };
    expect(bounce(0, 0)).toBeLessThan(0.5);
    expect(bounce(0.8, 0)).toBeGreaterThan(2);
    expect(bounce(0, 0.8)).toBeGreaterThan(2);
  });

  it("maps all four body types", () => {
    const adapter = make();
    const stat = adapter.createBody({
      type: "static",
      position: new Vector2(1, 2),
    });
    const kv = adapter.createBody({
      type: "kinematic-velocity",
      linearVelocity: new Vector2(1, 0),
      angularVelocity: 1,
    });
    const kp = adapter.createBody({ type: "kinematic-position" });
    adapter.createCollider({ body: kp, shape: { type: "circle", radius: 1 } });
    adapter.setNextKinematicTransform(kp, new Vector2(2, 0), 0.5);
    adapter.setNextKinematicTransform(kp, new Vector2(2, 0));
    adapter.setNextKinematicTransform(kp, new Vector2(2, 0), 0.5);
    adapter.step(DT);
    expect(pos(adapter, kp).x).toBeCloseTo(2, 10);
    const q = new Quaternion();
    adapter.getBodyTransform(kp, new Vector3(), q);
    expect(2 * Math.atan2(q.z, q.w)).toBeCloseTo(0.5, 10);
    adapter.step(DT);
    expect(pos(adapter, kp).x).toBeCloseTo(2, 10);
    expect(pos(adapter, stat).y).toBe(2);
    expect(pos(adapter, kv).x).toBeCloseTo(2 * DT, 6);
    expect(pos(adapter, kv).y).toBe(0);
  });

  it("supports forces, impulses, torque, teleport, retype, wake and sleep", () => {
    const adapter = make(new Vector2(0, 0));
    const { body } = ball(adapter, 0);
    const lin = new Vector3();
    const ang = new Vector3();
    adapter.applyImpulse(body, new Vector2(1, 0));
    adapter.applyImpulseAtPoint(body, new Vector2(0, 1), new Vector2(0, 0.5));
    adapter.applyAngularImpulse(body, 1);
    adapter.applyForce(body, new Vector2(1, 0));
    adapter.applyForceAtPoint(body, new Vector2(0, 1), new Vector2(0.5, 0));
    adapter.applyTorque(body, 1);
    adapter.resetForces(body);
    adapter.step(DT);
    adapter.getBodyVelocities(body, lin, ang);
    expect(lin.x).toBeGreaterThan(0);
    expect(lin.y).toBeGreaterThan(0);
    expect(ang.z).not.toBe(0);

    adapter.setBodyVelocities(body, new Vector2(3, 0), 2);
    adapter.getBodyVelocities(body, lin, ang);
    expect(lin.x).toBe(3);
    expect(ang.z).toBe(2);

    adapter.setBodyTransform(body, new Vector3(5, 6, 0), Math.PI / 2, false);
    adapter.setBodyTransform(
      body,
      new Vector2(5, 6),
      new Quaternion(0, 0, 0, 1),
    );
    expect(pos(adapter, body).x).toBe(5);
    const c = new Vector3();
    adapter.getBodyCenterOfMass(body, c);
    expect(c.x).toBeCloseTo(5);
    expect(adapter.getBodyMass(body)).toBeGreaterThan(0);

    adapter.sleepBody(body);
    expect(adapter.isBodySleeping(body)).toBe(true);
    adapter.wakeBody(body);
    expect(adapter.isBodySleeping(body)).toBe(false);
    adapter.setBodyType(body, "static");
    adapter.setBodyType(body, "dynamic", false);
    expect(adapter.getBodyCcdMode(body)).toBe("disabled");
  });

  it("honours authored mass, damping, gravity scale and bullet CCD", () => {
    const adapter = make();
    const body = adapter.createBody({
      type: "dynamic",
      mass: 10,
      linearDamping: 1,
      angularDamping: 1,
      gravityScale: 0,
      ccdMode: "swept",
    });
    adapter.createCollider({
      body,
      shape: { type: "rectangle", halfExtents: new Vector2(1, 1) },
      offset: offsetOf(
        new Vector3(0.5, 0, 0),
        new Quaternion(0, 0, Math.sin(0.1), Math.cos(0.1)),
      ),
    });
    expect(adapter.getBodyMass(body)).toBeCloseTo(10, 8);
    expect(adapter.getBodyCcdMode(body)).toBe("swept");
    adapter.step(DT);
    expect(pos(adapter, body).y).toBe(0);
    adapter.setBodyType(body, "static");
    adapter.setBodyType(body, "dynamic");
    expect(adapter.getBodyMass(body)).toBeCloseTo(10, 8);
    const plain = adapter.createBody({
      type: "dynamic",
      continuousCollisionDetection: true,
    });
    expect(adapter.getBodyCcdMode(plain)).toBe("swept");
  });
});

describe("colliders", () => {
  it("builds circle, rectangle, capsule and polygon colliders with defaults", () => {
    const adapter = make();
    const body = adapter.createBody({ type: "dynamic" });
    adapter.createCollider({ body, shape: { type: "circle", radius: 1 } });
    adapter.createCollider({
      body,
      shape: { type: "capsule", radius: 0.25, halfHeight: 0.5 },
      offset: offsetOf(new Vector3(2, 0, 0), new Quaternion(0, 0, 0, 1)),
      material: { friction: 0.1, restitution: 0.2, density: 2 },
    });
    adapter.createCollider({
      body,
      shape: {
        type: "polygon",
        vertices: [new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 1)],
      },
      density: 3,
      collisionGroups: 0x2,
      collisionMask: 0x3,
    });
    const ids: number[] = [];
    adapter.forEachCollider((_h, id) => ids.push(id));
    expect(ids).toEqual([1, 2, 3]);
    const colliders: PhysicsColliderHandle[] = [];
    adapter.forEachCollider((h) => colliders.push(h));
    expect(adapter.getColliderBody(colliders[0])).toBe(body);
  });

  it("rejects unsupported and invalid shapes", () => {
    const adapter = make();
    const body = adapter.createBody({ type: "dynamic" });
    const many = Array.from(
      { length: 9 },
      (_, i) =>
        new Vector2(
          Math.cos((i / 9) * 2 * Math.PI),
          Math.sin((i / 9) * 2 * Math.PI),
        ),
    );
    expect(() =>
      adapter.createCollider({
        body,
        shape: { type: "polygon", vertices: many },
      }),
    ).toThrow(/at most 8/);
    expect(() =>
      adapter.createCollider({
        body,
        shape: {
          type: "polyline",
          vertices: [new Vector2(0, 0), new Vector2(1, 0)],
        },
      }),
    ).toThrow(/NOT_IMPLEMENTED|does not implement/);
    expect(() =>
      adapter.createCollider({
        body,
        shape: { type: "circle", radius: 1 },
        offset: offsetOf(new Vector3(0, 0, 1), new Quaternion(0, 0, 0, 1)),
      }),
    ).toThrow(/z/);
  });

  it("rejects unsupported body descriptors", () => {
    const adapter = make();
    expect(() =>
      adapter.createBody({ type: "dynamic", ccdMode: "speculative" }),
    ).toThrow(/speculative/);
    expect(() =>
      adapter.createBody({
        type: "dynamic",
        mass: 1,
        centerOfMass: new Vector2(0, 0),
      }),
    ).toThrow(/centerOfMass/);
    expect(() =>
      adapter.createBody({ type: "dynamic", position: new Vector3(0, 0, 1) }),
    ).toThrow(/z/);
    expect(() =>
      adapter.createBody({
        type: "dynamic",
        position: new Vector2(Number.NaN, 0),
      }),
    ).toThrow();
  });

  it("applies collision filtering", () => {
    const adapter = make();
    const floor = adapter.createBody({ type: "static" });
    adapter.createCollider({
      body: floor,
      shape: { type: "rectangle", halfExtents: new Vector2(50, 0.5) },
      collisionGroups: 0x1,
      collisionMask: 0x1,
    });
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 2),
    });
    adapter.createCollider({
      body,
      shape: { type: "circle", radius: 0.5 },
      collisionGroups: 0x2,
      collisionMask: 0x4,
    });
    for (let i = 0; i < 120; i += 1) adapter.step(DT);
    expect(pos(adapter, body).y).toBeLessThan(-2);
  });
});

describe("ids and handles", () => {
  it("keeps ids monotonic and never reused across remove/add", () => {
    const adapter = make();
    const a = ball(adapter, 1);
    const b = ball(adapter, 2);
    expect(adapter.getBodyId(a.body)).toBe(1);
    expect(adapter.getBodyId(b.body)).toBe(2);
    adapter.destroyCollider(a.collider);
    adapter.destroyBody(a.body);
    const c = ball(adapter, 3);
    expect(adapter.getBodyId(c.body)).toBe(3);
    expect(adapter.getColliderId(c.collider)).toBe(3);
    const seen: number[] = [];
    adapter.forEachBody((_h, id) => seen.push(id));
    expect(seen).toEqual([2, 3]);
    const cseen: number[] = [];
    adapter.forEachCollider((_h, id) => cseen.push(id));
    expect(cseen).toEqual([2, 3]);
  });

  it("rejects stale handles and destroys colliders with their body", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const adapter = make();
    const a = ball(adapter, 1);
    adapter.destroyBody(a.body);
    expect(() => adapter.getBodyId(a.body)).toThrow();
    expect(() => adapter.getColliderId(a.collider)).toThrow();
    expect(() => adapter.destroyCollider(a.collider)).toThrow();
    warn.mockRestore();
    const b = ball(adapter, 1);
    adapter.destroyCollider(b.collider);
    adapter.createCollider({
      body: b.body,
      shape: { type: "circle", radius: 1 },
    });
  });
});

describe("events", () => {
  function types(events: PhysicsEvent[]): string[] {
    return events.map((e) => e.type);
  }

  it("emits collisionstart, collisionstay, collisionend in order", () => {
    const adapter = make();
    const g = ground(adapter);
    const { body, collider } = ball(adapter, 1.2);
    const log: string[] = [];
    let startEvent: PhysicsEvent | undefined;
    for (let i = 0; i < 40; i += 1) {
      adapter.step(DT);
      for (const e of adapter.drainEvents()) {
        log.push(e.type);
        if (e.type === "collisionstart") startEvent = e;
      }
    }
    expect(log[0]).toBe("collisionstart");
    expect(log.filter((t) => t === "collisionstart")).toHaveLength(1);
    expect(log).toContain("collisionstay");
    expect(startEvent).toBeDefined();
    if (startEvent?.type === "collisionstart") {
      expect(
        startEvent.colliderA === collider || startEvent.colliderB === collider,
      ).toBe(true);
      expect(startEvent.contacts.length).toBeGreaterThan(0);
      expect(startEvent.bodyA === g.body || startEvent.bodyB === g.body).toBe(
        true,
      );
      const n = startEvent.contacts[0].normal;
      expect(Math.abs(n.y)).toBeCloseTo(1, 3);
    }
    // Lift the ball off the ground: the pair must stop.
    adapter.setBodyTransform(body, new Vector2(0, 20), 0);
    adapter.drainEvents();
    adapter.step(DT);
    expect(types(adapter.drainEvents())).toContain("collisionend");
  });

  it("drain hands the buffer over and clears it", () => {
    const adapter = make();
    ground(adapter);
    ball(adapter, 0.99);
    adapter.step(DT);
    expect(adapter.drainEvents().length).toBeGreaterThan(0);
    expect(adapter.drainEvents()).toEqual([]);
  });

  it("skips collisionstay when interest is switched off", () => {
    const adapter = make();
    ground(adapter);
    ball(adapter, 1.1);
    adapter.setEventInterest({ collisionstay: false });
    const log: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      adapter.step(DT);
      log.push(...types(adapter.drainEvents()));
    }
    expect(log).not.toContain("collisionstay");
    expect(log).toContain("collisionstart");
  });

  it("emits trigger enter/exit for sensors and aggregates capsule fixtures", () => {
    const adapter = make(new Vector2(0, 0));
    const sensorBody = adapter.createBody({ type: "static" });
    adapter.createCollider({
      body: sensorBody,
      shape: { type: "rectangle", halfExtents: new Vector2(2, 2) },
      sensor: true,
    });
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector2(10, 0),
    });
    adapter.createCollider({
      body,
      shape: { type: "capsule", radius: 0.5, halfHeight: 1 },
    });
    adapter.setBodyVelocities(body, new Vector2(-5, 0), 0);
    const log: string[] = [];
    for (let i = 0; i < 240; i += 1) {
      adapter.step(DT);
      log.push(...types(adapter.drainEvents()));
    }
    expect(log.filter((t) => t === "triggerenter")).toHaveLength(1);
    expect(log.filter((t) => t === "triggerexit")).toHaveLength(1);
    expect(log).not.toContain("collisionstart");
  });

  it("reports a capsule resting on ground as one pair", () => {
    const adapter = make();
    ground(adapter);
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 1.5),
      rotation: Math.PI / 2,
    });
    adapter.createCollider({
      body,
      shape: { type: "capsule", radius: 0.25, halfHeight: 0.5 },
    });
    const log: string[] = [];
    for (let i = 0; i < 60; i += 1) {
      adapter.step(DT);
      log.push(...types(adapter.drainEvents()));
    }
    expect(log.filter((t) => t === "collisionstart")).toHaveLength(1);
  });

  it("emits sleep then wake", () => {
    const adapter = make();
    ground(adapter);
    const { body } = ball(adapter, 1);
    const log: string[] = [];
    for (let i = 0; i < 200; i += 1) {
      adapter.step(DT);
      log.push(...types(adapter.drainEvents()));
    }
    expect(log).toContain("sleep");
    expect(adapter.isBodySleeping(body)).toBe(true);
    adapter.wakeBody(body);
    adapter.step(DT);
    expect(types(adapter.drainEvents())).toContain("wake");
  });

  it("forgets pairs when a body is destroyed mid-contact", () => {
    const adapter = make();
    ground(adapter);
    const { body } = ball(adapter, 1.1);
    for (let i = 0; i < 10; i += 1) adapter.step(DT);
    adapter.drainEvents();
    adapter.destroyBody(body);
    adapter.step(DT);
    expect(adapter.drainEvents()).toEqual([]);
  });
});

describe("queries and snapshots need a live world", () => {
  it("throw before initialize and after dispose", () => {
    const fresh = new Box2dAdapter();
    const disposed = make();
    disposed.dispose();
    for (const adapter of [fresh, disposed]) {
      const calls: (() => unknown)[] = [
        () => adapter.raycast({} as never),
        () => adapter.shapeCast({} as never),
        () => adapter.overlap({} as never),
        () => adapter.pointQuery({} as never),
        () => adapter.createSnapshot(),
        () => adapter.restoreSnapshot(new ArrayBuffer(0)),
      ];
      for (const call of calls) {
        expect(call).toThrow(
          expect.objectContaining({ code: "INVALID_APPLICATION_STATE" }),
        );
      }
    }
  });

  it("has no-op sync hooks", () => {
    const adapter = make();
    expect(() => {
      adapter.syncSceneToSolver();
      adapter.syncSolverToScene();
    }).not.toThrow();
  });
});

describe("edge cases", () => {
  it("rejects non-planar and non-finite vectors on the body-access seam", () => {
    const adapter = make();
    const { body } = ball(adapter, 1);
    expect(() =>
      adapter.setBodyTransform(body, new Vector3(0, 0, 1), 0),
    ).toThrow(/z/);
    expect(() =>
      adapter.setBodyTransform(body, new Vector2(Number.NaN, 0), 0),
    ).toThrow(/finite/);
  });

  it("does not wake on request-free velocity writes", () => {
    const adapter = make();
    const { body } = ball(adapter, 1);
    adapter.sleepBody(body);
    adapter.setBodyVelocities(body, new Vector2(1, 0), 0, false);
    expect(adapter.isBodySleeping(body)).toBe(true);
    adapter.setBodyVelocities(body, new Vector2(1, 0), 0);
    expect(adapter.isBodySleeping(body)).toBe(false);
  });

  it("keeps an authored mass on a zero-density body without dividing by zero", () => {
    const adapter = make();
    const body = adapter.createBody({ type: "dynamic", mass: 3 });
    adapter.createCollider({
      body,
      shape: { type: "circle", radius: 1 },
      density: 0,
    });
    expect(Number.isFinite(adapter.getBodyMass(body))).toBe(true);
  });

  it("rejects a degenerate polygon", () => {
    const adapter = make();
    const body = adapter.createBody({ type: "dynamic" });
    expect(() =>
      adapter.createCollider({
        body,
        shape: {
          type: "polygon",
          vertices: [new Vector2(0, 0), new Vector2(1, 0), new Vector2(2, 0)],
        },
      }),
    ).toThrow();
  });

  it("drops several pairs when one collider of many is destroyed", () => {
    const adapter = make();
    const g = ground(adapter);
    const a = ball(adapter, 0.99, 0, -2);
    const b = ball(adapter, 0.99, 0, 2);
    adapter.step(DT);
    adapter.destroyCollider(a.collider);
    adapter.step(DT);
    adapter.destroyCollider(g.collider);
    adapter.destroyBody(b.body);
    expect(() => adapter.step(DT)).not.toThrow();
  });
});
