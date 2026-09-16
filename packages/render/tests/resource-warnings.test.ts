import { afterEach, describe, expect, it, vi } from "vitest";

import { resetDevWarnings } from "@fourjs/core";

import { warnDisposedInUse } from "../src/resource-warnings.js";

afterEach(() => {
  resetDevWarnings();
  vi.restoreAllMocks();
});

describe("warnDisposedInUse (§83)", () => {
  it("warns once per disposed resource id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(warnDisposedInUse("texture", "t1")).toBeUndefined();
    expect(warnDisposedInUse("texture", "t1")).toBeUndefined();
    expect(warnDisposedInUse("texture", "t2")).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]?.[0])).toContain("[fourJS]");
    expect(String(warn.mock.calls[0]?.[0])).toContain("t1");
  });

  it("is a no-op when DEV is false", async () => {
    vi.stubGlobal("__FOUR_DEV__", false);
    vi.resetModules();
    const { warnDisposedInUse: productionWarn } =
      await import("../src/resource-warnings.js");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(productionWarn("texture", "t-prod")).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.resetModules();
  });
});
