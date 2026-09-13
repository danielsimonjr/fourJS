/**
 * §50's SVG **document** tier: a small XML tokenizer that turns `<svg>`
 * markup into {@link Path}s, without `DOMParser`.
 *
 * The owner decision (R-26, 2026-09-06) is to ship the tokenizer here so
 * `@fourjs/geometry` stays node-safe (`bun run graph:check`). There is no
 * environment seam and no DOM. Hostile input is refused before anything is
 * built: `<!DOCTYPE`, `<!ENTITY`, and any other `<!` declaration that is not
 * a comment — §96's "no external entities, no code from scene files".
 *
 * Coordinates are **transcribed**, matching {@link parseSvgPathData}. SVG
 * user space is Y-down; fourJS is Y-up (§7a). The transform that would land
 * content in a Y-up world needs {@link SvgDocument.viewBox}; it is one
 * {@link Path.transform} at the caller, and this module does not apply half
 * of it silently. `viewBox` is returned so that line is writeable.
 *
 * Handled elements: `svg`, `g`, `path`, `rect`, `circle`, `ellipse`, `line`,
 * `polyline`, `polygon`. Presentation: `viewBox`, `transform` (`translate` /
 * `rotate` / `scale` / `matrix`), `fill`, `stroke`, `fill-rule`. Nested
 * groups accumulate transforms. Unknown elements are walked so a wrapper
 * does not hide geometry; `defs` / `symbol` / `clipPath` / `mask` / `title`
 * / `desc` / `metadata` / `style` / `script` are skipped whole.
 */

import { FourError } from "@fourjs/core";
import { Matrix3 } from "@fourjs/math";

import { Path, type FillRule } from "./path.js";
import {
  DEFAULT_MAXIMUM_PATH_DATA_LENGTH,
  parseSvgPathData,
  type SvgPathParseOptions,
} from "./svg-path.js";

/** Elements whose descendants are not rendered geometry. */
const SKIP_TREE = new Set([
  "defs",
  "symbol",
  "clippath",
  "mask",
  "title",
  "desc",
  "metadata",
  "style",
  "script",
]);

const CHAR_TAB = 0x09;
const CHAR_LF = 0x0a;
const CHAR_CR = 0x0d;
const CHAR_SPACE = 0x20;
const CHAR_BANG = 0x21;
const CHAR_QUOTE = 0x22;
const CHAR_AMP = 0x26;
const CHAR_APOS = 0x27;
const CHAR_MINUS = 0x2d;
const CHAR_SLASH = 0x2f;
const CHAR_LT = 0x3c;
const CHAR_EQ = 0x3d;
const CHAR_GT = 0x3e;
const CHAR_QMARK = 0x3f;

/** Default ceiling on one SVG document, in UTF-16 code units (§96). */
export const DEFAULT_MAXIMUM_SVG_DOCUMENT_LENGTH = 4_194_304;

/** §96 bounds for one untrusted SVG document. */
export interface SvgDocumentParseOptions extends SvgPathParseOptions {
  /**
   * Maximum length of the whole document in UTF-16 code units. Defaults to
   * {@link DEFAULT_MAXIMUM_SVG_DOCUMENT_LENGTH}.
   */
  readonly maximumTextLength?: number;
}

