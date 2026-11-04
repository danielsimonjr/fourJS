/**
 * §60's node materials on a real WebGPU adapter (WP-R1.9, 2026-08-29) — the
 * emitter's real-GPU gate, and the WebGPU twin of `node-material.spec.ts`.
 *
 * Three claims, per the WP-R1.4 variant-evidence rule (*a variant family's
 * browser evidence covers only the variants it compiles*):
 *
 * 1. **Every emitted-WGSL module shape compiles and rasterises.** The emitter
 *    generates per graph, so "shapes" here are the structural variants the
 *    generator can produce: the block-only surface module, the full surface
 *    module (every uniform lane type, a sampled texture, §9 time, a
 *    displacement, normal/uv varyings), the textures-only screen module, the
 *    textures-plus-block screen module, and the block-at-group-0 screen
 *    module. Each is emitted by `emitShaderGraphWgsl` on the Node side —
 *    never retyped — compiled on the page against the layouts the emitted
 *    record declares as data, drawn, and read back to an exact,
 *    specification-fixed texel.
 * 2. **A radial gradient node graph renders exactly through the real
 *    renderer** — the GL spec's claim, on this backend's registered pipeline
 *    end to end (`registerWebgpuNodeMaterialPipeline()` → render into a
 *    target → `readPixels`), asserted analytically within 3/255 plus the
 *    centre/corner separation no per-vertex path can produce. No golden
 *    (§92; R-1 plan §5).
 * 3. **§70's `"graph"` kind draws through `renderEffect`** — the R1.6
 *    absence, retired: a gain graph over a specification-fixed source halves
 *    each channel within quantisation tolerance.
 *
 * The screen-domain orientation decision gets its own line: the emitter
 * samples screen textures at `(u, 1 − v)` (a sampled target stores its
 * picture top-down here), so a graph copy of an asymmetric source must be a
 * per-pixel identity, never a mirror.
 *
 * Mechanics follow the sibling specs' recorded decisions verbatim: page
 * programs are strings (no WebGPU typings are pinned), the page is *served*
 * (an opaque origin loses `navigator.gpu`), and the spec **skips** when
 * `requestAdapter()` resolves `null`.
 *
 * **Measured on the first run (2026-08-29, SwiftShader):** all five module
 * shapes compiled with no validation error and hit their exact texels; the
 * graph copy kept the top-red/bottom-blue source the identity; the radial
 * gradient's worst channel difference was 3/255 over 24 probes, in one draw
 * call; the §70 gain graph halved the specification-fixed source within
 * quantisation.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { emitShaderGraphWgsl } from "@fourjs/render-webgpu";
import type { ShaderGraph } from "@fourjs/render";
import { expect, test } from "@playwright/test";
import { build } from "vite";

import { surfaceScenario } from "../../determinism/helpers/node-shader-scenarios.js";

/** Restates `PORT` in `playwright.config.ts` — the site whose origin is borrowed. */
const PORT = 4173;

/** Raw-device readback size; 64 × 4 bytes meets the 256-byte bytesPerRow rule. */
const SIZE = 64;

/** The renderer fixture's target size, camera scale and quad, GL's verbatim. */
const WIDTH = 320;
const HEIGHT = 240;
const SCALE = 40;
const QUAD_HALF = 2;
const INNER = [1, 0.2, 0, 1];
const OUTER = [0, 0.2, 1, 1];

/** The §70 probe's constants, restated from the fixture. */
const SOURCE_COLOR = [0.5, 0.25, 0.125, 1];
const GAIN = 0.5;

/** Quantisation tolerance for arithmetic assertions, in 8-bit steps. */
const TOLERANCE = 3;

// ---------------------------------------------------------------------------
// The emitted module shapes (Node side — the real emitter, never retyped).
// ---------------------------------------------------------------------------

/** Shape 1: the block-only surface module — one constant colour. */
function minimalSurfaceGraph(): ShaderGraph {
  return {
    domain: "surface",
    nodes: [{ kind: "constant", type: "vec4", value: [1, 0.5, 0, 1] }],
    color: 0,
  };
}

