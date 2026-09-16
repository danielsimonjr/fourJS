/**
 * §67 rectangular scissor through §79 — omitted when null, restored when
 * present, dropped when corrupt.
 */

import { planeGeometry, type BufferGeometry } from "@fourjs/geometry";
import { UnlitMaterial, type Material } from "@fourjs/materials";
import { Renderable } from "@fourjs/render";
import { Scene, type Node } from "@fourjs/scene";
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

function io() {
  return registerSceneNodeTypes({
    geometries: resourceCatalog<BufferGeometry>([["geometry/plane", plane]]),
    materials: resourceCatalog<Material>([["material/flat", flat]]),
  });
}

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

describe("§79 × §67 — scissor round-trips on a Renderable", () => {
  it("writes the rectangle and restores it", () => {
    const support = io();
    const boxed = new Renderable(plane, flat, {
      scissor: { x: 8, y: 16, width: 32, height: 24 },
    });
    const data = support.write.nodeDataOf(boxed) as {
      scissor?: { x: number; y: number; width: number; height: number };
    };
    expect(data.scissor).toEqual({ x: 8, y: 16, width: 32, height: 24 });

    const restored = roundTrip(boxed);
    expect(restored).toBeInstanceOf(Renderable);
    expect((restored as Renderable).scissor).toEqual({
      x: 8,
      y: 16,
      width: 32,
      height: 24,
    });
  });

  it("omits the key when the rectangle is null", () => {
    const support = io();
    const data = support.write.nodeDataOf(new Renderable(plane, flat)) as {
      scissor?: unknown;
    };
    expect(data.scissor).toBeUndefined();
    expect(
      (roundTrip(new Renderable(plane, flat)) as Renderable).scissor,
    ).toBeNull();
  });

  it("reads a pre-scissor document as null", () => {
    const support = io();
    const restored = support.read.nodeFactory({
      type: RENDERABLE_NODE_TYPE,
      id: "node-legacy",
      data: { geometry: "geometry/plane", material: "material/flat" },
    });
    expect(restored).toBeInstanceOf(Renderable);
    expect((restored as Renderable).scissor).toBeNull();
  });

  it("drops a corrupted rectangle rather than failing the scene", () => {
    const support = io();
    const restored = support.read.nodeFactory({
      type: RENDERABLE_NODE_TYPE,
      id: "node-corrupt",
      data: {
        geometry: "geometry/plane",
        material: "material/flat",
        scissor: { x: 1, y: 2 },
      },
    });
    expect(restored).toBeInstanceOf(Renderable);
    expect((restored as Renderable).scissor).toBeNull();
  });
});
