/**
 * §69's shadow tier on WebGPU (WP-R1.7): the depth-only caster module, the
 * widened light block that carries the shadow matrix and biases, the
 * comparison-sampler bindings, and the receiver-side WGSL chunk the shaded
 * families splice in.
 *
 * This is the WGSL port of `gl-shadow.ts` plus the shadow half of
 * `gl-program.ts` (`SHADOW_GLSL`, `ShadowUniforms`), and the same single tier
 * ships: one directional light's map, rendered depth-only and sampled back
 * with a 3×3 percentage-closer filter. `@fourjs/scene`'s
 * `DirectionalLightShadow` owns the list of what is staged; this module owns
 * how the shipped tier becomes WebGPU.
 *
 * ## The layout is structurally different from GL's, and declared as data
 *
 * GL binds the map to a numbered texture unit (`SHADOW_TEXTURE_UNIT`) and
 * samples it as a plain `sampler2D`. WebGPU has no units, and a depth
 * comparison is a **distinct binding type**: `texture_depth_2d` plus
 * `sampler_comparison`, neither of which the `map` layout
 * (`createTextureBindGroupLayout`) can describe — a `float`-sampled,
 * `filtering` pair is API-invalid for a depth comparison. So the shadow gets
 * its own layout, and it joins the **lights group** rather than claiming a
 * group of its own: {@link createShadowLightsBindGroupLayout} is a widened
 * twin of `createLightsBindGroupLayout` — the same dynamically-offset uniform
 * buffer at binding 0, now {@link SHADOW_LIGHT_UNIFORM_BYTES} long, plus the
 * map at {@link SHADOW_MAP_BINDING} and the comparison sampler at
 * {@link SHADOW_SAMPLER_BINDING}. A shadow map is per-frame state and the
 * light block is per-view state, so the pairing is lifetime-correct, it keeps
 * §57's `map` at its landed group index for every variant, and it stays
 * inside WebGPU's four-group guarantee.
 *
 * The uniform widening itself is the sprite/standard move one group over: the
 * shadow matrix and parameters ride the **spare stride bytes** the light
 * buffer already allocates (`LIGHT_UNIFORM_STRIDE_BYTES` 768 against
 * `LIGHT_UNIFORM_BYTES` 592), so no landed layout, binding size, or transcript
 * moves — a draw that receives no shadow still binds the narrow block through
 * the landed layout, and a shadowless scene records not one of these objects.
 *
 * ## `useShadow` becomes a lazy variant, not a uniform
 *
 * GL folds "is this draw shadowed" into a `bool` uniform mirrored at its
 * initial `false`. Here it is pipeline identity — the R-19 inversion, fifth
 * application: the shaded WGSL builders take a `shadow` flag, the pipeline
 * key appends `|sh:y` **only when the draw receives** (`§49 receiveShadow` ∧
 * the frame produced a map), and a non-receiver inside a shadowed frame draws
 * through the very pipeline a shadowless frame compiled — one object, one
 * key, byte-identical to what WP-R1.5 landed. The R1.5 statement "the shaded
 * stages are GL-with-`useShadow`-false, verbatim" is now the *unshadowed
 * variant's* description; the shadowed variant is GL-with-`useShadow`-true,
 * operation for operation.
 *
 * ## The comparison is GL's arithmetic, tap for tap
 *
 * GL deliberately uses a plain `NEAREST` sampler and nine explicit
 * `receiver <= occluder` comparisons, so the filter is arithmetic the engine
 * can state (§33). The WGSL port keeps every tap and the `/9`:
 * `textureSampleCompareLevel` with a **nearest, `less-equal`** comparison
 * sampler is exactly one single-texel `receiver <= occluder` per call — the
 * hardware evaluates the comparison, never a wider filter — and the `Level`
 * form samples mip 0 without implicit derivatives, so the call is legal
 * inside the non-uniform `len > 0` guard where GL also evaluates it
 * (`textureSampleCompare` would trip WGSL's derivative-uniformity analysis
 * there). The four recorded `SHADOW_GLSL` decisions carry over verbatim:
 * outside the volume is lit, the perspective divide stays although the tier's
 * projection is orthographic, `shadowBias` is subtracted from the receiver,
 * and the normal bias offsets the sample **position** in world space.
 *
 * One line is new, and it is the two-backends line: the receiver's `v`
 * coordinate is `0.5 - ndc.y * 0.5`, not GL's `ndc.y * 0.5 + 0.5`, because
 * this backend's caster pass rasterises with WebGPU's top-left framebuffer
 * origin — the same flip `webgpu-renderer.ts` applies to §48 rectangles,
 * applied to the map's texture space. Depth needs no counterpart: the caster
 * vertex stage applies the standard §3.3.8 remap, which lands the stored
 * depth on GL's `[0, 1]` window convention exactly.
 *
 * ## The caster pass borrows nothing — the mirror-state discipline evaporates
 *
 * GL's `#renderShadowMap` borrows the framebuffer binding, both rectangles
 * and the current program, and its caller owes a re-bind — four pieces of
 * ambient state a throw could leak. Here the caster pass is **its own render
 * pass**: viewport, scissor and stencil reference reset to pass defaults, no
 * mirror consulted, nothing to restore, and a throw simply never submits.
 * §67's clips stay out for R-23's structural reason, now stronger: the map's
 * `depth32float` attachment (the R1.6 format-table row) *cannot* carry
 * stencil planes, so a clipped surface casts its whole shadow — the §69
 * analogue of a sprite casting its rectangle.
 *
 * ## Who casts (the GL exclusions, restated for this backend's tiers)
 *
 * The pass draws the frame's own render list filtered to `castShadow` items
 * of the kinds this backend draws — `unlit`, `lit`, `standard`. Sprites are
 * excluded (a depth-only pass would cast the §55 rectangle, not the texture);
 * particles carry `castShadow: false` from the list builder; masks likewise.
 * Skinned casters draw through `acquireShadow()` on the registered
 * colour pair — unregistered or failed skips, never a bind-pose
 * silhouette. `node` items: an undisplaced graph casts its geometry
 * exactly (depth ignores colour), while a displacing graph would cast
 * its *undisplaced* silhouette, a different picture, so those casters
 * skip: GL's node-caster rule, verbatim (and like GL's, registration-
 * independent — the caster module is this backend's own).
 */

