/**
 * Debug-draw data providers (§113, plan P10-3) — the diagnostic visualization
 * list, shipped as **data**.
 *
 * §113 asks Phase 10 for "collision visualization; constraint visualization;
 * center-of-mass display; velocity and force vectors; solver statistics". This
 * module produces exactly those, in the only form `@fourjs/diagnostics` is allowed
 * to produce them: a line list of world-space segments in a growable
 * `Float32Array` ({@link DebugDrawBuffer}), filled by small provider functions
 * that read a solver through **duck-typed seams**, plus statistics as plain
 * records. Nothing here draws anything, opens a context, or knows what a
 * renderer is.
 *
 * ## The render-integration verdict (decision, WP-10.3 — reported)
 *
 * The packet asked whether the overlay MVP needs a new render item kind or
 * whether existing unlit geometry honestly serves. Verified against the tree:
 *
 * - `packages/geometry/src/buffer-geometry.ts` — `GeometryDrawMode` is
 *   `"triangles" | "lines"`, and its own comment says the MVP tier "draws filled
 *   shapes and debug/wire lines". `positions` is held **by reference** and
 *   in-place edits plus `markDirty()` are explicitly legal, so a per-frame line
 *   list costs one array write and one version bump — no reallocation.
 * - `packages/render-webgl/src/gl-geometry.ts` — `glMode()` maps `"lines"` to
 *   `GL.LINES` today, so a `"lines"` geometry already reaches the GPU.
 * - `packages/render/src/render-list.ts` — a `Renderable` carrying a `"lines"`
 *   `BufferGeometry` and an `UnlitMaterial` becomes an ordinary `"unlit"` item
 *   with no render-package change at all.
 *
 * So: **no new render item kind is needed, and none is added here.**
 *
 * ## Per-segment colour in one draw (R-35 closed, 2026-08-07)
 *
 * Until 2026-08-07 the verdict above carried a stated cost — **one colour per
 * draw** — because `BufferGeometry` had no colour attribute and `UnlitMaterial`
 * was one flat RGBA. R-19 landed `BufferGeometry.colors` and
 * `UnlitMaterial.vertexColors`, and `@fourjs/render-webgl` uploads the colour
 * stream at a fixed attribute slot, so the whole overlay now draws in **one
 * call at any segment count**.
 *
 * The bridge is {@link debugDrawStreams} + {@link applyDebugDrawStreams}: they
 * de-interleave this buffer's seven-float vertices into the two contiguous
 * streams `BufferGeometry` wants, reusing the arrays whenever the segment count
 * holds. This package still emits **plain `Float32Array`s and never a
 * `BufferGeometry`** — the frozen §3.1 matrix gives `diagnostics` no `geometry`
 * edge — so the two-line assembly happens in the application; see
 * {@link debugDrawStreams} for it.
 *
 * The buffer always stored a colour per vertex, deliberately, so that this
 * upload would repack nothing when it arrived. It did. The older
 * one-draw-per-colour routes still work and are still the right answer when the
 * overlay's categories want separate materials or draw order:
 * {@link DebugDrawBuffer.writePositions} with one buffer per category, or
 * {@link DebugDrawBuffer.writePositionsForColor} to filter a mixed one.
 *
 * ## Buffer layout (decision, WP-10.3)
 *
 * A **line list**: every two vertices are one independent segment, matching
 * `GL.LINES` and `BufferGeometry`'s `"lines"` mode, so a segment can be appended
 * without touching its neighbours (a strip could not). Each vertex is
 * {@link DEBUG_VERTEX_FLOATS} = 7 floats, each segment
 * {@link DEBUG_SEGMENT_FLOATS} = 14:
 *
 * | Offset (floats) | Components | Meaning                                  |
 * | --------------: | ---------: | ---------------------------------------- |
 * | 0               | 3          | endpoint A `x, y, z`, **world space**    |
 * | 3               | 4          | endpoint A colour, straight RGBA         |
 * | 7               | 3          | endpoint B `x, y, z`, world space        |
 * | 10              | 4          | endpoint B colour, straight RGBA         |
 *
 * Both endpoints of a segment carry the same colour today, because every
 * `add*` method takes one colour. Storing it per vertex rather than per segment
 * is deliberate: it is the layout a vertex-coloured upload wants, so the future
 * render item repacks nothing, and gradient segments become possible without a
 * layout change.
 *
 * Positions are **world space** — the seam reads world transforms (§42
 * `"physics"` authority publishes world poses) and a contact point is world
 * space by §29's definition. A node drawing this buffer therefore wants an
 * identity world matrix.
 *
 * ## Allocation (plan D7, §7b)
 *
 * The backing store doubles from `initialCapacity` on overflow and **never
 * shrinks**, including across `clear()`, so a steady-state overlay allocates
 * nothing after the first few frames. The providers hold their scratch
 * `Vector3`/`Quaternion` at module scope and allocate no math objects at all
 * (the tests assert this with `constructionCount()` from `@fourjs/math`). The one
 * honest caveat: iterating a caller-supplied `Iterable` costs whatever iterator
 * that container mints — an `Array` allocates one per `for…of` — which is the
 * caller's choice of container, not this module's.
 *
 * Module-scope scratch means the providers are **not reentrant**: a provider
 * must not be called from inside another provider's callback. They are called
 * from a debug overlay once per frame, and none of them invokes user code.
 *
 * ## Non-finite values are recorded, not rejected (decision, WP-10.3)
 *
 * The `add*` methods validate their *scalar options* (a size or a scale is a
 * programmer's input) but do **not** check the coordinates they store. A NaN
 * pose is precisely the defect §113 exists to capture, and a debug buffer that
 * threw on it would destroy the frame that shows the bug. `BufferGeometry`
 * validates finiteness (§85) when the positions are handed to it, which is the
 * right place for the loud failure — one step later, with the overlay data
 * still in hand.
 *
 * ## The seams (plan §6h/§6i pattern)
 *
 * `@fourjs/diagnostics` may depend on `core`, `math`, and `scene` only; it cannot
 * import `@fourjs/physics`. So, exactly as `recorder.ts` does for `ReplayTarget`
 * and `@fourjs/render`'s `particles.ts` does for `ParticleDrawable`, the shapes
 * this module reads are **declared locally and satisfied structurally**:
 *
 * - {@link DebugBodyAccess} transcribes the five members of `SolverBodyAccess`
 *   this module uses, from `packages/physics/src/body-access.ts`;
 * - {@link DebugJointAccess} transcribes two members of `SolverJointAccess`
 *   from the same file;
 * - {@link DebugContactPoint} and {@link DebugCollisionEventLike} transcribe
 *   `ContactPoint` and the `contacts` field of `CollisionEvent` from
 *   `packages/physics/src/events.ts` (§29).
 *
 * Both are generic in the handle type because §37's handles are *unforgeable*
 * branded interfaces (`packages/physics/src/types.ts`): a test double cannot
 * mint one, so the seams never name a concrete handle. The honest cost is the
 * same one `particles.ts` and `recorder.ts` state: **nothing type-checks the two
 * declarations against each other**; a change to `SolverBodyAccess` fails this
 * package's *tests*, which mirror the members, not its build.
 *
 * ## What the seams cannot answer (staged, 2026-08-02)
 *
 * Two items of §113's list are not obtainable through the seams as they exist,
 * and are staged with a dated note rather than approximated: constraint (joint
 * anchor) visualization and applied force vectors. See
 * {@link DEBUG_DRAW_STAGED} for the per-item reason, what ships instead, and
 * what would unblock each. Centre-of-mass display was staged with them and
 * unstaged 2026-08-04, when `SolverBodyAccess` grew `getBodyCenterOfMass` —
 * it ships as {@link collectCentersOfMass}.
 */

