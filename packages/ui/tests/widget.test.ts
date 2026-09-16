/**
 * The widget base (§73–§75): box model, layout plumbing, hit areas, the §72
 * interaction state machine, focus, skins, and disposal.
 *
 * Pointer events are synthesized exactly as `@fourjs/input`'s own suite does —
 * a real {@link ScenePointerEvent} pushed through `dispatchPointerEvent` along
 * a real propagation path — so the state machines are exercised against §72's
 * dispatch, not against a stand-in for it.
 */

import {
  ScenePointerEvent,
  buildPropagationPath,
  dispatchPointerEvent,
  type ScenePointerEventType,
} from "@fourjs/input";
import {
  Vector2,
  constructionCount,
  resetConstructionCount,
} from "@fourjs/math";
import { Group, type Node } from "@fourjs/scene";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Insets,
  UIWidget,
  UI_LAYOUT_AUTHORITY,
  UI_STAGED,
  applyInsets,
  collectPickables,
  focusedWidget,
  isUIWidget,
  type WidgetAccessibility,
  type WidgetSkin,
  type WidgetStateChangeEvent,
} from "../src/widget.js";

/** A concrete widget with an optional intrinsic size, for the base's own tests. */
class TestWidget extends UIWidget {
  intrinsicWidth = 0;

  intrinsicHeight = 0;

  override measureIntrinsic(out: Vector2): void {
    out.set(this.intrinsicWidth, this.intrinsicHeight);
  }
}

/** Dispatches one §72 event at `target` through the real propagation path. */
function dispatch(
  type: ScenePointerEventType,
  target: Node,
): ScenePointerEvent {
  const event = new ScenePointerEvent({
    type,
    pointerId: 1,
    ndcX: 0,
    ndcY: 0,
    target,
  });
  dispatchPointerEvent(event, buildPropagationPath(target));
  return event;
}

/** A skin that records the order of the hooks it received. */
function recordingSkin(): { skin: WidgetSkin; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    skin: {
      onAttach() {
        calls.push("attach");
      },
      onLayout() {
        calls.push("layout");
      },
      onStateChange() {
        calls.push("state");
      },
      onDetach() {
        calls.push("detach");
      },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Insets", () => {
  it("takes CSS's shorthand orders", () => {
    expect(new Insets(4)).toMatchObject({
      top: 4,
      right: 4,
      bottom: 4,
      left: 4,
    });
    expect(new Insets(1, 2)).toMatchObject({
      top: 1,
      right: 2,
      bottom: 1,
      left: 2,
    });
    expect(new Insets(1, 2, 3, 4)).toMatchObject({
      top: 1,
      right: 2,
      bottom: 3,
      left: 4,
    });
  });

  it("sets, copies, and sums its edges", () => {
    const insets = new Insets().set(1, 2, 3, 4);
    expect(insets.horizontal).toBe(6);
    expect(insets.vertical).toBe(4);

    const copy = new Insets().copy(insets);
    expect(copy).toMatchObject({ top: 1, right: 2, bottom: 3, left: 4 });
    expect(copy.set(5).top).toBe(5);
    expect(copy.right).toBe(5);
  });

  it("applies both init forms, defaulting omitted edges to zero", () => {
    const insets = new Insets();
    applyInsets(insets, 7);
    expect(insets).toMatchObject({ top: 7, right: 7, bottom: 7, left: 7 });

    applyInsets(insets, { top: 1, left: 2 });
    expect(insets).toMatchObject({ top: 1, right: 0, bottom: 0, left: 2 });

    applyInsets(insets, { right: 3, bottom: 4 });
    expect(insets).toMatchObject({ top: 0, right: 3, bottom: 4, left: 0 });
  });
});

