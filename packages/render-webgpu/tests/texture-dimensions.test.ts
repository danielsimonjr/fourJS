import { Texture } from "@fourjs/render";
import { describe, expect, it } from "vitest";

import {
  WgpuTextureCache,
  downsampleVolume,
  mipLevelCount,
  textureByteLength,
} from "../src/wgpu-texture.js";
import { createRecordingGpu } from "../../../tests/integration/helpers/recording-gpu.js";

const setup = () => {
  const gpu = createRecordingGpu();
  return { gpu, cache: new WgpuTextureCache(gpu.device!) };
};

describe("cube / array / 3D WebGPU uploads (§77, R-30c)", () => {
  it("allocates a six-layer 2D texture, one write, and a cube view + layout", () => {
    const { gpu, cache } = setup();
    const t = new Texture({
      width: 2,
      height: 2,
      dimension: "cube",
      data: new Uint8Array(96),
    });
    const record = cache.acquireResource(t)!;
    expect(record.dimension).toBe("cube");
    expect(record.depth).toBe(6);
    expect(record.byteLength).toBe(96);
    expect(cache.byteLength).toBe(96);
    expect(gpu.callsOf("device.createTexture")[0].args[0]).toMatchObject({
      size: [2, 2, 6],
    });
    expect(gpu.callsOf("queue.writeTexture")[0].args[3]).toEqual([2, 2, 6]);
    expect(gpu.callsOf("texture.createView")[0].args[1]).toEqual({
      dimension: "cube",
    });
    expect(
      gpu.callsOf("device.createBindGroupLayout").at(-1)!.args[0],
    ).toMatchObject({ entries: [{ texture: { viewDimension: "cube" } }, {}] });
    // the 2D draw path refuses it
    expect(cache.acquire(t)).toBeNull();
    t.dispose();
    cache.dispose();
  });

  it("array layers get a 2d-array view, and mips are blitted per layer", () => {
    const { gpu, cache } = setup();
    const t = new Texture({
      width: 4,
      height: 4,
      dimension: "array",
      depth: 3,
      data: new Uint8Array(4 * 4 * 3 * 4),
      mipmaps: true,
    });
    const record = cache.acquireResource(t)!;
    expect(record.levels).toBe(3);
    expect(record.byteLength).toBe(252);
    expect(gpu.callsOf("device.createTexture")[0].args[0]).toMatchObject({
      size: [4, 4, 3],
      mipLevelCount: 3,
    });
    // 2 levels x 3 layers = 6 blit passes
    expect(gpu.countOf("encoder.beginRenderPass")).toBe(6);
    const views = gpu.callsOf("texture.createView").map((c) => c.args[1]);
    expect(views).toContainEqual({
      label: "fourJS:mip-target:1",
      baseMipLevel: 1,
      mipLevelCount: 1,
      dimension: "2d",
      baseArrayLayer: 2,
      arrayLayerCount: 1,
    });
    expect(views).toContainEqual({ dimension: "2d-array" });
    t.dispose();
    cache.dispose();
  });

  it("volumes allocate dimension 3d and write CPU-filtered mip levels", () => {
    const { gpu, cache } = setup();
    const data = new Uint8Array(2 * 2 * 2 * 4).fill(200);
    const t = new Texture({
      width: 2,
      height: 2,
      dimension: "3d",
      depth: 2,
      data,
      mipmaps: true,
    });
    const record = cache.acquireResource(t)!;
    expect(record.levels).toBe(2);
    expect(record.byteLength).toBe(36);
    expect(gpu.callsOf("device.createTexture")[0].args[0]).toMatchObject({
      dimension: "3d",
      size: [2, 2, 2],
    });
    const writes = gpu.callsOf("queue.writeTexture");
    expect(writes).toHaveLength(2);
    expect(writes[1].args[0]).toMatchObject({ mipLevel: 1 });
    expect(Array.from(writes[1].args[1] as Uint8Array)).toEqual([
      200, 200, 200, 200,
    ]);
    expect(writes[1].args[3]).toEqual([1, 1, 1]);
    expect(gpu.countOf("encoder.beginRenderPass")).toBe(0);
    expect(gpu.callsOf("texture.createView").at(-1)!.args[1]).toEqual({
      dimension: "3d",
    });
    t.dispose();
    cache.dispose();
  });

  it("data-less textures allocate without writing, even with mips", () => {
    const { gpu, cache } = setup();
    for (const dimension of ["array", "3d"] as const) {
      const t = new Texture({
        width: 2,
        height: 2,
        dimension,
        depth: 2,
        mipmaps: true,
      });
      cache.acquireResource(t);
      t.dispose();
    }
    expect(gpu.countOf("queue.writeTexture")).toBe(0);
    expect(gpu.countOf("encoder.beginRenderPass")).toBe(0);
  });

  it("replaces the allocation on markDirty, reuses layouts, async-prepares, destroys", async () => {
    const { gpu, cache } = setup();
    const t = new Texture({
      width: 1,
      height: 1,
      dimension: "cube",
      data: new Uint8Array(24),
    });
    const first = cache.acquireResource(t)!;
    expect(cache.acquireResource(t)).toBe(first);
    t.markDirty();
    const second = cache.acquireResource(t)!;
    expect(second.texture).not.toBe(first.texture);
    expect(cache.byteLength).toBe(24);
    const other = new Texture({ width: 1, height: 1, dimension: "cube" });
    cache.acquireResource(other);
    expect(
      gpu
        .callsOf("device.createBindGroupLayout")
        .filter((c) => JSON.stringify(c.args).includes("cube")),
    ).toHaveLength(1);
    gpu.device!.queue.onSubmittedWorkDone = () => Promise.resolve();
    expect(await cache.acquireAsync(other)).not.toBeNull();
    cache.forget();
    expect(cache.byteLength).toBe(0);
    t.dispose();
    other.dispose();
  });

  it("sizes chains exactly", () => {
    expect(mipLevelCount(4, 4, 8)).toBe(4);
    expect(textureByteLength(4, 4, true, 4, true)).toBe(292);
    expect(textureByteLength(4, 4, true, 3, false)).toBe(252);
    const odd = downsampleVolume(
      new Uint8Array(3 * 1 * 3 * 4).fill(8),
      3,
      1,
      3,
    );
    expect([odd.w, odd.h, odd.d]).toEqual([1, 1, 1]);
    expect(Array.from(odd.data)).toEqual([8, 8, 8, 8]);
  });
});
