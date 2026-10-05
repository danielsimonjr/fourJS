/**
 * §18 animation state machines — {@link AnimationController}.
 *
 * §18 asks for a *declarative* controller that owns states and transitions
 * instead of an application `if`-chain swapping mixers:
 *
 * ```ts
 * const controller = new AnimationController({
 *   target: character,
 *   states: { idle: idleClip, walk: walkClip, run: runClip },
 *   parameters: { numbers: { speed: 0 } },
 *   transitions: [
 *     { from: "idle", to: "walk", when: [{ parameter: "speed", is: "greater", value: 0.1 }], duration: 0.2 },
 *     { from: "walk", to: "run",  when: [{ parameter: "speed", is: "greater", value: 5 }],   duration: 0.3 },
 *   ],
 * }).play();
 *
 * animation.track(controller);          // §39 step 3, exactly like a mixer
 * controller.setNumber("speed", 6);     // the machine takes it from here
 * ```
 *
 * ## Why this is not an `AnimationMixer` with a state field
 *
 * An {@link ./mixer.js#AnimationMixer} plays **one** clip and *claims* the
 * properties it writes: two mixers on one property resolve last-started-wins
 * with a §16 warning, which is a conflict, not a blend. §18's central feature —
 * `duration` on a transition — needs two clips contributing to one property at
 * once, so the controller cannot be a layer that starts and stops mixers. It is
 * a **pose evaluator in its own right**: it resolves one binding per animated
 * property (a *channel*), samples the source and destination clips into scratch,
 * mixes them through the channel's {@link ValueAdapter}, and writes
 * the result once. One claim per channel, held for the controller's whole life,
 * so a controller and a tween still resolve by §16's one rule.
 *
 * ## Channels, and what a state that does not animate one does
 *
 * A channel is the union of every state clip's track paths, in declaration order
 * (states in `states` order, tracks in `clip.tracks` order); the first
 * occurrence fixes the channel index, and every later track on that path must
 * agree on {@link ./values.js#ValueKind} — blending a `vector3` against a
 * `number` has no meaning, so it is a construction error rather than a runtime
 * surprise.
 *
 * A state that has no track for a channel contributes the channel's
 * **baseline**: the value the property held when {@link AnimationController.play}
 * captured it. That is a deliberate choice over "leave the property alone":
 *
 * - the written pose is then a pure function of (state, state time, weight) —
 *   the determinism argument this file rests on (§33) — instead of a function of
 *   whatever wrote the property last;
 * - a cross-fade into a state that animates a channel the source does not fades
 *   *from the baseline* instead of snapping, and out of one fades back to it.
 *
 * The consequence is worth stating plainly: a controller pins every channel it
 * owns, so a property animated by only one of five states is held at its
 * baseline while the other four play.
 *
 * ## Transition semantics (§18)
 *
 * | §18 feature              | how it is expressed here |
 * | ------------------------ | ------------------------ |
 * | parameters               | declared up front in three kinds — numbers, Booleans, triggers ({@link AnimationControllerParameters}) |
 * | Boolean conditions       | `{ parameter, is: "true" \| "false" }` |
 * | numeric comparisons      | `{ parameter, is: "greater" \| … , value }` |
 * | triggers                 | `{ parameter, is: "triggered" }`, latched until a transition consumes them |
 * | transition duration      | `duration` seconds of cross-fade (§7a: seconds, never a normalized fraction) |
 * | exit time                | `exitTime` seconds of source-state time that must have elapsed |
 * | transition interruption  | `interruptible` (default `true`) — see below |
 * | blend trees              | a state may be a {@link ./blend-tree.js#BlendTree} |
 * | layered animation        | {@link AnimationLayerStack} |
 * | "any state" transitions  | `from: "*"` (see below) |
 * | clip events              | {@link AnimationController.onClipEvent} |
 * | `when` string sugar      | compiles to the typed records below |
 *
 * **Conditions are typed predicates.** §18's sketch writes `when: "speed > 0.1"`.
 * The structured form is the evaluation target — an undeclared parameter or a
 * Boolean compared with `>` throws at construction, not never. The optional
 * string form is sugar with a *restricted* grammar (parameter, operator, number
 * or `true`/`false`; a bare identifier is a Boolean/`trigger` test) that
 * compiles to the same records and throws on parse failure.
 *
 * **A transition is taken when all of its conditions hold.** `when` is an AND;
 * an absent or empty `when` is vacuously true, which is what makes
 * `{ from: "attack", to: "idle", exitTime: 0.8 }` an automatic sequence. The
 * candidates are scanned in **declaration order** and the first eligible one
 * fires, so precedence is the order the author wrote (§33: insertion order
 * only).
 *
 * **Exit time is a gate in seconds.** `exitTime` is compared against the source
 * state's elapsed time, so the transition is ineligible until the state has
 * played that long. §7a forbids the normalized 0–1 fraction other engines use;
 * write `exitTime: clip.duration * 0.8` if a fraction is what you mean.
 *
 * **Interruption freezes the outgoing pose by default.** While a transition
 * runs, the machine evaluates the transitions leaving its *destination* state —
 * that state is what the controller reports as
 * {@link AnimationController.currentState} — unless the running transition
 * declared `interruptible: false`, in which case nothing is evaluated until it
 * completes. When a transition *is* interrupted, the blended pose at that
 * instant is captured per channel and becomes the frozen source of the new
 * transition. {@link AnimationControllerOptions.liveInterrupt} keeps sampling
 * the previous source and destination plus the new destination (three clips)
 * for a *single* interruption depth; a second interrupt falls back to freeze
 * so the chain stays bounded.
 *
 * **`from: "*"` is any state.** Wildcard transitions are scanned in declaration
 * order with the rest. A wildcard is eligible from every state except when
 * `from`/`to` would be a self-transition, unless the edge declared
 * `allowSelf: true`.
 *
 * ## Determinism (§33, §16)
 *
 * The controller reads no clock and no RNG: time enters only through
 * {@link AnimationController.advance}, exactly as a mixer's does, and the
 * `AnimationSystem` feeds it the fixed delta. Every ordered walk is over an
 * array — channels in construction order, transitions in declaration order — and
 * the three parameter `Map`s are only ever *looked up*, never iterated, so no
 * observable behaviour can depend on a `Map`'s iteration order. Given the same
 * initial state, the same parameter writes, and the same sequence of deltas, the
 * same values are written in the same order.
 *
 * What a controller deliberately does **not** have is
 * {@link ./mixer.js#AnimationMixer.seek}: a state machine's pose is a function
 * of its *history* (which conditions held when), not of a single time axis, so
 * there is no time to scrub to. Replay (§34) reproduces a controller by
 * replaying the deltas and the parameter writes, which is what §34 already does
 * for the rest of the engine.
 *
 * ## Allocation (§7b)
 *
 * {@link AnimationController.play} allocates: per channel one binding, one
 * claim, and the scratches a pose evaluation needs (baselines, frozen source,
 * per-state samples, blend-tree clip samples, live-interrupt mid, blend). After
 * that the advance path allocates nothing — sampling writes through the
 * scratches and blending writes through the blend scratch.
 *
 * ## Staged remainder (PH-9, 2026-09-06)
 *
 * Shipped here: blend trees (1D lerp + 2D inverse-distance of ≤3 neighbours),
 * `from: "*"` any-state transitions, clip-event dispatch with mixer `(from, to]`
 * semantics, `when` string sugar, and `liveInterrupt` at one interruption depth.
 * Layered / additive animation lives on {@link AnimationLayerStack}.
 *
 * Still **not** shipped:
 *
 * - **Serialization.** §18 constructs a controller directly and §97a lists
 *   `Node.animation` among the names with no shipped equivalent, so a controller
 *   is not a §6a component and has no §79 node-data serializer. Making it one is
 *   a separate decision with its own registry entry.
 * - **Unbounded live-interrupt chains.** A second interrupt still freezes.
 */

import { FourError } from "@fourjs/core";
import { Node, runOwnedTransformWrite, warnAuthorityConflict } from "@fourjs/scene";
import type { TransformAuthority } from "@fourjs/scene";

import type { Advanceable } from "./animation-system.js";
import {
  isBlendTree,
  locateBlend1D,
  locateBlend2D,
  type Blend2DRank,
  type BlendTree,
} from "./blend-tree.js";
import { createBinding, type PropertyBinding } from "./binding.js";
import { AnimationClip } from "./clip.js";
import type { AnimationEventListener } from "./mixer.js";
import type { AnimationTrackLike } from "./track.js";
import {
  claimProperty,
  isTransformOwner,
  releaseProperty,
  requireNonNegativeSeconds,
  type PropertyClaim,
} from "./tween.js";
import { detectAdapter, type ValueAdapter } from "./values.js";
import { compileWhenExpression } from "./when.js";

/** Wildcard `from` — eligible from every state (see {@link AnimationTransition}). */
export const ANY_STATE = "*";

