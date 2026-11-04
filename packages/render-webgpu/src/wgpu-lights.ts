/**
 * The frame's lighting as **one uniform buffer** (§68, WP-R1.5), plus the
 * shared WGSL both shaded families splice in.
 *
 * This is the WebGPU port of the GL backend's light-set uploads — the five
 * `uniform3fv`/`uniform4fv` calls `PunctualLightUniforms` issues, the ambient
 * and directional uploads beside them, and `StandardProgram`'s eye position —
 * folded into a single block, written once per view and bound at
 * {@link LIGHTS_BIND_GROUP_INDEX} with a dynamic offset per view. That is the
 * "strictly simpler" the R-1 plan promised (§3.2): where GL uploads per
 * program per view, this backend packs one block per view into one buffer and
 * issues one `writeBuffer` for the whole frame.
 *
 * ## W5.1 (2026-11-04): extra directionals widen the arrays
 *
 * The four punctual arrays hold `MAX_LIGHT_SLOTS` (11) entries instead of 8:
 * slots after the live punctual lights carry directionals 2…4
 * (`punctualParams.w == 2`). Every offset below that follows the arrays is
 * derived from the slot count, so the numbers in the table are the
 * pre-W5.1 values (8 slots); the stride grows 768 → 1024 (the next 256-byte
 * dynamic-offset multiple). A scene with no extras writes zeros in the new
 * slots and the same floats in every landed position.
 *
 * ## The layout, declared as data (§7 of the R-1 plan)
 *
 * Every slot is a **`vec4`**, deliberately: WGSL's `vec3<f32>` is 16-byte
 * aligned, so a `vec3` member or a tightly packed `array<vec3>` would leave
 * implicit padding the CPU packer has to know about anyway — a naive struct
 * silently misreads. All-`vec4` makes the byte layout below *total*: every
 * float of the block is named, none is implied.
 *
 * ```text
 * offset  member              contents
 *      0  ambientColor        rgb = SceneLights.ambientColor;      w = 0
 *     16  lightDirection      xyz = SceneLights.direction;         w = 0
 *     32  lightColor          rgb = SceneLights.directionalColor;  w = 0
 *     48  cameraPosition      xyz = the view's eye (§59);          w = 0
 *     64  counts              x = f32(punctualCount);        y, z, w = 0
 *     80  punctualPosition[8] xyz per light;                       w = 0
 *    208  punctualColor[8]    rgb premultiplied by intensity;      w = 0
 *    336  punctualDirection[8] xyz cone axis (§68);                w = 0
 *    464  punctualParams[8]   x range, y cos outer, z cone scale, w spot flag
 *    592  = LIGHT_UNIFORM_BYTES
 * ```
 *
 * Hemisphere rides the remaining spare stride after §69's shadow tail
 * (864…912 of 1024 at 11 slots). The first {@link LIGHT_UNIFORM_BYTES} bytes stay this
 * layout exactly — a no-hemisphere pack writes zeros in the new slots, so
 * every landed float in 0…784 is byte-identical. The unshadowed bind group
 * widens to {@link LIGHT_BINDING_BYTES} so the fragment can read the tail;
 * the shadowed twin does the same by growing
 * `SHADOW_LIGHT_UNIFORM_BYTES`.
 *
 * `counts.x` is an **`f32`, not a `u32`** — the block is packed through one
 * `Float32Array`, and a `u32` word inside it would need a second typed-array
 * view over the same bytes for one integer. `f32` is exact for every value the
 * count can take (0…`MAX_PUNCTUAL_LIGHTS`), and the shader reads it back
 * with `i32(lights.counts.x)`, which is exact over the same range.
 *
 * The four punctual arrays carry `SceneLights`' packed arrays **re-strided**
 * from three floats per light to four; `punctualParams` is `vec4` on both
 * sides and copies straight through. The scalar meanings are `lights.ts`'s,
 * verbatim — this module re-encodes, it never re-derives.
 *
 * ## One block for both families
 *
 * `cameraPosition` is only read by the standard family's specular lobe, and it
 * rides in the shared block anyway: it is per-view state exactly as the light
 * set is, and a second layout for one `vec4` would double the bind-group
 * plumbing to save 16 strided bytes that are already allocated. The lit WGSL
 * simply never reads the member — the same deal `DrawUniforms.color` has with
 * the clear pipeline's vertex stage.
 *
 * ## Where the groups sit
 *
 * `wgpu-bindings.ts` promised that a per-view group would arrive **as
 * group 1** without moving group 0 — this is that group. The unlit family's
 * `map` already owns group 1, so for the two shaded families the *same*
 * texture layout object binds at {@link SHADED_MAP_BIND_GROUP_INDEX} — a bind
 * group carries no index of its own (the pipeline layout assigns it), so the
 * texture cache's records serve both families unchanged.
 *
 * §59's packed metallic-roughness map reuses that same texture layout
 * object. WebGPU allows four bind groups, so the MR sample sits at
 * {@link SHADED_MR_BIND_GROUP_INDEX} **when albedo already occupies group 2**,
 * and at {@link SHADED_MAP_BIND_GROUP_INDEX} when there is no albedo (the
 * pipeline layout is then `[uniforms, lights, texture]` and group 3 would
 * be an empty slot the API does not permit). {@link shadedMrBindingWgsl}
 * takes the index so the two WGSL strings share one helper. The sampler
 * names (`mrTexture` / `mrSampler`) are distinct from the albedo pair so
 * both can coexist in the map+mr module.
 *
 * ## The shadow half rides the spare stride bytes (WP-R1.7)
 *
 * §69's comparison sampler is a structurally different binding, and it lives
 * in `wgpu-shadow.ts`: a **widened twin** of this block
 * (`SHADOW_LIGHT_UNIFORM_WGSL`) appends the shadow matrix and parameters in
 * the stride bytes this layout already leaves spare (784…864 of 1024), and two
 * more bindings — `texture_depth_2d` and `sampler_comparison` — join it in a
 * second group-1 layout. This layout, this struct, and
 * {@link LIGHT_UNIFORM_BYTES} are untouched, which is what keeps every landed
 * shaded transcript byte-identical: a draw that receives no shadow still binds
 * exactly this block. The member list is shared as
 * {@link LIGHT_UNIFORM_MEMBERS_WGSL} so the two structs cannot drift.
 */

