/**
 * WP-R1.5's units, tested directly: the light uniform block and its packer,
 * the lit and standard WGSL builders, the shared shaded vertex plumbing, and
 * the pipeline cache's two shaded families.
 *
 * The renderer-level halves — the draw arms, the per-view blocks, the
 * lazy-allocation byte-identity — live in `webgpu-renderer.test.ts`; what is
 * here is everything a failure should localise to a module smaller than the
 * frame (`wgpu-caches.test.ts`'s argument).
 */

import { MAX_LIGHT_SLOTS, createSceneLights } from "@fourjs/render";
import { describe, expect, it } from "vitest";

import { createRecordingGpu } from "../../../tests/integration/helpers/recording-gpu.js";
import {
  COLOR_BUFFER_LAYOUT,
  LIGHTS_BIND_GROUP_INDEX,
  LIGHT_AMBIENT_OFFSET,
  LIGHT_CAMERA_OFFSET,
  LIGHT_COLOR_OFFSET,
  LIGHT_COUNTS_OFFSET,
  LIGHT_DIRECTION_OFFSET,
  LIGHT_PUNCTUAL_COLOR_OFFSET,
  LIGHT_PUNCTUAL_DIRECTION_OFFSET,
  LIGHT_PUNCTUAL_PARAMS_OFFSET,
  LIGHT_PUNCTUAL_POSITION_OFFSET,
  HEMISPHERE_GROUND_OFFSET,
  HEMISPHERE_IRRADIANCE_WGSL,
  HEMISPHERE_SKY_OFFSET,
  HEMISPHERE_UP_OFFSET,
  LIGHT_BINDING_BYTES,
  LIGHT_UNIFORM_BYTES,
  LIGHT_UNIFORM_FLOATS,
  LIGHT_UNIFORM_STRIDE_BYTES,
  LIGHT_UNIFORM_STRIDE_FLOATS,
  LIGHT_UNIFORM_WGSL,
  NORMAL_BUFFER_LAYOUT,
  NORMAL_MATRIX_WGSL,
  NORMAL_SHADER_LOCATION,
  POSITION_BUFFER_LAYOUT,
  PUNCTUAL_LIGHT_WGSL,
  SHADED_MAP_BINDING_WGSL,
  SHADED_MAP_BIND_GROUP_INDEX,
  SHADED_MR_BINDING_WGSL,
  SHADED_MR_BIND_GROUP_INDEX,
  STANDARD_EMISSIVE_OFFSET,
  STANDARD_NORMAL_OFFSET,
  STANDARD_SURFACE_OFFSET,
  STANDARD_UNIFORM_BYTES,
  STANDARD_UNIFORM_WGSL,
  UV_BUFFER_LAYOUT,
  WgpuGeometryCache,
  WgpuPipelineCache,
  createDrawBindGroupLayout,
  createLightsBindGroupLayout,
  createStandardBindGroupLayout,
  createTextureBindGroupLayout,
  litShaderSource,
  pipelineKey,
  shadedVertexBufferLayouts,
  shadedMrBindingWgsl,
  standardShaderSource,
  writeLightUniforms,
  type CacheableGeometry,
  type GpuDevice,
  type WgpuPipelineDescriptor,
} from "../src/index.js";

/** A device to build over; `device` is non-null for the default options. */
function device(): {
  device: GpuDevice;
  gpu: ReturnType<typeof createRecordingGpu>;
} {
  const gpu = createRecordingGpu();
  return { device: gpu.device as GpuDevice, gpu };
}

/** The lit family's flat, normal-shaded descriptor. */
const LIT: WgpuPipelineDescriptor = {
  kind: "lit",
  vertexColors: false,
  map: false,
  blend: "none",
  depthTest: true,
  depthWrite: true,
  colorWrite: true,
  topology: "triangle-list",
  colorFormat: "bgra8unorm",
  depthFormat: "depth24plus",
  normals: true,
};

/** A cache wired the way the renderer wires it — every provider present. */
function fullCache(gpuDevice: GpuDevice): WgpuPipelineCache {
  const texture = createTextureBindGroupLayout(gpuDevice);
  const lights = createLightsBindGroupLayout(gpuDevice);
  const standard = createStandardBindGroupLayout(gpuDevice);
  return new WgpuPipelineCache(
    gpuDevice,
    createDrawBindGroupLayout(gpuDevice),
    () => texture,
    undefined,
    () => lights,
    () => standard,
  );
}

