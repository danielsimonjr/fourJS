/** WebGPU §63 transient pool: usage chosen up front, pass-boundary barriers (W6.1). */
import { RenderGraph, RenderTarget } from "@fourjs/render";
import { Scene } from "@fourjs/scene";
import { describe, expect, it } from "vitest";

import {
  WebgpuRenderer,
  WgpuTransientTargetPool,
  transientUsageOf,
} from "../src/index.js";

const key = {
  width: 4,
  height: 4,
  format: "rgba8" as const,
  depth: true,
  depthTexture: false,
};
const RENDER_ATTACHMENT = 0x10;
const TEXTURE_BINDING = 0x04;
const COPY_SRC = 0x01;

describe("WgpuTransientTargetPool", () => {
  it("allocates sampled slots with TEXTURE_BINDING and attachment-only without", () => {
    const pool = new WgpuTransientTargetPool();
    const sampled = pool.acquire(key, { sampled: true, attachment: true });
    const plain = pool.acquire(key, { sampled: false, attachment: true });
    expect(transientUsageOf(sampled)).toBe(
      RENDER_ATTACHMENT | TEXTURE_BINDING | COPY_SRC,
    );
    expect(transientUsageOf(plain)).toBe(RENDER_ATTACHMENT | COPY_SRC);
    expect(
      transientUsageOf(new RenderTarget({ width: 1, height: 1 })),
    ).toBeUndefined();
    pool.dispose();
  });

  it("counts passes and usage transitions per frame", () => {
    const pool = new WgpuTransientTargetPool();
    const frame = (): void => {
      pool.beginPass({ pass: "a", index: 0, reads: [], writes: "x" });
      pool.beginPass({ pass: "b", index: 1, reads: ["x"], writes: "y" });
      pool.beginPass({ pass: "c", index: 2, reads: ["x"], writes: null });
    };
    frame();
    expect(pool.passCount).toBe(3);
    expect(pool.transitionCount).toBe(3);
    frame();
    expect(pool.transitionCount).toBe(6);
  });

  it("is the renderer-owned pool and a graph uses it", () => {
    const renderer = new WebgpuRenderer();
    const graph = new RenderGraph();
    graph.addPass(
      "a",
      { root: new Scene(), views: [] },
      { transient: { width: 4, height: 4 } },
    );
    graph.addPass("b", { root: new Scene(), views: [] }, { inputs: ["a"] });
    graph.compile(renderer);
    expect(
      transientUsageOf(graph.transientTarget("a")!)! & TEXTURE_BINDING,
    ).toBe(TEXTURE_BINDING);
    expect(renderer.transientTargetPool()).toBe(renderer.transientTargetPool());
    const t = graph.transientTarget("a")!;
    renderer.dispose();
    expect(t.disposed).toBe(true);
  });
});
