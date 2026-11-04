/**
 * This backend's opt-in to §62's renderer registry — see
 * `@fourjs/render-webgl`'s `register.ts` for the full argument. In short: a
 * function call, not an import side effect, because `"sideEffects": false`
 * entitles a bundler to delete the latter.
 *
 * ```ts
 * registerCanvasRenderer();
 * const app = new Application({ renderer: "auto", canvas });
 * ```
 */

import {
  registerRenderer,
  type RendererOptions,
  type RendererRegistry,
} from "@fourjs/render";

import { Canvas2dRenderer } from "./canvas2d-renderer.js";

/**
 * Whether this environment could run Canvas 2D at all: the presence of a
 * `CanvasRenderingContext2D` global. Deliberately does not touch the canvas —
 * a canvas hands out one context type, and `getContext("2d")` here would
 * commit it before the real choice.
 */
export function isCanvas2dSupported(options?: RendererOptions): boolean {
  void options;
  return (
    typeof (globalThis as Record<string, unknown>)[
      "CanvasRenderingContext2D"
    ] === "function"
  );
}

/**
 * Registers the Canvas 2D backend so `renderer: "auto"` and
 * `renderer: "canvas2d"` can find it (§62), returning the registry used.
 *
 * @throws FourError `RENDERER_INITIALIZATION_FAILED` if `"canvas2d"` is
 * already registered in that registry.
 */
export function registerCanvasRenderer(
  registry?: RendererRegistry,
): RendererRegistry {
  return registerRenderer(
    {
      backend: "canvas2d",
      isSupported: isCanvas2dSupported,
      create: () => new Canvas2dRenderer(),
    },
    registry,
  );
}
