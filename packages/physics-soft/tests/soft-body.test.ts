import { FourError } from "@fourjs/core";
import { Group } from "@fourjs/scene";
import { describe, expect, it } from "vitest";

import * as api from "../src/index.js";
import { SoftBody, type SoftBodyDescriptor } from "../src/index.js";

const rope: SoftBodyDescriptor = { kind: "rope", segments: 5, length: 2 };
const cloth: SoftBodyDescriptor = {
  kind: "cloth",
  columns: 3,
  rows: 2,
  width: 1,
  height: 1,
  pinned: [0, 2],
};
const tetra: SoftBodyDescriptor = {
  kind: "pressure",
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
  indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
  pressure: 1.2,
};

function bad(d: SoftBodyDescriptor): void {
  expect(() => new SoftBody(d)).toThrow(FourError);
}

describe("SoftBody component", () => {
  it("attaches, replaces and detaches like RigidBody (one per node)", () => {
    const node = new Group();
    const a = node.addComponent(new SoftBody(rope));
    expect(a.host).toBe(node);
    expect(node.getComponent(SoftBody)).toBe(a);
    const b = node.addComponent(new SoftBody(cloth));
    expect(node.getComponent(SoftBody)).toBe(b);
    expect(node.removeComponent(b)).toBe(true);
    expect(b.host).toBeNull();
    expect(node.getComponent(SoftBody)).toBeUndefined();
  });

  it("exposes a dynamic geometry sized to the particles", () => {
    const r = new SoftBody(rope);
    expect(r.particleCount).toBe(5);
    expect(r.geometry.positions.length).toBe(15);
    expect(new SoftBody(cloth).particleCount).toBe(6);
    const p = new SoftBody(tetra);
    expect(p.particleCount).toBe(4);
    expect(p.geometry.indices?.length).toBe(12);
    const v = r.geometry.version;
    r.geometry.markDirty();
    expect(r.geometry.version).toBe(v + 1);
    r.dispose();
  });

  it("validates tuning", () => {
    bad({ ...rope, substeps: 0 });
    bad({ ...rope, iterations: 1.5 });
    bad({ ...rope, stiffness: 2 });
    bad({ ...rope, bendingStiffness: -1 });
    bad({ ...rope, damping: -1 });
    bad({ ...rope, mass: 0 });
    expect(
      () => new SoftBody({ ...rope, substeps: 2, damping: 0 }),
    ).not.toThrow();
  });

  it("validates descriptors", () => {
    bad({ kind: "rope", segments: 1, length: 1 });
    bad({ kind: "rope", segments: 3, length: Number.NaN });
    bad({ ...(cloth as object), columns: 1 } as SoftBodyDescriptor);
    bad({ ...(cloth as object), pinned: [6] } as unknown as SoftBodyDescriptor);
    bad({ ...(cloth as object), width: 0 } as SoftBodyDescriptor);
    bad({ ...tetra, positions: new Float32Array(6) });
    bad({ ...tetra, indices: new Uint32Array(4) });
    bad({ ...tetra, pressure: 0 });
    expect(() => new SoftBody({ ...tetra, pressure: undefined })).not.toThrow();
  });
});

describe("exported surface", () => {
  it("is stable", () => {
    expect(Object.keys(api).sort()).toEqual([
      "PACKAGE_NAME",
      "PRIORITY_SOFT_BODY",
      "SoftBody",
      "SoftBodySystem",
    ]);
  });
});
