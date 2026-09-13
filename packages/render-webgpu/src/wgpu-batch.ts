/**
 * §65 batching for the WebGPU backend — the GPU half of `@fourjs/render`'s
 * {@link RenderBatcher}, and the twin of `@fourjs/render-webgl`'s `gl-batch.ts`
 * (WP-R1.3).
 *
 * The planner is untouched and unshared-code: `batch.ts` decides which
 * consecutive draws merge — clip-record boundaries included (R-23) — and
 * produces one interleaved vertex stream plus one index stream. This module
 * owns the GPU buffers those streams are uploaded into and issues the single
 * `drawIndexed` that replaces the run. Nothing here decides what may batch;
 * read `batch.ts`'s header for the tier and `gl-batch.ts`'s for why batching
 * is opt-in (the measured pipeline-cost law — `WebgpuRenderer` names this
 * module `import type` only, so an application that never calls
 * {@link createWgpuBatching} pays zero bytes for it).
 *
 * ```ts
 * const renderer = new WebgpuRenderer();
 * await renderer.initialize({ canvas });
 * renderer.batching = createWgpuBatching();   // §65, opt in
 * ```
 *
 * ## The one structural difference from the GL twin: a buffer pair per batch
 *
 * `GlBatching` reuses **one** vertex/index buffer pair for every batch of a
 * frame, because GL executes `bufferSubData` and `drawElements` in issue
 * order — each batch's upload lands before its draw runs. WebGPU cannot reuse
 * one pair that way: `queue.writeBuffer` executes in **queue** order, before
 * the frame's `submit`, so a second batch's upload into a shared buffer would
 * overwrite the first batch's data before the first batch's recorded draw ever
 * executes. So this module keeps a **buffer pair per batch slot**: batch *k*
 * of a frame draws from pair *k*, uploaded immediately (nothing else writes
 * that pair this frame) and reused by batch *k* of every later frame.
 * {@link WgpuRenderBatching.beginFrame} is what resets the slot counter, and
 * it is the one contract member the GL interface does not need.
 *
 * The steady state is the GL one's: one `writeBuffer` pair per batch per
 * frame when the planner's `contentVersion` moves, **and zero uploads on a
 * still scene** (`#canSkipUpload`, the GL twin's `#canSkipUpload`). §65's
 * *"persistent mapped or staged buffers"* — a staging ring that would
 * collapse the per-batch uploads into one — becomes reachable at this seam
 * for the first time and is deliberately **noted, not built**: it is its
 * own packet (R-1 plan, WP-R1.3).
 *
 * ## Growth is safe mid-frame, and the reason is worth stating
 *
 * A slot's buffers grow when this frame's batch *k* outgrows them. The old
 * buffer's last use was batch *k* of a *previous* frame, whose `submit` has
 * long since been called, so `destroy()` at growth time is safe — unlike the
 * shared-pair design, where growth would destroy a buffer the current pass
 * already references. Growth sizes the new buffer to the planner's whole
 * staging array (the size `gl-batch.ts` gives `bufferData`), so the arrays
 * double-and-stop behaviour upstream bounds allocations here too.
 *
 * ## What one draw becomes
 *
 * A batch draws through the **unlit shader family**, whatever pipeline its
 * items came from — `gl-batch.ts`'s argument verbatim: a sprite batch carries
 * uv per vertex and uploads the material's tint as the draw colour, and the
 * fragment product `color × texture` is the sprite pipeline's product in the
 * opposite, commutative order. What *is* new here is that WebGPU bakes the
 * vertex layout into the pipeline, so a batch cannot reuse the unlit
 * pipelines' separate-stream layouts: the renderer asks the pipeline cache for
 * a `kind: "batch"` variant whose one vertex buffer is the planner's
 * interleaved stream ({@link batchVertexBufferLayout}), compiled from the same
 * WGSL modules the unlit pipelines share.
 *
 * ## Device loss (§61)
 *
 * {@link WgpuRenderBatching.forget} drops every handle without calling
 * `destroy()` — the allocations belong to a device that no longer exists —
 * and {@link WgpuRenderBatching.dispose} destroys them on a live one, exactly
 * as every cache in this backend does. A *new* device arriving through
 * {@link WgpuRenderBatching.draw} resets the pool the way `GlBatching` resets
 * on a new context.
 */

import { FourError } from "@fourjs/core";
import {
  RenderBatcher,
  type RenderBatch,
  type RenderBatchOptions,
  type RenderItem,
} from "@fourjs/render";

