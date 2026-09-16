import {
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@fourjs/math";
import { describe, expect, it } from "vitest";

import { rk4, type IntegratorState } from "../src/integrators.js";
import {
  SpringDamper,
  type SpringDamperOptions,
  type SpringDamperResult,
  type SpringDamperVector3Result,
} from "../src/spring-damper.js";

const DT = 1 / 60;

/** Fresh scalar result record. */
function makeResult(): SpringDamperResult {
  return { value: 0, velocity: 0 };
}

/** Fresh vector result record. */
function makeVectorResult(): SpringDamperVector3Result {
  return { value: new Vector3(), velocity: new Vector3() };
}

/**
 * `exp(A·dt)` for the 2×2 companion matrix `A = [[0, 1], [−k, −c]]`, by Taylor
 * series with scaling and squaring. Row-major `[m11, m12, m21, m22]`.
 *
 * This is the reference the closed forms are checked against: it is the *same*
 * differential equation solved by a completely different route (no eigenvalues,
 * no regime split, no trigonometry), so agreement to round-off is real evidence
 * that the algebra in `spring-damper.ts` is right — in every regime, including
 * the critical one where the textbook formulas are singular limits.
 */
function matrixExponential(
  stiffness: number,
  damping: number,
  dt: number,
): [number, number, number, number] {
  const a: [number, number, number, number] = [
    0,
    dt,
    -stiffness * dt,
    -damping * dt,
  ];
  // Scale so the norm is comfortably below 1/2, then square back up.
  const norm = Math.max(
    Math.abs(a[0]) + Math.abs(a[1]),
    Math.abs(a[2]) + Math.abs(a[3]),
  );
  let squarings = 0;
  while (norm / 2 ** squarings > 0.25) {
    squarings += 1;
  }
  const s = 2 ** squarings;
  const b: [number, number, number, number] = [
    a[0] / s,
    a[1] / s,
    a[2] / s,
    a[3] / s,
  ];

  let result: [number, number, number, number] = [1, 0, 0, 1];
  let term: [number, number, number, number] = [1, 0, 0, 1];
  for (let k = 1; k <= 24; k += 1) {
    term = multiply(term, b);
    term = [term[0] / k, term[1] / k, term[2] / k, term[3] / k];
    result = [
      result[0] + term[0],
      result[1] + term[1],
      result[2] + term[2],
      result[3] + term[3],
    ];
  }
  for (let i = 0; i < squarings; i += 1) {
    result = multiply(result, result);
  }
  return result;
}

/** Row-major 2×2 product. */
function multiply(
  m: [number, number, number, number],
  n: [number, number, number, number],
): [number, number, number, number] {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
  ];
}

/** The reference step: `exp(A·dt)` applied to `(current − target, velocity)`. */
function referenceStep(
  spring: SpringDamper,
  current: number,
  target: number,
  velocity: number,
  dt: number,
): SpringDamperResult {
  const m = matrixExponential(spring.stiffness, spring.damping, dt);
  const d = current - target;
  return {
    value: target + m[0] * d + m[1] * velocity,
    velocity: m[2] * d + m[3] * velocity,
  };
}

/** One spring per regime, both parameterizations represented. */
const REGIMES: readonly (readonly [string, SpringDamperOptions])[] = [
  ["undamped", { frequencyHz: 1.5, dampingRatio: 0 }],
  ["underdamped", { frequencyHz: 2, dampingRatio: 0.25 }],
  ["critical", { frequencyHz: 3, dampingRatio: 1 }],
  ["overdamped", { frequencyHz: 1, dampingRatio: 2.5 }],
  ["coefficients (underdamped)", { stiffness: 400, damping: 8 }],
  ["coefficients (critical)", { stiffness: 100, damping: 20 }],
  ["coefficients (overdamped)", { stiffness: 25, damping: 30 }],
];

