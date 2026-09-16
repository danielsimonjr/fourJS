import { Vector3 } from "@fourjs/math";
import { describe, expect, it } from "vitest";

import { ParticleEmitter } from "../src/emitter.js";
import {
  PARTICLE_TRAIL_VERTEX_FLOATS,
  ParticleRenderable,
} from "../src/particle-renderable.js";
import {
  DEFAULT_TRAIL_LENGTH,
  DEFAULT_TRAIL_MIN_DISTANCE,
  DEFAULT_TRAIL_TAIL_WIDTH_FACTOR,
  DEFAULT_TRAIL_WIDTH,
  ParticleTrailStore,
  TRAIL_VERTEX_FLOATS,
  buildTrailRibbonMesh,
  resolveTrailOptions,
} from "../src/trail.js";
import {
  evaluateLifetimeRampColor,
  evaluateLifetimeRampNumber,
} from "../src/types.js";

describe("evaluateLifetimeRampNumber — multi-stop ramps", () => {
  it("matches two-stop linear when no interior stops are given", () => {
    const ramp = { start: 0, end: 10 };
    expect(evaluateLifetimeRampNumber(ramp, 0)).toBe(0);
    expect(evaluateLifetimeRampNumber(ramp, 0.5)).toBe(5);
    expect(evaluateLifetimeRampNumber(ramp, 1)).toBe(10);
  });

  it("interpolates through interior stops", () => {
    const ramp = {
      start: 0,
      end: 1,
      stops: [
        { t: 0.25, value: 0.5 },
        { t: 0.75, value: 0.5 },
      ],
    };
    expect(evaluateLifetimeRampNumber(ramp, 0)).toBe(0);
    expect(evaluateLifetimeRampNumber(ramp, 0.125)).toBeCloseTo(0.25);
    expect(evaluateLifetimeRampNumber(ramp, 0.5)).toBeCloseTo(0.5);
    expect(evaluateLifetimeRampNumber(ramp, 0.875)).toBeCloseTo(0.75);
    expect(evaluateLifetimeRampNumber(ramp, 1)).toBe(1);
  });
});

