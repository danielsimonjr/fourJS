/**
 * §65 atlas grouping — a deterministic shelf packer that lets distinct 2D
 * textures share one GPU texture (W11.4, 2026-11-04).
 *
 * `RenderBatcher` merges consecutive draws that share a material *instance*.
 * Two sprites that differ **only by texture** are two material instances, so
 * that tier ends a run at every texture change. This module is the other half
 * of §65's "atlas grouping": it copies each distinct texture into a fixed-size
 * **page** (an ordinary {@link Texture}) so the batcher can rewrite UVs into
 * the page and draw the whole run with one bind. It owns no GPU resources — a
 * page is uploaded by the backend's existing texture cache like any other
 * texture, with regional `texSubImage2D` / `copyTextureToTexture` updates when
 * only a slot changed, so a still scene re-uploads nothing.
 *
 * ```ts
 * const atlas = new TextureAtlas({ pageSize: 1024 });
 * const entry = atlas.pack(tex);          // null when it cannot be packed
 * // sample (u, v) of `tex` at the page uv:
 * //   ((entry.x + u * entry.width) / atlas.pageSize, (entry.y + v * entry.height) / atlas.pageSize)
 * ```
 *
 * ## What is packable, and why the list is this strict
 *
 * Packing must never change what a draw samples, so a texture is refused
 * ({@link TextureAtlas.canPack}) unless an atlas slot samples **identically**:
 *
 * - **2D, tightly packed RGBA8** (`data.length === width × height × 4`). Cube,
 *   array, volume and compressed textures are other sampler types.
 * - **`clamp-to-edge` wrap.** A repeating or mirrored texture addresses
 *   outside `[0, 1]`, which in a page would read the neighbouring slot.
 * - **No mip chain and no anisotropy.** Minification through mips or an
 *   anisotropic footprint reads texels beyond any fixed padding.
 * - **Smaller than a page** with its padding: `width + 2 <= pageSize`.
 *
 * ## Padding
 *
 * Every slot is surrounded by a **1-texel border of duplicated edge texels**,
 * which is exactly what `clamp-to-edge` would return outside the texture. A
 * bilinear sample reads at most half a texel past the edge, so one texel is
 * enough for `linear` and `nearest` alike and no neighbour ever bleeds in.
 *
 * ## Determinism (§33) and allocation (D7)
 *
 * Placement is a pure function of the order textures reach the packer. A bulk
 * {@link TextureAtlas.packAll} sorts **by height descending, then by texture
 * id ascending** before placing, so one set of textures lands in the same slots
 * regardless of the order a scene lists them in. Shelf choice is
 * best-fit (smallest sufficient shelf height, then lowest `y`); pages are tried
 * in creation order. The lookup `WeakMap` is never iterated. Packing a new
 * texture allocates (a slot record, perhaps a shelf or a page); looking up an
 * already-packed texture, the steady state, allocates nothing.
 *
 * An edited texture of the same size is re-blitted in place. One that changed
 * size is re-packed: its old slot leaves `usedTexels` and joins its page's
 * free list, where a later texture of exactly that padded size reuses it. No
 * other space is reclaimed (shelves are never compacted or merged) until
 * {@link TextureAtlas.clear}.
 */

import { Rectangle2, type ColorSpace } from "@fourjs/math";
import type { MaterialTexture } from "@fourjs/materials";

import { Texture } from "./texture.js";

/** Texels of duplicated edge on every side of a slot. */
export const ATLAS_PADDING = 1;

/** Default page edge in texels — 2048² RGBA8 is 16 MiB. */
export const DEFAULT_ATLAS_PAGE_SIZE = 2048;

/** Default cap on pages one atlas creates. */
export const DEFAULT_ATLAS_MAX_PAGES = 4;

/** Largest page edge accepted (a common `maxTextureSize` floor). */
export const MAX_ATLAS_PAGE_SIZE = 16_384;

/** Construction arguments of {@link TextureAtlas}. */
export interface TextureAtlasOptions {
  /**
   * Page edge in texels; pages are square. An integer in `[4, 16384]`.
   * Default {@link DEFAULT_ATLAS_PAGE_SIZE}.
   *
   * @throws RangeError for anything else (§85: refused, never clamped).
   */
  pageSize?: number;