describe("SpringDamper construction", () => {
  it("derives the coefficient form from the frequency form", () => {
    const spring = new SpringDamper({ frequencyHz: 2, dampingRatio: 0.5 });
    const omega = 2 * Math.PI * 2;
    expect(spring.angularFrequency).toBeCloseTo(omega, 12);
    expect(spring.stiffness).toBeCloseTo(omega * omega, 9);
    expect(spring.damping).toBeCloseTo(omega, 12);
    expect(spring.dampingRatio).toBeCloseTo(0.5, 15);
    expect(spring.frequencyHz).toBeCloseTo(2, 12);
  });

  it("derives the frequency form from the coefficient form", () => {
    const spring = new SpringDamper({ stiffness: 100, damping: 10 });
    expect(spring.angularFrequency).toBe(10);
    expect(spring.dampingRatio).toBe(0.5);
    expect(spring.frequencyHz).toBeCloseTo(10 / (2 * Math.PI), 15);
    expect(spring.stiffness).toBe(100);
    expect(spring.damping).toBe(10);
  });

  it("makes critical damping exact in both parameterizations", () => {
    expect(
      new SpringDamper({ frequencyHz: 3, dampingRatio: 1 }).dampingRatio,
    ).toBe(1);
    expect(new SpringDamper({ stiffness: 16, damping: 8 }).dampingRatio).toBe(
      1,
    );
  });

  it("rejects out-of-range parameters", () => {
    expect(() => new SpringDamper({ stiffness: 0, damping: 1 })).toThrow(
      /stiffness must be a finite number > 0/,
    );
    expect(() => new SpringDamper({ stiffness: -1, damping: 1 })).toThrow(
      RangeError,
    );
    expect(
      () => new SpringDamper({ stiffness: Number.NaN, damping: 1 }),
    ).toThrow(RangeError);
    expect(() => new SpringDamper({ stiffness: 1, damping: -1 })).toThrow(
      /damping must be a finite number >= 0/,
    );
    expect(() => new SpringDamper({ frequencyHz: 0, dampingRatio: 1 })).toThrow(
      /frequencyHz must be a finite number > 0/,
    );
    expect(
      () =>
        new SpringDamper({
          frequencyHz: Number.POSITIVE_INFINITY,
          dampingRatio: 1,
        }),
    ).toThrow(RangeError);
    expect(
      () => new SpringDamper({ frequencyHz: 1, dampingRatio: -0.5 }),
    ).toThrow(/dampingRatio must be a finite number >= 0/);
  });

  it("rejects options that are neither parameterization", () => {
    expect(() => new SpringDamper({} as SpringDamperOptions)).toThrow(
      TypeError,
    );
    expect(
      () => new SpringDamper({ damping: 1 } as unknown as SpringDamperOptions),
    ).toThrow(/either \{stiffness, damping\} or \{frequencyHz, dampingRatio\}/);
  });
});

describe("exact exponential step", () => {
  it("matches the matrix-exponential reference in every regime", () => {
    for (const [name, options] of REGIMES) {
      const spring = new SpringDamper(options);
      const out = makeResult();
      for (const dt of [1 / 240, DT, 0.1, 0.5]) {
        spring.update(0.3, 1.25, -2.5, dt, out);
        const reference = referenceStep(spring, 0.3, 1.25, -2.5, dt);
        expect(out.value, `${name} @ ${dt}`).toBeCloseTo(reference.value, 12);
        expect(out.velocity, `${name} @ ${dt}`).toBeCloseTo(
          reference.velocity,
          12,
        );
      }
    }
  });

  it("agrees with RK4 integration of the same differential equation", () => {
    for (const [name, options] of REGIMES) {
      const spring = new SpringDamper(options);
      const target = 1.25;
      const state: IntegratorState = {
        position: new Vector3(0.3, 0, 0),
        velocity: new Vector3(-2.5, 0, 0),
      };
      const fine = 1e-5;
      const steps = 20000; // 0.2 s
      for (let step = 0; step < steps; step += 1) {
        rk4(
          state,
          (s, _t, out) =>
            out.set(
              -spring.stiffness * (s.position.x - target) -
                spring.damping * s.velocity.x,
              0,
              0,
            ),
          step * fine,
          fine,
        );
      }
      const exact = spring.update(0.3, target, -2.5, steps * fine);
      expect(exact.value, name).toBeCloseTo(state.position.x, 8);
      expect(exact.velocity, name).toBeCloseTo(state.velocity.x, 8);
    }
  });

  it("composes: n steps of dt equal one step of n·dt", () => {
    for (const [name, options] of REGIMES) {
      const spring = new SpringDamper(options);
      const state = { value: 0.3, velocity: -2.5 };
      const steps = 32;
      for (let step = 0; step < steps; step += 1) {
        spring.update(state.value, 1.25, state.velocity, DT, state);
      }
      const once = spring.update(0.3, 1.25, -2.5, steps * DT);
      expect(state.value, name).toBeCloseTo(once.value, 12);
      expect(state.velocity, name).toBeCloseTo(once.velocity, 12);
    }
  });

  it("stays finite and lands on the target for an absurd step", () => {
    const spring = new SpringDamper({ frequencyHz: 30, dampingRatio: 1 });
    const out = spring.update(0, 5, 100, 1000);
    expect(out.value).toBeCloseTo(5, 12);
    expect(out.velocity).toBeCloseTo(0, 12);
  });
});

