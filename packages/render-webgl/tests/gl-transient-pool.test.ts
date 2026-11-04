/** WebGL 2 §63 transient pool: no barriers, DEV-only feedback assertion (W6.1). */
import { resetDevWarnings } from "@fourjs/core";
import {
  RenderGraph,
  RenderTarget,
  type PassUsageRecord,
} from "@fourjs/render";
import { Scene } from "@fourjs/scene";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GlTransientTargetPool, WebglRenderer } from "../src/index.js";

const key = {
  width: 4,
  height: 4,
  format: "rgba8" as const,
  depth: true,
  depthTexture: false,
};
const usage = { sampled: true, attachment: true };
const rec = (reads: string[], writes: string | null): PassUsageRecord => ({
  pass: "p",
  index: 0,
  reads,
  writes,
});

afterEach(() => {
  resetDevWarnings();
  vi.restoreAllMocks();
});

describe("GlTransientTargetPool", () => {
  it("pools like the shared pool and warns once on sampled-while-attached", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pool = new GlTransientTargetPool();
    const t = pool.acquire(key, usage);
    pool.release(t);
    expect(pool.acquire(key, usage)).toBe(t);
    pool.beginPass(rec(["a"], "b"));
    pool.beginPass(rec([], null));
    expect(pool.feedbackViolations).toBe(0);
    pool.beginPass(rec(["a"], "a"));
    pool.beginPass(rec(["a"], "a"));
    expect(pool.feedbackViolations).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    pool.dispose();
  });

  it("is the renderer-owned pool, disposed with the renderer", () => {
    const renderer = new WebglRenderer();
    const pool = renderer.transientTargetPool();
    expect(renderer.transientTargetPool()).toBe(pool);
    const t: RenderTarget = pool.acquire(key, usage);
    renderer.dispose();
    expect(t.disposed).toBe(true);
  });

  it("a graph compiles its transients through that pool", () => {
    const renderer = new WebglRenderer();
    const graph = new RenderGraph();
    graph.addPass(
      "a",
      { root: new Scene(), views: [] },
      { transient: { width: 4, height: 4 } },
    );
    graph.compile(renderer);
    expect(renderer.transientTargetPool().byteLength).toBe(
      graph.transientByteLength,
    );
    renderer.dispose();
  });
});
