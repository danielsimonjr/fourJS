/**
 * The node-material pipeline for WebGPU (§60, §62; RFC 0001 — WP-R1.9): a
 * WGSL emitter over `@fourjs/materials`' shader-graph IR, and the per-renderer
 * pipeline store — reached only through
 * {@link registerWebgpuNodeMaterialPipeline}. The twin of
 * `@fourjs/render-webgl`'s `gl-node-program.ts`; where the two backends can
 * agree they do, and every place they cannot is named here.
 *
 * ## No user shader source, at any tier
 *
 * Nothing here accepts WGSL text from outside this repository. The emitter's
 * input is the closed-operator graph (`ShaderGraph`, read through the types
 * `@fourjs/render` re-exposes — the frozen §3.1 row is untouched), its output
 * is a pure, deterministic function of that graph (§33: nodes are visited in
 * **array order**, dead-node elimination is the only transform), and the same
 * closed operators emit the same arithmetic the GLSL emitter emits — WGSL's
 * builtins `sin`/`cos`/`abs`/`floor`/`fract`/`normalize`/`length`/`min`/
 * `max`/`dot`/`step`/`mix`/`saturate` are componentwise IEEE single-precision
 * exactly as GLSL ES 3.00's are, and the infix operators are the same
 * operators. Two spelling divergences, neither a numeric one:
 *
 * - **Mixed scalar/vector `min`/`max`/`step` splat explicitly.** GLSL's
 *   `genType` overloads accept a scalar beside a vector; WGSL's builtins
 *   require matching types, so the emitter splats the scalar operand
 *   (`min(vec3<f32>(n1), n2)`) — the identical componentwise arithmetic,
 *   spelled out.
 * - **`saturate` is the builtin.** GLSL has no `saturate`, so the GLSL
 *   emitter spells `clamp(x, 0.0, 1.0)`; WGSL defines `saturate(x)` as that
 *   very clamp.
 *
 * And two structural divergences, both forced by the backend:
 *
 * - **The §3.3.8 depth remap rides the surface vertex stage** — the same
 *   `(clip.z + clip.w) * 0.5` every family in this package applies
 *   (`wgpu-unlit.ts` owns the argument). Same picture, different clip
 *   convention; the emitted *source* therefore cannot be byte-compared across
 *   backends, which is why each backend has its own §33 golden.
 * - **Uniforms travel as `vec4` lanes in one block, not as locations.** WebGPU
 *   has no `uniform1f`; a program's uniforms are a buffer whose layout the
 *   pipeline bakes in. The block is **all-`vec4`** (`wgpu-lights.ts`' rule:
 *   no member whose alignment the CPU packer must guess): every uniform
 *   occupies whole 16-byte lanes — `float`/`vec2`/`vec3` pad to one lane and
 *   read back narrow (`node.u[k].x`, `.xy`, `.xyz`), `mat3` takes three
 *   lanes, `mat4` four — which is the GLSL emitter's declare-wide/read-narrow
 *   padding rule generalised to a buffer.
 *
 * ## Orientation: the screen domain flips its samples, the surface domain
 * does not
 *
 * The `"screen"` domain's `"uv"` attribute means §7a's normalized coordinate
 * — `v = 0` the **bottom** edge, exactly as the GLSL emitter's screen vertex
 * stage documents — so a procedural screen gradient paints the same picture
 * on both backends. But a sampled *render target* stores its picture
 * top-down on WebGPU (texel row 0 is the top — `wgpu-effect.ts`'s
 * orientation note), so every screen-domain `texture` node samples at
 * `(u, 1 − v)`: a graph copy is then the per-pixel identity the fixed
 * `"copy"` effect ships, never a mirror. Surface-domain samples are **not**
 * flipped — mesh uvs address plain textures identically on both backends
 * (the landed `map` path's convention), and a surface graph sampling a
 * render-target texture inherits this backend's top-left target origin,
 * exactly as the landed unlit/`map`-samples-a-target path does.
 *
 * ## One program per graph structure; pipelines per (source × state)
 *
 * The store keys programs on the **emitted source** (two graphs that emit
 * the same WGSL are one module; a `WeakMap` identity fast path per graph
 * object) — RFC 0001's structural cache, one language over — and, beneath
 * each program, pipelines on the §57 state the descriptor bakes in
 * (blend × depth × colour-write × topology × formats × §67 stencil), the
 * same conditional-suffix key discipline `wgpu-pipeline-cache.ts` uses.
 *
 * ## Lazy in both directions (the pipeline-cost law)
 *
 * Nothing here is reachable from `WebgpuRenderer` — the renderer imports only
 * the registry slot (`wgpu-node-registry.ts`), and this module links into a
 * bundle only when the application calls
 * {@link registerWebgpuNodeMaterialPipeline}. Registration compiles nothing:
 * WGSL modules compile per distinct graph on the first frame that needs
 * them, so a scene with no node material records the byte-identical device
 * transcript it always did (pinned in
 * `tests/integration/webgpu-node-materials.test.ts`).
 *
 * ## Two draw-path divergences from GL, both stated rather than papered over
 *
 * - **A graph that reads a vertex stream its geometry does not carry skips
 *   the draw** (one §85 warning). GL leaves the location disabled and the
 *   attribute reads the constant default `(0, 0, 0, 1)`; a WebGPU pipeline
 *   that declares a vertex buffer must be given one, and inventing a
 *   default-value variant per missing-stream subset would multiply modules
 *   for what is almost surely an authoring error.
 * - **A `"surface"` program drawn as an effect — or a `"screen"` graph on a
 *   renderable — skips.** The domains bake different bind-group and vertex
 *   shapes into their pipelines here, so the cross-domain draw GL happens to
 *   rasterise (garbage, but rasterised) is refused as absence.
 */

import { DEV, FourError, devWarnOnce, type Disposable } from "@fourjs/core";
import {
  SHADER_VALUE_COMPONENTS,
  analyzeShaderGraph,
  createShaderSourceMap,
  resolveShaderSelect,
  SHADER_LIGHT_ARRAY_TYPES,
  MAX_LIGHT_SLOTS,
  type ShaderStorageReflection,
  type ShaderStorageBuffer,
  type ShaderSourceMap,
  isRenderTargetTexture,
  type GraphEffect,
  type NodeRenderItem,
  type RenderItem,
  type RenderStatistics,
  type ShaderAttributeName,
  type ShaderDomain,
  type ShaderGraph,
  type ShaderGraphAnalysis,
  type ShaderNode,
  type ShaderUniformReflection,
  type ShaderValueType,
} from "@fourjs/render";

import {
  GPU_BUFFER_USAGE,
  GPU_SHADER_STAGE,
  type GpuBindGroup,
  type GpuBindGroupEntry,
  type GpuBindGroupLayout,
  type GpuBuffer,
  type GpuPipelineLayout,
  type GpuRenderPassEncoder,
  type GpuRenderPipeline,
  type GpuShaderModule,
  type GpuTextureView,
  type GpuVertexBufferLayout,
} from "./webgpu-device.js";
import { EFFECT_PASS_VERTEX_COUNT } from "./wgpu-effect.js";
import { NORMAL_BUFFER_LAYOUT } from "./wgpu-lit.js";
import {
  blendStateFor,
  stencilStateFor,
  type WgpuStencilDescriptor,
} from "./wgpu-pipeline-cache.js";
import {
  setWebgpuNodeMaterialPipelineFactory,
  type WgpuNodeFrameState,
  type WgpuNodeItemMaterial,
  type WgpuNodeMaterialPipelines,
  type WgpuNodePipelineHost,
} from "./wgpu-node-registry.js";
import type {
  WgpuCacheableRenderTarget,
  WgpuRenderTargetCache,
} from "./wgpu-render-target.js";
import {
  LIGHT_UNIFORM_BYTES,
  LIGHT_UNIFORM_FLOATS,
  LIGHT_UNIFORM_MEMBERS_WGSL,
  LIGHT_UNIFORM_STRIDE_FLOATS,
  writeLightUniforms,
} from "./wgpu-lights.js";
import { applyStencilReference, stencilDescriptor } from "./wgpu-stencil.js";
import {
  COLOR_BUFFER_LAYOUT,
  FRAGMENT_ENTRY_POINT,
  POSITION_BUFFER_LAYOUT,
  UV_BUFFER_LAYOUT,
  VERTEX_ENTRY_POINT,
} from "./wgpu-unlit.js";

/**
 * Byte size of a surface program's fixed block prefix: `viewProjection`
 * (64) + `model` (64) + `params` (16 — opacity in `x`, §9 render time in
 * `y`, two written-zero lanes). Material uniforms follow as `vec4` lanes.
 */
export const NODE_SURFACE_BLOCK_BASE_BYTES = 144;

/**
 * Byte size of a screen program's fixed block prefix: `params` alone (§9
 * render time in `x`, three written-zero lanes). Present only when the graph
 * reads time or uniforms — a graph copy binds no block at all, the landed
 * `"copy"` effect's zero-uniform-traffic property, held structurally.
 */
export const NODE_SCREEN_BLOCK_BASE_BYTES = 16;

/** The bind group a surface program's uniform block occupies. */
export const NODE_SURFACE_BLOCK_GROUP = 0;