describe("damping regimes", () => {
  it("critical damping converges monotonically, without overshoot", () => {
    const spring = new SpringDamper({ frequencyHz: 2, dampingRatio: 1 });
    const state = { value: 0, velocity: 0 };
    const target = 1;
    let previous = state.value;
    for (let step = 0; step < 240; step += 1) {
      const converged = target - previous > 1e-12;
      spring.update(state.value, target, state.velocity, DT, state);
      // Strictly rising until the remaining error is at the noise floor, and
      // never overshooting: that is what critical damping buys.
      if (converged) {
        expect(state.value, `step ${step}`).toBeGreaterThan(previous);
      } else {
        expect(state.value, `step ${step}`).toBeGreaterThanOrEqual(previous);
      }
      expect(state.value, `step ${step}`).toBeLessThanOrEqual(target);
      previous = state.value;
    }
    expect(state.value).toBeCloseTo(target, 6);
    expect(state.velocity).toBeCloseTo(0, 6);
  });

  it("overdamped damping converges monotonically too, but slower", () => {
    const critical = new SpringDamper({ frequencyHz: 2, dampingRatio: 1 });
    const overdamped = new SpringDamper({ frequencyHz: 2, dampingRatio: 3 });
    const criticalState = { value: 0, velocity: 0 };
    const overdampedState = { value: 0, velocity: 0 };
    let previous = 0;
    for (let step = 0; step < 60; step += 1) {
      critical.update(
        criticalState.value,
        1,
        criticalState.velocity,
        DT,
        criticalState,
      );
      overdamped.update(
        overdampedState.value,
        1,
        overdampedState.velocity,
        DT,
        overdampedState,
      );
      expect(overdampedState.value).toBeGreaterThan(previous);
      expect(overdampedState.value).toBeLessThan(criticalState.value);
      previous = overdampedState.value;
    }
  });

  it("oscillates at the analytic damped frequency when underdamped", () => {
    // Released from rest, the displacement is d₀·e^(−σt)·(cos ω_d t +
    // (σ/ω_d)·sin ω_d t): at every half period ω_d·t = kπ the sine vanishes, so
    // the displacement is exactly ±d₀·e^(−σt) — an analytic statement about the
    // oscillation frequency *and* the decay envelope at once.
    const spring = new SpringDamper({ frequencyHz: 2, dampingRatio: 0.2 });
    const omega = spring.angularFrequency;
    const sigma = spring.dampingRatio * omega;
    const dampedOmega = omega * Math.sqrt(1 - 0.2 * 0.2);
    const halfPeriod = Math.PI / dampedOmega;
    const displacement = -1; // from 0 towards a target of 1
    for (let k = 1; k <= 6; k += 1) {
      const t = k * halfPeriod;
      const out = spring.update(0, 1, 0, t);
      const expected = 1 + displacement * (-1) ** k * Math.exp(-sigma * t);
      expect(out.value, `half period ${k}`).toBeCloseTo(expected, 12);
      // Velocity vanishes at every half period of a spring released from rest.
      expect(out.velocity, `half period ${k}`).toBeCloseTo(0, 9);
      // Sign alternates about the target: that is the oscillation.
      expect(Math.sign(out.value - 1), `half period ${k}`).toBe(
        (-1) ** (k + 1),
      );
    }
  });

  it("conserves energy when undamped", () => {
    const spring = new SpringDamper({ frequencyHz: 1.5, dampingRatio: 0 });
    const stiffness = spring.stiffness;
    const state = { value: 2, velocity: 0 };
    const energy = 0.5 * stiffness * (state.value - 0) ** 2;
    for (let step = 0; step < 600; step += 1) {
      spring.update(state.value, 0, state.velocity, DT, state);
      const current =
        0.5 * state.velocity ** 2 + 0.5 * stiffness * state.value ** 2;
      expect(current).toBeCloseTo(energy, 9);
    }
  });
});

