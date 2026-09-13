/**
 * `ParticleSystem` (§39 step 5, §36, plan WP-9.4) — the fixed-step driver.
 *
 * What this file can and cannot pin, stated up front because the boundary is
 * unusual: the §3.1 dependency matrix keeps `@fourjs/particles` from ever seeing
 * `@fourjs/motion`'s `SimulationSystem`, `FixedUpdateContext` or `PRIORITY_FORCES`
 * (see `src/particle-system.ts`). So this suite pins
 *
 * - the **shape** §39 requires, member by member, and the numeric value of
 *   {@link PRIORITY_PARTICLES};
 * - the **behaviour**: what is stepped, with which delta, with which time, in
 *   which order, and what happens when the tracked set mutates mid-step;
 *
 * and it deliberately does **not** pin that `ParticleSystem` is assignable to
 * `SimulationSystem`, or that `500` is still `PRIORITY_FORCES`. Those are
 * cross-package claims, and `tests/determinism/phase9-particles.test.ts` — which
 * registers this system on a real `Application`'s §39 registry and imports both
 * constants — is the suite that makes them.
 *
 * Most tests drive a **stub** emitter rather than a `ParticleEmitter`: the
 * system's whole contract is "call `step(dt, t)` on these objects, in this
 * order, under these mutation rules", and a stub is what makes the arguments
 * and the order directly observable. The last group then drives a real
 * `ParticleEmitter` and compares its pool, byte for byte, against the same
 * emitter stepped by hand — because "the stub was called correctly" is not the
 * same claim as "the simulation advanced correctly".
 */

import { isFourError } from "@fourjs/core";
import { constructionCount, resetConstructionCount } from "@fourjs/math";
import { describe, expect, it } from "vitest";

import { ParticleEmitter } from "../src/emitter.js";
import { uniformGravityField } from "../src/fields.js";
import {
  PRIORITY_PARTICLES,
  ParticleSystem,
  type ParticleFixedUpdateContext,
  type SteppableEmitter,
} from "../src/particle-system.js";
import { ParticlePool } from "../src/pool.js";

/** Runs `run`, expecting a `FourError` with `INVALID_APPLICATION_STATE` (§83, §89). */
function expectDisposedError(run: () => void): Error {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(isFourError(caught)).toBe(true);
  expect((caught as { code: string }).code).toBe("INVALID_APPLICATION_STATE");
  return caught as Error;
}

/** §45 `fixedTimeStep`, in seconds (§7a: never milliseconds). */
const FIXED_DELTA_TIME = 1 / 60;

/** One recorded `step` call. */
interface StepCall {
  readonly deltaSeconds: number;
  readonly time: number;
}

/** A {@link SteppableEmitter} that records every call instead of simulating. */
class StubEmitter implements SteppableEmitter {
  readonly calls: StepCall[] = [];

  constructor(readonly label: string) {}

  step(deltaSeconds: number, time: number): void {
    this.calls.push({ deltaSeconds, time });
  }
}

/**
 * A §39 fixed-update context for step `step` (1-based), matching the
 * scheduler's own convention: `simulationTime` is advanced **before** the step
 * runs, so step *n* sees `n · fixedDeltaTime`.
 *
 * Carries `timeScale` and a few other `TimeState` fields the system must not
 * read, so "the delta is not scaled twice" is a measurement rather than a
 * reading of the source.
 */
function contextAt(step: number, timeScale = 1): ParticleFixedUpdateContext {
  // Bound to a variable rather than returned as a literal on purpose:
  // TypeScript's excess-property check rejects a *fresh* literal carrying
  // fields the narrow `ParticleStepTime` does not declare, which is exactly
  // what this helper needs to supply — the wider record is the point.
  const time = {
    fixedDeltaTime: FIXED_DELTA_TIME,
    simulationTime: step * FIXED_DELTA_TIME,
    timeScale,
    deltaTime: FIXED_DELTA_TIME * timeScale,
    interpolationAlpha: 0.5,
  };
  return { time };
}

