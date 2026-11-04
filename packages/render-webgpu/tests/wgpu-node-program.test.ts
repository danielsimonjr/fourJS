/**
 * §60's WebGPU node pipeline, module tier (RFC 0001; WP-R1.9): the WGSL
 * emitter's operator spellings and binding metadata, the pipeline store's
 * structural cache, uniform packing, texture-group composition and failure
 * latches, the registration slot, and the renderer's node arm — byte-identity
 * for nodeless scenes included — all against the recording device double.
 *
 * The graphs here are hand-built IR values (`ShaderGraph` is plain JSON), not
 * `NodeMaterialBuilder` output: this package's dependency row is
 * `core, math, render` (§3.1, frozen), so `@fourjs/materials` may not be named
 * even in a test — the builder-driven composition lives in
 * `tests/integration/webgpu-node-materials.test.ts`, and the byte-for-byte
 * emission golden in `tests/determinism/shader-graph-wgsl.test.ts`.
 */

import { resetDevWarnings } from "@fourjs/core";
import { Matrix4, type Vector3 } from "@fourjs/math";
import {
  Renderable,
  RenderTarget,
  createRenderStatistics,
  MAX_LIGHT_SLOTS,
  SHADER_LIGHT_SLOTS,
  analyzeShaderGraph,
  createSceneLights,
  type RenderItem,
  type Renderer,
  type ShaderGraph,
  type ShaderReflection,
  type UnlitRenderItem,
} from "@fourjs/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRecordingGpu,
  withHostGpu,
  type RecordingGpu,
} from "../../../tests/integration/helpers/recording-gpu.js";
import {
  LIGHT_UNIFORM_BYTES,
  LIGHT_UNIFORM_FLOATS,
  NODE_SCREEN_BLOCK_BASE_BYTES,
  NODE_SURFACE_BLOCK_BASE_BYTES,
  WebgpuRenderer,
  WgpuGeometryCache,
  WgpuNodePipelineStore,
  WgpuRenderTargetCache,
  WgpuTextureCache,
  clearRegisteredWebgpuNodeMaterialPipeline,
  emitShaderGraphWgsl,
  frameWantsStencil,
  registerWebgpuNodeMaterialPipeline,
  resolveWebgpuNodeMaterialPipelineFactory,
  type GpuDevice,
  type GpuRenderPassEncoder,
  type WgpuNodeFrameState,
  type WgpuNodeItemMaterial,
} from "../src/index.js";

type RenderView = Parameters<Renderer["render"]>[1][number];
type RenderCamera = RenderView["camera"];
type ItemGeometry = RenderItem["geometry"];
type ItemMaterial = UnlitRenderItem["material"];

// ---------------------------------------------------------------------------
// Hand-built IR graphs.
// ---------------------------------------------------------------------------

/** A flat surface colour — one constant. */
function colorGraph(color: readonly number[] = [1, 0.5, 0.25, 1]): ShaderGraph {
  return {
    domain: "surface",
    nodes: [{ kind: "constant", type: "vec4", value: color }],
    color: 0,
  };
}

/** A surface graph sampling `map` through the uv attribute. */
function texturedGraph(): ShaderGraph {
  return {
    domain: "surface",
    nodes: [
      { kind: "attribute", name: "uv" },
      { kind: "texture", name: "map", uv: 0 },
    ],
    color: 1,
  };
}

/** A surface graph displacing along a constant and reading time + a uniform. */
function displacedGraph(): ShaderGraph {
  return {
    domain: "surface",
    nodes: [
      { kind: "constant", type: "vec3", value: [0, 1, 0] },
      { kind: "time" },
      { kind: "uniform", type: "vec4", name: "tint" },
      { kind: "constant", type: "float", value: [1] },
      { kind: "compose", type: "vec4", parts: [1, 1, 1, 3] },
      { kind: "binary", op: "multiply", left: 2, right: 4 },
    ],
    color: 5,
    positionOffset: 0,
  };
}

/**
 * Every closed operator the GLSL emitter's operator test walks, in WGSL —
 * chained so every node is reachable from `color` (dead-node elimination is
 * the one permitted transform, and it must not eat the evidence).
 */
function operatorGraph(): ShaderGraph {
  return {
    domain: "surface",
    nodes: [
      { kind: "constant", type: "float", value: [0.5] }, // 0
      { kind: "constant", type: "vec3", value: [1, 2, 3] }, // 1
      { kind: "unary", op: "negate", source: 0 }, // 2
      { kind: "unary", op: "saturate", source: 1 }, // 3
      { kind: "unary", op: "sin", source: 2 }, // 4
      { kind: "unary", op: "length", source: 3 }, // 5
      { kind: "binary", op: "add", left: 1, right: 3 }, // 6
      { kind: "binary", op: "min", left: 0, right: 1 }, // 7  float × vec3
      { kind: "binary", op: "max", left: 1, right: 0 }, // 8  vec3 × float
      { kind: "binary", op: "step", left: 0, right: 1 }, // 9  float edge
      { kind: "binary", op: "step", left: 1, right: 1 }, // 10 matching
      { kind: "binary", op: "dot", left: 6, right: 7 }, // 11
      { kind: "swizzle", source: 6, pattern: "xy" }, // 12
      { kind: "mix", a: 7, b: 8, t: 0 }, // 13
      { kind: "binary", op: "add", left: 9, right: 10 }, // 14
      { kind: "binary", op: "add", left: 13, right: 14 }, // 15
      { kind: "compose", type: "vec4", parts: [12, 4, 5] }, // 16
      { kind: "compose", type: "vec4", parts: [15, 11] }, // 17
      { kind: "mix", a: 16, b: 17, t: 0 }, // 18
    ],
    color: 18,
  };
}

/** Every transportable uniform type, combined into one colour. */
function uniformTypesGraph(): ShaderGraph {
  return {
    domain: "surface",
    nodes: [
      { kind: "uniform", type: "float", name: "gain" }, // 0
      { kind: "uniform", type: "vec2", name: "offset" }, // 1
      { kind: "uniform", type: "vec3", name: "axis" }, // 2
      { kind: "uniform", type: "vec4", name: "tint" }, // 3
      { kind: "uniform", type: "mat3", name: "spin" }, // 4
      { kind: "uniform", type: "mat4", name: "warp" }, // 5
      { kind: "binary", op: "multiply", left: 4, right: 2 }, // 6 vec3
      { kind: "binary", op: "multiply", left: 5, right: 3 }, // 7 vec4
      { kind: "swizzle", source: 1, pattern: "x" }, // 8 float
      { kind: "binary", op: "multiply", left: 8, right: 0 }, // 9 float
      { kind: "compose", type: "vec4", parts: [6, 9] }, // 10 vec4
      { kind: "binary", op: "add", left: 7, right: 10 }, // 11
    ],
    color: 11,
  };
}

/** A screen graph copying `source` through the pass's own uv. */
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

/** A screen graph with a uniform and time — the block-carrying shape. */
function screenGradedGraph(): ShaderGraph {
  return {
    domain: "screen",
    nodes: [
      { kind: "attribute", name: "uv" },
      { kind: "texture", name: "source", uv: 0 },
      { kind: "uniform", type: "float", name: "gain" },
      { kind: "time" },
      { kind: "binary", op: "multiply", left: 1, right: 2 },
      { kind: "binary", op: "multiply", left: 4, right: 3 },
    ],
    color: 5,
  };
}

/** A screen graph with no textures, uniforms, or time — zero bind groups. */
function screenConstantGraph(): ShaderGraph {
  return {
    domain: "screen",
    nodes: [{ kind: "constant", type: "vec4", value: [0, 0, 1, 1] }],
    color: 0,
  };
}

/** A graph `analyzeShaderGraph` refuses — the emission-failure latch's input. */
function malformedGraph(): ShaderGraph {
  return { domain: "surface", nodes: [], color: 0 };
}

// ---------------------------------------------------------------------------
// Scene doubles — webgpu-renderer.test.ts's shapes, node-flavoured.
// ---------------------------------------------------------------------------

let nextGeometryId = 0;

class TestGeometry {
  readonly id: string;

  version = 0;

  positions: Float32Array;

  normals: Float32Array | undefined;

  uvs: Float32Array | undefined;

  colors: Float32Array | undefined;

  indices: Uint16Array | undefined;

  mode: "triangles" | "lines" = "triangles";

  constructor(positions: Float32Array, indices?: Uint16Array, id?: string) {
    nextGeometryId += 1;
    // A fixed `id` keeps two rigs' transcripts comparable byte for byte —
    // the cache labels buffers with it, so a serial id would differ across
    // otherwise identical frames.
    this.id = id ?? `node-test-geometry-${String(nextGeometryId)}`;
    this.positions = positions;
    this.indices = indices;
  }

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get drawCount(): number {
    return this.indices === undefined
      ? this.positions.length / 3
      : this.indices.length;
  }

