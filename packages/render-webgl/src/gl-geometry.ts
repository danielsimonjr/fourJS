/**
 * GPU-side geometry for the WebGL 2 backend: one vertex array per
 * `BufferGeometry`, cached and invalidated by version (§53, §61, §64).
 *
 * §53 gives every geometry a stable `id` and a `version` that advances on every
 * mutation the geometry can see, and states the contract this module is the
 * first consumer of: *"Backends cache GPU buffers per geometry. The cache key
 * is `BufferGeometry.version`."* So the cache is keyed by `id` and validated by
 * `version`. A dirty geometry with the same attribute/index presence reuses its
 * VAO and buffer objects, replacing each buffer's data store with `bufferData`.
 * Attribute additions/removals rebuild the record. `markDirty()` still uploads
 * every stream: the version does not say which array changed.
 *
 * ## What one entry holds
 *
 * A vertex array object plus the one to nine buffers it references —
 * positions, the optional normal stream (§68, 2026-08-04), the optional uv and
 * per-vertex colour streams (§53, R-19, 2026-08-07), the optional joint and
 * weight streams (§54, RFC 0003, 2026-08-28), the optional first morph-target
 * position and normal streams (locations 6/7), the optional index
 * buffer — and the
 * three numbers the draw call needs (mode, element count, index type). Binding
 * a VAO restores the whole attribute *and* element-array binding state in one
 * call, so the per-draw cost in `webgl-renderer.ts` is `bindVertexArray` plus
 * `drawElements`/`drawArrays` — nothing else per object.
 *
 * Optional streams are uploaded **iff the geometry carries them**, at their own
 * fixed attribute locations, and every program ignores the slots it does not
 * declare. So a position-only geometry produces exactly the two GL calls it
 * always did, and a geometry that gained uvs costs one more buffer at upload
 * time and nothing per draw.
 *
 * The VAO is program-independent: the position stream is bound to the fixed
 * slot `POSITION_ATTRIBUTE_LOCATION`, which the shader declares with an
 * explicit `layout(location = ...)` (see `gl-program.ts`). A second pipeline
 * added later reuses these vertex arrays unchanged.
 *
 * ## Eviction policy (decision, WP-3.5)
 *
 * Entries are evicted **lazily, on the next acquire for the same geometry id**,
 * and eagerly for the whole cache on {@link GeometryCache.dispose}. There is no
 * background sweep and no finalization hook:
 *
 * - A **version bump** (in-place edit plus `markDirty()`, or an assignment
 *   through a setter) is detected on the next `acquire`. The fixed attribute
 *   layout survives changes to array length, index width, and primitive mode;
 *   only adding/removing an attribute or the index stream requires new handles.
 *   Data is always re-uploaded. Nothing is retained twice.
 * - **`geometry.dispose()`** bumps the version and empties the arrays (§53), so
 *   the next `acquire` deletes the stale GL objects and — finding nothing left
 *   to draw — returns `null` without creating a new entry. A geometry that is
 *   disposed and then *never submitted again* therefore keeps its GL objects
 *   until the renderer is disposed. That is a deliberate, documented leak
 *   window: the alternatives are a `FinalizationRegistry` (non-deterministic
 *   timing, which §33 makes unattractive even outside the simulation) or a
 *   disposal event on `BufferGeometry` (a subscription per geometry per
 *   backend, which §53 explicitly rejected in favour of the version counter).
 *   §83 puts resource ownership on whoever created the geometry; a renderer
 *   that is done with a scene disposes, and the scene's GPU memory goes with
 *   it.
 * - **Context loss** is not eviction: {@link GeometryCache.forget} drops the
 *   records *without* calling any `delete*` entry point, because every handle
 *   is already invalid and the context must not be touched (§61).
 */

import type { RenderItem } from "@fourjs/render";
import { warnDisposedInUse } from "@fourjs/render";

