import { isFourError } from "@fourjs/core";
import { describe, expect, it } from "vitest";

import { createBoundedAvifDecoder } from "../src/bounded-avif.js";
import { createBoundedWebpDecoder } from "../src/bounded-webp.js";
import { probeAvif, probeImage, probeWebp } from "../src/image-probe.js";

function leb(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  do {
    let byte = rest & 0x7f;
    rest >>>= 7;
    if (rest !== 0) byte |= 0x80;
    out.push(byte);
  } while (rest !== 0);
  return out;
}
function sleb(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  while (true) {
    const byte = rest & 0x7f;
    rest >>= 7;
    const sign = (byte & 0x40) !== 0;
    if ((rest === 0 && !sign) || (rest === -1 && sign)) {
      out.push(byte);
      break;
    }
    out.push(byte | 0x80);
  }
  return out;
}
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

/** Raw-ABI stand-in: malloc/free/decode writing a 2x1 red+green RGBA image. */
function rawStandIn(withImport = false): Uint8Array<ArrayBuffer> {
  const types = [
    3, 0x60, 1, 0x7f, 1, 0x7f, 0x60, 2, 0x7f, 0x7f, 0, 0x60, 3, 0x7f, 0x7f,
    0x7f, 1, 0x7f,
  ];
  const imports = withImport
    ? section(2, [1, ...name("env"), ...name("x"), 0, 1])
    : [];
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
    ...i32(8),
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
  const pixels = [255, 0, 0, 255, 0, 255, 0, 255].flatMap((v, i) => [
    ...i32(2048 + i),
    ...i32(v),
    0x3a,
    0,
    0,
  ]);
  const last = [0x20, 0, 0x20, 1, 0x6a, ...i32(1), 0x6b, 0x2d, 0, 0]; // load8_u(ptr+len-1)
  const decode = body([
    ...last,
    ...i32(0xf1),
    0x46,
    0x04,
    0x40,
    0x00,
    0x0b,
    0x20,
    2,
    ...i32(3),
    ...i32(2),
    ...last,
    ...i32(0xf2),
    0x46,
    0x1b,
    0x36,
    2,
    0,
    0x20,
    2,
    ...i32(1),
    0x36,
    2,
    4,
    ...pixels,
    ...i32(2048),
  ]);
  // With an import, function indices shift by one; keep the module trivially
  // valid by not calling imports and offsetting export indices.
  const shift = withImport ? 1 : 0;
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
    ...name("decode"),
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
    ...section(1, withImport ? [4, 0x60, 0, 0, ...types.slice(1)] : types),
    ...imports,
    ...section(3, [
      3,
      withImport ? 1 : 0,
      withImport ? 2 : 1,
      withImport ? 3 : 2,
    ]),
    ...section(5, [1, 1, 1, 1]),
    ...section(7, ex),
    ...section(10, [3, ...malloc, ...free, ...decode]),
  ]);
}

function webpLossless(w: number, h: number, pad = 0): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(30 + pad);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  b.set([0x56, 0x50, 0x38, 0x4c], 12);
  b[20] = 0x2f;
  const bits = ((w - 1) | ((h - 1) << 14)) >>> 0;
  b[21] = bits & 255;
  b[22] = (bits >> 8) & 255;
  b[23] = (bits >> 16) & 255;
  b[24] = (bits >>> 24) & 255;
  if (pad > 0 && pad < 3) b[b.length - 1] = 0xf0 + pad;
  return b;
}
function box(type: string, ...parts: number[][]): number[] {
  const payload = parts.flat();
  const size = 8 + payload.length;
  return [
    (size >>> 24) & 255,
    (size >> 16) & 255,
    (size >> 8) & 255,
    size & 255,
    ...chars(type),
    ...payload,
  ];
}
const u32 = (v: number): number[] => [
  (v >>> 24) & 255,
  (v >> 16) & 255,
  (v >> 8) & 255,
  v & 255,
];
function avif(
  w: number,
  h: number,
  pad = 0,
  brand = "avif",
): Uint8Array<ArrayBuffer> {
  const ftyp = box("ftyp", chars(brand), u32(0), chars("mif1"));
  const ispe = box("ispe", u32(0), u32(w), u32(h));
  const meta = box("meta", u32(0), box("iprp", box("ipco", ispe)));
  const out = new Uint8Array([
    ...ftyp,
    ...meta,
    ...new Array<number>(pad).fill(0),
  ]);
  if (pad > 0 && pad < 3) out[out.length - 1] = 0xf0 + pad;
  return out;
}

const rejected = (e: unknown): boolean =>
  isFourError(e) && e.code === "UNTRUSTED_INPUT_REJECTED";

