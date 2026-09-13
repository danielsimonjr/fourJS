/**
 * A "same as the previous draw" fast path in front of {@link WgpuPipelineCache}
 * (performance audit 2026-09-11, finding A3).
 *
 * ## Why a memo and not a per-material cache
 *
 * `WgpuPipelineCache.acquire` is correct and canonical: it builds a descriptor
 * object per draw, `pipelineKey` joins ~10 segments into a string, and a
 * string-keyed `Map` answers. That is three allocations and a string hash on
 * every draw of every frame, for a lookup whose answer is the previous draw's
 * answer almost every time — a render list sorted by §66's key runs
 * same-material draws back to back.
 *
 * The obvious alternative — a `WeakMap<material, pipeline>` invalidated on
 * `material.version` — is **wrong** for this backend, and R-12 says why: the
 * six §57 render-state fields (`transparent`, `blendMode`, `depthTest`,
 * `depthWrite`, `colorWrite`, `stencil`) do *not* bump `Material.version`,
 * because "nothing caches render state — the backend re-reads it per draw".
 * A version-keyed memo would serve a stale pipeline after
 * `material.depthTest = false`. So this memo keeps R-12's contract: the
 * backend still reads every §57 field per draw, and compares the **derived
 * key scalars** against the previous draw's. Only when they all match is the
 * descriptor, the key string and the `Map` lookup skipped — and a match means
 * `pipelineKey` would have produced the same string, so the answer is the same
 * cached pipeline by construction.
 *
 * ## What it must not change
 *
 * - The cache stays string-keyed (§33): a memo hit is a cache hit that was
 *   already going to happen; a miss goes through `acquire` unchanged, so the
 *   cache's insertion order — and every `fourJS:<key>` label in a landed
 *   transcript — is byte-identical.
 * - The reentrant-dispose rule (§61): a hit is honoured only while the cache
 *   it was recorded against is the live one and not disposed, so a draw racing
 *   teardown still skips rather than binding a dropped pipeline.
 * - `StencilState` is mutable (`stencil-state.ts`), so a stencil record is
 *   compared by its six §57 fields — with the same defaults
 *   `stencilDescriptor` applies — not by identity.
 */

import type { GpuRenderPipeline } from "./webgpu-device.js";
import type {
  WgpuPipelineCache,
  WgpuPipelineDescriptor,
  WgpuPipelineKind,
} from "./wgpu-pipeline-cache.js";
import {
  STENCIL_ALL_BITS,
  stencilDescriptor,
  type WgpuStencilSource,
} from "./wgpu-stencil.js";

/** The scalar inputs of one per-item pipeline lookup, in `pipelineKey` order. */
export interface WgpuPipelineRequest {
  readonly kind: WgpuPipelineKind;
  readonly vertexColors: boolean;
  readonly map: boolean;
  readonly blend: WgpuPipelineDescriptor["blend"];
  readonly depthTest: boolean;
  readonly depthWrite: boolean;
  readonly colorWrite: boolean;
  readonly topology: WgpuPipelineDescriptor["topology"];
  readonly colorFormat: string;
  readonly depthFormat: string | null;
  /** The stencil *source* (a clip record or a material's `StencilState`), or `null`. */
  readonly stencil: WgpuStencilSource | null;
  /** `undefined` for every unshaded kind — the `pipelineKey` rule. */
  readonly normals: boolean | undefined;
  readonly shadow: boolean;
  readonly metalRoughness: boolean;
  readonly gpuInstances: boolean;
}

/**
 * Remembers the previous draw's pipeline lookup and answers a repeat without
 * building a descriptor.
 *
 * One instance per renderer. Holds no GPU resources: the pipeline it remembers
 * is owned by the cache, and the memo forgets it the moment the cache differs
 * or is disposed.
 */
export class WgpuPipelineMemo {
  #cache: WgpuPipelineCache | null = null;
  #pipeline: GpuRenderPipeline | null = null;

  #kind: WgpuPipelineKind = "unlit";
  #vertexColors = false;
  #map = false;
  #blend: WgpuPipelineDescriptor["blend"] = "none";
  #depthTest = false;
  #depthWrite = false;
  #colorWrite = false;
  #topology: WgpuPipelineDescriptor["topology"] = "triangle-list";
  #colorFormat = "";
  #depthFormat: string | null = null;
  #normals: boolean | undefined = undefined;
  #shadow = false;
  #metalRoughness = false;
  #gpuInstances = false;

  #hasStencil = false;
  #stencilFunc = "";
  #stencilReadMask = 0;
  #stencilWriteMask = 0;
  #stencilFailOp = "";
  #stencilDepthFailOp = "";
  #stencilPassOp = "";

  /** Forgets the remembered draw (device loss, cache replacement). */
  reset(): void {
    this.#cache = null;
    this.#pipeline = null;
  }

