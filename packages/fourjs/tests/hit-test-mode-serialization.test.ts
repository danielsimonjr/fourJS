/**
 * §71's `hitTestMode` through §79 (A-11, adopted RFC 0005 Q3, 2026-08-29).
 *
 * The field rides `withHitTestMode` — one wrapper around every node-type pair
 * the umbrella ships — so the claims are the wrapper's:
 *
 * 1. a set mode round-trips on every kind of pair (a drawable, a
 *    hand-filtered `Sprite`, a §50 shape, a §73 widget), through JSON *text*;
 * 2. an **unset** mode writes no key at all — a scene that never sets the
 *    field serializes byte-identically to the build before it (the packet's
 *    behaviour-identity obligation), and a document written before this
 *    build restores the default, `null`;
 * 3. a corrupted value — including `"custom"`, §71's one spelled value with
 *    no strategy behind it — restores `null` rather than failing the scene
 *    (the `Sprite` corrupt-field policy, §96's filter-don't-trust rule).
 */

import { planeGeometry, type BufferGeometry } from "@fourjs/geometry";
import {
  SpriteMaterial,
  UnlitMaterial,
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
import { Panel } from "@fourjs/ui";
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

describe("§79 × §71 — hitTestMode round-trips on every umbrella pair", () => {
  it("writes a set mode into the payload and restores it on a Renderable", () => {
    const support = io();
    const exact = new Renderable(plane, flat);
    exact.hitTestMode = "geometry";
    const data = support.write.nodeDataOf(exact) as { hitTestMode?: unknown };
    expect(data.hitTestMode).toBe("geometry");

    const restored = roundTrip(exact);
    expect(restored).toBeInstanceOf(Renderable);
    expect(restored.hitTestMode).toBe("geometry");
  });

  it("restores a Sprite's mode past its hand-filtered options", () => {
    const sprite = new Sprite(decal);
    sprite.hitTestMode = "pixel";
    const restored = roundTrip(sprite);
    expect(restored).toBeInstanceOf(Sprite);
    expect(restored.hitTestMode).toBe("pixel");
  });

  it("restores a §50 shape's mode", () => {
    const shape = new Rectangle({ width: 2, height: 1, material: flat });
    shape.hitTestMode = "gpu";
    const restored = roundTrip(shape);
    expect(restored).toBeInstanceOf(Rectangle);
    expect(restored.hitTestMode).toBe("gpu");
  });

  it("restores a §73 widget's mode — the wrapper covers the UI pair too", () => {
    const panel = new Panel();
    panel.hitTestMode = "bounds";
    const restored = roundTrip(panel);
    expect(restored).toBeInstanceOf(Panel);
    expect(restored.hitTestMode).toBe("bounds");
  });

  it("writes no key for an unset mode — the byte-identity obligation", () => {
    const support = io();
    const data = support.write.nodeDataOf(new Renderable(plane, flat));
    expect(data).toBeDefined();
    expect("hitTestMode" in (data as Record<string, unknown>)).toBe(false);
    expect(roundTrip(new Renderable(plane, flat)).hitTestMode).toBeNull();
  });

  it("reads a pre-A-11 document — no hitTestMode key — as null", () => {
    const support = io();
    const restored = support.read.nodeFactory({
      type: RENDERABLE_NODE_TYPE,
      id: "node-legacy",
      data: { geometry: "geometry/plane", material: "material/flat" },
    });
    expect(restored?.hitTestMode).toBeNull();
  });

  it('restores null for a corrupted value — "custom" included', () => {
    const support = io();
    for (const corrupt of ["custom", true, 3, null] as const) {
      const restored = support.read.nodeFactory({
        type: RENDERABLE_NODE_TYPE,
        id: `node-corrupt-${String(corrupt)}`,
        data: {
          geometry: "geometry/plane",
          material: "material/flat",
          hitTestMode: corrupt,
        },
      });
      expect(restored?.hitTestMode).toBeNull();
    }
  });

  it("does not write a Group's mode — the umbrella has no pair for it", () => {
    // A Group serializes through @fourjs/serialization's own built-in, whose
    // payload the wrapper cannot reach; its mode is runtime state the
    // application that builds the candidate list re-states. Recorded scope,
    // like `clip` on a Group.
    const support = io();
    const group = new Group();
    group.hitTestMode = "geometry";
    expect(support.write.nodeDataOf(group)).toBeUndefined();
  });
});
