/**
 * `BufferGeometry` (§53) — CPU-side vertex data, in the one shape the MVP
 * renderer draws.
 *
 * §53 describes a family (`Geometry2D`, `Geometry3D`, `IndexedGeometry`,
 * `ProceduralGeometry`, …) over an abstract base with `id`, `version`,
 * `bounds`, `computeBounds()`, `clone()`, and `dispose()`. This packet
 * implements exactly one concrete member of it — positions, the optional
 * per-vertex `normals`, `uvs`, `colors`, and (since RFC 0003) `joints`/`weights`
 * attributes, optional indices, a
 * draw mode — because that is what the §120 MVP renders (unlit, textured, and
 * Lambert-lit primitives, WebGL 2). The rest of the family and the rest of
 * §53's standard attribute set (tangents, a secondary uv set,
 * instance transforms) are deliberately absent rather than
 * sketched: each of them pins a public layout that the WebGL backend and the
 * §79 scene format both have to agree with, and none of them is needed to draw
 * a textured box.
 *
 * `normals` joined the layout with the §68 lighting packet (2026-08-04): a lit
 * surface (§120 "lighting") cannot be shaded without per-vertex normals, and
 * §53's own attribute list names them first. The attribute is **optional** —
 * 2D shapes stay position-only and unlit — and, when present, index-aligned
 * with `positions`: `normals[3 * i]` is vertex `i`'s normal x. Unit length is
 * the author's contract, not validated here (§85 checks finiteness only; the
 * lit pipeline normalizes after interpolation anyway, and re-checking length
 * per component would reject legitimately denormalized authored data).
 *
 * `uvs` and `colors` joined it the same way (R-19), and follow the `normals`
 * precedent exactly — optional, index-aligned, §85-validated on assignment,
 * dropped by `dispose()`:
 *
 * - **`uvs`** are 2 floats per vertex (`uvs[2 * i]` is vertex `i`'s u), the
 *   texture coordinate §53 names and §55/§57's `map` samples with. `v = 0` is
 *   the bottom edge, matching §7a's Y-up world and the bottom-row-first texel
 *   order `@fourjs/render`'s `TextureSource` documents — so a textured quad needs
 *   no flip anywhere. Values outside 0…1 are legal (they tile or clamp
 *   according to the sampler, which is backend state, not geometry state).
 * - **`colors`** are 4 floats per vertex (`colors[4 * i]` is vertex `i`'s red),
 *   straight (non-premultiplied) RGBA in the same nominal 0…1 range and with
 *   the same "no color space attached" policy `UnlitMaterial.color` states
 *   (§60a). They are what makes §113's debug-draw overlay drawable: a segment
 *   list is positions plus colors, uploaded once and drawn with
 *   `UnlitMaterial({ vertexColors: true })`.
 *
 * Neither is *consumed* unless a material asks for it: a geometry may carry uvs
 * and still draw flat-coloured, which is what keeps the attributes free to add
 * to the primitive builders without changing a single existing pixel.
 *
 * `joints` and `weights` joined on 2026-08-28 (§54; RFC 0003 — this is "the
 * act of pinning that layout" the paragraph above deferred), following the
 * same precedent — optional, index-aligned, §85-validated on assignment,
 * dropped by `dispose()`:
 *
 * - **`joints`** are **4 joint indices per vertex** (`joints[4 * i]` is vertex
 *   `i`'s first influence), as a `Uint16Array`. This package cannot name a
 *   bone — its §3.1 row is `core, math` — so a joint is an *index*, and what
 *   it indexes is somebody else's problem: `@fourjs/scene`'s `Skeleton.bones`,
 *   whose insertion order is the ABI (§33). Indices are **not** range-checked
 *   here, because the geometry cannot see the skeleton; the backend's joint
 *   limit and the skeleton's own length are checked where each is known.
 * - **`weights`** are 4 floats per vertex, index-parallel with `joints`.
 *   Their sum per vertex should be 1, and — the `normals` precedent applied
 *   verbatim — that is the author's contract, not validated here: §85 checks
 *   finiteness only, and a renormalization would silently rewrite authored
 *   data.
 *
 * Four influences per vertex matches glTF's `JOINTS_0`/`WEIGHTS_0` and fixes
 * the attribute budget. Morph target `k` occupies `POSITION_k`/`NORMAL_k` at
 * locations `6 + 2(k−1)` / `7 + 2(k−1)` — this packet ships **one** target
 * (`positions1` / `normals1` at **6 / 7**). `JOINTS_1`/`WEIGHTS_1` keep their
 * reserved slots at **8 / 9**, past the first morph pair, so an eight-influence
 * skin and a one-target morph can coexist (spec revision 1.19). The WebGL
 * backend binds joints/weights at **4 / 5**, continuing R-19's numbering —
 * 0 position, 1 normal, 2 uv, 3 colour.
 *
 * ## Version, not events
 *
 * Backends cache GPU buffers per geometry. The cache key is
 * {@link BufferGeometry.version}, which advances on every mutation the geometry
 * can see — the same contract `Transform.version` (§7) offers, down to the
 * rule for mutations it *cannot* see:
 *
 * ```ts
 * geometry.positions[0] = 2;  // in-place edit — invisible to the geometry
 * geometry.uvs![0] = 0.5;     // …and so is one into any other attribute
 * geometry.markDirty();       // announce it: version += 1
 * ```
 *
 * Replacing an array wholesale (`geometry.positions = next`) goes through a
 * setter which validates and bumps the version for you. There is no change
 * event: a renderer that draws a geometry every frame compares a number, and an
 * event would cost a subscription per geometry per backend for no extra
 * information.
 *
 * ## Validation (§85)
 *
 * §85 requires development builds to detect "NaN and infinite values" and
 * "invalid geometry indices". Both are checked **when an array is assigned** —
 * at construction or through a setter — and never per frame: assignment is an
 * authoring-time event, so an O(n) pass there is free, while the same pass on
 * the draw path would be the most expensive thing the renderer does. Failures
 * throw `RangeError`/`TypeError` rather than `FourError`: §89's code union has
 * no argument-validation member today, and extending it belongs to the packet
 * that owns `@fourjs/core` (reported as a WP-3.3 decision).
 *
 * In-place edits followed by {@link BufferGeometry.markDirty} are *not*
 * re-validated. That is the fast path, and re-validating it would defeat the
 * purpose of having one.
 *
 * ## Resource accounting (§83, A-5)
 *
 * Every geometry reports its size ({@link BufferGeometry.byteLength}) to the
 * process-wide totals in `resource-memory.ts` — at construction, on each
 * attribute replacement, and on `dispose()` — which is what makes §84's
 * `bufferMemory` measurable and a leaked geometry visible. The accounting is
 * arithmetic on two module-level numbers, holds no reference to anything, and
 * never runs on a draw path. `resource-memory.ts` documents the design.
 */

