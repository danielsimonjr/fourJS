/**
 * §50's *"SVG import/export compatibility"*, at the **path-data tier**: the
 * `d` attribute in, a `d` attribute out, over §51's {@link Path}.
 *
 * ```ts
 * const path = parseSvgPathData("M 0 0 L 100 0 A 50 50 0 0 1 0 0 Z");
 * formatSvgPathData(path.subdivide(2));
 * ```
 *
 * Placement is §98's, and it is the same sentence that placed §51: *"`geometry`:
 * 2D and 3D geometry, **path model**, tessellation module (§52)"*. The `d`
 * attribute is not a rendering concern and not an asset concern — it is the
 * *serialized form of the path model*, so it belongs beside the model.
 * `render-svg` (§62) is a **backend** that draws a whole scene into SVG markup;
 * `@fourjs/assets` (§76) owns SVG as a *file* to fetch and cache. Neither of them
 * is this, and this needs neither of them.
 *
 * ## What ships here, and what is staged
 *
 * §50 asks for SVG *compatibility* from a shape system. That system does not
 * exist yet (gap `R-23`: none of §50's fourteen shape nodes is built, and §58's
 * paints — gap `R-16` — are not either). What *does* exist is the geometry all
 * fourteen reduce to, so what ships is the geometry half, complete:
 *
 * | tier                                                | state | owner                                     |
 * | --------------------------------------------------- | ----- | ----------------------------------------- |
 * | `d` attribute → {@link Path}                          | ships | here                                      |
 * | {@link Path} → `d` attribute                          | ships | here                                      |
 * | `<svg>` document, `viewBox`, `transform`, `<g>`       | ships | `parseSvgDocument` — small XML tokenizer, no `DOMParser` (R-26) |
 * | `<rect>`/`<circle>`/`<ellipse>`/`<line>`/`<polyline>`/`<polygon>` | ships | `parseSvgDocument` reduces each to a {@link Path} |
 * | `fill`, `stroke`                                      | ships | captured on the document path record; paints stay with `R-16` |
 * | `fill-rule`                                           | ships | written onto {@link Path.fillRule}          |
 *
 * The document tier is a **small XML tokenizer in this package**, not
 * `DOMParser`. `@fourjs/geometry` stays node-safe; `<!DOCTYPE` and external
 * entities are refused (§96). Everything below (the `d` grammar) is still
 * pure string arithmetic and runs identically in both environments.
 *
 * ## The Y axis: this module **transcribes**, it does not flip (§7a)
 *
 * SVG user space has +Y **down**. fourJS world space has +Y **up**, in 2D as
 * well as 3D (§7a). {@link parseSvgPathData} does **not** reconcile them: the
 * numbers in the `d` attribute are the numbers in the {@link Path}, so content
 * imported and drawn without further thought appears **mirrored about the X
 * axis**. That is a decision, and these are the reasons:
 *
 * 1. **A flip alone is the wrong transform anyway.** SVG's origin is the
 *    top-left of the viewport, so content lives at `y ∈ [0, height]`; negating
 *    `y` puts it at `[-height, 0]`, which is not where anyone wants it either.
 *    The transform that actually lands SVG content in a Y-up world is
 *    `y ↦ height − y`, and `height` comes from the `viewBox` — which is in the
 *    **document**, not in the `d` attribute. A `d` parser that flipped would be
 *    performing exactly half of a transform it cannot complete, silently. Half
 *    a correction is worse than none, because none is visible.
 * 2. **Transcription is a checkable contract.** "Every number in, the same
 *    number out" is what makes `format(parse(d))` a testable identity and what
 *    makes §50's word *compatibility* mean something. A flipping parser would
 *    have to flip the arc sweep flags too, and the correctness of the flip
 *    would become part of the correctness of the parser.
 * 3. **The correction is one exact line, at the caller, where the `viewBox`
 *    is.** Negation is exact in IEEE-754 and {@link Path.transform} accepts a
 *    reflection (including for arcs — a reflection is a similarity):
 *
 *    ```ts
 *    // column-major: x ↦ x, y ↦ height − y
 *    const svgToWorld = new Matrix3().fromArray([1, 0, 0, 0, -1, 0, 0, height, 1]);
 *    const world = parseSvgPathData(d).transform(svgToWorld);
 *    ```
 *
 *    `parseSvgDocument` returns `viewBox` so that line is writeable;
 *    it does not apply the flip itself. Transcription is still the contract.
 *
 * {@link formatSvgPathData} is the mirror image of that decision, and therefore
 * consistent with it: it writes the path's own numbers, so a path authored in a
 * Y-up world round-trips exactly and *renders* mirrored in an SVG viewer unless
 * the caller applies the inverse transform first. One convention, stated once,
 * applied in both directions.
 *
 * ## Arcs: endpoint in, endpoint out, centre in the middle
 *
 * SVG's `A` command is **endpoint-parameterized** (`rx ry rotation large-arc
 * sweep x y`); §51's `PathArcCommand` is **centre-parameterized** with a signed
 * sweep. The conversion each way is the one in SVG 1.1 Appendix F.6, and it is
 * where the interesting caveats live:
 *
 * - **The conversion is transcendental in both directions** (`atan2`, `sqrt`,
 *   `cos`, `sin`), so an imported arc is §33 **same-runtime**, exactly like
 *   every other arc operation in §51. Lines and Béziers are exact both ways —
 *   see "Determinism" below.
 * - **The round trip is shape-preserving, not bit-preserving, for arcs.**
 *   `parse → format → parse` reproduces the same ellipse to within a few ulps,
 *   and reproduces the flags and the rotation exactly, but it is not an
 *   identity on the command list. For paths of `M`/`L`/`Q`/`C`/`Z` it *is* an
 *   identity, exactly.
 * - **The rotation changes units.** SVG's `x-axis-rotation` is in **degrees**;
 *   §7b says every engine angle is radians. `deg → rad → deg` is two roundings,
 *   which is the second reason arcs do not round-trip bit-exactly.
 * - **A full turn cannot be one `A`.** An arc of `|Δ| = 2π` has coincident
 *   endpoints, and SVG's F.6.2 says an `A` with coincident endpoints draws
 *   *nothing*. {@link formatSvgPathData} therefore writes such an arc as two
 *   `A` commands of half the sweep each — the only splitting it ever does.
 * - **An arc carries an implicit line.** §51's arc starts at its own first
 *   point and contributes a straight segment from the current point when the
 *   two differ (the Canvas rule). SVG has no such rule, so the writer emits
 *   that segment as an explicit `L`. It is what makes a rounded rectangle —
 *   four `arc` calls and no `lineTo` at all — export correctly.
 *
 * ## The arc's start is authoritative, and the reader is one command behind
 *
 * That last bullet has a sharp edge on the *import* side, and it is the one
 * design decision here that changes a number the document wrote.
 *
 * SVG's `A` **begins at the current point** — that is what "endpoint
 * parameterization" means. §51's arc begins wherever
 * `centre + R(rotation)·(rx cos θ₁, ry sin θ₁)` lands, and no choice of centre
 * makes that expression hit an arbitrary point exactly: deriving the centre
 * from the desired start reproduces it exactly for only ~83% of arcs (measured
 * over 200 000 random ones), because `(a − b) + b` is not an identity in binary
 * floating point.
 *
 * So after `L 0 12 A 12 12 0 0 1 12 0` the line ends at `(0, 12)` and the arc
 * starts at `(0, 12.000000000000002)`. §51 dutifully inserts its implicit
 * connecting segment: two ulps long, pointing *back up* the line that just
 * arrived. In the flattening that is a zero-area spike, and §52's tessellator
 * refuses it — correctly, and with a precise message. The shape that hits this
 * is `L … A …` repeated four times: **the rounded rectangle**, which is the
 * most common non-trivial thing in any SVG file. An importer that cannot fill a
 * rounded rectangle is not an importer.
 *
 * The fix is to decide which of the two points is authoritative, and it is the
 * arc's — because the document's claim is *"the arc starts where you are"*, and
 * the only way to make that claim exactly true in this model is to move where
 * you are. {@link parseSvgPathData} therefore holds each line, quadratic and
 * cubic back by one command; if an arc follows, the held segment's **endpoint**
 * is retargeted to the arc's computed start before it is appended. The move is
 * a few ulps — strictly smaller than the error the endpoint→centre conversion
 * has already introduced — and it is the only place in this module where an
 * output coordinate is not exactly what the document said. If anything other
 * than an arc follows, the segment is written exactly as the document wrote it.
 *
 * The residual, stated rather than hidden: **arc → arc** seams still carry the
 * implicit segment, because the second arc's start is computed from its own
 * conversion and nothing precedes it that could be retargeted. Those seams are
 * tangentially continuous (both arcs pass through the same document point from
 * the same direction), so the micro-segment does not double back, and no case
 * in the test corpus — including the two-arc circle every SVG writer emits —
 * has produced a §52 refusal.
 *
 * ## Coverage of the `d` grammar: complete
 *
 * All ten commands, both cases, plus every syntactic wrinkle the grammar
 * actually has: implicit repetition of an argument set, implicit `lineto` after
 * a `moveto`, optional separators (`1-2` is two numbers), a single optional
 * comma between numbers, the greedy number scan that reads `1.5.5` as two
 * numbers, and flags written without separators (`a1 1 0 011 1`). `B`/`b`
 * (bearing) appeared in an SVG 2 draft, was removed before Candidate
 * Recommendation, and is refused.
 *
 * ## Refusals, and the one place a format rule outranks §85
 *
 * §85's house rule is refuse loudly rather than rewrite silently, and every
 * malformed input below throws a `SyntaxError` naming the offset. But a handful
 * of inputs that *look* like §85 clamps are nothing of the kind: SVG 1.1
 * F.6.6 **defines** what a conforming reader does with an out-of-range arc
 * radius, and a reader that refused them could not read valid documents — which
 * is the entire point of §50's requirement. **A format conformance rule is not
 * a clamp**; it is what the document means. The line between the two is drawn
 * exactly here:
 *
 * | input                              | what happens                       | why |
 * | ---------------------------------- | ---------------------------------- | --- |
 * | negative `rx`/`ry`                 | absolute value taken               | F.6.6.1 — defined |
 * | `rx` or `ry` of zero               | becomes a straight `L` to the endpoint | F.6.6.1 — defined |
 * | arc endpoints coincident           | the arc is omitted                 | F.6.2 — defined |
 * | radii too small to span the chord  | scaled up uniformly by `√Λ`        | F.6.6.2/3 — defined |
 * | a second `Z` with nothing open     | no-op                              | unambiguous; nothing is dropped or guessed |
 * | an arc whose chord is unresolvable beside its radii in double precision | becomes a straight `L` | the arc *is* its chord at that scale; see `appendArc` |
 * | a segment immediately followed by an arc | its endpoint moves onto the arc's start, by a few ulps | the document says the arc begins there; see the section above |
 * | a flag that is not `0` or `1`      | **refused**                        | the grammar admits nothing else |
 * | a number the grammar does not admit | **refused**                       | |
 * | a numeric literal denoting `±∞`    | **refused**                        | §85: no non-finite coordinate |
 * | an arc whose centre parameterization overflows | **refused**            | §85 |
 * | any command letter outside the ten | **refused**                        | |
 * | path data not starting with `M`/`m` | **refused**                       | the grammar requires it |
 * | anything after the first error     | **refused** — nothing is kept      | see below |
 *
 * The last row is a deliberate divergence from SVG's own error handling, which
 * says a viewer renders the path *up to* the error. That rule exists so a
 * browser shows something; it is the wrong rule for an importer, because it
 * turns a typo into silently missing geometry. §85 wins: an unparseable `d`
 * yields no path at all.
 *
 * ## Hostile input (§96)
 *
 * A `d` attribute is untrusted text — it arrives from a file, a network
 * response, or a user paste. Three properties, each of them checked rather than
 * asserted (`tests/…/svg-path.test.ts` fuzzes ~30 000 hostile strings):
 *
 * - **No regular expressions anywhere.** The scanner compares character codes
 *   in a single forward pass. There is no backtracking, so there is no
 *   catastrophic backtracking: the parser is O(n) in the input length on
 *   *every* input, not merely on well-formed ones.
 * - **Total.** Every input either yields a {@link Path} or throws — a
 *   `SyntaxError` for text the grammar rejects, a `RangeError` for a caller's
 *   own bad option, or a `FourError` (`UNTRUSTED_INPUT_REJECTED`) for the size
 *   limit. It never hangs and never returns a half-built path: every branch of
 *   the scanner either consumes at least one character or throws, which is what
 *   makes termination structural rather than hoped for.
 * - **Bounded, with one limit rather than several.**
 *   {@link SvgPathParseOptions.maximumTextLength} is the only bound, and one is
 *   enough *because* of the property above: the parser recurses nowhere, works
 *   in O(1) per character, and allocates linearly in the input, so bounding the
 *   text bounds the time, the stack, and the heap together. A second limit on
 *   the command count would be a number with no independent meaning.
 *
 * Nothing here evaluates anything: no `eval`, no `Function`, no dynamic import
 * — §96's *"no arbitrary code execution from scene files"* holds trivially, and
 * the CSP suite (`tests/integration/security-csp.test.ts`) is what keeps it
 * true.
 *
 * ## Determinism (§33): two tiers, the §51 split, inherited
 *
 * `R-24` established that a tier is a property of the *operation*, not the
 * module, and that survives here unchanged:
 *
 * | operation                                    | tier           | why |
 * | -------------------------------------------- | -------------- | --- |
 * | parsing `M`/`L`/`H`/`V`/`Q`/`T`/`C`/`S`/`Z`  | cross-platform | ECMA-262 specifies decimal-string → double exactly, and relative coordinates are one `+` |
 * | parsing `A`                                  | same-runtime   | `cos`, `sin`, `sqrt`, `atan2` |
 * | writing `M`/`L`/`Q`/`C`/`Z`                  | cross-platform | ECMA-262 specifies `Number::toString` exactly |
 * | writing `A`                                  | same-runtime   | the arc's endpoints are `centre + r·(cos θ, sin θ)` |
 *
 * `tests/determinism/svg-path.test.ts` pins those two tiers **separately**,
 * with the two digests and two `_tier` labels `golden/path.json` established,
 * for the same reason: averaging them would let a transcendental introduced
 * into the Bézier path hide inside the arc half's weaker claim.
 *
 * The cross-platform claim has exactly one documented edge, and it is
 * ECMA-262's, not this module's: a decimal literal with **more than 20
 * significant digits** may legally be rounded to either of the two nearest
 * doubles, so `M 0.10000000000000000000005 0` is the one shape of input on
 * which two conforming engines may disagree. Authored SVG does not contain such
 * literals — writers emit far fewer digits, and this module's own writer emits
 * the *shortest* string that round-trips (never more than 17 significant
 * digits, and 17 is inside the exact range).
 *
 * ## The number format, and why it is `String(value)`
 *
 * The writer's numeric format is a determinism decision, so it is stated: every
 * number is written with `String(value)`, JavaScript's shortest decimal string
 * that round-trips to the same double. It is the right choice on both axes at
 * once — ECMA-262 specifies `Number::toString` **exactly** (so two conforming
 * engines write the same bytes, a `cross-platform` claim), and it is
 * **lossless** (so `parse(format(p))` recovers `p`'s coordinates bit for bit).
 * A fixed-decimal format would have been neither. A *lossy* writer — round to
 * a caller-chosen number of decimals — is {@link SvgPathFormatOptions.precision}.
 * It is opt-in: the default (no option) is still `String(value)`, so the
 * determinism golden does not move. A supplied precision is a deliberate,
 * lossy request, not a silent rewrite.
 *
 * Output shape: absolute uppercase commands only, single ASCII spaces, no
 * commas, no implicit repetition, no leading or trailing space. It is not the
 * shortest possible `d` string and does not try to be — a compactor is a
 * separate, lossless, and independently testable transformation.
 */

