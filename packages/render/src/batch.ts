/**
 * §65 batching — merging consecutive compatible draws into one (R-9,
 * 2026-08-09).
 *
 * §64 lists batching as pipeline stage 6, between sorting and backend command
 * encoding, and §65 names the strategies: sprite batching, glyph batching,
 * compatible shape batching, instanced meshes, material and pipeline sorting,
 * atlas grouping, staged buffers, multi-draw. This module ships the first two
 * *drawing* strategies — **sprite batching and compatible shape batching** — as
 * a backend-independent planner: it turns a run of {@link RenderItem}s into one
 * interleaved vertex stream plus one index stream, and a backend uploads and
 * draws them. `@fourjs/render-webgl`'s `gl-batch.ts` is the first consumer;
 * nothing here names GL, so a second backend reuses the planner unchanged.
 *
 * ```ts
 * const batcher = new RenderBatcher();
 * for (let i = 0; i < list.length; i += 1) {
 *   const batch = batcher.next(list, i);
 *   if (batch !== null) {
 *     drawOnce(batch);          // one draw call for batch.items items
 *     i += batch.items - 1;
 *     continue;
 *   }
 *   drawOne(list[i]);           // exactly the draw it always was
 * }
 * ```
 *
 * ## The tier, and why it is this one
 *
 * **Consecutive items that share a pipeline and a material instance.** Nothing
 * is reordered here — reordering is §66's key 3 and is a separate, opt-in verb
 * (`groupRenderListByPipeline`), for the reason recorded there. That
 * restriction is what makes this batcher **exact rather than approximate**:
 *
 * - GL rasterises the primitives of one draw call in submission order, and
 *   blending, depth testing and depth writing all respect that order. Merging
 *   *N* consecutive draws that share every piece of render state into one draw
 *   whose primitives are concatenated in the same order therefore produces the
 *   same picture, primitive for primitive — including the `LEQUAL` co-planar
 *   case where the later draw wins, which is exactly how a §58 stroke paints
 *   over its fill and how a later sibling paints over an earlier one.
 * - "Same material *instance*" (`===`, not "equal fields") is what makes the
 *   claim checkable in one comparison: blend mode, depth test, depth write,
 *   colour write, texture, colour and opacity are all read off that one object,
 *   so a run cannot straddle a state change.
 * - A run of one is not a batch. A scene with a single sprite, or with no two
 *   adjacent draws sharing a material, produces exactly the GL sequence it
 *   produced before this module existed — the byte-identity property this
 *   packet keeps.
 *
 * ## The one divergence, stated
 *
 * A batch has one model matrix for many nodes, so **world transforms are baked
 * into the vertex stream** here on the CPU (in `Float64Array` matrix precision,
 * stored to `Float32Array`) instead of applied by the vertex stage. The drawn
 * geometry is the same geometry; the arithmetic that produces each clip-space
 * position is not bit-identical to `viewProjection * model * p` evaluated in
 * the shader's `highp float`. Sub-ulp differences in a vertex position can move
 * an anti-aliased edge by a fraction of a pixel — so a batched draw is *not*
 * claimed to be bit-identical to the unbatched one, only geometrically and
 * semantically identical. This is why batching is opt-in per renderer rather
 * than switched on for everybody, and why the pixel gates compare a batched
 * scene against itself rather than against an unbatched golden.
 *
 * Baking assumes an **affine** world matrix (bottom row `0 0 0 1`), which is
 * what `Transform.compose` produces for every node in the engine; the fourth
 * row is not applied and no perspective divide is performed.
 *
 * ## Which pipelines, and why only those
 *
 * `"unlit"` and `"sprite"` — the two whose shading depends on nothing but the
 * fragment's own interpolated values. `"lit"` and `"standard"` shade with
 * normals, which a baked batch would have to transform by the inverse-transpose
 * *per item*, and `"particles"` arrives batched already (one item is one
 * instanced draw, plan P9-3). Instanced meshes for the shaded pipelines are
 * §65's own next strategy and a separate packet (R-22).
 *
 * ## Determinism (§33)
 *
 * A batch is a pure function of the item sequence: a left-to-right scan, no
 * `Map`, no `Set`, no iteration over object keys, no identity hashing. The same
 * list produces the same runs, the same vertex order and the same indices on
 * every run and every platform. The arithmetic is IEEE multiply-add in the
 * order written, so the vertex stream is bit-identical across runs of the same
 * build — same-runtime tier, and cross-platform for the copied streams (uv and
 * colour are memcpy) while the baked positions inherit the tier of whatever
 * produced the world matrix.
 *
 * ## Allocation (plan D7)
 *
 * One {@link RenderBatcher} owns two growable typed arrays and one mutable
 * batch record, all reused. The steady state allocates nothing: arrays grow to
 * the largest run the scene contains and then stop. The record and both arrays
 * are **valid until the next {@link RenderBatcher.next} call** — upload during
 * the call, never retain.
 */

import type { BufferGeometry } from "@fourjs/geometry";
import type {
  MaterialTexture,
  SpriteMaterial,
  UnlitMaterial,
} from "@fourjs/materials";
import { Matrix3, type ColorRGBA } from "@fourjs/math";
import { ALL_LAYERS, type LayerMask } from "@fourjs/scene";

import type { RenderItemClip } from "./clip.js";
import { scissorsEqual, type ScissorRect } from "./scissor.js";
import {
  TextureAtlas,
  type AtlasEntry,
  type TextureAtlasOptions,
  type TextureAtlasStatistics,
} from "./texture-atlas.js";
import type {
  LitRenderItem,
  RenderItem,
  SpriteRenderItem,
  StandardRenderItem,
  UnlitRenderItem,
} from "./render-list.js";

