/**
 * §36 `simulation: "gpu"` on a real adapter (R-31 wiring, 2026-08-29): the
 * residency claim end to end — a particle integrated **on the device** by
 * `PARTICLE_INTEGRATOR_SHADER_SOURCE` is drawn **from the same storage
 * buffer** by `PARTICLE_SHADER_SOURCE` through the three-buffer
 * `PARTICLE_GPU_VERTEX_BUFFER_LAYOUTS`, with no readback between the
 * dispatch and the draw.
 *
 * The fake-device suites pin the plumbing (the emitter's calls, the `|gi:y`
 * pipeline variant, the three `setVertexBuffer`s); what no transcript can
 * prove is that a real WGSL front end accepts the split vertex layout — the
 * billboard module's `@location(1)` re-sourced from a 12-byte-stride
 * `STORAGE | VERTEX` buffer while locations 2–3 keep riding the interleaved
 * stream — and that the drawn quad sits where the *kernel* put it. So this
 * spec dispatches one semi-implicit Euler step (inputs exact in f32) and
 * then rasterises: the moved centre must sample each instance's own colour,
 * and the spawn position must have been left behind (clear colour), which
 * is the pixel-level statement of "the draw read the integrated buffer,
 * not the uploaded one".
 *
 * Mechanics follow the sibling specs' recorded decisions verbatim: WGSL and
 * layout tables **imported**, never retyped; a string page program (no
 * WebGPU typings pinned); a served page; self-skip without an adapter;
 * thresholds and specification-fixed values only, no goldens. Two stated
 * simplifications against the backend's own binding mode, neither touching
 * the claim: the uniform bind is static-offset (the backend's dynamic
 * offset is transcript-pinned elsewhere) and the target is opaque (the
 * §36 blend is `webgpu-particles.spec.ts`'s claim).
 *
 * **First-run measurements pending** — this spec was written at the R-31
 * wiring landing and awaits the next `test:browser` run (a sibling owns the
 * browser gate); record the first-run observations here then, per the gate
 * convention.
 */

import { Vector3 } from "@fourjs/math";
import {
  dragField,
  radialField,
  turbulenceField,
  uniformGravityField,
  volumeField,
  vortexField,
  windField,
  type ParticleForceField,
  type ParticleGpuField,
} from "@fourjs/particles";
import {
  COMPUTE_ENTRY_POINT,
  PARTICLE_DEPTH_COLLIDE_SHADER_SOURCE,
  PARTICLE_SIMULATION_PARAMS_FLOATS,
  writeParticleSimulationParams,
  PARTICLE_GPU_VERTEX_BUFFER_LAYOUTS,
  PARTICLE_INTEGRATOR_SHADER_SOURCE,
  PARTICLE_SHADER_SOURCE,
  PARTICLE_UNIFORM_BYTES,
  particleIntegratorWorkgroups,
} from "@fourjs/render-webgpu";
import { expect, test } from "@playwright/test";

/** Restates `PORT` in `playwright.config.ts` — the site whose origin is borrowed. */
const PORT = 4173;

/** Readback surface size; 64 × 4 bytes meets the 256-byte `bytesPerRow` rule. */
const SIZE = 64;

/** Particles integrated and drawn. */
const COUNT = 2;

interface GpuParticleResult {
  readonly adapter: boolean;
  readonly error: string | null;
  /** RGBA at each particle's *integrated* centre. */
  readonly moved: number[][];
  /** RGBA at particle 0's spawn position — must be the clear colour. */
  readonly left: number[];
}

/**
 * The page-side program. Identity matrices throughout, so NDC is world:
 *
 * - particle 0: p (−0.5, 0, 0), v (2, 0, 0); one step at dt 0.25 under
 *   g (0, −4, 0) gives v′ (2, −1, 0), p′ (0, −0.25, 0);
 * - particle 1: p (0.5, 0.5, 0), v (0, 0, 0) → v′ (0, −1, 0),
 *   p′ (0.5, 0.25, 0).
 *
 * Every input is exact in binary f32, so the integrated centres are exact;
 * each quad (size 0.25 NDC) is sampled at its integrated centre, and the
 * spawn point of particle 0 lies 0.5 NDC from its quad — far outside it.
 */
