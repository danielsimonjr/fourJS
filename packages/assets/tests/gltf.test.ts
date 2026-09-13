/**
 * §78's glTF parse tier (A-19, 2026-08-29) — the unit half.
 *
 * Half of this suite is malformed files, deliberately: §96 says a glTF file
 * is untrusted input, and the loader's contract is that every malformed shape
 * is refused with a §85-precise error naming the exact location — never
 * accepted, never silently repaired. The other half proves the happy tier:
 * both containers, every attribute the geometry layer has, the sampler and
 * material mappings, skins, and animations, all as pure functions of the
 * input bytes (§33).
 */

import { isFourError, resetDevWarnings } from "@fourjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerBoundedImageDecoder } from "../src/image-memory.js";

import {
  createGltfLoader,
  type FetchResponse,
  type GltfAsset,
  type GltfLoaderOptions,
} from "../src/index.js";

/** Standard base64 of some bytes (tests run under Node). */
function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** An embedded glTF buffer. */
function dataUri(bytes: Uint8Array): string {
  return `data:application/octet-stream;base64,${b64(bytes)}`;
}

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

/** A response whose body is the JSON encoding of `document`. */
function jsonResponse(document: unknown): FetchResponse {
  return bytesResponse(new TextEncoder().encode(JSON.stringify(document)));
}

/** Concatenates typed arrays into one buffer, 4-byte aligned per part. */
function pack(...parts: ArrayBufferView[]): {
  bytes: Uint8Array;
  offsets: number[];
} {
  const offsets: number[] = [];
  let length = 0;
  for (const part of parts) {
    length = Math.ceil(length / 4) * 4;
    offsets.push(length);
    length += part.byteLength;
  }
  const bytes = new Uint8Array(length);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    bytes.set(
      new Uint8Array(part.buffer, part.byteOffset, part.byteLength),
      offsets[i],
    );
  }
  return { bytes, offsets };
}

/** Loads a JSON document through a fresh loader. */
function load(
  document: unknown,
  options: GltfLoaderOptions = {},
): Promise<GltfAsset> {
  return createGltfLoader(options).load(jsonResponse(document), "/model.gltf");
}

/** Asserts a load refuses with `ASSET_LOAD_FAILED` matching `pattern`. */
async function expectRefusal(
  work: Promise<GltfAsset>,
  pattern: RegExp,
): Promise<void> {
  const error = await work.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeDefined();
  expect(isFourError(error)).toBe(true);
  if (isFourError(error)) {
    expect(error.code).toBe("ASSET_LOAD_FAILED");
    expect(error.message).toMatch(pattern);
  }
}

const TRI_POSITIONS = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const TRI_INDICES = new Uint16Array([0, 1, 2]);

/** A minimal valid one-triangle document over an embedded buffer. */
function triangleDocument(): Record<string, unknown> {
  const { bytes, offsets } = pack(TRI_POSITIONS, TRI_INDICES);
  return {
    asset: { version: "2.0" },
    buffers: [{ byteLength: bytes.byteLength, uri: dataUri(bytes) }],
    bufferViews: [
      { buffer: 0, byteOffset: offsets[0], byteLength: 36 },
      { buffer: 0, byteOffset: offsets[1], byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
}

/** Deep-clones a document so a test can corrupt its own copy. */
function corrupt(
  document: Record<string, unknown>,
  edit: (copy: Record<string, unknown>) => void,
): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(document)) as Record<string, unknown>;
  edit(copy);
  return copy;
}

/** Builds a GLB container; the knobs exist so tests can corrupt it. */
function glb(
  json: unknown,
  bin: Uint8Array | null = null,
  edit?: {
    version?: number;
    declaredLength?: number;
    firstChunkType?: number;
    extraChunk?: { type: number; bytes: Uint8Array };
    secondBin?: boolean;
    truncateTo?: number;
  },
): Uint8Array {
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(JSON.stringify(json));
  const jsonPadded = new Uint8Array(
    Math.ceil(jsonBytes.byteLength / 4) * 4,
  ).fill(0x20);
  jsonPadded.set(jsonBytes);
  const chunks: { type: number; bytes: Uint8Array }[] = [
    { type: edit?.firstChunkType ?? 0x4e4f534a, bytes: jsonPadded },
  ];
  if (bin !== null) {
    const binPadded = new Uint8Array(Math.ceil(bin.byteLength / 4) * 4);
    binPadded.set(bin);
    chunks.push({ type: 0x004e4942, bytes: binPadded });
    if (edit?.secondBin === true) {
      chunks.push({ type: 0x004e4942, bytes: binPadded });
    }
  }
  if (edit?.extraChunk !== undefined) {
    chunks.push(edit.extraChunk);
  }
  let total = 12;
  for (const chunk of chunks) {
    total += 8 + chunk.bytes.byteLength;
  }
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, edit?.version ?? 2, true);
  view.setUint32(8, edit?.declaredLength ?? total, true);
  let offset = 12;
  for (const chunk of chunks) {
    view.setUint32(offset, chunk.bytes.byteLength, true);
    view.setUint32(offset + 4, chunk.type, true);
    out.set(chunk.bytes, offset + 8);
    offset += 8 + chunk.bytes.byteLength;
  }
  return edit?.truncateTo === undefined
    ? out
    : out.subarray(0, edit.truncateTo);
}

/** Loads GLB bytes through a fresh loader. */
function loadGlb(
  bytes: Uint8Array,
  options: GltfLoaderOptions = {},
): Promise<GltfAsset> {
  return createGltfLoader(options).load(bytesResponse(bytes), "/model.glb");
}

/** A GLB whose JSON references the BIN chunk for the triangle. */
function triangleGlb(): Uint8Array {
  const { bytes } = pack(TRI_POSITIONS, TRI_INDICES);
  const document = corrupt(triangleDocument(), (copy) => {
    copy["buffers"] = [{ byteLength: bytes.byteLength }];
  });
  return glb(document, bytes);
}

/**
 * The fake codec of `texture-manifest.test.ts`: encoded bytes are
 * `[width, height, ...rgba top row first]`.
 */
const fakeDecode = (
  data: ArrayBuffer,
): {
  width: number;
  height: number;
  data: Uint8Array;
} => {
  const bytes = new Uint8Array(data);
  return { width: bytes[0], height: bytes[1], data: bytes.slice(2) };
};

/** A 1 × 2 fake-encoded image: top row 200s, bottom row 100s. */
const ENCODED_IMAGE = new Uint8Array([
  1, 2, 200, 200, 200, 200, 100, 100, 100, 100,
]);

/** A document whose one material samples a base-colour texture. */
function texturedDocument(): Record<string, unknown> {
  const base = triangleDocument();
  return corrupt(base, (copy) => {
    copy["images"] = [{ uri: dataUri(ENCODED_IMAGE), mimeType: "image/png" }];
    copy["samplers"] = [{ magFilter: 9728, wrapS: 33071, wrapT: 33071 }];
    copy["textures"] = [{ source: 0, sampler: 0 }];
    copy["materials"] = [
      { pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
    ];
    const meshes = copy["meshes"] as {
      primitives: { material?: number }[];
    }[];
    meshes[0].primitives[0].material = 0;
  });
}

/** A skinned two-bone document with one LINEAR rotation animation. */
function skinnedDocument(): Record<string, unknown> {
  const positions = new Float32Array([
    -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0,
  ]);
  const joints = new Uint16Array([
    0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0,
  ]);
  const weights = new Float32Array([
    1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0,
  ]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const binds = new Float32Array(32);
  for (const base of [0, 16]) {
    binds[base] = 1;
    binds[base + 5] = 1;
    binds[base + 10] = 1;
    binds[base + 15] = 1;
  }
  binds[16 + 13] = -1;
  const times = new Float32Array([0, 1]);
  const rotations = new Float32Array([
    0,
    0,
    0,
    1,
    0,
    0,
    Math.SQRT1_2,
    Math.SQRT1_2,
  ]);
  const { bytes, offsets } = pack(
    positions,
    joints,
    weights,
    indices,
    binds,
    times,
    rotations,
  );
  return {
    asset: { version: "2.0" },
    buffers: [{ byteLength: bytes.byteLength, uri: dataUri(bytes) }],
    bufferViews: [
      { buffer: 0, byteOffset: offsets[0], byteLength: positions.byteLength },
      { buffer: 0, byteOffset: offsets[1], byteLength: joints.byteLength },
      { buffer: 0, byteOffset: offsets[2], byteLength: weights.byteLength },
      { buffer: 0, byteOffset: offsets[3], byteLength: indices.byteLength },
      { buffer: 0, byteOffset: offsets[4], byteLength: binds.byteLength },
      { buffer: 0, byteOffset: offsets[5], byteLength: times.byteLength },
      { buffer: 0, byteOffset: offsets[6], byteLength: rotations.byteLength },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: "VEC3" },
      { bufferView: 1, componentType: 5123, count: 4, type: "VEC4" },
      { bufferView: 2, componentType: 5126, count: 4, type: "VEC4" },
      { bufferView: 3, componentType: 5123, count: 6, type: "SCALAR" },
      { bufferView: 4, componentType: 5126, count: 2, type: "MAT4" },
      { bufferView: 5, componentType: 5126, count: 2, type: "SCALAR" },
      { bufferView: 6, componentType: 5126, count: 2, type: "VEC4" },
    ],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 },
            indices: 3,
          },
        ],
      },
    ],
    skins: [{ joints: [1, 2], inverseBindMatrices: 4 }],
    nodes: [
      { mesh: 0, skin: 0, name: "column" },
      { children: [2], name: "root" },
      { translation: [0, 1, 0], name: "elbow" },
    ],
    scenes: [{ nodes: [0, 1] }],
    scene: 0,
    animations: [
      {
        name: "bend",
        samplers: [{ input: 5, output: 6, interpolation: "LINEAR" }],
        channels: [{ sampler: 0, target: { node: 2, path: "rotation" } }],
      },
    ],
  };
}

