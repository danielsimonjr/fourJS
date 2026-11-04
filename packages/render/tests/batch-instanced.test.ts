import { boxGeometry } from "@fourjs/geometry";
import {
  LitMaterial,
  StandardMaterial,
  UnlitMaterial,
} from "@fourjs/materials";
import { Scene, layerMask, resolveWorldTransforms } from "@fourjs/scene";
import { describe, expect, it } from "vitest";

import {
  INSTANCE_FLOATS,
  RenderBatcher,
  Renderable,
  buildRenderList,
  type RenderItem,
} from "../src/index.js";

function listOf(scene: Scene): RenderItem[] {
  resolveWorldTransforms(scene);
  return buildRenderList(scene, []);
}

describe("RenderBatcher.nextInstanced (R-22)", () => {
  const geometry = boxGeometry();

  function sceneOf(count: number, material = new LitMaterial()): Scene {
    const scene = new Scene();
    for (let i = 0; i < count; i += 1) {
      const mesh = new Renderable(geometry, material);
      mesh.transform.position.set(i, 0, 0);
      scene.add(mesh);
    }
    return scene;
  }

  it("finds a run of shaded items sharing geometry and material", () => {
    const run = new RenderBatcher().nextInstanced(listOf(sceneOf(4)), 0);
    expect(run?.items).toBe(4);
    expect(run?.kind).toBe("lit");
    expect(run?.first.kind).toBe("lit");
  });

  it("packs model then normal matrix per instance", () => {
    const scene = new Scene();
    const material = new LitMaterial();
    const a = new Renderable(geometry, material);
    const b = new Renderable(geometry, material);
    a.transform.position.set(1, 2, 3);
    b.transform.scale.set(2, 4, 1);
    scene.add(a, b);
    const run = new RenderBatcher().nextInstanced(listOf(scene), 0);
    const data = run?.instances;
    expect(data).toBeDefined();
    if (data === undefined) return;
    // Instance 0: translation column, identity normal matrix.
    expect(Array.from(data.slice(12, 15))).toEqual([1, 2, 3]);
    expect(Array.from(data.slice(16, 25))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    // Instance 1: non-uniform scale (2, 4, 1) => inverse-transpose (1/2, 1/4, 1).
    const base = INSTANCE_FLOATS;
    expect(data[base]).toBe(2);
    expect(data[base + 16]).toBeCloseTo(0.5);
    expect(data[base + 20]).toBeCloseTo(0.25);
    expect(data[base + 24]).toBeCloseTo(1);
  });

  it("works for standard materials and reports a stable idle stamp", () => {
    const scene = sceneOf(3, new StandardMaterial() as unknown as LitMaterial);
    const items = listOf(scene);
    const batcher = new RenderBatcher();
    const first = batcher.nextInstanced(items, 0);
    expect(first?.kind).toBe("standard");
    const stamp = first?.contentVersion;
    expect(batcher.nextInstanced(items, 0)?.contentVersion).toBe(stamp);
  });

  it("breaks the run at a different material, geometry, kind or layer", () => {
    const scene = new Scene();
    const shared = new LitMaterial();
    scene.add(
      new Renderable(geometry, shared),
      new Renderable(geometry, shared),
    );
    scene.add(new Renderable(geometry, new LitMaterial()));
    scene.add(new Renderable(boxGeometry(), shared));
    const items = listOf(scene);
    const batcher = new RenderBatcher();
    expect(batcher.nextInstanced(items, 0)?.items).toBe(2);
    expect(batcher.nextInstanced(items, 2)).toBeNull();
    const mixed = new Scene();
    mixed.add(
      new Renderable(geometry, shared),
      new Renderable(geometry, new UnlitMaterial()),
    );
    expect(batcher.nextInstanced(listOf(mixed), 0)).toBeNull();
    const layered = sceneOf(3);
    const meshes = layered.children as Renderable[];
    meshes[1].layers = layerMask("r22-other");
    expect(batcher.nextInstanced(listOf(layered), 0)).toBeNull();
  });

  it("breaks at differing receiveShadow and never starts on unlit, lone or masked items", () => {
    const scene = sceneOf(3);
    (scene.children[2] as Renderable).receiveShadow = false;
    const batcher = new RenderBatcher();
    expect(batcher.nextInstanced(listOf(scene), 0)?.items).toBe(2);
    const unlit = new Scene();
    const material = new UnlitMaterial();
    unlit.add(
      new Renderable(geometry, material),
      new Renderable(geometry, material),
    );
    expect(batcher.nextInstanced(listOf(unlit), 0)).toBeNull();
    const items = listOf(sceneOf(2));
    expect(batcher.nextInstanced(items, 0, 0)).toBeNull();
    expect(batcher.nextInstanced(items, 5)).toBeNull();
    expect(batcher.nextInstanced(items, 1)).toBeNull();
  });

  it("refuses items with nothing to draw or a morph target", () => {
    const morphed = boxGeometry();
    morphed.positions1 = new Float32Array(morphed.positions.length);
    const morphScene = new Scene();
    const material = new LitMaterial();
    morphScene.add(
      new Renderable(morphed, material),
      new Renderable(morphed, material),
    );
    const batcher = new RenderBatcher();
    expect(batcher.nextInstanced(listOf(morphScene), 0)).toBeNull();
    const disposable = boxGeometry();
    const plain = new Scene();
    plain.add(
      new Renderable(disposable, material),
      new Renderable(disposable, material),
    );
    const items = listOf(plain);
    disposable.dispose();
    expect(batcher.nextInstanced(items, 0)).toBeNull();
  });

  it("grows its staging array and reuses it afterwards", () => {
    const batcher = new RenderBatcher();
    const items = listOf(sceneOf(40));
    const run = batcher.nextInstanced(items, 0);
    expect(run?.items).toBe(40);
    expect(run?.instances.length).toBeGreaterThanOrEqual(40 * INSTANCE_FLOATS);
    const buffer = run?.instances;
    expect(batcher.nextInstanced(items, 0)?.instances).toBe(buffer);
  });
});
