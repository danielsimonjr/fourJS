/**
 * §77a raster painting (RFC 0004) — `RasterSource` read into a `CanvasTexture`
 * that is a `MaterialTexture` to every material and every backend.
 *
 * The tests pin the decisions, not just the arithmetic: one buffer for the
 * texture's life, paint-before-read ordering, the one flip rule, the
 * constant-size refusal (`R-30`'s gate), the §96 byte ceiling, exact §83
 * accounting, and the "`update()` touches nothing unless stale" dirty
 * tracking that is the tier's whole upload-efficiency claim.
 */

import { isFourError } from "@fourjs/core";
import { UnlitMaterial } from "@fourjs/materials";
import { describe, expect, it } from "vitest";

import { CanvasTexture, type RasterSource } from "../src/raster.js";
import {
  liveTextureCount,
  textureMemoryBytes,
} from "../src/resource-memory.js";

/** A scriptable source: paints a solid value, counts its own calls. */
function solidSource(
  width: number,
  height: number,
  overrides: Partial<RasterSource> = {},
): {
  source: RasterSource;
  paints: () => number;
  reads: () => number;
  setValue: (value: number) => void;
} {
  let paints = 0;
  let reads = 0;
  let value = 1;
  const source: RasterSource = {
    width,
    height,
    paint: () => {
      paints += 1;
    },
    readPixels: (out) => {
      reads += 1;
      out.fill(value);
    },
    ...overrides,
  };
  return {
    source,
    paints: () => paints,
    reads: () => reads,
    setValue: (next: number) => {
      value = next;
    },
  };
}

describe("§85 validation at construction", () => {
  it("refuses a non-integer or sub-1 size, naming the axis", () => {
    for (const width of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () => new CanvasTexture({ width, height: 2, readPixels: () => {} }),
      ).toThrow(/CanvasTexture width must be a finite integer of at least 1/);
    }
    expect(
      () => new CanvasTexture({ width: 2, height: 0, readPixels: () => {} }),
    ).toThrow(/CanvasTexture height must be a finite integer of at least 1/);
  });

  it("refuses an origin the engine has no meaning for", () => {
    expect(
      () =>
        new CanvasTexture({
          width: 1,
          height: 1,
          origin: "upper-left" as never,
          readPixels: () => {},
        }),
    ).toThrow(/origin must be one of "bottom-left", "top-left"/);
  });

  it("refuses a colour space that is not one (§60a)", () => {
    expect(
      () =>
        new CanvasTexture({
          width: 1,
          height: 1,
          colorSpace: "rec2020" as never,
          readPixels: () => {},
        }),
    ).toThrow(/CanvasTexture colorSpace/);
  });

  it("admits no string where a source is expected (§96)", () => {
    // A URL, a module specifier, and anything a scene document could carry are
    // all strings; the type system is where the refusal lives (`bun run
    // typecheck:tests` runs the integration twin of this assertion), and the
    // runtime backstop is that a string has no integer `width`.
    expect(
      () => new CanvasTexture("https://example.invalid/paint.js" as never),
    ).toThrow(RangeError);
  });
});

describe("§96 size ceiling", () => {
  it("defaults to 64 MiB — a 4096² RGBA8 surface passes, one texel more fails", () => {
    const atLimit = new CanvasTexture({
      width: 4096,
      height: 4096,
      readPixels: () => {},
    });
    expect(atLimit.byteLength).toBe(64 * 1024 * 1024);
    atLimit.dispose();

    expect(
      () =>
        new CanvasTexture({ width: 4097, height: 4096, readPixels: () => {} }),
    ).toThrow(/over the 67108864-byte maximumBytes limit \(§96\)/);
  });

  it("honours an explicit limit, with Infinity as the stated opt-out", () => {
    const source: RasterSource = {
      width: 4,
      height: 4,
      readPixels: () => {},
    };
    expect(() => new CanvasTexture(source, { maximumBytes: 63 })).toThrow(
      /64 bytes, over the 63-byte maximumBytes limit/,
    );
    const allowed = new CanvasTexture(source, { maximumBytes: 64 });
    allowed.dispose();
    const unbounded = new CanvasTexture(source, {
      maximumBytes: Number.POSITIVE_INFINITY,
    });
    unbounded.dispose();
  });

  it("refuses a limit that is not a positive byte count", () => {
    const source: RasterSource = { width: 1, height: 1, readPixels: () => {} };
    for (const maximumBytes of [0, -1, Number.NaN]) {
      expect(() => new CanvasTexture(source, { maximumBytes })).toThrow(
        /maximumBytes must be a positive number of bytes/,
      );
    }
  });
});