import {
  GPU_BUFFER_USAGE,
  type GpuBuffer,
  type GpuDevice,
  type GpuRenderPassEncoder,
  type GpuVertexBufferLayout,
} from "./webgpu-device.js";
import {
  COLOR_SHADER_LOCATION,
  POSITION_SHADER_LOCATION,
  UV_SHADER_LOCATION,
} from "./wgpu-unlit.js";

/** Bytes per float, so the stride arithmetic reads as what it is. */
const FLOAT_BYTES = 4;

/**
 * The vertex-buffer layout of one batched draw: the planner's interleaved
 * stream — position, then uv when the stream carries it, then colour — as
 * **one** buffer in slot 0, against the shader locations the unlit family
 * names (`wgpu-unlit.ts`: locations are names, slots are positional).
 *
 * `streamUvs`/`streamColors` describe what the stream *contains* (they fix the
 * stride and the offsets); `readUvs`/`readColors` describe what the variant
 * *reads* (they decide which attributes are declared). The two can differ in
 * exactly one direction: an unlit batch whose named texture fails to resolve
 * draws untextured through a variant that reads no uv, over a stream that
 * still interleaves them — WebGPU permits a buffer byte range no attribute
 * names, so the uv floats are simply strided over, which is this backend's
 * spelling of `gl-batch.ts`'s "an unlit batch draws on untextured instead".
 * The renderer never asks for the other direction (an attribute the stream
 * does not contain would read past the vertex).
 */
export function batchVertexBufferLayout(
  streamUvs: boolean,
  streamColors: boolean,
  readUvs: boolean,
  readColors: boolean,
): GpuVertexBufferLayout {
  const attributes: {
    format: string;
    offset: number;
    shaderLocation: number;
  }[] = [
    {
      format: "float32x3",
      offset: 0,
      shaderLocation: POSITION_SHADER_LOCATION,
    },
  ];
  if (readUvs) {
    attributes.push({
      format: "float32x2",
      offset: 3 * FLOAT_BYTES,
      shaderLocation: UV_SHADER_LOCATION,
    });
  }
  if (readColors) {
    attributes.push({
      format: "float32x4",
      offset: (3 + (streamUvs ? 2 : 0)) * FLOAT_BYTES,
      shaderLocation: COLOR_SHADER_LOCATION,
    });
  }
  return {
    arrayStride:
      (3 + (streamUvs ? 2 : 0) + (streamColors ? 4 : 0)) * FLOAT_BYTES,
    stepMode: "vertex",
    attributes,
  };
}

/**
 * The batching support a {@link WebgpuRenderer} draws through when an
 * application assigns one — the interface, so the renderer names no
 * implementation and this module drops out of a bundle that never asks for it
 * (`gl-batch.ts`'s `RenderBatching`, restated for this backend's contract).
 *
 * Implemented by {@link WgpuBatching}; construct one with
 * {@link createWgpuBatching}. Named `WgpuRenderBatching` because the WebGL
 * backend exports `RenderBatching` for its own, GL-shaped contract
 * (`draw(gl, program, …)`), and one name for two per-backend interfaces across
 * the workspace is the `WgpuCacheableTexture` confusion again.
 */
export interface WgpuRenderBatching {
  /**
   * Plans and assembles the batch starting at `items[from]`, or `null` when
   * that item does not start one — `RenderBatcher.next`, forwarded verbatim,
   * `layerMask` included for `gl-batch.ts`'s recorded reason (the renderer no
   * longer passes one over a pre-filtered view list; a caller batching an
   * unfiltered frame list still may).
   */
  next(
    items: readonly RenderItem[],
    from: number,
    layerMask?: number,
  ): RenderBatch | null;

  /**
   * Resets the frame's slot counter (see the module header) — called once per
   * frame by the renderer, before any view is recorded. A renderer with
   * `batching: null` calls nothing at all, which is the byte-identity half of
   * the contract.
   */
  beginFrame(): void;

  /**
   * Uploads `batch` into this frame's next slot and records its single
   * indexed draw into `pass` — the vertex-buffer bind, the index-buffer bind
   * and the `drawIndexed`.
   *
   * Everything a draw *shares* with the ordinary path stays with the caller:
   * the pipeline, the group-0 uniform block (identity model — positions
   * arrive in world space — and the batch's colour), the group-1 texture bind,
   * the stencil reference, and §84's counting. A later ordinary draw needs no
   * restore: vertex and index bindings are re-issued per draw on this backend
   * anyway, which is one more place the pass-command model is structurally
   * safer than GL's ambient state.
   */
  draw(device: GpuDevice, pass: GpuRenderPassEncoder, batch: RenderBatch): void;

