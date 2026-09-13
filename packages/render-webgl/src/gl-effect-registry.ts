/**
 * The effect pipeline's registration slot (§70, §62; 2026-09-11) — the
 * lazily-filled module `let` that keeps the full-screen effect program and
 * its two shaders out of every bundle that never runs a `RenderGraph` effect
 * pass.
 *
 * The fifth application of the seam `gl-skinning-registry.ts` states in full
 * (pipeline-cost law, R-6): `WebglRenderer` imports **this** module — one
 * `let` and three functions — and never `gl-effect.ts`; an application opts
 * in with
 *
 * ```ts
 * import { registerEffectPipeline } from "@fourjs/render-webgl";
 * registerEffectPipeline();
 * ```
 *
 * which is what links the heavy module. `WebglRenderer.renderEffect` resolves
 * this slot on its first fixed effect (copy, grade, output transform); a
 * `null` answer skips the pass with a one-time §85 development warning naming
 * the fix — never a silent copy, because a value must not become a different
 * picture. §60's graph effects do not go through this slot at all: they draw
 * through `registerNodeMaterialPipeline()`'s programs.
 */

import type { WebglContext } from "./gl-program.js";

/**
 * The texture unit an effect samples its source from.
 *
 * Unit 0, like every other pipeline in this tier — an effect binds exactly one
 * texture, and §77's multi-texture materials are what will need a unit
 * allocator. Naming it keeps the `activeTexture` call in `webgl-renderer.ts`
 * and the sampler upload in `gl-effect.ts` from drifting apart.
 */
export const EFFECT_TEXTURE_UNIT = 0;

/** Vertices in the full-screen triangle; see `gl-effect.ts`'s header. */
export const EFFECT_VERTEX_COUNT = 3;

/**
 * The surface `renderEffect` needs from the full-screen program —
 * `EffectProgram`'s contract, structural so the renderer never names the
 * class that implements it.
 */
export interface EffectPipeline {
  /** Makes this the current program. */
  use(): void;
  /** Points the `source` sampler at texture `unit`, once per lifetime. */
  setSampler(unit: number): void;
  /** Selects §70's bit-exact copy. */
  setCopy(): void;
  /** Selects §60a's sRGB output transform. */
  setOutputTransform(): void;
  /** Selects §70's colour grade with `ColorGradeEffect`'s three coefficients. */
  setGrade(exposure: number, contrast: number, saturation: number): void;
  /** Deletes the program. Live context only; idempotent. */
  dispose(): void;
}

/**
 * What `registerEffectPipeline()` installs: a factory the renderer calls
 * **once per context, on the first fixed effect pass** — never at
 * initialize, so an application that never runs an effect issues the
 * byte-identical GL sequence it always did.
 */
export interface EffectPipelineFactory {
  /**
   * Compiles the effect program on `gl`. May throw
   * `SHADER_COMPILATION_FAILED` (§89); the renderer catches it — §61 forbids
   * a frame from throwing — warns once, and skips effects on that context.
   */
  create(gl: WebglContext): EffectPipeline;
}

/** The slot. `null` until `registerEffectPipeline()` fills it. */
let effectFactory: EffectPipelineFactory | null = null;

/**
 * Installs `factory` as the process's effect pipeline. Called by
 * `registerEffectPipeline()` (`gl-effect.ts`); replaces any previous factory
 * — renderers that already compiled keep their program.
 */
export function setEffectPipelineFactory(factory: EffectPipelineFactory): void {
  effectFactory = factory;
}

/**
 * The registered factory, or `null` — read by `WebglRenderer.renderEffect`
 * on its first fixed effect. One function call; no allocation.
 */
export function resolveEffectPipelineFactory(): EffectPipelineFactory | null {
  return effectFactory;
}

/**
 * Empties the slot — for tests that must exercise the unregistered path after
 * another suite registered (the `clearRegisteredSkinningPipeline` precedent).
 * Not an application API: an application that runs no effects simply never
 * registers.
 */
export function clearRegisteredEffectPipeline(): void {
  effectFactory = null;
}