beforeEach(() => {
  resetDevWarnings();
});

describe("containers", () => {
  it("parses a .gltf JSON body with an embedded buffer", async () => {
    const asset = await load(triangleDocument());
    expect(asset.url).toBe("/model.gltf");
    expect(asset.meshes).toHaveLength(1);
    expect([...asset.meshes[0].primitives[0].positions]).toEqual([
      ...TRI_POSITIONS,
    ]);
    expect([...(asset.meshes[0].primitives[0].indices ?? [])]).toEqual([
      0, 1, 2,
    ]);
    expect(asset.defaultScene).toBe(0);
    expect(asset.scenes[0].nodes).toEqual([0]);
    expect(asset.ignored).toEqual([]);
  });

  it("parses a GLB whose buffer is the BIN chunk", async () => {
    const asset = await loadGlb(triangleGlb());
    expect([...asset.meshes[0].primitives[0].positions]).toEqual([
      ...TRI_POSITIONS,
    ]);
  });

  it("ignores an unknown trailing GLB chunk, with a record", async () => {
    const { bytes } = pack(TRI_POSITIONS, TRI_INDICES);
    const document = corrupt(triangleDocument(), (copy) => {
      copy["buffers"] = [{ byteLength: bytes.byteLength }];
    });
    const container = glb(document, bytes, {
      extraChunk: { type: 0x12345678, bytes: new Uint8Array(4) },
    });
    const asset = await loadGlb(container);
    expect(asset.ignored).toEqual(["1 unknown GLB chunk(s)"]);
  });

  it("refuses a truncated GLB", async () => {
    await expectRefusal(
      loadGlb(glb(triangleDocument(), null, { truncateTo: 16 })),
      /truncated/,
    );
  });

  it("refuses a GLB with the wrong container version", async () => {
    await expectRefusal(
      loadGlb(glb(triangleDocument(), null, { version: 1 })),
      /version 1 is not 2/,
    );
  });

  it("refuses a GLB whose declared length exceeds the body (§96)", async () => {
    await expectRefusal(
      loadGlb(glb(triangleDocument(), null, { declaredLength: 1 << 20 })),
      /declared length/,
    );
  });

  it("refuses a GLB chunk that overruns the container (§96)", async () => {
    const container = glb(triangleDocument());
    // Inflate the first chunk's length field past the container's end.
    new DataView(container.buffer).setUint32(12, 1 << 20, true);
    await expectRefusal(loadGlb(container), /overruns the container/);
  });

  it("refuses an unaligned GLB chunk length", async () => {
    const container = glb(triangleDocument());
    new DataView(container.buffer).setUint32(12, 13, true);
    await expectRefusal(loadGlb(container), /4-byte aligned/);
  });

  it("refuses a GLB whose first chunk is not JSON", async () => {
    await expectRefusal(
      loadGlb(glb(triangleDocument(), null, { firstChunkType: 0x004e4942 })),
      /first chunk must be JSON/,
    );
  });

  it("refuses a second JSON chunk", async () => {
    const document = triangleDocument();
    const jsonBytes = new TextEncoder().encode(JSON.stringify(document));
    const padded = new Uint8Array(Math.ceil(jsonBytes.byteLength / 4) * 4).fill(
      0x20,
    );
    padded.set(jsonBytes);
    await expectRefusal(
      loadGlb(
        glb(document, null, {
          extraChunk: { type: 0x4e4f534a, bytes: padded },
        }),
      ),
      /second JSON chunk/,
    );
  });

  it("refuses a second BIN chunk", async () => {
    const { bytes } = pack(TRI_POSITIONS, TRI_INDICES);
    const document = corrupt(triangleDocument(), (copy) => {
      copy["buffers"] = [{ byteLength: bytes.byteLength }];
    });
    await expectRefusal(
      loadGlb(glb(document, bytes, { secondBin: true })),
      /second BIN chunk/,
    );
  });

  it("refuses a GLB whose only chunk is an unknown type (no JSON chunk)", async () => {
    const container = glb(triangleDocument(), null, {
      firstChunkType: 0x12345678,
    });
    await expectRefusal(loadGlb(container), /no JSON chunk/);
  });

  it("refuses trailing bytes between the last chunk and the declared end", async () => {
    const container = glb(triangleDocument());
    const extended = new Uint8Array(container.byteLength + 4);
    extended.set(container);
    new DataView(extended.buffer).setUint32(8, container.byteLength + 4, true);
    await expectRefusal(loadGlb(extended), /trailing bytes/);
  });

  it("refuses a body that is not JSON, naming the document", async () => {
    await expectRefusal(
      loadGlb(new Uint8Array([0x7b, 0x6e, 0x6f, 0x70])),
      /not JSON/,
    );
  });

  it("refuses a runtime with no TextDecoder, naming the way out", async () => {
    vi.stubGlobal("TextDecoder", undefined);
    try {
      const loader = createGltfLoader();
      await expectRefusal(
        loader.load(jsonResponse(triangleDocument()), "/model.gltf"),
        /no TextDecoder/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("document shell", () => {
  it("refuses a missing asset record", async () => {
    await expectRefusal(
      load(corrupt(triangleDocument(), (c) => delete c["asset"])),
      /asset: expected an object/,
    );
  });

  it("refuses a non-2.x version", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => (c["asset"] = { version: "1.0" })),
      ),
      /expected a 2\.x version/,
    );
  });

  it("refuses every extensionsRequired entry by name", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          c["extensionsRequired"] = ["KHR_draco_mesh_compression"];
        }),
      ),
      /KHR_draco_mesh_compression/,
    );
  });

  it("records extensionsUsed and cameras as ignored", async () => {
    const asset = await load(
      corrupt(triangleDocument(), (c) => {
        c["extensionsUsed"] = ["KHR_materials_unlit"];
        c["cameras"] = [{ type: "perspective" }];
      }),
    );
    expect(asset.ignored).toEqual([
      "extensionsUsed (KHR_materials_unlit)",
      "cameras",
    ]);
  });

  it("carries document extras through, detached (§78 user metadata)", async () => {
    const asset = await load(
      corrupt(triangleDocument(), (c) => {
        c["extras"] = { author: "rig-dept", revision: 3 };
      }),
    );
    expect(asset.extras).toEqual({ author: "rig-dept", revision: 3 });
  });

  it("refuses a non-positive maximumBytes at construction", () => {
    expect(() => createGltfLoader({ maximumBytes: 0 })).toThrowError(
      /maximumBytes/,
    );
  });
});