describe("the light uniform layout (wgpu-lights.ts)", () => {
  it("states a fully-vec4 layout whose numbers add up", () => {
    // Every slot is 16 bytes and every offset is the previous plus its size —
    // the "all-vec4, no implied padding" claim, checked as arithmetic.
    expect(LIGHT_DIRECTION_OFFSET - LIGHT_AMBIENT_OFFSET).toBe(16);
    expect(LIGHT_COLOR_OFFSET - LIGHT_DIRECTION_OFFSET).toBe(16);
    expect(LIGHT_CAMERA_OFFSET - LIGHT_COLOR_OFFSET).toBe(16);
    expect(LIGHT_COUNTS_OFFSET - LIGHT_CAMERA_OFFSET).toBe(16);
    expect(LIGHT_PUNCTUAL_POSITION_OFFSET - LIGHT_COUNTS_OFFSET).toBe(16);
    const arrayBytes = MAX_LIGHT_SLOTS * 16;
    expect(LIGHT_PUNCTUAL_COLOR_OFFSET - LIGHT_PUNCTUAL_POSITION_OFFSET).toBe(
      arrayBytes,
    );
    expect(LIGHT_PUNCTUAL_DIRECTION_OFFSET - LIGHT_PUNCTUAL_COLOR_OFFSET).toBe(
      arrayBytes,
    );
    expect(LIGHT_PUNCTUAL_PARAMS_OFFSET - LIGHT_PUNCTUAL_DIRECTION_OFFSET).toBe(
      arrayBytes,
    );
    expect(LIGHT_UNIFORM_BYTES).toBe(LIGHT_PUNCTUAL_PARAMS_OFFSET + arrayBytes);
    expect(LIGHT_UNIFORM_FLOATS).toBe(LIGHT_UNIFORM_BYTES / 4);
    // The stride is a whole number of 256-byte dynamic-offset alignments that
    // holds the unshadowed binding (W6.3 doubled it for the shadow-atlas tail,
    // `wgpu-shadow.ts`; the landed offsets below it did not move).
    expect(LIGHT_UNIFORM_STRIDE_BYTES % 256).toBe(0);
    expect(LIGHT_UNIFORM_STRIDE_BYTES).toBeGreaterThanOrEqual(
      LIGHT_UNIFORM_BYTES,
    );
    expect(LIGHT_UNIFORM_STRIDE_FLOATS).toBe(LIGHT_UNIFORM_STRIDE_BYTES / 4);
  });

  it("declares the group-1 layout the WGSL reads", () => {
    const { device: gpuDevice, gpu } = device();
    createLightsBindGroupLayout(gpuDevice);
    expect(gpu.callsOf("device.createBindGroupLayout")[0]?.args[0]).toEqual({
      label: "fourJS:lights",
      entries: [
        {
          binding: 0,
          visibility: 0x2,
          buffer: {
            type: "uniform",
            hasDynamicOffset: true,
            minBindingSize: LIGHT_BINDING_BYTES,
          },
        },
      ],
    });
    expect(LIGHT_UNIFORM_WGSL).toContain(
      `@group(${String(LIGHTS_BIND_GROUP_INDEX)}) @binding(0)`,
    );
    expect(LIGHT_UNIFORM_WGSL).toContain(
      `array<vec4<f32>, ${String(MAX_LIGHT_SLOTS)}>`,
    );
  });

  it("packs a SceneLights record, camera included, at the given base", () => {
    const lights = createSceneLights();
    lights.ambientColor[0] = 0.1;
    lights.ambientColor[1] = 0.2;
    lights.ambientColor[2] = 0.3;
    lights.hasDirectionalLight = true;
    lights.direction.set(0, -1, 0);
    lights.directionalColor[0] = 2;
    lights.directionalColor[1] = 3;
    lights.directionalColor[2] = 4;
    lights.punctualCount = 2;
    lights.punctualPositions.set([1, 2, 3, 4, 5, 6]);
    lights.punctualColors.set([7, 8, 9, 10, 11, 12]);
    lights.punctualDirections.set([0, 0, 0, 0, 0, -1]);
    lights.punctualParams.set([5, 0, 0, 0, 10, 0.5, 4, 1]);

    // A dirty, strided staging array: every float of the block must be
    // rewritten, so no sentinel survives inside it.
    const base = LIGHT_UNIFORM_STRIDE_FLOATS;
    const staging = new Float32Array(base * 2).fill(-123);
    writeLightUniforms(staging, base, lights, 7, 8, 9);

    const at = (byteOffset: number): number[] =>
      Array.from(
        staging.slice(base + byteOffset / 4, base + byteOffset / 4 + 4),
      );
    expect(at(LIGHT_AMBIENT_OFFSET)).toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
      Math.fround(0.3),
      0,
    ]);
    expect(at(LIGHT_DIRECTION_OFFSET)).toEqual([0, -1, 0, 0]);
    expect(at(LIGHT_COLOR_OFFSET)).toEqual([2, 3, 4, 0]);
    expect(at(LIGHT_CAMERA_OFFSET)).toEqual([7, 8, 9, 0]);
    expect(at(LIGHT_COUNTS_OFFSET)).toEqual([2, 0, 0, 0]);
    // The packed 3-float arrays are re-strided into vec4 slots, w written 0.
    expect(at(LIGHT_PUNCTUAL_POSITION_OFFSET)).toEqual([1, 2, 3, 0]);
    expect(at(LIGHT_PUNCTUAL_POSITION_OFFSET + 16)).toEqual([4, 5, 6, 0]);
    expect(at(LIGHT_PUNCTUAL_COLOR_OFFSET)).toEqual([7, 8, 9, 0]);
    expect(at(LIGHT_PUNCTUAL_COLOR_OFFSET + 16)).toEqual([10, 11, 12, 0]);
    expect(at(LIGHT_PUNCTUAL_DIRECTION_OFFSET + 16)).toEqual([0, 0, -1, 0]);
    // Params are vec4 on both sides and copy straight through.
    expect(at(LIGHT_PUNCTUAL_PARAMS_OFFSET)).toEqual([5, 0, 0, 0]);
    expect(at(LIGHT_PUNCTUAL_PARAMS_OFFSET + 16)).toEqual([10, 0.5, 4, 1]);
    // The dead tail is written too — a transcript must not depend on history.
    expect(at(LIGHT_PUNCTUAL_PARAMS_OFFSET + 32)).toEqual([0, 0, 0, 0]);
    const blockFloats = LIGHT_UNIFORM_FLOATS;
    for (let index = 0; index < blockFloats; index += 1) {
      expect(staging[base + index]).not.toBe(-123);
    }
    // Nothing outside the block moved.
    expect(staging[0]).toBe(-123);
    expect(staging[base + blockFloats]).toBe(-123);
  });

  it("packs a hemisphere into the spare stride after the shadow tail", () => {
    const lights = createSceneLights();
    lights.hasHemisphereLight = true;
    lights.hemisphereSky[0] = 0.6;
    lights.hemisphereSky[1] = 0.7;
    lights.hemisphereSky[2] = 1;
    lights.hemisphereGround[0] = 0.2;
    lights.hemisphereGround[1] = 0.1;
    lights.hemisphereGround[2] = 0.05;
    lights.hemisphereUp.set(0, 0, 1);

    const staging = new Float32Array(LIGHT_UNIFORM_STRIDE_FLOATS).fill(-123);
    writeLightUniforms(staging, 0, lights, 0, 0, 0);

    const at = (byteOffset: number): number[] =>
      Array.from(staging.slice(byteOffset / 4, byteOffset / 4 + 4));
    expect(at(HEMISPHERE_SKY_OFFSET)).toEqual([
      Math.fround(0.6),
      Math.fround(0.7),
      1,
      0,
    ]);
    expect(at(HEMISPHERE_GROUND_OFFSET)).toEqual([
      Math.fround(0.2),
      Math.fround(0.1),
      Math.fround(0.05),
      0,
    ]);
    expect(at(HEMISPHERE_UP_OFFSET)).toEqual([0, 0, 1, 0]);
    // The core block is still fully rewritten; the 80-byte gap after it
    // (shadow's home) is left to writeShadowUniforms. W5.1: 11 light slots
    // push the block to 784 bytes and the hemisphere tail to 864.
    expect(LIGHT_UNIFORM_BYTES).toBe(784);
    expect(HEMISPHERE_SKY_OFFSET).toBe(LIGHT_UNIFORM_BYTES + 80);
    expect(LIGHT_BINDING_BYTES).toBe(912);
    expect(LIGHT_UNIFORM_STRIDE_BYTES).toBe(2048);
  });

  it("packs extra directionals into the shared slots after the punctual set (W5.1)", () => {
    const lights = createSceneLights();
    lights.punctualCount = 3;
    lights.punctualColors.set([1, 1, 1, 2, 2, 2, 3, 3, 3]);
    lights.punctualDirections.set([0, 0, 0, 0, 0, 0, 0, -1, 0]);
    lights.punctualParams.set([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]);
    const staging = new Float32Array(LIGHT_UNIFORM_STRIDE_FLOATS);
    writeLightUniforms(staging, 0, lights, 0, 0, 0);
    const at = (offset: number): number[] =>
      Array.from(staging.slice(offset / 4, offset / 4 + 4));
    expect(at(LIGHT_COUNTS_OFFSET)[0]).toBe(3);
    expect(at(LIGHT_PUNCTUAL_DIRECTION_OFFSET + 32)).toEqual([0, -1, 0, 0]);
    expect(at(LIGHT_PUNCTUAL_PARAMS_OFFSET + 32)[3]).toBe(2);
    expect(PUNCTUAL_LIGHT_WGSL).toContain("punctualParams[index].w > 1.5");
  });

  it("writes zeros in the hemisphere slots when none is present", () => {
    const staging = new Float32Array(LIGHT_UNIFORM_STRIDE_FLOATS).fill(-123);
    writeLightUniforms(staging, 0, createSceneLights(), 0, 0, 0);
    expect(
      Array.from(
        staging.slice(HEMISPHERE_SKY_OFFSET / 4, HEMISPHERE_UP_OFFSET / 4 + 4),
      ),
    ).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0]);
  });
});