import { MAX_LIGHT_SLOTS, type SceneLights } from "@fourjs/render";

import {
  GPU_SHADER_STAGE,
  type GpuBindGroupLayout,
  type GpuDevice,
} from "./webgpu-device.js";
import { MAP_SAMPLER_BINDING, MAP_TEXTURE_BINDING } from "./wgpu-bindings.js";

/**
 * The bind-group index the shaded families read the light block at — the
 * per-view group 1 `wgpu-bindings.ts` reserved. The unlit family's group 1
 * (`map`) is untouched: the two families never share a pipeline layout.
 */
export const LIGHTS_BIND_GROUP_INDEX = 1;

/**
 * The bind-group index §57's `map` occupies **on the shaded families**:
 * group 2, because their group 1 is the light block. The *layout object* and
 * the per-texture bind groups are `createTextureBindGroupLayout`'s, unchanged
 * — a bind group binds at whatever index the pipeline layout put its layout,
 * so one texture cache serves all three sampling families.
 */
export const SHADED_MAP_BIND_GROUP_INDEX = 2;

/**
 * The bind-group index §59's packed metallic-roughness map occupies **when
 * the albedo `map` is also bound**: group 3, the last WebGPU slot. An
 * mr-only draw binds the same layout object at
 * {@link SHADED_MAP_BIND_GROUP_INDEX} instead — see the module header.
 * Distinct from WebGL's `METAL_ROUGHNESS_TEXTURE_UNIT` (a texture *unit*,
 * not a bind-group index).
 */
export const SHADED_MR_BIND_GROUP_INDEX = 3;

/** Byte offset of `LightUniforms.ambientColor` (rgb; w unused, written 0). */
export const LIGHT_AMBIENT_OFFSET = 0;

/** Byte offset of `LightUniforms.lightDirection` (xyz; w unused, written 0). */
export const LIGHT_DIRECTION_OFFSET = 16;

/** Byte offset of `LightUniforms.lightColor` (rgb premultiplied; w written 0). */
export const LIGHT_COLOR_OFFSET = 32;

/** Byte offset of `LightUniforms.cameraPosition` (xyz; w unused, written 0). */
export const LIGHT_CAMERA_OFFSET = 48;