describe("evaluateLifetimeRampColor — multi-stop ramps", () => {
  it("lerps RGBA component-wise through stops", () => {
    const ramp = {
      start: { r: 1, g: 0, b: 0, a: 1 },
      end: { r: 0, g: 0, b: 1, a: 0 },
      stops: [{ t: 0.5, value: { r: 0, g: 1, b: 0, a: 0.5 } }],
    };
    const mid = evaluateLifetimeRampColor(ramp, 0.5);
    expect(mid).toEqual({ r: 0, g: 1, b: 0, a: 0.5 });
    const quarter = evaluateLifetimeRampColor(ramp, 0.25);
    expect(quarter.r).toBeCloseTo(0.5);
    expect(quarter.g).toBeCloseTo(0.5);
  });

  it("clamps normalized age below zero and above one", () => {
    expect(evaluateLifetimeRampNumber({ start: 0, end: 10 }, -1)).toBe(0);
    expect(evaluateLifetimeRampNumber({ start: 0, end: 10 }, 2)).toBe(10);
    expect(
      evaluateLifetimeRampColor(
        {
          start: { r: 0, g: 0, b: 0, a: 0 },
          end: { r: 1, g: 1, b: 1, a: 1 },
        },
        -1,
      ),
    ).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(
      evaluateLifetimeRampColor(
        {
          start: { r: 0, g: 0, b: 0, a: 0 },
          end: { r: 1, g: 1, b: 1, a: 1 },
        },
        2,
      ),
    ).toEqual({ r: 1, g: 1, b: 1, a: 1 });
  });

  it("returns a t=0 interior stop verbatim at age zero", () => {
    expect(
      evaluateLifetimeRampNumber(
        { start: 0, end: 1, stops: [{ t: 0, value: 0.25 }] },
        0,
      ),
    ).toBe(0.25);
    expect(
      evaluateLifetimeRampColor(
        {
          start: { r: 0, g: 0, b: 0, a: 1 },
          end: { r: 1, g: 1, b: 1, a: 1 },
          stops: [{ t: 0, value: { r: 1, g: 0, b: 0, a: 0.5 } }],
        },
        0,
      ),
    ).toEqual({ r: 1, g: 0, b: 0, a: 0.5 });
  });

  it("interpolates through interior stops for scalar ramps", () => {
    expect(
      evaluateLifetimeRampNumber(
        { start: 0, end: 1, stops: [{ t: 0.25, value: 0.75 }] },
        0.125,
      ),
    ).toBeCloseTo(0.375);
  });

  it("handles duplicate stop times and the tail segment after the last stop", () => {
    const duplicate = {
      start: 0,
      end: 1,
      stops: [
        { t: 0.5, value: 0.5 },
        { t: 0.5, value: 0.75 },
      ],
    };
    expect(evaluateLifetimeRampNumber(duplicate, 0.5)).toBe(0.5);

    const tail = {
      start: 0,
      end: 1,
      stops: [{ t: 0.5, value: 0.25 }],
    };
    expect(evaluateLifetimeRampNumber(tail, 0.75)).toBeCloseTo(0.625);
  });

  it("treats an empty stops array as a two-endpoint lerp", () => {
    expect(
      evaluateLifetimeRampNumber({ start: 0, end: 10, stops: [] }, 0.5),
    ).toBe(5);
    expect(
      evaluateLifetimeRampColor(
        {
          start: { r: 0, g: 0, b: 0, a: 1 },
          end: { r: 2, g: 0, b: 0, a: 0 },
          stops: [],
        },
        0.5,
      ),
    ).toEqual({ r: 1, g: 0, b: 0, a: 0.5 });
  });

  it("returns the end value when a NaN age walks past a stop at t >= 1", () => {
    // Clamping maps every finite age into [0, 1], so the after-last-stop
    // `span <= 0` guard is only reachable when t is NaN (every `<=` comparison
    // fails) and the last stop already sits at or past 1.
    expect(
      evaluateLifetimeRampNumber(
        { start: 0, end: 7, stops: [{ t: 1, value: 3 }] },
        Number.NaN,
      ),
    ).toBe(7);
    expect(
      evaluateLifetimeRampColor(
        {
          start: { r: 0, g: 0, b: 0, a: 1 },
          end: { r: 0, g: 0, b: 1, a: 0 },
          stops: [{ t: 1, value: { r: 1, g: 0, b: 0, a: 1 } }],
        },
        Number.NaN,
      ),
    ).toEqual({ r: 0, g: 0, b: 1, a: 0 });
  });

  it("handles duplicate color stops and the tail segment", () => {
    const duplicate = {
      start: { r: 0, g: 0, b: 0, a: 1 },
      end: { r: 1, g: 1, b: 1, a: 1 },
      stops: [
        { t: 0.5, value: { r: 1, g: 0, b: 0, a: 1 } },
        { t: 0.5, value: { r: 0, g: 1, b: 0, a: 1 } },
      ],
    };
    expect(evaluateLifetimeRampColor(duplicate, 0.5)).toEqual({
      r: 1,
      g: 0,
      b: 0,
      a: 1,
    });

    const tail = {
      start: { r: 0, g: 0, b: 0, a: 1 },
      end: { r: 1, g: 1, b: 1, a: 0 },
      stops: [{ t: 0.5, value: { r: 0.5, g: 0.5, b: 0.5, a: 0.5 } }],
    };
    const late = evaluateLifetimeRampColor(tail, 0.75);
    expect(late.r).toBeCloseTo(0.75);
    expect(late.a).toBeCloseTo(0.25);
  });
});

describe("ParticleTrailStore — ring buffer", () => {
  it("rejects a non-integer capacity or a length below two", () => {
    expect(() => new ParticleTrailStore(-1, 4)).toThrow(
      /capacity must be a non-negative safe integer/,
    );
    expect(() => new ParticleTrailStore(1, 1)).toThrow(
      /length must be an integer >= 2/,
    );
  });

  it("clears every slot and treats a same-slot copy as a no-op", () => {
    const store = new ParticleTrailStore(2, 4);
    store.resetSlot(0);
    store.pushSample(0, 1, 2, 3, 0);
    store.pushSample(0, 4, 5, 6, 0);
    store.copySlot(0, 0);
    expect(store.getSampleCount(0)).toBe(2);
    store.clear();
    expect(store.getSampleCount(0)).toBe(0);
    expect(store.getSampleCount(1)).toBe(0);
  });

  it("records samples in chronological order", () => {
    const store = new ParticleTrailStore(2, 4);
    store.resetSlot(0);
    store.pushSample(0, 0, 0, 0, 0);
    store.pushSample(0, 1, 0, 0, 0);
    store.pushSample(0, 2, 0, 0, 0);
    expect(store.getSampleCount(0)).toBe(3);
    const out = { x: 0, y: 0, z: 0 };
    store.readSample(0, 0, out);
    expect([out.x, out.y, out.z]).toEqual([0, 0, 0]);
    store.readSample(0, 2, out);
    expect([out.x, out.y, out.z]).toEqual([2, 0, 0]);
  });

  it("respects minDistance between samples", () => {
    const store = new ParticleTrailStore(1, 8);
    store.resetSlot(0);
    store.pushSample(0, 0, 0, 0, 0);
    store.pushSample(0, 0.1, 0, 0, 0.5);
    store.pushSample(0, 0.2, 0, 0, 0.5);
    expect(store.getSampleCount(0)).toBe(1);
    store.pushSample(0, 1, 0, 0, 0.5);
    expect(store.getSampleCount(0)).toBe(2);
  });

  it("rejects an out-of-range sampleIndex and a slot that is not in the store", () => {
    const store = new ParticleTrailStore(2, 4);
    store.resetSlot(0);
    store.pushSample(0, 1, 0, 0, 0);
    const out = { x: 0, y: 0, z: 0 };
    expect(() => store.readSample(0, -1, out)).toThrow(
      /sampleIndex -1 out of range \(count 1\)/,
    );
    expect(() => store.readSample(0, 1, out)).toThrow(
      /sampleIndex 1 out of range \(count 1\)/,
    );
    expect(() => store.resetSlot(-1)).toThrow(
      /resetSlot: index -1 out of range \(capacity 2\)/,
    );
    expect(() => store.getSampleCount(2)).toThrow(
      /getSampleCount: index 2 out of range \(capacity 2\)/,
    );
    expect(() => store.pushSample(1.5, 0, 0, 0, 0)).toThrow(
      /pushSample: index 1.5 out of range \(capacity 2\)/,
    );
  });

  it("copies history on swap-remove", () => {
    const store = new ParticleTrailStore(4, 4);
    store.resetSlot(0);
    store.resetSlot(1);
    store.pushSample(0, 1, 2, 3, 0);
    store.pushSample(0, 4, 5, 6, 0);
    store.pushSample(1, 9, 9, 9, 0);
    store.copySlot(0, 1);
    expect(store.getSampleCount(1)).toBe(2);
    const out = { x: 0, y: 0, z: 0 };
    store.readSample(1, 1, out);
    expect([out.x, out.y, out.z]).toEqual([4, 5, 6]);
  });
});

