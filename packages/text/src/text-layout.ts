/**
 * `layoutText` (§56 MVP tier) — a string plus a {@link GlyphAtlas} becomes a
 * list of textured quads in world units.
 *
 * This is pure arithmetic: no allocation of engine objects, no scene graph, no
 * renderer, no DOM, no measurement callback. Give it a string and it returns
 * where each glyph's rectangle goes and which part of the atlas it samples. A
 * caller turns those into geometry (`@fourjs/geometry`), a sprite batch
 * (`@fourjs/render`), or SVG rects — the layout never learns which.
 *
 * ## Coordinates (§7a)
 *
 * **Origin is the first line's baseline at its left edge**, and **+Y is up**, in
 * 2D exactly as in 3D. So `y0 < y1` in every quad, ascenders have positive `y`,
 * descenders negative, and the second line's baseline is at `y = -size`.
 *
 * Baseline-relative rather than top-left-relative because the baseline is the
 * line that text actually sits on: mixing two fonts, or two sizes, or an icon
 * with a label, aligns on baselines and on nothing else. A caller who wants
 * top-left origin subtracts `ascent`, which is on the atlas; a caller who wants
 * the text centred uses the returned `width`/`height`.
 *
 * ```text
 *            ┌───────┬───────┬───────┐   y1 = +ascent · scale
 *            │  ###  │  #    │       │
 *            │ #   # │  #    │  ###  │
 *   baseline ├───────┼───────┼───────┤   y = 0  ← the origin's row
 *            │       │       │    #  │
 *            └───────┴───────┴───────┘   y0 = −descent · scale
 *            x=0     ↑ advance · scale
 * ```
 *
 * ## `size` is world units per **line**, not per em
 *
 * `scale = size / atlas.lineHeight`, so `size` is the baseline-to-baseline
 * distance of single-spaced lines and the height of one glyph cell. Two
 * consequences, both intended: a block of `n` lines is exactly `n · size` tall,
 * and `size` means the same thing whatever a font's internal pixel grid is — a
 * 6 × 12 face and a 16 × 32 face at `size: 0.5` produce text of the same
 * physical height. Quoting a font size in em would make the same number mean
 * different heights per face, which is precisely the CSS behaviour that forces
 * everyone to measure.
 *
 * ## Horizontal alignment (R-28, 2026-08-13)
 *
 * {@link TextLayoutOptions.align} shifts each line within the widest line's
 * extent: `"left"` (the default) leaves the pen where it was, `"center"` and
 * `"right"` translate a line by `(width − lineWidth) · f` with `f = 0.5` and
 * `f = 1`. It is applied *after* the pen walk, because a line's own width is not
 * known until the line ends — which is also why the previous note here said an
 * alignment is "computed from this function's output". That note was right about
 * the arithmetic and wrong about the home: doing it outside would require the
 * caller to re-derive per-line widths that this function has already discarded,
 * so every caller would rebuild the same table. The output *shape* is unchanged,
 * exactly as predicted.
 *
 * `"left"` is not merely the default, it is a distinct code path: the shift loop
 * does not run at all, so a layout that does not ask for alignment produces the
 * numbers it produced before this option existed, bit for bit.
 *
 * ## What this tier does not do (§56, staged)
 *
 * Line **breaking** wraps at UAX #14-lite opportunities when
 * {@link TextLayoutOptions.wrapWidth} is a finite positive measure; omitted,
 * only an explicit `\n` ends a line (bit-identical to the pre-wrapping walk).
 * **Vertical** alignment, word spacing, rich-text spans, text on
 * paths and bidirectional reordering remain staged. Optional shaping, ligatures
 * and kerning use the RFC 0008 shaping seam; the default code-point walk stays
 * unchanged when wrapping is not asked for.
 */

import {
  IdentityShapingEngine,
  type ShapingEngine,
  type ShapingDirection,
} from "./shaping.js";
import type { GlyphAtlas, GlyphAtlasEntry } from "./glyph-atlas.js";
import {
  canBreakAfter,
  canBreakBefore,
  wrapToWidth,
  type Wrappable,
} from "./line-break.js";

