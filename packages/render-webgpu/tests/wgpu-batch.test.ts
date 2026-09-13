/**
 * The §65 uploader in isolation (WP-R1.3): slot lifecycle, growth, device
 * change, loss and disposal — everything `wgpu-batch.ts` owns that the
 * renderer suite only exercises through a whole frame.
 *
 * Hand-built {@link RenderBatch} records drive the buffer paths directly,
 * because the interesting capacities are the *staging array lengths* versus
 * the *used counts* — the planner keeps those apart by design (its arrays grow
 * and stop), and a test that could only reach them through the planner would
 * need contrived scenes to hit each arm. The planner passthrough is tested
 * with the real `RenderBatcher` over item doubles, so `next`'s contract stays
 * the planner's.
 */

import { isFourError } from "@fourjs/core";
import { Matrix4 } from "@fourjs/math";
import type { RenderBatch, RenderItem } from "@fourjs/render";
import { describe, expect, it } from "vitest";

import { createRecordingGpu } from "../../../tests/integration/helpers/recording-gpu.js";
import {
  WgpuBatching,
  createWgpuBatching,
  type GpuDevice,
  type GpuRenderPassEncoder,
} from "../src/index.js";

/** Runs `run`, expecting a `FourError` with `INVALID_APPLICATION_STATE` (§83, §89). */
function expectDisposedError(run: () => void): Error {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(isFourError(caught)).toBe(true);
  expect((caught as { code: string }).code).toBe("INVALID_APPLICATION_STATE");
  return caught as Error;
}

/** A recording device plus one open render pass to record batch draws into. */
function rig(): {
  gpu: ReturnType<typeof createRecordingGpu>;
  device: GpuDevice;
  pass: GpuRenderPassEncoder;
} {
  const gpu = createRecordingGpu();
  const device = gpu.device as GpuDevice;
  const pass = device.createCommandEncoder().beginRenderPass({
    colorAttachments: [{ view: {}, loadOp: "load", storeOp: "store" }],
  });
  gpu.reset();
  return { gpu, device, pass };
}

/** A hand-built batch: `floats`/`indexCount` used, over larger staging arrays. */
function batch(
  overrides: Partial<{
    vertexCount: number;
    floatsPerVertex: number;
    indexCount: number;
    stagingFloats: number;
    stagingIndices: number;
    contentVersion: number;
  }> = {},
): RenderBatch {
  const vertexCount = overrides.vertexCount ?? 4;
  const floatsPerVertex = overrides.floatsPerVertex ?? 3;
  const indexCount = overrides.indexCount ?? 6;
  return {
    kind: "unlit",
    material: { color: [1, 1, 1, 1] } as unknown as RenderBatch["material"],
    texture: null,
    color: [1, 1, 1, 1],
    opacity: 1,
    mode: "triangles",
    clip: null,
    items: 2,
    vertexCount,
    indexCount,
    floatsPerVertex,
    hasUvs: false,
    hasColors: false,
    vertices: new Float32Array(
      overrides.stagingFloats ?? vertexCount * floatsPerVertex,
    ),
    indices: new Uint32Array(overrides.stagingIndices ?? indexCount),
    contentVersion: overrides.contentVersion,
  };
}

/** A batchable unlit render item double — what the planner actually reads. */
function unlitItem(
  material: object,
  positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
): RenderItem {
  return {
    kind: "unlit",
    layers: 1,
    material,
    clip: null,
    frame: null,
    worldMatrix: new Matrix4(),
    geometry: {
      vertexCount: positions.length / 3,
      drawCount: positions.length / 3,
      mode: "triangles",
      positions,
      uvs: undefined,
      colors: undefined,
      indices: undefined,
    },
  } as unknown as RenderItem;
}

describe("WgpuBatching.next — the planner passthrough", () => {
  it("merges a run through the real RenderBatcher, and refuses a run of one", () => {
    const batching = createWgpuBatching();
    const material = { color: [1, 1, 1, 1] };
    const items = [unlitItem(material), unlitItem(material)];
    const merged = batching.next(items, 0);
    expect(merged?.items).toBe(2);
    expect(merged?.vertexCount).toBe(6);
    // The last item alone is not a batch.
    expect(batching.next(items, 1)).toBeNull();
  });

  it("forwards the §46 layer mask, undefined included (R-8's note)", () => {
    const batching = createWgpuBatching({ maxVertices: 4 });
    const material = { color: [1, 1, 1, 1] };
    const items = [unlitItem(material), unlitItem(material)];
    // A mask the items are not on: the run never starts.
    expect(batching.next(items, 0, 2)).toBeNull();
    // The construction option reached the planner too: 3 + 3 > 4 vertices.
    expect(batching.next(items, 0)).toBeNull();
  });
});

