import { isFourError } from "@fourjs/core";
import {Matrix3,
  Quaternion,
  Vector2,
  Vector3,
  constructionCount,
  resetConstructionCount} from "@fourjs/math";
import { PoseBuffer, createSnapshotSystem, Group } from "@fourjs/scene";
import { SystemRegistry, createTimeState } from "@fourjs/motion";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  CollisionEvent,
  PhysicsBodyHandle,
  PhysicsColliderHandle,
  PhysicsWorldInit,
  SleepEvent,
  TriggerEvent,
} from "../src/index.js";
import {
  Collider,
  DEFAULT_SLEEPING_CONFIG,
  PhysicsMaterial,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
} from "../src/index.js";
import { FakeSolverAdapter } from "./fake-adapter.js";

/** Everything `PhysicsWorldInit` carries except the adapter, which is the fake. */
type WorldOverrides = Omit<Partial<PhysicsWorldInit>, "adapter"> & {
  adapter?: FakeSolverAdapter;
};

/** A 2D world on a fresh fake adapter, not yet initialized. */
function makeWorld(overrides: WorldOverrides = {}): {
  adapter: FakeSolverAdapter;
  world: PhysicsWorld;
} {
  const adapter = overrides.adapter ?? new FakeSolverAdapter();
  const world = new PhysicsWorld({ dimension: "2d", ...overrides, adapter });
  return { adapter, world };
}

/** A 2D world that has completed `initialize`. */
async function readyWorld(
  overrides: WorldOverrides = {},
): Promise<{ adapter: FakeSolverAdapter; world: PhysicsWorld }> {
  const made = makeWorld(overrides);
  await made.world.initialize();
  return made;
}

/** A node carrying a dynamic body and one circle collider, under `"physics"`. */
function dynamicNode(options: { density?: number; mass?: number } = {}): Group {
  const node = new Group();
  node.transformAuthority = "physics";
  node.addComponent(
    new RigidBody(
      options.mass === undefined
        ? { type: "dynamic" }
        : { type: "dynamic", mass: options.mass },
    ),
  );
  node.addComponent(
    new Collider(
      options.density === undefined
        ? { shape: { type: "circle", radius: 0.5 } }
        : { shape: { type: "circle", radius: 0.5 }, density: options.density },
    ),
  );
  return node;
}

/** The handle of the fake body with monotonic id `id`. */
function bodyHandle(adapter: FakeSolverAdapter, id: number): PhysicsBodyHandle {
  return adapter.body(id).handle;
}

/** The handle of the fake collider with monotonic id `id`. */
function colliderHandle(
  adapter: FakeSolverAdapter,
  id: number,
): PhysicsColliderHandle {
  const collider = adapter.colliders.get(id);
  if (collider === undefined) {
    throw new Error(`fake adapter has no collider ${String(id)}`);
  }
  return collider.handle;
}

/** A `collisionstart` between the fake's bodies/colliders 1 and 2. */
function collisionEvent(
  adapter: FakeSolverAdapter,
  type: CollisionEvent["type"] = "collisionstart",
): CollisionEvent {
  return {
    type,
    bodyA: bodyHandle(adapter, 1),
    bodyB: bodyHandle(adapter, 2),
    colliderA: colliderHandle(adapter, 1),
    colliderB: colliderHandle(adapter, 2),
    contacts: [],
    relativeVelocity: new Vector3(),
    totalImpulse: new Vector3(),
  };
}

/** Runs `run` and returns the `FourError` it threw. */
function expectFourError(run: () => void): Error & { code: string } {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(isFourError(caught)).toBe(true);
  return caught as Error & { code: string };
}

/**
 * An independent FNV-1a implementation of §33's checksum, written from the
 * specification text rather than from `world.ts`, so the two agreeing means the
 * algorithm is right and not merely self-consistent.
 */
function referenceChecksum(values: readonly number[]): number {
  let h = 2166136261 >>> 0;
  const absorb = (word: number): void => {
    const w = word >>> 0;
    h = Math.imul(h ^ (w & 0xff), 16777619) >>> 0;
    h = Math.imul(h ^ ((w >>> 8) & 0xff), 16777619) >>> 0;
    h = Math.imul(h ^ ((w >>> 16) & 0xff), 16777619) >>> 0;
    h = Math.imul(h ^ ((w >>> 24) & 0xff), 16777619) >>> 0;
  };
  for (const value of values) {
    const q = Math.round((value === 0 ? 0 : value) * 1e6);
    let low = q % 4294967296;
    if (low < 0) {
      low += 4294967296;
    }
    absorb(low);
    absorb((q - low) / 4294967296);
  }
  return h >>> 0;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PhysicsWorld construction (§20, §21, §33, §37)", () => {
  it("resolves gravity, sleeping, and determinism into the adapter's options", async () => {
    // The threshold below is one the fake adapter declares it cannot apply, so
    // construction warns about it (§32; see the accepted-and-ignored suite).
    // Silenced here rather than asserted — this test is about resolution.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { adapter, world } = await readyWorld({
      sleeping: { timeThreshold: 2 },
    });
    warn.mockRestore();

    expect(world.dimension).toBe("2d");
    expect(world.gravity.y).toBeCloseTo(-9.81);
    expect(world.gravity.z).toBe(0);
    expect(world.sleeping).toEqual({
      enabled: true,
      linearThreshold: 0.01,
      angularThreshold: 0.01,
      timeThreshold: 2,
    });
    expect(world.determinism).toBe("same-runtime");
    expect(world.options).toBe(adapter.options);
    expect(world.adapter).toBe(adapter);
    expect(world.initialized).toBe(true);
    expect(world.disposed).toBe(false);
    expect(world.size).toBe(0);
  });

  it("widens a Vector2 gravity and keeps −Y in both dimensions (§7a, §21)", async () => {
    const { adapter } = await readyWorld({ gravity: new Vector2(0, -3) });
    expect(adapter.gravity.y).toBe(-3);
    expect(adapter.gravity.z).toBe(0);
  });

  it("rejects options the §85 validators reject", () => {
    const error = expectFourError(() => {
      makeWorld({ gravity: new Vector3(0, -9.81, 1) });
    });
    expect(error.code).toBe("INVALID_APPLICATION_STATE");
  });

  it("rejects a dimension the adapter does not declare (§21, §37)", () => {
    const adapter = new FakeSolverAdapter({
      capabilities: { dimensions: ["3d"] },
    });
    const error = expectFourError(() => {
      makeWorld({ adapter });
    });
    expect(error.message).toContain("cannot simulate");
  });

  it("rejects a determinism tier stronger than the adapter declares (§33)", () => {
    const adapter = new FakeSolverAdapter({
      capabilities: { determinism: "same-runtime" },
    });
    const error = expectFourError(() => {
      makeWorld({ adapter, determinism: "cross-platform" });
    });
    expect(error.message).toContain("weaker than the requested");
  });

  it("accepts a tier weaker than the adapter declares", () => {
    const adapter = new FakeSolverAdapter({
      capabilities: { determinism: "cross-platform" },
    });
    const { world } = makeWorld({ adapter, determinism: "none" });
    expect(world.determinism).toBe("none");
  });

  it("refuses a second initialize and refuses use before the first (§37)", async () => {
    const { world } = makeWorld();
    expect(expectFourError(() => world.step(1 / 60)).message).toContain(
      "has not been initialized",
    );
    expect(
      expectFourError(() => world.addBody(dynamicNode())).message,
    ).toContain("has not been initialized");

    await world.initialize();
    await expect(world.initialize()).rejects.toThrow("was called twice");
  });
});

