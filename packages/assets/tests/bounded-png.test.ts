import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

import { isFourError } from "@fourjs/core";
import { describe, expect, it } from "vitest";

import { createBoundedPngDecoder } from "../src/bounded-png.js";
import {
  AssetManager,
  TextureAsset,
  createTextureDecoder,
  createTextureLoader,
  type TexelDecodeLike,
} from "../src/index.js";

const WASM = new Uint8Array(
  readFileSync(new URL("./fixtures/squoosh-png-3.1.1.wasm", import.meta.url)),
);
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const HEAP_BYTES = 8 * 1024 * 1024;

function concatenate(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(
    parts.reduce((length, part) => length + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 0 ? 0 : 0xedb8_8320);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function chunk(name: string, bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(bytes.length + 12);
  const view = new DataView(result.buffer);
  view.setUint32(0, bytes.length);
  result.set(
    Array.from(name, (letter) => letter.charCodeAt(0)),
    4,
  );
  result.set(bytes, 8);
  view.setUint32(bytes.length + 8, crc32(result.subarray(4, bytes.length + 8)));
  return result;
}

function header(
  width: number,
  height: number,
  colorType = 6,
  depth = 8,
  compression = 0,
  filter = 0,
  interlace = 0,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(13);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  bytes.set([depth, colorType, compression, filter, interlace], 8);
  return concatenate(PNG_SIGNATURE, chunk("IHDR", bytes));
}

function png(
  width: number,
  height: number,
  scanlines: readonly number[] | Uint8Array,
  colorType = 6,
  depth = 8,
  extraChunks: readonly Uint8Array[] = [],
): Uint8Array<ArrayBuffer> {
  return concatenate(
    header(width, height, colorType, depth),
    ...extraChunks,
    chunk("IDAT", deflateSync(new Uint8Array(scanlines))),
    chunk("IEND", new Uint8Array()),
  );
}

const RED = png(1, 1, [0, 255, 0, 0, 255]);
const TWO_ROWS = png(1, 2, [0, 255, 0, 0, 255, 0, 0, 50, 255, 128]);

function decodeBytes(decode: TexelDecodeLike, bytes: Uint8Array) {
  return Promise.resolve().then(() => decode(new Uint8Array(bytes).buffer));
}

function bounded(
  options: {
    maximumWorkingBytes?: number;
    maximumDecodedBytes?: number;
    maximumExpansionRatio?: number;
  } = {},
) {
  return createBoundedPngDecoder({
    wasmBinary: WASM,
    maximumWorkingBytes: HEAP_BYTES,
    ...options,
  });
}

describe("bounded PNG decoding with the real @jsquash/png 3.1.1 Wasm", () => {
  it("returns exact straight-alpha RGBA8 pixels with the top row first", async () => {
    const decode = await bounded();
    const result = await decodeBytes(decode, TWO_ROWS);
    expect(result.width).toBe(1);
    expect(result.height).toBe(2);
    expect(result.data).toBeInstanceOf(Uint8Array);
    expect([...result.data]).toEqual([255, 0, 0, 255, 0, 50, 255, 128]);
  });

  it.each([
    {
      name: "grayscale",
      type: 0,
      depth: 8,
      row: [0, 73],
      rgba: [73, 73, 73, 255],
    },
    {
      name: "RGB",
      type: 2,
      depth: 8,
      row: [0, 12, 34, 56],
      rgba: [12, 34, 56, 255],
    },
    {
      name: "grayscale alpha",
      type: 4,
      depth: 8,
      row: [0, 91, 47],
      rgba: [91, 91, 91, 47],
    },
    {
      name: "one-bit grayscale",
      type: 0,
      depth: 1,
      row: [0, 128],
      rgba: [255, 255, 255, 255],
    },
    {
      name: "16-bit grayscale",
      type: 0,
      depth: 16,
      row: [0, 0x12, 0x34],
      rgba: [0x12, 0x12, 0x12, 255],
    },
  ])("expands $name to RGBA8", async ({ type, depth, row, rgba }) => {
    const decode = await bounded();
    const result = await decodeBytes(decode, png(1, 1, row, type, depth));
    expect([...result.data]).toEqual(rgba);
  });

  it("expands a packed palette and preserves tRNS transparency", async () => {
    const decode = await bounded();
    const encoded = png(2, 1, [0, 0b0100_0000], 3, 1, [
      chunk("PLTE", new Uint8Array([100, 50, 25, 10, 20, 30])),
      chunk("tRNS", new Uint8Array([0, 128])),
    ]);
    expect([...(await decodeBytes(decode, encoded)).data]).toEqual([
      100, 50, 25, 0, 10, 20, 30, 128,
    ]);
  });

  it("accepts harmless ancillary chunks and consecutive IDAT segments", async () => {
    const compressed = deflateSync(new Uint8Array([0, 255, 0, 0, 255]));
    const encoded = concatenate(
      header(1, 1),
      chunk("tEXt", new Uint8Array([65, 0, 66])),
      chunk("IDAT", compressed.subarray(0, 5)),
      chunk("IDAT", compressed.subarray(5)),
      chunk("IEND", new Uint8Array()),
    );
    const decode = await bounded();
    expect([...(await decodeBytes(decode, encoded)).data]).toEqual([
      255, 0, 0, 255,
    ]);
  });

  it.each([0, 1, 2, 3, 4])("decodes PNG row filter %i", async (filter) => {
    const rows = [
      [4, 5, 6, 255, 18, 35, 210, 55],
      [11, 9, 1, 100, 127, 85, 43, 21],
    ];
    const scanlines: number[] = [];
    for (let y = 0; y < rows.length; y += 1) {
      scanlines.push(filter);
      for (let x = 0; x < rows[y].length; x += 1) {
        const left = rows[y][x - 4] ?? 0;
        const up = rows[y - 1]?.[x] ?? 0;
        const upperLeft = rows[y - 1]?.[x - 4] ?? 0;
        const estimate = left + up - upperLeft;
        const distances = [left, up, upperLeft].map((value) =>
          Math.abs(estimate - value),
        );
        const paeth =
          distances[0] <= distances[1] && distances[0] <= distances[2]
            ? left
            : distances[1] <= distances[2]
              ? up
              : upperLeft;
        const predictor = [0, left, up, Math.floor((left + up) / 2), paeth][
          filter
        ];
        scanlines.push((rows[y][x] - predictor) & 255);
      }
    }
    const decode = await bounded();
    expect([...(await decodeBytes(decode, png(2, 2, scanlines))).data]).toEqual(
      rows.flat(),
    );
  });

  it("returns independent compact buffers across sequential and concurrent calls", async () => {
    const decode = await bounded();
    const first = await decodeBytes(decode, RED);
    const requests = await Promise.all([
      decodeBytes(decode, TWO_ROWS),
      decodeBytes(decode, RED),
      decodeBytes(decode, TWO_ROWS),
    ]);
    const results = [first, ...requests];
    expect(new Set(results.map((result) => result.data.buffer)).size).toBe(4);
    for (const result of results) {
      expect(result.data.byteOffset).toBe(0);
      expect(result.data.buffer.byteLength).toBe(
        result.width * result.height * 4,
      );
    }
    first.data.fill(0);
    expect([...requests[1].data]).toEqual([255, 0, 0, 255]);
    expect([...(await decodeBytes(decode, RED)).data]).toEqual([
      255, 0, 0, 255,
    ]);
  });

  it("accepts the default finite budgets", async () => {
    const decode = await createBoundedPngDecoder({ wasmBinary: WASM });
    expect([...(await decodeBytes(decode, RED)).data]).toEqual([
      255, 0, 0, 255,
    ]);
  });
});

describe("bounded PNG input validation and memory enforcement", () => {
  it("snapshots caller-owned Wasm and options before asynchronous compilation", async () => {
    const wasmBinary = WASM.slice();
    const options = {
      wasmBinary,
      maximumWorkingBytes: HEAP_BYTES,
      maximumDecodedBytes: 4,
    };
    const pending = createBoundedPngDecoder(options);
    wasmBinary.fill(0);
    options.maximumDecodedBytes = 1;
    options.maximumWorkingBytes = 65_536;
    const decode = await pending;
    expect([...(await decodeBytes(decode, RED)).data]).toEqual([
      255, 0, 0, 255,
    ]);
  });

  it.each([
    { name: "nonletter chunk type", chunks: [chunk("tE!t", new Uint8Array())] },
    { name: "reserved chunk bit", chunks: [chunk("text", new Uint8Array())] },
    { name: "empty palette", chunks: [chunk("PLTE", new Uint8Array())] },
    { name: "oversized palette", chunks: [chunk("PLTE", new Uint8Array(771))] },
    {
      name: "incomplete palette entry",
      chunks: [chunk("PLTE", new Uint8Array(4))],
    },
    {
      name: "duplicate palette",
      chunks: [
        chunk("PLTE", new Uint8Array(3)),
        chunk("PLTE", new Uint8Array(3)),
      ],
    },
  ])("refuses $name before entering the codec", async ({ chunks }) => {
    const decode = await bounded();
    const encoded = png(1, 1, [0, 255, 0, 0, 255], 6, 8, chunks);
    await expect(decodeBytes(decode, encoded)).rejects.toMatchObject({
      code: "UNTRUSTED_INPUT_REJECTED",
    });
    expect([...(await decodeBytes(decode, RED)).data]).toEqual([
      255, 0, 0, 255,
    ]);
  });

  it("refuses a palette after image data", async () => {
    const decode = await bounded();
    const encoded = concatenate(
      RED.subarray(0, RED.length - 12),
      chunk("PLTE", new Uint8Array(3)),
      RED.subarray(RED.length - 12),
    );
    await expect(decodeBytes(decode, encoded)).rejects.toMatchObject({
      code: "UNTRUSTED_INPUT_REJECTED",
    });
  });

  it("refuses an incompatible codec with missing PNG exports", async () => {
    // A valid module with one 17-page heap, but no decoder exports.
    const wasmBinary = new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 0, 17,
    ]);
    await expect(createBoundedPngDecoder({ wasmBinary })).rejects.toMatchObject(
      {
        code: "UNTRUSTED_INPUT_REJECTED",
        cause: expect.objectContaining({
          message: expect.stringMatching(/exports/),
        }),
      },
    );
  });

  it("refuses a codec requesting an unknown host import", async () => {
    const wasmBinary = WASM.slice();
    const offset = Buffer.from(wasmBinary).indexOf("__wbindgen_memory");
    expect(offset).toBeGreaterThan(0);
    // Rename the import without changing section lengths or Wasm validity.
    wasmBinary[offset] = "X".charCodeAt(0);
    await expect(createBoundedPngDecoder({ wasmBinary })).rejects.toMatchObject(
      {
        code: "UNTRUSTED_INPUT_REJECTED",
        cause: expect.objectContaining({
          message: expect.stringMatching(/imports/),
        }),
      },
    );
  });
  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1.5,
    65_535,
    4_294_967_297,
  ])("refuses invalid working-memory limit %s", async (maximumWorkingBytes) => {
    await expect(bounded({ maximumWorkingBytes })).rejects.toBeInstanceOf(
      RangeError,
    );
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses non-finite or non-positive output/ratio limit %s",
    async (value) => {
      await expect(
        bounded({ maximumDecodedBytes: value }),
      ).rejects.toBeInstanceOf(RangeError);
      await expect(
        bounded({ maximumExpansionRatio: value }),
      ).rejects.toBeInstanceOf(RangeError);
    },
  );

  it.each([1.5, Number.MAX_SAFE_INTEGER + 1])(
    "refuses an output-byte limit that is not a safe integer: %s",
    async (maximumDecodedBytes) => {
      await expect(bounded({ maximumDecodedBytes })).rejects.toBeInstanceOf(
        RangeError,
      );
    },
  );

  it("rejects dimensions before allocating and leaves the decoder usable", async () => {
    const decode = await bounded({ maximumDecodedBytes: 4 });
    await expect(decodeBytes(decode, TWO_ROWS)).rejects.toMatchObject({
      code: "UNTRUSTED_INPUT_REJECTED",
    });
    await expect(
      decodeBytes(decode, header(30_000, 30_000)),
    ).rejects.toMatchObject({
      code: "UNTRUSTED_INPUT_REJECTED",
    });
    expect([...(await decodeBytes(decode, RED)).data]).toEqual([
      255, 0, 0, 255,
    ]);
  });

  it("checks expansion ratio before allocating and permits an exact output bound", async () => {
    const decode = await bounded({
      maximumDecodedBytes: 8,
      maximumExpansionRatio: 0.08,
    });
    await expect(decodeBytes(decode, TWO_ROWS)).rejects.toMatchObject({
      code: "UNTRUSTED_INPUT_REJECTED",
    });
    expect([...(await decodeBytes(decode, RED)).data]).toEqual([
      255, 0, 0, 255,
    ]);
    const exact = await bounded({ maximumDecodedBytes: 8 });
    expect((await decodeBytes(exact, TWO_ROWS)).data).toHaveLength(8);
  });

  it.each([
    { name: "empty input", encoded: new Uint8Array() },
    { name: "non-PNG signature", encoded: new Uint8Array(33) },
    { name: "truncated signature", encoded: PNG_SIGNATURE.subarray(0, 7) },
    {
      name: "missing IHDR",
      encoded: concatenate(PNG_SIGNATURE, chunk("IDAT", new Uint8Array(13))),
    },
    {
      name: "short IHDR",
      encoded: concatenate(PNG_SIGNATURE, chunk("IHDR", new Uint8Array(12))),
    },
    { name: "zero width", encoded: header(0, 1) },
    { name: "zero height", encoded: header(1, 0) },
    {
      name: "out-of-range dimensions",
      encoded: header(0xffff_ffff, 0xffff_ffff),
    },
    {
      name: "unsupported color type",
      encoded: concatenate(header(1, 1, 5), RED.subarray(33)),
    },
    {
      name: "unsupported bit depth",
      encoded: concatenate(header(1, 1, 6, 4), RED.subarray(33)),
    },
    {
      name: "unsupported compression",
      encoded: concatenate(header(1, 1, 6, 8, 1), RED.subarray(33)),
    },
    {
      name: "unsupported filtering",
      encoded: concatenate(header(1, 1, 6, 8, 0, 1), RED.subarray(33)),
    },
    {
      name: "unsupported interlace mode",
      encoded: concatenate(header(1, 1, 6, 8, 0, 0, 2), RED.subarray(33)),
    },
    { name: "no image data", encoded: header(1, 1) },
    { name: "truncated compressed stream", encoded: RED.subarray(0, 45) },
    {
      name: "invalid deflate stream",
      encoded: concatenate(
        header(1, 1),
        chunk("IDAT", new Uint8Array([1, 2, 3])),
        chunk("IEND", new Uint8Array()),
      ),
    },
    { name: "invalid row filter", encoded: png(1, 1, [5, 255, 0, 0, 255]) },
  ])("refuses $name with an engine error", async ({ encoded }) => {
    const decode = await bounded();
    await expect(decodeBytes(decode, encoded)).rejects.toMatchObject({
      code: "UNTRUSTED_INPUT_REJECTED",
    });
  });

  it.each([
    { name: "IHDR", offset: 29 },
    { name: "IDAT", offset: RED.length - 16 },
    { name: "IEND", offset: RED.length - 1 },
  ])("rejects a corrupt $name checksum", async ({ offset }) => {
    const decode = await bounded();
    const corrupt = RED.slice();
    corrupt[offset] ^= 1;
    await expect(decodeBytes(decode, corrupt)).rejects.toMatchObject({
      code: "UNTRUSTED_INPUT_REJECTED",
    });
  });

  it.each([
    { name: "missing IEND", encoded: RED.subarray(0, RED.length - 12) },
    { name: "truncated IEND", encoded: RED.subarray(0, RED.length - 1) },
    { name: "trailing bytes", encoded: concatenate(RED, new Uint8Array([0])) },
    {
      name: "unknown critical chunk",
      encoded: png(1, 1, [0, 255, 0, 0, 255], 6, 8, [
        chunk("ABCD", new Uint8Array()),
      ]),
    },
    {
      name: "repeated IHDR",
      encoded: concatenate(header(1, 1), RED.subarray(8)),
    },
    {
      name: "IDAT missing before IEND",
      encoded: concatenate(header(1, 1), chunk("IEND", new Uint8Array())),
    },
    {
      name: "nonempty IEND",
      encoded: concatenate(
        RED.subarray(0, RED.length - 12),
        chunk("IEND", new Uint8Array([1])),
      ),
    },
    ...["acTL", "fcTL", "fdAT"].map((name) => ({
      name: `animated PNG ${name} chunk`,
      encoded: png(1, 1, [0, 255, 0, 0, 255], 6, 8, [
        chunk(name, new Uint8Array()),
      ]),
    })),
  ])(
    "rejects malformed or unsupported structure: $name",
    async ({ encoded }) => {
      const decode = await bounded();
      await expect(decodeBytes(decode, encoded)).rejects.toMatchObject({
        code: "UNTRUSTED_INPUT_REJECTED",
      });
    },
  );

  it("rejects nonconsecutive IDAT chunks", async () => {
    const compressed = deflateSync(new Uint8Array([0, 255, 0, 0, 255]));
    const encoded = concatenate(
      header(1, 1),
      chunk("IDAT", compressed.subarray(0, 5)),
      chunk("tEXt", new Uint8Array([65, 0, 66])),
      chunk("IDAT", compressed.subarray(5)),
      chunk("IEND", new Uint8Array()),
    );
    const decode = await bounded();
    await expect(decodeBytes(decode, encoded)).rejects.toMatchObject({
      code: "UNTRUSTED_INPUT_REJECTED",
    });
  });

  it("refuses overflowing chunk lengths before decoding", async () => {
    const encoded = RED.slice();
    new DataView(encoded.buffer).setUint32(33, 0xffff_ffff);
    const decode = await bounded();
    await expect(decodeBytes(decode, encoded)).rejects.toMatchObject({
      code: "UNTRUSTED_INPUT_REJECTED",
    });
    expect([...(await decodeBytes(decode, RED)).data]).toEqual([
      255, 0, 0, 255,
    ]);
  });

  it("refuses encoded inputs larger than the heap before entering the codec", async () => {
    const maximumWorkingBytes = 2 * 1024 * 1024;
    const encoded = png(1, 1, [0, 255, 0, 0, 255], 6, 8, [
      chunk("tEXt", new Uint8Array(maximumWorkingBytes)),
    ]);
    const decode = await bounded({ maximumWorkingBytes });
    await expect(decodeBytes(decode, encoded)).rejects.toMatchObject({
      code: "UNTRUSTED_INPUT_REJECTED",
    });
    expect([...(await decodeBytes(decode, RED)).data]).toEqual([
      255, 0, 0, 255,
    ]);
  });

  it("enforces the Wasm heap ceiling during real decompression and poisons a failed instance", async () => {
    // The pinned codec starts at 17 pages. A 2 MiB maximum handles small PNGs,
    // but cannot fit this 1 MiB output plus the decoder's intermediate buffers.
    const maximumWorkingBytes = 32 * 65_536;
    const decode = await bounded({
      maximumWorkingBytes,
      maximumDecodedBytes: 2 * 1024 * 1024,
      maximumExpansionRatio: 100_000,
    });
    expect([...(await decodeBytes(decode, RED)).data]).toEqual([
      255, 0, 0, 255,
    ]);
    const compressed = png(512, 512, new Uint8Array((512 * 4 + 1) * 512));
    await expect(decodeBytes(decode, compressed)).rejects.toMatchObject({
      code: "UNTRUSTED_INPUT_REJECTED",
      cause: expect.any(WebAssembly.RuntimeError),
    });
    await expect(decodeBytes(decode, RED)).rejects.toMatchObject({
      code: "UNTRUSTED_INPUT_REJECTED",
    });
    // A fresh decoder remains useful after another instance has exhausted its heap.
    const healthy = await bounded();
    expect((await decodeBytes(healthy, compressed)).data).toHaveLength(
      512 * 512 * 4,
    );
  });
});

