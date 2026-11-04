/**
 * The metallic-roughness pipeline in hand-written WGSL (§57
 * `StandardMaterial`, §59, WP-R1.5) — the WGSL port of `gl-standard.ts`'s
 * `StandardProgram`, plus the widened per-draw uniform block a standard draw
 * reads.
 *
 * ## The BRDF is the GL module's, conventions included
 *
 * Cook-Torrance over glTF's metallic-roughness parameterization — GGX `D`,
 * the Smith height-correlated visibility `V`, Schlick `F` — with the three
 * engine conventions `gl-standard.ts` records carried over verbatim, because
 * they are conventions of the *engine*, not of a backend:
 *
 * 1. **No `1/π` on either lobe** (R-13): light colour × intensity is already
 *    an irradiance over π, which is what lets a fully-rough dielectric
 *    `StandardMaterial` and a `LitMaterial` under one lamp read as one model.
 * 2. **Ambient reaches the diffuse lobe only** — a pure metal under ambient
 *    alone renders black until IBL exists, on both backends alike.
 * 3. **Roughness is floored in the shader** (`MIN_ROUGHNESS`), where the
 *    division lives, never clamped in the material.
 *
 * The guards are the GL stage's too: a zero-length normal shades
 * ambient-plus-emissive, `nDotL ≤ 0` skips the whole direct term, `nDotV` is
 * floored at `1e-4`, the `D` and `V` denominators at `1e-8`/`1e-6`. §69's
 * shadow multiply is a lazy variant (WP-R1.7, `wgpu-shadow.ts`): with
 * `shadow` false this arithmetic is exactly the GL stage with `useShadow` at
 * its initial `false`, and with it true the **directional lobe's** product is
 * bound to a local and multiplied by `shadowFactor` before joining `shaded` —
 * the R-17 shape `gl-standard.ts` records, with the same normalized `n` the
 * BRDF shades with fed to the normal bias.
 *
 * ## Why a second group-0 layout (the sprite precedent, second application)
 *
 * A standard draw needs two `vec4`s more than `DrawUniforms` carries — §59's
 * `emissive` term and the metalness/roughness pair — and widening the shared
 * block would move `minBindingSize` in every recorded initialization
 * transcript (`wgpu-sprite.ts`'s argument, byte for byte). So the standard
 * family declares a **third group-0 layout over the same strided uniform
 * buffer**: the same 256-byte blocks, the same dynamic offset per draw, a
 * binding size of {@link STANDARD_UNIFORM_BYTES}. The layout and its bind
 * group are created lazily by the first standard draw, so an application that
 * never shades a standard material records the transcript it always did. The
 * spare stride bytes were already allocated; a standard block reads 32 more of
 * them. The `normalMatrix` member sits at the same offset as
 * `DrawUniforms.normalMatrix` so `shadedVertexStageWgsl` can read
 * `draw.normalMatrix` on both structs.
 *
 * ```text
 * offset  member          contents
 *      0  viewProjection  as DrawUniforms
 *     64  model           as DrawUniforms
 *    128  baseColor       §59 base colour × opacity   (DrawUniforms.color's slot)
 *    144  normalMatrix    as DrawUniforms             (3 columns × vec4 stride)
 *    192  emissive        rgb (§59);                   w unused, written 0
 *    208  surface         x metalness, y roughness;    z normalScale - 1, w occlusionStrength - 1
 *    224  = STANDARD_UNIFORM_BYTES
 * ```
 *
 * 16-byte slots for `wgpu-lights.ts`'s alignment reason: every byte named,
 * none implied (`mat3x3` is three padded columns). The lights, the eye
 * position and §57's `map` bind exactly as the lit family's do
 * (`wgpu-lights.ts`).
 *
 * ## Packed metallic-roughness map (§59)
 *
 * `StandardMaterial.metalRoughnessMap` is sampled here as on WebGL: G is
 * roughness, B is metalness, each a multiply on the scalar factor. Bind-group
 * index is **not** a constant — WebGPU pipeline layouts are an array whose
 * index *is* the group, so an empty slot 2 would make `@group(3)` invalid.
 * Rule, documented also on `wgpu-lights.ts`: **MR at group 3 when albedo
 * occupies group 2, at group 2 when there is no albedo.**
 * `shadedMrBindingWgsl` is the one helper; {@link standardShaderSource}
 * passes `map ? 3 : 2`. Vertex uvs are written when *either* texture is
 * sampled (`shadedVertexStageWgsl(normals, map || metalRoughness || detail)`), matching
 * GL's `useMetalRoughnessMap` without `useMap`.
 *
 * ## Surface group (WP-W4.2): `normalMap` / `occlusionMap` / `emissiveMap`
 *
 * Groups 2 and 3 already hold albedo and metallic-roughness and the
 * four-group budget is full, so no fifth group is added; the three maps ride
 * a widened MR group instead. Final layout:
 *
 * ```text
 * group 0  StandardUniforms (dynamic offset)      group 1  lights (+ shadow)
 * group 2  albedo map (when map) | surface group when no albedo
 * group 3  surface group when albedo present
 * surface group = createSurfaceBindGroupLayout (wgpu-bindings.ts):
 *   binding 0 mrTexture   1 surfaceSampler (shared, filtering)
 *   binding 2 normalTexture  3 occlusionTexture  4 emissiveTexture
 * ```
 *
 * MR keeps bindings 0/1, so a draw with any of the three new maps binds this
 * layout *instead of* the 2-entry MR layout, at `map ? 3 : 2`. The shader
 * declares only the bindings its variant samples; the bind group supplies all
 * five, absent ones as 1x1 defaults ({@link SURFACE_DEFAULT_TEXELS}: white for
 * mr/occlusion/emissive, flat `(0.5, 0.5, 1)` for normal). WebGL's switches
 * are runtime booleans; here each is a compile-time variant flag, so absent
 * maps cost nothing in the shader.
 *
 * Math is `gl-standard.ts`'s: derivative tangent frame from world-position and
 * uv derivatives (`mappedNormal`, derivatives taken before any branch for quad
 * coherence; the sample uses `textureSampleGrad`), `xy` scaled by
 * `1 + normalScaleOffset`; occlusion `mix(1, ao.r, 1 + occlusionStrengthOffset)`
 * multiplies the ambient diffuse term only; `emissive * emissiveMap.rgb`. The
 * two offsets travel in `surface.z` / `surface.w` (spare slots, previously
 * written 0, so a zero default is "no change" exactly as in GL).
 */

