/**
 * WebGPU GPU-frame timer — `timestamp-query` ping-pong (A-1, §62, §84).
 *
 * Writes a begin/end timestamp on the views pass, resolves into a
 * `QUERY_RESOLVE` buffer, copies into a `MAP_READ` buffer, and publishes
 * the difference (seconds) once `mapAsync` resolves. The published value
 * is always the **last completed** frame: WebGPU has no synchronous
 * timestamp read, and stalling the queue would be a different number from
 * the one §84 asks for.
 *
 * Two mapped slots so a still-mapping readback never blocks the next
 * resolve (the same ping-pong WP-R1.6's `readPixels` uses, one purpose
 * later).
 *
 * ## What this does not do
 *
 * - It allocates nothing and records not one extra command until
 *   {@link WgpuGpuTimer.arm} runs. That is what keeps every landed
 *   WebGPU transcript byte-identical for a renderer whose
 *   `lastGpuFrameTimeSeconds` is never read (R-30b).
 * - It does not invent a result when the device was created without
 *   `timestamp-query`, or when `createQuerySet` / `resolveQuerySet` /
 *   `copyBufferToBuffer` / `mapAsync` is missing. The field stays `NaN`.
 * - It times the **views** pass, not shadow or effect passes. Those are
 *   separate encoders; summing them is a follow-up, not this packet.
 */

import { FourError } from "@fourjs/core";

import {
  GPU_BUFFER_USAGE,
  GPU_MAP_MODE,
  type GpuBuffer,
  type GpuCommandEncoder,
  type GpuDevice,
  type GpuQuerySet,
} from "./webgpu-device.js";

/** Two timestamps × 8 bytes. */
const TIMESTAMP_PAIR_BYTES = 16;

const RESOLVE_USAGE =
  GPU_BUFFER_USAGE.QUERY_RESOLVE | GPU_BUFFER_USAGE.COPY_SRC;

const READ_USAGE = GPU_BUFFER_USAGE.MAP_READ | GPU_BUFFER_USAGE.COPY_DST;

interface TimerSlot {
  readonly buffer: GpuBuffer;
  busy: boolean;
}

/**
 * Seconds between the views-pass begin/end timestamps of the last
 * completed resolve, or `NaN` when none has landed.
 */
export class WgpuGpuTimer {
  /**
   * Last completed GPU-frame duration in seconds. `NaN` until a mapped
   * pair arrives with a finite non-negative difference.
   */
  lastGpuFrameTimeSeconds = Number.NaN;

  #armed = false;

  #querySet: GpuQuerySet | null = null;

  #resolve: GpuBuffer | null = null;

  #slots: TimerSlot[] | null = null;

  #slot = 0;

  #wroteThisFrame = false;

  /** Set by {@link WgpuGpuTimer.dispose}; disposal is terminal (§83). */
  #disposed = false;

  /**
   * Whether {@link WgpuGpuTimer.dispose} has run. Disposal is terminal (§83): a
   * disposed timer refuses arming and per-frame timestamp writes with
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
        "WgpuGpuTimer is disposed; timing through a disposed timer is a " +
          "lifetime mistake (§83), and a new timer is a new WgpuGpuTimer.",
        { context: { timer: "WgpuGpuTimer" } },
      );
    }
  }

  /** Start issuing timestamps on subsequent views passes. */
  arm(): void {
    this.#requireLive();
    this.#armed = true;
  }

  /** Whether {@link WgpuGpuTimer.arm} has run. */
  get armed(): boolean {
    return this.#armed;
  }

  /**
   * Whether this device can actually time a pass. Presence of the feature
   * **and** the optional entry points (R-30b). Does not allocate.
   */
  isSupported(device: GpuDevice): boolean {
    return (
      device.features?.has("timestamp-query") === true &&
      typeof device.createQuerySet === "function" &&
      typeof device.createBuffer === "function"
    );
  }