describe("PhysicsWorld registration (§23, §24, §37)", () => {
  it("creates the body then its colliders and maps monotonic ids (§33)", async () => {
    const { adapter, world } = await readyWorld();
    const node = dynamicNode();

    const body = world.addBody(node);

    expect(body).toBe(node.getComponent(RigidBody));
    expect(world.has(node)).toBe(true);
    expect(world.getBody(node)).toBe(body);
    expect(world.size).toBe(1);
    expect([...world.nodes]).toEqual([node]);
    expect(adapter.bodies.size).toBe(1);
    expect(adapter.colliders.size).toBe(1);
    expect(adapter.callOrder.slice(1, 3)).toEqual([
      "createBody",
      "createCollider",
    ]);
  });

  it("assigns ascending ids that survive destruction (§33, §37)", async () => {
    const { adapter, world } = await readyWorld();
    const first = dynamicNode();
    const second = dynamicNode();
    world.addBody(first);
    world.addBody(second);
    expect([...adapter.bodies.keys()]).toEqual([1, 2]);

    world.removeBody(first);
    const third = dynamicNode();
    world.addBody(third);

    expect([...adapter.bodies.keys()]).toEqual([2, 3]);
  });

  it("seeds the initial pose from the node transform when unauthored", async () => {
    const { adapter, world } = await readyWorld();
    const node = dynamicNode();
    node.transform.position.set(1, 5, 0);
    world.addBody(node);

    expect(adapter.body(1).position.y).toBe(5);
  });

  it("keeps an authored descriptor pose over the node transform", async () => {
    const { adapter, world } = await readyWorld();
    const node = new Group();
    node.transformAuthority = "physics";
    node.addComponent(
      new RigidBody({ type: "dynamic", position: new Vector2(0, 9) }),
    );
    node.transform.position.set(1, 1, 0);
    world.addBody(node);

    expect(adapter.body(1).position.y).toBe(9);
  });

  it("registers colliders on descendant nodes at any depth (§24)", async () => {
    const { adapter, world } = await readyWorld();
    const node = dynamicNode();
    const grouping = new Group();
    const deep = new Group();
    deep.addComponent(new Collider({ shape: { type: "circle", radius: 1 } }));
    grouping.add(deep);
    node.add(grouping);

    world.addBody(node);

    expect(adapter.colliders.size).toBe(2);
    expect([...adapter.colliders.keys()]).toEqual([1, 2]);
  });

  it("skips colliders whose ancestor walk names a nested body (§24)", async () => {
    const { adapter, world } = await readyWorld();
    const parent = dynamicNode();
    const child = dynamicNode();
    const grandchild = new Group();
    grandchild.addComponent(
      new Collider({ shape: { type: "circle", radius: 1 } }),
    );
    child.add(grandchild);
    parent.add(child);

    world.addBody(parent);

    // Only the parent's own collider: the child's collider and the collider
    // under the child both resolve to the child's body.
    expect(adapter.colliders.size).toBe(1);
    expect(adapter.colliders.get(1)?.body.id).toBe(1);

    world.addBody(child);
    expect(adapter.colliders.size).toBe(3);
  });

  it("rejects a node with no RigidBody (§23)", async () => {
    const { world } = await readyWorld();
    const error = expectFourError(() => world.addBody(new Group()));
    expect(error.code).toBe("INVALID_SCENE_GRAPH");
  });

  it("rejects a double registration", async () => {
    const { world } = await readyWorld();
    const node = dynamicNode();
    world.addBody(node);
    expect(expectFourError(() => world.addBody(node)).message).toContain(
      "already registered",
    );
  });

  it("validates body and colliders for the world's dimension (§21, §85)", async () => {
    const { adapter, world } = await readyWorld();
    const node = new Group();
    node.addComponent(new RigidBody({ type: "dynamic" }));
    node.addComponent(new Collider({ shape: { type: "sphere", radius: 1 } }));

    const error = expectFourError(() => world.addBody(node));
    expect(error.code).toBe("INVALID_APPLICATION_STATE");
    // Nothing reached the solver: validation runs before any adapter call.
    expect(adapter.bodies.size).toBe(0);
  });

  it("rejects an out-of-plane body before the solver sees it (§21)", async () => {
    const { adapter, world } = await readyWorld();
    const node = new Group();
    node.addComponent(
      new RigidBody({ type: "dynamic", angularVelocity: new Vector3(1, 0, 0) }),
    );
    expectFourError(() => world.addBody(node));
    expect(adapter.bodies.size).toBe(0);
  });

  // 2026-08-07: teardown is **one** `destroyBody`, which §37 defines as taking
  // everything attached with it. The per-collider `destroyCollider` calls that
  // used to precede it were work whose result was discarded on the next line
  // (each one re-established the §23 mass of the body about to be destroyed).
  it("removes a body with one adapter call, and reports unknown nodes", async () => {
    const { adapter, world } = await readyWorld();
    const node = dynamicNode();
    world.addBody(node);
    const colliderComponent = node.getComponent(Collider);
    adapter.clearCalls();

    expect(world.removeBody(node)).toBe(true);
    expect(world.removeBody(node)).toBe(false);
    expect(world.removeBody(new Group())).toBe(false);
    expect(adapter.callOrder).toEqual(["destroyBody"]);
    expect(world.size).toBe(0);
    // The adapter forgot the collider with its body, and so did the world's own
    // component→handle index: nothing believes it is still simulated.
    expect(adapter.colliders.size).toBe(0);
    expect(
      colliderComponent === undefined
        ? undefined
        : world.getColliderHandle(colliderComponent),
    ).toBeUndefined();
  });
});

describe("PhysicsWorld mass refresh (§23, §25; plan §6d 2026-08-01)", () => {
  it("reads the solver's derived mass back onto the component", async () => {
    const { world } = await readyWorld();
    const node = dynamicNode({ density: 4 });
    const body = world.addBody(node);

    expect(body.mass).toBe(4);
    expect(body.inverseMass).toBe(0.25);
  });

  it("leaves an unknown mass as NaN when the solver derives none (§23)", async () => {
    const { world } = await readyWorld();
    const node = new Group();
    node.addComponent(new RigidBody({ type: "dynamic" }));
    const body = world.addBody(node);

    expect(body.mass).toBeUndefined();
    expect(body.inverseMass).toBeNaN();
  });

  it("does not overwrite a static body's mass with the solver's zero", async () => {
    const { world } = await readyWorld();
    const node = new Group();
    node.addComponent(new RigidBody({ type: "static" }));
    node.addComponent(new Collider({ shape: { type: "circle", radius: 1 } }));
    const body = world.addBody(node);

    expect(body.mass).toBeUndefined();
    expect(body.inverseMass).toBe(0);
  });
});