/**
 * The bind group a surface program's texture/sampler pairs occupy — group 1,
 * the per-draw-block-then-resources order every family in this package uses.
 * Sampler *i* is `@binding(2i)` (texture) and `@binding(2i + 1)` (sampler),
 * in reflection order (§33).
 */
export const NODE_SURFACE_TEXTURE_GROUP = 1;

/**
 * The bind group a screen program's texture pairs occupy — group 0, the
 * effect family's source-first convention (`wgpu-effect.ts`); its block, when
 * the graph has one, follows at the next index (`EmittedWgslNodeShader.
 * blockGroup` carries the resolved value: 1 behind textures, 0 for a
 * texture-less graph).
 */
export const NODE_SCREEN_TEXTURE_GROUP = 0;

/** What the emitter hands the store — one WGSL module plus its binding data. */
export interface EmittedWgslNodeShader {
  readonly domain: ShaderDomain;
  /** The module: both entry points (`vertexMain`/`fragmentMain`), one string. */
  readonly code: string;
  readonly sourceMap: ShaderSourceMap;
  /** Whether any reachable node reads §9 render time. */
  readonly usesTime: boolean;
  /** Reachable uniforms, reflection order (§33). */
  readonly uniforms: readonly ShaderUniformReflection[];
  /** Reachable sampler names, reflection order (§33). */
  readonly textures: readonly string[];
  /**
   * The vertex streams a surface pipeline binds, **in slot order** —
   * `"position"` always first, then whichever of `"normal"`/`"uv"`/`"color"`
   * the graph reaches, in that fixed order. Empty for a screen program (its
   * triangle comes from the vertex index).
   */
  readonly vertexStreams: readonly ShaderAttributeName[];
  /** Storage buffers read (§82), reflection order; bound as read-only storage. */
  readonly storage: readonly ShaderStorageReflection[];
  /** The bind group the storage buffers occupy (`@binding(i)`), or `null`. */
  readonly storageGroup: number | null;
  /**
   * Whether the graph reads the §68 light block. The block then ends with the
   * renderer's own `LightUniforms` member layout ({@link LIGHT_UNIFORM_BYTES}
   * bytes, packed by `writeLightUniforms`) at {@link lightsByteOffset}.
   */
  readonly usesLights: boolean;
  /** Byte offset of the light tail inside the block, or `-1`. */
  readonly lightsByteOffset: number;
  /** `vec4` lanes the material uniforms occupy (after the fixed prefix). */
  readonly uniformSlots: number;
  /** Bytes of the uniform block, or `0` for a block-less screen program. */
  readonly blockBytes: number;
  /** The bind group the block occupies, or `null` when there is none. */
  readonly blockGroup: number | null;
  /** The bind group the texture pairs occupy, or `null` when there are none. */
  readonly textureGroup: number | null;
}

/** The WGSL spelling of each IR value type. */
const WGSL_TYPES: Readonly<Record<ShaderValueType, string>> = {
  float: "f32",
  vec2: "vec2<f32>",
  vec3: "vec3<f32>",
  vec4: "vec4<f32>",
  mat3: "mat3x3<f32>",
  mat4: "mat4x4<f32>",
};

/** `vec4` lanes each uniform type occupies — the all-`vec4` transport rule. */
const UNIFORM_SLOT_COUNTS: Readonly<Record<ShaderValueType, number>> = {
  float: 1,
  vec2: 1,
  vec3: 1,
  vec4: 1,
  mat3: 3,
  mat4: 4,
};

/** The fixed slot (and declaration) order of the four vertex streams. */
const ATTRIBUTE_ORDER: readonly ShaderAttributeName[] = [
  "position",
  "normal",
  "uv",
  "color",
];

/**
 * The package's shader-location *names* per attribute (`wgpu-unlit.ts` /
 * `wgpu-lit.ts`: 0 position, 1 colour, 2 uv, 3 normal — a location is a name,
 * and this family reuses the names every other family reads them by), and
 * the buffer layout each stream binds.
 */
const ATTRIBUTE_LAYOUTS: Readonly<
  Record<ShaderAttributeName, GpuVertexBufferLayout>
> = {
  position: POSITION_BUFFER_LAYOUT,
  normal: NORMAL_BUFFER_LAYOUT,
  uv: UV_BUFFER_LAYOUT,
  color: COLOR_BUFFER_LAYOUT,
};

/** The vertex-stage parameter declaration per attribute. */
const ATTRIBUTE_DECLARATIONS: Readonly<Record<ShaderAttributeName, string>> = {
  position: `@location(${String(POSITION_BUFFER_LAYOUT.attributes[0].shaderLocation)}) position : vec3<f32>`,
  normal: `@location(${String(NORMAL_BUFFER_LAYOUT.attributes[0].shaderLocation)}) normal : vec3<f32>`,
  uv: `@location(${String(UV_BUFFER_LAYOUT.attributes[0].shaderLocation)}) uv : vec2<f32>`,
  color: `@location(${String(COLOR_BUFFER_LAYOUT.attributes[0].shaderLocation)}) color : vec4<f32>`,
};

/** The varying each attribute travels to the fragment stage in. */
const VARYING_NAMES: Readonly<Record<ShaderAttributeName, string>> = {
  position: "v_position",
  normal: "v_normal",
  uv: "v_uv",
  color: "v_color",
};

/** The varying types, matching {@link ATTRIBUTE_DECLARATIONS}. */
const VARYING_TYPES: Readonly<Record<ShaderAttributeName, string>> = {
  position: "vec3<f32>",
  normal: "vec3<f32>",
  uv: "vec2<f32>",
  color: "vec4<f32>",
};

/** A number as a WGSL float literal — deterministic, exact for every finite value. */
function wgslNumber(value: number): string {
  const text = String(value);
  return /[.e]/i.test(text) ? text : `${text}.0`;
}

/** What {@link nodeExpression} reads beside the node itself. */
interface EmissionContext {
  /** Each node's value type, index-aligned (`analyzeShaderGraph`). */
  readonly types: readonly ShaderValueType[];
  /**
   * Each uniform's first `vec4` lane, by name — a plain record rather than a
   * `Map` so the read is total by type: every reachable `uniform` node's name
   * is a reflection entry, the record is built over the reflection, and a
   * lookup that could type as `undefined` would need an unreachable fallback
   * (the recorded coverage-hole rule).
   */
  readonly uniformSlots: Readonly<Record<string, number>>;
  /** The graph's domain — screen samples flip, surface samples do not. */
  readonly domain: ShaderDomain;
  /** The expression §9 render time reads back from. */
  readonly timeExpression: string;
  /** The graph's compile-time defines (select resolution). */
  readonly defines: Readonly<Record<string, boolean>> | undefined;
}

/** Light-block WGSL member and swizzle per scalar `"light"` member. */
const LIGHT_SCALAR_READS: Readonly<Record<string, string>> = {
  ambient: "node.lights.ambientColor.xyz",
  directionalDirection: "node.lights.lightDirection.xyz",
  directionalColor: "node.lights.lightColor.xyz",
  cameraPosition: "node.lights.cameraPosition.xyz",
  punctualCount: "node.lights.counts.x",
};

/** Light-block WGSL array member per array `"light"` member. */
const LIGHT_ARRAY_MEMBERS: Readonly<Record<string, string>> = {
  punctualPosition: "punctualPosition",
  punctualColor: "punctualColor",
  punctualDirection: "punctualDirection",
  punctualParams: "punctualParams",
};

/** The expression reading uniform lane(s) back at the IR type. */
function uniformReadExpression(type: ShaderValueType, slot: number): string {
  switch (type) {
    case "float":
      return `node.u[${String(slot)}].x`;
    case "vec2":
      return `node.u[${String(slot)}].xy`;
    case "vec3":
      return `node.u[${String(slot)}].xyz`;
    case "vec4":
      return `node.u[${String(slot)}]`;
    case "mat3":
      return (
        `mat3x3<f32>(node.u[${String(slot)}].xyz, ` +
        `node.u[${String(slot + 1)}].xyz, node.u[${String(slot + 2)}].xyz)`
      );
    default:
      // "mat4" — the union's last member.
      return (
        `mat4x4<f32>(node.u[${String(slot)}], node.u[${String(slot + 1)}], ` +
        `node.u[${String(slot + 2)}], node.u[${String(slot + 3)}])`
      );
  }
}

/** WGSL infix operator per componentwise binary op; others are builtins. */
const BINARY_OPERATORS: Readonly<Record<string, string>> = {
  add: "+",
  subtract: "-",
  multiply: "*",
  divide: "/",
};

/**
 * A `min`/`max`/`step` call with WGSL's matching-type rule satisfied: the
 * scalar operand of a mixed pair is splat to the vector type — the identical
 * componentwise arithmetic GLSL's `genType` overloads perform implicitly
 * (module header, spelling divergence 1). `dot` never mixes (the IR requires
 * two vectors of one size), so it passes through the equal-types arm.
 */
function builtinCall(
  op: string,
  left: string,
  leftType: ShaderValueType,
  right: string,
  rightType: ShaderValueType,
): string {
  if (leftType === rightType) {
    return `${op}(${left}, ${right})`;
  }
  return leftType === "float"
    ? `${op}(${WGSL_TYPES[rightType]}(${left}), ${right})`
    : `${op}(${left}, ${WGSL_TYPES[leftType]}(${right}))`;
}