import { FourError } from "@fourjs/core";

import {
  Path,
  advance,
  arcPoint,
  newCursor,
  type PathArcCommand,
  type PathCursor,
} from "./path.js";

/** A full turn in radians — the sweep an `A` command can never quite reach. */
const TAU = Math.PI * 2;

/** SVG writes `x-axis-rotation` in degrees; §7b says radians everywhere else. */
const DEGREES_TO_RADIANS = Math.PI / 180;

/** The inverse, for the writer. */
const RADIANS_TO_DEGREES = 180 / Math.PI;

const CHAR_TAB = 0x09;
const CHAR_LINE_FEED = 0x0a;
const CHAR_FORM_FEED = 0x0c;
const CHAR_CARRIAGE_RETURN = 0x0d;
const CHAR_SPACE = 0x20;
const CHAR_PLUS = 0x2b;
const CHAR_COMMA = 0x2c;
const CHAR_MINUS = 0x2d;
const CHAR_DOT = 0x2e;
const CHAR_ZERO = 0x30;
const CHAR_ONE = 0x31;
const CHAR_NINE = 0x39;
const CHAR_UPPER_E = 0x45;
const CHAR_LOWER_E = 0x65;

/**
 * The default ceiling on one `d` attribute, in UTF-16 code units (§96).
 *
 * 4 Mi units — about 4 MB. The largest `d` attributes that occur in practice
 * are detailed cartographic outlines, which run to a few hundred kilobytes; the
 * default is an order of magnitude above them and far below anything that could
 * make a linear-time parser interesting to an attacker. A caller with a
 * genuinely larger document raises it explicitly, which is the point: the
 * decision to accept a 40 MB path should appear in someone's source, not in the
 * absence of a check. `Number.POSITIVE_INFINITY` is the in-source opt-out.
 */
