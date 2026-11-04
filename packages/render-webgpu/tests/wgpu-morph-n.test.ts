/**
 * RFC 0003 residue: 2..4-target GPU morph on WebGPU — renderer-level draw
 * sequences (recording device), the weight vec4, and pipeline identity. The
 * one-target behaviour stays pinned by `webgpu-renderer.test.ts` unchanged.
 */

import { Matrix4 } from "@fourjs/math";
import {
  Renderable,
  type RenderItem,
  type Renderer,
  type UnlitRenderItem,
} from "@fourjs/render";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createRecordingGpu,
  withHostGpu,
  type RecordingGpu,
} from "../../../tests/integration/helpers/recording-gpu.js";
import {
  DRAW_MORPH_WEIGHTS_OFFSET,
  MORPH_N_DRAW_UNIFORM_WGSL,
  MORPH_N_STANDARD_UNIFORM_WGSL,
  STANDARD_MORPH_WEIGHTS_OFFSET,
  UNIFORM_STRIDE_BYTES,
  WebgpuRenderer,
  morphHasNormals,
  morphTargetCount,
  morphVariant,
  morphVertexBufferLayouts,
} from "../src/index.js";

type View = Parameters<Renderer["render"]>[1][number];
type Geo = RenderItem["geometry"];
type Mat = UnlitRenderItem["material"];

let nextId = 0;

class Geometry {
  readonly id = `morph-n-${String((nextId += 1))}`;
  version = 0;
  positions = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]);
  normals: Float32Array | undefined;
  positions1: Float32Array | undefined;
  normals1: Float32Array | undefined;
  extraMorphTargets:
    { positions: Float32Array; normals?: Float32Array }[] | undefined;
  indices: Uint16Array | undefined;
  mode = "triangles";
  get drawCount(): number {
    return this.positions.length / 3;
  }
  get vertexCount(): number {
    return this.positions.length / 3;
  }
  computeBounds(): unknown {
    const v = { x: 0, y: 0, z: 0 };
    return { min: v, max: v };
  }
}

function morphGeometry(
  targets: number,
  normals: boolean,
  shaded: boolean,
): Geometry {
  const g = new Geometry();
  if (shaded) {
    g.normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  }
  g.positions1 = new Float32Array(9).fill(1);
  if (normals) {
    g.normals1 = new Float32Array(9).fill(0.5);
  }
  if (targets > 1) {
    g.extraMorphTargets = [];
    for (let k = 2; k <= targets; k += 1) {
      g.extraMorphTargets.push({
        positions: new Float32Array(9).fill(k),
        ...(normals ? { normals: new Float32Array(9).fill(k / 10) } : {}),
      });
    }
  }
  return g;
}

function node(
  geometry: Geometry,
  kind: "unlit" | "lit" | "standard",
  weights: number[],
): Renderable {
  const color: [number, number, number, number] = [1, 1, 1, 1];
  const material =
    kind === "standard"
      ? {
          kind,
          baseColor: color,
          metalness: 0,
          roughness: 1,
          emissive: [0, 0, 0],
        }
      : kind === "lit"
        ? { kind, color }
        : { color };
  const r = new Renderable(
    geometry as unknown as Geo,
    material as unknown as Mat,
  );
  (r as unknown as { morphTargetWeights: Float32Array }).morphTargetWeights =
    new Float32Array(weights);
  return r;
}

function root(): Renderable {
  const g = new Geometry();
  g.positions = new Float32Array(0);
  return new Renderable(
    g as unknown as Geo,
    { color: [1, 1, 1, 1] } as unknown as Mat,
  );
}

function view(): View {
  const camera = {
    projectionMatrix: new Matrix4(),
    viewMatrix: new Matrix4(),
    transform: { worldMatrix: new Matrix4() },
    layers: undefined,
    updateViewMatrix(): void {},
  };
  return {
    id: "main",
    camera,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    normalized: true,
  } as unknown as View;
}

