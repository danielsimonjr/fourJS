/**
 * `ComputeWorkloadRegistry` — the §81 compute-workload table.
 * Token identity lives in `capabilities.test.ts`; this file pins the map.
 */

import { isFourError } from "@fourjs/core";
import { describe, expect, it } from "vitest";

import {
  ComputeWorkloadRegistry,
  type ComputeWorkloadFactory,
} from "../src/index.js";

const particles: ComputeWorkloadFactory = () => ({
  shader: "@compute fn computeMain() {}",
  workgroups: [1, 1, 1],
  bindings: [],
});
const other: ComputeWorkloadFactory = () => ({
  shader: "@compute fn computeMain() {}",
  workgroups: [4, 1, 1],
  bindings: [],
});

describe("ComputeWorkloadRegistry", () => {
  it("registers, looks up, and reports names in insertion order", () => {
    const registry = new ComputeWorkloadRegistry();
    expect(registry.register("particles", particles)).toBe(registry);
    registry.register("nbody", other);
    expect(registry.size).toBe(2);
    expect(registry.has("particles")).toBe(true);
    expect(registry.get("particles")).toBe(particles);
    expect(registry.get("particles")?.().workgroups).toEqual([1, 1, 1]);
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.names).toEqual(["particles", "nbody"]);
  });

  it("treats an identical re-register as a no-op", () => {
    const registry = new ComputeWorkloadRegistry();
    registry.register("particles", particles).register("particles", particles);
    expect(registry.size).toBe(1);
  });

  it("refuses a different factory under an occupied name", () => {
    const registry = new ComputeWorkloadRegistry();
    registry.register("particles", particles);
    try {
      registry.register("particles", other);
      expect.unreachable("expected a FourError");
    } catch (error) {
      expect(isFourError(error) && error.code).toBe(
        "INVALID_APPLICATION_STATE",
      );
      expect((error as Error).message).toMatch(/already registered/);
    }
  });

  it("refuses an empty name", () => {
    const registry = new ComputeWorkloadRegistry();
    expect(() => registry.register("", particles)).toThrow(/empty name/);
  });
});
