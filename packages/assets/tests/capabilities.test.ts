/**
 * `ASSET_LOADERS` (§81, RFC 0002 §2): this package's named-loader table.
 * The umbrella's `plugins.test.ts` pins cross-package identity; this file
 * pins the token, the non-revocable disposition, and the registry.
 */

import { bindCapability, isFourError } from "@fourjs/core";
import { describe, expect, it } from "vitest";

import {
  ASSET_LOADERS,
  AssetLoaderRegistry,
  type AssetLoader,
} from "../src/index.js";

function probeLoader(name: string): AssetLoader<string> {
  return {
    name,
    load() {
      return Promise.resolve(name);
    },
  };
}

describe("ASSET_LOADERS", () => {
  it("is the fourJS:asset-loaders token, not revocable (RFC 0002 Q3)", () => {
    expect(ASSET_LOADERS).toEqual({
      name: "fourJS:asset-loaders",
      revocable: false,
    });
  });

  it("keys an AssetLoaderRegistry for the compiler", () => {
    const registry = new AssetLoaderRegistry();
    expect(bindCapability(ASSET_LOADERS, registry).value).toBe(registry);
  });
});

describe("AssetLoaderRegistry", () => {
  it("registers, looks up, and reports names in insertion order", () => {
    const registry = new AssetLoaderRegistry();
    const json = probeLoader("json");
    const ktx = probeLoader("ktx2");
    expect(registry.register("json", json)).toBe(registry);
    registry.register("ktx2", ktx);
    expect(registry.size).toBe(2);
    expect(registry.has("json")).toBe(true);
    expect(registry.get("json")).toBe(json);
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.names).toEqual(["json", "ktx2"]);
  });

  it("treats an identical re-register as a no-op", () => {
    const registry = new AssetLoaderRegistry();
    const json = probeLoader("json");
    registry.register("json", json).register("json", json);
    expect(registry.size).toBe(1);
    expect(registry.get("json")).toBe(json);
  });

  it("refuses a different loader under an occupied name", () => {
    const registry = new AssetLoaderRegistry();
    registry.register("json", probeLoader("json"));
    try {
      registry.register("json", probeLoader("other"));
      expect.unreachable("expected a FourError");
    } catch (error) {
      expect(isFourError(error) && error.code).toBe(
        "INVALID_APPLICATION_STATE",
      );
      expect((error as Error).message).toMatch(/already registered/);
    }
  });

  it("refuses an empty name", () => {
    const registry = new AssetLoaderRegistry();
    expect(() => registry.register("", probeLoader("x"))).toThrow(/empty name/);
  });
});
