/**
 * §69's shadow tier on a real adapter (WP-R1.7, 2026-08-29).
 *
 * Two claims, per the WP-R1.4 variant-evidence rule (*a variant family's
 * browser evidence covers only the variants it compiles*):
 *
 * 1. **Every new WGSL module compiles and rasterises.** WP-R1.7 adds nine:
 *    the depth-only caster module, and the `|sh` variant of each of the eight
 *    shaded modules (`lit`/`standard` × `normals` × `map`). No fake-device
 *    transcript can prove `texture_depth_2d`, `sampler_comparison`, or
 *    `textureSampleCompareLevel` satisfy a real WGSL front end — and the
 *    non-uniform-control-flow legality of the `Level` form is exactly the
 *    kind of rule only a compiler enforces. Each variant gets its own
 *    compile-and-rasterise line over a comparison-friendly map cleared to the
 *    far plane (everything lit), so a validation error or a black quad names
 *    its variant.
 * 2. **A caster darkens the receiver it occludes, by threshold.** The §69
 *    composition end to end in the backend's own WGSL: the caster module
 *    writes the map through the §3.3.8 depth remap, the shadowed lit module
 *    compares against it through the receiver's flipped `v`, and the region
 *    under the caster reads darker than the open region — thresholds and
 *    ratios, never goldens (§92; R-1 plan §5).
 *
 * Mechanics follow the sibling specs' recorded decisions verbatim: the WGSL
 * is **imported** from `@fourjs/render-webgpu`, never retyped; the page program
 * is a string because this repository pins no WebGPU typings; the page is
 * *served* (an opaque origin loses `navigator.gpu`); the spec **skips** when
 * `requestAdapter()` resolves `null`.
 *
 * **Measured on the first run (2026-08-29, SwiftShader — the WP-R1.9 gate,
 * this spec's first execution since WP-R1.7 committed it):** the caster
 * module and all eight `|sh` shaded variants compiled with no validation
 * error and rasterised lit; the occluded region read darker than the open
 * region by the spec's threshold.
 */

import { Matrix4 } from "@fourjs/math";
import { writeSpotShadowMatrix } from "@fourjs/render";
import {
  DRAW_UNIFORM_BYTES,
  LIGHT_COUNTS_OFFSET,
  LIGHT_DIRECTION_OFFSET,
  LIGHT_PUNCTUAL_COLOR_OFFSET,
  LIGHT_PUNCTUAL_DIRECTION_OFFSET,
  LIGHT_PUNCTUAL_PARAMS_OFFSET,
  LIGHT_PUNCTUAL_POSITION_OFFSET,
  SHADOW_ATLAS_OFFSET,
  SHADOW_CASCADE_MATRIX_OFFSET,
  SHADOW_CASCADE_SPLITS_OFFSET,
  SHADOW_INFO_OFFSET,
  SHADOW_LIGHT_UNIFORM_BYTES,
  SHADOW_MATRIX_OFFSET,
  SHADOW_PARAMS_OFFSET,
  SHADOW_PUNCTUAL_PARAMS_OFFSET,
  SHADOW_PUNCTUAL_RANGE_OFFSET,
  SHADOW_PUNCTUAL_SLOT_OFFSET,
  SHADOW_SHADER_SOURCE,
  SHADOW_SPOT_MATRIX_OFFSET,
  SHADOW_VIEW_DEPTH_OFFSET,
  STANDARD_UNIFORM_BYTES,
  litShaderSource,
  standardShaderSource,
} from "@fourjs/render-webgpu";
import { expect, test } from "@playwright/test";

/** Restates `PORT` in `playwright.config.ts` — the site whose origin is borrowed. */
const PORT = 4173;

/** Readback surface size; 128 × 4 bytes meets the 256-byte `bytesPerRow` rule. */
const SIZE = 128;

/** One shadowed variant's page-side description. */
interface VariantCase {
  readonly name: string;
  readonly shader: string;
  readonly standard: boolean;
  readonly normals: boolean;
  readonly map: boolean;
}