/** The WGSL expression computing `node`, referencing locals `n<id>`. */
function nodeExpression(
  node: ShaderNode,
  stage: "vertex" | "fragment",
  context: EmissionContext,
): string {
  switch (node.kind) {
    case "constant":
      return node.value.length === 1
        ? wgslNumber(node.value[0])
        : `${WGSL_TYPES[node.type]}(${node.value.map(wgslNumber).join(", ")})`;
    case "uniform":
      return uniformReadExpression(node.type, context.uniformSlots[node.name]);
    case "attribute":
      return stage === "vertex"
        ? node.name
        : `input.${VARYING_NAMES[node.name]}`;
    case "texture": {
      const uv = `n${String(node.uv)}`;
      // Screen-domain samples flip `v` (module header: a sampled target
      // stores its picture top-down here); surface-domain samples do not.
      const coordinate =
        context.domain === "screen" ? `vec2<f32>(${uv}.x, 1.0 - ${uv}.y)` : uv;
      return `textureSample(t_${node.name}, s_${node.name}, ${coordinate})`;
    }
    case "time":
      return context.timeExpression;
    case "compose":
      return `${WGSL_TYPES[node.type]}(${node.parts
        .map((part) => `n${String(part)}`)
        .join(", ")})`;
    case "swizzle":
      return `n${String(node.source)}.${node.pattern}`;
    case "unary": {
      const source = `n${String(node.source)}`;
      if (node.op === "negate") {
        return `(-${source})`;
      }
      // `saturate` is WGSL's own builtin — defined as the very
      // `clamp(x, 0, 1)` the GLSL emitter spells out — and the remaining ops
      // (`sin`, `cos`, `abs`, `floor`, `fract`, `normalize`, `length`) keep
      // their names. `"angle"` is RFC 0001's closed-union amendment: WGSL's
      // `atan2(y, x)`, matching the GLSL emitter's `atan(y, x)`.
      if (node.op === "angle") {
        return `atan2(${source}.y, ${source}.x)`;
      }
      return `${node.op}(${source})`;
    }
    case "binary": {
      const operator = BINARY_OPERATORS[node.op];
      const left = `n${String(node.left)}`;
      const right = `n${String(node.right)}`;
      return operator === undefined
        ? builtinCall(
            node.op,
            left,
            context.types[node.left],
            right,
            context.types[node.right],
          )
        : `(${left} ${operator} ${right})`;
    }
    case "mix":
      return `mix(n${String(node.a)}, n${String(node.b)}, n${String(node.t)})`;
    case "select":
      // The dead branch was never marked reachable, so it has no local.
      return `n${String(resolveShaderSelect(node, context.defines))}`;
    case "storage":
      return (
        `st_${node.name}[min(u32(max(n${String(node.index)}, 0.0)), ` +
        `${String(node.count - 1)}u)]`
      );
    default: {
      // "light" — the union's last member. Array members clamp their float
      // index into the block's slot range; the block is all-vec4, so a vec3
      // member reads `.xyz` and `punctualParams` reads the whole lane.
      if (node.index === undefined) {
        return LIGHT_SCALAR_READS[node.member];
      }
      const lane =
        `node.lights.${LIGHT_ARRAY_MEMBERS[node.member]}[clamp(i32(n` +
        `${String(node.index)}), 0, ${String(MAX_LIGHT_SLOTS - 1)})]`;
      return SHADER_LIGHT_ARRAY_TYPES[
        node.member as keyof typeof SHADER_LIGHT_ARRAY_TYPES
      ] === "vec4"
        ? lane
        : `${lane}.xyz`;
    }
  }
}

/** One `let nK : T = expr;` line per reachable node, array order (§33). */
function emitLocals(
  graph: ShaderGraph,
  context: EmissionContext,
  reachable: readonly boolean[],
  stage: "vertex" | "fragment",
): string {
  let out = "";
  for (let index = 0; index < graph.nodes.length; index += 1) {
    if (!reachable[index]) {
      continue;
    }
    const expression = nodeExpression(graph.nodes[index], stage, context);
    out += `  let n${String(index)} : ${WGSL_TYPES[context.types[index]]} = ${expression};\n`;
  }
  return out;
}

/** The attributes one subgraph reads, in fixed slot order. */
function attributesUsed(
  graph: ShaderGraph,
  reachable: readonly boolean[],
): ShaderAttributeName[] {
  const seen = new Set<ShaderAttributeName>();
  for (let index = 0; index < graph.nodes.length; index += 1) {
    const node = graph.nodes[index];
    if (reachable[index] && node.kind === "attribute") {
      seen.add(node.name);
    }
  }
  return ATTRIBUTE_ORDER.filter((name) => seen.has(name));
}

/** Assigns each reflected uniform its first `vec4` lane, reflection order. */
function assignUniformSlots(uniforms: readonly ShaderUniformReflection[]): {
  slots: Record<string, number>;
  total: number;
} {
  const slots: Record<string, number> = {};
  let total = 0;
  for (const uniform of uniforms) {
    slots[uniform.name] = total;
    total += UNIFORM_SLOT_COUNTS[uniform.type];
  }
  return { slots, total };
}

/** The texture/sampler declarations at `group`, reflection order (§33). */
function emitTextureDeclarations(
  textures: readonly string[],
  group: number,
): string {
  let out = "";
  for (let index = 0; index < textures.length; index += 1) {
    const name = textures[index];
    out +=
      `@group(${String(group)}) @binding(${String(index * 2)}) ` +
      `var t_${name} : texture_2d<f32>;\n` +
      `@group(${String(group)}) @binding(${String(index * 2 + 1)}) ` +
      `var s_${name} : sampler;\n`;
  }
  return out;
}

/** The read-only storage declarations at `group`, reflection order (§82, §33). */
function emitStorageDeclarations(
  storage: readonly ShaderStorageReflection[],
  group: number,
): string {
  let out = "";
  for (let index = 0; index < storage.length; index += 1) {
    const element = WGSL_TYPES[storage[index].type];
    out +=
      `@group(${String(group)}) @binding(${String(index)}) ` +
      `var<storage, read> st_${storage[index].name} : array<${element}>;\n`;
  }
  return out;
}

/**
 * Emits the WGSL module for `graph` — both stages plus the binding metadata
 * the store builds layouts and pipelines from.
 *
 * Pure and deterministic: the same graph emits the same bytes, every time, on
 * every platform (§33 — pinned by `tests/determinism/`'s
 * `node-material-wgsl.json` golden, beside the GLSL emitter's). Validation is
 * `analyzeShaderGraph`'s and throws its `RangeError` for a malformed graph; a
 * graph that validates always emits.
 */
