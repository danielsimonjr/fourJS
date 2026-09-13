/**
 * The skinned colour pipelines (§54, §62; RFC 0003) — a skinned variant of
 * the unlit family and of the lit family, reached only through
 * {@link registerSkinningPipeline}.
 *
 * ## Skinning is a separate pipeline, not a uniform switch (RFC 0003 §5)
 *
 * A `useSkinning` uniform would add four joint fetches, four weight fetches,
 * four `mat4` reads, and a weighted sum to the **vertex stage of every draw
 * in the scene**. So the skinned draws compile their own pipelines, and
 * byte-identity for skinless scenes is preserved the lazy way:
 *
 * - **nothing here is reachable from `WebgpuRenderer`** — the renderer
 *   imports only the registry slot (`wgpu-skinning-registry.ts`), and this
 *   module links into a bundle only when the application calls
 *   {@link registerSkinningPipeline};
 * - **pipelines compile on the first skinned draw of each variant, never
 *   at initialize**, so a scene with no skinned mesh issues the
 *   byte-identical GPU sequence it always did;
 * - a factory failure inside the frame is caught by the renderer (§61
 *   forbids throwing there), warned once, and skinning is off for that
 *   device. A bind pose is never drawn.
 *
 * ## The palette, and why it is not in `DrawUniforms`
 *
 * The palette is `uniform mat4 jointMatrices[MAX_SKINNING_JOINTS]` — 48
 * joints, `@fourjs/render`'s declared constant. 48 × 64 = 3072 bytes, which
 * will not fit in the 256-byte `DrawUniforms` stride, and widening that
 * block would move every landed unskinned transcript (Playwright harnesses
 * bind their own layouts against `DRAW_UNIFORM_BYTES === 192`). So the
 * palette is a **separate bind group**: one uniform buffer of 3072-byte
 * slots, bound at a dynamic offset per skinned draw, uploaded once per
 * frame after the pass — the draw uniforms' shape, one buffer later.
 *
 * Fragment stages are {@link unlitFragmentStageWgsl} and
 * {@link litFragmentStageWgsl} verbatim, so the two families cannot drift.
 *
 * Classes here are deliberately **not** named `SkinnedUnlitProgram`,
 * `SkinnedLitProgram`, or `SkinnedShadowProgram` — WebGL already owns
 * those (`graph:duplicates`). The public opt-in is
 * {@link registerSkinningPipeline}.
 */

import { MAX_SKINNING_JOINTS } from "@fourjs/render";

import {
  GPU_BUFFER_USAGE,
  GPU_SHADER_STAGE,
  type GpuBindGroup,
  type GpuBindGroupLayout,
  type GpuBuffer,
  type GpuDevice,
  type GpuPipelineLayout,
  type GpuRenderPipeline,
  type GpuShaderModule,
  type GpuVertexBufferLayout,
} from "./webgpu-device.js";
import { DRAW_UNIFORM_WGSL, MAP_BINDING_WGSL } from "./wgpu-bindings.js";
import {
  HEMISPHERE_IRRADIANCE_WGSL,
  LIGHT_UNIFORM_WGSL,
  PUNCTUAL_LIGHT_WGSL,
  SHADED_MAP_BINDING_WGSL,
} from "./wgpu-lights.js";
import {
  NORMAL_MATRIX_WGSL,
  litFragmentStageWgsl,
  shadedVertexBufferLayouts,
} from "./wgpu-lit.js";
import { blendStateFor, stencilStateFor } from "./wgpu-pipeline-cache.js";
import {
  SHADOW_FACTOR_WGSL,
  SHADOW_LIGHT_UNIFORM_WGSL,
} from "./wgpu-shadow.js";
import {
  setSkinningPipelineFactory,
  type SkinnedLitPipeline,
  type SkinnedPrograms,
  type SkinnedUnlitPipeline,
  type SkinningPipelineHost,
  type WgpuSkinnedDrawDescriptor,
  type WgpuSkinnedShadowDescriptor,
} from "./wgpu-skinning-registry.js";
import {
  FRAGMENT_ENTRY_POINT,
  POSITION_BUFFER_LAYOUT,
  POSITION_SHADER_LOCATION,
  VERTEX_ENTRY_POINT,
  unlitFragmentStageWgsl,
  unlitVertexBufferLayouts,
} from "./wgpu-unlit.js";

