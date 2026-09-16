/**
 * WP-R1.8's particle units, tested directly: the uniform-block table, the
 * instance vertex layout, the WGSL module's shape, and the per-system
 * instance-buffer cache — the `wgpu-particles.ts` halves a failure should
 * localise to. The renderer-level behaviour — the instanced draw, the
 * three-matrix block, byte identity for particle-less scenes — lives in
 * `webgpu-renderer.test.ts`, and the cross-package path through the real
 * `@fourjs/particles` node in `tests/integration/webgpu-particles.test.ts`.
 */

import {
  PARTICLE_INSTANCE_FLOATS,
  particleQuadGeometry,
  type ParticleRenderItem,
} from "@fourjs/render";
import { Matrix4 } from "@fourjs/math";
import { describe, expect, it } from "vitest";

import { createRecordingGpu } from "../../../tests/integration/helpers/recording-gpu.js";
import {
  GPU_BUFFER_USAGE,
  GPU_SHADER_STAGE,
  PARTICLE_INSTANCE_BUFFER_LAYOUT,
  PARTICLE_INSTANCE_STRIDE_BYTES,
  PARTICLE_MODEL_OFFSET,
  PARTICLE_PROJECTION_OFFSET,
  PARTICLE_APPEARANCE_SHADER_SOURCE,
  PARTICLE_SHADER_SOURCE,
  PARTICLE_WIDE_INSTANCE_STRIDE_BYTES,
  PARTICLE_UNIFORM_BYTES,
  PARTICLE_VERTEX_BUFFER_LAYOUTS,
  PARTICLE_VIEW_OFFSET,
  POSITION_BUFFER_LAYOUT,
  WgpuParticleCache,
  createParticleBindGroupLayout,
  type GpuDevice,
} from "../src/index.js";

/**
 * A render item as `buildRenderList` writes it for a particle system — the GL
 * suite's factory, restated for this backend's cache.
 */
function particleItem(
  instances: Float32Array,
  count: number,
  id = "item-particles",
): ParticleRenderItem {
  return {
    kind: "particles",
    id,
    count,
    instances,
    worldMatrix: new Matrix4(),
    geometry: particleQuadGeometry(),
    renderLayer: 0,
    renderOrder: 0,
    layers: 1,
    transparent: false,
    materialId: "",
    castShadow: false,
    receiveShadow: false,
    frustumCulled: false,
    viewDepth: 0,
  };
}

describe("the particle uniform block (§36, WP-R1.8)", () => {
  it("lays out three matrices — projection, view, model — in 192 bytes", () => {
    expect(PARTICLE_PROJECTION_OFFSET).toBe(0);
    expect(PARTICLE_VIEW_OFFSET).toBe(64);
    expect(PARTICLE_MODEL_OFFSET).toBe(128);
    expect(PARTICLE_UNIFORM_BYTES).toBe(192);
  });

  it("declares a vertex-only, dynamically-offset binding of the block size", () => {
    const gpu = createRecordingGpu();
    createParticleBindGroupLayout(gpu.device as GpuDevice);
    expect(gpu.callsOf("device.createBindGroupLayout")[0]?.args[0]).toEqual({
      label: "fourJS:particle-uniforms",
      entries: [
        {
          binding: 0,
          visibility: GPU_SHADER_STAGE.VERTEX,
          buffer: {
            type: "uniform",
            hasDynamicOffset: true,
            minBindingSize: PARTICLE_UNIFORM_BYTES,
          },
        },
      ],
    });
  });
});

describe("the particle vertex layouts", () => {
  it("interleaves centre, size and colour at @fourjs/render's stride", () => {
    expect(PARTICLE_INSTANCE_STRIDE_BYTES).toBe(
      PARTICLE_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    );
    expect(PARTICLE_INSTANCE_BUFFER_LAYOUT).toEqual({
      arrayStride: 32,
      stepMode: "instance",
      attributes: [
        { format: "float32x3", offset: 0, shaderLocation: 1 },
        { format: "float32", offset: 12, shaderLocation: 2 },
        { format: "float32x4", offset: 16, shaderLocation: 3 },
      ],
    });
  });

  it("binds the shared corner quad per vertex ahead of the instance stream", () => {
    expect(PARTICLE_VERTEX_BUFFER_LAYOUTS).toEqual([
      POSITION_BUFFER_LAYOUT,
      PARTICLE_INSTANCE_BUFFER_LAYOUT,
    ]);
  });
});

