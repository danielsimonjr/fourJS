# @fourjs/render-webgpu

WebGPU backend — §62 backend 1. Part of [fourJS](../../README.md).

Implements `@fourjs/render`'s `Renderer` over WebGPU (WP-R1.1–R1.9, 2026-08-21…29; the R-1 plan is complete). Applications select a backend at the edge — nothing in `@fourjs/scene`, `@fourjs/motion`, or `@fourjs/physics` may name anything in this package. **Calling `registerWebgpuRenderer()` moves an application off WebGL 2**, because `AUTO_RENDERER_ORDER` prefers WebGPU.

This package was a reserved stub until WP-R1.1 landed 2026-08-21. The barrel no longer exports only `PACKAGE_NAME`.

## What's here

- **`WebgpuRenderer`** — the one public entry point. Unlit / sprite / lit / standard families, opt-in §65 batching, textures + samplers, §67 clips + §57 stencil parity, render targets / §70 effects / `readPixels`, the §69 directional shadow tier, §36 instanced particles, §82 compute, §60 node materials + §70 graph effects behind `registerWebgpuNodeMaterialPipeline()`, and §71 picking behind `registerPickingPipeline()`.
- **`registerWebgpuRenderer` / `isWebgpuSupported`** — §62's opt-in registry seam.
- **Testing seams** — the structural device surface, pipeline cache, bind-group layouts, and WGSL builders, so the backend can be unit-tested against a fake device with no GPU and no browser (Node has no `navigator.gpu`; see `tests/integration/helpers/recording-gpu.ts`).

RFC 0003's skinned **shadow caster** compiles lazily through `acquireShadow()` on the registered colour pair. §71 picking is opt-in via `registerPickingPipeline()` (`createPickingService` throws until registered); particle systems pick as one id per emitter (CPU 8-float stream); skinned items pick through a private skinned id pipeline; trails stay skipped.

Known parity gap: the standard family's surface group samples every map (metallic-roughness, normal, occlusion, emissive) through the first present map's sampler, so it differs from WebGL's per-unit §77 state only when a detail map's wrap/filter differs from the metallic-roughness map's.

Unit tests are colocated in `tests/` per §92. Browser-pixel coverage lives under `tests/browser/webgpu/`.

Workspace name `@fourjs/render-webgpu`; publishes as `@danielsimonjr/fourjs-render-webgpu`.

## Compressed textures (R-30c)

WebGPU: block-compressed 2D textures (`format` + `levels`) upload with `writeTexture` when the device has `texture-compression-bc` / `-etc2` / `-astc`; `capabilities.textureFormats` lists the engine names. Without the feature the texture allocates zero-filled RGBA8; transcode to the `rgba8unorm` fallback instead.
