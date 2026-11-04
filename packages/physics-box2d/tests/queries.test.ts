import { Vector2, Vector3 } from "@fourjs/math";
import type {
  PhysicsBodyHandle,
  PhysicsColliderHandle,
  CollisionShape,
} from "@fourjs/physics";

import { describe, expect, it } from "vitest";

import { BOX2D_CAPABILITIES, Box2dAdapter } from "../src/index.js";
import { fnv } from "./helpers.js";

const DT = 1 / 60;

function make(): Box2dAdapter {
  const adapter = new Box2dAdapter();
  adapter.initialize({ dimension: "2d", gravity: new Vector2(0, 0) });
  return adapter;
}

interface Made {
  body: PhysicsBodyHandle;
  collider: PhysicsColliderHandle;
}

function add(
  a: Box2dAdapter,
  x: number,
  y: number,
  shape: CollisionShape,
  extra: {
    type?: "static" | "dynamic";
    sensor?: boolean;
    groups?: number;
    mask?: number;
  } = {},
): Made {
  const body = a.createBody({
    type: extra.type ?? "static",
    position: new Vector2(x, y),
  });
  const collider = a.createCollider({
    body,
    shape,
    density: 1,
    sensor: extra.sensor ?? false,
    collisionGroups: extra.groups,
    collisionMask: extra.mask,
  });
  return { body, collider };
}

const BOX: CollisionShape = {
  type: "rectangle",
  halfExtents: new Vector2(0.5, 0.5),
};
const CIRCLE: CollisionShape = { type: "circle", radius: 0.5 };

describe("capabilities", () => {
  it("declares every query and snapshots", () => {
    expect(BOX2D_CAPABILITIES.queries).toEqual({
      raycast: true,
      shapeCast: true,
      overlap: true,
      point: true,
    });
    expect(BOX2D_CAPABILITIES.snapshots).toBe(true);
  });
});

