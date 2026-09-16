import {
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@fourjs/math";
import { describe, expect, it } from "vitest";

import { ParticleEmitter } from "../src/emitter.js";
import {
  DEFAULT_GRAVITY_Y,
  DEFAULT_RADIAL_MIN_DISTANCE,
  DEFAULT_TURBULENCE_AMPLITUDE,
  DEFAULT_TURBULENCE_FREQUENCY,
  DEFAULT_VORTEX_MIN_DISTANCE,
  TURBULENCE_DIFFERENCE_CELLS,
  dragField,
  radialField,
  turbulenceField,
  uniformGravityField,
  volumeField,
  vortexField,
  windField,
} from "../src/fields.js";
import { SeededRandom } from "../src/random.js";
import type { ParticleForceField } from "../src/types.js";

/** Origin, reused where a field ignores the argument. */
const ORIGIN = new Vector3(0, 0, 0);

/** Samples `field` into a fresh vector, so assertions never share storage. */
function sampleAt(
  field: ParticleForceField,
  position: Vector3,
  velocity: Vector3 = ORIGIN,
  time = 0,
): Vector3 {
  const out = new Vector3();
  const returned = field.sample(position, velocity, time, out);
  expect(returned).toBe(out);
  return out;
}

/** A field returning a fixed acceleration — the probe used to read a volume weight. */
function constantField(x: number, y: number, z: number): ParticleForceField {
  const scratch = new Vector3();
  return {
    sample(_position, _velocity, _time, out = scratch): Vector3 {
      return out.set(x, y, z);
    },
  };
}

/** Wraps a field, counting the samples it receives. */
function countingField(inner: ParticleForceField): {
  readonly field: ParticleForceField;
  calls: number;
} {
  const state: { field: ParticleForceField; calls: number } = {
    calls: 0,
    field: {
      sample(position, velocity, time, out): Vector3 {
        state.calls += 1;
        return inner.sample(position, velocity, time, out);
      },
    },
  };
  return state;
}

/**
 * A deterministic (§33) spray of sample points in `[-half, half]³` — the noise
 * tests need many positions and `Math.random` is banned, so the package's own
 * seeded stream supplies them.
 */
function samplePoints(seed: number, count: number, half: number): Vector3[] {
  const random = new SeededRandom(seed);
  const points: Vector3[] = [];
  for (let i = 0; i < count; i += 1) {
    points.push(
      new Vector3(
        random.nextRange(-half, half),
        random.nextRange(-half, half),
        random.nextRange(-half, half),
      ),
    );
  }
  return points;
}

/**
 * The float32 velocity recurrence the emitter actually runs for a
 * velocity-dependent field: the field sees the stored (float32) velocity, the
 * sum happens in binary64, and the result is rounded on its way back into the
 * `Float32Array`. Written out independently so the drag/wind assertions are
 * exact rather than approximate.
 */
function velocityReference(
  steps: number,
  dt: number,
  acceleration: (v: number) => number,
  velocity0: number,
): number {
  let velocity = Math.fround(velocity0);
  for (let i = 0; i < steps; i += 1) {
    velocity = Math.fround(velocity + acceleration(velocity) * dt);
  }
  return velocity;
}

/**
 * A one-particle emitter along +X: the burst fires during step 1 and the
 * particle first integrates in step 2, so after `n` steps it has been
 * integrated `n − 1` times (see `emitter.ts` on the age invariant).
 */
function singleParticleEmitter(
  speed: number,
  fields: readonly ParticleForceField[],
  gravity?: Vector3,
): ParticleEmitter {
  return new ParticleEmitter({
    maxParticles: 1,
    bursts: [{ time: 0, count: 1 }],
    lifetime: { min: 1000, max: 1000 },
    initialSpeed: { min: speed, max: speed },
    direction: new Vector3(1, 0, 0),
    gravity,
    fields,
  });
}

/** Steps `emitter` `steps` times with a constant `dt`, advancing absolute time. */
function run(emitter: ParticleEmitter, steps: number, dt: number): void {
  for (let i = 0; i < steps; i += 1) {
    emitter.step(dt, i * dt);
  }
}

describe("uniformGravityField (§27 uniform gravity)", () => {
  it("defaults to Appendix A's (0, -9.81, 0)", () => {
    const field = uniformGravityField();
    const a = sampleAt(field, new Vector3(3, 4, 5));
    expect(a.x).toBe(0);
    expect(a.y).toBe(DEFAULT_GRAVITY_Y);
    expect(a.z).toBe(0);
    expect(DEFAULT_GRAVITY_Y).toBe(-9.81);
  });

  it("is constant in position, velocity, and time", () => {
    const field = uniformGravityField(new Vector3(1, -2, 3));
    const probes: readonly [Vector3, Vector3, number][] = [
      [new Vector3(), new Vector3(), 0],
      [new Vector3(1000, -1000, 7), new Vector3(-4, 9, 2), 123.5],
      [new Vector3(-1e6, 0, 1e6), new Vector3(1e3, 0, 0), 1e4],
    ];
    for (const [position, velocity, time] of probes) {
      const a = sampleAt(field, position, velocity, time);
      expect([a.x, a.y, a.z]).toEqual([1, -2, 3]);
    }
  });

  it("copies its argument at construction", () => {
    const authored = new Vector3(0, 5, 0);
    const field = uniformGravityField(authored);
    authored.set(99, 99, 99);
    expect(sampleAt(field, ORIGIN).y).toBe(5);
  });

  it("rejects non-finite components", () => {
    expect(() => uniformGravityField(new Vector3(Number.NaN, 0, 0))).toThrow(
      RangeError,
    );
    expect(() =>
      uniformGravityField(new Vector3(0, Number.POSITIVE_INFINITY, 0)),
    ).toThrow(/uniformGravityField: y/);
    expect(() => uniformGravityField(new Vector3(0, 0, Number.NaN))).toThrow(
      /uniformGravityField: z/,
    );
  });
});

describe("dragField (§27 drag)", () => {
  it("is exactly -coefficient · v", () => {
    const field = dragField(0.25);
    const a = sampleAt(field, new Vector3(9, 9, 9), new Vector3(4, -8, 12));
    expect(a.x).toBe(-1);
    expect(a.y).toBe(2);
    expect(a.z).toBe(-3);
  });

  it("is a no-op at coefficient 0 and at rest", () => {
    // `-0 * v` is `-0`, which is `=== 0` but not `Object.is`-equal to it. The
    // sign of a zero acceleration is deliberately not pinned: it changes
    // nothing downstream (`v + -0·dt === v`).
    const idle = sampleAt(dragField(0), ORIGIN, new Vector3(5, 5, 5));
    expect(idle.x === 0 && idle.y === 0 && idle.z === 0).toBe(true);
    const atRest = sampleAt(dragField(3), ORIGIN, new Vector3());
    expect(atRest.x === 0 && atRest.y === 0 && atRest.z === 0).toBe(true);
  });

  it("decays velocity geometrically through the emitter", () => {
    const dt = 1 / 60;
    const coefficient = 0.5;
    const steps = 100;
    const emitter = singleParticleEmitter(10, [dragField(coefficient)]);
    run(emitter, steps, dt);

    const velocity = new Vector3();
    emitter.pool.getVelocity(0, velocity);
    // Exact: the same recurrence, in the same order, at the same precision.
    expect(velocity.x).toBe(
      velocityReference(steps - 1, dt, (v) => -coefficient * v, 10),
    );
    // And it is the discrete image of v0·e^(−ct): (1 − c·dt)ⁿ.
    expect(velocity.x).toBeCloseTo(
      10 * (1 - coefficient * dt) ** (steps - 1),
      5,
    );
    expect(velocity.y).toBe(0);
  });

  it("reaches the documented terminal velocity g/c under gravity", () => {
    const coefficient = 2;
    const emitter = singleParticleEmitter(
      0,
      [dragField(coefficient)],
      new Vector3(0, DEFAULT_GRAVITY_Y, 0),
    );
    run(emitter, 2000, 1 / 120);
    const velocity = new Vector3();
    emitter.pool.getVelocity(0, velocity);
    expect(velocity.y).toBeCloseTo(DEFAULT_GRAVITY_Y / coefficient, 4);
  });

  it("rejects a non-finite coefficient", () => {
    expect(() => dragField(Number.NaN)).toThrow(/dragField: coefficient/);
  });
});

describe("windField (§27 wind)", () => {
  it("is exactly coefficient · (wind − v)", () => {
    const field = windField(new Vector3(4, 0, -2), 0.5);
    const a = sampleAt(field, ORIGIN, new Vector3(2, 6, 0));
    expect(a.x).toBe(1);
    expect(a.y).toBe(-3);
    expect(a.z).toBe(-1);
  });

  it("vanishes exactly at the wind velocity", () => {
    const wind = new Vector3(3, -1, 7);
    const a = sampleAt(windField(wind, 12), new Vector3(50, 50, 50), wind);
    expect([a.x, a.y, a.z]).toEqual([0, 0, 0]);
  });

  it("differs from drag by exactly the constant c·wind", () => {
    const coefficient = 0.75;
    const wind = new Vector3(2, -3, 4);
    const velocity = new Vector3(-5, 6, 1);
    const drag = sampleAt(dragField(coefficient), ORIGIN, velocity);
    const gust = sampleAt(windField(wind, coefficient), ORIGIN, velocity);
    expect(gust.x - drag.x).toBeCloseTo(coefficient * wind.x, 12);
    expect(gust.y - drag.y).toBeCloseTo(coefficient * wind.y, 12);
    expect(gust.z - drag.z).toBeCloseTo(coefficient * wind.z, 12);
  });

  it("converges monotonically to the wind velocity through the emitter", () => {
    const dt = 1 / 60;
    const coefficient = 1.5;
    const windX = 6;
    const emitter = singleParticleEmitter(-4, [
      windField(new Vector3(windX, 0, 0), coefficient),
    ]);

    const steps = 1200;
    const velocity = new Vector3();
    let previousGap = Number.POSITIVE_INFINITY;
    for (let step = 0; step < steps; step += 1) {
      emitter.step(dt, step * dt);
      if (emitter.particleCount === 1) {
        emitter.pool.getVelocity(0, velocity);
        const gap = Math.abs(windX - velocity.x);
        // Monotone while the approach is above float32 noise; past that the
        // gap is at the resolution of the storage and its ordering is
        // meaningless.
        if (previousGap > 1e-5) {
          expect(gap).toBeLessThanOrEqual(previousGap);
        }
        previousGap = gap;
      }
    }
    // It converges to the float32 *storage's* fixed point, a couple of dozen
    // ulps short of `windX`: once the gap is small enough that
    // `c · gap · dt` rounds away against a stored value near 6, the recurrence
    // stalls. That is the truth about the simulation, not a tolerance fudge.
    expect(velocity.x).toBeCloseTo(windX, 4);
    expect(velocity.x).toBeLessThan(windX);
    // Exact recurrence, and the closed form vₙ = w + (v₀ − w)(1 − c·dt)ⁿ.
    expect(velocity.x).toBe(
      velocityReference(steps - 1, dt, (v) => coefficient * (windX - v), -4),
    );
    expect(velocity.x).toBeCloseTo(
      windX + (-4 - windX) * (1 - coefficient * dt) ** (steps - 1),
      4,
    );
  });

  it("rejects non-finite arguments", () => {
    expect(() => windField(new Vector3(Number.NaN, 0, 0), 1)).toThrow(
      /windField: wind.x/,
    );
    expect(() => windField(new Vector3(0, Number.NaN, 0), 1)).toThrow(
      /windField: wind.y/,
    );
    expect(() => windField(new Vector3(0, 0, Number.NaN), 1)).toThrow(
      /windField: wind.z/,
    );
    expect(() => windField(new Vector3(), Number.POSITIVE_INFINITY)).toThrow(
      /windField: coefficient/,
    );
  });
});

describe("radialField (§27 radial gravity / attractor / repulsor)", () => {
  const center = new Vector3(1, 2, 3);

  it("falls off as the inverse square at sampled radii", () => {
    const strength = 8;
    const field = radialField(center, strength, { minDistance: 1e-6 });
    for (const radius of [0.5, 1, 2, 4, 10]) {
      const a = sampleAt(
        field,
        new Vector3(center.x + radius, center.y, center.z),
      );
      expect(a.x).toBeCloseTo(strength / (radius * radius), 10);
      expect(a.y).toBe(0);
      expect(a.z).toBe(0);
    }
  });

  it("points outward for positive strength and inward for negative", () => {
    const outward = radialField(center, 5, { minDistance: 1e-6 });
    const inward = radialField(center, -5, { minDistance: 1e-6 });
    const position = new Vector3(center.x + 2, center.y - 1, center.z + 2);
    const offset = new Vector3(2, -1, 2); // position − center, length 3
    const out = sampleAt(outward, position);
    const back = sampleAt(inward, position);

    // Parallel to r, magnitude |s|/d², opposite signs.
    const magnitude = 5 / 9;
    expect(out.x).toBeCloseTo((offset.x / 3) * magnitude, 12);
    expect(out.y).toBeCloseTo((offset.y / 3) * magnitude, 12);
    expect(out.z).toBeCloseTo((offset.z / 3) * magnitude, 12);
    expect(back.x).toBeCloseTo(-out.x, 12);
    expect(back.y).toBeCloseTo(-out.y, 12);
    expect(back.z).toBeCloseTo(-out.z, 12);
  });

  it("has no tangential component anywhere", () => {
    const field = radialField(center, -3);
    for (const point of samplePoints(11, 32, 6)) {
      const a = sampleAt(field, point);
      const r = new Vector3(
        point.x - center.x,
        point.y - center.y,
        point.z - center.z,
      );
      const cross = r.clone().cross(a);
      expect(cross.length()).toBeLessThan(1e-9 * (1 + a.length()));
    }
  });

  it("clamps the magnitude at minDistance and keeps the direction", () => {
    const minDistance = 0.5;
    const field = radialField(ORIGIN, 4, { minDistance });
    const near = sampleAt(field, new Vector3(0.1, 0, 0));
    expect(near.x).toBeCloseTo(4 / (minDistance * minDistance), 12);
    const inside = sampleAt(field, new Vector3(0, -0.25, 0));
    expect(inside.y).toBeCloseTo(-4 / (minDistance * minDistance), 12);
    // Just outside the floor the unclamped law takes over again.
    const outside = sampleAt(field, new Vector3(0, 0, 1));
    expect(outside.z).toBeCloseTo(4, 12);
    expect(DEFAULT_RADIAL_MIN_DISTANCE).toBe(0.01);
  });

  it("contributes nothing exactly at the centre", () => {
    const a = sampleAt(radialField(center, 1000), center.clone());
    expect([a.x, a.y, a.z]).toEqual([0, 0, 0]);
  });

  it("rejects non-finite arguments and a non-positive minDistance", () => {
    expect(() => radialField(new Vector3(Number.NaN, 0, 0), 1)).toThrow(
      /radialField: center.x/,
    );
    expect(() => radialField(new Vector3(0, Number.NaN, 0), 1)).toThrow(
      /radialField: center.y/,
    );
    expect(() => radialField(new Vector3(0, 0, Number.NaN), 1)).toThrow(
      /radialField: center.z/,
    );
    expect(() => radialField(ORIGIN, Number.NaN)).toThrow(
      /radialField: strength/,
    );
    expect(() => radialField(ORIGIN, 1, { minDistance: 0 })).toThrow(
      /radialField: minDistance/,
    );
    expect(() => radialField(ORIGIN, 1, { minDistance: -1 })).toThrow(
      RangeError,
    );
  });
});

describe("vortexField (§27 vortex)", () => {
  const axis = new Vector3(0, 1, 0);

  it("swirls right-handed about the axis", () => {
    // ŷ × x̂ = −ẑ, magnitude |strength| / d.
    const field = vortexField(ORIGIN, axis, 6, { minDistance: 1e-6 });
    const a = sampleAt(field, new Vector3(2, 0, 0));
    expect(a.x).toBeCloseTo(0, 12);
    expect(a.y).toBeCloseTo(0, 12);
    expect(a.z).toBeCloseTo(-3, 12);

    const reversed = sampleAt(
      vortexField(ORIGIN, axis, -6, { minDistance: 1e-6 }),
      new Vector3(2, 0, 0),
    );
    expect(reversed.z).toBeCloseTo(3, 12);
  });

  it("falls off as 1/d in the distance from the axis, ignoring the axial offset", () => {
    const field = vortexField(ORIGIN, axis, 9, { minDistance: 1e-6 });
    for (const distance of [0.5, 1, 3, 7]) {
      for (const height of [-20, 0, 4.5]) {
        const a = sampleAt(field, new Vector3(distance, height, 0));
        expect(a.length()).toBeCloseTo(9 / distance, 9);
      }
    }
  });

  it("is perpendicular to both the axis and the radius everywhere", () => {
    const center = new Vector3(-2, 1, 0.5);
    const tilted = new Vector3(1, 2, -2); // length 3, normalized internally
    const field = vortexField(center, tilted, 4);
    const unitAxis = tilted.clone().normalize();
    for (const point of samplePoints(23, 32, 5)) {
      const a = sampleAt(field, point);
      const r = new Vector3(
        point.x - center.x,
        point.y - center.y,
        point.z - center.z,
      );
      const scale = 1 + a.length() * (1 + r.length());
      expect(Math.abs(a.dot(unitAxis))).toBeLessThan(1e-9 * scale);
      expect(Math.abs(a.dot(r))).toBeLessThan(1e-9 * scale);
    }
  });

  it("normalizes the axis", () => {
    const unit = vortexField(ORIGIN, axis, 6, { minDistance: 1e-6 });
    const long = vortexField(ORIGIN, new Vector3(0, 37, 0), 6, {
      minDistance: 1e-6,
    });
    const at = new Vector3(1.5, 3, -0.5);
    expect(sampleAt(long, at).equalsApprox(sampleAt(unit, at), 1e-12)).toBe(
      true,
    );
  });

  it("clamps at minDistance and vanishes on the axis", () => {
    const field = vortexField(ORIGIN, axis, 2, { minDistance: 0.25 });
    const near = sampleAt(field, new Vector3(0.05, 0, 0));
    expect(near.length()).toBeCloseTo(2 / 0.25, 10);
    const onAxis = sampleAt(field, new Vector3(0, 12, 0));
    expect([onAxis.x, onAxis.y, onAxis.z]).toEqual([0, 0, 0]);
    expect(DEFAULT_VORTEX_MIN_DISTANCE).toBe(0.01);
  });

  it("rejects a zero axis, non-finite arguments, and a non-positive minDistance", () => {
    expect(() => vortexField(ORIGIN, new Vector3(0, 0, 0), 1)).toThrow(
      /axis must have non-zero length/,
    );
    expect(() => vortexField(new Vector3(Number.NaN, 0, 0), axis, 1)).toThrow(
      /vortexField: center.x/,
    );
    expect(() => vortexField(new Vector3(0, Number.NaN, 0), axis, 1)).toThrow(
      /vortexField: center.y/,
    );
    expect(() => vortexField(new Vector3(0, 0, Number.NaN), axis, 1)).toThrow(
      /vortexField: center.z/,
    );
    expect(() => vortexField(ORIGIN, new Vector3(Number.NaN, 1, 0), 1)).toThrow(
      /vortexField: axis.x/,
    );
    expect(() => vortexField(ORIGIN, new Vector3(0, Number.NaN, 0), 1)).toThrow(
      /vortexField: axis.y/,
    );
    expect(() => vortexField(ORIGIN, new Vector3(0, 1, Number.NaN), 1)).toThrow(
      /vortexField: axis.z/,
    );
    expect(() => vortexField(ORIGIN, axis, Number.NaN)).toThrow(
      /vortexField: strength/,
    );
    expect(() => vortexField(ORIGIN, axis, 1, { minDistance: 0 })).toThrow(
      /vortexField: minDistance/,
    );
  });
});

describe("turbulenceField (§27 turbulence/noise)", () => {
  it("is fully determined by the seed", () => {
    const a = turbulenceField(4242);
    const b = turbulenceField(4242);
    for (const point of samplePoints(5, 24, 4)) {
      const sa = sampleAt(a, point);
      const sb = sampleAt(b, point);
      expect([sb.x, sb.y, sb.z]).toEqual([sa.x, sa.y, sa.z]);
    }
  });

  it("diverges for different seeds", () => {
    const a = turbulenceField(1);
    const b = turbulenceField(2);
    let differing = 0;
    for (const point of samplePoints(7, 24, 4)) {
      const sa = sampleAt(a, point);
      const sb = sampleAt(b, point);
      if (sa.x !== sb.x || sa.y !== sb.y || sa.z !== sb.z) {
        differing += 1;
      }
    }
    expect(differing).toBe(24);
  });

  it("never exceeds the amplitude in any component", () => {
    const amplitude = 3;
    const field = turbulenceField(99, { amplitude, frequency: 0.7 });
    let observedMax = 0;
    for (const point of samplePoints(13, 4096, 40)) {
      const a = sampleAt(field, point);
      observedMax = Math.max(
        observedMax,
        Math.abs(a.x),
        Math.abs(a.y),
        Math.abs(a.z),
      );
    }
    expect(observedMax).toBeLessThanOrEqual(amplitude);
    // The bound is a worst case: the field is genuinely non-trivial, but it
    // does not saturate (see the honesty note on `turbulenceField`, whose
    // ≈0.76·amplitude figure comes from a 20 000-point sweep).
    expect(observedMax).toBeGreaterThan(0.05 * amplitude);
    expect(observedMax).toBeLessThan(0.9 * amplitude);
  });

  it("scales linearly with amplitude and defaults to 1", () => {
    const one = turbulenceField(77, { amplitude: 1 });
    const five = turbulenceField(77, { amplitude: 5 });
    const bare = turbulenceField(77);
    for (const point of samplePoints(17, 16, 3)) {
      const a = sampleAt(one, point);
      const b = sampleAt(five, point);
      const c = sampleAt(bare, point);
      expect(b.x).toBeCloseTo(5 * a.x, 12);
      expect(b.y).toBeCloseTo(5 * a.y, 12);
      expect(b.z).toBeCloseTo(5 * a.z, 12);
      expect([c.x, c.y, c.z]).toEqual([a.x, a.y, a.z]);
    }
    expect(DEFAULT_TURBULENCE_AMPLITUDE).toBe(1);
    expect(DEFAULT_TURBULENCE_FREQUENCY).toBe(1);
    expect(TURBULENCE_DIFFERENCE_CELLS).toBe(0.5);
  });

  it("changes the eddy size with frequency without changing the bound", () => {
    const coarse = turbulenceField(31, { frequency: 0.25 });
    const fine = turbulenceField(31, { frequency: 4 });
    let differing = 0;
    for (const point of samplePoints(19, 32, 5)) {
      const a = sampleAt(coarse, point);
      const b = sampleAt(fine, point);
      if (a.x !== b.x) {
        differing += 1;
      }
      for (const component of [b.x, b.y, b.z]) {
        expect(Math.abs(component)).toBeLessThanOrEqual(1);
      }
    }
    expect(differing).toBe(32);
  });

  it("is smooth: the difference shrinks with the step", () => {
    const field = turbulenceField(2024, { frequency: 1, amplitude: 1 });
    const base = new Vector3(0.37, -1.21, 2.08);
    const measure = (epsilon: number): number => {
      const a = sampleAt(field, base);
      const b = sampleAt(
        field,
        new Vector3(base.x + epsilon, base.y + epsilon, base.z + epsilon),
      );
      return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    };
    const coarse = measure(1e-2);
    const half = measure(5e-3);
    const quarter = measure(2.5e-3);
    // Non-trivial, and halving the step roughly halves the difference — a
    // Lipschitz field, which is all that is claimed. (No divergence-free or
    // curl-free property is asserted anywhere; see the honesty note.)
    expect(coarse).toBeGreaterThan(0);
    expect(half / coarse).toBeGreaterThan(0.4);
    expect(half / coarse).toBeLessThan(0.6);
    expect(quarter / half).toBeGreaterThan(0.4);
    expect(quarter / half).toBeLessThan(0.6);
  });

  it("ignores time unless scroll is set, and then advects exactly", () => {
    const still = turbulenceField(8, { frequency: 0.5 });
    const point = new Vector3(1.5, -0.5, 3.25);
    const atZero = sampleAt(still, point, ORIGIN, 0);
    const atLate = sampleAt(still, point, ORIGIN, 987.5);
    expect([atLate.x, atLate.y, atLate.z]).toEqual([
      atZero.x,
      atZero.y,
      atZero.z,
    ]);

    const scroll = new Vector3(2, 0, -1);
    const moving = turbulenceField(8, { frequency: 0.5, scroll });
    const time = 3.75;
    const shifted = new Vector3(
      point.x - scroll.x * time,
      point.y - scroll.y * time,
      point.z - scroll.z * time,
    );
    const advected = sampleAt(moving, point, ORIGIN, time);
    const frozen = sampleAt(moving, shifted, ORIGIN, 0);
    expect([advected.x, advected.y, advected.z]).toEqual([
      frozen.x,
      frozen.y,
      frozen.z,
    ]);
    // And it really does move.
    const atOrigin = sampleAt(moving, point, ORIGIN, 0);
    expect(advected.x).not.toBe(atOrigin.x);
  });

  it("copies scroll at construction", () => {
    const scroll = new Vector3(1, 0, 0);
    const field = turbulenceField(3, { scroll });
    const before = sampleAt(field, ORIGIN, ORIGIN, 2);
    scroll.set(-50, -50, -50);
    const after = sampleAt(field, ORIGIN, ORIGIN, 2);
    expect([after.x, after.y, after.z]).toEqual([before.x, before.y, before.z]);
  });

  it("rejects a bad seed, frequency, amplitude, or scroll", () => {
    expect(() => turbulenceField(Number.NaN)).toThrow(RangeError);
    expect(() => turbulenceField(1, { frequency: 0 })).toThrow(
      /turbulenceField: frequency/,
    );
    expect(() => turbulenceField(1, { frequency: -2 })).toThrow(RangeError);
    expect(() => turbulenceField(1, { amplitude: Number.NaN })).toThrow(
      /turbulenceField: amplitude/,
    );
    expect(() =>
      turbulenceField(1, { scroll: new Vector3(Number.NaN, 0, 0) }),
    ).toThrow(/turbulenceField: scroll.x/);
    expect(() =>
      turbulenceField(1, { scroll: new Vector3(0, Number.NaN, 0) }),
    ).toThrow(/turbulenceField: scroll.y/);
    expect(() =>
      turbulenceField(1, { scroll: new Vector3(0, 0, Number.NaN) }),
    ).toThrow(/turbulenceField: scroll.z/);
  });
});

describe("volumeField (§27 volume-based inclusion and filtering)", () => {
  const probe = constantField(1, 0, 0);

  it("passes the inner field through unchanged inside a sphere", () => {
    const field = volumeField(constantField(2, -3, 4), {
      shape: "sphere",
      center: new Vector3(1, 1, 1),
      radius: 5,
    });
    const a = sampleAt(field, new Vector3(1, 3, 1));
    expect([a.x, a.y, a.z]).toEqual([2, -3, 4]);
  });

  it("contributes exactly zero outside, at the boundary included", () => {
    const field = volumeField(constantField(2, -3, 4), {
      shape: "sphere",
      center: ORIGIN,
      radius: 2,
    });
    for (const point of [new Vector3(2, 0, 0), new Vector3(0, 0, 3)]) {
      const a = sampleAt(field, point);
      expect([a.x, a.y, a.z]).toEqual([0, 0, 0]);
    }
  });

  it("does not sample the inner field outside the volume", () => {
    const counted = countingField(constantField(1, 1, 1));
    const field = volumeField(counted.field, {
      shape: "sphere",
      center: ORIGIN,
      radius: 1,
    });
    sampleAt(field, new Vector3(10, 0, 0));
    expect(counted.calls).toBe(0);
    sampleAt(field, new Vector3(0.5, 0, 0));
    expect(counted.calls).toBe(1);
  });

  it("fades monotonically through the sphere's edge band", () => {
    const radius = 4;
    const falloff = 1.5;
    const field = volumeField(probe, {
      shape: "sphere",
      center: ORIGIN,
      radius,
      falloff,
    });
    let previous = Number.POSITIVE_INFINITY;
    const weights: number[] = [];
    for (let i = 0; i <= 40; i += 1) {
      const distance = (i / 40) * (radius + 1);
      const weight = sampleAt(field, new Vector3(distance, 0, 0)).x;
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(1);
      expect(weight).toBeLessThanOrEqual(previous);
      previous = weight;
      weights.push(weight);
    }
    expect(weights[0]).toBe(1); // centre: full strength
    expect(weights[weights.length - 1]).toBe(0); // outside: nothing
    // Strictly decreasing across the band, and smoothstep at its midpoint.
    const inner = sampleAt(field, new Vector3(radius - falloff, 0, 0)).x;
    const mid = sampleAt(field, new Vector3(radius - falloff / 2, 0, 0)).x;
    expect(inner).toBe(1);
    expect(mid).toBeCloseTo(0.5, 12);
  });

  it("treats a falloff of 0 as a hard edge", () => {
    const field = volumeField(probe, {
      shape: "sphere",
      center: ORIGIN,
      radius: 2,
    });
    expect(sampleAt(field, new Vector3(1.999_999, 0, 0)).x).toBe(1);
    expect(sampleAt(field, new Vector3(2.000_001, 0, 0)).x).toBe(0);
  });

  it("accepts a falloff wider than the radius, peaking below 1", () => {
    const field = volumeField(probe, {
      shape: "sphere",
      center: ORIGIN,
      radius: 1,
      falloff: 4,
    });
    const centre = sampleAt(field, ORIGIN).x;
    expect(centre).toBeGreaterThan(0);
    expect(centre).toBeLessThan(1);
    expect(centre).toBeCloseTo(0.25 * 0.25 * (3 - 2 * 0.25), 12);
  });

  it("includes and excludes per axis for a box", () => {
    const field = volumeField(probe, {
      shape: "box",
      center: new Vector3(0, 10, 0),
      extents: new Vector3(1, 2, 3),
    });
    expect(sampleAt(field, new Vector3(0, 10, 0)).x).toBe(1);
    expect(sampleAt(field, new Vector3(0.9, 11.9, 2.9)).x).toBe(1);
    expect(sampleAt(field, new Vector3(-0.9, 8.1, -2.9)).x).toBe(1);
    expect(sampleAt(field, new Vector3(1.1, 10, 0)).x).toBe(0);
    expect(sampleAt(field, new Vector3(0, 12.1, 0)).x).toBe(0);
    expect(sampleAt(field, new Vector3(0, 10, -3.1)).x).toBe(0);
  });

  it("fades a box from whichever face is nearest", () => {
    const falloff = 0.5;
    const field = volumeField(probe, {
      shape: "box",
      center: ORIGIN,
      extents: new Vector3(2, 4, 6),
      falloff,
    });
    // Deep in every axis: full strength.
    expect(sampleAt(field, new Vector3(1, 1, 1)).x).toBe(1);
    // One quarter-band from the +X, −Y and +Z faces in turn — each drives the
    // weight on its own, and the three agree because the depth is the same.
    const nearX = sampleAt(field, new Vector3(2 - falloff / 2, 0, 0)).x;
    const nearY = sampleAt(field, new Vector3(0, -(4 - falloff / 2), 0)).x;
    const nearZ = sampleAt(field, new Vector3(0, 0, 6 - falloff / 2)).x;
    expect(nearX).toBeCloseTo(0.5, 12);
    expect(nearY).toBeCloseTo(0.5, 12);
    expect(nearZ).toBeCloseTo(0.5, 12);
    // A corner is governed by the nearest face, so it is no stronger than any
    // single-face sample at the same depth.
    const corner = sampleAt(
      field,
      new Vector3(2 - falloff / 2, 4 - falloff / 4, 6 - falloff / 8),
    ).x;
    expect(corner).toBeLessThan(nearX);
    expect(corner).toBeGreaterThan(0);
    // Monotone outward along the +X axis.
    let previous = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 20; i += 1) {
      const weight = sampleAt(field, new Vector3((i / 20) * 2.5, 0, 0)).x;
      expect(weight).toBeLessThanOrEqual(previous);
      previous = weight;
    }
  });

  it("multiplies the weights when nested", () => {
    const outerFalloff = 2;
    const nested = volumeField(
      volumeField(probe, {
        shape: "sphere",
        center: ORIGIN,
        radius: 4,
        falloff: outerFalloff,
      }),
      {
        shape: "box",
        center: ORIGIN,
        extents: new Vector3(10, 10, 10),
        falloff: 0,
      },
    );
    const alone = sampleAt(
      volumeField(probe, {
        shape: "sphere",
        center: ORIGIN,
        radius: 4,
        falloff: outerFalloff,
      }),
      new Vector3(3, 0, 0),
    ).x;
    expect(sampleAt(nested, new Vector3(3, 0, 0)).x).toBeCloseTo(alone, 12);
    expect(sampleAt(nested, new Vector3(20, 0, 0)).x).toBe(0);
  });

  it("copies the volume description at construction", () => {
    const center = new Vector3(0, 0, 0);
    const extents = new Vector3(1, 1, 1);
    const field = volumeField(probe, { shape: "box", center, extents });
    center.set(100, 100, 100);
    extents.set(0.001, 0.001, 0.001);
    expect(sampleAt(field, new Vector3(0.5, 0.5, 0.5)).x).toBe(1);
  });

  it("rejects a degenerate volume", () => {
    expect(() =>
      volumeField(probe, { shape: "sphere", center: ORIGIN, radius: 0 }),
    ).toThrow(/volumeField\(sphere\): radius/);
    expect(() =>
      volumeField(probe, {
        shape: "sphere",
        center: ORIGIN,
        radius: 1,
        falloff: -1,
      }),
    ).toThrow(/volumeField\(sphere\): falloff/);
    expect(() =>
      volumeField(probe, {
        shape: "sphere",
        center: new Vector3(Number.NaN, 0, 0),
        radius: 1,
      }),
    ).toThrow(/center.x/);
    expect(() =>
      volumeField(probe, {
        shape: "sphere",
        center: new Vector3(0, Number.NaN, 0),
        radius: 1,
      }),
    ).toThrow(/center.y/);
    expect(() =>
      volumeField(probe, {
        shape: "sphere",
        center: new Vector3(0, 0, Number.NaN),
        radius: 1,
      }),
    ).toThrow(/center.z/);
    expect(() =>
      volumeField(probe, {
        shape: "box",
        center: ORIGIN,
        extents: new Vector3(0, 1, 1),
      }),
    ).toThrow(/volumeField\(box\): extents.x/);
    expect(() =>
      volumeField(probe, {
        shape: "box",
        center: ORIGIN,
        extents: new Vector3(1, -1, 1),
      }),
    ).toThrow(/volumeField\(box\): extents.y/);
    expect(() =>
      volumeField(probe, {
        shape: "box",
        center: ORIGIN,
        extents: new Vector3(1, 1, Number.NaN),
      }),
    ).toThrow(/volumeField\(box\): extents.z/);
  });
});