/**
 * One glyph's rectangle: where it goes, and what it samples.
 *
 * Positions are world units in the layout's own frame (baseline-left origin,
 * §7a Y-up); texture coordinates are the atlas cell, normalized 0…1. Corners
 * are given as a minimum/maximum pair rather than as four vertices because
 * every consumer — a quad builder, a sprite, an SVG rect — wants the rectangle,
 * and expanding it to vertices is one line at the point of use.
 */
export interface TextQuad {
  /** UTF-16 source index, present only when shaping was requested. */
  readonly cluster?: number;
  /** Left edge in world units. */
  readonly x0: number;

  /** **Bottom** edge in world units; below the baseline for a descender. */
  readonly y0: number;

  /** Right edge in world units. */
  readonly x1: number;

  /** **Top** edge in world units. */
  readonly y1: number;

  /** Left edge of the atlas cell, 0…1. */
  readonly u0: number;

  /** **Bottom** edge of the atlas cell, 0…1. */
  readonly v0: number;

  /** Right edge of the atlas cell, 0…1. */
  readonly u1: number;

  /** **Top** edge of the atlas cell, 0…1. */
  readonly v1: number;
}

/**
 * §56's horizontal alignment, as this tier ships it (R-28, 2026-08-13).
 *
 * Named from the *reading* direction and not from the axis, so `"left"` is the
 * side the pen starts on. A bidirectional tier gives the same three names a
 * `"start"`/`"end"` pair beside them; it does not change what these mean.
 */
export type TextAlign = "left" | "center" | "right";

/** Arguments of {@link layoutText}. */
export interface TextLayoutOptions {
  shaper?: ShapingEngine;
  fontId?: string;
  script?: string;
  language?: string;
  direction?: ShapingDirection;
  features?: Readonly<Record<string, number>>;
  /**
   * World units per line — the baseline-to-baseline distance of single-spaced
   * lines, and the height of one glyph cell. Must be finite and positive. See
   * the module header for why this is not an em size.
   */
  size: number;

  /**
   * Extra world units inserted **between** adjacent glyphs on a line; defaults
   * to `0`. Negative values tighten.
   *
   * Between, not after: no spacing precedes the first glyph of a line or
   * follows the last, so {@link TextLayout.width} stays the true extent of the
   * text and centring it does not drift by half a spacing (decision, WP-3a.4 —
   * CSS `letter-spacing` appends after every character instead, which is why
   * centred CSS text with wide tracking looks a touch left of centre).
   */
  letterSpacing?: number;

  /**
   * How each line sits within {@link TextLayout.width} — §56's "horizontal
   * alignment" (R-28, 2026-08-13). Defaults to `"left"`.
   *
   * ```ts
   * layoutText("Motor\n42 C", atlas, { size: 0.5, align: "center" });
   * // the short line is inset by (width − lineWidth) / 2
   * ```
   *
   * The block's own origin does not move: alignment is *within* the text, so
   * `x = 0` is still the left edge of the widest line, {@link TextLayout.width}
   * is still the true extent, and a caller centring the whole block on a node
   * subtracts `width / 2` exactly as before.
   */
  align?: TextAlign;

  /**
   * Maximum line width in world units. Omitted (or `Infinity`) leaves line
   * ends at explicit `\n` only — bit-identical to the pre-wrapping walk.
   * A finite positive measure wraps at UAX #14-lite opportunities
   * (`line-break.ts`): breaking spaces, hyphen-minus, and CJK; a single
   * unbreakable run wider than the measure overflows rather than being
   * clipped.
   */
  wrapWidth?: number;
}

/** What {@link layoutText} produces. */
export interface TextLayout {
  /**
   * One quad per **drawn** glyph, in reading order, line by line.
   *
   * Blank glyphs — the space, and anything else a font marks
   * {@link BitmapGlyph.blank} — advance the pen but
   * emit no quad: a fully transparent rectangle costs a draw call and a blend
   * and contributes nothing. So `quads.length` is *not* the string's length, and
   * a caller mapping quads back to characters must track that itself.
   */
  readonly quads: readonly TextQuad[];

