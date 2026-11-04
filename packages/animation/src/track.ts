/**
 * Animation tracks (§17).
 *
 * A track is a **typed keyframe sequence over clip-local time** (§9: animation
 * time is clip-local and lives on players and clips, never in the global
 * `TimeState`). It is pure data plus one pure function:
 * {@link AnimationTrack.sample} maps a time in seconds to a value, and the same
 * time always yields the same value (§16 "value tracks are a pure function of
 * timeline time", §33 determinism).
 *
 * ## Tracks hold no binding
 *
 * A track carries a **property path string** and nothing else about its target.
 * Resolving that path to a live property is the mixer's job (WP-4.6), done once
 * per target through `createBinding` (§16: "string-path convenience forms are
 * resolved once, at creation time"). Keeping the binding out of the track is
 * what lets one clip drive many targets, be serialized, and be compared for
 * equality without dragging a scene graph along.
 *
 * ## Track types (§17)
 *
 * §17 lists scalar, vector, quaternion, color, Boolean, discrete, morph weight,
 * skeletal joint, and custom property. The first six and the last are covered
 * here by supplying the matching {@link ValueAdapter} from `./values.js`:
 *
 * | §17 track type    | adapter                                     |
 * | ----------------- | ------------------------------------------- |
 * | scalar            | `numberAdapter`                             |
 * | vector            | `vector2Adapter` / `vector3Adapter` / `vector4Adapter` |
 * | quaternion        | `quaternionAdapter` (slerp — see below)     |
 * | color             | `colorAdapter` (RGBA 4-tuple, plan P4-2)    |
 * | Boolean           | `booleanAdapter`                            |
 * | discrete          | `discreteAdapterFor<T>()`                   |
 * | custom property   | any caller-supplied `ValueAdapter<T>`       |
 *
 * The track takes the adapter directly rather than a second track-type
 * discriminant: {@link ValueAdapter.kind} already *is* that discriminant, and a
 * parallel enum would only have to be kept in sync with it.
 *
 * **Morph-weight and skeletal-joint tracks are binding forms, not track
 * types** — §17's list is 9 of 9 as of RFC 0003 (2026-08-28), and this
 * paragraph corrects the staged note that used to stand here (P4-3 promised
 * the two would "add their kinds to `ValueKind`"; read against the shipped
 * design, that is not what they need, and §17's amendment records why —
 * duplicate discriminants for values the adapters already represent). A
 * *skeletal joint* track animates a bone's translation/rotation/scale: those
 * are `vector3` and `quaternion` values, the `quaternionAdapter` already
 * slerps (§17's fifth interpolation entry), and a bone is addressed through
 * `Skeleton.bones` — `"bones.3.transform.rotation"`, insertion order being
 * the ABI (§33). A *morph weight* track animates a `number` into one element
 * of the `MorphWeights` component's array — `"weights.0"`. Both resolve
 * through the indexed-array binding form `./binding.js` documents; no new
 * `ValueKind`, adapter, or track type exists.
 *
 * ## Interpolation modes (§17)
 *
 * `"step" | "linear" | "cubic" | "hermite"`, plus §17's fifth entry — "spherical
 * linear interpolation for quaternions" — which is not a separate mode here but
 * a property of the quaternion *adapter*: `quaternionAdapter.lerp` is
 * `Quaternion.slerp`, shortest-arc. A quaternion track in `"linear"` mode
 * therefore slerps, which is exactly what §17 asks for, without letting a caller
 * select a nonsensical component-wise lerp of a rotation.
 *
 * `"cubic"` and `"hermite"` need more than an adapter can express — they take
 * weighted sums of four values, not a two-point mix — so they read a value's
 * numeric components directly, chosen by {@link ValueAdapter.kind}. They are
 * available for `number`, `vector2`, `vector3`, `vector4`, and `color`, and are
 * rejected at construction for `quaternion` (cubic quaternion interpolation is
 * squad, which needs its own log/exp machinery and is out of Phase 4 scope),
 * `boolean`, and `discrete` (no meaningful arithmetic). A custom adapter
 * inherits the rules of the `kind` it declares, so it must use a kind whose
 * runtime shape matches — `number` → a number, `vector3` → an object with
 * `x`/`y`/`z`, `color` → a 4-element array — or stay on `"step"`/`"linear"`.
 *
 * ## Allocation (§7b, plan D7)
 *
 * Construction allocates (it copies its input arrays). {@link
 * AnimationTrack.sample} allocates nothing, ever: the span search is integer
 * arithmetic, the two-point modes delegate to the adapter's `out` path, and the
 * cubic and Hermite modes work in a per-instance `Float64Array` sized once at
 * construction.
 *
 * `sample` honours the same return-value contract as the adapters: it **returns
 * the effective value**, which is the mutated `out` for in-place kinds and the
 * value itself for primitives and discrete values (see `./values.js`). `out`
 * must not alias any of the track's keyframe values.
 */

