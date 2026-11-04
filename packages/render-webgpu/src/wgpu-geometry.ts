/**
 * Per-device store of uploaded geometry (§61, §64 stage 7) — the WebGPU twin of
 * `gl-geometry.ts`'s `GeometryCache`.
 *
 * The pattern is §61's recorded design and is not re-argued here: `Texture` and
 * `BufferGeometry` are **CPU-side descriptors carrying an id and a version**,
 * GPU residency is a backend-owned cache keyed by that id, and a device loss is
 * handled by dropping the cache. That design is the reason a second backend is
 * cheap, and this class is the smallest possible demonstration of it.
 *
 * ## What differs from the GL twin, and what does not
 *
 * *Does not*: the id/version contract, the eviction rule, the refusal to throw,
 * the fixed allocation order.
 *
 * *Does*: there is **no vertex array object**. WebGL 2 records attribute
 * bindings into a VAO so a draw is one `bindVertexArray`; WebGPU records them
 * into the *pipeline* (`wgpu-pipeline-cache.ts`) and binds raw buffers per
 * draw. So a record here is buffers and counts, and the attribute layout it
 * would have carried lives in the pipeline descriptor instead. That is the
 * structural difference between the two APIs, and it is why this file is half
 * the length of the one it ports.
 *
 * Uploads use `queue.writeBuffer`, which copies immediately from the caller's
 * typed array — so a geometry mutated after the call is not read back, and the
 * `version` bump is what re-uploads it.
 *
 * This cache uploads **positions, optional normals, optional uvs, optional
 * colours, optional joints/weights and optional indices**: exactly the streams
 * this package's pipelines draw. Uvs joined in WP-R1.2, with the textured
 * variant that reads them. Normals joined in WP-R1.5 with the lit and
 * standard pipelines — and joined **per acquisition, not per geometry**: the
 * caller states whether the draw at hand shades (`acquire`'s second
 * parameter), and the stream uploads on the first acquisition that says so.
 * Joints and weights joined with RFC 0003's skinned colour pair, on the
 * same per-acquisition terms (`acquire`'s third parameter): a skinned draw
 * asks, an unlit acquire of the same geometry does not, and a skinless
 * scene records the byte-identical upload sequence it always did. The rule
 * stands — a stream is uploaded when a pipeline can read it, never before —
 * and it is applied per *draw kind* rather than per package on purpose: a
 * normal-carrying geometry drawn only unlit (`planeGeometry` under an
 * `UnlitMaterial`, every §55 sprite quad) would otherwise upload a buffer
 * nothing ever binds, and every landed pre-WP-R1.5 transcript would move.
 * (The GL cache uploads normals and joints unconditionally because its VAO
 * records all streams at once; here a record is loose buffers, so the honest
 * unit of need is the draw.)
 */

import type { RenderItem } from "@fourjs/render";
import { warnDisposedInUse } from "@fourjs/render";

import {
  GPU_BUFFER_USAGE,
  type GpuBuffer,
  type GpuDevice,
} from "./webgpu-device.js";
import { WgpuStagingRing } from "./wgpu-staging.js";

/** What this cache needs of a geometry: exactly `RenderItem["geometry"]`. */
export type CacheableGeometry = RenderItem["geometry"];

