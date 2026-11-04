/**
 * §60's node pipeline, module tier (RFC 0001): the GLSL ES 3.00 emitter, the
 * program class's uploads and mirrors, the structural program cache with its
 * per-graph failure latch, and the registration slot.
 *
 * Driven by a minimal fake `WebglContext` — only the entry points a program
 * compile-and-upload path touches — because the emitter and cache never draw;
 * the renderer-integration half (the draw arm, the §70 graph-effect path,
 * byte-identity) lives in `webgl-renderer.test.ts` and
 * `tests/integration/node-materials.test.ts`.
 */

import { resetDevWarnings } from "@fourjs/core";
import { Matrix4 } from "@fourjs/math";
import { MAX_LIGHT_SLOTS, type ShaderGraph } from "@fourjs/render";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  GlNodeProgram,
  GlNodeProgramCache,
  NODE_SURFACE_TEXTURE_UNIT_BASE,
  clearRegisteredNodeMaterialPipeline,
  emitShaderGraphGlsl,
  registerNodeMaterialPipeline,
  resolveNodeMaterialPipelineFactory,
  type NodeItemMaterial,
  type WebglContext,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// A fake WebglContext reduced to the compile/upload surface this module uses.
// ---------------------------------------------------------------------------

interface RecordedCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

interface FakeGl extends WebglContext {
  readonly calls: RecordedCall[];
  readonly uniformLocations: Map<string, object>;
  countOf(name: string): number;
  callsOf(name: string): RecordedCall[];
  reset(): void;
}

function createFakeGl(options: { compileStatus?: boolean } = {}): FakeGl {
  const { compileStatus = true } = options;
  const calls: RecordedCall[] = [];
  const uniformLocations = new Map<string, object>();
  let serial = 0;
  const record = (name: string, ...args: unknown[]): void => {
    calls.push({
      name,
      args: args.map((arg) =>
        ArrayBuffer.isView(arg)
          ? Array.from(arg as unknown as ArrayLike<number>)
          : arg,
      ),
    });
  };
  const handle = (kind: string): object => {
    serial += 1;
    return { kind, serial };
  };
  const noop = (name: string) => {
    return (...args: unknown[]): void => {
      record(name, ...args);
    };
  };
  const gl = {
    calls,
    uniformLocations,
    countOf: (name: string) =>
      calls.filter((call) => call.name === name).length,
    callsOf: (name: string) => calls.filter((call) => call.name === name),
    reset: () => {
      calls.length = 0;
    },
    createShader: (type: number) => {
      record("createShader", type);
      return handle("shader");
    },
    shaderSource: noop("shaderSource"),
    compileShader: noop("compileShader"),
    getShaderParameter: (shader: object, pname: number) => {
      record("getShaderParameter", shader, pname);
      return compileStatus;
    },
    getShaderInfoLog: () => "log",
    deleteShader: noop("deleteShader"),
    createProgram: () => {
      record("createProgram");
      return handle("program");
    },
    attachShader: noop("attachShader"),
    linkProgram: noop("linkProgram"),
    getProgramParameter: () => true,
    getProgramInfoLog: () => "",
    deleteProgram: noop("deleteProgram"),
    getUniformLocation: (program: object, name: string) => {
      record("getUniformLocation", program, name);
      let location = uniformLocations.get(name);
      if (location === undefined) {
        location = { uniform: name };
        uniformLocations.set(name, location);
      }
      return location;
    },
    useProgram: noop("useProgram"),
    uniformMatrix4fv: noop("uniformMatrix4fv"),
    uniformMatrix3fv: noop("uniformMatrix3fv"),
    uniform4fv: noop("uniform4fv"),
    uniform3fv: noop("uniform3fv"),
    uniform1f: noop("uniform1f"),
    uniform1i: noop("uniform1i"),
  };
  return gl as unknown as FakeGl;
}

// ---------------------------------------------------------------------------
// Graph fixtures.
// ---------------------------------------------------------------------------

/** The screen copy: `fragColor = texture(s_source, v_uv)`. */
function screenCopyGraph(): ShaderGraph {
  return {
    domain: "screen",
    nodes: [
      { kind: "attribute", name: "uv" },
      { kind: "texture", name: "source", uv: 0 },
    ],
    color: 1,
  };
}