import { FourError } from "@fourjs/core";
import type { Vector2, Vector3, Vector4 } from "@fourjs/math";

import type { ColorRGBA, ValueAdapter, ValueKind } from "./values.js";

/**
 * §17's interpolation modes.
 *
 * - `"step"` — hold the left keyframe's value until the next keyframe is
 *   reached. The only honest mode for Boolean and discrete tracks.
 * - `"linear"` — straight two-point mix through {@link ValueAdapter.lerp}; for
 *   a quaternion track that mix is shortest-arc slerp (§17's fifth mode).
 * - `"cubic"` — Catmull-Rom: tangents derived from each key's neighbours.
 * - `"hermite"` — cubic with explicit per-key in/out tangents.
 */
export type InterpolationMode = "step" | "linear" | "cubic" | "hermite";

/** Shared empty scratch for tracks that never evaluate a cubic. */
const NO_SCRATCH = new Float64Array(0);

/** Shared empty tangent array for tracks that are not Hermite. */
const NO_TANGENTS: readonly never[] = [];

/**
 * How the components of one value kind are read out of a value and written back
 * into one — the extra capability `"cubic"` and `"hermite"` need and {@link
 * ValueAdapter} deliberately does not have.
 *
 * Implementations are stateless singletons, selected once per track by
 * {@link layoutFor}.
 */
interface ComponentLayout {
  /** Number of scalar components in one value. */
  readonly size: number;
  /** Copies `value`'s components into `into` starting at `offset`. */
  read(value: unknown, into: Float64Array, offset: number): void;
  /**
   * Writes `size` components read from `from[offset…]` and returns the
   * effective value — the mutated `out` for reference kinds, the number itself
   * for `"number"`, mirroring {@link ValueAdapter.mutatesInPlace}.
   */
  write(from: Float64Array, offset: number, out: unknown): unknown;
}

/** Scalar layout: one component, returned by value (`out` is ignored). */
const numberLayout: ComponentLayout = {
  size: 1,
  read(value: unknown, into: Float64Array, offset: number): void {
    into[offset] = value as number;
  },
  write(from: Float64Array, offset: number): unknown {
    return from[offset];
  },
};

/** Vector2 layout over `x`, `y`. */
const vector2Layout: ComponentLayout = {
  size: 2,
  read(value: unknown, into: Float64Array, offset: number): void {
    const v = value as Vector2;
    into[offset] = v.x;
    into[offset + 1] = v.y;
  },
  write(from: Float64Array, offset: number, out: unknown): unknown {
    return (out as Vector2).set(from[offset], from[offset + 1]);
  },
};

/** Vector3 layout over `x`, `y`, `z`. */
const vector3Layout: ComponentLayout = {
  size: 3,
  read(value: unknown, into: Float64Array, offset: number): void {
    const v = value as Vector3;
    into[offset] = v.x;
    into[offset + 1] = v.y;
    into[offset + 2] = v.z;
  },
  write(from: Float64Array, offset: number, out: unknown): unknown {
    return (out as Vector3).set(
      from[offset],
      from[offset + 1],
      from[offset + 2],
    );
  },
};

/** Vector4 layout over `x`, `y`, `z`, `w`. */
const vector4Layout: ComponentLayout = {
  size: 4,
  read(value: unknown, into: Float64Array, offset: number): void {
    const v = value as Vector4;
    into[offset] = v.x;
    into[offset + 1] = v.y;
    into[offset + 2] = v.z;
    into[offset + 3] = v.w;
  },
  write(from: Float64Array, offset: number, out: unknown): unknown {
    return (out as Vector4).set(
      from[offset],
      from[offset + 1],
      from[offset + 2],
      from[offset + 3],
    );
  },
};

