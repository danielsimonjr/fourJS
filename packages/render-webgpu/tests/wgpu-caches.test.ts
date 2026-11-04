/**
 * The three pieces the renderer is assembled from, tested directly: the
 * lazy pipeline cache and its canonical key, the geometry cache, and the
 * WGSL/bind-group-layout pair that RFC 0001 will one day target.
 *
 * They are exported from `src/index.ts` for exactly this reason — the same
 * argument `@fourjs/render-webgl` makes for exporting `GL`, `UnlitProgram` and
 * `GeometryCache`: a seam a test can reach is a seam a failure can be localised
 * to.
 */

import { Texture } from "@fourjs/render";
import { resetDevWarnings } from "@fourjs/core";
import { describe, expect, it, vi } from "vitest";

import { createRecordingGpu } from "../../../tests/integration/helpers/recording-gpu.js";
import {
  CLEAR_SHADER_SOURCE,
  COLOR_SHADER_LOCATION,
  SPRITE_SHADER_SOURCE,
  SPRITE_TINT_OFFSET,
  SPRITE_UNIFORM_BYTES,
  SPRITE_UNIFORM_WGSL,
  batchVertexBufferLayout,
  createSpriteBindGroupLayout,
  createTextureBindGroupLayout,
  DRAW_COLOR_OFFSET,
  DRAW_MODEL_OFFSET,
  DRAW_NORMAL_OFFSET,
  DRAW_UNIFORM_BYTES,
  DRAW_UNIFORM_FLOATS,
  DRAW_UNIFORM_WGSL,
  DRAW_VIEW_PROJECTION_OFFSET,
  GPU_BUFFER_USAGE,
  GPU_TEXTURE_USAGE,
  MAP_BINDING_WGSL,
  MAP_SAMPLER_BINDING,
  MAP_TEXTURE_BINDING,
  MIPMAP_SHADER_SOURCE,
  PARTICLE_SHADER_SOURCE,
  PARTICLE_VERTEX_BUFFER_LAYOUTS,
  POSITION_SHADER_LOCATION,
  UNIFORM_STRIDE_BYTES,
  UV_SHADER_LOCATION,
  WgpuGeometryCache,
  WgpuPipelineCache,
  WgpuTextureCache,
  createDrawBindGroupLayout,
  createParticleBindGroupLayout,
  mipLevelCount,
  pipelineKey,
  samplerKey,
  textureByteLength,
  unlitShaderSource,
  unlitVertexBufferLayouts,
  type CacheableGeometry,
  type GpuDevice,
  type WgpuCacheableTexture,
  type WgpuPipelineDescriptor,
  type WgpuStencilDescriptor,
} from "../src/index.js";

/** A device to build caches over; `device` is non-null for the default options. */
function device(): {
  device: GpuDevice;
  gpu: ReturnType<typeof createRecordingGpu>;
} {
  const gpu = createRecordingGpu();
  return { device: gpu.device as GpuDevice, gpu };
}

const BASE: WgpuPipelineDescriptor = {
  kind: "unlit",
  vertexColors: false,
  map: false,
  blend: "none",
  depthTest: true,
  depthWrite: true,
  colorWrite: true,
  topology: "triangle-list",
  colorFormat: "bgra8unorm",
  depthFormat: "depth24plus",
};

let nextId = 0;

/** A §53 geometry double, exactly the shape `RenderItem["geometry"]` has. */
function geometry(
  overrides: Partial<{
    positions: Float32Array;
    colors: Float32Array;
    indices: Uint16Array | Uint32Array;
    mode: "triangles" | "lines";
    version: number;
  }> = {},
): CacheableGeometry {
  nextId += 1;
  const positions =
    overrides.positions ?? new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = overrides.indices;
  return {
    id: `geometry-${String(nextId)}`,
    version: overrides.version ?? 0,
    positions,
    colors: overrides.colors,
    indices,
    mode: overrides.mode ?? "triangles",
    drawCount: indices === undefined ? positions.length / 3 : indices.length,
  } as unknown as CacheableGeometry;
}

/** A §77 texture double, exactly the `MaterialTexture` read contract. */
function texture(
  overrides: Partial<{
    width: number;
    height: number;
    data: Uint8Array | null;
    version: number;
    disposed: boolean;
    colorSpace: "linear" | "srgb";
    filter: "nearest" | "linear";
    wrap: "clamp-to-edge" | "repeat" | "mirrored-repeat";
    mipmaps: boolean;
    minFilter: string;
    anisotropy: number;
  }> = {},
): WgpuCacheableTexture {
  nextId += 1;
  const width = overrides.width ?? 2;
  const height = overrides.height ?? 2;
  return {
    id: `texture-${String(nextId)}`,
    version: overrides.version ?? 0,
    width,
    height,
    data:
      "data" in overrides ? overrides.data : new Uint8Array(width * height * 4),
    disposed: overrides.disposed ?? false,
    colorSpace: overrides.colorSpace,
    filter: overrides.filter,
    wrap: overrides.wrap,
    mipmaps: overrides.mipmaps,
    minFilter: overrides.minFilter,
    anisotropy: overrides.anisotropy,
  } as unknown as WgpuCacheableTexture;
}

describe("pipelineKey", () => {
  it("is a total, canonical function of the descriptor", () => {
    expect(pipelineKey(BASE)).toBe(
      "unlit|-|-|none|dt|dw|cw|triangle-list|bgra8unorm|depth24plus",
    );
    expect(pipelineKey({ ...BASE, vertexColors: true })).toContain("|vc|");
    expect(pipelineKey({ ...BASE, map: true })).toContain("|map|");
    expect(pipelineKey({ ...BASE, depthFormat: null })).toMatch(/\|-$/u);
    expect(pipelineKey({ ...BASE, metalRoughness: true })).toMatch(/\|mr:y$/u);
    expect(pipelineKey(BASE)).not.toContain("|mr:y");
    expect(pipelineKey({ ...BASE, metalRoughness: false })).toBe(
      pipelineKey(BASE),
    );
  });

  it("separates every field that a pipeline bakes in", () => {
    const keys = new Set<string>();
    for (const descriptor of [
      BASE,
      { ...BASE, kind: "clear" as const },
      { ...BASE, vertexColors: true },
      { ...BASE, map: true },
      { ...BASE, blend: "normal" as const },
      { ...BASE, blend: "additive" as const },
      { ...BASE, blend: "multiply" as const },
      { ...BASE, blend: "screen" as const },
      { ...BASE, depthTest: false },
      { ...BASE, depthWrite: false },
      { ...BASE, colorWrite: false },
      { ...BASE, topology: "line-list" as const },
      { ...BASE, colorFormat: "rgba8unorm" },
      { ...BASE, depthFormat: null },
    ]) {
      keys.add(pipelineKey(descriptor));
    }
    expect(keys.size).toBe(14);
  });

  it("is stable across two structurally identical descriptors", () => {
    // The §33 hazard the string key exists for: two objects, one key.
    expect(pipelineKey({ ...BASE })).toBe(pipelineKey({ ...BASE }));
  });
});