/** `@location(4)` — four joint indices per vertex (§54, RFC 0003). */
export const JOINTS_SHADER_LOCATION = 4;

/** `@location(5)` — four influence weights per vertex, not renormalised. */
export const WEIGHTS_SHADER_LOCATION = 5;

/** Vertex layout for the joint stream: one tightly packed `uint16x4`. */
export const JOINTS_BUFFER_LAYOUT: GpuVertexBufferLayout = Object.freeze({
  arrayStride: 8,
  stepMode: "vertex",
  attributes: Object.freeze([
    Object.freeze({
      format: "uint16x4",
      offset: 0,
      shaderLocation: JOINTS_SHADER_LOCATION,
    }),
  ]),
});

/** Vertex layout for the weight stream: one tightly packed `vec4<f32>`. */
export const WEIGHTS_BUFFER_LAYOUT: GpuVertexBufferLayout = Object.freeze({
  arrayStride: 16,
  stepMode: "vertex",
  attributes: Object.freeze([
    Object.freeze({
      format: "float32x4",
      offset: 0,
      shaderLocation: WEIGHTS_SHADER_LOCATION,
    }),
  ]),
});

/**
 * Size of one joint-palette uniform block in bytes — `MAX_SKINNING_JOINTS`
 * × a std140 `mat4` (64 bytes). Already a multiple of the 256-byte dynamic
 * offset alignment, so the slot *is* the stride.
 */
export const JOINT_PALETTE_BYTES = MAX_SKINNING_JOINTS * 64;

/** `JOINT_PALETTE_BYTES` in `Float32Array` elements. */
export const JOINT_PALETTE_FLOATS = JOINT_PALETTE_BYTES / 4;

/** `@binding(0)` of the palette group — the `mat4` array. */
export const JOINT_PALETTE_BINDING = 0;

/** All four colour channels writable (`GPUColorWrite.ALL`). */
const COLOR_WRITE_ALL = 0xf;

/**
 * Bind-group index the palette occupies for one variant — always the slot
 * after the family's existing groups, so unlit untextured is group 1,
 * textured unlit and untextured lit are group 2, and textured lit is
 * group 3 (WebGPU's last slot).
 */
export function skinnedPaletteBindGroupIndex(
  lit: boolean,
  map: boolean,
): number {
  if (lit) {
    return map ? 3 : 2;
  }
  return map ? 2 : 1;
}

/**
 * The palette bind-group layout: group N, binding 0, a dynamically-offset
 * uniform buffer visible to the **vertex** stage alone (the fragment never
 * reads a joint).
 */
export function createJointPaletteBindGroupLayout(
  device: GpuDevice,
): GpuBindGroupLayout {
  return device.createBindGroupLayout({
    label: "fourJS:joint-palette",
    entries: [
      {
        binding: JOINT_PALETTE_BINDING,
        visibility: GPU_SHADER_STAGE.VERTEX,
        buffer: {
          type: "uniform",
          hasDynamicOffset: true,
          minBindingSize: JOINT_PALETTE_BYTES,
        },
      },
    ],
  });
}

/**
 * Linear-blend skinning chunk spliced into every skinned vertex stage —
 * four influences, weights as authored (not renormalised), matching
 * WebGL's `SKINNING_GLSL`. Joint indices arrive as `uint16x4` at location
 * 4 (WGSL `vec4<u32>`) and weights as `float32x4` at location 5.
 */
export function skinningWgsl(paletteGroup: number): string {
  return `struct JointPalette {
  jointMatrices : array<mat4x4<f32>, ${String(MAX_SKINNING_JOINTS)}>,
};

@group(${String(paletteGroup)}) @binding(${String(JOINT_PALETTE_BINDING)}) var<uniform> palette : JointPalette;

fn skinMatrix() -> mat4x4<f32> {
  return weights.x * palette.jointMatrices[joints.x]
       + weights.y * palette.jointMatrices[joints.y]
       + weights.z * palette.jointMatrices[joints.z]
       + weights.w * palette.jointMatrices[joints.w];
}`;
}