/**
 * Color layout over the RGBA 4-tuple (plan P4-2). No clamping anywhere — §60a
 * is a linear-light pipeline with extended range, and a cubic legitimately
 * overshoots (see {@link AnimationTrack} on overshoot).
 */
const colorLayout: ComponentLayout = {
  size: 4,
  read(value: unknown, into: Float64Array, offset: number): void {
    const c = value as ColorRGBA;
    into[offset] = c[0];
    into[offset + 1] = c[1];
    into[offset + 2] = c[2];
    into[offset + 3] = c[3];
  },
  write(from: Float64Array, offset: number, out: unknown): unknown {
    const c = out as ColorRGBA;
    c[0] = from[offset];
    c[1] = from[offset + 1];
    c[2] = from[offset + 2];
    c[3] = from[offset + 3];
    return c;
  },
};

/** The layout for `kind`, or `undefined` when the kind has no arithmetic. */
function layoutFor(kind: ValueKind): ComponentLayout | undefined {
  switch (kind) {
    case "number":
      return numberLayout;
    case "vector2":
      return vector2Layout;
    case "vector3":
      return vector3Layout;
    case "vector4":
      return vector4Layout;
    case "color":
      return colorLayout;
    default:
      return undefined;
  }
}

/** Throws the §89 error used for every malformed track. */
function invalidTrack(
  message: string,
  context: Record<string, unknown>,
): never {
  throw new FourError("INVALID_APPLICATION_STATE", message, { context });
}

/** Construction inputs for {@link AnimationTrack}. */
export interface AnimationTrackOptions<T> {
  /**
   * Dot-separated property path relative to the mixer's target, resolved by the
   * mixer and never by the track (`"transform.position"`, `"opacity"`). Must be
   * non-empty; its *resolvability* is checked when it is bound, not here.
   */
  path: string;

  /**
   * Adapter for this track's value type — also the §17 track-type discriminant
   * (see the module header's table).
   */
  adapter: ValueAdapter<T>;

  /**
   * Keyframe times in **seconds**, clip-local, **strictly increasing** and
   * finite. At least one. Copied.
   */
  times: readonly number[];

  /**
   * Keyframe values, one per entry of {@link AnimationTrackOptions.times}. The
   * array is copied; the values themselves are held **by reference** and must
   * not be mutated afterwards.
   */
  values: readonly T[];

  /** Interpolation mode (§17). Defaults to `"linear"`. */
  interpolation?: InterpolationMode;

  /**
   * Incoming tangent per key, required by — and only used by — `"hermite"`.
   * Same length as `times`. Entry 0 is never read (no segment ends at the first
   * key) but is required so the arrays stay index-parallel. See {@link
   * AnimationTrackOptions.outTangents} for the units.
   */
  inTangents?: readonly T[];

  /**
   * Outgoing tangent per key, required by — and only used by — `"hermite"`.
   * Same length as `times`. The last entry is never read (no segment starts at
   * the last key).
   *
   * Tangents are **derivatives with respect to clip time**, i.e. value units
   * *per second*, matching the tangents `"cubic"` derives for itself. A segment
   * uses the left key's out tangent and the right key's in tangent.
   */
  outTangents?: readonly T[];
}

/**
 * A typed keyframe sequence over clip-local time (§17).
 *
 * ```ts
 * const track = new AnimationTrack({
 *   path: "transform.position",
 *   adapter: vector3Adapter,
 *   times: [0, 0.5, 1],                      // seconds (§7a)
 *   values: [new Vector3(0, 0, 0), new Vector3(0, 2, 0), new Vector3(0, 0, 0)],
 *   interpolation: "cubic",
 * });
 * track.sample(0.25, out);                   // → out, mutated
 * ```
 *
 * ## Sampling outside the key range
 *
 * **Clamped**, not extrapolated: below the first key the first value is
 * returned, at or above the last key the last one. This differs from §13's
 * trajectories, which extrapolate their closed forms, and the difference is
 * deliberate — a trajectory is a curve that happens to be parameterized by time,
 * while a clip track is authored content with a beginning and an end. Repeating,
 * ping-ponging, and holding past the end are the *player's* decisions (WP-4.6),
 * made by transforming the time it passes in; a track that extrapolated would
 * fight every one of them.
 *
 * Sampling time must be finite: nothing is validated on the sample path (it is
 * per-frame, per-track code), so a non-finite time propagates into the result
 * rather than throwing.
 *
 * ## Overshoot
 *
 * `"cubic"` and `"hermite"` can leave the interval spanned by their keyframes —
 * that is what makes them useful for anticipation and follow-through — and
 * nothing here clamps them back. A track whose values must stay in range uses
 * `"linear"` or `"step"`.
 *
 * @typeParam T The track's value type, matching its adapter.
 */
