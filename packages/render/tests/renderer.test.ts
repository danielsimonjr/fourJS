import {
  EventEmitter,
  disposeAll,
  isFourError,
  type Disposable,
} from "@fourjs/core";
import {
  PerspectiveCamera,
  PoseBuffer,
  Scene,
  createFullscreenViewport,
  type Viewport,
} from "@fourjs/scene";
import { describe, expect, it, vi } from "vitest";

import {
  NullRenderer,
  RenderTarget,
  type RenderInterpolation,
  type Renderer,
  type RendererCapabilities,
  type RendererEventMap,
  type RendererOptions,
} from "../src/index.js";

function fixture(): {
  renderer: NullRenderer;
  scene: Scene;
  views: Viewport[];
} {
  const scene = new Scene();
  const camera = new PerspectiveCamera({ aspect: 16 / 9 });
  scene.add(camera);
  return {
    renderer: new NullRenderer(),
    scene,
    views: [createFullscreenViewport(camera)],
  };
}

describe("Renderer (§61) — interface conformance", () => {
  it("is satisfied by NullRenderer at compile time and at runtime", () => {
    // The assignment is the compile-time half: if `NullRenderer` drifted from
    // the interface, `tsc` fails here rather than in a backend six packets from
    // now.
    const renderer: Renderer = new NullRenderer();

    expect(typeof renderer.initialize).toBe("function");
    expect(typeof renderer.render).toBe("function");
    expect(typeof renderer.resize).toBe("function");
    expect(typeof renderer.dispose).toBe("function");
    expect(renderer.events).toBeInstanceOf(EventEmitter);
    expect(renderer.capabilities).toBeTypeOf("object");
  });

  it("declares the §43 interpolation argument on the interface itself", () => {
    // Called through the `Renderer` type, not through `NullRenderer`: if the
    // third parameter lived only on the class, this would not compile — and a
    // backend author reading the interface would never know to accept it.
    const backend: NullRenderer = new NullRenderer();
    const renderer: Renderer = backend;
    const { scene, views } = fixture();
    const poseBuffer = new PoseBuffer();

    renderer.render(scene, views, { poseBuffer, alpha: 0.5 });

    expect(backend.lastInterpolation).toEqual({ poseBuffer, alpha: 0.5 });
  });

  it("is a Disposable, so ownership helpers accept it (§83)", () => {
    const renderer = new NullRenderer();
    const disposables: Disposable[] = [renderer];

    disposeAll(disposables);

    expect(renderer.disposed).toBe(true);
  });

  it("accepts a canvas of any shape in its options, with no DOM types", () => {
    // `RendererOptions.canvas` is `unknown` on purpose (no `lib.dom` in this
    // package): every one of these type-checks, and narrowing is each backend's
    // job.
    const options: RendererOptions[] = [
      {},
      { antialias: true },
      { canvas: { width: 1, height: 1 }, antialias: false },
      { canvas: "#canvas" },
    ];

    expect(options).toHaveLength(4);
  });
});

describe("RendererCapabilities (§62)", () => {
  it("reports the null backend tier and its texture limit", () => {
    const { renderer } = fixture();
    const capabilities: RendererCapabilities = renderer.capabilities;

    expect(capabilities.backend).toBe("null");
    expect(capabilities.maxTextureSize).toBe(0);
    // §62's whole list, answered rather than omitted (WP-R1.1, 2026-08-21).
    // The key set is asserted — not just the values — because the point of the
    // conformance fixture is that a backend author reads a *complete* record
    // off it: a member added to the interface and forgotten here would leave
    // the reference implementation quietly incomplete.
    expect(Object.keys(capabilities).sort()).toEqual([
      "backend",
      "compressedTextureFormats",
      "computeShaders",
      "floatRenderTargets",
      "floatTextures",
      "indirectDraw",
      "maxAnisotropy",
      "maxBindings",
      "maxTextureSize",
      "maxUniformBufferBytes",
      "maximumSkinningJoints",
      "maximumTextureSkinningJoints",
      "multisampling",
      "shaderPrecision",
      "storageBuffers",
      "textureFormats",
      "timestampQueries",
    ]);
  });

  it("answers every §62 member with the headless floor", () => {
    const { renderer } = fixture();
    const capabilities = renderer.capabilities;

    // No device, no shader stage, no surface: "no" and "zero" are the literal
    // truth here rather than conservative guesses.
    expect(capabilities.textureFormats).toEqual([]);
    expect(capabilities.compressedTextureFormats).toEqual([]);
    expect(capabilities.multisampling).toBe(false);
    expect(capabilities.floatRenderTargets).toBe(false);
    expect(capabilities.timestampQueries).toBe(false);
    expect(capabilities.storageBuffers).toBe(false);
    expect(capabilities.computeShaders).toBe(false);
    expect(capabilities.indirectDraw).toBe(false);
    expect(capabilities.shaderPrecision).toBe("none");
    expect(capabilities.maxUniformBufferBytes).toBe(0);
    expect(capabilities.maxBindings).toBe(0);
    // §54's joint limit (RFC 0003): `0` — skinning unsupported — is the
    // headless floor, distinct from the `undefined` a backend that has not
    // been taught to answer reports.
    expect(capabilities.maximumSkinningJoints).toBe(0);
    // Headless floor: no device, no extension — isotropic filtering only.
    expect(capabilities.maxAnisotropy).toBe(1);
  });

  it("is frozen, and survives disposal", () => {
    const { renderer } = fixture();
    const capabilities = renderer.capabilities;

    expect(Object.isFrozen(capabilities)).toBe(true);
    renderer.dispose();
    expect(renderer.capabilities).toBe(capabilities);
  });
});