import { SHADOW_CUBE_FACES, type SceneLights } from "@fourjs/render";

import {
  GPU_SHADER_STAGE,
  type GpuBindGroupLayout,
  type GpuDevice,
  type GpuSampler,
} from "./webgpu-device.js";
import { DRAW_UNIFORM_WGSL } from "./wgpu-bindings.js";
import {
  LIGHTS_BIND_GROUP_INDEX,
  LIGHT_BINDING_BYTES,
  HEMISPHERE_UNIFORM_MEMBERS_WGSL,
  LIGHT_UNIFORM_BYTES,
  LIGHT_UNIFORM_MEMBERS_WGSL,
  LIGHT_UNIFORM_STRIDE_BYTES,
} from "./wgpu-lights.js";
import {
  FRAGMENT_ENTRY_POINT,
  POSITION_SHADER_LOCATION,
  VERTEX_ENTRY_POINT,
} from "./wgpu-unlit.js";

/**
 * Byte offset of `ShadowLightUniforms.shadowMatrix` — the first spare stride
 * byte after the landed block, which is already the 16-byte alignment a
 * `mat4x4<f32>` member demands (592 = 37 × 16).
 */
export const SHADOW_MATRIX_OFFSET = LIGHT_UNIFORM_BYTES;

/**
 * Byte offset of `ShadowLightUniforms.shadowParams`:
 * `x` = `shadowBias`, `y` = `shadowNormalBias`, `z` = the PCF tap offset
 * `1 / shadowMapSize` (computed once per view on the CPU, as GL computes it
 * once per frame), `w` unused, written 0.
 */
export const SHADOW_PARAMS_OFFSET = SHADOW_MATRIX_OFFSET + 64;

