# Custom renderer backends

Nothing in fourJS draws pixels directly: an application hands a **`Renderer`**
to `Application`, and §61's interface is the only thing the rest of the engine
knows about a backend. `render-webgl` and `render-webgpu` ship one each.
`render-canvas` and `render-svg` are **reserved stubs** — one source line
apiece, exporting only `PACKAGE_NAME` — so `AUTO_RENDERER_ORDER`'s `canvas2d`
and `svg` rungs cannot be filled by any fourJS package today.

That is what makes this guide worth having rather than academic. It is the
renderer seam's counterpart to
[custom solver adapters](custom-solver-adapters.md), and everything below was
written and measured **from a consumer seat** during dogfood cycle 9
(2026-09-19): a Canvas 2D backend and an SVG backend, about 120 lines each,
against published exports only — `Renderer`, `RendererCapabilities`,
`buildRenderList`, `createRenderStatistics`, `registerRenderer` — with no
access to package internals.

## What the interface actually requires

`Renderer` (in `@fourjs/render`) has six required members and a long tail of
optional ones. The required set is small on purpose:

| Member                      | What a backend owes                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `capabilities`              | a `RendererCapabilities` record; `backend` and `maxTextureSize` are its only required fields |
| `events`                    | an `EventEmitter<RendererEventMap>` — `contextlost` / `contextrestored`                      |
| `initialize(options?)`      | acquire the context or device; rejecting is how §62's `"auto"` falls through                 |
| `render(root, views, …)`    | draw `root`'s subtree once per viewport, **mutating nothing in the scene**                   |
| `resize(w, h, resolution?)` | resize the drawing surface; cameras are the application's to update                          |
| `dispose()`                 | idempotent, terminal, leaves no listeners on `events`                                        |

Everything else — `statistics`, `lastGpuFrameTimeSeconds`, `renderEffect`,
`createPickingService`, `compute`, `prepareTexture`, `readPixels` — is
**optional, and its presence is the capability**. A backend that cannot do one
of those omits the member, and the matching `supports*` predicate is how the
engine tells "cannot" from "did not say". Omission is the honest answer; an
emulated member is not.

One trap the declarations invite, found from the consumer seat in cycle 9:
`Renderer extends Disposable`, and `Disposable` is **fourJS's own interface,
not TC39's**. The member is the plain `dispose()`. Implementing
`[Symbol.dispose]()` instead satisfies the TypeScript global and nothing in
this repository ever calls it.

## A backend, end to end

`buildRenderList` flattens a subtree into pooled, compact items (§64), so a
backend never walks the scene graph itself. The items are **rewritten in place**
by the next build — read them inside the call, retain nothing.

```ts
import { EventEmitter } from "fourJS/core";
import {
  buildRenderList,
  createRenderStatistics,
  type RenderItem,
  type Renderer,
  type RendererCapabilities,
  type RendererEventMap,
  type RenderStatistics,
} from "fourJS/render";
import type { Node, Viewport } from "fourJS/scene";

class Canvas2dRenderer implements Renderer {
  readonly capabilities: RendererCapabilities = {
    backend: "canvas2d",
    maxTextureSize: 4096,
    // Everything unanswered stays absent: `undefined` means "not taught to
    // answer", which §62 refuses to read as a yes.
  };
  readonly events = new EventEmitter<RendererEventMap>();
  statistics: RenderStatistics | null = createRenderStatistics();

  readonly #surface: HTMLCanvasElement;
  #context: CanvasRenderingContext2D | null = null;
  readonly #items: RenderItem[] = [];

  constructor(surface: HTMLCanvasElement) {
    this.#surface = surface;
  }

  async initialize(): Promise<void> {
    const context = this.#surface.getContext("2d");
    if (context === null) throw new Error("no 2D context on this surface");
    this.#context = context;
  }

  render(root: Node, views: readonly Viewport[]): void {
    const context = this.#context;
    if (context === null) return;
    const items = buildRenderList(root, this.#items);
    for (const view of views) {
      // Viewport rectangles are bottom-left-origin, +Y up (§7a, §48); a
      // top-left-based API flips on the way in and never leaks the flip.
      for (const item of items) {
        drawOneItem(context, view, item); // your projection + fill
        if (this.statistics !== null) this.statistics.drawCalls += 1;
      }
    }
  }

  resize(width: number, height: number, resolution = 1): void {
    this.#surface.width = Math.round(width * resolution);
    this.#surface.height = Math.round(height * resolution);
  }

  dispose(): void {
    this.#context = null;
    this.events.removeAllListeners();
  }
}
```