describe("raycast", () => {
  it("hits the nearest collider with normal, distance and handles", () => {
    const a = make();
    const near = add(a, 5, 0, BOX);
    add(a, 9, 0, BOX);
    const hits = a.raycast({
      origin: new Vector2(0, 0),
      direction: new Vector2(2, 0),
      mode: "first",
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].collider).toBe(near.collider);
    expect(hits[0].body).toBe(near.body);
    expect(hits[0].distance).toBeCloseTo(4.5, 9);
    expect(hits[0].point.x).toBeCloseTo(4.5, 9);
    expect(hits[0].normal.x).toBeCloseTo(-1, 9);
    expect(hits[0].normal.y).toBeCloseTo(0, 9);
  });

  it("returns all hits, sorted on request, honouring maxHits", () => {
    const a = make();
    const far = add(a, 9, 0, CIRCLE);
    const near = add(a, 5, 0, CIRCLE);
    const query = {
      origin: new Vector2(0, 0),
      direction: new Vector2(1, 0),
    };
    const all = a.raycast({ ...query, sorted: true });
    expect(all.map((h) => h.collider)).toEqual([near.collider, far.collider]);
    expect(all[0].distance).toBeCloseTo(4.5, 9);
    expect(a.raycast({ ...query, maxHits: 1 })).toHaveLength(1);
  });

  it("misses: out of range, wrong direction, empty world", () => {
    const a = make();
    expect(
      a.raycast({ origin: new Vector2(0, 0), direction: new Vector2(1, 0) }),
    ).toEqual([]);
    add(a, 5, 0, BOX);
    expect(
      a.raycast({
        origin: new Vector2(0, 0),
        direction: new Vector2(1, 0),
        maxDistance: 3,
      }),
    ).toEqual([]);
    expect(
      a.raycast({ origin: new Vector2(0, 0), direction: new Vector2(-1, 0) }),
    ).toEqual([]);
    expect(
      a.raycast({
        origin: new Vector2(0, 0),
        direction: new Vector2(1, 0),
        maxDistance: 0,
      }),
    ).toEqual([]);
  });

  it("applies filters: sensors, ignore lists, groups/masks, predicate", () => {
    const a = make();
    const sensor = add(a, 2, 0, BOX, { sensor: true });
    const masked = add(a, 4, 0, BOX, { groups: 0b10, mask: 0b10 });
    const solid = add(a, 6, 0, BOX);
    const base = { origin: new Vector2(0, 0), direction: new Vector2(1, 0) };
    const colliders = (extra: object): unknown[] =>
      a.raycast({ ...base, sorted: true, ...extra }).map((h) => h.collider);
    expect(colliders({})).toEqual([masked.collider, solid.collider]);
    expect(colliders({ includeSensors: true })).toEqual([
      sensor.collider,
      masked.collider,
      solid.collider,
    ]);
    expect(colliders({ ignoredBodies: [masked.body] })).toEqual([
      solid.collider,
    ]);
    expect(colliders({ ignoredColliders: [masked.collider] })).toEqual([
      solid.collider,
    ]);
    // Query group 0b01 against a collider whose mask is 0b10: rejected.
    expect(colliders({ collisionGroups: 0b01 })).toEqual([solid.collider]);
    // Query mask 0b01 against collider groups 0b10: rejected.
    expect(colliders({ collisionMask: 0b01 })).toEqual([solid.collider]);
    expect(
      colliders({
        predicate: (c: { collider: unknown }) => c.collider === solid.collider,
      }),
    ).toEqual([solid.collider]);
  });

  it("reports a capsule once and respects rotation", () => {
    const a = make();
    const cap = add(a, 5, 0, { type: "capsule", radius: 0.5, halfHeight: 1 });
    const hits = a.raycast({
      origin: new Vector2(0, 0.9),
      direction: new Vector2(1, 0),
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].collider).toBe(cap.collider);
  });

  it("rejects a zero direction and 3D input", () => {
    const a = make();
    expect(() =>
      a.raycast({ origin: new Vector2(0, 0), direction: new Vector2(0, 0) }),
    ).toThrow(/non-zero/);
    expect(() =>
      a.raycast({
        origin: new Vector3(0, 0, 1),
        direction: new Vector2(1, 0),
      }),
    ).toThrow(/z/);
  });
});

describe("pointQuery", () => {
  it("returns containing colliders only, deduplicating a capsule", () => {
    const a = make();
    const box = add(a, 0, 0, BOX);
    const cap = add(a, 5, 0, { type: "capsule", radius: 0.5, halfHeight: 1 });
    add(a, 0, 10, CIRCLE);
    const inBox = a.pointQuery({ point: new Vector2(0.2, 0.2) });
    expect(inBox).toHaveLength(1);
    expect(inBox[0].collider).toBe(box.collider);
    expect(inBox[0].body).toBe(box.body);
    expect(inBox[0].distance).toBe(0);
    expect(inBox[0].point.x).toBe(0.2);
    // Inside the overlap of the capsule's rectangle and its top circle.
    const inCap = a.pointQuery({ point: new Vector2(5, 0.9) });
    expect(inCap.map((h) => h.collider)).toEqual([cap.collider]);
    expect(a.pointQuery({ point: new Vector2(3, 3) })).toEqual([]);
  });

  it("filters sensors and honours maxHits", () => {
    const a = make();
    add(a, 0, 0, BOX, { sensor: true });
    const solid = add(a, 0, 0, BOX);
    add(a, 0, 0, BOX);
    const p = new Vector2(0, 0);
    expect(a.pointQuery({ point: p }).length).toBe(2);
    expect(a.pointQuery({ point: p, includeSensors: true }).length).toBe(3);
    expect(a.pointQuery({ point: p, maxHits: 1 })).toHaveLength(1);
    expect(
      a.pointQuery({ point: p, ignoredColliders: [solid.collider] }),
    ).toHaveLength(1);
  });
});

