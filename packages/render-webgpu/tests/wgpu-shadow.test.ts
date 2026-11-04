/**
 * WP-R1.7's shadow units, tested directly: the widened light block's layout
 * arithmetic, the comparison bindings, the caster module, the shadow packer,
 * and the shadowed variants of both shaded WGSL builders — everything a
 * failure should localise to a module smaller than the frame
 * (`wgpu-caches.test.ts`'s argument). The renderer-level halves — the caster
 * pass, the receiving bind group, the byte-identity A/Bs — live in
 * `webgpu-renderer.test.ts`.
 */

import { createSceneLights } from "@fourjs/render";
import { describe, expect, it } from "vitest";

import { createRecordingGpu } from "../../../tests/integration/helpers/recording-gpu.js";
import {
  LIGHT_UNIFORM_BYTES,
  LIGHT_UNIFORM_MEMBERS_WGSL,
  LIGHT_UNIFORM_STRIDE_BYTES,
  LIGHT_UNIFORM_STRIDE_FLOATS,
  LIGHT_UNIFORM_WGSL,
  PUNCTUAL_LIGHT_WGSL,
  SHADOW_FACTOR_WGSL,
  SHADOW_ATLAS_OFFSET,
  SHADOW_CASCADE_MATRIX_OFFSET,
  SHADOW_CASCADE_SPLITS_OFFSET,
  SHADOW_INFO_OFFSET,
  SHADOW_LEGACY_UNIFORM_BYTES,
  SHADOW_LIGHT_UNIFORM_BYTES,
  SHADOW_PUNCTUAL_PARAMS_OFFSET,
  SHADOW_PUNCTUAL_RANGE_OFFSET,
  SHADOW_PUNCTUAL_SLOT_OFFSET,
  SHADOW_SPOT_MATRIX_OFFSET,
  SHADOW_VIEW_DEPTH_OFFSET,
  SHADOW_LIGHT_UNIFORM_WGSL,
  SHADOW_MAP_BINDING,
  SHADOW_MATRIX_OFFSET,
  SHADOW_PARAMS_OFFSET,
  SHADOW_SAMPLER_BINDING,
  SHADOW_SHADER_SOURCE,
  SHADOW_UNIFORM_SPARE_BYTES,
  createDrawBindGroupLayout,
  createLightsBindGroupLayout,
  createShadowLightsBindGroupLayout,
  createShadowSampler,
  createStandardBindGroupLayout,
  createTextureBindGroupLayout,
  litShaderSource,
  pipelineKey,
  standardShaderSource,
  writeShadowUniforms,
  WgpuPipelineCache,
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

describe("the widened shadow-light layout (wgpu-shadow.ts)", () => {
  it("rides the spare stride bytes — the numbers add up and stay inside", () => {
    // The widening begins exactly where the landed block ends, on the 16-byte
    // alignment a mat4 member demands, and stays inside the landed stride —
    // the whole "no landed layout moves" argument, checked as arithmetic.
    expect(SHADOW_MATRIX_OFFSET).toBe(LIGHT_UNIFORM_BYTES);
    expect(SHADOW_MATRIX_OFFSET % 16).toBe(0);
    expect(SHADOW_PARAMS_OFFSET - SHADOW_MATRIX_OFFSET).toBe(64);
    expect(SHADOW_LEGACY_UNIFORM_BYTES).toBe(SHADOW_PARAMS_OFFSET + 16 + 48);
    // W6.3: the atlas tail begins at the landed end and is 752 bytes.
    expect(SHADOW_CASCADE_MATRIX_OFFSET).toBe(SHADOW_LEGACY_UNIFORM_BYTES);
    expect(SHADOW_LIGHT_UNIFORM_BYTES).toBe(SHADOW_LEGACY_UNIFORM_BYTES + 752);
    expect(SHADOW_UNIFORM_SPARE_BYTES).toBe(
      LIGHT_UNIFORM_STRIDE_BYTES - SHADOW_LIGHT_UNIFORM_BYTES,
    );
    expect(SHADOW_UNIFORM_SPARE_BYTES).toBeGreaterThanOrEqual(0);
  });

  it("declares the three-entry group the shadowed WGSL reads", () => {
    const { device: gpuDevice, gpu } = device();
    createShadowLightsBindGroupLayout(gpuDevice);
    expect(gpu.callsOf("device.createBindGroupLayout")[0]?.args[0]).toEqual({
      label: "fourJS:shadow-lights",
      entries: [
        {
          binding: 0,
          visibility: 0x2,
          buffer: {
            type: "uniform",
            hasDynamicOffset: true,
            minBindingSize: SHADOW_LIGHT_UNIFORM_BYTES,
          },
        },
        {
          binding: SHADOW_MAP_BINDING,
          visibility: 0x2,
          texture: { sampleType: "depth", viewDimension: "2d" },
        },
        {
          binding: SHADOW_SAMPLER_BINDING,
          visibility: 0x2,
          sampler: { type: "comparison" },
        },
      ],
    });
  });

  it("creates the one nearest, less-equal comparison sampler", () => {
    const { device: gpuDevice, gpu } = device();
    createShadowSampler(gpuDevice);
    // GL's arithmetic per tap: nearest (one texel per comparison, so the 3×3
    // filter stays the explicit nine-tap average) and `receiver <= occluder`.
    expect(gpu.callsOf("device.createSampler")[0]?.args[0]).toEqual({
      label: "fourJS:shadow-sampler",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: "nearest",
      minFilter: "nearest",
      mipmapFilter: "nearest",
      compare: "less-equal",
    });
  });

  it("widens the landed struct without moving a member", () => {
    // The widened struct's first bytes are the landed member list verbatim —
    // one shared string, so the two blocks cannot drift — and the two shadow
    // members follow. The narrow declaration is untouched.
    expect(SHADOW_LIGHT_UNIFORM_WGSL).toContain(LIGHT_UNIFORM_MEMBERS_WGSL);
    expect(LIGHT_UNIFORM_WGSL).toContain(LIGHT_UNIFORM_MEMBERS_WGSL);
    expect(SHADOW_LIGHT_UNIFORM_WGSL).toContain("shadowMatrix : mat4x4<f32>");
    expect(SHADOW_LIGHT_UNIFORM_WGSL).toContain("shadowParams : vec4<f32>");
    // The variable keeps the narrow block's name so the shared chunks splice.
    expect(SHADOW_LIGHT_UNIFORM_WGSL).toContain(
      "@group(1) @binding(0) var<uniform> lights : ShadowLightUniforms;",
    );
    expect(SHADOW_LIGHT_UNIFORM_WGSL).toContain(
      "@group(1) @binding(1) var shadowMap : texture_depth_2d;",
    );
    expect(SHADOW_LIGHT_UNIFORM_WGSL).toContain(
      "@group(1) @binding(2) var shadowSampler : sampler_comparison;",
    );
  });
});

describe("the receiver chunk and the caster module", () => {
  it("ports SHADOW_GLSL tap for tap, with the v flip and Level taps", () => {
    // The four recorded SHADOW_GLSL decisions, spelled in the text: the
    // normal bias offsets the position, the divide survives the orthographic
    // tier, outside-the-volume is lit, and the bias subtracts from the
    // receiver. The two deliberate differences: v flips for the top-left map
    // origin, and the comparison is a Level tap (no derivatives, legal under
    // the non-uniform normal guard).
    expect(SHADOW_FACTOR_WGSL).toContain(
      "worldPosition + n * lights.shadowParams.y",
    );
    expect(SHADOW_FACTOR_WGSL).toContain("lightSpace.xyz / lightSpace.w");
    expect(SHADOW_FACTOR_WGSL).toContain("0.5 - ndc.y * 0.5");
    expect(SHADOW_FACTOR_WGSL).toContain("return 1.0;");
    expect(SHADOW_FACTOR_WGSL).toContain("c.z - lights.shadowParams.x");
    expect(SHADOW_FACTOR_WGSL).toContain("textureSampleCompareLevel");
    expect(SHADOW_FACTOR_WGSL).not.toContain("textureSampleCompare(");
    expect(SHADOW_FACTOR_WGSL).toContain("lit / 9.0");
  });

  it("casts through the shared DrawUniforms block with the receiver's association", () => {
    // model-then-viewProjection, exactly as `shadedVertexStageWgsl` forms the
    // world position the receiver feeds `shadowMatrix` — and the §3.3.8 depth
    // remap on the way out, which is what lands the stored depth on GL's
    // [0, 1] window convention.
    expect(SHADOW_SHADER_SOURCE).toContain("var<uniform> draw : DrawUniforms");
    expect(SHADOW_SHADER_SOURCE).toContain(
      "let world = draw.model * vec4<f32>(position, 1.0);",
    );
    expect(SHADOW_SHADER_SOURCE).toContain(
      "let clip = draw.viewProjection * world;",
    );
    expect(SHADOW_SHADER_SOURCE).toContain("(clip.z + clip.w) * 0.5");
    // The fragment stage is a constant: defined content for the colour
    // attachment the target row allocates anyway, and a debuggable silhouette.
    expect(SHADOW_SHADER_SOURCE).toContain("vec4<f32>(1.0, 1.0, 1.0, 1.0)");
    expect(SHADOW_SHADER_SOURCE).not.toContain("draw.color");
  });
});

describe("writeShadowUniforms", () => {
  it("packs the matrix, biases and tap size when a light casts", () => {
    const lights = createSceneLights();
    lights.hasShadow = true;
    lights.shadowMatrix.elements.set([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
    lights.shadowBias = 0.005;
    lights.shadowNormalBias = 0.02;
    lights.shadowMapSize = 512;

    const base = LIGHT_UNIFORM_STRIDE_FLOATS;
    const staging = new Float32Array(base * 2).fill(-123);
    writeShadowUniforms(staging, base, lights);

    const matrix = base + SHADOW_MATRIX_OFFSET / 4;
    expect(Array.from(staging.slice(matrix, matrix + 16))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
    const params = base + SHADOW_PARAMS_OFFSET / 4;
    expect(staging[params]).toBe(Math.fround(0.005));
    expect(staging[params + 1]).toBe(Math.fround(0.02));
    expect(staging[params + 2]).toBe(Math.fround(1 / 512));
    expect(staging[params + 3]).toBe(0);
    // Nothing outside the 80-byte tail moved — the landed block is not its
    // business, and the next stride's bytes are not either.
    expect(staging[matrix - 1]).toBe(-123);
    expect(staging[params + 4]).toBe(-123);
  });

  it("writes zeros when no light casts — the frame-determinism half", () => {
    // A frame that stops casting must overwrite the previous frame's matrix,
    // or the uploaded stride depends on history (§33) — and zeros are what a
    // fresh staging array holds, which is what keeps every landed shadowless
    // upload byte-identical.
    const lights = createSceneLights();
    const staging = new Float32Array(LIGHT_UNIFORM_STRIDE_FLOATS).fill(7);
    writeShadowUniforms(staging, 0, lights);
    const matrix = SHADOW_MATRIX_OFFSET / 4;
    for (let index = 0; index < 20; index += 1) {
      expect(staging[matrix + index]).toBe(0);
    }
    expect(staging[matrix - 1]).toBe(7);
    expect(staging[matrix + 20]).toBe(7);
  });
});

describe("the shadowed shaded variants", () => {
  it("emits byte-identical text with the flag absent or false", () => {
    // The R1.5 landing's modules are the shadow-false emission, byte for
    // byte: the parameter default is the byte-identity claim.
    for (const normals of [false, true]) {
      for (const map of [false, true]) {
        expect(litShaderSource(normals, map, false)).toBe(
          litShaderSource(normals, map),
        );
        expect(standardShaderSource(normals, map, false)).toBe(
          standardShaderSource(normals, map),
        );
        expect(litShaderSource(normals, map)).not.toContain("shadowFactor");
        expect(standardShaderSource(normals, map)).not.toContain(
          "shadowFactor",
        );
      }
    }
  });

  it("splices the widened block and multiplies the directional term (lit)", () => {
    const shadowed = litShaderSource(true, false, true);
    expect(shadowed).toContain(SHADOW_LIGHT_UNIFORM_WGSL);
    expect(shadowed).not.toContain("struct LightUniforms");
    expect(shadowed).toContain(SHADOW_FACTOR_WGSL);
    expect(shadowed).toContain(PUNCTUAL_LIGHT_WGSL);
    // GL's shape: the directional product bound to a local, multiplied under
    // the same normal guard, then joined to the lighting sum unchanged.
    expect(shadowed).toContain("var direct = lights.lightColor.xyz * diffuse;");
    expect(shadowed).toContain(
      "direct = direct * shadowFactor(input.worldPosition, n);",
    );
    expect(shadowed).toContain("hemisphereAmbient(len, n)");
    // The map variant samples and shadows together.
    expect(litShaderSource(true, true, true)).toContain(
      "textureSample(mapTexture, mapSampler, input.uv)",
    );
  });

  it("multiplies only the directional lobe (standard) — gl-standard's rule", () => {
    const shadowed = standardShaderSource(true, false, true);
    expect(shadowed).toContain(SHADOW_LIGHT_UNIFORM_WGSL);
    expect(shadowed).toContain(
      "direct = direct * shadowFactor(input.worldPosition, n);",
    );
    // The punctual loop is untouched: the light set has no shadow maps at
    // this tier, so the shadow multiplies the directional lobe alone.
    const punctualLoop = shadowed.slice(shadowed.indexOf("let punctualCount"));
    expect(punctualLoop).not.toContain("shadowFactor");
  });
});

describe("pipelineKey and the cache — the shadow axis", () => {
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

  it("appends |sh:y only when true — false shares the landed key", () => {
    expect(pipelineKey({ ...LIT, shadow: true })).toBe(
      "lit|-|-|none|dt|dw|cw|triangle-list|bgra8unorm|depth24plus|n:y|sh:y",
    );
    // `false` and absent are one key on purpose: they name identical
    // pipeline content, so a non-receiver in a shadowed frame shares the
    // shadowless frame's pipeline, key, and transcript label.
    expect(pipelineKey({ ...LIT, shadow: false })).toBe(pipelineKey(LIT));
  });

  it("compiles the caster module once and the shadowed layouts per family", () => {
    const { device: gpuDevice, gpu } = device();
    const texture = createTextureBindGroupLayout(gpuDevice);
    const lights = createLightsBindGroupLayout(gpuDevice);
    const standard = createStandardBindGroupLayout(gpuDevice);
    const shadowLights = createShadowLightsBindGroupLayout(gpuDevice);
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
      () => texture,
      undefined,
      () => lights,
      () => standard,
      undefined,
      () => shadowLights,
    );
    gpu.reset();

    // The caster family: one module, the shared one-group layout (created by
    // the cache's constructor, so no new layout call), whatever topology
    // combinations later draws add.
    const caster: WgpuPipelineDescriptor = {
      kind: "shadow",
      vertexColors: false,
      map: false,
      blend: "none",
      depthTest: true,
      depthWrite: true,
      colorWrite: true,
      topology: "triangle-list",
      colorFormat: "rgba8unorm",
      depthFormat: "depth32float",
      stencil: null,
      batch: null,
    };
    expect(cache.acquire(caster)).not.toBeNull();
    expect(cache.acquire({ ...caster, topology: "line-list" })).not.toBeNull();
    expect(cache.moduleCount).toBe(1);

    // The shadowed shaded compositions: one per (family × map), labelled.
    cache.acquire({ ...LIT, shadow: true });
    cache.acquire({ ...LIT, shadow: true, blend: "normal" });
    cache.acquire({ ...LIT, shadow: true, map: true });
    cache.acquire({ ...LIT, kind: "standard", shadow: true });
    cache.acquire({ ...LIT, kind: "standard", shadow: true, map: true });
    cache.acquire({
      ...LIT,
      kind: "standard",
      shadow: true,
      metalRoughness: true,
    });
    cache.acquire({
      ...LIT,
      kind: "standard",
      shadow: true,
      map: true,
      metalRoughness: true,
    });
    const layoutLabels = gpu
      .callsOf("device.createPipelineLayout")
      .map((call) => String((call.args[0] as { label?: string }).label));
    expect(layoutLabels).toEqual([
      "fourJS:pipeline-layout:lit:shadow",
      "fourJS:pipeline-layout:lit:shadow:map",
      "fourJS:pipeline-layout:standard:shadow",
      "fourJS:pipeline-layout:standard:shadow:map",
      "fourJS:pipeline-layout:standard:shadow:mr",
      "fourJS:pipeline-layout:standard:shadow:map:mr",
    ]);
    const moduleLabels = gpu
      .callsOf("device.createShaderModule")
      .map((call) => String((call.args[0] as { label?: string }).label));
    expect(moduleLabels).toEqual([
      "fourJS:shadow",
      "fourJS:lit|n|sh",
      "fourJS:lit|n|map|sh",
      "fourJS:standard|n|sh",
      "fourJS:standard|n|map|sh",
      "fourJS:standard|n|mr|sh",
      "fourJS:standard|n|map|mr|sh",
    ]);
  });

  it("answers null for a shadowed descriptor with no shadow-lights provider", () => {
    const { device: gpuDevice } = device();
    const lights = createLightsBindGroupLayout(gpuDevice);
    const cache = new WgpuPipelineCache(
      gpuDevice,
      createDrawBindGroupLayout(gpuDevice),
      undefined,
      undefined,
      () => lights,
    );
    expect(cache.acquire({ ...LIT, shadow: true })).toBeNull();
    // The plain variant is untouched by the missing provider.
    expect(cache.acquire(LIT)).not.toBeNull();
  });
});

/**
 * Lays out a WGSL uniform struct the way the spec does — `vec4<f32>` 16/16,
 * `mat4x4<f32>` 16/64, `array<T, N>` element-strided — and returns each
 * member's byte offset, so the constants the packer writes through are pinned
 * to the text the GPU reads (W6.3).
 */
function wgslOffsets(struct: string): Map<string, number> {
  const sizeOf = (type: string): number => {
    const array = /^array<(.+), (\d+)>$/.exec(type);
    if (array !== null) {
      return sizeOf(array[1]) * Number(array[2]);
    }
    if (type === "vec4<f32>") return 16;
    if (type === "mat4x4<f32>") return 64;
    throw new Error(`unhandled WGSL type ${type}`);
  };
  const offsets = new Map<string, number>();
  let offset = 0;
  const body = struct.slice(struct.indexOf("{") + 1, struct.indexOf("};"));
  for (const line of body.split("\n")) {
    const match = /^\s*(\w+) : (.+),$/.exec(line);
    if (match === null) continue;
    offsets.set(match[1], offset);
    offset += sizeOf(match[2]);
  }
  offsets.set("__end", offset);
  return offsets;
}

describe("the W6.3 atlas tail of the shadow block", () => {
  it("pins every WGSL member offset to the constants the packer writes through", () => {
    const offsets = wgslOffsets(SHADOW_LIGHT_UNIFORM_WGSL);
    expect(offsets.get("shadowMatrix")).toBe(SHADOW_MATRIX_OFFSET);
    expect(offsets.get("shadowParams")).toBe(SHADOW_PARAMS_OFFSET);
    expect(offsets.get("hemisphereSky")).toBe(SHADOW_LEGACY_UNIFORM_BYTES - 48);
    expect(offsets.get("cascadeMatrix")).toBe(SHADOW_CASCADE_MATRIX_OFFSET);
    expect(offsets.get("spotMatrix")).toBe(SHADOW_SPOT_MATRIX_OFFSET);
    expect(offsets.get("cascadeSplits")).toBe(SHADOW_CASCADE_SPLITS_OFFSET);
    expect(offsets.get("viewDepth")).toBe(SHADOW_VIEW_DEPTH_OFFSET);
    expect(offsets.get("atlas")).toBe(SHADOW_ATLAS_OFFSET);
    expect(offsets.get("info")).toBe(SHADOW_INFO_OFFSET);
    expect(offsets.get("atlasSlot")).toBe(SHADOW_PUNCTUAL_SLOT_OFFSET);
    expect(offsets.get("atlasParams")).toBe(SHADOW_PUNCTUAL_PARAMS_OFFSET);
    expect(offsets.get("atlasRange")).toBe(SHADOW_PUNCTUAL_RANGE_OFFSET);
    expect(offsets.get("__end")).toBe(SHADOW_LIGHT_UNIFORM_BYTES);
    expect(SHADOW_LIGHT_UNIFORM_BYTES).toBeLessThanOrEqual(
      LIGHT_UNIFORM_STRIDE_BYTES,
    );
    // The landed prefix did not move.
    expect(offsets.get("punctualParams") ?? 0).toBeGreaterThan(0);
  });

  it("writes the tail member for member on the atlas path", () => {
    const lights = createSceneLights();
    lights.hasShadow = true;
    lights.shadowExtended = true;
    lights.shadowMapSize = 64;
    lights.shadowCascadeCount = 3;
    lights.shadowCascadeMatrices.fill(1);
    lights.shadowSpotMatrices.fill(2);
    lights.shadowCascadeSplits.set([1, 2, 3, 0]);
    lights.shadowViewDepth.set([0, 0, -1, 5]);
    lights.shadowAtlasColumns = 2;
    lights.shadowAtlasRows = 2;
    lights.shadowAtlasWidth = 128;
    lights.shadowAtlasHeight = 256;
    lights.shadowPunctualCount = 1;
    lights.shadowPunctualSlot.fill(0);
    lights.shadowPunctualSlot[1] = 1;
    lights.shadowPunctualParams.set([3, 0.5, 0.25, 2]);
    lights.shadowPunctualRange.set([0.1, 9, 0, 0]);
    const staging = new Float32Array(LIGHT_UNIFORM_STRIDE_FLOATS).fill(-1);

    writeShadowUniforms(staging, 0, lights);

    const f = (offset: number, count = 4): number[] =>
      Array.from(staging.slice(offset / 4, offset / 4 + count));
    expect(f(SHADOW_CASCADE_MATRIX_OFFSET, 16)).toEqual(Array(16).fill(1));
    expect(f(SHADOW_SPOT_MATRIX_OFFSET, 16)).toEqual(Array(16).fill(2));
    expect(f(SHADOW_CASCADE_SPLITS_OFFSET)).toEqual([1, 2, 3, 0]);
    expect(f(SHADOW_VIEW_DEPTH_OFFSET)).toEqual([0, 0, -1, 5]);
    expect(f(SHADOW_ATLAS_OFFSET)).toEqual(
      [2, 2, 1 / 128, 1 / 256].map(Math.fround),
    );
    expect(f(SHADOW_INFO_OFFSET)).toEqual([3, 1, 1, 0]);
    expect(f(SHADOW_PUNCTUAL_SLOT_OFFSET)).toEqual([0, 1, 0, 0]);
    expect(f(SHADOW_PUNCTUAL_PARAMS_OFFSET)).toEqual([3, 0.5, 0.25, 2]);
    expect(f(SHADOW_PUNCTUAL_RANGE_OFFSET)).toEqual(
      [0.1, 9, 0, 0].map(Math.fround),
    );
    // Past the block nothing was touched.
    expect(staging[SHADOW_LIGHT_UNIFORM_BYTES / 4]).toBe(-1);
  });

  it("zeroes the tail on the single-map path and when nothing casts", () => {
    const lights = createSceneLights();
    lights.hasShadow = true;
    lights.shadowMapSize = 64;
    const staging = new Float32Array(LIGHT_UNIFORM_STRIDE_FLOATS).fill(9);
    writeShadowUniforms(staging, 0, lights);
    const tail = SHADOW_CASCADE_MATRIX_OFFSET / 4;
    const end = SHADOW_LIGHT_UNIFORM_BYTES / 4;
    expect(Array.from(staging.slice(tail, end)).every((v) => v === 0)).toBe(
      true,
    );
    staging.fill(9);
    writeShadowUniforms(staging, 0, createSceneLights());
    expect(Array.from(staging.slice(tail, end)).every((v) => v === 0)).toBe(
      true,
    );
    expect(staging[end]).toBe(9);
  });

  it("splices the punctual factor into the shadowed variants only", () => {
    expect(SHADOW_FACTOR_WGSL).toContain("fn punctualShadowFactor(");
    expect(SHADOW_FACTOR_WGSL).toContain("fn directionalShadowAtlas(");
    expect(SHADOW_FACTOR_WGSL).toContain(
      "SHADOW_FACE_FORWARD : array<vec3<f32>, 6> = array<vec3<f32>, 6>(vec3<f32>(1.0, 0.0, 0.0)",
    );
    for (const source of [
      litShaderSource(true, false, true),
      standardShaderSource(true, false, true),
    ]) {
      expect(source).toContain(
        "punctualShadowFactor(index, input.worldPosition, n)",
      );
    }
    for (const source of [
      litShaderSource(true, false),
      standardShaderSource(true, false),
    ]) {
      expect(source).not.toContain("punctualShadowFactor");
    }
  });
});
