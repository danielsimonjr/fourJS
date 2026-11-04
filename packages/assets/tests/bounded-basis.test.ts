import { isFourError } from "@fourjs/core";
import { describe, expect, it } from "vitest";

import { createBoundedBasisTranscoder } from "../src/bounded-basis.js";
import { parseKtx2 } from "../src/ktx2.js";

// ---- tiny wasm assembler -------------------------------------------------
const leb = (value: number): number[] => {
  const out: number[] = [];
  let rest = value;
  do {
    let byte = rest & 0x7f;
    rest >>>= 7;
    if (rest !== 0) byte |= 0x80;
    out.push(byte);
  } while (rest !== 0);
  return out;
};
const sleb = (value: number): number[] => {
  const out: number[] = [];
  let rest = value;
  while (true) {
    const byte = rest & 0x7f;
    rest >>= 7;
    const sign = (byte & 0x40) !== 0;
    if ((rest === 0 && !sign) || (rest === -1 && sign)) {
      out.push(byte);
      return out;
    }
    out.push(byte | 0x80);
  }
};
const chars = (t: string): number[] => t.split("").map((c) => c.charCodeAt(0));
const name = (t: string): number[] => [...leb(t.length), ...chars(t)];
const section = (id: number, p: number[]): number[] => [
  id,
  ...leb(p.length),
  ...p,
];
const body = (code: number[]): number[] => {
  const p = [0, ...code, 0x0b];
  return [...leb(p.length), ...p];
};
const i32 = (v: number): number[] => [0x41, ...sleb(v)];

const OUT = 4096;
interface FakeSpec {
  /** Output bytes; byte 0 is overwritten with the target code when echoing. */
  out: number[];
  info: number[];
  returnZero?: boolean;
  trap?: boolean;
  withImport?: boolean;
  missingExport?: boolean;
  /** Echo the 5th ABI argument (level limit) into output byte 1. */
  echoLimit?: boolean;
}
/** Fake transcoder: malloc is a 2-way bump; transcode stores known blocks. */
function fakeTranscoder(spec: FakeSpec): Uint8Array<ArrayBuffer> {
  const types = [
    3, 0x60, 1, 0x7f, 1, 0x7f, 0x60, 2, 0x7f, 0x7f, 0, 0x60, 5, 0x7f, 0x7f,
    0x7f, 0x7f, 0x7f, 1, 0x7f,
  ];
  // malloc(len): len > 60000 ? 0 : len == 76 ? 512 : 1024   (76 = 12 + 4*16)
  const malloc = body([
    0x20,
    0,
    ...i32(60000),
    0x4b,
    0x04,
    0x7f,
    ...i32(0),
    0x05,
    0x20,
    0,
    ...i32(76),
    0x46,
    0x04,
    0x7f,
    ...i32(512),
    0x05,
    ...i32(1024),
    0x0b,
    0x0b,
  ]);
  const free = body([]);
  const stores: number[] = [];
  spec.out.forEach((b, i) =>
    stores.push(...i32(OUT + i), ...i32(b), 0x3a, 0, 0),
  );
  // byte 0 of the output echoes `target` (local 2)
  stores.push(...i32(OUT), 0x20, 2, 0x3a, 0, 0);
  if (spec.echoLimit) stores.push(...i32(OUT + 1), 0x20, 4, 0x3a, 0, 0);
  spec.info.forEach((v, i) => stores.push(0x20, 3, ...i32(v), 0x36, 2, i * 4));
  const transcode = body([
    ...(spec.trap ? [0x00] : []),
    ...stores,
    ...i32(spec.returnZero ? 0 : OUT),
  ]);
  const shift = spec.withImport ? 1 : 0;
  const ex = [
    4,
    ...name("memory"),
    0x02,
    0,
    ...name("malloc"),
    0x00,
    shift,
    ...name("free"),
    0x00,
    1 + shift,
    ...name(spec.missingExport ? "nope" : "transcode"),
    0x00,
    2 + shift,
  ];
  return new Uint8Array([
    0,
    0x61,
    0x73,
    0x6d,
    1,
    0,
    0,
    0,
    ...section(1, spec.withImport ? [4, 0x60, 0, 0, ...types.slice(1)] : types),
    ...(spec.withImport
      ? section(2, [1, ...name("env"), ...name("x"), 0, 0])
      : []),
    ...section(3, [
      3,
      spec.withImport ? 1 : 0,
      spec.withImport ? 2 : 1,
      spec.withImport ? 3 : 2,
    ]),
    ...section(5, [1, 1, 1, 1]),
    ...section(7, ex),
    ...section(10, [3, ...malloc, ...free, ...transcode]),
  ]);
}