import {
  SURFACE_EMISSIVE_BINDING,
  SURFACE_MR_BINDING,
  SURFACE_NORMAL_BINDING,
  SURFACE_OCCLUSION_BINDING,
  SURFACE_SAMPLER_BINDING,
} from "./wgpu-bindings.js";
import {
  GPU_SHADER_STAGE,
  type GpuBindGroupLayout,
  type GpuDevice,
} from "./webgpu-device.js";
import {
  LIGHT_UNIFORM_WGSL,
  HEMISPHERE_IRRADIANCE_WGSL,
  PUNCTUAL_LIGHT_WGSL,
  SHADED_MAP_BIND_GROUP_INDEX,
  SHADED_MAP_BINDING_WGSL,
  SHADED_MR_BIND_GROUP_INDEX,
  shadedMrBindingWgsl,
} from "./wgpu-lights.js";
import { shadedVertexStageWgsl } from "./wgpu-lit.js";
import {
  SHADOW_FACTOR_WGSL,
  SHADOW_LIGHT_UNIFORM_WGSL,
} from "./wgpu-shadow.js";
import { FRAGMENT_ENTRY_POINT, type WgpuMorph } from "./wgpu-unlit.js";

/** Which of the three surface-detail maps a standard variant samples. */
export interface SurfaceMaps {
  readonly normal: boolean;
  readonly occlusion: boolean;
  readonly emissive: boolean;
}

/** No detail maps — the landed variants, byte-identical. */
export const NO_SURFACE_MAPS: SurfaceMaps = Object.freeze({
  normal: false,
  occlusion: false,
  emissive: false,
});

/**
 * 1x1 RGBA8 texels bound for absent slots of the surface group: white for
 * mr / occlusion / emissive (multiplicative identity), flat tangent-space
 * normal for normal.
 */
export const SURFACE_DEFAULT_TEXELS = Object.freeze({
  metalRoughness: [255, 255, 255, 255],
  normal: [128, 128, 255, 255],
  occlusion: [255, 255, 255, 255],
  emissive: [255, 255, 255, 255],
} as const);

/**
 * The surface group's WGSL declarations — only the bindings the variant
 * samples (the layout declares all five). The sampler is always declared.
 */
