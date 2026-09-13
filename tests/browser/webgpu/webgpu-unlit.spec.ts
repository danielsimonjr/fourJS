/**
 * The WebGPU backend's first **real-GPU** gate (WP-R1.1, 2026-08-21).
 *
 * ## What only a browser can answer
 *
 * `packages/render-webgpu/tests/*` prove which commands a frame issues against
 * a fake device, and `tests/determinism/render-list-consumption.test.ts` proves
 * that the list those commands consume is the same one WebGL 2 consumes.
 * Neither compiles a line of WGSL. Three claims are therefore untested until a
 * real adapter runs them, and they are the three this file makes:
 *
 * 1. **The hand-written WGSL compiles and draws.** The shader source under test
 *    is imported from `@fourjs/render-webgpu` itself and handed to the page — not
 *    retyped here — so a change to `wgpu-unlit.ts` that a fake device would
 *    happily record is caught by this gate.
 * 2. **The clip-depth remap is right.** A vertex stage that got
 *    `(clip.z + clip.w) * 0.5` wrong clips the whole triangle away on WebGPU's
 *    `[0, 1]` depth range, and a transcript cannot see that.
 * 3. **`mapAsync` readback works**, which is the mechanism WP-R1.6's
 *    `readPixels` and RFC 0005's asynchronous API are both built on.
 *
 * ## Why it skips rather than fails when there is no adapter
 *
 * `navigator.gpu` exists in a headless Chromium *without* `--enable-unsafe-webgpu`,
 * and `requestAdapter()` there resolves `null` (measured — it is also the reason
 * `isWebgpuSupported` is deliberately optimistic). A contributor on a browser or
 * machine without WebGPU should get a skip, not a red suite; the flag is set for
 * this project in `playwright.config.ts`, so a skip *in CI* means the flag
 * stopped working and the skip line says so.
 *
 * ## Why the page is navigated rather than `setContent`
 *
 * Recorded gotcha, and it cost a probe round: on `about:blank` the same browser
 * reports `navigator.gpu` **absent**, because an opaque origin is not the secure
 * context WebGPU wants. The page must be *served*, so this file borrows the
 * first example site's origin exactly as `mipmaps.spec.ts` borrows it — nothing
 * on the page is used.
 *
 * ## Why there are no goldens
 *
 * §92's rule, with more force than usual: SwiftShader's WebGPU rasteriser is
 * not the WebGL one and is certainly not a GPU. Every assertion below is a
 * threshold or an exact value the *specification* fixes (a cleared texel is the
 * clear colour), never a pixel comparison against a committed image.
 */

import { DRAW_UNIFORM_BYTES, unlitShaderSource } from "@fourjs/render-webgpu";
import { expect, test } from "@playwright/test";

/** Restates `PORT` in `playwright.config.ts` — the site whose origin is borrowed. */
const PORT = 4173;

/**
 * Readback surface size. 64 × 4 bytes is exactly 256, WebGPU's required
 * `bytesPerRow` alignment for `copyTextureToBuffer` — so the copy needs no
 * padding arithmetic and every byte read back is a texel.
 */
const SIZE = 64;

/** How red a channel must be to count as the triangle rather than the background. */
const RED = 200;

interface ClearResult {
  readonly adapter: boolean;
  readonly first: number[];
  readonly uniform: boolean;
}

interface TriangleResult {
  readonly adapter: boolean;
  readonly redPixels: number;
  readonly total: number;
  readonly centre: number[];
  readonly error: string | null;
}

/**
 * The page-side program: everything below runs inside the browser.
 *
 * A **string** rather than a function, and invoked through
 * {@link inPage}: this repository pins no WebGPU typings (`@webgpu/types` is
 * not in the §3.2 pin set, and the backend describes the device structurally
 * for that reason), so `GPUBufferUsage` and friends have no ambient types here
 * and a real function would not survive `bun run typecheck:tests`. The page is
 * where those globals exist, and a string is how they get there.
 */
