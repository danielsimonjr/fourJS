import { BufferGeometry } from "@fourjs/geometry";
import { SpriteMaterial, UnlitMaterial } from "@fourjs/materials";
import { Scene, resolveWorldTransforms } from "@fourjs/scene";
import { describe, expect, it } from "vitest";

import {
  ATLAS_PADDING,
  DEFAULT_ATLAS_PAGE_SIZE,
  RenderBatcher,
  Renderable as RenderableNode,
  Sprite,
  Texture,
  TextureAtlas,
  buildRenderList,
  type RenderBatch,
  type RenderItem,
  type TextureSource,
} from "../src/index.js";

/** A w×h texture whose texel (x, y) is (x+1, y+1, seed, 255). */
function tex(
  width: number,
  height: number,
  seed = 0,
  extra: Partial<TextureSource> = {},
): Texture {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      data[at] = x + 1;
      data[at + 1] = y + 1;
      data[at + 2] = seed;
      data[at + 3] = 255;
    }
  }
  return new Texture({ width, height, data, ...extra });
}

function texelAt(page: Texture, x: number, y: number): number[] {
  const at = (y * page.width + x) * 4;
  return Array.from(page.source.data!.subarray(at, at + 4));
}

describe("TextureAtlas — construction", () => {
  it("defaults and exposes its limits", () => {
    const atlas = new TextureAtlas();
    expect(atlas.pageSize).toBe(DEFAULT_ATLAS_PAGE_SIZE);
    expect(atlas.maxPages).toBe(4);
    expect(atlas.pages).toEqual([]);
    expect(atlas.statistics()).toEqual({
      pages: 0,
      textures: 0,
      usedTexels: 0,
      capacityTexels: 0,
    });
  });

  it("refuses bad page sizes and page caps (§85)", () => {
    expect(() => new TextureAtlas({ pageSize: 3 })).toThrow(RangeError);
    expect(() => new TextureAtlas({ pageSize: 4.5 })).toThrow(RangeError);
    expect(() => new TextureAtlas({ pageSize: 32_768 })).toThrow(RangeError);
    expect(() => new TextureAtlas({ maxPages: 0 })).toThrow(RangeError);
    expect(() => new TextureAtlas({ maxPages: 1.5 })).toThrow(RangeError);
  });
});

describe("TextureAtlas — canPack", () => {
  const atlas = new TextureAtlas({ pageSize: 16 });

  it("accepts a plain clamped RGBA8 2D texture", () => {
    expect(atlas.canPack(tex(4, 4))).toBe(true);
    expect(atlas.canPack(tex(14, 14))).toBe(true);
  });

  it("rejects what would sample differently from a slot", () => {
    expect(atlas.canPack(tex(15, 4))).toBe(false); // wider than a page less padding
    expect(atlas.canPack(tex(4, 15))).toBe(false);
    expect(atlas.canPack(tex(4, 4, 0, { wrap: "repeat" }))).toBe(false);
    expect(atlas.canPack(tex(4, 4, 0, { wrap: "mirrored-repeat" }))).toBe(
      false,
    );
    expect(atlas.canPack(tex(4, 4, 0, { mipmaps: true }))).toBe(false);
    expect(atlas.canPack(tex(4, 4, 0, { anisotropy: 4 }))).toBe(false);
    expect(atlas.canPack(new Texture({ width: 4, height: 4 }))).toBe(false); // no data
    const disposed = tex(4, 4);
    disposed.dispose();
    expect(atlas.canPack(disposed)).toBe(false);
    const cube = new Texture({
      width: 2,
      height: 2,
      dimension: "cube",
      data: new Uint8Array(2 * 2 * 4 * 6),
    });
    expect(atlas.canPack(cube)).toBe(false);
    expect(
      atlas.canPack({
        id: "x",
        data: new Uint8Array(16),
        width: 2,
        height: 2,
        format: "bc7",
        version: 0,
        disposed: false,
      } as never),
    ).toBe(false);
  });
});

