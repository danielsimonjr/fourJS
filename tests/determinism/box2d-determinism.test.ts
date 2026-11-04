/**
 * W8.4: Box2D same-runtime determinism (§33) through the public `PhysicsWorld`
 * API. §33's tier for this adapter is `same-runtime`: two runs in one runtime
 * are bit-identical; no cross-platform golden is claimed, so none is pinned.
 * Scenes mix contacts, a hinge with a motor, and a sensor, so warm-started
 * solving, joint solving and event ordering are all inside the comparison.
 */

import { Vector3 } from "@fourjs/math";
import { HingeJoint, type PhysicsWorld } from "@fourjs/physics";
import { afterEach, describe, expect, it } from "vitest";

import {
  ball,
  createBox2dWorld,
  ground,
  run,
  slab,
} from "../integration/helpers/box2d-world.js";

const worlds: PhysicsWorld[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) {
    world.dispose();
  }
});

async function trace(seedOffset = 0, steps = 240): Promise<number[]> {
  const world = await createBox2dWorld();
  worlds.push(world);
  ground(world, { friction: 0.6 });
  const anchor = slab(world, 0.1, 0.1, {
    type: "static",
    position: new Vector3(4, 4, 0),
  });
  const arm = slab(world, 0.5, 0.05, { position: new Vector3(4.5, 4, 0) });
  world.addJoint(
    new HingeJoint({
      bodyA: anchor.body,
      bodyB: arm.body,
      anchor: new Vector3(4, 4, 0),
      axis: new Vector3(0, 0, 1),
      motor: { enabled: true, targetVelocity: 2, maxTorque: 0.5 },
    }),
  );
  slab(world, 1, 0.2, {
    type: "static",
    position: new Vector3(0, 1, 0),
    sensor: true,
  });
  for (let i = 0; i < 12; i += 1) {
    ball(world, 0.25 + 0.02 * (i % 3), {
      position: new Vector3(-1 + (i % 4) * 0.55 + seedOffset, 2 + i * 0.6, 0),
      restitution: 0.2,
      friction: 0.4,
    });
  }
  const sums: number[] = [];
  for (let i = 0; i < steps; i += 1) {
    run(world, 1);
    sums.push(world.checksum());
  }
  return sums;
}

describe("box2d same-runtime determinism (§33)", () => {
  it("two identical runs agree on every per-step checksum", async () => {
    const a = await trace();
    const b = await trace();
    expect(b).toEqual(a);
    expect(new Set(a).size).toBeGreaterThan(100);
  });

  it("a perturbed scene diverges (the checksum is not constant)", async () => {
    const a = await trace();
    const c = await trace(0.001);
    expect(c).not.toEqual(a);
  });
});
