import { FourError } from "@fourjs/core";
import {
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@fourjs/math";
import { Node } from "@fourjs/scene";
import { describe, expect, it } from "vitest";

import { PbdSolver, computeNormals, effectiveStiffness } from "../src/pbd.js";
import {
  PRIORITY_SOFT_BODY,
  SoftBody,
  SoftBodySystem,
  type SoftBodyDescriptor,
  type SoftBodySystemOptions,
} from "../src/index.js";

const DT = 1 / 60;
const ctx = { time: { fixedDeltaTime: DT } } as never;

function setup(
  descriptor: SoftBodyDescriptor,
  options?: SoftBodySystemOptions,
  prepare?: (node: Node) => void,
): { node: Node; body: SoftBody; system: SoftBodySystem } {
  const node = new Node();
  prepare?.(node);
  const body = node.addComponent(new SoftBody(descriptor));
  const system = new SoftBodySystem(options);
  system.track(body);
  return { node, body, system };
}

function run(system: SoftBodySystem, steps: number): void {
  for (let i = 0; i < steps; i++) system.fixedUpdate(ctx);
}

function minY(p: Float64Array): number {
  let m = Infinity;
  for (let i = 1; i < p.length; i += 3) m = Math.min(m, p[i]);
  return m;
}

function ropeLength(p: Float64Array): number {
  let l = 0;
  for (let i = 3; i < p.length; i += 3) {
    l += Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2], p[i + 2] - p[i - 1]);
  }
  return l;
}

const rope: SoftBodyDescriptor = {
  kind: "rope",
  segments: 21,
  length: 2,
  damping: 1,
};
const cloth: SoftBodyDescriptor = {
  kind: "cloth",
  columns: 9,
  rows: 9,
  width: 1,
  height: 1,
  pinned: [0, 8],
  damping: 1.5,
};

/** Rotate the node 90 degrees about Z so the rope starts horizontal (along +X). */
function horizontal(node: Node): void {
  node.transform.rotation.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
}

describe("rope", () => {
  it("swings down from horizontal and settles hanging at its rest length", () => {
    const { body, system } = setup(rope, undefined, horizontal);
    const p = body.solver.positions;
    expect(minY(p)).toBeCloseTo(0, 9);
    run(system, 1800);
    expect(Math.abs(ropeLength(p) - 2) / 2).toBeLessThan(0.02);
    expect(minY(p)).toBeLessThan(-1.9);
    expect(minY(p)).toBeGreaterThan(-2.05);
    expect(body.solver.kineticEnergy()).toBeLessThan(1e-4);
    // Pinned end never moved.
    expect(p[0]).toBeCloseTo(0, 12);
    expect(p[1]).toBeCloseTo(0, 12);
  });
});

describe("cloth", () => {
  it("settles below its pins and the energy decays with damping", () => {
    const { body, system } = setup(cloth);
    const s = body.solver;
    expect(minY(s.positions)).toBe(0);
    let peak = 0;
    for (let i = 0; i < 90; i++) {
      system.fixedUpdate(ctx);
      peak = Math.max(peak, s.kineticEnergy());
    }
    expect(peak).toBeGreaterThan(0);
    run(system, 1800);
    expect(minY(s.positions)).toBeLessThan(-0.2);
    expect(s.kineticEnergy()).toBeLessThan(peak * 1e-3);
    // Pins stayed at y = 0.
    expect(s.positions[1]).toBe(0);
    expect(s.positions[8 * 3 + 1]).toBe(0);
  });

  it("recomputes unit normals each step", () => {
    const { body, system } = setup(cloth);
    const n = body.geometry.normals!;
    expect(n[1]).toBeCloseTo(1, 6);
    run(system, 120);
    for (let i = 0; i < n.length; i += 3) {
      expect(Math.hypot(n[i], n[i + 1], n[i + 2])).toBeCloseTo(1, 5);
    }
    expect(n[(4 * 9 + 4) * 3 + 1]).toBeGreaterThan(0.3);
  });
});

describe("determinism and allocation", () => {
  it("two identical runs are bit-identical", () => {
    const a = setup(cloth);
    const b = setup(cloth);
    run(a.system, 200);
    run(b.system, 200);
    const bytes = (x: Float64Array): string =>
      Buffer.from(x.buffer, x.byteOffset, x.byteLength).toString("hex");
    expect(bytes(a.body.solver.positions)).toBe(bytes(b.body.solver.positions));
    expect(bytes(a.body.solver.velocities)).toBe(
      bytes(b.body.solver.velocities),
    );
    expect(Array.from(a.body.geometry.positions)).toEqual(
      Array.from(b.body.geometry.positions),
    );
  });

  it("allocates nothing per step after warm-up", () => {
    const { body, system } = setup(cloth);
    const s = body.solver;
    run(system, 5);
    const refs = [
      s.positions,
      s.previous,
      s.velocities,
      s.inverseMasses,
      body.geometry.positions,
      body.geometry.normals,
    ];
    resetConstructionCount();
    run(system, 100);
    expect(constructionCount()).toBe(0);
    expect([
      s.positions,
      s.previous,
      s.velocities,
      s.inverseMasses,
      body.geometry.positions,
      body.geometry.normals,
    ]).toEqual(refs);
    refs.forEach((r, i) => {
      const now = [
        s.positions,
        s.previous,
        s.velocities,
        s.inverseMasses,
        body.geometry.positions,
        body.geometry.normals,
      ][i];
      expect(now).toBe(r);
    });
  });
});