/** Exclusive event-cursor value below clip time 0, matching `AnimationMixer`. */
const CURSOR_BEFORE_START = -1;

/**
 * The §42 authority a controller writes transforms under — `"animation"`, the
 * same one a tween and a mixer write under, because §42 identifies writers by
 * the authority they claim and all three *are* the animation system.
 */
const CONTROLLER_AUTHORITY: TransformAuthority = "animation";

/** How a controller names itself in the §16 conflict warning. */
const CONTROLLER_WRITER_KIND = "state-machine controller";

/**
 * Playback state of an {@link AnimationController}.
 *
 * The same vocabulary as `TweenState`, `TimelineState`, and `MixerState`, minus
 * one value: a controller is never `"finished"`. A state machine has no end —
 * its terminal state simply keeps playing — so
 * {@link AnimationController.finished} is permanently `false` and the
 * `AnimationSystem` never auto-untracks a running controller. Call
 * {@link AnimationController.stop} to end one.
 */
export type ControllerPlaybackState = "idle" | "running" | "paused" | "stopped";

/** How one state's clip or blend tree is played (§18 states). */
export interface AnimationStateOptions {
  /** The clip this state poses. Mutually exclusive with {@link AnimationStateOptions.blendTree}. */
  readonly clip?: AnimationClip;

  /**
   * A parameter-driven mix of clips (PH-9). Mutually exclusive with
   * {@link AnimationStateOptions.clip}.
   */
  readonly blendTree?: BlendTree;

  /**
   * Multiplier on this state's own clock, finite and `> 0`. Default `1`.
   * Composes with {@link AnimationController.speed}, which scales the whole
   * machine including the transition clock.
   */
  readonly speed?: number;

  /**
   * Total iterations of the clip, as `AnimationMixer.loop` counts them: `1`
   * plays once, `3` three times, `Infinity` forever. Default `Infinity` — the
   * §18 example's `idle`/`walk`/`run` are all cycles — after which the state
   * holds the clip's final pose rather than resetting or vanishing.
   */
  readonly loop?: number;
}

/**
 * A state's definition: a clip, a clip plus playback options, or a
 * {@link BlendTree}.
 */
export type AnimationStateInput =
  AnimationClip | AnimationStateOptions | BlendTree;

export type {
  BlendTree,
  BlendTree1D,
  BlendTree2D,
  BlendTree1DPoint,
  BlendTree2DPoint,
} from "./blend-tree.js";

/** The comparisons a numeric parameter condition can make (§18). */
export type NumericComparison =
  "greater" | "greaterOrEqual" | "less" | "lessOrEqual" | "equal" | "notEqual";

/**
 * A numeric-parameter comparison (§18 "numeric comparisons").
 *
 * `equal` and `notEqual` compare with `===`, so they are exact float equality
 * and mean what they say; compare a tolerance band with two conditions if that
 * is what is wanted.
 */
export interface NumericCondition {
  /** Name of a declared number parameter. */
  readonly parameter: string;
  /** The comparison to make. */
  readonly is: NumericComparison;
  /** Right-hand side; must be finite. */
  readonly value: number;
}

/** A Boolean-parameter test (§18 "Boolean conditions"). */
export interface BooleanCondition {
  /** Name of a declared Boolean parameter. */
  readonly parameter: string;
  /** Which value the parameter must hold. */
  readonly is: "true" | "false";
}

/**
 * A trigger test (§18 "triggers").
 *
 * A trigger is a latch: {@link AnimationController.setTrigger} raises it and it
 * stays raised — across any number of steps — until a transition that tests it
 * fires and consumes it, or {@link AnimationController.resetTrigger} clears it.
 * That is what makes `setTrigger("jump")` reliable from application code that
 * does not know the fixed-step phase it ran in.
 */
export interface TriggerCondition {
  /** Name of a declared trigger parameter. */
  readonly parameter: string;
  /** Discriminator; a trigger has only one test. */
  readonly is: "triggered";
}

/** One predicate over a declared parameter (§18). */
export type TransitionCondition =
  NumericCondition | BooleanCondition | TriggerCondition;

/**
 * One `when` clause: a typed predicate, a restricted string that compiles to
 * one, or an AND-list of either.
 */
export type TransitionWhen = string | readonly (string | TransitionCondition)[];

/** One authored edge of the state machine (§18 transitions). */
export interface AnimationTransition {
  /**
   * Source state name, or {@link ANY_STATE} (`"*"`) for an any-state edge.
   * A named source must be declared in `states`.
   */
  readonly from: string;

  /** Destination state name; must be declared in `states`. */
  readonly to: string;

  /**
   * Whether a wildcard (`from: "*"`) may fire as a self-transition. Named
   * `from`/`to` pairs that name the same state are always allowed (they are
   * authored self-transitions). Default `false`.
   */
  readonly allowSelf?: boolean;

  /**
   * Predicates that must **all** hold for the transition to be eligible.
   * Absent or empty is vacuously true — pair it with {@link
   * AnimationTransition.exitTime} to sequence states automatically.
   *
   * A string is sugar for one predicate (`"speed > 0.1"`, `"grounded"`);
   * an array ANDs its entries. See `./when.js` for the grammar.
   */
  readonly when?: TransitionWhen;

  /**
   * Cross-fade length in **seconds** (§7a). Default `0`, which switches the
   * pose on the step the transition fires. Finite and `>= 0`.
   */
  readonly duration?: number;

  /**
   * Seconds of source-state time that must have elapsed before the transition
   * becomes eligible (§18 "exit time"). Default `0`. Finite and `>= 0`.
   *
   * Deliberately seconds rather than the normalized fraction other engines use:
   * §7a admits no other unit. Write `clip.duration * 0.8` for "80% through".
   */
  readonly exitTime?: number;

  /**
   * Whether another transition may interrupt this one while it cross-fades.
   * Default `true`. See the module header on what interruption does to the
   * outgoing pose.
   */
  readonly interruptible?: boolean;
}

/**
 * The machine's declared parameters (§18), split by kind so that a condition can
 * be validated at construction.
 *
 * A name may appear in only one kind: `numbers.speed` and `booleans.speed`
 * together would make `{ parameter: "speed" }` ambiguous, so it throws.
 */
export interface AnimationControllerParameters {
  /** Number parameters and their initial values. */
  readonly numbers?: Readonly<Record<string, number>>;
  /** Boolean parameters and their initial values. */
  readonly booleans?: Readonly<Record<string, boolean>>;
  /** Trigger names. Every trigger starts lowered. */
  readonly triggers?: readonly string[];
}

/** Notified when the machine leaves one state for another. */
export type StateChangeListener = (
  /** The state being entered. */
  to: string,
  /** The state being left. */
  from: string,
) => void;

/** Construction inputs for {@link AnimationController}. */
export interface AnimationControllerOptions {
  /** Root object every track path is resolved against, exactly as a mixer's. */
  readonly target: object;

  /**
   * The machine's states, keyed by name. Must be non-empty; the first key is
   * the default {@link AnimationControllerOptions.initialState}.
   */
  readonly states: Readonly<Record<string, AnimationStateInput>>;

  /** The machine's edges, scanned in this order (§33). Default none. */
  readonly transitions?: readonly AnimationTransition[];

  /** Declared parameters and their initial values. Default none. */
  readonly parameters?: AnimationControllerParameters;

  /** State to start in. Defaults to the first key of `states`. */
  readonly initialState?: string;

  /**
   * The node whose §42 authority gates this controller's transform writes.
   * Inferred when `target` *is* a `Node`; declare it when the target is a
   * material, a bare `Transform`, or any other object that carries no
   * back-reference to a node.
   */
  readonly authority?: Node;

  /** Multiplier on every advance delta; finite and `> 0`. Default `1`. */
  readonly speed?: number;

  /**
   * Called when a transition fires, with the state being entered and the one
   * being left — after the machine has switched, before the pose is written.
   * Never called for entering the initial state, which is not a change.
   */
  readonly onStateChange?: StateChangeListener;

  /**
   * When true, interrupting a running cross-fade keeps sampling the previous
   * source and destination plus the new destination (three live clips) instead
   * of freezing the outgoing pose. A *second* interrupt still freezes, so the
   * mix stays bounded at one interruption depth. Default `false`.
   */
  readonly liveInterrupt?: boolean;
}

/** Second argument of {@link AnimationController.advance}. */
export interface ControllerAdvanceOptions {
  /**
   * When true, clocks and pose still update but clip events are suppressed
   * and their cursors move — §16 seek/scrub semantics, matching
   * `AnimationMixer.seek`. Default `false` (events fire).
   */
  readonly seek?: boolean;
}

/** One animated property, shared by every state that writes it. */
interface ChannelSpec {
  /** The authored track path. */
  readonly path: string;
  /** The value adapter every track on this path must agree on. */
  readonly adapter: ValueAdapter<unknown>;
}

