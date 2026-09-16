/**
 * §26/§27 force fields for rigid bodies (PH-8, 2026-08-09) — `ForceFieldSystem`
 * and the `PhysicsWorld.forEachActiveBody` seam it walks.
 *
 * What this file has to establish, beyond "a force arrives":
 *
 * 1. **The units mean what they say (§41).** A `"force"` field's newtons reach
 *    the solver unscaled; an `"acceleration"` field's m/s² are multiplied by the
 *    body's mass, so two bodies of different mass under one gravity-like field
 *    accelerate identically and under one wind-like field do not. Both are
 *    checked against the fake solver's own accumulated force, which is the
 *    number the integrator actually uses.
 * 2. **The §39 wiring is the specified one.** The system's default priority is
 *    `PRIORITY_FORCES`, and a registry containing it and a `PhysicsSystem` runs
 *    them in step-5-then-step-6 order — so a field applied this step is drained
 *    by this step's solve, not the next one.
 * 3. **The filters are §22's and §32's**, and they are the world's: static and
 *    kinematic bodies are never visited, and a sleeping body is never woken by
 *    ambient wind.
 * 4. **Determinism (§33)**: bodies in registration order, fields in
 *    registration order, one sum per body, nothing allocated per step, and
 *    `time` taken from the injected `TimeState` rather than a clock.
 * 5. **Nothing is accepted and ignored**: a massless body's acceleration
 *    contribution is dropped *and reported*, never turned into a `NaN` force.
 */

import {
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@fourjs/math";
import { Group } from "@fourjs/scene";
import {
  PRIORITY_FORCES,
  SystemRegistry,
  createTimeState,
  type FixedUpdateContext,
} from "@fourjs/motion";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ForceField } from "../src/index.js";
import {
  Collider,
  ForceFieldSystem,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
} from "../src/index.js";
import { FakeSolverAdapter } from "./fake-adapter.js";

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

/** A node carrying a body of `type`, optionally with a collider and a mass. */
function bodyNode(options: {
  type?: "dynamic" | "static" | "kinematic-position";
  mass?: number;
  collider?: boolean;
  position?: readonly [number, number, number];
}): Group {
  const node = new Group();
  node.transformAuthority = "physics";
  const type = options.type ?? "dynamic";
  node.addComponent(
    new RigidBody(
      options.mass === undefined ? { type } : { type, mass: options.mass },
    ),
  );
  if (options.collider !== false) {
    node.addComponent(new Collider({ shape: { type: "circle", radius: 0.5 } }));
  }
  if (options.position !== undefined) {
    node.transform.position.set(
      options.position[0],
      options.position[1],
      options.position[2],
    );
  }
  return node;
}

/**
 * A field that answers a constant vector — the simplest thing that lets a test
 * read the applied force straight off the arithmetic.
 */
function constantField(x: number, y: number, z = 0): ForceField {
  return {
    sample(_position, _velocity, _time, out) {
      const target = out ?? new Vector3();
      return target.set(x, y, z);
    },
  };
}

/** A fixed-step context at simulation time `time` seconds. */
function contextAt(time: number): FixedUpdateContext {
  const state = createTimeState({ fixedDeltaTime: 1 / 60 });
  state.simulationTime = time;
  return { time: state };
}

/** The force the fake solver holds for the body with monotonic id `id`. */
function solverForce(adapter: FakeSolverAdapter, id: number): Vector3 {
  return adapter.body(id).force;
}

// ---------------------------------------------------------------------------
// Registration surface
// ---------------------------------------------------------------------------

