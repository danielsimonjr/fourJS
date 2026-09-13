import { FourError, resetDevWarnings, type Component, type ComponentHost } from "@fourjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Group,
  Node,
  Scene,
  Transform,
  restoreNodeId,
  type NodeHierarchyEvent,
  type NodeType,
} from "../src/index.js";

/** A minimal §6a component; `host` is the plain mutable field core requires. */
class Marker implements Component {
  static readonly typeName = "test.marker";

  host: ComponentHost | null = null;

  attachedTo: ComponentHost | null = null;

  detachedFrom: ComponentHost | null = null;

  constructor(readonly label = "marker") {}

  onAttach(host: ComponentHost): void {
    this.attachedTo = host;
  }

  onDetach(host: ComponentHost): void {
    this.detachedFrom = host;
  }
}

/** A second component type, to prove one-per-*type* rather than one-per-node. */
class Other implements Component {
  static readonly typeName = "test.other";

  host: ComponentHost | null = null;
}

/** A distinct Node subclass, so `findByType` has something to discriminate. */
class Widget extends Group {}

/** Names in depth-first, insertion order — the §6 `traverse` contract. */
function traversalNames(root: Node): string[] {
  const names: string[] = [];
  root.traverse((node) => names.push(node.name));
  return names;
}

/** Builds `scene > a > (a1, a2), b`, naming every node after its variable. */
function buildTree(): {
  scene: Scene;
  a: Group;
  a1: Group;
  a2: Group;
  b: Group;
} {
  const scene = new Scene();
  scene.name = "scene";
  const a = new Group();
  a.name = "a";
  const a1 = new Group();
  a1.name = "a1";
  const a2 = new Group();
  a2.name = "a2";
  const b = new Group();
  b.name = "b";
  scene.add(a, b);
  a.add(a1, a2);
  return { scene, a, a1, a2, b };
}

describe("Node defaults (§6)", () => {
  it("starts empty, visible, enabled, opaque and unparented", () => {
    const node = new Group();

    expect(node.name).toBe("");
    expect(node.parent).toBeNull();
    expect(node.children).toEqual([]);
    expect(node.transform).toBeInstanceOf(Transform);
    expect(node.visible).toBe(true);
    expect(node.enabled).toBe(true);
    expect(node.opacity).toBe(1);
    expect(node.tags.size).toBe(0);
    expect(node.metadata).toEqual({});
  });

  it("gives every node its own tags, metadata and transform", () => {
    const first = new Group();
    const second = new Group();

    first.tags.add("sensor");
    first.metadata.role = "motor";
    first.transform.position.set(1, 2, 3);

    expect(second.tags.size).toBe(0);
    expect(second.metadata).toEqual({});
    expect(second.transform.position.x).toBe(0);
  });

  it("assigns unique, monotonically increasing ids without randomness", () => {
    const ids = Array.from({ length: 100 }, () => new Group().id);

    expect(new Set(ids).size).toBe(100);
    const ordinals = ids.map((id) => {
      expect(id).toMatch(/^node-\d+$/);
      return Number.parseInt(id.slice("node-".length), 10);
    });
    for (let i = 1; i < ordinals.length; i += 1) {
      expect(ordinals[i]).toBe(ordinals[i - 1] + 1);
    }
  });

  it("assigns ids across subclasses from the same counter", () => {
    const group = new Group();
    const scene = new Scene();

    expect(group.id).not.toBe(scene.id);
  });
});

