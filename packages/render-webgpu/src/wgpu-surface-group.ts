/**
 * The standard family's surface bind groups (WP-W4.2): the five-entry group of
 * `createSurfaceBindGroupLayout` (metallic-roughness, one shared sampler,
 * normal, occlusion, emissive) built from the texture cache's records, with a
 * 1x1 default texel ({@link SURFACE_DEFAULT_TEXELS}) in every absent slot.
 *
 * ## Caching
 *
 * A bind group is per *combination of views*, shared by every draw using it:
 * a four-deep `WeakMap` chain keyed by the (resolved) texture views finds it
 * with no allocation after the first draw. A re-uploaded texture has a new
 * view, so its stale groups become unreachable and collect with it. The
 * sampler is the first present map's — itself a pure function of that
 * texture's §77 state — so it is not part of the key.
 *
 * ## Render-target textures
 *
 * A slot may hold a render-target texture (`isRenderTargetTexture`): it is
 * resolved through the render-target cache's view and shared sampler, the
 * same render-target-aware path `resolveFrameTexture` uses for the two-binding
 * groups, so a render-target metallic-roughness map draws with detail maps
 * too. A target that is the frame's own active target is a feedback loop and
 * resolves to `null` (skip the draw), exactly as there.
 *
 * ## Known parity gap (sampler)
 *
 * All four textures are sampled through the *first present map's* sampler (one
 * sampler binding), whereas WebGL gives each unit its own §77 state. The
 * difference is visible only when a detail map's wrap/filter state differs
 * from that first map's (the metallic-roughness map when present).
 *
 * Default textures are created lazily with the first group, so an application
 * that never samples a detail map records no extra device calls.
 */

import {
  GPU_TEXTURE_USAGE,
  type GpuBindGroup,
  type GpuBindGroupLayout,
  type GpuDevice,
  type GpuSampler,
  type GpuTexture,
  type GpuTextureView,
} from "./webgpu-device.js";
import {
  SURFACE_EMISSIVE_BINDING,
  SURFACE_MR_BINDING,
  SURFACE_NORMAL_BINDING,
  SURFACE_OCCLUSION_BINDING,
  SURFACE_SAMPLER_BINDING,
} from "./wgpu-bindings.js";
import { SURFACE_DEFAULT_TEXELS } from "./wgpu-standard.js";
import { isRenderTargetTexture, type RenderTarget } from "@fourjs/render";
import type { WgpuRenderTargetCache } from "./wgpu-render-target.js";
import type {
  WgpuCacheableTexture,
  WgpuTextureCache,
  WgpuTextureRecord,
} from "./wgpu-texture.js";

type SlotName = keyof typeof SURFACE_DEFAULT_TEXELS;

const SLOTS: readonly SlotName[] = [
  "metalRoughness",
  "normal",
  "occlusion",
  "emissive",
];

/** The texture sources of one standard draw; `null` is an absent slot. */
export interface SurfaceSources {
  readonly metalRoughness: WgpuCacheableTexture | null;
  readonly normal: WgpuCacheableTexture | null;
  readonly occlusion: WgpuCacheableTexture | null;
  readonly emissive: WgpuCacheableTexture | null;
}

/** Per-renderer store of surface bind groups and the default texels. */
export class WgpuSurfaceGroupCache {
  readonly #device: GpuDevice;
  readonly #layout: () => GpuBindGroupLayout;
  readonly #defaults = new Map<SlotName, GpuTexture>();
  readonly #defaultViews = new Map<SlotName, GpuTextureView>();
  #groups = new WeakMap<object, unknown>();
  readonly #views: GpuTextureView[] = [];
  readonly #records: (WgpuTextureRecord | null)[] = [null, null, null, null];
  #disposed = false;

  constructor(device: GpuDevice, layout: () => GpuBindGroupLayout) {
    this.#device = device;
    this.#layout = layout;
  }

  /**
   * The group for `sources`, or `null` when a named source does not resolve
   * (disposed, or a render target that is the frame's own active target) so the caller skips the draw (§83, §61: never throws).
   */
  acquire(
    textures: WgpuTextureCache,
    sources: SurfaceSources,
    renderTargets: WgpuRenderTargetCache | null = null,
    activeTarget: RenderTarget | null = null,
  ): GpuBindGroup | null {
    if (this.#disposed) {
      return null;
    }
    const records = this.#records;
    const views = this.#views;
    views.length = 0;
    let sampler: GpuSampler | null = null;
    for (let i = 0; i < SLOTS.length; i += 1) {
      const source = sources[SLOTS[i]];
      if (source === null) {
        records[i] = null;
        views.push(this.#defaultView(SLOTS[i]));
        continue;
      }
      if (isRenderTargetTexture(source)) {
        records[i] = null;
        const view =
          renderTargets === null || source.renderTarget === activeTarget
            ? null
            : renderTargets.sampleView(source.renderTarget);
        if (view === null || renderTargets === null) {
          return null;
        }
        views.push(view);
        sampler ??= renderTargets.sampleSampler();
        continue;
      }
      const record = textures.acquire(source);
      if (record === null) {
        return null;
      }
      records[i] = record;
      views.push(record.view);
      sampler ??= record.sampler;
    }
    if (sampler === null) {
      return null;
    }
    return this.#lookup(views, sampler);
  }

  #lookup(views: readonly GpuTextureView[], sampler: GpuSampler): GpuBindGroup {
    let map: WeakMap<object, unknown> = this.#groups;
    for (let i = 0; i < 3; i += 1) {
      const key = views[i];
      let next = map.get(key) as WeakMap<object, unknown> | undefined;
      if (next === undefined) {
        next = new WeakMap();
        map.set(key, next);
      }
      map = next;
    }
    const last = views[3];
    const existing = map.get(last) as GpuBindGroup | undefined;
    if (existing !== undefined) {
      return existing;
    }
    const group = this.#device.createBindGroup({
      label: "fourJS:surface",
      layout: this.#layout(),
      entries: [
        { binding: SURFACE_MR_BINDING, resource: views[0] },
        { binding: SURFACE_SAMPLER_BINDING, resource: sampler },
        {
          binding: SURFACE_NORMAL_BINDING,
          resource: views[1],
        },
        {
          binding: SURFACE_OCCLUSION_BINDING,
          resource: views[2],
        },
        {
          binding: SURFACE_EMISSIVE_BINDING,
          resource: views[3],
        },
      ],
    });
    map.set(last, group);
    return group;
  }

  #defaultView(slot: SlotName): GpuTextureView {
    const existing = this.#defaultViews.get(slot);
    if (existing !== undefined) {
      return existing;
    }
    const texture = this.#device.createTexture({
      label: `fourJS:surface-default:${slot}`,
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST,
    });
    this.#device.queue.writeTexture(
      { texture },
      new Uint8Array(SURFACE_DEFAULT_TEXELS[slot]),
      { offset: 0, bytesPerRow: 4, rowsPerImage: 1 },
      [1, 1],
    );
    const view = texture.createView();
    this.#defaults.set(slot, texture);
    this.#defaultViews.set(slot, view);
    return view;
  }

  /** Destroys the default textures and drops every group. */
  dispose(): void {
    this.#disposed = true;
    for (const texture of this.#defaults.values()) {
      texture.destroy?.();
    }
    this.forget();
  }

  /** Drops everything without destroying (device lost). */
  forget(): void {
    this.#defaults.clear();
    this.#defaultViews.clear();
    this.#records.fill(null);
    this.#views.length = 0;
    this.#groups = new WeakMap();
  }
}