describe("stepping contract", () => {
  it("bumps the geometry version once per fixed step", () => {
    const { body, system } = setup(rope);
    const v = body.geometry.version;
    run(system, 7);
    expect(body.geometry.version).toBe(v + 7);
  });

  it("runs substeps x iterations and uses substep dt = fixedDelta / substeps", () => {
    const { body, system } = setup({
      kind: "cloth",
      columns: 3,
      rows: 3,
      width: 1,
      height: 1,
      substeps: 3,
      iterations: 5,
      damping: 0,
    });
    run(system, 2);
    expect(body.solver.substepsRun).toBe(6);
    expect(body.solver.iterationsRun).toBe(30);
    // Free fall (no pins): after 1 s total, drop is ~ g t^2 / 2.
    const free = setup({ ...cloth, pinned: [], damping: 0, substeps: 4 });
    run(free.system, 60);
    const y = free.body.solver.positions[1];
    expect(Math.abs(y + 0.5 * 9.81)).toBeLessThan(0.5 * 9.81 * 0.02);
  });

  it("converts stiffness to be iteration independent", () => {
    expect(effectiveStiffness(1, 4)).toBe(1);
    expect(effectiveStiffness(0, 4)).toBe(0);
    expect(1 - Math.pow(1 - effectiveStiffness(0.5, 4), 4)).toBeCloseTo(
      0.5,
      12,
    );
  });

  it("takes gravity from a world or an option, live", () => {
    const free: SoftBodyDescriptor = { ...cloth, pinned: [], damping: 0 };
    const g = { x: 0, y: -9.81, z: 0 };
    const world = { gravity: g };
    const a = setup(free, { world });
    run(a.system, 30);
    g.y = 0;
    g.z = -9.81;
    const vy = a.body.solver.velocities[1];
    run(a.system, 30);
    expect(a.body.solver.velocities[1]).toBeCloseTo(vy, 6);
    expect(a.body.solver.velocities[2]).toBeLessThan(-4);
    const b = setup(free, { gravity: { x: 3, y: 0, z: 0 }, priority: 5 });
    expect(b.system.priority).toBe(5);
    run(b.system, 30);
    expect(b.body.solver.velocities[0]).toBeGreaterThan(1);
  });

  it("makes pinned particles follow a moved node, geometry staying node-local", () => {
    const { node, body, system } = setup(cloth);
    node.transform.position.set(3, 1, 0);
    run(system, 30);
    const p = body.solver.positions;
    expect(p[0]).toBeCloseTo(3 - 0.5, 9);
    expect(p[1]).toBeCloseTo(1, 9);
    expect(p[8 * 3]).toBeCloseTo(3 + 0.5, 9);
    const g = body.geometry.positions;
    expect(g[0]).toBeCloseTo(-0.5, 5);
    expect(g[1]).toBeCloseTo(0, 5);
  });

  it("uses an identity frame for a body without a node", () => {
    const body = new SoftBody(rope);
    const system = new SoftBodySystem();
    system.track(body);
    run(system, 10);
    expect(body.solver.positions[1]).toBe(0);
  });

  it("skips constraints between two pinned particles and coincident ones", () => {
    const { body, system } = setup({
      kind: "rope",
      segments: 2,
      length: 1,
      pinned: [0, 1],
    });
    run(system, 3);
    expect(body.solver.positions[4]).toBeCloseTo(-1, 12);
    const solver = new PbdSolver(
      {
        rest: new Float64Array(6),
        a: Uint32Array.of(0),
        b: Uint32Array.of(1),
        length: Float64Array.of(1),
        stretch: Uint8Array.of(1),
        pinned: new Uint32Array(0),
      },
      {
        substeps: 1,
        iterations: 1,
        stiffness: 1,
        bendingStiffness: 1,
        damping: 0,
        mass: 1,
      },
    );
    solver.step(DT, 0, 0, 0, new Node().transform.worldMatrix.elements);
    expect(solver.positions[0]).toBe(0);
  });

  it("computes a fallback normal for degenerate triangles", () => {
    const n = new Float32Array(9);
    computeNormals(new Float32Array(9), [0, 1, 2], n);
    expect(Array.from(n)).toEqual([0, 1, 0, 0, 1, 0, 0, 1, 0]);
  });
});

describe("SoftBodySystem registry", () => {
  it("sits just after the rigid solve", () => {
    expect(new SoftBodySystem().priority).toBe(PRIORITY_SOFT_BODY);
    expect(PRIORITY_SOFT_BODY).toBe(610);
  });

  it("tracks in order, rejects duplicates, untracks and disposes", () => {
    const system = new SoftBodySystem();
    system.initialize({} as never);
    const a = new SoftBody(rope);
    const b = new SoftBody(cloth);
    system.track(a);
    system.track(b);
    expect(system.bodies).toEqual([a, b]);
    expect(() => system.track(a)).toThrow(FourError);
    expect(system.untrack(a)).toBe(true);
    expect(system.untrack(a)).toBe(false);
    system.dispose();
    expect(system.bodies).toHaveLength(0);
  });

  it("validates rope pins", () => {
    expect(
      () => new SoftBody({ kind: "rope", segments: 3, length: 1, pinned: [3] }),
    ).toThrow(FourError);
  });
});