import {
  COLOR_ATTRIBUTE_LOCATION,
  GL,
  JOINTS_ATTRIBUTE_LOCATION,
  NORMAL_ATTRIBUTE_LOCATION,
  NORMAL1_ATTRIBUTE_LOCATION,
  POSITION_ATTRIBUTE_LOCATION,
  POSITION1_ATTRIBUTE_LOCATION,
  UV_ATTRIBUTE_LOCATION,
  WEIGHTS_ATTRIBUTE_LOCATION,
  type WebglContext,
} from "./gl-program.js";
import type { GlBuffer, GlVertexArray } from "./gl-program.js";

/**
 * The geometry type this cache stores, taken from `@fourjs/render`'s render item
 * rather than imported from `@fourjs/geometry`.
 *
 * `@fourjs/render-webgl`'s dependencies are `core`, `math`, and `render` (plan
 * §3.1, frozen). Deriving the type from `RenderItem["geometry"]` gives the full
 * `BufferGeometry` surface — `id`, `version`, `positions`, `indices`, `mode`,
 * `drawCount` — with no new edge in the dependency matrix, and it stays correct
 * by construction: if `RenderItem.geometry` is ever widened, this follows.
 */
export type CacheableGeometry = RenderItem["geometry"];

/** Everything one cached geometry needs at draw time. */
export interface GeometryRecord {
  /** Vertex array holding the attribute and element-array bindings. */
  readonly vertexArray: GlVertexArray;

  /** Buffer backing the position attribute. */
  readonly positionBuffer: GlBuffer;

  /**
   * Buffer backing the optional normal attribute (§53, §68), or `null` for a
   * position-only geometry. Bound at the fixed `NORMAL_ATTRIBUTE_LOCATION`
   * inside the vertex array, so the lit pipeline reads it with no extra
   * per-draw call — and the unlit pipeline, which declares no normal input,
   * ignores it for free.
   */
  readonly normalBuffer: GlBuffer | null;

  /**
   * Buffer backing the optional uv attribute (§53, §55; R-19), or `null` for a
   * geometry with no texture coordinates. Bound at
   * `UV_ATTRIBUTE_LOCATION` inside the vertex array; the unlit and lit
   * pipelines declare the slot and sample it only when their material carries a
   * `map`, and the sprite pipeline — which derives uv from position — ignores
   * it entirely.
   */
  readonly uvBuffer: GlBuffer | null;

  /**
   * Buffer backing the optional per-vertex colour attribute (§53, §60a; R-19),
   * or `null`. Bound at `COLOR_ATTRIBUTE_LOCATION`; consumed only by an unlit
   * draw whose material sets `vertexColors` — which is how §113's debug-draw
   * overlay reaches the screen (R-35).
   */
  readonly colorBuffer: GlBuffer | null;

  /**
   * Buffer backing the optional joint-index attribute (§53, §54; RFC 0003),
   * or `null`. Bound at `JOINTS_ATTRIBUTE_LOCATION` as non-normalized
   * `UNSIGNED_SHORT` — the skinned pipelines declare `in vec4 joints` and
   * index with `int(...)`; every other program ignores the slot.
   */
  readonly jointBuffer: GlBuffer | null;

  /**
   * Buffer backing the optional joint-weight attribute (§53, §54; RFC 0003),
   * or `null`. Bound at `WEIGHTS_ATTRIBUTE_LOCATION`; consumed only by the
   * skinned pipelines.
   */
  readonly weightBuffer: GlBuffer | null;

  /**
   * Buffer backing the optional first morph-target position stream (§54),
   * or `null`. Bound at `POSITION1_ATTRIBUTE_LOCATION`.
   */
  readonly position1Buffer: GlBuffer | null;

  /**
   * Buffer backing the optional first morph-target normal stream (§54),
   * or `null`. Bound at `NORMAL1_ATTRIBUTE_LOCATION`.
   */
  readonly normal1Buffer: GlBuffer | null;

  /** Index buffer, or `null` for a non-indexed geometry. */
  readonly indexBuffer: GlBuffer | null;

