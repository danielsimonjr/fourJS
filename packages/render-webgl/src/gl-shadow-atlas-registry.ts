/**
 * The shadow-atlas receiver's registration slot (§69, W6.3; wave 11, packet
 * W11.5) — the lazily-filled module `let` that keeps the cascade-select and
 * point/spot-tile GLSL out of every bundle whose scenes never need more than
 * one shadow map.
 *
 * The fifth application of the seam `gl-skinning-registry.ts` states in full:
 * `WebglRenderer` and `gl-program.ts` import **this** module (one `let`, three
 * functions) and never `gl-shadow-atlas.ts`, whose GLSL an application opts
 * into with
 *
 * ```ts
 * import { registerGlShadowAtlas } from "@fourjs/render-webgl";
 * registerGlShadowAtlas();
 * ```
 *
 * Call it **before** the renderer initializes: the shaded programs compile
 * with the chunk or without it, and a renderer remembers which. Unregistered,
 * a frame whose lights need the atlas (more than one cascade, or a shadowed
 * point/spot light) gets one development warning naming this call and
 * degrades to the pre-W6.3 single-map picture — the first cascade's map, no
 * punctual shadows.
 */

/** The GLSL the atlas path splices into the shared shadow receiver chunk. */
export interface ShadowAtlasGlsl {
  /** Uniform declarations and functions, replacing the atlas marker. */
  readonly chunk: string;
  /** The early-out inside `shadowFactor`, replacing the branch marker. */
  readonly branch: string;
}

/** The slot. `null` until `registerGlShadowAtlas()` fills it. */
let atlasGlsl: ShadowAtlasGlsl | null = null;

/** Installs the atlas GLSL. Called by `registerGlShadowAtlas()`. */
export function setShadowAtlasGlsl(glsl: ShadowAtlasGlsl): void {
  atlasGlsl = glsl;
}

/** The registered atlas GLSL, or `null`. One call; no allocation. */
export function resolveShadowAtlasGlsl(): ShadowAtlasGlsl | null {
  return atlasGlsl;
}

/** Empties the slot — for tests of the unregistered path. Not an application API. */
export function clearRegisteredShadowAtlas(): void {
  atlasGlsl = null;
}
