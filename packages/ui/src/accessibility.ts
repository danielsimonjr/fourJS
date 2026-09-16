/**
 * §75's hidden DOM accessibility mirror (2026-09-06, A-13 remainder).
 *
 * ```ts
 * const mirror = installAccessibilityMirror(uiRoot, { document: window.document });
 * gravity.value = -9.81;          // slider setters push aria-valuenow
 * mute.disabled = true;           // checkbox setters push aria-disabled
 * mirror.dispose();               // removes the visually-hidden container
 * ```
 *
 * ## Why this is a function, not a widget method
 *
 * The same reason {@link installKeyboardTraversal} is a function: a mirror is a
 * property of a *tree* (or a forest of trees), it needs a host document this
 * package may not name, and it must stay **opt-in**. An application that never
 * imports this module never pays for it — `package.json` sets `sideEffects:
 * false`, so a bundler that tree-shakes unused `@fourjs/ui` exports drops this
 * file entirely. That is the payload-budget half of the DOM integration policy.
 *
 * ## DOM integration policy (decision, A-13 remainder)
 *
 * This package's tsconfig has no DOM lib, and the frozen dependency matrix
 * forbids naming host types. The document is therefore a duck-typed
 * {@link DocumentLike}: `createElement`, `body`, `getElementById`. Tests inject
 * a tiny fake; browsers pass `window.document`. Nothing here touches a canvas,
 * a renderer, or `@fourjs/four`'s `Application` — reduced motion is an option
 * the caller copies from `app.reducedMotion` when they have one.
 *
 * The container is the accessibility tree, so it is **not** `aria-hidden`.
 * It is clipped with visually-hidden CSS so a screen reader walks it and a
 * sighted user does not see a second set of controls over the canvas.
 *
 * One element is created per focusable, labelled, or role-bearing widget.
 * Authored {@link WidgetAccessibility} values win; when a control authored
 * none, the mirror infers the §73 role (`button`, `checkbox`, `switch`,
 * `radio`, `slider`, `progressbar`) from the class. It never writes that
 * inference back onto the widget — the accessibility record has one author
 * (see `checkable.ts`).
 *
 * ## Push updates
 *
 * Widget setters that already publish state (`disabled`, `checked`, a slider's
 * `value`, `label` / `role` / `accessibility`) notify installed mirrors through
 * `registerAccessibilitySync`. {@link AccessibilityMirror.sync} / `syncAll`
 * remain public for in-place mutations of the accessibility record, for
 * widgets added after install, and for a caller that would rather poll
 * {@link UIWidget.accessibilityVersion}.
 */

import type { Disposable, Unsubscribe } from "@fourjs/core";
import type { Node } from "@fourjs/scene";

import { Button } from "./button.js";
import { Checkbox, Toggle } from "./checkable.js";
import { ProgressIndicator } from "./progress.js";
import { RadioButton } from "./radio.js";
import { Slider } from "./slider.js";
import {
  registerAccessibilitySync,
  UIWidget,
  type WidgetAccessibility,
} from "./widget.js";

/**
 * A host document this package may not name — `window.document` in a browser,
 * a tiny fake in Node tests.
 *
 * Duck-typed on the three members the mirror actually calls. `matchMedia` and
 * `defaultView` are optional so a test document that has no notion of
 * preferences is still a {@link DocumentLike}.
 */
export interface DocumentLike {
  createElement(tagName: string): ElementLike;
  body: { appendChild(node: ElementLike): unknown } | null;
  getElementById(id: string): ElementLike | null;
  matchMedia?(query: string): { matches: boolean };
  defaultView?: { matchMedia?(query: string): { matches: boolean } } | null;
}

/**
 * Style bag the a11y mirror writes. Individual properties only — never
 * `cssText` (CSP `style-src` without `'unsafe-inline'`, §96).
 */
