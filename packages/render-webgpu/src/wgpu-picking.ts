/**
 * The WebGPU picking service (§71, §62; RFC 0005) — the id-buffer pass and
 * its asynchronous `mapAsync` read-back, reached only through
 * {@link registerPickingPipeline}.
 *
 * ## What one pass draws
 *
 * `@fourjs/render`'s `PickingService` contract, executed: the service owns an
 * offscreen `RenderTarget` sized to the drawing buffer, builds the **same
 * render list the frame builds** (`buildRenderList` → `buildViewRenderList`
 * with the view's own frustum, never interpolated), and draws every item
 * through one flat id pipeline whose colour is the candidate's table index
 * + 1 (`encodePickId`). The table is traversal-ordered and rebuilt per pass
 * (`collectPickCandidates`); a sorted item joins back to its table index
 * through its `worldMatrix` **object**.
 *
 * Per-item state is deliberately thinner than the WebGL twin, because WebGPU
 * bakes depth, blend, and stencil into pipeline identity. This packet keeps
 * **one** id pipeline (triangle-list, depth test/write on, blending ignored)
 * and reuses it:
 *
 * - **blending is ignored** — a transparent surface writes its id over its
 *   full geometry; per-texel alpha accuracy is §71's `"pixel"` strategy;
 * - **§67 clip stencils are not applied** — stencil is pipeline identity
 *   here, and a combinatorial id-pipeline cache is the cost this packet
 *   refuses. Mask-only draws (`clip.maskPass`) are still skipped, so a
 *   clip node does not pick as a solid quad. Clipped *content* still
 *   writes an id (scrolled-away list rows can pick — an honest reduction
 *   versus WebGL, which tests the mask bit plane);
 * - **skinned items draw through a private skinned id pipeline** — the
 *   §54 deformed silhouette (`skinMatrix()` over a 3072-byte palette
 *   group, never bind pose). Compiled lazily on the first skinned item;
 *   compile failure skips, bounds still serve. Lives here, not in
 *   `wgpu-skinning.ts`: {@link registerPickingPipeline} is what links
 *   this module, and importing the colour-pair module would pull two
 *   unused pipelines into every picking bundle. Not a `SkinnedIdProgram`
 *   class: WebGL already exports that name (`graph:duplicates`);
 * - **particle items write one id for the whole system** — §36's batched
 *   item has one node and no per-particle geometry, so the pass instances
 *   the shared unit quad through a private particle id pipeline (the §36
 *   billboard vertex, a flat `pickId` fragment) and encodes the emitter's
 *   table index. Trails are not drawn. GPU-sim (`simulation: "gpu"`) and
 *   the R-32 wide instance stream need a second vertex layout and stay
 *   skipped. The bounds tier still serves a zero-count system, which
 *   issues no instanced draw;
 * - **sprites draw** — they share the unlit-shaped position layout (the
 *   unit quad); the id vertex stage is that same `viewProjection * model *
 *   vec4(position, 1)` expression, uv derivation aside.
 *
 * ## Uniforms: a dedicated id block, not `DrawUniforms`
 *
 * The 192-byte shaded `DrawUniforms` block is the wrong size and the wrong
 * members for a flat id. Group 0 is a 144-byte `IdUniforms` `{ viewProjection,
 * model, pickId }` packed at {@link UNIFORM_STRIDE_BYTES} with a dynamic
 * offset so one `writeBuffer` and one bind group serve N draws in one pass.
 * Dynamic offset is not conceptually required (a bind group per item would
 * also work); one group is cheaper.
 *
 * The vertex stage remaps clip depth the unlit shader does (`(z + w) * 0.5`)
 * so the id picture rasterises the same fragments the frame does against
 * `@fourjs/math`'s WebGL-convention projections.
 *
 * ## The read-back is `mapAsync`, honestly (§61; RFC 0005 §4)
 *
 * `pick` reads **one texel** through {@link readTexturePixels}'s region form
 * (`copyTextureToBuffer` + `mapAsync`, §7a bottom-origin → WebGPU top-first).
 * There is no synchronous path on this backend.
 *
 * ## Cost discipline (pipeline-cost law, R-6)
 *
 * Nothing here is reachable from `WebgpuRenderer` — it resolves the registry
 * slot (`wgpu-picking-registry.ts`) and this module links only when the
 * application calls {@link registerPickingPipeline}. The id pipeline compiles
 * lazily on the first pass, never at registration or creation.
 */

import { DEV, FourError, devWarnOnce } from "@fourjs/core";
import { Frustum, Matrix4, Rectangle2 } from "@fourjs/math";
import {
  MAX_SKINNING_JOINTS,
  PARTICLE_INSTANCE_FLOATS,
  RenderTarget,
  assertEncodableCandidateCount,
  buildRenderList,
  buildViewRenderList,
  collectPickCandidates,
  decodePickId,
  encodePickId,
  type ParticleRenderItem,
  type PickRequest,
  type PickResult,
  type PickingService,
  type RenderItem,
} from "@fourjs/render";

import {
  GPU_BUFFER_USAGE,
  GPU_SHADER_STAGE,
  UNIFORM_STRIDE_BYTES,
  type GpuBindGroup,
  type GpuBindGroupLayout,
  type GpuBuffer,
  type GpuDevice,
  type GpuRenderPipeline,
  type GpuTextureView,
  type GpuVertexBufferLayout,
} from "./webgpu-device.js";
import type { WgpuGeometryCache, WgpuGeometryRecord } from "./wgpu-geometry.js";
import {
  PARTICLE_VERTEX_BUFFER_LAYOUTS,
  type WgpuParticleCache,
  type WgpuParticleRecord,
} from "./wgpu-particles.js";
import {
  setPickingServiceFactory,
  type PickingRendererHost,
} from "./wgpu-picking-registry.js";
import { readTexturePixels } from "./wgpu-readback.js";
import {
  RENDER_TARGET_COLOR_FORMAT,
  RENDER_TARGET_DEPTH_FORMAT,
  type WgpuRenderTargetRecord,
} from "./wgpu-render-target.js";
import {
  FRAGMENT_ENTRY_POINT,
  POSITION_BUFFER_LAYOUT,
  VERTEX_ENTRY_POINT,
} from "./wgpu-unlit.js";

/**
 * The subtree root an update draws and the viewport it draws it into — read
 * off the `PickingService` interface rather than imported from `@fourjs/scene`:
 * this package depends on `core`, `math`, and `render` only (plan §3.1,
 * frozen).
 */