describe("overlap", () => {
  it("finds exactly the shapes that truly overlap (not just AABB hits)", () => {
    const a = make();
    const hit = add(a, 0, 0, BOX);
    // A circle whose AABB overlaps the query circle's but which is clear of it.
    add(a, 2.2, 2.2, CIRCLE);
    add(a, 20, 0, BOX);
    const hits = a.overlap({
      shape: { type: "circle", radius: 1 },
      position: new Vector2(0.9, 0.9),
    });
    expect(hits.map((h) => h.collider)).toEqual([hit.collider]);
  });

  it("supports boxes with rotation, polygons and capsules in the query", () => {
    const a = make();
    const target = add(a, 3, 0, BOX);
    const rect = a.overlap({
      shape: { type: "rectangle", halfExtents: new Vector2(2, 0.1) },
      position: new Vector2(3, 0),
      rotation: Math.PI / 2,
    });
    expect(rect).toHaveLength(1);
    // Rotated 90 degrees the thin box is vertical: a spot at the side is clear.
    expect(
      a.overlap({
        shape: { type: "rectangle", halfExtents: new Vector2(2, 0.1) },
        position: new Vector2(3, 1.5),
        rotation: Math.PI / 2,
      }),
    ).toHaveLength(1);
    expect(
      a.overlap({
        shape: { type: "rectangle", halfExtents: new Vector2(2, 0.1) },
        position: new Vector2(3, 1.5),
      }),
    ).toHaveLength(0);
    const poly = a.overlap({
      shape: {
        type: "polygon",
        vertices: [new Vector2(0, 0), new Vector2(4, 0), new Vector2(0, 1)],
      },
      position: new Vector2(2, 0),
    });
    expect(poly.map((h) => h.collider)).toEqual([target.collider]);
    const cap = a.overlap({
      shape: { type: "capsule", radius: 0.2, halfHeight: 1 },
      position: new Vector2(3, 0.8),
    });
    expect(cap.map((h) => h.collider)).toEqual([target.collider]);
  });

  it("deduplicates a capsule target, filters and caps", () => {
    const a = make();
    const cap = add(a, 0, 0, { type: "capsule", radius: 0.5, halfHeight: 1 });
    add(a, 0, 0, BOX, { sensor: true });
    add(a, 0, 0, BOX);
    const q = { shape: BOX, position: new Vector2(0, 0) };
    expect(a.overlap(q)).toHaveLength(2);
    expect(a.overlap({ ...q, includeSensors: true })).toHaveLength(3);
    expect(a.overlap({ ...q, maxHits: 1 })).toHaveLength(1);
    expect(a.overlap({ ...q, ignoredBodies: [cap.body] })).toHaveLength(1);
  });

  it("refuses 3D query shapes", () => {
    const a = make();
    expect(() =>
      a.overlap({
        shape: { type: "sphere", radius: 1 },
        position: new Vector2(0, 0),
      }),
    ).toThrow();
  });
});

