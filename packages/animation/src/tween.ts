/**
 * Tweens (§15).
 *
 * §15's example is the whole API in four lines:
 *
 * ```ts
 * Four.animate(node.position)
 *   .to({ x: 10, y: 5 }, 1.0)
 *   .ease("cubic-out")
 *   .play();
 * ```
 *
 * {@link animate} is that entry point ({@link Four} is the umbrella namespace,
 * plan P4-4 — this package owns the function). {@link tween} is §16's one-shot
 * form, `tween(target, props, seconds)`, which builds the same object without
 * playing it so a timeline can own its playback.
 *
 * ## Evaluation is a pure function of local time (§16)
 *
 * §16 requires that "evaluating at time `t` always produces the same values,
 * which is what scrubbing and deterministic evaluation require". A tween here
 * holds exactly one piece of mutable playback state — its local time — and
 * every value it writes is derived from that number alone:
 *
 * ```text
 * value = adapter.lerp(start, end, easing(progress(localTime)))
 * ```
 *
 * `start` and `end` are captured once, at {@link Tween.play}, and never read
 * back from the live property afterwards. Consequently {@link Tween.seek}
 * called twice with the same argument writes byte-identical values, and
 * scrubbing backwards is exactly as valid as scrubbing forwards — the tween
 * cannot accumulate error because it never integrates.
 *
 * ## No clocks (plan P4-1, §33)
 *
 * A tween never reads a clock. Local time advances only through
 * {@link Tween.advance}, which the fixed-step `AnimationSystem` (WP-4.6) calls
 * with the scaled simulation delta, and through {@link Tween.seek}. Nothing in
 * this module touches `Date.now`, `performance.now`, or `Math.random`, and the
 * only iteration order is insertion order.
 *
 * ## Exact landings
 *
 * `values.ts` warns that `a + (b - a) * t` is not guaranteed to return exactly
 * `b` at `t = 1`, and tells tweens to "assign the end value at completion
 * instead of lerping to it". This module does precisely that: an eased progress
 * of exactly `1` assigns {@link TweenEntry.end}, and exactly `0` assigns the
 * captured start, so a tween lands on the values it was authored with —
 * including the start value at the end of an odd yoyo cycle.
 *
 * ## Change hooks (plan D3)
 *
 * `Vector3.x` is a plain field, so `binding.set` on the path `"x"` is a direct
 * field write and, as `vector3.ts` says, "direct field writes bypass the hook
 * by design". §15's own example animates `{ x, y }` of a transform's position,
 * so a tween that ignored this would leave `Transform.version` stale and the
 * local matrix never recomposed. After every write through a
 * `mutatesInPlace: false` adapter this module therefore invokes the owner's
 * `onChanged` hook if it has one — restoring exactly the notification a
 * `position.set(...)` call would have produced. In-place adapters need nothing:
 * `adapter.copy` is a math method and fires the hook itself.
 *
 * ## Allocation (§7b)
 *
 * {@link Tween.play} allocates: three clones per animated property (start, end,
 * and the `out` scratch the in-place adapters interpolate into). After that the
 * advance path allocates nothing at all — no math objects, no closures, no
 * iterators over the entry array.
 */

import { DEV_WARNING_PREFIX, FourError } from "@fourjs/core";
import type { Quaternion, Vector2, Vector3, Vector4 } from "@fourjs/math";
import { Node, runOwnedTransformWrite, warnAuthorityConflict } from "@fourjs/scene";
import type { TransformAuthority } from "@fourjs/scene";

import { createBinding, type PropertyBinding } from "./binding.js";
import {
  resolveEasing,
  type EasingFunction,
  type EasingName,
} from "./easing.js";
import { detectAdapter, type ColorRGBA, type ValueAdapter } from "./values.js";

/**
 * The §42 authority a tween writes transforms under. Module-private: a writer
 * declares which authority it *is*, and nothing outside this file configures
 * that (the same shape as `MotionSystem`'s `"kinematic"`).
 */
const TWEEN_AUTHORITY: TransformAuthority = "animation";

/** How a tween names itself in the §16 conflict warning. */
const TWEEN_WRITER_KIND = "tween";

/**
 * A value a tween can interpolate — every type `detectAdapter` recognizes.
 *
 * Discrete values (strings, enums, asset handles) are deliberately absent:
 * `detectAdapter` never guesses discrete, so a `.to({ state: "run" })` would
 * fail at {@link Tween.play} with a clear binding error rather than silently
 * step-animating. Discrete and custom-adapter animation is the clip layer's job
 * (§17, WP-4.5), where the adapter is declared rather than inferred.
 */