/**
 * Size of the landed `ShadowLightUniforms` block — the shadow tail (80 bytes)
 * plus the hemisphere members that follow it (48 bytes): 912 bytes. The W6.3
 * atlas tail begins here.
 */
export const SHADOW_LEGACY_UNIFORM_BYTES = SHADOW_PARAMS_OFFSET + 16 + 48;

/**
 * Byte offset of `cascadeMatrix : array<mat4x4<f32>, 4>` (W6.3) — the first
 * byte after the hemisphere tail, 16-aligned as a `mat4x4` member demands.
 */
export const SHADOW_CASCADE_MATRIX_OFFSET = LIGHT_BINDING_BYTES;

/** Byte offset of `spotMatrix : array<mat4x4<f32>, 4>` — spot view-projections by shadow index. */
export const SHADOW_SPOT_MATRIX_OFFSET = SHADOW_CASCADE_MATRIX_OFFSET + 256;

/** Byte offset of `cascadeSplits` — far view distance per cascade. */
export const SHADOW_CASCADE_SPLITS_OFFSET = SHADOW_SPOT_MATRIX_OFFSET + 256;

/** Byte offset of `viewDepth` — the fitting camera's `[fx, fy, fz, w]` depth row. */
export const SHADOW_VIEW_DEPTH_OFFSET = SHADOW_CASCADE_SPLITS_OFFSET + 16;

/** Byte offset of `atlas` — `[columns, rows, 1 / width, 1 / height]`. */
export const SHADOW_ATLAS_OFFSET = SHADOW_VIEW_DEPTH_OFFSET + 16;

/** Byte offset of `info` — `x` cascade count, `y` 1 on the atlas path, `z` punctual shadows. */
export const SHADOW_INFO_OFFSET = SHADOW_ATLAS_OFFSET + 16;

/** Byte offset of `atlasSlot` — three `vec4`s, `shadow index + 1` per light slot. */
export const SHADOW_PUNCTUAL_SLOT_OFFSET = SHADOW_INFO_OFFSET + 16;

/** Byte offset of `atlasParams` — `[baseTile, bias, normalBias, kind]` per shadow index. */
export const SHADOW_PUNCTUAL_PARAMS_OFFSET = SHADOW_PUNCTUAL_SLOT_OFFSET + 48;

/** Byte offset of `atlasRange` — `[near, far, 0, 0]` per shadow index. */
export const SHADOW_PUNCTUAL_RANGE_OFFSET = SHADOW_PUNCTUAL_PARAMS_OFFSET + 64;

/**
 * Size of one `ShadowLightUniforms` block — the landed 912 bytes plus the
 * 752-byte W6.3 atlas tail: 1664 bytes, inside the 2048-byte stride.
 */
export const SHADOW_LIGHT_UNIFORM_BYTES = SHADOW_PUNCTUAL_RANGE_OFFSET + 64;

/** `@binding(1)` of the shadow-lights group — the `texture_depth_2d` map. */
export const SHADOW_MAP_BINDING = 1;

/** `@binding(2)` of the shadow-lights group — the `sampler_comparison`. */
export const SHADOW_SAMPLER_BINDING = 2;

/**
 * The shadowed shaded families' group-1 layout: the widened light block plus
 * the two comparison bindings — see the module header for why this is a
 * second lights layout rather than a widened `createLightsBindGroupLayout`
 * or a fourth group.
 *
 * All three entries are **fragment-only** for the landed layouts' reason: no
 * vertex stage in this package reads a light or samples a shadow. Created
 * lazily by the renderer's first shadowed draw — the WP-R1.2 precedent — so
 * a shadowless application records none of it.
 */