/** The SVG `viewBox` attribute, parsed. */
export interface SvgViewBox {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

/**
 * One geometry element recovered from an SVG document, with the
 * presentation attributes that have a home on {@link Path} or that a
 * caller will need when §58's paints land.
 */
export interface SvgDocumentPath {
  readonly path: Path;
  readonly fill: string | undefined;
  readonly stroke: string | undefined;
}

/** Parsed SVG document: paths in document order, plus the root `viewBox`. */
export interface SvgDocument {
  readonly viewBox: SvgViewBox | undefined;
  readonly paths: readonly SvgDocumentPath[];
}

interface Presentation {
  fill: string | undefined;
  stroke: string | undefined;
  fillRule: FillRule;
  transform: Matrix3;
}

interface OpenTag {
  readonly name: string;
  readonly attributes: Map<string, string>;
  readonly selfClosing: boolean;
}

/**
 * Parses an SVG document into paths (§50 document tier).
 *
 * @param svg Untrusted markup. Must be a string.
 * @param options §96 bounds.
 * @returns Paths in document order, plus the root `viewBox` when present.
 * @throws FourError `UNTRUSTED_INPUT_REJECTED` for `<!DOCTYPE`, `<!ENTITY`,
 *   other markup declarations, unknown entity references, or a size limit.
 * @throws SyntaxError for markup the tokenizer cannot read.
 */
export function parseSvgDocument(
  svg: string,
  options: SvgDocumentParseOptions = {},
): SvgDocument {
  if (typeof svg !== "string") {
    throw new SyntaxError(
      `parseSvgDocument: document must be a string; got ${typeof svg} (§96).`,
    );
  }
  const limit = effectiveLimit(options.maximumTextLength);
  if (svg.length > limit) {
    throw new FourError(
      "UNTRUSTED_INPUT_REJECTED",
      `parseSvgDocument: document of ${String(svg.length)} code units ` +
        `exceeds maximumTextLength ${String(limit)} (§96).`,
      {
        context: {
          limitName: "maximumTextLength",
          limit,
          observed: svg.length,
        },
      },
    );
  }
  refuseDeclarations(svg);

  const scanner = { text: svg, index: 0 };
  const paths: SvgDocumentPath[] = [];
  let viewBox: SvgViewBox | undefined;
  const stack: Presentation[] = [
    {
      fill: undefined,
      stroke: undefined,
      fillRule: "nonzero",
      transform: new Matrix3(),
    },
  ];

  while (scanner.index < svg.length) {
    const ch = svg.charCodeAt(scanner.index);
    if (ch !== CHAR_LT) {
      scanner.index += 1;
      continue;
    }
    const next = svg.charCodeAt(scanner.index + 1);
    if (next === CHAR_BANG) {
      skipComment(scanner);
      continue;
    }
    if (next === CHAR_QMARK) {
      skipProcessingInstruction(scanner);
      continue;
    }
    if (next === CHAR_SLASH) {
      const name = readCloseTag(scanner);
      if (SKIP_TREE.has(name)) {
        continue;
      }
      if (stack.length > 1) {
        stack.pop();
      }
      continue;
    }
    const tag = readOpenTag(scanner);
    if (SKIP_TREE.has(tag.name)) {
      if (!tag.selfClosing) {
        skipElementTree(scanner, tag.name);
      }
      continue;
    }
    const parent = stack[stack.length - 1];
    const current = inherit(parent, tag.attributes);
    if (tag.name === "svg" && viewBox === undefined) {
      viewBox = parseViewBox(tag.attributes.get("viewbox"));
    }
    if (tag.attributes.get("display") === "none") {
      if (!tag.selfClosing) {
        skipElementTree(scanner, tag.name);
      }
      continue;
    }
    const built = elementPath(tag.name, tag.attributes, options);
    if (built !== undefined) {
      built.fillRule = current.fillRule;
      const path = applyPathTransform(built, current.transform);
      path.fillRule = current.fillRule;
      paths.push({
        path,
        fill: current.fill,
        stroke: current.stroke,
      });
    }
    if (!tag.selfClosing) {
      stack.push(current);
    }
  }

  return { viewBox, paths };
}

function effectiveLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_MAXIMUM_SVG_DOCUMENT_LENGTH;
  }
  if (!(value > 0)) {
    throw new RangeError(
      `maximumTextLength must be a positive number; got ${String(value)} (§85).`,
    );
  }
  return value;
}

/** Refuses DOCTYPE, ENTITY, and any other `<!` that is not a comment. */
function refuseDeclarations(text: string): void {
  const length = text.length;
  for (let i = 0; i + 1 < length; i += 1) {
    if (text.charCodeAt(i) !== CHAR_LT || text.charCodeAt(i + 1) !== CHAR_BANG) {
      continue;
    }
    if (text.startsWith("<!--", i)) {
      continue;
    }
    const head = text.slice(i, Math.min(i + 12, length)).toLowerCase();
    if (head.startsWith("<!doctype")) {
      throw new FourError(
        "UNTRUSTED_INPUT_REJECTED",
        "parseSvgDocument: <!DOCTYPE is refused (§96).",
        { context: { reason: "doctype" } },
      );
    }
    if (head.startsWith("<!entity")) {
      throw new FourError(
        "UNTRUSTED_INPUT_REJECTED",
        "parseSvgDocument: DTD entity declarations are refused (§96).",
        { context: { reason: "entity" } },
      );
    }
    throw new FourError(
      "UNTRUSTED_INPUT_REJECTED",
      "parseSvgDocument: markup declarations are refused (§96).",
      { context: { reason: "declaration" } },
    );
  }
}