/**
 * Vertex layouts for a skinned unlit pipeline, **in slot order**: the
 * unlit family's streams, then joints, then weights. Shader locations stay
 * 4 and 5 regardless of how many streams precede them.
 */
export function skinnedUnlitVertexBufferLayouts(
  vertexColors: boolean,
  map: boolean,
): readonly GpuVertexBufferLayout[] {
  return [
    ...unlitVertexBufferLayouts(vertexColors, map),
    JOINTS_BUFFER_LAYOUT,
    WEIGHTS_BUFFER_LAYOUT,
  ];
}

/**
 * Vertex layouts for a skinned lit pipeline, **in slot order**: the shaded
 * family's streams, then joints, then weights.
 */
export function skinnedLitVertexBufferLayouts(
  normals: boolean,
  map: boolean,
): readonly GpuVertexBufferLayout[] {
  return [
    ...shadedVertexBufferLayouts(normals, map),
    JOINTS_BUFFER_LAYOUT,
    WEIGHTS_BUFFER_LAYOUT,
  ];
}

/**
 * Vertex layouts for the §69 skinned caster: position, joints, weights.
 * Colour streams are absent — depth ignores them.
 */
export const SKINNED_SHADOW_VERTEX_BUFFER_LAYOUTS: readonly GpuVertexBufferLayout[] =
  Object.freeze([
    POSITION_BUFFER_LAYOUT,
    JOINTS_BUFFER_LAYOUT,
    WEIGHTS_BUFFER_LAYOUT,
  ]);

/**
 * Depth-only skinned caster WGSL — `SHADOW_SHADER_SOURCE` with the position
 * run through `skinMatrix(joints, weights)` first. The helper is
 * parameterized so the module is valid WGSL (vertex inputs are not in
 * scope of a sibling function). Palette at group 1, vertex-only.
 */
export function skinnedShadowShaderSource(): string {
  return `${DRAW_UNIFORM_WGSL}

struct JointPalette {
  jointMatrices : array<mat4x4<f32>, ${String(MAX_SKINNING_JOINTS)}>,
};

@group(1) @binding(${String(JOINT_PALETTE_BINDING)}) var<uniform> palette : JointPalette;

fn skinMatrix(joints : vec4<u32>, weights : vec4<f32>) -> mat4x4<f32> {
  return weights.x * palette.jointMatrices[joints.x]
       + weights.y * palette.jointMatrices[joints.y]
       + weights.z * palette.jointMatrices[joints.z]
       + weights.w * palette.jointMatrices[joints.w];
}

@vertex
fn ${VERTEX_ENTRY_POINT}(
  @location(${String(POSITION_SHADER_LOCATION)}) position : vec3<f32>,
  @location(${String(JOINTS_SHADER_LOCATION)}) joints : vec4<u32>,
  @location(${String(WEIGHTS_SHADER_LOCATION)}) weights : vec4<f32>,
) -> @builtin(position) vec4<f32> {
  let world = draw.model * (skinMatrix(joints, weights) * vec4<f32>(position, 1.0));
  let clip = draw.viewProjection * world;
  return vec4<f32>(clip.x, clip.y, (clip.z + clip.w) * 0.5, clip.w);
}

@fragment
fn ${FRAGMENT_ENTRY_POINT}() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
`;
}

/** {@link skinnedShadowShaderSource} as a stable module string. */
export const SKINNED_SHADOW_SHADER_SOURCE = skinnedShadowShaderSource();

function skinnedInfluenceInputs(): string {
  return `
  @location(${String(JOINTS_SHADER_LOCATION)}) joints : vec4<u32>,
  @location(${String(WEIGHTS_SHADER_LOCATION)}) weights : vec4<f32>,`;
}

/**
 * The skinned unlit WGSL module for one variant. The fragment stage is
 * {@link unlitFragmentStageWgsl} verbatim.
 */