describe("the shaded WGSL builders", () => {
  it("generates the four lit variants as pure functions of the flags", () => {
    const flat = litShaderSource(true, false);
    expect(litShaderSource(true, false)).toBe(flat);
    expect(flat).toContain(LIGHT_UNIFORM_WGSL);
    expect(flat).toContain(PUNCTUAL_LIGHT_WGSL);
    expect(flat).toContain(HEMISPHERE_IRRADIANCE_WGSL);
    expect(flat).toContain("hemisphereAmbient(len, n)");
    expect(flat).toContain("draw.normalMatrix * normal");
    expect(flat).not.toContain(NORMAL_MATRIX_WGSL);
    expect(flat).not.toContain("fn normalMatrix");
    expect(flat).toContain("(clip.z + clip.w) * 0.5");
    expect(flat).not.toContain("textureSample");
    expect(flat).toContain(
      `@location(${String(NORMAL_SHADER_LOCATION)}) normal`,
    );

    const normalless = litShaderSource(false, false);
    expect(normalless).not.toContain("draw.normalMatrix *");
    expect(normalless).not.toContain("fn normalMatrix");
    // GL's default-attribute normal, written where GL reads it.
    expect(normalless).toContain("vec3<f32>(0.0, 0.0, 0.0)");

    const mapped = litShaderSource(true, true);
    expect(mapped).toContain(SHADED_MAP_BINDING_WGSL);
    expect(mapped).toContain("textureSample(mapTexture, mapSampler, input.uv)");
    expect(litShaderSource(false, true)).toContain("textureSample");
  });

  it("generates the four standard variants over the widened block", () => {
    const flat = standardShaderSource(true, false);
    expect(flat).toContain(STANDARD_UNIFORM_WGSL);
    expect(flat).toContain(LIGHT_UNIFORM_WGSL);
    expect(flat).toContain(PUNCTUAL_LIGHT_WGSL);
    expect(flat).toContain("directLobe");
    // R-13's conventions, spelled where the GL module spells them.
    expect(flat).toContain(HEMISPHERE_IRRADIANCE_WGSL);
    expect(flat).toContain("hemisphereAmbient(normalLength, nHemi)");
    expect(flat).toContain("DIELECTRIC_F0 : f32 = 0.04");
    expect(flat).toContain("MIN_ROUGHNESS : f32 = 0.045");
    expect(flat).toContain("lights.cameraPosition.xyz");
    expect(flat).not.toContain("textureSample");
    expect(flat).toContain("draw.normalMatrix * normal");
    expect(flat).not.toContain("fn normalMatrix");
    expect(flat).not.toContain(NORMAL_MATRIX_WGSL);

    expect(standardShaderSource(false, false)).not.toContain(
      "draw.normalMatrix *",
    );
    expect(standardShaderSource(false, false)).not.toContain("fn normalMatrix");
    expect(standardShaderSource(true, true)).toContain(
      "textureSample(mapTexture, mapSampler, input.uv)",
    );
    expect(standardShaderSource(false, true)).toContain(
      SHADED_MAP_BINDING_WGSL,
    );
    // The fourth argument defaults false: every landed scalar-only module
    // stays byte-identical.
    expect(standardShaderSource(true, false)).toBe(
      standardShaderSource(true, false, false, false),
    );
    expect(standardShaderSource(true, false)).not.toContain("mrTexture");
    expect(standardShaderSource(true, false)).not.toContain("|mr");
  });

  it("samples the packed metallic-roughness map at group 2 or 3", () => {
    const mrOnly = standardShaderSource(true, false, false, true);
    expect(mrOnly).toContain(shadedMrBindingWgsl(SHADED_MAP_BIND_GROUP_INDEX));
    expect(mrOnly).not.toContain(SHADED_MAP_BINDING_WGSL);
    expect(mrOnly).toContain("textureSample(mrTexture, mrSampler, input.uv)");
    expect(mrOnly).toContain("metalness = metalness * mr.b");
    expect(mrOnly).toContain("roughness = roughness * mr.g");
    // Uvs without an albedo map — GL's useMetalRoughnessMap without useMap.
    expect(mrOnly).toContain("@location(2) uv");

    const mapAndMr = standardShaderSource(true, true, false, true);
    expect(mapAndMr).toContain(SHADED_MAP_BINDING_WGSL);
    expect(mapAndMr).toContain(SHADED_MR_BINDING_WGSL);
    expect(mapAndMr).toContain(
      "textureSample(mapTexture, mapSampler, input.uv)",
    );
    expect(mapAndMr).toContain("textureSample(mrTexture, mrSampler, input.uv)");
  });

  it("keeps the cofactor helper exported but out of the live modules", () => {
    expect(NORMAL_MATRIX_WGSL).toContain(
      "fn normalMatrix(model : mat4x4<f32>)",
    );
    expect(STANDARD_UNIFORM_BYTES).toBe(224);
    expect(STANDARD_NORMAL_OFFSET).toBe(144);
    expect(STANDARD_EMISSIVE_OFFSET).toBe(192);
    expect(STANDARD_SURFACE_OFFSET).toBe(208);
    expect(STANDARD_UNIFORM_WGSL).toContain("normalMatrix : mat3x3<f32>");
    expect(STANDARD_UNIFORM_WGSL).toContain("emissive : vec4<f32>");
  });

  it("binds the shaded map at group 2, leaving the unlit group 1 alone", () => {
    expect(SHADED_MAP_BINDING_WGSL).toContain(
      `@group(${String(SHADED_MAP_BIND_GROUP_INDEX)})`,
    );
    expect(SHADED_MAP_BIND_GROUP_INDEX).toBe(2);
    expect(LIGHTS_BIND_GROUP_INDEX).toBe(1);
    expect(SHADED_MR_BIND_GROUP_INDEX).toBe(3);
    expect(SHADED_MR_BINDING_WGSL).toContain(
      `@group(${String(SHADED_MR_BIND_GROUP_INDEX)})`,
    );
    expect(shadedMrBindingWgsl(SHADED_MAP_BIND_GROUP_INDEX)).toContain(
      `@group(${String(SHADED_MAP_BIND_GROUP_INDEX)})`,
    );
  });

  it("lists the shaded vertex buffers in slot order", () => {
    expect(shadedVertexBufferLayouts(false, false)).toEqual([
      POSITION_BUFFER_LAYOUT,
    ]);
    expect(shadedVertexBufferLayouts(true, false)).toEqual([
      POSITION_BUFFER_LAYOUT,
      NORMAL_BUFFER_LAYOUT,
    ]);
    expect(shadedVertexBufferLayouts(false, true)).toEqual([
      POSITION_BUFFER_LAYOUT,
      UV_BUFFER_LAYOUT,
    ]);
    expect(shadedVertexBufferLayouts(true, true)).toEqual([
      POSITION_BUFFER_LAYOUT,
      NORMAL_BUFFER_LAYOUT,
      UV_BUFFER_LAYOUT,
    ]);
    // The normal stream's location is a name, never a reused number.
    expect(NORMAL_BUFFER_LAYOUT.attributes[0]?.shaderLocation).toBe(3);
    expect(NORMAL_BUFFER_LAYOUT.attributes[0]?.shaderLocation).not.toBe(
      COLOR_BUFFER_LAYOUT.attributes[0]?.shaderLocation,
    );
  });
});