  /** `BufferGeometry.version` this record was uploaded from. */
  readonly version: number;

  /** Primitive mode: {@link GL.TRIANGLES} or {@link GL.LINES}. */
  readonly mode: number;

  /** Elements one draw call issues — indices when indexed, vertices otherwise. */
  readonly count: number;

  /**
   * Index element type ({@link GL.UNSIGNED_SHORT} or {@link GL.UNSIGNED_INT}),
   * or `null` when the geometry is not indexed — which is also the flag that
   * selects `drawArrays` over `drawElements`.
   */
  readonly indexType: number | null;
}

/** Fixed optional streams shared by allocation and cleanup. */
const OPTIONAL_ATTRIBUTES = [
  ["normals", "normalBuffer"],
  ["uvs", "uvBuffer"],
  ["colors", "colorBuffer"],
  ["joints", "jointBuffer"],
  ["weights", "weightBuffer"],
  ["positions1", "position1Buffer"],
  ["normals1", "normal1Buffer"],
] as const;

/** Mutable only while a new record's optional buffers are being allocated. */
type AllocatingGeometryRecord = {
  -readonly [Key in keyof GeometryRecord]: GeometryRecord[Key];
};

/** Private cache metadata; callers still receive only a GeometryRecord. */
interface GeometryCacheEntry {
  record: GeometryRecord;
  readonly layout: number;
}

/** Direct reads avoid dynamic-key iteration on every dirty acquisition. */
function attributeMask(geometry: CacheableGeometry): number {
  // Typed arrays are truthy even at length zero. Pack presence, not length.
  return (
    +!!geometry.normals |
    (+!!geometry.uvs << 1) |
    (+!!geometry.colors << 2) |
    (+!!geometry.joints << 3) |
    (+!!geometry.weights << 4) |
    (+!!geometry.positions1 << 5) |
    (+!!geometry.normals1 << 6) |
    (+!!geometry.indices << 7)
  );
}

/** Maps §53's draw mode onto its GL enumerant. */
function glMode(mode: CacheableGeometry["mode"]): number {
  return mode === "lines" ? GL.LINES : GL.TRIANGLES;
}

/**
 * Maps an index array onto its GL element type. `BufferGeometry` accepts
 * `Uint16Array` and `Uint32Array` (§53); absent indices select non-indexed draws.
 * WebGL also supports byte indices, but this geometry contract does not.
 */
function glIndexType(indices: CacheableGeometry["indices"]): number | null {
  return indices === undefined
    ? null
    : indices instanceof Uint16Array
      ? GL.UNSIGNED_SHORT
      : GL.UNSIGNED_INT;
}

/**
 * Per-context store of uploaded geometry (§61, §64 stage 7).
 *
 * One cache belongs to one GL context: the renderer builds it during
 * `initialize` and builds a *new* one on context restore, since every handle
 * the old one held died with the context.
 *
 * ```ts
 * const cache = new GeometryCache(gl);
 * const record = cache.acquire(item.geometry);
 * if (record !== null) {
 *   gl.bindVertexArray(record.vertexArray);
 *   // draw…
 * }
 * ```
 */
export class GeometryCache {
  readonly #gl: WebglContext;

  /** Records by `BufferGeometry.id`; see the module header for eviction. */
  readonly #records = new Map<string, GeometryCacheEntry>();

  #disposed = false;

  constructor(gl: WebglContext) {
    this.#gl = gl;
  }

  /** Number of geometries currently uploaded. Diagnostics and tests (§83). */
  get size(): number {
    return this.#records.size;
  }

