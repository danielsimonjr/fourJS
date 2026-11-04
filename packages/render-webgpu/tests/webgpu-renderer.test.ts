/**
 * Unit tests for the WebGPU backend, driven by the recording device double.
 *
 * ## Why a double, and why *this* double
 *
 * Node has no WebGPU at all — `globalThis.navigator.gpu` is `undefined` under
 * Node 22 — so unlike the WebGL backend there is not even a headless-gl to
 * reach for. The backend talks to WebGPU through exactly one set of structural
 * interfaces (`src/webgpu-device.ts`), so an object implementing them is a
 * *complete* double, and the double is shared with the cross-package suites
 * (`tests/integration/helpers/recording-gpu.ts`, the twin of `recording-gl.ts`)
 * rather than copied here: one tape, one set of gotchas, two consumers.
 *
 * What the double cannot check is whether the commands *mean* what we think —
 * that the WGSL compiles, that the winding is right, that a triangle appears.
 * That is `tests/browser/webgpu/`'s job against a real SwiftShader adapter, and
 * it is the reason this file asserts sequences rather than pixels.
 *
 * ## Why the scene objects are doubles too
 *
 * `@fourjs/render-webgpu`'s dependencies are `core`, `math`, and `render` (plan
 * §3.1, frozen). Cameras, `BufferGeometry` and `UnlitMaterial` live in
 * `@fourjs/scene`, `@fourjs/geometry` and `@fourjs/materials`, so importing them here
 * — even in a test — would be a phantom dependency outside the matrix. They are
 * therefore typed doubles derived from the very types the renderer consumes,
 * exactly as `packages/render-webgl/tests/webgl-renderer.test.ts` does.
 */

import { isFourError, resetDevWarnings, type FourError } from "@fourjs/core";
import { Matrix4, type Vector3 } from "@fourjs/math";
import {
  PARTICLE_INSTANCE_FLOATS,
  Renderable,
  RenderTarget,
  createRenderStatistics,
  type RenderItem,
  type Renderer,
  type UnlitRenderItem,
} from "@fourjs/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRecordingGpu,
  withHostGpu,
  type RecordingGpu,
} from "../../../tests/integration/helpers/recording-gpu.js";
import {
  DRAW_COLOR_OFFSET,
  DRAW_MODEL_OFFSET,
  DRAW_NORMAL_OFFSET,
  LIGHT_AMBIENT_OFFSET,
  LIGHT_CAMERA_OFFSET,
  LIGHT_COLOR_OFFSET,
  LIGHT_COUNTS_OFFSET,
  LIGHT_DIRECTION_OFFSET,
  LIGHT_PUNCTUAL_COLOR_OFFSET,
  LIGHT_PUNCTUAL_DIRECTION_OFFSET,
  LIGHT_PUNCTUAL_PARAMS_OFFSET,
  LIGHT_PUNCTUAL_POSITION_OFFSET,
  LIGHT_UNIFORM_STRIDE_BYTES,
  LIGHT_UNIFORM_STRIDE_FLOATS,
  PARTICLE_INSTANCE_BUFFER_LAYOUT,
  PARTICLE_MODEL_OFFSET,
  PARTICLE_PROJECTION_OFFSET,
  PARTICLE_UNIFORM_BYTES,
  PARTICLE_VIEW_OFFSET,
  POSITION_BUFFER_LAYOUT,
  SHADOW_LIGHT_UNIFORM_BYTES,
  SHADOW_MATRIX_OFFSET,
  SHADOW_PARAMS_OFFSET,
  SPRITE_TINT_OFFSET,
  STANDARD_EMISSIVE_OFFSET,
  STANDARD_SURFACE_OFFSET,
  UNIFORM_STRIDE_BYTES,
  DRAW_MORPH_WEIGHT_OFFSET,
  WebgpuRenderer,
  JOINT_PALETTE_FLOATS,
  clearRegisteredSkinningPipeline,
  createWgpuBatching,
  hostGpu,
  registerSkinningPipeline,
  type GpuDevice,
} from "../src/index.js";
import { setSkinningPipelineFactory } from "../src/wgpu-skinning-registry.js";

type RenderView = Parameters<Renderer["render"]>[1][number];
type RenderCamera = RenderView["camera"];
type ItemGeometry = RenderItem["geometry"];
type ItemMaterial = UnlitRenderItem["material"];

let nextGeometryId = 0;

/** §53's `BufferGeometry`, reduced to what a render item carries. */
class TestGeometry {
  readonly id: string;

  version = 0;

  positions: Float32Array;

  normals: Float32Array | undefined;

  joints: Uint16Array | undefined;

  weights: Float32Array | undefined;

  uvs: Float32Array | undefined;

  colors: Float32Array | undefined;

  indices: Uint16Array | Uint32Array | undefined;

  mode: "triangles" | "lines" = "triangles";

  constructor(
    positions: Float32Array,
    indices?: Uint16Array | Uint32Array,
    mode: "triangles" | "lines" = "triangles",
    colors?: Float32Array,
  ) {
    nextGeometryId += 1;
    this.id = `test-geometry-${String(nextGeometryId)}`;
    this.positions = positions;
    this.indices = indices;
    this.mode = mode;
    this.colors = colors;
  }

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get drawCount(): number {
    return this.indices === undefined
      ? this.positions.length / 3
      : this.indices.length;
  }

  markDirty(): void {
    this.version += 1;
  }

  /** §53's cached local bounds, reduced to what the sprite path reads. */
  computeBounds(): {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  } {
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (let i = 0; i < this.positions.length; i += 3) {
      min.x = Math.min(min.x, this.positions[i]);
      min.y = Math.min(min.y, this.positions[i + 1]);
      min.z = Math.min(min.z, this.positions[i + 2]);
      max.x = Math.max(max.x, this.positions[i]);
      max.y = Math.max(max.y, this.positions[i + 1]);
      max.z = Math.max(max.z, this.positions[i + 2]);
    }
    return { min, max };
  }

  get asGeometry(): ItemGeometry {
    return this as unknown as ItemGeometry;
  }
}

let nextTextureId = 0;

/** §77's `MaterialTexture` read contract, reduced to what the cache reads. */
class TestTexture {
  readonly id: string;

  version = 0;

  readonly width: number;

  readonly height: number;

  data: Uint8Array | null;

  disposed = false;

  mipmaps?: boolean;

  constructor(width = 2, height = 2) {
    nextTextureId += 1;
    this.id = `test-texture-${String(nextTextureId)}`;
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  markDirty(): void {
    this.version += 1;
  }

  dispose(): void {
    this.disposed = true;
    this.version += 1;
  }
}

/** A partial §57 stencil record, as a structurally-typed double carries one. */
interface TestStencil {
  func?: string;
  ref?: number;
  readMask?: number;
  writeMask?: number;
  failOp?: string;
  depthFailOp?: string;
  passOp?: string;
}

/** §57's `UnlitMaterial`, reduced to the state the pipeline descriptor reads. */
class TestMaterial {
  readonly color: [number, number, number, number];

  transparent?: boolean;

  blendMode?: "normal" | "additive" | "multiply" | "screen";

  depthTest?: boolean;

  depthWrite?: boolean;

  colorWrite?: boolean;

  opacity?: number;

  vertexColors?: boolean;

  map?: TestTexture | null;

  stencil?: TestStencil;

  constructor(color: [number, number, number, number] = [1, 1, 1, 1]) {
    this.color = color;
  }

  get asMaterial(): ItemMaterial {
    return this as unknown as ItemMaterial;
  }
}

/** §55's `SpriteMaterial`, reduced to what the sprite path reads (WP-R1.3). */
class TestSpriteMaterial {
  /** The discriminant `pipelineOf` routes on. */
  readonly kind = "sprite";

  readonly tint: [number, number, number, number];

  texture: TestTexture | null;

  blendMode?: "normal" | "additive" | "multiply" | "screen";

  depthTest?: boolean;

  depthWrite?: boolean;

  colorWrite?: boolean;

  opacity?: number;

  stencil?: TestStencil;

  constructor(
    texture: TestTexture | null = new TestTexture(),
    tint: [number, number, number, number] = [1, 1, 1, 1],
  ) {
    this.texture = texture;
    this.tint = tint;
  }

  get asMaterial(): ItemMaterial {
    return this as unknown as ItemMaterial;
  }
}

/** A §55 sprite node: a renderable that may carry the frame sub-rectangle. */
class SpriteNode extends Renderable {
  frame: { x: number; y: number; width: number; height: number } | null = null;

  constructor(geometry: TestGeometry, material: TestSpriteMaterial) {
    super(geometry.asGeometry, material.asMaterial);
  }
}

/** §47's camera, reduced to the two matrices and the one method a frame calls. */
class TestCamera {
  readonly projectionMatrix = new Matrix4();

  readonly viewMatrix = new Matrix4();

  readonly transform = { worldMatrix: new Matrix4() };

  layers: number | undefined = undefined;

  updateViewMatrixCalls = 0;

  updateViewMatrix(): void {
    this.updateViewMatrixCalls += 1;
  }

  get asCamera(): RenderCamera {
    return this as unknown as RenderCamera;
  }
}

/** A unit triangle at the origin, inside every default frustum. */
function triangle(colors?: Float32Array): TestGeometry {
  return new TestGeometry(
    new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
    undefined,
    "triangles",
    colors,
  );
}

/** A triangle carrying the uv stream §77's textured variant samples with. */
function texturedTriangle(colors?: Float32Array): TestGeometry {
  const geometry = triangle(colors);
  geometry.uvs = new Float32Array([0, 0, 1, 0, 0.5, 1]);
  return geometry;
}

function renderable(
  geometry: TestGeometry,
  material: TestMaterial = new TestMaterial(),
): Renderable {
  return new Renderable(geometry.asGeometry, material.asMaterial);
}

/** A root that draws nothing itself — an empty geometry, as the GL suite uses. */
function createRoot(): Renderable {
  return renderable(new TestGeometry(new Float32Array(0)));
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

/** Builds an initialized renderer over a fresh recording device. */
async function initialized(
  options: Parameters<typeof createRecordingGpu>[0] = {},
): Promise<Harness> {
  const gpu = createRecordingGpu(options);
  const renderer = new WebgpuRenderer();
  await withHostGpu(gpu.gpu, async () => {
    await renderer.initialize({ canvas: gpu.canvas });
  });
  renderer.resize(256, 256, 1);
  gpu.reset();
  return { gpu, renderer };
}

/**
 * The frame's **uniform** upload — the last `queue.writeBuffer` of the call.
 *
 * Geometry uploads use the same entry point, so "the frame's uniforms" is the
 * one issued after the passes are recorded (`webgpu-renderer.ts`: one upload
 * for the whole frame, enqueued before the submit that reads it).
 */
function uniformUpload(gpu: RecordingGpu): number[] {
  const uploads = gpu.callsOf("queue.writeBuffer");
  const last = uploads[uploads.length - 1];
  if (last === undefined) {
    throw new Error("the frame uploaded no uniforms");
  }
  return last.args[2] as number[];
}

/**
 * How many §77 map textures the tape allocates — `createTexture` calls minus
 * the frame's own depth attachment, told apart by the cache's label.
 */
function mapAllocations(gpu: RecordingGpu): number {
  return gpu
    .callsOf("device.createTexture")
    .filter((call) =>
      String((call.args[0] as { label?: string }).label).startsWith(
        "fourJS:texture:",
      ),
    ).length;
}

/** Awaits a rejection and returns the `FourError` it carried. */
async function rejection(promise: Promise<unknown>): Promise<FourError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (isFourError(error)) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the promise to reject");
}

describe("hostGpu", () => {
  it("is undefined in Node, whose navigator carries no gpu", () => {
    expect(hostGpu()).toBeUndefined();
  });

  it("is undefined in a host with no navigator at all (a worker, old Node)", () => {
    const host = globalThis as object;
    const previous = Object.getOwnPropertyDescriptor(host, "navigator");
    Object.defineProperty(host, "navigator", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      expect(hostGpu()).toBeUndefined();
    } finally {
      if (previous === undefined) {
        delete (host as Record<string, unknown>)["navigator"];
      } else {
        Object.defineProperty(host, "navigator", previous);
      }
    }
  });

  it("is undefined when a navigator carries no gpu", async () => {
    await withHostGpu(undefined, async () => {
      expect(hostGpu()).toBeUndefined();
      return Promise.resolve();
    });
  });

  it("is undefined when navigator.gpu cannot request an adapter", () => {
    const host = globalThis as object;
    const previous = Object.getOwnPropertyDescriptor(host, "navigator");
    Object.defineProperty(host, "navigator", {
      value: { gpu: { requestAdapter: 42 } },
      configurable: true,
      writable: true,
    });
    try {
      expect(hostGpu()).toBeUndefined();
    } finally {
      if (previous === undefined) {
        delete (host as Record<string, unknown>)["navigator"];
      } else {
        Object.defineProperty(host, "navigator", previous);
      }
    }
  });

  it("finds a gpu the host installed", async () => {
    const gpu = createRecordingGpu();
    await withHostGpu(gpu.gpu, async () => {
      expect(hostGpu()).toBe(gpu.gpu);
      return Promise.resolve();
    });
    expect(hostGpu()).toBeUndefined();
  });
});

describe("WebgpuRenderer.initialize", () => {
  it("acquires an adapter, a device and the canvas context, in that order", async () => {
    const gpu = createRecordingGpu();
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });

    expect(gpu.calls.map((call) => call.name).slice(0, 4)).toEqual([
      "gpu.requestAdapter",
      "adapter.requestDevice",
      "context.configure",
      "device.createBindGroupLayout",
    ]);
    expect(gpu.callsOf("context.configure")[0]?.args[0]).toEqual({
      format: "bgra8unorm",
      alphaMode: "premultiplied",
    });
    renderer.dispose();
  });

  it("compiles no pipeline at initialization — pipelines are lazy", async () => {
    const { gpu } = await initialized();
    expect(gpu.countOf("device.createRenderPipeline")).toBe(0);
    expect(gpu.countOf("device.createShaderModule")).toBe(0);
  });

  it("publishes §62's capability record off the device", async () => {
    const { renderer } = await initialized();
    const capabilities = renderer.capabilities;

    expect(capabilities.backend).toBe("webgpu");
    expect(capabilities.maxTextureSize).toBe(8192);
    expect(capabilities.computeShaders).toBe(true);
    expect(capabilities.storageBuffers).toBe(true);
    expect(capabilities.indirectDraw).toBe(true);
    expect(capabilities.timestampQueries).toBe(true);
    expect(capabilities.shaderPrecision).toBe("highp");
    expect(capabilities.maxUniformBufferBytes).toBe(65536);
    expect(capabilities.maxBindings).toBe(640);
    expect(capabilities.textureFormats).toEqual(["rgba8"]);
    // The backend cannot make one yet, whatever the device could (WP-R1.6).
    expect(capabilities.floatRenderTargets).toBe(false);
    // WebGPU has no standard anisotropy limit; 16 is the clamp the
    // texture cache already uses when `limits.maxAnisotropy` is absent.
    expect(capabilities.maxAnisotropy).toBe(16);
  });

  it("requests timestamp-query when the adapter has it (A-1)", async () => {
    const gpu = createRecordingGpu();
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });

    expect(gpu.callsOf("adapter.requestDevice")[0]?.args[0]).toEqual({
      requiredFeatures: ["timestamp-query"],
    });
    renderer.dispose();
  });

  it("does not request timestamp-query when the adapter lacks it (A-1)", async () => {
    const gpu = createRecordingGpu({ features: [] });
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });

    expect(gpu.callsOf("adapter.requestDevice")[0]?.args[0]).toBeUndefined();
    expect(renderer.capabilities.timestampQueries).toBe(false);
    renderer.dispose();
  });

  it("does not issue timestamp writes until lastGpuFrameTimeSeconds is read (A-1)", async () => {
    const { gpu, renderer } = await initialized();
    renderer.render(createRoot(), [createView()]);

    expect(gpu.countOf("device.createQuerySet")).toBe(0);
    const viewsPass = gpu
      .callsOf("encoder.beginRenderPass")
      .find(
        (call) =>
          (call.args[0] as { label?: string } | undefined)?.label ===
          "fourJS:views",
      );
    expect(
      (viewsPass?.args[0] as { timestampWrites?: unknown } | undefined)
        ?.timestampWrites,
    ).toBeUndefined();
  });

  it("writes views-pass timestamps after lastGpuFrameTimeSeconds is read (A-1)", async () => {
    const { gpu, renderer } = await initialized();
    expect(renderer.lastGpuFrameTimeSeconds).toBeNaN();
    gpu.reset();
    renderer.render(createRoot(), [createView()]);

    expect(gpu.countOf("device.createQuerySet")).toBe(1);
    expect(gpu.countOf("encoder.resolveQuerySet")).toBe(1);
    expect(gpu.countOf("buffer.mapAsync")).toBe(1);
    await Promise.resolve();
    // The recording double's mapped range is the i % 251 pattern, which
    // yields a finite positive u64 difference — not a wall-clock sample.
    expect(renderer.lastGpuFrameTimeSeconds).toBeGreaterThan(0);
    expect(Number.isFinite(renderer.lastGpuFrameTimeSeconds)).toBe(true);
  });

  it("leaves lastGpuFrameTimeSeconds NaN when timestamp-query is absent (A-1)", async () => {
    const gpu = createRecordingGpu({ features: [] });
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });
    renderer.resize(256, 256, 1);
    expect(renderer.lastGpuFrameTimeSeconds).toBeNaN();
    renderer.render(createRoot(), [createView()]);
    await Promise.resolve();
    expect(renderer.lastGpuFrameTimeSeconds).toBeNaN();
    expect(gpu.countOf("device.createQuerySet")).toBe(0);
    renderer.dispose();
  });

  it("reports the floor for a device that will not state its limits", async () => {
    const gpu = createRecordingGpu({ limits: {}, features: [] });
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });

    expect(renderer.capabilities.maxTextureSize).toBe(0);
    expect(renderer.capabilities.computeShaders).toBe(false);
    expect(renderer.capabilities.storageBuffers).toBe(false);
    expect(renderer.capabilities.timestampQueries).toBe(false);
    expect(renderer.capabilities.compressedTextureFormats).toEqual([]);
    expect(renderer.capabilities.maxAnisotropy).toBe(16);
  });

  it("reports maxAnisotropy from device.limits when the host names one", async () => {
    const gpu = createRecordingGpu({ limits: { maxAnisotropy: 4 } });
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });
    expect(renderer.capabilities.maxAnisotropy).toBe(4);
  });

  it("reports the compressed formats the device has", async () => {
    const gpu = createRecordingGpu({
      features: ["texture-compression-bc", "texture-compression-astc"],
    });
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });
    expect(renderer.capabilities.compressedTextureFormats).toEqual([
      "texture-compression-bc",
      "texture-compression-astc",
    ]);
  });

  it("reports the floor before initialization", () => {
    const renderer = new WebgpuRenderer();
    expect(renderer.capabilities).toEqual({
      backend: "webgpu",
      maxTextureSize: 0,
      textureFormats: [],
      multisampling: false,
      floatRenderTargets: false,
      timestampQueries: false,
      storageBuffers: false,
      computeShaders: false,
      indirectDraw: false,
      compressedTextureFormats: [],
      shaderPrecision: "none",
      maxUniformBufferBytes: 0,
      maxBindings: 0,
      maximumSkinningJoints: 48,
    });
  });

  it("falls back to bgra8unorm when the host names no preferred format", async () => {
    const gpu = createRecordingGpu({ noPreferredFormat: true });
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });
    expect(gpu.callsOf("context.configure")[0]?.args[0]).toEqual({
      format: "bgra8unorm",
      alphaMode: "premultiplied",
    });
  });

  it("rejects with RENDERER_INITIALIZATION_FAILED without a canvas", async () => {
    const renderer = new WebgpuRenderer();
    const error = await rejection(renderer.initialize());
    expect(error.code).toBe("RENDERER_INITIALIZATION_FAILED");
  });

  it("rejects when `canvas` is not a canvas", async () => {
    const renderer = new WebgpuRenderer();
    expect((await rejection(renderer.initialize({ canvas: {} }))).code).toBe(
      "RENDERER_INITIALIZATION_FAILED",
    );
  });

  it("rejects when the environment has no navigator.gpu", async () => {
    const gpu = createRecordingGpu();
    const renderer = new WebgpuRenderer();
    const error = await rejection(renderer.initialize({ canvas: gpu.canvas }));
    expect(error.code).toBe("RENDERER_INITIALIZATION_FAILED");
    expect(error.message).toContain("navigator.gpu");
  });

  it("rejects when requestAdapter resolves null — the flagless browser", async () => {
    const gpu = createRecordingGpu({ noAdapter: true });
    const renderer = new WebgpuRenderer();
    const error = await withHostGpu(gpu.gpu, () =>
      rejection(renderer.initialize({ canvas: gpu.canvas })),
    );
    expect(error.code).toBe("RENDERER_INITIALIZATION_FAILED");
    expect(error.message).toContain("no adapter");
  });

  it("rejects when requestDevice resolves null", async () => {
    const gpu = createRecordingGpu({ noDevice: true });
    const renderer = new WebgpuRenderer();
    const error = await withHostGpu(gpu.gpu, () =>
      rejection(renderer.initialize({ canvas: gpu.canvas })),
    );
    expect(error.code).toBe("RENDERER_INITIALIZATION_FAILED");
    expect(error.message).toContain("no device");
  });

  it("rejects, and destroys the device, when the canvas has no webgpu context", async () => {
    const gpu = createRecordingGpu({ badContext: true });
    const renderer = new WebgpuRenderer();
    const error = await withHostGpu(gpu.gpu, () =>
      rejection(renderer.initialize({ canvas: gpu.canvas })),
    );
    expect(error.code).toBe("RENDERER_INITIALIZATION_FAILED");
    expect(gpu.countOf("device.destroy")).toBe(1);
  });

  it("rejects when the canvas hands back no context at all", async () => {
    const gpu = createRecordingGpu({ noContext: true });
    const renderer = new WebgpuRenderer();
    const error = await withHostGpu(gpu.gpu, () =>
      rejection(renderer.initialize({ canvas: gpu.canvas })),
    );
    expect(error.code).toBe("RENDERER_INITIALIZATION_FAILED");
  });

  it("reports the floor for a device that states no limits at all", async () => {
    const gpu = createRecordingGpu({ noLimits: true });
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });
    expect(renderer.capabilities.maxTextureSize).toBe(0);
    expect(renderer.capabilities.timestampQueries).toBe(false);
    renderer.dispose();
  });

  it("rejects a second initialize with INVALID_APPLICATION_STATE", async () => {
    const { gpu, renderer } = await initialized();
    const error = await withHostGpu(gpu.gpu, () =>
      rejection(renderer.initialize({ canvas: gpu.canvas })),
    );
    expect(error.code).toBe("INVALID_APPLICATION_STATE");
  });
});

