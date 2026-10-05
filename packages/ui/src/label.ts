import type { TextLayoutOptions } from "@fourjs/text";
/**
 * `Label` (§73) — a widget whose intrinsic size is its text (§74, §56).
 *
 * ```ts
 * const atlas = buildGlyphAtlas();                        // @fourjs/text
 * const title = new Label({ text: "Motor 42", atlas, size: 18 });
 * title.measure();
 * title.measuredWidth;   // the text's width in layout units
 * ```
 *
 * ## Text is measured here and drawn by the skin
 *
 * `@fourjs/text` **is** a dependency of `@fourjs/ui` (plan §3.1), so there is no
 * excuse for a fake here: a label really lays its string out, with
 * `layoutText`, against a real {@link GlyphAtlas}, and reports the result as its
 * intrinsic size — §74's "intrinsic text/image size", satisfied by arithmetic
 * rather than by a promise.
 *
 * What it cannot do is *draw* it. `@fourjs/text` "produces data, never nodes" for
 * the same dependency-matrix reason `@fourjs/ui` does; turning a quad into a
 * textured sprite needs `render` and `materials`, which neither package may
 * import. So {@link Label.textLayout} is public, and a {@link WidgetSkin} turns
 * its quads into whatever the application draws with — exactly the composition
 * `examples/first-2d-scene` performs by hand today.
 *
 * ```ts
 * const skin: WidgetSkin = {
 *   onLayout(widget) {
 *     const label = widget as Label;
 *     const layout = label.textLayout;              // null when there is nothing to draw
 *     if (layout === null) return;
 *     placeGlyphs(layout.quads, 0, -label.textBaselineTop);   // origin = label's top-left
 *   },
 * };
 * ```
 *
 * ## Units
 *
 * {@link Label.size} is `layoutText`'s `size`: **layout units per line**, i.e.
 * the baseline-to-baseline distance, not an em size — see `text-layout.ts` for
 * why that distinction matters. Since layout units are the same units the rest
 * of the box model uses, a label of `n` lines is exactly `n · size` tall and
 * stacks against fixed-size widgets without a conversion.
 *
 * ## Caching
 *
 * The layout is computed lazily and cached until `text`, `atlas`, `size`, or
 * `letterSpacing` changes — which is why all four are accessors. A measure pass
 * over an unchanged label therefore costs one cache read, and mutating text
 * outside a layout pass costs nothing until the next one.
 *
 * ## What a label is not
 *
 * A leaf: it has no layout modes of its own (`Panel` is the container). It
 * wraps when {@link Label.wrapWidth} is set — `layoutText`'s UAX #14-lite
 * measure — and otherwise breaks only on `\n`. Alignment is still a
 * `layoutText` option on `Text`, not here.
 */

import type { Vector2 } from "@fourjs/math";
import { layoutText, type GlyphAtlas, type TextLayout } from "@fourjs/text";

import { UIWidget, type UIWidgetOptions } from "./widget.js";

/** Construction options for a {@link Label}. */
export interface LabelOptions
  extends
    UIWidgetOptions,
    Pick<
      TextLayoutOptions,
      | "shaper"
      | "fontId"
      | "script"
      | "language"
      | "direction"
      | "features"
      | "wrapWidth"
    > {
  /** {@link Label.text}. Default `""`. */
  text?: string;
  /** {@link Label.atlas}. Default `null`. */
  atlas?: GlyphAtlas;
  /** {@link Label.size}. Default `1`. */
  size?: number;
  /** {@link Label.letterSpacing}. Default `0`. */
  letterSpacing?: number;
}

/** Validates a layout size (§85), mirroring `layoutText`'s own guard. */
function requirePositive(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `Label: ${name} must be a finite positive number of layout units; ` +
        `got ${String(value)} (§85).`,
    );
  }
  return value;
}

/** Validates a finite number (§85). */
function requireFinite(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `Label: ${name} must be finite; got ${String(value)} (§85).`,
    );
  }
  return value;
}

export class Label extends UIWidget {
  #shaping: Pick<
    TextLayoutOptions,
    | "shaper"
    | "fontId"
    | "script"
    | "language"
    | "direction"
    | "features"
    | "wrapWidth"
  >;
  #text = "";
  #atlas: GlyphAtlas | null = null;
  #size = 1;
  #letterSpacing = 0;

  /** Cached {@link Label.textLayout}; `undefined` means "not computed yet". */
  #layout: TextLayout | null | undefined = undefined;

