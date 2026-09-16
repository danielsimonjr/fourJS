/**
 * Tests for §83's per-frame allocation development warning (A-4/A-5).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { resetDevWarnings } from "@fourjs/core";

import {
  NO_FRAME_ALLOCATIONS,
  auditFrameAllocations,
} from "../src/allocation-audit.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  resetDevWarnings();
});

describe("auditFrameAllocations", () => {
  it("reports nothing when the span stayed within the threshold", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const report = auditFrameAllocations(4, 4);
    expect(report).toBe(NO_FRAME_ALLOCATIONS);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns once when math objects were constructed during the span", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const report = auditFrameAllocations(2, 5, { label: "simulate" });
    expect(report.excessive).toBe(true);
    expect(report.constructed).toBe(3);
    expect(report.message).toContain("3 @fourjs/math object(s)");
    expect(warn).toHaveBeenCalledTimes(1);
    auditFrameAllocations(0, 9, { label: "simulate" });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("respects a non-zero threshold", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(auditFrameAllocations(0, 2, { threshold: 2 }).excessive).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(auditFrameAllocations(0, 3, { threshold: 2 }).excessive).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