export function createShadowLightsBindGroupLayout(
  device: GpuDevice,
): GpuBindGroupLayout {
  return device.createBindGroupLayout({
    label: "fourJS:shadow-lights",
    entries: [
      {
        binding: 0,
        visibility: GPU_SHADER_STAGE.FRAGMENT,
        buffer: {
          type: "uniform",
          hasDynamicOffset: true,
          minBindingSize: SHADOW_LIGHT_UNIFORM_BYTES,
        },
      },
      {
        binding: SHADOW_MAP_BINDING,
        visibility: GPU_SHADER_STAGE.FRAGMENT,
        texture: { sampleType: "depth", viewDimension: "2d" },
      },
      {
        binding: SHADOW_SAMPLER_BINDING,
        visibility: GPU_SHADER_STAGE.FRAGMENT,
        sampler: { type: "comparison" },
      },
    ],
  });
}

/**
 * The one comparison sampler every shadowed draw shares: `less-equal` —
 * GL's `receiver <= occluder`, evaluated by the sampler — over a **nearest**,
 * clamped tap, so each `textureSampleCompareLevel` is exactly one texel's
 * comparison and the 3×3 filter stays the explicit arithmetic `SHADOW_GLSL`
 * records (§33). Created by the first shadowed draw, beside the layout.
 */
export function createShadowSampler(device: GpuDevice): GpuSampler {
  return device.createSampler({
    label: "fourJS:shadow-sampler",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    magFilter: "nearest",
    minFilter: "nearest",
    mipmapFilter: "nearest",
    compare: "less-equal",
  });
}

/**
 * The widened light block and the two comparison bindings, as WGSL — spliced
 * into the shadowed shaded variants **in place of** `LIGHT_UNIFORM_WGSL`.
 *
 * The variable is named `lights`, like the narrow block's, so the punctual
 * chunk and both fragment bodies splice in unchanged; the first
 * {@link LIGHT_UNIFORM_BYTES} bytes are `LIGHT_UNIFORM_MEMBERS_WGSL`
 * verbatim, so the two structs cannot disagree about where a light lives.
 */
export const SHADOW_LIGHT_UNIFORM_WGSL = `struct ShadowLightUniforms {
${LIGHT_UNIFORM_MEMBERS_WGSL}
  shadowMatrix : mat4x4<f32>,
  shadowParams : vec4<f32>,
${HEMISPHERE_UNIFORM_MEMBERS_WGSL}
  cascadeMatrix : array<mat4x4<f32>, 4>,
  spotMatrix : array<mat4x4<f32>, 4>,
  cascadeSplits : vec4<f32>,
  viewDepth : vec4<f32>,
  atlas : vec4<f32>,
  info : vec4<f32>,
  atlasSlot : array<vec4<f32>, 3>,
  atlasParams : array<vec4<f32>, 4>,
  atlasRange : array<vec4<f32>, 4>,
};

@group(${String(LIGHTS_BIND_GROUP_INDEX)}) @binding(0) var<uniform> lights : ShadowLightUniforms;
@group(${String(LIGHTS_BIND_GROUP_INDEX)}) @binding(${String(SHADOW_MAP_BINDING)}) var shadowMap : texture_depth_2d;
@group(${String(LIGHTS_BIND_GROUP_INDEX)}) @binding(${String(SHADOW_SAMPLER_BINDING)}) var shadowSampler : sampler_comparison;`;

/**
 * The receiver-side factor — `SHADOW_GLSL`'s `shadowFactor`, tap for tap;
 * the module header walks the two deliberate differences (the `v` flip, the
 * comparison evaluated by the sampler instead of in the loop body).
 */
/** `vec3<f32>(…)` literals of one face axis per cube face, for the shaders. */
function faceTable(axis: "forward" | "up" | "right"): string {
  return SHADOW_CUBE_FACES.map(
    (face) => `vec3<f32>(${face[axis].map((v) => v.toFixed(1)).join(", ")})`,
  ).join(", ");
}