describe("UIWidget construction", () => {
  it("defaults to constraint authority (§42) so a parent's layout may write it", () => {
    expect(new TestWidget().transformAuthority).toBe(UI_LAYOUT_AUTHORITY);
    expect(UI_LAYOUT_AUTHORITY).toBe("constraint");
  });

  it("applies every option", () => {
    const accessibility = { role: "button", label: "Go", tabIndex: 0 };
    const widget = new TestWidget({
      name: "go",
      visible: false,
      enabled: false,
      width: 10,
      height: 20,
      minWidth: 1,
      maxWidth: 100,
      minHeight: 2,
      maxHeight: 200,
      padding: 3,
      margin: { left: 4 },
      anchor: [0.5, 1],
      pivot: [0.25, 0.75],
      offset: [6, 7],
      grow: 2,
      interactive: false,
      focusable: true,
      disabled: true,
      accessibility,
    });

    expect(widget.name).toBe("go");
    expect(widget.visible).toBe(false);
    expect(widget.enabled).toBe(false);
    expect(widget.width).toBe(10);
    expect(widget.height).toBe(20);
    expect(widget.minWidth).toBe(1);
    expect(widget.maxWidth).toBe(100);
    expect(widget.minHeight).toBe(2);
    expect(widget.maxHeight).toBe(200);
    expect(widget.padding.top).toBe(3);
    expect(widget.margin.left).toBe(4);
    expect(widget.anchor.x).toBe(0.5);
    expect(widget.anchor.y).toBe(1);
    expect(widget.pivot.x).toBe(0.25);
    expect(widget.offset.y).toBe(7);
    expect(widget.grow).toBe(2);
    expect(widget.interactive).toBe(false);
    expect(widget.focusable).toBe(true);
    expect(widget.disabled).toBe(true);
    expect(widget.accessibility).toBe(accessibility);
    expect(widget.label).toBe("Go");
    expect(widget.role).toBe("button");
  });

  it("accepts a lone label and role without an accessibility record", () => {
    const widget = new TestWidget({ label: "Save", role: "button" });
    expect(widget.label).toBe("Save");
    expect(widget.role).toBe("button");
    expect(widget.accessibility).toEqual({ label: "Save", role: "button" });
  });

  it("constructs a record from a lone role", () => {
    const widget = new TestWidget({ role: "slider" });
    expect(widget.role).toBe("slider");
    expect(widget.accessibility).toEqual({ role: "slider" });
  });

  it("writes label and role through the existing accessibility record", () => {
    const accessibility: WidgetAccessibility = {
      description: "does the thing",
      tabIndex: 1,
    };
    const widget = new TestWidget({
      accessibility,
      label: "Go",
      role: "button",
    });
    expect(widget.accessibility).toBe(accessibility);
    expect(accessibility.label).toBe("Go");
    expect(accessibility.role).toBe("button");
    expect(accessibility.description).toBe("does the thing");
    widget.label = "Stop";
    expect(accessibility.label).toBe("Stop");
    expect(widget.accessibilityVersion).toBeGreaterThan(0);
    widget.role = undefined;
    expect(accessibility.role).toBeUndefined();
  });

  it("defaults everything else", () => {
    const widget = new TestWidget();
    expect(widget.width).toBeNull();
    expect(widget.height).toBeNull();
    expect(widget.minWidth).toBe(0);
    expect(widget.maxWidth).toBe(Infinity);
    expect(widget.grow).toBe(0);
    expect(widget.interactive).toBe(true);
    expect(widget.focusable).toBe(false);
    expect(widget.disabled).toBe(false);
    expect(widget.accessibility).toBeNull();
    expect(widget.label).toBeUndefined();
    expect(widget.role).toBeUndefined();
    expect(widget.accessibilityVersion).toBe(0);
    expect(widget.skin).toBeNull();
    expect(widget.disposed).toBe(false);
    expect(widget.layoutLeft).toBe(0);
    expect(widget.layoutTop).toBe(0);
  });
});

