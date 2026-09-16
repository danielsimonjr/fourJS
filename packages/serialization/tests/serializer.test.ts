/**
 * Scene ⇄ document (§79), plan P11-1 — the registry, the writer, the reader,
 * and the round-trip gate.
 *
 * The gate this file exists for: build a scene tree (groups, transforms with
 * §42 authorities, `PoseTarget`s), serialize it, push it through JSON *text*,
 * parse it, instantiate it, and serialize the result — the two documents must be
 * textually identical, and every restored transform must be bit-equal to the one
 * that was saved. Everything else here is a documented decision with a test
 * attached: node types by exact class identity, ids restored per §79, unknown
 * component policy, unknown node types, and the registry's own refusals.
 */

import { FourError, isFourError, type ComponentHost } from "@fourjs/core";
import { Group, PoseTarget, Scene, type Node } from "@fourjs/scene";
import { describe, expect, it } from "vitest";

import {
  ComponentSerializerRegistry,
  GROUP_NODE_TYPE,
  POSE_TARGET_SERIALIZER,
  SCENE_NODE_TYPE,
  applyTransformDocument,
  asJsonObject,
  createDefaultComponentSerializers,
  decodeSceneDocument,
  encodeSceneDocument,
  instantiateScene,
  instantiateSceneNodes,
  serializeScene,
  validateSceneDocument,
  type ComponentSerializer,
  type JsonValue,
  type SceneDocument,
} from "../src/index.js";

/** A component this package cannot see — the stand-in for a plugin's own. */
class Health {
  static readonly typeName = "com.example.health";

  host: ComponentHost | null = null;

  hp: number;

  constructor(hp = 1) {
    this.hp = hp;
  }
}

const HEALTH_SERIALIZER: ComponentSerializer<Health> = {
  serialize(component: Health): JsonValue {
    return { hp: component.hp };
  },
  deserialize(data: JsonValue): Health {
    const record = asJsonObject(data, "health");
    return new Health(typeof record.hp === "number" ? record.hp : 0);
  },
};

/**
 * The scene the round-trip gate runs on: a `Scene` root with two groups, an
 * awkward-but-exact set of transform values, both §42 authorities that matter
 * here, tags, metadata, and two components.
 */
function buildScene(): Scene {
  const scene = new Scene();
  scene.name = "level";
  scene.tags.add("root").add("persistent");
  scene.metadata = {
    author: "test",
    counts: [1, 2, 3],
    nested: { deep: true },
  };
  scene.transform.position.set(0.1 + 0.2, -1 / 3, 1e-7);

  const animated = new Group();
  animated.name = "animated";
  animated.transformAuthority = "blended";
  animated.transform.rotation.set(0, Math.SQRT1_2, 0, Math.SQRT1_2);
  animated.transform.scale.set(2, 0.5, 1);
  animated.transform.pivot.set(0, 1, 0);
  animated.opacity = 0.25;
  animated.visible = false;
  const target = animated.addComponent(new PoseTarget());
  target.position.set(1, 2, 3);
  target.rotation.set(0, 0, Math.SQRT1_2, Math.SQRT1_2);

  const physical = new Group();
  physical.name = "physical";
  physical.transformAuthority = "physics";
  physical.enabled = false;
  physical.addComponent(new Health(7));

  const child = new Group();
  child.name = "leaf";
  child.transform.position.set(0, -9.81, 0);
  physical.add(child);

  scene.add(animated, physical);
  return scene;
}

function registry(): ComponentSerializerRegistry {
  return createDefaultComponentSerializers().register(
    Health,
    HEALTH_SERIALIZER,
  );
}

/**
 * The components of a vector or quaternion as a plain object.
 *
 * Comparing the math objects themselves would compare their change hooks (plan
 * D3 installs a distinct closure per owner), which are not state.
 */
function components(
  v: { x: number; y: number; z: number } | { w: number },
): Record<string, number> {
  const source = v as Record<string, number>;
  const copy: Record<string, number> = {};
  for (const key of ["x", "y", "z", "w"]) {
    if (typeof source[key] === "number") {
      copy[key] = source[key];
    }
  }
  return copy;
}

