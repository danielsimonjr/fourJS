import { Texture } from "@fourjs/render";
import { describe, expect, it, vi } from "vitest";

import { GL, type WebglContext } from "../src/gl-program.js";
import { TextureCache } from "../src/gl-texture.js";
import { createRecordingGl } from "../../../tests/integration/helpers/recording-gl.js";

function withTexImage3D() {
  const { gl } = createRecordingGl();
  const image3d = vi.fn<NonNullable<WebglContext["texImage3D"]>>();
  const image2d = vi.spyOn(gl, "texImage2D");
  const params = vi.spyOn(gl, "texParameteri");
  const mip = vi.fn();
  gl.texImage3D = image3d;
  gl.generateMipmap = mip;
  return { gl, image3d, image2d, params, mip };
}

describe("cube / array / 3D GL uploads (§77, R-30c)", () => {
  it("uploads six cube faces to their own targets, sliced from one array", () => {
    const { gl, image2d, params, mip } = withTexImage3D();
    const cache = new TextureCache(gl);
    const data = Uint8Array.from({ length: 2 * 2 * 6 * 4 }, (_, i) => i);
    const t = new Texture({
      width: 2,
      height: 2,
      dimension: "cube",
      data,
      mipmaps: true,
      wrap: "repeat",
    });
    const record = cache.acquireResource(t)!;
    expect(record.target).toBe(GL.TEXTURE_CUBE_MAP);
    expect(image2d).toHaveBeenCalledTimes(6);
    for (let face = 0; face < 6; face += 1) {
      const call = image2d.mock.calls[face];
      expect(call[0]).toBe(GL.TEXTURE_CUBE_MAP_POSITIVE_X + face);
      expect(Array.from(call[8] as Uint8Array)).toEqual(
        Array.from(data.subarray(face * 16, face * 16 + 16)),
      );
    }
    expect(mip).toHaveBeenCalledWith(GL.TEXTURE_CUBE_MAP);
    const names = params.mock.calls.map((c) => [c[0], c[1]]);
    expect(names).toContainEqual([GL.TEXTURE_CUBE_MAP, GL.TEXTURE_WRAP_R]);
    // the 2D draw path never sees it
    expect(cache.acquire(t)).toBeNull();
    t.dispose();
  });

  it("uploads a data-less cube as six null faces", () => {
    const { gl, image2d } = withTexImage3D();
    const cache = new TextureCache(gl);
    const t = new Texture({ width: 1, height: 1, dimension: "cube" });
    cache.acquireResource(t);
    expect(image2d.mock.calls.every((c) => c[8] === null)).toBe(true);
    t.dispose();
  });

  it("uploads array layers and 3D slices with texImage3D", () => {
    const { gl, image3d, params, mip } = withTexImage3D();
    const cache = new TextureCache(gl);
    const arr = new Texture({
      width: 2,
      height: 2,
      dimension: "array",
      depth: 3,
      data: new Uint8Array(48),
      colorSpace: "srgb",
      mipmaps: true,
    });
    const rec = cache.acquireResource(arr)!;
    expect(rec.target).toBe(GL.TEXTURE_2D_ARRAY);
    expect(image3d.mock.calls[0].slice(0, 7)).toEqual([
      GL.TEXTURE_2D_ARRAY,
      0,
      GL.SRGB8_ALPHA8,
      2,
      2,
      3,
      0,
    ]);
    expect(mip).toHaveBeenCalledWith(GL.TEXTURE_2D_ARRAY);
    const vol = new Texture({
      width: 2,
      height: 2,
      dimension: "3d",
      depth: 4,
      anisotropy: 1,
    });
    const vrec = cache.acquireResource(vol)!;
    expect(vrec.target).toBe(GL.TEXTURE_3D);
    expect(image3d.mock.calls[1][5]).toBe(4);
    expect(image3d.mock.calls[1][9]).toBeNull();
    const wr = params.mock.calls.filter((c) => c[1] === GL.TEXTURE_WRAP_R);
    expect(wr.map((c) => c[0])).toEqual([GL.TEXTURE_3D]);
    expect(cache.size).toBe(2);
    arr.dispose();
    vol.dispose();
  });

  it("re-uploads whole on markDirty, replaces the object, and deletes on dispose", () => {
    const { gl, image3d } = withTexImage3D();
    const del = vi.spyOn(gl, "deleteTexture");
    const cache = new TextureCache(gl);
    const t = new Texture({
      width: 1,
      height: 1,
      dimension: "array",
      depth: 2,
      data: new Uint8Array(8),
    });
    const first = cache.acquireResource(t)!;
    expect(cache.acquireResource(t)).toBe(first);
    t.markDirty();
    const second = cache.acquireResource(t)!;
    expect(second.texture).not.toBe(first.texture);
    expect(image3d).toHaveBeenCalledTimes(2);
    expect(del).toHaveBeenCalledWith(first.texture);
    t.dispose();
    expect(cache.acquireResource(t)).toBeNull();
    cache.acquireResource(
      new Texture({ width: 1, height: 1, dimension: "3d", depth: 1 }),
    );
    cache.dispose();
    expect(del).toHaveBeenCalledTimes(3);
    expect(cache.acquireResource(t)).toBeNull();
  });

  it("skips array/3D without texImage3D and deletes the stray handle", () => {
    const { gl } = createRecordingGl();
    const del = vi.spyOn(gl, "deleteTexture");
    const cache = new TextureCache(gl);
    const t = new Texture({ width: 1, height: 1, dimension: "3d", depth: 2 });
    expect(cache.acquireResource(t)).toBeNull();
    expect(del).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0);
    t.dispose();
  });

  it("prepares non-2d textures through acquireAsync", async () => {
    const { gl } = withTexImage3D();
    gl.fenceSync = () => ({});
    gl.clientWaitSync = () => 0x911a;
    gl.deleteSync = () => undefined;
    const cache = new TextureCache(gl);
    const t = new Texture({ width: 1, height: 1, dimension: "cube" });
    const rec = await cache.acquireAsync(t);
    expect(rec?.target).toBe(GL.TEXTURE_CUBE_MAP);
    t.dispose();
  });
});
