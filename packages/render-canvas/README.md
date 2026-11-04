# @fourjs/render-canvas

Canvas 2D backend (§62 backend 3) — part of [fourJS](../../README.md). A `Renderer` over `@fourjs/render`'s backend-independent interface that draws the shared scene model with 2D context calls: no GPU programs, no DOM types (the surface and context are structural, so it runs against a recording fake in Node).

```ts
import { Canvas2dRenderer } from "@fourjs/render-canvas";

const renderer = new Canvas2dRenderer({
  // Optional. Pass { willReadFrequently: true } if you read pixels back.
  contextAttributes: { willReadFrequently: true },
});
await renderer.initialize({ canvas });
renderer.render(scene, [
  { ...createFullscreenViewport(camera), clearColor: [0, 0, 0, 1] },
]);
```

Or through §62's ladder (the `canvas2d` rung of `AUTO_RENDERER_ORDER`):

```ts
import { registerCanvasRenderer } from "@fourjs/render-canvas";

registerCanvasRenderer(); // a call, not an import side effect ("sideEffects": false)
const app = new Application({ renderer: "auto", canvas });
```

`isSupported` only checks for the `CanvasRenderingContext2D` global and never touches the canvas; `create` builds without initializing.

## What it draws

| Item                                                                              | How                                                                                                                                                  |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unlit` / `lit` / `standard` / skinned (bind pose)                                | each triangle projected through `projection * view * world` and filled as one flat polygon in the material colour (sRGB-encoded, `opacity` as alpha) |
| `sprite`                                                                          | `drawImage` through an affine transform, when the texture resolves to an image (`imageOf`, default: its `image` property)                            |
| `node` materials, particles, line geometry, sprites with no image, render targets | counted in `renderer.skippedItems`, skipped, one `devWarnOnce` each                                                                                  |

Honest limits: no depth buffer (paint order is §64's sort, then index order), no lighting, no vertex colours, no mesh textures, triangles with a vertex at or behind the eye are skipped. `statistics` counts what was submitted (`drawCalls`, `triangles`).

## Contract

- Viewport rectangles are bottom-left origin (§48); the flip to Canvas 2D's top-left happens inside the package. The clear and every draw are clipped to the view rectangle.
- A view without `clearColor` does not clear; an empty `views` array draws and clears nothing.
- Nothing in the scene is mutated.
- `dispose()` is idempotent, terminal, and leaves no listeners on `events`.
- **Picking and `readPixels` are omitted, not emulated** (RFC 0005 Q6): `undefined` means "not taught to answer".
- **RFC 0004:** a texture whose image resolves to the surface being rendered is refused with `FourError("INVALID_RENDER_GRAPH")` before anything is drawn.
- §33: the same scene, camera and viewport produce a byte-identical `toDataURL()`. If you read pixels back, request `willReadFrequently` — Chromium otherwise moves a GPU canvas to software after the first readbacks and antialiasing changes between frames.

See [docs/guides/custom-renderer-backends.md](../../docs/guides/custom-renderer-backends.md) for the seam this package implements, and `examples/canvas-backend` for a runnable page (the browser gate `tests/browser/backends-canvas.spec.ts` asserts its lit pixels against a meshes-removed control).

Unit tests are colocated in `tests/` per §92. Workspace name `@fourjs/render-canvas`; publishes as `@danielsimonjr/fourjs-render-canvas`.