describe("buildTrailRibbonMesh", () => {
  it("skips a live slot that still has fewer than two samples", () => {
    const store = new ParticleTrailStore(2, 4);
    store.resetSlot(0);
    store.pushSample(0, 0, 0, 0, 0);
    store.resetSlot(1);
    store.pushSample(1, 0, 0, 0, 0);
    store.pushSample(1, 1, 0, 0, 0);

    const ages = new Float32Array([0.5, 0.5]);
    const lifetimes = new Float32Array([1, 1]);
    const sizes = new Float32Array([1, 0, 1, 0]);
    const colors = new Float32Array([
      1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    ]);
    const out = new Float32Array(6 * TRAIL_VERTEX_FLOATS);
    expect(
      buildTrailRibbonMesh(
        store,
        2,
        ages,
        lifetimes,
        sizes,
        colors,
        out,
        0.2,
        0,
      ),
    ).toBe(6);
  });

  it("emits six vertices per segment", () => {
    const store = new ParticleTrailStore(1, 4);
    store.resetSlot(0);
    store.pushSample(0, 0, 0, 0, 0);
    store.pushSample(0, 1, 0, 0, 0);
    store.pushSample(0, 2, 0, 0, 0);

    const ages = new Float32Array([0.5]);
    const lifetimes = new Float32Array([1]);
    const sizes = new Float32Array([1, 0]);
    const colors = new Float32Array([1, 0, 0, 1, 0, 0, 1, 0]);
    const out = new Float32Array(6 * 2 * TRAIL_VERTEX_FLOATS);
    const count = buildTrailRibbonMesh(
      store,
      1,
      ages,
      lifetimes,
      sizes,
      colors,
      out,
      0.2,
      0,
    );
    expect(count).toBe(12);
    expect(out[0]).toBeDefined();
    expect(out.length).toBeGreaterThanOrEqual(count * TRAIL_VERTEX_FLOATS);
  });

  it("handles coincident samples and vertical-only motion", () => {
    const store = new ParticleTrailStore(1, 6);
    store.resetSlot(0);
    store.pushSample(0, 0, 0, 0, 0);
    store.pushSample(0, 0, 0, 0, 0);
    store.pushSample(0, 0, 1, 0, 0);
    store.pushSample(0, 0, 2, 0, 0);

    const ages = new Float32Array([0.5]);
    const lifetimes = new Float32Array([1]);
    const sizes = new Float32Array([1, 0]);
    const colors = new Float32Array([1, 0, 0, 1, 0, 0, 1, 0]);
    const out = new Float32Array(6 * 4 * TRAIL_VERTEX_FLOATS);
    const count = buildTrailRibbonMesh(
      store,
      1,
      ages,
      lifetimes,
      sizes,
      colors,
      out,
      0.2,
      0,
    );
    expect(count).toBeGreaterThan(0);
  });

  it("clamps normalized age for non-positive lifetimes and out-of-range ages", () => {
    const store = new ParticleTrailStore(1, 4);
    store.resetSlot(0);
    store.pushSample(0, 0, 0, 0, 0);
    store.pushSample(0, 1, 0, 0, 0);

    const ages = new Float32Array([-1]);
    const lifetimes = new Float32Array([0]);
    const sizes = new Float32Array([1, 2]);
    const colors = new Float32Array([1, 0, 0, 1, 0, 1, 0, 1]);
    const out = new Float32Array(6 * TRAIL_VERTEX_FLOATS);
    expect(
      buildTrailRibbonMesh(
        store,
        1,
        ages,
        lifetimes,
        sizes,
        colors,
        out,
        0.2,
        0,
      ),
    ).toBeGreaterThan(0);

    ages[0] = 2;
    lifetimes[0] = 1;
    expect(
      buildTrailRibbonMesh(
        store,
        1,
        ages,
        lifetimes,
        sizes,
        colors,
        out,
        -1,
        0.5,
      ),
    ).toBeGreaterThan(0);
  });
});