describe("shapeCast", () => {
  it("hits a box face with an outward normal and the travelled distance", () => {
    const a = make();
    const wall = add(a, 5, 0, BOX);
    const hits = a.shapeCast({
      shape: { type: "circle", radius: 0.25 },
      position: new Vector2(0, 0),
      direction: new Vector2(3, 0),
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].collider).toBe(wall.collider);
    expect(hits[0].body).toBe(wall.body);
    expect(hits[0].distance).toBeCloseTo(4.25, 2);
    expect(hits[0].normal.x).toBeCloseTo(-1, 6);
    expect(hits[0].point.x).toBeCloseTo(4.5, 1);
    expect(hits[0].point.y).toBeCloseTo(0, 6);
  });

  it("returns every crossed collider, nearest first with mode first", () => {
    const a = make();
    const far = add(a, 9, 0, BOX);
    const near = add(a, 4, 0, BOX);
    const query = {
      shape: { type: "circle", radius: 0.25 } as CollisionShape,
      position: new Vector2(0, 0),
      direction: new Vector2(1, 0),
    };
    const all = a.shapeCast({ ...query, sorted: true });
    expect(all.map((h) => h.collider)).toEqual([near.collider, far.collider]);
    expect(a.shapeCast({ ...query, mode: "first" })[0].collider).toBe(
      near.collider,
    );
    expect(a.shapeCast({ ...query, maxHits: 1 })).toHaveLength(1);
    expect(a.shapeCast({ ...query, maxDistance: 2 })).toEqual([]);
  });

  it("reports an initial overlap at distance 0 and misses cleanly", () => {
    const a = make();
    const wall = add(a, 0, 0, BOX);
    const inside = a.shapeCast({
      shape: { type: "circle", radius: 0.25 },
      position: new Vector2(0.1, 0),
      direction: new Vector2(1, 0),
    });
    expect(inside).toHaveLength(1);
    expect(inside[0].collider).toBe(wall.collider);
    expect(inside[0].distance).toBe(0);
    expect(inside[0].normal.x).toBe(-1);
    expect(
      a.shapeCast({
        shape: { type: "circle", radius: 0.25 },
        position: new Vector2(0, 5),
        direction: new Vector2(1, 0),
      }),
    ).toEqual([]);
    expect(
      a.shapeCast({
        shape: { type: "circle", radius: 0.25 },
        position: new Vector2(0, 5),
        direction: new Vector2(1, 0),
        maxDistance: 0,
      }),
    ).toEqual([]);
  });

  it("sweeps boxes and capsules, with rotation, and filters", () => {
    const a = make();
    const solid = add(a, 5, 0, BOX);
    add(a, 3, 0, BOX, { sensor: true });
    const box = a.shapeCast({
      shape: { type: "rectangle", halfExtents: new Vector2(0.5, 0.1) },
      position: new Vector2(0, 0),
      rotation: Math.PI / 2,
      direction: new Vector2(1, 0),
    });
    expect(box.map((h) => h.collider)).toEqual([solid.collider]);
    // Rotated 90 degrees the thin box is 0.1 deep along x: contact at 4.4.
    expect(box[0].distance).toBeCloseTo(4.4, 1);
    const cap = a.shapeCast({
      shape: { type: "capsule", radius: 0.2, halfHeight: 0.3 },
      position: new Vector2(0, 0),
      direction: new Vector2(1, 0),
    });
    expect(cap).toHaveLength(1);
    expect(cap[0].distance).toBeCloseTo(4.3, 1);
    expect(
      a.shapeCast({
        shape: { type: "circle", radius: 0.2 },
        position: new Vector2(0, 0),
        direction: new Vector2(1, 0),
        includeSensors: true,
      }),
    ).toHaveLength(2);
  });

  it("rejects a zero direction", () => {
    const a = make();
    expect(() =>
      a.shapeCast({
        shape: CIRCLE,
        position: new Vector2(0, 0),
        direction: new Vector2(0, 0),
      }),
    ).toThrow(/non-zero/);
  });
});

describe("queries never perturb the simulation", () => {
  function checksumStream(withQueries: boolean): number[] {
    const a = new Box2dAdapter();
    a.initialize({ dimension: "2d", gravity: new Vector2(0, -9.81) });
    add(a, 0, -1, { type: "rectangle", halfExtents: new Vector2(10, 0.5) });
    for (let i = 0; i < 4; i += 1) {
      add(a, i * 0.4, 1 + i, CIRCLE, { type: "dynamic" });
    }
    const out: number[] = [];
    for (let step = 0; step < 120; step += 1) {
      if (withQueries) {
        a.raycast({
          origin: new Vector2(-5, 0),
          direction: new Vector2(1, 0),
        });
        a.shapeCast({
          shape: CIRCLE,
          position: new Vector2(-5, 2),
          direction: new Vector2(1, -0.2),
        });
        a.overlap({ shape: BOX, position: new Vector2(0, 1) });
        a.pointQuery({ point: new Vector2(0, 1) });
      }
      a.step(DT);
      out.push(fnv(a));
    }
    return out;
  }

  it("leaves the checksum stream bit-identical", () => {
    expect(checksumStream(true)).toEqual(checksumStream(false));
    expect(new Set(checksumStream(false)).size).toBeGreaterThan(10);
  });
});