interface Harness {
  gpu: RecordingGpu;
  renderer: WebgpuRenderer;
}

async function initialized(): Promise<Harness> {
  const gpu = createRecordingGpu();
  const renderer = new WebgpuRenderer();
  await withHostGpu(gpu.gpu, async () => {
    await renderer.initialize({ canvas: gpu.canvas });
  });
  renderer.resize(256, 256, 1);
  gpu.reset();
  return { gpu, renderer };
}

function uniforms(gpu: RecordingGpu, shaded = false): number[] {
  const calls = gpu.callsOf("queue.writeBuffer");
  // Shaded frames upload the light block last; the draw blocks precede it.
  return calls[calls.length - (shaded ? 2 : 1)].args[2] as number[];
}

function labels(gpu: RecordingGpu): string[] {
  return gpu
    .callsOf("device.createShaderModule")
    .map((c) => String((c.args[0] as { label?: string }).label));
}

function sources(gpu: RecordingGpu): string[] {
  return gpu
    .callsOf("device.createShaderModule")
    .map((c) => (c.args[0] as { code: string }).code);
}

describe("N-target WGSL helpers", () => {
  it("decodes variants", () => {
    expect(morphTargetCount("p")).toBe(1);
    expect(morphTargetCount("pn")).toBe(1);
    expect(morphTargetCount("pn3")).toBe(3);
    expect(morphTargetCount("p4")).toBe(4);
    expect(morphHasNormals("pn2")).toBe(true);
    expect(morphHasNormals("p2")).toBe(false);
    expect(morphVariant(1, false)).toBe("p");
    expect(morphVariant(1, true)).toBe("pn");
    expect(morphVariant(4, true)).toBe("pn4");
    expect(morphVariant(2, false)).toBe("p2");
  });

  it("lays streams out p1,n1,p2,n2,... at 6/7 then 10..15", () => {
    const locations = morphVertexBufferLayouts("pn4").map(
      (l) => l.attributes[0].shaderLocation,
    );
    expect(locations).toEqual([6, 7, 10, 11, 12, 13, 14, 15]);
    expect(
      morphVertexBufferLayouts("p3").map((l) => l.attributes[0].shaderLocation),
    ).toEqual([6, 10, 12]);
    expect(morphVertexBufferLayouts("p")).toHaveLength(1);
  });

  it("appends a vec4 weights field inside the 256-byte stride", () => {
    expect(MORPH_N_DRAW_UNIFORM_WGSL).toContain("morphWeights : vec4<f32>,");
    expect(MORPH_N_STANDARD_UNIFORM_WGSL).toContain(
      "morphWeights : vec4<f32>,",
    );
    expect(DRAW_MORPH_WEIGHTS_OFFSET + 16).toBeLessThanOrEqual(
      UNIFORM_STRIDE_BYTES,
    );
    expect(STANDARD_MORPH_WEIGHTS_OFFSET + 16).toBeLessThanOrEqual(
      UNIFORM_STRIDE_BYTES,
    );
  });
});