describe("buffers (§96)", () => {
  it("refuses a uriless buffer without a BIN chunk", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          c["buffers"] = [{ byteLength: 48 }];
        }),
      ),
      /no BIN chunk/,
    );
  });

  it("refuses a buffer whose declared byteLength exceeds the BIN chunk", async () => {
    const { bytes } = pack(TRI_POSITIONS, TRI_INDICES);
    const document = corrupt(triangleDocument(), (copy) => {
      copy["buffers"] = [{ byteLength: bytes.byteLength + 64 }];
    });
    await expectRefusal(loadGlb(glb(document, bytes)), /BIN chunk holds/);
  });

  it("refuses an invalid byteLength", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["buffers"] as { byteLength: unknown }[])[0].byteLength = -1;
        }),
      ),
      /byteLength: expected a positive integer/,
    );
  });

  it("refuses a declared byteLength over the subresource limit (§96)", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["buffers"] as { byteLength: unknown }[])[0].byteLength = 1 << 30;
        }),
        { maximumBytes: 1024 },
      ),
      /subresource limit/,
    );
  });

  it("refuses a non-base64 data: URI by name", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["buffers"] as { uri: string }[])[0].uri = "data:text/plain,abc";
        }),
      ),
      /only base64 data: URIs/,
    );
  });

  it("refuses a base64 payload with a bad length", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["buffers"] as { uri: string }[])[0].uri =
            "data:application/octet-stream;base64,abc";
        }),
      ),
      /multiple of 4/,
    );
  });

  it("refuses a base64 payload with an invalid character", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["buffers"] as { uri: string }[])[0].uri =
            "data:application/octet-stream;base64,ab!=";
        }),
      ),
      /invalid character/,
    );
  });

  it("refuses a base64 payload whose decoded size is over budget before allocating (§96)", async () => {
    // The declared byteLength (42) passes the 45-byte limit; the padded
    // payload decodes to 48 bytes and is refused before allocation.
    const { bytes } = pack(TRI_POSITIONS, TRI_INDICES);
    const padded = new Uint8Array(48);
    padded.set(bytes);
    const document = corrupt(triangleDocument(), (c) => {
      (c["buffers"] as { uri: string }[])[0].uri = dataUri(padded);
    });
    await expectRefusal(
      load(document, { maximumBytes: 45 }),
      /decodes to 48 bytes, over the 45-byte limit/,
    );
  });

  it("refuses a buffer whose bytes fall short of its declared byteLength", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["buffers"] as { byteLength: number }[])[0].byteLength += 64;
        }),
        { maximumBytes: 1 << 20 },
      ),
      /yielded/,
    );
  });

  it("refuses a non-string uri", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["buffers"] as { uri: unknown }[])[0].uri = 7;
        }),
      ),
      /uri: expected a string/,
    );
  });

  it("loads an external buffer through the injected FetchLike, resolved relative", async () => {
    const { bytes } = pack(TRI_POSITIONS, TRI_INDICES);
    const seen: string[] = [];
    const document = corrupt(triangleDocument(), (c) => {
      (c["buffers"] as { uri: string }[])[0].uri = "./bin/../data.bin";
    });
    const loader = createGltfLoader({
      fetch: (url) => {
        seen.push(url);
        return Promise.resolve(bytesResponse(bytes));
      },
    });
    const asset = await loader.load(
      jsonResponse(document),
      "/models/robot/model.gltf",
    );
    expect(seen).toEqual(["/models/robot/data.bin"]);
    expect([...asset.meshes[0].primitives[0].positions]).toEqual([
      ...TRI_POSITIONS,
    ]);
  });

  it("passes absolute and scheme-carrying uris through unresolved", async () => {
    const { bytes } = pack(TRI_POSITIONS, TRI_INDICES);
    const seen: string[] = [];
    for (const uri of ["/abs/data.bin", "https://cdn.example/data.bin"]) {
      const document = corrupt(triangleDocument(), (c) => {
        (c["buffers"] as { uri: string }[])[0].uri = uri;
      });
      await createGltfLoader({
        fetch: (url) => {
          seen.push(url);
          return Promise.resolve(bytesResponse(bytes));
        },
      }).load(jsonResponse(document), "/models/model.gltf");
    }
    expect(seen).toEqual(["/abs/data.bin", "https://cdn.example/data.bin"]);
  });

  it("clamps .. above the base's root and keeps the resolution lexical", async () => {
    const { bytes } = pack(TRI_POSITIONS, TRI_INDICES);
    const seen: string[] = [];
    const document = corrupt(triangleDocument(), (c) => {
      (c["buffers"] as { uri: string }[])[0].uri = "../../up.bin";
    });
    await createGltfLoader({
      fetch: (url) => {
        seen.push(url);
        return Promise.resolve(bytesResponse(bytes));
      },
    }).load(jsonResponse(document), "m/model.gltf");
    expect(seen).toEqual(["../up.bin"]);
  });

  it("falls back to globalThis.fetch when no transport is injected", async () => {
    // WP-11.2 already decided this for `AssetManager`: a no-options constructor
    // resolves `globalThis.fetch`, so the common case works. The loader did not,
    // and the asymmetry was the single most likely first-use failure -- the
    // manager fetched the .gltf and then the loader could not fetch the .bin
    // beside it. Found by building a consumer app, 2026-09-07.
    const { bytes } = pack(TRI_POSITIONS, TRI_INDICES);
    const calls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      calls.push(url);
      return Promise.resolve(bytesResponse(bytes));
    });
    try {
      const asset = await load(
        corrupt(triangleDocument(), (c) => {
          (c["buffers"] as { uri: string }[])[0].uri = "data.bin";
        }),
      );
      expect(calls, "the global transport was not used").toHaveLength(1);
      expect(calls[0]).toMatch(/data\.bin$/);
      expect([...asset.meshes[0].primitives[0].positions]).toEqual([
        ...TRI_POSITIONS,
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("still refuses an external uri when the runtime has no fetch at all", async () => {
    // The refusal stays for the case it was written for: a runtime with no
    // global transport. Presence is still the capability -- what changed is
    // that the loader now looks for one before giving up.
    vi.stubGlobal("fetch", undefined);
    try {
      await expectRefusal(
        load(
          corrupt(triangleDocument(), (c) => {
            (c["buffers"] as { uri: string }[])[0].uri = "data.bin";
          }),
        ),
        /without a transport/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses a non-ok subresource response with its status", async () => {
    const document = corrupt(triangleDocument(), (c) => {
      (c["buffers"] as { uri: string }[])[0].uri = "data.bin";
    });
    await expectRefusal(
      load(document, {
        fetch: () =>
          Promise.resolve({
            ...bytesResponse(new Uint8Array(4)),
            ok: false,
            status: 404,
          }),
      }),
      /HTTP 404/,
    );
  });

  it("wraps a subresource transport failure with the resolved uri", async () => {
    const document = corrupt(triangleDocument(), (c) => {
      (c["buffers"] as { uri: string }[])[0].uri = "data.bin";
    });
    await expectRefusal(
      load(document, {
        fetch: () => Promise.reject(new Error("boom")),
      }),
      /fetching "\/data.bin" failed/,
    );
  });

  it("refuses an over-budget external subresource (§96)", async () => {
    // Declared 42 bytes fits the 50-byte limit; the transport answers 64.
    const document = corrupt(triangleDocument(), (c) => {
      (c["buffers"] as { uri: string }[])[0].uri = "data.bin";
    });
    await expectRefusal(
      load(document, {
        maximumBytes: 50,
        fetch: () => Promise.resolve(bytesResponse(new Uint8Array(64))),
      }),
      /is 64 bytes, over the 50-byte subresource limit/,
    );
  });

  it("refuses a base64 payload with a non-ASCII character", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["buffers"] as { uri: string }[])[0].uri =
            "data:application/octet-stream;base64,aé==";
        }),
      ),
      /invalid character/,
    );
  });

  it("resolves a relative uri against a base with no directory", async () => {
    const { bytes } = pack(TRI_POSITIONS, TRI_INDICES);
    const seen: string[] = [];
    const document = corrupt(triangleDocument(), (c) => {
      (c["buffers"] as { uri: string }[])[0].uri = "data.bin";
    });
    await createGltfLoader({
      fetch: (url) => {
        seen.push(url);
        return Promise.resolve(bytesResponse(bytes));
      },
    }).load(jsonResponse(document), "model.gltf");
    expect(seen).toEqual(["data.bin"]);
  });
});

describe("buffer views and accessors (§96 bounds checking)", () => {
  it("refuses a view spanning past its buffer", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["bufferViews"] as { byteLength: number }[])[0].byteLength = 4096;
        }),
      ),
      /spans bytes/,
    );
  });

  it("refuses a bad view byteStride", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["bufferViews"] as { byteStride?: number }[])[0].byteStride = 3;
        }),
      ),
      /multiple of 4 between 4 and 252/,
    );
  });

  it("refuses a view with an invalid byteLength", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["bufferViews"] as { byteLength: unknown }[])[0].byteLength = 0;
        }),
      ),
      /byteLength: expected a positive integer/,
    );
  });

  it("refuses a view naming a missing buffer", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["bufferViews"] as { buffer: number }[])[0].buffer = 5;
        }),
      ),
      /out of range/,
    );
  });

  it("refuses a sparse accessor by name", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["accessors"] as Record<string, unknown>[])[0]["sparse"] = {};
        }),
      ),
      /sparse accessors are refused/,
    );
  });

  it("refuses an accessor without a bufferView by name", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          delete (c["accessors"] as Record<string, unknown>[])[0]["bufferView"];
        }),
      ),
      /without a bufferView/,
    );
  });

  it("refuses an unknown componentType", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["accessors"] as { componentType: number }[])[0].componentType =
            5124;
        }),
      ),
      /unknown component type 5124/,
    );
  });

  it("refuses an unknown accessor type", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["accessors"] as { type: string }[])[0].type = "VEC5";
        }),
      ),
      /unknown accessor type VEC5/,
    );
  });

  it("refuses a non-positive count", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["accessors"] as { count: number }[])[0].count = 0;
        }),
      ),
      /count: expected a positive integer/,
    );
  });

  it("refuses a negative byteOffset", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["accessors"] as { byteOffset?: number }[])[0].byteOffset = -4;
        }),
      ),
      /byteOffset: expected a non-negative integer/,
    );
  });

  it("refuses an accessor read past its view (§96)", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["accessors"] as { count: number }[])[0].count = 4;
        }),
      ),
      /reads .* bytes from a .*-byte buffer view/,
    );
  });

  it("refuses a byteStride smaller than one element", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["bufferViews"] as { byteStride?: number }[])[0].byteStride = 4;
        }),
      ),
      /smaller than one/,
    );
  });

  it("reads interleaved vertex data through an explicit byteStride", async () => {
    // (position vec3 | uv vec2) interleaved, 20-byte stride, 3 vertices.
    const interleaved = new Float32Array([
      0, 0, 0, 0.25, 1, 1, 0, 0, 0.5, 1, 0, 1, 0, 0.75, 0,
    ]);
    const document = corrupt(triangleDocument(), (c) => {
      c["buffers"] = [
        {
          byteLength: interleaved.byteLength,
          uri: dataUri(new Uint8Array(interleaved.buffer)),
        },
      ];
      c["bufferViews"] = [
        { buffer: 0, byteLength: interleaved.byteLength, byteStride: 20 },
      ];
      c["accessors"] = [
        { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
        {
          bufferView: 0,
          byteOffset: 12,
          componentType: 5126,
          count: 3,
          type: "VEC2",
        },
      ];
      c["meshes"] = [
        { primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 } }] },
      ];
    });
    const asset = await load(document);
    const primitive = asset.meshes[0].primitives[0];
    expect([...primitive.positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    // v is flipped to §7a's bottom-up convention at parse.
    expect([...(primitive.uvs ?? [])]).toEqual([0.25, 0, 0.5, 0, 0.75, 1]);
  });

  it("refuses a non-finite float in vertex data (§85, §96)", async () => {
    const positions = new Float32Array([0, 0, 0, 1, Number.NaN, 0, 0, 1, 0]);
    const document = corrupt(triangleDocument(), (c) => {
      const { bytes, offsets } = pack(positions, TRI_INDICES);
      c["buffers"] = [{ byteLength: bytes.byteLength, uri: dataUri(bytes) }];
      (c["bufferViews"] as { byteOffset: number }[])[1].byteOffset = offsets[1];
    });
    await expectRefusal(load(document), /non-finite float/);
  });
});