describe("measuring (§74)", () => {
  it("prefers the requested size and falls back to the intrinsic one", () => {
    const widget = new TestWidget();
    widget.intrinsicWidth = 30;
    widget.intrinsicHeight = 40;
    widget.measure();
    expect(widget.measuredWidth).toBe(30);
    expect(widget.measuredHeight).toBe(40);

    widget.width = 12;
    widget.measure();
    expect(widget.measuredWidth).toBe(12);
    expect(widget.measuredHeight).toBe(40);
  });

  it("clamps into [min, max] and never below zero", () => {
    const widget = new TestWidget({ width: 5, height: 500 });
    widget.minWidth = 10;
    widget.maxHeight = 100;
    widget.measure();
    expect(widget.measuredWidth).toBe(10);
    expect(widget.measuredHeight).toBe(100);

    widget.width = -50;
    widget.minWidth = 0;
    widget.measure();
    expect(widget.measuredWidth).toBe(0);
  });

  it("lets a max below the min lose — a size can never be under its minimum", () => {
    const widget = new TestWidget({ width: 50, minWidth: 30, maxWidth: 10 });
    widget.measure();
    expect(widget.measuredWidth).toBe(30);
  });

  it("measures enabled widget children first and skips disabled ones", () => {
    const parent = new TestWidget();
    const child = new TestWidget();
    child.intrinsicWidth = 9;
    const skipped = new TestWidget();
    skipped.intrinsicWidth = 9;
    skipped.enabled = false;
    parent.add(child, skipped, new Group());

    parent.measure();
    expect(child.measuredWidth).toBe(9);
    expect(skipped.measuredWidth).toBe(0);
  });

  it("subtracts padding from the content box, clamped at zero", () => {
    const widget = new TestWidget({ width: 100, height: 10, padding: 20 });
    widget.measure();
    expect(widget.contentWidth).toBe(60);
    expect(widget.contentHeight).toBe(0);

    const narrow = new TestWidget({ width: 10, height: 100, padding: 20 });
    narrow.measure();
    expect(narrow.contentWidth).toBe(0);
    expect(narrow.contentHeight).toBe(60);
  });
});

describe("arranging (§74, §42, §7a)", () => {
  it("writes (left, −top, z) and preserves z", () => {
    const widget = new TestWidget({ width: 4, height: 6 });
    widget.transform.position.set(0, 0, 0.25);
    widget.measure();
    widget.applyLayout(10, 20);

    expect(widget.layoutLeft).toBe(10);
    expect(widget.layoutTop).toBe(20);
    expect(widget.transform.position.x).toBe(10);
    expect(widget.transform.position.y).toBe(-20);
    expect(widget.transform.position.z).toBe(0.25);
  });

  it("refuses the write and warns once when another system owns the transform", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const widget = new TestWidget({ width: 4, height: 6 });
    widget.transformAuthority = "animation";
    widget.measure();
    widget.applyLayout(10, 20);
    widget.applyLayout(11, 21);

    expect(widget.transform.position.x).toBe(0);
    expect(widget.transform.position.y).toBe(0);
    // The size and the hit area are still resolved; only the position is not.
    expect(widget.measuredWidth).toBe(4);
    expect(widget.hitArea.boundsMax.x).toBe(4);
    expect(widget.layoutLeft).toBe(11);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("constraint");
  });

  it("leaves a root's own position alone", () => {
    const root = new TestWidget({ width: 4, height: 6 });
    root.transform.position.set(3, 5, 0);
    root.layout();
    expect(root.transform.position.x).toBe(3);
    expect(root.transform.position.y).toBe(5);
    expect(root.measuredWidth).toBe(4);
  });

  it("arranges nothing for a leaf", () => {
    const widget = new TestWidget({ width: 1, height: 1 });
    expect(() => {
      widget.layout();
    }).not.toThrow();
  });

  it("allocates no math objects in a warm layout pass (§7b)", () => {
    const root = new TestWidget({ width: 10, height: 10 });
    const child = new TestWidget({ width: 2, height: 2 });
    root.add(child);
    root.layout();

    resetConstructionCount();
    root.layout();
    child.applyLayout(1, 2);
    expect(constructionCount()).toBe(0);
  });
});

