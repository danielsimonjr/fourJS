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
    expect(report.message).toContain("3 math object(s)");
    // A runtime message must never name a workspace package a consumer
    // cannot install (2026-09-19 dogfood finding).
    expect(report.message).not.toContain("@fourjs/");
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

describe("auditFrameAllocations message attribution (cycle 9/10 residue)", () => {
  // Dogfood cycle 9C read `N math object(s) were constructed during
  // "Application.step"` as the engine warning about its own allocations and
  // filed a tracker item on it. Cycle 10C measured the opposite: the label is
  // the measurement WINDOW, and the count is the math package's process-wide
  // construction delta across it, so a consumer's own `fixedUpdate` lands in
  // the number under the engine's label. The message must let a reader tell
  // the two apart.
  it("names the label as the window and says the count is not scoped to it", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { message } = auditFrameAllocations(0, 4, {
      label: "Application.step",
    });
    expect(message).toContain("4 math object(s)");
    expect(message).toContain('"Application.step" is the measurement window');
    expect(message).toContain("not necessarily the allocator");
    expect(message).toContain("anywhere in the process");
    expect(message).toContain("the application's own code");
    // Still §83, still the §7b remedy, still no workspace package name.
    expect(message).toContain("§83:");
    expect(message).toContain("§7b");
    expect(message).not.toContain("@fourjs/");
  });

  it("does not phrase the window as the thing that allocated", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { message } = auditFrameAllocations(0, 1, { label: "simulate" });
    // The bare "during <label>" of the old wording is what read as an
    // accusation; "while <label> was running" plus the window sentence does
    // not.
    expect(message).not.toContain('constructed during "simulate"');
    expect(message).toContain('constructed while "simulate" was running');
  });
});
