/**
 * The shaded WGSL families on a real adapter (WP-R1.5, 2026-08-28).
 *
 * Two claims, per the WP-R1.4 variant-evidence rule (*a variant family's
 * browser evidence covers only the variants it compiles*):
 *
 * 1. **Every generated shaded module compiles and rasterises.** The lit and
 *    standard families each generate four WGSL modules (`normals` × `map`),
 *    and no fake-device transcript can prove any of the eight satisfies a real
 *    WGSL front end — the vc variant taught that lesson once. Each variant
 *    gets its own compile-and-rasterise line: a unit quad through the real
 *    pipeline layout tuple (per-draw block, light block at group 1, map at
 *    group 2), asserted lit by ambient light — a validation error or a black
 *    quad names its variant.
 * 2. **The lit pipeline shades a sphere brighter toward its point light** —
 *    §68's inverse-square lamp working end to end through `wgpu-lights.ts`'s
 *    block layout, asserted by threshold regions (left-vs-right mean
 *    luminance), never by golden (§92; R-1 plan §5).
 *
 * Mechanics follow the sibling specs' recorded decisions verbatim: the WGSL is
 * **imported** from `@fourjs/render-webgpu`, never retyped; the page program is
 * a string because this repository pins no WebGPU typings; the page is
 * *served* (an opaque origin loses `navigator.gpu`); the spec **skips** when
 * `requestAdapter()` resolves `null`.
 */

import {
  DRAW_UNIFORM_BYTES,
  LIGHT_BINDING_BYTES,
  LIGHT_PUNCTUAL_COLOR_OFFSET,
  LIGHT_PUNCTUAL_POSITION_OFFSET,
  STANDARD_UNIFORM_BYTES,
  litShaderSource,
  standardShaderSource,
} from "@fourjs/render-webgpu";
import { expect, test } from "@playwright/test";

/** Restates `PORT` in `playwright.config.ts` — the site whose origin is borrowed. */
const PORT = 4173;

/** Readback surface size; 128 × 4 bytes meets the 256-byte `bytesPerRow` rule. */
const SIZE = 128;

/** One shaded variant's page-side description. */
interface VariantCase {
  readonly name: string;
  readonly shader: string;
  readonly standard: boolean;
  readonly normals: boolean;
  readonly map: boolean;
}

/** All eight generated shaded modules, each its own compile line. */
function variantCases(): VariantCase[] {
  const cases: VariantCase[] = [];
  for (const standard of [false, true]) {
    for (const normals of [false, true]) {
      for (const map of [false, true]) {
        cases.push({
          name: `${standard ? "standard" : "lit"}${normals ? "|n" : ""}${map ? "|map" : ""}`,
          shader: standard
            ? standardShaderSource(normals, map)
            : litShaderSource(normals, map),
          standard,
          normals,
          map,
        });
      }
    }
  }
  return cases;
}

interface VariantResult {
  readonly name: string;
  readonly error: string | null;
  readonly center: number[];
}

interface CompileResult {
  readonly adapter: boolean;
  readonly variants: VariantResult[];
}

interface SphereResult {
  readonly adapter: boolean;
  readonly error: string | null;
  readonly leftMean: number;
  readonly rightMean: number;
  readonly background: number[];
}

/**
 * Shared page-side plumbing: layouts, the light block, and a draw helper —
 * one string, spliced into both programs, so the two cannot disagree about
 * the binding shapes the backend declares as data.
 *
 * The light block is written slot for slot to `wgpu-lights.ts`'s layout:
 * ambient at 0, direction at 16, directional colour at 32, eye at 48, the
 * f32 count at 64, then the four vec4-strided arrays from 80.
 */