/** Shape 3: the textures-only screen module — a §7a copy over `source`. */
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

/** Shape 4: textures plus a block at group 1 — `source × gain`. */
function screenGainGraph(): ShaderGraph {
  return {
    domain: "screen",
    nodes: [
      { kind: "attribute", name: "uv" },
      { kind: "texture", name: "source", uv: 0 },
      { kind: "uniform", type: "float", name: "gain" },
      { kind: "binary", op: "multiply", left: 1, right: 2 },
    ],
    color: 3,
  };
}

/** Shape 5: a texture-less screen block at group 0 — §9 time as a grey. */
function screenTimeGraph(): ShaderGraph {
  return {
    domain: "screen",
    nodes: [
      { kind: "time" },
      { kind: "constant", type: "float", value: [1] },
      { kind: "compose", type: "vec4", parts: [0, 0, 0, 1] },
    ],
    color: 2,
  };
}

/**
 * Shape 2's uniform block, packed on the Node side over the golden surface
 * scenario's reflection (tint, gain, offset, axis, spin, warp — 11 lanes
 * after the 36-float prefix): identity matrices, opacity 1, time 0, values
 * chosen so the fragment reduces to the sampled texel exactly
 * (`saturate(texel × (I × 1⃗) + vec4(0⃗·0, sin(0)))`) and the displacement to
 * zero.
 */
function fullSurfaceBlock(): number[] {
  const floats = new Array<number>(36 + 11 * 4).fill(0);
  for (let i = 0; i < 4; i += 1) {
    floats[i * 5] = 1; // viewProjection = identity
    floats[16 + i * 5] = 1; // model = identity
  }
  floats[32] = 1; // opacity
  floats[33] = 0; // §9 render time
  const lanes = 36;
  floats[lanes] = 1; // tint = [1, 1, 1, 1]
  floats[lanes + 1] = 1;
  floats[lanes + 2] = 1;
  floats[lanes + 3] = 1;
  // gain, offset, axis, spin stay zero; warp = identity at lanes 7..10.
  for (let i = 0; i < 4; i += 1) {
    floats[lanes + (7 + i) * 4 + i] = 1;
  }
  return floats;
}

// ---------------------------------------------------------------------------
// Page programs (strings — no WebGPU typings are pinned; see webgpu-unlit).
// ---------------------------------------------------------------------------

/**
 * Compiles one emitted **surface** module against the layouts its record
 * declares, draws a full-viewport quad (positions, normals, uvs as the
 * emitted `vertexStreams` demand), and reads the centre texel back.
 */
