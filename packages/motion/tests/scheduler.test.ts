import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_FIXED_DELTA_TIME,
  DEFAULT_MAXIMUM_SUB_STEPS,
  copyTimeState,
  createTimeState,
  type Clock,
  type ReadonlyClock,
  type ReadonlyTimeState,
  type TimeState,
} from "../src/clock.js";
import { Scheduler } from "../src/scheduler.js";

const FIXED = DEFAULT_FIXED_DELTA_TIME;

/** Everything a `step` call can be observed to have done, in invocation order. */
interface Recording {
  readonly scheduler: Scheduler;
  /** One snapshot per callback invocation, tagged with the callback name. */
  readonly calls: { readonly kind: string; readonly time: TimeState }[];
  /** Callback names in invocation order. */
  order(): string[];
}

function record(
  options: {
    fixedDeltaTime?: number;
    maximumSubSteps?: number;
  } = {},
): Recording {
  const calls: { kind: string; time: TimeState }[] = [];
  const capture = (kind: string) => (time: ReadonlyTimeState) => {
    calls.push({ kind, time: copyTimeState(time) });
  };
  const scheduler = new Scheduler({
    ...options,
    onFixedStep: capture("fixedStep"),
    onUpdate: capture("update"),
    onRender: capture("render"),
  });
  return {
    scheduler,
    calls,
    order: () => calls.map((call) => call.kind),
  };
}

/** Deterministic pseudo-random elapsed times — no `Math.random` (§33). */
function* lcgElapsed(seed: number, count: number): Generator<number> {
  let state = seed >>> 0;
  for (let index = 0; index < count; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    // 0 … ~0.28 s: covers sub-step frames, multi-step frames, and clamp frames.
    yield (state / 0x100000000) * 0.28;
  }
}