export function surfaceBindingWgsl(
  group: number,
  surface: SurfaceMaps,
  metalRoughness: boolean,
): string {
  const g = String(group);
  const decl = (binding: number, name: string): string =>
    `@group(${g}) @binding(${String(binding)}) var ${name} : texture_2d<f32>;`;
  const lines = [
    `@group(${g}) @binding(${String(SURFACE_SAMPLER_BINDING)}) var surfaceSampler : sampler;`,
  ];
  if (metalRoughness) lines.push(decl(SURFACE_MR_BINDING, "mrTexture"));
  if (surface.normal) lines.push(decl(SURFACE_NORMAL_BINDING, "normalTexture"));
  if (surface.occlusion) {
    lines.push(decl(SURFACE_OCCLUSION_BINDING, "occlusionTexture"));
  }
  if (surface.emissive) {
    lines.push(decl(SURFACE_EMISSIVE_BINDING, "emissiveTexture"));
  }
  return lines.join("\n");
}

/** `gl-standard.ts`'s `mappedNormal`, ported (derivatives passed in, uniform flow). */
const MAPPED_NORMAL_WGSL = `fn mappedNormal(n : vec3<f32>, dpdxV : vec3<f32>, dpdyV : vec3<f32>, duvdx : vec2<f32>, duvdy : vec2<f32>, uv : vec2<f32>) -> vec3<f32> {
  let tangent = cross(dpdyV, n) * duvdx.x + cross(n, dpdxV) * duvdy.x;
  let bitangent = cross(dpdyV, n) * duvdx.y + cross(n, dpdxV) * duvdy.y;
  let frameLength = max(dot(tangent, tangent), dot(bitangent, bitangent));
  if (frameLength <= 1e-20) {
    return n;
  }
  var sampleNormal = textureSampleGrad(normalTexture, surfaceSampler, uv, duvdx, duvdy).xyz * 2.0 - vec3<f32>(1.0);
  sampleNormal = vec3<f32>(sampleNormal.xy * (1.0 + draw.surface.z), sampleNormal.z);
  let invFrame = inverseSqrt(frameLength);
  let perturbed = mat3x3<f32>(tangent * invFrame, bitangent * invFrame, n) * sampleNormal;
  let magnitude = length(perturbed);
  return select(n, perturbed / magnitude, magnitude > 1e-10);
}`;

/** Byte offset of `StandardUniforms.viewProjection` — shared with `DrawUniforms`. */
export const STANDARD_VIEW_PROJECTION_OFFSET = 0;

/** Byte offset of `StandardUniforms.model` — shared with `DrawUniforms`. */
export const STANDARD_MODEL_OFFSET = 64;

/** Byte offset of `StandardUniforms.baseColor` — `DrawUniforms.color`'s slot, renamed. */
export const STANDARD_BASE_COLOR_OFFSET = 128;

/** Byte offset of `StandardUniforms.normalMatrix` — `DrawUniforms.normalMatrix`'s slot. */
export const STANDARD_NORMAL_OFFSET = 144;

/** Byte offset of `StandardUniforms.emissive` (rgb; w unused, written 0). */
export const STANDARD_EMISSIVE_OFFSET = 192;

/** Byte offset of `StandardUniforms.surface` (x metalness, y roughness; z normalScale - 1, w occlusionStrength - 1). */
export const STANDARD_SURFACE_OFFSET = 208;

/**
 * Size of the `StandardUniforms` block in bytes — the binding size, not the
 * 256-byte stride (`SPRITE_UNIFORM_BYTES`' distinction, restated).
 */
export const STANDARD_UNIFORM_BYTES = 224;

/**
 * The standard draw's group-0 layout: binding 0, a dynamically-offset uniform
 * buffer of {@link STANDARD_UNIFORM_BYTES}, visible to both stages (the vertex
 * stage reads the matrices, the fragment stage the colour and surface).
 *
 * Created lazily by the renderer's first standard draw — see the module header
 * for why this is a third layout rather than a widened `DrawUniforms`.
 */
export function createStandardBindGroupLayout(
  device: GpuDevice,
): GpuBindGroupLayout {
  return device.createBindGroupLayout({
    label: "fourJS:standard-uniforms",
    entries: [
      {
        binding: 0,
        visibility: GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT,
        buffer: {
          type: "uniform",
          hasDynamicOffset: true,
          minBindingSize: STANDARD_UNIFORM_BYTES,
        },
      },
    ],
  });
}