export const SHADOW_FACTOR_WGSL = `var<private> SHADOW_FACE_FORWARD : array<vec3<f32>, 6> = array<vec3<f32>, 6>(${faceTable("forward")});
var<private> SHADOW_FACE_UP : array<vec3<f32>, 6> = array<vec3<f32>, 6>(${faceTable("up")});
var<private> SHADOW_FACE_RIGHT : array<vec3<f32>, 6> = array<vec3<f32>, 6>(${faceTable("right")});

fn shadowTileTaps(tile : f32, uv : vec2<f32>, receiver : f32) -> f32 {
  let grid = lights.atlas.xy;
  let row = floor((tile + 0.5) / grid.x);
  let col = tile - row * grid.x;
  let origin = vec2<f32>(col, row) / grid;
  let texel = lights.atlas.zw;
  let lo = origin + 0.5 * texel;
  let hi = origin + 1.0 / grid - 0.5 * texel;
  let base = origin + uv / grid;
  var lit = 0.0;
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let tap = clamp(base + vec2<f32>(f32(x), f32(y)) * texel, lo, hi);
      lit = lit + textureSampleCompareLevel(shadowMap, shadowSampler, tap, receiver);
    }
  }
  return lit / 9.0;
}

fn shadowReceiverDepth(z : f32, near : f32, far : f32, bias : f32) -> f32 {
  let zb = max(z - bias * (far - near), near);
  return far * (zb - near) / ((far - near) * zb);
}

fn directionalShadowAtlas(worldPosition : vec3<f32>, n : vec3<f32>) -> f32 {
  let cascadeCount = i32(lights.info.x);
  if (cascadeCount < 1) {
    return 1.0;
  }
  var cascade = 0;
  if (cascadeCount > 1) {
    let depth = dot(lights.viewDepth.xyz, worldPosition) + lights.viewDepth.w;
    cascade = -1;
    for (var i = 0; i < 4; i = i + 1) {
      if (cascade < 0 && i < cascadeCount && depth <= lights.cascadeSplits[i]) {
        cascade = i;
      }
    }
    if (cascade < 0) {
      return 1.0;
    }
  }
  let lightSpace = lights.cascadeMatrix[cascade] * vec4<f32>(worldPosition + n * lights.shadowParams.y, 1.0);
  let ndc = lightSpace.xyz / lightSpace.w;
  let c = vec3<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5, ndc.z * 0.5 + 0.5);
  if (any(c < vec3<f32>(0.0)) || any(c > vec3<f32>(1.0))) {
    return 1.0;
  }
  return shadowTileTaps(f32(cascade), c.xy, c.z - lights.shadowParams.x);
}

fn punctualShadowFactor(index : i32, worldPosition : vec3<f32>, n : vec3<f32>) -> f32 {
  if (lights.info.y < 0.5) {
    return 1.0;
  }
  let entry = lights.atlasSlot[index / 4][index % 4];
  if (entry < 0.5) {
    return 1.0;
  }
  let k = i32(entry) - 1;
  let params = lights.atlasParams[k];
  let planes = lights.atlasRange[k];
  let p = worldPosition + n * params.z;
  if (params.w < 1.5) {
    let lightSpace = lights.spotMatrix[k] * vec4<f32>(p, 1.0);
    if (lightSpace.w <= 0.0) {
      return 1.0;
    }
    let ndc = lightSpace.xyz / lightSpace.w;
    let c = vec3<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5, ndc.z * 0.5 + 0.5);
    if (any(c < vec3<f32>(0.0)) || any(c > vec3<f32>(1.0))) {
      return 1.0;
    }
    return shadowTileTaps(
      params.x, c.xy, shadowReceiverDepth(lightSpace.w, planes.x, planes.y, params.y));
  }
  let d = p - lights.punctualPosition[index].xyz;
  let a = abs(d);
  var face = 5;
  if (a.x >= a.y && a.x >= a.z) {
    face = select(1, 0, d.x >= 0.0);
  } else if (a.y >= a.z) {
    face = select(3, 2, d.y >= 0.0);
  } else {
    face = select(5, 4, d.z >= 0.0);
  }
  let vz = dot(d, SHADOW_FACE_FORWARD[face]);
  if (vz <= planes.x || vz >= planes.y) {
    return 1.0;
  }
  let uv = vec2<f32>(
    dot(d, SHADOW_FACE_RIGHT[face]) / vz * 0.5 + 0.5,
    0.5 - dot(d, SHADOW_FACE_UP[face]) / vz * 0.5);
  return shadowTileTaps(
    params.x + f32(face), uv, shadowReceiverDepth(vz, planes.x, planes.y, params.y));
}

fn shadowFactor(worldPosition : vec3<f32>, n : vec3<f32>) -> f32 {
  if (lights.info.y > 0.5) {
    return directionalShadowAtlas(worldPosition, n);
  }
  let lightSpace = lights.shadowMatrix * vec4<f32>(worldPosition + n * lights.shadowParams.y, 1.0);
  let ndc = lightSpace.xyz / lightSpace.w;
  // x and depth map [-1, 1] onto [0, 1]; v flips for the top-left map origin.
  let c = vec3<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5, ndc.z * 0.5 + 0.5);
  if (any(c < vec3<f32>(0.0)) || any(c > vec3<f32>(1.0))) {
    return 1.0;
  }
  let receiver = c.z - lights.shadowParams.x;
  var lit = 0.0;
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let tap = c.xy + vec2<f32>(f32(x), f32(y)) * lights.shadowParams.z;
      lit = lit + textureSampleCompareLevel(shadowMap, shadowSampler, tap, receiver);
    }
  }
  return lit / 9.0;
}`;