describe("identity and defaults (§33, §60a)", () => {
  it("assigns monotonic counter ids, never clock- or random-derived", () => {
    const first = new CanvasTexture({
      width: 1,
      height: 1,
      readPixels: () => {},
    });
    const second = new CanvasTexture({
      width: 1,
      height: 1,
      readPixels: () => {},
    });
    expect(first.id).toMatch(/^canvas-texture-\d+$/);
    expect(Number(second.id.slice("canvas-texture-".length))).toBe(
      Number(first.id.slice("canvas-texture-".length)) + 1,
    );
    first.dispose();
    second.dispose();
  });

  it('defaults colorSpace to "srgb" — deliberately unlike TextureSource', () => {
    // RFC 0004 Q3, adopted: R-15's linear default protects authored content
    // and goldens this class has none of, and a host 2D canvas produces
    // sRGB-encoded bytes. The reason is written at both defaults.
    const texture = new CanvasTexture({
      width: 1,
      height: 1,
      readPixels: () => {},
    });
    expect(texture.colorSpace).toBe("srgb");
    texture.dispose();

    const linear = new CanvasTexture({
      width: 1,
      height: 1,
      colorSpace: "linear",
      readPixels: () => {},
    });
    expect(linear.colorSpace).toBe("linear");
    linear.dispose();
  });

  it("is a MaterialTexture to a material with no adaptation", () => {
    const texture = new CanvasTexture({
      width: 2,
      height: 2,
      readPixels: () => {},
    });
    const material = new UnlitMaterial({ map: texture });
    expect(material.map).toBe(texture);
    texture.dispose();
  });
});

describe("update(): stale-driven repaint into one engine-owned buffer", () => {
  it("is born stale, paints before it reads, and reports whether it read", () => {
    const { source, paints, reads } = solidSource(2, 2);
    const order: string[] = [];
    const tracked: RasterSource = {
      ...source,
      paint: () => {
        order.push("paint");
        source.paint?.();
      },
      readPixels: (out) => {
        order.push("read");
        source.readPixels(out);
      },
    };
    const texture = new CanvasTexture(tracked);
    expect(texture.version).toBe(0);

    expect(texture.update()).toBe(true);
    expect(order).toEqual(["paint", "read"]);
    expect(texture.version).toBe(1);
    expect(paints()).toBe(1);
    expect(reads()).toBe(1);

    // Clean: update touches nothing — the one-upload-per-repaint claim.
    expect(texture.update()).toBe(false);
    expect(texture.version).toBe(1);
    expect(reads()).toBe(1);

    texture.invalidate();
    texture.invalidate(); // idempotent
    expect(texture.update()).toBe(true);
    expect(texture.version).toBe(2);
    expect(reads()).toBe(2);
    texture.dispose();
  });

  it("hands the source the same exactly-sized buffer every time", () => {
    const seen: Uint8Array[] = [];
    const texture = new CanvasTexture({
      width: 3,
      height: 2,
      readPixels: (out) => {
        seen.push(out);
      },
    });
    texture.update();
    texture.invalidate();
    texture.update();
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]); // engine-owned, reused — no per-frame allocation
    expect(seen[0]).toHaveLength(3 * 2 * 4);
    expect(texture.data).toBe(seen[0]);
    texture.dispose();
  });

  it("works without a paint hook — a source may paint eagerly elsewhere", () => {
    let reads = 0;
    const texture = new CanvasTexture({
      width: 1,
      height: 1,
      readPixels: (out) => {
        reads += 1;
        out.fill(7);
      },
    });
    expect(texture.update()).toBe(true);
    expect(reads).toBe(1);
    expect(texture.data?.[0]).toBe(7);
    texture.dispose();
  });
});

