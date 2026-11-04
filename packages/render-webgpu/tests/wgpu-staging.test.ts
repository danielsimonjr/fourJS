import { describe, expect, it } from "vitest";

import { createRecordingGpu } from "../../../tests/integration/helpers/recording-gpu.js";
import {
  STAGING_DIRECT_THRESHOLD,
  STAGING_RING_FRAMES,
  WgpuGeometryCache,
  WgpuStagingRing,
  type CacheableGeometry,
  type GpuDevice,
} from "../src/index.js";

function setup() {
  const gpu = createRecordingGpu();
  return { gpu, device: gpu.device as GpuDevice };
}

let nextId = 0;
/** TypeScript 6 (TypeDoc) sees `version` as read-only; TS 7 does not. */
function bump(target: object, version: number): void {
  (target as { version: number }).version = version;
}

function geo(floats: number, version = 0) {
  return {
    id: `stg-${String(nextId++)}`,
    version,
    positions: new Float32Array(floats),
    indices: undefined as Uint16Array | undefined,
    mode: "triangles",
    drawCount: floats / 3,
  } as unknown as CacheableGeometry & { version: number };
}

const BIG = STAGING_DIRECT_THRESHOLD / 4; // floats == threshold bytes

describe("WgpuStagingRing", () => {
  it("selects the path by the 64 KiB threshold", () => {
    const { device } = setup();
    const ring = new WgpuStagingRing(device);
    expect(ring.pathFor(STAGING_DIRECT_THRESHOLD - 1)).toBe("direct");
    expect(ring.pathFor(STAGING_DIRECT_THRESHOLD)).toBe("ring");
  });

  it("writes small data directly with no staging buffer", () => {
    const { device, gpu } = setup();
    const ring = new WgpuStagingRing(device);
    const dest = device.createBuffer({ size: 64, usage: 0x28 });
    gpu.reset();
    ring.write(dest, new Float32Array(4));
    expect(gpu.countOf("queue.writeBuffer")).toBe(1);
    expect(gpu.countOf("device.createBuffer")).toBe(0);
    expect(gpu.countOf("encoder.copyBufferToBuffer")).toBe(0);
  });

  it("rotates frames, allocates only while warming, and frees on dispose", () => {
    const { device, gpu } = setup();
    const ring = new WgpuStagingRing(device);
    const dest = device.createBuffer({ size: BIG * 4, usage: 0x28 });
    for (let i = 0; i < STAGING_RING_FRAMES * 3; i++) {
      ring.write(dest, new Float32Array(BIG));
      if (i === STAGING_RING_FRAMES - 1) {
        expect(ring.allocations).toBe(STAGING_RING_FRAMES);
        gpu.reset();
      }
    }
    expect(ring.allocations).toBe(STAGING_RING_FRAMES);
    expect(gpu.countOf("device.createBuffer")).toBe(0);
    expect(gpu.countOf("queue.submit")).toBe(STAGING_RING_FRAMES * 2);
    const sources = gpu
      .callsOf("encoder.copyBufferToBuffer")
      .map((call) => call.args[0]);
    expect(new Set(sources).size).toBe(STAGING_RING_FRAMES);
    expect(ring.bytes).toBe(STAGING_RING_FRAMES * BIG * 4);
    ring.dispose();
    expect(gpu.countOf("buffer.destroy")).toBe(STAGING_RING_FRAMES);
    expect(ring.bytes).toBe(0);
    ring.dispose();
  });

  it("grows a slot geometrically when a larger write arrives", () => {
    const { device } = setup();
    const ring = new WgpuStagingRing(device);
    const dest = device.createBuffer({ size: BIG * 16, usage: 0x28 });
    ring.write(dest, new Float32Array(BIG));
    for (let i = 0; i < STAGING_RING_FRAMES - 1; i++) {
      ring.write(dest, new Float32Array(BIG));
    }
    ring.write(dest, new Float32Array(BIG * 2));
    expect(ring.allocations).toBe(STAGING_RING_FRAMES + 1);
    expect(ring.bytes).toBe((STAGING_RING_FRAMES - 1) * BIG * 4 + BIG * 8);
  });

  it("falls back to a direct write without copyBufferToBuffer", () => {
    const { device, gpu } = setup();
    const raw = device.createCommandEncoder.bind(device);
    const bare = {
      ...device,
      queue: device.queue,
      createBuffer: device.createBuffer.bind(device),
      createCommandEncoder: () => {
        const enc = raw();
        return { ...enc, copyBufferToBuffer: undefined };
      },
    } as unknown as GpuDevice;
    const ring = new WgpuStagingRing(bare);
    const dest = device.createBuffer({ size: BIG * 4, usage: 0x28 });
    gpu.reset();
    ring.write(dest, new Float32Array(BIG));
    expect(gpu.countOf("queue.writeBuffer")).toBe(1);
    expect(ring.allocations).toBe(0);
  });
});