describe("bounded PNG strict texture integration", () => {
  it("accepts the registered decoder and flips rows through the texture pipeline", async () => {
    const decode = await bounded();
    const textureDecode = createTextureDecoder({
      decode,
      maximumWorkingBytes: HEAP_BYTES,
      colorSpace: "srgb",
    });
    const texture = await textureDecode(TWO_ROWS.buffer, "/bounded.png");
    expect(texture).toBeInstanceOf(TextureAsset);
    expect(texture.colorSpace).toBe("srgb");
    expect([...texture.data]).toEqual([0, 50, 255, 128, 255, 0, 0, 255]);
  });

  it("loads a real PNG with AssetManager and preserves ownership on release", async () => {
    const decode = await bounded();
    const assets = new AssetManager({
      fetch: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(""),
          json: () => Promise.resolve(null),
          arrayBuffer: () => Promise.resolve(TWO_ROWS.slice().buffer),
        }),
    });
    const loader = createTextureLoader({
      decode,
      maximumWorkingBytes: HEAP_BYTES,
    });
    const texture = await assets.load("/bounded.png", loader);
    expect([...texture.data]).toEqual([0, 50, 255, 128, 255, 0, 0, 255]);
    assets.release("/bounded.png", loader);
    expect(texture.isDisposed).toBe(true);
    expect([...(await decodeBytes(decode, RED)).data]).toEqual([
      255, 0, 0, 255,
    ]);
  });

  it("refuses a stricter loader ceiling and unregistered callback wrappers", async () => {
    const decode = await bounded();
    for (const options of [
      { decode, maximumWorkingBytes: HEAP_BYTES - 65_536 },
      {
        decode: (bytes: ArrayBuffer) => decode(bytes),
        maximumWorkingBytes: HEAP_BYTES,
      },
    ]) {
      try {
        createTextureDecoder(options);
        throw new Error("expected strict memory rejection");
      } catch (error) {
        expect(isFourError(error) && error.code).toBe(
          "INVALID_APPLICATION_STATE",
        );
      }
    }
  });
});