/** A surface gradient over uv with one uniform of every transportable type. */
function surfaceKitchenSink(): ShaderGraph {
  return {
    domain: "surface",
    nodes: [
      /* 0 */ { kind: "attribute", name: "uv" },
      /* 1 */ { kind: "swizzle", source: 0, pattern: "x" },
      /* 2 */ { kind: "uniform", type: "float", name: "gain" },
      /* 3 */ { kind: "uniform", type: "vec2", name: "offset" },
      /* 4 */ { kind: "uniform", type: "vec3", name: "axis" },
      /* 5 */ { kind: "uniform", type: "vec4", name: "tint" },
      /* 6 */ { kind: "uniform", type: "mat3", name: "spin" },
      /* 7 */ { kind: "uniform", type: "mat4", name: "warp" },
      /* 8 */ { kind: "binary", op: "multiply", left: 6, right: 4 },
      /* 9 */ { kind: "binary", op: "multiply", left: 7, right: 5 },
      /* 10 */ { kind: "binary", op: "add", left: 3, right: 0 },
      /* 11 */ { kind: "compose", type: "vec4", parts: [10, 1, 2] },
      /* 12 */ { kind: "binary", op: "add", left: 11, right: 9 },
      /* 13 */ { kind: "compose", type: "vec4", parts: [8, 2] },
      /* 14 */ { kind: "binary", op: "add", left: 12, right: 13 },
    ],
    color: 14,
  };
}

/** A displaced surface: `position + normal * sin(time)`, flat colour. */
function displacedGraph(): ShaderGraph {
  return {
    domain: "surface",
    nodes: [
      /* 0 */ { kind: "attribute", name: "normal" },
      /* 1 */ { kind: "time" },
      /* 2 */ { kind: "unary", op: "sin", source: 1 },
      /* 3 */ { kind: "binary", op: "multiply", left: 0, right: 2 },
      /* 4 */ { kind: "constant", type: "vec4", value: [1, 0.5, 0, 1] },
    ],
    color: 4,
    positionOffset: 3,
  };
}

beforeEach(() => {
  resetDevWarnings();
  clearRegisteredNodeMaterialPipeline();
});

// ---------------------------------------------------------------------------
// The emitter.
// ---------------------------------------------------------------------------