export interface ElementStyleLike {
  position?: string;
  width?: string;
  height?: string;
  padding?: string;
  margin?: string;
  overflow?: string;
  clip?: string;
  clipPath?: string;
  whiteSpace?: string;
  border?: string;
  fontSize?: string;
}

/**
 * The handful of element operations the mirror uses. A fake implements these
 * as ordinary methods and fields; a real `HTMLElement` already has them.
 */
export interface ElementLike {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  appendChild(node: ElementLike): unknown;
  removeChild?(node: ElementLike): unknown;
  remove?(): void;
  parentNode?: { removeChild(node: ElementLike): unknown } | null;
  id?: string;
  tabIndex?: number;
  disabled?: boolean;
  checked?: boolean;
  type?: string;
  style?: ElementStyleLike;
}

/**
 * A widget tree, or several sibling trees, to project into the DOM.
 *
 * A forest is the case a split-screen or a detached overlay wants: two UI
 * roots, one mirror, one accessibility tree.
 */
export type AccessibilityMirrorRoot = Node | readonly Node[];

/** Options for {@link installAccessibilityMirror}. */
export interface AccessibilityMirrorOptions {
  /**
   * Host document. Omit it in a browser (`globalThis.document` is used); pass
   * a fake in Node. Required when neither is available.
   */
  document?: DocumentLike;
  /**
   * Force the high-contrast hook. When omitted, the mirror consults
   * `matchMedia("(prefers-contrast: more)")` on the document if that exists.
   * `true` or a matching query writes `data-high-contrast` on the container
   * so host CSS can restyle the (visually hidden) tree — and, more usefully,
   * so an application skin can read the same bit.
   */
  highContrast?: boolean;
  /**
   * Scale applied as `font-size` on the mirror container, not on the canvas.
   * `1` (the default) leaves the host's font size alone.
   */
  fontScale?: number;
  /**
   * When `true`, widgets that animate should skip. Nothing in this MVP
   * animates; {@link prefersReducedMotion} is the hook those widgets will
   * read. Copy `app.reducedMotion` in here when the caller has an Application.
   */
  reducedMotion?: boolean;
}

/**
 * The installed §75 mirror: a visually-hidden container, a sync API, and a
 * disposer.
 */
export interface AccessibilityMirror extends Disposable {
  /** The visually-hidden container — the root of the projected tree. */
  readonly root: ElementLike;
  /** The {@link AccessibilityMirrorOptions.reducedMotion} that was installed. */
  readonly reducedMotion: boolean;
  /** Whether the high-contrast hook is active on {@link AccessibilityMirror.root}. */
  readonly highContrast: boolean;
  /** The {@link AccessibilityMirrorOptions.fontScale} written onto the container. */
  readonly fontScale: number;
  /** The projected element for `widget`, or `undefined` when it is not mirrored. */
  elementFor(widget: UIWidget): ElementLike | undefined;
  /** Pushes `widget`'s current accessibility surface into the DOM. */
  sync(widget: UIWidget): void;
  /** Re-walks every root and syncs (and drops stale projections). */
  syncAll(): void;
  /** Removes the container from the document. Idempotent. */
  dispose(): void;
}

/**
 * Clip-and-collapse style that hides the container from sighted users without
 * taking it out of the accessibility tree. `aria-hidden` would do the latter,
 * which is the opposite of why this container exists. Written as individual
 * properties so CSP `style-src` without `'unsafe-inline'` stays satisfied.
 */
const VISUALLY_HIDDEN: Readonly<Omit<ElementStyleLike, "fontSize">> =
  Object.freeze({
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: "0",
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
    border: "0",
  });

const CONTRAST_QUERY = "(prefers-contrast: more)";

const ELEMENT_ID_PREFIX = "four-a11y-";

/** Installed mirrors that asked for reduced motion — see {@link prefersReducedMotion}. */
let reducedMotionInstalls = 0;

/**
 * Whether any installed mirror asked for reduced motion.
 *
 * The hook menu / tooltip (and any later animated control) will call. It is
 * `true` while at least one live mirror was constructed with
 * `reducedMotion: true`. Application.reducedMotion is not visible in this
 * package; the installer accepts the already-resolved boolean.
 */
