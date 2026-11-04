/**
 * The 2..4-target morph programs' registration slot (§54, RFC 0003 WP-SK.4;
 * wave 11, packet W11.5): the vertex-shader generators for multi-target
 * morphing live in `gl-morph-targets.ts`, which `WebglRenderer` never imports.
 * An application with a mesh that carries `extraMorphTargets` opts in with
 *
 * ```ts
 * import { registerGlMorphTargets } from "@fourjs/render-webgl";
 * registerGlMorphTargets();
 * ```
 *
 * The one-target morph pair stays in the renderer. A geometry with extra
 * targets and no registration draws as its **one-target** morph (first target
 * only, `morphWeights[0]`) with one development warning naming the call —
 * the pre-multi-target picture, not a skipped draw.
 */

/** Vertex-source generators for `count` in `2..4`. */
export interface MorphVertexSources {
  /** The unlit N-target vertex shader. */
  unlit(count: number): string;
  /** The lit N-target vertex shader. */
  lit(count: number): string;
}

let morphSources: MorphVertexSources | null = null;

/** Installs the generators. Called by `registerGlMorphTargets()`. */
export function setMorphSources(sources: MorphVertexSources): void {
  morphSources = sources;
}

/** The registered generators, or `null`. */
export function resolveMorphSources(): MorphVertexSources | null {
  return morphSources;
}

/** Empties the slot — for tests of the unregistered path. Not an application API. */
export function clearRegisteredMorphTargets(): void {
  morphSources = null;
}
