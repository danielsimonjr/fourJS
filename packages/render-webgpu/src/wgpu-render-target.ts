/**
 * GPU-side render targets for the WebGPU backend: one colour (and optional
 * depth) allocation per `@fourjs/render` `RenderTarget`, cached and invalidated
 * by version (§61, §48, §63; WP-R1.6).
 *
 * The fourth member of the family `wgpu-geometry.ts` and `wgpu-texture.ts`
 * continue — same key (`id`), same validator (`version`), same lazy eviction,
 * same loss-aware {@link WgpuRenderTargetCache.forget}, same refusal to throw
 * inside `render` — and the WebGPU twin of `gl-render-target.ts`, whose module
 * header carries the family argument in full. What is stated here is only what
 * the port could not transliterate: the format table, and the two places
 * WebGPU's object model differs from a framebuffer's.
 *
 * ## The format decisions, as data
 *
 * Every format this cache allocates is a named constant below, resolved by
 * {@link renderTargetDepthFormat} — a table, not a scatter of string literals,
 * for the reason `wgpu-bindings.ts` declares layouts as data: a later packet
 * (R1.7's shadow sampling, the R-4 float-format widening) targets the table
 * rather than re-deriving it.
 *
 * - **Colour is {@link RENDER_TARGET_COLOR_FORMAT} (`rgba8unorm`)** — not the
 *   swap chain's preferred `bgra8unorm`. The engine's `"rgba8"` descriptor
 *   means *eight-bit unsigned normalised colour* and channel order is a
 *   backend detail (`webgpu-renderer.ts`'s §60a note), so the backend picks
 *   the order that costs least: `rgba8unorm` is guaranteed renderable and
 *   sampleable on every device, and `readPixels` then returns bytes in the
 *   R,G,B,A order §61's callers (and GL's `readPixels`) expect, with no
 *   swizzle pass. The consequence is that off-screen pipelines carry a
 *   different `colorFormat` than on-screen ones — which is exactly what the
 *   per-format pipeline cache exists to absorb, and why an application's first
 *   off-screen frame compiles its variants a second time.
 * - **A plain depth buffer is {@link RENDER_TARGET_DEPTH_FORMAT}
 *   (`depth24plus`)** — the same format the on-screen attachment uses, and
 *   WebGPU's spelling of "a depth buffer nothing reads" (GL's
 *   `DEPTH_COMPONENT16` renderbuffer; the byte accounting difference is
 *   `RenderTarget.byteLength`'s to describe, not this cache's to change).
 * - **A samplable depth attachment (`depthTexture: true`) is
 *   {@link RENDER_TARGET_DEPTH_TEXTURE_FORMAT} (`depth32float`)**, not
 *   `depth24plus`. The plan's wording allows either; `depth32float` is chosen
 *   because it is the depth format WebGPU guarantees can be both sampled
 *   (`sampleType: "depth"`) *and* copied out of (`copyTextureToBuffer`
 *   forbids the `depth24plus` depth aspect as a copy source), and because its
 *   four bytes per texel are exactly what R-18's accounting already bills for
 *   the samplable form. It is allocated with `TEXTURE_BINDING`, because being
 *   sampled later is the option's whole meaning (§69) — binding it is R1.7's
 *   packet (a depth comparison is a distinct binding type).
 * - **A stencilled target is {@link RENDER_TARGET_DEPTH_STENCIL_FORMAT}
 *   (`depth24plus-stencil8`)** — WebGPU's spelling of the packed
 *   `DEPTH24_STENCIL8` the GL backend allocates, and the reason §67's
 *   `stencil` ⊥ `depthTexture` exclusivity **survives the port for an
 *   independent reason** (the R-1 plan's §3.3.6): a combined-aspect texture
 *   cannot serve as the general samplable depth attachment, so the constraint
 *   two backends reach independently is a design, not an accident of GL.
 *
 * The colour allocation always carries `RENDER_ATTACHMENT | TEXTURE_BINDING |
 * COPY_SRC`: a target exists to be drawn into, then sampled (R-4's
 * render-to-texture point) or read back (§61's `readPixels`), and one usage
 * set keeps the format table one row per format instead of one per consumer.
 *
 * ## What one entry holds, and the two structural differences from GL
 *
 * A record holds the colour texture and its view, the optional depth texture
 * and its view, and the size and format facts frame code reads off the
 * *record* rather than off the `RenderTarget` — so the `setViewport` call and
 * the allocation agree even if the application resized the target after the
 * frame began (`gl-render-target.ts`'s rule, unchanged).
 *
 * 1. **There is no framebuffer object and no completeness check.** A WebGPU
 *    render pass binds views directly, and `createTexture` on a guaranteed
 *    format does not fail synchronously — allocation failure surfaces through
 *    the device's error scopes and draws nothing, which satisfies §61's
 *    no-throw rule by construction. `acquire` therefore returns `null` only
 *    for a disposed target or a disposed cache.
 * 2. **Sampling state is an object, and the sampling bind group is lazy.**
 *    GL writes `LINEAR`/`CLAMP_TO_EDGE` onto the colour texture at allocation;
 *    here the equivalent is a bind group over the texture cache's group layout
 *    (the *same* layout object every `map` pipeline was compiled against —
 *    the WP-R1.2 provider rule) with one shared linear-clamped sampler.
 *    Both are created by the first frame that actually **samples** a target
 *    ({@link WgpuRenderTargetCache.sample}), never at allocation — a target
 *    that is only ever drawn into and read back records no sampler, no
 *    layout, and no bind group at all (the lazy-everything discipline).
 */