/** Drives `system` for `steps` fixed steps, from step 1. */
function run(system: ParticleSystem, steps: number): void {
  for (let step = 1; step <= steps; step += 1) {
    system.fixedUpdate(contextAt(step));
  }
}

/** A seeded emitter with a §27 field, a ramp, and a collision plane. */
function makeEmitter(): ParticleEmitter {
  return new ParticleEmitter({
    maxParticles: 64,
    seed: 20260802,
    emissionRate: 90,
    bursts: [{ time: 0, count: 8 }],
    lifetime: { min: 0.4, max: 1.2 },
    initialSpeed: { min: 1, max: 4 },
    spreadAngle: Math.PI / 5,
    size: { start: 1.5, end: 0.2 },
    color: {
      start: { r: 1, g: 0.6, b: 0.1, a: 1 },
      end: { r: 0.2, g: 0.1, b: 0.6, a: 0 },
    },
    gravity: undefined,
    fields: [uniformGravityField()],
    collisionPlaneY: -1,
    restitution: 0.4,
  });
}

/** Every live channel of a pool, flattened — the byte-for-byte comparison key. */
function poolState(pool: ParticlePool): readonly number[] {
  const count = pool.aliveCount;
  const state: number[] = [count];
  for (let i = 0; i < count * 3; i += 1) {
    state.push(pool.positions[i], pool.velocities[i]);
  }
  for (let i = 0; i < count; i += 1) {
    state.push(pool.ages[i], pool.lifetimes[i]);
  }
  for (let i = 0; i < count * 2; i += 1) {
    state.push(pool.sizes[i]);
  }
  for (let i = 0; i < count * 8; i += 1) {
    state.push(pool.colors[i]);
  }
  return state;
}

describe("ParticleSystem: the §39 shape and its priority", () => {
  it("has §39's four members, with the documented default priority", () => {
    const system = new ParticleSystem();

    // §39: `priority`, `initialize`, `fixedUpdate`, `dispose`. Structural, by
    // necessity — see the file header.
    expect(typeof system.priority).toBe("number");
    expect(typeof system.initialize).toBe("function");
    expect(typeof system.fixedUpdate).toBe("function");
    expect(typeof system.dispose).toBe("function");

    expect(system.priority).toBe(PRIORITY_PARTICLES);
  });

  it("pins PRIORITY_PARTICLES at §39 step 5 (force generation)", () => {
    // The value `@fourjs/motion` publishes as `PRIORITY_FORCES`. Restated rather
    // than imported (§3.1); the cross-package equality is asserted in
    // tests/determinism/phase9-particles.test.ts.
    expect(PRIORITY_PARTICLES).toBe(500);

    // Strictly between animation targets (300) / kinematics (400) and the
    // physics solve (600) — the ordering claim the module header makes.
    expect(PRIORITY_PARTICLES).toBeGreaterThan(400);
    expect(PRIORITY_PARTICLES).toBeLessThan(600);
  });

  it("accepts an explicit priority and rejects a non-finite one", () => {
    expect(new ParticleSystem({ priority: 510 }).priority).toBe(510);
    expect(new ParticleSystem({ priority: -3.5 }).priority).toBe(-3.5);

    expect(() => new ParticleSystem({ priority: Number.NaN })).toThrow(
      RangeError,
    );
    expect(
      () => new ParticleSystem({ priority: Number.POSITIVE_INFINITY }),
    ).toThrow(/finite/);
  });

  it("initialize is a no-op that tolerates §39's context argument", () => {
    const system = new ParticleSystem();
    // The registry calls `initialize(context)`; this class declares no
    // parameter, so the call must simply ignore the extra argument.
    const initialize = system.initialize.bind(system) as (
      context: unknown,
    ) => void;
    expect(() => {
      initialize({ registry: null });
    }).not.toThrow();
    expect(system.size).toBe(0);
  });
});