function skipComment(scanner: { text: string; index: number }): void {
  const { text } = scanner;
  if (!text.startsWith("<!--", scanner.index)) {
    throw new FourError(
      "UNTRUSTED_INPUT_REJECTED",
      "parseSvgDocument: markup declarations are refused (§96).",
      { context: { reason: "declaration" } },
    );
  }
  const end = text.indexOf("-->", scanner.index + 4);
  if (end < 0) {
    throw new SyntaxError("parseSvgDocument: unterminated comment (§85).");
  }
  scanner.index = end + 3;
}

function skipProcessingInstruction(scanner: {
  text: string;
  index: number;
}): void {
  const end = scanner.text.indexOf("?>", scanner.index + 2);
  if (end < 0) {
    throw new SyntaxError(
      "parseSvgDocument: unterminated processing instruction (§85).",
    );
  }
  scanner.index = end + 2;
}

function readCloseTag(scanner: { text: string; index: number }): string {
  // </name>
  scanner.index += 2;
  skipXmlSpace(scanner);
  const name = readName(scanner);
  skipXmlSpace(scanner);
  if (scanner.text.charCodeAt(scanner.index) !== CHAR_GT) {
    throw new SyntaxError(
      `parseSvgDocument: expected '>' after </${name} (§85).`,
    );
  }
  scanner.index += 1;
  return name;
}

function readOpenTag(scanner: { text: string; index: number }): OpenTag {
  scanner.index += 1;
  const name = readName(scanner);
  const attributes = new Map<string, string>();
  for (;;) {
    skipXmlSpace(scanner);
    const code = scanner.text.charCodeAt(scanner.index);
    if (code === CHAR_GT) {
      scanner.index += 1;
      return { name, attributes, selfClosing: false };
    }
    if (code === CHAR_SLASH && scanner.text.charCodeAt(scanner.index + 1) === CHAR_GT) {
      scanner.index += 2;
      return { name, attributes, selfClosing: true };
    }
    if (scanner.index >= scanner.text.length) {
      throw new SyntaxError("parseSvgDocument: unterminated start tag (§85).");
    }
    const attrName = readName(scanner);
    skipXmlSpace(scanner);
    if (scanner.text.charCodeAt(scanner.index) !== CHAR_EQ) {
      throw new SyntaxError(
        `parseSvgDocument: attribute ${attrName} is missing a value (§85).`,
      );
    }
    scanner.index += 1;
    skipXmlSpace(scanner);
    attributes.set(attrName, readAttributeValue(scanner));
  }
}

function readName(scanner: { text: string; index: number }): string {
  const start = scanner.index;
  const { text } = scanner;
  while (scanner.index < text.length) {
    const code = text.charCodeAt(scanner.index);
    if (
      code === CHAR_LT ||
      code === CHAR_GT ||
      code === CHAR_SLASH ||
      code === CHAR_EQ ||
      code === CHAR_SPACE ||
      code === CHAR_TAB ||
      code === CHAR_LF ||
      code === CHAR_CR
    ) {
      break;
    }
    scanner.index += 1;
  }
  if (scanner.index === start) {
    throw new SyntaxError("parseSvgDocument: expected an element name (§85).");
  }
  const raw = text.slice(start, scanner.index);
  const colon = raw.lastIndexOf(":");
  return (colon >= 0 ? raw.slice(colon + 1) : raw).toLowerCase();
}

function readAttributeValue(scanner: { text: string; index: number }): string {
  const quote = scanner.text.charCodeAt(scanner.index);
  if (quote !== CHAR_QUOTE && quote !== CHAR_APOS) {
    throw new SyntaxError(
      "parseSvgDocument: attribute values must be quoted (§85).",
    );
  }
  scanner.index += 1;
  const start = scanner.index;
  const { text } = scanner;
  while (scanner.index < text.length) {
    const code = text.charCodeAt(scanner.index);
    if (code === quote) {
      const raw = text.slice(start, scanner.index);
      scanner.index += 1;
      return decodeEntities(raw);
    }
    if (code === CHAR_LT) {
      throw new SyntaxError(
        "parseSvgDocument: '<' is not allowed in an attribute value (§85).",
      );
    }
    scanner.index += 1;
  }
  throw new SyntaxError("parseSvgDocument: unterminated attribute value (§85).");
}

