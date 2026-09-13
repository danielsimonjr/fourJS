import { FourError } from "@fourjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { limitWasmMemory } from "../src/wasm-memory.js";

const PAGE = 65536;
const header = [0, 97, 115, 109, 1, 0, 0, 0];
const memoryExport = [7, 10, 1, 6, 109, 101, 109, 111, 114, 121, 2, 0];

function leb(value: number): number[] {
  const bytes: number[] = [];
  do {
    const byte = value % 128;
    value = Math.floor(value / 128);
    bytes.push(byte | (value > 0 ? 128 : 0));
  } while (value > 0);
  return bytes;
}

function section(id: number, payload: number[]): number[] {
  return [id, ...leb(payload.length), ...payload];
}

function moduleBytes(...sections: number[][]): Uint8Array<ArrayBuffer> {
  return new Uint8Array([...header, ...sections.flat()]);
}

function memorySection(initial = 1, maximum?: number): number[] {
  return section(5, [
    1,
    maximum === undefined ? 0 : 1,
    ...leb(initial),
    ...(maximum === undefined ? [] : leb(maximum)),
  ]);
}

function memoryModule(initial = 1, maximum?: number): Uint8Array<ArrayBuffer> {
  return moduleBytes(memorySection(initial, maximum), memoryExport);
}

function importEntry(kind: number, type: number[]): number[] {
  // All fixtures import from module "m", field "x".
  return [1, 109, 1, 120, kind, ...type];
}

