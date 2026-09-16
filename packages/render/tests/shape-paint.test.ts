/**
 * The §58 paint-object tier (2026-08-29; R-16's follow-up, unblocked by
 * RFC 0001): validation, the paint-to-graph lowering, the two-tier material
 * rule on `Shape2D`, and the selector stream.
 *
 * The lowering's arithmetic is checked by **evaluating the emitted graph in
 * JS** against the paint's own definition — a tiny interpreter over the §60
 * node union — so the test pins what the paint *means*, not which nodes spell
 * it; the graph's byte-level determinism is `tests/determinism`'s, and the
 * real-driver pixels are `tests/browser/shape-paint.spec.ts`'s.
 */

import { NodeMaterial, UnlitMaterial } from "@fourjs/materials";
import type { MaterialTexture } from "@fourjs/materials";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  Circle,
  Line,
  Rectangle,
  clearRegisteredShapePaints,
  registerShapePaints,
  resolveShapePaintSupport,
  type ConicGradientPaint,
  type LinearGradientPaint,
  type Paint,
  type PatternPaint,
  type RadialGradientPaint,
  type ShaderGraph,
  type ShaderNode,
} from "../src/index.js";

/** A crude texture stand-in — `MaterialTexture` is structural (§77). */
function fakeTexture(): MaterialTexture {
  return { id: 1, version: 0, source: {} } as unknown as MaterialTexture;
}

const RED_TO_BLUE: readonly {
  offset: number;
  color: [number, number, number, number];
}[] = [
  { offset: 0, color: [1, 0, 0, 1] },
  { offset: 1, color: [0, 0, 1, 1] },
];

function linear(
  overrides: Partial<LinearGradientPaint> = {},
): LinearGradientPaint {
  return {
    kind: "linear-gradient",
    from: { x: -1, y: 0 },
    to: { x: 1, y: 0 },
    stops: RED_TO_BLUE,
    ...overrides,
  };
}

function radial(
  overrides: Partial<RadialGradientPaint> = {},
): RadialGradientPaint {
  return {
    kind: "radial-gradient",
    center: { x: 0, y: 0 },
    radius: 2,
    stops: RED_TO_BLUE,
    ...overrides,
  };
}

function pattern(overrides: Partial<PatternPaint> = {}): PatternPaint {
  return { kind: "pattern", texture: fakeTexture(), ...overrides };
}

function conic(
  overrides: Partial<ConicGradientPaint> = {},
): ConicGradientPaint {
  return {
    kind: "conic-gradient",
    center: { x: 0, y: 0 },
    startAngle: 0,
    stops: RED_TO_BLUE,
    ...overrides,
  };
}

/**
 * Evaluates one node of a lowered graph — every operator the lowering can
 * emit, with GLSL's float-broadcast semantics — so a test can ask what colour
 * the graph paints at a given local position, uv, and selector value.
 */
interface GraphEnvironment {
  readonly position: readonly [number, number, number];
  readonly uv: readonly [number, number];
  readonly color: readonly [number, number, number, number];
  readonly sample: (name: string, uv: readonly number[]) => number[];
}

function evaluateGraph(
  graph: ShaderGraph,
  environment: GraphEnvironment,
): number[] {
  const values: number[][] = [];
  const broadcast = (
    a: number[],
    b: number[],
    op: (x: number, y: number) => number,
  ): number[] => {
    const size = Math.max(a.length, b.length);
    const result: number[] = [];
    for (let i = 0; i < size; i += 1) {
      result.push(op(a[a.length === 1 ? 0 : i], b[b.length === 1 ? 0 : i]));
    }
    return result;
  };
  for (const node of graph.nodes) {
    values.push(evaluateNode(node, values, environment, broadcast));
  }
  return values[graph.color];
}

