import type { TextLayoutOptions } from "@fourjs/text";
/**
 * `Text` (§49, §56) — a string, a font atlas and a material become **one** draw
 * call of positioned glyph quads (R-28, 2026-08-13).
 *
 * ```ts
 * import { buildGlyphAtlas } from "@fourjs/text";
 * import { Texture } from "@fourjs/render";
 * import { UnlitMaterial } from "@fourjs/materials";
 * import { Text } from "fourJS";
 *
 * const atlas = buildGlyphAtlas();
 * const font = new Texture({ ...atlas, filter: "nearest" });     // §77, R-30
 * const ink = new UnlitMaterial({ map: font, transparent: true });
 *
 * const label = new Text(atlas, ink, { text: "Motor 42 °C", size: 0.25 });
 * scene.add(label);
 * ```
 *
 * `@fourjs/text` has produced glyph data since WP-3a.4 and no node consumed it, so
 * "text" was a quad calculator and every application assembled the label by
 * hand — one `Texture`, one `SpriteMaterial` and one draw *per glyph cell* in
 * the examples that tried. This class is the missing consumer.
 *
 * ## Why it lives in the umbrella and not in `@fourjs/render` (decision, R-28)
 *
 * §49 puts `Text` in the `Renderable` family, and `Renderable` lives in
 * `@fourjs/render`. The frozen §3.1 dependency matrix gives `render` the deps
 * `core, math, scene, geometry, materials` — **not `text`** — and gives `text`
 * the deps `core, math, geometry`, so neither package may import the other. The
 * matrix is frozen (plan §3.1: "never add or reverse an edge"), and the edge
 * that would be needed here is a *renderer depending on a font package*, which
 * is the wrong direction for the rest of the project's life.
 *
 * So the class goes to the one package that already sees both, which is this
 * one — the same argument `scene-serializers.ts` makes for itself ("the §3.1
 * matrix lets `@fourjs/serialization` see `core`/`math`/`scene` only, and the
 * umbrella is the one place that may see `ui`, `render`, and `motion` too") and
 * the same shape §49's family already has: `ParticleSystem` (§36) is a §49
 * family member living in `@fourjs/particles`, recognised by the render list
 * *structurally* because it may not even extend `Renderable`. `Text` does
 * better than that — being above `render` rather than beside it, it really is a
 * `Renderable`, so §49's hierarchy holds by inheritance and the render list, the
 * sort, the culler, §65 batching and §79 all take it with no special case.
 *
 * ## Why one geometry and the unlit pipeline (decision, R-28)
 *
 * A label could be N `Sprite` children over one atlas material — R-9's §65
 * batching would merge them into one draw, which is what the gap document
 * predicted. This class does not do that, and the reason is that it can do
 * better for less:
 *
 * - **One geometry per label is one draw call unconditionally**, where N sprites
 *   is one draw call *only when the application opted into batching*
 *   (`createGlBatching`) and N draw calls otherwise.
 * - **The uv are per vertex, which the sprite pipeline cannot express.** §55's
 *   quad derives uv affinely from position (`uv = (p.xy − quad.xy) / quad.zw`),
 *   which is exact for one rectangle sampling one sub-rectangle and cannot map
 *   twelve glyphs onto twelve different atlas cells in one buffer. §53's `uvs`
 *   attribute (R-19) and §57's `UnlitMaterial.map` can, and both already ship.
 * - **It costs the frame path nothing.** No `RenderItemKind` arm, no eighth
 *   pipeline, no shader edit, and `@fourjs/render-webgl` is not opened by this
 *   packet at all: a `Text` is an unlit, textured, transparent draw, which is
 *   the pipeline `R-19` compiled and `R-16`'s shapes already use. Third
 *   application of R-23's "a packet can close a gap by adding nothing to the
 *   frame path".
 *
 * The consequence worth stating plainly: **many labels sharing one material
 * still batch.** Consecutive `Text` nodes over the same `UnlitMaterial` are a
 * run of same-material unlit items, which is exactly what `RenderBatcher`
 * merges, so a screenful of labels is one draw call under `createGlBatching`
 * and one draw *per label* without it. §65's "glyph batching" is therefore
 * closed at the label level here, and what remains of it is grouping labels that
 * do **not** share a material, which is atlas grouping (`R-9`'s own residue).
 *
 * ## The material, and the one check this class makes
 *
 * `Text` takes the material rather than building one, for the batching reason
 * above and for §83's: a texture and a material are shared, and a class that
 * minted its own would give every label a private atlas upload. The price is
 * that two things must agree — the {@link GlyphAtlas} the layout is computed
 * against and the texture the material samples — so the constructor and
 * {@link Text.atlas} **refuse** a material whose `map` is absent or is not the
 * atlas's size (§85). That is not a proof of identity, and it is the check that
 * catches the mistake anyone actually makes (an atlas rebuilt with different
 * padding, a material pointing at last week's sheet).
 *
 * It shares one hole with §55's `frame`, and for the identical reason: assigning
 * a different `material`, or a different `map` to the material, afterwards is
 * not re-checked, because neither setter is this class's. The label then samples
 * the wrong sheet. Re-validating on read would put a throw on the render path,
 * which §61 forbids.
 *
 * ## Ownership (§83)
 *
 * The **geometry is owned** — it is derived from the text, the size and the
 * atlas, so it belongs to the node and {@link Text.dispose} disposes it. The
 * atlas, the texture and the material are **shared and not disposed**, exactly
 * as `Sprite` treats its material.
 *
 * ## What of §56 ships here
 *
 * Bitmap text, basic Latin layout, explicit `\n` line breaks, UAX #14-lite
 * wrapping via {@link Text.wrapWidth}, baseline metrics
 * ({@link Text.layout}), letter spacing, and horizontal alignment. §56's MVP
 * clause allows precisely this ("initial releases may ship bitmap/SDF text with
 * basic Latin-script layout only"). Deferred with their reasons, none of them
 * silently: SDF/MSDF fields (an atlas producer, `glyph-atlas.ts`), vertical
 * alignment and rich spans, text on paths (§51's arc-length parametrization), `space:
 * "billboard" | "screen"` (§55's `billboardMode`, which needs the camera inside
 * the model transform), selection and carets (§73's text input), and the
 * accessible semantic mirror (§75's DOM tier). Shaping, bidi and ligatures are
 * staged by §56 itself behind a shaping-engine amendment.
 *
 * §56's own example writes `fontFamily`, `fontSize`, `fontWeight` and `color`.
 * None of them is here, and that is the "absent beats accepted-and-ignored"
 * rule: this tier has one face, its size is world units per line rather than an
 * em size (see `text-layout.ts` for why that distinction is deliberate), there
 * is no weight axis to select, and the colour of the glyphs is the *material's*
 * `color` — which is where it has to be, because that is what a batch shares
 * and what §57 says a colour is.
 */