/** Byte offset of `LightUniforms.counts` (x = f32 punctual count; yzw 0). */
export const LIGHT_COUNTS_OFFSET = 64;

/** Byte offset of the `punctualPosition` array (xyz per light; w 0). */
export const LIGHT_PUNCTUAL_POSITION_OFFSET = 80;

/** Byte offset of the `punctualColor` array (rgb × intensity per light; w 0). */
export const LIGHT_PUNCTUAL_COLOR_OFFSET =
  LIGHT_PUNCTUAL_POSITION_OFFSET + MAX_LIGHT_SLOTS * 16;

/** Byte offset of the `punctualDirection` array (cone axis per light; w 0). */
export const LIGHT_PUNCTUAL_DIRECTION_OFFSET =
  LIGHT_PUNCTUAL_COLOR_OFFSET + MAX_LIGHT_SLOTS * 16;

/** Byte offset of the `punctualParams` array — `SceneLights.punctualParams`'s vec4s. */
export const LIGHT_PUNCTUAL_PARAMS_OFFSET =
  LIGHT_PUNCTUAL_DIRECTION_OFFSET + MAX_LIGHT_SLOTS * 16;

/**
 * Size of the original light-data prefix, before shadow and hemisphere tails.
 * Kept stable as the shadow-matrix offset. Use {@link LIGHT_BINDING_BYTES}
 * for the current unshadowed shader binding, not this prefix size.
 */
export const LIGHT_UNIFORM_BYTES =
  LIGHT_PUNCTUAL_PARAMS_OFFSET + MAX_LIGHT_SLOTS * 16;

/** {@link LIGHT_UNIFORM_BYTES} in `Float32Array` elements. */
export const LIGHT_UNIFORM_FLOATS = LIGHT_UNIFORM_BYTES / 4;

/**
 * Byte offset of the hemisphere sky colour (rgb × intensity; w 0) — the
 * first spare stride byte after §69's shadow tail (784…864).
 */
export const HEMISPHERE_SKY_OFFSET = LIGHT_UNIFORM_BYTES + 80;

/** Byte offset of the hemisphere ground colour (rgb × intensity; w 0). */
export const HEMISPHERE_GROUND_OFFSET = HEMISPHERE_SKY_OFFSET + 16;

/** Byte offset of the hemisphere sky axis (xyz unit; w 0). */
export const HEMISPHERE_UP_OFFSET = HEMISPHERE_GROUND_OFFSET + 16;

/**
 * Size of the unshadowed light binding once the hemisphere tail is
 * included — 912 bytes, still inside the 1024-byte stride. The
 * core {@link LIGHT_UNIFORM_BYTES} is untouched; this is what
 * `createLightsBindGroupLayout` and the renderer bind as `minBindingSize`
 * / `size` so the fragment may read the tail.
 */
export const LIGHT_BINDING_BYTES = HEMISPHERE_UP_OFFSET + 16;

/**
 * Distance between two views' blocks in the lights buffer: the block size
 * rounded up to the 256-byte dynamic-offset alignment (`UNIFORM_STRIDE_BYTES`'
 * reasoning — 256 is every conforming device's valid alignment, and a fixed
 * stride keeps the frame's byte layout device-independent, §33).
 */
export const LIGHT_UNIFORM_STRIDE_BYTES = 1024;

/** {@link LIGHT_UNIFORM_STRIDE_BYTES} in `Float32Array` elements. */
export const LIGHT_UNIFORM_STRIDE_FLOATS = LIGHT_UNIFORM_STRIDE_BYTES / 4;

/**
 * The light block's bind-group layout: binding 0, a dynamically-offset uniform
 * buffer of {@link LIGHT_BINDING_BYTES}, **fragment-only** — no vertex stage
 * in this package reads a light, and declaring vertex visibility would reserve
 * a vertex-stage buffer slot nothing uses (`createTextureBindGroupLayout`'s
 * argument, applied to a buffer).
 *
 * Created lazily by the renderer's first lit frame — the WP-R1.2 group-1
 * precedent, third application — so an application that never shades records
 * the identical initialization transcript, byte for byte.
 */
