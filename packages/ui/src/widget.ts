/**
 * `UIWidget` (§73–§75) — the retained-mode UI layer's base class: a scene node
 * with a box model, an interaction state machine driven by §72 pointer events,
 * and a hit area the §71 picker can test.
 *
 * ```ts
 * const panel = new Panel({ layout: { type: "flex", direction: "column", gap: 12, padding: 20 } });
 * const start = new Button({ width: 160, height: 40, accessibility: { role: "button", label: "Start" } });
 * panel.add(start);
 * panel.layout();                                   // one explicit pass
 * start.on("uiactivate", () => simulation.start()); // §72 click → activation
 * ```
 *
 * ## The visuals contract — the decision this package is built around
 *
 * §73 says "UI objects are scene nodes and therefore share animation, input,
 * clipping, serialization, and diagnostics", and that is exactly what a widget
 * is here: a {@link Node}. What a widget is **not** is a thing that draws
 * itself, and that is not a stylistic choice — the frozen dependency matrix
 * (plan §3.1) gives `@fourjs/ui` exactly `core`, `math`, `scene`, `input`, and
 * `text`. `Renderable`, `Sprite`, `Texture`, every material, and every geometry
 * live in packages this one may not import, and the plan's ground rule 9 is
 * "never add or reverse an edge". A widget therefore **cannot** own a quad, a
 * texture, or a material, and pretending otherwise would mean either an illegal
 * import or a fake.
 *
 * So the layer splits along the line the matrix draws:
 *
 * | this package owns                             | the application owns          |
 * | --------------------------------------------- | ----------------------------- |
 * | hierarchy, box model, layout (§74 subset)      | backgrounds, borders, glyph quads |
 * | hit areas (§71 candidates)                     | textures, materials, batching |
 * | hover / press / focus state machines (§72)     | what those states *look* like |
 * | text **measurement** (`@fourjs/text`, a real dep) | text **rendering**            |
 *
 * The seam is {@link WidgetSkin}: an application-supplied object with five
 * optional hooks that the widget calls when something visible about it changed.
 * The app's skin holds the imports `@fourjs/ui` may not have, reads
 * {@link UIWidget.measuredWidth}, {@link UIWidget.measuredHeight},
 * {@link UIWidget.hovered} and friends, and builds or updates its own nodes —
 * typically as children of the widget, so the whole thing still moves as one
 * subtree. Nothing in this package ever learns what a skin drew.
 *
 * This mirrors the precedents already in the tree rather than inventing a
 * mechanism: `@fourjs/text` "produces data, never nodes" for the same matrix
 * reason, `@fourjs/particles`' `ParticleRenderable` implements a structural
 * contract it cannot import, and `@fourjs/input` describes its surface
 * (`PointerSurface`) by what it touches instead of naming a DOM type. The
 * difference here is the direction of the call — a skin is supplied *to* the
 * widget rather than implemented *by* it — because the visuals are the
 * application's, not the engine's, until a package that may import `render`
 * ships a default skin.
 *
 * The rejected alternative was a `WidgetVisualFactory` returning opaque handles
 * the widget would then position. It buys nothing: positioning happens on the
 * widget's own transform, so the handle would only ever be passed straight back
 * to the code that made it, and every skin would have to invent a handle type.
 *
 * ## Coordinates (§7a, §74)
 *
 * The world is Y-up in 2D exactly as in 3D, and this layer does not bend that.
 * Everything in the box model is instead a **length or a fraction** — widths,
 * heights, paddings, margins, gaps, and normalized anchors — measured in a
 * top-left-origin, x-right, y-**down** frame, because that is the frame every
 * layout rule in §74 is stated in and reading order runs top to bottom. The
 * sign convention appears exactly once, where layout writes a transform:
 *
 * ```text
 * transform.position = (left, −top, z)      ← the only negation in the package
 * ```
 *
 * A widget's box in its own local space therefore spans `x ∈ [0, width]` and
 * `y ∈ [−height, 0]`: its origin is its **top-left corner**, and "down" is −Y.
 * A column stack advances in −Y; the hit area is `(0, −height, 0) …
 * (width, 0, 0)`.
 *
 * Layout units are just units. Point an orthographic camera at a
 * pixel-dimensioned frustum and one unit is one logical pixel (§74); scale the
 * UI root and the same tree lays out in world units over a 3D scene. §74's
 * device-pixel scaling belongs to the renderer's `resolution` (§47) and is not
 * modelled here.
 *
 * ## Transform authority (§42)
 *
 * A laid-out widget's position is owned by its parent's layout, and §42 requires
 * exactly one owner. Layout writes as `"constraint"` — §42's "a constraint/IK
 * solve owns the final pose", which is what a layout pass is, and the same
 * vocabulary §74 uses for its constraint layout mode. Widgets therefore declare
 * {@link UI_LAYOUT_AUTHORITY} at construction, and a widget whose authority is
 * something else (an `"animation"` tween sliding a panel in) has its position
 * write **refused with a warning**, exactly as `warnAuthorityConflict`
 * prescribes — its size, its hit area, and its children are still resolved,
 * since none of those is the transform. A root widget is written by nobody, so
 * its declared authority is inert; set it to `"manual"` if the application
 * places it, and nothing will ever warn.
 *
 * The write preserves `z`: layout owns the plane, the application owns depth.
 * That is what separates coplanar widgets for the picker (see
 * {@link collectPickables}).
 *
 * ## Layout is explicit
 *
 * `root.layout()` runs one measure pass and one arrange pass over the subtree.
 * There is no invalidation graph and no automatic pass: a retained-mode MVP that
 * silently re-laid-out on every field write would need change tracking on every
 * number in the box model, and the honest version of that is a later packet.
 * Call `layout()` after mutating the tree — typically once per frame at most.
 *
 * ## Allocation (§7b, plan D7)
 *
 * The layout passes allocate **nothing**: sizes live in fields, the intrinsic
 * measurement goes into a per-widget scratch `Vector2`, the hit area's two
 * vectors are written in place, and children are walked by index.
 * {@link collectPickables} fills a caller-supplied array. Interaction is
 * different by nature — a state change allocates its event and its two snapshots
 * — and that is deliberate: pointer transitions happen at human rates, an event
 * outlives its dispatch whenever a listener stores one, and `@fourjs/input` makes
 * the same trade for the same reason.
 */

import type { Disposable, Unsubscribe } from "@fourjs/core";
import type { Pickable, ScenePointerEvent } from "@fourjs/input";
import { Vector2, Vector3 } from "@fourjs/math";
import { Node, runOwnedTransformWrite, warnAuthorityConflict, type NodeOptions } from "@fourjs/scene";