export type TweenValue =
  number | boolean | Vector2 | Vector3 | Vector4 | Quaternion | ColorRGBA;

/**
 * Target values keyed by property path, as in §15's `{ x: 10, y: 5 }`.
 *
 * Keys are {@link createBinding} paths resolved against the tween's target, so
 * both `animate(node.transform.position).to({ x: 10 })` and
 * `animate(node).to({ "transform.position.x": 10 })` name the same property.
 * The index signature is deliberately a plain `string`: a mapped type over
 * `keyof T` would type the first form and reject the second.
 *
 * Iteration order is the object's own key order, which is the order properties
 * are bound, claimed, and written in — insertion order throughout (§33).
 */
export interface TweenProperties {
  readonly [path: string]: TweenValue;
}

/**
 * Playback state of a {@link Tween}.
 *
 * - `"idle"` — built but never played; nothing is bound or claimed yet.
 * - `"running"` — {@link Tween.advance} moves it.
 * - `"paused"` — {@link Tween.resume} puts it back to `"running"`.
 * - `"finished"` — an `advance` carried local time to the end. The properties
 *   are freed for other tweens and `onComplete` has fired, but the tween can
 *   still be evaluated with {@link Tween.seek}.
 * - `"stopped"` — {@link Tween.stop} was called. The properties are freed and
 *   the tween writes nothing further; values stay where the last write put them.
 */
export type TweenState = "idle" | "running" | "paused" | "finished" | "stopped";

/** One animated property, resolved and captured at {@link Tween.play}. */
interface TweenEntry {
  /** Resolved property reference (§16). */
  readonly binding: PropertyBinding;
  /** `binding.adapter`, hoisted out of the hot path. */
  readonly adapter: ValueAdapter<unknown>;
  /** The authored path, for diagnostics and the §16 conflict warning. */
  readonly path: string;
  /**
   * This tween's §16 claim on the property. {@link PropertyClaim.held} is what
   * {@link Tween.#apply} tests: it is cleared when a later writer takes the slot
   * (last-started-wins) and by {@link Tween.stop}, but *not* by completion — a
   * finished tween has surrendered its registry slot yet can still be scrubbed
   * (§16), which is what a `Timeline` needs from it.
   */
  readonly claim: PropertyClaim;
  /** Start value, captured at play (or supplied by {@link Tween.from}). */
  readonly start: unknown;
  /** End value, cloned so the caller may reuse or mutate what it passed in. */
  readonly end: unknown;
  /** `out` storage for in-place adapters; ignored by the primitive adapters. */
  readonly scratch: unknown;
  /** Whether this property sits inside the resolved authority node's transform. */
  readonly isTransform: boolean;
  /** Whether a write here bypasses a plan-D3 change hook and must re-fire it. */
  readonly notifyChange: boolean;
}

/**
 * One writer's live claim on one property (§16).
 *
 * The claim is the *object* stored in the registry, so a writer needs no
 * back-reference from the registry to itself: losing a conflict is
 * `held = false` on the claim the loser is already holding, which is also the
 * flag its write path tests. That is why a `Tween` and an `AnimationMixer` can
 * share one registry without either knowing the other's type.
 */
export interface PropertyClaim {
  /**
   * What kind of writer holds it — `"tween"`, `"clip"` — named in the §16
   * conflict warning so the message says which two writers collided.
   */
  readonly writerKind: string;

  /**
   * Whether the holder may still write the property. Cleared when a later
   * writer claims the same slot, and by the holder's own `stop`.
   */
  held: boolean;
}

/**
 * Live property claims, keyed by the binding's resolved owner and final key
 * (§16: "when two active tweens target the same property, the last-started
 * tween wins").
 *
 * Keying by *resolved* owner rather than by target-plus-path is what makes the
 * rule actually work: `animate(node).to({ "transform.position.x": 1 })` and
 * `animate(node.transform.position).to({ x: 2 })` name one property through two
 * different paths, and both land on the same `(Vector3, "x")` slot.
 *
 * **One registry for every animation writer.** Tweens and clip mixers claim
 * here through {@link claimProperty}, so a tween and a mixer fighting over one
 * property resolve by the same last-started-wins rule, with the same warning, as
 * two tweens do. A second registry would have made §16's rule true only within a
 * writer type, which is not what §16 says.
 *
 * A `WeakMap` so the bookkeeping dies with the owner object and holds nothing
 * alive; the inner `Map` iterates in insertion order, though nothing here
 * depends on that beyond determinism hygiene (§33).
 */
