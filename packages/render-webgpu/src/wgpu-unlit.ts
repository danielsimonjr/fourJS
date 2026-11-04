/**
 * The unlit pipeline in hand-written WGSL (§64, §120's MVP tier), plus the
 * clear pipeline every view's clear is drawn with.
 *
 * This is the WGSL port of `gl-program.ts`'s `UnlitProgram`, and the port is
 * deliberately a *translation*: the same two matrices, the same flat colour,
 * the same optional per-vertex colour multiplier. RFC 0001's shader graph will
 * one day emit WGSL for this backend; hand-written WGSL is what makes that
 * emitter testable ("emit this pipeline and compare"), which is the argument
 * §7 of the R-1 plan settles at length.
 *
 * ## Two departures from the GLSL original, both forced by WebGPU
 *
 * ### 1. The depth remap lives here
 *
 * WebGL's clip space maps visible depth onto `z ∈ [-w, w]`; WebGPU's maps it
 * onto `z ∈ [0, w]`. `@fourjs/math`'s projections are written to the WebGL
 * convention (D8), and they must stay that way: the math package may not learn
 * which backend is drawing (§3.1). So the remap
 *
 * ```wgsl
 * clip.z = (clip.z + clip.w) * 0.5
 * ```
 *
 * is applied **in this backend's vertex stage**, once, on the way out — the
 * placement the R-1 plan fixes (§3.3.8). It is exact, it costs one multiply-add
 * per vertex, and it keeps `Frustum`'s WebGL-convention plane extraction (which
 * `buildViewRenderList` culls with) correct for both backends, because the
 * matrix the CPU culls against is the un-remapped one.
 *
 * ### 2. `useMap` / `useVertexColors` are pipeline variants, not uniforms
 *
 * R-19 made them uniform branches on WebGL for a measured reason: a variant set
 * would have meant more programs compiled at initialization. That reason does
 * not survive the port. A `GPURenderPipeline` is immutable and combinatorial,
 * the cache that holds them is **lazy** (`wgpu-pipeline-cache.ts`), and a
 * variant nothing draws is never created at all — so the cost model inverts,
 * and the variant is strictly better: no per-fragment branch, and the vertex
 * layout can *omit* the colour buffer entirely rather than binding a dummy.
 *
 * `useMap` joined it in WP-R1.2, and joined it as a *variant* for the same
 * reason: the textured shader is compiled only for a frame that actually draws
 * a textured object, the untextured variants keep the one-bind-group pipeline
 * layout they had, and the uv stream is absent from the vertex layout rather
 * than bound as a dummy. The two flags multiply out to four variants, of which
 * a given application typically compiles one or two.
 */

import {
  DRAW_NORMAL_OFFSET,
  DRAW_UNIFORM_WGSL,
  MAP_BINDING_WGSL,
} from "./wgpu-bindings.js";
import type { GpuVertexBufferLayout } from "./webgpu-device.js";

/** `@location(0)` — object-space position, the one required stream (§53). */
export const POSITION_SHADER_LOCATION = 0;

/** `@location(1)` — the optional per-vertex RGBA stream (§53, §60a). */
export const COLOR_SHADER_LOCATION = 1;

/** Vertex layout for the position stream: one tightly packed `vec3<f32>`. */
export const POSITION_BUFFER_LAYOUT: GpuVertexBufferLayout = Object.freeze({
  arrayStride: 12,
  stepMode: "vertex",
  attributes: Object.freeze([
    Object.freeze({
      format: "float32x3",
      offset: 0,
      shaderLocation: POSITION_SHADER_LOCATION,
    }),
  ]),
});

/** Vertex layout for the optional colour stream: one tightly packed `vec4<f32>`. */
export const COLOR_BUFFER_LAYOUT: GpuVertexBufferLayout = Object.freeze({
  arrayStride: 16,
  stepMode: "vertex",
  attributes: Object.freeze([
    Object.freeze({
      format: "float32x4",
      offset: 0,
      shaderLocation: COLOR_SHADER_LOCATION,
    }),
  ]),
});

/** `@location(2)` — the optional per-vertex uv stream (§53, §55, §77). */
export const UV_SHADER_LOCATION = 2;

/**
 * Vertex layout for the optional uv stream: one tightly packed `vec2<f32>`.
 *
 * `@location(2)` rather than `1`, even though uvs are read by a variant that
 * often carries no colours: a shader location is a name, and giving uv and
 * colour the same number would mean two different meanings for one location
 * across variants of one shader family — which is exactly the confusion the
 * eventual WGSL emitter (RFC 0001) must not have to disambiguate.
 */