import type { RenderTarget } from "@fourjs/render";
import {
  RenderTargetPool,
  warnDisposedInUse,
  type PassUsageRecord,
  type TransientTargetKey,
  type TransientTargetUsage,
} from "@fourjs/render";

import {
  GPU_TEXTURE_USAGE,
  type GpuBindGroup,
  type GpuBindGroupLayout,
  type GpuDevice,
  type GpuSampler,
  type GpuTexture,
  type GpuTextureView,
} from "./webgpu-device.js";
import { MAP_SAMPLER_BINDING, MAP_TEXTURE_BINDING } from "./wgpu-bindings.js";

/**
 * The render-target type this cache stores — imported by name, exactly as the
 * GL twin imports it and for its recorded reason: a target reaches the backend
 * as `Renderer.render`'s fourth argument, typed as this one class.
 */
export type WgpuCacheableRenderTarget = RenderTarget;

/** Colour format of every off-screen target — see the module header. */
export const RENDER_TARGET_COLOR_FORMAT = "rgba8unorm";

/** Depth format of a plain (`depth: true`) target — see the module header. */
export const RENDER_TARGET_DEPTH_FORMAT = "depth24plus";

/** Depth format of a samplable (`depthTexture: true`) target — see the header. */
export const RENDER_TARGET_DEPTH_TEXTURE_FORMAT = "depth32float";

/** Depth format of a stencilled (`stencil: true`) target — see the header. */
export const RENDER_TARGET_DEPTH_STENCIL_FORMAT = "depth24plus-stencil8";

/**
 * The depth format `target`'s options resolve to, or `null` for a target with
 * no depth attachment — the module header's table as one total function.
 *
 * The three option bits cannot conflict here: `RenderTarget`'s constructor
 * refused `{ stencil, depthTexture }` and `{ depth: false, … }` contradictions
 * at §85 time, so this function never has to choose between two formats.
 */
export function renderTargetDepthFormat(
  target: WgpuCacheableRenderTarget,
): string | null {
  if (!target.depth) {
    return null;
  }
  if (target.stencil) {
    return RENDER_TARGET_DEPTH_STENCIL_FORMAT;
  }
  if (target.depthTexture) {
    return RENDER_TARGET_DEPTH_TEXTURE_FORMAT;
  }
  return RENDER_TARGET_DEPTH_FORMAT;
}