/** Every transform field of every node, depth-first — the bit-equality probe. */
function transformValues(root: Node): number[] {
  const values: number[] = [];
  root.traverse((node) => {
    const t = node.transform;
    values.push(
      t.position.x,
      t.position.y,
      t.position.z,
      t.rotation.x,
      t.rotation.y,
      t.rotation.z,
      t.rotation.w,
      t.scale.x,
      t.scale.y,
      t.scale.z,
      t.pivot.x,
      t.pivot.y,
      t.pivot.z,
    );
  });
  return values;
}

describe("ComponentSerializerRegistry", () => {
  it("reports what it holds, in registration order", () => {
    const serializers = registry();

    expect(serializers.size).toBe(2);
    expect([...serializers.typeNames]).toEqual([
      PoseTarget.typeName,
      Health.typeName,
    ]);
    expect(serializers.has(Health.typeName)).toBe(true);
    expect(serializers.has("nope")).toBe(false);
  });

  it("refuses a second serializer for one type name", () => {
    const serializers = registry();
    let thrown: unknown;
    try {
      serializers.register(Health, HEALTH_SERIALIZER);
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown) && thrown.code).toBe(
      "INVALID_APPLICATION_STATE",
    );
    expect(String(thrown)).toMatch(/already registered/);
  });

  it("refuses a component class with no usable typeName", () => {
    class Anonymous {
      host: ComponentHost | null = null;
    }
    const serializers = new ComponentSerializerRegistry();
    const serializer: ComponentSerializer<Anonymous> = {
      serialize: () => null,
      deserialize: () => new Anonymous(),
    };

    expect(() =>
      serializers.register(
        Anonymous as unknown as typeof Health,
        serializer as unknown as ComponentSerializer<Health>,
      ),
    ).toThrow(FourError);
    expect(() =>
      serializers.register(
        class {
          static readonly typeName = "";
          host: ComponentHost | null = null;
        } as unknown as typeof Health,
        serializer as unknown as ComponentSerializer<Health>,
      ),
    ).toThrow(/missing a usable `static readonly typeName`/);
  });

  it("serializes only registered types, in registration order", () => {
    const node = new Group();
    node.addComponent(new Health(3));
    node.addComponent(new PoseTarget());

    // Attach order is Health-then-PoseTarget; the document order is the
    // registry's — the walk is over the node (A-15), the emission over the
    // registry, so what is attached decides *whether* and the registry decides
    // *where*.
    expect(registry().serializeComponents(node)).toEqual([
      {
        type: PoseTarget.typeName,
        data: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      },
      { type: Health.typeName, data: { hp: 3 } },
    ]);
  });

  it("refuses a component with no registered serializer (A-15)", () => {
    const node = new Group();
    node.addComponent(new Health(3));

    let thrown: unknown;
    try {
      createDefaultComponentSerializers().serializeComponents(node);
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown) && thrown.code).toBe(
      "INVALID_APPLICATION_STATE",
    );
    expect(isFourError(thrown) && thrown.message).toMatch(
      /no registered serializer/,
    );
    expect(isFourError(thrown) && thrown.message).toContain(Health.typeName);
    expect(isFourError(thrown) && thrown.context).toEqual({
      node: node.id,
      typeName: Health.typeName,
    });
  });

  it("skips an unserializable component on request (A-15)", () => {
    const node = new Group();
    node.addComponent(new Health(3));
    node.addComponent(new PoseTarget());

    expect(
      createDefaultComponentSerializers().serializeComponents(node, "skip"),
    ).toEqual([
      {
        type: PoseTarget.typeName,
        data: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      },
    ]);
  });

  it("refuses a component whose class carries no typeName (A-15)", () => {
    // §6a's registry rejects such a class at attach time, so the writer can
    // only meet one on a host that bypassed the registry — and it must still
    // refuse rather than quietly drop it. A structural stand-in for the host is
    // enough: `serializeComponents` reads `id` and `components` only.
    class Rogue {
      host = null;
    }
    const host = {
      id: "node-rogue",
      components: [new Rogue()][Symbol.iterator](),
    } as unknown as Group;

    let thrown: unknown;
    try {
      createDefaultComponentSerializers().serializeComponents(host);
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown) && thrown.code).toBe(
      "INVALID_APPLICATION_STATE",
    );
    expect(isFourError(thrown) && thrown.message).toMatch(/no static typeName/);
    expect(isFourError(thrown) && thrown.message).not.toMatch(/Rogue/);
    expect(isFourError(thrown) && thrown.context).toEqual({
      node: "node-rogue",
      typeName: null,
    });
  });

  it("returns undefined for an unknown component document", () => {
    expect(
      registry().deserializeComponent(
        { type: "com.example.unknown", data: null },
        new Group(),
      ),
    ).toBeUndefined();
  });
});

