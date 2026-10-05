import { describe, expect, it } from "vitest";

import {
  IdentityShapingEngine,
  buildGlyphAtlas,
  canBreakAfter,
  canBreakBefore,
  layoutText,
  wrapToWidth,
} from "../src/index.js";

const atlas = buildGlyphAtlas();

describe("UAX #14-lite opportunities", () => {
  it("breaks after spaces and hyphens, not after letters or NBSP", () => {
    expect(canBreakAfter(0x20)).toBe(true);
    expect(canBreakAfter(0x2d)).toBe(true);
    expect(canBreakAfter(0x61)).toBe(false);
    expect(canBreakAfter(0xa0)).toBe(false);
  });

  it("breaks before and after CJK ideographs", () => {
    expect(canBreakAfter(0x4e00)).toBe(true);
    expect(canBreakBefore(0x4e00)).toBe(true);
    expect(canBreakBefore(0x61)).toBe(false);
  });
});

describe("layoutText wrapWidth", () => {
  it("is bit-identical to the unwrapped walk when wrapWidth is omitted", () => {
    const options = { size: 12, letterSpacing: 1, align: "center" as const };
    expect(layoutText("Motor\n42 C", atlas, options)).toEqual(
      layoutText("Motor\n42 C", atlas, { ...options, wrapWidth: undefined }),
    );
  });

  it("treats Infinity as no wrap", () => {
    const a = layoutText("hello world", atlas, { size: 12 });
    const b = layoutText("hello world", atlas, {
      size: 12,
      wrapWidth: Number.POSITIVE_INFINITY,
    });
    expect(b).toEqual(a);
    expect(a.lineCount).toBe(1);
  });

  it("wraps after a breaking space inside the measure", () => {
    // Built-in cell is 6 px; size 12 → 6 world units per glyph.
    const layout = layoutText("hello world", atlas, {
      size: 12,
      wrapWidth: 36,
    });
    expect(layout.lineCount).toBe(2);
    expect(layout.width).toBe(36); // "hello " is six cells
    expect(layout.height).toBe(24);
  });

  it("emergency-breaks an unbreakable run wider than the measure", () => {
    const layout = layoutText("abcd", atlas, { size: 12, wrapWidth: 12 });
    expect(layout.lineCount).toBe(2);
    expect(layout.width).toBe(12);
  });

  it("keeps explicit newlines as mandatory breaks", () => {
    const layout = layoutText("ab\ncd", atlas, { size: 12, wrapWidth: 100 });
    expect(layout.lineCount).toBe(2);
    expect(layout.width).toBe(12);
  });

  it("refuses a non-positive wrapWidth", () => {
    expect(() => layoutText("a", atlas, { size: 12, wrapWidth: 0 })).toThrow(
      /wrapWidth must be a positive finite measure/,
    );
  });

  it("matches identity shaping when wrapping", () => {
    const shaper = new IdentityShapingEngine();
    const fontId = shaper.addFont(new Uint8Array());
    const options = { size: 12, wrapWidth: 36 };
    expect(
      layoutText("hello world", atlas, { ...options, shaper, fontId }).lineCount,
    ).toBe(layoutText("hello world", atlas, options).lineCount);
    shaper.dispose();
  });
});

describe("wrapToWidth", () => {
  it("leaves a single overflowing item on its own line", () => {
    expect(
      wrapToWidth([{ advance: 10, breakAfter: false, breakBefore: false }], 3, 0),
    ).toEqual([[{ advance: 10, breakAfter: false, breakBefore: false }]]);
  });
});
