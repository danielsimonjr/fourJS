import { isFourError } from "@fourjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PhysicsWorld,
  SolverRegistry,
  clearRegisteredSolvers,
  registerSolver,
  registeredSolvers,
  resolveSolver,
  type PhysicsWorldOptions,
  type SolverName,
  type SolverRejectionReport,
} from "../src/index.js";
import { FakeSolverAdapter } from "./fake-adapter.js";

interface Entry {
  readonly name: SolverName;
  readonly supported?: boolean;
  readonly dimensions?: readonly ("2d" | "3d")[];
  readonly determinism?: "none" | "same-runtime" | "cross-platform";
  readonly failDispose?: boolean;
}

/**
 * Registers `entries` into a fresh registry, recording every adapter each one
 * builds so a test can assert both what was *chosen* and what was built and
 * thrown away.
 */
function withSolvers(entries: readonly Entry[]): {
  registry: SolverRegistry;
  built: Map<SolverName, FakeSolverAdapter>;
} {
  const registry = new SolverRegistry();
  const built = new Map<SolverName, FakeSolverAdapter>();
  for (const entry of entries) {
    registry.register({
      name: entry.name,
      isSupported: () => entry.supported ?? true,
      create: () => {
        const adapter = new FakeSolverAdapter({
          capabilities: {
            dimensions: [...(entry.dimensions ?? ["2d", "3d"])],
            determinism: entry.determinism ?? "same-runtime",
          },
        });
        if (entry.failDispose === true) {
          adapter.dispose = (): void => {
            throw new Error("dispose refused");
          };
        }
        built.set(entry.name, adapter);
        return adapter;
      },
    });
  }
  return { registry, built };
}

const options3d: PhysicsWorldOptions = { dimension: "3d" };

afterEach(() => {
  clearRegisteredSolvers();
});

describe("SolverRegistry bookkeeping", () => {
  it("re-registering the identical solver is a no-op, not a conflict (§37)", () => {
    const registry = new SolverRegistry();
    const isSupported = (): boolean => true;
    const create = (): FakeSolverAdapter => new FakeSolverAdapter();

    registry.register({ name: "rapier", isSupported, create });
    // The same descriptor again — what a second `registerRapierSolver()` produces, since
    // `isSupported` and `create` are module-level bindings and not fresh closures.
    expect(() =>
      registry.register({ name: "rapier", isSupported, create }),
    ).not.toThrow();

    // Registered once, so `"auto"` order and every §33 consequence are unchanged.
    expect(registry.solvers).toEqual(["rapier"]);
  });

  it("still refuses a DIFFERENT solver under a name already taken (§33)", () => {
    const registry = new SolverRegistry();
    registry.register({
      name: "rapier",
      isSupported: () => true,
      create: () => new FakeSolverAdapter(),
    });

    // Different function identities: this would REPLACE the entry, which is the case
    // §37's throw exists for — selection must not depend on module evaluation order.
    expect(() =>
      registry.register({
        name: "rapier",
        isSupported: () => true,
        create: () => new FakeSolverAdapter(),
      }),
    ).toThrow(/already registered/);
  });

  it("reports its solvers in registration order", () => {
    const { registry } = withSolvers([{ name: "box2d" }, { name: "rapier" }]);
    expect(registry.solvers).toEqual(["box2d", "rapier"]);
    expect(registry.size).toBe(2);
    expect(registry.has("rapier")).toBe(true);
    expect(registry.has("soft")).toBe(false);
    expect(registry.get("rapier")?.name).toBe("rapier");
    expect(registry.get("soft")).toBeUndefined();
  });

  it("refuses a second registration for one solver (§33)", () => {
    const { registry } = withSolvers([{ name: "rapier" }]);
    let thrown: unknown;
    try {
      registry.register({
        name: "rapier",
        isSupported: () => true,
        create: () => new FakeSolverAdapter(),
      });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isFourError(thrown)).toBe(true);
    if (isFourError(thrown)) {
      expect(thrown.code).toBe("INVALID_APPLICATION_STATE");
      expect(thrown.message).toContain("already registered");
      expect(thrown.context).toEqual({
        solver: "rapier",
        registered: ["rapier"],
      });
    }
  });

  it("unregisters, and chains registrations", () => {
    const registry = new SolverRegistry();
    const entry = {
      isSupported: () => true,
      create: () => new FakeSolverAdapter(),
    };
    expect(
      registry
        .register({ name: "rapier", ...entry })
        .register({ name: "soft", ...entry }),
    ).toBe(registry);
    expect(registry.unregister("box2d")).toBe(false);
    expect(registry.unregister("soft")).toBe(true);
    expect(registry.solvers).toEqual(["rapier"]);
  });
});