describe("WgpuPipelineCache", () => {
  it("creates a pipeline on first use and reuses it after", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
    );
    gpu.reset();

    const first = cache.acquire(BASE);
    expect(gpu.countOf("device.createRenderPipeline")).toBe(1);
    expect(cache.acquire(BASE)).toBe(first);
    expect(gpu.countOf("device.createRenderPipeline")).toBe(1);
    expect(cache.size).toBe(1);
  });

  it("shares one WGSL module across a variant's pipelines", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
    );
    gpu.reset();

    cache.acquire(BASE);
    cache.acquire({ ...BASE, blend: "additive" });
    cache.acquire({ ...BASE, depthWrite: false });
    expect(gpu.countOf("device.createRenderPipeline")).toBe(3);
    expect(cache.moduleCount).toBe(1);

    cache.acquire({ ...BASE, vertexColors: true });
    cache.acquire({ ...BASE, kind: "clear" });
    expect(cache.moduleCount).toBe(3);
  });

  it("gives every §57 blend mode its WebGPU factors", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
    );
    for (const blend of ["normal", "additive", "multiply", "screen"] as const) {
      cache.acquire({ ...BASE, blend });
    }
    const blends = gpu.callsOf("device.createRenderPipeline").map(
      (call) =>
        (
          call.args[0] as {
            fragment: {
              targets: {
                blend?: { color: { srcFactor: string; dstFactor: string } };
              }[];
            };
          }
        ).fragment.targets[0]?.blend?.color,
    );
    expect(blends).toEqual([
      {
        srcFactor: "src-alpha",
        dstFactor: "one-minus-src-alpha",
        operation: "add",
      },
      { srcFactor: "src-alpha", dstFactor: "one", operation: "add" },
      { srcFactor: "dst", dstFactor: "zero", operation: "add" },
      { srcFactor: "one", dstFactor: "one-minus-src", operation: "add" },
    ]);
  });

  it("declares no blend at all for an opaque draw", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
    );
    cache.acquire(BASE);
    const descriptor = gpu.callsOf("device.createRenderPipeline")[0]
      ?.args[0] as { fragment: { targets: Record<string, unknown>[] } };
    expect(descriptor.fragment.targets[0]).not.toHaveProperty("blend");
  });

  it("maps §57's depthTest onto a comparison, never onto a missing state", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
    );
    cache.acquire(BASE);
    cache.acquire({ ...BASE, depthTest: false });
    const compares = gpu
      .callsOf("device.createRenderPipeline")
      .map(
        (call) =>
          (call.args[0] as { depthStencil?: { depthCompare: string } })
            .depthStencil?.depthCompare,
      );
    expect(compares).toEqual(["less", "always"]);
  });

  it("omits the depth state for a pass with no depth attachment", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
    );
    cache.acquire({ ...BASE, depthFormat: null });
    expect(
      gpu.callsOf("device.createRenderPipeline")[0]?.args[0],
    ).not.toHaveProperty("depthStencil");
  });

  it("gives the clear pipeline no vertex buffers", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
    );
    cache.acquire({ ...BASE, kind: "clear" });
    const descriptor = gpu.callsOf("device.createRenderPipeline")[0]
      ?.args[0] as { vertex: { buffers: unknown[] } };
    expect(descriptor.vertex.buffers).toEqual([]);
  });

  it("uses an explicit pipeline layout, never `auto` (§7's RFC-0001 debt)", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
    );
    cache.acquire(BASE);
    const descriptor = gpu.callsOf("device.createRenderPipeline")[0]
      ?.args[0] as { layout: unknown };
    expect(descriptor.layout).not.toBe("auto");
    expect(gpu.countOf("device.createPipelineLayout")).toBe(1);
  });

  it("returns null once disposed, and disposal is idempotent", () => {
    const { device: gpuDevice } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
    );
    cache.acquire(BASE);
    cache.dispose();
    cache.dispose();
    expect(cache.disposed).toBe(true);
    expect(cache.size).toBe(0);
    expect(cache.moduleCount).toBe(0);
    expect(cache.acquire(BASE)).toBeNull();
  });

  it("answers null for a textured descriptor when built without a texture layout", () => {
    // The provider is optional so WP-R1.1's construction still typechecks; a
    // cache without one skips the draw the way every unsatisfiable request in
    // this backend is skipped, rather than throwing inside `render` (§61).
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
    );
    gpu.reset();
    expect(cache.acquire({ ...BASE, map: true })).toBeNull();
    expect(cache.size).toBe(0);
    expect(gpu.countOf("device.createRenderPipeline")).toBe(0);
  });

  it("builds the two-group pipeline layout lazily, and exactly once", () => {
    const { device: gpuDevice, gpu } = device();
    const textures = new WgpuTextureCache(gpuDevice);
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
      () => textures.bindGroupLayout,
    );
    gpu.reset();

    // Untextured pipelines never reach for group 1's layout (R-30b's law).
    cache.acquire(BASE);
    expect(gpu.countOf("device.createBindGroupLayout")).toBe(0);
    expect(gpu.countOf("device.createPipelineLayout")).toBe(0);

    const first = cache.acquire({ ...BASE, map: true });
    expect(first).not.toBeNull();
    expect(gpu.countOf("device.createBindGroupLayout")).toBe(1);
    expect(gpu.countOf("device.createPipelineLayout")).toBe(1);
    const layoutArgs = gpu.callsOf("device.createPipelineLayout")[0]
      ?.args[0] as { bindGroupLayouts: unknown[] };
    expect(layoutArgs.bindGroupLayouts).toHaveLength(2);
    expect(layoutArgs.bindGroupLayouts[1]).toBe(textures.bindGroupLayout);

    // A second textured variant reuses the two-group layout.
    cache.acquire({ ...BASE, map: true, blend: "additive" });
    expect(gpu.countOf("device.createPipelineLayout")).toBe(1);
  });

  it("gives a textured variant its uv vertex buffer and its own module", () => {
    const { device: gpuDevice, gpu } = device();
    const textures = new WgpuTextureCache(gpuDevice);
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
      () => textures.bindGroupLayout,
    );
    gpu.reset();
    cache.acquire({ ...BASE, map: true });
    cache.acquire({ ...BASE, vertexColors: true, map: true });
    expect(cache.moduleCount).toBe(2);
    const buffers = gpu
      .callsOf("device.createRenderPipeline")
      .map(
        (call) =>
          (call.args[0] as { vertex: { buffers: unknown[] } }).vertex.buffers
            .length,
      );
    expect(buffers).toEqual([2, 3]);
  });
});