export function createLightsBindGroupLayout(
  device: GpuDevice,
): GpuBindGroupLayout {
  return device.createBindGroupLayout({
    label: "fourJS:lights",
    entries: [
      {
        binding: 0,
        visibility: GPU_SHADER_STAGE.FRAGMENT,
        buffer: {
          type: "uniform",
          hasDynamicOffset: true,
          minBindingSize: LIGHT_BINDING_BYTES,
        },
      },
    ],
  });
}

/**
 * The member list of the block above, without the struct wrapper — shared
 * with `wgpu-shadow.ts`'s widened `ShadowLightUniforms` (WP-R1.7), whose
 * first {@link LIGHT_UNIFORM_BYTES} bytes must be this layout exactly: one
 * string, two structs, so the shadowed and unshadowed variants cannot
 * disagree about where a light lives.
 */
export const LIGHT_UNIFORM_MEMBERS_WGSL = `  ambientColor : vec4<f32>,
  lightDirection : vec4<f32>,
  lightColor : vec4<f32>,
  cameraPosition : vec4<f32>,
  counts : vec4<f32>,
  punctualPosition : array<vec4<f32>, ${String(MAX_LIGHT_SLOTS)}>,
  punctualColor : array<vec4<f32>, ${String(MAX_LIGHT_SLOTS)}>,
  punctualDirection : array<vec4<f32>, ${String(MAX_LIGHT_SLOTS)}>,
  punctualParams : array<vec4<f32>, ${String(MAX_LIGHT_SLOTS)}>,`;

/**
 * The three hemisphere members, at {@link HEMISPHERE_SKY_OFFSET}. Shared
 * with `wgpu-shadow.ts` so the shadowed and unshadowed structs cannot
 * disagree about where sky, ground, and up live.
 */
export const HEMISPHERE_UNIFORM_MEMBERS_WGSL = `  hemisphereSky : vec4<f32>,
  hemisphereGround : vec4<f32>,
  hemisphereUp : vec4<f32>,`;

/**
 * The WGSL declaration of the block above — `DRAW_UNIFORM_WGSL`'s discipline:
 * the layout the pipeline declares and the layout the shader reads live side
 * by side in one module, so they cannot drift.
 *
 * Five `vec4` pads sit in the 784…864 gap §69's shadow tail occupies on
 * the shadowed twin, so `hemisphereSky` lands at byte 864 in both structs.
 */
export const LIGHT_UNIFORM_WGSL = `struct LightUniforms {
${LIGHT_UNIFORM_MEMBERS_WGSL}
  hemiPad : array<vec4<f32>, 5>,
${HEMISPHERE_UNIFORM_MEMBERS_WGSL}
};

@group(${String(LIGHTS_BIND_GROUP_INDEX)}) @binding(0) var<uniform> lights : LightUniforms;`;

/**
 * The hemisphere mix both shaded fragment stages share — the WGSL port of
 * `gl-program.ts`'s `HEMISPHERE_LIGHT_GLSL`. Branch-free: a frame with no
 * hemisphere writes zeros for sky and ground, so the mix is the zero
 * vector regardless of `n`. A zero-length normal uses the 0.5 mix
 * (constant extra ambient), matching the GL chunk.
 */
export const HEMISPHERE_IRRADIANCE_WGSL = `fn hemisphereIrradiance(n : vec3<f32>) -> vec3<f32> {
  let w = clamp(0.5 * dot(n, lights.hemisphereUp.xyz) + 0.5, 0.0, 1.0);
  return mix(lights.hemisphereGround.xyz, lights.hemisphereSky.xyz, w);
}

fn hemisphereAmbient(normalLength : f32, n : vec3<f32>) -> vec3<f32> {
  if (normalLength > 0.0) {
    return hemisphereIrradiance(n);
  }
  return mix(lights.hemisphereGround.xyz, lights.hemisphereSky.xyz, 0.5);
}`;

/**
 * The **light model** both shaded fragment stages share — the WGSL port of
 * `gl-program.ts`'s `PUNCTUAL_LIGHT_GLSL`, one string spliced into both
 * families for the recorded reason: the falloff and the cone are one model,
 * and a scene mixing a `LitMaterial` with a `StandardMaterial` under the same
 * lamp must not be able to disagree about it.
 *
 * The arithmetic is the GLSL chunk's, line for line — inverse-square with the
 * `max(d², 1e-8)` guard where the division happens, `KHR_lights_punctual`'s
 * range window and cone ramp, the precomputed `params.z` reciprocal — with
 * one syntactic difference: WGSL has no `out` parameters, so the direction
 * travels back in a two-member struct instead of an `out vec3 l`.
 *
 * No `1/π` appears here or in either lobe that consumes this — the engine's
 * light colour × intensity is an irradiance already divided by π (R-13), which
 * is what lets a point light and the directional light add up to one lighting
 * model across both backends.
 */
