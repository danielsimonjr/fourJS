/**
 * The §37 solver registry — how `solver: "auto"` becomes an adapter without
 * `@fourjs/physics`, or the `four` umbrella, ever importing a solver (PH-19).
 *
 * §37 says *"capability declarations drive `solver: "auto"` selection (§20)"*,
 * and §45's application options show the shape a user writes:
 * `physics: { solver: "rapier", dimension: "3d" }`. What §20 has said since
 * revision 1.7 is why it did not exist: *"the world takes an adapter instance;
 * the `solver: "auto"` string form of §37's capability-driven selection is
 * deferred to the same registry work as `renderer: "auto"` (§97a)."*
 *
 * This is that work, and it is the exact mirror of `@fourjs/render`'s
 * `renderer-registry.ts` — deliberately, because the two affordances were
 * filed as one design (gap analysis `A-8` / `R-2` / `PH-19`). Read that module
 * first: everything it says about why the dependency is inverted, why
 * registration is an explicit call and never an import side effect, and why
 * {@link resolveSolver} does not mention {@link SolverRegistry}, applies here
 * word for word. The §3.1 matrix is untouched: `physics-rapier` already
 * depends on `physics`, and nothing here names a solver.
 *
 * ```ts
 * import { registerRapierSolver } from "@fourjs/physics-rapier";
 *
 * registerRapierSolver();
 * const world = new PhysicsWorld({ dimension: "3d", solver: "auto" });
 * await world.initialize();
 * ```
 *
 * ## Three differences from the renderer registry, all forced by §37
 *
 * 1. **Selection is synchronous.** `PhysicsWorld`'s constructor validates the
 *    adapter's capabilities (§21, §33) and is not async; building an adapter
 *    is likewise synchronous — a WebAssembly solver loads its module in
 *    `initialize` (plan P5-1), not in its constructor. So
 *    {@link SolverRegistry.resolve} returns an adapter, not a promise, and the
 *    world can resolve `solver` where it already resolves everything else.
 * 2. **`"auto"` filters on §37 capabilities, not on an initialization
 *    attempt.** A renderer only discovers it cannot run by trying; an adapter
 *    publishes `capabilities` before `initialize` and the answer is exact. So
 *    `"auto"` picks the first registered solver that declares the world's
 *    `dimension` and can reach its `determinism` tier — which is precisely
 *    what §37 means by capability-driven.
 * 3. **The order is registration order.** §62 fixes a preference for renderers
 *    (WebGPU → WebGL 2 → 2D); §37 fixes none for solvers, and inventing one
 *    would be this module editorialising over the specification. Registration
 *    order is the application's own stated preference, and it is stable, which
 *    is what §33 needs.
 *
 * An explicitly named solver is **not** capability-filtered here. It is handed
 * straight back, so an unsatisfiable request fails in `PhysicsWorld`'s
 * constructor with the precise §21/§33 message that already exists there
 * ("adapter X declares dimensions [2d] and cannot simulate a 3d world") rather
 * than with a vaguer one from this file. That is §62's fail-fast rule applied
 * to solvers: naming a solver means it must work.
 */

import { FourError } from "@fourjs/core";

import type { PhysicsSolverAdapter } from "./adapter.js";
import type { PhysicsWorldOptions } from "./descriptors.js";
import type { DeterminismLevel } from "./types.js";
import { DEFAULT_DETERMINISM_LEVEL, DETERMINISM_LEVELS } from "./types.js";
// Type-only, and therefore erased: `world.ts` imports this module's
// `resolveSolver` at runtime, so a value import back would be a cycle. What a
// registration builds is a *world* adapter — §37's contract plus the
// per-handle `SolverBodyAccess` a world needs — which is the type `world.ts`
// already names.
import type { PhysicsWorldAdapter } from "./world.js";

/**
 * The solver packages §102 names, as selection strings.
 *
 * Closed, like `RendererBackend` (§62) and `ShippedJointType` (§28): a typo is
 * a compile error rather than an empty registry at runtime. A solver outside
 * §102 is added the same way a sixth rendering backend would be — by widening
 * this union in a packet that also has a reason to.
 */
export type SolverName = "rapier" | "box2d" | "soft";

/** What a world may ask for (§20, §37): `"auto"`, or one solver by name. */
export type SolverSelection = "auto" | SolverName;

/**
 * How a solver package opts into selection — everything the registry needs to
 * decide whether a solver fits, and how to build it.
 */
export interface SolverRegistration {
  /** Which §102 solver this builds. One registration per name per registry. */
  readonly name: SolverName;