export const UV_BUFFER_LAYOUT: GpuVertexBufferLayout = Object.freeze({
  arrayStride: 8,
  stepMode: "vertex",
  attributes: Object.freeze([
    Object.freeze({
      format: "float32x2",
      offset: 0,
      shaderLocation: UV_SHADER_LOCATION,
    }),
  ]),
});

/** `@location(6)` — the first morph target's position stream (RFC 0003). */
export const POSITION1_SHADER_LOCATION = 6;

/** `@location(7)` — the first morph target's normal stream (RFC 0003). */
export const NORMAL1_SHADER_LOCATION = 7;

/** Vertex layout for `positions1`: one tightly packed `vec3<f32>`. */
export const POSITION1_BUFFER_LAYOUT: GpuVertexBufferLayout = Object.freeze({
  arrayStride: 12,
  stepMode: "vertex",
  attributes: Object.freeze([
    Object.freeze({
      format: "float32x3",
      offset: 0,
      shaderLocation: POSITION1_SHADER_LOCATION,
    }),
  ]),
});

/** Vertex layout for `normals1`: one tightly packed `vec3<f32>`. */
export const NORMAL1_BUFFER_LAYOUT: GpuVertexBufferLayout = Object.freeze({
  arrayStride: 12,
  stepMode: "vertex",
  attributes: Object.freeze([
    Object.freeze({
      format: "float32x3",
      offset: 0,
      shaderLocation: NORMAL1_SHADER_LOCATION,
    }),
  ]),
});

/**
 * Which morph streams a GPU morph variant reads (RFC 0003 WP-SK.4 and its
 * further-targets residue): `"p"` / `"pn"` are the one-target variants
 * (positions only / positions and normals); `"p2"`..`"p4"` / `"pn2"`..`"pn4"`
 * read that many targets, each with the stream set the letters name. The
 * string is also the pipeline-cache and memo key suffix, so counts never
 * collide. One-target sources are byte-identical to the pre-residue ones.
 */
export type WgpuMorph = "p" | "pn" | "p2" | "pn2" | "p3" | "pn3" | "p4" | "pn4";

/** Targets a morph variant reads (1..4). */
export function morphTargetCount(morph: WgpuMorph): number {
  return morph.length === 1 || morph === "pn" ? 1 : Number(morph.slice(-1));
}

/** Whether a morph variant also morphs normals. */
export function morphHasNormals(morph: WgpuMorph): boolean {
  return morph.startsWith("pn");
}

/** The variant for `count` targets (1..4), with or without normal streams. */
export function morphVariant(count: number, normals: boolean): WgpuMorph {
  const base = normals ? "pn" : "p";
  return (count === 1 ? base : `${base}${String(count)}`) as WgpuMorph;
}

/** `@location` of morph target `k`'s positions: 6, then 10, 12, 14. */
export function morphPositionShaderLocation(k: number): number {
  return k === 1 ? POSITION1_SHADER_LOCATION : 10 + 2 * (k - 2);
}

/** `@location` of morph target `k`'s normals: 7, then 11, 13, 15. */
export function morphNormalShaderLocation(k: number): number {
  return morphPositionShaderLocation(k) + 1;
}

const POSITION_K_LAYOUTS: GpuVertexBufferLayout[] = [];
const NORMAL_K_LAYOUTS: GpuVertexBufferLayout[] = [];
for (let k = 2; k <= 4; k += 1) {
  for (const [list, location] of [
    [POSITION_K_LAYOUTS, morphPositionShaderLocation(k)],
    [NORMAL_K_LAYOUTS, morphNormalShaderLocation(k)],
  ] as const) {
    list[k] = Object.freeze({
      arrayStride: 12,
      stepMode: "vertex",
      attributes: Object.freeze([
        Object.freeze({
          format: "float32x3",
          offset: 0,
          shaderLocation: location,
        }),
      ]),
    });
  }
}

/**
 * Morph vertex-buffer layouts in slot order (after the base streams):
 * `positions1`, [`normals1`], then `positions2`, [`normals2`], …
 */
export function morphVertexBufferLayouts(
  morph: WgpuMorph,
): readonly GpuVertexBufferLayout[] {
  const out: GpuVertexBufferLayout[] = [POSITION1_BUFFER_LAYOUT];
  const normals = morphHasNormals(morph);
  if (normals) {
    out.push(NORMAL1_BUFFER_LAYOUT);
  }
  for (let k = 2; k <= morphTargetCount(morph); k += 1) {
    out.push(POSITION_K_LAYOUTS[k]);
    if (normals) {
      out.push(NORMAL_K_LAYOUTS[k]);
    }
  }
  return out;
}