describe('resolve("auto") — §37 capability-driven selection', () => {
  it("takes the first registered solver that fits", () => {
    const { registry, built } = withSolvers([
      { name: "rapier" },
      { name: "box2d" },
    ]);
    const adapter = registry.resolve("auto", options3d);
    expect(adapter).toBe(built.get("rapier"));
    expect(built.has("box2d")).toBe(false);
  });

  it('accepts "physjs" (RFC 0010) and keeps it last when registered last', () => {
    const { registry, built } = withSolvers([
      { name: "rapier", dimensions: ["2d"] },
      { name: "physjs" },
    ]);
    expect(registry.solvers).toEqual(["rapier", "physjs"]);
    expect(registry.resolve("auto", options3d)).toBe(built.get("physjs"));
    expect(registry.resolve("physjs", options3d)).toBe(built.get("physjs"));
  });

  it("skips a solver that cannot run here at all", () => {
    const { registry, built } = withSolvers([
      { name: "rapier", supported: false },
      { name: "box2d" },
    ]);
    const rejected: SolverRejectionReport[] = [];
    const adapter = registry.resolve("auto", {
      ...options3d,
      onReject: (report) => rejected.push(report),
    });
    expect(adapter).toBe(built.get("box2d"));
    expect(built.has("rapier")).toBe(false);
    expect(rejected).toEqual([{ name: "rapier", reason: "unsupported" }]);
  });

  it("skips a solver whose §21 dimensions do not cover the world", () => {
    const { registry, built } = withSolvers([
      { name: "box2d", dimensions: ["2d"] },
      { name: "rapier" },
    ]);
    const rejected: SolverRejectionReport[] = [];
    const adapter = registry.resolve("auto", {
      ...options3d,
      onReject: (report) => rejected.push(report),
    });
    expect(adapter).toBe(built.get("rapier"));
    // Built, rejected, and released rather than left holding anything (§83).
    expect(built.get("box2d")?.disposed).toBe(true);
    expect(rejected).toEqual([{ name: "box2d", reason: "dimension" }]);
  });

  it("skips a solver whose §33 tier is weaker than the world asked for", () => {
    const { registry, built } = withSolvers([
      { name: "rapier", determinism: "same-runtime" },
      { name: "box2d", determinism: "cross-platform" },
    ]);
    const rejected: SolverRejectionReport[] = [];
    const adapter = registry.resolve("auto", {
      dimension: "3d",
      determinism: "cross-platform",
      onReject: (report) => rejected.push(report),
    });
    expect(adapter).toBe(built.get("box2d"));
    expect(rejected).toEqual([{ name: "rapier", reason: "determinism" }]);
  });

  it("accepts a solver stronger than the requested tier", () => {
    const { registry } = withSolvers([
      { name: "rapier", determinism: "cross-platform" },
    ]);
    expect(() =>
      registry.resolve("auto", { dimension: "2d", determinism: "none" }),
    ).not.toThrow();
  });

  it("keeps walking when a rejected solver also refuses to dispose (§83)", () => {
    const { registry, built } = withSolvers([
      { name: "box2d", dimensions: ["2d"], failDispose: true },
      { name: "rapier" },
    ]);
    expect(registry.resolve("auto", options3d)).toBe(built.get("rapier"));
  });

  it("names every rejection when nothing fits (§85)", () => {
    const { registry } = withSolvers([
      { name: "rapier", supported: false },
      { name: "box2d", dimensions: ["2d"] },
    ]);
    let thrown: unknown;
    try {
      registry.resolve("auto", options3d);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isFourError(thrown)).toBe(true);
    if (isFourError(thrown)) {
      expect(thrown.code).toBe("INVALID_APPLICATION_STATE");
      expect(thrown.message).toContain('Registered: "rapier", "box2d"');
      expect(thrown.message).toContain('"rapier" (unsupported)');
      expect(thrown.message).toContain('"box2d" (dimension)');
      expect(thrown.context).toMatchObject({
        dimension: "3d",
        determinism: "same-runtime",
        rejected: [
          { solver: "rapier", reason: "unsupported" },
          { solver: "box2d", reason: "dimension" },
        ],
      });
    }
  });

  it("says so when an empty registry is asked (§85)", () => {
    expect(() => new SolverRegistry().resolve("auto", options3d)).toThrow(
      /Registered: none.*registerRapierSolver/s,
    );
  });
});

