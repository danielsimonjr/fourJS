import { Rectangle2 } from "@fourjs/math";
import { describe, expect, it } from "vitest";

import { Texture, textureMemoryBytes } from "../src/index.js";

describe("cube / array / 3D texture sources (§77, R-30c)", () => {
  it("accepts a cube with six faces and reports depth 6", () => {
    const t = new Texture({
      width: 2,
      height: 2,
      dimension: "cube",
      data: new Uint8Array(2 * 2 * 6 * 4),
    });
    expect(t.dimension).toBe("cube");
    expect(t.depth).toBe(6);
    expect(t.byteLength).toBe(96);
    t.dispose();
  });

  it("accepts an explicit cube depth of 6 and a 2d depth of 1", () => {
    new Texture({ width: 1, height: 1, dimension: "cube", depth: 6 }).dispose();
    expect(new Texture({ width: 1, height: 1, depth: 1 }).depth).toBe(1);
  });

  it("refuses a non-square cube and a contradicting depth", () => {
    expect(
      () => new Texture({ width: 2, height: 1, dimension: "cube" }),
    ).toThrow(/square/);
    expect(
      () => new Texture({ width: 1, height: 1, dimension: "cube", depth: 5 }),
    ).toThrow(RangeError);
    expect(() => new Texture({ width: 1, height: 1, depth: 2 })).toThrow(
      RangeError,
    );
  });

  it("requires an integer depth for array and 3d", () => {
    for (const dimension of ["array", "3d"] as const) {
      expect(() => new Texture({ width: 1, height: 1, dimension })).toThrow(
        /depth/,
      );
      expect(
        () => new Texture({ width: 1, height: 1, dimension, depth: 1.5 }),
      ).toThrow(RangeError);
      expect(
        () => new Texture({ width: 1, height: 1, dimension, depth: 0 }),
      ).toThrow(RangeError);
    }
  });

  it("refuses data whose layer count does not match", () => {
    expect(
      () =>
        new Texture({
          width: 2,
          height: 2,
          dimension: "cube",
          data: new Uint8Array(2 * 2 * 5 * 4),
        }),
    ).toThrow(/layers\/faces\/slices/);
    expect(
      () =>
        new Texture({
          width: 2,
          height: 2,
          dimension: "array",
          depth: 3,
          data: new Uint8Array(2 * 2 * 2 * 4),
        }),
    ).toThrow(RangeError);
  });

  it("bills layers, and mip chains per kind", () => {
    const before = textureMemoryBytes();
    const array = new Texture({
      width: 4,
      height: 4,
      dimension: "array",
      depth: 3,
      mipmaps: true,
    });
    // (16 + 4 + 1) texels x 3 layers x 4 bytes
    expect(array.byteLength).toBe(252);
    const volume = new Texture({
      width: 4,
      height: 4,
      dimension: "3d",
      depth: 4,
      mipmaps: true,
    });
    // 4x4x4 + 2x2x2 + 1x1x1 = 73 texels
    expect(volume.byteLength).toBe(292);
    const cube = new Texture({
      width: 4,
      height: 4,
      dimension: "cube",
      mipmaps: true,
    });
    expect(cube.byteLength).toBe(504);
    expect(textureMemoryBytes() - before).toBe(252 + 292 + 504);
    array.dispose();
    volume.dispose();
    cube.dispose();
    expect(textureMemoryBytes()).toBe(before);
  });

  it("re-bills when the source changes kind", () => {
    const t = new Texture({ width: 2, height: 2 });
    t.source = { width: 2, height: 2, dimension: "cube" };
    expect(t.byteLength).toBe(96);
    t.dispose();
  });

  it("refuses regional markDirty on a non-2d texture", () => {
    const t = new Texture({ width: 2, height: 2, dimension: "cube" });
    expect(() => t.markDirty(new Rectangle2(0, 0, 1, 1))).toThrow(/2D only/);
    t.markDirty();
    expect(t.getDirtyRegion(0)).toBeNull();
    t.dispose();
  });
});
