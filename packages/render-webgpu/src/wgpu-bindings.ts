/**
 * This backend's binding layout, **declared as data** (§7 of the R-1 plan).
 *
 * A WGSL shader can declare its own bindings inline and let
 * `layout: "auto"` infer a pipeline layout from them. This backend refuses that
 * shortcut, and the refusal is a recorded debt to RFC 0001 rather than a style
 * preference: the RFC's future WGSL *emitter* will be a second producer of
 * shaders for this same backend, and two producers can only share a pipeline
 * layout if the layout exists somewhere other than inside a shader string. So
 * the layout is a TypeScript table here, every WGSL source in this package is
 * generated against it (`wgpu-unlit.ts`), and `layout: "auto"` appears nowhere.
 * It costs nothing today and saves the emitter from inventing a second
 * convention (decision, WP-R1.1).
 *
 * ## One uniform block per draw, one bind group per frame
 *
 * Every pipeline in this tier reads exactly one uniform buffer, at group 0,
 * binding 0, with a **dynamic offset**:
 *
 * ```wgsl
 * struct DrawUniforms {
 *   viewProjection : mat4x4<f32>,   //   0 .. 64
 *   model          : mat4x4<f32>,   //  64 .. 128
 *   color          : vec4<f32>,     // 128 .. 144
 *   normalMatrix   : mat3x3<f32>,   // 144 .. 192  (3 columns × vec4 stride)
 * };
 * @group(0) @binding(0) var<uniform> draw : DrawUniforms;
 * ```
 *
 * The frame packs one such block per draw into a single growable CPU staging
 * array, uploads it with one `queue.writeBuffer`, creates **one** bind group,
 * and moves between draws with a dynamic offset. The alternatives were a bind
 * group per draw (an allocation per draw, per frame) or a uniform buffer per
 * draw (an allocation per object); this shape allocates once per *frame size*
 * and never inside a steady-state frame, which is the same rule §64's pooled
 * render items follow.
 *
 * The view-projection is duplicated into every draw's block rather than living
 * in a second, per-view bind group. That is 64 bytes per draw against a second
 * bind group, a second layout and a second binding index in every shader —
 * and the blocks are 256-byte-strided anyway (see `UNIFORM_STRIDE_BYTES`), so
 * the duplication is free in allocated bytes. When a per-view group earns its
 * keep — the lit pipeline's light block is the first candidate (WP-R1.5) — it
 * arrives as group 1, and this group's layout does not move.
 */

import {
  GPU_SHADER_STAGE,
  type GpuBindGroupLayout,
  type GpuDevice,
} from "./webgpu-device.js";

/** Byte offset of `DrawUniforms.viewProjection`. */
export const DRAW_VIEW_PROJECTION_OFFSET = 0;

/** Byte offset of `DrawUniforms.model`. */
export const DRAW_MODEL_OFFSET = 64;

/** Byte offset of `DrawUniforms.color`. */
export const DRAW_COLOR_OFFSET = 128;

/**
 * Byte offset of `DrawUniforms.normalMatrix` — a WGSL `mat3x3<f32>` in a
 * uniform block is three columns padded to `vec4` (48 bytes), so this slot
 * occupies 144 .. 192.
 */
export const DRAW_NORMAL_OFFSET = 144;

/**
 * Size of the `DrawUniforms` block in bytes — the layout above, ending on its
 * last member.
 *
 * Not the 256-byte *stride*: this is the size a binding declares
 * (`minBindingSize`) and the size a bind group binds, while the stride is how
 * far apart two blocks sit in the buffer. Conflating them would bind 64 bytes
 * of the next draw's block into this draw's shader.
 */
export const DRAW_UNIFORM_BYTES = 192;

/** `DRAW_UNIFORM_BYTES` in `Float32Array` elements — the packing loop's unit. */
export const DRAW_UNIFORM_FLOATS = DRAW_UNIFORM_BYTES / 4;

/**
 * The one bind-group layout this tier declares: group 0, binding 0, a
 * dynamically-offset uniform buffer visible to both stages.
 *
 * Both stages, not one each: the vertex stage reads `viewProjection`,
 * `model` and `normalMatrix`, the fragment stage reads `color`, and they are
 * one block because splitting them would double the bind-group traffic to
 * save nothing — a uniform block is uploaded whole either way.
 *
 * `minBindingSize` is set, so a mis-sized bind group is a validation error at
 * creation rather than a shader reading past its block at draw time.
 */
export function createDrawBindGroupLayout(
  device: GpuDevice,
): GpuBindGroupLayout {
  return device.createBindGroupLayout({
    label: "fourJS:draw-uniforms",
    entries: [
      {
        binding: 0,
        visibility: GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT,
        buffer: {
          type: "uniform",
          hasDynamicOffset: true,
          minBindingSize: DRAW_UNIFORM_BYTES,
        },
      },
    ],
  });
}

/**
 * The WGSL declaration of the block above, spliced into every shader in this
 * package.
 *
 * One string, exported, so that "the layout the pipeline declares" and "the
 * layout the shader reads" cannot drift: they are the same two definitions,
 * side by side in this module, and a change to either is a change to a file
 * whose whole subject is the pair.
 */
export const DRAW_UNIFORM_WGSL = `struct DrawUniforms {
  viewProjection : mat4x4<f32>,
  model : mat4x4<f32>,
  color : vec4<f32>,
  normalMatrix : mat3x3<f32>,
};

@group(0) @binding(0) var<uniform> draw : DrawUniforms;`;

