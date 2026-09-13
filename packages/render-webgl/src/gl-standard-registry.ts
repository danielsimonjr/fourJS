/**
 * The standard pipeline's registration slot (§59, §62; 2026-09-11) — the
 * lazily-filled module `let` that keeps §59's metallic-roughness program and
 * its GLSL out of every bundle that never draws a `StandardMaterial`.
 *
 * The seventh application of the seam `gl-skinning-registry.ts` states in
 * full (pipeline-cost law, R-6): `WebglRenderer` imports **this** module —
 * one `let` and three functions — and never `gl-standard.ts`; an application
 * opts in with
 *
 * ```ts
 * import { registerStandardPipeline } from "@fourjs/render-webgl";
 * registerStandardPipeline();
 * ```
 *
 * which is what links the heavy module. The renderer resolves this slot on
 * the first `"standard"` item of a frame; a `null` answer skips the draw with
 * a one-time §85 development warning naming the fix — absence, never a
 * Lambert stand-in, because a value must not become a different picture.
 * `StandardMaterial` is a core §57 family; moving it behind a seam was an
 * owner decision (2026-09-11), taken once the three sibling seams had
 * measured what an eager pipeline costs every bundle.
 */

import type { Matrix4 } from "@fourjs/math";
import type { SceneLights } from "@fourjs/render";

import type { WebglContext } from "./gl-program.js";

/**
 * The surface the renderer's draw loop needs from §59's program —
 * `StandardProgram`'s contract, structural so the renderer never names the
 * class that implements it.
 */
export interface StandardPipeline {
  /** Makes this the current program. */
  use(): void;
  /** Uploads `projection * view`, once per viewport. */
  setViewProjection(matrix: Matrix4): void;
  /** Uploads one render item's world matrix. */
  setModel(matrix: Matrix4): void;
  /** Uploads the base colour, scaled by its opacity. */
  setBaseColor(
    color: readonly [number, number, number, number],
    opacity?: number,
  ): void;
  /** Uploads metalness, roughness and the emissive term. */
  setSurface(
    metalness: number,
    roughness: number,
    emissive: readonly [number, number, number],
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
  /** Uploads the eye position the specular lobe needs. */
  setCameraPosition(x: number, y: number, z: number): void;
  /** Selects the albedo, metal-roughness and emissive map switches. */
  setFeatures(
    useMap: boolean,
    useMetalRoughnessMap?: boolean,
    useEmissiveMap?: boolean,
  ): void;
  /** Deletes the program. Live context only; idempotent. */
  dispose(): void;
}

/**
 * What `registerStandardPipeline()` installs: a factory the renderer calls
 * **once per context, on the first `"standard"` item** — never at
 * initialize, so a scene with no `StandardMaterial` issues the byte-identical
 * GL sequence it always did, and never per frame.
 */
export interface StandardPipelineFactory {
  /**
   * Compiles the program on `gl`. May throw `SHADER_COMPILATION_FAILED`
   * (§89); the renderer catches it — §61 forbids a frame from throwing —
   * warns once, and draws no standard surface on that context.
   */
  create(gl: WebglContext): StandardPipeline;
}

/** The slot. `null` until `registerStandardPipeline()` fills it. */
let standardFactory: StandardPipelineFactory | null = null;

/**
 * Installs `factory` as the process's standard pipeline. Called by
 * `registerStandardPipeline()` (`gl-standard.ts`); replaces any previous
 * factory — renderers that already compiled keep their program.
 */
export function setStandardPipelineFactory(
  factory: StandardPipelineFactory,
): void {
  standardFactory = factory;
}

/**
 * The registered factory, or `null` — read by `WebglRenderer` on the first
 * `"standard"` item it meets. One function call; no allocation.
 */
export function resolveStandardPipelineFactory(): StandardPipelineFactory | null {
  return standardFactory;
}

/**
 * Empties the slot — for tests that must exercise the unregistered path after
 * another suite registered (the `clearRegisteredSkinningPipeline` precedent).
 * Not an application API.
 */
export function clearRegisteredStandardPipeline(): void {
  standardFactory = null;
}
