import { boxGeometry, planeGeometry } from "@fourjs/geometry";
import {
  Matrix4,
  Quaternion,
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@fourjs/math";
import {
  LitMaterial,
  StandardMaterial,
  UnlitMaterial,
  type Material,
} from "@fourjs/materials";
import {
  ALL_LAYERS,
  Bone,
  DEFAULT_LAYER_MASK,
  DEFAULT_LAYER_NAME,
  Group,
  NO_LAYERS,
  PerspectiveCamera,
  PoseBuffer,
  Scene,
  Skeleton,
  createFullscreenViewport,
  layerMask,
  resolveWorldTransforms,
  type Node,
  type Viewport,
} from "@fourjs/scene";
import { describe, expect, it } from "vitest";

import {
  Mesh,
  PARTICLE_INSTANCE_FLOATS,
  Renderable,
  buildInterpolatedRenderList,
  buildRenderList,
  groupRenderListByPipeline,
  isLitItem,
  isSkinnedUnlitItem,
  isStandardItem,
  isUnlitItem,
  viewLayerMask,
  type RenderItem,
} from "../src/index.js";

const HALF_PI = Math.PI / 2;
const AXIS_Z = new Vector3(0, 0, 1);

/** A named renderable sharing one geometry/material pair per test. */
function renderable(
  name: string,
  options?: { layer?: number; order?: number },
) {
  const node = new Renderable(planeGeometry(), new UnlitMaterial(), {
    renderLayer: options?.layer ?? 0,
    renderOrder: options?.order ?? 0,
  });
  node.name = name;
  return node;
}

function names(list: readonly RenderItem[], scene: Scene): string[] {
  // Items carry no node reference (§64: compact items), so identify them by
  // the geometry instance each renderable owns.
  const byGeometry = new Map<unknown, string>();
  scene.traverse((node: Node) => {
    if (node instanceof Renderable) {
      byGeometry.set(node.geometry, node.name);
    }
  });
  return list.map((item) => byGeometry.get(item.geometry) ?? "?");
}

function expectMatrix(actual: Matrix4, expected: Matrix4, digits = 12): void {
  for (let i = 0; i < 16; i += 1) {
    expect(actual.elements[i], `element ${String(i)}`).toBeCloseTo(
      expected.elements[i],
      digits,
    );
  }
}

/** Translation column of a matrix, as a plain triple. */
function translationOf(m: Matrix4): [number, number, number] {
  return [m.elements[12], m.elements[13], m.elements[14]];
}

describe("Renderable", () => {
  it("is a scene node carrying geometry, material, and §66 sort keys", () => {
    const geometry = boxGeometry();
    const material = new UnlitMaterial();
    const node = new Renderable(geometry, material);

    expect(node.geometry).toBe(geometry);
    expect(node.material).toBe(material);
    expect(node.renderLayer).toBe(0);
    expect(node.renderOrder).toBe(0);
    expect(node.visible).toBe(true);
    expect(node.enabled).toBe(true);
    expect(node.transform.position.x).toBe(0);
  });

  it("accepts initial sort keys", () => {
    const node = new Renderable(boxGeometry(), new UnlitMaterial(), {
      renderLayer: 2,
      renderOrder: -1,
    });

    expect(node.renderLayer).toBe(2);
    expect(node.renderOrder).toBe(-1);
  });

  it("lets the geometry be replaced, and draws the new one", () => {
    const scene = new Scene();
    const node = new Renderable(boxGeometry(), new UnlitMaterial());
    scene.add(node);

    // `geometry` is an accessor pair since §55's `Sprite` began overriding it
    // (2026-08-06); assigning behaves exactly as the plain field did.
    const replacement = planeGeometry();
    node.geometry = replacement;

    expect(node.geometry).toBe(replacement);
    expect(buildRenderList(scene, [])[0].geometry).toBe(replacement);
  });

  it("carries a material of any §57 family member, chosen by its kind", () => {
    // The R-12 widening: the class is generic in its material, so a family
    // member declared outside this package needs no edit here.
    const lit: Renderable<LitMaterial> = new Renderable(
      planeGeometry(),
      new LitMaterial(),
    );

    expect(lit.material.kind).toBe("lit");
  });
});

describe("buildRenderList", () => {
  it("collects renderables in scene-graph order and skips plain nodes", () => {
    const scene = new Scene();
    const group = new Group();
    const a = renderable("a");
    const b = renderable("b");
    const c = renderable("c");
    scene.add(a, group);
    group.add(b);
    scene.add(c);

    const out: RenderItem[] = [];
    const list = buildRenderList(scene, out);

    expect(list).toBe(out);
    expect(names(list, scene)).toEqual(["a", "b", "c"]);
  });

  it("copies the renderable's material and sort keys into the item", () => {
    const scene = new Scene();
    const node = renderable("a", { layer: 3, order: 7 });
    scene.add(node);

    const [item] = buildRenderList(scene, []);
    expect(item.material).toBe(node.material);
    expect(item.geometry).toBe(node.geometry);
    expect(item.renderLayer).toBe(3);
    expect(item.renderOrder).toBe(7);
  });

  describe("pipeline kinds (§57, §68)", () => {
    it('tags an UnlitMaterial renderable "unlit"', () => {
      const scene = new Scene();
      scene.add(renderable("a"));

      const [item] = buildRenderList(scene, []);
      expect(item.kind).toBe("unlit");
      expect(isUnlitItem(item)).toBe(true);
      expect(isLitItem(item)).toBe(false);
    });

    it('tags a LitMaterial renderable "lit" and carries its material', () => {
      const scene = new Scene();
      const material = new LitMaterial({ color: [1, 0, 0, 1] });
      const node = new Renderable(boxGeometry(), material);
      scene.add(node);

      const [item] = buildRenderList(scene, []);
      expect(item.kind).toBe("lit");
      expect(isLitItem(item)).toBe(true);
      expect(isUnlitItem(item)).toBe(false);
      if (isLitItem(item)) {
        // The guard narrows to LitRenderItem, so `material` is the
        // LitMaterial itself — no cast on the consumer side.
        expect(item.material).toBe(material);
      }
    });

    it('tags a StandardMaterial renderable "standard" and carries its material (§59, R-13)', () => {
      const scene = new Scene();
      const material = new StandardMaterial({ metalness: 1, roughness: 0.2 });
      const node = new Renderable(boxGeometry(), material);
      scene.add(node);

      const [item] = buildRenderList(scene, []);
      expect(item.kind).toBe("standard");
      expect(isStandardItem(item)).toBe(true);
      expect(isLitItem(item)).toBe(false);
      expect(isUnlitItem(item)).toBe(false);
      if (isStandardItem(item)) {
        // The guard narrows to StandardRenderItem, so §59's own fields are
        // reachable with no cast — the reason it is a separate union arm.
        expect(item.material).toBe(material);
        expect(item.material.metalness).toBe(1);
      }
    });

    it("does not tag any other family standard", () => {
      const scene = new Scene();
      scene.add(renderable("a"));
      scene.add(new Renderable(boxGeometry(), new LitMaterial()));

      const items = buildRenderList(scene, []);
      expect(items.map(isStandardItem)).toEqual([false, false]);
    });

    it("re-tags a pooled slot when the material family changes", () => {
      const scene = new Scene();
      // Annotated rather than inferred: `Renderable` is generic in its material
      // (§57's base), so `new Renderable(g, new UnlitMaterial())` infers the
      // narrow `Renderable<UnlitMaterial>` — and this test swaps families.
      //
      // The parameter is named explicitly rather than left at its
      // `SurfaceMaterial` default (R-13): that default is deliberately
      // `UnlitMaterial | LitMaterial`, because widening it would take `color`
      // and `setColor` off every ordinary renderable's material — the argument
      // `renderable.ts` records for keeping `SpriteMaterial` out of it, which
      // applies unchanged to §59's `baseColor`.
      const node: Renderable<Material> = new Renderable(
        planeGeometry(),
        new UnlitMaterial(),
      );
      scene.add(node);
      const out: RenderItem[] = [];

      expect(buildRenderList(scene, out)[0].kind).toBe("unlit");

      node.material = new LitMaterial();
      expect(buildRenderList(scene, out)[0].kind).toBe("lit");

      node.material = new StandardMaterial();
      expect(buildRenderList(scene, out)[0].kind).toBe("standard");

      node.material = new UnlitMaterial();
      expect(buildRenderList(scene, out)[0].kind).toBe("unlit");
    });
  });

  it("references the node's own world matrix, resolved by the caller (§7)", () => {
    const scene = new Scene();
    const node = renderable("a");
    node.transform.position.set(2, 3, 4);
    scene.add(node);

    const [item] = buildRenderList(scene, []);
    expect(item.worldMatrix).toBe(node.transform.worldMatrix);

    // The list builder does not resolve; §7 makes that the frame's job.
    expect(translationOf(item.worldMatrix)).toEqual([0, 0, 0]);
    resolveWorldTransforms(scene);
    expect(translationOf(item.worldMatrix)).toEqual([2, 3, 4]);
  });

  describe("visibility filtering (§64 stage 2)", () => {
    it("prunes the whole subtree of an invisible node", () => {
      const scene = new Scene();
      const group = new Group();
      const hidden = renderable("hidden");
      const child = renderable("child");
      group.add(hidden, child);
      scene.add(group, renderable("sibling"));

      group.visible = false;
      expect(names(buildRenderList(scene, []), scene)).toEqual(["sibling"]);

      group.visible = true;
      hidden.visible = false;
      expect(names(buildRenderList(scene, []), scene)).toEqual([
        "child",
        "sibling",
      ]);
    });

    it("prunes disabled subtrees as well", () => {
      const scene = new Scene();
      const group = new Group();
      group.add(renderable("child"));
      scene.add(group, renderable("sibling"));

      group.enabled = false;
      expect(names(buildRenderList(scene, []), scene)).toEqual(["sibling"]);
    });

    it("yields an empty list for a hidden root", () => {
      const scene = new Scene();
      scene.add(renderable("a"));
      scene.visible = false;

      expect(buildRenderList(scene, [])).toEqual([]);
    });
  });

  describe("ordering (§66 subset)", () => {
    it("sorts by render layer first", () => {
      const scene = new Scene();
      scene.add(
        renderable("late-layer", { layer: 1, order: -100 }),
        renderable("early-layer", { layer: 0, order: 100 }),
      );

      expect(names(buildRenderList(scene, []), scene)).toEqual([
        "early-layer",
        "late-layer",
      ]);
    });

    it("sorts by render order within a layer", () => {
      const scene = new Scene();
      scene.add(
        renderable("third", { order: 5 }),
        renderable("first", { order: -5 }),
        renderable("second", { order: 0 }),
      );

      expect(names(buildRenderList(scene, []), scene)).toEqual([
        "first",
        "second",
        "third",
      ]);
    });

    it("keeps scene-graph order for equal keys (stable sort)", () => {
      const scene = new Scene();
      const group = new Group();
      scene.add(renderable("a"), group, renderable("d"));
      group.add(renderable("b"), renderable("c"));

      expect(names(buildRenderList(scene, []), scene)).toEqual([
        "a",
        "b",
        "c",
        "d",
      ]);

      // …including when a subset shares a non-default layer.
      for (const name of ["b", "d"]) {
        const node = scene.findByName(name);
        if (node instanceof Renderable) {
          node.renderLayer = 1;
        }
      }
      expect(names(buildRenderList(scene, []), scene)).toEqual([
        "a",
        "c",
        "b",
        "d",
      ]);
    });
  });

  // §66 key 2 (2026-08-06). The compatibility property is asserted first,
  // because it is the reason the key could land at all.
  describe("opaque before transparent (§66 key 2)", () => {
    /** A renderable whose material declares §57's `transparent`. */
    function blended(
      name: string,
      options?: { layer?: number; order?: number },
    ): Renderable {
      const node = new Renderable(
        planeGeometry(),
        new UnlitMaterial({ transparent: true }),
        {
          renderLayer: options?.layer ?? 0,
          renderOrder: options?.order ?? 0,
        },
      );
      node.name = name;
      return node;
    }

    it("changes nothing for a scene that declares no transparency", () => {
      const scene = new Scene();
      scene.add(renderable("a"), renderable("b"), renderable("c"));

      // Every item classifies opaque, the key compares equal, and the stable
      // sort leaves scene order alone — the property the pixel goldens pin.
      expect(names(buildRenderList(scene, []), scene)).toEqual(["a", "b", "c"]);
    });

    it("draws opaque items before transparent ones inside a layer", () => {
      const scene = new Scene();
      scene.add(blended("glass"), renderable("wall"));

      expect(names(buildRenderList(scene, []), scene)).toEqual([
        "wall",
        "glass",
      ]);
    });

    it("leaves an already-correct scene in the order it was authored", () => {
      const scene = new Scene();
      scene.add(renderable("wall"), blended("glass"));

      // The back-to-front authoring §66 documents as the pre-key workaround
      // keeps working: the key agrees with it rather than permuting it.
      expect(names(buildRenderList(scene, []), scene)).toEqual([
        "wall",
        "glass",
      ]);
    });

    it("outranks explicit render order, and is outranked by the layer", () => {
      const scene = new Scene();
      scene.add(
        blended("glass", { order: -100 }),
        renderable("wall", { order: 100 }),
        // A transparent item in an earlier layer still draws first: key 1
        // outranks key 2, which is the escape hatch for a glow behind a mask.
        blended("backdrop", { layer: -1 }),
      );

      expect(names(buildRenderList(scene, []), scene)).toEqual([
        "backdrop",
        "wall",
        "glass",
      ]);
    });

    it("keeps render order and scene order inside each group", () => {
      const scene = new Scene();
      scene.add(
        blended("glass-late", { order: 1 }),
        blended("glass-early", { order: 0 }),
        renderable("wall-late", { order: 1 }),
        renderable("wall-early", { order: 0 }),
      );

      expect(names(buildRenderList(scene, []), scene)).toEqual([
        "wall-early",
        "wall-late",
        "glass-early",
        "glass-late",
      ]);
    });

    it("snapshots the flag onto the item, and re-reads it every build", () => {
      const scene = new Scene();
      const node = blended("glass");
      scene.add(node);
      const out: RenderItem[] = [];

      expect(buildRenderList(scene, out)[0].transparent).toBe(true);

      node.material.transparent = false;
      expect(buildRenderList(scene, out)[0].transparent).toBe(false);
    });
  });

  describe("pooling (plan D7)", () => {
    it("reuses the same item objects across rebuilds", () => {
      const scene = new Scene();
      scene.add(renderable("a"), renderable("b"));

      const out: RenderItem[] = [];
      const first = [...buildRenderList(scene, out)];
      const second = [...buildRenderList(scene, out)];

      expect(second).toHaveLength(2);
      for (const item of second) {
        expect(first).toContain(item);
      }
    });

    it("truncates the array when the list shrinks", () => {
      const scene = new Scene();
      const a = renderable("a");
      scene.add(a, renderable("b"), renderable("c"));

      const out: RenderItem[] = [];
      expect(buildRenderList(scene, out)).toHaveLength(3);

      scene.remove(a);
      a.visible = false;
      expect(buildRenderList(scene, out)).toHaveLength(2);
      expect(out.length).toBe(2);
    });

    it("gives independent out arrays independent pools", () => {
      const scene = new Scene();
      scene.add(renderable("a"));

      const first: RenderItem[] = [];
      const second: RenderItem[] = [];
      buildRenderList(scene, first);
      buildRenderList(scene, second);

      expect(second[0]).not.toBe(first[0]);
      // …and rebuilding one does not disturb the other.
      const kept = second[0];
      buildRenderList(scene, first);
      expect(second[0]).toBe(kept);
    });

    it("allocates no math objects, even while growing its pool", () => {
      const scene = new Scene();
      scene.add(renderable("a"), renderable("b"), renderable("c"));

      const out: RenderItem[] = [];
      resetConstructionCount();
      buildRenderList(scene, out);
      expect(constructionCount()).toBe(0);

      resetConstructionCount();
      for (let frame = 0; frame < 10; frame += 1) {
        buildRenderList(scene, out);
      }
      expect(constructionCount()).toBe(0);
    });
  });
});

describe("buildInterpolatedRenderList", () => {
  /**
   * A scene with one tracked renderable that moved from `(0, 0, 0)` with no
   * rotation to `(10, 0, 0)` rotated a quarter turn about +Z over one fixed
   * step.
   */
  function movedScene() {
    const scene = new Scene();
    const node = renderable("moving");
    scene.add(node);

    const poses = new PoseBuffer();
    poses.track(node);
    poses.capture(); // first capture seeds both poses from the transform

    node.transform.position.set(10, 0, 0);
    node.transform.rotation.setFromAxisAngle(AXIS_Z, HALF_PI);
    poses.capture(); // previous = start, current = end

    return { scene, node, poses };
  }

  /** The world matrix a pose `(position, rotation)` composes to for `node`. */
  function composed(node: Node, position: Vector3, rotation: Quaternion) {
    return new Matrix4().compose(
      position,
      rotation,
      node.transform.scale,
      node.transform.pivot,
    );
  }

  it("matches the previous captured pose at alpha 0", () => {
    const { scene, node, poses } = movedScene();

    const [item] = buildInterpolatedRenderList(scene, poses, 0, []);
    expectMatrix(
      item.worldMatrix,
      composed(node, new Vector3(0, 0, 0), new Quaternion()),
    );
  });

  it("matches the current captured pose at alpha 1", () => {
    const { scene, node, poses } = movedScene();

    const [item] = buildInterpolatedRenderList(scene, poses, 1, []);
    expectMatrix(
      item.worldMatrix,
      composed(
        node,
        new Vector3(10, 0, 0),
        new Quaternion().setFromAxisAngle(AXIS_Z, HALF_PI),
      ),
    );
  });

  it("lands between the two poses at alpha 0.5 (§43)", () => {
    const { scene, node, poses } = movedScene();

    const [item] = buildInterpolatedRenderList(scene, poses, 0.5, []);
    expect(translationOf(item.worldMatrix)).toEqual([5, 0, 0]);

    // Rotation slerps, so the half-step is a half turn of the quarter turn.
    expectMatrix(
      item.worldMatrix,
      composed(
        node,
        new Vector3(5, 0, 0),
        new Quaternion().setFromAxisAngle(AXIS_Z, HALF_PI / 2),
      ),
    );
  });

  it("composes interpolated ancestors with untracked descendants", () => {
    const scene = new Scene();
    const parent = new Group();
    const child = renderable("child");
    child.transform.position.set(0, 2, 0);
    scene.add(parent);
    parent.add(child);

    const poses = new PoseBuffer();
    poses.track(parent);
    poses.capture();
    parent.transform.position.set(8, 0, 0);
    poses.capture();

    const [item] = buildInterpolatedRenderList(scene, poses, 0.25, []);
    expect(translationOf(item.worldMatrix)).toEqual([2, 2, 0]);

    const expected = composed(
      parent,
      new Vector3(2, 0, 0),
      new Quaternion(),
    ).multiply(composed(child, new Vector3(0, 2, 0), new Quaternion()));
    expectMatrix(item.worldMatrix, expected);
  });

  it("follows the live transform of nodes the buffer does not track", () => {
    const scene = new Scene();
    const tracked = renderable("tracked");
    const free = renderable("free");
    scene.add(tracked, free);

    const poses = new PoseBuffer();
    poses.track(tracked);
    poses.capture();
    tracked.transform.position.set(4, 0, 0);
    poses.capture();

    free.transform.position.set(-3, 1, 0);
    const list = buildInterpolatedRenderList(scene, poses, 0, []);
    const [trackedItem, freeItem] = list;

    // The tracked node lags to its previous pose; the untracked one does not.
    expect(translationOf(trackedItem.worldMatrix)).toEqual([0, 0, 0]);
    expect(translationOf(freeItem.worldMatrix)).toEqual([-3, 1, 0]);

    free.transform.position.set(7, 7, 0);
    buildInterpolatedRenderList(scene, poses, 0, list);
    expect(translationOf(list[1].worldMatrix)).toEqual([7, 7, 0]);
  });

  it("clamps alpha to the captured interval", () => {
    const { scene, poses } = movedScene();

    const below = buildInterpolatedRenderList(scene, poses, -5, []);
    expect(translationOf(below[0].worldMatrix)).toEqual([0, 0, 0]);

    const above = buildInterpolatedRenderList(scene, poses, 5, []);
    expect(translationOf(above[0].worldMatrix)).toEqual([10, 0, 0]);
  });

  it("never writes scene transforms (§42, §43)", () => {
    const scene = new Scene();
    const parent = new Group();
    const child = renderable("child");
    scene.add(parent);
    parent.add(child);

    const poses = new PoseBuffer();
    poses.track(child);
    poses.capture();
    child.transform.position.set(1, 1, 0);
    poses.capture();

    resolveWorldTransforms(scene);
    const before = [scene, parent, child].map((node) => ({
      node,
      version: node.transform.version,
      worldVersion: node.transform.worldVersion,
      world: node.transform.worldMatrix.clone(),
    }));

    for (const alpha of [0, 0.5, 1]) {
      buildInterpolatedRenderList(scene, poses, alpha, []);
    }

    for (const snapshot of before) {
      expect(snapshot.node.transform.version).toBe(snapshot.version);
      expect(snapshot.node.transform.worldVersion).toBe(snapshot.worldVersion);
      expectMatrix(snapshot.node.transform.worldMatrix, snapshot.world, 15);
    }
  });

  it("filters and sorts exactly like buildRenderList", () => {
    const scene = new Scene();
    const hidden = new Group();
    hidden.visible = false;
    hidden.add(renderable("hidden-child"));
    scene.add(
      renderable("second", { order: 1 }),
      renderable("first", { order: 0 }),
      hidden,
    );

    const poses = new PoseBuffer();
    const list = buildInterpolatedRenderList(scene, poses, 0.5, []);
    expect(names(list, scene)).toEqual(["first", "second"]);
  });

  it("allocates no math objects once its matrix pool is warm", () => {
    const { scene, poses } = movedScene();
    scene.add(renderable("b"), renderable("c"));

    const out: RenderItem[] = [];
    buildInterpolatedRenderList(scene, poses, 0.5, out);

    resetConstructionCount();
    for (let frame = 0; frame < 10; frame += 1) {
      buildInterpolatedRenderList(scene, poses, frame / 10, out);
    }
    expect(constructionCount()).toBe(0);
  });

  it("reuses the same pooled matrices across rebuilds", () => {
    const { scene, poses } = movedScene();

    const out: RenderItem[] = [];
    const first = buildInterpolatedRenderList(scene, poses, 0, out)[0];
    const matrix = first.worldMatrix;
    const second = buildInterpolatedRenderList(scene, poses, 1, out)[0];

    expect(second).toBe(first);
    expect(second.worldMatrix).toBe(matrix);
  });

  it("interpolates the joint palette from bone local poses, not last resolved world (§43)", () => {
    const geometry = planeGeometry();
    const vertexCount = geometry.vertexCount;
    geometry.joints = new Uint16Array(vertexCount * 4);
    const weights = new Float32Array(vertexCount * 4);
    for (let i = 0; i < vertexCount; i += 1) {
      weights[i * 4] = 1;
    }
    geometry.weights = weights;

    const scene = new Scene();
    const mesh = new Mesh(geometry, new UnlitMaterial());
    const bone = new Bone();
    const skeleton = new Skeleton([bone]);
    mesh.skeleton = skeleton;
    scene.add(mesh, bone);

    const poses = new PoseBuffer();
    poses.track(bone);
    poses.track(mesh);
    poses.capture();
    bone.transform.position.set(0, 4, 0);
    poses.capture();

    resolveWorldTransforms(scene);
    const before = [scene, mesh, bone].map((node) => ({
      node,
      version: node.transform.version,
      worldVersion: node.transform.worldVersion,
      world: node.transform.worldMatrix.clone(),
    }));

    const out: RenderItem[] = [];
    const paletteOf = (item: RenderItem): number[] => {
      // TypeDoc's isolated TS 6 pass does not narrow through `expect(...)`.
      if (!isSkinnedUnlitItem(item)) {
        throw new Error("expected skinned-unlit item");
      }
      return Array.from(item.jointMatrices);
    };

    const at0 = buildInterpolatedRenderList(scene, poses, 0, out);
    expect(at0).toHaveLength(1);
    const palette0 = paletteOf(at0[0]);

    const atHalf = buildInterpolatedRenderList(scene, poses, 0.5, out);
    const paletteHalf = paletteOf(atHalf[0]);

    const at1 = buildInterpolatedRenderList(scene, poses, 1, out);
    const palette1 = paletteOf(at1[0]);

    for (const snapshot of before) {
      expect(snapshot.node.transform.version).toBe(snapshot.version);
      expect(snapshot.node.transform.worldVersion).toBe(snapshot.worldVersion);
      expectMatrix(snapshot.node.transform.worldMatrix, snapshot.world, 15);
    }

    skeleton.update(mesh);
    expect(palette1).toEqual(Array.from(skeleton.jointMatrices));

    expect(paletteHalf).not.toEqual(palette1);
    expect(palette0).not.toEqual(palette1);
    expect(paletteHalf.slice(12, 15)).toEqual([0, 2, 0]);

    bone.transform.position.set(0, 0, 0);
    resolveWorldTransforms(scene);
    skeleton.update(mesh);
    expect(palette0).toEqual(Array.from(skeleton.jointMatrices));
  });
});

describe("§46 layer filtering (R-38)", () => {
  it("snapshots each node's mask onto its item, defaulting to the default layer", () => {
    const scene = new Scene();
    const plain = renderable("plain");
    const ui = renderable("ui");
    ui.layers = layerMask("ui");
    scene.add(plain, ui);
    resolveWorldTransforms(scene);

    const list = buildRenderList(scene, []);
    expect(list.map((item) => item.layers)).toEqual([
      DEFAULT_LAYER_MASK,
      layerMask("ui"),
    ]);
  });

  it("is a no-op at the default mask: the list is what it always was", () => {
    const scene = new Scene();
    scene.add(renderable("a"), renderable("b"), renderable("c"));
    resolveWorldTransforms(scene);

    const unfiltered = names(buildRenderList(scene, []), scene);
    const explicit = names(buildRenderList(scene, [], ALL_LAYERS), scene);
    expect(explicit).toEqual(unfiltered);
    expect(explicit).toEqual(["a", "b", "c"]);
  });

  it("drops items whose node shares no layer with the mask", () => {
    const scene = new Scene();
    const world = renderable("world");
    const panel = renderable("panel");
    panel.layers = layerMask("ui");
    scene.add(world, panel);
    resolveWorldTransforms(scene);

    expect(names(buildRenderList(scene, [], layerMask("ui")), scene)).toEqual([
      "panel",
    ]);
    expect(
      names(buildRenderList(scene, [], layerMask(DEFAULT_LAYER_NAME)), scene),
    ).toEqual(["world"]);
    expect(buildRenderList(scene, [], NO_LAYERS)).toHaveLength(0);
  });

  it("keeps a node whose mask overlaps the view's in any bit", () => {
    const scene = new Scene();
    const both = renderable("both");
    both.layers = layerMask(DEFAULT_LAYER_NAME, "ui");
    scene.add(both);
    resolveWorldTransforms(scene);

    expect(names(buildRenderList(scene, [], layerMask("ui")), scene)).toEqual([
      "both",
    ]);
    expect(
      names(buildRenderList(scene, [], layerMask(DEFAULT_LAYER_NAME)), scene),
    ).toEqual(["both"]);
  });

  it("skips the node without pruning its subtree — layers do not inherit", () => {
    const scene = new Scene();
    const group = new Group();
    group.layers = layerMask("ui");
    const child = renderable("child");
    group.add(child);
    const groupRenderable = renderable("group-body");
    groupRenderable.layers = layerMask("ui");
    groupRenderable.add(renderable("nested-child"));
    scene.add(group, groupRenderable);
    resolveWorldTransforms(scene);

    // The `ui` renderable is dropped; the default-layer child *inside* it is
    // not — which is exactly what a subtree-pruning rule would have hidden.
    expect(
      names(buildRenderList(scene, [], layerMask(DEFAULT_LAYER_NAME)), scene),
    ).toEqual(["child", "nested-child"]);
  });

  it("still prunes for visible/enabled, whatever the layer says", () => {
    const scene = new Scene();
    const hidden = new Group();
    hidden.visible = false;
    hidden.add(renderable("hidden-child"));
    scene.add(hidden, renderable("shown"));
    resolveWorldTransforms(scene);

    expect(names(buildRenderList(scene, [], ALL_LAYERS), scene)).toEqual([
      "shown",
    ]);
  });

  it("leaves traversal order untouched — a masked list is a subsequence", () => {
    const scene = new Scene();
    for (const name of ["a", "b", "c", "d"]) {
      const node = renderable(name);
      if (name === "b" || name === "d") {
        node.layers = layerMask("ui");
      }
      scene.add(node);
    }
    resolveWorldTransforms(scene);

    const all = names(buildRenderList(scene, []), scene);
    const masked = names(
      buildRenderList(scene, [], layerMask(DEFAULT_LAYER_NAME)),
      scene,
    );
    expect(all).toEqual(["a", "b", "c", "d"]);
    expect(masked).toEqual(["a", "c"]);
    expect(all.filter((name) => masked.includes(name))).toEqual(masked);
  });

  it("filters the interpolated builder identically", () => {
    const scene = new Scene();
    const world = renderable("world");
    const panel = renderable("panel");
    panel.layers = layerMask("ui");
    scene.add(world, panel);

    const poses = new PoseBuffer();
    poses.track(panel);
    poses.capture();
    panel.transform.position.set(4, 0, 0);
    poses.capture();

    const list = buildInterpolatedRenderList(
      scene,
      poses,
      0.5,
      [],
      layerMask("ui"),
    );
    expect(names(list, scene)).toEqual(["panel"]);
    expect(list[0].layers).toBe(layerMask("ui"));
    // Interpolated, not the live transform: alpha 0.5 of 0 → 4.
    expect(list[0].worldMatrix.elements[12]).toBeCloseTo(2, 12);
  });

  it("reads a drawable with no mask as the default layer, not as no layer", () => {
    const scene = new Scene();
    const legacy = renderable("legacy");
    // A structurally typed drawable predating §46 — the shape a package outside
    // `@fourjs/scene` can implement (`ParticleDrawable`), or a host's own node.
    (legacy as unknown as { layers: number | undefined }).layers = undefined;
    scene.add(legacy);
    resolveWorldTransforms(scene);

    expect(names(buildRenderList(scene, []), scene)).toEqual(["legacy"]);
    expect(buildRenderList(scene, [])[0].layers).toBe(DEFAULT_LAYER_MASK);
    expect(
      names(buildRenderList(scene, [], layerMask(DEFAULT_LAYER_NAME)), scene),
    ).toEqual(["legacy"]);
    expect(buildRenderList(scene, [], layerMask("ui"))).toHaveLength(0);
  });

  it("refuses a malformed mask (§85)", () => {
    const scene = new Scene();
    scene.add(renderable("a"));
    resolveWorldTransforms(scene);

    expect(() => buildRenderList(scene, [], Number.NaN)).toThrow(
      /buildRenderList\(layerMask\)/u,
    );
    expect(() =>
      buildInterpolatedRenderList(scene, new PoseBuffer(), 0.5, [], 1.5),
    ).toThrow(/buildInterpolatedRenderList\(layerMask\)/u);
  });
});

describe("§47/§48 — viewLayerMask (R-38)", () => {
  const camera = new PerspectiveCamera();

  it("prefers the viewport's own mask", () => {
    const view: Viewport = {
      ...createFullscreenViewport(camera),
      layerMask: layerMask("ui"),
    };
    expect(viewLayerMask(view)).toBe(layerMask("ui"));
  });

  it("falls back to the camera when the viewport says nothing", () => {
    const narrowed = new PerspectiveCamera();
    narrowed.layers = layerMask(DEFAULT_LAYER_NAME);
    expect(viewLayerMask(createFullscreenViewport(narrowed))).toBe(
      DEFAULT_LAYER_MASK,
    );
    expect(viewLayerMask(createFullscreenViewport(camera))).toBe(ALL_LAYERS);
  });

  it("reads a camera double that predates the field as ALL_LAYERS", () => {
    // A structurally typed camera built before §46 landed — the case
    // `@fourjs/render-webgl`'s own test double is, and the reason the fallback
    // is not dead code.
    const legacy = Object.assign({}, createFullscreenViewport(camera));
    legacy.camera = Object.assign({}, camera, { layers: undefined });
    expect(viewLayerMask(legacy)).toBe(ALL_LAYERS);
  });

  it("refuses a malformed viewport mask in a development build (§85)", () => {
    const view: Viewport = {
      ...createFullscreenViewport(camera, "minimap"),
      layerMask: Number.NaN,
    };
    // Named by view id, because a frame with several viewports has to say
    // which one. The message is built only on the failing call — see the
    // guard's comment.
    expect(() => viewLayerMask(view)).toThrow(/viewport "minimap"/u);
  });

  it("lets NO_LAYERS mean an empty view rather than falling back", () => {
    const view: Viewport = {
      ...createFullscreenViewport(camera),
      layerMask: NO_LAYERS,
    };
    expect(viewLayerMask(view)).toBe(NO_LAYERS);
  });
});

describe("§49 shadow flags on the item (§69, R-18)", () => {
  it("defaults a renderable to casting and receiving", () => {
    const scene = new Scene();
    const node = renderable("mesh");
    scene.add(node);
    resolveWorldTransforms(scene);

    expect([node.castShadow, node.receiveShadow]).toEqual([true, true]);
    const [item] = buildRenderList(scene, []);
    expect([item.castShadow, item.receiveShadow]).toEqual([true, true]);
  });

  it("takes both flags from options and snapshots them onto the item", () => {
    const scene = new Scene();
    const floor = new Renderable(planeGeometry(), new LitMaterial(), {
      castShadow: false,
    });
    const ghost = new Renderable(boxGeometry(), new LitMaterial(), {
      receiveShadow: false,
    });
    scene.add(floor, ghost);
    resolveWorldTransforms(scene);

    const list = buildRenderList(scene, []);
    expect([list[0].castShadow, list[0].receiveShadow]).toEqual([false, true]);
    expect([list[1].castShadow, list[1].receiveShadow]).toEqual([true, false]);
  });

  it("follows a flag written after construction", () => {
    const scene = new Scene();
    const node = renderable("mesh");
    scene.add(node);
    resolveWorldTransforms(scene);
    expect(buildRenderList(scene, [])[0].castShadow).toBe(true);

    node.castShadow = false;
    expect(buildRenderList(scene, [])[0].castShadow).toBe(false);
  });

  it("reads a drawable predating the fields as casting and receiving", () => {
    // The `!== false` read, and the mirror of the layer-mask case above: a
    // structurally typed drawable written before §69 reports `undefined`, which
    // must mean what a `Renderable` authored today means, not "opted out".
    const scene = new Scene();
    const legacy = renderable("legacy");
    (
      legacy as unknown as {
        castShadow: boolean | undefined;
        receiveShadow: boolean | undefined;
      }
    ).castShadow = undefined;
    (
      legacy as unknown as { receiveShadow: boolean | undefined }
    ).receiveShadow = undefined;
    scene.add(legacy);
    resolveWorldTransforms(scene);

    const [item] = buildRenderList(scene, []);
    expect([item.castShadow, item.receiveShadow]).toEqual([true, true]);
  });

  it("does not let a pooled slot leak one node's flags into another's", () => {
    // The hazard `material = undefined` and `frame = null` exist for, one field
    // family on: items are pooled and rewritten, so both flags are written on
    // *every* renderable rather than only on the ones that opted out.
    const scene = new Scene();
    const first = new Renderable(planeGeometry(), new UnlitMaterial(), {
      castShadow: false,
      receiveShadow: false,
    });
    scene.add(first);
    resolveWorldTransforms(scene);
    const out: RenderItem[] = [];
    buildRenderList(scene, out);
    expect([out[0].castShadow, out[0].receiveShadow]).toEqual([false, false]);

    scene.remove(first);
    scene.add(renderable("second"));
    resolveWorldTransforms(scene);
    buildRenderList(scene, out);
    expect([out[0].castShadow, out[0].receiveShadow]).toEqual([true, true]);
  });
});

/** §36's structural drawable contract, reduced to what a render list reads. */
class ParticlesDouble extends Group {
  readonly isParticleDrawable = true;

  particleCount = 1;

  readonly particleInstances = new Float32Array(PARTICLE_INSTANCE_FLOATS);

  updateParticleInstances(): void {
    // Nothing to repack: this double exists for the item's own fields.
  }
}

describe("§66 sort key 3 — pipeline and material grouping (R-10)", () => {
  /** A renderable carrying a named material, so the grouping is observable. */
  function surface(name: string, material: Material): Renderable<Material> {
    const node = new Renderable(planeGeometry(), material);
    node.name = name;
    return node;
  }

  it("snapshots the material's id onto the item, and empty for a particle system", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    scene.add(new Renderable(planeGeometry(), material));
    resolveWorldTransforms(scene);

    const [item] = buildRenderList(scene, []);

    expect(item.materialId).toBe(material.id);
    expect(material.id).not.toBe("");
  });

  it("reads a material double predating §57's id as one ungrouped group", () => {
    // `undefined < undefined` is false in both directions, which is not a total
    // order — the `?? ""` collapses such doubles into one group instead.
    const scene = new Scene();
    const legacy = new UnlitMaterial();
    (legacy as unknown as { id: string | undefined }).id = undefined;
    scene.add(new Renderable(planeGeometry(), legacy));
    resolveWorldTransforms(scene);

    expect(buildRenderList(scene, [])[0].materialId).toBe("");
  });

  it("does not let a pooled slot leak one item's material id into a particle's", () => {
    // The hazard `material = undefined` and `frame = null` exist for, one field
    // on: the slot that carried a surface must not group a particle system with
    // it.
    const scene = new Scene();
    const first = new Renderable(planeGeometry(), new UnlitMaterial());
    scene.add(first);
    resolveWorldTransforms(scene);
    const out: RenderItem[] = [];
    buildRenderList(scene, out);
    expect(out[0].materialId).not.toBe("");

    scene.remove(first);
    scene.add(new ParticlesDouble());
    resolveWorldTransforms(scene);
    buildRenderList(scene, out);
    expect(out[0].kind).toBe("particles");
    expect(out[0].materialId).toBe("");
  });

  it("leaves buildRenderList's own order alone — key 3 is a second verb", () => {
    const scene = new Scene();
    const sprites = new UnlitMaterial();
    const solid = new UnlitMaterial();
    scene.add(
      surface("a", sprites),
      surface("b", solid),
      surface("c", sprites),
      surface("d", solid),
    );
    resolveWorldTransforms(scene);

    expect(names(buildRenderList(scene, []), scene)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("groups by material inside a layer, preserving order within each group", () => {
    const scene = new Scene();
    const first = new UnlitMaterial();
    const second = new UnlitMaterial();
    scene.add(
      surface("a", first),
      surface("b", second),
      surface("c", first),
      surface("d", second),
    );
    resolveWorldTransforms(scene);

    const list = groupRenderListByPipeline(buildRenderList(scene, []));

    // Ids ascend with construction order, so `first`'s group leads.
    expect(names(list, scene)).toEqual(["a", "c", "b", "d"]);
  });

  it("groups by pipeline before material — the two halves of key 3", () => {
    const scene = new Scene();
    const unlit = new UnlitMaterial();
    const lit = new LitMaterial();
    scene.add(
      surface("unlit-1", unlit),
      surface("lit-1", lit),
      surface("unlit-2", unlit),
      surface("lit-2", lit),
    );
    resolveWorldTransforms(scene);

    const list = groupRenderListByPipeline(buildRenderList(scene, []));

    // `"lit"` sorts before `"unlit"` as a string, which is all §66 asks for:
    // equal pipelines adjacent, in *some* deterministic order.
    expect(names(list, scene)).toEqual([
      "lit-1",
      "lit-2",
      "unlit-1",
      "unlit-2",
    ]);
  });

  it("keeps keys 1 and 2 above it", () => {
    const scene = new Scene();
    const opaque = new UnlitMaterial();
    const blended = new UnlitMaterial({ transparent: true });
    const overlay = surface("overlay", opaque);
    overlay.renderLayer = 1;
    scene.add(overlay, surface("glass", blended), surface("wall", opaque));
    resolveWorldTransforms(scene);

    const list = groupRenderListByPipeline(buildRenderList(scene, []));

    expect(names(list, scene)).toEqual(["wall", "glass", "overlay"]);
  });

  it("is a whole sort, not a refinement — key 2 holds however the list arrived", () => {
    // The list `buildRenderList` hands over is already ordered by keys 1 and 2,
    // so grouping only ever *refines* it in practice. This asserts the stronger
    // property the comparator actually has, by handing it the same items in the
    // opposite order: every opaque draw still precedes every blended one.
    const scene = new Scene();
    const opaque = new UnlitMaterial();
    const blended = new UnlitMaterial({ transparent: true });
    scene.add(
      surface("wall-1", opaque),
      surface("glass-1", blended),
      surface("wall-2", opaque),
      surface("glass-2", blended),
    );
    resolveWorldTransforms(scene);
    const list = buildRenderList(scene, []);
    list.reverse();

    expect(names(groupRenderListByPipeline(list), scene)).toEqual([
      "wall-2",
      "wall-1",
      "glass-2",
      "glass-1",
    ]);
  });

  it("sorts by explicit render order inside one pipeline and material", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    const late = surface("late", material);
    late.renderOrder = 5;
    const early = surface("early", material);
    early.renderOrder = -1;
    scene.add(late, early);
    resolveWorldTransforms(scene);

    const list = groupRenderListByPipeline(buildRenderList(scene, []));

    expect(names(list, scene)).toEqual(["early", "late"]);
  });

  it("is idempotent, and returns the caller's own array", () => {
    const scene = new Scene();
    const first = new UnlitMaterial();
    const second = new UnlitMaterial();
    scene.add(surface("a", first), surface("b", second), surface("c", first));
    resolveWorldTransforms(scene);
    const out: RenderItem[] = [];
    buildRenderList(scene, out);

    const once = groupRenderListByPipeline(out);
    const grouped = names(once, scene);
    const twice = groupRenderListByPipeline(once);

    expect(once).toBe(out);
    expect(names(twice, scene)).toEqual(grouped);
  });

  it("changes nothing for a scene of one pipeline and one material", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    scene.add(
      surface("a", material),
      surface("b", material),
      surface("c", material),
    );
    resolveWorldTransforms(scene);

    const list = groupRenderListByPipeline(buildRenderList(scene, []));

    expect(names(list, scene)).toEqual(["a", "b", "c"]);
  });
});

describe("§66 default sort skip (2026-09-11 audit)", () => {
  function surface(name: string, material: Material): Renderable<Material> {
    const node = new Renderable(planeGeometry(), material);
    node.name = name;
    return node;
  }

  it("leaves a heterogeneous list that is already in §66 order untouched, and still sorts a descending one", () => {
    const material = new UnlitMaterial();
    const glass = new UnlitMaterial();
    glass.transparent = true;

    // Opaque items first, then a transparent one: already the comparator's
    // order, so the output must equal generation order.
    const ordered = new Scene();
    const a = surface("a", material);
    const b = surface("b", material);
    b.renderOrder = 2;
    const c = surface("c", glass);
    ordered.add(a, b, c);
    resolveWorldTransforms(ordered);
    expect(names(buildRenderList(ordered, []), ordered)).toEqual(["a", "b", "c"]);

    // Transparent generated first: the comparator moves it last.
    const descending = new Scene();
    const glassFirst = surface("glass", glass);
    const opaque = surface("opaque", material);
    const late = surface("late", material);
    late.renderOrder = 1;
    const early = surface("early", material);
    early.renderOrder = -1;
    descending.add(glassFirst, opaque, late, early);
    resolveWorldTransforms(descending);
    expect(names(buildRenderList(descending, []), descending)).toEqual([
      "early",
      "opaque",
      "late",
      "glass",
    ]);
  });
});