/** Floats per vertex in the position stream — always present. */
const POSITION_FLOATS = 3;

/** Floats per vertex in the uv stream, when the batch carries one. */
const UV_FLOATS = 2;

/** Floats per vertex in the colour stream, when the batch carries one. */
const COLOR_FLOATS = 4;

/**
 * Vertices one batch may hold before the run is split, unless a caller says
 * otherwise.
 *
 * A cap is needed at all because the planner's arrays grow to the largest run
 * they are asked for and never shrink: without one, a scene of 100 000 sprites
 * sharing an atlas would allocate a single 400 000-vertex staging buffer, and a
 * backend would then upload it as one buffer object. 65 536 is chosen for two
 * reasons — it is the vertex count above which indices stop fitting in 16 bits
 * (this planner emits 32-bit indices, but a backend that wanted narrow ones
 * could split on the same boundary), and it bounds the staging arrays at
 * 65 536 × 9 floats ≈ 2.4 MB in the widest layout.
 *
 * Splitting costs one draw call per 65 536 vertices, which is 6 draws for
 * §86's 100 000-sprite row instead of 100 000.
 */
export const DEFAULT_MAX_BATCH_VERTICES = 65_536;

/** Construction arguments of {@link RenderBatcher}. */
export interface RenderBatchOptions {
  /**
   * Vertices one batch may hold before the run is split — see
   * {@link DEFAULT_MAX_BATCH_VERTICES}.
   *
   * An item whose geometry alone exceeds this is never batched; it draws on its
   * own, unchanged, which is the right answer for a mesh that is already one
   * big draw call.
   *
   * @throws FourError never — a value below one vertex simply means "batch
   * nothing", which is a legitimate way to switch the batcher off (§85's
   * refuse-don't-clamp applies to configuration that would otherwise be
   * silently reinterpreted; here the extreme value keeps its literal meaning).
   */
  maxVertices?: number;

  /**
   * Opt in to §65 **atlas grouping** (W11.4): consecutive `"unlit"` / `"sprite"`
   * items whose materials differ **only by texture** (same kind, tint or
   * colour, opacity, blend mode, depth/colour flags, stencil, clip, scissor,
   * layers and mode) merge into one run over a {@link TextureAtlas} page, with
   * their UVs rewritten into the packed rectangle. Absent (the default), the
   * batcher is exactly the consecutive-same-material tier.
   *
   * An item is skipped (it ends the run) when its texture is not packable
   * ({@link TextureAtlas.canPack}: `repeat`/mirrored wrap, mip chain,
   * anisotropy, non-2D, larger than a page), when its geometry has no uvs or
   * uvs outside `[0, 1]` (a clamped sample would bleed into a neighbour), or
   * when its filter or colour space differs from the run's.
   */
  atlas?: TextureAtlasOptions;
}

/** Counters {@link RenderBatcher.atlasStatistics} reports. */
export interface BatchAtlasStatistics extends TextureAtlasStatistics {
  /** Atlas runs built (cumulative since the last reset). */
  readonly runs: number;
  /** Items merged by those runs. */
  readonly items: number;
  /**
   * Draw calls saved against the consecutive-same-material tier: per run, the
   * number of same-material segments minus one.
   */
  readonly drawsSaved: number;
}

/**
 * The materials this planner batches — the two whose pipelines shade from the
 * fragment's own interpolated values (see the module header).
 */
export type BatchableMaterial = UnlitMaterial | SpriteMaterial;

/**
 * The two render items {@link RenderBatcher} merges — the arms of
 * {@link RenderItem} whose pipelines shade from interpolated vertex values
 * alone (see the module header).
 */
export type BatchableItem = UnlitRenderItem | SpriteRenderItem;

/**
 * One merged draw: `items` consecutive render items, concatenated into one
 * interleaved vertex stream and one index stream.
 *
 * **Pooled and rewritten.** The record and both typed arrays belong to the
 * {@link RenderBatcher} that produced them and are overwritten by its next
 * {@link RenderBatcher.next} call. `vertices` and `indices` are the batcher's
 * whole staging arrays, which may be longer than this batch needs — read
 * `vertexCount × floatsPerVertex` floats and `indexCount` indices, and upload
 * with the five-argument `bufferSubData` rather than taking a `subarray` (which
 * would allocate a view per frame).
 */
export interface RenderBatch {
  /** Which pipeline draws it (§64, §66 key 3) — the merged items' `kind`. */
  readonly kind: "unlit" | "sprite";

  /**
   * The one material every merged item carries — the same object, not an equal
   * one. Every piece of §57 render state the draw needs is read off it.
   */
  readonly material: BatchableMaterial;

  /**
   * The texture the batch samples — a sprite material's `texture` (§55) or an
   * unlit material's `map` (§57, R-19) — or `null` when it samples none.
   *
   * Resolved here rather than by the backend so the draw path reads **one**
   * field instead of asking which kind of material this is; the same reason
   * `RenderItem` snapshots `transparent` and `materialId` rather than chasing
   * the material per comparison. A backend still resolves it to a GPU handle
   * through its own cache, and a batch whose texture resolves to nothing is
   * skipped or drawn untextured by exactly the rule that backend applies to a
   * single item.
   */
  readonly texture: MaterialTexture | null;

