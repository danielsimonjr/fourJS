import { describe, expect, it } from "vitest";
import { NodeMaterial } from "../src/node-material.js";
import { ShaderFunction } from "../src/shader-function.js";
import { ShaderGraphBuilder } from "../src/node-material-builder.js";
import {
  MAX_SHADER_GRAPH_DEFINES,
  MAX_SHADER_GRAPH_STORAGE,
  analyzeShaderGraph,
  resolveShaderSelect,
  shaderDefineKey,
  specializeShaderGraph,
  type ShaderGraph,
  type ShaderNode,
} from "../src/shader-graph.js";
import { ShaderStorageBuffer } from "../src/shader-storage.js";

function surface(nodes: ShaderNode[], color: number, extra = {}): ShaderGraph {
  return { domain: "surface", nodes, color, ...extra };
}
const ZERO: ShaderNode = { kind: "constant", type: "float", value: [0] };
const RED: ShaderNode = {
  kind: "constant",
  type: "vec4",
  value: [1, 0, 0, 1],
};
const BLUE: ShaderNode = {
  kind: "constant",
  type: "vec4",
  value: [0, 0, 1, 1],
};

function refuses(graph: ShaderGraph, pattern: RegExp): void {
  expect(() => analyzeShaderGraph(graph)).toThrow(pattern);
}

describe("storage nodes (§82)", () => {
  it("reflects, types and validates", () => {
    const b = new ShaderGraphBuilder();
    const element = b.storage("data", "vec4", 8, b.time());
    b.output.color = element;
    const a = analyzeShaderGraph(b.graph());
    expect(a.reflection.storage).toEqual([
      { name: "data", type: "vec4", count: 8 },
    ]);
    expect(a.nodeTypes.at(-1)).toBe("vec4");
  });

  it("refuses malformed nodes", () => {
    const st = (over: Record<string, unknown>): ShaderNode => ({
      kind: "storage",
      name: "d",
      type: "float",
      count: 4,
      index: 0,
      ...over,
    });
    const wrap = (n: ShaderNode) =>
      surface(
        [ZERO, n, { kind: "compose", type: "vec4", parts: [1, 1, 1, 1] }],
        2,
      );
    refuses(wrap(st({ name: "1x" })), /storage name/);
    refuses(wrap(st({ name: "a__b" })), /storage name/);
    refuses(wrap(st({ type: "vec3" })), /element type/);
    refuses(wrap(st({ count: 0 })), /count/);
    refuses(wrap(st({ count: 1.5 })), /count/);
    refuses(wrap(st({ count: 70000 })), /count/);
    refuses(wrap(st({ index: 1 })), /earlier node/);
    refuses(
      surface(
        [
          { kind: "constant", type: "vec2", value: [0, 0] },
          st({}),
          { kind: "compose", type: "vec4", parts: [1, 1, 1, 1] },
        ],
        2,
      ),
      /index must be float/,
    );
    refuses(
      {
        domain: "screen",
        nodes: [
          ZERO,
          st({}),
          { kind: "compose", type: "vec4", parts: [1, 1, 1, 1] },
        ],
        color: 2,
      },
      /surface/,
    );
    refuses(
      surface(
        [
          ZERO,
          st({}),
          st({ type: "vec2" }),
          { kind: "compose", type: "vec4", parts: [1, 1, 1, 1] },
        ],
        3,
      ),
      /one shape/,
    );
  });

  it("limits distinct buffers and keeps reads out of the vertex stage", () => {
    const b = new ShaderGraphBuilder();
    const parts = [];
    for (let i = 0; i <= MAX_SHADER_GRAPH_STORAGE; i += 1) {
      parts.push(b.storage(`b${String(i)}`, "float", 2, 0));
    }
    b.output.color = b.vec4(
      parts[0],
      parts[1],
      parts[2],
      parts[3].add(parts[4]),
    );
    expect(() => b.graph()).toThrow(/storage buffers exceed/);

    const v = new ShaderGraphBuilder();
    const read = v.storage("d", "vec4", 2, 0).swizzle("xyz");
    v.output.color = v.vec4(0, 0, 0, 1);
    v.output.positionOffset = read;
    expect(() => v.graph()).toThrow(/fragment-stage only/);
  });

  it("JSON round-trips and revalidates", () => {
    const b = new ShaderGraphBuilder();
    b.output.color = b.storage("d", "vec4", 3, 1);
    const graph = b.graph();
    const copy = JSON.parse(JSON.stringify(graph)) as ShaderGraph;
    expect(copy).toEqual(graph);
    expect(() => analyzeShaderGraph(copy)).not.toThrow();
  });
});