/**
 * The WGSL declaration of the block above — `DRAW_UNIFORM_WGSL`'s discipline:
 * declared layout and read layout side by side in one module.
 *
 * The variable is named `draw`, as every group-0 block in this package is, so
 * the shared vertex stage (`shadedVertexStageWgsl`) splices in unchanged.
 */
export const STANDARD_UNIFORM_WGSL = `struct StandardUniforms {
  viewProjection : mat4x4<f32>,
  model : mat4x4<f32>,
  baseColor : vec4<f32>,
  normalMatrix : mat3x3<f32>,
  emissive : vec4<f32>,
  surface : vec4<f32>,
};

@group(0) @binding(0) var<uniform> draw : StandardUniforms;`;

/**
 * {@link STANDARD_UNIFORM_WGSL} with `normalMatrix` spelled as its three padded
 * columns (`MORPH_DRAW_UNIFORM_WGSL`'s move): same layout, but column 0's pad
 * word — the one-target morph weight — is nameable.
 */
export const MORPH_STANDARD_UNIFORM_WGSL = STANDARD_UNIFORM_WGSL.replace(
  "normalMatrix : mat3x3<f32>,",
  "normalColumn0 : vec4<f32>,\n  normalColumn1 : vec4<f32>,\n  normalColumn2 : vec4<f32>,",
);

/**
 * The standard WGSL module for one variant quadruple — the lit family's
 * (`normals`, `map`, WP-R1.7's `shadow`) plus §59's packed metallic-roughness
 * map. `metalRoughness` defaults false so every landed scalar-only module is
 * byte-identical. The vertex stage is the lit family's, over this module's
 * own uniform block, and writes uvs when *either* texture is sampled; both
 * structs carry `normalMatrix` at the same offset so the shared vertex stage
 * reads `draw.normalMatrix` unchanged.
 *
 * The fragment stage is `STANDARD_FRAGMENT_SHADER_SOURCE`'s arithmetic in its
 * order: the base sample, the diffuse/F0 split, ambient into the diffuse lobe,
 * then — under the normal-length guard — the shared `directLobe` evaluated
 * once for the directional light and once per punctual light, each multiplied
 * by its irradiance and cosine *at the call site*, exactly as the GL refactor
 * keeps the directional term the pre-R-17 expression. Emissive is added last,
 * outside every guard, so a normal-less or back-facing surface still glows.
 */
