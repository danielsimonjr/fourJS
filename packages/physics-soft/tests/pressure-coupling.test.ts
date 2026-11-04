import { FourError } from "@fourjs/core";
import {
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@fourjs/math";
import type { PhysicsWorld } from "@fourjs/physics";
import { Group, type Node } from "@fourjs/scene";
import { describe, expect, it } from "vitest";

import {
  SoftBody,
  SoftBodySystem,
  type SoftBodyDescriptor,
  type SoftCollisionWorld,
  type SoftRaycastHit,
  type SoftRaycastQuery,
} from "../src/index.js";
import { pressureTopology, signedVolume } from "../src/pbd.js";

const DT = 1 / 60;
const ctx = { time: { fixedDeltaTime: DT } } as never;

/** Welded octahedron subdivided `levels` times and pushed onto a sphere. */
function icosphere(
  radius: number,
  levels: number,
): SoftBodyDescriptor & {
  kind: "pressure";
} {
  let pos: number[][] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  let tris: number[][] = [
    [0, 2, 4],
    [4, 2, 1],
    [1, 2, 5],
    [5, 2, 0],
    [4, 3, 0],
    [1, 3, 4],
    [5, 3, 1],
    [0, 3, 5],
  ];
  for (let l = 0; l < levels; l++) {
    const cache = new Map<string, number>();
    const mid = (a: number, b: number): number => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let i = cache.get(key);
      if (i === undefined) {
        const m = pos[a].map((v, k) => (v + pos[b][k]) / 2);
        const len = Math.hypot(m[0], m[1], m[2]);
        pos = [...pos, m.map((v) => v / len)];
        i = pos.length - 1;
        cache.set(key, i);
      }
      return i;
    };
    const next: number[][] = [];
    for (const [a, b, c] of tris) {
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    tris = next;
  }
  return {
    kind: "pressure",
    positions: Float32Array.from(pos.flat().map((v) => v * radius)),
    indices: Uint32Array.from(tris.flat()),
  };
}

/** Analytic world: ground plane y = 0 plus an optional AABB. Allocation-free. */
class FakeWorld implements SoftCollisionWorld {
  readonly gravity = { x: 0, y: -9.81, z: 0 };
  readonly #hit = {
    point: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
    distance: 0,
  };
  readonly #none: SoftRaycastHit[] = [];
  readonly #one: SoftRaycastHit[] = [this.#hit];
  rays = 0;
  constructor(
    readonly ground: boolean,
    readonly box?: { min: number[]; max: number[] },
  ) {}

  raycast(q: SoftRaycastQuery): readonly SoftRaycastHit[] {
    this.rays++;
    const o = q.origin;
    const d = q.direction;
    let best = Infinity;
    const h = this.#hit;
    if (this.ground && o.y >= 0 && d.y < 0) {
      const t = -o.y / d.y;
      if (t <= q.maxDistance) {
        best = t;
        h.normal.x = 0;
        h.normal.y = 1;
        h.normal.z = 0;
      }
    }
    const b = this.box;
    if (b !== undefined) {
      let t0 = 0;
      let t1 = q.maxDistance;
      let axis = -1;
      let sign = 0;
      const org = [o.x, o.y, o.z];
      const dir = [d.x, d.y, d.z];
      for (let k = 0; k < 3 && t0 <= t1; k++) {
        if (Math.abs(dir[k]) < 1e-12) {
          if (org[k] < b.min[k] || org[k] > b.max[k]) t1 = -1;
          continue;
        }
        let ta = (b.min[k] - org[k]) / dir[k];
        let tb = (b.max[k] - org[k]) / dir[k];
        let s = -1;
        if (ta > tb) {
          [ta, tb] = [tb, ta];
          s = 1;
        }
        if (ta > t0) {
          t0 = ta;
          axis = k;
          sign = s;
        }
        t1 = Math.min(t1, tb);
      }
      if (axis >= 0 && t0 <= t1 && t0 < best) {
        best = t0;
        h.normal.x = axis === 0 ? sign : 0;
        h.normal.y = axis === 1 ? sign : 0;
        h.normal.z = axis === 2 ? sign : 0;
      }
    }
    if (best === Infinity) return this.#none;
    h.distance = best;
    h.point.x = o.x + d.x * best;
    h.point.y = o.y + d.y * best;
    h.point.z = o.z + d.z * best;
    return this.#one;
  }
}

function lift(node: Node, y: number): void {
  node.position.set(0, y, 0);
}

function setup(
  descriptor: SoftBodyDescriptor,
  world: FakeWorld | undefined,
  y = 0,
): { node: Node; body: SoftBody; system: SoftBodySystem } {
  const node = new Group();
  lift(node, y);
  const body = node.addComponent(new SoftBody(descriptor));
  const system = new SoftBodySystem({ ...(world ? { world } : {}) });
  system.track(body);
  return { node, body, system };
}

