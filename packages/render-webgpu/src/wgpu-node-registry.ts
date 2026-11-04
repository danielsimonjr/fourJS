/**
 * The WebGPU node-material pipeline's registration slot (§60, §62; RFC 0001;
 * WP-R1.9) — the lazily-filled module `let` that keeps the WGSL emitter and
 * the node pipeline store out of every bundle that never draws a node
 * material, this backend's twin of `@fourjs/render-webgl`'s
 * `node-pipeline-registry.ts`.
 *
 * ## Why a registry slot, and why this module is nearly empty
 *
 * The pipeline-cost law (R-6, measured through RFC 0003 and RFC 0001):
 * anything `WebgpuRenderer` reaches statically rides in every bundle that
 * carries the class, because nothing reachable from a class method
 * tree-shakes. A WGSL emitter is the same class of mass the GLSL emitter was,
 * so it lives in `wgpu-node-program.ts`, which the renderer **never
 * imports** — it imports this module, whose whole content is one `let`, three
 * functions, and the interfaces the draw loop is typed against. An
 * application opts in with
 *
 * ```ts
 * import { registerWebgpuNodeMaterialPipeline } from "@fourjs/render-webgpu";
 * registerWebgpuNodeMaterialPipeline();
 * ```
 *
 * Even registration compiles nothing: the factory creates a store, and a WGSL
 * module compiles per distinct graph on the first frame that needs it —
 * never at registration and never at renderer initialize — so a scene with no
 * node material records the byte-identical device transcript it always did
 * (RFC 0001's acceptance gate, restated for this backend and pinned in
 * `tests/integration/webgpu-node-materials.test.ts`).
 *
 * ## An unregistered node material is skipped, not drawn flat
 *
 * `WebgpuRenderer` resolves this slot on the first frame carrying a `"node"`
 * item (or a §70 `"graph"` effect); a `null` answer skips those draws with a
 * one-time §85 development warning naming the fix. Drawing flat instead was
 * rejected by RFC 0001 §4: a graph the author wrote is a specific picture.
 */

import type { Matrix4 } from "@fourjs/math";
import type {
  GraphEffect,
  NodeRenderItem,
  RenderItem,
  RenderStatistics,
  SceneLights,
} from "@fourjs/render";

import type {
  GpuDevice,
  GpuRenderPassEncoder,
  GpuTextureView,
} from "./webgpu-device.js";
import type { WgpuGeometryCache } from "./wgpu-geometry.js";
import type {
  WgpuCacheableRenderTarget,
  WgpuRenderTargetCache,
} from "./wgpu-render-target.js";
import type { WgpuTextureCache } from "./wgpu-texture.js";

/**
 * §57's node material as this backend reads it — taken back off the render
 * item union, so the frozen §3.1 matrix (`core, math, render`) is untouched;
 * the GL registry's move, restated.
 */
export type WgpuNodeItemMaterial = NodeRenderItem["material"];

/**
 * The live renderer state a node pipeline store is created over — the
 * RFC 0005 picking-host precedent, one device generation narrower: WebGPU has
 * no restore (§61 — a lost device is permanent for this renderer), and the
 * renderer drops the whole store on loss and disposal, so the store may
 * capture these objects rather than re-reading them through accessors.
 */
export interface WgpuNodePipelineHost {
  /** The device every allocation and submission goes through. */
  readonly device: GpuDevice;
  /** The renderer's geometry cache — node draws share its uploads. */
  readonly geometries: WgpuGeometryCache;
  /** The renderer's texture cache — `texture` nodes resolve through it. */
  readonly textures: WgpuTextureCache;
  /** The renderer's target cache — sampled targets and §70 sources resolve here. */
  readonly renderTargets: WgpuRenderTargetCache;
}

/**
 * The per-draw frame state a node draw reads — **a pooled, mutable record**
 * the renderer rewrites per draw (plan D7: the frame loop allocates nothing);
 * the store must read it during the call and never retain it.
 */
export interface WgpuNodeFrameState {
  /** The current view's `projection × view` (§47). */
  viewProjection: Matrix4;
  /** §9 render time in seconds (`WebgpuRenderer.renderTime`). */
  renderTime: number;
  /** The frame's colour-attachment format (`#frameFormat`). */
  colorFormat: string;
  /** The frame's depth-attachment format, or `null` (WP-R1.6). */
  depthFormat: string | null;
  /** Whether the frame's depth attachment carries §67's stencil planes. */
  frameStencil: boolean;
  /** The pass's mirrored stencil reference; `draw` returns the new value. */
  stencilReference: number;
  /** The R-4 feedback identity: the target this frame draws into, or `null`. */
  activeTarget: WgpuCacheableRenderTarget | null;
  /** §84's counters, or `null` to count nothing. */
  statistics: RenderStatistics | null;
  /**
   * The frame's collected §68 lights, read by graphs using the `"lights"`
   * family; `null` when the renderer collected none (the members read zero).
   */
  lights: SceneLights | null;
  /** The current view's eye position (world space), for `cameraPosition`. */
  eyeX: number;
  eyeY: number;
  eyeZ: number;
}

