/**
 * `@fourjs/render-webgpu` — the WebGPU backend (§62 backend 1).
 *
 * The public surface is one class, {@link WebgpuRenderer}, which implements
 * `@fourjs/render`'s `Renderer`, plus {@link registerWebgpuRenderer} for §62's
 * registry. Everything else exported here is exported because a *test*, a
 * diagnostic, or a later packet in this package needs it — the structural
 * device surface, the pipeline cache and its key function, the bind-group
 * layout table and the WGSL builders are the seams that let the whole backend
 * be unit-tested against a fake device with no GPU and no browser (Node has no
 * `navigator.gpu` at all; see `tests/integration/helpers/recording-gpu.ts`).
 *
 * Applications select a backend at the edge (§62); nothing in `@fourjs/scene`,
 * `@fourjs/motion`, or `@fourjs/physics` may name anything in this package. Note
 * that **calling `registerWebgpuRenderer()` moves an application off WebGL 2**,
 * because `AUTO_RENDERER_ORDER` prefers WebGPU — `register.ts` has the full
 * note.
 */

export const PACKAGE_NAME = "@fourjs/render-webgpu";

export type {
  Gpu,
  GpuAdapter,
  GpuStencilFaceState,
  GpuBindGroup,
  GpuBindGroupEntry,
  GpuBindGroupLayout,
  GpuBindGroupLayoutEntry,
  GpuBlendComponent,
  GpuBlendState,
  GpuBuffer,
  GpuBufferDescriptor,
  GpuCanvasContext,
  GpuCommandBuffer,
  GpuCommandEncoder,
  GpuComputePassEncoder,
  GpuComputePipeline,
  GpuComputePipelineDescriptor,
  GpuDevice,
  GpuDeviceLostInfo,
  GpuPipelineLayout,
  GpuQuerySet,
  GpuQueue,
  GpuRenderPassDescriptor,
  GpuRenderPassEncoder,
  GpuRenderPipeline,
  GpuBufferBinding,
  GpuRenderPipelineDescriptor,
  GpuSampler,
  GpuSamplerDescriptor,
  GpuShaderModule,
  GpuTexture,
  GpuTextureDescriptor,
  GpuTextureView,
  GpuTextureViewDescriptor,
  GpuVertexBufferLayout,
  WebgpuCanvas,
} from "./webgpu-device.js";
export {
  GPU_BUFFER_USAGE,
  GPU_MAP_MODE,
  GPU_SHADER_STAGE,
  GPU_TEXTURE_USAGE,
  UNIFORM_STRIDE_BYTES,
} from "./webgpu-device.js";
export { hostGpu, WebgpuRenderer } from "./webgpu-renderer.js";
export { isWebgpuSupported, registerWebgpuRenderer } from "./register.js";
export {
  DRAW_COLOR_OFFSET,
  DRAW_MODEL_OFFSET,
  DRAW_NORMAL_OFFSET,
  DRAW_UNIFORM_BYTES,
  DRAW_UNIFORM_FLOATS,
  DRAW_UNIFORM_WGSL,
  DRAW_VIEW_PROJECTION_OFFSET,
  MAP_BINDING_WGSL,
  MAP_BIND_GROUP_INDEX,
  MAP_SAMPLER_BINDING,
  MAP_TEXTURE_BINDING,
  SURFACE_EMISSIVE_BINDING,
  SURFACE_MR_BINDING,
  SURFACE_NORMAL_BINDING,
  SURFACE_OCCLUSION_BINDING,
  SURFACE_SAMPLER_BINDING,
  createDrawBindGroupLayout,
  createSurfaceBindGroupLayout,
  createTextureBindGroupLayout,
} from "./wgpu-bindings.js";
export type { SurfaceSources } from "./wgpu-surface-group.js";
export { WgpuSurfaceGroupCache } from "./wgpu-surface-group.js";
export type { CacheableGeometry, WgpuGeometryRecord } from "./wgpu-geometry.js";
export { WgpuGeometryCache } from "./wgpu-geometry.js";
export {
  STAGING_DIRECT_THRESHOLD,
  STAGING_RING_FRAMES,
  WgpuStagingRing,
} from "./wgpu-staging.js";
export type {
  WgpuBatchStream,
  WgpuPipelineDescriptor,
  WgpuPipelineKind,
  WgpuStencilDescriptor,
} from "./wgpu-pipeline-cache.js";
export {
  blendStateFor,
  pipelineKey,
  stencilStateFor,
  WgpuPipelineCache,
} from "./wgpu-pipeline-cache.js";
export type { WgpuRenderBatching } from "./wgpu-batch.js";
export {
  WgpuBatching,
  batchVertexBufferLayout,
  createWgpuBatching,
} from "./wgpu-batch.js";
export {
  SPRITE_MODEL_OFFSET,
  SPRITE_SHADER_SOURCE,
  SPRITE_TINT_OFFSET,
  SPRITE_UNIFORM_BYTES,
  SPRITE_UNIFORM_WGSL,
  SPRITE_VIEW_PROJECTION_OFFSET,
  createSpriteBindGroupLayout,
} from "./wgpu-sprite.js";
export type {
  ResolvedSamplerState,
  WgpuCacheableTexture,
  WgpuTextureRecord,
} from "./wgpu-texture.js";
export {
  MIPMAP_SHADER_SOURCE,
  WgpuTextureCache,
  mipLevelCount,
  samplerKey,
  textureByteLength,
} from "./wgpu-texture.js";
export {
  CLEAR_SHADER_SOURCE,
  CLEAR_VERTEX_COUNT,
  COLOR_BUFFER_LAYOUT,
  COLOR_SHADER_LOCATION,
  DRAW_MORPH_WEIGHT_OFFSET,
  DRAW_MORPH_WEIGHTS_OFFSET,
  MORPH_N_DRAW_UNIFORM_WGSL,
  morphHasNormals,
  morphTargetCount,
  morphVariant,
  morphVertexBufferLayouts,
  FRAGMENT_ENTRY_POINT,
  MORPH_DRAW_UNIFORM_WGSL,
  MORPH_WEIGHT_WGSL,
  NORMAL1_BUFFER_LAYOUT,
  NORMAL1_SHADER_LOCATION,
  POSITION1_BUFFER_LAYOUT,
  POSITION1_SHADER_LOCATION,
  POSITION_BUFFER_LAYOUT,
  POSITION_SHADER_LOCATION,
  UV_BUFFER_LAYOUT,
  UV_SHADER_LOCATION,
  VERTEX_ENTRY_POINT,
  unlitShaderSource,
  unlitVertexBufferLayouts,
  unlitFragmentStageWgsl,
  type WgpuMorph,
} from "./wgpu-unlit.js";
export {
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
  HEMISPHERE_UNIFORM_MEMBERS_WGSL,
  HEMISPHERE_UP_OFFSET,
  LIGHT_BINDING_BYTES,
  LIGHT_UNIFORM_BYTES,
  LIGHT_UNIFORM_FLOATS,
  LIGHT_UNIFORM_MEMBERS_WGSL,
  LIGHT_UNIFORM_STRIDE_BYTES,
  LIGHT_UNIFORM_STRIDE_FLOATS,
  LIGHT_UNIFORM_WGSL,
  PUNCTUAL_LIGHT_WGSL,
  SHADED_MAP_BINDING_WGSL,
  SHADED_MAP_BIND_GROUP_INDEX,
  SHADED_MR_BINDING_WGSL,
  SHADED_MR_BIND_GROUP_INDEX,
  createLightsBindGroupLayout,
  shadedMrBindingWgsl,
  writeLightUniforms,
} from "./wgpu-lights.js";
export {
  NORMAL_BUFFER_LAYOUT,
  NORMAL_MATRIX_WGSL,
  NORMAL_SHADER_LOCATION,
  litShaderSource,
  shadedVertexBufferLayouts,
  shadedVertexStageWgsl,
  litFragmentStageWgsl,
} from "./wgpu-lit.js";
export type {
  WgpuCacheableRenderTarget,
  WgpuRenderTargetRecord,
} from "./wgpu-render-target.js";
export {
  RENDER_TARGET_COLOR_FORMAT,
  RENDER_TARGET_DEPTH_FORMAT,
  RENDER_TARGET_DEPTH_STENCIL_FORMAT,
  RENDER_TARGET_DEPTH_TEXTURE_FORMAT,
  WgpuRenderTargetCache,
  WgpuTransientTargetPool,
  renderTargetDepthFormat,
  transientUsageOf,
} from "./wgpu-render-target.js";
export type { WgpuEffectKind } from "./wgpu-effect.js";
export {
  EFFECT_BIND_GROUP_INDEX,
  EFFECT_GRADE_OFFSET,
  EFFECT_PASS_VERTEX_COUNT,
  EFFECT_UNIFORM_BYTES,
  EFFECT_UNIFORM_WGSL,
  createEffectBindGroupLayout,
  effectShaderSource,
} from "./wgpu-effect.js";
export {
  READBACK_ROW_ALIGNMENT,
  readTexturePixels,
  readbackBytesPerRow,
} from "./wgpu-readback.js";
export type {
  ComputeBinding,
  ComputeBindingAccess,
  ComputeBufferOptions,
  ComputePassDescriptor,
} from "./wgpu-compute.js";
export {
  COMPUTE_ENTRY_POINT,
  PARTICLE_DEPTH_COLLIDE_SHADER_SOURCE,
  PARTICLE_FIELD_KIND,
  PARTICLE_INTEGRATOR_SHADER_SOURCE,
  PARTICLE_INTEGRATOR_WORKGROUP_SIZE,
  PARTICLE_SIMULATION_FIELD_FLOATS,
  PARTICLE_SIMULATION_HEADER_FLOATS,
  PARTICLE_SIMULATION_MAX_FIELDS,
  PARTICLE_SIMULATION_PARAMS_FLOATS,
  WgpuComputeBuffer,
  WgpuComputeCache,
  createComputeBuffer,
  particleIntegratorWorkgroups,
  readComputeBufferBytes,
  writeComputeBuffer,
  writeParticleSimulationParams,
} from "./wgpu-compute.js";
export type {
  ParticleSimulationField,
  ParticleSimulationFieldParams,
} from "./wgpu-compute.js";
export type { WgpuParticleRecord } from "./wgpu-particles.js";
export {
  PARTICLE_GPU_INSTANCE_BUFFER_LAYOUT,
  PARTICLE_GPU_POSITION_BUFFER_LAYOUT,
  PARTICLE_GPU_VERTEX_BUFFER_LAYOUTS,
  PARTICLE_APPEARANCE_SHADER_SOURCE,
  PARTICLE_INSTANCE_BUFFER_LAYOUT,
  PARTICLE_INSTANCE_STRIDE_BYTES,
  PARTICLE_MODEL_OFFSET,
  PARTICLE_PROJECTION_OFFSET,
  PARTICLE_SHADER_SOURCE,
  PARTICLE_WIDE_INSTANCE_BUFFER_LAYOUT,
  PARTICLE_WIDE_INSTANCE_STRIDE_BYTES,
  PARTICLE_UNIFORM_BYTES,
  PARTICLE_UNIFORM_WGSL,
  PARTICLE_VERTEX_BUFFER_LAYOUTS,
  PARTICLE_VIEW_OFFSET,
  WgpuParticleCache,
  createParticleBindGroupLayout,
} from "./wgpu-particles.js";
export type {
  ParticleDepthSource,
  WgpuParticleSimulationOptions,
} from "./wgpu-particle-simulation.js";
export {
  DEFAULT_DEPTH_BIAS,
  PARTICLE_SIMULATION_SCRATCH_BYTES,
  PARTICLE_SIMULATION_VECTOR_BYTES,
  WgpuParticleSimulation,
} from "./wgpu-particle-simulation.js";
export {
  SHADOW_ATLAS_OFFSET,
  SHADOW_CASCADE_MATRIX_OFFSET,
  SHADOW_CASCADE_SPLITS_OFFSET,
  SHADOW_FACTOR_WGSL,
  SHADOW_INFO_OFFSET,
  SHADOW_LEGACY_UNIFORM_BYTES,
  SHADOW_PUNCTUAL_PARAMS_OFFSET,
  SHADOW_PUNCTUAL_RANGE_OFFSET,
  SHADOW_PUNCTUAL_SLOT_OFFSET,
  SHADOW_SPOT_MATRIX_OFFSET,
  SHADOW_VIEW_DEPTH_OFFSET,
  SHADOW_LIGHT_UNIFORM_BYTES,
  SHADOW_LIGHT_UNIFORM_WGSL,
  SHADOW_MAP_BINDING,
  SHADOW_MATRIX_OFFSET,
  SHADOW_PARAMS_OFFSET,
  SHADOW_SAMPLER_BINDING,
  SHADOW_SHADER_SOURCE,
  SHADOW_UNIFORM_SPARE_BYTES,
  createShadowLightsBindGroupLayout,
  createShadowSampler,
  writeShadowUniforms,
} from "./wgpu-shadow.js";
export type { WgpuStencilSource } from "./wgpu-stencil.js";
export {
  CLEAR_STENCIL,
  STENCIL_ALL_BITS,
  applyStencilReference,
  frameWantsStencil,
  stencilDescriptor,
} from "./wgpu-stencil.js";
export type { SurfaceMaps } from "./wgpu-standard.js";
export {
  MORPH_N_STANDARD_UNIFORM_WGSL,
  MORPH_STANDARD_UNIFORM_WGSL,
  STANDARD_MORPH_WEIGHTS_OFFSET,
  NO_SURFACE_MAPS,
  SURFACE_DEFAULT_TEXELS,
  STANDARD_BASE_COLOR_OFFSET,
  STANDARD_EMISSIVE_OFFSET,
  STANDARD_MODEL_OFFSET,
  STANDARD_NORMAL_OFFSET,
  STANDARD_SURFACE_OFFSET,
  STANDARD_UNIFORM_BYTES,
  STANDARD_UNIFORM_WGSL,
  STANDARD_VIEW_PROJECTION_OFFSET,
  createStandardBindGroupLayout,
  standardShaderSource,
} from "./wgpu-standard.js";
// §60's node-material seam (RFC 0001; WP-R1.9). The registration slot and
// its interfaces are always exported; `registerWebgpuNodeMaterialPipeline`
// is what links the WGSL emitter and the pipeline store into a bundle —
// `wgpu-node-registry.ts` owns the whole seam.
export type {
  WgpuNodeFrameState,
  WgpuNodeItemMaterial,
  WgpuNodeMaterialPipelineFactory,
  WgpuNodeMaterialPipelines,
  WgpuNodePipelineHost,
} from "./wgpu-node-registry.js";
export {
  clearRegisteredWebgpuNodeMaterialPipeline,
  resolveWebgpuNodeMaterialPipelineFactory,
  setWebgpuNodeMaterialPipelineFactory,
} from "./wgpu-node-registry.js";
export type { EmittedWgslNodeShader } from "./wgpu-node-program.js";
export {
  NODE_SCREEN_BLOCK_BASE_BYTES,
  NODE_SCREEN_TEXTURE_GROUP,
  NODE_SURFACE_BLOCK_BASE_BYTES,
  NODE_SURFACE_BLOCK_GROUP,
  NODE_SURFACE_TEXTURE_GROUP,
  WgpuNodePipelineStore,
  emitShaderGraphWgsl,
  registerWebgpuNodeMaterialPipeline,
} from "./wgpu-node-program.js";
// §71's picking pipeline (RFC 0005). Deliberately — like the node-material
// pipeline above — a module `WebgpuRenderer` never reaches statically:
// importing `registerPickingPipeline` is what links the id pipeline, the
// service, and its `mapAsync` read-back into a bundle, and a barrel
// re-export does not (it tree-shakes like every other unused export) —
// see `wgpu-picking-registry.ts` for the whole seam.
export type {
  PickingRendererHost,
  PickingServiceFactory,
} from "./wgpu-picking-registry.js";
export {
  clearRegisteredPickingPipeline,
  resolvePickingServiceFactory,
} from "./wgpu-picking-registry.js";
export {
  ID_MODEL_OFFSET,
  ID_PICK_OFFSET,
  ID_SHADER_SOURCE,
  ID_UNIFORM_BYTES,
  ID_VIEW_PROJECTION_OFFSET,
  PARTICLE_ID_MODEL_OFFSET,
  PARTICLE_ID_PICK_OFFSET,
  PARTICLE_ID_PROJECTION_OFFSET,
  PARTICLE_ID_SHADER_SOURCE,
  PARTICLE_ID_UNIFORM_BYTES,
  PARTICLE_ID_VIEW_OFFSET,
  SKINNED_ID_PALETTE_BYTES,
  SKINNED_ID_SHADER_SOURCE,
  WebgpuPickingService,
  registerPickingPipeline,
} from "./wgpu-picking.js";
// §54's skinning pipeline (RFC 0003). Deliberately — like the picking
// pipeline above — a module `WebgpuRenderer` never reaches statically:
// importing `registerSkinningPipeline` is what links the two skinned colour
// pipelines and the palette uploader into a bundle, and a barrel re-export
// does not (it tree-shakes like every other unused export) —
// see `wgpu-skinning-registry.ts` for the whole seam.
export type {
  SkinningPipelineFactory,
  SkinningPipelineHost,
  SkinnedLitPipeline,
  SkinnedPrograms,
  SkinnedUnlitPipeline,
  WgpuSkinnedDrawDescriptor,
  WgpuSkinnedShadowDescriptor,
} from "./wgpu-skinning-registry.js";
export {
  clearRegisteredSkinningPipeline,
  resolveSkinningPipelineFactory,
} from "./wgpu-skinning-registry.js";
export {
  JOINTS_BUFFER_LAYOUT,
  JOINTS_SHADER_LOCATION,
  JOINT_PALETTE_BINDING,
  JOINT_PALETTE_BYTES,
  JOINT_PALETTE_FLOATS,
  WEIGHTS_BUFFER_LAYOUT,
  WEIGHTS_SHADER_LOCATION,
  createJointPaletteBindGroupLayout,
  registerSkinningPipeline,
  SKINNED_SHADOW_SHADER_SOURCE,
  SKINNED_SHADOW_VERTEX_BUFFER_LAYOUTS,
  skinnedLitShaderSource,
  skinnedLitVertexBufferLayouts,
  skinnedPaletteBindGroupIndex,
  skinnedShadowShaderSource,
  skinnedUnlitShaderSource,
  skinnedUnlitVertexBufferLayouts,
  skinningWgsl,
} from "./wgpu-skinning.js";
