/**
 * The particle pipeline's registration slot (§36, §62; 2026-09-11) — the
 * lazily-filled module `let` that keeps the instanced billboard program, the
 * R-32 appearance program, the trail program, and their two batch caches out
 * of every bundle that never draws a `ParticleRenderable`.
 *
 * The sixth application of the seam `gl-skinning-registry.ts` states in full
 * (pipeline-cost law, R-6): `WebglRenderer` imports **this** module — one
 * `let`, three functions, and the one eight-byte helper the draw loop shares
 * with the batch cache — and never `gl-particles.ts`'s classes; an
 * application opts in with
 *
 * ```ts
 * import { registerParticlePipeline } from "@fourjs/render-webgl";
 * registerParticlePipeline();
 * ```
 *
 * which is what links the heavy module. The renderer resolves this slot on
 * the first particle item of a frame; a `null` answer skips the item with a
 * one-time §85 development warning naming the fix — absence, never a
 * stand-in, because a value must not become a different picture.
 *
 * `ParticleGlContext` and the two batch-cache classes are **type** imports
 * here: a type import is erased, so this module links nothing.
 */

import { PARTICLE_INSTANCE_FLOATS, type ParticleRenderItem } from "@fourjs/render";
import type { Matrix4 } from "@fourjs/math";

import type {
  ParticleBatchCache,
  ParticleGlContext,
  ParticleTrailBatchCache,
} from "./gl-particles.js";

/**
 * Instance stride in floats for `item` — 8 unless the emitter opted into
 * R-32's wide layout. Lives here rather than in `gl-particles.ts` because the
 * renderer's draw loop reads it to choose between the plain and the
 * appearance program, and a value import from the heavy module would link it.
 */
export function particleItemFloats(item: ParticleRenderItem): number {
  return item.instanceFloats ?? PARTICLE_INSTANCE_FLOATS;
}

/**
 * The surface the draw loop needs from the plain billboard program
 * (`ParticleProgram`) and the trail program (`ParticleTrailProgram`) — the
 * same three uploads, so one structural contract serves both.
 */
export interface ParticleBillboardPipeline {
  /** Makes this the current program. */
  use(): void;
  /** Uploads the camera's projection, once per view. */
  setProjection(matrix: Matrix4): void;
  /** Uploads the camera's view matrix, once per view. */
  setView(matrix: Matrix4): void;
  /** Uploads one system's world matrix. */
  setModel(matrix: Matrix4): void;
}

/**
 * The surface the draw loop needs from R-32's appearance program
 * (`ParticleAppearanceProgram`): the billboard contract plus its two feature
 * switches.
 */
export interface ParticleAppearancePipeline extends ParticleBillboardPipeline {
  /** Selects whether this draw samples the bound particle texture. */
  setUseMap(enabled: boolean): void;
  /** Selects the soft-particle depth comparison (off at this tier). */
  setSceneDepth(bound: boolean, width?: number, height?: number): void;
}

/**
 * One renderer's compiled particle programs and their per-context batch
 * caches — created lazily on the first particle draw, dropped on context
 * loss, disposed with the renderer.
 *
 * Only the plain billboard program compiles with the caches: the appearance
 * and trail programs are opt-in tiers (R-32; the trail tier) and compile on
 * the first item that needs them, through the two `acquire…` methods, each
 * behind its own fail-once latch so a refusing driver is asked exactly once
 * per context.
 */
export interface ParticlePrograms {
  /** The plain instanced billboard (§36). */
  readonly particle: ParticleBillboardPipeline;
  /** Per-system vertex arrays and instance buffers, keyed by item id. */
  readonly batches: ParticleBatchCache;
  /** Per-system trail vertex buffers, keyed by item id. */
  readonly trailBatches: ParticleTrailBatchCache;
  /**
   * R-32's appearance program, compiled on first call, or `null` when this
   * context refused it (latched; §61 — the caller falls back to the plain
   * program, as it always did). Never throws.
   */
  acquireAppearance(): ParticleAppearancePipeline | null;
  /**
   * The trail program, compiled on first call, or `null` when this context
   * refused it (latched; the trail is skipped, the billboards still draw).
   * Never throws.
   */
  acquireTrail(): ParticleBillboardPipeline | null;
  /** Deletes every program and both caches. Live context only; idempotent. */
  dispose(): void;
}

/**
 * What `registerParticlePipeline()` installs: a factory the renderer calls
 * **once per context, on the first particle item** — never at initialize,
 * so a scene with no particles issues the byte-identical GL sequence it
 * always did, and never per frame.
 */
export interface ParticlePipelineFactory {
  /**
   * Compiles the plain billboard program on `gl` and builds the two caches.
   * May throw `SHADER_COMPILATION_FAILED` (§89); the renderer catches it —
   * §61 forbids a frame from throwing — warns once, and draws no particles
   * on that context.
   */
  create(gl: ParticleGlContext): ParticlePrograms;
}

/** The slot. `null` until `registerParticlePipeline()` fills it. */
let particleFactory: ParticlePipelineFactory | null = null;

/**
 * Installs `factory` as the process's particle pipeline. Called by
 * `registerParticlePipeline()` (`gl-particles.ts`); replaces any previous
 * factory — renderers that already compiled keep their programs.
 */
export function setParticlePipelineFactory(
  factory: ParticlePipelineFactory,
): void {
  particleFactory = factory;
}

/**
 * The registered factory, or `null` — read by `WebglRenderer` on the first
 * particle item it meets. One function call; no allocation.
 */
export function resolveParticlePipelineFactory(): ParticlePipelineFactory | null {
  return particleFactory;
}

/**
 * Empties the slot — for tests that must exercise the unregistered path after
 * another suite registered (the `clearRegisteredSkinningPipeline` precedent).
 * Not an application API: an application with no particles simply never
 * registers.
 */
export function clearRegisteredParticlePipeline(): void {
  particleFactory = null;
}