function refuse(bytes: Uint8Array): void {
  expect(() => limitWasmMemory(bytes, PAGE)).toThrowError(
    expect.objectContaining<Partial<FourError>>({
      code: "UNTRUSTED_INPUT_REJECTED",
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("native Wasm memory budget", () => {
  it("enforces the budget inside guest memory.grow and preserves data/custom sections", async () => {
    // (func (export "grow") (param i32) (result i32)
    //   local.get 0 memory.grow)
    const original = moduleBytes(
      section(0, [3, 112, 114, 101, ...Array<number>(130).fill(7)]),
      section(1, [1, 0x60, 1, 0x7f, 1, 0x7f]),
      section(3, [1, 0]),
      memorySection(1, 4),
      section(0, [4, 112, 111, 115, 116, 9]),
      section(
        7,
        [2, 6, 109, 101, 109, 111, 114, 121, 2, 0, 4, 103, 114, 111, 119, 0, 0],
      ),
      section(10, [1, 6, 0, 0x20, 0, 0x40, 0, 0x0b]),
      section(11, [1, 0, 0x41, 0, 0x0b, 4, 3, 1, 4, 1]),
    );
    const before = original.slice();
    const limited = limitWasmMemory(original, 2 * PAGE);
    const compiled = await WebAssembly.compile(limited);
    const instance = await WebAssembly.instantiate(compiled);
    const memory = instance.exports.memory as WebAssembly.Memory;
    const grow = instance.exports.grow as (pages: number) => number;
    expect(grow(1)).toBe(1);
    expect(memory.buffer.byteLength).toBe(2 * PAGE);
    // Guest growth fails with -1; no JavaScript wrapper needs to observe it.
    expect(grow(1)).toBe(-1);
    expect(grow(0)).toBe(2);
    expect(memory.buffer.byteLength).toBe(2 * PAGE);
    expect([...new Uint8Array(memory.buffer, 0, 4)]).toEqual([3, 1, 4, 1]);
    expect(
      new Uint8Array(WebAssembly.Module.customSections(compiled, "pre")[0]),
    ).toEqual(new Uint8Array(130).fill(7));
    expect(
      new Uint8Array(WebAssembly.Module.customSections(compiled, "post")[0]),
    ).toEqual(new Uint8Array([9]));
    expect(original).toEqual(before);
    expect(limited.buffer).not.toBe(original.buffer);
  });

  it("caps guest growth in the start function before instantiation returns", async () => {
    // (func $start
    //   i32.const 0 i32.const 3 memory.grow i32.store)
    const body = [0, 0x41, 0, 0x41, 3, 0x40, 0, 0x36, 2, 0, 0x0b];
    const original = moduleBytes(
      section(1, [1, 0x60, 0, 0]),
      section(3, [1, 0]),
      memorySection(1, 4),
      memoryExport,
      section(8, [0]),
      section(10, [1, ...leb(body.length), ...body]),
    );
    const unrestricted = await WebAssembly.instantiate(original);
    const unrestrictedMemory = unrestricted.instance.exports
      .memory as WebAssembly.Memory;
    expect(unrestrictedMemory.buffer.byteLength).toBe(4 * PAGE);
    expect(new DataView(unrestrictedMemory.buffer).getInt32(0, true)).toBe(1);
    const { instance } = await WebAssembly.instantiate(
      limitWasmMemory(original, 2 * PAGE),
    );
    const memory = instance.exports.memory as WebAssembly.Memory;
    expect(memory.buffer.byteLength).toBe(PAGE);
    expect(new DataView(memory.buffer).getInt32(0, true)).toBe(-1);
  });

  it.each([
    { initial: 1, authored: 4, budget: 2 * PAGE, maximum: 2 },
    { initial: 1, authored: 4, budget: 16 * PAGE, maximum: 4 },
    { initial: 1, authored: undefined, budget: PAGE, maximum: 1 },
    { initial: 0, authored: undefined, budget: PAGE, maximum: 1 },
    { initial: 0, authored: 0, budget: PAGE, maximum: 0 },
    {
      initial: 1,
      authored: undefined,
      budget: 2 * PAGE + PAGE / 2,
      maximum: 2,
    },
    { initial: 128, authored: 256, budget: 129 * PAGE, maximum: 129 },
  ])(
    "bounds host growth for %j",
    async ({ initial, authored, budget, maximum }) => {
      const { instance } = await WebAssembly.instantiate(
        limitWasmMemory(memoryModule(initial, authored), budget),
      );
      const memory = instance.exports.memory as WebAssembly.Memory;
      expect(memory.grow(maximum - initial)).toBe(initial);
      expect(memory.buffer.byteLength).toBe(maximum * PAGE);
      expect(() => memory.grow(1)).toThrow(RangeError);
    },
  );

  it("accepts the Wasm32 ceiling without allocating the maximum", () => {
    expect(
      WebAssembly.validate(limitWasmMemory(memoryModule(), 4294967296)),
    ).toBe(true);
  });

  it("copies an input subview into an owned non-shared buffer", async () => {
    const original = memoryModule(1, 4);
    const backing = new Uint8Array(new SharedArrayBuffer(original.length + 9));
    backing.set(original, 5);
    const input = backing.subarray(5, 5 + original.length);
    const limited = limitWasmMemory(input, PAGE);
    input.fill(0);
    expect(limited.buffer).toBeInstanceOf(ArrayBuffer);
    const { instance } = await WebAssembly.instantiate(limited);
    expect(() =>
      (instance.exports.memory as WebAssembly.Memory).grow(1),
    ).toThrow(RangeError);
  });

  it("accepts legal padded unsigned LEB encodings", () => {
    const bytes = moduleBytes(
      [5, 0x83, 0x80, 0x80, 0x80, 0, 1, 0, 1],
      memoryExport,
    );
    expect(WebAssembly.validate(limitWasmMemory(bytes, PAGE))).toBe(true);
  });

  it.each([
    0,
    -1,
    1,
    Infinity,
    NaN,
    65535,
    4294967297,
    65536.5,
    Number.MAX_SAFE_INTEGER,
  ])("refuses invalid budget %s", (limit) => {
    expect(() => limitWasmMemory(memoryModule(), limit)).toThrow(RangeError);
  });

  it("refuses a codec when the platform cannot validate WebAssembly", () => {
    vi.stubGlobal("WebAssembly", undefined);
    refuse(memoryModule());
  });

  it.each(header.map((_, index) => index))(
    "rejects an invalid magic/version byte at %i",
    (index) => {
      const bytes = memoryModule();
      bytes[index] ^= 255;
      refuse(bytes);
    },
  );

  it.each([
    ["truncated header", []],
    ["missing memory", header],
    ["initial exceeds cap", [...header, ...memorySection(2, 4)]],
    ["initial exceeds authored maximum", [...header, ...memorySection(1, 0)]],
    [
      "authored maximum exceeds Wasm32",
      [...header, ...memorySection(0, 65537)],
    ],
    ["shared memory", [...header, 5, 4, 1, 3, 1, 4]],
    ["memory64", [...header, 5, 4, 1, 5, 1, 4]],
    ["zero memories", [...header, 5, 1, 0]],
    ["multiple memories", [...header, 5, 7, 2, 1, 1, 4, 1, 1, 4]],
    [
      "duplicate memory sections",
      [...header, ...memorySection(), ...memorySection()],
    ],
    ["trailing memory payload", [...header, 5, 4, 1, 0, 1, 0]],
    ["unsigned LEB overflow", [...header, 5, 255, 255, 255, 255, 127]],
    ["unterminated five-byte LEB", [...header, 5, 128, 128, 128, 128, 128, 0]],
    ["truncated LEB", [...header, 5, 128]],
    ["truncated section", [...header, 5, 10, 1, 0, 1]],
    ["truncated memory limit", [...header, 5, 3, 1, 1, 1]],
    ["empty memory payload", [...header, 5, 0]],
    [
      "memory limit LEB crosses sections",
      [...header, 5, 3, 1, 0, 128, 0, 1, 0],
    ],
    [
      "out of order section",
      [...header, ...memorySection(), ...section(1, [0])],
    ],
    ["unknown section", [...header, ...memorySection(), ...section(42, [])]],
    [
      "invalid custom section name",
      [...header, ...memorySection(), ...section(0, [3, 65])],
    ],
    [
      "invalid export index",
      [...header, ...memorySection(), ...section(7, [1, 0, 2, 1])],
    ],
  ] satisfies [string, number[]][])(
    "refuses malformed/unsupported memory: %s",
    (_name, bytes) => {
      refuse(new Uint8Array(bytes));
    },
  );

  it.each([
    ["function", 0, [0]],
    ["unbounded function table", 1, [0x70, 0, 0]],
    ["bounded function table", 1, [0x70, 1, 0, 1]],
    ["external reference table", 1, [0x6f, 0, 0]],
    ["global", 3, [0x7f, 0]],
    ["exception tag", 4, [0, 0]],
  ] satisfies [string, number, number[]][])(
    "preserves a valid %s import",
    (_name, kind, type) => {
      const bytes = moduleBytes(
        section(1, [1, 0x60, 0, 0]),
        section(2, [1, ...importEntry(kind, type)]),
        memorySection(),
      );
      const limited = limitWasmMemory(bytes, PAGE);
      const compiled = new WebAssembly.Module(limited);
      expect(WebAssembly.Module.imports(compiled)).toEqual([
        expect.objectContaining({ module: "m", name: "x" }),
      ]);
    },
  );

  it.each([
    ["imported memory", [1, ...importEntry(2, [0, 1])]],
    ["unknown import kind", [1, ...importEntry(5, [])]],
    ["missing kind", [1, 1, 109, 1, 120]],
    ["oversize module name", [1, 10, 109]],
    ["missing field length", [1, 1, 109]],
    ["truncated function index", [1, ...importEntry(0, [128])]],
    ["missing table element type", [1, ...importEntry(1, [])]],
    ["unsupported table element type", [1, ...importEntry(1, [0x7f, 0, 0])]],
    ["unsupported table limits", [1, ...importEntry(1, [0x70, 2, 0])]],
    ["truncated table maximum", [1, ...importEntry(1, [0x70, 1, 0])]],
    ["truncated global type", [1, ...importEntry(3, [0x7f])]],
    ["invalid global type", [1, ...importEntry(3, [0, 0])]],
    ["invalid tag attribute", [1, ...importEntry(4, [1, 0])]],
    ["trailing import payload", [0, 0]],
    ["truncated import count", [128]],
  ] satisfies [string, number[]][])(
    "refuses malformed/unsupported imports: %s",
    (_name, payload) => {
      refuse(moduleBytes(section(2, payload), memorySection()));
    },
  );
});