  /** Width of the widest line in world units; `0` for text with no glyphs. */
  readonly width: number;

  /**
   * Total height in world units — `lineCount · size`, measuring from the first
   * line's cell top to the last line's cell bottom (the two are the same
   * because a cell is exactly one `lineHeight` tall).
   */
  readonly height: number;

  /**
   * Number of lines: one more than the `\n` count, or `0` for the empty string.
   *
   * Zero rather than one for `""` so that an empty label has zero height and
   * occupies no space in a layout — a caller that reserves a line for empty text
   * wants `Math.max(1, lineCount)`, which is explicit at the point that wants it
   * (decision, WP-3a.4).
   */
  readonly lineCount: number;
}

/**
 * A quad while {@link layoutText} is still deciding where it goes.
 *
 * Alignment shifts a line only once the line has ended, so the quads are built
 * mutable and frozen in one pass at the end — the same objects the caller
 * receives, and the same numbers the pre-R-28 code froze at push time.
 */
interface MutableTextQuad {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** Validates one numeric option (§85). */
function requireFinite(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `layoutText: ${name} must be finite; got ${String(value)} ` +
        "(§85: NaN and infinite values).",
    );
  }
  return value;
}

/**
 * Lays `text` out against `atlas` (§56 MVP tier).
 *
 * ```ts
 * const atlas = buildGlyphAtlas();
 * const layout = layoutText("Motor\n42 C", atlas, { size: 0.5 });
 * layout.lineCount; // 2
 * layout.height;    // 1     — 2 lines × 0.5
 * layout.width;     // 1.25  — "Motor", 5 cells × 6 px × (0.5 / 12)
 * ```
 *
 * ## Character handling
 *
 * - Iteration is by **code point** (`for…of`), so an astral character is one
 *   character and not two lone surrogates.
 * - `\n` ends the line: the pen returns to `x = 0` and the baseline drops by
 *   `size` (leading is exactly one line — see {@link TextLayoutOptions.size}).
 * - `\r` is **skipped entirely**, drawing nothing and advancing nothing, so
 *   CRLF-terminated text lays out identically to LF-terminated text (decision,
 *   WP-3a.4). A lone `\r` as a line terminator — Mac OS 9 and earlier — is not
 *   honoured as a break.
 * - Every other character absent from the atlas, control characters and tabs
 *   included, draws the fallback box and advances one cell. Nothing is silently
 *   dropped: an unrepresentable character is visible, which is what makes a
 *   missing script or a stray control byte diagnosable (§56's "font fallback"
 *   at this tier).
 *
 * ## Determinism (§33) — **cross-platform tier** (stated 2026-08-13, R-28)
 *
 * Pure: same string, same atlas, same options → identical numbers, always. No
 * clock, no randomness, no measurement of the environment.
 *
 * The claim is stronger than "same runtime", and mechanically so: every
 * arithmetic operation here is one of IEEE-754's **exactly rounded** ones —
 * `+`, `−`, `×`, `÷` and `Math.max` — over doubles, with no `sqrt`, no
 * transcendental, no `Math.fround`, and no iteration over a hash order (the
 * atlas is consulted with `Map.get`, never walked). Two conforming engines
 * therefore produce bit-identical quads, which is the tier `@fourjs/geometry`'s
 * `triangulatePolygon` reached and `Path`'s arcs deliberately did not. An edit
 * that introduces a transcendental — a rotation, an italic shear, a
 * `Math.round` to whole texels — breaks this *stated tier*, not merely a number.
 */
