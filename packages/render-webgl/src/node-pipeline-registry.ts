/**
 * The node-material pipeline's registration slot (§60, §62; RFC 0001, gap
 * R-14) — the lazily-filled module `let` that keeps the GLSL emitter and the
 * program cache out of every bundle that never draws a node material.
 *
 * ## Why a registry slot, and why this module is nearly empty
 *
 * The pipeline-cost law (R-6; measured again by R-13, R-18 and RFC 0003):
 * anything `WebglRenderer` reaches statically rides in **every** bundle that
 * carries the class, at 0.75–1.9 kB gzip per compiled-at-init pipeline,
 * because nothing reachable from a class method tree-shakes. A GLSL emitter
 * is the largest module this backend has ever grown, so it lives in
 * `gl-node-program.ts`, which the renderer **never imports** — it imports
 * this module, whose whole content is one `let` and three functions. An
 * application opts in with
 *
 * ```ts
 * import { registerNodeMaterialPipeline } from "@fourjs/render-webgl";
 * registerNodeMaterialPipeline();
 * ```
 *
 * which is what links the heavy module — the same shape as the §62 renderer
 * registry, the §37 solver registry, and RFC 0003's skinning slot, and the
 * move A-3 recorded as the rule: *a lazily-created module `let` only helps
 * when the thing that needs the feature is a module, not a value.* Here it is
 * a module.
 *
 * Even registration compiles nothing: the factory creates a **cache**, and a
 * program is compiled per distinct graph on the first draw (or §70 graph
 * effect) that needs it — never at initialize, so a scene with no node
 * material issues the byte-identical GL sequence it always did (RFC 0001's
 * acceptance gate, the F13 method).
 *
 * ## An unregistered node material is skipped, not drawn flat
 *
 * `WebglRenderer` resolves this slot on the first `"node"` item of a frame; a
 * `null` answer skips the draw with a one-time §85 development warning naming
 * the fix. Drawing flat instead was rejected by RFC 0001 §4: a graph the
 * author wrote is a specific picture, and drawing an unrelated one is R-6's
 * "a JSON value must not become a different picture" in the material domain.
 */

import type { Matrix4 } from "@fourjs/math";
import type { NodeRenderItem, SceneLights, ShaderGraph } from "@fourjs/render";

import type { WebglContext } from "./gl-program.js";

/**
 * The first texture unit a `"surface"` node program's samplers occupy: unit 0
 * is the family-wide albedo map unit and unit 1 the §69 shadow map's, and
 * both can be live in the frame a node draw shares — so node samplers start
 * above them. A `"screen"` program starts at 0: an effect draw shares its
 * envelope with neither. Declared here — not in `gl-node-program.ts` —
 * because the renderer's `finally` needs it to unbind, and importing the
 * emitter for a constant would link it into every bundle.
 */
export const NODE_SURFACE_TEXTURE_UNIT_BASE = 2;

/**
 * §57's node material as this backend reads it — taken back off the render
 * item union, so the frozen §3.1 matrix (`core, math, render`) is untouched;
 * the same move `webgl-renderer.ts` uses for `ItemMaterial`.
 */
export type NodeItemMaterial = NodeRenderItem["material"];

/**
 * One compiled node program — the surface the renderer's draw loop (and its
 * §70 graph-effect path) needs. One instance per **distinct graph structure**
 * per context; any number of materials share it.
 */
export interface NodeMaterialProgram {
  /**
   * The per-view upload stamp: the renderer compares it against its own view
   * counter and re-uploads the view-projection (and render time) only when
   * this program has not seen the current view — many materials, one program,
   * one upload per view. Owned by the renderer; initialised to `-1`.
   */
  viewStamp: number;

  /**
   * The sampler names this program binds, in reflection order (§33) — the
   * renderer resolves each through its own texture caches and binds unit
   * `unitBase + index`.
   */
  readonly textures: readonly string[];

  /**
   * The first texture unit this program's samplers occupy: 2 for a
   * `"surface"` program (0 is the albedo map's, 1 the §69 shadow map's —
   * both may be live in the same frame), 0 for a `"screen"` program (an
   * effect draw shares the frame with neither).
   */
  readonly unitBase: number;

  /**
   * Whether the graph reads the §68 light block (`"light"` nodes). The
   * renderer then collects the frame's lights and calls {@link setLights}
   * once per view.
   */
  readonly usesLights: boolean;

  /** Uploads the frame's lights and the view's eye (once per view). */
  setLights(
    lights: SceneLights,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
  ): void;

  /** Makes this the current program (and uploads sampler units, once). */
  use(): void;

  /** Uploads `projection * view` — surface programs; a no-op on screen ones. */
  setViewProjection(matrix: Matrix4): void;

  /** Uploads one item's world matrix — surface programs only. */
  setModel(matrix: Matrix4): void;

  /** Uploads §9 render time, mirrored — a no-op for a graph with no `time`. */
  setTime(seconds: number): void;

  /**
   * Uploads one material's §57 opacity and every reflected uniform value —
   * the per-draw half of RFC 0001 Q3's per-material tier.
   */
  setMaterial(material: NodeItemMaterial): void;

  /**
   * Uploads one uniform by name (the §70 graph-effect path, whose values live
   * on the pass). Unknown names are ignored — §61 forbids a frame from
   * throwing, and `validateEffectRenderPass` already refused them at setup.
   */
  setUniform(name: string, value: ArrayLike<number>): void;
}

/**
 * One renderer's node-program cache — created lazily on the renderer's first
 * node-material draw, dropped on context loss, disposed with the renderer.
 * Programs compile per distinct graph, on first use, and a graph whose
 * compile failed is latched `null` on this context (asked once, not once per
 * frame).
 */
export interface NodeMaterialPrograms {
  /** The compiled program for `graph`, compiling on first sight, or `null`. */
  acquire(graph: ShaderGraph): NodeMaterialProgram | null;

  /** Distinct programs compiled so far — the lazy-compile observable. */
  readonly programCount: number;

  /** Deletes every compiled program. Live context only; idempotent. */
  dispose(): void;
}

/**
 * What `registerNodeMaterialPipeline()` installs: a factory the renderer
 * calls **once per context, on the first node-material draw** — never at
 * initialize, and creating the cache compiles nothing.
 */
export interface NodeMaterialPipelineFactory {
  create(gl: WebglContext): NodeMaterialPrograms;
}

/** The slot. `null` until `registerNodeMaterialPipeline()` fills it. */
let nodeMaterialFactory: NodeMaterialPipelineFactory | null = null;

/**
 * Installs `factory` as the process's node-material pipeline. Called by
 * `registerNodeMaterialPipeline()` (`gl-node-program.ts`); replaces any
 * previous factory — renderers that already created their cache keep it, so
 * replacing mid-run affects only contexts that have not drawn a node
 * material yet.
 */
export function setNodeMaterialPipelineFactory(
  factory: NodeMaterialPipelineFactory,
): void {
  nodeMaterialFactory = factory;
}

/**
 * The registered factory, or `null` — read by `WebglRenderer` on the first
 * `"node"` item (or §70 graph effect) it meets. One function call; no
 * allocation.
 */
export function resolveNodeMaterialPipelineFactory(): NodeMaterialPipelineFactory | null {
  return nodeMaterialFactory;
}

/**
 * Empties the slot — for tests that must exercise the unregistered path after
 * another suite registered (the `clearRegisteredRenderers` precedent). Not an
 * application API: an application that wants node materials off simply never
 * registers.
 */
export function clearRegisteredNodeMaterialPipeline(): void {
  nodeMaterialFactory = null;
}
