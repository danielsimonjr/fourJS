/**
 * `@fourjs/render-canvas` — the Canvas 2D backend (§62 backend 3).
 *
 * One class, {@link Canvas2dRenderer}, implementing `@fourjs/render`'s
 * `Renderer` over structural surface/context types (no DOM lib), plus
 * {@link registerCanvasRenderer} for §62's `"auto"` ladder.
 */

export const PACKAGE_NAME = "@fourjs/render-canvas";

export type {
  Canvas2dContextLike,
  Canvas2dImageLike,
  Canvas2dRendererOptions,
  Canvas2dSurface,
} from "./canvas2d-renderer.js";
export { Canvas2dRenderer, cssColor } from "./canvas2d-renderer.js";
export type { PixelRect, ProjectedPoint } from "./project.js";
export { canvasTop, projectPoint, resolveViewRect } from "./project.js";
export { isCanvas2dSupported, registerCanvasRenderer } from "./register.js";
