/**
 * The clip player (§17 clips, §16 playback semantics, §107 "playback controls").
 *
 * An {@link AnimationClip} is data: tracks over clip-local time plus markers. An
 * {@link AnimationMixer} is what plays one onto a target — it owns the bindings,
 * the local clock, the loop count, the speed, and the §16 marker history that a
 * clip deliberately has none of:
 *
 * ```ts
 * const mixer = new AnimationMixer(node);
 * mixer.play(clip, { loop: 2, onEvent: (event) => spawn(event.name) });
 * // …each fixed step (AnimationSystem, plan P4-1):
 * mixer.advance(time.fixedDeltaTime);
 * ```
 *
 * ## Bindings are resolved once (§16)
 *
 * Every track's path is resolved against the target **once**, at
 * {@link AnimationMixer.play}, through `createBinding` — §16's "string-path
 * convenience forms are resolved once, at creation time". The resolved owner is
 * kept for the mixer's whole life, so replacing `target.transform` afterwards
 * does not silently redirect the animation; and because the binding array is
 * index-parallel with `clip.tracks`, sampling is an indexed walk with no lookup.
 *
 * Each track is also checked against the property it resolved to: a `vector3`
 * track bound to a number is a configuration error and throws at `play`, not a
 * mysterious `NaN` three seconds in. Discrete tracks are the one kind that binds
 * to anything, because assignment always works.
 *
 * ## Evaluation is a pure function of clip time (§16, §9)
 *
 * {@link AnimationMixer.seek} and {@link AnimationMixer.advance} share one code
 * path: both position the clip clock and sample every track at that time.
 * Nothing integrates, so evaluating twice at the same time writes byte-identical
 * values and scrubbing backwards is exactly as valid as scrubbing forwards. Time
 * is clip-local seconds (§9: "animation time is clip-local and lives on players
 * and timelines, not in the global `TimeState`"; §7a: seconds, never
 * milliseconds) and never comes from a clock — only from `advance`/`seek`
 * (§33).
 *
 * ## Markers are not a function of time
 *
 * Clip events fire **once per forward crossing** during playback, through
 * `clip.eventsInRange`'s half-open `(from, to]` convention, so consecutive
 * advances neither miss an event nor repeat one. Looping re-arms them. A
 * {@link AnimationMixer.seek} fires nothing unless the play was configured
 * `{ replayOnSeek: true }`, which is §16's "opt-in per-marker replay-on-seek
 * policy" expressed per playback — a clip's `AnimationEvent` has no policy field
 * to opt in with (see {@link MixerPlayOptions.replayOnSeek}).
 *
 * ## Conflicts (§16) and authority (§42)
 *
 * The mixer claims every property it animates in the **same** module-level
 * registry `Tween` uses (`./tween.js`), so a tween and a mixer fighting over one
 * property resolve last-started-wins with a warning, exactly as two tweens do.
 * Transform writes are gated on §42 authority with `Tween`'s semantics: the
 * authority node is the target when the target is a `Node`, or
 * {@link MixerPlayOptions.authority} otherwise; a refusal warns once and skips
 * **every** transform write of that evaluation, never a partial pose, while
 * non-transform tracks keep animating.
 *
 * ## Root motion (§19, plan P7-5)
 *
 * {@link MixerPlayOptions.rootMotion} turns one designated track from an
 * absolute pose channel into a *locomotion* channel: the mixer stops writing its
 * sampled values anywhere and instead adds their per-advance **difference** to a
 * designated node's `transform.position`. That is what makes a walk cycle
 * authored in place move a character, and what lets the same clip loop forever
 * without teleporting back to the origin. See {@link MixerRootMotionOptions} for
 * the loop-aware derivation. A quaternion track extracts rotation the same
 * way — relative `conjugate(previous) * sampled`, multiplied onto
 * `transform.rotation`.
 *
 * ## Allocation (§7b)
 *
 * {@link AnimationMixer.play} allocates: one binding, one scratch value, and one
 * claim per track, plus six vectors when root motion is configured. After that
 * the advance path allocates nothing — the sample sink and the event visitor are
 * built once per mixer, and every track writes through its own scratch.
 */

import { FourError } from "@fourjs/core";
import { Quaternion, type Vector3 } from "@fourjs/math";
import {
  Node,
  runOwnedTransformWrite,
  warnAuthorityConflict,
} from "@fourjs/scene";
import type { TransformAuthority } from "@fourjs/scene";

import { createBinding, type PropertyBinding } from "./binding.js";
import type { AnimationClip, AnimationEvent, TrackSampleSink } from "./clip.js";
import type { AnimationTrackLike } from "./track.js";
import {
  claimProperty,
  isTransformOwner,
  releaseProperty,
  requireNonNegativeSeconds,
  type PropertyClaim,
} from "./tween.js";
import { detectAdapter, type ValueAdapter } from "./values.js";

/**
 * The §42 authority a mixer writes transforms under — the same `"animation"` a
 * tween writes under, because §42 identifies writers by the authority they claim
 * and both *are* the animation system.
 */
const MIXER_AUTHORITY: TransformAuthority = "animation";

/** How a mixer names itself in the §16 conflict warning. */
const MIXER_WRITER_KIND = "clip mixer";

/**
 * The cursor value that means "before the start of playback", so an event at
 * clip time `0` still has a forward crossing to fire on. Identical in role and
 * value to `Timeline`'s: marker times are finite and `>= 0`, so `-1` is strictly
 * below all of them, and it stays finite for the `cursor - iteration * duration`
 * arithmetic where `-Infinity` would produce `NaN`.
 */
const CURSOR_BEFORE_START = -1;

/**
 * Playback state of an {@link AnimationMixer}. Deliberately the same vocabulary
 * as `TweenState` and `TimelineState`, which is what lets all three satisfy one
 * `Advanceable` (see `./animation-system.js`) and lets a prepared mixer satisfy
 * `TimelineChild` (see `./timeline.js`).
 *
 * - `"idle"` — built, possibly armed with {@link AnimationMixer.prepare}, but
 *   nothing is bound or claimed yet.
 * - `"running"` — {@link AnimationMixer.advance} moves it.
 * - `"paused"` — {@link AnimationMixer.resume} puts it back to `"running"`.
 * - `"finished"` — an advance carried playback to the end. The properties are
 *   released for other writers and the mixer can still be scrubbed.
 * - `"stopped"` — {@link AnimationMixer.stop} was called; the mixer writes
 *   nothing further and values stay where the last write put them.
 */