describe("the particle WGSL module", () => {
  it("reads the three matrices and the four attribute streams by location", () => {
    expect(PARTICLE_SHADER_SOURCE).toContain("projection : mat4x4<f32>");
    expect(PARTICLE_SHADER_SOURCE).toContain("view : mat4x4<f32>");
    expect(PARTICLE_SHADER_SOURCE).toContain("model : mat4x4<f32>");
    expect(PARTICLE_SHADER_SOURCE).toContain("@location(0) corner : vec3<f32>");
    expect(PARTICLE_SHADER_SOURCE).toContain(
      "@location(1) instancePosition : vec3<f32>",
    );
    expect(PARTICLE_SHADER_SOURCE).toContain("@location(2) instanceSize : f32");
    expect(PARTICLE_SHADER_SOURCE).toContain(
      "@location(3) instanceColor : vec4<f32>",
    );
  });

  it("billboards in view space — offset between the view and the projection", () => {
    // GL's derivation, verbatim: the centre transforms through view · model,
    // the corner offset is applied to the view-space xy scaled by the size,
    // and only then does the projection run (`gl-particles.ts`).
    expect(PARTICLE_SHADER_SOURCE).toContain(
      "var center = draw.view * draw.model * vec4<f32>(instancePosition, 1.0);",
    );
    expect(PARTICLE_SHADER_SOURCE).toContain(
      "center.x = center.x + corner.x * instanceSize;",
    );
    expect(PARTICLE_SHADER_SOURCE).toContain(
      "center.y = center.y + corner.y * instanceSize;",
    );
    expect(PARTICLE_SHADER_SOURCE).toContain(
      "let clip = draw.projection * center;",
    );
    // §3.3.8's depth remap, in this module like every other vertex stage.
    expect(PARTICLE_SHADER_SOURCE).toContain("(clip.z + clip.w) * 0.5");
  });

  it("shades the interpolated instance colour and nothing else", () => {
    expect(PARTICLE_SHADER_SOURCE).toContain("return input.color;");
    // No texture and no sampler: §36's textured tier is staged with §55's
    // texture path, as recorded in gl-particles.ts.
    expect(PARTICLE_SHADER_SOURCE).not.toContain("textureSample");
  });
});

describe("R-32 appearance WGSL (opt-in, default shader unchanged)", () => {
  it("rotates the billboard, samples map, and fades by view-Z when no depth", () => {
    expect(PARTICLE_APPEARANCE_SHADER_SOURCE).toContain(
      "cos(instanceRotation)",
    );
    expect(PARTICLE_APPEARANCE_SHADER_SOURCE).toContain("textureSample");
    expect(PARTICLE_APPEARANCE_SHADER_SOURCE).toContain(
      "abs(input.viewZ) * input.softness",
    );
    expect(PARTICLE_WIDE_INSTANCE_STRIDE_BYTES).toBe(40);
  });
});