`statistics` is the one optional member worth declaring first: it costs an
integer increment beside each draw, and §84's overlay reports "not measured"
rather than a confident zero when it is absent. Two rules bind it —
**accumulate, never clear** (the frame's owner resets it), and **count what was
submitted**, not what the list contained.

## Registering it, and the ladder it joins

```ts
import { registerRenderer, resolveRenderer } from "fourJS/render";

const surface = document.createElement("canvas");

registerRenderer({
  backend: "canvas2d",
  // Cheap and side-effect-free. Never acquire a context here: a canvas hands
  // out one context per type, so a probe would fix the attributes of the
  // context the backend later acquires.
  isSupported: () => typeof document !== "undefined",
  create: () => new Canvas2dRenderer(surface),
});

const renderer = await resolveRenderer("auto");
```

`resolveRenderer("auto")` walks `AUTO_RENDERER_ORDER` — `webgpu`, `webgl2`,
`canvas2d`, `svg` — and cycle 9 measured that it selects a
**consumer-registered** backend exactly as it would a first-party one. §62's
ladder accepts a third-party rung. The two lower rungs are simply empty until
an application fills them or the stub packages ship.

`create` must **not** initialize: the registry calls `initialize()` itself,
because §62's fallback is defined in terms of initialization failing.

## The swap costs three consumer lines, not two

Cycle 3c measured a WebGL → WebGPU swap at **two** lines — the import and the
constructor. Cycle 9 measured Canvas 2D → SVG at **three**, and the third is
the one worth knowing about:

```diff
-import { Canvas2dRenderer } from "./canvas2d-renderer.js";
-const surface: HTMLCanvasElement = document.createElement("canvas");
-const renderer = new Canvas2dRenderer(surface);
+import { SvgRenderer } from "./svg-renderer.js";
+const surface: SVGSVGElement =
+  document.createElementNS("http://www.w3.org/2000/svg", "svg");
+const renderer = new SvgRenderer(surface);
```

`Renderer` has **no surface member** — each backend takes its own surface in
its own constructor — so Canvas 2D and SVG do not share `HTMLCanvasElement`.
The seam holds above the surface; the surface handle is the one thing that
leaks into consumer code, and it does so by design rather than by omission.
WebGL and WebGPU both take a canvas, which is why cycle 3c saw two lines and
not three.

## What cycle 9 measured

All from a consumer seat, on the same scene, in headless Chromium:

- **Canvas 2D:** 35,851 lit pixels, 3 draw calls, 82 triangles, against a
  meshes-removed control of 0 pixels.
- **SVG:** 83 elements (one background `<rect>` plus 82 `<polygon>`), against
  an emptied-scene control of 1 element.
- **Agreement:** the two backends draw the same picture to **1 pixel in
  230,400** (0.0004%); the 1,209 differing pixels are antialiased edges.
- **§33 determinism:** `toDataURL()` and `outerHTML` byte-identical over two
  runs, and a Node projection reproduced Chrome's first and last `points`
  attributes exactly.
- **Types:** consumer typecheck under `strict` with `skipLibCheck: false`,
  against the shipped declarations — **0 errors in fourJS's own declarations**.

## Rules a new backend must keep

- **Mutate nothing in the scene.** Rendering reads world transforms (or §43
  render poses) and writes pixels. §42's transform authority and §43's
  "render poses never feed back" rule both depend on it, and it is what lets a
  renderer be swapped, run twice, or omitted without changing simulation
  results.
- **Declare by omission.** No emulated `createPickingService`, no fabricated
  `readPixels` bytes. `undefined` in a capability record means "not taught to
  answer" and §62 will not read it as a yes.
- **An empty `views` array draws nothing and clears nothing.** A view with no
  `clearColor` does not clear colour — that is how a minimap composites over
  what an earlier view drew.
- **Clears are confined to the viewport rectangle**, never the whole surface.
- **Fail loudly in `initialize()`**, do not silently downgrade. Backend
  _selection_ and its `"auto"` fallback are the application's job (§62), not an
  individual backend's, and the registry recovers from a rejection by moving to
  the next rung.
- **`dispose()` is idempotent and terminal**, must succeed while the context is
  lost, and must leave no listeners on `events` (§83). Resources the renderer
  did not create are not disposed here.

## Honest state

- Shipped backends: `@fourjs/render-webgl` (WebGL 2) and
  `@fourjs/render-webgpu`. `NullRenderer`, in `@fourjs/render`, is the
  conformance fixture: the interface minus every line of GL, and the reference
  a backend author should read first.
- Reserved stubs: `@fourjs/render-canvas` and `@fourjs/render-svg` (§62, §102).
  Each builds, publishes, and exports `PACKAGE_NAME` and nothing else —
  measured from a consumer seat 2026-09-19 as **1 export apiece**, in Node and
  in Chrome. `fourJS/render-canvas` and `fourJS/render-svg` import cleanly and
  register no backend.
- The unregistered-backend error names `registerWebglRenderer()` whichever
  backend was asked for; the second half of its advice ("or pass a `Renderer`
  instance") is always right. Recorded in `TODO.md`, not yet fixed.
- Picking is deliberately absent on the future Canvas 2D and SVG tiers even
  though both could answer `"pixel"` natively (`isPointInPath`, SVG hit
  testing): emulation would make §71's result _quality_ vary by backend
  (RFC 0005 Q6).

## Cross-references

- §61 (the interface), §62 (backend tiers and selection), §64 (render lists),
  §84 (statistics), §83 (disposal), §102 (the reserved packages).
- [Materials and the render graph](materials-and-render-graph.md) — what the
  render list carries and how the §63 graph drives a backend.
- [Custom solver adapters](custom-solver-adapters.md) — the same shape of
  document for the physics seam.
- [Compatibility tables](../COMPATIBILITY.md) — §90's render-backend tier
  table, including the stub rows.
- `packages/render/src/renderer.ts` — the interface with its contract written
  onto every member, and `NullRenderer` underneath it.
