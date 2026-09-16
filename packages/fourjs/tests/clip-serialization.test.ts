/**
 * §67's `clip` flag through §79 (R-23, 2026-08-28).
 *
 * `clip` is written beside the three §49 flags — always, by
 * `renderableFlagsJson`'s recorded rule — and read back through the
 * constructor option every drawable funnels. Three claims:
 *
 * 1. a clipping drawable round-trips clipping, through JSON *text*;
 * 2. a document written before this build (no `clip` key) restores the
 *    default, unclipped — the additive-key rule R-18 established;
 * 3. a corrupted `clip` restores the default rather than failing the scene —
 *    the `Sprite` precedent, and §96's filter-don't-trust rule.
 *
 * `Sprite` is tested by name because its constructor filters options by hand
 * (the other drawables forward `RenderableOptions` wholesale).
 */

import { planeGeometry, type BufferGeometry } from "@fourjs/geometry";
import {
  UnlitMaterial,
  SpriteMaterial,
  type Material,
} from "@fourjs/materials";
import { Rectangle, Renderable, Sprite, Texture } from "@fourjs/render";
import { Group, Scene, type Node } from "@fourjs/scene";
import {
  decodeSceneDocument,
  encodeSceneDocument,
  instantiateScene,
  serializeScene,
} from "@fourjs/serialization";
import { describe, expect, it } from "vitest";

import {
  RENDERABLE_NODE_TYPE,
  registerSceneNodeTypes,
  resourceCatalog,
} from "../src/index.js";

const plane = planeGeometry();
const flat = new UnlitMaterial();
const decal = new SpriteMaterial({
  texture: new Texture({
    width: 1,
    height: 1,
    data: new Uint8Array([255, 255, 255, 255]),
  }),
});

function io() {
  return registerSceneNodeTypes({
    geometries: resourceCatalog<BufferGeometry>([["geometry/plane", plane]]),
    materials: resourceCatalog<Material>([
      ["material/flat", flat],
      ["material/decal", decal],
    ]),
  });
}

/** Serialize → JSON text → instantiate, returning the restored root's child. */
function roundTrip(node: Node): Node {
  const root = new Scene();
  root.add(node);
  const support = io();
  const restored = instantiateScene(
    decodeSceneDocument(
      encodeSceneDocument(
        serializeScene(root, support.components, support.write),
      ),
    ),
    support.components,
    support.read,
  );
  return restored.children[0];
}

describe("§79 × §67 — clip round-trips on every drawable", () => {
  it("writes clip beside the §49 flags and restores it on a Renderable", () => {
    const support = io();
    const clipping = new Renderable(plane, flat, { clip: true });
    const data = support.write.nodeDataOf(clipping) as { clip?: unknown };
    expect(data.clip).toBe(true);

    const restored = roundTrip(clipping);
    expect(restored).toBeInstanceOf(Renderable);
    expect(restored.clip).toBe(true);
  });

  it("restores a clipping Sprite through its hand-filtered options", () => {
    const restored = roundTrip(new Sprite(decal, { clip: true }));
    expect(restored).toBeInstanceOf(Sprite);
    expect(restored.clip).toBe(true);
  });

  it("restores a clipping §50 shape", () => {
    const restored = roundTrip(
      new Rectangle({ width: 2, height: 1, clip: true, material: flat }),
    );
    expect(restored).toBeInstanceOf(Rectangle);
    expect(restored.clip).toBe(true);
  });

  it("restores an unclipped drawable unclipped", () => {
    expect(roundTrip(new Renderable(plane, flat)).clip).toBe(false);
  });

  it("reads a pre-R-23 document — no clip key — as unclipped", () => {
    const support = io();
    const restored = support.read.nodeFactory({
      type: RENDERABLE_NODE_TYPE,
      id: "node-legacy",
      data: { geometry: "geometry/plane", material: "material/flat" },
    });
    expect(restored?.clip).toBe(false);
  });

  it("restores the default for a corrupted clip value", () => {
    const support = io();
    const restored = support.read.nodeFactory({
      type: RENDERABLE_NODE_TYPE,
      id: "node-corrupt",
      data: {
        geometry: "geometry/plane",
        material: "material/flat",
        clip: "yes",
      },
    });
    expect(restored?.clip).toBe(false);
  });

  it("does not write clip on a Group — the field is a drawable's in §79", () => {
    // A Group's clip is warned-inert (§67), so a document does not carry it;
    // the base serializer writes no `data` for a Group at all.
    const support = io();
    const group = new Group();
    group.clip = true;
    expect(support.write.nodeDataOf(group)).toBeUndefined();
  });
});