  /**
   * A **cheap, side-effect-free** answer to "could this environment run this
   * solver at all?" — the presence of WebAssembly, of a native binding, of
   * `SharedArrayBuffer`.
   *
   * Not the capability check: `"auto"` reads §37's `capabilities` off the
   * adapter this registration builds, which is exact and needs no probe. This
   * one only exists so a solver that cannot possibly load is skipped before it
   * is constructed.
   */
  isSupported(options: PhysicsWorldOptions): boolean;

  /**
   * Constructs an adapter for `options` — in particular for its
   * `dimension`, which is how one registration serves both §21 dimensions
   * (Rapier ships a separate 2D and 3D wasm build and a separate adapter for
   * each).
   *
   * Must not initialize it: `PhysicsWorld.initialize` awaits
   * `adapter.initialize` (§37), and a solver built here may never be used if
   * `"auto"` rejects its capabilities.
   */
  create(options: PhysicsWorldOptions): PhysicsWorldAdapter;
}

/** Why `"auto"` moved past a registered solver (§37). */
export type SolverRejectionReason =
  /** {@link SolverRegistration.isSupported} answered `false`. */
  | "unsupported"
  /** The adapter does not declare the world's §21 `dimension`. */
  | "dimension"
  /** The adapter's §33 determinism tier is weaker than the world asked for. */
  | "determinism";

/** One solver `"auto"` passed over, as {@link SolverResolveOptions.onReject} sees it. */
export interface SolverRejectionReport {
  /** The solver that was not used. */
  readonly name: SolverName;
  /** Why it was not used. */
  readonly reason: SolverRejectionReason;
}

/** {@link PhysicsWorldOptions} plus the §37 rejection report. */
export interface SolverResolveOptions extends PhysicsWorldOptions {
  /**
   * Called once per solver `"auto"` skips, in registration order — the
   * solver-side twin of §62's fallback diagnostics event, and a callback for
   * the same reason: the frozen §3.1 matrix gives `@fourjs/physics` no
   * `@fourjs/diagnostics` edge.
   *
   * Never called for an explicitly named solver, which is handed back
   * unfiltered so the world reports the mismatch itself.
   */
  onReject?: (report: SolverRejectionReport) => void;
}

/** §89's code for selection failures; the world uses the same one (§85). */
const SELECTION_ERROR_CODE = "INVALID_APPLICATION_STATE";

/** Renders a solver list for the §85 failure messages. */
function describeSolvers(names: readonly SolverName[]): string {
  return names.length === 0
    ? "none"
    : names.map((name) => JSON.stringify(name)).join(", ");
}

/**
 * Whether `adapter` can simulate a world built with `options` — §37's
 * capability declaration, read as `"auto"` reads it.
 *
 * Exactly the two checks `PhysicsWorld`'s constructor performs (§21 dimension,
 * §33 determinism tier), answered here as a reason rather than as a throw so
 * the walk can move on and report.
 */
function rejectionFor(
  adapter: PhysicsSolverAdapter,
  options: PhysicsWorldOptions,
): SolverRejectionReason | undefined {
  const capabilities = adapter.capabilities;
  if (!capabilities.dimensions.includes(options.dimension)) {
    return "dimension";
  }
  const determinism: DeterminismLevel =
    options.determinism ?? DEFAULT_DETERMINISM_LEVEL;
  if (
    DETERMINISM_LEVELS.indexOf(determinism) >
    DETERMINISM_LEVELS.indexOf(capabilities.determinism)
  ) {
    return "determinism";
  }
  return undefined;
}

/**
 * The solvers an application has opted into, and the §37 selection rule over
 * them (PH-19).
 *
 * Applications normally use the shared registry through
 * {@link registerSolver} and {@link resolveSolver}. Construct one directly to
 * keep a selection scope to itself — a test that must not see another test's
 * registrations, or a host running two engines:
 *
 * ```ts
 * const registry = new SolverRegistry();
 * registerRapierSolver(registry);
 * const world = new PhysicsWorld({ dimension: "2d", solver: "auto", solverRegistry: registry });
 * ```
 */
export class SolverRegistry {
  /** `Map` preserves insertion order, which is the `"auto"` order (§33). */
  readonly #entries = new Map<SolverName, SolverRegistration>();