describe("emitShaderGraphGlsl — §33-deterministic GLSL ES 3.00", () => {
  it("emits the screen copy exactly, byte for byte", () => {
    const emitted = emitShaderGraphGlsl(screenCopyGraph());
    expect(emitted.domain).toBe("screen");
    expect(emitted.usesTime).toBe(false);
    expect(emitted.uniforms).toEqual([]);
    expect(emitted.textures).toEqual(["source"]);
    expect(emitted.vertex).toBe(`#version 300 es
out vec2 v_uv;

void main() {
  v_uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(v_uv * 2.0 - 1.0, 0.0, 1.0);
}
`);
    expect(emitted.fragment).toBe(`#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D s_source;

out vec4 fragColor;

void main() {
  vec2 n0 = v_uv;
  vec4 n1 = texture(s_source, n0);
  fragColor = n1;
}
`);
  });

  it("emits a displaced surface graph exactly, byte for byte", () => {
    const emitted = emitShaderGraphGlsl(displacedGraph());
    expect(emitted.usesTime).toBe(true);
    expect(emitted.vertex).toBe(`#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;

uniform mat4 viewProjection;
uniform mat4 model;
uniform float time;

void main() {
  vec3 n0 = normal;
  float n1 = time;
  float n2 = sin(n1);
  vec3 n3 = (n0 * n2);
  gl_Position = viewProjection * model * vec4(position + n3, 1.0);
}
`);
    expect(emitted.fragment).toBe(`#version 300 es
precision highp float;

uniform float opacity;

out vec4 fragColor;

void main() {
  vec4 n4 = vec4(1.0, 0.5, 0.0, 1.0);
  vec4 c = n4;
  fragColor = vec4(c.rgb, c.a * opacity);
}
`);
  });

  it("pads vec2 and mat3 uniforms in the declaration and reads them back narrow", () => {
    const emitted = emitShaderGraphGlsl(surfaceKitchenSink());
    expect(emitted.fragment).toContain("uniform vec4 u_offset;");
    expect(emitted.fragment).toContain("uniform mat4 u_spin;");
    expect(emitted.fragment).toContain("u_offset.xy");
    expect(emitted.fragment).toContain("mat3(u_spin)");
    expect(emitted.fragment).toContain("uniform float u_gain;");
    expect(emitted.fragment).toContain("uniform vec3 u_axis;");
    expect(emitted.fragment).toContain("uniform vec4 u_tint;");
    expect(emitted.fragment).toContain("uniform mat4 u_warp;");
    // Varyings for the uv the colour subgraph reads.
    expect(emitted.vertex).toContain("out vec2 v_uv;");
    expect(emitted.vertex).toContain("  v_uv = uv;");
    expect(emitted.fragment).toContain("in vec2 v_uv;");
  });

  it("emits every operator spelling the closed unions define", () => {
    const graph: ShaderGraph = {
      domain: "surface",
      nodes: [
        /* 0 */ { kind: "constant", type: "vec2", value: [1, 2] },
        /* 1 */ { kind: "constant", type: "float", value: [1e-7] },
        /* 2 */ { kind: "binary", op: "subtract", left: 0, right: 0 },
        /* 3 */ { kind: "binary", op: "divide", left: 2, right: 0 },
        /* 4 */ { kind: "binary", op: "min", left: 3, right: 0 },
        /* 5 */ { kind: "binary", op: "max", left: 4, right: 0 },
        /* 6 */ { kind: "binary", op: "dot", left: 5, right: 0 },
        /* 7 */ { kind: "binary", op: "step", left: 1, right: 6 },
        /* 8 */ { kind: "unary", op: "cos", source: 7 },
        /* 9 */ { kind: "unary", op: "abs", source: 8 },
        /* 10 */ { kind: "unary", op: "floor", source: 9 },
        /* 11 */ { kind: "unary", op: "fract", source: 10 },
        /* 12 */ { kind: "unary", op: "negate", source: 11 },
        /* 13 */ { kind: "unary", op: "saturate", source: 12 },
        /* 14 */ { kind: "unary", op: "normalize", source: 0 },
        /* 15 */ { kind: "unary", op: "length", source: 14 },
        /* 16 */ { kind: "mix", a: 13, b: 15, t: 1 },
        /* 17 */ { kind: "compose", type: "vec4", parts: [16, 13, 15, 1] },
        /* 18 */ { kind: "attribute", name: "position" },
        /* 19 */ { kind: "attribute", name: "color" },
        /* 20 */ { kind: "swizzle", source: 18, pattern: "xy" },
        /* 21 */ { kind: "compose", type: "vec4", parts: [20, 20] },
        /* 22 */ { kind: "binary", op: "add", left: 17, right: 21 },
        /* 23 */ { kind: "binary", op: "add", left: 22, right: 19 },
      ],
      color: 23,
    };
    const emitted = emitShaderGraphGlsl(graph);
    const fragment = emitted.fragment;
    expect(fragment).toContain("vec2 n0 = vec2(1.0, 2.0);");
    expect(fragment).toContain("float n1 = 1e-7;");
    expect(fragment).toContain("(n2 / n0)");
    expect(fragment).toContain("min(n3, n0)");
    expect(fragment).toContain("max(n4, n0)");
    expect(fragment).toContain("dot(n5, n0)");
    expect(fragment).toContain("step(n1, n6)");
    expect(fragment).toContain("cos(n7)");
    expect(fragment).toContain("abs(n8)");
    expect(fragment).toContain("floor(n9)");
    expect(fragment).toContain("fract(n10)");
    expect(fragment).toContain("(-n11)");
    expect(fragment).toContain("clamp(n12, 0.0, 1.0)");
    expect(fragment).toContain("normalize(n0)");
    expect(fragment).toContain("length(n14)");
    expect(fragment).toContain("mix(n13, n15, n1)");
    expect(fragment).toContain("vec4(n16, n13, n15, n1)");
    // Attribute varyings: position and colour travel as v_position/v_color.
    expect(fragment).toContain("vec3 n18 = v_position;");
    expect(fragment).toContain("vec4 n19 = v_color;");
    expect(fragment).toContain("n18.xy");
    expect(emitted.vertex).toContain("out vec3 v_position;");
    expect(emitted.vertex).toContain("out vec4 v_color;");
    expect(emitted.vertex).toContain(
      "layout(location = 3) in vec4 vertexColor;",
    );
    expect(emitted.vertex).toContain("  v_color = vertexColor;");
    // No displacement: the untouched clip transform.
    expect(emitted.vertex).toContain(
      "gl_Position = viewProjection * model * vec4(position, 1.0);",
    );
  });

  it("eliminates dead nodes — the one permitted transform", () => {
    const graph: ShaderGraph = {
      domain: "surface",
      nodes: [
        { kind: "uniform", type: "float", name: "dead" },
        { kind: "constant", type: "vec4", value: [0, 0, 0, 1] },
      ],
      color: 1,
    };
    const emitted = emitShaderGraphGlsl(graph);
    expect(emitted.fragment).not.toContain("u_dead");
    expect(emitted.fragment).not.toContain("n0");
    expect(emitted.uniforms).toEqual([]);
  });

  it("declares screen-domain uniforms and time without a uv varying when unused", () => {
    const graph: ShaderGraph = {
      domain: "screen",
      nodes: [
        { kind: "time" },
        { kind: "uniform", type: "float", name: "gain" },
        { kind: "binary", op: "multiply", left: 0, right: 1 },
        { kind: "compose", type: "vec4", parts: [2, 2, 2, 2] },
      ],
      color: 3,
    };
    const emitted = emitShaderGraphGlsl(graph);
    expect(emitted.usesTime).toBe(true);
    expect(emitted.fragment).toContain("uniform float time;");
    expect(emitted.fragment).not.toContain("in vec2 v_uv;");
    expect(emitted.fragment).toContain("fragColor = n3;");
  });

  it("is a pure function of the graph — same graph, same bytes", () => {
    const first = emitShaderGraphGlsl(surfaceKitchenSink());
    const second = emitShaderGraphGlsl(surfaceKitchenSink());
    expect(second).toEqual(first);
  });
});