/** A {@link ChannelSpec} bound to the target at {@link AnimationController.play}. */
interface Channel {
  /** The authored track path, for diagnostics and the §16 conflict warning. */
  readonly path: string;
  /** Resolved property reference (§16). */
  readonly binding: PropertyBinding;
  /** `binding.adapter`, hoisted out of the hot path. */
  readonly adapter: ValueAdapter<unknown>;
  /** `out` storage for the outgoing state's sample. */
  readonly fromScratch: unknown;
  /** `out` storage for the destination state's sample. */
  readonly toScratch: unknown;
  /** `out` storage for a live-interrupt source state. */
  readonly liveScratch: unknown;
  /** `out` storage for the live A–B mix; must not alias either endpoint. */
  readonly midScratch: unknown;
  /** Per-clip samples inside a blend tree (up to 3). */
  readonly treeScratch: [unknown, unknown, unknown];
  /** `out` storage for the mix of the two; never aliases either endpoint. */
  readonly blendScratch: unknown;
  /** What a state with no track for this channel contributes (see the header). */
  baseline: unknown;
  /** The pose captured when a cross-fade was interrupted. */
  frozen: unknown;
  /** Last evaluated pose; read by {@link AnimationLayerStack}. */
  evaluated: unknown;
  /** Whether this property sits inside the authority node's transform. */
  readonly isTransform: boolean;
  /** Whether a write here bypasses a plan-D3 change hook and must re-fire it. */
  readonly notifyChange: boolean;
  /** This controller's §16 claim; `held` gates every write. */
  readonly claim: PropertyClaim;
}

/** One compiled clip contribution inside a state (clip or blend-tree point). */
interface CompiledClip {
  readonly clip: AnimationClip;
  readonly tracks: readonly (AnimationTrackLike | undefined)[];
}

/** Compiled 1D blend: points sorted by value, then declaration index. */
interface CompiledBlend1D {
  readonly kind: "blend1d";
  readonly parameter: string;
  readonly values: readonly number[];
  readonly clips: readonly CompiledClip[];
}

/** Compiled 2D blend: points in declaration order. */
interface CompiledBlend2D {
  readonly kind: "blend2d";
  readonly parameterX: string;
  readonly parameterY: string;
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly clips: readonly CompiledClip[];
}

type CompiledBlend = CompiledBlend1D | CompiledBlend2D;

/** A validated state: its clip or tree, its clock policy, and its tracks. */
interface StateDefinition {
  /** The state's name, as declared. */
  readonly name: string;
  /** See {@link AnimationStateOptions.speed}. */
  readonly speed: number;
  /** One iteration's length in seconds — max child-clip duration. */
  readonly duration: number;
  /** Total iterations: `1` plays once, `Infinity` loops forever. */
  readonly iterations: number;
  /** `duration × loop`, or `0` for a zero-length clip. */
  readonly totalDuration: number;
  /**
   * The track this state uses for each channel index, or `undefined` where the
   * state does not animate that channel. For a blend tree this is the first
   * point's tracks (introspection only); posing reads {@link StateDefinition.blend}.
   */
  readonly tracks: readonly (AnimationTrackLike | undefined)[];
  /** `undefined` for a single-clip state. */
  readonly blend: CompiledBlend | undefined;
  /** The single clip, or the first tree point's clip. */
  readonly clip: AnimationClip;
  /** Prebuilt contribution for a single-clip state (no per-pose allocation). */
  readonly primary: CompiledClip;
}

/** A validated transition, with its destination resolved once. */
interface CompiledTransition {
  /** Source state name, or {@link ANY_STATE}. */
  readonly from: string;
  /** Destination state, resolved at construction. */
  readonly target: StateDefinition;
  /** Predicates, all of which must hold. Never `undefined` after compilation. */
  readonly when: readonly TransitionCondition[];
  /** See {@link AnimationTransition.duration}. */
  readonly duration: number;
  /** See {@link AnimationTransition.exitTime}. */
  readonly exitTime: number;
  /** See {@link AnimationTransition.interruptible}. */
  readonly interruptible: boolean;
  /** See {@link AnimationTransition.allowSelf}. */
  readonly allowSelf: boolean;
}

/**
 * Up to three weighted clip contributions that make one state's pose.
 * Reused every evaluation; `count === 0` means the slot is empty.
 */
interface StateMix {
  count: number;
  clips: [
    CompiledClip | undefined,
    CompiledClip | undefined,
    CompiledClip | undefined,
  ];
  weights: [number, number, number];
}

/**
 * One of the machine's two clocks: which state is playing and how far into it.
 *
 * Two slots exist rather than per-state clocks so that a state can cross-fade
 * with *itself* — the same definition at two clock positions — without either
 * position aliasing the other.
 */
interface StateSlot {
  /** The state playing in this slot; `undefined` in the outgoing slot at rest. */
  definition: StateDefinition | undefined;
  /** Seconds played in this slot, clamped to the state's total duration. */
  elapsed: number;
  /** Exclusive lower bound of the next clip-event range, in elapsed seconds. */
  cursor: number;
}

/** Throws the §89 error used for every malformed controller configuration. */
function invalidController(
  message: string,
  context: Record<string, unknown>,
): never {
  throw new FourError("INVALID_APPLICATION_STATE", message, { context });
}

/** Normalizes the accepted state forms to a clip-or-tree options record. */
function stateOptionsOf(input: AnimationStateInput): AnimationStateOptions {
  if (input instanceof AnimationClip) {
    return { clip: input };
  }
  if (isBlendTree(input)) {
    return { blendTree: input };
  }
  return input;
}

function emptyMix(): StateMix {
  return {
    count: 0,
    clips: [undefined, undefined, undefined],
    weights: [0, 0, 0],
  };
}

function emptySlot(): StateSlot {
  return { definition: undefined, elapsed: 0, cursor: CURSOR_BEFORE_START };
}

function padTracks(
  tracks: (AnimationTrackLike | undefined)[],
  length: number,
): void {
  while (tracks.length < length) {
    tracks.push(undefined);
  }
}

function blendDuration(
  blend: CompiledBlend | undefined,
  fallback: AnimationClip,
): number {
  if (blend === undefined) {
    return fallback.duration;
  }
  let max = 0;
  for (const clip of blend.clips) {
    if (clip.clip.duration > max) {
      max = clip.clip.duration;
    }
  }
  return max;
}

/**
 * Clip-local time for `elapsed` seconds in `definition`, wrapping on the clip's
 * duration.
 *
 * The first iteration is returned unshifted so an infinite duration cannot
 * produce `0 * Infinity === NaN`, and the end of the final iteration of a finite
 * `loop` reads as `duration` rather than as `0` of an iteration that does not
 * exist — the same two rules `AnimationMixer` uses, so a state and a mixer place
 * the same clip identically.
 */
function localTimeOf(definition: StateDefinition, elapsed: number): number {
  const duration = definition.duration;
  if (duration <= 0) {
    return 0;
  }
  const last = definition.iterations - 1;
  let iteration = Math.floor(elapsed / duration);
  if (iteration > last) {
    iteration = last;
  }
  return iteration === 0 ? elapsed : elapsed - iteration * duration;
}

/**
 * §18's declarative animation state machine (§100 "state machines").
 *
 * See the module header for the channel model, the transition semantics, the
 * determinism argument, and what is staged.
 */
export class AnimationController implements Advanceable {
  /** Root object every track path is resolved against. */
  readonly #target: object;

  /** Declared states by name. Looked up only; never iterated (§33). */
  readonly #states = new Map<string, StateDefinition>();

  /** Compiled edges, scanned in declaration order (§33). */
  readonly #transitions: readonly CompiledTransition[];

  /** Declared number parameters. Looked up only. */
  readonly #numbers = new Map<string, number>();

  /** Declared Boolean parameters. Looked up only. */
  readonly #booleans = new Map<string, boolean>();

  /** Declared triggers and whether each latch is raised. Looked up only. */
  readonly #triggers = new Map<string, boolean>();

  /** The union of every state's track paths, in construction order. */
  readonly #channelSpecs: readonly ChannelSpec[];

  /** Path → channel index; looked up only. */
  readonly #channelIndex: ReadonlyMap<string, number>;

  /** Bound channels; empty until {@link AnimationController.play}. */
  #channels: readonly Channel[] = [];

  /** Node declared through {@link AnimationControllerOptions.authority}. */
  readonly #declaredNode: Node | undefined;

  /** Node whose §42 authority gates this controller's transform writes. */
  #authorityNode: Node | undefined;

  /** Whether any channel writes into {@link AnimationController.#authorityNode}. */
  #hasTransformChannels = false;

  /** See {@link AnimationControllerOptions.onStateChange}. */
  readonly #onStateChange: StateChangeListener | undefined;

  /** Clip-event listeners registered through {@link AnimationController.onClipEvent}. */
  readonly #clipListeners: AnimationEventListener[] = [];

  /** See {@link AnimationControllerOptions.liveInterrupt}. */
  readonly #liveInterrupt: boolean;