export class AnimationTrack<T> implements AnimationTrackLike {
  /** Property path, resolved by the mixer (see the module header). */
  readonly path: string;

  /** Adapter for this track's value type; also its §17 track type. */
  readonly adapter: ValueAdapter<T>;

  /** Interpolation mode (§17). */
  readonly interpolation: InterpolationMode;

  /** Keyframe times in seconds, strictly increasing. */
  readonly times: readonly number[];

  /** Keyframe values, index-parallel with {@link AnimationTrack.times}. */
  readonly values: readonly T[];

  /** Per-key incoming tangents; empty unless the mode is `"hermite"`. */
  readonly inTangents: readonly T[];

  /** Per-key outgoing tangents; empty unless the mode is `"hermite"`. */
  readonly outTangents: readonly T[];

  /** First keyframe time in seconds. */
  readonly startTime: number;

  /** Last keyframe time in seconds. */
  readonly endTime: number;

  /** Component layout for the cubic modes; a no-op stand-in otherwise. */
  readonly #layout: ComponentLayout;

  /**
   * Scratch for the cubic modes: five slots of `#layout.size` — the four
   * contributing values and the result — allocated once so sampling cannot.
   */
  /** Span hint for {@link AnimationTrack.#spanIndex}; always a valid span. */
  #lastSpan = 0;
  /** Precomputed Catmull-Rom tangents; empty unless cubic. */
  readonly #cubicTangents: Float64Array;
  readonly #scratch: Float64Array;

  /**
   * @throws FourError `INVALID_APPLICATION_STATE` — empty path; no keyframes;
   * `values` not the same length as `times`; a non-finite or non-increasing
   * keyframe time; a cubic/Hermite mode on a value kind with no component
   * arithmetic; or missing/mismatched tangent arrays for `"hermite"`.
   */
  constructor(options: AnimationTrackOptions<T>) {
    const { path, adapter, times, values } = options;
    const interpolation = options.interpolation ?? "linear";

    if (path.length === 0) {
      invalidTrack("An animation track needs a non-empty property path.", {
        path,
      });
    }
    if (times.length === 0) {
      invalidTrack(`Animation track "${path}" needs at least one keyframe.`, {
        path,
      });
    }
    if (values.length !== times.length) {
      invalidTrack(
        `Animation track "${path}" has ${String(times.length)} keyframe times but ${String(values.length)} values.`,
        { path, times: times.length, values: values.length },
      );
    }
    for (let index = 0; index < times.length; index += 1) {
      const time = times[index];
      if (!Number.isFinite(time)) {
        invalidTrack(
          `Animation track "${path}" has a non-finite keyframe time at index ${String(index)}: ${String(time)}.`,
          { path, index, time },
        );
      }
      if (index > 0 && time <= times[index - 1]) {
        invalidTrack(
          `Animation track "${path}" keyframe times must be strictly increasing (§17); index ${String(index)} is ${String(time)} after ${String(times[index - 1])}.`,
          { path, index, time, previous: times[index - 1] },
        );
      }
    }

    const needsComponents =
      interpolation === "cubic" || interpolation === "hermite";
    const layout = needsComponents ? layoutFor(adapter.kind) : undefined;
    if (needsComponents && layout === undefined) {
      invalidTrack(
        `Animation track "${path}" cannot use "${interpolation}" interpolation with a "${adapter.kind}" value: only number, vector2/3/4, and color values have the component arithmetic a cubic needs. Use "step" or "linear".`,
        { path, interpolation, kind: adapter.kind },
      );
    }

    let inTangents: readonly T[] = NO_TANGENTS;
    let outTangents: readonly T[] = NO_TANGENTS;
    if (interpolation === "hermite") {
      const givenIn = options.inTangents;
      const givenOut = options.outTangents;
      if (givenIn === undefined || givenOut === undefined) {
        invalidTrack(
          `Animation track "${path}" uses "hermite" interpolation, which requires both inTangents and outTangents.`,
          { path },
        );
      }
      if (givenIn.length !== times.length || givenOut.length !== times.length) {
        invalidTrack(
          `Animation track "${path}" needs one in and one out tangent per keyframe: ${String(times.length)} times, ${String(givenIn.length)} in, ${String(givenOut.length)} out.`,
          {
            path,
            times: times.length,
            inTangents: givenIn.length,
            outTangents: givenOut.length,
          },
        );
      }
      inTangents = [...givenIn];
      outTangents = [...givenOut];
    }

    this.path = path;
    this.adapter = adapter;
    this.interpolation = interpolation;
    this.times = [...times];
    this.values = [...values];
    this.inTangents = inTangents;
    this.outTangents = outTangents;
    this.startTime = times[0];
    this.endTime = times[times.length - 1];
    this.#layout = layout ?? numberLayout;
    this.#scratch =
      layout === undefined ? NO_SCRATCH : new Float64Array(layout.size * 5);
    this.#cubicTangents =
      interpolation === "cubic" && layout !== undefined
        ? this.#buildCubicTangents(layout)
        : NO_SCRATCH;
  }