describe("NullRenderer — call recording", () => {
  it("starts with nothing recorded", () => {
    const { renderer } = fixture();

    expect(renderer.initializeCount).toBe(0);
    expect(renderer.lastInitializeOptions).toBeNull();
    expect(renderer.renderCount).toBe(0);
    expect(renderer.lastRenderRoot).toBeNull();
    expect(renderer.lastViews).toBeNull();
    expect(renderer.resizeCount).toBe(0);
    expect(renderer.lastResize).toBeNull();
    expect(renderer.disposed).toBe(false);
  });

  it("resolves initialize immediately and records its options", async () => {
    const { renderer } = fixture();
    const options: RendererOptions = { canvas: { id: "surface" } };

    const pending = renderer.initialize(options);

    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).resolves.toBeUndefined();
    expect(renderer.initializeCount).toBe(1);
    expect(renderer.lastInitializeOptions).toBe(options);
  });

  it("records an omitted options argument as null", async () => {
    const { renderer } = fixture();

    await renderer.initialize();

    expect(renderer.initializeCount).toBe(1);
    expect(renderer.lastInitializeOptions).toBeNull();
  });

  it("records the root and views of every render call", () => {
    const { renderer, scene, views } = fixture();

    renderer.render(scene, views);
    renderer.render(scene, views);

    expect(renderer.renderCount).toBe(2);
    expect(renderer.lastRenderRoot).toBe(scene);
    // Retained, not copied: callers reuse a per-frame array.
    expect(renderer.lastViews).toBe(views);
  });

  it("records a render with no views (which draws and clears nothing)", () => {
    const { renderer, scene } = fixture();

    renderer.render(scene, []);

    expect(renderer.renderCount).toBe(1);
    expect(renderer.lastViews).toEqual([]);
  });

  it("defaults resize's resolution to 1 and records explicit values", () => {
    const { renderer } = fixture();

    renderer.resize(800, 600);
    expect(renderer.lastResize).toEqual({
      width: 800,
      height: 600,
      resolution: 1,
    });

    renderer.resize(1024, 768, 2);
    expect(renderer.lastResize).toEqual({
      width: 1024,
      height: 768,
      resolution: 2,
    });
    expect(renderer.resizeCount).toBe(2);
  });

  it("records the §43 interpolation record a frame passed (not copied)", () => {
    const { renderer, scene, views } = fixture();
    const interpolation: RenderInterpolation = {
      poseBuffer: new PoseBuffer(),
      alpha: 0.25,
    };

    renderer.render(scene, views, interpolation);

    expect(renderer.renderCount).toBe(1);
    // Retained, not copied: `Application` reuses one record per frame (D7).
    expect(renderer.lastInterpolation).toBe(interpolation);
  });

  it("records null for a render that passed no interpolation, clearing the last", () => {
    const { renderer, scene, views } = fixture();

    expect(renderer.lastInterpolation).toBeNull();
    renderer.render(scene, views, { poseBuffer: new PoseBuffer(), alpha: 1 });
    expect(renderer.lastInterpolation).not.toBeNull();

    // A later non-interpolated frame must not leave the previous record
    // standing, or a test would pass for the wrong reason.
    renderer.render(scene, views);

    expect(renderer.lastInterpolation).toBeNull();
    expect(renderer.renderCount).toBe(2);
  });

  it("records the R-4 render target a frame passed, clearing the last", () => {
    const { renderer, scene, views } = fixture();
    const target = new RenderTarget({ width: 64, height: 64 });

    expect(renderer.lastRenderTarget).toBeNull();
    renderer.render(scene, views, undefined, target);
    expect(renderer.lastRenderTarget).toBe(target);

    // A later on-screen frame must not leave the off-screen pass's target
    // standing — the rule `lastInterpolation` already follows.
    renderer.render(scene, views);

    expect(renderer.lastRenderTarget).toBeNull();
    expect(renderer.renderCount).toBe(2);
    target.dispose();
  });

  it("accepts an explicit null target as 'draw to the surface'", () => {
    const { renderer, scene, views } = fixture();

    renderer.render(scene, views, undefined, null);

    expect(renderer.lastRenderTarget).toBeNull();
    expect(renderer.renderCount).toBe(1);
  });

  it("draws nothing — the scene is untouched by a render", () => {
    const { renderer, scene, views } = fixture();
    const before = scene.transform.version;

    renderer.render(scene, views);

    expect(scene.transform.version).toBe(before);
    expect(scene.children).toHaveLength(1);
  });
});

