/**
 * Sleeping bodies are not re-published (§32, audit H2): a dynamic body asleep
 * before and after a step keeps its pose and velocities, so the publish pass
 * skips the solver reads — except on transitions, after a solver-side write
 * that did not wake it, for `"blended"` authority, and after a snapshot restore.
 */

import { Vector3 } from "@fourjs/math";
import { Group, PoseTarget } from "@fourjs/scene";
import { describe, expect, it } from "vitest";

import { Collider, PhysicsWorld, RigidBody } from "../src/index.js";
import { FakeSolverAdapter } from "./fake-adapter.js";

const DT = 1 / 60;

async function setup(authority: "physics" | "blended" = "physics"): Promise<{
  adapter: FakeSolverAdapter;
  world: PhysicsWorld;
  node: Group;
}> {
  const adapter = new FakeSolverAdapter();
  const world = new PhysicsWorld({ dimension: "2d", adapter });
  await world.initialize();
  const node = new Group();
  node.transformAuthority = authority;
  node.addComponent(new RigidBody({ type: "dynamic", mass: 1 }));
  node.addComponent(new Collider({ shape: { type: "circle", radius: 0.5 } }));
  if (authority === "blended") {
    node.addComponent(new PoseTarget().copyFrom(node.transform));
    const body = node.getComponent(RigidBody)!;
    body.physicsWeight = 1;
    body.animationWeight = 0;
  }
  world.addBody(node);
  return { adapter, world, node };
}

/** Pose reads only: velocities are published every step by design (§23). */
function reads(adapter: FakeSolverAdapter): number {
  return adapter.callsOf("getBodyTransform").length;
}

describe("PhysicsWorld sleeping publish skip (§32)", () => {
  it("skips a body asleep before and after the step", async () => {
    const { adapter, world, node } = await setup();
    adapter.body(1).sleeping = true;
    world.step(DT); // transition step publishes
    world.step(DT); // pending cleared
    adapter.clearCalls();
    const version = node.transform.version;
    world.step(DT);
    expect(reads(adapter)).toBe(0);
    expect(node.transform.version).toBe(version);
    expect(node.getComponent(RigidBody)!.sleeping).toBe(true);
  });

  it("still mirrors solver velocities while the pose is skipped (§23)", async () => {
    const { adapter, world, node } = await setup();
    adapter.body(1).sleeping = true;
    world.step(DT);
    world.step(DT);
    const body = node.getComponent(RigidBody)!;
    body.linearVelocity.x = 5; // hand-edited, bypassing world.setLinearVelocity
    world.step(DT);
    expect(body.linearVelocity.x).toBe(0);
  });

  it("snaps a sleeping body to the solver pose when authority returns to physics", async () => {
    const { adapter, world, node } = await setup();
    adapter.body(1).sleeping = true;
    world.step(DT);
    world.step(DT);
    node.transformAuthority = "manual";
    world.step(DT); // conflict path, no solver pose write
    node.position.set(9, 9, 0); // the application moved it meanwhile
    node.transformAuthority = "physics";
    const version = node.transform.version;
    world.step(DT);
    expect(node.transform.version).not.toBe(version);
    expect(node.position.x).not.toBe(9);
    // Steady state resumes: the next step skips again.
    adapter.clearCalls();
    world.step(DT);
    expect(reads(adapter)).toBe(0);
  });

  it("publishes on the sleep transition and the wake transition", async () => {
    const { adapter, world } = await setup();
    world.step(DT);
    adapter.clearCalls();
    adapter.body(1).sleeping = true;
    world.step(DT);
    expect(reads(adapter)).toBeGreaterThan(0);
    world.step(DT);
    adapter.clearCalls();
    adapter.body(1).sleeping = false;
    world.step(DT);
    expect(reads(adapter)).toBeGreaterThan(0);
  });

  it("publishes exactly once after a no-wake teleport of a sleeping body", async () => {
    const { adapter, world, node } = await setup();
    adapter.body(1).sleeping = true;
    world.step(DT);
    world.step(DT);
    world.teleport(node, new Vector3(3, 4, 0), undefined, false);
    expect(adapter.body(1).sleeping).toBe(true);
    adapter.clearCalls();
    world.step(DT);
    expect(reads(adapter)).toBeGreaterThan(0);
    expect(node.transform.position.x).toBe(3);
    adapter.clearCalls();
    world.step(DT);
    expect(reads(adapter)).toBe(0);
  });

  it("publishes a sleeping body after a velocity write", async () => {
    const { adapter, world, node } = await setup();
    adapter.body(1).sleeping = true;
    world.step(DT);
    world.step(DT);
    world.setLinearVelocity(node, new Vector3(1, 0, 0));
    adapter.clearCalls();
    world.step(DT);
    expect(adapter.callsOf("getBodyVelocities").length).toBeGreaterThan(0);
  });

  it("never skips a blended body while the solver sleeps", async () => {
    const { adapter, world } = await setup("blended");
    adapter.body(1).sleeping = true;
    world.step(DT);
    world.step(DT);
    adapter.clearCalls();
    world.step(DT);
    expect(adapter.callsOf("getBodyTransform").length).toBeGreaterThan(0);
  });

  it("forces a publish after restoreSnapshot", async () => {
    const { adapter, world } = await setup();
    adapter.body(1).sleeping = true;
    world.step(DT);
    world.step(DT);
    const snapshot = world.createSnapshot();
    world.restoreSnapshot(snapshot);
    adapter.clearCalls();
    world.step(DT);
    expect(reads(adapter)).toBeGreaterThan(0);
  });
});
