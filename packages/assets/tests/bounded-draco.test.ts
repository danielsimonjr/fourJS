import { isFourError } from "@fourjs/core";
import { describe, expect, it } from "vitest";

import {
  createBoundedDracoDecoder,
  DRACO_INFO_BYTES,
  type DracoDecoder,
} from "../src/bounded-draco.js";
import { createGltfLoader, type GltfAsset } from "../src/gltf.js";

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
  out: number[];
  info: number[];
  returnZero?: boolean;
  trap?: boolean;
  withImport?: boolean;
  missingExport?: boolean;
}
/** Fake Draco decoder: malloc is a 2-way fixed pointer; decode stores known bytes. */
function fakeDraco(spec: FakeSpec): Uint8Array<ArrayBuffer> {
  const types = [
    3, 0x60, 1, 0x7f, 1, 0x7f, 0x60, 2, 0x7f, 0x7f, 0, 0x60, 3, 0x7f, 0x7f,
    0x7f, 1, 0x7f,
  ];
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
    ...i32(DRACO_INFO_BYTES),
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
  spec.info.forEach((v, i) => stores.push(0x20, 2, ...i32(v), 0x36, 2, i * 4));
  const decode = body([
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
    ...name(spec.missingExport ? "nope" : "decode"),
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
    ...section(10, [3, ...malloc, ...free, ...decode]),
  ]);
}

const f32 = (values: number[]): number[] => [
  ...new Uint8Array(new Float32Array(values).buffer),
];
const u16 = (values: number[]): number[] => [
  ...new Uint8Array(new Uint16Array(values).buffer),
];
const u32b = (values: number[]): number[] => [
  ...new Uint8Array(new Uint32Array(values).buffer),
];

const POS = [0, 0, 0, 1, 0, 0, 0, 1, 0];
const UV = [0, 0, 1, 0, 0, 1];
const POS_ID = 7;
const UV_ID = 3;
/** Info words for the triangle: positions + uvs + 3 u16 indices. */
const TRI_INFO = [3, 3, 2, 6, 2, POS_ID, 3, 0, 36, UV_ID, 2, 0, 24];
const TRI_OUT = [...f32(POS), ...f32(UV), ...u16([0, 1, 2])];
const INPUT = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const IDS = { POSITION: POS_ID, TEXCOORD_0: UV_ID };

const make = (
  spec: Partial<FakeSpec> = {},
  options = {},
): Promise<DracoDecoder> =>
  createBoundedDracoDecoder({
    wasmBinary: fakeDraco({ out: TRI_OUT, info: TRI_INFO, ...spec }),
    ...options,
  });

async function refused(run: () => unknown, pattern: RegExp): Promise<void> {
  try {
    await run();
  } catch (error) {
    expect(isFourError(error)).toBe(true);
    expect((error as Error).message).toMatch(pattern);
    return;
  }
  throw new Error("expected a refusal");
}