describe("WebgpuRenderer.render", () => {
  let harness: Harness;

  beforeEach(async () => {
    clearRegisteredSkinningPipeline();
    harness = await initialized();
  });

  it("draws nothing at all for an empty view list", () => {
    harness.renderer.render(createRoot(), []);
    expect(harness.gpu.calls).toHaveLength(0);
  });

  it("skips the frame for a disposed render target (§83, WP-R1.6)", () => {
    const target = new RenderTarget({ width: 8, height: 8 });
    target.dispose();
    harness.renderer.render(createRoot(), [createView()], undefined, target);
    expect(harness.gpu.calls).toHaveLength(0);
  });

  it("records one pass for the frame, with a clear draw per view", () => {
    const root = createRoot();
    root.add(renderable(triangle()));
    harness.renderer.render(root, [
      createView({ clearColor: [0.25, 0.5, 0.75, 1] }),
    ]);

    const names = harness.gpu.calls.map((call) => call.name);
    expect(
      names.filter((name) => name === "encoder.beginRenderPass"),
    ).toHaveLength(1);
    expect(names.filter((name) => name === "pass.end")).toHaveLength(1);
    expect(names.filter((name) => name === "queue.submit")).toHaveLength(1);
    // Clear draw, then the triangle.
    expect(harness.gpu.countOf("pass.draw")).toBe(2);
    expect(harness.gpu.countOf("pass.setViewport")).toBe(1);
    expect(harness.gpu.countOf("pass.setScissorRect")).toBe(1);
  });

  it("loads rather than clears the colour attachment (§61's rectangle rule)", () => {
    harness.renderer.render(createRoot(), [createView()]);
    const descriptor = harness.gpu.callsOf("encoder.beginRenderPass")[0]
      ?.args[0] as {
      colorAttachments: { loadOp: string }[];
      depthStencilAttachment: { depthLoadOp: string };
    };
    expect(descriptor.colorAttachments[0]?.loadOp).toBe("load");
    expect(descriptor.depthStencilAttachment.depthLoadOp).toBe("load");
  });

  it("flips §48's bottom-left rectangle into WebGPU's top-left one", () => {
    harness.renderer.render(createRoot(), [
      createView({ x: 0, y: 0, width: 1, height: 0.5 }),
    ]);
    // A bottom half of a 256-pixel surface is the *lower* 128 rows, which in
    // top-left coordinates starts at y = 128.
    expect(
      harness.gpu.callsOf("pass.setViewport")[0]?.args.slice(0, 4),
    ).toEqual([0, 128, 256, 128]);
    expect(harness.gpu.callsOf("pass.setScissorRect")[0]?.args).toEqual([
      0, 128, 256, 128,
    ]);
  });

  it("takes an un-normalized rectangle as device pixels (§48)", () => {
    harness.renderer.render(createRoot(), [
      createView({ x: 8, y: 16, width: 32, height: 64, normalized: false }),
    ]);
    // Bottom-left (8, 16) of a 256-pixel surface, 64 tall, is top-left y = 176.
    expect(harness.gpu.callsOf("pass.setScissorRect")[0]?.args).toEqual([
      8, 176, 32, 64,
    ]);
  });

  it("skips a view with an empty rectangle", () => {
    harness.renderer.render(createRoot(), [
      createView({ width: 0, normalized: true }),
    ]);
    expect(harness.gpu.countOf("pass.setViewport")).toBe(0);
    expect(harness.gpu.countOf("pass.draw")).toBe(0);
  });

  it("clears colour only where the view asks for it", () => {
    const first = harness.renderer;
    first.render(createRoot(), [createView()]);
    const withoutColor = harness.gpu.callsOf("device.createRenderPipeline")[0]
      ?.args[0] as { fragment: { targets: { writeMask: number }[] } };
    expect(withoutColor.fragment.targets[0]?.writeMask).toBe(0);

    harness.gpu.reset();
    first.render(createRoot(), [createView({ clearColor: [1, 0, 0, 1] })]);
    const withColor = harness.gpu.callsOf("device.createRenderPipeline")[0]
      ?.args[0] as { fragment: { targets: { writeMask: number }[] } };
    expect(withColor.fragment.targets[0]?.writeMask).toBe(0xf);
  });

  it("uploads the frame's uniforms once, before the submit that reads them", () => {
    const root = createRoot();
    root.add(renderable(triangle()));
    harness.renderer.render(root, [createView({ clearColor: [1, 0, 0, 0.5] })]);

    const names = harness.gpu.calls.map((call) => call.name);
    expect(names.lastIndexOf("queue.writeBuffer")).toBeLessThan(
      names.indexOf("queue.submit"),
    );

    const data = uniformUpload(harness.gpu);
    // Block 0 is the clear: its colour is the view's clear colour.
    const clearColor = DRAW_COLOR_OFFSET / 4;
    expect(data.slice(clearColor, clearColor + 4)).toEqual([1, 0, 0, 0.5]);
    // Block 1 is the triangle, at the next 256-byte stride.
    const stride = UNIFORM_STRIDE_BYTES / 4;
    expect(data.slice(stride + clearColor, stride + clearColor + 4)).toEqual([
      1, 1, 1, 1,
    ]);
    // …and its model matrix is the identity the node resolves to.
    const model = stride + DRAW_MODEL_OFFSET / 4;
    expect(data[model]).toBe(1);
    expect(data[model + 5]).toBe(1);
    // Clear (model null) and the triangle (identity mat4) both pack identity
    // `normalMatrix` — three columns padded to vec4.
    const clearNormal = DRAW_NORMAL_OFFSET / 4;
    expect(data.slice(clearNormal, clearNormal + 12)).toEqual([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0,
    ]);
    const drawNormal = stride + DRAW_NORMAL_OFFSET / 4;
    expect(data.slice(drawNormal, drawNormal + 12)).toEqual([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0,
    ]);
  });

  it("copies retained typed arrays at record time (the recording gotcha)", () => {
    const root = createRoot();
    const material = new TestMaterial([1, 0, 0, 1]);
    root.add(renderable(triangle(), material));
    harness.renderer.render(root, [createView()]);
    const first = uniformUpload(harness.gpu);

    material.color[0] = 0;
    material.color[1] = 1;
    harness.renderer.render(root, [createView()]);

    const stride = UNIFORM_STRIDE_BYTES / 4;
    const colour = stride + DRAW_COLOR_OFFSET / 4;
    // The first frame's tape still reports the first frame's colour, even
    // though the staging array it was handed has since been rewritten.
    expect(first.slice(colour, colour + 3)).toEqual([1, 0, 0]);
  });

  it("multiplies §57's opacity into the uploaded alpha", () => {
    const root = createRoot();
    const material = new TestMaterial([1, 1, 1, 0.5]);
    material.opacity = 0.5;
    root.add(renderable(triangle(), material));
    harness.renderer.render(root, [createView()]);

    const data = uniformUpload(harness.gpu);
    const alpha = UNIFORM_STRIDE_BYTES / 4 + DRAW_COLOR_OFFSET / 4 + 3;
    expect(data[alpha]).toBeCloseTo(0.25);
  });

  it("binds the uniform buffer at one dynamic offset per draw", () => {
    const root = createRoot();
    root.add(renderable(triangle()));
    root.add(renderable(triangle()));
    harness.renderer.render(root, [createView()]);

    const offsets = harness.gpu
      .callsOf("pass.setBindGroup")
      .map((call) => (call.args[2] as number[])[0]);
    expect(offsets).toEqual([0, 256, 512]);
    // One bind group for the whole frame, created once at initialization.
    expect(harness.gpu.countOf("device.createBindGroup")).toBe(0);
  });

  it("uploads a geometry once and reuses it across frames", () => {
    const root = createRoot();
    const geometry = triangle();
    root.add(renderable(geometry));
    harness.renderer.render(root, [createView()]);
    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.countOf("device.createBuffer")).toBe(1);

    geometry.markDirty();
    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.countOf("device.createBuffer")).toBe(2);
  });

  it("compiles one pipeline per distinct descriptor, and no more", () => {
    const root = createRoot();
    root.add(renderable(triangle()));
    root.add(renderable(triangle()));
    harness.renderer.render(root, [createView()]);
    // The clear pipeline plus one unlit pipeline shared by both triangles.
    expect(harness.gpu.countOf("device.createRenderPipeline")).toBe(2);

    harness.gpu.reset();
    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.countOf("device.createRenderPipeline")).toBe(0);
  });

  it("draws indexed geometry through drawIndexed", () => {
    const root = createRoot();
    root.add(
      renderable(
        new TestGeometry(
          new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
          new Uint16Array([0, 1, 2]),
        ),
      ),
    );
    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.countOf("pass.setIndexBuffer")).toBe(1);
    expect(harness.gpu.callsOf("pass.setIndexBuffer")[0]?.args[1]).toBe(
      "uint16",
    );
    expect(harness.gpu.callsOf("pass.drawIndexed")[0]?.args[0]).toBe(3);
  });

  it("binds the colour stream only for a vertexColors material that has one", () => {
    const root = createRoot();
    const coloured = new TestMaterial();
    coloured.vertexColors = true;
    root.add(renderable(triangle(new Float32Array(12).fill(1)), coloured));
    // A vertexColors material whose geometry carries no colour stream falls
    // back to the flat variant rather than binding a buffer that is not there.
    const without = new TestMaterial();
    without.vertexColors = true;
    root.add(renderable(triangle(), without));

    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.countOf("pass.setVertexBuffer")).toBe(3);
    // Clear + flat unlit + vertex-coloured unlit.
    expect(harness.gpu.countOf("device.createRenderPipeline")).toBe(3);
  });

  it("samples §57's map through group 1 when the geometry carries uvs", () => {
    const root = createRoot();
    const material = new TestMaterial();
    material.map = new TestTexture();
    root.add(renderable(texturedTriangle(), material));
    harness.renderer.render(root, [createView()]);

    // The texture uploads once and binds beside its sampler at group 1. (The
    // frame's other `createTexture` is the depth attachment.)
    expect(mapAllocations(harness.gpu)).toBe(1);
    expect(harness.gpu.countOf("queue.writeTexture")).toBe(1);
    expect(harness.gpu.countOf("device.createSampler")).toBe(1);
    const groupBinds = harness.gpu
      .callsOf("pass.setBindGroup")
      .map((call) => call.args[0]);
    expect(groupBinds).toContain(1);

    // Positions at slot 0, uvs at slot 1 — the positional order.
    const slots = harness.gpu
      .callsOf("pass.setVertexBuffer")
      .map((call) => call.args[0]);
    expect(slots).toEqual([0, 1]);

    // The textured module is its own variant, and it samples.
    const sources = harness.gpu
      .callsOf("device.createShaderModule")
      .map((call) => (call.args[0] as { code: string }).code);
    expect(sources.some((code) => code.includes("textureSample"))).toBe(true);
  });

  it("reuses the uploaded texture across frames, until markDirty", () => {
    const root = createRoot();
    const material = new TestMaterial();
    const map = new TestTexture();
    material.map = map;
    root.add(renderable(texturedTriangle(), material));
    harness.renderer.render(root, [createView()]);
    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.countOf("queue.writeTexture")).toBe(1);

    map.markDirty();
    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.countOf("queue.writeTexture")).toBe(2);
    expect(harness.gpu.countOf("texture.destroy")).toBe(1);
  });

  it("shares one sampler and one pipeline across textures sharing state", () => {
    const root = createRoot();
    const first = new TestMaterial();
    first.map = new TestTexture();
    const second = new TestMaterial();
    second.map = new TestTexture();
    root.add(renderable(texturedTriangle(), first));
    root.add(renderable(texturedTriangle(), second));
    harness.renderer.render(root, [createView()]);

    // Two textures, two bind groups — one sampler between them (§77), and
    // one textured pipeline plus the clear.
    expect(mapAllocations(harness.gpu)).toBe(2);
    expect(harness.gpu.countOf("device.createSampler")).toBe(1);
    expect(harness.gpu.countOf("device.createRenderPipeline")).toBe(2);
  });

  it("draws untextured when the geometry carries no uvs to sample with", () => {
    const root = createRoot();
    const material = new TestMaterial();
    material.map = new TestTexture();
    root.add(renderable(triangle(), material));
    harness.renderer.render(root, [createView()]);

    // Clear + triangle: the draw happens, flat, with nothing uploaded.
    expect(harness.gpu.countOf("pass.draw")).toBe(2);
    expect(mapAllocations(harness.gpu)).toBe(0);
    expect(harness.gpu.countOf("queue.writeTexture")).toBe(0);
    expect(harness.gpu.countOf("device.createSampler")).toBe(0);
  });

  it("skips the draw when its map has been disposed (§83)", () => {
    const root = createRoot();
    const material = new TestMaterial();
    const map = new TestTexture();
    material.map = map;
    root.add(renderable(texturedTriangle(), material));
    map.dispose();
    harness.renderer.render(root, [createView()]);

    // The clear draws; the textured item is skipped, never painted undefined.
    expect(harness.gpu.countOf("pass.draw")).toBe(1);
    expect(harness.gpu.countOf("device.createSampler")).toBe(0);
  });

  it("binds colours and uvs in slot order for a variant reading all three", () => {
    const root = createRoot();
    const material = new TestMaterial();
    material.vertexColors = true;
    material.map = new TestTexture();
    root.add(
      renderable(texturedTriangle(new Float32Array(12).fill(1)), material),
    );
    harness.renderer.render(root, [createView()]);

    const slots = harness.gpu
      .callsOf("pass.setVertexBuffer")
      .map((call) => call.args[0]);
    expect(slots).toEqual([0, 1, 2]);
    // Position, colour and uv buffers, in the geometry cache's upload order:
    // positions → uvs → colours (matching `gl-geometry.ts`), bound as
    // position → colours → uvs (the variant's slot order).
    expect(harness.gpu.countOf("device.createBuffer")).toBe(3);
  });

  it("generates a mip chain for a mipmapped map, inside the frame", () => {
    const root = createRoot();
    const material = new TestMaterial();
    const map = new TestTexture(4, 4);
    map.mipmaps = true;
    material.map = map;
    root.add(renderable(texturedTriangle(), material));
    harness.renderer.render(root, [createView()]);

    // The chain's own encoder submits before the frame's: two blit passes for
    // levels 1 and 2, then the frame pass — three passes, two submits.
    expect(harness.gpu.countOf("encoder.beginRenderPass")).toBe(3);
    expect(harness.gpu.countOf("queue.submit")).toBe(2);
    const submits = harness.gpu.calls
      .map((call) => call.name)
      .filter((name) => name === "queue.submit" || name === "pass.end");
    expect(submits[submits.length - 1]).toBe("queue.submit");
  });

  it("takes §57's blend mode from the material, defaulting to normal", () => {
    const root = createRoot();
    const plain = new TestMaterial();
    plain.transparent = true;
    root.add(renderable(triangle(), plain));
    const additive = new TestMaterial();
    additive.transparent = true;
    additive.blendMode = "additive";
    root.add(renderable(triangle(), additive));

    harness.renderer.render(root, [createView()]);
    const blends = harness.gpu.callsOf("device.createRenderPipeline").map(
      (call) =>
        (
          call.args[0] as {
            fragment: {
              targets: { blend?: { color: { dstFactor: string } } }[];
            };
          }
        ).fragment.targets[0]?.blend?.color.dstFactor,
    );
    // The clear pipeline (no blend), then the two transparent variants.
    expect(blends).toEqual([undefined, "one-minus-src-alpha", "one"]);
  });

  it("carries §57's depth and colour writes into the pipeline", () => {
    const root = createRoot();
    const material = new TestMaterial();
    material.depthTest = false;
    material.depthWrite = false;
    material.colorWrite = false;
    root.add(renderable(triangle(), material));

    harness.renderer.render(root, [createView()]);
    const descriptor = harness.gpu.callsOf("device.createRenderPipeline")[1]
      ?.args[0] as {
      depthStencil: { depthWriteEnabled: boolean; depthCompare: string };
      fragment: { targets: { writeMask: number }[] };
    };
    expect(descriptor.depthStencil).toEqual({
      format: "depth24plus",
      depthWriteEnabled: false,
      depthCompare: "always",
    });
    expect(descriptor.fragment.targets[0]?.writeMask).toBe(0);
  });

  it("skips the draw when a material accessor disposes the renderer mid-arm (§61)", () => {
    // The reentrant family, one accessor later than the pinned map/stencil
    // getters: `map` runs inside the unlit arm *before* the pipeline is
    // acquired, so a teardown there surfaces as the disposed cache's null —
    // the narrowing the draw path encodes — and the draw is skipped, not
    // thrown.
    const material = new TestMaterial();
    Object.defineProperty(material, "map", {
      get: (): null => {
        harness.renderer.dispose();
        return null;
      },
    });
    const root = createRoot();
    root.add(renderable(triangle(), material));

    expect(() => {
      harness.renderer.render(root, [createView()]);
    }).not.toThrow();
    // The clear drew; the unlit draw found its pipeline cache disposed.
    expect(harness.gpu.countOf("pass.draw")).toBe(1);
    expect(harness.renderer.disposed).toBe(true);
  });

  it("skips a sprite whose material accessor disposes the renderer mid-draw (§61)", () => {
    // The same family inside `#drawSprite`: the texture resolved while the
    // renderer was live, and `blendMode` — read while building the pipeline
    // descriptor — tears it down. The disposed cache answers null and the
    // sprite is skipped without a throw.
    const material = new TestSpriteMaterial();
    Object.defineProperty(material, "blendMode", {
      get: (): undefined => {
        harness.renderer.dispose();
        return undefined;
      },
    });
    const root = createRoot();
    root.add(new SpriteNode(texturedTriangle(), material));

    expect(() => {
      harness.renderer.render(root, [createView()]);
    }).not.toThrow();
    expect(harness.gpu.countOf("pass.draw")).toBe(1);
    expect(harness.renderer.disposed).toBe(true);
  });

  it("skips an item this tier has no pipeline for", () => {
    const root = createRoot();
    // A skinned item (RFC 0003): a renderable with a structural skeleton over
    // a geometry carrying joints and weights builds as `"skinned-unlit"`.
    // Colour pipelines live behind `registerSkinningPipeline()`; unregistered
    // (this test) the draw is skipped, never approximated as a bind pose —
    // and skipped before the geometry cache uploads buffers nothing will bind
    // (WP-R1.4's pinned rule; before WP-R1.5 this test pinned the `"lit"`
    // kind, which now draws). Shadow caster and id pass stay absent.
    const geometry = triangle();
    geometry.joints = new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    geometry.weights = new Float32Array(12).fill(0.25);
    const item = renderable(geometry);
    (item as unknown as { skeleton: unknown }).skeleton = {
      update: (): void => {},
      jointMatrices: new Float32Array(16),
      bones: [null],
    };
    root.add(item);
    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.countOf("pass.draw")).toBe(1);
    expect(harness.gpu.countOf("device.createBuffer")).toBe(0);
  });

  it("skips a draw whose geometry has nothing to draw", () => {
    const root = createRoot();
    root.add(renderable(new TestGeometry(new Float32Array(0))));
    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.countOf("pass.draw")).toBe(1);
  });

  it("draws every view in array order, into one pass", () => {
    const root = createRoot();
    root.add(renderable(triangle()));
    harness.renderer.render(root, [
      createView({ id: "a" }),
      createView({ id: "b", x: 0.5, width: 0.5 }),
    ]);
    expect(harness.gpu.countOf("encoder.beginRenderPass")).toBe(1);
    expect(harness.gpu.countOf("pass.setViewport")).toBe(2);
    expect(harness.gpu.countOf("pass.draw")).toBe(4);
  });

  it("asks each view's camera for its view matrix once per frame", () => {
    const camera = new TestCamera();
    harness.renderer.render(createRoot(), [
      createView({ camera: camera.asCamera }),
    ]);
    expect(camera.updateViewMatrixCalls).toBe(1);
  });

  it("draws the §43 interpolated poses when given an interpolation record", () => {
    const root = createRoot();
    root.add(renderable(triangle()));
    harness.renderer.render(root, [createView()], {
      // A pose buffer that tracks nothing: every node falls back to its live
      // local transform, which is exactly the untracked path §43 defines.
      poseBuffer: { computeRenderPose: () => false } as never,
      alpha: 0.5,
    });
    expect(harness.gpu.countOf("pass.draw")).toBe(2);
  });

  it("counts §84's statistics for submitted draws only", () => {
    const statistics = createRenderStatistics();
    harness.renderer.statistics = statistics;
    const root = createRoot();
    root.add(renderable(triangle()));
    harness.renderer.render(root, [createView()]);
    // The clear draw is the backend's own, not the scene's: one draw call, one
    // triangle.
    expect(statistics.drawCalls).toBe(1);
    expect(statistics.triangles).toBe(1);
    expect(statistics.instances).toBe(1);
  });

  it("counts no triangles for a line-list geometry", () => {
    const statistics = createRenderStatistics();
    harness.renderer.statistics = statistics;
    const root = createRoot();
    root.add(
      renderable(
        new TestGeometry(
          new Float32Array([-0.5, 0, 0, 0.5, 0, 0]),
          undefined,
          "lines",
        ),
      ),
    );
    harness.renderer.render(root, [createView()]);
    expect(statistics.drawCalls).toBe(1);
    expect(statistics.triangles).toBe(0);
  });

  it("grows the uniform buffer rather than reallocating mid-frame", () => {
    const root = createRoot();
    for (let index = 0; index < 40; index += 1) {
      root.add(renderable(triangle()));
    }
    harness.renderer.render(root, [createView()]);
    // Exactly one growth, and it happens before any pass command.
    const names = harness.gpu.calls.map((call) => call.name);
    const grown = names.filter((name) => name === "device.createBindGroup");
    expect(grown).toHaveLength(1);
    expect(names.indexOf("device.createBindGroup")).toBeLessThan(
      names.indexOf("encoder.beginRenderPass"),
    );
  });
});

