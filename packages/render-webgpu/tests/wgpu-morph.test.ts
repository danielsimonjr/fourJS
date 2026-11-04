/**
 * RFC 0003 WP-SK.4's WebGPU one-target morph, tested at the unit seams: the
 * WGSL/layout helpers, the pipeline key and memo bit, and the geometry
 * cache's lazy `positions1`/`normals1` uploads. The renderer-level draw
 * sequence lives in `webgpu-renderer.test.ts`.
 */

import { describe, expect, it } from "vitest";

import { createRecordingGpu } from "../../../tests/integration/helpers/recording-gpu.js";
import {
  DRAW_MORPH_WEIGHT_OFFSET,
  DRAW_NORMAL_OFFSET,
  DRAW_UNIFORM_WGSL,
  MORPH_DRAW_UNIFORM_WGSL,
  NORMAL1_SHADER_LOCATION,
  POSITION1_SHADER_LOCATION,
  WgpuGeometryCache,
  WgpuPipelineCache,
  createDrawBindGroupLayout,
  litShaderSource,
  pipelineKey,
  shadedVertexBufferLayouts,
  unlitShaderSource,
  unlitVertexBufferLayouts,
  type CacheableGeometry,
  type GpuDevice,
  type WgpuPipelineDescriptor,
} from "../src/index.js";
import {
  WgpuPipelineMemo,
  createPipelineRequest,
} from "../src/wgpu-pipeline-memo.js";

function geometry(
  extra: Record<string, Float32Array | undefined> = {},
): CacheableGeometry {
  return {
    id: "g",
    version: 0,
    drawCount: 3,
    mode: "triangles",
    positions: new Float32Array(9),
    normals: new Float32Array(9),
    ...extra,
  } as unknown as CacheableGeometry;
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

describe("morph WGSL and layouts", () => {
  it("keeps the 192-byte layout while naming the weight word", () => {
    expect(MORPH_DRAW_UNIFORM_WGSL).not.toBe(DRAW_UNIFORM_WGSL);
    expect(MORPH_DRAW_UNIFORM_WGSL).toContain("normalColumn0 : vec4<f32>");
    expect(DRAW_MORPH_WEIGHT_OFFSET).toBe(DRAW_NORMAL_OFFSET + 12);
  });

  it("appends the morph streams last, at locations 6 and 7", () => {
    expect(unlitVertexBufferLayouts(true, true, "p")).toHaveLength(4);
    const lit = shadedVertexBufferLayouts(true, false, "pn");
    expect(lit.map((l) => l.attributes[0].shaderLocation)).toEqual([
      0,
      3,
      POSITION1_SHADER_LOCATION,
      NORMAL1_SHADER_LOCATION,
    ]);
    expect(shadedVertexBufferLayouts(true, false, "p")).toHaveLength(3);
    expect(shadedVertexBufferLayouts(true, false)).toHaveLength(2);
  });

  it("mixes with the GLSL formula and leaves plain modules untouched", () => {
    expect(unlitShaderSource(false, false)).not.toContain("position1");
    expect(litShaderSource(true, false)).not.toContain("position1");
    expect(unlitShaderSource(false, false, "p")).toContain(
      "mix(position, position1, draw.normalColumn0.w)",
    );
    const lit = litShaderSource(true, false, false, "pn");
    expect(lit).toContain("mix(normal, normal1, draw.normalColumn0.w)");
    expect(lit).toContain("mat3x3<f32>(draw.normalColumn0.xyz");
    // Normal-less lit morph: position only, zero normal.
    const bare = litShaderSource(false, false, false, "p");
    expect(bare).toContain("mix(position, position1");
    expect(bare).not.toContain("normal1");
  });
});

describe("morph pipeline identity", () => {
  it("adds a key segment only when carried", () => {
    expect(pipelineKey(BASE)).not.toContain("mo:");
    expect(pipelineKey({ ...BASE, morph: "p" })).toMatch(/\|mo:p$/);
    expect(pipelineKey({ ...BASE, morph: "pn" })).not.toBe(
      pipelineKey({ ...BASE, morph: "p" }),
    );
  });

  it("memo misses on the morph bit and hits on a repeat", () => {
    const gpu = createRecordingGpu();
    const device = gpu.device as GpuDevice;
    const cache = new WgpuPipelineCache(
      device,
      createDrawBindGroupLayout(device),
    );
    const memo = new WgpuPipelineMemo();
    const request = createPipelineRequest();
    Object.assign(request, {
      colorFormat: "bgra8unorm",
      depthFormat: "depth24plus",
    });
    const plain = memo.acquire(cache, request);
    expect(memo.acquire(cache, request)).toBe(plain);
    request.morph = "p";
    const morph = memo.acquire(cache, request);
    expect(morph).not.toBe(plain);
    expect(memo.acquire(cache, request)).toBe(morph);
    request.morph = undefined;
    expect(memo.acquire(cache, request)).toBe(plain);
  });
});

describe("geometry cache morph uploads", () => {
  function setup(): {
    cache: WgpuGeometryCache;
    labels: () => string[];
  } {
    const gpu = createRecordingGpu();
    const cache = new WgpuGeometryCache(gpu.device as GpuDevice);
    return {
      cache,
      labels: () =>
        gpu
          .callsOf("device.createBuffer")
          .map((call) => String((call.args[0] as { label?: string }).label)),
    };
  }
  const morphed = (): CacheableGeometry =>
    geometry({
      positions1: new Float32Array(9),
      normals1: new Float32Array(9),
    });

  it("uploads neither stream unless asked", () => {
    const { cache, labels } = setup();
    const record = cache.acquire(morphed(), true);
    expect(record?.position1Buffer).toBeNull();
    expect(record?.normal1Buffer).toBeNull();
    expect(labels().join()).not.toContain("1:");
  });

  it("uploads positions1 for unlit and normals1 only when shading", () => {
    const unlit = setup();
    const a = unlit.cache.acquire(morphed(), false, false, true);
    expect(a?.position1Buffer).not.toBeNull();
    expect(a?.normal1Buffer).toBeNull();
    const lit = setup();
    const b = lit.cache.acquire(morphed(), true, false, true);
    expect(b?.normal1Buffer).not.toBeNull();
    expect(lit.labels().slice(-2)).toEqual([
      "fourJS:positions1:g",
      "fourJS:normals1:g",
    ]);
  });

  it("upgrades a record first acquired without morph, once", () => {
    const { cache, labels } = setup();
    const first = cache.acquire(morphed(), true);
    const count = labels().length;
    const upgraded = cache.acquire(morphed(), true, false, true);
    expect(upgraded).toBe(first);
    expect(upgraded?.position1Buffer).not.toBeNull();
    expect(upgraded?.normal1Buffer).not.toBeNull();
    expect(labels()).toHaveLength(count + 2);
    cache.acquire(morphed(), true, false, true);
    expect(labels()).toHaveLength(count + 2);
    // A geometry with no target streams stays null.
    const plain = setup().cache.acquire(geometry(), true, false, true);
    expect(plain?.position1Buffer).toBeNull();
    cache.dispose();
  });
});
