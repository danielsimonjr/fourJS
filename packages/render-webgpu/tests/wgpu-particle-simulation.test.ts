/**
 * `WgpuParticleSimulation` (§36 `simulation: "gpu"`, R-31 wiring) against
 * the recording device: allocation shapes, the integrate dispatch and its
 * params bytes, spawn writes, the scratch-mediated `moveSlot` copies, the
 * lifecycle and capability refusals, and the Q3-promotion narrowing in
 * `WgpuComputeCache.dispatch` (a foreign structural buffer is refused).
 * What the tape cannot prove — that integrated positions land where the
 * draw reads them — is `tests/browser/webgpu/webgpu-gpu-particles.spec.ts`'s
 * claim against a real adapter.
 */

import { isFourError, type FourError } from "@fourjs/core";
import type { ComputeBuffer } from "@fourjs/render";
import { describe, expect, it } from "vitest";

import {
  createRecordingGpu,
  type RecordingGpu,
} from "../../../tests/integration/helpers/recording-gpu.js";
import {
  GPU_BUFFER_USAGE,
  PARTICLE_INTEGRATOR_WORKGROUP_SIZE,
  PARTICLE_SIMULATION_FIELD_FLOATS,
  PARTICLE_SIMULATION_HEADER_FLOATS,
  PARTICLE_SIMULATION_PARAMS_FLOATS,
  DEFAULT_DEPTH_BIAS,
  PARTICLE_SIMULATION_SCRATCH_BYTES,
  PARTICLE_SIMULATION_VECTOR_BYTES,
  WgpuComputeCache,
  WgpuParticleSimulation,
  createComputeBuffer,
  readComputeBufferBytes,
  type GpuDevice,
} from "../src/index.js";