describe("Node hierarchy (§6)", () => {
  it("adds children in insertion order and links parents", () => {
    const parent = new Group();
    const first = new Group();
    const second = new Group();

    expect(parent.add(first, second)).toBe(parent);
    expect(parent.children).toEqual([first, second]);
    expect(first.parent).toBe(parent);
    expect(second.parent).toBe(parent);

    const third = new Group();
    parent.add(third);
    expect(parent.children).toEqual([first, second, third]);
  });

  it("removes children, clearing the parent pointer", () => {
    const parent = new Group();
    const first = new Group();
    const second = new Group();
    parent.add(first, second);

    expect(parent.remove(first)).toBe(parent);
    expect(parent.children).toEqual([second]);
    expect(first.parent).toBeNull();
    expect(second.parent).toBe(parent);
  });

  it("ignores removal of a node that is not a child", () => {
    const parent = new Group();
    const child = new Group();
    const stranger = new Group();
    const other = new Group();
    parent.add(child);
    other.add(stranger);

    expect(() => parent.remove(stranger, new Group())).not.toThrow();
    expect(parent.children).toEqual([child]);
    expect(stranger.parent).toBe(other);
  });

  it("reparents by detaching from the previous parent first", () => {
    const from = new Group();
    const to = new Group();
    const child = new Group();
    const sibling = new Group();
    from.add(child, sibling);

    to.add(child);

    expect(from.children).toEqual([sibling]);
    expect(to.children).toEqual([child]);
    expect(child.parent).toBe(to);
  });

  it("treats re-adding an existing child as a no-op that keeps its index", () => {
    const parent = new Group();
    const first = new Group();
    const second = new Group();
    parent.add(first, second);

    parent.add(first);

    expect(parent.children).toEqual([first, second]);
  });

  it("reparents through the `parent` setter and detaches on null", () => {
    const from = new Group();
    const to = new Group();
    const child = new Group();
    from.add(child);

    child.parent = to;
    expect(to.children).toEqual([child]);
    expect(from.children).toEqual([]);

    child.parent = null;
    expect(child.parent).toBeNull();
    expect(to.children).toEqual([]);

    // Assigning the parent it already has changes nothing.
    to.add(child);
    child.parent = to;
    expect(to.children).toEqual([child]);
  });

  it("warns once when a detached node still has listeners (§83)", () => {
    resetDevWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const parent = new Group();
    const child = new Group();
    parent.add(child);
    child.on("removed", () => undefined);
    parent.remove(child);
    parent.add(child);
    parent.remove(child);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("listener");
  });

  it("exposes children as a live, insertion-ordered view", () => {
    const parent = new Group();
    const view = parent.children;
    const child = new Group();

    parent.add(child);

    expect(view).toEqual([child]);
  });
});

describe("Node cycle prevention (§85)", () => {
  function expectInvalidSceneGraph(action: () => void): void {
    expect(action).toThrow(FourError);
    try {
      action();
      expect.unreachable("expected INVALID_SCENE_GRAPH");
    } catch (error) {
      expect(error).toBeInstanceOf(FourError);
      expect((error as FourError).code).toBe("INVALID_SCENE_GRAPH");
    }
  }

  it("rejects adding a node to itself", () => {
    const node = new Group();

    expectInvalidSceneGraph(() => node.add(node));
    expect(node.children).toEqual([]);
    expect(node.parent).toBeNull();
  });

  it("rejects adding a node to its direct child", () => {
    const parent = new Group();
    const child = new Group();
    parent.add(child);

    expectInvalidSceneGraph(() => child.add(parent));
    expect(child.children).toEqual([]);
    expect(parent.children).toEqual([child]);
    expect(parent.parent).toBeNull();
  });

  it("rejects adding a node to a deep descendant", () => {
    const root = new Group();
    const middle = new Group();
    const leaf = new Group();
    const deeper = new Group();
    root.add(middle);
    middle.add(leaf);
    leaf.add(deeper);

    expectInvalidSceneGraph(() => deeper.add(root));
    expect(deeper.children).toEqual([]);
    expect(root.parent).toBeNull();
  });

  it("leaves earlier arguments attached when a later one is a cycle", () => {
    const root = new Group();
    const middle = new Group();
    const ok = new Group();
    root.add(middle);

    expect(() => middle.add(ok, root)).toThrow(FourError);
    expect(middle.children).toEqual([ok]);
    expect(root.children).toEqual([middle]);
  });

  it("still allows moving a node into an unrelated subtree", () => {
    const root = new Group();
    const branch = new Group();
    const leaf = new Group();
    root.add(branch, leaf);

    expect(() => branch.add(leaf)).not.toThrow();
    expect(branch.children).toEqual([leaf]);
  });
});