function evaluateNode(
  node: ShaderNode,
  values: number[][],
  environment: GraphEnvironment,
  broadcast: (
    a: number[],
    b: number[],
    op: (x: number, y: number) => number,
  ) => number[],
): number[] {
  switch (node.kind) {
    case "constant":
      return [...node.value];
    case "attribute":
      switch (node.name) {
        case "position":
          return [...environment.position];
        case "uv":
          return [...environment.uv];
        default:
          return [...environment.color];
      }
    case "texture":
      return environment.sample(node.name, values[node.uv]);
    case "swizzle": {
      const source = values[node.source];
      const index: Record<string, number> = { x: 0, y: 1, z: 2, w: 3 };
      return Array.from(node.pattern).map((letter) => source[index[letter]]);
    }
    case "unary": {
      const source = values[node.source];
      switch (node.op) {
        case "saturate":
          return source.map((v) => Math.min(1, Math.max(0, v)));
        case "length":
          return [Math.hypot(...source)];
        case "angle":
          return [Math.atan2(source[1], source[0])];
        case "fract":
          return source.map((v) => v - Math.floor(v));
        default:
          throw new Error(`unexpected unary ${node.op} in a lowered graph`);
      }
    }
    case "binary": {
      const left = values[node.left];
      const right = values[node.right];
      switch (node.op) {
        case "add":
          return broadcast(left, right, (x, y) => x + y);
        case "subtract":
          return broadcast(left, right, (x, y) => x - y);
        case "multiply":
          return broadcast(left, right, (x, y) => x * y);
        case "dot":
          return [left.reduce((sum, v, i) => sum + v * right[i], 0)];
        case "step":
          return broadcast(left, right, (edge, x) => (x < edge ? 0 : 1));
        default:
          throw new Error(`unexpected binary ${node.op} in a lowered graph`);
      }
    }
    case "mix": {
      const a = values[node.a];
      const b = values[node.b];
      const t = values[node.t];
      return a.map(
        (v, i) =>
          v * (1 - t[t.length === 1 ? 0 : i]) +
          b[i] * t[t.length === 1 ? 0 : i],
      );
    }
    default:
      throw new Error(`unexpected node ${node.kind} in a lowered graph`);
  }
}

/**
 * The derived material behind the family's `M`-typed slot — the documented
 * place where the parameter is wider than its type, asserted at runtime.
 */
function derivedMaterial(shape: { material: unknown }): NodeMaterial {
  const material = shape.material;
  expect(material).toBeInstanceOf(NodeMaterial);
  return material as NodeMaterial;
}

/** The colour a shape's derived graph paints under `environment`. */
function paintedColor(
  shape: { material: unknown },
  environment: Partial<GraphEnvironment>,
): number[] {
  const material = derivedMaterial(shape);
  expect(material).toBeInstanceOf(NodeMaterial);
  return evaluateGraph(material.graph, {
    position: [0, 0, 0],
    uv: [0.5, 0.5],
    color: [0, 0, 0, 0],
    sample: () => [0, 0, 0, 0],
    ...environment,
  });
}

beforeEach(() => {
  registerShapePaints();
});

afterEach(() => {
  clearRegisteredShapePaints();
});

describe("§58 object paints — the two-tier material rule (§85)", () => {
  it("refuses an object paint until registerShapePaints() is called", () => {
    clearRegisteredShapePaints();
    expect(() => new Circle({ fill: linear() })).toThrow(/registerShapePaints/);
  });

  it("derives a node material for a shape constructed without one", () => {
    const circle = new Circle({ fill: radial() });
    expect(circle.paintDerived).toBe(true);
    expect(circle.material.kind).toBe("node");
    expect(circle.material).toBeInstanceOf(NodeMaterial);
  });

  it("refuses a shape with neither material nor object paint", () => {
    expect(() => new Circle({})).toThrow(/material/);
    expect(
      () => new Circle({ fill: { kind: "solid", color: [1, 0, 0, 1] } }),
    ).toThrow(/material/);
  });

  it("refuses an object paint beside a material, both ways", () => {
    const material = new UnlitMaterial({ vertexColors: true });
    expect(() => new Circle({ material, fill: linear() })).toThrow(
      /without `material`/,
    );
    expect(
      () =>
        new Line({
          start: { x: 0, y: 0 },
          end: { x: 1, y: 0 },
          material,
          stroke: { width: 0.1, paint: radial() },
        }),
    ).toThrow(/without `material`/);
    const solid = new Circle({ material });
    expect(() => {
      solid.fill = linear();
    }).toThrow(/without `material`/);
    expect(() => {
      solid.stroke = { width: 0.1, paint: pattern() };
    }).toThrow(/without `material`/);
    expect(solid.fill).toBe("inherit");
    expect(solid.stroke).toBeNull();
  });

  it("keeps paintDerived fixed and re-derives the material on paint writes", () => {
    const circle = new Circle({ fill: linear() });
    const first = circle.material;
    circle.fill = radial();
    expect(circle.material).not.toBe(first);
    expect(circle.material.kind).toBe("node");
    // A later all-solid pair still draws through the derived tier.
    circle.fill = { kind: "solid", color: [0, 1, 0, 1] };
    expect(circle.paintDerived).toBe(true);
    expect(circle.material.kind).toBe("node");
    expect(paintedColor(circle, {})).toEqual([0, 1, 0, 1]);
    circle.stroke = { width: 0.1 };
    expect(circle.material.kind).toBe("node");
  });
});