  constructor(options: LabelOptions = {}) {
    super(options);
    this.#shaping = {
      shaper: options.shaper,
      fontId: options.fontId,
      script: options.script,
      language: options.language,
      direction: options.direction,
      features: options.features && Object.freeze({ ...options.features }),
      wrapWidth: options.wrapWidth,
    };
    if (options.shaper && !options.fontId)
      throw new RangeError("fontId is required with a shaper");
    // Text is inert data — a label is not a pointer target unless the
    // application says so (a label inside a button must not steal the hit).
    if (options.interactive === undefined) this.interactive = false;
    if (options.text !== undefined) this.text = options.text;
    if (options.atlas !== undefined) this.atlas = options.atlas;
    if (options.size !== undefined) this.size = options.size;
    if (options.letterSpacing !== undefined) {
      this.letterSpacing = options.letterSpacing;
    }
  }

  /** The string this label shows. `\n` starts a new line; nothing else wraps. */
  get text(): string {
    return this.#text;
  }

  set text(value: string) {
    if (value === this.#text) return;
    this.#text = value;
    this.#layout = undefined;
  }

  /**
   * The glyph atlas the text is measured against (`@fourjs/text`), or `null`.
   *
   * A label with no atlas measures `0 × 0` and has no {@link Label.textLayout}:
   * a font is data the application loads, and inventing one here would be a
   * measurement nobody asked for. `buildGlyphAtlas()` produces the built-in
   * face in one call.
   */
  get atlas(): GlyphAtlas | null {
    return this.#atlas;
  }

  set atlas(value: GlyphAtlas | null) {
    if (value === this.#atlas) return;
    this.#atlas = value;
    this.#layout = undefined;
  }

  /** Layout units per line — `layoutText`'s `size`. Must be finite and positive. */
  get size(): number {
    return this.#size;
  }

  set size(value: number) {
    const next = requirePositive("size", value);
    if (next === this.#size) return;
    this.#size = next;
    this.#layout = undefined;
  }

  /** Extra layout units **between** adjacent glyphs. May be negative. */
  get letterSpacing(): number {
    return this.#letterSpacing;
  }

  set letterSpacing(value: number) {
    const next = requireFinite("letterSpacing", value);
    if (next === this.#letterSpacing) return;
    this.#letterSpacing = next;
    this.#layout = undefined;
  }

  /**
   * Maximum line width in layout units, or `undefined` for `\n`-only breaks.
   * Independent of {@link UIWidget.maxWidth}, which is the box-model clamp.
   */
  get wrapWidth(): number | undefined {
    return this.#shaping.wrapWidth;
  }

  set wrapWidth(value: number | undefined) {
    if (value === this.#shaping.wrapWidth) return;
    this.#shaping = { ...this.#shaping, wrapWidth: value };
    this.#layout = undefined;
  }

  /**
   * The laid-out text (§56) — quads in a baseline-left, Y-up frame — or `null`
   * when there is nothing to lay out (no atlas, or an empty string).
   *
   * Computed on first read and cached until one of the four inputs changes. The
   * returned object is `layoutText`'s own frozen result; it is never mutated.
   */
  get textLayout(): TextLayout | null {
    if (this.#layout === undefined) {
      const atlas = this.#atlas;
      this.#layout =
        atlas === null || this.#text === ""
          ? null
          : layoutText(this.#text, atlas, {
              size: this.#size,
              letterSpacing: this.#letterSpacing,
              ...this.#shaping,
            });
    }
    return this.#layout;
  }

  /**
   * Distance **down** from this label's top edge to the first line's baseline,
   * in layout units — `ascent · size / lineHeight`, and `0` without an atlas.
   *
   * A skin needs exactly this number: `layoutText` emits quads around a baseline
   * origin, and the widget's origin is its top-left corner, so the glyphs go at
   * `(0, −textBaselineTop)` in the label's local space.
   */
  get textBaselineTop(): number {
    const atlas = this.#atlas;
    if (atlas === null) return 0;
    return (atlas.ascent * this.#size) / atlas.lineHeight;
  }

  /** The text's own extent (§74 intrinsic size); `(0, 0)` when there is none. */
  override measureIntrinsic(out: Vector2): void {
    const layout = this.textLayout;
    if (layout === null) {
      out.set(0, 0);
      return;
    }
    out.set(layout.width, layout.height);
  }
}
