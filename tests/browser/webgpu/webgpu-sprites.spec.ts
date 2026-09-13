/**
 * WP-R1.3's real-GPU gate for sprites and batching — plus the deferred
 * WP-R1.2 texture evidence, which rides along by construction: both programs
 * below sample a real texture through the backend's group-1 layout, so "the
 * texture tier uploads, binds and samples on a real adapter" is proved on the
 * way to the sprite and batch claims.
 *
 * What only a browser can answer here (`webgpu-unlit.spec.ts`'s argument):
 *
 * 1. **The sprite WGSL compiles and draws.** The source under test is
 *    `SPRITE_SHADER_SOURCE` imported from `@fourjs/render-webgpu` itself — the
 *    authored uv stream at `@location(2)`, the 144-byte `SpriteUniforms`
 *    block, the `texture × tint` product — none of which a fake device ever
 *    executes.
 * 2. **The §65 interleaved layout draws.** `batchVertexBufferLayout` puts
 *    position and uv in one buffer against the unlit module's named locations;
 *    a slot/location mismatch validates cleanly and draws garbage (the hazard
 *    `wgpu-unlit.ts` records), so only a rasteriser can prove the offsets.
 *
 * Skip-when-no-adapter, served origin, thresholds not goldens — all per the
 * recorded WP-R1.1 pattern; see `webgpu-unlit.spec.ts`'s header for the three
 * arguments.
 */

import {
  DRAW_UNIFORM_BYTES,
  SPRITE_SHADER_SOURCE,
  SPRITE_UNIFORM_BYTES,
  UV_SHADER_LOCATION,
  batchVertexBufferLayout,
  unlitShaderSource,
} from "@fourjs/render-webgpu";
import { expect, test } from "@playwright/test";

/** Restates `PORT` in `playwright.config.ts` — the site whose origin is borrowed. */
const PORT = 4173;

/** Readback surface size; 64 × 4 bytes is WebGPU's `bytesPerRow` alignment. */
const SIZE = 64;

/** How strong a channel must read to count as that colour. */
const STRONG = 180;

interface QuadResult {
  readonly adapter: boolean;
  readonly greenPixels: number;
  readonly bluePixels: number;
  readonly total: number;
  readonly error: string | null;
}

/**
 * Draws one textured quad and reads it back. `options.shader` is the WGSL
 * under test; `options.sprite` picks the sprite program's shape (interleaved
 * position + authored uv, {@link SPRITE_UNIFORM_BYTES} block) over the batch
 * program's (the same interleaved stream, {@link DRAW_UNIFORM_BYTES} block
 * with an identity `normalMatrix`).
 *
 * The texture is 2 × 2: left column green, right column blue, so a draw whose
 * uv mapping works shows both colours side by side and a draw whose mapping is
 * broken shows one, none, or noise.
 *
 * A **string**, not a function: this repository pins no WebGPU typings, and
 * `GPUBufferUsage` and friends only have meaning in the page (see
 * `webgpu-unlit.spec.ts` on `bun run typecheck:tests`).
 */