const PAGE_PRELUDE = `
  const drawLayout = (device, size) => device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: { type: "uniform", minBindingSize: size },
    }],
  });
  const lightsLayout = (device, size) => device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT,
      buffer: { type: "uniform", minBindingSize: size },
    }],
  });
  const mapLayout = (device) => device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: "filtering" } },
    ],
  });
  const uniformBuffer = (device, floats) => {
    const buffer = device.createBuffer({
      size: floats.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, floats);
    return buffer;
  };
  // viewProjection = model = identity, colour opaque white,
  // normalMatrix identity (std140 mat3 at 144); the standard block then
  // widens with emissive (192) and surface (208).
  const drawBlock = (standard) => {
    const floats = new Float32Array(standard ? 56 : 48);
    for (let i = 0; i < 4; i += 1) {
      floats[i * 5] = 1;
      floats[16 + i * 5] = 1;
    }
    floats[32] = 1; floats[33] = 1; floats[34] = 1; floats[35] = 1;
    floats[36] = 1; floats[41] = 1; floats[46] = 1;
    if (standard) {
      floats[48] = 0.05; floats[49] = 0.05; floats[50] = 0.05;
      floats[52] = 0; floats[53] = 1;
    }
    return floats;
  };
  const lightBlock = (options) => {
    const floats = new Float32Array(lightBytes / 4);
    floats[0] = options.ambient; floats[1] = options.ambient; floats[2] = options.ambient;
    // direction (0,-1,0), directional colour dark so the lamp dominates.
    floats[5] = -1;
    floats[8] = options.sun; floats[9] = options.sun; floats[10] = options.sun;
    floats[14] = 2; // eye at (0, 0, 2)
    floats[16] = options.lamps;
    if (options.lamps > 0) {
      // punctualPosition[0] / punctualColor[0] byte offsets arrive as options.
      const position = options.positionOffset / 4;
      const color = options.colorOffset / 4;
      floats[position] = options.lampX; floats[position + 1] = 0;
      floats[position + 2] = options.lampZ;
      floats[color] = options.lampPower; floats[color + 1] = options.lampPower;
      floats[color + 2] = options.lampPower;
    }
    return floats;
  };
  const whiteTexture = (device) => {
    const texture = device.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture },
      new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: 256 },
      [1, 1],
    );
    return texture;
  };
  const readbackPixels = async (device, target, size) => {
    const buffer = device.createBuffer({
      size: size * size * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: target },
      { buffer, bytesPerRow: size * 4, rowsPerImage: size },
      [size, size],
    );
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const pixels = new Uint8Array(buffer.getMappedRange().slice(0));
    buffer.unmap();
    return pixels;
  };
`;

/**
 * Program 1: compile and rasterise every shaded variant over a unit quad.
 *
 * Ambient light alone (plus §59's emissive) must light every variant — the
 * normal-less ones shade ambient-only by design — so a black centre is a
 * broken variant whichever axis broke it.
 */
const VARIANTS_SCRIPT = `async (options) => {
  const { size, variants, lightBytes, standardBytes, drawBytes } = options;
  if (navigator.gpu === undefined) return { adapter: false, variants: [] };
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) return { adapter: false, variants: [] };
  const device = await adapter.requestDevice();
  ${PAGE_PRELUDE}

  const positions = new Float32Array([
    -0.8, -0.8, 0,  0.8, -0.8, 0,  0.8, 0.8, 0,
    -0.8, -0.8, 0,  0.8, 0.8, 0,  -0.8, 0.8, 0,
  ]);
  const normals = new Float32Array([
    0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
  ]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
  const vertexBuffer = (floats) => {
    const buffer = device.createBuffer({
      size: floats.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, floats);
    return buffer;
  };
  const positionBuffer = vertexBuffer(positions);
  const normalBuffer = vertexBuffer(normals);
  const uvBuffer = vertexBuffer(uvs);
  const lights = lightsLayout(device, lightBytes);
  const lightsGroup = device.createBindGroup({
    layout: lights,
    entries: [{ binding: 0, resource: {
      buffer: uniformBuffer(device, lightBlock({ ambient: 0.4, sun: 0, lamps: 0 })),
    } }],
  });
  const maps = mapLayout(device);
  const sampler = device.createSampler({
    addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge",
    magFilter: "linear", minFilter: "linear", mipmapFilter: "nearest",
  });
  const mapGroup = device.createBindGroup({
    layout: maps,
    entries: [
      { binding: 0, resource: whiteTexture(device).createView() },
      { binding: 1, resource: sampler },
    ],
  });

  const results = [];
  for (const variant of variants) {
    const blockBytes = variant.standard ? standardBytes : drawBytes;
    const draw = drawLayout(device, blockBytes);
    const drawGroup = device.createBindGroup({
      layout: draw,
      entries: [{ binding: 0, resource: {
        buffer: uniformBuffer(device, drawBlock(variant.standard)),
      } }],
    });
    const target = device.createTexture({
      size: [size, size],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const buffers = [{
      arrayStride: 12, stepMode: "vertex",
      attributes: [{ format: "float32x3", offset: 0, shaderLocation: 0 }],
    }];
    if (variant.normals) {
      buffers.push({
        arrayStride: 12, stepMode: "vertex",
        attributes: [{ format: "float32x3", offset: 0, shaderLocation: 3 }],
      });
    }
    if (variant.map) {
      buffers.push({
        arrayStride: 8, stepMode: "vertex",
        attributes: [{ format: "float32x2", offset: 0, shaderLocation: 2 }],
      });
    }
    const layouts = [draw, lights];
    if (variant.map) layouts.push(maps);

    device.pushErrorScope("validation");
    const module = device.createShaderModule({ code: variant.shader });
    const pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: layouts }),
      vertex: { module, entryPoint: "vertexMain", buffers },
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
        clearValue: [0, 0, 0, 1],
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, drawGroup);
    pass.setBindGroup(1, lightsGroup);
    if (variant.map) pass.setBindGroup(2, mapGroup);
    let slot = 0;
    pass.setVertexBuffer(slot, positionBuffer);
    if (variant.normals) { slot += 1; pass.setVertexBuffer(slot, normalBuffer); }
    if (variant.map) { slot += 1; pass.setVertexBuffer(slot, uvBuffer); }
    pass.draw(6);
    pass.end();
    device.queue.submit([encoder.finish()]);
    const error = await device.popErrorScope();

    const pixels = await readbackPixels(device, target, size);
    const centre = (Math.floor(size / 2) * size + Math.floor(size / 2)) * 4;
    results.push({
      name: variant.name,
      error: error === null ? null : String(error.message),
      center: Array.from(pixels.slice(centre, centre + 4)),
    });
  }
  return { adapter: true, variants: results };
}`;