describe("POSE_TARGET_SERIALIZER", () => {
  it("stores the target pose and seeds the history on load (§79)", () => {
    const target = new PoseTarget();
    target.position.set(1, 2, 3);
    target.rotation.set(0, Math.SQRT1_2, 0, Math.SQRT1_2);
    target.capturePrevious();
    target.position.set(4, 5, 6); // one step of motion, deliberately not saved

    const data = POSE_TARGET_SERIALIZER.serialize(target);
    expect(data).toEqual({
      position: { x: 4, y: 5, z: 6 },
      rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
    });

    const restored = POSE_TARGET_SERIALIZER.deserialize(data, new Group());
    expect(components(restored.position)).toEqual(components(target.position));
    expect(components(restored.rotation)).toEqual(components(target.rotation));
    // The history is seeded to the restored pose, so the first difference is
    // zero rather than a spike out of the origin.
    expect(components(restored.previousPosition)).toEqual(
      components(restored.position),
    );
    expect(components(restored.previousRotation)).toEqual(
      components(restored.rotation),
    );
    expect(components(restored.scale)).toEqual({ x: 1, y: 1, z: 1 });
  });

  it("writes a non-identity scale and omits identity", () => {
    const boxed = new PoseTarget();
    boxed.scale.set(2, 3, 4);
    expect(POSE_TARGET_SERIALIZER.serialize(boxed)).toEqual({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 2, y: 3, z: 4 },
    });

    const restored = POSE_TARGET_SERIALIZER.deserialize(
      POSE_TARGET_SERIALIZER.serialize(boxed),
      new Group(),
    );
    expect(components(restored.scale)).toEqual({ x: 2, y: 3, z: 4 });
    expect(components(restored.previousScale)).toEqual({ x: 2, y: 3, z: 4 });
  });

  it("defaults a payload that omits a member, and refuses a malformed one", () => {
    const restored = POSE_TARGET_SERIALIZER.deserialize({}, new Group());
    expect(components(restored.position)).toEqual({ x: 0, y: 0, z: 0 });

    expect(() =>
      POSE_TARGET_SERIALIZER.deserialize({ position: 3 }, new Group()),
    ).toThrow(/pose-target\.position must be an object/);
    expect(() => POSE_TARGET_SERIALIZER.deserialize(null, new Group())).toThrow(
      /pose-target must be an object/,
    );
  });
});