/** Everything one cached geometry needs at draw time. */
export interface WgpuGeometryRecord {
  /** Buffer backing the position attribute (slot 0). */
  readonly positionBuffer: GpuBuffer;
  /**
   * Buffer backing the optional per-vertex normal attribute (§53, §68), or
   * `null` — for a geometry that carries none, **and** for one whose normals
   * have not been asked for yet (see `acquire`'s `normals` parameter): the
   * shaded draw paths read this member to pick the variant, so `null` means
   * "shade without normals" in both cases, which is exactly GL's default-
   * attribute behaviour for the first and the pre-upload state for the second.
   *
   * The one **mutable** member: an upgrade writes the buffer into the live
   * record rather than re-uploading four streams that have not changed.
   */
  normalBuffer: GpuBuffer | null;
  /** Buffer backing the optional per-vertex colour attribute, or `null`. */
  readonly colorBuffer: GpuBuffer | null;
  /**
   * Buffer backing the optional per-vertex uv attribute (§53, §77), or `null`.
   *
   * No slot number here, and none on `colorBuffer` any more: a slot index is
   * *positional* in the variant's vertex layout (`wgpu-unlit.ts`), so a record
   * cannot name one — a coloured, textured draw binds uvs to slot 2 and an
   * uncoloured, textured one binds them to slot 1.
   */
  readonly uvBuffer: GpuBuffer | null;
  /**
   * Buffer backing the optional per-vertex joint-index attribute (§54,
   * RFC 0003: four `uint16` influences, shader location 4), or `null` —
   * for a geometry that carries none, **and** for one whose joints have
   * not been asked for yet (`acquire`'s `skinning` parameter). Mutable
   * for the same upgrade `normalBuffer` uses: a record first acquired
   * unskinned meets its first skinned draw and uploads one stream.
   */
  jointBuffer: GpuBuffer | null;
  /**
   * Buffer backing the optional per-vertex influence-weight attribute
   * (§54: four `f32` weights, shader location 5), or `null`. Paired with
   * {@link WgpuGeometryRecord.jointBuffer}; the two upgrade together.
   */
  weightBuffer: GpuBuffer | null;
  /**
   * Buffer backing the first morph target's positions (`positions1`, shader
   * location 6), or `null` — absent, or not asked for (`acquire`'s `morph`
   * parameter). Mutable for the upgrade the other optional streams use.
   */
  position1Buffer: GpuBuffer | null;
  /**
   * Buffer backing the first morph target's normals (`normals1`, shader
   * location 7), or `null`. Uploaded only for a morph acquisition that also
   * shades (`normals`), since only the lit family reads it.
   */
  normal1Buffer: GpuBuffer | null;
  /**
   * Buffers for morph targets 2..4, flattened `[p2, n2, p3, n3, p4, n4]` and
   * filled lazily like the other optional streams (a slot is `null` until a
   * morph draw asks; normals only for shading draws). Locations 10..15.
   * The array is shared between a record and its in-place-rewrite copies.
   */
  readonly extraMorphBuffers: (GpuBuffer | null)[];
  /** Index buffer, or `null` for a non-indexed geometry. */
  readonly indexBuffer: GpuBuffer | null;
  /** `"uint16"` or `"uint32"`, or `null` when there are no indices. */
  readonly indexFormat: "uint16" | "uint32" | null;
  /** `BufferGeometry.version` this record was uploaded from. */
  readonly version: number;
  /** Vertices or indices to draw (§53's `drawCount`). */
  readonly count: number;
  /** WebGPU topology for §53's draw mode. */
  readonly topology: "triangle-list" | "line-list";
}

/**
 * Rounds a byte length up to a multiple of four.
 *
 * `createBuffer` requires a size that `writeBuffer` can fill, and
 * `writeBuffer`'s size must be a multiple of 4. A `Uint16Array` of odd length
 * — a line-list index buffer with an odd index count — is the case that hits
 * this, and padding it is correct: the pad bytes sit past `count` and are never
 * indexed.
 */
function alignedSize(byteLength: number): number {
  return Math.ceil(byteLength / 4) * 4;
}

/**
 * Per-device store of uploaded geometry, keyed by `BufferGeometry.id`.
 *
 * ```ts
 * const record = geometries.acquire(item.geometry);
 * if (record !== null) {
 *   pass.setVertexBuffer(0, record.positionBuffer);
 *   pass.draw(record.count);
 * }
 * ```
 */
export class WgpuGeometryCache {
  readonly #device: GpuDevice;

  readonly #records = new Map<string, WgpuGeometryRecord>();

  #disposed = false;

  /** §65 staging ring for in-place rewrites of dynamic geometry. */
  readonly #staging: WgpuStagingRing;

  /** Aligned byte size each owned buffer was created with. */
  readonly #sizes = new WeakMap<GpuBuffer, number>();

  constructor(device: GpuDevice) {
    this.#device = device;
    this.#staging = new WgpuStagingRing(device);
  }

  /** Staging-ring bytes held on top of the geometry buffers (§65 accounting). */
  get stagingBytes(): number {
    return this.#staging.bytes;
  }