export const PUNCTUAL_LIGHT_WGSL = `struct PunctualLight {
  irradiance : vec3<f32>,
  direction : vec3<f32>,
};

fn punctualLight(index : i32, p : vec3<f32>) -> PunctualLight {
  if (lights.punctualParams[index].w > 1.5) {
    var extra : PunctualLight;
    extra.irradiance = lights.punctualColor[index].xyz;
    extra.direction = -lights.punctualDirection[index].xyz;
    return extra;
  }
  let offset = lights.punctualPosition[index].xyz - p;
  let distanceSquared = max(dot(offset, offset), 1e-8);
  let d = sqrt(distanceSquared);
  let l = offset / d;
  let params = lights.punctualParams[index];
  var attenuation = 1.0 / distanceSquared;
  if (params.x > 0.0) {
    let ratio = d / params.x;
    let squared = ratio * ratio;
    attenuation = attenuation * clamp(1.0 - squared * squared, 0.0, 1.0);
  }
  if (params.w > 0.0) {
    let cosTheta = dot(lights.punctualDirection[index].xyz, -l);
    attenuation = attenuation * clamp((cosTheta - params.y) * params.z, 0.0, 1.0);
  }
  var result : PunctualLight;
  result.irradiance = lights.punctualColor[index].xyz * attenuation;
  result.direction = l;
  return result;
}`;

/**
 * The `map` declaration of the **shaded** families — `MAP_BINDING_WGSL` with
 * the group renumbered to {@link SHADED_MAP_BIND_GROUP_INDEX}, because their
 * group 1 is the light block. Same two bindings, same layout object, same
 * texture-cache records.
 */
export const SHADED_MAP_BINDING_WGSL = `@group(${String(SHADED_MAP_BIND_GROUP_INDEX)}) @binding(${String(MAP_TEXTURE_BINDING)}) var mapTexture : texture_2d<f32>;
@group(${String(SHADED_MAP_BIND_GROUP_INDEX)}) @binding(${String(MAP_SAMPLER_BINDING)}) var mapSampler : sampler;`;

/**
 * The packed metallic-roughness declaration for one bind-group index —
 * the albedo pair's two bindings and the same `createTextureBindGroupLayout`
 * object, renamed so the map+mr module can splice both.
 *
 * Pass {@link SHADED_MR_BIND_GROUP_INDEX} when albedo occupies group 2;
 * pass {@link SHADED_MAP_BIND_GROUP_INDEX} for an mr-only pipeline.
 */
export function shadedMrBindingWgsl(groupIndex: number): string {
  return `@group(${String(groupIndex)}) @binding(${String(MAP_TEXTURE_BINDING)}) var mrTexture : texture_2d<f32>;
@group(${String(groupIndex)}) @binding(${String(MAP_SAMPLER_BINDING)}) var mrSampler : sampler;`;
}

/**
 * The map+mr form — MR at {@link SHADED_MR_BIND_GROUP_INDEX}. Mr-only
 * modules call {@link shadedMrBindingWgsl} with group 2 instead.
 */
export const SHADED_MR_BINDING_WGSL = shadedMrBindingWgsl(
  SHADED_MR_BIND_GROUP_INDEX,
);

/**
 * Packs one view's `LightUniforms` block into `staging` at `floatBase`.
 *
 * Every float of the block is written — the unused `w` slots and the dead tail
 * of the arrays included — so the uploaded bytes are a function of this
 * frame's `SceneLights` alone, never of what a previous frame or view left in
 * the reused staging array (`clearSceneLights`' transcript-determinism
 * argument, restated one buffer later).
 *
 * The three `vec3`-meaning arrays are re-strided from `SceneLights`' packed
 * three-floats-per-light to the block's `vec4` slots; `punctualParams` copies
 * straight through. `SceneLights` zeroes its own dead tails per collection, so
 * the re-stride can copy all `MAX_PUNCTUAL_LIGHTS` entries without
 * consulting the count.
 *
 * The eye is three scalars rather than a `Vector3` for `setCameraPosition`'s
 * recorded reason: the renderer reads them straight out of the camera's world
 * matrix translation column and has nothing to allocate on the way.
 *
 * Branch-free on purpose: point-versus-spot is already resolved in the packed
 * `SceneLights` arrays (`writePunctualLight`), and a packer that re-decided it
 * would be a second place for the light model to drift.
 */