describe("Node.traverse (§6)", () => {
  it("visits self first, then children depth-first in insertion order", () => {
    const { scene } = buildTree();

    expect(traversalNames(scene)).toEqual(["scene", "a", "a1", "a2", "b"]);
  });

  it("visits only the subtree it is called on", () => {
    const { a } = buildTree();

    expect(traversalNames(a)).toEqual(["a", "a1", "a2"]);
  });

  it("visits a leaf exactly once", () => {
    const leaf = new Group();
    const visitor = vi.fn();

    leaf.traverse(visitor);

    expect(visitor).toHaveBeenCalledTimes(1);
    expect(visitor).toHaveBeenCalledWith(leaf);
  });
});

describe("Node events (§6b)", () => {
  it("emits `added` on the child after the mutation completes", () => {
    const parent = new Group();
    const child = new Group();
    const events: NodeHierarchyEvent[] = [];
    child.on("added", (event) => {
      events.push(event);
      expect(child.parent).toBe(parent);
      expect(parent.children).toEqual([child]);
    });

    parent.add(child);

    expect(events).toEqual([{ node: child, parent }]);
  });

  it("emits `removed` on the child after the mutation completes", () => {
    const parent = new Group();
    const child = new Group();
    parent.add(child);
    const events: NodeHierarchyEvent[] = [];
    child.on("removed", (event) => {
      events.push(event);
      expect(child.parent).toBeNull();
      expect(parent.children).toEqual([]);
    });

    parent.remove(child);

    expect(events).toEqual([{ node: child, parent }]);
  });

  it("does not emit on parents or ancestors", () => {
    const root = new Group();
    const parent = new Group();
    const child = new Group();
    root.add(parent);
    const onRoot = vi.fn();
    const onParent = vi.fn();
    root.on("added", onRoot);
    root.on("removed", onRoot);
    parent.on("added", onParent);
    parent.on("removed", onParent);

    parent.add(child);
    parent.remove(child);

    expect(onRoot).not.toHaveBeenCalled();
    expect(onParent).not.toHaveBeenCalled();
  });

  it("emits `removed` from the old parent before `added` when reparenting", () => {
    const from = new Group();
    const to = new Group();
    const child = new Group();
    from.add(child);
    const order: string[] = [];
    child.on("removed", (event) => {
      order.push(`removed:${event.parent === from ? "from" : "?"}`);
    });
    child.on("added", (event) => {
      order.push(`added:${event.parent === to ? "to" : "?"}`);
    });

    to.add(child);

    expect(order).toEqual(["removed:from", "added:to"]);
  });

  it("emits nothing when re-adding an existing child", () => {
    const parent = new Group();
    const child = new Group();
    parent.add(child);
    const listener = vi.fn();
    child.on("added", listener);
    child.on("removed", listener);

    parent.add(child);

    expect(listener).not.toHaveBeenCalled();
  });

  it("stops delivery through the unsubscriber (§6b)", () => {
    const parent = new Group();
    const child = new Group();
    const listener = vi.fn();
    const unsubscribe = child.on("added", listener);

    unsubscribe();
    parent.add(child);

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("Node components (§6a delegation)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("attaches, reads back and detaches a component through the node", () => {
    const node = new Group();
    const marker = new Marker();

    expect(node.addComponent(marker)).toBe(marker);
    expect(node.getComponent(Marker)).toBe(marker);
    expect(node.removeComponent(marker)).toBe(true);
    expect(node.getComponent(Marker)).toBeUndefined();
    expect(node.removeComponent(marker)).toBe(false);
  });

  it("passes the node itself as the component host (§6a `Component.node`)", () => {
    const node = new Group();
    const marker = new Marker();

    node.addComponent(marker);

    expect(marker.host).toBe(node);
    expect(marker.attachedTo).toBe(node);

    node.removeComponent(marker);

    expect(marker.detachedFrom).toBe(node);
    expect(marker.host).toBeNull();
  });

  it("keeps components per node", () => {
    const first = new Group();
    const second = new Group();
    const marker = new Marker();

    first.addComponent(marker);

    expect(second.getComponent(Marker)).toBeUndefined();
  });

  it("delegates the one-per-type replace-and-warn rule to the registry", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const node = new Group();
    const first = new Marker("first");
    const second = new Marker("second");
    const other = new Other();

    node.addComponent(first);
    node.addComponent(other);
    node.addComponent(second);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(node.getComponent(Marker)).toBe(second);
    expect(node.getComponent(Other)).toBe(other);
    expect(first.detachedFrom).toBe(node);
    expect(first.host).toBeNull();
  });

  // A-15 (2026-08-06): without enumeration a serializer can only probe for the
  // components it already knows about, so an unregistered one is dropped from a
  // save with nobody able to notice.
  it("enumerates its components in attach order (§6a, A-15)", () => {
    const node = new Group();
    const marker = new Marker();
    const other = new Other();

    expect([...node.components]).toEqual([]);

    node.addComponent(marker);
    node.addComponent(other);

    expect([...node.components]).toEqual([marker, other]);
  });

  it("enumerates live, so a detach is visible immediately", () => {
    const node = new Group();
    const marker = new Marker();
    const other = new Other();
    node.addComponent(marker);
    node.addComponent(other);

    node.removeComponent(marker);

    expect([...node.components]).toEqual([other]);
  });

  it("keeps a replaced component out of the enumeration", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const node = new Group();
    const first = new Marker("first");
    const second = new Marker("second");
    node.addComponent(first);
    node.addComponent(second);

    expect([...node.components]).toEqual([second]);
  });
});