describe("WgpuGeometryCache", () => {
  it("uploads once and reuses until the version advances", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuGeometryCache(gpuDevice);
    const source = geometry();

    const first = cache.acquire(source);
    expect(first).not.toBeNull();
    expect(cache.acquire(source)).toBe(first);
    expect(gpu.countOf("device.createBuffer")).toBe(1);
    expect(cache.size).toBe(1);

    (source as unknown as { version: number }).version = 1;
    const second = cache.acquire(source);
    // §65: same layout, so the buffer is rewritten in place, not replaced.
    expect(second).toBe(first);
    expect(second!.positionBuffer).toBe(first!.positionBuffer);
    expect(gpu.countOf("buffer.destroy")).toBe(0);
    expect(cache.size).toBe(1);
  });

  it("declares VERTEX|COPY_DST for a vertex stream and INDEX for indices", () => {
    const { device: gpuDevice, gpu } = device();
    new WgpuGeometryCache(gpuDevice).acquire(
      geometry({ indices: new Uint16Array([0, 1, 2]) }),
    );
    const usages = gpu
      .callsOf("device.createBuffer")
      .map((call) => (call.args[0] as { usage: number }).usage);
    expect(usages).toEqual([
      GPU_BUFFER_USAGE.VERTEX | GPU_BUFFER_USAGE.COPY_DST,
      GPU_BUFFER_USAGE.INDEX | GPU_BUFFER_USAGE.COPY_DST,
    ]);
  });

  it("pads an allocation to a multiple of four bytes", () => {
    const { device: gpuDevice, gpu } = device();
    // Three `Uint16` indices are six bytes; `writeBuffer` needs a multiple of 4.
    new WgpuGeometryCache(gpuDevice).acquire(
      geometry({ indices: new Uint16Array([0, 1, 2]) }),
    );
    const sizes = gpu
      .callsOf("device.createBuffer")
      .map((call) => (call.args[0] as { size: number }).size);
    expect(sizes[1]).toBe(8);
  });

  it("records the index format and the topology", () => {
    const { device: gpuDevice } = device();
    const cache = new WgpuGeometryCache(gpuDevice);
    expect(
      cache.acquire(geometry({ indices: new Uint16Array([0, 1, 2]) }))
        ?.indexFormat,
    ).toBe("uint16");
    expect(
      cache.acquire(geometry({ indices: new Uint32Array([0, 1, 2]) }))
        ?.indexFormat,
    ).toBe("uint32");
    expect(cache.acquire(geometry())?.indexFormat).toBeNull();
    expect(cache.acquire(geometry({ mode: "lines" }))?.topology).toBe(
      "line-list",
    );
  });

  it("uploads the optional colour stream when there is one", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuGeometryCache(gpuDevice);
    expect(cache.acquire(geometry())?.colorBuffer).toBeNull();
    gpu.reset();
    const record = cache.acquire(
      geometry({ colors: new Float32Array(12).fill(1) }),
    );
    expect(record?.colorBuffer).not.toBeNull();
    expect(gpu.countOf("device.createBuffer")).toBe(2);
  });

  it("returns null for a geometry with nothing to draw, and caches nothing", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuGeometryCache(gpuDevice);
    expect(
      cache.acquire(geometry({ positions: new Float32Array(0) })),
    ).toBeNull();
    expect(cache.size).toBe(0);
    expect(gpu.countOf("device.createBuffer")).toBe(0);
  });

  it("forgets everything without touching a lost device", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuGeometryCache(gpuDevice);
    cache.acquire(geometry());
    gpu.reset();
    cache.forget();
    expect(cache.size).toBe(0);
    expect(gpu.calls).toHaveLength(0);
  });

  it("destroys every allocation on dispose, idempotently", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuGeometryCache(gpuDevice);
    cache.acquire(geometry({ indices: new Uint16Array([0, 1, 2]) }));
    // …and one carrying the optional colour stream, so both arms of the
    // optional-chain teardown run.
    cache.acquire(geometry({ colors: new Float32Array(12).fill(1) }));
    gpu.reset();
    cache.dispose();
    expect(gpu.countOf("buffer.destroy")).toBe(4);
    gpu.reset();
    cache.dispose();
    expect(gpu.calls).toHaveLength(0);
    expect(cache.disposed).toBe(true);
    expect(cache.acquire(geometry())).toBeNull();
  });
});

describe("the bind-group layout, declared as data (§7)", () => {
  it("declares one dynamically-offset uniform binding, visible to both stages", () => {
    const { device: gpuDevice, gpu } = device();
    createDrawBindGroupLayout(gpuDevice);
    const descriptor = gpu.callsOf("device.createBindGroupLayout")[0]
      ?.args[0] as {
      entries: {
        binding: number;
        visibility: number;
        buffer: {
          type: string;
          hasDynamicOffset: boolean;
          minBindingSize: number;
        };
      }[];
    };
    expect(descriptor.entries).toHaveLength(1);
    expect(descriptor.entries[0]?.binding).toBe(0);
    expect(descriptor.entries[0]?.visibility).toBe(0x1 | 0x2);
    expect(descriptor.entries[0]?.buffer).toEqual({
      type: "uniform",
      hasDynamicOffset: true,
      minBindingSize: DRAW_UNIFORM_BYTES,
    });
  });

  it("keeps the block size and the stride distinct", () => {
    // Conflating them would bind 64 bytes of the next draw's block into this
    // draw's shader — see `wgpu-bindings.ts`.
    expect(DRAW_UNIFORM_BYTES).toBe(192);
    expect(DRAW_UNIFORM_FLOATS).toBe(48);
    expect(UNIFORM_STRIDE_BYTES).toBe(256);
    expect(DRAW_VIEW_PROJECTION_OFFSET).toBe(0);
    expect(DRAW_MODEL_OFFSET).toBe(64);
    expect(DRAW_COLOR_OFFSET).toBe(128);
    expect(DRAW_NORMAL_OFFSET).toBe(144);
    expect(DRAW_UNIFORM_WGSL).toContain("normalMatrix : mat3x3<f32>");
  });

  it("is the same declaration the WGSL reads", () => {
    expect(DRAW_UNIFORM_WGSL).toContain("@group(0) @binding(0)");
    expect(unlitShaderSource(false)).toContain(DRAW_UNIFORM_WGSL);
    expect(CLEAR_SHADER_SOURCE).toContain(DRAW_UNIFORM_WGSL);
  });
});