describe("mesh primitives", () => {
  it("decodes every attribute the geometry layer has", async () => {
    const positions = TRI_POSITIONS;
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
    const colors = new Float32Array([1, 0, 0, 1, 0, 1, 0, 0.5, 0, 0, 1, 0.25]);
    const joints = new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    const weights = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0]);
    const { bytes, offsets } = pack(
      positions,
      normals,
      uvs,
      colors,
      joints,
      weights,
      TRI_INDICES,
    );
    const views = [
      positions,
      normals,
      uvs,
      colors,
      joints,
      weights,
      TRI_INDICES,
    ];
    const document = corrupt(triangleDocument(), (c) => {
      c["buffers"] = [{ byteLength: bytes.byteLength, uri: dataUri(bytes) }];
      c["bufferViews"] = views.map((part, i) => ({
        buffer: 0,
        byteOffset: offsets[i],
        byteLength: part.byteLength,
      }));
      c["accessors"] = [
        { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
        { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
        { bufferView: 2, componentType: 5126, count: 3, type: "VEC2" },
        { bufferView: 3, componentType: 5126, count: 3, type: "VEC4" },
        { bufferView: 4, componentType: 5123, count: 3, type: "VEC4" },
        { bufferView: 5, componentType: 5126, count: 3, type: "VEC4" },
        { bufferView: 6, componentType: 5123, count: 3, type: "SCALAR" },
      ];
      c["meshes"] = [
        {
          name: "tri",
          extras: { lod: 0 },
          primitives: [
            {
              attributes: {
                POSITION: 0,
                NORMAL: 1,
                TEXCOORD_0: 2,
                COLOR_0: 3,
                JOINTS_0: 4,
                WEIGHTS_0: 5,
              },
              indices: 6,
            },
          ],
        },
      ];
      // No skin: primitives may carry influences a node never uses.
      c["nodes"] = [{ mesh: 0 }];
    });
    const asset = await load(document);
    const primitive = asset.meshes[0].primitives[0];
    expect([...(primitive.normals ?? [])]).toEqual([...normals]);
    expect([...(primitive.uvs ?? [])]).toEqual([0, 1, 1, 1, 0, 0]);
    expect([...(primitive.colors ?? [])]).toEqual([...colors]);
    expect([...(primitive.joints ?? [])]).toEqual([...joints]);
    expect([...(primitive.weights ?? [])]).toEqual([...weights]);
    expect(asset.meshes[0].name).toBe("tri");
    expect(asset.meshes[0].extras).toEqual({ lod: 0 });
  });

  it("widens u8 joints and indices, keeps u32 indices wide", async () => {
    const joints8 = new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    const weights = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    const indices8 = new Uint8Array([0, 1, 2]);
    const indices32 = new Uint32Array([0, 1, 2]);
    const { bytes, offsets } = pack(
      TRI_POSITIONS,
      joints8,
      weights,
      indices8,
      indices32,
    );
    const parts = [TRI_POSITIONS, joints8, weights, indices8, indices32];
    const document = corrupt(triangleDocument(), (c) => {
      c["buffers"] = [{ byteLength: bytes.byteLength, uri: dataUri(bytes) }];
      c["bufferViews"] = parts.map((part, i) => ({
        buffer: 0,
        byteOffset: offsets[i],
        byteLength: part.byteLength,
      }));
      c["accessors"] = [
        { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
        { bufferView: 1, componentType: 5121, count: 3, type: "VEC4" },
        { bufferView: 2, componentType: 5126, count: 3, type: "VEC4" },
        { bufferView: 3, componentType: 5121, count: 3, type: "SCALAR" },
        { bufferView: 4, componentType: 5125, count: 3, type: "SCALAR" },
      ];
      c["meshes"] = [
        {
          primitives: [
            {
              attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 },
              indices: 3,
            },
            {
              attributes: { POSITION: 0 },
              indices: 4,
            },
          ],
        },
      ];
    });
    const asset = await load(document);
    const [first, second] = asset.meshes[0].primitives;
    expect(first.joints).toBeInstanceOf(Uint16Array);
    expect(first.indices).toBeInstanceOf(Uint16Array);
    expect(second.indices).toBeInstanceOf(Uint32Array);
  });

  it("converts normalized unsigned attributes to floats", async () => {
    const uvs = new Uint16Array([0, 0, 65535, 0, 0, 65535]);
    const colors = new Uint8Array([255, 0, 0, 51, 102, 0]);
    const { bytes, offsets } = pack(TRI_POSITIONS, uvs, colors, TRI_INDICES);
    const document = corrupt(triangleDocument(), (c) => {
      c["buffers"] = [{ byteLength: bytes.byteLength, uri: dataUri(bytes) }];
      c["bufferViews"] = [
        {
          buffer: 0,
          byteOffset: offsets[0],
          byteLength: TRI_POSITIONS.byteLength,
        },
        { buffer: 0, byteOffset: offsets[1], byteLength: uvs.byteLength },
        { buffer: 0, byteOffset: offsets[2], byteLength: colors.byteLength },
        {
          buffer: 0,
          byteOffset: offsets[3],
          byteLength: TRI_INDICES.byteLength,
        },
      ];
      c["accessors"] = [
        { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
        {
          bufferView: 1,
          componentType: 5123,
          normalized: true,
          count: 3,
          type: "VEC2",
        },
        // Structurally valid but unused by the primitive below.
        {
          bufferView: 2,
          componentType: 5121,
          normalized: true,
          count: 3,
          type: "VEC2",
        },
        { bufferView: 3, componentType: 5123, count: 3, type: "SCALAR" },
      ];
      c["meshes"] = [
        {
          primitives: [
            { attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 3 },
          ],
        },
      ];
    });
    const asset = await load(document);
    const primitive = asset.meshes[0].primitives[0];
    // Normalized 65535 → 1, then v flips: (0,0)→(0,1), (1,0)→(1,1), (0,1)→(0,0).
    expect([...(primitive.uvs ?? [])]).toEqual([0, 1, 1, 1, 0, 0]);
  });

  it("expands VEC3 colors to RGBA with alpha 1, converting normalized bytes", async () => {
    const colors = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]);
    const { bytes, offsets } = pack(TRI_POSITIONS, colors, TRI_INDICES);
    const document = corrupt(triangleDocument(), (c) => {
      c["buffers"] = [{ byteLength: bytes.byteLength, uri: dataUri(bytes) }];
      c["bufferViews"] = [
        {
          buffer: 0,
          byteOffset: offsets[0],
          byteLength: TRI_POSITIONS.byteLength,
        },
        { buffer: 0, byteOffset: offsets[1], byteLength: colors.byteLength },
        {
          buffer: 0,
          byteOffset: offsets[2],
          byteLength: TRI_INDICES.byteLength,
        },
      ];
      c["accessors"] = [
        { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
        {
          bufferView: 1,
          componentType: 5121,
          normalized: true,
          count: 3,
          type: "VEC3",
        },
        { bufferView: 2, componentType: 5123, count: 3, type: "SCALAR" },
      ];
      c["meshes"] = [
        {
          primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 }, indices: 2 }],
        },
      ];
    });
    const asset = await load(document);
    expect([...(asset.meshes[0].primitives[0].colors ?? [])]).toEqual([
      1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1,
    ]);
  });

  it("refuses an unnormalized integer attribute where floats are required", async () => {
    const document = corrupt(triangleDocument(), (c) => {
      (c["accessors"] as { componentType: number }[])[0].componentType = 5123;
    });
    await expectRefusal(load(document), /this use accepts FLOAT/);
  });

  it("parses a lines primitive", async () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0]);
    const { bytes } = pack(positions);
    const document = corrupt(triangleDocument(), (c) => {
      c["buffers"] = [{ byteLength: bytes.byteLength, uri: dataUri(bytes) }];
      c["bufferViews"] = [{ buffer: 0, byteLength: positions.byteLength }];
      c["accessors"] = [
        { bufferView: 0, componentType: 5126, count: 2, type: "VEC3" },
      ];
      c["meshes"] = [
        { primitives: [{ attributes: { POSITION: 0 }, mode: 1 }] },
      ];
    });
    const asset = await load(document);
    expect(asset.meshes[0].primitives[0].mode).toBe("lines");
  });

  it("refuses an unsupported primitive mode by name", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          const meshes = c["meshes"] as {
            primitives: { mode?: number }[];
          }[];
          meshes[0].primitives[0].mode = 0;
        }),
      ),
      /primitive mode 0 is refused/,
    );
  });

  it("refuses a primitive without POSITION", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          const meshes = c["meshes"] as {
            primitives: { attributes: Record<string, number> }[];
          }[];
          meshes[0].primitives[0].attributes = {};
        }),
      ),
      /POSITION is required/,
    );
  });

  it("refuses an attribute whose count differs from POSITION's", async () => {
    const normals = new Float32Array([0, 0, 1, 0, 0, 1]);
    const { bytes, offsets } = pack(TRI_POSITIONS, normals, TRI_INDICES);
    const document = corrupt(triangleDocument(), (c) => {
      c["buffers"] = [{ byteLength: bytes.byteLength, uri: dataUri(bytes) }];
      c["bufferViews"] = [
        {
          buffer: 0,
          byteOffset: offsets[0],
          byteLength: TRI_POSITIONS.byteLength,
        },
        { buffer: 0, byteOffset: offsets[1], byteLength: normals.byteLength },
        {
          buffer: 0,
          byteOffset: offsets[2],
          byteLength: TRI_INDICES.byteLength,
        },
      ];
      c["accessors"] = [
        { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
        { bufferView: 1, componentType: 5126, count: 2, type: "VEC3" },
        { bufferView: 2, componentType: 5123, count: 3, type: "SCALAR" },
      ];
      c["meshes"] = [
        {
          primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 }],
        },
      ];
    });
    await expectRefusal(load(document), /POSITION has 3/);
  });

  it("refuses JOINTS_0 without WEIGHTS_0 (§54)", async () => {
    const joints = new Uint16Array(12);
    const { bytes, offsets } = pack(TRI_POSITIONS, joints, TRI_INDICES);
    const document = corrupt(triangleDocument(), (c) => {
      c["buffers"] = [{ byteLength: bytes.byteLength, uri: dataUri(bytes) }];
      c["bufferViews"] = [
        {
          buffer: 0,
          byteOffset: offsets[0],
          byteLength: TRI_POSITIONS.byteLength,
        },
        { buffer: 0, byteOffset: offsets[1], byteLength: joints.byteLength },
        {
          buffer: 0,
          byteOffset: offsets[2],
          byteLength: TRI_INDICES.byteLength,
        },
      ];
      c["accessors"] = [
        { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
        { bufferView: 1, componentType: 5123, count: 3, type: "VEC4" },
        { bufferView: 2, componentType: 5123, count: 3, type: "SCALAR" },
      ];
      c["meshes"] = [
        {
          primitives: [
            { attributes: { POSITION: 0, JOINTS_0: 1 }, indices: 2 },
          ],
        },
      ];
    });
    await expectRefusal(load(document), /come as a pair/);
  });

  it("refuses a joints accessor with the wrong shape", async () => {
    const document = corrupt(skinnedDocument(), (c) => {
      (c["accessors"] as { type: string }[])[1].type = "VEC3";
    });
    await expectRefusal(load(document), /joints accessor must be VEC4/);
  });

  it("refuses a joints accessor with a float component type", async () => {
    const document = corrupt(skinnedDocument(), (c) => {
      (c["accessors"] as { componentType: number }[])[1].componentType = 5126;
    });
    await expectRefusal(load(document), /UNSIGNED_BYTE or UNSIGNED_SHORT/);
  });

  it("refuses an out-of-range index (§85, §96)", async () => {
    const badIndices = new Uint16Array([0, 1, 9]);
    const { bytes, offsets } = pack(TRI_POSITIONS, badIndices);
    const document = corrupt(triangleDocument(), (c) => {
      c["buffers"] = [{ byteLength: bytes.byteLength, uri: dataUri(bytes) }];
      (c["bufferViews"] as { byteOffset: number }[])[1].byteOffset = offsets[1];
    });
    await expectRefusal(load(document), /refers to vertex 9/);
  });

  it("refuses an indices accessor that is not SCALAR", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["accessors"] as { type: string }[])[1].type = "VEC2";
        }),
      ),
      /indices accessor must be SCALAR/,
    );
  });

  it("refuses a signed index component type", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["accessors"] as { componentType: number }[])[1].componentType =
            5122;
        }),
      ),
      /UNSIGNED_BYTE, UNSIGNED_SHORT, or UNSIGNED_INT/,
    );
  });

  it("refuses an index view carrying byteStride", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["bufferViews"] as { byteStride?: number }[])[1].byteStride = 4;
        }),
      ),
      /must not declare byteStride/,
    );
  });

  it("refuses a draw count that is not whole primitives", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["accessors"] as { count: number }[])[1].count = 2;
        }),
      ),
      /multiple of 3/,
    );
  });

  it("refuses morph targets by name", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          const meshes = c["meshes"] as {
            primitives: { targets?: unknown }[];
          }[];
          meshes[0].primitives[0].targets = [];
        }),
      ),
      /morph targets are refused/,
    );
  });

  it("refuses mesh-level morph weights by name", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["meshes"] as Record<string, unknown>[])[0]["weights"] = [0.5];
        }),
      ),
      /morph targets are refused/,
    );
  });

  it("refuses a mesh with no primitives", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["meshes"] as { primitives: unknown[] }[])[0].primitives = [];
        }),
      ),
      /at least one primitive/,
    );
  });

  it("records unrecognized attributes as ignored", async () => {
    const asset = await load(
      corrupt(triangleDocument(), (c) => {
        const meshes = c["meshes"] as {
          primitives: { attributes: Record<string, number> }[];
        }[];
        meshes[0].primitives[0].attributes["TANGENT"] = 0;
      }),
    );
    expect(asset.ignored).toEqual([
      "meshes[0].primitives[0].attributes.TANGENT",
    ]);
  });

  it("refuses a primitive naming a missing material", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          const meshes = c["meshes"] as {
            primitives: { material?: number }[];
          }[];
          meshes[0].primitives[0].material = 0;
        }),
      ),
      /material: index 0 is out of range/,
    );
  });
});