  /**
   * Timestamp writes for the views pass, or `undefined` when this frame
   * should record the descriptor it always did.
   */
  beginPass(device: GpuDevice):
    | {
        readonly querySet: GpuQuerySet;
        readonly beginningOfPassWriteIndex: number;
        readonly endingOfPassWriteIndex: number;
      }
    | undefined {
    this.#requireLive();
    this.#wroteThisFrame = false;
    if (!this.#armed || !this.isSupported(device)) {
      return undefined;
    }
    const resources = this.#ensure(device);
    if (resources === null) {
      return undefined;
    }
    const slot = resources.slots[this.#slot];
    if (slot === undefined || slot.busy) {
      return undefined;
    }
    this.#wroteThisFrame = true;
    return {
      querySet: resources.querySet,
      beginningOfPassWriteIndex: 0,
      endingOfPassWriteIndex: 1,
    };
  }

  /**
   * Resolves the pair into the current slot. No-ops when {@link beginPass}
   * did not write this frame, so a tape that never armed stays identical.
   */
  resolve(encoder: GpuCommandEncoder): void {
    if (!this.#wroteThisFrame) {
      return;
    }
    const querySet = this.#querySet;
    const resolve = this.#resolve;
    const slots = this.#slots;
    const slot = slots?.[this.#slot];
    if (
      querySet === null ||
      resolve === null ||
      slot === undefined ||
      typeof encoder.resolveQuerySet !== "function" ||
      typeof encoder.copyBufferToBuffer !== "function"
    ) {
      this.#wroteThisFrame = false;
      return;
    }
    encoder.resolveQuerySet(querySet, 0, 2, resolve, 0);
    encoder.copyBufferToBuffer(resolve, 0, slot.buffer, 0, TIMESTAMP_PAIR_BYTES);
  }

  /**
   * Maps the slot just resolved. Call **after** `queue.submit` so the
   * resolve/copy complete before the map. The published seconds update
   * when the promise settles.
   */
  afterSubmit(): void {
    if (!this.#wroteThisFrame) {
      return;
    }
    this.#wroteThisFrame = false;
    const slots = this.#slots;
    const slot = slots?.[this.#slot];
    const mapped = slot?.buffer.mapAsync?.(GPU_MAP_MODE.READ);
    if (slot === undefined || mapped === undefined) {
      return;
    }
    const captured = slot;
    captured.busy = true;
    this.#slot ^= 1;
    void mapped.then(() => {
      const range = captured.buffer.getMappedRange?.();
      if (range !== undefined) {
        const times = new BigUint64Array(range);
        const begin = times[0];
        const end = times[1];
        if (begin !== undefined && end !== undefined && end >= begin) {
          const seconds = Number(end - begin) * 1e-9;
          if (Number.isFinite(seconds)) {
            this.lastGpuFrameTimeSeconds = seconds;
          }
        }
      }
      captured.buffer.unmap?.();
      captured.busy = false;
    }, () => {
      // A `mapAsync` still in flight when the device is lost or the timer is
      // disposed rejects (`AbortError` / `OperationError`). The sample is
      // simply dropped; the slot must not stay `busy` forever, and nothing
      // may surface as an unhandled rejection at the host (§61, §89).
      captured.busy = false;
    });
  }

  /**
   * Drops GPU objects without calling into the device — device loss, where
   * the allocations are already gone.
   */
  forget(): void {
    this.#querySet = null;
    this.#resolve = null;
    this.#slots = null;
    this.#slot = 0;
    this.#wroteThisFrame = false;
    this.lastGpuFrameTimeSeconds = Number.NaN;
  }

  /** Releases query-set and buffers on a live device (§83). */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#querySet?.destroy();
    this.#resolve?.destroy();
    const slots = this.#slots;
    if (slots !== null) {
      for (const slot of slots) {
        slot.buffer.destroy();
      }
    }
    this.forget();
  }

  #ensure(device: GpuDevice): {
    readonly querySet: GpuQuerySet;
    readonly slots: TimerSlot[];
  } | null {
    if (this.#querySet !== null && this.#slots !== null) {
      return { querySet: this.#querySet, slots: this.#slots };
    }
    if (device.createQuerySet === undefined) {
      return null;
    }
    const querySet = device.createQuerySet({
      type: "timestamp",
      count: 2,
    });
    const resolve = device.createBuffer({
      label: "fourJS:gpu-time-resolve",
      size: TIMESTAMP_PAIR_BYTES,
      usage: RESOLVE_USAGE,
    });
    const slots: TimerSlot[] = [
      {
        buffer: device.createBuffer({
          label: "fourJS:gpu-time-read-0",
          size: TIMESTAMP_PAIR_BYTES,
          usage: READ_USAGE,
        }),
        busy: false,
      },
      {
        buffer: device.createBuffer({
          label: "fourJS:gpu-time-read-1",
          size: TIMESTAMP_PAIR_BYTES,
          usage: READ_USAGE,
        }),
        busy: false,
      },
    ];
    this.#querySet = querySet;
    this.#resolve = resolve;
    this.#slots = slots;
    return { querySet, slots };
  }
}