const propertyClaims = new WeakMap<object, Map<string, PropertyClaim>>();

/**
 * Records `claim` as the live claim on `owner[key]` (§16 last-started-wins),
 * warning about and revoking whatever claim was there before.
 *
 * `path` is the authored path, used only in the warning. Module-internal: it is
 * shared with `./mixer.js` and is deliberately absent from the package barrel.
 */
export function claimProperty(
  owner: object,
  key: string,
  path: string,
  claim: PropertyClaim,
): void {
  let slots = propertyClaims.get(owner);
  if (slots === undefined) {
    slots = new Map<string, PropertyClaim>();
    propertyClaims.set(owner, slots);
  }
  const previous = slots.get(key);
  if (previous !== undefined) {
    console.warn(
      `${DEV_WARNING_PREFIX} Two animation writers target the property "${path}" of the same ` +
        `object (a ${previous.writerKind}, then a ${claim.writerKind}); the ` +
        "last-started tween wins (§16) and the earlier writer stops writing " +
        "this property. Stop the earlier writer, or sequence the two on a " +
        "Timeline, to silence this warning.",
    );
    previous.held = false;
  }
  slots.set(key, claim);
  claim.held = true;
}

/**
 * Frees the registry slot for `owner[key]` if `claim` still holds it, so a later
 * writer can claim it without a §16 conflict warning.
 *
 * A slot already taken by someone else is left alone — deleting there would
 * silently disown the current holder. {@link PropertyClaim.held} is *not*
 * cleared: releasing the registry and giving up writing are different events
 * (see {@link TweenEntry.claim}).
 */
export function releaseProperty(
  owner: object,
  key: string,
  claim: PropertyClaim,
): void {
  const slots = propertyClaims.get(owner);
  if (slots !== undefined && slots.get(key) === claim) {
    slots.delete(key);
  }
}

/** Throws the §89 error used for every malformed tween configuration. */
function invalidTween(
  message: string,
  context: Record<string, unknown>,
): never {
  throw new FourError("INVALID_APPLICATION_STATE", message, { context });
}

/**
 * Rejects anything that is not a finite number `>= 0`.
 *
 * Module-internal, shared with `./timeline.js` and `./mixer.js` — every §16
 * player validates its seconds identically (§7a) — and deliberately absent
 * from the package barrel, like {@link claimProperty}.
 */
export function requireNonNegativeSeconds(value: number, what: string): number {
  if (!Number.isFinite(value) || value < 0) {
    invalidTween(
      `${what} must be a finite number of seconds >= 0 (§7a: all times are seconds); received ${String(value)}.`,
      { value },
    );
  }
  return value;
}

/**
 * True when `owner` is `node.transform` or one of the transform's own authored
 * members — the objects a transform write actually lands in.
 *
 * Deliberately an identity test over a fixed set rather than a walk up some
 * parent chain: math types carry no back-reference to their owner, so identity
 * is the only fact available, and it is exact.
 *
 * Module-internal, shared with `./mixer.js` so the two writers gate transform
 * writes on exactly the same set of objects; not part of the package barrel.
 */
export function isTransformOwner(node: Node, owner: object): boolean {
  const { transform } = node;
  return (
    owner === transform ||
    owner === transform.position ||
    owner === transform.rotation ||
    owner === transform.scale ||
    owner === transform.pivot ||
    owner === transform.localMatrix ||
    owner === transform.worldMatrix
  );
}