const PAGE_SCRIPT = `async (options) => {
  const { size, integrator, entryPoint, billboard, uniformBytes, layouts, workgroups, paramsFloats } = options;
  if (navigator.gpu === undefined) return { adapter: false };
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) return { adapter: false };
  const device = await adapter.requestDevice();
  device.pushErrorScope("validation");

  // The residency buffer: the simulation's own usage set —
  // STORAGE | VERTEX | COPY_DST | COPY_SRC (wgpu-particle-simulation.ts).
  const positions = device.createBuffer({
    size: 24,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX |
      GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  device.queue.writeBuffer(positions, 0,
    new Float32Array([-0.5, 0, 0, 0.5, 0.5, 0]));
  const storage = (floats) => {
    const buffer = device.createBuffer({
      size: floats.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    device.queue.writeBuffer(buffer, 0, floats);
    return buffer;
  };
  const velocities = storage(new Float32Array([2, 0, 0, 0, 0, 0]));
  // dt 0.25, count 2, pads, gravity (0, -4, 0, 0) — the params layout
  // writeParticleSimulationParams packs.
  const params = storage(
    new Float32Array([0.25, 2, 0, 0, 0, -4, 0, 0, ...new Array(paramsFloats - 8).fill(0)]),
  );

  // Integrate one step — the backend's "rww" compute layout.
  const computeLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" } },
    ],
  });
  const computePipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout] }),
    compute: { module: device.createShaderModule({ code: integrator }), entryPoint },
  });
  const computeGroup = device.createBindGroup({
    layout: computeLayout,
    entries: [
      { binding: 0, resource: { buffer: params } },
      { binding: 1, resource: { buffer: positions } },
      { binding: 2, resource: { buffer: velocities } },
    ],
  });

  // The CPU ramp stream — interleaved 8 floats per instance; its position
  // lanes deliberately carry the SPAWN values, because the draw must not
  // read them: sizes 0.25, colours red and green.
  const instances = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(instances, 0, new Float32Array([
    -0.5, 0, 0, 0.25, 1, 0, 0, 1,
    0.5, 0.5, 0, 0.25, 0, 1, 0, 1,
  ]));
  const corners = device.createBuffer({
    size: 72,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(corners, 0, new Float32Array([
    -0.5, -0.5, 0,  0.5, -0.5, 0,  0.5, 0.5, 0,
    -0.5, -0.5, 0,  0.5, 0.5, 0,  -0.5, 0.5, 0,
  ]));

  // Three identity matrices in the particle uniform block.
  const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  const uniforms = device.createBuffer({
    size: uniformBytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniforms, 0,
    new Float32Array([...identity, ...identity, ...identity]));
  const drawLayout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX,
      buffer: { type: "uniform", minBindingSize: uniformBytes } }],
  });
  const drawPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [drawLayout] }),
    vertex: {
      module: device.createShaderModule({ code: billboard }),
      entryPoint: "vertexMain",
      buffers: layouts,
    },
    fragment: {
      module: device.createShaderModule({ code: billboard }),
      entryPoint: "fragmentMain",
      targets: [{ format: "rgba8unorm" }],
    },
    primitive: { topology: "triangle-list" },
  });
  const drawGroup = device.createBindGroup({
    layout: drawLayout,
    entries: [{ binding: 0, resource: { buffer: uniforms } }],
  });

  const target = device.createTexture({
    size: { width: size, height: size },
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const readback = device.createBuffer({
    size: size * size * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  // One submission: integrate, then draw from the very buffer the kernel
  // wrote — residency, with no readback in between.
  const encoder = device.createCommandEncoder();
  const compute = encoder.beginComputePass();
  compute.setPipeline(computePipeline);
  compute.setBindGroup(0, computeGroup);
  compute.dispatchWorkgroups(workgroups[0], workgroups[1], workgroups[2]);
  compute.end();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: target.createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: "clear",
      storeOp: "store",
    }],
  });
  pass.setPipeline(drawPipeline);
  pass.setBindGroup(0, drawGroup);
  pass.setVertexBuffer(0, corners);
  pass.setVertexBuffer(1, positions);
  pass.setVertexBuffer(2, instances);
  pass.draw(6, 2);
  pass.end();
  encoder.copyTextureToBuffer(
    { texture: target },
    { buffer: readback, bytesPerRow: size * 4 },
    { width: size, height: size },
  );
  device.queue.submit([encoder.finish()]);
  const error = await device.popErrorScope();

  await readback.mapAsync(GPUMapMode.READ);
  const pixels = new Uint8Array(readback.getMappedRange().slice(0));
  readback.unmap();
  const texel = (ndcX, ndcY) => {
    const x = Math.round((ndcX * 0.5 + 0.5) * size);
    const y = Math.round((0.5 - ndcY * 0.5) * size);
    const base = (y * size + x) * 4;
    return [pixels[base], pixels[base + 1], pixels[base + 2], pixels[base + 3]];
  };
  return {
    adapter: true,
    error: error === null ? null : String(error.message),
    moved: [texel(0, -0.25), texel(0.5, 0.25)],
    left: texel(-0.5, 0),
  };
}`;