describe("§58 object paints — §85 validation, refuse never clamp", () => {
  const cases: readonly [string, Paint, RegExp][] = [
    ["a single stop", linear({ stops: [RED_TO_BLUE[0]] }), /at least 2/],
    [
      "an unsorted stop list",
      linear({
        stops: [
          { offset: 0.7, color: [1, 0, 0, 1] },
          { offset: 0.2, color: [0, 0, 1, 1] },
        ],
      }),
      /sorted/,
    ],
    [
      "an offset outside 0…1",
      linear({
        stops: [
          { offset: 0, color: [1, 0, 0, 1] },
          { offset: 1.5, color: [0, 0, 1, 1] },
        ],
      }),
      /0…1/,
    ],
    [
      "a non-finite offset",
      linear({
        stops: [
          { offset: Number.NaN, color: [1, 0, 0, 1] },
          { offset: 1, color: [0, 0, 1, 1] },
        ],
      }),
      /finite/,
    ],
    [
      "a non-finite stop colour",
      linear({
        stops: [
          { offset: 0, color: [1, 0, 0, 1] },
          { offset: 1, color: [0, 0, Number.POSITIVE_INFINITY, 1] },
        ],
      }),
      /finite/,
    ],
    ["a zero-length axis", linear({ to: { x: -1, y: 0 } }), /axis/],
    [
      "a non-finite endpoint",
      linear({ to: { x: Number.NaN, y: 0 } }),
      /finite/,
    ],
    ["a zero radius", radial({ radius: 0 }), /radius/],
    ["a negative radius", radial({ radius: -2 }), /radius/],
    [
      "a non-finite centre",
      radial({ center: { x: 0, y: Number.NaN } }),
      /finite/,
    ],
    ["an out-of-range opacity", radial({ opacity: 2 }), /opacity/],
    [
      "a non-finite conic centre",
      conic({ center: { x: Number.NaN, y: 0 } }),
      /finite/,
    ],
    [
      "a non-finite conic startAngle",
      conic({ startAngle: Number.POSITIVE_INFINITY }),
      /finite/,
    ],
    ["a zero pattern repeat", pattern({ repeat: { x: 0, y: 1 } }), /repeat/],
    [
      "a missing pattern texture",
      { kind: "pattern", texture: null } as unknown as Paint,
      /texture/,
    ],
  ];
  it.each(cases)("refuses %s", (_name, paint, message) => {
    expect(() => new Circle({ fill: paint })).toThrow(message);
  });

  it("refuses a conic gradient missing its centre and stops (§85)", () => {
    expect(
      () =>
        new Circle({
          fill: { kind: "conic-gradient" } as unknown as Paint,
        }),
    ).toThrow(/finite|stops/);
  });

  it("refuses an unknown paint kind naming what this tier draws", () => {
    expect(
      () => new Circle({ fill: { kind: "plaid" } as unknown as Paint }),
    ).toThrow(/pattern/);
  });

  it("resolves defaults on read — the resolved forms", () => {
    const circle = new Circle({ fill: pattern() });
    const fill = circle.fill;
    expect(fill).toMatchObject({
      kind: "pattern",
      repeat: { x: 1, y: 1 },
      offset: { x: 0, y: 0 },
      opacity: 1,
    });
    const gradient = new Circle({ fill: radial() });
    expect(gradient.fill).toMatchObject({ opacity: 1, radius: 2 });
  });
});