  /**
   * The RGBA the whole batch is tinted by — an unlit material's `color` or a
   * sprite material's `tint`, the same live array the material owns (copy it if
   * you need to keep it).
   *
   * One value for the batch because "same material instance" is the batching
   * rule: §55's tint and §57's colour are *material* state, so merging never
   * needs them per vertex. That is also why a sprite batch carries no colour
   * stream (see {@link RenderBatch.hasColors}).
   */
  readonly color: ColorRGBA;

  /** §57's `opacity` for the shared material, multiplying the alpha above. */
  readonly opacity: number;

  /** The merged items' shared draw mode (§53). */
  readonly mode: BufferGeometry["mode"];

  /**
   * §67's clip, shared by every merged item, or `null` where none of them is
   * clipped (R-23, 2026-08-21).
   *
   * A run breaks where the record changes, so this is one value for the whole
   * batch exactly as the material is: the same material under two different
   * clips is two different draws, and merging them would let one scroll view's
   * content escape into another's. A backend applies it exactly as it applies
   * a single item's.
   *
   * Never a mask pass: every clip owns its own bit plane and emits exactly one
   * mask draw, so two consecutive mask items never share a record and a run of
   * them never forms.
   *
   * Optional for `RenderItem.clip`'s reason — a hand-built batch predating §67
   * must still typecheck, and `undefined` reads as "unclipped" — but the
   * batcher itself always writes it.
   */
  readonly clip?: RenderItemClip | null;

  /**
   * §67 rectangular scissor, shared by every merged item, or `null` where
   * none of them names one (2026-09-06).
   *
   * A run breaks where the rectangle changes, so this is one value for the
   * whole batch: two same-material draws under different scissors are two
   * different draws. `undefined` reads as "no per-item scissor", matching
   * {@link RenderItem.scissor}.
   */
  readonly scissor?: ScissorRect | null;

  /**
   * How many consecutive render items this batch consumed. Always ≥ 2 — a run
   * of one is not a batch (see the module header).
   */
  readonly items: number;

  /** Vertices in {@link RenderBatch.vertices}. */
  readonly vertexCount: number;

  /** Indices in {@link RenderBatch.indices}; the draw's element count. */
  readonly indexCount: number;

  /**
   * Floats per vertex in the interleaved stream: position (3), then uv (2) when
   * {@link RenderBatch.hasUvs}, then colour (4) when
   * {@link RenderBatch.hasColors}, in that order.
   */
  readonly floatsPerVertex: number;

  /**
   * Whether the stream carries uv, i.e. whether the material samples a texture.
   * Always true for a sprite batch (§55's quad is a texture map by definition).
   */
  readonly hasUvs: boolean;

  /**
   * Whether the stream carries per-vertex colour, i.e. whether the material
   * declares §53's `vertexColors` (R-19). Always false for a sprite batch:
   * §55's tint is material state, shared by the run by construction.
   */
  readonly hasColors: boolean;

  /** Interleaved vertex data, world-space positions. See the interface note. */
  readonly vertices: Float32Array;

  /** Indices into {@link RenderBatch.vertices}, already offset per item. */
  readonly indices: Uint32Array;

  /**
   * Change-detection stamp for §65 / §86's idle batch cache (R-8 follow-up).
   *
   * A non-zero value is an FNV-1a mix of each merged item's geometry version,
   * transform version, and world-matrix elements. The WebGL uploader skips
   * `bufferSubData` when this stamp and the vertex/index counts match the
   * last upload into the same layout slot.
   *
   * **`0` means "versions unavailable — always re-upload."** That is today's
   * default: a hand-built item with no `transformVersion`, or any run that
   * includes one, keeps the pre-cache upload path so a scene that never
   * opted into versioning is bit-identical.
   */
  readonly contentVersion?: number;

  /**
   * `true` when this batch's {@link RenderBatch.texture} is an atlas page and
   * its UVs were rewritten into packed rectangles (W11.4). Absent or `false`
   * otherwise.
   */
  readonly atlased?: boolean;
}

/**
 * Floats per instance in {@link InstancedRun.instances} (R-22): the world
 * matrix (16, column-major) then the normal matrix (9, three `vec3` columns).
 */
export const INSTANCE_FLOATS = 25;

/** The shaded render items {@link RenderBatcher.nextInstanced} instances. */
export type InstanceableItem = LitRenderItem | StandardRenderItem;

/**
 * One instanced draw (R-22): `items` consecutive shaded render items that
 * share a geometry, a material instance, clip, scissor, layer mask and shadow
 * flag, drawn as a single instanced call. Unlike {@link RenderBatch} nothing
 * is baked: the vertex stream stays the geometry's own and each instance
 * carries its model matrix plus the matching normal matrix, so shading is
 * exactly the unbatched shading. Pooled like {@link RenderBatch}: valid until
 * the next {@link RenderBatcher.nextInstanced} call.
 */
export interface InstancedRun {
  /** Pipeline of every merged item. */
  readonly kind: "lit" | "standard";
  /** The first merged item; its geometry, material and flags speak for all. */
  readonly first: InstanceableItem;
  /** Consecutive items consumed (always >= 2). */
  readonly items: number;
  /** `INSTANCE_FLOATS` floats per item, in list order; whole staging array. */
  readonly instances: Float32Array;
  /** Idle-cache stamp, as {@link RenderBatch.contentVersion}; 0 = re-upload. */
  readonly contentVersion: number;
}

interface MutableRun {
  kind: "lit" | "standard";
  first: InstanceableItem;
  items: number;
  instances: Float32Array;
  contentVersion: number;
}

const instanceNormal = new Matrix3();

/**
 * Whether `item` is a shaded item the instanced tier can draw: lit or
 * standard, with something to draw, and no skin or morph target (those draw
 * through their own programs).
 */