export const DEFAULT_MAXIMUM_PATH_DATA_LENGTH = 4_194_304;

/** Options for {@link formatSvgPathData}. */
export interface SvgPathFormatOptions {
  /**
   * Decimal places to round each number to. Omitted: every number is
   * `String(value)` — the lossless default the determinism golden pins.
   * Must be a finite integer in `0 … 20` when supplied.
   */
  readonly precision?: number;
}

/** §96 bounds for one untrusted `d` attribute. */
export interface SvgPathParseOptions {
  /**
   * Maximum length of the path data in UTF-16 code units. Defaults to
   * {@link DEFAULT_MAXIMUM_PATH_DATA_LENGTH}; `Number.POSITIVE_INFINITY`
   * disables the check for a caller who has decided, in writing, that the input
   * is trusted.
   */
  readonly maximumTextLength?: number;
}

/** Where the scanner is in the path data. The only mutable parser state. */
interface Scanner {
  readonly text: string;
  index: number;
}

/**
 * What the reader has to remember between commands.
 *
 * `controlX`/`controlY` and `controlKind` exist for `S` and `T`, whose control
 * point is the reflection of the previous command's — *only* when the previous
 * command was a curve of the matching degree. `open` mirrors §51's own
 * open-subpath invariant so a redundant `Z` can be a no-op here instead of a
 * refusal from {@link Path.close}.
 *
 * `pending` is the one-segment deferral that makes an arc's start authoritative
 * — see {@link ReaderState.pending}.
 */