function decodeEntities(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code !== CHAR_AMP) {
      out += value.charAt(i);
      continue;
    }
    if (value.startsWith("&amp;", i)) {
      out += "&";
      i += 4;
      continue;
    }
    if (value.startsWith("&lt;", i)) {
      out += "<";
      i += 3;
      continue;
    }
    if (value.startsWith("&gt;", i)) {
      out += ">";
      i += 3;
      continue;
    }
    if (value.startsWith("&quot;", i)) {
      out += '"';
      i += 5;
      continue;
    }
    if (value.startsWith("&apos;", i)) {
      out += "'";
      i += 5;
      continue;
    }
    if (value.charAt(i + 1) === "#") {
      const { char, next } = decodeNumericEntity(value, i);
      out += char;
      i = next - 1;
      continue;
    }
    throw new FourError(
      "UNTRUSTED_INPUT_REJECTED",
      "parseSvgDocument: unknown entity references are refused (§96).",
      { context: { reason: "entity-ref" } },
    );
  }
  return out;
}

function decodeNumericEntity(
  value: string,
  at: number,
): { char: string; next: number } {
  let i = at + 2;
  let hex = false;
  if (value.charAt(i) === "x" || value.charAt(i) === "X") {
    hex = true;
    i += 1;
  }
  const start = i;
  while (i < value.length && value.charAt(i) !== ";") {
    i += 1;
  }
  if (i >= value.length || start === i) {
    throw new SyntaxError(
      "parseSvgDocument: unterminated numeric character reference (§85).",
    );
  }
  const digits = value.slice(start, i);
  const codePoint = hex ? Number.parseInt(digits, 16) : Number.parseInt(digits, 10);
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    throw new SyntaxError(
      "parseSvgDocument: invalid numeric character reference (§85).",
    );
  }
  return { char: String.fromCodePoint(codePoint), next: i + 1 };
}

function skipXmlSpace(scanner: { text: string; index: number }): void {
  const { text } = scanner;
  while (scanner.index < text.length) {
    const code = text.charCodeAt(scanner.index);
    if (
      code !== CHAR_SPACE &&
      code !== CHAR_TAB &&
      code !== CHAR_LF &&
      code !== CHAR_CR
    ) {
      break;
    }
    scanner.index += 1;
  }
}

function skipElementTree(
  scanner: { text: string; index: number },
  name: string,
): void {
  let depth = 1;
  while (scanner.index < scanner.text.length && depth > 0) {
    const ch = scanner.text.charCodeAt(scanner.index);
    if (ch !== CHAR_LT) {
      scanner.index += 1;
      continue;
    }
    const next = scanner.text.charCodeAt(scanner.index + 1);
    if (next === CHAR_BANG) {
      skipComment(scanner);
      continue;
    }
    if (next === CHAR_QMARK) {
      skipProcessingInstruction(scanner);
      continue;
    }
    if (next === CHAR_SLASH) {
      const closed = readCloseTag(scanner);
      if (closed === name) {
        depth -= 1;
      }
      continue;
    }
    const inner = readOpenTag(scanner);
    if (inner.name === name && !inner.selfClosing) {
      depth += 1;
    }
  }
  if (depth !== 0) {
    throw new SyntaxError(
      `parseSvgDocument: unterminated <${name}> (§85).`,
    );
  }
}

function inherit(
  parent: Presentation,
  attributes: Map<string, string>,
): Presentation {
  const fill = attributes.get("fill") ?? parent.fill;
  const stroke = attributes.get("stroke") ?? parent.stroke;
  const fillRule =
    parseFillRule(attributes.get("fill-rule") ?? attributes.get("fillrule")) ??
    parent.fillRule;
  const transform = parent.transform.clone();
  const local = attributes.get("transform");
  if (local !== undefined && local.trim() !== "") {
    transform.multiply(parseTransform(local));
  }
  return { fill, stroke, fillRule, transform };
}

function parseFillRule(value: string | undefined): FillRule | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalised = value.trim().toLowerCase();
  if (normalised === "evenodd" || normalised === "even-odd") {
    return "even-odd";
  }
  if (normalised === "nonzero" || normalised === "non-zero") {
    return "nonzero";
  }
  return undefined;
}

