/**
 * The WebGL 2 backend (§61, §62, §120) — the MVP's only renderer.
 *
 * §120 fixes the MVP tier as *"WebGL 2 only, one solver adapter, basic 2D/3D
 * primitives"*, and §62 lists WebGL 2 as backend 2 of 5. {@link WebglRenderer}
 * implements `@fourjs/render`'s `Renderer` for that tier and its later additions:
 * five scene pipelines (unlit, lit, standard, sprite, particles — see the class
 * documentation) plus §70's full-screen effect program, one vertex array per
 * geometry, `"negative-one-to-one"` clip depth (plan D8).
 *
 * The normative clear and viewport semantics live on `Renderer.render`'s
 * documentation in `@fourjs/render`, not here — they are shared by every backend
 * so that a test can assert them once. This module implements them; where a
 * sentence there admitted more than one reading, the reading chosen is recorded
 * below on {@link WebglRenderer.render}.
 *
 * ## No DOM types
 *
 * Nothing in this file names `HTMLCanvasElement`, `WebGL2RenderingContext`, or
 * `Event`. The canvas is described structurally by {@link WebglCanvas} and the
 * context by `WebglContext` (`gl-program.ts`), so the package type-checks and
 * unit-tests under plain Node with no `lib.dom` and no jsdom — see
 * `gl-program.ts`'s header for the full argument. A real canvas satisfies
 * {@link WebglCanvas} structurally, so a browser passes one straight in.
 *
 * ## Testability seams
 *
 * Everything below is driven through two injected objects — the canvas and the
 * context it hands back — and both are interfaces. The unit tests
 * (`tests/webgl-renderer.test.ts`) supply a hand-rolled fake context that
 * records calls, which is what lets initialization failure, cache eviction,
 * clear ordering, uniform uploads, draw calls, context loss, restore, and
 * disposal all be asserted with no GPU and no browser. Real-GL behaviour is
 * WP-3.8's Playwright test; this file's job is to make the *sequence* of GL
 * calls checkable.
 */

import { DEV, devWarnOnce, EventEmitter, FourError } from "@fourjs/core";
import { Frustum, Matrix4, type Rectangle2 } from "@fourjs/math";
import {
  MAX_SKINNING_JOINTS,
  RenderTarget,
  buildInterpolatedRenderList,
  buildRenderList,
  buildViewRenderList,
  collectSceneLights,
  createSceneLights,
  isLitItem,
  isNodeItem,
  isParticlesItem,
  isRenderTargetTexture,
  isSkinnedLitItem,
  isSkinnedUnlitItem,
  isSpriteItem,
  isStandardItem,
  intersectScissor,
  validateReadbackRegion,
  COLOR_GRADE_DEFAULTS,
  type EffectRenderPass,
  type GraphEffect,
  type PickingService,
  type RenderItem,
  type RenderItemKind,
  type RenderStatistics,
  type Renderer,
  type RendererCapabilities,
  type ScissorRect,
  type RendererEventMap,
  type RendererOptions,
  type ScreenEffectRenderer,
} from "@fourjs/render";

// Type-only, and load-bearingly so: naming `GlBatching` as a *value* here would
// link §65's batcher — and `@fourjs/render`'s planner behind it — into every
// bundle that carries this renderer, whether the application batches or not
// (see `WebglRenderer.batching` and `gl-batch.ts`'s header). The context this
// backend narrows to (`ParticleGlContext`) already satisfies the batcher's own
// `BatchGlContext` structurally, so no second narrowing is needed either.
import type { RenderBatching } from "./gl-batch.js";
import {
  EFFECT_TEXTURE_UNIT,
  EFFECT_VERTEX_COUNT,
  resolveEffectPipelineFactory,
  type EffectPipeline,
} from "./gl-effect-registry.js";
import { GeometryCache } from "./gl-geometry.js";
import { GlGpuTimer, hasDisjointTimerQuery } from "./gl-gpu-timer.js";
// §36's particle pipeline (2026-09-11), §70's effect pipeline and §69's
// shadow pipeline are reached through their registry slots only — the
// skinning seam's rule (`gl-skinning-registry.ts`): the heavy modules link
// when the application calls `register…Pipeline()`, never through this class.
// `ParticleGlContext` is a type import and links nothing.
import {
  particleItemFloats,
  resolveParticlePipelineFactory,
  type ParticleAppearancePipeline,
  type ParticleBillboardPipeline,
  type ParticlePrograms,
} from "./gl-particles-registry.js";
import type { ParticleGlContext } from "./gl-particles.js";
import {
  GL,
  LitProgram,
  EMISSIVE_TEXTURE_UNIT,
  MAP_TEXTURE_UNIT,
  METAL_ROUGHNESS_TEXTURE_UNIT,
  SHADOW_TEXTURE_UNIT,
  SpriteProgram,
  UnlitProgram,
  type GlTexture,
} from "./gl-program.js";
import {
  resolvePickingServiceFactory,
  type PickingRendererHost,
} from "./gl-picking-registry.js";
import {
  RenderTargetCache,
  type RenderTargetRecord,
} from "./gl-render-target.js";
import {
  resolveSkinningPipelineFactory,
  type SkinnedPrograms,
  type SkinnedShadowPipeline,
} from "./gl-skinning-registry.js";
import {
  NODE_SURFACE_TEXTURE_UNIT_BASE,
  resolveNodeMaterialPipelineFactory,
  type NodeMaterialProgram,
  type NodeMaterialPrograms,
} from "./node-pipeline-registry.js";
import {
  NORMAL_TEXTURE_UNIT,
  OCCLUSION_TEXTURE_UNIT,
} from "./gl-standard.js";
import {
  resolveShadowPipelineFactory,
  type ShadowCasterPipeline,
} from "./gl-shadow-registry.js";
import {
  resolveStandardPipelineFactory,
  type StandardPipeline,
} from "./gl-standard-registry.js";
import { TextureCache, type CacheableTexture } from "./gl-texture.js";

/**
 * The subtree root {@link WebglRenderer.render} draws, and the viewports it
 * draws it into — read off the `Renderer` interface instead of imported from
 * `@fourjs/scene`.
 *
 * `@fourjs/render-webgl` depends on `core`, `math`, and `render` only (plan §3.1,
 * frozen). `Parameters<Renderer["render"]>` yields exactly the `Node` and
 * `Viewport` types the interface declares, with no new edge in the dependency
 * matrix and no chance of drifting from the interface being implemented
 * (decision, WP-3.5).
 */
type RenderRoot = Parameters<Renderer["render"]>[0];

/** One viewport, derived as {@link RenderRoot} is. */
type RenderView = Parameters<Renderer["render"]>[1][number];

/**
 * The §43 interpolation record, derived as {@link RenderRoot} is — the pose
 * buffer it carries is `@fourjs/scene`'s, named here only through the interface
 * this class implements, so the frozen dependency matrix is untouched.
 */
type RenderInterpolationArgument = NonNullable<
  Parameters<Renderer["render"]>[2]
>;

/**
 * The off-screen surface `render` draws into when it is given one (§61, §48;
 * R-4), derived from the interface as {@link RenderRoot} is.
 *
 * `@fourjs/render`'s `RenderTarget` — a *type* import through the interface, so
 * this file still names nothing outside the frozen matrix. `gl-render-target.ts`
 * imports the class by name for a reason written out there.
 */
type RenderTargetArgument = NonNullable<Parameters<Renderer["render"]>[3]>;

/**
 * The minimum a DOM event has to offer this backend: a way to stop the default
 * handling of `webglcontextlost`.
 *
 * Calling `preventDefault()` on that event is what makes the browser *promise*
 * to fire `webglcontextrestored`. Without it the context never comes back, and
 * §61's restore half of the contract becomes unimplementable.
 */
export interface WebglContextEventLike {
  preventDefault(): void;
}

/**
 * The drawing surface, described by what this backend actually touches (§61's
 * `RendererOptions.canvas` is `unknown` precisely so each backend can narrow it
 * here).
 *
 * `HTMLCanvasElement` and `OffscreenCanvas`-plus-an-event-target both satisfy
 * this structurally. The narrowing is done at runtime by
 * {@link WebglRenderer.initialize}, which is why the interface exists as a
 * *target* for a checked cast rather than as a parameter type.
 */
export interface WebglCanvas {
  /** Drawing-buffer width in device pixels. Written by `resize`. */
  width: number;

  /** Drawing-buffer height in device pixels. Written by `resize`. */
  height: number;

  /**
   * Acquires a rendering context. Typed to return `unknown` because this
   * package does not name `WebGL2RenderingContext`; the result is validated
   * structurally before use.
   */
  getContext(contextId: "webgl2", attributes?: WebglContextAttributes): unknown;

  addEventListener(
    type: string,
    listener: (event: WebglContextEventLike) => void,
  ): void;

  removeEventListener(
    type: string,
    listener: (event: WebglContextEventLike) => void,
  ): void;
}

/**
 * Context attributes this backend requests (a subset of WebGL's
 * `WebGLContextAttributes`).
 *
 * Only the four that the MVP has an opinion about are named; everything else is
 * left at the browser's default, because requesting a value the engine does not
 * use is how a backend ends up with a framebuffer nobody asked for.
 */
export interface WebglContextAttributes {
  /** Alpha in the drawing buffer, so a canvas can composite with the page. */
  alpha?: boolean;
  /** Multisampling; driven by `RendererOptions.antialias` (§45). */
  antialias?: boolean;
  /** A depth buffer — required, since every view clears and tests depth (§61). */
  depth?: boolean;
  /**
   * Stencil bits for §67's masks and clips, driven by
   * `RendererOptions.stencil` (R-7; consumed by R-23's node-level clips).
   * `false` unless asked — the attribute every renderer built before R-7 got.
   */
  stencil?: boolean;
}

/** Error code for use-after-dispose, mirroring `NullRenderer` (§45, §83, §89). */
const LIFECYCLE_ERROR_CODE = "INVALID_APPLICATION_STATE";

/**
 * Methods a candidate context must have before this backend will believe it is
 * a WebGL 2 context.
 *
 * `createVertexArray` is the discriminating one: it exists on WebGL 2 and not
 * on WebGL 1, so a page that fell back to `"webgl"` — or a stub that implements
 * half the surface — is rejected with `RENDERER_INITIALIZATION_FAILED` rather
 * than crashing on the first draw.
 */
const REQUIRED_CONTEXT_METHODS = [
  "createVertexArray",
  "bindVertexArray",
  "createBuffer",
  "createProgram",
  "useProgram",
  "drawArrays",
  "drawElements",
  "isContextLost",
  // The particle pipeline's three (WP-9.3). All core WebGL 2 — the two
  // instancing entry points WebGL 1 needed `ANGLE_instanced_arrays` for, plus
  // `bufferSubData` — so a context that lacks them is not a WebGL 2 context,
  // and this check is the one place that has to notice. See `gl-particles.ts`
  // for why they are declared as an extension of `WebglContext` rather than in
  // it.
  "bufferSubData",
  "vertexAttribDivisor",
  "drawArraysInstanced",
  // The standard pipeline's one (§59, R-13, 2026-08-08): `metalness` and
  // `roughness` are scalars. Core WebGL 1 and 2, so it discriminates nothing —
  // listed for the same fail-fast courtesy as `uniform3fv` below.
  "uniform1f",
  // The lit pipeline's one (§68, 2026-08-04): its light uniforms are vec3s.
  // Core WebGL 1 *and* 2, so it discriminates nothing — it is here so an
  // incomplete stub fails fast at initialize rather than at the first lit
  // draw, the same courtesy the check extends to every other entry point the
  // backend cannot draw without.
  "uniform3fv",
  // The lit/standard normal-matrix hoist (2026-09-09): `uniform mat3`. Core
  // WebGL 1 and 2, listed so an incomplete stub fails at initialize rather
  // than at the first shaded `setModel`.
  "uniformMatrix3fv",
  // The render-target path's five (R-4, 2026-08-07). Core WebGL 1 and 2 too,
  // so they discriminate nothing either; they are checked for the same reason
  // as `uniform3fv` — a stub that cannot allocate a framebuffer should say so
  // at `initialize`, not on the first off-screen pass, which may be minutes
  // into a session. `createRenderbuffer` and friends are not listed
  // individually: no context implements half of `gl-render-target.ts`'s set,
  // and a check per entry point would cost a loop iteration per initialize for
  // a case that does not exist. See `gl-render-target.ts`.
  "createFramebuffer",
  "bindFramebuffer",
  "framebufferTexture2D",
  "checkFramebufferStatus",
  "createRenderbuffer",
] as const;

/**
 * The render list, module-owned and reused across frames and renderers.
 *
 * `buildRenderList` pools its items per `out` array (§64, plan D7), so one
 * array here means one pool and zero steady-state allocation. Sharing it
 * between two `WebglRenderer` instances is safe because
 * {@link WebglRenderer.render} builds the list and consumes every item
 * synchronously before returning — no item ever outlives the call that produced
 * it. Two *simultaneously live* lists would need two arrays, which is why
 * `@fourjs/render` keys its pools on the array rather than on a module global.
 */
const renderList: RenderItem[] = [];

/**
 * The **current view's** draws, derived from {@link renderList} once per view
 * (§64 stages 2–3; R-8, 2026-08-09).
 *
 * One array for every view of every frame, and safe for a sharper reason than
 * {@link renderList}'s: views are drawn strictly one after another, so a view's
 * list is dead before the next view's is built. It holds *references* to the
 * frame list's pooled items — `buildViewRenderList` copies nothing — so this
 * array costs one pointer per surviving item and allocates nothing once it has
 * grown to the largest view the application draws.
 *
 * Deliberately **not** used by the §69 shadow pass, which consumes
 * {@link renderList} before the view loop: a shadow map is frame state shared
 * by every view, and filtering it by one view's mask or frustum would make the
 * shadows in view A depend on view B's viewport (R-18's §46 argument).
 */
const viewList: RenderItem[] = [];

/** Scratch for `projection * view`; see {@link renderList} for the policy. */
const viewProjection = new Matrix4();

/**
 * The current view's clip planes (§87), extracted from {@link viewProjection}
 * once per view and reused exactly as it is (R-8).
 */
const viewFrustum = new Frustum();

/**
 * How the per-view derivation is asked to cull, allocated once so the view loop
 * passes no fresh object per view. The `frustum` field is the module's own, so
 * re-extracting the planes updates this record too.
 */
const viewListOptions = { frustum: viewFrustum };

/**
 * The frame's collected lighting (§68), module-owned and reused exactly as
 * {@link renderList} is, and safe for the same reason: `render` collects and
 * consumes it synchronously. Only refreshed for frames that contain a lit
 * item, so a scene that never lights never pays the collection walk.
 */
const sceneLights = createSceneLights();

/** Resolved viewport rectangle in drawing-buffer pixels, reused per view. */
const rect = { x: 0, y: 0, width: 0, height: 0 };

/**
 * §60's per-view upload stamp (RFC 0001), incremented once per view of every
 * frame. A node program records the stamp it last saw, so the frame uploads
 * each program's view-projection (and render time) once per view however many
 * materials share the program — with no per-frame map and no allocation.
 * Module-level and monotonic, so two renderers sharing the process can never
 * replay a stamp a program has already seen.
 */
let nodeViewStamp = 0;

/**
 * Resolved GL textures for the node draw about to be issued, index-aligned
 * with the program's sampler list — resolved *before* any state changes so a
 * draw skipped for a missing texture contributes nothing at all. Bounded by
 * the IR's sampler cap; reused every draw ({@link renderList}'s policy).
 */
const nodeTextureScratch: GlTexture[] = [];

/** Scratch for a §70 graph effect's scalar uniform values. */
const effectUniformScratch = new Float32Array(1);

/**
 * §57's material as this backend reads it, derived from the render item union
 * rather than imported.
 *
 * `@fourjs/render-webgl` depends on `core`, `math`, and `render` only (plan §3.1,
 * frozen), so it may not name `@fourjs/materials`' `Material`. `RenderItem`'s
 * `material` is that type, so taking it back off the union gives the same
 * contract with no new edge — the technique this file already uses for the
 * scene root and the viewport (decision, WP-3.5).
 */
type ItemMaterial = NonNullable<RenderItem["material"]>;

/** §57's `BlendMode`, derived from the material for the same reason. */
type ItemBlendMode = ItemMaterial["blendMode"];

/**
 * §57's `blendMode` as a GL blend function — `[sourceFactor, destination
 * Factor]`, over **straight (non-premultiplied) alpha**, which is the policy
 * §66 requires this engine to state and this tier commits to everywhere.
 *
 * Four modes, four `blendFunc` pairs, no blend *equation* changes: every one of
 * them is `src × sourceFactor + dst × destinationFactor`, so the equation stays
 * at GL's default `FUNC_ADD` and this backend needs no `blendEquation` entry
 * point. Modes that do need one (`darken`, `lighten`, the Porter-Duff set)
 * are not in §57's vocabulary here and would arrive with it.
 */
const BLEND_FUNCTIONS: Record<ItemBlendMode, readonly [number, number]> = {
  normal: [GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA],
  additive: [GL.SRC_ALPHA, GL.ONE],
  multiply: [GL.DST_COLOR, GL.ZERO],
  screen: [GL.ONE, GL.ONE_MINUS_SRC_COLOR],
};

/** §57's optional `stencil` record, derived from the material for the same reason. */
type ItemStencil = NonNullable<ItemMaterial["stencil"]>;

/**
 * §67's per-item clip record, derived from the render item exactly as
 * {@link ItemMaterial} is and for the same frozen-matrix reason (R-23,
 * 2026-08-21). `RenderItem.clip` is optional-or-null — `undefined` and `null`
 * both mean "no clip touches this draw" — so the non-nullable half is the
 * record a clipped draw actually carries: the §57-shaped stencil state the
 * engine composed for it, and whether this draw *writes* the mask
 * (`maskPass`) rather than being tested by it.
 */
type ItemClip = NonNullable<RenderItem["clip"]>;

/**
 * Every bit of the stencil buffer — see `GlState.stencilReadMask` for why the
 * all-ones mask this backend mirrors is one byte wide rather than four.
 */
const STENCIL_ALL_BITS = 0xff;

/**
 * §67's eight comparisons as GL enums (R-7).
 *
 * A record rather than a `switch`, matching `BLEND_FUNCTIONS`: the lookup is
 * one property load, and `StencilState` validates every assignment against
 * these same eight names (`@fourjs/materials`), so the table is total over its
 * key type and a missing arm is a compile error rather than an `undefined`
 * reaching `stencilFunc` inside a frame.
 */
const STENCIL_FUNCS: Record<ItemStencil["func"], number> = {
  never: GL.NEVER,
  less: GL.LESS,
  equal: GL.EQUAL,
  lequal: GL.LEQUAL,
  greater: GL.GREATER,
  notequal: GL.NOTEQUAL,
  gequal: GL.GEQUAL,
  always: GL.ALWAYS,
};

/** §67's eight operations as GL enums, for {@link STENCIL_FUNCS}' reason. */
const STENCIL_OPS: Record<ItemStencil["passOp"], number> = {
  keep: GL.KEEP,
  zero: GL.ZERO,
  replace: GL.REPLACE,
  increment: GL.INCR,
  "increment-wrap": GL.INCR_WRAP,
  decrement: GL.DECR,
  "decrement-wrap": GL.DECR_WRAP,
  invert: GL.INVERT,
};

/**
 * The GL state this backend toggles per draw (§57), mirrored on the CPU so a
 * frame issues a call only where a draw actually *changes* something.
 *
 * That mirroring is not an optimization, it is the compatibility guarantee:
 * with §57's defaults — opaque, depth-tested, depth-writing, colour-writing —
 * every comparison below is equal and the frame issues **exactly the GL
 * sequence it issued before material render state existed**, down to the single
 * `useProgram`. A scene pays for state only where it asks for it.
 *
 * ## One mirror per renderer (F13, 2026-08-07)
 *
 * This was a module-level object until 2026-08-07, shared by every
 * `WebglRenderer` in the process and therefore by every *context* — §61 allows
 * several renderers over one application, and two of them mirror two different
 * GL states. The sharing was masked, never fixed, by `render` resetting the
 * mirror on entry. It is a per-instance field now
 * ({@link WebglRenderer.render} passes it to each helper), which is also what
 * makes the reset-on-entry an assertion the class can *keep* rather than a
 * hope: nothing outside one renderer's own frame can move it.
 *
 * The values a fresh mirror carries are the fixed state `#applyFixedState`
 * establishes (blending off, `LEQUAL` depth test on) plus GL's own defaults
 * (depth mask on, colour mask on) — the state a frame starts and ends in.
 */
interface GlState {
  blending: boolean;
  blendMode: ItemBlendMode;
  depthTest: boolean;
  depthWrite: boolean;
  colorWrite: boolean;
  /**
   * §67's stencil test (R-7, 2026-08-11), mirrored at **GL's initial values**
   * for the reason the four above are mirrored at theirs: a frame whose
   * materials declare no `stencil` finds every comparison equal and issues not
   * one stencil call, so it is byte-identical to the frame drawn before this
   * field existed. Sixth confirmation of the mirror-at-GL-initial technique.
   *
   * The masks mirror `0xff`, not GL's literal all-ones: WebGL 2 has exactly two
   * stencil formats and both are 8 bits deep, so the low byte is the whole
   * buffer and `0xff` selects every bit of it. `StencilState` refuses a value
   * above 255 (§85), which is what makes that narrowing safe rather than a
   * silent truncation.
   */
  stencilTest: boolean;
  stencilFunc: number;
  stencilRef: number;
  stencilReadMask: number;
  stencilWriteMask: number;
  stencilFailOp: number;
  stencilDepthFailOp: number;
  stencilPassOp: number;
}