describe("the unlit WGSL", () => {
  it("remaps WebGL clip depth onto WebGPU's [0, 1]", () => {
    expect(unlitShaderSource(false)).toContain("(clip.z + clip.w) * 0.5");
  });

  it("is a pure function of its variant flag", () => {
    expect(unlitShaderSource(true)).toBe(unlitShaderSource(true));
    expect(unlitShaderSource(true)).not.toBe(unlitShaderSource(false));
  });

  it("reads the colour stream only in the vertex-coloured variant", () => {
    expect(unlitShaderSource(false)).not.toContain("vertexColor");
    expect(unlitShaderSource(true)).toContain("draw.color * vertexColor");
    expect(unlitShaderSource(true)).toContain(
      `@location(${String(COLOR_SHADER_LOCATION)}) vertexColor`,
    );
    expect(unlitShaderSource(false)).toContain(
      `@location(${String(POSITION_SHADER_LOCATION)}) position`,
    );
  });

  it("binds a second vertex buffer only for that variant", () => {
    expect(unlitVertexBufferLayouts(false)).toHaveLength(1);
    expect(unlitVertexBufferLayouts(true)).toHaveLength(2);
    expect(unlitVertexBufferLayouts(true)[1]?.arrayStride).toBe(16);
    expect(unlitVertexBufferLayouts(false)[0]?.arrayStride).toBe(12);
  });

  it("samples §57's map only in the textured variants (WP-R1.2)", () => {
    expect(unlitShaderSource(false)).not.toContain("textureSample");
    expect(unlitShaderSource(false, true)).toContain(
      "input.color * textureSample(mapTexture, mapSampler, input.uv)",
    );
    expect(unlitShaderSource(false, true)).toContain(MAP_BINDING_WGSL);
    expect(unlitShaderSource(false, true)).toContain(
      `@location(${String(UV_SHADER_LOCATION)}) uv`,
    );
    // Both flags together: the tint, the vertex colour and the sample multiply.
    expect(unlitShaderSource(true, true)).toContain("draw.color * vertexColor");
    expect(unlitShaderSource(true, true)).toContain("textureSample");
  });

  it("appends the uv stream after the colour stream, positionally", () => {
    expect(unlitVertexBufferLayouts(false, true)).toHaveLength(2);
    expect(unlitVertexBufferLayouts(true, true)).toHaveLength(3);
    // The uv layout keeps `@location(2)` whichever slot it lands in — a
    // shader location is a name, a slot is a position (`wgpu-unlit.ts`).
    expect(
      unlitVertexBufferLayouts(false, true)[1]?.attributes[0]?.shaderLocation,
    ).toBe(UV_SHADER_LOCATION);
    expect(
      unlitVertexBufferLayouts(true, true)[2]?.attributes[0]?.shaderLocation,
    ).toBe(UV_SHADER_LOCATION);
    expect(unlitVertexBufferLayouts(false, true)[1]?.arrayStride).toBe(8);
  });

  it("generates the clear triangle from the vertex index alone", () => {
    expect(CLEAR_SHADER_SOURCE).toContain("@builtin(vertex_index)");
    expect(CLEAR_SHADER_SOURCE).not.toContain("@location(0) position");
  });
});

describe("mipLevelCount and textureByteLength", () => {
  it("counts the full chain, one halving at a time", () => {
    expect(mipLevelCount(1, 1)).toBe(1);
    expect(mipLevelCount(2, 2)).toBe(2);
    expect(mipLevelCount(4, 4)).toBe(3);
    expect(mipLevelCount(256, 256)).toBe(9);
    // Non-square: the longer axis decides, the shorter clamps at 1.
    expect(mipLevelCount(8, 2)).toBe(4);
    expect(mipLevelCount(1, 16)).toBe(5);
  });

  it("bills the chain level by level, as `Texture.byteLength` does", () => {
    expect(textureByteLength(4, 4, false)).toBe(64);
    // R-30b's recorded number: 4 × 4 mipmapped is 84 bytes, not 4/3 × 64.
    expect(textureByteLength(4, 4, true)).toBe(84);
    expect(textureByteLength(8, 2, true)).toBe(64 + 16 + 8 + 4);
  });

  it("agrees with `@fourjs/render`'s own accounting (§84 backend parity)", () => {
    // Independent computations, asserted equal — the parity §84 needs for
    // `textureMemory` to mean one thing across backends where formats match.
    for (const [width, height, mipmaps] of [
      [4, 4, true],
      [4, 4, false],
      [256, 256, true],
      [8, 2, true],
    ] as const) {
      const cpu = new Texture({ width, height, mipmaps });
      expect(textureByteLength(width, height, mipmaps)).toBe(cpu.byteLength);
      cpu.dispose();
    }
  });
});

describe("the mip blit's WGSL", () => {
  it("binds only the texture/sampler group, at the shared bindings", () => {
    // Group 0 here, group 1 in the unlit shader — one layout object, two
    // pipeline layouts (`wgpu-bindings.ts`); and no vertex buffers at all:
    // the triangle and its uvs come from the vertex index.
    expect(MIPMAP_SHADER_SOURCE).toContain(
      `@group(0) @binding(${String(MAP_TEXTURE_BINDING)})`,
    );
    expect(MIPMAP_SHADER_SOURCE).toContain(
      `@group(0) @binding(${String(MAP_SAMPLER_BINDING)})`,
    );
    expect(MIPMAP_SHADER_SOURCE).toContain("@builtin(vertex_index)");
    expect(MIPMAP_SHADER_SOURCE).not.toContain("@location(0) position");
  });
});

describe("samplerKey", () => {
  it("is total over the five resolved fields, in a fixed order", () => {
    expect(
      samplerKey({
        addressMode: "clamp-to-edge",
        magFilter: "linear",
        minFilter: "linear",
        mipmapFilter: "nearest",
        anisotropy: 1,
      }),
    ).toBe("clamp-to-edge|linear|linear|nearest|1");
  });
});