/** Page program: one integrator dispatch over arbitrary params, read back. */
const FIELD_PAGE_SCRIPT = `async (options) => {
  const { integrator, entryPoint, params, positions, velocities, workgroups } = options;
  if (navigator.gpu === undefined) return { adapter: false };
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) return { adapter: false };
  const device = await adapter.requestDevice();
  device.pushErrorScope("validation");
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  const make = (data) => {
    const buffer = device.createBuffer({ size: data.byteLength, usage });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  };
  const paramsBuffer = make(new Uint32Array(params));
  const positionBuffer = make(new Float32Array(positions));
  const velocityBuffer = make(new Float32Array(velocities));
  const layout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
  ] });
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module: device.createShaderModule({ code: integrator }), entryPoint },
  });
  const group = device.createBindGroup({ layout, entries: [
    { binding: 0, resource: { buffer: paramsBuffer } },
    { binding: 1, resource: { buffer: positionBuffer } },
    { binding: 2, resource: { buffer: velocityBuffer } },
  ] });
  const read = (buffer, bytes) => {
    const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    return { staging, bytes, buffer };
  };
  const readP = read(positionBuffer, positions.length * 4);
  const readV = read(velocityBuffer, velocities.length * 4);
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  pass.dispatchWorkgroups(workgroups[0], workgroups[1], workgroups[2]);
  pass.end();
  for (const r of [readP, readV]) encoder.copyBufferToBuffer(r.buffer, 0, r.staging, 0, r.bytes);
  device.queue.submit([encoder.finish()]);
  const error = await device.popErrorScope();
  await readP.staging.mapAsync(GPUMapMode.READ);
  const outP = Array.from(new Float32Array(readP.staging.getMappedRange().slice(0)));
  await readV.staging.mapAsync(GPUMapMode.READ);
  const outV = Array.from(new Float32Array(readV.staging.getMappedRange().slice(0)));
  return { adapter: true, error: error === null ? null : String(error.message), positions: outP, velocities: outV };
}`;