/** Vertex-input WGSL lines for the morph streams of a variant. */
export function morphInputWgsl(morph: WgpuMorph, normals: boolean): string {
  let input = "";
  for (let k = 1; k <= morphTargetCount(morph); k += 1) {
    input += `
  @location(${String(morphPositionShaderLocation(k))}) position${String(k)} : vec3<f32>,`;
    if (normals) {
      input += `
  @location(${String(morphNormalShaderLocation(k))}) normal${String(k)} : vec3<f32>,`;
    }
  }
  return input;
}

/**
 * Σ wᵢ(pᵢ − p) as WGSL for a 2..4-target variant (`draw.morphWeights` lanes);
 * `name` is `position` or `normal`. One target uses GLSL's `mix` instead.
 */
export function morphSumWgsl(name: string, count: number): string {
  let expr = name;
  for (let k = 1; k <= count; k += 1) {
    expr += ` + draw.morphWeights.${"xyzw"[k - 1]} * (${name}${String(k)} - ${name})`;
  }
  return expr;
}

/**
 * Byte offset of the one-target morph weight inside `DrawUniforms`: the
 * padding word of `normalMatrix`'s first column (a `mat3x3` column is a
 * `vec3` padded to 16 bytes). The block stays 192 bytes; morph variants
 * declare the matrix as three `vec4` columns ({@link MORPH_DRAW_UNIFORM_WGSL})
 * so the word becomes addressable as `normalColumn0.w`.
 */
export const DRAW_MORPH_WEIGHT_OFFSET = DRAW_NORMAL_OFFSET + 12;

/**
 * {@link DRAW_UNIFORM_WGSL} with `normalMatrix` spelled as its three padded
 * columns — byte-identical layout, but the padding words are nameable.
 */
export const MORPH_DRAW_UNIFORM_WGSL = DRAW_UNIFORM_WGSL.replace(
  "normalMatrix : mat3x3<f32>,",
  "normalColumn0 : vec4<f32>,\n  normalColumn1 : vec4<f32>,\n  normalColumn2 : vec4<f32>,",
);

/**
 * Byte offset of the `vec4` `morphWeights` field the 2..4-target variants
 * append to `DrawUniforms` (after the 192 bytes the base block uses; the
 * 256-byte stride leaves room).
 */
export const DRAW_MORPH_WEIGHTS_OFFSET = 192;

/** {@link MORPH_DRAW_UNIFORM_WGSL} plus the trailing `morphWeights` vec4. */
export const MORPH_N_DRAW_UNIFORM_WGSL = MORPH_DRAW_UNIFORM_WGSL.replace(
  "\n};",
  "\n  morphWeights : vec4<f32>,\n};",
);

/** The draw block a morph variant (or none) declares. */
export function drawUniformWgslFor(morph: WgpuMorph | undefined): string {
  return morph === undefined
    ? DRAW_UNIFORM_WGSL
    : morphTargetCount(morph) === 1
      ? MORPH_DRAW_UNIFORM_WGSL
      : MORPH_N_DRAW_UNIFORM_WGSL;
}

/** The WGSL expression for the morph weight in a morph variant. */
export const MORPH_WEIGHT_WGSL = "draw.normalColumn0.w";

/**
 * Vertex layouts for an unlit pipeline, **in slot order**: position always,
 * then colours if the variant reads them, then uvs if it samples a texture.
 *
 * Separate buffers rather than one interleaved one, matching `gl-geometry.ts`:
 * `BufferGeometry` holds each stream as its own typed array, so one buffer per
 * stream is a straight upload with no CPU-side interleave pass.
 *
 * Slot index is *positional*, not fixed per stream — a textured, uncoloured
 * variant binds its uvs to slot 1, a textured and coloured one to slot 2 — so
 * the renderer's `setVertexBuffer` order has to be built in the same order this
 * function is. It is, and both are a single counter, which is why the ordering
 * is stated here rather than left to be inferred: the failure mode of getting
 * it wrong is a pipeline reading colours as uvs, which validates cleanly and
 * draws garbage.
 */
export function unlitVertexBufferLayouts(
  vertexColors: boolean,
  map = false,
  morph?: WgpuMorph,
): readonly GpuVertexBufferLayout[] {
  const layouts: GpuVertexBufferLayout[] = [POSITION_BUFFER_LAYOUT];
  if (vertexColors) {
    layouts.push(COLOR_BUFFER_LAYOUT);
  }
  if (map) {
    layouts.push(UV_BUFFER_LAYOUT);
  }
  if (morph !== undefined) {
    layouts.push(...morphVertexBufferLayouts(morph));
  }
  return layouts;
}

/** Entry point name of every vertex stage in this package. */
export const VERTEX_ENTRY_POINT = "vertexMain";

/** Entry point name of every fragment stage in this package. */
export const FRAGMENT_ENTRY_POINT = "fragmentMain";

