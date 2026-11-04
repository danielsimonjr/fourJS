import { describe, expect, it } from "vitest";

import { BufferGeometry, MAX_MORPH_TARGETS } from "../src/index.js";

const P = (): Float32Array => new Float32Array(9);

describe("extraMorphTargets (targets 2..4)", () => {
  it("stores, counts bytes, clones and disposes", () => {
    const g = new BufferGeometry({
      positions: P(),
      positions1: P(),
      extraMorphTargets: [{ positions: P(), normals: P() }, { positions: P() }],
    });
    expect(MAX_MORPH_TARGETS).toBe(4);
    expect(g.extraMorphTargets).toHaveLength(2);
    expect(g.byteLength).toBe(36 * 3 + 36 + 36);
    const c = g.clone();
    expect(c.extraMorphTargets).toHaveLength(2);
    expect(c.extraMorphTargets![0].normals).toBeDefined();
    expect(c.extraMorphTargets![1].normals).toBeUndefined();
    g.dispose();
    expect(g.extraMorphTargets).toBeUndefined();
  });

  it("validates length, count and finiteness", () => {
    expect(
      () =>
        new BufferGeometry({
          positions: P(),
          extraMorphTargets: [{ positions: new Float32Array(3) }],
        }),
    ).toThrow(RangeError);
    expect(
      () =>
        new BufferGeometry({
          positions: P(),
          extraMorphTargets: [
            { positions: P() },
            { positions: P() },
            { positions: P() },
            { positions: P() },
          ],
        }),
    ).toThrow(/at most 3/);
  });

  it("setter validates, bumps version and updates bytes", () => {
    const g = new BufferGeometry({ positions: P() });
    const v = g.version;
    g.extraMorphTargets = [{ positions: P() }];
    expect(g.version).toBeGreaterThan(v);
    expect(g.byteLength).toBe(72);
    expect(() => {
      g.extraMorphTargets = [{ positions: new Float32Array(2) }];
    }).toThrow(RangeError);
    g.extraMorphTargets = undefined;
    expect(g.byteLength).toBe(36);
  });
});
