/**
 * §36 `simulation: "gpu"` — the R-31 wiring (2026-08-29), emitter side.
 *
 * Everything here drives a fake {@link ParticleGpuSimulation} that records
 * its calls: the contract under test is the *emitter's* half — refusals, the
 * per-step call sequence (`integrate` → `moveSlot`s → `writeSpawn`s), the
 * device mirror of swap-remove compaction, and the CPU/GPU spawn-stream
 * parity that the division-of-labour decision promises (`types.ts`). The
 * device half is `@fourjs/render-webgpu`'s suite; the two pin the structural
 * contract from both sides, since no compiler checks it across the §3.1
 * boundary.
 */

import { isFourError, type FourError } from "@fourjs/core";
import { Vector3 } from "@fourjs/math";
import { describe, expect, it } from "vitest";

import {
  ParticleEmitter,
  ParticleRenderable,
  radialField,
  type ParticleEmitterOptions,
  type ParticleGpuSimulation,
  type ParticleSimulationMode,
} from "../src/index.js";

/** One recorded driver call. */
interface DriverCall {
  readonly kind: "integrate" | "writeSpawn" | "moveSlot";
  readonly args: readonly unknown[];
}

/** A recording implementor of the structural driver contract. */
class FakeGpuSimulation implements ParticleGpuSimulation {
  readonly isParticleGpuSimulation = true;
  readonly capacity: number;
  readonly calls: DriverCall[] = [];

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  integrate(
    count: number,
    deltaSeconds: number,
    gravityX: number,
    gravityY: number,
    gravityZ: number,
    extras?: import("../src/types.js").ParticleGpuIntegrateExtras,
  ): void {
    this.calls.push({
      kind: "integrate",
      args: extras
        ? [count, deltaSeconds, gravityX, gravityY, gravityZ, extras]
        : [count, deltaSeconds, gravityX, gravityY, gravityZ],
    });
  }

  writeSpawn(
    index: number,
    positionX: number,
    positionY: number,
    positionZ: number,
    velocityX: number,
    velocityY: number,
    velocityZ: number,
  ): void {
    this.calls.push({
      kind: "writeSpawn",
      args: [
        index,
        positionX,
        positionY,
        positionZ,
        velocityX,
        velocityY,
        velocityZ,
      ],
    });
  }

  moveSlot(from: number, to: number): void {
    this.calls.push({ kind: "moveSlot", args: [from, to] });
  }

  /** The calls of one kind, in order. */
  of(kind: DriverCall["kind"]): DriverCall[] {
    return this.calls.filter((call) => call.kind === kind);
  }
}

/** A bound GPU emitter plus its recording driver. */
function gpuEmitter(options: Omit<ParticleEmitterOptions, "simulation">): {
  emitter: ParticleEmitter;
  driver: FakeGpuSimulation;
} {
  const emitter = new ParticleEmitter({ ...options, simulation: "gpu" });
  const driver = new FakeGpuSimulation(emitter.pool.capacity);
  emitter.bindGpuSimulation(driver);
  return { emitter, driver };
}

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

const DT = 1 / 60;

describe("ParticleEmitter simulation option (§36)", () => {
  it('defaults to "cpu" with no driver slot in play', () => {
    const emitter = new ParticleEmitter({ maxParticles: 4 });
    expect(emitter.simulationMode).toBe("cpu");
    expect(emitter.gpuSimulation).toBeNull();
  });

  it('accepts "gpu" and reports it', () => {
    const emitter = new ParticleEmitter({
      maxParticles: 4,
      simulation: "gpu",
    });
    expect(emitter.simulationMode).toBe("gpu");
    expect(emitter.gpuSimulation).toBeNull();
  });

  it("rejects an unknown simulation value loudly", () => {
    expect(
      () =>
        new ParticleEmitter({
          maxParticles: 4,
          simulation: "quantum" as ParticleSimulationMode,
        }),
    ).toThrowError(/simulation must be "cpu" or "gpu"/);
  });

  it("refuses non-radial fields in GPU mode — constant gravity + optional radial", () => {
    const field = {
      sample: (_p: Vector3, _v: Vector3, _t: number, out?: Vector3): Vector3 =>
        (out ?? new Vector3()).set(0, 0, 0),
    };
    expect(
      () =>
        new ParticleEmitter({
          maxParticles: 4,
          simulation: "gpu",
          fields: [field],
        }),
    ).toThrowError(/hand-written or nested-volume field/);
    // An empty array names no field and is not refused.
    expect(
      () =>
        new ParticleEmitter({
          maxParticles: 4,
          simulation: "gpu",
          fields: [],
        }),
    ).not.toThrow();
  });

  it("refuses bounce-only collisionPlaneY in GPU mode", () => {
    expect(
      () =>
        new ParticleEmitter({
          maxParticles: 4,
          simulation: "gpu",
          collisionPlaneY: 0,
        }),
    ).toThrowError(/does not accept `collisionPlaneY`/);
  });

  it("refuses a zero-capacity GPU emitter", () => {
    expect(
      () => new ParticleEmitter({ maxParticles: 0, simulation: "gpu" }),
    ).toThrowError(/requires maxParticles > 0/);
  });
});

