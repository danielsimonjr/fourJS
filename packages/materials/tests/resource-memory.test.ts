/**
 * Tests for §83's live-material accounting (A-5 follow-up).
 *
 * The counters are process-wide levels, never reset, so every assertion is a
 * delta against the totals as this test found them.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  auditFinalizedLeaks,
  reportFinalized,
  resetDevWarnings,
  resetLeakRegistry,
  trackedDisposableId,
} from "@fourjs/core";

import { LitMaterial } from "../src/lit-material.js";
import { NodeMaterial } from "../src/node-material.js";
import { liveMaterialCount } from "../src/resource-memory.js";
import { SpriteMaterial, type SpriteTexture } from "../src/sprite-material.js";
import { StandardMaterial } from "../src/standard-material.js";
import { UnlitMaterial } from "../src/unlit-material.js";
import type { ShaderGraph } from "../src/shader-graph.js";

/** Structural texture — `@fourjs/materials` cannot import `@fourjs/render`. */
function fakeTexture(): SpriteTexture {
  return {
    id: "texture-account-1",
    version: 0,
    width: 2,
    height: 2,
    data: new Uint8Array(16),
    disposed: false,
  };
}

/** Minimal valid surface graph for {@link NodeMaterial}. */
function colorGraph(): ShaderGraph {
  return {
    domain: "surface",
    nodes: [{ kind: "uniform", type: "vec4", name: "color" }],
    color: 0,
  };
}

afterEach(() => {
  resetLeakRegistry();
  resetDevWarnings();
  vi.restoreAllMocks();
});

describe("§83 material resource accounting (A-5)", () => {
  it("adds an UnlitMaterial on construct and removes it on dispose", () => {
    const before = liveMaterialCount();
    const material = new UnlitMaterial();
    expect(liveMaterialCount()).toBe(before + 1);
    material.dispose();
    expect(liveMaterialCount()).toBe(before);
  });

  it("counts every shipped family member as one live material", () => {
    const before = liveMaterialCount();
    const unlit = new UnlitMaterial();
    const lit = new LitMaterial();
    const sprite = new SpriteMaterial({ texture: fakeTexture() });
    const standard = new StandardMaterial();
    const node = new NodeMaterial(colorGraph());

    expect(liveMaterialCount()).toBe(before + 5);

    unlit.dispose();
    lit.dispose();
    sprite.dispose();
    standard.dispose();
    node.dispose();

    expect(liveMaterialCount()).toBe(before);
  });

  it("subtracts once for a double dispose (§83: idempotent and terminal)", () => {
    const before = liveMaterialCount();
    const material = new StandardMaterial();
    material.dispose();
    material.dispose();
    material.dispose();
    expect(liveMaterialCount()).toBe(before);
  });

  it("registers a material with the FinalizationRegistry tracker (A-4)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const material = new UnlitMaterial();
    const id = trackedDisposableId(material);
    expect(id).toBeGreaterThan(0);
    reportFinalized(id);
    expect(auditFinalizedLeaks()).toBe(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(material.id);
    material.dispose();
  });

  it("does not warn when the material was disposed before finalization", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const material = new UnlitMaterial();
    const id = trackedDisposableId(material);
    material.dispose();
    reportFinalized(id);
    expect(auditFinalizedLeaks()).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("never forgives a material that is dropped without dispose (§83)", () => {
    const before = liveMaterialCount();
    for (let index = 0; index < 3; index += 1) {
      new UnlitMaterial();
    }
    expect(liveMaterialCount() - before).toBe(3);
  });

  it("holds no reference to the materials it counts", () => {
    expect(typeof liveMaterialCount()).toBe("number");
  });

  it("keeps the counter moving when DEV is false (message-only gating)", async () => {
    // The count is always-on — a number, not a warning. Production gating
    // lives on `auditResourceLeaks`, which this package does not import.
    vi.stubGlobal("__FOUR_DEV__", false);
    vi.resetModules();
    const { UnlitMaterial: ProductionUnlit } =
      await import("../src/unlit-material.js");
    const { liveMaterialCount: productionCount } =
      await import("../src/resource-memory.js");
    const before = productionCount();
    const material = new ProductionUnlit();
    expect(productionCount()).toBe(before + 1);
    material.dispose();
    expect(productionCount()).toBe(before);
    vi.unstubAllGlobals();
    vi.resetModules();
  });
});
