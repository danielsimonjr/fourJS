/**
 * `UI_CONTROLS` (§81, RFC 0002 §2): this package's named-constructor table.
 * The umbrella's `plugins.test.ts` pins cross-package identity; this file
 * pins the token, the non-revocable disposition, and the registry.
 */

import { bindCapability, isFourError } from "@fourjs/core";
import { describe, expect, it } from "vitest";

import {
  Button,
  UI_CONTROLS,
  UIControlRegistry,
  UIWidget,
} from "../src/index.js";

class Probe extends UIWidget {}

describe("UI_CONTROLS", () => {
  it("is the fourJS:ui-controls token, not revocable (RFC 0002 Q3)", () => {
    expect(UI_CONTROLS).toEqual({
      name: "fourJS:ui-controls",
      revocable: false,
    });
  });

  it("keys a UIControlRegistry for the compiler", () => {
    const registry = new UIControlRegistry();
    expect(bindCapability(UI_CONTROLS, registry).value).toBe(registry);
  });
});

describe("UIControlRegistry", () => {
  it("registers, looks up, and reports names in insertion order", () => {
    const registry = new UIControlRegistry();
    expect(registry.register("Probe", Probe)).toBe(registry);
    registry.register("Button", Button);
    expect(registry.size).toBe(2);
    expect(registry.has("Probe")).toBe(true);
    expect(registry.get("Probe")).toBe(Probe);
    expect(new (registry.get("Probe")!)()).toBeInstanceOf(UIWidget);
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.names).toEqual(["Probe", "Button"]);
  });

  it("treats an identical re-register as a no-op", () => {
    const registry = new UIControlRegistry();
    registry.register("Probe", Probe).register("Probe", Probe);
    expect(registry.size).toBe(1);
  });

  it("refuses a different constructor under an occupied name", () => {
    const registry = new UIControlRegistry();
    registry.register("Probe", Probe);
    try {
      registry.register("Probe", Button);
      expect.unreachable("expected a FourError");
    } catch (error) {
      expect(isFourError(error) && error.code).toBe(
        "INVALID_APPLICATION_STATE",
      );
      expect((error as Error).message).toMatch(/already registered/);
    }
  });

  it("refuses an empty name", () => {
    const registry = new UIControlRegistry();
    expect(() => registry.register("", Probe)).toThrow(/empty name/);
  });
});