  /** Staging buffers created so far; constant once warm. */
  get stagingAllocations(): number {
    return this.#staging.allocations;
  }

  /** Number of geometries currently uploaded. Diagnostics and tests (§83). */
  get size(): number {
    return this.#records.size;
  }

  /** Whether {@link WgpuGeometryCache.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Returns the buffers for `geometry`, uploading them on first use and
   * re-uploading whenever `geometry.version` has advanced.
   *
   * `normals` says whether the draw at hand shades (WP-R1.5): `true` uploads
   * the geometry's normal stream — with the initial upload, or as a one-buffer
   * upgrade of a record first acquired by an unshaded draw — and `false` (the
   * default, and every pre-WP-R1.5 call site verbatim) never touches it, so a
   * scene with no lit materials records the byte-identical upload sequence it
   * always did. `skinning` is the same flag for §54's joints and weights
   * (RFC 0003): `true` uploads them on a skinned colour draw, `false` (the
   * default, every pre-skinning call site verbatim) never touches them, so a
   * skinless scene — and an unregistered skinned skip, which never asks —
   * records the byte-identical upload sequence it always did. See the module
   * header for why the flags are per acquisition.
   *
   * Returns `null` — and creates no entry — when there is nothing to draw
   * (`drawCount === 0`, which includes every disposed geometry) or once the
   * cache is disposed. **Never throws**: this runs inside `Renderer.render`,
   * and §61 forbids throwing there.
   */
  acquire(
    geometry: CacheableGeometry,
    normals = false,
    skinning = false,
    morph = false,
  ): WgpuGeometryRecord | null {
    if (this.#disposed) {
      return null;
    }
    const existing = this.#records.get(geometry.id);
    if (existing !== undefined) {
      if (existing.version === geometry.version) {
        if (
          normals &&
          existing.normalBuffer === null &&
          geometry.normals !== undefined
        ) {
          // The upgrade path: a record first acquired by an unshaded draw
          // meets its first lit one. One buffer uploads; the other four are
          // current and stay where they are.
          existing.normalBuffer = this.#uploadBuffer(
            geometry.normals,
            GPU_BUFFER_USAGE.VERTEX,
            `fourJS:normals:${geometry.id}`,
          );
        }
        if (skinning) {
          this.#upgradeSkinning(existing, geometry);
        }
        if (morph) {
          this.#upgradeMorph(existing, geometry, normals);
        }
        return existing;
      }
      if (
        geometry.drawCount !== 0 &&
        this.#rewriteInPlace(existing, geometry)
      ) {
        const updated: WgpuGeometryRecord = {
          ...existing,
          version: geometry.version,
          count: geometry.drawCount,
          topology: geometry.mode === "lines" ? "line-list" : "triangle-list",
        };
        this.#records.set(geometry.id, updated);
        return updated;
      }
      this.#destroyRecord(existing);
      this.#records.delete(geometry.id);
    }

    if (geometry.drawCount === 0) {
      if (geometry.disposed) {
        warnDisposedInUse("geometry", geometry.id);
      }
      return null;
    }

