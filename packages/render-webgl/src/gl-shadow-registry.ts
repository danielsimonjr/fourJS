/**
 * The shadow pipeline's registration slot (§69, §62; 2026-09-11) — the
 * lazily-filled module `let` that keeps the depth-only caster program out of
 * every bundle that never casts a shadow.
 *
 * The fourth application of the seam `gl-skinning-registry.ts` states in full
 * (pipeline-cost law, R-6): `WebglRenderer` imports **this** module — one
 * `let` and three functions — and never `gl-shadow.ts`; an application opts
 * in with
 *
 * ```ts
 * import { registerShadowPipeline } from "@fourjs/render-webgl";
 * registerShadowPipeline();
 * ```
 *
 * which is what links the heavy module. The renderer resolves this slot on
 * the first frame whose light asks for a shadow map; a `null` answer skips
 * the §69 caster pass with a one-time §85 development warning naming the fix,
 * and the frame's lit surfaces draw **unshadowed** — lights still work, the
 * map is simply absent. That is the same picture a `RenderTarget` GL would
 * not allocate already produces (`shadowActive` is `false` for both), so no
 * new failure direction is introduced.
 */

import type { Matrix4 } from "@fourjs/math";

import type { WebglContext } from "./gl-program.js";

/**
 * The surface the §69 caster pass needs from the depth-only program —
 * `ShadowProgram`'s contract, structural so the renderer never names the
 * class that implements it.
 */
export interface ShadowCasterPipeline {
  /** Makes this the current program. */
  use(): void;
  /** Uploads the light's shadow view-projection, once per shadow pass. */
  setViewProjection(matrix: Matrix4): void;
  /** Uploads one caster's world matrix. */
  setModel(matrix: Matrix4): void;
  /** Deletes the program. Live context only; idempotent. */
  dispose(): void;
}

/**
 * What `registerShadowPipeline()` installs: a factory the renderer calls
 * **once per context, on the first shadowed frame** — never at initialize,
 * so a scene that never casts issues the byte-identical GL sequence it
 * always did, and never per frame.
 */
export interface ShadowPipelineFactory {
  /**
   * Compiles the caster program on `gl`. May throw
   * `SHADER_COMPILATION_FAILED` (§89); the renderer catches it — §61 forbids
   * a frame from throwing — warns once, and skips the shadow pass on that
   * context.
   */
  create(gl: WebglContext): ShadowCasterPipeline;
}

/** The slot. `null` until `registerShadowPipeline()` fills it. */
let shadowFactory: ShadowPipelineFactory | null = null;

/**
 * Installs `factory` as the process's shadow pipeline. Called by
 * `registerShadowPipeline()` (`gl-shadow.ts`); replaces any previous factory
 * — renderers that already compiled keep their program.
 */
export function setShadowPipelineFactory(factory: ShadowPipelineFactory): void {
  shadowFactory = factory;
}

/**
 * The registered factory, or `null` — read by `WebglRenderer` on the first
 * frame that asks for a shadow map. One function call; no allocation.
 */
export function resolveShadowPipelineFactory(): ShadowPipelineFactory | null {
  return shadowFactory;
}

/**
 * Empties the slot — for tests that must exercise the unregistered path after
 * another suite registered (the `clearRegisteredSkinningPipeline` precedent).
 * Not an application API: an application that wants shadows off simply never
 * registers.
 */
export function clearRegisteredShadowPipeline(): void {
  shadowFactory = null;
}