describe("PhysicsWorld §26 commands", () => {
  it("resets forces, drains the buffer in §26 order, and clears it", async () => {
    const { adapter, world } = await readyWorld();
    const node = dynamicNode({ density: 2 });
    const body = world.addBody(node);

    body.applyForce(new Vector2(3, 0));
    body.applyTorque(1.5);
    body.applyForceAtPoint(new Vector2(1, 0), new Vector2(2, 0));
    body.applyImpulse(new Vector2(0, 4));
    body.applyAngularImpulse(0.5);
    body.applyImpulseAtPoint(new Vector2(1, 1), new Vector2(0, 0));
    adapter.clearCalls();

    world.step(1 / 60);

    expect(
      adapter.callOrder.filter(
        (method) => method.startsWith("apply") || method === "resetForces",
      ),
    ).toEqual([
      "resetForces",
      "applyForce",
      "applyTorque",
      "applyForceAtPoint",
      "applyImpulse",
      "applyAngularImpulse",
      "applyImpulseAtPoint",
    ]);

    const commands = body.commands;
    expect(commands.force.x).toBe(0);
    expect(commands.torque.z).toBe(0);
    expect(commands.impulse.y).toBe(0);
    expect(commands.pointForceCount).toBe(0);
    expect(commands.pointImpulseCount).toBe(0);

    adapter.clearCalls();
    world.step(1 / 60);
    // A force acts for one step; an impulse is applied exactly once.
    expect(adapter.callsOf("applyForce")).toHaveLength(0);
    expect(adapter.callsOf("applyImpulse")).toHaveLength(0);
    expect(adapter.callsOf("resetForces")).toHaveLength(1);
  });

  it("keeps pushing while a force is re-applied every step (§26)", async () => {
    const { adapter, world } = await readyWorld();
    const body = world.addBody(dynamicNode({ density: 1 }));

    for (let i = 0; i < 3; i += 1) {
      body.applyForce(new Vector2(0, 10));
      world.step(1 / 60);
    }
    expect(adapter.callsOf("applyForce")).toHaveLength(3);
  });

  it("forwards wake and sleep commands (§32)", async () => {
    const { adapter, world } = await readyWorld();
    const body = world.addBody(dynamicNode());

    body.sleep();
    world.step(1 / 60);
    expect(adapter.callsOf("sleepBody")).toHaveLength(1);
    expect(body.sleeping).toBe(true);

    body.wake();
    world.step(1 / 60);
    expect(adapter.callsOf("wakeBody")).toHaveLength(1);
    expect(body.sleeping).toBe(false);
    // Last command wins, and it is cleared afterwards.
    world.step(1 / 60);
    expect(adapter.callsOf("wakeBody")).toHaveLength(1);
  });
});

describe("PhysicsWorld kinematic feed (§22, §37)", () => {
  /** A kinematic node of `type` under `authority`. */
  function kinematicNode(
    type: "kinematic-position" | "kinematic-velocity",
    authority: "kinematic" | "physics" | "manual" = "kinematic",
  ): Group {
    const node = new Group();
    node.transformAuthority = authority;
    node.addComponent(new RigidBody({ type }));
    node.addComponent(new Collider({ shape: { type: "circle", radius: 1 } }));
    return node;
  }

  it("feeds a position target from the node transform", async () => {
    const { adapter, world } = await readyWorld();
    const node = kinematicNode("kinematic-position");
    world.addBody(node);

    node.transform.position.set(2, 3, 0);
    world.step(1 / 60);

    const calls = adapter.callsOf("setNextKinematicTransform");
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toEqual(new Vector3(2, 3, 0));
    // The toy solver moved the body to the target.
    expect(adapter.body(1).position.x).toBe(2);
  });

  it("feeds velocities for a velocity-driven body", async () => {
    const { adapter, world } = await readyWorld();
    const node = kinematicNode("kinematic-velocity");
    const body = world.addBody(node);
    body.linearVelocity.set(1, 0, 0);

    world.step(2);

    const calls = adapter.callsOf("setBodyVelocities");
    expect(calls).toHaveLength(1);
    expect(adapter.body(1).position.x).toBe(2);
    expect(adapter.callsOf("setNextKinematicTransform")).toHaveLength(0);
  });

  it('does not read the node back as a target under "physics" authority', async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(kinematicNode("kinematic-position", "physics"));

    world.step(1 / 60);

    expect(adapter.callsOf("setNextKinematicTransform")).toHaveLength(0);
  });

  it("feeds a manually authored pose, which no system owns (§42)", async () => {
    const { adapter, world } = await readyWorld();
    const node = kinematicNode("kinematic-position", "manual");
    world.addBody(node);
    node.transform.position.set(4, 0, 0);

    world.step(1 / 60);

    expect(adapter.callsOf("setNextKinematicTransform")).toHaveLength(1);
  });

  it("never feeds a dynamic body", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(dynamicNode());
    world.step(1 / 60);
    expect(adapter.callsOf("setNextKinematicTransform")).toHaveLength(0);
    expect(adapter.callsOf("setBodyVelocities")).toHaveLength(0);
  });
});

describe("PhysicsWorld step pipeline (§37, §39)", () => {
  it("calls the §37 hooks in order around the step", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(dynamicNode());
    adapter.clearCalls();

    world.step(1 / 60);

    const pipeline = adapter.callOrder.filter((method) =>
      [
        "resetForces",
        "syncSceneToSolver",
        "step",
        "syncSolverToScene",
        "getBodyTransform",
        "drainEvents",
      ].includes(method),
    );
    expect(pipeline).toEqual([
      "resetForces",
      "syncSceneToSolver",
      "step",
      "syncSolverToScene",
      "getBodyTransform",
      "drainEvents",
    ]);
  });

  it("passes the fixed delta through in seconds (§7a, §10)", async () => {
    const { adapter, world } = await readyWorld();
    world.step(1 / 120);
    expect(adapter.callsOf("step")[0].args[0]).toBe(1 / 120);
  });

  it('publishes solved transforms and velocities under "physics" authority (§42)', async () => {
    const { adapter, world } = await readyWorld({
      gravity: new Vector2(0, -10),
    });
    const node = dynamicNode({ density: 1 });
    const body = world.addBody(node);

    world.step(0.5);

    expect(node.transform.position.y).toBeCloseTo(-2.5);
    expect(body.linearVelocity.y).toBeCloseTo(-5);
    expect(adapter.body(1).sleeping).toBe(false);
    expect(body.sleeping).toBe(false);
  });

  it("refuses the write and warns once for a node it does not own (§42)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { world } = await readyWorld({ gravity: new Vector2(0, -10) });
    const node = dynamicNode();
    node.transformAuthority = "manual";
    const body = world.addBody(node);

    world.step(0.5);
    world.step(0.5);

    expect(node.transform.position.y).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('"physics" system');
    // Velocities still mirror the solver: §42 governs transforms, not state.
    expect(body.linearVelocity.y).toBeLessThan(0);
  });

  it("publishes sleep state without emitting an event of its own (§32)", async () => {
    const { adapter, world } = await readyWorld();
    const body = world.addBody(dynamicNode());
    const seen: string[] = [];
    body.on("sleep", () => seen.push("sleep"));

    adapter.body(1).sleeping = true;
    world.step(1 / 60);
    world.dispatchEvents();

    expect(body.sleeping).toBe(true);
    expect(seen).toEqual([]);
  });

  it("never writes a transform for a non-dynamic body", async () => {
    const { adapter, world } = await readyWorld();
    const node = new Group();
    node.transformAuthority = "physics";
    node.addComponent(new RigidBody({ type: "static" }));
    world.addBody(node);
    adapter.clearCalls();

    world.step(1 / 60);

    expect(adapter.callsOf("getBodyTransform")).toHaveLength(0);
    expect(adapter.callsOf("getBodyVelocities")).toHaveLength(1);
  });

  it("allocates no math objects on the per-step path (§7b, D7)", async () => {
    const { world } = await readyWorld();
    world.addBody(dynamicNode({ density: 1 }));
    world.addBody(dynamicNode({ density: 1 }));
    world.step(1 / 60);

    resetConstructionCount();
    for (let i = 0; i < 10; i += 1) {
      world.step(1 / 60);
      world.dispatchEvents();
      world.checksum();
    }
    expect(constructionCount()).toBe(0);
  });
});

