/**
 * §83's development warnings (A-5 remainder, 2026-09-06).
 */

import { DEV, devWarnOnce } from "@fourjs/core";

export const DEFAULT_PER_FRAME_ALLOCATION_THRESHOLD = 0;

export function warnDisposedResourceInUse(
  resourceId: string,
  kind: string,
): boolean {
  if (!DEV) return false;
  return devWarnOnce(
    `disposed-in-use:${kind}:${resourceId}`,
    `§83: ${kind} "${resourceId}" was disposed but is still referenced; ` +
      "draws and uploads that meet it are skipped. Dispose upstream owners " +
      "or stop referencing the resource.",
  );
}

export function warnDetachedNodeListeners(
  nodeId: string,
  listenerCount: number,
): boolean {
  if (!DEV) return false;
  if (listenerCount <= 0) return false;
  return devWarnOnce(
    `detached-listeners:${nodeId}`,
    `§83: node "${nodeId}" was detached from the scene graph but still has ` +
      `${String(listenerCount)} event listener(s). Call removeAllListeners() ` +
      "during teardown, or the node will stay alive until every listener is " +
      "removed.",
  );
}

export function warnStalePhysicsHandle(
  handleKind: string,
  detail: string,
): boolean {
  if (!DEV) return false;
  return devWarnOnce(
    `stale-physics-handle:${handleKind}:${detail}`,
    `§83: a stale ${handleKind} physics handle was used (${detail}). Handles ` +
      "are valid only while the body is registered with the world that issued " +
      "them.",
  );
}

export function warnPerFrameAllocations(
  allocationDelta: number,
  label = "frame",
  threshold = DEFAULT_PER_FRAME_ALLOCATION_THRESHOLD,
): boolean {
  if (!DEV) return false;
  if (allocationDelta <= threshold) return false;
  return devWarnOnce(
    `per-frame-alloc:${label}`,
    `§83: ${String(allocationDelta)} math object(s) were constructed during ` +
      `"${label}" (threshold ${String(threshold)}). Steady-state engine code ` +
      "should allocate nothing per frame (§7b); reuse out-parameters and module " +
      "scratch instead.",
  );
}

export function beginFrameAllocationCheck(
  constructionCount: () => number,
): number {
  return constructionCount();
}

export function endFrameAllocationCheck(
  baseline: number,
  constructionCount: () => number,
  options: {
    readonly label?: string;
    readonly threshold?: number;
  } = {},
): number {
  if (!DEV) return 0;
  const delta = constructionCount() - baseline;
  warnPerFrameAllocations(
    delta,
    options.label ?? "frame",
    options.threshold ?? DEFAULT_PER_FRAME_ALLOCATION_THRESHOLD,
  );
  return delta;
}