type PickRoot = Parameters<PickingService["update"]>[0];

/** One viewport, derived as {@link PickRoot} is. */
type PickView = Parameters<PickingService["update"]>[1];

/** Byte offset of `IdUniforms.viewProjection`. */
export const ID_VIEW_PROJECTION_OFFSET = 0;

/** Byte offset of `IdUniforms.model`. */
export const ID_MODEL_OFFSET = 64;

/** Byte offset of `IdUniforms.pickId`. */
export const ID_PICK_OFFSET = 128;

/**
 * Size of the `IdUniforms` block in bytes — viewProjection + model + pickId.
 * Not the 256-byte stride: this is `minBindingSize`.
 */
export const ID_UNIFORM_BYTES = 144;

/** Byte offset of `ParticleIdUniforms.projection`. */
export const PARTICLE_ID_PROJECTION_OFFSET = 0;

/** Byte offset of `ParticleIdUniforms.view`. */
export const PARTICLE_ID_VIEW_OFFSET = 64;

/** Byte offset of `ParticleIdUniforms.model`. */
export const PARTICLE_ID_MODEL_OFFSET = 128;

/** Byte offset of `ParticleIdUniforms.pickId`. */
export const PARTICLE_ID_PICK_OFFSET = 192;

/**
 * Size of the `ParticleIdUniforms` block in bytes — three `mat4x4<f32>` plus
 * `pickId`. Distinct from the shaded particle block's `PARTICLE_UNIFORM_BYTES`
 * (192, no pickId) so `graph:duplicates` does not collapse them. Fits in
 * {@link UNIFORM_STRIDE_BYTES}.
 */
export const PARTICLE_ID_UNIFORM_BYTES = 208;

/**
 * Size of the skinned-id palette block in bytes — `MAX_SKINNING_JOINTS` ×
 * a std140 `mat4` (64 bytes). Already a multiple of the 256-byte dynamic
 * offset alignment, so the slot *is* the stride. Named apart from the
 * colour pair's `JOINT_PALETTE_BYTES` (`graph:duplicates`).
 */
export const SKINNED_ID_PALETTE_BYTES = MAX_SKINNING_JOINTS * 64;

/** {@link SKINNED_ID_PALETTE_BYTES} in `Float32Array` elements. */
const SKINNED_ID_PALETTE_FLOATS = SKINNED_ID_PALETTE_BYTES / 4;

/** `UNIFORM_STRIDE_BYTES` in `Float32Array` elements. */
const UNIFORM_STRIDE_FLOATS = UNIFORM_STRIDE_BYTES / 4;

/** All four colour channels writable (`GPUColorWrite.ALL`). */
const COLOR_WRITE_ALL = 0xf;

/**
 * The id pass's WGSL — unlit `gl_Position` (with this backend's clip-depth
 * remap) and a flat `pickId` fragment. One module, compiled lazily.
 */
export const ID_SHADER_SOURCE = `struct IdUniforms {
  viewProjection : mat4x4<f32>,
  model : mat4x4<f32>,
  pickId : vec4<f32>,
};

@group(0) @binding(0) var<uniform> id : IdUniforms;

@vertex
fn ${VERTEX_ENTRY_POINT}(@location(0) position : vec3<f32>) -> @builtin(position) vec4<f32> {
  let clip = id.viewProjection * id.model * vec4<f32>(position, 1.0);
  // WebGL clip depth [-w, w] onto WebGPU's [0, w]; see wgpu-unlit.ts.
  return vec4<f32>(clip.x, clip.y, (clip.z + clip.w) * 0.5, clip.w);
}

@fragment
fn ${FRAGMENT_ENTRY_POINT}() -> @location(0) vec4<f32> {
  return id.pickId;
}
`;

/**
 * The particle id pass's WGSL — the §36 billboard vertex
 * (`PARTICLE_SHADER_SOURCE`: view·model, then view-space corner offset,
 * then projection, then the unlit clip-depth remap) with a flat `pickId`
 * fragment. Compiled lazily on the service's **first particle item**, never
 * at registration or construction. Kept private on the service (WebGL
 * already exports `ParticleIdProgram`; this name must not collide).
 */
export const PARTICLE_ID_SHADER_SOURCE = `struct ParticleIdUniforms {
  projection : mat4x4<f32>,
  view : mat4x4<f32>,
  model : mat4x4<f32>,
  pickId : vec4<f32>,
};

@group(0) @binding(0) var<uniform> id : ParticleIdUniforms;

@vertex
fn ${VERTEX_ENTRY_POINT}(
  @location(0) corner : vec3<f32>,
  @location(1) instancePosition : vec3<f32>,
  @location(2) instanceSize : f32,
  @location(3) instanceColor : vec4<f32>,
) -> @builtin(position) vec4<f32> {
  var center = id.view * id.model * vec4<f32>(instancePosition, 1.0);
  center.x = center.x + corner.x * instanceSize;
  center.y = center.y + corner.y * instanceSize;
  let clip = id.projection * center;
  // WebGL clip depth [-w, w] onto WebGPU's [0, w]; see wgpu-unlit.ts.
  return vec4<f32>(clip.x, clip.y, (clip.z + clip.w) * 0.5, clip.w);
}

@fragment
fn ${FRAGMENT_ENTRY_POINT}() -> @location(0) vec4<f32> {
  return id.pickId;
}
`;

/**
 * The skinned id pass's WGSL — {@link ID_SHADER_SOURCE}'s product with
 * `skinMatrix()` spliced into the vertex stage and a 3072-byte palette at
 * group 1. Joints `@location(4)` `uint16x4`, weights `@location(5)`
 * `float32x4`; LBS, weights not renormalised — the colour pair's contract,
 * restated so this module never imports `wgpu-skinning.ts`. Compiled lazily
 * on the first skinned item. Kept private on the service (WebGL already
 * exports `SkinnedIdProgram`).
 */