const QUAD_SCRIPT = `async (options) => {
  const { size, shader, sprite, vertexLayout, strong, spriteBytes, drawBytes } = options;
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

  // The 2×2 map: left column green, right column blue (rows identical).
  const texels = new Uint8Array([
    0, 255, 0, 255,  0, 0, 255, 255,
    0, 255, 0, 255,  0, 0, 255, 255,
  ]);
  const map = device.createTexture({
    size: [2, 2],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture: map },
    texels,
    { bytesPerRow: 8, rowsPerImage: 2 },
    [2, 2],
  );
  const sampler = device.createSampler({
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    magFilter: "nearest",
    minFilter: "nearest",
    mipmapFilter: "nearest",
  });

  const blockBytes = sprite ? spriteBytes : drawBytes;
  const uniformLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: blockBytes },
      },
    ],
  });
  const mapLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float", viewDimension: "2d" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
    ],
  });
  const uniforms = device.createBuffer({
    size: 256,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const uniformGroup = device.createBindGroup({
    layout: uniformLayout,
    entries: [{ binding: 0, resource: { buffer: uniforms, offset: 0, size: blockBytes } }],
  });
  const mapGroup = device.createBindGroup({
    layout: mapLayout,
    entries: [
      { binding: 0, resource: map.createView() },
      { binding: 1, resource: sampler },
    ],
  });

  // viewProjection = model = identity; colour/tint = opaque white. The
  // unlit DrawUniforms block also carries an identity normalMatrix
  // (std140 mat3 at 144); SpriteUniforms stops at tint.
  const block = new Float32Array(blockBytes / 4);
  for (let i = 0; i < 4; i += 1) {
    block[i * 5] = 1;
    block[16 + i * 5] = 1;
  }
  block[32] = 1; block[33] = 1; block[34] = 1; block[35] = 1;
  if (!sprite) {
    block[36] = 1; block[41] = 1; block[46] = 1;
  }
  device.queue.writeBuffer(uniforms, 0, block);

  // A quad spanning x, y ∈ [-0.5, 0.5]: two triangles, six vertices.
  // Both programs now read authored uv at @location(2); u = x + 0.5,
  // v = y + 0.5 maps the local rectangle onto the 2×2 texture.
  const corners = [
    [-0.5, -0.5], [0.5, -0.5], [0.5, 0.5],
    [-0.5, -0.5], [0.5, 0.5], [-0.5, 0.5],
  ];
  const floats = [];
  for (const [x, y] of corners) {
    floats.push(x, y, 0, x + 0.5, y + 0.5);
  }
  const vertexData = new Float32Array(floats);
  const vertices = device.createBuffer({
    size: vertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertices, 0, vertexData);

  device.pushErrorScope("validation");
  const module = device.createShaderModule({ code: shader });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [uniformLayout, mapLayout] }),
    vertex: { module, entryPoint: "vertexMain", buffers: [vertexLayout] },
    fragment: {
      module,
      entryPoint: "fragmentMain",
      targets: [{ format: "rgba8unorm", writeMask: 0xf }],
    },
    primitive: { topology: "triangle-list" },
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      { view: target.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] },
    ],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, uniformGroup, [0]);
  pass.setBindGroup(1, mapGroup);
  pass.setVertexBuffer(0, vertices);
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

  let greenPixels = 0;
  let bluePixels = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 1] >= strong && pixels[i + 2] < strong) greenPixels += 1;
    if (pixels[i + 2] >= strong && pixels[i + 1] < strong) bluePixels += 1;
  }
  return {
    adapter: true,
    greenPixels,
    bluePixels,
    total: size * size,
    error: error === null ? null : String(error.message),
  };
}`;

async function inPage<T>(
  page: import("@playwright/test").Page,
  program: string,
  options: unknown,
): Promise<T> {
  return await page.evaluate(`(${program})(${JSON.stringify(options)})`);
}

/** Both quads cover a quarter of the surface, half green and half blue. */
function expectTwoColourQuad(result: QuadResult): void {
  expect(result.error).toBeNull();
  // Each colour holds one half of the quarter-surface quad: ~512 of 4096
  // texels. Generous bands — the claim is "both cells landed, side by side".
  expect(result.greenPixels).toBeGreaterThan(result.total * 0.06);
  expect(result.greenPixels).toBeLessThan(result.total * 0.2);
  expect(result.bluePixels).toBeGreaterThan(result.total * 0.06);
  expect(result.bluePixels).toBeLessThan(result.total * 0.2);
}

test.describe("WebGPU sprites and batching, on a real adapter", () => {
  test("compiles the sprite WGSL and draws its textured, authored-uv quad", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);
    const result = await inPage<QuadResult>(page, QUAD_SCRIPT, {
      size: SIZE,
      shader: SPRITE_SHADER_SOURCE,
      sprite: true,
      // The backend's own sprite vertex layout: position + authored uv at
      // @location(2) (R-19/R-20; Sprite.frame writes the frame onto geometry).
      vertexLayout: {
        arrayStride: 20,
        stepMode: "vertex",
        attributes: [
          { format: "float32x3", offset: 0, shaderLocation: 0 },
          { format: "float32x2", offset: 12, shaderLocation: UV_SHADER_LOCATION },
        ],
      },
      strong: STRONG,
      spriteBytes: SPRITE_UNIFORM_BYTES,
      drawBytes: DRAW_UNIFORM_BYTES,
    });
    test.skip(
      !result.adapter,
      "no WebGPU adapter — is --enable-unsafe-webgpu still set?",
    );
    expectTwoColourQuad(result);
  });

  test("draws the §65 interleaved stream through the unlit map variant", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);
    const result = await inPage<QuadResult>(page, QUAD_SCRIPT, {
      size: SIZE,
      // The module a batch actually compiles from, and the layout the
      // uploader binds — both imported, not retyped.
      shader: unlitShaderSource(false, true),
      sprite: false,
      vertexLayout: batchVertexBufferLayout(true, false, true, false),
      strong: STRONG,
      spriteBytes: SPRITE_UNIFORM_BYTES,
      drawBytes: DRAW_UNIFORM_BYTES,
    });
    test.skip(
      !result.adapter,
      "no WebGPU adapter — is --enable-unsafe-webgpu still set?",
    );
    expectTwoColourQuad(result);
  });
});