describe("ParticleSystem: tracking", () => {
  it("tracks, reports, and untracks emitters", () => {
    const system = new ParticleSystem();
    const a = new StubEmitter("a");
    const b = new StubEmitter("b");

    expect(system.size).toBe(0);
    expect(system.has(a)).toBe(false);

    // `track` returns its argument, so an emitter can be built and tracked in
    // one expression.
    expect(system.track(a)).toBe(a);
    system.track(b);
    expect(system.size).toBe(2);
    expect(system.has(a)).toBe(true);

    expect(system.untrack(a)).toBe(true);
    expect(system.untrack(a)).toBe(false);
    expect(system.size).toBe(1);

    system.clear();
    expect(system.size).toBe(0);
    expect(system.has(b)).toBe(false);
  });

  it("tracking twice keeps one entry at its original position", () => {
    const system = new ParticleSystem();
    const a = new StubEmitter("a");
    const b = new StubEmitter("b");

    system.track(a);
    system.track(b);
    system.track(a);

    expect(system.size).toBe(2);
    expect([...system.emitters]).toEqual([a, b]);

    run(system, 1);
    expect(a.calls).toHaveLength(1);
  });

  it("steps in insertion order (§33: deterministic iteration)", () => {
    const system = new ParticleSystem();
    const order: string[] = [];
    const record = (label: string): SteppableEmitter => ({
      step: () => order.push(label),
    });

    // Deliberately not alphabetical, so a sort would be visible.
    for (const label of ["gamma", "alpha", "beta"]) {
      system.track(record(label));
    }
    run(system, 2);

    expect(order).toEqual(["gamma", "alpha", "beta", "gamma", "alpha", "beta"]);
  });
});

describe("ParticleSystem: what a fixed step passes to an emitter", () => {
  it("passes fixedDeltaTime and the step's simulationTime", () => {
    const system = new ParticleSystem();
    const emitter = new StubEmitter("only");
    system.track(emitter);

    run(system, 3);

    expect(emitter.calls).toEqual([
      { deltaSeconds: FIXED_DELTA_TIME, time: 1 * FIXED_DELTA_TIME },
      { deltaSeconds: FIXED_DELTA_TIME, time: 2 * FIXED_DELTA_TIME },
      { deltaSeconds: FIXED_DELTA_TIME, time: 3 * FIXED_DELTA_TIME },
    ]);
  });

  it("does not scale the delta by timeScale (the scheduler already did)", () => {
    // §10: the accumulator is filled with `elapsedRealTime * timeScale`, so a
    // fixed step is one `fixedDeltaTime` of *scaled* time. Multiplying again
    // would run particles at timeScale².
    const system = new ParticleSystem();
    const emitter = new StubEmitter("only");
    system.track(emitter);

    system.fixedUpdate(contextAt(1, 4));

    expect(emitter.calls[0].deltaSeconds).toBe(FIXED_DELTA_TIME);
  });

  it("steps each tracked emitter exactly once per fixed step", () => {
    const system = new ParticleSystem();
    const a = new StubEmitter("a");
    const b = new StubEmitter("b");
    system.track(a);
    system.track(b);

    run(system, 5);

    expect(a.calls).toHaveLength(5);
    expect(b.calls).toHaveLength(5);
  });
});

