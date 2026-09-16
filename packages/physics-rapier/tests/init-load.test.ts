/**
 * The Rapier wasm load cache in `init.ts` — success, reject-and-retry, and
 * the synchronous "not loaded yet" readers.
 *
 * Other files in this package call `initializeRapier2d` in `beforeAll` and
 * therefore never see a cold cache or a rejected `init()`. Those two branches
 * are why Vitest 5's honest remapping dropped this file under the 80%
 * per-file floor: Vitest 3 credited them as covered without executing them.
 *
 * Rapier's `init` is a non-configurable wasm-bindgen export, so this file
 * mocks the two `-compat` packages rather than `spyOn`ing the live module.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { init2d, init3d, version2d, version3d } = vi.hoisted(() => ({
  init2d: vi.fn(),
  init3d: vi.fn(),
  version2d: vi.fn(() => "0.20.0"),
  version3d: vi.fn(() => "0.20.0"),
}));

vi.mock("@dimforge/rapier2d-compat", () => ({
  default: {
    init: init2d,
    version: version2d,
  },
}));

vi.mock("@dimforge/rapier3d-compat", () => ({
  default: {
    init: init3d,
    version: version3d,
  },
}));

describe("Rapier wasm load cache (init.ts)", () => {
  beforeEach(() => {
    vi.resetModules();
    init2d.mockReset();
    init3d.mockReset();
    version2d.mockReset();
    version3d.mockReset();
    version2d.mockReturnValue("0.20.0");
    version3d.mockReturnValue("0.20.0");
  });

  it("reports undefined module and version before the first successful load", async () => {
    const { rapier2dModule, rapier2dVersion, rapier3dModule, rapier3dVersion } =
      await import("../src/init.js");
    expect(rapier2dModule()).toBeUndefined();
    expect(rapier2dVersion()).toBeUndefined();
    expect(rapier3dModule()).toBeUndefined();
    expect(rapier3dVersion()).toBeUndefined();
  });

  it("clears the 2D cache when init rejects so a later call retries", async () => {
    const init = await import("../src/init.js");
    init2d.mockRejectedValueOnce(new Error("decode failed"));

    await expect(init.initializeRapier2d()).rejects.toThrow("decode failed");
    expect(init.rapier2dModule()).toBeUndefined();
    expect(init.rapier2dVersion()).toBeUndefined();

    init2d.mockResolvedValueOnce(undefined);
    const loaded = await init.initializeRapier2d();
    expect(loaded).toBe(init.RAPIER_2D);
    expect(init.rapier2dModule()).toBe(init.RAPIER_2D);
    expect(init.rapier2dVersion()).toBe("0.20.0");
    expect(init2d).toHaveBeenCalledTimes(2);
  });

  it("clears the 3D cache when init rejects so a later call retries", async () => {
    const init = await import("../src/init.js");
    init3d.mockRejectedValueOnce(new Error("decode failed"));

    await expect(init.initializeRapier3d()).rejects.toThrow("decode failed");
    expect(init.rapier3dModule()).toBeUndefined();
    expect(init.rapier3dVersion()).toBeUndefined();

    init3d.mockResolvedValueOnce(undefined);
    const loaded = await init.initializeRapier3d();
    expect(loaded).toBe(init.RAPIER_3D);
    expect(init.rapier3dModule()).toBe(init.RAPIER_3D);
    expect(init.rapier3dVersion()).toBe("0.20.0");
    expect(init3d).toHaveBeenCalledTimes(2);
  });
});