  /** Drops the GPU handles without touching the device (§61 device loss). */
  forget(): void;

  /** Destroys the GPU handles on a live device (§83). */
  dispose(): void;
}

/** One batch slot's persistent buffers and their current capacities. */
interface BatchSlot {
  vertexBuffer: GpuBuffer;
  /** Floats the vertex buffer's allocation holds. */
  vertexFloats: number;
  indexBuffer: GpuBuffer;
  /** Indices the index buffer's allocation holds. */
  indexCount: number;
  /**
   * Last uploaded {@link RenderBatch.contentVersion}. `0` is the planner's
   * "versions unavailable" signal and never skips.
   */
  lastContentVersion: number;
  lastVertexCount: number;
  lastIndexCount: number;
  /**
   * Last uploaded {@link RenderBatch.floatsPerVertex}. `contentVersion` is
   * geometry + transform only (`batch.ts`); a material-driven stream-shape
   * change (UVs / vertex colours) keeps that stamp and the vertex/index
   * counts while the interleaved layout moves.
   */
  lastFloatsPerVertex: number;
}

/**
 * The batcher plus the per-slot GPU buffers its output is drawn from — see the
 * module header. One per renderer; holds no scene state.
 */
export class WgpuBatching implements WgpuRenderBatching {
  readonly #batcher: RenderBatcher;

  /** The device the slots below belong to; `null` before the first draw. */
  #device: GpuDevice | null = null;

  /** One buffer pair per batch slot, grown per slot and kept across frames. */
  readonly #slots: BatchSlot[] = [];

  /** Slots handed out this frame; reset by {@link WgpuBatching.beginFrame}. */
  #slot = 0;

  /** Set by {@link WgpuBatching.dispose}; disposal is terminal (§83). */
  #disposed = false;

