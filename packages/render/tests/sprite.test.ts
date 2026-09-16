/**
 * Unit tests for §77's `Texture`, §55's `Sprite`, and the sprite half of §64's
 * render list.
 *
 * Three things are being pinned here, and it is worth naming them because they
 * are the contracts the WebGL backend and §56's text tier both build on:
 *
 * 1. **Lifecycle and versioning.** A texture's `version` is a backend's cache
 *    key (§53's contract, reused verbatim by §77), so every mutation that a
 *    backend must notice has to advance it, and no mutation that a backend must
 *    *not* re-upload for may.
 * 2. **The quad is a function of anchor and size.** The vertex positions are
 *    asserted directly for the corner anchors, because the anchor convention
 *    (`(0,0)` = bottom-left, Y-up per §7a) is the sort of thing that is
 *    off-by-one-flip forever if nobody writes it down as numbers.
 * 3. **The render list discriminates.** A sprite item must arrive with
 *    `kind: "sprite"` and a `SpriteMaterial`, side by side with unlit items and
 *    sorted by the same §66 keys — that discriminant is the only thing standing
 *    between a textured quad and the flat-colour pipeline.
 */

import { isFourError } from "@fourjs/core";
import { planeGeometry } from "@fourjs/geometry";
import { SpriteMaterial, UnlitMaterial } from "@fourjs/materials";
import { PoseBuffer, Scene } from "@fourjs/scene";
import { describe, expect, it } from "vitest";

