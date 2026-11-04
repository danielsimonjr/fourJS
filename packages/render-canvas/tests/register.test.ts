import { isFourError } from "@fourjs/core";
import { RendererRegistry, registeredRenderers } from "@fourjs/render";
import { afterEach, describe, expect, it } from "vitest";

import {
  Canvas2dRenderer,
  isCanvas2dSupported,
  registerCanvasRenderer,
} from "../src/index.js";

const GLOBAL = globalThis as Record<string, unknown>;
const KEY = "CanvasRenderingContext2D";

afterEach(() => {
  delete GLOBAL[KEY];
});

describe("isCanvas2dSupported", () => {
  it("answers false without the constructor and true with it", () => {
    expect(isCanvas2dSupported()).toBe(false);
    expect(isCanvas2dSupported({ canvas: {} })).toBe(false);
    GLOBAL[KEY] = function CanvasRenderingContext2D(): void {};
    expect(isCanvas2dSupported()).toBe(true);
  });

  it("never touches the canvas it is given", () => {
    GLOBAL[KEY] = function CanvasRenderingContext2D(): void {};
    const canvas = {
      getContext(): never {
        throw new Error("the probe must not acquire a context");
      },
    };
    expect(isCanvas2dSupported({ canvas })).toBe(true);
  });
});

describe("registerCanvasRenderer", () => {
  it("registers into the registry it is given, leaving the shared one alone", () => {
    const registry = new RendererRegistry();
    expect(registerCanvasRenderer(registry)).toBe(registry);
    expect(registry.backends).toEqual(["canvas2d"]);
    expect(registeredRenderers()).toEqual([]);
  });

  it("builds without initializing or acquiring a context", () => {
    const registry = new RendererRegistry();
    registerCanvasRenderer(registry);
    const registration = registry.get("canvas2d");
    expect(registration?.isSupported({})).toBe(isCanvas2dSupported({}));
    const renderer = registration?.create() as Canvas2dRenderer;
    expect(renderer).toBeInstanceOf(Canvas2dRenderer);
    expect(renderer.initialized).toBe(false);
    renderer.dispose();
  });

  it("refuses a second registration in the same registry", () => {
    const registry = new RendererRegistry();
    registerCanvasRenderer(registry);
    let thrown: unknown;
    try {
      registerCanvasRenderer(registry);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isFourError(thrown)).toBe(true);
  });
});