describe("hit areas (§71)", () => {
  it("spans (0, −height, 0) … (width, 0, 0) after layout", () => {
    const widget = new TestWidget({ width: 30, height: 12 });
    widget.layout();
    expect(widget.hitArea.node).toBe(widget);
    expect([
      widget.hitArea.boundsMin.x,
      widget.hitArea.boundsMin.y,
      widget.hitArea.boundsMin.z,
    ]).toEqual([0, -12, 0]);
    expect([
      widget.hitArea.boundsMax.x,
      widget.hitArea.boundsMax.y,
      widget.hitArea.boundsMax.z,
    ]).toEqual([30, 0, 0]);
  });

  it("keeps one stable Pickable object across layouts", () => {
    const widget = new TestWidget({ width: 1, height: 1 });
    const first = widget.hitArea;
    widget.layout();
    expect(widget.hitArea).toBe(first);
  });
});

describe("collectPickables", () => {
  it("walks root first, then depth-first in insertion order", () => {
    const root = new TestWidget({ name: "root" });
    const a = new TestWidget({ name: "a" });
    const b = new TestWidget({ name: "b" });
    const grandchild = new TestWidget({ name: "a1" });
    a.add(grandchild);
    root.add(a, b);

    const names = collectPickables(root).map((p) => p.node.name);
    expect(names).toEqual(["root", "a", "a1", "b"]);
  });

  it("prunes invisible and disabled subtrees, including plain groups", () => {
    const root = new TestWidget({ name: "root" });
    const hidden = new TestWidget({ name: "hidden", visible: false });
    hidden.add(new TestWidget({ name: "hidden-child" }));
    const off = new TestWidget({ name: "off", enabled: false });
    off.add(new TestWidget({ name: "off-child" }));
    const group = new Group();
    group.visible = false;
    group.add(new TestWidget({ name: "under-group" }));
    root.add(hidden, off, group);

    expect(collectPickables(root).map((p) => p.node.name)).toEqual(["root"]);
  });

  it("drops a non-interactive widget but keeps its children", () => {
    const root = new TestWidget({ name: "root", interactive: false });
    root.add(new TestWidget({ name: "child" }));
    expect(collectPickables(root).map((p) => p.node.name)).toEqual(["child"]);
  });

  it("reuses and truncates the supplied array without allocating", () => {
    const root = new TestWidget();
    const a = new TestWidget();
    const b = new TestWidget();
    root.add(a, b);
    const out = collectPickables(root, []);
    expect(out).toHaveLength(3);

    resetConstructionCount();
    b.visible = false;
    const again = collectPickables(root, out);
    expect(again).toBe(out);
    expect(again).toHaveLength(2);
    expect(constructionCount()).toBe(0);
  });

  it("narrows nodes with isUIWidget", () => {
    expect(isUIWidget(new TestWidget())).toBe(true);
    expect(isUIWidget(new Group())).toBe(false);
  });
});