/** Everything one cached render target needs at frame time. */
export interface WgpuRenderTargetRecord {
  /** The colour allocation — drawn into, sampled from, read back. */
  readonly colorTexture: GpuTexture;

  /** The colour attachment view a render pass binds. */
  readonly colorView: GpuTextureView;

  /**
   * The depth allocation, or `null` for a `depth: false` target. For a
   * `depthTexture: true` target this is the samplable `depth32float` texture
   * §69's shadow comparison will bind (R1.7); for every other depth-carrying
   * target it is the attachment nothing reads.
   */
  readonly depthTexture: GpuTexture | null;

  /** The depth attachment view, or `null` — paired with `depthTexture`. */
  readonly depthView: GpuTextureView | null;

  /**
   * The depth attachment's format, or `null` — the value every pipeline drawn
   * into this target bakes in as its `depthFormat`, read off the record so the
   * pass descriptor and the pipeline keys cannot disagree.
   */
  readonly depthFormat: string | null;

  /**
   * Whether the depth attachment carries §67's stencil aspect — i.e. whether a
   * frame drawing into this target may run stencil tests and owes the aspect
   * its per-view clear. A fact about {@link WgpuRenderTargetRecord.depthFormat},
   * held as a boolean so frame code asks one question.
   */
  readonly stencil: boolean;

  /** `RenderTarget.version` this record was allocated from. */
  readonly version: number;

  /** Width the attachments were allocated at, in texels. */
  readonly width: number;

  /** Height the attachments were allocated at, in texels. */
  readonly height: number;

  /**
   * The bind group a draw sampling this target's colour attachment sets, or
   * `null` until {@link WgpuRenderTargetCache.sample} first creates it. The
   * record's one mutable member, for `WgpuGeometryRecord.normalBuffer`'s
   * reason: the upgrade writes into the live record rather than re-allocating
   * three textures that have not changed.
   */
  sampleBindGroup: GpuBindGroup | null;
}

/**
 * Per-device store of allocated render targets (§61, §48, §63, WP-R1.6).
 *
 * One cache belongs to one device; the renderer builds it during `initialize`
 * — the constructor allocates nothing, so a frame that never names a target
 * records exactly the transcript it always did — and drops it whole on device
 * loss.
 *
 * ```ts
 * const record = renderTargets.acquire(target);
 * if (record !== null) {
 *   // attach record.colorView / record.depthView, draw…
 * }
 * ```
 */
export class WgpuRenderTargetCache {
  readonly #device: GpuDevice;

  /**
   * The texture cache's group layout, as a provider — it must be **the same
   * object** every `map` pipeline was compiled against, and reaching it
   * through a provider keeps its creation with the first sampling draw
   * (`wgpu-pipeline-cache.ts`'s provider rule, fifth application).
   */
  readonly #sampleLayout: () => GpuBindGroupLayout;

  /** Records by `RenderTarget.id`; eviction per the GL twin's module header. */
  readonly #records = new Map<string, WgpuRenderTargetRecord>();

  /**
   * The one sampler every sampled target shares: linear, clamped — the fixed
   * state `gl-render-target.ts` writes on every colour attachment, as an
   * object. Created by the first {@link WgpuRenderTargetCache.sample}.
   */
  #sampler: GpuSampler | null = null;

  #disposed = false;

  constructor(device: GpuDevice, sampleLayout: () => GpuBindGroupLayout) {
    this.#device = device;
    this.#sampleLayout = sampleLayout;
  }

  /** Number of targets currently allocated. Diagnostics and tests (§83, §84). */
  get size(): number {
    return this.#records.size;
  }