describe("serializeScene", () => {
  it("writes a canonical document for a whole tree", () => {
    const document = serializeScene(buildScene(), registry());

    expect(document.formatVersion).toBe(1);
    expect(document.nodes).toHaveLength(1);
    const root = document.nodes[0];
    expect(root.type).toBe(SCENE_NODE_TYPE);
    expect(root.name).toBe("level");
    expect(root.tags).toEqual(["root", "persistent"]);
    expect(root.metadata).toEqual({
      author: "test",
      counts: [1, 2, 3],
      nested: { deep: true },
    });
    expect(root.children).toHaveLength(2);
    expect(root.children?.[0].transformAuthority).toBe("blended");
    expect(root.children?.[0].components).toEqual([
      {
        type: "pose-target",
        data: {
          position: { x: 1, y: 2, z: 3 },
          rotation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },
        },
      },
    ]);
    expect(root.children?.[1].children?.[0].name).toBe("leaf");
  });

  it("records a Group root as a group", () => {
    expect(serializeScene(new Group(), registry()).nodes[0].type).toBe(
      GROUP_NODE_TYPE,
    );
  });

  it("refuses a node class it has no type name for", () => {
    class Mesh extends Group {}
    let thrown: unknown;
    try {
      serializeScene(new Mesh(), registry());
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown) && thrown.code).toBe(
      "INVALID_APPLICATION_STATE",
    );
    expect(String(thrown)).toMatch(/has no serializable type name/);
    // Diagnostics name authored document types, never `constructor.name` — a
    // minifier rewrites the latter (dogfooding: `Renderable` → "Ur"). The
    // message must stay useful in the build every consumer ships.
    expect(String(thrown)).not.toMatch(/Mesh/);
    expect(
      String(thrown),
      "names the built-in types a reader can act on",
    ).toMatch(/"scene", "group"/);
    expect(String(thrown)).toMatch(/nodeTypeOf/);
  });

  it("maps application classes through nodeTypeOf", () => {
    class Mesh extends Group {}
    const scene = new Scene();
    scene.add(new Mesh());

    const document = serializeScene(scene, registry(), {
      nodeTypeOf: (node) => (node instanceof Mesh ? "mesh" : undefined),
    });

    expect(document.nodes[0].type).toBe(SCENE_NODE_TYPE);
    expect(document.nodes[0].children?.[0].type).toBe("mesh");
  });

  it("refuses metadata JSON cannot carry, naming the node", () => {
    const scene = new Scene();
    const child = new Group();
    child.metadata = { when: new Date(0) };
    scene.add(child);

    expect(() => serializeScene(scene, registry())).toThrow(
      /document\.nodes\[0\]\.children\[0\]\.metadata\.when is \[object Date\]/,
    );
  });

  it("refuses a NaN in a transform rather than writing null", () => {
    const node = new Group();
    node.transform.position.set(Number.NaN, 0, 0);

    expect(() => serializeScene(node, registry())).toThrow(
      /transform\.position\.x must be a finite number/,
    );
  });
});