/**
 * The authority a layout pass writes a widget's position under (§42):
 * `"constraint"`, since a layout *is* a constraint solve over the box model and
 * §74 spells its most general mode with that same word.
 */
export const UI_LAYOUT_AUTHORITY = "constraint" as const;

/**
 * Everything §73–§75 names that this MVP does **not** ship, each with the dated
 * note the plan requires.
 *
 * Exported as data rather than left in prose so the staging is greppable,
 * assertable in tests, and printable by a diagnostics overlay — the shape
 * `@fourjs/diagnostics`' `DEBUG_DRAW_STAGED` established. Nothing reads it at
 * runtime; it is documentation that cannot drift out of the build.
 *
 * **An entry leaves this array when the thing ships.** §75's keyboard
 * navigation and focus order left it on 2026-08-07 (A-13): `@fourjs/input` gained
 * the key source that was its stated blocker (A-10), and `keyboard.ts` now
 * implements Tab/Shift-Tab traversal while `Button` implements Enter/Space
 * activation. The hidden DOM mirror, screen-reader updates, high-contrast
 * hook, and scalable text left it on 2026-09-06 (A-13 remainder):
 * `installAccessibilityMirror` is the opt-in consumer of this record.
 */
export const UI_STAGED: readonly string[] = Object.freeze([
  "§73 controls — text input, scroll view, list, virtual list, menu, " +
    "tooltip, and embedded 3D viewport are not implemented (2026-08-02, " +
    "WP-11.3; narrowed 2026-08-07, A-12, when toggle, checkbox, radio button, " +
    "slider, progress indicator, and image shipped beside panel, label, and " +
    "button; narrowed again 2026-08-29, RFC 0004, when the canvas view " +
    "shipped as CanvasViewWidget — its blocker note here was wrong: the " +
    "widget never draws, the skin owns the §77a surface, see " +
    "canvas-view.ts). Each name still here needs engine surface this layer " +
    "does not have: text input needs §56 selection and caret; scroll view and " +
    "virtual list need §74 overflow and scroll extent — their §67 clipping " +
    "half is met since 2026-08-28 (R-23: a scroll view's viewport panel sets " +
    "`clip = true` on the node that draws its background, masking the " +
    "content subtree to it, with nested scroll views intersecting by " +
    "construction; what remains is §74's layout policy, i.e. measuring the " +
    "content extent and offsetting it) — plus, for the scroll view, a wheel/" +
    "drag gesture source; the embedded " +
    "3D viewport needs a §48 nested render surface; " +
    "menu and tooltip need a per-frame update hook no widget has — " +
    "a hover delay is a §9 time-domain reading, and the loop that owns time " +
    "(§10) lives above this package, so a tooltip built here would either " +
    "invent a clock or measure nothing. List needs a selection model and item " +
    "navigation over an arbitrary child set, and is not useful at any real " +
    "size without the same §74 overflow the scroll view waits on.",
  "§74 layout modes — grid and constraints are not implemented (2026-08-02, " +
    "WP-11.3: absolute, stack, and flex ship; see Panel). §74's anchor mode " +
    "ships as the per-child anchor/pivot/offset triple honoured by absolute " +
    "layout rather than as a fourth mode.",
  "§74 sizing — percentages, overflow, scroll extent, device-pixel scaling, " +
    "and right-to-left interfaces are not implemented (2026-08-02, WP-11.3: " +
    "percentages and RTL need a resolution pass this packet does not own; " +
    "scroll extent belongs with the scroll view; device-pixel scaling is the " +
    "renderer's `resolution`, §47).",
  "§75 reduced motion — installAccessibilityMirror accepts the already-" +
    "resolved boolean (2026-09-06, A-13 remainder; Application.reducedMotion " +
    "ships on the umbrella). Nothing in this MVP animates; the widgets that " +
    "will (menu, tooltip) must read prefersReducedMotion() or the option " +
    "they were given. They still wait on a per-frame update hook.",
]);

/**
 * Symmetric edge insets in layout units — padding and margins (§74).
 *
 * A mutable class rather than an object literal, for plan D7's reason: insets
 * are read every layout pass, so they are written in place (`set`, `setAll`,
 * `copy`) and never replaced.
 */
export class Insets {
  /** Distance from the top edge, in layout units. */
  top: number;

  /** Distance from the right edge. */
  right: number;

  /** Distance from the bottom edge. */
  bottom: number;

  /** Distance from the left edge. */
  left: number;

  /**
   * CSS's shorthand order — `(all)`, `(vertical, horizontal)`, or all four
   * clockwise from the top — because that is the order every author already
   * knows, and none of the four is more fundamental than the others.
   */
  constructor(top = 0, right = top, bottom = top, left = right) {
    this.top = top;
    this.right = right;
    this.bottom = bottom;
    this.left = left;
  }

  /** Writes all four edges, in the constructor's shorthand order. Returns `this`. */
  set(top: number, right = top, bottom = top, left = right): this {
    this.top = top;
    this.right = right;
    this.bottom = bottom;
    this.left = left;
    return this;
  }

  /** Copies `other`'s four edges into this. Returns `this`. */
  copy(other: Insets): this {
    return this.set(other.top, other.right, other.bottom, other.left);
  }

  /** `left + right` — the horizontal space these insets consume. */
  get horizontal(): number {
    return this.left + this.right;
  }

  /** `top + bottom` — the vertical space these insets consume. */
  get vertical(): number {
    return this.top + this.bottom;
  }
}

/**
 * How insets are given in options: one number for all four edges, or a partial
 * record of the edges that differ from `0`.
 */
export type InsetsInit =
  | number
  | {
      readonly top?: number;
      readonly right?: number;
      readonly bottom?: number;
      readonly left?: number;
    };

/** Writes an {@link InsetsInit} into `target`. */
export function applyInsets(target: Insets, init: InsetsInit): Insets {
  if (typeof init === "number") {
    return target.set(init);
  }
  return target.set(
    init.top ?? 0,
    init.right ?? 0,
    init.bottom ?? 0,
    init.left ?? 0,
  );
}

/**
 * A widget's interaction state at one instant (§72, §75).
 *
 * The flags §75 asks a mirror to expose that this tier can actually observe.
 * `expanded` still belongs to a control that does not ship (see
 * {@link UI_STAGED}); `checked` joined the record on 2026-08-07 (A-12) when
 * `Toggle`, `Checkbox`, and `RadioButton` shipped.
 */