interface ReaderState {
  x: number;
  y: number;
  startX: number;
  startY: number;
  controlX: number;
  controlY: number;
  controlKind: "cubic" | "quadratic" | "none";
  open: boolean;
  /**
   * The last drawing segment read, held back until the next command is known.
   *
   * **Why the reader is one command behind.** SVG's `A` *begins at the current
   * point*, by definition of the endpoint parameterization. §51's arc begins
   * wherever `centre + R(rotation)·(rx cos θ₁, ry sin θ₁)` lands, and that
   * expression cannot be made to hit an arbitrary point exactly — measured over
   * 200 000 random arcs, deriving the centre from the desired start point
   * reproduces it exactly only ~83% of the time, because `(a − b) + b` is not
   * an identity in binary floating point.
   *
   * Left alone, the two disagree by a couple of ulps and §51 materializes the
   * disagreement as its implicit connecting segment — a segment two ulps long,
   * pointing *back* along the line that just arrived. In the flattening that is
   * a zero-area spike, and §52's tessellator refuses it, correctly and
   * precisely. The shape that hits it is the rounded rectangle (`L … A …`,
   * four times), which is the most common non-trivial thing in any SVG file.
   *
   * So the reader holds each line, quadratic and cubic back by one command. If
   * an arc follows, the held segment's **endpoint is retargeted to the arc's
   * computed start** — a move of a few ulps, strictly smaller than the error
   * the endpoint→centre conversion already introduced, and in the one direction
   * that removes a defect rather than adding one. If anything else follows, the
   * segment is flushed exactly as the document wrote it.
   */
  pending: PendingSegment | undefined;
}

/**
 * One held-back drawing segment (see {@link ReaderState.pending}).
 *
 * The control points are stored flat rather than as a discriminated union of
 * three shapes: the only field that is ever rewritten is the endpoint, and one
 * record with two unused slots is smaller than three records plus the
 * narrowing.
 */
interface PendingSegment {
  readonly kind: "line" | "quadratic" | "cubic";
  readonly control1X: number;
  readonly control1Y: number;
  readonly control2X: number;
  readonly control2Y: number;
  x: number;
  y: number;
}

/** SVG 1.1 `wsp`, plus SVG 2's form feed. */
function isWhitespace(code: number): boolean {
  return (
    code === CHAR_SPACE ||
    code === CHAR_TAB ||
    code === CHAR_LINE_FEED ||
    code === CHAR_CARRIAGE_RETURN ||
    code === CHAR_FORM_FEED
  );
}

/** ASCII `0`–`9`. `NaN` from a read past the end compares false, as intended. */
function isDigit(code: number): boolean {
  return code >= CHAR_ZERO && code <= CHAR_NINE;
}

/** Whether a character could begin a number — the implicit-repetition test. */
function startsNumber(code: number): boolean {
  return (
    isDigit(code) ||
    code === CHAR_DOT ||
    code === CHAR_PLUS ||
    code === CHAR_MINUS
  );
}

/** Advances over `wsp*`. */
function skipWhitespace(scanner: Scanner): void {
  while (isWhitespace(scanner.text.charCodeAt(scanner.index))) {
    scanner.index += 1;
  }
}

/**
 * Advances over the grammar's `comma_wsp?`: whitespace, **at most one** comma,
 * whitespace. A second comma is left in place, where the number scanner refuses
 * it.
 */
function skipCommaWhitespace(scanner: Scanner): void {
  skipWhitespace(scanner);
  if (scanner.text.charCodeAt(scanner.index) === CHAR_COMMA) {
    scanner.index += 1;
    skipWhitespace(scanner);
  }
}

/**
 * Refuses the input, naming the offset and the character found there (§85).
 *
 * A `SyntaxError` rather than the `RangeError` §51's builder throws: the caller
 * handed over *text*, not a coordinate, and the actionable fact is where in the
 * text it stopped making sense.
 */
function fail(scanner: Scanner, at: number, what: string): never {
  const found =
    at < scanner.text.length
      ? `\`${scanner.text.charAt(at)}\``
      : "the end of the input";
  throw new SyntaxError(
    `parseSvgPathData: ${what} at offset ${String(at)}; found ${found} (§85).`,
  );
}

/**
 * Reads one number, preceded by an optional separator.
 *
 * The scan is greedy and single-pass, which is both the performance property
 * (§96: no backtracking) and the grammar's own behaviour — `1.5.5` is two
 * numbers, because the fractional part stops at the second `.`.
 */
