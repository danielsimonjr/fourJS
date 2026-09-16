/**
 * The keyboard source and its events (§72, A-10) — driven entirely without a
 * DOM: a fake surface records the listeners `KeyboardInput` registers and feeds
 * it synthetic `{ key, code, …Key, repeat }` events, exactly as
 * `pointer.test.ts` does for pointers.
 */

import { FourError } from "@fourjs/core";
import { Group, type Node } from "@fourjs/scene";
import { describe, expect, it, vi } from "vitest";

import {
  SceneKeyEvent,
  dispatchKeyEvent,
  type SceneKeyEventType,
} from "../src/key-events.js";
import {
  KeyboardInput,
  type KeyboardInputOptions,
  type KeySurface,
  type SurfaceKeyEvent,
  type SurfaceKeyListener,
} from "../src/keyboard-input.js";
import { buildPropagationPath } from "../src/propagation.js";

/** A key surface with no DOM behind it. */
class FakeKeySurface implements KeySurface {
  readonly listeners = new Map<string, SurfaceKeyListener[]>();

  /** Every platform event this surface has had `preventDefault` called on. */
  readonly prevented: SurfaceKeyEvent[] = [];

  addEventListener(type: string, listener: SurfaceKeyListener): void {
    const existing = this.listeners.get(type);
    if (existing === undefined) {
      this.listeners.set(type, [listener]);
    } else {
      existing.push(listener);
    }
  }

  removeEventListener(type: string, listener: SurfaceKeyListener): void {
    const existing = this.listeners.get(type);
    if (existing === undefined) {
      return;
    }
    const index = existing.indexOf(listener);
    if (index !== -1) {
      existing.splice(index, 1);
    }
  }

  /** Total live registrations, for the dispose test. */
  get listenerCount(): number {
    let count = 0;
    for (const listeners of this.listeners.values()) {
      count += listeners.length;
    }
    return count;
  }

  /** Fires one platform event, filling in the fields the test did not state. */
  fire(
    type: string,
    key: string,
    overrides: Partial<Omit<SurfaceKeyEvent, "preventDefault">> = {},
  ): SurfaceKeyEvent {
    const event: SurfaceKeyEvent = {
      key,
      code: key,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
      ...overrides,
      preventDefault: () => {
        this.prevented.push(event);
      },
    };
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
    return event;
  }
}

/** A parent and child, plus a log of every key event either sees, in order. */
function tree(): {
  parent: Group;
  child: Group;
  log: string[];
} {
  const parent = new Group();
  parent.name = "parent";
  const child = new Group();
  child.name = "child";
  parent.add(child);
  const log: string[] = [];
  for (const node of [parent, child]) {
    for (const key of [
      "capture:keydown",
      "keydown",
      "capture:keyup",
      "keyup",
    ] as const) {
      node.on(key, () => log.push(`${node.name}:${key}`));
    }
  }
  return { parent, child, log };
}

/** Builds one scene key event with the fields a test cares about. */
function keyEvent(
  type: SceneKeyEventType,
  key: string,
  target: Node | null,
): SceneKeyEvent {
  return new SceneKeyEvent({ type, key, code: key, target });
}