  /**
   * When true, {@link AnimationController.play} skips §16 claims and
   * {@link AnimationController.advance} evaluates the pose without writing.
   * Set by {@link AnimationLayerStack} before play.
   */
  #parented = false;

  /** The active state — the destination while a transition runs. */
  readonly #current: StateSlot = emptySlot();

  /** The state fading out; `definition` is `undefined` at rest and when frozen. */
  readonly #outgoing: StateSlot = emptySlot();

  /** Previous source kept live during a single-depth `liveInterrupt`. */
  readonly #liveSource: StateSlot = emptySlot();

  /** Whether the fading source is {@link Channel.frozen} rather than a clip. */
  #frozenSource = false;

  /** Whether {@link AnimationController.#liveSource} is contributing. */
  #liveActive = false;

  /** Frozen A–B weight at the moment a live interrupt armed. */
  #liveMidWeight = 0;

  readonly #currentMix: StateMix = emptyMix();
  readonly #outgoingMix: StateMix = emptyMix();
  readonly #liveMix: StateMix = emptyMix();

  /** Reused 2D ranking buffer; sized at construction to the largest tree. */
  readonly #rankScratch: Blend2DRank[] = [];
  readonly #rankIndices: number[] = [0, 0, 0];
  readonly #rankWeights: number[] = [0, 0, 0];

  /** Length of the running cross-fade in seconds; `0` when none runs. */
  #transitionDuration = 0;

  /** Seconds into the running cross-fade. */
  #transitionTime = 0;

  /** See {@link AnimationTransition.interruptible}, for the running transition. */
  #interruptible = true;

  /** Multiplier applied to every advance delta. */
  #speed = 1;

  /** See {@link ControllerPlaybackState}. */
  #state: ControllerPlaybackState = "idle";

  /** Destination weight of the pose being written, in `[0, 1]`. */
  #weight = 1;

