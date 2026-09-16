/**
 * `SHADER_OPERATORS` (§81, RFC 0002 §2): this package's named-factory table.
 * The umbrella's `plugins.test.ts` pins cross-package identity; this file
 * pins the token, the non-revocable disposition, and the registry.
 */

import { bindCapability, isFourError } from "@fourjs/core";
import { describe, expect, it } from "vitest";

import {
  SHADER_OPERATORS,
  ShaderOperatorRegistry,
  type ShaderOperatorFactory,
} from "../src/index.js";

const time: ShaderOperatorFactory = () => ({ kind: "time" });
const other: ShaderOperatorFactory = () => ({ kind: "time" });

describe("SHADER_OPERATORS", () => {
  it("is the fourJS:shader-operators token, not revocable (RFC 0002 Q3)", () => {
    expect(SHADER_OPERATORS).toEqual({
      name: "fourJS:shader-operators",
      revocable: false,
    });
  });

  it("keys a ShaderOperatorRegistry for the compiler", () => {
    const registry = new ShaderOperatorRegistry();
    expect(bindCapability(SHADER_OPERATORS, registry).value).toBe(registry);
  });
});

describe("ShaderOperatorRegistry", () => {
  it("registers, looks up, and reports names in insertion order", () => {
    const registry = new ShaderOperatorRegistry();
    expect(registry.register("time", time)).toBe(registry);
    registry.register("clock", other);
    expect(registry.size).toBe(2);
    expect(registry.has("time")).toBe(true);
    expect(registry.get("time")).toBe(time);
    expect(registry.get("time")?.([])).toEqual({ kind: "time" });
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.names).toEqual(["time", "clock"]);
  });

  it("treats an identical re-register as a no-op", () => {
    const registry = new ShaderOperatorRegistry();
    registry.register("time", time).register("time", time);
    expect(registry.size).toBe(1);
  });

  it("refuses a different factory under an occupied name", () => {
    const registry = new ShaderOperatorRegistry();
    registry.register("time", time);
    try {
      registry.register("time", other);
      expect.unreachable("expected a FourError");
    } catch (error) {
      expect(isFourError(error) && error.code).toBe(
        "INVALID_APPLICATION_STATE",
      );
      expect((error as Error).message).toMatch(/already registered/);
    }
  });

  it("refuses an empty name", () => {
    const registry = new ShaderOperatorRegistry();
    expect(() => registry.register("", time)).toThrow(/empty name/);
  });
});