function isInstanceable(item: RenderItem): item is InstanceableItem {
  if (item.kind !== "lit" && item.kind !== "standard") {
    return false;
  }
  const geometry = item.geometry;
  return (
    geometry.vertexCount > 0 &&
    geometry.drawCount > 0 &&
    geometry.positions1 === undefined
  );
}

/** The record the batcher fills; `RenderBatch` is its read-only face. */
interface MutableBatch {
  kind: "unlit" | "sprite";
  material: BatchableMaterial;
  texture: MaterialTexture | null;
  color: ColorRGBA;
  opacity: number;
  mode: BufferGeometry["mode"];
  clip: RenderItemClip | null;
  scissor: ScissorRect | null;
  items: number;
  vertexCount: number;
  indexCount: number;
  floatsPerVertex: number;
  hasUvs: boolean;
  hasColors: boolean;
  vertices: Float32Array;
  indices: Uint32Array;
  contentVersion: number;
  atlased: boolean;
}

/** FNV-1a offset basis — the idle-cache mix starts here. */
const FNV_OFFSET = 2166136261;

/** FNV-1a 32-bit prime. */
const FNV_PRIME = 16777619;

/**
 * Scratch for folding IEEE-754 bits into the content hash without allocating.
 * Shared: the planner is not re-entrant.
 */
const floatBits = new Float32Array(1);
const floatBitsView = new Uint32Array(floatBits.buffer);

/** Mixes one 32-bit word into an FNV-1a hash. */
function fnvMix(hash: number, value: number): number {
  return Math.imul(hash ^ value, FNV_PRIME);
}

/**
 * Idle-cache stamp for the run `[from, from + count)`. Returns `0` when any
 * item has no `transformVersion`, which is the "always re-upload" signal.
 */
function contentVersionOf(
  items: readonly RenderItem[],
  from: number,
  count: number,
  entries: readonly AtlasEntry[] | null = null,
): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < count; i += 1) {
    const item = items[from + i];
    const transformVersion = item.transformVersion;
    if (transformVersion === undefined) {
      return 0;
    }
    hash = fnvMix(hash, item.geometry.version | 0);
    hash = fnvMix(hash, transformVersion | 0);
    if (entries !== null) {
      // Atlas runs: the packed rectangle is part of the vertex stream.
      const entry = entries[i];
      hash = fnvMix(hash, entry.pageIndex);
      hash = fnvMix(hash, entry.x);
      hash = fnvMix(hash, entry.y);
      hash = fnvMix(hash, entry.width);
      hash = fnvMix(hash, entry.height);
    }
    const e = item.worldMatrix.elements;
    for (let k = 0; k < 16; k += 1) {
      floatBits[0] = e[k];
      hash = fnvMix(hash, floatBitsView[0]);
    }
  }
  // `0` is reserved for "versions unavailable". A real mix that lands on 0
  // is remapped so an idle, versioned run is still skippable.
  return hash === 0 ? 1 : hash;
}

/**
 * Whether `item` can start or join a batch at all, ignoring what it would join.
 *
 * Three questions, in the order that answers most items with the first: is its
 * pipeline one of the two this planner merges, does it carry a material to
 * merge by, and does its geometry have anything to draw? The last is the same
 * test a backend's geometry cache makes — a disposed geometry has empty arrays
 * (§53) and is skipped rather than drawn — so a run never straddles an item the
 * backend would have declined.
 */
function isBatchable(item: RenderItem): item is BatchableItem {
  if (item.kind !== "unlit" && item.kind !== "sprite") {
    return false;
  }
  const geometry = item.geometry;
  return (
    item.material !== undefined &&
    geometry.vertexCount > 0 &&
    geometry.drawCount > 0
  );
}

/** The texture an already-batchable item samples, or `null`. */
function textureOf(item: BatchableItem): MaterialTexture | null {
  return item.kind === "sprite"
    ? item.material.texture
    : (item.material.map ?? null);
}

function colorsEqual(a: ColorRGBA, b: ColorRGBA): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/**
 * Whether `item` could join `first`'s run over an atlas page: the same
 * pipeline kind and every piece of render state equal — only the texture may
 * differ — and a texture whose sampler state (filter, colour space) matches.
 * Read defensively like the rest of this file: a structurally typed double
 * missing a field reports `undefined` on both sides, which compares equal.
 */
function atlasJoinable(
  first: BatchableItem,
  item: BatchableItem,
  atlas: TextureAtlas,
): boolean {
  const a = first.material;
  const b = item.material;
  if (
    first.kind !== item.kind ||
    (a.opacity ?? 1) !== (b.opacity ?? 1) ||
    a.blendMode !== b.blendMode ||
    a.transparent !== b.transparent ||
    a.depthTest !== b.depthTest ||
    a.depthWrite !== b.depthWrite ||
    a.colorWrite !== b.colorWrite ||
    a.stencil !== b.stencil
  ) {
    return false;
  }
  if (first.kind === "sprite" && item.kind === "sprite") {
    if (!colorsEqual(first.material.tint, item.material.tint)) return false;
  } else if (first.kind === "unlit" && item.kind === "unlit") {
    if (
      !colorsEqual(first.material.color, item.material.color) ||
      (first.material.vertexColors === true) !==
        (item.material.vertexColors === true)
    ) {
      return false;
    }
  }
  const ta = textureOf(first);
  const tb = textureOf(item);
  return (
    ta !== null &&
    tb !== null &&
    (ta.filter ?? "linear") === (tb.filter ?? "linear") &&
    (ta.colorSpace ?? "linear") === (tb.colorSpace ?? "linear") &&
    atlas.canPack(tb)
  );
}

