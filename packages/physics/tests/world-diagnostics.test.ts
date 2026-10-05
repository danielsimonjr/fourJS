/**
 * §41's "diagnostics should warn about suspicious values" (PH-22n, 2026-08-08).
 *
 * Three checks fire at registration — distance from origin, dynamic collider
 * scale, and the world's dynamic mass ratio — each once per world, on the
 * `#warnTuning` channel every other accept-and-drop signal uses. What is under
 * test here is as much the **silence** as the noise: a diagnostic that fires on
 * an ordinary scene is one everybody learns to ignore, so the ordinary cases
 * below assert that nothing is printed at all.
 */

import { Vector2, Vector3 } from "@fourjs/math";
import { Group } from "@fourjs/scene";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BodyType, CollisionShape } from "../src/index.js";
import {
  Collider,
  PhysicsWorld,
  RigidBody,
  shapeMaximumExtent,
} from "../src/index.js";
import { FakeSolverAdapter } from "./fake-adapter.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** A node with a body of `type`, one collider, and an optional mass/position. */
function node(options: {
  type?: BodyType;
  shape?: CollisionShape;
  mass?: number;
  position?: Vector3;
}): Group {
  const group = new Group();
  if (options.position !== undefined) {
    group.transform.position.copy(options.position);
  }
  group.transformAuthority = "physics";
  const type = options.type ?? "dynamic";
  group.addComponent(
    new RigidBody(
      options.mass === undefined ? { type } : { type, mass: options.mass },
    ),
  );
  group.addComponent(
    new Collider({ shape: options.shape ?? { type: "circle", radius: 0.5 } }),
  );
  return group;
}

/** A ready 2D world on the plain fake adapter. */
async function world(): Promise<PhysicsWorld> {
  const built = new PhysicsWorld({
    dimension: "2d",
    adapter: new FakeSolverAdapter(),
  });
  await built.initialize();
  return built;
}