export function standardShaderSource(
  normals: boolean,
  map: boolean,
  shadow = false,
  metalRoughness = false,
  surface: SurfaceMaps = NO_SURFACE_MAPS,
  morph?: WgpuMorph,
): string {
  const detail = surface.normal || surface.occlusion || surface.emissive;
  const surfaceGroup = map
    ? SHADED_MR_BIND_GROUP_INDEX
    : SHADED_MAP_BIND_GROUP_INDEX;
  return `${morph === undefined ? STANDARD_UNIFORM_WGSL : MORPH_STANDARD_UNIFORM_WGSL}

${shadow ? SHADOW_LIGHT_UNIFORM_WGSL : LIGHT_UNIFORM_WGSL}${
    map
      ? `

${SHADED_MAP_BINDING_WGSL}`
      : ""
  }${
    metalRoughness
      ? `

${
  detail
    ? surfaceBindingWgsl(surfaceGroup, surface, true)
    : shadedMrBindingWgsl(surfaceGroup)
}`
      : detail
        ? `

${surfaceBindingWgsl(surfaceGroup, surface, false)}`
        : ""
  }

${shadedVertexStageWgsl(normals, map || metalRoughness || detail, morph)}

${PUNCTUAL_LIGHT_WGSL}

${HEMISPHERE_IRRADIANCE_WGSL}${
    shadow
      ? `

${SHADOW_FACTOR_WGSL}`
      : ""
  }

const DIELECTRIC_F0 : f32 = 0.04;
const MIN_ROUGHNESS : f32 = 0.045;${surface.normal ? `\n\n${MAPPED_NORMAL_WGSL}` : ""}

fn directLobe(
  n : vec3<f32>,
  v : vec3<f32>,
  l : vec3<f32>,
  nDotL : f32,
  diffuseColor : vec3<f32>,
  f0 : vec3<f32>,
  alpha2 : f32,
) -> vec3<f32> {
  let h = normalize(l + v);
  let nDotV = max(dot(n, v), 1e-4);
  let nDotH = max(dot(n, h), 0.0);
  let vDotH = clamp(dot(v, h), 0.0, 1.0);

  let denominator = nDotH * nDotH * (alpha2 - 1.0) + 1.0;
  let distribution = alpha2 / max(denominator * denominator, 1e-8);

  let visibilityV = nDotL * sqrt(nDotV * nDotV * (1.0 - alpha2) + alpha2);
  let visibilityL = nDotV * sqrt(nDotL * nDotL * (1.0 - alpha2) + alpha2);
  let visibility = 0.5 / max(visibilityV + visibilityL, 1e-6);

  let fresnel = f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - vDotH, 5.0);
  let specular = vec3<f32>(distribution * visibility) * fresnel;

  return diffuseColor + specular;
}

@fragment
fn ${FRAGMENT_ENTRY_POINT}(input : VertexOutput) -> @location(0) vec4<f32> {
${
  surface.normal
    ? `  let wpdx = dpdx(input.worldPosition);
  let wpdy = dpdy(input.worldPosition);
  let uvdx = dpdx(input.uv);
  let uvdy = dpdy(input.uv);
`
    : ""
}  var base = draw.baseColor;${
    map
      ? `
  base = base * textureSample(mapTexture, mapSampler, input.uv);`
      : ""
  }
  let albedo = base.rgb;${
    metalRoughness
      ? `
  var metalness = draw.surface.x;
  var roughness = draw.surface.y;
  let mr = textureSample(mrTexture, ${detail ? "surfaceSampler" : "mrSampler"}, input.uv);
  metalness = metalness * mr.b;
  roughness = roughness * mr.g;`
      : `
  let metalness = draw.surface.x;`
  }
  let diffuseColor = albedo * (1.0 - metalness);
  let f0 = mix(vec3<f32>(DIELECTRIC_F0), albedo, metalness);
  let normalLength = length(input.normal);
  var nHemi = select(vec3<f32>(0.0), input.normal / normalLength, normalLength > 0.0);${
    surface.normal
      ? `
  if (normalLength > 0.0) {
    nHemi = mappedNormal(nHemi, wpdx, wpdy, uvdx, uvdy, input.uv);
  }`
      : ""
  }${
    surface.occlusion
      ? `
  let occlusion = mix(1.0, textureSample(occlusionTexture, surfaceSampler, input.uv).r, 1.0 + draw.surface.w);`
      : ""
  }
  var shaded = (lights.ambientColor.xyz + hemisphereAmbient(normalLength, nHemi)) * diffuseColor${surface.occlusion ? " * occlusion" : ""};
  if (normalLength > 0.0) {
    let n = ${surface.normal ? "nHemi" : "input.normal / normalLength"};
    let v = normalize(lights.cameraPosition.xyz - input.worldPosition);

    var alpha = max(${metalRoughness ? "roughness" : "draw.surface.y"}, MIN_ROUGHNESS);
    alpha = alpha * alpha;
    let alpha2 = alpha * alpha;

    let l = -lights.lightDirection.xyz;
    let nDotL = dot(n, l);
    if (nDotL > 0.0) {
      ${
        shadow
          ? `var direct = directLobe(n, v, l, nDotL, diffuseColor, f0, alpha2)
        * lights.lightColor.xyz * nDotL;
      direct = direct * shadowFactor(input.worldPosition, n);
      shaded = shaded + direct;`
          : `shaded = shaded + directLobe(n, v, l, nDotL, diffuseColor, f0, alpha2)
        * lights.lightColor.xyz * nDotL;`
      }
    }

    let punctualCount = i32(lights.counts.x);
    for (var index = 0; index < punctualCount; index = index + 1) {
      let punctual = punctualLight(index, input.worldPosition);
      let pnDotL = dot(n, punctual.direction);
      if (pnDotL > 0.0) {
        shaded = shaded
          + directLobe(n, v, punctual.direction, pnDotL, diffuseColor, f0, alpha2)
          * punctual.irradiance * pnDotL;
      }
    }
  }

  return vec4<f32>(shaded + ${
    surface.emissive
      ? "draw.emissive.xyz * textureSample(emissiveTexture, surfaceSampler, input.uv).rgb"
      : "draw.emissive.xyz"
  }, base.a);
}
`;
}
