import { Vector3 } from "@fourjs/math";
import { describe, expect, it } from "vitest";

import {
  alignment,
  cohesion,
  separation,
  type SteeringNeighbor,
} from "../src/steering.js";
import { SpatialHash } from "../src/spatial-hash.js";

function makeNeighbor(
  position: [number, number, number],
  velocity: [number, number, number] = [0, 0, 0],
): SteeringNeighbor {
  return {
    position: new Vector3(...position),
    velocity: new Vector3(...velocity),
  };
}

describe("SpatialHash construction (WP-8.2)", () => {
  it("rejects non-positive cell sizes", () => {
    expect(() => new SpatialHash({ cellSize: 0 })).toThrow(RangeError);
    expect(() => new SpatialHash({ cellSize: -2 })).toThrow(RangeError);
    expect(() => new SpatialHash({ cellSize: Number.NaN })).toThrow(RangeError);
  });

  it("starts empty", () => {
    const hash = new SpatialHash({ cellSize: 2 });
    expect(hash.size).toBe(0);
    expect(hash.cellSize).toBe(2);
  });
});

describe("SpatialHash insert / remove / update", () => {
  it("stores and retrieves entries by key", () => {
    const hash = new SpatialHash<string>({ cellSize: 1 });
    hash.insert(3, 1, 2, 3, "a");
    expect(hash.size).toBe(1);
    expect(hash.get(3)).toEqual({
      key: 3,
      x: 1,
      y: 2,
      z: 3,
      data: "a",
    });
    expect(hash.has(3)).toBe(true);
    expect(hash.has(99)).toBe(false);
  });

  it("replace-insert keeps insertion order", () => {
    const hash = new SpatialHash<number>({ cellSize: 4 });
    hash.insert(0, 0, 0, 0, 0);
    hash.insert(1, 5, 0, 0, 1);
    hash.insert(0, 0.5, 0, 0, 10);
    const out: number[] = [];
    hash.query(0, 0, 0, 10, out);
    expect(out).toEqual([10, 1]);
  });

  it("remove drops entries from queries", () => {
    const hash = new SpatialHash<number>({ cellSize: 2 });
    hash.insert(0, 0, 0, 0, 0);
    hash.insert(1, 1, 0, 0, 1);
    expect(hash.remove(0)).toBe(true);
    expect(hash.remove(0)).toBe(false);
    const out: number[] = [];
    hash.query(0, 0, 0, 2, out);
    expect(out).toEqual([1]);
  });

  it("update moves entries across cell boundaries", () => {
    const hash = new SpatialHash<number>({ cellSize: 2 });
    hash.insert(0, 0.5, 0, 0, 0);
    hash.update(0, 5.5, 0, 0);
    const nearOrigin: number[] = [];
    const farAway: number[] = [];
    hash.query(0, 0, 0, 1, nearOrigin);
    hash.query(5.5, 0, 0, 0.5, farAway);
    expect(nearOrigin).toEqual([]);
    expect(farAway).toEqual([0]);
  });

  it("update throws for unknown keys", () => {
    const hash = new SpatialHash({ cellSize: 1 });
    expect(() => hash.update(7, 0, 0, 0)).toThrow(RangeError);
  });

  it("clear resets size and queries", () => {
    const hash = new SpatialHash<number>({ cellSize: 1 });
    hash.insert(0, 0, 0, 0, 0);
    hash.clear();
    expect(hash.size).toBe(0);
    const out: number[] = [];
    hash.query(0, 0, 0, 1, out);
    expect(out).toEqual([]);
  });
});

describe("SpatialHash.query radius filtering", () => {
  it("returns only entries within the radius", () => {
    const hash = new SpatialHash<number>({ cellSize: 2 });
    hash.insert(0, 0, 0, 0, 0);
    hash.insert(1, 3, 0, 0, 1);
    hash.insert(2, 0, 4, 0, 2);
    hash.insert(3, 10, 0, 0, 3);

    const out: number[] = [];
    hash.query(0, 0, 0, 4, out);
    expect(out).toEqual([0, 1, 2]);
  });

  it("honours excludeKey for self-neighbour suppression", () => {
    const hash = new SpatialHash<number>({ cellSize: 2 });
    hash.insert(0, 0, 0, 0, 0);
    hash.insert(1, 1, 0, 0, 1);
    const out: number[] = [];
    hash.query(0, 0, 0, 5, out, 0);
    expect(out).toEqual([1]);
  });

  it("handles negative coordinates and cell boundaries", () => {
    const hash = new SpatialHash<number>({ cellSize: 2 });
    hash.insert(0, -3.5, -1, 0, 0);
    hash.insert(1, -0.5, 0.5, 0, 1);
    const out: number[] = [];
    hash.query(-2, 0, 0, 2.5, out);
    expect(out).toEqual([0, 1]);
  });

  it("returns an empty result for negative radius", () => {
    const hash = new SpatialHash<number>({ cellSize: 1 });
    hash.insert(0, 0, 0, 0, 0);
    const out: number[] = [];
    hash.query(0, 0, 0, -1, out);
    expect(out).toEqual([]);
  });

  it("queryKeys mirrors query ordering", () => {
    const hash = new SpatialHash<number>({ cellSize: 1 });
    hash.insert(2, 0, 0, 0, 2);
    hash.insert(0, 1, 0, 0, 0);
    hash.insert(1, 0, 1, 0, 1);
    const payloads: number[] = [];
    const keys: number[] = [];
    hash.query(0, 0, 0, 2, payloads);
    hash.queryKeys(0, 0, 0, 2, keys);
    expect(keys).toEqual([2, 0, 1]);
    expect(payloads).toEqual([2, 0, 1]);
  });
});

