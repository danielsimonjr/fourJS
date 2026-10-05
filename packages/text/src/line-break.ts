/**
 * UAX #14-lite line breaking for {@link layoutText}'s `wrapWidth` packet
 * (RFC 0008 packet 2).
 *
 * This is **not** a complete UAX #14 implementation: it names a small, stable
 * set of opportunities so wrapping on the identity walk and on a HarfBuzz
 * run share one rule. Mandatory breaks stay with the caller (`\n` already
 * ends a line). Pairwise classes this packet does not model — WJ, GL beyond
 * NBSP, dictionary hyphenation, hangul, emoji ZWJ — stay unbreakable.
 *
 * Same-string, same-options is **cross-platform deterministic** (§33): the
 * tables are integer code-point tests, no `Intl.Segmenter`, no locale.
 */

/** Where a wrap may occur relative to one code point. */
export type LineBreakOpportunity = "after" | "before-and-after" | "never";

/** SP, TAB, and breaking Zs — NBSP / NNBSP stay glue (UAX #14 GL). */
function isBreakingSpace(codePoint: number): boolean {
  return (
    codePoint === 0x09 ||
    codePoint === 0x20 ||
    codePoint === 0x1680 ||
    (codePoint >= 0x2000 && codePoint <= 0x200a) ||
    codePoint === 0x205f ||
    codePoint === 0x3000
  );
}

/**
 * CJK ideographs and kana — UAX #14 ID/CJ, treated as break-before-and-after
 * so a run of them can wrap between characters.
 */
function isIdeographic(codePoint: number): boolean {
  return (
    (codePoint >= 0x2e80 && codePoint <= 0x2fff) ||
    (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0x20000 && codePoint <= 0x2ceaf)
  );
}

/** Hyphen-minus and soft hyphen — UAX #14 BA/SHY, break after. */
function isBreakAfterPunctuation(codePoint: number): boolean {
  return codePoint === 0x2d || codePoint === 0xad;
}

/**
 * Opportunity class of one Unicode code point. `\n` is **not** classified
 * here — {@link layoutText} already treats it as a mandatory line end.
 */
export function lineBreakOpportunity(codePoint: number): LineBreakOpportunity {
  if (isIdeographic(codePoint)) {
    return "before-and-after";
  }
  if (isBreakingSpace(codePoint) || isBreakAfterPunctuation(codePoint)) {
    return "after";
  }
  return "never";
}

/** True when a wrap may land after this code point (including CJK). */
export function canBreakAfter(codePoint: number): boolean {
  return lineBreakOpportunity(codePoint) !== "never";
}

/** True when a wrap may land immediately before this code point (CJK). */
export function canBreakBefore(codePoint: number): boolean {
  return lineBreakOpportunity(codePoint) === "before-and-after";
}

/** One unit of a greedy wrap: an advance and the opportunities around it. */
export interface Wrappable {
  readonly advance: number;
  readonly breakAfter: boolean;
  readonly breakBefore: boolean;
}

/**
 * Packs `items` into lines that do not exceed `wrapWidth` except for a
 * single unbreakable run longer than the measure (emergency overflow).
 *
 * `spacing` is inserted between adjacent items on a line, matching
 * `letterSpacing`. Empty `items` yields no lines — the caller maps an empty
 * paragraph onto a blank `\n` line itself.
 */
export function wrapToWidth<T extends Wrappable>(
  items: readonly T[],
  wrapWidth: number,
  spacing: number,
): T[][] {
  if (items.length === 0) {
    return [];
  }
  const lines: T[][] = [];
  let current: T[] = [];
  let width = 0;

  const measure = (line: readonly T[]): number => {
    let total = 0;
    for (let i = 0; i < line.length; i += 1) {
      if (i > 0) {
        total += spacing;
      }
      total += line[i].advance;
    }
    return total;
  };

  for (const item of items) {
    const extra = current.length === 0 ? item.advance : spacing + item.advance;
    if (current.length > 0 && width + extra > wrapWidth) {
      let breakAt = -1;
      for (let i = 0; i < current.length; i += 1) {
        if (
          current[i].breakAfter ||
          (i + 1 < current.length && current[i + 1].breakBefore)
        ) {
          breakAt = i + 1;
        }
      }
      if (item.breakBefore) {
        breakAt = current.length;
      }
      if (breakAt > 0) {
        lines.push(current.slice(0, breakAt));
        current = current.slice(breakAt);
        width = measure(current);
      } else {
        lines.push(current);
        current = [];
        width = 0;
      }
    }
    if (current.length > 0) {
      width += spacing;
    }
    current.push(item);
    width += item.advance;
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}
