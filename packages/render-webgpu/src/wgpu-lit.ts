/**
 * The Lambert-lit pipeline in hand-written WGSL (§57 `LitMaterial`, §68,
 * WP-R1.5) — the WGSL port of `gl-program.ts`'s `LitProgram`, plus the vertex
 * plumbing the standard family (`wgpu-standard.ts`) shares.
 *
 * The port is a *translation*, `wgpu-unlit.ts`'s discipline: the same shading
 * expression, in the same operation order —
 *
 * ```text
 * fragColor.rgb = base.rgb × (ambient
 *                           + lightColor × max(dot(N, −L), 0)
 *                           + Σᵢ irradianceᵢ × max(dot(N, Lᵢ), 0))
 * fragColor.a   = base.a
 * ```
 *
 * — with `lightColor` premultiplied by intensity and no `1/π` anywhere (R-13:
 * the engine's light units already fold it out; `wgpu-lights.ts` restates the
 * convention). §69's shadow term is a **lazy variant** (WP-R1.7,
 * `wgpu-shadow.ts`): with `shadow` false the module is the GL stage with
 * `useShadow` at its initial `false`, operation for operation — byte-identical
 * to what WP-R1.5 landed — and with it true the directional product is bound
 * to a local and multiplied by `shadowFactor` under the same `len > 0` guard,
 * exactly as the GL stage multiplies it under `useShadow`.
 *
 * ## Three departures from the GLSL original, each forced by WebGPU
 *
 * 1. **The depth remap rides along.** The same `(clip.z + clip.w) * 0.5` the
 *    unlit vertex stage applies, for the reasons its header owns.
 * 2. **`useMap` is a pipeline variant, not a uniform** — `wgpu-unlit.ts`'s
 *    inversion of R-19, unchanged. **The normal stream is a variant too**, and
 *    this one has no GL analogue to invert: GL binds nothing at the normal slot
 *    and reads the constant default `(0, 0, 0, 1)`, whose zero xyz the fragment
 *    guard turns into "ambient only" — but a WebGPU pipeline that declares a
 *    vertex buffer must be given one. So a geometry without normals selects the
 *    normal-less variant, whose vertex stage writes the *same zero vector* GL's
 *    default attribute produces, and the fragment stage — shared text between
 *    the two variants — resolves it through the *same* `len > 0` guard to the
 *    same documented shading. Two variants, one arithmetic.
 * 3. **The inverse-transpose is a per-draw uniform.** GLSL ES 3.00 has
 *    `inverse()` built in; WGSL does not. WebGL packs
 *    `Matrix3.setNormalFromMatrix4` once per draw as `uniform mat3`; this
 *    backend does the same into `DrawUniforms.normalMatrix` (a std140-ish
 *    `mat3x3` at offset 144, 48 padded bytes, so the shared block is 192).
 *    {@link NORMAL_MATRIX_WGSL} is the historical per-vertex cofactor form,
 *    kept exported for grep/docs — it is not spliced into the live modules.
 */

import type { GpuVertexBufferLayout } from "./webgpu-device.js";
import {
  HEMISPHERE_IRRADIANCE_WGSL,
  LIGHT_UNIFORM_WGSL,
  PUNCTUAL_LIGHT_WGSL,
  SHADED_MAP_BINDING_WGSL,
} from "./wgpu-lights.js";
import {
  SHADOW_FACTOR_WGSL,
  SHADOW_LIGHT_UNIFORM_WGSL,
} from "./wgpu-shadow.js";
import {
  FRAGMENT_ENTRY_POINT,
  MORPH_WEIGHT_WGSL,
  drawUniformWgslFor,
  morphHasNormals,
  morphInputWgsl,
  morphSumWgsl,
  morphTargetCount,
  morphVertexBufferLayouts,
  POSITION_BUFFER_LAYOUT,
  POSITION_SHADER_LOCATION,
  UV_BUFFER_LAYOUT,
  UV_SHADER_LOCATION,
  VERTEX_ENTRY_POINT,
  type WgpuMorph,
} from "./wgpu-unlit.js";

/**
 * `@location(3)` — the optional world-space normal stream (§53, §68).
 *
 * Three, not the GL backend's `layout(location = 1)`: this package's location
 * numbers are *names* (`wgpu-unlit.ts`'s rule), 1 and 2 already name the
 * colour and uv streams, and reusing either for normals would give one number
 * two meanings across families — the confusion the future WGSL emitter
 * (RFC 0001) must not have to disambiguate.
 */
export const NORMAL_SHADER_LOCATION = 3;