describe("SceneKeyEvent", () => {
  it("carries the normalized key, code, modifiers, and repeat", () => {
    const event = new SceneKeyEvent({
      type: "keydown",
      key: "A",
      code: "KeyA",
      modifiers: { shift: true },
      repeat: true,
      target: null,
    });

    expect(event.type).toBe("keydown");
    expect(event.key).toBe("A");
    expect(event.code).toBe("KeyA");
    expect(event.modifiers).toEqual({
      alt: false,
      ctrl: false,
      meta: false,
      shift: true,
    });
    expect(event.repeat).toBe(true);
    expect(event.target).toBeNull();
  });

  it("defaults every modifier and the repeat flag to false", () => {
    const event = keyEvent("keyup", "Escape", null);

    expect(event.modifiers).toEqual({
      alt: false,
      ctrl: false,
      meta: false,
      shift: false,
    });
    expect(event.repeat).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it("normalizes each modifier independently", () => {
    const all = new SceneKeyEvent({
      type: "keydown",
      key: "s",
      code: "KeyS",
      modifiers: { alt: true, ctrl: true, meta: true, shift: true },
      target: null,
    });

    expect(all.modifiers).toEqual({
      alt: true,
      ctrl: true,
      meta: true,
      shift: true,
    });

    // …and every one of the four is independently defaulted when omitted.
    const alt = new SceneKeyEvent({
      type: "keydown",
      key: "s",
      code: "KeyS",
      modifiers: { alt: true },
      target: null,
    });

    expect(alt.modifiers).toEqual({
      alt: true,
      ctrl: false,
      meta: false,
      shift: false,
    });
  });

  it("forwards preventDefault to the platform event behind it", () => {
    const preventDefault = vi.fn();
    const event = new SceneKeyEvent({
      type: "keydown",
      key: "Tab",
      code: "Tab",
      target: null,
      platformEvent: { preventDefault },
    });

    event.preventDefault();

    expect(event.defaultPrevented).toBe(true);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("records the request when there is no platform event to forward to", () => {
    const bare = keyEvent("keydown", "Tab", null);
    bare.preventDefault();
    expect(bare.defaultPrevented).toBe(true);

    // A platform event that has no `preventDefault` of its own is equally fine:
    // the field is optional precisely so a test double need not fake one.
    const noSuppressor = new SceneKeyEvent({
      type: "keydown",
      key: "Tab",
      code: "Tab",
      target: null,
      platformEvent: {},
    });
    noSuppressor.preventDefault();
    expect(noSuppressor.defaultPrevented).toBe(true);
  });

  it("keeps preventDefault and stopPropagation independent", () => {
    const event = keyEvent("keydown", "Enter", null);

    event.preventDefault();
    expect(event.propagationStopped).toBe(false);

    event.stopPropagation();
    expect(event.defaultPrevented).toBe(true);
    expect(event.propagationStopped).toBe(true);
  });
});

describe("dispatchKeyEvent — capture, target, bubble (§72)", () => {
  it("descends root-first then bubbles target-first", () => {
    const { child, log } = tree();

    dispatchKeyEvent(
      keyEvent("keydown", "a", child),
      buildPropagationPath(child),
    );

    expect(log).toEqual([
      "parent:capture:keydown",
      "child:capture:keydown",
      "child:keydown",
      "parent:keydown",
    ]);
  });

  it("dispatches keyup on its own keys", () => {
    const { child, log } = tree();

    dispatchKeyEvent(
      keyEvent("keyup", "a", child),
      buildPropagationPath(child),
    );

    expect(log).toEqual([
      "parent:capture:keyup",
      "child:capture:keyup",
      "child:keyup",
      "parent:keyup",
    ]);
  });

  it("truncates the bubble phase at the node that stopped propagation", () => {
    const { parent, child } = tree();
    const seen: string[] = [];
    child.on("keydown", (event) => {
      seen.push("child");
      event.stopPropagation();
    });
    parent.on("keydown", () => seen.push("parent"));

    dispatchKeyEvent(
      keyEvent("keydown", "a", child),
      buildPropagationPath(child),
    );

    expect(seen).toEqual(["child"]);
  });

  it("stops the descent, so the target never sees a captured event", () => {
    const parent = new Group();
    const child = new Group();
    parent.add(child);
    const seen: string[] = [];
    parent.on("capture:keydown", (event) => {
      seen.push("parent-capture");
      event.stopPropagation();
    });
    child.on("capture:keydown", () => seen.push("child-capture"));
    child.on("keydown", () => seen.push("child-target"));

    dispatchKeyEvent(
      keyEvent("keydown", "a", child),
      buildPropagationPath(child),
    );

    expect(seen).toEqual(["parent-capture"]);
  });

  it("dispatches nothing along an empty path", () => {
    const listener = vi.fn();
    const node = new Group();
    node.on("keydown", listener);

    dispatchKeyEvent(keyEvent("keydown", "a", node), []);

    expect(listener).not.toHaveBeenCalled();
  });

  it("reports the resolved node as target at every node on the path", () => {
    const { parent, child } = tree();
    const targets: (Node | null)[] = [];
    parent.on("keydown", (event) => targets.push(event.target));
    child.on("keydown", (event) => targets.push(event.target));

    dispatchKeyEvent(
      keyEvent("keydown", "a", child),
      buildPropagationPath(child),
    );

    expect(targets).toEqual([child, child]);
  });
});

describe("KeyboardInput", () => {
  it("refuses a malformed options object with a message that names the call shape", () => {
    const surface = new FakeKeySurface();

    // The natural mistake: one options object, the way most of four's constructors read.
    // This used to throw `TypeError: Cannot read properties of undefined (reading
    // 'focusTarget')` -- an internal property access naming a private field, with no hint
    // of the real signature.
    expect(
      () =>
        new KeyboardInput(
          { surface } as unknown as KeySurface,
          undefined as unknown as KeyboardInputOptions,
        ),
    ).toThrow(/focusTarget/);
    expect(
      () =>
        new KeyboardInput(
          { surface } as unknown as KeySurface,
          undefined as unknown as KeyboardInputOptions,
        ),
    ).toThrow(FourError);

    // A present-but-not-callable focusTarget is the same mistake one step later.
    expect(
      () =>
        new KeyboardInput(surface, {
          focusTarget: null as unknown as () => Node | null,
        }),
    ).toThrow(FourError);

    // Control: the correct shape still constructs.
    expect(
      () => new KeyboardInput(surface, { focusTarget: () => null }),
    ).not.toThrow();
  });

  it("subscribes to keydown and keyup", () => {
    const surface = new FakeKeySurface();
    new KeyboardInput(surface, { focusTarget: () => null });

    expect([...surface.listeners.keys()].sort()).toEqual(["keydown", "keyup"]);
    expect(surface.listenerCount).toBe(2);
  });

  it("routes a platform keydown to the focused node, through the path", () => {
    const surface = new FakeKeySurface();
    const { parent, child, log } = tree();
    new KeyboardInput(surface, { focusTarget: () => child });

    surface.fire("keydown", "a");

    expect(log).toEqual([
      "parent:capture:keydown",
      "child:capture:keydown",
      "child:keydown",
      "parent:keydown",
    ]);
    // The ancestor is on the path but is not the target.
    const targets: (Node | null)[] = [];
    parent.on("keydown", (event) => targets.push(event.target));
    surface.fire("keydown", "b");
    expect(targets).toEqual([child]);
  });

  it("normalizes the platform's modifier spelling and repeat flag", () => {
    const surface = new FakeKeySurface();
    const focused = new Group();
    const seen: SceneKeyEvent[] = [];
    focused.on("keydown", (event) => seen.push(event));
    new KeyboardInput(surface, { focusTarget: () => focused });

    surface.fire("keydown", "A", {
      code: "KeyA",
      shiftKey: true,
      ctrlKey: true,
      repeat: true,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].key).toBe("A");
    expect(seen[0].code).toBe("KeyA");
    expect(seen[0].modifiers).toEqual({
      alt: false,
      ctrl: true,
      meta: false,
      shift: true,
    });
    expect(seen[0].repeat).toBe(true);
  });

  it("routes keyup as its own type", () => {
    const surface = new FakeKeySurface();
    const focused = new Group();
    const seen: string[] = [];
    focused.on("keyup", (event) => seen.push(event.type));
    new KeyboardInput(surface, { focusTarget: () => focused });

    surface.fire("keyup", "a");

    expect(seen).toEqual(["keyup"]);
  });

  it("dispatches nothing when the resolver reports no focus", () => {
    const surface = new FakeKeySurface();
    const node = new Group();
    const listener = vi.fn();
    node.on("keydown", listener);
    new KeyboardInput(surface, { focusTarget: () => null });

    surface.fire("keydown", "a");

    expect(listener).not.toHaveBeenCalled();
  });

  it("asks the resolver again on every event, so a moved focus is honoured", () => {
    const surface = new FakeKeySurface();
    const first = new Group();
    const second = new Group();
    let focused: Node = first;
    const seen: string[] = [];
    first.on("keydown", () => seen.push("first"));
    second.on("keydown", () => seen.push("second"));
    new KeyboardInput(surface, { focusTarget: () => focused });

    surface.fire("keydown", "Tab");
    focused = second;
    surface.fire("keydown", "Tab");

    expect(seen).toEqual(["first", "second"]);
  });

  it("resolves the target before dispatch, so a listener cannot redirect its own event", () => {
    const surface = new FakeKeySurface();
    const first = new Group();
    const second = new Group();
    let focused: Node = first;
    const seen: string[] = [];
    first.on("keydown", () => {
      seen.push("first");
      focused = second; // …exactly what Tab traversal does.
    });
    second.on("keydown", () => seen.push("second"));
    new KeyboardInput(surface, { focusTarget: () => focused });

    surface.fire("keydown", "Tab");

    expect(seen).toEqual(["first"]);
  });

  it("forwards a listener's preventDefault to the platform event", () => {
    const surface = new FakeKeySurface();
    const focused = new Group();
    focused.on("keydown", (event) => {
      event.preventDefault();
    });
    new KeyboardInput(surface, { focusTarget: () => focused });

    const platform = surface.fire("keydown", "Tab");

    expect(surface.prevented).toEqual([platform]);
  });

  it("leaves the platform default alone when nothing consumed the key", () => {
    const surface = new FakeKeySurface();
    const focused = new Group();
    new KeyboardInput(surface, { focusTarget: () => focused });

    surface.fire("keydown", "Tab");

    expect(surface.prevented).toEqual([]);
  });

  it("removes every listener on dispose, idempotently", () => {
    const surface = new FakeKeySurface();
    const focused = new Group();
    const listener = vi.fn();
    focused.on("keydown", listener);
    const input = new KeyboardInput(surface, { focusTarget: () => focused });

    input.dispose();
    input.dispose();

    expect(surface.listenerCount).toBe(0);
    surface.fire("keydown", "a");
    expect(listener).not.toHaveBeenCalled();
  });

  // 2026-08-07 (§83): removing the surface listeners is not the whole of being
  // disposed — a surface may deliver an event that was already queued, and a
  // retained listener can be called outright. Neither may reach the focus
  // resolver or the scene afterwards.
  it("is inert for an event delivered after dispose", () => {
    const surface = new FakeKeySurface();
    const focused = new Group();
    const listener = vi.fn();
    const focusTarget = vi.fn(() => focused as Node | null);
    focused.on("keydown", listener);
    const input = new KeyboardInput(surface, { focusTarget });
    const retained = surface.listeners.get("keydown")?.[0];

    input.dispose();
    retained?.({
      key: "a",
      code: "KeyA",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
    });

    expect(listener).not.toHaveBeenCalled();
    expect(focusTarget).not.toHaveBeenCalled();
  });
});

describe("NodeEventMap augmentation — key events (§6b)", () => {
  it("types key events on any node, and rejects unknown keys", () => {
    const node = new Group();

    node.on("keydown", (event) => {
      // Type-level: the listener parameter really is a SceneKeyEvent.
      const key: string = event.key;
      expect(key).toBe("a");
    });
    node.on("capture:keyup", (event) => {
      expect(event.type).toBe("keyup");
    });

    // @ts-expect-error — an unknown key is still rejected after the widening.
    node.on("keypress", () => undefined);

    dispatchKeyEvent(
      keyEvent("keydown", "a", node),
      buildPropagationPath(node),
    );
    dispatchKeyEvent(keyEvent("keyup", "a", node), buildPropagationPath(node));
  });
});