describe("the one flip rule (§7a)", () => {
  /** Rows valued by index, written in the order the origin declares. */
  function rowSource(
    width: number,
    height: number,
    origin: "top-left" | "bottom-left",
  ): RasterSource {
    return {
      width,
      height,
      origin,
      readPixels: (out) => {
        // The source writes row 0 first; under "top-left" that row is the TOP
        // of the picture, under "bottom-left" the bottom.
        for (let row = 0; row < height; row += 1) {
          out.fill(row + 1, row * width * 4, (row + 1) * width * 4);
        }
      },
    };
  }

  it('reverses the rows of a "top-left" source during the read', () => {
    const texture = new CanvasTexture(rowSource(2, 3, "top-left"));
    texture.update();
    const data = texture.data;
    // Row 0 of `data` is v = 0, the BOTTOM — which the top-first source wrote
    // last (value 3). The middle row of an odd height stays in place.
    expect(data?.[0]).toBe(3);
    expect(data?.[2 * 4]).toBe(2);
    expect(data?.[2 * 2 * 4]).toBe(1);
    texture.dispose();
  });

  it("flips an even height completely — no middle row to leave", () => {
    const texture = new CanvasTexture(rowSource(1, 4, "top-left"));
    texture.update();
    expect(
      Array.from(texture.data ?? []).filter((_, i) => i % 4 === 0),
    ).toEqual([4, 3, 2, 1]);
    texture.dispose();
  });

  it('leaves a "bottom-left" source untouched — it already matches §7a', () => {
    const texture = new CanvasTexture(rowSource(1, 3, "bottom-left"));
    texture.update();
    expect(texture.data?.[0]).toBe(1);
    expect(texture.data?.[2 * 4]).toBe(3);
    texture.dispose();
  });
});

describe("the constant-size rule (§77a, gated on R-30)", () => {
  it("refuses a source that changed size — even mid-paint — and reads nothing", () => {
    let width = 2;
    let reads = 0;
    const source: RasterSource = {
      get width() {
        return width;
      },
      height: 2,
      paint: () => {
        // The obvious hazard: a panel-resize repaint that grows its canvas.
        width = 4;
      },
      readPixels: () => {
        reads += 1;
      },
    };
    const texture = new CanvasTexture(source);
    let failure: unknown;
    try {
      texture.update();
    } catch (error) {
      failure = error;
    }
    expect(isFourError(failure) && failure.code).toBe(
      "INVALID_APPLICATION_STATE",
    );
    expect(String(failure)).toMatch(/constant for its life .*R-30/s);
    expect(reads).toBe(0); // the old-size buffer was never read into
    expect(texture.version).toBe(0); // and nothing pretended it was
    width = 2;
    texture.dispose();
  });

  it("checks the height too", () => {
    let height = 2;
    const texture = new CanvasTexture({
      width: 2,
      get height() {
        return height;
      },
      readPixels: () => {},
    });
    height = 1;
    expect(() => texture.update()).toThrow(/now reports 2×1/);
    height = 2;
    texture.dispose();
  });
});

describe("§83 lifecycle and accounting", () => {
  it("is billed at construction and returns the totals to baseline at dispose", () => {
    const bytes = textureMemoryBytes();
    const count = liveTextureCount();

    const { source } = solidSource(8, 4);
    const texture = new CanvasTexture(source);
    expect(texture.width).toBe(8);
    expect(texture.height).toBe(4);
    expect(texture.byteLength).toBe(8 * 4 * 4);
    expect(textureMemoryBytes() - bytes).toBe(texture.byteLength);
    expect(liveTextureCount() - count).toBe(1);

    // N updates move no accounting — the buffer is the same buffer.
    for (let i = 0; i < 3; i += 1) {
      texture.invalidate();
      texture.update();
    }
    expect(textureMemoryBytes() - bytes).toBe(texture.byteLength);

    texture.dispose();
    expect(textureMemoryBytes()).toBe(bytes);
    expect(liveTextureCount()).toBe(count);
  });

  it("dispose is idempotent, empties the surface, and bumps the version", () => {
    const bytes = textureMemoryBytes();
    const { source } = solidSource(2, 2);
    const texture = new CanvasTexture(source);
    texture.update();
    const version = texture.version;

    texture.dispose();
    texture.dispose(); // subtracts once, not twice
    expect(texture.disposed).toBe(true);
    expect(texture.data).toBeNull();
    expect(texture.byteLength).toBe(0);
    expect(texture.version).toBe(version + 1); // caches keyed on it re-read
    expect(textureMemoryBytes()).toBe(bytes);
  });

  it("refuses update() on a disposed texture, loudly (§83)", () => {
    const { source } = solidSource(1, 1);
    const texture = new CanvasTexture(source);
    texture.dispose();
    let failure: unknown;
    try {
      texture.update();
    } catch (error) {
      failure = error;
    }
    expect(isFourError(failure) && failure.code).toBe(
      "INVALID_APPLICATION_STATE",
    );
    // invalidate() stays cheap and unconditional — nothing to throw about.
    texture.invalidate();
  });
});
