import {
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@fourjs/math";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_INTEGRATOR,
  INTEGRATORS,
  explicitEuler,
  rk2,
  rk4,
  semiImplicitEuler,
  velocityVerlet,
  type AccelerationFn,
  type Integrator,
  type IntegratorFn,
  type IntegratorState,
} from "../src/integrators.js";

const DT = 1 / 60;

/** Every §38 name paired with its function, for table-driven tests. */
const ALL: readonly (readonly [Integrator, IntegratorFn])[] = [
  ["explicit-euler", explicitEuler],
  ["semi-implicit-euler", semiImplicitEuler],
  ["velocity-verlet", velocityVerlet],
  ["rk2", rk2],
  ["rk4", rk4],
];

function makeState(position: Vector3, velocity: Vector3): IntegratorState {
  return { position, velocity };
}

/** Runs `steps` steps from `t = 0`, returning the mutated state. */
function run(
  integrator: IntegratorFn,
  state: IntegratorState,
  acceleration: AccelerationFn,
  steps: number,
  dt = DT,
): IntegratorState {
  for (let i = 0; i < steps; i += 1) {
    integrator(state, acceleration, i * dt, dt);
  }
  return state;
}

describe("§38 integrator set", () => {
  it("exposes exactly the five §38 names", () => {
    expect(Object.keys(INTEGRATORS)).toEqual([
      "explicit-euler",
      "semi-implicit-euler",
      "velocity-verlet",
      "rk2",
      "rk4",
    ]);
  });

  it("maps each name to its exported function and is frozen", () => {
    for (const [name, fn] of ALL) {
      expect(INTEGRATORS[name]).toBe(fn);
    }
    expect(Object.isFrozen(INTEGRATORS)).toBe(true);
  });

  it("defaults to semi-implicit Euler (§38 recommendation)", () => {
    expect(DEFAULT_INTEGRATOR).toBe("semi-implicit-euler");
    expect(INTEGRATORS[DEFAULT_INTEGRATOR]).toBe(semiImplicitEuler);
  });
});

describe("constant acceleration (analytic)", () => {
  const x0 = new Vector3(1, 2, 3);
  const v0 = new Vector3(0.5, 3, -1);
  const a = new Vector3(1, -2, 0.5);
  const acceleration: AccelerationFn = (_state, _t, out) =>
    out.set(a.x, a.y, a.z);
  const steps = 60;
  const t = steps * DT;

  /** Exact position of `x'' = a` at time `t`. */
  function exactPosition(component: "x" | "y" | "z"): number {
    return x0[component] + v0[component] * t + 0.5 * a[component] * t * t;
  }

  it("integrates the velocity exactly for every integrator", () => {
    for (const [name, fn] of ALL) {
      const state = run(
        fn,
        makeState(x0.clone(), v0.clone()),
        acceleration,
        steps,
      );
      expect(state.velocity.x, name).toBeCloseTo(v0.x + a.x * t, 12);
      expect(state.velocity.y, name).toBeCloseTo(v0.y + a.y * t, 12);
      expect(state.velocity.z, name).toBeCloseTo(v0.z + a.z * t, 12);
    }
  });

  it("velocity-verlet, rk2 and rk4 hit the exact position", () => {
    for (const [name, fn] of [ALL[2], ALL[3], ALL[4]]) {
      const state = run(
        fn,
        makeState(x0.clone(), v0.clone()),
        acceleration,
        steps,
      );
      expect(state.position.x, name).toBeCloseTo(exactPosition("x"), 12);
      expect(state.position.y, name).toBeCloseTo(exactPosition("y"), 12);
      expect(state.position.z, name).toBeCloseTo(exactPosition("z"), 12);
    }
  });

  it("explicit euler lags the exact position by 0.5·a·t·dt", () => {
    const state = run(
      explicitEuler,
      makeState(x0.clone(), v0.clone()),
      acceleration,
      steps,
    );
    expect(state.position.x).toBeCloseTo(
      exactPosition("x") - 0.5 * a.x * t * DT,
      12,
    );
    expect(state.position.y).toBeCloseTo(
      exactPosition("y") - 0.5 * a.y * t * DT,
      12,
    );
    expect(state.position.z).toBeCloseTo(
      exactPosition("z") - 0.5 * a.z * t * DT,
      12,
    );
  });

  it("semi-implicit euler leads the exact position by 0.5·a·t·dt", () => {
    const state = run(
      semiImplicitEuler,
      makeState(x0.clone(), v0.clone()),
      acceleration,
      steps,
    );
    expect(state.position.x).toBeCloseTo(
      exactPosition("x") + 0.5 * a.x * t * DT,
      12,
    );
    expect(state.position.y).toBeCloseTo(
      exactPosition("y") + 0.5 * a.y * t * DT,
      12,
    );
    expect(state.position.z).toBeCloseTo(
      exactPosition("z") + 0.5 * a.z * t * DT,
      12,
    );
  });

  it("integrates one step of free fall under gravity (§7a: -Y)", () => {
    const state = makeState(new Vector3(), new Vector3());
    semiImplicitEuler(state, (_s, _t, out) => out.set(0, -9.81, 0), 0, DT);
    expect(state.velocity.y).toBeCloseTo(-9.81 * DT, 12);
    expect(state.position.y).toBeCloseTo(-9.81 * DT * DT, 12);
  });
});