describe("instantiateScene", () => {
  it("round-trips a scene through text with an identical document (P11-1 gate)", () => {
    const serializers = registry();
    const original = buildScene();

    const first = serializeScene(original, serializers);
    const text = encodeSceneDocument(first);
    const parsed = decodeSceneDocument(text);
    const reloaded = instantiateScene(parsed, serializers);
    const second = serializeScene(reloaded, serializers);

    expect(encodeSceneDocument(second)).toBe(text);
    expect(second).toEqual(first);
  });

  it("restores every transform bit for bit", () => {
    const serializers = registry();
    const original = buildScene();
    const reloaded = instantiateScene(
      serializeScene(original, serializers),
      serializers,
    );

    const before = transformValues(original);
    const after = transformValues(reloaded);
    expect(after).toHaveLength(before.length);
    for (let i = 0; i < before.length; i += 1) {
      expect(Object.is(after[i], before[i])).toBe(true);
    }
  });

  it("restores identity, names, flags, tags, and metadata (§79)", () => {
    const serializers = registry();
    const original = buildScene();
    const reloaded = instantiateScene(
      serializeScene(original, serializers),
      serializers,
    ) as Scene;

    expect(reloaded).toBeInstanceOf(Scene);
    expect(reloaded.id).toBe(original.id);
    expect(reloaded.name).toBe("level");
    expect([...reloaded.tags]).toEqual(["root", "persistent"]);
    expect(reloaded.metadata).toEqual(original.metadata);

    const animated = reloaded.findByName("animated");
    expect(animated).toBeInstanceOf(Group);
    expect(animated?.id).toBe(original.children[0].id);
    expect(animated?.transformAuthority).toBe("blended");
    expect(animated?.visible).toBe(false);
    expect(animated?.opacity).toBe(0.25);
    expect(reloaded.findByName("physical")?.enabled).toBe(false);
    expect(reloaded.findByName("leaf")?.parent?.name).toBe("physical");
  });

  it("gives the reloaded scene its own mutable metadata", () => {
    const serializers = registry();
    const original = buildScene();
    const reloaded = instantiateScene(
      serializeScene(original, serializers),
      serializers,
    );

    const metadata = reloaded.metadata as {
      counts: number[];
      nested: { deep: boolean };
    };
    metadata.counts.push(4);
    metadata.nested.deep = false;

    expect(metadata.counts).toEqual([1, 2, 3, 4]);
    expect(original.metadata).toEqual({
      author: "test",
      counts: [1, 2, 3],
      nested: { deep: true },
    });
  });

  it("restores components as live, attached instances", () => {
    const serializers = registry();
    const reloaded = instantiateScene(
      serializeScene(buildScene(), serializers),
      serializers,
    ) as Scene;

    const target = reloaded.findByName("animated")?.getComponent(PoseTarget);
    expect(target && components(target.position)).toEqual({ x: 1, y: 2, z: 3 });
    expect(target?.host).toBe(reloaded.findByName("animated"));

    const health = reloaded.findByName("physical")?.getComponent(Health);
    expect(health?.hp).toBe(7);
  });

  it("restores a user-owned local matrix without recomposing it (§7)", () => {
    const serializers = registry();
    const node = new Group();
    node.transform.position.set(5, 5, 5);
    node.transform.matrixAutoUpdate = false;
    node.transform.localMatrix.elements[12] = 9;

    const reloaded = instantiateScene(
      serializeScene(node, serializers),
      serializers,
    );

    expect(reloaded.transform.matrixAutoUpdate).toBe(false);
    expect([...reloaded.transform.localMatrix.elements]).toEqual([
      ...node.transform.localMatrix.elements,
    ]);
    reloaded.transform.updateLocalMatrix();
    expect(reloaded.transform.localMatrix.elements[12]).toBe(9);
    // The authored position survives even though it no longer describes the node.
    expect(reloaded.transform.position.x).toBe(5);
  });

  it("throws on an unknown component type by default", () => {
    const document = serializeScene(buildScene(), registry());
    let thrown: unknown;
    try {
      instantiateScene(document, createDefaultComponentSerializers());
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown) && thrown.code).toBe(
      "INVALID_APPLICATION_STATE",
    );
    expect(String(thrown)).toMatch(/com\.example\.health/);
  });

  it("skips an unknown component type on request", () => {
    const document = serializeScene(buildScene(), registry());
    const reloaded = instantiateScene(
      document,
      createDefaultComponentSerializers(),
      { unknownComponents: "skip" },
    ) as Scene;

    expect(
      reloaded.findByName("physical")?.getComponent(Health),
    ).toBeUndefined();
    expect(
      reloaded.findByName("animated")?.getComponent(PoseTarget),
    ).toBeDefined();
  });

  it("preserves unknown component data at the document level (§79)", () => {
    const text = encodeSceneDocument(serializeScene(buildScene(), registry()));

    // A build that has never heard of `com.example.health` still round-trips it.
    expect(encodeSceneDocument(decodeSceneDocument(text))).toBe(text);
    expect(text).toContain('{"hp":7}');
  });

  it("accepts a deserializer that attaches the component itself", () => {
    const serializers = new ComponentSerializerRegistry().register(Health, {
      serialize: (component) => ({ hp: component.hp }),
      deserialize: (data, node) => {
        const record = asJsonObject(data, "health");
        return node.addComponent(
          new Health(typeof record.hp === "number" ? record.hp : 0),
        );
      },
    });
    const node = new Group();
    node.addComponent(new Health(2));

    const reloaded = instantiateScene(
      serializeScene(node, serializers),
      serializers,
    );

    expect(reloaded.getComponent(Health)?.hp).toBe(2);
  });

  it("throws on a node type it has no class for", () => {
    const document = validateSceneDocument({
      formatVersion: 1,
      nodes: [{ type: "mesh", id: "node-x" }],
    });
    let thrown: unknown;
    try {
      instantiateScene(document, registry());
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown) && thrown.code).toBe("INVALID_SCENE_GRAPH");
    expect(isFourError(thrown) && thrown.context).toEqual({
      type: "mesh",
      node: "node-x",
    });
  });

  it("builds application classes through nodeFactory", () => {
    class Mesh extends Group {
      geometry = "";
    }
    const document = validateSceneDocument({
      formatVersion: 1,
      nodes: [
        {
          type: "mesh",
          id: "node-x",
          metadata: { geometry: "box" },
          children: [{ type: "group" }],
        },
      ],
    });

    const reloaded = instantiateScene(document, registry(), {
      nodeFactory: (node) => {
        if (node.type !== "mesh") {
          return undefined;
        }
        const mesh = new Mesh();
        const geometry = node.metadata?.geometry;
        mesh.geometry = typeof geometry === "string" ? geometry : "";
        return mesh;
      },
    });

    expect(reloaded).toBeInstanceOf(Mesh);
    expect((reloaded as Mesh).geometry).toBe("box");
    expect(reloaded.id).toBe("node-x");
    expect(reloaded.children).toHaveLength(1);
  });

  it("assigns a fresh id to a node the document does not name", () => {
    const document = validateSceneDocument({
      formatVersion: 1,
      nodes: [{ type: "group" }],
    });

    expect(instantiateScene(document, registry()).id).toMatch(/^node-\d+$/);
  });

  it("refuses a document that does not hold exactly one root", () => {
    const empty = validateSceneDocument({ formatVersion: 1, nodes: [] });
    let thrown: unknown;
    try {
      instantiateScene(empty, registry());
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown) && thrown.code).toBe("INVALID_SCENE_GRAPH");
    expect(String(thrown)).toMatch(/holds 0 root nodes/);
  });
});

