/**
 * Draws fourJS scenes with WebGPU (§61, §62 backend 1).
 *
 * ```ts
 * const renderer = new WebgpuRenderer();
 * await renderer.initialize({ canvas });
 * renderer.resize(800, 600, devicePixelRatio);
 * renderer.render(scene, [createFullscreenViewport(camera)]);
 * // …
 * renderer.dispose();
 * ```
 *
 * This is WP-R1.1 through WP-R1.7 of the R-1 plan: device and context
 * acquisition, the registry opt-in, per-view clears, the **unlit** tier —
 * flat, vertex-coloured and §57-`map`-textured — plus WP-R1.3's **sprite**
 * pipeline (§55; §56's `Text` needs nothing more — a label is one textured
 * unlit draw, R-28), the opt-in §65 **batching** uploader (`wgpu-batch.ts`),
 * §67's **clip** application (masks write stencil bit planes, clipped
 * draws test them — see `DEPTH_STENCIL_FORMAT` below for the per-frame
 * stencil-format decision), WP-R1.5's two **shaded** tiers — §68's
 * Lambert `lit` family and §59's metallic-roughness `standard` family, both
 * under one per-view light uniform block (`wgpu-lights.ts`) — and WP-R1.6's
 * off-screen tier: **render targets** (`wgpu-render-target.ts`, sampled back
 * through R-4's `resolveTexture` seam with the same feedback refusal), §70's
 * **effects** (`renderEffect`, `wgpu-effect.ts`), and §61's **`readPixels`**
 * (`wgpu-readback.ts` — the whole-target, honestly asynchronous form). All of
 * it drawn through the real `buildRenderList` → `buildViewRenderList` → draw
 * path; WP-R1.4 added no pipeline — §50 shapes and §58 paints were already
 * ordinary unlit draws, and that packet's deliverable is the
 * transcript-identity tests saying so. WP-R1.7 lands §69's **shadow** tier
 * (`wgpu-shadow.ts`: a depth-only caster pass into the renderer's own
 * samplable target, the comparison-sampler bindings, and a lazy `shadow`
 * variant of both shaded families) and completes §57 **stencil parity**
 * (`wgpu-stencil.ts`: R-7's mask-by-hand tier now selects the stencil format
 * on clipless frames too). WP-R1.8 lands §36's **particle** pipeline
 * (`wgpu-particles.ts`: the instanced billboard port of `gl-particles.ts`,
 * one draw per system over the shared unit quad and a per-system instance
 * buffer) and §82's **compute** tier (`wgpu-compute.ts`: `compute()`,
 * `createComputeBuffer`/`writeComputeBuffer`/`readComputeBuffer`, and the
 * §36 GPU particle integrator kernel — the first capability of this backend
 * WebGL 2 structurally cannot mirror). WP-R1.9 lands §60's **node
 * materials** and §70's **`"graph"` effect** (RFC 0001's WGSL emitter,
 * `wgpu-node-program.ts`, reached only through the
 * `registerWebgpuNodeMaterialPipeline()` seam in `wgpu-node-registry.ts`).
 * RFC 0003's skinned colour pair (`skinned-unlit` / `skinned-lit`) is
 * **opt-in** behind `registerSkinningPipeline()` — the pipeline-cost law's
 * registration seam, matching WebGL: the renderer imports only the registry
 * slot, and an unregistered (or failed) skinned draw is skipped, never
 * shown in bind pose. The §69 skinned caster compiles lazily through
 * `acquireShadow()` on the same pair — unregistered or failed casters
 * skip, never bind-pose. An
 * *unregistered* node material is skipped on the same terms. §71 picking is
 * **opt-in**: `createPickingService()` is declared (presence is the
 * capability, matching WebGL) and throws until `registerPickingPipeline()`
 * links `wgpu-picking.ts`. The id pass draws particle systems with one
 * colour per emitter (the §36 billboard, CPU 8-float instance stream) and
 * skinned meshes through a private skinned id pipeline (deformed
 * silhouette, never bind pose); trails stay undrawn. The one exception is
 * deliberate and narrow: a §67 **mask** is coverage, not shading, so a clip
 * node of any material family masks correctly today through the flat unlit
 * pipeline with colour writes off.
 *
 * ## `initialize()` finally earns its `Promise`
 *
 * `Renderer.initialize` has always been typed `Promise<void>`; `WebglRenderer`
 * fulfils it synchronously because `getContext` returns immediately. WebGPU
 * cannot: `requestAdapter` and `requestDevice` are genuinely asynchronous, and
 * this is the first implementation for which awaiting is not a formality. Every
 * failure along the way — no `navigator.gpu`, no adapter, no device, no canvas,
 * no `"webgpu"` context — rejects with a `FourError` carrying
 * `RENDERER_INITIALIZATION_FAILED` (§89), never a silent downgrade: §62 puts
 * backend *selection* and its fallback in the registry, not in a backend.
 *
 * ## Device loss is a promise, not an event pair (§61)
 *
 * WebGL 2 signals loss with two canvas events and needs `preventDefault()` on
 * the first of them to be promised a restore. WebGPU signals it with
 * `device.lost`, a promise on the device — a better fit for §61's "first-class
 * event, not an error case", and the reason `WebgpuCanvas` needs no event
 * target at all. On loss this renderer marks itself lost, drops every cache
 * (the allocations belong to a device that no longer exists) and emits
 * `contextlost`. It does **not** emit `contextrestored`: WebGPU has no
 * automatic restore — recovery is requesting a *new* device, which is an
 * application-level decision about whether to keep going — so promising a
 * restore this backend cannot deliver would be a lie the interface would carry
 * forever. `render` and `resize` return quietly while lost, as §61 requires.
 *
 * ## Colour space and the swap-chain format (§60a)
 *
 * The canvas is configured with the host's **preferred** format, which is
 * `"bgra8unorm"` on most hosts and **not** `"rgba8unorm"`. That never widens
 * `RenderTargetFormat`: the engine's `"rgba8"` means *eight-bit unsigned
 * normalised colour*, and channel order is a backend detail. A later reader
 * looking to "fix" the mismatch should read that sentence twice — the
 * descriptor is not describing memory layout, it is describing precision.
 *
 * ## Clip depth (§3.3.8 of the R-1 plan)
 *
 * WebGPU's NDC depth is `[0, 1]`; `@fourjs/math`'s projections are written to
 * WebGL's `[-1, 1]`. `Camera.updateProjectionMatrix` accepts `"zero-to-one"`
 * and would produce a native matrix — and this backend deliberately does not
 * call it. A renderer that rewrote an application-owned camera's projection
 * would corrupt any *other* renderer sharing that camera, and §61 is explicit
 * that rendering mutates nothing in the scene. So the remap is a
 * multiply-and-add in this backend's own vertex stage (`wgpu-unlit.ts`), the
 * frustum keeps culling against the un-remapped matrix in the one convention
 * both backends share, and the camera is left exactly as the application set
 * it.
 */

import { DEV, EventEmitter, FourError, devWarnOnce } from "@fourjs/core";
import { Frustum, Matrix3, Matrix4, type Rectangle2 } from "@fourjs/math";
import {
  COLOR_GRADE_DEFAULTS,
  RenderTarget,
  buildInterpolatedRenderList,
  buildRenderList,
  buildViewRenderList,
  MAX_SKINNING_JOINTS,
  collectSceneLights,
  createSceneLights,
  isRenderTargetTexture,
  isSkinnedLitItem,
  isSkinnedUnlitItem,
  intersectScissor,
  validateReadbackRegion,
  type EffectRenderPass,
  type RenderBatch,
  type PickingService,
  type RenderInterpolation,
  type RenderItem,
  type RenderStatistics,
  type Renderer,
  type RendererCapabilities,
  type RendererEventMap,
  type RendererOptions,
  type ScissorRect,
} from "@fourjs/render";
import type { Node, Viewport } from "@fourjs/scene";

import {
  GPU_BUFFER_USAGE,
  GPU_TEXTURE_USAGE,
  UNIFORM_STRIDE_BYTES,
  type Gpu,
  type GpuBindGroup,
  type GpuBindGroupLayout,
  type GpuBuffer,
  type GpuCanvasContext,
  type GpuCommandEncoder,
  type GpuDevice,
  type GpuRenderPassEncoder,
  type GpuRenderPipeline,
  type GpuSampler,
  type GpuTexture,
  type GpuTextureView,
  type WebgpuCanvas,
} from "./webgpu-device.js";
import {
  DRAW_COLOR_OFFSET,
  DRAW_MODEL_OFFSET,
  DRAW_NORMAL_OFFSET,
  DRAW_UNIFORM_BYTES,
  DRAW_VIEW_PROJECTION_OFFSET,
  MAP_BIND_GROUP_INDEX,
  createDrawBindGroupLayout,
} from "./wgpu-bindings.js";
// **`import type` only**, deliberately (R-9's seam, restated for this
// backend): a value import here would link §65's uploader — and the planner
// behind it — into every bundle that carries this renderer, whether the
// application batches or not. An application opts in by constructing one with
// `createWgpuBatching` and assigning it; see `wgpu-batch.ts`.
import type { WgpuRenderBatching } from "./wgpu-batch.js";
import {
  EFFECT_BIND_GROUP_INDEX,
  EFFECT_PASS_VERTEX_COUNT,
  EFFECT_UNIFORM_BYTES,
  createEffectBindGroupLayout,
  type WgpuEffectKind,
} from "./wgpu-effect.js";
import { WgpuGeometryCache, type WgpuGeometryRecord } from "./wgpu-geometry.js";
import { WgpuGpuTimer } from "./wgpu-gpu-timer.js";
import {
  LIGHTS_BIND_GROUP_INDEX,
  LIGHT_BINDING_BYTES,
  LIGHT_UNIFORM_STRIDE_BYTES,
  LIGHT_UNIFORM_STRIDE_FLOATS,
  SHADED_MAP_BIND_GROUP_INDEX,
  SHADED_MR_BIND_GROUP_INDEX,
  createLightsBindGroupLayout,
  writeLightUniforms,
} from "./wgpu-lights.js";
import {
  WgpuComputeCache,
  createComputeBuffer,
  readComputeBufferBytes,
  writeComputeBuffer,
  type ComputeBufferOptions,
  type ComputePassDescriptor,
  type WgpuComputeBuffer,
} from "./wgpu-compute.js";
import {
  PARTICLE_MODEL_OFFSET,
  PARTICLE_PROJECTION_OFFSET,
  PARTICLE_UNIFORM_BYTES,
  PARTICLE_VIEW_OFFSET,
  WgpuParticleCache,
  createParticleBindGroupLayout,
  type WgpuParticleRecord,
} from "./wgpu-particles.js";
import {
  WgpuParticleSimulation,
  type WgpuParticleSimulationOptions,
} from "./wgpu-particle-simulation.js";
import {
  WgpuPipelineCache,
  type WgpuPipelineDescriptor,
} from "./wgpu-pipeline-cache.js";
import {
  WgpuPipelineMemo,
  createPipelineRequest,
} from "./wgpu-pipeline-memo.js";
import { readTexturePixels } from "./wgpu-readback.js";
import {
  RENDER_TARGET_COLOR_FORMAT,
  WgpuRenderTargetCache,
  type WgpuRenderTargetRecord,
} from "./wgpu-render-target.js";
import {
  STANDARD_EMISSIVE_OFFSET,
  STANDARD_SURFACE_OFFSET,
  STANDARD_UNIFORM_BYTES,
  createStandardBindGroupLayout,
} from "./wgpu-standard.js";
import {
  SPRITE_UNIFORM_BYTES,
  createSpriteBindGroupLayout,
} from "./wgpu-sprite.js";
import {
  SHADOW_LIGHT_UNIFORM_BYTES,
  SHADOW_MAP_BINDING,
  SHADOW_SAMPLER_BINDING,
  createShadowLightsBindGroupLayout,
  createShadowSampler,
  writeShadowUniforms,
} from "./wgpu-shadow.js";
import {
  CLEAR_STENCIL,
  applyStencilReference,
  frameWantsStencil,
  stencilDescriptor,
} from "./wgpu-stencil.js";
import { WgpuTextureCache, type WgpuCacheableTexture } from "./wgpu-texture.js";
// The registry slot only, deliberately (the GL backend's node seam, restated):
// a value import of `wgpu-node-program.ts` would link the WGSL emitter and the
// pipeline store into every bundle that carries this renderer, whether the
// application draws a node material or not. `registerWebgpuNodeMaterialPipeline`
// is what links the heavy module; see `wgpu-node-registry.ts` for the seam.
import {
  resolveWebgpuNodeMaterialPipelineFactory,
  type WgpuNodeFrameState,
  type WgpuNodeMaterialPipelines,
} from "./wgpu-node-registry.js";
import {
  resolvePickingServiceFactory,
  type PickingRendererHost,
} from "./wgpu-picking-registry.js";
// The registry slot only, deliberately (the GL backend's skinning seam,
// restated): a value import of `wgpu-skinning.ts` would link the two
// skinned colour pipelines and the palette uploader into every bundle that
// carries this renderer. `registerSkinningPipeline` is what links the
// heavy module; see `wgpu-skinning-registry.ts` for the seam.
import {
  resolveSkinningPipelineFactory,
  type SkinnedPrograms,
  type SkinningPipelineHost,
  type WgpuSkinnedDrawDescriptor,
} from "./wgpu-skinning-registry.js";
import { CLEAR_VERTEX_COUNT } from "./wgpu-unlit.js";

/** Error code for use-after-dispose, mirroring the other two backends (§83, §89). */
const LIFECYCLE_ERROR_CODE = "INVALID_APPLICATION_STATE";

/** The depth format this tier allocates (§62's tier; `depth24plus` is universal). */
const DEPTH_FORMAT = "depth24plus";

/**
 * The depth format of a frame that clips (§67, WP-R1.3): the same 24-bit depth
 * plus the eight stencil bit planes `MAX_CLIP_PLANES` budgets — WebGPU's
 * spelling of the packed `DEPTH24_STENCIL8` the WebGL backend's `stencil`
 * option allocates, and guaranteed available on every device.
 *
 * **Per frame, not always** — the R-6 pipeline-cost law applied to a format:
 * the depth format is baked into every pipeline, so allocating stencil
 * unconditionally would re-key (and recompile) every pipeline of every
 * application and move every landed transcript's `createTexture` and
 * `createRenderPipeline` lines. Instead the frame asks `frameWantsStencil`
 * (WP-R1.7, `wgpu-stencil.ts`) — R-23's O(1) clip read plus a scan for §57
 * material stencils — and only a frame that actually masks pays for
 * stencil-carrying pipelines and the attachment's extra byte per pixel. A
 * scene that starts or stops masking reallocates the depth texture and
 * compiles the other format's pipelines once, which is the same class of
 * cost as its first frame; a scene that never masks records the WP-R1.1
 * transcript byte for byte.
 *
 * There is deliberately **no `stencil` renderer option and no no-stencil
 * diagnostic** here. The WebGL backend needs both because its stencil buffer
 * is a context-creation attribute it cannot add after the fact, so a clip can
 * arrive on a surface that has nowhere to write its mask. This backend owns
 * its depth attachment and can always allocate the stencil aspect the frame
 * needs — the diagnostic's condition is unreachable, and an option would gate
 * something that costs nothing when unused. R1.3's recorded residue — §57
 * `material.stencil` inert on clipless frames — is retired by the same scan
 * (WP-R1.7): R-7's mask-by-hand tier reaches the hardware on any on-screen
 * frame that names it, no option required.
 */
const DEPTH_STENCIL_FORMAT = "depth24plus-stencil8";

/**
 * Scratch for the per-draw `normalMatrix` pack in {@link WebgpuRenderer}.
 * Constructed once; `setNormalFromMatrix4` mutates in place and allocates
 * nothing (plan D7). Seeded to identity before each use so a singular model
 * (invert no-op) cannot leak the previous draw's inverse-transpose — the
 * math helper's documented policy, not a second one.
 */
const normalMatrixScratch = new Matrix3();

/** The swap-chain format used when the host will not name a preferred one. */
const FALLBACK_CANVAS_FORMAT = "bgra8unorm";

/** `UNIFORM_STRIDE_BYTES` in `Float32Array` elements. */
const UNIFORM_STRIDE_FLOATS = UNIFORM_STRIDE_BYTES / 4;

/**
 * The one dynamic-offset array every `setBindGroup` in this file passes
 * (performance audit 2026-09-11, finding A2).
 *
 * `setBindGroup` copies its `dynamicOffsets` sequence synchronously — the
 * WebGPU spec converts the sequence at call time — so reusing one array
 * across draws is safe on a real device, and the recording double copies
 * every array argument at record time (`recording-gpu.ts`'s `snapshot`), so
 * a transcript read after a later draw still reports this draw's offset. The
 * previous `[offset]` literal allocated one array per draw per frame.
 */
const dynamicOffsetScratch: number[] = [0];

/** `[offset]` without the allocation — see {@link dynamicOffsetScratch}. */
function dynamicOffset(offset: number): readonly number[] {
  dynamicOffsetScratch[0] = offset;
  return dynamicOffsetScratch;
}

/** An unlit render item (§64). */
type UnlitItem = Extract<RenderItem, { kind: "unlit" }>;

/** A sprite render item (§55, WP-R1.3). */
type SpriteItem = Extract<RenderItem, { kind: "sprite" }>;

/** A particle render item (§36, WP-R1.8) — one instanced draw per system. */
type ParticleItem = Extract<RenderItem, { kind: "particles" }>;

/** A shaded render item (§68 lit or §59 standard, WP-R1.5). */
type ShadedItem = Extract<RenderItem, { kind: "lit" | "standard" }>;

/** §59's material as this backend reads it — base colour, surface, §57 state. */
type StandardMaterialLike = Extract<
  ShadedItem,
  { kind: "standard" }
>["material"];

/**
 * The frame's flattened lighting (§68), pooled across frames exactly as the
 * GL backend's module-level record is: `collectSceneLights` rewrites every
 * field in place, and the frame consumes it synchronously. Only refreshed for
 * frames that contain a lit or standard item, so a scene that never shades
 * never pays the collection walk.
 */
const sceneLights = createSceneLights();

/**
 * Scratch for the grade's uniform upload (WP-R1.6) — one per module, exactly
 * like the GL backend's `gradeScratch`, and copied at record time by the
 * recording double, so per-call reuse cannot alias transcripts.
 */
const effectGradeScratch = new Float32Array(4);

/** §67's per-item clip record, non-null — `webgl-renderer.ts`'s `ItemClip`. */
type ItemClip = NonNullable<RenderItem["clip"]>;

/**
 * The `navigator`-shaped host object, read off `globalThis`.
 *
 * Read structurally rather than through a DOM type for this package's standing
 * reason: it compiles without `lib.dom`, and a double supplies its own `gpu`.
 */
interface GpuHost {
  readonly gpu?: Gpu;
}

/** Reads `navigator.gpu`, or `undefined` where WebGPU is absent (Node, an old browser). */
export function hostGpu(): Gpu | undefined {
  const navigatorLike = (globalThis as Record<string, unknown>)["navigator"];
  if (typeof navigatorLike !== "object" || navigatorLike === null) {
    return undefined;
  }
  const gpu = (navigatorLike as GpuHost).gpu;
  return typeof gpu === "object" &&
    gpu !== null &&
    typeof gpu.requestAdapter === "function"
    ? gpu
    : undefined;
}

/** Narrows `value` to a {@link WebgpuCanvas}, or throws `RENDERER_INITIALIZATION_FAILED`. */
function requireCanvas(value: unknown): WebgpuCanvas {
  if (typeof value !== "object" || value === null) {
    throw new FourError(
      "RENDERER_INITIALIZATION_FAILED",
      "The WebGPU backend needs a canvas: pass one as " +
        "`initialize({ canvas })` (§61, §45).",
      { context: { received: typeof value } },
    );
  }
  const candidate = value as Partial<WebgpuCanvas>;
  if (typeof candidate.getContext !== "function") {
    throw new FourError(
      "RENDERER_INITIALIZATION_FAILED",
      "The value passed as `canvas` is not a canvas: it has no getContext (§61).",
      { context: { received: typeof value } },
    );
  }
  return value as WebgpuCanvas;
}