describe("§58 lowering — the graph means what the paint says", () => {
  it("evaluates a linear gradient exactly, padded past both ends", () => {
    const rect = new Rectangle({ width: 4, height: 2, fill: linear() });
    // t = 0 at x = −1, 1 at x = +1; red → blue.
    expect(paintedColor(rect, { position: [-1, 0.4, 0] })).toEqual([
      1, 0, 0, 1,
    ]);
    expect(paintedColor(rect, { position: [0, 0, 0] })).toEqual([
      0.5, 0, 0.5, 1,
    ]);
    expect(paintedColor(rect, { position: [1, -0.7, 0] })).toEqual([
      0, 0, 1, 1,
    ]);
    // Pad: before the first stop and past the last.
    expect(paintedColor(rect, { position: [-2, 0, 0] })).toEqual([1, 0, 0, 1]);
    expect(paintedColor(rect, { position: [9, 0, 0] })).toEqual([0, 0, 1, 1]);
  });

  it("evaluates a three-stop ramp and a hard edge exactly", () => {
    const rect = new Rectangle({
      width: 4,
      height: 2,
      fill: linear({
        from: { x: 0, y: 0 },
        to: { x: 1, y: 0 },
        stops: [
          { offset: 0, color: [0, 0, 0, 1] },
          { offset: 0.5, color: [1, 1, 1, 1] },
          { offset: 0.5, color: [1, 0, 0, 1] }, // hard edge at t = 0.5
          { offset: 1, color: [0, 1, 0, 1] },
        ],
      }),
    });
    expect(paintedColor(rect, { position: [0.25, 0, 0] })).toEqual([
      0.5, 0.5, 0.5, 1,
    ]);
    // Strictly before the edge: the earlier colour.
    expect(paintedColor(rect, { position: [0.499, 0, 0] })[0]).toBeCloseTo(
      0.998,
      12,
    );
    // At and past the edge: the later ramp.
    expect(paintedColor(rect, { position: [0.5, 0, 0] })).toEqual([1, 0, 0, 1]);
    expect(paintedColor(rect, { position: [0.75, 0, 0] })).toEqual([
      0.5, 0.5, 0, 1,
    ]);
  });

  it("evaluates a conic gradient from +X, counter-clockwise", () => {
    const circle = new Circle({ radius: 2, fill: conic() });
    // t = 0 on +X, 0.25 on +Y, 0.5 on −X — red → blue.
    expect(paintedColor(circle, { position: [1, 0, 0] })).toEqual([1, 0, 0, 1]);
    expect(paintedColor(circle, { position: [0, 1, 0] })).toEqual([
      0.75, 0, 0.25, 1,
    ]);
    expect(paintedColor(circle, { position: [-1, 0, 0] })).toEqual([
      0.5, 0, 0.5, 1,
    ]);
    expect(paintedColor(circle, { position: [0, -1, 0] })).toEqual([
      0.25, 0, 0.75, 1,
    ]);
  });

  it("rotates a conic gradient by startAngle and wraps past 2π", () => {
    const circle = new Circle({
      radius: 2,
      fill: conic({ startAngle: Math.PI / 2 }),
    });
    // Offset 0 now sits on +Y.
    expect(paintedColor(circle, { position: [0, 1, 0] })).toEqual([1, 0, 0, 1]);
    expect(paintedColor(circle, { position: [-1, 0, 0] })).toEqual([
      0.75, 0, 0.25, 1,
    ]);
    // +X is a quarter-turn clockwise of +Y → t = 0.75 after wrap.
    expect(paintedColor(circle, { position: [1, 0, 0] })).toEqual([
      0.25, 0, 0.75, 1,
    ]);
  });

  it("evaluates a radial gradient from its centre, in local space", () => {
    const circle = new Circle({
      radius: 3,
      fill: radial({ center: { x: 1, y: 1 } }),
    });
    expect(paintedColor(circle, { position: [1, 1, 0] })).toEqual([1, 0, 0, 1]);
    expect(paintedColor(circle, { position: [1, 2, 0] })).toEqual([
      0.5, 0, 0.5, 1,
    ]);
    expect(paintedColor(circle, { position: [1 + 2, 1, 0] })).toEqual([
      0, 0, 1, 1,
    ]);
  });

  it("folds a gradient's opacity into every stop's alpha", () => {
    const circle = new Circle({ radius: 2, fill: radial({ opacity: 0.5 }) });
    expect(paintedColor(circle, { position: [0, 0, 0] })).toEqual([
      1, 0, 0, 0.5,
    ]);
    expect(derivedMaterial(circle).transparent).toBe(true);
  });

  it("samples a pattern at the shape's uv, transformed and faded", () => {
    const texture = fakeTexture();
    const seen: number[][] = [];
    const circle = new Circle({
      radius: 1,
      fill: {
        kind: "pattern",
        texture,
        repeat: { x: 4, y: 2 },
        offset: { x: 0.5, y: 0 },
        opacity: 0.5,
      },
    });
    const material = derivedMaterial(circle);
    expect(material.reflection.textures.map((t) => t.name)).toEqual([
      "texture0",
    ]);
    expect(material.getTexture("texture0")).toBe(texture);
    const color = evaluateGraph(material.graph, {
      position: [0, 0, 0],
      uv: [0.25, 0.5],
      color: [0, 0, 0, 0],
      sample: (name, uv) => {
        expect(name).toBe("texture0");
        seen.push([...uv]);
        return [0.2, 0.4, 0.6, 1];
      },
    });
    expect(seen).toEqual([[0.25 * 4 + 0.5, 0.5 * 2]]);
    expect(color).toEqual([0.2, 0.4, 0.6, 0.5]);
  });

  it("skips the uv transform and the fade when both are identities", () => {
    const circle = new Circle({ radius: 1, fill: pattern() });
    const graph = derivedMaterial(circle).graph;
    // attribute uv + texture: nothing else.
    expect(graph.nodes.map((node) => node.kind)).toEqual([
      "attribute",
      "texture",
    ]);
  });

  it("marks translucency from the paint values, patterns always", () => {
    const opaque = new Circle({ radius: 1, fill: linear() });
    expect(derivedMaterial(opaque).transparent).toBe(false);
    const faded = new Circle({
      radius: 1,
      fill: linear({
        stops: [
          { offset: 0, color: [1, 0, 0, 0.5] },
          { offset: 1, color: [0, 0, 1, 1] },
        ],
      }),
    });
    expect(derivedMaterial(faded).transparent).toBe(true);
    const patterned = new Circle({ radius: 1, fill: pattern() });
    expect(derivedMaterial(patterned).transparent).toBe(true);
    // A translucent *solid* half rides its gradient partner into the
    // derived tier and still marks the material transparent.
    const fadedSolidStroke = new Circle({
      radius: 1,
      fill: linear(),
      stroke: {
        width: 0.1,
        paint: { kind: "solid", color: [1, 1, 1, 1], opacity: 0.25 },
      },
    });
    expect(derivedMaterial(fadedSolidStroke).transparent).toBe(true);
  });
});

