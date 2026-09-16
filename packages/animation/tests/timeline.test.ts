import { isFourError } from "@fourjs/core";
import {
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@fourjs/math";
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { Timeline, type TimelineChild } from "../src/timeline.js";
import { animate, tween } from "../src/tween.js";

/** Asserts that `run` throws the §89 error every malformed timeline reports. */
function expectInvalid(run: () => unknown): Error {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(isFourError(thrown)).toBe(true);
  if (!isFourError(thrown)) {
    throw new Error("unreachable");
  }
  expect(thrown.code).toBe("INVALID_APPLICATION_STATE");
  return thrown;
}

/** Silences and records `console.warn` for one test. */
function spyOnWarn(): MockInstance<typeof console.warn> {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

/** Records marker names in firing order. */
function recorder(): { fired: string[]; mark: (name: string) => () => void } {
  const fired: string[] = [];
  return {
    fired,
    mark: (name: string) => (): void => {
      fired.push(name);
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// §16 shape
// ---------------------------------------------------------------------------

describe("Timeline — §16 sketch", () => {
  it("runs §16's example verbatim", () => {
    const node = { position: { x: 0 }, opacity: 1 };
    const log: string[] = [];

    const subject = new Timeline();
    subject
      .at(0, tween(node.position, { x: 5 }, 0.8))
      .at(0.25, tween(node, { opacity: 0.5 }, 0.5))
      .at(1.0, () => log.push("complete"));
    subject.play();

    expect(subject.duration).toBe(1);
    expect(subject.state).toBe("running");
    expect(node.position.x).toBe(0);
    expect(node.opacity).toBe(1);

    subject.advance(0.4);
    expect(node.position.x).toBeCloseTo(2.5, 12);
    expect(node.opacity).toBeCloseTo(0.85, 12);
    expect(log).toEqual([]);

    subject.advance(0.4);
    expect(node.position.x).toBe(5);
    expect(node.opacity).toBe(0.5);
    expect(log).toEqual([]);

    subject.advance(0.2);
    expect(log).toEqual(["complete"]);
    expect(subject.finished).toBe(true);
    expect(subject.state).toBe("finished");
  });

  it("returns itself from every authoring and playback method", () => {
    const subject = new Timeline();

    expect(subject.addLabel("mid", 0.5)).toBe(subject);
    expect(subject.at(0, tween({ x: 0 }, { x: 1 }, 1))).toBe(subject);
    expect(subject.at("mid", () => undefined)).toBe(subject);
    expect(subject.speed(1)).toBe(subject);
    expect(subject.loop(1)).toBe(subject);
    expect(subject.reverse(false)).toBe(subject);
    expect(subject.play()).toBe(subject);
    expect(subject.advance(0)).toBe(subject);
    expect(subject.pause()).toBe(subject);
    expect(subject.resume()).toBe(subject);
    expect(subject.seek(0)).toBe(subject);
    expect(subject.scrub(0)).toBe(subject);
    expect(subject.stop()).toBe(subject);
  });

  it("reports the defaults of a freshly built timeline", () => {
    const subject = new Timeline();

    expect(subject.state).toBe("idle");
    expect(subject.duration).toBe(0);
    expect(subject.totalDuration).toBe(0);
    expect(subject.localTime).toBe(0);
    expect(subject.elapsedTime).toBe(0);
    expect(subject.iteration).toBe(0);
    expect(subject.finished).toBe(false);
    expect(subject.reversed).toBe(false);
    expect(subject.playbackSpeed).toBe(1);
    expect(subject.loopCount).toBe(1);
    expect(subject.hasLabel("nope")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------

describe("Timeline — duration", () => {
  it("spans the furthest child end and the furthest marker", () => {
    const subject = new Timeline()
      .at(0, tween({ x: 0 }, { x: 1 }, 0.8))
      .at(1.5, tween({ x: 0 }, { x: 1 }, 0.5))
      .at(2.5, () => undefined);

    expect(subject.duration).toBe(2.5);
  });

  it("counts a child's own repeats and delay in its window", () => {
    const child = animate({ x: 0 }).to({ x: 1 }, 0.5).delay(0.25).repeat(1);
    const subject = new Timeline().at(1, child);

    expect(child.totalDuration).toBe(1.25);
    expect(subject.duration).toBe(2.25);
  });

  it("does not let labels extend the duration", () => {
    const subject = new Timeline()
      .at(0, tween({ x: 0 }, { x: 1 }, 1))
      .addLabel("epilogue", 30);

    expect(subject.duration).toBe(1);
    expect(subject.labelTime("epilogue")).toBe(30);
  });

  it("multiplies the duration by the loop count", () => {
    const subject = new Timeline().at(0, tween({ x: 0 }, { x: 1 }, 2)).loop(3);

    expect(subject.duration).toBe(2);
    expect(subject.totalDuration).toBe(6);
    expect(subject.loopCount).toBe(3);

    subject.loop(Infinity);
    expect(subject.totalDuration).toBe(Infinity);
  });

  it("keeps an empty timeline at zero rather than 0 × Infinity", () => {
    const subject = new Timeline().loop(Infinity);

    expect(subject.duration).toBe(0);
    expect(subject.totalDuration).toBe(0);

    subject.play().advance(1);
    expect(subject.finished).toBe(true);
    expect(subject.localTime).toBe(0);
    expect(subject.iteration).toBe(0);
  });

  it("never finishes when a child never ends", () => {
    const target = { x: 0 };
    const child = animate(target).to({ x: 10 }, 1).repeat(Infinity);
    const subject = new Timeline().at(0, child).play();

    expect(subject.duration).toBe(Infinity);
    expect(subject.totalDuration).toBe(Infinity);

    subject.advance(10.5);
    expect(subject.finished).toBe(false);
    expect(target.x).toBeCloseTo(5, 12);
  });

  it("freezes the duration at play", () => {
    const child = animate({ x: 0 }).to({ x: 1 }, 1);
    const subject = new Timeline().at(0, child);

    expect(subject.duration).toBe(1);
    subject.play();
    expect(subject.duration).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Pure evaluation (§16)
// ---------------------------------------------------------------------------

describe("Timeline — evaluation is a pure function of time (§16)", () => {
  it("writes identical values for repeated seeks to the same time", () => {
    const target = { x: 0, y: 0 };
    const subject = new Timeline()
      .at(0, tween(target, { x: 10 }, 2))
      .at(0.5, tween(target, { y: -4 }, 1))
      .play();

    subject.seek(0.75);
    const first = { x: target.x, y: target.y };
    subject.seek(1.9);
    subject.seek(0.75);

    expect(target.x).toBe(first.x);
    expect(target.y).toBe(first.y);
  });

  it("scrubs forwards and backwards without accumulating error", () => {
    const target = { x: 0 };
    const subject = new Timeline().at(0, tween(target, { x: 100 }, 1)).play();

    subject.scrub(0.5);
    const midpoint = target.x;
    for (const time of [0.9, 0.1, 0.75, 0.25, 0.5]) {
      subject.scrub(time);
    }

    expect(target.x).toBe(midpoint);
    expect(subject.localTime).toBe(0.5);
  });

  it("holds children at their boundary poses outside their window", () => {
    const target = { x: 0 };
    const subject = new Timeline().at(1, tween(target, { x: 10 }, 1)).play();

    expect(subject.duration).toBe(2);
    expect(target.x).toBe(0);

    subject.seek(0.5);
    expect(target.x).toBe(0);
    subject.seek(1.5);
    expect(target.x).toBeCloseTo(5, 12);
    subject.seek(2);
    expect(target.x).toBe(10);
    subject.seek(1.99);
    expect(target.x).toBeCloseTo(9.9, 12);
    subject.seek(0.25);
    expect(target.x).toBe(0);
  });

  it("clamps a seek past the end to the duration", () => {
    const target = { x: 0 };
    const subject = new Timeline().at(0, tween(target, { x: 10 }, 1)).play();

    subject.seek(50);
    expect(subject.localTime).toBe(1);
    expect(target.x).toBe(10);
    expect(subject.finished).toBe(false);
    expect(subject.state).toBe("running");
  });

  it("resolves two children on one property in insertion order", () => {
    const target = { x: 0 };
    const warn = spyOnWarn();
    const subject = new Timeline()
      .at(0, tween(target, { x: 10 }, 1))
      .at(0, tween(target, { x: -10 }, 1))
      .play();

    // The §16 conflict warning is the tweens', fired at timeline play.
    expect(warn).toHaveBeenCalledTimes(1);
    subject.seek(0.5);
    expect(target.x).toBeCloseTo(-5, 12);
  });
});

// ---------------------------------------------------------------------------
// Markers (§16)
// ---------------------------------------------------------------------------

describe("Timeline — markers fire once per forward crossing (§16)", () => {
  it("fires each marker exactly once across a multi-advance sweep", () => {
    const log = recorder();
    const subject = new Timeline()
      .at(0.2, log.mark("a"))
      .at(0.5, log.mark("b"))
      .at(1.0, log.mark("c"))
      .play();

    for (let step = 0; step < 12; step += 1) {
      subject.advance(0.1);
    }

    expect(log.fired).toEqual(["a", "b", "c"]);
  });

  it("fires a marker at the end of a step, not at its start", () => {
    const log = recorder();
    const subject = new Timeline()
      .at(0.25, log.mark("at-from"))
      .at(0.5, log.mark("at-to"))
      .at(1, tween({ x: 0 }, { x: 1 }, 0))
      .play();

    subject.advance(0.25);
    expect(log.fired).toEqual(["at-from"]);

    subject.advance(0.25);
    expect(log.fired).toEqual(["at-from", "at-to"]);
  });

  it("does not re-fire time-0 markers after a zero-delta advance (2026-08-05)", () => {
    // The no-move branch's start re-arm is for real rewinds only: with the
    // cursor sitting AT 0 right after the time-0 markers fired, a zero-delta
    // advance used to reset it, and the next forward step fired them again.
    const log = recorder();
    const subject = new Timeline().at(0, log.mark("zero")).play();

    subject.advance(0);
    expect(log.fired).toEqual(["zero"]);
    subject.advance(0);
    subject.advance(0.25);
    expect(log.fired).toEqual(["zero"]);
  });

  it("fires a marker at time 0 on the first advance, not at play", () => {
    const log = recorder();
    const subject = new Timeline()
      .at(0, log.mark("zero"))
      .at(0, tween({ x: 0 }, { x: 1 }, 1))
      .play();

    expect(log.fired).toEqual([]);

    subject.advance(0);
    expect(log.fired).toEqual(["zero"]);

    subject.advance(0.5);
    expect(log.fired).toEqual(["zero"]);
  });

  it("fires markers sharing a time in insertion order", () => {
    const log = recorder();
    const subject = new Timeline()
      .at(0.5, log.mark("second"))
      .at(0.25, log.mark("first"))
      .at(0.5, log.mark("third"))
      .play();

    subject.advance(1);
    expect(log.fired).toEqual(["first", "second", "third"]);
  });

  it("fires nothing while playing in reverse", () => {
    const target = { x: 0 };
    const log = recorder();
    const subject = new Timeline()
      .at(0, tween(target, { x: 10 }, 1))
      .at(0.5, log.mark("mid"))
      .play();

    subject.advance(0.6);
    expect(log.fired).toEqual(["mid"]);
    expect(target.x).toBeCloseTo(6, 12);

    subject.reverse();
    expect(subject.reversed).toBe(true);
    subject.advance(0.3);
    expect(subject.localTime).toBeCloseTo(0.3, 12);
    expect(target.x).toBeCloseTo(3, 12);
    expect(log.fired).toEqual(["mid"]);

    subject.advance(1);
    expect(subject.localTime).toBe(0);
    expect(target.x).toBe(0);
    expect(subject.finished).toBe(true);
    expect(log.fired).toEqual(["mid"]);
  });

  it("re-arms every marker on a loop wrap", () => {
    const log = recorder();
    const subject = new Timeline()
      .at(0, log.mark("zero"))
      .at(0.5, log.mark("mid"))
      .at(0, tween({ x: 0 }, { x: 1 }, 1))
      .loop(3)
      .play();

    expect(subject.totalDuration).toBe(3);
    for (let step = 0; step < 15; step += 1) {
      subject.advance(0.25);
    }

    expect(subject.finished).toBe(true);
    expect(log.fired.filter((name) => name === "zero")).toHaveLength(3);
    expect(log.fired.filter((name) => name === "mid")).toHaveLength(3);
  });

  it("crosses every iteration a single large delta spans", () => {
    const log = recorder();
    const subject = new Timeline()
      .at(0.5, log.mark("mid"))
      .at(0, tween({ x: 0 }, { x: 1 }, 1))
      .loop(4)
      .play();

    subject.advance(4);
    expect(log.fired).toHaveLength(4);
    expect(subject.iteration).toBe(3);
    expect(subject.localTime).toBe(1);
    expect(subject.elapsedTime).toBe(4);
  });

  it("reports the iteration a looping timeline is in", () => {
    const subject = new Timeline()
      .at(0, tween({ x: 0 }, { x: 1 }, 1))
      .loop(3)
      .play();

    subject.advance(1.5);
    expect(subject.iteration).toBe(1);
    expect(subject.localTime).toBeCloseTo(0.5, 12);
    expect(subject.elapsedTime).toBe(1.5);
  });
});

describe("Timeline — seek suppresses markers (§16)", () => {
  it("fires nothing on seek by default and replays only opted-in markers", () => {
    const log = recorder();
    const subject = new Timeline()
      .at(0.5, log.mark("replay"), { replayOnSeek: true })
      .at(0.7, log.mark("silent"))
      .play();

    subject.seek(1);
    expect(log.fired).toEqual(["replay"]);

    subject.seek(1);
    expect(log.fired).toEqual(["replay"]);
  });

  it("fires nothing when a seek moves backwards, and re-arms what it rewound", () => {
    const log = recorder();
    const subject = new Timeline()
      .at(0.5, log.mark("replay"), { replayOnSeek: true })
      .play();

    subject.seek(0.6);
    expect(log.fired).toEqual(["replay"]);

    subject.seek(0.2);
    expect(log.fired).toEqual(["replay"]);

    subject.seek(0.6);
    expect(log.fired).toEqual(["replay", "replay"]);
  });

  it("does not re-fire on the advance that follows a forward seek", () => {
    const log = recorder();
    const subject = new Timeline()
      .at(0.25, log.mark("a"))
      .at(0.75, log.mark("b"))
      .at(0, tween({ x: 0 }, { x: 1 }, 1))
      .play();

    subject.seek(0.5);
    expect(log.fired).toEqual([]);

    subject.advance(0.5);
    expect(log.fired).toEqual(["b"]);
  });

  it("re-arms markers when a seek rewinds to time 0", () => {
    const log = recorder();
    const subject = new Timeline()
      .at(0, log.mark("zero"))
      .at(0, tween({ x: 0 }, { x: 1 }, 1))
      .play();

    subject.advance(0.5);
    expect(log.fired).toEqual(["zero"]);

    subject.seek(0);
    subject.advance(0.5);
    expect(log.fired).toEqual(["zero", "zero"]);
  });
});

// ---------------------------------------------------------------------------
// Nesting
// ---------------------------------------------------------------------------

describe("Timeline — nesting", () => {
  it("maps the parent's speed into the child and fires the child's markers", () => {
    const target = { x: 0 };
    const log = recorder();
    const child = new Timeline()
      .at(0, tween(target, { x: 10 }, 1))
      .at(0.5, log.mark("child"));
    const parent = new Timeline().at(0, child).speed(2).play();

    expect(parent.duration).toBe(1);
    expect(parent.playbackSpeed).toBe(2);

    parent.advance(0.25);
    expect(parent.localTime).toBe(0.5);
    expect(child.localTime).toBe(0.5);
    expect(target.x).toBeCloseTo(5, 12);
    expect(log.fired).toEqual(["child"]);

    parent.advance(0.25);
    expect(target.x).toBe(10);
    expect(parent.finished).toBe(true);
    expect(log.fired).toEqual(["child"]);
  });

  it("holds a nested timeline at its boundary poses and arms it on entry", () => {
    const target = { x: 0 };
    const log = recorder();
    const child = new Timeline()
      .at(0, log.mark("child-zero"))
      .at(0, tween(target, { x: 10 }, 1));
    const parent = new Timeline().at(1, child).play();

    expect(parent.duration).toBe(2);

    parent.advance(0.5);
    expect(log.fired).toEqual([]);
    expect(target.x).toBe(0);

    parent.advance(0.6);
    expect(log.fired).toEqual(["child-zero"]);
    expect(target.x).toBeCloseTo(1, 12);

    parent.advance(1);
    expect(target.x).toBe(10);
    expect(log.fired).toEqual(["child-zero"]);
  });

  it("re-arms a nested timeline's markers when the parent wraps", () => {
    const log = recorder();
    const child = new Timeline()
      .at(0.5, log.mark("child"))
      .at(0, tween({ x: 0 }, { x: 1 }, 1));
    const parent = new Timeline().at(0, child).loop(2).play();

    expect(parent.totalDuration).toBe(2);
    parent.advance(0.6);
    expect(log.fired).toEqual(["child"]);

    parent.advance(1.9);
    expect(log.fired).toEqual(["child", "child"]);
    expect(parent.finished).toBe(true);
  });

  it("rewinds a nested timeline when the parent seeks backwards", () => {
    const log = recorder();
    const child = new Timeline().at(0.5, log.mark("child"));
    const parent = new Timeline()
      .at(1, child)
      .at(0, tween({ x: 0 }, { x: 1 }, 3))
      .play();

    parent.advance(2);
    expect(log.fired).toEqual(["child"]);

    parent.seek(0.5);
    parent.advance(2);
    expect(log.fired).toEqual(["child", "child"]);
  });

  it("nests three deep", () => {
    const target = { x: 0 };
    const inner = new Timeline().at(0, tween(target, { x: 8 }, 1));
    const middle = new Timeline().at(0.5, inner);
    const outer = new Timeline().at(0.5, middle).play();

    expect(outer.duration).toBe(2);
    outer.advance(1.5);
    expect(target.x).toBeCloseTo(4, 12);
    outer.advance(0.5);
    expect(target.x).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

describe("Timeline — labels (§16)", () => {
  it("places and seeks entries by label", () => {
    const target = { x: 0 };
    const log = recorder();
    const subject = new Timeline()
      .addLabel("impact", 1)
      .at("impact", tween(target, { x: 10 }, 1))
      .at("impact", log.mark("impact"))
      .play();

    expect(subject.hasLabel("impact")).toBe(true);
    expect(subject.labelTime("impact")).toBe(1);
    expect(subject.duration).toBe(2);

    subject.seek("impact");
    expect(subject.localTime).toBe(1);
    expect(target.x).toBe(0);
    expect(log.fired).toEqual([]);

    subject.advance(0.5);
    expect(target.x).toBeCloseTo(5, 12);
  });

  it("throws on an unknown label from at(), seek(), and labelTime()", () => {
    const subject = new Timeline();

    const error = expectInvalid(() => subject.at("nope", () => undefined));
    expect(error.message).toContain('no label "nope"');
    expectInvalid(() => subject.labelTime("nope"));

    subject.play();
    expectInvalid(() => subject.seek("nope"));
  });

  it("rejects an empty, duplicate, or non-second label", () => {
    const subject = new Timeline().addLabel("start", 0);

    expectInvalid(() => subject.addLabel("", 1));
    const error = expectInvalid(() => subject.addLabel("start", 2));
    expect(error.message).toContain("already defined");
    expectInvalid(() => subject.addLabel("bad", -1));
  });
});

// ---------------------------------------------------------------------------
// Playback controls
// ---------------------------------------------------------------------------

describe("Timeline — playback controls", () => {
  it("walks idle → running → paused → running → finished", () => {
    const subject = new Timeline().at(0, tween({ x: 0 }, { x: 1 }, 1));

    expect(subject.state).toBe("idle");
    subject.play();
    expect(subject.state).toBe("running");

    subject.advance(0.25).pause();
    expect(subject.state).toBe("paused");
    subject.advance(0.5);
    expect(subject.localTime).toBe(0.25);

    subject.resume().advance(0.25);
    expect(subject.state).toBe("running");
    expect(subject.localTime).toBe(0.5);

    subject.advance(1);
    expect(subject.state).toBe("finished");
    expect(subject.finished).toBe(true);
    expect(subject.localTime).toBe(1);

    subject.advance(1);
    expect(subject.localTime).toBe(1);
  });

  it("scales the advance delta by speed", () => {
    const target = { x: 0 };
    const subject = new Timeline()
      .at(0, tween(target, { x: 10 }, 1))
      .speed(2)
      .play();

    subject.advance(0.25);
    expect(subject.localTime).toBe(0.5);
    expect(target.x).toBeCloseTo(5, 12);
  });

  it("treats play, pause, resume, stop and advance as no-ops in the wrong state", () => {
    const subject = new Timeline().at(0, tween({ x: 0 }, { x: 1 }, 1));

    expect(subject.pause().state).toBe("idle");
    expect(subject.resume().state).toBe("idle");
    expect(subject.stop().state).toBe("idle");
    expect(subject.advance(1).elapsedTime).toBe(0);

    subject.play();
    expect(subject.play().localTime).toBe(0);
    subject.pause();
    expect(subject.play().state).toBe("paused");
  });

  it("stops its children and releases their property claims", () => {
    const target = { x: 0 };
    const child = tween(target, { x: 10 }, 1);
    const subject = new Timeline().at(0, child).play();

    subject.advance(0.5);
    expect(target.x).toBeCloseTo(5, 12);

    subject.stop();
    expect(subject.state).toBe("stopped");
    expect(child.state).toBe("stopped");

    const warn = spyOnWarn();
    const later = animate(target).to({ x: 100 }, 1).play();
    expect(warn).not.toHaveBeenCalled();

    // The stopped timeline is inert: neither its children nor its markers run.
    subject.seek(1);
    expect(target.x).toBeCloseTo(5, 12);

    later.advance(0.5);
    expect(target.x).toBeCloseTo(52.5, 12);
  });

  it("stops nested timelines recursively", () => {
    const target = { x: 0 };
    const grandchild = tween(target, { x: 10 }, 1);
    const child = new Timeline().at(0, grandchild);
    const parent = new Timeline().at(0, child).play();

    parent.stop();
    expect(child.state).toBe("stopped");
    expect(grandchild.state).toBe("stopped");
  });

  it("fires no markers when a stopped timeline is seeked", () => {
    const log = recorder();
    const subject = new Timeline()
      .at(0.5, log.mark("replay"), { replayOnSeek: true })
      .play();

    subject.stop();
    subject.seek(1);
    expect(log.fired).toEqual([]);
    expect(subject.localTime).toBe(0.5);
  });

  it("runs forward again after reverse(false)", () => {
    const target = { x: 0 };
    const subject = new Timeline().at(0, tween(target, { x: 10 }, 1)).play();

    subject.advance(0.8).reverse();
    subject.advance(0.4);
    expect(target.x).toBeCloseTo(4, 12);

    subject.reverse(false);
    expect(subject.reversed).toBe(false);
    subject.advance(0.4);
    expect(target.x).toBeCloseTo(8, 12);
  });
});

// ---------------------------------------------------------------------------
// Allocation (§7b)
// ---------------------------------------------------------------------------

describe("Timeline — allocation discipline (§7b)", () => {
  it("allocates no math objects on the advance path after play", () => {
    const target = { position: new Vector3(0, 0, 0), value: 0 };
    const log = recorder();
    const child = new Timeline()
      .at(0, tween(target, { value: 5 }, 1))
      .at(0.5, log.mark("child"));
    const subject = new Timeline()
      .at(0, tween(target, { position: new Vector3(10, 0, 0) }, 1))
      .at(0.25, log.mark("parent"))
      .at(0, child)
      .loop(Infinity)
      .play();

    resetConstructionCount();
    for (let step = 0; step < 1000; step += 1) {
      subject.advance(0.001);
    }
    subject.seek(0.4);

    expect(constructionCount()).toBe(0);
    expect(log.fired.length).toBeGreaterThan(1);
    expect(target.position.x).toBeGreaterThan(0);
    expect(target.value).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Misconfiguration
// ---------------------------------------------------------------------------

describe("Timeline — misconfiguration", () => {
  it("rejects authoring after play", () => {
    const subject = new Timeline().play();

    const error = expectInvalid(() => subject.at(0, () => undefined));
    expect(error.message).toContain("cannot be called after play()");
    expectInvalid(() => subject.addLabel("late", 1));
  });

  it("rejects a child that has already been played", () => {
    const played = tween({ x: 0 }, { x: 1 }, 1).play();
    const error = expectInvalid(() => new Timeline().at(0, played));
    expect(error.message).toContain("unplayed child");
  });

  it("rejects the same child placed twice", () => {
    const child = tween({ x: 0 }, { x: 1 }, 1);
    const subject = new Timeline().at(0, child);
    expectInvalid(() => subject.at(1, child));
  });

  it("rejects a timeline nested inside itself, directly or through a cycle", () => {
    const outer = new Timeline();
    expectInvalid(() => outer.at(0, outer));

    const middle = new Timeline();
    const inner = new Timeline();
    outer.at(0, middle);
    middle.at(0, inner);
    expectInvalid(() => inner.at(0, outer));
  });

  it("rejects marker options on a child entry", () => {
    const subject = new Timeline();
    const error = expectInvalid(() =>
      subject.at(0, tween({ x: 0 }, { x: 1 }, 1), { replayOnSeek: true }),
    );
    expect(error.message).toContain("callback markers only");
  });

  it("rejects times, deltas and seek times that are not seconds >= 0", () => {
    const subject = new Timeline();

    expectInvalid(() => subject.at(-1, () => undefined));
    expectInvalid(() => subject.at(Number.NaN, () => undefined));

    subject.play();
    expectInvalid(() => subject.advance(-1));
    expectInvalid(() => subject.advance(Number.POSITIVE_INFINITY));
    expectInvalid(() => subject.seek(-1));
  });

  it("rejects non-positive speeds and loop counts below one", () => {
    const subject = new Timeline();

    const error = expectInvalid(() => subject.speed(0));
    expect(error.message).toContain("reverse()");
    expectInvalid(() => subject.speed(Number.POSITIVE_INFINITY));
    expectInvalid(() => subject.loop(0));
    expectInvalid(() => subject.loop(1.5));
  });

  it("rejects seek before play", () => {
    const error = expectInvalid(() => new Timeline().seek(0.5));
    expect(error.message).toContain("requires Timeline.play()");
  });
});

// ---------------------------------------------------------------------------
// The TimelineChild contract
// ---------------------------------------------------------------------------

describe("TimelineChild", () => {
  it("is satisfied by a tween and by a nested timeline", () => {
    const asChildren: TimelineChild[] = [
      tween({ x: 0 }, { x: 1 }, 1),
      new Timeline(),
    ];

    expect(asChildren).toHaveLength(2);
    expect(asChildren[0].state).toBe("idle");
    expect(asChildren[1].totalDuration).toBe(0);
  });

  it("drives any object that implements it", () => {
    const seen: number[] = [];
    const custom: TimelineChild = {
      state: "idle",
      totalDuration: 2,
      play: () => undefined,
      stop: () => undefined,
      seek: (timeSeconds: number) => seen.push(timeSeconds),
    };
    const subject = new Timeline().at(1, custom).play();

    expect(subject.duration).toBe(3);
    seen.length = 0;
    subject.seek(0.5);
    subject.seek(2);
    subject.seek(3);

    expect(seen).toEqual([0, 1, 2]);
  });
});
