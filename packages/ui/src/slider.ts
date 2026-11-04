/**
 * `Slider` (§73) — a value dragged along a track (§72) or stepped with the
 * arrow keys (§75), 2026-08-07, A-12.
 *
 * ```ts
 * const gravity = new Slider({
 *   width: 200,
 *   height: 24,
 *   min: -20,
 *   max: 0,
 *   step: 0.5,
 *   value: -9.81,
 *   accessibility: { role: "slider", label: "Gravity" },
 * });
 * gravity.on("uivaluechange", (event) => world.gravity.y = event.current);
 * gravity.skin = trackSkin;              // reads `slider.fraction` to place the handle
 * ```
 *
 * ## What the widget owns, and what it hands the skin
 *
 * The range (`min`, `max`, `step`), the current {@link Slider.value}, and
 * {@link Slider.fraction} — the position in `[0, 1]` a skin draws a fill and a
 * handle from. The track, the handle, the tick marks, and the hit slop around a
 * thin track are the skin's, like every other visual in this package.
 *
 * ## Pointer interaction, and its one honest limit (§72)
 *
 * A press anywhere on the slider jumps the value to the pressed point (the
 * DOM's behaviour, and the one that makes a slider usable at all with a
 * touchscreen), and a move while pressed drags it. The position is read from
 * {@link ScenePointerEvent.worldPoint} — the §71 hit point — and transformed
 * into the slider's own local frame by the inverse of its world matrix, so a
 * slider works rotated, scaled, parented to a moving rig, or laid over a 3D
 * scene, with no assumption that the UI is screen-aligned.
 *
 * **The limit:** a drag that leaves the slider's box stops tracking, because
 * events stop arriving at it. The DOM keeps tracking through pointer capture,
 * and `PointerInput.setPointerCapture` exists — but a captured pointer
 * deliberately reports **no** `worldPoint` (there is no hit to report: the
 * target is the capturing node whatever the ray touches), so capturing would
 * turn a drag into a stream of positionless moves. Closing that needs a drag
 * plane — the ray/plane intersection `DragManager` documents as §71's analytic
 * tier — and is staged rather than faked (2026-08-07, A-12). Until then a
 * pointer drag is bounded by the widget, a keyboard drag is not, and
 * {@link Slider.setValueFromLocalPoint} is public so an application that has
 * its own drag plane can drive the same path this module drives.
 *
 * `DragManager` is not used here for the same reason: it converts screen motion
 * into a **world delta** for a node whose transform the callback writes, and a
 * slider's transform is owned by layout (§42) — what moves is a number, not the
 * widget. Its own documentation is explicit that what a drag *means* is the
 * application's decision; for this control the meaning is "set the value", and
 * that is this class's business.
 *
 * ## Keyboard (§75)
 *
 * Arrow keys step: Right and Up increase, Left and Down decrease — both
 * orientations, which is the DOM's convention and the one muscle memory has.
 * Home and End jump to the bounds. Auto-repeat is honoured, so a held arrow
 * sweeps the range. Everything else, including PageUp/PageDown, is left to
 * propagate: a large-step key is a fourth binding with no §75 mandate, and a
 * slider that swallowed the page keys would break scrolling in a host document
 * for nothing.
 *
 * The step a key takes is {@link Slider.step} when there is one, and **1% of
 * the range** for a continuous slider — a continuous control still has to move
 * by *something* per keystroke, and a percent of the range is the only choice
 * that is right at every scale.
 *
 * ## Orientation
 *
 * A vertical slider increases **upward**: `fraction` is `1` at the top of the
 * box and `0` at the bottom. That is a sign flip against the layer's
 * top-left-origin, y-down box model (see `widget.ts`), and it is deliberate —
 * a volume slider whose maximum is at the bottom would be wrong in every UI
 * ever shipped. The flip lives in one expression, in
 * {@link Slider.setValueFromLocalPoint}.
 */

import type { ScenePointerEvent, SceneKeyEvent } from "@fourjs/input";
import { Matrix4, Vector3 } from "@fourjs/math";
import { resolveWorldTransform } from "@fourjs/scene";

import { fractionOf, requireFinite, resolveValue } from "./numbers.js";
import { Panel, type PanelOptions } from "./panel.js";

/** Which axis a {@link Slider}'s track runs along. */
export type SliderOrientation = "horizontal" | "vertical";