/** Vertex layout for the normal stream: one tightly packed `vec3<f32>`. */
export const NORMAL_BUFFER_LAYOUT: GpuVertexBufferLayout = Object.freeze({
  arrayStride: 12,
  stepMode: "vertex",
  attributes: Object.freeze([
    Object.freeze({
      format: "float32x3",
      offset: 0,
      shaderLocation: NORMAL_SHADER_LOCATION,
    }),
  ]),
});

/**
 * Vertex layouts for a shaded pipeline, **in slot order**: position always,
 * then normals if the variant shades with them, then uvs if it samples.
 *
 * Positional slots with a single counter on both sides —
 * `unlitVertexBufferLayouts`' rule, restated because the failure mode is the
 * same: get the order wrong and a pipeline reads normals as uvs, which
 * validates cleanly and draws garbage. Shared by the lit and standard families,
 * whose vertex inputs are identical (§59 adds *uniforms*, not streams).
 */
export function shadedVertexBufferLayouts(
  normals: boolean,
  map: boolean,
  morph?: WgpuMorph,
): readonly GpuVertexBufferLayout[] {
  const layouts: GpuVertexBufferLayout[] = [POSITION_BUFFER_LAYOUT];
  if (normals) {
    layouts.push(NORMAL_BUFFER_LAYOUT);
  }
  if (map) {
    layouts.push(UV_BUFFER_LAYOUT);
  }
  if (morph !== undefined) {
    layouts.push(...morphVertexBufferLayouts(morph));
  }
  return layouts;
}

/**
 * The inverse-transpose of the model matrix's upper 3×3, as WGSL — the
 * historical per-vertex cofactor form.
 *
 * Cofactor form: with columns `a₀ a₁ a₂`, `transpose(inverse(A))` has columns
 * `a₁×a₂, a₂×a₀, a₀×a₁`, all over `det(A) = a₀·(a₁×a₂)`. Kept exported so
 * tests and docs that grep the name still find it; the live lit/standard
 * vertex stages read `draw.normalMatrix`, packed once per draw by
 * `Matrix3.setNormalFromMatrix4` (the same inverse-transpose, and the same
 * identity-on-singular policy the math tests pin).
 */
export const NORMAL_MATRIX_WGSL = `fn normalMatrix(model : mat4x4<f32>) -> mat3x3<f32> {
  let a0 = model[0].xyz;
  let a1 = model[1].xyz;
  let a2 = model[2].xyz;
  let c0 = cross(a1, a2);
  let c1 = cross(a2, a0);
  let c2 = cross(a0, a1);
  return mat3x3<f32>(c0, c1, c2) * (1.0 / dot(a0, c0));
}`;

/**
 * The varyings and vertex stage both shaded families share, generated for one
 * variant pair — exported for `wgpu-standard.ts`, whose vertex needs are
 * identical (its world position is computed the same way; only its uniforms
 * differ, and the uniform block's WGSL is the caller's to splice).
 *
 * The clip position is formed as `viewProjection × world` — the standard
 * stage's re-association, adopted for both families here because the world
 * position is a varying both need and computing `model × position` twice per
 * vertex buys nothing a transcript or a pixel can see. The depth remap is
 * `wgpu-unlit.ts`'s, applied on the way out.
 *
 * The normal-less variant writes the zero vector GL's default attribute
 * yields, so the shared fragment guard shades it ambient-only — see the module
 * header's departure 2.
 */
export function shadedVertexStageWgsl(
  normals: boolean,
  map: boolean,
  morph?: WgpuMorph,
): string {
  let input = `  @location(${String(POSITION_SHADER_LOCATION)}) position : vec3<f32>,`;
  if (normals) {
    input += `
  @location(${String(NORMAL_SHADER_LOCATION)}) normal : vec3<f32>,`;
  }
  if (map) {
    input += `
  @location(${String(UV_SHADER_LOCATION)}) uv : vec2<f32>,`;
  }
  if (morph !== undefined) {
    input += morphInputWgsl(morph, morphHasNormals(morph));
  }
  // GPU morph (RFC 0003): one target is GLSL's mix(position, position1, w),
  // and likewise the normal when both normal streams are present; 2..4
  // targets use Σ wᵢ(pᵢ − p) over `draw.morphWeights`.
  const count = morph === undefined ? 0 : morphTargetCount(morph);
  const morphNormals = morph !== undefined && morphHasNormals(morph) && normals;
  const morphed =
    morph === undefined
      ? ""
      : count === 1
        ? `  let morphedPosition = mix(position, position1, ${MORPH_WEIGHT_WGSL});
${
  morphNormals
    ? `  let morphedNormal = mix(normal, normal1, ${MORPH_WEIGHT_WGSL});
`
    : ""
}`
        : `  let morphedPosition = ${morphSumWgsl("position", count)};
${
  morphNormals
    ? `  let morphedNormal = ${morphSumWgsl("normal", count)};
`
    : ""
}`;
  const positionName = morph === undefined ? "position" : "morphedPosition";
  const normalName = morphNormals ? "morphedNormal" : "normal";
  const normalMatrix =
    morph === undefined
      ? "draw.normalMatrix"
      : "mat3x3<f32>(draw.normalColumn0.xyz, draw.normalColumn1.xyz, draw.normalColumn2.xyz)";
  return `struct VertexOutput {
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
${morphed}  let world = draw.model * vec4<f32>(${positionName}, 1.0);
  output.worldPosition = world.xyz;
  output.normal = ${
    normals ? `${normalMatrix} * ${normalName}` : "vec3<f32>(0.0, 0.0, 0.0)"
  };${
    map
      ? `
  output.uv = uv;`
      : ""
  }
  let clip = draw.viewProjection * world;
  // WebGL clip depth [-w, w] onto WebGPU's [0, w]; see wgpu-unlit.ts.
  output.position = vec4<f32>(clip.x, clip.y, (clip.z + clip.w) * 0.5, clip.w);
  return output;
}`;
}