  /**
   * Catmull-Rom tangents (per second) for every span, laid out
   * `[(span * 2 + end) * size + component]` (`end` 0 = start tangent, 1 = end
   * tangent). Stored per span, not per key, because the start tangent of span
   * `k` and the end tangent of span `k - 1` are algebraically equal but are
   * evaluated in different operation orders; per-span storage keeps samples
   * bit-identical to the original per-sample arithmetic.
   */
  #buildCubicTangents(layout: ComponentLayout): Float64Array {
    const { times, values } = this;
    const size = layout.size;
    const spans = times.length - 1;
    const tangents = new Float64Array(Math.max(spans, 0) * 2 * size);
    const read = new Float64Array(size * 4);
    const [previousSlot, startSlot, endSlot, nextSlot] = [
      0,
      size,
      size * 2,
      size * 3,
    ];
    for (let index = 0; index < spans; index += 1) {
      const hasPrevious = index > 0;
      const hasNext = index + 2 < times.length;
      layout.read(values[index], read, startSlot);
      layout.read(values[index + 1], read, endSlot);
      if (hasPrevious) {
        layout.read(values[index - 1], read, previousSlot);
      }
      if (hasNext) {
        layout.read(values[index + 2], read, nextSlot);
      }
      const startTime = times[index];
      const endTime = times[index + 1];
      const spanSeconds = endTime - startTime;
      const previousTime = hasPrevious ? times[index - 1] : startTime;
      const nextTime = hasNext ? times[index + 2] : endTime;
      for (let component = 0; component < size; component += 1) {
        const start = read[startSlot + component];
        const end = read[endSlot + component];
        const secant = (end - start) / spanSeconds;
        let startTangent = secant;
        if (hasPrevious) {
          const previous = read[previousSlot + component];
          startTangent =
            (start - previous) / (startTime - previousTime) -
            (end - previous) / (endTime - previousTime) +
            secant;
        }
        let endTangent = secant;
        if (hasNext) {
          const next = read[nextSlot + component];
          endTangent =
            secant -
            (next - start) / (nextTime - startTime) +
            (next - end) / (nextTime - endTime);
        }
        tangents[index * 2 * size + component] = startTangent;
        tangents[(index * 2 + 1) * size + component] = endTangent;
      }
    }
    return tangents;
  }

  /** Number of keyframes; always at least one. */
  get keyframeCount(): number {
    return this.times.length;
  }

  /**
   * Evaluates the track at `timeSeconds` (clip-local) and returns the effective
   * value: the mutated `out` for in-place value kinds, the computed value
   * itself for `number`, `boolean`, and discrete kinds. **Callers must use the
   * return value** — the same split as {@link ValueAdapter.lerp}, for the same
   * reason (a primitive has no storage to write through).
   *
   * Pure and allocation-free. `out` must not alias a keyframe value.
   */
  sample(timeSeconds: number, out: T): T {
    const times = this.times;
    const values = this.values;
    const lastIndex = times.length - 1;

    if (lastIndex === 0 || timeSeconds <= times[0]) {
      return this.adapter.copy(values[0], out);
    }
    if (timeSeconds >= times[lastIndex]) {
      return this.adapter.copy(values[lastIndex], out);
    }

    const index = this.#spanIndex(timeSeconds);
    const spanStart = times[index];
    const spanSeconds = times[index + 1] - spanStart;
    const u = (timeSeconds - spanStart) / spanSeconds;

    if (this.interpolation === "step") {
      return this.adapter.copy(values[index], out);
    }
    if (this.interpolation === "linear") {
      return this.adapter.lerp(values[index], values[index + 1], u, out);
    }
    if (this.interpolation === "cubic") {
      return this.#sampleCubic(index, u, spanSeconds, out);
    }
    return this.#sampleHermite(index, u, spanSeconds, out);
  }

  /**
   * Index of the span containing `timeSeconds`: the largest `i` with
   * `times[i] <= timeSeconds`, restricted to `[0, keyframeCount - 2]`.
   *
   * Binary search, so a thousand-key track costs ten comparisons instead of a
   * thousand. Called only when `times[0] < timeSeconds < times[last]`, which
   * {@link AnimationTrack.sample} guarantees by clamping first. The convention —
   * *first key at or before `t`* — is the one §13's Catmull-Rom trajectory uses
   * for its knot spans, and it is what makes `"step"` hold each key's value
   * right up to the next key.
   */
  #spanIndex(timeSeconds: number): number {
    const times = this.times;
    // Playback is temporally coherent: try the last span, then the next one.
    const last = this.#lastSpan;
    if (times[last] <= timeSeconds) {
      if (timeSeconds < times[last + 1]) {
        return last;
      }
      if (last + 2 < times.length && timeSeconds < times[last + 2]) {
        this.#lastSpan = last + 1;
        return last + 1;
      }
    }
    let low = 0;
    let high = times.length - 2;
    while (low < high) {
      const middle = (low + high + 1) >>> 1;
      if (times[middle] <= timeSeconds) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    this.#lastSpan = low;
    return low;
  }

  /**
   * Catmull-Rom evaluation of span `index` at local parameter `u`.
   *
   * The tangent at a key is the **non-uniform Catmull-Rom finite difference**
   * used by `@fourjs/motion`'s `CatmullRomTrajectory` (§13), with keyframe times
   * standing in for its knots:
   *
   * ```text
   * d(pᵢ) = (pᵢ − pᵢ₋₁)/(tᵢ − tᵢ₋₁) − (pᵢ₊₁ − pᵢ₋₁)/(tᵢ₊₁ − tᵢ₋₁)
   *       + (pᵢ₊₁ − pᵢ)/(tᵢ₊₁ − tᵢ)
   * ```
   *
   * At the two ends the tangent is the **one-sided secant** of the adjacent
   * span. That is not a second convention: the trajectory gets its end
   * behaviour from a reflected virtual point `2·p₀ − p₁`, and substituting that
   * reflection into the formula above collapses it *exactly* to the one-sided
   * secant (the reflected knot spacing equals the first span's, and the three
   * terms cancel to `(p₁ − p₀)/(t₁ − t₀)`). Writing the secant directly avoids
   * inventing a virtual keyframe *time*, which a track — unlike a spline through
   * points — would have to make up.
   *
   * The tangents are then scaled by the span length to become Hermite tangents
   * in `u`, `mᵢ = d(pᵢ)·(tᵢ₊₁ − tᵢ)`, and mixed with the same Hermite basis the
   * trajectory uses:
   *
   * ```text
   * h₀₀ = 2u³ − 3u² + 1   h₁₀ = u³ − 2u² + u
   * h₀₁ = −2u³ + 3u²      h₁₁ = u³ − u²
   * ```
   *
   * With two keyframes both tangents are the same secant and the result is the
   * straight line between them, matching the trajectory's two-point case.
   */
  #sampleCubic(index: number, u: number, spanSeconds: number, out: T): T {
    const values = this.values;
    const layout = this.#layout;
    const scratch = this.#scratch;
    const size = layout.size;
    const startSlot = size;
    const endSlot = size * 2;
    const resultSlot = size * 4;

    layout.read(values[index], scratch, startSlot);
    layout.read(values[index + 1], scratch, endSlot);
    const tangents = this.#cubicTangents;

    const uu = u * u;
    const uuu = uu * u;
    const h00 = 2 * uuu - 3 * uu + 1;
    const h10 = uuu - 2 * uu + u;
    const h01 = -2 * uuu + 3 * uu;
    const h11 = uuu - uu;

    for (let component = 0; component < size; component += 1) {
      const start = scratch[startSlot + component];
      const end = scratch[endSlot + component];
      const startTangent = tangents[index * 2 * size + component];
      const endTangent = tangents[(index * 2 + 1) * size + component];

      scratch[resultSlot + component] =
        h00 * start +
        h10 * startTangent * spanSeconds +
        h01 * end +
        h11 * endTangent * spanSeconds;
    }

    return layout.write(scratch, resultSlot, out) as T;
  }

  /**
   * Hermite evaluation of span `index` at local parameter `u`, using the left
   * key's out tangent and the right key's in tangent.
   *
   * Same basis as {@link AnimationTrack.#sampleCubic}; the only difference is
   * where the tangents come from. Authored tangents are per *second*, so they
   * are scaled by the span length exactly like the derived ones — which means a
   * Hermite track whose tangents are the Catmull-Rom finite differences
   * reproduces the cubic track keyframe for keyframe.
   */
  #sampleHermite(index: number, u: number, spanSeconds: number, out: T): T {
    const layout = this.#layout;
    const scratch = this.#scratch;
    const size = layout.size;
    const startSlot = 0;
    const startTangentSlot = size;
    const endSlot = size * 2;
    const endTangentSlot = size * 3;
    const resultSlot = size * 4;

    layout.read(this.values[index], scratch, startSlot);
    layout.read(this.outTangents[index], scratch, startTangentSlot);
    layout.read(this.values[index + 1], scratch, endSlot);
    layout.read(this.inTangents[index + 1], scratch, endTangentSlot);

    const uu = u * u;
    const uuu = uu * u;
    const h00 = 2 * uuu - 3 * uu + 1;
    const h10 = uuu - 2 * uu + u;
    const h01 = -2 * uuu + 3 * uu;
    const h11 = uuu - uu;

    for (let component = 0; component < size; component += 1) {
      scratch[resultSlot + component] =
        h00 * scratch[startSlot + component] +
        h10 * scratch[startTangentSlot + component] * spanSeconds +
        h01 * scratch[endSlot + component] +
        h11 * scratch[endTangentSlot + component] * spanSeconds;
    }

    return layout.write(scratch, resultSlot, out) as T;
  }
}