import { BufferGeometry } from "@fourjs/geometry";
import { UnlitMaterial } from "@fourjs/materials";
import { Renderable, type RenderableOptions } from "@fourjs/render";
import {
  layoutText,
  type GlyphAtlas,
  type TextAlign,
  type TextLayout,
} from "@fourjs/text";
import type { Disposable } from "@fourjs/core";

/** Vertices one glyph quad contributes: bottom-left, bottom-right, top-right, top-left. */
const VERTICES_PER_GLYPH = 4;

/** Indices one glyph quad contributes — two counter-clockwise triangles. */
const INDICES_PER_GLYPH = 6;

/**
 * Highest vertex index a `Uint16Array` can hold. A label past this many glyphs
 * (16 384 of them) is indexed with 32-bit indices instead — §86's animated-glyph
 * row is 20 000, so this is not a hypothetical boundary.
 */
const MAX_UINT16_INDEX = 65_535;

/**
 * The vertex-free and index-free states a rebuild passes through — R-23's
 * pivot, restated here because it is the whole reason a resizable derived
 * geometry can keep its id.
 */
const EMPTY_POSITIONS = new Float32Array(0);

/** See {@link EMPTY_POSITIONS}. */
const EMPTY_INDICES = new Uint16Array(0);

/** The legal {@link TextAlign} values, in the §85 message's order. */
const ALIGNMENTS: readonly TextAlign[] = ["left", "center", "right"];

/** Optional construction arguments of {@link Text}. */
export interface TextOptions
  extends
    RenderableOptions,
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
  /** Initial {@link Text.text}; defaults to `""`, which draws nothing. */
  text?: string;
  /**
   * Initial {@link Text.size} — world units per line, not an em size (see
   * `@fourjs/text`'s `text-layout.ts`). Defaults to `1`.
   */
  size?: number;
  /** Initial {@link Text.letterSpacing} in world units; defaults to `0`. */
  letterSpacing?: number;
  /** Initial {@link Text.align}; defaults to `"left"`. */
  align?: TextAlign;
}