describe("Vector3 variant", () => {
  it("matches the scalar step component by component, bit for bit", () => {
    for (const [name, options] of REGIMES) {
      const spring = new SpringDamper(options);
      const current = new Vector3(1, -2, 0.5);
      const target = new Vector3(0, 3, -1);
      const velocity = new Vector3(0.25, 0, -4);
      const out = makeVectorResult();
      spring.updateVector3(current, target, velocity, DT, out);
      for (const axis of ["x", "y", "z"] as const) {
        const scalar = spring.update(
          current[axis],
          target[axis],
          velocity[axis],
          DT,
        );
        expect(out.value[axis], `${name}.${axis}`).toBe(scalar.value);
        expect(out.velocity[axis], `${name}.${axis}`).toBe(scalar.velocity);
      }
    }
  });

  it("updates in place when the out record aliases the inputs", () => {
    const spring = new SpringDamper({ frequencyHz: 2, dampingRatio: 1 });
    const value = new Vector3(1, -2, 0.5);
    const velocity = new Vector3(0.25, 0, -4);
    const target = new Vector3(0, 3, -1);
    const aliased: SpringDamperVector3Result = { value, velocity };
    const reference = spring.updateVector3(
      value.clone(),
      target,
      velocity.clone(),
      DT,
      makeVectorResult(),
    );
    spring.updateVector3(value, target, velocity, DT, aliased);
    expect(aliased.value).toBe(value);
    expect(value.x).toBe(reference.value.x);
    expect(value.y).toBe(reference.value.y);
    expect(value.z).toBe(reference.value.z);
    expect(velocity.x).toBe(reference.velocity.x);
    expect(velocity.y).toBe(reference.velocity.y);
    expect(velocity.z).toBe(reference.velocity.z);
  });

  it("allocates nothing when `out` is supplied", () => {
    const spring = new SpringDamper({ frequencyHz: 2, dampingRatio: 0.4 });
    const current = new Vector3(1, 2, 3);
    const target = new Vector3(0, 0, 0);
    const velocity = new Vector3();
    const out = makeVectorResult();
    const scalarOut = makeResult();
    resetConstructionCount();
    for (let step = 0; step < 100; step += 1) {
      spring.updateVector3(current, target, velocity, DT, out);
      spring.update(current.x, target.x, velocity.x, DT, scalarOut);
    }
    expect(constructionCount()).toBe(0);
  });

  it("allocates a fresh record when `out` is omitted", () => {
    const spring = new SpringDamper({ frequencyHz: 2, dampingRatio: 0.4 });
    const first = spring.updateVector3(
      new Vector3(1, 0, 0),
      new Vector3(),
      new Vector3(),
      DT,
    );
    const second = spring.updateVector3(
      new Vector3(1, 0, 0),
      new Vector3(),
      new Vector3(),
      DT,
    );
    expect(first.value).not.toBe(second.value);
    expect(first.value.x).toBe(second.value.x);
    const scalar = spring.update(1, 0, 0, DT);
    expect(scalar.value).toBe(first.value.x);
  });
});

describe("step caching", () => {
  it("is unaffected by the order in which step sizes arrive", () => {
    const cached = new SpringDamper({ frequencyHz: 2, dampingRatio: 0.3 });
    const fresh = new SpringDamper({ frequencyHz: 2, dampingRatio: 0.3 });
    const deltas = [DT, DT, 0.05, DT, 0.05, 0.05];
    for (const dt of deltas) {
      const reused = cached.update(0.2, 1, -0.5, dt);
      const clean = new SpringDamper({
        frequencyHz: 2,
        dampingRatio: 0.3,
      }).update(0.2, 1, -0.5, dt);
      expect(reused.value).toBe(clean.value);
      expect(reused.velocity).toBe(clean.velocity);
    }
    expect(fresh.update(0.2, 1, -0.5, DT).value).toBe(
      cached.update(0.2, 1, -0.5, DT).value,
    );
  });
});

describe("deltaSeconds validation", () => {
  const spring = new SpringDamper({ frequencyHz: 2, dampingRatio: 1 });

  it.each([0, -DT, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects deltaSeconds %p",
    (dt) => {
      expect(() => spring.update(0, 1, 0, dt)).toThrow(RangeError);
      expect(() =>
        spring.updateVector3(new Vector3(), new Vector3(), new Vector3(), dt),
      ).toThrow(/finite positive number of seconds/);
    },
  );
});