export type MixerState = "idle" | "running" | "paused" | "finished" | "stopped";

/**
 * Receives a clip event when playback crosses it (§16, §17).
 *
 * The index is the event's position in {@link AnimationClip.events}, which is
 * time-sorted — enough to identify a marker even when two share a name.
 */
export type AnimationEventListener = (
  event: AnimationEvent,
  index: number,
) => void;

/**
 * Root motion for one playback (§19, plan decision P7-5) — the MVP tier:
 * **translation only**.
 *
 * The designated track is removed from normal per-track binding. Its path is
 * never resolved against the mixer's target, its absolute values never write a
 * bound property, and it needs no property to exist at all: `"rootMotion"` is a
 * perfectly good path for a channel that exists only to be differenced. What the
 * mixer does with it instead is add the *change* in its sampled value across
 * each {@link AnimationMixer.advance} to
 * `target.transform.position`.
 *
 * ## The loop-aware delta, derived
 *
 * Let `S(t)` be the track sampled at clip-local time `t`, `d` the clip duration,
 * and let one advance move elapsed time from `a` to `b` (`a <= b`). Inside a
 * single iteration the answer is the plain difference `S(l(b)) − S(l(a))`, where
 * `l` is the clip-local time of an elapsed time.
 *
 * A wrap is where naive differencing fails: `l` jumps from `d` back to `0`, so
 * `S(l(b)) − S(l(a))` would subtract a whole stride and teleport the node
 * backwards. The honest quantity is the distance travelled *along* the clip, so
 * the crossing is split at the seam — the motion left in the outgoing iteration
 * plus the motion already made in the incoming one:
 *
 * ```text
 * (S(d) − S(l(a)))  +  (S(l(b)) − S(0))
 * ```
 *
 * An advance long enough to swallow whole iterations adds one full **stride**
 * `S(d) − S(0)` for each of them, which generalizes both cases to
 *
 * ```text
 * w = iteration(b) − iteration(a)                       // wraps crossed
 * w = 0:  S(l(b)) − S(l(a))
 * w > 0:  (S(d) − S(l(a))) + (w − 1)·(S(d) − S(0)) + (S(l(b)) − S(0))
 * ```
 *
 * `iteration` and `l` are the mixer's own loop bookkeeping (the same functions
 * that place the pose), so root motion wraps exactly when playback does — and,
 * because the last iteration's end reads as `l = d` rather than `l = 0` of an
 * iteration that does not exist, the advance that finishes a `loop(n)` playback
 * contributes the full `n`-th stride.
 *
 * `S(l(a))`, `S(d)`, and `S(0)` are all held from the previous advance or frozen
 * at play, so a step costs exactly one new sample and no allocation.
 *
 * ## What does *not* accumulate
 *
 * - {@link AnimationMixer.seek} applies no delta at all. It repositions the
 *   left endpoint so the next advance differences from the sought time, and
 *   nothing more: §16 makes evaluation a pure function of clip time, and a
 *   scrub that also *moved* the character would make scrubbing back and forth
 *   a source of displacement. A seek positions; only an advance locomotes.
 * - A delta refused by §42 (see below) is **dropped**, not banked. The left
 *   endpoint still advances, so authority granted mid-playback resumes from the
 *   clip's current position rather than replaying the motion that was refused —
 *   the same "never depended on the writes that were refused" property the pose
 *   path has.
 *
 * ## Authority (§42)
 *
 * The write lands on {@link MixerRootMotionOptions.target}'s transform, so that
 * node must be under `"animation"` authority — independently of whatever node
 * gates the pose, which is often a different one (the pose animates a skeleton
 * under a root the motion moves). A node that is not warns once (deduplicated by
 * `warnAuthorityConflict`) and its deltas are skipped.
 *
 * ## Channels
 *
 * A `vector3` track extracts **translation** (`transform.position.add`).
 * A `quaternion` track extracts **rotation**: the relative quaternion
 * `conjugate(previous) * sampled` is multiplied onto `transform.rotation`
 * (local composition, the same space the translation channel adds in).
 * Other adapter kinds are still rejected — there is no defensible delta
 * for a scalar or a colour.
 */
export interface MixerRootMotionOptions {
  /**
   * Path of the clip track to difference, matched exactly against
   * {@link AnimationTrackLike.path}. The clip must contain exactly
   * one track with this path, and it must be a `vector3` or
   * `quaternion` track.
   */
  readonly trackPath: string;

  /**
   * The node the extracted translation or rotation moves. Written under
   * §42 `"animation"` authority; needs no relationship to the mixer's
   * target.
   */
  readonly target: Node;
}

/** Per-playback policy for {@link AnimationMixer.play}. */
export interface MixerPlayOptions {
  /**
   * Number of **total** iterations: `1` (the default) plays the clip once,
   * `3` plays it three times, `Infinity` never ends. The same counting as
   * `Timeline.loop`, deliberately not `Tween.repeat`'s "additional cycles".
   */
  readonly loop?: number;

  /** Multiplier applied to every advance delta; finite and `> 0`. Default `1`. */
  readonly speed?: number;

  /**
   * The node whose §42 authority gates this playback's transform writes.
   *
   * Inferred when the target *is* a `Node`. A mixer aimed at something else — a
   * material, a bare `Transform`, a plain object — cannot infer it (math and
   * material objects carry no back-reference to a node), so declare it here if
   * the clip writes into a node's transform through that target.
   */
  readonly authority?: Node;

  /** Called for every clip event this playback crosses (§16 semantics). */
  readonly onEvent?: AnimationEventListener;

