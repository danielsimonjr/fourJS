/**
 * §60's node materials in the render list (RFC 0001): a `NodeMaterial`
 * generates the `"node"` item kind — decided at item-generation time from the
 * material's own discriminant, like every member of the closed union — and is
 * deliberately excluded from `pipelineOf`'s flat-colour fallback (a graph is
 * a specific picture; an unregistered backend skips, never substitutes).
 */

import { planeGeometry } from "@fourjs/geometry";
import {
  NodeMaterial,
  UnlitMaterial,
  type ShaderGraph,
} from "@fourjs/materials";
import { Scene, resolveWorldTransforms } from "@fourjs/scene";
import { describe, expect, it } from "vitest";

import {
  Renderable,
  buildRenderList,
  groupRenderListByPipeline,
  isNodeItem,
  isUnlitItem,
  type RenderItem,
} from "../src/index.js";

/** A minimal valid surface graph: a constant colour. */
function flatGraph(): ShaderGraph {
  return {
    domain: "surface",
    nodes: [{ kind: "constant", type: "vec4", value: [1, 0, 0, 1] }],
    color: 0,
  };
}

describe("the node item kind (§60, RFC 0001)", () => {
  it("a Renderable carrying a NodeMaterial generates a 'node' item", () => {
    const scene = new Scene();
    const material = new NodeMaterial(flatGraph());
    const node = new Renderable(planeGeometry(), material);
    scene.add(node);
    resolveWorldTransforms(scene);

    const out: RenderItem[] = [];
    buildRenderList(scene, out);

    expect(out).toHaveLength(1);
    const item = out[0];
    expect(item.kind).toBe("node");
    expect(isNodeItem(item)).toBe(true);
    expect(isUnlitItem(item)).toBe(false);
    if (isNodeItem(item)) {
      // The graph and its bindings travel on the material — one property
      // load away, the compact-item rule (§64).
      expect(item.material).toBe(material);
      expect(item.material.graph).toBe(material.graph);
    }
    // §66 keys snapshot exactly as every other surface kind's do.
    expect(item.transparent).toBe(false);
    expect(item.materialId).toBe(material.id);
  });

  it("groups beside — never inside — the other pipelines under key 3", () => {
    const scene = new Scene();
    const nodeMaterial = new NodeMaterial(flatGraph());
    scene.add(
      new Renderable(planeGeometry(), new UnlitMaterial()),
      new Renderable(planeGeometry(), nodeMaterial),
      new Renderable(planeGeometry(), new UnlitMaterial()),
    );
    resolveWorldTransforms(scene);

    const grouped = groupRenderListByPipeline(buildRenderList(scene, []));
    expect(grouped.map((item) => item.kind)).toEqual([
      "node",
      "unlit",
      "unlit",
    ]);
  });

  it("a §67 clip on a node-material renderable masks with its own kind", () => {
    const scene = new Scene();
    const material = new NodeMaterial(flatGraph());
    const panel = new Renderable(planeGeometry(), material);
    panel.clip = true;
    const child = new Renderable(planeGeometry(), new UnlitMaterial());
    panel.add(child);
    scene.add(panel);
    resolveWorldTransforms(scene);

    const out = buildRenderList(scene, []);
    // Mask draw first (key 0), then the panel's own item, then the child.
    expect(out).toHaveLength(3);
    expect(out[0].kind).toBe("node");
    expect(out[0].clip?.maskPass).toBe(true);
    expect(out[1].kind).toBe("node");
    expect(out[1].clip).toBeNull();
    expect(out[2].kind).toBe("unlit");
    expect(out[2].clip?.maskPass).toBe(false);
  });
});