describe("the §72 interaction state machine", () => {
  it("tracks hover, press, and release", () => {
    const widget = new TestWidget();
    dispatch("pointerenter", widget);
    expect(widget.hovered).toBe(true);

    dispatch("pointerdown", widget);
    expect(widget.pressed).toBe(true);

    dispatch("pointerup", widget);
    expect(widget.pressed).toBe(false);
    expect(widget.hovered).toBe(true);

    dispatch("pointerleave", widget);
    expect(widget.hovered).toBe(false);
  });

  it("clears the press when the pointer leaves mid-gesture", () => {
    const widget = new TestWidget();
    dispatch("pointerenter", widget);
    dispatch("pointerdown", widget);
    dispatch("pointerleave", widget);
    expect(widget.pressed).toBe(false);
    expect(widget.hovered).toBe(false);
  });

  it("observes bubbled events without reacting to them (§72, 2026-08-04)", () => {
    // Down/up state reactions are target-only: `pointerleave` is target-only
    // and a release over empty space dispatches nothing, so an ancestor that
    // set `pressed` from a bubbled down had no clearing path — it stuck
    // pressed forever. The ancestor still RECEIVES the bubbled event for its
    // own listeners; it just no longer mutates its widget state.
    const widget = new TestWidget();
    const child = new Group();
    widget.add(child);
    let observed = 0;
    widget.on("pointerdown", () => {
      observed += 1;
    });
    dispatch("pointerdown", child);
    expect(observed).toBe(1);
    expect(widget.pressed).toBe(false);
    expect(widget.focused).toBe(false);
  });

  it("drops focus when reparented into a (possibly different) scope (2026-08-04)", () => {
    const widget = new TestWidget({ focusable: true });
    widget.focus();
    expect(widget.focused).toBe(true);
    const root = new Group();
    root.add(widget);
    // The focus-owner registry is keyed by scope root, captured at focus
    // time; surviving the move would leave that record stale and allow two
    // focused widgets under one root. Mirrors the DOM: moving blurs.
    expect(widget.focused).toBe(false);
  });

  it("ignores pointers when non-interactive, disabled, or not enabled", () => {
    for (const widget of [
      new TestWidget({ interactive: false }),
      new TestWidget({ disabled: true }),
      new TestWidget({ enabled: false }),
    ]) {
      dispatch("pointerenter", widget);
      dispatch("pointerdown", widget);
      expect(widget.hovered).toBe(false);
      expect(widget.pressed).toBe(false);
    }
  });

  it("emits uistatechange exactly once per transition, with both snapshots", () => {
    const widget = new TestWidget();
    const events: WidgetStateChangeEvent[] = [];
    widget.on("uistatechange", (event) => events.push(event));

    dispatch("pointerenter", widget);
    dispatch("pointerenter", widget); // already hovered — no second event
    expect(events).toHaveLength(1);
    expect(events[0].widget).toBe(widget);
    expect(events[0].previous).toEqual({
      hovered: false,
      pressed: false,
      focused: false,
      disabled: false,
      checked: null,
    });
    expect(events[0].current).toEqual({
      hovered: true,
      pressed: false,
      focused: false,
      disabled: false,
      checked: null,
    });

    dispatch("pointerup", widget); // not pressed — nothing changes
    expect(events).toHaveLength(1);

    dispatch("pointerdown", widget);
    dispatch("pointerdown", widget); // already pressed
    expect(events).toHaveLength(2);

    dispatch("pointerleave", widget); // hovered and pressed clear together
    expect(events).toHaveLength(3);
    expect(events[2].current).toEqual({
      hovered: false,
      pressed: false,
      focused: false,
      disabled: false,
      checked: null,
    });

    dispatch("pointerleave", widget); // nothing left to clear
    expect(events).toHaveLength(3);
  });

  it("exposes the same flags through the state snapshot", () => {
    const widget = new TestWidget();
    dispatch("pointerenter", widget);
    expect(widget.state).toEqual({
      hovered: true,
      pressed: false,
      focused: false,
      disabled: false,
      // `null`, not `false`: a bare widget is not a checkable control (A-12).
      checked: null,
    });
  });

  it("clears hover and press when interactivity is switched off", () => {
    const widget = new TestWidget();
    const events: WidgetStateChangeEvent[] = [];
    widget.on("uistatechange", (event) => events.push(event));
    dispatch("pointerenter", widget);
    dispatch("pointerdown", widget);

    widget.interactive = false;
    expect(widget.hovered).toBe(false);
    expect(widget.pressed).toBe(false);
    expect(events).toHaveLength(3);

    widget.interactive = false; // idempotent
    widget.interactive = true; // back on, nothing else changes
    expect(events).toHaveLength(3);
  });

  it("clears hover, press, and focus when disabled, and blurs", () => {
    const widget = new TestWidget({ focusable: true });
    const blurs: unknown[] = [];
    const states: WidgetStateChangeEvent[] = [];
    widget.on("blur", (event) => blurs.push(event));
    widget.on("uistatechange", (event) => states.push(event));

    dispatch("pointerenter", widget);
    dispatch("pointerdown", widget);
    expect(widget.focused).toBe(true);

    states.length = 0;
    widget.disabled = true;
    expect(widget.hovered).toBe(false);
    expect(widget.pressed).toBe(false);
    expect(widget.focused).toBe(false);
    expect(focusedWidget(widget)).toBeNull();
    expect(blurs).toHaveLength(1);
    expect(states).toHaveLength(1);

    widget.disabled = true; // idempotent
    expect(states).toHaveLength(1);
  });
});