describe("ParticleEmitter.bindGpuSimulation", () => {
  it("refuses on a CPU-mode emitter", () => {
    const emitter = new ParticleEmitter({ maxParticles: 4 });
    const error = thrown(() => {
      emitter.bindGpuSimulation(new FakeGpuSimulation(4));
    });
    expect(error.code).toBe("INVALID_APPLICATION_STATE");
    expect(emitter.gpuSimulation).toBeNull();
  });

  it("refuses a second bind — binding is once", () => {
    const { emitter } = gpuEmitter({ maxParticles: 4 });
    const error = thrown(() => {
      emitter.bindGpuSimulation(new FakeGpuSimulation(4));
    });
    expect(error.code).toBe("INVALID_APPLICATION_STATE");
    expect(error.message).toMatch(/already has a GPU simulation bound/);
  });

  it("refuses a capacity mismatch, naming both sizes", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 8,
      simulation: "gpu",
    });
    const error = thrown(() => {
      emitter.bindGpuSimulation(new FakeGpuSimulation(4));
    });
    expect(error.code).toBe("INVALID_APPLICATION_STATE");
    expect(error.context).toEqual({ driverCapacity: 4, poolCapacity: 8 });
  });

  it("binds and reports the driver", () => {
    const { emitter, driver } = gpuEmitter({ maxParticles: 4 });
    expect(emitter.gpuSimulation).toBe(driver);
  });
});

describe("unbound GPU emitters refuse rather than pretend (§85, WP-9.1)", () => {
  it("step() throws INVALID_APPLICATION_STATE and simulates nothing", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 4,
      simulation: "gpu",
      bursts: [{ time: 0, count: 2 }],
    });
    const error = thrown(() => {
      emitter.step(DT, 0);
    });
    expect(error.code).toBe("INVALID_APPLICATION_STATE");
    expect(error.message).toMatch(/no GPU simulation bound/);
    expect(emitter.particleCount).toBe(0);
    expect(emitter.elapsedTime).toBe(0);
  });

  it("emit() throws likewise and spawns nothing", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 4,
      simulation: "gpu",
    });
    const error = thrown(() => {
      emitter.emit(2);
    });
    expect(error.code).toBe("INVALID_APPLICATION_STATE");
    expect(emitter.particleCount).toBe(0);
  });
});