function readNumber(scanner: Scanner): number {
  skipCommaWhitespace(scanner);
  const text = scanner.text;
  const start = scanner.index;
  let index = start;
  const sign = text.charCodeAt(index);
  if (sign === CHAR_PLUS || sign === CHAR_MINUS) {
    index += 1;
  }
  let digits = 0;
  while (isDigit(text.charCodeAt(index))) {
    index += 1;
    digits += 1;
  }
  if (text.charCodeAt(index) === CHAR_DOT) {
    index += 1;
    while (isDigit(text.charCodeAt(index))) {
      index += 1;
      digits += 1;
    }
  }
  if (digits === 0) {
    fail(scanner, start, "expected a number");
  }
  const exponentMarker = text.charCodeAt(index);
  if (exponentMarker === CHAR_LOWER_E || exponentMarker === CHAR_UPPER_E) {
    let after = index + 1;
    const exponentSign = text.charCodeAt(after);
    if (exponentSign === CHAR_PLUS || exponentSign === CHAR_MINUS) {
      after += 1;
    }
    if (!isDigit(text.charCodeAt(after))) {
      fail(scanner, after, "an exponent must carry at least one digit");
    }
    while (isDigit(text.charCodeAt(after))) {
      after += 1;
    }
    index = after;
  }
  const value = Number(text.slice(start, index));
  if (!Number.isFinite(value)) {
    fail(
      scanner,
      start,
      "a coordinate must be finite, and this literal overflows to infinity",
    );
  }
  scanner.index = index;
  return value;
}

/** Reads one coordinate, resolving a relative command against `origin`. */
function readCoordinate(
  scanner: Scanner,
  relative: boolean,
  origin: number,
): number {
  const value = readNumber(scanner);
  return relative ? origin + value : value;
}

/**
 * Reads one arc flag: a single `0` or `1`, which the grammar allows to abut
 * whatever follows it (`a1 1 0 011 1` is legal and means flags `0` then `1`).
 */
function readFlag(scanner: Scanner): boolean {
  skipCommaWhitespace(scanner);
  const code = scanner.text.charCodeAt(scanner.index);
  if (code === CHAR_ZERO) {
    scanner.index += 1;
    return false;
  }
  if (code === CHAR_ONE) {
    scanner.index += 1;
    return true;
  }
  return fail(scanner, scanner.index, "an arc flag must be exactly `0` or `1`");
}

/**
 * Whether another argument set follows — the grammar's implicit repetition.
 *
 * A pure lookahead: the scanner's position is restored before returning, so the
 * separator is consumed by {@link readNumber} exactly once, by whichever of the
 * two paths continues.
 */
function moreArguments(scanner: Scanner): boolean {
  const saved = scanner.index;
  skipCommaWhitespace(scanner);
  const code = scanner.text.charCodeAt(scanner.index);
  scanner.index = saved;
  return startsNumber(code);
}

/**
 * Appends the held-back segment, if there is one (see
 * {@link ReaderState.pending}).
 *
 * Called before *every* other append and once at the end of the parse, so the
 * deferral is invisible in the finished command list: the only thing it can
 * change is one endpoint, and only when an arc asked for it.
 */
function flushPending(path: Path, state: ReaderState): void {
  const pending = state.pending;
  if (pending === undefined) {
    return;
  }
  state.pending = undefined;
  if (pending.kind === "line") {
    path.lineTo(pending.x, pending.y);
  } else if (pending.kind === "quadratic") {
    path.quadraticCurveTo(
      pending.control1X,
      pending.control1Y,
      pending.x,
      pending.y,
    );
  } else {
    path.cubicCurveTo(
      pending.control1X,
      pending.control1Y,
      pending.control2X,
      pending.control2Y,
      pending.x,
      pending.y,
    );
  }
}

/** Holds one drawing segment back, flushing whatever was held before it. */
function deferSegment(
  path: Path,
  state: ReaderState,
  segment: PendingSegment,
): void {
  flushPending(path, state);
  state.pending = segment;
  state.x = segment.x;
  state.y = segment.y;
}

/** Records a straight segment, in the path and in the reader's cursor. */
function appendLine(
  path: Path,
  state: ReaderState,
  x: number,
  y: number,
): void {
  deferSegment(path, state, {
    kind: "line",
    control1X: 0,
    control1Y: 0,
    control2X: 0,
    control2Y: 0,
    x,
    y,
  });
}

/**
 * Converts one SVG `A` command to §51's centre parameterization and appends it
 * (SVG 1.1 Appendix F.6.5), or appends what F.6 says the command means instead.
 *
 * The conformance rules of F.6.6 are honoured rather than refused — see this
 * module's header for why a format rule is not an §85 clamp. Two further cases
 * are this module's own, and both are the same observation: **an arc whose
 * chord cannot be resolved beside its radii in double precision *is* its
 * chord**, so it is written as one.
 *
 * - `denominator === 0` means both half-chord components squared to zero: the
 *   endpoints differ, but by so little that the centre is not computable.
 * - `startAngle === endAngle` means the two endpoints landed on the same angle
 *   of an ellipse enormously larger than the chord. This one *matters*: the
 *   sweep normalization below would otherwise turn a zero difference into a
 *   full `±2π` turn, drawing a circle of radius 10^300 where the document asked
 *   for a segment a micron long.
 *
 * What is refused is overflow — a derived centre or angle that is not finite,
 * which needs coordinates around 10^154 to reach. That is §85's territory, not
 * the format's.
 */