  /**
   * Whether {@link AnimationMixer.seek} also fires the events it crosses
   * forwards — §16's opt-in replay-on-seek policy.
   *
   * §16 words it per marker; a clip's {@link AnimationEvent} is plain authored
   * data with no policy field (see `./clip.js`), so the opt-in lives on the
   * playback that owns the marker *history* instead. A caller who needs
   * per-marker granularity filters inside {@link MixerPlayOptions.onEvent},
   * which receives the event and its index.
   *
   * Defaults to `false`: seeking is silent, and a backward seek fires nothing
   * either way (crossing is a forward notion, §16).
   */
  readonly replayOnSeek?: boolean;

  /**
   * Extracts translation from one designated track and moves a node with it
   * instead of writing it (§19, plan P7-5). See {@link MixerRootMotionOptions}
   * for the semantics, the loop-aware derivation, and what is staged.
   *
   * Validated at {@link AnimationMixer.play}, where the clip's tracks are known.
   */
  readonly rootMotion?: MixerRootMotionOptions;
}

/** How one evaluation treats clip events. */
type EventMode =
  /** Playback: every crossed event fires. */
  | "play"
  /** Seek: events fire only under {@link MixerPlayOptions.replayOnSeek}. */
  | "seek"
  /** Pose only: nothing fires and the cursor does not move. */
  | "silent";

/** One bound track, resolved and claimed at {@link AnimationMixer.play}. */
interface MixerEntry {
  /** Discriminates {@link MixerSlot}: this track writes its samples. */
  readonly rootMotion: false;
  /** Resolved property reference (§16), index-parallel with `clip.tracks`. */
  readonly binding: PropertyBinding;
  /** The authored track path, for diagnostics and the §16 conflict warning. */
  readonly path: string;
  /** `out` storage for in-place adapters; ignored by the primitive adapters. */
  readonly scratch: unknown;
  /** Whether this property sits inside the authority node's transform. */
  readonly isTransform: boolean;
  /** Whether a write here bypasses a plan-D3 change hook and must re-fire it. */
  readonly notifyChange: boolean;
  /** This playback's §16 claim; `held` gates every write (see `./tween.js`). */
  readonly claim: PropertyClaim;
}

/**
 * The slot of the {@link MixerRootMotionOptions.trackPath} track: bound to
 * nothing, claiming nothing, writing nothing. It exists only to keep
 * {@link AnimationMixer.#entries} index-parallel with `clip.tracks`, so the
 * sample sink stays an indexed walk; its samples are discarded and the track is
 * re-sampled by the root-motion path, which needs a time of its own.
 */
interface RootMotionSlot {
  /** Discriminates {@link MixerSlot}. */
  readonly rootMotion: true;
  /** The authored track path, for diagnostics. */
  readonly path: string;
  /** Somewhere for the discarded pose sample to land. */
  readonly scratch: unknown;
}

/** One clip track's slot in the mixer, index-parallel with `clip.tracks`. */
type MixerSlot = MixerEntry | RootMotionSlot;

/** Everything one translation root-motion playback needs. */
interface TranslationRootMotion {
  readonly kind: "vector3";
  readonly track: AnimationTrackLike;
  readonly target: Node;
  readonly previous: Vector3;
  readonly sample: Vector3;
  readonly delta: Vector3;
  readonly atStart: Vector3;
  readonly atEnd: Vector3;
}

/** Everything one rotational root-motion playback needs. */
interface RotationRootMotion {
  readonly kind: "quaternion";
  readonly track: AnimationTrackLike;
  readonly target: Node;
  readonly previous: Quaternion;
  readonly sample: Quaternion;
  readonly delta: Quaternion;
  readonly atStart: Quaternion;
  readonly atEnd: Quaternion;
  readonly scratch: Quaternion;
  readonly cycle: Quaternion;
}

/** Everything one root-motion playback needs, built once at play (§7b). */
type RootMotionState = TranslationRootMotion | RotationRootMotion;

/** Throws the §89 error used for every malformed mixer configuration. */
function invalidMixer(
  message: string,
  context: Record<string, unknown>,
): never {
  throw new FourError("INVALID_APPLICATION_STATE", message, { context });
}

/**
 * Fresh `Vector3` storage shaped like `track`'s values, for a track whose
 * adapter kind is `"vector3"`. Play-time only — the advance path never clones.
 */
function cloneTrackVector(track: AnimationTrackLike): Vector3 {
  return track.adapter.clone(track.values[0]) as Vector3;
}

/**
 * Samples a `vector3` track into `out` and returns the **effective** value,
 * which is `out` for the built-in adapter and whatever a custom adapter of the
 * same kind returns (see `./values.js` on the `mutatesInPlace` split).
 */
function sampleTrackVector(
  track: AnimationTrackLike,
  timeSeconds: number,
  out: Vector3,
): Vector3 {
  return track.sample(timeSeconds, out) as Vector3;
}

function cloneTrackQuaternion(track: AnimationTrackLike): Quaternion {
  return track.adapter.clone(track.values[0]) as Quaternion;
}

function sampleTrackQuaternion(
  track: AnimationTrackLike,
  timeSeconds: number,
  out: Quaternion,
): Quaternion {
  return track.sample(timeSeconds, out) as Quaternion;
}

/**
 * Relative rotation `conjugate(from) * to` — the quaternion analog of
 * `to - from`. Writes `out`; `scratch` holds the conjugated `from`.
 */
function quaternionDelta(
  from: Quaternion,
  to: Quaternion,
  out: Quaternion,
  scratch: Quaternion,
): Quaternion {
  scratch.copy(from).conjugate();
  return out.copy(scratch).multiply(to);
}

/**
 * Plays an {@link AnimationClip} onto one target object (§17, §107).
 *
 * ## The two time axes
 *
 * ```text
 * elapsed  0 ─────── d ─────── 2d ─────── 3d     (loop: 3, monotonic)
 * clip     0 ─── d   0 ─── d   0 ─── d           (what tracks are sampled at)
 * ```
 *
 * {@link AnimationMixer.localTime} is the clip-local position inside the current
 * iteration and is what every track sees; {@link AnimationMixer.elapsedTime} is
 * total played time and is what event bookkeeping runs in, because it only moves
 * forward during forward playback. Looping then needs no special case: an event
 * at clip time `m` occurs at `m`, `m + d`, `m + 2d`, … and the half-open
 * crossing rule fires each of those exactly once.
 *
 * ## One clip at a time
 *
 * A mixer plays a single clip. Cross-fading, layering, and additive blending are
 * §18/§19 material and are staged out of Phase 4 (plan P4-3); animating one
 * target from two clips today means two mixers, and the shared §16 conflict
 * registry then resolves any property they both write last-started-wins, with a
 * warning.
 */
