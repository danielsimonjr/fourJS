/**
 * §36 particles on the WebGPU backend (WP-R1.8, 2026-08-29) — the real
 * `@fourjs/particles` path, end to end: a seeded `ParticleEmitter` under a
 * `ParticleRenderable` node, repacked by `buildRenderList` and drawn by
 * `WebgpuRenderer` as **one instanced draw** over the shared unit quad.
 *
 * This file is the cross-package half of the WP-R1.8 evidence. The
 * package-level suites drive the backend with structural doubles
 * (`packages/render-webgpu/tests/wgpu-particles.test.ts` and the renderer
 * suite's particle block); here the emitting node is the real class, so the
 * duck-typed `ParticleDrawable` contract — which nothing type-checks across
 * the §3.1 boundary — is exercised as the two packages actually meet.
 *
 * The cross-backend claim is stated in the only vocabulary both backends
 * share (the `render-list-consumption.test.ts` technique): the same scene
 * submits the same instanced draw — six quad vertices, one instance per live
 * particle, the same interleaved bytes — on WebGL 2 and WebGPU. A GL tape and
 * a WebGPU tape are lists in different languages, so the claim is never
 * transcript identity (§33's per-backend rule).
 */

import { Vector3 } from "@fourjs/math";
import { ParticleEmitter, ParticleRenderable } from "@fourjs/particles";
import { PARTICLE_INSTANCE_FLOATS } from "@fourjs/render";
import { WebglRenderer, registerParticlePipeline } from "@fourjs/render-webgl";
import {
  PARTICLE_MODEL_OFFSET,
  PARTICLE_UNIFORM_BYTES,
  UNIFORM_STRIDE_BYTES,
  WebgpuRenderer,
} from "@fourjs/render-webgpu";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@fourjs/scene";
import { describe, expect, it } from "vitest";

import { RecordingCanvas, createRecordingGl } from "./helpers/recording-gl.js";
import {
  createRecordingGpu,
  withHostGpu,
  type RecordingGpu,
} from "./helpers/recording-gpu.js";

/** `GL_TRIANGLES`, for the GL half of the parity claim. */
const GL_TRIANGLES = 0x0004;

/** Live particles the burst below leaves in the pool. */
const BURST_COUNT = 5;

interface Fountain {
  readonly scene: Scene;
  readonly renderable: ParticleRenderable;
  readonly emitter: ParticleEmitter;
  readonly views: readonly Viewport[];
}

/**
 * A seeded burst fountain with five live particles, its emitting node parented
 * at a recognisable translation — the §33 arrangement: every value below is
 * deterministic, so both backends see the identical pool.
 */
function fountain(): Fountain {
  const emitter = new ParticleEmitter({
    maxParticles: 16,
    seed: 42,
    emissionRate: 0,
    bursts: [{ time: 0, count: BURST_COUNT }],
    lifetime: { min: 10, max: 10 },
    initialSpeed: { min: 1, max: 1 },
    direction: new Vector3(0, 1, 0),
    spreadAngle: 0.4,
    size: { start: 0.5, end: 0.1 },
    color: {
      start: { r: 1, g: 0.5, b: 0.25, a: 1 },
      end: { r: 0, g: 0, b: 1, a: 0 },
    },
  });
  emitter.step(1 / 60, 0);

  const scene = new Scene();
  const camera = new OrthographicCamera({
    left: -4,
    right: 4,
    bottom: -4,
    top: 4,
  });
  camera.transform.position.set(0, 0, 5);
  scene.add(camera);
  const renderable = new ParticleRenderable(emitter);
  renderable.transform.position.set(1, 2, 3);
  scene.add(renderable);
  resolveWorldTransforms(scene);
  return {
    scene,
    renderable,
    emitter,
    views: [createFullscreenViewport(camera)],
  };
}

/** An initialized WebGPU renderer over a fresh recording device. */
async function webgpuRig(): Promise<{
  gpu: RecordingGpu;
  renderer: WebgpuRenderer;
}> {
  const gpu = createRecordingGpu();
  const renderer = new WebgpuRenderer();
  await withHostGpu(gpu.gpu, async () => {
    await renderer.initialize({ canvas: gpu.canvas });
  });
  renderer.resize(256, 256, 1);
  gpu.reset();
  return { gpu, renderer };
}

/** The instance-stream uploads on the WebGPU tape: writes of `floats` elements. */
function instanceUploads(gpu: RecordingGpu, floats: number): number[][] {
  return gpu
    .callsOf("queue.writeBuffer")
    .filter((call) => call.args[4] === floats)
    .map((call) => call.args[2] as number[]);
}