import { Vector3 } from "@fourjs/math";

import {
  Geometry,
  type BoundingVolume,
  type MutableBoundingVolume,
} from "./geometry.js";
import {
  noteGeometry,
  releaseGeometryDisposable,
  trackGeometryDisposable,
} from "./resource-memory.js";

/**
 * How a geometry's vertices assemble into primitives.
 *
 * The MVP tier (§120) draws filled shapes and debug/wire lines, so the two
 * modes are `"triangles"` and `"lines"`; strips, fans, and points are not
 * exposed because nothing in this phase emits them (a fan is expanded into
 * indexed triangles by {@link circleGeometry2D} instead — see `primitives.ts`).
 * The mode fixes how many indices — or, unindexed, how many vertices — make one
 * primitive: three for `"triangles"`, two for `"lines"`.
 */
export type GeometryDrawMode = "triangles" | "lines";

/**
 * The two index element types WebGL 2 accepts (`UNSIGNED_SHORT` and
 * `UNSIGNED_INT`). Builders pick the narrower one whenever the vertex count
 * fits — see `primitives.ts`.
 */
export type GeometryIndexArray = Uint16Array | Uint32Array;

/**
 * The axis-aligned box half of §53's bounding volume, in the geometry's own
 * local space.
 *
 * **This is now an alias of {@link BoundingVolume}** (R-21, 2026-08-21), which
 * is that box plus the sphere circumscribing it. The name is kept because four
 * packages import it, and the widening is additive: every existing reader of
 * `.min`/`.max` sees exactly the values it saw before. New code should prefer
 * `BoundingVolume` — the name §53 uses.
 */
export type GeometryBounds = BoundingVolume;