describe("materials (§59 tier)", () => {
  it("applies glTF's own defaults when pbrMetallicRoughness is absent", async () => {
    const asset = await load(
      corrupt(triangleDocument(), (c) => {
        c["materials"] = [{}];
      }),
    );
    const material = asset.materials[0];
    expect(material.baseColor).toEqual([1, 1, 1, 1]);
    expect(material.metalness).toBe(1);
    expect(material.roughness).toBe(1);
    expect(material.emissive).toEqual([0, 0, 0]);
    expect(material.transparent).toBe(false);
    expect(material.doubleSided).toBe(false);
    expect(material.baseColorTexture).toBeNull();
    expect(material.metallicRoughnessTexture).toBeNull();
    expect(material.emissiveTexture).toBeNull();
  });

  it("carries factors, alpha mode, double-sidedness, and extras", async () => {
    const asset = await load(
      corrupt(triangleDocument(), (c) => {
        c["materials"] = [
          {
            name: "shell",
            extras: { paint: "candy" },
            doubleSided: true,
            alphaMode: "BLEND",
            emissiveFactor: [0.1, 0.2, 0.3],
            pbrMetallicRoughness: {
              baseColorFactor: [1, 0.5, 0.25, 0.5],
              metallicFactor: 0.75,
              roughnessFactor: 0.25,
            },
          },
        ];
      }),
    );
    const material = asset.materials[0];
    expect(material.name).toBe("shell");
    expect(material.baseColor).toEqual([1, 0.5, 0.25, 0.5]);
    expect(material.metalness).toBe(0.75);
    expect(material.roughness).toBe(0.25);
    expect(material.emissive).toEqual([0.1, 0.2, 0.3]);
    expect(material.transparent).toBe(true);
    expect(material.doubleSided).toBe(true);
    expect(material.extras).toEqual({ paint: "candy" });
  });

  it("refuses MASK alpha by name", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          c["materials"] = [{ alphaMode: "MASK", alphaCutoff: 0.5 }];
        }),
      ),
      /MASK needs an alpha cutoff/,
    );
  });

  it("refuses an unknown alphaMode", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          c["materials"] = [{ alphaMode: "HAZY" }];
        }),
      ),
      /alphaMode HAZY/,
    );
  });

  it("refuses a wrong-length baseColorFactor", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          c["materials"] = [
            { pbrMetallicRoughness: { baseColorFactor: [1, 1, 1] } },
          ];
        }),
      ),
      /expected 4 numbers/,
    );
  });

  it("refuses a non-finite factor (§85)", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          c["materials"] = [{ pbrMetallicRoughness: { metallicFactor: null } }];
        }),
      ),
      /expected a finite number/,
    );
  });

  it("refuses a texCoord other than 0 by name", async () => {
    await expectRefusal(
      load(
        corrupt(texturedDocument(), (c) => {
          const materials = c["materials"] as {
            pbrMetallicRoughness: { baseColorTexture: { texCoord?: number } };
          }[];
          materials[0].pbrMetallicRoughness.baseColorTexture.texCoord = 1;
        }),
      ),
      /TEXCOORD_0 only/,
    );
  });

  it("decodes default normal and occlusion maps as linear data", async () => {
    const asset = await load(
      corrupt(texturedDocument(), (c) => {
        const materials = c["materials"] as Record<string, unknown>[];
        const pbr = materials[0]["pbrMetallicRoughness"] as Record<
          string,
          unknown
        >;
        delete pbr["baseColorTexture"];
        materials[0]["normalTexture"] = { index: 0 };
        materials[0]["occlusionTexture"] = { index: 0 };
      }),
      { decodeTexture: fakeDecode },
    );
    expect(asset.materials[0].ignoredTextures).toEqual([]);
    expect(asset.materials[0].normalTexture).toBe(0);
    expect(asset.materials[0].occlusionTexture).toBe(0);
    expect(asset.textures[0]?.colorSpace).toBe("linear");
    expect(asset.ignored.join("\n")).not.toMatch(/texture slot/);
  });

  it("decodes a metallicRoughnessTexture and does not warn it ignored", async () => {
    const asset = await load(
      corrupt(texturedDocument(), (c) => {
        const materials = c["materials"] as Record<string, unknown>[];
        const pbr = materials[0]["pbrMetallicRoughness"] as Record<
          string,
          unknown
        >;
        delete pbr["baseColorTexture"];
        pbr["metallicRoughnessTexture"] = { index: 0 };
      }),
      { decodeTexture: fakeDecode },
    );
    expect(asset.materials[0].ignoredTextures).toEqual([]);
    expect(asset.materials[0].metallicRoughnessTexture).toBe(0);
    expect(asset.textures[0]).not.toBeNull();
    expect(asset.textures[0]?.colorSpace).toBe("linear");
    expect(asset.ignored.join("\n")).not.toMatch(/metallicRoughnessTexture/);
  });

  it("decodes an emissiveTexture as sRGB and does not warn it ignored", async () => {
    const asset = await load(
      corrupt(texturedDocument(), (c) => {
        const materials = c["materials"] as Record<string, unknown>[];
        const pbr = materials[0]["pbrMetallicRoughness"] as Record<
          string,
          unknown
        >;
        delete pbr["baseColorTexture"];
        materials[0]["emissiveTexture"] = { index: 0 };
      }),
      { decodeTexture: fakeDecode },
    );
    expect(asset.materials[0].ignoredTextures).toEqual([]);
    expect(asset.materials[0].emissiveTexture).toBe(0);
    expect(asset.textures[0]).not.toBeNull();
    expect(asset.textures[0]?.colorSpace).toBe("srgb");
    expect(asset.ignored.join("\n")).not.toMatch(/emissiveTexture/);
  });

  it("refuses an ignored slot naming a missing texture (§96)", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          c["materials"] = [{ normalTexture: { index: 3 } }];
        }),
      ),
      /out of range/,
    );
  });
});