describe("pipelineKey — the shaded families", () => {
  it("appends the normals segment only when the field is carried", () => {
    expect(pipelineKey(LIT)).toBe(
      "lit|-|-|none|dt|dw|cw|triangle-list|bgra8unorm|depth24plus|n:y",
    );
    expect(pipelineKey({ ...LIT, normals: false })).toMatch(/\|n:-$/u);
    // A descriptor that does not carry the field — every pre-WP-R1.5 one —
    // keys exactly as it always did.
    const { normals, ...unshaded } = LIT;
    expect(normals).toBe(true);
    expect(pipelineKey({ ...unshaded, kind: "unlit" })).toBe(
      "unlit|-|-|none|dt|dw|cw|triangle-list|bgra8unorm|depth24plus",
    );
    expect(pipelineKey({ ...LIT, kind: "standard" })).toContain("standard|");
    // `|mr:y` only when true — scalar-only keys stay byte-identical.
    expect(pipelineKey({ ...LIT, kind: "standard" })).not.toContain("|mr:y");
    expect(
      pipelineKey({ ...LIT, kind: "standard", metalRoughness: false }),
    ).toBe(pipelineKey({ ...LIT, kind: "standard" }));
    expect(
      pipelineKey({ ...LIT, kind: "standard", metalRoughness: true }),
    ).toMatch(/\|mr:y$/u);
  });
});

