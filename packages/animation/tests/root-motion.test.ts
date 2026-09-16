/**
 * Root motion (§19, plan decision P7-5) — translation and rotation.
 *
 * The clip under test is a **walk cycle authored in place**: a `"rootMotion"`
 * track that ramps linearly from the origin to one {@link STRIDE} over exactly
 * one second, so the sampled value at clip time `t` is `STRIDE · t` and every
 * expectation below is a closed form rather than a recorded number.
 * Rotational tests use a 90° Y turn over the same second.
 */

import { isFourError } from "@fourjs/core";
import {
  Quaternion,
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@fourjs/math";
import { Group, Node } from "@fourjs/scene";
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { AnimationClip } from "../src/clip.js";
import { AnimationMixer } from "../src/mixer.js";
import { AnimationTrack, type AnimationTrackLike } from "../src/track.js";
import {
  colorAdapter,
  numberAdapter,
  quaternionAdapter,
  vector3Adapter,
  type ColorRGBA,
} from "../src/values.js";

/** Displacement one full loop of the walk clip covers (§7a: Y-up, seconds). */
const STRIDE = new Vector3(2, 0, -3);

/** The clip's duration in seconds, so the walk's velocity is `STRIDE / 1`. */
const WALK_SECONDS = 1;

/**
 * A node carrying a **decoy** `rootMotion` property.
 *
 * The root-motion track's path resolves against this object perfectly well —
 * which is the point: P7-5 excludes the designated track from binding, so the
 * decoy must stay at the origin no matter how far the walker travels.
 */
class Walker extends Node {
  readonly rootMotion = new Vector3();
  tint: ColorRGBA = [0, 0, 0, 1];
}

/** A walker that owns its transform under the §42 `"animation"` authority. */
function animatedWalker(): Walker {
  const walker = new Walker();
  walker.transformAuthority = "animation";
  return walker;
}

/** The `"rootMotion"` track: `STRIDE · t` over one second, linear. */
function walkTrack(): AnimationTrackLike {
  return new AnimationTrack({
    path: "rootMotion",
    adapter: vector3Adapter,
    times: [0, WALK_SECONDS],
    values: [new Vector3(0, 0, 0), STRIDE.clone()],
  });
}

/** The walk clip, optionally with extra tracks alongside the root track. */
function walkClip(...extra: readonly AnimationTrackLike[]): AnimationClip {
  return new AnimationClip({
    name: "walk",
    tracks: [walkTrack(), ...extra],
    duration: WALK_SECONDS,
  });
}

/** A color track on `tint`, ramping black → white over the same second. */
function tintTrack(): AnimationTrackLike {
  return new AnimationTrack({
    path: "tint",
    adapter: colorAdapter,
    times: [0, WALK_SECONDS],
    values: [[0, 0, 0, 1] as ColorRGBA, [1, 1, 1, 1] as ColorRGBA],
  });
}

/** `STRIDE · factor` — the closed-form displacement after `factor` strides. */
function strides(factor: number): Vector3 {
  return STRIDE.clone().scale(factor);
}

/** Component-wise comparison with room for the telescoping sum's rounding. */
function expectVector(actual: Vector3, expected: Vector3, digits = 12): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
  expect(actual.z).toBeCloseTo(expected.z, digits);
}

/** Asserts that `run` throws the §89 error every malformed mixer reports. */
function expectInvalid(run: () => unknown): Error {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(isFourError(thrown)).toBe(true);
  const error = thrown as { code: string } & Error;
  expect(error.code).toBe("INVALID_APPLICATION_STATE");
  return error;
}