describe("textures, images, samplers", () => {
  it("refuses an unbounded image decoder at construction despite a probe", () => {
    const decodeTexture = vi.fn(fakeDecode);
    expect(() =>
      createGltfLoader({
        decodeTexture,
        probeTexture: () => ({ width: 1, height: 2 }),
        maximumWorkingBytes: 65_536,
      }),
    ).toThrow(/no enforceable/);
    expect(decodeTexture).not.toHaveBeenCalled();
  });

  it("preserves bounded decoder identity through glTF and snapshots options", async () => {
    const decodeTexture = registerBoundedImageDecoder(
      (data: ArrayBuffer) => fakeDecode(data),
      65_536,
    );
    const unsafe = vi.fn(fakeDecode);
    const options: GltfLoaderOptions = {
      decodeTexture,
      maximumWorkingBytes: 65_536,
    };
    const loader = createGltfLoader(options);
    Object.assign(options, { decodeTexture: unsafe });
    const asset = await loader.load(
      jsonResponse(texturedDocument()),
      "/safe.gltf",
    );
    expect(asset.textures[0]?.width).toBe(1);
    expect(unsafe).not.toHaveBeenCalled();
    asset.dispose();
  });

  it("permits texture-free glTF with a valid cap and rejects invalid caps", async () => {
    await expect(
      load(triangleDocument(), { maximumWorkingBytes: 65_536 }),
    ).resolves.toBeDefined();
    expect(() => createGltfLoader({ maximumWorkingBytes: Infinity })).toThrow(
      /safe integer/,
    );
  });

  it("decodes a referenced base-colour texture through the injected seam", async () => {
    const asset = await load(texturedDocument(), {
      decodeTexture: fakeDecode,
    });
    const texture = asset.textures[0];
    expect(texture).not.toBeNull();
    expect(texture?.width).toBe(1);
    expect(texture?.height).toBe(2);
    expect(texture?.colorSpace).toBe("srgb");
    expect(texture?.filter).toBe("nearest");
    expect(texture?.wrap).toBe("clamp-to-edge");
    // Rows flipped to §7a's bottom-first order by the texture tier.
    expect([...(texture?.data ?? [])]).toEqual([
      100, 100, 100, 100, 200, 200, 200, 200,
    ]);
    expect(asset.materials[0].baseColorTexture).toBe(0);
  });

  it("defaults the sampler to linear/repeat when a texture has none", async () => {
    const asset = await load(
      corrupt(texturedDocument(), (c) => {
        c["textures"] = [{ source: 0 }];
      }),
      { decodeTexture: fakeDecode },
    );
    expect(asset.textures[0]?.filter).toBe("linear");
    expect(asset.textures[0]?.wrap).toBe("repeat");
  });

  it("reads an image out of a bufferView", async () => {
    const { bytes, offsets } = pack(TRI_POSITIONS, TRI_INDICES, ENCODED_IMAGE);
    const asset = await load(
      corrupt(texturedDocument(), (c) => {
        (c["buffers"] as { byteLength: number; uri: string }[])[0] = {
          byteLength: bytes.byteLength,
          uri: dataUri(bytes),
        };
        (c["bufferViews"] as unknown[]).push({
          buffer: 0,
          byteOffset: offsets[2],
          byteLength: ENCODED_IMAGE.byteLength,
        });
        c["images"] = [{ bufferView: 2, mimeType: "image/png" }];
      }),
      { decodeTexture: fakeDecode },
    );
    expect(asset.textures[0]?.width).toBe(1);
  });

  it("fetches an external image through the injected transport", async () => {
    const seen: string[] = [];
    const asset = await load(
      corrupt(texturedDocument(), (c) => {
        c["images"] = [{ uri: "crate.img" }];
      }),
      {
        decodeTexture: fakeDecode,
        fetch: (url) => {
          seen.push(url);
          return Promise.resolve(bytesResponse(ENCODED_IMAGE));
        },
      },
    );
    expect(seen).toEqual(["/crate.img"]);
    expect(asset.textures[0]?.height).toBe(2);
  });

  it("refuses a sampled texture without a decoder, naming the seam", async () => {
    await expectRefusal(load(texturedDocument()), /without a\s+decoder/);
  });

  it("refuses an image with both uri and bufferView", async () => {
    await expectRefusal(
      load(
        corrupt(texturedDocument(), (c) => {
          c["images"] = [{ uri: "a.png", bufferView: 0 }];
        }),
        { decodeTexture: fakeDecode },
      ),
      /not both/,
    );
  });

  it("refuses an image with neither uri nor bufferView", async () => {
    await expectRefusal(
      load(
        corrupt(texturedDocument(), (c) => {
          c["images"] = [{ mimeType: "image/png" }];
        }),
        { decodeTexture: fakeDecode },
      ),
      /needs a uri or a bufferView/,
    );
  });

  it("refuses a non-base64 image data URI", async () => {
    await expectRefusal(
      load(
        corrupt(texturedDocument(), (c) => {
          c["images"] = [{ uri: "data:image/png,abc" }];
        }),
        { decodeTexture: fakeDecode },
      ),
      /only base64/,
    );
  });

  it("decodes an image from a base64 data URI", async () => {
    const asset = await load(
      corrupt(texturedDocument(), (c) => {
        c["images"] = [{ uri: `data:image/png;base64,${b64(ENCODED_IMAGE)}` }];
      }),
      { decodeTexture: fakeDecode },
    );
    expect(asset.textures[0]?.width).toBe(1);
  });

  it("refuses a texture without a source", async () => {
    await expectRefusal(
      load(
        corrupt(texturedDocument(), (c) => {
          c["textures"] = [{ sampler: 0 }];
        }),
        { decodeTexture: fakeDecode },
      ),
      /without an image source/,
    );
  });

  it("refuses unknown sampler enums", async () => {
    await expectRefusal(
      load(
        corrupt(texturedDocument(), (c) => {
          c["samplers"] = [{ magFilter: 1 }];
        }),
        { decodeTexture: fakeDecode },
      ),
      /unknown magFilter 1/,
    );
    await expectRefusal(
      load(
        corrupt(texturedDocument(), (c) => {
          c["samplers"] = [{ wrapS: 2 }];
        }),
        { decodeTexture: fakeDecode },
      ),
      /unknown wrap mode 2/,
    );
    await expectRefusal(
      load(
        corrupt(texturedDocument(), (c) => {
          c["samplers"] = [{ minFilter: 7 }];
        }),
        { decodeTexture: fakeDecode },
      ),
      /minFilter: expected 9728, 9729/,
    );
  });

  it("records mip-selecting minFilter and mismatched wrapT as ignored", async () => {
    const asset = await load(
      corrupt(texturedDocument(), (c) => {
        c["samplers"] = [{ minFilter: 9987, wrapS: 10497, wrapT: 33071 }];
      }),
      { decodeTexture: fakeDecode },
    );
    expect(asset.ignored).toEqual([
      "samplers[0].minFilter (mip-selecting)",
      "samplers[0].wrapT (differs from wrapS; one wrap mode per texture)",
    ]);
  });

  it("accepts a plain nearest minFilter without a record", async () => {
    const asset = await load(
      corrupt(texturedDocument(), (c) => {
        c["samplers"] = [{ minFilter: 9728 }];
      }),
      { decodeTexture: fakeDecode },
    );
    expect(asset.ignored).toEqual([]);
  });
});

