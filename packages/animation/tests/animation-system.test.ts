import { isFourError } from "@fourjs/core";
import { Vector3 } from "@fourjs/math";
import {
  DEFAULT_FIXED_DELTA_TIME,
  MotionComponent,
  MotionSystem,
  PRIORITY_ANIMATION_TARGETS,
  PRIORITY_KINEMATICS,
  Scheduler,
  SystemRegistry,
  createTimeState,
  type FixedUpdateContext,
  type ReadonlyTimeState,
} from "@fourjs/motion";
import { Group, Node } from "@fourjs/scene";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AnimationSystem,
  type Advanceable,
  type AnimationPlaybackState,
} from "../src/animation-system.js";
import { AnimationClip } from "../src/clip.js";
import { AnimationMixer } from "../src/mixer.js";
import { Timeline } from "../src/timeline.js";
import { AnimationTrack } from "../src/track.js";
import { numberAdapter } from "../src/values.js";
import { animate, tween } from "../src/tween.js";

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

const DT = DEFAULT_FIXED_DELTA_TIME;

/** A node with a non-transform numeric property to animate. */
class Widget extends Node {
  opacity = 1;
}

/** A `FixedUpdateContext` whose time record has the default fixed step. */
function makeContext(fixedDeltaTime = DT): FixedUpdateContext {
  const time: ReadonlyTimeState = createTimeState({ fixedDeltaTime });
  return { time };
}

/**
 * A three-line `Advanceable` — the point of the structural interface: the
 * system needs nothing from a player but a delta and two flags.
 */
class Recorder implements Advanceable {
  state: AnimationPlaybackState = "running";
  finished = false;
  readonly deltas: number[] = [];

  constructor(
    readonly name: string,
    private readonly log: string[] = [],
  ) {}

