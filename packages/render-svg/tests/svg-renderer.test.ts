import { isFourError, resetDevWarnings } from "@fourjs/core";
import { RendererRegistry, createRenderStatistics } from "@fourjs/render";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PACKAGE_NAME,
  SvgRenderer,
  isSvgSupported,
  isSvgSurface,
  registerSvgRenderer,
} from "../src/index.js";
import {
  FakeSurface,
  TestGeometry,
  sceneOf,
  triangle,
  views,
} from "./helpers.js";

afterEach(() => {
  resetDevWarnings();
  vi.restoreAllMocks();
});

async function make(): Promise<{ s: FakeSurface; r: SvgRenderer }> {
  const s = new FakeSurface();
  const r = new SvgRenderer();
  await r.initialize({ canvas: s });
  return { s, r };
}

describe("SvgRenderer", () => {
  it("exposes its name and capabilities", () => {
    expect(PACKAGE_NAME).toBe("@fourjs/render-svg");
    expect(new SvgRenderer().capabilities.backend).toBe("svg");
  });

  it("projects a known triangle (Y-up flipped into SVG space)", async () => {
    const { s, r } = await make();
    r.render(sceneOf(triangle()), views([0, 0, 0, 1]));
    // ndc = world/2; px = (ndc+1)/2*100; py = (1-ndc)/2*100.
    expect(s.children[1].tag).toBe("polygon");
    expect(s.children[1].attrs.get("points")).toBe("25,75 75,75 50,25");
    expect(s.children[1].attrs.get("fill")).toBe("rgb(255,0,0)");
    expect(s.children[0].attrs.get("width")).toBe("100");
    expect(s.attrs.get("viewBox")).toBe("0 0 100 100");
  });

  it("has one more element than the empty-scene control, per triangle", async () => {
    const control = await make();
    control.r.render(sceneOf(), views([0, 0, 0, 1]));
    expect(control.s.children).toHaveLength(1);
    const { s, r } = await make();
    r.render(sceneOf(triangle(), triangle()), views([0, 0, 0, 1]));
    expect(s.children).toHaveLength(3);
    expect(r.elementCount).toBe(3);
  });

  it("reuses polygon elements and writes nothing on an identical frame", async () => {
    const { s, r } = await make();
    const scene = sceneOf(triangle(), triangle());
    r.render(scene, views([0, 0, 0, 1]));
    const first = [...s.children];
    const writes = first.map((c) => c.writes);
    const created = s.created;
    r.render(scene, views([0, 0, 0, 1]));
    expect(s.children.every((c, i) => c === first[i])).toBe(true);
    expect(s.created).toBe(created);
    expect(s.children.map((c) => c.writes)).toEqual(writes);
  });

  it("grows when the item count grows and removes extras when it shrinks", async () => {
    const { s, r } = await make();
    const a = triangle();
    const b = triangle();
    const scene = sceneOf(a, b);
    r.render(scene, views());
    expect(s.children).toHaveLength(2);
    const keep = s.children[0];
    scene.remove(b);
    r.render(scene, views());
    expect(s.children).toEqual([keep]);
    scene.add(b);
    scene.add(triangle());
    r.render(scene, views());
    expect(s.children).toHaveLength(3);
    expect(s.children[0]).toBe(keep);
  });

  it("serializes byte-identically over two runs", async () => {
    const out: string[] = [];
    for (let run = 0; run < 2; run += 1) {
      const { s, r } = await make();
      const scene = sceneOf(triangle(), triangle());
      r.render(scene, views([0.1, 0.2, 0.3, 1]));
      r.render(scene, views([0.1, 0.2, 0.3, 1]));
      out.push(s.outerHTML);
    }
    expect(out[0]).toBe(out[1]);
  });

  it("indexed geometry, opacity, behind-camera culling and fill changes", async () => {
    const { s, r } = await make();
    const geometry = new TestGeometry(
      new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0, 0, 0, -1e9]),
      new Uint16Array([0, 1, 2, 0, 1, 3]),
    );
    const material = {
      color: [0, 1, 0, 1] as [number, number, number, number],
      opacity: 0.5,
    };
    const scene = sceneOf(triangle(material, geometry));
    r.render(scene, views());
    expect(s.children).toHaveLength(2);
    expect(s.children[0].attrs.get("fill-opacity")).toBe("0.5");
    material.color = [0, 0, 1, 1];
    r.render(scene, views());
    expect(s.children[0].attrs.get("fill")).toBe("rgb(0,0,255)");
  });

  it("switches a slot's tag when the view stops clearing", async () => {
    const { s, r } = await make();
    const scene = sceneOf(triangle());
    r.render(scene, views([0, 0, 0, 1]));
    expect(s.children.map((c) => c.tag)).toEqual(["rect", "polygon"]);
    r.render(scene, views());
    expect(s.children.map((c) => c.tag)).toEqual(["polygon"]);
  });

  it("counts statistics and skips unsupported kinds with one warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { s, r } = await make();
    const stats = createRenderStatistics();
    r.statistics = stats;
    const lines = new TestGeometry(new Float32Array(6));
    lines.mode = "lines";
    const scene = sceneOf(triangle(), triangle(undefined, lines));
    r.render(scene, views());
    r.render(scene, views());
    expect(stats.drawCalls).toBe(2);
    expect(stats.triangles).toBe(2);
    expect(r.skippedItems).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(s.children).toHaveLength(1);
  });

  it("handles interpolation, normalized and empty views, and resize", async () => {
    const { s, r } = await make();
    const scene = sceneOf(triangle());
    r.render(scene, []);
    expect(s.children).toHaveLength(0);
    r.resize(200, 100, 2);
    expect(s.attrs.get("width")).toBe("200");
    expect(s.attrs.get("viewBox")).toBe("0 0 400 200");
    r.render(
      scene,
      views(undefined, { normalized: true, x: 0, y: 0, width: 1, height: 1 }),
    );
    expect(s.children[0].attrs.get("points")).toBe("100,150 300,150 200,50");
    const poseBuffer = { composeRenderPoseMatrix: vi.fn() };
    expect(() =>
      r.render(scene, views(), { poseBuffer: poseBuffer as never, alpha: 0.5 }),
    ).toThrow();
  });

  it("sizes itself from non-normalized views when never resized", async () => {
    const { s, r } = await make();
    r.render(sceneOf(), views(undefined, { width: 0, height: 0 }));
    expect(s.attrs.get("viewBox")).toBe("0 0 1 1");
    const t = await make();
    t.r.render(sceneOf(), views(undefined, { normalized: true }));
    expect(t.s.attrs.get("viewBox")).toBe("0 0 1 1");
  });

  it("initialize rejects without a surface; render before initialize throws", async () => {
    const r = new SvgRenderer();
    let error: unknown;
    await r.initialize({ canvas: 42 }).catch((e: unknown) => (error = e));
    expect(isFourError(error) && error.code).toBe(
      "RENDERER_INITIALIZATION_FAILED",
    );
    expect(() => r.render(sceneOf(), views())).toThrow(/before initialize/);
  });

  it("dispose removes elements, is idempotent, and is terminal", async () => {
    const { s, r } = await make();
    r.render(sceneOf(triangle()), views([0, 0, 0, 1]));
    r.dispose();
    r.dispose();
    expect(s.children).toHaveLength(0);
    expect(r.disposed).toBe(true);
    expect(() => r.render(sceneOf(), views())).toThrow(/disposed/);
    expect(() => r.resize(1, 1)).toThrow(/disposed/);
    await expect(Promise.resolve().then(() => r.initialize())).rejects.toThrow(
      /disposed/,
    );
  });

  it("resize before initialize only records the size", () => {
    const r = new SvgRenderer(new FakeSurface());
    r.resize(10, 10);
    expect(r.elementCount).toBe(0);
    new SvgRenderer().resize(5, 5);
  });
});