describe("PhysicsWorld §43 pose integration", () => {
  it("tracks dynamic body nodes and untracks them on removal", async () => {
    const poses = new PoseBuffer();
    const { world } = await readyWorld({ poses });
    const dynamic = dynamicNode();
    const staticNode = new Group();
    staticNode.addComponent(new RigidBody({ type: "static" }));

    world.addBody(dynamic);
    world.addBody(staticNode);

    expect(poses.has(dynamic)).toBe(true);
    expect(poses.has(staticNode)).toBe(false);

    world.removeBody(dynamic);
    expect(poses.has(dynamic)).toBe(false);
  });

  it("interpolates between the pre- and post-step poses at alpha 0.5 (§43)", async () => {
    const poses = new PoseBuffer();
    const { world } = await readyWorld({
      poses,
      gravity: new Vector2(0, -10),
    });
    const node = dynamicNode({ density: 1 });
    world.addBody(node);

    const registry = new SystemRegistry();
    registry.register(new PhysicsSystem({ worlds: [world] }));
    registry.register(createSnapshotSystem(poses));
    const time = createTimeState({ fixedDeltaTime: 0.1 });

    registry.runFixedStep(time);
    const afterFirst = node.transform.position.y;
    registry.runFixedStep(time);
    const afterSecond = node.transform.position.y;
    expect(afterFirst).not.toBe(afterSecond);

    const position = new Vector3();
    const rotation = new Quaternion();
    expect(poses.computeRenderPose(node, 0.5, position, rotation)).toBe(true);
    expect(position.y).toBeCloseTo((afterFirst + afterSecond) / 2, 12);

    registry.dispose();
  });

  it("untracks every node when the world is disposed", async () => {
    const poses = new PoseBuffer();
    const { world } = await readyWorld({ poses });
    const node = dynamicNode();
    world.addBody(node);

    world.dispose();

    expect(poses.has(node)).toBe(false);
  });
});

describe("PhysicsWorld events (§29, §6b, §39 step 9)", () => {
  /** A world with two registered dynamic bodies, ids 1 and 2. */
  async function twoBodyWorld(): Promise<{
    adapter: FakeSolverAdapter;
    world: PhysicsWorld;
    first: Group;
    second: Group;
  }> {
    const { adapter, world } = await readyWorld();
    const first = dynamicNode();
    const second = dynamicNode();
    world.addBody(first);
    world.addBody(second);
    return { adapter, world, first, second };
  }

  it("translates handles to components and dispatches on both bodies", async () => {
    const { adapter, world, first, second } = await twoBodyWorld();
    const bodyA = world.getBody(first);
    const bodyB = world.getBody(second);
    const order: string[] = [];
    bodyA?.on("collisionstart", (event) => {
      order.push("A");
      expect(event.bodyA).toBe(bodyA);
      expect(event.bodyB).toBe(bodyB);
      expect(event.colliderA).toBe(first.getComponent(Collider));
      expect(event.colliderB).toBe(second.getComponent(Collider));
    });
    bodyB?.on("collisionstart", () => order.push("B"));

    adapter.scriptEvents(collisionEvent(adapter));
    world.step(1 / 60);

    expect(world.queuedEvents).toHaveLength(1);
    expect(order).toEqual([]);

    world.dispatchEvents();
    expect(order).toEqual(["A", "B"]);
    expect(world.queuedEvents).toHaveLength(0);
  });

  it("preserves the adapter's event order (§33, §37)", async () => {
    const { adapter, world, first } = await twoBodyWorld();
    const seen: string[] = [];
    const body = world.getBody(first);
    body?.on("collisionstart", () => seen.push("start"));
    body?.on("collisionstay", () => seen.push("stay"));
    body?.on("collisionend", () => seen.push("end"));

    adapter.scriptEvents(
      collisionEvent(adapter, "collisionstart"),
      collisionEvent(adapter, "collisionstay"),
      collisionEvent(adapter, "collisionend"),
    );
    world.step(1 / 60);
    world.dispatchEvents();

    expect(seen).toEqual(["start", "stay", "end"]);
  });

  it("emits a self-collision once", async () => {
    const { adapter, world, first } = await twoBodyWorld();
    const body = world.getBody(first);
    let calls = 0;
    body?.on("collisionstart", () => {
      calls += 1;
    });

    const event = collisionEvent(adapter);
    adapter.scriptEvents({ ...event, bodyB: event.bodyA });
    world.step(1 / 60);
    world.dispatchEvents();

    expect(calls).toBe(1);
  });

  it("emits trigger events on the sensor collider only (§29)", async () => {
    const { adapter, world, first, second } = await twoBodyWorld();
    const sensor = first.getComponent(Collider);
    const other = second.getComponent(Collider);
    const seen: string[] = [];
    sensor?.on("triggerenter", (event) => {
      seen.push("sensor");
      expect(event.other).toBe(other);
      expect(event.otherBody).toBe(world.getBody(second));
    });
    other?.on("triggerenter", () => seen.push("other"));

    const trigger: TriggerEvent = {
      type: "triggerenter",
      sensor: colliderHandle(adapter, 1),
      sensorBody: bodyHandle(adapter, 1),
      other: colliderHandle(adapter, 2),
      otherBody: bodyHandle(adapter, 2),
    };
    adapter.scriptEvents(trigger);
    world.step(1 / 60);
    world.dispatchEvents();

    expect(seen).toEqual(["sensor"]);
  });

  it("emits sleep and wake on the body (§32)", async () => {
    const { adapter, world, first } = await twoBodyWorld();
    const body = world.getBody(first);
    const seen: string[] = [];
    body?.on("sleep", (event) => {
      seen.push(event.type);
      expect(event.body).toBe(body);
    });
    body?.on("wake", (event) => seen.push(event.type));

    const sleep: SleepEvent = { type: "sleep", body: bodyHandle(adapter, 1) };
    const wake: SleepEvent = { type: "wake", body: bodyHandle(adapter, 1) };
    adapter.scriptEvents(sleep, wake);
    world.step(1 / 60);
    world.dispatchEvents();

    expect(seen).toEqual(["sleep", "wake"]);
  });

  it("drops events naming bodies this world has not registered", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(dynamicNode());
    const foreign = adapter.createBody({ type: "dynamic" });

    adapter.scriptEvents({ type: "wake", body: foreign });
    world.step(1 / 60);

    expect(world.queuedEvents).toHaveLength(0);
  });

  it("drops collision and trigger events with an unknown collider", async () => {
    const { adapter, world, first } = await twoBodyWorld();
    const foreignBody = adapter.createBody({ type: "dynamic" });
    const foreignCollider = adapter.createCollider({
      shape: { type: "circle", radius: 1 },
      body: foreignBody,
    });

    adapter.scriptEvents(
      { ...collisionEvent(adapter), colliderB: foreignCollider },
      {
        type: "triggerexit",
        sensor: foreignCollider,
        sensorBody: foreignBody,
        other: colliderHandle(adapter, 1),
        otherBody: bodyHandle(adapter, 1),
      },
    );
    world.step(1 / 60);

    expect(world.queuedEvents).toHaveLength(0);
    expect(world.getBody(first)).toBeDefined();
  });

  it("has synced every body before the first callback runs (§39)", async () => {
    const { adapter, world } = await readyWorld({
      gravity: new Vector2(0, -10),
    });
    const first = dynamicNode({ density: 1 });
    const second = dynamicNode({ density: 1 });
    world.addBody(first);
    world.addBody(second);

    let observed = Number.NaN;
    world.getBody(first)?.on("collisionstart", () => {
      observed = second.transform.position.y;
    });

    adapter.scriptEvents(collisionEvent(adapter));
    world.step(0.5);
    const settled = second.transform.position.y;
    world.dispatchEvents();

    expect(settled).toBeCloseTo(-2.5);
    expect(observed).toBe(settled);
  });

  it("survives a listener that mutates the world mid-dispatch", async () => {
    const { adapter, world, first, second } = await twoBodyWorld();
    const seen: string[] = [];
    world.getBody(first)?.on("collisionstart", () => {
      seen.push("A");
      world.removeBody(second);
      world.addBody(dynamicNode());
    });
    world.getBody(second)?.on("collisionstart", () => seen.push("B"));

    adapter.scriptEvents(collisionEvent(adapter), {
      type: "wake",
      body: bodyHandle(adapter, 1),
    });
    world.step(1 / 60);
    world.dispatchEvents();

    expect(seen).toEqual(["A", "B"]);
    expect(world.size).toBe(2);
  });

  it("dispatching an empty queue is a no-op", async () => {
    const { world } = await readyWorld();
    world.dispatchEvents();
    expect(world.queuedEvents).toHaveLength(0);
  });
});