export function prefersReducedMotion(): boolean {
  return reducedMotionInstalls > 0;
}

/**
 * Installs §75's hidden DOM accessibility mirror over `root` and returns it.
 *
 * Creates one visually-hidden container (appended to `document.body` when that
 * exists), projects every focusable / labelled / role-bearing widget under
 * `root`, and subscribes to widget setters so subsequent `disabled`,
 * `checked`, `value`, `label`, and `role` writes push into the projection.
 *
 * @throws Error when no {@link DocumentLike} was passed and
 * `globalThis.document` is missing — the Node-test case, which must inject.
 */
export function installAccessibilityMirror(
  root: AccessibilityMirrorRoot,
  options: AccessibilityMirrorOptions = {},
): AccessibilityMirror {
  return new DomAccessibilityMirror(root, options);
}

/** Prefix of every projected element id — `four-a11y-` plus the widget's node id. */
export function accessibilityElementId(widget: UIWidget): string {
  return ELEMENT_ID_PREFIX + widget.id;
}

class DomAccessibilityMirror implements AccessibilityMirror {
  readonly root: ElementLike;
  readonly reducedMotion: boolean;
  readonly highContrast: boolean;
  readonly fontScale: number;

  readonly #document: DocumentLike;
  readonly #roots: readonly Node[];
  readonly #elements = new Map<UIWidget, ElementLike>();
  readonly #unsubscribe: Unsubscribe;
  #disposed = false;
  #ownsReducedMotion = false;

