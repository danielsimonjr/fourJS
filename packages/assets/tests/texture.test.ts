import { isFourError } from "@fourjs/core";
import { describe, expect, it, vi } from "vitest";

import { registerBoundedImageDecoder } from "../src/image-memory.js";

import {
  AssetManager,
  DEFAULT_MAXIMUM_DECODED_BYTES,
  DEFAULT_MAXIMUM_EXPANSION_RATIO,
  TextureAsset,
  createTextureLoader,
  type DecodedTexels,
  type FetchResponse,
  type TextureLoaderOptions,
} from "../src/index.js";

/** A response whose body is `bytes`. */
function bytesResponse(bytes: Uint8Array): FetchResponse {
  const buffer = bytes.slice().buffer;
  return {
    ok: true,
    status: 200,
    text: () => Promise.reject(new Error("not text")),
    json: () => Promise.reject(new Error("not json")),
    arrayBuffer: () => Promise.resolve(buffer),
  };
}

function fetchOf(bytes: Uint8Array): () => Promise<FetchResponse> {
  return () => Promise.resolve(bytesResponse(bytes));
}

/** An `n`-texel row of one colour. */
function row(value: number, texels: number): number[] {
  return Array.from({ length: texels * 4 }, () => value);
}

/** A 1 × 2 image: top row 200, bottom row 100 — top row first, as codecs do. */
const TWO_ROWS: DecodedTexels = {
  width: 1,
  height: 2,
  data: new Uint8Array([...row(200, 1), ...row(100, 1)]),
};

const ENCODED = new Uint8Array([1, 2, 3, 4]);

describe("createTextureLoader", () => {
  it("flips rows so row 0 is the bottom one (§7a)", async () => {
    const assets = new AssetManager({ fetch: fetchOf(ENCODED) });
    const loader = createTextureLoader({ decode: () => TWO_ROWS });
    const asset = await assets.load("/t.png", loader);
    expect([...asset.data]).toEqual([...row(100, 1), ...row(200, 1)]);
    expect(asset.width).toBe(1);
    expect(asset.height).toBe(2);
  });

  it("leaves rows alone when the decoder already flipped", async () => {
    const assets = new AssetManager({ fetch: fetchOf(ENCODED) });
    const loader = createTextureLoader({
      decode: () => TWO_ROWS,
      flipY: false,
    });
    const asset = await assets.load("/t.png", loader);
    expect([...asset.data]).toEqual([...TWO_ROWS.data]);
  });

  it("carries the §77/§60a sampler metadata onto the result", async () => {
    const assets = new AssetManager({ fetch: fetchOf(ENCODED) });
    const loader = createTextureLoader({
      decode: () => TWO_ROWS,
      colorSpace: "srgb",
      filter: "nearest",
      wrap: "repeat",
      name: "png",
    });
    const asset = await assets.load("/t.png", loader);
    expect(asset.colorSpace).toBe("srgb");
    expect(asset.filter).toBe("nearest");
    expect(asset.wrap).toBe("repeat");
    expect(loader.name).toBe("png");

    const bare = createTextureLoader({ decode: () => TWO_ROWS });
    const plain = await assets.load("/t2.png", bare);
    expect(plain.colorSpace).toBeUndefined();
    expect(plain.filter).toBeUndefined();
    expect(plain.wrap).toBeUndefined();
    expect(bare.name).toBe("texture");
  });

  it("awaits an async decoder", async () => {
    const assets = new AssetManager({ fetch: fetchOf(ENCODED) });
    const loader = createTextureLoader({
      decode: () => Promise.resolve(TWO_ROWS),
      flipY: false,
    });
    await expect(assets.load("/t.png", loader)).resolves.toBeInstanceOf(
      TextureAsset,
    );
  });

  it("refuses dimensions and byte counts that do not agree (§85, §77)", async () => {
    const assets = new AssetManager({ fetch: fetchOf(ENCODED) });
    const zero = createTextureLoader({
      decode: () => ({ width: 0, height: 1, data: new Uint8Array(0) }),
    });
    await expect(assets.load("/a.png", zero)).rejects.toThrow(
      /needs finite integer dimensions/,
    );

    const fractional = createTextureLoader({
      decode: () => ({ width: 1.5, height: 1, data: new Uint8Array(4) }),
    });
    await expect(assets.load("/b.png", fractional)).rejects.toThrow(
      /needs finite integer dimensions/,
    );

    const short = createTextureLoader({
      decode: () => ({ width: 2, height: 2, data: new Uint8Array(4) }),
    });
    await expect(assets.load("/c.png", short)).rejects.toThrow(
      /which needs 16/,
    );
  });
});