describe("WgpuGeometryCache dynamic updates (§65)", () => {
  it("reuses buffers across version bumps: no create or destroy", () => {
    const { device, gpu } = setup();
    const cache = new WgpuGeometryCache(device);
    const g = geo(9);
    const first = cache.acquire(g)!;
    gpu.reset();
    for (let i = 1; i <= 5; i++) {
      bump(g, i);
      const next = cache.acquire(g)!;
      expect(next.positionBuffer).toBe(first.positionBuffer);
      expect(next.version).toBe(i);
    }
    expect(gpu.countOf("device.createBuffer")).toBe(0);
    expect(gpu.countOf("buffer.destroy")).toBe(0);
    expect(gpu.countOf("queue.writeBuffer")).toBe(5);
    expect(cache.stagingBytes).toBe(0);
  });

  it("routes large dynamic geometry through the ring, allocating only to warm", () => {
    const { device, gpu } = setup();
    const cache = new WgpuGeometryCache(device);
    const g = geo(BIG);
    cache.acquire(g);
    for (let i = 1; i <= STAGING_RING_FRAMES; i++) {
      bump(g, i);
      cache.acquire(g);
    }
    gpu.reset();
    for (let i = 10; i < 20; i++) {
      bump(g, i);
      cache.acquire(g);
    }
    expect(gpu.countOf("device.createBuffer")).toBe(0);
    expect(gpu.countOf("encoder.copyBufferToBuffer")).toBe(10);
    expect(cache.stagingAllocations).toBe(STAGING_RING_FRAMES);
    expect(cache.stagingBytes).toBe(STAGING_RING_FRAMES * BIG * 4);
    cache.dispose();
    expect(cache.stagingBytes).toBe(0);
  });

  it("reallocates when a stream resizes, vanishes, or the index width changes", () => {
    const { device, gpu } = setup();
    const cache = new WgpuGeometryCache(device);
    const g = geo(9);
    cache.acquire(g);
    (g as { positions: Float32Array }).positions = new Float32Array(18);
    (g as { drawCount: number }).drawCount = 6;
    bump(g, 1);
    gpu.reset();
    cache.acquire(g);
    expect(gpu.countOf("buffer.destroy")).toBe(1);
    expect(gpu.countOf("device.createBuffer")).toBe(1);

    const h = geo(9) as CacheableGeometry & {
      indices?: Uint16Array | Uint32Array;
    };
    h.indices = new Uint16Array(3);
    (h as { drawCount: number }).drawCount = 3;
    cache.acquire(h);
    h.indices = new Uint32Array(2);
    (h as { drawCount: number }).drawCount = 2;
    bump(h, 1);
    gpu.reset();
    cache.acquire(h);
    expect(gpu.countOf("buffer.destroy")).toBe(2);

    const k = geo(9) as CacheableGeometry & { indices?: Uint16Array };
    k.indices = new Uint16Array(4);
    (k as { drawCount: number }).drawCount = 4;
    cache.acquire(k);
    k.indices = undefined;
    (k as { drawCount: number }).drawCount = 3;
    bump(k, 1);
    gpu.reset();
    cache.acquire(k);
    expect(gpu.countOf("buffer.destroy")).toBe(2);
  });
});

