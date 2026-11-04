import { describe, expect, it } from "vitest";

import { Texture, compressedLevelBytes } from "../src/index.js";
import type { TextureSource } from "../src/index.js";

const level = (n: number): Uint8Array => new Uint8Array(n);
const base = (extra: Partial<TextureSource> = {}): TextureSource => ({
  width: 8,
  height: 8,
  format: "bc7-rgba-unorm",
  levels: [level(64), level(16)],
  ...extra,
});

describe("compressed texture sources (§77, R-30c)", () => {
  it("computes block-aligned level sizes", () => {
    expect(compressedLevelBytes(8, 8)).toBe(64);
    expect(compressedLevelBytes(2, 1)).toBe(16);
    expect(compressedLevelBytes(5, 5)).toBe(64);
  });

  it("accepts a chain and exposes format, levels, bytes and mip state", () => {
    const t = new Texture(base({ minFilter: "linear-mipmap-linear" }));
    expect(t.format).toBe("bc7-rgba-unorm");
    expect(t.levels).toHaveLength(2);
    expect(t.byteLength).toBe(80);
    expect(t.mipmaps).toBe(true);
    expect(t.data).toBeNull();
    t.dispose();
    const single = new Texture(base({ levels: [level(64)] }));
    expect(single.mipmaps).toBe(false);
    single.dispose();
  });

  it("defaults to rgba8unorm with no levels", () => {
    const t = new Texture({ width: 1, height: 1 });
    expect(t.format).toBe("rgba8unorm");
    expect(t.levels).toBeNull();
    t.dispose();
  });

  it("refuses inconsistent sources (§85)", () => {
    const bad = (extra: Partial<TextureSource>): void =>
      expect(() => new Texture(base(extra))).toThrow(RangeError);
    bad({ format: "bc9" as never });
    bad({ dimension: "cube" });
    bad({ depth: 2 });
    bad({ data: new Uint8Array(256) });
    bad({ mipmaps: true });
    bad({ width: 6 });
    bad({ height: 6 });
    bad({ levels: undefined });
    bad({ levels: [] });
    bad({ levels: [level(64), level(16), level(16), level(16), level(16)] });
    bad({ levels: [level(64), level(15)] });
    expect(
      () => new Texture({ width: 4, height: 4, levels: [level(16)] }),
    ).toThrow(RangeError);
    expect(
      () =>
        new Texture(
          base({ minFilter: "linear-mipmap-linear", levels: [level(64)] }),
        ),
    ).toThrow(RangeError);
  });
});