export const SKINNED_ID_SHADER_SOURCE = `struct IdUniforms {
  viewProjection : mat4x4<f32>,
  model : mat4x4<f32>,
  pickId : vec4<f32>,
};

struct JointPalette {
  jointMatrices : array<mat4x4<f32>, ${String(MAX_SKINNING_JOINTS)}>,
};

@group(0) @binding(0) var<uniform> id : IdUniforms;
@group(1) @binding(0) var<uniform> palette : JointPalette;

fn skinMatrix(joints : vec4<u32>, weights : vec4<f32>) -> mat4x4<f32> {
  return weights.x * palette.jointMatrices[joints.x]
       + weights.y * palette.jointMatrices[joints.y]
       + weights.z * palette.jointMatrices[joints.z]
       + weights.w * palette.jointMatrices[joints.w];
}

@vertex
fn ${VERTEX_ENTRY_POINT}(
  @location(0) position : vec3<f32>,
  @location(4) joints : vec4<u32>,
  @location(5) weights : vec4<f32>,
) -> @builtin(position) vec4<f32> {
  let clip = id.viewProjection * id.model * (skinMatrix(joints, weights) * vec4<f32>(position, 1.0));
  // WebGL clip depth [-w, w] onto WebGPU's [0, w]; see wgpu-unlit.ts.
  return vec4<f32>(clip.x, clip.y, (clip.z + clip.w) * 0.5, clip.w);
}

@fragment
fn ${FRAGMENT_ENTRY_POINT}() -> @location(0) vec4<f32> {
  return id.pickId;
}
`;

/** Vertex layout for the joint stream: one tightly packed `uint16x4`. */
const SKINNED_ID_JOINTS_LAYOUT: GpuVertexBufferLayout = Object.freeze({
  arrayStride: 8,
  stepMode: "vertex",
  attributes: Object.freeze([
    Object.freeze({
      format: "uint16x4",
      offset: 0,
      shaderLocation: 4,
    }),
  ]),
});

/** Vertex layout for the weight stream: one tightly packed `vec4<f32>`. */
const SKINNED_ID_WEIGHTS_LAYOUT: GpuVertexBufferLayout = Object.freeze({
  arrayStride: 16,
  stepMode: "vertex",
  attributes: Object.freeze([
    Object.freeze({
      format: "float32x4",
      offset: 0,
      shaderLocation: 5,
    }),
  ]),
});

/** One pass's resolved viewport rectangle, in target pixels (§7a, bottom-left). */
interface PassRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One item the pass will actually draw. */
interface PackedDraw {
  readonly geometry: WgpuGeometryRecord;
  readonly model: Matrix4;
  readonly tableIndex: number;
  /**
   * The skeleton's palette when this is a skinned silhouette; `null` for
   * an ordinary mesh. The id uniforms stay the 144-byte block either way
   * — the palette is a second bind group, the colour pair's shape.
   */
  readonly palette: Float32Array | null;
}

/** One §36 emitter the particle id arm will instance. */
interface PackedParticleDraw {
  readonly geometry: WgpuGeometryRecord;
  readonly batch: WgpuParticleRecord;
  readonly item: ParticleRenderItem;
  readonly model: Matrix4;
  readonly tableIndex: number;
}

/** What one successful {@link WebgpuPickingService.update} leaves behind. */
interface PassState {
  /** The `Viewport` object the pass drew — `pick` refuses any other (§85). */
  readonly viewport: PickView;
  /** The resolved rectangle NDC maps into (§7a). */
  readonly rect: PassRect;
  /** The colour texture the ids were drawn into. */
  readonly record: WgpuRenderTargetRecord;
  /** This pass's update ordinal — `PickResult.frame`. */
  readonly frame: number;
  /**
   * The device and geometry cache the pass drew with — the **era witness**:
   * a §61 loss drops every handle, so `pick` compares these against the
   * host's current objects and refuses (`DEVICE_LOST` — the backend's one loss code, 2026-09-11) on mismatch rather
   * than reading a texture that no longer exists.
   */
  readonly era: WgpuGeometryCache;
  readonly device: GpuDevice;
}

/** Scratch shared by every service — consumed within one call (plan D7). */
const passItems: RenderItem[] = [];
const passViewItems: RenderItem[] = [];
const packedDraws: PackedDraw[] = [];
const packedParticleDraws: PackedParticleDraw[] = [];
const passViewProjection = new Matrix4();
const passProjection = new Matrix4();
const passView = new Matrix4();
const passFrustum = new Frustum();
const idScratch = new Float32Array(4);
const rectScratch: PassRect = { x: 0, y: 0, width: 0, height: 0 };
const pickRegion = new Rectangle2();

/** The lifecycle refusal code `NullRenderer` and `Application` use (§83, §89). */
const LIFECYCLE_ERROR_CODE = "INVALID_APPLICATION_STATE";

/** §48's rectangle resolution — `webgpu-renderer.ts`'s `resolveRect`, restated. */
function resolvePassRect(
  view: PickView,
  surfaceWidth: number,
  surfaceHeight: number,
): PassRect {
  const scaleX = view.normalized === true ? surfaceWidth : 1;
  const scaleY = view.normalized === true ? surfaceHeight : 1;
  rectScratch.x = Math.round(view.x * scaleX);
  rectScratch.y = Math.round(view.y * scaleY);
  rectScratch.width = Math.max(0, Math.round(view.width * scaleX));
  rectScratch.height = Math.max(0, Math.round(view.height * scaleY));
  return rectScratch;
}

/**
 * `@fourjs/render`'s `PickingService`, executed on the WebGPU backend — see
 * the module header for the pass, the interface for the contract. Built by
 * `WebgpuRenderer.createPickingService()` once {@link registerPickingPipeline}
 * has run; one service per call, each with its own id buffer.
 */
export class WebgpuPickingService implements PickingService {
  readonly #host: PickingRendererHost;

  /** The offscreen id buffer; created on the first pass, resized with the surface. */
  #target: RenderTarget | null = null;

  #pipeline: GpuRenderPipeline | null = null;

  #bindGroupLayout: GpuBindGroupLayout | null = null;

  #uniformBuffer: GpuBuffer | null = null;

  #bindGroup: GpuBindGroup | null = null;

  #uniformStaging = new Float32Array(0);

  #uniformCapacity = 0;

  /**
   * The instanced particle id pipeline — compiled on the first particle
   * item of an era, never at construction. `null` until then.
   */
  #particlePipeline: GpuRenderPipeline | null = null;

  #particleBindGroupLayout: GpuBindGroupLayout | null = null;

  #particleUniformBuffer: GpuBuffer | null = null;

  #particleBindGroup: GpuBindGroup | null = null;

  #particleUniformStaging = new Float32Array(0);

  #particleUniformCapacity = 0;

  /**
   * The skinned id pipeline — compiled on the first skinned item of an
   * era, never at construction. `null` until then.
   */
  #skinnedPipeline: GpuRenderPipeline | null = null;

  #skinnedPaletteLayout: GpuBindGroupLayout | null = null;

  #skinnedPaletteBuffer: GpuBuffer | null = null;

  #skinnedPaletteBindGroup: GpuBindGroup | null = null;