/** Construction options for a {@link Slider}. */
export interface SliderOptions extends PanelOptions {
  /** {@link Slider.min}. Default `0`. */
  min?: number;
  /** {@link Slider.max}. Default `1`. */
  max?: number;
  /** {@link Slider.step}. Default `0` — continuous. */
  step?: number;
  /** {@link Slider.value}. Default the minimum. */
  value?: number;
  /** {@link Slider.orientation}. Default `"horizontal"`. */
  orientation?: SliderOrientation;
}

/**
 * Scratch for the world→local transform of one pointer position.
 *
 * Module-level and reused (plan D7). Safe despite this package's usual
 * re-entrancy caution: both are read into plain numbers before anything is
 * emitted, so no listener can run while either holds live data.
 */
const inverseWorld = new Matrix4();
const localPoint = new Vector3();

/** Fraction of the range one arrow keystroke moves a continuous slider. */
const CONTINUOUS_KEY_STEP = 0.01;

export class Slider extends Panel {
  /** Which axis the track runs along. See the header on vertical sliders. */
  orientation: SliderOrientation = "horizontal";

  #min = 0;
  #max = 1;
  #step = 0;
  #value = 0;

  constructor(options: SliderOptions = {}) {
    super(options);
    // A control takes focus on press unless the application says otherwise —
    // `Button`'s rule, for `Button`'s reason (§75 asks for focus management
    // over controls), reached here without inheriting a click activation a
    // slider does not have.
    if (options.focusable === undefined) this.focusable = true;
    if (options.orientation !== undefined)
      this.orientation = options.orientation;
    if (options.min !== undefined) {
      this.#min = requireFinite("Slider", "min", options.min);
    }
    if (options.max !== undefined) {
      this.#max = requireFinite("Slider", "max", options.max);
    }
    if (this.#max < this.#min) {
      throw new RangeError(
        `Slider: max (${String(this.#max)}) must be >= min ` +
          `(${String(this.#min)}) (§85).`,
      );
    }
    if (options.step !== undefined) {
      const step = requireFinite("Slider", "step", options.step);
      if (step < 0) {
        throw new RangeError(
          `Slider: step must be >= 0 — 0 means continuous; ` +
            `got ${String(step)} (§85).`,
        );
      }
      this.#step = step;
    }
    // Resolved through the same path an assignment takes, so a constructed
    // slider can never hold a value its own setter would refuse.
    this.#value = resolveValue(
      options.value !== undefined
        ? requireFinite("Slider", "value", options.value)
        : this.#min,
      this.#min,
      this.#max,
      this.#step,
    );