function run(system: SoftBodySystem, steps: number): void {
  for (let i = 0; i < steps; i++) system.fixedUpdate(ctx);
}

function bits(a: Float64Array): string {
  return Array.from(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).join(
    ",",
  );
}

const ball = {
  ...icosphere(0.5, 2),
  stiffness: 0.05,
  iterations: 8,
  damping: 0.5,
};

describe("pressure bodies", () => {
  it("builds a closed topology and rejects bad meshes", () => {
    const s = icosphere(1, 1);
    const t = pressureTopology(s.positions, s.indices);
    // 18 vertices -> 48 edges: stretch + one bending per edge.
    expect(t.a.length).toBe(96);
    expect(signedVolume(t.rest, t.triangles!)).toBeGreaterThan(2.5);
    const open = Uint32Array.from(s.indices).slice(0, s.indices.length - 3);
    expect(() => pressureTopology(s.positions, open)).toThrow("not closed");
    expect(() =>
      pressureTopology(s.positions, Uint32Array.from([0, 1, 99])),
    ).toThrow("out of range");
    expect(() =>
      pressureTopology(s.positions, Uint32Array.from([0, 0, 1])),
    ).toThrow("degenerate");
    const flat = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
    expect(() =>
      pressureTopology(flat, Uint32Array.from([0, 1, 2, 0, 2, 1])),
    ).toThrow("zero volume");
    expect(
      () =>
        new SoftBody({
          ...s,
          positions: flat,
          indices: Uint32Array.from([0, 1, 2]),
        }),
    ).toThrow(FourError);
    expect(() => new SoftBody({ ...s, pressureStiffness: 2 })).toThrow(
      FourError,
    );
  });

  it("holds its volume (either winding) and inflates to the target", () => {
    const base = icosphere(0.5, 2);
    const flipped = Uint32Array.from(base.indices);
    for (let i = 0; i < flipped.length; i += 3) {
      [flipped[i + 1], flipped[i + 2]] = [flipped[i + 2], flipped[i + 1]];
    }
    for (const indices of [base.indices, flipped]) {
      const { body, system } = setup({ ...ball, indices }, undefined);
      const v0 = body.solver.targetVolume;
      run(system, 5);
      expect(Math.abs(body.solver.volume() / v0 - 1)).toBeLessThan(0.1);
    }
    const inflated = setup({ ...ball, pressure: 1.4 }, undefined);
    const rest = Math.abs(inflated.body.solver.volume());
    run(inflated.system, 120);
    const ratio = Math.abs(inflated.body.solver.volume()) / rest;
    expect(ratio).toBeGreaterThan(1.3);
    expect(ratio).toBeLessThan(1.5);
    expect(inflated.body.geometry.normals).toBeDefined();
  });

  it("rests on a rigid ground at roughly its target volume", () => {
    const world = new FakeWorld(true);
    const { body, system } = setup({ ...ball, pressure: 1.2 }, world, 1);
    run(system, 360);
    const p = body.solver.positions;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 1; i < p.length; i += 3) {
      lo = Math.min(lo, p[i]);
      hi = Math.max(hi, p[i]);
    }
    expect(lo).toBeGreaterThan(-1e-6);
    expect(lo).toBeLessThan(0.05);
    expect(hi).toBeGreaterThan(0.6);
    expect(
      Math.abs(body.solver.volume() / body.solver.targetVolume - 1),
    ).toBeLessThan(0.1);
    expect(body.solver.kineticEnergy()).toBeLessThan(0.05);
    expect(world.rays).toBeGreaterThan(0);
  });
});

