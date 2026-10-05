/**
 * `@fourjs/text` — bitmap text at §56's MVP tier.
 *
 * Three pieces, each usable on its own:
 *
 * 1. {@link BUILTIN_FONT} — a dependency-free 6 × 12 monospace face covering
 *    printable ASCII, with its pixels in source, plus
 *    {@link createBitmapFont}, the constructor any other face goes through
 *    (`bitmap-font.ts`).
 * 2. {@link buildGlyphAtlas} — that face packed into one RGBA8 buffer plus a uv
 *    table (`glyph-atlas.ts`).
 * 3. {@link layoutText} — a string laid out against an atlas as world-space
 *    quads (`text-layout.ts`).
 *
 * ```ts
 * import { buildGlyphAtlas } from "fourJS/text";
 * import { Texture } from "fourJS/render";
 * import { UnlitMaterial } from "fourJS/materials";
 * import { Text } from "fourJS"; // not this subpath — see below
 *
 * const atlas = buildGlyphAtlas();
 * const font = new Texture({ ...atlas, filter: "nearest" });
 * const ink = new UnlitMaterial({ map: font, transparent: true });
 * const label = new Text(atlas, ink, { text: "Motor 42", size: 0.25 });
 * ```
 *
 * **This package produces data, never nodes.** Its dependencies are `core`,
 * `math`, and `geometry` (plan §3.1, frozen) — not `render`, not `materials`,
 * not `scene` — so it cannot construct a `Texture`, a material, or a `Text`
 * node, and it does not try. `fourJS/text` re-exports this barrel; `Text` is
 * not on it. The atlas is emitted in exactly the shape
 * `@fourjs/render`'s `TextureSource` accepts, and the layout in the shape a quad
 * builder wants; the package that owns nodes assembles the two. See
 * `glyph-atlas.ts` for why that seam is structural rather than an import.
 *
 * **The package that owns nodes is the umbrella `fourJS`, since 2026-08-13**
 * (R-28): `new Text(atlas, material, { text, size })` is a §49 `Renderable`
 * that draws a whole string as one geometry over one atlas material. This
 * package is still what computes where the glyphs go. `layoutText` remains
 * public for callers who want the quads without a node.
 */

export const PACKAGE_NAME = "@fourjs/text";

export {
  BUILTIN_FONT,
  createBitmapFont,
  glyphFor,
  glyphPixel,
  glyphToAscii,
} from "./bitmap-font.js";
export type {
  BitmapFont,
  BitmapFontOptions,
  BitmapGlyph,
} from "./bitmap-font.js";

export { buildGlyphAtlas } from "./glyph-atlas.js";
export type {
  GlyphAtlas,
  GlyphAtlasEntry,
  GlyphAtlasOptions,
} from "./glyph-atlas.js";

export { layoutText } from "./text-layout.js";
export type {
  TextAlign,
  TextLayout,
  TextLayoutOptions,
  TextQuad,
} from "./text-layout.js";
export {
  canBreakAfter,
  canBreakBefore,
  lineBreakOpportunity,
  wrapToWidth,
} from "./line-break.js";
export type { LineBreakOpportunity, Wrappable } from "./line-break.js";

export {
  IdentityShapingEngine,
  DEFAULT_MAXIMUM_FONT_BYTES,
  validateFontBytes,
} from "./shaping.js";
export type {
  ShapingDirection,
  ShapedGlyph,
  ShapedRun,
  ShapeQuery,
  ShapingEngine,
} from "./shaping.js";