describe("createBoundedDracoDecoder", () => {
  it("returns the known streams from the raw ABI", async () => {
    const decode = await make();
    const streams = decode(INPUT, IDS);
    expect(streams.vertexCount).toBe(3);
    expect([...streams.positions]).toEqual(POS);
    expect([...(streams.uvs as Float32Array)]).toEqual(UV);
    expect(streams.indices).toBeInstanceOf(Uint16Array);
    expect([...(streams.indices as Uint16Array)]).toEqual([0, 1, 2]);
    expect(streams.normals).toBeUndefined();
    // deterministic and re-usable
    expect([...decode(INPUT, IDS).positions]).toEqual(POS);
  });

  it("decodes colors (RGB gains alpha), joints, weights, normals, u32 indices, skipped extras", async () => {
    const col = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
    const nrm = [0, 0, 1, 0, 0, 1];
    const jw = [1, 2, 3, 4, 5, 6, 7, 8];
    const wts = [1, 0, 0, 0, 0.5, 0.5, 0, 0];
    const junk = [9, 9, 9, 9];
    const out = [
      ...f32([0, 0, 0, 1, 0, 0]),
      ...f32(nrm),
      ...f32(col),
      ...jw,
      ...f32(wts),
      ...junk,
      ...u32b([0, 1, 1, 0]),
    ];
    const info = [
      2, 4, 6, 16, 4, 1, 3, 0, 24, 2, 3, 0, 24, 4, 3, 0, 24, 5, 4, 1, 8, 6, 4,
      0, 32, 99, 4, 1, 8,
    ];
    const decode = await make({ out, info }, {});
    const s = decode(INPUT, {
      POSITION: 1,
      NORMAL: 2,
      COLOR_0: 4,
      JOINTS_0: 5,
      WEIGHTS_0: 6,
    });
    expect([...(s.colors as Float32Array)].map((v) => +v.toFixed(2))).toEqual([
      0.1, 0.2, 0.3, 1, 0.4, 0.5, 0.6, 1,
    ]);
    expect([...(s.joints as Uint16Array)]).toEqual(jw);
    expect([...(s.weights as Float32Array)]).toEqual(wts);
    expect(s.indices).toBeInstanceOf(Uint32Array);
    expect([...(s.normals as Float32Array)]).toEqual(nrm);
  });

  it("decodes uint16 joints, RGBA colors, and non-indexed meshes", async () => {
    const out = [...f32([0, 0, 0]), ...f32([1, 2, 3, 4]), ...u16([1, 2, 3, 4])];
    const decode = await make({
      out,
      info: [1, 0, 3, 0, 0, 1, 3, 0, 12, 4, 4, 0, 16, 5, 4, 2, 8],
    });
    const s = decode(INPUT, { POSITION: 1, COLOR_0: 4, JOINTS_0: 5 });
    expect([...(s.colors as Float32Array)]).toEqual([1, 2, 3, 4]);
    expect([...(s.joints as Uint16Array)]).toEqual([1, 2, 3, 4]);
    expect(s.indices).toBeUndefined();
  });

  it("validates construction and instantiation", async () => {
    await expect(make({}, { maximumDecodedBytes: 0 })).rejects.toThrow(
      RangeError,
    );
    await refused(() => make({ withImport: true }), /initialize/);
    await refused(() => make({ missingExport: true }), /initialize/);
    await refused(
      () => createBoundedDracoDecoder({ wasmBinary: new Uint8Array(3) }),
      /memory/,
    );
  });

  it("refuses bad requests without poisoning", async () => {
    const decode = await make();
    await refused(() => decode(new Uint8Array(0), IDS), /empty/);
    await refused(
      () => decode(INPUT, { POSITION: -1 }),
      /invalid or duplicated/,
    );
    await refused(
      () => decode(INPUT, { POSITION: 1, NORMAL: 1 }),
      /invalid or duplicated/,
    );
    await refused(
      () => decode(INPUT, { NORMAL: 1 } as never),
      /POSITION attribute id/,
    );
    expect([...decode(INPUT, IDS).positions]).toEqual(POS);
  });

  it("refuses inconsistent output and poisons the instance", async () => {
    const cases: [Partial<FakeSpec>, RegExp][] = [
      [{ returnZero: true }, /does not match/],
      [
        { info: [0, 3, 2, 6, 2, POS_ID, 3, 0, 36, UV_ID, 2, 0, 24] },
        /does not match/,
      ],
      [{ info: [3, 3, 1, 6, 2, POS_ID, 3, 0, 36] }, /does not match/], // missing uv id
      [
        { info: [3, 3, 2, 6, 2, POS_ID, 3, 0, 35, UV_ID, 2, 0, 24] },
        /does not match/,
      ],
      [
        { info: [3, 3, 2, 6, 2, POS_ID, 2, 0, 24, UV_ID, 2, 0, 24] },
        /does not match/,
      ],
      [
        { info: [3, 3, 2, 6, 2, POS_ID, 3, 1, 9, UV_ID, 2, 0, 24] },
        /does not match/,
      ],
      [
        { info: [3, 3, 2, 6, 2, POS_ID, 3, 0, 36, POS_ID, 3, 0, 36] },
        /does not match/,
      ],
      [
        { info: [3, 3, 2, 6, 2, POS_ID, 3, 9, 36, UV_ID, 2, 0, 24] },
        /does not match/,
      ],
      [
        { info: [3, 3, 2, 5, 2, POS_ID, 3, 0, 36, UV_ID, 2, 0, 24] },
        /does not match/,
      ],
      [
        { info: [3, 3, 2, 6, 3, POS_ID, 3, 0, 36, UV_ID, 2, 0, 24] },
        /does not match/,
      ],
      [
        { info: [3, 0, 2, 0, 2, POS_ID, 3, 0, 36, UV_ID, 2, 0, 24] },
        /does not match/,
      ],
      [
        { info: [3, 3, 2, 6, 2, 5, 3, 0, 36, UV_ID, 2, 0, 24] },
        /does not match/,
      ], // unnamed 5 -> POSITION missing
      [
        {
          info: [3, 3, 2, 6, 2, POS_ID, 3, 0, 36, UV_ID, 2, 0, 24].map(
            (v, i) => (i === 2 ? 99 : v),
          ),
        },
        /does not match/,
      ],
      [{ out: [...f32([NaN, 0, 0]), ...TRI_OUT.slice(12)] }, /non-finite/],
      [{ out: [...f32(POS), ...f32(UV), ...u16([0, 1, 3])] }, /out of range/],
      [{ trap: true }, /Invalid Draco/],
    ];
    for (const [spec, pattern] of cases) {
      const decode = await make(spec);
      await refused(() => decode(INPUT, IDS), pattern);
      await refused(() => decode(INPUT, IDS), /failed previously/);
    }
  });

  it("enforces the decoded-byte, working-memory and allocation budgets", async () => {
    const small = await make({}, { maximumDecodedBytes: 60 });
    await refused(() => small(INPUT, IDS), /decoded-byte budget/);
    const tight = await make({}, { maximumWorkingBytes: 65536 });
    await refused(() => tight(new Uint8Array(65537), IDS), /working-memory/);
    const exact = await make({}, { maximumDecodedBytes: 66 });
    expect(exact(INPUT, IDS).vertexCount).toBe(3);
    const big = await make();
    await refused(() => big(new Uint8Array(70000), IDS), /input allocation/);
    const overlap = await make({}, { maximumWorkingBytes: 65536 });
    // input (65000) + decoded (66) fits 64 KiB only barely; 65500 does not
    await refused(
      () => overlap(new Uint8Array(65500), IDS),
      /allocation|working/,
    );
  });
});