const SURFACE_SCRIPT = `async (options) => {
  const { size, shader, blockBytes, blockFloats, streams, texel, storage } = options;
  if (navigator.gpu === undefined) return { adapter: false };
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) return { adapter: false };
  const device = await adapter.requestDevice();

  const target = device.createTexture({
    size: [size, size],
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const readback = device.createBuffer({
    size: size * size * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  const blockLayout = device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: { type: "uniform", minBindingSize: blockBytes },
    }],
  });
  const uniforms = device.createBuffer({
    size: blockBytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniforms, 0, new Float32Array(blockFloats));
  const groups = [blockLayout];
  const bindGroups = [device.createBindGroup({
    layout: blockLayout,
    entries: [{ binding: 0, resource: { buffer: uniforms, offset: 0, size: blockBytes } }],
  })];

  if (texel !== null) {
    // One 1×1 texture per sampler pair, every texel the same known colour.
    const textureLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float", viewDimension: "2d" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" } },
      ],
    });
    const texture = device.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture },
      new Uint8Array(texel),
      { bytesPerRow: 256 },
      [1, 1],
    );
    const sampler = device.createSampler({
      addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge",
      magFilter: "nearest", minFilter: "nearest", mipmapFilter: "nearest",
    });
    groups.push(textureLayout);
    bindGroups.push(device.createBindGroup({
      layout: textureLayout,
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: sampler },
      ],
    }));
  }

  if (storage !== undefined && storage.length > 0) {
    // RFC 0001 addendum (§82): one read-only storage buffer per reflected
    // buffer, bound at consecutive bindings of the group after the textures'.
    const storageLayout = device.createBindGroupLayout({
      entries: storage.map((_, binding) => ({
        binding,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "read-only-storage" },
      })),
    });
    const storageEntries = storage.map((values, binding) => {
      const data = new Float32Array(values);
      const buffer = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, data);
      return { binding, resource: { buffer } };
    });
    groups.push(storageLayout);
    bindGroups.push(device.createBindGroup({ layout: storageLayout, entries: storageEntries }));
  }

  // A quad from two triangles at z = 0, covering most of clip space.
  const corners = [-0.9, -0.9, 0.9, -0.9, 0.9, 0.9, -0.9, -0.9, 0.9, 0.9, -0.9, 0.9];
  const buffers = [];
  const layouts = [];
  for (const stream of streams) {
    const data = [];
    for (let vertex = 0; vertex < 6; vertex += 1) {
      if (stream.kind === "position") {
        data.push(corners[vertex * 2], corners[vertex * 2 + 1], 0);
      } else if (stream.kind === "normal") {
        data.push(0, 0, 1);
      } else if (stream.kind === "uv") {
        data.push((corners[vertex * 2] + 0.9) / 1.8, (corners[vertex * 2 + 1] + 0.9) / 1.8);
      } else {
        data.push(1, 1, 1, 1);
      }
    }
    const floats = new Float32Array(data);
    const buffer = device.createBuffer({
      size: floats.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, floats);
    buffers.push(buffer);
    layouts.push({
      arrayStride: stream.strideFloats * 4,
      stepMode: "vertex",
      attributes: [{
        format: "float32x" + String(stream.strideFloats),
        offset: 0,
        shaderLocation: stream.location,
      }],
    });
  }

  device.pushErrorScope("validation");
  const module = device.createShaderModule({ code: shader });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: groups }),
    vertex: { module, entryPoint: "vertexMain", buffers: layouts },
    fragment: {
      module,
      entryPoint: "fragmentMain",
      targets: [{ format: "rgba8unorm", writeMask: 0xf }],
    },
    primitive: { topology: "triangle-list" },
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: target.createView(),
      loadOp: "clear",
      storeOp: "store",
      clearValue: [0, 0, 0, 0],
    }],
  });
  pass.setPipeline(pipeline);
  for (let index = 0; index < bindGroups.length; index += 1) {
    pass.setBindGroup(index, bindGroups[index]);
  }
  for (let slot = 0; slot < buffers.length; slot += 1) {
    pass.setVertexBuffer(slot, buffers[slot]);
  }
  pass.draw(6);
  pass.end();
  encoder.copyTextureToBuffer(
    { texture: target },
    { buffer: readback, bytesPerRow: size * 4, rowsPerImage: size },
    [size, size],
  );
  device.queue.submit([encoder.finish()]);
  const error = await device.popErrorScope();

  await readback.mapAsync(GPUMapMode.READ);
  const pixels = new Uint8Array(readback.getMappedRange().slice(0));
  readback.unmap();
  const centre = ((size / 2) * size + size / 2) * 4;
  return {
    adapter: true,
    error: error === null ? null : String(error.message),
    centre: Array.from(pixels.slice(centre, centre + 4)),
  };
}`;

/**
 * Compiles one emitted **screen** module: an asymmetric source (top half red,
 * bottom half blue), the emitted bind groups (textures at group 0 when
 * sampled, the block at its emitted group), one full-screen triangle, and a
 * texel from each half read back.
 */
