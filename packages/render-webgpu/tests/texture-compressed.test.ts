import { Texture } from "@fourjs/render";
import { describe, expect, it } from "vitest";

import {
  WgpuTextureCache,
  supportedCompressedFormats,
} from "../src/wgpu-texture.js";
import { createRecordingGpu } from "../../../tests/integration/helpers/recording-gpu.js";

const source = (
  format: "bc7-rgba-unorm" | "etc2-rgba8unorm" | "astc-4x4-unorm",
  extra = {},
) => ({
  width: 8,
  height: 8,
  format,
  levels: [new Uint8Array(64).fill(1), new Uint8Array(16).fill(2)],
  ...extra,
});

describe("compressed WebGPU uploads (§77, R-30c)", () => {
  it("reports supported engine formats from device features", () => {
    expect(supportedCompressedFormats(undefined)).toEqual([]);
    expect(
      supportedCompressedFormats({
        has: (n) => n !== "texture-compression-etc2",
      }),
    ).toEqual(["bc7-rgba-unorm", "astc-4x4-unorm"]);
  });

  it("writes each level with block-row pitch when the feature is present", () => {
    const gpu = createRecordingGpu({ features: ["texture-compression-bc"] });
    const cache = new WgpuTextureCache(gpu.device!);
    const t = new Texture(source("bc7-rgba-unorm", { colorSpace: "srgb" }));
    const record = cache.acquire(t)!;
    expect(record.levels).toBe(2);
    expect(record.byteLength).toBe(80);
    expect(gpu.callsOf("device.createTexture")[0].args[0]).toMatchObject({
      size: [8, 8],
      format: "bc7-rgba-unorm-srgb",
      mipLevelCount: 2,
    });
    const writes = gpu.callsOf("queue.writeTexture");
    expect(writes).toHaveLength(2);
    expect(writes[0].args[2]).toMatchObject({
      bytesPerRow: 32,
      rowsPerImage: 2,
    });
    expect(writes[0].args[3]).toEqual([8, 8]);
    expect(writes[1].args[0]).toMatchObject({ mipLevel: 1 });
    expect(writes[1].args[3]).toEqual([4, 4]);
    expect(gpu.countOf("encoder.beginRenderPass")).toBe(0);
    t.dispose();
    cache.dispose();
  });

  it("falls back to zero-filled rgba8 storage without the feature", () => {
    const gpu = createRecordingGpu({ features: [] });
    const cache = new WgpuTextureCache(gpu.device!);
    const t = new Texture(source("etc2-rgba8unorm"));
    const record = cache.acquire(t)!;
    expect(gpu.callsOf("device.createTexture")[0].args[0]).toMatchObject({
      format: "rgba8unorm",
    });
    expect(gpu.countOf("queue.writeTexture")).toBe(0);
    expect(record.byteLength).toBe(340); // zero-filled full chain
    t.dispose();
    cache.dispose();
  });
});
