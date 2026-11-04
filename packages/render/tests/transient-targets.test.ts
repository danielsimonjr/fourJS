/** §63 transient pooling, aliasing and usage transitions (W6.1). */
import { FourError } from "@fourjs/core";
import { Scene, createFullscreenViewport } from "@fourjs/scene";
import { describe, expect, it, vi } from "vitest";

import {
  COPY_EFFECT,
  NullRenderer,
  RenderGraph,
  RenderTarget,
  RenderTargetPool,
  planTransientSlots,
  resolveTransientSpec,
  transientKeyString,
  type EffectRenderPass,
  type PassUsageRecord,
  type Renderer,
} from "../src/index.js";

const spec = { width: 64, height: 32 };
const view = createFullscreenViewport(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  undefined as any,
);
void view;

function chain(): { graph: RenderGraph; scene: Scene } {
  const scene = new Scene();
  const graph = new RenderGraph();
  const views = [] as never[];
  graph.addPass("a", { root: scene, views }, { transient: spec });
  graph.addPass(
    "b",
    { root: scene, views },
    { transient: spec, inputs: ["a"] },
  );
  graph.addPass(
    "c",
    { root: scene, views },
    { transient: spec, inputs: ["b"] },
  );
  graph.addPass(
    "d",
    { root: scene, views },
    { transient: spec, inputs: ["c"] },
  );
  return { graph, scene };
}

describe("planTransientSlots", () => {
  it("aliases non-overlapping lifetimes, first-fit, deterministic", () => {
    const key = {
      width: 4,
      height: 4,
      format: "rgba8" as const,
      depth: true,
      depthTexture: false,
    };
    const r = (name: string, first: number, last: number, k = key) => ({
      name,
      key: k,
      first,
      last,
    });
    const { slots, assignment } = planTransientSlots([
      r("a", 0, 1),
      r("b", 1, 2),
      r("c", 2, 3),
      r("d", 3, 3),
    ]);
    expect(slots.map((s) => s.names)).toEqual([
      ["a", "c"],
      ["b", "d"],
    ]);
    expect(assignment.get("d")).toBe(1);
    const other = { ...key, width: 8 };
    expect(
      planTransientSlots([r("a", 0, 0), r("b", 5, 5, other)]).slots,
    ).toHaveLength(2);
  });
});

describe("resolveTransientSpec", () => {
  it("resolves scale against the view and validates", () => {
    expect(
      resolveTransientSpec(
        { scale: 0.5 },
        { width: 101, height: 50 },
        "p",
        "INVALID_RENDER_GRAPH",
      ),
    ).toMatchObject({ width: 51, height: 25, depth: true });
    expect(
      resolveTransientSpec(
        { width: 2, height: 2, depth: false, depthTexture: true },
        undefined,
        "p",
        "INVALID_RENDER_GRAPH",
      ).depth,
    ).toBe(true);
    expect(() =>
      resolveTransientSpec(
        { scale: 0 },
        { width: 1, height: 1 },
        "p",
        "INVALID_RENDER_GRAPH",
      ),
    ).toThrow(FourError);
    expect(() =>
      resolveTransientSpec(
        { scale: 1 },
        undefined,
        "p",
        "INVALID_RENDER_GRAPH",
      ),
    ).toThrow(FourError);
  });
  it("keys are stable strings", () => {
    expect(
      transientKeyString({
        width: 1,
        height: 2,
        format: "rgba8",
        depth: true,
        depthTexture: false,
      }),
    ).toBe("1x2:rgba8:d1t0");
  });
});