/**
 * A-17 (2026-08-06): §79 restores a saved id, and the counter has to know
 * about it or the next node constructed can be handed the same one.
 */
describe("Node identity (§6, §79, A-17)", () => {
  it("assigns ascending engine ids by default", () => {
    const first = Number(/^node-(\d+)$/.exec(new Group().id)?.[1]);
    const second = Number(/^node-(\d+)$/.exec(new Group().id)?.[1]);

    expect(second).toBe(first + 1);
  });

  it("takes a restored id from the constructor and reserves it", () => {
    const restored = new Group({ id: "node-800000001" });

    expect(restored.id).toBe("node-800000001");
    expect(new Group().id).toBe("node-800000002");
  });

  it("never moves the counter backwards", () => {
    new Group({ id: "node-800000101" });
    const high = new Group().id;
    // An id below the counter is legal and used verbatim; it just reserves
    // nothing, because everything at or below it is already spent.
    new Group({ id: "node-1" });

    expect(Number(/^node-(\d+)$/.exec(new Group().id)?.[1])).toBe(
      Number(/^node-(\d+)$/.exec(high)?.[1]) + 1,
    );
  });

  it("accepts an opaque application id without touching the counter", () => {
    const before = Number(/^node-(\d+)$/.exec(new Group().id)?.[1]);
    const named = new Group({ id: "player-1" });

    expect(named.id).toBe("player-1");
    expect(Number(/^node-(\d+)$/.exec(new Group().id)?.[1])).toBe(before + 1);
  });

  it("restores an id onto an already-constructed node", () => {
    const node = new Group();
    restoreNodeId(node, "node-800000201");

    expect(node.id).toBe("node-800000201");
    expect(new Group().id).toBe("node-800000202");
  });

  it("passes the option through every node subclass", () => {
    expect(new Scene({ id: "scene-a" }).id).toBe("scene-a");
    expect(new Group({ id: "group-a" }).id).toBe("group-a");
  });

  // 2026-08-07: `Number.isSafeInteger(MAX_SAFE_INTEGER)` is true, so the
  // saturating id used to set the counter to 2 ** 53, where `+= 1` is a no-op —
  // every later node was handed the same id. The reservation is now skipped.
  it("keeps issuing distinct ids after a saturating restored id", () => {
    const saturating = new Group({
      id: `node-${String(Number.MAX_SAFE_INTEGER)}`,
    });

    expect(saturating.id).toBe(`node-${String(Number.MAX_SAFE_INTEGER)}`);
    const first = new Group().id;
    const second = new Group().id;
    expect(first).not.toBe(second);
    expect(Number(/^node-(\d+)$/.exec(second)?.[1])).toBe(
      Number(/^node-(\d+)$/.exec(first)?.[1]) + 1,
    );
  });
});

