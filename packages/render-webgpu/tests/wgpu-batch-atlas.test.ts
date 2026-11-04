/**
 * W11.4: the atlas option reaches the planner through `createWgpuBatching`,
 * the page is a plain `Texture` the existing texture cache uploads, and the
 * counters and disposal pass through.
 */

import { Matrix4 } from "@fourjs/math";
import { Texture, type RenderItem } from "@fourjs/render";
import { describe, expect, it } from "vitest";

import { createWgpuBatching } from "../src/index.js";

function tex(seed: number): Texture {
  return new Texture({
    width: 4,
    height: 4,
    data: new Uint8Array(4 * 4 * 4).fill(seed),
  });
}

function mappedItem(map: Texture): RenderItem {
  return {
    kind: "unlit",
    layers: 1,
    material: { color: [1, 1, 1, 1], map },
    clip: null,
    frame: null,
    worldMatrix: new Matrix4(),
    geometry: {
      vertexCount: 3,
      drawCount: 3,
      mode: "triangles",
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
      colors: undefined,
      indices: undefined,
    },
  } as unknown as RenderItem;
}

describe("WgpuBatching — atlas grouping (W11.4)", () => {
  it("is off without the option", () => {
    const batching = createWgpuBatching();
    const items = [mappedItem(tex(1)), mappedItem(tex(2))];
    expect(batching.next(items, 0)).toBeNull();
    expect(batching.atlasStatistics?.()).toBeNull();
  });

  it("merges distinct textures over one page and reports the counters", () => {
    const batching = createWgpuBatching({ atlas: { pageSize: 32 } });
    const items = [mappedItem(tex(1)), mappedItem(tex(2)), mappedItem(tex(3))];
    const batch = batching.next(items, 0)!;
    expect(batch.items).toBe(3);
    expect(batch.atlased).toBe(true);
    expect(batch.texture).toBeInstanceOf(Texture);
    expect(batch.texture?.width).toBe(32);
    expect(batching.atlasStatistics?.()).toMatchObject({
      pages: 1,
      textures: 3,
      runs: 1,
      items: 3,
      drawsSaved: 2,
    });
    batching.dispose();
    expect(batch.texture?.disposed).toBe(true);
  });
});