function appendArc(
  scanner: Scanner,
  path: Path,
  state: ReaderState,
  at: number,
  radiusXInput: number,
  radiusYInput: number,
  rotationDegrees: number,
  largeArc: boolean,
  sweep: boolean,
  endX: number,
  endY: number,
): void {
  const startX = state.x;
  const startY = state.y;
  if (startX === endX && startY === endY) {
    // F.6.2: an arc between coincident points is omitted entirely.
    return;
  }
  let radiusX = Math.abs(radiusXInput);
  let radiusY = Math.abs(radiusYInput);
  if (radiusX === 0 || radiusY === 0) {
    // F.6.6.1: a zero radius makes the arc a straight line.
    appendLine(path, state, endX, endY);
    return;
  }

  const rotation = rotationDegrees * DEGREES_TO_RADIANS;
  const cosRotation = Math.cos(rotation);
  const sinRotation = Math.sin(rotation);
  const halfDeltaX = (startX - endX) * 0.5;
  const halfDeltaY = (startY - endY) * 0.5;
  const primedX = cosRotation * halfDeltaX + sinRotation * halfDeltaY;
  const primedY = -sinRotation * halfDeltaX + cosRotation * halfDeltaY;

  const lambda =
    (primedX * primedX) / (radiusX * radiusX) +
    (primedY * primedY) / (radiusY * radiusY);
  if (lambda > 1) {
    // F.6.6.2/3: radii too small to span the chord are scaled up uniformly.
    const growth = Math.sqrt(lambda);
    radiusX *= growth;
    radiusY *= growth;
  }

  const radiusXSquared = radiusX * radiusX;
  const radiusYSquared = radiusY * radiusY;
  const primedXSquared = primedX * primedX;
  const primedYSquared = primedY * primedY;
  const denominator =
    radiusXSquared * primedYSquared + radiusYSquared * primedXSquared;
  if (denominator === 0) {
    appendLine(path, state, endX, endY);
    return;
  }
  const numerator = radiusXSquared * radiusYSquared - denominator;
  const scale =
    (largeArc === sweep ? -1 : 1) *
    Math.sqrt(Math.max(0, numerator / denominator));
  const centerPrimedX = (scale * (radiusX * primedY)) / radiusY;
  const centerPrimedY = (-scale * (radiusY * primedX)) / radiusX;
  const centerX =
    cosRotation * centerPrimedX -
    sinRotation * centerPrimedY +
    (startX + endX) * 0.5;
  const centerY =
    sinRotation * centerPrimedX +
    cosRotation * centerPrimedY +
    (startY + endY) * 0.5;

  const startAngle = Math.atan2(
    (primedY - centerPrimedY) / radiusY,
    (primedX - centerPrimedX) / radiusX,
  );
  const endAngle = Math.atan2(
    (-primedY - centerPrimedY) / radiusY,
    (-primedX - centerPrimedX) / radiusX,
  );

  if (
    !Number.isFinite(centerX) ||
    !Number.isFinite(centerY) ||
    !Number.isFinite(radiusX) ||
    !Number.isFinite(radiusY) ||
    !Number.isFinite(startAngle) ||
    !Number.isFinite(endAngle)
  ) {
    fail(
      scanner,
      at,
      "this arc's centre parameterization overflows to a non-finite value; " +
        "its coordinates or radii are too large to be represented",
    );
  }
  if (startAngle === endAngle) {
    appendLine(path, state, endX, endY);
    return;
  }

  let delta = endAngle - startAngle;
  if (!sweep && delta > 0) {
    delta -= TAU;
  } else if (sweep && delta < 0) {
    delta += TAU;
  }

  // The arc's start is authoritative over the endpoint of whatever reaches it:
  // SVG says the arc begins at the current point, and this is the only place
  // that statement can be made exactly true (see `ReaderState.pending`). The
  // probe carries the same centre, radii, rotation and start angle the stored
  // command will, so it lands on the same point the flattener will compute —
  // `deltaAngle` does not enter a start point.
  const start = arcPoint(
    {
      kind: "arc",
      centerX,
      centerY,
      radiusX,
      radiusY,
      rotation,
      startAngle,
      deltaAngle: delta,
    },
    startAngle,
  );
  const pending = state.pending;
  if (pending !== undefined) {
    pending.x = start.x;
    pending.y = start.y;
  }
  flushPending(path, state);

  path.ellipse(
    centerX,
    centerY,
    radiusX,
    radiusY,
    rotation,
    startAngle,
    startAngle + delta,
    delta < 0,
  );
  // The document's endpoint, not the arc's recomputed one. They differ by ulps;
  // taking the document's keeps a long chain of *relative* commands faithful to
  // the arithmetic its author did, which is the error that would accumulate.
  state.x = endX;
  state.y = endY;
}

