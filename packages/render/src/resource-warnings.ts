/**
 * §83's "disposed resource still in use" development warning (A-4/A-5).
 *
 * Backends skip draws whose geometry, texture, or render target has been
 * released; this module is the one-time author-facing explanation of that
 * skip. Call sites live in renderer caches and frame entry points — never in
 * simulation packages (§33).
 */

import { DEV, devWarnOnce } from "@fourjs/core";

/** Resource kinds this warning names today. */
export type DisposedResourceKind = "geometry" | "texture" | "render-target";

/**
 * Warns once that a disposed resource is still referenced (§83).
 *
 * A no-op in production builds. Prefer `if (DEV) warnDisposedInUse(…)` when
 * the `id` string must be formatted.
 */
export function warnDisposedInUse(
  kind: DisposedResourceKind,
  id: string,
): void {
  if (!DEV) return;
  devWarnOnce(
    `disposed-in-use:${kind}:${id}`,
    `§83: ${kind} "${id}" was disposed but is still referenced; draws that ` +
      "need it are skipped rather than painting undefined content.",
  );
}