describe("WebGPU particles — the real @fourjs/particles node (§36, WP-R1.8)", () => {
  it("draws the system as one instanced draw of the repacked pool", async () => {
    const { renderable, scene, views } = fountain();
    const { gpu, renderer } = await webgpuRig();

    renderer.render(scene, views);

    // One clear triangle, then the system: six quad vertices, one instance
    // per live particle — never a draw per particle.
    const draws = gpu.callsOf("pass.draw");
    expect(draws).toHaveLength(2);
    expect(draws[1]?.args[0]).toBe(6);
    expect(draws[1]?.args[1]).toBe(BURST_COUNT);
    expect(renderable.particleCount).toBe(BURST_COUNT);

    // The uploaded instance stream is the node's own repacked prefix, byte
    // for byte — the §64 stage 6 contract met by the real class.
    const floats = BURST_COUNT * PARTICLE_INSTANCE_FLOATS;
    const uploads = instanceUploads(gpu, floats);
    expect(uploads).toHaveLength(1);
    // The tape snapshots the whole retained array; the *live prefix* — the
    // five-argument form's element range — is the upload's content.
    expect(uploads[0]?.slice(0, floats)).toEqual(
      Array.from(renderable.particleInstances.slice(0, floats)),
    );

    // The emitting node's world matrix rides the particle block's model
    // slot — §36 positions are node-local, placed like any other item's.
    const uniformWrites = gpu.callsOf("queue.writeBuffer");
    const uniforms = uniformWrites[uniformWrites.length - 1]?.args[2] as
      number[] | undefined;
    const model = UNIFORM_STRIDE_BYTES / 4 + PARTICLE_MODEL_OFFSET / 4;
    expect(uniforms?.slice(model + 12, model + 15)).toEqual([1, 2, 3]);

    // …bound through the particle block, not `DrawUniforms`.
    const particleGroups = gpu
      .callsOf("device.createBindGroup")
      .map((call) => call.args[0] as { label?: string; entries: unknown[] })
      .filter((descriptor) => descriptor.label === "fourJS:particle-uniforms");
    expect(particleGroups).toHaveLength(1);
    expect(
      (particleGroups[0]?.entries[0] as { resource: { size?: number } })
        .resource.size,
    ).toBe(PARTICLE_UNIFORM_BYTES);
    renderer.dispose();
  });

  it("submits the same instanced draw and bytes as the WebGL backend", async () => {
    // The GL half, over the identical deterministic scene. WebGL's particle
    // pipeline is a registration seam since 2026-09-11.
    registerParticlePipeline();
    const glScene = fountain();
    const recording = createRecordingGl();
    const glRenderer = new WebglRenderer();
    void glRenderer.initialize({ canvas: new RecordingCanvas(recording.gl) });
    glRenderer.resize(256, 256, 1);
    recording.reset();
    glRenderer.render(glScene.scene, glScene.views);

    const glDraws = recording.callsOf("drawArraysInstanced");
    expect(glDraws).toHaveLength(1);
    expect(glDraws[0]?.args).toEqual([GL_TRIANGLES, 0, 6, BURST_COUNT]);
    const floats = BURST_COUNT * PARTICLE_INSTANCE_FLOATS;
    const glUpload = recording.callsOf("bufferSubData")[0];
    expect(glUpload?.args[4]).toBe(floats);
    // Snapshotted now: recording-gl retains the live array by reference.
    const glBytes = Array.from(
      (glUpload?.args[2] as Float32Array).slice(0, floats),
    );

    // The WebGPU half.
    const gpuScene = fountain();
    const { gpu, renderer } = await webgpuRig();
    renderer.render(gpuScene.scene, gpuScene.views);
    const gpuDraws = gpu
      .callsOf("pass.draw")
      .filter((call) => call.args[1] === BURST_COUNT);
    expect(gpuDraws).toHaveLength(1);
    expect(gpuDraws[0]?.args[0]).toBe(6);
    expect(instanceUploads(gpu, floats)[0]?.slice(0, floats)).toEqual(glBytes);
    glRenderer.dispose();
    renderer.dispose();
  });

  it("re-uploads the stream each frame as the simulation advances", async () => {
    const { emitter, renderable, scene, views } = fountain();
    const { gpu, renderer } = await webgpuRig();
    const floats = BURST_COUNT * PARTICLE_INSTANCE_FLOATS;

    renderer.render(scene, views);
    const first = instanceUploads(gpu, floats)[0]?.slice(0, floats);
    emitter.step(1 / 60, 1 / 60);
    gpu.reset();
    renderer.render(scene, views);
    const second = instanceUploads(gpu, floats)[0]?.slice(0, floats);

    // Same buffer (no reallocation — capacity is fixed), fresh bytes: the
    // §36 particles moved by one step of their +Y fountain velocities.
    expect(gpu.countOf("device.createBuffer")).toBe(0);
    expect(second).not.toEqual(first);
    expect(second).toEqual(
      Array.from(renderable.particleInstances.slice(0, floats)),
    );
    renderer.dispose();
  });
});