// ---- glTF routing -----------------------------------------------------
// oxlint-disable-next-line typescript/no-explicit-any -- mutable JSON fixture
type Doc = Record<string, any>;
const EXT = "KHR_draco_mesh_compression";

function glb(json: unknown, bin: Uint8Array): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = new Uint8Array(Math.ceil(jsonBytes.length / 4) * 4).fill(
    0x20,
  );
  jsonPadded.set(jsonBytes);
  const binPadded = new Uint8Array(Math.ceil(bin.length / 4) * 4);
  binPadded.set(bin);
  const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonPadded.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonPadded, 20);
  const at = 20 + jsonPadded.length;
  view.setUint32(at, binPadded.length, true);
  view.setUint32(at + 4, 0x004e4942, true);
  out.set(binPadded, at + 8);
  return out;
}

const response = (bytes: Uint8Array) =>
  ({
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
  }) as never;

function load(
  json: unknown,
  bin: Uint8Array,
  options: Parameters<typeof createGltfLoader>[0] = {},
): Promise<GltfAsset> {
  return createGltfLoader(options).load(response(glb(json, bin)), "/m.glb");
}

const uncompressedBin = new Uint8Array([
  ...f32(POS),
  ...f32(UV),
  ...u16([0, 1, 2]),
  0,
  0,
]);
const uncompressed = {
  asset: { version: "2.0" },
  buffers: [{ byteLength: uncompressedBin.length }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: 36 },
    { buffer: 0, byteOffset: 36, byteLength: 24 },
    { buffer: 0, byteOffset: 60, byteLength: 6 },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
    { bufferView: 1, componentType: 5126, count: 3, type: "VEC2" },
    { bufferView: 2, componentType: 5123, count: 3, type: "SCALAR" },
  ],
  meshes: [
    {
      primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2 }],
    },
  ],
  nodes: [{ mesh: 0 }],
  scenes: [{ nodes: [0] }],
  scene: 0,
};
const payload = new Uint8Array(8).fill(7);
function compressed(
  edit: (doc: Doc) => void = () => undefined,
): Record<string, unknown> {
  const doc = {
    asset: { version: "2.0" },
    extensionsUsed: [EXT],
    extensionsRequired: [EXT],
    buffers: [{ byteLength: payload.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 8 }],
    accessors: [
      { componentType: 5126, count: 3, type: "VEC3" },
      { componentType: 5126, count: 3, type: "VEC2" },
      { componentType: 5123, count: 3, type: "SCALAR" },
    ],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, TEXCOORD_0: 1 },
            indices: 2,
            extensions: {
              [EXT]: {
                bufferView: 0,
                attributes: { POSITION: POS_ID, TEXCOORD_0: UV_ID, TANGENT: 5 },
              },
            },
          },
        ],
      },
    ],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  } as Doc;
  edit(doc);
  return doc;
}
const prim = (doc: Doc) => doc["meshes"][0].primitives[0];

