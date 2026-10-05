import { describe, expect, it } from "vitest";

import {
  IdentityShapingEngine,
  buildGlyphAtlas,
  canBreakAfter,
  canBreakBefore,
  layoutText,
  wrapToWidth,
  type ShapingEngine,
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
      layoutText("hello world", atlas, { ...options, shaper, fontId })
        .lineCount,
    ).toBe(layoutText("hello world", atlas, options).lineCount);
    shaper.dispose();
  });

  it("wraps CJK between characters and skips a carriage return", () => {
    const layout = layoutText("中文\r字", atlas, { size: 12, wrapWidth: 12 });
    expect(layout.lineCount).toBeGreaterThan(1);
  });

  it("centers wrapped lines and treats an empty string as no quads", () => {
    const wrapped = layoutText("hello world", atlas, {
      size: 12,
      wrapWidth: 36,
      align: "center",
    });
    expect(wrapped.lineCount).toBe(2);
    expect(
      layoutText("hello world", atlas, {
        size: 12,
        wrapWidth: 36,
        align: "right",
      }).lineCount,
    ).toBe(2);
    expect(layoutText("", atlas, { size: 12, wrapWidth: 10 }).lineCount).toBe(
      0,
    );
    expect(
      layoutText("ab\n\ncd", atlas, { size: 12, wrapWidth: 100 }).lineCount,
    ).toBe(3);
  });

  it("refuses NaN", () => {
    expect(() =>
      layoutText("a", atlas, { size: 12, wrapWidth: Number.NaN }),
    ).toThrow(/wrapWidth/);
  });

  it("wraps a shaped run, including rtl offsets and right alignment", () => {
    const shaper: ShapingEngine = {
      name: "fake",
      version: "0",
      addFont: () => "font",
      removeFont: () => undefined,
      dispose: () => undefined,
      shape: () => [
        {
          script: "Latn",
          direction: "rtl",
          glyphs: [
            {
              glyphId: 1,
              cluster: 0,
              advanceX: 6000,
              advanceY: 0,
              offsetX: 20,
              offsetY: 10,
            },
            {
              glyphId: 2,
              cluster: 1,
              advanceX: 6000,
              advanceY: 0,
              offsetX: 0,
              offsetY: 0,
            },
          ],
        },
      ],
    };
    const layout = layoutText("ab", atlas, {
      size: 12,
      wrapWidth: 4,
      align: "right",
      letterSpacing: 1,
      shaper,
      fontId: "font",
    });
    expect(layout.lineCount).toBeGreaterThan(0);
    expect(
      layoutText("ab", atlas, {
        size: 12,
        wrapWidth: 1000,
        align: "center",
        shaper,
        fontId: "font",
      }).lineCount,
    ).toBe(1);
    const emptyShaped: ShapingEngine = {
      ...shaper,
      shape: () => [{ script: "Latn", direction: "ltr", glyphs: [] }],
    };
    expect(
      layoutText("\n", atlas, {
        size: 12,
        wrapWidth: 10,
        shaper: emptyShaped,
        fontId: "font",
      }).lineCount,
    ).toBe(2);
    const missing: ShapingEngine = {
      ...shaper,
      shape: () => [
        {
          script: "Latn",
          direction: "ltr",
          glyphs: [
            {
              glyphId: 1,
              cluster: 99,
              advanceX: 100,
              advanceY: 0,
              offsetX: 0,
              offsetY: 0,
            },
          ],
        },
      ],
    };
    expect(
      layoutText("a", atlas, {
        size: 12,
        wrapWidth: 100,
        shaper: missing,
        fontId: "font",
      }).lineCount,
    ).toBe(1);
  });
});

describe("wrapToWidth", () => {
  it("leaves a single overflowing item on its own line", () => {
    expect(
      wrapToWidth(
        [{ advance: 10, breakAfter: false, breakBefore: false }],
        3,
        0,
      ),
    ).toEqual([[{ advance: 10, breakAfter: false, breakBefore: false }]]);
  });

  it("returns no lines for an empty list", () => {
    expect(wrapToWidth([], 10, 1)).toEqual([]);
  });

  it("breaks before a CJK item and remeasures the leftover with spacing", () => {
    const a = { advance: 4, breakAfter: true, breakBefore: false };
    const b = { advance: 4, breakAfter: false, breakBefore: false };
    const c = { advance: 4, breakAfter: false, breakBefore: true };
    expect(wrapToWidth([a, b, c], 9, 1)).toEqual([[a, b], [c]]);
    const keep = { advance: 3, breakAfter: true, breakBefore: false };
    const mid = { advance: 3, breakAfter: false, breakBefore: false };
    const tail = { advance: 3, breakAfter: false, breakBefore: false };
    const next = { advance: 1, breakAfter: false, breakBefore: false };
    expect(wrapToWidth([keep, mid, tail, next], 9, 1)).toEqual([
      [keep],
      [mid, tail, next],
    ]);
  });
});