describe("nodes and hierarchy", () => {
  it("carries TRS, names, and extras; defaults are glTF's", async () => {
    const asset = await load(
      corrupt(triangleDocument(), (c) => {
        c["nodes"] = [
          {
            mesh: 0,
            name: "root",
            translation: [1, 2, 3],
            rotation: [0, 0, 0.7071, 0.7071],
            scale: [2, 2, 2],
            extras: { tag: "hero" },
            children: [1],
          },
          {},
        ];
      }),
    );
    const [root, child] = asset.nodes;
    expect(root.name).toBe("root");
    expect(root.translation).toEqual([1, 2, 3]);
    expect(root.rotation).toEqual([0, 0, 0.7071, 0.7071]);
    expect(root.scale).toEqual([2, 2, 2]);
    expect(root.extras).toEqual({ tag: "hero" });
    expect(root.children).toEqual([1]);
    expect(child.translation).toEqual([0, 0, 0]);
    expect(child.rotation).toEqual([0, 0, 0, 1]);
    expect(child.scale).toEqual([1, 1, 1]);
    expect(child.matrix).toBeNull();
  });

  it("keeps a matrix-form node's matrix raw for the assembly tier", async () => {
    const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1];
    const asset = await load(
      corrupt(triangleDocument(), (c) => {
        c["nodes"] = [{ mesh: 0, matrix }];
      }),
    );
    expect([...(asset.nodes[0].matrix ?? [])]).toEqual(matrix);
  });

  it("refuses matrix beside TRS", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          c["nodes"] = [
            {
              mesh: 0,
              matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
              translation: [1, 0, 0],
            },
          ];
        }),
      ),
      /mutually exclusive/,
    );
  });

  it("refuses a non-finite transform component (§85, §96)", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          c["nodes"] = [{ mesh: 0, translation: [0, null, 0] }];
        }),
      ),
      /finite number/,
    );
  });

  it("refuses a child index out of range", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          c["nodes"] = [{ mesh: 0, children: [4] }];
        }),
      ),
      /out of range/,
    );
  });

  it("refuses a node with two parents (§85)", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          c["nodes"] = [{ children: [2] }, { children: [2] }, {}];
          c["scenes"] = [{ nodes: [0, 1] }];
        }),
      ),
      /second parent/,
    );
  });

  it("refuses a hierarchy cycle (§85)", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          c["nodes"] = [{ children: [1] }, { children: [0] }];
          c["scenes"] = [{ nodes: [] }];
        }),
      ),
      /cycle/,
    );
  });

  it("refuses a skin without a mesh", async () => {
    await expectRefusal(
      load(
        corrupt(skinnedDocument(), (c) => {
          const nodes = c["nodes"] as Record<string, unknown>[];
          delete nodes[0]["mesh"];
        }),
      ),
      /must also carry a mesh/,
    );
  });

  it("refuses node-level morph weights by name", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          c["nodes"] = [{ mesh: 0, weights: [1] }];
        }),
      ),
      /morph-target weights/,
    );
  });

  it("validates and ignores a node camera, with a record", async () => {
    const asset = await load(
      corrupt(triangleDocument(), (c) => {
        c["cameras"] = [{ type: "perspective" }];
        c["nodes"] = [{ mesh: 0, camera: 0 }];
      }),
    );
    expect(asset.ignored).toEqual(["cameras", "nodes[0].camera"]);
  });

  it("refuses a camera index out of range", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          c["nodes"] = [{ mesh: 0, camera: 0 }];
        }),
      ),
      /camera: index 0 is out of range/,
    );
  });
});

describe("scenes", () => {
  it("refuses a scene naming a non-root node", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          c["nodes"] = [{ children: [1] }, { mesh: 0 }];
          c["scenes"] = [{ nodes: [0, 1] }];
        }),
      ),
      /not a root/,
    );
  });

  it("refuses a scene listing a node twice", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          c["scenes"] = [{ nodes: [0, 0] }];
        }),
      ),
      /listed twice/,
    );
  });

  it("refuses a default scene index out of range", async () => {
    await expectRefusal(
      load(corrupt(triangleDocument(), (c) => (c["scene"] = 4))),
      /out of range/,
    );
  });

  it("reports no default scene as null, and reads nodeless scenes", async () => {
    const asset = await load(
      corrupt(triangleDocument(), (c) => {
        delete c["scene"];
        c["scenes"] = [{ name: "empty" }];
      }),
    );
    expect(asset.defaultScene).toBeNull();
    expect(asset.scenes[0]).toEqual({ name: "empty", nodes: [] });
  });
});

describe("skins", () => {
  it("parses joints and inverse binds, in file order", async () => {
    const asset = await load(skinnedDocument());
    const skin = asset.skins[0];
    expect(skin.joints).toEqual([1, 2]);
    expect(skin.inverseBindMatrices).toHaveLength(32);
    expect(skin.inverseBindMatrices?.[16 + 13]).toBe(-1);
  });

  it("reports an identity default when the file has no binds", async () => {
    const asset = await load(
      corrupt(skinnedDocument(), (c) => {
        const skins = c["skins"] as Record<string, unknown>[];
        delete skins[0]["inverseBindMatrices"];
      }),
    );
    expect(asset.skins[0].inverseBindMatrices).toBeNull();
  });

  it("refuses an empty joint list", async () => {
    await expectRefusal(
      load(
        corrupt(skinnedDocument(), (c) => {
          (c["skins"] as { joints: number[] }[])[0].joints = [];
        }),
      ),
      /at least one joint/,
    );
  });

  it("refuses a duplicate joint (§33)", async () => {
    await expectRefusal(
      load(
        corrupt(skinnedDocument(), (c) => {
          (c["skins"] as { joints: number[] }[])[0].joints = [1, 1];
        }),
      ),
      /appears twice/,
    );
  });

  it("refuses binds that are not float MAT4", async () => {
    await expectRefusal(
      load(
        corrupt(skinnedDocument(), (c) => {
          (c["accessors"] as { type: string }[])[4].type = "VEC4";
        }),
      ),
      /expected MAT4/,
    );
  });

  it("refuses fewer bind matrices than joints", async () => {
    await expectRefusal(
      load(
        corrupt(skinnedDocument(), (c) => {
          (c["accessors"] as { count: number }[])[4].count = 1;
        }),
      ),
      /1 matrices for 2 joints/,
    );
  });

  it("refuses a skinned primitive indexing past its skin (§96)", async () => {
    await expectRefusal(
      load(
        corrupt(skinnedDocument(), (c) => {
          (c["skins"] as { joints: number[] }[])[0].joints = [1];
          (c["accessors"] as { count: number }[])[4].count = 1;
        }),
      ),
      /indexes joint 1/,
    );
  });
});

describe("animations", () => {
  it("parses LINEAR and STEP channels for all three paths", async () => {
    const asset = await load(skinnedDocument());
    const [channel] = asset.animations[0].channels;
    expect(asset.animations[0].name).toBe("bend");
    expect(channel.node).toBe(2);
    expect(channel.path).toBe("rotation");
    expect(channel.interpolation).toBe("linear");
    expect([...channel.times]).toEqual([0, 1]);
    expect(channel.values).toHaveLength(8);
  });

  it("maps STEP and reads translation/scale as VEC3", async () => {
    const times = new Float32Array([0, 0.5]);
    const values = new Float32Array([0, 0, 0, 1, 2, 3]);
    const { bytes, offsets } = pack(TRI_POSITIONS, TRI_INDICES, times, values);
    const document = corrupt(triangleDocument(), (c) => {
      c["buffers"] = [{ byteLength: bytes.byteLength, uri: dataUri(bytes) }];
      (c["bufferViews"] as { byteOffset: number }[])[1].byteOffset = offsets[1];
      (c["bufferViews"] as unknown[]).push(
        { buffer: 0, byteOffset: offsets[2], byteLength: times.byteLength },
        { buffer: 0, byteOffset: offsets[3], byteLength: values.byteLength },
      );
      (c["accessors"] as unknown[]).push(
        { bufferView: 2, componentType: 5126, count: 2, type: "SCALAR" },
        { bufferView: 3, componentType: 5126, count: 2, type: "VEC3" },
      );
      c["animations"] = [
        {
          samplers: [{ input: 2, output: 3, interpolation: "STEP" }],
          channels: [
            { sampler: 0, target: { node: 0, path: "translation" } },
            { sampler: 0, target: { node: 0, path: "scale" } },
          ],
        },
      ];
    });
    const asset = await load(document);
    const animation = asset.animations[0];
    expect(animation.name).toBe("");
    expect(animation.channels[0].interpolation).toBe("step");
    expect(animation.channels[1].path).toBe("scale");
    expect([...animation.channels[0].values]).toEqual([0, 0, 0, 1, 2, 3]);
  });

  it("refuses CUBICSPLINE by name", async () => {
    await expectRefusal(
      load(
        corrupt(skinnedDocument(), (c) => {
          const animations = c["animations"] as {
            samplers: { interpolation: string }[];
          }[];
          animations[0].samplers[0].interpolation = "CUBICSPLINE";
        }),
      ),
      /CUBICSPLINE samplers are refused/,
    );
  });

  it("refuses an unknown interpolation", async () => {
    await expectRefusal(
      load(
        corrupt(skinnedDocument(), (c) => {
          const animations = c["animations"] as {
            samplers: { interpolation: string }[];
          }[];
          animations[0].samplers[0].interpolation = "SMOOTH";
        }),
      ),
      /unknown interpolation SMOOTH/,
    );
  });

  it("refuses a morph-weight channel by name", async () => {
    await expectRefusal(
      load(
        corrupt(skinnedDocument(), (c) => {
          const animations = c["animations"] as {
            channels: { target: { path: string } }[];
          }[];
          animations[0].channels[0].target.path = "weights";
        }),
      ),
      /morph-weight channels are refused/,
    );
  });

  it("refuses an unknown target path", async () => {
    await expectRefusal(
      load(
        corrupt(skinnedDocument(), (c) => {
          const animations = c["animations"] as {
            channels: { target: { path: string } }[];
          }[];
          animations[0].channels[0].target.path = "visibility";
        }),
      ),
      /unknown target path/,
    );
  });

  it("refuses a channel without a target node", async () => {
    await expectRefusal(
      load(
        corrupt(skinnedDocument(), (c) => {
          const animations = c["animations"] as {
            channels: { target: Record<string, unknown> }[];
          }[];
          delete animations[0].channels[0].target["node"];
        }),
      ),
      /without a target node/,
    );
  });

  it("refuses an animation with no channels", async () => {
    await expectRefusal(
      load(
        corrupt(skinnedDocument(), (c) => {
          (c["animations"] as { channels: unknown[] }[])[0].channels = [];
        }),
      ),
      /at least one channel/,
    );
  });

  it("refuses non-increasing keyframe times (§17, §85)", async () => {
    // Rewrite the second keyframe time in the embedded buffer to 0, so the
    // sequence [0, 0] is no longer strictly increasing.
    const document = skinnedDocument();
    const buffers = document["buffers"] as { uri: string }[];
    const bytes = new Uint8Array(
      Buffer.from(buffers[0].uri.split(",")[1], "base64"),
    );
    const timesOffset = (document["bufferViews"] as { byteOffset: number }[])[5]
      .byteOffset;
    new DataView(bytes.buffer, bytes.byteOffset).setFloat32(
      timesOffset + 4,
      0,
      true,
    );
    buffers[0].uri = dataUri(bytes);
    await expectRefusal(load(document), /strictly increasing/);
  });

  it("refuses an output whose key count differs from the input's", async () => {
    await expectRefusal(
      load(
        corrupt(skinnedDocument(), (c) => {
          (c["accessors"] as { count: number }[])[6].count = 1;
        }),
      ),
      /1 keys for 2 times/,
    );
  });

  it("accepts a signed-normalized rotation output", async () => {
    const rotations16 = new Int16Array([0, 0, 0, 32767, 0, 0, 23170, 23170]);
    const document = corrupt(skinnedDocument(), (c) => {
      const positions = new Float32Array([
        -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0,
      ]);
      const joints = new Uint16Array([
        0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0,
      ]);
      const weights = new Float32Array([
        1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0,
      ]);
      const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
      const binds = new Float32Array(32);
      for (const base of [0, 16]) {
        binds[base] = 1;
        binds[base + 5] = 1;
        binds[base + 10] = 1;
        binds[base + 15] = 1;
      }
      const times = new Float32Array([0, 1]);
      const { bytes, offsets } = pack(
        positions,
        joints,
        weights,
        indices,
        binds,
        times,
        rotations16,
      );
      c["buffers"] = [{ byteLength: bytes.byteLength, uri: dataUri(bytes) }];
      const views = c["bufferViews"] as {
        byteOffset: number;
        byteLength: number;
      }[];
      const parts = [
        positions,
        joints,
        weights,
        indices,
        binds,
        times,
        rotations16,
      ];
      for (let i = 0; i < views.length; i += 1) {
        views[i].byteOffset = offsets[i];
        views[i].byteLength = parts[i].byteLength;
      }
      (
        c["accessors"] as { componentType: number; normalized?: boolean }[]
      )[6].componentType = 5122;
      (
        c["accessors"] as { componentType: number; normalized?: boolean }[]
      )[6].normalized = true;
    });
    const asset = await load(document);
    const values = asset.animations[0].channels[0].values;
    expect(values[3]).toBeCloseTo(1, 4);
    expect(values[6]).toBeCloseTo(23170 / 32767, 4);
  });
});