    // Target-scoped like every state reaction in this layer (§72 events
    // bubble, and a press on a child is not a press on the track), and gated
    // on `interactive` like `Button`'s click: a pointer that may not reach
    // this widget must not move its value either.
    this.addSubscription(
      this.on("pointerdown", (event) => {
        if (event.target === this && this.#pointerDrivable()) {
          this.#handlePointer(event);
        }
      }),
    );
    this.addSubscription(
      this.on("pointermove", (event) => {
        if (event.target === this && this.pressed && this.#pointerDrivable()) {
          this.#handlePointer(event);
        }
      }),
    );
    this.addSubscription(
      this.on("keydown", (event) => {
        this.#handleKey(event);
      }),
    );
  }

  /** Lower bound of the range. */
  get min(): number {
    return this.#min;
  }

  /**
   * Sets the lower bound and re-resolves the value against it, so a slider is
   * never out of its own range. Emits `uivaluechange` if the value moved.
   *
   * @throws RangeError if not finite, or greater than {@link Slider.max} (§85).
   */
  set min(value: number) {
    requireFinite("Slider", "min", value);
    if (value > this.#max) {
      throw new RangeError(
        `Slider: min (${String(value)}) must be <= max ` +
          `(${String(this.#max)}) (§85).`,
      );
    }
    this.#min = value;
    this.value = this.#value;
  }

  /** Upper bound of the range. */
  get max(): number {
    return this.#max;
  }

  /**
   * Sets the upper bound and re-resolves the value against it.
   *
   * @throws RangeError if not finite, or less than {@link Slider.min} (§85).
   */
  set max(value: number) {
    requireFinite("Slider", "max", value);
    if (value < this.#min) {
      throw new RangeError(
        `Slider: max (${String(value)}) must be >= min ` +
          `(${String(this.#min)}) (§85).`,
      );
    }
    this.#max = value;
    this.value = this.#value;
  }

  /**
   * Quantization of the value, in the range's units; `0` — the default — is
   * continuous.
   *
   * A value is snapped to `min + n · step` and then clamped, so a step that
   * does not divide the range leaves the top of that range unreachable — the
   * grid of `[0, 10]` with `step: 3` is `0, 3, 6, 9`, as it is for
   * `<input type=range>`. See `resolveValue`.
   *
   * @throws RangeError if not finite or negative (§85).
   */
  get step(): number {
    return this.#step;
  }

  set step(value: number) {
    requireFinite("Slider", "step", value);
    if (value < 0) {
      throw new RangeError(
        `Slider: step must be >= 0 — 0 means continuous; ` +
          `got ${String(value)} (§85).`,
      );
    }
    this.#step = value;
    this.value = this.#value;
  }

  /**
   * The current value, always inside `[min, max]` and always on the step grid.
   *
   * Assigning resolves first (clamp into the range, snap onto the grid — see
   * `resolveValue`) and emits `uivaluechange` only if the **resolved** value
   * differs from the current one, so dragging within one step of a stepped
   * slider is silent, which is what makes a step a step.
   *
   * @throws RangeError if not finite (§85). A slider given `NaN` would compare
   * false against everything afterwards, including itself.
   */
  get value(): number {
    return this.#value;
  }

  set value(next: number) {
    requireFinite("Slider", "value", next);
    const resolved = resolveValue(next, this.#min, this.#max, this.#step);
    if (resolved === this.#value) return;
    const previous = this.#value;
    this.#value = resolved;
    this.notifyContentChange();
    this.emit("uivaluechange", {
      widget: this,
      previous,
      current: resolved,
    });
  }

  /**
   * Where the value sits in its range, in `[0, 1]` — what a skin draws from.
   * `0` for an empty range (`max === min`), which has exactly one value.
   */
  get fraction(): number {
    return fractionOf(this.#value, this.#min, this.#max);
  }

  /**
   * Sets the value from a point in **this widget's local space** — the frame
   * whose box spans `x ∈ [0, width]` and `y ∈ [−height, 0]` (see `widget.ts`).
   *
   * Public because it is the seam an application with its own pointer plumbing
   * needs (see the header on the drag limit): convert a position into the
   * slider's frame however you can, call this, and the value resolves and emits
   * exactly as it does for the pointer path this class drives.
   *
   * A zero-extent slider along its own axis is ignored rather than dividing by
   * zero: a track with no length has no position to read.
   */
  setValueFromLocalPoint(x: number, y: number): void {
    const horizontal = this.orientation === "horizontal";
    const extent = horizontal ? this.measuredWidth : this.measuredHeight;
    if (extent <= 0) return;
    // The vertical flip — the only place this control disagrees with the
    // layer's y-down box model. See the header.
    const fraction = horizontal ? x / extent : 1 + y / extent;
    this.value = this.#min + fraction * (this.#max - this.#min);
  }

  /** Whether a pointer may move this slider's value right now (§72, §75). */
  #pointerDrivable(): boolean {
    return this.interactive && !this.disabled && this.enabled;
  }

  /** Reads a §72 pointer position into the value, when the event carries one. */
  #handlePointer(event: ScenePointerEvent): void {
    const point = event.worldPoint;
    // Absent while a pointer is captured, and on any source that reports no
    // hit point — see the header. Ignored rather than guessed.
    if (point === undefined) return;
    const world = resolveWorldTransform(this);
    if (world.determinant() === 0) return;
    inverseWorld.copy(world).invert();
    localPoint.copy(point).applyMatrix4(inverseWorld);
    this.setValueFromLocalPoint(localPoint.x, localPoint.y);
  }

  /** §75's arrow, Home, and End bindings. */
  #handleKey(event: SceneKeyEvent): void {
    if (event.target !== this || this.disabled || !this.enabled) return;
    const modifiers = event.modifiers;
    if (modifiers.alt || modifiers.ctrl || modifiers.meta || modifiers.shift) {
      return;
    }

    const key = event.key;
    let next = this.#value;
    if (key === "ArrowRight" || key === "ArrowUp") {
      next = this.#value + this.#keyStep();
    } else if (key === "ArrowLeft" || key === "ArrowDown") {
      next = this.#value - this.#keyStep();
    } else if (key === "Home") {
      next = this.#min;
    } else if (key === "End") {
      next = this.#max;
    } else {
      return;
    }

    this.value = next;
    // The keystroke was ours whether or not it moved anything: an arrow at the
    // end of the range must not also scroll the host, or holding it would
    // scroll the page the moment the slider bottomed out.
    event.preventDefault();
  }

  /** How far one keystroke moves the value — see the header. */
  #keyStep(): number {
    return this.#step > 0
      ? this.#step
      : (this.#max - this.#min) * CONTINUOUS_KEY_STEP;
  }
}