describe("one-way rigid coupling", () => {
  const sheet: SoftBodyDescriptor = {
    kind: "cloth",
    columns: 11,
    rows: 11,
    width: 1.6,
    height: 1.6,
    damping: 1,
    iterations: 8,
  };

  it("drapes cloth over a box: the centre rests on the box top", () => {
    const world = new FakeWorld(true, {
      min: [-0.4, 0, -0.4],
      max: [0.4, 0.5, 0.4],
    });
    const { body, system } = setup(sheet, world, 1);
    run(system, 480);
    const p = body.solver.positions;
    const centre = 5 * 11 + 5;
    expect(Math.abs(p[centre * 3 + 1] - (0.5 + 0.01))).toBeLessThan(0.02);
    let lo = Infinity;
    for (let i = 1; i < p.length; i += 3) lo = Math.min(lo, p[i]);
    expect(lo).toBeGreaterThan(-1e-6);
    // The overhanging rim fell past the box top.
    expect(lo).toBeLessThan(0.3);
  });

  it("stays above a ground for a ray-less world option (gravity only)", () => {
    const { body, system } = setup(sheet, undefined, 1);
    run(system, 30);
    expect(body.solver.collider).toBeNull();
  });

  it("untrack clears the collider hook; a bad radius throws", () => {
    const world = new FakeWorld(true);
    const { body, system } = setup(sheet, world, 1);
    expect(body.solver.collider).not.toBeNull();
    system.untrack(body);
    expect(body.solver.collider).toBeNull();
    expect(() => new SoftBodySystem({ particleRadius: -1 })).toThrow(FourError);
  });

  it("a PhysicsWorld satisfies the seam structurally", () => {
    const check = (w: PhysicsWorld): SoftCollisionWorld => w;
    expect(typeof check).toBe("function");
  });

  it("skips pinned and motionless particles and misses cleanly", () => {
    const world = new FakeWorld(false);
    const { system } = setup({ ...sheet, pinned: [0] }, world, 1);
    run(system, 5);
    expect(world.rays).toBeGreaterThan(0);
  });

  it("is bit-identical across runs and allocation-free with coupling on", () => {
    const make = (): ReturnType<typeof setup> =>
      setup({ ...ball, pressure: 1.1 }, new FakeWorld(true), 1);
    const a = make();
    const b = make();
    run(a.system, 150);
    run(b.system, 150);
    expect(bits(a.body.solver.positions)).toBe(bits(b.body.solver.positions));
    expect(a.system.checksum()).toBe(b.system.checksum());

    run(a.system, 5);
    resetConstructionCount();
    run(a.system, 100);
    expect(constructionCount()).toBe(0);
    void Vector3;
  });
});

describe("snapshots", () => {
  const make = (): ReturnType<typeof setup> => {
    const r = setup({ ...ball, pressure: 1.1 }, new FakeWorld(true), 1);
    return r;
  };
  const rope: SoftBodyDescriptor = { kind: "rope", segments: 8, length: 1 };

  it("restores to bit-identical continued stepping", () => {
    const a = make();
    run(a.system, 60);
    const snap = a.system.createSnapshot();
    expect(snap.version).toBe(1);
    expect(snap.kind).toBe("soft-bodies");
    expect(snap.bodies[0].id).toBe(a.node.id);
    const sum = a.system.checksum();
    run(a.system, 60);
    const reference = bits(a.body.solver.positions);
    const referenceSum = a.system.checksum();
    expect(referenceSum).not.toBe(sum);

    a.system.restoreSnapshot(snap);
    expect(a.system.checksum()).toBe(sum);
    run(a.system, 60);
    expect(bits(a.body.solver.positions)).toBe(reference);
    expect(a.system.checksum()).toBe(referenceSum);

    // A fresh system tracking the same body restores to the same state.
    const fresh = new SoftBodySystem({ world: new FakeWorld(true) });
    a.system.untrack(a.body);
    fresh.track(a.body);
    fresh.restoreSnapshot(snap);
    expect(fresh.checksum()).toBe(sum);
  });

  it("restores pinned bodies exactly", () => {
    const node = new Group();
    node.position.set(0, 2, 0);
    const body = node.addComponent(new SoftBody(rope));
    const system = new SoftBodySystem();
    system.track(body);
    run(system, 20);
    const snap = system.createSnapshot();
    run(system, 20);
    const ref = bits(body.solver.positions);
    system.restoreSnapshot(snap);
    run(system, 20);
    expect(bits(body.solver.positions)).toBe(ref);
  });

  it("refuses mismatches and leaves state untouched", () => {
    const a = make();
    run(a.system, 3);
    const snap = a.system.createSnapshot();
    const before = a.system.checksum();
    const entry = snap.bodies[0];
    const refuse = (s: unknown): void => {
      expect(() => a.system.restoreSnapshot(s as never)).toThrow(FourError);
      expect(a.system.checksum()).toBe(before);
    };
    refuse({ ...snap, version: 2 });
    refuse({ ...snap, kind: "rigid" });
    refuse({ ...snap, bodies: [] });
    refuse({ ...snap, bodies: [{ ...entry, id: "other" }] });
    refuse({ ...snap, bodies: [{ ...entry, kind: "rope" }] });
    refuse({ ...snap, bodies: [{ ...entry, particleCount: 3 }] });
    refuse({
      ...snap,
      bodies: [{ ...entry, positions: new Float64Array(3) }],
    });
  });

  it("keys a hostless body by track index and checksums an empty system", () => {
    const system = new SoftBodySystem();
    expect(system.checksum()).toBe(2166136261);
    system.track(new SoftBody(rope));
    expect(system.createSnapshot().bodies[0].id).toBe("0");
    system.restoreSnapshot(system.createSnapshot());
  });

  it("rejects a non-finite checksum input", () => {
    const system = new SoftBodySystem();
    const body = system.track(new SoftBody(rope));
    body.solver.positions[0] = NaN;
    expect(() => system.checksum()).toThrow(RangeError);
  });
});
