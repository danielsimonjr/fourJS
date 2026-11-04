# @fourjs/render-canvas

## Unreleased

### Minor Changes

- Ships the Canvas 2D backend (§62), replacing the reserved stub: `Canvas2dRenderer` implements every required `Renderer` member plus `statistics`, over structural `Canvas2dSurface` / `Canvas2dContextLike` types (no DOM lib). Mesh items are drawn as filled projected polygons, sprites with `drawImage` when an image source resolves, other item kinds are counted in `skippedItems` and skipped with a one-time warning. Per-view clears are confined to the viewport rectangle (§48 flip). Picking and `readPixels` are omitted by design.
- `registerCanvasRenderer(registry?)` / `isCanvas2dSupported()` fill the `canvas2d` rung of `AUTO_RENDERER_ORDER`.
- RFC 0004: a texture sourced from the surface being rendered is refused with `FourError("INVALID_RENDER_GRAPH")`.

## 0.1.0

### Patch Changes

- Updated dependencies [b3ec9d6]
- Updated dependencies [3f48b1d]
  - @fourjs/render@0.1.0

## 0.0.2

### Patch Changes

- @fourjs/render@0.1.0
