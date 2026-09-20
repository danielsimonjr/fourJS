# @fourjs/render-svg

SVG backend — **interface reserved; not yet implemented.** Part of [fourJS](../../README.md).

Reserved for the SVG rendering backend (vector output and 2D fallback) per §62 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md). The §120 MVP renders with WebGL 2 only (`@fourjs/render-webgl`).

The package exists in the workspace so the §98 monorepo tree stays accurate. The barrel currently exports only `PACKAGE_NAME`, and `tests/` holds a single smoke test. When implemented, it will provide a `Renderer` implementation over `@fourjs/render`'s backend-independent interface.

**Until then, an application can write that backend itself**, and the published surface is sufficient for it: `@fourjs/render` exports the `Renderer` interface, `RendererCapabilities` (declare `backend: "svg"`), `buildRenderList`, `createRenderStatistics`, and `registerRenderer`, so a consumer-authored SVG backend registers into the §62 ladder and is selected by `resolveRenderer("auto")` exactly as a first-party one would be. Verified from a clean consumer on 2026-09-19 against the shipped declarations under `strict` with `skipLibCheck: false`: 0 type errors, 82 `<polygon>` elements emitted beside one background `<rect>`, byte-identical markup across two runs (§33), and 35,850 lit pixels once rasterised against the Canvas 2D backend's 35,851 for the same scene. Because this package is a stub, `AUTO_RENDERER_ORDER`'s `"svg"` rung is unreachable from fourJS packages alone — only an application's own registration fills it.

Unit tests are colocated in `tests/` per §92.

Workspace name `@fourjs/render-svg`; publishes as `@danielsimonjr/fourjs-render-svg`.