/** Silences `console.warn` and returns the spy. */
function silenceWarnings(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

describe("§41 distance from origin", () => {
  it("warns once past 1e5 units, naming the distance", async () => {
    const built = await world();
    const warn = silenceWarnings();

    built.addBody(node({ position: new Vector3(2e5, 0, 0) }));
    built.addBody(node({ position: new Vector3(0, -3e5, 0) }));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("200000 units from the origin");
    expect(warn.mock.calls[0]?.[0]).toContain("§41");
  });

  it("stays silent inside the envelope, including at the limit", async () => {
    const built = await world();
    const warn = silenceWarnings();

    built.addBody(node({ position: new Vector3(1e5, 1e5, 0) }));
    built.addBody(node({ position: new Vector3(-42, 7, 0) }));

    expect(warn).not.toHaveBeenCalled();
  });

  it("checks every axis, not just the planar ones", async () => {
    const built = new PhysicsWorld({
      dimension: "3d",
      adapter: new FakeSolverAdapter(),
    });
    await built.initialize();
    const warn = silenceWarnings();

    built.addBody(
      node({
        shape: { type: "sphere", radius: 0.5 },
        position: new Vector3(0, 0, 1e6),
      }),
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("1000000 units");
  });
});

describe("§41 world scale", () => {
  it("warns about a dynamic collider that is far too large", async () => {
    const built = await world();
    const warn = silenceWarnings();

    built.addBody(node({ shape: { type: "circle", radius: 5000 } }));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("5000 units across");
    expect(warn.mock.calls[0]?.[0]).toContain("Scale the whole world");
  });

  it("warns about a dynamic collider that is far too small", async () => {
    const built = await world();
    const warn = silenceWarnings();

    built.addBody(node({ shape: { type: "circle", radius: 0.001 } }));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("millimetres-as-units");
  });

  it("exempts static and kinematic colliders, however large", async () => {
    const built = await world();
    const warn = silenceWarnings();

    // A ground slab and a moving platform are not scale mistakes.
    built.addBody(
      node({
        type: "static",
        shape: { type: "rectangle", halfExtents: new Vector2(5000, 1) },
      }),
    );
    built.addBody(
      node({
        type: "kinematic-position",
        shape: { type: "rectangle", halfExtents: new Vector2(5000, 1) },
      }),
    );

    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent across the whole ordinary range", async () => {
    const built = await world();
    const warn = silenceWarnings();

    for (const radius of [0.01, 0.5, 12, 1000]) {
      built.addBody(node({ shape: { type: "circle", radius }, mass: 1 }));
    }

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("§41 mass ratios", () => {
  it("warns once the world spans more than 1000:1", async () => {
    const built = await world();
    const warn = silenceWarnings();

    built.addBody(node({ mass: 1 }));
    expect(warn).not.toHaveBeenCalled();

    built.addBody(node({ mass: 5000 }));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("5000:1");
    expect(warn.mock.calls[0]?.[0]).toContain("~100×");
  });

  it("accumulates across registrations, in either order", async () => {
    const built = await world();
    const warn = silenceWarnings();

    // Heavy first, then a middleweight that trips nothing, then the feather.
    built.addBody(node({ mass: 4000 }));
    built.addBody(node({ mass: 100 }));
    expect(warn).not.toHaveBeenCalled();
    built.addBody(node({ mass: 0.5 }));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("8000:1");
  });

  it("ignores non-dynamic bodies, whose solver mass is not comparable", async () => {
    const built = await world();
    const warn = silenceWarnings();

    // The fake reports 0 for a non-dynamic body, exactly as §23 warns a real
    // solver may; a 0 must never become the denominator of a ratio.
    built.addBody(node({ type: "static" }));
    built.addBody(node({ type: "kinematic-velocity", mass: 9e9 }));
    built.addBody(node({ mass: 1 }));

    expect(warn).not.toHaveBeenCalled();
  });

  it("never warns twice, however many bodies follow", async () => {
    const built = await world();
    const warn = silenceWarnings();

    built.addBody(node({ mass: 1 }));
    for (let i = 0; i < 5; i += 1) {
      built.addBody(node({ mass: 1e6 }));
    }

    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("shapeMaximumExtent (§41)", () => {
  it("answers for every shipped shape", () => {
    expect(shapeMaximumExtent({ type: "circle", radius: 2 })).toBe(2);
    expect(shapeMaximumExtent({ type: "sphere", radius: 3 })).toBe(3);
    expect(
      shapeMaximumExtent({
        type: "rectangle",
        halfExtents: new Vector2(1, 4),
      }),
    ).toBe(4);
    expect(
      shapeMaximumExtent({ type: "box", halfExtents: new Vector3(1, 2, 7) }),
    ).toBe(7);
    // A capsule's extent includes its caps; a cylinder's and a cone's do not,
    // because a flat end is exactly `halfHeight` from the centre.
    expect(
      shapeMaximumExtent({ type: "capsule", radius: 1, halfHeight: 2 }),
    ).toBe(3);
    expect(
      shapeMaximumExtent({ type: "cylinder", radius: 5, halfHeight: 2 }),
    ).toBe(5);
    expect(shapeMaximumExtent({ type: "cone", radius: 1, halfHeight: 6 })).toBe(
      6,
    );
    expect(
      shapeMaximumExtent({
        type: "polygon",
        vertices: [new Vector2(0, 0), new Vector2(9, 0), new Vector2(0, 1)],
      }),
    ).toBe(9);
    expect(
      shapeMaximumExtent({
        type: "polyline",
        vertices: [new Vector2(0, 0), new Vector2(0, -8)],
      }),
    ).toBe(8);
    expect(
      shapeMaximumExtent({
        type: "chain",
        vertices: [new Vector2(0, 0), new Vector2(3, 0), new Vector2(0, 3)],
      }),
    ).toBe(3);
    expect(
      shapeMaximumExtent({
        type: "convex-hull",
        points: [
          new Vector3(0, 0, 0),
          new Vector3(1, 0, 0),
          new Vector3(0, 1, 0),
          new Vector3(0, 0, -11),
        ],
      }),
    ).toBe(11);
    expect(
      shapeMaximumExtent({
        type: "triangle-mesh",
        vertices: [
          new Vector3(0, 0, 0),
          new Vector3(2, 0, 0),
          new Vector3(0, 0, 2),
        ],
        indices: [0, 1, 2],
      }),
    ).toBe(2);
    // A height field spans half its scale in X and Z, and its tallest sample
    // (scaled) in Y.
    expect(
      shapeMaximumExtent({
        type: "height-field",
        rows: 2,
        columns: 2,
        heights: [0, 0, 0, 40],
        scale: new Vector3(10, 2, 10),
      }),
    ).toBe(80);
  });

  it("answers 0 for an empty vertex list, which validation refuses anyway", () => {
    expect(shapeMaximumExtent({ type: "polyline", vertices: [] })).toBe(0);
    expect(shapeMaximumExtent({ type: "convex-hull", points: [] })).toBe(0);
  });
});