describe("WgpuGeometryCache dynamic refresh residues (wave 5)", () => {
  it("refreshes in place: the cached record keeps its identity", () => {
    const { device } = setup();
    const cache = new WgpuGeometryCache(device);
    const g = geo(9);
    const first = cache.acquire(g)!;
    bump(g, 1);
    const second = cache.acquire(g)!;
    expect(second).toBe(first);
    expect(second.version).toBe(1);
  });

  it("binds normals gained in a version bump on the next acquisition", () => {
    const { device, gpu } = setup();
    const cache = new WgpuGeometryCache(device);
    const g = geo(9) as CacheableGeometry & { normals?: Float32Array };
    expect(cache.acquire(g, true)!.normalBuffer).toBeNull();
    g.normals = new Float32Array(9);
    bump(g, 1);
    gpu.reset();
    const record = cache.acquire(g, true)!;
    expect(record.normalBuffer).not.toBeNull();
    expect(gpu.countOf("buffer.destroy")).toBe(0);
    bump(g, 2);
    const again = cache.acquire(g, true)!;
    expect(again.normalBuffer).toBe(record.normalBuffer);
  });

  it("binds an extra morph target gained in a version bump", () => {
    const { device } = setup();
    const cache = new WgpuGeometryCache(device);
    const g = geo(9) as CacheableGeometry & {
      positions1?: Float32Array;
      extraMorphTargets?: { positions: Float32Array }[];
    };
    g.positions1 = new Float32Array(9);
    expect(cache.acquire(g, false, false, true)!.extraMorphBuffers).toEqual([]);
    g.extraMorphTargets = [{ positions: new Float32Array(9) }];
    bump(g, 1);
    const record = cache.acquire(g, false, false, true)!;
    expect(record.extraMorphBuffers[0]).not.toBeNull();
    bump(g, 2);
    cache.acquire(g, false, false, true);
    expect(record.extraMorphBuffers[0]).not.toBeNull();
  });

  it("reallocates when colours appear after the first upload", () => {
    const { device, gpu } = setup();
    const cache = new WgpuGeometryCache(device);
    const g = geo(9) as CacheableGeometry & { colors?: Float32Array };
    cache.acquire(g);
    g.colors = new Float32Array(9);
    bump(g, 1);
    gpu.reset();
    expect(cache.acquire(g)!.colorBuffer).not.toBeNull();
    expect(gpu.countOf("buffer.destroy")).toBe(1);
  });

  it("writes 4-byte-aligned sizes for an odd-length index stream", () => {
    const { device, gpu } = setup();
    const sizes: number[] = [];
    const rawWrite = device.queue.writeBuffer.bind(device.queue);
    device.queue.writeBuffer = (
      buf: never,
      off: number,
      data: ArrayBufferView,
      dOff?: number,
      size?: number,
    ) => {
      sizes.push(size ?? data.byteLength);
      return (rawWrite as (...a: unknown[]) => void)(
        buf,
        off,
        data,
        dOff,
        size,
      );
    };
    const cache = new WgpuGeometryCache(device);
    const g = geo(9) as CacheableGeometry & { indices?: Uint16Array };
    g.indices = new Uint16Array([0, 1, 2]);
    (g as { mode: string }).mode = "lines";
    (g as { drawCount: number }).drawCount = 3;
    cache.acquire(g);
    for (let i = 1; i <= 3; i++) {
      bump(g, i);
      cache.acquire(g);
    }
    expect(sizes.length).toBeGreaterThanOrEqual(5);
    for (const size of sizes) expect(size % 4).toBe(0);
    expect(gpu.countOf("device.createBuffer")).toBe(2);
  });

  it("pads odd writes through the ring and probes copy support once", () => {
    const { device } = setup();
    const sizes: number[] = [];
    const rawWrite = device.queue.writeBuffer.bind(device.queue);
    device.queue.writeBuffer = (
      buf: never,
      off: number,
      data: ArrayBufferView,
      dOff?: number,
      size?: number,
    ) => {
      sizes.push(size ?? data.byteLength);
      return (rawWrite as (...a: unknown[]) => void)(
        buf,
        off,
        data,
        dOff,
        size,
      );
    };
    const ring = new WgpuStagingRing(device);
    const dest = device.createBuffer({ size: BIG * 4 + 4, usage: 0x28 });
    ring.write(dest, new Uint16Array(BIG * 2 + 1));
    expect(sizes).toEqual([BIG * 4 + 4]);

    let encoders = 0;
    const raw = device.createCommandEncoder.bind(device);
    const bare = {
      ...device,
      queue: device.queue,
      createBuffer: device.createBuffer.bind(device),
      createCommandEncoder: () => {
        encoders += 1;
        return { ...raw(), copyBufferToBuffer: undefined };
      },
    } as unknown as GpuDevice;
    const fallback = new WgpuStagingRing(bare);
    fallback.write(dest, new Float32Array(BIG));
    fallback.write(dest, new Float32Array(BIG));
    expect(encoders).toBe(1);
  });
});