describe("WgpuParticleCache — one instance buffer per system (§61, §64)", () => {
  function harness(): {
    gpu: ReturnType<typeof createRecordingGpu>;
    cache: WgpuParticleCache;
  } {
    const gpu = createRecordingGpu();
    return { gpu, cache: new WgpuParticleCache(gpu.device as GpuDevice) };
  }

  it("allocates the buffer once, at full capacity, vertex-usable and writable", () => {
    const { gpu, cache } = harness();
    const item = particleItem(
      new Float32Array(4 * PARTICLE_INSTANCE_FLOATS),
      1,
      "system-a",
    );

    const record = cache.acquire(item);

    expect(record).not.toBeNull();
    expect(cache.size).toBe(1);
    expect(record?.capacityFloats).toBe(4 * PARTICLE_INSTANCE_FLOATS);
    expect(gpu.callsOf("device.createBuffer")[0]?.args[0]).toEqual({
      label: "fourJS:particles:system-a",
      size: 4 * PARTICLE_INSTANCE_FLOATS * 4,
      usage: GPU_BUFFER_USAGE.VERTEX | GPU_BUFFER_USAGE.COPY_DST,
    });
    // Allocation only — the upload is the frame's, not the acquire's.
    expect(gpu.countOf("queue.writeBuffer")).toBe(0);
  });

  it("returns the same record for an unchanged system", () => {
    const { gpu, cache } = harness();
    const item = particleItem(
      new Float32Array(2 * PARTICLE_INSTANCE_FLOATS),
      2,
    );

    const first = cache.acquire(item);
    gpu.reset();
    const second = cache.acquire(item);

    expect(second).toBe(first);
    expect(gpu.countOf("device.createBuffer")).toBe(0);
  });

  it("rebuilds — destroying the old buffer — when the capacity changes", () => {
    const { gpu, cache } = harness();
    const small = particleItem(new Float32Array(PARTICLE_INSTANCE_FLOATS), 1);
    const grown = particleItem(
      new Float32Array(2 * PARTICLE_INSTANCE_FLOATS),
      2,
    );

    const first = cache.acquire(small);
    const afterGrowth = cache.acquire(grown);

    expect(afterGrowth).not.toBe(first);
    expect(cache.size).toBe(1);
    expect(gpu.countOf("buffer.destroy")).toBe(1);
    expect(gpu.countOf("device.createBuffer")).toBe(2);
  });

  it("returns null without an entry for a system with no capacity", () => {
    const { gpu, cache } = harness();

    expect(cache.acquire(particleItem(new Float32Array(0), 0))).toBeNull();
    expect(cache.size).toBe(0);
    expect(gpu.countOf("device.createBuffer")).toBe(0);
  });

  it("uploads the live prefix once per frame, through the five-argument form", () => {
    const { gpu, cache } = harness();
    const instances = new Float32Array(4 * PARTICLE_INSTANCE_FLOATS);
    instances[0] = 3;
    const item = particleItem(instances, 2);
    const record = cache.acquire(item);
    if (record === null) {
      throw new Error("expected a record");
    }
    gpu.reset();

    cache.upload(record, item, 1);
    // The second view of the same frame: gated away, no second write.
    cache.upload(record, item, 1);
    // The next frame uploads again.
    cache.upload(record, item, 2);

    const uploads = gpu.callsOf("queue.writeBuffer");
    expect(uploads).toHaveLength(2);
    // buffer, bufferOffset 0, data, dataOffset 0 **elements**, size in
    // elements — the allocation-free five-argument form (plan D7).
    expect(uploads[0]?.args[1]).toBe(0);
    expect((uploads[0]?.args[2] as number[])[0]).toBe(3);
    expect(uploads[0]?.args[3]).toBe(0);
    expect(uploads[0]?.args[4]).toBe(2 * PARTICLE_INSTANCE_FLOATS);
  });

  it("forgets every record without touching the device (§61 loss)", () => {
    const { gpu, cache } = harness();
    cache.acquire(particleItem(new Float32Array(PARTICLE_INSTANCE_FLOATS), 1));
    gpu.reset();

    cache.forget();

    expect(cache.size).toBe(0);
    expect(gpu.calls).toHaveLength(0);
  });

  it("destroys every buffer on dispose, idempotently, and refuses acquires after", () => {
    const { gpu, cache } = harness();
    cache.acquire(
      particleItem(new Float32Array(PARTICLE_INSTANCE_FLOATS), 1, "a"),
    );
    cache.acquire(
      particleItem(new Float32Array(PARTICLE_INSTANCE_FLOATS), 1, "b"),
    );
    gpu.reset();

    cache.dispose();
    cache.dispose();

    expect(cache.disposed).toBe(true);
    expect(cache.size).toBe(0);
    expect(gpu.countOf("buffer.destroy")).toBe(2);
    // A draw racing teardown skips rather than resurrecting the cache.
    expect(
      cache.acquire(
        particleItem(new Float32Array(PARTICLE_INSTANCE_FLOATS), 1),
      ),
    ).toBeNull();
  });
});
