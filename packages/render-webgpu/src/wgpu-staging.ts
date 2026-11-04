/**
 * Staging ring for dynamic buffer updates (§65) — WebGPU.
 *
 * A geometry whose `version` advances every frame used to be destroyed and
 * reallocated each time. This ring lets {@link WgpuGeometryCache} rewrite the
 * *same* vertex buffer instead, by one of two paths chosen on the size of the
 * write:
 *
 * - **Direct**, below {@link STAGING_DIRECT_THRESHOLD} bytes (64 KiB): one
 *   `queue.writeBuffer` into the destination. The implementation stages small
 *   writes in its own upload heap, so a ring would only add a copy command.
 * - **Ringed**, at or above the threshold: `queue.writeBuffer` into the next of
 *   {@link STAGING_RING_FRAMES} (3) `COPY_SRC` staging buffers, then a
 *   `copyBufferToBuffer` into the destination, submitted immediately. The slot
 *   cursor advances per ringed write (not per frame); queue order already
 *   makes reuse hazard-free, since a `writeBuffer` is ordered after every
 *   earlier submitted copy that reads the same staging buffer. Staging buffers are reused (grown geometrically when a bigger
 *   write arrives), so a steady-state frame allocates nothing.
 *
 * `mapAsync` is deliberately not used: it would make the update asynchronous
 * and let the draw read stale vertices (no observable pixel change is allowed).
 * A device without `copyBufferToBuffer`/`createCommandEncoder` falls back to
 * the direct path.
 */

import {
  GPU_BUFFER_USAGE,
  type GpuBuffer,
  type GpuDevice,
} from "./webgpu-device.js";

/** Writes of at least this many bytes go through the ring; smaller go direct. */
export const STAGING_DIRECT_THRESHOLD = 64 * 1024;

/** Frames in flight the ring rotates across. */
export const STAGING_RING_FRAMES = 3;

/** A ring of reusable `COPY_SRC` staging buffers. */
export class WgpuStagingRing {
  readonly #device: GpuDevice;

  readonly #slots: (GpuBuffer | null)[] = new Array<GpuBuffer | null>(
    STAGING_RING_FRAMES,
  ).fill(null);

  readonly #sizes: number[] = new Array<number>(STAGING_RING_FRAMES).fill(0);

  #cursor = 0;

  /** Whether the encoder has `copyBufferToBuffer`; `null` until probed. */
  #copySupported: boolean | null = null;

  /** Reused 4-byte-aligned copy of an odd-length write; grows, never shrinks. */
  #scratch = new Uint8Array(0);

  #allocations = 0;

  constructor(device: GpuDevice) {
    this.#device = device;
  }

  /** Staging buffers created over the ring's life (steady state: constant). */
  get allocations(): number {
    return this.#allocations;
  }

  /** Bytes currently held by the staging buffers. */
  get bytes(): number {
    let total = 0;
    for (const size of this.#sizes) total += size;
    return total;
  }

  /** The path {@link WgpuStagingRing.write} takes for `byteLength` bytes. */
  pathFor(byteLength: number): "direct" | "ring" {
    return byteLength < STAGING_DIRECT_THRESHOLD ? "direct" : "ring";
  }

  /**
   * `queue.writeBuffer` of `data` at offset 0 with a 4-byte-multiple size
   * (WebGPU validation): an odd-length view (a `Uint16Array` of odd count) is
   * copied into a reused zero-padded scratch first.
   */
  writeDirect(destination: GpuBuffer, data: ArrayBufferView): void {
    const bytes = data.byteLength;
    if ((bytes & 3) === 0) {
      this.#device.queue.writeBuffer(destination, 0, data);
      return;
    }
    const padded = (bytes + 3) & ~3;
    if (this.#scratch.byteLength < padded) {
      this.#scratch = new Uint8Array(padded);
    }
    const scratch = this.#scratch;
    scratch.set(new Uint8Array(data.buffer, data.byteOffset, bytes), 0);
    scratch.fill(0, bytes, padded);
    this.#device.queue.writeBuffer(destination, 0, scratch, 0, padded);
  }

  /** Rewrites `destination` (offset 0) with `data`. */
  write(destination: GpuBuffer, data: ArrayBufferView): void {
    if (
      this.pathFor(data.byteLength) === "direct" ||
      this.#copySupported === false
    ) {
      this.writeDirect(destination, data);
      return;
    }
    const encoder = this.#device.createCommandEncoder({
      label: "fourJS:staging-copy",
    });
    if (encoder.copyBufferToBuffer === undefined) {
      // Probed once: later writes skip the encoder entirely.
      this.#copySupported = false;
      this.writeDirect(destination, data);
      return;
    }
    this.#copySupported = true;
    const size = Math.ceil(data.byteLength / 4) * 4;
    const slot = this.#cursor;
    this.#cursor = (slot + 1) % STAGING_RING_FRAMES;
    let staging = this.#slots[slot];
    if (staging === null || this.#sizes[slot] < size) {
      staging?.destroy();
      const grown = Math.max(size, this.#sizes[slot] * 2);
      staging = this.#device.createBuffer({
        label: `fourJS:staging:${String(slot)}`,
        size: grown,
        usage: GPU_BUFFER_USAGE.COPY_SRC | GPU_BUFFER_USAGE.COPY_DST,
      });
      this.#slots[slot] = staging;
      this.#sizes[slot] = grown;
      this.#allocations += 1;
    }
    this.writeDirect(staging, data);
    encoder.copyBufferToBuffer(staging, 0, destination, 0, size);
    this.#device.queue.submit([encoder.finish()]);
  }

  /** Destroys every staging buffer. Idempotent. */
  dispose(): void {
    for (let i = 0; i < STAGING_RING_FRAMES; i += 1) {
      this.#slots[i]?.destroy();
      this.#slots[i] = null;
      this.#sizes[i] = 0;
    }
  }
}