export function layoutText(
  text: string,
  atlas: GlyphAtlas,
  options: TextLayoutOptions,
): TextLayout {
  const size = requireFinite("size", options.size);
  if (size <= 0) {
    throw new RangeError(
      `layoutText: size must be a positive number of world units per line; ` +
        `got ${String(size)} (§85).`,
    );
  }
  const letterSpacing = requireFinite(
    "letterSpacing",
    options.letterSpacing ?? 0,
  );
  const wrapWidth = resolveWrapWidth(options.wrapWidth);

  if (options.shaper) {
    if (!options.fontId)
      throw new RangeError("fontId is required with a shaper");
    return layoutShaped(text, atlas, options, letterSpacing, wrapWidth);
  }

  if (wrapWidth !== undefined) {
    return layoutIdentityWrapped(
      text,
      atlas,
      options,
      letterSpacing,
      wrapWidth,
    );
  }

  const align = options.align ?? "left";

  const quads: MutableTextQuad[] = [];
  if (text === "") {
    return Object.freeze<TextLayout>({
      quads: Object.freeze(quads as TextQuad[]),
      width: 0,
      height: 0,
      lineCount: 0,
    });
  }

  // Font pixels → world units. `lineHeight` rather than `cellHeight` because
  // `size` is defined as the baseline-to-baseline distance; the two are equal
  // for the built-in face and the distinction matters for a face with built-in
  // line gap.
  const scale = size / atlas.lineHeight;
  const top = atlas.ascent * scale;
  const bottom = atlas.descent * scale;
  const cellWidth = atlas.cellWidth * scale;

  let penX = 0;
  let baselineY = 0;
  let lineCount = 1;
  let glyphsOnLine = 0;
  let width = 0;

  // Alignment's two bookkeeping arrays: where each line's quads start, and how
  // wide each line turned out. Both are filled on the same walk that emits the
  // quads, because a line's width is only known when the line ends and the
  // alternative — handing the caller the quads and asking it to re-derive the
  // widths — makes every caller rebuild this table (see the module header).
  const lineStarts: number[] = [0];
  const lineWidths: number[] = [];

  for (const char of text) {
    if (char === "\r") {
      continue;
    }
    if (char === "\n") {
      width = Math.max(width, penX);
      lineWidths.push(penX);
      lineStarts.push(quads.length);
      penX = 0;
      baselineY -= size;
      lineCount += 1;
      glyphsOnLine = 0;
      continue;
    }

    if (glyphsOnLine > 0) {
      penX += letterSpacing;
    }
    glyphsOnLine += 1;

    const entry: GlyphAtlasEntry = atlas.glyphs.get(char) ?? atlas.fallback;
    if (!entry.blank) {
      quads.push({
        x0: penX,
        y0: baselineY - bottom,
        x1: penX + cellWidth,
        y1: baselineY + top,
        u0: entry.u0,
        v0: entry.v0,
        u1: entry.u1,
        v1: entry.v1,
      });
    }
    penX += entry.advance * scale;
  }

  width = Math.max(width, penX);
  lineWidths.push(penX);

  // §56's horizontal alignment. `"left"` never enters this block at all, which
  // is what makes an unaligned layout bit-identical to the pre-R-28 one rather
  // than merely equal to it: no `x + 0` is evaluated, so no `-0` can become
  // `+0` and no line is touched. The widest line is skipped for the same reason
  // even when alignment is asked for — its offset is exactly zero.
  if (align !== "left") {
    const factor = align === "center" ? 0.5 : 1;
    for (let line = 0; line < lineWidths.length; line += 1) {
      const offset = (width - lineWidths[line]) * factor;
      if (offset === 0) {
        continue;
      }
      const end =
        line + 1 < lineStarts.length ? lineStarts[line + 1] : quads.length;
      for (let i = lineStarts[line]; i < end; i += 1) {
        const quad = quads[i];
        quad.x0 += offset;
        quad.x1 += offset;
      }
    }
  }

  for (const quad of quads) {
    Object.freeze(quad);
  }

  return Object.freeze<TextLayout>({
    quads: Object.freeze(quads as TextQuad[]),
    width,
    height: lineCount * size,
    lineCount,
  });
}

/** `undefined` means no wrap (the bit-identical path). */
function resolveWrapWidth(value: number | undefined): number | undefined {
  if (value === undefined || value === Number.POSITIVE_INFINITY) {
    return undefined;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `layoutText: wrapWidth must be a positive finite measure, or omitted; ` +
        `got ${String(value)} (§85).`,
    );
  }
  return value;
}

interface IdentityWrapItem extends Wrappable {
  readonly entry: GlyphAtlasEntry;
}

