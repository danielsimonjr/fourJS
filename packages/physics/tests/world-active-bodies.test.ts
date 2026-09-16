/**
 * `PhysicsWorld.forEachActiveBody` (PH-8, 2026-08-09) — the §22/§32 filter and
 * the §25 sample point a §39 step-5 force generator walks.
 *
 * The method exists so that "the bodies a per-step force can actually move" is
 * answered once, in the world, rather than re-derived by every generator. That
 * makes three things worth pinning here rather than in `ForceFieldSystem`'s own
 * file: the filter (§22 dynamic, §32 awake), the ordering guarantee (§33
 * registration order), and the shared-vector contract on the centre of mass.
 */

import {
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@fourjs/math";
import { Group, type Node } from "@fourjs/scene";
import { describe, expect, it } from "vitest";

import type { RigidBody as RigidBodyComponent } from "../src/index.js";
import { Collider, PhysicsWorld, RigidBody } from "../src/index.js";
import { FakeSolverAdapter } from "./fake-adapter.js";

/** A 2D world on a fresh fake adapter, already initialized. */
async function readyWorld(): Promise<{
  adapter: FakeSolverAdapter;
  world: PhysicsWorld;
}> {
  const adapter = new FakeSolverAdapter();
  const world = new PhysicsWorld({ dimension: "2d", adapter });
  await world.initialize();
  return { adapter, world };
}

/** A node carrying a body of `type` and one circle collider. */
function bodyNode(
  type: "dynamic" | "static" | "kinematic-position" | "kinematic-velocity",
): Group {
  const node = new Group();
  node.transformAuthority = "physics";
  node.addComponent(new RigidBody({ type }));
  node.addComponent(new Collider({ shape: { type: "circle", radius: 0.5 } }));
  return node;
}

/** Every visited body, in visit order. */
function visited(world: PhysicsWorld): RigidBodyComponent[] {
  const seen: RigidBodyComponent[] = [];
  world.forEachActiveBody((body) => {
    seen.push(body);
  });
  return seen;
}

describe("PhysicsWorld.forEachActiveBody (§22, §32, §33)", () => {
  it("visits nothing in an empty world", async () => {
    const { world } = await readyWorld();
    expect(visited(world)).toEqual([]);
  });

  it("visits only dynamic bodies (§22)", async () => {
    const { world } = await readyWorld();
    const dynamic = bodyNode("dynamic");
    world.addBody(bodyNode("static"));
    world.addBody(dynamic);
    world.addBody(bodyNode("kinematic-position"));
    world.addBody(bodyNode("kinematic-velocity"));

    expect(visited(world)).toEqual([dynamic.getComponent(RigidBody)]);
  });

  it("skips a sleeping body (§32)", async () => {
    const { adapter, world } = await readyWorld();
    const awake = bodyNode("dynamic");
    const asleep = bodyNode("dynamic");
    world.addBody(awake);
    world.addBody(asleep);

    adapter.body(2).sleeping = true;
    world.step(1 / 60); // publishes §32 state onto the components

    expect(visited(world)).toEqual([awake.getComponent(RigidBody)]);
  });

  it("visits in registration order, and follows removal (§33)", async () => {
    const { world } = await readyWorld();
    const first = bodyNode("dynamic");
    const second = bodyNode("dynamic");
    const third = bodyNode("dynamic");
    for (const node of [first, second, third]) {
      world.addBody(node);
    }
    expect(visited(world)).toEqual([
      first.getComponent(RigidBody),
      second.getComponent(RigidBody),
      third.getComponent(RigidBody),
    ]);

    world.removeBody(second);
    expect(visited(world)).toEqual([
      first.getComponent(RigidBody),
      third.getComponent(RigidBody),
    ]);

    // A re-added body is appended, never re-inserted where it used to be.
    world.addBody(second);
    expect(visited(world)).toEqual([
      first.getComponent(RigidBody),
      third.getComponent(RigidBody),
      second.getComponent(RigidBody),
    ]);
  });

  it("hands over the node and the solver's world-space centre of mass (§25)", async () => {
    const { adapter, world } = await readyWorld();
    const node = bodyNode("dynamic");
    world.addBody(node);
    adapter.body(1).position.set(1.5, -2.5, 0);

    const seen: { node: Node; point: Vector3 }[] = [];
    world.forEachActiveBody((_body, visitedNode, centerOfMass) => {
      seen.push({ node: visitedNode, point: centerOfMass.clone() });
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].node).toBe(node);
    expect(seen[0].point.x).toBe(1.5);
    expect(seen[0].point.y).toBe(-2.5);
    // Read from the solver, not re-derived from the transform.
    expect(
      adapter.calls.some((call) => call.method === "getBodyCenterOfMass"),
    ).toBe(true);
  });

  it("hands the same vector to every visit, and allocates nothing (§7b)", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(bodyNode("dynamic"));
    world.addBody(bodyNode("dynamic"));
    adapter.body(1).position.set(1, 0, 0);
    adapter.body(2).position.set(2, 0, 0);

    const vectors: Vector3[] = [];
    const xs: number[] = [];
    world.forEachActiveBody((_body, _node, centerOfMass) => {
      vectors.push(centerOfMass);
      xs.push(centerOfMass.x);
    });

    // One shared, overwritten vector: the values must be read inside the
    // callback, which is why the documentation says to copy it.
    expect(vectors[0]).toBe(vectors[1]);
    expect(xs).toEqual([1, 2]);

    resetConstructionCount();
    world.forEachActiveBody(() => undefined);
    expect(constructionCount()).toBe(0);
  });

  it("lets its visitor apply §26 forces, which the next step drains", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(bodyNode("dynamic"));

    world.forEachActiveBody((body) => {
      body.applyForce(new Vector3(0, 3, 0));
    });
    world.step(1 / 60);

    expect(adapter.body(1).force.y).toBe(3);
  });
});

describe("PhysicsWorld.forEachSleepingDynamicBody (§32)", () => {
  it("visits only sleeping dynamics, in registration order", async () => {
    const { adapter, world } = await readyWorld();
    const first = bodyNode("dynamic");
    const second = bodyNode("dynamic");
    const third = bodyNode("dynamic");
    world.addBody(first);
    world.addBody(bodyNode("static"));
    world.addBody(second);
    world.addBody(third);
    adapter.body(1).sleeping = true;
    adapter.body(3).sleeping = true;
    world.step(1 / 60);

    const seen: RigidBodyComponent[] = [];
    world.forEachSleepingDynamicBody((body) => {
      seen.push(body);
    });
    expect(seen).toEqual([
      first.getComponent(RigidBody),
      second.getComponent(RigidBody),
    ]);
  });

  it("visits nothing when every dynamic is awake", async () => {
    const { world } = await readyWorld();
    world.addBody(bodyNode("dynamic"));
    const seen: RigidBodyComponent[] = [];
    world.forEachSleepingDynamicBody((body) => {
      seen.push(body);
    });
    expect(seen).toEqual([]);
  });
});