describe("fields — shared contract", () => {
  /** One instance of every built-in, for the contracts that hold across all of them. */
  function everyField(): { name: string; field: ParticleForceField }[] {
    return [
      { name: "uniformGravityField", field: uniformGravityField() },
      { name: "dragField", field: dragField(0.3) },
      { name: "windField", field: windField(new Vector3(1, 2, 3), 0.4) },
      { name: "radialField", field: radialField(new Vector3(1, 0, 0), -2) },
      {
        name: "vortexField",
        field: vortexField(ORIGIN, new Vector3(0, 1, 0), 3),
      },
      { name: "turbulenceField", field: turbulenceField(5, { amplitude: 2 }) },
      {
        name: "volumeField",
        field: volumeField(dragField(0.3), {
          shape: "sphere",
          center: ORIGIN,
          radius: 100,
          falloff: 1,
        }),
      },
    ];
  }

  it("returns a reusable scratch vector when `out` is omitted", () => {
    const position = new Vector3(2, 3, 4);
    const velocity = new Vector3(-1, 0.5, 2);
    for (const { name, field } of everyField()) {
      const first = field.sample(position, velocity, 0);
      const second = field.sample(position, velocity, 0);
      expect(second, name).toBe(first);
      const explicit = sampleAt(field, position, velocity, 0);
      expect(explicit.equalsApprox(first, 0), name).toBe(true);
    }
  });

  it("overwrites every component of a dirty `out`", () => {
    const position = new Vector3(2, 3, 4);
    const velocity = new Vector3(-1, 0.5, 2);
    for (const { name, field } of everyField()) {
      const clean = sampleAt(field, position, velocity, 0);
      const dirty = new Vector3(Number.NaN, Number.NaN, Number.NaN);
      field.sample(position, velocity, 0, dirty);
      expect(Number.isNaN(dirty.x), name).toBe(false);
      expect([dirty.x, dirty.y, dirty.z], name).toEqual([
        clean.x,
        clean.y,
        clean.z,
      ]);
    }
  });

  it("is safe when `out` aliases `position` or `velocity`", () => {
    for (const { name, field } of everyField()) {
      const expected = sampleAt(
        field,
        new Vector3(2, 3, 4),
        new Vector3(-1, 0.5, 2),
        1.5,
      );

      const aliasedPosition = new Vector3(2, 3, 4);
      field.sample(
        aliasedPosition,
        new Vector3(-1, 0.5, 2),
        1.5,
        aliasedPosition,
      );
      expect(
        [aliasedPosition.x, aliasedPosition.y, aliasedPosition.z],
        name,
      ).toEqual([expected.x, expected.y, expected.z]);

      const aliasedVelocity = new Vector3(-1, 0.5, 2);
      field.sample(new Vector3(2, 3, 4), aliasedVelocity, 1.5, aliasedVelocity);
      expect(
        [aliasedVelocity.x, aliasedVelocity.y, aliasedVelocity.z],
        name,
      ).toEqual([expected.x, expected.y, expected.z]);
    }
  });

  it("never mutates `position` or `velocity`", () => {
    const position = new Vector3(2, 3, 4);
    const velocity = new Vector3(-1, 0.5, 2);
    const out = new Vector3();
    for (const { name, field } of everyField()) {
      field.sample(position, velocity, 1.5, out);
      expect([position.x, position.y, position.z], name).toEqual([2, 3, 4]);
      expect([velocity.x, velocity.y, velocity.z], name).toEqual([-1, 0.5, 2]);
    }
  });

  it("allocates no math objects while sampling (§7b, plan D7)", () => {
    const fields = everyField();
    const position = new Vector3(1.25, -0.5, 2);
    const velocity = new Vector3(0.5, 1, -1);
    const out = new Vector3();
    for (const { field } of fields) {
      field.sample(position, velocity, 0, out); // warm up
      field.sample(position, velocity, 0); // and the scratch path
    }

    resetConstructionCount();
    for (let i = 0; i < 200; i += 1) {
      position.set(i * 0.01, -i * 0.02, i * 0.03);
      velocity.set(i * 0.05, 1, -1);
      for (const { field } of fields) {
        field.sample(position, velocity, i * 0.016, out);
        field.sample(position, velocity, i * 0.016);
      }
    }
    expect(constructionCount()).toBe(0);
  });
});