describe("the per-step driver call sequence (types.ts contract)", () => {
  it("spawns call writeSpawn with the pool's own float32 state", () => {
    const { emitter, driver } = gpuEmitter({
      maxParticles: 8,
      seed: 7,
      bursts: [{ time: 0, count: 3 }],
      position: new Vector3(1, 2, 3),
      initialSpeed: { min: 2, max: 5 },
      spreadAngle: 0.5,
      lifetime: { min: 10, max: 10 },
    });
    emitter.step(DT, 0);

    // First step: nothing was alive before the spawn phase, so no
    // integrate; three spawns, slots 0..2, in order.
    expect(driver.of("integrate")).toHaveLength(0);
    const spawns = driver.of("writeSpawn");
    expect(spawns).toHaveLength(3);
    const positions = emitter.pool.positions;
    const velocities = emitter.pool.velocities;
    for (let i = 0; i < 3; i += 1) {
      const base = i * 3;
      expect(spawns[i]?.args).toEqual([
        i,
        positions[base],
        positions[base + 1],
        positions[base + 2],
        velocities[base],
        velocities[base + 1],
        velocities[base + 2],
      ]);
    }
  });

  it("passes radial extras on integrate when a gpu radial is configured", () => {
    const { emitter, driver } = gpuEmitter({
      maxParticles: 4,
      bursts: [{ time: 0, count: 1 }],
      lifetime: { min: 10, max: 10 },
      gravity: new Vector3(0, -1, 0),
      fields: [radialField(new Vector3(0, 1, 0), -2, { minDistance: 0.25 })],
    });
    emitter.step(DT, 0);
    driver.calls.length = 0;
    emitter.step(DT, DT);
    expect(driver.of("integrate")[0]?.args[5]).toEqual({
      radial: {
        kind: "radial",
        originX: 0,
        originY: 1,
        originZ: 0,
        strength: -2,
        minDistance: 0.25,
      },
    });
  });

  it("integrates the pre-spawn live count with the constructed gravity", () => {
    const { emitter, driver } = gpuEmitter({
      maxParticles: 8,
      bursts: [{ time: 0, count: 3 }],
      lifetime: { min: 10, max: 10 },
      gravity: new Vector3(0, -9.81, 0),
    });
    emitter.step(DT, 0);
    driver.calls.length = 0;

    emitter.step(DT, DT);
    expect(driver.calls[0]).toEqual({
      kind: "integrate",
      args: [3, DT, 0, -9.81, 0],
    });
    expect(driver.of("integrate")).toHaveLength(1);
  });

  it("skips integrate for an empty pool and for a zero delta", () => {
    const { emitter, driver } = gpuEmitter({
      maxParticles: 4,
      bursts: [{ time: 0, count: 2 }],
      lifetime: { min: 10, max: 10 },
    });
    emitter.step(DT, 0); // spawn only — pool was empty
    emitter.step(0, DT); // zero delta — an identity step
    expect(driver.of("integrate")).toHaveLength(0);
  });

  it("mirrors swap-remove compaction, never with from === to", () => {
    // Three particles spawned together, all expiring on the same step:
    // the scan kills slot 0 three times over, moving 2→0 then 1→0, and the
    // final kill is the last slot — no move at all.
    const { emitter, driver } = gpuEmitter({
      maxParticles: 8,
      bursts: [{ time: 0, count: 3 }],
      lifetime: { min: 0.02, max: 0.02 },
    });
    emitter.step(DT, 0);
    emitter.step(DT, DT); // ages ≈ 0.0167, all survive
    driver.calls.length = 0;

    emitter.step(DT, 2 * DT); // ages ≈ 0.0333 ≥ 0.02, all expire
    expect(emitter.particleCount).toBe(0);
    expect(driver.of("moveSlot").map((call) => call.args)).toEqual([
      [2, 0],
      [1, 0],
    ]);
    for (const call of driver.of("moveSlot")) {
      expect(call.args[0]).not.toBe(call.args[1]);
    }
  });

  it("keeps CPU channels and device slots in step through a partial death", () => {
    // Distinct lifetimes: the first burst's particles die while the second
    // burst's survive, so the survivor visibly moves down — and the driver
    // is told the identical move.
    const { emitter, driver } = gpuEmitter({
      maxParticles: 8,
      bursts: [{ time: 0, count: 2 }], // slots 0, 1 — lifetime 0.02
      lifetime: { min: 0.02, max: 0.02 },
    });
    emitter.step(DT, 0); // slots 0, 1 spawn
    // Hand-author a long-lived survivor in slot 2 — emit() draws the same
    // 0.02 lifetime, so write over it via the pool for a deterministic mix.
    emitter.emit(1);
    emitter.pool.setLifetime(2, 10);
    driver.calls.length = 0;

    emitter.step(DT, DT); // slots 0..2 age; nothing dies yet
    expect(driver.of("moveSlot")).toHaveLength(0);

    emitter.step(DT, 2 * DT); // slots 0 and 1 expire; slot 2 survives
    // Scan: kill 0 (move 2→0), re-process slot 0 (the survivor — lives),
    // then kill slot 1 (last — no move).
    expect(driver.of("moveSlot").map((call) => call.args)).toEqual([[2, 0]]);
    expect(emitter.particleCount).toBe(1);
    // The survivor's CPU channels took the same move the device was told.
    expect(emitter.pool.lifetimes[0]).toBe(10);
  });
});