describe("remaining shapes and defaults", () => {
  it("refuses a non-array collection", async () => {
    await expectRefusal(
      load(corrupt(triangleDocument(), (c) => (c["scenes"] = {}))),
      /scenes: expected an array/,
    );
  });

  it("refuses a non-string name", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          (c["meshes"] as Record<string, unknown>[])[0]["name"] = 5;
        }),
      ),
      /name: expected a string/,
    );
  });

  it("refuses a non-integer index", async () => {
    await expectRefusal(
      load(
        corrupt(triangleDocument(), (c) => {
          c["nodes"] = [{ mesh: 0.5 }];
        }),
      ),
      /expected a non-negative integer index/,
    );
  });

  it("refuses a normalized signed integer where only unsigned is allowed", async () => {
    const uvs = new Int8Array([0, 0, 127, 0, 0, 127]);
    const { bytes, offsets } = pack(TRI_POSITIONS, uvs, TRI_INDICES);
    const document = corrupt(triangleDocument(), (c) => {
      c["buffers"] = [{ byteLength: bytes.byteLength, uri: dataUri(bytes) }];
      c["bufferViews"] = [
        {
          buffer: 0,
          byteOffset: offsets[0],
          byteLength: TRI_POSITIONS.byteLength,
        },
        { buffer: 0, byteOffset: offsets[1], byteLength: uvs.byteLength },
        {
          buffer: 0,
          byteOffset: offsets[2],
          byteLength: TRI_INDICES.byteLength,
        },
      ];
      c["accessors"] = [
        { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
        {
          bufferView: 1,
          componentType: 5120,
          normalized: true,
          count: 3,
          type: "VEC2",
        },
        { bufferView: 2, componentType: 5123, count: 3, type: "SCALAR" },
      ];
      c["meshes"] = [
        {
          primitives: [
            { attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2 },
          ],
        },
      ];
    });
    await expectRefusal(
      load(document),
      /\(normalized\); this use accepts FLOAT or normalized integers/,
    );
  });

  it("accepts a signed-byte normalized rotation output", async () => {
    const document = corrupt(skinnedDocument(), (c) => {
      const rotations8 = new Int8Array([0, 0, 0, 127, 0, 0, 90, 90]);
      // Rebuild the buffer with byte rotations in the last slot.
      const positions = new Float32Array([
        -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0,
      ]);
      const joints = new Uint16Array([
        0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0,
      ]);
      const weights = new Float32Array([
        1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0,
      ]);
      const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
      const binds = new Float32Array(32);
      for (const base of [0, 16]) {
        binds[base] = 1;
        binds[base + 5] = 1;
        binds[base + 10] = 1;
        binds[base + 15] = 1;
      }
      const times = new Float32Array([0, 1]);
      const { bytes, offsets } = pack(
        positions,
        joints,
        weights,
        indices,
        binds,
        times,
        rotations8,
      );
      c["buffers"] = [{ byteLength: bytes.byteLength, uri: dataUri(bytes) }];
      const views = c["bufferViews"] as {
        byteOffset: number;
        byteLength: number;
      }[];
      const parts = [
        positions,
        joints,
        weights,
        indices,
        binds,
        times,
        rotations8,
      ];
      for (let i = 0; i < views.length; i += 1) {
        views[i].byteOffset = offsets[i];
        views[i].byteLength = parts[i].byteLength;
      }
      const accessors = c["accessors"] as {
        componentType: number;
        normalized?: boolean;
      }[];
      accessors[6].componentType = 5120;
      accessors[6].normalized = true;
    });
    const asset = await load(document);
    const values = asset.animations[0].channels[0].values;
    expect(values[3]).toBeCloseTo(1, 4);
    expect(values[6]).toBeCloseTo(90 / 127, 4);
  });

  it("maps mirrored-repeat wrap", async () => {
    const asset = await load(
      corrupt(texturedDocument(), (c) => {
        c["samplers"] = [{ wrapS: 33648, wrapT: 33648 }];
      }),
      { decodeTexture: fakeDecode },
    );
    expect(asset.textures[0]?.wrap).toBe("mirrored-repeat");
  });

  it("rethrows the §96 JSON depth guard's own refusal", async () => {
    const deep = "[".repeat(2000) + "]".repeat(2000);
    const error = await createGltfLoader()
      .load(bytesResponse(new TextEncoder().encode(deep)), "/deep.gltf")
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
    expect(isFourError(error)).toBe(true);
    if (isFourError(error)) {
      expect(error.code).toBe("UNTRUSTED_INPUT_REJECTED");
    }
  });

  it("loads a skinned node whose primitive carries no influences", async () => {
    const asset = await load(
      corrupt(skinnedDocument(), (c) => {
        const meshes = c["meshes"] as {
          primitives: { attributes: Record<string, number> }[];
        }[];
        meshes[0].primitives[0].attributes = { POSITION: 0 };
      }),
    );
    expect(asset.meshes[0].primitives[0].joints).toBeUndefined();
  });

  it("defaults a sampler's interpolation to LINEAR", async () => {
    const asset = await load(
      corrupt(skinnedDocument(), (c) => {
        const animations = c["animations"] as {
          samplers: Record<string, unknown>[];
        }[];
        delete animations[0].samplers[0]["interpolation"];
      }),
    );
    expect(asset.animations[0].channels[0].interpolation).toBe("linear");
  });

  it("refuses a non-indexed vertex count that is not whole primitives", async () => {
    const positions = new Float32Array(12); // 4 vertices
    const { bytes } = pack(positions);
    const document = corrupt(triangleDocument(), (c) => {
      c["buffers"] = [{ byteLength: bytes.byteLength, uri: dataUri(bytes) }];
      c["bufferViews"] = [{ buffer: 0, byteLength: positions.byteLength }];
      c["accessors"] = [
        { bufferView: 0, componentType: 5126, count: 4, type: "VEC3" },
      ];
      c["meshes"] = [{ primitives: [{ attributes: { POSITION: 0 } }] }];
    });
    await expectRefusal(load(document), /multiple of 3 vertices/);
  });
});

describe("disposal (§83)", () => {
  it("disposes decoded textures once, idempotently", async () => {
    const asset = await load(texturedDocument(), { decodeTexture: fakeDecode });
    const texture = asset.textures[0];
    expect(asset.isDisposed).toBe(false);
    asset.dispose();
    asset.dispose();
    expect(asset.isDisposed).toBe(true);
    expect(texture?.isDisposed).toBe(true);
    // Records stay readable — they are plain data.
    expect(asset.meshes).toHaveLength(1);
  });
});
