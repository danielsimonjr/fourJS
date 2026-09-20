import { EventEmitter, isFourError } from "@fourjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AUTO_RENDERER_ORDER,
  NullRenderer,
  RendererRegistry,
  clearRegisteredRenderers,
  registerRenderer,
  registeredRenderers,
  resolveRenderer,
  type Renderer,
  type RendererBackend,
  type RendererCapabilities,
  type RendererEventMap,
  type RendererFallbackReport,
  type RendererOptions,
} from "../src/index.js";

/**
 * A backend double that answers §61 and records what the registry did to it.
 *
 * `NullRenderer` would do for the happy path, but not for the two behaviours
 * §62's `"auto"` is defined by — an `initialize` that rejects, and a `dispose`
 * the registry must call before it moves on — so the double carries both as
 * scripted switches.
 */
class FakeBackend implements Renderer {
  readonly events = new EventEmitter<RendererEventMap>();

  readonly capabilities: RendererCapabilities;

  initializeCount = 0;

  disposeCount = 0;

  lastOptions: RendererOptions | undefined;

  constructor(
    backend: RendererBackend,
    readonly failInitialize = false,
    readonly failDispose = false,
  ) {
    this.capabilities = { backend, maxTextureSize: 0 };
  }

  initialize(options?: RendererOptions): Promise<void> {
    this.initializeCount += 1;
    this.lastOptions = options;
    return this.failInitialize
      ? Promise.reject(new Error(`${this.capabilities.backend} refused`))
      : Promise.resolve();
  }

  render(): void {}

  resize(): void {}

  dispose(): void {
    this.disposeCount += 1;
    if (this.failDispose) {
      throw new Error("dispose refused");
    }
  }
}

interface Entry {
  readonly backend: RendererBackend;
  readonly supported?: boolean;
  readonly failInitialize?: boolean;
  readonly failDispose?: boolean;
}

/** Registers `entries` into a fresh registry and hands back both. */
function withBackends(entries: readonly Entry[]): {
  registry: RendererRegistry;
  built: Map<RendererBackend, FakeBackend>;
} {
  const registry = new RendererRegistry();
  const built = new Map<RendererBackend, FakeBackend>();
  for (const entry of entries) {
    registry.register({
      backend: entry.backend,
      isSupported: () => entry.supported ?? true,
      create: () => {
        const renderer = new FakeBackend(
          entry.backend,
          entry.failInitialize ?? false,
          entry.failDispose ?? false,
        );
        built.set(entry.backend, renderer);
        return renderer;
      },
    });
  }
  return { registry, built };
}

afterEach(() => {
  clearRegisteredRenderers();
});

describe("AUTO_RENDERER_ORDER", () => {
  it("is §62's preference and excludes the headless tier", () => {
    expect([...AUTO_RENDERER_ORDER]).toEqual([
      "webgpu",
      "webgl2",
      "canvas2d",
      "svg",
    ]);
    expect([...AUTO_RENDERER_ORDER]).not.toContain("null");
  });
});

describe("RendererRegistry bookkeeping", () => {
  it("reports its backends in registration order", () => {
    const { registry } = withBackends([
      { backend: "svg" },
      { backend: "webgl2" },
    ]);
    expect(registry.backends).toEqual(["svg", "webgl2"]);
    expect(registry.size).toBe(2);
    expect(registry.has("webgl2")).toBe(true);
    expect(registry.has("webgpu")).toBe(false);
    expect(registry.get("webgl2")?.backend).toBe("webgl2");
    expect(registry.get("webgpu")).toBeUndefined();
  });

  it("refuses a second registration for one backend (§33)", () => {
    const { registry } = withBackends([{ backend: "webgl2" }]);
    let thrown: unknown;
    try {
      registry.register({
        backend: "webgl2",
        isSupported: () => true,
        create: () => new NullRenderer(),
      });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isFourError(thrown)).toBe(true);
    if (isFourError(thrown)) {
      expect(thrown.code).toBe("RENDERER_INITIALIZATION_FAILED");
      expect(thrown.message).toContain("already registered");
      expect(thrown.context).toEqual({
        backend: "webgl2",
        registered: ["webgl2"],
      });
    }
  });

  it("unregisters, and answers whether there was anything to remove", () => {
    const { registry } = withBackends([{ backend: "webgl2" }]);
    expect(registry.unregister("webgpu")).toBe(false);
    expect(registry.unregister("webgl2")).toBe(true);
    expect(registry.size).toBe(0);
  });

  it("chains registrations", () => {
    const registry = new RendererRegistry();
    const entry = {
      isSupported: () => true,
      create: () => new NullRenderer(),
    };
    expect(
      registry
        .register({ backend: "webgl2", ...entry })
        .register({ backend: "svg", ...entry }),
    ).toBe(registry);
  });
});

