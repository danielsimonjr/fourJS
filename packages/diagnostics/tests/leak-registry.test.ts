/**
 * Tests for §83's FinalizationRegistry leaked-resource warning (A-5).
 *
 * Finalization is nondeterministic, so every case drives the registry through
 * the {@link reportFinalized} test hook rather than waiting on GC.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { resetDevWarnings } from "@fourjs/core";

import {
  auditFinalizedLeaks,
  disposeTracked,
  reportFinalized,
  resetLeakRegistry,
  trackDisposable,
  trackedDisposableId,
} from "../src/leak-registry.js";

afterEach(() => {
  resetLeakRegistry();
  resetDevWarnings();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("leak registry", () => {
  it("warns with the label and creation site after simulated GC", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const id = trackDisposable({}, "level-atlas", "at loadLevel (demo.ts:40)");
    expect(id).toBeGreaterThan(0);
    expect(typeof trackedDisposableId).toBe("function");
    reportFinalized(id);
    expect(auditFinalizedLeaks()).toBe(1);
    const text = String(warn.mock.calls[0]?.[0]);
    expect(text).toContain("[fourJS]");
    expect(text).toContain("§83");
    expect(text).toContain("level-atlas");
    expect(text).toContain("at loadLevel (demo.ts:40)");
    expect(auditFinalizedLeaks()).toBe(0);
  });

  it("does not warn when disposeTracked ran before finalization", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const resource = {};
    const id = trackDisposable(resource, "texture", "at demo.ts:10");
    disposeTracked(resource);
    reportFinalized(id);
    expect(auditFinalizedLeaks()).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("captures a creation-site stack when none is supplied", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const id = trackDisposable({}, "buffer");
    reportFinalized(id);
    expect(auditFinalizedLeaks()).toBe(1);
    const text = String(warn.mock.calls[0]?.[0]);
    expect(text).toContain("buffer");
    expect(text).toContain("Creation site:");
    expect(text).toMatch(/Creation site: at /);
    expect(text).not.toContain("Creation site: unknown");
  });

  it("returns the existing id when the same resource is tracked twice", () => {
    const resource = {};
    const first = trackDisposable(resource, "mesh", "site-a");
    const second = trackDisposable(resource, "mesh", "site-a");
    expect(second).toBe(first);
  });

  it("drains every pending leak and ignores unknown ids", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    reportFinalized(trackDisposable({}, "a", "site-1"));
    reportFinalized(trackDisposable({}, "b", "site-2"));
    reportFinalized(999);
    expect(auditFinalizedLeaks()).toBe(2);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("disposeTracked is a no-op for an unknown resource", () => {
    expect(() => disposeTracked({})).not.toThrow();
  });

  it("can track the same object again after dispose", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const resource = {};
    disposeTracked(resource);
    const first = trackDisposable(resource, "first", "site-1");
    disposeTracked(resource);
    const second = trackDisposable(resource, "second", "site-2");
    expect(second).not.toBe(first);
    reportFinalized(second);
    expect(auditFinalizedLeaks()).toBe(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("second");
  });

  it("resetLeakRegistry clears the pending queue", () => {
    reportFinalized(trackDisposable({}, "x", "y"));
    resetLeakRegistry();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(auditFinalizedLeaks()).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("is inert in a production build", async () => {
    vi.stubGlobal("__FOUR_DEV__", false);
    vi.resetModules();
    const production = await import("../src/leak-registry.js");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const id = production.trackDisposable({}, "tex", "at test.ts:1");
    expect(id).toBe(0);
    production.disposeTracked({});
    production.reportFinalized(id);
    expect(production.auditFinalizedLeaks()).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("still queues leaks when FinalizationRegistry is missing", async () => {
    vi.stubGlobal("FinalizationRegistry", undefined);
    vi.resetModules();
    const isolated = await import("../src/leak-registry.js");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const id = isolated.trackDisposable(
      {},
      "orphan",
      "at missing-registry.ts:1",
    );
    expect(id).toBeGreaterThan(0);
    isolated.reportFinalized(id);
    expect(isolated.auditFinalizedLeaks()).toBe(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("orphan");
    isolated.resetLeakRegistry();
  });
});