/** Page program: render a constant depth, run the depth-collide kernel, read back. */
const DEPTH_PAGE_SCRIPT = `async (options) => {
  const { shader, entryPoint, params, positions, depth } = options;
  if (navigator.gpu === undefined) return { adapter: false };
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) return { adapter: false };
  const device = await adapter.requestDevice();
  device.pushErrorScope("validation");
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  const make = (data) => {
    const buffer = device.createBuffer({ size: data.byteLength, usage });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  };
  const paramsBuffer = make(new Float32Array(params));
  const positionBuffer = make(new Float32Array(positions));
  const velocityBuffer = make(new Float32Array(positions.length));
  const depthTexture = device.createTexture({
    size: { width: 8, height: 8 },
    format: "depth32float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const layout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "depth", viewDimension: "2d" } },
  ] });
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module: device.createShaderModule({ code: shader }), entryPoint },
  });
  const group = device.createBindGroup({ layout, entries: [
    { binding: 0, resource: { buffer: paramsBuffer } },
    { binding: 1, resource: { buffer: positionBuffer } },
    { binding: 2, resource: { buffer: velocityBuffer } },
    { binding: 3, resource: depthTexture.createView() },
  ] });
  const staging = device.createBuffer({ size: positions.length * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  // A pass with no draws just clears the depth attachment to the "surface".
  encoder.beginRenderPass({
    colorAttachments: [],
    depthStencilAttachment: {
      view: depthTexture.createView(),
      depthClearValue: depth,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    },
  }).end();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  pass.dispatchWorkgroups(1, 1, 1);
  pass.end();
  encoder.copyBufferToBuffer(positionBuffer, 0, staging, 0, positions.length * 4);
  device.queue.submit([encoder.finish()]);
  const error = await device.popErrorScope();
  await staging.mapAsync(GPUMapMode.READ);
  const out = Array.from(new Float32Array(staging.getMappedRange().slice(0)));
  return { adapter: true, error: error === null ? null : String(error.message), positions: out };
}`;

/** Runs the page program with `options` — the sibling specs' wrapped-call gotcha. */
async function inPage<T>(
  page: import("@playwright/test").Page,
  program: string,
  options: unknown,
): Promise<T> {
  return await page.evaluate(`(${program})(${JSON.stringify(options)})`);
}