export interface WidgetStateSnapshot {
  /** A pointer is over this widget's hit area. */
  readonly hovered: boolean;
  /** A pointer is pressed on this widget. */
  readonly pressed: boolean;
  /** This widget holds the focus of its scene root (§75). */
  readonly focused: boolean;
  /** This widget refuses interaction (§75's disabled state). */
  readonly disabled: boolean;
  /**
   * Whether a checkable control is checked — and **`null` for a widget that is
   * not checkable at all**, which is most of them.
   *
   * Three-valued rather than `false`-by-default for ARIA's own reason: an
   * `aria-checked` of `false` says "this is a checkbox and it is clear", while
   * an absent one says "this is not a checkbox". A panel reporting `false`
   * would tell a §75 mirror the first when the truth is the second. See
   * {@link UIWidget.checked}.
   */
  readonly checked: boolean | null;
}

/** Payload of the `uistatechange` event. */
export interface WidgetStateChangeEvent {
  /** The widget whose state changed — always the emitter. */
  readonly widget: UIWidget;
  /** The state before this transition. */
  readonly previous: WidgetStateSnapshot;
  /** The state after it. */
  readonly current: WidgetStateSnapshot;
}

/**
 * What caused a {@link WidgetActivateEvent}.
 *
 * `"keyboard"` joined the union on 2026-08-07 (A-13) when §75's key-driven
 * activation landed: an Enter or a Space on a focused control is neither a
 * pointer nor a programmatic call, and collapsing it into either would make the
 * one field that exists to tell activations apart unable to tell the two apart
 * that §75 most cares about. Adding a member is additive — an existing listener
 * that switches on `"pointer"` keeps working, and one that assumed the union
 * was closed was already wrong about `pointercancel`'s precedent.
 */
export type WidgetActivationSource = "pointer" | "keyboard" | "programmatic";

/** Payload of the `uiactivate` event (§72 click → §73 button activation). */
export interface WidgetActivateEvent {
  /** The activated widget — always the emitter. */
  readonly widget: UIWidget;
  /** Whether a pointer, a key, or an explicit `activate()` call caused this. */
  readonly source: WidgetActivationSource;
  /**
   * The `click` that caused a `"pointer"` activation; `null` for a keyboard or
   * programmatic one.
   *
   * There is deliberately no matching `keyEvent`: a key activation's cause is
   * already fully described by "Enter or Space on the focused control" (see
   * `Button`), and a listener that needs the keystroke itself can read it from
   * its own `keydown` listener, which fires on the same node first.
   */
  readonly pointerEvent: ScenePointerEvent | null;
}

/**
 * Payload of the `uivaluechange` event — a control's **number** changed
 * (2026-08-07, A-12).
 *
 * A separate event from `uistatechange` because the two carry different things
 * and a listener wants exactly one of them: `uistatechange` reports transitions
 * of the four §75 flags and carries two {@link WidgetStateSnapshot}s, and a
 * slider dragged across its track changes none of them. Folding a number into
 * that snapshot would also make the base class's "nothing changed, emit
 * nothing" comparison lie for every widget that has no value.
 *
 * `previous` and `current` are always different — a control that resolves an
 * assignment to the value it already held emits nothing.
 */
export interface WidgetValueChangeEvent {
  /** The widget whose value changed — always the emitter. */
  readonly widget: UIWidget;
  /** The value before this change. */
  readonly previous: number;
  /** The value after it. */
  readonly current: number;
}

/**
 * Payload of the `focus` and `blur` events (§72, §75).
 *
 * `target` is typed as a {@link Node} rather than a `UIWidget` deliberately:
 * §72 lists focus and blur as input events on nodes, and a later keyboard or
 * DOM-mirror focus source must be able to emit these same keys for a node that
 * is not a widget. `related` is the DOM's `relatedTarget` — the node losing the
 * focus this one gained, or gaining the focus this one lost — and is `null`
 * when there is none.
 */
export interface UIFocusEvent {
  readonly target: Node;
  readonly related: Node | null;
}

/**
 * §75's accessibility description of a widget, carried verbatim as data.
 *
 * §75 spells this as a plain assignable record —
 * `button.accessibility = { role, label, description, tabIndex }` — and that is
 * exactly what ships: typed, serializable (§79).
 *
 * **Live fields.** {@link WidgetAccessibility.tabIndex} orders (and can
 * exclude from) the Tab traversal `keyboard.ts` implements, as of 2026-08-07
 * (A-13). `role`, `label`, `description`, and the §75 states (`disabled`,
 * `checked`, slider/progress values) are projected by
 * `installAccessibilityMirror` (2026-09-06, A-13 remainder). Convenience
 * accessors {@link UIWidget.label} and {@link UIWidget.role} write these
 * fields so a setter can push a screen-reader update without replacing the
 * whole record.
 */
export interface WidgetAccessibility {
  /** Semantic role, e.g. `"button"` (§75). Free-form: ARIA's vocabulary is not restated here. */
  role?: string;
  /** Accessible name (§75). */
  label?: string;
  /** Accessible description (§75). */
  description?: string;
  /**
   * Keyboard traversal order (§75); absent means `0`.
   *
   * Widgets are visited in ascending `tabIndex`, ties broken by scene order,
   * and a **negative** value removes the widget from the traversal without
   * making it unfocusable — `focus()` still works on it. See
   * `collectFocusOrder`, which also states why this engine sorts plainly rather
   * than copying the DOM's positive-before-zero rule.
   */
  tabIndex?: number;
}

/**
 * The application-supplied visuals of one widget — the seam described at the
 * top of this module.
 *
 * Every hook is optional, and every hook is called with the widget itself: a
 * skin reads whatever it needs off the widget (size, state, text layout) and
 * owns whatever it builds. A skin is free to add child nodes to the widget, to
 * draw into an entirely separate subtree, or to do nothing at all.
 *
 * ```ts
 * const skin: WidgetSkin = {
 *   onAttach(widget) { quad = new Renderable(planeGeometry(…), material); widget.add(quad); },
 *   onLayout(widget) { quad.transform.scale.set(widget.measuredWidth, widget.measuredHeight, 1); },
 *   onStateChange(widget) { material.color = widget.pressed ? PRESSED : widget.hovered ? HOVER : IDLE; },
 *   onDetach(widget) { widget.remove(quad); quad.dispose(); },
 * };
 * ```
 *
 * Ordering guarantees: `onAttach` runs before the first `onLayout`/
 * `onStateChange` of that skin (assigning a skin to an already laid-out widget
 * calls all three immediately, so a late skin is never stale), and `onDetach`
 * runs before the widget forgets the skin.
 */