/** Executes one command letter and all of its argument sets. */
function executeCommand(
  scanner: Scanner,
  path: Path,
  state: ReaderState,
  letter: string,
  at: number,
): void {
  const relative = letter >= "a" && letter <= "z";
  switch (relative ? letter : letter.toLowerCase()) {
    case "m": {
      let first = true;
      do {
        const x = readCoordinate(scanner, relative, state.x);
        const y = readCoordinate(scanner, relative, state.y);
        if (first) {
          flushPending(path, state);
          path.moveTo(x, y);
          state.startX = x;
          state.startY = y;
          state.x = x;
          state.y = y;
          first = false;
        } else {
          // The grammar's implicit lineto: `M 0 0 1 1` is a move and a line.
          appendLine(path, state, x, y);
        }
      } while (moreArguments(scanner));
      state.open = true;
      state.controlKind = "none";
      return;
    }
    case "l": {
      do {
        const x = readCoordinate(scanner, relative, state.x);
        const y = readCoordinate(scanner, relative, state.y);
        appendLine(path, state, x, y);
      } while (moreArguments(scanner));
      state.open = true;
      state.controlKind = "none";
      return;
    }
    case "h": {
      do {
        const x = readCoordinate(scanner, relative, state.x);
        appendLine(path, state, x, state.y);
      } while (moreArguments(scanner));
      state.open = true;
      state.controlKind = "none";
      return;
    }
    case "v": {
      do {
        const y = readCoordinate(scanner, relative, state.y);
        appendLine(path, state, state.x, y);
      } while (moreArguments(scanner));
      state.open = true;
      state.controlKind = "none";
      return;
    }
    case "c": {
      do {
        const control1X = readCoordinate(scanner, relative, state.x);
        const control1Y = readCoordinate(scanner, relative, state.y);
        const control2X = readCoordinate(scanner, relative, state.x);
        const control2Y = readCoordinate(scanner, relative, state.y);
        const x = readCoordinate(scanner, relative, state.x);
        const y = readCoordinate(scanner, relative, state.y);
        deferSegment(path, state, {
          kind: "cubic",
          control1X,
          control1Y,
          control2X,
          control2Y,
          x,
          y,
        });
        state.controlX = control2X;
        state.controlY = control2Y;
        state.controlKind = "cubic";
      } while (moreArguments(scanner));
      state.open = true;
      return;
    }
    case "s": {
      do {
        // The smooth shorthand: reflect the previous cubic's second control
        // point, or — after anything else — start from the current point.
        const reflect = state.controlKind === "cubic";
        const control1X = reflect ? 2 * state.x - state.controlX : state.x;
        const control1Y = reflect ? 2 * state.y - state.controlY : state.y;
        const control2X = readCoordinate(scanner, relative, state.x);
        const control2Y = readCoordinate(scanner, relative, state.y);
        const x = readCoordinate(scanner, relative, state.x);
        const y = readCoordinate(scanner, relative, state.y);
        deferSegment(path, state, {
          kind: "cubic",
          control1X,
          control1Y,
          control2X,
          control2Y,
          x,
          y,
        });
        state.controlX = control2X;
        state.controlY = control2Y;
        state.controlKind = "cubic";
      } while (moreArguments(scanner));
      state.open = true;
      return;
    }
    case "q": {
      do {
        const controlX = readCoordinate(scanner, relative, state.x);
        const controlY = readCoordinate(scanner, relative, state.y);
        const x = readCoordinate(scanner, relative, state.x);
        const y = readCoordinate(scanner, relative, state.y);
        deferSegment(path, state, {
          kind: "quadratic",
          control1X: controlX,
          control1Y: controlY,
          control2X: 0,
          control2Y: 0,
          x,
          y,
        });
        state.controlX = controlX;
        state.controlY = controlY;
        state.controlKind = "quadratic";
      } while (moreArguments(scanner));
      state.open = true;
      return;
    }
    case "t": {
      do {
        const reflect = state.controlKind === "quadratic";
        const controlX = reflect ? 2 * state.x - state.controlX : state.x;
        const controlY = reflect ? 2 * state.y - state.controlY : state.y;
        const x = readCoordinate(scanner, relative, state.x);
        const y = readCoordinate(scanner, relative, state.y);
        deferSegment(path, state, {
          kind: "quadratic",
          control1X: controlX,
          control1Y: controlY,
          control2X: 0,
          control2Y: 0,
          x,
          y,
        });
        state.controlX = controlX;
        state.controlY = controlY;
        state.controlKind = "quadratic";
      } while (moreArguments(scanner));
      state.open = true;
      return;
    }
    case "a": {
      do {
        const radiusX = readNumber(scanner);
        const radiusY = readNumber(scanner);
        const rotationDegrees = readNumber(scanner);
        const largeArc = readFlag(scanner);
        const sweep = readFlag(scanner);
        const x = readCoordinate(scanner, relative, state.x);
        const y = readCoordinate(scanner, relative, state.y);
        appendArc(
          scanner,
          path,
          state,
          at,
          radiusX,
          radiusY,
          rotationDegrees,
          largeArc,
          sweep,
          x,
          y,
        );
      } while (moreArguments(scanner));
      state.open = true;
      state.controlKind = "none";
      return;
    }
    case "z": {
      flushPending(path, state);
      if (state.open) {
        path.close();
        state.open = false;
      }
      state.x = state.startX;
      state.y = state.startY;
      state.controlKind = "none";
      return;
    }
    default:
      return fail(scanner, at, "expected a path command letter");
  }
}

/**
 * Parses an SVG `d` attribute into a §51 {@link Path} (§50 "SVG import").
 *
 * ```ts
 * const heart = parseSvgPathData("M 0 0 C 0 -6 10 -6 10 0 C 10 6 0 10 0 16");
 * heart.commands.length; // 3
 * ```
 *
 * Coordinates are transcribed **verbatim**: SVG's Y-down user space is not
 * reconciled with §7a's Y-up world here, because the transform that would do it
 * needs the document's `viewBox`. See this module's header — it is one exact
 * {@link Path.transform} away, and the reasoning is worth reading before
 * assuming this is an oversight.
 *
 * The returned path carries the default `nonzero` {@link Path.fillRule};
 * SVG's `fill-rule` is a presentation attribute and is not part of path data.
 *
 * One coordinate can differ from the document's by a few ulps: the endpoint of
 * a segment that is immediately followed by an `A`, which is moved onto the
 * arc's computed start so the two do not disagree at a sub-ulp scale and
 * produce a spike §52 refuses. The module header argues it in full.
 *
 * @param pathData the `d` attribute's value; empty or whitespace-only yields an
 * empty path, which is what SVG says such a path draws
 * @param options §96 bounds on the untrusted text
 * @returns a fresh path
 * @throws FourError `UNTRUSTED_INPUT_REJECTED` when the text exceeds
 * {@link SvgPathParseOptions.maximumTextLength}
 * @throws a `SyntaxError`, naming the offset, for anything the `d` grammar does
 * not admit — nothing parsed before the error is kept
 * @throws a `RangeError` when `maximumTextLength` is not a positive number
 */
export function parseSvgPathData(
  pathData: string,
  options: SvgPathParseOptions = {},
): Path {
  if (typeof pathData !== "string") {
    throw new SyntaxError(
      `parseSvgPathData: path data must be a string; got ${typeof pathData} (§96).`,
    );
  }
  const limit = effectiveTextLimit(options.maximumTextLength);
  if (pathData.length > limit) {
    throw new FourError(
      "UNTRUSTED_INPUT_REJECTED",
      `parseSvgPathData: path data of ${String(pathData.length)} code units ` +
        `exceeds maximumTextLength ${String(limit)} (§96).`,
      {
        context: {
          limitName: "maximumTextLength",
          limit,
          observed: pathData.length,
        },
      },
    );
  }

  const path = new Path();
  const scanner: Scanner = { text: pathData, index: 0 };
  skipWhitespace(scanner);
  if (scanner.index >= pathData.length) {
    return path;
  }
  const first = pathData.charAt(scanner.index);
  if (first !== "M" && first !== "m") {
    fail(
      scanner,
      scanner.index,
      "path data must begin with a moveto command (`M` or `m`)",
    );
  }

  const state: ReaderState = {
    x: 0,
    y: 0,
    startX: 0,
    startY: 0,
    controlX: 0,
    controlY: 0,
    controlKind: "none",
    open: false,
    pending: undefined,
  };
  for (;;) {
    skipWhitespace(scanner);
    if (scanner.index >= pathData.length) {
      // The last held-back segment: nothing followed it, so it is written
      // exactly as the document wrote it.
      flushPending(path, state);
      return path;
    }
    const at = scanner.index;
    const letter = pathData.charAt(at);
    scanner.index = at + 1;
    executeCommand(scanner, path, state, letter, at);
  }
}