/** Construction arguments of {@link BufferGeometry}. */
export interface BufferGeometryOptions {
  /**
   * Vertex positions as xyz triplets — `positions[3 * i]` is vertex `i`'s x.
   * Length must be a multiple of 3 and every value must be finite (§85).
   */
  positions: Float32Array;
  /**
   * Optional per-vertex normals as xyz triplets, index-aligned with
   * `positions` (§53, §68). Length must equal `positions.length` and every
   * value must be finite (§85). Unit length is the author's contract — see the
   * module header.
   */
  normals?: Float32Array;
  /**
   * Optional per-vertex texture coordinates as uv pairs, index-aligned with
   * `positions` (§53, §55). Length must be `2 / 3` of `positions.length` — two
   * floats per vertex — and every value must be finite (§85). `v = 0` is the
   * bottom edge; see the module header.
   */
  uvs?: Float32Array;
  /**
   * Optional per-vertex straight RGBA colors, index-aligned with `positions`
   * (§53, §60a). Length must be `4 / 3` of `positions.length` — four floats
   * per vertex — and every value must be finite (§85). Consumed only by a
   * material that opts in (`UnlitMaterial.vertexColors`).
   */
  colors?: Float32Array;
  /**
   * Optional per-vertex joint indices as quadruplets, index-aligned with
   * `positions` (§53, §54; RFC 0003). Length must be `4 / 3` of
   * `positions.length` — four influences per vertex — and each entry indexes a
   * `Skeleton.bones` array this package cannot see (§85 checks the length; the
   * range is the consumers'). Meaningful only together with `weights`.
   */
  joints?: Uint16Array;
  /**
   * Optional per-vertex joint weights as quadruplets, index-parallel with
   * `joints` (§53, §54; RFC 0003). Length must be `4 / 3` of
   * `positions.length` and every value finite (§85); summing to 1 per vertex
   * is the author's contract — see the module header.
   */
  weights?: Float32Array;
  /**
   * Optional first morph-target positions (`POSITION_1`) as xyz triplets,
   * index-aligned with `positions` (§54 GPU morph path). Length must equal
   * `positions.length`. Bound at attribute location **6**.
   */
  positions1?: Float32Array;
  /**
   * Optional first morph-target normals (`NORMAL_1`) as xyz triplets,
   * index-aligned with `positions` (§54). Length must equal `positions.length`.
   * Bound at attribute location **7**.
   */
  normals1?: Float32Array;
  /**
   * Optional index buffer. Every entry must be a valid vertex index and the
   * length must be a multiple of the mode's primitive size (§85).
   */
  indices?: GeometryIndexArray;
  /** Primitive assembly; defaults to `"triangles"`. */
  mode?: GeometryDrawMode;
}

/** Shared empty backing store handed to a disposed geometry. */
const EMPTY_POSITIONS = new Float32Array(0);

/** Vertices (or indices) that make up one primitive, per draw mode. */
function primitiveSize(mode: GeometryDrawMode): number {
  return mode === "triangles" ? 3 : 2;
}

/**
 * Runs the §85 checks for one optional vertex attribute: index-aligned with
 * `positions` at `components` floats per vertex, every value finite.
 *
 * One helper for `normals`, `uvs`, and `colors` because the rule is one rule —
 * the only difference between them is the component count and the § reference
 * the message cites, and three copies of the same loop is how the three drift
 * apart.
 */
function validateAttribute(
  name: string,
  values: Float32Array | Uint16Array | undefined,
  components: number,
  vertexCount: number,
  reference: string,
): void {
  if (values === undefined) {
    return;
  }
  const expected = vertexCount * components;
  if (values.length !== expected) {
    throw new RangeError(
      `Geometry ${name} must be index-aligned with positions — ` +
        `${String(components)} floats per vertex — so their length must be ` +
        `${String(expected)}; got ${String(values.length)} (${reference}).`,
    );
  }
  if (values instanceof Uint16Array) {
    // §54's `joints`: every element of a Uint16Array is a finite integer by
    // construction, so the finiteness pass below has nothing to find and is
    // skipped rather than run for show.
    return;
  }
  for (let i = 0; i < values.length; i += 1) {
    if (!Number.isFinite(values[i])) {
      throw new RangeError(
        `Geometry ${name.slice(0, -1)} ${String(i)} is ${String(values[i])}; ` +
          `${name} must be finite (§85: NaN and infinite values).`,
      );
    }
  }
}

/**
 * Runs the §85 checks for one (positions, normals, uvs, colors, indices, mode)
 * tuple. Throws on the first violation; returns nothing.
 */