/**
 * Narrows a `getContext("webgpu")` result to a {@link GpuCanvasContext}, or
 * returns `null` (the caller turns that into `RENDERER_INITIALIZATION_FAILED`).
 *
 * `configure` and `getCurrentTexture` are the discriminating pair: a canvas
 * that handed back a 2D context, or a stub implementing half the surface, is
 * rejected here rather than crashing on the first frame.
 */
function asCanvasContext(value: unknown): GpuCanvasContext | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Partial<GpuCanvasContext>;
  return typeof candidate.configure === "function" &&
    typeof candidate.getCurrentTexture === "function"
    ? (value as GpuCanvasContext)
    : null;
}

/**
 * Reads the §62 report off the device (WP-R1.1).
 *
 * Everything here is either a device limit or a feature query — no value is
 * assumed. Where a double omits `limits` or `features` the numeric members read
 * `0` and the boolean ones `false`, which is the same floor `NullRenderer`
 * reports and is honest about a device that will not say.
 *
 * `timestampQueries` is a genuine query and is expected to be **false in CI**:
 * SwiftShader does not implement `timestamp-query`. A test asserting the
 * *value* of a capability rather than its *shape* is a test that breaks on
 * somebody's laptop (R-1 plan §2.3), so the unit suite asserts the plumbing and
 * the browser gate asserts only that the record is complete.
 */
function readCapabilities(device: GpuDevice): RendererCapabilities {
  const limits = device.limits;
  const features = device.features;
  const has = (name: string): boolean => features?.has(name) ?? false;
  const limit = (name: string): number => limits?.[name] ?? 0;
  return Object.freeze({
    backend: "webgpu",
    maxTextureSize: limit("maxTextureDimension2D"),
    textureFormats: Object.freeze(["rgba8"]),
    multisampling: true,
    // WebGPU *devices* can render to `rgba16float`; this **backend** cannot
    // yet, because `RenderTargetFormat` is the single-member union `"rgba8"`
    // — WP-R1.6's targets allocate exactly that (`wgpu-render-target.ts`),
    // and the report moves when the union widens (R-4's staged format tier).
    // §62's report is about what the backend offers, not about what the
    // device could do if asked — the same stance the WebGL backend takes on
    // the same member.
    floatRenderTargets: false,
    timestampQueries: has("timestamp-query"),
    storageBuffers: limit("maxStorageBuffersPerShaderStage") > 0,
    computeShaders: limit("maxComputeWorkgroupSizeX") > 0,
    indirectDraw: true,
    compressedTextureFormats: Object.freeze(
      [
        "texture-compression-bc",
        "texture-compression-etc2",
        "texture-compression-astc",
      ].filter((name) => has(name)),
    ),
    shaderPrecision: "highp",
    maxUniformBufferBytes: limit("maxUniformBufferBindingSize"),
    maxBindings: limit("maxBindingsPerBindGroup"),
    // RFC 0003's declared joint limit — the same constant WebGL reports.
    // Registration (`registerSkinningPipeline`) is the application opting
    // in to paying for the pipelines; the capability says what this
    // backend *can* do.
    maximumSkinningJoints: MAX_SKINNING_JOINTS,
    // WebGPU exposes no standard anisotropy limit; 16 is the clamp
    // `wgpu-texture.ts` already uses when `limits.maxAnisotropy` is absent.
    // Reading a property of the device's existing `limits` record is not a
    // device call (R-30b's law is vacuous here).
    maxAnisotropy:
      typeof limits?.["maxAnisotropy"] === "number" &&
      limits["maxAnisotropy"] >= 1
        ? Math.floor(limits["maxAnisotropy"])
        : 16,
  } satisfies RendererCapabilities);
}

/** The resolved viewport rectangle, in §48's bottom-left pixel convention. */
interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Resolves a viewport's rectangle into drawing-buffer pixels — the same
 * arithmetic `webgl-renderer.ts` performs, kept identical on purpose so that
 * "the same viewport covers the same pixels on both backends" is true by
 * construction rather than by coincidence (§48).
 */
function resolveRect(
  view: Viewport,
  bufferWidth: number,
  bufferHeight: number,
  out: PixelRect,
): void {
  const scaleX = view.normalized === true ? bufferWidth : 1;
  const scaleY = view.normalized === true ? bufferHeight : 1;
  out.x = Math.round(view.x * scaleX);
  out.y = Math.round(view.y * scaleY);
  out.width = Math.max(0, Math.round(view.width * scaleX));
  out.height = Math.max(0, Math.round(view.height * scaleY));
}

/**
 * Intersects a per-item §67 scissor with the view rectangle and issues
 * `setScissorRect` in WebGPU's top-left space. Returns whether a restore
 * is owed. Default-off: a scene that never names a scissor issues the
 * same pass commands it issued before the field existed.
 */
function applyWgpuItemScissor(
  pass: { setScissorRect(x: number, y: number, w: number, h: number): void },
  view: ScissorRect,
  item: ScissorRect | null | undefined,
  surfaceHeight: number,
): boolean {
  if (item == null) {
    return false;
  }
  const cut = intersectScissor(view, item);
  const top = Math.max(0, surfaceHeight - (cut.y + cut.height));
  pass.setScissorRect(cut.x, top, cut.width, cut.height);
  return true;
}

/**
 * Turns a texture a material points at into the bind group to set, whichever
 * kind it is (R-4's `resolveTexture` seam, WP-R1.6) — the one place in the
 * draw path that knows there are two.
 *
 * An ordinary `Texture` resolves through {@link WgpuTextureCache}, exactly as
 * before — one marker read away from the call it always made, which is what
 * keeps a scene that never renders to texture byte-identical at the device
 * boundary. A render-target texture has no CPU texels — it *is* a target's
 * colour attachment — so it resolves through {@link WgpuRenderTargetCache}
 * instead, which allocates the target if this is the first the backend has
 * heard of it (sampling a never-rendered target reads WebGPU's zero-filled
 * allocation: transparent black, the GL answer).
 *
 * `null` means "skip this draw": a disposed resource, or — the case only this
 * function can see — a **feedback loop**, a material sampling the very target
 * this frame is drawing into. Reading and writing one surface in a single
 * pass is undefined behaviour on every backend, and undefined content is
 * worse than a missing draw (§83, R-4). Ping-pong between two targets to
 * express what that draw was reaching for.
 *
 * Returns the bind group itself rather than a record: the group is the one
 * member every draw arm sets, and wrapping it would allocate per draw.
 */
function resolveFrameTexture(
  textures: WgpuTextureCache,
  renderTargets: WgpuRenderTargetCache,
  activeTarget: RenderTarget | null,
  texture: WgpuCacheableTexture,
): GpuBindGroup | null {
  if (!isRenderTargetTexture(texture)) {
    return textures.acquire(texture)?.bindGroup ?? null;
  }
  const source = texture.renderTarget;
  if (source === activeTarget) {
    return null;
  }
  return renderTargets.sample(source);
}

function metalRoughnessMapOf(material: {
  metalRoughnessMap?: WgpuCacheableTexture | null;
}): WgpuCacheableTexture | null {
  return material.metalRoughnessMap ?? null;
}

/** Adds one *submitted* draw to §84's counters — the twin of the GL backend's. */
function countDraw(
  statistics: RenderStatistics,
  topology: string,
  vertexCount: number,
  instances: number,
): void {
  statistics.drawCalls += 1;
  statistics.instances += instances;
  if (topology === "triangle-list") {
    statistics.triangles += Math.floor(vertexCount / 3) * instances;
  }
}

/**
 * The WebGPU backend (§62 backend 1).
 *
 * ## Uniforms: one buffer, one bind group, a dynamic offset per draw
 *
 * See `wgpu-bindings.ts` for the layout and the argument. The consequence here
 * is the shape of a frame: the whole frame's uniform blocks are packed into one
 * CPU staging array while the command encoder records, uploaded with a single
 * `queue.writeBuffer` **before** `submit`, and read back by the recorded draws
 * through their dynamic offsets. Queue ordering makes that safe — a
 * `writeBuffer` enqueued before a `submit` is visible to it — and it means a
 * frame issues exactly one buffer upload however many objects it draws.
 *
 * The staging array and the GPU buffer are sized *before* recording, from an
 * upper bound (one block per view, plus one per view per item), so no
 * reallocation can happen mid-frame and invalidate the bind group the pass has
 * already been told to use. They only ever grow.
 *
 * ## One render pass per frame
 *
 * WebGPU's scissor and viewport are pass *commands*, not ambient device state,
 * so all the views of a frame are recorded into a single render pass with
 * `setViewport` / `setScissorRect` between them. This is the one place the
 * WebGPU backend is structurally safer than the GL one: there is no state
 * mirror to keep, nothing to restore in a `finally`, and a draw that throws
 * cannot leave state behind for the next frame — the pass is simply never
 * submitted.
 */
export class WebgpuRenderer implements Renderer {
  /** The §6b channel required by `Renderer` — `contextlost` (see the module header). */
  readonly events = new EventEmitter<RendererEventMap>();

  /**
   * §84's render counters (A-1). `null` until an application assigns a record;
   * the frame reads this once and every call site is guarded by that one
   * comparison, so a renderer with statistics off issues exactly the commands
   * it always did.
   */
  statistics: RenderStatistics | null = null;

  /**
   * Last completed GPU-frame duration in seconds (A-1). Reading this
   * getter is what arms `timestamp-query`; a renderer that never reads
   * it issues not one extra GPU command (R-30b).
   */
  get lastGpuFrameTimeSeconds(): number {
    this.#gpuTimer ??= new WgpuGpuTimer();
    this.#gpuTimer.arm();
    return this.#gpuTimer.lastGpuFrameTimeSeconds;
  }

  #gpuTimer: WgpuGpuTimer | null = null;

