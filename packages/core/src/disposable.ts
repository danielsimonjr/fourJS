/**
 * Explicit disposal (§83).
 *
 * GPU and solver resources are explicitly disposable — textures, geometries,
 * materials, physics worlds, and the application itself all expose
 * `dispose()`. This module defines the shared interface and the batch helper
 * every owner uses to tear its children down.
 *
 * **This `Disposable` is fourJS's own, not TC39's.** The name is also a
 * TypeScript global — the explicit-resource-management protocol whose member is
 * `[Symbol.dispose]()`, reachable in any consumer whose `lib` includes
 * `ESNext.Disposable`. The two are unrelated. Reading `interface Renderer
 * extends Disposable` in a shipped declaration therefore invites implementing
 * `[Symbol.dispose]()`, which nothing in this repository calls; the member
 * every owner and {@link disposeAll} invoke is the plain `dispose()` declared
 * below. Implementing both is harmless, and implementing only `[Symbol.dispose]`
 * does not satisfy this interface. (Found 2026-09-19 from a consumer seat, by
 * an application writing its own renderer backend against `@fourjs/render`.)
 */

/**
 * A resource whose lifetime is owned explicitly (§83).
 *
 * **Not TC39's `Disposable`.** The member is the plain `dispose()` below, never
 * `[Symbol.dispose]()`. Implementing both is harmless; implementing only
 * `[Symbol.dispose]` does not satisfy this interface, and {@link disposeAll}
 * then throws `TypeError: item.dispose is not a function` — in a minified
 * build, with the parameter renamed and no §83 marker to search for.
 *
 * The warning is repeated on this symbol rather than left in the module header
 * above, because the header does not travel: measured 2026-09-19 from an
 * installed tarball with the TypeScript API, the documentation attached to
 * this symbol — what an editor shows a consumer who hovers `Disposable` — was
 * the one-line summary alone. A collision note one file away from the name it
 * is about is a note nobody reads.
 */
export interface Disposable {
  dispose(): void;
}

/**
 * Disposes `items` in **reverse insertion order**: teardown mirrors
 * construction, so a resource is always disposed before whatever it was built
 * on top of (a render target before its device, a joint before its bodies).
 * Owners therefore only have to record acquisitions in order.
 *
 * Every item is disposed even if an earlier one throws — a failed dispose must
 * not leak the resources behind it (§83). If any `dispose()` threw, the first
 * thrown value is re-thrown after the pass completes. "First" is first **in
 * reverse order**, so for `[a, b, c]` where `b` and `c` both throw, the value
 * re-thrown is `c`'s.
 *
 * An entry that is not disposable at all — `null`, `undefined`, or an object
 * carrying only `[Symbol.dispose]` — is treated exactly like a throwing
 * disposer: the `TypeError` is captured, every remaining item is still
 * disposed, and the `TypeError` is re-thrown at the end. Calling this twice on
 * the same item calls `dispose()` twice; nothing here deduplicates, so an
 * implementation that is not idempotent must guard itself. All four behaviours
 * measured 2026-09-19 from an installed tarball.
 */
export function disposeAll(items: Iterable<Disposable>): void {
  const ordered = [...items].reverse();
  let firstFailure: unknown;
  let failed = false;
  for (const item of ordered) {
    try {
      item.dispose();
    } catch (error) {
      if (!failed) {
        failed = true;
        firstFailure = error;
      }
    }
  }
  if (failed) {
    throw firstFailure;
  }
}
