# @fourjs/render-canvas

Canvas 2D backend — **interface reserved; not yet implemented.** Part of [fourJS](../../README.md).

Reserved for the Canvas 2D rendering backend (2D scenes and fallback rendering) per §62 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md). The §120 MVP renders with WebGL 2 only (`@fourjs/render-webgl`).

The package exists in the workspace so the §98 monorepo tree stays accurate. The barrel currently exports only `PACKAGE_NAME`, and `tests/` holds a single smoke test. When implemented, it will provide a `Renderer` implementation over `@fourjs/render`'s backend-independent interface.

**Until then, an application can write that backend itself**, and the published surface is sufficient for it: `@fourjs/render` exports the `Renderer` interface, `RendererCapabilities` (declare `backend: "canvas2d"`), `buildRenderList`, `createRenderStatistics`, and `registerRenderer`, so a consumer-authored Canvas 2D backend registers into the §62 ladder and is selected by `resolveRenderer("auto")` exactly as a first-party one would be. Verified from a clean consumer on 2026-09-19 against the shipped declarations under `strict` with `skipLibCheck: false`: 0 type errors, 82 triangles drawn, 35,851 lit pixels in Chrome, byte-identical across two runs (§33). Because this package is a stub, `AUTO_RENDERER_ORDER`'s `"canvas2d"` rung is unreachable from fourJS packages alone — only an application's own registration fills it.

Unit tests are colocated in `tests/` per §92.

Workspace name `@fourjs/render-canvas`; publishes as `@danielsimonjr/fourjs-render-canvas`.
