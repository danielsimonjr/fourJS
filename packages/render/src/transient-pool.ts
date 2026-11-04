/**
 * §63 transient render targets: the pool seam, the lifetime/aliasing planner,
 * and the usage-transition list (W6.1, 2026-11-04).
 *
 * A graph pass may declare a **transient** output ({@link TransientTargetSpec})
 * instead of an application-owned {@link RenderTarget}. The graph computes each
 * transient's lifetime — from the pass that produces it to the last pass that
 * consumes it through a declared `inputs` entry — and {@link planTransientSlots}
 * assigns **physical slots** by deterministic first-fit in declaration order
 * (§33): a slot is reused by a later transient with the same
 * {@link TransientTargetKey} once the earlier occupant's last consumer has run.
 * Two transients whose lifetimes overlap — including a producer that reads the
 * very pass it would alias — never share a slot.
 *
 * The physical allocation goes through {@link TransientTargetPool}, a seam this
 * package defines and each backend implements (`Renderer.transientTargetPool`):
 * a pool needs the allocator, and the backend owns it. {@link RenderTargetPool}
 * is the shared implementation (ordinary {@link RenderTarget}s the backend
 * allocates lazily on first draw, exactly as for application targets), which
 * the backends specialise with their usage / assertion hooks.
 *
 * Application-owned targets are untouched: a graph with no transient never
 * touches a pool and produces byte-identical renderer calls.
 */

import { FourError } from "@fourjs/core";

import { RenderTarget, type RenderTargetFormat } from "./render-target.js";

/** Shape of a transient output. Fixed size, or relative to the view. */
export type TransientTargetSpec =
  | {
      readonly width: number;
      readonly height: number;
      readonly format?: RenderTargetFormat;
      readonly depth?: boolean;
      readonly depthTexture?: boolean;
    }
  | {
      /** Fraction of the view size handed to `RenderGraph.execute` (1 = full). */
      readonly scale: number;
      readonly format?: RenderTargetFormat;
      readonly depth?: boolean;
      readonly depthTexture?: boolean;
    };

/** The pool key: two transients with equal keys may alias one slot. */
export interface TransientTargetKey {
  readonly width: number;
  readonly height: number;
  readonly format: RenderTargetFormat;
  readonly depth: boolean;
  readonly depthTexture: boolean;
}

/** How a physical slot is used over a frame (what backends allocate for). */
export interface TransientTargetUsage {
  /** Some pass samples this slot as a texture. */
  readonly sampled: boolean;
  /** Some pass draws into this slot as an attachment (always true). */
  readonly attachment: boolean;
}

/** One pass's declared resource use, from the graph's usage plan. */
export interface PassUsageRecord {
  readonly pass: string;
  readonly index: number;
  /** Ids of targets this pass samples as textures (declared inputs). */
  readonly reads: readonly string[];
  /** Id of the target this pass draws into, or `null` (screen / unknown). */
  readonly writes: string | null;
}

/** A usage change of one target between two consecutive uses. */
export interface UsageTransition {
  /** The pass whose use causes the transition. */
  readonly pass: string;
  /** Target id. */
  readonly target: string;
  readonly from: "none" | "attachment" | "texture";
  readonly to: "attachment" | "texture";
}

/**
 * Backend-owned allocator for transient targets (§63, §83).
 *
 * `acquire` returns a target of exactly `key`'s shape, reusing a released one
 * when possible (no allocation in steady state); `release` returns it to the
 * free list; `dispose` destroys every target the pool ever made.
 */
export interface TransientTargetPool {
  acquire(key: TransientTargetKey, usage: TransientTargetUsage): RenderTarget;
  release(target: RenderTarget): void;
  /** Bytes held by every live pooled target, in use or free (§83). */
  readonly byteLength: number;
  /** Called once per executed pass with that pass's usage (assertion hook). */
  beginPass?(record: PassUsageRecord): void;
  dispose(): void;
}

/** Stable string form of a key; the free-list index. */
export function transientKeyString(key: TransientTargetKey): string {
  return (
    `${String(key.width)}x${String(key.height)}:${key.format}` +
    `:d${key.depth ? "1" : "0"}t${key.depthTexture ? "1" : "0"}`
  );
}

/** A transient request as the planner sees it. */
export interface TransientRequest {
  readonly name: string;
  readonly key: TransientTargetKey;
  /** Index of the producing pass. */
  readonly first: number;
  /** Index of the last consuming pass (>= first). */
  readonly last: number;
}

/** One physical slot of a plan. */
export interface TransientSlot {
  readonly index: number;
  readonly key: TransientTargetKey;
  /** Names of the transients aliased onto this slot, in declaration order. */
  readonly names: readonly string[];
}