describe("WebgpuRenderer.resize", () => {
  it("scales the swap chain by the resolution", async () => {
    const { gpu, renderer } = await initialized();
    renderer.resize(200, 100, 2);
    expect(gpu.canvas.width).toBe(400);
    expect(gpu.canvas.height).toBe(200);
  });

  it("defaults the resolution to 1 and never goes below one pixel", async () => {
    const { gpu, renderer } = await initialized();
    renderer.resize(0, 0);
    expect(gpu.canvas.width).toBe(1);
    expect(gpu.canvas.height).toBe(1);
  });

  it("records a size before initialization without touching a canvas", () => {
    const renderer = new WebgpuRenderer();
    expect(() => {
      renderer.resize(640, 480);
    }).not.toThrow();
  });

  it("reallocates the depth attachment only when the size changes", async () => {
    const { gpu, renderer } = await initialized();
    const root = createRoot();
    renderer.render(root, [createView()]);
    expect(gpu.countOf("device.createTexture")).toBe(1);
    renderer.render(root, [createView()]);
    expect(gpu.countOf("device.createTexture")).toBe(1);
    renderer.resize(128, 128, 1);
    renderer.render(root, [createView()]);
    expect(gpu.countOf("device.createTexture")).toBe(2);
  });
});

describe("WebgpuRenderer device loss (§61)", () => {
  it("emits contextlost, drops the caches and stops drawing", async () => {
    const { gpu, renderer } = await initialized();
    const seen: string[] = [];
    renderer.events.on("contextlost", (event) => {
      seen.push(event.renderer === renderer ? "self" : "other");
    });

    gpu.loseDevice();
    await Promise.resolve();
    await Promise.resolve();

    expect(seen).toEqual(["self"]);
    expect(renderer.deviceLost).toBe(true);

    gpu.reset();
    renderer.render(createRoot(), [createView()]);
    renderer.resize(64, 64);
    expect(gpu.calls).toHaveLength(0);
  });

  it("forgets uploaded textures on loss without touching the dead device", async () => {
    const { gpu, renderer } = await initialized();
    const root = createRoot();
    const material = new TestMaterial();
    material.map = new TestTexture();
    root.add(renderable(texturedTriangle(), material));
    renderer.render(root, [createView()]);

    gpu.loseDevice();
    await Promise.resolve();
    await Promise.resolve();
    gpu.reset();
    renderer.dispose();
    // No `texture.destroy` for the map: its allocation died with the device.
    expect(gpu.countOf("texture.destroy")).toBe(0);
  });

  it("does not report teardown as a loss", async () => {
    const { gpu, renderer } = await initialized();
    let lost = 0;
    renderer.events.on("contextlost", () => {
      lost += 1;
    });
    gpu.loseDevice("destroyed");
    await Promise.resolve();
    await Promise.resolve();
    expect(lost).toBe(0);
    expect(renderer.deviceLost).toBe(false);
  });

  it("does not report a loss that arrives after disposal", async () => {
    const { gpu, renderer } = await initialized();
    let lost = 0;
    renderer.events.on("contextlost", () => {
      lost += 1;
    });
    renderer.dispose();
    gpu.loseDevice();
    await Promise.resolve();
    await Promise.resolve();
    expect(lost).toBe(0);
  });

  it("disposes cleanly while lost, without calling into the dead device", async () => {
    const { gpu, renderer } = await initialized();
    gpu.loseDevice();
    await Promise.resolve();
    await Promise.resolve();
    gpu.reset();
    renderer.dispose();
    expect(gpu.countOf("device.destroy")).toBe(0);
    expect(renderer.disposed).toBe(true);
  });

  it("tolerates a device that exposes no `lost` promise at all", async () => {
    const gpu = createRecordingGpu();
    const device = gpu.device as unknown as Record<string, unknown>;
    delete device["lost"];
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });
    expect(renderer.deviceLost).toBe(false);
    renderer.dispose();
  });
});

describe("WebgpuRenderer.dispose", () => {
  it("releases the device, the swap chain and every allocation", async () => {
    const { gpu, renderer } = await initialized();
    const root = createRoot();
    root.add(renderable(triangle()));
    renderer.render(root, [createView()]);
    gpu.reset();

    renderer.dispose();
    expect(gpu.countOf("device.destroy")).toBe(1);
    expect(gpu.countOf("context.unconfigure")).toBe(1);
    // The geometry's vertex buffer, the depth texture and the uniform buffer.
    expect(gpu.countOf("buffer.destroy")).toBeGreaterThanOrEqual(2);
    expect(gpu.countOf("texture.destroy")).toBe(1);
  });

  it("destroys uploaded textures alongside the depth texture", async () => {
    const { gpu, renderer } = await initialized();
    const root = createRoot();
    const material = new TestMaterial();
    material.map = new TestTexture();
    root.add(renderable(texturedTriangle(), material));
    renderer.render(root, [createView()]);
    gpu.reset();

    renderer.dispose();
    // The map's allocation and the depth attachment.
    expect(gpu.countOf("texture.destroy")).toBe(2);
  });

  it("is idempotent", async () => {
    const { gpu, renderer } = await initialized();
    renderer.dispose();
    gpu.reset();
    renderer.dispose();
    expect(gpu.calls).toHaveLength(0);
  });

  it("makes every other method throw INVALID_APPLICATION_STATE", async () => {
    const { renderer } = await initialized();
    renderer.dispose();
    for (const call of [
      () => {
        renderer.render(createRoot(), [createView()]);
      },
      () => {
        renderer.resize(1, 1);
      },
    ]) {
      expect(call).toThrowError(/disposal is terminal/u);
    }
    expect((await rejection(renderer.initialize())).code).toBe(
      "INVALID_APPLICATION_STATE",
    );
  });

  it("disposes a renderer that never initialized", () => {
    const renderer = new WebgpuRenderer();
    expect(() => {
      renderer.dispose();
    }).not.toThrow();
  });

  it("draws nothing after disposal of the caches but before the device", () => {
    const renderer = new WebgpuRenderer();
    renderer.render(createRoot(), [createView()]);
    expect(renderer.capabilities.backend).toBe("webgpu");
  });
});

/** The labels of every pipeline the frame compiled, in creation order. */
function pipelineLabels(gpu: RecordingGpu): string[] {
  return gpu
    .callsOf("device.createRenderPipeline")
    .map((call) => String((call.args[0] as { label?: string }).label));
}

/**
 * The recorded `createRenderPipeline` descriptor whose label contains `part` —
 * `unknown`, for the caller to narrow to the members its assertion reads.
 */
function pipelineDescriptor(gpu: RecordingGpu, part: string): unknown {
  const call = gpu
    .callsOf("device.createRenderPipeline")
    .find((candidate) =>
      String((candidate.args[0] as { label?: string }).label).includes(part),
    );
  if (call === undefined) {
    throw new Error(`no pipeline whose label contains ${part}`);
  }
  return call.args[0];
}

/** Every recorded stencil reference, in order — `[]` for a clipless frame. */
function stencilReferences(gpu: RecordingGpu): number[] {
  return gpu
    .callsOf("pass.setStencilReference")
    .map((call) => call.args[0] as number);
}

describe("WebgpuRenderer sprites (§55, WP-R1.3)", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await initialized();
  });

  it("draws a sprite through the sprite pipeline, texture at group 1", () => {
    const root = createRoot();
    root.add(new SpriteNode(texturedTriangle(), new TestSpriteMaterial()));
    harness.renderer.render(root, [createView()]);

    // Clear plus the sprite.
    expect(harness.gpu.countOf("pass.draw")).toBe(2);
    expect(
      pipelineLabels(harness.gpu).some((label) =>
        label.startsWith("fourJS:sprite|"),
      ),
    ).toBe(true);
    // The sprite's own group-0 layout and the texture's group 1, both created
    // by this first sprite frame (the lazy WP-R1.2 pattern), plus their two
    // bind groups.
    expect(harness.gpu.countOf("device.createBindGroupLayout")).toBe(2);
    expect(harness.gpu.countOf("device.createBindGroup")).toBe(2);
    const groups = harness.gpu
      .callsOf("pass.setBindGroup")
      .map((call) => call.args[0]);
    expect(groups).toContain(1);
  });

  it("uploads tint × opacity in the sprite block; uvs are a vertex stream", () => {
    const root = createRoot();
    const material = new TestSpriteMaterial(
      new TestTexture(),
      [1, 0.5, 0.25, 0.8],
    );
    material.opacity = 0.5;
    root.add(new SpriteNode(texturedTriangle(), material));
    harness.renderer.render(root, [createView()]);

    const data = uniformUpload(harness.gpu);
    const stride = UNIFORM_STRIDE_BYTES / 4;
    const tint = stride + SPRITE_TINT_OFFSET / 4;
    expect(data.slice(tint, tint + 3)).toEqual([1, 0.5, 0.25]);
    expect(data[tint + 3]).toBeCloseTo(0.4);
    // Two vertex buffers: position then the authored uv stream.
    expect(harness.gpu.countOf("pass.setVertexBuffer")).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("binds the authored uv stream at slot 1, not a quad uniform", () => {
    const root = createRoot();
    const geometry = texturedTriangle();
    geometry.uvs = new Float32Array([0.5, 0.5, 1, 0.5, 1, 1]);
    root.add(
      new SpriteNode(geometry, new TestSpriteMaterial(new TestTexture(4, 4))),
    );
    harness.renderer.render(root, [createView()]);

    const buffers = harness.gpu.callsOf("pass.setVertexBuffer");
    expect(buffers.map((call) => call.args[0])).toEqual([0, 1]);
  });

  it("blends by construction, whatever `transparent` says (§55)", () => {
    const root = createRoot();
    root.add(new SpriteNode(texturedTriangle(), new TestSpriteMaterial()));
    harness.renderer.render(root, [createView()]);

    const descriptor = pipelineDescriptor(harness.gpu, "fourJS:sprite|") as {
      fragment: { targets: { blend?: { color: { srcFactor: string } } }[] };
    };
    expect(descriptor.fragment.targets[0]?.blend?.color.srcFactor).toBe(
      "src-alpha",
    );
  });

  it("skips a sprite whose texture is disposed (§83)", () => {
    const root = createRoot();
    const material = new TestSpriteMaterial();
    material.texture?.dispose();
    root.add(new SpriteNode(triangle(), material));
    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.countOf("pass.draw")).toBe(1);
  });

  it("skips a sprite material double that carries no texture at all", () => {
    const root = createRoot();
    // The F16 defensive read: a structurally-typed §55 double predating the
    // contract reports nothing, which must mean "no texture", not a crash.
    root.add(new SpriteNode(triangle(), new TestSpriteMaterial(null)));
    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.countOf("pass.draw")).toBe(1);
    expect(harness.gpu.countOf("device.createSampler")).toBe(0);
  });

  it("draws an indexed sprite quad through drawIndexed", () => {
    const root = createRoot();
    const quad = new TestGeometry(
      new Float32Array([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
      ]),
      new Uint16Array([0, 1, 2, 0, 2, 3]),
    );
    quad.uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    root.add(new SpriteNode(quad, new TestSpriteMaterial()));
    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.callsOf("pass.drawIndexed")[0]?.args[0]).toBe(6);
  });

  it("reuses the sprite bind group until the uniform buffer regrows", () => {
    const root = createRoot();
    root.add(new SpriteNode(texturedTriangle(), new TestSpriteMaterial()));
    harness.renderer.render(root, [createView()]);
    harness.gpu.reset();
    harness.renderer.render(root, [createView()]);
    // Frame 2: no new layout, no new bind group — everything is cached.
    expect(harness.gpu.countOf("device.createBindGroup")).toBe(0);

    // Growing the uniform buffer orphans both bind groups; the next sprite
    // draw recreates its own against the new buffer.
    for (let index = 0; index < 40; index += 1) {
      root.add(renderable(triangle()));
    }
    harness.gpu.reset();
    harness.renderer.render(root, [createView()]);
    // The draw bind group (in growUniforms) and the sprite's (lazily).
    expect(harness.gpu.countOf("device.createBindGroup")).toBe(2);
  });

  it("counts §84's statistics for a sprite draw", () => {
    const statistics = createRenderStatistics();
    harness.renderer.statistics = statistics;
    const root = createRoot();
    root.add(new SpriteNode(texturedTriangle(), new TestSpriteMaterial()));
    harness.renderer.render(root, [createView()]);
    expect(statistics.drawCalls).toBe(1);
    expect(statistics.triangles).toBe(1);
  });
});

describe("WebgpuRenderer clipping (§67, WP-R1.3)", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await initialized();
  });

  /** A clip node over a triangle, with one clipped child. */
  function clippedScene(): Renderable {
    const root = createRoot();
    const panel = renderable(triangle());
    panel.clip = true;
    panel.add(renderable(triangle(), new TestMaterial([1, 0, 0, 1])));
    root.add(panel);
    return root;
  }

  it("records no stencil content at all for a clipless frame — byte identity", () => {
    const root = createRoot();
    root.add(renderable(triangle()));
    harness.renderer.render(root, [createView()]);

    const transcript = harness.gpu.transcript().join("\n");
    expect(transcript).not.toContain("depth24plus-stencil8");
    expect(transcript).not.toContain("stencilLoadOp");
    expect(transcript).not.toContain("stencilFront");
    expect(transcript).not.toContain("setStencilReference");
  });

  it("upgrades the depth format and the pass for a frame that clips", () => {
    harness.renderer.render(clippedScene(), [createView()]);

    const depth = harness.gpu.callsOf("device.createTexture")[0]?.args[0] as {
      label: string;
      format: string;
    };
    expect(depth.label).toBe("fourJS:depth");
    expect(depth.format).toBe("depth24plus-stencil8");
    const pass = harness.gpu.callsOf("encoder.beginRenderPass")[0]?.args[0] as {
      depthStencilAttachment: {
        stencilLoadOp?: string;
        stencilStoreOp?: string;
      };
    };
    expect(pass.depthStencilAttachment.stencilLoadOp).toBe("load");
    expect(pass.depthStencilAttachment.stencilStoreOp).toBe("store");
  });

  it("clears the stencil rectangle with the clear draw (passOp zero)", () => {
    harness.renderer.render(clippedScene(), [createView()]);
    const clear = pipelineDescriptor(harness.gpu, "fourJS:clear") as {
      depthStencil: {
        stencilFront: { compare: string; passOp: string };
        stencilWriteMask: number;
      };
    };
    expect(clear.depthStencil.stencilFront.compare).toBe("always");
    expect(clear.depthStencil.stencilFront.passOp).toBe("zero");
    expect(clear.depthStencil.stencilWriteMask).toBe(0xff);
  });

  it("writes the mask's plane with colour and depth off, and tests content equal", () => {
    harness.renderer.render(clippedScene(), [createView()]);

    // Clear, mask, panel (unclipped), child (clipped) — four draws.
    expect(harness.gpu.countOf("pass.draw")).toBe(4);

    const mask = pipelineDescriptor(harness.gpu, "|s:always,255,1,") as {
      fragment: { targets: { writeMask: number }[] };
      depthStencil: {
        depthWriteEnabled: boolean;
        depthCompare: string;
        stencilFront: { compare: string; passOp: string };
        stencilWriteMask: number;
      };
    };
    expect(mask.fragment.targets[0]?.writeMask).toBe(0);
    expect(mask.depthStencil.depthWriteEnabled).toBe(false);
    expect(mask.depthStencil.depthCompare).toBe("always");
    expect(mask.depthStencil.stencilFront.compare).toBe("always");
    expect(mask.depthStencil.stencilFront.passOp).toBe("replace");
    expect(mask.depthStencil.stencilWriteMask).toBe(1);

    const content = pipelineDescriptor(harness.gpu, "|s:equal,1,0,") as {
      depthStencil: {
        stencilFront: { compare: string; passOp: string };
        stencilReadMask: number;
        stencilWriteMask: number;
      };
    };
    expect(content.depthStencil.stencilFront.compare).toBe("equal");
    expect(content.depthStencil.stencilFront.passOp).toBe("keep");
    expect(content.depthStencil.stencilReadMask).toBe(1);
    expect(content.depthStencil.stencilWriteMask).toBe(0);

    // The mask's reference is bit 1, the content's test is the same value —
    // one recorded pass command serves both.
    expect(stencilReferences(harness.gpu)).toEqual([1]);
  });

  it("intersects nested clips through the accumulated planes", () => {
    const root = createRoot();
    const outer = renderable(triangle());
    outer.clip = true;
    const inner = renderable(triangle());
    inner.clip = true;
    inner.add(renderable(triangle(), new TestMaterial([0, 1, 0, 1])));
    outer.add(inner);
    root.add(outer);
    harness.renderer.render(root, [createView()]);

    // Masks 1 and 2 first; the outer's own item resets nothing (unclipped);
    // the inner's own item tests the outer's plane (1); the leaf tests the
    // conjunction (3).
    expect(stencilReferences(harness.gpu)).toEqual([1, 2, 1, 3]);
  });

  it("lets the engine's clip record outrank the material's own §57 stencil", () => {
    const root = createRoot();
    const panel = renderable(triangle());
    panel.clip = true;
    const child = renderable(triangle());
    (child.material as unknown as TestMaterial).stencil = { func: "never" };
    panel.add(child);
    root.add(panel);
    harness.renderer.render(root, [createView()]);

    const transcript = harness.gpu.transcript().join("\n");
    expect(transcript).toContain('"compare":"equal"');
    expect(transcript).not.toContain('"compare":"never"');
  });

  it("applies a material's own stencil beside a clip, defaults filled in", () => {
    const root = createRoot();
    const panel = renderable(triangle());
    panel.clip = true;
    panel.add(renderable(triangle()));
    root.add(panel);
    // Two unclipped siblings composing R-7's mask by hand, with *partial*
    // structural records: every missing field takes §57's documented default
    // — `always`, masks `0xff`, ops `keep`, and a missing `ref` reads 0.
    const byHand = new TestMaterial();
    byHand.stencil = { ref: 5 };
    root.add(renderable(triangle(), byHand));
    const refless = new TestMaterial();
    refless.stencil = {};
    root.add(renderable(triangle(), refless));
    harness.renderer.render(root, [createView()]);

    const transcript = harness.gpu.transcript().join("\n");
    expect(transcript).toContain('"stencilWriteMask":255');
    // Mask (1), the by-hand ref (5), then back to 0 for the record naming
    // none.
    expect(stencilReferences(harness.gpu)).toEqual([1, 5, 0]);
  });

  it("applies a material stencil on a clipless frame — R-7's tier, WP-R1.7", () => {
    const root = createRoot();
    const byHand = new TestMaterial();
    byHand.stencil = { func: "never", ref: 3 };
    root.add(renderable(triangle(), byHand));
    harness.renderer.render(root, [createView()]);

    // R1.3's recorded residue, retired: the frame scan finds the material
    // stencil, so the clipless frame allocates the stencil-carrying format,
    // clears its planes per view, and bakes the test into the pipeline — no
    // clip and no renderer option required (`wgpu-stencil.ts`).
    const transcript = harness.gpu.transcript().join("\n");
    expect(transcript).toContain("depth24plus-stencil8");
    expect(transcript).toContain('"stencilLoadOp":"load"');
    expect(transcript).toContain('"compare":"never"');
    expect(stencilReferences(harness.gpu)).toEqual([3]);
  });

  it("keeps a clipless off-screen frame's material stencil inert without the target option", () => {
    // Off screen the attachment is fixed at allocation, so the answer stays
    // the target's `stencil` option — GL's `stencilAttached`, exactly: a
    // plain target leaves R-7's record inert, a stencilled one applies it.
    const root = createRoot();
    const byHand = new TestMaterial();
    byHand.stencil = { func: "equal" };
    root.add(renderable(triangle(), byHand));
    const plain = new RenderTarget({ width: 32, height: 32 });
    harness.renderer.render(root, [createView()], undefined, plain);
    const transcript = harness.gpu.transcript().join("\n");
    expect(transcript).not.toContain("stencilFront");

    harness.gpu.reset();
    const stencilled = new RenderTarget({
      width: 32,
      height: 32,
      stencil: true,
    });
    harness.renderer.render(root, [createView()], undefined, stencilled);
    expect(harness.gpu.transcript().join("\n")).toContain('"compare":"equal"');
  });

  it("tests a clipped sprite against its clip's planes", () => {
    const root = createRoot();
    const panel = renderable(triangle());
    panel.clip = true;
    panel.add(new SpriteNode(texturedTriangle(), new TestSpriteMaterial()));
    root.add(panel);
    harness.renderer.render(root, [createView()]);

    const label = pipelineLabels(harness.gpu).find((candidate) =>
      candidate.startsWith("fourJS:sprite|"),
    );
    expect(label).toContain("|s:equal,1,0,");
    expect(stencilReferences(harness.gpu)).toEqual([1]);
  });

  it("clips a sprite subtree — the mask is coverage, not shading", () => {
    const root = createRoot();
    const panel = new SpriteNode(texturedTriangle(), new TestSpriteMaterial());
    panel.clip = true;
    panel.add(renderable(triangle()));
    root.add(panel);
    harness.renderer.render(root, [createView()]);

    // The sprite's mask draws through the flat unlit pipeline (one vertex
    // buffer, no texture bind), then the sprite's own item draws textured.
    const mask = pipelineDescriptor(harness.gpu, "|s:always,255,1,") as {
      vertex: { buffers: unknown[] };
    };
    expect(mask.vertex.buffers).toHaveLength(1);
    expect(
      pipelineLabels(harness.gpu).some((label) =>
        label.startsWith("fourJS:sprite|"),
      ),
    ).toBe(true);
    expect(stencilReferences(harness.gpu)).toEqual([1]);
  });

  it("draws the masks again in every view — a stencil buffer is per surface", () => {
    harness.renderer.render(clippedScene(), [
      createView({ id: "a", width: 0.5 }),
      createView({ id: "b", x: 0.5, width: 0.5 }),
    ]);
    // Each view: clear, mask, panel, child.
    expect(harness.gpu.countOf("pass.draw")).toBe(8);
    // The reference returns to the mask bit at the second view's mask: the
    // pass command survives across views, so the mirror re-issues only on
    // change — [mask 1, content 1] twice collapses to one call.
    expect(stencilReferences(harness.gpu)).toEqual([1]);
  });

  it("reallocates the depth attachment when a scene stops clipping", () => {
    harness.renderer.render(clippedScene(), [createView()]);
    const clipless = createRoot();
    clipless.add(renderable(triangle()));
    harness.renderer.render(clipless, [createView()]);

    const formats = harness.gpu
      .callsOf("device.createTexture")
      .map((call) => (call.args[0] as { format: string }).format);
    expect(formats).toEqual(["depth24plus-stencil8", "depth24plus"]);
    expect(harness.gpu.countOf("texture.destroy")).toBe(1);
  });

  it("counts mask draws in §84's statistics, like the GL backend", () => {
    const statistics = createRenderStatistics();
    harness.renderer.statistics = statistics;
    harness.renderer.render(clippedScene(), [createView()]);
    // Mask, panel, child — the clear stays the backend's own.
    expect(statistics.drawCalls).toBe(3);
  });

  it("draws an indexed clip node's mask through drawIndexed", () => {
    const root = createRoot();
    const panel = renderable(
      new TestGeometry(
        new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
        new Uint16Array([0, 1, 2]),
      ),
    );
    panel.clip = true;
    panel.add(renderable(triangle()));
    root.add(panel);
    harness.renderer.render(root, [createView()]);
    // The mask and the panel's own item share the indexed geometry.
    expect(harness.gpu.countOf("pass.drawIndexed")).toBe(2);
  });
});

