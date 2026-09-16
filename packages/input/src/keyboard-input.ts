/**
 * The keyboard source (§72, 2026-08-07, A-10): platform key events in, scene
 * key events out, routed to whatever holds the focus.
 *
 * **Not the way to read the keyboard.** For "is W held right now" — movement,
 * a flight stick, anything polled per frame — use {@link KeyboardState}, which
 * is the sibling in this package. This class is the event SOURCE that feeds a
 * focused node, exactly as {@link PointerInput} feeds a picked one.
 *
 * ```ts
 * const keyboard = new KeyboardInput(window, {
 *   focusTarget: () => focusedWidget(scene) ?? uiRoot,   // @fourjs/ui answers
 * });
 * button.on("keydown", (event) => { if (event.key === "Enter") activate(); });
 * // …
 * keyboard.dispose();
 * ```
 *
 * The pointer sibling of this class is `PointerInput`, and everything
 * structural about them is deliberately identical: a surface described by the
 * two methods this module actually calls ({@link KeySurface}), a platform event
 * described by the fields it actually reads ({@link SurfaceKeyEvent}), bound
 * listeners stored once so `removeEventListener` gets the same function
 * objects, an idempotent `dispose`, and no DOM lib type named anywhere — so a
 * browser `window`, a `document`, a Playwright-driven page, and a plain object
 * in a unit test are all equally acceptable surfaces.
 *
 * What differs is the one thing that must: **how the target is resolved.** A
 * pointer event has a position, so `PointerInput` picks (§71). A key event does
 * not, so this class asks — once per platform event — the injected
 * {@link KeyboardInputOptions.focusTarget} resolver.
 *
 * ## Why focus is injected rather than owned (decision, A-10)
 *
 * §75's focus lives in `@fourjs/ui`: one focused widget per scene root, with
 * focus/blur events and a disabled/enabled policy this package has no business
 * restating. And plan §3.1 is frozen in the direction that makes that work —
 * `ui` depends on `input`, never the reverse — so `KeyboardInput` **cannot**
 * import `focusedWidget`, and a package-private focus registry here would be a
 * second, competing answer to a question §75 already answers.
 *
 * A one-function seam resolves both problems: the application (or `@fourjs/ui`'s
 * `keyboardFocusTarget` helper) supplies `() => Node | null`, this class calls
 * it per event, and the resolver may return anything — the focused widget, a
 * fallback root so keystrokes still reach a UI tree with nothing focused yet, or
 * `null` for "nobody is listening". It is the same shape as
 * `PointerInputOptions.pickables` for the same reason: a function, so the answer
 * can change without re-creating the input.
 *
 * A resolver returning `null` dispatches nothing at all — the exact analogue of
 * a pointer that hit nothing, and the reason there is no scene-level "the
 * keyboard is idle" event to filter out.
 *
 * ## What it deliberately does not do
 *
 * - It never writes a transform (§42), never touches the scene graph, and holds
 *   no reference to a scene — `PointerInput`'s whole discipline.
 * - It never decides what a key *means*. Tab is not traversal here, Enter is not
 *   activation here: those are §75 policy and live in `@fourjs/ui`. This class
 *   normalizes and routes, which is why it needs no key table at all.
 * - It does not suppress platform defaults on its own. Whoever consumes a key
 *   calls {@link SceneKeyEvent.preventDefault}, which forwards to the platform
 *   event this class hands the scene event — a source that guessed which keys
 *   the application wanted would break the ones it guessed wrong.
 * - It handles `keydown` and `keyup` only; see `key-events.ts` for why
 *   `keypress` is not among them.
 */

import type { Node } from "@fourjs/scene";

import {
  SceneKeyEvent,
  dispatchKeyEvent,
  type KeyDefaultSuppressor,
  type SceneKeyEventType,
} from "./key-events.js";
import { buildPropagationPath } from "./propagation.js";