describe("resolve(name) — the fail-fast half", () => {
  it("hands back a named solver without capability filtering", () => {
    // The world's own constructor reports the §21 mismatch, with its message.
    const { registry, built } = withSolvers([
      { name: "box2d", dimensions: ["2d"] },
    ]);
    expect(registry.resolve("box2d", options3d)).toBe(built.get("box2d"));
  });

  it("rejects an unregistered name, listing what is registered (§85)", () => {
    const { registry } = withSolvers([{ name: "rapier" }]);
    let thrown: unknown;
    try {
      registry.resolve("box2d", options3d);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isFourError(thrown)).toBe(true);
    if (isFourError(thrown)) {
      expect(thrown.message).toContain('No "box2d" solver is registered');
      expect(thrown.message).toContain('Registered: "rapier"');
      expect(thrown.context).toEqual({
        selection: "box2d",
        registered: ["rapier"],
      });
    }
  });

  it("rejects rather than downgrading when the named solver cannot run here", () => {
    const { registry } = withSolvers([
      { name: "rapier", supported: false },
      { name: "box2d" },
    ]);
    const onReject = vi.fn();
    expect(() =>
      registry.resolve("rapier", { ...options3d, onReject }),
    ).toThrow(/cannot run it/);
    expect(onReject).not.toHaveBeenCalled();
  });
});

describe("the shared registry", () => {
  it("is empty until something registers, and is emptied again", () => {
    expect(registeredSolvers()).toEqual([]);
    const registry = registerSolver({
      name: "rapier",
      isSupported: () => true,
      create: () => new FakeSolverAdapter(),
    });
    expect(registeredSolvers()).toEqual(["rapier"]);
    expect(registry.solvers).toEqual(["rapier"]);
    clearRegisteredSolvers();
    expect(registeredSolvers()).toEqual([]);
  });

  it("registers into an explicit registry when one is given", () => {
    const registry = new SolverRegistry();
    expect(
      registerSolver(
        {
          name: "rapier",
          isSupported: () => true,
          create: () => new FakeSolverAdapter(),
        },
        registry,
      ),
    ).toBe(registry);
    expect(registeredSolvers()).toEqual([]);
    expect(registeredSolvers(registry)).toEqual(["rapier"]);
  });
});