describe("createTimeState (§9)", () => {
  it("starts every clock and counter at zero, unpaused, at scale 1", () => {
    expect(createTimeState()).toEqual({
      realTime: 0,
      renderTime: 0,
      simulationTime: 0,
      deltaTime: 0,
      unscaledDeltaTime: 0,
      fixedDeltaTime: FIXED,
      timeScale: 1,
      paused: false,
      interpolationAlpha: 0,
      frame: 0,
      simulationStep: 0,
      droppedTime: 0,
    } satisfies TimeState);
  });

  it("Clock is TimeState under §9's public name (PH-22l)", () => {
    const state: TimeState = createTimeState();
    const clock: Clock = state;
    const back: TimeState = clock;
    const readonlyClock: ReadonlyClock = state;
    const readonlyState: ReadonlyTimeState = readonlyClock;
    expect(clock).toBe(state);
    expect(back).toBe(state);
    expect(readonlyState).toBe(state);
  });

  it("uses the Appendix A defaults", () => {
    expect(DEFAULT_FIXED_DELTA_TIME).toBe(1 / 60);
    expect(DEFAULT_MAXIMUM_SUB_STEPS).toBe(5);
  });

  it("rejects a non-positive or non-finite fixed step", () => {
    expect(() => createTimeState({ fixedDeltaTime: 0 })).toThrow(RangeError);
    expect(() => createTimeState({ fixedDeltaTime: -1 / 60 })).toThrow(
      RangeError,
    );
    expect(() => createTimeState({ fixedDeltaTime: Number.NaN })).toThrow(
      RangeError,
    );
    expect(() =>
      createTimeState({ fixedDeltaTime: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
  });

  it("copies every field, with and without an `out` record", () => {
    const source = createTimeState({ fixedDeltaTime: 1 / 120, timeScale: 0.5 });
    source.realTime = 3;
    source.frame = 7;
    source.droppedTime = 0.25;

    const allocated = copyTimeState(source);
    expect(allocated).toEqual(source);
    expect(allocated).not.toBe(source);

    const out = createTimeState();
    expect(copyTimeState(source, out)).toBe(out);
    expect(out).toEqual(source);
  });
});

describe("Scheduler construction (§10, Appendix A)", () => {
  it("defaults to the Appendix A fixed step and substep clamp", () => {
    const scheduler = new Scheduler();
    expect(scheduler.fixedDeltaTime).toBe(1 / 60);
    expect(scheduler.maximumSubSteps).toBe(5);
    expect(scheduler.timeScale).toBe(1);
    expect(scheduler.paused).toBe(false);
    expect(scheduler.accumulator).toBe(0);
    expect(scheduler.time.frame).toBe(0);
  });

  it("rejects an invalid fixed step or substep clamp", () => {
    expect(() => new Scheduler({ fixedDeltaTime: 0 })).toThrow(RangeError);
    expect(() => new Scheduler({ maximumSubSteps: 0 })).toThrow(RangeError);
    expect(() => new Scheduler({ maximumSubSteps: 2.5 })).toThrow(RangeError);
    expect(() => new Scheduler({ maximumSubSteps: -1 })).toThrow(RangeError);
  });

  it("rejects an invalid elapsed time and an invalid time scale", () => {
    const scheduler = new Scheduler();
    expect(() => scheduler.step(-0.001)).toThrow(RangeError);
    expect(() => scheduler.step(Number.NaN)).toThrow(RangeError);
    expect(() => scheduler.step(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => {
      scheduler.timeScale = -1;
    }).toThrow(RangeError);
    expect(() => {
      scheduler.timeScale = Number.NaN;
    }).toThrow(RangeError);
  });

  it("runs with no callbacks attached", () => {
    const scheduler = new Scheduler();
    expect(() => scheduler.step(FIXED)).not.toThrow();
    expect(scheduler.time.simulationStep).toBe(1);
  });
});

describe("Scheduler stepping at exact fixed-step multiples (§10)", () => {
  it("runs exactly one fixed step for one fixed delta, leaving alpha at 0", () => {
    const run = record();
    run.scheduler.step(FIXED);

    expect(run.order()).toEqual(["fixedStep", "update", "render"]);
    expect(run.scheduler.time.simulationStep).toBe(1);
    expect(run.scheduler.time.simulationTime).toBeCloseTo(FIXED, 15);
    expect(run.scheduler.time.frame).toBe(1);
    expect(run.scheduler.time.interpolationAlpha).toBeCloseTo(0, 15);
    expect(run.scheduler.time.droppedTime).toBe(0);
  });

  it("runs n fixed steps for n fixed deltas in one frame", () => {
    const run = record();
    run.scheduler.step(3 * FIXED);

    expect(run.order()).toEqual([
      "fixedStep",
      "fixedStep",
      "fixedStep",
      "update",
      "render",
    ]);
    expect(run.scheduler.time.simulationStep).toBe(3);
    expect(run.scheduler.time.simulationTime).toBeCloseTo(3 * FIXED, 15);
    expect(run.scheduler.fixedStepsLastFrame).toBe(3);
    expect(run.scheduler.time.droppedTime).toBe(0);
  });

  it("advances simulationStep and simulationTime before each fixed-step callback", () => {
    const run = record();
    run.scheduler.step(3 * FIXED);

    const steps = run.calls.filter((call) => call.kind === "fixedStep");
    expect(steps.map((call) => call.time.simulationStep)).toEqual([1, 2, 3]);
    expect(steps.map((call) => call.time.simulationTime)).toEqual([
      FIXED,
      FIXED + FIXED,
      FIXED + FIXED + FIXED,
    ]);
  });

  it("advances frame once per step call, whether or not a fixed step runs", () => {
    const scheduler = new Scheduler();
    scheduler.step(0);
    scheduler.step(FIXED / 4);
    scheduler.step(FIXED);
    expect(scheduler.time.frame).toBe(3);
    expect(scheduler.time.simulationStep).toBe(1);
  });

  it("keeps realTime unscaled while renderTime follows the scaled delta", () => {
    const scheduler = new Scheduler();
    scheduler.timeScale = 0.5;
    scheduler.step(0.1);
    scheduler.step(0.1);

    expect(scheduler.time.realTime).toBeCloseTo(0.2, 15);
    expect(scheduler.time.renderTime).toBeCloseTo(0.1, 15);
    expect(scheduler.time.unscaledDeltaTime).toBeCloseTo(0.1, 15);
    expect(scheduler.time.deltaTime).toBeCloseTo(0.05, 15);
  });
});

describe("Fractional accumulation and interpolation alpha (§10)", () => {
  it("accumulates fractional frames and reports alpha as the leftover fraction", () => {
    const run = record();

    run.scheduler.step(FIXED / 2);
    expect(run.scheduler.time.simulationStep).toBe(0);
    expect(run.scheduler.time.interpolationAlpha).toBeCloseTo(0.5, 12);
    expect(run.order()).toEqual(["update", "render"]);

    run.scheduler.step(FIXED / 2);
    expect(run.scheduler.time.simulationStep).toBe(1);
    expect(run.scheduler.time.interpolationAlpha).toBeCloseTo(0, 12);
    expect(run.order()).toEqual([
      "update",
      "render",
      "fixedStep",
      "update",
      "render",
    ]);
  });

  it("computes alpha as accumulator / fixedDeltaTime after the steps of the frame", () => {
    const scheduler = new Scheduler();
    // 1.5 fixed deltas: one step runs, half a delta remains.
    scheduler.step(1.5 * FIXED);
    expect(scheduler.time.simulationStep).toBe(1);
    expect(scheduler.accumulator).toBeCloseTo(0.5 * FIXED, 12);
    expect(scheduler.time.interpolationAlpha).toBeCloseTo(0.5, 12);

    // A quarter more: still no step, alpha 0.75.
    scheduler.step(0.25 * FIXED);
    expect(scheduler.time.simulationStep).toBe(1);
    expect(scheduler.time.interpolationAlpha).toBeCloseTo(0.75, 12);
  });

  it("keeps alpha in [0, 1] across a long deterministic sequence of ragged frames", () => {
    const alphas: number[] = [];
    const scheduler = new Scheduler({
      onUpdate: (time) => alphas.push(time.interpolationAlpha),
    });
    for (const elapsed of lcgElapsed(0x9e3779b9, 500)) {
      scheduler.step(elapsed);
    }

    expect(alphas).toHaveLength(500);
    for (const alpha of alphas) {
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(1);
    }
    // The sequence is long enough to have exercised the clamp at least once.
    expect(scheduler.time.droppedTime).toBeGreaterThan(0);
  });
});

describe("Substep clamp (§10)", () => {
  it("executes exactly maximumSubSteps fixed steps and drops the exact excess", () => {
    const run = record();
    run.scheduler.step(1);

    expect(run.calls.filter((call) => call.kind === "fixedStep")).toHaveLength(
      5,
    );
    expect(run.scheduler.fixedStepsLastFrame).toBe(5);
    expect(run.scheduler.time.simulationStep).toBe(5);

    // Reproduce §10's arithmetic exactly: the accumulator is decremented once
    // per step, then everything above one fixed delta is dropped.
    let accumulator = 1;
    for (let step = 0; step < DEFAULT_MAXIMUM_SUB_STEPS; step += 1) {
      accumulator -= FIXED;
    }
    const expectedDropped = accumulator - FIXED;

    expect(run.scheduler.time.droppedTime).toBeCloseTo(expectedDropped, 15);
    expect(
      Math.abs(run.scheduler.time.droppedTime - expectedDropped),
    ).toBeLessThan(1e-12);
    // 1 s − 6 × (1/60) = 0.9 s of simulation time discarded.
    expect(run.scheduler.time.droppedTime).toBeCloseTo(0.9, 12);
    expect(run.scheduler.time.simulationTime).toBeCloseTo(5 * FIXED, 12);
  });

  it("leaves the accumulator at exactly one fixed delta, so alpha is 1 after a clamp", () => {
    const scheduler = new Scheduler();
    scheduler.step(1);

    expect(scheduler.accumulator).toBe(FIXED);
    expect(scheduler.time.interpolationAlpha).toBe(1);
  });

  it("consumes the clamped leftover on the following frame", () => {
    const run = record();
    run.scheduler.step(1);
    const droppedAfterFirst = run.scheduler.time.droppedTime;
    run.calls.length = 0;

    run.scheduler.step(0);
    expect(run.order()).toEqual(["fixedStep", "update", "render"]);
    expect(run.scheduler.time.simulationStep).toBe(6);
    expect(run.scheduler.time.interpolationAlpha).toBe(0);
    expect(run.scheduler.time.droppedTime).toBe(droppedAfterFirst);
  });

  it("accumulates droppedTime across successive long frames", () => {
    const scheduler = new Scheduler();
    scheduler.step(1);
    const first = scheduler.time.droppedTime;
    scheduler.step(1);
    const second = scheduler.time.droppedTime;

    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    // The second long frame starts with a full leftover delta already banked.
    expect(second - first).toBeCloseTo(first + FIXED, 12);
  });

  it("honours a non-default substep clamp", () => {
    const run = record({ maximumSubSteps: 2 });
    run.scheduler.step(1);

    expect(run.calls.filter((call) => call.kind === "fixedStep")).toHaveLength(
      2,
    );
    expect(run.scheduler.time.interpolationAlpha).toBe(1);
    expect(run.scheduler.time.droppedTime).toBeCloseTo(1 - 3 * FIXED, 12);
  });

  it("does not drop anything when the frame fits inside the clamp", () => {
    const scheduler = new Scheduler();
    scheduler.step(DEFAULT_MAXIMUM_SUB_STEPS * FIXED);
    expect(scheduler.time.simulationStep).toBe(5);
    expect(scheduler.time.droppedTime).toBe(0);
  });
});

describe("Pause (§10)", () => {
  it("freezes accumulation and zeroes deltaTime while update and render continue", () => {
    const run = record();
    run.scheduler.step(FIXED);
    run.calls.length = 0;

    run.scheduler.paused = true;
    run.scheduler.step(0.5);
    run.scheduler.step(0.5);

    expect(run.order()).toEqual(["update", "render", "update", "render"]);
    const time = run.scheduler.time;
    expect(time.simulationStep).toBe(1);
    expect(time.simulationTime).toBeCloseTo(FIXED, 15);
    expect(time.deltaTime).toBe(0);
    expect(time.unscaledDeltaTime).toBe(0.5);
    expect(time.realTime).toBeCloseTo(FIXED + 1, 12);
    expect(time.renderTime).toBeCloseTo(FIXED, 12);
    expect(time.frame).toBe(3);
    expect(run.scheduler.accumulator).toBeCloseTo(0, 15);
    expect(time.droppedTime).toBe(0);
  });

  it("preserves timeScale across pause and resume", () => {
    const scheduler = new Scheduler();
    scheduler.timeScale = 0.25;
    scheduler.paused = true;
    scheduler.step(1);
    expect(scheduler.timeScale).toBe(0.25);
    expect(scheduler.time.deltaTime).toBe(0);

    scheduler.paused = false;
    scheduler.step(4 * FIXED);
    expect(scheduler.timeScale).toBe(0.25);
    expect(scheduler.time.deltaTime).toBeCloseTo(FIXED, 15);
    expect(scheduler.time.simulationStep).toBe(1);
  });

  it("is equivalent to timeScale = 0 in every field except paused and timeScale", () => {
    const paused = new Scheduler();
    const scaledToZero = new Scheduler();
    const elapsedSequence = [...lcgElapsed(0x1234_5678, 60)];

    // Both run normally for a while, then stop simulating by different means.
    for (const elapsed of elapsedSequence.slice(0, 20)) {
      paused.step(elapsed);
      scaledToZero.step(elapsed);
    }
    paused.paused = true;
    scaledToZero.timeScale = 0;
    for (const elapsed of elapsedSequence.slice(20)) {
      paused.step(elapsed);
      scaledToZero.step(elapsed);
    }

    const a = copyTimeState(paused.time);
    const b = copyTimeState(scaledToZero.time);
    expect(a.paused).toBe(true);
    expect(b.paused).toBe(false);
    expect(a.timeScale).toBe(1);
    expect(b.timeScale).toBe(0);

    a.paused = b.paused;
    a.timeScale = b.timeScale;
    expect(a).toEqual(b);
    expect(paused.accumulator).toBe(scaledToZero.accumulator);
  });
});

describe("Time scale (§9)", () => {
  it("halves simulation progress at timeScale 0.5 while real time is unaffected", () => {
    const full = new Scheduler();
    const half = new Scheduler();
    half.timeScale = 0.5;

    for (let frame = 0; frame < 60; frame += 1) {
      full.step(FIXED);
      half.step(FIXED);
    }

    expect(full.time.simulationStep).toBe(60);
    expect(half.time.simulationStep).toBe(30);
    expect(half.time.simulationTime).toBeCloseTo(
      full.time.simulationTime / 2,
      12,
    );
    expect(half.time.realTime).toBeCloseTo(full.time.realTime, 12);
    expect(half.time.droppedTime).toBe(0);
  });

  it("doubles simulation progress at timeScale 2", () => {
    const scheduler = new Scheduler();
    scheduler.timeScale = 2;
    for (let frame = 0; frame < 10; frame += 1) {
      scheduler.step(FIXED);
    }
    expect(scheduler.time.simulationStep).toBe(20);
    expect(scheduler.time.droppedTime).toBe(0);
  });
});

describe("Determinism (§33)", () => {
  it("produces identical TimeState sequences for identical injected elapsed sequences", () => {
    const snapshotsOf = (): TimeState[] => {
      const snapshots: TimeState[] = [];
      const scheduler = new Scheduler();
      scheduler.onFixedStep = (time) => snapshots.push(copyTimeState(time));
      scheduler.onUpdate = (time) => snapshots.push(copyTimeState(time));
      scheduler.onRender = (time) => snapshots.push(copyTimeState(time));
      for (const elapsed of lcgElapsed(0x0bad_c0de, 400)) {
        scheduler.step(elapsed);
        snapshots.push(copyTimeState(scheduler.time));
      }
      return snapshots;
    };

    const first = snapshotsOf();
    const second = snapshotsOf();

    expect(second).toHaveLength(first.length);
    for (let index = 0; index < first.length; index += 1) {
      expect(second[index]).toEqual(first[index]);
    }
  });

  it("reaches the same state whether pause is applied mid-run in either replica", () => {
    const build = (): Scheduler => {
      const scheduler = new Scheduler();
      for (const elapsed of lcgElapsed(0x5eed, 50)) {
        scheduler.paused = scheduler.time.frame % 7 === 0;
        scheduler.step(elapsed);
      }
      return scheduler;
    };

    expect(copyTimeState(build().time)).toEqual(copyTimeState(build().time));
  });
});

describe("Callback contract (plan D4)", () => {
  it("invokes fixed steps first, then update, then render, within one step call", () => {
    const run = record();
    run.scheduler.step(2.5 * FIXED);
    expect(run.order()).toEqual(["fixedStep", "fixedStep", "update", "render"]);
  });

  it("still invokes update and render when no fixed step runs", () => {
    const run = record();
    run.scheduler.step(FIXED / 3);
    expect(run.order()).toEqual(["update", "render"]);
  });

  it("hands every callback the scheduler's live time record", () => {
    const seen: ReadonlyTimeState[] = [];
    const scheduler = new Scheduler({
      onFixedStep: (time) => seen.push(time),
      onUpdate: (time) => seen.push(time),
      onRender: (time) => seen.push(time),
    });
    scheduler.step(FIXED);

    expect(seen).toHaveLength(3);
    for (const time of seen) {
      expect(time).toBe(scheduler.time);
    }
  });

  it("accepts callbacks assigned after construction", () => {
    const scheduler = new Scheduler();
    const onFixedStep = vi.fn();
    scheduler.onFixedStep = onFixedStep;
    scheduler.step(FIXED);
    expect(onFixedStep).toHaveBeenCalledTimes(1);

    scheduler.onFixedStep = undefined;
    scheduler.step(FIXED);
    expect(onFixedStep).toHaveBeenCalledTimes(1);
    expect(scheduler.time.simulationStep).toBe(2);
  });

  it("exposes no events — the scheduler is a plain callback state machine (D4)", () => {
    const scheduler = new Scheduler();
    expect(
      (scheduler as unknown as Record<string, unknown>).on,
    ).toBeUndefined();
    expect(
      (scheduler as unknown as Record<string, unknown>).emit,
    ).toBeUndefined();
  });
});

describe("a throwing fixed step (2026-09-11 audit)", () => {
  it("rolls the step counter and simulation time back with the accumulator it leaves holding", () => {
    let calls = 0;
    const scheduler = new Scheduler({
      fixedDeltaTime: 1 / 60,
      onFixedStep: () => {
        calls += 1;
        if (calls === 1) throw new Error("system failed");
      },
    });
    expect(() => scheduler.step(1 / 60)).toThrow("system failed");
    // The step was not consumed: accumulator still holds one step and the
    // counters the callback saw advanced are back where they were.
    expect(scheduler.accumulator).toBeCloseTo(1 / 60, 12);
    expect(scheduler.time.simulationStep).toBe(0);
    expect(scheduler.time.simulationTime).toBe(0);
    // The next frame re-runs exactly that step.
    scheduler.step(0);
    expect(calls).toBe(2);
    expect(scheduler.time.simulationStep).toBe(1);
    expect(scheduler.accumulator).toBeCloseTo(0, 12);
  });
});