export function emitShaderGraphWgsl(graph: ShaderGraph): EmittedWgslNodeShader {
  const analysis: ShaderGraphAnalysis = analyzeShaderGraph(graph);
  const usesTime = graph.nodes.some(
    (node, index) =>
      node.kind === "time" &&
      (analysis.colorReachable[index] || analysis.offsetReachable[index]),
  );
  const textures = analysis.reflection.textures.map((record) => record.name);
  const { slots, total } = assignUniformSlots(analysis.reflection.uniforms);

  if (graph.domain === "screen") {
    return emitScreen(graph, analysis, usesTime, textures, slots, total);
  }

  const usesLights = analysis.reflection.lights.length > 0;
  const lightsByteOffset = usesLights
    ? NODE_SURFACE_BLOCK_BASE_BYTES + total * 16
    : -1;
  const blockBytes =
    NODE_SURFACE_BLOCK_BASE_BYTES +
    total * 16 +
    (usesLights ? LIGHT_UNIFORM_BYTES : 0);
  const context: EmissionContext = {
    types: analysis.nodeTypes,
    uniformSlots: slots,
    domain: "surface",
    timeExpression: "node.params.y",
    defines: graph.defines,
  };
  const storage = analysis.reflection.storage;

  // The block: prefix members plus the uniform lanes (module header).
  let code = "";
  if (usesLights) {
    // The renderer's own light-block members (`wgpu-lights.ts`), nested at the
    // block's tail — no extra bind group, one layout, one packer.
    code += `struct NodeLights {\n${LIGHT_UNIFORM_MEMBERS_WGSL}\n};\n\n`;
  }
  code += "struct NodeUniforms {\n";
  code += "  viewProjection : mat4x4<f32>,\n";
  code += "  model : mat4x4<f32>,\n";
  code += "  params : vec4<f32>,\n";
  if (total > 0) {
    code += `  u : array<vec4<f32>, ${String(total)}>,\n`;
  }
  if (usesLights) {
    code += "  lights : NodeLights,\n";
  }
  code += "};\n\n";
  code += `@group(${String(NODE_SURFACE_BLOCK_GROUP)}) @binding(0) var<uniform> node : NodeUniforms;\n`;
  if (textures.length > 0) {
    code += `\n${emitTextureDeclarations(textures, NODE_SURFACE_TEXTURE_GROUP)}`;
  }
  // §82: read-only storage buffers, one group after the textures'.
  const storageGroup =
    storage.length === 0
      ? null
      : textures.length > 0
        ? NODE_SURFACE_TEXTURE_GROUP + 1
        : NODE_SURFACE_TEXTURE_GROUP;
  if (storageGroup !== null) {
    code += `\n${emitStorageDeclarations(storage, storageGroup)}`;
  }

  // The vertex stage declares the union of what either subgraph reads (plus
  // position); the fragment stage's attributes travel as varyings.
  const fragmentAttributes = attributesUsed(graph, analysis.colorReachable);
  const vertexAttributes = attributesUsed(graph, analysis.offsetReachable);
  const declared = new Set<ShaderAttributeName>(["position"]);
  for (const name of [...vertexAttributes, ...fragmentAttributes]) {
    declared.add(name);
  }
  const vertexStreams = ATTRIBUTE_ORDER.filter((name) => declared.has(name));

  code += "\nstruct VertexOutput {\n";
  code += "  @builtin(position) position : vec4<f32>,\n";
  for (let index = 0; index < fragmentAttributes.length; index += 1) {
    const name = fragmentAttributes[index];
    code += `  @location(${String(index)}) ${VARYING_NAMES[name]} : ${VARYING_TYPES[name]},\n`;
  }
  code += "};\n\n@vertex\nfn ";
  code += `${VERTEX_ENTRY_POINT}(\n`;
  code += vertexStreams
    .map((name) => `  ${ATTRIBUTE_DECLARATIONS[name]},`)
    .join("\n");
  code += "\n) -> VertexOutput {\n  var output : VertexOutput;\n";
  for (const name of fragmentAttributes) {
    code += `  output.${VARYING_NAMES[name]} = ${name};\n`;
  }
  const offset = graph.positionOffset;
  if (offset !== undefined) {
    code += emitLocals(graph, context, analysis.offsetReachable, "vertex");
  }
  const displaced =
    offset === undefined ? "position" : `(position + n${String(offset)})`;
  code += `  let clip = node.viewProjection * node.model * vec4<f32>(${displaced}, 1.0);\n`;
  code +=
    "  // WebGL clip depth [-w, w] onto WebGPU's [0, w]; see wgpu-unlit.ts.\n";
  code +=
    "  output.position = vec4<f32>(clip.x, clip.y, (clip.z + clip.w) * 0.5, clip.w);\n";
  code += "  return output;\n}\n\n@fragment\nfn ";
  code += `${FRAGMENT_ENTRY_POINT}(input : VertexOutput) -> @location(0) vec4<f32> {\n`;
  code += emitLocals(graph, context, analysis.colorReachable, "fragment");
  code += `  let c = n${String(graph.color)};\n`;
  // §57's opacity multiplies the graph's alpha — the family rule, packed per
  // draw into `params.x`.
  code += "  return vec4<f32>(c.rgb, c.a * node.params.x);\n}\n";

  return {
    domain: "surface",
    code,
    sourceMap: createShaderSourceMap(code),
    usesTime,
    uniforms: analysis.reflection.uniforms,
    textures,
    vertexStreams,
    storage,
    storageGroup,
    usesLights,
    lightsByteOffset,
    uniformSlots: total,
    blockBytes,
    blockGroup: NODE_SURFACE_BLOCK_GROUP,
    textureGroup: textures.length > 0 ? NODE_SURFACE_TEXTURE_GROUP : null,
  };
}

/** The `"screen"` half of {@link emitShaderGraphWgsl}. */
function emitScreen(
  graph: ShaderGraph,
  analysis: ShaderGraphAnalysis,
  usesTime: boolean,
  textures: readonly string[],
  slots: Record<string, number>,
  total: number,
): EmittedWgslNodeShader {
  const hasBlock = usesTime || total > 0;
  const blockBytes = hasBlock ? NODE_SCREEN_BLOCK_BASE_BYTES + total * 16 : 0;
  const blockIndex = textures.length > 0 ? 1 : 0;
  const blockGroup = hasBlock ? blockIndex : null;
  const context: EmissionContext = {
    types: analysis.nodeTypes,
    uniformSlots: slots,
    domain: "screen",
    timeExpression: "node.params.x",
    defines: graph.defines,
  };
  const usesUv = attributesUsed(graph, analysis.colorReachable).length > 0;

  let code = "";
  if (textures.length > 0) {
    code += emitTextureDeclarations(textures, NODE_SCREEN_TEXTURE_GROUP);
    code += "\n";
  }
  if (hasBlock) {
    code += "struct NodeUniforms {\n  params : vec4<f32>,\n";
    if (total > 0) {
      code += `  u : array<vec4<f32>, ${String(total)}>,\n`;
    }
    code += "};\n\n";
    code += `@group(${String(blockIndex)}) @binding(0) var<uniform> node : NodeUniforms;\n\n`;
  }
  code += "struct VertexOutput {\n";
  code += "  @builtin(position) position : vec4<f32>,\n";
  if (usesUv) {
    code += "  @location(0) v_uv : vec2<f32>,\n";
  }
  code += "};\n\n@vertex\nfn ";
  // The effect family's full-screen triangle, with §7a's coordinate: `v = 0`
  // is the **bottom** edge (clip `y = −1`), matching the GLSL screen vertex
  // stage — the flip a *sample* needs is applied at the sample (module
  // header), never to the coordinate itself.
  code += `${VERTEX_ENTRY_POINT}(@builtin(vertex_index) index : u32) -> VertexOutput {\n`;
  code += "  let corner = i32(index);\n";
  code += "  let x = f32(corner / 2) * 4.0 - 1.0;\n";
  code += "  let y = f32(corner & 1) * 4.0 - 1.0;\n";
  code += "  var output : VertexOutput;\n";
  code += "  output.position = vec4<f32>(x, y, 0.0, 1.0);\n";
  if (usesUv) {
    code += "  output.v_uv = vec2<f32>((x + 1.0) * 0.5, (y + 1.0) * 0.5);\n";
  }
  code += "  return output;\n}\n\n@fragment\nfn ";
  code += `${FRAGMENT_ENTRY_POINT}(input : VertexOutput) -> @location(0) vec4<f32> {\n`;
  code += emitLocals(graph, context, analysis.colorReachable, "fragment");
  code += `  return n${String(graph.color)};\n}\n`;

  return {
    domain: "screen",
    code,
    sourceMap: createShaderSourceMap(code),
    usesTime,
    uniforms: analysis.reflection.uniforms,
    textures,
    vertexStreams: [],
    storage: [],
    storageGroup: null,
    usesLights: false,
    lightsByteOffset: -1,
    uniformSlots: total,
    blockBytes,
    blockGroup,
    textureGroup: textures.length > 0 ? NODE_SCREEN_TEXTURE_GROUP : null,
  };
}

/** All four colour channels writable (`GPUColorWrite.ALL`). */
const COLOR_WRITE_ALL = 0xf;

/** The dynamic-offset alignment node blocks stride at (`UNIFORM_STRIDE_BYTES`). */
const NODE_STRIDE_ALIGNMENT = 256;

/**
 * Scratch for texture-group resolution — `nodeTextureScratch`'s twin, one
 * flat array of interleaved (view, sampler) pairs so the cache comparison is
 * a single loop over one identity per slot (a paired-arrays comparison would
 * carry an unreachable second disjunct: a sampler never changes without its
 * view — the texture cache re-creates both on a version bump, and the target
 * cache's sampler is shared for its life).
 */
const pairScratch: object[] = [];

/** Scratch the light block is packed into before its prefix is copied. */
const lightScratch = new Float32Array(LIGHT_UNIFORM_STRIDE_FLOATS);

/** Scratch for storage-group resolution (at most `MAX_SHADER_GRAPH_STORAGE`). */
const storageScratch: GpuBuffer[] = [];

/** One uploaded storage buffer (§82): the GPU copy and the version it holds. */
interface StorageRecord {
  readonly gpu: GpuBuffer;
  version: number;
}

/** One material's cached storage bind group and the GPU buffers it spans. */
interface NodeStorageGroup {
  readonly buffers: GpuBuffer[];
  readonly group: GpuBindGroup;
}

/** One material's (or effect's) cached texture bind group. */
interface NodeTextureGroup {
  /** The interleaved (view, sampler) identities the group was built over. */
  keys: object[];
  group: GpuBindGroup;
}

/** The §57 state one node pipeline bakes in — the store's second key half. */
interface NodePipelineState {
  readonly blend: "none" | "normal" | "additive" | "multiply" | "screen";
  readonly depthTest: boolean;
  readonly depthWrite: boolean;
  readonly colorWrite: boolean;
  readonly topology: "triangle-list" | "line-list";
  readonly colorFormat: string;
  readonly depthFormat: string | null;
  readonly stencil: WgpuStencilDescriptor | null;
}

/** One compiled node program: module, layouts, and its pipeline map. */
interface NodeProgramRecord {
  readonly emitted: EmittedWgslNodeShader;
  readonly module: GpuShaderModule;
  /** Surface block stride: `blockBytes` aligned up to 256; `0` for screen. */
  readonly strideBytes: number;
  readonly pipelineLayout: GpuPipelineLayout;
  readonly vertexLayouts: readonly GpuVertexBufferLayout[];
  /** Pipelines by {@link nodePipelineKey}. */
  readonly pipelines: Map<string, GpuRenderPipeline>;
  /** Surface: the group over the shared buffer; dropped on regrowth. */
  drawBindGroup: GpuBindGroup | null;
  /** Screen: this program's own block buffer, staging, and group. */
  screenBuffer: GpuBuffer | null;
  screenStaging: Float32Array | null;
  screenBindGroup: GpuBindGroup | null;
}