/** Catches a synchronous `FourError` and returns it. */
function thrown(body: () => unknown): FourError {
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

/** A fresh recording device plus a compute cache and a simulation over it. */
function rig(capacity = 8): {
  gpu: RecordingGpu;
  device: GpuDevice;
  cache: WgpuComputeCache;
  simulation: WgpuParticleSimulation;
  disposals: number[];
} {
  const gpu = createRecordingGpu();
  const device = gpu.device as GpuDevice;
  const cache = new WgpuComputeCache(device);
  const disposals: number[] = [];
  const simulation = new WgpuParticleSimulation(
    device,
    cache,
    { systemId: "node-1", capacity },
    () => disposals.push(1),
  );
  return { gpu, device, cache, simulation, disposals };
}

/** A device double whose compute members are stripped, WebGL-2-shaped. */
function computelessDevice(raw: GpuDevice): GpuDevice {
  const stripped: GpuDevice = { ...raw };
  delete stripped.createComputePipeline;
  return stripped;
}

/** A device double whose encoders cannot copy buffer-to-buffer. */
function copylessDevice(raw: GpuDevice): GpuDevice {
  return {
    ...raw,
    createCommandEncoder: (descriptor) => {
      const encoder = raw.createCommandEncoder(descriptor);
      return {
        beginRenderPass: encoder.beginRenderPass.bind(encoder),
        beginComputePass: encoder.beginComputePass?.bind(encoder),
        finish: encoder.finish.bind(encoder),
      };
    },
  };
}

describe("WgpuParticleSimulation creation (§36, §83)", () => {
  it("allocates the four buffers with the recorded shapes", () => {
    const { gpu, simulation } = rig(10);
    const creates = gpu
      .callsOf("device.createBuffer")
      .map(
        (call) =>
          call.args[0] as { label: string; size: number; usage: number },
      );
    expect(creates).toHaveLength(4);
    // Positions: the one recorded usage deviation — VERTEX on top of the
    // compute trio, because the draw binds this allocation as the instance
    // position stream (module header).
    expect(creates[0]).toEqual({
      label: "fourJS:particle-sim:node-1:positions",
      size: 10 * PARTICLE_SIMULATION_VECTOR_BYTES,
      usage:
        GPU_BUFFER_USAGE.STORAGE |
        GPU_BUFFER_USAGE.VERTEX |
        GPU_BUFFER_USAGE.COPY_DST |
        GPU_BUFFER_USAGE.COPY_SRC,
    });
    expect(creates[1]?.label).toBe("fourJS:particle-sim:node-1:velocities");
    expect(creates[1]?.usage).toBe(
      GPU_BUFFER_USAGE.STORAGE |
        GPU_BUFFER_USAGE.COPY_DST |
        GPU_BUFFER_USAGE.COPY_SRC,
    );
    expect(creates[2]?.label).toBe("fourJS:particle-sim:node-1:params");
    expect(creates[2]?.size).toBe(PARTICLE_SIMULATION_PARAMS_FLOATS * 4);
    expect(creates[3]).toEqual({
      label: "fourJS:particle-sim:node-1:scratch",
      size: PARTICLE_SIMULATION_SCRATCH_BYTES,
      usage: GPU_BUFFER_USAGE.COPY_SRC | GPU_BUFFER_USAGE.COPY_DST,
    });
    expect(simulation.capacity).toBe(10);
    expect(simulation.systemId).toBe("node-1");
    expect(simulation.isParticleGpuSimulation).toBe(true);
    expect(simulation.disposed).toBe(false);
  });

  it("exposes both lane buffers as readable §82 compute buffers", async () => {
    const { device, simulation } = rig(4);
    const bytes = await readComputeBufferBytes(device, simulation.positions);
    expect(bytes?.byteLength).toBe(4 * PARTICLE_SIMULATION_VECTOR_BYTES);
    expect(simulation.positions.isComputeBuffer).toBe(true);
    expect(simulation.velocities.isComputeBuffer).toBe(true);
  });

  it("refuses a non-positive or fractional capacity", () => {
    const gpu = createRecordingGpu();
    const device = gpu.device as GpuDevice;
    const cache = new WgpuComputeCache(device);
    for (const capacity of [0, -1, 2.5]) {
      const error = thrown(
        () =>
          new WgpuParticleSimulation(device, cache, {
            systemId: "node-1",
            capacity,
          }),
      );
      expect(error.code).toBe("INVALID_APPLICATION_STATE");
    }
  });

  it("refuses a compute-less device surface up front", () => {
    const gpu = createRecordingGpu();
    const device = computelessDevice(gpu.device as GpuDevice);
    const error = thrown(
      () =>
        new WgpuParticleSimulation(device, new WgpuComputeCache(device), {
          systemId: "node-1",
          capacity: 4,
        }),
    );
    expect(error.code).toBe("UNSUPPORTED_GPU_FEATURE");
  });

  it("refuses a copy-less device surface up front", () => {
    const gpu = createRecordingGpu();
    const device = copylessDevice(gpu.device as GpuDevice);
    const error = thrown(
      () =>
        new WgpuParticleSimulation(device, new WgpuComputeCache(device), {
          systemId: "node-1",
          capacity: 4,
        }),
    );
    expect(error.code).toBe("UNSUPPORTED_GPU_FEATURE");
    expect(error.message).toMatch(/copyBufferToBuffer/);
  });
});

describe("integrate — the WP-R1.8 kernel, dispatched (§36, §82)", () => {
  it("packs the params whole and dispatches the covering grid", () => {
    const { gpu, simulation } = rig(200);
    gpu.reset();
    simulation.integrate(130, 1 / 60, 0, -9.81, 0);

    const write = gpu.callsOf("queue.writeBuffer")[0];
    const packed = write?.args[2] as number[];
    expect(packed).toHaveLength(PARTICLE_SIMULATION_PARAMS_FLOATS);
    expect(packed.slice(0, 8)).toEqual([
      Math.fround(1 / 60),
      130,
      0,
      0,
      0,
      Math.fround(-9.81),
      0,
      0,
    ]);
    expect(packed.slice(8).every((value) => value === 0)).toBe(true);

    const dispatch = gpu.callsOf("computePass.dispatchWorkgroups")[0];
    expect(dispatch?.args).toEqual([
      Math.ceil(130 / PARTICLE_INTEGRATOR_WORKGROUP_SIZE),
      1,
      1,
    ]);
    expect(gpu.countOf("queue.submit")).toBe(1);
  });

  it("reuses one pipeline and one module across steps", () => {
    const { gpu, cache, simulation } = rig(8);
    simulation.integrate(3, 1 / 60, 0, 0, 0);
    simulation.integrate(5, 1 / 60, 0, -1, 0);
    expect(cache.pipelineCount).toBe(1);
    expect(cache.moduleCount).toBe(1);
    expect(gpu.countOf("device.createComputePipeline")).toBe(1);
  });

  it("refuses a count outside (0, capacity]", () => {
    const { simulation } = rig(8);
    for (const count of [0, -1, 9, 1.5]) {
      const error = thrown(() => {
        simulation.integrate(count, 1 / 60, 0, 0, 0);
      });
      expect(error.code).toBe("INVALID_APPLICATION_STATE");
    }
  });
});

describe("writeSpawn — spawn state entering residency", () => {
  it("writes 12 position bytes and 12 velocity bytes at the slot offset", () => {
    const { gpu, simulation } = rig(8);
    gpu.reset();
    simulation.writeSpawn(5, 1, 2, 3, 4, 5, 6);
    const writes = gpu.callsOf("queue.writeBuffer");
    expect(writes).toHaveLength(2);
    expect(writes[0]?.args[0]).toBe(simulation.positions.buffer);
    expect(writes[0]?.args[1]).toBe(5 * PARTICLE_SIMULATION_VECTOR_BYTES);
    expect(writes[0]?.args[2]).toEqual([1, 2, 3]);
    expect(writes[1]?.args[0]).toBe(simulation.velocities.buffer);
    expect(writes[1]?.args[1]).toBe(5 * PARTICLE_SIMULATION_VECTOR_BYTES);
    expect(writes[1]?.args[2]).toEqual([4, 5, 6]);
  });

  it("refuses a slot outside [0, capacity)", () => {
    const { simulation } = rig(4);
    for (const index of [-1, 4, 0.5]) {
      const error = thrown(() => {
        simulation.writeSpawn(index, 0, 0, 0, 0, 0, 0);
      });
      expect(error.code).toBe("INVALID_APPLICATION_STATE");
    }
  });
});

describe("moveSlot — the swap-remove mirror through the scratch", () => {
  it("records four copies via the scratch and one submit", () => {
    const { gpu, simulation } = rig(8);
    gpu.reset();
    simulation.moveSlot(7, 2);
    const copies = gpu.callsOf("encoder.copyBufferToBuffer");
    const bytes = PARTICLE_SIMULATION_VECTOR_BYTES;
    expect(copies.map((call) => call.args.slice(1))).toEqual([
      [7 * bytes, expect.anything(), 0, bytes],
      [0, simulation.positions.buffer, 2 * bytes, bytes],
      [7 * bytes, expect.anything(), bytes, bytes],
      [bytes, simulation.velocities.buffer, 2 * bytes, bytes],
    ]);
    expect(copies[0]?.args[0]).toBe(simulation.positions.buffer);
    expect(copies[2]?.args[0]).toBe(simulation.velocities.buffer);
    // The intra-buffer detour: the scratch is both copies' middle stop.
    expect(copies[0]?.args[2]).toBe(copies[1]?.args[0]);
    expect(copies[2]?.args[2]).toBe(copies[3]?.args[0]);
    expect(gpu.countOf("queue.submit")).toBe(1);
  });

  it("refuses a self-move and out-of-range slots", () => {
    const { simulation } = rig(8);
    expect(
      thrown(() => {
        simulation.moveSlot(3, 3);
      }).code,
    ).toBe("INVALID_APPLICATION_STATE");
    expect(
      thrown(() => {
        simulation.moveSlot(8, 0);
      }).code,
    ).toBe("INVALID_APPLICATION_STATE");
    expect(
      thrown(() => {
        simulation.moveSlot(0, -1);
      }).code,
    ).toBe("INVALID_APPLICATION_STATE");
  });
});

describe("a surface that changes its answers after creation (§62 honesty)", () => {
  it("integrate reports the capability loss rather than no-op'ing", () => {
    // `beginComputePass` stripped while `createComputePipeline` and the
    // copy entry point survive: the constructor's probes pass, the cache's
    // dispatch then records nothing and answers false — and integrate turns
    // that into the capability error instead of swallowing it (§85).
    const gpu = createRecordingGpu();
    const raw = gpu.device as GpuDevice;
    const device: GpuDevice = {
      ...raw,
      createCommandEncoder: (descriptor) => {
        const encoder = raw.createCommandEncoder(descriptor);
        return {
          beginRenderPass: encoder.beginRenderPass.bind(encoder),
          copyBufferToBuffer: encoder.copyBufferToBuffer?.bind(encoder),
          finish: encoder.finish.bind(encoder),
        };
      },
    };
    const simulation = new WgpuParticleSimulation(
      device,
      new WgpuComputeCache(device),
      { systemId: "node-1", capacity: 4 },
    );
    const error = thrown(() => {
      simulation.integrate(1, 1 / 60, 0, 0, 0);
    });
    expect(error.code).toBe("UNSUPPORTED_GPU_FEATURE");
  });

  it("moveSlot reports a per-encoder copy loss rather than skipping", () => {
    // The first encoder (the constructor's probe) can copy; every later one
    // cannot — the broken-surface case the source names, answered with the
    // capability error, never a silently unmirrored move.
    const gpu = createRecordingGpu();
    const raw = gpu.device as GpuDevice;
    let encoders = 0;
    const device: GpuDevice = {
      ...raw,
      createCommandEncoder: (descriptor) => {
        const encoder = raw.createCommandEncoder(descriptor);
        encoders += 1;
        if (encoders === 1) {
          return encoder;
        }
        return {
          beginRenderPass: encoder.beginRenderPass.bind(encoder),
          beginComputePass: encoder.beginComputePass?.bind(encoder),
          finish: encoder.finish.bind(encoder),
        };
      },
    };
    const simulation = new WgpuParticleSimulation(
      device,
      new WgpuComputeCache(device),
      { systemId: "node-1", capacity: 4 },
    );
    const error = thrown(() => {
      simulation.moveSlot(1, 0);
    });
    expect(error.code).toBe("UNSUPPORTED_GPU_FEATURE");
    expect(error.message).toMatch(/copyBufferToBuffer/);
  });
});

describe("disposal (§83)", () => {
  it("destroys all four allocations, unhooks once, and refuses afterwards", () => {
    const { gpu, simulation, disposals } = rig(4);
    gpu.reset();
    simulation.dispose();
    simulation.dispose();
    expect(simulation.disposed).toBe(true);
    expect(gpu.countOf("buffer.destroy")).toBe(4);
    expect(disposals).toEqual([1]);
    for (const body of [
      (): void => {
        simulation.integrate(1, 1 / 60, 0, 0, 0);
      },
      (): void => {
        simulation.writeSpawn(0, 0, 0, 0, 0, 0, 0);
      },
      (): void => {
        simulation.moveSlot(1, 0);
      },
    ]) {
      expect(thrown(body).code).toBe("INVALID_APPLICATION_STATE");
    }
  });
});

describe("the Q3 promotion's structural-handle narrowing (§82, §85)", () => {
  it("dispatch refuses a buffer another backend minted — bare and in a record", () => {
    const gpu = createRecordingGpu();
    const device = gpu.device as GpuDevice;
    const cache = new WgpuComputeCache(device);
    const foreign: ComputeBuffer = {
      isComputeBuffer: true,
      byteLength: 16,
      disposed: false,
      dispose: () => undefined,
    };
    for (const bindings of [[foreign], [{ buffer: foreign }]]) {
      const error = thrown(() =>
        cache.dispatch({
          shader: "@compute fn computeMain() {}",
          workgroups: [1, 1, 1],
          bindings,
        }),
      );
      expect(error.code).toBe("INVALID_APPLICATION_STATE");
      expect(error.message).toMatch(/did not\s+create/);
    }
    expect(gpu.countOf("device.createComputePipeline")).toBe(0);
  });

  it("brands WgpuComputeBuffer as the promoted handle", () => {
    const gpu = createRecordingGpu();
    const buffer = createComputeBuffer(gpu.device as GpuDevice, { size: 16 });
    // The structural face the promotion crossed the seam with.
    const handle: ComputeBuffer = buffer;
    expect(handle.isComputeBuffer).toBe(true);
  });
});

describe("integrate — the §27 field stack and scene-depth collision", () => {
  const lastParams = (gpu: RecordingGpu): number[] => {
    const writes = gpu.callsOf("queue.writeBuffer");
    return writes[writes.length - 1]?.args[2] as number[];
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  it("packs an ordered stack and the time into the params", () => {
    const { gpu, simulation } = rig(8);
    simulation.integrate(2, 1 / 60, 0, 0, 0, {
      time: 1.5,
      fields: [
        { kind: "drag", coefficient: 2 },
        { kind: "uniform", x: 1, y: 2, z: 3 },
      ],
    });
    const params = lastParams(gpu);
    expect(params[12]).toBe(2);
    expect(params[13]).toBe(1.5);
    expect(params[PARTICLE_SIMULATION_HEADER_FLOATS + 1]).toBe(2);
    expect(
      params[
        PARTICLE_SIMULATION_HEADER_FLOATS + PARTICLE_SIMULATION_FIELD_FLOATS + 6
      ],
    ).toBe(3);
  });

  it("packs the legacy radial spelling as a one-record stack, cached by identity", () => {
    const { gpu, simulation } = rig(8);
    const radial = {
      originX: 1,
      originY: 2,
      originZ: 3,
      strength: -4,
      minDistance: 0.5,
    };
    simulation.integrate(2, 1 / 60, 0, 0, 0, { radial });
    simulation.integrate(2, 1 / 60, 0, 0, 0, { radial });
    const params = lastParams(gpu);
    expect(params[12]).toBe(1);
    expect(params[PARTICLE_SIMULATION_HEADER_FLOATS + 1]).toBe(-4);
  });

  it("rests on the ground (mode 1) with no depth bound, and runs no depth pass", () => {
    const { gpu, simulation } = rig(8);
    simulation.integrate(2, 1 / 60, 0, 0, 0, {
      collisions: "depth-buffer",
      collisionGroundY: -2,
    });
    const params = lastParams(gpu);
    expect(params[7]).toBe(1);
    expect(params[11]).toBe(-2);
    expect(gpu.countOf("computePass.dispatchWorkgroups")).toBe(1);
    expect(simulation.hasSceneDepth).toBe(false);
  });

  it("kills against a bound scene depth with a second dispatch (mode 2)", () => {
    const { gpu, simulation } = rig(200);
    const view = {};
    simulation.bindSceneDepth(view, identity);
    expect(simulation.hasSceneDepth).toBe(true);
    gpu.reset();
    simulation.integrate(130, 1 / 60, 0, 0, 0, { collisions: "depth-buffer" });
    simulation.integrate(130, 1 / 60, 0, 0, 0, { collisions: "depth-buffer" });
    const params = lastParams(gpu);
    expect(params[7]).toBe(2);
    expect(params[14]).toBeCloseTo(DEFAULT_DEPTH_BIAS);
    expect(Array.from(params.slice(16, 32))).toEqual(identity);
    expect(gpu.countOf("computePass.dispatchWorkgroups")).toBe(4);
    // One layout, one pipeline and one bind group serve both steps.
    expect(gpu.countOf("device.createComputePipeline")).toBe(2);
    simulation.updateViewProjection(identity.map((v) => v * 2));
    simulation.bindSceneDepth({}, identity, 0.01);
    simulation.unbindSceneDepth();
    expect(simulation.hasSceneDepth).toBe(false);
  });

  it("refuses a malformed matrix and calls after dispose", () => {
    const { simulation } = rig(4);
    expect(thrown(() => simulation.bindSceneDepth({}, [1, 2])).code).toBe(
      "INVALID_APPLICATION_STATE",
    );
    simulation.dispose();
    expect(thrown(() => simulation.bindSceneDepth({}, identity)).code).toBe(
      "INVALID_APPLICATION_STATE",
    );
  });
});