  get asGeometry(): ItemGeometry {
    return this as unknown as ItemGeometry;
  }
}

let nextTextureId = 0;

class TestTexture {
  readonly id: string;

  version = 0;

  readonly width = 2;

  readonly height = 2;

  data: Uint8Array | null = new Uint8Array(16);

  disposed = false;

  constructor() {
    nextTextureId += 1;
    this.id = `node-test-texture-${String(nextTextureId)}`;
  }

  dispose(): void {
    this.disposed = true;
    this.version += 1;
  }
}

let nextMaterialId = 0;

/** §57's node material, reduced to the surface the store reads. */
class TestNodeMaterial {
  readonly kind = "node";

  readonly id: string;

  graph: ShaderGraph;

  opacity?: number;

  transparent?: boolean;

  blendMode?: "normal" | "additive" | "multiply" | "screen";

  depthTest?: boolean;

  depthWrite?: boolean;

  colorWrite?: boolean;

  stencil?: { func?: string; ref?: number; writeMask?: number };

  readonly uniforms = new Map<string, Float32Array>();

  readonly textures = new Map<string, unknown>();

  constructor(graph: ShaderGraph) {
    nextMaterialId += 1;
    this.id = `node-test-material-${String(nextMaterialId)}`;
    this.graph = graph;
  }

  getUniform(name: string): Float32Array {
    return this.uniforms.get(name) ?? new Float32Array(16);
  }

  getTexture(name: string): TestTexture | null {
    return (this.textures.get(name) as TestTexture | undefined) ?? null;
  }

  readonly storage = new Map<string, unknown>();

  getStorage(name: string): unknown {
    return this.storage.get(name) ?? null;
  }

  /** What `NodeMaterial` derives at construction. */
  get reflection(): ShaderReflection {
    return analyzeShaderGraph(this.graph).reflection;
  }

  get asMaterial(): WgpuNodeItemMaterial {
    return this as unknown as WgpuNodeItemMaterial;
  }
}

/** §57's `LitMaterial`, reduced to what the shaded arm reads. */
function litMaterial(): {
  kind: "lit";
  color: [number, number, number, number];
} {
  return { kind: "lit", color: [1, 1, 1, 1] };
}

/** §69's casting directional light — `collectSceneLights`' structural triple. */
class CastingLightNode extends Renderable {
  readonly isDirectionalLight = true;

  color: [number, number, number] = [1, 1, 1];

  intensity = 1;

  direction: [number, number, number] = [0, 0, -1];

  castShadow = true;

  shadow = { mapSize: 256, bias: 0.004, normalBias: 0.01 };

  constructor() {
    super(new TestGeometry(new Float32Array(0)).asGeometry, {
      color: [1, 1, 1, 1],
    } as unknown as ItemMaterial);
  }

  getWorldDirection(out: Vector3): Vector3 {
    return out.set(this.direction[0], this.direction[1], this.direction[2]);
  }

  computeShadowMatrix(out: Matrix4): Matrix4 {
    out.identity();
    return out;
  }
}

class TestCamera {
  readonly projectionMatrix = new Matrix4();

  readonly viewMatrix = new Matrix4();

  readonly transform = { worldMatrix: new Matrix4() };

  layers: number | undefined = undefined;

  updateViewMatrix(): void {
    // The double has nothing to derive.
  }

  get asCamera(): RenderCamera {
    return this as unknown as RenderCamera;
  }
}

function triangle(): TestGeometry {
  return new TestGeometry(
    new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
  );
}

function texturedTriangle(): TestGeometry {
  const geometry = triangle();
  geometry.uvs = new Float32Array([0, 0, 1, 0, 0.5, 1]);
  return geometry;
}

function nodeRenderable(
  geometry: TestGeometry,
  material: TestNodeMaterial,
): Renderable<WgpuNodeItemMaterial> {
  return new Renderable<WgpuNodeItemMaterial>(
    geometry.asGeometry,
    material.asMaterial,
  );
}

function createView(overrides: Partial<RenderView> = {}): RenderView {
  return {
    id: "main",
    camera: new TestCamera().asCamera,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    normalized: true,
    ...overrides,
  };
}

interface Harness {
  readonly gpu: RecordingGpu;
  readonly renderer: WebgpuRenderer;
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

/** A store over a fresh recording device, plus the caches it composes. */
interface StoreHarness {
  readonly gpu: RecordingGpu;
  readonly device: GpuDevice;
  readonly store: WgpuNodePipelineStore;
  readonly geometries: WgpuGeometryCache;
  readonly textures: WgpuTextureCache;
  readonly renderTargets: WgpuRenderTargetCache;
  readonly pass: GpuRenderPassEncoder;
}

function createStore(): StoreHarness {
  const gpu = createRecordingGpu();
  const device = gpu.device;
  if (device === null) {
    throw new Error("the recording device double is always present");
  }
  const textures = new WgpuTextureCache(device);
  const renderTargets = new WgpuRenderTargetCache(
    device,
    () => textures.bindGroupLayout,
  );
  const geometries = new WgpuGeometryCache(device);
  const store = new WgpuNodePipelineStore({
    device,
    geometries,
    textures,
    renderTargets,
  });
  const pass = device
    .createCommandEncoder()
    .beginRenderPass({ colorAttachments: [] });
  gpu.reset();
  return { gpu, device, store, geometries, textures, renderTargets, pass };
}

function nodeItem(
  geometry: TestGeometry,
  material: TestNodeMaterial,
  overrides: Partial<{
    clip: unknown;
    worldMatrix: Matrix4;
  }> = {},
): RenderItem {
  return {
    kind: "node",
    geometry: geometry.asGeometry,
    material: material.asMaterial,
    worldMatrix: overrides.worldMatrix ?? new Matrix4(),
    castShadow: true,
    receiveShadow: true,
    layers: 0xffffffff,
    clip: overrides.clip ?? null,
  } as unknown as RenderItem;
}

/** The last `queue.writeBuffer` of the tape — the store's block upload. */
function lastUpload(gpu: RecordingGpu): number[] {
  const uploads = gpu.callsOf("queue.writeBuffer");
  const last = uploads[uploads.length - 1];
  if (last === undefined) {
    throw new Error("nothing was uploaded");
  }
  return last.args[2] as number[];
}

/** How many node texture groups the tape composed, told by their label. */
function nodeTextureGroups(gpu: RecordingGpu): number {
  return gpu
    .callsOf("device.createBindGroup")
    .filter(
      (call) =>
        (call.args[0] as { label?: string }).label === "fourJS:node-textures",
    ).length;
}

function frameState(
  overrides: Partial<WgpuNodeFrameState> = {},
): WgpuNodeFrameState {
  return {
    viewProjection: new Matrix4(),
    renderTime: 0,
    colorFormat: "bgra8unorm",
    depthFormat: "depth24plus",
    frameStencil: false,
    stencilReference: 0,
    activeTarget: null,
    statistics: null,
    lights: null,
    eyeX: 0,
    eyeY: 0,
    eyeZ: 0,
    ...overrides,
  };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetDevWarnings();
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
  clearRegisteredWebgpuNodeMaterialPipeline();
});

// ---------------------------------------------------------------------------
// Emission.
// ---------------------------------------------------------------------------