/**
 * GL's initial stencil state, written once (§67, R-7).
 *
 * One object rather than two copies of eight literals, because these values
 * *are* the byte-identity claim — "the mirror starts where GL starts, so a
 * frame that names no stencil finds every comparison equal" — and a claim
 * stated twice is a claim that can drift.
 */
const INITIAL_STENCIL = {
  stencilTest: false,
  stencilFunc: GL.ALWAYS,
  stencilRef: 0,
  stencilReadMask: STENCIL_ALL_BITS,
  stencilWriteMask: STENCIL_ALL_BITS,
  stencilFailOp: GL.KEEP,
  stencilDepthFailOp: GL.KEEP,
  stencilPassOp: GL.KEEP,
} as const;

/** A mirror of the state a frame starts and ends in; see `GlState`. */
function createGlState(): GlState {
  return {
    blending: false,
    blendMode: "normal",
    depthTest: true,
    depthWrite: true,
    colorWrite: true,
    ...INITIAL_STENCIL,
  };
}

/**
 * Resets the mirror to the state a frame starts and ends in.
 *
 * Since F13 every frame leaves through a `finally` that restores exactly this
 * state to *real* GL, so this is the cheap restatement of an invariant that
 * already holds rather than the assumption it used to be: a frame that threw
 * mid-draw no longer hands the next one a mirror that disagrees with the
 * context. It costs no GL call either way.
 */
function resetGlState(state: GlState): void {
  state.blending = false;
  state.blendMode = "normal";
  state.depthTest = true;
  state.depthWrite = true;
  state.colorWrite = true;
  Object.assign(state, INITIAL_STENCIL);
}

/**
 * Applies §57's blend state for the draw about to be issued.
 *
 * `blend` is the material's `transparent` flag — except on the two pipelines
 * that blend by construction (sprites and §36 particles), where the caller
 * passes `true` because they did so before the flag existed and a scene that
 * never heard of it must not lose its compositing, and on unlit draws whose
 * authored `color[3]` is not 1 (WP-4.7).
 *
 * The blend *function* is only re-issued while blending is on: a mode change on
 * an opaque material would be a call with no observable effect, and `render`
 * restores the function at the end of the frame — which is what `forceMode` is
 * for, since that restore runs with blending already off (F15).
 */
function applyBlendState(
  gl: ParticleGlContext,
  state: GlState,
  blend: boolean,
  mode: ItemBlendMode,
  forceMode = false,
): void {
  if (blend !== state.blending) {
    if (blend) {
      gl.enable(GL.BLEND);
    } else {
      gl.disable(GL.BLEND);
    }
    state.blending = blend;
  }
  if ((blend || forceMode) && mode !== state.blendMode) {
    // Total over `ItemBlendMode`: §57's `Material.blendMode` validates every
    // assignment against the same four names (`@fourjs/materials`, F14), and
    // `applyMaterialState` maps a material that declares none onto `"normal"`.
    const [source, destination] = BLEND_FUNCTIONS[mode];
    gl.blendFunc(source, destination);
    state.blendMode = mode;
  }
}

/**
 * Applies §57's depth and colour state for the draw about to be issued.
 *
 * `depthTest` is `enable`/`disable(DEPTH_TEST)`; `depthWrite` is `depthMask`;
 * `colorWrite` is `colorMask` on all four channels (§57 declares one boolean,
 * so all four move together — see `WebglContext.colorMask`).
 */
function applyDepthColorState(
  gl: ParticleGlContext,
  state: GlState,
  depthTest: boolean,
  depthWrite: boolean,
  colorWrite: boolean,
): void {
  if (depthTest !== state.depthTest) {
    if (depthTest) {
      gl.enable(GL.DEPTH_TEST);
    } else {
      gl.disable(GL.DEPTH_TEST);
    }
    state.depthTest = depthTest;
  }
  if (depthWrite !== state.depthWrite) {
    gl.depthMask(depthWrite);
    state.depthWrite = depthWrite;
  }
  if (colorWrite !== state.colorWrite) {
    gl.colorMask(colorWrite, colorWrite, colorWrite, colorWrite);
    state.colorWrite = colorWrite;
  }
}

/**
 * Applies §57's optional stencil state for the draw about to be issued (§67,
 * R-7).
 *
 * `stencil` is the material's record, §67's engine-composed clip record (R-23
 * — structurally §57's shape with every field present, so the defensive `??`
 * reads below never fire on one), or `undefined` for the overwhelmingly
 * common draw that carries neither — which means *disable the test*, GL's
 * initial state and the only stencil state this engine had before R-7.
 *
 * ## The three calls, and why they are three
 *
 * GL splits the state across `stencilFunc` (comparison, reference, read mask),
 * `stencilOp` (the three outcomes), and `stencilMask` (the write mask), and
 * each is re-issued only when *its* group moved. A mask pass and the draw it
 * masks typically differ in the comparison and the write mask but agree on the
 * operations, so the common composition costs two calls at the switch, not
 * three.
 *
 * ## Turning the test off does not need the rest put back
 *
 * With `STENCIL_TEST` disabled GL performs no stencil test **and no stencil
 * write** — the operations are unreachable — so returning to "no stencil" is
 * one `disable`, and the func/op mirrors are deliberately left where the last
 * stencil material put them. The next stencil material re-issues only what it
 * actually disagrees with. The one place that reasoning does not hold is
 * `clear`, which is masked by the write mask whether or not the test is
 * enabled; {@link WebglRenderer.render} restores the mask before clearing for
 * exactly that reason.
 */
function applyStencilState(
  gl: ParticleGlContext,
  state: GlState,
  stencil: ItemStencil | ItemClip["stencil"] | undefined,
): void {
  if (stencil === undefined) {
    if (state.stencilTest) {
      gl.disable(GL.STENCIL_TEST);
      state.stencilTest = false;
    }
    return;
  }
  if (!state.stencilTest) {
    gl.enable(GL.STENCIL_TEST);
    state.stencilTest = true;
  }
  // Read defensively, exactly as `applyMaterialState` reads the rest of §57:
  // a structurally-typed double or a consumer's own material type may carry a
  // partial record, and a missing field has to mean the documented default
  // rather than `undefined` reaching a GL entry point. A real `StencilState`
  // always declares all seven and validates each on assignment (F14).
  const func = STENCIL_FUNCS[stencil.func ?? "always"];
  const ref = stencil.ref ?? 0;
  const readMask = stencil.readMask ?? STENCIL_ALL_BITS;
  if (
    func !== state.stencilFunc ||
    ref !== state.stencilRef ||
    readMask !== state.stencilReadMask
  ) {
    gl.stencilFunc(func, ref, readMask);
    state.stencilFunc = func;
    state.stencilRef = ref;
    state.stencilReadMask = readMask;
  }
  const failOp = STENCIL_OPS[stencil.failOp ?? "keep"];
  const depthFailOp = STENCIL_OPS[stencil.depthFailOp ?? "keep"];
  const passOp = STENCIL_OPS[stencil.passOp ?? "keep"];
  if (
    failOp !== state.stencilFailOp ||
    depthFailOp !== state.stencilDepthFailOp ||
    passOp !== state.stencilPassOp
  ) {
    gl.stencilOp(failOp, depthFailOp, passOp);
    state.stencilFailOp = failOp;
    state.stencilDepthFailOp = depthFailOp;
    state.stencilPassOp = passOp;
  }
  const writeMask = stencil.writeMask ?? STENCIL_ALL_BITS;
  if (writeMask !== state.stencilWriteMask) {
    gl.stencilMask(writeMask);
    state.stencilWriteMask = writeMask;
  }
}

/**
 * Restores the stencil write mask to all bits, so a `clear` is not masked by
 * whatever the last stencil material left behind (§67, R-7).
 *
 * One comparison, and it is `false` in every frame that names no stencil.
 */
function restoreStencilWriteMask(gl: ParticleGlContext, state: GlState): void {
  if (state.stencilWriteMask !== STENCIL_ALL_BITS) {
    gl.stencilMask(STENCIL_ALL_BITS);
    state.stencilWriteMask = STENCIL_ALL_BITS;
  }
}

/**
 * Applies every §57 field a material declares, defaulting each one the way a
 * material that predates the field would behave.
 *
 * The reads are deliberately defensive — `!== false`, `=== true`, `?? "normal"`
 * — rather than trusting the type. A backend meets its materials through a
 * *structural* contract (that is what lets the unit tests drive it with
 * doubles, and what lets a consumer's own material type reach it), so a missing
 * field has to mean "the default", not `undefined` leaking into a GL call or a
 * `NaN` into a uniform. `material` itself is optional for the one caller that
 * has none: §36's particles carry no material at all.
 *
 * That is the *whole* of what these fallbacks guard (F16, 2026-08-07). Every
 * real `Material` declares all six fields and validates the two that can carry
 * a bad value on assignment as well as at construction (F14) — so a fallback
 * that no structural double could reach has been removed rather than left to
 * read as a live defence.
 *
 * ## §67's clip (R-23, 2026-08-21)
 *
 * `clip` is the item's engine-composed clip record, or `null` for the
 * overwhelmingly common draw no clip touches — every draw of every scene that
 * predates §67, whose path through this function is unchanged to the byte.
 * A clipped draw's record **replaces** the material's own §57 `stencil` (the
 * documented collision: a node that declares a clip is asking the engine to
 * compose the mask, and the engine's record is what keeps the containment
 * guarantee true). A **mask pass** (`clip.maskPass`) additionally forces the
 * depth test, depth writes, and colour writes off, whatever the material says:
 * a mask contributes no pixels and must neither occlude, be occluded by, nor
 * be depth-rejected against the content it masks. Blending is left to the
 * material — with colour writes off it cannot reach the framebuffer either
 * way, and skipping the call would leave the mirror wrong for the next draw.
 */
function applyMaterialState(
  gl: ParticleGlContext,
  state: GlState,
  material: ItemMaterial | undefined,
  alwaysBlend: boolean,
  clip: ItemClip | null = null,
): void {
  applyBlendState(
    gl,
    state,
    alwaysBlend || material?.transparent === true,
    material?.blendMode ?? "normal",
  );
  if (clip !== null && clip.maskPass) {
    // §67's mask draw — see the function documentation.
    applyDepthColorState(gl, state, false, false, false);
  } else {
    applyDepthColorState(
      gl,
      state,
      material?.depthTest !== false,
      material?.depthWrite !== false,
      material?.colorWrite !== false,
    );
  }
  // §67's seam, and its whole per-item cost (R-7): one property load and one
  // comparison. The second disjunct is what makes the *first* draw after a
  // stencil material put the test back — without it a frame would need
  // `applyStencilState` unconditionally, which is a call per draw for a feature
  // almost no scene uses. Measured: no change in bundle size or frame time for
  // a scene that names no stencil (see the packet's A/B). R-23 widened the
  // resolution by one comparison: the engine's clip record outranks the
  // material's own stencil, and `null` — every pre-§67 draw — resolves to
  // exactly what this line resolved to before the parameter existed.
  const stencil = clip !== null ? clip.stencil : material?.stencil;
  if (stencil !== undefined || state.stencilTest) {
    applyStencilState(gl, state, stencil);
  }
}

/**
 * Adds one *submitted* draw to §84's render counters (A-1, 2026-08-07).
 *
 * Called immediately after the GL draw entry point and only ever with a
 * non-null record: the frame reads `this.statistics` once, and every call site
 * is guarded by that one comparison, so a renderer with statistics off does not
 * reach this function and issues exactly the GL sequence it always did.
 *
 * `vertexCount` is the draw's element count — vertices for `drawArrays`,
 * indices for `drawElements` — which is the number GL divides by three either
 * way. This backend has only two primitive modes (`gl-geometry.ts` maps §53's
 * `"triangles"`/`"lines"` onto `GL.TRIANGLES`/`GL.LINES`), so anything that is
 * not `TRIANGLES` contributes no triangles at all; `Math.floor` because a
 * geometry whose count is not a multiple of three leaves GL a trailing partial
 * primitive that it does not draw.
 */
function countDraw(
  statistics: RenderStatistics,
  mode: number,
  vertexCount: number,
  instances: number,
): void {
  statistics.drawCalls += 1;
  statistics.instances += instances;
  if (mode === GL.TRIANGLES) {
    statistics.triangles += Math.floor(vertexCount / 3) * instances;
  }
}

/**
 * §57's `opacity`, defaulted to 1 for a material that does not declare one —
 * a structurally-typed double or a consumer's own material type, exactly as in
 * {@link applyMaterialState}. A real `Material` always declares it, and rejects
 * a non-finite value on every write (F14), so this multiplier cannot carry a
 * `NaN` into `uniform4fv`.
 */
function opacityOf(material: ItemMaterial): number {
  return material.opacity ?? 1;
}

/**
 * §57's `map` as this backend reads it (R-19) — the texture an unlit or lit
 * material samples, or `null`.
 *
 * Read defensively, exactly as `applyMaterialState` reads the render state and
 * for the same reason: a backend meets its materials through a *structural*
 * contract, so a material double that predates the field — or a consumer's own
 * material type — reports `undefined`, which has to mean "no texture" rather
 * than leaking into `TextureCache.acquire`.
 */
function mapOf(material: {
  map?: CacheableTexture | null;
}): CacheableTexture | null {
  return material.map ?? null;
}

function metalRoughnessMapOf(material: {
  metalRoughnessMap?: CacheableTexture | null;
}): CacheableTexture | null {
  return material.metalRoughnessMap ?? null;
}

function normalMapOf(material: {
  normalMap?: CacheableTexture | null;
}): CacheableTexture | null {
  return material.normalMap ?? null;
}

function occlusionMapOf(material: {
  occlusionMap?: CacheableTexture | null;
}): CacheableTexture | null {
  return material.occlusionMap ?? null;
}

function emissiveMapOf(material: {
  emissiveMap?: CacheableTexture | null;
}): CacheableTexture | null {
  return material.emissiveMap ?? null;
}

function unlitColorBlends(material: object): boolean {
  const color = (
    material as { color?: readonly [number, number, number, number] }
  ).color;
  return color !== undefined && color[3] !== 1;
}

/**
 * Turns a texture a material points at into the GL texture to bind, whichever
 * kind it is (R-4, 2026-08-07) — the one place in the draw path that knows
 * there are two.
 *
 * An ordinary `Texture` is uploaded from its CPU-side texels by
 * {@link TextureCache}. A {@link @fourjs/render!RenderTargetTexture | render-target
 * texture} has none — it *is* a framebuffer's colour attachment — so it resolves
 * through {@link RenderTargetCache} instead, which allocates the framebuffer if
 * this is the first the backend has heard of it. That is what makes sampling a
 * target that has never been rendered into read as transparent black rather
 * than fail.
 *
 * `null` means "do not bind this": a disposed resource, an allocation GL
 * refused, or — the case only this function can see — a **feedback loop**, a
 * material sampling the very target this frame is drawing into. Reading and
 * writing one surface in a single pass is undefined behaviour on every backend,
 * and undefined content is worse than a missing draw, so the draw is dropped
 * exactly as a disposed texture's is (§83). Ping-pong between two targets to
 * express what that draw was reaching for.
 *
 * The non-target path is one `isRenderTargetTexture` marker read away from what
 * it was before, and issues the identical GL call — which is what keeps a scene
 * that never renders to texture byte-identical at the GL boundary.
 */
function resolveTexture(
  textures: TextureCache,
  renderTargets: RenderTargetCache,
  activeTarget: RenderTargetArgument | null,
  texture: CacheableTexture,
): GlTexture | null {
  if (!isRenderTargetTexture(texture)) {
    return textures.acquire(texture)?.texture ?? null;
  }
  const source = texture.renderTarget;
  if (source === activeTarget) {
    return null;
  }
  return renderTargets.acquire(source)?.texture ?? null;
}

/**
 * Restores the GL state a frame borrowed, issuing a call only for what it
 * actually changed — the mirror image of {@link applyMaterialState}.
 *
 * The blend function outlives the blend enable, so a frame that ended with a
 * non-default mode has to put it back explicitly even though blending is being
 * turned off in the same breath: that is `applyBlendState`'s `forceMode`, which
 * replaces the hand-written `blendFunc` this function used to issue after
 * passing a mode argument the helper ignored (F15, 2026-08-07).
 */
function restoreGlState(gl: ParticleGlContext, state: GlState): void {
  applyBlendState(gl, state, false, "normal", true);
  applyDepthColorState(gl, state, true, true, true);
  // §67, R-7: the test off and the write mask back to all bits — the two halves
  // of the stencil state that outlive a frame. Both comparisons are equal in a
  // frame that named no stencil, so this adds no call to one.
  applyStencilState(gl, state, undefined);
  restoreStencilWriteMask(gl, state);
}

/**
 * The texture unit the sprite pipeline samples from.
 *
 * Unit 0, permanently: this tier binds exactly one texture per draw, and §77's
 * multi-texture materials (normal maps, masks, atlases plus data maps) are what
 * will need a unit allocator. Naming the constant keeps the `activeTexture` call
 * and the sampler upload from drifting apart.
 */
const SPRITE_TEXTURE_UNIT = 0;

/**
 * Narrows `value` to a {@link WebglCanvas}, or throws
 * `RENDERER_INITIALIZATION_FAILED`.
 *
 * The check is on the three members this backend calls, not on a constructor
 * name: an `OffscreenCanvas` wrapper, a test double, and an
 * `HTMLCanvasElement` are all equally acceptable, and `instanceof
 * HTMLCanvasElement` would additionally fail across realms (an iframe's canvas
 * is not the parent's `HTMLCanvasElement`).
 */
function requireCanvas(value: unknown): WebglCanvas {
  if (typeof value !== "object" || value === null) {
    throw new FourError(
      "RENDERER_INITIALIZATION_FAILED",
      "The WebGL 2 backend needs a canvas: pass one as " +
        "`initialize({ canvas })` (§61, §45).",
      { context: { received: typeof value } },
    );
  }

  const candidate = value as Partial<WebglCanvas>;
  if (
    typeof candidate.getContext !== "function" ||
    typeof candidate.addEventListener !== "function" ||
    typeof candidate.removeEventListener !== "function"
  ) {
    throw new FourError(
      "RENDERER_INITIALIZATION_FAILED",
      "The value passed as `canvas` is not a canvas: it lacks " +
        "getContext/addEventListener/removeEventListener (§61).",
      { context: { received: typeof value } },
    );
  }

  return value as WebglCanvas;
}

/**
 * Narrows a `getContext` result to a {@link ParticleGlContext} — i.e. a
 * `WebglContext` plus the three instancing entry points the particle pipeline
 * needs — or returns `null` (the caller turns that into
 * `RENDERER_INITIALIZATION_FAILED` with the reason attached).
 */
function asContext(value: unknown): ParticleGlContext | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  for (const name of REQUIRED_CONTEXT_METHODS) {
    if (typeof candidate[name] !== "function") {
      return null;
    }
  }
  return value as ParticleGlContext;
}

/**
 * The §62 members this backend answers **without asking GL anything new**
 * (WP-R1.1, 2026-08-21).
 *
 * Every value is a statement about *this backend on WebGL 2*, and every one of
 * them is true by construction rather than by query:
 *
 * - `computeShaders`, `storageBuffers`, `indirectDraw` — WebGL 2 has no
 *   compute stage, no storage buffers and no indirect draw at all. §62's
 *   tiers exist so that an application can read a `false` here and take
 *   the CPU path, rather than discover the absence at dispatch time.
 * - `timestampQueries` is **not** in this table: it is a lazy
 *   `getExtension("EXT_disjoint_timer_query_webgl2")` on first read of
 *   the field, the same law `maxAnisotropy` follows, so `initialize`
 *   and any test that never reads it issue the identical transcript.
 * - `floatRenderTargets` — `render-target.ts`'s `RenderTargetFormat` is the
 *   single-member union `"rgba8"`, and this backend requests no
 *   `EXT_color_buffer_float`; it cannot allocate a float target, whatever the
 *   device could.
 * - `multisampling` — core WebGL 2 (`renderbufferStorageMultisample`), and
 *   `RendererOptions.antialias` already reaches the context attributes.
 * - `shaderPrecision` — GLSL ES 3.00 *requires* fragment-stage `highp`, which
 *   is why `gl-program.ts`'s fragment stages declare it unconditionally.
 * - `compressedTextureFormats` — this tier uploads none (§77's boundary, see
 *   `gl-texture.ts`), so the honest report is "none available through me".
 *
 * ## What is deliberately **not** reported, and why
 *
 * §62's "maximum uniforms and bindings" is `MAX_UNIFORM_BLOCK_SIZE` and
 * `MAX_TEXTURE_IMAGE_UNITS` — two more `getParameter` calls at initialization.
 * The recorded law from R-30b applies verbatim: *a capability query must be
 * lazy if the alternative moves recorded transcripts.* Two extra `getParameter`
 * calls in `initialize` would move every landed integration transcript for a
 * number nothing in the engine reads yet. So both members are **omitted**, and
 * `undefined` says exactly that — "this backend has not been taught to answer"
 * — which is the third state the widened record exists to keep available
 * (`renderer.ts`). They join the §62 report the day something needs them, with
 * the query where the need is.
 *
 * `maxAnisotropy` follows the same law, with a tighter reading: the
 * `EXT_texture_filter_anisotropic` query lives on a **getter**, so
 * `initialize` and any test that never reads the field issue the identical
 * GL transcript they did before R-30c. `textureFormats` is the short
 * internal-format list this backend actually uploads (`rgba8`) — a constant,
 * not a `getParameter`.
 */
const WEBGL_STATIC_CAPABILITIES = Object.freeze({
  textureFormats: Object.freeze(["rgba8"]),
  multisampling: true,
  floatRenderTargets: false,
  storageBuffers: false,
  computeShaders: false,
  indirectDraw: false,
  compressedTextureFormats: Object.freeze([]),
  shaderPrecision: "highp",
  // §54's joint limit (RFC 0003): a declared constant, not a `getParameter`
  // read — `@fourjs/render`'s `MAX_SKINNING_JOINTS` documents the portability
  // arithmetic, and R-30b's law is why no query happens here. The capability
  // says what this backend *can* do; drawing skinned additionally requires
  // `registerSkinningPipeline()` (see `gl-skinning-registry.ts`).
  maximumSkinningJoints: MAX_SKINNING_JOINTS,
} satisfies Partial<RendererCapabilities>);

