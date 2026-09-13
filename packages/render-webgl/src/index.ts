/**
 * `@fourjs/render-webgl` — the WebGL 2 backend (§62 backend 2, §120's MVP tier).
 *
 * The public surface is one class, {@link WebglRenderer}, which implements
 * `@fourjs/render`'s `Renderer`. Everything else exported here is exported
 * because a *test*, a diagnostic, or a future second pipeline in this package
 * needs it — `GL`, `WebglContext`, `UnlitProgram`, and `GeometryCache` are the
 * seams that let the whole backend be unit-tested against a hand-rolled fake
 * context with no GPU and no browser (see `tests/webgl-renderer.test.ts`).
 *
 * Applications select a backend at the edge (§62); nothing in `@fourjs/scene`,
 * `@fourjs/motion`, or `@fourjs/physics` may name anything in this package.
 */

export const PACKAGE_NAME = "@fourjs/render-webgl";

export type { BatchGlContext, RenderBatching } from "./gl-batch.js";
export { GlBatching, createGlBatching } from "./gl-batch.js";
export type {
  EffectPipeline,
  EffectPipelineFactory,
} from "./gl-effect-registry.js";
export {
  EFFECT_TEXTURE_UNIT,
  EFFECT_VERTEX_COUNT,
  clearRegisteredEffectPipeline,
  resolveEffectPipelineFactory,
} from "./gl-effect-registry.js";
// §70's fixed-effect pipeline (R-6; behind a seam since 2026-09-11).
// Deliberately — like every registered pipeline below — a module
// `WebglRenderer` never reaches statically: importing `registerEffectPipeline`
// is what links the full-screen program into a bundle, and a barrel re-export
// does not (it tree-shakes like every other unused export) — see
// `gl-effect-registry.ts` for the whole seam.
export { EffectProgram, registerEffectPipeline } from "./gl-effect.js";
export type { CacheableGeometry, GeometryRecord } from "./gl-geometry.js";
export { GeometryCache } from "./gl-geometry.js";
export type {
  ParticleAppearancePipeline,
  ParticleBillboardPipeline,
  ParticlePipelineFactory,
  ParticlePrograms,
} from "./gl-particles-registry.js";
export {
  clearRegisteredParticlePipeline,
  particleItemFloats,
  resolveParticlePipelineFactory,
} from "./gl-particles-registry.js";
export type {
  ParticleBatchRecord,
  ParticleGlContext,
  ParticleTrailBatchRecord,
} from "./gl-particles.js";
// §36's particle pipeline (plan P9-3; behind a seam since 2026-09-11):
// importing `registerParticlePipeline` is what links the three programs and
// the two batch caches — see `gl-particles-registry.ts`.
export {
  PARTICLE_ATTRIBUTE_LOCATIONS,
  PARTICLE_DEPTH_TEXTURE_UNIT,
  PARTICLE_GL,
  PARTICLE_VERTEX_SHADER_SOURCE,
  ParticleAppearanceProgram,
  ParticleBatchCache,
  ParticleProgram,
  ParticleTrailBatchCache,
  ParticleTrailProgram,
  registerParticlePipeline,
} from "./gl-particles.js";
export type {
  GlBuffer,
  GlProgramHandle,
  GlShader,
  GlQuery,
  GlSync,
  GlTexture,
  GlUniformLocation,
  GlVertexArray,
  WebglContext,
} from "./gl-program.js";
export type { GlFramebuffer, GlRenderbuffer } from "./gl-program.js";
export {
  COLOR_ATTRIBUTE_LOCATION,
  GL,
  LitProgram,
  MAP_TEXTURE_UNIT,
  METAL_ROUGHNESS_TEXTURE_UNIT,
  EMISSIVE_TEXTURE_UNIT,
  NORMAL_ATTRIBUTE_LOCATION,
  POSITION_ATTRIBUTE_LOCATION,
  HEMISPHERE_LIGHT_GLSL,
  HemisphereLightUniforms,
  PUNCTUAL_LIGHT_GLSL,
  PunctualLightUniforms,
  SHADOW_GLSL,
  SHADOW_TEXTURE_UNIT,
  ShadowUniforms,
  SpriteProgram,
  UV_ATTRIBUTE_LOCATION,
  UnlitProgram,
} from "./gl-program.js";
export type {
  PickingRendererHost,
  PickingServiceFactory,
} from "./gl-picking-registry.js";
export {
  clearRegisteredPickingPipeline,
  resolvePickingServiceFactory,
} from "./gl-picking-registry.js";
// §71's picking pipeline (RFC 0005). Deliberately — like the skinned and
// node-material pipelines above and below — a module `WebglRenderer` never
// reaches statically: importing `registerPickingPipeline` is what links the
// id program, the service, and its fence read-back into a bundle, and a
// barrel re-export does not (it tree-shakes like every other unused export)
// — see `gl-picking-registry.ts` for the whole seam.
export {
  IdPassProgram,
  PICKING_GL,
  ParticleIdProgram,
  SkinnedIdProgram,
  WebglPickingService,
  registerPickingPipeline,
} from "./gl-picking.js";
export type {
  CacheableRenderTarget,
  RenderTargetRecord,
} from "./gl-render-target.js";
export { RenderTargetCache } from "./gl-render-target.js";
export {
  JOINTS_ATTRIBUTE_LOCATION,
  WEIGHTS_ATTRIBUTE_LOCATION,
} from "./gl-program.js";
export type {
  SkinnedLitPipeline,
  SkinnedPrograms,
  SkinnedShadowPipeline,
  SkinnedUnlitPipeline,
  SkinningPipelineFactory,
} from "./gl-skinning-registry.js";
export {
  clearRegisteredSkinningPipeline,
  resolveSkinningPipelineFactory,
} from "./gl-skinning-registry.js";
// The skinned pipeline itself (§54; RFC 0003). Deliberately the **only**
// module here that `WebglRenderer` does not reach statically: importing
// `registerSkinningPipeline` is what links the two skinned colour programs
// and the lazy caster into a bundle, and a barrel re-export does not (it
// tree-shakes like every other unused export) — see
// `gl-skinning-registry.ts` for the whole seam.
export {
  SKINNING_GLSL,
  SkinnedLitProgram,
  SkinnedShadowProgram,
  SkinnedUnlitProgram,
  registerSkinningPipeline,
} from "./gl-skinning.js";
export type {
  NodeItemMaterial,
  NodeMaterialPipelineFactory,
  NodeMaterialProgram,
  NodeMaterialPrograms,
} from "./node-pipeline-registry.js";
export {
  NODE_SURFACE_TEXTURE_UNIT_BASE,
  clearRegisteredNodeMaterialPipeline,
  resolveNodeMaterialPipelineFactory,
} from "./node-pipeline-registry.js";
// §60's node pipeline (RFC 0001). Deliberately — like the skinned pipeline
// above — a module `WebglRenderer` never reaches statically: importing
// `registerNodeMaterialPipeline` is what links the GLSL emitter and the
// program cache into a bundle, and a barrel re-export does not (it
// tree-shakes like every other unused export) — see
// `node-pipeline-registry.ts` for the whole seam.
export type { EmittedNodeShader } from "./gl-node-program.js";
export {
  GlNodeProgram,
  GlNodeProgramCache,
  emitShaderGraphGlsl,
  registerNodeMaterialPipeline,
} from "./gl-node-program.js";
export type {
  ShadowCasterPipeline,
  ShadowPipelineFactory,
} from "./gl-shadow-registry.js";
export {
  clearRegisteredShadowPipeline,
  resolveShadowPipelineFactory,
} from "./gl-shadow-registry.js";
// §69's depth-only caster (R-18; behind a seam since 2026-09-11): importing
// `registerShadowPipeline` is what links it — see `gl-shadow-registry.ts`.
export { ShadowProgram, registerShadowPipeline } from "./gl-shadow.js";
export type {
  StandardPipeline,
  StandardPipelineFactory,
} from "./gl-standard-registry.js";
export {
  clearRegisteredStandardPipeline,
  resolveStandardPipelineFactory,
} from "./gl-standard-registry.js";
// §59's metallic-roughness pipeline (R-13; behind a seam since 2026-09-11 by
// owner decision): importing `registerStandardPipeline` is what links it —
// see `gl-standard-registry.ts`.
export { StandardProgram, registerStandardPipeline } from "./gl-standard.js";
export type { CacheableTexture, TextureRecord } from "./gl-texture.js";
export { TextureCache } from "./gl-texture.js";
export { isWebgl2Supported, registerWebglRenderer } from "./register.js";
export type {
  WebglCanvas,
  WebglContextAttributes,
  WebglContextEventLike,
} from "./webgl-renderer.js";
export { WebglRenderer } from "./webgl-renderer.js";