  /**
   * The pipeline for `request` from `cache` — the previous answer when
   * nothing in the request changed, `cache.acquire` otherwise.
   */
  acquire(
    cache: WgpuPipelineCache,
    request: WgpuPipelineRequest,
  ): GpuRenderPipeline | null {
    const stencil = request.stencil;
    // `stencilDescriptor`'s defaults, applied here so a record that spells
    // `func: "always"` and one that omits it compare — and key — the same.
    const hasStencil = stencil !== null;
    const stencilFunc = hasStencil ? (stencil.func ?? "always") : "";
    const stencilReadMask = hasStencil
      ? (stencil.readMask ?? STENCIL_ALL_BITS)
      : 0;
    const stencilWriteMask = hasStencil
      ? (stencil.writeMask ?? STENCIL_ALL_BITS)
      : 0;
    const stencilFailOp = hasStencil ? (stencil.failOp ?? "keep") : "";
    const stencilDepthFailOp = hasStencil
      ? (stencil.depthFailOp ?? "keep")
      : "";
    const stencilPassOp = hasStencil ? (stencil.passOp ?? "keep") : "";

    if (
      this.#cache === cache &&
      this.#pipeline !== null &&
      !cache.disposed &&
      this.#kind === request.kind &&
      this.#vertexColors === request.vertexColors &&
      this.#map === request.map &&
      this.#blend === request.blend &&
      this.#depthTest === request.depthTest &&
      this.#depthWrite === request.depthWrite &&
      this.#colorWrite === request.colorWrite &&
      this.#topology === request.topology &&
      this.#colorFormat === request.colorFormat &&
      this.#depthFormat === request.depthFormat &&
      this.#normals === request.normals &&
      this.#shadow === request.shadow &&
      this.#metalRoughness === request.metalRoughness &&
      this.#gpuInstances === request.gpuInstances &&
      this.#hasStencil === hasStencil &&
      this.#stencilFunc === stencilFunc &&
      this.#stencilReadMask === stencilReadMask &&
      this.#stencilWriteMask === stencilWriteMask &&
      this.#stencilFailOp === stencilFailOp &&
      this.#stencilDepthFailOp === stencilDepthFailOp &&
      this.#stencilPassOp === stencilPassOp
    ) {
      return this.#pipeline;
    }

    // A miss: the canonical path, with the descriptor spelled exactly as the
    // draw arms spelled it before the memo existed. `normals` is carried only
    // when defined and the three trailing flags only when true — both are
    // what `pipelineKey` reads, so the key (and label) is unchanged.
    const descriptor: WgpuPipelineDescriptor = {
      kind: request.kind,
      vertexColors: request.vertexColors,
      map: request.map,
      blend: request.blend,
      depthTest: request.depthTest,
      depthWrite: request.depthWrite,
      colorWrite: request.colorWrite,
      topology: request.topology,
      colorFormat: request.colorFormat,
      depthFormat: request.depthFormat,
      stencil: hasStencil ? stencilDescriptor(stencil) : null,
      batch: null,
      ...(request.normals === undefined ? {} : { normals: request.normals }),
      ...(request.shadow ? { shadow: true } : {}),
      ...(request.metalRoughness ? { metalRoughness: true } : {}),
      ...(request.gpuInstances ? { gpuInstances: true } : {}),
    };
    const pipeline = cache.acquire(descriptor);

    this.#cache = cache;
    this.#pipeline = pipeline;
    this.#kind = request.kind;
    this.#vertexColors = request.vertexColors;
    this.#map = request.map;
    this.#blend = request.blend;
    this.#depthTest = request.depthTest;
    this.#depthWrite = request.depthWrite;
    this.#colorWrite = request.colorWrite;
    this.#topology = request.topology;
    this.#colorFormat = request.colorFormat;
    this.#depthFormat = request.depthFormat;
    this.#normals = request.normals;
    this.#shadow = request.shadow;
    this.#metalRoughness = request.metalRoughness;
    this.#gpuInstances = request.gpuInstances;
    this.#hasStencil = hasStencil;
    this.#stencilFunc = stencilFunc;
    this.#stencilReadMask = stencilReadMask;
    this.#stencilWriteMask = stencilWriteMask;
    this.#stencilFailOp = stencilFailOp;
    this.#stencilDepthFailOp = stencilDepthFailOp;
    this.#stencilPassOp = stencilPassOp;
    return pipeline;
  }
}

/**
 * One reusable request record, mutated in place by the draw arms so a lookup
 * allocates nothing (the same discipline as the uniform staging array). The
 * renderer is not re-entrant across draws, and {@link WgpuPipelineMemo.acquire}
 * copies every field it keeps before returning.
 */
export interface MutableWgpuPipelineRequest {
  kind: WgpuPipelineKind;
  vertexColors: boolean;
  map: boolean;
  blend: WgpuPipelineDescriptor["blend"];
  depthTest: boolean;
  depthWrite: boolean;
  colorWrite: boolean;
  topology: WgpuPipelineDescriptor["topology"];
  colorFormat: string;
  depthFormat: string | null;
  stencil: WgpuStencilSource | null;
  normals: boolean | undefined;
  shadow: boolean;
  metalRoughness: boolean;
  gpuInstances: boolean;
}

/** A fresh request record at the unlit family's defaults. */
export function createPipelineRequest(): MutableWgpuPipelineRequest {
  return {
    kind: "unlit",
    vertexColors: false,
    map: false,
    blend: "none",
    depthTest: false,
    depthWrite: false,
    colorWrite: true,
    topology: "triangle-list",
    colorFormat: "",
    depthFormat: null,
    stencil: null,
    normals: undefined,
    shadow: false,
    metalRoughness: false,
    gpuInstances: false,
  };
}