  /** Whether {@link WgpuRenderTargetCache.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Returns the allocations for `target`, allocating on first use and
   * re-allocating whenever `target.version` has advanced (a `resize()`, whose
   * documented cost this is).
   *
   * Returns `null` — and creates no entry — for a disposed target or a
   * disposed cache, so the pass is skipped rather than drawn into a released
   * surface (§83). **Never throws**: this runs inside `Renderer.render` (§61).
   */
  acquire(target: WgpuCacheableRenderTarget): WgpuRenderTargetRecord | null {
    if (this.#disposed) {
      return null;
    }
    const existing = this.#records.get(target.id);
    if (existing !== undefined) {
      if (existing.version === target.version) {
        return existing;
      }
      this.#destroy(existing);
      this.#records.delete(target.id);
    }

    if (target.disposed) {
      warnDisposedInUse("render-target", target.id);
      return null;
    }

    const record = this.#allocate(target);
    this.#records.set(target.id, record);
    return record;
  }

  /**
   * The bind group for **sampling** `target`'s colour attachment — the seam a
   * draw whose material's `map` is a render-target texture resolves through,
   * and the one `renderEffect` sources from (they are deliberately the same
   * group: a bind group carries no index, so one object serves group 1, group
   * 2 and the effect's group 0).
   *
   * `null` exactly when {@link WgpuRenderTargetCache.acquire} answers `null`.
   * Creates the shared sampler and this record's bind group on first use.
   */
  sample(target: WgpuCacheableRenderTarget): GpuBindGroup | null {
    const record = this.acquire(target);
    if (record === null) {
      return null;
    }
    if (record.sampleBindGroup === null) {
      record.sampleBindGroup = this.#device.createBindGroup({
        label: `fourJS:render-target-map:${target.id}`,
        layout: this.#sampleLayout(),
        entries: [
          { binding: MAP_TEXTURE_BINDING, resource: record.colorView },
          { binding: MAP_SAMPLER_BINDING, resource: this.sampleSampler() },
        ],
      });
    }
    return record.sampleBindGroup;
  }

  /**
   * The colour view a **multi-binding** consumer samples `target` through
   * (§60's node texture groups, WP-R1.9): a node program binds several
   * texture/sampler pairs in one group, so the two-binding
   * {@link WgpuRenderTargetCache.sample} group cannot serve it and the raw
   * view is handed out instead, paired with
   * {@link WgpuRenderTargetCache.sampleSampler}. `null` exactly when
   * {@link WgpuRenderTargetCache.acquire} answers `null` (§83).
   */
  sampleView(target: WgpuCacheableRenderTarget): GpuTextureView | null {
    return this.acquire(target)?.colorView ?? null;
  }

  /**
   * The one sampler every sampled target shares — linear, clamped, the fixed
   * state `gl-render-target.ts` writes on every colour attachment — created
   * on first use, by whichever of {@link WgpuRenderTargetCache.sample} or a
   * node program's group composition asks first (WP-R1.9: one object, so a
   * frame mixing both paths allocates one sampler, not two).
   */
  sampleSampler(): GpuSampler {
    this.#sampler ??= this.#device.createSampler({
      label: "fourJS:render-target-sampler",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: "linear",
      minFilter: "linear",
      // One level — a target has no mip chain to filter between.
      mipmapFilter: "nearest",
    });
    return this.#sampler;
  }

  /**
   * Drops every record **without destroying anything** — the device-loss path
   * (§61): the allocations belong to a device that no longer exists.
   */
  forget(): void {
    this.#records.clear();
    this.#sampler = null;
  }

  /**
   * Destroys every texture this cache created (§83). Idempotent. Samplers and
   * bind groups have no `destroy()`; dropping the map is their release. The
   * *application's* `RenderTarget` objects are untouched — the renderer did
   * not create them.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const record of this.#records.values()) {
      this.#destroy(record);
    }
    this.forget();
  }

  /**
   * Allocates the colour texture and the optional depth texture, with their
   * whole-texture views. Nothing binds and nothing can be left bound — the
   * WebGPU allocation calls name no ambient state, which is the whole of the
   * unbinding ceremony the GL twin needed.
   */
  #allocate(target: WgpuCacheableRenderTarget): WgpuRenderTargetRecord {
    const device = this.#device;
    const width = target.width;
    const height = target.height;

    const colorTexture = device.createTexture({
      label: `fourJS:render-target:${target.id}`,
      size: [width, height],
      format: RENDER_TARGET_COLOR_FORMAT,
      usage:
        usageHints.get(target) ??
        GPU_TEXTURE_USAGE.RENDER_ATTACHMENT |
          GPU_TEXTURE_USAGE.TEXTURE_BINDING |
          GPU_TEXTURE_USAGE.COPY_SRC,
    });

    const depthFormat = renderTargetDepthFormat(target);
    let depthTexture: GpuTexture | null = null;
    if (depthFormat !== null) {
      depthTexture = device.createTexture({
        label: `fourJS:render-target-depth:${target.id}`,
        size: [width, height],
        format: depthFormat,
        // The samplable form is the one whose being-sampled-later is the
        // option's meaning (§69); the other two are attachments nothing reads.
        usage:
          GPU_TEXTURE_USAGE.RENDER_ATTACHMENT |
          (target.depthTexture ? GPU_TEXTURE_USAGE.TEXTURE_BINDING : 0),
      });
    }

    return {
      colorTexture,
      colorView: colorTexture.createView(),
      depthTexture,
      depthView: depthTexture === null ? null : depthTexture.createView(),
      depthFormat,
      // Read off the format, not the target, so the frame's "may I stencil"
      // question and the pass descriptor's aspect ops cannot disagree.
      stencil: depthFormat === RENDER_TARGET_DEPTH_STENCIL_FORMAT,
      version: target.version,
      width,
      height,
      sampleBindGroup: null,
    };
  }

  /** Destroys the textures one record owns. Live devices only. */
  #destroy(record: WgpuRenderTargetRecord): void {
    record.colorTexture.destroy?.();
    record.depthTexture?.destroy?.();
  }
}