describe("WgpuPipelineCache — the shaded families", () => {
  it("creates the standard group-0 layout the WGSL reads", () => {
    const { device: gpuDevice, gpu } = device();
    createStandardBindGroupLayout(gpuDevice);
    expect(gpu.callsOf("device.createBindGroupLayout")[0]?.args[0]).toEqual({
      label: "fourJS:standard-uniforms",
      entries: [
        {
          binding: 0,
          visibility: 0x3,
          buffer: {
            type: "uniform",
            hasDynamicOffset: true,
            minBindingSize: STANDARD_UNIFORM_BYTES,
          },
        },
      ],
    });
  });

  it("compiles one module per shaded variant, shared across pipelines", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = fullCache(gpuDevice);
    gpu.reset();

    cache.acquire(LIT);
    cache.acquire({ ...LIT, blend: "normal" });
    expect(cache.moduleCount).toBe(1);
    cache.acquire({ ...LIT, normals: false });
    cache.acquire({ ...LIT, map: true });
    cache.acquire({ ...LIT, kind: "standard" });
    expect(cache.moduleCount).toBe(4);
    expect(
      gpu
        .callsOf("device.createShaderModule")
        .map((call) => (call.args[0] as { label?: string }).label),
    ).toEqual([
      "fourJS:lit|n",
      "fourJS:lit",
      "fourJS:lit|n|map",
      "fourJS:standard|n",
    ]);
  });

  it("composes each family's pipeline layout once and caches it", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = fullCache(gpuDevice);
    gpu.reset();

    cache.acquire(LIT);
    cache.acquire({ ...LIT, normals: false });
    cache.acquire({ ...LIT, map: true });
    cache.acquire({ ...LIT, map: true, blend: "normal" });
    cache.acquire({ ...LIT, kind: "standard" });
    cache.acquire({ ...LIT, kind: "standard", map: true });
    cache.acquire({ ...LIT, kind: "standard", metalRoughness: true });
    cache.acquire({
      ...LIT,
      kind: "standard",
      map: true,
      metalRoughness: true,
    });
    expect(
      gpu
        .callsOf("device.createPipelineLayout")
        .map((call) => (call.args[0] as { label?: string }).label),
    ).toEqual([
      "fourJS:pipeline-layout:lit",
      "fourJS:pipeline-layout:lit:map",
      "fourJS:pipeline-layout:standard",
      "fourJS:pipeline-layout:standard:map",
      "fourJS:pipeline-layout:standard:mr",
      "fourJS:pipeline-layout:standard:map:mr",
    ]);
  });

  it("bakes the shaded vertex layouts into the pipeline", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = fullCache(gpuDevice);
    gpu.reset();
    cache.acquire({ ...LIT, map: true });
    cache.acquire({ ...LIT, normals: false });
    cache.acquire({ ...LIT, kind: "standard", metalRoughness: true });
    const buffers = gpu
      .callsOf("device.createRenderPipeline")
      .map(
        (call) =>
          (call.args[0] as { vertex: { buffers: unknown[] } }).vertex.buffers,
      );
    expect(buffers[0]).toEqual([
      POSITION_BUFFER_LAYOUT,
      NORMAL_BUFFER_LAYOUT,
      UV_BUFFER_LAYOUT,
    ]);
    expect(buffers[1]).toEqual([POSITION_BUFFER_LAYOUT]);
    // Mr-only still needs the uv stream, same slot order as albedo.
    expect(buffers[2]).toEqual([
      POSITION_BUFFER_LAYOUT,
      NORMAL_BUFFER_LAYOUT,
      UV_BUFFER_LAYOUT,
    ]);
  });

  it("answers null for a shaded descriptor with no lights provider", () => {
    const { device: gpuDevice } = device();
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
    );
    expect(cache.acquire(LIT)).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("answers null for a standard descriptor with no standard provider", () => {
    const { device: gpuDevice } = device();
    const lights = createLightsBindGroupLayout(gpuDevice);
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
      undefined,
      undefined,
      () => lights,
    );
    expect(cache.acquire({ ...LIT, kind: "standard" })).toBeNull();
    // The lit family only needs the shared draw layout plus the lights.
    expect(cache.acquire(LIT)).not.toBeNull();
  });

  it("answers null for a sampling shaded descriptor with no texture provider", () => {
    const { device: gpuDevice } = device();
    const lights = createLightsBindGroupLayout(gpuDevice);
    const standard = createStandardBindGroupLayout(gpuDevice);
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
      undefined,
      undefined,
      () => lights,
      () => standard,
    );
    expect(cache.acquire({ ...LIT, map: true })).toBeNull();
    expect(cache.acquire({ ...LIT, kind: "standard", map: true })).toBeNull();
    expect(
      cache.acquire({ ...LIT, kind: "standard", metalRoughness: true }),
    ).toBeNull();
    expect(cache.acquire({ ...LIT, kind: "standard" })).not.toBeNull();
  });

  it("compiles a distinct standard module per metallic-roughness variant", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = fullCache(gpuDevice);
    gpu.reset();

    cache.acquire({ ...LIT, kind: "standard" });
    cache.acquire({ ...LIT, kind: "standard", metalRoughness: true });
    cache.acquire({
      ...LIT,
      kind: "standard",
      map: true,
      metalRoughness: true,
    });
    expect(
      gpu
        .callsOf("device.createShaderModule")
        .map((call) => (call.args[0] as { label?: string }).label),
    ).toEqual([
      "fourJS:standard|n",
      "fourJS:standard|n|mr",
      "fourJS:standard|n|map|mr",
    ]);
    const mrOnly = gpu.callsOf("device.createShaderModule")[1]?.args[0] as {
      code: string;
    };
    expect(mrOnly.code).toContain(
      "textureSample(mrTexture, mrSampler, input.uv)",
    );
    expect(mrOnly.code).toContain(
      `@group(${String(SHADED_MAP_BIND_GROUP_INDEX)})`,
    );
    const mapAndMr = gpu.callsOf("device.createShaderModule")[2]?.args[0] as {
      code: string;
    };
    expect(mapAndMr.code).toContain(SHADED_MAP_BINDING_WGSL);
    expect(mapAndMr.code).toContain(SHADED_MR_BINDING_WGSL);
  });
});