describe("ShaderStorageBuffer and NodeMaterial.setStorage", () => {
  it("validates, versions and disposes", () => {
    expect(() => new ShaderStorageBuffer("vec3" as "float", 2)).toThrow(
      RangeError,
    );
    expect(() => new ShaderStorageBuffer("float", 0)).toThrow(RangeError);
    const buffer = new ShaderStorageBuffer("vec2", 5);
    expect(buffer.data.length).toBe(10);
    const v = buffer.version;
    buffer.markUpdated();
    expect(buffer.version).toBe(v + 1);
    expect(buffer.disposed).toBe(false);
    buffer.dispose();
    expect(buffer.disposed).toBe(true);
  });

  it("binds by name with shape checks", () => {
    const b = new ShaderGraphBuilder();
    b.output.color = b.storage("pal", "vec4", 4, 0);
    const material = new NodeMaterial(b.graph());
    expect(material.getStorage("pal")).toBeNull();
    const ok = new ShaderStorageBuffer("vec4", 6);
    expect(material.setStorage("pal", ok)).toBe(material);
    expect(material.getStorage("pal")).toBe(ok);
    expect(() =>
      material.setStorage("pal", new ShaderStorageBuffer("vec4", 2)),
    ).toThrow(/at least 4/);
    expect(() =>
      material.setStorage("pal", new ShaderStorageBuffer("float", 9)),
    ).toThrow(RangeError);
    expect(() => material.setStorage("nope", null)).toThrow(
      /no storage buffer/,
    );
    expect(() => material.getStorage("nope")).toThrow(/no storage buffer/);
    material.setStorage("pal", null);
    expect(material.getStorage("pal")).toBeNull();
  });
});

describe("select nodes and defines", () => {
  function graphWith(): ShaderGraph {
    const b = new ShaderGraphBuilder();
    const tint = b.uniform("tint", "vec4");
    const other = b.uniform("other", "vec4");
    b.output.color = b.select("FANCY", tint, other);
    return b.graph();
  }

  it("resolves the live branch and omits dead resources from reflection", () => {
    const g = graphWith();
    expect(
      analyzeShaderGraph(g).reflection.uniforms.map((u) => u.name),
    ).toEqual(["other"]);
    const fancy = specializeShaderGraph(g, { FANCY: true });
    expect(
      analyzeShaderGraph(fancy).reflection.uniforms.map((u) => u.name),
    ).toEqual(["tint"]);
    const sel = g.nodes[2] as Extract<ShaderNode, { kind: "select" }>;
    expect(resolveShaderSelect(sel, undefined)).toBe(sel.otherwise);
    expect(resolveShaderSelect(sel, { FANCY: true })).toBe(sel.then);
    expect(resolveShaderSelect(sel, { OTHER: true })).toBe(sel.otherwise);
  });

  it("memoises specializations on the sorted define key", () => {
    const b = new ShaderGraphBuilder();
    const x = b.select("A", b.constant(1), b.constant(2));
    const y = b.select("B", b.constant(1), b.constant(2));
    b.output.color = b.vec4(x, y, 0, 1);
    const g = b.graph();
    const one = specializeShaderGraph(g, { B: false, A: true });
    const two = specializeShaderGraph(g, { A: true, B: false });
    expect(two).toBe(one);
    expect(Object.keys(one.defines!)).toEqual(["A", "B"]);
    expect(Object.isFrozen(one.defines)).toBe(true);
    expect(shaderDefineKey(one.defines)).toBe("A=1,B=0");
    expect(shaderDefineKey(undefined)).toBe("");
    expect(specializeShaderGraph(g, { A: false })).not.toBe(one);
    expect(() => specializeShaderGraph(g, { TYPO: true })).toThrow(/no select/);
    // overrides layer over the graph's own defines
    const base = specializeShaderGraph(g, { A: true });
    expect(specializeShaderGraph(base, { B: true }).defines).toEqual({
      A: true,
      B: true,
    });
  });

  it("validates select and defines", () => {
    const sel = (over: Record<string, unknown>): ShaderNode => ({
      kind: "select",
      define: "D",
      then: 0,
      otherwise: 1,
      ...over,
    });
    refuses(surface([RED, BLUE, sel({ define: "1D" })], 2), /define name/);
    refuses(surface([RED, BLUE, sel({ then: 2 })], 2), /earlier node/);
    refuses(surface([RED, BLUE, sel({ otherwise: 5 })], 2), /earlier node/);
    refuses(surface([RED, ZERO, sel({})], 2), /share a type/);
    const ok = surface([RED, BLUE, sel({})], 2);
    expect(() => analyzeShaderGraph(ok)).not.toThrow();
    refuses(
      { ...ok, defines: [] as unknown as Record<string, boolean> },
      /object/,
    );
    refuses(
      { ...ok, defines: null as unknown as Record<string, boolean> },
      /object/,
    );
    refuses({ ...ok, defines: { "9x": true } }, /define name/);
    refuses({ ...ok, defines: { D: 1 as unknown as boolean } }, /boolean/);
    const many: Record<string, boolean> = {};
    for (let i = 0; i <= MAX_SHADER_GRAPH_DEFINES; i += 1)
      many[`d${String(i)}`] = true;
    refuses({ ...ok, defines: many }, /exceed/);
  });

  it("round-trips through JSON", () => {
    const g = specializeShaderGraph(graphWith(), { FANCY: true });
    const copy = JSON.parse(JSON.stringify(g)) as ShaderGraph;
    expect(analyzeShaderGraph(copy).reflection).toEqual(
      analyzeShaderGraph(g).reflection,
    );
  });
});