describe("§96 decompression limits", () => {
  it("refuses an over-budget decode after the fact", async () => {
    const assets = new AssetManager({ fetch: fetchOf(ENCODED) });
    const loader = createTextureLoader({
      decode: () => ({ width: 2, height: 2, data: new Uint8Array(16) }),
      maximumDecodedBytes: 8,
      maximumExpansionRatio: Number.POSITIVE_INFINITY,
    });
    try {
      await assets.load("/bomb.png", loader);
      throw new Error("expected a rejection");
    } catch (error) {
      expect(isFourError(error) && error.context).toMatchObject({
        limitName: "maximumDecodedBytes",
        limit: 8,
        observed: 16,
        stage: "decode",
      });
    }
  });

  it("refuses an over-budget expansion ratio, which the absolute bound misses", async () => {
    const assets = new AssetManager({ fetch: fetchOf(ENCODED) });
    const loader = createTextureLoader({
      // 4 encoded bytes → 16 decoded: a ratio of 4.
      decode: () => ({ width: 2, height: 2, data: new Uint8Array(16) }),
      maximumExpansionRatio: 2,
    });
    try {
      await assets.load("/bomb.png", loader);
      throw new Error("expected a rejection");
    } catch (error) {
      expect(isFourError(error) && error.context).toMatchObject({
        limitName: "maximumExpansionRatio",
        limit: 2,
        observed: 4,
      });
    }
  });

  it("refuses before decoding when a probe reads the header", async () => {
    let decoded = 0;
    const assets = new AssetManager({ fetch: fetchOf(ENCODED) });
    const loader = createTextureLoader({
      probe: () => ({ width: 30_000, height: 30_000 }),
      decode: () => {
        decoded += 1;
        return { width: 1, height: 1, data: new Uint8Array(4) };
      },
      maximumExpansionRatio: Number.POSITIVE_INFINITY,
    });
    try {
      await assets.load("/bomb.png", loader);
      throw new Error("expected a rejection");
    } catch (error) {
      expect(isFourError(error) && error.context).toMatchObject({
        limitName: "maximumDecodedBytes",
        stage: "probe",
      });
    }
    expect(decoded).toBe(0);
  });

  it("treats an unrecognised probe as unknown, not as fine", async () => {
    const assets = new AssetManager({ fetch: fetchOf(ENCODED) });
    const loader = createTextureLoader({
      probe: () => undefined,
      decode: () => ({ width: 2, height: 2, data: new Uint8Array(16) }),
      maximumDecodedBytes: 8,
    });
    await expect(assets.load("/bomb.png", loader)).rejects.toThrow(
      /over the 8 limit/,
    );
  });

  it("takes no ratio against an empty body, and allows opting out", async () => {
    const assets = new AssetManager({ fetch: fetchOf(new Uint8Array(0)) });
    const loader = createTextureLoader({
      decode: () => ({ width: 1, height: 1, data: new Uint8Array(4) }),
      maximumExpansionRatio: 1,
    });
    await expect(assets.load("/empty.png", loader)).resolves.toBeInstanceOf(
      TextureAsset,
    );

    const unlimited = createTextureLoader({
      decode: () => ({ width: 2, height: 2, data: new Uint8Array(16) }),
      maximumDecodedBytes: Number.POSITIVE_INFINITY,
      maximumExpansionRatio: Number.POSITIVE_INFINITY,
    });
    const big = new AssetManager({ fetch: fetchOf(ENCODED) });
    await expect(big.load("/x.png", unlimited)).resolves.toBeInstanceOf(
      TextureAsset,
    );
  });

  it("refuses a non-positive limit at construction", () => {
    const decode = (): DecodedTexels => TWO_ROWS;
    expect(() =>
      createTextureLoader({ decode, maximumDecodedBytes: 0 }),
    ).toThrow(/maximumDecodedBytes must be greater than zero/);
    expect(() =>
      createTextureLoader({ decode, maximumExpansionRatio: Number.NaN }),
    ).toThrow(/maximumExpansionRatio must be greater than zero/);
  });

  it("defaults to a 4096² image and a 1000× expansion", () => {
    expect(DEFAULT_MAXIMUM_DECODED_BYTES).toBe(4096 * 4096 * 4);
    expect(DEFAULT_MAXIMUM_EXPANSION_RATIO).toBe(1000);
  });
});