/**
 * The bind-group index §77's texture and sampler occupy: **group 1**, exactly
 * where the header above said a second group would arrive.
 *
 * Group 0 does not move, and that is the point of having declared it as data:
 * a pipeline that samples nothing keeps the one-group layout it had, and the
 * WGSL of the untextured variants is byte-identical to what WP-R1.1 emitted.
 */
export const MAP_BIND_GROUP_INDEX = 1;

/** `@binding(0)` of {@link MAP_BIND_GROUP_INDEX} — the sampled texture. */
export const MAP_TEXTURE_BINDING = 0;

/** `@binding(1)` of {@link MAP_BIND_GROUP_INDEX} — the sampler that reads it. */
export const MAP_SAMPLER_BINDING = 1;

/**
 * The texture/sampler bind-group layout (§77, WP-R1.2).
 *
 * ## Why the two bindings are one group, and why the group is a *second* one
 *
 * They are one group because they are one decision — "sample this image this
 * way" — and because a bind group is the unit of binding: splitting them would
 * double the per-draw `setBindGroup` traffic for a pair that never varies
 * independently.
 *
 * They are a second group rather than two more bindings on group 0 because
 * group 0 is **per draw** and rebound at a dynamic offset for every object in
 * the frame, while this one is **per texture** and shared by every draw that
 * samples the same image. Merging them would mean one bind group per (draw ×
 * texture) instead of one per texture, allocated inside the frame — the cost
 * the dynamic-offset design exists to avoid.
 *
 * ## Fragment-only visibility
 *
 * Both entries are `FRAGMENT` alone. The vertex stage carries the uv through
 * as a varying and never samples, so declaring vertex visibility would ask the
 * implementation to reserve a vertex-stage texture slot for a resource no
 * vertex shader in this package reads (§62's per-stage binding limits are
 * where that shows up).
 *
 * `sampleType: "float"` and `type: "filtering"` are the pair that makes
 * `textureSample` legal: an `unfilterable-float` texture may only be sampled
 * with a `non-filtering` sampler, which is the trap a depth or float target
 * walks into (R-18's shadow map, WP-R1.6's targets) — those tiers declare
 * their own layout rather than widen this one.
 *
 * The same layout object is reused as the mip-generation blit's group 0
 * (`wgpu-texture.ts`): a blit binds exactly a texture and a sampler, so
 * declaring a second identical layout would be two objects for one shape.
 */
export function createTextureBindGroupLayout(
  device: GpuDevice,
): GpuBindGroupLayout {
  return device.createBindGroupLayout({
    label: "fourJS:map",
    entries: [
      {
        binding: MAP_TEXTURE_BINDING,
        visibility: GPU_SHADER_STAGE.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
      {
        binding: MAP_SAMPLER_BINDING,
        visibility: GPU_SHADER_STAGE.FRAGMENT,
        sampler: { type: "filtering" },
      },
    ],
  });
}

/**
 * The WGSL declaration of {@link createTextureBindGroupLayout}'s group, spliced
 * into every shader in this package that samples a texture.
 *
 * Here for {@link DRAW_UNIFORM_WGSL}'s reason: the layout the pipeline declares
 * and the layout the shader reads are two definitions in one module, so they
 * cannot drift.
 */
export const MAP_BINDING_WGSL = `@group(${String(MAP_BIND_GROUP_INDEX)}) @binding(${String(MAP_TEXTURE_BINDING)}) var mapTexture : texture_2d<f32>;
@group(${String(MAP_BIND_GROUP_INDEX)}) @binding(${String(MAP_SAMPLER_BINDING)}) var mapSampler : sampler;`;

/** Surface group (WP-W4.2) binding 0 — packed metallic-roughness texture. */
export const SURFACE_MR_BINDING = 0;
/** Surface group binding 1 — the one sampler shared by every surface texture. */
export const SURFACE_SAMPLER_BINDING = 1;
/** Surface group binding 2 — tangent-space normal map. */
export const SURFACE_NORMAL_BINDING = 2;
/** Surface group binding 3 — ambient-occlusion map (red channel). */
export const SURFACE_OCCLUSION_BINDING = 3;
/** Surface group binding 4 — emissive map (rgb). */
export const SURFACE_EMISSIVE_BINDING = 4;

/**
 * The standard family's surface bind-group layout: the metallic-roughness
 * pair widened by the three detail textures, so all four fit the last
 * available group (groups 0/1 are uniforms and lights, 2 is albedo). Fragment
 * only, `float`/`filtering`, one shared sampler — the same policy as
 * {@link createTextureBindGroupLayout}. A variant's shader declares only the
 * bindings it samples; the bind group supplies every entry.
 */
export function createSurfaceBindGroupLayout(
  device: GpuDevice,
): GpuBindGroupLayout {
  const tex = (binding: number) => ({
    binding,
    visibility: GPU_SHADER_STAGE.FRAGMENT,
    texture: { sampleType: "float" as const, viewDimension: "2d" as const },
  });
  return device.createBindGroupLayout({
    label: "fourJS:surface",
    entries: [
      tex(SURFACE_MR_BINDING),
      {
        binding: SURFACE_SAMPLER_BINDING,
        visibility: GPU_SHADER_STAGE.FRAGMENT,
        sampler: { type: "filtering" },
      },
      tex(SURFACE_NORMAL_BINDING),
      tex(SURFACE_OCCLUSION_BINDING),
      tex(SURFACE_EMISSIVE_BINDING),
    ],
  });
}