describe("SpatialHash determinism (§33, plan P8-3)", () => {
  it("returns neighbours in insertion order regardless of cell layout", () => {
    const hash = new SpatialHash<number>({ cellSize: 1 });
    const points: Array<[number, number, number]> = [
      [0, 0, 0],
      [10, 0, 0],
      [0, 10, 0],
      [10, 10, 0],
      [5, 5, 0],
    ];
    for (let i = 0; i < points.length; i += 1) {
      const [x, y, z] = points[i];
      hash.insert(i, x, y, z, i);
    }
    const out: number[] = [];
    hash.query(5, 5, 0, 8, out, 4);
    expect(out).toEqual([0, 1, 2, 3]);
  });

  it("is bit-identical across two independent rebuild/query runs", () => {
    function run(): number[][] {
      const hash = new SpatialHash<SteeringNeighbor>({ cellSize: 3 });
      const agents: SteeringNeighbor[] = [];
      for (let i = 0; i < 20; i += 1) {
        const angle = (i / 20) * Math.PI * 2;
        const agent = makeNeighbor([
          Math.cos(angle) * 10,
          Math.sin(angle) * 10,
          0,
        ]);
        agents.push(agent);
        hash.insert(
          i,
          agent.position.x,
          agent.position.y,
          agent.position.z,
          agent,
        );
      }

      const lists: number[][] = [];
      const scratch: SteeringNeighbor[] = [];
      for (let i = 0; i < agents.length; i += 1) {
        const agent = agents[i];
        hash.query(
          agent.position.x,
          agent.position.y,
          agent.position.z,
          6,
          scratch,
          i,
        );
        lists.push(scratch.map((neighbor) => agents.indexOf(neighbor)));
      }
      return lists;
    }

    const first = run();
    const second = run();
    expect(second).toEqual(first);
  });
});

describe("SpatialHash steering integration (§12 flocking)", () => {
  it("matches brute-force separation, cohesion, and alignment", () => {
    const agents: SteeringNeighbor[] = [
      makeNeighbor([0, 0, 0], [1, 0, 0]),
      makeNeighbor([2, 0, 0], [0, 1, 0]),
      makeNeighbor([0, 3, 0], [-1, 0, 0]),
      makeNeighbor([4, 4, 0], [0, -1, 0]),
      makeNeighbor([20, 0, 0], [0, 0, 0]),
    ];
    const context = {
      position: agents[0].position,
      velocity: agents[0].velocity,
      maxSpeed: 6,
      maxAcceleration: 12,
    };
    const radius = 5;
    const bruteNeighbors = agents.slice(1).filter((neighbor) => {
      const dx = neighbor.position.x - context.position.x;
      const dy = neighbor.position.y - context.position.y;
      const dz = neighbor.position.z - context.position.z;
      return dx * dx + dy * dy + dz * dz <= radius * radius;
    });

    const hash = new SpatialHash<SteeringNeighbor>({ cellSize: radius });
    for (let i = 0; i < agents.length; i += 1) {
      const agent = agents[i];
      hash.insert(
        i,
        agent.position.x,
        agent.position.y,
        agent.position.z,
        agent,
      );
    }
    const indexed: SteeringNeighbor[] = [];
    hash.query(
      context.position.x,
      context.position.y,
      context.position.z,
      radius,
      indexed,
      0,
    );

    expect(indexed.map((neighbor) => agents.indexOf(neighbor))).toEqual(
      bruteNeighbors.map((neighbor) => agents.indexOf(neighbor)),
    );

    const bruteSep = new Vector3();
    const hashSep = new Vector3();
    const bruteCoh = new Vector3();
    const hashCoh = new Vector3();
    const bruteAli = new Vector3();
    const hashAli = new Vector3();

    separation(context, bruteNeighbors, bruteSep);
    separation(context, indexed, hashSep);
    cohesion(context, bruteNeighbors, bruteCoh);
    cohesion(context, indexed, hashCoh);
    alignment(context, bruteNeighbors, bruteAli);
    alignment(context, indexed, hashAli);

    expect(hashSep.x).toBe(bruteSep.x);
    expect(hashSep.y).toBe(bruteSep.y);
    expect(hashSep.z).toBe(bruteSep.z);
    expect(hashCoh.x).toBe(bruteCoh.x);
    expect(hashCoh.y).toBe(bruteCoh.y);
    expect(hashCoh.z).toBe(bruteCoh.z);
    expect(hashAli.x).toBe(bruteAli.x);
    expect(hashAli.y).toBe(bruteAli.y);
    expect(hashAli.z).toBe(bruteAli.z);
  });
});
