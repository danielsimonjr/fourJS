/**
 * This package's opt-in to §37's solver registry (PH-19).
 *
 * `@fourjs/physics` holds the registry and knows no solver; this module is the
 * one place that names both, and it lives here — below the stable API, above
 * nothing — because that is the only direction the frozen §3.1 matrix allows
 * (`physics-rapier` already depends on `physics`; no edge is added).
 *
 * ```ts
 * import { registerRapierSolver } from "@fourjs/physics-rapier";
 *
 * registerRapierSolver();
 * const world = new PhysicsWorld({ dimension: "3d", solver: "auto" });
 * await world.initialize();
 * ```
 *
 * ## One registration, both §21 dimensions
 *
 * Rapier ships as two npm packages with two wasm images and this package wraps
 * each in its own adapter, but §37 selects a *solver*, not a build: `"rapier"`
 * is one name, and the dimension is a property of the world asking. So the
 * single registration's `create` reads `options.dimension` and constructs
 * {@link Rapier2dAdapter} or {@link Rapier3dAdapter} accordingly — which is
 * exactly the capability-driven choice §37 describes, made at the only point
 * where the answer is known.
 *
 * Neither wasm image is loaded here. A constructor allocates nothing but the
 * adapter; `PhysicsWorld.initialize` awaits `adapter.initialize`, and that is
 * where `init.ts`'s per-dimension load happens — so registering both
 * dimensions still decodes only the one a world actually uses.
 *
 * ## Why this is a function call and not an import side effect
 *
 * `@fourjs/physics-rapier` declares `"sideEffects": false`, so a bundler may
 * delete an import whose bindings are unused; a side-effect registration
 * module would be dropped and `solver: "auto"` would then fail at runtime with
 * "nothing is registered". `@fourjs/render`'s `renderer-registry.ts` carries the
 * full argument — this is the same decision, taken once for both tiers.
 *
 * The module is separate from the adapters for the mirror-image reason: a
 * program that constructs `new Rapier3dAdapter()` itself must not pay for the
 * registry, and a module it never imports costs it nothing.
 */

import {
  registerSolver,
  type PhysicsWorldAdapter,
  type PhysicsWorldOptions,
  type SolverRegistry,
} from "@fourjs/physics";

import { Rapier2dAdapter } from "./rapier2d-adapter.js";
import { Rapier3dAdapter } from "./rapier3d-adapter.js";

/**
 * Whether this environment could run Rapier at all — the cheap pre-filter
 * `"auto"` uses before it constructs anything (§37).
 *
 * Rapier is WebAssembly, and `@dimforge/rapier{2,3}d-compat` carries its image
 * inline, so the one thing that can make it impossible here is a runtime with
 * no `WebAssembly` global — an old engine, or a host that has removed it under
 * a §96-style policy. Everything else that can go wrong (a failed
 * instantiation, an out-of-memory decode) surfaces from
 * `PhysicsWorld.initialize`, which is where §37 puts the load.
 *
 * `options` is unread: Rapier's availability does not depend on the world.
 */
export function isRapierSupported(options?: PhysicsWorldOptions): boolean {
  // Accepted to satisfy `SolverRegistration.isSupported` and deliberately
  // unread: Rapier's availability does not depend on the world.
  void options;
  // Read through `globalThis` so this package needs no host lib for the
  // probe (the workspace pins `lib: ["ES2022"]`; DOM-free is enforced, not
  // assumed — 2026-09-11).
  return (
    typeof (globalThis as { WebAssembly?: unknown }).WebAssembly !==
    "undefined"
  );
}

/**
 * Builds the Rapier adapter for `options.dimension` (§21, §37) —
 * {@link Rapier2dAdapter} for `"2d"`, {@link Rapier3dAdapter} for `"3d"` —
 * without loading either wasm image.
 */
export function createRapierAdapter(
  options: PhysicsWorldOptions,
): PhysicsWorldAdapter {
  return options.dimension === "2d"
    ? new Rapier2dAdapter()
    : new Rapier3dAdapter();
}

/**
 * Registers Rapier so `solver: "auto"` and `solver: "rapier"` can find it
 * (§20, §37), and returns the registry it went into.
 *
 * Call it once, before constructing the world. Pass a `registry` to keep the
 * registration out of the shared one — the discipline the tests use so that
 * one test's solvers are invisible to the next.
 *
 * @throws FourError `INVALID_APPLICATION_STATE` if a `"rapier"` solver is
 * already registered in that registry (§37: selection must not depend on
 * import order).
 */
export function registerRapierSolver(
  registry?: SolverRegistry,
): SolverRegistry {
  return registerSolver(
    {
      name: "rapier",
      isSupported: isRapierSupported,
      create: createRapierAdapter,
    },
    registry,
  );
}