let nextId = 0;

/** A §53 geometry double carrying normals, the shaded families' input. */
function normalGeometry(withNormals: boolean): CacheableGeometry {
  nextId += 1;
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  return {
    id: `lit-geometry-${String(nextId)}`,
    version: 0,
    positions,
    normals: withNormals
      ? new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])
      : undefined,
    mode: "triangles",
    drawCount: 3,
  } as unknown as CacheableGeometry;
}

describe("WgpuGeometryCache — the normal stream (WP-R1.5)", () => {
  it("uploads normals only when the acquiring draw shades", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuGeometryCache(gpuDevice);
    const unshaded = cache.acquire(normalGeometry(true));
    expect(unshaded?.normalBuffer).toBeNull();
    const labels = (): string[] =>
      gpu
        .callsOf("device.createBuffer")
        .map((call) => String((call.args[0] as { label?: string }).label));
    expect(labels().some((label) => label.startsWith("fourJS:normals:"))).toBe(
      false,
    );

    const shaded = cache.acquire(normalGeometry(true), true);
    expect(shaded?.normalBuffer).not.toBeNull();
    // GL's allocation order: positions → normals → (uvs → colours → indices).
    expect(labels().slice(-2)[0]).toContain("fourJS:positions:");
    expect(labels().slice(-1)[0]).toContain("fourJS:normals:");
  });

  it("upgrades a record in place when its first shaded draw arrives", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuGeometryCache(gpuDevice);
    const geometry = normalGeometry(true);
    const record = cache.acquire(geometry);
    expect(record?.normalBuffer).toBeNull();
    gpu.reset();

    const upgraded = cache.acquire(geometry, true);
    expect(upgraded).toBe(record);
    expect(upgraded?.normalBuffer).not.toBeNull();
    // One buffer uploads; the other streams are current and untouched.
    expect(gpu.countOf("device.createBuffer")).toBe(1);
    expect(gpu.countOf("queue.writeBuffer")).toBe(1);

    // A second shaded acquisition is a plain cache hit.
    gpu.reset();
    expect(cache.acquire(geometry, true)).toBe(record);
    expect(gpu.countOf("device.createBuffer")).toBe(0);
  });

  it("shades a normal-less geometry without inventing a stream", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuGeometryCache(gpuDevice);
    const geometry = normalGeometry(false);
    expect(cache.acquire(geometry, true)?.normalBuffer).toBeNull();
    // The hit path answers the same and uploads nothing.
    gpu.reset();
    expect(cache.acquire(geometry, true)?.normalBuffer).toBeNull();
    expect(gpu.countOf("device.createBuffer")).toBe(0);
  });

  it("destroys the normal buffer with its record", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuGeometryCache(gpuDevice);
    cache.acquire(normalGeometry(true), true);
    gpu.reset();
    cache.dispose();
    // positions + normals.
    expect(gpu.countOf("buffer.destroy")).toBe(2);
  });
});