describe("WebgpuRenderer batching (§65, WP-R1.3)", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await initialized();
  });

  /** Two triangles over one shared material — the smallest §65 run. */
  function batchableScene(
    material = new TestMaterial([0, 0, 1, 1]),
  ): Renderable {
    const root = createRoot();
    root.add(renderable(triangle(), material));
    root.add(renderable(triangle(), material));
    return root;
  }

  it("merges a run into one drawIndexed through the batch pipeline", () => {
    harness.renderer.batching = createWgpuBatching();
    harness.renderer.render(batchableScene(), [createView()]);

    // The clear, then one merged draw for both triangles.
    expect(harness.gpu.countOf("pass.draw")).toBe(1);
    expect(harness.gpu.countOf("pass.drawIndexed")).toBe(1);
    expect(harness.gpu.callsOf("pass.drawIndexed")[0]?.args[0]).toBe(6);
    expect(harness.gpu.callsOf("pass.setIndexBuffer")[0]?.args[1]).toBe(
      "uint32",
    );
    expect(
      pipelineLabels(harness.gpu).some((label) =>
        label.startsWith("fourJS:batch|"),
      ),
    ).toBe(true);
    // The per-item geometry is never uploaded: the run draws from the
    // uploader's own two buffers.
    expect(harness.gpu.countOf("device.createBuffer")).toBe(2);
  });

  it("uploads the identity model and the shared colour for the run", () => {
    harness.renderer.batching = createWgpuBatching();
    const material = new TestMaterial([0, 0.5, 1, 1]);
    material.opacity = 0.5;
    harness.renderer.render(batchableScene(material), [createView()]);

    const data = uniformUpload(harness.gpu);
    const stride = UNIFORM_STRIDE_BYTES / 4;
    const model = stride + DRAW_MODEL_OFFSET / 4;
    expect(data[model]).toBe(1);
    expect(data[model + 5]).toBe(1);
    expect(data[model + 12]).toBe(0);
    const color = stride + DRAW_COLOR_OFFSET / 4;
    expect(data.slice(color, color + 3)).toEqual([0, 0.5, 1]);
    expect(data[color + 3]).toBeCloseTo(0.5);
  });

  it("records the identical frame when the batcher finds nothing to merge", async () => {
    // One scene object, rendered by both renderers, so the geometry ids in
    // the recorded upload labels are the same on both tapes.
    const root = createRoot();
    root.add(renderable(triangle(), new TestMaterial([1, 0, 0, 1])));
    root.add(renderable(triangle(), new TestMaterial([0, 1, 0, 1])));
    harness.renderer.batching = createWgpuBatching();
    harness.renderer.render(root, [createView()]);
    const withBatcher = harness.gpu.transcript();

    const plain = await initialized();
    plain.renderer.render(root, [createView()]);
    expect(withBatcher).toEqual(plain.gpu.transcript());
  });

  it("reuses each slot's buffers across frames", () => {
    harness.renderer.batching = createWgpuBatching();
    const root = batchableScene();
    harness.renderer.render(root, [createView()]);
    harness.gpu.reset();
    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.countOf("device.createBuffer")).toBe(0);
    // Uniforms still rewrite every frame; the slot's vertex and index
    // streams skip (`contentVersion` unchanged — the still-scene row).
    expect(harness.gpu.countOf("queue.writeBuffer")).toBe(1);
  });

  it("merges a sprite run, tinted and textured at group 1", () => {
    harness.renderer.batching = createWgpuBatching();
    const material = new TestSpriteMaterial(new TestTexture(), [1, 0, 1, 1]);
    const root = createRoot();
    root.add(new SpriteNode(triangle(), material));
    root.add(new SpriteNode(triangle(), material));
    harness.renderer.render(root, [createView()]);

    expect(harness.gpu.countOf("pass.drawIndexed")).toBe(1);
    const label = pipelineLabels(harness.gpu).find((candidate) =>
      candidate.startsWith("fourJS:batch|"),
    );
    expect(label).toContain("|map|");
    const groups = harness.gpu
      .callsOf("pass.setBindGroup")
      .map((call) => call.args[0]);
    expect(groups).toContain(1);
    const data = uniformUpload(harness.gpu);
    const color = UNIFORM_STRIDE_BYTES / 4 + DRAW_COLOR_OFFSET / 4;
    expect(data.slice(color, color + 4)).toEqual([1, 0, 1, 1]);
  });

  it("skips a sprite run whose texture will not resolve, whole", () => {
    harness.renderer.batching = createWgpuBatching();
    const material = new TestSpriteMaterial();
    material.texture?.dispose();
    const root = createRoot();
    root.add(new SpriteNode(triangle(), material));
    root.add(new SpriteNode(triangle(), material));
    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.countOf("pass.drawIndexed")).toBe(0);
    expect(harness.gpu.countOf("pass.draw")).toBe(1);
  });

  it("merges a lines run under the line-list topology", () => {
    harness.renderer.batching = createWgpuBatching();
    const statistics = createRenderStatistics();
    harness.renderer.statistics = statistics;
    const material = new TestMaterial();
    const segment = (): TestGeometry =>
      new TestGeometry(
        new Float32Array([-0.5, 0, 0, 0.5, 0, 0]),
        undefined,
        "lines",
      );
    const root = createRoot();
    root.add(renderable(segment(), material));
    root.add(renderable(segment(), material));
    harness.renderer.render(root, [createView()]);

    expect(harness.gpu.countOf("pass.drawIndexed")).toBe(1);
    const label = pipelineLabels(harness.gpu).find((candidate) =>
      candidate.startsWith("fourJS:batch|"),
    );
    expect(label).toContain("line-list");
    expect(statistics.drawCalls).toBe(1);
    expect(statistics.triangles).toBe(0);
  });

  it("carries the run's clip record onto the merged draw (§67)", () => {
    harness.renderer.batching = createWgpuBatching();
    const material = new TestMaterial([1, 1, 0, 1]);
    const root = createRoot();
    const panel = renderable(triangle());
    panel.clip = true;
    panel.add(renderable(triangle(), material));
    panel.add(renderable(triangle(), material));
    root.add(panel);
    harness.renderer.render(root, [createView()]);

    expect(harness.gpu.countOf("pass.drawIndexed")).toBe(1);
    const label = pipelineLabels(harness.gpu).find((candidate) =>
      candidate.startsWith("fourJS:batch|"),
    );
    expect(label).toContain("|s:equal,1,0,");
    expect(stencilReferences(harness.gpu)).toEqual([1]);
  });

  it("leaves an unclipped run stencil-free on a frame that clips elsewhere", () => {
    harness.renderer.batching = createWgpuBatching();
    const material = new TestMaterial([0, 1, 1, 1]);
    const root = createRoot();
    const panel = renderable(triangle());
    panel.clip = true;
    panel.add(renderable(triangle()));
    root.add(panel);
    root.add(renderable(triangle(), material));
    root.add(renderable(triangle(), material));
    harness.renderer.render(root, [createView()]);

    const label = pipelineLabels(harness.gpu).find((candidate) =>
      candidate.startsWith("fourJS:batch|"),
    );
    // Stencil-capable format, no stencil segment: the run tests nothing.
    expect(label).toContain("depth24plus-stencil8");
    expect(label).not.toContain("|s:");
  });

  it("counts one §84 draw call for the whole run", () => {
    harness.renderer.batching = createWgpuBatching();
    const statistics = createRenderStatistics();
    harness.renderer.statistics = statistics;
    harness.renderer.render(batchableScene(), [createView()]);
    expect(statistics.drawCalls).toBe(1);
    expect(statistics.triangles).toBe(2);
  });

  it("survives a reentrant dispose mid-frame, skipping every remaining draw", () => {
    // `updateViewMatrix` is application code running inside the frame; §61
    // forbids the frame to throw whatever it does — including tearing the
    // renderer down. Every cache then answers null and every draw is skipped,
    // which is the invariant the "unreachable" narrowings in the draw paths
    // actually encode.
    harness.renderer.batching = createWgpuBatching();
    const root = batchableScene();
    const camera = new TestCamera();
    camera.updateViewMatrix = (): void => {
      harness.renderer.dispose();
    };
    expect(() => {
      harness.renderer.render(root, [createView({ camera: camera.asCamera })]);
    }).not.toThrow();
    expect(harness.gpu.countOf("pass.draw")).toBe(0);
    expect(harness.gpu.countOf("pass.drawIndexed")).toBe(0);
  });

  it("destroys the uploader's buffers at dispose, on a live device", () => {
    harness.renderer.batching = createWgpuBatching();
    harness.renderer.render(batchableScene(), [createView()]);
    harness.gpu.reset();
    harness.renderer.dispose();
    // The uniform buffer plus the slot's vertex and index buffers.
    expect(harness.gpu.countOf("buffer.destroy")).toBe(3);
  });

  it("forgets the uploader's buffers on device loss, destroying nothing", async () => {
    harness.renderer.batching = createWgpuBatching();
    harness.renderer.render(batchableScene(), [createView()]);
    harness.gpu.loseDevice();
    await Promise.resolve();
    await Promise.resolve();
    harness.gpu.reset();
    harness.renderer.dispose();
    expect(harness.gpu.countOf("buffer.destroy")).toBe(0);
  });
});

/** §68's ambient carrier: a root that offers `Scene.ambientLight`'s shape. */
class AmbientRoot extends Renderable {
  ambientLight: [number, number, number];

  constructor(ambient: [number, number, number] = [0, 0, 0]) {
    super(
      new TestGeometry(new Float32Array(0)).asGeometry,
      new TestMaterial().asMaterial,
    );
    this.ambientLight = ambient;
  }
}

/** §68's directional light, as the structural contract the collector reads. */
class DirectionalLightNode extends Renderable {
  readonly isDirectionalLight = true;

  color: [number, number, number] = [1, 1, 1];

  intensity = 1;

  direction: [number, number, number] = [0, 0, -1];

  constructor() {
    super(
      new TestGeometry(new Float32Array(0)).asGeometry,
      new TestMaterial().asMaterial,
    );
  }

  getWorldDirection(out: Vector3): Vector3 {
    return out.set(this.direction[0], this.direction[1], this.direction[2]);
  }
}

/** §68's point light, structurally. */
class PointLightNode extends Renderable {
  readonly isPunctualLight = true;

  readonly lightType: "point" | "spot" = "point";

  color: [number, number, number] = [1, 1, 1];

  intensity = 1;

  range = 0;

  worldPosition: [number, number, number] = [0, 0, 0];

  constructor(position: [number, number, number] = [0, 0, 0]) {
    super(
      new TestGeometry(new Float32Array(0)).asGeometry,
      new TestMaterial().asMaterial,
    );
    this.worldPosition = position;
  }

  getWorldPosition(out: Vector3): Vector3 {
    return out.set(
      this.worldPosition[0],
      this.worldPosition[1],
      this.worldPosition[2],
    );
  }
}

/** §68's spot light, structurally. */
class SpotLightNode extends PointLightNode {
  override readonly lightType: "point" | "spot" = "spot";

  innerConeAngle = Math.PI / 8;

  outerConeAngle = Math.PI / 4;

  axis: [number, number, number] = [0, 0, -1];

  getWorldDirection(out: Vector3): Vector3 {
    return out.set(this.axis[0], this.axis[1], this.axis[2]);
  }
}

/** §57's `LitMaterial`, reduced to the state the shaded arm reads (WP-R1.5). */
class TestLitMaterial {
  readonly kind: string = "lit";

  readonly color: [number, number, number, number];

  transparent?: boolean;

  blendMode?: "normal" | "additive" | "multiply" | "screen";

  depthTest?: boolean;

  depthWrite?: boolean;

  colorWrite?: boolean;

  opacity?: number;

  map?: TestTexture | null;

  stencil?: TestStencil;

  constructor(color: [number, number, number, number] = [1, 1, 1, 1]) {
    this.color = color;
  }

  get asMaterial(): ItemMaterial {
    return this as unknown as ItemMaterial;
  }
}

/** §59's `StandardMaterial`, reduced the same way. */
class TestStandardMaterial {
  readonly kind: string = "standard";

  readonly baseColor: [number, number, number, number];

  metalness = 0;

  roughness = 1;

  emissive: [number, number, number] = [0, 0, 0];

  transparent?: boolean;

  blendMode?: "normal" | "additive" | "multiply" | "screen";

  opacity?: number;

  map?: TestTexture | null;

  metalRoughnessMap?: TestTexture | null;

  normalMap?: TestTexture | null;

  occlusionMap?: TestTexture | null;

  emissiveMap?: TestTexture | null;

  normalScale?: number;

  occlusionStrength?: number;

  constructor(baseColor: [number, number, number, number] = [1, 1, 1, 1]) {
    this.baseColor = baseColor;
  }

  get asMaterial(): ItemMaterial {
    return this as unknown as ItemMaterial;
  }
}

/** A triangle carrying the normal stream the shaded variants transform. */
function litTriangle(): TestGeometry {
  const geometry = triangle();
  geometry.normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  return geometry;
}

/** The frame's lights upload — the last `writeBuffer` of a shaded frame. */
function lightsUpload(gpu: RecordingGpu): { floats: number[]; size: number } {
  const uploads = gpu.callsOf("queue.writeBuffer");
  const last = uploads[uploads.length - 1];
  if (last === undefined) {
    throw new Error("the frame uploaded nothing");
  }
  return { floats: last.args[2] as number[], size: last.args[4] as number };
}

/** One vec4 slot of a light block, by block index and byte offset. */
function lightSlot(
  floats: number[],
  block: number,
  byteOffset: number,
): number[] {
  const base = block * LIGHT_UNIFORM_STRIDE_FLOATS + byteOffset / 4;
  return floats.slice(base, base + 4);
}

/** The frame's draw-uniform upload on a shaded frame — second to last. */
function drawUniformUpload(gpu: RecordingGpu): number[] {
  const uploads = gpu.callsOf("queue.writeBuffer");
  const call = uploads[uploads.length - 2];
  if (call === undefined) {
    throw new Error("the frame uploaded no draw uniforms");
  }
  return call.args[2] as number[];
}

/** The labels of every buffer the tape allocated, in order. */
function bufferLabels(gpu: RecordingGpu): string[] {
  return gpu
    .callsOf("device.createBuffer")
    .map((call) => String((call.args[0] as { label?: string }).label));
}

/** The labels of every bind-group layout the tape declared, in order. */
function layoutLabels(gpu: RecordingGpu): string[] {
  return gpu
    .callsOf("device.createBindGroupLayout")
    .map((call) => String((call.args[0] as { label?: string }).label));
}

/** The labels of every WGSL module the tape compiled, in order. */
function moduleLabels(gpu: RecordingGpu): string[] {
  return gpu
    .callsOf("device.createShaderModule")
    .map((call) => String((call.args[0] as { label?: string }).label));
}

/** Every `setBindGroup` at `index`, as its dynamic-offset arrays. */
function bindGroupOffsets(gpu: RecordingGpu, index: number): unknown[] {
  return gpu
    .callsOf("pass.setBindGroup")
    .filter((call) => call.args[0] === index)
    .map((call) => call.args[2]);
}