/**
 * Device anisotropy ceiling (§62 / §77). Lazy on purpose: see
 * {@link readCapabilities}. `1` is the isotropic floor — no extension, or
 * a driver that will not name a number.
 */
function queryMaxAnisotropy(gl: ParticleGlContext): number {
  const extension = gl.getExtension?.("EXT_texture_filter_anisotropic");
  if (extension === undefined || extension === null) {
    return 1;
  }
  const limit = gl.getParameter(GL.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
  return typeof limit === "number" && limit >= 1 ? Math.floor(limit) : 1;
}

/** Reads the §62 limits this tier can honestly report. */
function readCapabilities(gl: ParticleGlContext): RendererCapabilities {
  const maxTextureSize = gl.getParameter(GL.MAX_TEXTURE_SIZE);
  let maxAnisotropy: number | undefined;
  let timestampQueries: boolean | undefined;
  return Object.freeze({
    backend: "webgl2",
    maxTextureSize: typeof maxTextureSize === "number" ? maxTextureSize : 0,
    ...WEBGL_STATIC_CAPABILITIES,
    get maxAnisotropy(): number {
      maxAnisotropy ??= queryMaxAnisotropy(gl);
      return maxAnisotropy;
    },
    get timestampQueries(): boolean {
      timestampQueries ??= hasDisjointTimerQuery(gl);
      return timestampQueries;
    },
  } satisfies RendererCapabilities);
}

/**
 * Resolves a viewport's rectangle into drawing-buffer pixels, into the shared
 * {@link rect} (§48; the semantics are pinned on `Renderer.render`).
 *
 * `normalized` fractions multiply the drawing-buffer size — i.e. the size last
 * given to `resize`, times the resolution. Pixel rectangles are used verbatim:
 * the shared contract multiplies by the resolution *only* for the normalized
 * case, so an unnormalized rectangle is read as drawing-buffer pixels, which is
 * also the only reading under which `scissor` and `viewport` take the numbers
 * unchanged (ambiguity resolved here; decision, WP-3.5).
 *
 * No flip: WebGL's `viewport` and `scissor` origin is already the bottom-left
 * corner with +Y up, which is the convention §48 and §7a state. The "backends
 * whose native rectangle is top-left based flip on the way in" clause is for
 * Canvas 2D and SVG.
 *
 * Values are rounded (GL takes integers) and extents are clamped at zero, since
 * a negative width or height is a GL error rather than an empty rectangle.
 */
/**
 * Viewport and scissor for a §70 effect pass (R-6 follow-up).
 *
 * Omitted `pass.rect` covers the whole destination — the pre-follow-up
 * sequence, so a graph that never names a rectangle stays
 * transcript-identical. A named rectangle is destination pixels, origin
 * bottom-left (§7a). `SCISSOR_TEST` is on for this renderer's lifetime, so
 * both rectangles are always written: leaving them would clip the blit to
 * the previous view.
 */
function applyEffectDestination(
  gl: {
    viewport(x: number, y: number, width: number, height: number): void;
    scissor(x: number, y: number, width: number, height: number): void;
  },
  pass: EffectRenderPass,
  width: number,
  height: number,
): void {
  const dest = pass.rect;
  if (dest === undefined) {
    // Same order as every other path in this file: scissor, then viewport.
    gl.scissor(0, 0, width, height);
    gl.viewport(0, 0, width, height);
    return;
  }
  const x = Math.round(dest.x);
  const y = Math.round(dest.y);
  const w = Math.max(0, Math.round(dest.width));
  const h = Math.max(0, Math.round(dest.height));
  gl.scissor(x, y, w, h);
  gl.viewport(x, y, w, h);
}

function resolveRect(
  view: RenderView,
  bufferWidth: number,
  bufferHeight: number,
): void {
  const scaleX = view.normalized === true ? bufferWidth : 1;
  const scaleY = view.normalized === true ? bufferHeight : 1;
  rect.x = Math.round(view.x * scaleX);
  rect.y = Math.round(view.y * scaleY);
  rect.width = Math.max(0, Math.round(view.width * scaleX));
  rect.height = Math.max(0, Math.round(view.height * scaleY));
}

/**
 * Intersects a per-item §67 scissor with the view rectangle and issues
 * `gl.scissor`. Returns whether a restore is owed — `false` when the item
 * named none, so a scene that never scissors pays one comparison and no
 * extra GL call.
 */
function applyItemScissor(
  gl: { scissor(x: number, y: number, w: number, h: number): void },
  view: ScissorRect,
  item: ScissorRect | null | undefined,
): boolean {
  if (item == null) {
    return false;
  }
  const cut = intersectScissor(view, item);
  gl.scissor(cut.x, cut.y, cut.width, cut.height);
  return true;
}

/**
 * Draws fourJS scenes with WebGL 2 (§61, §62, §120).
 *
 * ```ts
 * const renderer = new WebglRenderer();
 * await renderer.initialize({ canvas });
 * renderer.resize(800, 600, devicePixelRatio);
 * renderer.render(scene, [createFullscreenViewport(camera)]);
 * // …
 * renderer.dispose();
 * ```
 *
 * ## Fixed GL state (decisions, WP-3.5)
 *
 * Set once at initialization and re-applied on context restore:
 *
 * - **Depth test on, `LEQUAL`, cleared to 1 per view.** §61's shared contract
 *   makes the per-view depth clear mandatory; `LEQUAL` rather than `LESS` so
 *   that co-planar geometry drawn later wins, which is what 2D content stacked
 *   in render order expects.
 * - **`"negative-one-to-one"` clip depth (plan D8).** GL's default depth range,
 *   and the default `Camera.updateProjectionMatrix` already writes — so this
 *   backend never rewrites a camera's projection. A `"zero-to-one"` backend
 *   (WebGPU) must, which is why the argument is on the camera method.
 * - **Counter-clockwise front faces**, matching the right-handed, Y-up world of
 *   §7a and the winding the §53 primitive builders emit.
 * - **Back-face culling OFF.** The MVP tier draws planar 2D shapes as much as
 *   3D meshes, and a plane seen from behind is a legitimate view of it, not a
 *   back face to discard. §57's base landed with
 *   `depthTest`/`depthWrite`/`colorWrite` (2026-08-06) and this backend honours
 *   all three per draw, but §57 declares **no** face-culling field, so culling
 *   stays a global off; turning it on would make half the 2D scenes in §93's
 *   examples disappear when the camera crosses their plane.
 * - **Scissor test on for the renderer's lifetime.** §61 requires clears to be
 *   confined to the viewport rectangle, and a `scissor` that is never enabled
 *   does not confine anything. Drawing is confined too, which is what stops a
 *   minimap's geometry from spilling into the main view.
 * - **Blend function `SRC_ALPHA`/`ONE_MINUS_SRC_ALPHA`; blending itself off.**
 *   §66 requires the engine to state its "premultiplied and straight alpha
 *   policies": this tier is **straight alpha, not premultiplied**, on every
 *   colour it touches — `UnlitMaterial.color`, `SpriteMaterial.tint`, texel
 *   data, and `Viewport.clearColor` alike. Set once at initialization, and the
 *   state a frame is always handed back in; since 2026-08-06 a draw whose
 *   material names a different `blendMode` (§57) changes the function for its
 *   run and `render` restores it before returning.
 *
 * ## Material render state (§57, 2026-08-06)
 *
 * Every draw applies the six fields §57 puts on `Material`:
 *
 * | field        | GL                                     |
 * | ------------ | -------------------------------------- |
 * | `transparent`| `enable`/`disable(BLEND)`               |
 * | `blendMode`  | `blendFunc` (see `BLEND_FUNCTIONS`)     |
 * | `depthTest`  | `enable`/`disable(DEPTH_TEST)`          |
 * | `depthWrite` | `depthMask`                             |
 * | `colorWrite` | `colorMask`                             |
 * | `opacity`    | multiplied into the uploaded alpha      |
 *
 * This is the fix for the recorded defect that `UnlitMaterial.color[3]` and
 * `LitMaterial.color[3]` were **dead fields**: blending was disabled for both
 * pipelines unconditionally, so animating alpha was a silent no-op. It is now
 * `transparent: true` away from working, and `opacity` drives it without
 * touching the shared colour.
 *
 * The state is mirrored on the CPU (one `GlState` **per renderer**, F13)
 * and a call is issued only where a draw *changes* something, so §57's defaults
 * — which are exactly this backend's previous fixed state — issue nothing at
 * all: a scene authored before the base existed produces the same GL sequence
 * it always did. A frame always leaves through the `finally` that restores what
 * it borrowed, so the mirror cannot outlive its agreement with the context (see
 * {@link WebglRenderer.render}).
 *
 * ## Five scene pipelines (§55, §36, §59, §68; WP-3a.3, WP-9.3, lighting
 * 2026-08-04, R-13 2026-08-08)
 *
 * A render item says which pipeline draws it (`RenderItem.kind`), and this
 * backend keeps all five live (a sixth program, §70's full-screen effect, is
 * driven by {@link WebglRenderer.renderEffect} and never by a render item):
 *
 * - **unlit** — flat colour, the §120 MVP pipeline, depth-tested, and opaque
 *   unless its material declares `transparent` or its colour alpha is not 1;
 * - **lit** — Lambert diffuse under §68's directional light plus the scene
 *   ambient term, depth-tested and opaque-by-default like unlit. The
 *   frame's lights are collected once per `render` call (`collectSceneLights`,
 *   `@fourjs/render`) — and only for frames whose list actually contains a lit
 *   or standard item, so unlit scenes never pay the walk;
 * - **standard** — §59's metallic-roughness BRDF (GGX, Smith, Schlick) under
 *   the same one light and the same ambient term, plus the eye position the
 *   specular lobe needs (`gl-standard.ts`). It shades in the same untagged
 *   linear space and blends by the same straight-alpha rule as the lit
 *   pipeline, so a scene may mix the two families freely;
 * - **sprite** — one texture sample times a tint, with `GL_BLEND` enabled
 *   whatever the material says (the pipeline blends by construction);
 * - **particles** — one `drawArraysInstanced` per §36 particle system,
 *   screen-aligned quads coloured per instance, with `GL_BLEND` enabled
 *   (`gl-particles.ts`).
 *
 * The unlit pipeline is the frame's starting and resting state: a scene with no
 * sprites and no particles issues exactly the GL sequence it issued before
 * either existed, down to the single `useProgram`. Blending is enabled when a
 * draw asks for it and disabled when one stops asking, so an opaque draw never
 * runs through a blend equation it did not ask for.
 *
 * Draws are **not depth-sorted**: §66's key 2 (opaque before transparent)
 * arrived in the render list on 2026-08-06 and this backend sees its effect for
 * free, but key 4 (depth) is still deferred with the per-view list it needs, so
 * transparent draws are ordered by layer, then explicit render order, then
 * scene order, with depth testing and depth *writing* left on unless a material
 * turns them off. That is correct for content that does not overlap, and for
 * overlapping content an author orders with `renderOrder` and usually sets
 * `depthWrite: false`; it is wrong for arbitrary unsorted overlapping
 * transparency, which is the documented limitation §66 asks the engine to state
 * and the depth-sorting packet to fix.
 *
 * Textures are discovered from the render list and cached exactly as geometry
 * is (`gl-texture.ts`), which is why §61's `createTexture` stays deferred — the
 * argument is written out in that module's header and in `@fourjs/render`'s
 * `texture.ts`.
 *
 * ## Render targets (§61, §48; R-4, 2026-08-07)
 *
 * `render`'s fourth argument draws the frame into an off-screen framebuffer
 * instead of the canvas, and `RenderTarget.colorTexture` is then an ordinary
 * material texture — which is the whole of render-to-texture. Three things are
 * this backend's part of the shared contract stated on `Renderer.render`:
 *
 * - **Framebuffers are a cache, keyed and invalidated exactly as geometry and
 *   textures are** (`gl-render-target.ts`), including through a context loss.
 * - **The bind lives inside the frame's `try`/`finally`**, so a draw that
 *   throws mid-pass cannot leave this renderer's framebuffer bound.
 * - **A frame with no target issues no framebuffer call at all** — not a bind,
 *   not an unbind. The on-screen GL sequence is byte-for-byte the one this
 *   backend issued before render targets existed, which is the property the
 *   pixel goldens and the recorded-sequence tests both pin.
 *
 * ## Statistics (§84; A-1, 2026-08-07)
 *
 * {@link WebglRenderer.statistics} is `null` by default and counts nothing.
 * Assign a `RenderStatistics` record and this backend adds one entry per draw
 * call it actually submits — `drawCalls`, `triangles` (per-instance count times
 * instances, lines excluded), `instances` — accumulating across every `render`
 * call until the record's owner clears it.
 *
 * The counters are integer increments *beside* the draw, never around it, and
 * the field is read once per frame. Switching them on therefore adds, removes,
 * and reorders nothing: the recorded-GL-sequence tests assert that a frame with
 * statistics on issues the byte-identical call list of the same frame with them
 * off, which is the property the pixel goldens rest on.
 *
 * ## Context loss (§61)
 *
 * `webglcontextlost` is captured, defaulted-prevented (without which the
 * browser never restores), and turned into a `contextlost` event; GPU handles
 * are dropped without being deleted, because they are already invalid.
 * `render` then returns silently until `webglcontextrestored` arrives, at which
 * point all six programs and all four caches are rebuilt, the fixed state and
 * the surface size are re-applied, capabilities are re-read, and
 * `contextrestored` is emitted — after the rebuild, so the first frame a listener triggers
 * already draws. Geometry and texture *content* re-uploads lazily from the
 * CPU-side sources the application still holds, on the next draw that needs it,
 * and so do the framebuffers of §61's "engine-owned GPU resources … render
 * targets": the cache cannot know which targets the next frame will use, so
 * each one is re-allocated by the pass that asks for it (R-4).
 *
 * ## Lifecycle
 *
 * `dispose()` is idempotent and terminal, succeeds while the context is lost,
 * and leaves no listeners on the canvas or on {@link WebglRenderer.events}
 * (§83). Every other method throws `INVALID_APPLICATION_STATE` afterwards, as
 * `NullRenderer` does — disposal is the application's own doing, unlike a lost
 * context, and a silent no-op would hide the bug.
 */
export class WebglRenderer implements Renderer, ScreenEffectRenderer {
  /** The §6b channel required by `Renderer` — `contextlost`/`contextrestored`. */
  readonly events = new EventEmitter<RendererEventMap>();

  #capabilities: RendererCapabilities = Object.freeze({
    backend: "webgl2",
    maxTextureSize: 0,
    timestampQueries: false,
    ...WEBGL_STATIC_CAPABILITIES,
  } satisfies RendererCapabilities);

  #canvas: WebglCanvas | null = null;

  #gl: ParticleGlContext | null = null;

  #program: UnlitProgram | null = null;

  #spriteProgram: SpriteProgram | null = null;

  /**
   * The registered particle pipeline's programs and batch caches (§36;
   * 2026-09-11), or `null` — before the first particle item, while the
   * context is lost, when nothing registered, and forever in a scene with no
   * particles. **Acquired lazily by {@link WebglRenderer.render}**, never at
   * initialize, through `#acquireParticlePrograms` — the skinned pair's
   * shape: a compile refusal costs particles, not the frame, and a scene
   * without particles issues the byte-identical GL sequence it always did.
   * Until 2026-09-11 the billboard and trail programs compiled at
   * initialize and rode every bundle that carried this class.
   */
  #particlePrograms: ParticlePrograms | null = null;

  /** The once-per-context latch for a refused particle compile. */
  #particleProgramsFailed = false;

  #litProgram: LitProgram | null = null;

  /**
   * §59's metallic-roughness pipeline (R-13, 2026-08-08), or `null` before
   * initialization and while the context is lost.
   *
   * Compiled by {@link WebglRenderer.initialize} beside the other five, for the
   * reason `#effectProgram` states at length and §61 requires: a shader compile
   * can throw for a driver reason no application can pre-empt, and `render` may
   * not throw. The cost is one program per renderer that never draws a
   * `StandardMaterial` — the same deal the lit, particle, and effect pipelines
   * already offer an application that uses none of them, and **measured**
   * rather than assumed (see the CHANGELOG entry for R-13).
   */
  #standardProgram: StandardPipeline | null = null;

  /**
   * The once-per-context latch for a refused standard compile. `#standardProgram`
   * is the registered standard pipeline's program (§59, R-13; behind
   * `registerStandardPipeline()` since 2026-09-11 by owner decision), or
   * `null` — before the first `"standard"` item, while the context is lost,
   * when nothing registered, and forever in a scene without one. Acquired
   * through `#acquireStandardProgram`, the skinned pair's way.
   */
  #standardProgramFailed = false;

  /**
   * The registered effect pipeline's program (§70, R-6; behind
   * `registerEffectPipeline()` since 2026-09-11), or `null` — before the
   * first fixed effect pass, while the context is lost, when nothing
   * registered, and forever in an application that runs no effect.
   *
   * Compiled at initialize from R-6 until 2026-09-11, for the reason R-6
   * gave: `renderEffect` runs inside a frame, and a compile there could throw.
   * The skinning seam (RFC 0003) showed the other way out — compile inside
   * the frame's own `try`, latch the failure, warn once — and R-6 had
   * *measured* the cost of the eager choice at 0.75 kB gzip per bundle that
   * never runs an effect. See `#acquireEffectProgram`.
   */
  #effectProgram: EffectPipeline | null = null;

  /** The once-per-context latch for a refused effect compile. */
  #effectProgramFailed = false;

  /**
   * The registered shadow pipeline's depth-only caster (§69, R-18; behind
   * `registerShadowPipeline()` since 2026-09-11), or `null` — before the
   * first shadowed frame, while the context is lost, when nothing registered,
   * and forever in a scene whose light never asks for a map.
   *
   * Compiled at initialize from R-18 until 2026-09-11; now acquired on the
   * first frame with `sceneLights.hasShadow`, inside the frame's `try`, the
   * skinned pair's way. An unregistered or refused pipeline skips the caster
   * pass, and the frame's lit surfaces draw unshadowed — `shadowActive` is
   * `false` exactly as it is when the shadow target will not allocate. See
   * `#acquireShadowProgram`.
   */
  #shadowProgram: ShadowCasterPipeline | null = null;

  /** The once-per-context latch for a refused shadow compile. */
  #shadowProgramFailed = false;

  /**
   * The off-screen surface §69's shadow map is rendered into (R-18), or `null`
   * until the first frame in which something casts.
   *
   * **Renderer-owned, and allocated lazily** — the one `RenderTarget` this
   * backend creates for itself. Lazily because a scene that never casts must
   * pay nothing at all, not even a descriptor (and the §83 totals a target
   * reports would otherwise show a megatexel every application allocates and
   * no application asked for); renderer-owned because the map is an
   * *implementation* of `castShadow`, not a surface an application composes
   * with — nothing outside this class may draw into it or sample it.
   *
   * It is re-`resize`d, never re-created, when the light's `mapSize` changes:
   * a resize bumps the target's version, which is exactly what makes the
   * framebuffer cache re-allocate at the new size on the next frame (R-4). It
   * survives context loss for the same reason the application's own targets do
   * — the descriptor is CPU-side, and only the cache's handles died.
   */
  #shadowTarget: RenderTarget | null = null;

  /**
   * The registered skinning pipeline's colour programs (§54; RFC 0003), or
   * `null` — before the first skinned draw, while the context is lost, when
   * nothing registered, and forever in a scene that never skins. **Compiled
   * lazily by {@link WebglRenderer.render}**, never at initialize: the other
   * seven programs compile up front because §61 forbids a frame from
   * throwing, and the skinned pair cannot (this module does not link them) —
   * so the frame compiles inside a `try` and a driver refusal costs skinning,
   * not the frame. A skinless scene therefore issues the byte-identical GL
   * sequence it always did — the RFC's acceptance gate.
   *
   * The depth-only skinned caster lives on the same pair and compiles later,
   * on the first skinned caster — see `#acquireSkinnedShadowProgram`.
   */
  #skinnedPrograms: SkinnedPrograms | null = null;

  /**
   * Whether a skinned-program compile failed on the current context — the
   * once-per-context latch that keeps a refusing driver from being asked
   * again every frame. Cleared on context restore: a fresh context may
   * compile.
   */
  #skinnedProgramsFailed = false;

  /**
   * Whether the skinned caster compile failed on the current context — a
   * separate latch from `#skinnedProgramsFailed`, so a driver that can shade
   * a skinned mesh but cannot compile the depth-only sibling still draws the
   * colour pass and only skips the deformed shadow.
   */
  #skinnedShadowFailed = false;

  /**
   * The registered node-material pipeline's per-context program cache (§60;
   * RFC 0001), or `null` — before the first node-material draw (or §70 graph
   * effect), while the context is lost, when nothing registered, and forever
   * in a scene that never uses one. **Created lazily**, never at initialize,
   * and creating it compiles nothing: programs compile per distinct graph on
   * first sight, inside the frame's `try`, and a per-graph failure is
   * latched by the cache itself (§61, §89). A scene without node materials
   * therefore issues the byte-identical GL sequence it always did — the
   * RFC's acceptance gate, the skinning slot's shape one seam over.
   */
  #nodePrograms: NodeMaterialPrograms | null = null;

  #geometries: GeometryCache | null = null;

  #textures: TextureCache | null = null;

  #renderTargets: RenderTargetCache | null = null;

  /**
   * This renderer's own §57 state mirror (F13) — see `GlState` for why it
   * is per-instance rather than per-module, and {@link WebglRenderer.render}
   * for the `finally` that keeps it and the context in step.
   */
  readonly #glState = createGlState();

  /**
   * §84's render counters, or `null` (the default) to count nothing — the
   * optional `Renderer` capability (A-1, 2026-08-07; see
   * `@fourjs/render`'s `statistics.ts`).
   *
   * This backend accumulates one entry per *submitted* draw call: a draw
   * skipped for a geometry it could not allocate, a texture the application
   * disposed, a zero-particle system, or a feedback loop on the current render
   * target never reaches a counter, because it never reached the GPU.
   *
   * Assign it between frames. {@link WebglRenderer.render} reads the field once
   * per call, so a record assigned from inside a frame's own listeners applies
   * from the next frame.
   */
  statistics: RenderStatistics | null = null;

  /**
   * Last completed GPU-frame duration in seconds (A-1). Reading this
   * getter is what arms `EXT_disjoint_timer_query_webgl2`; a renderer
   * that never reads it issues not one extra GL call (R-30b).
   */
  get lastGpuFrameTimeSeconds(): number {
    this.#gpuTimer ??= new GlGpuTimer();
    this.#gpuTimer.arm();
    return this.#gpuTimer.lastGpuFrameTimeSeconds;
  }

  #gpuTimer: GlGpuTimer | null = null;

  /**
   * §65 batching, or `null` (the default) to batch nothing — the opt-in
   * capability (R-9, 2026-08-09; see `gl-batch.ts`).
   *
   * ```ts
   * import { createGlBatching } from "@fourjs/render-webgl";
   * renderer.batching = createGlBatching();
   * ```
   *
   * With one assigned, consecutive render items that share a pipeline and a
   * **material instance** are merged into one `drawElements` — §65's sprite
   * batching and compatible shape batching, over the unlit and sprite
   * pipelines. With none, this backend issues exactly the GL sequence it issued
   * before batching existed, to the byte: the field is read **once per frame**,
   * and the whole of the no-batching cost is one `null` comparison per render
   * item — no allocation, no GL call, no reordering (asserted as a full
   * transcript in `tests/integration/render-batching.test.ts`).
   *
   * **Assigned rather than constructed here on purpose.** Nothing reachable
   * from a class method tree-shakes, so naming `GlBatching` in this file would
   * put the batcher in every bundle that carries this renderer — the measured
   * law R-6, R-13 and R-18 each paid. The type is imported `import type`, so an
   * application that never calls `createGlBatching` does not link the module.
   *
   * Assign it between frames, as {@link WebglRenderer.statistics} asks: `render`
   * reads it once per call.
   */
  batching: RenderBatching | null = null;

  /**
   * §9 **render** time in seconds, read by §60 node graphs containing a
   * `time` node (RFC 0001) — and by nothing else in this backend. `0` by
   * default, which is GL's own initial value for the uniform, so a scene
   * whose graphs never read time pays nothing whether or not this moves.
   *
   * Assign it between frames, exactly as {@link WebglRenderer.statistics}
   * asks — typically `renderer.renderTime = timeState.renderTime` in the
   * application's frame callback. Deliberately render time and never
   * simulation time: a shader is a rendering artefact, and §42/§43 forbid
   * anything downstream of one becoming simulation input. Must be finite; a
   * plain field (the `statistics`/`batching` precedent) because it is
   * assigned per frame on the application's hot path.
   */
  renderTime = 0;

  #contextLost = false;

  #disposed = false;

  /** Drawing-buffer size in device pixels; see {@link WebglRenderer.resize}. */
  #bufferWidth = 0;

  #bufferHeight = 0;

  /**
   * Whether the drawing buffer carries a stencil buffer (§67, R-7) — the
   * `stencil` context attribute, remembered because the frame needs it to
   * decide whether its clear may carry `STENCIL_BUFFER_BIT`.
   *
   * `false` unless {@link RendererOptions.stencil} asked, and `false` is what
   * every renderer built before R-7 got: the attribute was hard-coded off.
   */
  #stencil = false;

  /** Whether `resize` has been called, so `initialize` knows whose size wins. */
  #sizeRequested = false;

  /**
   * Bound once and stored so `removeEventListener` can match them. Arrow
   * properties rather than methods: a method reference would have to be bound,
   * and an unbound one silently fails to unregister (§83 forbids leaving
   * listeners behind).
   */
  readonly #onContextLost = (event: WebglContextEventLike): void => {
    // Without this the browser will not fire `webglcontextrestored` at all.
    event.preventDefault();
    if (this.#disposed || this.#contextLost) {
      return;
    }
    this.#contextLost = true;
    // Every handle died with the context: drop them, never delete them.
    this.#program = null;
    this.#spriteProgram = null;
    this.#litProgram = null;
    // The four registered pipelines (particles, effects, shadows, standard —
    // 2026-09-11) and §54's lazily compiled pair (RFC 0003) died with the
    // context like every other handle; the next draw that needs one
    // re-acquires it, and a fresh context may compile what this one refused,
    // so the latches clear too.
    this.#standardProgram = null;
    this.#standardProgramFailed = false;
    this.#particlePrograms = null;
    this.#particleProgramsFailed = false;
    this.#effectProgram = null;
    this.#effectProgramFailed = false;
    this.#shadowProgram = null;
    this.#shadowProgramFailed = false;
    this.#skinnedPrograms = null;
    this.#skinnedProgramsFailed = false;
    this.#skinnedShadowFailed = false;
    // §60's node-program cache (RFC 0001) died with the context too; the
    // next node-material draw re-creates it and recompiles per graph.
    this.#nodePrograms = null;
    this.#geometries?.forget();
    this.#textures?.forget();
    this.#renderTargets?.forget();
    // §65's batcher, when the application assigned one (R-9). Its two buffers
    // and its vertex array died with the context like every other handle; the
    // next batched draw recreates them.
    this.batching?.forget();
    // Query objects died with the context; the next armed frame reallocates.
    this.#gpuTimer?.forget();
    this.events.emit("contextlost", { renderer: this });
  };

  readonly #onContextRestored = (): void => {
    const gl = this.#gl;
    if (this.#disposed || !this.#contextLost || gl === null) {
      return;
    }
    // If this throws (a driver that will not recompile), the renderer stays
    // lost and `contextrestored` is not emitted — a half-restored renderer that
    // claimed to be ready would fail on the next draw instead, with no clue.
    this.#program = UnlitProgram.create(gl);
    this.#spriteProgram = SpriteProgram.create(gl);
    this.#litProgram = LitProgram.create(gl);
    this.#geometries = new GeometryCache(gl);
    this.#textures = new TextureCache(gl);
    this.#renderTargets = new RenderTargetCache(gl);
    this.#applyFixedState(gl);
    // Textures are re-uploaded lazily from the CPU-side sources their `Texture`
    // objects still retain — §61's "re-uploads user resources that retain
    // CPU-side sources", done on the next draw rather than eagerly, because the
    // cache cannot know which textures the next frame will actually use.
    this.#applySurfaceSize();
    this.#capabilities = readCapabilities(gl);
    this.#contextLost = false;
    this.events.emit("contextrestored", { renderer: this });
  };

  /**
   * §62 capability report. `maxTextureSize` is `0` until
   * {@link WebglRenderer.initialize} has queried the context, and is re-read on
   * context restore. `maxAnisotropy` is omitted until that same moment, then
   * resolved on first read (not during `initialize`) so landed GL transcripts
   * stay byte-identical.
   */
  get capabilities(): RendererCapabilities {
    return this.#capabilities;
  }

  /** Whether the backing context is currently lost (§61). */
  get contextLost(): boolean {
    return this.#contextLost;
  }

  /** Whether {@link WebglRenderer.dispose} has run. Disposal is terminal. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** Whether {@link WebglRenderer.initialize} has completed. */
  get initialized(): boolean {
    return this.#gl !== null;
  }

  /**
   * Acquires the WebGL 2 context from `options.canvas`, compiles the unlit
   * program, sets the fixed GL state, and wires the context-loss events (§61,
   * §45).
   *
   * Rejects with a {@link @fourjs/core!FourError | FourError} carrying `RENDERER_INITIALIZATION_FAILED`
   * when there is no canvas, when the canvas will not give up a `"webgl2"`
   * context (an older browser, a blocked GPU, a context already taken by
   * another API), or when what it gives back is not a WebGL 2 context; and with
   * `SHADER_COMPILATION_FAILED` when the unlit program will not build. §62
   * requires an explicit backend to fail fast rather than downgrade silently —
   * `"auto"` selection is the application's job, not this class's.
   *
   * The work is synchronous — unlike WebGPU, `getContext` returns immediately —
   * but the signature is `Promise<void>` because §61's is, so an application
   * awaits every backend the same way. The failure is delivered as a
   * *rejection* rather than a synchronous throw, which is what `await
   * app.initialize()` expects.
   *
   * Calling it twice rejects with `INVALID_APPLICATION_STATE`.
   */
  initialize(options?: RendererOptions): Promise<void> {
    try {
      this.#initializeSynchronously(options);
    } catch (error: unknown) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    return Promise.resolve();
  }

  /**
   * Draws `root`'s subtree once per viewport, in array order (§61, §48, §64).
   *
   * The per-view sequence is scissor rectangle, viewport rectangle, clears,
   * then the draws — the rectangles first so that the clears are already
   * confined when they run. Colour is cleared only when the view carries a
   * `clearColor` (absent means "composite over what an earlier view drew");
   * depth is cleared for every view to the far plane, so a later view cannot be
   * occluded by an earlier one. Both clears are issued as one `clear` call with
   * the combined mask.
   *
   * `viewProjection` is `camera.projectionMatrix * camera.viewMatrix`, uploaded
   * once per view after `camera.updateViewMatrix()` — the camera's world
   * transform is resolved by that call, so a camera moved after the frame's
   * resolve pass is still correct. The camera's *projection* is never rewritten
   * here: this backend's clip depth is `"negative-one-to-one"`, which is what
   * `Camera.updateProjectionMatrix` already defaults to (plan D8).
   *
   * The render list is built once per call, not once per view: it does not
   * depend on the camera, because §64 stage 3 (culling) is not implemented yet.
   * When culling lands, the build moves inside the view loop.
   *
   * ## Interpolated poses (§43, WP-3.6)
   *
   * With `interpolation` present the list is built by
   * `buildInterpolatedRenderList` instead of `buildRenderList`, so each item's
   * model matrix is the node's §43 render pose at `interpolation.alpha` —
   * position lerped, rotation slerped, composed through the hierarchy — rather
   * than its resolved world matrix. That is the whole of this backend's part in
   * §43: nothing else in the draw path changes, because the interpolated pose
   * arrives as an ordinary `RenderItem.worldMatrix`.
   *
   * Which of the two lists is built is decided **per call**, from the argument:
   * this class keeps no interpolation state, so the same renderer can draw an
   * interpolated frame for the application and a raw one for a picking or
   * screenshot pass without being reconfigured.
   *
   * Nothing in the scene is mutated — the interpolated path composes into
   * pooled matrices and never writes a render pose back (§42, §43). World
   * matrices are **not** resolved here: §7 and §64 make that a separate,
   * earlier stage, and `Application` runs it before its `render` listeners.
   * The interpolated path does not even need that pass, since it derives every
   * matrix itself.
   *
   * ## Off-screen passes (§61, §48; R-4, 2026-08-07)
   *
   * With `target` present the frame is drawn into that target's framebuffer:
   * bound as the first act of the frame's `try`, unbound in its `finally`, and
   * never left bound for the next caller. Normalized viewport rectangles
   * resolve against the *target's* size rather than the drawing buffer's, so a
   * full-target view is the same `{ 0, 0, 1, 1, normalized }` it is on screen;
   * unnormalized rectangles are target pixels, unscaled by the `resize`
   * resolution, which the target does not have.
   *
   * The pass is **skipped entirely** — no bind, no clear, no draw — when the
   * target is disposed, when GL will not allocate its framebuffer, or when the
   * assembled framebuffer is not `FRAMEBUFFER_COMPLETE`. §61 forbids throwing
   * from `render` for the asynchronous, driver-scheduled failures this is one
   * of, and half-drawing into an incomplete framebuffer would turn every
   * subsequent draw into an unread `GL_INVALID_FRAMEBUFFER_OPERATION`.
   *
   * A material whose texture is *this* target's own colour attachment is
   * skipped for the duration of the pass (`resolveTexture`): sampling the
   * surface being written is undefined on every backend.
   *
   * Without `target` — the on-screen path — **not one framebuffer call is
   * issued**, so the GL sequence is byte-for-byte what it was before render
   * targets existed.
   *
   * Returns immediately and silently while the context is lost, and when
   * `views` is empty (which therefore also clears nothing) — §61 both times.
   * Throws only for programmer error: rendering before `initialize` or after
   * `dispose`.
   *
   * ## A throw costs one frame, not the renderer (F13, 2026-08-07)
   *
   * `render` itself raises nothing else, but the frame runs *application* code
   * — a geometry or material accessor, a texture the application disposed
   * mid-frame — and that can. The draw work is therefore wrapped in a
   * `try`/`finally`: whatever escapes, the fixed GL state this frame borrowed
   * is put back, the texture unit and the vertex array are unbound, and the
   * §57 mirror ends where the next frame expects to find it. The exception is
   * re-thrown unchanged; the *next* frame draws correctly. Before this, one
   * transient exception desynced the mirror from the context permanently and
   * silently, because every later frame asserted the defaults it had just
   * stopped guaranteeing.
   */
  render(
    root: RenderRoot,
    views: readonly RenderView[],
    interpolation?: RenderInterpolationArgument,
    target?: RenderTargetArgument | null,
  ): void {
    const gl = this.#requireContext("render");
    if (this.#contextLost || views.length === 0) {
      return;
    }

    // Unreachable given the class invariant — a live context always has all
    // of these — but the fields are nullable so that context loss can drop
    // them, and the narrowing has to happen somewhere. Skipping the frame is
    // the right behaviour if the invariant is ever broken: §61 forbids
    // throwing here.
    const program = this.#program;
    const spriteProgram = this.#spriteProgram;
    const litProgram = this.#litProgram;
    const geometries = this.#geometries;
    const textures = this.#textures;
    const renderTargets = this.#renderTargets;
    if (
      program === null ||
      spriteProgram === null ||
      litProgram === null ||
      geometries === null ||
      textures === null ||
      renderTargets === null
    ) {
      return;
    }

    // The off-screen surface, if this is an off-screen pass (R-4). Resolved
    // *before* the frame's `try`, because `acquire` is a pure allocation with
    // nothing to unwind and never throws (`gl-render-target.ts`): a target that
    // is disposed, that GL would not allocate, or whose framebuffer is
    // incomplete skips the whole frame here rather than half-drawing it. The
    // *binding* is inside the envelope, where its `finally` can see it.
    const activeTarget = target ?? null;
    let targetRecord: RenderTargetRecord | null = null;
    if (activeTarget !== null) {
      targetRecord = renderTargets.acquire(activeTarget);
      if (targetRecord === null) {
        return;
      }
    }

    // Normalized viewport rectangles resolve against the surface actually being
    // drawn into: the drawing buffer on screen, the target's own size off
    // screen. Read off the *record*, so the `viewport` call and the allocation
    // agree even if the application resized the target after this call began.
    const surfaceWidth = targetRecord?.width ?? this.#bufferWidth;
    const surfaceHeight = targetRecord?.height ?? this.#bufferHeight;
    // Whether the surface this frame draws into *has* a stencil buffer (§67,
    // R-7): on screen that is the context attribute this renderer was
    // initialized with, off screen the target's own attachment. Read once for
    // the frame beside the surface size, for the same reason.
    const stencilAttached =
      targetRecord === null ? this.#stencil : targetRecord.stencil;

    // This renderer's own state mirror, and the two frame-scoped bindings the
    // `finally` below has to see (F13, 2026-08-07).
    const state = this.#glState;
    // §84's counters, read once for the frame (A-1, 2026-08-07): `null` is the
    // default and the whole of the no-statistics cost — one comparison per
    // draw, no allocation, and not a single GL call added, removed, or
    // reordered. Read *after* the early returns above, so a frame this backend
    // declines to draw counts nothing.
    const statistics = this.statistics;
    // §65's batcher (R-9), read once for the frame exactly as `statistics` is,
    // and `null` by default: a renderer that never opted in adds one comparison
    // per item to its draw loop and not a single GL call — the same
    // byte-identity contract A-1's counters make.
    const batching = this.batching;
    const gpuTimer =
      this.#gpuTimer !== null && this.#gpuTimer.armed ? this.#gpuTimer : null;
    gpuTimer?.begin(gl);
    // Whether a texture is bound to unit 0 — the sprite path binds one, and
    // since R-19 so does an unlit or lit draw whose material carries a `map`,
    // so a frame of particles and untextured geometry still has nothing to
    // unbind at the end.
    let textureBound = false;
    // Whether `activeTexture` has selected the map unit this frame. The sprite
    // path selects it on every switch *to* the sprite pipeline (unchanged); a
    // mapped unlit or lit draw selects it once, on the first one — both target
    // the same unit, so a frame that mixes them issues one call either way.
    let mapUnitActive = false;
    // CPU mirror of what is bound to the map unit (audit A6, 2026-09-11): the
    // texture handle the last unit-0 `bindTexture` of this frame bound, and
    // the pipeline that was current when it did. A draw whose texture is the
    // one already bound, under the same pipeline, binds nothing — N sprites
    // over one atlas cost one bind per frame instead of N. Forgotten whenever
    // the active unit moves off unit 0 (the `!mapUnitActive` re-select clears
    // it) and whenever the pipeline changes (the kind is part of the key), and
    // it dies with the frame: the `finally` unbinds unit 0 and the next frame
    // starts with nothing claimed.
    let boundMapTexture: GlTexture | null = null;
    let boundMapKind: string | null = null;
    let metalRoughnessBound = false;
    let emissiveBound = false;
    let normalBound = false;
    let occlusionBound = false;
    // §69 (R-18): whether this frame bound a shadow map to
    // `SHADOW_TEXTURE_UNIT`, so the `finally` knows whether it has one to
    // unbind. A frame in which nothing casts never touches unit 1 at all.
    let shadowBound = false;
    // §60 (RFC 0001): how many node-material texture units this frame has
    // bound above the fixed pair, so the `finally` knows what to release. `0`
    // for every frame of every scene without node materials — and for a node
    // scene that samples nothing — which is what keeps those frames'
    // sequences untouched.
    let nodeUnitsBound = 0;
    // The node program currently in use, if `activeKind` is `"node"`: the
    // kind alone cannot say which of several compiled graphs is current.
    let activeNodeProgram: NodeMaterialProgram | null = null;
    // Whether **anything** in this frame has bound a framebuffer (F13, R-4,
    // extended by R-18). `targetRecord !== null` stopped being the answer when
    // §69's caster pass arrived: that pass binds a framebuffer on the
    // *on-screen* path too, and a draw that throws inside it must not leave
    // every later frame — this renderer's on-screen ones included — rendering
    // into a shadow map nobody is looking at. `false` for a frame that casts
    // nothing and draws on screen, which is what keeps that frame's GL
    // sequence free of framebuffer calls entirely.
    let framebufferBound = targetRecord !== null;

    try {
      // Inside the envelope on purpose (R-4): the `finally` below unbinds it,
      // so a draw that throws mid-pass cannot leave this renderer's framebuffer
      // bound for whatever touches the context next. On the on-screen path this
      // issues no call at all — which is what keeps that path's GL sequence
      // byte-identical to the one it issued before targets existed.
      if (targetRecord !== null) {
        gl.bindFramebuffer(GL.FRAMEBUFFER, targetRecord.framebuffer);
      }

      const items =
        interpolation === undefined
          ? buildRenderList(root, renderList)
          : buildInterpolatedRenderList(
              root,
              interpolation.poseBuffer,
              interpolation.alpha,
              renderList,
            );

      // §67's other exhaustion case, and a development build only (R-23): a
      // clip on a surface with no stencil buffer has nothing to write its mask
      // into, so GL treats every stencil test as passing and the subtree draws
      // **unclipped** — failing toward drawing, like the ninth clip, but
      // silently. The check is O(1), not a scan: mask draws sort ahead of
      // every other item in the frame list, so "does this frame clip at all"
      // is one read of the first item. Diagnostic only — no GL call, no value
      // any later code reads (§33's A-4 rule).
      if (
        DEV &&
        !stencilAttached &&
        items.length > 0 &&
        items[0].clip?.maskPass === true
      ) {
        devWarnOnce(
          "webgl-clip-without-stencil",
          "§67: this scene sets `clip = true` but the surface being drawn " +
            "into has no stencil buffer, so there is nothing to write the " +
            "mask into and the clipped subtrees draw unclipped. Construct " +
            "the renderer with `{ stencil: true }` (or give the render " +
            "target `{ stencil: true }`) to allocate one (R-7).",
        );
      }

      // The frame's lights (§68), collected only when something will be shaded
      // by them: one `kind` comparison per item decides, so a scene with no lit
      // materials adds nothing to its frame but this loop. Collected once per
      // call, not per view — lights are frame state, like the render list.
      // Both shaded families ask for the same record (§59's standard pipeline
      // reads exactly the ambient term and directional light §68 collects), so
      // one walk serves them together and a scene with neither still pays only
      // this comparison.
      let hasLitItems = false;
      for (const item of items) {
        if (
          item.kind === "lit" ||
          item.kind === "standard" ||
          item.kind === "skinned-lit"
        ) {
          hasLitItems = true;
          break;
        }
      }
      if (hasLitItems) {
        collectSceneLights(root, sceneLights);
      }

      // §69's shadow map (R-18), rendered **before** the view loop: §63's own
      // pipeline diagram puts "Shadow Passes" between scene preparation and the
      // opaque world, and the map is per-*frame* state — one light, one volume,
      // shared by every view of the frame — exactly as `sceneLights` is.
      //
      // Deliberately backend-internal rather than a `RenderGraph` pass (R-5).
      // A graph pass is one `renderer.render(root, views, interpolation,
      // target)`, and this has no camera, no viewport, and no target the
      // application named; expressing it there would mean synthesizing all
      // three and making the light's projection an author's problem. §63 lists
      // shadow passes as a stage of the renderer's pipeline, not as one of the
      // `addPass` examples, and every one of those examples is a colour pass
      // composited by name.
      //
      // `sceneLights.hasShadow` is `false` for every scene that does not ask
      // for shadows, so this whole block — target, framebuffer, program, draws,
      // texture bind — issues **no GL call at all** in such a frame. That is
      // the byte-identity contract, not an optimisation.
      //
      // The caster program is the registered shadow pipeline's (2026-09-11),
      // acquired on the first shadowed frame: unregistered or refused, the
      // pass is skipped with one warning and `shadowActive` stays `false`, so
      // the lit surfaces below draw unshadowed rather than wrong.
      let shadowRecord: RenderTargetRecord | null = null;
      if (hasLitItems && sceneLights.hasShadow) {
        const shadowProgram = this.#acquireShadowProgram(gl);
        if (shadowProgram !== null) {
          // Set *before* the call, not after it: from here on the `finally`
          // owes an unbind whatever happens inside, including a throw between
          // the pass's own bind and its rebind below.
          framebufferBound = true;
          shadowRecord = this.#renderShadowMap(
            gl,
            items,
            renderTargets,
            geometries,
            shadowProgram,
            state,
            statistics,
          );
          // Back to the surface this frame is actually drawing into. The
          // on-screen path is `null`, which is where the shadow pass found
          // the binding; an off-screen frame re-binds its own target.
          gl.bindFramebuffer(
            GL.FRAMEBUFFER,
            targetRecord?.framebuffer ?? null,
          );
        }
      }
      // Whether the shaded pipelines may compare against a map this frame: the
      // light asked *and* the backend actually produced one. A shadow target
      // GL would not allocate skips the shadow, never the frame (§61).
      const shadowActive = shadowRecord !== null;
      if (shadowRecord !== null && shadowRecord.depthTexture !== null) {
        // Bound once, before anything selects unit 0, and left bound for the
        // whole frame — a shadow map is per-frame state that every shaded draw
        // samples. Selecting unit 1 here is safe precisely because
        // `mapUnitActive` is still `false`: the first draw that wants an albedo
        // texture re-selects unit 0, so the `finally`'s unit-0 unbind can never
        // land on the wrong unit.
        gl.activeTexture(GL.TEXTURE0 + SHADOW_TEXTURE_UNIT);
        gl.bindTexture(GL.TEXTURE_2D, shadowRecord.depthTexture);
        shadowBound = true;
      }

      // The unlit pipeline is the frame's starting state, so a scene with no
      // sprites issues exactly the GL sequence it issued before sprites existed.
      program.use();
      let activeKind:
        RenderItemKind | "particle-trail" | "particle-appearance" = "unlit";
      let particleTrailActive = false;
      // The GL state mirror starts where `#applyFixedState` and GL's own defaults
      // left it; every draw below moves it only where its material asks.
      resetGlState(state);

      for (const view of views) {
        // §60's per-view stamp (RFC 0001): one increment per view, so each
        // node program uploads its view state once per view however many
        // materials share it. No GL call — see `nodeViewStamp`.
        nodeViewStamp += 1;
        // §61's clears are masked by the depth and colour write state, so a view
        // that follows a `depthWrite: false` or `colorWrite: false` draw would
        // clear nothing at all. Put both back first; with §57's defaults this
        // issues no call.
        applyDepthColorState(gl, state, true, true, true);
        // §67's third clear-masking rule (R-7): a stencil write mask masks the
        // *clear* too, whether or not the test is enabled. Restored here for
        // the same reason, and equally free when no material named a stencil.
        restoreStencilWriteMask(gl, state);
        resolveRect(view, surfaceWidth, surfaceHeight);
        // Captured: the view rectangle every per-item scissor restores to.
        const viewScissorX = rect.x;
        const viewScissorY = rect.y;
        const viewScissorW = rect.width;
        const viewScissorH = rect.height;
        const viewScissor: ScissorRect = {
          x: viewScissorX,
          y: viewScissorY,
          width: viewScissorW,
          height: viewScissorH,
        };
        let itemScissorActive = false;
        gl.scissor(viewScissorX, viewScissorY, viewScissorW, viewScissorH);
        gl.viewport(viewScissorX, viewScissorY, viewScissorW, viewScissorH);

        let mask = GL.DEPTH_BUFFER_BIT;
        const clearColor = view.clearColor;
        if (clearColor !== undefined) {
          gl.clearColor(
            clearColor[0],
            clearColor[1],
            clearColor[2],
            clearColor[3],
          );
          mask |= GL.COLOR_BUFFER_BIT;
        }
        // A stencil buffer that is never cleared is a mask that leaks from one
        // frame into the next — the §33 defect, not a feature — so a surface
        // that *has* one clears it to 0 with the depth clear it already issues.
        // The bit is added only where the buffer exists: a renderer that did
        // not ask for `stencil` and a target that did not ask for one issue the
        // identical `clear` they always did, which is the byte-identity half of
        // this clause.
        if (stencilAttached) {
          mask |= GL.STENCIL_BUFFER_BIT;
        }
        gl.clearDepth(1);
        gl.clear(mask);

        const camera = view.camera;
        camera.updateViewMatrix();
        viewProjection
          .copy(camera.projectionMatrix)
          .multiply(camera.viewMatrix);

        // A uniform belongs to the program it was uploaded into, so the unlit
        // pipeline has to be current before its view-projection is written — and
        // the sprite pipeline needs its own copy, uploaded the first time it draws
        // into this view and valid for the rest of it.
        if (activeKind !== "unlit") {
          program.use();
          applyBlendState(gl, state, false, "normal");
          activeKind = "unlit";
        }
        program.setViewProjection(viewProjection);
        let spriteViewUploaded = false;
        let particleViewUploaded = false;
        let litViewUploaded = false;
        let standardViewUploaded = false;
        let skinnedUnlitViewUploaded = false;
        let skinnedLitViewUploaded = false;

        // §64 stages 2–3, per view (R-8, 2026-08-09). The frame's list is built
        // once, above; this derives *this view's* draws from it — §46's layer
        // filter (`view.layerMask`, else the camera's `layers`, §48's fallback
        // rule) and §87's frustum cull, both in `@fourjs/render` so that every
        // backend spells them the same way.
        //
        // The filter used to be an inline `item.layers & mask` in the loop
        // below, and the set it selects is unchanged: with no layers named and
        // nothing off screen, this list is the frame's list, item for item, in
        // order. What changed is that the cull now has somewhere to live — a
        // per-view list — and that §66's key 4 has somewhere to be measured.
        //
        // The planes come from this view's own `viewProjection`, already
        // composed above for the uniforms: culling costs one plane extraction
        // per view, not a second matrix multiply. `Frustum` reads the WebGL 2
        // clip convention by default, which is the one D8's projections write.
        viewFrustum.setFromViewProjection(viewProjection);
        const viewItems = buildViewRenderList(
          items,
          view,
          viewList,
          viewListOptions,
        );

        for (let index = 0; index < viewItems.length; index += 1) {
          const item = viewItems[index];
          if (itemScissorActive) {
            gl.scissor(viewScissorX, viewScissorY, viewScissorW, viewScissorH);
            itemScissorActive = false;
          }
          // §65 (R-9), and only when the application assigned a batcher: does a
          // run of compatible draws start here? `batching` is `null` by
          // default, so a renderer that never opted in pays this one comparison
          // per item and nothing else — no allocation, no GL call, no
          // reordering. The check sits **above** `geometries.acquire` because a
          // batched run draws from the batcher's own buffers: acquiring the
          // per-item vertex arrays would upload geometry the frame never binds.
          //
          // No mask is passed any more: every item in `viewItems` is one this
          // view draws, so the batcher's own layer test would be vacuous. A run
          // may now span items the *frame* list had between them — a masked-out
          // or culled draw no longer ends it — which is strictly better
          // batching and exactly as correct: the skipped item is not submitted
          // into this view at all, so the merged draws are consecutive in the
          // only order that exists here (R-8).
          if (batching !== null) {
            const batch = batching.next(viewItems, index);
            if (batch !== null) {
              // §55 and §57 resolve their texture from different fields; the
              // batch carries whichever one its material named (`batch.ts`).
              const batchTexture =
                batch.texture === null
                  ? null
                  : resolveTexture(
                      textures,
                      renderTargets,
                      activeTarget,
                      batch.texture,
                    );
              // A sprite whose texture will not resolve is skipped, exactly as
              // the unbatched sprite path skips it — one rule, applied to the
              // whole run because the run shares the material that named it. An
              // unlit batch draws on untextured instead, which is what R-5
              // recorded as that pipeline's answer to the same question.
              if (batch.kind !== "sprite" || batchTexture !== null) {
                itemScissorActive = applyItemScissor(
                  gl,
                  viewScissor,
                  batch.scissor,
                );
                if (activeKind !== "unlit") {
                  program.use();
                  activeKind = "unlit";
                }
                // §55's pipeline blends by construction, so a sprite batch does
                // too; everything else is the shared material's §57 state.
                applyMaterialState(
                  gl,
                  state,
                  batch.material,
                  batch.kind === "sprite" || unlitColorBlends(batch.material),
                  // §67 (R-23): the run's shared clip — the batcher broke the
                  // run wherever the record changed, so one apply covers every
                  // merged draw. `?? null` for a hand-built batch predating
                  // the field.
                  batch.clip ?? null,
                );
                if (batchTexture !== null) {
                  if (!mapUnitActive) {
                    gl.activeTexture(GL.TEXTURE0 + MAP_TEXTURE_UNIT);
                    mapUnitActive = true;
                    boundMapTexture = null;
                  }
                  if (boundMapTexture !== batchTexture || boundMapKind !== activeKind) {
                    gl.bindTexture(GL.TEXTURE_2D, batchTexture);
                    boundMapTexture = batchTexture;
                    boundMapKind = activeKind;
                  }
                  textureBound = true;
                }
                batching.draw(gl, program, batch, batchTexture !== null);
                if (statistics !== null) {
                  // One draw call for `batch.items` items — which is exactly
                  // what §65 asks a diagnostic to make visible (§84): the
                  // triangle count is unchanged and `drawCalls` falls.
                  countDraw(
                    statistics,
                    batch.mode === "lines" ? GL.LINES : GL.TRIANGLES,
                    batch.indexCount,
                    1,
                  );
                }
              }
              // Consumed either way: a run skipped for an unresolvable texture
              // is skipped item by item in the unbatched path too.
              index += batch.items - 1;
              continue;
            }
          }

          itemScissorActive = applyItemScissor(gl, viewScissor, item.scissor);

          // §54's skinned draws (RFC 0003) — a self-contained arm ending in
          // `continue`, like the particle arm below, because the skinned
          // pipeline must be resolved *before* the geometry upload: a draw
          // skipped for an unregistered pipeline (or a failed compile)
          // contributes nothing at all — not even a buffer upload. The two
          // programs compile lazily on this renderer's first skinned draw —
          // see `#acquireSkinnedPrograms` for the whole policy; the failure
          // direction is absence with a one-time warning, never a bind pose
          // (a character standing in T-pose is a different picture).
          if (isSkinnedUnlitItem(item) || isSkinnedLitItem(item)) {
            const skinnedPrograms = this.#acquireSkinnedPrograms(gl);
            if (skinnedPrograms === null) {
              continue;
            }
            const skinnedRecord = geometries.acquire(item.geometry);
            if (skinnedRecord === null) {
              continue;
            }
            if (isSkinnedUnlitItem(item)) {
              const skinnedProgram = skinnedPrograms.unlit;
              if (activeKind !== "skinned-unlit") {
                skinnedProgram.use();
                activeKind = "skinned-unlit";
              }
              if (!skinnedUnlitViewUploaded) {
                skinnedProgram.setViewProjection(viewProjection);
                skinnedUnlitViewUploaded = true;
              }
              const map = mapOf(item.material);
              const texture =
                map === null
                  ? null
                  : resolveTexture(textures, renderTargets, activeTarget, map);
              if (texture !== null) {
                if (!mapUnitActive) {
                  gl.activeTexture(GL.TEXTURE0 + MAP_TEXTURE_UNIT);
                  mapUnitActive = true;
                  boundMapTexture = null;
                }
                if (boundMapTexture !== texture || boundMapKind !== activeKind) {
                  gl.bindTexture(GL.TEXTURE_2D, texture);
                  boundMapTexture = texture;
                  boundMapKind = activeKind;
                }
                textureBound = true;
              }
              skinnedProgram.setFeatures(
                texture !== null,
                item.material.vertexColors === true,
              );
              // Blend follows bind + feature mirrors so a throw on `color`
              // still restores the borrowed texture unit and program-lifetime
              // flags (F13).
              applyMaterialState(
                gl,
                state,
                item.material,
                unlitColorBlends(item.material),
                item.clip ?? null,
              );
              skinnedProgram.setModel(item.worldMatrix);
              skinnedProgram.setColor(
                item.material.color,
                opacityOf(item.material),
              );
              skinnedProgram.setJointMatrices(item.jointMatrices);
            } else {
              const skinnedProgram = skinnedPrograms.lit;
              if (activeKind !== "skinned-lit") {
                skinnedProgram.use();
                activeKind = "skinned-lit";
              }
              applyMaterialState(
                gl,
                state,
                item.material,
                false,
                item.clip ?? null,
              );
              if (!skinnedLitViewUploaded) {
                // The same per-view state the lit branch uploads, through the
                // same shared uniform classes, so the skip rules agree.
                skinnedProgram.setViewProjection(viewProjection);
                skinnedProgram.setAmbientLight(sceneLights.ambientColor);
                skinnedProgram.setHemisphereLight(sceneLights);
                skinnedProgram.setDirectionalLight(
                  sceneLights.direction,
                  sceneLights.directionalColor,
                );
                skinnedProgram.setPunctualLights(sceneLights);
                skinnedProgram.setShadow(sceneLights);
                skinnedLitViewUploaded = true;
              }
              const map = mapOf(item.material);
              const texture =
                map === null
                  ? null
                  : resolveTexture(textures, renderTargets, activeTarget, map);
              if (texture !== null) {
                if (!mapUnitActive) {
                  gl.activeTexture(GL.TEXTURE0 + MAP_TEXTURE_UNIT);
                  mapUnitActive = true;
                  boundMapTexture = null;
                }
                if (boundMapTexture !== texture || boundMapKind !== activeKind) {
                  gl.bindTexture(GL.TEXTURE_2D, texture);
                  boundMapTexture = texture;
                  boundMapKind = activeKind;
                }
                textureBound = true;
              }
              skinnedProgram.setFeatures(texture !== null);
              skinnedProgram.setReceivesShadow(
                shadowActive && item.receiveShadow,
              );
              skinnedProgram.setModel(item.worldMatrix);
              skinnedProgram.setColor(
                item.material.color,
                opacityOf(item.material),
              );
              skinnedProgram.setJointMatrices(item.jointMatrices);
            }
            gl.bindVertexArray(skinnedRecord.vertexArray);
            if (skinnedRecord.indexType === null) {
              gl.drawArrays(skinnedRecord.mode, 0, skinnedRecord.count);
            } else {
              gl.drawElements(
                skinnedRecord.mode,
                skinnedRecord.count,
                skinnedRecord.indexType,
                0,
              );
            }
            if (statistics !== null) {
              countDraw(statistics, skinnedRecord.mode, skinnedRecord.count, 1);
            }
            continue;
          }

          // §60's node materials (RFC 0001) — a self-contained arm ending in
          // `continue`, like the skinned arm above, and resolved in the same
          // order: pipeline first, then this draw's textures, then the
          // geometry, so a draw skipped at any step contributes nothing at
          // all — not even a buffer upload (the with/without-registration
          // transcript A/B's exactness). The program cache compiles one
          // program per distinct graph on first sight (`gl-node-program.ts`);
          // the failure direction is absence with a one-time warning, never a
          // flat-coloured stand-in (a graph is a specific picture).
          if (isNodeItem(item)) {
            const nodePrograms = this.#acquireNodePrograms(gl);
            if (nodePrograms === null) {
              continue;
            }
            const nodeMaterial = item.material;
            const nodeProgram = nodePrograms.acquire(nodeMaterial.graph);
            if (nodeProgram === null) {
              continue;
            }
            const samplers = nodeProgram.textures;
            let texturesResolved = true;
            for (let unit = 0; unit < samplers.length; unit += 1) {
              const bound = nodeMaterial.getTexture(samplers[unit]);
              const handle =
                bound === null
                  ? null
                  : resolveTexture(
                      textures,
                      renderTargets,
                      activeTarget,
                      bound,
                    );
              if (handle === null) {
                texturesResolved = false;
                break;
              }
              nodeTextureScratch[unit] = handle;
            }
            if (!texturesResolved) {
              // A sampler with no binding, a disposed texture, or a feedback
              // loop on the current target: skipped, exactly as a sprite
              // whose texture will not resolve is (§83; R-4's rule).
              if (DEV) {
                devWarnOnce(
                  `webgl-node-texture:${nodeMaterial.id}`,
                  `§60: node material "${nodeMaterial.id}" samples a texture ` +
                    "that is unbound, disposed, or the surface being drawn " +
                    "into; its draws are skipped (§83).",
                );
              }
              continue;
            }
            const nodeRecord = geometries.acquire(item.geometry);
            if (nodeRecord === null) {
              continue;
            }
            if (activeKind !== "node" || activeNodeProgram !== nodeProgram) {
              nodeProgram.use();
              activeNodeProgram = nodeProgram;
              activeKind = "node";
            }
            applyMaterialState(
              gl,
              state,
              nodeMaterial,
              false,
              item.clip ?? null,
            );
            if (nodeProgram.viewStamp !== nodeViewStamp) {
              nodeProgram.setViewProjection(viewProjection);
              nodeProgram.setTime(this.renderTime);
              nodeProgram.viewStamp = nodeViewStamp;
            }
            for (let unit = 0; unit < samplers.length; unit += 1) {
              gl.activeTexture(GL.TEXTURE0 + nodeProgram.unitBase + unit);
              gl.bindTexture(GL.TEXTURE_2D, nodeTextureScratch[unit]);
            }
            if (samplers.length > 0) {
              if (samplers.length > nodeUnitsBound) {
                nodeUnitsBound = samplers.length;
              }
              // Leave the active unit where every other path's mirror
              // expects it: unit 0, which `mapUnitActive` then truthfully
              // reports as selected.
              gl.activeTexture(GL.TEXTURE0);
              mapUnitActive = true;
              boundMapTexture = null;
            }
            nodeProgram.setMaterial(nodeMaterial);
            nodeProgram.setModel(item.worldMatrix);
            gl.bindVertexArray(nodeRecord.vertexArray);
            if (nodeRecord.indexType === null) {
              gl.drawArrays(nodeRecord.mode, 0, nodeRecord.count);
            } else {
              gl.drawElements(
                nodeRecord.mode,
                nodeRecord.count,
                nodeRecord.indexType,
                0,
              );
            }
            if (statistics !== null) {
              countDraw(statistics, nodeRecord.mode, nodeRecord.count, 1);
            }
            continue;
          }

          if (isParticlesItem(item)) {
            // §36's whole system, one instanced draw (plan P9-3), through the
            // registered particle pipeline (2026-09-11) — resolved *before*
            // the geometry upload, the skinned arm's rule: an item skipped
            // for an unregistered pipeline contributes nothing at all.
            const particlePrograms = this.#acquireParticlePrograms(gl);
            if (particlePrograms === null) {
              continue;
            }
            const particleProgram = particlePrograms.particle;
            const particleBatches = particlePrograms.batches;
            // The geometry record is the *shared unit quad* every particle
            // item points at, so the corner stream is uploaded once for the
            // application and this system's own vertex array is built on top
            // of that buffer.
            const record = geometries.acquire(item.geometry);
            if (record === null) {
              continue;
            }
            if (item.count === 0) {
              continue;
            }
            const batch = particleBatches.acquire(item, record.positionBuffer);
            if (batch === null) {
              continue;
            }
            const needsAppearance =
              particleItemFloats(item) >= 10 ||
              item.particleTexture !== undefined;
            // R-32's opt-in tier compiles on first need and latches a refusal
            // inside the pipeline (§61); `null` falls back to the plain
            // program, as it always did.
            const appearanceProgram: ParticleAppearancePipeline | null =
              needsAppearance ? particlePrograms.acquireAppearance() : null;
            if (appearanceProgram !== null) {
              if (activeKind !== "particle-appearance") {
                appearanceProgram.use();
                appearanceProgram.setSceneDepth(false);
                activeKind = "particle-appearance";
                particleViewUploaded = false;
              }
              appearanceProgram.setUseMap(item.particleTexture !== undefined);
              if (
                item.particleTexture !== undefined &&
                item.particleTexture !== true
              ) {
                const map = resolveTexture(
                  textures,
                  renderTargets,
                  activeTarget,
                  item.particleTexture as CacheableTexture,
                );
                if (map !== null) {
                  gl.activeTexture(GL.TEXTURE0);
                  gl.bindTexture(GL.TEXTURE_2D, map);
                  textureBound = true;
                  boundMapTexture = null;
                }
              }
            } else if (activeKind !== "particles") {
              particleProgram.use();
              activeKind = "particles";
              particleViewUploaded = false;
            }
            // Particles are transparent by construction (§36's colour ramp) and
            // carry no material to say otherwise, so they blend with the straight
            // alpha function and draw with §57's default depth and colour state —
            // see `gl-particles.ts` for the whole policy.
            // §67 (R-23): a particle system inside a clipped subtree is
            // tested like everything else — the clip is per draw, and §36's
            // batched item is one draw. `?? null` for a structurally-typed
            // item predating the field.
            applyMaterialState(gl, state, undefined, true, item.clip ?? null);
            if (!particleViewUploaded) {
              // The billboard offset happens between the view and the projection,
              // so this pipeline takes the two matrices separately rather than
              // the premultiplied `viewProjection` the other two use.
              if (appearanceProgram !== null) {
                appearanceProgram.setProjection(camera.projectionMatrix);
                appearanceProgram.setView(camera.viewMatrix);
              } else {
                particleProgram.setProjection(camera.projectionMatrix);
                particleProgram.setView(camera.viewMatrix);
              }
              particleViewUploaded = true;
            }
            if (appearanceProgram !== null) {
              appearanceProgram.setModel(item.worldMatrix);
            } else {
              particleProgram.setModel(item.worldMatrix);
            }
            particleBatches.upload(batch, item);
            gl.bindVertexArray(batch.vertexArray);
            gl.drawArraysInstanced(record.mode, 0, record.count, item.count);
            if (statistics !== null) {
              // One draw call, `item.count` instances of the shared quad — the
              // §36 system's whole per-frame GPU cost, and the one place in
              // this backend where `instances` exceeds `drawCalls`.
              countDraw(statistics, record.mode, record.count, item.count);
            }

            const trailCount = item.trailVertexCount ?? 0;
            if (trailCount > 0) {
              // The trail program compiles on the first ribbon, latched the
              // same way; a refusal skips the ribbon, never the billboards.
              const particleTrailProgram: ParticleBillboardPipeline | null =
                particlePrograms.acquireTrail();
              const trailBatch =
                particleTrailProgram === null
                  ? null
                  : particlePrograms.trailBatches.acquire(item);
              if (particleTrailProgram !== null && trailBatch !== null) {
                if (!particleTrailActive) {
                  particleTrailProgram.use();
                  particleTrailActive = true;
                }
                applyMaterialState(
                  gl,
                  state,
                  undefined,
                  true,
                  item.clip ?? null,
                );
                if (!particleViewUploaded) {
                  particleTrailProgram.setProjection(camera.projectionMatrix);
                  particleTrailProgram.setView(camera.viewMatrix);
                  particleViewUploaded = true;
                }
                particleTrailProgram.setModel(item.worldMatrix);
                particlePrograms.trailBatches.upload(trailBatch, item);
                gl.bindVertexArray(trailBatch.vertexArray);
                gl.drawArrays(GL.TRIANGLES, 0, trailCount);
                if (statistics !== null) {
                  countDraw(statistics, GL.TRIANGLES, trailCount, 1);
                }
              }
            }
            continue;
          }

          const record = geometries.acquire(item.geometry);
          if (record === null) {
            continue;
          }

          if (isSpriteItem(item)) {
            const material = item.material;
            const texture = resolveTexture(
              textures,
              renderTargets,
              activeTarget,
              material.texture,
            );
            if (texture === null) {
              continue;
            }
            if (activeKind !== "sprite") {
              spriteProgram.use();
              spriteProgram.setSampler(SPRITE_TEXTURE_UNIT);
              gl.activeTexture(GL.TEXTURE0);
              activeKind = "sprite";
              boundMapTexture = null;
            }
            // §55's pipeline blends by construction — it did before §57's
            // `transparent` flag existed, and a textured quad with an alpha
            // channel has to composite whatever the flag says — so `alwaysBlend`
            // is `true` here. Everything else the material declares (blend mode,
            // depth test, depth write, colour write) applies as usual.
            applyMaterialState(gl, state, material, true, item.clip ?? null);
            if (!spriteViewUploaded) {
              spriteProgram.setViewProjection(viewProjection);
              spriteViewUploaded = true;
            }
            // Atlas UVs live on the geometry (`Sprite` authors `frame` onto
            // `BufferGeometry.uvs`). The vertex stage interpolates that stream;
            // there is no per-draw `quad` uniform.
            spriteProgram.setModel(item.worldMatrix);
            spriteProgram.setTint(material.tint, opacityOf(material));
            if (boundMapTexture !== texture) {
              gl.bindTexture(GL.TEXTURE_2D, texture);
              boundMapTexture = texture;
              boundMapKind = activeKind;
            }
            textureBound = true;
          } else if (isLitItem(item)) {
            // The Lambert-lit pipeline (§68): depth-tested exactly like unlit,
            // and opaque unless its material says otherwise (§57) — which, at
            // the default `transparent: false`, is every material that predates
            // the flag.
            if (activeKind !== "lit") {
              litProgram.use();
              activeKind = "lit";
            }
            applyMaterialState(
              gl,
              state,
              item.material,
              false,
              item.clip ?? null,
            );
            if (!litViewUploaded) {
              // The view-projection and the frame's lights, once per view —
              // uniforms live in the program object, so they hold for every lit
              // draw into this view even if other pipelines run in between. The
              // lights were collected before the view loop; a frame with no
              // directional light uploads black `lightColor`, which zeroes the
              // Lambert term in the shader (no variants, no branch here).
              litProgram.setViewProjection(viewProjection);
              litProgram.setAmbientLight(sceneLights.ambientColor);
              litProgram.setHemisphereLight(sceneLights);
              litProgram.setDirectionalLight(
                sceneLights.direction,
                sceneLights.directionalColor,
              );
              // §68's point and spot lights (R-17). A scene with none issues
              // no call here at all — see `PunctualLightUniforms`.
              litProgram.setPunctualLights(sceneLights);
              // §69's shadow matrix, biases and tap size (R-18). A frame in
              // which nothing casts issues no call here at all — see
              // `ShadowUniforms`.
              litProgram.setShadow(sceneLights);
              litViewUploaded = true;
            }
            // §57's `map` (R-19): an albedo texture, bound and switched on for
            // this draw and switched off again by the next draw that has none.
            // A material with no map — every material authored before R-19 —
            // acquires nothing, binds nothing, and uploads nothing.
            const litMap = mapOf(item.material);
            const litTexture =
              litMap === null
                ? null
                : resolveTexture(textures, renderTargets, activeTarget, litMap);
            if (litTexture !== null) {
              if (!mapUnitActive) {
                gl.activeTexture(GL.TEXTURE0 + MAP_TEXTURE_UNIT);
                mapUnitActive = true;
                boundMapTexture = null;
              }
              if (boundMapTexture !== litTexture || boundMapKind !== activeKind) {
                gl.bindTexture(GL.TEXTURE_2D, litTexture);
                boundMapTexture = litTexture;
                boundMapKind = activeKind;
              }
              textureBound = true;
            }
            litProgram.setFeatures(litTexture !== null);
            // §49's `receiveShadow` (§69, R-18), folded together with "does
            // anything cast at all": both are reasons this draw is not
            // shadowed, and one mirrored uniform says so. `false` on every
            // draw of a shadowless frame, which is the mirror's initial value,
            // so no call is issued.
            litProgram.setReceivesShadow(shadowActive && item.receiveShadow);
            litProgram.setModel(item.worldMatrix);
            litProgram.setColor(item.material.color, opacityOf(item.material));
          } else if (isStandardItem(item)) {
            // §59's metallic-roughness pipeline (R-13). Structurally the lit
            // branch above — same lights, same albedo map, same §57 render
            // state — plus the two things a specular lobe needs and a diffuse
            // one does not: the eye position, and the surface's own metalness,
            // roughness, and emissive term. Behind `registerStandardPipeline()`
            // since 2026-09-11: unregistered or refused, the draw is skipped
            // with one warning (a Lambert stand-in would be a different
            // picture).
            const standardProgram = this.#acquireStandardProgram(gl);
            if (standardProgram === null) {
              continue;
            }
            if (activeKind !== "standard") {
              standardProgram.use();
              activeKind = "standard";
            }
            applyMaterialState(
              gl,
              state,
              item.material,
              false,
              item.clip ?? null,
            );
            if (!standardViewUploaded) {
              // Per-view state: uniforms live in the program object, so one
              // upload holds for every standard draw into this view even when
              // other pipelines run in between.
              standardProgram.setViewProjection(viewProjection);
              standardProgram.setAmbientLight(sceneLights.ambientColor);
              standardProgram.setHemisphereLight(sceneLights);
              standardProgram.setDirectionalLight(
                sceneLights.direction,
                sceneLights.directionalColor,
              );
              standardProgram.setPunctualLights(sceneLights);
              // §69 (R-18), exactly as the lit branch above: nothing at all for
              // a frame in which no light casts.
              standardProgram.setShadow(sceneLights);
              // The eye, read straight out of the camera's world matrix
              // translation column — `updateViewMatrix()` above resolved that
              // matrix, so this needs no second resolve and allocates nothing.
              const cameraElements = camera.transform.worldMatrix.elements;
              standardProgram.setCameraPosition(
                cameraElements[12],
                cameraElements[13],
                cameraElements[14],
              );
              standardViewUploaded = true;
            }
            const standardMap = mapOf(item.material);
            const standardTexture =
              standardMap === null
                ? null
                : resolveTexture(
                    textures,
                    renderTargets,
                    activeTarget,
                    standardMap,
                  );
            if (standardTexture !== null) {
              if (!mapUnitActive) {
                gl.activeTexture(GL.TEXTURE0 + MAP_TEXTURE_UNIT);
                mapUnitActive = true;
                boundMapTexture = null;
              }
              if (boundMapTexture !== standardTexture || boundMapKind !== activeKind) {
                gl.bindTexture(GL.TEXTURE_2D, standardTexture);
                boundMapTexture = standardTexture;
                boundMapKind = activeKind;
              }
              textureBound = true;
            }
            const metalRoughnessSource = metalRoughnessMapOf(item.material);
            const metalRoughnessTexture =
              metalRoughnessSource === null
                ? null
                : resolveTexture(
                    textures,
                    renderTargets,
                    activeTarget,
                    metalRoughnessSource,
                  );
            if (metalRoughnessTexture !== null) {
              gl.activeTexture(GL.TEXTURE0 + METAL_ROUGHNESS_TEXTURE_UNIT);
              mapUnitActive = false;
              gl.bindTexture(GL.TEXTURE_2D, metalRoughnessTexture);
              metalRoughnessBound = true;
            }
            const emissiveSource = emissiveMapOf(item.material);
            const emissiveTexture =
              emissiveSource === null
                ? null
                : resolveTexture(
                    textures,
                    renderTargets,
                    activeTarget,
                    emissiveSource,
                  );
            if (emissiveTexture !== null) {
              gl.activeTexture(GL.TEXTURE0 + EMISSIVE_TEXTURE_UNIT);
              mapUnitActive = false;
              gl.bindTexture(GL.TEXTURE_2D, emissiveTexture);
              emissiveBound = true;
            }
            const normalSource = normalMapOf(item.material);
            const normalTexture =
              normalSource === null
                ? null
                : resolveTexture(
                    textures,
                    renderTargets,
                    activeTarget,
                    normalSource,
                  );
            if (normalTexture !== null) {
              gl.activeTexture(GL.TEXTURE0 + NORMAL_TEXTURE_UNIT);
              mapUnitActive = false;
              gl.bindTexture(GL.TEXTURE_2D, normalTexture);
              normalBound = true;
            }
            const occlusionSource = occlusionMapOf(item.material);
            const occlusionTexture =
              occlusionSource === null
                ? null
                : resolveTexture(
                    textures,
                    renderTargets,
                    activeTarget,
                    occlusionSource,
                  );
            if (occlusionTexture !== null) {
              gl.activeTexture(GL.TEXTURE0 + OCCLUSION_TEXTURE_UNIT);
              mapUnitActive = false;
              gl.bindTexture(GL.TEXTURE_2D, occlusionTexture);
              occlusionBound = true;
            }
            standardProgram.setFeatures(
              standardTexture !== null,
              metalRoughnessTexture !== null,
              emissiveTexture !== null,
              normalTexture !== null,
              occlusionTexture !== null,
            );
            standardProgram.setMapFactors(
              item.material.normalScale,
              item.material.occlusionStrength,
            );
            standardProgram.setReceivesShadow(
              shadowActive && item.receiveShadow,
            );
            standardProgram.setModel(item.worldMatrix);
            standardProgram.setBaseColor(
              item.material.baseColor,
              opacityOf(item.material),
            );
            standardProgram.setSurface(
              item.material.metalness,
              item.material.roughness,
              item.material.emissive,
            );
          } else {
            if (activeKind !== "unlit") {
              program.use();
              activeKind = "unlit";
            }
            const map = mapOf(item.material);
            const texture =
              map === null
                ? null
                : resolveTexture(textures, renderTargets, activeTarget, map);
            if (texture !== null) {
              if (!mapUnitActive) {
                gl.activeTexture(GL.TEXTURE0 + MAP_TEXTURE_UNIT);
                mapUnitActive = true;
                boundMapTexture = null;
              }
              if (boundMapTexture !== texture || boundMapKind !== activeKind) {
                gl.bindTexture(GL.TEXTURE_2D, texture);
                boundMapTexture = texture;
                boundMapKind = activeKind;
              }
              textureBound = true;
            }
            // §53's per-vertex colours (R-19) reach the screen here, and with
            // them §113's debug-draw overlay (R-35): a `"lines"` geometry of
            // positions plus colours is one draw call, not one per segment.
            program.setFeatures(
              texture !== null,
              item.material.vertexColors === true,
            );
            // Blend follows bind + feature mirrors so a throw on `color` still
            // restores the borrowed texture unit and program-lifetime flags (F13).
            applyMaterialState(
              gl,
              state,
              item.material,
              unlitColorBlends(item.material),
              item.clip ?? null,
            );
            program.setModel(item.worldMatrix);
            program.setColor(item.material.color, opacityOf(item.material));
          }

          gl.bindVertexArray(record.vertexArray);
          if (record.indexType === null) {
            gl.drawArrays(record.mode, 0, record.count);
          } else {
            gl.drawElements(record.mode, record.count, record.indexType, 0);
          }
          if (statistics !== null) {
            // Sprite, lit, and unlit all land here: one draw call, one
            // instance, `record.count` elements either way (§84).
            countDraw(statistics, record.mode, record.count, 1);
          }
        }
        if (itemScissorActive) {
          gl.scissor(viewScissorX, viewScissorY, viewScissorW, viewScissorH);
        }
      }
    } finally {
      gpuTimer?.end(gl);
      // Restore the fixed state the frame borrowed, and leave nothing bound:
      // the next thing to touch this context may not be this renderer (§61
      // allows several renderers over one application).
      //
      // In a `finally` since F13 (2026-08-07). A draw can throw for reasons
      // that are entirely the application's — a disposed texture, a geometry
      // whose accessor raises — and before this the frame simply abandoned
      // whatever GL state it had borrowed. The mirror above then disagreed
      // with the context for the rest of the process: the next frame *asserted*
      // the defaults, so the skip logic never re-issued the calls that would
      // have fixed them, and an opaque scene drew blended (or masked, or
      // depth-testless) with nothing to point at. Restoring here makes a
      // mid-frame throw cost exactly the frame it happened in.
      restoreGlState(gl, state);
      if (textureBound) {
        if (!mapUnitActive) {
          gl.activeTexture(GL.TEXTURE0 + MAP_TEXTURE_UNIT);
        }
        gl.bindTexture(GL.TEXTURE_2D, null);
      }
      if (metalRoughnessBound && nodeUnitsBound === 0) {
        // Unit 2 is already active when this frame bound only the packed map.
        // If unit 0 was also borrowed, the restore above moved the active
        // unit back to 0 and we have to re-select 2 before unbinding. Binding
        // unit 3 after unit 2 does the same: the active unit is no longer 2.
        if (
          textureBound ||
          mapUnitActive ||
          emissiveBound ||
          normalBound ||
          occlusionBound
        ) {
          gl.activeTexture(GL.TEXTURE0 + METAL_ROUGHNESS_TEXTURE_UNIT);
        }
        gl.bindTexture(GL.TEXTURE_2D, null);
        if (!emissiveBound) {
          gl.activeTexture(GL.TEXTURE0);
        }
      }
      if (emissiveBound) {
        // Unit 3 is already active when this frame bound only the emissive
        // map. Restoring unit 0 and/or unit 2 first leaves a different unit
        // active, so re-select 3 before unbinding.
        if (
          textureBound ||
          metalRoughnessBound ||
          mapUnitActive ||
          normalBound ||
          occlusionBound
        ) {
          gl.activeTexture(GL.TEXTURE0 + EMISSIVE_TEXTURE_UNIT);
        }
        gl.bindTexture(GL.TEXTURE_2D, null);
        gl.activeTexture(GL.TEXTURE0);
      }
      if (normalBound) {
        gl.activeTexture(GL.TEXTURE0 + NORMAL_TEXTURE_UNIT);
        gl.bindTexture(GL.TEXTURE_2D, null);
      }
      if (occlusionBound) {
        gl.activeTexture(GL.TEXTURE0 + OCCLUSION_TEXTURE_UNIT);
        gl.bindTexture(GL.TEXTURE_2D, null);
      }
      if (normalBound || occlusionBound) gl.activeTexture(GL.TEXTURE0);
      // §60's node texture units (RFC 0001), released on the same terms as
      // unit 0's albedo: bound during the frame, left bound by nothing. Zero
      // iterations — and zero calls — in every frame that drew no textured
      // node material.
      for (let unit = 0; unit < nodeUnitsBound; unit += 1) {
        gl.activeTexture(GL.TEXTURE0 + NODE_SURFACE_TEXTURE_UNIT_BASE + unit);
        gl.bindTexture(GL.TEXTURE_2D, null);
      }
      if (nodeUnitsBound > 0) {
        gl.activeTexture(GL.TEXTURE0);
      }
      gl.bindVertexArray(null);
      // Back to the default drawing buffer (R-4, widened by R-18). Same
      // argument as the two unbinds above, one step stronger: a framebuffer
      // left bound by a frame that threw would send *every later frame* — this
      // renderer's on-screen ones included — into an off-screen surface nobody
      // is looking at, with nothing on screen and no error anywhere to explain
      // it. Since §69 that surface can be a shadow map on an otherwise
      // on-screen frame, which is why the condition is a flag rather than
      // `targetRecord !== null`.
      if (framebufferBound) {
        gl.bindFramebuffer(GL.FRAMEBUFFER, null);
      }
      // Unit 1's shadow map (R-18), released on the same terms as unit 0's
      // albedo above — and after it, so the active unit is left at 0, which is
      // GL's own initial value and what every path that binds a texture
      // re-selects anyway.
      if (shadowBound) {
        gl.activeTexture(GL.TEXTURE0 + SHADOW_TEXTURE_UNIT);
        gl.bindTexture(GL.TEXTURE_2D, null);
        gl.activeTexture(GL.TEXTURE0);
      }
    }
  }

  /**
   * Draws one §70 full-screen effect (R-6, 2026-08-07) — `pass.source`'s
   * colour attachment over the whole of `pass.target`, or of the drawing
   * buffer, through `pass.effect`.
   *
   * The normative contract is on `@fourjs/render`'s `Renderer.renderEffect`;
   * this is what the WebGL 2 backend does with it, and the two readings that
   * sentence left open.
   *
   * ## A separate entry point, and why `render` was not touched
   *
   * An effect is not a scene: it has no root, no views, no camera, no render
   * list, and no interpolation, and it draws a triangle that exists only in
   * the vertex stage. Routing it through `render` would have meant a fifth
   * `RenderItemKind`, a synthetic node, and a branch inside the draw loop —
   * and the loop is exactly where R-4, R-5 and F13 each had to re-prove that
   * an application which uses none of those features still emits the identical
   * GL call sequence. So §70 got its own method, and the property is preserved
   * by construction rather than by proof: **`render` is byte-for-byte the
   * function it was before this method existed.** The one thing R-6 adds to a
   * frame that runs no effect is a fifth `useProgram`-able object compiled at
   * initialization, which issues no call after that.
   *
   * ## What is skipped rather than thrown (§61, §83)
   *
   * Everything, on the same terms `render` uses — a lost context, a source or
   * destination the application disposed, a framebuffer GL would not allocate,
   * an effect kind this build does not implement, and a **feedback loop**: a
   * pass whose destination is the very surface it samples. That last one is
   * R-4's rule, applied to the pass instead of to a material's `map`; reading
   * and writing one surface in a single draw is undefined behaviour on every
   * backend, and `RenderGraph.validate` reports it statically as `"feedback"`
   * so the mistake is normally caught at setup rather than here.
   *
   * ## State, and the F13 envelope
   *
   * The effect borrows four things — the framebuffer binding, the scissor and
   * viewport rectangles, the depth test, and unit 0's texture binding — inside
   * a `try`/`finally`, so whatever escapes leaves this renderer's §57 mirror
   * and the context in the state the next frame expects (F13, 2026-08-07).
   * The mirror is deliberately **not** reset on entry: `applyDepthColorState`
   * moves only what the effect needs and the `finally` puts back exactly that,
   * which is strictly more conservative than re-asserting a state this method
   * did not establish.
   *
   * The scissor and viewport rectangles are *not* restored, exactly as `render`
   * does not restore them: both are written unconditionally by the next view of
   * the next frame, and every path that reads them writes them first.
   */
  renderEffect(pass: EffectRenderPass): void {
    const gl = this.#requireContext("renderEffect");
    if (this.#contextLost) {
      return;
    }

    // Unreachable given the class invariant, exactly as in `render`; the
    // field is nullable so context loss can drop it, and §61 forbids
    // throwing here, so the effect is skipped if it is ever broken.
    const renderTargets = this.#renderTargets;
    if (renderTargets === null) {
      return;
    }

    // Read structurally, like every other argument this backend meets: the
    // marker guard rather than the type, so a caller that bypassed
    // `validateEffectRenderPass` hands over a plain `Texture` and gets a
    // skipped effect instead of a black screen with no explanation.
    const source = pass.source;
    if (!isRenderTargetTexture(source)) {
      return;
    }
    const sourceTarget = source.renderTarget;
    const destination = pass.target ?? null;
    if (destination === sourceTarget) {
      return;
    }

    // Resolved before the envelope, as `render` resolves its target and for
    // the same reason: `acquire` is a pure allocation with nothing to unwind
    // and never throws, so a disposed or unallocatable surface skips the
    // effect here rather than half-drawing it.
    const sourceRecord = renderTargets.acquire(sourceTarget);
    if (sourceRecord === null) {
      return;
    }
    let destinationRecord: RenderTargetRecord | null = null;
    if (destination !== null) {
      destinationRecord = renderTargets.acquire(destination);
      if (destinationRecord === null) {
        return;
      }
    }

    // §60's graph effect (RFC 0001): drawn by the registered node pipeline
    // through its own envelope — a different program per graph, its own
    // sampler set, its own uniform values — so it branches before the
    // fixed-effect path rather than growing a switch inside it. Everything
    // the fixed path skips, this skips too, on the same §61 terms.
    const effect = pass.effect;
    if (effect.kind === "graph") {
      this.#renderGraphEffect(
        gl,
        pass,
        effect,
        sourceRecord,
        destinationRecord,
        destination,
        renderTargets,
      );
      return;
    }

    // An effect kind this build does not implement is skipped, never quietly
    // copied: `ScreenEffect` is a closed union precisely so that a staged §70
    // effect is a compile error, and a value that arrived from JSON or from
    // JavaScript must not become a different picture than the one asked for.
    if (
      effect.kind !== "copy" &&
      effect.kind !== "grade" &&
      effect.kind !== "output-transform"
    ) {
      return;
    }

    // The registered effect pipeline (2026-09-11), acquired on the first
    // fixed effect — after every refusal above, so a pass that would have
    // been skipped anyway never compiles, and before the envelope, so an
    // unregistered or refused pipeline skips with one warning and touches no
    // GL state at all.
    const effectProgram = this.#acquireEffectProgram(gl);
    if (effectProgram === null) {
      return;
    }

    const width = destinationRecord?.width ?? this.#bufferWidth;
    const height = destinationRecord?.height ?? this.#bufferHeight;
    const state = this.#glState;
    const statistics = this.statistics;
    let textureBound = false;

    try {
      if (destinationRecord !== null) {
        gl.bindFramebuffer(GL.FRAMEBUFFER, destinationRecord.framebuffer);
      }
      // Full destination, or `pass.rect` when the pass names a rectangle
      // (R-6 follow-up). `SCISSOR_TEST` is on for this renderer's lifetime,
      // so the rectangle has to be written or the previous view's would clip
      // the blit.
      applyEffectDestination(gl, pass, width, height);

      // An effect *replaces* its destination: no blending, so a chain is
      // predictable, and no depth test, so the triangle is never rejected by
      // whatever depth the destination happens to hold. Disabling the depth
      // test also disables depth *writes* in GL, so `depthMask` needs no
      // change and none is issued.
      applyBlendState(gl, state, false, "normal");
      applyDepthColorState(gl, state, false, true, true);

      effectProgram.use();
      effectProgram.setSampler(EFFECT_TEXTURE_UNIT);
      gl.activeTexture(GL.TEXTURE0 + EFFECT_TEXTURE_UNIT);
      gl.bindTexture(GL.TEXTURE_2D, sourceRecord.texture);
      textureBound = true;

      if (effect.kind === "grade") {
        effectProgram.setGrade(
          effect.exposure ?? COLOR_GRADE_DEFAULTS.exposure,
          effect.contrast ?? COLOR_GRADE_DEFAULTS.contrast,
          effect.saturation ?? COLOR_GRADE_DEFAULTS.saturation,
        );
      } else if (effect.kind === "output-transform") {
        // §60a's output transform, as the final render-graph pass: the encode
        // happens once, over the composited linear-light frame, and never
        // inside a material's fragment stage (R-15, 2026-08-08).
        effectProgram.setOutputTransform();
      } else {
        effectProgram.setCopy();
      }

      // No vertex data at all — the three corners come from `gl_VertexID`
      // (`gl-effect.ts`). The default vertex array is bound first because an
      // unrelated one left bound by another consumer of this context can carry
      // enabled attribute arrays, which WebGL validates against the draw count
      // whether the program reads them or not.
      gl.bindVertexArray(null);
      gl.drawArrays(GL.TRIANGLES, 0, EFFECT_VERTEX_COUNT);
      if (statistics !== null) {
        // One draw call, one instance, one triangle (§84) — counted here for
        // the same reason a scene draw is: what reached the GPU, not what was
        // asked for.
        countDraw(statistics, GL.TRIANGLES, EFFECT_VERTEX_COUNT, 1);
      }
    } finally {
      restoreGlState(gl, state);
      if (textureBound) {
        gl.bindTexture(GL.TEXTURE_2D, null);
      }
      if (destinationRecord !== null) {
        gl.bindFramebuffer(GL.FRAMEBUFFER, null);
      }
    }
  }

  /**
   * Resizes the drawing buffer to `width * resolution` × `height * resolution`
   * device pixels (§61, §45).
   *
   * The size is recorded first and applied to the canvas second, so a resize
   * during a lost context is remembered and re-applied on restore rather than
   * lost or thrown away (§61). Normalized viewport rectangles resolve against
   * the recorded size from the next frame on.
   *
   * Cameras are not touched — `aspect` is the application's to set (§47).
   */
  /**
   * Builds a `PickingService` over this renderer — §71's `"gpu"` tier
   * (RFC 0005), gated on `registerPickingPipeline()` exactly as skinned
   * draws are gated on `registerSkinningPipeline()`: this method resolves the
   * registry slot and refuses (§85) when nothing registered, so the id
   * program, the service, and its read-back live only in bundles that opted
   * in (the pipeline-cost law; `gl-picking-registry.ts`).
   *
   * What the service receives is a **live window** onto exactly the renderer
   * state an id pass needs — context, the three shared caches (geometry,
   * render targets, particle batches), the surface size, and the two
   * lifecycle flags — as accessors, so a §61 restore's new caches are seen
   * rather than captured stale (`PickingRendererHost`). Each call builds an
   * independent service; the caller owns and disposes it (§83). No GL call is
   * issued here — the id program compiles on the service's first pass.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` on a disposed renderer, or
   * when no picking pipeline is registered.
   */
  createPickingService(): PickingService {
    this.#assertUsable("createPickingService");
    const factory = resolvePickingServiceFactory();
    if (factory === null) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "§71: call registerPickingPipeline() from the render-webgl package " +
          "before createPickingService() (§85).",
        { context: { registered: false } },
      );
    }
    // Eight `this`-capturing arrows are the whole window: the host outlives
    // this call and must keep seeing the *live* renderer state (a §61 restore
    // swaps the caches), which is why the seam is accessor methods rather
    // than a snapshot — and arrows rather than getters is what keeps this
    // method's ride-along in never-picking bundles small (the A-3
    // trim-the-refusal precedent, applied to a factory).
    const host: PickingRendererHost = {
      context: () => this.#gl,
      geometries: () => this.#geometries,
      particleBatches: () => this.#particlePrograms?.batches ?? null,
      renderTargets: () => this.#renderTargets,
      surfaceWidth: () => this.#bufferWidth,
      surfaceHeight: () => this.#bufferHeight,
      contextLost: () => this.#contextLost,
      disposed: () => this.#disposed,
    };
    return factory.create(host);
  }

  /** Upload a CPU texture and wait until its queued GPU upload has completed. */
  async prepareTexture(texture: CacheableTexture): Promise<boolean> {
    this.#assertUsable("prepareTexture");
    const textures = this.#textures;
    if (textures === null)
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "WebglRenderer.prepareTexture() needs an initialized renderer.",
      );
    if (this.#contextLost)
      throw new FourError(
        "CONTEXT_LOST",
        "Cannot prepare a texture while the rendering context is lost.",
      );
    return (await textures.acquireAsync(texture)) !== null;
  }

  /**
   * Reads back `target`'s colour attachment — or the `region` rectangle of it
   * — as tightly packed RGBA8 bytes: §61's `readPixels` (landed 2026-08-29,
   * with `Rectangle2` in `@fourjs/math` — RFC 0005's named prerequisite — after
   * sitting on `gl-render-target.ts`'s staged list since R-4).
   *
   * **A `Promise` over a synchronous read, and that is the §62 contract, not
   * a fib.** §61 types the member `Promise<ArrayBuffer>` because WebGPU has
   * no synchronous readback at all, so the promise is the floor every
   * backend meets; GL's `readPixels` is synchronous and this method simply
   * resolves once it returns — the caller's shape never varies by backend,
   * exactly as `pick()` promises through both of its paths (RFC 0005 §4).
   *
   * **The stalling form, deliberately.** The picking packet built a
   * non-stalling fence path (`PIXEL_PACK_BUFFER` + `fenceSync` + a polled
   * `clientWaitSync`, `gl-picking.ts`) because picks happen *every frame
   * inside an interactive loop*, where a pipeline stall costs the frame
   * budget. A target readback is the opposite shape of operation: §92's
   * visual tier and RFC 0005's fallback path call it between frames, usually
   * once, and its caller is already awaiting the full GPU round trip — a
   * fence would add poll-granularity latency to save a stall nobody is
   * racing, and reusing the picking path would couple this method to that
   * service's pass state (or duplicate its ~80-line poll loop) for that
   * non-benefit. The upgrade is invisible to callers if a profile ever
   * disagrees: same member, same promise.
   *
   * The result is `width * height * 4` bytes (the region's, when given; the
   * target's otherwise), rows **bottom-to-top** — GL's native order, and the
   * §7a order the WebGPU backend flips into (`wgpu-readback.ts` records the
   * decision), so the two backends agree byte for byte. `region` is measured
   * in target texels from the **bottom-left** corner — GL's own readback
   * space, passed straight through. Rows are tightly packed with no
   * `PACK_ALIGNMENT` help needed: RGBA8 rows are always a multiple of 4
   * bytes, so the default pack alignment never pads.
   *
   * A target that was never rendered into reads back its zero-filled
   * allocation — transparent black, the same defined answer sampling one
   * gives. Unlike the frame methods this one **rejects** rather than skips
   * (the caller is awaiting a value; a silently empty buffer would be
   * undefined content by another name): `INVALID_APPLICATION_STATE` for a
   * disposed renderer, one never initialized, or a target that is disposed
   * or that GL would not allocate; `CONTEXT_LOST` while the context is lost
   * (§89 — this backend's loss code, as in `gl-picking.ts`);
   * `UNSUPPORTED_GPU_FEATURE` on a context double without the `readPixels`
   * entry point (presence is the capability, `gl-program.ts`). A malformed
   * region rejects with `validateReadbackRegion`'s `RangeError` (§85,
   * `@fourjs/render`'s shared check, so both backends refuse with the same
   * words).
   *
   * The framebuffer binding is borrowed and restored in a `finally`, exactly
   * as the stalling pick read borrows it — nothing is left bound behind.
   */
  readPixels(target: RenderTarget, region?: Rectangle2): Promise<ArrayBuffer> {
    // An executor rather than an `async` body: the read never awaits (the
    // module-level defence above), and a refusal must still arrive as a
    // rejection, never a synchronous throw — a throw inside the executor is
    // a rejection by construction, so the shape holds on both paths.
    return new Promise((resolve) => {
      resolve(this.#readPixelsSync(target, region));
    });
  }

  /** The synchronous body of {@link WebglRenderer.readPixels}. */
  #readPixelsSync(target: RenderTarget, region?: Rectangle2): ArrayBuffer {
    this.#assertUsable("readPixels");
    // Both fields are assigned together at initialize and only dropped by
    // dispose (checked above), so the pair check is one reachable state —
    // "never initialized" — not a defensive branch (`WebgpuRenderer`'s
    // shape, and the recorded coverage-hole rule).
    const gl = this.#gl;
    const renderTargets = this.#renderTargets;
    if (gl === null || renderTargets === null) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "WebglRenderer.readPixels() was called before initialize() (§61).",
        { context: { method: "readPixels", initialized: false } },
      );
    }
    if (this.#contextLost) {
      throw new FourError(
        "CONTEXT_LOST",
        "WebglRenderer.readPixels() was called while the context is lost; " +
          "there is no surface to read (§61, §89).",
        { context: { method: "readPixels" } },
      );
    }
    const record = renderTargets.acquire(target);
    if (record === null) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        `readPixels() was asked for render target ${target.id}, which is ` +
          "disposed (§83) or could not be allocated on this context.",
        { context: { target: target.id } },
      );
    }
    const readPixels = gl.readPixels;
    if (readPixels === undefined) {
      throw new FourError(
        "UNSUPPORTED_GPU_FEATURE",
        "This context does not implement the readPixels entry point; " +
          "presence is the capability (§62).",
        { context: { entryPoint: "readPixels" } },
      );
    }
    if (region !== undefined) {
      validateReadbackRegion(region, record.width, record.height);
    }
    const x = region === undefined ? 0 : region.x;
    const y = region === undefined ? 0 : region.y;
    const width = region === undefined ? record.width : region.width;
    const height = region === undefined ? record.height : region.height;
    const pixels = new Uint8Array(width * height * 4);
    gl.bindFramebuffer(GL.FRAMEBUFFER, record.framebuffer);
    try {
      readPixels.call(
        gl,
        x,
        y,
        width,
        height,
        GL.RGBA,
        GL.UNSIGNED_BYTE,
        pixels,
      );
    } finally {
      gl.bindFramebuffer(GL.FRAMEBUFFER, null);
    }
    return pixels.buffer;
  }

  resize(width: number, height: number, resolution = 1): void {
    this.#assertUsable("resize");
    this.#sizeRequested = true;
    this.#bufferWidth = Math.max(0, Math.round(width * resolution));
    this.#bufferHeight = Math.max(0, Math.round(height * resolution));
    if (!this.#contextLost) {
      this.#applySurfaceSize();
    }
  }

  /**
   * Releases every GPU resource this renderer owns and detaches its listeners
   * (§83). Idempotent, terminal, and safe while the context is lost — in which
   * case the GL objects are dropped rather than deleted, since the handles are
   * already invalid.
   *
   * Geometries and materials are **not** disposed: the renderer did not create
   * them (§83).
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;

    const canvas = this.#canvas;
    if (canvas !== null) {
      canvas.removeEventListener("webglcontextlost", this.#onContextLost);
      canvas.removeEventListener(
        "webglcontextrestored",
        this.#onContextRestored,
      );
    }

    if (!this.#contextLost) {
      this.#program?.dispose();
      this.#spriteProgram?.dispose();
      this.#litProgram?.dispose();
      this.#standardProgram?.dispose();
      this.#particlePrograms?.dispose();
      this.#effectProgram?.dispose();
      this.#shadowProgram?.dispose();
      this.#skinnedPrograms?.dispose();
      this.#nodePrograms?.dispose();
      this.#geometries?.dispose();
      this.#textures?.dispose();
      this.#renderTargets?.dispose();
      this.batching?.dispose();
      if (this.#gl !== null) {
        this.#gpuTimer?.dispose(this.#gl);
      }
    }

    this.#program = null;
    this.#spriteProgram = null;
    this.#particlePrograms = null;
    this.#litProgram = null;
    this.#standardProgram = null;
    this.#effectProgram = null;
    this.#shadowProgram = null;
    this.#skinnedPrograms = null;
    this.#nodePrograms = null;
    // The one `RenderTarget` this renderer created for itself (R-18), so the
    // one it owes a `dispose()` to (§83) — its bytes leave the process-wide
    // totals here. The framebuffer behind it is the cache's and was released
    // above; an application's own targets are untouched, because the renderer
    // did not create them.
    this.#shadowTarget?.dispose();
    this.#shadowTarget = null;
    this.#geometries = null;
    this.#textures = null;
    this.#renderTargets = null;
    this.#gl = null;
    this.#canvas = null;
    this.#gpuTimer = null;
    this.events.removeAllListeners();
  }

  /** The body of {@link WebglRenderer.initialize}; see it for the contract. */
  #initializeSynchronously(options?: RendererOptions): void {
    this.#assertUsable("initialize");
    if (this.#gl !== null) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "WebglRenderer.initialize() was called twice; a renderer acquires one " +
          "context (§61).",
        { context: { method: "initialize" } },
      );
    }

    const canvas = requireCanvas(options?.canvas);
    // §67's masks need somewhere to write, and the drawing buffer is where a
    // *screen-space* mask (§73's overflow clipping, above all) has to write —
    // so `stencil` is an opt-in attribute rather than an always-on one. Off by
    // default, deliberately: a stencil buffer is memory every frame carries and
    // an extra clear every view issues, and a scene that never masks should pay
    // for neither. R-7, 2026-08-11; the attribute was hard-coded `false` until
    // then. An application that masks into a render target instead asks that
    // *target* for a stencil and leaves this alone.
    this.#stencil = options?.stencil ?? false;
    const raw = canvas.getContext("webgl2", {
      alpha: true,
      antialias: options?.antialias ?? false,
      depth: true,
      stencil: this.#stencil,
    });
    const gl = asContext(raw);
    if (gl === null) {
      throw new FourError(
        "RENDERER_INITIALIZATION_FAILED",
        "The canvas did not provide a WebGL 2 context (§62). WebGL 2 may be " +
          "unavailable, blocked, or the canvas may already hold a context of " +
          "another type.",
        { context: { received: raw === null ? "null" : typeof raw } },
      );
    }

    // All three eager programs are built before anything is stored, so a
    // shader failure leaves the renderer uninitialized rather than
    // half-initialized — and each failure disposes the ones already built.
    // Three since 2026-09-11 (eight before it): the particle, effect, shadow
    // and — by owner decision — standard pipelines moved behind
    // `register…Pipeline()` seams and compile on first use, the skinned
    // pair's way — see `#particlePrograms`, `#effectProgram`,
    // `#shadowProgram` and `#standardProgram`. `initialize` builds its
    // pipelines in a fixed order (unlit, sprite, lit), and the failure-path
    // tests reach the partial-disposal branches by index.
    const program = UnlitProgram.create(gl);
    let spriteProgram: SpriteProgram;
    try {
      spriteProgram = SpriteProgram.create(gl);
    } catch (error: unknown) {
      program.dispose();
      throw error;
    }
    let litProgram: LitProgram;
    try {
      litProgram = LitProgram.create(gl);
    } catch (error: unknown) {
      spriteProgram.dispose();
      program.dispose();
      throw error;
    }

    this.#canvas = canvas;
    this.#gl = gl;
    this.#program = program;
    this.#spriteProgram = spriteProgram;
    this.#litProgram = litProgram;
    this.#geometries = new GeometryCache(gl);
    this.#textures = new TextureCache(gl);
    this.#renderTargets = new RenderTargetCache(gl);
    this.#capabilities = readCapabilities(gl);
    this.#applyFixedState(gl);

    if (this.#sizeRequested) {
      // A resize that arrived before initialization wins over the canvas's
      // current attributes: it is the more recent instruction.
      this.#applySurfaceSize();
    } else {
      this.#bufferWidth = canvas.width;
      this.#bufferHeight = canvas.height;
    }

    canvas.addEventListener("webglcontextlost", this.#onContextLost);
    canvas.addEventListener("webglcontextrestored", this.#onContextRestored);
  }

  /**
   * The registered standard pipeline's program for this context, compiled on
   * the first `"standard"` item, or `null` when there is nothing to draw a
   * §59 surface with (2026-09-11, owner decision). `#acquireShadowProgram`'s
   * three answers, naming `registerStandardPipeline()`; the draw is skipped,
   * never approximated with the Lambert pipeline.
   */
  #acquireStandardProgram(gl: ParticleGlContext): StandardPipeline | null {
    const existing = this.#standardProgram;
    if (existing !== null) {
      return existing;
    }
    if (this.#standardProgramFailed) {
      return null;
    }
    const factory = resolveStandardPipelineFactory();
    if (factory === null) {
      if (DEV) {
        devWarnOnce(
          "webgl-standard-unregistered",
          "§59: this scene uses a StandardMaterial but no standard pipeline " +
            "is registered, so those draws are skipped (a Lambert stand-in " +
            "would be a different picture). Call registerStandardPipeline() " +
            "from the render-webgl package at application setup.",
        );
      }
      return null;
    }
    try {
      const compiled = factory.create(gl);
      this.#standardProgram = compiled;
      return compiled;
    } catch (error: unknown) {
      this.#standardProgramFailed = true;
      if (DEV) {
        devWarnOnce(
          "webgl-standard-compile-failed",
          "§59: the standard pipeline failed to compile on this context; " +
            `StandardMaterial draws are skipped (§61, §89). ${String(error)}`,
        );
      }
      return null;
    }
  }

  /**
   * The registered shadow pipeline's caster program for this context,
   * compiled on the first shadowed frame, or `null` when there is nothing to
   * render a map with (§69; 2026-09-11).
   *
   * The three answers of `#acquireSkinnedPrograms`, and the same §61 terms:
   * **compiled already** — one field read; **nothing registered** — `null`
   * with a one-time §85 warning naming `registerShadowPipeline()`, and the
   * frame's lit surfaces draw unshadowed (lights still work; a map is the
   * only thing missing); **the compile failed** — `null` forever on this
   * context, with a one-time warning carrying the driver's §89 failure. A
   * context restore clears the latch.
   */
  #acquireShadowProgram(gl: ParticleGlContext): ShadowCasterPipeline | null {
    const existing = this.#shadowProgram;
    if (existing !== null) {
      return existing;
    }
    if (this.#shadowProgramFailed) {
      return null;
    }
    const factory = resolveShadowPipelineFactory();
    if (factory === null) {
      if (DEV) {
        devWarnOnce(
          "webgl-shadow-unregistered",
          "§69: this scene's light asks for a shadow map but no shadow " +
            "pipeline is registered, so the shadow pass is skipped and lit " +
            "surfaces draw unshadowed. Call registerShadowPipeline() from " +
            "the render-webgl package at application setup.",
        );
      }
      return null;
    }
    try {
      const compiled = factory.create(gl);
      this.#shadowProgram = compiled;
      return compiled;
    } catch (error: unknown) {
      // §61: a driver's compile refusal costs the shadow, never the frame.
      this.#shadowProgramFailed = true;
      if (DEV) {
        devWarnOnce(
          "webgl-shadow-compile-failed",
          "§69: the shadow pipeline failed to compile on this context; the " +
            `shadow pass is skipped (§61, §89). ${String(error)}`,
        );
      }
      return null;
    }
  }

  /**
   * The registered effect pipeline's program for this context, compiled on
   * the first fixed effect pass, or `null` when there is nothing to run the
   * pass with (§70; 2026-09-11). `#acquireShadowProgram`'s three answers,
   * naming `registerEffectPipeline()`; the pass is skipped, never quietly
   * copied.
   */
  #acquireEffectProgram(gl: ParticleGlContext): EffectPipeline | null {
    const existing = this.#effectProgram;
    if (existing !== null) {
      return existing;
    }
    if (this.#effectProgramFailed) {
      return null;
    }
    const factory = resolveEffectPipelineFactory();
    if (factory === null) {
      if (DEV) {
        devWarnOnce(
          "webgl-effect-unregistered",
          "§70: this render graph runs an effect pass but no effect " +
            "pipeline is registered, so the pass is skipped. Call " +
            "registerEffectPipeline() from the render-webgl package at " +
            "application setup.",
        );
      }
      return null;
    }
    try {
      const compiled = factory.create(gl);
      this.#effectProgram = compiled;
      return compiled;
    } catch (error: unknown) {
      this.#effectProgramFailed = true;
      if (DEV) {
        devWarnOnce(
          "webgl-effect-compile-failed",
          "§70: the effect pipeline failed to compile on this context; " +
            `effect passes are skipped (§61, §89). ${String(error)}`,
        );
      }
      return null;
    }
  }

  /**
   * The registered particle pipeline's programs and caches for this context,
   * created on the first particle item, or `null` when there is nothing to
   * draw particles with (§36; 2026-09-11). `#acquireShadowProgram`'s three
   * answers, naming `registerParticlePipeline()`; the item is skipped, never
   * approximated.
   */
  #acquireParticlePrograms(gl: ParticleGlContext): ParticlePrograms | null {
    const existing = this.#particlePrograms;
    if (existing !== null) {
      return existing;
    }
    if (this.#particleProgramsFailed) {
      return null;
    }
    const factory = resolveParticlePipelineFactory();
    if (factory === null) {
      if (DEV) {
        devWarnOnce(
          "webgl-particles-unregistered",
          "§36: this scene contains a particle system but no particle " +
            "pipeline is registered, so its draws are skipped. Call " +
            "registerParticlePipeline() from the render-webgl package at " +
            "application setup.",
        );
      }
      return null;
    }
    try {
      const created = factory.create(gl);
      this.#particlePrograms = created;
      return created;
    } catch (error: unknown) {
      this.#particleProgramsFailed = true;
      if (DEV) {
        devWarnOnce(
          "webgl-particles-compile-failed",
          "§36: the particle pipeline failed to compile on this context; " +
            `particle draws are skipped (§61, §89). ${String(error)}`,
        );
      }
      return null;
    }
  }

  /**
   * The registered skinning pipeline's programs for this context, compiled on
   * first use, or `null` when there is nothing to draw skinned with (§54;
   * RFC 0003).
   *
   * Three answers, all §61-safe (never a throw from inside the frame):
   *
   * - **compiled already** — the pair, one field read;
   * - **nothing registered** — `null`, with a one-time §85 development
   *   warning naming `registerSkinningPipeline()`; the skinned draw is
   *   skipped rather than shown in bind pose (RFC 0003 §5);
   * - **the compile failed** — `null` forever on this context (the latch),
   *   with a one-time warning carrying the driver's §89 failure; a context
   *   restore clears the latch, because a fresh context may compile.
   */
  #acquireSkinnedPrograms(gl: ParticleGlContext): SkinnedPrograms | null {
    const existing = this.#skinnedPrograms;
    if (existing !== null) {
      return existing;
    }
    if (this.#skinnedProgramsFailed) {
      return null;
    }
    const factory = resolveSkinningPipelineFactory();
    if (factory === null) {
      if (DEV) {
        devWarnOnce(
          "webgl-skinning-unregistered",
          "§54: this scene contains a skinned mesh but no skinning pipeline " +
            "is registered, so its draws are skipped (a bind pose would be " +
            "a different picture). Call registerSkinningPipeline() from " +
            "the render-webgl package" +
            " at application setup (RFC 0003).",
        );
      }
      return null;
    }
    try {
      const compiled = factory.create(gl);
      this.#skinnedPrograms = compiled;
      return compiled;
    } catch (error: unknown) {
      // §61: a driver's compile refusal costs skinning, never the frame. The
      // latch keeps a refusing driver from being asked once per skinned item.
      this.#skinnedProgramsFailed = true;
      if (DEV) {
        devWarnOnce(
          "webgl-skinning-compile-failed",
          "§54: the skinning pipeline failed to compile on this context; " +
            `skinned draws are skipped (§61, §89). ${String(error)}`,
        );
      }
      return null;
    }
  }

  /**
   * The registered skinning pipeline's depth-only caster for this context,
   * compiled on the first skinned caster, or `null` when there is nothing to
   * draw a deformed silhouette with (§54, §69; RFC 0003 residue).
   *
   * Separate from `#acquireSkinnedPrograms`: the colour pair compiles on the
   * first skinned colour draw, and this program must not ride along — a
   * skinned mesh that does not cast must not add a third `createProgram`. A
   * colour-pair failure (unregistered, or a refusing driver) skips skinned
   * casters the way it skips skinned colour draws: a bind-pose shadow is a
   * different picture. A caster-only compile failure latches here and leaves
   * colour skinning alone.
   */
  #acquireSkinnedShadowProgram(
    gl: ParticleGlContext,
  ): SkinnedShadowPipeline | null {
    if (this.#skinnedShadowFailed) {
      return null;
    }
    const programs = this.#acquireSkinnedPrograms(gl);
    if (programs === null) {
      return null;
    }
    try {
      return programs.acquireShadow();
    } catch (error: unknown) {
      this.#skinnedShadowFailed = true;
      if (DEV) {
        devWarnOnce(
          "webgl-skinned-shadow-compile-failed",
          "§69: the skinned shadow pipeline failed to compile on this " +
            `context; skinned casters are skipped (§61, §89). ${String(error)}`,
        );
      }
      return null;
    }
  }

  /**
   * The registered node-material program cache for this context, created on
   * first need, or `null` when nothing registered (§60; RFC 0001).
   *
   * Two answers, both §61-safe: **created already** — one field read; or
   * **nothing registered** — `null`, with a one-time §85 development warning
   * naming `registerNodeMaterialPipeline()`, and the node draw (or §70 graph
   * effect) is skipped rather than approximated. Creation compiles nothing —
   * per-graph compiles and their per-graph failure latch live in the cache
   * (`gl-node-program.ts`), so no compile-failure latch is needed here.
   */
  #acquireNodePrograms(gl: ParticleGlContext): NodeMaterialPrograms | null {
    const existing = this.#nodePrograms;
    if (existing !== null) {
      return existing;
    }
    const factory = resolveNodeMaterialPipelineFactory();
    if (factory === null) {
      if (DEV) {
        devWarnOnce(
          "webgl-node-material-unregistered",
          "§60: this scene uses a node material (or §70 graph effect) but no " +
            "node pipeline is registered, so those draws are skipped (flat " +
            "colour would be a different picture). Call " +
            "registerNodeMaterialPipeline() from the render-webgl package at " +
            "application setup (RFC 0001).",
        );
      }
      return null;
    }
    const created = factory.create(gl);
    this.#nodePrograms = created;
    return created;
  }

  /**
   * Draws one §70 **graph** effect (§60; RFC 0001) — the graph-shaped arm of
   * {@link WebglRenderer.renderEffect}, bound by the same three rules and the
   * same F13 envelope.
   *
   * The graph's samplers resolve against the pass's declared inputs:
   * `"source"` is the pass's source record, every other name reads
   * `effect.textures`. Anything that will not resolve — an unregistered
   * pipeline, a graph the driver refused (latched per graph by the cache), a
   * missing or disposed input, or an input that **is** the destination
   * (R-4's feedback rule, applied per sampled surface) — skips the effect
   * entirely, before any state is touched (§61, §83).
   */
  #renderGraphEffect(
    gl: ParticleGlContext,
    pass: EffectRenderPass,
    effect: GraphEffect,
    sourceRecord: RenderTargetRecord,
    destinationRecord: RenderTargetRecord | null,
    destination: RenderTargetArgument | null,
    renderTargets: RenderTargetCache,
  ): void {
    const nodePrograms = this.#acquireNodePrograms(gl);
    if (nodePrograms === null) {
      return;
    }
    const program = nodePrograms.acquire(effect.graph);
    if (program === null) {
      return;
    }
    const samplers = program.textures;
    for (let unit = 0; unit < samplers.length; unit += 1) {
      const name = samplers[unit];
      let handle: GlTexture | null = null;
      if (name === "source") {
        handle = sourceRecord.texture;
      } else {
        const input = effect.textures?.[name];
        if (input !== undefined && isRenderTargetTexture(input)) {
          const inputTarget = input.renderTarget;
          if (inputTarget !== destination) {
            handle = renderTargets.acquire(inputTarget)?.texture ?? null;
          }
        }
      }
      if (handle === null) {
        return;
      }
      nodeTextureScratch[unit] = handle;
    }

    const width = destinationRecord?.width ?? this.#bufferWidth;
    const height = destinationRecord?.height ?? this.#bufferHeight;
    const state = this.#glState;
    const statistics = this.statistics;
    let unitsBound = 0;

    try {
      if (destinationRecord !== null) {
        gl.bindFramebuffer(GL.FRAMEBUFFER, destinationRecord.framebuffer);
      }
      // Full destination, or `pass.rect` — same helper as the fixed path.
      applyEffectDestination(gl, pass, width, height);
      applyBlendState(gl, state, false, "normal");
      applyDepthColorState(gl, state, false, true, true);

      program.use();
      const uniforms = effect.uniforms;
      if (uniforms !== undefined) {
        // Sorted so the upload order is a function of the pass, not of a
        // record's key order (§33). Setup-scale work: an effect pass draws
        // once, not once per item.
        for (const name of Object.keys(uniforms).sort()) {
          const value = uniforms[name];
          if (typeof value === "number") {
            effectUniformScratch[0] = value;
            program.setUniform(name, effectUniformScratch);
          } else {
            program.setUniform(name, value);
          }
        }
      }
      program.setTime(this.renderTime);
      for (let unit = 0; unit < samplers.length; unit += 1) {
        // A "screen" program's units start at 0 (`unitBase`); the fixed
        // shadow/map units belong to scene frames, not effect draws.
        gl.activeTexture(GL.TEXTURE0 + program.unitBase + unit);
        gl.bindTexture(GL.TEXTURE_2D, nodeTextureScratch[unit]);
        unitsBound += 1;
      }
      // No vertex data at all — the triangle's corners come from
      // `gl_VertexID`, exactly as the fixed effect pipeline's do.
      gl.bindVertexArray(null);
      gl.drawArrays(GL.TRIANGLES, 0, EFFECT_VERTEX_COUNT);
      if (statistics !== null) {
        countDraw(statistics, GL.TRIANGLES, EFFECT_VERTEX_COUNT, 1);
      }
    } finally {
      restoreGlState(gl, state);
      for (let unit = unitsBound - 1; unit >= 0; unit -= 1) {
        gl.activeTexture(GL.TEXTURE0 + program.unitBase + unit);
        gl.bindTexture(GL.TEXTURE_2D, null);
      }
      // The loop above ends with unit `unitBase` selected — 0 for every
      // screen program — so nothing further to restore; a samplerless graph
      // touched no unit at all.
      if (destinationRecord !== null) {
        gl.bindFramebuffer(GL.FRAMEBUFFER, null);
      }
    }
  }

  /**
   * Renders §69's directional shadow map and returns the framebuffer record it
   * drew into, or `null` if the map could not be produced (R-18, 2026-08-09).
   *
   * Called from inside {@link WebglRenderer.render}'s F13 envelope, once per
   * frame, before the view loop — see the call site for why this is
   * backend-internal rather than a §63 graph pass. **Never throws**, on the
   * same terms as the rest of the frame (§61): a target GL will not allocate,
   * or a framebuffer that is not complete, costs the frame its shadows and
   * nothing else.
   *
   * ## What it draws
   *
   * The frame's own render list, filtered twice: to the items whose node set
   * §49's `castShadow`, and to the *surface* kinds a depth-only pass can
   * honestly draw. Sprites are excluded because a depth-only pass writes
   * geometry rather than alpha, so a §55 quad would cast its rectangle instead
   * of its texture — §69's transparent shadow masks are what fix that, and they
   * are staged. Particle items carry `castShadow: false` from the list builder
   * and are excluded by that; their trails are never drawn here.
   *
   * Skinned casters (`skinned-unlit` / `skinned-lit`) draw through the lazy
   * skinned shadow program when the skinning pipeline is registered, so the
   * map holds the **deformed** silhouette. Unregistered or failed skinning
   * skips them — a bind-pose shadow is a different picture (RFC 0003 §5).
   *
   * Drawing from the *list* rather than re-walking the scene is what makes the
   * caster pass and the colour pass agree by construction: same items, same
   * order, same `worldMatrix` — including §43's interpolated render pose, which
   * the list already resolved. That is also the whole of the pass's §33 story
   * (`gl-shadow.ts`).
   *
   * §46's layer masks are deliberately **not** applied here, and that is a
   * decision rather than an omission: a layer mask belongs to a *view* (§48),
   * while this map is frame state shared by every view of the frame. Filtering
   * by one view's mask would make the shadows in the other views depend on
   * which viewport happened to be first. A caster that no camera can see still
   * occludes; hiding it from the map is `castShadow`'s job, which is per-node
   * and therefore view-independent.
   *
   * ## State
   *
   * It borrows the framebuffer binding, the viewport and scissor rectangles,
   * and the current program; the caller re-binds the framebuffer, and the view
   * loop rewrites the rectangles and the program before its first draw, exactly
   * as it does after `renderEffect`. §57's blend and depth/colour mirror is
   * moved through `applyMaterialState` with no material, i.e. to the opaque,
   * depth-writing state a frame starts in — which issues no call, since that is
   * where the frame already is.
   */
  #renderShadowMap(
    gl: ParticleGlContext,
    items: readonly RenderItem[],
    renderTargets: RenderTargetCache,
    geometries: GeometryCache,
    shadowProgram: ShadowCasterPipeline,
    state: GlState,
    statistics: RenderStatistics | null,
  ): RenderTargetRecord | null {
    const size = sceneLights.shadowMapSize;
    let target = this.#shadowTarget;
    if (target === null) {
      // The one target this renderer owns, described the first time a frame
      // asks for a shadow. `depthTexture` is the whole point (R-4's residue):
      // the pass writes depth and the shaded pipelines sample it.
      target = new RenderTarget({
        width: size,
        height: size,
        depthTexture: true,
      });
      this.#shadowTarget = target;
    } else if (target.width !== size) {
      // `mapSize` changed. Resizing bumps the version, which is what makes the
      // framebuffer cache re-allocate at the new size on this very frame (R-4)
      // — a new `RenderTarget` would leak the old one's §83 accounting instead.
      target.resize(size, size);
    }

    const record = renderTargets.acquire(target);
    if (record === null || record.depthTexture === null) {
      return null;
    }

    gl.bindFramebuffer(GL.FRAMEBUFFER, record.framebuffer);
    // The whole map, always: unlike a view, a shadow pass has no sub-rectangle
    // to honour, and the scissor has to be opened to the full attachment or the
    // clear below would only reach the previous view's rectangle
    // (`SCISSOR_TEST` is enabled for the renderer's lifetime).
    gl.scissor(0, 0, record.width, record.height);
    gl.viewport(0, 0, record.width, record.height);
    applyMaterialState(gl, state, undefined, false);
    gl.clearDepth(1);
    // Depth only. The colour attachment is written by the caster stage and read
    // by nothing (`gl-shadow.ts`), so clearing it would be a call whose result
    // no one can observe.
    gl.clear(GL.DEPTH_BUFFER_BIT);

    shadowProgram.use();
    shadowProgram.setViewProjection(sceneLights.shadowMatrix);
    // `"shadow"` / `"skinned-shadow"` rather than `RenderItemKind`: the caster
    // pass has two programs for what the colour pass splits across families,
    // and switching when the kind changes is the colour loop's `activeKind`
    // rule applied to that pair. View-projection is per-program, so the
    // unskinned upload above stays valid across a switch away and back; the
    // skinned program gets its own copy the first time it is current.
    let activeKind: "shadow" | "skinned-shadow" = "shadow";
    let skinnedShadowViewUploaded = false;
    for (const item of items) {
      // §67's clip is deliberately not consulted here (R-23). A stencil clip
      // is a per-view, screen-space construct and this framebuffer carries no
      // stencil attachment (R-7: samplable depth is a DEPTH_COMPONENT24
      // texture, which structurally excludes the packed stencil format), so a
      // clipped surface casts its **whole** shadow — the §69 analogue of a
      // sprite casting its rectangle, and honest for the same reason: a
      // depth-only pass writes geometry, not visibility. Mask draws never
      // reach this loop at all; the list builder writes `castShadow: false`
      // on every one, because a mask is not content.
      // §60 (RFC 0001): a node material with **no** displacement casts its
      // geometry exactly — depth ignores colour, so the caster program is
      // right for it — but one whose graph displaces vertices would cast its
      // *undisplaced* silhouette, which is a different picture (the skinned
      // bind-pose rule, one pipeline over), so those casters are skipped.
      if (
        !item.castShadow ||
        item.kind === "sprite" ||
        (item.kind === "node" &&
          item.material.graph.positionOffset !== undefined)
      ) {
        continue;
      }
      if (isSkinnedUnlitItem(item) || isSkinnedLitItem(item)) {
        const skinnedShadow = this.#acquireSkinnedShadowProgram(gl);
        if (skinnedShadow === null) {
          continue;
        }
        const geometry = geometries.acquire(item.geometry);
        if (geometry === null) {
          continue;
        }
        if (activeKind !== "skinned-shadow") {
          skinnedShadow.use();
          activeKind = "skinned-shadow";
        }
        if (!skinnedShadowViewUploaded) {
          skinnedShadow.setViewProjection(sceneLights.shadowMatrix);
          skinnedShadowViewUploaded = true;
        }
        skinnedShadow.setModel(item.worldMatrix);
        skinnedShadow.setJointMatrices(item.jointMatrices);
        gl.bindVertexArray(geometry.vertexArray);
        if (geometry.indexType === null) {
          gl.drawArrays(geometry.mode, 0, geometry.count);
        } else {
          gl.drawElements(geometry.mode, geometry.count, geometry.indexType, 0);
        }
        if (statistics !== null) {
          countDraw(statistics, geometry.mode, geometry.count, 1);
        }
        continue;
      }
      const geometry = geometries.acquire(item.geometry);
      if (geometry === null) {
        continue;
      }
      if (activeKind !== "shadow") {
        shadowProgram.use();
        activeKind = "shadow";
      }
      shadowProgram.setModel(item.worldMatrix);
      gl.bindVertexArray(geometry.vertexArray);
      if (geometry.indexType === null) {
        gl.drawArrays(geometry.mode, 0, geometry.count);
      } else {
        gl.drawElements(geometry.mode, geometry.count, geometry.indexType, 0);
      }
      if (statistics !== null) {
        // A caster pass draw is a draw (§84): it costs a submission and its
        // triangles, and a frame that suddenly doubled its draw calls should
        // say so rather than hide the second pass from the counter that exists
        // to find it.
        countDraw(statistics, geometry.mode, geometry.count, 1);
      }
    }
    return record;
  }

  /** The fixed GL state — see the class documentation for each choice. */
  #applyFixedState(gl: ParticleGlContext): void {
    gl.enable(GL.DEPTH_TEST);
    gl.depthFunc(GL.LEQUAL);
    gl.frontFace(GL.CCW);
    gl.disable(GL.CULL_FACE);
    gl.enable(GL.SCISSOR_TEST);
    // The blend *function* is fixed (§66 straight alpha); the blend *enable* is
    // not — it is toggled around sprite runs by `render`. GL's initial state
    // already has `BLEND` disabled, so nothing is disabled here.
    gl.blendFunc(GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA);
  }

  /** Pushes the recorded drawing-buffer size onto the canvas. */
  #applySurfaceSize(): void {
    const canvas = this.#canvas;
    if (canvas === null) {
      return;
    }
    canvas.width = this.#bufferWidth;
    canvas.height = this.#bufferHeight;
  }

  /** Throws unless the renderer is usable and initialized. */
  #requireContext(method: string): ParticleGlContext {
    this.#assertUsable(method);
    const gl = this.#gl;
    if (gl === null) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        `WebglRenderer.${method}() was called before initialize() (§61).`,
        { context: { method, initialized: false } },
      );
    }
    return gl;
  }

  /** Throws when the renderer has been disposed (§83). */
  #assertUsable(method: string): void {
    if (this.#disposed) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        `WebglRenderer.${method}() was called on a disposed renderer; ` +
          "disposal is terminal (§83).",
        { context: { method, disposed: true } },
      );
    }
  }
}
