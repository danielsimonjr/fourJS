import { isFourError } from "@fourjs/core";
import {
  SolverRegistry,
  registeredSolvers,
  clearRegisteredSolvers,
  type PhysicsWorldAdapter,
} from "@fourjs/physics";
import { afterEach, describe, expect, it } from "vitest";

import {
  PACKAGE_NAME,
  PHYSJS_CAPABILITIES,
  PHYSJS_VERSION,
  PhysJSAdapter2D,
  PhysJSAdapter3D,
  createPhysJSAdapter,
  isPhysJSSupported,
  registerPhysJSSolver,
} from "../src/index.js";

afterEach(() => {
  clearRegisteredSolvers();
});

describe("registration", () => {
  it("names the package and pins the engine", () => {
    expect(PACKAGE_NAME).toBe("@fourjs/physics-physjs");
    expect(PHYSJS_VERSION).toBe("0.5.0");
    expect(isPhysJSSupported()).toBe(true);
  });

  it("builds the adapter for the world's dimension", () => {
    expect(createPhysJSAdapter({ dimension: "2d" })).toBeInstanceOf(
      PhysJSAdapter2D,
    );
    expect(createPhysJSAdapter({ dimension: "3d" })).toBeInstanceOf(
      PhysJSAdapter3D,
    );
    expect(new PhysJSAdapter2D().name).toBe("physjs2d");
    expect(new PhysJSAdapter3D().name).toBe("physjs3d");
    expect(new PhysJSAdapter3D().version).toBe("0.5.0");
  });

  it('resolves through "physjs", idempotently', () => {
    const registry = new SolverRegistry();
    expect(registerPhysJSSolver(registry)).toBe(registry);
    registerPhysJSSolver(registry);
    expect(registry.solvers).toEqual(["physjs"]);
    expect(registry.resolve("physjs", { dimension: "2d" })).toBeInstanceOf(
      PhysJSAdapter2D,
    );
    expect(registry.resolve("physjs", { dimension: "3d" })).toBeInstanceOf(
      PhysJSAdapter3D,
    );
  });

  it("registers into the shared registry by default", () => {
    registerPhysJSSolver();
    expect(registeredSolvers()).toEqual(["physjs"]);
  });

  it('is last in the "auto" order behind an earlier solver', () => {
    const registry = new SolverRegistry();
    registry.register({
      name: "rapier",
      isSupported: () => true,
      create: () => {
        const adapter = new PhysJSAdapter3D();
        Object.defineProperty(adapter, "capabilities", {
          value: { ...PHYSJS_CAPABILITIES, dimensions: ["3d"] },
        });
        return adapter;
      },
    });
    registerPhysJSSolver(registry);
    expect(registry.solvers).toEqual(["rapier", "physjs"]);
    // The earlier solver wins in 3D; "auto" falls through to physjs in 2D.
    expect(registry.resolve("auto", { dimension: "3d" })).not.toBeInstanceOf(
      PhysJSAdapter2D,
    );
    expect(registry.resolve("auto", { dimension: "2d" })).toBeInstanceOf(
      PhysJSAdapter2D,
    );
  });

  it('"auto" rejects physjs above its determinism tier', () => {
    const registry = registerPhysJSSolver(new SolverRegistry());
    expect(() =>
      registry.resolve("auto", {
        dimension: "2d",
        determinism: "cross-platform",
      }),
    ).toThrow(/found no solver/);
  });
});

describe("capability record (RFC 0010 decision 4)", () => {
  it("matches the snapshot", () => {
    expect(PHYSJS_CAPABILITIES).toMatchInlineSnapshot(`
      {
        "ccdModes": [
          "disabled",
          "speculative",
        ],
        "determinism": "same-runtime",
        "dimensions": [
          "2d",
          "3d",
        ],
        "jointTypes": [
          "fixed",
          "spring",
          "revolute",
          "spherical",
        ],
        "queries": {
          "overlap": true,
          "point": true,
          "raycast": true,
          "shapeCast": false,
        },
        "snapshots": true,
        "tuning": {
          "jointMotorEffortCap": false,
          "rollingFriction": false,
          "sleepThresholds": false,
          "spinningFriction": false,
        },
      }
    `);
    expect(Object.isFrozen(PHYSJS_CAPABILITIES)).toBe(true);
    expect(new PhysJSAdapter2D().capabilities).toBe(PHYSJS_CAPABILITIES);
  });
});

describe("shapeCast is refused with NOT_IMPLEMENTED", () => {
  const calls: Record<string, (a: PhysicsWorldAdapter) => unknown> = {
    shapeCast: (a) => a.shapeCast({} as never),
  };

  for (const Adapter of [PhysJSAdapter2D, PhysJSAdapter3D]) {
    for (const [operation, call] of Object.entries(calls)) {
      it(`${new Adapter().name}.${operation}`, () => {
        let thrown: unknown;
        try {
          call(new Adapter());
        } catch (error) {
          thrown = error;
        }
        expect(isFourError(thrown)).toBe(true);
        expect((thrown as { code: string }).code).toBe("NOT_IMPLEMENTED");
        expect((thrown as Error).message).toContain(operation);
      });
    }
  }
});
