# @fourjs/render-svg

SVG backend — §62's `svg` rung, a retained-mode vector renderer. Part of [fourJS](../../README.md).

```ts
import { SvgRenderer, registerSvgRenderer } from "@fourjs/render-svg";

const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
const renderer = new SvgRenderer();
await renderer.initialize({ canvas: svg }); // the <svg> is the "canvas"
renderer.resize(640, 360);
renderer.render(scene, views);

// or, through the §62 ladder:
registerSvgRenderer();
const picked = await resolveRenderer("auto", { canvas: svg });
```

## What's here

- **`SvgRenderer`** implements `@fourjs/render`'s `Renderer`. Per frame it projects unlit triangles on the CPU and writes one `<polygon points fill>` per triangle after one background `<rect>` per view that has a `clearColor`. The `viewBox` is `0 0 W H` in drawing-buffer pixels; the Y-up world (§7a, §48) is flipped into SVG's Y-down space in projection.
- **Retained mode.** Slot _n_ reuses slot _n_'s element every frame and an attribute is written only when its text changed: a static scene performs no DOM writes, the element count grows only with the draw count (extras are removed), and two runs serialize byte-identically (§33).
- **`registerSvgRenderer(registry?)`** / `isSvgSupported` mirror `registerWebglRenderer`; support means "`options.canvas` is an `<svg>`".
- **`SvgSurface`** is a structural seam (an element with `setAttribute` / `appendChild` / `removeChild` and an `ownerDocument.createElementNS`), so the package compiles without `lib.dom` and Node tests use a recording fake.
- **`statistics`** (`drawCalls` and `triangles` count polygons written) and `skippedItems`.

## Limits (deliberate)

Only `unlit` triangle items draw, flat-filled in render-list (painter's) order: no depth test, back-face culling, per-view clipping, textures, lighting, picking or `readPixels`. Other kinds are counted in `skippedItems` and skipped with one development warning per kind. Triangles with a vertex at or behind the camera plane are dropped.

Unit tests are colocated in `tests/` per §92; the browser gate is `tests/browser/backends-svg.spec.ts`.

Workspace name `@fourjs/render-svg`; publishes as `@danielsimonjr/fourjs-render-svg`.