export function skinnedUnlitShaderSource(
  vertexColors: boolean,
  map = false,
): string {
  const paletteGroup = skinnedPaletteBindGroupIndex(false, map);
  let input = `  @location(0) position : vec3<f32>,`;
  if (vertexColors) {
    input += `
  @location(1) vertexColor : vec4<f32>,`;
  }
  if (map) {
    input += `
  @location(2) uv : vec2<f32>,`;
  }
  input += skinnedInfluenceInputs();
  const color = vertexColors ? "draw.color * vertexColor" : "draw.color";
  return `${DRAW_UNIFORM_WGSL}

${skinningWgsl(paletteGroup)}${map ? `\n\n${MAP_BINDING_WGSL}` : ""}

struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) color : vec4<f32>,${
    map
      ? `
  @location(1) uv : vec2<f32>,`
      : ""
  }
};

@vertex
fn ${VERTEX_ENTRY_POINT}(
${input}
) -> VertexOutput {
  var output : VertexOutput;
  let clip = draw.viewProjection * draw.model * (skinMatrix() * vec4<f32>(position, 1.0));
  output.position = vec4<f32>(clip.x, clip.y, (clip.z + clip.w) * 0.5, clip.w);
  output.color = ${color};${
    map
      ? `
  output.uv = uv;`
      : ""
  }
  return output;
}

${unlitFragmentStageWgsl(map)}`;
}

/**
 * The skinned lit WGSL module for one variant. The fragment stage is
 * {@link litFragmentStageWgsl} verbatim. The vertex stage composes
 * `model * skinMatrix()` and transforms normals with the inverse-transpose
 * of that 3×3 — GL's skinned lit vertex, restated, because the CPU
 * `normalMatrix` is the **model**'s and the skin varies per vertex.
 */
export function skinnedLitShaderSource(
  normals: boolean,
  map: boolean,
  shadow = false,
): string {
  const paletteGroup = skinnedPaletteBindGroupIndex(true, map);
  let input = `  @location(0) position : vec3<f32>,`;
  if (normals) {
    input += `
  @location(3) normal : vec3<f32>,`;
  }
  if (map) {
    input += `
  @location(2) uv : vec2<f32>,`;
  }
  input += skinnedInfluenceInputs();
  return `${DRAW_UNIFORM_WGSL}

${skinningWgsl(paletteGroup)}

${shadow ? SHADOW_LIGHT_UNIFORM_WGSL : LIGHT_UNIFORM_WGSL}${
    map
      ? `

${SHADED_MAP_BINDING_WGSL}`
      : ""
  }
${normals ? `\n${NORMAL_MATRIX_WGSL}\n` : ""}
struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) normal : vec3<f32>,
  @location(1) worldPosition : vec3<f32>,${
    map
      ? `
  @location(2) uv : vec2<f32>,`
      : ""
  }
};

@vertex
fn ${VERTEX_ENTRY_POINT}(
${input}
) -> VertexOutput {
  var output : VertexOutput;
  let skinned = draw.model * skinMatrix();
  let world = skinned * vec4<f32>(position, 1.0);
  output.worldPosition = world.xyz;
  output.normal = ${
    normals ? "normalMatrix(skinned) * normal" : "vec3<f32>(0.0, 0.0, 0.0)"
  };${
    map
      ? `
  output.uv = uv;`
      : ""
  }
  let clip = draw.viewProjection * world;
  output.position = vec4<f32>(clip.x, clip.y, (clip.z + clip.w) * 0.5, clip.w);
  return output;
}

${PUNCTUAL_LIGHT_WGSL}

${HEMISPHERE_IRRADIANCE_WGSL}${
    shadow
      ? `

${SHADOW_FACTOR_WGSL}`
      : ""
  }

${litFragmentStageWgsl(map, shadow)}`;
}