describe("PhysicsWorld §30 queries", () => {
  it("maps ray hits onto component references", async () => {
    const { adapter, world } = await readyWorld();
    const node = dynamicNode();
    const body = world.addBody(node);
    const point = new Vector3(1, 0, 0);
    const normal = new Vector3(0, 1, 0);
    adapter.raycastHits = [
      {
        collider: colliderHandle(adapter, 1),
        body: bodyHandle(adapter, 1),
        point,
        normal,
        distance: 2,
      },
    ];

    const hits = world.raycast({
      origin: new Vector2(0, 0),
      direction: new Vector2(1, 0),
    });

    expect(hits).toHaveLength(1);
    expect(hits[0].body).toBe(body);
    expect(hits[0].collider).toBe(node.getComponent(Collider));
    expect(hits[0].point).toBe(point);
    expect(hits[0].distance).toBe(2);
  });

  it("maps shape-cast and point hits, and drops unregistered colliders", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(dynamicNode());
    const foreignBody = adapter.createBody({ type: "static" });
    const foreign = adapter.createCollider({
      shape: { type: "circle", radius: 1 },
      body: foreignBody,
    });

    adapter.shapeCastHits = [
      {
        collider: colliderHandle(adapter, 1),
        body: bodyHandle(adapter, 1),
        point: new Vector3(),
        normal: new Vector3(),
        distance: 1,
      },
      {
        collider: foreign,
        body: foreignBody,
        point: new Vector3(),
        normal: new Vector3(),
        distance: 2,
      },
    ];
    adapter.pointHits = [
      {
        collider: foreign,
        body: foreignBody,
        point: new Vector3(),
        distance: 0,
      },
    ];

    expect(
      world.shapeCast({
        shape: { type: "circle", radius: 1 },
        position: new Vector2(0, 0),
        direction: new Vector2(1, 0),
      }),
    ).toHaveLength(1);
    expect(world.pointQuery(new Vector2(0, 0))).toHaveLength(0);
  });

  it("maps overlap and point hits onto component references", async () => {
    const { adapter, world } = await readyWorld();
    const node = dynamicNode();
    const body = world.addBody(node);
    const collider = node.getComponent(Collider);
    const hit = {
      collider: colliderHandle(adapter, 1),
      body: bodyHandle(adapter, 1),
    };
    adapter.overlapHits = [hit];
    adapter.pointHits = [{ ...hit, point: new Vector3(1, 2, 0), distance: 0 }];

    const overlaps = world.overlapSphere(new Vector2(0, 0), 3);
    const points = world.pointQuery(new Vector2(1, 2));

    expect(overlaps).toEqual([{ collider, body }]);
    expect(points).toHaveLength(1);
    expect(points[0].body).toBe(body);
    expect(points[0].collider).toBe(collider);
    expect(points[0].point).toEqual(new Vector3(1, 2, 0));
    expect(points[0].distance).toBe(0);
  });

  it("uses §21's planar shapes in a 2D world", async () => {
    const { adapter, world } = await readyWorld();
    world.overlapSphere(new Vector2(0, 0), 2);
    world.overlapBox(new Vector2(0, 0), new Vector2(1, 2), Math.PI / 2, {
      includeSensors: true,
    });

    const calls = adapter.callsOf("overlap");
    const first = calls[0].args[0] as { shape: { type: string } };
    const second = calls[1].args[0] as {
      shape: { type: string; halfExtents: Vector2 };
      rotation: number;
      includeSensors: boolean;
    };
    expect(first.shape.type).toBe("circle");
    expect(second.shape.type).toBe("rectangle");
    expect(second.shape.halfExtents).toEqual(new Vector2(1, 2));
    expect(second.rotation).toBe(Math.PI / 2);
    expect(second.includeSensors).toBe(true);
  });

  it("uses §21's volumetric shapes in a 3D world", async () => {
    const adapter = new FakeSolverAdapter();
    const world = new PhysicsWorld({ dimension: "3d", adapter });
    await world.initialize();

    world.overlapSphere(new Vector3(0, 0, 0), 1);
    world.overlapBox(new Vector3(0, 0, 0), new Vector3(1, 2, 3));

    const calls = adapter.callsOf("overlap");
    expect((calls[0].args[0] as { shape: { type: string } }).shape.type).toBe(
      "sphere",
    );
    const box = calls[1].args[0] as {
      shape: { type: string; halfExtents: Vector3 };
      rotation?: unknown;
    };
    expect(box.shape.type).toBe("box");
    expect(box.shape.halfExtents).toEqual(new Vector3(1, 2, 3));
    expect(box.rotation).toBeUndefined();
  });

  it("widens a Vector2 half-extent in a 3D world", async () => {
    const adapter = new FakeSolverAdapter();
    const world = new PhysicsWorld({ dimension: "3d", adapter });
    await world.initialize();

    world.overlapBox(new Vector3(0, 0, 0), new Vector2(1, 2));

    const box = adapter.callsOf("overlap")[0].args[0] as {
      shape: { halfExtents: Vector3 };
    };
    expect(box.shape.halfExtents.z).toBe(0);
  });

  it("refuses a query the adapter does not implement (§30, §37)", async () => {
    const adapter = new FakeSolverAdapter({
      capabilities: {
        queries: {
          raycast: false,
          shapeCast: false,
          overlap: false,
          point: false,
        },
      },
    });
    const { world } = await readyWorld({ adapter });

    expect(
      expectFourError(() =>
        world.raycast({
          origin: new Vector2(0, 0),
          direction: new Vector2(1, 0),
        }),
      ).code,
    ).toBe("NOT_IMPLEMENTED");
    expect(
      expectFourError(() => world.overlapSphere(new Vector2(0, 0), 1)).code,
    ).toBe("NOT_IMPLEMENTED");
    expect(
      expectFourError(() => world.pointQuery(new Vector2(0, 0))).code,
    ).toBe("NOT_IMPLEMENTED");
    expect(
      expectFourError(() =>
        world.shapeCast({
          shape: { type: "circle", radius: 1 },
          position: new Vector2(0, 0),
          direction: new Vector2(1, 0),
        }),
      ).code,
    ).toBe("NOT_IMPLEMENTED");
  });
});