describe("§58 lowering — fill/stroke pairs and the selector stream", () => {
  it("mixes two different paints through the baked selector", () => {
    const rect = new Rectangle({
      width: 2,
      height: 2,
      fill: linear(),
      stroke: { width: 0.5, paint: { kind: "solid", color: [0, 1, 0, 1] } },
    });
    // selector 0 → the fill's gradient; 1 → the stroke's solid.
    expect(
      paintedColor(rect, { position: [0, 0, 0], color: [0, 0, 0, 0] }),
    ).toEqual([0.5, 0, 0.5, 1]);
    expect(
      paintedColor(rect, { position: [0, 0, 0], color: [1, 1, 1, 1] }),
    ).toEqual([0, 1, 0, 1]);
    // The geometry bakes exactly that stream: 0s on fill vertices, 1s on the
    // stroke's, and nothing else.
    const geometry = rect.geometry;
    const colors = geometry.colors;
    expect(colors).toBeDefined();
    const vertexCount = (geometry.positions?.length ?? 0) / 3;
    const strokeVertices = (colors?.length ?? 0) / 4 - 4; // 4 fill corners
    expect(strokeVertices).toBeGreaterThan(0);
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const expected = vertex < 4 ? 0 : 1;
      for (let channel = 0; channel < 4; channel += 1) {
        expect(colors?.[vertex * 4 + channel]).toBe(expected);
      }
    }
  });

  it("shares one evaluation — and bakes no stream — when both halves agree", () => {
    const paint = linear();
    const rect = new Rectangle({
      width: 2,
      height: 2,
      fill: paint,
      stroke: { width: 0.5, paint },
    });
    expect(rect.geometry.colors).toBeUndefined();
    const graph = derivedMaterial(rect).graph;
    expect(graph.nodes.some((node) => node.kind === "mix")).toBe(false);
    expect(
      graph.nodes.some(
        (node) => node.kind === "attribute" && node.name === "color",
      ),
    ).toBe(false);
  });

  it("draws an unpainted half white — the material tier's own picture", () => {
    // "inherit" beside a gradient stroke is UnlitMaterial's default white.
    const rect = new Rectangle({
      width: 2,
      height: 2,
      stroke: { width: 0.5, paint: linear() },
    });
    expect(
      paintedColor(rect, { position: [0, 0, 0], color: [0, 0, 0, 0] }),
    ).toEqual([1, 1, 1, 1]);
    expect(
      paintedColor(rect, { position: [0, 0, 0], color: [1, 1, 1, 1] }),
    ).toEqual([0.5, 0, 0.5, 1]);
    // A paintless stroke beside a gradient fill: same rule, other half.
    const other = new Rectangle({
      width: 2,
      height: 2,
      fill: linear(),
      stroke: { width: 0.5 },
    });
    expect(
      paintedColor(other, { position: [0, 0, 0], color: [1, 1, 1, 1] }),
    ).toEqual([1, 1, 1, 1]);
  });

  it("needs no selector for a single painted half", () => {
    const only = new Circle({ radius: 1, fill: radial() });
    expect(only.geometry.colors).toBeUndefined();
    const strokeOnly = new Line({
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 },
      stroke: { width: 0.1, paint: linear() },
    });
    expect(strokeOnly.geometry.colors).toBeUndefined();
  });

  it("treats one texture object as one paint, two objects as two", () => {
    const texture = fakeTexture();
    const same = new Rectangle({
      width: 2,
      height: 2,
      fill: { kind: "pattern", texture },
      stroke: { width: 0.5, paint: { kind: "pattern", texture } },
    });
    expect(same.geometry.colors).toBeUndefined();
    const different = new Rectangle({
      width: 2,
      height: 2,
      fill: { kind: "pattern", texture },
      stroke: {
        width: 0.5,
        paint: { kind: "pattern", texture: fakeTexture() },
      },
    });
    expect(different.geometry.colors).toBeDefined();
  });

  it("compares radial pairs by value, like every other kind", () => {
    const same = new Rectangle({
      width: 2,
      height: 2,
      fill: radial(),
      stroke: { width: 0.5, paint: radial() },
    });
    expect(same.geometry.colors).toBeUndefined();
    const different = new Rectangle({
      width: 2,
      height: 2,
      fill: radial(),
      stroke: { width: 0.5, paint: radial({ radius: 3 }) },
    });
    expect(different.geometry.colors).toBeDefined();
  });

  it("lowers a later fill: 'none' / stroke: null pair to plain white", () => {
    const circle = new Circle({ radius: 1, fill: radial() });
    circle.fill = "none";
    // Nothing is drawn (no fill, no stroke), but the derived tier still
    // holds a well-formed material.
    expect(circle.geometry.positions).toHaveLength(0);
    expect(paintedColor(circle, {})).toEqual([1, 1, 1, 1]);
  });

  it("keeps the derived material a shared program's worth of deterministic", () => {
    const a = new Circle({ radius: 1, fill: radial() });
    const b = new Circle({ radius: 2, fill: radial() });
    // Two materials (per-shape ownership), one graph shape: identical node
    // arrays mean identical emitted source, which is the backend's program
    // cache key (RFC 0001 §2).
    expect(a.material).not.toBe(b.material);
    expect(derivedMaterial(a).graph).toEqual(derivedMaterial(b).graph);
  });

  it("publishes the support seam the §79 readers use", () => {
    expect(resolveShapePaintSupport()).not.toBeNull();
    clearRegisteredShapePaints();
    expect(resolveShapePaintSupport()).toBeNull();
  });
});