describe("fields — composition through the emitter (§27 + §36)", () => {
  it("sums in declaration order, which is not associative", () => {
    // The same trick `emitter.test.ts` uses: (1e16 − 1e16) + 1 is 1, while
    // (1e16 + 1) − 1e16 is 0, because 1e16 + 1 rounds back to 1e16. The emitter
    // sums gravity then the fields left to right, so the two orders differ.
    const big = uniformGravityField(new Vector3(-1e16, 0, 0));
    const one = uniformGravityField(new Vector3(1, 0, 0));
    const build = (fields: ParticleForceField[]): ParticleEmitter =>
      new ParticleEmitter({
        maxParticles: 1,
        bursts: [{ time: 0, count: 1 }],
        lifetime: { min: 100, max: 100 },
        gravity: new Vector3(1e16, 0, 0),
        fields,
      });

    const declared = build([big, one]);
    const reversed = build([one, big]);
    run(declared, 2, 1);
    run(reversed, 2, 1);

    const velocity = new Vector3();
    declared.pool.getVelocity(0, velocity);
    expect(velocity.x).toBe(1);
    reversed.pool.getVelocity(0, velocity);
    expect(velocity.x).toBe(0);
  });

  it("separates the pull of a radial attractor from the swirl of a vortex", () => {
    const build = (fields: ParticleForceField[]): ParticleEmitter =>
      new ParticleEmitter({
        maxParticles: 1,
        bursts: [{ time: 0, count: 1 }],
        lifetime: { min: 1000, max: 1000 },
        position: new Vector3(4, 0, 0),
        initialSpeed: { min: 0, max: 0 },
        fields,
      });

    const attractor = radialField(ORIGIN, -8, { minDistance: 0.5 });
    const vortex = vortexField(ORIGIN, new Vector3(0, 1, 0), 6, {
      minDistance: 0.5,
    });

    // The attractor alone: a straight fall along −X, with no tangential motion
    // at all (radialField has no tangential component, so z never moves).
    const pulled = build([attractor]);
    run(pulled, 61, 1 / 60);
    const position = new Vector3();
    pulled.pool.getPosition(0, position);
    expect(position.z).toBe(0);
    expect(position.y).toBe(0);
    expect(position.x).toBeLessThan(4);
    expect(position.x).toBeGreaterThan(0);

    // Adding the vortex bends the same fall into the −Z half-space (ŷ × x̂ =
    // −ẑ) without ever leaving the XZ plane.
    const swirled = build([attractor, vortex]);
    run(swirled, 61, 1 / 60);
    swirled.pool.getPosition(0, position);
    expect(position.y).toBe(0);
    expect(position.z).toBeLessThan(-0.1);

    // A tangential force alone adds energy, so the vortex on its own spirals
    // *outward* — the honest behaviour, not an inward whirlpool.
    const flung = build([vortex]);
    run(flung, 61, 1 / 60);
    flung.pool.getPosition(0, position);
    expect(Math.hypot(position.x, position.z)).toBeGreaterThan(4);
  });

  it("acts only inside a volume", () => {
    const push = volumeField(uniformGravityField(new Vector3(0, 0, 40)), {
      shape: "box",
      center: new Vector3(3, 0, 0),
      extents: new Vector3(1, 1, 1),
    });
    const emitter = new ParticleEmitter({
      maxParticles: 1,
      bursts: [{ time: 0, count: 1 }],
      lifetime: { min: 1000, max: 1000 },
      initialSpeed: { min: 4, max: 4 },
      direction: new Vector3(1, 0, 0),
      fields: [push],
    });

    const position = new Vector3();
    // Travelling from the origin at 4 units/s, the particle is still short of
    // the box after 0.25 s.
    run(emitter, 16, 1 / 60);
    emitter.pool.getPosition(0, position);
    expect(position.x).toBeLessThan(2);
    expect(position.z).toBe(0);

    // …and has been deflected in +Z by the time it has crossed it.
    run(emitter, 60, 1 / 60);
    emitter.pool.getPosition(0, position);
    expect(position.x).toBeGreaterThan(4);
    expect(position.z).toBeGreaterThan(0.5);
  });

  it("keeps a turbulent emitter bit-identical across runs (§33)", () => {
    const build = (): ParticleEmitter =>
      new ParticleEmitter({
        maxParticles: 64,
        seed: 4711,
        emissionRate: 120,
        lifetime: { min: 0.4, max: 0.9 },
        initialSpeed: { min: 1, max: 3 },
        spreadAngle: Math.PI / 6,
        gravity: new Vector3(0, DEFAULT_GRAVITY_Y, 0),
        fields: [
          dragField(0.2),
          turbulenceField(4711, { frequency: 0.8, amplitude: 4 }),
        ],
      });

    const a = build();
    const b = build();
    run(a, 200, 1 / 60);
    run(b, 200, 1 / 60);
    expect(a.particleCount).toBe(b.particleCount);
    expect(a.particleCount).toBeGreaterThan(0);
    expect(Array.from(a.pool.positions)).toEqual(Array.from(b.pool.positions));
    expect(Array.from(a.pool.velocities)).toEqual(
      Array.from(b.pool.velocities),
    );
  });
});
