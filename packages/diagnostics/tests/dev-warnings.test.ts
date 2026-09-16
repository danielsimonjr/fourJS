import { afterEach, describe, expect, it, vi } from "vitest";

import { resetDevWarnings } from "@fourjs/core";

import {
  beginFrameAllocationCheck,
  endFrameAllocationCheck,
  warnDetachedNodeListeners,
  warnDisposedResourceInUse,
  warnPerFrameAllocations,
  warnStalePhysicsHandle,
} from "../src/dev-warnings.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  resetDevWarnings();
});

describe("dev-warnings", () => {
  it("warnDisposedResourceInUse deduplicates per resource", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(warnDisposedResourceInUse("tex-1", "texture")).toBe(true);
    expect(warnDisposedResourceInUse("tex-1", "texture")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("endFrameAllocationCheck warns when construction count grows", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let count = 0;
    const read = (): number => count;
    const baseline = beginFrameAllocationCheck(read);
    count = 3;
    expect(
      endFrameAllocationCheck(baseline, read, { label: "test-span" }),
    ).toBe(3);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warnDetachedNodeListeners fires once when listeners remain", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(warnDetachedNodeListeners("node-a", 2)).toBe(true);
    expect(warnDetachedNodeListeners("node-a", 2)).toBe(false);
    expect(warnDetachedNodeListeners("node-a", 0)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warnStalePhysicsHandle deduplicates per handle", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(warnStalePhysicsHandle("body", "id-1")).toBe(true);
    expect(warnStalePhysicsHandle("body", "id-1")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warnPerFrameAllocations stays quiet at or below the threshold", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(warnPerFrameAllocations(0)).toBe(false);
    expect(warnPerFrameAllocations(1, "frame", 2)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("endFrameAllocationCheck returns zero delta when nothing was allocated", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const read = (): number => 5;
    expect(endFrameAllocationCheck(beginFrameAllocationCheck(read), read)).toBe(
      0,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("is inert in a production build", async () => {
    vi.stubGlobal("__FOUR_DEV__", false);
    vi.resetModules();
    const production = await import("../src/dev-warnings.js");
    expect(production.warnDisposedResourceInUse("g-1", "geometry")).toBe(false);
  });
});