/**
 * Program 2: a lit sphere under one point light on its +X side.
 *
 * The sphere is generated in the page (24 × 32 bands, radius 0.8, normals =
 * unit positions) and drawn through the backend's own `lit|n` module with a
 * real depth attachment, so whichever hemisphere wins the depth test the +X
 * limb faces the lamp and the −X limb sees only ambient.
 */
const SPHERE_SCRIPT = `async (options) => {
  const { size, shader, lightBytes, drawBytes } = options;
  if (navigator.gpu === undefined) return { adapter: false };
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) return { adapter: false };
  const device = await adapter.requestDevice();
  ${PAGE_PRELUDE}

  // A lat/long sphere: positions and outward unit normals, Uint16 indices.
  const latBands = 24;
  const longBands = 32;
  const radius = 0.8;
  const positions = [];
  const normals = [];
  const indices = [];
  for (let lat = 0; lat <= latBands; lat += 1) {
    const theta = (lat * Math.PI) / latBands;
    for (let lon = 0; lon <= longBands; lon += 1) {
      const phi = (lon * 2 * Math.PI) / longBands;
      const x = Math.sin(theta) * Math.cos(phi);
      const y = Math.cos(theta);
      const z = Math.sin(theta) * Math.sin(phi);
      positions.push(radius * x, radius * y, radius * z);
      normals.push(x, y, z);
    }
  }
  for (let lat = 0; lat < latBands; lat += 1) {
    for (let lon = 0; lon < longBands; lon += 1) {
      const first = lat * (longBands + 1) + lon;
      const second = first + longBands + 1;
      indices.push(first, second, first + 1, second, second + 1, first + 1);
    }
  }
  const vertexBuffer = (floats) => {
    const buffer = device.createBuffer({
      size: floats.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, floats);
    return buffer;
  };
  const positionBuffer = vertexBuffer(new Float32Array(positions));
  const normalBuffer = vertexBuffer(new Float32Array(normals));
  const indexData = new Uint16Array(indices);
  const indexBuffer = device.createBuffer({
    size: indexData.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, indexData);

  const draw = drawLayout(device, drawBytes);
  const drawGroup = device.createBindGroup({
    layout: draw,
    entries: [{ binding: 0, resource: {
      buffer: uniformBuffer(device, drawBlock(false)),
    } }],
  });
  const lights = lightsLayout(device, lightBytes);
  // One point light on the +X axis, close enough to dominate: ambient 0.05,
  // no directional term, premultiplied colour 4.
  const lightsGroup = device.createBindGroup({
    layout: lights,
    entries: [{ binding: 0, resource: {
      buffer: uniformBuffer(device, lightBlock({
        ambient: 0.05, sun: 0, lamps: 1, lampX: 2.5, lampZ: 0, lampPower: 4,
        positionOffset: options.positionOffset, colorOffset: options.colorOffset,
      })),
    } }],
  });

  const target = device.createTexture({
    size: [size, size],
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const depth = device.createTexture({
    size: [size, size],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  device.pushErrorScope("validation");
  const module = device.createShaderModule({ code: shader });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [draw, lights] }),
    vertex: {
      module,
      entryPoint: "vertexMain",
      buffers: [
        {
          arrayStride: 12, stepMode: "vertex",
          attributes: [{ format: "float32x3", offset: 0, shaderLocation: 0 }],
        },
        {
          arrayStride: 12, stepMode: "vertex",
          attributes: [{ format: "float32x3", offset: 0, shaderLocation: 3 }],
        },
      ],
    },
    fragment: {
      module,
      entryPoint: "fragmentMain",
      targets: [{ format: "rgba8unorm", writeMask: 0xf }],
    },
    primitive: { topology: "triangle-list" },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: target.createView(),
      loadOp: "clear",
      storeOp: "store",
      clearValue: [0, 0, 0, 1],
    }],
    depthStencilAttachment: {
      view: depth.createView(),
      depthLoadOp: "clear",
      depthStoreOp: "store",
      depthClearValue: 1,
    },
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, drawGroup);
  pass.setBindGroup(1, lightsGroup);
  pass.setVertexBuffer(0, positionBuffer);
  pass.setVertexBuffer(1, normalBuffer);
  pass.setIndexBuffer(indexBuffer, "uint16");
  pass.drawIndexed(indexData.length);
  pass.end();
  device.queue.submit([encoder.finish()]);
  const error = await device.popErrorScope();

  const pixels = await readbackPixels(device, target, size);
  const luminance = (x, y) => {
    const base = (y * size + x) * 4;
    return (pixels[base] + pixels[base + 1] + pixels[base + 2]) / 3;
  };
  // The horizontal band across the sphere's middle: the −X limb sees ambient
  // alone, the +X limb faces the lamp. NDC x maps to framebuffer x directly.
  let leftSum = 0;
  let rightSum = 0;
  let samples = 0;
  for (let y = Math.floor(size * 0.42); y < Math.floor(size * 0.58); y += 1) {
    for (let offset = Math.floor(size * 0.08); offset < Math.floor(size * 0.33); offset += 1) {
      leftSum += luminance(offset, y);
      rightSum += luminance(size - 1 - offset, y);
      samples += 1;
    }
  }
  const corner = (0 * size + 0) * 4;
  return {
    adapter: true,
    error: error === null ? null : String(error.message),
    leftMean: leftSum / samples,
    rightMean: rightSum / samples,
    background: Array.from(pixels.slice(corner, corner + 4)),
  };
}`;

