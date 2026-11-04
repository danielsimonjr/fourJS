# @fourjs/render-webgl

WebGL 2 backend — the MVP renderer (§120). Part of [fourJS](../../README.md).

Implements §62 backend 2 of [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped across Phases 3, 3a, and 9. Applications select a backend at the edge — nothing in `@fourjs/scene`, `@fourjs/motion`, or `@fourjs/physics` may name anything in this package.

## What's here

- **`WebglRenderer`** — the one public entry point, implementing `@fourjs/render`'s `Renderer`. It draws unlit geometry, textured sprites, and instanced particles (straight-alpha blended, a constant 6 GL calls per frame at any particle count).
- **§71 picking (RFC 0005)** — `registerPickingPipeline()` then `renderer.createPickingService()`. The id pass encodes one id per `Renderable`, **one id per particle system** (`ParticleIdProgram`), and a **deformed silhouette for skinned meshes** (`SkinnedIdProgram`). Pair with `fourJS`'s `createPickProvider`. Calling `createPickingService()` without registering is refused.
- **Testing seams** — `GL`, `WebglContext` (a 33-method structural context interface), `WebglCanvas`, the `UnlitProgram` / `SpriteProgram` / `ParticleProgram` pipelines, and the `GeometryCache` / `TextureCache` / `ParticleBatchCache` resource caches. These are exported so the whole backend can be unit-tested against a hand-rolled fake context with no GPU and no browser (see `tests/webgl-renderer.test.ts`); browser-pixel coverage runs under Playwright with SwiftShader.

## Notes

- Unlit draws currently run with `GL_BLEND` off, so alpha animation on unlit materials is invisible (recorded §60a/blending backlog); particles are the first blended non-sprite pass.
- The `core + math + scene + render-webgl` payload is gated by the §86 budget (≤150 kB gzip; currently ~32 kB).

Unit tests are colocated in `tests/` per §92.

Workspace name `@fourjs/render-webgl`; publishes as `@danielsimonjr/fourjs-render-webgl`.

## Dynamic geometry updates

A version bump with unchanged attribute/index presence retains the geometry's
VAO and buffer objects. Every stream still receives a full `bufferData` upload;
array resizing, primitive mode changes and 16/32-bit index changes do not need
new handles. Adding/removing a stream rebuilds the layout. Empty geometry evicts
its record, context loss forgets handles, and a disposed cache cannot allocate
again. Initial uploads and refreshes share one unrolled writer; a private
layout mask keeps compatibility checks cheap.

This reduces handle churn and attribute setup, not upload bandwidth or draw
count. See [`geometry-updates.mjs`](../../benchmarks/geometry-updates.mjs) for the
counting benchmark and its explicit CPU/GPU measurement boundary.

## Compressed textures (R-30c)

WebGL: block-compressed 2D textures (`format` + `levels`) upload via `compressedTexImage2D` when the matching `EXT_texture_compression_bptc` / `WEBGL_compressed_texture_etc` / `_astc` extension exists; `capabilities.textureFormats` lists them. Without it the texture allocates zero-filled RGBA8; transcode to the `rgba8unorm` fallback instead.