describe("WebP and AVIF header probes (§96)", () => {
  it("probes VP8, VP8L and VP8X", () => {
    expect(probeWebp(webpLossless(5, 6).buffer)).toEqual({
      width: 5,
      height: 6,
    });
    const vp8x = webpLossless(1, 1);
    vp8x.set([0x56, 0x50, 0x38, 0x58], 12);
    vp8x.set([9, 0, 0], 24);
    vp8x.set([19, 0, 0], 27);
    expect(probeWebp(vp8x.buffer)).toEqual({ width: 10, height: 20 });
    const vp8 = webpLossless(1, 1);
    vp8.set([0x56, 0x50, 0x38, 0x20], 12);
    vp8.set([7, 0, 8, 0], 26);
    expect(probeWebp(vp8.buffer)).toEqual({ width: 7, height: 8 });
  });
  it("probes AVIF brands and the largest ispe, refusing others", () => {
    expect(probeAvif(avif(30, 40).buffer)).toEqual({ width: 30, height: 40 });
    expect(probeAvif(avif(3, 4, 0, "avis").buffer)).toEqual({
      width: 3,
      height: 4,
    });
    expect(probeImage(avif(3, 4).buffer)).toEqual({ width: 3, height: 4 });
    expect(probeAvif(avif(3, 4, 0, "heic").buffer)).toBeUndefined();
    expect(probeAvif(new Uint8Array(8).buffer)).toBeUndefined();
    const compat = new Uint8Array(avif(3, 4));
    expect(probeAvif(compat.slice(0, 20).buffer)).toBeUndefined();
    // compatible-brand match: major brand heic, compatible avif
    const ftyp = box("ftyp", chars("heic"), u32(0), chars("avif"));
    const rest = avif(6, 7).slice(
      box("ftyp", [0, 0, 0, 0], u32(0), [0, 0, 0, 0]).length,
    );
    expect(probeAvif(new Uint8Array([...ftyp, ...rest]).buffer)).toEqual({
      width: 6,
      height: 7,
    });
    // truncated meta box
    const cut = avif(3, 4);
    expect(probeAvif(cut.slice(0, cut.length - 3).buffer)).toBeUndefined();
    // larger of two ispe wins
    const two = box(
      "ipco",
      box("ispe", u32(0), u32(2), u32(2)),
      box("ispe", u32(0), u32(9), u32(9)),
    );
    const ftypA = box("ftyp", chars("avif"), u32(0), [0, 0, 0, 0]);
    const m = box("meta", u32(0), box("iprp", two));
    expect(probeAvif(new Uint8Array([...ftypA, ...m]).buffer)).toEqual({
      width: 9,
      height: 9,
    });
  });
});

const cases = [
  { label: "WebP", create: createBoundedWebpDecoder, make: webpLossless },
  { label: "AVIF", create: createBoundedAvifDecoder, make: avif },
] as const;

describe.each(cases)(
  "bounded $label codec ABI (§96)",
  ({ label, create, make }) => {
    const wasm = rawStandIn();
    const opts = { wasmBinary: wasm, maximumWorkingBytes: 65536 };

    it("decodes through the raw ABI into RGBA8", async () => {
      expect(WebAssembly.validate(wasm)).toBe(true);
      const decode = await create(opts);
      const px = await decode(make(2, 1).buffer);
      expect([px.width, px.height]).toEqual([2, 1]);
      expect(Array.from(px.data)).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
    });

    it("refuses oversize claims and unknown bytes before codec execution", async () => {
      const decode = await create({ ...opts, maximumDecodedBytes: 64 });
      expect(() => decode(new Uint8Array(40).buffer)).toThrow(
        new RegExp(label),
      );
      expect(() => decode(make(100, 100).buffer)).toThrow(/budget/);
      // not poisoned by pre-codec refusals
      expect((decode(make(2, 1).buffer) as { width: number }).width).toBe(2);
      const ratio = await create({ ...opts, maximumExpansionRatio: 0.01 });
      expect(() => ratio(make(2, 1).buffer)).toThrow(/budget/);
    });

    it("poisons after a trap, a header mismatch, or an allocation failure", async () => {
      const trap = await create(opts);
      expect(() => trap(make(2, 1, 1).buffer)).toThrow(/Invalid/);
      expect(() => trap(make(2, 1).buffer)).toThrow(/fresh bounded decoder/);
      const mismatch = await create(opts);
      expect(() => mismatch(make(2, 1, 2).buffer)).toThrow(/Invalid/);
      expect(() => mismatch(make(2, 1).buffer)).toThrow(/fresh/);
      const alloc = await create(opts);
      expect(() => alloc(make(2, 1, 62000).buffer)).toThrow(/Invalid/);
      const tooBig = await create(opts);
      expect(() => tooBig(make(2, 1, 70000).buffer)).toThrow(/working-memory/);
    });

    it("refuses bad limits, imports, missing exports, and over-cap heaps", async () => {
      await expect(create({ ...opts, maximumDecodedBytes: 0 })).rejects.toThrow(
        RangeError,
      );
      await expect(
        create({ ...opts, maximumExpansionRatio: Infinity }),
      ).rejects.toThrow(RangeError);
      await expect(
        create({ ...opts, wasmBinary: new Uint8Array([1, 2, 3]) }),
      ).rejects.toSatisfy(rejected);
      await expect(
        create({ ...opts, wasmBinary: rawStandIn(true) }),
      ).rejects.toSatisfy(rejected);
      const memoryOnly = new Uint8Array([
        0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 5, 3, 1, 0, 1, 7, 10, 1, 6, 0x6d, 0x65,
        0x6d, 0x6f, 0x72, 0x79, 0x02, 0,
      ]);
      await expect(
        create({ ...opts, wasmBinary: memoryOnly }),
      ).rejects.toSatisfy(rejected);
      await expect(
        create({ ...opts, maximumWorkingBytes: 100 }),
      ).rejects.toThrow();
    });
  },
);