/** A §53 geometry double carrying joints/weights, the skinned families' input. */
function skinnedCacheGeometry(
  withSkin: boolean,
  extras: Partial<{
    normals: boolean;
    uvs: boolean;
    colors: boolean;
    indices: boolean;
  }> = {},
): CacheableGeometry {
  nextId += 1;
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  return {
    id: `skinned-geometry-${String(nextId)}`,
    version: 0,
    positions,
    normals: extras.normals
      ? new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])
      : undefined,
    uvs: extras.uvs ? new Float32Array([0, 0, 1, 0, 0.5, 1]) : undefined,
    colors: extras.colors ? new Float32Array(12).fill(1) : undefined,
    indices: extras.indices ? new Uint16Array([0, 1, 2]) : undefined,
    joints: withSkin ? new Uint16Array(12) : undefined,
    weights: withSkin ? new Float32Array(12).fill(0.25) : undefined,
    mode: "triangles",
    drawCount: extras.indices ? 3 : 3,
  } as unknown as CacheableGeometry;
}

describe("WgpuGeometryCache — joints and weights (RFC 0003)", () => {
  it("uploads joints and weights only when the acquiring draw skins", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuGeometryCache(gpuDevice);
    const unskinned = cache.acquire(skinnedCacheGeometry(true));
    expect(unskinned?.jointBuffer).toBeNull();
    expect(unskinned?.weightBuffer).toBeNull();
    const labels = (): string[] =>
      gpu
        .callsOf("device.createBuffer")
        .map((call) => String((call.args[0] as { label?: string }).label));
    expect(labels().some((label) => label.startsWith("fourJS:joints:"))).toBe(
      false,
    );
    expect(labels().some((label) => label.startsWith("fourJS:weights:"))).toBe(
      false,
    );

    const skinned = cache.acquire(skinnedCacheGeometry(true), false, true);
    expect(skinned?.jointBuffer).not.toBeNull();
    expect(skinned?.weightBuffer).not.toBeNull();
    expect(labels().slice(-3, -2)[0]).toContain("fourJS:positions:");
    expect(labels().slice(-2, -1)[0]).toContain("fourJS:joints:");
    expect(labels().slice(-1)[0]).toContain("fourJS:weights:");
  });

  it("upgrades a record in place when its first skinned draw arrives", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuGeometryCache(gpuDevice);
    const geometry = skinnedCacheGeometry(true);
    const record = cache.acquire(geometry);
    expect(record?.jointBuffer).toBeNull();
    gpu.reset();

    const upgraded = cache.acquire(geometry, false, true);
    expect(upgraded).toBe(record);
    expect(upgraded?.jointBuffer).not.toBeNull();
    expect(upgraded?.weightBuffer).not.toBeNull();
    expect(gpu.countOf("device.createBuffer")).toBe(2);
    expect(gpu.countOf("queue.writeBuffer")).toBe(2);

    gpu.reset();
    expect(cache.acquire(geometry, false, true)).toBe(record);
    expect(gpu.countOf("device.createBuffer")).toBe(0);
  });

  it("skins a joint-less geometry without inventing streams", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuGeometryCache(gpuDevice);
    const geometry = skinnedCacheGeometry(false);
    expect(cache.acquire(geometry, false, true)?.jointBuffer).toBeNull();
    gpu.reset();
    expect(cache.acquire(geometry, false, true)?.jointBuffer).toBeNull();
    expect(gpu.countOf("device.createBuffer")).toBe(0);
  });

  it("keeps allocation order positions → normals → uvs → colours → joints → weights → indices", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuGeometryCache(gpuDevice);
    cache.acquire(
      skinnedCacheGeometry(true, {
        normals: true,
        uvs: true,
        colors: true,
        indices: true,
      }),
      true,
      true,
    );
    const labels = gpu
      .callsOf("device.createBuffer")
      .map((call) => String((call.args[0] as { label?: string }).label));
    const kinds = labels.map((label) => label.split(":")[1]);
    expect(kinds).toEqual([
      "positions",
      "normals",
      "uvs",
      "colors",
      "joints",
      "weights",
      "indices",
    ]);
  });

  it("destroys the joint and weight buffers with their record", () => {
    const { device: gpuDevice, gpu } = device();
    const cache = new WgpuGeometryCache(gpuDevice);
    cache.acquire(skinnedCacheGeometry(true), false, true);
    gpu.reset();
    cache.dispose();
    expect(gpu.countOf("buffer.destroy")).toBe(3);
  });
});