describe("emitShaderGraphWgsl — §33-deterministic WGSL", () => {
  it("emits every operator spelling, splatting mixed min/max/step", () => {
    const emitted = emitShaderGraphWgsl(operatorGraph());
    expect(emitted.domain).toBe("surface");
    const code = emitted.code;
    expect(code).toContain("let n2 : f32 = (-n0);");
    expect(code).toContain("saturate(n1)");
    expect(code).toContain("sin(n2)");
    expect(code).toContain("length(n3)");
    expect(code).toContain("(n1 + n3)");
    // The splat spellings — GLSL's genType overloads, written out.
    expect(code).toContain("min(vec3<f32>(n0), n1)");
    expect(code).toContain("max(n1, vec3<f32>(n0))");
    expect(code).toContain("step(vec3<f32>(n0), n1)");
    expect(code).toContain("step(n1, n1)");
    expect(code).toContain("dot(n6, n7)");
    expect(code).toContain("n6.xy");
    expect(code).toContain("mix(n7, n8, n0)");
    expect(code).toContain("vec4<f32>(n15, n11)");
    expect(code).toContain("mix(n16, n17, n0)");
    // No uniforms, no textures, no time: block is the 144-byte prefix alone.
    expect(emitted.blockBytes).toBe(NODE_SURFACE_BLOCK_BASE_BYTES);
    expect(emitted.textureGroup).toBeNull();
    expect(emitted.vertexStreams).toEqual(["position"]);
  });

  it("declares the displaced graph's offset in the vertex stage with time", () => {
    const emitted = emitShaderGraphWgsl(displacedGraph());
    expect(emitted.usesTime).toBe(true);
    expect(emitted.uniformSlots).toBe(1);
    expect(emitted.blockBytes).toBe(NODE_SURFACE_BLOCK_BASE_BYTES + 16);
    expect(emitted.code).toContain("(position + n0)");
    // Time reads the params lane in both stages.
    expect(emitted.code).toContain("node.params.y");
    // The fragment multiplies §57 opacity in.
    expect(emitted.code).toContain("c.a * node.params.x");
  });

  it("routes surface samples unflipped and screen samples v-flipped", () => {
    const surface = emitShaderGraphWgsl(texturedGraph());
    expect(surface.code).toContain("textureSample(t_map, s_map, n0)");
    expect(surface.textureGroup).toBe(1);
    expect(surface.vertexStreams).toEqual(["position", "uv"]);
    const screen = emitShaderGraphWgsl(screenCopyGraph());
    expect(screen.code).toContain(
      "textureSample(t_source, s_source, vec2<f32>(n0.x, 1.0 - n0.y))",
    );
    expect(screen.textureGroup).toBe(0);
    expect(screen.vertexStreams).toEqual([]);
  });

  it("gives a block-less screen graph zero groups and no NodeUniforms", () => {
    const emitted = emitShaderGraphWgsl(screenConstantGraph());
    expect(emitted.blockBytes).toBe(0);
    expect(emitted.blockGroup).toBeNull();
    expect(emitted.textureGroup).toBeNull();
    expect(emitted.code).not.toContain("NodeUniforms");
    expect(emitted.code).not.toContain("v_uv");
  });

  it("puts a textured screen graph's block behind its textures at group 1", () => {
    const emitted = emitShaderGraphWgsl(screenGradedGraph());
    expect(emitted.blockGroup).toBe(1);
    expect(emitted.textureGroup).toBe(0);
    expect(emitted.blockBytes).toBe(NODE_SCREEN_BLOCK_BASE_BYTES + 16);
    expect(emitted.code).toContain("@group(1) @binding(0) var<uniform> node");
    // Screen time reads params.x — there is no opacity lane there.
    expect(emitted.code).toContain("node.params.x");
  });

  it("puts a texture-less screen block at group 0", () => {
    const emitted = emitShaderGraphWgsl({
      domain: "screen",
      nodes: [
        { kind: "time" },
        { kind: "compose", type: "vec4", parts: [0, 0, 0, 0] },
      ],
      color: 1,
    });
    expect(emitted.blockGroup).toBe(0);
    expect(emitted.textureGroup).toBeNull();
    expect(emitted.code).toContain("@group(0) @binding(0) var<uniform> node");
  });

  it("reads every uniform type back through its vec4 lanes", () => {
    const emitted = emitShaderGraphWgsl(uniformTypesGraph());
    const code = emitted.code;
    expect(code).toContain("node.u[0].x"); // float
    expect(code).toContain("node.u[1].xy"); // vec2
    expect(code).toContain("node.u[2].xyz"); // vec3
    expect(code).toContain("node.u[3]"); // vec4
    expect(code).toContain(
      "mat3x3<f32>(node.u[4].xyz, node.u[5].xyz, node.u[6].xyz)",
    );
    expect(code).toContain(
      "mat4x4<f32>(node.u[7], node.u[8], node.u[9], node.u[10])",
    );
    expect(emitted.uniformSlots).toBe(11);
  });

  it("evaluates a vertex-stage attribute and offset-only time in the vertex stage", () => {
    const emitted = emitShaderGraphWgsl({
      domain: "surface",
      nodes: [
        { kind: "attribute", name: "normal" },
        { kind: "time" },
        { kind: "binary", op: "multiply", left: 0, right: 1 },
        { kind: "constant", type: "vec4", value: [1, 0, 0, 1] },
      ],
      color: 3,
      positionOffset: 2,
    });
    // Time is reachable only from the displacement — `usesTime` still true.
    expect(emitted.usesTime).toBe(true);
    expect(emitted.vertexStreams).toEqual(["position", "normal"]);
    // The vertex stage reads the attribute bare and time off the params lane.
    expect(emitted.code).toContain("let n0 : vec3<f32> = normal;");
    expect(emitted.code).toContain("let n1 : f32 = node.params.y;");
    expect(emitted.code).toContain("(position + n2)");
  });

  it("is a pure function of the graph — same graph, same bytes", () => {
    expect(emitShaderGraphWgsl(operatorGraph()).code).toBe(
      emitShaderGraphWgsl(operatorGraph()).code,
    );
  });

  it("throws analyzeShaderGraph's RangeError for a malformed graph", () => {
    expect(() => emitShaderGraphWgsl(malformedGraph())).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// The store.
// ---------------------------------------------------------------------------

describe("WgpuNodePipelineStore — programs and the frame buffer", () => {
  it("shares one module across graph identity and graph structure", () => {
    const { gpu, store } = createStore();
    const graph = colorGraph();
    const items = [
      nodeItem(triangle(), new TestNodeMaterial(graph)),
      nodeItem(triangle(), new TestNodeMaterial(graph)),
      nodeItem(triangle(), new TestNodeMaterial(colorGraph())),
    ];
    expect(store.beginFrame(items, 1)).toBe(true);
    expect(store.programCount).toBe(1);
    expect(gpu.countOf("device.createShaderModule")).toBe(1);
    // A second frame compiles nothing further and reuses the buffer.
    gpu.reset();
    expect(store.beginFrame(items, 1)).toBe(true);
    expect(gpu.countOf("device.createShaderModule")).toBe(0);
    expect(gpu.countOf("device.createBuffer")).toBe(0);
  });

  it("latches a malformed graph null with one §85 warning", () => {
    const { store } = createStore();
    const material = new TestNodeMaterial(malformedGraph());
    const items = [nodeItem(triangle(), material)];
    expect(store.beginFrame(items, 1)).toBe(false);
    expect(store.beginFrame(items, 1)).toBe(false);
    expect(store.programCount).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    // The latched graph's draw is absence, not a throw.
    const { pass } = createStore();
    expect(
      store.draw(pass, nodeItem(triangle(), material) as never, frameState()),
    ).toBe(0);
  });

  it("counts only surface programs into the frame buffer", () => {
    const { store } = createStore();
    const items = [
      nodeItem(triangle(), new TestNodeMaterial(screenConstantGraph())),
    ];
    // A screen graph on a renderable sizes nothing and draws nothing.
    expect(store.beginFrame(items, 1)).toBe(false);
  });

  it("records one draw: pipeline, dynamic offset, streams, packed block", () => {
    const { gpu, store, pass } = createStore();
    const material = new TestNodeMaterial(displacedGraph());
    material.opacity = 0.5;
    material.uniforms.set("tint", new Float32Array([1, 2, 3, 4]));
    const item = nodeItem(triangle(), material);
    expect(store.beginFrame([item], 1)).toBe(true);
    gpu.reset();
    const state = frameState({ renderTime: 2.5 });
    const statistics = createRenderStatistics();
    state.statistics = statistics;
    store.draw(pass, item as never, state);
    // A second draw of the same frame lands at the next 256-byte stride.
    store.draw(pass, item as never, state);
    store.endFrame();
    expect(gpu.countOf("device.createRenderPipeline")).toBe(1);
    expect(gpu.countOf("pass.draw")).toBe(2);
    // Group 0 at dynamic offsets 0 and 256.
    const binds = gpu.callsOf("pass.setBindGroup");
    expect(binds[0].args[0]).toBe(0);
    expect(binds[0].args[2]).toEqual([0]);
    expect(binds[1].args[2]).toEqual([256]);
    // One vertex stream per draw: position (the graph reads no attribute).
    expect(gpu.countOf("pass.setVertexBuffer")).toBe(2);
    // The packed block: identity matrices, then params, then the tint lanes
    // (the geometry stream uploads share the entry point; the block is the
    // last write, enqueued by `endFrame` with the frame's exact float count).
    const uploads = gpu.callsOf("queue.writeBuffer");
    const upload = uploads[uploads.length - 1];
    expect(upload.args[4]).toBe(128); // two 256-byte strides, in floats
    const floats = upload.args[2] as number[];
    expect(floats[0]).toBe(1); // viewProjection[0][0]
    expect(floats[32]).toBe(0.5); // opacity
    expect(floats[33]).toBe(2.5); // render time
    expect(floats.slice(36, 40)).toEqual([1, 2, 3, 4]); // tint
    expect(floats[64]).toBe(1); // the second block's viewProjection[0][0]
    expect(statistics.drawCalls).toBe(2);
    expect(statistics.triangles).toBe(2);
  });

  it("defaults opacity to 1 and packs zero pad lanes deterministically", () => {
    const { gpu, store, pass } = createStore();
    const material = new TestNodeMaterial(colorGraph());
    const item = nodeItem(triangle(), material);
    store.beginFrame([item], 1);
    gpu.reset();
    store.draw(pass, item as never, frameState());
    store.endFrame();
    const uploads = gpu.callsOf("queue.writeBuffer");
    const upload = uploads[uploads.length - 1];
    const floats = upload.args[2] as number[];
    expect(floats[32]).toBe(1);
    expect(floats[34]).toBe(0);
    expect(floats[35]).toBe(0);
    // One stride's worth of floats is uploaded — the pad lanes included, all
    // written this frame (§33).
    expect(upload.args[4]).toBe(64);
    expect(floats.slice(36, 64)).toEqual(new Array<number>(28).fill(0));
  });

  it("packs matrix and narrow uniforms into padded vec4 lanes (§33)", () => {
    const { gpu, store, pass } = createStore();
    const material = new TestNodeMaterial(uniformTypesGraph());
    material.uniforms.set("gain", new Float32Array([5]));
    material.uniforms.set("offset", new Float32Array([1, 2]));
    material.uniforms.set("axis", new Float32Array([3, 4, 5]));
    material.uniforms.set("tint", new Float32Array([6, 7, 8, 9]));
    material.uniforms.set(
      "spin",
      new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    );
    material.uniforms.set(
      "warp",
      new Float32Array(Array.from({ length: 16 }, (_, i) => i + 1)),
    );
    const item = nodeItem(triangle(), material);
    store.beginFrame([item], 1);
    gpu.reset();
    store.draw(pass, item as never, frameState());
    store.endFrame();
    const floats = lastUpload(gpu);
    const lanes = floats.slice(36);
    expect(lanes.slice(0, 4)).toEqual([5, 0, 0, 0]); // float, zero-padded
    expect(lanes.slice(4, 8)).toEqual([1, 2, 0, 0]); // vec2
    expect(lanes.slice(8, 12)).toEqual([3, 4, 5, 0]); // vec3
    expect(lanes.slice(12, 16)).toEqual([6, 7, 8, 9]); // vec4
    // mat3: three columns, each padded with a written-zero w lane.
    expect(lanes.slice(16, 28)).toEqual([1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0]);
    // mat4: copied whole.
    expect(lanes.slice(28, 44)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 1),
    );
  });

  it("binds the normal and colour streams a graph demands, in slot order", () => {
    const { gpu, store, pass } = createStore();
    const graph: ShaderGraph = {
      domain: "surface",
      nodes: [
        { kind: "attribute", name: "normal" },
        { kind: "attribute", name: "color" },
        { kind: "swizzle", source: 0, pattern: "x" },
        { kind: "binary", op: "multiply", left: 1, right: 2 },
      ],
      color: 3,
    };
    const geometry = triangle();
    geometry.normals = new Float32Array(9);
    geometry.colors = new Float32Array(12);
    const item = nodeItem(geometry, new TestNodeMaterial(graph));
    store.beginFrame([item], 1);
    gpu.reset();
    store.draw(pass, item as never, frameState());
    // position, normal, colour — three slots, fixed order.
    expect(gpu.countOf("pass.setVertexBuffer")).toBe(3);
    expect(gpu.countOf("pass.draw")).toBe(1);
    // The same graph on a geometry without normals skips with the warning.
    const bare = nodeItem(triangle(), new TestNodeMaterial(graph));
    store.beginFrame([bare], 1);
    gpu.reset();
    store.draw(pass, bare as never, frameState());
    expect(gpu.countOf("pass.draw")).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("skips a draw with nothing to draw — the empty geometry (§61)", () => {
    const { gpu, store, pass } = createStore();
    const item = nodeItem(
      new TestGeometry(new Float32Array(0)),
      new TestNodeMaterial(colorGraph()),
    );
    store.beginFrame([item], 1);
    gpu.reset();
    expect(store.draw(pass, item as never, frameState())).toBe(0);
    expect(gpu.countOf("pass.draw")).toBe(0);
  });

  it("defaults a transparent draw's blend mode to normal (§57)", () => {
    const { gpu, store, pass } = createStore();
    const material = new TestNodeMaterial(colorGraph());
    material.transparent = true;
    const item = nodeItem(triangle(), material);
    store.beginFrame([item], 1);
    gpu.reset();
    store.draw(pass, item as never, frameState());
    const descriptor = gpu.callsOf("device.createRenderPipeline")[0]
      .args[0] as {
      fragment: {
        targets: readonly { blend?: { color: { srcFactor: string } } }[];
      };
    };
    expect(descriptor.fragment.targets[0].blend?.color.srcFactor).toBe(
      "src-alpha",
    );
  });

  it("rebuilds a material's texture group when its graph changes count", () => {
    const { gpu, store, pass } = createStore();
    const material = new TestNodeMaterial(texturedGraph());
    material.textures.set("map", new TestTexture());
    material.textures.set("detail", new TestTexture());
    const first = nodeItem(texturedTriangle(), material);
    store.beginFrame([first], 1);
    store.draw(pass, first as never, frameState());
    expect(nodeTextureGroups(gpu)).toBe(1);
    // The same material moves to a two-sampler graph: the cached group's
    // pair count no longer matches and the group re-composes.
    material.graph = {
      domain: "surface",
      nodes: [
        { kind: "attribute", name: "uv" },
        { kind: "texture", name: "map", uv: 0 },
        { kind: "texture", name: "detail", uv: 0 },
        { kind: "binary", op: "add", left: 1, right: 2 },
      ],
      color: 3,
    };
    const second = nodeItem(texturedTriangle(), material);
    store.beginFrame([second], 1);
    store.draw(pass, second as never, frameState());
    expect(nodeTextureGroups(gpu)).toBe(2);
  });

  it("draws indexed geometry through the index buffer", () => {
    const { gpu, store, pass } = createStore();
    const geometry = triangle();
    geometry.indices = new Uint16Array([0, 1, 2]);
    const item = nodeItem(geometry, new TestNodeMaterial(colorGraph()));
    store.beginFrame([item], 1);
    gpu.reset();
    store.draw(pass, item as never, frameState());
    expect(gpu.countOf("pass.setIndexBuffer")).toBe(1);
    expect(gpu.countOf("pass.drawIndexed")).toBe(1);
  });

  it("skips a draw whose graph reads a stream the geometry lacks", () => {
    const { gpu, store, pass } = createStore();
    const material = new TestNodeMaterial(texturedGraph());
    material.textures.set("map", new TestTexture());
    const item = nodeItem(triangle(), material); // no uv stream
    store.beginFrame([item], 1);
    gpu.reset();
    store.draw(pass, item as never, frameState());
    expect(gpu.countOf("pass.draw")).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("vertex stream");
  });

  it("skips a draw whose sampler is unbound, warned once (§83)", () => {
    const { gpu, store, pass } = createStore();
    const material = new TestNodeMaterial(texturedGraph());
    const item = nodeItem(texturedTriangle(), material);
    store.beginFrame([item], 1);
    gpu.reset();
    store.draw(pass, item as never, frameState());
    store.draw(pass, item as never, frameState());
    expect(gpu.countOf("pass.draw")).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("skips a disposed texture and R-4's feedback loop", () => {
    const { gpu, store, pass } = createStore();
    const material = new TestNodeMaterial(texturedGraph());
    const texture = new TestTexture();
    texture.dispose();
    material.textures.set("map", texture);
    const item = nodeItem(texturedTriangle(), material);
    store.beginFrame([item], 1);
    store.draw(pass, item as never, frameState());
    expect(gpu.countOf("pass.draw")).toBe(0);

    // The feedback half: the material samples the very target being drawn.
    const target = new RenderTarget({ width: 4, height: 4 });
    material.textures.set("map", target.colorTexture);
    store.draw(pass, item as never, frameState({ activeTarget: target }));
    expect(gpu.countOf("pass.draw")).toBe(0);
    // Off the active target the same binding resolves and draws.
    store.draw(pass, item as never, frameState());
    expect(gpu.countOf("pass.draw")).toBe(1);
    // A disposed target's view refuses — absence again.
    target.dispose();
    store.draw(pass, item as never, frameState());
    expect(gpu.countOf("pass.draw")).toBe(1);
  });

  it("caches the texture bind group per material and rebuilds on change", () => {
    const { gpu, store, pass } = createStore();
    const material = new TestNodeMaterial(texturedGraph());
    const texture = new TestTexture();
    material.textures.set("map", texture);
    const item = nodeItem(texturedTriangle(), material);
    store.beginFrame([item], 1);
    store.draw(pass, item as never, frameState());
    expect(nodeTextureGroups(gpu)).toBe(1);
    store.draw(pass, item as never, frameState());
    // Steady state: no new group.
    expect(nodeTextureGroups(gpu)).toBe(1);
    // A version bump re-uploads the texture and re-composes the group.
    texture.version += 1;
    store.draw(pass, item as never, frameState());
    expect(nodeTextureGroups(gpu)).toBe(2);
  });

  it("resolves §67's clip over the material stencil, and mirrors the ref", () => {
    const { gpu, store, pass } = createStore();
    const material = new TestNodeMaterial(colorGraph());
    material.stencil = { func: "equal", ref: 3 };
    const clipped = nodeItem(triangle(), material, {
      clip: {
        maskPass: false,
        stencil: { func: "equal", ref: 2, writeMask: 0 },
      },
    });
    store.beginFrame([clipped], 2);
    gpu.reset();
    const reference = store.draw(
      pass,
      clipped as never,
      frameState({ frameStencil: true, depthFormat: "depth24plus-stencil8" }),
    );
    expect(reference).toBe(2);
    expect(gpu.callsOf("pass.setStencilReference")[0].args[0]).toBe(2);
    // Without a clip the material's own §57 stencil resolves.
    const plain = nodeItem(triangle(), material);
    const next = store.draw(
      pass,
      plain as never,
      frameState({
        frameStencil: true,
        depthFormat: "depth24plus-stencil8",
        stencilReference: 2,
      }),
    );
    expect(next).toBe(3);
    // With the frame's stencil off, neither reaches the pipeline.
    const off = store.draw(pass, plain as never, frameState());
    expect(off).toBe(0);
  });

  it("bakes §57 blend and depth state as pipeline identity, per state", () => {
    const { gpu, store, pass } = createStore();
    const material = new TestNodeMaterial(colorGraph());
    const item = nodeItem(triangle(), material);
    store.beginFrame([item], 1);
    gpu.reset();
    store.draw(pass, item as never, frameState());
    expect(gpu.countOf("device.createRenderPipeline")).toBe(1);
    // Same state: cache hit.
    store.draw(pass, item as never, frameState());
    expect(gpu.countOf("device.createRenderPipeline")).toBe(1);
    // A transparent draw is a second pipeline; a depthless pass a third.
    material.transparent = true;
    material.blendMode = "additive";
    material.depthTest = false;
    material.colorWrite = false;
    store.draw(pass, item as never, frameState());
    expect(gpu.countOf("device.createRenderPipeline")).toBe(2);
    store.draw(pass, item as never, frameState({ depthFormat: null }));
    expect(gpu.countOf("device.createRenderPipeline")).toBe(3);
    const descriptors = gpu.callsOf("device.createRenderPipeline");
    const second = descriptors[1].args[0] as {
      fragment: { targets: readonly { writeMask: number }[] };
      depthStencil?: { depthCompare: string };
    };
    expect(second.fragment.targets[0].writeMask).toBe(0);
    expect(second.depthStencil?.depthCompare).toBe("always");
    const third = descriptors[2].args[0] as { depthStencil?: object };
    expect(third.depthStencil).toBeUndefined();
  });

  it("regrows the shared buffer and rebuilds the dropped draw groups", () => {
    const { gpu, store, pass } = createStore();
    const material = new TestNodeMaterial(colorGraph());
    const one = [nodeItem(triangle(), material)];
    store.beginFrame(one, 1);
    store.draw(pass, one[0] as never, frameState());
    const groupsBefore = gpu.countOf("device.createBindGroup");
    // Ten items across two views outgrow the four-block floor.
    const many = Array.from({ length: 10 }, () =>
      nodeItem(triangle(), material),
    );
    store.beginFrame(many, 2);
    expect(gpu.countOf("buffer.destroy")).toBe(1);
    store.draw(pass, many[0] as never, frameState());
    // The group over the destroyed buffer was dropped and rebuilt.
    expect(gpu.countOf("device.createBindGroup")).toBe(groupsBefore + 1);
  });

  it("skips draw and endFrame without a beginFrame-sized buffer", () => {
    const { gpu, store, pass } = createStore();
    const item = nodeItem(triangle(), new TestNodeMaterial(colorGraph()));
    expect(store.draw(pass, item as never, frameState())).toBe(0);
    store.endFrame();
    expect(gpu.countOf("pass.draw")).toBe(0);
    expect(gpu.countOf("queue.writeBuffer")).toBe(0);
  });

  it("disposes idempotently, destroying its buffers on a live device", () => {
    const { gpu, store, pass } = createStore();
    const item = nodeItem(triangle(), new TestNodeMaterial(colorGraph()));
    store.beginFrame([item], 1);
    store.draw(pass, item as never, frameState());
    store.dispose();
    expect(store.disposed).toBe(true);
    expect(gpu.countOf("buffer.destroy")).toBe(1);
    store.dispose();
    expect(gpu.countOf("buffer.destroy")).toBe(1);
    // Terminal: everything answers absence.
    expect(store.beginFrame([item], 1)).toBe(false);
    expect(store.draw(pass, item as never, frameState())).toBe(0);
    store.endFrame();
  });

  it("forgets without destroying — the device-loss split", () => {
    const { gpu, store } = createStore();
    const item = nodeItem(triangle(), new TestNodeMaterial(colorGraph()));
    store.beginFrame([item], 1);
    gpu.reset();
    store.forget();
    expect(gpu.countOf("buffer.destroy")).toBe(0);
    expect(store.disposed).toBe(true);
    expect(store.programCount).toBe(0);
    // Dispose after forget destroys nothing either — the handles are gone.
    store.dispose();
    expect(gpu.countOf("buffer.destroy")).toBe(0);
  });
});

describe("WgpuNodePipelineStore — §70 graph effects", () => {
  function effectHarness(): StoreHarness & {
    readonly source: RenderTarget;
    readonly view: () => object;
  } {
    const harness = createStore();
    const source = new RenderTarget({ width: 8, height: 8 });
    return { ...harness, source, view: () => ({ swap: true }) };
  }

  it("draws a graph effect: pipeline, source group, sorted uniforms, time", () => {
    const { gpu, store, source, view } = effectHarness();
    const statistics = createRenderStatistics();
    const effect = {
      kind: "graph",
      graph: screenGradedGraph(),
      uniforms: { gain: 0.5 },
    } as const;
    store.renderGraphEffect(
      effect,
      source,
      null,
      "bgra8unorm",
      view,
      1.25,
      statistics,
    );
    expect(gpu.countOf("device.createShaderModule")).toBe(1);
    expect(gpu.countOf("pass.draw")).toBe(1);
    expect(gpu.countOf("queue.submit")).toBe(1);
    expect(statistics.drawCalls).toBe(1);
    // The block: time in params.x, the gain lane after the prefix.
    const block = lastUpload(gpu);
    expect(block[0]).toBe(1.25);
    expect(block[4]).toBe(0.5);
    // A second call over the same pass object re-uses module, pipeline,
    // buffer and both groups — steady state allocates nothing — and the
    // block re-uploads with the frame's values.
    gpu.reset();
    store.renderGraphEffect(effect, source, null, "bgra8unorm", view, 2, null);
    expect(gpu.countOf("device.createShaderModule")).toBe(0);
    expect(gpu.countOf("device.createRenderPipeline")).toBe(0);
    expect(gpu.countOf("device.createBindGroup")).toBe(0);
    expect(lastUpload(gpu)[0]).toBe(2);
  });

  it("ignores a stray uniform name and accepts vector values (§61)", () => {
    const { gpu, store, source, view } = effectHarness();
    store.renderGraphEffect(
      {
        kind: "graph",
        graph: {
          domain: "screen",
          nodes: [
            { kind: "uniform", type: "vec3", name: "tint" },
            { kind: "constant", type: "float", value: [1] },
            { kind: "compose", type: "vec4", parts: [0, 1] },
          ],
          color: 2,
        },
        uniforms: { tint: [0.1, 0.2, 0.3], stray: 9 },
      },
      source,
      null,
      "rgba8unorm",
      view,
      0,
      null,
    );
    const block = lastUpload(gpu);
    expect(block.slice(4, 7)).toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
      Math.fround(0.3),
    ]);
  });

  it("binds extra declared inputs and refuses their feedback loop", () => {
    const { gpu, store, source, view } = effectHarness();
    const extra = new RenderTarget({ width: 8, height: 8 });
    const graph: ShaderGraph = {
      domain: "screen",
      nodes: [
        { kind: "attribute", name: "uv" },
        { kind: "texture", name: "source", uv: 0 },
        { kind: "texture", name: "bloom", uv: 0 },
        { kind: "binary", op: "add", left: 1, right: 2 },
      ],
      color: 3,
    };
    store.renderGraphEffect(
      { kind: "graph", graph, textures: { bloom: extra.colorTexture } },
      source,
      null,
      "rgba8unorm",
      view,
      0,
      null,
    );
    expect(gpu.countOf("pass.draw")).toBe(1);
    gpu.reset();
    // The extra input *is* the destination: R-4's feedback, skipped whole.
    store.renderGraphEffect(
      { kind: "graph", graph, textures: { bloom: extra.colorTexture } },
      source,
      extra,
      "rgba8unorm",
      view,
      0,
      null,
    );
    expect(gpu.countOf("pass.draw")).toBe(0);
    // An undeclared input: skipped.
    store.renderGraphEffect(
      { kind: "graph", graph },
      source,
      null,
      "rgba8unorm",
      view,
      0,
      null,
    );
    expect(gpu.countOf("pass.draw")).toBe(0);
  });

  it("skips a disposed source, a surface graph, and a block-less copy binds no block", () => {
    const { gpu, store, source, view } = effectHarness();
    // A surface-domain graph handed to the effect path: absence.
    store.renderGraphEffect(
      { kind: "graph", graph: colorGraph() },
      source,
      null,
      "rgba8unorm",
      view,
      0,
      null,
    );
    expect(gpu.countOf("pass.draw")).toBe(0);
    // The block-less copy graph draws with zero uniform traffic.
    gpu.reset();
    store.renderGraphEffect(
      { kind: "graph", graph: screenCopyGraph() },
      source,
      null,
      "rgba8unorm",
      view,
      0,
      null,
    );
    expect(gpu.countOf("pass.draw")).toBe(1);
    expect(gpu.countOf("queue.writeBuffer")).toBe(0);
    // A disposed source refuses.
    gpu.reset();
    source.dispose();
    store.renderGraphEffect(
      { kind: "graph", graph: screenCopyGraph() },
      source,
      null,
      "rgba8unorm",
      view,
      0,
      null,
    );
    expect(gpu.countOf("pass.draw")).toBe(0);
    // And a disposed store draws nothing at all.
    store.dispose();
    store.renderGraphEffect(
      { kind: "graph", graph: screenConstantGraph() },
      source,
      null,
      "rgba8unorm",
      view,
      0,
      null,
    );
    expect(gpu.countOf("pass.draw")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The registration slot.
// ---------------------------------------------------------------------------

describe("registerWebgpuNodeMaterialPipeline", () => {
  it("fills the slot with a factory whose create() compiles nothing", () => {
    expect(resolveWebgpuNodeMaterialPipelineFactory()).toBeNull();
    registerWebgpuNodeMaterialPipeline();
    const factory = resolveWebgpuNodeMaterialPipelineFactory();
    expect(factory).not.toBeNull();
    const { gpu, device, geometries, textures, renderTargets } = createStore();
    gpu.reset();
    const store = factory?.create({
      device,
      geometries,
      textures,
      renderTargets,
    });
    expect(store).toBeInstanceOf(WgpuNodePipelineStore);
    expect(gpu.calls).toHaveLength(0);
    // Idempotent.
    registerWebgpuNodeMaterialPipeline();
    expect(resolveWebgpuNodeMaterialPipelineFactory()).not.toBeNull();
  });

  it("clears back to null for the unregistered-path tests", () => {
    registerWebgpuNodeMaterialPipeline();
    clearRegisteredWebgpuNodeMaterialPipeline();
    expect(resolveWebgpuNodeMaterialPipelineFactory()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The renderer's node arm.
// ---------------------------------------------------------------------------

describe("WebgpuRenderer — the §60 node arm (WP-R1.9)", () => {
  /** A plain unlit triangle whose transcript labels are rig-independent. */
  function plainScene(): Renderable {
    return new Renderable(
      new TestGeometry(
        new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
        undefined,
        "shared-plain-triangle",
      ).asGeometry,
      { color: [1, 1, 1, 1] } as unknown as ItemMaterial,
    );
  }

  it("keeps a nodeless frame byte-identical, registered or not", async () => {
    const nodeless = async (): Promise<string[]> => {
      const { gpu, renderer } = await initialized();
      renderer.render(plainScene(), [createView()]);
      const transcript = gpu.transcript();
      renderer.dispose();
      return transcript;
    };
    clearRegisteredWebgpuNodeMaterialPipeline();
    const before = await nodeless();
    registerWebgpuNodeMaterialPipeline();
    const after = await nodeless();
    expect(after).toEqual(before);
  });

  it("skips an unregistered node item — {scene} ≡ {scene + node item}", async () => {
    clearRegisteredWebgpuNodeMaterialPipeline();
    const bare = await initialized();
    bare.renderer.render(plainScene(), [createView()]);
    const withoutNode = bare.gpu.transcript();

    const rig = await initialized();
    const scene = plainScene();
    scene.add(nodeRenderable(triangle(), new TestNodeMaterial(colorGraph())));
    rig.renderer.render(scene, [createView()]);
    expect(rig.gpu.transcript()).toEqual(withoutNode);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(
      "registerWebgpuNodeMaterialPipeline",
    );
  });

  it("draws a registered node item and uploads its block once per frame", async () => {
    registerWebgpuNodeMaterialPipeline();
    const { gpu, renderer } = await initialized();
    const statistics = createRenderStatistics();
    renderer.statistics = statistics;
    renderer.renderTime = 3.5;
    const material = new TestNodeMaterial(displacedGraph());
    material.uniforms.set("tint", new Float32Array([9, 8, 7, 6]));
    const scene = nodeRenderable(triangle(), material);
    renderer.render(scene, [createView()]);
    // One node module, one node pipeline, one draw beside the clear draw.
    expect(gpu.countOf("device.createShaderModule")).toBe(2); // clear + node
    expect(gpu.countOf("pass.draw")).toBe(2);
    expect(statistics.drawCalls).toBe(1);
    // The store's upload is the last before submit and carries the block.
    const uploads = gpu.callsOf("queue.writeBuffer");
    const block = uploads[uploads.length - 1].args[2] as number[];
    expect(block[33]).toBe(3.5); // §9 render time
    expect(block.slice(36, 40)).toEqual([9, 8, 7, 6]);
    // A second frame compiles nothing and draws again.
    gpu.reset();
    renderer.render(scene, [createView()]);
    expect(gpu.countOf("device.createShaderModule")).toBe(0);
    expect(gpu.countOf("pass.draw")).toBe(2);
    renderer.dispose();
  });

  it("selects the stencil format for a node material's §57 stencil only when registered", async () => {
    const stencilScene = (): Renderable<WgpuNodeItemMaterial> => {
      const material = new TestNodeMaterial(colorGraph());
      material.stencil = { func: "always", ref: 1, writeMask: 0xff };
      return nodeRenderable(triangle(), material);
    };
    clearRegisteredWebgpuNodeMaterialPipeline();
    const unregistered = await initialized();
    unregistered.renderer.render(stencilScene(), [createView()]);
    const plainDepth = unregistered.gpu
      .callsOf("device.createTexture")
      .map((call) => (call.args[0] as { format: string }).format);
    expect(plainDepth).toContain("depth24plus");
    expect(plainDepth).not.toContain("depth24plus-stencil8");

    registerWebgpuNodeMaterialPipeline();
    const registered = await initialized();
    registered.renderer.render(stencilScene(), [createView()]);
    const stencilDepth = registered.gpu
      .callsOf("device.createTexture")
      .map((call) => (call.args[0] as { format: string }).format);
    expect(stencilDepth).toContain("depth24plus-stencil8");
  });

  it("bails the frame on a reentrant dispose inside a graph accessor", async () => {
    registerWebgpuNodeMaterialPipeline();
    const { gpu, renderer } = await initialized();
    const material = new TestNodeMaterial(colorGraph());
    Object.defineProperty(material, "graph", {
      get: () => {
        renderer.dispose();
        return colorGraph();
      },
    });
    const scene = nodeRenderable(triangle(), material);
    renderer.render(scene, [createView()]);
    expect(gpu.countOf("queue.submit")).toBe(0);
    expect(renderer.disposed).toBe(true);
  });

  it("routes a §70 graph effect through the store, and skips unregistered", async () => {
    clearRegisteredWebgpuNodeMaterialPipeline();
    const { gpu, renderer } = await initialized();
    const source = new RenderTarget({ width: 8, height: 8 });
    const pass = {
      kind: "effect",
      source: source.colorTexture,
      effect: {
        kind: "graph",
        graph: screenGradedGraph(),
        uniforms: { gain: 0.5 },
      },
    } as never;
    renderer.renderEffect(pass);
    expect(gpu.countOf("pass.draw")).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);

    registerWebgpuNodeMaterialPipeline();
    renderer.renderTime = 0.75;
    gpu.reset();
    renderer.renderEffect(pass);
    expect(gpu.countOf("pass.draw")).toBe(1);
    expect(gpu.countOf("queue.submit")).toBe(1);
    const uploads = gpu.callsOf("queue.writeBuffer");
    const block = uploads[uploads.length - 1].args[2] as number[];
    expect(block[0]).toBe(0.75);
    expect(block[4]).toBe(0.5);
    // Into a target: the destination record's view, its format, no swap-chain
    // texture acquired.
    const destination = new RenderTarget({ width: 8, height: 8 });
    gpu.reset();
    renderer.renderEffect({
      ...(pass as object),
      target: destination,
    } as never);
    expect(gpu.countOf("context.getCurrentTexture")).toBe(0);
    expect(gpu.countOf("pass.draw")).toBe(1);
    // A disposed destination skips.
    destination.dispose();
    gpu.reset();
    renderer.renderEffect({
      ...(pass as object),
      target: destination,
    } as never);
    expect(gpu.countOf("pass.draw")).toBe(0);
    renderer.dispose();
  });

  it("casts an undisplaced node item into §69's map, and not a displaced one", async () => {
    registerWebgpuNodeMaterialPipeline();
    const { gpu, renderer } = await initialized();
    const root = new Renderable(
      new TestGeometry(new Float32Array(0)).asGeometry,
      { color: [1, 1, 1, 1] } as unknown as ItemMaterial,
    );
    root.add(new CastingLightNode());
    // A lit receiver makes the frame shadowed; two node casters split on the
    // GL rule: the undisplaced one casts, the displacing one is excluded.
    root.add(
      new Renderable(
        triangle().asGeometry,
        litMaterial() as unknown as ItemMaterial,
      ),
    );
    root.add(nodeRenderable(triangle(), new TestNodeMaterial(colorGraph())));
    root.add(
      nodeRenderable(triangle(), new TestNodeMaterial(displacedGraph())),
    );
    renderer.render(root, [createView()]);
    // The shadow pass is the frame's first render pass; its draws are the
    // calls before the first `pass.end`.
    const names = gpu.calls.map((call) => call.name);
    const shadowEnd = names.indexOf("pass.end");
    const casterDraws = names
      .slice(0, shadowEnd)
      .filter((name) => name === "pass.draw" || name === "pass.drawIndexed");
    // The lit receiver plus the undisplaced node caster — not the displaced.
    expect(casterDraws).toHaveLength(2);
    renderer.dispose();
  });

  it("drops the store on device loss and disposes it with the renderer", async () => {
    registerWebgpuNodeMaterialPipeline();
    const first = await initialized();
    first.renderer.render(
      nodeRenderable(triangle(), new TestNodeMaterial(colorGraph())),
      [createView()],
    );
    first.gpu.reset();
    first.gpu.loseDevice();
    await Promise.resolve();
    await Promise.resolve();
    expect(first.renderer.deviceLost).toBe(true);
    // The node buffer was dropped, never destroyed — it died with the device.
    expect(first.gpu.countOf("buffer.destroy")).toBe(0);
    first.renderer.dispose();
    expect(first.gpu.countOf("buffer.destroy")).toBe(0);

    const second = await initialized();
    second.renderer.render(
      nodeRenderable(triangle(), new TestNodeMaterial(colorGraph())),
      [createView()],
    );
    second.gpu.reset();
    second.renderer.dispose();
    // A live-device dispose destroys the node buffer with the others.
    expect(second.gpu.countOf("buffer.destroy")).toBeGreaterThan(0);
  });
});

describe("frameWantsStencil — the node clause (WP-R1.9)", () => {
  it("scans node materials exactly when asked to", () => {
    const material = new TestNodeMaterial(colorGraph());
    material.stencil = { func: "always" };
    const items = [nodeItem(triangle(), material)];
    expect(frameWantsStencil(items)).toBe(false);
    expect(frameWantsStencil(items, true)).toBe(true);
    const plain = [nodeItem(triangle(), new TestNodeMaterial(colorGraph()))];
    expect(frameWantsStencil(plain, true)).toBe(false);
  });
});

it("maps each WGSL node statement back to its graph ID and stage", () => {
  const emitted = emitShaderGraphWgsl(displacedGraph());
  expect(
    emitted.sourceMap.some((location) => location.stage === "vertex"),
  ).toBe(true);
  expect(
    emitted.sourceMap.some((location) => location.stage === "fragment"),
  ).toBe(true);
  for (const location of emitted.sourceMap) {
    expect(emitted.code.split("\n")[location.line - 1]).toContain(
      `let n${String(location.nodeId)} :`,
    );
  }
});

it("retains asynchronous WebGPU compiler diagnostics with node provenance", async () => {
  const { device, store } = createStore();
  const graph = colorGraph();
  const emitted = emitShaderGraphWgsl(graph);
  const location = emitted.sourceMap[0];
  device.createShaderModule = () => ({
    getCompilationInfo: () =>
      Promise.resolve({
        messages: [
          { type: "warning", message: "warning", lineNum: 1, linePos: 1 },
          {
            type: "error",
            message: "bad local",
            lineNum: location.line,
            linePos: location.column,
          },
          { type: "error", message: "bad global", lineNum: 999, linePos: 1 },
        ],
      }),
  });
  store.beginFrame([nodeItem(triangle(), new TestNodeMaterial(graph))], 1);
  await vi.waitFor(() => expect(store.compilationErrors).toHaveLength(1));
  const context = store.compilationErrors[0].context;
  expect(context).toMatchObject({
    source: emitted.code,
    sourceMap: emitted.sourceMap,
    messages: [{ node: location }, { node: undefined }],
  });
  store.dispose();
});

it("ignores successful and late disposed WebGPU compilation reports", async () => {
  const { device, store } = createStore();
  const getCompilationInfo = vi.fn(() => Promise.resolve({ messages: [] }));
  device.createShaderModule = () => ({ getCompilationInfo });
  store.beginFrame(
    [nodeItem(triangle(), new TestNodeMaterial(colorGraph()))],
    1,
  );
  await vi.waitFor(() => expect(getCompilationInfo).toHaveBeenCalled());
  expect(store.compilationErrors).toEqual([]);
  const second = createStore();
  second.device.createShaderModule = () => ({
    getCompilationInfo: () =>
      Promise.resolve({
        messages: [{ type: "error", message: "late", lineNum: 1, linePos: 1 }],
      }),
  });
  second.store.beginFrame(
    [nodeItem(triangle(), new TestNodeMaterial(colorGraph()))],
    1,
  );
  second.store.dispose();
  await new Promise<void>((resolve) => {
    queueMicrotask(resolve);
  });
  expect(second.store.compilationErrors).toEqual([]);
  store.dispose();
});

it("contains rejected WebGPU diagnostic requests without an unhandled rejection", async () => {
  const { device, store } = createStore();
  device.createShaderModule = () => ({
    getCompilationInfo: () => Promise.reject(new Error("device lost")),
  });
  store.beginFrame(
    [nodeItem(triangle(), new TestNodeMaterial(colorGraph()))],
    1,
  );
  await vi.waitFor(() => expect(store.compilationErrors).toHaveLength(1));
  expect(store.compilationErrors[0].message).toContain("retrieve");
  expect(store.compilationErrors[0].cause).toHaveProperty(
    "message",
    "device lost",
  );
  store.dispose();
});

// ---------------------------------------------------------------------------
// RFC 0001 addendum (accepted 2026-11-04): storage, defines, lights.
// ---------------------------------------------------------------------------

function storageGraph(withTexture = false): ShaderGraph {
  return {
    domain: "surface",
    nodes: [
      { kind: "time" },
      { kind: "storage", name: "pal", type: "vec4", count: 8, index: 0 },
      { kind: "storage", name: "w", type: "vec2", count: 3, index: 0 },
      { kind: "storage", name: "k", type: "float", count: 1, index: 0 },
      { kind: "compose", type: "vec4", parts: [2, 3, 3] },
      { kind: "binary", op: "add", left: 1, right: 4 },
      ...(withTexture
        ? ([
            { kind: "attribute", name: "uv" },
            { kind: "texture", name: "map", uv: 6 },
            { kind: "binary", op: "add", left: 5, right: 7 },
          ] as const)
        : []),
    ],
    color: withTexture ? 8 : 5,
  };
}

function lightGraph(): ShaderGraph {
  return {
    domain: "surface",
    nodes: [
      { kind: "light", member: "ambient" },
      { kind: "light", member: "directionalDirection" },
      { kind: "light", member: "directionalColor" },
      { kind: "light", member: "cameraPosition" },
      { kind: "light", member: "punctualCount" },
      { kind: "time" },
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
}

class TestStorage {
  version = 1;

  disposed = false;

  readonly data: Float32Array;

  constructor(
    readonly type: string,
    readonly count: number,
  ) {
    this.data = new Float32Array(count * 4);
    this.data[0] = 7;
  }
}

describe("storage nodes in the WGSL store (§82)", () => {
  it("emits read-only storage declarations behind the textures", () => {
    const bare = emitShaderGraphWgsl(storageGraph());
    expect(bare.storageGroup).toBe(1);
    expect(bare.code).toContain(
      "@group(1) @binding(0) var<storage, read> st_pal : array<vec4<f32>>;",
    );
    expect(bare.code).toContain("st_w : array<vec2<f32>>;");
    expect(bare.code).toContain("st_k : array<f32>;");
    expect(bare.code).toContain("st_pal[min(u32(max(n0, 0.0)), 7u)]");
    expect(bare.storage.map((b) => b.name)).toEqual(["pal", "w", "k"]);
    const textured = emitShaderGraphWgsl(storageGraph(true));
    expect(textured.storageGroup).toBe(2);
    expect(textured.code).toContain("@group(2) @binding(0) var<storage, read>");
    expect(emitShaderGraphWgsl(colorGraph()).storageGroup).toBeNull();
  });

  it("allocates, uploads on version change, caches the group and releases", () => {
    const { gpu, store, pass } = createStore();
    const material = new TestNodeMaterial(storageGraph());
    const buffers = {
      pal: new TestStorage("vec4", 8),
      w: new TestStorage("vec2", 3),
      k: new TestStorage("float", 1),
    };
    for (const [name, buffer] of Object.entries(buffers)) {
      material.storage.set(name, buffer);
    }
    const item = nodeItem(triangle(), material);
    expect(store.beginFrame([item], 1)).toBe(true);
    gpu.reset();
    store.draw(pass, item as never, frameState());
    const created = gpu
      .callsOf("device.createBuffer")
      .filter((call) =>
        String((call.args[0] as { label?: string }).label).startsWith(
          "fourJS:node-storage",
        ),
      );
    expect(created).toHaveLength(3);
    expect(gpu.countOf("device.createBindGroup")).toBe(2);
    const binds = gpu.callsOf("pass.setBindGroup").map((c) => c.args[0]);
    expect(binds).toEqual([0, 1]);
    // Same versions: no re-upload, no new group.
    gpu.reset();
    store.draw(pass, item as never, frameState());
    expect(gpu.countOf("device.createBindGroup")).toBe(0);
    const uploadsBefore = gpu.countOf("queue.writeBuffer");
    buffers.pal.version += 1;
    store.draw(pass, item as never, frameState());
    expect(gpu.countOf("queue.writeBuffer")).toBe(uploadsBefore + 1);
    // Disposed: the draw is skipped and the GPU copy released.
    buffers.k.disposed = true;
    gpu.reset();
    store.draw(pass, item as never, frameState());
    expect(gpu.countOf("pass.draw")).toBe(0);
    expect(gpu.countOf("buffer.destroy")).toBe(1);
    store.dispose();
    expect(gpu.countOf("buffer.destroy")).toBeGreaterThan(1);
  });

  it("skips an unbound buffer with one warning", () => {
    const { gpu, store, pass } = createStore();
    const material = new TestNodeMaterial(storageGraph());
    const item = nodeItem(triangle(), material);
    store.beginFrame([item], 1);
    gpu.reset();
    store.draw(pass, item as never, frameState());
    store.draw(pass, item as never, frameState());
    expect(gpu.countOf("pass.draw")).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the group when a buffer is rebound, and survives device loss", () => {
    const { gpu, store, pass } = createStore();
    const graph = storageGraph();
    const material = new TestNodeMaterial(graph);
    const set = (a: TestStorage) => {
      material.storage.set("pal", a);
      material.storage.set("w", new TestStorage("vec2", 3));
      material.storage.set("k", new TestStorage("float", 1));
    };
    const first = new TestStorage("vec4", 8);
    set(first);
    const item = nodeItem(triangle(), material);
    store.beginFrame([item], 1);
    store.draw(pass, item as never, frameState());
    gpu.reset();
    material.storage.set("pal", new TestStorage("vec4", 8));
    store.draw(pass, item as never, frameState());
    expect(gpu.countOf("device.createBindGroup")).toBe(1);
    store.forget();
  });
});

describe("defines in the WGSL store", () => {
  it("omits the dead branch and shares a program across equal source", () => {
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
    const on = { ...base, defines: { A: true, B: true } };
    const onToo = { ...base, defines: { A: true, B: false } };
    const off = { ...base, defines: { A: false } };
    const emittedOn = emitShaderGraphWgsl(on);
    expect(emittedOn.code).toContain(
      "let n0 : vec4<f32> = vec4<f32>(1.0, 0.0, 0.0, 1.0)",
    );
    expect(emittedOn.code).not.toContain("vec4<f32>(0.0, 0.0, 1.0, 1.0)");
    expect(emittedOn.code).toContain("let n2 : vec4<f32> = n0;");
    expect(emitShaderGraphWgsl(off).code).not.toContain(
      "vec4<f32>(1.0, 0.0, 0.0, 1.0)",
    );
    const { gpu, store } = createStore();
    const items = [on, onToo, off].map((g) =>
      nodeItem(triangle(), new TestNodeMaterial(g)),
    );
    store.beginFrame(items, 1);
    expect(store.programCount).toBe(2);
    expect(gpu.countOf("device.createShaderModule")).toBe(2);
  });
});

describe("lights in the WGSL store (§68)", () => {
  it("pins the slot count to the renderer's block", () => {
    expect(SHADER_LIGHT_SLOTS).toBe(MAX_LIGHT_SLOTS);
  });

  it("emits the nested light block and clamped array reads", () => {
    const emitted = emitShaderGraphWgsl(lightGraph());
    expect(emitted.usesLights).toBe(true);
    expect(emitted.lightsByteOffset).toBe(NODE_SURFACE_BLOCK_BASE_BYTES);
    expect(emitted.blockBytes).toBe(
      NODE_SURFACE_BLOCK_BASE_BYTES + LIGHT_UNIFORM_BYTES,
    );
    expect(emitted.code).toContain("struct NodeLights {");
    expect(emitted.code).toContain("  lights : NodeLights,");
    expect(emitted.code).toContain("node.lights.ambientColor.xyz");
    expect(emitted.code).toContain("node.lights.counts.x");
    expect(emitted.code).toContain(
      `node.lights.punctualPosition[clamp(i32(n5), 0, ${String(MAX_LIGHT_SLOTS - 1)})].xyz`,
    );
    expect(emitted.code).toContain(
      `node.lights.punctualParams[clamp(i32(n5), 0, ${String(MAX_LIGHT_SLOTS - 1)})];`,
    );
    const plain = emitShaderGraphWgsl(colorGraph());
    expect(plain.usesLights).toBe(false);
    expect(plain.lightsByteOffset).toBe(-1);
    expect(plain.code).not.toContain("NodeLights");
  });

  it("packs the frame's lights into the block tail, zeros without", () => {
    const { gpu, store, pass } = createStore();
    const item = nodeItem(triangle(), new TestNodeMaterial(lightGraph()));
    store.beginFrame([item], 1);
    const lights = createSceneLights();
    lights.ambientColor[0] = 0.25;
    lights.ambientColor[1] = 0.5;
    lights.ambientColor[2] = 0.75;
    lights.punctualCount = 2;
    lights.punctualPositions[3] = 4;
    store.draw(
      pass,
      item as never,
      frameState({ lights, eyeX: 1, eyeY: 2, eyeZ: 3 }),
    );
    store.endFrame();
    const tail = lastUpload(gpu).slice(36);
    expect(tail.slice(0, 3)).toEqual([0.25, 0.5, 0.75]);
    expect(tail.slice(12, 15)).toEqual([1, 2, 3]); // cameraPosition
    expect(tail[16]).toBe(2); // counts.x
    expect(tail[20 + 4]).toBe(4); // punctualPosition[1].x
    // No lights collected: the tail is zero, not stale.
    store.beginFrame([item], 1);
    store.draw(pass, item as never, frameState({ lights: null }));
    store.endFrame();
    expect(
      lastUpload(gpu)
        .slice(36, 36 + LIGHT_UNIFORM_FLOATS)
        .every((v) => v === 0),
    ).toBe(true);
  });

  it("collects the frame's lights when a node material reads them", async () => {
    registerWebgpuNodeMaterialPipeline();
    const { gpu, renderer } = await initialized();
    const material = new TestNodeMaterial(lightGraph());
    const scene = nodeRenderable(triangle(), material);
    (scene as unknown as { ambientLight: number[] }).ambientLight = [
      0.25, 0.5, 0.75,
    ];
    const camera = new TestCamera();
    camera.transform.worldMatrix.elements[12] = 5;
    camera.transform.worldMatrix.elements[13] = 6;
    camera.transform.worldMatrix.elements[14] = 7;
    renderer.render(scene, [createView({ camera: camera.asCamera })]);
    const uploads = gpu.callsOf("queue.writeBuffer");
    const block = uploads[uploads.length - 1].args[2] as number[];
    expect(block.slice(36, 39)).toEqual([0.25, 0.5, 0.75]);
    expect(block.slice(48, 51)).toEqual([5, 6, 7]);
    renderer.dispose();
  });
});
