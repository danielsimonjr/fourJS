/**
 * This backend's opt-in to §62's renderer registry — the mirror of
 * `registerWebglRenderer` (see `@fourjs/render-webgl`'s `register.ts` for why
 * this is a function call and not an import side effect: `sideEffects: false`
 * lets a bundler delete an unused bare import).
 *
 * ```ts
 * registerSvgRenderer();
 * const renderer = await resolveRenderer("auto", { canvas: svgElement });
 * ```
 */

import {
  registerRenderer,
  type RendererOptions,
  type RendererRegistry,
} from "@fourjs/render";

import { SvgRenderer, isSvgSurface } from "./svg-renderer.js";

/**
 * Whether the SVG backend could run with `options` — the cheap pre-filter
 * `"auto"` uses. It needs an `<svg>`-shaped `options.canvas`; it never touches
 * it.
 */
export function isSvgSupported(options?: RendererOptions): boolean {
  return isSvgSurface(options?.canvas);
}

/**
 * Registers the SVG backend so `renderer: "auto"` and `renderer: "svg"` can
 * find it (§62), and returns the registry it went into. Constructed, never
 * initialized: the registry owns that call.
 *
 * @throws FourError `RENDERER_INITIALIZATION_FAILED` if an `"svg"` renderer is
 * already registered in that registry.
 */
export function registerSvgRenderer(
  registry?: RendererRegistry,
): RendererRegistry {
  return registerRenderer(
    {
      backend: "svg",
      isSupported: isSvgSupported,
      create: () => new SvgRenderer(),
    },
    registry,
  );
}