describe("light nodes (§68)", () => {
  it("types every member and reflects first-appearance order", () => {
    const b = new ShaderGraphBuilder();
    const slot = b.constant(2);
    const sum = b
      .light("ambient")
      .add(b.light("directionalDirection"))
      .add(b.light("directionalColor"))
      .add(b.light("cameraPosition"))
      .add(b.light("punctualPosition", slot))
      .add(b.light("punctualColor", slot))
      .add(b.light("punctualDirection", slot))
      .add(b.light("ambient"));
    const params = b.light("punctualParams", slot);
    b.output.color = b.vec4(
      sum,
      b.light("punctualCount").add(params.swizzle("x")),
    );
    const a = analyzeShaderGraph(b.graph());
    expect(a.reflection.lights).toEqual([
      "ambient",
      "directionalDirection",
      "directionalColor",
      "cameraPosition",
      "punctualPosition",
      "punctualColor",
      "punctualDirection",
      "punctualParams",
      "punctualCount",
    ]);
  });

  it("refuses misuse", () => {
    const light = (over: Record<string, unknown>): ShaderNode => ({
      kind: "light",
      member: "ambient",
      ...over,
    });
    const wrap = (n: ShaderNode, domain: "surface" | "screen" = "surface") => ({
      domain,
      nodes: [
        ZERO,
        n,
        { kind: "compose", type: "vec4", parts: [1, 0] } as ShaderNode,
      ],
      color: 2,
    });
    expect(() => analyzeShaderGraph(wrap(light({ member: "bogus" })))).toThrow(
      /unknown light/,
    );
    expect(() =>
      analyzeShaderGraph(wrap(light({ member: "toString" }))),
    ).toThrow(/unknown light/);
    expect(() => analyzeShaderGraph(wrap(light({ index: 0 })))).toThrow(
      /takes no index/,
    );
    expect(() =>
      analyzeShaderGraph(wrap(light({ member: "punctualColor" }))),
    ).toThrow(/needs an index/);
    expect(() =>
      analyzeShaderGraph(wrap(light({ member: "punctualColor", index: 3 }))),
    ).toThrow(/earlier node/);
    expect(() => analyzeShaderGraph(wrap(light({}), "screen"))).toThrow(
      /surface/,
    );
    const vec = new ShaderGraphBuilder();
    const v2 = vec.constant([0, 0]);
    vec.output.color = vec.vec4(vec.light("punctualColor", v2), 1);
    expect(() => vec.graph()).toThrow(/index must be float/);
  });

  it("is fragment-stage only", () => {
    const b = new ShaderGraphBuilder();
    b.output.color = b.vec4(0, 0, 0, 1);
    b.output.positionOffset = b.light("ambient");
    expect(() => b.graph()).toThrow(/fragment-stage only/);
  });
});

describe("ShaderFunction inlines the new node kinds", () => {
  it("keeps storage, select and light intact", () => {
    const f = new ShaderGraphBuilder();
    const x = f.uniform("x", "float");
    const pick = f.select(
      "D",
      f.storage("s", "float", 4, x),
      f.light("punctualCount"),
    );
    const lit = f.light("punctualPosition", x).swizzle("x");
    const color = f.vec4(pick, lit, 0, 1);
    f.output.color = color;
    const fn = new ShaderFunction({
      name: "w7",
      graph: f.graph(),
      parameters: ["x"],
      result: color.nodeId,
    });
    const b = new ShaderGraphBuilder();
    b.define("D");
    b.output.color = fn.call(b, 1);
    const analysis = analyzeShaderGraph(b.graph());
    expect(analysis.reflection.storage).toEqual([
      { name: "s", type: "float", count: 4 },
    ]);
    expect(analysis.reflection.lights).toContain("punctualPosition");
    expect(b.graph().defines).toEqual({ D: true });
  });
});