describe("§96 strict image memory", () => {
  it.each(["probe", "decode"] as const)(
    "preserves the expansion limit when the %s transfers the input",
    async (stage) => {
      const detach = (data: ArrayBuffer): void => {
        structuredClone(data, { transfer: [data] });
      };
      const decode = vi.fn((data: ArrayBuffer) => {
        if (stage === "decode") detach(data);
        return { width: 2, height: 2, data: new Uint8Array(16) };
      });
      const loader = createTextureLoader({
        decode,
        probe: (data) => {
          if (stage === "probe") detach(data);
          return undefined;
        },
        maximumExpansionRatio: 2,
      });
      await expect(
        loader.load(bytesResponse(ENCODED), "/transfer.png"),
      ).rejects.toMatchObject({
        context: {
          url: "/transfer.png",
          limitName: "maximumExpansionRatio",
          observed: 4,
          stage: "decode",
        },
      });
      expect(decode).toHaveBeenCalledOnce();
    },
  );

  it("refuses platform callbacks before decoding, even with a probe", () => {
    const decode = vi.fn(() => TWO_ROWS);
    expect(() =>
      createTextureLoader({
        decode,
        probe: () => ({ width: 1, height: 2 }),
        maximumWorkingBytes: 65_536,
      }),
    ).toThrow(/no enforceable/);
    expect(decode).not.toHaveBeenCalled();
  });

  it("uses the registered capability and snapshots options against replacement", async () => {
    const decode = registerBoundedImageDecoder(() => TWO_ROWS, 65_536);
    const unsafe = vi.fn(() => TWO_ROWS);
    const options: TextureLoaderOptions = {
      decode,
      maximumWorkingBytes: 65_536,
    };
    const loader = createTextureLoader(options);
    Object.assign(options, { decode: unsafe, maximumWorkingBytes: undefined });
    const asset = await loader.load(bytesResponse(ENCODED), "/safe.png");
    expect(asset.data).toEqual(
      new Uint8Array([...row(100, 1), ...row(200, 1)]),
    );
    expect(unsafe).not.toHaveBeenCalled();
  });

  it("refuses an unknown required probe before invoking the decoder", async () => {
    const decode = vi.fn(() => TWO_ROWS);
    const loader = createTextureLoader({ decode, requireProbe: true });
    await expect(loader.load(bytesResponse(ENCODED), "/x")).rejects.toThrow(
      /recognized dimension probe/,
    );
    expect(decode).not.toHaveBeenCalled();
  });

  it.each([
    { width: NaN, height: 1 },
    { width: 0, height: 1 },
    { width: 1, height: Infinity },
    { width: 1, height: -1 },
    { width: Number.MAX_SAFE_INTEGER, height: 2 },
  ])("refuses unsafe probe dimensions %o", async (dimensions) => {
    const decode = vi.fn(() => TWO_ROWS);
    const loader = createTextureLoader({ decode, probe: () => dimensions });
    await expect(loader.load(bytesResponse(ENCODED), "/x")).rejects.toThrow(
      /probe returned invalid dimensions/,
    );
    expect(decode).not.toHaveBeenCalled();
  });

  it("accepts a recognized required probe and validates returned buffer storage", async () => {
    const loader = createTextureLoader({
      decode: () => TWO_ROWS,
      probe: () => ({ width: 1, height: 2 }),
      requireProbe: true,
    });
    await expect(
      loader.load(bytesResponse(ENCODED), "/x"),
    ).resolves.toBeInstanceOf(TextureAsset);
    const oversized = createTextureLoader({
      decode: () => ({
        width: 1,
        height: 1,
        data: new Uint8Array(128).subarray(0, 4),
      }),
      flipY: false,
      maximumDecodedBytes: 4,
    });
    await expect(oversized.load(bytesResponse(ENCODED), "/x")).rejects.toThrow(
      /over the 4 limit/,
    );
    const forged = createTextureLoader({
      decode: () => ({
        width: 1,
        height: 1,
        data: [1, 2, 3, 4] as unknown as Uint8Array,
      }),
    });
    await expect(forged.load(bytesResponse(ENCODED), "/x")).rejects.toThrow(
      /Uint8Array/,
    );
  });

  it("refuses unsafe decoded products even when limits are disabled", async () => {
    const loader = createTextureLoader({
      decode: () => ({
        width: Number.MAX_SAFE_INTEGER,
        height: 2,
        data: new Uint8Array(4),
      }),
      maximumDecodedBytes: Infinity,
      maximumExpansionRatio: Infinity,
    });
    await expect(loader.load(bytesResponse(ENCODED), "/x")).rejects.toThrow(
      /finite integer dimensions/,
    );
  });
});

describe("TextureAsset", () => {
  it("releases its texels once, and reports an empty source afterwards (§83)", async () => {
    const assets = new AssetManager({ fetch: fetchOf(ENCODED) });
    const loader = createTextureLoader({ decode: () => TWO_ROWS });
    const asset = await assets.load("/t.png", loader);
    expect(asset.isDisposed).toBe(false);

    // The manager disposes on the last release (§83).
    assets.release("/t.png", loader);
    expect(asset.isDisposed).toBe(true);
    expect(asset.width).toBe(1);
    expect(asset.height).toBe(1);
    expect(asset.data).toHaveLength(4);

    asset.dispose();
    expect(asset.isDisposed).toBe(true);
  });
});