/**
 * Why a `Text` opts out of §69's shadow map by default, unlike every other
 * `Renderable` (decision, R-28).
 *
 * `Renderable.castShadow` defaults to `true` and the shadow pass honours it for
 * the three *surface* pipelines, of which `"unlit"` — the one a label draws
 * through — is one. A depth-only pass writes **geometry, not alpha**, so a
 * label whose glyphs are alpha coverage over opaque rectangles would cast the
 * shadow of its *rectangles*: switching on a sun would put a black bar under
 * every word.
 *
 * §55's `Sprite` has exactly this problem and is excluded *structurally*,
 * because the list builder can recognise a `"sprite"` item. A `Text` draws
 * through the same pipeline as an opaque wall, so nothing structural
 * distinguishes it and the exclusion has to be data. `castShadow: true` remains
 * available and honest — it is the right answer for a label carved out of
 * geometry, and it becomes the right default the day §69's transparent shadow
 * masks land.
 */
const DEFAULT_CAST_SHADOW = false;

/** Validates {@link Text.size} (§85). */
function requirePositive(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `Text size must be a finite positive number of world units per line; ` +
        `got ${String(value)} (§85).`,
    );
  }
  return value;
}

/** Validates {@link Text.letterSpacing} (§85). */
function requireFinite(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `Text letterSpacing must be finite; got ${String(value)} ` +
        "(§85: NaN and infinite values).",
    );
  }
  return value;
}

/** Validates {@link Text.align} (§85) — refuses; never falls back to `"left"`. */
function requireAlign(value: TextAlign): TextAlign {
  if (!ALIGNMENTS.includes(value)) {
    throw new RangeError(
      `Text align must be one of ${ALIGNMENTS.map((one) => JSON.stringify(one)).join(", ")}; ` +
        `got ${JSON.stringify(value)} (§56, §85).`,
    );
  }
  return value;
}

/**
 * Refuses a material that does not sample this atlas (§85, §56) — see the class
 * documentation for what this catches and the one thing it deliberately cannot.
 */
function requireAtlasMaterial(
  atlas: GlyphAtlas,
  material: UnlitMaterial,
): void {
  const map = material.map;
  if (map === null) {
    throw new RangeError(
      "Text needs a material that samples the glyph atlas, but its `map` is " +
        "null — build it as `new UnlitMaterial({ map: new Texture(atlas), " +
        "transparent: true })` (§56, §57, §85).",
    );
  }
  if (map.width !== atlas.width || map.height !== atlas.height) {
    throw new RangeError(
      `Text material samples a ${String(map.width)} × ${String(map.height)} ` +
        `texture, but its glyph atlas is ${String(atlas.width)} × ` +
        `${String(atlas.height)}; the two must be the same sheet (§56, §85).`,
    );
  }
}

/**
 * A string drawn as positioned glyph quads (§49, §56).
 *
 * ## Coordinates (§7a)
 *
 * The node's origin is the **first line's baseline at its left edge**, +Y up —
 * `layoutText`'s frame, unchanged, and deliberately not re-based here. A caller
 * who wants the block centred on the node subtracts `layout.width / 2` and
 * raises by `layout.height / 2 − atlas.ascent · scale`; both numbers are on
 * {@link Text.layout}. Baseline origin rather than top-left because that is the
 * line two different sizes, two different faces, or a label beside an icon
 * actually align on.
 *
 * ## Rebuild cost
 *
 * The layout and the quad buffers are rebuilt **lazily, on the next read of
 * {@link Text.geometry}**, so a burst of edits in one frame costs one rebuild
 * rather than one per edit — `Sprite`'s contract, and `Shape2D`'s. The
 * geometry's `id` is stable across rebuilds, which is what makes a text change
 * cost one re-upload in the backend's `GeometryCache` instead of leaking the old
 * entry behind a new id.
 *
 * A rebuild that changes the glyph count changes the vertex count, and §53
 * validates every buffer against the ones already on the geometry — so the swap
 * passes through an **empty index buffer**, the one configuration legal at every
 * vertex count (R-23's pivot, recorded in `@fourjs/render`'s `shape.ts`).
 */
export class Text extends Renderable<UnlitMaterial> implements Disposable {
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
  #atlas: GlyphAtlas;

  #text: string;

  #size: number;

  #letterSpacing: number;

  #align: TextAlign;

  /** The owned quad buffer; created once, rewritten in place. */
  readonly #quads: BufferGeometry;

  /** The cached layout, or `null` when it must be recomputed. */
  #layout: TextLayout | null = null;

  /** Whether the quad buffers still match {@link Text.layout}. */
  #stale = true;

  #disposed = false;