describe("WebgpuRenderer shading (§68, §59, WP-R1.5)", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await initialized();
  });

  it("records the byte-identical frame for an unshaded scene, normals or not", async () => {
    // The packet's byte-identity claim, made mechanically: the same unlit
    // scene over the same-id geometry — one copy carrying a normal stream,
    // one not — records the identical transcript, because nothing unshaded
    // ever touches normals, lights, or the standard block.
    const render = async (withNormals: boolean): Promise<string[]> => {
      const rig = await initialized();
      const geometry = withNormals ? litTriangle() : triangle();
      (geometry as unknown as { id: string }).id = "shared-identity";
      const root = createRoot();
      root.add(renderable(geometry));
      rig.renderer.render(root, [createView()]);
      return rig.gpu.transcript();
    };
    expect(await render(true)).toEqual(await render(false));
  });

  it("draws a lit item through the lit pipeline with the light block at group 1", () => {
    const root = new AmbientRoot([0.1, 0.2, 0.3]);
    const sun = new DirectionalLightNode();
    sun.color = [1, 0.5, 0.25];
    sun.intensity = 2;
    sun.direction = [0, -1, 0];
    root.add(sun);
    root.add(
      new Renderable(
        litTriangle().asGeometry,
        new TestLitMaterial().asMaterial,
      ),
    );

    harness.renderer.render(root, [createView()]);

    expect(pipelineLabels(harness.gpu)).toContain(
      "fourJS:lit|-|-|none|dt|dw|cw|triangle-list|bgra8unorm|depth24plus|n:y",
    );
    expect(moduleLabels(harness.gpu)).toContain("fourJS:lit|n");
    // The lazy lights subsystem: one layout, one buffer, one bind group.
    expect(
      layoutLabels(harness.gpu).filter((label) => label === "fourJS:lights"),
    ).toHaveLength(1);
    expect(
      bufferLabels(harness.gpu).filter((label) => label === "fourJS:lights"),
    ).toHaveLength(1);
    // The normal stream uploaded for the shaded draw, in GL's order.
    expect(
      bufferLabels(harness.gpu).some((label) =>
        label.startsWith("fourJS:normals:"),
      ),
    ).toBe(true);
    // The draw binds the view's block at group 1, offset 0.
    expect(bindGroupOffsets(harness.gpu, 1)).toEqual([[0]]);

    // The block's contents: ambient, direction, premultiplied colour, count.
    const { floats, size } = lightsUpload(harness.gpu);
    expect(size).toBe(LIGHT_UNIFORM_STRIDE_FLOATS);
    expect(lightSlot(floats, 0, LIGHT_AMBIENT_OFFSET)).toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
      Math.fround(0.3),
      0,
    ]);
    expect(lightSlot(floats, 0, LIGHT_DIRECTION_OFFSET)).toEqual([0, -1, 0, 0]);
    expect(lightSlot(floats, 0, LIGHT_COLOR_OFFSET)).toEqual([2, 1, 0.5, 0]);
    expect(lightSlot(floats, 0, LIGHT_COUNTS_OFFSET)).toEqual([0, 0, 0, 0]);
  });

  it("shades a normal-less geometry through the normal-less variant", () => {
    const root = createRoot();
    root.add(
      new Renderable(triangle().asGeometry, new TestLitMaterial().asMaterial),
    );
    harness.renderer.render(root, [createView()]);

    expect(moduleLabels(harness.gpu)).toContain("fourJS:lit");
    expect(
      pipelineLabels(harness.gpu).some((label) => label.endsWith("|n:-")),
    ).toBe(true);
    expect(
      bufferLabels(harness.gpu).some((label) =>
        label.startsWith("fourJS:normals:"),
      ),
    ).toBe(false);
    // One vertex buffer bound: position alone, slot 0.
    expect(harness.gpu.countOf("pass.setVertexBuffer")).toBe(1);
  });

  it("samples §57's map at group 2 over the uv stream", () => {
    const root = createRoot();
    const geometry = litTriangle();
    geometry.uvs = new Float32Array([0, 0, 1, 0, 0.5, 1]);
    const material = new TestLitMaterial();
    material.map = new TestTexture();
    root.add(new Renderable(geometry.asGeometry, material.asMaterial));

    harness.renderer.render(root, [createView()]);

    expect(moduleLabels(harness.gpu)).toContain("fourJS:lit|n|map");
    // position, normal, uv — three slots, one counter.
    expect(
      harness.gpu.callsOf("pass.setVertexBuffer").map((call) => call.args[0]),
    ).toEqual([0, 1, 2]);
    // The texture rides group 2 on the shaded families; group 1 is lights.
    expect(bindGroupOffsets(harness.gpu, 2)).toHaveLength(1);
    expect(mapAllocations(harness.gpu)).toBe(1);
  });

  it("skips a lit draw whose named texture will not resolve (§83)", () => {
    const root = createRoot();
    const geometry = litTriangle();
    geometry.uvs = new Float32Array([0, 0, 1, 0, 0.5, 1]);
    const material = new TestLitMaterial();
    material.map = new TestTexture();
    material.map.dispose();
    root.add(new Renderable(geometry.asGeometry, material.asMaterial));

    harness.renderer.render(root, [createView()]);
    // The clear alone drew.
    expect(harness.gpu.countOf("pass.draw")).toBe(1);
  });

  it("degrades a mapped lit draw without uvs to the untextured variant", () => {
    const root = createRoot();
    const material = new TestLitMaterial();
    material.map = new TestTexture();
    root.add(new Renderable(litTriangle().asGeometry, material.asMaterial));

    harness.renderer.render(root, [createView()]);
    expect(moduleLabels(harness.gpu)).toContain("fourJS:lit|n");
    expect(mapAllocations(harness.gpu)).toBe(0);
    expect(harness.gpu.countOf("pass.draw")).toBe(2);
  });

  it("carries §57's state and opacity into the lit pipeline and block", () => {
    const root = createRoot();
    const material = new TestLitMaterial([0.5, 0.25, 0.125, 0.8]);
    material.transparent = true;
    material.blendMode = "additive";
    material.depthWrite = false;
    material.opacity = 0.5;
    root.add(new Renderable(litTriangle().asGeometry, material.asMaterial));

    harness.renderer.render(root, [createView()]);
    expect(pipelineLabels(harness.gpu)).toContain(
      "fourJS:lit|-|-|additive|dt|-|cw|triangle-list|bgra8unorm|depth24plus|n:y",
    );
    const floats = drawUniformUpload(harness.gpu);
    const colorBase = UNIFORM_STRIDE_BYTES / 4 + DRAW_COLOR_OFFSET / 4;
    expect(floats.slice(colorBase, colorBase + 4)).toEqual([
      0.5,
      0.25,
      0.125,
      Math.fround(0.8 * 0.5),
    ]);
  });

  it("packs a scaled model's inverse-transpose into the padded mat3 slot", () => {
    const root = createRoot();
    const mesh = new Renderable(
      litTriangle().asGeometry,
      new TestLitMaterial().asMaterial,
    );
    // Scale (2, 4, 8): inverse-transpose is the reciprocal diagonal. Translation
    // does not participate. Column-major, matching `Matrix3.setNormalFromMatrix4`.
    // Culling off so the scaled triangle is not dropped by an identity frustum.
    mesh.frustumCulled = false;
    mesh.transform.worldMatrix.fromArray([
      2, 0, 0, 0, 0, 4, 0, 0, 0, 0, 8, 0, 1, 2, 3, 1,
    ]);
    root.add(mesh);

    harness.renderer.render(root, [createView()]);
    const floats = drawUniformUpload(harness.gpu);
    const base = UNIFORM_STRIDE_BYTES / 4;
    expect(
      floats.slice(
        base + DRAW_NORMAL_OFFSET / 4,
        base + DRAW_NORMAL_OFFSET / 4 + 12,
      ),
    ).toEqual([0.5, 0, 0, 0, 0, 0.25, 0, 0, 0, 0, 0.125, 0]);
  });

  it("draws a standard item through the widened block and its own group 0", () => {
    const root = createRoot();
    const material = new TestStandardMaterial([0.5, 0.25, 0.125, 1]);
    material.metalness = 0.75;
    material.roughness = 0.3;
    material.emissive = [0.01, 0.02, 0.03];
    root.add(new Renderable(litTriangle().asGeometry, material.asMaterial));
    const view = createView();
    const camera = view.camera as unknown as TestCamera;
    camera.transform.worldMatrix.elements[12] = 1;
    camera.transform.worldMatrix.elements[13] = 2;
    camera.transform.worldMatrix.elements[14] = 3;

    harness.renderer.render(root, [view]);

    expect(moduleLabels(harness.gpu)).toContain("fourJS:standard|n");
    expect(
      layoutLabels(harness.gpu).filter(
        (label) => label === "fourJS:standard-uniforms",
      ),
    ).toHaveLength(1);
    // §59's two extra vec4s, in the block's spare stride bytes.
    const floats = drawUniformUpload(harness.gpu);
    const base = UNIFORM_STRIDE_BYTES / 4;
    expect(floats.slice(base + 32, base + 36)).toEqual([0.5, 0.25, 0.125, 1]);
    expect(
      floats.slice(
        base + STANDARD_EMISSIVE_OFFSET / 4,
        base + STANDARD_EMISSIVE_OFFSET / 4 + 4,
      ),
    ).toEqual([Math.fround(0.01), Math.fround(0.02), Math.fround(0.03), 0]);
    expect(
      floats.slice(
        base + STANDARD_SURFACE_OFFSET / 4,
        base + STANDARD_SURFACE_OFFSET / 4 + 4,
      ),
    ).toEqual([0.75, Math.fround(0.3), 0, 0]);
    // Identity model → identity normal matrix in the padded mat3x3 slot.
    expect(
      floats.slice(
        base + DRAW_NORMAL_OFFSET / 4,
        base + DRAW_NORMAL_OFFSET / 4 + 12,
      ),
    ).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    // The eye rides the light block, for the specular lobe.
    const { floats: lightFloats } = lightsUpload(harness.gpu);
    expect(lightSlot(lightFloats, 0, LIGHT_CAMERA_OFFSET)).toEqual([
      1, 2, 3, 0,
    ]);
    // Scalar-only: no `|mr:y` key, no group-3 bind, no extra layout.
    expect(
      pipelineLabels(harness.gpu).some((label) => label.includes("|mr:y")),
    ).toBe(false);
    expect(bindGroupOffsets(harness.gpu, 3)).toEqual([]);
    expect(
      layoutLabels(harness.gpu).some((label) =>
        label.includes("pipeline-layout:standard:mr"),
      ),
    ).toBe(false);
  });

  it("samples an mr-only standard map at group 2", () => {
    const root = createRoot();
    const geometry = litTriangle();
    geometry.uvs = new Float32Array([0, 0, 1, 0, 0.5, 1]);
    const material = new TestStandardMaterial();
    material.metalRoughnessMap = new TestTexture();
    root.add(new Renderable(geometry.asGeometry, material.asMaterial));

    harness.renderer.render(root, [createView()]);

    expect(moduleLabels(harness.gpu)).toContain("fourJS:standard|n|mr");
    expect(
      pipelineLabels(harness.gpu).some((label) => label.endsWith("|mr:y")),
    ).toBe(true);
    expect(bindGroupOffsets(harness.gpu, 2)).toHaveLength(1);
    expect(bindGroupOffsets(harness.gpu, 3)).toEqual([]);
    expect(mapAllocations(harness.gpu)).toBe(1);
    const code = harness.gpu
      .callsOf("device.createShaderModule")
      .map((call) => call.args[0] as { label?: string; code: string })
      .find((module) => module.label === "fourJS:standard|n|mr")?.code;
    expect(code).toContain("textureSample(mrTexture, mrSampler, input.uv)");
    expect(code).not.toContain("textureSample(mapTexture, mapSampler");
  });

  it("samples albedo at group 2 and metal-roughness at group 3", () => {
    const root = createRoot();
    const geometry = litTriangle();
    geometry.uvs = new Float32Array([0, 0, 1, 0, 0.5, 1]);
    const material = new TestStandardMaterial();
    material.map = new TestTexture();
    material.metalRoughnessMap = new TestTexture();
    root.add(new Renderable(geometry.asGeometry, material.asMaterial));

    harness.renderer.render(root, [createView()]);

    expect(moduleLabels(harness.gpu)).toContain("fourJS:standard|n|map|mr");
    expect(
      pipelineLabels(harness.gpu).some(
        (label) => label.includes("|map|") && label.endsWith("|mr:y"),
      ),
    ).toBe(true);
    expect(bindGroupOffsets(harness.gpu, 2)).toHaveLength(1);
    expect(bindGroupOffsets(harness.gpu, 3)).toHaveLength(1);
    expect(mapAllocations(harness.gpu)).toBe(2);
    const code = harness.gpu
      .callsOf("device.createShaderModule")
      .map((call) => call.args[0] as { label?: string; code: string })
      .find((module) => module.label === "fourJS:standard|n|map|mr")?.code;
    expect(code).toContain("textureSample(mapTexture, mapSampler, input.uv)");
    expect(code).toContain("textureSample(mrTexture, mrSampler, input.uv)");
  });

  it("skips a standard draw whose named metal-roughness map will not resolve (§83)", () => {
    const root = createRoot();
    const geometry = litTriangle();
    geometry.uvs = new Float32Array([0, 0, 1, 0, 0.5, 1]);
    const material = new TestStandardMaterial();
    material.metalRoughnessMap = new TestTexture();
    material.metalRoughnessMap.dispose();
    root.add(new Renderable(geometry.asGeometry, material.asMaterial));

    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.countOf("pass.draw")).toBe(1);
    expect(
      moduleLabels(harness.gpu).some((label) => label.includes("standard")),
    ).toBe(false);
  });

  it("degrades a metal-roughness standard draw without uvs to the scalar variant", () => {
    const root = createRoot();
    const material = new TestStandardMaterial();
    material.metalRoughnessMap = new TestTexture();
    root.add(new Renderable(litTriangle().asGeometry, material.asMaterial));

    harness.renderer.render(root, [createView()]);
    expect(moduleLabels(harness.gpu)).toContain("fourJS:standard|n");
    expect(
      pipelineLabels(harness.gpu).some((label) => label.includes("|mr:y")),
    ).toBe(false);
    expect(mapAllocations(harness.gpu)).toBe(0);
    expect(harness.gpu.countOf("pass.draw")).toBe(2);
  });

  it("packs the punctual set exactly as the GL backend selects it (§68, §84)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const root = createRoot();
      for (let index = 0; index < 9; index += 1) {
        const light = new PointLightNode([index + 1, 0, 0]);
        light.color = [1, 0, 0];
        light.intensity = 2;
        light.range = 20;
        root.add(light);
      }
      const spot = new SpotLightNode([0, 5, 0]);
      spot.range = 10;
      root.add(spot);
      root.add(
        new Renderable(
          litTriangle().asGeometry,
          new TestLitMaterial().asMaterial,
        ),
      );

      harness.renderer.render(root, [createView()]);

      const { floats } = lightsUpload(harness.gpu);
      // Nine points and a spot arrived; the first eight in scene order win —
      // the spot, tenth, is dropped with the ninth point (the GL rule).
      expect(lightSlot(floats, 0, LIGHT_COUNTS_OFFSET)).toEqual([8, 0, 0, 0]);
      expect(lightSlot(floats, 0, LIGHT_PUNCTUAL_POSITION_OFFSET)).toEqual([
        1, 0, 0, 0,
      ]);
      expect(
        lightSlot(floats, 0, LIGHT_PUNCTUAL_POSITION_OFFSET + 7 * 16),
      ).toEqual([8, 0, 0, 0]);
      expect(lightSlot(floats, 0, LIGHT_PUNCTUAL_COLOR_OFFSET)).toEqual([
        2, 0, 0, 0,
      ]);
      expect(lightSlot(floats, 0, LIGHT_PUNCTUAL_PARAMS_OFFSET)).toEqual([
        20, 0, 0, 0,
      ]);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("packs a spot light's cone the way `SceneLights` precomputes it", () => {
    const root = createRoot();
    const spot = new SpotLightNode([0, 5, 0]);
    spot.color = [0, 1, 0];
    spot.intensity = 3;
    spot.range = 10;
    spot.axis = [0, -1, 0];
    root.add(spot);
    root.add(
      new Renderable(
        litTriangle().asGeometry,
        new TestLitMaterial().asMaterial,
      ),
    );

    harness.renderer.render(root, [createView()]);
    const { floats } = lightsUpload(harness.gpu);
    expect(lightSlot(floats, 0, LIGHT_COUNTS_OFFSET)).toEqual([1, 0, 0, 0]);
    expect(lightSlot(floats, 0, LIGHT_PUNCTUAL_DIRECTION_OFFSET)).toEqual([
      0, -1, 0, 0,
    ]);
    const params = lightSlot(floats, 0, LIGHT_PUNCTUAL_PARAMS_OFFSET);
    expect(params[0]).toBe(10);
    expect(params[1]).toBeCloseTo(Math.cos(Math.PI / 4), 5);
    expect(params[2]).toBeCloseTo(
      1 / (Math.cos(Math.PI / 8) - Math.cos(Math.PI / 4)),
      4,
    );
    expect(params[3]).toBe(1);
  });

  it("writes one light block per rendered view, at strided offsets", () => {
    const root = createRoot();
    root.add(
      new Renderable(
        litTriangle().asGeometry,
        new TestLitMaterial().asMaterial,
      ),
    );
    const first = createView();
    const second = createView();
    const camera = second.camera as unknown as TestCamera;
    camera.transform.worldMatrix.elements[12] = 5;
    camera.transform.worldMatrix.elements[13] = 6;
    camera.transform.worldMatrix.elements[14] = 7;

    harness.renderer.render(root, [first, second]);

    expect(bindGroupOffsets(harness.gpu, 1)).toEqual([
      [0],
      [LIGHT_UNIFORM_STRIDE_BYTES],
    ]);
    const { floats, size } = lightsUpload(harness.gpu);
    expect(size).toBe(2 * LIGHT_UNIFORM_STRIDE_FLOATS);
    expect(lightSlot(floats, 0, LIGHT_CAMERA_OFFSET)).toEqual([0, 0, 0, 0]);
    expect(lightSlot(floats, 1, LIGHT_CAMERA_OFFSET)).toEqual([5, 6, 7, 0]);
  });

  it("leaves no gap for a zero-area view's light block", () => {
    const root = createRoot();
    root.add(
      new Renderable(
        litTriangle().asGeometry,
        new TestLitMaterial().asMaterial,
      ),
    );
    harness.renderer.render(root, [createView({ width: 0 }), createView()]);
    expect(bindGroupOffsets(harness.gpu, 1)).toEqual([[0]]);
    expect(lightsUpload(harness.gpu).size).toBe(LIGHT_UNIFORM_STRIDE_FLOATS);
  });

  it("reuses the lights buffer across frames and grows it for more views", () => {
    const root = createRoot();
    root.add(
      new Renderable(
        litTriangle().asGeometry,
        new TestLitMaterial().asMaterial,
      ),
    );
    harness.renderer.render(root, [createView()]);
    harness.renderer.render(root, [createView()]);
    expect(
      bufferLabels(harness.gpu).filter((label) => label === "fourJS:lights"),
    ).toHaveLength(1);

    // A fifth view exceeds the four-block floor: the buffer regrows once and
    // the old allocation is destroyed.
    const views = [
      createView(),
      createView(),
      createView(),
      createView(),
      createView(),
    ];
    harness.renderer.render(root, views);
    expect(
      bufferLabels(harness.gpu).filter((label) => label === "fourJS:lights"),
    ).toHaveLength(2);
    expect(lightsUpload(harness.gpu).size).toBe(
      5 * LIGHT_UNIFORM_STRIDE_FLOATS,
    );
  });

  it("recreates the standard bind group after a uniform regrowth", () => {
    const standardScene = (count: number): Renderable => {
      const root = createRoot();
      for (let index = 0; index < count; index += 1) {
        root.add(
          new Renderable(
            litTriangle().asGeometry,
            new TestStandardMaterial().asMaterial,
          ),
        );
      }
      return root;
    };
    harness.renderer.render(standardScene(1), [createView()]);
    // 21 blocks exceed the 16-block floor: the buffer regrows, the standard
    // bind group pointed at the destroyed buffer, and the next standard draw
    // recreates it.
    harness.renderer.render(standardScene(20), [createView()]);
    const standardGroups = harness.gpu
      .callsOf("device.createBindGroup")
      .filter(
        (call) =>
          (call.args[0] as { label?: string }).label ===
          "fourJS:standard-uniforms",
      );
    expect(standardGroups).toHaveLength(2);
  });

  it("survives a reentrant dispose inside a material accessor (§61)", () => {
    const root = createRoot();
    const material = new TestLitMaterial();
    let dispose: () => void = () => undefined;
    Object.defineProperty(material, "map", {
      get: (): null => {
        dispose();
        return null;
      },
    });
    root.add(new Renderable(litTriangle().asGeometry, material.asMaterial));
    dispose = (): void => {
      harness.renderer.dispose();
    };

    expect(() => {
      harness.renderer.render(root, [createView()]);
    }).not.toThrow();
    // The clear drew; the lit draw — and the lights upload — were skipped.
    expect(harness.gpu.countOf("pass.draw")).toBe(1);
    expect(harness.renderer.disposed).toBe(true);
  });

  it("survives a reentrant dispose inside a stencil accessor on a clipping frame", () => {
    const root = createRoot();
    const panel = renderable(triangle());
    panel.clip = true;
    panel.add(renderable(triangle()));
    root.add(panel);
    const material = new TestLitMaterial();
    let dispose: () => void = () => undefined;
    Object.defineProperty(material, "stencil", {
      get: (): undefined => {
        dispose();
        return undefined;
      },
    });
    root.add(new Renderable(litTriangle().asGeometry, material.asMaterial));
    dispose = (): void => {
      harness.renderer.dispose();
    };

    expect(() => {
      harness.renderer.render(root, [createView()]);
    }).not.toThrow();
    // The lit pipeline was never created: the cache was disposed by the time
    // the arm asked it.
    expect(
      pipelineLabels(harness.gpu).some((label) => label.includes("fourJS:lit")),
    ).toBe(false);
    expect(harness.renderer.disposed).toBe(true);
  });

  it("bakes §67's clip into a shaded pipeline and sets its reference", () => {
    const root = createRoot();
    const panel = renderable(triangle());
    panel.clip = true;
    panel.add(
      new Renderable(
        litTriangle().asGeometry,
        new TestLitMaterial().asMaterial,
      ),
    );
    root.add(panel);

    harness.renderer.render(root, [createView()]);
    const clippedLit = pipelineLabels(harness.gpu).find(
      (label) => label.includes("fourJS:lit") && label.includes("|s:equal"),
    );
    expect(clippedLit).toBeDefined();
    expect(clippedLit).toContain("|n:y");
    expect(stencilReferences(harness.gpu).length).toBeGreaterThan(0);
  });

  it("blends a transparent lit draw with the normal mode by default", () => {
    const root = createRoot();
    const material = new TestLitMaterial();
    material.transparent = true;
    root.add(new Renderable(litTriangle().asGeometry, material.asMaterial));
    harness.renderer.render(root, [createView()]);
    expect(pipelineLabels(harness.gpu)).toContain(
      "fourJS:lit|-|-|normal|dt|dw|cw|triangle-list|bgra8unorm|depth24plus|n:y",
    );
  });

  it("draws an indexed lit geometry through drawIndexed and counts §84", () => {
    const root = createRoot();
    const geometry = new TestGeometry(
      new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
      new Uint16Array([0, 1, 2]),
    );
    geometry.normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    root.add(
      new Renderable(geometry.asGeometry, new TestLitMaterial().asMaterial),
    );
    const statistics = createRenderStatistics();
    harness.renderer.statistics = statistics;

    harness.renderer.render(root, [createView()]);
    expect(harness.gpu.countOf("pass.drawIndexed")).toBe(1);
    expect(statistics.drawCalls).toBe(1);
    expect(statistics.triangles).toBe(1);
  });

  it("mixes the two shaded families over one light block and one collect", () => {
    const root = new AmbientRoot([0.2, 0.2, 0.2]);
    root.add(new DirectionalLightNode());
    root.add(
      new Renderable(
        litTriangle().asGeometry,
        new TestLitMaterial().asMaterial,
      ),
    );
    root.add(
      new Renderable(
        litTriangle().asGeometry,
        new TestStandardMaterial().asMaterial,
      ),
    );

    harness.renderer.render(root, [createView()]);
    expect(
      bufferLabels(harness.gpu).filter((label) => label === "fourJS:lights"),
    ).toHaveLength(1);
    expect(bindGroupOffsets(harness.gpu, 1)).toEqual([[0], [0]]);
    expect(moduleLabels(harness.gpu)).toEqual(
      expect.arrayContaining(["fourJS:lit|n", "fourJS:standard|n"]),
    );
  });
});

/**
 * §69's casting directional light — the structural triple `collectSceneLights`
 * checks (`castShadow`, a `shadow` record, `computeShadowMatrix`).
 */
class CastingLightNode extends DirectionalLightNode {
  override castShadow = true;

  shadow = { mapSize: 256, bias: 0.004, normalBias: 0.01 };

  computeShadowMatrix(out: Matrix4): Matrix4 {
    out.identity();
    return out;
  }
}

/** A lit triangle plus a casting light — the smallest shadowed scene. */
function shadowedScene(): {
  root: Renderable;
  light: CastingLightNode;
  receiver: Renderable;
} {
  const root = createRoot();
  const light = new CastingLightNode();
  root.add(light);
  const receiver = new Renderable(
    litTriangle().asGeometry,
    new TestLitMaterial().asMaterial,
  );
  root.add(receiver);
  return { root, light, receiver };
}

/** The recorded render-pass descriptors, in order. */
function passDescriptors(gpu: RecordingGpu): {
  label?: string;
  colorAttachments?: { loadOp?: string }[];
  depthStencilAttachment?: {
    depthLoadOp?: string;
    depthClearValue?: number;
    stencilLoadOp?: string;
  };
}[] {
  return gpu.callsOf("encoder.beginRenderPass").map(
    (call) =>
      call.args[0] as {
        label?: string;
        colorAttachments?: { loadOp?: string }[];
        depthStencilAttachment?: {
          depthLoadOp?: string;
          depthClearValue?: number;
          stencilLoadOp?: string;
        };
      },
  );
}