function descriptorKey(
  family: "unlit" | "lit",
  descriptor: WgpuSkinnedDrawDescriptor,
): string {
  let key = [
    family,
    descriptor.vertexColors ? "vc" : "-",
    descriptor.map ? "map" : "-",
    descriptor.normals ? "n" : "-",
    descriptor.shadow ? "sh" : "-",
    descriptor.blend,
    descriptor.depthTest ? "dt" : "-",
    descriptor.depthWrite ? "dw" : "-",
    descriptor.colorWrite ? "cw" : "-",
    descriptor.topology,
    descriptor.colorFormat,
    descriptor.depthFormat ?? "-",
  ].join("|");
  const stencil = descriptor.stencil;
  if (stencil !== null) {
    key +=
      `|s:${stencil.func},${String(stencil.readMask)},` +
      `${String(stencil.writeMask)},${stencil.failOp},` +
      `${stencil.depthFailOp},${stencil.passOp}`;
  }
  return key;
}

/**
 * The compiled colour pair. Named off the WebGL program classes on
 * purpose (`graph:duplicates`).
 */
class WgpuSkinnedProgramPair implements SkinnedPrograms {
  readonly unlit: SkinnedUnlitPipeline;

  readonly lit: SkinnedLitPipeline;

  readonly #host: SkinningPipelineHost;

  readonly #paletteLayout: GpuBindGroupLayout;

  readonly #pipelines = new Map<string, GpuRenderPipeline>();

  readonly #modules = new Map<string, GpuShaderModule>();

  readonly #pipelineLayouts = new Map<string, GpuPipelineLayout>();

  #paletteBuffer: GpuBuffer | null = null;

  #paletteBindGroup: GpuBindGroup | null = null;

  #paletteStaging = new Float32Array(0);

  #paletteCapacity = 0;

  #packed = 0;

  #shadowFailed = false;

  #disposed = false;

  constructor(host: SkinningPipelineHost, paletteLayout: GpuBindGroupLayout) {
    this.#host = host;
    this.#paletteLayout = paletteLayout;
    this.unlit = {
      acquire: (descriptor) => this.#acquire("unlit", descriptor),
    };
    this.lit = {
      acquire: (descriptor) => this.#acquire("lit", descriptor),
    };
  }

  paletteGroup(lit: boolean, map: boolean): number {
    return skinnedPaletteBindGroupIndex(lit, map);
  }