/** The canonical key for one pipeline's state — fixed order, total (§33). */
function nodePipelineKey(state: NodePipelineState): string {
  let key = [
    state.blend,
    state.depthTest ? "dt" : "-",
    state.depthWrite ? "dw" : "-",
    state.colorWrite ? "cw" : "-",
    state.topology,
    state.colorFormat,
    state.depthFormat ?? "-",
  ].join("|");
  const stencil = state.stencil;
  if (stencil !== null) {
    key +=
      `|s:${stencil.func},${String(stencil.readMask)},` +
      `${String(stencil.writeMask)},${stencil.failOp},` +
      `${stencil.depthFailOp},${stencil.passOp}`;
  }
  return key;
}

/**
 * One renderer's node pipeline store — the registry interface implemented
 * (`wgpu-node-registry.ts` owns each member's contract). Created per device
 * by the registered factory; forgotten on device loss, disposed with the
 * renderer.
 */
export class WgpuNodePipelineStore
  implements WgpuNodeMaterialPipelines, Disposable
{
  readonly #host: WgpuNodePipelineHost;

  /** Identity fast path plus the per-graph emission-failure latch (`null`). */
  readonly #byGraph = new WeakMap<ShaderGraph, NodeProgramRecord | null>();

  /** The structural cache: emitted WGSL → the one program record. */
  readonly #bySource = new Map<string, NodeProgramRecord>();

  /** Block layouts by `${"d"|"s"}:${bytes}` (dynamic draw / static screen). */
  readonly #blockLayouts = new Map<string, GpuBindGroupLayout>();

  /** Texture-group layouts by pair count. */
  readonly #textureLayouts = new Map<number, GpuBindGroupLayout>();

  /** Storage-group layouts by buffer count (§82). */
  readonly #storageLayouts = new Map<number, GpuBindGroupLayout>();

  /** GPU copies of storage buffers, keyed by the application's buffer. */
  readonly #storageBuffers = new Map<ShaderStorageBuffer, StorageRecord>();

  /** Cached storage bind groups per material. */
  readonly #storageGroups = new WeakMap<object, NodeStorageGroup>();

  /** Cached texture bind groups per material / per graph effect. */
  readonly #textureGroups = new WeakMap<object, NodeTextureGroup>();

  /** The shared strided buffer surface draws offset into. Grows only. */
  #buffer: GpuBuffer | null = null;

  #staging = new Float32Array(0);

  #capacityBytes = 0;

  /** The frame's write cursor into the staging array, in bytes. */
  #cursorBytes = 0;

  /** Distinguishes the one-time warnings of distinct failed graphs. */
  #failureSerial = 0;

  readonly #compilationErrors: FourError[] = [];

  /** Asynchronous GPU compiler errors with graph provenance; authoring diagnostics. */
  get compilationErrors(): readonly FourError[] {
    return [...this.#compilationErrors];
  }

  #disposed = false;

  constructor(host: WgpuNodePipelineHost) {
    this.#host = host;
  }

  /** Distinct WGSL modules compiled so far. */
  get programCount(): number {
    return this.#bySource.size;
  }

  /** Whether {@link WgpuNodePipelineStore.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  beginFrame(items: readonly RenderItem[], viewCount: number): boolean {
    this.#cursorBytes = 0;
    if (this.#disposed) {
      return false;
    }
    let bytesPerView = 0;
    for (const item of items) {
      if (item.kind !== "node") {
        continue;
      }
      // `material.graph` is an application accessor on a structural double;
      // the renderer re-checks its own disposal after this call, and the
      // disposal check below keeps this store from allocating onto a dead
      // device if the accessor tore it down mid-scan.
      const record = this.#acquire(item.material.graph);
      if (record !== null && record.emitted.domain === "surface") {
        bytesPerView += record.strideBytes;
      }
    }
    if (bytesPerView === 0 || this.#disposed) {
      return false;
    }
    this.#growBuffer(bytesPerView * viewCount);
    return true;
  }

  draw(
    pass: GpuRenderPassEncoder,
    item: NodeRenderItem,
    frame: WgpuNodeFrameState,
  ): number {
    if (this.#disposed) {
      return frame.stencilReference;
    }
    const material = item.material;
    const record = this.#byGraph.get(material.graph) ?? null;
    // A latched or never-resolved graph, a `"screen"` graph on a renderable
    // (module header, draw-path divergence 2), or a frame that never sized
    // the buffer (a direct `draw` with no `beginFrame`): absence, not
    // approximation.
    const buffer = this.#buffer;
    if (
      record === null ||
      record.emitted.domain !== "surface" ||
      buffer === null
    ) {
      return frame.stencilReference;
    }

    // 1. Textures — resolved before anything is recorded (§61, §83; R-4's
    // feedback rule per sampled surface), exactly as the GL node arm orders
    // its skips.
    let textureGroup: GpuBindGroup | null = null;
    if (record.emitted.textures.length > 0) {
      textureGroup = this.#materialTextureGroup(
        material,
        record,
        frame.activeTarget,
      );
      if (textureGroup === null) {
        if (DEV) {
          devWarnOnce(
            `webgpu-node-texture:${material.id}`,
            `§60: node material "${material.id}" samples a texture that is ` +
              "unbound, disposed, or the surface being drawn into; its " +
              "draws are skipped (§83).",
          );
        }
        return frame.stencilReference;
      }
    }

    // 1b. Storage buffers (§82) — resolved and uploaded before anything is
    // recorded; an unbound or disposed buffer skips the draw.
    let storageGroup: GpuBindGroup | null = null;
    if (record.emitted.storage.length > 0) {
      storageGroup = this.#materialStorageGroup(material, record);
      if (storageGroup === null) {
        if (DEV) {
          devWarnOnce(
            `webgpu-node-storage:${material.id}`,
            `§82: node material "${material.id}" reads a storage buffer ` +
              "that is unbound or disposed; its draws are skipped.",
          );
        }
        return frame.stencilReference;
      }
    }

    // 2. Geometry — the shared cache's record, with the normal stream asked
    // for exactly when the graph reads it (the shaded arm's rule).
    const needsNormals = record.emitted.vertexStreams.includes("normal");
    const geometry = this.#host.geometries.acquire(item.geometry, needsNormals);
    if (geometry === null) {
      return frame.stencilReference;
    }
    for (const stream of record.emitted.vertexStreams) {
      if (this.#streamBuffer(geometry, stream) === null) {
        // GL leaves the location disabled and reads the default attribute; a
        // WebGPU pipeline must be given every buffer it declares (module
        // header, draw-path divergence 1).
        if (DEV) {
          devWarnOnce(
            `webgpu-node-stream:${material.id}`,
            `§60: node material "${material.id}" reads the "${stream}" ` +
              "vertex stream, which its geometry does not carry; on this " +
              "backend the draw is skipped (GL shades it with the default " +
              "attribute instead — a recorded divergence).",
          );
        }
        return frame.stencilReference;
      }
    }

    // 3. Pipeline — §57's state as identity, the unlit arm's readings.
    const clip = item.clip ?? null;
    const stencilRecord = frame.frameStencil
      ? clip !== null
        ? clip.stencil
        : material.stencil
      : undefined;
    const pipeline = this.#pipelineFor(record, {
      blend:
        material.transparent === true
          ? (material.blendMode ?? "normal")
          : "none",
      depthTest: frame.depthFormat !== null && material.depthTest !== false,
      depthWrite: frame.depthFormat !== null && material.depthWrite !== false,
      colorWrite: material.colorWrite !== false,
      topology: geometry.topology,
      colorFormat: frame.colorFormat,
      depthFormat: frame.depthFormat,
      stencil:
        stencilRecord === undefined ? null : stencilDescriptor(stencilRecord),
    });

    // 4. The uniform block — every byte of the stride written this frame
    // (§33: the staging array is reused, and an uploaded byte nobody wrote
    // is history).
    const cursor = this.#cursorBytes;
    const base = cursor / 4;
    const staging = this.#staging;
    for (let index = 0; index < 16; index += 1) {
      staging[base + index] = frame.viewProjection.elements[index];
      staging[base + 16 + index] = item.worldMatrix.elements[index];
    }
    staging[base + 32] = material.opacity ?? 1;
    staging[base + 33] = frame.renderTime;
    staging[base + 34] = 0;
    staging[base + 35] = 0;
    let lane = base + 36;
    for (const uniform of record.emitted.uniforms) {
      lane = writeUniformLanes(
        staging,
        lane,
        uniform.type,
        material.getUniform(uniform.name),
      );
    }
    for (let index = lane; index < base + record.strideBytes / 4; index += 1) {
      staging[index] = 0;
    }
    if (record.emitted.usesLights) {
      // §68's block, packed by the renderer's own packer into scratch, whose
      // prefix (the `LightUniforms` members) is the node block's tail.
      const lights = frame.lights;
      const tail = base + record.emitted.lightsByteOffset / 4;
      if (lights === null) {
        staging.fill(0, tail, tail + LIGHT_UNIFORM_FLOATS);
      } else {
        writeLightUniforms(
          lightScratch,
          0,
          lights,
          frame.eyeX,
          frame.eyeY,
          frame.eyeZ,
        );
        for (let index = 0; index < LIGHT_UNIFORM_FLOATS; index += 1) {
          staging[tail + index] = lightScratch[index];
        }
      }
    }

    // 5. Record the draw.
    pass.setPipeline(pipeline);
    pass.setBindGroup(
      NODE_SURFACE_BLOCK_GROUP,
      this.#drawBindGroup(record, buffer),
      [cursor],
    );
    if (textureGroup !== null) {
      pass.setBindGroup(NODE_SURFACE_TEXTURE_GROUP, textureGroup);
    }
    if (storageGroup !== null) {
      pass.setBindGroup(record.emitted.storageGroup!, storageGroup);
    }
    let reference = frame.stencilReference;
    if (stencilRecord !== undefined) {
      reference = applyStencilReference(pass, reference, stencilRecord.ref);
    }
    let slot = 0;
    for (const stream of record.emitted.vertexStreams) {
      pass.setVertexBuffer(slot, this.#streamBuffer(geometry, stream));
      slot += 1;
    }
    if (geometry.indexBuffer !== null && geometry.indexFormat !== null) {
      pass.setIndexBuffer(geometry.indexBuffer, geometry.indexFormat);
      pass.drawIndexed(geometry.count);
    } else {
      pass.draw(geometry.count);
    }
    const statistics = frame.statistics;
    if (statistics !== null) {
      countNodeDraw(statistics, geometry.topology, geometry.count);
    }
    this.#cursorBytes = cursor + record.strideBytes;
    return reference;
  }

  endFrame(): void {
    const buffer = this.#buffer;
    if (this.#cursorBytes === 0 || buffer === null || this.#disposed) {
      return;
    }
    this.#host.device.queue.writeBuffer(
      buffer,
      0,
      this.#staging,
      0,
      this.#cursorBytes / 4,
    );
    this.#cursorBytes = 0;
  }

  renderGraphEffect(
    effect: GraphEffect,
    source: WgpuCacheableRenderTarget,
    destination: WgpuCacheableRenderTarget | null,
    colorFormat: string,
    colorView: () => GpuTextureView,
    renderTime: number,
    statistics: RenderStatistics | null,
  ): void {
    if (this.#disposed) {
      return;
    }
    const record = this.#acquire(effect.graph);
    // A latched graph, or a `"surface"` graph reaching `renderEffect` past
    // `validateEffectRenderPass` (a hand-built pass): skipped, the module
    // header's divergence 2.
    if (record === null || record.emitted.domain !== "screen") {
      return;
    }
    let textureGroup: GpuBindGroup | null = null;
    if (record.emitted.textures.length > 0) {
      textureGroup = this.#effectTextureGroup(
        effect,
        record,
        source,
        destination,
      );
      if (textureGroup === null) {
        return;
      }
    }
    const pipeline = this.#pipelineFor(record, {
      // §70: an effect replaces — no blend, no depth attachment at all.
      blend: "none",
      depthTest: false,
      depthWrite: false,
      colorWrite: true,
      topology: "triangle-list",
      colorFormat,
      depthFormat: null,
      stencil: null,
    });
    // The block index doubles as the has-a-block discriminant: emission sets
    // it exactly when `blockBytes > 0`, so one branch serves both reads (an
    // index-and-group pair, rather than two nullables whose agreement would
    // be an unreachable re-check).
    const blockIndex = record.emitted.blockGroup;
    const blockBinding =
      blockIndex === null
        ? null
        : {
            index: blockIndex,
            group: this.#screenBlock(record, effect, renderTime),
          };

    const device = this.#host.device;
    const encoder = device.createCommandEncoder({ label: "fourJS:effect" });
    const renderPass = encoder.beginRenderPass({
      label: "fourJS:effect:graph",
      // "load", not "clear" — §70's replace contract, `wgpu-effect.ts`.
      colorAttachments: [
        { view: colorView(), loadOp: "load", storeOp: "store" },
      ],
    });
    renderPass.setPipeline(pipeline);
    if (textureGroup !== null) {
      renderPass.setBindGroup(NODE_SCREEN_TEXTURE_GROUP, textureGroup);
    }
    if (blockBinding !== null) {
      renderPass.setBindGroup(blockBinding.index, blockBinding.group);
    }
    renderPass.draw(EFFECT_PASS_VERTEX_COUNT);
    renderPass.end();
    device.queue.submit([encoder.finish()]);
    if (statistics !== null) {
      countNodeDraw(statistics, "triangle-list", EFFECT_PASS_VERTEX_COUNT);
    }
  }

  /**
   * Drops every reference **without destroying anything** — the device-loss
   * path (§61): the allocations belong to a device that no longer exists.
   */
  forget(): void {
    this.#bySource.clear();
    this.#blockLayouts.clear();
    this.#textureLayouts.clear();
    this.#storageLayouts.clear();
    this.#storageBuffers.clear();
    this.#buffer = null;
    this.#staging = new Float32Array(0);
    this.#capacityBytes = 0;
    this.#cursorBytes = 0;
    this.#disposed = true;
  }

  /** Destroys the store's buffers and drops everything else (§83). Idempotent. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    for (const record of this.#bySource.values()) {
      record.screenBuffer?.destroy();
    }
    this.#buffer?.destroy();
    for (const stored of this.#storageBuffers.values()) {
      stored.gpu.destroy();
    }
    this.forget();
  }

  /**
   * The program record for `graph`, compiling its module on first sight —
   * the RFC 0001 structural cache: identity fast path, then the emitted
   * source, then a fresh record. A malformed graph (a hand-built item or
   * pass that bypassed `NodeMaterial`/`validateEffectRenderPass`) is latched
   * `null` with one §85 warning; a WGSL *driver* refusal needs no latch
   * here — `createShaderModule` reports asynchronously through the device's
   * error scopes and the invalid pipeline draws nothing
   * (`wgpu-pipeline-cache.ts`'s recorded reading of the error model).
   */
  #acquire(graph: ShaderGraph): NodeProgramRecord | null {
    if (this.#disposed) {
      // A reentrant teardown inside an earlier item's `graph` accessor (the
      // pinned family): the rest of the scan must not compile modules onto a
      // device the application just released.
      return null;
    }
    const cached = this.#byGraph.get(graph);
    if (cached !== undefined) {
      return cached;
    }
    let emitted: EmittedWgslNodeShader;
    try {
      emitted = emitShaderGraphWgsl(graph);
    } catch (error: unknown) {
      this.#byGraph.set(graph, null);
      if (DEV) {
        this.#failureSerial += 1;
        devWarnOnce(
          `webgpu-node-material-failed:${String(this.#failureSerial)}`,
          "§60: a node-material graph failed to emit on this backend; its " +
            `draws are skipped (§61, §89). ${String(error)}`,
        );
      }
      return null;
    }
    const existing = this.#bySource.get(emitted.code);
    if (existing !== undefined) {
      this.#byGraph.set(graph, existing);
      return existing;
    }
    const record = this.#createRecord(emitted);
    this.#bySource.set(emitted.code, record);
    this.#byGraph.set(graph, record);
    return record;
  }

  /** Builds one program record: module, layouts, empty pipeline map. */
  #createRecord(emitted: EmittedWgslNodeShader): NodeProgramRecord {
    const device = this.#host.device;
    const module = device.createShaderModule({
      label: `fourJS:node:${emitted.domain}`,
      code: emitted.code,
    });
    this.#captureCompilationInfo(module, emitted);
    const groups: GpuBindGroupLayout[] = [];
    if (emitted.domain === "surface") {
      groups.push(this.#blockLayout(emitted.blockBytes, true));
      if (emitted.textureGroup !== null) {
        groups.push(this.#textureLayout(emitted.textures.length));
      }
      if (emitted.storageGroup !== null) {
        groups.push(this.#storageLayout(emitted.storage.length));
      }
    } else {
      if (emitted.textureGroup !== null) {
        groups.push(this.#textureLayout(emitted.textures.length));
      }
      if (emitted.blockBytes > 0) {
        groups.push(this.#blockLayout(emitted.blockBytes, false));
      }
    }
    const pipelineLayout = device.createPipelineLayout({
      label: `fourJS:pipeline-layout:node:${emitted.domain}`,
      bindGroupLayouts: groups,
    });
    return {
      emitted,
      module,
      strideBytes:
        emitted.domain === "surface"
          ? Math.ceil(emitted.blockBytes / NODE_STRIDE_ALIGNMENT) *
            NODE_STRIDE_ALIGNMENT
          : 0,
      pipelineLayout,
      vertexLayouts: emitted.vertexStreams.map(
        (stream) => ATTRIBUTE_LAYOUTS[stream],
      ),
      pipelines: new Map<string, GpuRenderPipeline>(),
      drawBindGroup: null,
      screenBuffer: null,
      screenStaging: null,
      screenBindGroup: null,
    };
  }

  /** The block layout for one size — dynamic per draw, static per effect. */
  #blockLayout(bytes: number, dynamic: boolean): GpuBindGroupLayout {
    const key = `${dynamic ? "d" : "s"}:${String(bytes)}`;
    const existing = this.#blockLayouts.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const layout = this.#host.device.createBindGroupLayout({
      label: `fourJS:node-uniforms:${key}`,
      entries: [
        {
          binding: 0,
          // The surface block feeds both stages (matrices in the vertex
          // stage, opacity/time/uniforms wherever the graph reads them); the
          // screen block is fragment arithmetic only.
          visibility: dynamic
            ? GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT
            : GPU_SHADER_STAGE.FRAGMENT,
          buffer: {
            type: "uniform",
            ...(dynamic ? { hasDynamicOffset: true } : {}),
            minBindingSize: bytes,
          },
        },
      ],
    });
    this.#blockLayouts.set(key, layout);
    return layout;
  }

  /** The read-only storage layout for one buffer count (§82). */
  #storageLayout(count: number): GpuBindGroupLayout {
    const existing = this.#storageLayouts.get(count);
    if (existing !== undefined) {
      return existing;
    }
    const entries = [];
    for (let index = 0; index < count; index += 1) {
      entries.push({
        binding: index,
        visibility: GPU_SHADER_STAGE.FRAGMENT,
        buffer: { type: "read-only-storage" as const },
      });
    }
    const layout = this.#host.device.createBindGroupLayout({
      label: `fourJS:node-storage:${String(count)}`,
      entries,
    });
    this.#storageLayouts.set(count, layout);
    return layout;
  }

  /**
   * Resolves every storage buffer the program reads to its GPU copy —
   * allocating on first sight and re-uploading when the buffer's version
   * moved — and returns the material's bind group, or `null` when a buffer is
   * unbound or disposed (a disposed buffer's GPU copy is released here).
   */
  #materialStorageGroup(
    material: WgpuNodeItemMaterial,
    record: NodeProgramRecord,
  ): GpuBindGroup | null {
    const device = this.#host.device;
    const names = record.emitted.storage;
    for (let index = 0; index < names.length; index += 1) {
      const bound = material.getStorage(names[index].name);
      if (bound === null) {
        return null;
      }
      let stored = this.#storageBuffers.get(bound);
      if (bound.disposed) {
        stored?.gpu.destroy();
        this.#storageBuffers.delete(bound);
        return null;
      }
      if (stored === undefined) {
        stored = {
          gpu: device.createBuffer({
            label: `fourJS:node-storage:${names[index].name}`,
            size: bound.data.byteLength,
            usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
          }),
          version: 0,
        };
        this.#storageBuffers.set(bound, stored);
      }
      if (stored.version !== bound.version) {
        device.queue.writeBuffer(stored.gpu, 0, bound.data);
        stored.version = bound.version;
      }
      storageScratch[index] = stored.gpu;
    }
    const cached = this.#storageGroups.get(material);
    if (cached !== undefined && cached.buffers.length === names.length) {
      let same = true;
      for (let index = 0; index < names.length; index += 1) {
        if (cached.buffers[index] !== storageScratch[index]) {
          same = false;
          break;
        }
      }
      if (same) {
        return cached.group;
      }
    }
    const entries: GpuBindGroupEntry[] = [];
    for (let index = 0; index < names.length; index += 1) {
      entries.push({
        binding: index,
        resource: { buffer: storageScratch[index] },
      });
    }
    const group = device.createBindGroup({
      label: "fourJS:node-storage",
      layout: this.#storageLayout(names.length),
      entries,
    });
    this.#storageGroups.set(material, {
      buffers: storageScratch.slice(0, names.length),
      group,
    });
    return group;
  }

  /** The texture-group layout for one pair count — pairs at (2i, 2i + 1). */
  #textureLayout(count: number): GpuBindGroupLayout {
    const existing = this.#textureLayouts.get(count);
    if (existing !== undefined) {
      return existing;
    }
    const entries = [];
    for (let index = 0; index < count; index += 1) {
      entries.push(
        {
          binding: index * 2,
          visibility: GPU_SHADER_STAGE.FRAGMENT,
          texture: { sampleType: "float", viewDimension: "2d" },
        },
        {
          binding: index * 2 + 1,
          visibility: GPU_SHADER_STAGE.FRAGMENT,
          sampler: { type: "filtering" },
        },
      );
    }
    const layout = this.#host.device.createBindGroupLayout({
      label: `fourJS:node-textures:${String(count)}`,
      entries,
    });
    this.#textureLayouts.set(count, layout);
    return layout;
  }

  /** Standard GPUShaderModule diagnostics are optional on minimal test contexts. */
  #captureCompilationInfo(
    module: GpuShaderModule,
    emitted: EmittedWgslNodeShader,
  ): void {
    const shader = module as {
      getCompilationInfo?: () => Promise<{
        messages: readonly {
          type: string;
          message: string;
          lineNum: number;
          linePos: number;
        }[];
      }>;
    };
    if (shader.getCompilationInfo === undefined) return;
    const getInfo = shader.getCompilationInfo.bind(module);
    void Promise.resolve()
      .then(getInfo)
      .then((info) => {
        if (this.#disposed) return;
        const errors = info.messages.filter(
          (message) => message.type === "error",
        );
        if (errors.length === 0) return;
        const messages = errors.map((message) => ({
          ...message,
          node: emitted.sourceMap.find(
            (location) => location.line === message.lineNum,
          ),
        }));
        const error = new FourError(
          "SHADER_COMPILATION_FAILED",
          "WebGPU node shader compilation failed.",
          {
            context: {
              source: emitted.code,
              sourceMap: emitted.sourceMap,
              messages,
            },
          },
        );
        this.#compilationErrors.push(error);
        if (DEV) {
          this.#failureSerial += 1;
          devWarnOnce(
            `webgpu-node-compile:${String(this.#failureSerial)}`,
            `${error.message} ${JSON.stringify(messages)}`,
          );
        }
      })
      .catch((cause: unknown) => {
        if (!this.#disposed)
          this.#compilationErrors.push(
            new FourError(
              "SHADER_COMPILATION_FAILED",
              "Unable to retrieve WebGPU node shader diagnostics.",
              {
                cause,
                context: { source: emitted.code, sourceMap: emitted.sourceMap },
              },
            ),
          );
      });
  }

  /** The pipeline for one (program × state), created on first use. */
  #pipelineFor(
    record: NodeProgramRecord,
    state: NodePipelineState,
  ): GpuRenderPipeline {
    const key = nodePipelineKey(state);
    const existing = record.pipelines.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const blend = blendStateFor(state.blend);
    const pipeline = this.#host.device.createRenderPipeline({
      label: `fourJS:node|${key}`,
      layout: record.pipelineLayout,
      vertex: {
        module: record.module,
        entryPoint: VERTEX_ENTRY_POINT,
        buffers: record.vertexLayouts,
      },
      fragment: {
        module: record.module,
        entryPoint: FRAGMENT_ENTRY_POINT,
        targets: [
          {
            format: state.colorFormat,
            ...(blend === undefined ? {} : { blend }),
            writeMask: state.colorWrite ? COLOR_WRITE_ALL : 0,
          },
        ],
      },
      primitive: { topology: state.topology },
      ...(state.depthFormat === null
        ? {}
        : {
            depthStencil: {
              format: state.depthFormat,
              depthWriteEnabled: state.depthWrite,
              depthCompare: state.depthTest ? "less" : "always",
              ...stencilStateFor(state.stencil),
            },
          }),
    });
    record.pipelines.set(key, pipeline);
    return pipeline;
  }

  /** Grows the shared strided buffer; drops the groups that pointed at it. */
  #growBuffer(totalBytes: number): void {
    if (totalBytes <= this.#capacityBytes) {
      return;
    }
    const capacity = Math.max(
      totalBytes,
      this.#capacityBytes * 2,
      4 * NODE_STRIDE_ALIGNMENT,
    );
    this.#buffer?.destroy();
    this.#buffer = this.#host.device.createBuffer({
      label: "fourJS:node-uniforms",
      size: capacity,
      usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
    });
    this.#staging = new Float32Array(capacity / 4);
    this.#capacityBytes = capacity;
    for (const record of this.#bySource.values()) {
      record.drawBindGroup = null;
    }
  }

  /** The surface draw group over the shared buffer, rebuilt after regrowth. */
  #drawBindGroup(record: NodeProgramRecord, buffer: GpuBuffer): GpuBindGroup {
    record.drawBindGroup ??= this.#host.device.createBindGroup({
      label: "fourJS:node-uniforms",
      layout: this.#blockLayout(record.emitted.blockBytes, true),
      entries: [
        {
          binding: 0,
          resource: { buffer, offset: 0, size: record.emitted.blockBytes },
        },
      ],
    });
    return record.drawBindGroup;
  }

  /** The buffer backing one vertex stream, or `null` where the geometry lacks it. */
  #streamBuffer(
    geometry: {
      readonly positionBuffer: GpuBuffer;
      readonly normalBuffer: GpuBuffer | null;
      readonly uvBuffer: GpuBuffer | null;
      readonly colorBuffer: GpuBuffer | null;
    },
    stream: ShaderAttributeName,
  ): GpuBuffer | null {
    switch (stream) {
      case "position":
        return geometry.positionBuffer;
      case "normal":
        return geometry.normalBuffer;
      case "uv":
        return geometry.uvBuffer;
      default:
        // "color" — the union's last member.
        return geometry.colorBuffer;
    }
  }

  /**
   * The texture bind group for one material's current bindings — cached per
   * material and rebuilt only when a resolved view or sampler changes (a
   * version bump re-creates the cache record, a rebind names a different
   * texture), so a steady-state frame allocates nothing. `null` skips the
   * draw: an unbound name, a disposed texture, or R-4's feedback loop.
   */
  #materialTextureGroup(
    material: WgpuNodeItemMaterial,
    record: NodeProgramRecord,
    activeTarget: WgpuCacheableRenderTarget | null,
  ): GpuBindGroup | null {
    const names = record.emitted.textures;
    for (let index = 0; index < names.length; index += 1) {
      const bound = material.getTexture(names[index]);
      if (bound === null) {
        return null;
      }
      if (!this.#resolveTexture(bound, activeTarget, index)) {
        return null;
      }
    }
    return this.#textureGroup(material, names.length);
  }

  /** Resolves one bound texture into the scratch pair at `index`. */
  #resolveTexture(
    bound: NonNullable<ReturnType<WgpuNodeItemMaterial["getTexture"]>>,
    activeTarget: WgpuCacheableRenderTarget | null,
    index: number,
  ): boolean {
    const renderTargets = this.#host.renderTargets;
    if (isRenderTargetTexture(bound)) {
      const target = bound.renderTarget;
      if (target === activeTarget) {
        return false;
      }
      const view = renderTargets.sampleView(target);
      if (view === null) {
        return false;
      }
      pairScratch[index * 2] = view;
      pairScratch[index * 2 + 1] = renderTargets.sampleSampler();
      return true;
    }
    const textureRecord = this.#host.textures.acquire(bound);
    if (textureRecord === null) {
      return false;
    }
    pairScratch[index * 2] = textureRecord.view;
    pairScratch[index * 2 + 1] = textureRecord.sampler;
    return true;
  }

  /** The bind-group entries over the current scratch pairs. */
  #textureBindGroupEntries(count: number): GpuBindGroupEntry[] {
    const entries: GpuBindGroupEntry[] = [];
    for (let index = 0; index < count; index += 1) {
      entries.push(
        { binding: index * 2, resource: pairScratch[index * 2] },
        { binding: index * 2 + 1, resource: pairScratch[index * 2 + 1] },
      );
    }
    return entries;
  }

  /** Whether `cached` was built over exactly the current scratch pairs. */
  #texturesUnchanged(cached: NodeTextureGroup, count: number): boolean {
    if (cached.keys.length !== count * 2) {
      return false;
    }
    for (let index = 0; index < count * 2; index += 1) {
      if (cached.keys[index] !== pairScratch[index]) {
        return false;
      }
    }
    return true;
  }

  /** Returns (building on change) `owner`'s group over the scratch pairs. */
  #textureGroup(owner: object, count: number): GpuBindGroup {
    const cached = this.#textureGroups.get(owner);
    if (cached !== undefined && this.#texturesUnchanged(cached, count)) {
      return cached.group;
    }
    const group = this.#host.device.createBindGroup({
      label: "fourJS:node-textures",
      layout: this.#textureLayout(count),
      entries: this.#textureBindGroupEntries(count),
    });
    this.#textureGroups.set(owner, {
      keys: pairScratch.slice(0, count * 2),
      group,
    });
    return group;
  }

  /**
   * The texture bind group for one §70 graph effect: `"source"` is the
   * pass's source target, every other name reads `effect.textures` — and
   * every resolved surface is feedback-checked against the destination
   * (R-4's rule per sampled surface, the GL arm's reading).
   */
  #effectTextureGroup(
    effect: GraphEffect,
    record: NodeProgramRecord,
    source: WgpuCacheableRenderTarget,
    destination: WgpuCacheableRenderTarget | null,
  ): GpuBindGroup | null {
    const renderTargets: WgpuRenderTargetCache = this.#host.renderTargets;
    const names = record.emitted.textures;
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      let view: GpuTextureView | null = null;
      if (name === "source") {
        view = renderTargets.sampleView(source);
      } else {
        const input = effect.textures?.[name];
        if (input !== undefined && isRenderTargetTexture(input)) {
          const target = input.renderTarget;
          if (target !== destination) {
            view = renderTargets.sampleView(target);
          }
        }
      }
      if (view === null) {
        return null;
      }
      pairScratch[index * 2] = view;
      pairScratch[index * 2 + 1] = renderTargets.sampleSampler();
    }
    return this.#textureGroup(effect, names.length);
  }

  /**
   * Packs and uploads one screen program's block — §9 render time in
   * `params.x`, the pass's uniform values (sorted by name, §33; unset names
   * read as zeros, GL's own initial value) — and returns its bind group.
   * Uploaded per call with `queue.writeBuffer`, before the submit that reads
   * it (queue order; the grade block's shape, one program wider).
   */
  #screenBlock(
    record: NodeProgramRecord,
    effect: GraphEffect,
    renderTime: number,
  ): GpuBindGroup {
    const device = this.#host.device;
    const emitted = record.emitted;
    record.screenBuffer ??= device.createBuffer({
      label: "fourJS:node-effect-uniforms",
      size: emitted.blockBytes,
      usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
    });
    record.screenStaging ??= new Float32Array(emitted.blockBytes / 4);
    const staging = record.screenStaging;
    staging.fill(0);
    staging[0] = renderTime;
    const uniforms = effect.uniforms;
    if (uniforms !== undefined) {
      const slots = assignUniformSlots(emitted.uniforms).slots;
      const reflected = new Map(
        emitted.uniforms.map((uniform) => [uniform.name, uniform]),
      );
      // Sorted so the packed bytes are a function of the pass, not of a
      // record's key order (§33) — the GL graph-effect arm's rule.
      for (const name of Object.keys(uniforms).sort()) {
        const uniform = reflected.get(name);
        if (uniform === undefined) {
          // §61: unknown names were refused at `addPass`; a hand-built pass's
          // stray value is ignored, never a throw inside the frame.
          continue;
        }
        const value = uniforms[name];
        const lane = 4 + slots[uniform.name] * 4;
        if (typeof value === "number") {
          staging[lane] = value;
        } else {
          writeUniformLanes(staging, lane, uniform.type, value);
        }
      }
    }
    device.queue.writeBuffer(record.screenBuffer, 0, staging);
    record.screenBindGroup ??= device.createBindGroup({
      label: "fourJS:node-effect-uniforms",
      layout: this.#blockLayout(emitted.blockBytes, false),
      entries: [
        {
          binding: 0,
          resource: {
            buffer: record.screenBuffer,
            offset: 0,
            size: emitted.blockBytes,
          },
        },
      ],
    });
    return record.screenBindGroup;
  }
}