describe("CPU spawn + GPU integrate — the §33 division of labour", () => {
  const shared: Omit<ParticleEmitterOptions, "simulation"> = {
    maxParticles: 32,
    seed: 1337,
    emissionRate: 120,
    bursts: [{ time: 0, count: 4 }],
    lifetime: { min: 0.5, max: 2 },
    initialSpeed: { min: 1, max: 3 },
    direction: new Vector3(0, 1, 0),
    spreadAngle: 0.7,
    size: { start: 1, end: 0 },
    color: {
      start: { r: 1, g: 1, b: 1, a: 1 },
      end: { r: 1, g: 0, b: 0, a: 0 },
    },
    gravity: new Vector3(0, -9.81, 0),
  };

  it("keeps the spawn stream bit-identical to a CPU emitter's", () => {
    const cpu = new ParticleEmitter({ ...shared });
    const { emitter: gpu } = gpuEmitter(shared);
    for (let stepIndex = 0; stepIndex < 30; stepIndex += 1) {
      cpu.step(DT, stepIndex * DT);
      gpu.step(DT, stepIndex * DT);
    }

    // Every §33-bearing CPU channel matches to the bit: same RNG stream,
    // same spawn order, same ages, same ramp endpoints, same accounting.
    expect(gpu.particleCount).toBe(cpu.particleCount);
    expect(gpu.emittedCount).toBe(cpu.emittedCount);
    expect(gpu.droppedCount).toBe(cpu.droppedCount);
    expect(gpu.emissionAccumulator).toBe(cpu.emissionAccumulator);
    const live = cpu.particleCount;
    expect(Array.from(gpu.pool.ages.slice(0, live))).toEqual(
      Array.from(cpu.pool.ages.slice(0, live)),
    );
    expect(Array.from(gpu.pool.lifetimes.slice(0, live))).toEqual(
      Array.from(cpu.pool.lifetimes.slice(0, live)),
    );
    expect(Array.from(gpu.pool.sizes.slice(0, live * 2))).toEqual(
      Array.from(cpu.pool.sizes.slice(0, live * 2)),
    );
    expect(Array.from(gpu.pool.colors.slice(0, live * 8))).toEqual(
      Array.from(cpu.pool.colors.slice(0, live * 8)),
    );

    // And the honest divergence, stated: the CPU emitter integrated its
    // position lanes; the GPU emitter's hold spawn-time values (the live
    // state is device-resident).
    expect(Array.from(gpu.pool.positions.slice(0, live * 3))).not.toEqual(
      Array.from(cpu.pool.positions.slice(0, live * 3)),
    );
  });

  it("emit() spawns through the driver when bound", () => {
    const { emitter, driver } = gpuEmitter({ maxParticles: 4 });
    expect(emitter.emit(2)).toBe(2);
    expect(driver.of("writeSpawn")).toHaveLength(2);
    expect(emitter.particleCount).toBe(2);
  });

  it("reset() rewinds without touching the driver", () => {
    const { emitter, driver } = gpuEmitter({
      maxParticles: 4,
      bursts: [{ time: 0, count: 2 }],
      lifetime: { min: 10, max: 10 },
    });
    emitter.step(DT, 0);
    driver.calls.length = 0;

    emitter.reset();
    expect(driver.calls).toHaveLength(0);
    expect(emitter.particleCount).toBe(0);
    expect(emitter.gpuSimulation).toBe(driver);

    // A reset emitter re-runs its history through the same driver.
    emitter.step(DT, 0);
    expect(driver.of("writeSpawn")).toHaveLength(2);
  });
});

describe("ParticleRenderable in GPU mode", () => {
  it("reports no bounds — the state is device-resident", () => {
    const { emitter } = gpuEmitter({
      maxParticles: 4,
      bursts: [{ time: 0, count: 2 }],
      lifetime: { min: 10, max: 10 },
    });
    const renderable = new ParticleRenderable(emitter);
    emitter.step(DT, 0);
    const min = new Vector3(9, 9, 9);
    const max = new Vector3(-9, -9, -9);
    expect(renderable.computeBounds(min, max)).toBe(false);
    // Untouched, exactly as the empty-pool contract leaves them.
    expect([min.x, min.y, min.z]).toEqual([9, 9, 9]);
  });

  it("still repacks the CPU-truth ramp lanes", () => {
    const { emitter } = gpuEmitter({
      maxParticles: 4,
      bursts: [{ time: 0, count: 1 }],
      lifetime: { min: 1, max: 1 },
      size: { start: 2, end: 0 },
      position: new Vector3(5, 6, 7),
    });
    const renderable = new ParticleRenderable(emitter);
    emitter.step(DT, 0);
    renderable.updateParticleInstances();
    expect(renderable.particleCount).toBe(1);
    const instances = renderable.particleInstances;
    // Position lanes carry the spawn value (documented: stale in GPU mode;
    // the backend reads positions from the simulation's buffer instead).
    expect([instances[0], instances[1], instances[2]]).toEqual([5, 6, 7]);
    // Size lane is the live ramp value — age 0 ⇒ start size.
    expect(instances[3]).toBe(2);
  });
});