// ---- KTX2 builder --------------------------------------------------------
interface KtxSpec {
  width?: number;
  height?: number;
  levels?: number;
  scheme?: number;
  vkFormat?: number;
  colorModel?: number;
  transfer?: number;
  depth?: number;
  layers?: number;
  faces?: number;
  kv?: Array<[string, string]>;
  dfd?: boolean;
}
function ktx2(spec: KtxSpec = {}): Uint8Array<ArrayBuffer> {
  const levels = spec.levels ?? 2;
  const dfdBytes = spec.dfd === false ? [] : new Array<number>(44).fill(0);
  if (spec.dfd !== false) {
    dfdBytes[0] = 44;
    dfdBytes[12] = spec.colorModel ?? 166;
    dfdBytes[14] = spec.transfer ?? 2;
  }
  const kv: number[] = [];
  for (const [k, v] of spec.kv ?? []) {
    const entry = [...chars(k), 0, ...chars(v)];
    kv.push(entry.length, 0, 0, 0, ...entry);
    while (kv.length % 4 !== 0) kv.push(0);
  }
  const indexEnd = 80 + levels * 24;
  const dfdOffset = indexEnd;
  const kvOffset = dfdOffset + dfdBytes.length;
  const dataOffset = kvOffset + kv.length;
  const out = new Uint8Array(dataOffset + levels * 16);
  const view = new DataView(out.buffer);
  out.set([
    0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  view.setUint32(12, spec.vkFormat ?? 0, true);
  view.setUint32(16, 1, true);
  view.setUint32(20, spec.width ?? 8, true);
  view.setUint32(24, spec.height ?? 8, true);
  view.setUint32(28, spec.depth ?? 0, true);
  view.setUint32(32, spec.layers ?? 0, true);
  view.setUint32(36, spec.faces ?? 1, true);
  view.setUint32(40, levels, true);
  view.setUint32(44, spec.scheme ?? 0, true);
  view.setUint32(48, dfdOffset, true);
  view.setUint32(52, dfdBytes.length, true);
  view.setUint32(56, kvOffset, true);
  view.setUint32(60, kv.length, true);
  out.set(dfdBytes, dfdOffset);
  out.set(kv, kvOffset);
  for (let i = 0; i < levels; i++) {
    view.setBigUint64(80 + i * 24, BigInt(dataOffset + i * 16), true);
    view.setBigUint64(88 + i * 24, 16n, true);
    view.setBigUint64(96 + i * 24, 64n, true);
  }
  return out;
}

const ALL = ["bc7-rgba-unorm", "etc2-rgba8unorm", "astc-4x4-unorm"] as const;
// 8x8, 2 levels: 4 blocks (64 B) + 1 block (16 B) compressed.
const compressedSpec = (): FakeSpec => ({
  out: Array.from({ length: 80 }, (_, i) => (i * 7) & 255),
  info: [8, 8, 2, 64, 16],
});

function rejects(fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    expect(isFourError(error)).toBe(true);
    return;
  }
  throw new Error("expected a rejection");
}

describe("parseKtx2 cube/layer/overlap refusals", () => {
  const patch = (fn: (v: DataView) => void): ArrayBuffer => {
    const copy = ktx2().slice();
    fn(new DataView(copy.buffer));
    return copy.buffer;
  };
  it("refuses non-square cubes", () => {
    rejects(() =>
      parseKtx2(
        patch((v) => {
          v.setUint32(36, 6, true);
          v.setUint32(24, 4, true);
        }),
      ),
    );
    expect(parseKtx2(patch((v) => v.setUint32(36, 6, true))).faceCount).toBe(6);
  });
  it("refuses cubes with depth", () => {
    rejects(() =>
      parseKtx2(
        patch((v) => {
          v.setUint32(36, 6, true);
          v.setUint32(28, 2, true);
        }),
      ),
    );
  });
  it("refuses overlapping level ranges", () => {
    rejects(() =>
      parseKtx2(
        patch((v) => v.setBigUint64(80 + 24, v.getBigUint64(80, true), true)),
      ),
    );
  });
  it("multiplies layers and faces into the working budget", () => {
    const size = ktx2().byteLength;
    const limit = size + 128 + 64;
    expect(() =>
      parseKtx2(ktx2().buffer, { maximumWorkingBytes: limit }),
    ).not.toThrow();
    rejects(() =>
      parseKtx2(
        patch((v) => v.setUint32(32, 8, true)),
        {
          maximumWorkingBytes: limit,
        },
      ),
    );
    rejects(() =>
      parseKtx2(
        patch((v) => v.setUint32(36, 6, true)),
        {
          maximumWorkingBytes: limit,
        },
      ),
    );
  });
});

describe("parseKtx2", () => {
  it("reads header, levels, DFD and key/value data", () => {
    const info = parseKtx2(
      ktx2({
        kv: [
          ["KTXwriter", "fourJS"],
          ["a", "bc"],
        ],
      }).buffer,
    );
    expect(info).toMatchObject({
      width: 8,
      height: 8,
      supercompression: "none",
      vkFormat: 0,
    });
    expect(info.levels).toHaveLength(2);
    expect(info.dfd).toMatchObject({ basis: "uastc", transferFunction: 2 });
    expect(new TextDecoder().decode(info.keyValues.get("KTXwriter"))).toBe(
      "fourJS",
    );
    expect(info.keyValues.get("a")).toHaveLength(2);
    expect(
      parseKtx2(ktx2({ colorModel: 163, dfd: true }).buffer).dfd?.basis,
    ).toBe("etc1s");
    expect(
      parseKtx2(ktx2({ colorModel: 1 }).buffer).dfd?.basis,
    ).toBeUndefined();
    expect(parseKtx2(ktx2({ dfd: false }).buffer).dfd).toBeUndefined();
    expect(parseKtx2(ktx2({ scheme: 1 }).buffer).supercompression).toBe(
      "basislz",
    );
  });

  it("treats levelCount 0 as one stored level", () => {
    const bytes = ktx2({ levels: 1 });
    new DataView(bytes.buffer).setUint32(40, 0, true);
    expect(parseKtx2(bytes.buffer).levels).toHaveLength(1);
  });

  it("refuses malformed or oversized containers", () => {
    const good = ktx2();
    const mutate = (fn: (v: DataView, b: Uint8Array) => void): ArrayBuffer => {
      const copy = good.slice();
      fn(new DataView(copy.buffer), copy);
      return copy.buffer;
    };
    rejects(() => parseKtx2(good.slice(0, 40).buffer));
    rejects(() => parseKtx2(mutate((_v, b) => (b[0] = 0)))); // identifier
    rejects(() => parseKtx2(good.buffer, { maximumWorkingBytes: 100 }));
    expect(() => parseKtx2(good.buffer, { maximumWorkingBytes: 0 })).toThrow(
      RangeError,
    );
    rejects(() => parseKtx2(mutate((v) => v.setUint32(20, 0, true)))); // width
    rejects(() => parseKtx2(mutate((v) => v.setUint32(36, 3, true)))); // faces
    rejects(() => parseKtx2(mutate((v) => v.setUint32(40, 33, true)))); // levels
    rejects(() => parseKtx2(mutate((v) => v.setUint32(44, 9, true)))); // scheme
    rejects(() =>
      parseKtx2(
        mutate((v) => {
          v.setUint32(24, 0, true);
          v.setUint32(28, 4, true);
        }),
      ),
    );
    rejects(() => parseKtx2(mutate((v) => v.setUint32(40, 31, true)))); // index overrun
    rejects(() =>
      parseKtx2(mutate((v) => v.setBigUint64(88, 1_000_000n, true))),
    ); // level length
    rejects(() => parseKtx2(mutate((v) => v.setBigUint64(80, 0n, true)))); // overlaps header
    rejects(() =>
      parseKtx2(mutate((v) => v.setBigUint64(96, 1n << 60n, true))),
    ); // > safe/budget
    rejects(() =>
      parseKtx2(mutate((v) => v.setBigUint64(96, 1n << 63n, true))),
    ); // u64 range
    rejects(() => parseKtx2(mutate((v) => v.setUint32(52, 1_000_000, true)))); // dfd range
    rejects(() => parseKtx2(mutate((v) => v.setUint32(52, 8, true)))); // dfd short
    rejects(() => parseKtx2(mutate((v) => v.setUint32(60, 1_000_000, true)))); // kvd range
    rejects(() =>
      parseKtx2(mutate((v) => v.setBigUint64(72, 1_000_000n, true))),
    ); // sgd range
  });

  it("refuses malformed key/value data", () => {
    const withKv = (kv: number[]): ArrayBuffer => {
      const base = ktx2({ kv: [["k", "v"]] });
      const v = new DataView(base.buffer);
      const off = v.getUint32(56, true);
      base.set(kv, off);
      v.setUint32(60, kv.length, true);
      return base.buffer;
    };
    rejects(() => parseKtx2(withKv([1, 0])));
    rejects(() => parseKtx2(withKv([200, 0, 0, 0, 1, 0, 0, 0])));
    rejects(() => parseKtx2(withKv([2, 0, 0, 0, 0x61, 0x62, 0, 0]))); // no NUL
    rejects(() => parseKtx2(withKv([2, 0, 0, 0, 0, 0x62, 0, 0]))); // empty key
    rejects(() => parseKtx2(withKv([3, 0, 0, 0, 0xff, 0, 0x62, 0]))); // bad utf-8
  });
});

describe("createBoundedBasisTranscoder", () => {
  it("transcodes to the preferred supported compressed format", async () => {
    const transcode = await createBoundedBasisTranscoder({
      wasmBinary: fakeTranscoder(compressedSpec()),
    });
    const out = transcode(ktx2().buffer, { supportedFormats: [...ALL] });
    expect(out).toMatchObject({
      width: 8,
      height: 8,
      format: "bc7-rgba-unorm",
      colorSpace: "srgb",
    });
    expect(out.levels?.map((l) => l.length)).toEqual([64, 16]);
    const expected = compressedSpec().out;
    expect(out.levels![0][0]).toBe(1); // echoed target code (bc7)
    expect(Array.from(out.levels![0].subarray(1, 64))).toEqual(
      expected.slice(1, 64),
    );
    expect(Array.from(out.levels![1])).toEqual(expected.slice(64, 80));
    // Deterministic (§33) and ordered by preference.
    expect(transcode(ktx2().buffer, { supportedFormats: [...ALL] })).toEqual(
      out,
    );
    expect(
      transcode(ktx2().buffer, {
        supportedFormats: ["astc-4x4-unorm", "etc2-rgba8unorm"],
      }).format,
    ).toBe("astc-4x4-unorm");
    expect(
      transcode(ktx2().buffer, { supportedFormats: ["etc2-rgba8unorm"] })
        .levels![0][0],
    ).toBe(2);
  });

  it("falls back to RGBA8 when nothing is supported", async () => {
    const out8 = Array.from({ length: 4 * 4 * 4 }, (_, i) => i & 255);
    const transcode = await createBoundedBasisTranscoder({
      wasmBinary: fakeTranscoder({ out: out8, info: [4, 4, 1, 64] }),
    });
    const source = transcode(
      ktx2({ width: 4, height: 4, levels: 1, transfer: 1 }).buffer,
    );
    expect(source).toMatchObject({
      format: "rgba8unorm",
      colorSpace: "linear",
      mipmaps: false,
    });
    expect(source.data).toHaveLength(64);
    expect(source.data![0]).toBe(0); // target code 0
    expect(source.data![5]).toBe(5);
    expect(source.levels).toBeUndefined();
  });

  it("flags a fallback mip chain for backend generation", async () => {
    const transcode = await createBoundedBasisTranscoder({
      wasmBinary: fakeTranscoder({
        out: new Array<number>(80).fill(9),
        info: [4, 4, 1, 64],
      }),
    });
    expect(
      transcode(ktx2({ width: 4, height: 4, levels: 3 }).buffer, {
        supportedFormats: [],
      }).mipmaps,
    ).toBe(true);
  });

  it("refuses input that is not a plain 2D Basis texture", async () => {
    const transcode = await createBoundedBasisTranscoder({
      wasmBinary: fakeTranscoder(compressedSpec()),
    });
    rejects(() => transcode(ktx2({ dfd: false }).buffer));
    rejects(() => transcode(ktx2({ vkFormat: 37 }).buffer));
    rejects(() => transcode(ktx2({ scheme: 2 }).buffer));
    rejects(() => transcode(ktx2({ scheme: 3 }).buffer));
    rejects(() => transcode(ktx2({ depth: 2 }).buffer));
    rejects(() => transcode(ktx2({ layers: 2 }).buffer));
    rejects(() => transcode(ktx2({ faces: 6 }).buffer));
    rejects(() => transcode(ktx2({ height: 0 }).buffer));
    rejects(() =>
      transcode(ktx2({ levels: 17, width: 65536, height: 65536 }).buffer),
    );
    // Valid again: refusals before the ABI call do not poison.
    expect(
      transcode(ktx2().buffer, { supportedFormats: [...ALL] }).levels,
    ).toHaveLength(2);
  });

  it("enforces decoded and working budgets before calling the ABI", async () => {
    const small = await createBoundedBasisTranscoder({
      wasmBinary: fakeTranscoder(compressedSpec()),
      maximumDecodedBytes: 70,
    });
    rejects(() => small(ktx2().buffer, { supportedFormats: [...ALL] })); // 80 > 70
    const tight = await createBoundedBasisTranscoder({
      wasmBinary: fakeTranscoder(compressedSpec()),
      maximumWorkingBytes: 65536,
    });
    rejects(() => tight(ktx2({ width: 2048, height: 2048, levels: 1 }).buffer));
    await expect(
      createBoundedBasisTranscoder({
        wasmBinary: fakeTranscoder(compressedSpec()),
        maximumDecodedBytes: 0,
      }),
    ).rejects.toThrow(RangeError);
  });

  it("rejects bad modules and poisons after a bad output or trap", async () => {
    await expect(
      createBoundedBasisTranscoder({
        wasmBinary: fakeTranscoder({ ...compressedSpec(), withImport: true }),
      }),
    ).rejects.toThrow();
    await expect(
      createBoundedBasisTranscoder({
        wasmBinary: fakeTranscoder({
          ...compressedSpec(),
          missingExport: true,
        }),
      }),
    ).rejects.toThrow();
    for (const bad of [
      { ...compressedSpec(), returnZero: true },
      { ...compressedSpec(), info: [8, 8, 2, 64, 17] },
      { ...compressedSpec(), info: [9, 8, 2, 64, 16] },
      { ...compressedSpec(), info: [8, 8, 1, 64, 16] },
      { ...compressedSpec(), trap: true },
    ]) {
      const transcode = await createBoundedBasisTranscoder({
        wasmBinary: fakeTranscoder(bad),
      });
      rejects(() => transcode(ktx2().buffer, { supportedFormats: [...ALL] }));
      rejects(() => transcode(ktx2().buffer, { supportedFormats: [...ALL] })); // poisoned
    }
  });

  it("refuses output that does not fit the heap and failed allocations", async () => {
    // 1024 + 76 + 12 pages... use a texture whose output would run off one 64 KiB page.
    const transcode = await createBoundedBasisTranscoder({
      wasmBinary: fakeTranscoder({ out: [], info: [256, 256, 1, 16384] }),
    });
    rejects(() =>
      transcode(ktx2({ width: 256, height: 256, levels: 1 }).buffer, {
        supportedFormats: [...ALL],
      }),
    );
    // malloc returns 0 for inputs over 60000 bytes
    const big = await createBoundedBasisTranscoder({
      wasmBinary: fakeTranscoder(compressedSpec()),
    });
    const huge = new Uint8Array(61_000);
    huge.set(ktx2());
    rejects(() => big(huge.buffer, { supportedFormats: [...ALL] }));
  });
});

describe("block alignment and single-level fallback", () => {
  it("falls back to RGBA8 for non-multiple-of-4 sizes and builds a Texture", async () => {
    const { Texture } = await import("@fourjs/render");
    const bytes = 100 * 75 * 4;
    const transcode = await createBoundedBasisTranscoder({
      wasmBinary: fakeTranscoder({
        out: new Array<number>(bytes).fill(7),
        info: [100, 75, 1, bytes],
      }),
    });
    const source = transcode(
      ktx2({ width: 100, height: 75, levels: 1 }).buffer,
      { supportedFormats: [...ALL] },
    );
    expect(source.format).toBe("rgba8unorm");
    expect(source.levels).toBeUndefined();
    expect(() => new Texture(source)).not.toThrow();
  });

  it("asks the ABI for a single level on the RGBA8 fallback", async () => {
    const transcode = await createBoundedBasisTranscoder({
      wasmBinary: fakeTranscoder({
        out: new Array<number>(64).fill(9),
        info: [4, 4, 1, 64],
        echoLimit: true,
      }),
    });
    const fallback = transcode(ktx2({ width: 4, height: 4, levels: 3 }).buffer);
    expect(fallback.data![1]).toBe(1);
    expect(fallback.mipmaps).toBe(true);
    const block = await createBoundedBasisTranscoder({
      wasmBinary: fakeTranscoder({
        out: new Array<number>(80).fill(9),
        info: [8, 8, 2, 64, 16],
        echoLimit: true,
      }),
    });
    const out = block(ktx2().buffer, { supportedFormats: [...ALL] });
    expect(out.levels![0][1]).toBe(2);
  });
});