export class AnimationMixer {
  /** Root object every track path is resolved against. */
  readonly #target: object;

  /** The armed or playing clip; `undefined` until `prepare`/`play`. */
  #clip: AnimationClip | undefined;

  /** Bound tracks, index-parallel with `clip.tracks`; empty until play. */
  #entries: MixerSlot[] = [];

  /** Root motion declared through {@link MixerPlayOptions.rootMotion}, if any. */
  #declaredRootMotion: MixerRootMotionOptions | undefined;

  /** Resolved root-motion runtime state; `undefined` when none is configured. */
  #rootMotion: RootMotionState | undefined;

  /** Total iterations: `1` plays once, `Infinity` loops forever. */
  #iterations = 1;

  /** Multiplier applied to every {@link AnimationMixer.advance} delta. */
  #speed = 1;

  /** Node declared through {@link MixerPlayOptions.authority}, if any. */
  #declaredNode: Node | undefined;

  /** Node whose §42 authority gates this mixer's transform writes. */
  #authorityNode: Node | undefined;

  /** Whether any bound track writes into {@link AnimationMixer.#authorityNode}. */
  #hasTransformEntries = false;

  /** Set per evaluation by {@link AnimationMixer.#applyPose}; read by the sink. */
  #allowTransform = true;

  /** See {@link MixerPlayOptions.onEvent}. */
  #onEvent: AnimationEventListener | undefined;

  /** See {@link MixerPlayOptions.replayOnSeek}. */
  #replayOnSeek = false;

  /** One iteration's length in seconds — the clip's duration, frozen at play. */
  #duration = 0;

  /** See {@link MixerState}. */
  #state: MixerState = "idle";

  /** Total played time in seconds, across loop iterations. */
  #elapsed = 0;

  /** Exclusive lower bound of the next crossing range, in elapsed seconds. */
  #cursor = CURSOR_BEFORE_START;

  /** Whether playback reached the end of the last iteration. */
  #finished = false;