describe('resolve("auto")', () => {
  it("prefers §62's order, not registration order", async () => {
    const { registry, built } = withBackends([
      { backend: "svg" },
      { backend: "webgl2" },
      { backend: "webgpu" },
    ]);
    const renderer = await registry.resolve("auto");
    expect(renderer.capabilities.backend).toBe("webgpu");
    expect(built.has("svg")).toBe(false);
    expect(built.has("webgl2")).toBe(false);
  });

  it("returns the renderer already initialized, with the resolve options", async () => {
    const { registry, built } = withBackends([{ backend: "webgl2" }]);
    const canvas = {};
    await registry.resolve("auto", { canvas, antialias: true });
    const renderer = built.get("webgl2");
    expect(renderer?.initializeCount).toBe(1);
    expect(renderer?.lastOptions).toMatchObject({ canvas, antialias: true });
  });

  it("skips an unsupported backend and reports it (§62)", async () => {
    const { registry, built } = withBackends([
      { backend: "webgpu", supported: false },
      { backend: "webgl2" },
    ]);
    const reports: RendererFallbackReport[] = [];
    const renderer = await registry.resolve("auto", {
      onFallback: (report) => reports.push(report),
    });
    expect(renderer.capabilities.backend).toBe("webgl2");
    expect(built.has("webgpu")).toBe(false);
    expect(reports).toEqual([{ backend: "webgpu", reason: "unsupported" }]);
  });

  it("falls back when WebGPU initialization fails, disposing what it built (§62)", async () => {
    const { registry, built } = withBackends([
      { backend: "webgpu", failInitialize: true },
      { backend: "webgl2" },
    ]);
    const reports: RendererFallbackReport[] = [];
    const renderer = await registry.resolve("auto", {
      onFallback: (report) => reports.push(report),
    });
    expect(renderer.capabilities.backend).toBe("webgl2");
    expect(built.get("webgpu")?.disposeCount).toBe(1);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.backend).toBe("webgpu");
    expect(reports[0]?.reason).toBe("initialization-failed");
    expect((reports[0]?.error as Error).message).toBe("webgpu refused");
  });

  it("keeps walking when the failed backend also refuses to dispose (§83)", async () => {
    const { registry } = withBackends([
      { backend: "webgpu", failInitialize: true, failDispose: true },
      { backend: "webgl2" },
    ]);
    const renderer = await registry.resolve("auto");
    expect(renderer.capabilities.backend).toBe("webgl2");
  });

  it("never selects the headless tier", async () => {
    const { registry } = withBackends([{ backend: "null" }]);
    await expect(registry.resolve("auto")).rejects.toThrow(
      /found no usable backend/,
    );
  });

  it("names what is registered when nothing is left (§85)", async () => {
    const { registry } = withBackends([
      { backend: "webgpu", supported: false },
      { backend: "webgl2", failInitialize: true },
    ]);
    let thrown: unknown;
    try {
      await registry.resolve("auto");
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isFourError(thrown)).toBe(true);
    if (isFourError(thrown)) {
      expect(thrown.code).toBe("RENDERER_INITIALIZATION_FAILED");
      expect(thrown.message).toContain('Registered: "webgpu", "webgl2"');
      expect(thrown.message).toContain('"webgpu" (unsupported)');
      expect(thrown.message).toContain('"webgl2" (initialization-failed)');
      expect(thrown.context?.["tried"]).toEqual([
        { backend: "webgpu", reason: "unsupported" },
        { backend: "webgl2", reason: "initialization-failed" },
      ]);
      expect((thrown.cause as Error).message).toBe("webgl2 refused");
    }
  });

  it("says so when an empty registry is asked (§85)", async () => {
    const registry = new RendererRegistry();
    await expect(registry.resolve("auto")).rejects.toThrow(
      /Registered: none.*registerWebglRenderer/s,
    );
  });

  it("awaits an asynchronous create", async () => {
    const registry = new RendererRegistry();
    registry.register({
      backend: "webgl2",
      isSupported: () => true,
      create: () => Promise.resolve(new FakeBackend("webgl2")),
    });
    const renderer = await registry.resolve("auto");
    expect(renderer.capabilities.backend).toBe("webgl2");
  });
});