/**
 * Colour usage masks chosen up front for pooled (transient) targets (§63,
 * W6.1); targets without an entry keep the default
 * `RENDER_ATTACHMENT | TEXTURE_BINDING | COPY_SRC`.
 */
const usageHints = new WeakMap<object, number>();

/** The usage mask a pooled target will be allocated with, or `undefined`. */
export function transientUsageOf(target: RenderTarget): number | undefined {
  return usageHints.get(target);
}

/**
 * WebGPU's §63 transient pool (W6.1). WebGPU orders usages implicitly per
 * pass, so a barrier is a pass boundary — which `webgpu-renderer.ts` already
 * makes at every `render`/`renderEffect`. What the graph's usage list buys here
 * is choosing the texture usage up front: a slot that is only ever drawn into
 * skips `TEXTURE_BINDING`; one that is sampled keeps it. `COPY_SRC` stays so
 * `readPixels` works on any slot.
 */
export class WgpuTransientTargetPool extends RenderTargetPool {
  /** Passes begun and usage transitions crossed (observability / tests). */
  passCount = 0;

  transitionCount = 0;

  readonly #state = new Map<string, "attachment" | "texture">();

  beginPass(record: PassUsageRecord): void {
    if (record.index === 0) {
      this.#state.clear();
    }
    this.passCount += 1;
    for (const read of record.reads) {
      if (this.#state.get(read) !== "texture") {
        this.transitionCount += 1;
        this.#state.set(read, "texture");
      }
    }
    if (
      record.writes !== null &&
      this.#state.get(record.writes) !== "attachment"
    ) {
      this.transitionCount += 1;
      this.#state.set(record.writes, "attachment");
    }
  }

  protected override onAcquire(
    target: RenderTarget,
    _key: TransientTargetKey,
    usage: TransientTargetUsage,
  ): void {
    usageHints.set(
      target,
      GPU_TEXTURE_USAGE.RENDER_ATTACHMENT |
        GPU_TEXTURE_USAGE.COPY_SRC |
        (usage.sampled ? GPU_TEXTURE_USAGE.TEXTURE_BINDING : 0),
    );
  }
}
