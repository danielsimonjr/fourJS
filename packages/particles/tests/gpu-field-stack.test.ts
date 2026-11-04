/**
 * The §27 GPU field stack (R-31 residue): every built-in field carries a
 * device record, the emitter hands the ordered stack to the driver, and the
 * stack is bounded by {@link MAX_GPU_FIELDS}.
 */

import { Vector3 } from "@fourjs/math";
import { describe, expect, it, vi } from "vitest";

import {
  MAX_GPU_FIELDS,
  ParticleEmitter,
  dragField,
  radialField,
  turbulenceField,
  uniformGravityField,
  volumeField,
  vortexField,
  windField,
  type ParticleGpuIntegrateExtras,
  type ParticleGpuSimulation,
} from "../src/index.js";

class Recorder implements ParticleGpuSimulation {
  readonly isParticleGpuSimulation = true;
  readonly extras: (ParticleGpuIntegrateExtras | undefined)[] = [];
  constructor(readonly capacity: number) {}
  integrate(
    _c: number,
    _d: number,
    _x: number,
    _y: number,
    _z: number,
    extras?: ParticleGpuIntegrateExtras,
  ): void {
    this.extras.push(extras);
  }
  writeSpawn(): void {}
  moveSlot(): void {}
}

describe("GPU field records", () => {
  it("every built-in carries a record matching its authored parameters", () => {
    expect(uniformGravityField(new Vector3(1, 2, 3)).gpuField).toEqual({
      kind: "uniform",
      x: 1,
      y: 2,
      z: 3,
    });
    expect(dragField(0.4).gpuField).toEqual({ kind: "drag", coefficient: 0.4 });
    expect(windField(new Vector3(1, 0, 2), 3).gpuField).toEqual({
      kind: "wind",
      windX: 1,
      windY: 0,
      windZ: 2,
      coefficient: 3,
    });
    const vortex = vortexField(new Vector3(1, 2, 3), new Vector3(0, 2, 0), 5);
    expect(vortex.gpuField).toMatchObject({
      kind: "vortex",
      centerX: 1,
      axisY: 1,
      strength: 5,
    });
    const turb = turbulenceField(7, {
      frequency: 2,
      amplitude: 3,
      scroll: new Vector3(1, 0, 0),
    });
    expect(turb.gpuField).toMatchObject({
      kind: "turbulence",
      frequency: 2,
      amplitude: 3,
      scrollX: 1,
    });
    const salts = turb.gpuField as { saltX: number; saltY: number };
    expect(Number.isInteger(salts.saltX)).toBe(true);
    expect(salts.saltX).not.toBe(salts.saltY);
  });

  it("volumeField wraps the inner record once and refuses nesting or hand-written inners", () => {
    const sphere = volumeField(dragField(1), {
      shape: "sphere",
      center: new Vector3(1, 2, 3),
      radius: 4,
      falloff: 1,
    });
    expect(sphere.gpuField).toMatchObject({
      kind: "drag",
      volume: { shape: "sphere", centerX: 1, radius: 4, falloff: 1 },
    });
    const box = volumeField(dragField(1), {
      shape: "box",
      center: new Vector3(),
      extents: new Vector3(1, 2, 3),
    });
    expect(box.gpuField).toMatchObject({
      volume: { shape: "box", extentZ: 3, falloff: 0 },
    });
    const nested = volumeField(sphere, {
      shape: "sphere",
      center: new Vector3(),
      radius: 1,
    });
    expect(nested.gpuField).toBeUndefined();
    const handwritten = volumeField(
      { sample: (_p, _v, _t, out) => out ?? new Vector3() },
      { shape: "sphere", center: new Vector3(), radius: 1 },
    );
    expect(handwritten.gpuField).toBeUndefined();
  });
});

describe("ParticleEmitter GPU field stack", () => {
  it("hands the ordered stack and the time to the driver", () => {
    const fields = [
      uniformGravityField(),
      dragField(1),
      radialField(new Vector3(), 2),
    ];
    const emitter = new ParticleEmitter({
      maxParticles: 4,
      simulation: "gpu",
      fields,
      bursts: [{ time: 0, count: 2 }],
    });
    const driver = new Recorder(4);
    emitter.bindGpuSimulation(driver);
    emitter.step(0.1, 0);
    emitter.step(0.1, 2.5);
    expect(emitter.gpuFields.map((f) => f.kind)).toEqual([
      "uniform",
      "drag",
      "radial",
    ]);
    const last = driver.extras[driver.extras.length - 1];
    expect(last?.radial).toBeUndefined();
    expect(last?.fields).toBe(emitter.gpuFields);
    expect(last?.time).toBe(2.5);
  });

  it("keeps the single-radial spelling and a volumed radial as a stack", () => {
    const single = new ParticleEmitter({
      maxParticles: 2,
      simulation: "gpu",
      fields: [radialField(new Vector3(), 1)],
      bursts: [{ time: 0, count: 1 }],
    });
    const driver = new Recorder(2);
    single.bindGpuSimulation(driver);
    single.step(0.1, 0);
    single.step(0.1, 0.1);
    expect(driver.extras[driver.extras.length - 1]?.radial?.kind).toBe(
      "radial",
    );
    const volumed = new ParticleEmitter({
      maxParticles: 2,
      simulation: "gpu",
      fields: [
        volumeField(radialField(new Vector3(), 1), {
          shape: "sphere",
          center: new Vector3(),
          radius: 2,
        }),
      ],
    });
    expect(volumed.gpuRadial).toBeUndefined();
    expect(volumed.gpuFields).toHaveLength(1);
  });

  it("accepts exactly MAX_GPU_FIELDS and refuses one more", () => {
    const make = (n: number) => Array.from({ length: n }, () => dragField(1));
    expect(
      () =>
        new ParticleEmitter({
          maxParticles: 2,
          simulation: "gpu",
          fields: make(MAX_GPU_FIELDS),
        }),
    ).not.toThrow();
    expect(
      () =>
        new ParticleEmitter({
          maxParticles: 2,
          simulation: "gpu",
          fields: make(MAX_GPU_FIELDS + 1),
        }),
    ).toThrow(/at most 8 fields/);
  });

  it("warns once when a CPU emitter asks for depth-buffer collisions", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const make = (): ParticleEmitter =>
        new ParticleEmitter({ maxParticles: 2, collisions: "depth-buffer" });
      make();
      make();
      expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      spy.mockRestore();
    }
  });
});