/**
 * The lit WGSL module for one variant triple.
 *
 * Generated rather than stored, `unlitShaderSource`'s rule: the shared half is
 * written once and the text is a pure function of the flags, so the pipeline
 * cache keys on the descriptor. The fragment stage is the GL lit stage's
 * arithmetic in its order — normalize under the zero-length guard, base colour
 * times the optional sample, the directional term, then the punctual loop
 * *added to* the pre-existing expression — so a variant that samples nothing
 * under a scene with no punctual lights computes exactly what the GL program
 * computes with its switches at their initial values.
 *
 * `shadow` (WP-R1.7) swaps the light block for `wgpu-shadow.ts`'s widened
 * twin, splices `shadowFactor`, and multiplies the directional product before
 * it joins the lighting sum — GL's `useShadow` branch, as a variant; the
 * module header carries the argument. With it false — the default — the
 * fragment arithmetic is the WP-R1.5 expression; the vertex stage reads
 * `draw.normalMatrix` rather than the per-vertex cofactor that packet used.
 */
export function litShaderSource(
  normals: boolean,
  map: boolean,
  shadow = false,
  morph?: WgpuMorph,
): string {
  return `${drawUniformWgslFor(morph)}

${shadow ? SHADOW_LIGHT_UNIFORM_WGSL : LIGHT_UNIFORM_WGSL}${
    map
      ? `

${SHADED_MAP_BINDING_WGSL}`
      : ""
  }

${shadedVertexStageWgsl(normals, map, morph)}

${PUNCTUAL_LIGHT_WGSL}

${HEMISPHERE_IRRADIANCE_WGSL}${
    shadow
      ? `

${SHADOW_FACTOR_WGSL}`
      : ""
  }

${litFragmentStageWgsl(map, shadow)}`;
}

/**
 * The lit fragment stage, isolated so the skinned lit vertex
 * (`wgpu-skinning.ts`) splices the same source the unskinned family
 * compiles — the two cannot drift. `shadow` is WP-R1.7's variant flag,
 * forwarded so a receiving skinned draw multiplies the same
 * `shadowFactor` the unskinned lit family does.
 */
export function litFragmentStageWgsl(map: boolean, shadow = false): string {
  return `@fragment
fn ${FRAGMENT_ENTRY_POINT}(input : VertexOutput) -> @location(0) vec4<f32> {
  var base = draw.color;${
    map
      ? `
  base = base * textureSample(mapTexture, mapSampler, input.uv);`
      : ""
  }
  let len = length(input.normal);
  let n = select(vec3<f32>(0.0), input.normal / len, len > 0.0);
  var diffuse = 0.0;
  if (len > 0.0) {
    diffuse = max(dot(n, -lights.lightDirection.xyz), 0.0);
  }
  ${
    shadow
      ? `var direct = lights.lightColor.xyz * diffuse;
  if (len > 0.0) {
    direct = direct * shadowFactor(input.worldPosition, n);
  }`
      : `let direct = lights.lightColor.xyz * diffuse;`
  }
  var lighting = lights.ambientColor.xyz + hemisphereAmbient(len, n) + direct;
  if (len > 0.0) {
    let n = input.normal / len;
    let punctualCount = i32(lights.counts.x);
    for (var index = 0; index < punctualCount; index = index + 1) {
      let punctual = punctualLight(index, input.worldPosition);
      lighting = lighting + punctual.irradiance * max(dot(n, punctual.direction), 0.0);
    }
  }
  return vec4<f32>(base.rgb * lighting, base.a);
}
`;
}