describe("resolveSolver", () => {
  it("resolves against the shared registry, and against an explicit one", () => {
    const shared = new FakeSolverAdapter();
    registerSolver({
      name: "rapier",
      isSupported: () => true,
      create: () => shared,
    });
    expect(resolveSolver("auto", options3d)).toBe(shared);

    const { registry, built } = withSolvers([{ name: "box2d" }]);
    expect(resolveSolver("auto", options3d, registry)).toBe(built.get("box2d"));
  });

  it("says nothing is registered before any solver opts in (§85)", () => {
    let thrown: unknown;
    try {
      resolveSolver("auto", options3d);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isFourError(thrown)).toBe(true);
    if (isFourError(thrown)) {
      expect(thrown.code).toBe("INVALID_APPLICATION_STATE");
      expect(thrown.message).toContain("no physics solver is registered");
      expect(thrown.message).toContain("registerRapierSolver()");
      expect(thrown.context).toEqual({ selection: "auto", registered: [] });
    }
  });
});

describe("PhysicsWorld solver selection (PH-19)", () => {
  it('builds its adapter from `solver: "auto"`', async () => {
    const { registry, built } = withSolvers([{ name: "rapier" }]);
    const world = new PhysicsWorld({
      dimension: "3d",
      solver: "auto",
      solverRegistry: registry,
    });
    expect(world.adapter).toBe(built.get("rapier"));
    // The registry hands back an *uninitialized* adapter; the world initializes
    // it exactly as it initializes one the application constructed (§37).
    expect(built.get("rapier")?.callsOf("initialize")).toHaveLength(0);
    await world.initialize();
    expect(built.get("rapier")?.callsOf("initialize")).toHaveLength(1);
  });

  it("builds its adapter from a named solver", () => {
    const { registry, built } = withSolvers([
      { name: "box2d" },
      { name: "rapier" },
    ]);
    const world = new PhysicsWorld({
      dimension: "2d",
      solver: "rapier",
      solverRegistry: registry,
    });
    expect(world.adapter).toBe(built.get("rapier"));
  });

  it("forwards the world options to the selection, and reports rejections", () => {
    const { registry, built } = withSolvers([
      { name: "box2d", dimensions: ["2d"] },
      { name: "rapier" },
    ]);
    const rejected: SolverRejectionReport[] = [];
    const world = new PhysicsWorld({
      dimension: "3d",
      determinism: "same-runtime",
      solver: "auto",
      solverRegistry: registry,
      onSolverReject: (report) => rejected.push(report),
    });
    expect(world.adapter).toBe(built.get("rapier"));
    expect(rejected).toEqual([{ name: "box2d", reason: "dimension" }]);
  });

  it("lets a named solver fail with the world's own §21 message", () => {
    const { registry } = withSolvers([{ name: "box2d", dimensions: ["2d"] }]);
    expect(
      () =>
        new PhysicsWorld({
          dimension: "3d",
          solver: "box2d",
          solverRegistry: registry,
        }),
    ).toThrow(/cannot simulate a "3d" world/);
  });

  it("refuses an init carrying neither adapter nor solver (§85)", () => {
    let thrown: unknown;
    try {
      // `adapter` is optional in the type now that `solver` is its
      // alternative, so "neither" is a runtime check rather than a compile
      // error — see `selectAdapter` for why the type stayed an interface.
      new PhysicsWorld({ dimension: "2d" });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isFourError(thrown)).toBe(true);
    if (isFourError(thrown)) {
      expect(thrown.code).toBe("INVALID_APPLICATION_STATE");
      expect(thrown.message).toContain("needs a solver");
      expect(thrown.context).toEqual({ dimension: "2d" });
    }
  });

  it("refuses an init carrying both (§85)", () => {
    const { registry } = withSolvers([{ name: "rapier" }]);
    const adapter = new FakeSolverAdapter();
    let thrown: unknown;
    try {
      new PhysicsWorld({
        dimension: "2d",
        adapter,
        solver: "rapier",
        solverRegistry: registry,
      });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isFourError(thrown)).toBe(true);
    if (isFourError(thrown)) {
      expect(thrown.message).toContain("not both");
      expect(thrown.context).toMatchObject({ solver: "rapier" });
    }
  });
});