function parseViewBox(value: string | undefined): SvgViewBox | undefined {
  if (value === undefined) {
    return undefined;
  }
  const numbers = readNumberList(value);
  if (numbers.length < 4) {
    throw new SyntaxError(
      "parseSvgDocument: viewBox needs four numbers (§85).",
    );
  }
  return {
    minX: numbers[0],
    minY: numbers[1],
    width: numbers[2],
    height: numbers[3],
  };
}

function elementPath(
  name: string,
  attributes: Map<string, string>,
  options: SvgPathParseOptions,
): Path | undefined {
  switch (name) {
    case "path": {
      const d = attributes.get("d");
      if (d === undefined || d.trim() === "") {
        return undefined;
      }
      return parseSvgPathData(d, {
        maximumTextLength:
          options.maximumTextLength ?? DEFAULT_MAXIMUM_PATH_DATA_LENGTH,
      });
    }
    case "rect":
      return rectPath(attributes);
    case "circle":
      return circlePath(attributes);
    case "ellipse":
      return ellipsePath(attributes);
    case "line":
      return linePath(attributes);
    case "polyline":
      return polyPath(attributes, false);
    case "polygon":
      return polyPath(attributes, true);
    default:
      return undefined;
  }
}

function attrNumber(
  attributes: Map<string, string>,
  name: string,
  fallback = 0,
): number {
  const raw = attributes.get(name);
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new SyntaxError(
      `parseSvgDocument: ${name} must be a finite number; got ${raw} (§85).`,
    );
  }
  return value;
}

function rectPath(attributes: Map<string, string>): Path | undefined {
  const x = attrNumber(attributes, "x");
  const y = attrNumber(attributes, "y");
  const width = attrNumber(attributes, "width");
  const height = attrNumber(attributes, "height");
  if (width === 0 || height === 0) {
    return undefined;
  }
  if (width < 0 || height < 0) {
    throw new SyntaxError(
      "parseSvgDocument: rect width and height must be non-negative (§85).",
    );
  }
  return new Path()
    .moveTo(x, y)
    .lineTo(x + width, y)
    .lineTo(x + width, y + height)
    .lineTo(x, y + height)
    .close();
}

function circlePath(attributes: Map<string, string>): Path | undefined {
  const cx = attrNumber(attributes, "cx");
  const cy = attrNumber(attributes, "cy");
  const r = attrNumber(attributes, "r");
  if (r === 0) {
    return undefined;
  }
  if (r < 0) {
    throw new SyntaxError("parseSvgDocument: circle r must be non-negative (§85).");
  }
  return new Path().ellipse(cx, cy, r, r, 0, 0, Math.PI * 2);
}

function ellipsePath(attributes: Map<string, string>): Path | undefined {
  const cx = attrNumber(attributes, "cx");
  const cy = attrNumber(attributes, "cy");
  const rx = attrNumber(attributes, "rx");
  const ry = attrNumber(attributes, "ry");
  if (rx === 0 || ry === 0) {
    return undefined;
  }
  if (rx < 0 || ry < 0) {
    throw new SyntaxError(
      "parseSvgDocument: ellipse rx and ry must be non-negative (§85).",
    );
  }
  return new Path().ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
}

function linePath(attributes: Map<string, string>): Path {
  const x1 = attrNumber(attributes, "x1");
  const y1 = attrNumber(attributes, "y1");
  const x2 = attrNumber(attributes, "x2");
  const y2 = attrNumber(attributes, "y2");
  return new Path().moveTo(x1, y1).lineTo(x2, y2);
}

function polyPath(
  attributes: Map<string, string>,
  closed: boolean,
): Path | undefined {
  const raw = attributes.get("points");
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  const numbers = readNumberList(raw);
  if (numbers.length < 4 || numbers.length % 2 !== 0) {
    throw new SyntaxError(
      "parseSvgDocument: points must be pairs of numbers (§85).",
    );
  }
  const path = new Path().moveTo(numbers[0], numbers[1]);
  for (let i = 2; i < numbers.length; i += 2) {
    path.lineTo(numbers[i], numbers[i + 1]);
  }
  if (closed) {
    path.close();
  }
  return path;
}

/**
 * Applies an SVG transform to a path. Similarities (including reflections)
 * go through {@link Path.transform} so arcs stay arcs. A non-similarity
 * would be refused for any path that contains an arc, so those cases flatten
 * first and rebuild from line segments — the document tier would rather
 * keep the shape than throw on `scale(2 1)` around a circle.
 */