  #capabilities: RendererCapabilities = Object.freeze({
    backend: "webgpu",
    maxTextureSize: 0,
    textureFormats: Object.freeze([]),
    multisampling: false,
    floatRenderTargets: false,
    timestampQueries: false,
    storageBuffers: false,
    computeShaders: false,
    indirectDraw: false,
    compressedTextureFormats: Object.freeze([]),
    shaderPrecision: "none",
    maxUniformBufferBytes: 0,
    maxBindings: 0,
    // Declared joint limit, not a device query — same constant after
    // initialize. Registration is what compiles the pipelines.
    maximumSkinningJoints: MAX_SKINNING_JOINTS,
  } satisfies RendererCapabilities);

  #canvas: WebgpuCanvas | null = null;

  #context: GpuCanvasContext | null = null;

  #device: GpuDevice | null = null;

  #format = FALLBACK_CANVAS_FORMAT;

  #pipelines: WgpuPipelineCache | null = null;

  /**
   * The "same as the previous draw" pipeline fast path (audit A3,
   * `wgpu-pipeline-memo.ts`), with its one reusable request record. The
   * per-item draw arms fill the record and ask the memo; only a changed
   * request reaches `WgpuPipelineCache.acquire`.
   */
  readonly #pipelineMemo = new WgpuPipelineMemo();

  readonly #pipelineRequest = createPipelineRequest();

  #geometries: WgpuGeometryCache | null = null;

  #textures: WgpuTextureCache | null = null;

  /**
   * §61's render targets (WP-R1.6, `wgpu-render-target.ts`) — the fourth
   * id/version cache. Constructed at initialization (which allocates
   * nothing) and consulted only by a frame that names a target, an effect,
   * a readback, or a material sampling one.
   */
  #renderTargets: WgpuRenderTargetCache | null = null;

  #bindGroupLayout: GpuBindGroupLayout | null = null;

  #uniformBuffer: GpuBuffer | null = null;

  #bindGroup: GpuBindGroup | null = null;

  /**
   * §55's group-0 layout, created by the first sprite draw and by nothing
   * else (`wgpu-sprite.ts`) — the WP-R1.2 group-1 precedent, so a spriteless
   * application records the identical initialization transcript.
   */
  #spriteLayout: GpuBindGroupLayout | null = null;

  /**
   * The sprite draws' bind group over {@link WebgpuRenderer.#uniformBuffer} —
   * the same strided blocks, bound at {@link SPRITE_UNIFORM_BYTES} instead of
   * {@link DRAW_UNIFORM_BYTES}. Dropped (not destroyed — bind groups have no
   * `destroy`) whenever the buffer is regrown, and recreated by the next
   * sprite draw.
   */
  #spriteBindGroup: GpuBindGroup | null = null;

  /**
   * The standard draws' group-0 layout and bind group over the same strided
   * buffer, bound at {@link STANDARD_UNIFORM_BYTES} (WP-R1.5) — the sprite
   * pair's lifecycle verbatim: layout created by the first standard draw,
   * bind group dropped on regrowth and recreated by the next one.
   */
  #standardLayout: GpuBindGroupLayout | null = null;

  #standardBindGroup: GpuBindGroup | null = null;

  /**
   * §36's particle tier (WP-R1.8, `wgpu-particles.ts`), on the sprite pair's
   * lifecycle: the three-matrix group-0 layout and its bind group over the
   * same strided uniform buffer — layout created by the first particle draw,
   * group dropped on buffer regrowth and on device loss — plus the
   * per-system instance-buffer cache, constructed at initialization (which
   * allocates nothing) and consulted only by a frame that draws particles.
   */
  #particleLayout: GpuBindGroupLayout | null = null;

  #particleBindGroup: GpuBindGroup | null = null;

  #particles: WgpuParticleCache | null = null;

  /**
   * Which `render` call is running, for the once-per-frame instance upload
   * (`wgpu-particles.ts` on the cadence). Starts at 0 so a fresh record's
   * `uploadedFrame: 0` never matches a frame that has actually run.
   */
  #frameOrdinal = 0;

  /**
   * §82's compute caches (WP-R1.8, `wgpu-compute.ts`), created by the first
   * `compute()` call — the lazy-subsystem precedent, so an application that
   * never dispatches allocates none of it — and dropped whole on device loss
   * and disposal.
   */
  #compute: WgpuComputeCache | null = null;

  /**
   * §36 GPU particle simulations by emitting-node id (R-31 wiring,
   * 2026-08-29) — the draw-time join `createParticleSimulation` registers
   * into. The map holds registrations, not ownership: the application owns
   * each simulation's `dispose()` (§83), which unhooks itself here; device
   * loss clears the map whole (a dead device's residency cannot be drawn,
   * and there is no restore on WebGPU). Empty for every application that
   * never creates one, so the frame path's lookup is a miss against an
   * empty map and CPU-simulated scenes stay byte-identical.
   */
  readonly #particleSimulations = new Map<string, WgpuParticleSimulation>();

  /**
   * §60's registered node pipeline store (RFC 0001; WP-R1.9,
   * `wgpu-node-program.ts` through the `wgpu-node-registry.ts` slot), or
   * `null` — before the first frame that carries a `"node"` item or a §70
   * `"graph"` effect, when nothing is registered (those draws are then
   * skipped with a one-time §85 warning, never approximated), and again
   * after device loss (WebGPU has no restore; a next frame never runs).
   */
  #nodePipelines: WgpuNodeMaterialPipelines | null = null;

  /**
   * RFC 0003's registered skinned colour pair (`wgpu-skinning.ts` through
   * the `wgpu-skinning-registry.ts` slot), or `null` — before the first
   * skinned draw, when nothing is registered (those draws are then skipped
   * with a one-time §85 warning, never a bind pose), after a compile
   * failure (the latch), and again after device loss.
   */
  #skinnedPrograms: SkinnedPrograms | null = null;

  /**
   * Set when `factory.create` throws. A later skinned item on this device
   * must not retry — a refusing factory asked once per item would otherwise
   * succeed on a subsequent call.
   */
  #skinnedProgramsFailed = false;

  /**
   * The pooled per-draw state handed to node draws (plan D7: the frame loop
   * allocates nothing) — rewritten per draw, read synchronously, never
   * retained by the store (`WgpuNodeFrameState`'s contract).
   */
  readonly #nodeFrame: WgpuNodeFrameState = {
    viewProjection: new Matrix4(),
    renderTime: 0,
    colorFormat: FALLBACK_CANVAS_FORMAT,
    depthFormat: null,
    frameStencil: false,
    stencilReference: 0,
    activeTarget: null,
    statistics: null,
  };

  /**
   * §9 **render** time in seconds, read by §60 node graphs containing a
   * `time` node (RFC 0001) — and by nothing else in this backend. `0` by
   * default, so a time-less application pays nothing; the application (or
   * `Application`'s frame loop) writes it before `render`. Never simulation
   * time (§42/§43) — `WebglRenderer.renderTime`'s contract, verbatim.
   */
  renderTime = 0;

  /**
   * §68's per-view light block (WP-R1.5, `wgpu-lights.ts`): the group-1
   * layout, one buffer holding a 768-byte-strided block per rendered view,
   * the single bind group the shaded draws offset into, and the CPU staging
   * the view loop packs. All `null`/empty until the first frame that contains
   * a lit or standard item — the WP-R1.2 lazy-subsystem precedent — so an
   * unshaded application records not one of these allocations.
   */
  #lightsLayout: GpuBindGroupLayout | null = null;

  #lightsBuffer: GpuBuffer | null = null;

  #lightsBindGroup: GpuBindGroup | null = null;

  #lightsStaging = new Float32Array(0);

  /** Light blocks the buffer and staging can hold. Only grows. */
  #lightsCapacity = 0;

  /**
   * §70's grade uniform block (WP-R1.6, `wgpu-effect.ts`): the group-1
   * layout, the 16-byte buffer, and the one bind group over it. All `null`
   * until the first **grade** — a copy or an output transform binds no
   * uniforms at all, and an application that never runs an effect allocates
   * none of these (the lazy-subsystem precedent, fourth application).
   */
  #effectLayout: GpuBindGroupLayout | null = null;

  #effectBuffer: GpuBuffer | null = null;

  #effectBindGroup: GpuBindGroup | null = null;

  /**
   * §69's shadow tier (WP-R1.7, `wgpu-shadow.ts`), every member lazy on the
   * WP-R1.2 terms — a shadowless application allocates none of it:
   *
   * - the off-screen surface the caster pass draws into — the one
   *   `RenderTarget` this renderer *owns* (R-18's rule: it is the
   *   implementation of `castShadow`, not a surface an application composes
   *   with), allocated `depthTexture: true` so the cache's R1.6 format table
   *   answers `depth32float`, the samplable row;
   * - the widened group-1 layout, the shared comparison sampler, and the one
   *   bind group every receiving draw sets — over the *lights buffer* the
   *   unshadowed draws already offset into, plus the map's depth view. The
   *   group is dropped whenever either half moves: a lights-buffer regrowth
   *   (`#growLights`) or a reallocated map (`#shadowBindGroupView` tracks
   *   the view it was built against).
   */
  #shadowTarget: RenderTarget | null = null;

  #shadowLightsLayout: GpuBindGroupLayout | null = null;

  #shadowSampler: GpuSampler | null = null;

  #shadowBindGroup: GpuBindGroup | null = null;

  #shadowBindGroupView: GpuTextureView | null = null;

  /**
   * §65 batching, or `null` (the default) to batch nothing — the opt-in seam
   * R-9 recorded for the GL backend, restated here byte for byte: the field is
   * read once per frame, the whole no-batching cost is one comparison per
   * item, and this class names the uploader `import type` only, so a bundle
   * that never calls `createWgpuBatching` never links it.
   *
   * ```ts
   * import { createWgpuBatching } from "@fourjs/render-webgpu";
   * renderer.batching = createWgpuBatching();
   * ```
   */
  batching: WgpuRenderBatching | null = null;

  /** Blocks the uniform buffer and the staging array can hold. Only grows. */
  #uniformCapacity = 0;

  #uniformStaging = new Float32Array(0);

  #depthTexture: GpuTexture | null = null;

  #depthWidth = 0;

  #depthHeight = 0;

  /** The format `#depthTexture` holds — §67's clip frames upgrade it. */
  #depthFormat = DEPTH_FORMAT;

  /**
   * The colour format of the surface the **current** `render` call draws
   * into — the swap chain's for an on-screen frame,
   * {@link RENDER_TARGET_COLOR_FORMAT} for an off-screen one (WP-R1.6).
   * Written at the top of every frame and read by the descriptor builders,
   * so the six draw arms did not each grow a parameter; on-screen frames
   * write the value the arms always read, which is what keeps their
   * transcripts byte-identical.
   */
  #frameFormat = FALLBACK_CANVAS_FORMAT;

  #width = 300;

  #height = 150;

  #resolution = 1;

  #deviceLost = false;

  #disposed = false;

  /** The frame's render list, pooled across frames (§64, plan D7). */
  readonly #renderList: RenderItem[] = [];

  /** The current view's derived list, pooled across views and frames (R-8). */
  readonly #viewList: RenderItem[] = [];

  readonly #viewProjection = new Matrix4();

  readonly #frustum = new Frustum();

  readonly #rect: PixelRect = { x: 0, y: 0, width: 0, height: 0 };

  /** What this backend can do (§62), read off the device at initialization. */
  get capabilities(): RendererCapabilities {
    return this.#capabilities;
  }

  /** Whether {@link WebgpuRenderer.dispose} has run. Disposal is terminal. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** Whether the device has been lost (§61). A lost renderer draws nothing. */
  get deviceLost(): boolean {
    return this.#deviceLost;
  }

  /**
   * Acquires an adapter, a device and the canvas's `"webgpu"` context (§61,
   * §45).
   *
   * Rejects with a `FourError` carrying `RENDERER_INITIALIZATION_FAILED` (§89)
   * when there is no canvas, no `navigator.gpu`, no adapter (which is what a
   * browser without the WebGPU flag reports — `navigator.gpu` exists and
   * `requestAdapter()` resolves `null`; see `register.ts`), no device, or when
   * the canvas will not give up a WebGPU context. Calling it twice rejects with
   * `INVALID_APPLICATION_STATE`.
   *
   * Nothing is compiled here. Pipelines are created lazily on first use, which
   * is a deliberate departure from the WebGL backend's compile-at-init —
   * `wgpu-pipeline-cache.ts` carries the measured argument.
   */
  async initialize(options?: RendererOptions): Promise<void> {
    this.#assertUsable("initialize");
    if (this.#device !== null) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "WebgpuRenderer.initialize() was called twice; a renderer acquires " +
          "one device (§61).",
        { context: { method: "initialize" } },
      );
    }

    const canvas = requireCanvas(options?.canvas);
    const gpu = hostGpu();
    if (gpu === undefined) {
      throw new FourError(
        "RENDERER_INITIALIZATION_FAILED",
        "This environment has no `navigator.gpu`, so WebGPU is unavailable " +
          "(§62).",
      );
    }

    const adapter = await gpu.requestAdapter();
    if (adapter === null) {
      throw new FourError(
        "RENDERER_INITIALIZATION_FAILED",
        "WebGPU produced no adapter. `navigator.gpu` can exist in a browser " +
          "that cannot supply one — a disabled flag, a blocked GPU — which is " +
          "why initialization, not a synchronous probe, is the real gate (§62).",
      );
    }

    const timestampQueries = adapter.features?.has("timestamp-query") === true;
    const device = timestampQueries
      ? await adapter.requestDevice({
          requiredFeatures: ["timestamp-query"],
        })
      : await adapter.requestDevice();
    if (device === null) {
      throw new FourError(
        "RENDERER_INITIALIZATION_FAILED",
        "The WebGPU adapter produced no device (§62).",
      );
    }

    const context = asCanvasContext(canvas.getContext("webgpu"));
    if (context === null) {
      device.destroy();
      throw new FourError(
        "RENDERER_INITIALIZATION_FAILED",
        'The canvas would not give up a `"webgpu"` context, or gave up ' +
          "something that is not one (§61).",
      );
    }

    this.#canvas = canvas;
    this.#device = device;
    this.#context = context;
    this.#format = gpu.getPreferredCanvasFormat?.() ?? FALLBACK_CANVAS_FORMAT;
    this.#capabilities = readCapabilities(device);

    context.configure({
      device,
      format: this.#format,
      // Straight alpha, so a canvas composites with the page exactly as the
      // WebGL backend's `alpha: true` drawing buffer does (§60a).
      alphaMode: "premultiplied",
    });

    const bindGroupLayout = createDrawBindGroupLayout(device);
    this.#bindGroupLayout = bindGroupLayout;
    const textures = new WgpuTextureCache(device);
    this.#textures = textures;
    // Providers, not layouts: group 1 is created by the first textured
    // upload and by nothing else (`wgpu-texture.ts`), §55's group-0
    // layout by the first sprite draw (`wgpu-sprite.ts`), and the grade's
    // block by the first grade (`wgpu-effect.ts`) — so the pipelines
    // and the bind groups are built against one object each, without any
    // cache allocating anything at initialization.
    this.#pipelines = new WgpuPipelineCache(
      device,
      bindGroupLayout,
      () => textures.bindGroupLayout,
      () => this.#acquireSpriteLayout(device),
      () => this.#acquireLightsLayout(device),
      () => this.#acquireStandardLayout(device),
      () => this.#acquireEffectLayout(device),
      () => this.#acquireShadowLightsLayout(device),
      () => this.#acquireParticleLayout(device),
    );
    this.#geometries = new WgpuGeometryCache(device);
    // Constructed here because construction allocates nothing (the family
    // rule); a particle-less application records not one call from it.
    this.#particles = new WgpuParticleCache(device);
    // Constructed here because construction allocates nothing (the family
    // rule); its sampling layout provider is the texture cache's, so a
    // sampled target binds against the object every `map` pipeline names.
    this.#renderTargets = new WgpuRenderTargetCache(
      device,
      () => textures.bindGroupLayout,
    );
    this.#growUniforms(device, bindGroupLayout, 1);
    this.#watchDeviceLoss(device);
  }

  /**
   * Resizes the swap chain to `width` × `height` logical pixels at
   * `resolution` device pixels per logical pixel (§61, §45).
   *
   * The depth attachment is **not** reallocated here: it is allocated lazily by
   * the next frame that needs one, so a burst of resize events during a window
   * drag costs one allocation rather than one per event. Returns quietly while
   * the device is lost, recording the size for whenever a frame runs again.
   */
  resize(width: number, height: number, resolution = 1): void {
    this.#assertUsable("resize");
    this.#width = width;
    this.#height = height;
    this.#resolution = resolution;
    const canvas = this.#canvas;
    if (canvas === null || this.#deviceLost) {
      return;
    }
    canvas.width = Math.max(1, Math.round(width * resolution));
    canvas.height = Math.max(1, Math.round(height * resolution));
  }

  /**
   * Draws `root`'s subtree once per viewport, in array order (§61, §48, §64).
   *
   * The per-view sequence is: viewport rectangle, scissor rectangle, the clear
   * draw (`wgpu-unlit.ts` explains why a clear is a draw here), then this
   * view's items. §61's shared clear semantics hold unchanged — colour is
   * cleared only where the view carries a `clearColor`, depth is cleared for
   * every view, and both are confined to the rectangle.
   *
   * Items this tier has no pipeline for are skipped (see the module header),
   * as is a draw whose geometry will not upload. Returns without drawing
   * while the device is lost, when `views` is empty, and when `target` is a
   * disposed render target (§83's "disposed resources still in use" — the
   * frame must not draw into a released surface). An off-screen frame
   * (WP-R1.6) attaches the target's own colour and depth views, resolves its
   * viewport rectangles against the target's size, and bakes the target's
   * formats into its pipelines; everything else — clears, culling, the draw
   * arms — is the identical code path, which is what makes "the same scene
   * draws the same way off screen" true by construction.
   */
  render(
    root: Node,
    views: readonly Viewport[],
    interpolation?: RenderInterpolation,
    target?: RenderTarget | null,
  ): void {
    this.#assertUsable("render");
    const device = this.#device;
    const context = this.#context;
    const pipelines = this.#pipelines;
    const geometries = this.#geometries;
    const textures = this.#textures;
    const renderTargets = this.#renderTargets;
    const particles = this.#particles;
    const layout = this.#bindGroupLayout;
    if (
      device === null ||
      context === null ||
      pipelines === null ||
      geometries === null ||
      textures === null ||
      renderTargets === null ||
      particles === null ||
      layout === null ||
      this.#deviceLost ||
      views.length === 0
    ) {
      return;
    }

    // §36's once-per-frame instance-upload gate (WP-R1.8): pure CPU state,
    // advanced per render call, compared by nothing else — a particle-less
    // frame records not one call more or less for it.
    this.#frameOrdinal += 1;

    // §61's fourth argument (R-4): resolved before anything else, because a
    // disposed target skips the whole frame and an allocation is what gives
    // the frame its attachment views, size, and formats.
    const activeTarget = target ?? null;
    let targetRecord: WgpuRenderTargetRecord | null = null;
    if (activeTarget !== null) {
      targetRecord = renderTargets.acquire(activeTarget);
      if (targetRecord === null) {
        return;
      }
    }
    // The surface's colour format, baked into every pipeline this frame
    // acquires — the swap chain's on screen, `rgba8unorm` off screen
    // (`wgpu-render-target.ts` on why the two differ).
    this.#frameFormat =
      targetRecord === null ? this.#format : RENDER_TARGET_COLOR_FORMAT;

    const items =
      interpolation === undefined
        ? buildRenderList(root, this.#renderList)
        : buildInterpolatedRenderList(
            root,
            interpolation.poseBuffer,
            interpolation.alpha,
            this.#renderList,
          );

    // §67: does this frame *ask* to clip? One property read, not a scan —
    // mask draws carry the comparators' first key, so a frame that clips puts
    // one at `items[0]` (R-23). On screen the frame's depth format is
    // `frameWantsStencil`'s answer (WP-R1.7, `wgpu-stencil.ts`): that same
    // O(1) clip read, plus the material scan that retired R1.3's
    // material-stencil-inert-on-clipless-frames residue — R-7's mask-by-hand
    // tier now reaches the hardware on any frame that names it (see
    // `DEPTH_STENCIL_FORMAT` for why stencil stays per-frame rather than
    // always). Off screen the target's attachment is fixed at its
    // allocation, so whether the frame *may* stencil is the target's
    // `stencil` option — GL's `stencilAttached`, read off the record.
    const wantsClips = items.length > 0 && items[0].clip?.maskPass === true;
    // §60 (WP-R1.9): does this frame carry node materials, and is the node
    // pipeline registered? One `kind` comparison per item until the first
    // hit — the `hasLitItems` scan's shape — and the store is resolved (or
    // its absence warned, once) only for frames that actually carry one, so
    // a nodeless frame records not one call more or less for it. Resolved
    // *before* the stencil scan because a registered node item is a real
    // draw whose §57 stencil must reach `frameWantsStencil` (WP-R1.7's
    // parity), while an unregistered one must stay format-invisible.
    let hasNodeItems = false;
    for (const item of items) {
      if (item.kind === "node") {
        hasNodeItems = true;
        break;
      }
    }
    const nodePipelines = hasNodeItems
      ? this.#acquireNodePipelines(device, geometries, textures, renderTargets)
      : null;
    // RFC 0003: a registered skinned item is a real colour draw whose §57
    // stencil must reach `frameWantsStencil`; an unregistered one stays
    // format-invisible (the node-scan rule, second application). The
    // factory is read here — compiling still waits for the first skinned
    // draw — so a skinless frame records not one call more or less for it.
    const skinningRegistered = resolveSkinningPipelineFactory() !== null;
    const frameStencil =
      targetRecord === null
        ? frameWantsStencil(items, nodePipelines !== null, skinningRegistered)
        : targetRecord.stencil;
    const frameClips = wantsClips && frameStencil;
    // §67's exhaustion case, reachable here only off screen (the on-screen
    // attachment is this backend's own and always widens): a clip into a
    // stencil-less target has nowhere to write its mask, so the mask draws
    // are skipped and the subtree draws **unclipped** — failing toward
    // drawing, like the ninth clip (R-23), and warned like GL's same case.
    if (DEV && wantsClips && !frameStencil) {
      devWarnOnce(
        "webgpu-clip-without-stencil",
        "§67: this scene sets `clip = true` but the render target being " +
          "drawn into has no stencil buffer, so there is nothing to write " +
          "the mask into and the clipped subtrees draw unclipped. Give the " +
          "render target `{ stencil: true }` to allocate one (R-7).",
      );
    }
    const depthFormat: string | null =
      targetRecord === null
        ? frameStencil
          ? DEPTH_STENCIL_FORMAT
          : DEPTH_FORMAT
        : targetRecord.depthFormat;
    // The stencil scan above ran §57 material accessors — application code,
    // which can do anything, including disposing this renderer (the pinned
    // reentrant family, reached one step earlier than the draw arms reach
    // it). Bail before anything is allocated: a §61 skip, and no buffer is
    // resurrected onto a dead device (the R1.6 reentrant-grade rule).
    if (this.#disposed) {
      return;
    }

    // §68 (WP-R1.5): does this frame shade at all? One `kind` comparison per
    // item, the GL backend's scan — including `skinned-lit` **when the
    // colour pair is registered**, so a receiving/shaded skinned draw gets
    // the light block, while an unregistered skinned-lit item stays
    // transcript-invisible (WP-R1.4's pinned claim: collecting lights for
    // draws that will be skipped would allocate the light block into that
    // byte-identical tape). Collected once per call, not per view — lights
    // are frame state, like the render list; the eye is the per-view half,
    // packed per view below.
    let hasLitItems = false;
    let skinnedCount = 0;
    for (const item of items) {
      if (
        item.kind === "lit" ||
        item.kind === "standard" ||
        (item.kind === "skinned-lit" && skinningRegistered)
      ) {
        hasLitItems = true;
      }
      if (item.kind === "skinned-unlit" || item.kind === "skinned-lit") {
        skinnedCount += 1;
      }
    }
    if (hasLitItems) {
      collectSceneLights(root, sceneLights);
      // Sized before recording, like the draw uniforms below: one block per
      // view at most, and growth mid-pass would orphan the bound group.
      this.#growLights(device, views.length);
    }
    // §69 (WP-R1.7): does this frame want a shadow map? The GL condition,
    // verbatim — a light asked (`hasShadow`) and something shaded will read
    // it (`hasLitItems`) — so a scene without both records not one shadow
    // allocation, call, or byte: the byte-identity contract, not an
    // optimisation.
    const frameShadow = hasLitItems && sceneLights.hasShadow;

    // §60's frame preparation (WP-R1.9): the store resolves — and on first
    // sight compiles — every node graph and grows its own strided buffer,
    // before this pass records anything (the sized-before-recording
    // discipline, one buffer over). `material.graph` is an application
    // accessor on a structural double, so the frame bails on a reentrant
    // dispose right after — the stencil-scan rule, third application.
    const nodeFrame =
      nodePipelines !== null && nodePipelines.beginFrame(items, views.length)
        ? nodePipelines
        : null;
    // The re-check is scoped to the accessors this scan actually ran: a
    // nodeless frame keeps the landed behaviour for a reentrant dispose in a
    // *light* accessor (the pinned frame-loses-its-shadows path), while a
    // graph accessor's teardown bails before this frame allocates onto a
    // dead device.
    if (nodePipelines !== null && this.#disposed) {
      return;
    }

    // RFC 0003: resolve the colour pair *before* the pass, so the palette
    // buffer can be sized (a mid-pass grow would orphan the bound group)
    // and a factory failure is a skip for every skinned item, never a
    // bind pose. Unregistered: warned once inside `#acquireSkinnedPrograms`
    // and `skinnedPrograms` stays null — the draw arm continues past.
    const skinnedPrograms =
      skinnedCount > 0 ? this.#acquireSkinnedPrograms() : null;
    if (skinnedPrograms !== null) {
      skinnedPrograms.prepare(
        device,
        skinnedCount * views.length + (frameShadow ? skinnedCount : 0),
      );
    }

    // Sized before recording: one clear block per view plus, at worst, one
    // block per item per view — plus one block per caster when §69's pass
    // will run (WP-R1.7; `+ 0` on every other frame, so the growth sequence
    // is untouched). Growing mid-pass would orphan the bind group the pass
    // has already been handed.
    this.#growUniforms(
      device,
      layout,
      views.length * (1 + items.length) + (frameShadow ? items.length : 0),
    );
    const bindGroup = this.#bindGroup;
    const uniformBuffer = this.#uniformBuffer;
    if (bindGroup === null || uniformBuffer === null) {
      return;
    }

    // Normalized viewport rectangles resolve against the surface actually
    // being drawn into: the drawing buffer on screen, the target's own size
    // off screen — read off the *record*, so the `setViewport` call and the
    // allocation agree even if the application resized the target after this
    // call began (the GL backend's rule, unchanged).
    const surfaceWidth =
      targetRecord?.width ??
      Math.max(1, Math.round(this.#width * this.#resolution));
    const surfaceHeight =
      targetRecord?.height ??
      Math.max(1, Math.round(this.#height * this.#resolution));
    // On screen the depth attachment is this renderer's own, sized to the
    // drawing buffer and format-upgraded for a clipping frame; off screen it
    // is the target's — or absent, for a `depth: false` target, in which case
    // the pass carries no depth attachment at all and §61's per-view depth
    // clear has nothing to owe.
    const depthView =
      targetRecord === null
        ? this.#acquireDepth(
            device,
            surfaceWidth,
            surfaceHeight,
            frameStencil ? DEPTH_STENCIL_FORMAT : DEPTH_FORMAT,
          )
        : targetRecord.depthView;
    const colorView =
      targetRecord === null
        ? context.getCurrentTexture().createView()
        : targetRecord.colorView;

    const statistics = this.statistics;
    const gpuTimer =
      this.#gpuTimer !== null && this.#gpuTimer.armed ? this.#gpuTimer : null;
    const timestampWrites = gpuTimer?.beginPass(device);
    const encoder = device.createCommandEncoder({ label: "fourJS:frame" });
    let block = 0;

    // §69's shadow map (WP-R1.7), recorded **before** the views pass — §63's
    // own pipeline diagram puts "Shadow Passes" between scene preparation and
    // the opaque world, and the map is per-*frame* state (one light, one
    // volume, shared by every view and by an off-screen frame alike), exactly
    // as `sceneLights` is. Backend-internal rather than a §63 graph pass, for
    // the GL call site's recorded reasons. Structurally unlike GL's: a pass of
    // its own on this frame's encoder, borrowing no framebuffer, rectangles,
    // or program and owing its caller no re-bind — the mirror-state
    // discipline the GL shadow pass needs has nothing to guard here
    // (`wgpu-shadow.ts`).
    let shadowRecord: WgpuRenderTargetRecord | null = null;
    if (frameShadow) {
      const shadow = this.#renderShadowMap(
        device,
        encoder,
        pipelines,
        geometries,
        renderTargets,
        bindGroup,
        items,
        block,
        statistics,
        skinnedPrograms,
      );
      shadowRecord = shadow.record;
      block = shadow.block;
    }
    // §69's receiver binding, resolved once per frame — GL binds the map to
    // its unit once and leaves it for the whole frame, and this is that
    // decision one object later: the widened group over the very lights
    // buffer the plain draws offset into, plus the map's depth view and the
    // shared comparison sampler. `null` exactly when the frame has no map to
    // compare against (nothing cast, or the map could not be produced —
    // which costs the frame its shadows, never the frame, §61), and the
    // draws then never ask.
    const shadowView = shadowRecord?.depthView ?? null;
    const shadowLightsBuffer = this.#lightsBuffer;
    const shadowGroup =
      shadowView !== null && shadowLightsBuffer !== null
        ? this.#acquireShadowBindGroup(device, shadowLightsBuffer, shadowView)
        : null;

    const pass = encoder.beginRenderPass({
      label: "fourJS:views",
      colorAttachments: [
        {
          view: colorView,
          // Always "load", never "clear": §61 confines a clear to the viewport
          // rectangle, and `loadOp` has no scissor. See `wgpu-unlit.ts`.
          loadOp: "load",
          storeOp: "store",
        },
      ],
      // The stencil-aspect ops exist exactly when the format has the aspect —
      // WebGPU validation requires the pair on `depth24plus-stencil8` and
      // forbids it on `depth24plus`, which conveniently makes the clipless
      // descriptor the object WP-R1.1 recorded. Off screen the aspect is the
      // target's `stencil` option, whether or not this frame clips.
      ...(depthView === null
        ? {}
        : {
            depthStencilAttachment: frameStencil
              ? {
                  view: depthView,
                  depthLoadOp: "load",
                  depthStoreOp: "store",
                  stencilLoadOp: "load",
                  stencilStoreOp: "store",
                }
              : {
                  view: depthView,
                  depthLoadOp: "load",
                  depthStoreOp: "store",
                },
          }),
      ...(timestampWrites === undefined ? {} : { timestampWrites }),
    });

    // §65's uploader (R-9's seam), read once for the frame exactly as
    // `statistics` is, and `null` by default: a renderer that never opted in
    // pays one comparison per item and records not a single extra call.
    const batching = this.batching;
    if (batching !== null) {
      batching.beginFrame();
    }
    // §68: how many light blocks the view loop has packed — one per *rendered*
    // view, so skipped (zero-area) views leave no gap and every uploaded byte
    // was written this frame (`writeLightUniforms`' determinism contract).
    let lightBlock = 0;
    // §67: the pass's stencil reference, a pass command mirrored here so it is
    // issued only when a stencil-carrying draw needs a different value.
    // WebGPU's initial value is 0, so a clipless frame issues none at all.
    let stencilReference = 0;

    for (const view of views) {
      resolveRect(view, surfaceWidth, surfaceHeight, this.#rect);
      const rect = this.#rect;
      if (rect.width === 0 || rect.height === 0) {
        continue;
      }
      // §48's rectangle is bottom-left with +Y up; WebGPU's pass rectangles are
      // top-left. The flip happens here and never leaks into `Viewport` — the
      // clause §61 writes for "a backend whose native scissor rectangle is
      // top-left based".
      const top = Math.max(0, surfaceHeight - (rect.y + rect.height));
      const viewScissor: ScissorRect = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
      let itemScissorActive = false;
      pass.setViewport(rect.x, top, rect.width, rect.height, 0, 1);
      pass.setScissorRect(rect.x, top, rect.width, rect.height);

      const camera = view.camera;
      camera.updateViewMatrix();
      this.#viewProjection
        .copy(camera.projectionMatrix)
        .multiply(camera.viewMatrix);

      // §68 (WP-R1.5): this view's light block — the frame's lights plus the
      // per-view eye, read straight out of the camera's world matrix
      // translation column (`updateViewMatrix()` above resolved it; the GL
      // standard branch's read, verbatim). CPU packing only; the one upload
      // happens after the pass, beside the draw uniforms'.
      let lightBase = 0;
      if (hasLitItems) {
        lightBase = lightBlock * LIGHT_UNIFORM_STRIDE_BYTES;
        const eye = camera.transform.worldMatrix.elements;
        writeLightUniforms(
          this.#lightsStaging,
          lightBlock * LIGHT_UNIFORM_STRIDE_FLOATS,
          sceneLights,
          eye[12],
          eye[13],
          eye[14],
        );
        // §69's tail of the same block (WP-R1.7): the shadow matrix and
        // biases when a light casts, zeros when none does — written on every
        // shaded view either way, so the uploaded stride is a function of
        // this frame alone and a landed shadowless upload stays
        // byte-identical (`wgpu-shadow.ts`).
        writeShadowUniforms(
          this.#lightsStaging,
          lightBlock * LIGHT_UNIFORM_STRIDE_FLOATS,
          sceneLights,
        );
        lightBlock += 1;
      }

      // The clear draw: colour where the view asks for it, depth whenever the
      // surface has a depth buffer (§61's shared clear semantics — a
      // `depth: false` target has no buffer to owe a clear, and a view of one
      // that also names no clearColor has nothing to clear at all, so the
      // draw is skipped whole rather than issued empty).
      const clearColor = view.clearColor;
      if (clearColor !== undefined || depthFormat !== null) {
        this.#writeBlock(
          block,
          this.#viewProjection,
          null,
          clearColor?.[0] ?? 0,
          clearColor?.[1] ?? 0,
          clearColor?.[2] ?? 0,
          clearColor?.[3] ?? 0,
        );
        this.#drawClear(
          pass,
          pipelines,
          bindGroup,
          block,
          clearColor !== undefined,
          depthFormat,
          // §67: on a stencil-carrying surface the same triangle zeroes the
          // stencil rectangle — a stencil buffer that is never cleared is a
          // mask leaking between frames and between views (the §33 defect,
          // not a feature).
          frameStencil,
        );
        block += 1;
      }

      // §87's cull, against the un-remapped matrix in the WebGL clip convention
      // both backends share (see the module header on clip depth).
      this.#frustum.setFromViewProjection(this.#viewProjection);
      const viewItems = buildViewRenderList(items, view, this.#viewList, {
        frustum: this.#frustum,
      });

      for (let index = 0; index < viewItems.length; index += 1) {
        const item = viewItems[index];
        if (itemScissorActive) {
          pass.setScissorRect(
            viewScissor.x,
            top,
            viewScissor.width,
            viewScissor.height,
          );
          itemScissorActive = false;
        }

        // §65 (R-9), and only when the application assigned an uploader: does
        // a run of compatible draws start here? The planner already broke runs
        // at clip-record boundaries (R-23), so the batch's clip is one value
        // for the whole merged draw, exactly as its material is. The check
        // sits above `geometries.acquire` for `webgl-renderer.ts`'s reason: a
        // batched run draws from the uploader's own buffers.
        if (batching !== null) {
          const batch = batching.next(viewItems, index);
          if (batch !== null) {
            // §55 and §57 resolve their texture from different fields; the
            // batch carries whichever one its material named (`batch.ts`). A
            // sprite batch whose texture will not resolve is skipped whole —
            // the run shares the material that named it — while an unlit
            // batch draws on untextured, exactly the two answers the
            // unbatched paths give (`gl-batch.ts`'s rule, restated). Resolved
            // through the R-4 seam, so a batch sampling the active target is
            // a feedback loop and resolves `null` like any other draw's.
            const batchTexture =
              batch.texture === null
                ? null
                : resolveFrameTexture(
                    textures,
                    renderTargets,
                    activeTarget,
                    batch.texture,
                  );
            if (batch.kind !== "sprite" || batchTexture !== null) {
              itemScissorActive = applyWgpuItemScissor(
                pass,
                viewScissor,
                batch.scissor,
                surfaceHeight,
              );
              stencilReference = this.#drawBatch(
                pass,
                pipelines,
                bindGroup,
                batching,
                device,
                batch,
                batchTexture,
                block,
                depthFormat,
                frameStencil,
                stencilReference,
                statistics,
              );
              block += 1;
            }
            // Consumed either way: a run skipped for an unresolvable texture
            // is skipped item by item in the unbatched path too.
            index += batch.items - 1;
            continue;
          }
        }

        itemScissorActive = applyWgpuItemScissor(
          pass,
          viewScissor,
          item.scissor,
          surfaceHeight,
        );

        const clip = item.clip ?? null;
        const maskPass = clip !== null && clip.maskPass;
        // §67 into a stencil-less target (the DEV warning above): the mask
        // has no planes to write, so its draw is skipped and its subtree —
        // whose stencil records resolve to nothing on this frame's format —
        // draws unclipped.
        if (maskPass && !frameClips) {
          continue;
        }
        if (!maskPass && (isSkinnedUnlitItem(item) || isSkinnedLitItem(item))) {
          // §54's skinned colour draws (RFC 0003) — a self-contained arm
          // ending in `continue`, like the particle arm below, because the
          // pipeline must be resolved *before* the geometry upload: a draw
          // skipped for an unregistered pipeline (or a failed compile)
          // contributes nothing at all — not even a buffer upload. The
          // failure direction is absence with a one-time warning, never a
          // bind pose (a character standing in T-pose is a different
          // picture).
          if (skinnedPrograms === null) {
            continue;
          }
          const skinnedLit = isSkinnedLitItem(item);
          const record = geometries.acquire(item.geometry, skinnedLit, true);
          if (
            record === null ||
            record.jointBuffer === null ||
            record.weightBuffer === null
          ) {
            continue;
          }
          const drawn = this.#drawSkinned(
            pass,
            skinnedPrograms,
            bindGroup,
            textures,
            renderTargets,
            activeTarget,
            item,
            record,
            skinnedLit,
            block,
            depthFormat,
            frameStencil,
            clip,
            stencilReference,
            statistics,
            shadowGroup,
            lightBase,
          );
          stencilReference = drawn.stencilReference;
          if (drawn.drew) {
            block += 1;
          }
          continue;
        }
        if (
          !maskPass &&
          item.kind !== "unlit" &&
          item.kind !== "sprite" &&
          item.kind !== "lit" &&
          item.kind !== "standard" &&
          item.kind !== "particles" &&
          item.kind !== "node"
        ) {
          // Remaining kinds this colour pass does not draw. Skinned items
          // continued above when registered; unregistered ones fell through
          // the `skinnedPrograms === null` skip. The §69 caster is on the
          // same pair (`acquireShadow`). The RFC 0005 skinned id pass
          // lives on the picking service.
          continue;
        }
        if (!maskPass && item.kind === "node") {
          // §60's node materials (RFC 0001; WP-R1.9) — a self-contained arm
          // ending in `continue`, the GL node arm's shape: the registered
          // store owns the whole draw (its textures, its geometry streams,
          // its pipeline, its uniform block), every skip resolves before the
          // first recorded command, and the failure direction is absence.
          // `nodeFrame` is `null` exactly when nothing is registered (warned
          // once at `#acquireNodePipelines`) or no node draw survived
          // `beginFrame` — the draw then contributes nothing at all.
          if (nodeFrame === null) {
            continue;
          }
          const state = this.#nodeFrame;
          state.viewProjection = this.#viewProjection;
          state.renderTime = this.renderTime;
          state.colorFormat = this.#frameFormat;
          state.depthFormat = depthFormat;
          state.frameStencil = frameStencil;
          state.stencilReference = stencilReference;
          state.activeTarget = activeTarget;
          state.statistics = statistics;
          stencilReference = nodeFrame.draw(pass, item, state);
          continue;
        }
        if (!maskPass && item.kind === "particles") {
          // §36's whole system, one instanced draw (WP-R1.8) — the
          // `gl-particles.ts` arm, restated: the geometry record is the
          // *shared unit quad* every particle item points at, and this
          // system's own instance buffer rides beside it as the pipeline's
          // second, per-instance vertex stream. A zero-particle system is
          // skipped **before** the quad uploads — the skinned-absence
          // discipline, deliberately stricter than GL, which acquires its
          // geometry record first: a draw that contributes nothing must
          // contribute not even a buffer. A reentrant mid-frame dispose
          // surfaces as the caches' `null` answers below (the pinned
          // WP-R1.3 scenario), skipping this and every remaining draw.
          if (item.count === 0) {
            continue;
          }
          const quad = geometries.acquire(item.geometry);
          if (quad === null) {
            continue;
          }
          // `null` for a capacity-less instance array — a structural double
          // whose `count` outruns its storage draws nothing, GL's answer —
          // and for a cache racing teardown.
          const batch = particles.acquire(item);
          if (batch === null) {
            continue;
          }
          stencilReference = this.#drawParticles(
            device,
            pass,
            pipelines,
            uniformBuffer,
            particles,
            item,
            quad,
            batch,
            camera,
            block,
            depthFormat,
            frameStencil,
            clip,
            stencilReference,
            statistics,
          );
          block += 1;
          continue;
        }
        // A shaded draw asks the cache for the normal stream too (WP-R1.5);
        // a mask does not — coverage, not shading — and every other kind
        // passes the default `false`, i.e. exactly the call it always made.
        const record = geometries.acquire(
          item.geometry,
          !maskPass && (item.kind === "lit" || item.kind === "standard"),
        );
        if (record === null) {
          continue;
        }

        if (maskPass) {
          // §67's mask draw — **coverage, not shading**, whatever pipeline the
          // node's material names. The GL backend draws a mask through the
          // item's own program because a program costs nothing to reuse there;
          // here a pipeline is a compiled object, and with colour writes
          // forced off every family rasterises the identical fragment set, so
          // one flat unlit variant serves every mask (a lit or standard clip
          // node therefore masks correctly on this backend even before
          // WP-R1.5 gives its *content* a pipeline). Depth test and writes are
          // forced off with colour, per `RenderItemClip`'s contract: a mask
          // must not occlude, be occluded by, or be depth-rejected against
          // the content it masks.
          const pipeline = pipelines.acquire({
            kind: "unlit",
            vertexColors: false,
            map: false,
            blend: "none",
            depthTest: false,
            depthWrite: false,
            colorWrite: false,
            topology: record.topology,
            colorFormat: this.#frameFormat,
            depthFormat,
            stencil: stencilDescriptor(clip.stencil),
            batch: null,
          });
          if (pipeline === null) {
            // Unreachable for the reason the unlit path states; same
            // narrowing.
            continue;
          }
          // The colour is never read — writes are off — so the block carries
          // zeros rather than the material's colour: one canonical mask block,
          // whatever material the clip node wears.
          this.#writeBlock(
            block,
            this.#viewProjection,
            item.worldMatrix,
            0,
            0,
            0,
            0,
          );
          pass.setPipeline(pipeline);
          pass.setBindGroup(
            0,
            bindGroup,
            dynamicOffset(block * UNIFORM_STRIDE_BYTES),
          );
          stencilReference = applyStencilReference(
            pass,
            stencilReference,
            clip.stencil.ref,
          );
          pass.setVertexBuffer(0, record.positionBuffer);
          if (record.indexBuffer !== null && record.indexFormat !== null) {
            pass.setIndexBuffer(record.indexBuffer, record.indexFormat);
            pass.drawIndexed(record.count);
          } else {
            pass.draw(record.count);
          }
          if (statistics !== null) {
            countDraw(statistics, record.topology, record.count, 1);
          }
          block += 1;
          continue;
        }

        if (item.kind === "sprite") {
          // §55's texture is required, and a sprite whose texture will not
          // resolve — a disposed one (§83), a structurally typed material
          // double that carries none (`?? null`, the F16 defensive read), or
          // a feedback loop on the active target (WP-R1.6, R-4's rule) —
          // skips its draw, exactly as the GL sprite path skips it.
          const spriteMap = item.material.texture ?? null;
          const spriteTexture =
            spriteMap === null
              ? null
              : resolveFrameTexture(
                  textures,
                  renderTargets,
                  activeTarget,
                  spriteMap,
                );
          if (spriteTexture !== null && record.uvBuffer !== null) {
            stencilReference = this.#drawSprite(
              device,
              pass,
              pipelines,
              uniformBuffer,
              item,
              record,
              spriteTexture,
              block,
              depthFormat,
              frameStencil,
              clip,
              stencilReference,
              statistics,
            );
            block += 1;
          }
          continue;
        }

        if (item.kind === "lit" || item.kind === "standard") {
          // WP-R1.5's two shaded arms — the unlit arm's shape with three
          // additions: the normal stream picks a variant, the light block
          // binds at group 1 with this view's offset, and the standard kind
          // writes its widened uniform block through its own group-0 layout.
          const material = item.material;
          // The variant is the record's answer, not the geometry's: a
          // normal-less geometry selects the normal-less variant, whose
          // vertex stage writes the zero vector GL's default attribute
          // yields — "ambient only", the documented shading (`wgpu-lit.ts`).
          const normals = record.normalBuffer !== null;
          // §57's `map`, resolved exactly as the unlit arm resolves it: draws
          // only with uvs to sample by and a texture that resolves; a named
          // texture that fails — disposed (§83), or a feedback loop on the
          // active target (R-4) — skips the draw, a missing uv stream
          // degrades to the untextured variant's absence.
          const map = material.map ?? null;
          const mapBindGroup =
            map === null || record.uvBuffer === null
              ? null
              : resolveFrameTexture(textures, renderTargets, activeTarget, map);
          if (
            map !== null &&
            record.uvBuffer !== null &&
            mapBindGroup === null
          ) {
            continue;
          }
          const useMap = mapBindGroup !== null;
          // §59's packed metallic-roughness map: same resolve/skip/degrade
          // contract as albedo (`map`). Named + uvs + unresolved (disposed
          // or a feedback loop) skips the draw; named without a uv stream
          // degrades to the scalar factors. Lit items have no such field.
          const metalRoughnessSource =
            item.kind === "standard"
              ? metalRoughnessMapOf(item.material)
              : null;
          const metalRoughnessBindGroup =
            metalRoughnessSource === null || record.uvBuffer === null
              ? null
              : resolveFrameTexture(
                  textures,
                  renderTargets,
                  activeTarget,
                  metalRoughnessSource,
                );
          if (
            metalRoughnessSource !== null &&
            record.uvBuffer !== null &&
            metalRoughnessBindGroup === null
          ) {
            continue;
          }
          const useMetalRoughness = metalRoughnessBindGroup !== null;
          // The lights group is read off the *field*, not a frame local, and
          // read here — after the material's getters have run — so a
          // reentrant mid-frame `dispose()` inside application code (the
          // pinned WP-R1.3 scenario, reachable through a material accessor
          // too) skips this and every remaining shaded draw instead of
          // binding a dropped group (§61: the frame must not throw).
          const lightsBindGroup = this.#lightsBindGroup;
          if (lightsBindGroup === null) {
            continue;
          }
          // §69 (WP-R1.7): GL's `shadowActive && item.receiveShadow`, folded
          // here into pipeline identity rather than a uniform — the two
          // reasons a draw is not shadowed are "nothing casts" and "this
          // node opted out", and both select the plain variant a shadowless
          // frame compiles (`wgpu-shadow.ts` on the inversion). A receiver
          // binds the frame's widened group at the same offset.
          let receiving = false;
          let shadedLights = lightsBindGroup;
          if (shadowGroup !== null && item.receiveShadow) {
            receiving = true;
            shadedLights = shadowGroup;
          }
          // §67's resolution, the unlit arm's verbatim.
          const stencilRecord = frameStencil
            ? clip !== null
              ? clip.stencil
              : material.stencil
            : undefined;
          // Through the A3 memo: the same descriptor as before, spelled into
          // the reusable request so a run of same-material draws skips the
          // descriptor, the key string and the map lookup.
          const request = this.#pipelineRequest;
          request.kind = item.kind;
          request.vertexColors = false;
          request.map = useMap;
          request.blend =
            material.transparent === true
              ? (material.blendMode ?? "normal")
              : "none";
          // A pass with no depth attachment normalizes both depth bits off
          // (`depth: false` targets, WP-R1.6): the pipeline omits its
          // depth-stencil state either way, and the normalization keeps
          // the cache key canonical for that one pipeline.
          request.depthTest =
            depthFormat !== null && material.depthTest !== false;
          request.depthWrite =
            depthFormat !== null && material.depthWrite !== false;
          request.colorWrite = material.colorWrite !== false;
          request.topology = record.topology;
          request.colorFormat = this.#frameFormat;
          request.depthFormat = depthFormat;
          request.stencil = stencilRecord ?? null;
          request.normals = normals;
          request.shadow = receiving;
          request.metalRoughness = useMetalRoughness;
          request.gpuInstances = false;
          const pipeline = this.#pipelineMemo.acquire(pipelines, request);
          if (pipeline === null) {
            // Unreachable given the class invariant — the unlit arm's
            // narrowing, same reason: §61 forbids throwing here.
            continue;
          }

          const opacity = material.opacity ?? 1;
          if (item.kind === "standard") {
            // §59's block: base colour in `DrawUniforms.color`'s slot, then
            // the two vec4s only this family reads — bound through the
            // widened group-0 layout over the same strided buffer.
            const baseColor = item.material.baseColor;
            this.#writeBlock(
              block,
              this.#viewProjection,
              item.worldMatrix,
              baseColor[0],
              baseColor[1],
              baseColor[2],
              baseColor[3] * opacity,
            );
            this.#writeSurface(block, item.material);
            pass.setPipeline(pipeline);
            pass.setBindGroup(
              0,
              this.#acquireStandardBindGroup(device, uniformBuffer),
              dynamicOffset(block * UNIFORM_STRIDE_BYTES),
            );
          } else {
            const color = item.material.color;
            this.#writeBlock(
              block,
              this.#viewProjection,
              item.worldMatrix,
              color[0],
              color[1],
              color[2],
              color[3] * opacity,
            );
            pass.setPipeline(pipeline);
            pass.setBindGroup(
              0,
              bindGroup,
              dynamicOffset(block * UNIFORM_STRIDE_BYTES),
            );
          }
          // The view's light block, at this view's dynamic offset — bound per
          // draw rather than mirrored, because slot 1 is also where the unlit
          // family binds its textures, so "what group 1 holds" is not a
          // per-view constant (and eliding rebinds here would have to model
          // that, for a saving the GL backend's per-draw uniform calls never
          // had either). A receiving draw binds the widened shadow group
          // over the same buffer at the same offset (WP-R1.7).
          pass.setBindGroup(
            LIGHTS_BIND_GROUP_INDEX,
            shadedLights,
            dynamicOffset(lightBase),
          );
          if (stencilRecord !== undefined) {
            stencilReference = applyStencilReference(
              pass,
              stencilReference,
              stencilRecord.ref,
            );
          }
          // Slots are positional, in `shadedVertexBufferLayouts`' order:
          // position, then normals if the variant shades with them, then uvs
          // if it samples albedo *or* the packed metallic-roughness map.
          let slot = 0;
          pass.setVertexBuffer(slot, record.positionBuffer);
          if (normals) {
            slot += 1;
            pass.setVertexBuffer(slot, record.normalBuffer);
          }
          if (useMap || useMetalRoughness) {
            slot += 1;
            pass.setVertexBuffer(slot, record.uvBuffer);
          }
          if (mapBindGroup !== null) {
            pass.setBindGroup(SHADED_MAP_BIND_GROUP_INDEX, mapBindGroup);
          }
          if (metalRoughnessBindGroup !== null) {
            // Group 3 when albedo occupies 2; group 2 when it does not
            // (`wgpu-lights.ts` / `wgpu-standard.ts`).
            pass.setBindGroup(
              useMap ? SHADED_MR_BIND_GROUP_INDEX : SHADED_MAP_BIND_GROUP_INDEX,
              metalRoughnessBindGroup,
            );
          }
          if (record.indexBuffer !== null && record.indexFormat !== null) {
            pass.setIndexBuffer(record.indexBuffer, record.indexFormat);
            pass.drawIndexed(record.count);
          } else {
            pass.draw(record.count);
          }
          if (statistics !== null) {
            countDraw(statistics, record.topology, record.count, 1);
          }
          block += 1;
          continue;
        }
        // By elimination this is the unlit arm: masks, particles, sprites and
        // the shaded kinds continued above, and the early guard skipped every
        // other kind. The cast is the loop's one, for `render-list.ts`'s `itemAt`
        // reason — TypeScript cannot carry the invariant across two
        // `continue`s.
        const material = (item as UnlitItem).material;
        const vertexColors =
          material.vertexColors === true && record.colorBuffer !== null;
        // §57's `map` draws only when the geometry carries the uvs to sample it
        // with and the texture will upload — a texture disposed while still
        // referenced skips the draw rather than painting undefined content
        // (§83), which is the rule `gl-texture.ts` states and this honours by
        // falling through to the untextured variant's *absence*, not to it.
        const map = material.map ?? null;
        const mapBindGroup =
          map === null || record.uvBuffer === null
            ? null
            : resolveFrameTexture(textures, renderTargets, activeTarget, map);
        if (map !== null && record.uvBuffer !== null && mapBindGroup === null) {
          continue;
        }
        const useMap = mapBindGroup !== null;
        // §67's resolution, one comparison (R-23): the engine's clip record
        // outranks the material's own §57 stencil, and `null` — every pre-§67
        // draw — resolves to the material's, which on a stencil-free surface
        // resolves to nothing at all (see `DEPTH_STENCIL_FORMAT` on the
        // material-stencil tier; off screen the aspect is the target's
        // `stencil` option, so R-7's mask-by-hand tier works into a
        // stencilled target whether or not the frame clips — GL's parity).
        const stencilRecord = frameStencil
          ? clip !== null
            ? clip.stencil
            : material.stencil
          : undefined;
        // §57's state as data, through the A3 memo (the shaded arm's note).
        const request = this.#pipelineRequest;
        request.kind = "unlit";
        request.vertexColors = vertexColors;
        request.map = useMap;
        request.blend =
          material.transparent === true
            ? (material.blendMode ?? "normal")
            : "none";
        // Normalized off on a depthless pass (WP-R1.6) — the shaded arm's note.
        request.depthTest =
          depthFormat !== null && material.depthTest !== false;
        request.depthWrite =
          depthFormat !== null && material.depthWrite !== false;
        request.colorWrite = material.colorWrite !== false;
        request.topology = record.topology;
        request.colorFormat = this.#frameFormat;
        request.depthFormat = depthFormat;
        request.stencil = stencilRecord ?? null;
        request.normals = undefined;
        request.shadow = false;
        request.metalRoughness = false;
        request.gpuInstances = false;
        const pipeline = this.#pipelineMemo.acquire(pipelines, request);
        if (pipeline === null) {
          // Unreachable given the class invariant — the cache answers `null`
          // only once disposed, and a disposed cache means a lost device,
          // which returned above. The narrowing has to happen somewhere, and
          // skipping the draw is the right behaviour if the invariant is ever
          // broken: §61 forbids throwing here.
          continue;
        }

        const opacity = material.opacity ?? 1;
        this.#writeBlock(
          block,
          this.#viewProjection,
          item.worldMatrix,
          material.color[0],
          material.color[1],
          material.color[2],
          material.color[3] * opacity,
        );

        pass.setPipeline(pipeline);
        pass.setBindGroup(
          0,
          bindGroup,
          dynamicOffset(block * UNIFORM_STRIDE_BYTES),
        );
        if (stencilRecord !== undefined) {
          stencilReference = applyStencilReference(
            pass,
            stencilReference,
            stencilRecord.ref,
          );
        }
        // Slots are positional, in `unlitVertexBufferLayouts`' order: position,
        // then colours if the variant reads them, then uvs if it samples. One
        // counter, on both sides, so the two orders cannot drift.
        let slot = 0;
        pass.setVertexBuffer(slot, record.positionBuffer);
        if (vertexColors && record.colorBuffer !== null) {
          slot += 1;
          pass.setVertexBuffer(slot, record.colorBuffer);
        }
        if (mapBindGroup !== null && record.uvBuffer !== null) {
          slot += 1;
          pass.setVertexBuffer(slot, record.uvBuffer);
          pass.setBindGroup(MAP_BIND_GROUP_INDEX, mapBindGroup);
        }
        if (record.indexBuffer !== null && record.indexFormat !== null) {
          pass.setIndexBuffer(record.indexBuffer, record.indexFormat);
          pass.drawIndexed(record.count);
        } else {
          pass.draw(record.count);
        }
        if (statistics !== null) {
          countDraw(statistics, record.topology, record.count, 1);
        }
        block += 1;
      }
      if (itemScissorActive) {
        pass.setScissorRect(
          viewScissor.x,
          top,
          viewScissor.width,
          viewScissor.height,
        );
      }
    }

    pass.end();
    // One upload for the whole frame, enqueued before the submit that reads it.
    device.queue.writeBuffer(
      uniformBuffer,
      0,
      this.#uniformStaging,
      0,
      block * UNIFORM_STRIDE_FLOATS,
    );
    // §68: the frame's light blocks, one strided block per rendered view —
    // the same one-upload-per-frame shape, absent to the byte on a frame with
    // no shaded item. The buffer is re-read off the field so a reentrant
    // mid-frame dispose skips the upload along with the draws.
    const lightsBuffer = this.#lightsBuffer;
    if (lightBlock > 0 && lightsBuffer !== null) {
      device.queue.writeBuffer(
        lightsBuffer,
        0,
        this.#lightsStaging,
        0,
        lightBlock * LIGHT_UNIFORM_STRIDE_FLOATS,
      );
    }
    // §60's node blocks (WP-R1.9): the store's own one-upload-per-frame,
    // beside the two above and before the submit that reads it (queue
    // order); absent to the byte on a frame that recorded no node draw.
    nodeFrame?.endFrame();
    skinnedPrograms?.upload(device);
    gpuTimer?.resolve(encoder);
    device.queue.submit([encoder.finish()]);
    gpuTimer?.afterSubmit();
  }

  /**
   * Draws one §70 full-screen effect (WP-R1.6) — `pass.source`'s colour
   * attachment over the whole of `pass.target`, or of the swap chain, through
   * `pass.effect`. The normative contract is on `@fourjs/render`'s
   * `Renderer.renderEffect`; the GL backend's method documents the shared
   * readings and this one differs in exactly two ways, both structural:
   *
   * - **There is no state envelope.** GL borrows the framebuffer binding, the
   *   rectangles, the depth test and a texture unit inside a `try`/`finally`;
   *   here the effect is its own render pass in its own command encoder, and
   *   a WebGPU pass has no ambient state to corrupt — the one place this
   *   backend is structurally safer, restated for §70. No scissor or viewport
   *   is set: a pass's defaults are the whole attachment, which is exactly
   *   what "an effect covers its destination surface" means.
   * - **The effect kind is pipeline identity, not uniform state** — a lazy
   *   per-(kind × format) pipeline (`wgpu-effect.ts` carries the inverted
   *   R-19 argument), so a chain that only ever copies compiles one module
   *   and uploads no uniforms at all; only a grade touches the 16-byte block.
   *
   * ## What is skipped rather than thrown (§61, §83)
   *
   * Everything, on `render`'s terms — a lost device, a source that is not a
   * render-target texture (a caller that bypassed `validateEffectRenderPass`),
   * a disposed source or destination, an effect kind this backend does not
   * draw (RFC 0001's `"graph"` kind is drawn since WP-R1.9, through the
   * registered node store; unregistered, it skips — the closed-union rule
   * either way), and the **feedback loop**: a pass
   * whose destination is the very surface it samples, refused here exactly as
   * R-4 refuses it per draw, with `RenderGraph.validate` reporting it
   * statically as `"feedback"` so the mistake is normally caught at setup.
   */
  renderEffect(pass: EffectRenderPass): void {
    this.#assertUsable("renderEffect");
    const device = this.#device;
    const context = this.#context;
    const pipelines = this.#pipelines;
    const renderTargets = this.#renderTargets;
    const geometries = this.#geometries;
    const textures = this.#textures;
    if (
      device === null ||
      context === null ||
      pipelines === null ||
      renderTargets === null ||
      geometries === null ||
      textures === null ||
      this.#deviceLost
    ) {
      return;
    }

    // Read structurally, like every argument this backend meets: the marker
    // guard rather than the type, so a plain `Texture` handed over from
    // JavaScript gets a skipped effect instead of a black screen.
    const source = pass.source;
    if (!isRenderTargetTexture(source)) {
      return;
    }
    const sourceTarget = source.renderTarget;
    const destination = pass.target ?? null;
    if (destination === sourceTarget) {
      return;
    }
    const effect = pass.effect;
    const kind = effect.kind;
    if (kind === "graph") {
      // §60's graph effect (RFC 0001; WP-R1.9) — drawn by the registered node
      // store through its own pass and encoder, so it branches before the
      // fixed-effect path rather than growing a switch inside it (the GL
      // arm's shape). Everything the fixed path skips, the store skips too,
      // on the same §61 terms; `colorView` is a thunk so an on-screen
      // destination's `getCurrentTexture` is acquired only once the draw is
      // certain.
      const node = this.#acquireNodePipelines(
        device,
        geometries,
        textures,
        renderTargets,
      );
      if (node === null) {
        return;
      }
      let graphDestination: WgpuRenderTargetRecord | null = null;
      if (destination !== null) {
        graphDestination = renderTargets.acquire(destination);
        if (graphDestination === null) {
          return;
        }
      }
      const destinationRecord = graphDestination;
      node.renderGraphEffect(
        effect,
        sourceTarget,
        destination,
        destinationRecord === null ? this.#format : RENDER_TARGET_COLOR_FORMAT,
        () =>
          destinationRecord === null
            ? context.getCurrentTexture().createView()
            : destinationRecord.colorView,
        this.renderTime,
        this.statistics,
      );
      return;
    }
    if (kind !== "copy" && kind !== "grade" && kind !== "output-transform") {
      return;
    }

    // Resolved before anything is recorded: `sample`/`acquire` never throw,
    // so a disposed surface skips the effect rather than half-drawing it.
    const sourceGroup = renderTargets.sample(sourceTarget);
    if (sourceGroup === null) {
      return;
    }
    let destinationRecord: WgpuRenderTargetRecord | null = null;
    if (destination !== null) {
      destinationRecord = renderTargets.acquire(destination);
      if (destinationRecord === null) {
        return;
      }
    }

    if (kind === "grade") {
      // The coefficient reads are *application accessors* (a structurally
      // typed effect object may compute them), and application code can do
      // anything — including disposing this renderer (the pinned reentrant
      // scenario, reachable here through an effect descriptor's getter). So
      // they run before anything is acquired, and the pipeline acquisition
      // below is what notices a mid-call teardown: a disposed cache answers
      // `null` and the effect is skipped without resurrecting an allocation.
      // The padding lane is written, not assumed — an uploaded byte nobody
      // wrote is history (§33).
      effectGradeScratch[0] = effect.exposure ?? COLOR_GRADE_DEFAULTS.exposure;
      effectGradeScratch[1] = effect.contrast ?? COLOR_GRADE_DEFAULTS.contrast;
      effectGradeScratch[2] =
        effect.saturation ?? COLOR_GRADE_DEFAULTS.saturation;
      effectGradeScratch[3] = 0;
    }

    const pipeline = pipelines.acquire(
      this.#effectDescriptor(
        kind,
        destinationRecord === null ? this.#format : RENDER_TARGET_COLOR_FORMAT,
      ),
    );
    if (pipeline === null) {
      // A reentrant dispose inside a coefficient accessor above — the one
      // reachable path — or a broken class invariant; §61 forbids throwing
      // here either way, so the effect is skipped (the draw arms' narrowing).
      return;
    }

    let gradeGroup: GpuBindGroup | null = null;
    if (kind === "grade") {
      // The coefficients ride the shared 16-byte block, uploaded before the
      // submit that reads them (queue order).
      device.queue.writeBuffer(
        this.#acquireEffectBuffer(device),
        0,
        effectGradeScratch,
      );
      gradeGroup = this.#acquireEffectBindGroup(device);
    }

    const colorView =
      destinationRecord === null
        ? context.getCurrentTexture().createView()
        : destinationRecord.colorView;
    const encoder = device.createCommandEncoder({ label: "fourJS:effect" });
    const renderPass = encoder.beginRenderPass({
      label: `fourJS:effect:${kind}`,
      // "load", not "clear": an effect replaces every covered texel with its
      // own fragment, so there is nothing to clear — and §70's contract is
      // that it *replaces* what the destination held, never composites.
      colorAttachments: [{ view: colorView, loadOp: "load", storeOp: "store" }],
    });
    renderPass.setPipeline(pipeline);
    renderPass.setBindGroup(0, sourceGroup);
    if (gradeGroup !== null) {
      renderPass.setBindGroup(EFFECT_BIND_GROUP_INDEX, gradeGroup);
    }
    renderPass.draw(EFFECT_PASS_VERTEX_COUNT);
    renderPass.end();
    device.queue.submit([encoder.finish()]);
    const statistics = this.statistics;
    if (statistics !== null) {
      // One draw call, one instance, one triangle (§84) — counted because it
      // was submitted, exactly as a scene draw is.
      countDraw(statistics, "triangle-list", EFFECT_PASS_VERTEX_COUNT, 1);
    }
  }

  /**
   * Builds a `PickingService` over this renderer — §71's `"gpu"` tier
   * (RFC 0005), gated on `registerPickingPipeline()` exactly as node-material
   * draws are gated on `registerWebgpuNodeMaterialPipeline()`: this method
   * resolves the registry slot and refuses (§85) when nothing registered, so
   * the id pipeline, the service, and its `mapAsync` read-back live only in
   * bundles that opted in (the pipeline-cost law; `wgpu-picking-registry.ts`).
   *
   * What the service receives is a **live window** onto exactly the renderer
   * state an id pass needs — device, the three shared caches (geometry,
   * particles, render targets), the surface size, and the two lifecycle
   * flags — as accessors, so a §61 loss's dropped caches are seen rather
   * than captured stale (`PickingRendererHost`). Each call builds an
   * independent service; the caller owns and disposes it (§83). No GPU call
   * is issued here — the id pipeline compiles on the service's first pass.
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
        "§71: call registerPickingPipeline() from the render-webgpu package " +
          "before createPickingService() (§85).",
        { context: { registered: false } },
      );
    }
    const host: PickingRendererHost = {
      device: () => this.#device,
      geometries: () => this.#geometries,
      particles: () => this.#particles,
      renderTargets: () => this.#renderTargets,
      surfaceWidth: () => Math.round(this.#width * this.#resolution),
      surfaceHeight: () => Math.round(this.#height * this.#resolution),
      deviceLost: () => this.#deviceLost,
      disposed: () => this.#disposed,
    };
    return factory.create(host);
  }

  /** Upload a CPU texture and wait until its queued GPU upload has completed. */
  async prepareTexture(texture: WgpuCacheableTexture): Promise<boolean> {
    this.#assertUsable("prepareTexture");
    const textures = this.#textures;
    if (textures === null)
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "WebgpuRenderer.prepareTexture() needs an initialized renderer.",
      );
    if (this.#deviceLost)
      throw new FourError(
        "CONTEXT_LOST",
        "Cannot prepare a texture while the rendering context is lost.",
      );
    return (await textures.acquireAsync(texture)) !== null;
  }

  /**
   * Reads back `target`'s colour attachment — or the `region` rectangle of it
   * — as tightly packed RGBA8 bytes: §61's `readPixels` (WP-R1.6 shipped the
   * whole-target form; the region form arrived 2026-08-29 with `Rectangle2`
   * in `@fourjs/math`, RFC 0005's named prerequisite, cleared).
   *
   * **Asynchronous, honestly and permanently.** WebGPU has no synchronous
   * readback — `copyTextureToBuffer` + `mapAsync` is the only path (probe-
   * verified; `wgpu-readback.ts`) — and §61's own sketch types the member
   * `Promise<ArrayBuffer>`, which is the RFC 0005 argument this method is the
   * standing evidence for. The result is `width * height * 4` bytes (the
   * region's, when given; the target's otherwise), rows **bottom-to-top**
   * (§7a's Y-up; `wgpu-readback.ts` records the decision). `region` is
   * measured in target texels from the **bottom-left** corner, the same
   * space the rows are defined in; a region copies only its own rectangle.
   *
   * A target that was never rendered into reads back its zero-filled
   * allocation — transparent black, the same defined answer sampling one
   * gives. Unlike the frame methods this one **rejects** rather than skips:
   * it is not called inside a frame, its caller is awaiting a value, and a
   * silently empty buffer would be undefined content by another name.
   * Rejections carry a `FourError`: `INVALID_APPLICATION_STATE` for a
   * disposed renderer, one never initialized, or a disposed target;
   * `DEVICE_LOST` while the device is lost (§89's "a caller asks for
   * something that cannot be satisfied while lost");
   * `UNSUPPORTED_GPU_FEATURE` on a device double without the readback entry
   * points (their presence is the capability — `webgpu-device.ts`). A
   * malformed region — fractional, empty, or hanging off the target — rejects
   * with `validateReadbackRegion`'s `RangeError` (§85, `@fourjs/render`'s
   * shared check, so both backends refuse with the same words).
   */
  async readPixels(
    target: RenderTarget,
    region?: Rectangle2,
  ): Promise<ArrayBuffer> {
    this.#assertUsable("readPixels");
    const device = this.#device;
    const renderTargets = this.#renderTargets;
    if (device === null || renderTargets === null) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "WebgpuRenderer.readPixels() needs an initialized renderer (§61).",
        { context: { method: "readPixels" } },
      );
    }
    if (this.#deviceLost) {
      throw new FourError(
        "DEVICE_LOST",
        "WebgpuRenderer.readPixels() was called while the device is lost; " +
          "there is no surface to read (§61, §89).",
      );
    }
    const record = renderTargets.acquire(target);
    if (record === null) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        `readPixels() was asked for render target ${target.id}, which is ` +
          "disposed (§83).",
        { context: { target: target.id } },
      );
    }
    if (region !== undefined) {
      validateReadbackRegion(region, record.width, record.height);
    }
    const pixels = await readTexturePixels(
      device,
      record.colorTexture,
      record.width,
      record.height,
      region,
    );
    if (pixels === null) {
      throw new FourError(
        "UNSUPPORTED_GPU_FEATURE",
        "This device surface does not implement the readback entry points " +
          "(copyTextureToBuffer / mapAsync); presence is the capability " +
          "(WP-R1.6).",
      );
    }
    return pixels;
  }

  /**
   * Allocates one §82 storage buffer (WP-R1.8, `wgpu-compute.ts`) — the
   * application owns it and owes its `dispose()` (§83).
   *
   * Throws a `FourError`: `INVALID_APPLICATION_STATE` on a renderer that is
   * disposed or was never initialized, or for an option record naming both
   * `size` and `data`, neither, or a size that is not a positive multiple of
   * 4; `DEVICE_LOST` while the device is lost (§89).
   */
  createComputeBuffer(options: ComputeBufferOptions): WgpuComputeBuffer {
    return createComputeBuffer(
      this.#computeDevice("createComputeBuffer"),
      options,
    );
  }

  /**
   * Uploads `data` into a compute buffer at `byteOffset` (§82) — the per-step
   * params refresh the integrator tier needs, without reallocating.
   *
   * The error contract is {@link WebgpuRenderer.createComputeBuffer}'s, plus
   * `INVALID_APPLICATION_STATE` for a disposed buffer or an out-of-range or
   * misaligned write.
   */
  writeComputeBuffer(
    buffer: WgpuComputeBuffer,
    data: ArrayBufferView,
    byteOffset = 0,
  ): void {
    writeComputeBuffer(
      this.#computeDevice("writeComputeBuffer"),
      buffer,
      data,
      byteOffset,
    );
  }

  /**
   * Runs one §82 `ComputePass` (WP-R1.8): compiles the kernel on first use
   * (cached on the source — `wgpu-compute.ts`), binds the storage buffers at
   * `@group(0)` in array order, and submits the dispatch.
   *
   * **This is `Renderer.compute?()`** — the R-1 plan's Q3 promotion,
   * executed 2026-08-29: the descriptor now lives in `@fourjs/render`
   * (`compute.ts` there owns the story) and this method implements the
   * optional interface member. Presence is the capability, the
   * `statistics`/`renderEffect` pattern: WebGL 2 has no compute and never
   * grows this member, and §62's `computeShaders` capability is how an
   * application asks before reaching for it. The frame path never calls it —
   * §82's "basic graphics … must not require compute support", held
   * structurally. A buffer another backend minted is refused per binding
   * (the promoted handle is structural; `wgpu-compute.ts`).
   *
   * Throws a `FourError`: `INVALID_APPLICATION_STATE` on a disposed or
   * never-initialized renderer, for non-integer workgroup counts, or for a
   * disposed buffer in `bindings`; `DEVICE_LOST` while lost;
   * `UNSUPPORTED_GPU_FEATURE` on a device surface without the compute entry
   * points. A kernel that fails to *compile* does not throw — WebGPU surfaces
   * compilation failure through the device's error scopes and the dispatch
   * does nothing, the pipeline cache's recorded reading of the error model.
   */
  compute(pass: ComputePassDescriptor): void {
    const device = this.#computeDevice("compute");
    this.#compute ??= new WgpuComputeCache(device);
    if (!this.#compute.dispatch(pass)) {
      throw new FourError(
        "UNSUPPORTED_GPU_FEATURE",
        "This device surface does not implement the §82 compute entry " +
          "points (createComputePipeline / beginComputePass); presence is " +
          "the capability (WP-R1.8).",
      );
    }
  }

  /**
   * Reads a compute buffer back as a tightly packed `ArrayBuffer` (§82) —
   * `copyBufferToBuffer` + `mapAsync`, `readPixels`' honestly-asynchronous
   * contract for a buffer: rejects rather than skips, with the same codes
   * (`INVALID_APPLICATION_STATE` for a disposed renderer, one never
   * initialized, or a disposed buffer; `DEVICE_LOST` while lost;
   * `UNSUPPORTED_GPU_FEATURE` on a device surface without the entry points).
   */
  async readComputeBuffer(buffer: WgpuComputeBuffer): Promise<ArrayBuffer> {
    const device = this.#computeDevice("readComputeBuffer");
    const bytes = await readComputeBufferBytes(device, buffer);
    if (bytes === null) {
      throw new FourError(
        "UNSUPPORTED_GPU_FEATURE",
        "This device surface does not implement the compute readback entry " +
          "points (copyBufferToBuffer / mapAsync); presence is the " +
          "capability (WP-R1.8).",
      );
    }
    return bytes;
  }

  /**
   * Creates the device residency of one §36 `simulation: "gpu"` particle
   * system (R-31 wiring, 2026-08-29) — see `wgpu-particle-simulation.ts`'s
   * header for the design: flat-lane storage buffers, the WP-R1.8 integrator
   * kernel, `moveSlot` compaction mirroring, and the position buffer doubling
   * as the draw's instance stream.
   *
   * The application binds the result to its emitter
   * (`emitter.bindGpuSimulation(...)`) and **owns its disposal** (§83, the
   * `createPickingService` ownership rule). This renderer registers it under
   * `options.systemId` — the emitting node's id — and the §36 draw arm joins
   * on that key: a frame drawing a particle item whose id has a live
   * registered simulation binds the simulation's position buffer as the
   * per-instance position stream (`gpuInstances` pipeline variant) instead
   * of the interleaved CPU lanes; every other particle item, and every
   * pre-existing scene, draws the landed CPU path byte-identically.
   *
   * One simulation per system id: a duplicate registration is refused —
   * two residencies for one node would make the draw's join ambiguous —
   * dispose the old one first.
   *
   * Throws a `FourError`: `INVALID_APPLICATION_STATE` on a disposed or
   * never-initialized renderer, a duplicate `systemId`, or a non-positive
   * capacity; `DEVICE_LOST` while lost; `UNSUPPORTED_GPU_FEATURE` on a
   * device surface without the §82 compute entry points or
   * `copyBufferToBuffer` — which is how a backendless §36 GPU emitter fails
   * at authoring time rather than drawing a wrong picture (§85; §62's
   * `computeShaders` is the capability to ask first).
   */
  createParticleSimulation(
    options: WgpuParticleSimulationOptions,
  ): WgpuParticleSimulation {
    const device = this.#computeDevice("createParticleSimulation");
    const existing = this.#particleSimulations.get(options.systemId);
    if (existing !== undefined) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "createParticleSimulation was called for a system id that already " +
          "has a live simulation (§36) — dispose the existing one first.",
        { context: { systemId: options.systemId } },
      );
    }
    this.#compute ??= new WgpuComputeCache(device);
    const simulation = new WgpuParticleSimulation(
      device,
      this.#compute,
      options,
      () => {
        // Unhook only our own registration: a loss-cleared or replaced slot
        // must not be clobbered by a late dispose of the old object.
        if (this.#particleSimulations.get(options.systemId) === simulation) {
          this.#particleSimulations.delete(options.systemId);
        }
      },
    );
    this.#particleSimulations.set(options.systemId, simulation);
    return simulation;
  }

  /**
   * The compute methods' shared lifecycle gate: an initialized, un-lost
   * device or a thrown `FourError` — `readPixels`' opening checks, factored
   * because four §82 methods share them verbatim.
   */
  #computeDevice(method: string): GpuDevice {
    this.#assertUsable(method);
    const device = this.#device;
    if (device === null) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        `WebgpuRenderer.${method}() needs an initialized renderer (§61).`,
        { context: { method } },
      );
    }
    if (this.#deviceLost) {
      throw new FourError(
        "DEVICE_LOST",
        `WebgpuRenderer.${method}() was called while the device is lost ` +
          "(§61, §89).",
        { context: { method } },
      );
    }
    return device;
  }

  /**
   * The registered node pipeline store for this device, created on first
   * need, or `null` when nothing registered (§60; RFC 0001; WP-R1.9).
   *
   * Two answers, both §61-safe: **created already** — one field read; or
   * **nothing registered** — `null`, with a one-time §85 development warning
   * naming `registerWebgpuNodeMaterialPipeline()`, and the node draw (or §70
   * graph effect) is skipped rather than approximated. Creation allocates
   * nothing — WGSL compiles per graph inside the store, on the first frame
   * that needs it (`wgpu-node-program.ts`).
   */
  #acquireNodePipelines(
    device: GpuDevice,
    geometries: WgpuGeometryCache,
    textures: WgpuTextureCache,
    renderTargets: WgpuRenderTargetCache,
  ): WgpuNodeMaterialPipelines | null {
    const existing = this.#nodePipelines;
    if (existing !== null) {
      return existing;
    }
    const factory = resolveWebgpuNodeMaterialPipelineFactory();
    if (factory === null) {
      if (DEV) {
        devWarnOnce(
          "webgpu-node-material-unregistered",
          "§60: this scene uses a node material (or §70 graph effect) but no " +
            "node pipeline is registered on the WebGPU backend, so those " +
            "draws are skipped (flat colour would be a different picture). " +
            "Call registerWebgpuNodeMaterialPipeline() from " +
            "the render-webgpu package" +
            " at application setup (RFC 0001).",
        );
      }
      return null;
    }
    const created = factory.create({
      device,
      geometries,
      textures,
      renderTargets,
    });
    this.#nodePipelines = created;
    return created;
  }

  /**
   * The registered skinning pipeline's colour pair for this device, created
   * on first use, or `null` when there is nothing to draw skinned with (§54;
   * RFC 0003).
   *
   * Three answers, all §61-safe (never a throw from inside the frame):
   *
   * - **created already** — the pair, one field read;
   * - **nothing registered** — `null`, with a one-time §85 development
   *   warning naming `registerSkinningPipeline()`; the skinned draw is
   *   skipped rather than shown in bind pose (RFC 0003 §5);
   * - **the factory threw** — `null` forever on this device (the latch),
   *   with a one-time warning; a lost device drops the latch because a
   *   fresh device may succeed.
   */
  #acquireSkinnedPrograms(): SkinnedPrograms | null {
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
          "webgpu-skinning-unregistered",
          "§54: this scene contains a skinned mesh but no skinning pipeline " +
            "is registered, so its draws are skipped (a bind pose would be " +
            "a different picture). Call registerSkinningPipeline() from " +
            "the render-webgpu package" +
            " at application setup (RFC 0003).",
        );
      }
      return null;
    }
    const host: SkinningPipelineHost = {
      device: () => this.#device,
      drawLayout: () => this.#bindGroupLayout,
      textureLayout: () => this.#textures?.bindGroupLayout ?? null,
      lightsLayout: () => {
        const device = this.#device;
        return device === null ? null : this.#acquireLightsLayout(device);
      },
      shadowLightsLayout: () => {
        const device = this.#device;
        return device === null ? null : this.#acquireShadowLightsLayout(device);
      },
    };
    try {
      const compiled = factory.create(host);
      this.#skinnedPrograms = compiled;
      return compiled;
    } catch (error: unknown) {
      this.#skinnedProgramsFailed = true;
      if (DEV) {
        devWarnOnce(
          "webgpu-skinning-compile-failed",
          "§54: the skinning pipeline failed to initialise on this device; " +
            `skinned draws are skipped (§61, §89). ${String(error)}`,
        );
      }
      return null;
    }
  }

  /**
   * Compiles the §69 skinned caster on first use, or `null` when the
   * compile failed on this device. Fail-once: a refusing driver must not
   * be asked again. Never a bind-pose silhouette.
   */
  #acquireSkinnedShadowPipeline(
    programs: SkinnedPrograms,
    descriptor: {
      topology: "triangle-list" | "line-list";
      colorFormat: string;
      depthFormat: string;
    },
  ): GpuRenderPipeline | null {
    try {
      return programs.acquireShadow(descriptor);
    } catch (error: unknown) {
      if (DEV) {
        devWarnOnce(
          "webgpu-skinned-shadow-compile-failed",
          "§69: the skinned shadow pipeline failed to compile on this " +
            `device; skinned casters are skipped (§61, §89). ${String(error)}`,
        );
      }
      return null;
    }
  }

  /**
   * Draws one skinned colour item through the registered pair. Returns
   * whether a uniform block was consumed so the caller can keep `block`
   * honest — a skip must not increment it, or the next draw's offset would
   * land on unwritten staging bytes.
   */
  #drawSkinned(
    pass: GpuRenderPassEncoder,
    programs: SkinnedPrograms,
    bindGroup: GpuBindGroup,
    textures: WgpuTextureCache,
    renderTargets: WgpuRenderTargetCache,
    activeTarget: RenderTarget | null,
    item: Extract<RenderItem, { kind: "skinned-unlit" | "skinned-lit" }>,
    record: WgpuGeometryRecord,
    lit: boolean,
    block: number,
    depthFormat: string | null,
    frameStencil: boolean,
    clip: ItemClip | null,
    stencilReference: number,
    statistics: RenderStatistics | null,
    shadowGroup: GpuBindGroup | null,
    lightBase: number,
  ): { stencilReference: number; drew: boolean } {
    const skipped = { stencilReference, drew: false };
    const joints = record.jointBuffer;
    const weights = record.weightBuffer;
    if (joints === null || weights === null) {
      return skipped;
    }
    const material = item.material;
    const map = material.map ?? null;
    const mapBindGroup =
      map === null || record.uvBuffer === null
        ? null
        : resolveFrameTexture(textures, renderTargets, activeTarget, map);
    if (map !== null && record.uvBuffer !== null && mapBindGroup === null) {
      return skipped;
    }
    const useMap = mapBindGroup !== null;
    const vertexColors =
      !lit &&
      "vertexColors" in material &&
      material.vertexColors === true &&
      record.colorBuffer !== null;
    const normals = lit && record.normalBuffer !== null;
    let receiving = false;
    let shadedLights: GpuBindGroup | null = null;
    if (lit) {
      const lightsBindGroup = this.#lightsBindGroup;
      if (lightsBindGroup === null) {
        return skipped;
      }
      shadedLights = lightsBindGroup;
      if (shadowGroup !== null && item.receiveShadow) {
        receiving = true;
        shadedLights = shadowGroup;
      }
    }
    const stencilRecord = frameStencil
      ? clip !== null
        ? clip.stencil
        : material.stencil
      : undefined;
    const descriptor: WgpuSkinnedDrawDescriptor = {
      vertexColors,
      map: useMap,
      normals,
      shadow: receiving,
      blend:
        material.transparent === true
          ? (material.blendMode ?? "normal")
          : "none",
      depthTest: depthFormat !== null && material.depthTest !== false,
      depthWrite: depthFormat !== null && material.depthWrite !== false,
      colorWrite: material.colorWrite !== false,
      topology: record.topology,
      colorFormat: this.#frameFormat,
      depthFormat,
      stencil:
        stencilRecord === undefined ? null : stencilDescriptor(stencilRecord),
    };
    const pipeline = lit
      ? programs.lit.acquire(descriptor)
      : programs.unlit.acquire(descriptor);
    const paletteGroup = programs.paletteBindGroup();
    if (pipeline === null || paletteGroup === null) {
      return skipped;
    }
    const opacity = material.opacity ?? 1;
    const color = material.color;
    this.#writeBlock(
      block,
      this.#viewProjection,
      item.worldMatrix,
      color[0],
      color[1],
      color[2],
      color[3] * opacity,
    );
    const paletteOffset = programs.packPalette(item.jointMatrices);
    pass.setPipeline(pipeline);
    pass.setBindGroup(
      0,
      bindGroup,
      dynamicOffset(block * UNIFORM_STRIDE_BYTES),
    );
    if (lit && shadedLights !== null) {
      pass.setBindGroup(
        LIGHTS_BIND_GROUP_INDEX,
        shadedLights,
        dynamicOffset(lightBase),
      );
    }
    if (useMap && mapBindGroup !== null) {
      pass.setBindGroup(
        lit ? SHADED_MAP_BIND_GROUP_INDEX : MAP_BIND_GROUP_INDEX,
        mapBindGroup,
      );
    }
    pass.setBindGroup(programs.paletteGroup(lit, useMap), paletteGroup, [
      paletteOffset,
    ]);
    let nextStencil = stencilReference;
    if (stencilRecord !== undefined) {
      nextStencil = applyStencilReference(
        pass,
        stencilReference,
        stencilRecord.ref,
      );
    }
    let slot = 0;
    pass.setVertexBuffer(slot, record.positionBuffer);
    if (lit && normals && record.normalBuffer !== null) {
      slot += 1;
      pass.setVertexBuffer(slot, record.normalBuffer);
    }
    if (!lit && vertexColors && record.colorBuffer !== null) {
      slot += 1;
      pass.setVertexBuffer(slot, record.colorBuffer);
    }
    if (useMap && record.uvBuffer !== null) {
      slot += 1;
      pass.setVertexBuffer(slot, record.uvBuffer);
    }
    slot += 1;
    pass.setVertexBuffer(slot, joints);
    slot += 1;
    pass.setVertexBuffer(slot, weights);
    if (record.indexBuffer !== null && record.indexFormat !== null) {
      pass.setIndexBuffer(record.indexBuffer, record.indexFormat);
      pass.drawIndexed(record.count);
    } else {
      pass.draw(record.count);
    }
    if (statistics !== null) {
      countDraw(statistics, record.topology, record.count, 1);
    }
    return { stencilReference: nextStencil, drew: true };
  }

  /** Builds the pipeline descriptor for one §70 effect draw (WP-R1.6). */
  #effectDescriptor(
    kind: WgpuEffectKind,
    colorFormat: string,
  ): WgpuPipelineDescriptor {
    return {
      kind: "effect",
      vertexColors: false,
      // An effect always samples its source; the flag is fixed, as §55's is.
      map: true,
      // §70: no blending — an effect replaces — and no depth attachment at
      // all, so both depth bits are off and `depthFormat` is `null`.
      blend: "none",
      depthTest: false,
      depthWrite: false,
      colorWrite: true,
      topology: "triangle-list",
      colorFormat,
      depthFormat: null,
      stencil: null,
      batch: null,
      effect: kind,
    };
  }

  /** The grade's 16-byte uniform buffer, created by the first grade. */
  #acquireEffectBuffer(device: GpuDevice): GpuBuffer {
    this.#effectBuffer ??= device.createBuffer({
      label: "fourJS:effect-uniforms",
      size: EFFECT_UNIFORM_BYTES,
      usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
    });
    return this.#effectBuffer;
  }

  /** §70's group-1 layout, one per renderer, created on first use (WP-R1.6). */
  #acquireEffectLayout(device: GpuDevice): GpuBindGroupLayout {
    this.#effectLayout ??= createEffectBindGroupLayout(device);
    return this.#effectLayout;
  }

  /**
   * The grade's bind group over the shared block — the sprite pair's
   * lifecycle, fourth subsystem: created by the first grade, dropped on
   * device loss and disposal. The buffer never regrows (it is one block), so
   * unlike the sprite group nothing else ever drops it.
   */
  #acquireEffectBindGroup(device: GpuDevice): GpuBindGroup {
    this.#effectBindGroup ??= device.createBindGroup({
      label: "fourJS:effect-uniforms",
      layout: this.#acquireEffectLayout(device),
      entries: [
        {
          binding: 0,
          resource: {
            buffer: this.#acquireEffectBuffer(device),
            offset: 0,
            size: EFFECT_UNIFORM_BYTES,
          },
        },
      ],
    });
    return this.#effectBindGroup;
  }

  /**
   * Releases every GPU resource this renderer owns (§83).
   *
   * Idempotent and terminal, and succeeds while the device is lost — the
   * caches drop their records without calling into a device that is gone. Every
   * other method throws `INVALID_APPLICATION_STATE` afterwards, as the other
   * two backends do.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    if (this.#deviceLost) {
      this.#geometries?.forget();
      this.#textures?.forget();
      this.#renderTargets?.forget();
      this.#particles?.forget();
      // §65's uploader, when the application assigned one (R-9): its buffers
      // belong to the lost device — dropped, never destroyed.
      this.batching?.forget();
      this.#gpuTimer?.forget();
    } else {
      this.#geometries?.dispose();
      this.#textures?.dispose();
      this.#renderTargets?.dispose();
      this.#particles?.dispose();
      this.batching?.dispose();
      this.#gpuTimer?.dispose();
      this.#uniformBuffer?.destroy();
      this.#lightsBuffer?.destroy();
      this.#effectBuffer?.destroy();
      this.#depthTexture?.destroy?.();
      this.#context?.unconfigure?.();
      this.#device?.destroy();
    }
    this.#pipelines?.dispose();
    // §82's compute caches (WP-R1.8): nothing here has a destroy(); dropping
    // is the release. Application-created compute *buffers* are §83's
    // creator-owns — `WgpuComputeBuffer.dispose` is theirs to call.
    this.#compute?.dispose();
    this.#compute = null;
    // §36 GPU particle simulations (R-31 wiring) are the same creator-owns
    // story one type up: the registry drops its joins, the application owes
    // each simulation's `dispose()` — which stays safe after this (destroy
    // on a released device's buffer is a defined no-op).
    this.#particleSimulations.clear();
    // §60's node store (WP-R1.9): destroyed with the live device's caches.
    // No lost-branch counterpart is needed — the loss handler below already
    // forgot and dropped the store the moment the device died, so on this
    // path a lost renderer's field is always `null` (an `if (lost) forget()`
    // here would be the unreachable re-check the coverage rule forbids).
    this.#nodePipelines?.dispose();
    this.#nodePipelines = null;
    this.#skinnedPrograms?.dispose();
    this.#skinnedPrograms = null;
    this.#skinnedProgramsFailed = false;
    // §69's target is engine-side state this renderer owns (R-18): disposed
    // on both branches — its GPU rows were released (or died) with the cache
    // above, and the §83 accounting closes with the object.
    this.#shadowTarget?.dispose();
    this.#shadowTarget = null;
    this.#shadowLightsLayout = null;
    this.#shadowSampler = null;
    this.#shadowBindGroup = null;
    this.#shadowBindGroupView = null;
    this.#geometries = null;
    this.#textures = null;
    this.#renderTargets = null;
    this.#particles = null;
    this.#pipelines = null;
    this.#pipelineMemo.reset();
    this.#uniformBuffer = null;
    this.#bindGroup = null;
    this.#bindGroupLayout = null;
    this.#spriteLayout = null;
    this.#spriteBindGroup = null;
    this.#particleLayout = null;
    this.#particleBindGroup = null;
    this.#standardLayout = null;
    this.#standardBindGroup = null;
    this.#lightsLayout = null;
    this.#lightsBuffer = null;
    this.#lightsBindGroup = null;
    this.#effectLayout = null;
    this.#effectBuffer = null;
    this.#effectBindGroup = null;
    this.#depthTexture = null;
    this.#context = null;
    this.#device = null;
    this.#canvas = null;
    this.#gpuTimer = null;
    this.events.removeAllListeners();
  }

  /** Records one view's clear (see `wgpu-unlit.ts` for why a clear is a draw). */
  #drawClear(
    pass: GpuRenderPassEncoder,
    pipelines: WgpuPipelineCache,
    bindGroup: GpuBindGroup,
    block: number,
    clearColor: boolean,
    depthFormat: string | null,
    frameStencil: boolean,
  ): void {
    const pipeline = pipelines.acquire({
      kind: "clear",
      vertexColors: false,
      map: false,
      blend: "none",
      // `depthTest: false` compiles to `depthCompare: "always"`, which is what
      // makes this draw *set* depth to the far plane rather than test against
      // whatever the previous frame left there.
      depthTest: false,
      // Off exactly when the surface has no depth buffer to clear — a
      // `depth: false` target's colour-only clear (WP-R1.6).
      depthWrite: depthFormat !== null,
      colorWrite: clearColor,
      topology: "triangle-list",
      colorFormat: this.#frameFormat,
      // §67: a stencil-carrying surface's clear also zeroes the stencil
      // rectangle — see `CLEAR_STENCIL`. Both comparisons ignore the stencil
      // reference, so no `setStencilReference` accompanies this draw.
      depthFormat,
      stencil: frameStencil ? CLEAR_STENCIL : null,
      batch: null,
    });
    if (pipeline === null) {
      // Unreachable for the reason the unlit path states; same narrowing.
      return;
    }
    pass.setPipeline(pipeline);
    pass.setBindGroup(
      0,
      bindGroup,
      dynamicOffset(block * UNIFORM_STRIDE_BYTES),
    );
    pass.draw(CLEAR_VERTEX_COUNT);
  }

  /**
   * Records one §55 sprite draw (WP-R1.3): the sprite pipeline over the
   * quad's position stream and authored uv stream, the texture at group 1,
   * the tint in the sprite uniform block. Returns the stencil reference now
   * in effect.
   *
   * §55's pipeline blends **by construction** — it did before §57's
   * `transparent` flag existed, and a textured quad with an alpha channel has
   * to composite whatever the flag says — so the blend state ignores
   * `transparent` and takes only the mode. Everything else the material
   * declares (depth test, depth write, colour write, §67's stencil) applies as
   * on any draw.
   */
  #drawSprite(
    device: GpuDevice,
    pass: GpuRenderPassEncoder,
    pipelines: WgpuPipelineCache,
    uniformBuffer: GpuBuffer,
    item: SpriteItem,
    record: WgpuGeometryRecord,
    mapBindGroup: GpuBindGroup,
    block: number,
    depthFormat: string | null,
    frameStencil: boolean,
    clip: ItemClip | null,
    stencilReference: number,
    statistics: RenderStatistics | null,
  ): number {
    const material = item.material;
    // §67's resolution — the unlit path's, verbatim: the engine's clip record
    // outranks the material's own §57 stencil.
    const stencilRecord = frameStencil
      ? clip !== null
        ? clip.stencil
        : material.stencil
      : undefined;
    // Through the A3 memo (the shaded arm's note).
    const request = this.#pipelineRequest;
    request.kind = "sprite";
    request.vertexColors = false;
    // Not a variant: a sprite always samples (§55), so the flag is fixed
    // and the family has exactly one WGSL module.
    request.map = true;
    request.blend = material.blendMode ?? "normal";
    // Normalized off on a depthless pass (WP-R1.6) — the shaded arm's note.
    request.depthTest = depthFormat !== null && material.depthTest !== false;
    request.depthWrite = depthFormat !== null && material.depthWrite !== false;
    request.colorWrite = material.colorWrite !== false;
    request.topology = record.topology;
    request.colorFormat = this.#frameFormat;
    request.depthFormat = depthFormat;
    request.stencil = stencilRecord ?? null;
    request.normals = undefined;
    request.shadow = false;
    request.metalRoughness = false;
    request.gpuInstances = false;
    const pipeline = this.#pipelineMemo.acquire(pipelines, request);
    if (pipeline === null) {
      // Unreachable for the unlit path's reason — this renderer always wires
      // both layout providers; same narrowing.
      return stencilReference;
    }

    const opacity = material.opacity ?? 1;
    const tint = material.tint;
    this.#writeBlock(
      block,
      this.#viewProjection,
      item.worldMatrix,
      tint[0],
      tint[1],
      tint[2],
      tint[3] * opacity,
    );

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.#acquireSpriteBindGroup(device, uniformBuffer), [
      block * UNIFORM_STRIDE_BYTES,
    ]);
    pass.setBindGroup(MAP_BIND_GROUP_INDEX, mapBindGroup);
    let reference = stencilReference;
    if (stencilRecord !== undefined) {
      reference = applyStencilReference(
        pass,
        stencilReference,
        stencilRecord.ref,
      );
    }
    pass.setVertexBuffer(0, record.positionBuffer);
    if (record.uvBuffer !== null) {
      pass.setVertexBuffer(1, record.uvBuffer);
    }
    if (record.indexBuffer !== null && record.indexFormat !== null) {
      pass.setIndexBuffer(record.indexBuffer, record.indexFormat);
      pass.drawIndexed(record.count);
    } else {
      pass.draw(record.count);
    }
    if (statistics !== null) {
      countDraw(statistics, record.topology, record.count, 1);
    }
    return reference;
  }

  /**
   * Records one §36 particle draw (WP-R1.8): the instanced billboard pipeline
   * over the shared quad's position stream and the system's per-instance
   * buffer, with the three matrices — projection and view **separately**,
   * because the billboard offset happens between them (`wgpu-particles.ts`) —
   * in the particle-widened uniform block. Returns the stencil reference now
   * in effect.
   *
   * The state is the GL arm's, held as pipeline identity instead of ambient
   * calls: particles are transparent by construction (§36's colour ramp) and
   * carry no material to say otherwise, so the blend is always `"normal"`
   * straight alpha; depth test, depth writes and colour writes are §57's
   * defaults; and §67's clip record is the only stencil a material-less item
   * can carry (R-23: the clip is per draw, and §36's batched item is one
   * draw).
   */
  #drawParticles(
    device: GpuDevice,
    pass: GpuRenderPassEncoder,
    pipelines: WgpuPipelineCache,
    uniformBuffer: GpuBuffer,
    particles: WgpuParticleCache,
    item: ParticleItem,
    record: WgpuGeometryRecord,
    batch: WgpuParticleRecord,
    camera: Viewport["camera"],
    block: number,
    depthFormat: string | null,
    frameStencil: boolean,
    clip: ItemClip | null,
    stencilReference: number,
    statistics: RenderStatistics | null,
  ): number {
    const stencilRecord =
      frameStencil && clip !== null ? clip.stencil : undefined;
    // §36 `simulation: "gpu"` (R-31 wiring): a live registered simulation
    // for this system id re-sources the position stream from its storage
    // buffer (`createParticleSimulation` owns the join's story). A disposed
    // registration is treated as absent — drawing a destroyed buffer is a
    // validation error, and the CPU stream is at worst spawn-stale, which
    // the emitter's docs own. The lookup is one map get per particle item,
    // a miss against an empty map for every CPU-simulated scene.
    const registered = this.#particleSimulations.get(item.id);
    const simulation =
      registered !== undefined && !registered.disposed ? registered : null;
    // Through the A3 memo (the shaded arm's note).
    const request = this.#pipelineRequest;
    request.kind = "particles";
    request.vertexColors = false;
    request.map = false;
    request.blend = "normal";
    // Normalized off on a depthless pass (WP-R1.6) — the shaded arm's note.
    request.depthTest = depthFormat !== null;
    request.depthWrite = depthFormat !== null;
    request.colorWrite = true;
    request.topology = record.topology;
    request.colorFormat = this.#frameFormat;
    request.depthFormat = depthFormat;
    request.stencil = stencilRecord ?? null;
    request.normals = undefined;
    request.shadow = false;
    request.metalRoughness = false;
    request.gpuInstances = simulation !== null;
    const pipeline = this.#pipelineMemo.acquire(pipelines, request);
    if (pipeline === null) {
      // Unreachable for the unlit path's reason — this renderer always wires
      // the particle layout provider; same narrowing.
      return stencilReference;
    }

    this.#writeParticleBlock(
      block,
      camera.projectionMatrix,
      camera.viewMatrix,
      item.worldMatrix,
    );
    // The instance stream, uploaded once per frame however many views draw
    // it (`wgpu-particles.ts` on the cadence); `queue.writeBuffer` copies at
    // call time and executes before the submit that reads it.
    particles.upload(batch, item, this.#frameOrdinal);

    pass.setPipeline(pipeline);
    pass.setBindGroup(
      0,
      this.#acquireParticleBindGroup(device, uniformBuffer),
      dynamicOffset(block * UNIFORM_STRIDE_BYTES),
    );
    let reference = stencilReference;
    if (stencilRecord !== undefined) {
      reference = applyStencilReference(
        pass,
        stencilReference,
        stencilRecord.ref,
      );
    }
    pass.setVertexBuffer(0, record.positionBuffer);
    if (simulation !== null) {
      // GPU residency: positions from the simulation's storage buffer at
      // slot 1 (`PARTICLE_GPU_POSITION_BUFFER_LAYOUT`), the interleaved
      // stream demoted to slot 2 for its CPU-truth size and colour lanes
      // (`wgpu-particles.ts` on the two layout tables). The upload above
      // still ran — ramps are CPU state — and its stale position lanes
      // stride past unread.
      pass.setVertexBuffer(1, simulation.positions.buffer);
      pass.setVertexBuffer(2, batch.buffer);
    } else {
      pass.setVertexBuffer(1, batch.buffer);
    }
    // Non-indexed and instanced, GL's `drawArraysInstanced` verbatim: the
    // instance mesh contract is the shared six-vertex quad (`particles.ts`),
    // so the record's index stream — which the GL arm equally ignores — has
    // no role here.
    pass.draw(record.count, item.count);
    if (statistics !== null) {
      // One draw call, `item.count` instances of the shared quad — the §36
      // system's whole per-frame GPU cost, and the one place in this backend
      // where `instances` exceeds `drawCalls` (§84).
      countDraw(statistics, record.topology, record.count, item.count);
    }
    return reference;
  }

  /** §36's group-0 layout, one per renderer, created on first use (WP-R1.8). */
  #acquireParticleLayout(device: GpuDevice): GpuBindGroupLayout {
    this.#particleLayout ??= createParticleBindGroupLayout(device);
    return this.#particleLayout;
  }

  /**
   * The particle draws' bind group over the current uniform buffer, created
   * by the first particle draw after initialization or after a regrowth —
   * `#acquireSpriteBindGroup`'s lifecycle, fourth block size over one buffer.
   */
  #acquireParticleBindGroup(
    device: GpuDevice,
    buffer: GpuBuffer,
  ): GpuBindGroup {
    this.#particleBindGroup ??= device.createBindGroup({
      label: "fourJS:particle-uniforms",
      layout: this.#acquireParticleLayout(device),
      entries: [
        {
          binding: 0,
          resource: { buffer, offset: 0, size: PARTICLE_UNIFORM_BYTES },
        },
      ],
    });
    return this.#particleBindGroup;
  }

  /**
   * Packs one `ParticleUniforms` block — projection, view, model, in
   * `wgpu-particles.ts`'s layout — into the staging array at `block`'s
   * stride. All 48 floats of the binding are written, so no uploaded byte of
   * the block is history (§33); the narrowing from the matrices' f64
   * elements happens here, element by element, as in `#writeBlock`.
   */
  #writeParticleBlock(
    block: number,
    projection: Matrix4,
    view: Matrix4,
    model: Matrix4,
  ): void {
    const staging = this.#uniformStaging;
    const base = block * UNIFORM_STRIDE_FLOATS;
    const projectionBase = base + PARTICLE_PROJECTION_OFFSET / 4;
    const viewBase = base + PARTICLE_VIEW_OFFSET / 4;
    const modelBase = base + PARTICLE_MODEL_OFFSET / 4;
    for (let index = 0; index < 16; index += 1) {
      staging[projectionBase + index] = projection.elements[index];
      staging[viewBase + index] = view.elements[index];
      staging[modelBase + index] = model.elements[index];
    }
  }

  /**
   * Records one §65 merged draw (WP-R1.3): the batch pipeline — the unlit
   * shader family over the planner's interleaved stream — with the identity
   * model (positions arrive baked into world space, `batch.ts`), the shared
   * material's colour or tint, and the run's one clip record. The uploader
   * owns the buffers and the `drawIndexed`; see `wgpu-batch.ts`. Returns the
   * stencil reference now in effect.
   */
  #drawBatch(
    pass: GpuRenderPassEncoder,
    pipelines: WgpuPipelineCache,
    bindGroup: GpuBindGroup,
    batching: WgpuRenderBatching,
    device: GpuDevice,
    batch: RenderBatch,
    mapBindGroup: GpuBindGroup | null,
    block: number,
    depthFormat: string | null,
    frameStencil: boolean,
    stencilReference: number,
    statistics: RenderStatistics | null,
  ): number {
    const material = batch.material;
    const clip = batch.clip ?? null;
    const stencilRecord = frameStencil
      ? clip !== null
        ? clip.stencil
        : material.stencil
      : undefined;
    // An unlit batch whose named texture failed to resolve draws untextured
    // over the same interleaved stream — the uv floats are strided over
    // (`batchVertexBufferLayout`). A sprite batch never reaches here with
    // `null`; the caller skipped the whole run.
    const mapGroup = batch.hasUvs ? mapBindGroup : null;
    const topology = batch.mode === "lines" ? "line-list" : "triangle-list";
    const pipeline = pipelines.acquire({
      kind: "batch",
      vertexColors: batch.hasColors,
      map: mapGroup !== null,
      // §55's pipeline blends by construction, so a sprite batch does too;
      // an unlit batch blends only when its material asks (§57).
      blend:
        batch.kind === "sprite" || material.transparent === true
          ? (material.blendMode ?? "normal")
          : "none",
      // Normalized off on a depthless pass (WP-R1.6) — the shaded arm's note.
      depthTest: depthFormat !== null && material.depthTest !== false,
      depthWrite: depthFormat !== null && material.depthWrite !== false,
      colorWrite: material.colorWrite !== false,
      topology,
      colorFormat: this.#frameFormat,
      depthFormat,
      stencil:
        stencilRecord === undefined ? null : stencilDescriptor(stencilRecord),
      batch: { uvs: batch.hasUvs, colors: batch.hasColors },
    });
    if (pipeline === null) {
      // Unreachable for the unlit path's reason; same narrowing.
      return stencilReference;
    }

    // `model: null` is the identity — positions arrive in world space.
    const color = batch.color;
    this.#writeBlock(
      block,
      this.#viewProjection,
      null,
      color[0],
      color[1],
      color[2],
      color[3] * batch.opacity,
    );
    pass.setPipeline(pipeline);
    pass.setBindGroup(
      0,
      bindGroup,
      dynamicOffset(block * UNIFORM_STRIDE_BYTES),
    );
    if (mapGroup !== null) {
      pass.setBindGroup(MAP_BIND_GROUP_INDEX, mapGroup);
    }
    let reference = stencilReference;
    if (stencilRecord !== undefined) {
      reference = applyStencilReference(
        pass,
        stencilReference,
        stencilRecord.ref,
      );
    }
    batching.draw(device, pass, batch);
    if (statistics !== null) {
      // One draw call for `batch.items` items — which is exactly what §65
      // asks a diagnostic to make visible (§84): the triangle count is
      // unchanged and `drawCalls` falls.
      countDraw(statistics, topology, batch.indexCount, 1);
    }
    return reference;
  }

  /** §55's group-0 layout, one per renderer, created on first use. */
  #acquireSpriteLayout(device: GpuDevice): GpuBindGroupLayout {
    this.#spriteLayout ??= createSpriteBindGroupLayout(device);
    return this.#spriteLayout;
  }

  /**
   * The sprite draws' bind group over the current uniform buffer, created by
   * the first sprite draw after initialization or after a regrowth — see the
   * field's note.
   */
  #acquireSpriteBindGroup(device: GpuDevice, buffer: GpuBuffer): GpuBindGroup {
    this.#spriteBindGroup ??= device.createBindGroup({
      label: "fourJS:sprite-uniforms",
      layout: this.#acquireSpriteLayout(device),
      entries: [
        {
          binding: 0,
          resource: { buffer, offset: 0, size: SPRITE_UNIFORM_BYTES },
        },
      ],
    });
    return this.#spriteBindGroup;
  }

  /** §68's group-1 layout, one per renderer, created on first use (WP-R1.5). */
  #acquireLightsLayout(device: GpuDevice): GpuBindGroupLayout {
    this.#lightsLayout ??= createLightsBindGroupLayout(device);
    return this.#lightsLayout;
  }

  /** §59's group-0 layout, one per renderer, created on first use (WP-R1.5). */
  #acquireStandardLayout(device: GpuDevice): GpuBindGroupLayout {
    this.#standardLayout ??= createStandardBindGroupLayout(device);
    return this.#standardLayout;
  }

  /**
   * The standard draws' bind group over the current uniform buffer, created
   * by the first standard draw after initialization or after a regrowth —
   * `#acquireSpriteBindGroup`'s lifecycle, third block size over one buffer.
   */
  #acquireStandardBindGroup(
    device: GpuDevice,
    buffer: GpuBuffer,
  ): GpuBindGroup {
    this.#standardBindGroup ??= device.createBindGroup({
      label: "fourJS:standard-uniforms",
      layout: this.#acquireStandardLayout(device),
      entries: [
        {
          binding: 0,
          resource: { buffer, offset: 0, size: STANDARD_UNIFORM_BYTES },
        },
      ],
    });
    return this.#standardBindGroup;
  }

  /** §69's group-1 layout for receiving draws, created on first use (WP-R1.7). */
  #acquireShadowLightsLayout(device: GpuDevice): GpuBindGroupLayout {
    this.#shadowLightsLayout ??= createShadowLightsBindGroupLayout(device);
    return this.#shadowLightsLayout;
  }

  /**
   * The receiving draws' group-1 bind group (WP-R1.7): the widened light
   * block over the **same** lights buffer the plain group offsets into, plus
   * the shadow map's depth view and the shared comparison sampler — resolved
   * once per shadowed frame, beside the caster pass.
   *
   * Cached per (buffer, view) pair: `#growLights` drops it when the buffer is
   * regrown, and a reallocated map (a `mapSize` change — the cache row's
   * version bump) hands this a different view and rebuilds.
   */
  #acquireShadowBindGroup(
    device: GpuDevice,
    buffer: GpuBuffer,
    view: GpuTextureView,
  ): GpuBindGroup {
    if (this.#shadowBindGroup !== null && this.#shadowBindGroupView === view) {
      return this.#shadowBindGroup;
    }
    this.#shadowSampler ??= createShadowSampler(device);
    this.#shadowBindGroup = device.createBindGroup({
      label: "fourJS:shadow-lights",
      layout: this.#acquireShadowLightsLayout(device),
      entries: [
        {
          binding: 0,
          resource: { buffer, offset: 0, size: SHADOW_LIGHT_UNIFORM_BYTES },
        },
        { binding: SHADOW_MAP_BINDING, resource: view },
        { binding: SHADOW_SAMPLER_BINDING, resource: this.#shadowSampler },
      ],
    });
    this.#shadowBindGroupView = view;
    return this.#shadowBindGroup;
  }

  /**
   * Records §69's directional shadow map as its own depth-clearing render
   * pass on the frame's encoder, and returns the cache record it drew into —
   * `null` when the map could not be produced, which costs the frame its
   * shadows and nothing else (§61) — plus the next free uniform block.
   *
   * The GL `#renderShadowMap`'s contract, restated for this backend's seams:
   *
   * - **The target is the renderer's own `RenderTarget`**, described
   *   `depthTexture: true` the first time a frame asks and `resize`d when
   *   §69's `mapSize` changes — the version bump is what makes the cache
   *   reallocate on this very frame (R-4), and the R1.6 format table is what
   *   makes the depth row samplable `depth32float`.
   * - **`loadOp` clears here, legitimately** — the second member of the mip
   *   blit's exception: a shadow pass has no sub-rectangle to honour, so
   *   §61's clears-are-scissored-draws argument does not reach it, and
   *   `depthLoadOp: "clear"` to the far plane is the whole-map clear GL
   *   spells as an opened scissor plus `clear(DEPTH_BUFFER_BIT)`. The colour
   *   attachment loads: it is written by the caster stage and read by
   *   nothing (`wgpu-shadow.ts`).
   * - **It draws from the frame's list, in list order** — same items, same
   *   `worldMatrix`, including §43's interpolated pose — filtered to
   *   `castShadow` items of the kinds this backend draws; `wgpu-shadow.ts`'s
   *   header owns each exclusion. §46 layer masks are deliberately not
   *   applied (frame state must not depend on which viewport is first) and
   *   §67 clips cannot be (the map's format carries no stencil planes).
   * - **Caster blocks ride the frame's strided uniform buffer** — the
   *   light's matrix in the `viewProjection` slot, the caster's world matrix
   *   in `model`, the never-read colour as the mask draws' canonical zeros —
   *   so the pass needs no allocation of its own and the one
   *   `queue.writeBuffer` at the end of the frame covers it.
   */
  #renderShadowMap(
    device: GpuDevice,
    encoder: GpuCommandEncoder,
    pipelines: WgpuPipelineCache,
    geometries: WgpuGeometryCache,
    renderTargets: WgpuRenderTargetCache,
    bindGroup: GpuBindGroup,
    items: readonly RenderItem[],
    blockStart: number,
    statistics: RenderStatistics | null,
    skinnedPrograms: SkinnedPrograms | null,
  ): { record: WgpuRenderTargetRecord | null; block: number } {
    let block = blockStart;
    const size = sceneLights.shadowMapSize;
    let target = this.#shadowTarget;
    if (target === null) {
      target = new RenderTarget({
        width: size,
        height: size,
        depthTexture: true,
      });
      this.#shadowTarget = target;
    } else if (target.width !== size) {
      target.resize(size, size);
    }

    const record = renderTargets.acquire(target);
    if (record === null || record.depthView === null) {
      return { record: null, block };
    }

    const pass = encoder.beginRenderPass({
      label: "fourJS:shadow",
      colorAttachments: [
        { view: record.colorView, loadOp: "load", storeOp: "store" },
      ],
      depthStencilAttachment: {
        view: record.depthView,
        depthLoadOp: "clear",
        depthClearValue: 1,
        depthStoreOp: "store",
      },
    });
    for (const item of items) {
      // The caster filter — `wgpu-shadow.ts`'s header owns the list: §49's
      // opt-out, sprites (a quad would cast its rectangle). Masks and
      // particle items carry `castShadow: false` from the list builder —
      // a §36 billboard has no surface to project, drawn (WP-R1.8) or not.
      // Skinned casters draw through `acquireShadow()` when the colour
      // pair is registered; unregistered or failed skips, never bind-pose.
      // §60 (WP-R1.9): a node material with **no** displacement casts its
      // geometry exactly — depth ignores colour, so the shared caster
      // module is right for it — while a displacing graph would cast its
      // *undisplaced* silhouette, a different picture, so those casters
      // skip: GL's node-caster rule, verbatim (and like GL's,
      // registration-independent — the caster module is this backend's own).
      if (
        !item.castShadow ||
        (item.kind !== "unlit" &&
          item.kind !== "lit" &&
          item.kind !== "standard" &&
          item.kind !== "node" &&
          item.kind !== "skinned-unlit" &&
          item.kind !== "skinned-lit") ||
        (item.kind === "node" &&
          item.material.graph.positionOffset !== undefined)
      ) {
        continue;
      }
      if (isSkinnedUnlitItem(item) || isSkinnedLitItem(item)) {
        if (skinnedPrograms === null) {
          continue;
        }
        const geometry = geometries.acquire(item.geometry, false, true);
        if (
          geometry === null ||
          geometry.jointBuffer === null ||
          geometry.weightBuffer === null
        ) {
          continue;
        }
        const depthFormat = record.depthFormat;
        if (depthFormat === null) {
          continue;
        }
        const skinnedPipeline = this.#acquireSkinnedShadowPipeline(
          skinnedPrograms,
          {
            topology: geometry.topology,
            colorFormat: RENDER_TARGET_COLOR_FORMAT,
            depthFormat,
          },
        );
        if (skinnedPipeline === null) {
          continue;
        }
        const paletteGroup = skinnedPrograms.paletteBindGroup();
        if (paletteGroup === null) {
          continue;
        }
        const paletteOffset = skinnedPrograms.packPalette(item.jointMatrices);
        this.#writeBlock(
          block,
          sceneLights.shadowMatrix,
          item.worldMatrix,
          0,
          0,
          0,
          0,
        );
        pass.setPipeline(skinnedPipeline);
        pass.setBindGroup(
          0,
          bindGroup,
          dynamicOffset(block * UNIFORM_STRIDE_BYTES),
        );
        pass.setBindGroup(1, paletteGroup, dynamicOffset(paletteOffset));
        pass.setVertexBuffer(0, geometry.positionBuffer);
        pass.setVertexBuffer(1, geometry.jointBuffer);
        pass.setVertexBuffer(2, geometry.weightBuffer);
        if (geometry.indexBuffer !== null && geometry.indexFormat !== null) {
          pass.setIndexBuffer(geometry.indexBuffer, geometry.indexFormat);
          pass.drawIndexed(geometry.count);
        } else {
          pass.draw(geometry.count);
        }
        if (statistics !== null) {
          countDraw(statistics, geometry.topology, geometry.count, 1);
        }
        block += 1;
        continue;
      }
      const geometry = geometries.acquire(item.geometry);
      if (geometry === null) {
        continue;
      }
      const pipeline = pipelines.acquire({
        kind: "shadow",
        vertexColors: false,
        map: false,
        blend: "none",
        depthTest: true,
        depthWrite: true,
        colorWrite: true,
        topology: geometry.topology,
        colorFormat: RENDER_TARGET_COLOR_FORMAT,
        depthFormat: record.depthFormat,
        stencil: null,
        batch: null,
      });
      if (pipeline === null) {
        // Unreachable for the reason the unlit path states; same narrowing.
        continue;
      }
      this.#writeBlock(
        block,
        sceneLights.shadowMatrix,
        item.worldMatrix,
        0,
        0,
        0,
        0,
      );
      pass.setPipeline(pipeline);
      pass.setBindGroup(
        0,
        bindGroup,
        dynamicOffset(block * UNIFORM_STRIDE_BYTES),
      );
      pass.setVertexBuffer(0, geometry.positionBuffer);
      if (geometry.indexBuffer !== null && geometry.indexFormat !== null) {
        pass.setIndexBuffer(geometry.indexBuffer, geometry.indexFormat);
        pass.drawIndexed(geometry.count);
      } else {
        pass.draw(geometry.count);
      }
      if (statistics !== null) {
        // A caster pass draw is a draw (§84) — the GL pass's counter
        // argument, verbatim.
        countDraw(statistics, geometry.topology, geometry.count, 1);
      }
      block += 1;
    }
    pass.end();
    return { record, block };
  }

  /**
   * Packs §59's two extra vec4s — the emissive term, then metalness and
   * roughness — into the spare bytes of `block`'s stride, after the
   * 192-byte `DrawUniforms` `#writeBlock` wrote (`wgpu-standard.ts`'s
   * layout). The unused slots are written, not assumed: the staging array is
   * reused across frames, and an uploaded byte nobody wrote this frame is a
   * transcript that depends on history.
   */
  #writeSurface(block: number, material: StandardMaterialLike): void {
    const staging = this.#uniformStaging;
    const base = block * UNIFORM_STRIDE_FLOATS;
    const emissiveBase = base + STANDARD_EMISSIVE_OFFSET / 4;
    const emissive = material.emissive;
    staging[emissiveBase] = emissive[0];
    staging[emissiveBase + 1] = emissive[1];
    staging[emissiveBase + 2] = emissive[2];
    staging[emissiveBase + 3] = 0;
    const surfaceBase = base + STANDARD_SURFACE_OFFSET / 4;
    staging[surfaceBase] = material.metalness;
    staging[surfaceBase + 1] = material.roughness;
    staging[surfaceBase + 2] = 0;
    staging[surfaceBase + 3] = 0;
  }

  /**
   * Grows the lights buffer, its staging array and its bind group to hold at
   * least `blocks` per-view blocks (WP-R1.5). `#growUniforms`' contract one
   * buffer over: never shrinks, doubles, and everything it creates is created
   * lazily — an application that never shades never reaches this method, so
   * never allocates a lights layout, buffer or group at all.
   */
  #growLights(device: GpuDevice, blocks: number): void {
    if (blocks <= this.#lightsCapacity) {
      return;
    }
    const capacity = Math.max(blocks, this.#lightsCapacity * 2, 4);
    this.#lightsBuffer?.destroy();
    const buffer = device.createBuffer({
      label: "fourJS:lights",
      size: capacity * LIGHT_UNIFORM_STRIDE_BYTES,
      usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
    });
    this.#lightsBuffer = buffer;
    this.#lightsStaging = new Float32Array(
      capacity * LIGHT_UNIFORM_STRIDE_FLOATS,
    );
    this.#lightsCapacity = capacity;
    this.#lightsBindGroup = device.createBindGroup({
      label: "fourJS:lights",
      layout: this.#acquireLightsLayout(device),
      entries: [
        {
          binding: 0,
          resource: { buffer, offset: 0, size: LIGHT_BINDING_BYTES },
        },
      ],
    });
    // §69's group pointed at the destroyed buffer (WP-R1.7) — dropped here
    // and recreated by the next receiving draw, the sprite group's rule.
    this.#shadowBindGroup = null;
    this.#shadowBindGroupView = null;
  }

  /** Packs one `DrawUniforms` block into the staging array at `block`'s stride. */
  #writeBlock(
    block: number,
    viewProjection: Matrix4,
    model: Matrix4 | null,
    red: number,
    green: number,
    blue: number,
    alpha: number,
  ): void {
    const staging = this.#uniformStaging;
    const base = block * UNIFORM_STRIDE_FLOATS;
    const viewBase = base + DRAW_VIEW_PROJECTION_OFFSET / 4;
    const modelBase = base + DRAW_MODEL_OFFSET / 4;
    const colorBase = base + DRAW_COLOR_OFFSET / 4;
    for (let index = 0; index < 16; index += 1) {
      // `Matrix4.elements` is a `Float64Array`; the uniform block is `f32`, so
      // the narrowing happens here, element by element, rather than through an
      // intermediate allocation per draw.
      staging[viewBase + index] = viewProjection.elements[index];
      staging[modelBase + index] =
        model === null ? (index % 5 === 0 ? 1 : 0) : model.elements[index];
    }
    staging[colorBase] = red;
    staging[colorBase + 1] = green;
    staging[colorBase + 2] = blue;
    staging[colorBase + 3] = alpha;
    // Inverse-transpose of the model's upper 3×3, packed as a WGSL uniform
    // `mat3x3` (three columns padded to vec4). Identity when the mat4 upload
    // was identity (`model === null`) or when the upper 3×3 is singular.
    normalMatrixScratch.identity();
    if (model !== null) {
      normalMatrixScratch.setNormalFromMatrix4(model);
    }
    const n = normalMatrixScratch.elements;
    const normalBase = base + DRAW_NORMAL_OFFSET / 4;
    for (let column = 0; column < 3; column += 1) {
      const dst = normalBase + column * 4;
      const src = column * 3;
      staging[dst] = n[src];
      staging[dst + 1] = n[src + 1];
      staging[dst + 2] = n[src + 2];
      staging[dst + 3] = 0;
    }
  }

  /**
   * Grows the uniform buffer, its staging array and the bind group to hold at
   * least `blocks` blocks. Never shrinks: a frame that drew ten thousand
   * objects once is likely to again, and shrinking would trade a steady state
   * for an allocation.
   */
  #growUniforms(
    device: GpuDevice,
    layout: GpuBindGroupLayout,
    blocks: number,
  ): void {
    if (blocks <= this.#uniformCapacity) {
      return;
    }
    // Doubling, so a frame that grows by one item does not reallocate.
    const capacity = Math.max(blocks, this.#uniformCapacity * 2, 16);
    this.#uniformBuffer?.destroy();
    const buffer = device.createBuffer({
      label: "fourJS:draw-uniforms",
      size: capacity * UNIFORM_STRIDE_BYTES,
      usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
    });
    this.#uniformBuffer = buffer;
    this.#uniformStaging = new Float32Array(capacity * UNIFORM_STRIDE_FLOATS);
    this.#uniformCapacity = capacity;
    this.#bindGroup = device.createBindGroup({
      label: "fourJS:draw-uniforms",
      layout,
      entries: [
        {
          binding: 0,
          resource: { buffer, offset: 0, size: DRAW_UNIFORM_BYTES },
        },
      ],
    });
    // The sprite, standard and particle bind groups pointed at the destroyed
    // buffer; dropped here and recreated lazily by the next draw of each
    // kind, so a scene whose sprites (or standard surfaces, or particle
    // systems) are gone stops paying for one. Growth happens before the pass
    // is recorded, so no recorded draw can be holding a dropped group.
    this.#spriteBindGroup = null;
    this.#standardBindGroup = null;
    this.#particleBindGroup = null;
  }

  /**
   * Allocates (or reuses) the depth attachment for the current surface size
   * and the frame's format — `depth24plus`, upgraded to carry §67's stencil
   * planes for a frame that clips (see `DEPTH_STENCIL_FORMAT`). A scene that
   * starts or stops clipping reallocates once, like a resize.
   */
  #acquireDepth(
    device: GpuDevice,
    width: number,
    height: number,
    format: string,
  ): GpuTextureView {
    if (
      this.#depthTexture === null ||
      this.#depthWidth !== width ||
      this.#depthHeight !== height ||
      this.#depthFormat !== format
    ) {
      this.#depthTexture?.destroy?.();
      this.#depthTexture = device.createTexture({
        label: "fourJS:depth",
        size: [width, height],
        format,
        usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
      });
      this.#depthWidth = width;
      this.#depthHeight = height;
      this.#depthFormat = format;
    }
    return this.#depthTexture.createView();
  }

  /**
   * Subscribes to §61's device loss.
   *
   * The handler is attached once, at initialization, and survives `dispose` by
   * checking the disposed flag: a device destroyed by `dispose()` resolves
   * `lost` with `reason: "destroyed"`, and that is teardown, not a loss event —
   * emitting `contextlost` from it would tell an application its device
   * vanished when the application is the one that let it go.
   */
  #watchDeviceLoss(device: GpuDevice): void {
    const lost = device.lost;
    if (lost === undefined) {
      return;
    }
    void lost.then((info) => {
      if (this.#disposed || info.reason === "destroyed") {
        return;
      }
      this.#deviceLost = true;
      this.#geometries?.forget();
      this.#textures?.forget();
      this.#renderTargets?.forget();
      // §36's instance buffers (WP-R1.8): same terms — the allocations died
      // with the device.
      this.#particles?.forget();
      // §65's uploader (R-9): its buffers died with the device, like every
      // other handle — dropped, never destroyed.
      this.batching?.forget();
      this.#gpuTimer?.forget();
      this.#pipelines?.dispose();
      // §82's compute caches (WP-R1.8): pipelines and layouts of a dead
      // device — dropped whole; the next compute() call reports the loss.
      this.#compute?.dispose();
      this.#compute = null;
      // §36 GPU particle simulations (R-31 wiring): their residency died
      // with the device and there is no WebGPU restore, so the joins drop —
      // a GPU-simulated system's state does not survive device loss (the
      // §34 posture; `@fourjs/particles`' types.ts owns it). The application
      // still owes each simulation's `dispose()`, now a defined no-op
      // device-side.
      this.#particleSimulations.clear();
      // §60's node store (WP-R1.9): its modules, pipelines and buffers died
      // with the device — dropped, never destroyed.
      this.#nodePipelines?.forget();
      this.#nodePipelines = null;
      this.#skinnedPrograms?.forget();
      this.#skinnedPrograms = null;
      this.#skinnedProgramsFailed = false;
      // The frame-level handles too: `render` already returns while lost,
      // but a handle that outlives its device is the kind of thing a future
      // restore path would trip over (2026-09-11 stability audit).
      this.#bindGroupLayout = null;
      this.#uniformBuffer = null;
      this.#bindGroup = null;
      this.#depthTexture = null;
      this.#spriteLayout = null;
      this.#spriteBindGroup = null;
      this.#particleLayout = null;
      this.#particleBindGroup = null;
      // §68's block, like every allocation above: the handles died with the
      // device — dropped, never destroyed.
      this.#standardLayout = null;
      this.#standardBindGroup = null;
      this.#lightsLayout = null;
      this.#lightsBuffer = null;
      this.#lightsBindGroup = null;
      this.#lightsCapacity = 0;
      // §70's grade block (WP-R1.6): same terms.
      this.#effectLayout = null;
      this.#effectBuffer = null;
      this.#effectBindGroup = null;
      // §69's layout, sampler and group (WP-R1.7): same terms — the target
      // object itself survives (it is engine-side, and `render` returns
      // quietly while lost anyway).
      this.#shadowLightsLayout = null;
      this.#shadowSampler = null;
      this.#shadowBindGroup = null;
      this.#shadowBindGroupView = null;
      this.events.emit("contextlost", { renderer: this });
    });
  }

  #assertUsable(method: string): void {
    if (this.#disposed) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        `WebgpuRenderer.${method}() was called on a disposed renderer; ` +
          "disposal is terminal (§83).",
        { context: { method, disposed: true } },
      );
    }
  }
}