describe("WebgpuRenderer shadows (§69, WP-R1.7)", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await initialized();
  });

  it("keeps a shadowless lit frame free of every shadow spelling", () => {
    // The byte-identity contract, asserted from the shadowless side: a lit
    // scene whose light does not cast records one render pass and not one
    // shadow allocation, module, layout, sampler, or key segment.
    const root = createRoot();
    root.add(new DirectionalLightNode());
    root.add(
      new Renderable(
        litTriangle().asGeometry,
        new TestLitMaterial().asMaterial,
      ),
    );
    harness.renderer.render(root, [createView()]);

    const transcript = harness.gpu.transcript().join("\n");
    expect(harness.gpu.countOf("encoder.beginRenderPass")).toBe(1);
    expect(transcript).not.toContain("fourJS:shadow");
    expect(transcript).not.toContain("sampler_comparison");
    expect(transcript).not.toContain("|sh:y");
    expect(harness.gpu.countOf("device.createSampler")).toBe(0);
  });

  it("records the caster pass before the views pass, into the samplable target", () => {
    const { root } = shadowedScene();
    harness.renderer.render(root, [createView()]);

    // Two passes on one encoder, shadow first — §63's own stage order —
    // with the map's whole-attachment depth clear (the one legitimate
    // depthLoadOp: "clear" outside the mip blits) and a loading colour
    // attachment nothing reads.
    const passes = passDescriptors(harness.gpu);
    expect(passes.map((pass) => pass.label)).toEqual([
      "fourJS:shadow",
      "fourJS:views",
    ]);
    expect(passes[0].depthStencilAttachment).toEqual({
      view: expect.anything() as unknown,
      depthLoadOp: "clear",
      depthClearValue: 1,
      depthStoreOp: "store",
    });
    expect(passes[0].colorAttachments?.[0]?.loadOp).toBe("load");

    // The target rides the R1.6 cache: a depthTexture row, so the depth
    // format is the samplable depth32float with TEXTURE_BINDING usage.
    const depthAllocation = harness.gpu
      .callsOf("device.createTexture")
      .map(
        (call) =>
          call.args[0] as { label?: string; format?: string; usage?: number },
      )
      .find((descriptor) =>
        String(descriptor.label).startsWith("fourJS:render-target-depth:"),
      );
    expect(depthAllocation?.format).toBe("depth32float");
    expect((depthAllocation?.usage ?? 0) & 0x04).toBe(0x04);

    // The caster drew through the one shadow pipeline over the shared
    // one-group layout, at the shadow target's own formats.
    expect(moduleLabels(harness.gpu)).toContain("fourJS:shadow");
    expect(pipelineLabels(harness.gpu)).toContain(
      "fourJS:shadow|-|-|none|dt|dw|cw|triangle-list|rgba8unorm|depth32float",
    );
  });

  it("packs the light block's shadow tail per view, and zeros it shadowless", () => {
    const { root, light } = shadowedScene();
    harness.renderer.render(root, [createView()]);
    const { floats, size } = lightsUpload(harness.gpu);
    // The upload covers the stride, shadow tail included.
    expect(size).toBe(LIGHT_UNIFORM_STRIDE_FLOATS);
    const matrix = SHADOW_MATRIX_OFFSET / 4;
    expect(floats.slice(matrix, matrix + 4)).toEqual([1, 0, 0, 0]);
    const params = floats.slice(
      SHADOW_PARAMS_OFFSET / 4,
      SHADOW_PARAMS_OFFSET / 4 + 4,
    );
    expect(params[0]).toBe(Math.fround(0.004));
    expect(params[1]).toBe(Math.fround(0.01));
    expect(params[2]).toBe(Math.fround(1 / 256));
    expect(params[3]).toBe(0);

    // The same scene with the cast switched off zeroes the tail on the very
    // next frame — the uploaded stride is a function of this frame alone.
    light.castShadow = false;
    harness.gpu.reset();
    harness.renderer.render(root, [createView()]);
    const shadowless = lightsUpload(harness.gpu).floats;
    for (let index = 0; index < 20; index += 1) {
      expect(shadowless[matrix + index]).toBe(0);
    }
  });

  it("gives a receiving draw the |sh:y variant and the widened group; a non-receiver shares the plain pipeline", () => {
    const { root } = shadowedScene();
    const optOut = new Renderable(
      litTriangle().asGeometry,
      new TestLitMaterial().asMaterial,
    );
    optOut.receiveShadow = false;
    root.add(optOut);
    root.add(
      new Renderable(
        litTriangle().asGeometry,
        new TestStandardMaterial().asMaterial,
      ),
    );
    harness.renderer.render(root, [createView()]);

    const labels = pipelineLabels(harness.gpu);
    // The receiver's variant, the opt-out's plain landed pipeline (same key
    // a shadowless frame compiles), and the standard receiver's variant.
    expect(labels).toContain(
      "fourJS:lit|-|-|none|dt|dw|cw|triangle-list|bgra8unorm|depth24plus|n:y|sh:y",
    );
    expect(labels).toContain(
      "fourJS:lit|-|-|none|dt|dw|cw|triangle-list|bgra8unorm|depth24plus|n:y",
    );
    expect(labels).toContain(
      "fourJS:standard|-|-|none|dt|dw|cw|triangle-list|bgra8unorm|depth24plus|n:y|sh:y",
    );
    expect(moduleLabels(harness.gpu)).toEqual(
      expect.arrayContaining([
        "fourJS:lit|n|sh",
        "fourJS:lit|n",
        "fourJS:standard|n|sh",
      ]),
    );

    // One widened layout, one comparison sampler, one shadow group — over
    // the same lights buffer the plain group binds.
    expect(
      layoutLabels(harness.gpu).filter(
        (label) => label === "fourJS:shadow-lights",
      ),
    ).toHaveLength(1);
    expect(harness.gpu.countOf("device.createSampler")).toBe(1);
    const shadowGroups = harness.gpu
      .callsOf("device.createBindGroup")
      .map((call) => call.args[0] as { label?: string; entries: unknown[] })
      .filter((descriptor) => descriptor.label === "fourJS:shadow-lights");
    expect(shadowGroups).toHaveLength(1);
    expect(shadowGroups[0].entries).toHaveLength(3);
    expect(
      (shadowGroups[0].entries[0] as { resource: { size?: number } }).resource
        .size,
    ).toBe(SHADOW_LIGHT_UNIFORM_BYTES);
  });

  it("excludes sprites, opted-out casters, and undrawable kinds from the pass", () => {
    const { root } = shadowedScene();
    const optOut = renderable(triangle());
    optOut.castShadow = false;
    root.add(optOut);
    root.add(new SpriteNode(texturedTriangle(), new TestSpriteMaterial()));
    // A skinned item — transcript-invisible on this backend (WP-R1.4), and
    // its shadow with it (an invisible surface must not cast).
    const skinnedGeometry = litTriangle();
    skinnedGeometry.joints = new Uint16Array(12);
    skinnedGeometry.weights = new Float32Array(12).fill(0.25);
    const skinned = renderable(skinnedGeometry);
    (skinned as unknown as { skeleton: unknown }).skeleton = {
      update: (): void => {},
      jointMatrices: new Float32Array(16),
      bones: [null],
    };
    root.add(skinned);
    const statistics = createRenderStatistics();
    harness.renderer.statistics = statistics;

    harness.renderer.render(root, [createView()]);

    // The shadow pass drew exactly one caster: the lit receiver. Everything
    // between the two beginRenderPass lines is the caster pass's tape.
    const names = harness.gpu.calls.map((call) => call.name);
    const shadowStart = names.indexOf("encoder.beginRenderPass");
    const viewsStart = names.indexOf(
      "encoder.beginRenderPass",
      shadowStart + 1,
    );
    const casterDraws = names
      .slice(shadowStart, viewsStart)
      .filter((name) => name === "pass.draw" || name === "pass.drawIndexed");
    expect(casterDraws).toHaveLength(1);
  });

  it("reallocates the map and rebuilds the shadow group when mapSize changes", () => {
    const { root, light } = shadowedScene();
    harness.renderer.render(root, [createView()]);
    harness.renderer.render(root, [createView()]);
    // A steady mapSize allocates once and reuses the group.
    const shadowGroupCount = (): number =>
      harness.gpu
        .callsOf("device.createBindGroup")
        .filter(
          (call) =>
            (call.args[0] as { label?: string }).label ===
            "fourJS:shadow-lights",
        ).length;
    expect(shadowGroupCount()).toBe(1);

    light.shadow = { mapSize: 512, bias: 0.004, normalBias: 0.01 };
    harness.renderer.render(root, [createView()]);
    // The resize bumped the target's version: the cache reallocated on this
    // frame, and the receiving group was rebuilt against the new depth view.
    expect(shadowGroupCount()).toBe(2);
    const depthAllocations = harness.gpu
      .callsOf("device.createTexture")
      .map((call) => call.args[0] as { label?: string; size?: number[] })
      .filter((descriptor) =>
        String(descriptor.label).startsWith("fourJS:render-target-depth:"),
      );
    expect(depthAllocations.map((descriptor) => descriptor.size)).toEqual([
      [256, 256],
      [512, 512],
    ]);
  });

  it("draws the map once per frame, shared by every view", () => {
    const { root } = shadowedScene();
    harness.renderer.render(root, [
      createView({ id: "a", width: 0.5 }),
      createView({ id: "b", x: 0.5, width: 0.5 }),
    ]);
    // One caster pass, two view rectangles: the map is frame state.
    expect(harness.gpu.countOf("encoder.beginRenderPass")).toBe(2);
    expect(bindGroupOffsets(harness.gpu, 1)).toEqual([
      [0],
      [LIGHT_UNIFORM_STRIDE_BYTES],
    ]);
  });

  it("survives a reentrant dispose inside the frame's stencil scan (§61)", () => {
    // The WP-R1.7 scan reads material accessors before anything is recorded
    // — application code, which can do anything, including tearing the
    // renderer down. The frame must bail without throwing and without
    // resurrecting one allocation onto the dead device (the R1.6 rule).
    const { root } = shadowedScene();
    const material = new TestMaterial();
    let dispose: () => void = () => undefined;
    Object.defineProperty(material, "stencil", {
      get: (): undefined => {
        dispose();
        return undefined;
      },
    });
    root.add(renderable(triangle(), material));
    dispose = (): void => {
      harness.renderer.dispose();
    };

    expect(() => {
      harness.renderer.render(root, [createView()]);
    }).not.toThrow();
    expect(harness.gpu.countOf("pass.draw")).toBe(0);
    expect(harness.gpu.countOf("pass.drawIndexed")).toBe(0);
    expect(harness.gpu.countOf("device.createBuffer")).toBe(0);
    expect(harness.gpu.countOf("encoder.beginRenderPass")).toBe(0);
    expect(harness.renderer.disposed).toBe(true);
  });

  it("survives a reentrant dispose inside a light's shadow accessor (§61)", () => {
    // `collectSceneLights` reads the light's `shadow` record — application
    // code too. A small scene's frame then finds its uniform bind group
    // dropped and skips before recording anything.
    const { root, light } = shadowedScene();
    let dispose: () => void = () => undefined;
    const record = { mapSize: 256, bias: 0.004, normalBias: 0.01 };
    Object.defineProperty(light, "shadow", {
      get: (): typeof record => {
        dispose();
        return record;
      },
    });
    dispose = (): void => {
      harness.renderer.dispose();
    };

    expect(() => {
      harness.renderer.render(root, [createView()]);
    }).not.toThrow();
    expect(harness.gpu.countOf("encoder.beginRenderPass")).toBe(0);
    expect(harness.renderer.disposed).toBe(true);
  });

  it("costs a torn-down frame its shadows when the map cannot be produced (§61)", () => {
    // The same reentrant teardown on a frame large enough to regrow its
    // uniform buffer: the frame proceeds to the caster pass, the disposed
    // target cache answers null, and the frame loses its shadows — and its
    // draws, since every other cache is gone too — without throwing.
    const { root, light } = shadowedScene();
    for (let index = 0; index < 9; index += 1) {
      root.add(
        new Renderable(
          litTriangle().asGeometry,
          new TestLitMaterial().asMaterial,
        ),
      );
    }
    let dispose: () => void = () => undefined;
    const record = { mapSize: 256, bias: 0.004, normalBias: 0.01 };
    Object.defineProperty(light, "shadow", {
      get: (): typeof record => {
        dispose();
        return record;
      },
    });
    dispose = (): void => {
      harness.renderer.dispose();
    };

    expect(() => {
      harness.renderer.render(root, [createView()]);
    }).not.toThrow();
    // The encoder opened only the views pass: the shadow pass returned
    // before beginning, because its target could not be acquired.
    expect(passDescriptors(harness.gpu).map((pass) => pass.label)).toEqual([
      "fourJS:views",
    ]);
    expect(harness.gpu.countOf("pass.draw")).toBe(0);
  });

  it("casts an indexed caster through drawIndexed", () => {
    const { root } = shadowedScene();
    const geometry = new TestGeometry(
      new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
      new Uint16Array([0, 1, 2]),
    );
    root.add(renderable(geometry));
    harness.renderer.render(root, [createView()]);
    // Caster pass: one plain draw (the lit receiver) and one indexed; views
    // pass repeats both plus the clear.
    expect(harness.gpu.countOf("pass.drawIndexed")).toBe(2);
  });

  it("disposes the shadow target with the renderer (§83)", () => {
    const { root } = shadowedScene();
    harness.renderer.render(root, [createView()]);
    harness.renderer.dispose();
    // The map's two textures die with the target cache; a second dispose is
    // the usual no-op.
    const destroyed = harness.gpu.countOf("texture.destroy");
    expect(destroyed).toBeGreaterThanOrEqual(2);
    harness.renderer.dispose();
    expect(harness.gpu.countOf("texture.destroy")).toBe(destroyed);
  });

  it("renders the map for an off-screen frame too, at the target's formats", () => {
    const { root } = shadowedScene();
    const target = new RenderTarget({ width: 64, height: 64 });
    harness.renderer.render(root, [createView()], undefined, target);

    const passes = passDescriptors(harness.gpu);
    expect(passes.map((pass) => pass.label)).toEqual([
      "fourJS:shadow",
      "fourJS:views",
    ]);
    // The caster pipeline keeps the map's own formats; the receiver bakes
    // the off-screen colour format — two families, two format tuples.
    const labels = pipelineLabels(harness.gpu);
    expect(labels).toContain(
      "fourJS:shadow|-|-|none|dt|dw|cw|triangle-list|rgba8unorm|depth32float",
    );
    expect(
      labels.some(
        (label) =>
          label.startsWith("fourJS:lit") &&
          label.includes("|rgba8unorm|") &&
          label.endsWith("|sh:y"),
      ),
    ).toBe(true);
  });

  it("drops the shadow group with a lights-buffer regrowth and rebuilds it", () => {
    const { root } = shadowedScene();
    harness.renderer.render(root, [createView()]);
    // Five views exceed the four-block floor: the lights buffer regrows,
    // the shadow group pointed at the destroyed buffer, and the next
    // receiving draw recreates it.
    harness.renderer.render(root, [
      createView({ id: "a" }),
      createView({ id: "b" }),
      createView({ id: "c" }),
      createView({ id: "d" }),
      createView({ id: "e" }),
    ]);
    const shadowGroups = harness.gpu
      .callsOf("device.createBindGroup")
      .filter(
        (call) =>
          (call.args[0] as { label?: string }).label === "fourJS:shadow-lights",
      );
    expect(shadowGroups).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Particles (§36, §64 stage 6, WP-R1.8).
//
// The emitting node is a double for the GL suite's recorded reason:
// `@fourjs/particles`' `ParticleRenderable` is outside this package's dependency
// matrix — and, by design, outside `@fourjs/render`'s too. What `buildRenderList`
// recognises is the *structural* `ParticleDrawable` contract, so a double
// implementing that contract is not a shortcut here: it is the contract,
// exercised exactly as the real class is (the real class runs in
// `tests/integration/webgpu-particles.test.ts`).
// ---------------------------------------------------------------------------

type RenderNode = Parameters<Renderer["render"]>[0];

let nextTestParticlesId = 0;

/**
 * A particle system node reduced to what the render list reads — the GL
 * suite's double, minus the interpolated-path transform members these tests
 * never touch. Particle `i` sits at `(i, i + 0.5, 0)` with size `i + 1` and
 * colour `(i, 0, 0, 0.5)`, so an upload assertion can name its floats.
 */
class TestParticles {
  readonly isParticleDrawable = true;

  readonly id: string;

  readonly parent = null;

  readonly children: unknown[] = [];

  visible = true;

  enabled = true;

  renderLayer = 0;

  renderOrder = 0;

  particleCount: number;

  /** Mutable so a capacity-growth test can swap in a larger array. */
  particleInstances: Float32Array;

  /** Calls to `updateParticleInstances` — the list owes exactly one per build. */
  updateCalls = 0;

  readonly transform = { worldMatrix: new Matrix4() };

  constructor(capacity: number, count = capacity) {
    nextTestParticlesId += 1;
    this.id = `test-particles-${String(nextTestParticlesId)}`;
    this.particleInstances = new Float32Array(
      capacity * PARTICLE_INSTANCE_FLOATS,
    );
    this.particleCount = count;
    for (let i = 0; i < capacity; i += 1) {
      const base = i * PARTICLE_INSTANCE_FLOATS;
      this.particleInstances[base] = i;
      this.particleInstances[base + 1] = i + 0.5;
      this.particleInstances[base + 2] = 0;
      this.particleInstances[base + 3] = i + 1;
      this.particleInstances[base + 4] = i;
      this.particleInstances[base + 7] = 0.5;
    }
  }

  updateParticleInstances(): void {
    this.updateCalls += 1;
  }

  get asNode(): RenderNode {
    return this as unknown as RenderNode;
  }
}

/**
 * A container node reduced to §6's traversal surface, so a test can put a
 * particle double and a real `Renderable` under one root — `Node.add` takes a
 * real node, which a double is not (the GL suite's `TestGroup`, verbatim).
 */
class TestGroup {
  visible = true;

  enabled = true;

  readonly parent = null;

  readonly children: unknown[] = [];

  add(...nodes: { asNode: RenderNode }[]): this {
    for (const node of nodes) {
      this.children.push(node.asNode);
    }
    return this;
  }

  addRenderables(...nodes: Renderable[]): this {
    this.children.push(...nodes);
    return this;
  }

  get asNode(): RenderNode {
    return this as unknown as RenderNode;
  }
}

/** The instance-stream uploads on the tape: `writeBuffer`s of `floats` elements. */
function instanceUploads(
  gpu: RecordingGpu,
  floats: number,
): { args: readonly unknown[] }[] {
  return gpu
    .callsOf("queue.writeBuffer")
    .filter((call) => call.args[4] === floats);
}

describe("WebgpuRenderer particles (§36, §112, WP-R1.8)", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await initialized();
  });

  it("draws the whole system in ONE instanced draw of the shared quad", () => {
    const particles = new TestParticles(1000, 250);

    harness.renderer.render(particles.asNode, [createView()]);

    // The clear triangle, then the system: six quad vertices, 250 instances —
    // and no per-particle draw anywhere.
    const draws = harness.gpu.callsOf("pass.draw");
    expect(draws).toHaveLength(2);
    expect(draws[1]?.args[0]).toBe(6);
    expect(draws[1]?.args[1]).toBe(250);
    expect(harness.gpu.countOf("pass.drawIndexed")).toBe(0);
    expect(particles.updateCalls).toBe(1);
    // Slot 0 is the shared quad's positions, slot 1 the instance buffer —
    // two distinct buffers, positionally bound (`wgpu-particles.ts`).
    const vertexBuffers = harness.gpu.callsOf("pass.setVertexBuffer");
    expect(vertexBuffers).toHaveLength(2);
    expect(vertexBuffers[0]?.args[0]).toBe(0);
    expect(vertexBuffers[1]?.args[0]).toBe(1);
    expect(vertexBuffers[1]?.args[1]).not.toBe(vertexBuffers[0]?.args[1]);
  });

  it("compiles the particle pipeline lazily, instance layout baked in", () => {
    harness.renderer.render(new TestParticles(4).asNode, [createView()]);

    // The clear pipeline, then the particle pipeline — created by this first
    // particle frame, not at initialization.
    expect(pipelineLabels(harness.gpu)).toEqual([
      "fourJS:clear|-|-|none|-|dw|-|triangle-list|bgra8unorm|depth24plus",
      "fourJS:particles|-|-|normal|dt|dw|cw|triangle-list|bgra8unorm|depth24plus",
    ]);
    const descriptor = harness.gpu.callsOf("device.createRenderPipeline")[1]
      ?.args[0] as {
      vertex: { buffers: unknown[] };
      fragment: { targets: { blend?: { color: { srcFactor: string } } }[] };
      depthStencil: { depthWriteEnabled: boolean; depthCompare: string };
    };
    expect(descriptor.vertex.buffers).toEqual([
      POSITION_BUFFER_LAYOUT,
      PARTICLE_INSTANCE_BUFFER_LAYOUT,
    ]);
    // §66's straight alpha, always — a material-less item cannot opt out.
    expect(descriptor.fragment.targets[0]?.blend?.color.srcFactor).toBe(
      "src-alpha",
    );
    // §57's default depth state: tested and written.
    expect(descriptor.depthStencil).toMatchObject({
      depthWriteEnabled: true,
      depthCompare: "less",
    });
    // The widened group-0 layout arrived with the draw, once, and its bind
    // group reads the particle block off the shared strided buffer.
    expect(
      layoutLabels(harness.gpu).filter(
        (label) => label === "fourJS:particle-uniforms",
      ),
    ).toHaveLength(1);
    const groups = harness.gpu
      .callsOf("device.createBindGroup")
      .map((call) => call.args[0] as { label?: string; entries: unknown[] })
      .filter(
        (descriptor_) => descriptor_.label === "fourJS:particle-uniforms",
      );
    expect(groups).toHaveLength(1);
    expect(
      (groups[0]?.entries[0] as { resource: { size?: number } }).resource.size,
    ).toBe(PARTICLE_UNIFORM_BYTES);
  });

  it("packs projection, view and model separately into the particle block", () => {
    const particles = new TestParticles(2);
    particles.transform.worldMatrix.elements[13] = 7;
    const camera = new TestCamera();
    camera.projectionMatrix.elements[0] = 2;
    camera.viewMatrix.elements[12] = 5;

    harness.renderer.render(particles.asNode, [
      createView({ camera: camera.asCamera }),
    ]);

    const data = uniformUpload(harness.gpu);
    // Block 0 is the clear; block 1 the system, three matrices at the
    // wgpu-particles.ts offsets — the billboard offset happens *between*
    // view and projection, which is why they travel separately.
    const base = UNIFORM_STRIDE_BYTES / 4;
    expect(data[base + PARTICLE_PROJECTION_OFFSET / 4]).toBe(2);
    expect(data[base + PARTICLE_VIEW_OFFSET / 4 + 12]).toBe(5);
    expect(data[base + PARTICLE_MODEL_OFFSET / 4 + 13]).toBe(7);
  });

  it("uploads the instance stream once per frame, shared by every view", () => {
    const particles = new TestParticles(8, 3);
    const floats = 3 * PARTICLE_INSTANCE_FLOATS;
    const views = [
      createView({ id: "a", width: 0.5 }),
      createView({ id: "b", x: 0.5, width: 0.5 }),
    ];

    harness.renderer.render(particles.asNode, views);

    // Two views, two instanced draws — one upload (`wgpu-particles.ts` on
    // the deviation from GL's per-view cadence, forced by queue ordering).
    expect(
      harness.gpu.callsOf("pass.draw").filter((call) => call.args[1] === 3),
    ).toHaveLength(2);
    const uploads = instanceUploads(harness.gpu, floats);
    expect(uploads).toHaveLength(1);
    // Particle 1 of the double: centre (1, 1.5, 0), size 2, colour (1,0,0,0.5).
    expect((uploads[0]?.args[2] as number[]).slice(8, 16)).toEqual([
      1, 1.5, 0, 2, 1, 0, 0, 0.5,
    ]);

    // The next frame uploads again, into the same warm buffer.
    harness.gpu.reset();
    harness.renderer.render(particles.asNode, views);
    expect(instanceUploads(harness.gpu, floats)).toHaveLength(1);
    expect(harness.gpu.countOf("device.createBuffer")).toBe(0);
    expect(harness.gpu.countOf("device.createRenderPipeline")).toBe(0);
  });

  it("skips a zero-count system before its buffer is allocated", () => {
    const emptyish = new TestParticles(8, 0);
    const empty = new TestParticles(0, 0);

    harness.renderer.render(new TestGroup().add(emptyish, empty).asNode, [
      createView(),
    ]);

    // The clear alone drew, and neither the shared quad nor an instance
    // buffer was allocated — the skip sits *before* the geometry cache, the
    // skinned-absence discipline (stricter than GL's arm, which acquires its
    // record first; stated in source).
    expect(harness.gpu.countOf("pass.draw")).toBe(1);
    expect(harness.gpu.countOf("device.createBuffer")).toBe(0);
    // …but the list still repacked each system once (§64's contract).
    expect(emptyish.updateCalls).toBe(1);
  });

  it("is byte-identical with and without a zero-count system — full tape", async () => {
    // Two fresh renderers over two fresh devices, the WP-R1.4 skinned A/B
    // restated for §36: {scene} and {scene + zero-count system} must record
    // the identical tape from initialization on, handle serials included.
    // One shared geometry, so its id — which the upload labels carry — is
    // the same byte sequence on both tapes.
    const shared = triangle();
    const tapeOf = async (withEmpty: boolean): Promise<string[]> => {
      const gpu = createRecordingGpu();
      const renderer = new WebgpuRenderer();
      await withHostGpu(gpu.gpu, async () => {
        await renderer.initialize({ canvas: gpu.canvas });
      });
      renderer.resize(256, 256, 1);
      const group = new TestGroup();
      group.addRenderables(renderable(shared));
      if (withEmpty) {
        group.add(new TestParticles(4, 0));
      }
      renderer.render(group.asNode, [createView()]);
      return gpu.transcript();
    };

    expect(await tapeOf(true)).toEqual(await tapeOf(false));
  });

  it("rebuilds the instance buffer when the system's capacity grows", () => {
    const particles = new TestParticles(2);
    harness.renderer.render(particles.asNode, [createView()]);

    particles.particleInstances = new Float32Array(
      8 * PARTICLE_INSTANCE_FLOATS,
    );
    particles.particleCount = 8;
    harness.renderer.render(particles.asNode, [createView()]);

    const allocations = harness.gpu
      .callsOf("device.createBuffer")
      .map((call) => call.args[0] as { label?: string; size?: number })
      .filter((descriptor) =>
        String(descriptor.label).startsWith("fourJS:particles:"),
      );
    expect(allocations.map((descriptor) => descriptor.size)).toEqual([
      2 * PARTICLE_INSTANCE_FLOATS * 4,
      8 * PARTICLE_INSTANCE_FLOATS * 4,
    ]);
    expect(harness.gpu.countOf("buffer.destroy")).toBe(1);
  });

  it("tests a clipped particle system against its clip's planes (§67)", () => {
    // A §67 panel over a real geometry, with the particle double reached
    // through the live children array — `Node.add` takes a real node, and
    // the clip record must come from a real, renderable clip node (R-23).
    const panel = renderable(triangle());
    panel.clip = true;
    const particles = new TestParticles(4);
    (panel.children as unknown as RenderNode[]).push(particles.asNode);

    harness.renderer.render(panel, [createView()]);

    // Clear, mask, panel content (unclipped), particles (clipped).
    expect(harness.gpu.countOf("pass.draw")).toBe(4);
    const label = pipelineLabels(harness.gpu).find((entry) =>
      entry.startsWith("fourJS:particles"),
    );
    // The engine's clip record is the particle pipeline's stencil — an
    // `equal` test over the accumulated planes, on the stencil-carrying
    // frame format.
    expect(label).toBe(
      "fourJS:particles|-|-|normal|dt|dw|cw|triangle-list|bgra8unorm|" +
        "depth24plus-stencil8|s:equal,1,0,keep,keep,keep",
    );
    // …and the clipped draw put the pass's reference where the mask left it.
    expect(harness.gpu.callsOf("pass.setStencilReference")).toHaveLength(1);
  });

  it("skips a double whose count outruns its instance storage — GL's answer", () => {
    // A structurally typed node lying about its count: `buildRenderList`
    // copies both fields verbatim, and a capacity-less instance array can
    // draw nothing. The quad is acquired (count > 0 reads as a live system)
    // but the instance cache refuses, and the draw is skipped whole.
    const malformed = new TestParticles(0, 5);

    harness.renderer.render(malformed.asNode, [createView()]);

    expect(harness.gpu.countOf("pass.draw")).toBe(1);
    expect(
      harness.gpu
        .callsOf("device.createBuffer")
        .filter((call) =>
          String((call.args[0] as { label?: string }).label).startsWith(
            "fourJS:particles:",
          ),
        ),
    ).toHaveLength(0);
  });

  it("survives a reentrant dispose mid-frame, skipping the particle draw (§61)", () => {
    // The pinned WP-R1.3 scenario, reaching the particle arm: application
    // code inside `camera.updateViewMatrix` tears the renderer down, the
    // geometry cache answers null for the shared quad, and the frame skips
    // every draw without throwing and without resurrecting an allocation.
    const camera = new TestCamera();
    camera.updateViewMatrix = (): void => {
      harness.renderer.dispose();
    };

    expect(() => {
      harness.renderer.render(new TestParticles(4).asNode, [
        createView({ camera: camera.asCamera }),
      ]);
    }).not.toThrow();
    // Not even the clear drew: the teardown ran before the view's clear.
    expect(harness.gpu.countOf("pass.draw")).toBe(0);
    expect(
      harness.gpu
        .callsOf("device.createBuffer")
        .filter((call) =>
          String((call.args[0] as { label?: string }).label).startsWith(
            "fourJS:",
          ),
        ),
    ).toHaveLength(0);
    expect(harness.renderer.disposed).toBe(true);
  });

  it("forgets the instance buffers on device loss — dropped, never destroyed", async () => {
    const particles = new TestParticles(4);
    harness.renderer.render(particles.asNode, [createView()]);
    harness.gpu.reset();

    harness.gpu.loseDevice();
    await Promise.resolve();
    harness.renderer.dispose();

    // §61: the allocations died with the device; nothing calls destroy on a
    // handle that no longer exists.
    expect(harness.gpu.countOf("buffer.destroy")).toBe(0);
  });

  it("destroys the instance buffers with the renderer (§83)", () => {
    harness.renderer.render(new TestParticles(4).asNode, [createView()]);
    harness.gpu.reset();

    harness.renderer.dispose();

    // The instance buffer and the frame's uniform buffer both die here.
    expect(harness.gpu.countOf("buffer.destroy")).toBeGreaterThanOrEqual(2);
  });

  it("counts §84's statistics as one call, count instances, 2·count triangles", () => {
    const statistics = createRenderStatistics();
    harness.renderer.statistics = statistics;

    harness.renderer.render(new TestParticles(250).asNode, [createView()]);

    // The clear is the backend's own; the system is one submitted draw of
    // 250 quad instances — the one place `instances` exceeds `drawCalls`.
    expect(statistics.drawCalls).toBe(1);
    expect(statistics.instances).toBe(250);
    expect(statistics.triangles).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// GPU particle simulations (§36 `simulation: "gpu"`, R-31 wiring, 2026-08-29).
//
// The emitter side and the WgpuParticleSimulation verbs have their own suites
// (`@fourjs/particles`' gpu-simulation.test.ts; wgpu-particle-simulation.test.ts
// here); what this block pins is the *renderer's* half of the join — the
// registry `createParticleSimulation` keeps by system id, and the draw arm
// re-sourcing the position stream through the `|gi:y` pipeline variant.
// ---------------------------------------------------------------------------

describe("WebgpuRenderer GPU particle simulations (§36, R-31)", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await initialized();
  });

  /** Catches a synchronous `FourError` and returns it. */
  function caught(body: () => unknown): FourError {
    try {
      body();
    } catch (error: unknown) {
      if (isFourError(error)) {
        return error;
      }
      throw error;
    }
    throw new Error("expected the call to throw a FourError");
  }

  it("registers under the system id and refuses a duplicate", () => {
    const particles = new TestParticles(8);
    const simulation = harness.renderer.createParticleSimulation({
      systemId: particles.id,
      capacity: 8,
    });
    expect(simulation.systemId).toBe(particles.id);
    const error = caught(() =>
      harness.renderer.createParticleSimulation({
        systemId: particles.id,
        capacity: 8,
      }),
    );
    expect(error.code).toBe("INVALID_APPLICATION_STATE");
    expect(error.message).toMatch(/dispose the existing one first/);

    // Disposal unhooks the registration, freeing the slot.
    simulation.dispose();
    const second = harness.renderer.createParticleSimulation({
      systemId: particles.id,
      capacity: 8,
    });
    expect(second.disposed).toBe(false);
    second.dispose();
  });

  it("shares the lifecycle gate of the other §82 methods", async () => {
    const fresh = new WebgpuRenderer();
    expect(
      caught(() =>
        fresh.createParticleSimulation({ systemId: "x", capacity: 4 }),
      ).code,
    ).toBe("INVALID_APPLICATION_STATE");

    harness.gpu.loseDevice();
    await Promise.resolve();
    await Promise.resolve();
    expect(
      caught(() =>
        harness.renderer.createParticleSimulation({
          systemId: "x",
          capacity: 4,
        }),
      ).code,
    ).toBe("DEVICE_LOST");
  });

  it("draws a registered system from its position buffer — the |gi:y variant", () => {
    const particles = new TestParticles(8, 3);
    const simulation = harness.renderer.createParticleSimulation({
      systemId: particles.id,
      capacity: 8,
    });
    harness.gpu.reset();

    harness.renderer.render(particles.asNode, [createView()]);

    // Three vertex buffers: quad corners, the simulation's positions, the
    // interleaved stream demoted to ramp duty.
    const binds = harness.gpu.callsOf("pass.setVertexBuffer");
    expect(binds).toHaveLength(3);
    expect(binds.map((call) => call.args[0])).toEqual([0, 1, 2]);
    expect(binds[1]?.args[1]).toBe(simulation.positions.buffer);
    expect(binds[2]?.args[1]).not.toBe(simulation.positions.buffer);

    // The pipeline variant carries the `|gi:y` key segment and bakes the
    // three-buffer layout; the draw itself is the same instanced call.
    const pipelines = harness.gpu
      .callsOf("device.createRenderPipeline")
      .map(
        (call) =>
          call.args[0] as {
            label?: string;
            vertex: { buffers: readonly unknown[] };
          },
      )
      .filter((descriptor) => descriptor.label?.includes("particles") === true);
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0]?.label).toContain("|gi:y");
    expect(pipelines[0]?.vertex.buffers).toHaveLength(3);
    const draws = harness.gpu.callsOf("pass.draw");
    expect(draws[draws.length - 1]?.args.slice(0, 2)).toEqual([6, 3]);

    // The ramp stream still uploads — size and colour are CPU truth.
    expect(
      instanceUploads(harness.gpu, 3 * PARTICLE_INSTANCE_FLOATS),
    ).toHaveLength(1);
    simulation.dispose();
  });

  it("falls back to the CPU stream for a disposed simulation", () => {
    const particles = new TestParticles(8, 3);
    const simulation = harness.renderer.createParticleSimulation({
      systemId: particles.id,
      capacity: 8,
    });
    simulation.dispose();
    harness.gpu.reset();

    harness.renderer.render(particles.asNode, [createView()]);

    // The landed two-buffer draw — no destroyed buffer is ever bound, and
    // the pipeline is the CPU variant (no `|gi:y`).
    expect(harness.gpu.callsOf("pass.setVertexBuffer")).toHaveLength(2);
    const labels = harness.gpu
      .callsOf("device.createRenderPipeline")
      .map((call) => (call.args[0] as { label?: string }).label ?? "");
    expect(labels.some((label) => label.includes("|gi:y"))).toBe(false);
  });
});