describe("energy behaviour on an undamped spring", () => {
  const STIFFNESS = 100;
  const acceleration: AccelerationFn = (state, _t, out) =>
    out.set(
      -STIFFNESS * state.position.x,
      -STIFFNESS * state.position.y,
      -STIFFNESS * state.position.z,
    );

  /** Total energy of a unit mass on a spring of stiffness `STIFFNESS`. */
  function energy(state: IntegratorState): number {
    return (
      0.5 * state.velocity.lengthSq() +
      0.5 * STIFFNESS * state.position.lengthSq()
    );
  }

  /** Final-to-initial energy ratio after `steps` steps at 60 Hz. */
  function energyRatio(fn: IntegratorFn, steps: number): number {
    const state = makeState(new Vector3(1, 0, 0), new Vector3());
    const initial = energy(state);
    run(fn, state, acceleration, steps);
    return energy(state) / initial;
  }

  it("explicit euler gains energy without bound", () => {
    // 5 s, then 50 s: the growth is exponential, not a bounded wobble.
    expect(energyRatio(explicitEuler, 300)).toBeGreaterThan(2);
    expect(energyRatio(explicitEuler, 3000)).toBeGreaterThan(
      1000 * energyRatio(explicitEuler, 300),
    );
  });

  it("semi-implicit euler keeps energy bounded", () => {
    // Symplectic: the energy wobbles by O(stiffness·dt²) ≈ 3 % forever, rather
    // than drifting — the 50 s run stays in the same band as the 5 s run.
    for (const steps of [300, 3000, 30_000]) {
      const ratio = energyRatio(semiImplicitEuler, steps);
      expect(ratio, `${String(steps)} steps`).toBeGreaterThan(0.9);
      expect(ratio, `${String(steps)} steps`).toBeLessThan(1.1);
    }
  });

  it("orders the drift: explicit euler ≫ semi-implicit euler (§38)", () => {
    const explicitDrift = Math.abs(energyRatio(explicitEuler, 300) - 1);
    const semiImplicitDrift = Math.abs(energyRatio(semiImplicitEuler, 300) - 1);
    expect(explicitDrift).toBeGreaterThan(semiImplicitDrift);
    expect(explicitDrift).toBeGreaterThan(10 * semiImplicitDrift);
  });

  it("velocity-verlet is bounded and rk4 is near-conservative", () => {
    for (const steps of [300, 3000, 30_000]) {
      const ratio = energyRatio(velocityVerlet, steps);
      expect(ratio, `${String(steps)} steps`).toBeGreaterThan(0.99);
      expect(ratio, `${String(steps)} steps`).toBeLessThan(1.01);
    }
    expect(energyRatio(rk4, 300)).toBeCloseTo(1, 3);
  });

  it("rk4 tracks the analytic oscillation over one period", () => {
    const omega = Math.sqrt(STIFFNESS);
    const period = (2 * Math.PI) / omega;
    const steps = 600;
    const dt = period / steps;
    const state = makeState(new Vector3(1, 0, 0), new Vector3());
    run(rk4, state, acceleration, steps, dt);
    expect(state.position.x).toBeCloseTo(1, 8);
    expect(state.velocity.x).toBeCloseTo(0, 6);
  });
});