function applyPathTransform(path: Path, matrix: Matrix3): Path {
  if (isIdentity(matrix)) {
    return path;
  }
  try {
    return path.transform(matrix);
  } catch {
    const mapped = new Path({ fillRule: path.fillRule });
    for (const poly of path.polylines()) {
      if (poly.points.length === 0) {
        continue;
      }
      const first = mapPoint(matrix, poly.points[0]);
      mapped.moveTo(first.x, first.y);
      for (let i = 1; i < poly.points.length; i += 1) {
        const point = mapPoint(matrix, poly.points[i]);
        mapped.lineTo(point.x, point.y);
      }
      if (poly.closed && mapped.commands.length > 1) {
        mapped.close();
      }
    }
    return mapped;
  }
}

function mapPoint(
  matrix: Matrix3,
  point: { readonly x: number; readonly y: number },
): { x: number; y: number } {
  const e = matrix.elements;
  return {
    x: e[0] * point.x + e[3] * point.y + e[6],
    y: e[1] * point.x + e[4] * point.y + e[7],
  };
}

function isIdentity(matrix: Matrix3): boolean {
  const e = matrix.elements;
  return (
    e[0] === 1 &&
    e[1] === 0 &&
    e[2] === 0 &&
    e[3] === 0 &&
    e[4] === 1 &&
    e[5] === 0 &&
    e[6] === 0 &&
    e[7] === 0 &&
    e[8] === 1
  );
}

/**
 * `translate` / `rotate` / `scale` / `matrix` — SVG 1.1 transform list.
 * Rotation is in **degrees** (SVG); the matrix stores radians' cos/sin.
 */
export function parseTransform(list: string): Matrix3 {
  const acc = new Matrix3();
  const scanner = { text: list, index: 0 };
  skipTransformSpace(scanner);
  if (scanner.index >= list.length) {
    return acc;
  }
  while (scanner.index < list.length) {
    skipTransformSpace(scanner);
    if (scanner.index >= list.length) {
      break;
    }
    const name = readTransformName(scanner);
    skipTransformSpace(scanner);
    if (list.charAt(scanner.index) !== "(") {
      throw new SyntaxError(
        `parseSvgDocument: transform ${name} is missing '(' (§85).`,
      );
    }
    scanner.index += 1;
    const args = readTransformArgs(scanner);
    applyTransformFunction(acc, name, args);
    skipTransformSpace(scanner);
    if (list.charAt(scanner.index) === ",") {
      scanner.index += 1;
    }
  }
  return acc;
}

function readTransformName(scanner: { text: string; index: number }): string {
  const start = scanner.index;
  while (scanner.index < scanner.text.length) {
    const ch = scanner.text.charAt(scanner.index);
    if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z")) {
      scanner.index += 1;
      continue;
    }
    break;
  }
  if (scanner.index === start) {
    throw new SyntaxError("parseSvgDocument: expected a transform function (§85).");
  }
  return scanner.text.slice(start, scanner.index);
}

function readTransformArgs(scanner: { text: string; index: number }): number[] {
  const args: number[] = [];
  for (;;) {
    skipTransformSpace(scanner);
    if (scanner.text.charAt(scanner.index) === ")") {
      scanner.index += 1;
      return args;
    }
    if (scanner.index >= scanner.text.length) {
      throw new SyntaxError(
        "parseSvgDocument: unterminated transform argument list (§85).",
      );
    }
    args.push(readTransformNumber(scanner));
    skipTransformSpace(scanner);
    if (scanner.text.charAt(scanner.index) === ",") {
      scanner.index += 1;
    }
  }
}

