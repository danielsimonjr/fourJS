import { isFourError } from "@fourjs/core";
import { describe, expect, it } from "vitest";

import { createBoundedJpegDecoder } from "../src/bounded-jpeg.js";

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

/** Signed LEB128 for `i32.const`. Unsigned encoding makes 64 read as −64. */
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

function name(text: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    bytes.push(text.charCodeAt(i));
  }
  return [...leb(text.length), ...bytes];
}

function section(id: number, payload: number[]): number[] {
  return [id, ...leb(payload.length), ...payload];
}

function body(code: number[]): number[] {
  const payload = [0, ...code, 0x0b];
  return [...leb(payload.length), ...payload];
}

function i32(value: number): number[] {
  return [0x41, ...sleb(value)];
}

/** A tiny Wasm JPEG stand-in with the pinned jSquash export names. */
function jpegStandIn(): Uint8Array<ArrayBuffer> {
  const types = [
    5, 0x60, 4, 0x7f, 0x7f, 0x7f, 0x7f, 1, 0x7f, 0x60, 1, 0x7f, 0, 0x60, 0, 0,
    0x60, 2, 0x7f, 0x7f, 1, 0x7f, 0x60, 3, 0x7f, 0x7f, 0x7f, 0,
  ];
  const imports = [
    3,
    ...name("wbg"),
    ...name("__wbg_newwithownedu8clampedarrayandsh_91db5987993a08fb"),
    0x00,
    0,
    ...name("wbg"),
    ...name("__wbindgen_object_drop_ref"),
    0x00,
    1,
    ...name("wbg"),
    ...name("__wbindgen_throw"),
    0x00,
    2,
  ];
  const functions = [3, 3, 4, 3];
  const memory = [1, 1, 1, 1];
  const exports = [
    4,
    ...name("memory"),
    0x02,
    0,
    ...name("__wbindgen_malloc"),
    0x00,
    3,
    ...name("__wbindgen_free"),
    0x00,
    4,
    ...name("decode"),
    0x00,
    5,
  ];
  const stores = [255, 0, 0, 255, 0, 255, 0, 255].flatMap((value, index) => [
    ...i32(256 + index),
    ...i32(value),
    0x3a,
    0x00,
    0x00,
  ]);
  const malloc = body([
    0x20,
    0x00,
    ...i32(1000),
    0x4b,
    0x04,
    0x7f,
    ...i32(0),
    0x05,
    ...i32(64),
    0x0b,
  ]);
  const free = body([]);
  const decode = body([
    0x02,
    0x7f,
    0x20,
    0x01,
    ...i32(80),
    0x4b,
    0x04,
    0x40,
    0x10,
    2,
    ...i32(0),
    0x0c,
    1,
    0x0b,
    0x20,
    0x01,
    ...i32(40),
    0x4b,
    0x04,
    0x40,
    ...i32(0),
    0x0c,
    1,
    0x0b,
    ...stores,
    ...i32(0),
    0x10,
    1,
    ...i32(256),
    ...i32(8),
    ...i32(99),
    ...i32(2),
    0x20,
    0x01,
    ...i32(30),
    0x4b,
    0x1b,
    ...i32(1),
    0x10,
    0,
    0x1a,
    ...i32(132),
    0x0b,
  ]);
  const bytes = [
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    ...section(1, types),
    ...section(2, imports),
    ...section(3, functions),
    ...section(5, memory),
    ...section(7, exports),
    ...section(10, [3, ...malloc, ...free, ...decode]),
  ];
  return new Uint8Array(bytes);
}

function jpeg(width: number, height: number, pad = 0): Uint8Array<ArrayBuffer> {
  const sof = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 255,
    height & 255,
    (width >> 8) & 255,
    width & 255,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ]);
  const bytes = new Uint8Array(sof.length + pad);
  bytes.set(sof);
  return bytes;
}

function isRejected(error: unknown): boolean {
  return isFourError(error) && error.code === "UNTRUSTED_INPUT_REJECTED";
}

describe("bounded JPEG codec ABI (§96)", () => {
  const wasm = jpegStandIn();

  it("decodes through the pinned export names into RGBA8", async () => {
    expect(WebAssembly.validate(wasm)).toBe(true);
    const decode = await createBoundedJpegDecoder({
      wasmBinary: wasm,
      maximumWorkingBytes: 65536,
    });
    const pixels = await decode(jpeg(2, 1).buffer);
    expect(pixels.width).toBe(2);
    expect(pixels.height).toBe(1);
    expect(Array.from(pixels.data)).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });

  it("refuses a non-JPEG, an oversize claim, and a poisoned instance", async () => {
    const decode = await createBoundedJpegDecoder({
      wasmBinary: wasm,
      maximumWorkingBytes: 65536,
      maximumDecodedBytes: 64,
    });
    expect(() => decode(new Uint8Array([1, 2, 3, 4]).buffer)).toThrow(/JPEG/);
    expect(() => decode(jpeg(100, 100).buffer)).toThrow(/budget/);
    expect(() => decode(jpeg(2, 1, 15).buffer)).toThrow(/Invalid JPEG/);
    expect(() => decode(jpeg(2, 1).buffer)).toThrow(/fresh bounded decoder/);
  });

  it("refuses an input that cannot be allocated inside the heap", async () => {
    const decode = await createBoundedJpegDecoder({
      wasmBinary: wasm,
      maximumWorkingBytes: 65536,
    });
    expect(() => decode(jpeg(1, 1, 2000).buffer)).toThrow(/Invalid JPEG/);
  });

  it("refuses a codec that traps through an unsupported import", async () => {
    const decode = await createBoundedJpegDecoder({
      wasmBinary: wasm,
      maximumWorkingBytes: 65536,
    });
    expect(() => decode(jpeg(2, 1, 70).buffer)).toThrow(/Invalid JPEG/);
  });

  it("refuses limits, unknown imports, and a module missing decode", async () => {
    await expect(
      createBoundedJpegDecoder({
        wasmBinary: wasm,
        maximumWorkingBytes: 65536,
        maximumDecodedBytes: 0,
      }),
    ).rejects.toThrow(RangeError);
    await expect(
      createBoundedJpegDecoder({
        wasmBinary: new Uint8Array([
          0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 1, 4, 1, 0x60, 0, 0,
          2, 10, 1, 3, 0x65, 0x6e, 0x76, 1, 0x78, 0, 0, 5, 3, 1, 1, 1,
        ]),
        maximumWorkingBytes: 65536,
      }),
    ).rejects.toSatisfy(isRejected);
    const memoryOnly = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 5, 3, 1, 0, 1, 7, 10, 1,
      6, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0,
    ]);
    await expect(
      createBoundedJpegDecoder({
        wasmBinary: memoryOnly,
        maximumWorkingBytes: 65536,
      }),
    ).rejects.toSatisfy(isRejected);
  });
});
