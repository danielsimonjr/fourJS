/**
 * The skinning pipeline's registration slot (§54, §62; RFC 0003, 2026-08-28)
 * — the lazily-filled module `let` that keeps two compiled programs and a
 * palette uploader out of every bundle that never skins.
 *
 * ## Why a registry slot, and why this module is nearly empty
 *
 * The pipeline-cost law (R-6, measured again by R-13 and R-18): anything
 * `WebglRenderer` reaches statically rides in **every** bundle that carries
 * the class, at 0.75–1.9 kB gzip per compiled-at-init pipeline, because
 * nothing reachable from a class method tree-shakes. Two skinned programs plus
 * their GLSL are more than that, so they live in `gl-skinning.ts`, which the
 * renderer **never imports** — it imports this module, whose whole content is
 * one `let` and three functions. An application opts in with
 *
 * ```ts
 * import { registerSkinningPipeline } from "@fourjs/render-webgl";
 * registerSkinningPipeline();
 * ```
 *
 * which is what links the heavy module — the same shape as the §62 renderer
 * registry and the §37 solver registry, and the move A-3 recorded as the rule:
 * *a lazily-created module `let` only helps when the thing that needs the
 * feature is a module, not a value.* Here it is a module.
 *
 * ## An unregistered skinned draw is skipped, not drawn in bind pose
 *
 * `WebglRenderer` resolves this slot on the first skinned item of a frame; a
 * `null` answer skips the draw with a one-time §85 development warning naming
 * the fix. Drawing the bind pose instead was rejected by RFC 0003 §5: a
 * character standing in T-pose is a different picture, and the recorded rule
 * is that a value must not become one.
 */

import type { Matrix4 } from "@fourjs/math";
import type { SceneLights } from "@fourjs/render";

import type { WebglContext } from "./gl-program.js";

/**
 * The surface the renderer's draw loop needs from the skinned **unlit**
 * program — `UnlitProgram`'s contract plus the palette upload. Structural, so
 * the renderer never names the class that implements it.
 */
export interface SkinnedUnlitPipeline {
  /** Makes this the current program. */
  use(): void;
  /** Uploads `projection * view`, once per viewport. */
  setViewProjection(matrix: Matrix4): void;
  /** Uploads one render item's world matrix. */
  setModel(matrix: Matrix4): void;
  /** Uploads the material colour, scaled by its opacity. */
  setColor(
    color: readonly [number, number, number, number],
    opacity?: number,
  ): void;
  /** Selects the map and vertex-colour multipliers, mirrored on change. */
  setFeatures(useMap: boolean, useVertexColors: boolean): void;
  /**
   * Uploads the item's joint palette — 16 floats per joint (§54). On the
   * bone-texture pair this stages and `texSubImage2D`s the palette texture
   * instead (`skin-palette.ts`).
   */
  setJointMatrices(palette: Float32Array): void;
}

/**
 * The surface the renderer's draw loop needs from the skinned **lit** program
 * — `LitProgram`'s contract plus the palette upload.
 */
export interface SkinnedLitPipeline {
  use(): void;
  setViewProjection(matrix: Matrix4): void;
  setModel(matrix: Matrix4): void;
  setColor(
    color: readonly [number, number, number, number],
    opacity?: number,
  ): void;
  /** Uploads the scene ambient term (§68). */
  setAmbientLight(color: readonly [number, number, number]): void;
  /** Uploads the directional light (§68). */
  setDirectionalLight(
    direction: { readonly x: number; readonly y: number; readonly z: number },
    color: readonly [number, number, number],
  ): void;
  /** Uploads the frame's point and spot lights, or nothing (§68, R-17). */
  setPunctualLights(lights: SceneLights): void;
  /** Uploads the frame's hemisphere, or nothing (§68). */
  setHemisphereLight(lights: SceneLights): void;
  /** Uploads the frame's shadow state, or nothing (§69, R-18). */
  setShadow(lights: SceneLights): void;
  /** Switches the shadow comparison per draw (§49's `receiveShadow`). */
  setReceivesShadow(receiving: boolean): void;
  /** Selects whether this draw samples the bound albedo texture. */
  setFeatures(useMap: boolean): void;
  setJointMatrices(palette: Float32Array): void;
}