describe("PhysicsWorld §33 checksum", () => {
  it("hashes an empty world to the FNV-1a offset basis", async () => {
    const { world } = await readyWorld();
    expect(world.checksum()).toBe(2166136261);
  });

  it("matches §33's definition float for float", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(dynamicNode({ density: 1 }));
    world.step(0.25);

    const body = adapter.body(1);
    const expected = referenceChecksum([
      body.position.x,
      body.position.y,
      body.position.z,
      body.rotation.x,
      body.rotation.y,
      body.rotation.z,
      body.rotation.w,
      body.linearVelocity.x,
      body.linearVelocity.y,
      body.linearVelocity.z,
      body.angularVelocity.x,
      body.angularVelocity.y,
      body.angularVelocity.z,
    ]);
    expect(world.checksum()).toBe(expected);
  });

  it("is identical for two identical scripted runs", async () => {
    const digest = async (): Promise<number[]> => {
      const { world } = await readyWorld({ gravity: new Vector2(0, -9.81) });
      const body = world.addBody(dynamicNode({ density: 2 }));
      const digests: number[] = [];
      for (let i = 0; i < 20; i += 1) {
        if (i === 5) {
          body.applyImpulse(new Vector2(1, 3));
        }
        world.step(1 / 60);
        digests.push(world.checksum());
      }
      return digests;
    };

    expect(await digest()).toEqual(await digest());
  });

  it("changes as the world moves", async () => {
    const { world } = await readyWorld();
    world.addBody(dynamicNode({ density: 1 }));
    const before = world.checksum();
    world.step(1 / 60);
    expect(world.checksum()).not.toBe(before);
  });

  it("orders by ascending body id, not by registration churn (§37)", async () => {
    const { world } = await readyWorld();
    const first = dynamicNode({ density: 1 });
    const second = dynamicNode({ density: 1 });
    world.addBody(first);
    world.addBody(second);
    world.step(1 / 60);
    const withBoth = world.checksum();

    world.removeBody(first);
    const afterRemoval = world.checksum();
    world.addBody(dynamicNode({ density: 1 }));
    const afterRecreate = world.checksum();

    expect(afterRemoval).not.toBe(withBoth);
    // The new body has the highest id, so it is hashed last: removing and
    // re-adding cannot permute the surviving body's position in the sequence.
    expect(afterRecreate).not.toBe(afterRemoval);
    expect(afterRecreate).not.toBe(withBoth);
  });

  it("rejects a non-finite body state (§33)", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(dynamicNode());
    adapter.body(1).position.set(Number.POSITIVE_INFINITY, 0, 0);
    expect(() => world.checksum()).toThrow(RangeError);
  });

  it("rejects a state outside the 53-bit-safe quantized range (§41)", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(dynamicNode());
    adapter.body(1).position.set(1e12, 0, 0);
    expect(() => world.checksum()).toThrow(/53-bit-safe/);
  });

  it("normalizes negative zero (§33, D6)", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(dynamicNode());
    const positive = world.checksum();
    adapter.body(1).position.set(-0, -0, -0);
    expect(world.checksum()).toBe(positive);
  });
});

