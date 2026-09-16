import { afterEach, describe, expect, it, vi } from "vitest";

import { isFourError, resetDevWarnings } from "@fourjs/core";

import {
  rejectStalePhysicsHandle,
  resetStaleHandleWarnings,
} from "../src/stale-handle.js";

afterEach(() => {
  resetDevWarnings();
  resetStaleHandleWarnings();
  vi.restoreAllMocks();
});

describe("rejectStalePhysicsHandle (§83)", () => {
  it("warns once and throws INVALID_APPLICATION_STATE", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() =>
      rejectStalePhysicsHandle("body", "7", "stale body (§37)."),
    ).toThrowError(/stale body/);
    expect(() => rejectStalePhysicsHandle("body", "7", "again.")).toThrowError(
      /again/,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    try {
      rejectStalePhysicsHandle("collider", "3", "stale collider.");
    } catch (error: unknown) {
      expect(isFourError(error)).toBe(true);
      if (isFourError(error)) {
        expect(error.code).toBe("INVALID_APPLICATION_STATE");
      }
    }
  });

  it("attaches context when the caller provides it", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      rejectStalePhysicsHandle(
        "joint",
        "9",
        "stale joint.",
        "INVALID_APPLICATION_STATE",
        { handle: 9 },
      );
    } catch (error: unknown) {
      expect(isFourError(error)).toBe(true);
      if (isFourError(error)) {
        expect(error.context).toEqual({ handle: 9 });
      }
    }
  });
});