describe("glTF KHR_draco_mesh_compression", () => {
  it("is bit-identical to the uncompressed fixture", async () => {
    const decode = await make();
    const reference = await load(uncompressed, uncompressedBin);
    const viaDraco = await load(compressed(), payload, {
      dracoDecoder: decode,
    });
    const a = reference.meshes[0].primitives[0];
    const b = viaDraco.meshes[0].primitives[0];
    expect([...b.positions]).toEqual([...a.positions]);
    expect([...(b.uvs as Float32Array)]).toEqual([...(a.uvs as Float32Array)]);
    expect([...(b.indices as Uint16Array)]).toEqual([
      ...(a.indices as Uint16Array),
    ]);
    expect(viaDraco.ignored.some((one) => one.includes("TANGENT"))).toBe(true);
  });

  it("refuses a required extension without a decoder, and other extensions", async () => {
    await refused(() => load(compressed(), payload), /dracoDecoder/);
    const decode = await make();
    await refused(
      () =>
        load(
          compressed((d) => (d["extensionsRequired"] = [EXT, "KHR_other"])),
          payload,
          {
            dracoDecoder: decode,
          },
        ),
      /KHR_other/,
    );
    await refused(
      () =>
        load(uncompressed, uncompressedBin).then(() =>
          load(
            compressed((d) => (d["extensionsRequired"] = ["X"])),
            payload,
          ),
        ),
      /X/,
    );
  });

  it("falls back to uncompressed accessors when the extension is optional", async () => {
    const doc = JSON.parse(JSON.stringify(uncompressed)) as Doc;
    doc["extensionsUsed"] = [EXT];
    prim(doc).extensions = {
      [EXT]: { bufferView: 0, attributes: { POSITION: POS_ID } },
    };
    const asset = await load(doc, uncompressedBin);
    expect([...asset.meshes[0].primitives[0].positions]).toEqual(POS);
    // a decoder-equipped loader prefers the extension payload
    const decode = await make();
    const withDecoder = await load(doc, uncompressedBin, {
      dracoDecoder: decode,
    });
    expect([...withDecoder.meshes[0].primitives[0].positions]).toEqual(POS);
    // optional + no decoder + no uncompressed accessors: refused by name
    const noView = compressed((d) => (d["extensionsRequired"] = undefined));
    await refused(() => load(noView, payload), /accessor/);
    await refused(
      () => load(noView, payload, { dracoDecoder: undefined }),
      /bufferView/,
    );
  });

  it("refuses inconsistent extension blocks and mismatched counts", async () => {
    const decode = await make();
    const opts = { dracoDecoder: decode };
    const bad = (edit: (d: Doc) => void, re: RegExp) =>
      refused(() => load(compressed(edit), payload, opts), re);
    await bad((d) => (prim(d).extensions[EXT].bufferView = 5), /bufferView/);
    await bad(
      (d) => (prim(d).extensions[EXT].attributes.POSITION = -1),
      /non-negative/,
    );
    await bad(
      (d) => delete prim(d).extensions[EXT].attributes.POSITION,
      /POSITION is required/,
    );
    await bad(
      (d) => (prim(d).extensions[EXT].attributes.NORMAL = 9),
      /does not declare/,
    );
    await bad((d) => (d["accessors"][0].count = 4), /vertices/);
    await bad((d) => (d["accessors"][2].count = 6), /indices/);
    await bad((d) => delete prim(d).indices, /needs primitive.indices/);
  });

  it("propagates decoder budget refusals through the loader", async () => {
    const decode = await make({}, { maximumDecodedBytes: 10 });
    await refused(
      () => load(compressed(), payload, { dracoDecoder: decode }),
      /decoded-byte budget/,
    );
  });
});