export function writeLightUniforms(
  staging: Float32Array,
  floatBase: number,
  lights: SceneLights,
  cameraX: number,
  cameraY: number,
  cameraZ: number,
): void {
  const ambient = floatBase + LIGHT_AMBIENT_OFFSET / 4;
  staging[ambient] = lights.ambientColor[0];
  staging[ambient + 1] = lights.ambientColor[1];
  staging[ambient + 2] = lights.ambientColor[2];
  staging[ambient + 3] = 0;

  const direction = floatBase + LIGHT_DIRECTION_OFFSET / 4;
  staging[direction] = lights.direction.x;
  staging[direction + 1] = lights.direction.y;
  staging[direction + 2] = lights.direction.z;
  staging[direction + 3] = 0;

  const color = floatBase + LIGHT_COLOR_OFFSET / 4;
  staging[color] = lights.directionalColor[0];
  staging[color + 1] = lights.directionalColor[1];
  staging[color + 2] = lights.directionalColor[2];
  staging[color + 3] = 0;

  const camera = floatBase + LIGHT_CAMERA_OFFSET / 4;
  staging[camera] = cameraX;
  staging[camera + 1] = cameraY;
  staging[camera + 2] = cameraZ;
  staging[camera + 3] = 0;

  const counts = floatBase + LIGHT_COUNTS_OFFSET / 4;
  staging[counts] = lights.punctualCount;
  staging[counts + 1] = 0;
  staging[counts + 2] = 0;
  staging[counts + 3] = 0;

  const positions = floatBase + LIGHT_PUNCTUAL_POSITION_OFFSET / 4;
  const colors = floatBase + LIGHT_PUNCTUAL_COLOR_OFFSET / 4;
  const directions = floatBase + LIGHT_PUNCTUAL_DIRECTION_OFFSET / 4;
  for (let index = 0; index < MAX_LIGHT_SLOTS; index += 1) {
    const packed = index * 3;
    const slot = index * 4;
    staging[positions + slot] = lights.punctualPositions[packed];
    staging[positions + slot + 1] = lights.punctualPositions[packed + 1];
    staging[positions + slot + 2] = lights.punctualPositions[packed + 2];
    staging[positions + slot + 3] = 0;
    staging[colors + slot] = lights.punctualColors[packed];
    staging[colors + slot + 1] = lights.punctualColors[packed + 1];
    staging[colors + slot + 2] = lights.punctualColors[packed + 2];
    staging[colors + slot + 3] = 0;
    staging[directions + slot] = lights.punctualDirections[packed];
    staging[directions + slot + 1] = lights.punctualDirections[packed + 1];
    staging[directions + slot + 2] = lights.punctualDirections[packed + 2];
    staging[directions + slot + 3] = 0;
  }

  const params = floatBase + LIGHT_PUNCTUAL_PARAMS_OFFSET / 4;
  for (let index = 0; index < MAX_LIGHT_SLOTS * 4; index += 1) {
    staging[params + index] = lights.punctualParams[index];
  }

  const sky = floatBase + HEMISPHERE_SKY_OFFSET / 4;
  staging[sky] = lights.hemisphereSky[0];
  staging[sky + 1] = lights.hemisphereSky[1];
  staging[sky + 2] = lights.hemisphereSky[2];
  staging[sky + 3] = 0;
  const ground = floatBase + HEMISPHERE_GROUND_OFFSET / 4;
  staging[ground] = lights.hemisphereGround[0];
  staging[ground + 1] = lights.hemisphereGround[1];
  staging[ground + 2] = lights.hemisphereGround[2];
  staging[ground + 3] = 0;
  const up = floatBase + HEMISPHERE_UP_OFFSET / 4;
  staging[up] = lights.hemisphereUp.x;
  staging[up + 1] = lights.hemisphereUp.y;
  staging[up + 2] = lights.hemisphereUp.z;
  staging[up + 3] = 0;
}