describe("focus (§75)", () => {
  it("ignores focus() unless the widget is focusable, enabled, and not disabled", () => {
    for (const widget of [
      new TestWidget(),
      new TestWidget({ focusable: true, disabled: true }),
      new TestWidget({ focusable: true, enabled: false }),
    ]) {
      widget.focus();
      expect(widget.focused).toBe(false);
    }
  });

  it("moves focus within one scene root, blurring the previous holder", () => {
    const root = new Group();
    const first = new TestWidget({ focusable: true });
    const second = new TestWidget({ focusable: true });
    root.add(first, second);

    const focusEvents: { target: Node; related: Node | null }[] = [];
    const blurEvents: { target: Node; related: Node | null }[] = [];
    first.on("blur", (event) => blurEvents.push(event));
    second.on("focus", (event) => focusEvents.push(event));

    first.focus();
    expect(focusedWidget(root)).toBe(first);
    expect(focusedWidget(second)).toBe(first);

    second.focus();
    expect(first.focused).toBe(false);
    expect(second.focused).toBe(true);
    expect(focusedWidget(root)).toBe(second);
    expect(blurEvents[0].related).toBe(second);
    expect(focusEvents[0].target).toBe(second);
    expect(focusEvents[0].related).toBe(first);

    second.focus(); // already focused — no-op
    expect(focusEvents).toHaveLength(1);
  });

  it("keeps detached trees in separate focus scopes", () => {
    const a = new TestWidget({ focusable: true });
    const b = new TestWidget({ focusable: true });
    a.focus();
    b.focus();
    expect(a.focused).toBe(true);
    expect(b.focused).toBe(true);
    expect(focusedWidget(a)).toBe(a);
    expect(focusedWidget(b)).toBe(b);
  });

  it("blurs on request and does nothing when unfocused", () => {
    const widget = new TestWidget({ focusable: true });
    const blurs: unknown[] = [];
    widget.on("blur", (event) => blurs.push(event));

    widget.blur();
    expect(blurs).toHaveLength(0);

    widget.focus();
    widget.blur();
    expect(widget.focused).toBe(false);
    expect(focusedWidget(widget)).toBeNull();
    expect(blurs).toHaveLength(1);
    widget.blur();
    expect(blurs).toHaveLength(1);
  });

  it("does not focus a widget a pointer presses unless it is focusable", () => {
    const plain = new TestWidget();
    dispatch("pointerdown", plain);
    expect(plain.focused).toBe(false);
  });
});

describe("skins", () => {
  it("runs attach, layout, and state on assignment so a late skin is not stale", () => {
    const widget = new TestWidget({ width: 5, height: 5 });
    widget.layout();
    const { skin, calls } = recordingSkin();

    widget.skin = skin;
    expect(widget.skin).toBe(skin);
    expect(calls).toEqual(["attach", "layout", "state"]);
  });

  it("notifies on every layout and every state change", () => {
    const widget = new TestWidget({ width: 5, height: 5 });
    const { skin, calls } = recordingSkin();
    widget.skin = skin;
    calls.length = 0;

    widget.layout();
    expect(calls).toEqual(["layout"]);

    dispatch("pointerenter", widget);
    expect(calls).toEqual(["layout", "state"]);
  });

  it("detaches the previous skin, ignores a repeat assignment, and accepts null", () => {
    const widget = new TestWidget();
    const first = recordingSkin();
    const second = recordingSkin();

    widget.skin = first.skin;
    widget.skin = first.skin; // same object — no hooks
    expect(first.calls).toEqual(["attach", "layout", "state"]);

    widget.skin = second.skin;
    expect(first.calls).toEqual(["attach", "layout", "state", "detach"]);
    expect(second.calls).toEqual(["attach", "layout", "state"]);

    widget.skin = null;
    expect(second.calls).toEqual(["attach", "layout", "state", "detach"]);
    expect(widget.skin).toBeNull();
  });

  it("tolerates a skin with no hooks at all", () => {
    const widget = new TestWidget({ width: 1, height: 1 });
    widget.skin = {};
    expect(() => {
      widget.layout();
      dispatch("pointerenter", widget);
    }).not.toThrow();
  });
});