export interface WidgetSkin {
  /** The skin was assigned to `widget`. */
  onAttach?(widget: UIWidget): void;
  /** `widget`'s resolved size or position changed (§74). */
  onLayout?(widget: UIWidget): void;
  /**
   * `widget`'s interaction state changed (§72) — any of the flags in
   * {@link WidgetStateSnapshot}, including a checkable control's `checked`.
   */
  onStateChange?(widget: UIWidget): void;
  /**
   * Content the skin draws changed without a layout or a state transition
   * (2026-08-07, A-12): a `Slider`'s or `ProgressIndicator`'s value, a
   * `ProgressIndicator`'s `indeterminate` flag, an `ImageWidget`'s `source` or
   * natural size.
   *
   * A fourth hook rather than an overloaded `onStateChange` because these are
   * not §75 states — a mirror must not announce a dragged slider as having
   * changed its hover or focus — and not `onLayout` because the widget's box is
   * exactly what did **not** move. A skin that draws only backgrounds ignores
   * it, which is why it is optional like the rest.
   */
  onContentChange?(widget: UIWidget): void;
  /** The skin was replaced or the widget disposed. */
  onDetach?(widget: UIWidget): void;
}

/**
 * Construction options shared by every widget.
 *
 * Extends {@link NodeOptions}, so `id` is available here too — which is what
 * lets a §79 factory rebuild a widget under its saved id (2026-08-06, A-14).
 */
export interface UIWidgetOptions extends NodeOptions {
  /** {@link Node#name}. */
  name?: string;
  /** {@link Node.visible}. */
  visible?: boolean;
  /** {@link Node.enabled}; `false` removes the widget from layout entirely. */
  enabled?: boolean;
  /** {@link UIWidget.width}. */
  width?: number | null;
  /** {@link UIWidget.height}. */
  height?: number | null;
  /** {@link UIWidget.minWidth}. */
  minWidth?: number;
  /** {@link UIWidget.maxWidth}. */
  maxWidth?: number;
  /** {@link UIWidget.minHeight}. */
  minHeight?: number;
  /** {@link UIWidget.maxHeight}. */
  maxHeight?: number;
  /** {@link UIWidget.padding}. */
  padding?: InsetsInit;
  /** {@link UIWidget.margin}. */
  margin?: InsetsInit;
  /** {@link UIWidget.anchor}, as `[x, y]`. */
  anchor?: readonly [number, number];
  /** {@link UIWidget.pivot}, as `[x, y]`. */
  pivot?: readonly [number, number];
  /** {@link UIWidget.offset}, as `[x, y]`. */
  offset?: readonly [number, number];
  /** {@link UIWidget.grow}. */
  grow?: number;
  /** {@link UIWidget.interactive}. */
  interactive?: boolean;
  /** {@link UIWidget.focusable}. */
  focusable?: boolean;
  /** {@link UIWidget.disabled}. */
  disabled?: boolean;
  /** {@link UIWidget.accessibility}. */
  accessibility?: WidgetAccessibility;
  /**
   * {@link UIWidget.label} — writes `accessibility.label`. Applied after
   * {@link UIWidgetOptions.accessibility} so an explicit record still wins on
   * every other field, and a lone `label` does not require building one.
   */
  label?: string;
  /**
   * {@link UIWidget.role} — writes `accessibility.role`. Same merge rule as
   * {@link UIWidgetOptions.label}.
   */
  role?: string;
}

declare module "@fourjs/scene" {
  // UI events, merged into the one node event map (§6b) by declaration
  // merging — the mechanism `@fourjs/scene` documents on `NodeEventMap` and
  // `@fourjs/input` established for §72.
  //
  // `focus` and `blur` take §72's own names, because §72 lists them among the
  // input events every node may receive and a later keyboard or DOM-mirror
  // focus source must be able to emit exactly these keys. The two events this
  // package *invents* — there is no §73–§75 name for either — are prefixed
  // `ui`, so `@fourjs/ui` squats no generic key it has no spec claim to.
  //
  // Deliberately NOT a doc comment: TypeDoc warns when two declarations of one
  // merged interface both carry one, and `@fourjs/scene`'s declaration is the
  // documented one.
  interface NodeEventMap {
    /** Hover, press, focus, or disabled state changed. Emitter only. */
    uistatechange: WidgetStateChangeEvent;
    /** A control was activated — a click, or an explicit `activate()`. Emitter only. */
    uiactivate: WidgetActivateEvent;
    /** A control's numeric value changed (slider, progress). Emitter only. */
    uivaluechange: WidgetValueChangeEvent;
    /** This node took the focus of its scene root (§72, §75). Emitter only. */
    focus: UIFocusEvent;
    /** This node lost that focus (§72, §75). Emitter only. */
    blur: UIFocusEvent;
  }
}

/**
 * Focused widget per focus scope.
 *
 * The scope is the **topmost node of the tree the widget is in** — the scene
 * root in practice — so two detached UI trees focus independently and a widget
 * under a plain `Group` still shares its scene's focus. A `WeakMap` because the
 * scope is somebody else's node: the record must die with the tree and must not
 * keep it alive.
 */
const focusOwners = new WeakMap<Node, UIWidget>();

/**
 * Installed accessibility mirrors subscribe here so a widget setter can push
 * a screen-reader update without importing the mirror module (and without
 * pulling that module into a tree that never installed one).
 */
export type AccessibilitySync = (widget: UIWidget) => void;

const accessibilitySyncs = new Set<AccessibilitySync>();

/**
 * Registers `sync` to be called when a widget's accessibility surface
 * changes. Returns the unsubscriber. Used by `installAccessibilityMirror`;
 * not part of the everyday widget API.
 */
export function registerAccessibilitySync(
  sync: AccessibilitySync,
): Unsubscribe {
  accessibilitySyncs.add(sync);
  return () => {
    accessibilitySyncs.delete(sync);
  };
}

/** The topmost ancestor of `node` — `node` itself when it is a root. */
function scopeRootOf(node: Node): Node {
  let root: Node = node;
  for (let parent = node.parent; parent !== null; parent = parent.parent) {
    root = parent;
  }
  return root;
}

/**
 * The widget holding the focus of `node`'s tree, or `null`.
 *
 * Takes any node of the tree — the scope root is resolved from it — so an
 * application can ask `focusedWidget(scene)` or `focusedWidget(someButton)` and
 * get the same answer.
 */
export function focusedWidget(node: Node): UIWidget | null {
  return focusOwners.get(scopeRootOf(node)) ?? null;
}