  /** Hoisted clip-event visitor — one closure, reused every advance. */
  readonly #visitClipEvent: AnimationEventListener = (event, index) => {
    const listeners = this.#clipListeners;
    for (let listener = 0; listener < listeners.length; listener += 1) {
      listeners[listener](event, index);
    }
  };

  /** Clip-local time of {@link AnimationController.#current}, per pose. */
  #currentLocal = 0;

  /** Clip-local time of {@link AnimationController.#outgoing}, per pose. */
  #outgoingLocal = 0;

  /**
   * @throws FourError `INVALID_APPLICATION_STATE` — `states` is empty; a state
   * option is out of range; a transition names an undeclared state; a condition
   * names an undeclared parameter or tests it with the wrong kind of predicate;
   * a parameter name is declared in two kinds; or two states put tracks of
   * different value kinds on one path.
   */
  constructor(options: AnimationControllerOptions) {
    this.#target = options.target;
    this.#declaredNode = options.authority;
    this.#onStateChange = options.onStateChange;
    this.#liveInterrupt = options.liveInterrupt ?? false;
    if (options.speed !== undefined) {
      this.speed(options.speed);
    }

    this.#declareParameters(options.parameters);
    const channelSpecs: ChannelSpec[] = [];
    const channelIndex = new Map<string, number>();
    const trackLists = this.#declareStates(
      options.states,
      channelSpecs,
      channelIndex,
    );
    // Every clip's track list is padded to the final channel count so that an
    // indexed walk over channels reads a real `undefined` rather than running
    // off the end of an array a later state extended.
    for (const tracks of trackLists) {
      padTracks(tracks, channelSpecs.length);
    }
    for (const definition of this.#states.values()) {
      if (definition.blend === undefined) {
        continue;
      }
      for (const clip of definition.blend.clips) {
        padTracks(
          clip.tracks as (AnimationTrackLike | undefined)[],
          channelSpecs.length,
        );
      }
    }
    this.#channelSpecs = channelSpecs;
    this.#channelIndex = channelIndex;
    this.#transitions = this.#compileTransitions(options.transitions ?? []);

    const initialName = options.initialState ?? Object.keys(options.states)[0];
    const initial = this.#states.get(initialName);
    if (initial === undefined) {
      invalidController(
        `AnimationController initialState "${initialName}" is not one of the declared states (§18).`,
        { initialState: initialName },
      );
    }
    this.#current.definition = initial;
  }

  // --- introspection ------------------------------------------------------

  /** The object every track path is resolved against. */
  get target(): object {
    return this.#target;
  }

  /** Current playback state. */
  get state(): ControllerPlaybackState {
    return this.#state;
  }

  /**
   * Always `false` — a state machine has no end (see
   * {@link ControllerPlaybackState}). Present because `AnimationSystem` advances
   * anything that satisfies `Advanceable`.
   */
  get finished(): boolean {
    return false;
  }

  /**
   * The active state's name — the **destination** while a transition runs, so
   * conditions leaving it are what the machine evaluates next.
   */
  get currentState(): string {
    return (this.#current.definition as StateDefinition).name;
  }

  /**
   * The name of the state fading out, or `undefined` when no transition runs
   * *or* when the running one was interrupted (its source is then a frozen
   * pose, not a state).
   */
  get previousState(): string | undefined {
    return this.#outgoing.definition?.name;
  }

  /** Whether a cross-fade is currently running. */
  get transitioning(): boolean {
    return this.#transitionDuration > 0;
  }

  /**
   * The destination state's blend weight, in `[0, 1]`. `1` whenever no
   * transition is running, because the destination then owns the whole pose.
   */
  get transitionWeight(): number {
    return this.#transitionDuration > 0
      ? Math.min(1, this.#transitionTime / this.#transitionDuration)
      : 1;
  }

  /** Seconds the active state has played, clamped to its total duration. */
  get stateTime(): number {
    return this.#current.elapsed;
  }

  /** Clip-local seconds of the active state, wrapped on its clip duration (§9). */
  get stateLocalTime(): number {
    return localTimeOf(
      this.#current.definition as StateDefinition,
      this.#current.elapsed,
    );
  }

  /** The {@link AnimationController.speed} multiplier. */
  get playbackSpeed(): number {
    return this.#speed;
  }

  /**
   * Number of animated channels (the union of every state's tracks). Valid
   * before play — the specs are known at construction.
   */
  get channelCount(): number {
    return this.#channelSpecs.length;
  }

  /** Authored path of channel `index`. */
  channelPath(index: number): string {
    return this.#channelSpecs[index].path;
  }

  /** Value adapter of channel `index`. */
  channelAdapter(index: number): ValueAdapter<unknown> {
    return this.#channelSpecs[index].adapter;
  }

  /**
   * Index of the channel on `path`, or `-1` when this controller does not
   * animate it. Used by {@link AnimationLayerStack}.
   */
  channelIndexOf(path: string): number {
    const index = this.#channelIndex.get(path);
    return index === undefined ? -1 : index;
  }

  /**
   * Last evaluated pose of channel `index`. Valid after
   * {@link AnimationController.play} / {@link AnimationController.advance}.
   */
  evaluatedChannel(index: number): unknown {
    return this.#channels[index].evaluated;
  }

  /**
   * Registers a clip-event listener (§16 `(from, to]` crossing). Returns an
   * unsubscriber. Events fire while a state or a contributing blend-tree child
   * plays forward; {@link AnimationController.advance} with `{ seek: true }`
   * suppresses them.
   */
  onClipEvent(handler: AnimationEventListener): () => void {
    this.#clipListeners.push(handler);
    return () => {
      const index = this.#clipListeners.indexOf(handler);
      if (index >= 0) {
        this.#clipListeners.splice(index, 1);
      }
    };
  }

  /**
   * Detaches this controller from the §16 claim registry and from writing
   * properties. {@link AnimationLayerStack} calls this before
   * {@link AnimationController.play} so the stack is the sole writer.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — already played.
   */
  adoptByStack(): this {
    if (this.#state !== "idle") {
      invalidController(
        "AnimationController.adoptByStack() must be called before play(); a running machine has already claimed its channels.",
        { state: this.#state },
      );
    }
    this.#parented = true;
    return this;
  }

  // --- parameters (§18) ---------------------------------------------------

  /**
   * Sets a declared number parameter.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — the name is not a declared
   * number parameter, or the value is not finite.
   */
  setNumber(name: string, value: number): this {
    if (!this.#numbers.has(name)) {
      invalidController(
        `AnimationController has no number parameter "${name}" (§18: parameters are declared up front).`,
        { parameter: name },
      );
    }
    if (!Number.isFinite(value)) {
      invalidController(
        `AnimationController number parameter "${name}" must be finite; received ${String(value)}.`,
        { parameter: name, value },
      );
    }
    this.#numbers.set(name, value);
    return this;
  }

  /**
   * Reads a declared number parameter.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — undeclared name.
   */
  getNumber(name: string): number {
    const value = this.#numbers.get(name);
    if (value === undefined) {
      invalidController(
        `AnimationController has no number parameter "${name}".`,
        { parameter: name },
      );
    }
    return value;
  }

  /**
   * Sets a declared Boolean parameter.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — undeclared name.
   */
  setBoolean(name: string, value: boolean): this {
    if (!this.#booleans.has(name)) {
      invalidController(
        `AnimationController has no Boolean parameter "${name}" (§18: parameters are declared up front).`,
        { parameter: name },
      );
    }
    this.#booleans.set(name, value);
    return this;
  }

  /**
   * Reads a declared Boolean parameter.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — undeclared name.
   */
  getBoolean(name: string): boolean {
    const value = this.#booleans.get(name);
    if (value === undefined) {
      invalidController(
        `AnimationController has no Boolean parameter "${name}".`,
        { parameter: name },
      );
    }
    return value;
  }

  /**
   * Raises a declared trigger's latch. It stays raised until a transition that
   * tests it fires, or {@link AnimationController.resetTrigger} clears it.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — undeclared name.
   */
  setTrigger(name: string): this {
    this.#requireTrigger(name);
    this.#triggers.set(name, true);
    return this;
  }

  /**
   * Lowers a declared trigger's latch without any transition consuming it.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — undeclared name.
   */
  resetTrigger(name: string): this {
    this.#requireTrigger(name);
    this.#triggers.set(name, false);
    return this;
  }

  /**
   * Whether a declared trigger's latch is currently raised.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — undeclared name.
   */
  isTriggerSet(name: string): boolean {
    this.#requireTrigger(name);
    return this.#triggers.get(name) as boolean;
  }

  // --- playback -----------------------------------------------------------

  /**
   * Resolves one binding per channel, claims the properties (§16), captures the
   * baselines, and writes the initial state's pose at state time 0.
   *
   * A no-op on a controller that is not `"idle"` — §16 resolves bindings once,
   * and re-resolving them would silently redirect a running machine.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — a channel path resolves to
   * a property whose type its tracks' adapter cannot write.
   * @throws FourError from `createBinding` — a channel path does not resolve.
   */
  play(): this {
    if (this.#state !== "idle") {
      return this;
    }
    const node =
      this.#declaredNode ??
      (this.#target instanceof Node ? this.#target : undefined);

    const channels: Channel[] = [];
    let hasTransformChannels = false;
    for (const spec of this.#channelSpecs) {
      const adapter = spec.adapter;
      const binding = createBinding(this.#target, spec.path, adapter);
      this.#assertBindable(spec, binding);
      const isTransform =
        node !== undefined && isTransformOwner(node, binding.owner);
      hasTransformChannels = hasTransformChannels || isTransform;
      const current = binding.get();
      channels.push({
        path: spec.path,
        binding,
        adapter,
        // Scratch, never a keyframe value: sampling writes into these, so
        // aliasing a key would corrupt the clip.
        fromScratch: adapter.clone(current),
        toScratch: adapter.clone(current),
        liveScratch: adapter.clone(current),
        midScratch: adapter.clone(current),
        treeScratch: [
          adapter.clone(current),
          adapter.clone(current),
          adapter.clone(current),
        ] as [unknown, unknown, unknown],
        blendScratch: adapter.clone(current),
        baseline: adapter.clone(current),
        frozen: adapter.clone(current),
        evaluated: adapter.clone(current),
        isTransform,
        notifyChange: !adapter.mutatesInPlace,
        claim: { writerKind: CONTROLLER_WRITER_KIND, held: false },
      });
    }

    this.#channels = channels;
    this.#hasTransformChannels = hasTransformChannels;
    this.#authorityNode = hasTransformChannels ? node : undefined;
    if (!this.#parented) {
      for (const channel of channels) {
        claimProperty(
          channel.binding.owner,
          channel.binding.key,
          channel.path,
          channel.claim,
        );
      }
    }

    this.#current.elapsed = 0;
    this.#current.cursor = CURSOR_BEFORE_START;
    this.#outgoing.definition = undefined;
    this.#outgoing.elapsed = 0;
    this.#outgoing.cursor = CURSOR_BEFORE_START;
    this.#liveSource.definition = undefined;
    this.#liveSource.elapsed = 0;
    this.#liveSource.cursor = CURSOR_BEFORE_START;
    this.#frozenSource = false;
    this.#liveActive = false;
    this.#transitionDuration = 0;
    this.#transitionTime = 0;
    this.#state = "running";
    this.#writePose();
    return this;
  }

  /** Suspends advancing. A no-op unless the controller is `"running"`. */
  pause(): this {
    if (this.#state === "running") {
      this.#state = "paused";
    }
    return this;
  }

  /** Resumes advancing. A no-op unless the controller is `"paused"`. */
  resume(): this {
    if (this.#state === "paused") {
      this.#state = "running";
    }
    return this;
  }

  /**
   * Stops the machine and releases every §16 property claim, leaving all
   * animated values exactly where the last write put them.
   *
   * A stopped controller never writes again and the properties it held are free
   * for another writer to claim without a conflict warning. A no-op on an
   * `"idle"` controller, which holds nothing.
   */
  stop(): this {
    if (this.#state === "idle") {
      return this;
    }
    for (const channel of this.#channels) {
      releaseProperty(
        channel.binding.owner,
        channel.binding.key,
        channel.claim,
      );
      channel.claim.held = false;
    }
    this.#state = "stopped";
    return this;
  }

  /**
   * Sets the machine-wide speed multiplier, which scales the state clocks *and*
   * the transition clock. Must be finite and `> 0`.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — not finite and `> 0`.
   */
  speed(multiplier: number): this {
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      invalidController(
        `AnimationController speed must be a finite multiplier > 0; received ${String(multiplier)}.`,
        { multiplier },
      );
    }
    this.#speed = multiplier;
    return this;
  }

  /**
   * Advances the machine by one step: move the clocks, finish a cross-fade that
   * has run its length, evaluate the transitions leaving the active state, then
   * write the pose.
   *
   * That order is what makes exit time and automatic sequencing work — a
   * transition gated on `exitTime` fires on the step whose *advanced* clock
   * reaches it — and it means a transition firing this step poses at weight 0,
   * i.e. exactly the pose the previous step wrote.
   *
   * A no-op unless the controller is `"running"`; a controller never advances
   * itself and never reads a clock (§33). Called by `AnimationSystem` with the
   * fixed delta.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` — the delta is negative or
   * non-finite.
   */
  advance(deltaSeconds: number, options?: ControllerAdvanceOptions): this {
    requireNonNegativeSeconds(
      deltaSeconds,
      "AnimationController advance delta",
    );
    if (this.#state !== "running") {
      return this;
    }
    const step = deltaSeconds * this.#speed;
    this.#advanceSlot(this.#current, step);
    this.#advanceSlot(this.#outgoing, step);
    this.#advanceSlot(this.#liveSource, step);
    const completing =
      this.#transitionDuration > 0 &&
      this.#transitionTime + step >= this.#transitionDuration;
    if (this.#transitionDuration > 0) {
      this.#transitionTime += step;
    }
    this.#dispatchClipEvents(options?.seek === true);
    if (completing) {
      this.#completeTransition();
    }
    this.#evaluateTransitions();
    this.#writePose();
    return this;
  }

  // --- construction internals ---------------------------------------------

  /** Records the declared parameters, rejecting a name used in two kinds. */
  #declareParameters(
    parameters: AnimationControllerParameters | undefined,
  ): void {
    if (parameters === undefined) {
      return;
    }
    const numbers = parameters.numbers ?? {};
    for (const name of Object.keys(numbers)) {
      this.#declareParameterName(name);
      this.#numbers.set(name, numbers[name]);
    }
    const booleans = parameters.booleans ?? {};
    for (const name of Object.keys(booleans)) {
      this.#declareParameterName(name);
      this.#booleans.set(name, booleans[name]);
    }
    for (const name of parameters.triggers ?? []) {
      this.#declareParameterName(name);
      this.#triggers.set(name, false);
    }
  }

  /** Rejects a parameter name that is already declared in any kind. */
  #declareParameterName(name: string): void {
    if (
      this.#numbers.has(name) ||
      this.#booleans.has(name) ||
      this.#triggers.has(name)
    ) {
      invalidController(
        `AnimationController parameter "${name}" is declared more than once; a name belongs to exactly one kind (number, Boolean, or trigger).`,
        { parameter: name },
      );
    }
  }

  /**
   * Validates every state, assigns channel indices in declaration order, and
   * returns the per-state track lists (still unpadded — the caller pads them
   * once the final channel count is known).
   */
  #declareStates(
    states: Readonly<Record<string, AnimationStateInput>>,
    channelSpecs: ChannelSpec[],
    channelIndex: Map<string, number>,
  ): (AnimationTrackLike | undefined)[][] {
    const names = Object.keys(states);
    if (names.length === 0) {
      invalidController(
        "AnimationController needs at least one state (§18: states are what a machine is made of).",
        {},
      );
    }
    const trackLists: (AnimationTrackLike | undefined)[][] = [];
    for (const name of names) {
      if (name === ANY_STATE) {
        invalidController(
          `AnimationController state name "${ANY_STATE}" is reserved for any-state transitions.`,
          { state: name },
        );
      }
      const options = stateOptionsOf(states[name]);
      const speed = options.speed ?? 1;
      if (!Number.isFinite(speed) || speed <= 0) {
        invalidController(
          `AnimationController state "${name}" speed must be a finite multiplier > 0; received ${String(speed)}.`,
          { state: name, speed },
        );
      }
      const loop = options.loop ?? Infinity;
      if (loop !== Infinity && (!Number.isInteger(loop) || loop < 1)) {
        invalidController(
          `AnimationController state "${name}" loop must be an integer >= 1 or Infinity (it counts total iterations); received ${String(loop)}.`,
          { state: name, loop },
        );
      }
      if (options.clip !== undefined && options.blendTree !== undefined) {
        invalidController(
          `AnimationController state "${name}" cannot declare both a clip and a blendTree.`,
          { state: name },
        );
      }
      if (options.clip === undefined && options.blendTree === undefined) {
        invalidController(
          `AnimationController state "${name}" needs a clip or a blendTree.`,
          { state: name },
        );
      }

      let blend: CompiledBlend | undefined;
      let primary: CompiledClip;
      if (options.blendTree !== undefined) {
        blend = this.#compileBlend(
          name,
          options.blendTree,
          channelSpecs,
          channelIndex,
        );
        primary = blend.clips[0];
      } else {
        const tracks = this.#ingestClip(
          name,
          options.clip as AnimationClip,
          channelSpecs,
          channelIndex,
        );
        primary = { clip: options.clip as AnimationClip, tracks };
      }

      const duration = blendDuration(blend, primary.clip);
      this.#states.set(name, {
        name,
        clip: primary.clip,
        speed,
        duration,
        iterations: loop,
        totalDuration: duration <= 0 ? 0 : duration * loop,
        tracks: primary.tracks,
        blend,
        primary,
      });
      trackLists.push(primary.tracks as (AnimationTrackLike | undefined)[]);
    }
    return trackLists;
  }

  /** Registers one clip's tracks against the shared channel list. */
  #ingestClip(
    state: string,
    clip: AnimationClip,
    channelSpecs: ChannelSpec[],
    channelIndex: Map<string, number>,
  ): (AnimationTrackLike | undefined)[] {
    const tracks: (AnimationTrackLike | undefined)[] = [];
    for (const track of clip.tracks) {
      let index = channelIndex.get(track.path);
      if (index === undefined) {
        index = channelSpecs.length;
        channelIndex.set(track.path, index);
        channelSpecs.push({ path: track.path, adapter: track.adapter });
      } else if (channelSpecs[index].adapter.kind !== track.adapter.kind) {
        invalidController(
          `AnimationController state "${state}" animates "${track.path}" with a ${track.adapter.kind} track, but another state animates it with a ${channelSpecs[index].adapter.kind} track. Blending needs one value kind per property.`,
          {
            state,
            path: track.path,
            expected: channelSpecs[index].adapter.kind,
            received: track.adapter.kind,
          },
        );
      }
      while (tracks.length <= index) {
        tracks.push(undefined);
      }
      // Later wins within one clip, matching `AnimationClip.sampleAll`, which
      // applies tracks in order and lets the last write stand.
      tracks[index] = track;
    }
    return tracks;
  }

  /** Validates a blend tree and compiles its clips in declaration order. */
  #compileBlend(
    state: string,
    tree: BlendTree,
    channelSpecs: ChannelSpec[],
    channelIndex: Map<string, number>,
  ): CompiledBlend {
    if (tree.kind === "blend1d") {
      if (!this.#numbers.has(tree.parameter)) {
        invalidController(
          `AnimationController state "${state}" blend1d parameter "${tree.parameter}" is not a declared number parameter.`,
          { state, parameter: tree.parameter },
        );
      }
      if (tree.points.length === 0) {
        invalidController(
          `AnimationController state "${state}" blend1d needs at least one point.`,
          { state },
        );
      }
      const indexed = tree.points.map((point, order) => {
        if (!Number.isFinite(point.value)) {
          invalidController(
            `AnimationController state "${state}" blend1d point ${String(order)} value must be finite.`,
            { state, order, value: point.value },
          );
        }
        return {
          value: point.value,
          order,
          clip: this.#ingestClip(state, point.clip, channelSpecs, channelIndex),
          source: point.clip,
        };
      });
      indexed.sort((a, b) => a.value - b.value || a.order - b.order);
      return {
        kind: "blend1d",
        parameter: tree.parameter,
        values: indexed.map((point) => point.value),
        clips: indexed.map((point) => ({
          clip: point.source,
          tracks: point.clip,
        })),
      };
    }

    if (
      !this.#numbers.has(tree.parameterX) ||
      !this.#numbers.has(tree.parameterY)
    ) {
      invalidController(
        `AnimationController state "${state}" blend2d parameters "${tree.parameterX}" / "${tree.parameterY}" must both be declared number parameters.`,
        { state, parameterX: tree.parameterX, parameterY: tree.parameterY },
      );
    }
    if (tree.points.length === 0) {
      invalidController(
        `AnimationController state "${state}" blend2d needs at least one point.`,
        { state },
      );
    }
    const clips: CompiledClip[] = [];
    const points: { x: number; y: number }[] = [];
    for (let order = 0; order < tree.points.length; order += 1) {
      const point = tree.points[order];
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        invalidController(
          `AnimationController state "${state}" blend2d point ${String(order)} x/y must be finite.`,
          { state, order, x: point.x, y: point.y },
        );
      }
      points.push({ x: point.x, y: point.y });
      clips.push({
        clip: point.clip,
        tracks: this.#ingestClip(state, point.clip, channelSpecs, channelIndex),
      });
    }
    while (this.#rankScratch.length < points.length) {
      this.#rankScratch.push({ index: 0, distance: 0 });
    }
    return {
      kind: "blend2d",
      parameterX: tree.parameterX,
      parameterY: tree.parameterY,
      points,
      clips,
    };
  }

  /** Validates every transition and resolves its destination once. */
  #compileTransitions(
    transitions: readonly AnimationTransition[],
  ): readonly CompiledTransition[] {
    const compiled: CompiledTransition[] = [];
    for (let index = 0; index < transitions.length; index += 1) {
      const transition = transitions[index];
      if (transition.from !== ANY_STATE && !this.#states.has(transition.from)) {
        invalidController(
          `AnimationController transition ${String(index)} leaves undeclared state "${transition.from}".`,
          { index, from: transition.from },
        );
      }
      const target = this.#states.get(transition.to);
      if (target === undefined) {
        invalidController(
          `AnimationController transition ${String(index)} enters undeclared state "${transition.to}".`,
          { index, to: transition.to },
        );
      }
      const duration = transition.duration ?? 0;
      requireNonNegativeSeconds(
        duration,
        `AnimationController transition ${String(index)} duration`,
      );
      const exitTime = transition.exitTime ?? 0;
      requireNonNegativeSeconds(
        exitTime,
        `AnimationController transition ${String(index)} exit time`,
      );
      const when = this.#compileWhen(transition.when, index);
      compiled.push({
        from: transition.from,
        target,
        when,
        duration,
        exitTime,
        interruptible: transition.interruptible ?? true,
        allowSelf: transition.allowSelf ?? false,
      });
    }
    return compiled;
  }

  /** Compiles string sugar and validates every predicate. */
  #compileWhen(
    when: TransitionWhen | undefined,
    index: number,
  ): readonly TransitionCondition[] {
    if (when === undefined) {
      return [];
    }
    const entries = typeof when === "string" ? [when] : when;
    const compiled: TransitionCondition[] = [];
    const lookup = {
      hasNumber: (name: string): boolean => this.#numbers.has(name),
      hasBoolean: (name: string): boolean => this.#booleans.has(name),
      hasTrigger: (name: string): boolean => this.#triggers.has(name),
    };
    for (const entry of entries) {
      const condition =
        typeof entry === "string"
          ? compileWhenExpression(entry, lookup, { index })
          : entry;
      this.#validateCondition(condition, index);
      compiled.push(condition);
    }
    return compiled;
  }

  /** Rejects a condition naming an undeclared parameter or the wrong kind. */
  #validateCondition(condition: TransitionCondition, index: number): void {
    const name = condition.parameter;
    const kind =
      condition.is === "triggered"
        ? "trigger"
        : condition.is === "true" || condition.is === "false"
          ? "Boolean"
          : "number";
    const declared =
      kind === "trigger"
        ? this.#triggers.has(name)
        : kind === "Boolean"
          ? this.#booleans.has(name)
          : this.#numbers.has(name);
    if (!declared) {
      invalidController(
        `AnimationController transition ${String(index)} tests "${name}" as a ${kind} parameter, which is not declared as one (§18: parameters are declared up front).`,
        { index, parameter: name, kind },
      );
    }
  }

  /** Rejects an undeclared trigger name. */
  #requireTrigger(name: string): void {
    if (!this.#triggers.has(name)) {
      invalidController(
        `AnimationController has no trigger parameter "${name}" (§18: parameters are declared up front).`,
        { parameter: name },
      );
    }
  }

  /**
   * Rejects a channel whose bound property cannot hold its tracks' value type.
   *
   * The same inspection `AnimationMixer` does at play: `createBinding` was given
   * the adapter and accepted the property without looking at it (§16's typed
   * property reference), so this is where a `vector3` channel bound to a number
   * becomes a configuration error instead of a `NaN` three seconds in. Discrete
   * channels bind to anything, because assignment always works.
   */
  #assertBindable(spec: ChannelSpec, binding: PropertyBinding): void {
    if (spec.adapter.kind === "discrete") {
      return;
    }
    const detected = detectAdapter(binding.get());
    if (detected === undefined || detected.kind !== spec.adapter.kind) {
      invalidController(
        `AnimationController has a ${spec.adapter.kind} channel on "${spec.path}", but that property holds ${detected === undefined ? "a value of no known type" : `a ${detected.kind}`}. Fix the path, the track's adapter, or use a discrete track.`,
        {
          path: spec.path,
          expected: spec.adapter.kind,
          received: detected?.kind,
        },
      );
    }
  }

  // --- playback internals -------------------------------------------------

  /** Moves one slot's clock, clamping a finite `loop` at its total duration. */
  #advanceSlot(slot: StateSlot, step: number): void {
    const definition = slot.definition;
    if (definition === undefined) {
      return;
    }
    const elapsed = slot.elapsed + step * definition.speed;
    slot.elapsed =
      elapsed > definition.totalDuration ? definition.totalDuration : elapsed;
  }

  /** Ends the running cross-fade: the destination owns the whole pose. */
  #completeTransition(): void {
    this.#transitionDuration = 0;
    this.#transitionTime = 0;
    this.#outgoing.definition = undefined;
    this.#outgoing.elapsed = 0;
    this.#outgoing.cursor = CURSOR_BEFORE_START;
    this.#frozenSource = false;
    this.#liveActive = false;
    this.#liveSource.definition = undefined;
    this.#liveSource.elapsed = 0;
    this.#liveSource.cursor = CURSOR_BEFORE_START;
  }

  /**
   * Scans the transitions leaving the active state in declaration order and
   * fires the first eligible one (§33: insertion order only).
   *
   * A running cross-fade that declared `interruptible: false` suppresses the
   * scan entirely until it completes.
   */
  #evaluateTransitions(): void {
    if (this.#transitionDuration > 0 && !this.#interruptible) {
      return;
    }
    const from = (this.#current.definition as StateDefinition).name;
    const elapsed = this.#current.elapsed;
    for (const transition of this.#transitions) {
      if (
        elapsed < transition.exitTime ||
        !this.#matchesFrom(transition, from)
      ) {
        continue;
      }
      if (!this.#conditionsHold(transition.when)) {
        continue;
      }
      this.#fire(transition, from);
      return;
    }
  }

  /**
   * Named edges match exactly; `from: "*"` matches every state except a
   * self-transition, unless `allowSelf` is set.
   */
  #matchesFrom(transition: CompiledTransition, from: string): boolean {
    if (transition.from === from) {
      return true;
    }
    if (transition.from !== ANY_STATE) {
      return false;
    }
    return transition.target.name !== from || transition.allowSelf;
  }

  /** Whether every condition holds right now. An empty list is vacuously true. */
  #conditionsHold(conditions: readonly TransitionCondition[]): boolean {
    for (const condition of conditions) {
      switch (condition.is) {
        case "true":
          if (this.#booleans.get(condition.parameter) !== true) {
            return false;
          }
          break;
        case "false":
          if (this.#booleans.get(condition.parameter) !== false) {
            return false;
          }
          break;
        case "triggered":
          if (this.#triggers.get(condition.parameter) !== true) {
            return false;
          }
          break;
        default:
          if (
            !compareNumeric(
              this.#numbers.get(condition.parameter) as number,
              condition.is,
              condition.value,
            )
          ) {
            return false;
          }
          break;
      }
    }
    return true;
  }

  /**
   * Switches to `transition.target`, arming the cross-fade and consuming the
   * triggers the transition tested.
   *
   * Three shapes of source, in the order the branches read: a zero-duration
   * transition has none (the pose switches outright); a transition fired while
   * nothing was fading takes the state it left as its source; and a transition
   * that *interrupts* a running fade captures the blended pose it interrupted
   * and fades from that frozen pose instead (see the module header).
   */
  #fire(transition: CompiledTransition, from: string): void {
    for (const condition of transition.when) {
      if (condition.is === "triggered") {
        this.#triggers.set(condition.parameter, false);
      }
    }
    if (transition.duration <= 0) {
      this.#completeTransition();
    } else if (this.#transitionDuration > 0) {
      const canLive =
        this.#liveInterrupt && !this.#liveActive && !this.#frozenSource;
      if (canLive) {
        this.#liveSource.definition = this.#outgoing.definition;
        this.#liveSource.elapsed = this.#outgoing.elapsed;
        this.#liveSource.cursor = this.#outgoing.cursor;
        this.#liveMidWeight =
          this.#transitionDuration > 0
            ? Math.min(1, this.#transitionTime / this.#transitionDuration)
            : 1;
        this.#liveActive = true;
        this.#frozenSource = false;
        this.#outgoing.definition = this.#current.definition;
        this.#outgoing.elapsed = this.#current.elapsed;
        this.#outgoing.cursor = this.#current.cursor;
        this.#transitionTime = 0;
        this.#transitionDuration = transition.duration;
      } else {
        this.#capturePose();
        this.#frozenSource = true;
        this.#liveActive = false;
        this.#outgoing.definition = undefined;
        this.#liveSource.definition = undefined;
        this.#transitionTime = 0;
        this.#transitionDuration = transition.duration;
      }
    } else {
      this.#frozenSource = false;
      this.#liveActive = false;
      this.#outgoing.definition = this.#current.definition;
      this.#outgoing.elapsed = this.#current.elapsed;
      this.#outgoing.cursor = this.#current.cursor;
      this.#transitionTime = 0;
      this.#transitionDuration = transition.duration;
    }
    this.#interruptible = transition.interruptible;
    this.#current.definition = transition.target;
    this.#current.elapsed = 0;
    this.#current.cursor = CURSOR_BEFORE_START;
    this.#onStateChange?.(transition.target.name, from);
  }

  /**
   * Recomputes the per-pose constants — the two clip-local times and the
   * destination weight — that {@link AnimationController.#blend} reads.
   */
  #prepareBlend(): void {
    const current = this.#current.definition as StateDefinition;
    this.#currentLocal = localTimeOf(current, this.#current.elapsed);
    this.#weight =
      this.#transitionDuration > 0
        ? Math.min(1, this.#transitionTime / this.#transitionDuration)
        : 1;
    const outgoing = this.#outgoing.definition;
    this.#outgoingLocal =
      outgoing === undefined
        ? 0
        : localTimeOf(outgoing, this.#outgoing.elapsed);
    this.#resolveMix(this.#current, this.#currentMix);
    this.#resolveMix(this.#outgoing, this.#outgoingMix);
    this.#resolveMix(this.#liveSource, this.#liveMix);
  }

  /**
   * The value one channel should hold right now: the destination state's sample
   * when nothing is fading, otherwise that mixed with the fading source's.
   *
   * A state with no track for the channel contributes the channel's baseline
   * (see the module header). `out` is the channel's own blend scratch, which
   * never aliases either endpoint, so the adapters' `out !== b` rule holds.
   * Allocates nothing.
   */
  #blend(channel: Channel, index: number): unknown {
    const to = this.#sampleMix(
      this.#currentMix,
      this.#currentLocal,
      channel,
      index,
      channel.toScratch,
    );
    if (this.#transitionDuration <= 0) {
      return to;
    }
    let from: unknown;
    if (this.#frozenSource) {
      from = channel.frozen;
    } else if (this.#liveActive) {
      const liveLocal = localTimeOf(
        this.#liveSource.definition as StateDefinition,
        this.#liveSource.elapsed,
      );
      const a = this.#sampleMix(
        this.#liveMix,
        liveLocal,
        channel,
        index,
        channel.liveScratch,
      );
      const outgoingLocal = this.#outgoingLocal;
      const b = this.#sampleMix(
        this.#outgoingMix,
        outgoingLocal,
        channel,
        index,
        channel.fromScratch,
      );
      from = channel.adapter.lerp(
        a,
        b,
        this.#liveMidWeight,
        channel.midScratch,
      );
    } else {
      from = this.#sampleMix(
        this.#outgoingMix,
        this.#outgoingLocal,
        channel,
        index,
        channel.fromScratch,
      );
    }
    return channel.adapter.lerp(from, to, this.#weight, channel.blendScratch);
  }

  /** Resolves the weighted clips that currently make `slot`'s pose. */
  #resolveMix(slot: StateSlot, mix: StateMix): void {
    const definition = slot.definition;
    if (definition === undefined) {
      mix.count = 0;
      return;
    }
    const blend = definition.blend;
    if (blend === undefined) {
      mix.count = 1;
      mix.clips[0] = definition.primary;
      mix.weights[0] = 1;
      return;
    }
    if (blend.kind === "blend1d") {
      const located = locateBlend1D(
        blend.values,
        this.#numbers.get(blend.parameter) as number,
      );
      if (located.i0 === located.i1) {
        mix.count = 1;
        mix.clips[0] = blend.clips[located.i0];
        mix.weights[0] = 1;
        return;
      }
      mix.count = 2;
      mix.clips[0] = blend.clips[located.i0];
      mix.clips[1] = blend.clips[located.i1];
      mix.weights[0] = 1 - located.t;
      mix.weights[1] = located.t;
      return;
    }
    const count = locateBlend2D(
      blend.points,
      this.#numbers.get(blend.parameterX) as number,
      this.#numbers.get(blend.parameterY) as number,
      this.#rankScratch,
      this.#rankIndices,
      this.#rankWeights,
    );
    mix.count = count;
    for (let index = 0; index < count; index += 1) {
      mix.clips[index] = blend.clips[this.#rankIndices[index]];
      mix.weights[index] = this.#rankWeights[index];
    }
  }

  /**
   * Samples one resolved mix into `out`. Blend-tree children write through
   * `channel.treeScratch` first so `out` never aliases a clip sample.
   */
  #sampleMix(
    mix: StateMix,
    local: number,
    channel: Channel,
    index: number,
    out: unknown,
  ): unknown {
    if (mix.count <= 0) {
      return channel.baseline;
    }
    if (mix.count === 1) {
      const track = (mix.clips[0] as CompiledClip).tracks[index];
      return track === undefined ? channel.baseline : track.sample(local, out);
    }
    const samples = channel.treeScratch;
    for (let entry = 0; entry < mix.count; entry += 1) {
      const track = (mix.clips[entry] as CompiledClip).tracks[index];
      const sampled =
        track === undefined
          ? channel.baseline
          : track.sample(local, samples[entry]);
      // Primitive adapters ignore `out` and return a new number; store it so
      // the weighted walk reads the effective sample.
      samples[entry] = sampled;
    }
    let accWeight = mix.weights[0];
    let acc = samples[0];
    for (let entry = 1; entry < mix.count; entry += 1) {
      accWeight += mix.weights[entry];
      const t = accWeight === 0 ? 0 : mix.weights[entry] / accWeight;
      acc = channel.adapter.lerp(acc, samples[entry], t, out);
    }
    return acc;
  }

  /**
   * Fires clip events for every slot that advanced this step, using mixer's
   * `(from, to]` half-open crossing. `seek` suppresses the visitor but still
   * moves the cursors.
   */
  #dispatchClipEvents(seek: boolean): void {
    this.#resolveMix(this.#current, this.#currentMix);
    this.#resolveMix(this.#outgoing, this.#outgoingMix);
    this.#resolveMix(this.#liveSource, this.#liveMix);
    this.#fireSlotEvents(this.#current, this.#currentMix, seek);
    this.#fireSlotEvents(this.#outgoing, this.#outgoingMix, seek);
    this.#fireSlotEvents(this.#liveSource, this.#liveMix, seek);
  }

  #fireSlotEvents(slot: StateSlot, mix: StateMix, seek: boolean): void {
    const definition = slot.definition;
    if (definition === undefined || mix.count <= 0) {
      return;
    }
    const from = slot.cursor;
    const to = slot.elapsed;
    slot.cursor = to;
    if (seek || this.#clipListeners.length === 0 || !(to > from)) {
      return;
    }
    for (let entry = 0; entry < mix.count; entry += 1) {
      if (mix.weights[entry] <= 0) {
        continue;
      }
      const clip = (mix.clips[entry] as CompiledClip).clip;
      fireClipEvents(
        clip,
        definition.duration,
        definition.iterations,
        from,
        to,
        this.#visitClipEvent,
      );
    }
  }

  /**
   * Writes the current pose through every channel's binding.
   *
   * §42 is enforced with `AnimationMixer`'s semantics: if any channel sits
   * inside the authority node's transform and that node is not owned by
   * `"animation"`, the conflict is reported once (deduplicated per node per
   * writer by `warnAuthorityConflict`) and **every** transform write of this
   * evaluation is skipped — never a partial pose. Non-transform channels are
   * unaffected, and the moment authority is granted the next write lands on the
   * value for the current time, because evaluation never depended on the writes
   * that were refused. Allocates nothing.
   */
  #writePose(): void {
    let allowTransform = true;
    if (!this.#parented && this.#hasTransformChannels) {
      // `#authorityNode` is defined whenever `#hasTransformChannels` is true: a
      // channel can only be a transform channel if a node was resolved.
      const node = this.#authorityNode as Node;
      if (node.transformAuthority !== CONTROLLER_AUTHORITY) {
        warnAuthorityConflict(node, CONTROLLER_AUTHORITY);
        allowTransform = false;
      }
    }
    this.#prepareBlend();
    const writeChannels = (): void => {
      const channels = this.#channels;
      for (let index = 0; index < channels.length; index += 1) {
        const channel = channels[index];
        const value = this.#blend(channel, index);
        channel.evaluated = channel.adapter.copy(value, channel.evaluated);
        if (
          this.#parented ||
          !channel.claim.held ||
          (channel.isTransform && !allowTransform)
        ) {
          continue;
        }
        channel.binding.set(value);
        if (channel.notifyChange) {
          // A primitive write is a direct field write and bypasses plan D3's
          // change hook; re-fire it so `Transform.version` still advances.
          (channel.binding.owner as { onChanged?: () => void }).onChanged?.();
        }
      }
    };
    if (allowTransform) {
      runOwnedTransformWrite(writeChannels);
    } else {
      writeChannels();
    }
  }

  /**
   * Stores the pose an interrupted cross-fade was producing into every
   * channel's frozen slot, so the replacement transition can fade out of it.
   *
   * Runs the same {@link AnimationController.#blend} the write path runs, so the
   * frozen pose is exactly the one the next write would have produced — it just
   * lands in `channel.frozen` instead of the property, and is therefore
   * unaffected by §42 refusing the write.
   */
  #capturePose(): void {
    this.#prepareBlend();
    const channels = this.#channels;
    for (let index = 0; index < channels.length; index += 1) {
      const channel = channels[index];
      const value = this.#blend(channel, index);
      channel.frozen = channel.adapter.copy(value, channel.frozen);
    }
  }
}