import { Quaternion, Vector3 } from "@fourjs/math";

/** Floats per vertex: `x, y, z, r, g, b, a`. See the module header's table. */
export const DEBUG_VERTEX_FLOATS = 7;

/** Floats per segment: two vertices of {@link DEBUG_VERTEX_FLOATS}. */
export const DEBUG_SEGMENT_FLOATS = DEBUG_VERTEX_FLOATS * 2;

/**
 * Floats a segment occupies in a **positions-only** array — the form
 * `BufferGeometry` takes (`x, y, z` per vertex, two vertices).
 */
export const DEBUG_POSITION_FLOATS_PER_SEGMENT = 6;

/**
 * Floats a segment occupies in a **colors-only** array — the form
 * `BufferGeometry.colors` takes (straight `r, g, b, a` per vertex, two
 * vertices). See {@link debugDrawStreams}.
 */
export const DEBUG_COLOR_FLOATS_PER_SEGMENT = 8;

/** Segments a {@link DebugDrawBuffer} holds before its first growth. */
export const DEFAULT_DEBUG_BUFFER_CAPACITY = 64;

/**
 * Any readable 3-vector — `@fourjs/math`'s `Vector3` satisfies it, and so does a
 * plain `{ x, y, z }`, which is what keeps the providers testable without a
 * solver.
 */
export interface Vector3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Straight (non-premultiplied) RGBA, matching `UnlitMaterial.color`'s
 * convention in `@fourjs/materials`. Components are not clamped or validated:
 * §60a owns colour policy, and this module stores what it is given.
 *
 * Pass a module-level constant rather than a fresh literal per frame if you
 * care about the array allocation — the buffer copies the four numbers out and
 * keeps no reference.
 */
export type DebugColor = readonly [number, number, number, number];

/** Colours the providers use when a call does not name one. */
export const DEBUG_DRAW_DEFAULT_COLORS = {
  /** Linear velocity vectors — yellow. */
  velocity: [1, 1, 0, 1] as DebugColor,
  /** Angular velocity vectors — orange. */
  angularVelocity: [1, 0.5, 0, 1] as DebugColor,
  /** Body transform origins — cyan (see {@link collectBodyOrigins}). */
  origin: [0, 1, 1, 1] as DebugColor,
  /** Centres of mass — white (see {@link collectCentersOfMass}). */
  centerOfMass: [1, 1, 1, 1] as DebugColor,
  /** Contact points — red. */
  contact: [1, 0, 0, 1] as DebugColor,
  /** Contact normals — green. */
  contactNormal: [0, 1, 0, 1] as DebugColor,
  /** Contact normal impulses — magenta. */
  contactImpulse: [1, 0, 1, 1] as DebugColor,
} as const;

/** Rejects a scalar option that is not a finite number. */
function requireFiniteOption(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `Debug draw option "${name}" must be finite; got ${String(value)}.`,
    );
  }
  return value;
}

/** Rejects a size/extent option that is not finite and positive. */
function requirePositiveOption(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `Debug draw option "${name}" must be a finite positive number; got ` +
        `${String(value)}.`,
    );
  }
  return value;
}

/** Options for {@link DebugDrawBuffer}. */
export interface DebugDrawBufferOptions {
  /**
   * Segments the buffer can hold before its first growth. Defaults to
   * {@link DEFAULT_DEBUG_BUFFER_CAPACITY}. Must be a positive integer.
   */
  initialCapacity?: number;
}

/**
 * A growable world-space **line list** with a colour per vertex — the transport
 * every provider in this module writes into, and the only drawing primitive
 * §113's visualizations need (a point is drawn as a cross of lines; see
 * {@link DebugDrawBuffer.addPoint}).
 *
 * ```ts
 * const buffer = new DebugDrawBuffer();
 * buffer.clear();                                    // once per frame
 * collectContactPoints(events, buffer);
 * buffer.writePositions(geometry.positions);         // feed a "lines" geometry
 * ```
 *
 * See the module header for the float layout, the growth policy, and why
 * non-finite coordinates are stored rather than rejected.
 */
export class DebugDrawBuffer {
  #data: Float32Array;

  #lineCount = 0;

  #capacity: number;