/** Clamps `value` into `[min, max]`, and never below zero — sizes are lengths. */
function clampSize(value: number, min: number, max: number): number {
  const lower = min > 0 ? min : 0;
  const upper = max < lower ? lower : max;
  return value < lower ? lower : value > upper ? upper : value;
}

/** Mutable twin of {@link WidgetStateSnapshot}, reused per widget. */
interface MutableWidgetState {
  hovered: boolean;
  pressed: boolean;
  focused: boolean;
  disabled: boolean;
  checked: boolean | null;
}

export abstract class UIWidget extends Node implements Disposable {
  /**
   * Requested width in layout units, or `null` for the intrinsic width (§74's
   * "intrinsic text/image size" — see {@link UIWidget.measureIntrinsic}).
   *
   * Requested, not resolved: {@link UIWidget.measuredWidth} is the answer, after
   * clamping and after a `"stretch"` or growing parent has had its say.
   */
  width: number | null = null;

  /** Requested height in layout units, or `null` for the intrinsic height. */
  height: number | null = null;

  /** Lower bound on {@link UIWidget.measuredWidth} (§74 minimum size). Default `0`. */
  minWidth = 0;

  /** Upper bound on {@link UIWidget.measuredWidth} (§74 maximum size). Default `Infinity`. */
  maxWidth = Infinity;

  /** Lower bound on {@link UIWidget.measuredHeight}. Default `0`. */
  minHeight = 0;

  /** Upper bound on {@link UIWidget.measuredHeight}. Default `Infinity`. */
  maxHeight = Infinity;

  /**
   * Space **inside** this widget's box, between its edges and its content
   * (§74). Never replaced — write into it.
   */
  readonly padding: Insets = new Insets();

  /**
   * Space **outside** this widget's box, reserved by its parent's layout (§74).
   *
   * Honoured by stack and flex layout. Absolute layout ignores margins: an
   * absolutely positioned child is placed by its anchor, pivot, and offset, and
   * folding a fifth and sixth number into that arithmetic makes the result
   * unpredictable rather than expressive (decision, WP-11.3).
   */
  readonly margin: Insets = new Insets();

  /**
   * Where in the parent's content box this widget attaches, normalized:
   * `(0, 0)` is the top-left corner, `(1, 1)` the bottom-right (§74 anchor).
   * Absolute layout only.
   */
  readonly anchor: Vector2 = new Vector2(0, 0);

  /**
   * Which point of **this** widget lands on the anchor, normalized the same
   * way: `(0, 0)` is its own top-left, `(0.5, 0.5)` its centre. Absolute layout
   * only.
   */
  readonly pivot: Vector2 = new Vector2(0, 0);

  /**
   * Displacement applied after anchoring, in layout units, +x right and +y
   * **down**. Absolute layout only.
   */
  readonly offset: Vector2 = new Vector2(0, 0);

  /**
   * Share of a flex container's leftover main-axis space this widget claims
   * (§74 flex). `0` — the default — never grows. Ignored by absolute and stack
   * layout.
   */
  grow = 0;

  #accessibility: WidgetAccessibility | null = null;
  #accessibilityVersion = 0;

  /** Intrinsic measurement scratch — per widget, so a bottom-up pass cannot alias. */
  readonly #intrinsic: Vector2 = new Vector2();

  #measuredWidth = 0;
  #measuredHeight = 0;
  #layoutLeft = 0;
  #layoutTop = 0;

  #interactive = true;
  #hovered = false;
  #pressed = false;
  #focused = false;
  #disabled = false;

  /**
   * Whether a pointer press on this widget takes the focus. `false` by default:
   * a panel is not a focus target, a button is (see `Button`).
   */
  focusable = false;

  /** The scope this widget's focus is recorded under, or `null` when unfocused. */
  #focusScope: Node | null = null;

  #skin: WidgetSkin | null = null;