/** Silences and records `console.warn` for one test. */
function spyOnWarn(): MockInstance<typeof console.warn> {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The delta itself
// ---------------------------------------------------------------------------

describe("root motion accumulation", () => {
  it("accumulates exactly v·t over N advances of a constant-velocity clip", () => {
    const walker = animatedWalker();
    const mixer = new AnimationMixer(walker);
    mixer.play(walkClip(), {
      rootMotion: { trackPath: "rootMotion", target: walker },
    });

    // Playing writes the pose for clip time 0 and moves nothing: the first
    // delta needs a second sample to difference against.
    expectVector(walker.transform.position, new Vector3(0, 0, 0));

    const steps = 10;
    const step = WALK_SECONDS / steps;
    for (let index = 1; index <= steps; index += 1) {
      mixer.advance(step);
      expectVector(walker.transform.position, strides(index * step));
    }
    expectVector(walker.transform.position, STRIDE);
  });

  it("is unaffected by how the same interval is subdivided", () => {
    const coarse = animatedWalker();
    const fine = animatedWalker();
    const options = { trackPath: "rootMotion" };
    new AnimationMixer(coarse)
      .play(walkClip(), { rootMotion: { ...options, target: coarse } })
      .advance(0.5);
    const fineMixer = new AnimationMixer(fine).play(walkClip(), {
      rootMotion: { ...options, target: fine },
    });
    for (let index = 0; index < 5; index += 1) {
      fineMixer.advance(0.1);
    }

    expectVector(coarse.transform.position, strides(0.5));
    expectVector(fine.transform.position, strides(0.5));
  });

  it("scales with the playback speed multiplier", () => {
    const walker = animatedWalker();
    new AnimationMixer(walker)
      .play(walkClip(), {
        speed: 2,
        rootMotion: { trackPath: "rootMotion", target: walker },
      })
      .advance(0.25);

    // 0.25 s of advance is 0.5 s of clip.
    expectVector(walker.transform.position, strides(0.5));
  });

  it("adds to whatever position the node already had", () => {
    const walker = animatedWalker();
    walker.transform.position.set(10, 20, 30);
    new AnimationMixer(walker)
      .play(walkClip(), {
        rootMotion: { trackPath: "rootMotion", target: walker },
      })
      .advance(WALK_SECONDS);

    expectVector(
      walker.transform.position,
      new Vector3(10, 20, 30).add(STRIDE),
    );
  });

  it("bumps the transform version, so the world matrix is not stale (D3)", () => {
    const walker = animatedWalker();
    const mixer = new AnimationMixer(walker).play(walkClip(), {
      rootMotion: { trackPath: "rootMotion", target: walker },
    });
    const before = walker.transform.version;
    mixer.advance(0.5);

    expect(walker.transform.version).toBeGreaterThan(before);
  });

  it("moves a root node that is not the mixer's target", () => {
    const walker = new Walker();
    const root = new Group();
    root.transformAuthority = "animation";
    new AnimationMixer(walker)
      .play(walkClip(), {
        rootMotion: { trackPath: "rootMotion", target: root },
      })
      .advance(WALK_SECONDS);

    expectVector(root.transform.position, STRIDE);
    expectVector(walker.transform.position, new Vector3(0, 0, 0));
  });

  it("stops moving once playback has finished", () => {
    const walker = animatedWalker();
    const mixer = new AnimationMixer(walker).play(walkClip(), {
      rootMotion: { trackPath: "rootMotion", target: walker },
    });
    mixer.advance(WALK_SECONDS);
    expect(mixer.state).toBe("finished");
    mixer.advance(WALK_SECONDS);

    expectVector(walker.transform.position, STRIDE);
  });

  it("stops moving after stop()", () => {
    const walker = animatedWalker();
    const mixer = new AnimationMixer(walker).play(walkClip(), {
      rootMotion: { trackPath: "rootMotion", target: walker },
    });
    mixer.advance(0.5).stop().advance(0.5);

    expectVector(walker.transform.position, strides(0.5));
  });
});

// ---------------------------------------------------------------------------
// Looping (the wrap derivation)
// ---------------------------------------------------------------------------

describe("root motion across loop wraps", () => {
  it("accumulates one full stride per loop with no teleport back", () => {
    const walker = animatedWalker();
    const mixer = new AnimationMixer(walker).play(walkClip(), {
      loop: 3,
      rootMotion: { trackPath: "rootMotion", target: walker },
    });

    // 0.3 s steps never land on an iteration boundary, so every wrap is
    // crossed mid-step — the case naive differencing gets wrong.
    let previousAlongX = 0;
    // Eleven steps, because ten accumulate to 2.999…: the last one is what
    // carries the playback to its end.
    for (let index = 1; index <= 11; index += 1) {
      mixer.advance(0.3);
      const travelled = Math.min(index * 0.3, 3);
      expectVector(walker.transform.position, strides(travelled));
      expect(walker.transform.position.x).toBeGreaterThan(previousAlongX);
      previousAlongX = walker.transform.position.x;
    }
    expect(mixer.finished).toBe(true);
    expectVector(walker.transform.position, strides(3));
  });

  it("handles an advance that lands exactly on the seam", () => {
    const walker = animatedWalker();
    const mixer = new AnimationMixer(walker).play(walkClip(), {
      loop: 2,
      rootMotion: { trackPath: "rootMotion", target: walker },
    });

    mixer.advance(0.5);
    mixer.advance(0.5); // lands on elapsed 1.0 — local time 0 of iteration 1
    expectVector(walker.transform.position, strides(1));
    mixer.advance(0.5);
    expectVector(walker.transform.position, strides(1.5));
  });

  it("swallows whole iterations in one advance", () => {
    const walker = animatedWalker();
    new AnimationMixer(walker)
      .play(walkClip(), {
        loop: 4,
        rootMotion: { trackPath: "rootMotion", target: walker },
      })
      .advance(0.5)
      .advance(2.5); // 2½ strides in a single step, crossing two seams

    expectVector(walker.transform.position, strides(3));
  });

  it("travels loop × stride for an infinite loop too", () => {
    const walker = animatedWalker();
    const mixer = new AnimationMixer(walker).play(walkClip(), {
      loop: Infinity,
      rootMotion: { trackPath: "rootMotion", target: walker },
    });
    for (let index = 0; index < 25; index += 1) {
      mixer.advance(0.2);
    }

    expect(mixer.finished).toBe(false);
    expectVector(walker.transform.position, strides(5));
  });

  it("credits the final stride of a looping playback", () => {
    const walker = animatedWalker();
    new AnimationMixer(walker)
      .play(walkClip(), {
        loop: 2,
        rootMotion: { trackPath: "rootMotion", target: walker },
      })
      .advance(10); // clamps to totalDuration

    expectVector(walker.transform.position, strides(2));
  });
});

// ---------------------------------------------------------------------------
// Seeking (§16 pure evaluation)
// ---------------------------------------------------------------------------

describe("root motion under seek", () => {
  it("applies no delta and differences the next advance from the sought time", () => {
    const walker = animatedWalker();
    const mixer = new AnimationMixer(walker).play(walkClip(), {
      rootMotion: { trackPath: "rootMotion", target: walker },
    });

    mixer.advance(0.5);
    expectVector(walker.transform.position, strides(0.5));

    mixer.seek(0.25);
    expectVector(walker.transform.position, strides(0.5));

    mixer.advance(0.25); // 0.25 → 0.5 of clip time: a quarter stride
    expectVector(walker.transform.position, strides(0.75));
  });

  it("never locomotes, however much it scrubs", () => {
    const walker = animatedWalker();
    const mixer = new AnimationMixer(walker).play(walkClip(), {
      loop: 2,
      rootMotion: { trackPath: "rootMotion", target: walker },
    });
    for (const time of [0.9, 0.1, 1.7, 0, 2, 0.4]) {
      mixer.seek(time);
    }

    expectVector(walker.transform.position, new Vector3(0, 0, 0));
  });

  it("is inert on a stopped mixer", () => {
    const walker = animatedWalker();
    const mixer = new AnimationMixer(walker).play(walkClip(), {
      rootMotion: { trackPath: "rootMotion", target: walker },
    });
    mixer.advance(0.5).stop().seek(0.9);

    expectVector(walker.transform.position, strides(0.5));
  });
});

// ---------------------------------------------------------------------------
// §42 authority
// ---------------------------------------------------------------------------

describe("root motion authority (§42)", () => {
  it("warns once and drops the deltas of a node it does not own", () => {
    const warn = spyOnWarn();
    const walker = new Walker(); // default authority: "manual"
    const mixer = new AnimationMixer(walker).play(walkClip(), {
      rootMotion: { trackPath: "rootMotion", target: walker },
    });
    for (let index = 0; index < 5; index += 1) {
      mixer.advance(0.1);
    }

    expectVector(walker.transform.position, new Vector3(0, 0, 0));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("animation");
  });

  it("drops refused deltas rather than banking them", () => {
    spyOnWarn();
    const walker = new Walker();
    const mixer = new AnimationMixer(walker).play(walkClip(), {
      rootMotion: { trackPath: "rootMotion", target: walker },
    });
    mixer.advance(0.5); // refused
    walker.transformAuthority = "animation";
    mixer.advance(0.25); // granted: only this quarter stride lands

    expectVector(walker.transform.position, strides(0.25));
  });

  it("gates on the root node, not on the mixer's own target", () => {
    const warn = spyOnWarn();
    const walker = animatedWalker(); // owns its own transform
    const root = new Group(); // …but the root does not
    new AnimationMixer(walker)
      .play(walkClip(), {
        rootMotion: { trackPath: "rootMotion", target: root },
      })
      .advance(0.5);

    expectVector(root.transform.position, new Vector3(0, 0, 0));
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Exclusion from binding, and the other tracks
// ---------------------------------------------------------------------------

describe("root motion and the rest of the clip", () => {
  it("never writes the designated track's bound property", () => {
    const walker = animatedWalker();
    new AnimationMixer(walker)
      .play(walkClip(), {
        rootMotion: { trackPath: "rootMotion", target: walker },
      })
      .advance(WALK_SECONDS);

    // The decoy property the path resolves to is untouched…
    expectVector(walker.rootMotion, new Vector3(0, 0, 0));
    // …while the node itself travelled a full stride.
    expectVector(walker.transform.position, STRIDE);
  });

  it("binds and writes the clip's other tracks as usual", () => {
    const walker = animatedWalker();
    new AnimationMixer(walker)
      .play(walkClip(tintTrack()), {
        rootMotion: { trackPath: "rootMotion", target: walker },
      })
      .advance(0.5);

    expect(walker.tint[0]).toBeCloseTo(0.5, 12);
    expect(walker.tint[1]).toBeCloseTo(0.5, 12);
    expectVector(walker.rootMotion, new Vector3(0, 0, 0));
    expectVector(walker.transform.position, strides(0.5));
  });

  it("needs no property at all behind the designated path", () => {
    const root = new Group();
    root.transformAuthority = "animation";
    const target = { tint: [0, 0, 0, 1] as ColorRGBA };
    // `target` has no `rootMotion` property: binding it would throw.
    new AnimationMixer(target)
      .play(walkClip(tintTrack()), {
        rootMotion: { trackPath: "rootMotion", target: root },
      })
      .advance(WALK_SECONDS);

    expect(target.tint[0]).toBeCloseTo(1, 12);
    expectVector(root.transform.position, STRIDE);
  });
});

// ---------------------------------------------------------------------------
// Validation (play time)
// ---------------------------------------------------------------------------

describe("root motion validation", () => {
  it("rejects a path the clip does not have", () => {
    const walker = animatedWalker();
    const error = expectInvalid(() =>
      new AnimationMixer(walker).play(walkClip(), {
        rootMotion: { trackPath: "hips", target: walker },
      }),
    );

    expect(error.message).toContain("hips");
  });

  it("rejects an ambiguous path carried by two tracks", () => {
    const walker = animatedWalker();
    const clip = new AnimationClip({
      name: "walk",
      tracks: [walkTrack(), walkTrack()],
      duration: WALK_SECONDS,
    });
    const error = expectInvalid(() =>
      new AnimationMixer(walker).play(clip, {
        rootMotion: { trackPath: "rootMotion", target: walker },
      }),
    );

    expect(error.message).toContain("more than one track");
  });

  it("rejects a track whose values are not translations", () => {
    const walker = animatedWalker();
    const clip = new AnimationClip({
      name: "walk",
      tracks: [
        new AnimationTrack({
          path: "rootMotion",
          adapter: numberAdapter,
          times: [0, 1],
          values: [0, 1],
        }),
      ],
      duration: WALK_SECONDS,
    });
    const error = expectInvalid(() =>
      new AnimationMixer(walker).play(clip, {
        rootMotion: { trackPath: "rootMotion", target: walker },
      }),
    );

    expect(error.message).toContain("vector3");
  });

  it("extracts rotation from a quaternion track", () => {
    const walker = animatedWalker();
    const from = new Quaternion();
    const to = new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      Math.PI / 2,
    );
    const clip = new AnimationClip({
      name: "turn",
      tracks: [
        new AnimationTrack({
          path: "rootMotion",
          adapter: quaternionAdapter,
          times: [0, WALK_SECONDS],
          values: [from, to],
        }),
      ],
      duration: WALK_SECONDS,
    });
    new AnimationMixer(walker)
      .play(clip, {
        rootMotion: { trackPath: "rootMotion", target: walker },
      })
      .advance(WALK_SECONDS);

    expect(walker.transform.rotation.x).toBeCloseTo(to.x, 12);
    expect(walker.transform.rotation.y).toBeCloseTo(to.y, 12);
    expect(walker.transform.rotation.z).toBeCloseTo(to.z, 12);
    expect(walker.transform.rotation.w).toBeCloseTo(to.w, 12);
  });

  it("composes a quaternion delta onto the node's existing rotation", () => {
    const walker = animatedWalker();
    walker.transform.rotation.setFromAxisAngle(
      new Vector3(0, 1, 0),
      Math.PI / 2,
    );
    const from = new Quaternion();
    const to = new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      Math.PI / 2,
    );
    const clip = new AnimationClip({
      name: "turn",
      tracks: [
        new AnimationTrack({
          path: "rootMotion",
          adapter: quaternionAdapter,
          times: [0, WALK_SECONDS],
          values: [from, to],
        }),
      ],
      duration: WALK_SECONDS,
    });
    new AnimationMixer(walker)
      .play(clip, {
        rootMotion: { trackPath: "rootMotion", target: walker },
      })
      .advance(WALK_SECONDS);

    const expected = new Quaternion()
      .setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
      .multiply(to);
    expect(walker.transform.rotation.y).toBeCloseTo(expected.y, 12);
    expect(walker.transform.rotation.w).toBeCloseTo(expected.w, 12);
  });

  it("accumulates one full turn per loop with no snap back", () => {
    const walker = animatedWalker();
    const from = new Quaternion();
    const to = new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      Math.PI / 2,
    );
    const clip = new AnimationClip({
      name: "turn",
      tracks: [
        new AnimationTrack({
          path: "rootMotion",
          adapter: quaternionAdapter,
          times: [0, WALK_SECONDS],
          values: [from, to],
        }),
      ],
      duration: WALK_SECONDS,
    });
    new AnimationMixer(walker)
      .play(clip, {
        loop: 2,
        rootMotion: { trackPath: "rootMotion", target: walker },
      })
      .advance(2);

    const expected = new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      Math.PI,
    );
    expect(walker.transform.rotation.y).toBeCloseTo(expected.y, 12);
    expect(walker.transform.rotation.w).toBeCloseTo(expected.w, 12);
  });

  it("leaves a mixer with no root motion untouched", () => {
    const walker = animatedWalker();
    const mixer = new AnimationMixer(walker).play(walkClip(tintTrack()));
    mixer.advance(0.5).seek(0.25);

    expectVector(walker.transform.position, new Vector3(0, 0, 0));
    // Without the option the track binds normally and writes its samples.
    expectVector(walker.rootMotion, strides(0.25));
  });
});

// ---------------------------------------------------------------------------
// §7b allocation and §33 determinism
// ---------------------------------------------------------------------------

describe("root motion budgets", () => {
  it("allocates nothing on the advance path (§7b)", () => {
    const walker = animatedWalker();
    const mixer = new AnimationMixer(walker).play(walkClip(tintTrack()), {
      loop: 4,
      rootMotion: { trackPath: "rootMotion", target: walker },
    });

    resetConstructionCount();
    for (let index = 0; index < 40; index += 1) {
      mixer.advance(0.07); // crosses several seams
    }
    const constructed = constructionCount();

    expect(constructed).toBe(0);
  });

  it("allocates nothing on the seek path either", () => {
    const walker = animatedWalker();
    const mixer = new AnimationMixer(walker).play(walkClip(), {
      loop: 2,
      rootMotion: { trackPath: "rootMotion", target: walker },
    });

    resetConstructionCount();
    for (const time of [1.4, 0.2, 1.9, 0.6]) {
      mixer.seek(time);
    }

    expect(constructionCount()).toBe(0);
  });

  it("is bit-for-bit reproducible across identical runs (§33)", () => {
    const positions: Vector3[] = [];
    for (let run = 0; run < 2; run += 1) {
      const walker = animatedWalker();
      const mixer = new AnimationMixer(walker).play(walkClip(), {
        loop: 3,
        rootMotion: { trackPath: "rootMotion", target: walker },
      });
      for (let index = 0; index < 17; index += 1) {
        mixer.advance(0.13);
      }
      mixer.seek(0.4);
      mixer.advance(0.13);
      positions.push(walker.transform.position.clone());
    }

    expect(positions[1].x).toBe(positions[0].x);
    expect(positions[1].y).toBe(positions[0].y);
    expect(positions[1].z).toBe(positions[0].z);
  });
});