const SCREEN_SCRIPT = `async (options) => {
  const { size, shader, blockBytes, blockFloats, blockGroup, withTexture } = options;
  if (navigator.gpu === undefined) return { adapter: false };
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) return { adapter: false };
  const device = await adapter.requestDevice();

  const target = device.createTexture({
    size: [size, size],
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const readback = device.createBuffer({
    size: size * size * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  const groups = [];
  const bindGroups = [];
  if (withTexture) {
    const textureLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float", viewDimension: "2d" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" } },
      ],
    });
    // Top half red, bottom half blue — texel row 0 is the top of the
    // picture, which is what makes the copy's orientation assertable.
    const source = device.createTexture({
      size: [size, size],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const texels = new Uint8Array(size * size * 4);
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        const index = (row * size + column) * 4;
        texels[index] = row < size / 2 ? 255 : 0;
        texels[index + 2] = row < size / 2 ? 0 : 255;
        texels[index + 3] = 255;
      }
    }
    device.queue.writeTexture(
      { texture: source },
      texels,
      { bytesPerRow: size * 4, rowsPerImage: size },
      [size, size],
    );
    const sampler = device.createSampler({
      addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge",
      magFilter: "nearest", minFilter: "nearest", mipmapFilter: "nearest",
    });
    groups.push(device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float", viewDimension: "2d" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" } },
      ],
    }));
    bindGroups.push(device.createBindGroup({
      layout: groups[0],
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: sampler },
      ],
    }));
  }
  if (blockBytes > 0) {
    const blockLayout = device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform", minBindingSize: blockBytes },
      }],
    });
    const uniforms = device.createBuffer({
      size: blockBytes,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(uniforms, 0, new Float32Array(blockFloats));
    while (groups.length < blockGroup) groups.push(null);
    groups[blockGroup] = blockLayout;
    bindGroups[blockGroup] = device.createBindGroup({
      layout: blockLayout,
      entries: [{ binding: 0, resource: { buffer: uniforms, offset: 0, size: blockBytes } }],
    });
  }

  device.pushErrorScope("validation");
  const module = device.createShaderModule({ code: shader });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: groups }),
    vertex: { module, entryPoint: "vertexMain", buffers: [] },
    fragment: {
      module,
      entryPoint: "fragmentMain",
      targets: [{ format: "rgba8unorm", writeMask: 0xf }],
    },
    primitive: { topology: "triangle-list" },
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: target.createView(),
      loadOp: "clear",
      storeOp: "store",
      clearValue: [0, 0, 0, 0],
    }],
  });
  pass.setPipeline(pipeline);
  for (let index = 0; index < bindGroups.length; index += 1) {
    if (bindGroups[index]) pass.setBindGroup(index, bindGroups[index]);
  }
  pass.draw(3);
  pass.end();
  encoder.copyTextureToBuffer(
    { texture: target },
    { buffer: readback, bytesPerRow: size * 4, rowsPerImage: size },
    [size, size],
  );
  device.queue.submit([encoder.finish()]);
  const error = await device.popErrorScope();

  await readback.mapAsync(GPUMapMode.READ);
  const pixels = new Uint8Array(readback.getMappedRange().slice(0));
  readback.unmap();
  const at = (row, column) => Array.from(
    pixels.slice((row * size + column) * 4, (row * size + column) * 4 + 4),
  );
  return {
    adapter: true,
    error: error === null ? null : String(error.message),
    top: at(4, size / 2),
    bottom: at(size - 4, size / 2),
  };
}`;

interface SurfaceResult {
  readonly adapter: boolean;
  readonly error: string | null;
  readonly centre: number[];
}

interface ScreenResult {
  readonly adapter: boolean;
  readonly error: string | null;
  readonly top: number[];
  readonly bottom: number[];
}

async function inPage<T>(
  page: import("@playwright/test").Page,
  program: string,
  options: unknown,
): Promise<T> {
  return await page.evaluate(`(${program})(${JSON.stringify(options)})`);
}

/** The emitted vertex streams, as the page program consumes them. */
function pageStreams(
  emitted: ReturnType<typeof emitShaderGraphWgsl>,
): { kind: string; strideFloats: number; location: number }[] {
  const locations: Record<string, number> = {
    position: 0,
    color: 1,
    uv: 2,
    normal: 3,
  };
  const strides: Record<string, number> = {
    position: 3,
    color: 4,
    uv: 2,
    normal: 3,
  };
  return emitted.vertexStreams.map((stream) => ({
    kind: stream,
    strideFloats: strides[stream],
    location: locations[stream],
  }));
}