  /**
   * Most pages the atlas will create (≥ 1). A texture that fits no existing
   * page once the cap is reached is not packed. Default
   * {@link DEFAULT_ATLAS_MAX_PAGES}.
   *
   * @throws RangeError when not a positive integer.
   */
  maxPages?: number;
}

/**
 * Where one texture lives in a page. Stable for the life of the atlas (until
 * {@link TextureAtlas.clear}), which is what lets a batched vertex stream
 * keyed on it stay valid between frames.
 */
export interface AtlasEntry {
  /** The page texture that holds the slot — hand this to the backend. */
  readonly page: Texture;

  /** Index of {@link AtlasEntry.page} in {@link TextureAtlas.pages}. */
  readonly pageIndex: number;

  /** Texel x of the slot's content origin (inside the padding). */
  readonly x: number;

  /** Texel y of the slot's content origin (row 0 is `v = 0`). */
  readonly y: number;

  /** Content width in texels (the source texture's). */
  readonly width: number;

  /** Content height in texels. */
  readonly height: number;
}

/** Counters {@link TextureAtlas.statistics} reports. */
export interface TextureAtlasStatistics {
  /** Pages created. */
  readonly pages: number;
  /** Distinct textures currently packed. */
  readonly textures: number;
  /** Texels occupied by slots including padding. */
  readonly usedTexels: number;
  /** Texels across all pages. */
  readonly capacityTexels: number;
}

interface Shelf {
  y: number;
  height: number;
  cursor: number;
}

interface Page {
  texture: Texture;
  filter: "nearest" | "linear";
  colorSpace: ColorSpace;
  shelves: Shelf[];
  nextY: number;
  /** Abandoned padded slots, reusable by an exact-size request. */
  free: { x: number; y: number; w: number; h: number }[];
}

interface MutableEntry {
  page: Texture;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Source texture version last blitted into the slot. */
  version: number;
}

function filterOf(texture: MaterialTexture): "nearest" | "linear" {
  return texture.filter ?? "linear";
}

function colorSpaceOf(texture: MaterialTexture): ColorSpace {
  return texture.colorSpace ?? "linear";
}