  constructor(options: DebugDrawBufferOptions = {}) {
    const capacity = options.initialCapacity ?? DEFAULT_DEBUG_BUFFER_CAPACITY;
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new RangeError(
        `DebugDrawBuffer initialCapacity must be a positive integer; got ` +
          `${String(capacity)}.`,
      );
    }
    this.#capacity = capacity;
    this.#data = new Float32Array(capacity * DEBUG_SEGMENT_FLOATS);
  }

  /** Segments written since the last {@link DebugDrawBuffer.clear}. */
  get lineCount(): number {
    return this.#lineCount;
  }

  /**
   * Segments the current backing store holds. Doubles on overflow and never
   * shrinks — including across {@link DebugDrawBuffer.clear} — so a steady-state
   * overlay stops allocating.
   */
  get capacity(): number {
    return this.#capacity;
  }

  /**
   * Live floats: `lineCount * `{@link DEBUG_SEGMENT_FLOATS}. Everything in
   * {@link DebugDrawBuffer.data} beyond this is stale and must not be read.
   */
  get floatLength(): number {
    return this.#lineCount * DEBUG_SEGMENT_FLOATS;
  }

  /**
   * Floats {@link DebugDrawBuffer.writePositions} will write:
   * `lineCount * `{@link DEBUG_POSITION_FLOATS_PER_SEGMENT}.
   */
  get positionFloatLength(): number {
    return this.#lineCount * DEBUG_POSITION_FLOATS_PER_SEGMENT;
  }

  /**
   * Floats {@link DebugDrawBuffer.writeColors} will write:
   * `lineCount * `{@link DEBUG_COLOR_FLOATS_PER_SEGMENT}.
   */
  get colorFloatLength(): number {
    return this.#lineCount * DEBUG_COLOR_FLOATS_PER_SEGMENT;
  }

  /**
   * The whole capacity-sized backing store, by reference — the **zero-alloc**
   * read path, to be used together with {@link DebugDrawBuffer.floatLength}.
   * The reference changes when the buffer grows, so re-read it rather than
   * caching it across frames.
   */
  get data(): Float32Array {
    return this.#data;
  }

  /**
   * A view of exactly the live floats.
   *
   * Convenience for tests and one-shot inspection: `subarray` copies no data but
   * does allocate a view object, so a per-frame path should use
   * {@link DebugDrawBuffer.data} with {@link DebugDrawBuffer.floatLength}
   * instead.
   */
  segments(): Float32Array {
    return this.#data.subarray(0, this.floatLength);
  }

  /**
   * Drops every segment. Keeps the backing store (see
   * {@link DebugDrawBuffer.capacity}) and does not zero it: stale floats past
   * {@link DebugDrawBuffer.floatLength} are unreachable through every accessor
   * here.
   */
  clear(): void {
    this.#lineCount = 0;
  }

  /**
   * Appends one segment from `from` to `to`.
   *
   * Coordinates are stored verbatim, including non-finite ones — see the module
   * header.
   */
  addLine(from: Vector3Like, to: Vector3Like, color: DebugColor): void {
    this.addLineValues(
      from.x,
      from.y,
      from.z,
      to.x,
      to.y,
      to.z,
      color[0],
      color[1],
      color[2],
      color[3],
    );
  }

  /**
   * Appends one segment from raw components — the form the providers use, since
   * it lets them offset an endpoint without a scratch vector.
   */
  addLineValues(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    red: number,
    green: number,
    blue: number,
    alpha: number,
  ): void {
    const at = this.#reserveOne();
    const data = this.#data;
    data[at] = x0;
    data[at + 1] = y0;
    data[at + 2] = z0;
    data[at + 3] = red;
    data[at + 4] = green;
    data[at + 5] = blue;
    data[at + 6] = alpha;
    data[at + 7] = x1;
    data[at + 8] = y1;
    data[at + 9] = z1;
    data[at + 10] = red;
    data[at + 11] = green;
    data[at + 12] = blue;
    data[at + 13] = alpha;
  }

  /**
   * Appends `origin → origin + vector * scale` as one segment — the shape
   * §113's "velocity and force vectors" take.
   *
   * **No arrowhead.** A head is three more segments and a screen-space size to
   * pick, and the direction is already readable from the segment's endpoints;
   * the tip is the second vertex. Heads can be added later without a layout
   * change.
   *
   * @throws RangeError if `scale` is not finite.
   */
  addVector(
    origin: Vector3Like,
    vector: Vector3Like,
    scale: number,
    color: DebugColor,
  ): void {
    requireFiniteOption("scale", scale);
    this.addLineValues(
      origin.x,
      origin.y,
      origin.z,
      origin.x + vector.x * scale,
      origin.y + vector.y * scale,
      origin.z + vector.z * scale,
      color[0],
      color[1],
      color[2],
      color[3],
    );
  }

  /**
   * Appends an axis-aligned cross centred on `center`, arm half-length `size`:
   * **three** segments, appended in **X, Y, Z order** — `(±size, 0, 0)`,
   * `(0, ±size, 0)`, `(0, 0, ±size)`.
   *
   * In a 2D scene (§7a: Y-up, everything at `z = 0`) the Z arm is a single pixel
   * seen down the camera axis. It is drawn anyway rather than branching on a
   * dimension this package cannot see; it costs one segment and it is what makes
   * the same cross usable in 3D.
   *
   * @throws RangeError if `size` is not finite and positive.
   */
  addCross(center: Vector3Like, size: number, color: DebugColor): void {
    requirePositiveOption("size", size);
    const red = color[0];
    const green = color[1];
    const blue = color[2];
    const alpha = color[3];
    const { x, y, z } = center;
    this.addLineValues(x - size, y, z, x + size, y, z, red, green, blue, alpha);
    this.addLineValues(x, y - size, z, x, y + size, z, red, green, blue, alpha);
    this.addLineValues(x, y, z - size, x, y, z + size, red, green, blue, alpha);
  }

  /**
   * Draws a point as a cross — an alias of {@link DebugDrawBuffer.addCross},
   * spelled the way a caller thinks of it.
   *
   * A line list has no point primitive (`GL.POINTS` is not in
   * `GeometryDrawMode`, which is `"triangles" | "lines"`), so **every** point in
   * §113's list — a contact, a body origin — is three segments of `2 * size`
   * length. `size` is a **world-space half-extent**, not a pixel radius: this
   * package cannot see a camera, so a screen-constant size is not expressible
   * here and is the caller's to choose per scale.
   */
  addPoint(point: Vector3Like, size: number, color: DebugColor): void {
    this.addCross(point, size, color);
  }

  /**
   * Copies the live segments into `out` as positions only — 6 floats per
   * segment, the layout `BufferGeometry`'s `positions` wants with
   * `mode: "lines"`.
   *
   * Allocates nothing. Returns the number of floats written, which is
   * {@link DebugDrawBuffer.positionFloatLength}. Floats in `out` past that are
   * left untouched — a geometry sized for the worst case keeps its stale tail,
   * so either size `out` exactly per frame or accept that the extra segments
   * still draw. (Collapsing the tail to a degenerate point is a caller policy,
   * not a buffer one.)
   *
   * @throws RangeError if `out` cannot hold the segments at `offset`.
   */
  writePositions(out: Float32Array, offset = 0): number {
    const needed = this.positionFloatLength;
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new RangeError(
        `writePositions offset must be a non-negative integer; got ` +
          `${String(offset)}.`,
      );
    }
    if (out.length - offset < needed) {
      throw new RangeError(
        `writePositions needs ${String(needed)} floats at offset ` +
          `${String(offset)}, but the destination holds ${String(out.length)}.`,
      );
    }
    const data = this.#data;
    let write = offset;
    for (let line = 0; line < this.#lineCount; line += 1) {
      const read = line * DEBUG_SEGMENT_FLOATS;
      out[write] = data[read];
      out[write + 1] = data[read + 1];
      out[write + 2] = data[read + 2];
      out[write + 3] = data[read + DEBUG_VERTEX_FLOATS];
      out[write + 4] = data[read + DEBUG_VERTEX_FLOATS + 1];
      out[write + 5] = data[read + DEBUG_VERTEX_FLOATS + 2];
      write += DEBUG_POSITION_FLOATS_PER_SEGMENT;
    }
    return needed;
  }

  /**
   * Copies the live segments' **colours** into `out` — 8 floats per segment
   * (straight RGBA per vertex, two vertices), the layout
   * `BufferGeometry.colors` wants alongside the positions
   * {@link DebugDrawBuffer.writePositions} produces.
   *
   * This is the other half of the split: the buffer interleaves position and
   * colour per vertex (module header), a GL vertex attribute wants each stream
   * contiguous, and these two methods are the de-interleave. No expansion
   * happens — the colour is already stored per vertex, so a future gradient
   * segment (two different endpoint colours) comes out correct without a
   * change here.
   *
   * Allocates nothing. Returns the number of floats written, which is
   * {@link DebugDrawBuffer.colorFloatLength}. Floats in `out` past that are
   * left untouched, exactly as {@link DebugDrawBuffer.writePositions} leaves
   * them.
   *
   * @throws RangeError if `out` cannot hold the segments at `offset`.
   */
  writeColors(out: Float32Array, offset = 0): number {
    const needed = this.colorFloatLength;
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new RangeError(
        `writeColors offset must be a non-negative integer; got ` +
          `${String(offset)}.`,
      );
    }
    if (out.length - offset < needed) {
      throw new RangeError(
        `writeColors needs ${String(needed)} floats at offset ` +
          `${String(offset)}, but the destination holds ${String(out.length)}.`,
      );
    }
    const data = this.#data;
    let write = offset;
    for (let line = 0; line < this.#lineCount; line += 1) {
      const read = line * DEBUG_SEGMENT_FLOATS;
      out[write] = data[read + 3];
      out[write + 1] = data[read + 4];
      out[write + 2] = data[read + 5];
      out[write + 3] = data[read + 6];
      out[write + 4] = data[read + DEBUG_VERTEX_FLOATS + 3];
      out[write + 5] = data[read + DEBUG_VERTEX_FLOATS + 4];
      out[write + 6] = data[read + DEBUG_VERTEX_FLOATS + 5];
      out[write + 7] = data[read + DEBUG_VERTEX_FLOATS + 6];
      write += DEBUG_COLOR_FLOATS_PER_SEGMENT;
    }
    return needed;
  }

  /**
   * {@link DebugDrawBuffer.writePositions} restricted to the segments whose
   * first vertex carries exactly `color` — how one mixed buffer feeds several
   * single-colour `UnlitMaterial` draws while the render path has no
   * vertex-colour attribute (module header).
   *
   * The comparison is **exact float equality on all four components**, which is
   * the right test precisely because colours here are constants copied out of a
   * literal or {@link DEBUG_DRAW_DEFAULT_COLORS} — nothing computes a colour, so
   * nothing needs a tolerance.
   *
   * Allocates nothing. Returns the number of floats written.
   *
   * @throws RangeError if `out` is too small for the matching segments.
   */
  writePositionsForColor(
    out: Float32Array,
    color: DebugColor,
    offset = 0,
  ): number {
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new RangeError(
        `writePositionsForColor offset must be a non-negative integer; got ` +
          `${String(offset)}.`,
      );
    }
    const data = this.#data;
    let matches = 0;
    for (let line = 0; line < this.#lineCount; line += 1) {
      const read = line * DEBUG_SEGMENT_FLOATS;
      if (
        data[read + 3] === color[0] &&
        data[read + 4] === color[1] &&
        data[read + 5] === color[2] &&
        data[read + 6] === color[3]
      ) {
        matches += 1;
      }
    }
    const needed = matches * DEBUG_POSITION_FLOATS_PER_SEGMENT;
    if (out.length - offset < needed) {
      throw new RangeError(
        `writePositionsForColor needs ${String(needed)} floats at offset ` +
          `${String(offset)}, but the destination holds ${String(out.length)}.`,
      );
    }
    let write = offset;
    for (let line = 0; line < this.#lineCount; line += 1) {
      const read = line * DEBUG_SEGMENT_FLOATS;
      if (
        data[read + 3] !== color[0] ||
        data[read + 4] !== color[1] ||
        data[read + 5] !== color[2] ||
        data[read + 6] !== color[3]
      ) {
        continue;
      }
      out[write] = data[read];
      out[write + 1] = data[read + 1];
      out[write + 2] = data[read + 2];
      out[write + 3] = data[read + DEBUG_VERTEX_FLOATS];
      out[write + 4] = data[read + DEBUG_VERTEX_FLOATS + 1];
      out[write + 5] = data[read + DEBUG_VERTEX_FLOATS + 2];
      write += DEBUG_POSITION_FLOATS_PER_SEGMENT;
    }
    return needed;
  }

  /**
   * Reserves one segment and returns the float offset it starts at, growing the
   * backing store by **doubling** if it is full (module header).
   */
  #reserveOne(): number {
    if (this.#lineCount === this.#capacity) {
      const capacity = this.#capacity * 2;
      const grown = new Float32Array(capacity * DEBUG_SEGMENT_FLOATS);
      grown.set(this.#data);
      this.#data = grown;
      this.#capacity = capacity;
    }
    const at = this.#lineCount * DEBUG_SEGMENT_FLOATS;
    this.#lineCount += 1;
    return at;
  }
}