function skinnedTriangle(source: TestGeometry = triangle()): TestGeometry {
  source.joints = new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  source.weights = new Float32Array(12).fill(0.25);
  return source;
}

function withSkeleton(
  node: Renderable,
  palette = new Float32Array(16),
): { palette: Float32Array; updates: number } {
  const state = { palette, updates: 0 };
  (node as unknown as { skeleton: unknown }).skeleton = {
    update: (): void => {
      state.updates += 1;
    },
    jointMatrices: palette,
    bones: [null],
  };
  return state;
}

function bufferLabelsOf(gpu: RecordingGpu, prefix: string): string[] {
  return gpu
    .callsOf("device.createBuffer")
    .map((call) => String((call.args[0] as { label?: string }).label))
    .filter((label) => label.startsWith(prefix));
}

function paletteUploads(gpu: RecordingGpu): number[][] {
  return gpu
    .callsOf("queue.writeBuffer")
    .filter((call) => call.args[4] === JOINT_PALETTE_FLOATS)
    .map((call) => call.args[2] as number[]);
}

describe("registerSkinningPipeline — WebgpuRenderer colour pair (RFC 0003)", () => {
  let harness: Harness;

  beforeEach(async () => {
    resetDevWarnings();
    clearRegisteredSkinningPipeline();
    harness = await initialized();
  });

  afterEach(() => {
    clearRegisteredSkinningPipeline();
    resetDevWarnings();
  });

  it("reports the declared joint limit as a §62 capability", () => {
    expect(harness.renderer.capabilities.maximumSkinningJoints).toBe(48);
  });

  it("skips unregistered skinned draws with one warning and no joint upload", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const root = createRoot();
      const node = renderable(skinnedTriangle());
      withSkeleton(node);
      root.add(node);

      harness.renderer.render(root, [createView()]);
      harness.renderer.render(root, [createView()]);

      expect(harness.gpu.countOf("pass.draw")).toBe(2);
      expect(bufferLabelsOf(harness.gpu, "fourJS:joints:")).toHaveLength(0);
      expect(bufferLabelsOf(harness.gpu, "fourJS:weights:")).toHaveLength(0);
      expect(
        pipelineLabels(harness.gpu).some((label) => label.includes("skinned")),
      ).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain(
        "registerSkinningPipeline",
      );
      expect(String(warn.mock.calls[0]?.[0])).toContain("webgpu");
    } finally {
      warn.mockRestore();
    }
  });

  it("is byte-identical with and without an unregistered skinned node", async () => {
    const shared = triangle();
    (shared as unknown as { id: string }).id = "shared-plain";
    const tapeOf = async (withSkinned: boolean): Promise<string[]> => {
      const gpu = createRecordingGpu();
      const renderer = new WebgpuRenderer();
      await withHostGpu(gpu.gpu, async () => {
        await renderer.initialize({ canvas: gpu.canvas });
      });
      renderer.resize(256, 256, 1);
      const group = new TestGroup();
      group.addRenderables(renderable(shared));
      if (withSkinned) {
        const node = renderable(skinnedTriangle());
        withSkeleton(node);
        group.addRenderables(node);
      }
      renderer.render(group.asNode, [createView()]);
      const transcript = gpu.transcript();
      renderer.dispose();
      return transcript;
    };
    expect(await tapeOf(true)).toEqual(await tapeOf(false));
  });

  it("keeps a skinless frame byte-identical under registration", async () => {
    const shared = triangle();
    (shared as unknown as { id: string }).id = "shared-skinless";
    const tapeOf = async (): Promise<string[]> => {
      const gpu = createRecordingGpu();
      const renderer = new WebgpuRenderer();
      await withHostGpu(gpu.gpu, async () => {
        await renderer.initialize({ canvas: gpu.canvas });
      });
      renderer.resize(256, 256, 1);
      renderer.render(renderable(shared), [createView()]);
      const transcript = gpu.transcript();
      renderer.dispose();
      return transcript;
    };
    const before = await tapeOf();
    registerSkinningPipeline();
    expect(await tapeOf()).toEqual(before);
  });

  it("compiles lazily on the first skinned draw, uploads the palette, and reuses the pipeline", () => {
    registerSkinningPipeline();
    const root = createRoot();
    const node = renderable(skinnedTriangle());
    const { palette } = withSkeleton(node);
    palette[13] = 5;
    root.add(node);
    const views = [createView()];
    const statistics = createRenderStatistics();
    harness.renderer.statistics = statistics;

    harness.renderer.render(root, views);

    expect(statistics.drawCalls).toBe(1);

    expect(
      pipelineLabels(harness.gpu).some((label) =>
        label.startsWith("fourJS:skinned-unlit|"),
      ),
    ).toBe(true);
    expect(bufferLabelsOf(harness.gpu, "fourJS:joints:")).toHaveLength(1);
    expect(bufferLabelsOf(harness.gpu, "fourJS:weights:")).toHaveLength(1);
    expect(bufferLabelsOf(harness.gpu, "fourJS:joint-palette")).toHaveLength(1);
    const palettes = paletteUploads(harness.gpu);
    expect(palettes).toHaveLength(1);
    expect(palettes[0]?.[13]).toBe(5);
    expect(harness.gpu.countOf("pass.draw")).toBe(2);
    expect(bindGroupOffsets(harness.gpu, 1)).toContainEqual([0]);

    harness.gpu.reset();
    harness.renderer.render(root, views);
    expect(harness.gpu.countOf("device.createRenderPipeline")).toBe(0);
    expect(harness.gpu.countOf("device.createShaderModule")).toBe(0);
    expect(harness.gpu.countOf("pass.draw")).toBe(2);
    expect(paletteUploads(harness.gpu)[0]?.[13]).toBe(5);
  });

  it("shades a skinned-lit draw with the frame's lights", () => {
    registerSkinningPipeline();
    const root = new AmbientRoot([0.2, 0.3, 0.4]);
    const node = new Renderable(
      skinnedTriangle(litTriangle()).asGeometry,
      new TestLitMaterial([1, 0, 0, 1]).asMaterial,
    );
    withSkeleton(node);
    root.add(node);

    harness.renderer.render(root, [createView()]);

    expect(
      pipelineLabels(harness.gpu).some((label) =>
        label.startsWith("fourJS:skinned-lit|"),
      ),
    ).toBe(true);
    expect(
      moduleLabels(harness.gpu).some((label) => label.includes("skinned-lit")),
    ).toBe(true);
    expect(paletteUploads(harness.gpu)).toHaveLength(1);
    expect(bindGroupOffsets(harness.gpu, 2).length).toBeGreaterThan(0);
    expect(harness.gpu.countOf("pass.draw")).toBe(2);
  });

  it("binds joints and weights after the family's vertex streams", () => {
    registerSkinningPipeline();
    const root = createRoot();
    const node = renderable(skinnedTriangle());
    withSkeleton(node);
    root.add(node);
    harness.renderer.render(root, [createView()]);
    const slots = harness.gpu
      .callsOf("pass.setVertexBuffer")
      .map((call) => call.args[0] as number);
    // Clear uses slot 0; the skinned unlit draw binds position, joints, weights.
    expect(slots.slice(-3)).toEqual([0, 1, 2]);
  });

  it("draws an indexed skinned mesh through drawIndexed", () => {
    registerSkinningPipeline();
    const geometry = skinnedTriangle(
      new TestGeometry(
        new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
        new Uint16Array([0, 1, 2]),
      ),
    );
    const node = renderable(geometry);
    withSkeleton(node);
    harness.renderer.render(node, [createView()]);
    expect(harness.gpu.countOf("pass.drawIndexed")).toBe(1);
  });

  it("latches a factory failure: one warning, no bind-pose, no retry", () => {
    setSkinningPipelineFactory({
      create(): never {
        throw new Error("skinning factory exploded");
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const root = createRoot();
      const node = renderable(skinnedTriangle());
      withSkeleton(node);
      root.add(node);
      const views = [createView()];

      harness.renderer.render(root, views);
      harness.renderer.render(root, views);

      expect(harness.gpu.countOf("pass.draw")).toBe(2);
      expect(bufferLabelsOf(harness.gpu, "fourJS:joints:")).toHaveLength(0);
      expect(paletteUploads(harness.gpu)).toHaveLength(0);
      expect(
        pipelineLabels(harness.gpu).some((label) => label.includes("skinned")),
      ).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("failed to initialise");
    } finally {
      warn.mockRestore();
    }
  });

  it("skips a zero-count skinned geometry before uploading joints", () => {
    registerSkinningPipeline();
    const empty = new TestGeometry(new Float32Array(0));
    empty.joints = new Uint16Array(0);
    empty.weights = new Float32Array(0);
    const node = renderable(empty);
    withSkeleton(node);
    harness.renderer.render(node, [createView()]);
    expect(harness.gpu.countOf("pass.draw")).toBe(1);
    expect(bufferLabelsOf(harness.gpu, "fourJS:joints:")).toHaveLength(0);
  });

  it("casts a registered skinned mesh through the skinned shadow pipeline", () => {
    registerSkinningPipeline();
    const { root } = shadowedScene();
    const skinned = new Renderable(
      skinnedTriangle(litTriangle()).asGeometry,
      new TestLitMaterial().asMaterial,
    );
    withSkeleton(skinned);
    root.add(skinned);

    harness.renderer.render(root, [createView()]);

    const names = harness.gpu.calls.map((call) => call.name);
    const shadowStart = names.indexOf("encoder.beginRenderPass");
    const viewsStart = names.indexOf(
      "encoder.beginRenderPass",
      shadowStart + 1,
    );
    const casterDraws = names
      .slice(shadowStart, viewsStart)
      .filter((name) => name === "pass.draw" || name === "pass.drawIndexed");
    expect(casterDraws).toHaveLength(2);
    expect(
      pipelineLabels(harness.gpu).some((label) =>
        label.startsWith("fourJS:skinned-shadow|"),
      ),
    ).toBe(true);
    expect(
      pipelineLabels(harness.gpu).some((label) =>
        label.startsWith("fourJS:skinned-lit|"),
      ),
    ).toBe(true);
    expect(
      harness.gpu
        .callsOf("queue.writeBuffer")
        .some(
          (call) =>
            typeof call.args[4] === "number" &&
            call.args[4] >= JOINT_PALETTE_FLOATS &&
            call.args[4] % JOINT_PALETTE_FLOATS === 0,
        ),
    ).toBe(true);
  });

  it("skips a skinned caster when the caster pipeline fails to compile", () => {
    registerSkinningPipeline();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const device = harness.gpu.device as GpuDevice;
      const create = device.createRenderPipeline.bind(device);
      device.createRenderPipeline = (descriptor) => {
        const label = (descriptor as { label?: string }).label ?? "";
        if (label.startsWith("fourJS:skinned-shadow")) {
          throw new Error("skinned shadow refused");
        }
        return create(descriptor);
      };
      const { root } = shadowedScene();
      const skinned = new Renderable(
        skinnedTriangle(litTriangle()).asGeometry,
        new TestLitMaterial().asMaterial,
      );
      withSkeleton(skinned);
      root.add(skinned);

      harness.renderer.render(root, [createView()]);
      harness.renderer.render(root, [createView()]);

      const names = harness.gpu.calls.map((call) => call.name);
      const shadowStart = names.indexOf("encoder.beginRenderPass");
      const viewsStart = names.indexOf(
        "encoder.beginRenderPass",
        shadowStart + 1,
      );
      const casterDraws = names
        .slice(shadowStart, viewsStart)
        .filter((name) => name === "pass.draw" || name === "pass.drawIndexed");
      expect(casterDraws).toHaveLength(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain(
        "skinned shadow pipeline failed",
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("disposes the palette with the renderer and forgets it on device loss", async () => {
    registerSkinningPipeline();
    const live = await initialized();
    const node = renderable(skinnedTriangle());
    withSkeleton(node);
    live.renderer.render(node, [createView()]);
    live.gpu.reset();
    live.renderer.dispose();
    expect(live.gpu.callsOf("buffer.destroy").length).toBeGreaterThan(0);

    const lost = await initialized();
    const lostNode = renderable(skinnedTriangle());
    withSkeleton(lostNode);
    lost.renderer.render(lostNode, [createView()]);
    lost.gpu.reset();
    lost.gpu.loseDevice();
    await Promise.resolve();
    await Promise.resolve();
    expect(lost.renderer.deviceLost).toBe(true);
    expect(lost.gpu.countOf("buffer.destroy")).toBe(0);
    lost.renderer.dispose();
    expect(lost.gpu.countOf("buffer.destroy")).toBe(0);
  });

  it("draws a vertex-coloured skinned-unlit mesh", () => {
    registerSkinningPipeline();
    const geometry = skinnedTriangle(triangle(new Float32Array(12).fill(1)));
    const material = new TestMaterial();
    material.vertexColors = true;
    const node = renderable(geometry, material);
    withSkeleton(node);
    harness.renderer.render(node, [createView()]);
    expect(
      pipelineLabels(harness.gpu).some((label) =>
        label.startsWith("fourJS:skinned-unlit|vc|"),
      ),
    ).toBe(true);
  });

  it("samples a map on a skinned-unlit draw and skips a disposed map", () => {
    registerSkinningPipeline();
    const material = new TestMaterial();
    material.map = new TestTexture();
    const node = renderable(skinnedTriangle(texturedTriangle()), material);
    withSkeleton(node);
    harness.renderer.render(node, [createView()]);
    expect(
      pipelineLabels(harness.gpu).some(
        (label) => label.includes("skinned-unlit|") && label.includes("|map|"),
      ),
    ).toBe(true);
    expect(bindGroupOffsets(harness.gpu, 2).length).toBeGreaterThan(0);

    material.map.dispose();
    harness.gpu.reset();
    harness.renderer.render(node, [createView()]);
    expect(harness.gpu.countOf("pass.draw")).toBe(1);
  });
});

describe("WebgpuRenderer one-target GPU morph (RFC 0003 WP-SK.4)", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await initialized();
  });

  afterEach(() => {
    harness.renderer.dispose();
  });

  /** A triangle (optionally with normals) carrying the first morph target. */
  function morphTriangle(withNormals: boolean): TestGeometry {
    const geometry = withNormals ? litTriangle() : triangle();
    Object.assign(geometry, {
      positions1: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
    });
    if (withNormals) {
      Object.assign(geometry, {
        normals1: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
      });
    }
    return geometry;
  }

  function morphing(node: Renderable, weight: number): Renderable {
    (
      node as unknown as { morphTargetWeights: Float32Array }
    ).morphTargetWeights = new Float32Array([weight]);
    return node;
  }

  /** The morph-weight word of every uniform block in the frame's upload. */
  function weightWords(): number[] {
    const data = uniformUpload(harness.gpu);
    const words: number[] = [];
    for (let at = 0; at < data.length; at += UNIFORM_STRIDE_BYTES / 4) {
      words.push(data[at + DRAW_MORPH_WEIGHT_OFFSET / 4]);
    }
    return words;
  }

  function shaderLabels(): string[] {
    return harness.gpu
      .callsOf("device.createShaderModule")
      .map((call) => String((call.args[0] as { label?: string }).label));
  }

  it("draws an unlit morph mesh with a second vertex stream and its own pipeline", () => {
    const root = createRoot();
    root.add(morphing(renderable(morphTriangle(false)), 0.25));
    harness.renderer.render(root, [createView()]);

    expect(shaderLabels()).toContain("fourJS:unlit|mo:p");
    expect(
      harness.gpu.callsOf("pass.setVertexBuffer").map((call) => call.args[0]),
    ).toEqual([0, 1]);
    expect(harness.gpu.countOf("pass.draw")).toBeGreaterThanOrEqual(1);
    const uploads = harness.gpu
      .callsOf("device.createBuffer")
      .map((call) => String((call.args[0] as { label?: string }).label));
    expect(
      uploads.some((label) => label.startsWith("fourJS:positions1:")),
    ).toBe(true);
    const code = harness.gpu
      .callsOf("device.createShaderModule")
      .map((call) => (call.args[0] as { code: string }).code)
      .find((source) => source.includes("position1"));
    expect(code).toContain("mix(position, position1, draw.normalColumn0.w)");
  });

  it("draws a lit morph mesh with position1 and normal1 streams", () => {
    const root = createRoot();
    root.add(
      morphing(
        new Renderable(
          morphTriangle(true).asGeometry,
          new TestLitMaterial().asMaterial,
        ),
        0.5,
      ),
    );
    harness.renderer.render(root, [createView()]);

    expect(shaderLabels()).toContain("fourJS:lit|n|mo:pn");
    // position, normal, position1, normal1 — one counter.
    expect(
      harness.gpu.callsOf("pass.setVertexBuffer").map((call) => call.args[0]),
    ).toEqual([0, 1, 2, 3]);
    const code = harness.gpu
      .callsOf("device.createShaderModule")
      .map((call) => (call.args[0] as { code: string }).code)
      .find((source) => source.includes("normal1"));
    expect(code).toContain("mix(normal, normal1, draw.normalColumn0.w)");
    expect(code).toContain("mix(position, position1, draw.normalColumn0.w)");
  });

  it("morphs positions only when a lit mesh has no normals1", () => {
    const root = createRoot();
    const geometry = morphTriangle(true);
    Object.assign(geometry, { normals1: undefined });
    root.add(
      new Renderable(geometry.asGeometry, new TestLitMaterial().asMaterial),
    );
    harness.renderer.render(root, [createView()]);
    expect(shaderLabels()).toContain("fourJS:lit|n|mo:p");
    expect(
      harness.gpu.callsOf("pass.setVertexBuffer").map((call) => call.args[0]),
    ).toEqual([0, 1, 2]);
  });

  it("leaves a non-morph mesh on the original pipeline and memo path", () => {
    const root = createRoot();
    root.add(renderable(triangle()));
    root.add(renderable(triangle()));
    harness.renderer.render(root, [createView()]);
    expect(shaderLabels().filter((label) => label.includes("mo:"))).toEqual([]);
    // Clear + one unlit pipeline shared by both draws.
    expect(harness.gpu.countOf("device.createRenderPipeline")).toBe(2);
    expect(
      harness.gpu.callsOf("pass.setVertexBuffer").map((call) => call.args[0]),
    ).toEqual([0, 0]);
    expect(
      harness.gpu
        .callsOf("device.createBuffer")
        .some((call) =>
          String((call.args[0] as { label?: string }).label).includes(
            "positions1",
          ),
        ),
    ).toBe(false);
  });

  it("keeps morph and plain unlit pipelines distinct in one frame", () => {
    const root = createRoot();
    root.add(renderable(triangle()));
    root.add(morphing(renderable(morphTriangle(false)), 1));
    harness.renderer.render(root, [createView()]);
    // Clear + plain unlit + morph unlit.
    expect(harness.gpu.countOf("device.createRenderPipeline")).toBe(3);
  });

  it("writes morphWeights[0] into the draw uniform and tracks updates", () => {
    const root = createRoot();
    const node = morphing(renderable(morphTriangle(false)), 0.25);
    root.add(node);
    harness.renderer.render(root, [createView()]);
    expect(weightWords()).toContain(0.25);

    harness.gpu.reset();
    morphing(node, 0.75);
    harness.renderer.render(root, [createView()]);
    expect(weightWords()).toContain(0.75);
    expect(weightWords()).not.toContain(0.25);
    // Same variant: no new pipeline on the second frame.
    expect(harness.gpu.countOf("device.createRenderPipeline")).toBe(0);
  });

  it("defaults the weight to 0 when the node carries none", () => {
    const root = createRoot();
    root.add(renderable(morphTriangle(false)));
    harness.renderer.render(root, [createView()]);
    expect(weightWords().every((word) => word === 0)).toBe(true);
  });
});

describe("WebgpuRenderer standard surface maps (WP-W4.2)", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await initialized();
  });

  afterEach(() => {
    harness.renderer.dispose();
  });

  function uvTriangle(): TestGeometry {
    const geometry = litTriangle();
    geometry.uvs = new Float32Array([0, 0, 1, 0, 0.5, 1]);
    return geometry;
  }

  function draw(
    material: TestStandardMaterial,
    geometry: TestGeometry = uvTriangle(),
  ): void {
    const root = createRoot();
    root.add(new Renderable(geometry.asGeometry, material.asMaterial));
    harness.renderer.render(root, [createView()]);
  }

  function surfaceGroups(): { entries: { binding: number }[] }[] {
    return harness.gpu
      .callsOf("device.createBindGroup")
      .map(
        (call) =>
          call.args[0] as { label?: string; entries: { binding: number }[] },
      )
      .filter((desc) => desc.label === "fourJS:surface");
  }

  it("binds the five-entry surface group at group 2 for a normal map", () => {
    const material = new TestStandardMaterial();
    material.normalMap = new TestTexture();
    draw(material);

    expect(moduleLabels(harness.gpu)).toContain("fourJS:standard|n|nm");
    expect(layoutLabels(harness.gpu)).toContain("fourJS:surface");
    const groups = surfaceGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]?.entries.map((e) => e.binding)).toEqual([0, 1, 2, 3, 4]);
    expect(bindGroupOffsets(harness.gpu, 2)).toHaveLength(1);
    expect(bindGroupOffsets(harness.gpu, 3)).toEqual([]);
    expect(
      pipelineLabels(harness.gpu).some((label) => label.endsWith("|nm:y")),
    ).toBe(true);
    // One allocation for the map, plus the 1x1 defaults for the other slots.
    expect(mapAllocations(harness.gpu)).toBe(1);
    const defaults = harness.gpu
      .callsOf("device.createTexture")
      .filter((call) =>
        String((call.args[0] as { label?: string }).label).startsWith(
          "fourJS:surface-default:",
        ),
      );
    expect(defaults).toHaveLength(4 - 1);
  });

  it("places the surface group at 3 behind albedo and keys each map", () => {
    const material = new TestStandardMaterial();
    material.map = new TestTexture();
    material.normalMap = new TestTexture();
    material.occlusionMap = new TestTexture();
    material.emissiveMap = new TestTexture();
    draw(material);

    expect(moduleLabels(harness.gpu)).toContain(
      "fourJS:standard|n|map|nm|oc|em",
    );
    expect(bindGroupOffsets(harness.gpu, 2)).toHaveLength(1);
    expect(bindGroupOffsets(harness.gpu, 3)).toHaveLength(1);
    expect(
      pipelineLabels(harness.gpu).some((label) =>
        label.endsWith("|nm:y|oc:y|em:y"),
      ),
    ).toBe(true);
  });

  it("includes the metallic-roughness map in the same group", () => {
    const material = new TestStandardMaterial();
    material.metalRoughnessMap = new TestTexture();
    material.emissiveMap = new TestTexture();
    draw(material);
    expect(moduleLabels(harness.gpu)).toContain("fourJS:standard|n|mr|em");
    expect(surfaceGroups()).toHaveLength(1);
    const code = harness.gpu
      .callsOf("device.createShaderModule")
      .map((call) => call.args[0] as { label?: string; code: string })
      .find((module) => module.label === "fourJS:standard|n|mr|em")?.code;
    expect(code).toContain("textureSample(mrTexture, surfaceSampler");
  });

  it("keeps the absent-map path on the old key, layout and defaults", () => {
    draw(new TestStandardMaterial());
    expect(moduleLabels(harness.gpu)).toContain("fourJS:standard|n");
    expect(
      pipelineLabels(harness.gpu).some((label) => label.includes("|nm:")),
    ).toBe(false);
    expect(layoutLabels(harness.gpu)).not.toContain("fourJS:surface");
    expect(surfaceGroups()).toEqual([]);
    expect(
      harness.gpu
        .callsOf("device.createTexture")
        .some((call) =>
          String((call.args[0] as { label?: string }).label).startsWith(
            "fourJS:surface-default:",
          ),
        ),
    ).toBe(false);
  });

  it("degrades to the scalar variant without uvs and skips an unresolved map", () => {
    const material = new TestStandardMaterial();
    material.normalMap = new TestTexture();
    draw(material, litTriangle());
    expect(moduleLabels(harness.gpu)).toContain("fourJS:standard|n");

    const disposed = new TestStandardMaterial();
    disposed.occlusionMap = new TestTexture();
    disposed.occlusionMap.dispose();
    harness.gpu.reset();
    draw(disposed);
    expect(
      moduleLabels(harness.gpu).some((label) => label.includes("standard")),
    ).toBe(false);
  });

  it("shares one bind group between draws of the same maps", () => {
    const material = new TestStandardMaterial();
    material.normalMap = new TestTexture();
    const root = createRoot();
    root.add(new Renderable(uvTriangle().asGeometry, material.asMaterial));
    root.add(new Renderable(uvTriangle().asGeometry, material.asMaterial));
    harness.renderer.render(root, [createView()]);
    expect(surfaceGroups()).toHaveLength(1);
    expect(bindGroupOffsets(harness.gpu, 2)).toHaveLength(2);
  });

  it("writes normalScale - 1 and occlusionStrength - 1 into the block", () => {
    const material = new TestStandardMaterial();
    material.normalMap = new TestTexture();
    material.normalScale = 2.5;
    material.occlusionStrength = 0.25;
    draw(material);
    const data = drawUniformUpload(harness.gpu);
    const base = 208 / 4;
    const found = [];
    for (let at = 0; at < data.length; at += UNIFORM_STRIDE_BYTES / 4) {
      found.push([data[at + base + 2], data[at + base + 3]]);
    }
    expect(found).toContainEqual([1.5, -0.75]);
  });

  it("writes 0 / 0 when the material carries no scale fields", () => {
    draw(new TestStandardMaterial());
    const data = drawUniformUpload(harness.gpu);
    const base = 208 / 4;
    const found = [];
    for (let at = 0; at < data.length; at += UNIFORM_STRIDE_BYTES / 4) {
      found.push([data[at + base + 2], data[at + base + 3]]);
    }
    expect(found).toContainEqual([0, 0]);
  });

  it("releases the surface defaults on dispose", () => {
    const material = new TestStandardMaterial();
    material.emissiveMap = new TestTexture();
    draw(material);
    harness.renderer.dispose();
    expect(harness.gpu.countOf("texture.destroy")).toBeGreaterThanOrEqual(3);
  });
});