  /**
   * Adds `registration`. Returns `this` so registrations chain.
   *
   * Re-adding the **identical** registration (same `isSupported` and `create`)
   * is a no-op and returns `this`, so calling `registerRapierSolver()` twice is
   * safe: nothing is overwritten and nothing about `"auto"` changes.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` if a *different* solver is
   * already registered under that name — a silent overwrite would make which
   * solver `"auto"` builds depend on module evaluation order, and a simulation
   * that changes solver for that reason is not reproducible (§33).
   */
  register(registration: SolverRegistration): this {
    const name = registration.name;
    const existing = this.#entries.get(name);
    if (existing !== undefined) {
      /*
       * Re-adding the identical registration is a no-op, not a conflict.
       *
       * The throw below exists to stop a silent *overwrite*: which solver `"auto"` builds
       * would then depend on module evaluation order, and a simulation that changes
       * solver for that reason is not reproducible (§33). Adding the same entry twice
       * overwrites nothing — the map holds the same registration, `solvers` keeps the
       * same order, and `"auto"` builds the same adapter — so none of that reasoning
       * applies to it.
       *
       * What it was catching instead was defensive code. `registerRapierSolver()` threw
       * if anything had already called it, so a component that merely wants the solver to
       * be available had to know whether someone else got there first — the opposite of
       * what a registry is for. Found by dogfooding.
       *
       * Compared by identity, deliberately. `registerRapierSolver()` builds a fresh
       * object literal per call, but `isSupported` and `create` are module-level
       * bindings, so two calls carry the same two function references. A registration
       * that would actually change what `"auto"` builds carries different ones and still
       * throws.
       */
      if (
        existing.isSupported === registration.isSupported &&
        existing.create === registration.create
      ) {
        return this;
      }
      throw new FourError(
        SELECTION_ERROR_CODE,
        `A ${JSON.stringify(name)} solver is already registered (§37); registering a second one would make selection depend on import order (§33). Unregister it first, or use a separate SolverRegistry.`,
        { context: { solver: name, registered: this.solvers } },
      );
    }
    this.#entries.set(name, registration);
    return this;
  }

  /** Removes `name`'s registration; `true` if there was one. */
  unregister(name: SolverName): boolean {
    return this.#entries.delete(name);
  }

  /** Whether `name` is registered. */
  has(name: SolverName): boolean {
    return this.#entries.has(name);
  }

  /** The registration for `name`, or `undefined`. */
  get(name: SolverName): SolverRegistration | undefined {
    return this.#entries.get(name);
  }

  /** Number of registered solvers. */
  get size(): number {
    return this.#entries.size;
  }

  /** The registered solvers, in registration order. */
  get solvers(): SolverName[] {
    return [...this.#entries.keys()];
  }

  /**
   * Builds the adapter `selection` names (§20, §37).
   *
   * **A named solver is handed back unfiltered**, so an unsatisfiable request
   * fails in `PhysicsWorld`'s constructor with its existing §21/§33 message
   * (see the module header). Only "not registered" and "cannot load here" are
   * refused from this file.
   *
   * **`"auto"` walks registration order** and takes the first solver that is
   * supported here and whose §37 capabilities cover the world's `dimension`
   * and `determinism`. Every solver it passes over is reported through
   * {@link SolverResolveOptions.onReject}, and when none fits the throw names
   * each one and why — because "no solver was found" without that list is the
   * least actionable message this API could produce (§85).
   *
   * The adapter comes back **uninitialized**: `PhysicsWorld.initialize` awaits
   * `adapter.initialize` (§37), and that is where a wasm image loads.
   */
  resolve(
    selection: SolverSelection,
    options: SolverResolveOptions,
  ): PhysicsWorldAdapter {
    if (selection !== "auto") {
      return this.#resolveNamed(selection, options);
    }

    const reports: SolverRejectionReport[] = [];
    for (const [name, registration] of this.#entries) {
      if (!registration.isSupported(options)) {
        this.#report(reports, { name, reason: "unsupported" }, options);
        continue;
      }
      const adapter = registration.create(options);
      const reason = rejectionFor(adapter, options);
      if (reason === undefined) {
        return adapter;
      }
      // Built and rejected: release it rather than leave a solver object
      // holding whatever its constructor took (§83). A disposal that itself
      // fails must not mask the selection failure being reported.
      try {
        adapter.dispose();
      } catch {
        // Intentionally ignored: see above.
      }
      this.#report(reports, { name, reason }, options);
    }

    throw new FourError(
      SELECTION_ERROR_CODE,
      `solver: "auto" found no solver that can simulate a ${JSON.stringify(options.dimension)} world at determinism ${JSON.stringify(options.determinism ?? DEFAULT_DETERMINISM_LEVEL)} (§20, §37). Registered: ${describeSolvers(this.solvers)}.${
        reports.length === 0
          ? " Call a solver's register function — for example `registerRapierSolver()` from the physics-rapier package — before selecting by name."
          : ` Rejected: ${reports
              .map(
                (report) => `${JSON.stringify(report.name)} (${report.reason})`,
              )
              .join(", ")}.`
      }`,
      {
        context: {
          selection,
          dimension: options.dimension,
          determinism: options.determinism ?? DEFAULT_DETERMINISM_LEVEL,
          registered: this.solvers,
          rejected: reports.map((report) => ({
            solver: report.name,
            reason: report.reason,
          })),
        },
      },
    );
  }

  /** {@link SolverRegistry.resolve} for a named solver; the fail-fast half. */
  #resolveNamed(
    name: SolverName,
    options: SolverResolveOptions,
  ): PhysicsWorldAdapter {
    const registration = this.#entries.get(name);
    if (registration === undefined) {
      throw new FourError(
        SELECTION_ERROR_CODE,
        `No ${JSON.stringify(name)} solver is registered (§37). Registered: ${describeSolvers(this.solvers)}. A solver opts in only when the application calls its register function — for example \`registerRapierSolver()\` from the physics-rapier package.`,
        { context: { selection: name, registered: this.solvers } },
      );
    }
    if (!registration.isSupported(options)) {
      throw new FourError(
        SELECTION_ERROR_CODE,
        `The ${JSON.stringify(name)} solver is registered but reports that this environment cannot run it (§37). A named solver fails fast rather than downgrading; use solver: "auto" to fall back.`,
        { context: { selection: name, registered: this.solvers } },
      );
    }
    return registration.create(options);
  }

