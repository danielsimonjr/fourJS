/**
 * §82 compute on a real adapter (WP-R1.8, 2026-08-29) — the dispatch the R-1
 * plan's probe demonstrated, run through the backend's own kernel: storage
 * buffers, a compute pipeline, `dispatchWorkgroups`, and an exact readback.
 *
 * The claim the fake-device suite cannot make: that
 * `PARTICLE_INTEGRATOR_SHADER_SOURCE` satisfies a real WGSL front end and
 * that the kernel *computes* — one semi-implicit Euler step lands the exact
 * f32 values `@fourjs/particles`' closed form predicts (`v += g·dt`, then
 * `p += v·dt`), the read-only params binding validates against
 * `var<storage, read>`, and the `count` guard leaves the lane past it
 * untouched. Exact equality, deliberately: the chosen inputs are all exact
 * in binary f32, so the discrete step has one right answer and a threshold
 * would only blur it (compute-with-storage-buffers is probe-verified to run
 * headless under SwiftShader — R-1 plan §2.2 — so this spec skips only where
 * every WebGPU spec skips).
 *
 * Mechanics follow the sibling specs' recorded decisions verbatim: imported
 * WGSL, a string page program, a served page, self-skip without an adapter.
 *
 * **Measured on the first run (2026-08-29, SwiftShader — the WP-R1.9 gate,
 * this spec's first execution since WP-R1.8 committed it):** the §36
 * integrator's one semi-implicit-Euler step read back **exactly** (bit
 * equality on every lane), and the count guard left the untouched lane
 * untouched.
 */

import {
  COMPUTE_ENTRY_POINT,
  PARTICLE_INTEGRATOR_SHADER_SOURCE,
  PARTICLE_SIMULATION_PARAMS_FLOATS,
  particleIntegratorWorkgroups,
} from "@fourjs/render-webgpu";
import { expect, test } from "@playwright/test";

/** Restates `PORT` in `playwright.config.ts` — the site whose origin is borrowed. */
const PORT = 4173;

/** Integrated particles; a third lane sits past `count` as the guard's probe. */
const COUNT = 2;

interface ComputeResult {
  readonly adapter: boolean;
  readonly error: string | null;
  readonly positions: number[];
  readonly velocities: number[];
}

/**
 * The page-side program: three particles' lanes, two integrated under
 * gravity `(0, -2, 0)` at `dt = 0.5`, read back exactly.
 */
const PAGE_SCRIPT = `async (options) => {
  const { shader, entryPoint, workgroups } = options;
  if (navigator.gpu === undefined) return { adapter: false };
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) return { adapter: false };
  const device = await adapter.requestDevice();

  const storage = (floats) => {
    const buffer = device.createBuffer({
      size: floats.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    device.queue.writeBuffer(buffer, 0, floats);
    return buffer;
  };
  // deltaSeconds 0.5, count 2, pad, pad, gravity (0, -2, 0, 0) in the header
  // lanes the writer packs; the block is sized from the exported constant
  // (wave 6 widened it to carry the §27 field stack and the depth-collide
  // header), never hand-counted, so this spec cannot drift from the kernel.
  const paramFloats = new Float32Array(options.paramsFloats);
  paramFloats.set([0.5, 2, 0, 0, 0, -2, 0, 0]);
  const params = storage(paramFloats);
  const positions = storage(new Float32Array([0, 0, 0, 10, 20, 30, 7, 7, 7]));
  const velocities = storage(new Float32Array([1, 0, 0, 0, 0, 0, 5, 5, 5]));

  // The backend's compute layout for pattern "rww" (wgpu-compute.ts):
  // read-only params, read-write positions and velocities, COMPUTE-visible.
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" } },
    ],
  });

  device.pushErrorScope("validation");
  const module = device.createShaderModule({ code: shader });
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint },
  });
  const bindGroup = device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer: params } },
      { binding: 1, resource: { buffer: positions } },
      { binding: 2, resource: { buffer: velocities } },
    ],
  });

  const readable = (byteLength) =>
    device.createBuffer({
      size: byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  const positionsOut = readable(36);
  const velocitiesOut = readable(36);

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(workgroups[0], workgroups[1], workgroups[2]);
  pass.end();
  encoder.copyBufferToBuffer(positions, 0, positionsOut, 0, 36);
  encoder.copyBufferToBuffer(velocities, 0, velocitiesOut, 0, 36);
  device.queue.submit([encoder.finish()]);
  const error = await device.popErrorScope();

  await positionsOut.mapAsync(GPUMapMode.READ);
  const outPositions = Array.from(new Float32Array(positionsOut.getMappedRange().slice(0)));
  positionsOut.unmap();
  await velocitiesOut.mapAsync(GPUMapMode.READ);
  const outVelocities = Array.from(new Float32Array(velocitiesOut.getMappedRange().slice(0)));
  velocitiesOut.unmap();

  return {
    adapter: true,
    error: error === null ? null : String(error.message),
    positions: outPositions,
    velocities: outVelocities,
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

test.describe("WebGPU compute, on a real adapter (§82, WP-R1.8)", () => {
  test("dispatches the §36 integrator and reads back the exact step", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);
    const result = await inPage<ComputeResult>(page, PAGE_SCRIPT, {
      // The real kernel, imported rather than retyped.
      shader: PARTICLE_INTEGRATOR_SHADER_SOURCE,
      entryPoint: COMPUTE_ENTRY_POINT,
      workgroups: particleIntegratorWorkgroups(COUNT),
      paramsFloats: PARTICLE_SIMULATION_PARAMS_FLOATS,
    });
    test.skip(
      !result.adapter,
      "no WebGPU adapter — is --enable-unsafe-webgpu still set?",
    );

    // A validation error names the mistake — a mis-typed binding, an illegal
    // kernel — with far more signal than nine wrong floats.
    expect(result.error).toBeNull();

    // Semi-implicit Euler, dt = 0.5, g = (0, -2, 0), exact in f32:
    //   particle 0: v (1,0,0) → (1,-1,0);   p (0,0,0)    → (0.5,-0.5,0)
    //   particle 1: v (0,0,0) → (0,-1,0);   p (10,20,30) → (10,19.5,30)
    // The third lane sits past `count` and must come back untouched — the
    // guard, observed rather than trusted.
    expect(result.velocities).toEqual([1, -1, 0, 0, -1, 0, 5, 5, 5]);
    expect(result.positions).toEqual([0.5, -0.5, 0, 10, 19.5, 30, 7, 7, 7]);
  });
});