describe("resolve(name) — §62's fail-fast half", () => {
  it("builds the named backend even when an earlier one would win", async () => {
    const { registry } = withBackends([
      { backend: "webgpu" },
      { backend: "webgl2" },
    ]);
    const renderer = await registry.resolve("webgl2");
    expect(renderer.capabilities.backend).toBe("webgl2");
  });

  it("selects the headless tier when it is named", async () => {
    const { registry } = withBackends([{ backend: "null" }]);
    expect((await registry.resolve("null")).capabilities.backend).toBe("null");
  });

  it("rejects an unregistered name, listing what is registered (§85)", async () => {
    const { registry } = withBackends([{ backend: "webgl2" }]);
    let thrown: unknown;
    try {
      await registry.resolve("webgpu");
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isFourError(thrown)).toBe(true);
    if (isFourError(thrown)) {
      expect(thrown.code).toBe("RENDERER_INITIALIZATION_FAILED");
      expect(thrown.message).toContain('No "webgpu" renderer is registered');
      expect(thrown.message).toContain('Registered: "webgl2"');
      expect(thrown.context).toEqual({
        selection: "webgpu",
        registered: ["webgl2"],
      });
    }
  });

  it("rejects rather than downgrading when the named backend is unsupported (§62)", async () => {
    const { registry } = withBackends([
      { backend: "webgpu", supported: false },
      { backend: "webgl2" },
    ]);
    const onFallback = vi.fn();
    await expect(registry.resolve("webgpu", { onFallback })).rejects.toThrow(
      /cannot run it/,
    );
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("propagates the initialization failure unchanged (§89)", async () => {
    const { registry, built } = withBackends([
      { backend: "webgpu", failInitialize: true },
      { backend: "webgl2" },
    ]);
    await expect(registry.resolve("webgpu")).rejects.toThrow("webgpu refused");
    // Not disposed: an explicit selection hands the failure to the caller, who
    // still owns what they asked for.
    expect(built.get("webgpu")?.disposeCount).toBe(0);
  });
});

describe("the shared registry", () => {
  it("is empty until something registers, and is emptied again", () => {
    expect(registeredRenderers()).toEqual([]);
    registerRenderer({
      backend: "webgl2",
      isSupported: () => true,
      create: () => new NullRenderer(),
    });
    expect(registeredRenderers()).toEqual(["webgl2"]);
    clearRegisteredRenderers();
    expect(registeredRenderers()).toEqual([]);
  });

  it("is what registerRenderer returns, and reuses one instance", () => {
    const entry = {
      isSupported: () => true,
      create: () => new NullRenderer(),
    };
    const first = registerRenderer({ backend: "webgl2", ...entry });
    const second = registerRenderer({ backend: "svg", ...entry });
    expect(second).toBe(first);
    expect(first.backends).toEqual(["webgl2", "svg"]);
  });

  it("registers into an explicit registry when one is given", () => {
    const registry = new RendererRegistry();
    expect(
      registerRenderer(
        {
          backend: "webgl2",
          isSupported: () => true,
          create: () => new NullRenderer(),
        },
        registry,
      ),
    ).toBe(registry);
    expect(registeredRenderers()).toEqual([]);
    expect(registeredRenderers(registry)).toEqual(["webgl2"]);
  });
});

describe("resolveRenderer", () => {
  it("resolves against the shared registry", async () => {
    registerRenderer({
      backend: "webgl2",
      isSupported: () => true,
      create: () => new FakeBackend("webgl2"),
    });
    expect((await resolveRenderer("auto")).capabilities.backend).toBe("webgl2");
  });

  it("resolves against an explicit registry, ignoring the shared one", async () => {
    registerRenderer({
      backend: "webgpu",
      isSupported: () => true,
      create: () => new FakeBackend("webgpu"),
    });
    const { registry } = withBackends([{ backend: "webgl2" }]);
    expect(
      (await resolveRenderer("auto", undefined, registry)).capabilities.backend,
    ).toBe("webgl2");
  });

  it("says nothing is registered before any backend opts in (§85)", async () => {
    let thrown: unknown;
    try {
      await resolveRenderer("auto");
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isFourError(thrown)).toBe(true);
    if (isFourError(thrown)) {
      expect(thrown.code).toBe("RENDERER_INITIALIZATION_FAILED");
      expect(thrown.message).toContain("no backend is registered");
      expect(thrown.message).toContain("registerWebglRenderer()");
      expect(thrown.context).toEqual({ selection: "auto", registered: [] });
    }
  });
});

describe("the unregistered-backend message names the right register call", () => {
  // Cycle 9A: asking for "canvas2d" with nothing registered was told to call
  // `registerWebglRenderer()`. The registry knows which backend was asked
  // for; the advice now follows it. Selection behaviour is unchanged — every
  // case below still throws RENDERER_INITIALIZATION_FAILED.
  afterEach(() => {
    clearRegisteredRenderers();
  });

  it("points an unregistered webgpu selection at the webgpu registrar", async () => {
    await expect(resolveRenderer("webgpu")).rejects.toThrow(
      /registerWebgpuRenderer\(\).*render-webgpu/s,
    );
    await expect(resolveRenderer("webgpu")).rejects.toThrow(
      /no backend is registered/,
    );
  });

  it("points an unregistered webgl2 selection at the webgl registrar", async () => {
    await expect(resolveRenderer("webgl2")).rejects.toThrow(
      /registerWebglRenderer\(\).*render-webgl/s,
    );
  });

  for (const backend of ["canvas2d", "svg"] as const) {
    it(`says no fourJS package implements ${backend}, and names registerRenderer`, async () => {
      let thrown: unknown;
      try {
        await resolveRenderer(backend);
      } catch (error: unknown) {
        thrown = error;
      }
      expect(isFourError(thrown)).toBe(true);
      if (!isFourError(thrown)) return;
      expect(thrown.code).toBe("RENDERER_INITIALIZATION_FAILED");
      expect(thrown.message).toContain("No fourJS package implements");
      expect(thrown.message).toContain(`"${backend}"`);
      expect(thrown.message).toContain("reserved §102 stub");
      expect(thrown.message).toContain("registerRenderer(");
      // The wrong advice, in every rendering: it must not send a reader to
      // the WebGL or WebGPU package for a backend neither provides.
      expect(thrown.message).not.toContain("registerWebglRenderer");
      expect(thrown.message).not.toContain("registerWebgpuRenderer");
      expect(thrown.context).toEqual({ selection: backend, registered: [] });
    });
  }

  it("keeps the generic advice for auto, which names no backend", async () => {
    await expect(resolveRenderer("auto")).rejects.toThrow(
      /registerWebglRenderer\(\)/,
    );
  });

  it("follows the requested backend on a non-empty registry too", async () => {
    const registry = new RendererRegistry();
    registry.register({
      backend: "webgl2",
      isSupported: () => true,
      create: () => new NullRenderer(),
    });
    let thrown: unknown;
    try {
      await registry.resolve("canvas2d");
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isFourError(thrown)).toBe(true);
    if (!isFourError(thrown)) return;
    expect(thrown.message).toContain('No "canvas2d" renderer is registered');
    expect(thrown.message).toContain('Registered: "webgl2"');
    expect(thrown.message).toContain("No fourJS package implements");
    expect(thrown.message).not.toContain("registerWebglRenderer");
  });

  it("names the webgpu registrar for an unregistered webgpu on a live registry", async () => {
    const registry = new RendererRegistry();
    registry.register({
      backend: "webgl2",
      isSupported: () => true,
      create: () => new NullRenderer(),
    });
    await expect(registry.resolve("webgpu")).rejects.toThrow(
      /registerWebgpuRenderer\(\)/,
    );
  });
});