/**
 * A §15 tween: the builder and the playing object in one.
 *
 * Configuration methods (`to`, `from`, `ease`, `delay`, `repeat`, `yoyo`,
 * `speed`, `authority`, `onComplete`) return `this` and are legal only before
 * {@link Tween.play}; calling one afterwards throws, because start values,
 * bindings, and property claims are all fixed at play time and a late change
 * would silently mean something different than it reads. Playback controls
 * (`play`, `pause`, `resume`, `advance`, `seek`, `stop`) return `this` too, so
 * §15's chain reads exactly as written.
 *
 * ## Timing
 *
 * ```text
 * localTime                              (seconds, advanced by `advance`)
 *   ├── delay ──┤├── duration ──┤├── duration ──┤ …  repeat + 1 cycles
 * ```
 *
 * `advance(dt)` adds `dt * speed`. Time inside the delay produces progress `0`
 * (the start pose is written, so `from()` is visible immediately). Beyond the
 * delay, local time folds into `[0, duration]` once per cycle; with
 * {@link Tween.yoyo} every odd cycle is reflected, so the tween walks back to
 * its start value. `repeat(Infinity)` makes the total duration infinite and the
 * tween never finishes.
 *
 * A completing `advance` clamps local time to exactly the total duration, which
 * is why a tween lands exactly on its end value at `t = duration` rather than
 * wherever the last delta happened to overshoot to.
 *
 * ## Conflicts (§16) and authority (§42)
 *
 * {@link Tween.play} claims every property it animates. Claiming one another
 * tween already holds emits a development warning and revokes the earlier
 * tween's claim *on that property only* — the earlier tween keeps animating
 * everything else, and is effectively stopped only if it loses all of its
 * properties. {@link Tween.stop} and natural completion release claims.
 *
 * Properties inside a node's transform are additionally gated on §42 authority:
 * see {@link Tween.authority} for how the node is found, and the class body for
 * what a refusal does.
 */
export class Tween {
  /** Root object every path in {@link Tween.to} is resolved against. */
  readonly #target: object;

  /** End values by path, in authored order. */
  readonly #to = new Map<string, TweenValue>();

  /** Explicit start values by path (subset of {@link Tween.#to}). */
  readonly #from = new Map<string, TweenValue>();

  /** Cycle length in seconds; `0` is a legal instant set. */
  #duration = 0;

  /** Whether {@link Tween.to} has been called — `duration` alone cannot say. */
  #configured = false;

  /** Easing applied to the folded progress. */
  #easing: EasingFunction = resolveEasing("linear");

  /** Seconds of local time consumed before progress starts. */
  #delay = 0;

  /** Additional cycles after the first; may be `Infinity`. */
  #repeat = 0;

  /** Whether odd cycles are reflected. */
  #yoyo = false;

  /** Multiplier applied to every `advance` delta. */
  #speed = 1;

  /** Fires once, on the advance that finishes the tween. */
  #onComplete: (() => void) | undefined;

  /** Node declared by {@link Tween.authority}, if any. */
  #declaredNode: Node | undefined;

  /** Node whose §42 authority gates this tween's transform writes. */
  #authorityNode: Node | undefined;

  /** Animated properties, resolved at play, in authored order. */
  #entries: TweenEntry[] = [];

  /** Whether any entry writes into {@link Tween.#authorityNode}'s transform. */
  #hasTransformEntries = false;

  /** See {@link TweenState}. */
  #state: TweenState = "idle";

  /** Seconds since play, including the delay. */
  #localTime = 0;

  /** Whether local time has reached the total duration. */
  #completed = false;

  /** Guarantees `onComplete` can never fire twice. */
  #completeFired = false;

  /**
   * Prefer {@link animate} or {@link tween}; the constructor is public only so
   * a `Tween` can be built by name where that reads better.
   */
  constructor(target: object) {
    this.#target = target;
  }

  // --- introspection ------------------------------------------------------

  /** The object paths are resolved against. */
  get target(): object {
    return this.#target;
  }

  /** Current playback state. */
  get state(): TweenState {
    return this.#state;
  }

  /** Seconds since {@link Tween.play}, including the delay. */
  get localTime(): number {
    return this.#localTime;
  }

  /** Length of one cycle in seconds, as passed to {@link Tween.to}. */
  get duration(): number {
    return this.#duration;
  }

  /**
   * `delay + duration × (repeat + 1)` seconds — the local time at which the
   * tween finishes. `Infinity` for `repeat(Infinity)`, and just the delay for a
   * zero-duration tween (where `0 × Infinity` would otherwise be `NaN`).
   */
  get totalDuration(): number {
    if (this.#duration <= 0) {
      return this.#delay;
    }
    return this.#delay + this.#duration * (this.#repeat + 1);
  }

  /**
   * Whether an advance has carried local time to {@link Tween.totalDuration}.
   *
   * A playback fact, not a time fact: {@link Tween.seek} never sets or clears
   * it, so scrubbing a finished tween back inspects its earlier values without
   * pretending it is running again, and scrubbing an unfinished tween past its
   * end does not silently consume the completion its next advance owes.
   * Restarting a finished tween is deliberately not offered — build a new tween,
   * or let a `Timeline` (§16) own repeated playback.
   */
  get finished(): boolean {
    return this.#completed;
  }