describe("WebgpuRenderer N-target GPU morph", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await initialized();
  });
  afterEach(() => {
    h.renderer.dispose();
  });

  it("unlit 2 targets: own pipeline, slots 0..2, weights vec4, Σ expression", () => {
    const r = root();
    r.add(node(morphGeometry(2, false, false), "unlit", [0.25, 0.5]));
    h.renderer.render(r, [view()]);
    expect(labels(h.gpu)).toContain("fourJS:unlit|mo:p2");
    expect(h.gpu.callsOf("pass.setVertexBuffer").map((c) => c.args[0])).toEqual(
      [0, 1, 2],
    );
    const code = sources(h.gpu).find((s) => s.includes("position2"));
    expect(code).toContain(
      "position + draw.morphWeights.x * (position1 - position) + draw.morphWeights.y * (position2 - position)",
    );
    expect(code).toContain("@location(10) position2 : vec3<f32>,");
    const data = uniforms(h.gpu);
    const at = 64 + DRAW_MORPH_WEIGHTS_OFFSET / 4;
    expect(data.slice(at, at + 4)).toEqual([0.25, 0.5, 0, 0]);
  });

  it("lit 4 targets with normals bind p1,n1..p4,n4 and 10 streams", () => {
    const r = root();
    r.add(node(morphGeometry(4, true, true), "lit", [0.1, 0.2, 0.3, 0.4]));
    h.renderer.render(r, [view()]);
    expect(labels(h.gpu)).toContain("fourJS:lit|n|mo:pn4");
    expect(h.gpu.callsOf("pass.setVertexBuffer").map((c) => c.args[0])).toEqual(
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    );
    const code = sources(h.gpu).find((s) => s.includes("normal4"));
    expect(code).toContain("@location(15) normal4 : vec3<f32>,");
    expect(code).toContain("let morphedNormal = normal + draw.morphWeights.x");
    const at = 64 + DRAW_MORPH_WEIGHTS_OFFSET / 4;
    const data = uniforms(h.gpu, true);
    expect(data.slice(at, at + 4).map((v) => Math.round(v * 10) / 10)).toEqual([
      0.1, 0.2, 0.3, 0.4,
    ]);
  });

  it("lit without normal morph streams falls back to positions-only N targets", () => {
    const g = morphGeometry(3, true, true);
    g.extraMorphTargets![1] = { positions: new Float32Array(9) };
    const r = root();
    r.add(node(g, "lit", [1]));
    h.renderer.render(r, [view()]);
    expect(labels(h.gpu)).toContain("fourJS:lit|n|mo:p3");
  });

  it("standard 3 targets writes weights at the standard offset", () => {
    const r = root();
    r.add(node(morphGeometry(3, true, true), "standard", [0.5, 0.25, 0.125]));
    h.renderer.render(r, [view()]);
    expect(labels(h.gpu).some((l) => l.endsWith("|mo:pn3"))).toBe(true);
    const data = uniforms(h.gpu, true);
    const at = 64 + STANDARD_MORPH_WEIGHTS_OFFSET / 4;
    expect(data.slice(at, at + 4)).toEqual([0.5, 0.25, 0.125, 0]);
  });

  it("keys differ per target count and weight updates rewrite the block", () => {
    const r = root();
    const two = node(morphGeometry(2, false, false), "unlit", [1, 0]);
    r.add(two);
    r.add(node(morphGeometry(3, false, false), "unlit", [0, 0, 1]));
    r.add(node(morphGeometry(1, false, false), "unlit", [1]));
    h.renderer.render(r, [view()]);
    const l = labels(h.gpu);
    expect(l).toContain("fourJS:unlit|mo:p2");
    expect(l).toContain("fourJS:unlit|mo:p3");
    expect(l).toContain("fourJS:unlit|mo:p");
    (
      two as unknown as { morphTargetWeights: Float32Array }
    ).morphTargetWeights = new Float32Array([0.75, 0.25]);
    h.gpu.reset();
    h.renderer.render(r, [view()]);
    const data = uniforms(h.gpu);
    const at = 64 + DRAW_MORPH_WEIGHTS_OFFSET / 4;
    expect(data.slice(at, at + 2)).toEqual([0.75, 0.25]);
  });

  it("uploads extra streams lazily and destroys them with the geometry cache", () => {
    const r = root();
    r.add(node(morphGeometry(3, false, false), "unlit", [1]));
    h.renderer.render(r, [view()]);
    const made = h.gpu
      .callsOf("device.createBuffer")
      .map((c) => String((c.args[0] as { label?: string }).label));
    expect(made.some((x) => x.startsWith("fourJS:positions2:"))).toBe(true);
    expect(made.some((x) => x.startsWith("fourJS:positions3:"))).toBe(true);
    expect(made.some((x) => x.startsWith("fourJS:normals2:"))).toBe(false);
  });
});
