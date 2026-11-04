import { Vector2, Vector3 } from "@fourjs/math";
import { describe, expect, it } from "vitest";

import { Box2dAdapter } from "../src/index.js";

const DT = 1 / 60;

function world(gravityY = 0): Box2dAdapter {
  const a = new Box2dAdapter();
  a.initialize({ dimension: "2d", gravity: new Vector2(0, gravityY) });
  return a;
}

/** Stadium mass and inertia about its centroid by point-in-stadium summation. */
function stadium(r: number, h: number): { mass: number; inertia: number } {
  const n = 2000;
  const ext = h + r;
  const cell = (2 * r) / n;
  const cellY = (2 * ext) / n;
  let mass = 0;
  let inertia = 0;
  for (let i = 0; i < n; i += 1) {
    const x = -r + (i + 0.5) * cell;
    for (let j = 0; j < n; j += 1) {
      const y = -ext + (j + 0.5) * cellY;
      const dy = Math.max(Math.abs(y) - h, 0);
      if (x * x + dy * dy <= r * r) {
        mass += cell * cellY;
        inertia += (x * x + y * y) * cell * cellY;
      }
    }
  }
  return { mass, inertia };
}

describe("capsule mass properties", () => {
  const r = 0.5;
  const h = 1;
  const oracle = stadium(r, h);

  function build(density: number): {
    a: Box2dAdapter;
    body: never;
    col: never;
  } {
    const a = world();
    const body = a.createBody({ type: "dynamic", position: new Vector2(0, 0) });
    const col = a.createCollider({
      body,
      shape: { type: "capsule", radius: r, halfHeight: h },
      density,
    });
    return { a, body, col } as never;
  }

  function measure(a: Box2dAdapter, body: never): { m: number; i: number } {
    const m = a.getBodyMass(body);
    a.applyAngularImpulse(body, 1);
    const ang = new Vector3();
    a.getBodyVelocities(body, new Vector3(), ang);
    return { m, i: 1 / ang.z };
  }

  it("matches the analytic capsule mass and inertia", () => {
    const { a, body } = build(1);
    const analyticMass = 4 * r * h + Math.PI * r * r;
    expect(analyticMass).toBeCloseTo(oracle.mass, 2);
    const { m, i } = measure(a, body);
    expect(m).toBeCloseTo(analyticMass, 6);
    expect(Math.abs(i - oracle.inertia) / oracle.inertia).toBeLessThan(0.005);
  });

  it("keeps the mass exact for a stubby capsule (no inertia fit)", () => {
    const a = world();
    const body = a.createBody({ type: "dynamic" });
    a.createCollider({
      body,
      shape: { type: "capsule", radius: 0.5, halfHeight: 0.25 },
      density: 1,
    });
    expect(a.getBodyMass(body)).toBeCloseTo(4 * 0.5 * 0.25 + Math.PI * 0.25, 6);
  });

  it("keeps the corrected capsule densities through setColliderMaterial", () => {
    const { a, body, col } = build(1);
    a.setColliderMaterial(col, 0.3, 0, 2);
    const { m, i } = measure(a, body);
    expect(m).toBeCloseTo(2 * oracle.mass, 4);
    expect(
      Math.abs(i - 2 * oracle.inertia) / (2 * oracle.inertia),
    ).toBeLessThan(0.005);
  });

  it("keeps the corrected capsule densities through snapshot restore", () => {
    const { a, body, col } = build(1);
    const snap = a.createSnapshot();
    const before = a.getBodyMass(body);
    a.setColliderMaterial(col, 0.3, 0, 3);
    expect(a.getBodyMass(body)).toBeGreaterThan(2 * before);
    a.restoreSnapshot(snap);
    expect(a.getBodyMass(body)).toBeCloseTo(before, 9);
    expect(before).toBeCloseTo(oracle.mass, 2);
  });
});

describe("setColliderFilter sensor toggle on a live pair", () => {
  it("ends the old family and begins the new one with no stale stay", () => {
    const a = world();
    a.setEventInterest({ collisionstay: true });
    const b1 = a.createBody({ type: "static" });
    const c1 = a.createCollider({
      body: b1,
      shape: { type: "rectangle", halfExtents: new Vector2(1, 1) },
    });
    const b2 = a.createBody({ type: "dynamic", position: new Vector2(0.5, 0) });
    a.createCollider({
      body: b2,
      shape: { type: "circle", radius: 0.5 },
    });
    a.step(DT);
    expect(a.drainEvents().map((e) => e.type)).toContain("collisionstart");
    a.setColliderFilter(c1, true, 0xffff, 0xffff);
    a.step(DT);
    a.step(DT);
    const types = a.drainEvents().map((e) => e.type);
    expect(types.indexOf("collisionend")).toBeGreaterThanOrEqual(0);
    expect(types.indexOf("triggerenter")).toBeGreaterThan(
      types.indexOf("collisionend"),
    );
    expect(types).not.toContain("collisionstay");
    a.setColliderFilter(c1, false, 0xffff, 0xffff);
    const back = a.drainEvents().map((e) => e.type);
    expect(back).toEqual(["triggerexit", "collisionstart"]);
  });
});