/**
 * The depth-only caster module — `gl-shadow.ts`'s two stages, ported.
 *
 * The vertex stage transforms through `model` then `viewProjection` in the
 * exact association `shadedVertexStageWgsl` uses, with the same §3.3.8 depth
 * remap on the way out — a caster and its own on-screen draw then agree with
 * the receiver's `shadowMatrix * world` arithmetic, which is one fewer source
 * of disagreement between the depth a receiver computes and the depth the map
 * holds. `draw.viewProjection` carries the light's matrix
 * (`SceneLights.shadowMatrix`); the block is the ordinary strided
 * `DrawUniforms`, so the caster pass needs no layout of its own.
 *
 * The fragment stage writes constant opaque white for `gl-shadow.ts`'s
 * reason, one shade stronger here: WebGPU requires a fragment output for
 * every colour attachment the pass carries, and the shadow target's cache row
 * (R1.6) always allocates one — so the constant is both the defined-behaviour
 * answer and a debug view of the map that shows a silhouette. `draw.color` is
 * never read; the renderer packs the canonical zero block, like a mask's.
 */
export const SHADOW_SHADER_SOURCE = `${DRAW_UNIFORM_WGSL}

@vertex
fn ${VERTEX_ENTRY_POINT}(
  @location(${String(POSITION_SHADER_LOCATION)}) position : vec3<f32>,
) -> @builtin(position) vec4<f32> {
  let world = draw.model * vec4<f32>(position, 1.0);
  let clip = draw.viewProjection * world;
  // WebGL clip depth [-w, w] onto WebGPU's [0, w]; see wgpu-unlit.ts.
  return vec4<f32>(clip.x, clip.y, (clip.z + clip.w) * 0.5, clip.w);
}

@fragment
fn ${FRAGMENT_ENTRY_POINT}() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
`;

/**
 * Packs one view's shadow tail — the 80 bytes after the landed block — into
 * `staging` at `floatBase`, `writeLightUniforms`' contract continued: every
 * float is written on every shaded view, **zeros when no light casts**, so
 * the uploaded stride is a function of this frame's `SceneLights` alone and a
 * frame that stops casting cannot leak the previous frame's matrix into its
 * transcript (§33). Zeros are also what a fresh staging array holds, which is
 * what keeps every landed shadowless upload byte-identical.
 *
 * When a light casts, the values are `ShadowUniforms.uploadView`'s, member
 * for member; the tap offset divides here once per view — `mapSize` is a
 * positive integer whenever `hasShadow` is true (`lights.ts` refuses
 * anything else), so the division cannot be by zero on the path that
 * reaches it.
 */