/**
 * Deterministic first-fit slot assignment (§33). Requests are processed in the
 * order given (declaration order); each takes the lowest-numbered slot of equal
 * key whose occupant's `last` is strictly before this request's `first`.
 *
 * @returns the slots, and `assignment` mapping each request name to its slot.
 */
export function planTransientSlots(requests: readonly TransientRequest[]): {
  readonly slots: readonly TransientSlot[];
  readonly assignment: ReadonlyMap<string, number>;
} {
  const slots: {
    key: TransientTargetKey;
    names: string[];
    busyUntil: number;
  }[] = [];
  const assignment = new Map<string, number>();
  for (const request of requests) {
    const keyString = transientKeyString(request.key);
    let chosen = -1;
    for (const [index, slot] of slots.entries()) {
      if (
        transientKeyString(slot.key) === keyString &&
        slot.busyUntil < request.first
      ) {
        chosen = index;
        break;
      }
    }
    if (chosen === -1) {
      chosen = slots.length;
      slots.push({ key: request.key, names: [], busyUntil: -1 });
    }
    slots[chosen].names.push(request.name);
    slots[chosen].busyUntil = request.last;
    assignment.set(request.name, chosen);
  }
  return {
    slots: slots.map((slot, index) => ({
      index,
      key: slot.key,
      names: slot.names,
    })),
    assignment,
  };
}

/** Validates and resolves a spec to a key; `viewSize` is needed for `scale`. */
export function resolveTransientSpec(
  spec: TransientTargetSpec,
  viewSize: { readonly width: number; readonly height: number } | undefined,
  passName: string,
  errorCode: "INVALID_RENDER_GRAPH",
): TransientTargetKey {
  let width: number;
  let height: number;
  if ("scale" in spec) {
    if (!(spec.scale > 0) || !Number.isFinite(spec.scale)) {
      throw new FourError(
        errorCode,
        `RenderGraph pass ${JSON.stringify(passName)}: transient scale must be a positive finite number (§63).`,
        { context: { name: passName, scale: spec.scale } },
      );
    }
    if (viewSize === undefined) {
      throw new FourError(
        errorCode,
        `RenderGraph pass ${JSON.stringify(passName)} declares a view-relative transient, but no view size was given to execute()/compile() (§63).`,
        { context: { name: passName } },
      );
    }
    width = Math.max(1, Math.round(viewSize.width * spec.scale));
    height = Math.max(1, Math.round(viewSize.height * spec.scale));
  } else {
    width = spec.width;
    height = spec.height;
  }
  const depthTexture = spec.depthTexture ?? false;
  return {
    width,
    height,
    format: spec.format ?? "rgba8",
    depth: (spec.depth ?? true) || depthTexture,
    depthTexture,
  };
}

/**
 * The shared pool: plain {@link RenderTarget}s with per-key free lists.
 * Backends subclass it to add their usage/assertion hooks.
 */
export class RenderTargetPool implements TransientTargetPool {
  readonly #free = new Map<string, RenderTarget[]>();

  readonly #all = new Set<RenderTarget>();

  readonly #keys = new Map<RenderTarget, string>();

  /** Number of targets this pool has ever allocated (for tests / stats). */
  allocations = 0;

  acquire(key: TransientTargetKey, usage: TransientTargetUsage): RenderTarget {
    const keyString = transientKeyString(key);
    const free = this.#free.get(keyString);
    const reused = free?.pop();
    if (reused !== undefined && !reused.disposed) {
      this.onAcquire(reused, key, usage);
      return reused;
    }
    const target = new RenderTarget({
      width: key.width,
      height: key.height,
      format: key.format,
      depth: key.depth,
      depthTexture: key.depthTexture,
    });
    this.allocations += 1;
    this.#all.add(target);
    this.#keys.set(target, keyString);
    this.onAcquire(target, key, usage);
    return target;
  }

  release(target: RenderTarget): void {
    const keyString = this.#keys.get(target);
    if (keyString === undefined || target.disposed) {
      return;
    }
    let free = this.#free.get(keyString);
    if (free === undefined) {
      free = [];
      this.#free.set(keyString, free);
    }
    if (!free.includes(target)) {
      free.push(target);
    }
  }

  get byteLength(): number {
    let total = 0;
    for (const target of this.#all) {
      total += target.byteLength;
    }
    return total;
  }

  dispose(): void {
    for (const target of this.#all) {
      target.dispose();
    }
    this.#all.clear();
    this.#free.clear();
    this.#keys.clear();
  }

  /** Subclass hook, called for every acquire (fresh or reused). */
  protected onAcquire(
    _target: RenderTarget,
    _key: TransientTargetKey,
    _usage: TransientTargetUsage,
  ): void {}
}