function readTransformNumber(scanner: { text: string; index: number }): number {
  const start = scanner.index;
  const { text } = scanner;
  const first = text.charCodeAt(scanner.index);
  if (first === 0x2b || first === CHAR_MINUS) {
    scanner.index += 1;
  }
  let sawDigit = false;
  while (scanner.index < text.length) {
    const code = text.charCodeAt(scanner.index);
    if (code >= 0x30 && code <= 0x39) {
      sawDigit = true;
      scanner.index += 1;
      continue;
    }
    break;
  }
  if (text.charCodeAt(scanner.index) === 0x2e) {
    scanner.index += 1;
    while (scanner.index < text.length) {
      const code = text.charCodeAt(scanner.index);
      if (code >= 0x30 && code <= 0x39) {
        sawDigit = true;
        scanner.index += 1;
        continue;
      }
      break;
    }
  }
  const exp = text.charCodeAt(scanner.index);
  if (exp === 0x65 || exp === 0x45) {
    scanner.index += 1;
    const sign = text.charCodeAt(scanner.index);
    if (sign === 0x2b || sign === CHAR_MINUS) {
      scanner.index += 1;
    }
    const expStart = scanner.index;
    while (scanner.index < text.length) {
      const code = text.charCodeAt(scanner.index);
      if (code >= 0x30 && code <= 0x39) {
        scanner.index += 1;
        continue;
      }
      break;
    }
    if (scanner.index === expStart) {
      throw new SyntaxError(
        "parseSvgDocument: transform exponent needs a digit (§85).",
      );
    }
  }
  const raw = text.slice(start, scanner.index);
  const value = Number(raw);
  if (!sawDigit || !Number.isFinite(value)) {
    throw new SyntaxError(
      `parseSvgDocument: expected a transform number; got ${raw} (§85).`,
    );
  }
  return value;
}

function skipTransformSpace(scanner: { text: string; index: number }): void {
  const { text } = scanner;
  while (scanner.index < text.length) {
    const code = text.charCodeAt(scanner.index);
    if (
      code !== CHAR_SPACE &&
      code !== CHAR_TAB &&
      code !== CHAR_LF &&
      code !== CHAR_CR &&
      code !== 0x2c
    ) {
      break;
    }
    // Commas between functions are handled by the caller; spaces only here
    // would swallow the comma that separates functions. Only skip whitespace.
    if (code === 0x2c) {
      break;
    }
    scanner.index += 1;
  }
}

function applyTransformFunction(
  acc: Matrix3,
  name: string,
  args: readonly number[],
): void {
  const next = new Matrix3();
  switch (name) {
    case "translate": {
      const tx = args[0];
      const ty = args[1] ?? 0;
      if (tx === undefined || args.length > 2) {
        throw new SyntaxError(
          "parseSvgDocument: translate takes 1 or 2 arguments (§85).",
        );
      }
      next.fromArray([1, 0, 0, 0, 1, 0, tx, ty, 1]);
      break;
    }
    case "scale": {
      const sx = args[0];
      const sy = args[1] ?? sx;
      if (sx === undefined || args.length > 2) {
        throw new SyntaxError(
          "parseSvgDocument: scale takes 1 or 2 arguments (§85).",
        );
      }
      next.fromArray([sx, 0, 0, 0, sy, 0, 0, 0, 1]);
      break;
    }
    case "rotate": {
      if (args.length !== 1 && args.length !== 3) {
        throw new SyntaxError(
          "parseSvgDocument: rotate takes 1 or 3 arguments (§85).",
        );
      }
      const radians = (args[0] * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const rotation = new Matrix3().fromArray([
        cos,
        sin,
        0,
        -sin,
        cos,
        0,
        0,
        0,
        1,
      ]);
      if (args.length === 3) {
        const cx = args[1];
        const cy = args[2];
        next.fromArray([1, 0, 0, 0, 1, 0, cx, cy, 1]);
        next.multiply(rotation);
        next.multiply(new Matrix3().fromArray([1, 0, 0, 0, 1, 0, -cx, -cy, 1]));
      } else {
        next.copy(rotation);
      }
      break;
    }
    case "matrix": {
      if (args.length !== 6) {
        throw new SyntaxError(
          "parseSvgDocument: matrix takes 6 arguments (§85).",
        );
      }
      // SVG matrix(a b c d e f) → x' = a x + c y + e, y' = b x + d y + f
      next.fromArray([args[0], args[1], 0, args[2], args[3], 0, args[4], args[5], 1]);
      break;
    }
    default:
      throw new SyntaxError(
        `parseSvgDocument: unsupported transform function '${name}' (§85).`,
      );
  }
  acc.multiply(next);
}

function readNumberList(text: string): number[] {
  const numbers: number[] = [];
  const scanner = { text, index: 0 };
  while (scanner.index < text.length) {
    skipTransformSpace(scanner);
    if (scanner.index >= text.length) {
      break;
    }
    if (text.charAt(scanner.index) === ",") {
      scanner.index += 1;
      continue;
    }
    numbers.push(readTransformNumber(scanner));
  }
  return numbers;
}