/**
 * Runs the page program with `options` and returns its result — wrapped in a
 * call, because `page.evaluate` given a bare function expression would
 * evaluate to the function rather than call it (the sibling specs' gotcha).
 */
async function inPage<T>(
  page: import("@playwright/test").Page,
  program: string,
  options: unknown,
): Promise<T> {
  return await page.evaluate(`(${program})(${JSON.stringify(options)})`);
}

test.describe("WebGPU shaded pipelines, on a real adapter", () => {
  test("compiles and rasterises all eight shaded WGSL variants", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);
    const result = await inPage<CompileResult>(page, VARIANTS_SCRIPT, {
      size: SIZE,
      variants: variantCases(),
      lightBytes: LIGHT_BINDING_BYTES,
      standardBytes: STANDARD_UNIFORM_BYTES,
      drawBytes: DRAW_UNIFORM_BYTES,
    });
    test.skip(
      !result.adapter,
      "no WebGPU adapter — is --enable-unsafe-webgpu still set?",
    );

    expect(result.variants).toHaveLength(8);
    for (const variant of result.variants) {
      // A validation error names its variant — far more useful than a black
      // pixel.
      expect(variant.error, variant.name).toBeNull();
      // Ambient light (plus §59's emissive floor) lights every variant, the
      // normal-less ones by design; the quad's centre must not be background.
      expect(
        variant.center[0],
        `${variant.name} rasterised nothing`,
      ).toBeGreaterThan(20);
      expect(variant.center[3], variant.name).toBe(255);
    }
  });

  test("shades a lit sphere brighter toward its point light (§68)", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);
    const result = await inPage<SphereResult>(page, SPHERE_SCRIPT, {
      size: SIZE,
      shader: litShaderSource(true, false),
      lightBytes: LIGHT_BINDING_BYTES,
      drawBytes: DRAW_UNIFORM_BYTES,
      positionOffset: LIGHT_PUNCTUAL_POSITION_OFFSET,
      colorOffset: LIGHT_PUNCTUAL_COLOR_OFFSET,
    });
    test.skip(
      !result.adapter,
      "no WebGPU adapter — is --enable-unsafe-webgpu still set?",
    );

    expect(result.error).toBeNull();
    // The background stayed the clear colour: the sphere did not cover the
    // corners, so the regions below are sphere, not backdrop.
    expect(result.background.slice(0, 3)).toEqual([0, 0, 0]);
    // Threshold regions, never goldens: the +X limb faces the lamp, the −X
    // limb sees ambient alone — a strong, rasteriser-independent contrast.
    expect(result.rightMean).toBeGreaterThan(60);
    expect(result.rightMean).toBeGreaterThan(result.leftMean * 1.5);
  });
});