describe("PhysicsWorld §34 snapshots", () => {
  it("wraps the adapter's bytes in a validity key", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(dynamicNode({ density: 1 }));

    const snapshot = world.createSnapshot();

    expect(snapshot.adapterName).toBe(adapter.name);
    expect(snapshot.adapterVersion).toBe(adapter.version);
    expect(snapshot.data.byteLength).toBeGreaterThan(0);
  });

  it("round-trips the solver state, and the world's maps survive", async () => {
    const { world } = await readyWorld({ gravity: new Vector2(0, -10) });
    const node = dynamicNode({ density: 1 });
    const body = world.addBody(node);
    world.step(0.5);

    const snapshot = world.createSnapshot();
    const captured = world.checksum();

    world.step(0.5);
    expect(world.checksum()).not.toBe(captured);

    world.restoreSnapshot(snapshot);
    expect(world.checksum()).toBe(captured);

    world.step(0.5);
    expect(world.getBody(node)).toBe(body);
    expect(node.transform.position.y).toBeCloseTo(-7.5);
  });

  it("refuses a snapshot from another adapter (§34)", async () => {
    const { world } = await readyWorld();
    const snapshot = world.createSnapshot();

    const error = expectFourError(() =>
      world.restoreSnapshot({ ...snapshot, adapterName: "rapier2d" }),
    );
    expect(error.message).toContain("opaque adapter data");
  });

  it("refuses a snapshot from another adapter version (§34)", async () => {
    const { world } = await readyWorld();
    const snapshot = world.createSnapshot();

    const error = expectFourError(() =>
      world.restoreSnapshot({ ...snapshot, adapterVersion: "0.0.1" }),
    );
    expect(error.message).toContain("version");
  });

  it("records the world configuration in the envelope (§34, 2026-08-04)", async () => {
    const { world } = await readyWorld({ gravity: new Vector2(0, -10) });
    const snapshot = world.createSnapshot();

    expect(snapshot.configuration).toEqual({
      dimension: "2d",
      gravity: [0, -10, 0],
      sleeping: {
        enabled: true,
        linearThreshold: DEFAULT_SLEEPING_CONFIG.linearThreshold,
        angularThreshold: DEFAULT_SLEEPING_CONFIG.angularThreshold,
        timeThreshold: DEFAULT_SLEEPING_CONFIG.timeThreshold,
      },
      determinism: "same-runtime",
    });
    // The solver-iterations key is present only when the world set it.
    expect("solverIterations" in (snapshot.configuration ?? {})).toBe(false);

    const tuned = await readyWorld({ solverIterations: 2 });
    const tunedSnapshot = tuned.world.createSnapshot();
    expect(tunedSnapshot.configuration?.solverIterations).toBe(2);
    // Matching configuration round-trips: same world, same rules.
    expect(() => {
      tuned.world.restoreSnapshot(tunedSnapshot);
    }).not.toThrow();
  });

  it("refuses a snapshot captured under a different configuration (§34)", async () => {
    const { world } = await readyWorld({ gravity: new Vector2(0, -10) });
    const snapshot = world.createSnapshot();
    const configuration = snapshot.configuration;
    if (configuration === undefined) {
      throw new Error("expected a configuration in the envelope");
    }

    const gravityError = expectFourError(() =>
      world.restoreSnapshot({
        ...snapshot,
        configuration: { ...configuration, gravity: [0, -9.81, 0] },
      }),
    );
    expect(gravityError.message).toContain("gravity");
    expect(gravityError.message).toContain("not a continuation");

    const iterationsError = expectFourError(() =>
      world.restoreSnapshot({
        ...snapshot,
        configuration: { ...configuration, solverIterations: 8 },
      }),
    );
    expect(iterationsError.message).toContain("solverIterations");

    const sleepingError = expectFourError(() =>
      world.restoreSnapshot({
        ...snapshot,
        configuration: {
          ...configuration,
          sleeping: { ...configuration.sleeping, timeThreshold: 99 },
        },
      }),
    );
    expect(sleepingError.message).toContain("sleeping");

    const dimensionError = expectFourError(() =>
      world.restoreSnapshot({
        ...snapshot,
        configuration: { ...configuration, dimension: "3d" },
      }),
    );
    expect(dimensionError.message).toContain("dimension");

    const determinismError = expectFourError(() =>
      world.restoreSnapshot({
        ...snapshot,
        configuration: { ...configuration, determinism: "none" },
      }),
    );
    expect(determinismError.message).toContain("determinism");
  });

  it("tolerates a configuration-less snapshot: the pre-2026-08-04 envelope and the §34 replay document carry none", async () => {
    const { world } = await readyWorld();
    world.step(0.5);
    const snapshot = world.createSnapshot();
    const captured = world.checksum();
    world.step(0.5);

    const bare = {
      adapterName: snapshot.adapterName,
      adapterVersion: snapshot.adapterVersion,
      data: snapshot.data,
    };
    expect(() => world.restoreSnapshot(bare)).not.toThrow();
    expect(world.checksum()).toBe(captured);
  });

  it("refuses both calls when the adapter declares no snapshots (§37)", async () => {
    const adapter = new FakeSolverAdapter({
      capabilities: { snapshots: false },
    });
    const { world } = await readyWorld({ adapter });

    expect(expectFourError(() => world.createSnapshot()).code).toBe(
      "NOT_IMPLEMENTED",
    );
    expect(
      expectFourError(() =>
        world.restoreSnapshot({
          adapterName: adapter.name,
          adapterVersion: adapter.version,
          data: new ArrayBuffer(0),
        }),
      ).code,
    ).toBe("NOT_IMPLEMENTED");
  });
});

describe("PhysicsWorld disposal (§83)", () => {
  it("destroys registrations in reverse creation order and disposes the adapter", async () => {
    const { adapter, world } = await readyWorld();
    const first = dynamicNode();
    const second = dynamicNode();
    const extra = new Group();
    extra.addComponent(new Collider({ shape: { type: "circle", radius: 1 } }));
    second.add(extra);
    world.addBody(first);
    world.addBody(second);
    adapter.clearCalls();

    world.dispose();

    // Reverse creation order, one `destroyBody` per registration (2026-08-07 —
    // the per-collider calls that used to bracket each body are gone; §37 makes
    // the adapter responsible for what is attached to a destroyed body).
    expect(
      adapter.calls.map((call) => `${call.method}:${String(call.id ?? "")}`),
    ).toEqual(["destroyBody:2", "destroyBody:1", "dispose:"]);
    // Both bodies took their colliders with them.
    expect(adapter.colliders.size).toBe(0);
    expect(adapter.disposed).toBe(true);
    expect(world.disposed).toBe(true);
  });

  it("is idempotent and terminal", async () => {
    const { adapter, world } = await readyWorld();
    world.dispose();
    world.dispose();

    expect(adapter.callsOf("dispose")).toHaveLength(1);
    expect(expectFourError(() => world.step(1 / 60)).message).toContain(
      "disposed",
    );
    expect(
      expectFourError(() => world.addBody(dynamicNode())).message,
    ).toContain("disposed");
    await expect(world.initialize()).rejects.toThrow("disposed");
  });
});

describe("PhysicsWorld solver handles (§20, §37; 2026-08-06)", () => {
  it("hands out the body and collider handles it registered", async () => {
    const { adapter, world } = await readyWorld();
    const node = dynamicNode({ density: 2 });
    world.addBody(node);

    expect(world.getBodyHandle(node)).toBe(bodyHandle(adapter, 1));
    const collider = node.getComponent(Collider);
    expect(collider).toBeDefined();
    expect(world.getColliderHandle(collider as Collider)).toBe(
      colliderHandle(adapter, 1),
    );
  });

  it("knows nothing about what it does not hold", async () => {
    const { world } = await readyWorld();
    const registered = dynamicNode();
    world.addBody(registered);
    const stranger = dynamicNode();

    expect(world.getBodyHandle(stranger)).toBeUndefined();
    expect(
      world.getColliderHandle(stranger.getComponent(Collider) as Collider),
    ).toBeUndefined();

    // …and a handle is only valid while the body is registered here.
    const collider = registered.getComponent(Collider) as Collider;
    world.removeBody(registered);
    expect(world.getBodyHandle(registered)).toBeUndefined();
    expect(world.getColliderHandle(collider)).toBeUndefined();
  });

  it("releases collider handles on dispose too", async () => {
    const { world } = await readyWorld();
    const node = dynamicNode();
    world.addBody(node);
    const collider = node.getComponent(Collider) as Collider;

    world.dispose();
    expect(world.getColliderHandle(collider)).toBeUndefined();
  });
});

describe("PhysicsWorld registration mirrors (§23, §37; 2026-08-06)", () => {
  it("marks a body registered and unregistered again", async () => {
    const { world } = await readyWorld();
    const node = dynamicNode();
    const body = world.addBody(node);
    expect(body.registeredWorldCount).toBe(1);

    world.removeBody(node);
    expect(body.registeredWorldCount).toBe(0);

    world.addBody(node);
    expect(body.registeredWorldCount).toBe(1);
    world.dispose();
    expect(body.registeredWorldCount).toBe(0);
  });

  it("does not launder the solver's derived mass into an authored one", async () => {
    // The regression: the mass refresh went through `RigidBody.mass`, so
    // `toDescriptor()` re-emitted the solver's own derivation as an authored
    // instruction and a re-registered body froze its mass.
    const { world } = await readyWorld();
    const node = dynamicNode({ density: 4 });
    const body = world.addBody(node);

    expect(body.mass).toBe(4);
    expect(body.derivedMass).toBe(4);
    expect(body.massAuthored).toBe(false);
    expect("mass" in body.toDescriptor()).toBe(false);

    // Re-registering with a denser collider derives a new mass rather than
    // re-imposing the old one.
    world.removeBody(node);
    const collider = node.getComponent(Collider) as Collider;
    collider.density = 9;
    world.addBody(node);
    expect(body.mass).toBe(9);
    expect(body.massAuthored).toBe(false);
  });

  it("keeps an authored mass authored across registration", async () => {
    const { world } = await readyWorld();
    const node = dynamicNode({ mass: 3, density: 4 });
    const body = world.addBody(node);

    expect(body.massAuthored).toBe(true);
    expect(body.toDescriptor().mass).toBe(3);
  });

  it("re-types a registered body without the drift warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { world } = await readyWorld();
    const node = dynamicNode({ density: 2 });
    const body = world.addBody(node);

    world.setBodyControlMode(node, "kinematic-position");
    expect(body.type).toBe("kinematic-position");
    expect(warn).not.toHaveBeenCalled();

    // Assigning the component directly is the case that does warn.
    body.type = "dynamic";
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("setBodyControlMode");
    warn.mockRestore();
  });
});