function validate(
  positions: Float32Array,
  normals: Float32Array | undefined,
  uvs: Float32Array | undefined,
  colors: Float32Array | undefined,
  joints: Uint16Array | undefined,
  weights: Float32Array | undefined,
  positions1: Float32Array | undefined,
  normals1: Float32Array | undefined,
  indices: GeometryIndexArray | undefined,
  mode: GeometryDrawMode,
): void {
  if (positions.length % 3 !== 0) {
    throw new RangeError(
      `Geometry positions must be xyz triplets, so their length must be a ` +
        `multiple of 3; got ${String(positions.length)} (§53).`,
    );
  }
  for (let i = 0; i < positions.length; i += 1) {
    if (!Number.isFinite(positions[i])) {
      throw new RangeError(
        `Geometry position ${String(i)} is ${String(positions[i])}; positions ` +
          "must be finite (§85: NaN and infinite values).",
      );
    }
  }

  const vertexCount = positions.length / 3;
  validateAttribute("normals", normals, 3, vertexCount, "§53, §68");
  validateAttribute("uvs", uvs, 2, vertexCount, "§53, §55");
  validateAttribute("colors", colors, 4, vertexCount, "§53, §60a");
  validateAttribute("joints", joints, 4, vertexCount, "§53, §54");
  validateAttribute("weights", weights, 4, vertexCount, "§53, §54");
  validateAttribute("positions1", positions1, 3, vertexCount, "§53, §54");
  validateAttribute("normals1", normals1, 3, vertexCount, "§53, §54");

  const size = primitiveSize(mode);

  if (indices === undefined) {
    if (vertexCount % size !== 0) {
      throw new RangeError(
        `A non-indexed "${mode}" geometry needs a multiple of ${String(size)} ` +
          `vertices; got ${String(vertexCount)} (§85).`,
      );
    }
    return;
  }

  if (indices.length % size !== 0) {
    throw new RangeError(
      `An indexed "${mode}" geometry needs a multiple of ${String(size)} ` +
        `indices; got ${String(indices.length)} (§85: invalid geometry indices).`,
    );
  }
  for (let i = 0; i < indices.length; i += 1) {
    if (indices[i] >= vertexCount) {
      throw new RangeError(
        `Geometry index ${String(i)} refers to vertex ${String(indices[i])}, ` +
          `but the geometry has ${String(vertexCount)} vertices ` +
          "(§85: invalid geometry indices).",
      );
    }
  }
}

/**
 * Vertex positions plus optional indices — the geometry every MVP-tier
 * renderable draws (§53).
 *
 * ```ts
 * const geometry = new BufferGeometry({
 *   positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
 * });
 * geometry.computeBounds();      // { min: (0,0,0), max: (1,1,0) }
 * geometry.dispose();            // §83: explicit lifetime
 * ```
 *
 * Geometries are **shared, not owned by nodes**: any number of `Renderable`s
 * may point at one, and disposing it is the job of whoever created it (§83).
 */
export class BufferGeometry extends Geometry {
  #positions: Float32Array;

  #normals: Float32Array | undefined;

  #uvs: Float32Array | undefined;

  #colors: Float32Array | undefined;

  #joints: Uint16Array | undefined;

  #weights: Float32Array | undefined;

  #positions1: Float32Array | undefined;

  #normals1: Float32Array | undefined;

  #indices: GeometryIndexArray | undefined;

  #mode: GeometryDrawMode;

  #version = 0;

  #disposed = false;

  /** Bounds storage, allocated once and rewritten by every recompute. */
  readonly #boundsMin = new Vector3();

  readonly #boundsMax = new Vector3();

  readonly #boundsCenter = new Vector3();