describe("ParticleSystem: mutation during a step, and teardown", () => {
  it("skips an emitter untracked during the step it is untracked in", () => {
    const system = new ParticleSystem();
    const victim = new StubEmitter("victim");
    const remover: SteppableEmitter = {
      step: () => {
        system.untrack(victim);
      },
    };

    system.track(remover);
    system.track(victim); // after the remover, so it is reached later in the set

    run(system, 1);

    expect(victim.calls).toHaveLength(0);
    expect(system.has(victim)).toBe(false);
  });

  it("steps an emitter tracked during the step, in the same step", () => {
    const system = new ParticleSystem();
    const late = new StubEmitter("late");
    let added = false;
    const adder: SteppableEmitter = {
      step: () => {
        if (!added) {
          added = true;
          system.track(late);
        }
      },
    };

    system.track(adder);
    run(system, 1);

    // `Set` semantics, documented rather than designed: an entry appended
    // during iteration is visited by that same iteration.
    expect(late.calls).toHaveLength(1);
  });

  it("never auto-untracks a quiet emitter", () => {
    const system = new ParticleSystem();
    // Rate 0, no bursts: nothing is ever alive, and the emitter must survive
    // anyway — one `emit()` away from being busy again.
    const emitter = new ParticleEmitter({ maxParticles: 4, emissionRate: 0 });
    system.track(emitter);

    run(system, 120);

    expect(emitter.particleCount).toBe(0);
    expect(system.has(emitter)).toBe(true);

    emitter.emit(3);
    expect(emitter.particleCount).toBe(3);
  });

  it("dispose drops every emitter without resetting any of them", () => {
    const system = new ParticleSystem();
    const emitter = makeEmitter();
    system.track(emitter);
    run(system, 30);

    const before = emitter.particleCount;
    expect(before).toBeGreaterThan(0);

    system.dispose();

    expect(system.size).toBe(0);
    // The system is a driver, not an owner: the pool is untouched.
    expect(emitter.particleCount).toBe(before);
    expect(emitter.elapsedTime).toBeGreaterThan(0);
  });
});

describe("ParticleSystem: it really advances the simulation", () => {
  it("reproduces a hand-stepped emitter bit for bit", () => {
    const driven = makeEmitter();
    const byHand = makeEmitter();

    const system = new ParticleSystem();
    system.track(driven);
    run(system, 200);

    for (let step = 1; step <= 200; step += 1) {
      byHand.step(FIXED_DELTA_TIME, step * FIXED_DELTA_TIME);
    }

    expect(driven.particleCount).toBeGreaterThan(0);
    expect(driven.emittedCount).toBe(byHand.emittedCount);
    expect(poolState(driven.pool)).toEqual(poolState(byHand.pool));
  });

  it("two systems with equally seeded emitters agree step for step", () => {
    // §33: the RNG stream is per emitter and the iteration order is insertion
    // order, so nothing about being inside a system perturbs the simulation.
    const left = makeEmitter();
    const right = makeEmitter();

    const one = new ParticleSystem();
    const two = new ParticleSystem();
    one.track(left);
    // A decoy ahead of `right`, so the two systems iterate different sets.
    two.track(new StubEmitter("decoy"));
    two.track(right);

    for (let step = 1; step <= 150; step += 1) {
      const context = contextAt(step);
      one.fixedUpdate(context);
      two.fixedUpdate(context);
    }

    expect(poolState(left.pool)).toEqual(poolState(right.pool));
  });

  it("allocates no math objects while stepping (§7b, plan D7)", () => {
    const system = new ParticleSystem();
    system.track(makeEmitter());
    system.track(makeEmitter());
    // Warm up first: the emitters allocate their scratch vectors lazily-free,
    // but the pools and the first spawns are construction-time work.
    run(system, 10);

    resetConstructionCount();
    run(system, 300);

    expect(constructionCount()).toBe(0);
  });
});

describe("ParticleSystem disposal (§83 stability audit, 2026-09-11)", () => {
  it("disposes idempotently and refuses tracking and stepping afterwards", () => {
    const system = new ParticleSystem();
    const emitter = new StubEmitter("a");
    expect(system.disposed).toBe(false);
    system.track(emitter);
    expect(system.size).toBe(1);

    system.dispose();
    expect(system.disposed).toBe(true);
    expect(system.size).toBe(0);
    // A second dispose is a no-op (§83: idempotent), not an error.
    expect(() => system.dispose()).not.toThrow();
    expect(system.disposed).toBe(true);

    // Disposal is terminal (§83): the mutating entry points refuse with §89's
    // INVALID_APPLICATION_STATE instead of silently working on a dead system.
    expect(expectDisposedError(() => system.track(emitter)).message).toMatch(
      /ParticleSystem is disposed.*§83/s,
    );
    expectDisposedError(() => system.fixedUpdate(contextAt(1)));
    expect(system.size).toBe(0);
    // Reads stay answerable, so teardown code can still inspect the system.
    expect(system.has(emitter)).toBe(false);
  });
});