describe("WgpuTextureCache", () => {
  it("creates nothing at construction — the layout is first-use lazy", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuTextureCache(gpuDevice);
    expect(gpu.calls).toHaveLength(0);
    const layout = cache.bindGroupLayout;
    expect(gpu.countOf("device.createBindGroupLayout")).toBe(1);
    expect(cache.bindGroupLayout).toBe(layout);
    expect(gpu.countOf("device.createBindGroupLayout")).toBe(1);
  });

  it("uploads once with writeTexture and reuses until the version advances", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuTextureCache(gpuDevice);
    const source = texture({ width: 2, height: 2 });

    const first = cache.acquire(source);
    expect(first).not.toBeNull();
    expect(cache.acquire(source)).toBe(first);
    expect(gpu.countOf("device.createTexture")).toBe(1);
    expect(gpu.countOf("queue.writeTexture")).toBe(1);
    expect(cache.size).toBe(1);
    expect(cache.byteLength).toBe(16);

    const upload = gpu.callsOf("queue.writeTexture")[0];
    expect(upload?.args[2]).toEqual({
      offset: 0,
      bytesPerRow: 8,
      rowsPerImage: 2,
    });
    expect(upload?.args[3]).toEqual([2, 2]);

    (source as unknown as { version: number }).version = 1;
    const second = cache.acquire(source);
    expect(second).not.toBe(first);
    expect(gpu.countOf("texture.destroy")).toBe(1);
    expect(cache.size).toBe(1);
    expect(cache.byteLength).toBe(16);
  });

  it("allocates rgba8unorm, and rgba8unorm-srgb for a tagged texture (§60a)", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuTextureCache(gpuDevice);
    cache.acquire(texture({}));
    cache.acquire(texture({ colorSpace: "srgb" }));
    const formats = gpu
      .callsOf("device.createTexture")
      .map((call) => (call.args[0] as { format: string }).format);
    expect(formats).toEqual(["rgba8unorm", "rgba8unorm-srgb"]);
  });

  it("binds the texture's view and its sampler at the declared bindings", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuTextureCache(gpuDevice);
    const record = cache.acquire(texture({}));
    const descriptor = gpu.callsOf("device.createBindGroup")[0]?.args[0] as {
      layout: unknown;
      entries: { binding: number; resource: unknown }[];
    };
    expect(descriptor.layout).toBe(cache.bindGroupLayout);
    expect(descriptor.entries.map((entry) => entry.binding)).toEqual([
      MAP_TEXTURE_BINDING,
      MAP_SAMPLER_BINDING,
    ]);
    expect(descriptor.entries[0]?.resource).toBe(record?.view);
    expect(descriptor.entries[1]?.resource).toBe(record?.sampler);
  });

  it("returns null for a disposed texture, and destroys its stale record", () => {
    resetDevWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuTextureCache(gpuDevice);
    const source = texture({});
    cache.acquire(source);
    (source as unknown as { version: number; disposed: boolean }).version = 1;
    (source as unknown as { disposed: boolean }).disposed = true;
    expect(cache.acquire(source)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("disposed");
    expect(gpu.countOf("texture.destroy")).toBe(1);
    expect(cache.size).toBe(0);
    expect(cache.byteLength).toBe(0);
  });

  it("shares one sampler across textures naming the same §77 state", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuTextureCache(gpuDevice);
    // Naming the default state and naming nothing resolve to one sampler —
    // the key is built from resolved values, not raw fields.
    cache.acquire(texture({}));
    cache.acquire(texture({ filter: "linear", wrap: "clamp-to-edge" }));
    expect(cache.samplerCount).toBe(1);
    expect(gpu.countOf("device.createSampler")).toBe(1);

    cache.acquire(texture({ wrap: "repeat" }));
    cache.acquire(texture({ filter: "nearest" }));
    expect(cache.samplerCount).toBe(3);

    const descriptor = gpu.callsOf("device.createSampler")[0]?.args[0];
    expect(descriptor).toEqual({
      label: "fourJS:sampler:clamp-to-edge|linear|linear|nearest|1",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "nearest",
    });
  });

  it("maps §77's wrap modes onto WebGPU's address modes", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuTextureCache(gpuDevice);
    cache.acquire(texture({ wrap: "repeat" }));
    cache.acquire(texture({ wrap: "mirrored-repeat" }));
    const modes = gpu
      .callsOf("device.createSampler")
      .map((call) => (call.args[0] as { addressModeU: string }).addressModeU);
    expect(modes).toEqual(["repeat", "mirror-repeat"]);
  });

  it("splits §77's minFilter into WebGPU's two fields", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuTextureCache(gpuDevice);
    // `data: null` allocates the chain without generating it, keeping the
    // blit's own sampler off this tape — only the resolved §77 samplers land.
    cache.acquire(
      texture({
        mipmaps: true,
        minFilter: "linear-mipmap-nearest",
        data: null,
      }),
    );
    cache.acquire(
      texture({
        mipmaps: true,
        minFilter: "nearest-mipmap-linear",
        data: null,
      }),
    );
    // An in-level minFilter on a mipmapped texture: between levels, pick one.
    cache.acquire(texture({ mipmaps: true, minFilter: "nearest", data: null }));
    const pairs = gpu
      .callsOf("device.createSampler")
      .map(
        (call) => call.args[0] as { minFilter: string; mipmapFilter: string },
      )
      .map((descriptor) => [descriptor.minFilter, descriptor.mipmapFilter]);
    expect(pairs).toEqual([
      ["linear", "nearest"],
      ["nearest", "linear"],
      ["nearest", "nearest"],
    ]);
  });

  it("derives the min filter from `filter`, chain-aware, when unnamed (R-30b)", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuTextureCache(gpuDevice);
    cache.acquire(texture({ mipmaps: true, data: null }));
    cache.acquire(texture({ mipmaps: true, filter: "nearest", data: null }));
    const pairs = gpu
      .callsOf("device.createSampler")
      .map(
        (call) => call.args[0] as { minFilter: string; mipmapFilter: string },
      )
      .map((descriptor) => [descriptor.minFilter, descriptor.mipmapFilter]);
    expect(pairs).toEqual([
      ["linear", "linear"],
      ["nearest", "nearest"],
    ]);
  });

  it("collapses a mip-choosing minFilter on a texture with no chain", () => {
    // Reachable through a double even though `Texture` refuses the pairing
    // (§85) — the same defensive collapse `gl-texture.ts` makes.
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuTextureCache(gpuDevice);
    cache.acquire(texture({ minFilter: "linear-mipmap-linear" }));
    expect(gpu.callsOf("device.createSampler")[0]?.args[0]).toMatchObject({
      minFilter: "linear",
      mipmapFilter: "nearest",
    });
  });

  it("clamps anisotropy to the assumed ceiling, and only when trilinear", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuTextureCache(gpuDevice);
    cache.acquire(texture({ mipmaps: true, anisotropy: 8, data: null }));
    cache.acquire(texture({ mipmaps: true, anisotropy: 64, data: null }));
    // Nearest-filtered: anisotropy is a request WebGPU cannot express (§62's
    // degrade, not §85's refusal) — the descriptor omits the field entirely.
    cache.acquire(
      texture({ mipmaps: true, filter: "nearest", anisotropy: 8, data: null }),
    );
    // No chain: minification is not trilinear, so the same degrade applies.
    cache.acquire(texture({ anisotropy: 8 }));
    const values = gpu
      .callsOf("device.createSampler")
      .map(
        (call) =>
          (call.args[0] as { maxAnisotropy?: number }).maxAnisotropy ?? null,
      );
    expect(values).toEqual([8, 16, null, null]);
  });

  it("honours a device that reports an anisotropy limit, resolved once", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuTextureCache(gpuDevice);
    (gpuDevice as { limits?: unknown }).limits = { maxAnisotropy: 4 };
    cache.acquire(texture({ mipmaps: true, anisotropy: 8, data: null }));
    expect(gpu.callsOf("device.createSampler")[0]?.args[0]).toMatchObject({
      maxAnisotropy: 4,
    });
  });

  it("generates a mip chain by drawing each level from the one above", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuTextureCache(gpuDevice);
    const record = cache.acquire(
      texture({ width: 4, height: 4, mipmaps: true }),
    );
    expect(record?.levels).toBe(3);
    expect(record?.byteLength).toBe(84);
    expect(cache.byteLength).toBe(84);

    // The allocation asks for the chain and for attachability — the chain is
    // drawn, so its levels are render targets.
    const allocation = gpu.callsOf("device.createTexture")[0]?.args[0] as {
      mipLevelCount?: number;
      usage: number;
    };
    expect(allocation.mipLevelCount).toBe(3);
    expect(allocation.usage & GPU_TEXTURE_USAGE.RENDER_ATTACHMENT).not.toBe(0);

    // Level 0 uploads; levels 1 and 2 are passes: two one-level target views,
    // two draws, one encoder, one submit — before any frame exists.
    expect(gpu.countOf("queue.writeTexture")).toBe(1);
    expect(gpu.countOf("encoder.beginRenderPass")).toBe(2);
    expect(gpu.countOf("pass.draw")).toBe(2);
    expect(gpu.countOf("queue.submit")).toBe(1);
    const levelViews = gpu
      .callsOf("texture.createView")
      .map((call) => call.args[1] as { baseMipLevel?: number } | undefined)
      .filter((descriptor) => descriptor !== undefined)
      .map((descriptor) => descriptor.baseMipLevel);
    expect(levelViews).toEqual([0, 1, 1, 2]);
  });

  it("compiles the blit lazily — an unmipped scene compiles nothing", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuTextureCache(gpuDevice);
    cache.acquire(texture({}));
    expect(gpu.countOf("device.createShaderModule")).toBe(0);
    expect(gpu.countOf("device.createRenderPipeline")).toBe(0);

    // The first chain compiles once; a second chain in the same format reuses
    // the pipeline; an sRGB chain adds a pipeline but never a second module.
    cache.acquire(texture({ width: 4, height: 4, mipmaps: true }));
    expect(gpu.countOf("device.createShaderModule")).toBe(1);
    expect(gpu.countOf("device.createRenderPipeline")).toBe(1);
    cache.acquire(texture({ width: 8, height: 8, mipmaps: true }));
    expect(gpu.countOf("device.createRenderPipeline")).toBe(1);
    cache.acquire(
      texture({ width: 4, height: 4, mipmaps: true, colorSpace: "srgb" }),
    );
    expect(gpu.countOf("device.createShaderModule")).toBe(1);
    expect(gpu.countOf("device.createRenderPipeline")).toBe(2);
  });

  it("skips generation for a mipmapped texture with no CPU data", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuTextureCache(gpuDevice);
    const record = cache.acquire(
      texture({ width: 4, height: 4, mipmaps: true, data: null }),
    );
    // The chain is still allocated — and still billed (§84): `byteLength`
    // follows the allocation, exactly as `Texture.byteLength` does.
    expect(record?.levels).toBe(3);
    expect(record?.byteLength).toBe(84);
    expect(gpu.countOf("queue.writeTexture")).toBe(0);
    expect(gpu.countOf("encoder.beginRenderPass")).toBe(0);
    // Filtering zeroes into zeroes is work to compute what is already there,
    // so the allocation does not ask to be a render target either.
    const allocation = gpu.callsOf("device.createTexture")[0]?.args[0] as {
      usage: number;
    };
    expect(allocation.usage & GPU_TEXTURE_USAGE.RENDER_ATTACHMENT).toBe(0);
  });

  it("forgets everything without touching a lost device", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuTextureCache(gpuDevice);
    cache.acquire(texture({ width: 4, height: 4, mipmaps: true }));
    cache.acquire(texture({}));
    gpu.reset();
    cache.forget();
    expect(gpu.calls).toHaveLength(0);
    expect(cache.size).toBe(0);
    expect(cache.samplerCount).toBe(0);
    expect(cache.byteLength).toBe(0);
  });

  it("destroys every texture on dispose — and only the textures", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuTextureCache(gpuDevice);
    const source = texture({});
    cache.acquire(source);
    cache.acquire(texture({ width: 4, height: 4, mipmaps: true }));
    gpu.reset();
    cache.dispose();
    expect(gpu.countOf("texture.destroy")).toBe(2);
    expect(gpu.calls).toHaveLength(2);
    expect(cache.disposed).toBe(true);
    expect(cache.byteLength).toBe(0);
    gpu.reset();
    cache.dispose();
    expect(gpu.calls).toHaveLength(0);
    expect(cache.acquire(source)).toBeNull();
  });
});

