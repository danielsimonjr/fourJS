/**
 * `EDITOR_TOOLS` (§81): the host-side tool table the umbrella owns because
 * editor tools have no package in the §98 tree.
 */

import { bindCapability, isFourError } from "@fourjs/core";
import { describe, expect, it } from "vitest";

import { EDITOR_TOOLS, EditorToolRegistry } from "../src/plugins.js";

const translate = () => ({ id: "translate" });
const rotate = () => ({ id: "rotate" });

describe("EDITOR_TOOLS", () => {
  it("is the fourJS:editor-tools token, not revocable, and host-side", () => {
    expect(EDITOR_TOOLS).toEqual({
      name: "fourJS:editor-tools",
      revocable: false,
    });
  });

  it("keys an EditorToolRegistry for the compiler", () => {
    const registry = new EditorToolRegistry();
    expect(bindCapability(EDITOR_TOOLS, registry).value).toBe(registry);
  });
});

describe("EditorToolRegistry", () => {
  it("registers, looks up, and reports names in insertion order", () => {
    const registry = new EditorToolRegistry();
    expect(registry.register("translate", translate)).toBe(registry);
    registry.register("rotate", rotate);
    expect(registry.size).toBe(2);
    expect(registry.has("translate")).toBe(true);
    expect(registry.get("translate")).toBe(translate);
    expect(registry.get("translate")?.()).toEqual({ id: "translate" });
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.names).toEqual(["translate", "rotate"]);
  });

  it("treats an identical re-register as a no-op", () => {
    const registry = new EditorToolRegistry();
    registry.register("translate", translate).register("translate", translate);
    expect(registry.size).toBe(1);
  });

  it("refuses a different factory under an occupied name", () => {
    const registry = new EditorToolRegistry();
    registry.register("translate", translate);
    try {
      registry.register("translate", rotate);
      expect.unreachable("expected a FourError");
    } catch (error) {
      expect(isFourError(error) && error.code).toBe(
        "INVALID_APPLICATION_STATE",
      );
      expect((error as Error).message).toMatch(/already registered/);
    }
  });

  it("refuses an empty name", () => {
    const registry = new EditorToolRegistry();
    expect(() => registry.register("", translate)).toThrow(/empty name/);
  });
});