describe("TextureAtlas — packing", () => {
  it("copies texels into the slot and edge-duplicates a 1-texel border", () => {
    const atlas = new TextureAtlas({ pageSize: 16 });
    const t = tex(3, 2);
    const entry = atlas.pack(t)!;
    expect(entry).not.toBeNull();
    expect(entry.width).toBe(3);
    expect(entry.height).toBe(2);
    expect(entry.x).toBe(ATLAS_PADDING);
    expect(entry.y).toBe(ATLAS_PADDING);
    expect(entry.pageIndex).toBe(0);
    const page = entry.page;
    // Content.
    expect(texelAt(page, 1, 1)).toEqual([1, 1, 0, 255]);
    expect(texelAt(page, 3, 2)).toEqual([3, 2, 0, 255]);
    // Edges and corners replicate the nearest content texel.
    expect(texelAt(page, 0, 1)).toEqual([1, 1, 0, 255]);
    expect(texelAt(page, 4, 2)).toEqual([3, 2, 0, 255]);
    expect(texelAt(page, 2, 0)).toEqual([2, 1, 0, 255]);
    expect(texelAt(page, 2, 3)).toEqual([2, 2, 0, 255]);
    expect(texelAt(page, 0, 0)).toEqual([1, 1, 0, 255]);
    expect(texelAt(page, 4, 3)).toEqual([3, 2, 0, 255]);
    // Outside the padded slot stays untouched.
    expect(texelAt(page, 5, 1)).toEqual([0, 0, 0, 0]);
  });

  it("returns the same slot for the same texture and announces a region", () => {
    const atlas = new TextureAtlas({ pageSize: 16 });
    const a = tex(3, 3);
    const first = atlas.pack(a)!;
    expect(atlas.pack(a)).toBe(first);
    expect(atlas.entry(a)).toBe(first);
    const second = atlas.pack(tex(3, 3))!;
    const version = second.page.version;
    expect(version).toBeGreaterThan(0);
    // The first slot's region is regional since the version before it.
    const region = first.page.getDirtyRegion(version - 1);
    expect(region).toMatchObject({ x: 5, y: 0, width: 5, height: 5 });
  });

  it("returns null for the unpackable and for unknown textures", () => {
    const atlas = new TextureAtlas({ pageSize: 8 });
    expect(atlas.pack(tex(8, 8))).toBeNull();
    expect(atlas.entry(tex(2, 2))).toBeNull();
    expect(atlas.statistics().pages).toBe(0);
  });

  it("re-blits an edited texture in place and re-packs a resized one", () => {
    const atlas = new TextureAtlas({ pageSize: 16 });
    const t = tex(3, 3);
    const entry = atlas.pack(t)!;
    const before = entry.page.version;
    t.source.data![0] = 99;
    t.markDirty();
    expect(atlas.entry(t)).toBe(entry);
    expect(texelAt(entry.page, 1, 1)[0]).toBe(99);
    expect(entry.page.version).toBeGreaterThan(before);

    t.source = {
      width: 4,
      height: 4,
      data: new Uint8Array(4 * 4 * 4).fill(7),
    };
    const moved = atlas.entry(t)!;
    expect(moved).not.toBe(entry);
    expect(moved.width).toBe(4);
    expect(texelAt(moved.page, moved.x, moved.y)).toEqual([7, 7, 7, 7]);
    expect(atlas.statistics().textures).toBe(1);

    t.source = {
      width: 4,
      height: 4,
      wrap: "repeat",
      data: new Uint8Array(64),
    };
    expect(atlas.entry(t)).toBeNull();
    expect(atlas.statistics().textures).toBe(0);
  });

  it("opens new shelves, fills a shelf, and best-fits the smallest shelf", () => {
    const atlas = new TextureAtlas({ pageSize: 16 });
    const tall = atlas.pack(tex(4, 8))!; // padded 6x10 -> shelf 0 (h 10)
    const short = atlas.pack(tex(4, 2))!; // padded 6x4 -> shelf 0 fits (h<=10)
    expect(short.y).toBe(tall.y);
    expect(short.x).toBe(tall.x + 6);
    // Third on shelf 0 (cursor 12, width 6 > 16-12=4) -> opens shelf 1 at y 10.
    const wide = atlas.pack(tex(4, 1))!;
    expect(wide.y).toBe(10 + ATLAS_PADDING);
    // Another small one: both shelves fit by height; smallest (shelf 1, h 3) wins.
    const next = atlas.pack(tex(2, 1))!;
    expect(next.y).toBe(wide.y);
  });

  it("creates new pages, separates samplers, and honours maxPages", () => {
    const atlas = new TextureAtlas({ pageSize: 8, maxPages: 2 });
    const a = atlas.pack(tex(6, 6))!;
    const b = atlas.pack(tex(6, 6))!; // no room on page 0 -> page 1
    expect(a.pageIndex).toBe(0);
    expect(b.pageIndex).toBe(1);
    expect(atlas.pack(tex(6, 6))).toBeNull(); // cap reached
    expect(atlas.pages).toHaveLength(2);
    expect(atlas.pages[0]).toBe(a.page);

    const mixed = new TextureAtlas({ pageSize: 16 });
    const lin = mixed.pack(tex(2, 2))!;
    const near = mixed.pack(tex(2, 2, 0, { filter: "nearest" }))!;
    const srgb = mixed.pack(tex(2, 2, 0, { colorSpace: "srgb" }))!;
    expect(new Set([lin.pageIndex, near.pageIndex, srgb.pageIndex]).size).toBe(
      3,
    );
    expect(near.page.filter).toBe("nearest");
    expect(srgb.page.colorSpace).toBe("srgb");
  });

  it("packAll sorts by height then id: layout is independent of arrival order", () => {
    const make = () => [tex(4, 2), tex(4, 6), tex(4, 6), tex(4, 4), tex(4, 2)];
    const layout = (order: number[]) => {
      const textures = make();
      const atlas = new TextureAtlas({ pageSize: 32 });
      atlas.packAll(
        order.map((i) => textures[i]),
        order.length,
      );
      return textures.map((t) => {
        const e = atlas.entry(t)!;
        return [e.pageIndex, e.x, e.y];
      });
    };
    // Textures are created in the same order in each call, so ids ascend by
    // index; permuting the arrival order must not move any of them.
    expect(layout([4, 3, 2, 1, 0])).toEqual(layout([0, 1, 2, 3, 4]));
    expect(layout([2, 0, 4, 1, 3])).toEqual(layout([0, 1, 2, 3, 4]));
    // Tallest first: the two height-6 textures share the first shelf.
    const textures = make();
    const atlas = new TextureAtlas({ pageSize: 32 });
    atlas.packAll(textures, textures.length);
    expect(atlas.entry(textures[1])!.y).toBe(1);
    expect(atlas.entry(textures[2])!.y).toBe(1);
  });

  it("packAll skips packed, duplicate and unpackable textures", () => {
    const atlas = new TextureAtlas({ pageSize: 16 });
    const a = tex(2, 2);
    const repeat = tex(2, 2, 0, { wrap: "repeat" });
    const entry = atlas.pack(a)!;
    atlas.packAll([a, a, repeat, a], 4);
    atlas.packAll([], 0);
    expect(atlas.entry(a)).toBe(entry);
    expect(atlas.statistics().textures).toBe(1);
    const b = tex(2, 2);
    atlas.packAll([b, b], 2);
    expect(atlas.statistics().textures).toBe(2);
    // Overflow: a texture the pages cannot take leaves no entry.
    const full = new TextureAtlas({ pageSize: 8, maxPages: 1 });
    const x = tex(6, 6);
    const y = tex(6, 6);
    full.packAll([x, y], 2);
    expect(full.entry(x)).not.toBeNull();
    expect(full.entry(y)).toBeNull();
  });

  it("returns a resized texture's slot: usedTexels drops and the slot is reused at the same size", () => {
    const atlas = new TextureAtlas({ pageSize: 16 });
    const t = tex(3, 3);
    const keep = tex(2, 2);
    atlas.pack(keep);
    const first = atlas.pack(t)!;
    expect(atlas.statistics().usedTexels).toBe(16 + 25);
    t.source = {
      width: 5,
      height: 5,
      data: new Uint8Array(5 * 5 * 4).fill(3),
    };
    const moved = atlas.entry(t)!;
    // The 3x3 slot (25 padded texels) left the count; the 5x5 one (49) joined.
    expect(atlas.statistics()).toMatchObject({
      textures: 2,
      usedTexels: 16 + 49,
    });
    // Another 3x3 texture takes the freed slot rather than fresh shelf space.
    const other = atlas.pack(tex(3, 3))!;
    expect(other.x).toBe(first.x);
    expect(other.y).toBe(first.y);
    expect(moved.x !== first.x || moved.y !== first.y).toBe(true);
    expect(atlas.statistics().usedTexels).toBe(16 + 49 + 25);
  });

  it("reports statistics, clears and disposes", () => {
    const atlas = new TextureAtlas({ pageSize: 16 });
    atlas.pack(tex(2, 2));
    atlas.pack(tex(3, 3));
    expect(atlas.statistics()).toEqual({
      pages: 1,
      textures: 2,
      usedTexels: 16 + 25,
      capacityTexels: 256,
    });
    const page = atlas.pages[0];
    atlas.clear();
    expect(page.disposed).toBe(true);
    expect(atlas.statistics().pages).toBe(0);
    expect(atlas.pack(tex(2, 2))!.pageIndex).toBe(0);
    atlas.dispose();
    atlas.dispose();
    expect(atlas.pages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The batcher's atlas tier.
// ---------------------------------------------------------------------------

function listOf(scene: Scene): RenderItem[] {
  resolveWorldTransforms(scene);
  return buildRenderList(scene, []);
}

function sprite(
  texture: Texture,
  options: { tint?: [number, number, number, number]; x?: number } = {},
): Sprite {
  const material = new SpriteMaterial({ texture, tint: options.tint });
  const node = new Sprite(material, { width: 2, height: 2 });
  node.transform.position.set(options.x ?? 0, 0, 0);
  return node;
}

function uvsOf(batch: RenderBatch): number[] {
  const out: number[] = [];
  for (let v = 0; v < batch.vertexCount; v += 1) {
    out.push(
      batch.vertices[v * batch.floatsPerVertex + 3],
      batch.vertices[v * batch.floatsPerVertex + 4],
    );
  }
  return out;
}

function uvQuad(minU = 0, maxU = 1): BufferGeometry {
  return new BufferGeometry({
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
    uvs: new Float32Array([minU, 0, maxU, 0, maxU, 1, minU, 1]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  });
}

describe("RenderBatcher — atlas planning (wave 11)", () => {
  it("packs nothing for a candidate that fails its cheap checks", () => {
    const a = tex(4, 4, 1);
    const b = tex(4, 4, 2);
    const scene = new Scene();
    scene.add(
      new RenderableNode(uvQuad(0, 1), new UnlitMaterial({ map: a })),
      new RenderableNode(uvQuad(-0.5, 1.5), new UnlitMaterial({ map: b })),
    );
    const batcher = new RenderBatcher({ atlas: { pageSize: 32 } });
    expect(batcher.next(listOf(scene), 0)).toBeNull();
    expect(batcher.atlas!.statistics()).toMatchObject({
      pages: 0,
      textures: 0,
      usedTexels: 0,
    });
  });

  it("scans a geometry's uvs once per version, not once per frame", () => {
    const a = tex(4, 4, 1);
    const b = tex(4, 4, 2);
    const g1 = uvQuad(0, 1);
    const g2 = uvQuad(0, 1);
    let reads = 0;
    for (const g of [g1, g2]) {
      const real = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(g) as object,
        "uvs",
      )!;
      Object.defineProperty(g, "uvs", {
        get() {
          reads += 1;
          return (real.get as () => Float32Array).call(g);
        },
      });
    }
    const scene = new Scene();
    scene.add(
      new RenderableNode(g1, new UnlitMaterial({ map: a })),
      new RenderableNode(g2, new UnlitMaterial({ map: b })),
    );
    const batcher = new RenderBatcher({ atlas: { pageSize: 32 } });
    expect(batcher.next(listOf(scene), 0)!.items).toBe(2);
    const afterFirst = reads;
    expect(afterFirst).toBeGreaterThan(0);
    batcher.next(listOf(scene), 0);
    batcher.next(listOf(scene), 0);
    // Frames 2 and 3 only read uvs to copy them into the stream (2 per frame
    // per geometry at most), never to rescan them for range.
    const perFrame = reads - afterFirst;
    expect(perFrame).toBeLessThanOrEqual(2 * 2 * 2);
    // An edit bumps the version and re-validates (here: now out of range).
    g1.uvs![0] = -1;
    g1.markDirty();
    expect(batcher.next(listOf(scene), 0)).toBeNull();
  });

  it("re-binds a repacked page: batch.texture follows the page even when contentVersion is unchanged", () => {
    const a = tex(4, 4, 1);
    const b = tex(4, 4, 2);
    const scene = new Scene();
    scene.add(sprite(a), sprite(b, { x: 3 }));
    const batcher = new RenderBatcher({ atlas: { pageSize: 32 } });
    const list = listOf(scene);
    const first = batcher.next(list, 0)!;
    const version = first.contentVersion;
    const oldPage = first.texture;
    batcher.atlas!.clear();
    const second = batcher.next(list, 0)!;
    expect(second.contentVersion).toBe(version); // identical layout, same stamp
    expect(second.texture).not.toBe(oldPage); // yet the page object is new
    expect(second.texture).toBe(batcher.atlas!.entry(a)!.page);
  });
});

describe("RenderBatcher — atlas grouping (W11.4)", () => {
  it("is off by default: distinct textures do not merge", () => {
    const scene = new Scene();
    scene.add(sprite(tex(4, 4)), sprite(tex(4, 4)));
    const batcher = new RenderBatcher();
    expect(batcher.next(listOf(scene), 0)).toBeNull();
    expect(batcher.atlas).toBeNull();
    expect(batcher.atlasStatistics()).toBeNull();
    batcher.resetAtlasStatistics();
    batcher.dispose();
  });

  it("merges sprites differing only by texture and rewrites uvs into the page", () => {
    const a = tex(4, 4, 1);
    const b = tex(8, 4, 2);
    const scene = new Scene();
    scene.add(sprite(a), sprite(b, { x: 3 }));
    const batcher = new RenderBatcher({ atlas: { pageSize: 32 } });
    const batch = batcher.next(listOf(scene), 0)!;
    expect(batch.items).toBe(2);
    expect(batch.atlased).toBe(true);
    expect(batch.hasUvs).toBe(true);
    const entryA = batcher.atlas!.entry(a)!;
    const entryB = batcher.atlas!.entry(b)!;
    expect(batch.texture).toBe(entryA.page);
    expect(entryB.page).toBe(entryA.page);
    // Corner uvs map onto the packed rectangle in page space.
    const uvs = uvsOf(batch);
    expect(uvs[0]).toBeCloseTo(entryA.x / 32, 6);
    expect(uvs[1]).toBeCloseTo(entryA.y / 32, 6);
    expect(uvs[4]).toBeCloseTo((entryA.x + 4) / 32, 6);
    expect(uvs[5]).toBeCloseTo((entryA.y + 4) / 32, 6);
    expect(uvs[8]).toBeCloseTo(entryB.x / 32, 6);
    expect(uvs[12]).toBeCloseTo((entryB.x + 8) / 32, 6);
    expect(uvs[13]).toBeCloseTo((entryB.y + 4) / 32, 6);
    expect(batcher.atlasStatistics()).toMatchObject({
      pages: 1,
      textures: 2,
      runs: 1,
      items: 2,
      drawsSaved: 1,
    });
    batcher.resetAtlasStatistics();
    expect(batcher.atlasStatistics()).toMatchObject({ runs: 0, drawsSaved: 0 });
    batcher.dispose();
  });

  it("counts same-material segments as saved draws and keeps a repeated texture packed once", () => {
    const a = tex(4, 4, 1);
    const b = tex(4, 4, 2);
    const matA = new SpriteMaterial({ texture: a });
    const matB = new SpriteMaterial({ texture: b });
    const scene = new Scene();
    const make = (m: SpriteMaterial, x: number) => {
      const s = new Sprite(m, { width: 2, height: 2 });
      s.transform.position.set(x, 0, 0);
      return s;
    };
    scene.add(make(matA, 0), make(matA, 1), make(matB, 2), make(matA, 3));
    const batcher = new RenderBatcher({ atlas: { pageSize: 32 } });
    const batch = batcher.next(listOf(scene), 0)!;
    expect(batch.items).toBe(4);
    expect(batcher.atlasStatistics()).toMatchObject({
      textures: 2,
      drawsSaved: 2, // segments A, B, A -> 3 draws before, 1 now
    });
  });

  it("respects an authored uv rect", () => {
    const a = tex(8, 4, 1);
    const b = tex(8, 4, 2);
    const scene = new Scene();
    const ma = new UnlitMaterial({ map: a });
    const mb = new UnlitMaterial({ map: b });
    scene.add(
      new RenderableNode(uvQuad(0.25, 0.75), ma),
      new RenderableNode(uvQuad(0.25, 0.75), mb),
    );
    const batcher = new RenderBatcher({ atlas: { pageSize: 32 } });
    const batch = batcher.next(listOf(scene), 0)!;
    expect(batch.kind).toBe("unlit");
    expect(batch.items).toBe(2);
    const e = batcher.atlas!.entry(a)!;
    const uvs = uvsOf(batch);
    expect(uvs[0]).toBeCloseTo((e.x + 0.25 * 8) / 32, 6);
    expect(uvs[2]).toBeCloseTo((e.x + 0.75 * 8) / 32, 6);
  });

  it("ends the run at a state difference, a refused texture, bad uvs or another sampler", () => {
    const run = (nodes: (RenderableNode | Sprite)[]) => {
      const scene = new Scene();
      scene.add(...nodes);
      const batcher = new RenderBatcher({ atlas: { pageSize: 32 } });
      const batch = batcher.next(listOf(scene), 0);
      return batch === null ? 0 : batch.items;
    };
    const t = () => tex(4, 4);
    // Baseline: three distinct textures merge.
    expect(run([sprite(t()), sprite(t()), sprite(t())])).toBe(3);
    // Tint differs.
    expect(
      run([sprite(t()), sprite(t()), sprite(t(), { tint: [1, 0, 0, 1] })]),
    ).toBe(2);
    // Repeat wrap texture: refused.
    expect(run([sprite(t()), sprite(tex(4, 4, 0, { wrap: "repeat" }))])).toBe(
      0,
    );
    // Different filter.
    expect(
      run([sprite(t()), sprite(tex(4, 4, 0, { filter: "nearest" }))]),
    ).toBe(0);
    // Different colour space.
    expect(
      run([sprite(t()), sprite(tex(4, 4, 0, { colorSpace: "srgb" }))]),
    ).toBe(0);
    // First item's texture unpackable.
    expect(run([sprite(tex(4, 4, 0, { mipmaps: true })), sprite(t())])).toBe(0);
    // Material state differences.
    const mk = (props: ConstructorParameters<typeof SpriteMaterial>[0]) =>
      new Sprite(new SpriteMaterial(props), { width: 2, height: 2 });
    const base = { texture: t() };
    for (const diff of [
      { opacity: 0.5 },
      { blendMode: "additive" as const },
      { transparent: true },
      { depthTest: false },
      { depthWrite: false },
      { colorWrite: false },
    ]) {
      expect(run([mk(base), mk({ texture: t(), ...diff })])).toBe(0);
    }
    // uvs outside [0, 1] or missing end the run.
    const um = (m: UnlitMaterial, g: BufferGeometry) =>
      new RenderableNode(g, m);
    expect(
      run([
        um(new UnlitMaterial({ map: t() }), uvQuad()),
        um(new UnlitMaterial({ map: t() }), uvQuad(0, 2)),
      ]),
    ).toBe(0);
    expect(
      run([
        um(new UnlitMaterial({ map: t() }), uvQuad()),
        um(
          new UnlitMaterial({ map: t() }),
          new BufferGeometry({
            positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          }),
        ),
      ]),
    ).toBe(0);
    // Unlit: colour, vertexColors, missing map differ.
    expect(
      run([
        um(new UnlitMaterial({ map: t() }), uvQuad()),
        um(new UnlitMaterial({ map: t(), color: [0, 1, 0, 1] }), uvQuad()),
      ]),
    ).toBe(0);
    expect(
      run([
        um(new UnlitMaterial({ map: t() }), uvQuad()),
        um(new UnlitMaterial({ map: t(), vertexColors: true }), uvQuad()),
      ]),
    ).toBe(0);
    expect(
      run([
        um(new UnlitMaterial({ map: t() }), uvQuad()),
        um(new UnlitMaterial(), uvQuad()),
      ]),
    ).toBe(0);
  });

  it("does not atlas a run whose items all share one material", () => {
    const scene = new Scene();
    const material = new SpriteMaterial({ texture: tex(4, 4) });
    scene.add(
      new Sprite(material, { width: 2, height: 2 }),
      new Sprite(material, { width: 2, height: 2 }),
    );
    const batcher = new RenderBatcher({ atlas: { pageSize: 32 } });
    const batch = batcher.next(listOf(scene), 0)!;
    expect(batch.atlased).toBe(false);
    expect(batch.texture).toBe(material.texture);
    expect(batcher.atlasStatistics()?.runs).toBe(0);
  });

  it("falls back to the same-material run when the extension cannot be built", () => {
    const material = new SpriteMaterial({ texture: tex(4, 4) });
    const scene = new Scene();
    const other = sprite(tex(4, 4));
    scene.add(
      new Sprite(material, { width: 2, height: 2 }),
      new Sprite(material, { width: 2, height: 2 }),
      other,
    );
    const batcher = new RenderBatcher({ atlas: { pageSize: 32 } });
    // The extension includes `other`.
    expect(batcher.next(listOf(scene), 0)!.items).toBe(3);
    // A scene where the first texture cannot be packed keeps the old run.
    const scene2 = new Scene();
    const big = new SpriteMaterial({ texture: tex(40, 4) });
    scene2.add(
      new Sprite(big, { width: 2, height: 2 }),
      new Sprite(big, { width: 2, height: 2 }),
      sprite(tex(4, 4)),
    );
    const b2 = new RenderBatcher({ atlas: { pageSize: 32 } }).next(
      listOf(scene2),
      0,
    )!;
    expect(b2.items).toBe(2);
    expect(b2.atlased).toBe(false);
  });

  it("splits the run where a texture lands on another page", () => {
    const scene = new Scene();
    scene.add(
      sprite(tex(10, 10, 1)),
      sprite(tex(10, 10, 2)),
      sprite(tex(10, 10, 3)),
      sprite(tex(10, 10, 4)),
    );
    // 16x16 pages hold one 12x12 slot each.
    const batcher = new RenderBatcher({ atlas: { pageSize: 16, maxPages: 4 } });
    const items = listOf(scene);
    expect(batcher.next(items, 0)).toBeNull(); // each on its own page: no run
    expect(batcher.atlasStatistics()?.pages).toBe(4);
    // Cap the pages: later textures are refused and end the run.
    const capped = new RenderBatcher({ atlas: { pageSize: 16, maxPages: 1 } });
    expect(capped.next(items, 0)).toBeNull();
  });

  it("stamps a stable contentVersion and re-stamps when the slot changes", () => {
    const a = tex(4, 4, 1);
    const b = tex(4, 4, 2);
    const scene = new Scene();
    scene.add(sprite(a), sprite(b, { x: 3 }));
    const items = listOf(scene);
    const batcher = new RenderBatcher({ atlas: { pageSize: 32 } });
    const first = batcher.next(items, 0)!.contentVersion!;
    const pageVersion = batcher.atlas!.pages[0].version;
    expect(first).toBeGreaterThan(0);
    expect(batcher.next(items, 0)!.contentVersion).toBe(first);
    // A still scene re-uploads nothing: the page version did not move either.
    expect(batcher.atlas!.pages[0].version).toBe(pageVersion);
    // Editing texel data re-blits and bumps the page, not the vertex stamp.
    a.source.data![0] = 200;
    a.markDirty();
    batcher.next(items, 0);
    expect(batcher.atlas!.pages[0].version).toBeGreaterThan(pageVersion);
  });

  it("caps a run at maxVertices and skips layer-masked items", () => {
    const scene = new Scene();
    scene.add(sprite(tex(4, 4)), sprite(tex(4, 4)), sprite(tex(4, 4)));
    const batcher = new RenderBatcher({
      atlas: { pageSize: 32 },
      maxVertices: 8,
    });
    expect(batcher.next(listOf(scene), 0)!.items).toBe(2);
    const masked = new RenderBatcher({ atlas: { pageSize: 32 } });
    expect(masked.next(listOf(scene), 0, 0)).toBeNull();
    const off = new Scene();
    const hidden = sprite(tex(4, 4));
    hidden.layers = 2;
    off.add(sprite(tex(4, 4)), sprite(tex(4, 4)), hidden);
    expect(masked.next(listOf(off), 0, 1)!.items).toBe(2);
  });

  it("breaks the run at differing clip and scissor", () => {
    const scene = new Scene();
    const a = sprite(tex(4, 4));
    const b = sprite(tex(4, 4));
    scene.add(a, b);
    const items = listOf(scene);
    const batcher = new RenderBatcher({ atlas: { pageSize: 32 } });
    expect(batcher.next(items, 0)!.items).toBe(2);
    items[1].scissor = { x: 0, y: 0, width: 1, height: 1 } as never;
    expect(batcher.next(items, 0)).toBeNull();
    items[1].scissor = items[0].scissor;
    items[1].clip = {} as never;
    expect(batcher.next(items, 0)).toBeNull();
  });
});