    const record = this.#upload(geometry, normals, skinning, morph);
    this.#records.set(geometry.id, record);
    return record;
  }

  /**
   * Drops every record **without destroying anything** — the device-loss path
   * (§61). The allocations belong to a device that no longer exists; calling
   * `destroy()` on them would be a call against a lost device for no benefit.
   */
  forget(): void {
    this.#records.clear();
  }

  /** Destroys every allocation and marks the cache disposed (§83). Idempotent. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const record of this.#records.values()) {
      this.#destroyRecord(record);
    }
    this.#records.clear();
    this.#staging.dispose();
  }

  /**
   * Rewrites a stale record's buffers in place when the layout is unchanged:
   * every buffer the record owns has a source stream of the same aligned
   * size, and no stream newly appeared or vanished. Returns `false` (touching
   * nothing) otherwise, and the caller reallocates. No `GPUBuffer` is created
   * or destroyed on this path; large writes go through the §65 staging ring.
   */
  #rewriteInPlace(
    record: WgpuGeometryRecord,
    geometry: CacheableGeometry,
  ): boolean {
    const pairs: [GpuBuffer | null, ArrayBufferView | undefined][] = [
      [record.positionBuffer, geometry.positions],
      [record.normalBuffer, geometry.normals],
      [record.colorBuffer, geometry.colors],
      [record.uvBuffer, geometry.uvs],
      [record.jointBuffer, geometry.joints],
      [record.weightBuffer, geometry.weights],
      [record.position1Buffer, geometry.positions1],
      [record.normal1Buffer, geometry.normals1],
      [record.indexBuffer, geometry.indices],
    ];
    const extra = geometry.extraMorphTargets;
    for (let i = 0; i < record.extraMorphBuffers.length; i += 1) {
      const target = extra?.[i >> 1];
      pairs.push([
        record.extraMorphBuffers[i],
        target === undefined
          ? undefined
          : (i & 1) === 0
            ? target.positions
            : target.normals,
      ]);
    }
    for (const [buffer, data] of pairs) {
      if (buffer === null) {
        continue;
      }
      if (
        data === undefined ||
        this.#sizes.get(buffer) !== alignedSize(data.byteLength)
      ) {
        return false;
      }
    }
    if (
      record.indexBuffer !== null &&
      (record.indexFormat === "uint16") !==
        geometry.indices instanceof Uint16Array
    ) {
      return false;
    }
    for (const [buffer, data] of pairs) {
      if (buffer !== null && data !== undefined) {
        this.#staging.write(buffer, data);
      }
    }
    return true;
  }

  #upgradeSkinning(
    record: WgpuGeometryRecord,
    geometry: CacheableGeometry,
  ): void {
    if (record.jointBuffer === null && geometry.joints !== undefined) {
      record.jointBuffer = this.#uploadBuffer(
        geometry.joints,
        GPU_BUFFER_USAGE.VERTEX,
        `fourJS:joints:${geometry.id}`,
      );
    }
    if (record.weightBuffer === null && geometry.weights !== undefined) {
      record.weightBuffer = this.#uploadBuffer(
        geometry.weights,
        GPU_BUFFER_USAGE.VERTEX,
        `fourJS:weights:${geometry.id}`,
      );
    }
  }

  #upgradeMorph(
    record: WgpuGeometryRecord,
    geometry: CacheableGeometry,
    normals: boolean,
  ): void {
    const extra = geometry.extraMorphTargets;
    if (extra !== undefined) {
      const buffers = record.extraMorphBuffers;
      for (let j = 0; j < extra.length; j += 1) {
        const target = extra[j];
        for (let half = 0; half < 2; half += 1) {
          const data = half === 0 ? target.positions : target.normals;
          const at = 2 * j + half;
          if (buffers[at] === undefined) {
            buffers[at] = null;
          }
          if (
            buffers[at] === null &&
            data !== undefined &&
            (half === 0 || normals)
          ) {
            buffers[at] = this.#uploadBuffer(
              data,
              GPU_BUFFER_USAGE.VERTEX,
              `fourJS:${half === 0 ? "positions" : "normals"}${String(j + 2)}:${geometry.id}`,
            );
          }
        }
      }
    }
    if (record.position1Buffer === null && geometry.positions1 !== undefined) {
      record.position1Buffer = this.#uploadBuffer(
        geometry.positions1,
        GPU_BUFFER_USAGE.VERTEX,
        `fourJS:positions1:${geometry.id}`,
      );
    }
    if (
      normals &&
      record.normal1Buffer === null &&
      geometry.normals1 !== undefined
    ) {
      record.normal1Buffer = this.#uploadBuffer(
        geometry.normals1,
        GPU_BUFFER_USAGE.VERTEX,
        `fourJS:normals1:${geometry.id}`,
      );
    }
  }

  #upload(
    geometry: CacheableGeometry,
    normals: boolean,
    skinning: boolean,
    morph: boolean,
  ): WgpuGeometryRecord {
    const positionBuffer = this.#uploadBuffer(
      geometry.positions,
      GPU_BUFFER_USAGE.VERTEX,
      `fourJS:positions:${geometry.id}`,
    );

    // Allocation order is positions → normals → uvs → colours → joints →
    // weights → indices, the order `gl-geometry.ts` allocates in, so the
    // two backends' upload transcripts stay readable side by side. Normals
    // only when the acquiring draw shades; joints/weights only when it skins
    // (see the module header).
    const normalData = normals ? geometry.normals : undefined;
    const normalBuffer =
      normalData === undefined
        ? null
        : this.#uploadBuffer(
            normalData,
            GPU_BUFFER_USAGE.VERTEX,
            `fourJS:normals:${geometry.id}`,
          );

    const uvs = geometry.uvs;
    const uvBuffer =
      uvs === undefined
        ? null
        : this.#uploadBuffer(
            uvs,
            GPU_BUFFER_USAGE.VERTEX,
            `fourJS:uvs:${geometry.id}`,
          );

    const colors = geometry.colors;
    const colorBuffer =
      colors === undefined
        ? null
        : this.#uploadBuffer(
            colors,
            GPU_BUFFER_USAGE.VERTEX,
            `fourJS:colors:${geometry.id}`,
          );

    const jointData = skinning ? geometry.joints : undefined;
    const jointBuffer =
      jointData === undefined
        ? null
        : this.#uploadBuffer(
            jointData,
            GPU_BUFFER_USAGE.VERTEX,
            `fourJS:joints:${geometry.id}`,
          );

    const weightData = skinning ? geometry.weights : undefined;
    const weightBuffer =
      weightData === undefined
        ? null
        : this.#uploadBuffer(
            weightData,
            GPU_BUFFER_USAGE.VERTEX,
            `fourJS:weights:${geometry.id}`,
          );

    const position1Data = morph ? geometry.positions1 : undefined;
    const position1Buffer =
      position1Data === undefined
        ? null
        : this.#uploadBuffer(
            position1Data,
            GPU_BUFFER_USAGE.VERTEX,
            `fourJS:positions1:${geometry.id}`,
          );

    const normal1Data = morph && normals ? geometry.normals1 : undefined;
    const normal1Buffer =
      normal1Data === undefined
        ? null
        : this.#uploadBuffer(
            normal1Data,
            GPU_BUFFER_USAGE.VERTEX,
            `fourJS:normals1:${geometry.id}`,
          );

    const indices = geometry.indices;
    const indexBuffer =
      indices === undefined
        ? null
        : this.#uploadBuffer(
            indices,
            GPU_BUFFER_USAGE.INDEX,
            `fourJS:indices:${geometry.id}`,
          );

    const record: WgpuGeometryRecord = {
      positionBuffer,
      normalBuffer,
      colorBuffer,
      uvBuffer,
      jointBuffer,
      weightBuffer,
      position1Buffer,
      normal1Buffer,
      extraMorphBuffers: [],
      indexBuffer,
      indexFormat:
        indices === undefined
          ? null
          : indices instanceof Uint16Array
            ? "uint16"
            : "uint32",
      version: geometry.version,
      count: geometry.drawCount,
      topology: geometry.mode === "lines" ? "line-list" : "triangle-list",
    };
    if (morph) {
      this.#upgradeMorph(record, geometry, normals);
    }
    return record;
  }

  #uploadBuffer(
    data: ArrayBufferView,
    usage: number,
    label: string,
  ): GpuBuffer {
    const buffer = this.#device.createBuffer({
      label,
      size: alignedSize(data.byteLength),
      usage: usage | GPU_BUFFER_USAGE.COPY_DST,
    });
    this.#device.queue.writeBuffer(buffer, 0, data);
    this.#sizes.set(buffer, alignedSize(data.byteLength));
    return buffer;
  }

  #destroyRecord(record: WgpuGeometryRecord): void {
    record.positionBuffer.destroy();
    record.normalBuffer?.destroy();
    record.colorBuffer?.destroy();
    record.uvBuffer?.destroy();
    record.jointBuffer?.destroy();
    record.weightBuffer?.destroy();
    record.position1Buffer?.destroy();
    record.normal1Buffer?.destroy();
    for (const buffer of record.extraMorphBuffers) {
      buffer?.destroy();
    }
    record.indexBuffer?.destroy();
  }
}