  /** Whether {@link GeometryCache.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Returns the vertex array for `geometry`, uploading it on first use and
   * re-uploading it whenever `geometry.version` has advanced. Compatible layouts
   * retain their GL objects; returned metadata belongs to the acquired version.
   *
   * Returns `null` — and creates no entry — when there is nothing to draw
   * (`drawCount === 0`, which includes every disposed geometry), after this
   * cache is disposed, or when GL refuses to allocate an object. **Never throws**:
   * this runs inside `Renderer.render`, and §61 forbids throwing there for a lost context; a
   * failed allocation is the same class of asynchronous, driver-scheduled
   * event, so it skips the object rather than unwinding the frame.
   */
  acquire(geometry: CacheableGeometry): GeometryRecord | null {
    if (this.#disposed) {
      return null;
    }
    const entry = this.#records.get(geometry.id);
    if (entry !== undefined) {
      const existing = entry.record;
      if (existing.version === geometry.version) {
        return existing;
      }
      if (
        geometry.drawCount !== 0 &&
        entry.layout === attributeMask(geometry)
      ) {
        const record = this.#refresh(geometry, existing);
        entry.record = record;
        return record;
      }
      this.#deleteRecord(existing);
      this.#records.delete(geometry.id);
    }

    if (geometry.drawCount === 0) {
      if (geometry.disposed) {
        warnDisposedInUse("geometry", geometry.id);
      }
      return null;
    }

    const record = this.#upload(geometry);
    if (record === null) {
      return null;
    }
    this.#records.set(geometry.id, {
      record,
      layout: attributeMask(geometry),
    });
    return record;
  }

  /**
   * Drops every record **without touching the context** — the context-loss
   * path (§61). The handles are already invalid; calling `deleteBuffer` on them
   * would be a GL call against a lost context for no benefit.
   */
  forget(): void {
    this.#records.clear();
  }

  /**
   * Deletes every vertex array and buffer this cache created (§83). Idempotent.
   *
   * Only valid on a live context — the renderer calls {@link GeometryCache.forget}
   * instead when the context is lost.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const entry of this.#records.values()) {
      this.#deleteRecord(entry.record);
    }
    this.#records.clear();
  }

  /**
   * Uploads `geometry` into a fresh vertex array, or returns `null` if GL would
   * not allocate one.
   *
   * Unbinding order matters and is not incidental: the element-array binding is
   * *part of* vertex-array state, so the vertex array is unbound first and the
   * `ARRAY_BUFFER` binding cleared afterwards. Clearing `ELEMENT_ARRAY_BUFFER`
   * while the vertex array is still bound would erase the index binding that
   * was just recorded.
   */
  #upload(geometry: CacheableGeometry): GeometryRecord | null {
    const gl = this.#gl;
    const vertexArray = gl.createVertexArray();
    if (vertexArray === null) {
      return null;
    }

    // Allocate before binding, in positions → optional attributes → indices
    // order. The partial record owns each successful allocation and can be
    // unwound directly: no temporary buffer list or allocation closures.
    const positionBuffer = gl.createBuffer();
    if (positionBuffer === null) {
      gl.deleteVertexArray(vertexArray);
      return null;
    }

    const indices = geometry.indices;
    const record: AllocatingGeometryRecord = {
      vertexArray,
      positionBuffer,
      normalBuffer: null,
      uvBuffer: null,
      colorBuffer: null,
      jointBuffer: null,
      weightBuffer: null,
      position1Buffer: null,
      normal1Buffer: null,
      indexBuffer: null,
      version: geometry.version,
      mode: glMode(geometry.mode),
      count: geometry.drawCount,
      indexType: glIndexType(indices),
    };
    for (const [attribute, field] of OPTIONAL_ATTRIBUTES) {
      if (geometry[attribute] !== undefined) {
        const buffer = gl.createBuffer();
        if (buffer === null) {
          this.#deleteRecord(record);
          return null;
        }
        record[field] = buffer;
      }
    }
    if (indices !== undefined) {
      record.indexBuffer = gl.createBuffer();
      if (record.indexBuffer === null) {
        this.#deleteRecord(record);
        return null;
      }
    }

    this.#writeGeometry(geometry, record, true);
    return record;
  }

  /**
   * Replaces data stores without rebuilding an unchanged vertex layout.
   *
   * `bufferData` deliberately stays the upload primitive: it accepts resized
   * arrays and lets the driver replace storage still referenced by earlier
   * draws. Reusing a buffer *object* does not require overwriting its in-flight
   * storage with `bufferSubData`. Attribute pointers reference those objects,
   * not a particular store, so no pointer/enable calls need to be repeated.
   *
   * The VAO must be bound for the element-array write, then unbound before
   * clearing ARRAY_BUFFER — exactly the initial upload's state contract.
   */
  #refresh(
    geometry: CacheableGeometry,
    existing: GeometryRecord,
  ): GeometryRecord {
    this.#writeGeometry(geometry, existing, false);
    return {
      ...existing,
      version: geometry.version,
      mode: glMode(geometry.mode),
      count: geometry.drawCount,
      indexType: glIndexType(geometry.indices),
    };
  }

  /**
   * Shared writer, deliberately unrolled: dynamic-key loops cost more for the
   * many small geometries in a 2D scene (see the counting-seam benchmark).
   * Only initial uploads configure attributes; refreshes keep VAO attachments.
   */
  #writeGeometry(
    geometry: CacheableGeometry,
    record: GeometryRecord,
    setup: boolean,
  ): void {
    const gl = this.#gl;
    gl.bindVertexArray(record.vertexArray);
    this.#writeAttribute(
      setup,
      record.positionBuffer,
      geometry.positions,
      POSITION_ATTRIBUTE_LOCATION,
    );
    this.#writeAttribute(
      setup,
      record.normalBuffer,
      geometry.normals,
      NORMAL_ATTRIBUTE_LOCATION,
    );
    this.#writeAttribute(
      setup,
      record.uvBuffer,
      geometry.uvs,
      UV_ATTRIBUTE_LOCATION,
      2,
    );
    this.#writeAttribute(
      setup,
      record.colorBuffer,
      geometry.colors,
      COLOR_ATTRIBUTE_LOCATION,
      4,
    );
    this.#writeAttribute(
      setup,
      record.jointBuffer,
      geometry.joints,
      JOINTS_ATTRIBUTE_LOCATION,
      4,
      GL.UNSIGNED_SHORT,
    );
    this.#writeAttribute(
      setup,
      record.weightBuffer,
      geometry.weights,
      WEIGHTS_ATTRIBUTE_LOCATION,
      4,
    );
    this.#writeAttribute(
      setup,
      record.position1Buffer,
      geometry.positions1,
      POSITION1_ATTRIBUTE_LOCATION,
    );
    this.#writeAttribute(
      setup,
      record.normal1Buffer,
      geometry.normals1,
      NORMAL1_ATTRIBUTE_LOCATION,
    );
    if (geometry.indices !== undefined) {
      gl.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, record.indexBuffer);
      gl.bufferData(GL.ELEMENT_ARRAY_BUFFER, geometry.indices, GL.STATIC_DRAW);
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(GL.ARRAY_BUFFER, null);
  }

  /** Uploads a present stream; configures its VAO slot only on first upload. */
  #writeAttribute(
    setup: boolean,
    buffer: GlBuffer | null,
    data: Float32Array | Uint16Array | undefined,
    location: number,
    components = 3,
    type: number = GL.FLOAT,
  ): void {
    if (data !== undefined) {
      const gl = this.#gl;
      gl.bindBuffer(GL.ARRAY_BUFFER, buffer);
      gl.bufferData(GL.ARRAY_BUFFER, data, GL.STATIC_DRAW);
      if (setup) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, components, type, false, 0, 0);
      }
    }
  }

  /** Deletes one record's GL objects. Live context only. */
  #deleteRecord(record: GeometryRecord): void {
    const gl = this.#gl;
    gl.deleteVertexArray(record.vertexArray);
    gl.deleteBuffer(record.positionBuffer);
    for (const [, field] of OPTIONAL_ATTRIBUTES) {
      const buffer = record[field];
      if (buffer !== null) gl.deleteBuffer(buffer);
    }
    if (record.indexBuffer !== null) gl.deleteBuffer(record.indexBuffer);
  }
}