describe("NullRenderer — disposal (§83)", () => {
  it("is idempotent", () => {
    const { renderer } = fixture();

    renderer.dispose();
    expect(renderer.disposed).toBe(true);
    expect(() => {
      renderer.dispose();
    }).not.toThrow();
    expect(renderer.disposed).toBe(true);
  });

  it("drops every listener", () => {
    const { renderer } = fixture();
    renderer.events.on("contextlost", vi.fn());
    renderer.events.on("contextrestored", vi.fn());

    renderer.dispose();

    expect(renderer.events.listenerCount("contextlost")).toBe(0);
    expect(renderer.events.listenerCount("contextrestored")).toBe(0);
  });

  it("keeps recorded data readable after disposal", () => {
    const { renderer, scene, views } = fixture();
    renderer.render(scene, views);

    renderer.dispose();

    expect(renderer.renderCount).toBe(1);
    expect(renderer.lastRenderRoot).toBe(scene);
  });

  it("makes every other method throw INVALID_APPLICATION_STATE", () => {
    const { renderer, scene, views } = fixture();
    renderer.dispose();

    const calls: [string, () => unknown][] = [
      ["initialize", () => renderer.initialize()],
      [
        "render",
        () => {
          renderer.render(scene, views);
        },
      ],
      [
        "resize",
        () => {
          renderer.resize(1, 1);
        },
      ],
    ];

    for (const [method, call] of calls) {
      let thrown: unknown;
      try {
        call();
      } catch (error) {
        thrown = error;
      }
      expect(isFourError(thrown), method).toBe(true);
      if (isFourError(thrown)) {
        expect(thrown.code).toBe("INVALID_APPLICATION_STATE");
        expect(thrown.context).toEqual({ method, disposed: true });
      }
    }

    expect(renderer.renderCount).toBe(0);
    expect(renderer.initializeCount).toBe(0);
    expect(renderer.resizeCount).toBe(0);
  });
});

describe("Renderer events (§61 context loss, §6b)", () => {
  it("round-trips contextlost and contextrestored through the emitter", () => {
    const { renderer } = fixture();
    const seen: string[] = [];

    renderer.events.on("contextlost", (event) => {
      seen.push(`lost:${event.renderer.capabilities.backend}`);
    });
    renderer.events.on("contextrestored", (event) => {
      seen.push(`restored:${event.renderer.capabilities.backend}`);
    });

    renderer.events.emit("contextlost", { renderer });
    renderer.events.emit("contextrestored", { renderer });

    expect(seen).toEqual(["lost:null", "restored:null"]);
  });

  it("returns a working unsubscriber (§6b rule 1)", () => {
    const { renderer } = fixture();
    const listener = vi.fn();
    const off = renderer.events.on("contextlost", listener);

    renderer.events.emit("contextlost", { renderer });
    off();
    renderer.events.emit("contextlost", { renderer });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("identifies which renderer lost its context", () => {
    const first = new NullRenderer();
    const second = new NullRenderer();
    const shared = vi.fn<(event: RendererEventMap["contextlost"]) => void>();
    first.events.on("contextlost", shared);
    second.events.on("contextlost", shared);

    second.events.emit("contextlost", { renderer: second });

    expect(shared).toHaveBeenCalledTimes(1);
    expect(shared.mock.calls[0][0].renderer).toBe(second);
  });

  it("emits nothing of its own — a null backend has no context to lose", () => {
    const { renderer, scene, views } = fixture();
    const lost = vi.fn();
    const restored = vi.fn();
    renderer.events.on("contextlost", lost);
    renderer.events.on("contextrestored", restored);

    void renderer.initialize({ antialias: true });
    renderer.render(scene, views);
    renderer.resize(320, 240, 2);
    renderer.dispose();

    expect(lost).not.toHaveBeenCalled();
    expect(restored).not.toHaveBeenCalled();
  });
});