  /**
   * Builds a label for `atlas` and `material`.
   *
   * Both are required and neither is defaulted: a text node without a font has
   * nothing to lay out and one without a material draws nothing, and defaulting
   * either would hide the mistake behind an invisible node rather than a type
   * error — the rule `Renderable` and `Sprite` both follow.
   *
   * The geometry is built **before** `super()`, because `Renderable`'s
   * constructor takes one: a `Text` owns its geometry rather than being handed
   * one, so it hands its own to the base and keeps the reference.
   *
   * @throws RangeError if `material` does not sample a texture the size of
   * `atlas`, or if any option fails its §85 check
   */
  constructor(
    atlas: GlyphAtlas,
    material: UnlitMaterial,
    options: TextOptions = {},
  ) {
    requireAtlasMaterial(atlas, material);
    const quads = new BufferGeometry({
      positions: EMPTY_POSITIONS,
      mode: "triangles",
    });
    super(quads, material, {
      ...options,
      castShadow: options.castShadow ?? DEFAULT_CAST_SHADOW,
    });
    this.#quads = quads;
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
    this.#atlas = atlas;
    this.#text = options.text ?? "";
    this.#size = requirePositive(options.size ?? 1);
    this.#letterSpacing = requireFinite(options.letterSpacing ?? 0);
    this.#align = requireAlign(options.align ?? "left");
  }

  /**
   * The string drawn (§56). Assigning rebuilds the layout and the quads on the
   * next read of {@link Text.geometry}.
   *
   * Every character the atlas does not cover draws the fallback box rather than
   * disappearing — `layoutText`'s rule, and what makes a missing script visible
   * instead of silent.
   */
  get text(): string {
    return this.#text;
  }

  set text(value: string) {
    if (value === this.#text) {
      return;
    }
    this.#text = value;
    this.markDirty();
  }

  /**
   * World units per **line** — the baseline-to-baseline distance of
   * single-spaced lines, and the height of one glyph cell (§56).
   *
   * Not an em size: `@fourjs/text`'s `text-layout.ts` records why, and the
   * consequence worth repeating is that a block of `n` lines is exactly
   * `n · size` tall whatever the face's internal pixel grid is.
   */
  get size(): number {
    return this.#size;
  }

  set size(value: number) {
    this.#size = requirePositive(value);
    this.markDirty();
  }

  /**
   * Extra world units inserted **between** adjacent glyphs on a line (§56);
   * `0` by default, negative values tighten. Between, not after — so
   * `layout.width` stays the true extent of the text.
   */
  get letterSpacing(): number {
    return this.#letterSpacing;
  }

  set letterSpacing(value: number) {
    this.#letterSpacing = requireFinite(value);
    this.markDirty();
  }

  /**
   * Maximum line width in world units, or `undefined` for `\n`-only breaks.
   * Forwards {@link TextLayoutOptions.wrapWidth}.
   */
  get wrapWidth(): number | undefined {
    return this.#shaping.wrapWidth;
  }

  set wrapWidth(value: number | undefined) {
    if (value === this.#shaping.wrapWidth) {
      return;
    }
    this.#shaping = { ...this.#shaping, wrapWidth: value };
    this.markDirty();
  }

  /**
   * How each line sits within the widest line's extent — §56's horizontal
   * alignment; `"left"` by default.
   *
   * The node's origin does not move with it: alignment is *within* the text.
   */
  get align(): TextAlign {
    return this.#align;
  }

  set align(value: TextAlign) {
    this.#align = requireAlign(value);
    this.markDirty();
  }

  /**
   * The font this text is laid out against (§56). Assigning rebuilds.
   *
   * @throws RangeError if the current material does not sample a texture of the
   * new atlas's size (§85) — the check the constructor makes, made again
   * because swapping the atlas without swapping the sheet is the same mistake
   * from the other side.
   */
  get atlas(): GlyphAtlas {
    return this.#atlas;
  }

  set atlas(value: GlyphAtlas) {
    requireAtlasMaterial(value, this.material);
    this.#atlas = value;
    this.markDirty();
  }