/**
 * Writes one uniform value into its `vec4` lanes (the all-`vec4` transport —
 * module header): scalars and vectors fill one lane, zero-padded; `mat3`
 * columns take a lane each, `w` written zero; `mat4` copies whole. Returns
 * the next free float index. Every lane byte is written (§33).
 */
function writeUniformLanes(
  staging: Float32Array,
  base: number,
  type: ShaderValueType,
  value: ArrayLike<number>,
): number {
  if (type === "mat3") {
    for (let column = 0; column < 3; column += 1) {
      staging[base + column * 4] = value[column * 3];
      staging[base + column * 4 + 1] = value[column * 3 + 1];
      staging[base + column * 4 + 2] = value[column * 3 + 2];
      staging[base + column * 4 + 3] = 0;
    }
    return base + 12;
  }
  if (type === "mat4") {
    for (let index = 0; index < 16; index += 1) {
      staging[base + index] = value[index];
    }
    return base + 16;
  }
  const components = SHADER_VALUE_COMPONENTS[type];
  for (let index = 0; index < 4; index += 1) {
    staging[base + index] = index < components ? value[index] : 0;
  }
  return base + 4;
}

/** Adds one submitted node draw to §84's counters — `countDraw`'s arithmetic. */
function countNodeDraw(
  statistics: RenderStatistics,
  topology: string,
  vertexCount: number,
): void {
  statistics.drawCalls += 1;
  statistics.instances += 1;
  if (topology === "triangle-list") {
    statistics.triangles += Math.floor(vertexCount / 3);
  }
}

/**
 * Opts this process's `WebgpuRenderer`s into §60 node materials and §70
 * `"graph"` effects (RFC 0001; WP-R1.9).
 *
 * ```ts
 * import { registerWebgpuNodeMaterialPipeline } from "@fourjs/render-webgpu";
 * registerWebgpuNodeMaterialPipeline();   // once, at application setup
 * ```
 *
 * Calling it is what links this module — the WGSL emitter and the pipeline
 * store — into the bundle; a build that never calls it carries none of it.
 * WGSL still compiles **lazily, per distinct graph, on each renderer's first
 * frame that needs one** — never here and never at renderer initialize — so
 * registration alone changes no device transcript. Idempotent; calling it
 * twice re-installs the same factory.
 */
export function registerWebgpuNodeMaterialPipeline(): void {
  setWebgpuNodeMaterialPipelineFactory({
    create(host: WgpuNodePipelineHost): WgpuNodeMaterialPipelines {
      return new WgpuNodePipelineStore(host);
    },
  });
}