const PAGE_SCRIPT = `async (options) => {
  const { size, shader, red, drawBytes } = options;
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

  // The bind-group layout the backend declares as data (wgpu-bindings.ts).
  const layout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: drawBytes },
      },
    ],
  });
  const uniforms = device.createBuffer({
    size: 256,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bindGroup = device.createBindGroup({
    layout,
    entries: [{ binding: 0, resource: { buffer: uniforms, offset: 0, size: drawBytes } }],
  });

  // viewProjection = identity, model = identity, color = opaque red,
  // normalMatrix = identity (std140 mat3 at offset 144).
  const block = new Float32Array(drawBytes / 4);
  for (let i = 0; i < 4; i += 1) {
    block[i * 5] = 1;
    block[16 + i * 5] = 1;
  }
  block[32] = 1;
  block[35] = 1;
  block[36] = 1;
  block[41] = 1;
  block[46] = 1;
  device.queue.writeBuffer(uniforms, 0, block);

  const positions = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]);
  const vertices = device.createBuffer({
    size: positions.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertices, 0, positions);

  let error = null;
  device.pushErrorScope("validation");
  const module = device.createShaderModule({ code: shader });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: {
      module,
      entryPoint: "vertexMain",
      buffers: [
        {
          arrayStride: 12,
          stepMode: "vertex",
          attributes: [{ format: "float32x3", offset: 0, shaderLocation: 0 }],
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
    colorAttachments: [
      {
        view: target.createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: [0, 0, 0, 1],
      },
    ],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup, [0]);
  pass.setVertexBuffer(0, vertices);
  pass.draw(3);
  pass.end();
  encoder.copyTextureToBuffer(
    { texture: target },
    { buffer: readback, bytesPerRow: size * 4, rowsPerImage: size },
    [size, size],
  );
  device.queue.submit([encoder.finish()]);
  error = await device.popErrorScope();

  await readback.mapAsync(GPUMapMode.READ);
  const pixels = new Uint8Array(readback.getMappedRange().slice(0));
  readback.unmap();

  let redPixels = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] >= red && pixels[i + 1] < red) redPixels += 1;
  }
  const centre = ((size / 2) * size + size / 2) * 4;
  return {
    adapter: true,
    redPixels,
    total: size * size,
    centre: Array.from(pixels.slice(centre, centre + 4)),
    error: error === null ? null : String(error.message),
  };
}`;

/** The clear-only half: a render pass, a readback, and the exact clear colour. */
const CLEAR_SCRIPT = `async (size) => {
  if (navigator.gpu === undefined) return { adapter: false, first: [], uniform: false };
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) return { adapter: false, first: [], uniform: false };
  const device = await adapter.requestDevice();

  // The canvas configuration the backend performs at initialization, run here
  // for the same reason the backend does it: to prove a swap chain can be had.
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("webgpu");
  context.configure({
    device,
    format: navigator.gpu.getPreferredCanvasFormat(),
    alphaMode: "premultiplied",
  });

  const target = device.createTexture({
    size: [size, size],
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const readback = device.createBuffer({
    size: size * size * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder
    .beginRenderPass({
      colorAttachments: [
        {
          view: target.createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: [0, 1, 0, 1],
        },
      ],
    })
    .end();
  encoder.copyTextureToBuffer(
    { texture: target },
    { buffer: readback, bytesPerRow: size * 4, rowsPerImage: size },
    [size, size],
  );
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const pixels = new Uint8Array(readback.getMappedRange().slice(0));
  readback.unmap();

  let uniform = true;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] !== 0 || pixels[i + 1] !== 255) uniform = false;
  }
  return { adapter: true, first: Array.from(pixels.slice(0, 4)), uniform };
}`;

/**
 * Runs one of the page programs above with `options`, and returns its result.
 *
 * The programs are arrow-function *expressions*, so they are wrapped in a call
 * — `page.evaluate` given a bare function expression would evaluate to the
 * function rather than call it, and every field of the result would read
 * `undefined`.
 */
async function inPage<T>(
  page: import("@playwright/test").Page,
  program: string,
  options: unknown,
): Promise<T> {
  return await page.evaluate(`(${program})(${JSON.stringify(options)})`);
}

test.describe("WebGPU, on a real adapter", () => {
  test("configures a canvas and reads a cleared surface back", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);
    const result = await inPage<ClearResult>(page, CLEAR_SCRIPT, SIZE);
    test.skip(
      !result.adapter,
      "no WebGPU adapter — is --enable-unsafe-webgpu still set?",
    );

    expect(result.first).toEqual([0, 255, 0, 255]);
    expect(result.uniform).toBe(true);
  });

  test("compiles the backend's unlit WGSL and rasterises its triangle", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);
    const result = await inPage<TriangleResult>(page, PAGE_SCRIPT, {
      size: SIZE,
      // The real thing, imported rather than retyped.
      shader: unlitShaderSource(false),
      red: RED,
      drawBytes: DRAW_UNIFORM_BYTES,
    });
    test.skip(
      !result.adapter,
      "no WebGPU adapter — is --enable-unsafe-webgpu still set?",
    );

    // A validation error here is a WGSL or layout mistake, and its message is
    // far more useful than a pixel count of zero.
    expect(result.error).toBeNull();

    // The triangle covers half of a 1 × 1 NDC region out of the 2 × 2 square:
    // one eighth of the surface, ~512 of 4096 texels. A generous band, because
    // the claim is "it drew, roughly there", not "it drew these pixels".
    expect(result.redPixels).toBeGreaterThan(result.total * 0.06);
    expect(result.redPixels).toBeLessThan(result.total * 0.2);
    // The centroid of that triangle is inside it, whatever the rasteriser.
    expect(result.centre[0]).toBeGreaterThanOrEqual(RED);
    expect(result.centre[3]).toBe(255);
  });
});