import {
  Renderable,
  Sprite,
  Texture,
  buildInterpolatedRenderList,
  buildRenderList,
  groupSpritesByTexture,
  isSpriteItem,
  isUnlitItem,
  type RenderItem,
  type SpriteRenderItem,
  type TextureSource,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

/** A 2×2 RGBA8 source: four texels, sixteen bytes. */
function checkerSource(): TextureSource {
  return {
    width: 2,
    height: 2,
    // prettier-ignore
    data: new Uint8Array([
      255, 0, 0, 255,   0, 0, 255, 255,
      0, 0, 255, 255,   255, 0, 0, 255,
    ]),
  };
}

function texture(): Texture {
  return new Texture(checkerSource());
}

function spriteMaterial(): SpriteMaterial {
  return new SpriteMaterial({ texture: texture() });
}

/**
 * An 8 × 4 RGBA8 atlas: big enough that a frame's four numbers are all
 * distinguishable from one another and from the texture's own extents, which a
 * square texture would hide.
 */
function atlasMaterial(): SpriteMaterial {
  return new SpriteMaterial({
    texture: new Texture({
      width: 8,
      height: 4,
      data: new Uint8Array(8 * 4 * 4),
    }),
  });
}

/** The quad's four corners as `[x, y]` pairs, in vertex order. */
function corners(sprite: Sprite): [number, number][] {
  const p = sprite.geometry.positions;
  return [0, 1, 2, 3].map((i) => [p[i * 3], p[i * 3 + 1]]);
}

/** The quad's authored uvs as `[u, v]` pairs, in the same vertex order. */
function uvsOf(sprite: Sprite): [number, number][] {
  const uvs = sprite.geometry.uvs;
  if (uvs === undefined) {
    throw new Error("a Sprite always authors uvs");
  }
  return [0, 1, 2, 3].map((i) => [uvs[i * 2], uvs[i * 2 + 1]]);
}

// ---------------------------------------------------------------------------
// Texture (§77).
// ---------------------------------------------------------------------------

describe("Texture — construction and validation (§77, §85)", () => {
  it("exposes the source's size and data at version 0", () => {
    const source = checkerSource();
    const map = new Texture(source);

    expect(map.source).toBe(source);
    expect(map.width).toBe(2);
    expect(map.height).toBe(2);
    expect(map.data).toBe(source.data);
    expect(map.version).toBe(0);
    expect(map.disposed).toBe(false);
  });

  it("reports null data for a source that carries none", () => {
    const map = new Texture({ width: 4, height: 4 });

    expect(map.data).toBeNull();
    expect(map.width).toBe(4);
  });

  it("assigns monotonic, unique ids", () => {
    const first = texture();
    const second = texture();

    expect(first.id).toMatch(/^texture-\d+$/);
    expect(second.id).not.toBe(first.id);

    const ordinal = (t: Texture): number =>
      Number(t.id.slice("texture-".length));
    expect(ordinal(second)).toBe(ordinal(first) + 1);
  });

  it("defaults dimension to 2d and accepts an explicit 2d tag", () => {
    expect(new Texture({ width: 1, height: 1 }).dimension).toBe("2d");
    expect(
      new Texture({ width: 1, height: 1, dimension: "2d" }).dimension,
    ).toBe("2d");
  });

  it("refuses cube, array, and 3D sources at upload (§77, R-30c)", () => {
    for (const dimension of ["cube", "array", "3d"] as const) {
      try {
        new Texture({ width: 1, height: 1, dimension });
        expect.unreachable(`expected ${dimension} to be refused`);
      } catch (error: unknown) {
        expect(isFourError(error)).toBe(true);
        if (isFourError(error)) {
          expect(error.code).toBe("NOT_IMPLEMENTED");
          expect(error.context).toEqual({ dimension });
          expect(error.message).toMatch(/uploads 2D textures only/);
        }
      }
    }
  });

  it("rejects a non-integer, zero, or negative dimension (§85)", () => {
    expect(() => new Texture({ width: 0, height: 1 })).toThrow(RangeError);
    expect(() => new Texture({ width: 1, height: -2 })).toThrow(RangeError);
    expect(() => new Texture({ width: 1.5, height: 1 })).toThrow(RangeError);
    expect(() => new Texture({ width: Number.NaN, height: 1 })).toThrow(
      RangeError,
    );
  });

  it("defaults the colour space to linear and honours an explicit tag (§60a)", () => {
    // The dated deviation from §60a's own default (sRGB for colour textures)
    // lives on `TextureSource.colorSpace`: opt-in keeps every already-authored
    // texture, and every pixel golden, byte-identical (R-15, 2026-08-08).
    // Map roles (R-30c) do not flip this: a source that names no `role` is
    // still `"linear"`.
    expect(new Texture({ width: 1, height: 1 }).colorSpace).toBe("linear");
    expect(new Texture({ width: 1, height: 1 }).role).toBeNull();
    const tagged = new Texture({ width: 1, height: 1, colorSpace: "srgb" });
    expect(tagged.colorSpace).toBe("srgb");
    expect(tagged.role).toBeNull();
  });

  it("rejects a colour space outside the union (§60a, §85)", () => {
    expect(
      () =>
        new Texture({
          width: 1,
          height: 1,
          colorSpace: "rec2020",
        } as unknown as { width: number; height: number }),
    ).toThrow(/Texture colorSpace "rec2020"/);
  });

  it("exposes an omitted map role as null — no default is invented (R-30c)", () => {
    expect(new Texture({ width: 1, height: 1 }).role).toBeNull();
  });

  it("resolves colorSpace from an explicit colour role when the tag is omitted (§60a, R-30c)", () => {
    const color = new Texture({ width: 1, height: 1, role: "color" });
    const data = new Texture({ width: 1, height: 1, role: "data" });

    expect(color.role).toBe("color");
    expect(color.colorSpace).toBe("srgb");
    expect(data.role).toBe("data");
    expect(data.colorSpace).toBe("linear");
  });

  it("lets an authored colorSpace win over role (§60a, R-30c)", () => {
    const linearColor = new Texture({
      width: 1,
      height: 1,
      role: "color",
      colorSpace: "linear",
    });
    const srgbData = new Texture({
      width: 1,
      height: 1,
      role: "data",
      colorSpace: "srgb",
    });

    expect(linearColor.role).toBe("color");
    expect(linearColor.colorSpace).toBe("linear");
    expect(srgbData.role).toBe("data");
    expect(srgbData.colorSpace).toBe("srgb");
  });

  it("refuses a map role outside the union rather than substituting one (§85)", () => {
    expect(
      () =>
        new Texture({
          width: 1,
          height: 1,
          role: "albedo",
        } as unknown as { width: number; height: number }),
    ).toThrow(/Texture role must be one of "color", "data"; got "albedo"/);
  });

  it("re-resolves role and colorSpace when a whole source is replaced", () => {
    const map = new Texture({ width: 1, height: 1, role: "color" });
    expect(map.colorSpace).toBe("srgb");

    map.source = { width: 1, height: 1, role: "data" };

    expect(map.role).toBe("data");
    expect(map.colorSpace).toBe("linear");
    expect(map.version).toBe(1);
  });

  it("drops the role on a disposed texture's empty source", () => {
    const map = new Texture({ width: 1, height: 1, role: "color" });
    map.dispose();
    expect(map.role).toBeNull();
    expect(map.colorSpace).toBe("linear");
  });

  it("rejects data whose length is not width · height · 4 (§77, §85)", () => {
    expect(
      () => new Texture({ width: 2, height: 2, data: new Uint8Array(15) }),
    ).toThrow(/16 bytes; got 15/);
  });
});

// ---------------------------------------------------------------------------
// Texture sampler state (§77, R-30, 2026-08-13).
// ---------------------------------------------------------------------------

describe("Texture — sampler state (§77, R-30)", () => {
  it("defaults to the pair this tier hard-coded before the fields existed", () => {
    // The byte-identity claim in one assertion: a texture that names neither
    // resolves to exactly what `gl-texture.ts` used to write literally, so an
    // already-authored scene issues the same four `texParameteri` calls.
    const map = new Texture({ width: 1, height: 1 });

    expect(map.filter).toBe("linear");
    expect(map.wrap).toBe("clamp-to-edge");
  });

  it("honours an explicit filter and wrap", () => {
    const map = new Texture({
      width: 2,
      height: 2,
      filter: "nearest",
      wrap: "repeat",
    });

    expect(map.filter).toBe("nearest");
    expect(map.wrap).toBe("repeat");
  });

  it("accepts every value of both unions", () => {
    for (const filter of ["nearest", "linear"] as const) {
      expect(new Texture({ width: 1, height: 1, filter }).filter).toBe(filter);
    }
    for (const wrap of [
      "clamp-to-edge",
      "repeat",
      "mirrored-repeat",
    ] as const) {
      expect(new Texture({ width: 1, height: 1, wrap }).wrap).toBe(wrap);
    }
  });

  it("refuses a filter outside the union rather than substituting one (§85)", () => {
    expect(
      () =>
        new Texture({
          width: 1,
          height: 1,
          filter: "nearset",
        } as unknown as { width: number; height: number }),
    ).toThrow(
      /Texture filter must be one of "nearest", "linear"; got "nearset"/,
    );
  });

  it("refuses a wrap outside the union (§85)", () => {
    expect(
      () =>
        new Texture({
          width: 1,
          height: 1,
          wrap: "clamp",
        } as unknown as { width: number; height: number }),
    ).toThrow(/Texture wrap must be one of/);
  });

  it("re-validates and re-resolves when a whole source is replaced", () => {
    const map = new Texture({ width: 1, height: 1, filter: "nearest" });

    map.source = { width: 1, height: 1, wrap: "mirrored-repeat" };

    // Sampler state belongs to the source, so replacing the source replaces it
    // — the filter falls back to the default rather than being remembered.
    expect(map.filter).toBe("linear");
    expect(map.wrap).toBe("mirrored-repeat");
    expect(map.version).toBe(1);
  });

  it("keeps sampler state on a disposed texture's empty source at the defaults", () => {
    const map = new Texture({ width: 4, height: 4, filter: "nearest" });

    map.dispose();

    expect(map.filter).toBe("linear");
    expect(map.wrap).toBe("clamp-to-edge");
  });
});

// ---------------------------------------------------------------------------
// Mipmaps, the min-filter split, and anisotropy (§77, R-30b, 2026-08-21).
// ---------------------------------------------------------------------------

describe("Texture — mipmaps and the min-filter split (§77, R-30b)", () => {
  it("carries no mip chain and resolves minFilter to filter by default", () => {
    // The byte-identity claim for this packet: a texture that names none of the
    // three new fields resolves to exactly what the backend wrote before they
    // existed — one level, min = mag = `filter`, anisotropy 1.
    const plain = new Texture({ width: 4, height: 4 });
    const crisp = new Texture({ width: 4, height: 4, filter: "nearest" });

    expect(plain.mipmaps).toBe(false);
    expect(plain.minFilter).toBe("linear");
    expect(plain.anisotropy).toBe(1);
    expect(crisp.minFilter).toBe("nearest");
  });

  it("derives the chain-aware min filter from `filter` when mipmaps are on", () => {
    const smooth = new Texture({ width: 4, height: 4, mipmaps: true });
    const crisp = new Texture({
      width: 4,
      height: 4,
      mipmaps: true,
      filter: "nearest",
    });

    expect(smooth.minFilter).toBe("linear-mipmap-linear");
    expect(crisp.minFilter).toBe("nearest-mipmap-nearest");
    expect(smooth.mipmaps).toBe(true);
  });

  it("honours an explicit minFilter, and accepts every value of the union", () => {
    expect(
      new Texture({
        width: 4,
        height: 4,
        mipmaps: true,
        minFilter: "nearest-mipmap-linear",
      }).minFilter,
    ).toBe("nearest-mipmap-linear");

    for (const minFilter of [
      "nearest",
      "linear",
      "nearest-mipmap-nearest",
      "linear-mipmap-nearest",
      "nearest-mipmap-linear",
      "linear-mipmap-linear",
    ] as const) {
      const map = new Texture({
        width: 4,
        height: 4,
        mipmaps: true,
        minFilter,
      });
      expect(map.minFilter).toBe(minFilter);
    }

    // The two in-level values are legal without a chain as well.
    expect(
      new Texture({ width: 4, height: 4, minFilter: "nearest" }).minFilter,
    ).toBe("nearest");
  });

  it("refuses a mip-choosing minFilter on a texture with no chain (§85)", () => {
    // GL would call the texture incomplete and sample it as opaque black —
    // a whole-surface failure with nothing saying why.
    expect(
      () =>
        new Texture({ width: 4, height: 4, minFilter: "linear-mipmap-linear" }),
    ).toThrow(
      /samples between mip levels, so the texture needs `mipmaps: true`/,
    );
  });

  it("refuses a minFilter outside the union rather than substituting (§85)", () => {
    expect(
      () =>
        new Texture({
          width: 1,
          height: 1,
          minFilter: "trilinear",
        } as unknown as { width: number; height: number }),
    ).toThrow(/Texture minFilter must be one of "nearest", "linear",/);
  });

  it("bills the whole mip chain to §84's texture memory, level by level", () => {
    // 4×4: 64 + 16 + 4 = 84 — not `4/3 × 64`, which is 85.33.
    expect(new Texture({ width: 4, height: 4, mipmaps: true }).byteLength).toBe(
      84,
    );
    // Non-square: the chain runs until *both* axes reach 1, with each axis
    // clamped there independently (8×2 → 4×1 → 2×1 → 1×1).
    expect(new Texture({ width: 8, height: 2, mipmaps: true }).byteLength).toBe(
      64 + 16 + 8 + 4,
    );
    // A texture with no chain is unchanged, so no landed §84 number moves.
    expect(new Texture({ width: 4, height: 4 }).byteLength).toBe(64);
  });

  it("keeps a disposed texture at zero bytes and the resolved defaults", () => {
    const map = new Texture({ width: 8, height: 8, mipmaps: true });

    map.dispose();

    expect(map.byteLength).toBe(0);
    expect(map.mipmaps).toBe(false);
    expect(map.minFilter).toBe("linear");
    expect(map.anisotropy).toBe(1);
  });
});

describe("Texture — anisotropy is a request, not a guarantee (§77, §62, R-30b)", () => {
  it("defaults to 1 and carries an integer request unchanged", () => {
    expect(new Texture({ width: 1, height: 1 }).anisotropy).toBe(1);
    expect(
      new Texture({ width: 4, height: 4, mipmaps: true, anisotropy: 8 })
        .anisotropy,
    ).toBe(8);
  });

  it("accepts a request no device can fill — that is §62's clamp, not §85's refusal", () => {
    // The whole policy in one assertion: 64× is legal to *ask* for, and the
    // backend gives what the device has. Refusing here would turn a quality
    // knob into a scene that does not run on half the fleet.
    expect(
      new Texture({ width: 4, height: 4, anisotropy: 64 }).anisotropy,
    ).toBe(64);
  });

  it("refuses a value no device could honour: below 1, or not an integer (§85)", () => {
    expect(() => new Texture({ width: 1, height: 1, anisotropy: 0 })).toThrow(
      /Texture anisotropy must be an integer of at least 1; got 0/,
    );
    expect(() => new Texture({ width: 1, height: 1, anisotropy: 1.5 })).toThrow(
      /must be an integer of at least 1; got 1.5/,
    );
    expect(
      () => new Texture({ width: 1, height: 1, anisotropy: Number.NaN }),
    ).toThrow(/must be an integer of at least 1/);
  });

  it("re-validates and re-resolves all three when the source is replaced", () => {
    const map = new Texture({
      width: 4,
      height: 4,
      mipmaps: true,
      anisotropy: 4,
    });

    map.source = { width: 4, height: 4 };

    expect(map.mipmaps).toBe(false);
    expect(map.minFilter).toBe("linear");
    expect(map.anisotropy).toBe(1);
    expect(map.byteLength).toBe(64);
    expect(map.version).toBe(1);
  });
});

describe("Texture — versioning (§53's contract, reused by §77)", () => {
  it("bumps the version once when a new source is assigned", () => {
    const map = texture();

    map.source = { width: 1, height: 1, data: new Uint8Array(4) };

    expect(map.version).toBe(1);
    expect(map.width).toBe(1);
    expect(map.data).toHaveLength(4);
  });

  it("validates an assigned source and leaves the old one in place on failure", () => {
    const map = texture();
    const original = map.source;

    expect(() => {
      map.source = { width: 3, height: 3, data: new Uint8Array(4) };
    }).toThrow(RangeError);
    expect(map.source).toBe(original);
    expect(map.version).toBe(0);
  });

  it("does not see an in-place texel edit until markDirty announces it", () => {
    const map = texture();

    map.data![0] = 7;
    expect(map.version).toBe(0);

    map.markDirty();
    expect(map.version).toBe(1);
  });
});

describe("Texture — disposal (§83)", () => {
  it("drops the texel data, marks itself disposed, and bumps the version", () => {
    const map = texture();

    map.dispose();

    expect(map.disposed).toBe(true);
    expect(map.data).toBeNull();
    expect(map.version).toBe(1);
  });

  it("is idempotent", () => {
    const map = texture();

    map.dispose();
    map.dispose();

    expect(map.version).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Sprite (§55).
// ---------------------------------------------------------------------------

describe("Sprite — defaults and validation (§55, §85)", () => {
  it("is a scene node with a centred anchor, unit size, and zero sort keys", () => {
    const material = spriteMaterial();
    const sprite = new Sprite(material);

    expect(sprite.material).toBe(material);
    expect([sprite.anchor.x, sprite.anchor.y]).toEqual([0.5, 0.5]);
    expect(sprite.width).toBe(1);
    expect(sprite.height).toBe(1);
    expect(sprite.renderLayer).toBe(0);
    expect(sprite.renderOrder).toBe(0);
    expect(sprite.visible).toBe(true);
  });

  it("takes size, anchor, and sort keys from its options", () => {
    const sprite = new Sprite(spriteMaterial(), {
      width: 3,
      height: 2,
      anchor: { x: 0, y: 1 },
      renderLayer: 2,
      renderOrder: 5,
    });

    expect(sprite.width).toBe(3);
    expect(sprite.height).toBe(2);
    expect([sprite.anchor.x, sprite.anchor.y]).toEqual([0, 1]);
    expect(sprite.renderLayer).toBe(2);
    expect(sprite.renderOrder).toBe(5);
  });

  it("takes the §49 drawable flags from its options (round-trip seam)", () => {
    const sprite = new Sprite(spriteMaterial(), {
      castShadow: false,
      receiveShadow: false,
      frustumCulled: false,
      clip: true,
    });
    expect(sprite.castShadow).toBe(false);
    expect(sprite.receiveShadow).toBe(false);
    expect(sprite.frustumCulled).toBe(false);
    expect(sprite.clip).toBe(true);
  });

  it("copies the anchor rather than holding the caller's object", () => {
    const anchor = { x: 0.25, y: 0.75 };
    const sprite = new Sprite(spriteMaterial(), { anchor });

    anchor.x = 1;

    expect(sprite.anchor.x).toBe(0.25);
  });

  it("rejects a non-positive or non-finite extent (§85)", () => {
    expect(() => new Sprite(spriteMaterial(), { width: 0 })).toThrow(
      RangeError,
    );
    expect(() => new Sprite(spriteMaterial(), { height: -1 })).toThrow(
      RangeError,
    );
    expect(
      () => new Sprite(spriteMaterial(), { width: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);

    const sprite = new Sprite(spriteMaterial());
    expect(() => {
      sprite.width = 0;
    }).toThrow(RangeError);
    expect(sprite.width).toBe(1);
  });

  it("rejects a non-finite anchor component (§85)", () => {
    expect(
      () => new Sprite(spriteMaterial(), { anchor: { x: Number.NaN, y: 0 } }),
    ).toThrow(RangeError);
    expect(() => new Sprite(spriteMaterial()).setAnchor(0, Number.NaN)).toThrow(
      RangeError,
    );
  });
});

describe("Sprite — the quad built from anchor and size (§55, §7a)", () => {
  it("centres the quad on the origin at the default anchor", () => {
    const sprite = new Sprite(spriteMaterial(), { width: 4, height: 2 });

    expect(corners(sprite)).toEqual([
      [-2, -1], // bottom-left
      [2, -1], // bottom-right
      [2, 1], // top-right
      [-2, 1], // top-left
    ]);
  });

  it("puts the bottom-left corner on the origin at anchor (0, 0) — Y-up (§7a)", () => {
    const sprite = new Sprite(spriteMaterial(), {
      width: 4,
      height: 2,
      anchor: { x: 0, y: 0 },
    });

    expect(corners(sprite)).toEqual([
      [0, 0],
      [4, 0],
      [4, 2],
      [0, 2],
    ]);
  });

  it("puts the top-right corner on the origin at anchor (1, 1)", () => {
    const sprite = new Sprite(spriteMaterial(), {
      width: 4,
      height: 2,
      anchor: { x: 1, y: 1 },
    });

    expect(corners(sprite)).toEqual([
      [-4, -2],
      [0, -2],
      [0, 0],
      [-4, 0],
    ]);
  });

  it("accepts an anchor outside [0, 1], placing the origin off the quad", () => {
    const sprite = new Sprite(spriteMaterial(), {
      width: 2,
      height: 2,
      anchor: { x: 2, y: 0 },
    });

    expect(corners(sprite)).toEqual([
      [-4, 0],
      [-2, 0],
      [-2, 2],
      [-4, 2],
    ]);
  });

  it("winds two counter-clockwise triangles, flat in Z", () => {
    const sprite = new Sprite(spriteMaterial());

    expect(Array.from(sprite.geometry.indices!)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(sprite.geometry.mode).toBe("triangles");
    expect(sprite.geometry.vertexCount).toBe(4);
    expect(sprite.geometry.drawCount).toBe(6);
    const z = [0, 1, 2, 3].map((i) => sprite.geometry.positions[i * 3 + 2]);
    expect(z).toEqual([0, 0, 0, 0]);
  });

  it("gives the geometry bounds that are exactly the quad", () => {
    const sprite = new Sprite(spriteMaterial(), {
      width: 3,
      height: 5,
      anchor: { x: 0, y: 0 },
    });

    const bounds = sprite.geometry.computeBounds();

    expect([bounds.min.x, bounds.min.y]).toEqual([0, 0]);
    expect([bounds.max.x, bounds.max.y]).toEqual([3, 5]);
  });
});

describe("Sprite — §55's `extends Renderable` (2026-08-06)", () => {
  it("is a Renderable, and reaches the render list through one instanceof", () => {
    const sprite = new Sprite(spriteMaterial());

    expect(sprite).toBeInstanceOf(Renderable);
    // The inherited members: the three the class used to re-declare, gone.
    expect(sprite.renderLayer).toBe(0);
    expect(sprite.renderOrder).toBe(0);
    expect(sprite.material.kind).toBe("sprite");
  });

  it("takes the layer and order options every renderable takes", () => {
    const sprite = new Sprite(spriteMaterial(), {
      renderLayer: 2,
      renderOrder: -3,
    });

    expect(sprite.renderLayer).toBe(2);
    expect(sprite.renderOrder).toBe(-3);
  });

  it("hands its own quad to the base, and keeps deriving it", () => {
    const sprite = new Sprite(spriteMaterial(), { width: 2, height: 2 });

    // Read through the base's slot: the override is what rebuilds it, so both
    // views of `geometry` are the same live quad.
    const asRenderable: Renderable<SpriteMaterial> = sprite;
    expect(asRenderable.geometry).toBe(sprite.geometry);

    sprite.width = 4;
    expect(asRenderable.geometry).toBe(sprite.geometry);
    expect(corners(sprite)[1][0]).toBe(2);
  });
});

describe("Sprite — rebuilds (§53 version contract)", () => {
  it("keeps one geometry instance across a resize and bumps its version", () => {
    const sprite = new Sprite(spriteMaterial());
    const geometry = sprite.geometry;
    const version = geometry.version;

    sprite.width = 8;

    expect(sprite.geometry).toBe(geometry);
    expect(geometry.version).toBeGreaterThan(version);
    expect(corners(sprite)[1][0]).toBe(4);
  });

  it("rebuilds after setAnchor", () => {
    const sprite = new Sprite(spriteMaterial(), { width: 2, height: 2 });

    sprite.setAnchor(0, 0);

    expect(corners(sprite)[0]).toEqual([0, 0]);
  });

  it("rebuilds after an in-place anchor write announced with markDirty", () => {
    const sprite = new Sprite(spriteMaterial(), { width: 2, height: 2 });
    expect(sprite.geometry.version).toBeGreaterThan(0); // force the first build

    sprite.anchor.x = 0;
    sprite.markDirty();

    expect(corners(sprite)[0][0]).toBe(0);
  });

  it("does not notice an in-place anchor write that was never announced", () => {
    const sprite = new Sprite(spriteMaterial(), { width: 2, height: 2 });
    expect(sprite.geometry.version).toBeGreaterThan(0); // force the first build

    sprite.anchor.x = 0;

    expect(corners(sprite)[0][0]).toBe(-1);
  });

  it("rebuilds at most once for a burst of edits", () => {
    const sprite = new Sprite(spriteMaterial());
    const version = sprite.geometry.version;

    sprite.width = 2;
    sprite.height = 3;
    sprite.setAnchor(0, 0);

    expect(sprite.geometry.version).toBe(version + 1);
  });
});

// ---------------------------------------------------------------------------
// §55 frame sub-rectangles (R-29).
// ---------------------------------------------------------------------------

describe("Sprite — §55 frame sub-rectangles (R-29)", () => {
  it("has no frame by default, which means the whole texture", () => {
    expect(new Sprite(atlasMaterial()).frame).toBeNull();
  });

  it("takes one as a construction option, in texels", () => {
    const sprite = new Sprite(atlasMaterial(), {
      frame: { x: 2, y: 1, width: 4, height: 2 },
    });

    expect(sprite.frame).toEqual({ x: 2, y: 1, width: 4, height: 2 });
  });

  it("copies the option rather than retaining the caller's object", () => {
    const authored = { x: 2, y: 1, width: 4, height: 2 };
    const sprite = new Sprite(atlasMaterial(), { frame: authored });

    expect(sprite.frame).not.toBe(authored);
  });

  it("rewrites one record in place, so stepping a sheet allocates nothing", () => {
    const sprite = new Sprite(atlasMaterial(), {
      frame: { x: 0, y: 0, width: 2, height: 2 },
    });
    const record = sprite.frame;

    expect(sprite.setFrame(2, 0, 2, 2)).toBe(sprite);
    expect(sprite.frame).toBe(record);
    expect(sprite.frame).toEqual({ x: 2, y: 0, width: 2, height: 2 });
  });

  it("drops the frame through the setter, and takes a new one after", () => {
    const sprite = new Sprite(atlasMaterial(), {
      frame: { x: 0, y: 0, width: 2, height: 2 },
    });

    sprite.frame = null;
    expect(sprite.frame).toBeNull();

    sprite.frame = { x: 1, y: 1, width: 2, height: 2 };
    expect(sprite.frame).toEqual({ x: 1, y: 1, width: 2, height: 2 });
  });

  it("accepts a frame flush with the texture's far edges", () => {
    const sprite = new Sprite(atlasMaterial());

    sprite.setFrame(4, 2, 4, 2);

    expect(sprite.frame).toEqual({ x: 4, y: 2, width: 4, height: 2 });
  });

  it("accepts fractional edges — a half-texel inset is the bleed defence", () => {
    const sprite = new Sprite(atlasMaterial());

    sprite.setFrame(0.5, 0.5, 3, 1);

    expect(sprite.frame?.x).toBe(0.5);
  });

  it("authors whole-texture uvs when there is no frame", () => {
    const sprite = new Sprite(atlasMaterial(), { width: 2, height: 2 });

    expect(uvsOf(sprite)).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
  });

  it("rewrites authored uvs and bumps the geometry version when the frame changes", () => {
    const sprite = new Sprite(atlasMaterial(), { width: 2, height: 2 });
    const geometry = sprite.geometry;
    const version = geometry.version;
    const before = corners(sprite);

    sprite.setFrame(2, 1, 4, 2);

    expect(sprite.geometry).toBe(geometry);
    expect(sprite.geometry.version).toBeGreaterThan(version);
    expect(corners(sprite)).toEqual(before);
    // 8 × 4 atlas, cell (2, 1, 4, 2) → u ∈ [0.25, 0.75], v ∈ [0.25, 0.75].
    expect(uvsOf(sprite)).toEqual([
      [0.25, 0.25],
      [0.75, 0.25],
      [0.75, 0.75],
      [0.25, 0.75],
    ]);
  });

  it("restores whole-texture uvs when the frame is cleared", () => {
    const sprite = new Sprite(atlasMaterial(), {
      width: 2,
      height: 2,
      frame: { x: 2, y: 1, width: 4, height: 2 },
    });
    expect(uvsOf(sprite)[0]).toEqual([0.25, 0.25]);

    sprite.frame = null;

    expect(uvsOf(sprite)).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
  });
});

describe("Sprite — frame validation (§85, refuse rather than clamp)", () => {
  // One message covers shape, and it prints the whole rejected rectangle — so
  // each case asserts that the *offending numbers* reach the author, which is
  // what a per-component message was buying (see `validateFrame` for the
  // measured reason there is no longer one message per component).
  it.each([
    ["a non-finite x", Number.NaN, 0, 2, 2, "(NaN, 0, 2, 2)"],
    [
      "a non-finite y",
      0,
      Number.POSITIVE_INFINITY,
      2,
      2,
      "(0, Infinity, 2, 2)",
    ],
    ["a non-finite width", 0, 0, Number.NaN, 2, "(0, 0, NaN, 2)"],
    ["a non-finite height", 0, 0, 2, -Infinity, "(0, 0, 2, -Infinity)"],
    ["a zero width", 0, 0, 0, 2, "(0, 0, 0, 2)"],
    ["a zero height", 0, 0, 2, 0, "(0, 0, 2, 0)"],
    ["a negative width", 0, 0, -1, 2, "(0, 0, -1, 2)"],
    ["a negative x", -1, 0, 2, 2, "(-1, 0, 2, 2)"],
    ["a negative y", 0, -1, 2, 2, "(0, -1, 2, 2)"],
  ] as const)("rejects %s, printing the frame", (_, x, y, w, h, shown) => {
    const sprite = new Sprite(atlasMaterial());

    expect(() => sprite.setFrame(x, y, w, h)).toThrow(RangeError);
    expect(() => sprite.setFrame(x, y, w, h)).toThrow(
      `finite rectangle with positive extents at a non-negative origin, in ` +
        `texels; got ${shown}`,
    );
  });

  it("rejects a frame that runs off the right edge, naming the texture", () => {
    const sprite = new Sprite(atlasMaterial());

    expect(() => sprite.setFrame(6, 0, 4, 2)).toThrow(
      /runs outside its 8 × 4 texture/,
    );
  });

  it("rejects a frame that runs off the top edge, and says where y starts", () => {
    const sprite = new Sprite(atlasMaterial());

    expect(() => sprite.setFrame(0, 3, 2, 2)).toThrow(
      /in texels from the bottom-left/,
    );
  });

  it("refuses through the property setter and the constructor alike", () => {
    const sprite = new Sprite(atlasMaterial());

    expect(() => {
      sprite.frame = { x: 0, y: 0, width: 99, height: 1 };
    }).toThrow(RangeError);
    expect(
      () =>
        new Sprite(atlasMaterial(), {
          frame: { x: 0, y: 0, width: 99, height: 1 },
        }),
    ).toThrow(RangeError);
  });

  it("leaves the previous frame intact when a write is refused", () => {
    const sprite = new Sprite(atlasMaterial(), {
      frame: { x: 2, y: 1, width: 4, height: 2 },
    });

    expect(() => sprite.setFrame(0, 0, 99, 1)).toThrow(RangeError);

    expect(sprite.frame).toEqual({ x: 2, y: 1, width: 4, height: 2 });
  });

  it("checks shape but not containment when the texture cannot report a size", () => {
    // A structurally typed sprite material — what the backend suites and
    // consumers hand a `Sprite` — whose texture predates `width`/`height`.
    const material = {
      kind: "sprite",
      tint: [1, 1, 1, 1],
      texture: { id: "t", version: 0, data: null, disposed: false },
    } as unknown as SpriteMaterial;
    const sprite = new Sprite(material);

    sprite.setFrame(1000, 1000, 1, 1);
    expect(sprite.frame?.x).toBe(1000);
    expect(() => sprite.setFrame(0, 0, 0, 1)).toThrow(RangeError);
  });
});

describe("Sprite — disposal (§83)", () => {
  it("disposes the quad it owns and nothing else", () => {
    const material = spriteMaterial();
    const map = material.texture;
    const sprite = new Sprite(material);
    const geometry = sprite.geometry;

    sprite.dispose();

    expect(sprite.disposed).toBe(true);
    expect(geometry.disposed).toBe(true);
    expect(geometry.drawCount).toBe(0);
    expect(material.disposed).toBe(false);
    expect(map.disposed).toBe(false);
  });

  it("is idempotent and leaves the geometry emptied", () => {
    const sprite = new Sprite(spriteMaterial());

    sprite.dispose();
    sprite.dispose();

    expect(sprite.geometry.positions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Render list (§64) with sprites.
// ---------------------------------------------------------------------------

describe("buildRenderList — sprites (§64, §55)", () => {
  // `Renderable<SpriteMaterial>` is in the union as well as `Sprite`: the
  // pipeline is chosen by the material, so a plain renderable carrying a sprite
  // material is a legal — and, for R-29, an interesting — inhabitant of a scene.
  function sceneWith(
    ...nodes: (Renderable | Renderable<SpriteMaterial> | Sprite)[]
  ): Scene {
    const scene = new Scene();
    scene.add(...nodes);
    return scene;
  }

  it("emits a sprite item with kind 'sprite', its quad, and its material", () => {
    const material = spriteMaterial();
    const sprite = new Sprite(material, { width: 2, height: 2 });
    const out: RenderItem[] = [];

    const list = buildRenderList(sceneWith(sprite), out);

    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe("sprite");
    expect(list[0].geometry).toBe(sprite.geometry);
    expect(list[0].material).toBe(material);
    expect(list[0].worldMatrix).toBe(sprite.transform.worldMatrix);
  });

  it("tags a Renderable's item 'unlit' alongside it", () => {
    const renderable = new Renderable(planeGeometry(), new UnlitMaterial());
    const out: RenderItem[] = [];

    const list = buildRenderList(
      sceneWith(renderable, new Sprite(spriteMaterial())),
      out,
    );

    expect(list.map((item) => item.kind)).toEqual(["unlit", "sprite"]);
  });

  it("narrows through isSpriteItem / isUnlitItem", () => {
    const out: RenderItem[] = [];
    const list = buildRenderList(
      sceneWith(
        new Renderable(planeGeometry(), new UnlitMaterial()),
        new Sprite(spriteMaterial()),
      ),
      out,
    );

    const sprites: SpriteRenderItem[] = list.filter(isSpriteItem);
    expect(sprites).toHaveLength(1);
    expect(sprites[0].material.tint).toEqual([1, 1, 1, 1]);
    expect(list.filter(isUnlitItem)).toHaveLength(1);
  });

  it("sorts sprites and renderables together by the §66 keys", () => {
    const behind = new Sprite(spriteMaterial(), { renderOrder: -1 });
    const front = new Sprite(spriteMaterial(), { renderLayer: 1 });
    const middle = new Renderable(planeGeometry(), new UnlitMaterial());
    const out: RenderItem[] = [];

    const list = buildRenderList(sceneWith(front, middle, behind), out);

    expect(list.map((item) => item.geometry)).toEqual([
      behind.geometry,
      middle.geometry,
      front.geometry,
    ]);
  });

  it("rebuilds a stale quad while collecting, so the item is never stale", () => {
    const sprite = new Sprite(spriteMaterial(), { width: 2, height: 2 });
    const out: RenderItem[] = [];
    buildRenderList(sceneWith(sprite), out);

    sprite.width = 6;
    const list = buildRenderList(sceneWith(sprite), out);

    expect(list[0].geometry.positions[3]).toBe(3);
  });

  it("prunes a hidden sprite exactly as it prunes a hidden renderable (§6)", () => {
    const sprite = new Sprite(spriteMaterial());
    sprite.visible = false;
    const out: RenderItem[] = [];

    expect(buildRenderList(sceneWith(sprite), out)).toHaveLength(0);
  });

  it("carries the discriminant through the §43 interpolated builder too", () => {
    const sprite = new Sprite(spriteMaterial());
    sprite.transform.position.set(1, 2, 0);
    const out: RenderItem[] = [];

    const list = buildInterpolatedRenderList(
      sceneWith(sprite),
      new PoseBuffer(),
      0.5,
      out,
    );

    expect(list[0].kind).toBe("sprite");
    expect(list[0].worldMatrix).not.toBe(sprite.transform.worldMatrix);
    expect(list[0].worldMatrix.elements[12]).toBe(1);
  });

  it("carries §55's frame onto the item, by reference (R-29)", () => {
    const sprite = new Sprite(atlasMaterial(), {
      frame: { x: 2, y: 1, width: 4, height: 2 },
    });
    const out: RenderItem[] = [];

    const list = buildRenderList(sceneWith(sprite), out);

    expect(isSpriteItem(list[0])).toBe(true);
    expect((list[0] as SpriteRenderItem).frame).toBe(sprite.frame);
  });

  it("carries null for a sprite with no frame", () => {
    const out: RenderItem[] = [];

    const list = buildRenderList(sceneWith(new Sprite(atlasMaterial())), out);

    expect((list[0] as SpriteRenderItem).frame).toBeNull();
  });

  it("carries null for a plain Renderable that happens to draw sprite-shaded", () => {
    // The pipeline is read off the material, so this is a *sprite item* built
    // from a node that has no `frame` property at all.
    const node = new Renderable<SpriteMaterial>(
      planeGeometry(),
      atlasMaterial(),
    );
    const out: RenderItem[] = [];

    const list = buildRenderList(sceneWith(node), out);

    expect(list[0].kind).toBe("sprite");
    expect((list[0] as SpriteRenderItem).frame).toBeNull();
  });

  it("clears a pooled item's frame when a frameless sprite reuses the slot", () => {
    const out: RenderItem[] = [];
    buildRenderList(
      sceneWith(
        new Sprite(atlasMaterial(), {
          frame: { x: 2, y: 1, width: 4, height: 2 },
        }),
      ),
      out,
    );

    const list = buildRenderList(sceneWith(new Sprite(atlasMaterial())), out);

    expect((list[0] as SpriteRenderItem).frame).toBeNull();
  });

  it("clears a pooled item's frame when a non-sprite reuses the slot", () => {
    const out: RenderItem[] = [];
    buildRenderList(
      sceneWith(
        new Sprite(atlasMaterial(), {
          frame: { x: 2, y: 1, width: 4, height: 2 },
        }),
      ),
      out,
    );

    const list = buildRenderList(
      sceneWith(new Renderable(planeGeometry(), new UnlitMaterial())),
      out,
    );

    expect(list[0].kind).toBe("unlit");
    expect((list[0] as unknown as SpriteRenderItem).frame).toBeNull();
  });

  it("carries the frame through the §43 interpolated builder too", () => {
    const sprite = new Sprite(atlasMaterial(), {
      frame: { x: 0, y: 0, width: 4, height: 2 },
    });
    const out: RenderItem[] = [];

    const list = buildInterpolatedRenderList(
      sceneWith(sprite),
      new PoseBuffer(),
      0.5,
      out,
    );

    expect((list[0] as SpriteRenderItem).frame).toBe(sprite.frame);
  });

  it("rewrites a pooled item's kind when the list changes shape", () => {
    const out: RenderItem[] = [];
    buildRenderList(sceneWith(new Sprite(spriteMaterial())), out);
    const pooled = out[0];

    const list = buildRenderList(
      sceneWith(new Renderable(planeGeometry(), new UnlitMaterial())),
      out,
    );

    // The same pooled object, re-tagged — a stale "sprite" here would send a
    // flat-colour material down the textured pipeline.
    expect(list[0]).toBe(pooled);
    expect(list[0].kind).toBe("unlit");
  });

  it("keeps insertion order for a homogeneous atlas (sort skip, §86)", () => {
    const scene = new Scene();
    const material = new SpriteMaterial({
      texture: new Texture({ width: 8, height: 8 }),
    });
    const sprites: Sprite[] = [];
    for (let i = 0; i < 256; i += 1) {
      const sprite = new Sprite(material, { width: 0.5, height: 0.5 });
      sprites.push(sprite);
      scene.add(sprite);
    }

    const out: RenderItem[] = [];
    const list = buildRenderList(scene, out);
    expect(list).toHaveLength(256);
    for (let i = 0; i < sprites.length; i += 1) {
      expect(list[i].geometry).toBe(sprites[i].geometry);
    }

    buildRenderList(scene, out);
    for (let i = 0; i < sprites.length; i += 1) {
      expect(out[i].geometry).toBe(sprites[i].geometry);
    }
  });
});

describe("groupSpritesByTexture (§55 atlas grouping)", () => {
  it("returns consecutive runs and does not reorder", () => {
    const atlas = { id: "atlas" };
    const other = { id: "other" };
    const items = [
      { texture: atlas },
      { texture: atlas },
      { texture: other },
      { texture: atlas },
    ];

    expect(groupSpritesByTexture(items)).toEqual([
      { texture: atlas, start: 0, count: 2 },
      { texture: other, start: 2, count: 1 },
      { texture: atlas, start: 3, count: 1 },
    ]);
  });

  it("reads Sprite.material.texture and groups a shared atlas", () => {
    const shared = spriteMaterial();
    const other = spriteMaterial();
    const sprites = [new Sprite(shared), new Sprite(shared), new Sprite(other)];

    expect(groupSpritesByTexture(sprites)).toEqual([
      { texture: shared.texture, start: 0, count: 2 },
      { texture: other.texture, start: 2, count: 1 },
    ]);
  });

  it("returns an empty list for no items", () => {
    expect(groupSpritesByTexture([])).toEqual([]);
  });
});