/**
 * The platform key event this module reads — the seven fields out of the DOM's
 * `KeyboardEvent` that a scene key event is built from, plus the optional
 * `preventDefault` it inherits from {@link KeyDefaultSuppressor}.
 *
 * Structural on purpose, exactly as `SurfacePointerEvent` is: a real
 * `KeyboardEvent` satisfies it, and so does `{ key: "Tab", code: "Tab", altKey:
 * false, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false }`.
 *
 * The modifier fields keep the platform's `…Key` spelling rather than this
 * package's grouped `KeyModifiers` shape, because this is the *input*
 * side of the normalization: the whole point is that the DOM's own event
 * satisfies the interface without a wrapper.
 */
import { DEV, FourError } from "@fourjs/core";

export interface SurfaceKeyEvent extends KeyDefaultSuppressor {
  /** The character or named key produced — `"a"`, `"Enter"`, `" "`. */
  readonly key: string;
  /** The physical key, layout-independent — `"KeyA"`, `"Space"`. */
  readonly code: string;
  /** Whether Alt was held. */
  readonly altKey: boolean;
  /** Whether Control was held. */
  readonly ctrlKey: boolean;
  /** Whether Meta (Command, Windows) was held. */
  readonly metaKey: boolean;
  /** Whether Shift was held. */
  readonly shiftKey: boolean;
  /** Whether the platform's auto-repeat produced this event. */
  readonly repeat: boolean;
}

/** A listener {@link KeySurface} delivers platform key events to. */
export type SurfaceKeyListener = (event: SurfaceKeyEvent) => void;

/**
 * The event source key events arrive on, described by what this module actually
 * touches — the same structural-seam policy `PointerSurface` follows, and
 * for the same reasons.
 *
 * In a browser this is normally `window` or `document` rather than the canvas:
 * an element receives key events only while it holds the DOM's focus, and the
 * canvas of a scene whose focus model is §75's does not want the DOM's. Both
 * satisfy this interface structurally, as does any object with the two methods.
 *
 * There is deliberately no runtime validation of the argument, for the reason
 * `PointerSurface` gives: it is a checked parameter type, and §89 has no error
 * code for "wrong argument".
 */
export interface KeySurface {
  addEventListener(type: string, listener: SurfaceKeyListener): void;
  removeEventListener(type: string, listener: SurfaceKeyListener): void;
}

/** Construction options for {@link KeyboardInput}. */
export interface KeyboardInputOptions {
  /**
   * The node key events are delivered to, called once per platform event.
   *
   * Returning `null` means "nothing is listening", and dispatches nothing. See
   * this module's header for why focus is resolved by an injected function
   * rather than owned here; `@fourjs/ui`'s `keyboardFocusTarget(root)` is the
   * ready-made resolver for a widget tree.
   */
  focusTarget: () => Node | null;
}

export class KeyboardInput {
  readonly #surface: KeySurface;
  readonly #focusTarget: () => Node | null;

  #disposed = false;