/** All eight shadowed shaded modules, each its own compile line. */
function variantCases(): VariantCase[] {
  const cases: VariantCase[] = [];
  for (const standard of [false, true]) {
    for (const normals of [false, true]) {
      for (const map of [false, true]) {
        cases.push({
          name: `${standard ? "standard" : "lit"}${normals ? "|n" : ""}${map ? "|map" : ""}|sh`,
          shader: standard
            ? standardShaderSource(normals, map, true)
            : litShaderSource(normals, map, true),
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

interface Region {
  readonly centre: number;
  readonly edge: number;
}

interface AtlasResult {
  readonly adapter: boolean;
  readonly error: string | null;
  readonly inSecond: Region;
  readonly inFirst: Region;
  readonly beyond: Region;
  readonly spot: Region;
  readonly spotOpen: Region;
}

interface ShadowResult {
  readonly adapter: boolean;
  readonly error: string | null;
  readonly casterCenter: number[];
  readonly shadowedMean: number;
  readonly litMean: number;
}

/**
 * Shared page-side plumbing: the layouts the backend declares as data —
 * including the WP-R1.7 shadow-lights group (widened dynamic-less uniform
 * block, `depth` texture, `comparison` sampler) — a widened light block
 * writer, and the readback helper.
 */
const PAGE_PRELUDE = `
  const drawLayout = (device, size) => device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: { type: "uniform", minBindingSize: size },
    }],
  });
  const shadowLightsLayout = (device, size) => device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform", minBindingSize: size } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "depth", viewDimension: "2d" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: "comparison" } },
    ],
  });
  const mapLayout = (device) => device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: "filtering" } },
    ],
  });
  const comparisonSampler = (device) => device.createSampler({
    addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge",
    magFilter: "nearest", minFilter: "nearest", mipmapFilter: "nearest",
    compare: "less-equal",
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
  // The widened light block: the R1.5 layout in its first 592 bytes, the
  // shadow matrix at matrixOffset and the params vec4 after it. The shadow
  // matrix flips z: the light looks down -Z, so nearer the light is smaller
  // stored depth (the caster pass applies the backend's own remap).
  const shadowLightBlock = (options) => {
    const floats = new Float32Array(options.blockFloats);
    floats[0] = options.ambient; floats[1] = options.ambient; floats[2] = options.ambient;
    floats[6] = -1; // lightDirection (0, 0, -1): shining toward -Z.
    floats[8] = options.sun; floats[9] = options.sun; floats[10] = options.sun;
    floats[14] = 2; // eye at (0, 0, 2) for the standard lobe.
    const matrix = options.matrixOffset / 4;
    floats[matrix] = 1;
    floats[matrix + 5] = 1;
    floats[matrix + 10] = -1;
    floats[matrix + 15] = 1;
    const params = options.paramsOffset / 4;
    floats[params] = options.bias;
    floats[params + 1] = 0;
    floats[params + 2] = 1 / options.mapSize;
    floats[params + 3] = 0;
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
  // A shadow map with defined content: cleared to the far plane (1), so a
  // less-equal comparison answers "lit" everywhere, optionally with casters
  // drawn into it through the backend's caster module.
  const shadowMap = (device, mapSize, casterModule, casterPositions) => {
    const depth = device.createTexture({
      size: [mapSize, mapSize],
      format: "depth32float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const color = device.createTexture({
      size: [mapSize, mapSize],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: color.createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: [0, 0, 0, 1],
      }],
      depthStencilAttachment: {
        view: depth.createView(),
        depthLoadOp: "clear",
        depthClearValue: 1,
        depthStoreOp: "store",
      },
    });
    if (casterModule !== null) {
      // draw.viewProjection = the light's matrix (z flipped), model = identity,
      // normalMatrix identity (std140 mat3 at 144). The caster WGSL still
      // declares the full DrawUniforms struct.
      const casterFloats = new Float32Array(drawBytes / 4);
      casterFloats[0] = 1; casterFloats[5] = 1; casterFloats[10] = -1; casterFloats[15] = 1;
      casterFloats[16] = 1; casterFloats[21] = 1; casterFloats[26] = 1; casterFloats[31] = 1;
      casterFloats[36] = 1; casterFloats[41] = 1; casterFloats[46] = 1;
      const draw = drawLayout(device, drawBytes);
      const group = device.createBindGroup({
        layout: draw,
        entries: [{ binding: 0, resource: {
          buffer: uniformBuffer(device, casterFloats),
        } }],
      });
      const buffer = device.createBuffer({
        size: casterPositions.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, casterPositions);
      const pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [draw] }),
        vertex: {
          module: casterModule,
          entryPoint: "vertexMain",
          buffers: [{
            arrayStride: 12, stepMode: "vertex",
            attributes: [{ format: "float32x3", offset: 0, shaderLocation: 0 }],
          }],
        },
        fragment: {
          module: casterModule,
          entryPoint: "fragmentMain",
          targets: [{ format: "rgba8unorm", writeMask: 0xf }],
        },
        primitive: { topology: "triangle-list" },
        depthStencil: {
          format: "depth32float",
          depthWriteEnabled: true,
          depthCompare: "less",
        },
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.setVertexBuffer(0, buffer);
      pass.draw(casterPositions.length / 3);
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
    return { depth, color };
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
 * Program 1: compile and rasterise the caster module and every shadowed
 * shaded variant over a unit quad, against a map cleared to the far plane —
 * every comparison answers "lit", so ambient (plus §59's emissive) must light
 * every variant exactly as the unshadowed spec's quads are lit, and a black
 * centre names a broken variant.
 */
const VARIANTS_SCRIPT = `async (options) => {
  const { size, variants, casterShader, shadowBytes, matrixOffset, paramsOffset, standardBytes, drawBytes } = options;
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

  // The caster module rasterises first: its silhouette is the colour half of
  // its own map render, asserted white at the centre.
  device.pushErrorScope("validation");
  const casterModule = device.createShaderModule({ code: casterShader });
  const map = shadowMap(device, size, casterModule, positions);
  const casterError = await device.popErrorScope();
  const casterPixels = await readbackPixels(device, map.color, size);
  const centre = (Math.floor(size / 2) * size + Math.floor(size / 2)) * 4;
  const results = [{
    name: "caster",
    error: casterError === null ? null : String(casterError.message),
    center: Array.from(casterPixels.slice(centre, centre + 4)),
  }];

  // The receivers compare against an all-far map: everything lit.
  const farMap = shadowMap(device, 16, null, positions);
  const lights = shadowLightsLayout(device, shadowBytes);
  const lightsGroup = device.createBindGroup({
    layout: lights,
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer(device, shadowLightBlock({
        blockFloats: shadowBytes / 4, matrixOffset, paramsOffset,
        ambient: 0.4, sun: 0, bias: 0.005, mapSize: 16,
      })) } },
      { binding: 1, resource: farMap.depth.createView() },
      { binding: 2, resource: comparisonSampler(device) },
    ],
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
    results.push({
      name: variant.name,
      error: error === null ? null : String(error.message),
      center: Array.from(pixels.slice(centre, centre + 4)),
    });
  }
  return { adapter: true, variants: results };
}`;

/**
 * Program 2: the §69 composition — a caster quad over the centre of a lit
 * plane, the map rendered by the backend's caster module, the plane shaded by
 * the backend's shadowed lit module. The centre region sits in the caster's
 * shadow; the corners see the sun.
 */
const SHADOW_SCRIPT = `async (options) => {
  const { size, mapSize, planeShader, casterShader, shadowBytes, matrixOffset, paramsOffset, drawBytes } = options;
  if (navigator.gpu === undefined) return { adapter: false };
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) return { adapter: false };
  const device = await adapter.requestDevice();
  ${PAGE_PRELUDE}

  // The caster: a quad at z = 0.5 (between the +Z light and the plane),
  // covering the centre [-0.4, 0.4] of the shadow volume.
  const casterPositions = new Float32Array([
    -0.4, -0.4, 0.5,  0.4, -0.4, 0.5,  0.4, 0.4, 0.5,
    -0.4, -0.4, 0.5,  0.4, 0.4, 0.5,  -0.4, 0.4, 0.5,
  ]);
  // The receiver: a plane at z = 0 covering most of the view, +Z normals.
  const planePositions = new Float32Array([
    -0.9, -0.9, 0,  0.9, -0.9, 0,  0.9, 0.9, 0,
    -0.9, -0.9, 0,  0.9, 0.9, 0,  -0.9, 0.9, 0,
  ]);
  const planeNormals = new Float32Array([
    0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
  ]);

  device.pushErrorScope("validation");
  const casterModule = device.createShaderModule({ code: casterShader });
  const map = shadowMap(device, mapSize, casterModule, casterPositions);

  const lights = shadowLightsLayout(device, shadowBytes);
  const lightsGroup = device.createBindGroup({
    layout: lights,
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer(device, shadowLightBlock({
        blockFloats: shadowBytes / 4, matrixOffset, paramsOffset,
        ambient: 0.1, sun: 0.9, bias: 0.005, mapSize,
      })) } },
      { binding: 1, resource: map.depth.createView() },
      { binding: 2, resource: comparisonSampler(device) },
    ],
  });
  const draw = drawLayout(device, drawBytes);
  const drawGroup = device.createBindGroup({
    layout: draw,
    entries: [{ binding: 0, resource: {
      buffer: uniformBuffer(device, drawBlock(false)),
    } }],
  });
  const vertexBuffer = (floats) => {
    const buffer = device.createBuffer({
      size: floats.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, floats);
    return buffer;
  };

  const target = device.createTexture({
    size: [size, size],
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const module = device.createShaderModule({ code: planeShader });
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
  pass.setVertexBuffer(0, vertexBuffer(planePositions));
  pass.setVertexBuffer(1, vertexBuffer(planeNormals));
  pass.draw(6);
  pass.end();
  device.queue.submit([encoder.finish()]);
  const error = await device.popErrorScope();

  const casterPixels = await readbackPixels(device, map.color, mapSize);
  const casterCentre = (Math.floor(mapSize / 2) * mapSize + Math.floor(mapSize / 2)) * 4;
  const pixels = await readbackPixels(device, target, size);
  const luminance = (x, y) => {
    const base = (y * size + x) * 4;
    return (pixels[base] + pixels[base + 1] + pixels[base + 2]) / 3;
  };
  // The shadowed region: well inside the caster's footprint (centre 20%).
  // The lit region: inside the plane, outside the shadow (the corners' band).
  let shadowedSum = 0;
  let shadowedSamples = 0;
  let litSum = 0;
  let litSamples = 0;
  for (let y = Math.floor(size * 0.44); y < Math.floor(size * 0.56); y += 1) {
    for (let x = Math.floor(size * 0.44); x < Math.floor(size * 0.56); x += 1) {
      shadowedSum += luminance(x, y);
      shadowedSamples += 1;
    }
  }
  for (let y = Math.floor(size * 0.08); y < Math.floor(size * 0.16); y += 1) {
    for (let x = Math.floor(size * 0.08); x < Math.floor(size * 0.16); x += 1) {
      litSum += luminance(x, y);
      litSamples += 1;
    }
  }
  return {
    adapter: true,
    error: error === null ? null : String(error.message),
    casterCenter: Array.from(casterPixels.slice(casterCentre, casterCentre + 4)),
    shadowedMean: shadowedSum / shadowedSamples,
    litMean: litSum / litSamples,
  };
}`;

/**
 * Program 3 (W6.3): the shadow **atlas** on a real adapter — the atlas tail of
 * the shadowed light block, `shadowTileTaps`, `directionalShadowAtlas` and
 * `punctualShadowFactor` compiled and run by a real WGSL front end.
 *
 * Two claims, each by threshold: (cascade) the receiver picks its cascade by
 * *view depth* — the caster is drawn into tile 1 only, so a plane whose view
 * depth falls in cascade 1 is shadowed and the same plane with the splits moved
 * so it falls in cascade 0 (an empty tile) is lit; (spot) a perspective map in
 * tile 0 darkens the centre of a plane lit by a spot light, and not its edge.
 */
const ATLAS_SCRIPT = `async (options) => {
  const { size, tile, planeShader, casterShader, blockBytes, drawBytes, offsets, spotMatrix } = options;
  if (navigator.gpu === undefined) return { adapter: false };
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) return { adapter: false };
  const device = await adapter.requestDevice();
  ${PAGE_PRELUDE}

  device.pushErrorScope("validation");
  const casterModule = device.createShaderModule({ code: casterShader });
  const planeModule = device.createShaderModule({ code: planeShader });
  const quad = (half, z) => new Float32Array([
    -half, -half, z,  half, -half, z,  half, half, z,
    -half, -half, z,  half, half, z,  -half, half, z,
  ]);
  const vertexBuffer = (floats) => {
    const buffer = device.createBuffer({
      size: floats.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, floats);
    return buffer;
  };

  // An atlas of 'columns' x 1 tiles; 'casters[i]' is drawn into tile i with
  // 'matrices[i]' as its view-projection, or the tile is left at the far plane.
  const atlas = (columns, matrices, casters) => {
    const depth = device.createTexture({
      size: [tile * columns, tile],
      format: "depth32float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const color = device.createTexture({
      size: [tile * columns, tile],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const draw = drawLayout(device, drawBytes);
    const pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [draw] }),
      vertex: {
        module: casterModule, entryPoint: "vertexMain",
        buffers: [{ arrayStride: 12, stepMode: "vertex",
          attributes: [{ format: "float32x3", offset: 0, shaderLocation: 0 }] }],
      },
      fragment: { module: casterModule, entryPoint: "fragmentMain",
        targets: [{ format: "rgba8unorm", writeMask: 0xf }] },
      primitive: { topology: "triangle-list" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" },
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: color.createView(), loadOp: "clear", storeOp: "store",
        clearValue: [0, 0, 0, 1] }],
      depthStencilAttachment: { view: depth.createView(), depthLoadOp: "clear",
        depthClearValue: 1, depthStoreOp: "store" },
    });
    pass.setPipeline(pipeline);
    for (let i = 0; i < columns; i += 1) {
      if (casters[i] === null) continue;
      const floats = new Float32Array(drawBytes / 4);
      floats.set(matrices[i], 0);
      floats[16] = 1; floats[21] = 1; floats[26] = 1; floats[31] = 1;
      floats[36] = 1; floats[41] = 1; floats[46] = 1;
      const group = device.createBindGroup({
        layout: draw,
        entries: [{ binding: 0, resource: { buffer: uniformBuffer(device, floats) } }],
      });
      pass.setBindGroup(0, group);
      pass.setViewport(i * tile, 0, tile, tile, 0, 1);
      pass.setVertexBuffer(0, vertexBuffer(casters[i]));
      pass.draw(casters[i].length / 3);
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
    return depth;
  };

  const flipZ = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,-1,0, 0,0,0,1]);
  const lightsLayout = shadowLightsLayout(device, blockBytes);
  const plane = quad(0.9, 0);
  const normals = new Float32Array(18);
  for (let i = 0; i < 6; i += 1) normals[i * 3 + 2] = 1;

  const renderPlane = async (block, depth) => {
    const lightsGroup = device.createBindGroup({
      layout: lightsLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer(device, block) } },
        { binding: 1, resource: depth.createView() },
        { binding: 2, resource: comparisonSampler(device) },
      ],
    });
    const draw = drawLayout(device, drawBytes);
    const drawGroup = device.createBindGroup({
      layout: draw,
      entries: [{ binding: 0, resource: { buffer: uniformBuffer(device, drawBlock(false)) } }],
    });
    const target = device.createTexture({
      size: [size, size], format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [draw, lightsLayout] }),
      vertex: { module: planeModule, entryPoint: "vertexMain", buffers: [
        { arrayStride: 12, stepMode: "vertex",
          attributes: [{ format: "float32x3", offset: 0, shaderLocation: 0 }] },
        { arrayStride: 12, stepMode: "vertex",
          attributes: [{ format: "float32x3", offset: 0, shaderLocation: 3 }] },
      ] },
      fragment: { module: planeModule, entryPoint: "fragmentMain",
        targets: [{ format: "rgba8unorm", writeMask: 0xf }] },
      primitive: { topology: "triangle-list" },
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: target.createView(), loadOp: "clear", storeOp: "store",
        clearValue: [0, 0, 0, 1] }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, drawGroup);
    pass.setBindGroup(1, lightsGroup);
    pass.setVertexBuffer(0, vertexBuffer(plane));
    pass.setVertexBuffer(1, vertexBuffer(normals));
    pass.draw(6);
    pass.end();
    device.queue.submit([encoder.finish()]);
    const pixels = await readbackPixels(device, target, size);
    const mean = (x0, x1, y0, y1) => {
      let sum = 0; let count = 0;
      for (let y = Math.floor(size * y0); y < Math.floor(size * y1); y += 1) {
        for (let x = Math.floor(size * x0); x < Math.floor(size * x1); x += 1) {
          const base = (y * size + x) * 4;
          sum += (pixels[base] + pixels[base + 1] + pixels[base + 2]) / 3;
          count += 1;
        }
      }
      return sum / count;
    };
    return { centre: mean(0.44, 0.56, 0.44, 0.56), edge: mean(0.08, 0.16, 0.08, 0.16) };
  };

  const baseBlock = () => {
    const floats = new Float32Array(blockBytes / 4);
    floats[0] = 0.1; floats[1] = 0.1; floats[2] = 0.1;
    floats[offsets.direction / 4 + 2] = -1;
    floats[14] = 2;
    return floats;
  };
  const writeAtlasHeader = (floats, columns, cascades, punctual) => {
    const a = offsets.atlas / 4;
    floats[a] = columns; floats[a + 1] = 1;
    floats[a + 2] = 1 / (tile * columns); floats[a + 3] = 1 / tile;
    const i = offsets.info / 4;
    floats[i] = cascades; floats[i + 1] = 1; floats[i + 2] = punctual;
  };

  // --- cascade selection by view depth ---------------------------------
  const cascadeCase = async (splits) => {
    const block = baseBlock();
    block[offsets.direction / 4 + 2] = -1;
    // The sun, white; the shadow matrix path is the atlas path here.
    block[8] = 0.9; block[9] = 0.9; block[10] = 0.9;
    block.set(flipZ, offsets.cascadeMatrix / 4);
    block.set(flipZ, offsets.cascadeMatrix / 4 + 16);
    block.set(splits, offsets.cascadeSplits / 4);
    // View depth of the plane (z = 0) is 5: depth = -z + 5.
    block.set([0, 0, -1, 5], offsets.viewDepth / 4);
    block[offsets.params / 4] = 0.005;
    writeAtlasHeader(block, 2, 2, 0);
    block.set(flipZ, offsets.matrix / 4);
    // The caster exists in tile 1 only.
    const depth = atlas(2, [flipZ, flipZ], [null, quad(0.4, 0.5)]);
    return await renderPlane(block, depth);
  };
  const inSecond = await cascadeCase([3, 20, 0, 0]);
  const inFirst = await cascadeCase([10, 20, 0, 0]);
  const beyond = await cascadeCase([2, 4, 0, 0]);

  // --- a spot light's perspective map -----------------------------------
  const spotBlock = baseBlock();
  spotBlock[offsets.counts / 4] = 1;
  spotBlock.set([0, 0, 3, 0], offsets.position / 4);
  spotBlock.set([9, 9, 9, 0], offsets.color / 4);
  spotBlock.set([0, 0, -1, 0], offsets.direction2 / 4);
  const cosOuter = Math.cos(0.6);
  spotBlock.set([0, cosOuter, 1 / (1 - cosOuter), 1], offsets.params2 / 4);
  spotBlock.set(spotMatrix, offsets.spotMatrix / 4);
  spotBlock.set([1, 0, 0, 0], offsets.slot / 4);
  spotBlock.set([0, 0.001, 0, 1], offsets.punctualParams / 4);
  spotBlock.set([0.1, 20, 0, 0], offsets.range / 4);
  spotBlock[offsets.params / 4] = 0.005;
  writeAtlasHeader(spotBlock, 1, 0, 1);
  const spotDepth = atlas(1, [new Float32Array(spotMatrix)], [quad(0.3, 1.5)]);
  const spot = await renderPlane(spotBlock, spotDepth);
  const openDepth = atlas(1, [new Float32Array(spotMatrix)], [null]);
  const spotOpen = await renderPlane(spotBlock, openDepth);

  const error = await device.popErrorScope();
  return {
    adapter: true,
    error: error === null ? null : String(error.message),
    inSecond, inFirst, beyond, spot, spotOpen,
  };
}`;

/** Runs the page program with `options` — the sibling specs' wrapped-call gotcha. */
async function inPage<T>(
  page: import("@playwright/test").Page,
  program: string,
  options: unknown,
): Promise<T> {
  return await page.evaluate(`(${program})(${JSON.stringify(options)})`);
}

test.describe("WebGPU shadows, on a real adapter (§69, WP-R1.7)", () => {
  test("compiles and rasterises the caster and all eight shadowed variants", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);
    const result = await inPage<CompileResult>(page, VARIANTS_SCRIPT, {
      size: SIZE,
      variants: variantCases(),
      casterShader: SHADOW_SHADER_SOURCE,
      shadowBytes: SHADOW_LIGHT_UNIFORM_BYTES,
      matrixOffset: SHADOW_MATRIX_OFFSET,
      paramsOffset: SHADOW_PARAMS_OFFSET,
      standardBytes: STANDARD_UNIFORM_BYTES,
      drawBytes: DRAW_UNIFORM_BYTES,
    });
    test.skip(
      !result.adapter,
      "no WebGPU adapter — is --enable-unsafe-webgpu still set?",
    );

    // The caster line plus the eight shadowed variants.
    expect(result.variants).toHaveLength(9);
    for (const variant of result.variants) {
      // A validation error names its variant — far more useful than a black
      // pixel.
      expect(variant.error, variant.name).toBeNull();
      if (variant.name === "caster") {
        // The caster's colour half is its silhouette: opaque white where the
        // quad rasterised.
        expect(variant.center, variant.name).toEqual([255, 255, 255, 255]);
        continue;
      }
      // Against an all-far map every comparison answers lit, so ambient
      // (plus §59's emissive) lights every variant — the normal-less ones by
      // design; the quad's centre must not be background.
      expect(
        variant.center[0],
        `${variant.name} rasterised nothing`,
      ).toBeGreaterThan(20);
      expect(variant.center[3], variant.name).toBe(255);
    }
  });

  test("darkens the region a caster occludes, by threshold (§69)", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);
    const result = await inPage<ShadowResult>(page, SHADOW_SCRIPT, {
      size: SIZE,
      mapSize: 128,
      planeShader: litShaderSource(true, false, true),
      casterShader: SHADOW_SHADER_SOURCE,
      shadowBytes: SHADOW_LIGHT_UNIFORM_BYTES,
      matrixOffset: SHADOW_MATRIX_OFFSET,
      paramsOffset: SHADOW_PARAMS_OFFSET,
      drawBytes: DRAW_UNIFORM_BYTES,
    });
    test.skip(
      !result.adapter,
      "no WebGPU adapter — is --enable-unsafe-webgpu still set?",
    );

    expect(result.error).toBeNull();
    // The map actually holds the caster: its colour half's centre is the
    // silhouette white.
    expect(result.casterCenter).toEqual([255, 255, 255, 255]);
    // Thresholds, never goldens: the open region reads ambient + sun, the
    // occluded centre ambient alone — a strong, rasteriser-independent
    // contrast in a stated direction.
    expect(result.litMean).toBeGreaterThan(100);
    expect(result.shadowedMean).toBeLessThan(result.litMean * 0.45);
    expect(result.shadowedMean).toBeGreaterThan(5);
  });

  test("selects a cascade by view depth and shadows through a spot map in the atlas (W6.3)", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);
    const spotMatrix = Array.from(
      writeSpotShadowMatrix(new Matrix4(), 0, 0, 3, 0, 0, -1, 0.6, 0.1, 20)
        .elements,
    );
    const result = await inPage<AtlasResult>(page, ATLAS_SCRIPT, {
      size: SIZE,
      tile: 64,
      planeShader: litShaderSource(true, false, true),
      casterShader: SHADOW_SHADER_SOURCE,
      blockBytes: SHADOW_LIGHT_UNIFORM_BYTES,
      drawBytes: DRAW_UNIFORM_BYTES,
      spotMatrix,
      offsets: {
        matrix: SHADOW_MATRIX_OFFSET,
        params: SHADOW_PARAMS_OFFSET,
        direction: LIGHT_DIRECTION_OFFSET,
        counts: LIGHT_COUNTS_OFFSET,
        position: LIGHT_PUNCTUAL_POSITION_OFFSET,
        color: LIGHT_PUNCTUAL_COLOR_OFFSET,
        direction2: LIGHT_PUNCTUAL_DIRECTION_OFFSET,
        params2: LIGHT_PUNCTUAL_PARAMS_OFFSET,
        cascadeMatrix: SHADOW_CASCADE_MATRIX_OFFSET,
        spotMatrix: SHADOW_SPOT_MATRIX_OFFSET,
        cascadeSplits: SHADOW_CASCADE_SPLITS_OFFSET,
        viewDepth: SHADOW_VIEW_DEPTH_OFFSET,
        atlas: SHADOW_ATLAS_OFFSET,
        info: SHADOW_INFO_OFFSET,
        slot: SHADOW_PUNCTUAL_SLOT_OFFSET,
        punctualParams: SHADOW_PUNCTUAL_PARAMS_OFFSET,
        range: SHADOW_PUNCTUAL_RANGE_OFFSET,
      },
    });
    test.skip(
      !result.adapter,
      "no WebGPU adapter — is --enable-unsafe-webgpu still set?",
    );

    expect(result.error).toBeNull();
    // Cascade 1 holds the caster: a plane at view depth 5 inside the second
    // split is shadowed at its centre and lit at its edge.
    expect(result.inSecond.edge).toBeGreaterThan(100);
    expect(result.inSecond.centre).toBeLessThan(result.inSecond.edge * 0.45);
    // The same plane with the splits moved so depth 5 selects cascade 0 — an
    // empty tile — is lit everywhere: selection really is by view depth.
    expect(result.inFirst.centre).toBeGreaterThan(result.inFirst.edge * 0.9);
    // Past the last split the receiver is lit (the outside-the-volume rule).
    expect(result.beyond.centre).toBeGreaterThan(result.beyond.edge * 0.9);

    // The spot map: open map lights the centre, the caster's umbra darkens it
    // and leaves the edge alone.
    expect(result.spotOpen.centre).toBeGreaterThan(60);
    expect(result.spot.centre).toBeLessThan(result.spotOpen.centre * 0.5);
    expect(result.spot.edge).toBeGreaterThan(result.spotOpen.edge * 0.8);
  });
});