const SKIP = "no WebGPU adapter — is --enable-unsafe-webgpu still set?";

test.describe("§60 node materials on a real WebGPU adapter (WP-R1.9)", () => {
  test("the block-only and full surface module shapes compile and rasterise", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);

    const minimal = emitShaderGraphWgsl(minimalSurfaceGraph());
    const minimalResult = await inPage<SurfaceResult>(page, SURFACE_SCRIPT, {
      size: SIZE,
      shader: minimal.code,
      blockBytes: minimal.blockBytes,
      blockFloats: fullSurfaceBlock().slice(0, minimal.blockBytes / 4),
      streams: pageStreams(minimal),
      texel: null,
    });
    test.skip(!minimalResult.adapter, SKIP);
    expect(minimalResult.error).toBeNull();
    expect(minimalResult.centre[0]).toBe(255);
    expect(Math.abs(minimalResult.centre[1] - 128)).toBeLessThanOrEqual(
      TOLERANCE,
    );
    expect(minimalResult.centre[2]).toBe(0);

    // The full shape: every uniform lane type, a texture, time, displacement,
    // and two varyings — the golden scenario itself, on a real front end. The
    // block values reduce the fragment to the sampled texel (green).
    const full = emitShaderGraphWgsl(surfaceScenario());
    const fullResult = await inPage<SurfaceResult>(page, SURFACE_SCRIPT, {
      size: SIZE,
      shader: full.code,
      blockBytes: full.blockBytes,
      blockFloats: fullSurfaceBlock(),
      streams: pageStreams(full),
      texel: [0, 255, 0, 255],
    });
    expect(fullResult.error).toBeNull();
    expect(fullResult.centre[0]).toBe(0);
    expect(fullResult.centre[1]).toBe(255);
    expect(fullResult.centre[2]).toBe(0);
    expect(fullResult.centre[3]).toBe(255);
  });

  test("a storage-buffer node and a lights-family read compile and rasterise (RFC 0001 addendum)", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);

    // §82: element 2 of a vec4 storage buffer is the fragment colour.
    const storageGraph: ShaderGraph = {
      domain: "surface",
      nodes: [
        { kind: "constant", type: "float", value: [2] },
        { kind: "storage", name: "pal", type: "vec4", count: 4, index: 0 },
      ],
      color: 1,
    };
    const storage = emitShaderGraphWgsl(storageGraph);
    expect(storage.storageGroup).toBe(1);
    const storageResult = await inPage<SurfaceResult>(page, SURFACE_SCRIPT, {
      size: SIZE,
      shader: storage.code,
      blockBytes: storage.blockBytes,
      blockFloats: fullSurfaceBlock().slice(0, storage.blockBytes / 4),
      streams: pageStreams(storage),
      texel: null,
      storage: [[1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 1, 1, 1, 1]],
    });
    test.skip(!storageResult.adapter, SKIP);
    expect(storageResult.error).toBeNull();
    expect(storageResult.centre).toEqual([0, 0, 255, 255]);

    // §68: the ambient member rides the node block's tail.
    const lightsGraph: ShaderGraph = {
      domain: "surface",
      nodes: [
        { kind: "light", member: "ambient" },
        { kind: "constant", type: "float", value: [1] },
        { kind: "compose", type: "vec4", parts: [0, 1] },
      ],
      color: 2,
    };
    const lights = emitShaderGraphWgsl(lightsGraph);
    const block = new Array<number>(lights.blockBytes / 4).fill(0);
    block.splice(0, 36, ...fullSurfaceBlock().slice(0, 36));
    block[lights.lightsByteOffset / 4 + 1] = 1; // ambient = (0, 1, 0)
    const lightsResult = await inPage<SurfaceResult>(page, SURFACE_SCRIPT, {
      size: SIZE,
      shader: lights.code,
      blockBytes: lights.blockBytes,
      blockFloats: block,
      streams: pageStreams(lights),
      texel: null,
    });
    expect(lightsResult.error).toBeNull();
    expect(lightsResult.centre).toEqual([0, 255, 0, 255]);
  });

  test("the three screen module shapes compile; a graph copy is the identity", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);

    // Shape 3: the copy — and the orientation decision, measured: the source
    // is top-red/bottom-blue, and an identity copy keeps it that way; the
    // `(u, 1 − v)` sample flip getting lost would mirror it.
    const copy = emitShaderGraphWgsl(screenCopyGraph());
    const copyResult = await inPage<ScreenResult>(page, SCREEN_SCRIPT, {
      size: SIZE,
      shader: copy.code,
      blockBytes: 0,
      blockFloats: [],
      blockGroup: -1,
      withTexture: true,
    });
    test.skip(!copyResult.adapter, SKIP);
    expect(copyResult.error).toBeNull();
    expect(copyResult.top.slice(0, 3)).toEqual([255, 0, 0]);
    expect(copyResult.bottom.slice(0, 3)).toEqual([0, 0, 255]);

    // Shape 4: textures at group 0 plus the block behind them at group 1.
    const gain = emitShaderGraphWgsl(screenGainGraph());
    const gainResult = await inPage<ScreenResult>(page, SCREEN_SCRIPT, {
      size: SIZE,
      shader: gain.code,
      blockBytes: gain.blockBytes,
      blockFloats: [0, 0, 0, 0, GAIN, 0, 0, 0],
      blockGroup: gain.blockGroup,
      withTexture: true,
    });
    expect(gainResult.error).toBeNull();
    expect(Math.abs(gainResult.top[0] - 128)).toBeLessThanOrEqual(TOLERANCE);
    expect(gainResult.top[2]).toBe(0);
    expect(Math.abs(gainResult.bottom[2] - 128)).toBeLessThanOrEqual(TOLERANCE);

    // Shape 5: a texture-less block at group 0 — §9 time as the red channel.
    const time = emitShaderGraphWgsl(screenTimeGraph());
    const timeResult = await inPage<ScreenResult>(page, SCREEN_SCRIPT, {
      size: SIZE,
      shader: time.code,
      blockBytes: time.blockBytes,
      blockFloats: [0.25, 0, 0, 0],
      blockGroup: time.blockGroup,
      withTexture: false,
    });
    expect(timeResult.error).toBeNull();
    expect(Math.abs(timeResult.top[0] - 64)).toBeLessThanOrEqual(TOLERANCE);
    expect(timeResult.top[3]).toBe(255);
  });

  test("a radial gradient graph renders exactly through the registered renderer", async ({
    page,
  }) => {
    const code = await bundleFixture();
    await page.goto(`http://localhost:${String(PORT)}/`);
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: code, type: "module" });
    await page.waitForSelector("body[data-webgpu-node-ready='1']", {
      timeout: 30_000,
    });

    const probe = (await page.evaluate(async () =>
      window.fourWebgpuNodeProbe?.(),
    )) as {
      adapter: boolean;
      error: string | null;
      pixels: number[];
      drawCalls: number;
    };
    test.skip(!probe.adapter, SKIP);
    expect(probe.error).toBeNull();
    expect(probe.drawCalls).toBe(1);
    expect(probe.pixels).toHaveLength(WIDTH * HEIGHT * 4);

    // Analytic agreement along the GL spec's scanline and diagonal, within
    // 3/255 per channel — `readPixels` rows are bottom-to-top (§7a), which is
    // exactly the GL readback order, so the arithmetic transfers verbatim.
    const pixelIndex = (worldX: number, worldY: number): number => {
      const px = Math.round(worldX * SCALE + WIDTH / 2);
      const py = Math.round(worldY * SCALE + HEIGHT / 2);
      return (py * WIDTH + px) * 4;
    };
    const analytic = (worldX: number, worldY: number): number[] => {
      const u = (worldX + QUAD_HALF) / (2 * QUAD_HALF);
      const v = (worldY + QUAD_HALF) / (2 * QUAD_HALF);
      const t = Math.min(1, 2 * Math.hypot(u - 0.5, v - 0.5));
      return [0, 1, 2].map((channel) =>
        Math.round(
          (INNER[channel] + (OUTER[channel] - INNER[channel]) * t) * 255,
        ),
      );
    };
    const probes: [number, number][] = [];
    for (let x = -1.8; x <= 1.8; x += 0.3) {
      probes.push([Number(x.toFixed(2)), 0]);
      probes.push([Number(x.toFixed(2)), Number((x / 2).toFixed(2))]);
    }
    let worst = 0;
    for (const [x, y] of probes) {
      const index = pixelIndex(x, y);
      const expected = analytic(x, y);
      for (let channel = 0; channel < 3; channel += 1) {
        worst = Math.max(
          worst,
          Math.abs(probe.pixels[index + channel] - expected[channel]),
        );
      }
    }
    console.log(
      `webgpu-node-material: ${String(probes.length)} probes, worst channel ` +
        `difference ${String(worst)}/255`,
    );
    expect(worst).toBeLessThanOrEqual(TOLERANCE);

    // The categorical half — the picture per-vertex interpolation cannot
    // produce, since all four corners share the outer colour.
    const centre = pixelIndex(0, 0);
    expect(probe.pixels[centre]).toBeGreaterThan(250); // R ≈ 255
    expect(probe.pixels[centre + 2]).toBeLessThan(5); // B ≈ 0
    const corner = pixelIndex(1.9, 1.9);
    expect(probe.pixels[corner]).toBeLessThan(5);
    expect(probe.pixels[corner + 2]).toBeGreaterThan(250);
    const outside = pixelIndex(2.5, 2.5);
    expect(probe.pixels[outside]).toBeLessThan(5);
    expect(probe.pixels[outside + 2]).toBeLessThan(5);
  });

  test("§70's graph kind draws through renderEffect — the R1.6 absence retired", async ({
    page,
  }) => {
    const code = await bundleFixture();
    await page.goto(`http://localhost:${String(PORT)}/`);
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: code, type: "module" });
    await page.waitForSelector("body[data-webgpu-node-ready='1']", {
      timeout: 30_000,
    });

    const probe = (await page.evaluate(async () =>
      window.fourWebgpuGraphEffectProbe?.(),
    )) as {
      adapter: boolean;
      error: string | null;
      source: number[];
      graded: number[];
    };
    test.skip(!probe.adapter, SKIP);
    expect(probe.error).toBeNull();
    // The source holds the specification-fixed clear.
    for (let channel = 0; channel < 4; channel += 1) {
      expect(
        Math.abs(
          probe.source[channel] - Math.round(SOURCE_COLOR[channel] * 255),
        ),
      ).toBeLessThanOrEqual(1);
    }
    // The gain graph halves each channel, within quantisation.
    for (let channel = 0; channel < 3; channel += 1) {
      expect(
        Math.abs(
          probe.graded[channel] -
            Math.round(SOURCE_COLOR[channel] * GAIN * 255),
        ),
      ).toBeLessThanOrEqual(TOLERANCE);
    }
  });
});

/** Bundles the fixture once per call — `node-material.spec.ts`'s shape. */
async function bundleFixture(): Promise<string> {
  const entry = fileURLToPath(
    new URL("../fixtures/webgpu-node-material-page.ts", import.meta.url),
  );
  if (!existsSync(entry)) {
    throw new Error(`fixture missing: ${entry}`);
  }
  const result = await build({
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      target: "es2022",
      lib: { entry, formats: ["es"], fileName: "webgpu-node-material-page" },
    },
  });
  const outputs: unknown = Array.isArray(result) ? result[0] : result;
  const chunks: unknown[] =
    typeof outputs === "object" && outputs !== null && "output" in outputs
      ? (outputs as { output: unknown[] }).output
      : [];
  let code = "";
  for (const chunk of chunks) {
    if (typeof chunk === "object" && chunk !== null && "code" in chunk) {
      code += `${String(chunk.code)}\n`;
    }
  }
  if (code === "") {
    throw new Error("the fixture bundled to nothing");
  }
  return code;
}