  /**
   * Whether {@link WgpuBatching.dispose} has run. Disposal is terminal (§83): a
   * disposed uploader refuses its per-frame entry points with
   * `INVALID_APPLICATION_STATE` (§89) rather than silently working.
   */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** §83's "disposed resource still in use", made loud (§89). */
  #requireLive(): void {
    if (this.#disposed) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        "WgpuBatching is disposed; drawing through a disposed uploader is " +
          "a lifetime mistake (§83), and a new uploader is a new " +
          "WgpuBatching.",
        { context: { uploader: "WgpuBatching" } },
      );
    }
  }

  constructor(options: RenderBatchOptions = {}) {
    this.#batcher = new RenderBatcher(options);
  }

  next(
    items: readonly RenderItem[],
    from: number,
    layerMask?: number,
  ): RenderBatch | null {
    // Forwarded as-is, `undefined` included — `gl-batch.ts`'s note: the
    // planner's own default is the single definition of "no mask".
    return this.#batcher.next(items, from, layerMask);
  }

  beginFrame(): void {
    this.#requireLive();
    this.#slot = 0;
  }

  draw(
    device: GpuDevice,
    pass: GpuRenderPassEncoder,
    batch: RenderBatch,
  ): void {
    this.#requireLive();
    if (this.#device !== device) {
      // A different device — the first draw, or the first after a loss. The
      // old handles belong to a device that is gone: dropped, never destroyed,
      // exactly as `forget` drops them.
      this.#reset();
      this.#device = device;
    }
    const slot = this.#acquireSlot(device, batch, this.#slot);
    this.#slot += 1;

    if (!this.#canSkipUpload(batch, slot)) {
      const floats = batch.vertexCount * batch.floatsPerVertex;
      device.queue.writeBuffer(slot.vertexBuffer, 0, batch.vertices, 0, floats);
      device.queue.writeBuffer(
        slot.indexBuffer,
        0,
        batch.indices,
        0,
        batch.indexCount,
      );
      this.#rememberUpload(batch, slot);
    }
    pass.setVertexBuffer(0, slot.vertexBuffer);
    // Always 32-bit: the planner widens every source index (`batch.ts`).
    pass.setIndexBuffer(slot.indexBuffer, "uint32");
    pass.drawIndexed(batch.indexCount);
  }

  forget(): void {
    this.#reset();
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const slot of this.#slots) {
      slot.vertexBuffer.destroy();
      slot.indexBuffer.destroy();
    }
    this.#reset();
  }

  /** Forgets every handle and every capacity claim. */
  #reset(): void {
    this.#device = null;
    this.#slots.length = 0;
    this.#slot = 0;
  }

  /**
   * The buffers batch `index` of this frame draws from, created on first use
   * and regrown when this batch outgrows them.
   *
   * Sized to the planner's whole staging arrays when (re)created — the size
   * `gl-batch.ts` hands `bufferData` — so upstream's double-and-stop growth
   * bounds the reallocation count here too. Destroying at growth time is safe:
   * the old buffer's last use was a previous, already-submitted frame (see the
   * module header).
   */
  #acquireSlot(
    device: GpuDevice,
    batch: RenderBatch,
    index: number,
  ): BatchSlot {
    const floats = batch.vertexCount * batch.floatsPerVertex;
    let slot = this.#slots[index];
    if (slot === undefined) {
      slot = {
        vertexBuffer: this.#createVertexBuffer(device, batch, index),
        vertexFloats: batch.vertices.length,
        indexBuffer: this.#createIndexBuffer(device, batch, index),
        indexCount: batch.indices.length,
        lastContentVersion: 0,
        lastVertexCount: -1,
        lastIndexCount: -1,
        lastFloatsPerVertex: -1,
      };
      this.#slots[index] = slot;
      return slot;
    }
    if (slot.vertexFloats < floats) {
      slot.vertexBuffer.destroy();
      slot.vertexBuffer = this.#createVertexBuffer(device, batch, index);
      slot.vertexFloats = batch.vertices.length;
      slot.lastContentVersion = 0;
    }
    if (slot.indexCount < batch.indexCount) {
      slot.indexBuffer.destroy();
      slot.indexBuffer = this.#createIndexBuffer(device, batch, index);
      slot.indexCount = batch.indices.length;
      slot.lastContentVersion = 0;
    }
    return slot;
  }

  /**
   * Whether this slot already holds `batch`. `contentVersion === 0` is the
   * planner's "versions unavailable" signal and always misses. Per-slot,
   * not per-frame: WebGPU keeps a buffer pair per batch index, so slot *k*
   * of a still scene is the same bytes as last frame's slot *k*.
   * `floatsPerVertex` is part of the key: the planner stamp does not see
   * material stream shape, and a skipped upload of the wrong stride would
   * leave stale vertex bytes under a different pipeline.
   */
  #canSkipUpload(batch: RenderBatch, slot: BatchSlot): boolean {
    const version = batch.contentVersion ?? 0;
    return (
      version !== 0 &&
      slot.lastContentVersion === version &&
      slot.lastVertexCount === batch.vertexCount &&
      slot.lastIndexCount === batch.indexCount &&
      slot.lastFloatsPerVertex === batch.floatsPerVertex
    );
  }

  #rememberUpload(batch: RenderBatch, slot: BatchSlot): void {
    slot.lastContentVersion = batch.contentVersion ?? 0;
    slot.lastVertexCount = batch.vertexCount;
    slot.lastIndexCount = batch.indexCount;
    slot.lastFloatsPerVertex = batch.floatsPerVertex;
  }

  #createVertexBuffer(
    device: GpuDevice,
    batch: RenderBatch,
    index: number,
  ): GpuBuffer {
    return device.createBuffer({
      label: `fourJS:batch-vertices:${String(index)}`,
      size: batch.vertices.length * FLOAT_BYTES,
      usage: GPU_BUFFER_USAGE.VERTEX | GPU_BUFFER_USAGE.COPY_DST,
    });
  }

  #createIndexBuffer(
    device: GpuDevice,
    batch: RenderBatch,
    index: number,
  ): GpuBuffer {
    return device.createBuffer({
      label: `fourJS:batch-indices:${String(index)}`,
      size: batch.indices.length * FLOAT_BYTES,
      usage: GPU_BUFFER_USAGE.INDEX | GPU_BUFFER_USAGE.COPY_DST,
    });
  }
}

/**
 * Creates the §65 batching support a {@link WebgpuRenderer} draws through.
 *
 * ```ts
 * renderer.batching = createWgpuBatching();                      // defaults
 * renderer.batching = createWgpuBatching({ maxVertices: 4096 }); // smaller runs
 * ```
 *
 * A function rather than an exported class construction at the call site, for
 * `createGlBatching`'s reason: the application says *what it wants*, the
 * renderer names no implementation, and this module stays out of every bundle
 * that does not ask for it.
 */
export function createWgpuBatching(
  options?: RenderBatchOptions,
): WgpuRenderBatching {
  return new WgpuBatching(options);
}