function applyAlignment(
  quads: MutableTextQuad[],
  lineStarts: readonly number[],
  lineWidths: readonly number[],
  width: number,
  align: TextAlign,
): void {
  if (align === "left") {
    return;
  }
  const factor = align === "center" ? 0.5 : 1;
  for (let line = 0; line < lineWidths.length; line += 1) {
    const offset = (width - lineWidths[line]) * factor;
    if (offset === 0) {
      continue;
    }
    const end =
      line + 1 < lineStarts.length ? lineStarts[line + 1] : quads.length;
    for (let i = lineStarts[line]; i < end; i += 1) {
      const quad = quads[i];
      quad.x0 += offset;
      quad.x1 += offset;
    }
  }
}

function layoutIdentityWrapped(
  text: string,
  atlas: GlyphAtlas,
  options: TextLayoutOptions,
  letterSpacing: number,
  wrapWidth: number,
): TextLayout {
  if (text === "") {
    return Object.freeze<TextLayout>({
      quads: Object.freeze([]),
      width: 0,
      height: 0,
      lineCount: 0,
    });
  }
  const size = options.size;
  const scale = size / atlas.lineHeight;
  const top = atlas.ascent * scale;
  const bottom = atlas.descent * scale;
  const cellWidth = atlas.cellWidth * scale;
  const paragraphs = text.split("\n");
  const quads: MutableTextQuad[] = [];
  const lineStarts: number[] = [];
  const lineWidths: number[] = [];
  let width = 0;
  let lineCount = 0;
  let baselineY = 0;

  for (let p = 0; p < paragraphs.length; p += 1) {
    const paragraph = paragraphs[p];
    const items: IdentityWrapItem[] = [];
    for (const char of paragraph) {
      if (char === "\r") {
        continue;
      }
      const codePoint = char.codePointAt(0)!;
      const entry: GlyphAtlasEntry = atlas.glyphs.get(char) ?? atlas.fallback;
      items.push({
        advance: entry.advance * scale,
        breakAfter: canBreakAfter(codePoint),
        breakBefore: canBreakBefore(codePoint),
        entry,
      });
    }
    const wrapped =
      items.length === 0 ? [[]] : wrapToWidth(items, wrapWidth, letterSpacing);
    for (const line of wrapped) {
      lineStarts.push(quads.length);
      let penX = 0;
      for (let i = 0; i < line.length; i += 1) {
        if (i > 0) {
          penX += letterSpacing;
        }
        const item = line[i];
        if (!item.entry.blank) {
          quads.push({
            x0: penX,
            y0: baselineY - bottom,
            x1: penX + cellWidth,
            y1: baselineY + top,
            u0: item.entry.u0,
            v0: item.entry.v0,
            u1: item.entry.u1,
            v1: item.entry.v1,
          });
        }
        penX += item.advance;
      }
      lineWidths.push(penX);
      width = Math.max(width, penX);
      lineCount += 1;
      baselineY -= size;
    }
  }

  applyAlignment(quads, lineStarts, lineWidths, width, options.align ?? "left");
  for (const quad of quads) {
    Object.freeze(quad);
  }
  return Object.freeze<TextLayout>({
    quads: Object.freeze(quads as TextQuad[]),
    width,
    height: lineCount * size,
    lineCount,
  });
}

interface ShapedWrapItem extends Wrappable {
  readonly glyph: {
    readonly glyphId: number;
    readonly cluster: number;
    readonly offsetX: number;
    readonly offsetY: number;
  };
  readonly direction: "ltr" | "rtl" | "ttb" | "btt";
}