  /**
   * The sink `clip.sampleAll` writes through. Built **once per mixer** (its two
   * arrow properties are the only closures in the module), so the advance path
   * allocates nothing.
   */
  readonly #sink: TrackSampleSink = {
    outFor: (trackIndex: number): unknown => this.#entries[trackIndex].scratch,
    applySample: (
      trackIndex: number,
      _track: AnimationTrackLike,
      value: unknown,
    ): void => {
      const slot = this.#entries[trackIndex];
      // The root-motion track's absolute value is never written anywhere: only
      // its per-advance difference is, by `#accumulateRootMotion`.
      if (!slot.rootMotion) {
        this.#write(slot, value);
      }
    },
  };

  /** The event visitor handed to `clip.eventsInRange`; also built once. */
  readonly #visitEvent = (event: AnimationEvent, index: number): void => {
    this.#onEvent?.(event, index);
  };

  constructor(target: object) {
    this.#target = target;
  }

  // --- introspection ------------------------------------------------------

  /** The object every track path is resolved against. */
  get target(): object {
    return this.#target;
  }

  /** The armed or playing clip, or `undefined` on a fresh mixer. */
  get clip(): AnimationClip | undefined {
    return this.#clip;
  }

  /** Current playback state. */
  get state(): MixerState {
    return this.#state;
  }

  /**
   * Length of one iteration in seconds: the clip's own `duration` (§17), frozen
   * at play. `0` while nothing is armed.
   */
  get duration(): number {
    return this.#state === "idle"
      ? (this.#clip?.duration ?? 0)
      : this.#duration;
  }

  /**
   * `duration × loop` — the elapsed time at which playback finishes.
   * `Infinity` for `loop(Infinity)`, and `0` for a zero-length clip (where
   * `0 × Infinity` would otherwise be `NaN`).
   */
  get totalDuration(): number {
    const duration = this.duration;
    return duration <= 0 ? 0 : duration * this.#iterations;
  }

  /** Clip-local position inside the current iteration, in seconds (§9). */
  get localTime(): number {
    return this.#state === "idle" ? 0 : this.#localAt(this.#elapsed);
  }

  /** Total played time in seconds, across loop iterations. */
  get elapsedTime(): number {
    return this.#elapsed;
  }

  /** Zero-based index of the loop iteration currently playing. */
  get iteration(): number {
    return this.#state === "idle" ? 0 : this.#iterationAt(this.#elapsed);
  }

  /**
   * Whether an advance carried playback to {@link AnimationMixer.totalDuration}.
   *
   * A playback fact, not a time fact: {@link AnimationMixer.seek} never sets or
   * clears it, exactly as on a tween or a timeline, so scrubbing a finished
   * mixer inspects values without pretending it is running again.
   */
  get finished(): boolean {
    return this.#finished;
  }

  /** The {@link AnimationMixer.speed} multiplier. */
  get playbackSpeed(): number {
    return this.#speed;
  }

  /** Total iterations set by {@link AnimationMixer.loop}; `1` by default. */
  get loopCount(): number {
    return this.#iterations;
  }

  // --- playback -----------------------------------------------------------

  /**
   * Arms the mixer with a clip and its per-playback options **without starting
   * it**, so something else can own its playback — a `Timeline`, which requires
   * an `"idle"` child and calls `play()` itself, or a caller that wants to
   * `seek` a pose before running.
   *
   * The same relationship `tween(...)` has to `animate(...).play()`: nothing is
   * bound, captured, or claimed here.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — the mixer has already been
   * played, or an option is out of range.
   */
  prepare(clip: AnimationClip, options: MixerPlayOptions = {}): this {
    if (this.#state !== "idle") {
      invalidMixer(
        `AnimationMixer.prepare() cannot be called after play(): bindings, property claims, and the clip are fixed at play time (state "${this.#state}").`,
        { state: this.#state },
      );
    }
    this.#clip = clip;
    if (options.loop !== undefined) {
      this.loop(options.loop);
    }
    if (options.speed !== undefined) {
      this.speed(options.speed);
    }
    this.#declaredNode = options.authority;
    this.#onEvent = options.onEvent;
    this.#replayOnSeek = options.replayOnSeek ?? false;
    this.#declaredRootMotion = options.rootMotion;
    return this;
  }

  /**
   * Resolves every track's binding, claims the properties (§16), and starts
   * playback at clip time 0 — writing the pose for time 0 immediately, so the
   * clip's first keyframes are visible without waiting for an advance.
   *
   * `play(clip, options)` is `prepare(clip, options).play()`. Calling it with no
   * clip plays whatever {@link AnimationMixer.prepare} armed, which is the form
   * `Timeline` uses.
   *
   * A no-op on a mixer that is not `"idle"` — replaying would have to re-resolve
   * bindings that §16 says are resolved once. Build a new mixer, or `seek(0)`.
   *
   * No event fires here, not even one at clip time 0: the cursor starts below
   * zero and the first `advance` (even `advance(0)`) crosses it.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — no clip was given or armed;
   * options were passed without a clip; or a track's path resolves to a property
   * whose type its adapter cannot write (see the module header).
   * @throws FourError from `createBinding` — a track path does not resolve.
   */
  play(clip?: AnimationClip, options?: MixerPlayOptions): this {
    if (this.#state !== "idle") {
      return this;
    }
    if (clip !== undefined) {
      this.prepare(clip, options);
    } else if (options !== undefined) {
      invalidMixer(
        "AnimationMixer.play(options) needs the clip the options belong to; pass play(clip, options) or prepare(clip, options) first.",
        {},
      );
    }
    const armed = this.#clip;
    if (armed === undefined) {
      invalidMixer(
        "AnimationMixer.play() needs a clip: call play(clip) or prepare(clip) first (§17).",
        {},
      );
    }

    const node =
      this.#declaredNode ??
      (this.#target instanceof Node ? this.#target : undefined);

    const rootMotionOptions = this.#declaredRootMotion;
    const rootMotionIndex =
      rootMotionOptions === undefined
        ? -1
        : this.#resolveRootMotionTrack(armed, rootMotionOptions);

    const entries: MixerSlot[] = [];
    let hasTransformEntries = false;
    for (let index = 0; index < armed.tracks.length; index += 1) {
      const track = armed.tracks[index];
      if (index === rootMotionIndex) {
        entries.push({
          rootMotion: true,
          path: track.path,
          scratch: track.adapter.clone(track.values[0]),
        });
        continue;
      }
      const adapter = track.adapter;
      const binding = createBinding(this.#target, track.path, adapter);
      this.#assertBindable(armed, track, binding);
      const isTransform =
        node !== undefined && isTransformOwner(node, binding.owner);
      hasTransformEntries = hasTransformEntries || isTransform;
      entries.push({
        rootMotion: false,
        binding,
        path: track.path,
        // Scratch, never a keyframe value: `clip.sampleAll` writes into it and
        // `binding.set` reads it, so aliasing a key would corrupt the clip.
        scratch: adapter.clone(binding.get()),
        isTransform,
        notifyChange: !adapter.mutatesInPlace,
        claim: { writerKind: MIXER_WRITER_KIND, held: false },
      });
    }

    this.#entries = entries;
    this.#hasTransformEntries = hasTransformEntries;
    this.#authorityNode = hasTransformEntries ? node : undefined;
    this.#duration = armed.duration;
    for (const entry of entries) {
      if (entry.rootMotion) {
        continue;
      }
      claimProperty(
        entry.binding.owner,
        entry.binding.key,
        entry.path,
        entry.claim,
      );
    }
    if (rootMotionIndex >= 0) {
      // `rootMotionOptions` is defined whenever an index was resolved.
      this.#rootMotion = this.#buildRootMotion(
        armed.tracks[rootMotionIndex],
        (rootMotionOptions as MixerRootMotionOptions).target,
      );
    }
    this.#elapsed = 0;
    this.#cursor = CURSOR_BEFORE_START;
    this.#finished = false;
    this.#state = "running";
    this.#setElapsed(0, "silent");
    return this;
  }

  /** Suspends advancing. A no-op unless the mixer is `"running"`. */
  pause(): this {
    if (this.#state === "running") {
      this.#state = "paused";
    }
    return this;
  }

  /** Resumes advancing. A no-op unless the mixer is `"paused"`. */
  resume(): this {
    if (this.#state === "paused") {
      this.#state = "running";
    }
    return this;
  }

  /**
   * Stops playback and releases every §16 property claim, leaving all animated
   * values exactly where the last write put them.
   *
   * A stopped mixer never writes again — even a later {@link AnimationMixer.seek}
   * is inert — and the properties it held are free for another writer to claim
   * without a conflict warning. A no-op on an `"idle"` mixer, which holds
   * nothing.
   */
  stop(): this {
    if (this.#state === "idle") {
      return this;
    }
    this.#releaseClaims();
    for (const entry of this.#entries) {
      if (!entry.rootMotion) {
        entry.claim.held = false;
      }
    }
    this.#state = "stopped";
    return this;
  }

  /**
   * Sets the playback speed multiplier — legal at any time, including
   * mid-playback, because §107 lists it as a playback *control*.
   *
   * Must be positive and finite. Reverse playback is deliberately not
   * `speed(-1)`: §16 gives reversing to `Timeline`, and a negative multiplier
   * here would make "the advance that finishes playback" ambiguous and event
   * crossing (a forward notion) meaningless. Scrub backwards with
   * {@link AnimationMixer.seek}.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — not finite and `> 0`.
   */
  speed(multiplier: number): this {
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      invalidMixer(
        `AnimationMixer speed must be a finite multiplier > 0; received ${String(multiplier)}. Reverse playback is a Timeline feature (§16).`,
        { multiplier },
      );
    }
    this.#speed = multiplier;
    return this;
  }

  /**
   * Sets the number of **total** iterations: `loop(1)` is the default single
   * pass, `loop(3)` plays the clip three times, `loop(Infinity)` never ends.
   * Clip events re-arm on every wrap, so a marker on a `loop(3)` playback fires
   * three times.
   *
   * Legal mid-playback, like {@link AnimationMixer.speed}: it only changes
   * {@link AnimationMixer.totalDuration}, which the next advance reads.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — not an integer `>= 1` or
   * `Infinity`.
   */
  loop(count: number): this {
    if (count !== Infinity && (!Number.isInteger(count) || count < 1)) {
      invalidMixer(
        `AnimationMixer loop count must be an integer >= 1 or Infinity (it counts total iterations, not extra ones); received ${String(count)}.`,
        { count },
      );
    }
    this.#iterations = count;
    return this;
  }

  /**
   * Advances playback by `deltaSeconds × speed` and writes the resulting pose.
   * Called by the fixed-step `AnimationSystem` (plan P4-1) with the simulation's
   * fixed delta; a mixer never advances itself and never reads a clock (§33).
   *
   * Clip events in the crossed range fire in time order, once each — including
   * one exactly at the end of the range and excluding one exactly at its start,
   * so consecutive advances neither miss an event nor repeat one. A delta that
   * spans an iteration boundary fires the rest of that iteration's events,
   * re-arms them, and continues into the next.
   *
   * A no-op unless the mixer is `"running"` and unfinished. The advance that
   * reaches {@link AnimationMixer.totalDuration} clamps to it, writes the final
   * pose, and releases the property claims (a finished mixer can still be
   * scrubbed, exactly as a finished tween can).
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — the delta is negative or
   * non-finite.
   */
  advance(deltaSeconds: number): this {
    requireNonNegativeSeconds(deltaSeconds, "AnimationMixer advance delta");
    if (this.#state !== "running" || this.#finished) {
      return this;
    }
    const total = this.totalDuration;
    const from = this.#elapsed;
    let target = this.#elapsed + deltaSeconds * this.#speed;
    if (target >= total) {
      target = total;
      this.#finished = true;
    }
    this.#setElapsed(target, "play");
    // After the pose: root motion is a displacement *of* the posed node, and a
    // clip that also animates the same transform would otherwise overwrite it.
    this.#accumulateRootMotion(from, target);
    if (this.#finished) {
      this.#state = "finished";
      this.#releaseClaims();
    }
    return this;
  }

  /**
   * Positions playback at `timeSeconds` of **elapsed** time and writes the pose
   * for it — §16's scrubbing, and the positioning half of a snapshot restore
   * (§34).
   *
   * Pure: seeking twice to the same time writes identical values, and seeking
   * backwards is as valid as forwards. Neither {@link AnimationMixer.state} nor
   * {@link AnimationMixer.finished} changes, so a seek is an evaluation and
   * never a playback decision.
   *
   * The time is clamped to `[0, totalDuration]` — **elapsed** time, spanning
   * every loop iteration, not one iteration's clip time. It therefore differs
   * from `Timeline.seek`, which clamps to a single iteration: a mixer is
   * *placed* on a timeline by its total duration, so a looping mixer driven by a
   * timeline has to be addressable across its loops, and scrubbing a three-loop
   * clip through all three loops is meaningful in a way that scrubbing a
   * timeline "into iteration 2" is not. With the default `loop(1)` the two
   * conventions coincide.
   *
   * Events are suppressed unless the playback opted in with
   * `{ replayOnSeek: true }`, in which case a *forward* seek fires the events it
   * crosses (§16). A backward seek fires nothing and re-arms the events it
   * rewound past, so replaying forwards crosses them again — which is exactly
   * what "restoring a mid-clip snapshot positions playback without re-firing
   * markers already crossed" needs.
   *
   * Root motion (§19, P7-5) is repositioned and **not** applied: a seek moves
   * the clip clock, never the character (see {@link MixerRootMotionOptions}).
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — the mixer has never been
   * played, or the time is negative or non-finite.
   */
  seek(timeSeconds: number): this {
    requireNonNegativeSeconds(timeSeconds, "AnimationMixer seek time");
    if (this.#state === "idle") {
      invalidMixer(
        "AnimationMixer.seek() requires play() first: bindings are resolved at play.",
        { timeSeconds },
      );
    }
    // A stopped mixer is inert in every respect: its entries refuse writes, and
    // firing an event with no animation behind it would be a bare side effect.
    const mode: EventMode = this.#state === "stopped" ? "silent" : "seek";
    const total = this.totalDuration;
    this.#setElapsed(timeSeconds > total ? total : timeSeconds, mode);
    // Repositions root motion's left endpoint without applying anything: a seek
    // positions, only an advance locomotes (P7-5, §16).
    this.#repositionRootMotion();
    return this;
  }

  // --- internals ----------------------------------------------------------

  /**
   * Rejects a track whose bound property cannot hold the track's value type.
   *
   * `createBinding` was given the track's adapter, so it accepted the property
   * without inspecting it (§16's "typed property reference" form, where the
   * caller owns the type). This is that inspection, done once at play rather
   * than never: `detectAdapter` reports what the property actually holds, and a
   * `vector3` track bound to a number is a configuration error, not a runtime
   * surprise. Discrete tracks bind to anything — assignment always works — which
   * is also the escape hatch for a property whose type is not detectable.
   */
  #assertBindable(
    clip: AnimationClip,
    track: AnimationTrackLike,
    binding: PropertyBinding,
  ): void {
    const adapter: ValueAdapter<unknown> = track.adapter;
    if (adapter.kind === "discrete") {
      return;
    }
    const detected = detectAdapter(binding.get());
    if (detected === undefined || detected.kind !== adapter.kind) {
      invalidMixer(
        `Animation clip "${clip.name}" has a ${adapter.kind} track on "${track.path}", but that property holds ${detected === undefined ? "a value of no known type" : `a ${detected.kind}`}. Fix the path, the track's adapter, or use a discrete track.`,
        {
          clip: clip.name,
          path: track.path,
          expected: adapter.kind,
          received: detected?.kind,
        },
      );
    }
  }

  /**
   * Index of the {@link MixerRootMotionOptions.trackPath} track in `clip.tracks`
   * (§19, P7-5).
   *
   * Everything that can be wrong with the designation is wrong *here*, at play,
   * where the clip and the option are both in hand — not silently at the first
   * advance. A path matching two tracks is rejected rather than resolved by a
   * rule nobody would remember: a clip may legitimately carry two tracks on one
   * path (the later wins, see `./clip.js`), but "which of them locomotes the
   * character" has no defensible default.
   */
  #resolveRootMotionTrack(
    clip: AnimationClip,
    options: MixerRootMotionOptions,
  ): number {
    let found = -1;
    for (let index = 0; index < clip.tracks.length; index += 1) {
      if (clip.tracks[index].path !== options.trackPath) {
        continue;
      }
      if (found >= 0) {
        invalidMixer(
          `Root motion names track "${options.trackPath}", but animation clip "${clip.name}" has more than one track on that path (indices ${String(found)} and ${String(index)}). Give the root-motion track a path of its own.`,
          { clip: clip.name, path: options.trackPath, first: found, index },
        );
      }
      found = index;
    }
    if (found < 0) {
      invalidMixer(
        `Root motion names track "${options.trackPath}", which animation clip "${clip.name}" does not have.`,
        { clip: clip.name, path: options.trackPath },
      );
    }

    const kind = clip.tracks[found].adapter.kind;
    if (kind !== "vector3" && kind !== "quaternion") {
      invalidMixer(
        `Root motion names the ${kind} track "${options.trackPath}", but root motion extracts a translation from a vector3 track or a rotation from a quaternion track (plan P7-5).`,
        { clip: clip.name, path: options.trackPath, kind },
      );
    }
    return found;
  }

  /**
   * Freezes the constants of the loop-aware delta — `S(0)`, `S(duration)` — and
   * seeds the left endpoint at clip time `0`, which is where
   * {@link AnimationMixer.play} starts. Allocates the six vectors root motion
   * ever uses (five here, one for the discarded pose sample).
   */
  #buildRootMotion(track: AnimationTrackLike, target: Node): RootMotionState {
    if (track.adapter.kind === "quaternion") {
      const sample = cloneTrackQuaternion(track);
      const atStart = cloneTrackQuaternion(track).copy(
        sampleTrackQuaternion(track, 0, sample),
      );
      const atEnd = cloneTrackQuaternion(track).copy(
        sampleTrackQuaternion(track, this.#duration, sample),
      );
      return {
        kind: "quaternion",
        track,
        target,
        previous: cloneTrackQuaternion(track).copy(atStart),
        sample,
        delta: cloneTrackQuaternion(track),
        atStart,
        atEnd,
        scratch: cloneTrackQuaternion(track),
        cycle: cloneTrackQuaternion(track),
      };
    }
    const sample = cloneTrackVector(track);
    const atStart = cloneTrackVector(track).copy(
      sampleTrackVector(track, 0, sample),
    );
    const atEnd = cloneTrackVector(track).copy(
      sampleTrackVector(track, this.#duration, sample),
    );
    return {
      kind: "vector3",
      track,
      target,
      previous: cloneTrackVector(track).copy(atStart),
      sample,
      delta: cloneTrackVector(track),
      atStart,
      atEnd,
    };
  }

  /**
   * Adds the translation the clip travelled between `fromElapsed` and
   * `toElapsed` to the root-motion target (§19, P7-5).
   *
   * The formula is {@link MixerRootMotionOptions}'s, using the mixer's own
   * `#iterationAt`/`#localAt` so a wrap here is the same wrap the pose sees.
   * §42 is enforced exactly as `#applyPose` enforces it — warn once, skip — and
   * the left endpoint moves either way, so a refused delta is dropped rather
   * than banked. Allocates nothing: one sample and component arithmetic.
   */
  #accumulateRootMotion(fromElapsed: number, toElapsed: number): void {
    const root = this.#rootMotion;
    if (root === undefined) {
      return;
    }
    const wraps = this.#iterationAt(toElapsed) - this.#iterationAt(fromElapsed);
    if (root.kind === "quaternion") {
      const sampled = sampleTrackQuaternion(
        root.track,
        this.#localAt(toElapsed),
        root.sample,
      );
      const delta = root.delta;
      if (wraps <= 0) {
        quaternionDelta(root.previous, sampled, delta, root.scratch);
      } else {
        const start = root.atStart;
        const end = root.atEnd;
        const scratch = root.scratch;
        const cycle = quaternionDelta(start, end, root.cycle, scratch);
        quaternionDelta(root.previous, end, delta, scratch);
        const extra = wraps - 1;
        for (let index = 0; index < extra; index += 1) {
          delta.multiply(cycle);
        }
        // Last stride: conjugate(start) * sampled. `scratch` is free;
        // `cycle` stays intact in case this path runs again.
        scratch.copy(start).conjugate().multiply(sampled);
        delta.multiply(scratch);
      }
      root.previous.copy(sampled);

      const target = root.target;
      if (target.transformAuthority !== MIXER_AUTHORITY) {
        warnAuthorityConflict(target, MIXER_AUTHORITY);
        return;
      }
      runOwnedTransformWrite(() => {
        target.transform.rotation.multiply(delta).normalize();
      });
      return;
    }

    const previous = root.previous;
    const sampled = sampleTrackVector(
      root.track,
      this.#localAt(toElapsed),
      root.sample,
    );
    const delta = root.delta;
    if (wraps <= 0) {
      delta.set(
        sampled.x - previous.x,
        sampled.y - previous.y,
        sampled.z - previous.z,
      );
    } else {
      const strides = wraps - 1;
      const start = root.atStart;
      const end = root.atEnd;
      delta.set(
        end.x - previous.x + strides * (end.x - start.x) + sampled.x - start.x,
        end.y - previous.y + strides * (end.y - start.y) + sampled.y - start.y,
        end.z - previous.z + strides * (end.z - start.z) + sampled.z - start.z,
      );
    }
    previous.copy(sampled);

    const target = root.target;
    if (target.transformAuthority !== MIXER_AUTHORITY) {
      warnAuthorityConflict(target, MIXER_AUTHORITY);
      return;
    }
    runOwnedTransformWrite(() => {
      target.transform.position.add(delta);
    });
  }

  /**
   * Moves root motion's left endpoint to the current local time without
   * applying anything — {@link AnimationMixer.seek}'s half of P7-5.
   */
  #repositionRootMotion(): void {
    const root = this.#rootMotion;
    if (root === undefined) {
      return;
    }
    if (root.kind === "quaternion") {
      root.previous.copy(
        sampleTrackQuaternion(
          root.track,
          this.#localAt(this.#elapsed),
          root.sample,
        ),
      );
      return;
    }
    root.previous.copy(
      sampleTrackVector(root.track, this.#localAt(this.#elapsed), root.sample),
    );
  }

  /** Zero-based iteration index containing `elapsed`. */
  #iterationAt(elapsed: number): number {
    const duration = this.#duration;
    if (duration <= 0) {
      return 0;
    }
    const last = this.#iterations - 1;
    const index = Math.floor(elapsed / duration);
    return index > last ? last : index;
  }

  /**
   * Clip-local time inside the iteration containing `elapsed`.
   *
   * The first iteration is returned unshifted rather than as
   * `elapsed - 0 * duration`, so an infinite `duration` cannot produce
   * `0 * Infinity === NaN`. Landing exactly on the end of the final iteration
   * reads as `duration`, not as `0` of an iteration that does not exist.
   */
  #localAt(elapsed: number): number {
    const iteration = this.#iterationAt(elapsed);
    return iteration === 0 ? elapsed : elapsed - iteration * this.#duration;
  }

  /**
   * Moves to `target` elapsed seconds, writing the pose and firing whatever
   * `mode` allows across the range the move crossed.
   *
   * Forward moves walk the iterations they span so events re-arm on every wrap;
   * backward moves fire nothing and reposition the cursor, which re-arms the
   * events they rewound past. A clip with no events skips the walk entirely —
   * with nothing to fire, intermediate iterations are unobservable, and the pose
   * depends only on the final time.
   */
  #setElapsed(target: number, mode: EventMode): void {
    const from = this.#cursor;
    this.#elapsed = target;

    const eventless = (this.#clip as AnimationClip).events.length === 0;
    if (mode === "silent" || eventless || !(target > from)) {
      this.#applyPose(this.#localAt(target));
      if (mode !== "silent") {
        // Rewinding to the very start re-arms events at clip time 0, exactly as
        // play() does; any other position is its own exclusive lower bound.
        // `from > 0` distinguishes a real rewind from a zero-delta advance at
        // position 0 (2026-08-05 review fix): the cursor sits AT 0 right
        // after the time-0 events fire, and re-arming on a no-move advance
        // made the next forward step fire them a second time, violating
        // §16's once-per-forward-crossing rule.
        this.#cursor = target === 0 && from > 0 ? CURSOR_BEFORE_START : target;
      }
      return;
    }

    const duration = this.#duration;
    const lastIteration = this.#iterationAt(target);
    const firstIteration = from <= 0 ? 0 : this.#iterationAt(from);
    for (
      let iteration = firstIteration;
      iteration <= lastIteration;
      iteration += 1
    ) {
      const localTo =
        iteration === lastIteration ? this.#localAt(target) : duration;
      // As in `#localAt`: never `0 * Infinity`.
      const localFrom = iteration === 0 ? from : from - iteration * duration;
      this.#applyPose(localTo);
      this.#fireEvents(localFrom, localTo, mode);
    }
    this.#cursor = target;
  }

  /**
   * Samples every track at clip-local `local` and writes the results, in
   * `clip.tracks` order (§33: insertion order only), so two tracks on one
   * property resolve last-declared-wins.
   *
   * §42 is enforced here with `Tween`'s semantics: if any bound track sits
   * inside the authority node's transform and that node is not owned by
   * `"animation"`, the conflict is reported once (deduplicated per node per
   * writer by `warnAuthorityConflict`) and **every** transform write of this
   * evaluation is skipped — never a partial pose. Non-transform tracks are
   * unaffected, and the moment authority is granted the next write lands on the
   * value for the current time, because evaluation never depended on the writes
   * that were refused.
   *
   * Allocates nothing.
   */
  #applyPose(local: number): void {
    this.#allowTransform = true;
    if (this.#hasTransformEntries) {
      // `#authorityNode` is defined whenever `#hasTransformEntries` is true: an
      // entry can only be a transform entry if a node was resolved.
      const node = this.#authorityNode as Node;
      if (node.transformAuthority !== MIXER_AUTHORITY) {
        warnAuthorityConflict(node, MIXER_AUTHORITY);
        this.#allowTransform = false;
      }
    }
    if (this.#allowTransform) {
      runOwnedTransformWrite(() => {
        (this.#clip as AnimationClip).sampleAll(local, this.#sink);
      });
    } else {
      (this.#clip as AnimationClip).sampleAll(local, this.#sink);
    }
  }

  /** Writes one sampled value through its binding. See `./values.js` on `out`. */
  #write(entry: MixerEntry, value: unknown): void {
    if (!entry.claim.held || (entry.isTransform && !this.#allowTransform)) {
      return;
    }
    entry.binding.set(value);
    if (entry.notifyChange) {
      // A primitive write is a direct field write and bypasses plan D3's change
      // hook; re-fire it so `Transform.version` still advances.
      (entry.binding.owner as { onChanged?: () => void }).onChanged?.();
    }
  }

  /**
   * Fires the clip events in the half-open range `(localFrom, localTo]` — the
   * crossing convention of `AnimationClip.eventsInRange`, which owns the search.
   * In `"seek"` mode nothing fires unless the playback opted in. Allocation-free.
   */
  #fireEvents(localFrom: number, localTo: number, mode: EventMode): void {
    if (mode === "seek" && !this.#replayOnSeek) {
      return;
    }
    (this.#clip as AnimationClip).eventsInRange(
      localFrom,
      localTo,
      this.#visitEvent,
    );
  }

  /** Frees every registry slot this mixer still owns (§16). */
  #releaseClaims(): void {
    for (const entry of this.#entries) {
      if (!entry.rootMotion) {
        releaseProperty(entry.binding.owner, entry.binding.key, entry.claim);
      }
    }
  }
}