// ---------------------------------------------------------------------------
// The program class.
// ---------------------------------------------------------------------------

/** A `NodeMaterial` double: what the program's `setMaterial` reads. */
function nodeMaterialDouble(
  uniforms: Record<string, readonly number[]>,
  opacity = 1,
): NodeItemMaterial {
  return {
    opacity,
    getUniform: (name: string) => new Float32Array(uniforms[name]),
  } as unknown as NodeItemMaterial;
}

describe("GlNodeProgram", () => {
  it("compiles the emitted pair and resolves every binding", () => {
    const gl = createFakeGl();
    const program = GlNodeProgram.create(
      gl,
      emitShaderGraphGlsl(surfaceKitchenSink()),
    );
    expect(gl.countOf("createShader")).toBe(2);
    expect(gl.countOf("linkProgram")).toBe(1);
    expect(program.disposed).toBe(false);
    expect(program.unitBase).toBe(NODE_SURFACE_TEXTURE_UNIT_BASE);
    expect(program.textures).toEqual([]);
    const resolved = gl
      .callsOf("getUniformLocation")
      .map((call) => call.args[1]);
    expect(resolved).toEqual([
      "viewProjection",
      "model",
      "opacity",
      "u_gain",
      "u_offset",
      "u_axis",
      "u_tint",
      "u_spin",
      "u_warp",
    ]);
  });

  it("uploads sampler units once, on first use, from the domain's base", () => {
    const gl = createFakeGl();
    const program = GlNodeProgram.create(
      gl,
      emitShaderGraphGlsl(screenCopyGraph()),
    );
    expect(program.unitBase).toBe(0);
    expect(program.textures).toEqual(["source"]);
    gl.reset();
    program.use();
    program.use();
    expect(gl.countOf("useProgram")).toBe(2);
    expect(gl.callsOf("uniform1i")).toHaveLength(1);
    expect(gl.callsOf("uniform1i")[0].args[1]).toBe(0);
  });

  it("mirrors opacity and time at GL's initial values and uploads on change", () => {
    const gl = createFakeGl();
    const program = GlNodeProgram.create(
      gl,
      emitShaderGraphGlsl(displacedGraph()),
    );
    gl.reset();
    // Time: 0 is GL's initial value — no call; then one per change.
    program.setTime(0);
    expect(gl.countOf("uniform1f")).toBe(0);
    program.setTime(1.5);
    program.setTime(1.5);
    expect(gl.countOf("uniform1f")).toBe(1);
    // Opacity through setMaterial: first draw uploads 1 (mirror starts at 0),
    // a second draw at the same opacity uploads nothing.
    const material = nodeMaterialDouble({});
    program.setMaterial(material);
    program.setMaterial(material);
    expect(gl.countOf("uniform1f")).toBe(2);
  });

  it("setTime is a no-op for a graph with no time node", () => {
    const gl = createFakeGl();
    const program = GlNodeProgram.create(
      gl,
      emitShaderGraphGlsl(screenCopyGraph()),
    );
    gl.reset();
    program.setTime(2);
    expect(gl.countOf("uniform1f")).toBe(0);
  });

  it("view and model uploads are no-ops on a screen program", () => {
    const gl = createFakeGl();
    const program = GlNodeProgram.create(
      gl,
      emitShaderGraphGlsl(screenCopyGraph()),
    );
    gl.reset();
    program.setViewProjection(new Matrix4());
    program.setModel(new Matrix4());
    program.setMaterial(nodeMaterialDouble({}));
    expect(gl.calls).toEqual([]);
  });

  it("uploads every uniform type through the padding rule", () => {
    const gl = createFakeGl();
    const program = GlNodeProgram.create(
      gl,
      emitShaderGraphGlsl(surfaceKitchenSink()),
    );
    gl.reset();
    program.setViewProjection(new Matrix4());
    program.setModel(new Matrix4());
    program.setMaterial(
      nodeMaterialDouble(
        {
          gain: [2],
          offset: [3, 4],
          axis: [5, 6, 7],
          tint: [8, 9, 10, 11],
          spin: [1, 2, 3, 4, 5, 6, 7, 8, 9],
          warp: Array.from({ length: 16 }, (_, index) => index),
        },
        0.5,
      ),
    );
    // gain: uniform1f (after the opacity upload — mirror moved to 0.5).
    const floatUploads = gl.callsOf("uniform1f");
    expect(floatUploads.map((call) => call.args[1])).toEqual([0.5, 2]);
    // offset: padded to vec4.
    const vec4Uploads = gl.callsOf("uniform4fv");
    expect(vec4Uploads[0].args[1]).toEqual([3, 4, 0, 0]);
    expect(vec4Uploads[1].args[1]).toEqual([8, 9, 10, 11]);
    // axis: vec3.
    expect(gl.callsOf("uniform3fv")[0].args[1]).toEqual([5, 6, 7]);
    // spin: mat3 padded column-wise into a mat4 with an identity w column;
    // warp: mat4 verbatim. (Two view/model uploads precede them.)
    const matrixUploads = gl.callsOf("uniformMatrix4fv");
    expect(matrixUploads).toHaveLength(4);
    expect(matrixUploads[2].args[2]).toEqual([
      1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0, 0, 0, 0, 1,
    ]);
    expect(matrixUploads[3].args[2]).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
  });

  it("setUniform ignores a name the program does not declare (§61)", () => {
    const gl = createFakeGl();
    const program = GlNodeProgram.create(
      gl,
      emitShaderGraphGlsl(screenCopyGraph()),
    );
    gl.reset();
    program.setUniform("missing", [1]);
    expect(gl.calls).toEqual([]);
  });

  it("disposes idempotently", () => {
    const gl = createFakeGl();
    const program = GlNodeProgram.create(
      gl,
      emitShaderGraphGlsl(screenCopyGraph()),
    );
    program.dispose();
    program.dispose();
    expect(program.disposed).toBe(true);
    expect(gl.countOf("deleteProgram")).toBe(1);
  });

  it("cleans up the linked program when a binding cannot resolve (§89)", () => {
    const gl = createFakeGl();
    // A context whose getUniformLocation answers null for everything.
    (gl as { getUniformLocation: unknown }).getUniformLocation = () => null;
    expect(() =>
      GlNodeProgram.create(gl, emitShaderGraphGlsl(screenCopyGraph())),
    ).toThrowError(/no active uniform/);
    expect(gl.countOf("deleteProgram")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The structural cache.
// ---------------------------------------------------------------------------

describe("GlNodeProgramCache", () => {
  it("shares one program across graph identity and graph structure", () => {
    const gl = createFakeGl();
    const cache = new GlNodeProgramCache(gl);
    const graph = screenCopyGraph();
    const first = cache.acquire(graph);
    expect(first).not.toBeNull();
    expect(cache.programCount).toBe(1);
    // Identity fast path: no re-emit, no compile.
    expect(cache.acquire(graph)).toBe(first);
    // Structural path: a *different object* with the same structure shares
    // the compiled program — one program for N materials, as compile count.
    expect(cache.acquire(screenCopyGraph())).toBe(first);
    expect(cache.programCount).toBe(1);
    expect(gl.countOf("linkProgram")).toBe(1);
    // A structurally different graph compiles a second program.
    expect(cache.acquire(displacedGraph())).not.toBe(first);
    expect(cache.programCount).toBe(2);
  });

  it("latches a malformed graph as null with one §85 warning (§61)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const cache = new GlNodeProgramCache(createFakeGl());
      const broken: ShaderGraph = { domain: "surface", nodes: [], color: 0 };
      expect(cache.acquire(broken)).toBeNull();
      expect(cache.acquire(broken)).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(cache.programCount).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });

  it("latches a driver compile refusal per graph, warned once (§89)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const gl = createFakeGl({ compileStatus: false });
      const cache = new GlNodeProgramCache(gl);
      const graph = screenCopyGraph();
      expect(cache.acquire(graph)).toBeNull();
      const compiles = gl.countOf("compileShader");
      expect(cache.acquire(graph)).toBeNull();
      // The latch: the driver was not asked again.
      expect(gl.countOf("compileShader")).toBe(compiles);
      expect(warn).toHaveBeenCalledTimes(1);
      // A different failing graph warns once more — per graph, not per cache.
      expect(cache.acquire(displacedGraph())).toBeNull();
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it("disposes every compiled program, idempotently", () => {
    const gl = createFakeGl();
    const cache = new GlNodeProgramCache(gl);
    cache.acquire(screenCopyGraph());
    cache.acquire(displacedGraph());
    cache.dispose();
    cache.dispose();
    expect(gl.countOf("deleteProgram")).toBe(2);
    expect(cache.programCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The registration slot.
// ---------------------------------------------------------------------------

describe("registerNodeMaterialPipeline", () => {
  it("fills the slot with a factory whose create() compiles nothing", () => {
    expect(resolveNodeMaterialPipelineFactory()).toBeNull();
    registerNodeMaterialPipeline();
    const factory = resolveNodeMaterialPipelineFactory();
    expect(factory).not.toBeNull();
    const gl = createFakeGl();
    const cache = factory!.create(gl);
    expect(gl.calls).toEqual([]);
    expect(cache.programCount).toBe(0);
    // The created cache is the real one.
    expect(cache.acquire(screenCopyGraph())).not.toBeNull();
    expect(cache.programCount).toBe(1);
  });

  it("clears back to null for the unregistered-path tests", () => {
    registerNodeMaterialPipeline();
    clearRegisteredNodeMaterialPipeline();
    expect(resolveNodeMaterialPipelineFactory()).toBeNull();
  });
});

describe("node std140 transport and provenance", () => {
  function blockContext() {
    const gl = createFakeGl();
    const uploads: number[][] = [];
    gl.getUniformBlockIndex = vi.fn(() => 0);
    gl.uniformBlockBinding = vi.fn();
    gl.bindBufferBase = vi.fn();
    gl.createBuffer = vi.fn(() => ({}));
    gl.bindBuffer = vi.fn();
    gl.bufferData = vi.fn((_target, data) => {
      uploads.push(Array.from(data as Float32Array));
    });
    const deleteBuffer = vi.fn();
    gl.deleteBuffer = deleteBuffer;
    return { gl, uploads, deleteBuffer };
  }

  it("emits one identical std140 declaration per stage and pads all six types", () => {
    const graph = {
      ...surfaceKitchenSink(),
      uniformTransport: "std140" as const,
    };
    const emitted = emitShaderGraphGlsl(graph);
    expect(emitted.uniformBlock).toBe(true);
    expect(emitted.fragment).toContain(
      "layout(std140) uniform FourNodeUniforms",
    );
    expect(emitted.fragment).toContain("vec4 u_gain;");
    expect(emitted.fragment).toContain("mat4 u_spin;");
    expect(emitted.fragment).toContain("= u_gain.x;");
    expect(emitted.fragment).toContain("= u_axis.xyz;");
    expect(emitted.vertex.match(/layout\(std140\)[\s\S]*?};/)?.[0]).toBe(
      emitted.fragment.match(/layout\(std140\)[\s\S]*?};/)?.[0],
    );
    const { gl, uploads, deleteBuffer } = blockContext();
    const program = GlNodeProgram.create(gl, emitted);
    program.use();
    gl.reset();
    const data = {
      gain: [2],
      offset: [3, 4],
      axis: [5, 6, 7],
      tint: [8, 9, 10, 11],
      spin: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      warp: Array.from({ length: 16 }, (_, i) => i + 1),
    };
    program.setMaterial(nodeMaterialDouble(data));
    expect(uploads).toHaveLength(2); // allocation, then one draw upload
    expect(uploads[1]).toEqual([
      2,
      0,
      0,
      0,
      3,
      4,
      0,
      0,
      5,
      6,
      7,
      0,
      8,
      9,
      10,
      11,
      1,
      2,
      3,
      0,
      4,
      5,
      6,
      0,
      7,
      8,
      9,
      0,
      0,
      0,
      0,
      1,
      ...data.warp,
    ]);
    expect(gl.countOf("uniform4fv")).toBe(0);
    program.setUniform("absent", [3]);
    expect(uploads).toHaveLength(2);
    program.setUniform("gain", [12]);
    expect(uploads).toHaveLength(3);
    expect(uploads[2][0]).toBe(12);
    program.dispose();
    program.dispose();
    expect(deleteBuffer).toHaveBeenCalledTimes(1);
  });

  it("refuses unsupported/missing blocks and releases failed allocations", () => {
    const emitted = emitShaderGraphGlsl({
      ...surfaceKitchenSink(),
      uniformTransport: "std140",
    });
    expect(() => GlNodeProgram.create(createFakeGl(), emitted)).toThrow(
      "entry points",
    );
    const { gl, deleteBuffer } = blockContext();
    gl.getUniformBlockIndex = () => 0xffffffff;
    expect(() => GlNodeProgram.create(gl, emitted)).toThrow("missing");
    gl.getUniformBlockIndex = () => 0;
    gl.createBuffer = () => null;
    expect(() => GlNodeProgram.create(gl, emitted)).toThrow("allocate");
    gl.createBuffer = () => ({});
    gl.bufferData = () => {
      throw new Error("driver failed");
    };
    expect(() => GlNodeProgram.create(gl, emitted)).toThrow("driver failed");
    expect(deleteBuffer).toHaveBeenCalledTimes(1);
  });

  it("supports screen blocks and omits an empty block", () => {
    const screen = {
      ...surfaceKitchenSink(),
      domain: "screen" as const,
      uniformTransport: "std140" as const,
    };
    expect(emitShaderGraphGlsl(screen).uniformBlock).toBe(true);
    expect(
      emitShaderGraphGlsl({ ...screenCopyGraph(), uniformTransport: "std140" })
        .uniformBlock,
    ).toBeUndefined();
  });

  it("maps emitted node statements and attaches maps to compiler errors", () => {
    const emitted = emitShaderGraphGlsl(displacedGraph());
    for (const stage of ["vertex", "fragment"] as const) {
      for (const location of emitted.sourceMap[stage]) {
        expect(emitted[stage].split("\n")[location.line - 1]).toContain(
          `n${String(location.nodeId)} =`,
        );
        expect(location.stage).toBe(stage);
      }
    }
    let caught: unknown;
    try {
      GlNodeProgram.create(createFakeGl({ compileStatus: false }), emitted);
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toHaveProperty("context.sourceMap", emitted.sourceMap);
  });
});

// ---------------------------------------------------------------------------
// RFC 0001 addendum (accepted 2026-11-04): defines, lights, storage refusal.
// ---------------------------------------------------------------------------

describe("emitShaderGraphGlsl — addendum nodes", () => {
  const base: ShaderGraph = {
    domain: "surface",
    nodes: [
      { kind: "constant", type: "vec4", value: [1, 0, 0, 1] },
      { kind: "constant", type: "vec4", value: [0, 0, 1, 1] },
      { kind: "select", define: "A", then: 0, otherwise: 1 },
      { kind: "select", define: "B", then: 0, otherwise: 1 },
    ],
    color: 2,
  };

  it("emits only the live branch and shares a program across equal source", () => {
    const on = { ...base, defines: { A: true, B: true } };
    const onToo = { ...base, defines: { A: true, B: false } };
    const off = { ...base, defines: { A: false } };
    const emitted = emitShaderGraphGlsl(on);
    expect(emitted.fragment).toContain("vec4 n0 = vec4(1.0, 0.0, 0.0, 1.0);");
    expect(emitted.fragment).not.toContain("vec4(0.0, 0.0, 1.0, 1.0)");
    expect(emitted.fragment).toContain("vec4 n2 = n0;");
    expect(emitShaderGraphGlsl(off).fragment).toContain("vec4 n2 = n1;");
    const cache = new GlNodeProgramCache(createFakeGl());
    const a = cache.acquire(on);
    expect(cache.acquire(onToo)).toBe(a);
    expect(cache.acquire(off)).not.toBe(a);
    expect(cache.programCount).toBe(2);
  });

  it("declares and clamps the light family", () => {
    const graph: ShaderGraph = {
      domain: "surface",
      nodes: [
        { kind: "light", member: "ambient" },
        { kind: "light", member: "directionalDirection" },
        { kind: "light", member: "directionalColor" },
        { kind: "light", member: "cameraPosition" },
        { kind: "light", member: "punctualCount" },
        { kind: "constant", type: "float", value: [1.9] },
        { kind: "light", member: "punctualPosition", index: 5 },
        { kind: "light", member: "punctualColor", index: 5 },
        { kind: "light", member: "punctualDirection", index: 5 },
        { kind: "light", member: "punctualParams", index: 5 },
        { kind: "binary", op: "add", left: 0, right: 1 },
        { kind: "binary", op: "add", left: 10, right: 2 },
        { kind: "binary", op: "add", left: 11, right: 3 },
        { kind: "binary", op: "add", left: 12, right: 6 },
        { kind: "binary", op: "add", left: 13, right: 7 },
        { kind: "binary", op: "add", left: 14, right: 8 },
        { kind: "compose", type: "vec4", parts: [15, 4] },
        { kind: "binary", op: "add", left: 16, right: 9 },
      ],
      color: 17,
    };
    const emitted = emitShaderGraphGlsl(graph);
    expect(emitted.lights).toHaveLength(9);
    expect(emitted.fragment).toContain("uniform vec3 l_ambient;");
    expect(emitted.fragment).toContain("uniform float l_count;");
    expect(emitted.fragment).toContain(
      `uniform vec3 l_positions[${String(MAX_LIGHT_SLOTS)}];`,
    );
    expect(emitted.fragment).toContain(
      `uniform vec4 l_params[${String(MAX_LIGHT_SLOTS)}];`,
    );
    expect(emitted.fragment).toContain(
      `l_colors[clamp(int(n5), 0, ${String(MAX_LIGHT_SLOTS - 1)})]`,
    );
    expect(emitShaderGraphGlsl(base).lights).toEqual([]);
  });

  it("refuses storage nodes (WebGL 2 has no storage buffers)", () => {
    const graph: ShaderGraph = {
      domain: "surface",
      nodes: [
        { kind: "constant", type: "float", value: [0] },
        { kind: "storage", name: "pal", type: "vec4", count: 4, index: 0 },
      ],
      color: 1,
    };
    expect(() => emitShaderGraphGlsl(graph)).toThrow(/storage buffers/);
  });
});
