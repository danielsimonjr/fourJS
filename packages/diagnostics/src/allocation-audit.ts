/**
 * §83's "excessive per-frame allocations" development warning (A-4/A-5,
 * 2026-09-06).
 *
 * `@fourjs/math`'s {@link @fourjs/math!constructionCount | constructionCount} is
 * the instrument benchmarks use to prove zero steady-state allocation (§7b).
 * This module turns two readings of that counter into a one-time warning —
 * the same opt-in, caller-driven shape as {@link auditResourceLeaks}:
 *
 * ```ts
 * import { constructionCount, resetConstructionCount } from "@fourjs/math";
 * import { auditFrameAllocations } from "@fourjs/diagnostics";
 *
 * resetConstructionCount();
 * warmUp();
 * const before = constructionCount();
 * simulateOneFrame();
 * auditFrameAllocations(before, constructionCount(), { label: "simulate" });
 * ```
 *
 * Nothing runs unless you call it, and production builds return
 * {@link NO_FRAME_ALLOCATIONS} without touching the arguments.
 */

import { DEV, devWarnOnce } from "@fourjs/core";

/** What grew across the audited span. */
export interface FrameAllocationReport {
  /** `true` when {@link FrameAllocationReport.constructed} exceeds the threshold. */
  readonly excessive: boolean;
  /** Math objects constructed during the span (`after - before`, clamped at zero). */
  readonly constructed: number;
  /**
   * The warning text, or `""` when nothing exceeded the threshold. Whether it
   * printed is {@link AuditFrameAllocationsOptions.warn}'s business.
   */
  readonly message: string;
}

/** Options for {@link auditFrameAllocations}. */
export interface AuditFrameAllocationsOptions {
  /**
   * What the audited span was — quoted in the message and used as the
   * deduplication key. Defaults to `"this frame"`.
   */
  readonly label?: string;
  /**
   * How many {@link @fourjs/math!constructionCount | constructionCount}
   * constructions are allowed before warning. Defaults to `0` — steady-state
   * engine code should allocate none (§7b).
   */
  readonly threshold?: number;
  /**
   * Set `false` to compute the report without printing. Defaults to `true`.
   */
  readonly warn?: boolean;
}

/** The report a clean span produces, and the one production always returns. */
export const NO_FRAME_ALLOCATIONS: FrameAllocationReport = Object.freeze({
  excessive: false,
  constructed: 0,
  message: "",
});

/** `after - before`, never below zero. */
function grew(before: number, after: number): number {
  const difference = after - before;
  return difference > 0 ? difference : 0;
}

/**
 * Compares two {@link @fourjs/math!constructionCount | constructionCount}
 * readings and reports — and by default warns once — when the span allocated
 * more math objects than the threshold allows.
 *
 * Development-only: returns {@link NO_FRAME_ALLOCATIONS} when `DEV` is `false`.
 */
export function auditFrameAllocations(
  before: number,
  after: number,
  options: AuditFrameAllocationsOptions = {},
): FrameAllocationReport {
  if (!DEV) return NO_FRAME_ALLOCATIONS;

  const threshold = options.threshold ?? 0;
  const constructed = grew(before, after);
  if (constructed <= threshold) {
    return NO_FRAME_ALLOCATIONS;
  }

  const label = options.label ?? "this frame";
  // Plain "math object(s)": a runtime message must never name a WORKSPACE
  // package. A consumer installs the published names, so the workspace name of
  // the math package is one they cannot install — and this string reached them,
  // measured 2026-09-19 from a consumer seat in Node and in Chrome, where
  // importing that workspace name fails with ERR_MODULE_NOT_FOUND. Same defect
  // class as the render-webgl finding of 2026-09-13. The sibling
  // `warnPerFrameAllocations` in `dev-warnings.ts` already words it this way,
  // and `tools/apply-publish-names.mjs` now fails a staging run that reverts it.
  // "During <label>" alone reads as an accusation against <label>. It is not
  // one: the label names the measurement WINDOW, and `constructed` is the math
  // package's process-wide construction delta sampled across it — so every
  // allocation any code made while the window was open lands in this number,
  // the caller's own `fixedUpdate` included. Dogfood cycle 9C read the old
  // wording as "the engine is warning about itself" and filed a tracker item
  // on it; cycle 10C measured the opposite (alloc-0 in the window is silent,
  // four `new Vector3` in the consumer's own update reproduce the string
  // exactly). The message now separates the two so a reader knows where to
  // look.
  const message =
    `§83: ${String(constructed)} math object(s) were constructed while ` +
    `"${label}" was running (threshold ${String(threshold)}). "${label}" is ` +
    "the measurement window, not necessarily the allocator: the count is " +
    "every math object constructed anywhere in the process during it, " +
    "including the application's own code. Steady-state per-frame code " +
    "should reuse out-parameters and pooled buffers (§7b).";

  if (options.warn !== false) {
    devWarnOnce(`per-frame-alloc:${label}`, message);
  }

  return { excessive: true, constructed, message };
}