/**
 * The unlit WGSL module for one variant.
 *
 * Generated rather than stored as two constants so that the shared half — the
 * uniform block, the remap, the fragment stage — is written once. The generated
 * text is a pure function of the flag, so two calls with the same flag produce
 * byte-identical source, which is what lets the pipeline cache key on the
 * descriptor instead of on the string (§33's determinism rule, applied to a
 * cache).
 */
export function unlitShaderSource(
  vertexColors: boolean,
  map = false,
  morph?: WgpuMorph,
): string {
  let input = `  @location(${String(POSITION_SHADER_LOCATION)}) position : vec3<f32>,`;
  if (vertexColors) {
    input += `
  @location(${String(COLOR_SHADER_LOCATION)}) vertexColor : vec4<f32>,`;
  }
  if (map) {
    input += `
  @location(${String(UV_SHADER_LOCATION)}) uv : vec2<f32>,`;
  }
  if (morph !== undefined) {
    input += morphInputWgsl(morph, false);
  }
  const color = vertexColors ? "draw.color * vertexColor" : "draw.color";
  // `map` multiplies the interpolated colour, so the tint and the per-vertex
  // colour both survive — the same expression `gl-program.ts`'s unlit fragment
  // stage writes (`result *= texture(map, vUv)`), and the same order.
  return `${drawUniformWgslFor(morph)}${map ? `\n\n${MAP_BINDING_WGSL}` : ""}

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
${
  morph === undefined
    ? ""
    : morphTargetCount(morph) === 1
      ? `  // One-target GPU morph (RFC 0003): GLSL's mix(position, position1, w).
  let morphed = mix(position, position1, ${MORPH_WEIGHT_WGSL});
`
      : `  // N-target GPU morph: Σ wᵢ(pᵢ − p).
  let morphed = ${morphSumWgsl("position", morphTargetCount(morph))};
`
}  let clip = draw.viewProjection * draw.model * vec4<f32>(${morph === undefined ? "position" : "morphed"}, 1.0);
  // WebGL clip depth [-w, w] onto WebGPU's [0, w]; see the module header.
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
 * The unlit fragment stage, isolated so the skinned unlit vertex
 * (`wgpu-skinning.ts`) splices the same source the unskinned family
 * compiles — the two cannot drift.
 */
export function unlitFragmentStageWgsl(map = false): string {
  return `@fragment
fn ${FRAGMENT_ENTRY_POINT}(input : VertexOutput) -> @location(0) vec4<f32> {
  return ${map ? "input.color * textureSample(mapTexture, mapSampler, input.uv)" : "input.color"};
}
`;
}

/**
 * Number of vertices the clear pipeline draws: one oversized triangle covering
 * the whole clip-space square.
 */
export const CLEAR_VERTEX_COUNT = 3;

/**
 * The clear pipeline's WGSL — a full-surface triangle at the far plane.
 *
 * ## Why a *draw* clears, when WebGPU has `loadOp: "clear"`
 *
 * Because §61's clear contract is not "clear the surface", it is **"clear the
 * viewport rectangle"**: *"clears are confined to the viewport rectangle, never
 * the whole surface"*, which is what makes a minimap composite over the main
 * view rather than erase it. WebGPU's `loadOp` clears the whole attachment and
 * has no scissor, so a `loadOp: "clear"` implementation of a two-view frame
 * would erase the first view when the second began. `setScissorRect` plus a
 * full-surface triangle clears exactly the rectangle — which is what the WebGL
 * backend's scissored `clear` does, expressed in the primitives WebGPU has.
 *
 * The colour attachment therefore always loads (`loadOp: "load"`), and the
 * per-view rules fall out unchanged: a view carrying no `clearColor` draws no
 * clear triangle at all, and a view that carries one clears just its rectangle.
 * Depth is cleared for every view by the same draw — `depthCompare: "always"`
 * with `depthWriteEnabled: true` and `z = 1`, the far plane §61 names — so a
 * later view cannot be occluded by an earlier one's geometry.
 *
 * The colour-less variant writes no colour channels (`writeMask: 0`), so the
 * clear-depth-only case is the same draw with a different pipeline key rather
 * than a second code path.
 */
export const CLEAR_SHADER_SOURCE = `${DRAW_UNIFORM_WGSL}

@vertex
fn ${VERTEX_ENTRY_POINT}(@builtin(vertex_index) index : u32) -> @builtin(position) vec4<f32> {
  // (-1,-1), (-1, 3), (3, -1): one triangle covering the clip-space square.
  let corner = i32(index);
  let x = f32(corner / 2) * 4.0 - 1.0;
  let y = f32(corner & 1) * 4.0 - 1.0;
  return vec4<f32>(x, y, 1.0, 1.0);
}

@fragment
fn ${FRAGMENT_ENTRY_POINT}() -> @location(0) vec4<f32> {
  return draw.color;
}
`;
