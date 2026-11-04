import { Vector3 } from "@fourjs/math";
import { describe, expect, it } from "vitest";

import { AnimationClip } from "../src/clip.js";
import { AnimationController } from "../src/controller.js";
import { AnimationTrack } from "../src/track.js";
import { numberAdapter } from "../src/values.js";

/** The pre-optimisation Catmull-Rom arithmetic, kept inline as the oracle. */
function oracle(times: number[], values: number[], t: number): number {
  const last = times.length - 1;
  if (t <= times[0]) return values[0];
  if (t >= times[last]) return values[last];
  let index = 0;
  while (index < last - 1 && times[index + 1] <= t) index += 1;
  const startTime = times[index];
  const endTime = times[index + 1];
  const span = endTime - startTime;
  const u = (t - startTime) / span;
  const hasPrevious = index > 0;
  const hasNext = index + 2 < times.length;
  const start = values[index];
  const end = values[index + 1];
  const previousTime = hasPrevious ? times[index - 1] : startTime;
  const nextTime = hasNext ? times[index + 2] : endTime;
  const secant = (end - start) / span;
  let startTangent = secant;
  if (hasPrevious) {
    const previous = values[index - 1];
    startTangent =
      (start - previous) / (startTime - previousTime) -
      (end - previous) / (endTime - previousTime) +
      secant;
  }
  let endTangent = secant;
  if (hasNext) {
    const next = values[index + 2];
    endTangent =
      secant -
      (next - start) / (nextTime - startTime) +
      (next - end) / (nextTime - endTime);
  }
  const uu = u * u;
  const uuu = uu * u;
  return (
    (2 * uuu - 3 * uu + 1) * start +
    (uuu - 2 * uu + u) * startTangent * span +
    (-2 * uuu + 3 * uu) * end +
    (uuu - uu) * endTangent * span
  );
}

describe("AnimationTrack precomputed tangents and span hint", () => {
  const times = [0, 0.3, 0.45, 1.1, 1.9, 2.0, 3.7];
  const values = [0, 2.5, -1, 4, 4.5, -3, 1];
  const track = new AnimationTrack({
    path: "x",
    adapter: numberAdapter,
    times,
    values,
    interpolation: "cubic",
  });

  it("is bit-identical to the original arithmetic across a dense sweep (forward, backward, jumps)", () => {
    const samples: number[] = [];
    for (let i = -5; i <= 4005; i += 1) samples.push(i * 0.001);
    const reversed = [...samples].reverse();
    const jumpy = samples.map((_, i) => samples[(i * 997) % samples.length]);
    for (const order of [samples, reversed, jumpy]) {
      for (const t of order) {
        expect(track.sample(t, 0)).toBe(oracle(times, values, t));
      }
    }
  });

  it("finds the right span for backwards seeks and loop wraps at key boundaries", () => {
    const linear = new AnimationTrack({
      path: "x",
      adapter: numberAdapter,
      times: [0, 1, 2, 3],
      values: [0, 10, 20, 30],
    });
    for (const t of [2.5, 0.5, 2.999, 1, 0.999, 1.5, 2, 0.001, 2.2]) {
      expect(linear.sample(t, 0)).toBeCloseTo(t * 10, 12);
    }
  });

  it("keeps vector tracks bit-identical per component", () => {
    const v = new AnimationTrack({
      path: "p",
      adapter: { ...vec3() },
      times: [0, 1, 2, 4],
      values: [
        new Vector3(0, 1, 2),
        new Vector3(3, -1, 0),
        new Vector3(1, 1, 1),
        new Vector3(5, 5, 5),
      ],
      interpolation: "cubic",
    });
    const x = [0, 3, 1, 5];
    const out = new Vector3();
    for (let t = 0; t <= 4; t += 0.0137) {
      expect(v.sample(t, out).x).toBe(oracle([0, 1, 2, 4], x, t));
    }
  });
});

import { vector3Adapter } from "../src/values.js";
function vec3() {
  return vector3Adapter;
}

describe("AnimationController transition bucketing", () => {
  class Widget {
    opacity = 1;
  }
  const clip = (name: string, v: number) =>
    new AnimationClip({
      name,
      tracks: [
        new AnimationTrack({
          path: "opacity",
          adapter: numberAdapter,
          times: [0, 1],
          values: [v, v],
        }),
      ],
    });

  it("preserves declaration order across interleaved any-state and specific edges", () => {
    const make = () =>
      new AnimationController({
        target: new Widget(),
        states: {
          a: clip("a", 0),
          b: clip("b", 1),
          c: clip("c", 2),
          d: clip("d", 3),
        },
        parameters: { booleans: { go: false } },
        transitions: [
          { from: "*", to: "b", when: [{ parameter: "go", is: "true" }] },
          { from: "a", to: "c", when: [{ parameter: "go", is: "true" }] },
          { from: "*", to: "d", when: [{ parameter: "go", is: "true" }] },
        ],
      }).play();

    // Any-state edge declared first wins over the later specific edge.
    const first = make();
    first.setBoolean("go", true);
    first.advance(0.1);
    expect(first.currentState).toBe("b");

    // From b: "*"->b is a self edge (skipped), the specific a->c does not
    // apply, so the later "*"->d fires.
    first.advance(0.1);
    expect(first.currentState).toBe("d");

    // From d the first edge ("*"->b) is eligible again and fires first.
    first.advance(0.1);
    expect(first.currentState).toBe("b");
  });

  it("lets a specific edge declared before an any-state edge win", () => {
    const controller = new AnimationController({
      target: new Widget(),
      states: { a: clip("a", 0), b: clip("b", 1), c: clip("c", 2) },
      parameters: { booleans: { go: false } },
      transitions: [
        { from: "a", to: "c", when: [{ parameter: "go", is: "true" }] },
        { from: "*", to: "b", when: [{ parameter: "go", is: "true" }] },
      ],
    }).play();
    controller.setBoolean("go", true);
    controller.advance(0.1);
    expect(controller.currentState).toBe("c");
  });

  it("honours allowSelf on an any-state edge", () => {
    const controller = new AnimationController({
      target: new Widget(),
      states: { a: clip("a", 0) },
      parameters: { booleans: { go: false } },
      transitions: [
        {
          from: "*",
          to: "a",
          allowSelf: true,
          when: [{ parameter: "go", is: "true" }],
        },
      ],
    }).play();
    controller.setBoolean("go", true);
    expect(() => controller.advance(0.1)).not.toThrow();
  });
});
