import { describe, expect, it } from "vitest";

import {
  MAX_TEXTURE_SKINNING_JOINTS,
  SKIN_PALETTE_FLOATS_PER_ROW,
  SKIN_PALETTE_JOINTS_PER_ROW,
  SKIN_PALETTE_TEXELS_PER_JOINT,
  SKIN_PALETTE_TEXTURE_FORMAT,
  SKIN_PALETTE_TEXTURE_WIDTH,
  skinPaletteRows,
  stageSkinPalette,
} from "../src/index.js";

describe("bone-texture palette layout", () => {
  it("declares the normative constants", () => {
    expect(SKIN_PALETTE_TEXTURE_FORMAT).toBe("rgba32float");
    expect(SKIN_PALETTE_TEXTURE_WIDTH).toBe(2048);
    expect(SKIN_PALETTE_TEXELS_PER_JOINT).toBe(4);
    expect(SKIN_PALETTE_JOINTS_PER_ROW).toBe(512);
    expect(SKIN_PALETTE_FLOATS_PER_ROW).toBe(8192);
    expect(MAX_TEXTURE_SKINNING_JOINTS).toBe(65535);
  });

  it("sizes rows by joint count, never below one", () => {
    expect(skinPaletteRows(0)).toBe(1);
    expect(skinPaletteRows(1)).toBe(1);
    expect(skinPaletteRows(512)).toBe(1);
    expect(skinPaletteRows(513)).toBe(2);
    expect(skinPaletteRows(65535)).toBe(128);
  });

  it("stages the palette bytes unchanged and zero-pads the row", () => {
    const palette = new Float32Array(32).map((_, i) => i + 1);
    const out = new Float32Array(SKIN_PALETTE_FLOATS_PER_ROW).fill(9);
    stageSkinPalette(palette, out);
    expect(Array.from(out.subarray(0, 32))).toEqual(Array.from(palette));
    expect(out.subarray(32).every((v) => v === 0)).toBe(true);
    // joint 1, column 2 is texel 4 * 1 + 2 = 6 -> floats 24..27.
    expect(Array.from(out.subarray(24, 28))).toEqual([25, 26, 27, 28]);
  });

  it("truncates a palette longer than the staging array", () => {
    const palette = new Float32Array(16).fill(3);
    const out = new Float32Array(8);
    stageSkinPalette(palette, out);
    expect(Array.from(out)).toEqual(new Array(8).fill(3));
  });
});