describe("instantiateSceneNodes", () => {
  it("rebuilds every root of a multi-root document", () => {
    const document: SceneDocument = validateSceneDocument({
      formatVersion: 1,
      nodes: [
        { type: "group", id: "a", name: "first" },
        { type: "scene", id: "b", name: "second" },
      ],
    });

    const roots = instantiateSceneNodes(document, registry());

    expect(roots).toHaveLength(2);
    expect(roots[0]).toBeInstanceOf(Group);
    expect(roots[1]).toBeInstanceOf(Scene);
    expect(roots.map((node) => node.id)).toEqual(["a", "b"]);
    expect(roots.map((node) => node.name)).toEqual(["first", "second"]);
  });
});

/**
 * A-17 (2026-08-06): restored ids used to be written past `@fourjs/scene`'s
 * counter without advancing it, so the next node constructed in the process
 * could be handed an id a loaded node already held.
 */
describe("node identity after a load (§79, A-17)", () => {
  it("advances the id counter past a restored engine-shaped id", () => {
    // Far beyond anything this process will have reached.
    const restoredId = "node-900000001";
    const document = validateSceneDocument({
      formatVersion: 1,
      nodes: [{ type: "group", id: restoredId }],
    });

    const reloaded = instantiateScene(document, registry());
    expect(reloaded.id).toBe(restoredId);

    // The node built *after* the load must not collide with it.
    const fresh = new Group();
    expect(fresh.id).not.toBe(restoredId);
    expect(Number(/^node-(\d+)$/.exec(fresh.id)?.[1])).toBeGreaterThan(
      900000001,
    );
  });

  it("leaves an application-shaped id alone", () => {
    const before = new Group().id;
    const document = validateSceneDocument({
      formatVersion: 1,
      nodes: [{ type: "group", id: "player" }],
    });

    expect(instantiateScene(document, registry()).id).toBe("player");

    // A non-engine id can never collide, so it must not move the counter.
    const beforeValue = Number(/^node-(\d+)$/.exec(before)?.[1]);
    const afterValue = Number(/^node-(\d+)$/.exec(new Group().id)?.[1]);
    expect(afterValue).toBe(beforeValue + 1);
  });

  it("reserves an id restored through a nodeFactory as well", () => {
    const restoredId = "node-900000101";
    const document = validateSceneDocument({
      formatVersion: 1,
      nodes: [{ type: "mesh", id: restoredId }],
    });

    const reloaded = instantiateScene(document, registry(), {
      nodeFactory: (node) => (node.type === "mesh" ? new Group() : undefined),
    });

    expect(reloaded.id).toBe(restoredId);
    expect(Number(/^node-(\d+)$/.exec(new Group().id)?.[1])).toBeGreaterThan(
      900000101,
    );
  });

  it("constructs a node with a restored id directly", () => {
    const node = new Group({ id: "node-900000201" });
    expect(node.id).toBe("node-900000201");
    expect(new Group().id).toBe("node-900000202");
  });

  it("refuses a document that produces one id twice", () => {
    // The document validator already refuses a *literal* duplicate id, so the
    // way to reach the instantiator's own check is a `nodeFactory` that hands
    // back two nodes carrying the same id for a document that named none.
    const document = validateSceneDocument({
      formatVersion: 1,
      nodes: [{ type: "mesh", children: [{ type: "mesh" }] }],
    });

    let thrown: unknown;
    try {
      instantiateScene(document, registry(), {
        nodeFactory: () => new Group({ id: "node-dup" }),
      });
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown) && thrown.code).toBe("INVALID_SCENE_GRAPH");
    expect(isFourError(thrown) && thrown.message).toMatch(/twice/);
  });
});