/**
 * One renderer's node pipeline store (§60; WP-R1.9) — created lazily on the
 * first frame that needs it, dropped whole on device loss, disposed with the
 * renderer. WGSL modules compile per distinct graph on first sight; a graph
 * whose emission fails is latched `null` (asked once, not once per frame).
 */
export interface WgpuNodeMaterialPipelines {
  /**
   * Pre-sizes the frame (the sized-before-recording discipline): resolves —
   * and on first sight compiles — the program of every `"node"` item in
   * `items`, and grows the store's own strided uniform buffer to hold one
   * block per node draw per view. Returns whether any node draw may record
   * this frame. Runs **material accessors** (`material.graph`), so the
   * renderer re-checks its own disposal after calling it.
   */
  beginFrame(items: readonly RenderItem[], viewCount: number): boolean;

  /**
   * Records one surface node draw into the frame's pass, or skips it on the
   * frame's §61 terms (unresolvable texture, missing vertex stream, latched
   * graph). Returns the stencil reference now in effect.
   */
  draw(
    pass: GpuRenderPassEncoder,
    item: NodeRenderItem,
    frame: WgpuNodeFrameState,
  ): number;

  /**
   * Uploads the frame's packed node uniform blocks — one `writeBuffer`,
   * beside the renderer's own, before the submit that reads them (queue
   * order). A frame that recorded no node draw uploads nothing.
   */
  endFrame(): void;

  /**
   * Draws one §70 `"graph"` effect (RFC 0001) in its own pass and encoder —
   * the WGSL twin of GL's `#renderGraphEffect`, bound by `renderEffect`'s
   * contract: everything that will not resolve skips the effect before
   * anything is recorded, and `colorView` is called only once the draw is
   * certain (an on-screen destination's `getCurrentTexture` must not be
   * acquired for an effect that then skips).
   */
  renderGraphEffect(
    effect: GraphEffect,
    source: WgpuCacheableRenderTarget,
    destination: WgpuCacheableRenderTarget | null,
    colorFormat: string,
    colorView: () => GpuTextureView,
    renderTime: number,
    statistics: RenderStatistics | null,
  ): void;

  /** Distinct WGSL node modules compiled so far — the lazy-compile observable. */
  readonly programCount: number;

  /**
   * Drops every reference **without destroying anything** — the device-loss
   * path (§61): the allocations belong to a device that no longer exists.
   * Terminal, like {@link WgpuNodeMaterialPipelines.dispose}.
   */
  forget(): void;

  /** Destroys the store's buffers and drops everything else (§83). Idempotent. */
  dispose(): void;
}

/**
 * What `registerWebgpuNodeMaterialPipeline()` installs: a factory the
 * renderer calls **once per device, on the first frame that meets a node
 * material or a graph effect** — never at initialize, and creating the store
 * allocates nothing.
 */
export interface WgpuNodeMaterialPipelineFactory {
  create(host: WgpuNodePipelineHost): WgpuNodeMaterialPipelines;
}

/** The slot. `null` until `registerWebgpuNodeMaterialPipeline()` fills it. */
let nodeMaterialFactory: WgpuNodeMaterialPipelineFactory | null = null;

/**
 * Installs `factory` as the process's WebGPU node-material pipeline. Called
 * by `registerWebgpuNodeMaterialPipeline()` (`wgpu-node-program.ts`);
 * replaces any previous factory — renderers that already created their store
 * keep it, so replacing mid-run affects only devices that have not met a node
 * material yet.
 */
export function setWebgpuNodeMaterialPipelineFactory(
  factory: WgpuNodeMaterialPipelineFactory,
): void {
  nodeMaterialFactory = factory;
}

/**
 * The registered factory, or `null` — read by `WebgpuRenderer` on the first
 * frame that carries a `"node"` item or a `"graph"` effect. One function
 * call; no allocation.
 */
export function resolveWebgpuNodeMaterialPipelineFactory(): WgpuNodeMaterialPipelineFactory | null {
  return nodeMaterialFactory;
}

/**
 * Empties the slot — for tests that must exercise the unregistered path after
 * another suite registered (the `clearRegisteredRenderers` precedent). Not an
 * application API: an application that wants node materials off simply never
 * registers.
 */
export function clearRegisteredWebgpuNodeMaterialPipeline(): void {
  nodeMaterialFactory = null;
}