describe("WebgpuRenderer standard-family GPU morph (WP-W4.2b)", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await initialized();
  });

  afterEach(() => {
    harness.renderer.dispose();
  });

  function morphGeometry(withNormals: boolean): TestGeometry {
    const geometry = litTriangle();
    Object.assign(geometry, {
      positions1: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
    });
    if (withNormals) {
      Object.assign(geometry, {
        normals1: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
      });
    }
    return geometry;
  }

  function morphNode(geometry: TestGeometry, weight: number): Renderable {
    const node = new Renderable(
      geometry.asGeometry,
      new TestStandardMaterial().asMaterial,
    );
    (
      node as unknown as { morphTargetWeights: Float32Array }
    ).morphTargetWeights = new Float32Array([weight]);
    return node;
  }

  it("draws a standard morph mesh with position1 and normal1 streams", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const root = createRoot();
    root.add(morphNode(morphGeometry(true), 0.5));
    harness.renderer.render(root, [createView()]);

    expect(moduleLabels(harness.gpu)).toContain("fourJS:standard|n|mo:pn");
    expect(
      pipelineLabels(harness.gpu).some((label) => label.endsWith("|mo:pn")),
    ).toBe(true);
    expect(
      harness.gpu.callsOf("pass.setVertexBuffer").map((call) => call.args[0]),
    ).toEqual([0, 1, 2, 3]);
    const code = harness.gpu
      .callsOf("device.createShaderModule")
      .map((call) => (call.args[0] as { code: string }).code)
      .find((source) => source.includes("normal1"));
    expect(code).toContain("mix(position, position1, draw.normalColumn0.w)");
    expect(code).toContain("mix(normal, normal1, draw.normalColumn0.w)");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("morphs positions only when there is no normals1", () => {
    const root = createRoot();
    root.add(morphNode(morphGeometry(false), 1));
    harness.renderer.render(root, [createView()]);
    expect(moduleLabels(harness.gpu)).toContain("fourJS:standard|n|mo:p");
    expect(
      harness.gpu.callsOf("pass.setVertexBuffer").map((call) => call.args[0]),
    ).toEqual([0, 1, 2]);
  });

  it("carries the weight in the standard block's normal-matrix pad word", () => {
    const root = createRoot();
    root.add(morphNode(morphGeometry(true), 0.25));
    harness.renderer.render(root, [createView()]);
    const data = drawUniformUpload(harness.gpu);
    const words = [];
    for (let at = 0; at < data.length; at += UNIFORM_STRIDE_BYTES / 4) {
      words.push(data[at + DRAW_MORPH_WEIGHT_OFFSET / 4]);
    }
    expect(words).toContain(0.25);
  });

  it("composes with a normal map and a following non-morph standard draw", () => {
    const root = createRoot();
    const geometry = morphGeometry(true);
    geometry.uvs = new Float32Array([0, 0, 1, 0, 0.5, 1]);
    const node = new Renderable(
      geometry.asGeometry,
      (() => {
        const m = new TestStandardMaterial();
        m.normalMap = new TestTexture();
        return m.asMaterial;
      })(),
    );
    (
      node as unknown as { morphTargetWeights: Float32Array }
    ).morphTargetWeights = new Float32Array([0.5]);
    root.add(node);
    root.add(
      new Renderable(
        litTriangle().asGeometry,
        new TestStandardMaterial().asMaterial,
      ),
    );
    harness.renderer.render(root, [createView()]);
    expect(moduleLabels(harness.gpu)).toContain("fourJS:standard|n|mo:pn|nm");
    expect(moduleLabels(harness.gpu)).toContain("fourJS:standard|n");
  });
});
