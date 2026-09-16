/**
 * §40 `PhysicsWorldOptions.units` — authored numbers convert into SI for the
 * solver and back out. Omitted units is today's identity path.
 */

import { Vector2 } from "@fourjs/math";
import { Group } from "@fourjs/scene";
import { describe, expect, it } from "vitest";

import { Collider } from "../src/collider.js";
import { DEFAULT_GRAVITY_Y } from "../src/descriptors.js";
import { PhysicsWorld } from "../src/world.js";
import { RigidBody } from "../src/rigid-body.js";
import { FakeSolverAdapter } from "./fake-adapter.js";

const CM = { scale: { lengthToMeters: 0.01, massToKilograms: 1 } };

async function ready(overrides: ConstructorParameters<typeof PhysicsWorld>[0]) {
  const adapter = new FakeSolverAdapter();
  const world = new PhysicsWorld({ ...overrides, adapter });
  await world.initialize();
  return { adapter, world };
}

describe("PhysicsWorldOptions.units (§40)", () => {
  it("is identity when omitted — gravity matches the baseline bit-for-bit", async () => {
    const baseline = await ready({ dimension: "2d" });
    const also = await ready({ dimension: "2d" });

    expect(baseline.world.units).toBeUndefined();
    expect(Object.is(baseline.world.gravity.y, DEFAULT_GRAVITY_Y)).toBe(true);
    expect(Object.is(also.world.gravity.y, baseline.world.gravity.y)).toBe(
      true,
    );
    expect(Object.is(baseline.adapter.gravity.y, DEFAULT_GRAVITY_Y)).toBe(true);
    expect(baseline.world.toSiLength(2)).toBe(2);
    expect(baseline.world.fromSiLength(2)).toBe(2);
    expect(baseline.world.toSiMass(3)).toBe(3);

    baseline.world.dispose();
    also.world.dispose();
  });

  it("converts authored centimetre gravity into SI for the solver", async () => {
    const { adapter, world } = await ready({
      dimension: "2d",
      gravity: new Vector2(0, -981),
      units: CM,
    });

    expect(world.units?.scale.lengthToMeters).toBe(0.01);
    expect(world.gravity.y).toBeCloseTo(-9.81, 12);
    expect(adapter.gravity.y).toBeCloseTo(-9.81, 12);
    expect(world.toSiLength(100)).toBeCloseTo(1, 12);
    expect(world.fromSiLength(1)).toBeCloseTo(100, 12);
    expect(world.toSiMass(2)).toBe(2);
    expect(world.fromSiMass(2)).toBe(2);

    world.dispose();
  });

  it("leaves Appendix A's default gravity in SI when only a scale is set", async () => {
    const { world } = await ready({ dimension: "2d", units: CM });
    expect(Object.is(world.gravity.y, DEFAULT_GRAVITY_Y)).toBe(true);
    world.dispose();
  });

  it("converts an authored pose and mass at addBody, and publishes back", async () => {
    const { adapter, world } = await ready({
      dimension: "2d",
      gravity: new Vector2(0, 0),
      units: CM,
    });

    const node = new Group();
    node.transformAuthority = "physics";
    node.transform.position.set(100, 200, 0);
    node.addComponent(new RigidBody({ type: "dynamic", mass: 2 }));
    node.addComponent(new Collider({ shape: { type: "circle", radius: 0.5 } }));
    world.addBody(node);

    // Solver sees metres and kilograms.
    const fake = adapter.body(1);
    expect(fake.position.x).toBeCloseTo(1, 12);
    expect(fake.position.y).toBeCloseTo(2, 12);
    expect(fake.mass).toBeCloseTo(2, 12);

    // Node stays in authored centimetres until the publish pass.
    expect(node.transform.position.x).toBe(100);
    world.step(1 / 60);
    expect(node.transform.position.x).toBeCloseTo(100, 8);

    world.dispose();
  });

  it("converts authored mass when the mass scale is not 1", async () => {
    const { world } = await ready({
      dimension: "2d",
      units: { scale: { lengthToMeters: 1, massToKilograms: 0.001 } },
    });
    expect(world.toSiMass(2000)).toBeCloseTo(2, 12);
    expect(world.fromSiMass(2)).toBeCloseTo(2000, 12);
    world.dispose();
  });
});