/** Evaluates one §18 numeric comparison. */
function compareNumeric(
  parameter: number,
  comparison: NumericComparison,
  value: number,
): boolean {
  switch (comparison) {
    case "greater":
      return parameter > value;
    case "greaterOrEqual":
      return parameter >= value;
    case "less":
      return parameter < value;
    case "lessOrEqual":
      return parameter <= value;
    case "equal":
      return parameter === value;
    default:
      return parameter !== value;
  }
}

/**
 * Fires `clip` events across the elapsed range `(fromElapsed, toElapsed]`,
 * walking loop iterations the way `AnimationMixer` does so markers re-arm
 * on every wrap.
 */
function fireClipEvents(
  clip: AnimationClip,
  duration: number,
  iterations: number,
  fromElapsed: number,
  toElapsed: number,
  visit: AnimationEventListener,
): void {
  if (clip.events.length === 0 || !(toElapsed > fromElapsed)) {
    return;
  }
  if (duration <= 0) {
    clip.eventsInRange(fromElapsed, toElapsed, visit);
    return;
  }
  const lastIteration = iterationAt(toElapsed, duration, iterations);
  const firstIteration =
    fromElapsed <= 0 ? 0 : iterationAt(fromElapsed, duration, iterations);
  for (
    let iteration = firstIteration;
    iteration <= lastIteration;
    iteration += 1
  ) {
    const localTo =
      iteration === lastIteration
        ? localAt(toElapsed, duration, iterations)
        : duration;
    const localFrom =
      iteration === 0 ? fromElapsed : fromElapsed - iteration * duration;
    clip.eventsInRange(localFrom, localTo, visit);
  }
}

function iterationAt(
  elapsed: number,
  duration: number,
  iterations: number,
): number {
  if (duration <= 0) {
    return 0;
  }
  const last = iterations - 1;
  const index = Math.floor(elapsed / duration);
  return index > last ? last : index;
}

function localAt(
  elapsed: number,
  duration: number,
  iterations: number,
): number {
  const iteration = iterationAt(elapsed, duration, iterations);
  return iteration === 0 ? elapsed : elapsed - iteration * duration;
}