/** Validates {@link SvgPathParseOptions.maximumTextLength} (§85). */
function effectiveTextLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_MAXIMUM_PATH_DATA_LENGTH;
  }
  // `!(value > 0)` so `NaN`, which compares false against everything, is
  // refused by the same branch as zero and negatives.
  if (!(value > 0)) {
    throw new RangeError(
      `maximumTextLength must be a positive number; got ${String(value)} (§85).`,
    );
  }
  return value;
}

/**
 * JavaScript's shortest round-tripping decimal, or a rounded decimal when
 * `precision` is supplied. The no-precision path is `String(value)` exactly,
 * so the default output is bit-identical to the pre-option writer.
 */
function formatNumber(value: number, precision: number | undefined): string {
  if (precision === undefined) {
    return String(value);
  }
  const factor = 10 ** precision;
  return String(Math.round(value * factor) / factor);
}

/** Validates {@link SvgPathFormatOptions.precision} (§85). */
function effectivePrecision(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 0 || value > 20) {
    throw new RangeError(
      `formatSvgPathData: precision must be an integer in 0…20; got ${String(value)} (§85).`,
    );
  }
  return value;
}

/**
 * Writes one §51 arc as SVG `A` commands, plus the explicit `L` that stands in
 * for §51's implicit connecting segment.
 *
 * A full turn is split into two half turns because SVG's F.6.2 drops an `A`
 * whose endpoints coincide; every other sweep is one command. A zero sweep
 * emits nothing at all, which is what it draws.
 */
function writeArc(
  command: PathArcCommand,
  cursor: PathCursor,
  parts: string[],
  precision: number | undefined,
): void {
  const start = arcPoint(command, command.startAngle);
  if (cursor.x !== start.x || cursor.y !== start.y) {
    parts.push(
      `L ${formatNumber(start.x, precision)} ${formatNumber(start.y, precision)}`,
    );
  }
  const pieces = Math.abs(command.deltaAngle) === TAU ? 2 : 1;
  // Exact: halving a double is exact, and doubling the half recovers it.
  const step = command.deltaAngle / pieces;
  const largeArc = Math.abs(step) > Math.PI ? "1" : "0";
  const sweep = command.deltaAngle > 0 ? "1" : "0";
  const radii = `${formatNumber(command.radiusX, precision)} ${formatNumber(command.radiusY, precision)}`;
  const rotation = formatNumber(
    command.rotation * RADIANS_TO_DEGREES,
    precision,
  );
  let from = start;
  for (let piece = 1; piece <= pieces; piece += 1) {
    const to = arcPoint(command, command.startAngle + step * piece);
    if (to.x !== from.x || to.y !== from.y) {
      parts.push(
        `A ${radii} ${rotation} ${largeArc} ${sweep} ` +
          `${formatNumber(to.x, precision)} ${formatNumber(to.y, precision)}`,
      );
    }
    from = to;
  }
}

/**
 * Writes a §51 {@link Path} as an SVG `d` attribute (§50 "SVG export").
 *
 * ```ts
 * formatSvgPathData(new Path().moveTo(0, 0).lineTo(10, 0).close());
 * // "M 0 0 L 10 0 Z"
 * ```
 *
 * Absolute uppercase commands, single spaces, no commas, and every number as
 * `String(value)` — lossless and, unlike a fixed-decimal format, exactly
 * specified by ECMA-262. Pass `{ precision }` to opt into a rounded writer;
 * omitting it keeps this default, so the determinism golden does not move.
 *
 * Coordinates are written **verbatim**, so the output is in the path's own
 * space: a path authored in §7a's Y-up world renders mirrored in an SVG viewer
 * unless the caller flips it first. That is the same decision
 * {@link parseSvgPathData} makes, in the other direction.
 *
 * Round trip: for a path of moves, lines, quadratics, cubics and closes,
 * `parseSvgPathData(formatSvgPathData(path))` reproduces the command list bit
 * for bit. For a path containing arcs it reproduces the *shape* to within a few
 * ulps — SVG stores an arc by its endpoints and its rotation in degrees, and
 * neither conversion is exact.
 *
 * @param path any path, including an empty one (which yields `""`)
 * @param options optional {@link SvgPathFormatOptions.precision}; omitted
 *   output is identical to the lossless `String(value)` writer
 * @returns the `d` attribute's value, with no leading or trailing space
 */
export function formatSvgPathData(
  path: Path,
  options: SvgPathFormatOptions = {},
): string {
  const precision = effectivePrecision(options.precision);
  const parts: string[] = [];
  const cursor = newCursor();
  for (const command of path.commands) {
    switch (command.kind) {
      case "move":
        parts.push(
          `M ${formatNumber(command.x, precision)} ${formatNumber(command.y, precision)}`,
        );
        break;
      case "line":
        parts.push(
          `L ${formatNumber(command.x, precision)} ${formatNumber(command.y, precision)}`,
        );
        break;
      case "quadratic":
        parts.push(
          `Q ${formatNumber(command.controlX, precision)} ${formatNumber(command.controlY, precision)} ` +
            `${formatNumber(command.x, precision)} ${formatNumber(command.y, precision)}`,
        );
        break;
      case "cubic":
        parts.push(
          `C ${formatNumber(command.control1X, precision)} ${formatNumber(command.control1Y, precision)} ` +
            `${formatNumber(command.control2X, precision)} ${formatNumber(command.control2Y, precision)} ` +
            `${formatNumber(command.x, precision)} ${formatNumber(command.y, precision)}`,
        );
        break;
      case "arc":
        writeArc(command, cursor, parts, precision);
        break;
      case "close":
        parts.push("Z");
        break;
    }
    advance(command, cursor);
  }
  return parts.join(" ");
}