  /** Reused state comparison buffer — see {@link UIWidget.captureState}. */
  readonly #stateBefore: MutableWidgetState = {
    hovered: false,
    pressed: false,
    focused: false,
    disabled: false,
    checked: null,
  };

  /**
   * This widget as a §71 picking candidate. The two vectors are rewritten in
   * place by every layout pass; the object identity is stable, so a candidate
   * list built once stays valid.
   */
  readonly #pickable: Pickable = {
    node: this,
    boundsMin: new Vector3(),
    boundsMax: new Vector3(),
  };

  readonly #subscriptions: Unsubscribe[] = [];

  #disposed = false;

  constructor(options: UIWidgetOptions = {}) {
    super(options);
    // §42: the parent's layout owns this transform. See the module header for
    // why a root widget declaring this is harmless.
    this.transformAuthority = UI_LAYOUT_AUTHORITY;

    this.#subscriptions.push(
      this.on("pointerenter", () => {
        this.#handleEnter();
      }),
      this.on("pointerleave", () => {
        this.#handleLeave();
      }),
      // Down/up mutate widget STATE only on the event's target (2026-08-04
      // review fix): these two types bubble (§72), and reacting on the bubble
      // path left ancestors stuck — `pointerleave` is target-only and a
      // release over empty space dispatches nothing, so an ancestor's
      // `pressed` had no clearing path (and a focusable ancestor stole the
      // target's focus in the same dispatch). Application listeners on
      // ancestors still observe both events; only the state reaction is
      // target-scoped, which is exactly what `pressed`'s doc contract ("a
      // pointer is pressed on THIS widget") says.
      this.on("pointerdown", (event) => {
        if (event.target === this) this.#handleDown();
      }),
      this.on("pointerup", (event) => {
        if (event.target === this) this.#handleUp();
      }),
      // Focus does not survive reparenting (2026-08-04 review fix): the
      // focus-owner registry is keyed by scope ROOT, captured at focus time.
      // A widget focused in one tree (or while detached) and then added
      // elsewhere would leave that record stale — two focused widgets under
      // one root, the module's one-per-scope invariant broken. Mirroring the
      // DOM (moving an element blurs it), attachment drops the focus.
      this.on("added", () => {
        if (this.#focused) this.blur();
      }),
    );

    if (options.name !== undefined) this.name = options.name;
    if (options.visible !== undefined) this.visible = options.visible;
    if (options.enabled !== undefined) this.enabled = options.enabled;
    if (options.width !== undefined) this.width = options.width;
    if (options.height !== undefined) this.height = options.height;
    if (options.minWidth !== undefined) this.minWidth = options.minWidth;
    if (options.maxWidth !== undefined) this.maxWidth = options.maxWidth;
    if (options.minHeight !== undefined) this.minHeight = options.minHeight;
    if (options.maxHeight !== undefined) this.maxHeight = options.maxHeight;
    if (options.padding !== undefined)
      applyInsets(this.padding, options.padding);
    if (options.margin !== undefined) applyInsets(this.margin, options.margin);
    if (options.anchor !== undefined) this.anchor.set(...options.anchor);
    if (options.pivot !== undefined) this.pivot.set(...options.pivot);
    if (options.offset !== undefined) this.offset.set(...options.offset);
    if (options.grow !== undefined) this.grow = options.grow;
    if (options.interactive !== undefined)
      this.#interactive = options.interactive;
    if (options.focusable !== undefined) this.focusable = options.focusable;
    if (options.disabled !== undefined) this.#disabled = options.disabled;
    if (options.accessibility !== undefined) {
      this.#accessibility = options.accessibility;
    }
    // Applied after the record so a lone `label` / `role` constructs one, and
    // a pair next to `accessibility` writes those two fields into it (the
    // rest of the record is left alone). No notify: nothing is mirrored yet.
    if (options.label !== undefined) this.#writeLabel(options.label);
    if (options.role !== undefined) this.#writeRole(options.role);
    // There is deliberately no `skin` option: assigning a skin calls
    // `onAttach`/`onLayout`/`onStateChange` immediately, and a base constructor
    // runs *before* a subclass's field initializers — so a skin passed here
    // would be handed a `Label` whose text does not exist yet. Assign
    // `widget.skin` after construction (decision, WP-11.3).
  }

  // --- resolved geometry ------------------------------------------------------

  /** Width resolved by the last measure pass, in layout units. */
  get measuredWidth(): number {
    return this.#measuredWidth;
  }

  /** Height resolved by the last measure pass. */
  get measuredHeight(): number {
    return this.#measuredHeight;
  }

  /** Width available inside the padding — never negative. */
  get contentWidth(): number {
    const inner = this.#measuredWidth - this.padding.horizontal;
    return inner > 0 ? inner : 0;
  }

  /** Height available inside the padding — never negative. */
  get contentHeight(): number {
    const inner = this.#measuredHeight - this.padding.vertical;
    return inner > 0 ? inner : 0;
  }

  /**
   * Distance from the parent's origin to this widget's left edge, as the last
   * arrange pass placed it. `0` for a root, which nothing lays out.
   */
  get layoutLeft(): number {
    return this.#layoutLeft;
  }

  /** Distance **down** from the parent's origin to this widget's top edge. */
  get layoutTop(): number {
    return this.#layoutTop;
  }

  /**
   * This widget as a picking candidate (§71), with bounds
   * `(0, −height, 0) … (width, 0, 0)` in its own local space.
   *
   * The box is flat: UI is a plane, and `pick` intersects a zero-depth box
   * exactly as long as the ray is not parallel to it. Two coplanar widgets that
   * overlap therefore tie on distance and resolve by candidate order — see
   * {@link collectPickables}.
   */
  get hitArea(): Pickable {
    return this.#pickable;
  }

  // --- interaction state (§72) ------------------------------------------------

  /**
   * Whether pointer events change this widget's state. `true` by default;
   * turning it off clears hover and press and drops the widget from
   * {@link collectPickables}.
   */
  get interactive(): boolean {
    return this.#interactive;
  }

  set interactive(value: boolean) {
    if (value === this.#interactive) return;
    this.captureState();
    this.#interactive = value;
    if (!value) {
      this.#hovered = false;
      this.#pressed = false;
    }
    this.publishState();
  }

  /** A pointer is over this widget's hit area. */
  get hovered(): boolean {
    return this.#hovered;
  }

  /** A pointer is pressed on this widget. */
  get pressed(): boolean {
    return this.#pressed;
  }

  /** This widget holds its scene root's focus (§75). */
  get focused(): boolean {
    return this.#focused;
  }

  /**
   * §75's disabled state. Disabling clears hover, press, and focus (blurring
   * emits `blur`), and refuses every later interaction until it is cleared.
   */
  get disabled(): boolean {
    return this.#disabled;
  }

  set disabled(value: boolean) {
    if (value === this.#disabled) return;
    this.captureState();
    this.#disabled = value;
    if (value) {
      this.#hovered = false;
      this.#pressed = false;
      if (this.#focused) {
        this.#releaseFocusOwnership();
        this.#focused = false;
        this.emit("blur", { target: this, related: null });
      }
    }
    this.publishState();
  }

  /**
   * §75's accessibility record, or `null`. Assigning replaces the record and
   * notifies an installed DOM mirror. Mutating fields in place does not —
   * assign a new object, write {@link UIWidget.label} / {@link UIWidget.role},
   * or call `mirror.sync(widget)`.
   */
  get accessibility(): WidgetAccessibility | null {
    return this.#accessibility;
  }

  set accessibility(value: WidgetAccessibility | null) {
    if (value === this.#accessibility) return;
    this.#accessibility = value;
    this.notifyAccessibility();
  }

  /**
   * Accessible name (§75). Writes `accessibility.label`, creating the record
   * when there is not one yet. Empty-string is stored as authored; `undefined`
   * removes the field.
   */
  get label(): string | undefined {
    return this.#accessibility?.label;
  }

  set label(value: string | undefined) {
    if (value === this.label) return;
    this.#writeLabel(value);
    this.notifyAccessibility();
  }

  /**
   * Semantic role (§75). Writes `accessibility.role` with the same create-or-
   * mutate rule as {@link UIWidget.label}.
   */
  get role(): string | undefined {
    return this.#accessibility?.role;
  }

  set role(value: string | undefined) {
    if (value === this.role) return;
    this.#writeRole(value);
    this.notifyAccessibility();
  }

  /**
   * Generation of this widget's accessibility surface. Incremented by every
   * setter that a mirror cares about (`disabled`, `checked`, `value`,
   * `label` / `role` / `accessibility`). An installer that would rather poll
   * than subscribe compares this against the last value it projected.
   */
  get accessibilityVersion(): number {
    return this.#accessibilityVersion;
  }

  /**
   * Whether this control is checked, or **`null` when it is not a checkable
   * control** — which is what every widget in this package answers except
   * `Toggle`, `Checkbox`, and `RadioButton` (2026-08-07, A-12).
   *
   * A getter with no state behind it at this level, deliberately: checkedness
   * belongs to the three controls that have it, and giving every panel and
   * label a `#checked` field would put a flag on hundreds of nodes to serve
   * three classes. What the base *does* own is the comparison — see
   * {@link UIWidget.publishState} — so a subclass that flips its own
   * checkedness inside {@link UIWidget.captureState} /
   * {@link UIWidget.publishState} gets `uistatechange` and the skin
   * notification for free, exactly as hover and focus do.
   *
   * See {@link WidgetStateSnapshot.checked} for why `null` rather than `false`.
   */
  get checked(): boolean | null {
    return null;
  }

  /** A snapshot of the §75 state flags. */
  get state(): WidgetStateSnapshot {
    return {
      hovered: this.#hovered,
      pressed: this.#pressed,
      focused: this.#focused,
      disabled: this.#disabled,
      checked: this.checked,
    };
  }

  /** Whether {@link UIWidget.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Gives this widget the focus of its scene root (§75), blurring whichever
   * widget held it.
   *
   * A no-op for a widget that is not {@link UIWidget.focusable}, is disabled,
   * is `enabled = false`, is disposed, or already holds the focus. Emits `blur`
   * on the previous holder and then `focus` on this one, each carrying the
   * other as {@link UIFocusEvent.related}.
   */
  focus(): void {
    if (
      this.#disposed ||
      !this.focusable ||
      this.#disabled ||
      !this.enabled ||
      this.#focused
    ) {
      return;
    }
    const scope = scopeRootOf(this);
    const previous = focusOwners.get(scope) ?? null;
    if (previous !== null) {
      previous.#clearFocus(this);
    }
    focusOwners.set(scope, this);
    this.#focusScope = scope;
    this.captureState();
    this.#focused = true;
    this.emit("focus", { target: this, related: previous });
    this.publishState();
  }

  /** Drops the focus if this widget holds it. Emits `blur`. Otherwise a no-op. */
  blur(): void {
    this.#clearFocus(null);
  }

  // --- skinning ---------------------------------------------------------------

  /**
   * The application-supplied visuals of this widget, or `null`. See
   * {@link WidgetSkin} and this module's header.
   */
  get skin(): WidgetSkin | null {
    return this.#skin;
  }

  set skin(value: WidgetSkin | null) {
    if (value === this.#skin) return;
    this.#skin?.onDetach?.(this);
    this.#skin = value;
    if (value !== null) {
      value.onAttach?.(this);
      value.onLayout?.(this);
      value.onStateChange?.(this);
    }
  }

  // --- layout (§74) -----------------------------------------------------------

  /**
   * Lays this subtree out: one bottom-up measure pass, then one top-down
   * arrange pass. The entry point — call it on the root of a UI tree after
   * changing anything, and never per widget.
   *
   * A root's own position is untouched (nothing lays out a root); its size, its
   * hit area, and every descendant are resolved.
   */
  layout(): void {
    this.measure();
    this.#finalize();
    this.arrange();
  }

  /**
   * Resolves {@link UIWidget.measuredWidth} and
   * {@link UIWidget.measuredHeight}, after resolving every enabled widget
   * child. Engine-internal: `layout()` calls it.
   *
   * The requested size wins when given; otherwise the intrinsic size does. Both
   * are clamped into `[min, max]`, and never below zero.
   */
  measure(): void {
    const children = this.children;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (child instanceof UIWidget && child.enabled) {
        child.measure();
      }
    }
    this.measureIntrinsic(this.#intrinsic);
    this.setMeasuredSize(
      this.width ?? this.#intrinsic.x,
      this.height ?? this.#intrinsic.y,
    );
  }

  /**
   * Writes this widget's content-driven size into `out` — §74's "intrinsic
   * text/image size".
   *
   * `(0, 0)` at this level: a bare widget has no content. `Label` measures its
   * text, `Panel` the extent of its children. Called after every enabled widget
   * child has been measured, so an override may read their measured sizes.
   */
  measureIntrinsic(out: Vector2): void {
    out.set(0, 0);
  }

  /**
   * Overrides the measured size, clamped into `[min, max]`. Engine-internal:
   * a flex parent calls it to grow a child, and a `"stretch"` parent to fill
   * the cross axis. Applications set {@link UIWidget.width} instead.
   */
  setMeasuredSize(width: number, height: number): void {
    this.#measuredWidth = clampSize(width, this.minWidth, this.maxWidth);
    this.#measuredHeight = clampSize(height, this.minHeight, this.maxHeight);
  }

  /**
   * Places this widget at `(left, top)` in its parent's frame and arranges its
   * own children. Engine-internal: a parent's arrange pass calls it.
   *
   * The transform write is `(left, −top, z)` — see the module header on
   * coordinates — and is **refused with a §42 warning** when this widget's
   * `transformAuthority` is not {@link UI_LAYOUT_AUTHORITY}. Everything else
   * still happens: the refusal is about who owns the position, not about
   * whether the widget has a size.
   */
  applyLayout(left: number, top: number): void {
    this.#layoutLeft = left;
    this.#layoutTop = top;
    if (this.transformAuthority === UI_LAYOUT_AUTHORITY) {
      runOwnedTransformWrite(() => {
        this.transform.position.set(left, -top, this.transform.position.z);
      });
    } else {
      warnAuthorityConflict(this, UI_LAYOUT_AUTHORITY);
    }
    this.#finalize();
    this.arrange();
  }

  /**
   * Positions this widget's children. Engine-internal, and a no-op here: a bare
   * widget is a leaf. `Panel` implements §74's layout modes.
   */
  arrange(): void {
    // Leaf widgets have nothing to arrange.
  }

  // --- lifecycle --------------------------------------------------------------

  /**
   * Registers `unsubscribe` to be called by {@link UIWidget.dispose}. For
   * subclasses that listen to their own events (see `Button`).
   */
  protected addSubscription(unsubscribe: Unsubscribe): void {
    this.#subscriptions.push(unsubscribe);
  }

  /**
   * Releases this widget's own listeners, focus, and skin (§83). Idempotent.
   *
   * It does **not** remove the widget from its parent, dispose its children, or
   * touch whatever a skin built — those are owned by whoever created them.
   */
  dispose(): void {
    if (this.#disposed) return;
    this.#clearFocus(null);
    for (let i = 0; i < this.#subscriptions.length; i += 1) {
      this.#subscriptions[i]();
    }
    this.#subscriptions.length = 0;
    this.skin = null;
    this.#disposed = true;
    this.notifyAccessibility();
  }

  // --- internals --------------------------------------------------------------

  /** Syncs the hit area and tells the skin the geometry is final. */
  #finalize(): void {
    this.#pickable.boundsMin.set(0, -this.#measuredHeight, 0);
    this.#pickable.boundsMax.set(this.#measuredWidth, 0, 0);
    this.#skin?.onLayout?.(this);
  }

  #handleEnter(): void {
    if (!this.#canInteract() || this.#hovered) return;
    this.captureState();
    this.#hovered = true;
    this.publishState();
  }

  #handleLeave(): void {
    if (!this.#hovered && !this.#pressed) return;
    this.captureState();
    this.#hovered = false;
    this.#pressed = false;
    this.publishState();
  }

  #handleDown(): void {
    if (!this.#canInteract()) return;
    if (!this.#pressed) {
      this.captureState();
      this.#pressed = true;
      this.publishState();
    }
    this.focus();
  }

  #handleUp(): void {
    if (!this.#pressed) return;
    this.captureState();
    this.#pressed = false;
    this.publishState();
  }

  #canInteract(): boolean {
    return this.#interactive && !this.#disabled && this.enabled;
  }

  /**
   * Records the current flags so {@link UIWidget.publishState} can diff them.
   *
   * `protected` rather than private since 2026-08-07 (A-12): a control that
   * owns a state flag the base does not — a `Toggle`'s checkedness — brackets
   * its own mutation with these two and inherits the whole publication path
   * (no-change suppression, both snapshots, the skin notification, the event)
   * instead of re-implementing it. There is exactly one buffer per widget, so
   * the two calls must be adjacent: capture, mutate, publish.
   */
  protected captureState(): void {
    const before = this.#stateBefore;
    before.hovered = this.#hovered;
    before.pressed = this.#pressed;
    before.focused = this.#focused;
    before.disabled = this.#disabled;
    before.checked = this.checked;
  }

  /**
   * Emits `uistatechange` when anything actually changed since
   * {@link UIWidget.captureState}, notifying the skin first so a listener sees
   * the widget already looking the way it will look.
   */
  protected publishState(): void {
    const before = this.#stateBefore;
    if (
      before.hovered === this.#hovered &&
      before.pressed === this.#pressed &&
      before.focused === this.#focused &&
      before.disabled === this.#disabled &&
      before.checked === this.checked
    ) {
      return;
    }
    const previous: WidgetStateSnapshot = { ...before };
    const current = this.state;
    this.#skin?.onStateChange?.(this);
    this.emit("uistatechange", { widget: this, previous, current });
    // Hover and press are not an accessibility surface; disabled and checked
    // are. A mirror that subscribed via registerAccessibilitySync is pushed
    // only for the latter so a pointer sweep does not rewrite the DOM.
    if (before.disabled !== this.#disabled || before.checked !== this.checked) {
      this.notifyAccessibility();
    }
  }

  /**
   * Tells the skin that something it draws changed which is neither this
   * widget's box nor one of its §75 states (2026-08-07, A-12) — see
   * {@link WidgetSkin.onContentChange}.
   *
   * `protected` because it is the control's own business when its content
   * changed: `Slider`, `ProgressIndicator`, and `ImageWidget` call it, and no
   * caller outside a widget can know better than the widget does. It emits no
   * event: a value change has its own (`uivaluechange`), and an image's source
   * has no observer but the skin.
   */
  protected notifyContentChange(): void {
    this.#skin?.onContentChange?.(this);
    this.notifyAccessibility();
  }

  /**
   * Bumps {@link UIWidget.accessibilityVersion} and notifies every installed
   * DOM mirror. `protected` so a subclass that owns a field the base does not
   * (a future `expanded`) can push the same way `checked` does.
   */
  protected notifyAccessibility(): void {
    this.#accessibilityVersion += 1;
    for (const sync of accessibilitySyncs) {
      sync(this);
    }
  }

  #writeLabel(value: string | undefined): void {
    if (value === undefined) {
      if (this.#accessibility !== null) {
        delete this.#accessibility.label;
      }
      return;
    }
    if (this.#accessibility === null) {
      this.#accessibility = { label: value };
      return;
    }
    this.#accessibility.label = value;
  }

  #writeRole(value: string | undefined): void {
    if (value === undefined) {
      if (this.#accessibility !== null) {
        delete this.#accessibility.role;
      }
      return;
    }
    if (this.#accessibility === null) {
      this.#accessibility = { role: value };
      return;
    }
    this.#accessibility.role = value;
  }

  /** Drops the focus-owner record, whatever scope it was taken in. */
  #releaseFocusOwnership(): void {
    const scope = this.#focusScope;
    if (scope !== null && focusOwners.get(scope) === this) {
      focusOwners.delete(scope);
    }
    this.#focusScope = null;
  }

  /** Blurs this widget, reporting `related` as the node taking the focus. */
  #clearFocus(related: Node | null): void {
    if (!this.#focused) return;
    this.#releaseFocusOwnership();
    this.captureState();
    this.#focused = false;
    this.emit("blur", { target: this, related });
    this.publishState();
  }
}