describe("velocity-dependent acceleration", () => {
  // Pure drag: v' = -c·v, so v(t) = v0·e^(-c·t) with no closed-form coupling to
  // position — the cleanest check that the state handed to the callback carries
  // the right velocity at each evaluation point.
  const DRAG = 3;
  const acceleration: AccelerationFn = (state, _t, out) =>
    out.set(
      -DRAG * state.velocity.x,
      -DRAG * state.velocity.y,
      -DRAG * state.velocity.z,
    );

  it("rk4 matches the exponential decay", () => {
    const state = run(
      rk4,
      makeState(new Vector3(), new Vector3(4, 0, 0)),
      acceleration,
      60,
    );
    expect(state.velocity.x).toBeCloseTo(4 * Math.exp(-DRAG), 7);
  });

  it("first-order euler is visibly less accurate than rk4", () => {
    const exact = 4 * Math.exp(-DRAG);
    const euler = run(
      semiImplicitEuler,
      makeState(new Vector3(), new Vector3(4, 0, 0)),
      acceleration,
      60,
    );
    expect(Math.abs(euler.velocity.x - exact)).toBeGreaterThan(1e-3);
  });
});

describe("evaluation points", () => {
  /** Absolute times at which each integrator asks for the acceleration. */
  function times(fn: IntegratorFn): number[] {
    const seen: number[] = [];
    const state = makeState(new Vector3(), new Vector3(1, 0, 0));
    fn(
      state,
      (_s, t, out) => {
        seen.push(t);
        return out.set(0, 0, 0);
      },
      10,
      0.5,
    );
    return seen;
  }

  it("uses the tableau's times", () => {
    expect(times(explicitEuler)).toEqual([10]);
    expect(times(semiImplicitEuler)).toEqual([10]);
    expect(times(velocityVerlet)).toEqual([10, 10.5]);
    expect(times(rk2)).toEqual([10, 10.25]);
    expect(times(rk4)).toEqual([10, 10.25, 10.25, 10.5]);
  });
});

describe("allocation and callback contract", () => {
  it("allocates nothing per step (the callback writes into `out`)", () => {
    for (const [name, fn] of ALL) {
      const state = makeState(new Vector3(1, 0, 0), new Vector3());
      const acceleration: AccelerationFn = (s, _t, out) =>
        out.set(-s.position.x, -s.position.y, -s.position.z);
      // Warm up first: the module scratch is allocated on import, but the state
      // vectors above are constructed here.
      fn(state, acceleration, 0, DT);
      resetConstructionCount();
      for (let i = 0; i < 10; i += 1) {
        fn(state, acceleration, i * DT, DT);
      }
      expect(constructionCount(), name).toBe(0);
    }
  });

  it("accepts a callback that returns a vector other than `out`", () => {
    const stored = new Vector3(0, -9.81, 0);
    for (const [name, fn] of ALL) {
      const state = makeState(new Vector3(), new Vector3());
      run(fn, state, () => stored, 60);
      expect(state.velocity.y, name).toBeCloseTo(-9.81, 10);
    }
  });

  it("fires the change hook of hooked state vectors once per component", () => {
    let positionWrites = 0;
    let velocityWrites = 0;
    const position = new Vector3();
    const velocity = new Vector3();
    position.onChanged = () => {
      positionWrites += 1;
    };
    velocity.onChanged = () => {
      velocityWrites += 1;
    };
    velocityVerlet(
      makeState(position, velocity),
      (_s, _t, out) => out.set(0, -9.81, 0),
      0,
      DT,
    );
    expect(positionWrites).toBe(1);
    expect(velocityWrites).toBe(1);
  });

  it("is a no-op for dt = 0", () => {
    for (const [name, fn] of ALL) {
      const state = makeState(new Vector3(1, 2, 3), new Vector3(4, 5, 6));
      fn(state, (_s, _t, out) => out.set(7, 8, 9), 0, 0);
      expect(state.position.equalsApprox(new Vector3(1, 2, 3)), name).toBe(
        true,
      );
      expect(state.velocity.equalsApprox(new Vector3(4, 5, 6)), name).toBe(
        true,
      );
    }
  });

  it("reproduces the same trajectory when run twice (§33)", () => {
    const acceleration: AccelerationFn = (s, t, out) =>
      out.set(-s.position.x, Math.sin(t) - 0.1 * s.velocity.y, 0);
    for (const [name, fn] of ALL) {
      const first = run(
        fn,
        makeState(new Vector3(1, 0, 0), new Vector3(0, 1, 0)),
        acceleration,
        120,
      );
      const second = run(
        fn,
        makeState(new Vector3(1, 0, 0), new Vector3(0, 1, 0)),
        acceleration,
        120,
      );
      expect(second.position.x, name).toBe(first.position.x);
      expect(second.position.y, name).toBe(first.position.y);
      expect(second.velocity.y, name).toBe(first.velocity.y);
    }
  });
});