/** A canonical §67 stencil record — the engine-composed mask-test shape. */
const TEST_STENCIL: WgpuStencilDescriptor = {
  func: "equal",
  readMask: 3,
  writeMask: 0,
  failOp: "keep",
  depthFailOp: "keep",
  passOp: "keep",
};

describe("pipelineKey — the §67 stencil and §65 batch segments (WP-R1.3)", () => {
  it("appends nothing for an absent or null field — pre-R1.3 keys are byte-identical", () => {
    // The labels recorded in landed transcripts are `fourJS:<key>`, so this is
    // the byte-identity claim for every clipless, batchless descriptor.
    expect(pipelineKey({ ...BASE, stencil: null, batch: null })).toBe(
      pipelineKey(BASE),
    );
    expect(pipelineKey(BASE)).toBe(
      "unlit|-|-|none|dt|dw|cw|triangle-list|bgra8unorm|depth24plus",
    );
  });

  it("separates every stencil field a pipeline bakes in — and not ref", () => {
    const keys = new Set<string>();
    const stencils: WgpuStencilDescriptor[] = [
      TEST_STENCIL,
      { ...TEST_STENCIL, func: "always" },
      { ...TEST_STENCIL, readMask: 1 },
      { ...TEST_STENCIL, writeMask: 1 },
      { ...TEST_STENCIL, failOp: "zero" },
      { ...TEST_STENCIL, depthFailOp: "invert" },
      { ...TEST_STENCIL, passOp: "replace" },
    ];
    for (const stencil of stencils) {
      keys.add(pipelineKey({ ...BASE, stencil }));
    }
    expect(keys.size).toBe(stencils.length);
    // `ref` is deliberately absent from the record and so from the key: it is
    // a pass command (`setStencilReference`), so a mask writing bit 4 shares
    // the pipeline of one writing bit 1.
    expect(pipelineKey({ ...BASE, stencil: TEST_STENCIL })).toContain("|s:");
  });

  it("separates the batch stream's two flags", () => {
    const keys = new Set<string>([
      pipelineKey({
        ...BASE,
        kind: "batch",
        batch: { uvs: false, colors: false },
      }),
      pipelineKey({
        ...BASE,
        kind: "batch",
        batch: { uvs: true, colors: false },
      }),
      pipelineKey({
        ...BASE,
        kind: "batch",
        batch: { uvs: false, colors: true },
      }),
      pipelineKey({
        ...BASE,
        kind: "batch",
        batch: { uvs: true, colors: true },
      }),
    ]);
    expect(keys.size).toBe(4);
  });
});