/** Whether `node` is a widget — the narrowing every UI walk needs. */
export function isUIWidget(node: Node): node is UIWidget {
  return node instanceof UIWidget;
}

/**
 * Collects the §71 picking candidates of a UI tree into `out`, **root first**
 * and then depth-first in insertion order, and returns it.
 *
 * ```ts
 * const candidates: Pickable[] = [];               // reused
 * const input = new PointerInput(canvas, {
 *   camera,
 *   pickables: () => collectPickables(uiRoot, candidates),
 * });
 * ```
 *
 * A subtree is **pruned** at any node that is `visible = false` or
 * `enabled = false` — a hidden panel's buttons are not clickable, and pruning
 * at the node rather than filtering per widget means a plain `Group` hides its
 * UI descendants too. A widget that survives the walk is a candidate unless it
 * is {@link UIWidget.interactive} `= false`, which drops that widget alone and
 * keeps its children.
 *
 * The order matters: `pick` sorts hits by distance with a **stable** sort, and
 * coplanar widgets are all at the same distance, so a tie resolves to whichever
 * came first here — the ancestor. A child that must win over its parent needs a
 * real depth difference, which is why layout never writes `z`: set
 * `child.transform.position.z` (a few thousandths toward the camera is enough)
 * and the picker orders them properly.
 *
 * Zero-alloc when `out` is supplied: it is overwritten and truncated.
 */
export function collectPickables(root: Node, out: Pickable[] = []): Pickable[] {
  const count = collectInto(root, out, 0);
  out.length = count;
  return out;
}

/** Depth-first fill of {@link collectPickables}; returns the next free index. */
function collectInto(node: Node, out: Pickable[], start: number): number {
  if (!node.visible || !node.enabled) {
    return start;
  }
  let count = start;
  if (node instanceof UIWidget && node.interactive) {
    out[count] = node.hitArea;
    count += 1;
  }
  const children = node.children;
  for (let i = 0; i < children.length; i += 1) {
    count = collectInto(children[i], out, count);
  }
  return count;
}