  /**
   * Eased progress currently being written, in `[0, 1]` for the standard
   * easings. Derived from {@link Tween.localTime} alone.
   */
  get progress(): number {
    return this.#easing(this.#progressAt(this.#localTime));
  }

  // --- configuration ------------------------------------------------------

  /**
   * Declares the properties to animate and the cycle length in seconds (§7a —
   * never milliseconds).
   *
   * Callable once. A second call throws rather than guessing whether it meant
   * "add properties" or "append a second segment": sequencing is §16's
   * `Timeline`, not a tween's job.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — called after
   * {@link Tween.play}, called twice, or given a negative or non-finite
   * duration.
   */
  to(properties: TweenProperties, durationSeconds: number): this {
    this.#assertConfigurable("to");
    if (this.#configured) {
      invalidTween(
        "Tween.to() may be called only once; use a Timeline (§16) to sequence tweens.",
        { paths: [...this.#to.keys()] },
      );
    }
    requireNonNegativeSeconds(durationSeconds, "Tween duration");
    for (const path of Object.keys(properties)) {
      this.#to.set(path, properties[path]);
    }
    this.#duration = durationSeconds;
    this.#configured = true;
    return this;
  }

  /**
   * Overrides the start values that would otherwise be captured from the live
   * properties at {@link Tween.play}.
   *
   * Values are cloned at play, so the objects passed here stay the caller's.
   * Paths may be a subset of {@link Tween.to}'s; anything omitted is still
   * captured live. A path that is *not* in `to` is a mistake and throws at play
   * (it cannot be caught here — `from` may legally be chained before `to`).
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — called after
   * {@link Tween.play}.
   */
  from(properties: TweenProperties): this {
    this.#assertConfigurable("from");
    for (const path of Object.keys(properties)) {
      this.#from.set(path, properties[path]);
    }
    return this;
  }

  /**
   * Sets the easing curve, by §15 name (`"cubic-out"`) or as a bare
   * `(t) => number`. Unknown names throw through `resolveEasing`.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — called after
   * {@link Tween.play}, or the name is not a §15 easing.
   */
  ease(easing: EasingName | EasingFunction): this {
    this.#assertConfigurable("ease");
    this.#easing =
      typeof easing === "function" ? easing : resolveEasing(easing);
    return this;
  }

  /**
   * Seconds of local time to consume before progress starts. The start pose is
   * written throughout the delay, so a delayed tween holds its start values
   * rather than leaving the property wherever it was.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — called after
   * {@link Tween.play}, or the delay is negative or non-finite.
   */
  delay(seconds: number): this {
    this.#assertConfigurable("delay");
    this.#delay = requireNonNegativeSeconds(seconds, "Tween delay");
    return this;
  }

  /**
   * Number of *additional* cycles after the first, so `repeat(1)` plays twice
   * and `repeat(0)` (the default) plays once. `Infinity` never finishes.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — called after
   * {@link Tween.play}, or the count is not a non-negative integer or
   * `Infinity`.
   */
  repeat(count: number): this {
    this.#assertConfigurable("repeat");
    if (count !== Infinity && (!Number.isInteger(count) || count < 0)) {
      invalidTween(
        `Tween repeat count must be a non-negative integer or Infinity; received ${String(count)}.`,
        { count },
      );
    }
    this.#repeat = count;
    return this;
  }

  /**
   * Reflects every odd cycle, so a repeating tween walks back to its start
   * value instead of jumping. Easing is applied *after* the reflection, which
   * is what makes an eased yoyo symmetric in shape.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — called after
   * {@link Tween.play}.
   */
  yoyo(enabled = true): this {
    this.#assertConfigurable("yoyo");
    this.#yoyo = enabled;
    return this;
  }

  /**
   * Multiplier applied to every {@link Tween.advance} delta.
   *
   * Must be positive and finite. Reverse playback is deliberately *not*
   * spelled `speed(-1)`: §16 lists "reversing" as a `Timeline` requirement, and
   * a negative multiplier here would make "the advance that finishes the tween"
   * ambiguous. Scrub backwards with {@link Tween.seek} instead.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — called after
   * {@link Tween.play}, or the multiplier is not finite and `> 0`.
   */
  speed(multiplier: number): this {
    this.#assertConfigurable("speed");
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      invalidTween(
        `Tween speed must be a finite multiplier > 0; received ${String(multiplier)}. Reverse playback is a Timeline feature (§16).`,
        { multiplier },
      );
    }
    this.#speed = multiplier;
    return this;
  }

  /**
   * Declares which node's §42 authority gates this tween's transform writes.
   *
   * **The inference is honest about its limits.** When the tween's target *is*
   * a `Node`, the node is found automatically and nothing needs declaring. But
   * §15's own example animates `node.position` — a bare `Vector3` — and a math
   * object carries no back-reference to the node that owns it, so
   * `animate(node.transform.position)` **cannot** infer the node and its
   * transform writes are ungated unless this method is called:
   *
   * ```ts
   * animate(node.transform.position).to({ x: 10 }, 1).authority(node).play();
   * ```
   *
   * A declared node gates only the properties that actually resolve inside its
   * transform (identity-tested against `transform` and its authored members);
   * declaring a node for a tween that touches no transform of that node is
   * inert rather than an error, since a tween may legitimately animate a mix.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — called after
   * {@link Tween.play}.
   */
  authority(node: Node): this {
    this.#assertConfigurable("authority");
    this.#declaredNode = node;
    return this;
  }

  /**
   * Callback for the advance that finishes the tween. It fires exactly once —
   * after the final values are written and the property claims released — and
   * never for {@link Tween.seek}, matching §16's rule that "seek and scrubbing
   * suppress" event callbacks.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — called after
   * {@link Tween.play}.
   */
  onComplete(callback: () => void): this {
    this.#assertConfigurable("onComplete");
    this.#onComplete = callback;
    return this;
  }

  // --- playback -----------------------------------------------------------

  /**
   * Resolves bindings, captures start values, claims properties (§16), and
   * starts playback at local time 0 — writing the start pose immediately, so
   * {@link Tween.from} takes effect without waiting for an advance.
   *
   * A no-op on a tween that is not `"idle"`: replaying is
   * `seek(0)` plus {@link Tween.resume}, and silently re-capturing start values
   * from a half-animated property would make playback depend on when `play` was
   * called rather than on local time.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — {@link Tween.to} was never
   * called; a {@link Tween.from} path is not among the animated properties; or
   * a supplied value's type does not match the bound property's.
   * @throws FourError from `createBinding` — a path does not resolve, or its
   * value type has no adapter.
   */
  play(): this {
    if (this.#state !== "idle") {
      return this;
    }
    if (!this.#configured) {
      invalidTween(
        "Tween.play() requires Tween.to(properties, durationSeconds) first (§15).",
        {},
      );
    }
    for (const path of this.#from.keys()) {
      if (!this.#to.has(path)) {
        invalidTween(
          `Tween.from() names "${path}", which Tween.to() does not animate.`,
          { path, animated: [...this.#to.keys()] },
        );
      }
    }

    const node =
      this.#declaredNode ??
      (this.#target instanceof Node ? this.#target : undefined);

    const entries: TweenEntry[] = [];
    let hasTransformEntries = false;
    for (const [path, endValue] of this.#to) {
      const binding = createBinding(this.#target, path);
      const adapter = binding.adapter;
      const fromValue = this.#from.get(path);
      this.#assertKind(path, endValue, adapter, "Tween.to()");
      if (fromValue !== undefined) {
        this.#assertKind(path, fromValue, adapter, "Tween.from()");
      }
      const startSource: unknown = fromValue ?? binding.get();
      const isTransform =
        node !== undefined && isTransformOwner(node, binding.owner);
      hasTransformEntries = hasTransformEntries || isTransform;
      entries.push({
        binding,
        adapter,
        path,
        claim: { writerKind: TWEEN_WRITER_KIND, held: false },
        start: adapter.clone(startSource),
        end: adapter.clone(endValue),
        scratch: adapter.clone(startSource),
        isTransform,
        notifyChange: !adapter.mutatesInPlace,
      });
    }

    this.#entries = entries;
    this.#hasTransformEntries = hasTransformEntries;
    this.#authorityNode = hasTransformEntries ? node : undefined;
    this.#claimProperties();
    this.#state = "running";
    this.#apply();
    return this;
  }

  /** Suspends advancing. A no-op unless the tween is `"running"`. */
  pause(): this {
    if (this.#state === "running") {
      this.#state = "paused";
    }
    return this;
  }

  /** Resumes advancing. A no-op unless the tween is `"paused"`. */
  resume(): this {
    if (this.#state === "paused") {
      this.#state = "running";
    }
    return this;
  }

  /**
   * Advances local time by `deltaSeconds × speed` and writes the resulting
   * values. Called by the fixed-step `AnimationSystem` (plan P4-1); a tween
   * never advances itself and never reads a clock (§33).
   *
   * A no-op unless the tween is `"running"` and unfinished. The advance that
   * reaches {@link Tween.totalDuration} clamps local time to it, writes the
   * exact end values, frees the properties it held, and fires
   * {@link Tween.onComplete} — in that order, so the callback observes the
   * final pose.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — the delta is negative or
   * non-finite.
   */
  advance(deltaSeconds: number): this {
    requireNonNegativeSeconds(deltaSeconds, "Tween advance delta");
    if (this.#state !== "running" || this.#completed) {
      return this;
    }
    this.#localTime += deltaSeconds * this.#speed;
    const total = this.totalDuration;
    if (this.#localTime >= total) {
      this.#localTime = total;
      this.#completed = true;
    }
    this.#apply();
    if (this.#completed) {
      this.#state = "finished";
      this.#releaseRegistry();
      if (!this.#completeFired) {
        this.#completeFired = true;
        this.#onComplete?.();
      }
    }
    return this;
  }

  /**
   * Positions playback at `localTimeSeconds` and writes the values for that
   * time. Pure: seeking to the same time twice writes identical values, and
   * seeking backwards is as valid as forwards (§16 scrubbing).
   *
   * Neither {@link Tween.state} nor {@link Tween.finished} changes — a paused
   * tween stays paused, a finished one stays finished — so a seek is only ever
   * an evaluation, never a playback decision. `onComplete` therefore never
   * fires from a seek (§16: "seek and scrubbing suppress them by default");
   * seeking past the end does not consume the completion that the next advance
   * still owes.
   *
   * A `"stopped"` tween repositions but writes nothing: it released its
   * properties. A `"finished"` one still writes, which is what scrubbing means;
   * if another tween has since claimed those properties, that scrub competes
   * with it unwarned — stop a finished tween you intend to keep scrubbing past.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — the tween has never been
   * played (no start values exist yet), or the time is negative or non-finite.
   */
  seek(localTimeSeconds: number): this {
    requireNonNegativeSeconds(localTimeSeconds, "Tween seek time");
    if (this.#state === "idle") {
      invalidTween(
        "Tween.seek() requires Tween.play() first: start values are captured at play.",
        { localTimeSeconds },
      );
    }
    this.#localTime = localTimeSeconds;
    this.#apply();
    return this;
  }

  /**
   * Stops the tween and releases its property claims, leaving every animated
   * value exactly where the last write put it. A stopped tween never writes
   * again, and the properties it held are free for another tween to claim
   * without a §16 conflict warning.
   *
   * A no-op on an `"idle"` tween, which holds nothing.
   */
  stop(): this {
    if (this.#state === "idle") {
      return this;
    }
    this.#releaseRegistry();
    for (const entry of this.#entries) {
      entry.claim.held = false;
    }
    this.#state = "stopped";
    return this;
  }

  // --- internals ----------------------------------------------------------

  /** Rejects configuration after {@link Tween.play}. */
  #assertConfigurable(method: string): void {
    if (this.#state !== "idle") {
      invalidTween(
        `Tween.${method}() cannot be called after play(): bindings, start values, and property claims are fixed at play time.`,
        { method, state: this.#state },
      );
    }
  }

  /** Rejects a supplied value whose type does not match the bound property's. */
  #assertKind(
    path: string,
    value: TweenValue,
    adapter: ValueAdapter<unknown>,
    source: string,
  ): void {
    const kind = detectAdapter(value)?.kind;
    if (kind !== adapter.kind) {
      invalidTween(
        `${source} gives "${path}" a ${kind ?? "value of unrecognized type"}, but the bound property is ${adapter.kind}.`,
        { path, expected: adapter.kind, received: kind },
      );
    }
  }

  /**
   * Claims every animated property (§16 last-started-wins), warning about and
   * revoking any earlier writer's claim on the same slot.
   */
  #claimProperties(): void {
    for (const entry of this.#entries) {
      claimProperty(
        entry.binding.owner,
        entry.binding.key,
        entry.path,
        entry.claim,
      );
    }
  }

  /**
   * Frees every registry slot this tween still owns, so a later writer can
   * claim those properties without a §16 conflict warning.
   */
  #releaseRegistry(): void {
    for (const entry of this.#entries) {
      releaseProperty(entry.binding.owner, entry.binding.key, entry.claim);
    }
  }

  /**
   * Folds `localTime` into a progress in `[0, 1]`. Pure, allocation-free, and
   * the only place playback timing is decided. See {@link Tween} for the model.
   */
  #progressAt(localTime: number): number {
    const active = localTime - this.#delay;
    if (active < 0) {
      return 0;
    }
    if (this.#duration <= 0) {
      // A zero-duration tween is an instant set; it also keeps `cycleIndex`
      // from being `floor(x / 0) === Infinity` below.
      return 1;
    }
    const cycles = this.#repeat + 1;
    const totalActive = this.#duration * cycles;
    let cycleIndex: number;
    let cycleTime: number;
    if (active >= totalActive) {
      // Land on the exact end of the final cycle rather than on whatever the
      // division produces one ulp past the boundary.
      cycleIndex = cycles - 1;
      cycleTime = this.#duration;
    } else {
      cycleIndex = Math.floor(active / this.#duration);
      cycleTime = active - cycleIndex * this.#duration;
    }
    const unit = cycleTime / this.#duration;
    return this.#yoyo && cycleIndex % 2 === 1 ? 1 - unit : unit;
  }

  /**
   * Writes every claimed property for the current local time.
   *
   * §42 is enforced here, with WP-2.3's semantics: if any property of this
   * tween sits inside the authority node's transform and that node is not owned
   * by `"animation"`, the conflict is reported once (deduplicated per node per
   * writer by `warnAuthorityConflict`) and **every** transform write of this
   * advance is skipped — never a partial pose. Non-transform properties are
   * unaffected and keep animating, and the moment authority is granted the next
   * write lands on the value for the current local time, because evaluation
   * never depended on the writes that were refused.
   *
   * Allocates nothing.
   */
  #apply(): void {
    let allowTransform = true;
    if (this.#hasTransformEntries) {
      // `#authorityNode` is defined whenever `#hasTransformEntries` is true:
      // an entry can only be a transform entry if a node was resolved.
      const node = this.#authorityNode as Node;
      if (node.transformAuthority !== TWEEN_AUTHORITY) {
        warnAuthorityConflict(node, TWEEN_AUTHORITY);
        allowTransform = false;
      }
    }

    const eased = this.#easing(this.#progressAt(this.#localTime));
    const applyEntries = (): void => {
      const entries = this.#entries;
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (!entry.claim.held || (entry.isTransform && !allowTransform)) {
          continue;
        }
        // Exact endpoints: `values.ts` does not promise `lerp(a, b, 1) === b`,
        // so the endpoints are assigned rather than interpolated.
        let value: unknown;
        if (eased === 0) {
          value = entry.start;
        } else if (eased === 1) {
          value = entry.end;
        } else {
          value = entry.adapter.lerp(
            entry.start,
            entry.end,
            eased,
            entry.scratch,
          );
        }
        entry.binding.set(value);
        if (entry.notifyChange) {
          // A primitive write is a direct field write and bypasses plan D3's
          // change hook; re-fire it so `Transform.version` still advances.
          (entry.binding.owner as { onChanged?: () => void }).onChanged?.();
        }
      }
    };
    if (allowTransform) {
      runOwnedTransformWrite(applyEntries);
    } else {
      applyEntries();
    }
  }
}

/**
 * Starts a §15 tween builder against `target`.
 *
 * ```ts
 * animate(node.transform.position)
 *   .to({ x: 10, y: 5 }, 1.0)
 *   .ease("cubic-out")
 *   .authority(node)   // see Tween.authority — a bare Vector3 cannot infer it
 *   .play();
 * ```
 *
 * Nothing is resolved, captured, or claimed until {@link Tween.play}.
 */
export function animate(target: object): Tween {
  return new Tween(target);
}

/**
 * §16's one-shot form: `tween(node.position, { x: 5 }, 0.8)`, equivalent to
 * `animate(target).to(properties, durationSeconds)`.
 *
 * Returned **unplayed**, because §16 hands the result to `timeline.at(...)`,
 * which owns its playback. Call `.play()` for a standalone tween.
 */
export function tween(
  target: object,
  properties: TweenProperties,
  durationSeconds: number,
): Tween {
  return animate(target).to(properties, durationSeconds);
}
