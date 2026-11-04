/**
 * This package's opt-in to §37's solver registry (W8.1).
 *
 * Mirrors `registerRapierSolver`: a function call rather than an import side
 * effect, because this package is `"sideEffects": false` and a bundler may drop
 * an import whose bindings are unused. Box2D is 2D-only, so `isSupported`
 * answers `false` for a `"3d"` world and `"auto"` skips it.
 */

import {
  registerSolver,
  type PhysicsWorldAdapter,
  type PhysicsWorldOptions,
  type SolverRegistry,
} from "@fourjs/physics";

import { Box2dAdapter } from "./box2d-adapter.js";

/**
 * Whether Box2D can simulate `options`: it is pure JavaScript (no wasm), so the
 * only question is the dimension. With no options the answer is `true`.
 */
export function isBox2dSupported(options?: PhysicsWorldOptions): boolean {
  return options === undefined || options.dimension === "2d";
}

/** Builds a {@link Box2dAdapter}; allocates no Box2D world until `initialize`. */
export function createBox2dAdapter(
  options: PhysicsWorldOptions,
): PhysicsWorldAdapter {
  void options;
  return new Box2dAdapter();
}

/**
 * Registers Box2D so `solver: "box2d"` (and `"auto"` for 2D worlds) can find it
 * (§20, §37), and returns the registry it went into.
 *
 * @throws FourError `INVALID_APPLICATION_STATE` if a `"box2d"` solver is already
 * registered in that registry (§37).
 */
export function registerBox2dSolver(registry?: SolverRegistry): SolverRegistry {
  return registerSolver(
    {
      name: "box2d",
      isSupported: isBox2dSupported,
      create: createBox2dAdapter,
    },
    registry,
  );
}
