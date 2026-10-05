import { IdentityShapingEngine, type ShapeQuery } from "@fourjs/text";
/**
 * `Label` (§73, §74's intrinsic text size, §56's MVP text tier).
 *
 * The measurements are checked against the built-in 6 × 12 face's own metrics
 * (`cellWidth = 6`, `lineHeight = 12`, `ascent = 8`), so a change in either
 * `@fourjs/text` or this package's arithmetic shows up here rather than in a
 * screenshot.
 */

import { buildGlyphAtlas } from "@fourjs/text";
import { describe, expect, it } from "vitest";

import { Label } from "../src/label.js";
import { Panel } from "../src/panel.js";

const atlas = buildGlyphAtlas();

describe("Label", () => {
  it("defaults to empty, non-interactive, and unmeasurable", () => {
    const label = new Label();
    expect(label.text).toBe("");
    expect(label.atlas).toBeNull();
    expect(label.size).toBe(1);
    expect(label.letterSpacing).toBe(0);
    expect(label.textLayout).toBeNull();
    expect(label.textBaselineTop).toBe(0);
    // A label inside a button must not steal the button's hit (§72).
    expect(label.interactive).toBe(false);

    label.measure();
    expect(label.measuredWidth).toBe(0);
    expect(label.measuredHeight).toBe(0);
  });

  it("honours an explicit interactive option", () => {
    expect(new Label({ interactive: true }).interactive).toBe(true);
  });

  it("measures its text as its intrinsic size (§74)", () => {
    const label = new Label({ text: "abc", atlas, size: 12 });
    label.measure();
    expect(label.measuredWidth).toBe(18); // 3 cells × 6 px × (12 / 12)
    expect(label.measuredHeight).toBe(12); // one line × size
  });

  it("measures multiple lines and the widest of them", () => {
    const label = new Label({ text: "abcd\nxy", atlas, size: 12 });
    label.measure();
    expect(label.measuredWidth).toBe(24);
    expect(label.measuredHeight).toBe(24);
    expect(label.textLayout?.lineCount).toBe(2);
  });

  it("passes letterSpacing through to layoutText", () => {
    const label = new Label({ text: "abc", atlas, size: 12, letterSpacing: 2 });
    label.measure();
    expect(label.measuredWidth).toBe(22); // spacing between, never after
  });

  it("wraps through wrapWidth independently of the box maxWidth", () => {
    const label = new Label({
      text: "hello world",
      atlas,
      size: 12,
      wrapWidth: 36,
    });
    label.measure();
    expect(label.textLayout?.lineCount).toBe(2);
    expect(label.measuredWidth).toBe(36);
    expect(label.measuredHeight).toBe(24);
    label.wrapWidth = undefined;
    label.measure();
    expect(label.textLayout?.lineCount).toBe(1);
  });

  it("reports the baseline a skin needs, scaled with the size", () => {
    const label = new Label({ text: "abc", atlas, size: 12 });
    expect(label.textBaselineTop).toBe(8); // ascent 8 × 12 / lineHeight 12
    label.size = 24;
    expect(label.textBaselineTop).toBe(16);
  });

  it("has no layout for an empty string even with an atlas", () => {
    const label = new Label({ atlas, size: 12 });
    expect(label.textLayout).toBeNull();
    label.text = "x";
    expect(label.textLayout).not.toBeNull();
  });

  it("caches the layout and invalidates it on every input", () => {
    const label = new Label({ text: "abc", atlas, size: 12 });
    const first = label.textLayout;
    expect(label.textLayout).toBe(first);

    label.text = "abc"; // unchanged — same object
    expect(label.textLayout).toBe(first);

    label.text = "abcd";
    expect(label.textLayout).not.toBe(first);
    expect(label.textLayout?.width).toBe(24);

    const beforeSize = label.textLayout;
    label.size = 12; // unchanged
    expect(label.textLayout).toBe(beforeSize);
    label.size = 6;
    expect(label.textLayout?.width).toBe(12);

    const beforeSpacing = label.textLayout;
    label.letterSpacing = 0; // unchanged
    expect(label.textLayout).toBe(beforeSpacing);
    label.letterSpacing = 1;
    expect(label.textLayout?.width).toBe(15);

    const beforeAtlas = label.textLayout;
    label.atlas = atlas; // unchanged
    expect(label.textLayout).toBe(beforeAtlas);
    label.atlas = null;
    expect(label.textLayout).toBeNull();
  });

  it("rejects a non-positive or non-finite size (§85)", () => {
    const label = new Label();
    expect(() => (label.size = 0)).toThrow(RangeError);
    expect(() => (label.size = -1)).toThrow(RangeError);
    expect(() => (label.size = Number.NaN)).toThrow(RangeError);
    expect(() => (label.letterSpacing = Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
    expect(label.size).toBe(1);
  });

  it("still honours an explicit width over the text's own", () => {
    const label = new Label({ text: "abc", atlas, size: 12, width: 100 });
    label.measure();
    expect(label.measuredWidth).toBe(100);
    expect(label.measuredHeight).toBe(12);
  });

  it("stacks inside a panel like any other widget", () => {
    const panel = new Panel({
      layout: { type: "stack", direction: "column", gap: 4, padding: 2 },
    });
    const first = new Label({ text: "abc", atlas, size: 12 });
    const second = new Label({ text: "de", atlas, size: 12 });
    panel.add(first, second);

    panel.layout();

    expect(panel.measuredWidth).toBe(22); // widest label (18) + padding
    expect(panel.measuredHeight).toBe(32); // 12 + 4 gap + 12 + padding
    expect([first.layoutLeft, first.layoutTop]).toEqual([2, 2]);
    expect([second.layoutLeft, second.layoutTop]).toEqual([2, 18]);
  });
});

it("forwards shaping options", () => {
  let received: ShapeQuery | undefined;
  class Spy extends IdentityShapingEngine {
    override shape(query: ShapeQuery) {
      received = query;
      return super.shape(query);
    }
  }
  const shaper = new Spy(),
    fontId = shaper.addFont(new Uint8Array());
  void new Label({
    atlas,
    text: "fi",
    shaper,
    fontId,
    script: "latn",
    language: "en",
    features: { liga: 1 },
  }).textLayout;
  expect(received).toMatchObject({
    text: "fi",
    fontId,
    script: "latn",
    language: "en",
    features: { liga: 1 },
  });
});
