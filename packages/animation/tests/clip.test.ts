import { isFourError } from "@fourjs/core";
import {
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@fourjs/math";
import { describe, expect, it } from "vitest";

import {
  AnimationClip,
  type AnimationEvent,
  type TrackSampleSink,
} from "../src/clip.js";
import { AnimationTrack, type AnimationTrackLike } from "../src/track.js";
import { numberAdapter, vector3Adapter } from "../src/values.js";

/** Asserts that `run` throws the §89 error every malformed clip reports. */
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

/** A scalar track ending at `endTime`. */
function scalarTrack(path: string, endTime: number): AnimationTrack<number> {
  return new AnimationTrack({
    path,
    adapter: numberAdapter,
    times: [0, endTime],
    values: [0, 100],
  });
}

/** Records the events `eventsInRange` visits, in visit order. */
function collect(
  clip: AnimationClip,
  from: number,
  to: number,
): { names: string[]; indices: number[]; count: number } {
  const names: string[] = [];
  const indices: number[] = [];
  const count = clip.eventsInRange(from, to, (event, index) => {
    names.push(event.name);
    indices.push(index);
  });
  return { names, indices, count };
}

describe("AnimationClip shape (§17)", () => {
  it("carries a name, a duration in seconds, tracks, and events", () => {
    const track = scalarTrack("opacity", 2);
    const events: readonly AnimationEvent[] = [{ time: 1, name: "footstep" }];
    const clip = new AnimationClip({ name: "walk", tracks: [track], events });

    expect(clip.name).toBe("walk");
    expect(clip.duration).toBe(2);
    expect(clip.tracks).toEqual([track]);
    expect(clip.events).toEqual(events);
  });

  it("accepts heterogeneous tracks through the erased track type", () => {
    const position = new AnimationTrack({
      path: "transform.position",
      adapter: vector3Adapter,
      times: [0, 1],
      values: [new Vector3(), new Vector3(1, 2, 3)],
    });
    const opacity = scalarTrack("opacity", 1);
    const clip = new AnimationClip({
      name: "mixed",
      tracks: [position, opacity],
    });

    const first: AnimationTrackLike = clip.tracks[0];
    expect(first.adapter.kind).toBe("vector3");
    expect(clip.tracks[1].adapter.kind).toBe("number");
  });

  it("copies its track and event arrays", () => {
    const tracks = [scalarTrack("opacity", 1)];
    const events: AnimationEvent[] = [{ time: 0.5, name: "a" }];
    const clip = new AnimationClip({ name: "clip", tracks, events });

    tracks.push(scalarTrack("visible", 1));
    events.push({ time: 0.75, name: "b" });

    expect(clip.tracks).toHaveLength(1);
    expect(clip.events).toHaveLength(1);
  });

  it("keeps name and duration writable, as §17 declares them", () => {
    const clip = new AnimationClip({ name: "clip", tracks: [] });

    clip.name = "renamed";
    clip.duration = 4;

    expect(clip.name).toBe("renamed");
    expect(clip.duration).toBe(4);
  });
});

describe("AnimationClip duration", () => {
  it("derives the natural extent from the tracks", () => {
    const clip = new AnimationClip({
      name: "clip",
      tracks: [scalarTrack("a", 1.5), scalarTrack("b", 3.25)],
    });

    expect(clip.duration).toBe(3.25);
  });

  it("includes events in the derived extent", () => {
    const clip = new AnimationClip({
      name: "clip",
      tracks: [scalarTrack("a", 1)],
      events: [{ time: 4, name: "late" }],
    });

    expect(clip.duration).toBe(4);
  });

  it("is zero for an empty clip", () => {
    expect(new AnimationClip({ name: "empty", tracks: [] }).duration).toBe(0);
  });

  it("honours an explicit duration, longer or shorter than the content", () => {
    const tracks = [scalarTrack("a", 1)];

    expect(
      new AnimationClip({ name: "c", tracks, duration: 10 }).duration,
    ).toBe(10);
    expect(
      new AnimationClip({ name: "c", tracks, duration: 0.5 }).duration,
    ).toBe(0.5);
  });

  it("rejects a negative or non-finite duration", () => {
    const error = expectInvalid(
      () => new AnimationClip({ name: "c", tracks: [], duration: -1 }),
    );
    expect(error.message).toContain("finite non-negative number of seconds");

    expectInvalid(
      () =>
        new AnimationClip({
          name: "c",
          tracks: [],
          duration: Number.POSITIVE_INFINITY,
        }),
    );
  });
});

describe("AnimationClip validation", () => {
  it("rejects an empty name", () => {
    const error = expectInvalid(
      () => new AnimationClip({ name: "", tracks: [] }),
    );

    expect(error.message).toContain("non-empty name");
  });

  it("rejects a non-finite event time", () => {
    const error = expectInvalid(
      () =>
        new AnimationClip({
          name: "c",
          tracks: [],
          events: [{ time: Number.NaN, name: "broken" }],
        }),
    );

    expect(error.message).toContain("non-finite time");
  });
});

describe("AnimationClip event ordering", () => {
  it("sorts events by time", () => {
    const clip = new AnimationClip({
      name: "c",
      tracks: [],
      events: [
        { time: 2, name: "c" },
        { time: 0, name: "a" },
        { time: 1, name: "b" },
      ],
    });

    expect(clip.events.map((event) => event.name)).toEqual(["a", "b", "c"]);
  });

  it("breaks ties by insertion order, both when sorting and when not", () => {
    const unsorted = new AnimationClip({
      name: "c",
      tracks: [],
      events: [
        { time: 1, name: "second" },
        { time: 1, name: "third" },
        { time: 0, name: "first" },
      ],
    });
    const alreadySorted = new AnimationClip({
      name: "c",
      tracks: [],
      events: [
        { time: 0, name: "first" },
        { time: 1, name: "second" },
        { time: 1, name: "third" },
      ],
    });

    expect(unsorted.events.map((event) => event.name)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(alreadySorted.events.map((event) => event.name)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("carries an optional payload through untouched", () => {
    const payload = { foot: "left" };
    const clip = new AnimationClip({
      name: "c",
      tracks: [],
      events: [{ time: 0.5, name: "footstep", payload }],
    });

    expect(clip.events[0].payload).toBe(payload);
  });
});

describe("AnimationClip.eventsInRange", () => {
  const clip = new AnimationClip({
    name: "c",
    tracks: [],
    events: [
      { time: 0, name: "zero" },
      { time: 1, name: "one" },
      { time: 1, name: "one-again" },
      { time: 2, name: "two" },
      { time: 3, name: "three" },
    ],
  });

  it("includes an event exactly at `to` and excludes one exactly at `from`", () => {
    const visited = collect(clip, 1, 2);

    expect(visited.names).toEqual(["two"]);
    expect(visited.count).toBe(1);
  });

  it("reports the index into `events` alongside each event", () => {
    const visited = collect(clip, 0.5, 1.5);

    expect(visited.names).toEqual(["one", "one-again"]);
    expect(visited.indices).toEqual([1, 2]);
  });

  it("fires every event exactly once across consecutive forward steps", () => {
    const seen: string[] = [];
    let previous = -Number.EPSILON;
    for (let step = 1; step <= 30; step += 1) {
      const next = step * 0.1;
      clip.eventsInRange(previous, next, (event) => seen.push(event.name));
      previous = next;
    }

    expect(seen).toEqual(["zero", "one", "one-again", "two", "three"]);
  });

  it("visits nothing for an empty range", () => {
    expect(collect(clip, 1, 1).count).toBe(0);
    expect(collect(clip, 0, 0).count).toBe(0);
  });

  it("visits nothing for a reversed range", () => {
    expect(collect(clip, 3, 0).count).toBe(0);
  });

  it("visits nothing when the range misses every event", () => {
    expect(collect(clip, 3, 10).count).toBe(0);
    expect(collect(clip, -10, -1).count).toBe(0);
  });

  it("visits everything when the range spans the whole clip", () => {
    const visited = collect(clip, -1, 10);

    expect(visited.count).toBe(5);
    expect(visited.names).toEqual(["zero", "one", "one-again", "two", "three"]);
  });

  it("handles a clip with no events at all", () => {
    const empty = new AnimationClip({ name: "empty", tracks: [] });

    expect(collect(empty, -1, 10).count).toBe(0);
  });
});

describe("AnimationClip.indexOfFirstEventAfter", () => {
  const clip = new AnimationClip({
    name: "c",
    tracks: [],
    events: [
      { time: 0, name: "zero" },
      { time: 1, name: "one" },
      { time: 1, name: "one-again" },
      { time: 2, name: "two" },
    ],
  });

  it("skips events at or before the given time", () => {
    expect(clip.indexOfFirstEventAfter(-1)).toBe(0);
    expect(clip.indexOfFirstEventAfter(0)).toBe(1);
    expect(clip.indexOfFirstEventAfter(0.5)).toBe(1);
    expect(clip.indexOfFirstEventAfter(1)).toBe(3);
    expect(clip.indexOfFirstEventAfter(2)).toBe(4);
    expect(clip.indexOfFirstEventAfter(99)).toBe(4);
  });

  it("returns 0 for a clip with no events", () => {
    const empty = new AnimationClip({ name: "empty", tracks: [] });

    expect(empty.indexOfFirstEventAfter(0)).toBe(0);
  });
});

describe("AnimationClip.sampleAll", () => {
  /** The mixer-shaped sink: one scratch value and one destination per track. */
  function makeSink(scratch: readonly unknown[]): {
    sink: TrackSampleSink;
    applied: { index: number; path: string; value: unknown }[];
  } {
    const applied: { index: number; path: string; value: unknown }[] = [];
    const sink: TrackSampleSink = {
      outFor(trackIndex: number): unknown {
        return scratch[trackIndex];
      },
      applySample(
        trackIndex: number,
        track: AnimationTrackLike,
        value: unknown,
      ): void {
        applied.push({ index: trackIndex, path: track.path, value });
      },
    };
    return { sink, applied };
  }

  it("samples every track in insertion order with index-stable storage", () => {
    const position = new AnimationTrack({
      path: "transform.position",
      adapter: vector3Adapter,
      times: [0, 1],
      values: [new Vector3(0, 0, 0), new Vector3(2, 4, 6)],
    });
    const opacity = new AnimationTrack({
      path: "opacity",
      adapter: numberAdapter,
      times: [0, 1],
      values: [0, 1],
    });
    const clip = new AnimationClip({
      name: "c",
      tracks: [position, opacity],
    });
    const positionScratch = new Vector3();
    const { sink, applied } = makeSink([positionScratch, 0]);

    clip.sampleAll(0.5, sink);

    expect(applied.map((entry) => entry.index)).toEqual([0, 1]);
    expect(applied.map((entry) => entry.path)).toEqual([
      "transform.position",
      "opacity",
    ]);
    // In-place kind: the sampled value *is* the scratch object.
    expect(applied[0].value).toBe(positionScratch);
    expect(positionScratch).toEqual(new Vector3(1, 2, 3));
    // By-value kind: the scratch was ignored and the number came back instead.
    expect(applied[1].value).toBe(0.5);
  });

  it("does nothing for a clip with no tracks", () => {
    const clip = new AnimationClip({ name: "empty", tracks: [] });
    const { sink, applied } = makeSink([]);

    clip.sampleAll(0.5, sink);

    expect(applied).toHaveLength(0);
  });

  it("allocates nothing across repeated evaluation (§7b)", () => {
    const position = new AnimationTrack({
      path: "transform.position",
      adapter: vector3Adapter,
      times: [0, 1, 2],
      values: [new Vector3(), new Vector3(1, 1, 1), new Vector3(2, 0, -2)],
      interpolation: "cubic",
    });
    const clip = new AnimationClip({ name: "c", tracks: [position] });
    const scratch = new Vector3();
    const sink: TrackSampleSink = {
      outFor: (): unknown => scratch,
      applySample: (): void => {
        // The mixer would write through a binding here; nothing to do.
      },
    };

    resetConstructionCount();
    for (let step = 0; step < 1000; step += 1) {
      clip.sampleAll(step * 0.002, sink);
    }

    expect(constructionCount()).toBe(0);
  });
});