/**
 * A {@link DebugDrawBuffer}'s contents de-interleaved into the two vertex
 * streams a per-segment-coloured line draw needs — the R-35 bridge, shipped as
 * **plain `Float32Array`s** (see {@link debugDrawStreams} for why they are not
 * a `BufferGeometry`).
 *
 * Both arrays are sized **exactly** for the live segments, which is what
 * `BufferGeometry` requires: it validates that `colors.length` is four floats
 * per vertex of `positions`, so a slack tail is not merely wasteful here, it is
 * rejected (§85).
 */
export interface DebugDrawStreams {
  /**
   * `x, y, z` per vertex, two vertices per segment —
   * `segmentCount * `{@link DEBUG_POSITION_FLOATS_PER_SEGMENT} floats, world
   * space. Feeds `BufferGeometry.positions` with `mode: "lines"`.
   */
  positions: Float32Array;

  /**
   * Straight RGBA per vertex —
   * `segmentCount * `{@link DEBUG_COLOR_FLOATS_PER_SEGMENT} floats,
   * index-aligned with {@link DebugDrawStreams.positions}. Feeds
   * `BufferGeometry.colors`, which an `UnlitMaterial` reads when its
   * `vertexColors` flag is on.
   */
  colors: Float32Array;

  /** Segments packed — the source buffer's `lineCount` at the last update. */
  segmentCount: number;

  /** `segmentCount * 2` — the vertex count both arrays are aligned to. */
  vertexCount: number;

  /**
   * Whether the last {@link debugDrawStreams} call **replaced** the two arrays
   * (because the segment count changed) rather than rewriting them in place.
   *
   * `true` means a geometry pointing at the old arrays must be re-pointed at
   * the new ones; `false` means an in-place rewrite happened and a
   * `markDirty()` is all the geometry needs.
   * {@link applyDebugDrawStreams} does exactly that, so a caller only reads
   * this flag when it drives its own sink.
   */
  resized: boolean;
}

/**
 * Packs `buffer`'s live segments into the position + colour streams a
 * per-segment-coloured `GL.LINES` draw wants — the function that finally makes
 * §84/§113's debug overlay **drawable in one call** (R-35).
 *
 * ## Why this returns arrays and not a `BufferGeometry` (decision, R-35)
 *
 * The §3.1 dependency matrix gives `@fourjs/diagnostics` exactly three edges —
 * `core`, `math`, `scene` — and `geometry` is not among them; the matrix is
 * frozen, so this package cannot import `BufferGeometry` and must not pretend
 * to. What it can do is emit the two arrays in the exact shape `BufferGeometry`
 * accepts **verbatim**, which is the same duck-typed-contract move
 * `ParticleDrawable` and `ReplayTarget` make. The assembly is two lines in the
 * application, which owns both packages:
 *
 * ```ts
 * // once
 * const streams = debugDrawStreams(buffer);
 * const geometry = new BufferGeometry({ ...streams, mode: "lines" });
 * const node = new Renderable(geometry, new UnlitMaterial({ vertexColors: true }));
 *
 * // per frame
 * buffer.clear();
 * collectContactPoints(world.queuedEvents, buffer);
 * debugDrawStreams(buffer, streams);        // pack (no alloc at a stable count)
 * applyDebugDrawStreams(streams, geometry); // re-point or markDirty
 * ```
 *
 * The `{ ...streams, mode: "lines" }` spread works because
 * {@link DebugDrawStreams}'s first two fields are named exactly as
 * `BufferGeometryOptions`' `positions` and `colors`; the extra count fields are
 * ignored by the constructor. That naming is deliberate and load-bearing.
 *
 * ## Reuse (§7b out-parameter discipline)
 *
 * Pass the record back as `out` and the arrays are **rewritten in place**
 * whenever the segment count is unchanged — the steady state of an overlay
 * whose provider set is fixed, where this allocates nothing at all. When the
 * count moves, the two arrays are replaced (they must be: `BufferGeometry`
 * rejects a slack tail) and {@link DebugDrawStreams.resized} says so.
 *
 * Growing-and-never-shrinking, {@link DebugDrawBuffer}'s own policy, is
 * deliberately **not** copied here: an oversized array is exactly what the
 * geometry refuses, and re-pointing a geometry costs a full §85 validation scan
 * of both streams anyway, which dwarfs the allocation it would save.
 *
 * An empty buffer yields two zero-length arrays — a legal, empty `"lines"`
 * geometry that draws nothing, so an overlay with nothing to say needs no
 * special case.
 *
 * @param buffer the source; only its live segments are read
 * @param out a record from a previous call, to reuse
 * @returns `out` when given, otherwise a fresh record
 */