/**
 * A track with its value type erased — what {@link AnimationClip} stores and
 * what the mixer consumes.
 *
 * A clip's tracks are heterogeneous (a position track next to a color track
 * next to a Boolean track), so the array element type cannot name one `T`. This
 * interface is the honest erasure: every `AnimationTrack<T>` satisfies it, and
 * a consumer holding one works through {@link AnimationTrackLike.adapter} —
 * whose {@link ValueAdapter.mutatesInPlace} tells it how to treat the value —
 * exactly as `PropertyBinding` does.
 */
export interface AnimationTrackLike {
  /** Property path, resolved by the mixer. */
  readonly path: string;
  /** Adapter for the erased value type. */
  readonly adapter: ValueAdapter<unknown>;
  /** Interpolation mode (§17). */
  readonly interpolation: InterpolationMode;
  /** Keyframe times in seconds, strictly increasing. */
  readonly times: readonly number[];
  /** Keyframe values. */
  readonly values: readonly unknown[];
  /** First keyframe time in seconds. */
  readonly startTime: number;
  /** Last keyframe time in seconds. */
  readonly endTime: number;
  /** Number of keyframes. */
  readonly keyframeCount: number;
  /** See {@link AnimationTrack.sample}: returns the effective value. */
  sample(timeSeconds: number, out: unknown): unknown;
}