describe("Scene lookups (§46)", () => {
  it("finds a node by id, and returns null for an unknown id", () => {
    const { scene, a1 } = buildTree();

    expect(scene.findById(a1.id)).toBe(a1);
    expect(scene.findById("node-does-not-exist")).toBeNull();
  });

  it("finds a node by name, including the scene itself", () => {
    const { scene, b } = buildTree();

    expect(scene.findByName("b")).toBe(b);
    expect(scene.findByName("scene")).toBe(scene);
    expect(scene.findByName("nobody")).toBeNull();
  });

  it("returns the first match in traversal order for duplicate names", () => {
    const { scene, a1, a2 } = buildTree();
    a1.name = "twin";
    a2.name = "twin";

    expect(scene.findByName("twin")).toBe(a1);
  });

  it("finds a node by tag", () => {
    const { scene, a2 } = buildTree();
    a2.tags.add("sensor");

    expect(scene.findByTag("sensor")).toBe(a2);
    expect(scene.findByTag("actuator")).toBeNull();
  });

  it("finds a node by type with instanceof semantics", () => {
    const { scene, a } = buildTree();
    const widget = new Widget();
    widget.name = "widget";
    a.add(widget);

    expect(scene.findByType(Widget)).toBe(widget);
    // A subclass instance matches its base class, and the scene matches Node.
    expect(scene.findByType(Group)).toBe(a);
    expect(scene.findByType(Scene)).toBe(scene);
    // `NodeType` is an abstract constructor type, so the abstract base is a
    // legal argument.
    const abstractType: NodeType<Node> = Node;
    expect(scene.findByType(abstractType)).toBe(scene);
    expect(new Scene().findByType(Widget)).toBeNull();
  });

  it("finds a node by component", () => {
    const { scene, b } = buildTree();
    const marker = new Marker();
    b.addComponent(marker);

    const found = scene.findByComponent(Marker);
    expect(found).toBe(b);
    expect(found?.getComponent(Marker)).toBe(marker);
    expect(scene.findByComponent(Other)).toBeNull();
  });

  it("searches the scene node itself for every lookup", () => {
    const scene = new Scene();
    scene.name = "root";
    scene.tags.add("root-tag");
    const marker = new Marker();
    scene.addComponent(marker);

    expect(scene.findById(scene.id)).toBe(scene);
    expect(scene.findByName("root")).toBe(scene);
    expect(scene.findByTag("root-tag")).toBe(scene);
    expect(scene.findByComponent(Marker)).toBe(scene);
  });

  it("sees nodes added after the query and misses nodes removed", () => {
    const { scene, a, a1 } = buildTree();

    a.remove(a1);
    expect(scene.findById(a1.id)).toBeNull();

    const late = new Group();
    late.name = "late";
    a.add(late);
    expect(scene.findByName("late")).toBe(late);
  });
});

describe("Scene and Group as nodes", () => {
  it("are concrete Node subclasses usable in a hierarchy", () => {
    const scene = new Scene();
    const group = new Group();

    scene.add(group);

    expect(group).toBeInstanceOf(Node);
    expect(scene).toBeInstanceOf(Node);
    expect(scene.children).toEqual([group]);
  });
});

describe("node id reservation ceiling (§96, 2026-09-11)", () => {
  it("keeps a document id at or above 2^52 without parking the counter beside saturation", () => {
    const huge = new Group({ id: `node-${String(2 ** 52)}` });
    expect(huge.id).toBe(`node-${String(2 ** 52)}`);
    const a = Number(/^node-(\d+)$/.exec(new Group().id)?.[1]);
    const b = Number(/^node-(\d+)$/.exec(new Group().id)?.[1]);
    expect(b).toBe(a + 1);
    expect(a).toBeLessThan(2 ** 52);
  });
});