  constructor(
    root: AccessibilityMirrorRoot,
    options: AccessibilityMirrorOptions,
  ) {
    this.#document = resolveDocument(options.document);
    this.#roots = Array.isArray(root) ? root : [root];
    this.fontScale = options.fontScale ?? 1;
    this.reducedMotion = options.reducedMotion === true;
    this.highContrast = resolveHighContrast(
      this.#document,
      options.highContrast,
    );

    const container = this.#document.createElement("div");
    container.id = "four-a11y-mirror";
    container.setAttribute("data-four-a11y", "mirror");
    const style = ensureStyle(container);
    applyVisuallyHiddenStyle(style, this.fontScale);
    if (this.highContrast) {
      container.setAttribute("data-high-contrast", "true");
    }
    if (this.reducedMotion) {
      container.setAttribute("data-reduced-motion", "true");
      reducedMotionInstalls += 1;
      this.#ownsReducedMotion = true;
    }
    this.#document.body?.appendChild(container);
    this.root = container;

    this.#unsubscribe = registerAccessibilitySync((widget) => {
      if (!this.#disposed) this.sync(widget);
    });
    this.syncAll();
  }

  elementFor(widget: UIWidget): ElementLike | undefined {
    return this.#elements.get(widget);
  }

  sync(widget: UIWidget): void {
    if (this.#disposed) return;
    if (!isProjected(widget) || !isReachable(widget, this.#roots)) {
      this.#drop(widget);
      return;
    }
    let element = this.#elements.get(widget);
    const role = roleOf(widget);
    if (element === undefined) {
      element = this.#document.createElement(tagForRole(role));
      element.id = accessibilityElementId(widget);
      applyInputType(element, role);
      this.root.appendChild(element);
      this.#elements.set(widget, element);
    }
    writeProjection(element, widget, role);
  }

  syncAll(): void {
    if (this.#disposed) return;
    const live = new Set<UIWidget>();
    const collected: UIWidget[] = [];
    for (let i = 0; i < this.#roots.length; i += 1) {
      collectProjected(this.#roots[i], collected);
    }
    for (let i = 0; i < collected.length; i += 1) {
      const widget = collected[i];
      live.add(widget);
      this.sync(widget);
    }
    for (const widget of this.#elements.keys()) {
      if (!live.has(widget)) this.#drop(widget);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribe();
    this.#elements.clear();
    detach(this.root);
    if (this.#ownsReducedMotion && reducedMotionInstalls > 0) {
      reducedMotionInstalls -= 1;
      this.#ownsReducedMotion = false;
    }
  }

  #drop(widget: UIWidget): void {
    const element = this.#elements.get(widget);
    if (element === undefined) return;
    this.#elements.delete(widget);
    detach(element);
  }
}

function resolveDocument(explicit: DocumentLike | undefined): DocumentLike {
  if (explicit !== undefined) return explicit;
  const fallback = (globalThis as { document?: DocumentLike }).document;
  if (
    fallback !== undefined &&
    typeof fallback.createElement === "function" &&
    typeof fallback.getElementById === "function"
  ) {
    return fallback;
  }
  throw new Error(
    "installAccessibilityMirror: no DocumentLike available — pass " +
      "options.document in tests, or call from a browser that has document.",
  );
}

function resolveHighContrast(
  document: DocumentLike,
  explicit: boolean | undefined,
): boolean {
  if (explicit === true) return true;
  if (explicit === false) return false;
  const view = document.defaultView;
  if (
    view !== null &&
    view !== undefined &&
    typeof view.matchMedia === "function"
  ) {
    return view.matchMedia(CONTRAST_QUERY).matches;
  }
  if (typeof document.matchMedia === "function") {
    return document.matchMedia(CONTRAST_QUERY).matches;
  }
  return false;
}

function ensureStyle(element: ElementLike): ElementStyleLike {
  if (element.style === undefined) {
    element.style = {};
  }
  return element.style;
}

function applyVisuallyHiddenStyle(
  style: ElementStyleLike,
  fontScale: number,
): void {
  style.position = VISUALLY_HIDDEN.position;
  style.width = VISUALLY_HIDDEN.width;
  style.height = VISUALLY_HIDDEN.height;
  style.padding = VISUALLY_HIDDEN.padding;
  style.margin = VISUALLY_HIDDEN.margin;
  style.overflow = VISUALLY_HIDDEN.overflow;
  style.clip = VISUALLY_HIDDEN.clip;
  style.clipPath = VISUALLY_HIDDEN.clipPath;
  style.whiteSpace = VISUALLY_HIDDEN.whiteSpace;
  style.border = VISUALLY_HIDDEN.border;
  style.fontSize = `${String(fontScale)}em`;
}

function detach(element: ElementLike): void {
  if (typeof element.remove === "function") {
    element.remove();
    return;
  }
  const parent = element.parentNode;
  if (
    parent !== null &&
    parent !== undefined &&
    typeof parent.removeChild === "function"
  ) {
    parent.removeChild(element);
  }
}

function collectProjected(node: Node, out: UIWidget[]): void {
  if (!node.visible || !node.enabled) return;
  if (node instanceof UIWidget && isProjected(node)) {
    out.push(node);
  }
  const children = node.children;
  for (let i = 0; i < children.length; i += 1) {
    collectProjected(children[i], out);
  }
}

/**
 * Whether `widget` belongs in the projection: focusable, labelled, or carrying
 * (or inferring) a role. Disabled widgets stay — they are the ones
 * `aria-disabled` exists to announce — and disposed ones leave.
 */
function isProjected(widget: UIWidget): boolean {
  if (widget.disposed) return false;
  return (
    widget.focusable ||
    authoredLabel(widget) !== undefined ||
    roleOf(widget) !== undefined
  );
}

/** Whether `widget` still sits under one of the installed roots. */
function isReachable(widget: UIWidget, roots: readonly Node[]): boolean {
  for (let i = 0; i < roots.length; i += 1) {
    if (isUnderRoot(widget, roots[i])) return true;
  }
  return false;
}

/**
 * Walks from `node` to the tree top. Hidden or `enabled = false` ancestors
 * prune the same way `collectFocusOrder` does; `disabled` is not a prune —
 * it is a state the mirror announces.
 */
function isUnderRoot(node: Node, root: Node): boolean {
  let current: Node | null = node;
  while (current !== null) {
    if (!current.visible || !current.enabled) return false;
    if (current === root) return true;
    current = current.parent;
  }
  return false;
}

function authoredLabel(widget: UIWidget): string | undefined {
  const label = widget.label;
  return label === undefined || label === "" ? undefined : label;
}

function authoredDescription(widget: UIWidget): string | undefined {
  const description = widget.accessibility?.description;
  return description === undefined || description === ""
    ? undefined
    : description;
}

function roleOf(widget: UIWidget): string | undefined {
  const authored = widget.role;
  if (authored !== undefined && authored !== "") return authored;
  if (widget instanceof Slider) return "slider";
  if (widget instanceof ProgressIndicator) return "progressbar";
  if (widget instanceof RadioButton) return "radio";
  if (widget instanceof Checkbox) return "checkbox";
  if (widget instanceof Toggle) return "switch";
  if (widget instanceof Button) return "button";
  return undefined;
}

function tagForRole(role: string | undefined): string {
  switch (role) {
    case "button":
      return "button";
    case "checkbox":
    case "radio":
    case "slider":
    case "switch":
      return "input";
    case "progressbar":
      return "progress";
    default:
      return "div";
  }
}

function applyInputType(element: ElementLike, role: string | undefined): void {
  if (role === "checkbox" || role === "switch") {
    element.type = "checkbox";
  } else if (role === "radio") {
    element.type = "radio";
  } else if (role === "slider") {
    element.type = "range";
  }
}

function writeProjection(
  element: ElementLike,
  widget: UIWidget,
  role: string | undefined,
): void {
  if (role !== undefined) {
    element.setAttribute("role", role);
  } else {
    element.removeAttribute("role");
  }

  const label = authoredLabel(widget);
  if (label !== undefined) {
    element.setAttribute("aria-label", label);
  } else {
    element.removeAttribute("aria-label");
  }

  const description = authoredDescription(widget);
  if (description !== undefined) {
    element.setAttribute("aria-description", description);
  } else {
    element.removeAttribute("aria-description");
  }

  if (widget.disabled) {
    element.setAttribute("aria-disabled", "true");
    element.disabled = true;
  } else {
    element.removeAttribute("aria-disabled");
    element.disabled = false;
  }

  const checked = widget.checked;
  if (checked !== null) {
    element.setAttribute("aria-checked", checked ? "true" : "false");
    element.checked = checked;
  } else {
    element.removeAttribute("aria-checked");
  }

  const tabIndex = tabIndexOf(widget);
  element.tabIndex = tabIndex;
  element.setAttribute("tabindex", String(tabIndex));

  writeValue(element, widget);
}

function tabIndexOf(widget: UIWidget): number {
  const authored = widget.accessibility?.tabIndex;
  if (authored !== undefined) return authored;
  if (widget.focusable && !widget.disabled) return 0;
  return -1;
}

function writeValue(element: ElementLike, widget: UIWidget): void {
  if (widget instanceof Slider) {
    element.setAttribute("aria-valuemin", String(widget.min));
    element.setAttribute("aria-valuemax", String(widget.max));
    element.setAttribute("aria-valuenow", String(widget.value));
    return;
  }
  if (widget instanceof ProgressIndicator) {
    element.setAttribute("aria-valuemin", String(widget.min));
    element.setAttribute("aria-valuemax", String(widget.max));
    if (widget.indeterminate) {
      element.removeAttribute("aria-valuenow");
    } else {
      element.setAttribute("aria-valuenow", String(widget.value));
    }
    return;
  }
  element.removeAttribute("aria-valuemin");
  element.removeAttribute("aria-valuemax");
  element.removeAttribute("aria-valuenow");
}

/** Re-export so a reader of this module does not have to bounce to widget.ts. */
export type { WidgetAccessibility };
