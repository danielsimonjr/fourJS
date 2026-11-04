import { describe, expect, it } from "vitest";

import { BufferGeometry, CpuSkinning } from "../src/index.js";

function source(normals = true): BufferGeometry {
  return new BufferGeometry({
    indices: new Uint16Array([0, 0, 0]),
    positions: new Float32Array([1, 2, 3]),
    normals: normals ? new Float32Array([1, 1, 0]) : undefined,
    joints: new Uint16Array([0, 1, 0, 0]),
    weights: new Float32Array([0.25, 0.75, 0, 0]),
  });
}
function palette(): Float32Array {
  return new Float32Array([
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0,
    0, 1, 0, 4, 8, 12, 1,
  ]);
}

describe("CPU skinning", () => {
  it("blends in joint order, preserves bind data, reuses output, updates bounds", () => {
    const bind = source();
    const skin = new CpuSkinning(bind);
    const result = skin.update(palette());
    expect(Array.from(result.positions)).toEqual([4, 8, 12]);
    expect(Array.from(bind.positions)).toEqual([1, 2, 3]);
    expect(result.joints).toBeUndefined();
    expect(result.weights).toBeUndefined();
    result.computeBounds();
    const version = result.version;
    const pose = palette();
    pose[28] = 8;
    expect(skin.update(pose)).toBe(result);
    expect(result.positions[0]).toBe(7);
    expect(result.version).toBeGreaterThan(version);
    result.computeBounds();
    expect(result.bounds.min.x).toBe(7);
    skin.dispose();
    skin.dispose();
    expect(bind.disposed).toBe(false);
    expect(() => skin.update(pose)).toThrow(TypeError);
  });

  it("inverse-transposes and normalizes normals under nonuniform and reflected scale", () => {
    const bind = source();
    bind.weights!.set([1, 0, 0, 0]);
    const skin = new CpuSkinning(bind);
    const pose = palette();
    pose[0] = -2;
    skin.update(pose);
    expect(skin.geometry.normals![0]).toBeCloseTo(-1 / Math.sqrt(5));
    expect(skin.geometry.normals![1]).toBeCloseTo(2 / Math.sqrt(5));
    pose.fill(0);
    skin.update(pose);
    expect(Array.from(skin.geometry.normals!)).toEqual([0, 0, 0]);
  });

  it("works without normals and does not normalize authored weights", () => {
    const bind = source(false);
    bind.weights!.set([2, 0, 0, 0]);
    const skin = new CpuSkinning(bind);
    skin.update(palette());
    expect(Array.from(skin.geometry.positions)).toEqual([2, 4, 6]);
    expect(skin.geometry.normals).toBeUndefined();
  });

  it("has a fixed same-runtime 600-step byte golden and never accumulates deformation", () => {
    const skin = new CpuSkinning(source());
    const pose = palette();
    let hash = 2166136261;
    for (let step = 0; step < 600; step += 1) {
      pose[28] = step / 8;
      skin.update(pose);
      for (const byte of new Uint8Array(skin.geometry.positions.buffer)) {
        hash = Math.imul(hash ^ byte, 16777619) >>> 0;
      }
    }
    expect(hash).toBe(2239294215); // independently derived from [1 + 3*step/32, 8, 12]
  });

  it("refuses missing, changed and disposed source layouts", () => {
    expect(
      () =>
        new CpuSkinning(
          new BufferGeometry({
            indices: new Uint16Array([0, 0, 0]),
            positions: new Float32Array(3),
          }),
        ),
    ).toThrow(TypeError);
    const bind = source();
    const skin = new CpuSkinning(bind);
    bind.normals = undefined;
    expect(() => skin.update(palette())).toThrow(TypeError);
    bind.normals = new Float32Array(3);
    bind.joints = undefined;
    expect(() => skin.update(palette())).toThrow(TypeError);
    bind.dispose();
    expect(() => skin.update(palette())).toThrow(TypeError);
  });

  it("rejects invalid palettes and mutated weights before output changes", () => {
    const bind = source();
    const skin = new CpuSkinning(bind);
    for (const pose of [
      new Float32Array(),
      new Float32Array(17),
      palette().fill(NaN),
      new Float32Array(16),
    ]) {
      expect(() => skin.update(pose)).toThrow(TypeError);
    }
    bind.weights![3] = Infinity;
    expect(() => skin.update(palette())).toThrow(TypeError);
    expect(Array.from(skin.geometry.positions)).toEqual([1, 2, 3]);
  });
});

describe("CPU skinning skip-when-unchanged", () => {
  it("returns early for an identical palette without bumping version", () => {
    const skin = new CpuSkinning(source());
    const out = skin.update(palette());
    const version = out.version;
    out.positions[0] = 99; // sentinel: a re-skin would overwrite it
    expect(skin.update(palette())).toBe(out);
    expect(out.version).toBe(version);
    expect(out.positions[0]).toBe(99);
  });

  it("re-skins when one palette element changes", () => {
    const skin = new CpuSkinning(source());
    const out = skin.update(palette());
    const version = out.version;
    const pose = palette();
    pose[31] = 1;
    pose[29] = 9;
    skin.update(pose);
    expect(out.version).toBeGreaterThan(version);
    expect(out.positions[1]).not.toBe(8);
  });

  it("re-skins when the source is marked dirty (bind data edit)", () => {
    const bind = source();
    const skin = new CpuSkinning(bind);
    const out = skin.update(palette());
    const version = out.version;
    bind.positions[0] = 5;
    bind.markDirty();
    skin.update(palette());
    expect(out.version).toBeGreaterThan(version);
    expect(out.positions[0]).toBe(8);
  });

  it("re-skins when a consumer edited the output and marked it dirty", () => {
    const skin = new CpuSkinning(source());
    const out = skin.update(palette());
    const skinned = out.positions[0];
    out.positions[0] = 123;
    out.markDirty();
    skin.update(palette());
    expect(out.positions[0]).toBe(skinned);
  });

  it("re-skins when the palette length changes", () => {
    const skin = new CpuSkinning(source());
    const out = skin.update(palette());
    const version = out.version;
    const longer = new Float32Array(48);
    longer.set(palette());
    skin.update(longer);
    expect(out.version).toBeGreaterThan(version);
  });
});
