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
      g.version = i;
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
      g.version = i;
      cache.acquire(g);
    }
    gpu.reset();
    for (let i = 10; i < 20; i++) {
      g.version = i;
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
    g.version = 1;
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
    h.version = 1;
    gpu.reset();
    cache.acquire(h);
    expect(gpu.countOf("buffer.destroy")).toBe(2);

    const k = geo(9) as CacheableGeometry & { indices?: Uint16Array };
    k.indices = new Uint16Array(4);
    (k as { drawCount: number }).drawCount = 4;
    cache.acquire(k);
    k.indices = undefined;
    (k as { drawCount: number }).drawCount = 3;
    k.version = 1;
    gpu.reset();
    cache.acquire(k);
    expect(gpu.countOf("buffer.destroy")).toBe(2);
  });
});