describe("the sprite pipeline family (§55, WP-R1.3)", () => {
  /** A cache with both lazy providers wired, as the renderer wires them. */
  function spriteCache(): {
    cache: WgpuPipelineCache;
    gpu: ReturnType<typeof createRecordingGpu>;
  } {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
      () => createTextureBindGroupLayout(gpuDevice),
      () => createSpriteBindGroupLayout(gpuDevice),
    );
    gpu.reset();
    return { cache, gpu };
  }

  const SPRITE: WgpuPipelineDescriptor = {
    ...BASE,
    kind: "sprite",
    map: true,
    blend: "normal",
  };

  it("compiles the sprite module once, and it is the exported source", () => {
    const { cache, gpu } = spriteCache();
    cache.acquire(SPRITE);
    cache.acquire({ ...SPRITE, blend: "additive" });
    expect(cache.moduleCount).toBe(1);
    const sources = gpu
      .callsOf("device.createShaderModule")
      .map((call) => (call.args[0] as { code: string }).code);
    expect(sources).toEqual([SPRITE_SHADER_SOURCE]);
  });

  it("builds the sprite pipeline layout lazily, once, over both providers", () => {
    const { cache, gpu } = spriteCache();
    expect(gpu.countOf("createPipelineLayout")).toBe(0);
    cache.acquire(SPRITE);
    cache.acquire({ ...SPRITE, depthWrite: false });
    // One sprite group-0 layout, one group-1 layout, one pipeline layout —
    // shared by both variants.
    expect(gpu.countOf("device.createPipelineLayout")).toBe(1);
    expect(gpu.countOf("device.createBindGroupLayout")).toBe(2);
  });

  it("reads position and the authored uv stream — no quad uniform", () => {
    const { cache, gpu } = spriteCache();
    cache.acquire(SPRITE);
    const descriptor = gpu.callsOf("device.createRenderPipeline")[0]
      ?.args[0] as {
      vertex: { buffers: { arrayStride: number; attributes: unknown[] }[] };
    };
    expect(descriptor.vertex.buffers).toHaveLength(2);
    expect(descriptor.vertex.buffers[0]?.arrayStride).toBe(12);
    expect(descriptor.vertex.buffers[1]?.arrayStride).toBe(8);
    expect(SPRITE_SHADER_SOURCE).not.toContain("quad");
  });

  it("answers null when a provider is missing, and skips rather than throws", () => {
    const { device: gpuDevice } = device();
    const drawLayout = createDrawBindGroupLayout(gpuDevice);
    // No sprite provider (a hand-built cache predating WP-R1.3).
    const withoutSprite = new WgpuPipelineCache(gpuDevice, drawLayout, () =>
      createTextureBindGroupLayout(gpuDevice),
    );
    expect(withoutSprite.acquire(SPRITE)).toBeNull();
    // A sprite provider without a texture provider cannot bind group 1.
    const withoutTexture = new WgpuPipelineCache(
      gpuDevice,
      drawLayout,
      undefined,
      () => createSpriteBindGroupLayout(gpuDevice),
    );
    expect(withoutTexture.acquire(SPRITE)).toBeNull();
  });
});

describe("the particle pipeline family (§36, WP-R1.8)", () => {
  const PARTICLES: WgpuPipelineDescriptor = {
    ...BASE,
    kind: "particles",
    blend: "normal",
  };

  function particleCache(): {
    cache: WgpuPipelineCache;
    gpu: ReturnType<typeof createRecordingGpu>;
  } {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => createParticleBindGroupLayout(gpuDevice),
    );
    gpu.reset();
    return { cache, gpu };
  }

  it("compiles the particle module once, and it is the exported source", () => {
    const { cache, gpu } = particleCache();
    cache.acquire(PARTICLES);
    cache.acquire({ ...PARTICLES, depthTest: false });
    expect(cache.moduleCount).toBe(1);
    expect(cache.size).toBe(2);
    const sources = gpu
      .callsOf("device.createShaderModule")
      .map((call) => (call.args[0] as { code: string }).code);
    expect(sources).toEqual([PARTICLE_SHADER_SOURCE]);
  });

  it("builds the particle pipeline layout lazily, once, over its own group 0", () => {
    const { cache, gpu } = particleCache();
    expect(gpu.countOf("device.createPipelineLayout")).toBe(0);
    cache.acquire(PARTICLES);
    cache.acquire({ ...PARTICLES, depthWrite: false });
    // One particle group-0 layout, one pipeline layout — shared by both
    // variants, and nothing else in it: the family binds no texture.
    expect(gpu.countOf("device.createPipelineLayout")).toBe(1);
    expect(gpu.countOf("device.createBindGroupLayout")).toBe(1);
  });

  it("bakes the corner and per-instance streams into the pipeline", () => {
    const { cache, gpu } = particleCache();
    cache.acquire(PARTICLES);
    const descriptor = gpu.callsOf("device.createRenderPipeline")[0]
      ?.args[0] as { vertex: { buffers: unknown } };
    expect(descriptor.vertex.buffers).toBe(PARTICLE_VERTEX_BUFFER_LAYOUTS);
  });

  it("answers null when built without a particle provider", () => {
    const { device: gpuDevice } = device();
    // A hand-built cache predating WP-R1.8 skips the draw, never throws.
    const withoutParticles = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
    );
    expect(withoutParticles.acquire(PARTICLES)).toBeNull();
  });
});