describe("SvgRenderer edge cases", () => {
  it("takes the surface from its constructor", async () => {
    const s = new FakeSurface();
    const r = new SvgRenderer(s);
    await r.initialize();
    r.render(sceneOf(triangle()), views());
    expect(s.children).toHaveLength(1);
  });

  it("drops triangles at or behind the camera plane", async () => {
    const { s, r } = await make();
    const v = views();
    const cam = v[0].camera as unknown as {
      projectionMatrix: { elements: Float64Array };
    };
    cam.projectionMatrix.elements[11] = -1; // w = -z
    cam.projectionMatrix.elements[15] = 0;
    r.render(sceneOf(triangle()), v);
    expect(s.children).toHaveLength(0);
  });

  it("never writes a negative zero", async () => {
    const { s, r } = await make();
    const g = new TestGeometry(
      new Float32Array([-0.00001, -2, 0, 1, -1, 0, 0, 1, 0]),
    );
    r.render(sceneOf(triangle(undefined, g)), views());
    expect(s.children[0].attrs.get("points")).toMatch(/^50,100 /);
    expect(s.children[0].attrs.get("points")).not.toContain("-0");
    const h = new TestGeometry(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    const t = await make();
    t.r.render(
      sceneOf(triangle(undefined, h)),
      views(undefined, { y: -0.0001 }),
    );
    expect(t.s.children[0].attrs.get("points")).not.toContain("-0");
  });
});

describe("registerSvgRenderer", () => {
  it("registers the svg rung and builds without initializing", async () => {
    const registry = new RendererRegistry();
    expect(registerSvgRenderer(registry)).toBe(registry);
    expect(registry.backends).toEqual(["svg"]);
    const registration = registry.get("svg");
    expect(registration?.isSupported({})).toBe(false);
    const surface = new FakeSurface();
    expect(registration?.isSupported({ canvas: surface })).toBe(true);
    expect(registration?.create()).toBeInstanceOf(SvgRenderer);
    expect(isSvgSupported()).toBe(false);
    expect(isSvgSurface(null)).toBe(false);
    expect(isSvgSurface({ ownerDocument: null })).toBe(false);
    const resolved = await registry.resolve("auto", { canvas: surface });
    expect(resolved).toBeInstanceOf(SvgRenderer);
  });

  it("refuses a second registration", () => {
    const registry = new RendererRegistry();
    registerSvgRenderer(registry);
    expect(() => registerSvgRenderer(registry)).toThrow();
  });
});