describe("PhysicsWorld accepted-and-ignored tunables (§25, §32, §37)", () => {
  /** A material carrying §25 coefficients no shipped solver applies. */
  function rollingNode(options: {
    rolling?: number;
    spinning?: number;
  }): Group {
    const node = new Group();
    node.addComponent(new RigidBody({ type: "dynamic" }));
    node.addComponent(
      new Collider({
        shape: { type: "circle", radius: 0.5 },
        material: new PhysicsMaterial({
          ...(options.rolling === undefined
            ? {}
            : { rollingFriction: options.rolling }),
          ...(options.spinning === undefined
            ? {}
            : { spinningFriction: options.spinning }),
        }),
      }),
    );
    return node;
  }

  it("warns once per world for a §25 coefficient the adapter cannot apply", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { world } = await readyWorld();

    world.addBody(rollingNode({ rolling: 0.1 }));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("rollingFriction");

    // A second body with the same mistake is the same mistake.
    world.addBody(rollingNode({ rolling: 0.2 }));
    expect(warn).toHaveBeenCalledTimes(1);

    // The other coefficient is a separate declaration and a separate warning.
    world.addBody(rollingNode({ spinning: 0.3 }));
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1][0]).toContain("spinningFriction");
    warn.mockRestore();
  });

  it("says nothing when the material carries neither, or the adapter applies both", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const plain = await readyWorld();
    plain.world.addBody(dynamicNode());
    plain.world.addBody(rollingNode({}));
    expect(warn).not.toHaveBeenCalled();

    const capable = await readyWorld({
      adapter: new FakeSolverAdapter({
        capabilities: {
          tuning: {
            rollingFriction: true,
            spinningFriction: true,
            sleepThresholds: true,
            jointMotorEffortCap: true,
          },
        },
      }),
    });
    capable.world.addBody(rollingNode({ rolling: 0.1, spinning: 0.2 }));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns once for §32 thresholds the adapter cannot apply", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    makeWorld({ sleeping: { linearThreshold: 0.5 } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("sleeping.linearThreshold");

    // Each world answers for itself; the suppression is per world.
    makeWorld({ sleeping: { angularThreshold: 0.5, timeThreshold: 2 } });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1][0]).toContain("sleeping.angularThreshold");
    expect(warn.mock.calls[1][0]).toContain("sleeping.timeThreshold");
    warn.mockRestore();
  });

  it("leaves Appendix A's defaults, and `enabled`, unremarked", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    // `enabled` is honoured by every adapter here, and the defaults ask for
    // nothing the solver is not already doing.
    makeWorld({ sleeping: { enabled: false } });
    makeWorld({ sleeping: { ...DEFAULT_SLEEPING_CONFIG } });
    makeWorld();
    expect(warn).not.toHaveBeenCalled();

    // An adapter that declares the thresholds gets no warning either.
    makeWorld({
      sleeping: { timeThreshold: 4 },
      adapter: new FakeSolverAdapter({
        capabilities: {
          tuning: {
            rollingFriction: false,
            spinningFriction: false,
            sleepThresholds: true,
            jointMotorEffortCap: false,
          },
        },
      }),
    });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("§23 a dynamic body with no way to derive inertia", () => {
  /** A dynamic body carrying no collider and no explicit inertia tensor. */
  function inertialessNode(): Group {
    const node = new Group();
    node.transformAuthority = "physics";
    node.addComponent(new RigidBody({ type: "dynamic", mass: 1 }));
    return node;
  }

  it("warns once at the first step, naming what is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { world } = await readyWorld();
      world.addBody(inertialessNode());

      // Nothing at registration: PH-5 allows a collider to arrive later, so the body is
      // not yet wrong here.
      expect(warn).not.toHaveBeenCalled();

      world.step(1 / 60);
      world.step(1 / 60);

      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.mock.calls[0]?.join(" ") ?? "";
      expect(message).toContain("collider");
      expect(message).toMatch(/rotate/i);
    } finally {
      warn.mockRestore();
    }
  });

  it("says nothing when a collider supplies the inertia", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { world } = await readyWorld();
      world.addBody(dynamicNode());
      world.step(1 / 60);

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("says nothing when PH-5 adds the collider after registration", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { world } = await readyWorld();
      const node = inertialessNode();
      world.addBody(node);

      // The supported late-collider workflow. This is why the check cannot live in
      // `addBody`: at that moment this body looks exactly like the broken one above.
      const late = new Collider({
        shape: { type: "circle", radius: 0.5 },
        density: 1,
      });
      const child = new Group();
      child.addComponent(late);
      node.add(child);
      world.addCollider(late);

      world.step(1 / 60);

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("says nothing when an explicit inertiaTensor is supplied", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { world } = await readyWorld();
      const node = new Group();
      node.transformAuthority = "physics";
      node.addComponent(
        new RigidBody({
          type: "dynamic",
          mass: 1,
          inertiaTensor: new Matrix3(),
        }),
      );
      world.addBody(node);
      world.step(1 / 60);

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});


describe("event interest (2026-09-11): the adapter is told when nobody listens for collisionstay", () => {
  it("forwards the interest only on change, from the registered bodies' listener counts", async () => {
    const { adapter, world } = await readyWorld();
    const calls: { collisionstay: boolean }[] = [];
    (adapter as { setEventInterest?: (i: { collisionstay: boolean }) => void }).setEventInterest =
      (interest) => calls.push({ ...interest });
    const node = dynamicNode();
    world.addBody(node);
    const body = node.getComponent(RigidBody);
    if (body === null) throw new Error("body");

    world.step(1 / 60);
    world.step(1 / 60);
    expect(calls).toEqual([{ collisionstay: false }]);

    const off = body.on("collisionstay", () => {});
    world.step(1 / 60);
    world.step(1 / 60);
    expect(calls).toEqual([{ collisionstay: false }, { collisionstay: true }]);

    off();
    world.step(1 / 60);
    expect(calls).toEqual([
      { collisionstay: false },
      { collisionstay: true },
      { collisionstay: false },
    ]);
    world.dispose();
  });

  it("issues no call at all to an adapter without the member", async () => {
    const { adapter, world } = await readyWorld();
    expect("setEventInterest" in adapter).toBe(false);
    world.addBody(dynamicNode());
    expect(() => world.step(1 / 60)).not.toThrow();
    world.dispose();
  });
});