/** Whether every uv of `geometry` lies in `[0, 1]` (and uvs exist). */
function uvsInUnitRange(geometry: BufferGeometry): boolean {
  const uvs = geometry.uvs;
  if (uvs === undefined) return false;
  const n = geometry.vertexCount * 2;
  for (let i = 0; i < n; i += 1) {
    const value = uvs[i];
    if (!(value >= 0 && value <= 1)) return false;
  }
  return true;
}

/**
 * §65's batcher: finds runs of compatible consecutive render items and merges
 * each into one draw's worth of vertex data.
 *
 * One instance per consumer (a renderer owns one), because the staging arrays
 * and the batch record are reused across calls. Holds no GPU resources, no
 * scene references and nothing to dispose: between calls it retains only its
 * two typed arrays and the material of the last batch it built.
 */
export class RenderBatcher {
  /** See {@link RenderBatchOptions.maxVertices}. */
  readonly maxVertices: number;

  /** Interleaved staging array; grows, never shrinks. */
  #vertices = new Float32Array(0);

  /** Index staging array; grows, never shrinks. */
  #indices = new Uint32Array(0);

  /**
   * The single pooled result record. Constructed with the fields' zero values
   * and a `null` material that {@link RenderBatcher.next} always overwrites
   * before returning — the same "every field is overwritten by the caller"
   * contract `render-list.ts`'s pooled items carry.
   */
  readonly #batch: MutableBatch = {
    kind: "unlit",
    // Written on every successful `next`; the cast is the pool's, exactly as
    // `render-list.ts`'s `itemAt` needs one, because a record cannot be
    // constructed without a material and no material exists yet.
    material: null as unknown as BatchableMaterial,
    texture: null,
    color: [1, 1, 1, 1],
    opacity: 1,
    mode: "triangles",
    clip: null,
    scissor: null,
    items: 0,
    vertexCount: 0,
    indexCount: 0,
    floatsPerVertex: POSITION_FLOATS,
    hasUvs: false,
    hasColors: false,
    vertices: this.#vertices,
    indices: this.#indices,
    contentVersion: 0,
    atlased: false,
  };

  /** Instance staging array (R-22); grows, never shrinks. */
  #instances = new Float32Array(0);

  readonly #run: MutableRun = {
    kind: "lit",
    first: null as unknown as InstanceableItem,
    items: 0,
    instances: this.#instances,
    contentVersion: 0,
  };

  /** The §65 atlas (W11.4), or `null` when the option was not given. */
  readonly #atlas: TextureAtlas | null;

  /** Per-item atlas entries of the batch being built; grows, never shrinks. */
  readonly #entries: AtlasEntry[] = [];

  /** Distinct-texture scratch for packing; reused. */
  readonly #textures: MaterialTexture[] = [];

  #atlasRuns = 0;

  #atlasItems = 0;

  #drawsSaved = 0;

  constructor(options: RenderBatchOptions = {}) {
    this.maxVertices = options.maxVertices ?? DEFAULT_MAX_BATCH_VERTICES;
    this.#atlas =
      options.atlas === undefined ? null : new TextureAtlas(options.atlas);
  }

  /** The atlas this batcher packs into, or `null` when atlas grouping is off. */
  get atlas(): TextureAtlas | null {
    return this.#atlas;
  }

  /**
   * Atlas counters, or `null` when atlas grouping is off: pages, packed
   * textures, texel use, and the runs / items / draw calls saved since the
   * last {@link RenderBatcher.resetAtlasStatistics}.
   */
  atlasStatistics(): BatchAtlasStatistics | null {
    const atlas = this.#atlas;
    if (atlas === null) return null;
    return {
      ...atlas.statistics(),
      runs: this.#atlasRuns,
      items: this.#atlasItems,
      drawsSaved: this.#drawsSaved,
    };
  }

  /** Zeroes the run / item / draws-saved counters (not the packing). */
  resetAtlasStatistics(): void {
    this.#atlasRuns = 0;
    this.#atlasItems = 0;
    this.#drawsSaved = 0;
  }

  /** Releases the atlas pages (§83). The batcher stays usable. */
  dispose(): void {
    this.#atlas?.dispose();
    this.#entries.length = 0;
    this.#textures.length = 0;
  }

  /**
   * R-22: the instanced run starting at `items[from]`, or `null`.
   *
   * A run is consecutive lit (or standard) items with the **same geometry
   * instance, material instance, clip, scissor, layer mask and
   * `receiveShadow`** — R-9's rules plus geometry identity, since an instanced
   * draw shares the vertex stream. Nothing is reordered; frame lights are
   * per-frame state, so every item of a run sees the same light set by
   * construction. Allocation-free after warm-up.
   */
  nextInstanced(
    items: readonly RenderItem[],
    from: number,
    layerMask: LayerMask = ALL_LAYERS,
  ): InstancedRun | null {
    const first = items[from];
    if (
      first === undefined ||
      (first.layers & layerMask) === 0 ||
      !isInstanceable(first)
    ) {
      return null;
    }
    const clip = first.clip ?? null;
    const scissor = first.scissor ?? null;
    let count = 1;
    for (let i = from + 1; i < items.length; i += 1) {
      const item = items[i];
      if (
        item.kind !== first.kind ||
        item.geometry !== first.geometry ||
        item.material !== first.material ||
        item.layers !== first.layers ||
        (item.layers & layerMask) === 0 ||
        item.receiveShadow !== first.receiveShadow ||
        (item.clip ?? null) !== clip ||
        !scissorsEqual(item.scissor, scissor) ||
        !isInstanceable(item)
      ) {
        break;
      }
      count += 1;
    }
    if (count < 2) {
      return null;
    }
    const need = count * INSTANCE_FLOATS;
    if (this.#instances.length < need) {
      let length = Math.max(INSTANCE_FLOATS * 16, this.#instances.length);
      while (length < need) length *= 2;
      this.#instances = new Float32Array(length);
    }
    const out = this.#instances;
    for (let i = 0; i < count; i += 1) {
      const at = i * INSTANCE_FLOATS;
      const model = items[from + i].worldMatrix;
      for (let k = 0; k < 16; k += 1) {
        out[at + k] = model.elements[k];
      }
      // Identity seed first: a singular model must not leak the previous
      // instance's inverse-transpose (the same rule the per-draw upload has).
      instanceNormal.identity();
      instanceNormal.setNormalFromMatrix4(model);
      for (let k = 0; k < 9; k += 1) {
        out[at + 16 + k] = instanceNormal.elements[k];
      }
    }
    const run = this.#run;
    run.kind = first.kind;
    run.first = first;
    run.items = count;
    run.instances = out;
    run.contentVersion = contentVersionOf(items, from, count);
    return run;
  }

  /**
   * Plans and assembles the batch that starts at `items[from]`, or returns
   * `null` when that item does not start one.
   *
   * ```ts
   * const batch = batcher.next(list, i, viewMask);
   * if (batch !== null) { draw(batch); i += batch.items - 1; }
   * ```
   *
   * Returning `null` is the common answer and costs one predicate plus, at
   * most, one comparison against the next item: an item that cannot batch, or
   * whose successor carries a different material, is rejected before anything
   * is written. A caller that skips the merged items (`i += batch.items - 1`)
   * pays **O(n) in total** for a whole list, since each item is examined by the
   * scan that consumes it and by the scan that stops at it.
   *
   * `layerMask` is §46's per-view filter, applied here for the same reason a
   * backend applies it per item: an item this view does not draw must not be
   * merged into a batch it *would* draw. A masked-out item **ends the run**
   * rather than being skipped inside it, so the returned `items` count is
   * always a contiguous span of the list and the caller's index arithmetic
   * stays trivial.
   *
   * @param items a render list, as {@link buildRenderList} produced it.
   * @param from index of the item to start at.
   * @param layerMask §46 mask of the view being drawn; defaults to `ALL_LAYERS`.
   * @returns the pooled batch — valid until the next call — or `null`.
   */
  next(
    items: readonly RenderItem[],
    from: number,
    layerMask: LayerMask = ALL_LAYERS,
  ): RenderBatch | null {
    const first = items[from];
    if (first === undefined || (first.layers & layerMask) === 0) {
      return null;
    }
    if (!isBatchable(first)) {
      return null;
    }
    const material: BatchableMaterial = first.material;
    // §67's clip for the whole run (R-23) — see `RenderBatch.clip`. `?? null`
    // so a structurally-typed item predating the field compares equal to the
    // builders' own unclipped `null` rather than ending every run at it.
    const clip = first.clip ?? null;
    const scissor = first.scissor ?? null;
    const kind = first.kind;
    const mode = first.geometry.mode;
    let vertexCount = first.geometry.vertexCount;
    if (vertexCount > this.maxVertices) {
      return null;
    }
    let indexCount = first.geometry.drawCount;

    // Scan: how far does the run reach? Comparisons only — nothing is written
    // until the run is known to be worth building, so the common "no batch
    // here" answer never touches the staging arrays.
    let count = 1;
    for (let i = from + 1; i < items.length; i += 1) {
      const item = items[i];
      if (
        (item.layers & layerMask) === 0 ||
        item.material !== material ||
        // §67 (R-23): the same material under a different clip is a different
        // draw. Identity, not equality — every item under one clip carries the
        // same pooled record — and `null !== null` is `false`, so an unclipped
        // scene's runs are exactly the runs it had before clipping existed.
        // `?? null` for `first`'s reason above.
        (item.clip ?? null) !== clip ||
        // §67 scissor: the same material under two rectangles is two draws.
        // Value equality so independently written identical rects still merge;
        // `null` matches `undefined`, so a scene that never names a scissor
        // keeps the runs it had before the field existed.
        !scissorsEqual(item.scissor, scissor) ||
        item.geometry.mode !== mode ||
        !isBatchable(item)
      ) {
        break;
      }
      const geometry = item.geometry;
      if (vertexCount + geometry.vertexCount > this.maxVertices) {
        break;
      }
      vertexCount += geometry.vertexCount;
      indexCount += geometry.drawCount;
      count += 1;
    }
    let atlasEntries: readonly AtlasEntry[] | null = null;
    if (this.#atlas !== null) {
      const extended = this.#planAtlas(
        items,
        from,
        count,
        vertexCount,
        layerMask,
      );
      if (extended > 1) {
        atlasEntries = this.#entries;
        count = extended;
        vertexCount = 0;
        indexCount = 0;
        for (let i = 0; i < count; i += 1) {
          vertexCount += items[from + i].geometry.vertexCount;
          indexCount += items[from + i].geometry.drawCount;
        }
      }
    }
    if (count < 2) {
      return null;
    }

    // §57's feature switches decide the layout, and they are material state —
    // so one look at the shared material answers for the whole run. A sprite
    // always samples (§55) and never carries per-vertex colour; an unlit
    // material carries whichever of the two R-19 streams it declares.
    // Read defensively, as `render-list.ts` reads §57's flags and for the same
    // reason: a **structurally typed** material double predating §57's `map` or
    // §53's `vertexColors` reports `undefined`, which must mean "samples
    // nothing" and "carries no colour stream" rather than widening the layout
    // with a stream no geometry will fill.
    const texture =
      atlasEntries !== null
        ? atlasEntries[0].page
        : first.kind === "sprite"
          ? first.material.texture
          : (first.material.map ?? null);
    const hasUvs = first.kind === "sprite" || texture !== null;
    const hasColors =
      first.kind === "unlit" && first.material.vertexColors === true;
    const floatsPerVertex =
      POSITION_FLOATS +
      (hasUvs ? UV_FLOATS : 0) +
      (hasColors ? COLOR_FLOATS : 0);

    this.#reserve(vertexCount * floatsPerVertex, indexCount);
    const vertices = this.#vertices;
    const indices = this.#indices;
    let vertexBase = 0;
    let floatOffset = 0;
    let indexOffset = 0;
    for (let i = 0; i < count; i += 1) {
      const item = items[from + i];
      const geometry = item.geometry;
      floatOffset = this.#writeVertices(
        item,
        floatOffset,
        floatsPerVertex,
        hasUvs,
        hasColors,
        atlasEntries === null ? null : atlasEntries[i],
      );
      indexOffset = this.#writeIndices(geometry, indexOffset, vertexBase);
      vertexBase += geometry.vertexCount;
    }

    const batch = this.#batch;
    batch.kind = kind;
    batch.material = material;
    // The kind-dependent reads, done once here so the backend's draw path has
    // none — see `RenderBatch.texture` and `RenderBatch.color`. `?? 1` on the
    // opacity for the reason the feature switches are read defensively above.
    batch.texture = texture;
    batch.color =
      first.kind === "sprite" ? first.material.tint : first.material.color;
    batch.opacity = material.opacity ?? 1;
    batch.mode = mode;
    batch.clip = clip;
    batch.scissor = scissor;
    batch.items = count;
    batch.vertexCount = vertexCount;
    batch.indexCount = indexCount;
    batch.floatsPerVertex = floatsPerVertex;
    batch.hasUvs = hasUvs;
    batch.hasColors = hasColors;
    batch.vertices = vertices;
    batch.indices = indices;
    batch.contentVersion = contentVersionOf(items, from, count, atlasEntries);
    batch.atlased = atlasEntries !== null;
    return batch;
  }

  /**
   * Atlas extension of the run `[from, from + sameCount)` (W11.4): returns the
   * length of the atlas run (≥ 2, filling {@link RenderBatcher.#entries}), or
   * `0` when the plain consecutive-same-material run stands.
   *
   * Called only after the same-material scan stopped; it proceeds only if the
   * item that stopped it differs from `first` by texture alone. Packs the
   * run's distinct textures in height/id order, then walks the items once to
   * bind entries, truncating at the first item that is on another page, has
   * unusable uvs, or whose texture the atlas refused.
   */
  #planAtlas(
    items: readonly RenderItem[],
    from: number,
    sameCount: number,
    sameVertices: number,
    layerMask: LayerMask,
  ): number {
    const atlas = this.#atlas!;
    const first = items[from] as BatchableItem;
    const stopped = items[from + sameCount];
    if (
      stopped === undefined ||
      !isBatchable(stopped) ||
      stopped.material === first.material ||
      (stopped.layers & layerMask) === 0 ||
      !atlasJoinable(first, stopped, atlas) ||
      !atlas.canPack(textureOf(first)!)
    ) {
      return 0;
    }
    const clip = first.clip ?? null;
    const scissor = first.scissor ?? null;
    const mode = first.geometry.mode;
    let vertexCount = sameVertices;
    let reach = sameCount;
    for (let i = from + sameCount; i < items.length; i += 1) {
      const item = items[i];
      if (
        (item.layers & layerMask) === 0 ||
        (item.clip ?? null) !== clip ||
        !scissorsEqual(item.scissor, scissor) ||
        item.geometry.mode !== mode ||
        !isBatchable(item) ||
        (item.material !== first.material &&
          !atlasJoinable(first, item, atlas)) ||
        vertexCount + item.geometry.vertexCount > this.maxVertices
      ) {
        break;
      }
      vertexCount += item.geometry.vertexCount;
      reach += 1;
    }

    const textures = this.#textures;
    let distinct = 0;
    let previous: MaterialTexture | null = null;
    for (let i = 0; i < reach; i += 1) {
      const texture = textureOf(items[from + i] as BatchableItem)!;
      if (texture !== previous) {
        textures[distinct] = texture;
        distinct += 1;
        previous = texture;
      }
    }
    atlas.packAll(textures, distinct);

    const entries = this.#entries;
    let count = 0;
    let segments = 0;
    let differs = false;
    let page: AtlasEntry["page"] | null = null;
    let previousMaterial: BatchableMaterial | null = null;
    for (let i = 0; i < reach; i += 1) {
      const item = items[from + i] as BatchableItem;
      const entry = atlas.entry(textureOf(item)!);
      if (
        entry === null ||
        (page !== null && entry.page !== page) ||
        !uvsInUnitRange(item.geometry)
      ) {
        break;
      }
      page = entry.page;
      entries[i] = entry;
      if (item.material !== previousMaterial) {
        segments += 1;
        previousMaterial = item.material;
      }
      differs ||= item.material !== first.material;
      count += 1;
    }
    if (count < 2 || !differs) {
      return 0;
    }
    this.#atlasRuns += 1;
    this.#atlasItems += count;
    this.#drawsSaved += segments - 1;
    return count;
  }

  /**
   * Grows the staging arrays to hold at least `floats` and `indices`.
   *
   * Doubling (from a 1 024-float floor) rather than exact sizing, so a scene
   * whose batches vary in size reallocates a handful of times and then never
   * again — the same "grow to the scene and stop" shape `render-list.ts`'s item
   * pool has. Contents are not preserved: every float and index is overwritten
   * by the caller before it is read.
   */
  #reserve(floats: number, indices: number): void {
    if (this.#vertices.length < floats) {
      let length = Math.max(1_024, this.#vertices.length);
      while (length < floats) length *= 2;
      this.#vertices = new Float32Array(length);
    }
    if (this.#indices.length < indices) {
      let length = Math.max(1_024, this.#indices.length);
      while (length < indices) length *= 2;
      this.#indices = new Uint32Array(length);
    }
  }

  /**
   * Writes one item's vertices into the staging array at `offset`, returning
   * the offset after them.
   *
   * The position of every vertex is transformed by the item's **world matrix**
   * here, because a batch has one model matrix for many nodes — see the module
   * header for what that costs and what it does not. The other two streams are
   * copied verbatim: a batched geometry's uv and colour are the same numbers
   * the unbatched draw would have read out of the same buffers.
   *
   * A geometry that lacks a stream the layout declares contributes GL's own
   * generic attribute default — `(0, 0)` for uv, `(0, 0, 0, 1)` for colour —
   * which is precisely what the *unbatched* draw would sample, since a vertex
   * array with no such buffer leaves the attribute disabled. Filling the
   * default rather than refusing the item is therefore not a kindness: it is
   * what keeps the batch a faithful copy of the draws it replaces. Sprites
   * author their atlas cell on `geometry.uvs`; this path copies that stream.
   */
  #writeVertices(
    item: RenderItem,
    offset: number,
    floatsPerVertex: number,
    hasUvs: boolean,
    hasColors: boolean,
    entry: AtlasEntry | null,
  ): number {
    const geometry = item.geometry;
    const positions = geometry.positions;
    const vertexCount = geometry.vertexCount;
    const uvs = geometry.uvs;
    const colors = geometry.colors;
    const e = item.worldMatrix.elements;
    const m0 = e[0];
    const m1 = e[1];
    const m2 = e[2];
    const m4 = e[4];
    const m5 = e[5];
    const m6 = e[6];
    const m8 = e[8];
    const m9 = e[9];
    const m10 = e[10];
    const m12 = e[12];
    const m13 = e[13];
    const m14 = e[14];
    const vertices = this.#vertices;
    // Atlas rewrite (W11.4): u' = (x + u·w) / page, v' likewise. `entry` is
    // non-null only for a run `#planAtlas` validated, whose uvs exist.
    const pageSize = entry === null ? 1 : entry.page.width;
    const scaleU = entry === null ? 1 : entry.width / pageSize;
    const scaleV = entry === null ? 1 : entry.height / pageSize;
    const offsetU = entry === null ? 0 : entry.x / pageSize;
    const offsetV = entry === null ? 0 : entry.y / pageSize;
    let at = offset;
    for (let v = 0; v < vertexCount; v += 1) {
      const p = v * 3;
      const x = positions[p];
      const y = positions[p + 1];
      const z = positions[p + 2];
      vertices[at] = m0 * x + m4 * y + m8 * z + m12;
      vertices[at + 1] = m1 * x + m5 * y + m9 * z + m13;
      vertices[at + 2] = m2 * x + m6 * y + m10 * z + m14;
      let stream = at + POSITION_FLOATS;
      if (hasUvs) {
        if (uvs === undefined) {
          vertices[stream] = 0;
          vertices[stream + 1] = 0;
        } else {
          const uv = v * 2;
          vertices[stream] = offsetU + uvs[uv] * scaleU;
          vertices[stream + 1] = offsetV + uvs[uv + 1] * scaleV;
        }
        stream += UV_FLOATS;
      }
      if (hasColors) {
        if (colors === undefined) {
          vertices[stream] = 0;
          vertices[stream + 1] = 0;
          vertices[stream + 2] = 0;
          vertices[stream + 3] = 1;
        } else {
          const c = v * 4;
          vertices[stream] = colors[c];
          vertices[stream + 1] = colors[c + 1];
          vertices[stream + 2] = colors[c + 2];
          vertices[stream + 3] = colors[c + 3];
        }
      }
      at += floatsPerVertex;
    }
    return at;
  }

  /**
   * Writes one item's indices into the staging array at `offset`, shifted by
   * `vertexBase`, and returns the offset after them.
   *
   * A **non-indexed** geometry contributes the identity sequence, which is what
   * makes a run of mixed indexed and non-indexed geometries mergeable at all:
   * one merged draw has one element type, so the batch is always indexed and a
   * `drawArrays` item becomes `base, base+1, …` — the same vertices in the same
   * order, drawn by `drawElements` instead. §53 fixes both index types at
   * unsigned integers and this planner widens to 32 bits, so no source index
   * can overflow the destination.
   */
  #writeIndices(
    geometry: BufferGeometry,
    offset: number,
    vertexBase: number,
  ): number {
    const indices = this.#indices;
    const source = geometry.indices;
    const count = geometry.drawCount;
    if (source === undefined) {
      for (let i = 0; i < count; i += 1) {
        indices[offset + i] = vertexBase + i;
      }
      return offset + count;
    }
    for (let i = 0; i < count; i += 1) {
      indices[offset + i] = vertexBase + source[i];
    }
    return offset + count;
  }
}