export function debugDrawStreams(
  buffer: DebugDrawBuffer,
  out?: DebugDrawStreams,
): DebugDrawStreams {
  const segmentCount = buffer.lineCount;
  const positionFloats = buffer.positionFloatLength;
  const colorFloats = buffer.colorFloatLength;
  let positions = out?.positions;
  let colors = out?.colors;
  let resized = false;
  if (positions === undefined || positions.length !== positionFloats) {
    positions = new Float32Array(positionFloats);
    resized = true;
  }
  if (colors === undefined || colors.length !== colorFloats) {
    colors = new Float32Array(colorFloats);
    resized = true;
  }
  buffer.writePositions(positions);
  buffer.writeColors(colors);
  if (out === undefined) {
    return {
      positions,
      colors,
      segmentCount,
      vertexCount: segmentCount * 2,
      resized,
    };
  }
  out.positions = positions;
  out.colors = colors;
  out.segmentCount = segmentCount;
  out.vertexCount = segmentCount * 2;
  out.resized = resized;
  return out;
}

/**
 * The part of `BufferGeometry` {@link applyDebugDrawStreams} touches, declared
 * locally because `@fourjs/diagnostics` has no `geometry` edge in the frozen §3.1
 * matrix — the same structural-seam rule as {@link DebugBodyAccess}, and the
 * same honest cost: **nothing type-checks this declaration against
 * `BufferGeometry`**; a change to those three members fails this package's
 * *tests*, which mirror the semantics, not its build.
 *
 * A `BufferGeometry` satisfies it as it stands (`positions` and `colors` are
 * accessor pairs, `markDirty` bumps the version). So does any hand-rolled sink
 * with the same three members.
 */
export interface DebugGeometrySink {
  /** Vertex positions; assigning validates and bumps the version (§85). */
  positions: Float32Array;

  /**
   * Per-vertex straight RGBA, or `undefined` for none. Assigning validates it
   * against the *current* positions, which is why
   * {@link applyDebugDrawStreams} drops it before replacing them.
   */
  colors: Float32Array | undefined;

  /** Announces an in-place write into either array. */
  markDirty(): void;
}

/**
 * Points `geometry` at `streams`, or just marks it dirty when it already holds
 * those exact arrays — the second of the two lines in
 * {@link debugDrawStreams}' per-frame example.
 *
 * The three-assignment order is not stylistic. A geometry validates a new
 * `positions` against the colours it currently holds, so assigning a
 * *shorter* positions array while the old colours are still attached throws;
 * dropping the colours first is the only order that works for every count
 * change, including the first call.
 *
 * When the arrays are unchanged (a stable segment count — see
 * {@link DebugDrawStreams.resized}) this is a single version bump: no
 * validation scan, no upload sizing change, just the dirty flag every backend
 * keys its buffer on.
 */
export function applyDebugDrawStreams(
  streams: DebugDrawStreams,
  geometry: DebugGeometrySink,
): void {
  if (
    !streams.resized &&
    geometry.positions === streams.positions &&
    geometry.colors === streams.colors
  ) {
    geometry.markDirty();
    return;
  }
  geometry.colors = undefined;
  geometry.positions = streams.positions;
  geometry.colors = streams.colors;
}

/**
 * The members of `SolverBodyAccess` this module reads, declared locally because
 * `@fourjs/diagnostics` cannot import `@fourjs/physics` (module header, plan §6h).
 * Transcribed from `packages/physics/src/body-access.ts`; an adapter satisfies
 * it structurally, and `THandle` is inferred from the caller because §37's
 * handles are unforgeable brands.
 *
 * Everything `SolverBodyAccess` promises holds here unchanged: reads take `out`
 * parameters and allocate nothing, `forEachBody` and `forEachCollider` visit in
 * **creation order** (ascending monotonic id, §33), and a `"2d"` world reports
 * `z = 0` with rotation about +Z.
 *
 * Bodies and colliders take **separate** handle parameters because §37 gives
 * them separate brands (`PhysicsBodyHandle` vs `PhysicsColliderHandle`, which
 * are mutually unassignable); collapsing them into one would make this
 * interface unsatisfiable by a real adapter. Nothing here dereferences a
 * collider handle — colliders are only counted — so `TColliderHandle` is
 * inferred and otherwise ignored.
 */
export interface DebugBodyAccess<THandle = unknown, TColliderHandle = unknown> {
  /** World transform of one body (§42 `"physics"` authority's read). */
  getBodyTransform(
    handle: THandle,
    outPosition: Vector3,
    outRotation: Quaternion,
  ): void;

  /** Linear (m/s) and angular (rad/s) velocity (§23). */
  getBodyVelocities(
    handle: THandle,
    outLinear: Vector3,
    outAngular: Vector3,
  ): void;

  /** §32 sleep state as the solver holds it after the step. */
  isBodySleeping(handle: THandle): boolean;

  /** Visits every live body in creation order (§33). */
  forEachBody(visit: (handle: THandle, id: number) => void): void;

  /** Visits every live collider in creation order (§33). */
  forEachCollider(visit: (handle: TColliderHandle, id: number) => void): void;

  /**
   * Live contact points in the narrow phase after the last step (§84). Optional:
   * adapters that cannot walk manifolds omit this and {@link SolverStatistics.contactCount}
   * stays `NaN`.
   */
  countContacts?(): number;
}

/**
 * The members of `SolverJointAccess` this module reads — transcribed from
 * `packages/physics/src/body-access.ts`, same seam rules as
 * {@link DebugBodyAccess}.
 *
 * Deliberately tiny: joint *anchors* are not on that interface at all, so joint
 * geometry cannot be drawn through the seam (see {@link DEBUG_DRAW_STAGED}).
 * What is readable is the joint set and whether the adapter reports reactions.
 */
export interface DebugJointAccess<THandle = unknown> {
  /**
   * Whether `getJointReaction` reports anything real. Declared by the adapter,
   * not discovered; both Rapier adapters declare `false` (Rapier 0.19.3's JS
   * bindings expose no joint reaction).
   */
  readonly reportsJointReactions: boolean;

  /** Visits every live joint in creation order (§33). */
  forEachJoint(visit: (handle: THandle, id: number) => void): void;
}

/**
 * One contact point, transcribed from `ContactPoint` in
 * `packages/physics/src/events.ts` (§29). Vectors are world space; `normal`
 * points **from A towards B** and is unit length.
 *
 * `separation` is not read by anything here — a signed distance has no obvious
 * line to draw — but it is part of the shape and is transcribed so the mirror is
 * complete.
 */
export interface DebugContactPoint {
  readonly pointOnA: Vector3Like;
  readonly pointOnB: Vector3Like;
  readonly normal: Vector3Like;
  readonly separation: number;
  /** Normal impulse magnitude over the step, in newton-seconds. */
  readonly impulse: number;
}