describe("resolveTrailOptions", () => {
  it("returns undefined when trails are disabled or omitted", () => {
    expect(resolveTrailOptions(undefined)).toBeUndefined();
    expect(resolveTrailOptions({ enabled: false, length: 4 })).toBeUndefined();
  });

  it("normalizes defaults for enabled trails", () => {
    const resolved = resolveTrailOptions({});
    expect(resolved).toBeDefined();
    expect(resolved?.enabled).toBe(true);
    expect(resolved?.length).toBe(DEFAULT_TRAIL_LENGTH);
    expect(resolved?.width).toBe(DEFAULT_TRAIL_WIDTH);
    expect(resolved?.minDistance).toBe(DEFAULT_TRAIL_MIN_DISTANCE);
    expect(resolved?.tailWidthFactor).toBe(DEFAULT_TRAIL_TAIL_WIDTH_FACTOR);
  });

  it("rejects invalid trail configuration", () => {
    expect(() => resolveTrailOptions({ length: 1 })).toThrow(/length/);
    expect(() => resolveTrailOptions({ length: 4, width: -1 })).toThrow(
      /width/,
    );
    expect(() =>
      resolveTrailOptions({ length: 4, minDistance: Number.NaN }),
    ).toThrow(/minDistance/);
    expect(() =>
      resolveTrailOptions({ length: 4, tailWidthFactor: 1.5 }),
    ).toThrow(/tailWidthFactor/);
  });
});

describe("ParticleEmitter — trails", () => {
  it("records position history on CPU steps", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 4,
      seed: 42,
      emissionRate: 0,
      lifetime: { min: 10, max: 10 },
      initialSpeed: { min: 0, max: 0 },
      gravity: new Vector3(0, -1, 0),
      trail: { length: 6, minDistance: 0 },
    });
    expect(emitter.hasTrail).toBe(true);
    emitter.emit(1);
    emitter.step(1, 0);
    emitter.step(1, 1);
    const store = emitter.trailStore!;
    expect(store.getSampleCount(0)).toBeGreaterThanOrEqual(2);
  });

  it("refuses trails in GPU mode", () => {
    expect(
      () =>
        new ParticleEmitter({
          maxParticles: 4,
          simulation: "gpu",
          trail: { length: 4 },
        }),
    ).toThrow(/trail/);
  });

  it("evaluates multi-stop size ramps", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 2,
      seed: 1,
      emissionRate: 0,
      lifetime: { min: 2, max: 2 },
      size: {
        start: 0,
        end: 4,
        stops: [{ t: 0.5, value: 1 }],
      },
    });
    emitter.emit(1);
    expect(emitter.evaluateSize(0)).toBe(0);
    emitter.pool.setAge(0, 1);
    expect(emitter.evaluateSize(0)).toBeCloseTo(1);
    emitter.pool.setAge(0, 2);
    expect(emitter.evaluateSize(0)).toBe(4);
  });
});

describe("ParticleRenderable — trails", () => {
  it("builds trail vertices when the emitter has trails enabled", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 8,
      seed: 99,
      emissionRate: 0,
      lifetime: { min: 5, max: 5 },
      initialSpeed: { min: 2, max: 2 },
      direction: new Vector3(1, 0, 0),
      trail: { length: 5, width: 0.1, minDistance: 0 },
    });
    const renderable = new ParticleRenderable(emitter);
    expect(renderable.hasTrail).toBe(true);
    emitter.emit(1);
    for (let i = 0; i < 4; i += 1) {
      emitter.step(0.1, i * 0.1);
    }
    renderable.updateParticleInstances();
    expect(renderable.trailVertexCount).toBeGreaterThan(0);
    expect(renderable.trailVertices?.length).toBeGreaterThanOrEqual(
      renderable.trailVertexCount * PARTICLE_TRAIL_VERTEX_FLOATS,
    );
  });
});