export function writeShadowUniforms(
  staging: Float32Array,
  floatBase: number,
  lights: SceneLights,
): void {
  const matrix = floatBase + SHADOW_MATRIX_OFFSET / 4;
  const params = floatBase + SHADOW_PARAMS_OFFSET / 4;
  const tail = floatBase + SHADOW_CASCADE_MATRIX_OFFSET / 4;
  const tailFloats =
    (SHADOW_LIGHT_UNIFORM_BYTES - SHADOW_CASCADE_MATRIX_OFFSET) / 4;
  if (!lights.hasShadow) {
    for (let index = 0; index < 20; index += 1) {
      staging[matrix + index] = 0;
    }
    staging.fill(0, tail, tail + tailFloats);
    return;
  }
  for (let index = 0; index < 16; index += 1) {
    staging[matrix + index] = lights.shadowMatrix.elements[index];
  }
  staging[params] = lights.shadowBias;
  staging[params + 1] = lights.shadowNormalBias;
  staging[params + 2] = 1 / lights.shadowMapSize;
  staging[params + 3] = 0;
  writeShadowAtlasTail(staging, floatBase, lights);
}

/**
 * The W6.3 atlas tail of one view's block (`SHADOW_CASCADE_MATRIX_OFFSET …
 * SHADOW_LIGHT_UNIFORM_BYTES`) — the member-for-member image of the GL
 * backend's `ShadowUniforms.uploadView` extension. A frame that is not
 * {@link SceneLights.shadowExtended} writes zeros, so `info.y == 0` selects
 * the landed single-map arithmetic in the shader and the tail is a function of
 * this frame's `SceneLights` alone.
 */
function writeShadowAtlasTail(
  staging: Float32Array,
  floatBase: number,
  lights: SceneLights,
): void {
  const cascades = floatBase + SHADOW_CASCADE_MATRIX_OFFSET / 4;
  const tailFloats =
    (SHADOW_LIGHT_UNIFORM_BYTES - SHADOW_CASCADE_MATRIX_OFFSET) / 4;
  if (!lights.shadowExtended) {
    staging.fill(0, cascades, cascades + tailFloats);
    return;
  }
  staging.set(lights.shadowCascadeMatrices, cascades);
  staging.set(
    lights.shadowSpotMatrices,
    floatBase + SHADOW_SPOT_MATRIX_OFFSET / 4,
  );
  staging.set(
    lights.shadowCascadeSplits,
    floatBase + SHADOW_CASCADE_SPLITS_OFFSET / 4,
  );
  staging.set(lights.shadowViewDepth, floatBase + SHADOW_VIEW_DEPTH_OFFSET / 4);
  const atlas = floatBase + SHADOW_ATLAS_OFFSET / 4;
  staging[atlas] = lights.shadowAtlasColumns;
  staging[atlas + 1] = lights.shadowAtlasRows;
  staging[atlas + 2] = 1 / lights.shadowAtlasWidth;
  staging[atlas + 3] = 1 / lights.shadowAtlasHeight;
  const info = floatBase + SHADOW_INFO_OFFSET / 4;
  staging[info] = lights.shadowCascadeCount;
  staging[info + 1] = 1;
  staging[info + 2] = lights.shadowPunctualCount;
  staging[info + 3] = 0;
  staging.set(
    lights.shadowPunctualSlot,
    floatBase + SHADOW_PUNCTUAL_SLOT_OFFSET / 4,
  );
  staging.set(
    lights.shadowPunctualParams,
    floatBase + SHADOW_PUNCTUAL_PARAMS_OFFSET / 4,
  );
  staging.set(
    lights.shadowPunctualRange,
    floatBase + SHADOW_PUNCTUAL_RANGE_OFFSET / 4,
  );
}

/**
 * The stride bytes still spare after the widening — the "rides the spare
 * bytes" argument above, as a number a test can pin: if a later member ever
 * drives this negative, the widened block no longer fits the landed
 * `LIGHT_UNIFORM_STRIDE_BYTES` and the argument (not just a bind-time
 * validation error) is what fails.
 */
export const SHADOW_UNIFORM_SPARE_BYTES =
  LIGHT_UNIFORM_STRIDE_BYTES - SHADOW_LIGHT_UNIFORM_BYTES;