/**
 * The part of §29's `CollisionEvent` this module draws: the discriminant and the
 * manifold. Transcribed from `packages/physics/src/events.ts`.
 *
 * The body/collider references and `relativeVelocity`/`totalImpulse` are
 * omitted, not forgotten — a reference is opaque here, and `totalImpulse` is a
 * per-pair sum with no point to anchor it to, while `contacts[i].impulse` has
 * one (see {@link collectContactImpulses}).
 */
export interface DebugCollisionEventLike {
  readonly type: string;
  readonly contacts: readonly DebugContactPoint[];
}

/**
 * What the providers accept: anything with a `type`, which covers the whole
 * `PhysicsEvent` union (`CollisionEvent`, `TriggerEvent`, `SleepEvent`,
 * `JointBreakEvent`) so `world.queuedEvents` can be passed straight in. Entries
 * without a contact manifold are skipped.
 */
export interface DebugPhysicsEventLike {
  readonly type: string;

  /**
   * The manifold, when the event has one. Optional rather than absent so that a
   * caller can hand over a heterogeneous array without casting, and so a
   * `CollisionEvent` and a `TriggerEvent` are both assignable; the providers
   * still check it at runtime ({@link DebugCollisionEventLike} is the narrowed
   * form).
   */
  readonly contacts?: readonly DebugContactPoint[];
}

/** Narrows an event to one carrying a manifold, structurally. */
function hasContacts(
  event: DebugPhysicsEventLike,
): event is DebugCollisionEventLike {
  return Array.isArray((event as Partial<DebugCollisionEventLike>).contacts);
}

/**
 * Scratch for the providers. Module scope, allocated once — see the module
 * header on non-reentrancy.
 */
const scratchPosition = new Vector3();
const scratchRotation = new Quaternion();
const scratchLinear = new Vector3();
const scratchAngular = new Vector3();

/** Options for {@link collectBodyVelocities}. */
export interface CollectBodyVelocitiesOptions {
  /**
   * Seconds of travel the drawn vector represents: the segment runs from the
   * body origin to `origin + velocity * scale`, so `scale` is a **time** and the
   * tip is where the body would be after that long at its current velocity.
   * Defaults to `1` (§7a: seconds everywhere).
   */
  scale?: number;

  /** Linear velocity colour. Defaults to {@link DEBUG_DRAW_DEFAULT_COLORS}. */
  color?: DebugColor;

  /**
   * Also draw the angular velocity vector (rad/s), from the same origin, with
   * the same `scale`. Defaults to `false` because in a `"2d"` world the angular
   * velocity lies on ±Z (§21) and is therefore invisible to a Z-facing camera —
   * useful in 3D, misleading as a default in 2D.
   */
  includeAngular?: boolean;

  /** Angular velocity colour. Defaults to {@link DEBUG_DRAW_DEFAULT_COLORS}. */
  angularColor?: DebugColor;

  /**
   * Skip bodies the solver reports asleep (§32). Defaults to `false`: a
   * sleeping body's velocity is zero, so its segment is a degenerate point and
   * costs one segment; skipping is offered for large worlds where that adds up.
   */
  skipSleeping?: boolean;
}

/**
 * §113 "velocity vectors": one segment per body from its transform origin along
 * its linear velocity, optionally a second along its angular velocity.
 *
 * Reads `forEachBody` → `getBodyTransform` + `getBodyVelocities` (+
 * `isBodySleeping` when `skipSleeping` is set), so the segments come out in
 * ascending body id — the §33 order, which makes an overlay's line list
 * reproducible run to run.
 *
 * Returns the number of segments appended.
 */
export function collectBodyVelocities<THandle, TColliderHandle>(
  access: DebugBodyAccess<THandle, TColliderHandle>,
  buffer: DebugDrawBuffer,
  options: CollectBodyVelocitiesOptions = {},
): number {
  const scale = requireFiniteOption("scale", options.scale ?? 1);
  const color = options.color ?? DEBUG_DRAW_DEFAULT_COLORS.velocity;
  const angularColor =
    options.angularColor ?? DEBUG_DRAW_DEFAULT_COLORS.angularVelocity;
  const includeAngular = options.includeAngular ?? false;
  const skipSleeping = options.skipSleeping ?? false;
  let added = 0;
  access.forEachBody((handle) => {
    if (skipSleeping && access.isBodySleeping(handle)) {
      return;
    }
    access.getBodyTransform(handle, scratchPosition, scratchRotation);
    access.getBodyVelocities(handle, scratchLinear, scratchAngular);
    buffer.addVector(scratchPosition, scratchLinear, scale, color);
    added += 1;
    if (includeAngular) {
      buffer.addVector(scratchPosition, scratchAngular, scale, angularColor);
      added += 1;
    }
  });
  return added;
}

/** Options for {@link collectBodyOrigins}. */
export interface CollectBodyOriginsOptions {
  /** Cross arm half-length in world units. Defaults to `0.1`. */
  size?: number;

  /** Colour. Defaults to {@link DEBUG_DRAW_DEFAULT_COLORS}. */
  color?: DebugColor;

  /** Skip bodies the solver reports asleep (§32). Defaults to `false`. */
  skipSleeping?: boolean;

  /** Colour for sleeping bodies, when they are not skipped. Defaults to `color`. */
  sleepingColor?: DebugColor;
}

/**
 * A cross at every body's **transform origin** — three segments per body, in
 * ascending body id.
 *
 * ## This is not the centre of mass
 *
 * §113's "center-of-mass display" is {@link collectCentersOfMass}; the two
 * markers coincide only for a body whose colliders are symmetric about its
 * origin. (From 2026-08-02 to 2026-08-04 the seam had no centre-of-mass
 * accessor and this origin cross was the recorded honest substitute; the
 * `getBodyCenterOfMass` member unstaged the real thing.) Draw both to see
 * exactly how far a compound body's mass sits from its authored origin.
 *
 * Returns the number of segments appended (`3` per drawn body).
 */
export function collectBodyOrigins<THandle, TColliderHandle>(
  access: DebugBodyAccess<THandle, TColliderHandle>,
  buffer: DebugDrawBuffer,
  options: CollectBodyOriginsOptions = {},
): number {
  const size = requirePositiveOption("size", options.size ?? 0.1);
  const color = options.color ?? DEBUG_DRAW_DEFAULT_COLORS.origin;
  const sleepingColor = options.sleepingColor ?? color;
  const skipSleeping = options.skipSleeping ?? false;
  const needsSleepState = skipSleeping || options.sleepingColor !== undefined;
  let added = 0;
  access.forEachBody((handle) => {
    const sleeping = needsSleepState ? access.isBodySleeping(handle) : false;
    if (skipSleeping && sleeping) {
      return;
    }
    access.getBodyTransform(handle, scratchPosition, scratchRotation);
    buffer.addCross(scratchPosition, size, sleeping ? sleepingColor : color);
    added += 3;
  });
  return added;
}

/**
 * {@link DebugBodyAccess} plus the centre-of-mass read —
 * `SolverBodyAccess.getBodyCenterOfMass`, transcribed 2026-08-04 (the member
 * whose absence staged §113's centre-of-mass display from 2026-08-02, see the
 * module header). Kept as an extension rather than a sixth member on
 * {@link DebugBodyAccess} so every existing five-member source keeps
 * satisfying the base seam unchanged; only {@link collectCentersOfMass}
 * requires this one.
 */
export interface DebugCenterOfMassAccess<
  THandle = unknown,
  TColliderHandle = unknown,
