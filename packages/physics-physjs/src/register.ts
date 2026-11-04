/**
 * This package's opt-in to §37's solver registry (RFC 0010, decision 3).
 *
 * Mirrors `registerRapierSolver`: an explicit call, never an import side
 * effect (`"sideEffects": false`). `"physjs"` registered after the others sits
 * last in the `"auto"` order, so no existing world changes solver.
 */

import {
  registerSolver,
  type PhysicsWorldAdapter,
  type PhysicsWorldOptions,
  type SolverRegistry,
} from "@fourjs/physics";

import { PhysJSAdapter2D, PhysJSAdapter3D } from "./physjs-adapter.js";

/** PhysJS is pure TypeScript: it can run wherever the engine does. */
export function isPhysJSSupported(options?: PhysicsWorldOptions): boolean {
  void options;
  return true;
}

/** Builds the adapter for `options.dimension` (§21, §37). */
export function createPhysJSAdapter(
  options: PhysicsWorldOptions,
): PhysicsWorldAdapter {
  return options.dimension === "2d"
    ? new PhysJSAdapter2D()
    : new PhysJSAdapter3D();
}

/**
 * Registers PhysJS so `solver: "physjs"` and `solver: "auto"` can find it, and
 * returns the registry it went into. Re-registering is a no-op.
 */
export function registerPhysJSSolver(
  registry?: SolverRegistry,
): SolverRegistry {
  return registerSolver(
    {
      name: "physjs",
      isSupported: isPhysJSSupported,
      create: createPhysJSAdapter,
    },
    registry,
  );
}
