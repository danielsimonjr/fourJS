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
  morphNormalLocation,
  morphPositionLocation,
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

  /**
   * Buffers for morph targets 2..4 (`extraMorphTargets`), flattened
   * `[p2, n2, p3, n3, p4, n4]`; `null` where a stream is absent. Empty for
   * geometries without extra targets. Bound at locations 10..15 (spec 1.19+).
   * Geometries carrying extras never join the dynamic ring (they refresh via
   * `bufferData`).
   */
  readonly extraMorphBuffers: readonly (GlBuffer | null)[];

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

/** `GL_DYNAMIC_DRAW` — the hint ring buffers upload with. */
const DYNAMIC_DRAW = 0x88e8;

/** VBOs per stream once a geometry is promoted to the dynamic ring (§65). */
export const GEOMETRY_RING_SLOTS = 3;

/** Refreshes after which a geometry counts as per-frame dynamic (§65). */
export const GEOMETRY_RING_PROMOTE_AFTER = 2;

/**
 * Streams in ring order: position first, then {@link OPTIONAL_ATTRIBUTES}.
 * `[geometry key, record field, attribute location, components, GL type]`.
 */
const RING_STREAMS = [
  ["positions", "positionBuffer", POSITION_ATTRIBUTE_LOCATION, 3, GL.FLOAT],
  ["normals", "normalBuffer", NORMAL_ATTRIBUTE_LOCATION, 3, GL.FLOAT],
  ["uvs", "uvBuffer", UV_ATTRIBUTE_LOCATION, 2, GL.FLOAT],
  ["colors", "colorBuffer", COLOR_ATTRIBUTE_LOCATION, 4, GL.FLOAT],
  ["joints", "jointBuffer", JOINTS_ATTRIBUTE_LOCATION, 4, GL.UNSIGNED_SHORT],
  ["weights", "weightBuffer", WEIGHTS_ATTRIBUTE_LOCATION, 4, GL.FLOAT],
  ["positions1", "position1Buffer", POSITION1_ATTRIBUTE_LOCATION, 3, GL.FLOAT],
  ["normals1", "normal1Buffer", NORMAL1_ATTRIBUTE_LOCATION, 3, GL.FLOAT],
] as const;

/** The `bufferSubData` entry point, optional on structural test contexts. */
interface SubDataContext {
  bufferSubData?(target: number, offset: number, data: ArrayBufferView): void;
}

/**
 * Per-geometry ring of VBOs per stream (§65). Slot `cursor` is written on each
 * refresh; with `GEOMETRY_RING_SLOTS` slots the one written was last drawn that
 * many frames ago, so `bufferSubData` into it never waits on in-flight work.
 */
interface GeometryRing {
  /** `slots[stream][slot]`; `null` rows for absent streams. */
  readonly slots: (GlBuffer[] | null)[];
  /** `capacity[stream][slot]` in bytes; `-1` = never sized (orphan first). */
  readonly capacity: number[][];
  cursor: number;
}

/** Private cache metadata; callers still receive only a GeometryRecord. */
interface GeometryCacheEntry {
  record: GeometryRecord;
  readonly layout: number;
  /** Version bumps seen; promotes the entry at {@link GEOMETRY_RING_PROMOTE_AFTER}. */
  refreshes: number;
  ring: GeometryRing | null;
}