/**
 * A-14/A-16 (2026-08-06): the document gained one opaque JSON value per node so
 * a `nodeTypeOf` / `nodeFactory` pair can carry subclass state, which is what
 * the umbrella `four` package's `registerSceneNodeTypes()` is built on.
 */
describe("subclass state (§79 node data)", () => {
  class Mesh extends Group {
    geometry = "";
  }

  it("round-trips a node's data payload", () => {
    const root = new Mesh();
    root.geometry = "box";

    const document = serializeScene(root, registry(), {
      nodeTypeOf: (node) => (node instanceof Mesh ? "mesh" : undefined),
      nodeDataOf: (node) =>
        node instanceof Mesh ? { geometry: node.geometry } : undefined,
    });

    expect(document.nodes[0].data).toEqual({ geometry: "box" });

    const reloaded = instantiateScene(
      decodeSceneDocument(encodeSceneDocument(document)),
      registry(),
      {
        nodeFactory: (node) => {
          if (node.type !== "mesh") return undefined;
          const mesh = new Mesh();
          const data = asJsonObject(node.data ?? {}, "mesh");
          mesh.geometry =
            typeof data.geometry === "string" ? data.geometry : "";
          return mesh;
        },
      },
    );

    expect(reloaded).toBeInstanceOf(Mesh);
    expect((reloaded as Mesh).geometry).toBe("box");
  });

  it("writes no data key at all when the writer returns undefined", () => {
    const node = new Group();
    const document = serializeScene(node, registry(), {
      nodeDataOf: () => undefined,
    });
    expect("data" in document.nodes[0]).toBe(false);
    // The byte-identity property every existing document relies on: the new
    // field cannot move a document that does not use it.
    expect(encodeSceneDocument(document)).toBe(
      encodeSceneDocument(serializeScene(node, registry())),
    );
  });

  it("keeps an explicit null payload", () => {
    const document = serializeScene(new Group(), registry(), {
      nodeTypeOf: () => "marker",
      nodeDataOf: () => null,
    });
    expect(document.nodes[0].data).toBeNull();
  });

  it("refuses a payload JSON cannot carry, naming the node", () => {
    expect(() =>
      serializeScene(new Group(), registry(), {
        nodeTypeOf: () => "marker",
        nodeDataOf: (): JsonValue => Number.NaN,
      }),
    ).toThrow(/data/);
  });
});

describe("applyTransformDocument", () => {
  it("restores §7 defaults for an absent document", () => {
    const node = new Group();
    node.transform.position.set(1, 2, 3);
    node.transform.rotation.set(1, 0, 0, 0);
    node.transform.scale.set(3, 3, 3);
    node.transform.pivot.set(1, 1, 1);
    node.transform.matrixAutoUpdate = false;

    applyTransformDocument(undefined, node.transform);

    expect(components(node.transform.position)).toEqual({ x: 0, y: 0, z: 0 });
    expect(components(node.transform.rotation)).toEqual({
      x: 0,
      y: 0,
      z: 0,
      w: 1,
    });
    expect(components(node.transform.scale)).toEqual({ x: 1, y: 1, z: 1 });
    expect(components(node.transform.pivot)).toEqual({ x: 0, y: 0, z: 0 });
    expect(node.transform.matrixAutoUpdate).toBe(true);
  });
});