  advance(deltaSeconds: number): this {
    this.deltas.push(deltaSeconds);
    this.log.push(this.name);
    return this;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// §39 registration
// ---------------------------------------------------------------------------

describe("AnimationSystem — §39 system contract", () => {
  it("defaults to the §39 animation-target priority, below kinematics", () => {
    const system = new AnimationSystem();

    expect(system.priority).toBe(PRIORITY_ANIMATION_TARGETS);
    expect(system.priority).toBeLessThan(PRIORITY_KINEMATICS);
    expect(new AnimationSystem({ priority: 42 }).priority).toBe(42);
  });

  it("registers, initializes, and disposes through the registry", () => {
    const registry = new SystemRegistry();
    const system = new AnimationSystem();
    const item = system.track(new Recorder("a"));

    const unregister = registry.register(system);
    expect(registry.has(system)).toBe(true);
    registry.runFixedStep(createTimeState());
    expect(item.deltas).toEqual([DT]);

    unregister();
    expect(registry.has(system)).toBe(false);
    // dispose() drops the tracked players without stopping them.
    expect(system.size).toBe(0);
    expect(item.state).toBe("running");
  });

  it("tracks, untracks, and reports its set in insertion order", () => {
    const system = new AnimationSystem();
    const first = new Recorder("first");
    const second = new Recorder("second");

    expect(system.track(first)).toBe(first);
    system.track(second);
    system.track(first); // idempotent, keeps its place

    expect(system.size).toBe(2);
    expect(system.has(first)).toBe(true);
    expect([...system.items]).toEqual([first, second]);

    expect(system.untrack(first)).toBe(true);
    expect(system.untrack(first)).toBe(false);
    expect(system.size).toBe(1);

    system.clear();
    expect(system.size).toBe(0);
    expect(system.has(second)).toBe(false);
  });

  it("advances every tracked player in insertion order with the fixed delta", () => {
    const log: string[] = [];
    const system = new AnimationSystem();
    system.track(new Recorder("a", log));
    system.track(new Recorder("b", log));
    system.track(new Recorder("c", log));

    system.initialize();
    system.fixedUpdate(makeContext());
    system.fixedUpdate(makeContext());

    expect(log).toEqual(["a", "b", "c", "a", "b", "c"]);
    expect([...system.items].map((item) => (item as Recorder).deltas)).toEqual([
      [DT, DT],
      [DT, DT],
      [DT, DT],
    ]);
  });

  it("uses the context's fixed delta, whatever it is", () => {
    const system = new AnimationSystem();
    const item = system.track(new Recorder("a"));

    system.fixedUpdate(makeContext(1 / 120));

    expect(item.deltas).toEqual([1 / 120]);
  });
});

// ---------------------------------------------------------------------------
// Auto-untracking (WP-4.6 decision)
// ---------------------------------------------------------------------------

describe("AnimationSystem — auto-untracking", () => {
  it("drops players that finished or stopped, and keeps paused and idle ones", () => {
    const system = new AnimationSystem();
    const finished = new Recorder("finished");
    const stopped = new Recorder("stopped");
    const paused = new Recorder("paused");
    const idle = new Recorder("idle");
    system.track(finished);
    system.track(stopped);
    system.track(paused);
    system.track(idle);
    finished.state = "finished";
    finished.finished = true;
    stopped.state = "stopped";
    paused.state = "paused";
    idle.state = "idle";

    system.fixedUpdate(makeContext());

    // Every tracked player is advanced once, including in the step that drops it.
    expect(finished.deltas).toEqual([DT]);
    expect(stopped.deltas).toEqual([DT]);
    expect([...system.items]).toEqual([paused, idle]);

    system.fixedUpdate(makeContext());
    expect(finished.deltas).toEqual([DT]);
    expect(paused.deltas).toEqual([DT, DT]);
  });

  it("drops a tween the step itself finishes, without stopping it", () => {
    const target = { x: 0 };
    const system = new AnimationSystem();
    const subject = system.track(
      animate(target)
        .to({ x: 1 }, 2 * DT)
        .play(),
    );

    system.fixedUpdate(makeContext());
    expect(system.has(subject)).toBe(true);

    system.fixedUpdate(makeContext());
    expect(subject.finished).toBe(true);
    expect(subject.state).toBe("finished");
    expect(system.has(subject)).toBe(false);
    expect(target.x).toBe(1);
  });

  it("does not advance a player untracked by another player's callback", () => {
    const system = new AnimationSystem();
    const later = new Recorder("later");
    const first = animate({ x: 0 })
      .to({ x: 1 }, DT)
      .onComplete(() => {
        system.untrack(later);
      })
      .play();
    system.track(first);
    system.track(later);

    system.fixedUpdate(makeContext());

    expect(later.deltas).toEqual([]);
    expect(system.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Mixed players
// ---------------------------------------------------------------------------

describe("AnimationSystem — tweens, timelines, and mixers together", () => {
  it("advances all three player types from one step", () => {
    const widget = new Widget();
    widget.transformAuthority = "animation";
    const clip = new AnimationClip({
      name: "opacity",
      tracks: [
        new AnimationTrack({
          path: "opacity",
          adapter: numberAdapter,
          times: [0, 1],
          values: [1, 0],
        }),
      ],
    });
    const position = { x: 0 };
    const scale = { s: 0 };

    const system = new AnimationSystem();
    const mixer = system.track(new AnimationMixer(widget).play(clip));
    const subject = system.track(animate(position).to({ x: 2 }, 1).play());
    const timeline = system.track(
      new Timeline().at(0, tween(scale, { s: 1 }, 1)).play(),
    );

    for (let step = 0; step < 30; step += 1) {
      system.fixedUpdate(makeContext());
    }

    expect(mixer.localTime).toBeCloseTo(0.5, 12);
    expect(widget.opacity).toBeCloseTo(0.5, 12);
    expect(subject.progress).toBeCloseTo(0.5, 12);
    expect(position.x).toBeCloseTo(1, 12);
    expect(scale.s).toBeCloseTo(0.5, 12);
    expect(timeline.elapsedTime).toBeCloseTo(0.5, 12);
  });
});

// ---------------------------------------------------------------------------
// Ordering (P4-1: before MotionSystem)
// ---------------------------------------------------------------------------

describe("AnimationSystem — ordering against MotionSystem (P4-1)", () => {
  it("runs before MotionSystem whatever order they were registered in", () => {
    const registry = new SystemRegistry();
    const motion = new MotionSystem();
    const animation = new AnimationSystem();
    // Deliberately the wrong registration order: priority is what decides.
    registry.register(motion);
    registry.register(animation);

    const motionSpy = vi.spyOn(motion, "fixedUpdate");
    const animationSpy = vi.spyOn(animation, "fixedUpdate");
    registry.runFixedStep(createTimeState());

    expect(animationSpy.mock.invocationCallOrder[0]).toBeLessThan(
      motionSpy.mock.invocationCallOrder[0],
    );
  });

  it("keeps registration order between systems of equal priority", () => {
    const registry = new SystemRegistry();
    const first = new AnimationSystem();
    const second = new AnimationSystem();
    registry.register(first);
    registry.register(second);

    const firstSpy = vi.spyOn(first, "fixedUpdate");
    const secondSpy = vi.spyOn(second, "fixedUpdate");
    registry.runFixedStep(createTimeState());

    expect(first.priority).toBe(second.priority);
    expect(firstSpy.mock.invocationCallOrder[0]).toBeLessThan(
      secondSpy.mock.invocationCallOrder[0],
    );
  });

  it("poses a node before the kinematic step reads it (§19 order)", () => {
    const registry = new SystemRegistry();
    const animation = new AnimationSystem();
    const motion = new MotionSystem();
    registry.register(motion);
    registry.register(animation);

    // Two nodes: one animated, one kinematic. The animated node's pose is
    // written first, which is what §19's pipeline requires.
    const animated = new Group();
    animated.transformAuthority = "animation";
    const observed: number[] = [];
    animation.track(
      animate(animated.transform.position)
        .to({ x: 1 }, 1)
        .authority(animated)
        .play(),
    );

    const kinematic = new Group();
    kinematic.transformAuthority = "kinematic";
    kinematic.addComponent(
      new MotionComponent({ linearVelocity: new Vector3(1, 0, 0) }),
    );
    motion.track(kinematic);
    vi.spyOn(motion, "fixedUpdate").mockImplementation(() => {
      observed.push(animated.transform.position.x);
    });

    registry.runFixedStep(createTimeState());

    expect(observed).toEqual([animated.transform.position.x]);
    expect(observed[0]).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Scheduler-driven stepping (§10)
// ---------------------------------------------------------------------------

describe("AnimationSystem — driven by the real Scheduler (§10)", () => {
  /** A scheduler with the registry attached, exactly as `Application` wires it. */
  function harness(): {
    scheduler: Scheduler;
    registry: SystemRegistry;
    system: AnimationSystem;
  } {
    const scheduler = new Scheduler();
    const registry = new SystemRegistry();
    registry.attachToScheduler(scheduler);
    const system = new AnimationSystem();
    registry.register(system);
    return { scheduler, registry, system };
  }

  it("advances animation once per fixed step of injected real time", () => {
    const { scheduler, system } = harness();
    const target = { x: 0 };
    const subject = system.track(animate(target).to({ x: 1 }, 1).play());

    for (let frame = 0; frame < 30; frame += 1) {
      scheduler.step(DT);
    }

    expect(scheduler.time.simulationStep).toBe(30);
    expect(subject.localTime).toBeCloseTo(0.5, 12);
    expect(target.x).toBeCloseTo(0.5, 12);
  });

  it("runs at the scaled simulation rate: timeScale 0.5 halves the progress", () => {
    const { scheduler, system } = harness();
    const target = { x: 0 };
    system.track(animate(target).to({ x: 1 }, 1).play());
    scheduler.timeScale = 0.5;

    for (let frame = 0; frame < 60; frame += 1) {
      scheduler.step(DT);
    }

    // 60 frames of scaled time is 30 fixed steps, so half of a one-second tween.
    expect(scheduler.time.simulationStep).toBe(30);
    expect(target.x).toBeCloseTo(0.5, 12);
  });

  it("freezes animation while the scheduler is paused (§10)", () => {
    const { scheduler, system } = harness();
    const target = { x: 0 };
    system.track(animate(target).to({ x: 1 }, 1).play());
    scheduler.paused = true;

    for (let frame = 0; frame < 60; frame += 1) {
      scheduler.step(DT);
    }

    expect(scheduler.time.simulationStep).toBe(0);
    expect(target.x).toBe(0);
  });

  it("reproduces the same animation from the same injected time sequence (§34)", () => {
    const run = (): number[] => {
      const { scheduler, system } = harness();
      const target = { x: 0 };
      const fired: number[] = [];
      const widget = new Widget();
      const clip = new AnimationClip({
        name: "opacity",
        tracks: [
          new AnimationTrack({
            path: "opacity",
            adapter: numberAdapter,
            times: [0, 1],
            values: [1, 0],
          }),
        ],
        events: [{ time: 0.5, name: "half" }],
      });
      system.track(
        new AnimationMixer(widget).play(clip, {
          onEvent: () => {
            fired.push(scheduler.time.simulationStep);
          },
        }),
      );
      system.track(animate(target).to({ x: 1 }, 1).play());
      for (const elapsed of [0.02, 0.017, 0.05, 0.008, 0.4, 0.6]) {
        scheduler.step(elapsed);
      }
      return [target.x, widget.opacity, ...fired];
    };

    expect(run()).toEqual(run());
  });
});

describe("AnimationSystem disposal (§83 stability audit, 2026-09-11)", () => {
  it("disposes idempotently and refuses tracking and stepping afterwards", () => {
    const system = new AnimationSystem();
    const player: Advanceable = {
      state: "idle",
      finished: false,
      advance: () => undefined,
    };
    expect(system.disposed).toBe(false);
    system.track(player);
    expect(system.size).toBe(1);

    system.dispose();
    expect(system.disposed).toBe(true);
    expect(system.size).toBe(0);
    // A second dispose is a no-op (§83: idempotent), not an error.
    expect(() => system.dispose()).not.toThrow();
    expect(system.disposed).toBe(true);

    // Disposal is terminal (§83): the mutating entry points refuse with §89's
    // INVALID_APPLICATION_STATE instead of silently working on a dead system.
    expect(expectDisposedError(() => system.track(player)).message).toMatch(
      /AnimationSystem is disposed.*§83/s,
    );
    expectDisposedError(() => system.fixedUpdate(makeContext()));
    expect(system.size).toBe(0);
    // Reads stay answerable, so teardown code can still inspect the system.
    expect(system.has(player)).toBe(false);
  });
});