/** Shapes each explicit paragraph, then wraps when `wrapWidth` is set. */
function layoutShaped(
  text: string,
  atlas: GlyphAtlas,
  options: TextLayoutOptions,
  spacing: number,
  wrapWidth: number | undefined,
): TextLayout {
  if (!text)
    return Object.freeze({
      quads: Object.freeze([]),
      width: 0,
      height: 0,
      lineCount: 0,
    });
  const size = options.size,
    scale = size / atlas.lineHeight;
  const identity = options.shaper instanceof IdentityShapingEngine;
  const entryFor = (glyphId: number): GlyphAtlasEntry =>
    (identity
      ? atlas.glyphs.get(String.fromCodePoint(glyphId))
      : atlas.glyphsById?.get(glyphId)) ?? atlas.fallback;
  const quads: (MutableTextQuad & { cluster: number })[] = [];
  const paragraphs = text.split("\n"),
    widths: number[] = [],
    starts: number[] = [];
  let source = 0,
    baseline = 0,
    width = 0,
    lineCount = 0;

  const emitLine = (
    glyphs: readonly ShapedWrapItem[],
    paragraph: string,
  ): void => {
    starts.push(quads.length);
    let pen = 0,
      count = 0;
    let i = 0;
    while (i < glyphs.length) {
      const direction = glyphs[i].direction;
      let end = i + 1;
      while (end < glyphs.length && glyphs[end].direction === direction) {
        end += 1;
      }
      const run = glyphs.slice(i, end);
      let runWidth = 0;
      for (let r = 0; r < run.length; r += 1) {
        if (r) runWidth += spacing;
        runWidth += run[r].advance;
      }
      if (run.length && count) pen += spacing;
      let cursor = direction === "rtl" ? pen + runWidth : pen;
      for (let r = 0; r < run.length; r += 1) {
        const item = run[r];
        const g = item.glyph;
        const entry = entryFor(g.glyphId);
        if (direction === "rtl") {
          if (r) cursor -= spacing;
          cursor -= item.advance;
        } else if (r) cursor += spacing;
        const x = g.offsetX === 0 ? cursor : cursor + (g.offsetX * size) / 1000;
        const y =
          g.offsetY === 0 ? baseline : baseline + (g.offsetY * size) / 1000;
        if (!entry.blank)
          quads.push({
            x0: x,
            x1: x + (identity ? atlas.cellWidth : entry.width) * scale,
            y0: y - atlas.descent * scale,
            y1: y + atlas.ascent * scale,
            u0: entry.u0,
            v0: entry.v0,
            u1: entry.u1,
            v1: entry.v1,
            cluster: source + g.cluster,
          });
        if (direction !== "rtl") cursor += item.advance;
      }
      pen = direction === "rtl" ? pen + runWidth : cursor;
      count += run.length;
      i = end;
    }
    widths.push(pen);
    width = Math.max(width, pen);
    lineCount += 1;
    baseline -= size;
    void paragraph;
  };

  for (const paragraph of paragraphs) {
    const runs = options.shaper!.shape({
      ...options,
      text: paragraph,
      fontId: options.fontId!,
    });
    const items: ShapedWrapItem[] = [];
    for (const run of runs) {
      const glyphs = run.glyphs.filter((g) => paragraph[g.cluster] !== "\r");
      for (const g of glyphs) {
        const codePoint = paragraph.codePointAt(g.cluster) ?? 0;
        items.push({
          advance: identity
            ? entryFor(g.glyphId).advance * scale
            : (g.advanceX * size) / 1000,
          breakAfter: canBreakAfter(codePoint),
          breakBefore: canBreakBefore(codePoint),
          glyph: g,
          direction: run.direction,
        });
      }
    }
    const wrapped =
      wrapWidth === undefined
        ? items.length === 0
          ? [[]]
          : [items]
        : items.length === 0
          ? [[]]
          : wrapToWidth(items, wrapWidth, spacing);
    for (const line of wrapped) {
      emitLine(line, paragraph);
    }
    source += paragraph.length + 1;
  }
  if (options.align && options.align !== "left")
    for (let line = 0; line < lineCount; line++) {
      const offset =
        (width - widths[line]) * (options.align === "center" ? 0.5 : 1);
      if (offset)
        for (
          let i = starts[line];
          i < (starts[line + 1] ?? quads.length);
          i++
        ) {
          quads[i].x0 += offset;
          quads[i].x1 += offset;
        }
    }
  return Object.freeze({
    quads: Object.freeze(quads.map((q) => Object.freeze(q))),
    width,
    height: lineCount * size,
    lineCount,
  });
}
