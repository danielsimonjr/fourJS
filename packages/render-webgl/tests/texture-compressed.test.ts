import { Texture } from "@fourjs/render";
import { describe, expect, it, vi } from "vitest";

import { TextureCache, queryCompressedFormats } from "../src/gl-texture.js";
import { createRecordingGl } from "../../../tests/integration/helpers/recording-gl.js";

function setup(extensions: readonly string[] | "none") {
  const { gl } = createRecordingGl();
  const compressed = vi.fn();
  if (extensions !== "none") {
    (gl as unknown as { compressedTexImage2D: unknown }).compressedTexImage2D =
      compressed;
    gl.getExtension = (name: string) => (extensions.includes(name) ? {} : null);
  }
  return { gl, compressed };
}
const source = (
  format: "bc7-rgba-unorm" | "etc2-rgba8unorm" | "astc-4x4-unorm",
  extra = {},
) => ({
  width: 8,
  height: 8,
  format,
  levels: [new Uint8Array(64), new Uint8Array(16)],
  ...extra,
});

describe("compressed GL uploads (§77, R-30c)", () => {
  it("probes the extensions lazily and reports engine names", () => {
    expect(queryCompressedFormats(setup("none").gl)).toEqual([]);
    const { gl } = setup([
      "WEBGL_compressed_texture_etc",
      "WEBGL_compressed_texture_astc",
    ]);
    expect(queryCompressedFormats(gl)).toEqual([
      "etc2-rgba8unorm",
      "astc-4x4-unorm",
    ]);
  });

  it("uploads each level with compressedTexImage2D and the sRGB enum", () => {
    const { gl, compressed } = setup(["EXT_texture_compression_bptc"]);
    const texImage = vi.spyOn(gl, "texImage2D");
    const mip = vi.fn();
    gl.generateMipmap = mip;
    const cache = new TextureCache(gl);
    const t = new Texture(
      source("bc7-rgba-unorm", {
        colorSpace: "srgb",
        minFilter: "linear-mipmap-linear",
      }),
    );
    cache.acquire(t);
    expect(compressed).toHaveBeenCalledTimes(2);
    expect(compressed.mock.calls[0].slice(0, 6)).toEqual([
      0x0de1, 0, 0x8e8d, 8, 8, 0,
    ]);
    expect(compressed.mock.calls[1].slice(0, 6)).toEqual([
      0x0de1, 1, 0x8e8d, 4, 4, 0,
    ]);
    expect(texImage).not.toHaveBeenCalled();
    expect(mip).not.toHaveBeenCalled();
    t.dispose();
    const linear = new Texture(source("astc-4x4-unorm"));
    const { gl: gl2, compressed: c2 } = setup([
      "WEBGL_compressed_texture_astc",
    ]);
    new TextureCache(gl2).acquire(linear);
    expect(c2.mock.calls[0][2]).toBe(0x93b0);
    linear.dispose();
  });

  it("allocates zero-filled RGBA8 when the extension is missing", () => {
    for (const mode of ["none", []] as const) {
      const { gl, compressed } = setup(mode);
      const texImage = vi.spyOn(gl, "texImage2D");
      const t = new Texture(source("etc2-rgba8unorm"));
      new TextureCache(gl).acquire(t);
      expect(compressed).not.toHaveBeenCalled();
      expect(texImage).toHaveBeenCalledTimes(1);
      expect(texImage.mock.calls[0][8]).toBeNull();
      t.dispose();
    }
  });
});

describe("compressed GL diagnostics and probing", () => {
  it("warns once naming the format and extension when it is missing", async () => {
    const { resetDevWarnings } = await import("@fourjs/core");
    resetDevWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { gl } = setup([]);
    const cache = new TextureCache(gl);
    for (let i = 0; i < 2; i++) {
      cache.acquire(new Texture(source("etc2-rgba8unorm")));
    }
    const hits = warn.mock.calls.filter((c) =>
      String(c[0]).includes("WEBGL_compressed_texture_etc"),
    );
    expect(hits).toHaveLength(1);
    expect(String(hits[0][0])).toContain("etc2-rgba8unorm");
    warn.mockRestore();
    resetDevWarnings();
  });

  it("probes extensions once per context across uploads", () => {
    const { gl } = setup(["WEBGL_compressed_texture_etc"]);
    const probe = vi.spyOn(gl, "getExtension");
    const cache = new TextureCache(gl);
    cache.acquire(new Texture(source("etc2-rgba8unorm")));
    const after = probe.mock.calls.length;
    cache.acquire(new Texture(source("etc2-rgba8unorm")));
    expect(probe.mock.calls.length).toBe(after);
  });
});