/** Presence bits (8..13) of the six extra-morph streams; 0 when none. */
function extraMorphMask(geometry: CacheableGeometry): number {
  const extra = geometry.extraMorphTargets;
  if (extra === undefined) {
    return 0;
  }
  let mask = 0;
  for (let j = 0; j < extra.length; j += 1) {
    mask |= 1 << (8 + 2 * j);
    if (extra[j].normals !== undefined) {
      mask |= 1 << (9 + 2 * j);
    }
  }
  return mask;
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
    (+!!geometry.indices << 7) |
    extraMorphMask(geometry)
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
        entry.refreshes += 1;
        if (
          entry.ring === null &&
          entry.refreshes >= GEOMETRY_RING_PROMOTE_AFTER
        ) {
          entry.ring = this.#promote(geometry, existing);
        }
        const record =
          entry.ring === null
            ? this.#refresh(geometry, existing)
            : this.#refreshRing(geometry, existing, entry.ring);
        entry.record = record;
        return record;
      }
      this.#deleteEntry(entry);
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
      refreshes: 0,
      ring: null,
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
      this.#deleteEntry(entry);
    }
    this.#records.clear();
  }

  /**
   * Bytes held by dynamic rings (§65), all slots: the memory the ring costs on
   * top of the single-buffer path. Slots never yet sized count zero.
   */
  get ringBytes(): number {
    let total = 0;
    for (const entry of this.#records.values()) {
      if (entry.ring === null) continue;
      for (const row of entry.ring.capacity) {
        for (const bytes of row) total += bytes > 0 ? bytes : 0;
      }
    }
    return total;
  }

  /** Whether `id` has been promoted to the dynamic ring. Diagnostics/tests. */
  isRinged(id: string): boolean {
    return this.#records.get(id)?.ring != null;
  }

  /** Deletes an entry's GL objects, ring included. */
  #deleteEntry(entry: GeometryCacheEntry): void {
    const ring = entry.ring;
    if (ring === null) {
      this.#deleteRecord(entry.record);
      return;
    }
    // The record's live buffers are ring members; delete the ring once.
    const gl = this.#gl;
    gl.deleteVertexArray(entry.record.vertexArray);
    for (const row of ring.slots) {
      if (row === null) continue;
      for (const buffer of row) gl.deleteBuffer(buffer);
    }
    if (entry.record.indexBuffer !== null) {
      gl.deleteBuffer(entry.record.indexBuffer);
    }
  }

  /**
   * Builds the ring for a geometry that keeps changing: the record's current
   * buffer becomes slot 0 and the other slots are created once. Returns `null`
   * (staying on the `bufferData` path) when the context cannot `bufferSubData`
   * or refuses a buffer.
   */
  #promote(
    geometry: CacheableGeometry,
    record: GeometryRecord,
  ): GeometryRing | null {
    const gl = this.#gl;
    if (
      typeof (gl as SubDataContext).bufferSubData !== "function" ||
      geometry.extraMorphTargets !== undefined
    ) {
      return null;
    }
    const created: GlBuffer[] = [];
    const slots: (GlBuffer[] | null)[] = [];
    const capacity: number[][] = [];
    for (const [key, field] of RING_STREAMS) {
      const current = record[field];
      if (current === null || geometry[key] === undefined) {
        slots.push(null);
        capacity.push([]);
        continue;
      }
      const row: GlBuffer[] = [current];
      for (let slot = 1; slot < GEOMETRY_RING_SLOTS; slot += 1) {
        const buffer = gl.createBuffer();
        if (buffer === null) {
          for (const made of created) gl.deleteBuffer(made);
          return null;
        }
        created.push(buffer);
        row.push(buffer);
      }
      slots.push(row);
      capacity.push(new Array<number>(GEOMETRY_RING_SLOTS).fill(-1));
    }
    return { slots, capacity, cursor: 0 };
  }

  /**
   * Writes the next ring slot of every present stream and repoints the VAO at
   * it. `bufferSubData` when the slot already has the right size (no driver
   * allocation, no sync: that slot was last drawn `GEOMETRY_RING_SLOTS` frames
   * ago); `bufferData` (an orphan) when the size changed. Indices stay on the
   * `bufferData` path: they change rarely and are VAO state.
   */
  #refreshRing(
    geometry: CacheableGeometry,
    existing: GeometryRecord,
    ring: GeometryRing,
  ): GeometryRecord {
    const gl = this.#gl;
    const sub = gl as unknown as Required<SubDataContext>;
    ring.cursor = (ring.cursor + 1) % GEOMETRY_RING_SLOTS;
    // Mutate the cached record in place (§7b: no per-refresh allocation).
    const record: AllocatingGeometryRecord = existing;
    gl.bindVertexArray(existing.vertexArray);
    for (let stream = 0; stream < RING_STREAMS.length; stream += 1) {
      const row = ring.slots[stream];
      if (row === null) continue;
      const [key, field, location, components, type] = RING_STREAMS[stream];
      const data = geometry[key];
      const buffer = row[ring.cursor];
      gl.bindBuffer(GL.ARRAY_BUFFER, buffer);
      const sizes = ring.capacity[stream];
      if (data !== undefined) {
        if (sizes[ring.cursor] === data.byteLength) {
          sub.bufferSubData(GL.ARRAY_BUFFER, 0, data);
        } else {
          gl.bufferData(GL.ARRAY_BUFFER, data, DYNAMIC_DRAW);
          sizes[ring.cursor] = data.byteLength;
        }
      }
      gl.vertexAttribPointer(location, components, type, false, 0, 0);
      record[field] = buffer;
    }
    if (geometry.indices !== undefined) {
      gl.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, existing.indexBuffer);
      gl.bufferData(GL.ELEMENT_ARRAY_BUFFER, geometry.indices, GL.STATIC_DRAW);
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(GL.ARRAY_BUFFER, null);
    record.version = geometry.version;
    record.mode = glMode(geometry.mode);
    record.count = geometry.drawCount;
    record.indexType = glIndexType(geometry.indices);
    return record;
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
      extraMorphBuffers: [],
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
    const extra = geometry.extraMorphTargets;
    if (extra !== undefined) {
      const made: (GlBuffer | null)[] = [];
      record.extraMorphBuffers = made;
      for (const target of extra) {
        for (const data of [target.positions, target.normals]) {
          const buffer = data === undefined ? null : gl.createBuffer();
          if (data !== undefined && buffer === null) {
            this.#deleteRecord(record);
            return null;
          }
          made.push(buffer);
        }
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
    const extra = geometry.extraMorphTargets;
    if (extra !== undefined) {
      for (let j = 0; j < extra.length; j += 1) {
        this.#writeAttribute(
          setup,
          record.extraMorphBuffers[2 * j],
          extra[j].positions,
          morphPositionLocation(j + 2),
        );
        this.#writeAttribute(
          setup,
          record.extraMorphBuffers[2 * j + 1],
          extra[j].normals,
          morphNormalLocation(j + 2),
        );
      }
    }
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
    for (const buffer of record.extraMorphBuffers) {
      if (buffer !== null) gl.deleteBuffer(buffer);
    }
    if (record.indexBuffer !== null) gl.deleteBuffer(record.indexBuffer);
  }
}