> extends DebugBodyAccess<THandle, TColliderHandle> {
  /** World-space centre of mass (§25), as the solver resolved it. */
  getBodyCenterOfMass(handle: THandle, out: Vector3): void;
}

/** Options for {@link collectCentersOfMass}. */
export interface CollectCentersOfMassOptions {
  /** Cross arm half-length in world units. Defaults to `0.1`. */
  size?: number;

  /** Colour. Defaults to {@link DEBUG_DRAW_DEFAULT_COLORS}. */
  color?: DebugColor;

  /** Skip bodies the solver reports asleep (§32). Defaults to `false`. */
  skipSleeping?: boolean;

  /** Colour for sleeping bodies, when they are not skipped. Defaults to `color`. */
  sleepingColor?: DebugColor;
}

/**
 * §113's centre-of-mass display: a cross at every body's **world-space centre
 * of mass** — three segments per body, in ascending body id.
 *
 * This is the marker {@link collectBodyOrigins} deliberately is not: the
 * solver's resolved centre of mass, collider offsets, densities and authored
 * overrides included, read through
 * `SolverBodyAccess.getBodyCenterOfMass` (the member that unstaged this
 * provider, 2026-08-04). For an off-centre or compound body the two crosses
 * visibly separate, which is precisely the situation the marker exists for.
 *
 * Returns the number of segments appended (`3` per drawn body).
 */
export function collectCentersOfMass<THandle, TColliderHandle>(
  access: DebugCenterOfMassAccess<THandle, TColliderHandle>,
  buffer: DebugDrawBuffer,
  options: CollectCentersOfMassOptions = {},
): number {
  const size = requirePositiveOption("size", options.size ?? 0.1);
  const color = options.color ?? DEBUG_DRAW_DEFAULT_COLORS.centerOfMass;
  const sleepingColor = options.sleepingColor ?? color;
  const skipSleeping = options.skipSleeping ?? false;
  const needsSleepState = skipSleeping || options.sleepingColor !== undefined;
  let added = 0;
  access.forEachBody((handle) => {
    const sleeping = needsSleepState ? access.isBodySleeping(handle) : false;
    if (skipSleeping && sleeping) {
      return;
    }
    access.getBodyCenterOfMass(handle, scratchPosition);
    buffer.addCross(scratchPosition, size, sleeping ? sleepingColor : color);
    added += 3;
  });
  return added;
}

/** Options for {@link collectContactPoints}. */
export interface CollectContactPointsOptions {
  /** Cross arm half-length for each contact point. Defaults to `0.05`. */
  size?: number;

  /** Contact point colour. Defaults to {@link DEBUG_DRAW_DEFAULT_COLORS}. */
  color?: DebugColor;

  /**
   * Length of the drawn normal, in world units (the normal is unit length, so
   * this is the whole segment length). Defaults to `0.25`; **`0` draws no
   * normals**.
   */
  normalScale?: number;

  /** Normal colour. Defaults to {@link DEBUG_DRAW_DEFAULT_COLORS}. */
  normalColor?: DebugColor;

  /**
   * Also mark `pointOnB`. Defaults to `false`: the two points coincide except
   * while the surfaces interpenetrate or a contact is speculative (§31), so the
   * second cross is usually a duplicate — worth turning on precisely when
   * penetration is what you are looking at.
   */
  includePointOnB?: boolean;
}

/**
 * §113 "collision visualization": a cross at every contact point, plus the
 * contact normal as a segment from `pointOnA`.
 *
 * `events` is anything iterable of §29-shaped events — `world.queuedEvents`
 * passes directly. Entries without a `contacts` array (trigger, sleep, and
 * joint-break events) are **skipped**, and `"collisionend"` carries an empty
 * manifold by §29's definition, so it contributes nothing without being a
 * special case. Order follows the adapter's `drainEvents` order, which §33
 * requires to be deterministic.
 *
 * Contacts are a **per-step** quantity: the events must be collected from the
 * step being visualized, and the buffer cleared per frame, or the overlay shows
 * history.
 *
 * Returns the number of segments appended.
 */
export function collectContactPoints(
  events: Iterable<DebugPhysicsEventLike>,
  buffer: DebugDrawBuffer,
  options: CollectContactPointsOptions = {},
): number {
  const size = requirePositiveOption("size", options.size ?? 0.05);
  const color = options.color ?? DEBUG_DRAW_DEFAULT_COLORS.contact;
  const normalScale = requireFiniteOption(
    "normalScale",
    options.normalScale ?? 0.25,
  );
  const normalColor =
    options.normalColor ?? DEBUG_DRAW_DEFAULT_COLORS.contactNormal;
  const includePointOnB = options.includePointOnB ?? false;
  let added = 0;
  for (const event of events) {
    if (!hasContacts(event)) {
      continue;
    }
    for (const contact of event.contacts) {
      buffer.addCross(contact.pointOnA, size, color);
      added += 3;
      if (includePointOnB) {
        buffer.addCross(contact.pointOnB, size, color);
        added += 3;
      }
      if (normalScale !== 0) {
        buffer.addVector(
          contact.pointOnA,
          contact.normal,
          normalScale,
          normalColor,
        );
        added += 1;
      }
    }
  }
  return added;
}

/** Options for {@link collectContactImpulses}. */
export interface CollectContactImpulsesOptions {
  /**
   * World units drawn per newton-second of impulse. Defaults to `1`; a real
   * overlay picks it from the scene's mass scale. Impulses are per fixed step,
   * so this length is not comparable across different fixed deltas.
   */
  scale?: number;

  /** Colour. Defaults to {@link DEBUG_DRAW_DEFAULT_COLORS}. */
  color?: DebugColor;

  /**
   * Skip contacts whose impulse is exactly zero — speculative and sensor
   * contacts (§29, §31), which would otherwise each cost a degenerate segment.
   * Defaults to `true`.
   */
  skipZero?: boolean;
}

/**
 * The honest half of §113's "force vectors": one segment per contact, from
 * `pointOnA` along the contact normal, scaled by that contact's **normal
 * impulse** (newton-seconds, §29 `ContactPoint.impulse`).
 *
 * ## Why impulses and not forces (staged, 2026-08-02)
 *
 * Applied forces are not readable. `SolverBodyAccess` has `applyForce`,
 * `applyForceAtPoint`, `applyTorque`, `applyImpulse`, `applyImpulseAtPoint`,
 * `applyAngularImpulse`, and `resetForces` — seven **writes** and no getter; the
 * seam is write-only for the force channel, and §26's command buffers live in
 * `@fourjs/physics`, which this package cannot import. What *is* readable is the
 * impulse the solver actually applied at each contact, which is the force
 * quantity a collision overlay wants anyway. Divide by the fixed delta for
 * newtons — the same conversion `PhysicsWorld` does for §28 break thresholds —
 * or leave `scale` in impulse units and read it as relative.
 *
 * See {@link DEBUG_DRAW_STAGED} for applied-force vectors.
 *
 * Returns the number of segments appended.
 */
export function collectContactImpulses(
  events: Iterable<DebugPhysicsEventLike>,
  buffer: DebugDrawBuffer,
  options: CollectContactImpulsesOptions = {},
): number {
  const scale = requireFiniteOption("scale", options.scale ?? 1);
  const color = options.color ?? DEBUG_DRAW_DEFAULT_COLORS.contactImpulse;
  const skipZero = options.skipZero ?? true;
  let added = 0;
  for (const event of events) {
    if (!hasContacts(event)) {
      continue;
    }
    for (const contact of event.contacts) {
      if (skipZero && contact.impulse === 0) {
        continue;
      }
      buffer.addVector(
        contact.pointOnA,
        contact.normal,
        contact.impulse * scale,
        color,
      );
      added += 1;
    }
  }
  return added;
}