describe("light struct layout agreement (regression: spec hand-wrote old offsets)", () => {
  it("every WGSL member lands at the byte offset the writer constants name", () => {
    // Every member is a vec4 or an array of vec4 (16-byte aligned, 16 bytes
    // per element), so offsets are the running sum of member sizes.
    const offsets = new Map<string, number>();
    let cursor = 0;
    for (const match of LIGHT_UNIFORM_WGSL.matchAll(
      /^\s*(\w+)\s*:\s*(?:array<vec4<f32>,\s*(\d+)>|vec4<f32>)/gm,
    )) {
      offsets.set(match[1], cursor);
      cursor += (match[2] === undefined ? 1 : Number(match[2])) * 16;
    }
    expect(offsets.get("ambientColor")).toBe(LIGHT_AMBIENT_OFFSET);
    expect(offsets.get("counts")).toBe(LIGHT_COUNTS_OFFSET);
    expect(offsets.get("punctualPosition")).toBe(
      LIGHT_PUNCTUAL_POSITION_OFFSET,
    );
    expect(offsets.get("punctualColor")).toBe(LIGHT_PUNCTUAL_COLOR_OFFSET);
    expect(offsets.get("punctualDirection")).toBe(
      LIGHT_PUNCTUAL_DIRECTION_OFFSET,
    );
    expect(offsets.get("punctualParams")).toBe(LIGHT_PUNCTUAL_PARAMS_OFFSET);
    expect(offsets.get("hemisphereSky")).toBe(HEMISPHERE_SKY_OFFSET);
    expect(offsets.get("hemisphereGround")).toBe(HEMISPHERE_GROUND_OFFSET);
    expect(offsets.get("hemisphereUp")).toBe(HEMISPHERE_UP_OFFSET);
    expect(cursor).toBe(LIGHT_BINDING_BYTES);
  });

  it("a point light's colour float lands at the slot punctualColor[0] reads", () => {
    const lights = createSceneLights();
    lights.punctualCount = 1;
    lights.punctualColors[0] = 4;
    const staging = new Float32Array(LIGHT_UNIFORM_STRIDE_FLOATS);
    writeLightUniforms(staging, 0, lights, 0, 0, 0);
    expect(staging[LIGHT_PUNCTUAL_COLOR_OFFSET / 4]).toBe(4);
    expect(staging[LIGHT_COUNTS_OFFSET / 4]).toBe(1);
  });
});