  #skinnedPaletteStaging = new Float32Array(0);

  #skinnedPaletteCapacity = 0;

  /** Latched per era — a driver that refused last era is asked once more. */
  #pipelineFailed = false;

  /** Latched per era, same discipline as `#pipelineFailed`. */
  #particlePipelineFailed = false;

  /** Latched per era, same discipline as `#pipelineFailed`. */
  #skinnedPipelineFailed = false;

  /** The cache era `#pipeline` was compiled in. */
  #pipelineEra: WgpuGeometryCache | null = null;

  /** The last successful pass, or `null` — what `pick` reads. */
  #pass: PassState | null = null;

  /** The §33 candidate table: texel value `i + 1` resolves to `ids[i]`. */
  readonly #ids: string[] = [];

  /** Traversal-order join key — see `collectPickCandidates`. */
  readonly #indexByMatrix = new Map<Matrix4, number>();

  #updateCount = 0;

  #disposed = false;

  constructor(host: PickingRendererHost) {
    this.#host = host;
  }

  /** Whether {@link WebgpuPickingService.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  update(root: PickRoot, view: PickView): void {
    if (this.#disposed) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "PickingService.update() was called on a disposed service; " +
          "disposal is terminal (§83).",
        { context: { method: "update", disposed: true } },
      );
    }

    const host = this.#host;
    const surfaceWidth = host.surfaceWidth();
    const surfaceHeight = host.surfaceHeight();
    if (!(surfaceWidth >= 1 && surfaceHeight >= 1)) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "§71: the renderer's drawing surface has zero size — call " +
          "Renderer.resize() before the first picking pass (§85).",
        { context: { surfaceWidth, surfaceHeight } },
      );
    }
    const rect = resolvePassRect(view, surfaceWidth, surfaceHeight);
    if (!(rect.width > 0 && rect.height > 0)) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        `§71: viewport "${view.id}" resolves to a zero-area rectangle; ` +
          "there is no pixel to pick against (§85, RFC 0005).",
        {
          context: {
            viewport: view.id,
            width: rect.width,
            height: rect.height,
          },
        },
      );
    }

    collectPickCandidates(root, this.#ids, this.#indexByMatrix);
    assertEncodableCandidateCount(this.#ids.length);

    const device = host.device();
    const geometries = host.geometries();
    const renderTargets = host.renderTargets();
    if (
      device === null ||
      geometries === null ||
      renderTargets === null ||
      host.deviceLost()
    ) {
      this.#pass = null;
      return;
    }

    const compiled = this.#acquirePipeline(device, geometries);
    if (compiled === null) {
      this.#pass = null;
      return;
    }

    const items = buildRenderList(root, passItems);

    let target = this.#target;
    if (target === null) {
      target = new RenderTarget({
        width: surfaceWidth,
        height: surfaceHeight,
      });
      this.#target = target;
    } else if (
      target.width !== surfaceWidth ||
      target.height !== surfaceHeight
    ) {
      target.resize(surfaceWidth, surfaceHeight);
    }
    const record = renderTargets.acquire(target);
    if (record === null || record.depthView === null) {
      this.#pass = null;
      return;
    }
    const depthView = record.depthView;

    const camera = view.camera;
    camera.updateViewMatrix();
    passViewProjection
      .copy(camera.projectionMatrix)
      .multiply(camera.viewMatrix);
    passProjection.copy(camera.projectionMatrix);
    passView.copy(camera.viewMatrix);
    passFrustum.setFromViewProjection(passViewProjection);
    const viewItems = buildViewRenderList(items, view, passViewItems, {
      frustum: passFrustum,
    });

    this.#updateCount += 1;
    this.#pass = null;

    packedDraws.length = 0;
    packedParticleDraws.length = 0;
    const particleCache = host.particles();
    for (let index = 0; index < viewItems.length; index += 1) {
      const item = viewItems[index];
      const maskPass = item.clip?.maskPass === true;
      if (maskPass) {
        continue;
      }
      const joined = this.#indexByMatrix.get(item.worldMatrix);
      if (joined === undefined) {
        continue;
      }
      if (item.kind === "particles") {
        if (item.count === 0) {
          continue;
        }
        // Default 8-float CPU stream only (v1). The R-32 wide stream and
        // GPU-sim (`PARTICLE_GPU_VERTEX_BUFFER_LAYOUTS`) need a second
        // pipeline; skip rather than bind the wrong vertex layout.
        if (
          item.instanceFloats !== undefined &&
          item.instanceFloats !== PARTICLE_INSTANCE_FLOATS
        ) {
          continue;
        }
        if (particleCache === null) {
          continue;
        }
        const geometry = geometries.acquire(item.geometry);
        if (geometry === null) {
          continue;
        }
        const batch = particleCache.acquire(item);
        if (batch === null) {
          continue;
        }
        const particleCompiled = this.#acquireParticlePipeline(
          device,
          geometries,
        );
        if (particleCompiled === null) {
          continue;
        }
        packedParticleDraws.push({
          geometry,
          batch,
          item,
          model: item.worldMatrix,
          tableIndex: joined,
        });
        continue;
      }
      const isSkinned =
        item.kind === "skinned-unlit" || item.kind === "skinned-lit";
      if (isSkinned) {
        const skinnedCompiled = this.#acquireSkinnedPipeline(
          device,
          geometries,
        );
        if (skinnedCompiled === null) {
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
        packedDraws.push({
          geometry,
          model: item.worldMatrix,
          tableIndex: joined,
          palette: item.jointMatrices,
        });
        continue;
      }
      const geometry = geometries.acquire(item.geometry);
      if (geometry === null) {
        continue;
      }
      packedDraws.push({
        geometry,
        model: item.worldMatrix,
        tableIndex: joined,
        palette: null,
      });
    }

    this.#drawPass(
      device,
      compiled.pipeline,
      compiled.layout,
      record,
      depthView,
      rect,
      packedDraws,
      packedParticleDraws,
      particleCache,
    );

    this.#pass = {
      viewport: view,
      rect: { ...rect },
      record,
      frame: this.#updateCount,
      era: geometries,
      device,
    };
  }

  async pick(request: PickRequest): Promise<PickResult> {
    if (this.#disposed) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "PickingService.pick() was called on a disposed service; disposal " +
          "is terminal (§83).",
        { context: { method: "pick", disposed: true } },
      );
    }
    const pass = this.#pass;
    if (pass === null) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "§71: there is no id buffer to read — update() has not drawn one " +
          "(or its last attempt was skipped, §61); a stale answer would be " +
          "indistinguishable from “nothing there” (§85, RFC 0005).",
        { context: { updated: this.#updateCount > 0 } },
      );
    }
    if (request.viewport !== pass.viewport) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "§71: this pick names a viewport the last update() did not draw — " +
          "the id buffer holds exactly one view's pass (§85, RFC 0005).",
        {
          context: {
            requested: request.viewport.id,
            drawn: pass.viewport.id,
          },
        },
      );
    }
    const ndcX = request.ndcX;
    const ndcY = request.ndcY;
    if (!(ndcX >= -1 && ndcX <= 1 && ndcY >= -1 && ndcY <= 1)) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "§71: pick coordinates must be normalized device coordinates in " +
          "[-1, 1] (§85; refused rather than clamped, RFC 0005).",
        { context: { ndcX, ndcY } },
      );
    }

    const host = this.#host;
    const device = host.device();
    if (host.disposed() || device === null) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "§71: the renderer behind this picking service has been disposed " +
          "(§83).",
        { context: { rendererDisposed: true } },
      );
    }
    if (
      host.deviceLost() ||
      host.geometries() !== pass.era ||
      device !== pass.device
    ) {
      throw new FourError(
        "DEVICE_LOST",
        "§71: the id buffer did not survive a device loss — render and " +
          "update() again, then pick (§61).",
        { context: { deviceLost: host.deviceLost() } },
      );
    }

    const rect = pass.rect;
    const px =
      rect.x +
      Math.min(rect.width - 1, Math.floor(((ndcX + 1) / 2) * rect.width));
    const py =
      rect.y +
      Math.min(rect.height - 1, Math.floor(((ndcY + 1) / 2) * rect.height));

    pickRegion.set(px, py, 1, 1);
    const pixels = await readTexturePixels(
      device,
      pass.record.colorTexture,
      pass.record.width,
      pass.record.height,
      pickRegion,
    );

    if (this.#disposed) {
      throw new FourError(
        LIFECYCLE_ERROR_CODE,
        "§71: the picking service was disposed while a pick was in " +
          "flight (§83).",
        { context: { method: "pick", disposed: true } },
      );
    }
    if (this.#host.deviceLost()) {
      throw new FourError(
        "DEVICE_LOST",
        "§71: the device was lost while a pick was in flight — the " +
          "id buffer is gone (§61).",
        { context: { deviceLost: true } },
      );
    }
    if (pixels === null) {
      throw new FourError(
        "UNSUPPORTED_GPU_FEATURE",
        "§71: this device surface does not implement the readback entry " +
          "points (copyTextureToBuffer / mapAsync); presence is the " +
          "capability (§62).",
        { context: { entryPoint: "mapAsync" } },
      );
    }

    const texel = new Uint8Array(pixels);
    const value = decodePickId(texel);
    const ids = this.#ids;
    const nodeId =
      value === 0 || value > ids.length ? undefined : ids[value - 1];
    return { nodeId, frame: pass.frame };
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    const host = this.#host;
    const live =
      !host.disposed() && !host.deviceLost() && host.geometries() !== null;
    if (live && host.geometries() === this.#pipelineEra) {
      this.#uniformBuffer?.destroy();
      this.#particleUniformBuffer?.destroy();
      this.#skinnedPaletteBuffer?.destroy();
    }
    this.#uniformBuffer = null;
    this.#bindGroup = null;
    this.#pipeline = null;
    this.#bindGroupLayout = null;
    this.#uniformStaging = new Float32Array(0);
    this.#uniformCapacity = 0;
    this.#particleUniformBuffer = null;
    this.#particleBindGroup = null;
    this.#particlePipeline = null;
    this.#particleBindGroupLayout = null;
    this.#particleUniformStaging = new Float32Array(0);
    this.#particleUniformCapacity = 0;
    this.#skinnedPaletteBuffer = null;
    this.#skinnedPaletteBindGroup = null;
    this.#skinnedPipeline = null;
    this.#skinnedPaletteLayout = null;
    this.#skinnedPaletteStaging = new Float32Array(0);
    this.#skinnedPaletteCapacity = 0;
    const target = this.#target;
    if (target !== null) {
      target.dispose();
      const targets = live ? host.renderTargets() : null;
      if (targets !== null) {
        targets.acquire(target);
      }
    }
    this.#target = null;
    this.#pass = null;
    this.#ids.length = 0;
    this.#indexByMatrix.clear();
  }

  /** The compiled id pipeline for this era, or `null`. */
  #acquirePipeline(
    device: GpuDevice,
    era: WgpuGeometryCache,
  ): { pipeline: GpuRenderPipeline; layout: GpuBindGroupLayout } | null {
    if (this.#pipelineEra !== era) {
      this.#pipeline = null;
      this.#bindGroupLayout = null;
      this.#bindGroup = null;
      this.#uniformBuffer = null;
      this.#uniformCapacity = 0;
      this.#pipelineFailed = false;
      this.#particlePipeline = null;
      this.#particleBindGroupLayout = null;
      this.#particleBindGroup = null;
      this.#particleUniformBuffer = null;
      this.#particleUniformCapacity = 0;
      this.#particlePipelineFailed = false;
      this.#skinnedPipeline = null;
      this.#skinnedPaletteLayout = null;
      this.#skinnedPaletteBindGroup = null;
      this.#skinnedPaletteBuffer = null;
      this.#skinnedPaletteCapacity = 0;
      this.#skinnedPipelineFailed = false;
      this.#pipelineEra = era;
    }
    if (this.#pipeline !== null && this.#bindGroupLayout !== null) {
      return { pipeline: this.#pipeline, layout: this.#bindGroupLayout };
    }
    if (this.#pipelineFailed) {
      return null;
    }
    try {
      const bindGroupLayout = device.createBindGroupLayout({
        label: "fourJS:pick-id-uniforms",
        entries: [
          {
            binding: 0,
            visibility: GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT,
            buffer: {
              type: "uniform",
              hasDynamicOffset: true,
              minBindingSize: ID_UNIFORM_BYTES,
            },
          },
        ],
      });
      const pipelineLayout = device.createPipelineLayout({
        label: "fourJS:pick-id-layout",
        bindGroupLayouts: [bindGroupLayout],
      });
      const module = device.createShaderModule({
        label: "fourJS:pick-id",
        code: ID_SHADER_SOURCE,
      });
      const pipeline = device.createRenderPipeline({
        label: "fourJS:pick-id",
        layout: pipelineLayout,
        vertex: {
          module,
          entryPoint: VERTEX_ENTRY_POINT,
          buffers: [POSITION_BUFFER_LAYOUT],
        },
        fragment: {
          module,
          entryPoint: FRAGMENT_ENTRY_POINT,
          targets: [
            {
              format: RENDER_TARGET_COLOR_FORMAT,
              writeMask: COLOR_WRITE_ALL,
            },
          ],
        },
        primitive: {
          topology: "triangle-list",
        },
        depthStencil: {
          format: RENDER_TARGET_DEPTH_FORMAT,
          depthWriteEnabled: true,
          depthCompare: "less",
        },
      });
      this.#bindGroupLayout = bindGroupLayout;
      this.#pipeline = pipeline;
      return { pipeline, layout: bindGroupLayout };
    } catch (error: unknown) {
      this.#pipelineFailed = true;
      if (DEV) {
        devWarnOnce(
          "webgpu-picking-compile-failed",
          "§71: the picking id pipeline failed to compile on this device; " +
            `picking passes are skipped (§61, §89). ${String(error)}`,
        );
      }
      return null;
    }
  }

  /**
   * The compiled particle id pipeline for this era, or `null`. Compiled on
   * the first particle item, never at construction — a scene that registers
   * picking and never submits a particle system issues the mesh id pipeline
   * only. Not a `ParticleIdProgram` class: WebGL already exports that name.
   */
  #acquireParticlePipeline(
    device: GpuDevice,
    era: WgpuGeometryCache,
  ): { pipeline: GpuRenderPipeline; layout: GpuBindGroupLayout } | null {
    if (this.#pipelineEra !== era) {
      this.#particlePipeline = null;
      this.#particleBindGroupLayout = null;
      this.#particleBindGroup = null;
      this.#particleUniformBuffer = null;
      this.#particleUniformCapacity = 0;
      this.#particlePipelineFailed = false;
    }
    if (
      this.#particlePipeline !== null &&
      this.#particleBindGroupLayout !== null
    ) {
      return {
        pipeline: this.#particlePipeline,
        layout: this.#particleBindGroupLayout,
      };
    }
    if (this.#particlePipelineFailed) {
      return null;
    }
    try {
      const bindGroupLayout = device.createBindGroupLayout({
        label: "fourJS:pick-particle-id-uniforms",
        entries: [
          {
            binding: 0,
            visibility: GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT,
            buffer: {
              type: "uniform",
              hasDynamicOffset: true,
              minBindingSize: PARTICLE_ID_UNIFORM_BYTES,
            },
          },
        ],
      });
      const pipelineLayout = device.createPipelineLayout({
        label: "fourJS:pick-particle-id-layout",
        bindGroupLayouts: [bindGroupLayout],
      });
      const module = device.createShaderModule({
        label: "fourJS:pick-particle-id",
        code: PARTICLE_ID_SHADER_SOURCE,
      });
      const pipeline = device.createRenderPipeline({
        label: "fourJS:pick-particle-id",
        layout: pipelineLayout,
        vertex: {
          module,
          entryPoint: VERTEX_ENTRY_POINT,
          buffers: PARTICLE_VERTEX_BUFFER_LAYOUTS,
        },
        fragment: {
          module,
          entryPoint: FRAGMENT_ENTRY_POINT,
          targets: [
            {
              format: RENDER_TARGET_COLOR_FORMAT,
              writeMask: COLOR_WRITE_ALL,
            },
          ],
        },
        primitive: {
          topology: "triangle-list",
        },
        depthStencil: {
          format: RENDER_TARGET_DEPTH_FORMAT,
          depthWriteEnabled: true,
          depthCompare: "less",
        },
      });
      this.#particleBindGroupLayout = bindGroupLayout;
      this.#particlePipeline = pipeline;
      return { pipeline, layout: bindGroupLayout };
    } catch (error: unknown) {
      this.#particlePipelineFailed = true;
      if (DEV) {
        devWarnOnce(
          "webgpu-picking-particle-compile-failed",
          "§71: the particle picking id pipeline failed to compile on this " +
            "device; particle id draws are skipped (§61, §89). " +
            `${String(error)}`,
        );
      }
      return null;
    }
  }

  /**
   * The compiled skinned id pipeline for this era, or `null`. Compiled on
   * the first skinned item, never at construction — a scene that registers
   * picking and never submits a skinned mesh issues the mesh id pipeline
   * only, and never links `wgpu-skinning.ts`. Not a `SkinnedIdProgram`
   * class: WebGL already exports that name.
   */
  #acquireSkinnedPipeline(
    device: GpuDevice,
    era: WgpuGeometryCache,
  ): { pipeline: GpuRenderPipeline; layout: GpuBindGroupLayout } | null {
    if (this.#pipelineEra !== era) {
      this.#skinnedPipeline = null;
      this.#skinnedPaletteLayout = null;
      this.#skinnedPaletteBindGroup = null;
      this.#skinnedPaletteBuffer = null;
      this.#skinnedPaletteCapacity = 0;
      this.#skinnedPipelineFailed = false;
    }
    if (
      this.#skinnedPipeline !== null &&
      this.#skinnedPaletteLayout !== null &&
      this.#bindGroupLayout !== null
    ) {
      return {
        pipeline: this.#skinnedPipeline,
        layout: this.#skinnedPaletteLayout,
      };
    }
    if (this.#skinnedPipelineFailed || this.#bindGroupLayout === null) {
      return null;
    }
    try {
      const paletteLayout = device.createBindGroupLayout({
        label: "fourJS:pick-skinned-id-palette",
        entries: [
          {
            binding: 0,
            visibility: GPU_SHADER_STAGE.VERTEX,
            buffer: {
              type: "uniform",
              hasDynamicOffset: true,
              minBindingSize: SKINNED_ID_PALETTE_BYTES,
            },
          },
        ],
      });
      const pipelineLayout = device.createPipelineLayout({
        label: "fourJS:pick-skinned-id-layout",
        bindGroupLayouts: [this.#bindGroupLayout, paletteLayout],
      });
      const module = device.createShaderModule({
        label: "fourJS:pick-skinned-id",
        code: SKINNED_ID_SHADER_SOURCE,
      });
      const pipeline = device.createRenderPipeline({
        label: "fourJS:pick-skinned-id",
        layout: pipelineLayout,
        vertex: {
          module,
          entryPoint: VERTEX_ENTRY_POINT,
          buffers: [
            POSITION_BUFFER_LAYOUT,
            SKINNED_ID_JOINTS_LAYOUT,
            SKINNED_ID_WEIGHTS_LAYOUT,
          ],
        },
        fragment: {
          module,
          entryPoint: FRAGMENT_ENTRY_POINT,
          targets: [
            {
              format: RENDER_TARGET_COLOR_FORMAT,
              writeMask: COLOR_WRITE_ALL,
            },
          ],
        },
        primitive: {
          topology: "triangle-list",
        },
        depthStencil: {
          format: RENDER_TARGET_DEPTH_FORMAT,
          depthWriteEnabled: true,
          depthCompare: "less",
        },
      });
      this.#skinnedPaletteLayout = paletteLayout;
      this.#skinnedPipeline = pipeline;
      return { pipeline, layout: paletteLayout };
    } catch (error: unknown) {
      this.#skinnedPipelineFailed = true;
      if (DEV) {
        devWarnOnce(
          "webgpu-picking-skinned-compile-failed",
          "§71: the skinned picking id pipeline failed to compile on this " +
            "device; skinned id draws are skipped (§61, §89). " +
            `${String(error)}`,
        );
      }
      return null;
    }
  }

  /**
   * Packs one id block per draw, records the pass, and submits. Starts from
   * a cleared id target (loadOp clear — this buffer is never composited, so
   * a whole-attachment clear *is* "nothing there"). Particle emitters are
   * instanced after the mesh draws with a distinct uniform block.
   */
  #drawPass(
    device: GpuDevice,
    pipeline: GpuRenderPipeline,
    layout: GpuBindGroupLayout,
    record: WgpuRenderTargetRecord,
    depthView: GpuTextureView,
    rect: PassRect,
    draws: readonly PackedDraw[],
    particleDraws: readonly PackedParticleDraw[],
    particleCache: WgpuParticleCache | null,
  ): void {
    if (draws.length > 0) {
      this.#growUniforms(device, layout, draws.length);
      const staging = this.#uniformStaging;
      const viewProjection = passViewProjection.elements;
      for (let index = 0; index < draws.length; index += 1) {
        const draw = draws[index];
        const base = index * UNIFORM_STRIDE_FLOATS;
        const viewBase = base + ID_VIEW_PROJECTION_OFFSET / 4;
        const modelBase = base + ID_MODEL_OFFSET / 4;
        const idBase = base + ID_PICK_OFFSET / 4;
        const model = draw.model.elements;
        for (let element = 0; element < 16; element += 1) {
          staging[viewBase + element] = viewProjection[element];
          staging[modelBase + element] = model[element];
        }
        encodePickId(draw.tableIndex, idScratch);
        staging[idBase] = idScratch[0];
        staging[idBase + 1] = idScratch[1];
        staging[idBase + 2] = idScratch[2];
        staging[idBase + 3] = idScratch[3];
      }
      const buffer = this.#uniformBuffer;
      if (buffer !== null) {
        device.queue.writeBuffer(buffer, 0, staging);
      }
    }

    let skinnedCount = 0;
    for (let index = 0; index < draws.length; index += 1) {
      if (draws[index].palette !== null) {
        skinnedCount += 1;
      }
    }
    if (skinnedCount > 0 && this.#skinnedPaletteLayout !== null) {
      this.#growSkinnedPalette(
        device,
        this.#skinnedPaletteLayout,
        skinnedCount,
      );
      const staging = this.#skinnedPaletteStaging;
      let packed = 0;
      for (let index = 0; index < draws.length; index += 1) {
        const palette = draws[index].palette;
        if (palette === null) {
          continue;
        }
        const base = packed * SKINNED_ID_PALETTE_FLOATS;
        const limit = Math.min(palette.length, SKINNED_ID_PALETTE_FLOATS);
        for (
          let element = 0;
          element < SKINNED_ID_PALETTE_FLOATS;
          element += 1
        ) {
          staging[base + element] = element < limit ? palette[element] : 0;
        }
        packed += 1;
      }
      const buffer = this.#skinnedPaletteBuffer;
      if (buffer !== null) {
        device.queue.writeBuffer(
          buffer,
          0,
          staging,
          0,
          packed * SKINNED_ID_PALETTE_FLOATS,
        );
      }
    }

    if (particleDraws.length > 0 && this.#particleBindGroupLayout !== null) {
      this.#growParticleUniforms(
        device,
        this.#particleBindGroupLayout,
        particleDraws.length,
      );
      const staging = this.#particleUniformStaging;
      const projection = passProjection.elements;
      const view = passView.elements;
      for (let index = 0; index < particleDraws.length; index += 1) {
        const draw = particleDraws[index];
        const base = index * UNIFORM_STRIDE_FLOATS;
        const projectionBase = base + PARTICLE_ID_PROJECTION_OFFSET / 4;
        const viewBase = base + PARTICLE_ID_VIEW_OFFSET / 4;
        const modelBase = base + PARTICLE_ID_MODEL_OFFSET / 4;
        const idBase = base + PARTICLE_ID_PICK_OFFSET / 4;
        const model = draw.model.elements;
        for (let element = 0; element < 16; element += 1) {
          staging[projectionBase + element] = projection[element];
          staging[viewBase + element] = view[element];
          staging[modelBase + element] = model[element];
        }
        encodePickId(draw.tableIndex, idScratch);
        staging[idBase] = idScratch[0];
        staging[idBase + 1] = idScratch[1];
        staging[idBase + 2] = idScratch[2];
        staging[idBase + 3] = idScratch[3];
      }
      const buffer = this.#particleUniformBuffer;
      if (buffer !== null) {
        device.queue.writeBuffer(buffer, 0, staging);
      }
    }

    const encoder = device.createCommandEncoder({ label: "fourJS:pick" });
    const pass = encoder.beginRenderPass({
      label: "fourJS:pick",
      colorAttachments: [
        {
          view: record.colorView,
          loadOp: "clear",
          storeOp: "store",
          clearValue: [0, 0, 0, 0],
        },
      ],
      depthStencilAttachment: {
        view: depthView,
        depthLoadOp: "clear",
        depthStoreOp: "store",
        depthClearValue: 1,
      },
    });
    const top = Math.max(0, record.height - (rect.y + rect.height));
    pass.setViewport(rect.x, top, rect.width, rect.height, 0, 1);
    pass.setScissorRect(rect.x, top, rect.width, rect.height);

    const bindGroup = this.#bindGroup;
    const skinnedPipeline = this.#skinnedPipeline;
    const skinnedPaletteGroup = this.#skinnedPaletteBindGroup;
    if (draws.length > 0 && bindGroup !== null) {
      let activeKind: "id" | "skinned" = "id";
      pass.setPipeline(pipeline);
      let paletteSlot = 0;
      for (let index = 0; index < draws.length; index += 1) {
        const draw = draws[index];
        const geometry = draw.geometry;
        const skinned = draw.palette !== null;
        if (skinned && activeKind !== "skinned") {
          if (skinnedPipeline === null || skinnedPaletteGroup === null) {
            continue;
          }
          pass.setPipeline(skinnedPipeline);
          activeKind = "skinned";
        } else if (!skinned && activeKind !== "id") {
          pass.setPipeline(pipeline);
          activeKind = "id";
        }
        pass.setBindGroup(0, bindGroup, [index * UNIFORM_STRIDE_BYTES]);
        if (skinned && skinnedPaletteGroup !== null) {
          pass.setBindGroup(1, skinnedPaletteGroup, [
            paletteSlot * SKINNED_ID_PALETTE_BYTES,
          ]);
          paletteSlot += 1;
          const joints = geometry.jointBuffer;
          const weights = geometry.weightBuffer;
          if (joints === null || weights === null) {
            continue;
          }
          pass.setVertexBuffer(0, geometry.positionBuffer);
          pass.setVertexBuffer(1, joints);
          pass.setVertexBuffer(2, weights);
        } else {
          pass.setVertexBuffer(0, geometry.positionBuffer);
        }
        if (geometry.indexBuffer !== null && geometry.indexFormat !== null) {
          pass.setIndexBuffer(geometry.indexBuffer, geometry.indexFormat);
          pass.drawIndexed(geometry.count);
        } else {
          pass.draw(geometry.count);
        }
      }
    }

    const particlePipeline = this.#particlePipeline;
    const particleBindGroup = this.#particleBindGroup;
    if (
      particleDraws.length > 0 &&
      particlePipeline !== null &&
      particleBindGroup !== null &&
      particleCache !== null
    ) {
      pass.setPipeline(particlePipeline);
      for (let index = 0; index < particleDraws.length; index += 1) {
        const draw = particleDraws[index];
        if (draw.item.count === 0) {
          continue;
        }
        particleCache.upload(draw.batch, draw.item, this.#updateCount);
        pass.setBindGroup(0, particleBindGroup, [index * UNIFORM_STRIDE_BYTES]);
        pass.setVertexBuffer(0, draw.geometry.positionBuffer);
        pass.setVertexBuffer(1, draw.batch.buffer);
        pass.draw(6, draw.item.count);
      }
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  #growUniforms(
    device: GpuDevice,
    layout: GpuBindGroupLayout,
    blocks: number,
  ): void {
    if (blocks <= this.#uniformCapacity) {
      return;
    }
    const capacity = Math.max(blocks, this.#uniformCapacity * 2);
    this.#uniformBuffer?.destroy();
    const buffer = device.createBuffer({
      label: "fourJS:pick-id-uniforms",
      size: capacity * UNIFORM_STRIDE_BYTES,
      usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
    });
    this.#uniformBuffer = buffer;
    this.#uniformStaging = new Float32Array(capacity * UNIFORM_STRIDE_FLOATS);
    this.#uniformCapacity = capacity;
    this.#bindGroup = device.createBindGroup({
      label: "fourJS:pick-id-uniforms",
      layout,
      entries: [
        {
          binding: 0,
          resource: { buffer, offset: 0, size: ID_UNIFORM_BYTES },
        },
      ],
    });
  }

  #growParticleUniforms(
    device: GpuDevice,
    layout: GpuBindGroupLayout,
    blocks: number,
  ): void {
    if (blocks <= this.#particleUniformCapacity) {
      return;
    }
    const capacity = Math.max(blocks, this.#particleUniformCapacity * 2);
    this.#particleUniformBuffer?.destroy();
    const buffer = device.createBuffer({
      label: "fourJS:pick-particle-id-uniforms",
      size: capacity * UNIFORM_STRIDE_BYTES,
      usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
    });
    this.#particleUniformBuffer = buffer;
    this.#particleUniformStaging = new Float32Array(
      capacity * UNIFORM_STRIDE_FLOATS,
    );
    this.#particleUniformCapacity = capacity;
    this.#particleBindGroup = device.createBindGroup({
      label: "fourJS:pick-particle-id-uniforms",
      layout,
      entries: [
        {
          binding: 0,
          resource: { buffer, offset: 0, size: PARTICLE_ID_UNIFORM_BYTES },
        },
      ],
    });
  }

  #growSkinnedPalette(
    device: GpuDevice,
    layout: GpuBindGroupLayout,
    blocks: number,
  ): void {
    if (blocks <= this.#skinnedPaletteCapacity) {
      return;
    }
    const capacity = Math.max(blocks, this.#skinnedPaletteCapacity * 2);
    this.#skinnedPaletteBuffer?.destroy();
    const buffer = device.createBuffer({
      label: "fourJS:pick-skinned-id-palette",
      size: capacity * SKINNED_ID_PALETTE_BYTES,
      usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
    });
    this.#skinnedPaletteBuffer = buffer;
    this.#skinnedPaletteStaging = new Float32Array(
      capacity * SKINNED_ID_PALETTE_FLOATS,
    );
    this.#skinnedPaletteCapacity = capacity;
    this.#skinnedPaletteBindGroup = device.createBindGroup({
      label: "fourJS:pick-skinned-id-palette",
      layout,
      entries: [
        {
          binding: 0,
          resource: { buffer, offset: 0, size: SKINNED_ID_PALETTE_BYTES },
        },
      ],
    });
  }
}

/**
 * Opts this process's `WebgpuRenderer`s into §71's `"gpu"` picking tier
 * (RFC 0005).
 *
 * ```ts
 * import { registerPickingPipeline } from "@fourjs/render-webgpu";
 * registerPickingPipeline();           // once, at application setup
 * const picking = renderer.createPickingService();
 * ```
 *
 * Calling it is what links this module — the id pipeline, its WGSL, the
 * service, and the `mapAsync` read-back — into the bundle; a build that never
 * calls it carries none of it. The id pipeline still compiles **lazily, on
 * each service's first pass**, never here and never at `createPickingService()`,
 * so registration and creation alone change no device transcript. Idempotent;
 * calling it twice re-installs the same factory.
 */
export function registerPickingPipeline(): void {
  setPickingServiceFactory({
    create(host: PickingRendererHost): PickingService {
      return new WebgpuPickingService(host);
    },
  });
}