describe("dispose (§83)", () => {
  it("blurs, detaches the skin, stops listening, and is idempotent", () => {
    const widget = new TestWidget({ focusable: true });
    const { skin, calls } = recordingSkin();
    widget.skin = skin;
    widget.focus();

    widget.dispose();
    expect(widget.disposed).toBe(true);
    expect(widget.focused).toBe(false);
    expect(focusedWidget(widget)).toBeNull();
    expect(calls.at(-1)).toBe("detach");
    expect(widget.skin).toBeNull();

    dispatch("pointerenter", widget);
    dispatch("pointerdown", widget);
    expect(widget.hovered).toBe(false);
    expect(widget.pressed).toBe(false);

    widget.dispose();
    expect(widget.disposed).toBe(true);
  });

  it("refuses to take focus once disposed", () => {
    const widget = new TestWidget({ focusable: true });
    widget.dispose();
    widget.focus();
    expect(widget.focused).toBe(false);
  });
});

describe("UI_STAGED (§73–§75)", () => {
  it("names every staged area with a dated note", () => {
    expect(UI_STAGED.length).toBeGreaterThan(0);
    for (const entry of UI_STAGED) {
      // A date, not one fixed date: the §73 entry was narrowed on 2026-08-07
      // (A-12) and carries both the original staging date and the narrowing.
      expect(entry).toMatch(/2026-\d\d-\d\d/);
    }
    expect(Object.isFrozen(UI_STAGED)).toBe(true);
  });

  it("records the remaining layout gaps and the reduced-motion consumer note", () => {
    const text = UI_STAGED.join("\n");
    expect(text).toContain("reduced motion");
    expect(text).toContain("grid");
    expect(text).toContain("percentages");
  });

  it("no longer stages the §75 DOM mirror, which shipped (A-13 remainder)", () => {
    // The hidden-mirror / screen-reader / high-contrast / scalable-text
    // entries left the array when `installAccessibilityMirror` landed.
    const text = UI_STAGED.join("\n");
    expect(text).not.toContain("DOM integration");
    expect(text).not.toContain("hidden DOM accessibility mirror");
    expect(text).not.toContain("WidgetAccessibility data ships");
    expect(text).not.toContain("screen-reader updates, high-contrast");
  });

  it("no longer stages §75 keyboard navigation, which shipped (A-13)", () => {
    // The entry left the array when `keyboard.ts` and `Button`'s Enter/Space
    // listener landed; an entry that outlives the gap it records is exactly the
    // drift this array exists to prevent.
    for (const entry of UI_STAGED) {
      expect(entry).not.toContain("keyboard navigation");
    }
  });

  it("no longer stages the six §73 controls that shipped (A-12)", () => {
    // Same rule, applied to the controls half: toggle, checkbox, radio button,
    // slider, progress indicator, and image are implemented, so the staging
    // note must not still claim them. What it must still claim is the four
    // names that are genuinely blocked, each with its blocker.
    const text = UI_STAGED.join("\n");
    // The pre-A-12 wording, which claimed all thirteen and promised that each
    // "needs no new engine surface" — the second half of which was false for
    // four of them.
    expect(text).not.toContain("toggle, checkbox, radio control");
    expect(text).not.toContain("needs no new engine surface");
    expect(text).toContain("shipped beside panel, label, and button");
    expect(text).toContain("text input");
    expect(text).toContain("scroll view");
    expect(text).toContain("§48 nested render surface");
    expect(text).toContain("§56 selection and caret");
    // Tooltip and menu are staged on the missing update hook, not on effort.
    expect(text).toContain("per-frame update hook");
  });
});