  readonly #bounds: MutableBoundingVolume = {
    min: this.#boundsMin,
    max: this.#boundsMax,
    center: this.#boundsCenter,
    radius: Number.NaN,
  };

  /**
   * {@link BufferGeometry.version} at the last bounds computation. Starts at -1
   * — never a legal version — so the first `computeBounds()` always computes.
   */
  #boundsVersion = -1;

  constructor(options: BufferGeometryOptions) {
    super();
    const mode = options.mode ?? "triangles";
    validate(
      options.positions,
      options.normals,
      options.uvs,
      options.colors,
      options.joints,
      options.weights,
      options.positions1,
      options.normals1,
      options.indices,
      mode,
    );
    this.#positions = options.positions;
    this.#normals = options.normals;
    this.#uvs = options.uvs;
    this.#colors = options.colors;
    this.#joints = options.joints;
    this.#weights = options.weights;
    this.#positions1 = options.positions1;
    this.#normals1 = options.normals1;
    this.#indices = options.indices;
    this.#mode = mode;
    noteGeometry(1, this.byteLength);
    trackGeometryDisposable(this, this.id);
  }

  /**
   * Announces a mutation that may have changed how many bytes this geometry
   * holds: reconciles the §83 totals against `bytesBefore` and bumps the
   * version. The one place attribute replacement and disposal share, so the two
   * cannot drift apart.
   */
  #mutated(bytesBefore: number): void {
    noteGeometry(0, this.byteLength - bytesBefore);
    this.markDirty();
  }

  /**
   * Vertex positions as xyz triplets. The array is held by reference, not
   * copied — a builder that generated it hands over ownership, and a renderer
   * may upload straight from it.
   *
   * Assigning a new array validates it (§85) and bumps
   * {@link BufferGeometry.version}. Editing the existing array in place is
   * legal and cheap, but invisible here: call {@link BufferGeometry.markDirty}
   * afterwards.
   */
  get positions(): Float32Array {
    return this.#positions;
  }

  set positions(value: Float32Array) {
    validate(
      value,
      this.#normals,
      this.#uvs,
      this.#colors,
      this.#joints,
      this.#weights,
      this.#positions1,
      this.#normals1,
      this.#indices,
      this.#mode,
    );
    const before = this.byteLength;
    this.#positions = value;
    this.#mutated(before);
  }

  /**
   * Optional per-vertex normals, or `undefined` for an attribute-free layout
   * (§53, §68). Held by reference, like {@link BufferGeometry.positions}, and
   * subject to the same rules: assigning validates (index-aligned with
   * positions, finite, §85) and bumps the version; in-place edits need
   * {@link BufferGeometry.markDirty}. Assigning `undefined` drops the
   * attribute — the geometry draws unlit-only from then on (a lit draw of a
   * normal-less geometry shades from its ambient term alone; see
   * `@fourjs/render-webgl`).
   *
   * Replacing `positions` with an array of a different vertex count while
   * normals are present therefore throws: drop or replace the normals first.
   */
  get normals(): Float32Array | undefined {
    return this.#normals;
  }

  set normals(value: Float32Array | undefined) {
    validate(
      this.#positions,
      value,
      this.#uvs,
      this.#colors,
      this.#joints,
      this.#weights,
      this.#positions1,
      this.#normals1,
      this.#indices,
      this.#mode,
    );
    const before = this.byteLength;
    this.#normals = value;
    this.#mutated(before);
  }

  /**
   * Optional per-vertex texture coordinates as uv pairs, or `undefined` for a
   * geometry that carries none (§53, §55). Held by reference, like
   * {@link BufferGeometry.positions}, and subject to the same rules: assigning
   * validates (two floats per vertex, index-aligned, finite, §85) and bumps the
   * version; **in-place edits are invisible and need
   * {@link BufferGeometry.markDirty}**. Assigning `undefined` drops the
   * attribute — a textured draw of a uv-less geometry then samples the texel at
   * `(0, 0)` for every fragment, because GL's constant attribute default is
   * `(0, 0, 0, 1)`.
   *
   * Replacing `positions` with an array of a different vertex count while uvs
   * are present therefore throws: drop or replace the uvs first, exactly as for
   * {@link BufferGeometry.normals}.
   */
  get uvs(): Float32Array | undefined {
    return this.#uvs;
  }

  set uvs(value: Float32Array | undefined) {
    validate(
      this.#positions,
      this.#normals,
      value,
      this.#colors,
      this.#joints,
      this.#weights,
      this.#positions1,
      this.#normals1,
      this.#indices,
      this.#mode,
    );
    const before = this.byteLength;
    this.#uvs = value;
    this.#mutated(before);
  }

  /**
   * Optional per-vertex straight RGBA colors, or `undefined` for a geometry
   * that carries none (§53, §60a). Held by reference, like
   * {@link BufferGeometry.positions}, and subject to the same rules: assigning
   * validates (four floats per vertex, index-aligned, finite, §85) and bumps
   * the version; **in-place edits are invisible and need
   * {@link BufferGeometry.markDirty}** — which is the fast path a debug-draw
   * overlay rewriting its segment colors every frame takes. Assigning
   * `undefined` drops the attribute; a `vertexColors` material drawing a
   * color-less geometry then multiplies by GL's constant default
   * `(0, 0, 0, 1)`, i.e. renders black.
   *
   * Replacing `positions` with an array of a different vertex count while
   * colors are present therefore throws: drop or replace the colors first.
   */
  get colors(): Float32Array | undefined {
    return this.#colors;
  }

  set colors(value: Float32Array | undefined) {
    validate(
      this.#positions,
      this.#normals,
      this.#uvs,
      value,
      this.#joints,
      this.#weights,
      this.#positions1,
      this.#normals1,
      this.#indices,
      this.#mode,
    );
    const before = this.byteLength;
    this.#colors = value;
    this.#mutated(before);
  }

  /**
   * Optional per-vertex joint indices as quadruplets, or `undefined` for a
   * geometry no skin influences (§53, §54; RFC 0003). Held by reference, like
   * {@link BufferGeometry.positions}, and subject to the same rules: assigning
   * validates (four entries per vertex, index-aligned, §85) and bumps the
   * version; **in-place edits are invisible and need
   * {@link BufferGeometry.markDirty}**. Assigning `undefined` drops the
   * attribute — the geometry then never draws skinned, whatever skeleton its
   * mesh carries (the render list warns about the mismatch in a development
   * build).
   *
   * Each entry indexes `Skeleton.bones` (§33: insertion order is the ABI) and
   * is deliberately not range-checked here — see the module header.
   */
  get joints(): Uint16Array | undefined {
    return this.#joints;
  }

  set joints(value: Uint16Array | undefined) {
    validate(
      this.#positions,
      this.#normals,
      this.#uvs,
      this.#colors,
      value,
      this.#weights,
      this.#positions1,
      this.#normals1,
      this.#indices,
      this.#mode,
    );
    const before = this.byteLength;
    this.#joints = value;
    this.#mutated(before);
  }

  /**
   * Optional per-vertex joint weights as quadruplets, index-parallel with
   * {@link BufferGeometry.joints}, or `undefined` (§53, §54; RFC 0003). Held
   * by reference and subject to the same rules as every attribute: assigning
   * validates (four finite floats per vertex, §85) and bumps the version;
   * in-place edits need {@link BufferGeometry.markDirty}. A per-vertex sum of
   * 1 is the author's contract, not validated — see the module header.
   */
  get weights(): Float32Array | undefined {
    return this.#weights;
  }

  set weights(value: Float32Array | undefined) {
    validate(
      this.#positions,
      this.#normals,
      this.#uvs,
      this.#colors,
      this.#joints,
      value,
      this.#positions1,
      this.#normals1,
      this.#indices,
      this.#mode,
    );
    const before = this.byteLength;
    this.#weights = value;
    this.#mutated(before);
  }

  /**
   * Optional first morph-target positions, or `undefined` (§54 GPU morph).
   * Location **6**. Same assignment rules as {@link BufferGeometry.normals}.
   */
  get positions1(): Float32Array | undefined {
    return this.#positions1;
  }

  set positions1(value: Float32Array | undefined) {
    validate(
      this.#positions,
      this.#normals,
      this.#uvs,
      this.#colors,
      this.#joints,
      this.#weights,
      value,
      this.#normals1,
      this.#indices,
      this.#mode,
    );
    const before = this.byteLength;
    this.#positions1 = value;
    this.#mutated(before);
  }

  /**
   * Optional first morph-target normals, or `undefined` (§54 GPU morph).
   * Location **7**. Same assignment rules as {@link BufferGeometry.normals}.
   */
  get normals1(): Float32Array | undefined {
    return this.#normals1;
  }

  set normals1(value: Float32Array | undefined) {
    validate(
      this.#positions,
      this.#normals,
      this.#uvs,
      this.#colors,
      this.#joints,
      this.#weights,
      this.#positions1,
      value,
      this.#indices,
      this.#mode,
    );
    const before = this.byteLength;
    this.#normals1 = value;
    this.#mutated(before);
  }

  /**
   * Optional index buffer, or `undefined` for sequential vertices. Assigning
   * validates against the current positions and mode and bumps the version;
   * assigning `undefined` drops indexing (and then requires a vertex count that
   * divides into whole primitives).
   */
  get indices(): GeometryIndexArray | undefined {
    return this.#indices;
  }

  set indices(value: GeometryIndexArray | undefined) {
    validate(
      this.#positions,
      this.#normals,
      this.#uvs,
      this.#colors,
      this.#joints,
      this.#weights,
      this.#positions1,
      this.#normals1,
      value,
      this.#mode,
    );
    const before = this.byteLength;
    this.#indices = value;
    this.#mutated(before);
  }

  /**
   * Primitive assembly. Assigning re-validates the buffers against the new
   * mode — switching a triangle geometry to `"lines"` fails unless the counts
   * divide by 2 — and bumps the version.
   */
  get mode(): GeometryDrawMode {
    return this.#mode;
  }

  set mode(value: GeometryDrawMode) {
    validate(
      this.#positions,
      this.#normals,
      this.#uvs,
      this.#colors,
      this.#joints,
      this.#weights,
      this.#positions1,
      this.#normals1,
      this.#indices,
      value,
    );
    this.#mode = value;
    this.markDirty();
  }

  /**
   * Counter incremented on every mutation (§53). Backends cache GPU buffers
   * against it; treat it as opaque and compare for inequality, exactly like
   * `Transform.version`. Monotonic, never wraps in a realistic session.
   */
  override get version(): number {
    return this.#version;
  }

  /**
   * This geometry's local {@link BoundingVolume} — §53's `bounds` field,
   * spelled as a getter so that it cannot go stale.
   *
   * Identical to calling {@link BufferGeometry.computeBounds}, down to the
   * identity of the returned object: reading the property recomputes exactly
   * when the method would.
   */
  override get bounds(): BoundingVolume {
    return this.computeBounds();
  }

  /** Number of vertices — `positions.length / 3`. */
  get vertexCount(): number {
    return this.#positions.length / 3;
  }

  /**
   * Number of elements one draw call issues: the index count when indexed, the
   * vertex count otherwise. Always a whole number of primitives.
   */
  get drawCount(): number {
    return this.#indices === undefined
      ? this.vertexCount
      : this.#indices.length;
  }

  /** Whether {@link BufferGeometry.dispose} has run. */
  override get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Bytes this geometry holds (§83, §84's `bufferMemory`) — the sum of the
   * `byteLength`s of `positions` and whichever of `normals`, `uvs`, `colors`,
   * `joints`, `weights`, `positions1`, `normals1`, and `indices` are present, and therefore exactly what
   * a backend uploads for it.
   *
   * ```ts
   * // 3 vertices × 3 floats × 4 bytes
   * new BufferGeometry({ positions: new Float32Array(9) }).byteLength; // 36
   * ```
   *
   * **`0` once disposed**, because a disposed geometry holds nothing — that is
   * the same fact `positions` reports by becoming empty, stated as a single
   * rule so that a write into a disposed geometry (already a §83 "disposed
   * resource still in use" mistake) cannot resurrect its bytes in the
   * process-wide totals.
   *
   * Derived on every read rather than cached: it is five property reads and an
   * addition, nothing on the draw path calls it, and a cached copy would be one
   * more thing an in-place edit could invalidate.
   */
  get byteLength(): number {
    if (this.#disposed) {
      return 0;
    }
    return (
      this.#positions.byteLength +
      (this.#normals?.byteLength ?? 0) +
      (this.#uvs?.byteLength ?? 0) +
      (this.#colors?.byteLength ?? 0) +
      (this.#joints?.byteLength ?? 0) +
      (this.#weights?.byteLength ?? 0) +
      (this.#positions1?.byteLength ?? 0) +
      (this.#normals1?.byteLength ?? 0) +
      (this.#indices?.byteLength ?? 0)
    );
  }

  /**
   * Announces a mutation the geometry could not see — an in-place write into
   * `positions`, `normals`, `uvs`, `colors`, or `indices`. Bumps
   * {@link BufferGeometry.version} by one, which invalidates the cached bounds
   * and every backend buffer keyed on the version.
   *
   * Calling it after a setter is harmless, only wasteful: the version advances
   * again and the bounds recompute once more.
   */
  markDirty(): void {
    this.#version += 1;
  }

  /**
   * Returns this geometry's local {@link BoundingVolume}, recomputing it only
   * when {@link BufferGeometry.version} has advanced since the last call (§53:
   * bounds are computed, then cached against the version).
   *
   * Allocates nothing — the returned volume and its three vectors are owned by
   * the geometry and rewritten in place on the next recompute, so callers that
   * keep the values must copy them.
   *
   * A geometry with no vertices returns the empty box `min = +Infinity`,
   * `max = -Infinity` (decision, WP-3.3): that is the identity element of
   * bounds union, so an empty geometry folded into a scene bound contributes
   * nothing, whereas a zero-sized box at the origin would drag the scene bound
   * to include a point that has no geometry in it. Its `center` and `radius`
   * are `NaN` for the same reason stated positively — the volume of no points
   * is not a point at the origin (R-21).
   */
  override computeBounds(): BoundingVolume {
    if (this.#boundsVersion === this.#version) {
      return this.#bounds;
    }

    const p = this.#positions;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (let i = 0; i < p.length; i += 3) {
      const x = p[i];
      const y = p[i + 1];
      const z = p[i + 2];
      if (x < minX) {
        minX = x;
      }
      if (y < minY) {
        minY = y;
      }
      if (z < minZ) {
        minZ = z;
      }
      if (x > maxX) {
        maxX = x;
      }
      if (y > maxY) {
        maxY = y;
      }
      if (z > maxZ) {
        maxZ = z;
      }
    }

    this.#boundsMin.set(minX, minY, minZ);
    this.#boundsMax.set(maxX, maxY, maxZ);
    if (minX > maxX) {
      // The empty box. Written explicitly rather than left to IEEE arithmetic,
      // which would disagree with itself here: `(+∞ + −∞) / 2` is `NaN` but
      // `|−∞ − +∞| / 2` is `+∞`, and a bound of infinite radius reads as
      // "everywhere" to a culler — the one wrong answer that is never
      // conservative in the safe direction.
      this.#boundsCenter.set(Number.NaN, Number.NaN, Number.NaN);
      this.#bounds.radius = Number.NaN;
    } else {
      const halfX = (maxX - minX) * 0.5;
      const halfY = (maxY - minY) * 0.5;
      const halfZ = (maxZ - minZ) * 0.5;
      this.#boundsCenter.set(minX + halfX, minY + halfY, minZ + halfZ);
      this.#bounds.radius = Math.sqrt(
        halfX * halfX + halfY * halfY + halfZ * halfZ,
      );
    }
    this.#boundsVersion = this.#version;
    return this.#bounds;
  }

  /**
   * An independent copy of this geometry — same vertex data, same mode,
   * **a new {@link BufferGeometry.id}**, version `0` (§53).
   *
   * ```ts
   * const wobbly = geometry.clone();
   * wobbly.positions[1] += 0.5;   // does not touch `geometry`
   * wobbly.markDirty();
   * ```
   *
   * ## The contract: deep in the attributes, and nothing else to be shallow in
   *
   * Every typed array is **copied**, not shared. That is the only choice that
   * survives contact with this class's own fast path: attributes are held *by
   * reference* and the documented way to edit them is an in-place write
   * followed by {@link BufferGeometry.markDirty}. A shallow clone would
   * therefore give two geometries one buffer and two independent version
   * counters — an in-place edit through either handle would silently change
   * what the other draws while leaving the other's version (and so every
   * backend cache keyed on it) untouched. That is not a cheaper clone; it is a
   * cache-coherence bug with a convenient name.
   *
   * There is nothing else in a geometry to copy: the bounds are derived (the
   * clone recomputes them on first use, to the same values), the id is
   * deliberately not copied, and the geometry holds no references to nodes,
   * materials, or backends.
   *
   * The cost is honest and worth stating: `clone()` allocates and copies
   * `byteLength` bytes, and reports them to the §83 totals as a second live
   * geometry. Cloning is for *forking* data — a procedural mesh about to be
   * deformed per instance. Sharing one geometry between many renderables needs
   * no clone at all (§83: geometries are shared, not owned by nodes).
   *
   * @throws TypeError if this geometry has been disposed. A disposed geometry
   * holds no data, so the copy would be a silently empty mesh — §83 names
   * "disposed resources still in use" as a thing to *detect*, and a refusal at
   * the call site is the earliest place to detect it.
   */
  override clone(): BufferGeometry {
    if (this.#disposed) {
      throw new TypeError(
        `Cannot clone ${this.id}: it has been disposed and holds no vertex ` +
          "data (§83: disposed resource still in use).",
      );
    }
    return new BufferGeometry({
      positions: this.#positions.slice(),
      normals: this.#normals?.slice(),
      uvs: this.#uvs?.slice(),
      colors: this.#colors?.slice(),
      joints: this.#joints?.slice(),
      weights: this.#weights?.slice(),
      positions1: this.#positions1?.slice(),
      normals1: this.#normals1?.slice(),
      indices: this.#indices?.slice(),
      mode: this.#mode,
    });
  }

  /**
   * Releases this geometry's CPU-side data (§83). Idempotent.
   *
   * The typed arrays are dropped — `positions` becomes empty, `normals`,
   * `uvs`, `colors`, `joints`, `weights`, and
   * `indices` become `undefined` — so a large mesh's memory is reclaimable the moment
   * its owner is done with it, and the version is bumped so any backend cache
   * keyed on it re-reads (and finds nothing to draw). Nothing throws
   * afterwards: {@link BufferGeometry.disposed} is the flag renderers and the
   * §83 "disposed resource still in use" diagnostic check.
   *
   * Disposing does **not** notify the renderables pointing at this geometry;
   * ownership is explicit and upwards (§83), so whoever created the geometry
   * decides when nothing needs it any more.
   *
   * It **does** remove this geometry and its bytes from the process-wide §83
   * totals (`geometryMemoryBytes`, `liveGeometryCount`), exactly once: the
   * idempotence guard above is what makes a double `dispose()` subtract once
   * rather than twice.
   */
  override dispose(): void {
    if (this.#disposed) {
      return;
    }
    const before = this.byteLength;
    this.#disposed = true;
    this.#positions = EMPTY_POSITIONS;
    this.#normals = undefined;
    this.#uvs = undefined;
    this.#colors = undefined;
    this.#joints = undefined;
    this.#weights = undefined;
    this.#positions1 = undefined;
    this.#normals1 = undefined;
    this.#indices = undefined;
    noteGeometry(-1, -before);
    releaseGeometryDisposable(this);
    this.markDirty();
  }
}
