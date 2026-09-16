/**
 * Tests for §83's live solver-handle accounting (A-5 follow-up).
 *
 * The counters are process-wide levels, never reset, so every assertion is a
 * delta against the totals as this test found them. Components that are never
 * registered do not count: a handle exists only after `createBody` /
 * `createCollider` / `createJoint`.
 */

import { describe, expect, it, vi } from "vitest";

import { Group } from "@fourjs/scene";

import { Collider } from "../src/collider.js";
import { FixedJoint } from "../src/joints.js";
import { RigidBody } from "../src/rigid-body.js";
import {
  liveSolverBodyCount,
  liveSolverColliderCount,
  liveSolverHandleCount,
  liveSolverJointCount,
} from "../src/resource-memory.js";
import { PhysicsWorld } from "../src/world.js";
import { FakeJointSolverAdapter, FakeSolverAdapter } from "./fake-adapter.js";

/** A node carrying a dynamic body, optionally one circle collider. */
function bodyNode(withCollider: boolean): Group {
  const node = new Group();
  node.transformAuthority = "physics";
  node.addComponent(new RigidBody({ type: "dynamic" }));
  if (withCollider) {
    node.addComponent(new Collider({ shape: { type: "circle", radius: 0.5 } }));
  }
  return node;
}

describe("§83 solver-handle resource accounting (A-5)", () => {
  it("tracks body handles across addBody and removeBody", async () => {
    const before = liveSolverBodyCount();
    const handles = liveSolverHandleCount();
    const adapter = new FakeSolverAdapter();
    const world = new PhysicsWorld({ dimension: "2d", adapter });
    await world.initialize();
    const node = bodyNode(false);
    world.addBody(node);
    expect(liveSolverBodyCount()).toBe(before + 1);
    expect(liveSolverHandleCount()).toBe(handles + 1);
    world.removeBody(node);
    expect(liveSolverBodyCount()).toBe(before);
    expect(liveSolverHandleCount()).toBe(handles);
    world.dispose();
  });

  it("counts colliders scanned at addBody and subtracts them with the body", async () => {
    const bodies = liveSolverBodyCount();
    const colliders = liveSolverColliderCount();
    const handles = liveSolverHandleCount();
    const adapter = new FakeSolverAdapter();
    const world = new PhysicsWorld({ dimension: "2d", adapter });
    await world.initialize();
    const node = bodyNode(true);
    world.addBody(node);
    expect(liveSolverBodyCount()).toBe(bodies + 1);
    expect(liveSolverColliderCount()).toBe(colliders + 1);
    expect(liveSolverHandleCount()).toBe(handles + 2);
    world.removeBody(node);
    expect(liveSolverBodyCount()).toBe(bodies);
    expect(liveSolverColliderCount()).toBe(colliders);
    expect(liveSolverHandleCount()).toBe(handles);
    world.dispose();
  });

  it("tracks a late addCollider / removeCollider pair", async () => {
    const colliders = liveSolverColliderCount();
    const adapter = new FakeSolverAdapter();
    const world = new PhysicsWorld({ dimension: "2d", adapter });
    await world.initialize();
    const node = bodyNode(false);
    world.addBody(node);
    const late = new Collider({ shape: { type: "circle", radius: 0.25 } });
    const child = new Group();
    child.addComponent(late);
    node.add(child);

    expect(liveSolverColliderCount()).toBe(colliders);
    world.addCollider(late);
    expect(liveSolverColliderCount()).toBe(colliders + 1);
    world.removeCollider(late);
    expect(liveSolverColliderCount()).toBe(colliders);

    world.removeBody(node);
    world.dispose();
  });

  it("does not count a RigidBody or Collider that was never registered", () => {
    const handles = liveSolverHandleCount();
    new RigidBody({ type: "dynamic" });
    new Collider({ shape: { type: "circle", radius: 0.5 } });
    expect(liveSolverHandleCount()).toBe(handles);
  });

  it("tracks joints across addJoint and removeJoint", async () => {
    const joints = liveSolverJointCount();
    const handles = liveSolverHandleCount();
    const adapter = new FakeJointSolverAdapter();
    const world = new PhysicsWorld({ dimension: "2d", adapter });
    await world.initialize();
    const nodeA = bodyNode(true);
    const nodeB = bodyNode(true);
    const bodyA = world.addBody(nodeA);
    const bodyB = world.addBody(nodeB);
    const afterBodies = liveSolverHandleCount();

    const joint = new FixedJoint({ bodyA, bodyB });
    world.addJoint(joint);
    expect(liveSolverJointCount()).toBe(joints + 1);
    expect(liveSolverHandleCount()).toBe(afterBodies + 1);

    world.removeJoint(joint);
    expect(liveSolverJointCount()).toBe(joints);
    expect(liveSolverHandleCount()).toBe(afterBodies);

    world.dispose();
    expect(liveSolverHandleCount()).toBe(handles);
  });

  it("releases joints when the named body is removed", async () => {
    const joints = liveSolverJointCount();
    const adapter = new FakeJointSolverAdapter();
    const world = new PhysicsWorld({ dimension: "2d", adapter });
    await world.initialize();
    const nodeA = bodyNode(true);
    const nodeB = bodyNode(true);
    const bodyA = world.addBody(nodeA);
    const bodyB = world.addBody(nodeB);
    world.addJoint(new FixedJoint({ bodyA, bodyB }));
    expect(liveSolverJointCount()).toBe(joints + 1);

    world.removeBody(nodeA);
    expect(liveSolverJointCount()).toBe(joints);

    world.dispose();
  });

  it("releases every remaining handle on world.dispose", async () => {
    const bodies = liveSolverBodyCount();
    const colliders = liveSolverColliderCount();
    const joints = liveSolverJointCount();
    const handles = liveSolverHandleCount();
    const adapter = new FakeJointSolverAdapter();
    const world = new PhysicsWorld({ dimension: "2d", adapter });
    await world.initialize();
    const nodeA = bodyNode(true);
    const nodeB = bodyNode(true);
    const bodyA = world.addBody(nodeA);
    const bodyB = world.addBody(nodeB);
    world.addJoint(new FixedJoint({ bodyA, bodyB }));
    expect(liveSolverBodyCount()).toBe(bodies + 2);
    expect(liveSolverColliderCount()).toBe(colliders + 2);
    expect(liveSolverJointCount()).toBe(joints + 1);
    expect(liveSolverHandleCount()).toBe(handles + 5);

    world.dispose();
    expect(liveSolverBodyCount()).toBe(bodies);
    expect(liveSolverColliderCount()).toBe(colliders);
    expect(liveSolverJointCount()).toBe(joints);
    expect(liveSolverHandleCount()).toBe(handles);
  });

  it("subtracts a joint that the solver broke without a second destroyJoint", async () => {
    const joints = liveSolverJointCount();
    const adapter = new FakeJointSolverAdapter();
    const world = new PhysicsWorld({ dimension: "2d", adapter });
    await world.initialize();
    const nodeA = bodyNode(true);
    const nodeB = bodyNode(true);
    const bodyA = world.addBody(nodeA);
    const bodyB = world.addBody(nodeB);
    const joint = new FixedJoint({ bodyA, bodyB });
    world.addJoint(joint);
    expect(liveSolverJointCount()).toBe(joints + 1);

    // Solver-side break: the adapter already dropped the constraint; the
    // world's translation retires the registration without destroyJoint.
    adapter.scriptEvents({
      type: "jointbreak",
      joint: adapter.joint(1).handle,
      force: 1,
      torque: 0,
    });
    world.step(1 / 60);
    world.dispatchEvents();

    expect(liveSolverJointCount()).toBe(joints);
    world.dispose();
  });

  it("holds no reference to the handles it counts", () => {
    expect(typeof liveSolverBodyCount()).toBe("number");
    expect(typeof liveSolverColliderCount()).toBe("number");
    expect(typeof liveSolverJointCount()).toBe("number");
    expect(typeof liveSolverHandleCount()).toBe("number");
  });

  it("keeps the counters moving when DEV is false (message-only gating)", async () => {
    vi.stubGlobal("__FOUR_DEV__", false);
    vi.resetModules();
    const { PhysicsWorld: ProductionWorld } = await import("../src/world.js");
    const { RigidBody: ProductionBody } = await import("../src/rigid-body.js");
    const { liveSolverBodyCount: productionBodies } =
      await import("../src/resource-memory.js");
    const { FakeSolverAdapter: ProductionFake } =
      await import("./fake-adapter.js");
    const { Group: ProductionGroup } = await import("@fourjs/scene");

    const before = productionBodies();
    const adapter = new ProductionFake();
    const world = new ProductionWorld({ dimension: "2d", adapter });
    await world.initialize();
    const node = new ProductionGroup();
    node.addComponent(new ProductionBody({ type: "dynamic" }));
    world.addBody(node);
    expect(productionBodies()).toBe(before + 1);
    world.removeBody(node);
    expect(productionBodies()).toBe(before);
    world.dispose();

    vi.unstubAllGlobals();
    vi.resetModules();
  });
});