describe("WgpuBatching.draw — slots, growth, devices", () => {
  it("gives each batch of a frame its own buffer pair, reused next frame", () => {
    const { gpu, device, pass } = rig();
    const batching = new WgpuBatching();

    batching.beginFrame();
    batching.draw(device, pass, batch());
    batching.draw(device, pass, batch());
    // Two slots, four buffers, and one upload pair plus one draw each.
    expect(gpu.countOf("device.createBuffer")).toBe(4);
    expect(gpu.countOf("queue.writeBuffer")).toBe(4);
    expect(gpu.countOf("pass.drawIndexed")).toBe(2);
    expect(gpu.countOf("pass.setIndexBuffer")).toBe(2);

    batching.beginFrame();
    batching.draw(device, pass, batch());
    batching.draw(device, pass, batch());
    // Frame 2: the same pairs, no allocation at all. Hand-built batches
    // omit contentVersion, so they still re-upload (the still-scene skip
    // needs a non-zero planner stamp).
    expect(gpu.countOf("device.createBuffer")).toBe(4);
    expect(gpu.countOf("queue.writeBuffer")).toBe(8);
  });

  it("skips writeBuffer on a still scene whose contentVersion did not move", () => {
    const { gpu, device, pass } = rig();
    const batching = new WgpuBatching();
    const still = batch({ contentVersion: 7 });

    batching.beginFrame();
    batching.draw(device, pass, still);
    expect(gpu.countOf("queue.writeBuffer")).toBe(2);

    batching.beginFrame();
    batching.draw(device, pass, still);
    expect(gpu.countOf("queue.writeBuffer")).toBe(2);
    expect(gpu.countOf("pass.drawIndexed")).toBe(2);

    batching.beginFrame();
    batching.draw(device, pass, batch({ contentVersion: 8 }));
    expect(gpu.countOf("queue.writeBuffer")).toBe(4);
  });

  it("re-uploads when floatsPerVertex changes under a stable contentVersion", () => {
    const { gpu, device, pass } = rig();
    const batching = new WgpuBatching();
    const positionOnly = batch({
      contentVersion: 7,
      floatsPerVertex: 3,
    });

    batching.beginFrame();
    batching.draw(device, pass, positionOnly);
    expect(gpu.countOf("queue.writeBuffer")).toBe(2);

    batching.beginFrame();
    batching.draw(
      device,
      pass,
      batch({
        contentVersion: 7,
        vertexCount: 4,
        indexCount: 6,
        floatsPerVertex: 5,
      }),
    );
    expect(gpu.countOf("queue.writeBuffer")).toBe(4);
    const uploads = gpu.callsOf("queue.writeBuffer");
    expect(uploads[2]?.args[4]).toBe(20);

    batching.beginFrame();
    batching.draw(
      device,
      pass,
      batch({
        contentVersion: 7,
        vertexCount: 4,
        indexCount: 6,
        floatsPerVertex: 5,
      }),
    );
    expect(gpu.countOf("queue.writeBuffer")).toBe(4);
  });

  it("uploads exactly the used floats and indices, not the staging arrays", () => {
    const { gpu, device, pass } = rig();
    const batching = new WgpuBatching();
    batching.beginFrame();
    batching.draw(
      device,
      pass,
      batch({
        vertexCount: 4,
        floatsPerVertex: 5,
        indexCount: 6,
        stagingFloats: 1024,
        stagingIndices: 512,
      }),
    );
    const uploads = gpu.callsOf("queue.writeBuffer");
    // The five-argument element-counted form: offset 0, 20 floats / 6 indices.
    expect(uploads[0]?.args[3]).toBe(0);
    expect(uploads[0]?.args[4]).toBe(20);
    expect(uploads[1]?.args[4]).toBe(6);
    // The allocations took the staging arrays' sizes — the `bufferData` shape.
    const sizes = gpu
      .callsOf("device.createBuffer")
      .map((call) => (call.args[0] as { size: number }).size);
    expect(sizes).toEqual([4096, 2048]);
    expect(gpu.callsOf("pass.drawIndexed")[0]?.args[0]).toBe(6);
  });

  it("regrows the vertex buffer alone when only the vertices outgrew it", () => {
    const { gpu, device, pass } = rig();
    const batching = new WgpuBatching();
    batching.beginFrame();
    batching.draw(device, pass, batch({ vertexCount: 4 }));
    gpu.reset();

    batching.beginFrame();
    batching.draw(device, pass, batch({ vertexCount: 8 }));
    // One destroy, one create — the index pair fit and stayed.
    expect(gpu.countOf("buffer.destroy")).toBe(1);
    expect(gpu.countOf("device.createBuffer")).toBe(1);
    expect(
      (gpu.callsOf("device.createBuffer")[0]?.args[0] as { label: string })
        .label,
    ).toContain("batch-vertices");
  });

  it("regrows the index buffer alone when only the indices outgrew it", () => {
    const { gpu, device, pass } = rig();
    const batching = new WgpuBatching();
    batching.beginFrame();
    batching.draw(device, pass, batch({ indexCount: 6 }));
    gpu.reset();

    batching.beginFrame();
    batching.draw(device, pass, batch({ indexCount: 12 }));
    expect(gpu.countOf("buffer.destroy")).toBe(1);
    expect(
      (gpu.callsOf("device.createBuffer")[0]?.args[0] as { label: string })
        .label,
    ).toContain("batch-indices");
  });

  it("starts a fresh pool on a new device, dropping the old handles", () => {
    const first = rig();
    const batching = new WgpuBatching();
    batching.beginFrame();
    batching.draw(first.device, first.pass, batch());

    const second = rig();
    batching.beginFrame();
    batching.draw(second.device, second.pass, batch());
    // Nothing destroyed on either tape: the old handles belong to a device
    // that is gone, exactly as `forget` treats them.
    expect(first.gpu.countOf("buffer.destroy")).toBe(0);
    expect(second.gpu.countOf("device.createBuffer")).toBe(2);
  });
});