/**
 * The surface the §69 caster pass needs from the skinned **depth-only**
 * program — `ShadowProgram`'s two matrix uploads plus the palette. Structural,
 * so the renderer (and `gl-shadow.ts`) never names the class or the skinning
 * GLSL; those live behind `registerSkinningPipeline`.
 */
export interface SkinnedShadowPipeline {
  /** Makes this the current program. */
  use(): void;
  /** Uploads the light's shadow view-projection, once per shadow pass. */
  setViewProjection(matrix: Matrix4): void;
  /** Uploads one caster's world matrix. */
  setModel(matrix: Matrix4): void;
  /** Uploads the item's joint palette — 16 floats per joint (§54). */
  setJointMatrices(palette: Float32Array): void;
}

/**
 * One renderer's compiled skinned programs — created lazily on the first
 * skinned colour draw, dropped on context loss, disposed with the renderer.
 *
 * The depth-only caster is **not** compiled with the colour pair: a skinned
 * mesh that never casts must not add a third `createProgram`. The renderer
 * asks through {@link SkinnedPrograms.acquireShadow} on the first skinned
 * caster instead.
 */
export interface SkinnedPrograms {
  readonly unlit: SkinnedUnlitPipeline;
  readonly lit: SkinnedLitPipeline;
  /**
   * Compiles the skinned caster on first call and returns it. Subsequent
   * calls reuse the compiled program. May throw `SHADER_COMPILATION_FAILED`
   * (§89) on the first failure; the renderer catches it — §61 forbids a
   * frame from throwing — and skips skinned casters on that context. A
   * later call after a failure must not retry the compile (a `failProgramAt`
   * driver would otherwise succeed on the next index).
   */
  acquireShadow(): SkinnedShadowPipeline;
  /** Deletes the colour pair and, if compiled, the caster. Live context only; idempotent. */
  dispose(): void;
}

/**
 * What `registerSkinningPipeline()` installs: a factory the renderer calls
 * **once per context, on the first skinned draw** — never at initialize, so a
 * scene with no skinned mesh issues the byte-identical GL sequence it always
 * did (the RFC's acceptance gate), and never per frame.
 *
 * `create` compiles the **colour** pair only (unlit + lit). The caster is
 * compiled later, from the returned pair, if a skinned mesh actually casts.
 */
export interface SkinningPipelineFactory {
  /**
   * Compiles the two skinned colour programs on `gl`. May throw
   * `SHADER_COMPILATION_FAILED` (§89); the renderer catches it — §61 forbids a
   * frame from throwing — warns once, and skins nothing on that context.
   *
   * `palette` selects the uniform palette (default, 48 joints) or the
   * bone-texture palette (`"texture"`, `skin-palette.ts`); the two are
   * distinct programs, so their keys never alias. The texture pair's
   * `acquireShadow()` is not used by the renderer (casters take the uniform
   * pair).
   */
  create(gl: WebglContext, palette?: "uniform" | "texture"): SkinnedPrograms;
}

/** The slot. `null` until `registerSkinningPipeline()` fills it. */
let skinningFactory: SkinningPipelineFactory | null = null;

/**
 * Installs `factory` as the process's skinning pipeline. Called by
 * `registerSkinningPipeline()` (`gl-skinning.ts`); replaces any previous
 * factory — renderers that already compiled keep their programs, so replacing
 * mid-run affects only contexts that have not skinned yet.
 */
export function setSkinningPipelineFactory(
  factory: SkinningPipelineFactory,
): void {
  skinningFactory = factory;
}

/**
 * The registered factory, or `null` — read by `WebglRenderer` on the first
 * skinned item it meets. One function call; no allocation.
 */
export function resolveSkinningPipelineFactory(): SkinningPipelineFactory | null {
  return skinningFactory;
}

/**
 * Empties the slot — for tests that must exercise the unregistered path after
 * another suite registered (the `clearRegisteredRenderers` precedent). Not an
 * application API: an application that wants skinning off simply never
 * registers.
 */
export function clearRegisteredSkinningPipeline(): void {
  skinningFactory = null;
}