describe("the batch pipeline family (§65, WP-R1.3)", () => {
  const BATCH: WgpuPipelineDescriptor = {
    ...BASE,
    kind: "batch",
    map: true,
    batch: { uvs: true, colors: false },
  };

  function texturedCache(): {
    cache: WgpuPipelineCache;
    gpu: ReturnType<typeof createRecordingGpu>;
  } {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
      () => createTextureBindGroupLayout(gpuDevice),
    );
    gpu.reset();
    return { cache, gpu };
  }

  it("compiles from the unlit module — one module for both families", () => {
    const { cache } = texturedCache();
    cache.acquire({ ...BASE, map: true });
    cache.acquire(BATCH);
    // "unlit|map", shared; two pipelines.
    expect(cache.moduleCount).toBe(1);
    expect(cache.size).toBe(2);
  });

  it("reads one interleaved buffer with the planner's stride and offsets", () => {
    const { cache, gpu } = texturedCache();
    cache.acquire(BATCH);
    const descriptor = gpu.callsOf("device.createRenderPipeline")[0]
      ?.args[0] as {
      vertex: {
        buffers: {
          arrayStride: number;
          attributes: { offset: number; shaderLocation: number }[];
        }[];
      };
    };
    expect(descriptor.vertex.buffers).toHaveLength(1);
    expect(descriptor.vertex.buffers[0]?.arrayStride).toBe(20);
    expect(descriptor.vertex.buffers[0]?.attributes).toEqual([
      { format: "float32x3", offset: 0, shaderLocation: 0 },
      { format: "float32x2", offset: 12, shaderLocation: UV_SHADER_LOCATION },
    ]);
  });
});

describe("batchVertexBufferLayout", () => {
  it("strides over a stream the variant does not read (the untextured unlit batch)", () => {
    const layout = batchVertexBufferLayout(true, false, false, false);
    expect(layout.arrayStride).toBe(20);
    expect(layout.attributes).toHaveLength(1);
  });

  it("offsets the colour stream past the uv floats it follows", () => {
    const layout = batchVertexBufferLayout(true, true, true, true);
    expect(layout.arrayStride).toBe(36);
    expect(layout.attributes).toEqual([
      { format: "float32x3", offset: 0, shaderLocation: 0 },
      { format: "float32x2", offset: 12, shaderLocation: UV_SHADER_LOCATION },
      {
        format: "float32x4",
        offset: 20,
        shaderLocation: COLOR_SHADER_LOCATION,
      },
    ]);
  });

  it("packs colours directly after position when the stream has no uv", () => {
    const layout = batchVertexBufferLayout(false, true, false, true);
    expect(layout.arrayStride).toBe(28);
    expect(layout.attributes[1]).toEqual({
      format: "float32x4",
      offset: 12,
      shaderLocation: COLOR_SHADER_LOCATION,
    });
  });
});

describe("§67's stencil state on a pipeline (WP-R1.3)", () => {
  it("maps the engine's §57 spellings onto WebGPU's, both faces alike", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
    );
    gpu.reset();
    cache.acquire({
      ...BASE,
      depthFormat: "depth24plus-stencil8",
      stencil: {
        func: "lequal",
        readMask: 7,
        writeMask: 1,
        failOp: "increment",
        depthFailOp: "decrement",
        passOp: "replace",
      },
    });
    const descriptor = gpu.callsOf("device.createRenderPipeline")[0]
      ?.args[0] as {
      depthStencil: Record<string, unknown>;
    };
    const face = {
      compare: "less-equal",
      failOp: "increment-clamp",
      depthFailOp: "decrement-clamp",
      passOp: "replace",
    };
    expect(descriptor.depthStencil["stencilFront"]).toEqual(face);
    expect(descriptor.depthStencil["stencilBack"]).toEqual(face);
    expect(descriptor.depthStencil["stencilReadMask"]).toBe(7);
    expect(descriptor.depthStencil["stencilWriteMask"]).toBe(1);
  });

  it("omits all four members for a stencil-free descriptor — WP-R1.1's object", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
    );
    gpu.reset();
    cache.acquire(BASE);
    const descriptor = gpu.callsOf("device.createRenderPipeline")[0]
      ?.args[0] as { depthStencil: Record<string, unknown> };
    expect(descriptor.depthStencil).toEqual({
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less",
    });
  });
});

describe("the sprite uniform block, declared as data (§7's discipline)", () => {
  it("declares the binding the WGSL reads, side by side", () => {
    expect(SPRITE_UNIFORM_BYTES).toBe(144);
    expect(SPRITE_TINT_OFFSET).toBe(128);
    expect(SPRITE_SHADER_SOURCE).toContain(SPRITE_UNIFORM_WGSL);
    expect(SPRITE_UNIFORM_WGSL).not.toContain("quad");
    expect(SPRITE_SHADER_SOURCE).not.toContain("draw.quad");
  });

  it("asks for a dynamically-offset uniform of the widened size", () => {
    const { device: gpuDevice, gpu } = device();
    createSpriteBindGroupLayout(gpuDevice);
    const descriptor = gpu.callsOf("device.createBindGroupLayout")[0]
      ?.args[0] as {
      entries: {
        binding: number;
        buffer: { hasDynamicOffset: boolean; minBindingSize: number };
      }[];
    };
    expect(descriptor.entries[0]?.binding).toBe(0);
    expect(descriptor.entries[0]?.buffer.hasDynamicOffset).toBe(true);
    expect(descriptor.entries[0]?.buffer.minBindingSize).toBe(
      SPRITE_UNIFORM_BYTES,
    );
  });
});