describe("WgpuBatching lifecycle (§61, §83)", () => {
  it("forget drops the pool without touching the device", () => {
    const { gpu, device, pass } = rig();
    const batching = new WgpuBatching();
    batching.beginFrame();
    batching.draw(device, pass, batch());
    gpu.reset();

    batching.forget();
    expect(gpu.calls).toHaveLength(0);
    // The next draw re-allocates against whatever device arrives.
    batching.beginFrame();
    batching.draw(device, pass, batch());
    expect(gpu.countOf("device.createBuffer")).toBe(2);
  });

  it("dispose destroys every slot's pair on a live device", () => {
    const { gpu, device, pass } = rig();
    const batching = new WgpuBatching();
    batching.beginFrame();
    batching.draw(device, pass, batch());
    batching.draw(device, pass, batch());
    gpu.reset();

    batching.dispose();
    expect(gpu.countOf("buffer.destroy")).toBe(4);
  });

  it("dispose on a pool that never drew destroys nothing", () => {
    const batching = new WgpuBatching();
    expect(() => {
      batching.dispose();
    }).not.toThrow();
  });
});

describe("WgpuBatching disposal (§83 stability audit, 2026-09-11)", () => {
  it("disposes idempotently and refuses per-frame entry points afterwards", () => {
    const { gpu, device, pass } = rig();
    const batching = new WgpuBatching();
    expect(batching.disposed).toBe(false);
    batching.beginFrame();
    batching.draw(device, pass, batch());
    expect(gpu.countOf("device.createBuffer")).toBe(2);

    batching.dispose();
    expect(batching.disposed).toBe(true);
    expect(gpu.countOf("buffer.destroy")).toBe(2);
    // A second dispose is a no-op (§83: idempotent): nothing is destroyed twice.
    expect(() => batching.dispose()).not.toThrow();
    expect(gpu.countOf("buffer.destroy")).toBe(2);
    expect(batching.disposed).toBe(true);

    // Disposal is terminal (§83): the per-frame entry points refuse with §89's
    // INVALID_APPLICATION_STATE rather than silently recreating a pool.
    expect(expectDisposedError(() => batching.beginFrame()).message).toMatch(
      /WgpuBatching is disposed.*§83/s,
    );
    expectDisposedError(() => batching.draw(device, pass, batch()));
    expect(gpu.countOf("device.createBuffer")).toBe(2);
  });
});