describe("ForceFieldSystem registration (§39)", () => {
  it("defaults to §39 step 5 and runs before the solve at step 6", () => {
    const system = new ForceFieldSystem();
    expect(system.priority).toBe(PRIORITY_FORCES);
    expect(system.priority).toBeLessThan(new PhysicsSystem().priority);
  });

  it("takes an explicit priority, so a second generator can be ordered after it", () => {
    expect(
      new ForceFieldSystem({ priority: PRIORITY_FORCES + 10 }).priority,
    ).toBe(PRIORITY_FORCES + 10);
  });

  it("tracks worlds in order and never twice", async () => {
    const a = (await readyWorld()).world;
    const b = (await readyWorld()).world;
    const system = new ForceFieldSystem({ worlds: [a, b] });

    expect(system.worlds).toEqual([a, b]);
    expect(system.track(a)).toBe(a);
    expect(system.worlds).toEqual([a, b]);
    expect(system.tracks(b)).toBe(true);

    expect(system.untrack(a)).toBe(true);
    expect(system.worlds).toEqual([b]);
    expect(system.untrack(a)).toBe(false);
    expect(system.tracks(a)).toBe(false);
  });

  it("keeps fields in registration order, which is the summation order (§33)", () => {
    const first = constantField(1, 0);
    const second = constantField(0, 1);
    const system = new ForceFieldSystem({
      fields: [{ field: first, units: "force" }],
    });
    expect(system.addField(second, "acceleration")).toBe(second);

    expect(system.fields).toEqual([
      { field: first, units: "force", wakesSleepingBodies: false },
      { field: second, units: "acceleration", wakesSleepingBodies: false },
    ]);
  });

  it("registers one field twice rather than deduplicating it", () => {
    const field = constantField(2, 0);
    const system = new ForceFieldSystem();
    system.addField(field, "force");
    system.addField(field, "force");
    expect(system.fields).toHaveLength(2);

    // Removing takes the first registration and leaves the second.
    expect(system.removeField(field)).toBe(true);
    expect(system.fields).toHaveLength(1);
    expect(system.removeField(field)).toBe(true);
    expect(system.removeField(field)).toBe(false);
  });

  it("forgets its worlds and fields on dispose, and disposes no world", async () => {
    const { world } = await readyWorld();
    const system = new ForceFieldSystem({
      worlds: [world],
      fields: [{ field: constantField(1, 0), units: "force" }],
    });
    system.initialize();
    system.dispose();

    expect(system.worlds).toEqual([]);
    expect(system.fields).toEqual([]);
    expect(world.disposed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

describe("ForceFieldSystem application (§26, §27)", () => {
  it("applies a `force` field in newtons, unscaled by mass", async () => {
    const { adapter, world } = await readyWorld();
    const light = bodyNode({ mass: 1 });
    const heavy = bodyNode({ mass: 7 });
    world.addBody(light);
    world.addBody(heavy);

    const system = new ForceFieldSystem({
      worlds: [world],
      fields: [{ field: constantField(3, -2), units: "force" }],
    });
    system.fixedUpdate(contextAt(0));
    world.step(1 / 60);

    // §26's command buffer reached the solver as written, for both masses.
    for (const id of [1, 2]) {
      expect(solverForce(adapter, id).x).toBe(3);
      expect(solverForce(adapter, id).y).toBe(-2);
    }
  });

  it("applies an `acceleration` field in m/s², scaled by each body's mass", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(bodyNode({ mass: 1 }));
    world.addBody(bodyNode({ mass: 7 }));

    const system = new ForceFieldSystem({
      worlds: [world],
      fields: [{ field: constantField(0, -9.81), units: "acceleration" }],
    });
    system.fixedUpdate(contextAt(0));
    world.step(1 / 60);

    // F = m·a, so the heavier body is pushed harder — which is exactly what
    // makes both of them accelerate at −9.81 m/s².
    expect(solverForce(adapter, 1).y).toBe(-9.81);
    expect(solverForce(adapter, 2).y).toBe(-9.81 * 7);
  });

  it("sums fields in registration order and applies one force per body", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(bodyNode({ mass: 2 }));

    const system = new ForceFieldSystem({ worlds: [world] });
    system.addField(constantField(1, 0), "force");
    system.addField(constantField(0, 5), "acceleration"); // ×2 kg
    system.addField(constantField(-0.25, 0), "force");
    system.fixedUpdate(contextAt(0));

    // Nothing has reached the solver yet: §26 buffers on the component and the
    // world drains it at the top of its next step.
    expect(
      adapter.calls.filter((call) => call.method === "applyForce"),
    ).toEqual([]);
    world.step(1 / 60);

    expect(solverForce(adapter, 1).x).toBe(0.75);
    expect(solverForce(adapter, 1).y).toBe(10);
    // One `applyForce` for the whole sum — three fields are not three commands.
    expect(
      adapter.calls.filter((call) => call.method === "applyForce"),
    ).toHaveLength(1);
  });

  it("samples at the solver's world-space centre of mass (§25)", async () => {
    const { adapter, world } = await readyWorld();
    const node = bodyNode({ mass: 1, position: [3, -4, 0] });
    world.addBody(node);
    adapter.body(1).position.set(3, -4, 0);

    const seen: Vector3[] = [];
    const probe: ForceField = {
      sample(position, _velocity, _time, out) {
        seen.push(position.clone());
        return (out ?? new Vector3()).set(0, 0, 0);
      },
    };
    new ForceFieldSystem({
      worlds: [world],
      fields: [{ field: probe, units: "force" }],
    }).fixedUpdate(contextAt(0));

    expect(seen).toHaveLength(1);
    expect(seen[0].x).toBe(3);
    expect(seen[0].y).toBe(-4);
  });

  it("hands a field the injected simulation time, never a clock (§33)", async () => {
    const { world } = await readyWorld();
    world.addBody(bodyNode({ mass: 1 }));

    const times: number[] = [];
    const probe: ForceField = {
      sample(_position, _velocity, time, out) {
        times.push(time);
        return (out ?? new Vector3()).set(0, 0, 0);
      },
    };
    const system = new ForceFieldSystem({
      worlds: [world],
      fields: [{ field: probe, units: "force" }],
    });
    system.fixedUpdate(contextAt(0.5));
    system.fixedUpdate(contextAt(1.25));

    expect(times).toEqual([0.5, 1.25]);
  });

  it("hands a field the body's start-of-step velocity, copied", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(bodyNode({ mass: 1 }));
    adapter.body(1).linearVelocity.set(2, -3, 0);
    world.step(1 / 60); // publishes the solver velocity onto the component

    const body = world.getBody(world.nodes.next().value as Group);
    const before = body?.linearVelocity.clone();

    // A misbehaving field that writes into the vector it was handed: §27 forbids
    // it, and the copy is what makes the prohibition advisory rather than
    // load-bearing on the component's mirror of solver state.
    const vandal: ForceField = {
      sample(_position, velocity, _time, out) {
        velocity.set(0, 0, 0);
        return (out ?? new Vector3()).set(0, 0, 0);
      },
    };
    new ForceFieldSystem({
      worlds: [world],
      fields: [{ field: vandal, units: "force" }],
    }).fixedUpdate(contextAt(0));

    expect(body?.linearVelocity.x).toBe(before?.x);
    expect(body?.linearVelocity.y).toBe(before?.y);
  });

  it("skips static and kinematic bodies (§22)", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(bodyNode({ type: "static" }));
    world.addBody(bodyNode({ type: "kinematic-position" }));
    world.addBody(bodyNode({ type: "dynamic", mass: 1 }));

    new ForceFieldSystem({
      worlds: [world],
      fields: [{ field: constantField(1, 0), units: "force" }],
    }).fixedUpdate(contextAt(0));
    world.step(1 / 60);

    expect(solverForce(adapter, 1).x).toBe(0);
    expect(solverForce(adapter, 2).x).toBe(0);
    expect(solverForce(adapter, 3).x).toBe(1);
  });

  it("never wakes a sleeping body (§32)", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(bodyNode({ mass: 1 }));
    adapter.body(1).sleeping = true;
    world.step(1 / 60); // refreshes RigidBody.sleeping from the solver

    new ForceFieldSystem({
      worlds: [world],
      fields: [{ field: constantField(0, -50), units: "force" }],
    }).fixedUpdate(contextAt(0));
    world.step(1 / 60);

    expect(solverForce(adapter, 1).y).toBe(0);
    expect(adapter.body(1).sleeping).toBe(true);
  });

  it("issues no solver call at all with no field or no world", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(bodyNode({ mass: 1 }));

    const fieldless = new ForceFieldSystem({ worlds: [world] });
    const worldless = new ForceFieldSystem({
      fields: [{ field: constantField(1, 0), units: "force" }],
    });
    const before = adapter.calls.length;
    fieldless.fixedUpdate(contextAt(0));
    worldless.fixedUpdate(contextAt(0));

    expect(adapter.calls.length).toBe(before);
  });

  it("queues nothing when the sum is exactly zero", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(bodyNode({ mass: 1 }));

    new ForceFieldSystem({
      worlds: [world],
      fields: [
        { field: constantField(4, 0), units: "force" },
        { field: constantField(-4, 0), units: "force" },
      ],
    }).fixedUpdate(contextAt(0));
    world.step(1 / 60);

    // A quiet field pair leaves the world's own zero-magnitude skip in charge,
    // so no `applyForce` reaches the solver and nothing can wake (§32).
    expect(
      adapter.calls.filter((call) => call.method === "applyForce"),
    ).toEqual([]);
  });

  it("visits worlds and bodies in registration order (§33)", async () => {
    const first = await readyWorld();
    const second = await readyWorld();
    const nodes = [
      bodyNode({ mass: 1, position: [0, 0, 0] }),
      bodyNode({ mass: 1, position: [1, 0, 0] }),
    ];
    first.world.addBody(nodes[0]);
    first.world.addBody(nodes[1]);
    const third = bodyNode({ mass: 1, position: [2, 0, 0] });
    second.world.addBody(third);
    for (const [id, x] of [
      [1, 0],
      [2, 1],
    ] as const) {
      first.adapter.body(id).position.set(x, 0, 0);
    }
    second.adapter.body(1).position.set(2, 0, 0);

    const order: number[] = [];
    const probe: ForceField = {
      sample(position, _velocity, _time, out) {
        order.push(position.x);
        return (out ?? new Vector3()).set(0, 0, 0);
      },
    };
    new ForceFieldSystem({
      worlds: [first.world, second.world],
      fields: [{ field: probe, units: "force" }],
    }).fixedUpdate(contextAt(0));

    expect(order).toEqual([0, 1, 2]);
  });

  it("allocates nothing per step (§7b)", async () => {
    const { world } = await readyWorld();
    world.addBody(bodyNode({ mass: 1 }));
    world.addBody(bodyNode({ mass: 3 }));
    const system = new ForceFieldSystem({
      worlds: [world],
      fields: [
        { field: constantField(1, 0), units: "force" },
        { field: constantField(0, -9.81), units: "acceleration" },
      ],
    });
    const context = contextAt(0);
    system.fixedUpdate(context); // warm any lazily-built scratch

    resetConstructionCount();
    for (let i = 0; i < 20; i += 1) {
      system.fixedUpdate(context);
    }
    expect(constructionCount()).toBe(0);
  });

  it("accepts a field that returns a vector other than `out` (§27)", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(bodyNode({ mass: 2 }));

    const owned = new Vector3(0, 6, 0);
    const ownScratch: ForceField = {
      sample() {
        return owned;
      },
    };
    new ForceFieldSystem({
      worlds: [world],
      fields: [{ field: ownScratch, units: "acceleration" }],
    }).fixedUpdate(contextAt(0));
    world.step(1 / 60);

    expect(solverForce(adapter, 1).y).toBe(12);
    // The field's own vector was scaled by nobody: the system does its
    // arithmetic component-wise into its own accumulator.
    expect(owned.y).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// The massless case
// ---------------------------------------------------------------------------

describe("ForceFieldSystem and a body with no mass (§23, §25)", () => {
  it("drops an acceleration contribution and reports it once per body", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { adapter, world } = await readyWorld();
    // No authored mass and no collider: the one reachable state in which
    // `RigidBody.mass` is `undefined` for a dynamic body.
    world.addBody(bodyNode({ collider: false }));

    const system = new ForceFieldSystem({
      worlds: [world],
      fields: [{ field: constantField(0, -9.81), units: "acceleration" }],
    });
    system.fixedUpdate(contextAt(0));
    system.fixedUpdate(contextAt(1 / 60));

    // Dropped, not turned into NaN — the value that would have poisoned every
    // later checksum.
    world.step(1 / 60);
    expect(solverForce(adapter, 1).y).toBe(0);
    expect(Number.isNaN(solverForce(adapter, 1).y)).toBe(false);
    // Two warnings, because this body has two distinct problems and a reader needs both:
    // §25's force field cannot accelerate a massless body, and §23's solver will never
    // rotate one with no inertia tensor. Same underlying mistake — a dynamic body with no
    // collider — but different consequences, from different systems, and the second is
    // the one that silently froze a whole mechanism when it went unreported (2026-09-06).
    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages).toHaveLength(2);
    expect(messages.some((message) => message.includes("no mass"))).toBe(true);
    expect(messages.some((message) => /never rotate it/.test(message))).toBe(
      true,
    );
  });

  it("still applies force-unit fields to it, which need no mass", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { adapter, world } = await readyWorld();
    world.addBody(bodyNode({ collider: false }));

    new ForceFieldSystem({
      worlds: [world],
      fields: [
        { field: constantField(0, -9.81), units: "acceleration" },
        { field: constantField(2.5, 0), units: "force" },
      ],
    }).fixedUpdate(contextAt(0));
    world.step(1 / 60);

    expect(solverForce(adapter, 1).x).toBe(2.5);
    expect(solverForce(adapter, 1).y).toBe(0);
  });

  it("reports again after dispose, because the suppression set is released", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { world } = await readyWorld();
    world.addBody(bodyNode({ collider: false }));

    const system = new ForceFieldSystem({
      worlds: [world],
      fields: [{ field: constantField(0, -1), units: "acceleration" }],
    });
    system.fixedUpdate(contextAt(0));
    system.dispose();

    system.track(world);
    system.addField(constantField(0, -1), "acceleration");
    system.fixedUpdate(contextAt(0));

    expect(warn).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// The §39 pipeline, end to end
// ---------------------------------------------------------------------------

describe("§39 step 5 then step 6, in one registry", () => {
  it("drains this step's field force in this step's solve", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(bodyNode({ mass: 2 }));

    const registry = new SystemRegistry();
    registry.register(new PhysicsSystem({ worlds: [world] }));
    registry.register(
      new ForceFieldSystem({
        worlds: [world],
        // 4 N on a 2 kg body ⇒ 2 m/s² ⇒ Δv = 2/60 in one step, on top of the
        // fake solver's gravity.
        fields: [{ field: constantField(4, 0), units: "force" }],
      }),
    );

    const time = createTimeState({ fixedDeltaTime: 1 / 60 });
    time.simulationTime = 0;
    registry.runFixedStep(time);

    expect(adapter.body(1).linearVelocity.x).toBeCloseTo(2 / 60, 12);
    // §26's one-step semantics: the buffer was cleared by the drain, so a
    // second step with the generator removed adds nothing further.
    expect(
      world.getBody(world.nodes.next().value as Group)?.commands.force.x,
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §27 batched field sampling
// ---------------------------------------------------------------------------

/**
 * A field that implements both entry points from the same arithmetic, and
 * counts which one the system actually called.
 */
function countingBatchField(
  x: number,
  y: number,
  z = 0,
): ForceField & { sampleCalls: number; batchCalls: number } {
  const field = {
    sampleCalls: 0,
    batchCalls: 0,
    sample(
      _position: Vector3,
      _velocity: Vector3,
      _time: number,
      out?: Vector3,
    ): Vector3 {
      field.sampleCalls += 1;
      return (out ?? new Vector3()).set(x, y, z);
    },
    sampleAll(
      _positions: ArrayLike<number>,
      _velocities: ArrayLike<number>,
      count: number,
      _time: number,
      out: Float64Array,
    ): void {
      field.batchCalls += 1;
      for (let i = 0; i < count; i += 1) {
        const base = i * 3;
        out[base] += x;
        out[base + 1] += y;
        out[base + 2] += z;
      }
    },
  };
  return field;
}

/** Drag-like `a = −c · v`, with both entry points, for the N-vs-N equality. */
function dragLikeField(coefficient: number): ForceField {
  return {
    sample(_position, velocity, _time, out) {
      return (out ?? new Vector3()).set(
        -coefficient * velocity.x,
        -coefficient * velocity.y,
        -coefficient * velocity.z,
      );
    },
    sampleAll(_positions, velocities, count, _time, out) {
      for (let i = 0; i < count; i += 1) {
        const base = i * 3;
        out[base] += -coefficient * velocities[base];
        out[base + 1] += -coefficient * velocities[base + 1];
        out[base + 2] += -coefficient * velocities[base + 2];
      }
    },
  };
}

describe("ForceFieldSystem batch path (§27 sampleAll)", () => {
  it("calls sampleAll once per field, not sample per body", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(bodyNode({ mass: 1, position: [0, 0, 0] }));
    world.addBody(bodyNode({ mass: 2, position: [1, 0, 0] }));
    world.addBody(bodyNode({ mass: 3, position: [2, 0, 0] }));

    const field = countingBatchField(1, -2, 0);
    new ForceFieldSystem({
      worlds: [world],
      fields: [{ field, units: "force" }],
    }).fixedUpdate(contextAt(0.5));
    world.step(1 / 60);

    expect(field.batchCalls).toBe(1);
    expect(field.sampleCalls).toBe(0);
    for (const id of [1, 2, 3]) {
      expect(solverForce(adapter, id).x).toBe(1);
      expect(solverForce(adapter, id).y).toBe(-2);
    }
  });

  it("a batch of N equals N times sample() within an ulp", async () => {
    const { adapter: batchedAdapter, world: batchedWorld } = await readyWorld();
    const { adapter: scalarAdapter, world: scalarWorld } = await readyWorld();
    const positions = [
      [0.5, 1.25, 0],
      [-2, 0.75, 0],
      [3.5, -0.5, 0],
    ] as const;
    const velocities = [
      [1.5, -0.25, 0],
      [0, 2, 0],
      [-0.75, 0.5, 0],
    ] as const;

    for (let i = 0; i < positions.length; i += 1) {
      const position = positions[i];
      const velocity = velocities[i];
      batchedWorld.addBody(bodyNode({ mass: 1 + i, position }));
      scalarWorld.addBody(bodyNode({ mass: 1 + i, position }));
      batchedAdapter
        .body(i + 1)
        .position.set(position[0], position[1], position[2]);
      scalarAdapter
        .body(i + 1)
        .position.set(position[0], position[1], position[2]);
      batchedAdapter
        .body(i + 1)
        .linearVelocity.set(velocity[0], velocity[1], velocity[2]);
      scalarAdapter
        .body(i + 1)
        .linearVelocity.set(velocity[0], velocity[1], velocity[2]);
    }
    batchedWorld.step(1 / 60);
    scalarWorld.step(1 / 60);

    const batchedField = dragLikeField(0.4);
    const scalarOnly: ForceField = {
      sample: (position, velocity, time, out) =>
        batchedField.sample(position, velocity, time, out),
    };

    new ForceFieldSystem({
      worlds: [batchedWorld],
      fields: [
        { field: batchedField, units: "acceleration" },
        { field: countingBatchField(2, 0, 0), units: "force" },
      ],
    }).fixedUpdate(contextAt(0.25));
    new ForceFieldSystem({
      worlds: [scalarWorld],
      fields: [
        { field: scalarOnly, units: "acceleration" },
        { field: constantField(2, 0, 0), units: "force" },
      ],
    }).fixedUpdate(contextAt(0.25));
    batchedWorld.step(1 / 60);
    scalarWorld.step(1 / 60);

    for (const id of [1, 2, 3]) {
      const batched = solverForce(batchedAdapter, id);
      const scalar = solverForce(scalarAdapter, id);
      expect(batched.x).toBe(scalar.x);
      expect(batched.y).toBe(scalar.y);
      expect(batched.z).toBe(scalar.z);
    }
  });

  it("a field without sampleAll is mixed in without disabling the batch path", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(bodyNode({ mass: 2, position: [1, 0, 0] }));
    world.addBody(bodyNode({ mass: 4, position: [2, 0, 0] }));

    const batched = countingBatchField(0, 3, 0);
    let scalarCalls = 0;
    const scalar: ForceField = {
      sample(_position, _velocity, _time, out) {
        scalarCalls += 1;
        return (out ?? new Vector3()).set(1, 0, 0);
      },
    };

    new ForceFieldSystem({
      worlds: [world],
      fields: [
        { field: batched, units: "acceleration" },
        { field: scalar, units: "force" },
      ],
    }).fixedUpdate(contextAt(0));
    world.step(1 / 60);

    expect(batched.batchCalls).toBe(1);
    expect(batched.sampleCalls).toBe(0);
    expect(scalarCalls).toBe(2);
    // 3 m/s² × mass + 1 N
    expect(solverForce(adapter, 1).x).toBe(1);
    expect(solverForce(adapter, 1).y).toBe(6);
    expect(solverForce(adapter, 2).x).toBe(1);
    expect(solverForce(adapter, 2).y).toBe(12);
  });

  it("allocates nothing per step once the SoA scratch has grown (§7b)", async () => {
    const { world } = await readyWorld();
    world.addBody(bodyNode({ mass: 1 }));
    world.addBody(bodyNode({ mass: 3 }));
    const system = new ForceFieldSystem({
      worlds: [world],
      fields: [{ field: countingBatchField(1, 0, 0), units: "force" }],
    });
    const context = contextAt(0);
    system.fixedUpdate(context);

    resetConstructionCount();
    for (let i = 0; i < 20; i += 1) {
      system.fixedUpdate(context);
    }
    expect(constructionCount()).toBe(0);
  });

  it("does not keep applying to a body after its world goes quiet (§83)", async () => {
    const first = await readyWorld();
    const second = await readyWorld();
    first.world.addBody(bodyNode({ mass: 1 }));
    second.world.addBody(bodyNode({ mass: 1 }));
    const system = new ForceFieldSystem({
      worlds: [first.world, second.world],
      fields: [{ field: countingBatchField(1, 0, 0), units: "force" }],
    });
    system.fixedUpdate(contextAt(0));
    first.world.step(1 / 60);
    second.world.step(1 / 60);
    expect(solverForce(first.adapter, 1).x).toBe(1);

    system.untrack(first.world);
    first.adapter.body(1).force.set(0, 0, 0);
    system.fixedUpdate(contextAt(0));
    first.world.step(1 / 60);
    second.world.step(1 / 60);

    expect(solverForce(first.adapter, 1).x).toBe(0);
    expect(solverForce(second.adapter, 1).x).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Torque channel + field-driven waking (PH-8 remainders, 2026-09-06)
// ---------------------------------------------------------------------------

/** A field that answers a constant torque in N·m, and no linear force. */
function constantTorqueField(x: number, y: number, z: number): ForceField {
  return {
    sample(_position, _velocity, _time, out) {
      const target = out ?? new Vector3();
      return target.set(0, 0, 0);
    },
    sampleTorque(_position, _velocity, _angular, _time, out) {
      const target = out ?? new Vector3();
      return target.set(x, y, z);
    },
  };
}

function solverTorque(adapter: FakeSolverAdapter, id: number): Vector3 {
  return adapter.body(id).torque;
}

describe("ForceField.sampleTorque (PH-8 remainder)", () => {
  it("queues N·m through applyTorque and does not scale by mass", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(bodyNode({ mass: 2 }));

    new ForceFieldSystem({
      worlds: [world],
      fields: [{ field: constantTorqueField(0, 0, 4), units: "acceleration" }],
    }).fixedUpdate(contextAt(0));
    world.step(1 / 60);

    expect(solverTorque(adapter, 1).z).toBe(4);
    expect(solverForce(adapter, 1).x).toBe(0);
    expect(solverForce(adapter, 1).y).toBe(0);
  });

  it("sums torque in registration order and leaves a linear-only field at zero", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(bodyNode({ mass: 1 }));

    new ForceFieldSystem({
      worlds: [world],
      fields: [
        { field: constantTorqueField(1, 0, 0), units: "force" },
        { field: constantField(0, 3), units: "force" },
        { field: constantTorqueField(0, 2, 0), units: "force" },
      ],
    }).fixedUpdate(contextAt(0));
    world.step(1 / 60);

    expect(solverTorque(adapter, 1).x).toBe(1);
    expect(solverTorque(adapter, 1).y).toBe(2);
    expect(solverForce(adapter, 1).y).toBe(3);
  });

  it("applies torque on the batched linear path without a second sampleAll", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(bodyNode({ mass: 1 }));
    const linear = countingBatchField(0, 0, 0);
    const twist = constantTorqueField(0, 0, 5);

    new ForceFieldSystem({
      worlds: [world],
      fields: [
        { field: linear, units: "force" },
        { field: twist, units: "force" },
      ],
    }).fixedUpdate(contextAt(0));
    world.step(1 / 60);

    expect(linear.batchCalls).toBe(1);
    expect(solverTorque(adapter, 1).z).toBe(5);
  });
});

describe("ForceFieldAddOptions.wakesSleepingBodies (PH-8 remainder)", () => {
  it("defaults to false and is stored on the entry", () => {
    const field = constantField(1, 0);
    const system = new ForceFieldSystem();
    system.addField(field, "force");
    system.addField(field, "force", { wakesSleepingBodies: true });
    expect(system.fields[0].wakesSleepingBodies).toBe(false);
    expect(system.fields[1].wakesSleepingBodies).toBe(true);
  });

  it("wakes a sleeper only for the entry that opted in", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(bodyNode({ mass: 1 }));
    adapter.body(1).sleeping = true;
    world.step(1 / 60);

    const ambient = constantField(0, -50);
    const blast = constantField(8, 0);
    new ForceFieldSystem({
      worlds: [world],
      fields: [
        { field: ambient, units: "force" },
        { field: blast, units: "force", wakesSleepingBodies: true },
      ],
    }).fixedUpdate(contextAt(0));
    world.step(1 / 60);

    // Ambient gravity never saw the sleeper; the blast did, and asked to wake.
    expect(solverForce(adapter, 1).x).toBe(8);
    expect(solverForce(adapter, 1).y).toBe(0);
    expect(adapter.body(1).sleeping).toBe(false);
  });

  it("does not wake when the waking field samples zero", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(bodyNode({ mass: 1 }));
    adapter.body(1).sleeping = true;
    world.step(1 / 60);

    new ForceFieldSystem({
      worlds: [world],
      fields: [
        {
          field: constantField(0, 0),
          units: "force",
          wakesSleepingBodies: true,
        },
      ],
    }).fixedUpdate(contextAt(0));
    world.step(1 / 60);

    expect(adapter.body(1).sleeping).toBe(true);
    expect(
      adapter.calls.filter((call) => call.method === "applyForce"),
    ).toEqual([]);
  });

  it("wakes from a non-zero torque with no linear force", async () => {
    const { adapter, world } = await readyWorld();
    world.addBody(bodyNode({ mass: 1 }));
    adapter.body(1).sleeping = true;
    world.step(1 / 60);

    new ForceFieldSystem({
      worlds: [world],
      fields: [
        {
          field: constantTorqueField(0, 0, 3),
          units: "force",
          wakesSleepingBodies: true,
        },
      ],
    }).fixedUpdate(contextAt(0));
    world.step(1 / 60);

    expect(solverTorque(adapter, 1).z).toBe(3);
    expect(adapter.body(1).sleeping).toBe(false);
  });
});