  /** Records a rejected solver and forwards it to the §37 report callback. */
  #report(
    reports: SolverRejectionReport[],
    report: SolverRejectionReport,
    options: SolverResolveOptions,
  ): void {
    reports.push(report);
    options.onReject?.(report);
  }
}

/**
 * The process-wide registry, created by the first {@link registerSolver} call
 * and `undefined` until then.
 *
 * A `let` rather than an eagerly constructed instance, so a program that never
 * selects a solver by name never references {@link SolverRegistry} and the
 * class leaves the bundle — see `@fourjs/render`'s `renderer-registry.ts` for
 * the full argument and the measurement.
 */
let sharedRegistry: SolverRegistry | undefined;

/**
 * Opts `registration` into the shared registry (or into `registry`), and
 * returns the registry it went into (§37).
 *
 * Called by a solver package's own `register…` function, which is what an
 * application calls.
 */
export function registerSolver(
  registration: SolverRegistration,
  registry?: SolverRegistry,
): SolverRegistry {
  const target = registry ?? (sharedRegistry ??= new SolverRegistry());
  target.register(registration);
  return target;
}

/**
 * The solvers registered in the shared registry (or in `registry`), in
 * registration order. Empty when nothing has registered.
 */
export function registeredSolvers(registry?: SolverRegistry): SolverName[] {
  return (registry ?? sharedRegistry)?.solvers ?? [];
}

/**
 * Empties the shared registry — a **test** affordance (§92); production code
 * that needs isolation constructs its own {@link SolverRegistry}.
 */
export function clearRegisteredSolvers(): void {
  sharedRegistry = undefined;
}

/**
 * Resolves `selection` against the shared registry (or `registry`) and returns
 * an **uninitialized** adapter (§20, §37).
 *
 * `PhysicsWorld` calls this for you when it is given `solver` instead of
 * `adapter`; call it directly to build an adapter for something other than a
 * world.
 *
 * @throws FourError `INVALID_APPLICATION_STATE` (§89) when no solver is
 * registered, when a named solver is not registered or reports itself
 * unusable, or when `"auto"` finds nothing whose §37 capabilities fit.
 */
export function resolveSolver(
  selection: SolverSelection,
  options: SolverResolveOptions,
  registry?: SolverRegistry,
): PhysicsWorldAdapter {
  const target = registry ?? sharedRegistry;
  if (target === undefined) {
    throw new FourError(
      SELECTION_ERROR_CODE,
      `Cannot resolve solver ${JSON.stringify(selection)}: no physics solver is registered (§37). A solver opts in only when the application calls its register function — for example \`registerRapierSolver()\` from the physics-rapier package — because \`the physics package\` never imports a solver itself (§20, §91). Passing a constructed adapter instead is always supported.`,
      { context: { selection, registered: [] } },
    );
  }
  return target.resolve(selection, options);
}