test.describe("GPU-resident particles, on a real adapter (§36, R-31)", () => {
  test("draws each instance at its kernel-integrated position", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);
    const result = await inPage<GpuParticleResult>(page, PAGE_SCRIPT, {
      size: SIZE,
      integrator: PARTICLE_INTEGRATOR_SHADER_SOURCE,
      entryPoint: COMPUTE_ENTRY_POINT,
      billboard: PARTICLE_SHADER_SOURCE,
      uniformBytes: PARTICLE_UNIFORM_BYTES,
      layouts: PARTICLE_GPU_VERTEX_BUFFER_LAYOUTS,
      workgroups: particleIntegratorWorkgroups(COUNT),
      paramsFloats: PARTICLE_SIMULATION_PARAMS_FLOATS,
    });
    test.skip(
      !result.adapter,
      "no WebGPU adapter — is --enable-unsafe-webgpu still set?",
    );

    // A validation error names the mistake — an illegal split layout, a
    // storage-and-vertex usage the front end refuses — with far more signal
    // than three wrong texels.
    expect(result.error).toBeNull();

    // Each instance's quad sits at the *integrated* centre, in its own
    // instance colour — position from the kernel-written storage buffer,
    // colour from the interleaved stream, joined per instance.
    expect(result.moved[0]).toEqual([255, 0, 0, 255]);
    expect(result.moved[1]).toEqual([0, 255, 0, 255]);

    // And the spawn position was left behind: the stale position lanes in
    // the interleaved stream were NOT what the draw read.
    expect(result.left).toEqual([0, 0, 0, 255]);
  });

  test("evaluates the whole §27 field stack like the CPU path (float32 tolerance)", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);
    const dt = 0.1;
    const time = 1.25;
    const fields: ParticleForceField[] = [
      uniformGravityField(new Vector3(0, -3, 0.5)),
      dragField(0.4),
      windField(new Vector3(2, 0, -1), 0.8),
      vortexField(new Vector3(0, 0, 0), new Vector3(0, 1, 0), 6),
      radialField(new Vector3(1, 1, 1), -3, { minDistance: 0.25 }),
      turbulenceField(1337, {
        frequency: 0.7,
        amplitude: 2,
        scroll: new Vector3(0.3, 0, 0.1),
      }),
      volumeField(dragField(1.5), {
        shape: "sphere",
        center: new Vector3(0, 0, 0),
        radius: 4,
        falloff: 1.5,
      }),
    ];
    const stack = fields.map((f) => f.gpuField as ParticleGpuField);
    const p0 = [0.3, 1.7, -0.9, 2.2, -0.4, 1.1, -3.1, 0.6, 2.4];
    const v0 = [1, 0.5, -0.25, 0, 2, 0.75, -1.5, 0.25, 0];
    const count = p0.length / 3;
    const params = writeParticleSimulationParams(
      new Float32Array(PARTICLE_SIMULATION_PARAMS_FLOATS),
      dt,
      count,
      0,
      0,
      0,
      { fields: stack, time },
    );
    const bits = Array.from(new Uint32Array(params.buffer));
    const result = await inPage<{
      adapter: boolean;
      error: string | null;
      positions: number[];
      velocities: number[];
    }>(page, FIELD_PAGE_SCRIPT, {
      integrator: PARTICLE_INTEGRATOR_SHADER_SOURCE,
      entryPoint: COMPUTE_ENTRY_POINT,
      params: bits,
      positions: p0,
      velocities: v0,
      workgroups: particleIntegratorWorkgroups(count),
    });
    test.skip(!result.adapter, "no WebGPU adapter");
    expect(result.error).toBeNull();

    // The CPU reference: the emitter's own step — sum every field's sample
    // in declaration order from the step-start state, then semi-implicit Euler.
    const position = new Vector3();
    const velocity = new Vector3();
    const out = new Vector3();
    for (let i = 0; i < count; i += 1) {
      position.set(p0[i * 3], p0[i * 3 + 1], p0[i * 3 + 2]);
      velocity.set(v0[i * 3], v0[i * 3 + 1], v0[i * 3 + 2]);
      let ax = 0;
      let ay = 0;
      let az = 0;
      for (const field of fields) {
        const sampled = field.sample(position, velocity, time, out);
        ax += sampled.x;
        ay += sampled.y;
        az += sampled.z;
      }
      const vx = v0[i * 3] + ax * dt;
      const vy = v0[i * 3 + 1] + ay * dt;
      const vz = v0[i * 3 + 2] + az * dt;
      const expectedV = [vx, vy, vz];
      const expectedP = [
        p0[i * 3] + vx * dt,
        p0[i * 3 + 1] + vy * dt,
        p0[i * 3 + 2] + vz * dt,
      ];
      for (let k = 0; k < 3; k += 1) {
        expect(result.velocities[i * 3 + k]).toBeCloseTo(expectedV[k], 3);
        expect(result.positions[i * 3 + k]).toBeCloseTo(expectedP[k], 3);
      }
    }
  });

  test("kills particles behind the scene depth texture (collisions: depth-buffer)", async ({
    page,
  }) => {
    await page.goto(`http://localhost:${String(PORT)}/`);
    const params = writeParticleSimulationParams(
      new Float32Array(PARTICLE_SIMULATION_PARAMS_FLOATS),
      0.1,
      3,
      0,
      0,
      0,
      {
        collisionMode: 2,
        depthBias: 0.0005,
        viewProjection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },
    );
    const result = await inPage<{
      adapter: boolean;
      error: string | null;
      positions: number[];
    }>(page, DEPTH_PAGE_SCRIPT, {
      shader: PARTICLE_DEPTH_COLLIDE_SHADER_SOURCE,
      entryPoint: COMPUTE_ENTRY_POINT,
      params: Array.from(params),
      // NDC z: in front (0.25), behind (0.75), and outside the view (x = 2).
      positions: [0, 0, 0.25, 0.1, 0.1, 0.75, 2, 0, 0.75],
      depth: 0.5,
    });
    test.skip(!result.adapter, "no WebGPU adapter");
    expect(result.error).toBeNull();
    expect(result.positions.slice(0, 3)).toEqual([0, 0, 0.25]);
    expect(result.positions[3]).toBeGreaterThan(1e30);
    expect(result.positions[4]).toBeGreaterThan(1e30);
    expect(result.positions[5]).toBeGreaterThan(1e30);
    // Outside the view volume: untouched (no surface to compare against).
    expect(result.positions.slice(6, 9)).toEqual([2, 0, 0.75]);
  });
});