  prepare(device: GpuDevice, draws: number): void {
    this.#packed = 0;
    if (this.#disposed || draws <= 0) {
      return;
    }
    if (draws <= this.#paletteCapacity) {
      return;
    }
    const capacity = Math.max(draws, this.#paletteCapacity * 2, 1);
    this.#paletteBuffer?.destroy();
    const buffer = device.createBuffer({
      label: "fourJS:joint-palette",
      size: capacity * JOINT_PALETTE_BYTES,
      usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
    });
    this.#paletteBuffer = buffer;
    this.#paletteStaging = new Float32Array(capacity * JOINT_PALETTE_FLOATS);
    this.#paletteCapacity = capacity;
    this.#paletteBindGroup = device.createBindGroup({
      label: "fourJS:joint-palette",
      layout: this.#paletteLayout,
      entries: [
        {
          binding: JOINT_PALETTE_BINDING,
          resource: { buffer, offset: 0, size: JOINT_PALETTE_BYTES },
        },
      ],
    });
  }

  packPalette(palette: Float32Array): number {
    const slot = this.#packed;
    const base = slot * JOINT_PALETTE_FLOATS;
    const staging = this.#paletteStaging;
    const limit = Math.min(palette.length, JOINT_PALETTE_FLOATS);
    // Native copy + fill instead of a 768-iteration scalar loop with a branch
    // per element (2026-09-11 audit); byte-identical output.
    staging.set(palette.subarray(0, limit), base);
    staging.fill(0, base + limit, base + JOINT_PALETTE_FLOATS);
    this.#packed = slot + 1;
    return slot * JOINT_PALETTE_BYTES;
  }

  paletteBindGroup(): GpuBindGroup | null {
    return this.#paletteBindGroup;
  }

  acquireShadow(descriptor: WgpuSkinnedShadowDescriptor): GpuRenderPipeline {
    if (this.#disposed) {
      throw new Error("skinned-shadow: pair is disposed");
    }
    const key = `shadow|${descriptor.topology}|${descriptor.colorFormat}|${descriptor.depthFormat}`;
    const existing = this.#pipelines.get(key);
    if (existing !== undefined) {
      return existing;
    }
    if (this.#shadowFailed) {
      throw new Error("skinned-shadow previously failed to compile");
    }
    const draw = this.#host.drawLayout();
    const device = this.#host.device();
    if (draw === null || device === null) {
      throw new Error("skinned-shadow: missing draw layout or device");
    }
    try {
      const layoutKey = "shadow";
      let layout = this.#pipelineLayouts.get(layoutKey);
      if (layout === undefined) {
        layout = device.createPipelineLayout({
          label: "fourJS:pipeline-layout:skinned:shadow",
          bindGroupLayouts: [draw, this.#paletteLayout],
        });
        this.#pipelineLayouts.set(layoutKey, layout);
      }
      let module = this.#modules.get("shadow");
      if (module === undefined) {
        module = device.createShaderModule({
          label: "fourJS:skinned-shadow",
          code: SKINNED_SHADOW_SHADER_SOURCE,
        });
        this.#modules.set("shadow", module);
      }
      const pipeline = device.createRenderPipeline({
        label: `fourJS:skinned-${key}`,
        layout,
        vertex: {
          module,
          entryPoint: VERTEX_ENTRY_POINT,
          buffers: SKINNED_SHADOW_VERTEX_BUFFER_LAYOUTS,
        },
        fragment: {
          module,
          entryPoint: FRAGMENT_ENTRY_POINT,
          targets: [
            {
              format: descriptor.colorFormat,
              writeMask: COLOR_WRITE_ALL,
            },
          ],
        },
        primitive: { topology: descriptor.topology },
        depthStencil: {
          format: descriptor.depthFormat,
          depthWriteEnabled: true,
          depthCompare: "less",
        },
      });
      this.#pipelines.set(key, pipeline);
      return pipeline;
    } catch (error: unknown) {
      this.#shadowFailed = true;
      throw error;
    }
  }

  upload(device: GpuDevice): void {
    const buffer = this.#paletteBuffer;
    if (buffer === null || this.#packed === 0 || this.#disposed) {
      return;
    }
    device.queue.writeBuffer(
      buffer,
      0,
      this.#paletteStaging,
      0,
      this.#packed * JOINT_PALETTE_FLOATS,
    );
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#paletteBuffer?.destroy();
    this.#forgetState();
  }

  forget(): void {
    this.#disposed = true;
    this.#forgetState();
  }

  #forgetState(): void {
    this.#pipelines.clear();
    this.#modules.clear();
    this.#pipelineLayouts.clear();
    this.#paletteBuffer = null;
    this.#paletteBindGroup = null;
    this.#paletteStaging = new Float32Array(0);
    this.#paletteCapacity = 0;
    this.#packed = 0;
    this.#shadowFailed = false;
  }

  #acquire(
    family: "unlit" | "lit",
    descriptor: WgpuSkinnedDrawDescriptor,
  ): GpuRenderPipeline | null {
    if (this.#disposed) {
      return null;
    }
    const key = descriptorKey(family, descriptor);
    const existing = this.#pipelines.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const layout = this.#layoutFor(family, descriptor);
    if (layout === null) {
      return null;
    }
    const device = this.#host.device();
    if (device === null) {
      return null;
    }
    const module = this.#module(family, descriptor, device);
    const blend = blendStateFor(descriptor.blend);
    const pipeline = device.createRenderPipeline({
      label: `fourJS:skinned-${key}`,
      layout,
      vertex: {
        module,
        entryPoint: VERTEX_ENTRY_POINT,
        buffers:
          family === "unlit"
            ? skinnedUnlitVertexBufferLayouts(
                descriptor.vertexColors,
                descriptor.map,
              )
            : skinnedLitVertexBufferLayouts(descriptor.normals, descriptor.map),
      },
      fragment: {
        module,
        entryPoint: FRAGMENT_ENTRY_POINT,
        targets: [
          {
            format: descriptor.colorFormat,
            ...(blend === undefined ? {} : { blend }),
            writeMask: descriptor.colorWrite ? COLOR_WRITE_ALL : 0,
          },
        ],
      },
      primitive: { topology: descriptor.topology },
      ...(descriptor.depthFormat === null
        ? {}
        : {
            depthStencil: {
              format: descriptor.depthFormat,
              depthWriteEnabled: descriptor.depthWrite,
              depthCompare: descriptor.depthTest ? "less" : "always",
              ...stencilStateFor(descriptor.stencil),
            },
          }),
    });
    this.#pipelines.set(key, pipeline);
    return pipeline;
  }

  #module(
    family: "unlit" | "lit",
    descriptor: WgpuSkinnedDrawDescriptor,
    device: GpuDevice,
  ): GpuShaderModule {
    const moduleKey =
      family === "unlit"
        ? `unlit${descriptor.vertexColors ? "|vc" : ""}${descriptor.map ? "|map" : ""}`
        : `lit${descriptor.normals ? "|n" : ""}${descriptor.map ? "|map" : ""}${descriptor.shadow ? "|sh" : ""}`;
    const existing = this.#modules.get(moduleKey);
    if (existing !== undefined) {
      return existing;
    }
    const module = device.createShaderModule({
      label: `fourJS:skinned-${moduleKey}`,
      code:
        family === "unlit"
          ? skinnedUnlitShaderSource(descriptor.vertexColors, descriptor.map)
          : skinnedLitShaderSource(
              descriptor.normals,
              descriptor.map,
              descriptor.shadow,
            ),
    });
    this.#modules.set(moduleKey, module);
    return module;
  }

  #layoutFor(
    family: "unlit" | "lit",
    descriptor: WgpuSkinnedDrawDescriptor,
  ): GpuPipelineLayout | null {
    const draw = this.#host.drawLayout();
    if (draw === null) {
      return null;
    }
    const groups: GpuBindGroupLayout[] = [draw];
    if (family === "lit") {
      const lights = descriptor.shadow
        ? this.#host.shadowLightsLayout()
        : this.#host.lightsLayout();
      if (lights === null) {
        return null;
      }
      groups.push(lights);
    }
    if (descriptor.map) {
      const texture = this.#host.textureLayout();
      if (texture === null) {
        return null;
      }
      groups.push(texture);
    }
    groups.push(this.#paletteLayout);
    const layoutKey = `${family}|${descriptor.map ? "map" : "-"}|${descriptor.shadow ? "sh" : "-"}`;
    const existing = this.#pipelineLayouts.get(layoutKey);
    if (existing !== undefined) {
      return existing;
    }
    const device = this.#host.device();
    if (device === null) {
      return null;
    }
    const created = device.createPipelineLayout({
      label: `fourJS:pipeline-layout:skinned:${layoutKey}`,
      bindGroupLayouts: groups,
    });
    this.#pipelineLayouts.set(layoutKey, created);
    return created;
  }
}

/**
 * Opts this process's `WebgpuRenderer`s into GPU skinning (§54, §62; RFC 0003).
 *
 * ```ts
 * import { registerSkinningPipeline } from "@fourjs/render-webgpu";
 * registerSkinningPipeline();          // once, at application setup
 * ```
 *
 * Calling it is what links this module — the two skinned colour pipelines,
 * the §69 caster, and the palette uploader — into the bundle; a build that
 * never calls it carries none of it. Pipelines still compile **lazily**:
 * colour on the first skinned colour draw, the caster on the first
 * skinned caster, never here and never at renderer initialize.
 * Idempotent; calling it twice re-installs the same factory.
 *
 * The RFC 0005 skinned id pass lives in `wgpu-picking.ts` behind
 * `registerPickingPipeline()`.
 */
export function registerSkinningPipeline(): void {
  setSkinningPipelineFactory({
    create(host: SkinningPipelineHost): SkinnedPrograms {
      const device = host.device();
      if (device === null) {
        throw new Error("skinning pipeline: no device");
      }
      return new WgpuSkinnedProgramPair(
        host,
        createJointPaletteBindGroupLayout(device),
      );
    },
  });
}