  /**
   * The metrics of the current string (§56) — `width`, `height`, `lineCount`
   * and the per-glyph quads — recomputed on read whenever anything it depends
   * on has changed.
   *
   * ```ts
   * label.text = "Motor 42";
   * label.layout.width;      // the extent in world units, for centring
   * ```
   *
   * Reading it is cheap: the layout is cached, and reading it does **not**
   * rebuild the geometry (a caller measuring a label every frame should not pay
   * for vertex buffers it never draws). The quads it carries are the same
   * numbers the geometry is built from, so a caller can hit-test or decorate
   * individual glyphs without a second layout pass.
   */
  get layout(): TextLayout {
    this.#layout ??= layoutText(this.#text, this.#atlas, {
      size: this.#size,
      letterSpacing: this.#letterSpacing,
      ...this.#shaping,
      align: this.#align,
    });
    return this.#layout;
  }

  /**
   * The glyph quads this text draws (§53), rebuilt on read whenever the string,
   * the size, the spacing, the alignment or the atlas has changed.
   *
   * Owned by the node — do not dispose it yourself, and do not hand it to a
   * `Renderable`, which would then draw a buffer that changes under it. Reading
   * it is cheap: the rebuild is skipped unless something moved.
   *
   * Overrides `Renderable.geometry` with a **read-only** accessor, exactly as
   * `Sprite` and `Shape2D` do: a text node derives its geometry, so there is
   * nothing sensible to assign.
   */
  override get geometry(): BufferGeometry {
    if (this.#stale) {
      this.#rebuild();
    }
    return this.#quads;
  }

  /** Whether {@link Text.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Announces a change this node could not see — a font mutated in place, or a
   * material whose map was replaced. The layout and the quads are rebuilt on the
   * next read, not here, so a burst of edits costs one rebuild.
   */
  markDirty(): void {
    this.#layout = null;
    this.#stale = true;
  }

  /**
   * Releases the quad buffers this node owns (§83). Idempotent.
   *
   * **The atlas, the material and its texture are not disposed**: all three are
   * shared, and §83 puts disposal on whoever created them — one atlas backs
   * every label in an application. After disposal the geometry has no vertices,
   * so a backend meeting this node in a render list skips it.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#quads.dispose();
  }

  /**
   * Rewrites the quad buffers from {@link Text.layout}.
   *
   * ```text
   * 3 ── 2      (x0, y1) ── (x1, y1)      uv: (u0, v1) ── (u1, v1)
   * │    │           │           │            │              │
   * 0 ── 1      (x0, y0) ── (x1, y0)          (u0, v0) ── (u1, v0)
   * ```
   *
   * one such quad per **drawn** glyph — a space emits none, so the buffers are
   * sized from `layout.quads.length` and not from the string's length. The
   * winding (`0,1,2, 0,2,3`) is counter-clockwise seen from +Z, matching
   * `planeGeometry`, `Sprite` and §7a.
   *
   * A disposed node rebuilds nothing: `dispose()` is terminal and has already
   * emptied the geometry.
   */
  #rebuild(): void {
    this.#stale = false;
    if (this.#disposed) {
      return;
    }

    const quads = this.layout.quads;
    const target = this.#quads;

    // §53 validates each buffer against the ones already present, so a label
    // whose glyph count changed cannot simply assign its new arrays — it has to
    // pass through a configuration legal at both counts, and an **empty index
    // buffer** is the only one (R-23; `@fourjs/render`'s `shape.ts` carries the
    // full argument). Dropping `uvs` alongside it — index-aligned with
    // `positions`, §53 — leaves a geometry that accepts any new vertex count.
    target.indices = EMPTY_INDICES;
    target.uvs = undefined;
    if (quads.length === 0) {
      target.positions = EMPTY_POSITIONS;
      target.indices = undefined;
      return;
    }

    const vertexCount = quads.length * VERTICES_PER_GLYPH;
    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices =
      vertexCount - 1 > MAX_UINT16_INDEX
        ? new Uint32Array(quads.length * INDICES_PER_GLYPH)
        : new Uint16Array(quads.length * INDICES_PER_GLYPH);

    for (let glyph = 0; glyph < quads.length; glyph += 1) {
      const quad = quads[glyph];
      const base = glyph * VERTICES_PER_GLYPH;
      const p = base * 3;
      const t = base * 2;
      // prettier-ignore
      positions.set([
        quad.x0, quad.y0, 0, // 0 bottom-left
        quad.x1, quad.y0, 0, // 1 bottom-right
        quad.x1, quad.y1, 0, // 2 top-right
        quad.x0, quad.y1, 0, // 3 top-left
      ], p);
      // prettier-ignore
      uvs.set([
        quad.u0, quad.v0,
        quad.u1, quad.v0,
        quad.u1, quad.v1,
        quad.u0, quad.v1,
      ], t);
      const i = glyph * INDICES_PER_GLYPH;
      indices[i] = base;
      indices[i + 1] = base + 1;
      indices[i + 2] = base + 2;
      indices[i + 3] = base;
      indices[i + 4] = base + 2;
      indices[i + 5] = base + 3;
    }

    target.positions = positions;
    target.uvs = uvs;
    target.indices = indices;
  }
}