  // Bound once so `removeEventListener` gets the same function objects.
  readonly #onKeyDown = (event: SurfaceKeyEvent): void => {
    this.#handle("keydown", event);
  };

  readonly #onKeyUp = (event: SurfaceKeyEvent): void => {
    this.#handle("keyup", event);
  };

  constructor(surface: KeySurface, options: KeyboardInputOptions) {
    /*
     * Validated rather than destructured, because the failure this replaces was
     * unreadable. Calling `new KeyboardInput({ surface: window })` -- one options
     * object, the shape most of four's constructors take -- threw
     * `TypeError: Cannot read properties of undefined (reading 'focusTarget')`: an
     * internal property access naming a private field, with no hint of the real
     * signature. `SpringDamper` answers the same class of mistake by naming both
     * accepted shapes, and that is what makes such a message a one-step correction.
     *
     * The message also says what this class is for, because the *name* is what invites
     * the mistake: in a package called `@fourjs/input`, `KeyboardInput` reads like "the
     * way to read the keyboard", but it routes to a focused scene node and pairs with
     * `@fourjs/ui`'s `keyboardFocusTarget(root)`. Game code reading WASD wants neither.
     *
     * Until 2026-09-07 the honest answer was "listen to the DOM yourself", and this
     * message said so. It is now `KeyboardState`, in this package — which is the real
     * fix for the mistake. A clearer error was never going to repair a missing
     * capability; it could only apologise for one.
     */
    if (
      DEV &&
      (typeof options !== "object" ||
        options === null ||
        typeof options.focusTarget !== "function")
    ) {
      /*
       * The throw is unconditional -- it is behaviour, not a diagnostic. Only the prose
       * is gated, because it is not free: shipped unconditionally it put
       * examples/ui-demo 245 B over its 45 kB §86 budget and turned CI red. Under §85's
       * build mode `DEV` is a literal `false`, so the tree-shaker deletes the long
       * branch and its text (A-4), while a development build -- the default for anyone
       * who has not configured `__FOUR_DEV__`, which is the audience that makes this
       * mistake -- still gets the whole thing.
       */
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        "KeyboardInput takes two arguments: (surface, { focusTarget }). " +
          "`focusTarget` is required and must be a function returning the focused " +
          "Node or null — it is how key events are routed into the scene (§72). " +
          "For a widget tree, pass `keyboardFocusTarget(root)` from the ui package. " +
          "For raw game input (WASD and the like) this class is the wrong tool: " +
          "use `KeyboardState` from this package — `new KeyboardState(window)` then " +
          '`keys.isDown("KeyW")`.',
        { context: { received: typeof options } },
      );
    }
    this.#surface = surface;
    this.#focusTarget = options.focusTarget;

    surface.addEventListener("keydown", this.#onKeyDown);
    surface.addEventListener("keyup", this.#onKeyUp);
  }

  /**
   * Removes the surface listeners. Idempotent (§83: teardown paths must not
   * have to test first).
   *
   * There is no per-key state to clear — unlike a pointer, a key has no
   * gesture: `keydown` and `keyup` are complete in themselves, and the platform
   * owns which keys are held. That is also why this class has no analogue of
   * `PointerInput`'s tracked-pointer map, and so cannot leak one (A-9's whole
   * class of defect is absent by construction).
   *
   * Listeners registered on nodes by the application are not touched, since
   * this object never added them.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#surface.removeEventListener("keydown", this.#onKeyDown);
    this.#surface.removeEventListener("keyup", this.#onKeyUp);
  }

  /**
   * Normalizes one platform event and dispatches it at the current focus
   * target, through §72's three phases.
   *
   * The target is resolved *before* the event is constructed and the path
   * *before* anything is dispatched, so a listener that moves the focus — which
   * is exactly what §75's Tab traversal does — cannot redirect the event it is
   * handling. The next keystroke asks the resolver again and gets the new
   * answer.
   *
   * A disposed input is **inert** (2026-08-07, §83): `dispose` removes the
   * surface listeners, but a surface may still deliver an event that was already
   * queued, and a test double or a synthetic dispatcher may call a retained
   * listener outright. Neither may reach the focus resolver or the scene after
   * the object has said it is done — teardown must not have to trust its
   * surface.
   */
  #handle(type: SceneKeyEventType, event: SurfaceKeyEvent): void {
    if (this.#disposed) {
      return;
    }
    const target = this.#focusTarget();
    if (target === null) {
      return;
    }
    dispatchKeyEvent(
      new SceneKeyEvent({
        type,
        key: event.key,
        code: event.code,
        modifiers: {
          alt: event.altKey,
          ctrl: event.ctrlKey,
          meta: event.metaKey,
          shift: event.shiftKey,
        },
        repeat: event.repeat,
        target,
        platformEvent: event,
      }),
      buildPropagationPath(target),
    );
  }
}