/**
 * §113 "solver statistics", as far as the body seam honestly reaches.
 *
 * Every field is counted from `forEachBody` / `forEachCollider` /
 * `isBodySleeping`. Step timings, constraint counts, and iteration counts are
 * **not** here: `PhysicsSolverAdapter` reports none of them, and timing a step
 * would need a clock, which §33 forbids in the simulation path.
 */
export interface SolverStatistics {
  /** Live bodies. */
  bodyCount: number;

  /** Live bodies the solver reports asleep (§32). */
  sleepingCount: number;

  /** `bodyCount - sleepingCount` — the bodies actually being integrated. */
  awakeCount: number;

  /** Live colliders (§24). */
  colliderCount: number;

  /**
   * Highest monotonic body id visited, or `-1` when there are no bodies (never
   * a legal id). Since ids are monotonic and never reused, comparing this with
   * `bodyCount` shows how many bodies have been destroyed over the session.
   */
  maxBodyId: number;

  /**
   * Live contact points summed across narrow-phase manifolds (§84). `NaN` when
   * {@link DebugBodyAccess.countContacts} is absent on the adapter.
   */
  contactCount: number;
}

/**
 * `solverStatistics` **moved to `stats.ts`** on 2026-08-08 (A-6). It is
 * re-exported from the package under its own name, so nothing outside changed.
 *
 * The reason is a measurement, not tidiness: this module allocates four
 * module-level scratch math objects and freezes
 * {@link DEBUG_DRAW_STAGED}, and a bundler must keep all of it because those
 * are calls. Naming *one* function from this file therefore cost **939 B gzip**
 * in every bundle (measured on `examples/ui-demo`) — which is what a frame loop
 * had to pay to report §84's `activeBodies`, whether or not it drew a single
 * debug line. The counter's producer belongs with the counter's record;
 * {@link SolverStatistics} and {@link DebugBodyAccess} stay here, because they
 * are this module's seam and types cost nothing.
 */

/**
 * The joint half of §113's solver statistics — everything the joint seam
 * exposes without asking for a reaction it may not report.
 */
export interface SolverJointStatistics {
  /** Live joints (§28). */
  jointCount: number;

  /**
   * The adapter's own `reportsJointReactions` declaration. `false` means §28
   * break thresholds cannot be enforced on this adapter (both Rapier adapters,
   * as of Rapier 0.19.3) — worth surfacing in an overlay, since it explains why
   * a breakable joint was refused.
   */
  reportsJointReactions: boolean;
}

/**
 * Counts live joints and reports the reaction capability.
 *
 * This is **all** the joint seam gives a visualizer: `SolverJointAccess` is
 * `reportsJointReactions`, `getJointReaction`, `setJointLimits`,
 * `setJointMotor`, `setJointCollisionEnabled` (PH-22f, 2026-08-08),
 * `setJointAnchors` (PH-22f, 2026-09-06), `getJointId`, `forEachJoint` —
 * writers for anchors, but no *read* of them, and no connected bodies or
 * joint type. Constraint *geometry* is therefore staged; see
 * {@link DEBUG_DRAW_STAGED}.
 *
 * `out` follows the same convention as
 * {@link @fourjs/diagnostics!solverStatistics | solverStatistics}.
 */
export function solverJointStatistics<THandle>(
  access: DebugJointAccess<THandle>,
  out?: SolverJointStatistics,
): SolverJointStatistics {
  const stats: SolverJointStatistics = out ?? {
    jointCount: 0,
    reportsJointReactions: false,
  };
  stats.jointCount = 0;
  stats.reportsJointReactions = access.reportsJointReactions;
  access.forEachJoint(() => {
    stats.jointCount += 1;
  });
  return stats;
}

/** One §113 visualization that is **not** shipped, and why. */
export interface StagedVisualization {
  /** Stable key for the staged item. */
  readonly id: string;

  /** The §113 component name this corresponds to. */
  readonly specItem: string;

  /** Why it cannot be produced honestly today, with the file that was checked. */
  readonly reason: string;

  /** What ships instead, or `undefined` when nothing does. */
  readonly shippedInstead: string | undefined;

  /** The concrete change that would unblock it. */
  readonly unblockedBy: string;

  /** ISO date the staging decision was recorded (plan §1: dated notes). */
  readonly staged: string;
}

/**
 * §113 visualizations this packet deliberately did **not** implement, each with
 * the reason, the honest substitute, and the change that would unblock it.
 *
 * Exported as data, not left in prose, so that an overlay can list what it
 * cannot show and a later packet can delete entries as it lands them. The
 * entries are asserted by `tests/debug-draw.test.ts`.
 *
 * Deleted so far: `"per-segment-colored-draw"` (staged 2026-08-02, **landed
 * 2026-08-07** by R-19's colour attribute plus {@link debugDrawStreams} — see
 * the module header).
 */
export const DEBUG_DRAW_STAGED: readonly StagedVisualization[] = Object.freeze([
  Object.freeze({
    id: "joint-anchors",
    specItem: "constraint visualization (§113)",
    reason:
      "SolverJointAccess (packages/physics/src/body-access.ts) is " +
      "reportsJointReactions, getJointReaction, setJointLimits, " +
      "setJointMotor, setJointCollisionEnabled, setJointAnchors, " +
      "getJointId, forEachJoint (setJointAnchors landed 2026-09-06, " +
      "PH-22f). A joint's anchors can be written through the seam but " +
      "are not readable from it, and its connected bodies and type are " +
      "held by the physics package's Joint descriptors, which the diagnostics package " +
      "may not import — so there is no point in space to draw. " +
      "getJointReaction is additionally unusable on both Rapier adapters, " +
      "which declare reportsJointReactions false (Rapier 0.19.3 exposes no " +
      "joint reaction to JS).",
    shippedInstead:
      "solverJointStatistics — live joint count and the reaction capability",
    unblockedBy:
      "either anchor accessors on SolverJointAccess " +
      "(getJointAnchors(handle, outLocalA, outLocalB) plus the connected body " +
      "handles), or a debug-draw provider inside the physics package that reads its " +
      "own Joint registry and writes into a DebugDrawBuffer-shaped sink.",
    staged: "2026-08-02",
  }),
  Object.freeze({
    id: "applied-force-vectors",
    specItem: "velocity and force vectors (§113) — the force half",
    reason:
      "The force channel of SolverBodyAccess is write-only: applyForce, " +
      "applyForceAtPoint, applyTorque, applyImpulse, applyImpulseAtPoint, " +
      "applyAngularImpulse, resetForces — seven writes, no getter. §26's " +
      "per-step command buffers live in the physics package, which this package " +
      "cannot import.",
    shippedInstead:
      "collectContactImpulses — per-contact normal impulses from §29 events, " +
      "which is the force quantity a collision overlay wants; velocity " +
      "vectors ship in full via collectBodyVelocities.",
    unblockedBy:
      "a read of the accumulated per-step force/torque, either on " +
      "SolverBodyAccess or exposed by PhysicsWorld's §26 command buffers " +
      "through a diagnostics-facing interface.",
    staged: "2026-08-02",
  }),
]);