/** Orders by height descending, then id ascending (§33). */
function byHeightThenId(a: MaterialTexture, b: MaterialTexture): number {
  if (a.height !== b.height) return b.height - a.height;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * A set of fixed-size atlas pages and the placement of every texture packed
 * into them. See the module header.
 */
export class TextureAtlas {
  /** Page edge in texels. */
  readonly pageSize: number;

  /** Most pages this atlas creates. */
  readonly maxPages: number;

  readonly #pages: Page[] = [];

  #entries = new WeakMap<MaterialTexture, MutableEntry>();

  #textures = 0;

  #usedTexels = 0;

  readonly #dirty = new Rectangle2();

  readonly #pending: MaterialTexture[] = [];

  constructor(options: TextureAtlasOptions = {}) {
    const pageSize = options.pageSize ?? DEFAULT_ATLAS_PAGE_SIZE;
    if (
      !Number.isInteger(pageSize) ||
      pageSize < 4 ||
      pageSize > MAX_ATLAS_PAGE_SIZE
    ) {
      throw new RangeError(
        `TextureAtlas pageSize must be an integer in [4, ${String(MAX_ATLAS_PAGE_SIZE)}]; got ${String(pageSize)} (§85).`,
      );
    }
    const maxPages = options.maxPages ?? DEFAULT_ATLAS_MAX_PAGES;
    if (!Number.isInteger(maxPages) || maxPages < 1) {
      throw new RangeError(
        `TextureAtlas maxPages must be a positive integer; got ${String(maxPages)} (§85).`,
      );
    }
    this.pageSize = pageSize;
    this.maxPages = maxPages;
  }

  /** The page textures, in creation order. */
  get pages(): readonly Texture[] {
    return this.#pages.map((page) => page.texture);
  }

  /** Snapshot of the packing counters. */
  statistics(): TextureAtlasStatistics {
    return {
      pages: this.#pages.length,
      textures: this.#textures,
      usedTexels: this.#usedTexels,
      capacityTexels: this.#pages.length * this.pageSize * this.pageSize,
    };
  }

  /**
   * Whether `texture` samples identically from a page slot — see the module
   * header's list. Pure; packs nothing.
   */
  canPack(texture: MaterialTexture): boolean {
    const data = texture.data;
    const width = texture.width;
    const height = texture.height;
    const loose = texture as MaterialTexture & {
      format?: string;
      anisotropy?: number;
    };
    return (
      !texture.disposed &&
      (texture.dimension ?? "2d") === "2d" &&
      data !== null &&
      data.length === width * height * 4 &&
      (loose.format ?? "rgba8unorm") === "rgba8unorm" &&
      (texture.wrap ?? "clamp-to-edge") === "clamp-to-edge" &&
      texture.mipmaps !== true &&
      (loose.anisotropy ?? 1) <= 1 &&
      width + 2 * ATLAS_PADDING <= this.pageSize &&
      height + 2 * ATLAS_PADDING <= this.pageSize
    );
  }

  /**
   * The slot of an already-packed `texture`, re-blitting it first when its
   * `version` advanced; `null` when it is not packed (or can no longer be).
   * Allocation-free in the steady state.
   */
  entry(texture: MaterialTexture): AtlasEntry | null {
    const entry = this.#entries.get(texture);
    if (entry === undefined) return null;
    if (entry.version === texture.version) return entry;
    if (
      texture.width === entry.width &&
      texture.height === entry.height &&
      this.canPack(texture)
    ) {
      this.#blit(entry, texture);
      this.#markSlot(entry);
      return entry;
    }
    // Resized (or no longer packable): abandon the slot, place anew.
    this.#entries.delete(texture);
    this.#textures -= 1;
    this.#release(entry);
    return this.pack(texture);
  }

  /**
   * Packs `texture` (or returns its existing slot). `null` when
   * {@link TextureAtlas.canPack} is false or no page has room and
   * {@link TextureAtlas.maxPages} is reached.
   */
  pack(texture: MaterialTexture): AtlasEntry | null {
    const existing = this.entry(texture);
    if (existing !== null) return existing;
    if (!this.canPack(texture)) return null;
    const entry = this.#place(texture);
    if (entry === null) return null;
    this.#markSlot(entry);
    return entry;
  }

  /**
   * Packs the first `count` textures of `textures` that are not packed yet, in
   * **height-descending, id-ascending** order, so the layout does not depend
   * on the order a scene happens to list them. Already-packed and unpackable
   * textures are skipped. One dirty region (the union of the new slots) is
   * announced per page touched.
   */
  packAll(textures: readonly MaterialTexture[], count: number): void {
    const pending = this.#pending;
    pending.length = 0;
    for (let i = 0; i < count; i += 1) {
      const texture = textures[i];
      if (!this.#entries.has(texture) && this.canPack(texture)) {
        pending.push(texture);
      }
    }
    if (pending.length === 0) return;
    pending.sort(byHeightThenId);
    for (let i = 0; i < pending.length; i += 1) {
      const texture = pending[i];
      if (this.#entries.has(texture)) continue;
      const entry = this.#place(texture);
      if (entry !== null) this.#markSlot(entry);
    }
    pending.length = 0;
  }

  /**
   * Forgets every placement and disposes the pages. Existing {@link AtlasEntry}
   * values are stale afterwards; a batcher holding the atlas re-packs on the
   * next frame.
   */
  clear(): void {
    for (const page of this.#pages) page.texture.dispose();
    this.#pages.length = 0;
    this.#entries = new WeakMap();
    this.#textures = 0;
    this.#usedTexels = 0;
  }

  /** Disposes every page (§83). Idempotent. */
  dispose(): void {
    this.clear();
  }

  /** Returns a resized texture's padded slot to its page's free list. */
  #release(entry: MutableEntry): void {
    const padded = 2 * ATLAS_PADDING;
    const w = entry.width + padded;
    const h = entry.height + padded;
    this.#usedTexels -= w * h;
    this.#pages[entry.pageIndex].free.push({
      x: entry.x - ATLAS_PADDING,
      y: entry.y - ATLAS_PADDING,
      w,
      h,
    });
  }

  #place(texture: MaterialTexture): MutableEntry | null {
    const padded = 2 * ATLAS_PADDING;
    const w = texture.width + padded;
    const h = texture.height + padded;
    const filter = filterOf(texture);
    const colorSpace = colorSpaceOf(texture);
    let slotPage: Page | null = null;
    let sx = 0;
    let sy = 0;
    let pageIndex = 0;
    for (let p = 0; p < this.#pages.length && slotPage === null; p += 1) {
      const page = this.#pages[p];
      if (page.filter !== filter || page.colorSpace !== colorSpace) continue;
      const spot = this.#fit(page, w, h);
      if (spot !== null) {
        slotPage = page;
        sx = spot.x;
        sy = spot.y;
        pageIndex = p;
      }
    }
    if (slotPage === null) {
      if (this.#pages.length >= this.maxPages) return null;
      slotPage = this.#createPage(filter, colorSpace);
      pageIndex = this.#pages.length - 1;
      const spot = this.#fit(slotPage, w, h)!;
      sx = spot.x;
      sy = spot.y;
    }
    const entry: MutableEntry = {
      page: slotPage.texture,
      pageIndex,
      x: sx + ATLAS_PADDING,
      y: sy + ATLAS_PADDING,
      width: texture.width,
      height: texture.height,
      version: -1,
    };
    this.#blit(entry, texture);
    this.#entries.set(texture, entry);
    this.#textures += 1;
    this.#usedTexels += w * h;
    return entry;
  }

  /** Reserves a `w × h` padded slot on `page`; `null` when none fits. */
  #fit(page: Page, w: number, h: number): { x: number; y: number } | null {
    const size = this.pageSize;
    const free = page.free;
    for (let i = 0; i < free.length; i += 1) {
      if (free[i].w === w && free[i].h === h) {
        const slot = free[i];
        free[i] = free[free.length - 1];
        free.pop();
        return { x: slot.x, y: slot.y };
      }
    }
    let best: Shelf | null = null;
    for (const shelf of page.shelves) {
      if (
        shelf.height >= h &&
        shelf.cursor + w <= size &&
        (best === null || shelf.height < best.height)
      ) {
        best = shelf;
      }
    }
    if (best === null) {
      if (page.nextY + h > size || w > size) return null;
      best = { y: page.nextY, height: h, cursor: 0 };
      page.shelves.push(best);
      page.nextY += h;
    }
    const spot = { x: best.cursor, y: best.y };
    best.cursor += w;
    return spot;
  }

  #createPage(filter: "nearest" | "linear", colorSpace: ColorSpace): Page {
    const size = this.pageSize;
    const page: Page = {
      texture: new Texture({
        width: size,
        height: size,
        data: new Uint8Array(size * size * 4),
        filter,
        colorSpace,
        wrap: "clamp-to-edge",
      }),
      filter,
      colorSpace,
      shelves: [],
      nextY: 0,
      free: [],
    };
    this.#pages.push(page);
    return page;
  }

  /** Copies `texture`'s texels into the slot, edge-duplicating the padding. */
  #blit(entry: MutableEntry, texture: MaterialTexture): void {
    const src = texture.data!;
    const dst = entry.page.source.data!;
    const size = this.pageSize;
    const w = entry.width;
    const h = entry.height;
    for (let row = -ATLAS_PADDING; row < h + ATLAS_PADDING; row += 1) {
      const sr = row < 0 ? 0 : row >= h ? h - 1 : row;
      let at = ((entry.y + row) * size + entry.x - ATLAS_PADDING) * 4;
      for (let col = -ATLAS_PADDING; col < w + ATLAS_PADDING; col += 1) {
        const sc = col < 0 ? 0 : col >= w ? w - 1 : col;
        const from = (sr * w + sc) * 4;
        dst[at] = src[from];
        dst[at + 1] = src[from + 1];
        dst[at + 2] = src[from + 2];
        dst[at + 3] = src[from + 3];
        at += 4;
      }
    }
    entry.version = texture.version;
  }

  /** Announces the slot (with padding) as the page's changed region. */
  #markSlot(entry: MutableEntry): void {
    this.#dirty.set(
      entry.x - ATLAS_PADDING,
      entry.y - ATLAS_PADDING,
      entry.width + 2 * ATLAS_PADDING,
      entry.height + 2 * ATLAS_PADDING,
    );
    entry.page.markDirty(this.#dirty);
  }
}