describe("RenderTargetPool", () => {
  const key = {
    width: 8,
    height: 8,
    format: "rgba8" as const,
    depth: true,
    depthTexture: false,
  };
  const usage = { sampled: true, attachment: true };
  it("reuses released targets without allocating, and disposes", () => {
    const pool = new RenderTargetPool();
    const t = pool.acquire(key, usage);
    expect(pool.byteLength).toBe(t.byteLength);
    pool.release(t);
    pool.release(t);
    pool.release(new RenderTarget({ width: 1, height: 1 }));
    expect(pool.acquire(key, usage)).toBe(t);
    expect(pool.allocations).toBe(1);
    pool.release(t);
    t.dispose();
    pool.release(t);
    expect(pool.acquire(key, usage)).not.toBe(t);
    pool.dispose();
    expect(pool.byteLength).toBe(0);
  });
});

describe("RenderGraph transients", () => {
  it("aliases a linear chain onto two slots and reports it", () => {
    const { graph } = chain();
    const renderer = new NullRenderer();
    const plan = graph.compile(renderer);
    expect(plan?.slots).toHaveLength(2);
    expect(plan?.byteLength).toBe(plan!.unaliasedByteLength / 2);
    expect(graph.transientTarget("a")).toBe(graph.transientTarget("c"));
    expect(graph.transientTarget("a")).not.toBe(graph.transientTarget("b"));
    expect(graph.describe()).toContain("transients: 4 targets -> 2 slots");
    expect(graph.describe()).toContain("slot 0 [64x32:rgba8:d1t0] <- a, c");
    expect(graph.transientByteLength).toBe(plan!.byteLength);
  });

  it("executes into the slots, persists them across frames, and recompiles on change", () => {
    const { graph, scene } = chain();
    const renderer = new NullRenderer();
    const pool = renderer.transientTargetPool();
    graph.execute(renderer);
    const first = graph.transientTarget("a");
    expect(renderer.lastRenderTarget).toBe(graph.transientTarget("d"));
    const before = (pool as RenderTargetPool).allocations;
    graph.execute(renderer);
    expect(graph.transientTarget("a")).toBe(first);
    expect((pool as RenderTargetPool).allocations).toBe(before);
    graph.addPass(
      "e",
      { root: scene, views: [] },
      { transient: spec, inputs: ["d"] },
    );
    graph.execute(renderer);
    expect((pool as RenderTargetPool).allocations).toBe(before); // freed slots reused
    graph.dispose();
    expect(graph.transientTarget("a")).toBeUndefined();
    expect(graph.transientByteLength).toBe(0);
  });

  it("uses a graph-owned pool for a renderer without one, and a custom pass sees its target", () => {
    const renderer = new NullRenderer();
    const bare: Renderer = renderer;
    (bare as { transientTargetPool?: unknown }).transientTargetPool = undefined;
    const graph = new RenderGraph();
    let seen: RenderTarget | null = null;
    graph.addPass(
      "c",
      {
        kind: "custom",
        execute: (_r, ctx) => {
          seen = ctx.target;
        },
      },
      { transient: spec },
    );
    graph.addPass("s", { root: new Scene(), views: [] });
    graph.execute(bare);
    expect(seen).toBe(graph.transientTarget("c"));
    graph.dispose();
  });

  it("resolves scale from the view size and recompiles when it changes", () => {
    const graph = new RenderGraph();
    graph.addPass(
      "half",
      { root: new Scene(), views: [] },
      { transient: { scale: 0.5 } },
    );
    const renderer = new NullRenderer();
    expect(graph.describe()).toContain("unresolved");
    expect(() => graph.compile(renderer)).toThrow(FourError);
    graph.execute(renderer, undefined, { width: 100, height: 60 });
    expect(graph.transientTarget("half")?.width).toBe(50);
    graph.execute(renderer);
    expect(graph.transientTarget("half")?.width).toBe(50);
    expect(graph.describe()).toContain("50x30");
    graph.execute(renderer, undefined, { width: 200, height: 60 });
    expect(graph.transientTarget("half")?.width).toBe(100);
  });

  it("effect passes: transient output and transient source are substituted", () => {
    const graph = new RenderGraph();
    const placeholder = new RenderTarget({ width: 1, height: 1 });
    graph.addPass(
      "world",
      { root: new Scene(), views: [] },
      { transient: spec },
    );
    const effect: EffectRenderPass = {
      kind: "effect",
      source: placeholder.colorTexture,
      effect: COPY_EFFECT,
    };
    graph.addPass("copy", effect, {
      inputs: ["world"],
      transient: spec,
      sourceTransient: "world",
    });
    graph.addPass("out", { ...effect }, { inputs: ["copy"] });
    const calls: EffectRenderPass[] = [];
    const renderer = new NullRenderer();
    const original = renderer.renderEffect.bind(renderer);
    renderer.renderEffect = (p) => {
      calls.push(p);
      original(p);
    };
    graph.execute(renderer);
    expect(calls[0].source).toBe(graph.transientTarget("world")!.colorTexture);
    expect(calls[0].target).toBe(graph.transientTarget("copy"));
    expect(calls[1]).toBe(graph.passes[2].pass);
    // sourceTransient without a transient on the plain path uses pass.source
    const seq = graph.usageTransitions().map((t) => `${t.pass}:${t.to}`);
    expect(seq.slice(0, 4)).toEqual([
      "world:attachment",
      "copy:texture",
      "copy:attachment",
      "out:texture",
    ]);
  });

  it("rejects bad declarations", () => {
    const g = new RenderGraph();
    const t = new RenderTarget({ width: 1, height: 1 });
    expect(() =>
      g.addPass(
        "x",
        { root: new Scene(), views: [], target: t },
        { transient: spec },
      ),
    ).toThrow(FourError);
    g.addPass("plain", { root: new Scene(), views: [] });
    const effect: EffectRenderPass = {
      kind: "effect",
      source: t.colorTexture,
      effect: COPY_EFFECT,
    };
    expect(() => g.addPass("e1", effect, { sourceTransient: "plain" })).toThrow(
      FourError,
    );
    expect(() =>
      g.addPass("e2", effect, { inputs: ["plain"], sourceTransient: "plain" }),
    ).toThrow(FourError);
    expect(() =>
      g.addPass(
        "e3",
        { root: new Scene(), views: [] },
        { inputs: ["plain"], sourceTransient: "plain" },
      ),
    ).toThrow(FourError);
  });

  it("graphs without transients never touch a pool and call the renderer identically", () => {
    const renderer = new NullRenderer();
    const spy = vi.spyOn(renderer, "transientTargetPool");
    const t = new RenderTarget({ width: 4, height: 4 });
    const scene = new Scene();
    const g = new RenderGraph();
    g.addPass("w", { root: scene, views: [], target: t });
    g.addPass("s", { root: scene, views: [] }, { inputs: ["w"] });
    expect(g.compile(renderer)).toBeNull();
    g.execute(renderer);
    expect(spy).not.toHaveBeenCalled();
    expect(renderer.renderCount).toBe(2);
    expect(g.describe()).not.toContain("transients");
    expect(g.usageTransitions()).toEqual([
      { pass: "w", target: t.id, from: "none", to: "attachment" },
      { pass: "s", target: t.id, from: "attachment", to: "texture" },
    ]);
    g.removePass("s");
    expect(g.usagePlan()).toHaveLength(1);
  });

  it("transitions skip disabled passes; beginPass hook receives records", () => {
    const { graph } = chain();
    expect(graph.usagePlan()[1].reads).toEqual(["transient:a"]);
    const records: PassUsageRecord[] = [];
    const renderer = new NullRenderer();
    const pool = renderer.transientTargetPool();
    pool.beginPass = (r) => records.push(r);
    graph.setPassEnabled("b", false);
    graph.execute(renderer);
    expect(records.map((r) => r.pass)).toEqual(["a", "c", "d"]);
    const ids = graph.usageTransitions().map((t) => t.pass);
    expect(ids).not.toContain("b");
    expect(
      graph
        .usageTransitions()
        .some((t) => t.from === "texture" && t.to === "attachment"),
    ).toBe(true);
  });
});
