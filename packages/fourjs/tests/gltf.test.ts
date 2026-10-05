/**
 * §78 assembly — `instantiateGltf` over the real parse tier (A-19,
 * 2026-08-29).
 *
 * Every asset here goes through `@fourjs/assets`' actual glTF loader, so the
 * suite proves the two tiers agree end to end: parse produces the records,
 * assembly produces live nodes, and §78's sharing sentence holds — geometry
 * and textures shared per asset, transforms and materials fresh per call.
 */

import {
  createGltfLoader,
  type FetchResponse,
  type GltfAsset,
} from "@fourjs/assets";
import { AnimationMixer } from "@fourjs/animation";
import { isFourError, resetDevWarnings } from "@fourjs/core";
import { StandardMaterial } from "@fourjs/materials";
import { Mesh } from "@fourjs/render";
import { Bone, Group, MorphWeights } from "@fourjs/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { instantiateGltf } from "../src/index.js";

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function dataUri(bytes: Uint8Array): string {
  return `data:application/octet-stream;base64,${b64(bytes)}`;
}

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

/** Loads a document through the real parse tier. */
function parse(
  document: unknown,
  decodeTexture?: (data: ArrayBuffer) => {
    width: number;
    height: number;
    data: Uint8Array;
  },
): Promise<GltfAsset> {
  return createGltfLoader({ decodeTexture }).load(
    jsonResponse(document),
    "/model.gltf",
  );
}

const TRI_POSITIONS = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const TRI_INDICES = new Uint16Array([0, 1, 2]);

/** A one-triangle document; `edit` mutates before parse. */
function triangleDocument(
  edit?: (copy: Record<string, unknown>) => void,
): Record<string, unknown> {
  const { bytes, offsets } = pack(TRI_POSITIONS, TRI_INDICES);
  const document: Record<string, unknown> = {
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
  edit?.(document);
  return document;
}

/** A two-bone skinned document with one rotation clip (the assets fixture). */
function skinnedDocument(
  edit?: (copy: Record<string, unknown>) => void,
): Record<string, unknown> {
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
  const parts = [positions, joints, weights, indices, binds, times, rotations];
  const document: Record<string, unknown> = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: bytes.byteLength, uri: dataUri(bytes) }],
    bufferViews: parts.map((part, i) => ({
      buffer: 0,
      byteOffset: offsets[i],
      byteLength: part.byteLength,
    })),
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
  edit?.(document);
  return document;
}

beforeEach(() => {
  resetDevWarnings();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("instantiateGltf: nodes and scenes", () => {
  it("builds the default scene, nodes, transforms, and names", async () => {
    const asset = await parse(
      triangleDocument((c) => {
        c["nodes"] = [
          {
            mesh: 0,
            name: "tri",
            translation: [1, 2, 3],
            rotation: [0, 0, 0.6, 0.8],
            scale: [2, 2, 2],
            children: [1],
          },
          { name: "empty" },
        ];
      }),
    );
    const instance = instantiateGltf(asset);
    expect(instance.scene).toBe(instance.scenes[0]);
    expect(instance.nodes).toHaveLength(2);
    const [tri, empty] = instance.nodes;
    expect(tri).toBeInstanceOf(Mesh);
    expect(tri.name).toBe("tri");
    expect(tri.transform.position.y).toBe(2);
    expect(tri.transform.rotation.w).toBe(0.8);
    expect(tri.transform.scale.x).toBe(2);
    expect(empty).toBeInstanceOf(Group);
    expect(empty.parent).toBe(tri);
    expect(tri.parent).toBe(instance.scene);
  });

  it("reports null when the file has no default scene", async () => {
    const asset = await parse(triangleDocument((c) => delete c["scene"]));
    expect(instantiateGltf(asset).scene).toBeNull();
  });

  it("decomposes a matrix-form node", async () => {
    const asset = await parse(
      triangleDocument((c) => {
        c["nodes"] = [
          {
            mesh: 0,
            matrix: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 5, 6, 7, 1],
          },
        ];
      }),
    );
    const [node] = instantiateGltf(asset).nodes;
    expect(node.transform.position.x).toBe(5);
    expect(node.transform.position.z).toBe(7);
    expect(node.transform.scale.y).toBeCloseTo(2, 12);
  });

  it("builds a Group with one Mesh child per primitive for a multi-primitive mesh", async () => {
    const asset = await parse(
      triangleDocument((c) => {
        const meshes = c["meshes"] as { primitives: unknown[] }[];
        const primitive = meshes[0].primitives[0];
        meshes[0].primitives = [primitive, primitive];
      }),
    );
    const [node] = instantiateGltf(asset).nodes;
    expect(node).toBeInstanceOf(Group);
    expect(node.children).toHaveLength(2);
    expect(node.children[0]).toBeInstanceOf(Mesh);
  });

  it("refuses a disposed asset (§83)", async () => {
    const asset = await parse(triangleDocument());
    asset.dispose();
    expect(() => instantiateGltf(asset)).toThrowError(/disposed/);
  });
});

describe("instantiateGltf: §78's sharing sentence", () => {
  it("shares geometry and clips across instantiations, never transforms or materials", async () => {
    const asset = await parse(skinnedDocument());
    const first = instantiateGltf(asset);
    const second = instantiateGltf(asset);

    const firstMesh = first.nodes[0] as Mesh<StandardMaterial>;
    const secondMesh = second.nodes[0] as Mesh<StandardMaterial>;
    // Immutable content is shared (one WeakMap entry per asset)…
    expect(firstMesh.geometry).toBe(secondMesh.geometry);
    expect(first.animations[0]).toBe(second.animations[0]);
    // …while transforms and materials are per-instance.
    expect(firstMesh.material).not.toBe(secondMesh.material);
    first.nodes[2].transform.position.x = 9;
    expect(second.nodes[2].transform.position.x).toBe(0);
  });
});

describe("instantiateGltf: materials and textures", () => {
  it("maps factors onto StandardMaterial and shares the default material within a call", async () => {
    const asset = await parse(
      triangleDocument((c) => {
        c["materials"] = [
          {
            alphaMode: "BLEND",
            emissiveFactor: [0.1, 0.2, 0.3],
            pbrMetallicRoughness: {
              baseColorFactor: [1, 0.5, 0.25, 0.5],
              metallicFactor: 0.75,
              roughnessFactor: 0.25,
            },
          },
        ];
        const meshes = c["meshes"] as {
          primitives: Record<string, unknown>[];
        }[];
        const withMaterial = { ...meshes[0].primitives[0], material: 0 };
        const bare = { ...meshes[0].primitives[0] };
        meshes[0].primitives = [withMaterial, bare, { ...bare }];
      }),
    );
    const instance = instantiateGltf(asset);
    const material = instance.materials[0];
    expect(material).toBeInstanceOf(StandardMaterial);
    expect([...material.baseColor]).toEqual([1, 0.5, 0.25, 0.5]);
    expect(material.metalness).toBe(0.75);
    expect(material.roughness).toBe(0.25);
    expect([...material.emissive]).toEqual([0.1, 0.2, 0.3]);
    expect(material.transparent).toBe(true);

    const group = instance.nodes[0];
    const meshes = group.children as Mesh<StandardMaterial>[];
    expect(meshes[0].material).toBe(material);
    // glTF's own default material: white, metallic 1, roughness 1 — one
    // instance per call, shared by every material-less primitive.
    expect(meshes[1].material.metalness).toBe(1);
    expect(meshes[1].material).toBe(meshes[2].material);
    expect(meshes[1].material).not.toBe(material);
  });

  it("wraps a decoded texture once per asset and hands it to map", async () => {
    const encoded = new Uint8Array([1, 1, 9, 9, 9, 255]);
    const document = triangleDocument((c) => {
      c["images"] = [{ uri: `data:image/png;base64,${b64(encoded)}` }];
      c["textures"] = [{ source: 0 }];
      c["materials"] = [
        { pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
      ];
      const meshes = c["meshes"] as {
        primitives: { material?: number }[];
      }[];
      meshes[0].primitives[0].material = 0;
    });
    const asset = await parse(document, (data) => {
      const bytes = new Uint8Array(data);
      return { width: bytes[0], height: bytes[1], data: bytes.slice(2) };
    });
    const first = instantiateGltf(asset);
    const second = instantiateGltf(asset);
    expect(first.materials[0].map).not.toBeNull();
    expect(first.materials[0].map).toBe(second.materials[0].map);
    expect(first.materials[0].map?.colorSpace).toBe("srgb");
  });

  it("hands a metallicRoughnessTexture to metalRoughnessMap as linear", async () => {
    const encoded = new Uint8Array([1, 1, 9, 9, 9, 255]);
    const document = triangleDocument((c) => {
      c["images"] = [{ uri: `data:image/png;base64,${b64(encoded)}` }];
      c["textures"] = [{ source: 0 }];
      c["materials"] = [
        { pbrMetallicRoughness: { metallicRoughnessTexture: { index: 0 } } },
      ];
      const meshes = c["meshes"] as {
        primitives: { material?: number }[];
      }[];
      meshes[0].primitives[0].material = 0;
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const asset = await parse(document, (data) => {
      const bytes = new Uint8Array(data);
      return { width: bytes[0], height: bytes[1], data: bytes.slice(2) };
    });
    warn.mockClear();
    const instance = instantiateGltf(asset);
    expect(instance.materials[0].metalRoughnessMap).not.toBeNull();
    expect(instance.materials[0].metalRoughnessMap?.colorSpace).toBe("linear");
    expect(instance.materials[0].map).toBeNull();
    expect(
      warn.mock.calls.map((call) => String(call[0])).join("\n"),
    ).not.toMatch(/metallicRoughnessTexture/);
    warn.mockRestore();
  });

  it("hands an emissiveTexture to emissiveMap as sRGB", async () => {
    const encoded = new Uint8Array([1, 1, 9, 9, 9, 255]);
    const document = triangleDocument((c) => {
      c["images"] = [{ uri: `data:image/png;base64,${b64(encoded)}` }];
      c["textures"] = [{ source: 0 }];
      c["materials"] = [{ emissiveTexture: { index: 0 } }];
      const meshes = c["meshes"] as {
        primitives: { material?: number }[];
      }[];
      meshes[0].primitives[0].material = 0;
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const asset = await parse(document, (data) => {
      const bytes = new Uint8Array(data);
      return { width: bytes[0], height: bytes[1], data: bytes.slice(2) };
    });
    warn.mockClear();
    const instance = instantiateGltf(asset);
    expect(instance.materials[0].emissiveMap).not.toBeNull();
    expect(instance.materials[0].emissiveMap?.colorSpace).toBe("srgb");
    expect(instance.materials[0].map).toBeNull();
    expect(
      warn.mock.calls.map((call) => String(call[0])).join("\n"),
    ).not.toMatch(/emissiveTexture/);
    warn.mockRestore();
  });

  it("hands linear normal and occlusion maps to the material", async () => {
    const encoded = new Uint8Array([1, 1, 128, 128, 255, 255]);
    const document = triangleDocument((c) => {
      c["images"] = [{ uri: `data:image/png;base64,${b64(encoded)}` }];
      c["textures"] = [{ source: 0 }];
      c["materials"] = [
        {
          normalTexture: { index: 0, scale: 0.5 },
          occlusionTexture: { index: 0, strength: 0.25 },
        },
      ];
    });
    const asset = await parse(document, (data) => {
      const bytes = new Uint8Array(data);
      return { width: bytes[0], height: bytes[1], data: bytes.slice(2) };
    });
    const instance = instantiateGltf(asset);
    expect(instance.materials[0].normalScale).toBe(0.5);
    expect(instance.materials[0].occlusionStrength).toBe(0.25);
    expect(instance.materials[0].normalMap?.colorSpace).toBe("linear");
    expect(instance.materials[0].occlusionMap).toBe(
      instance.materials[0].normalMap,
    );
  });
});

describe("instantiateGltf: skins (§54)", () => {
  it("builds Bones, one Skeleton per instantiation, and unculled skinned meshes", async () => {
    const asset = await parse(skinnedDocument());
    const instance = instantiateGltf(asset);
    const [column, root, elbow] = instance.nodes;
    expect(column).toBeInstanceOf(Mesh);
    expect(root).toBeInstanceOf(Bone);
    expect(elbow).toBeInstanceOf(Bone);
    expect(elbow.parent).toBe(root);

    const mesh = column as Mesh<StandardMaterial>;
    const skeleton = mesh.skeleton;
    expect(skeleton?.bones).toEqual([root, elbow]);
    expect(skeleton?.inverseBindMatrices[16 + 13]).toBe(-1);
    expect(mesh.frustumCulled).toBe(false);

    const second = instantiateGltf(asset);
    expect((second.nodes[0] as Mesh<StandardMaterial>).skeleton).not.toBe(
      skeleton,
    );
  });

  it("defaults missing inverse binds to the identity", async () => {
    const asset = await parse(
      skinnedDocument((c) => {
        const skins = c["skins"] as Record<string, unknown>[];
        delete skins[0]["inverseBindMatrices"];
      }),
    );
    const mesh = instantiateGltf(asset).nodes[0] as Mesh<StandardMaterial>;
    expect(mesh.skeleton?.inverseBindMatrices[0]).toBe(1);
    expect(mesh.skeleton?.inverseBindMatrices[16 + 13]).toBe(0);
  });

  it("hangs a joint node's mesh under the Bone", async () => {
    const asset = await parse(
      skinnedDocument((c) => {
        // The elbow joint itself carries the (unskinned) triangle mesh.
        const { bytes, offsets } = pack(TRI_POSITIONS, TRI_INDICES);
        (c["buffers"] as unknown[])[1] = {
          byteLength: bytes.byteLength,
          uri: dataUri(bytes),
        };
        (c["bufferViews"] as unknown[]).push(
          { buffer: 1, byteOffset: offsets[0], byteLength: 36 },
          { buffer: 1, byteOffset: offsets[1], byteLength: 6 },
        );
        (c["accessors"] as unknown[]).push(
          { bufferView: 7, componentType: 5126, count: 3, type: "VEC3" },
          { bufferView: 8, componentType: 5123, count: 3, type: "SCALAR" },
        );
        (c["meshes"] as unknown[]).push({
          primitives: [{ attributes: { POSITION: 7 }, indices: 8 }],
        });
        const nodes = c["nodes"] as Record<string, unknown>[];
        nodes[2]["mesh"] = 1;
      }),
    );
    const elbow = instantiateGltf(asset).nodes[2];
    expect(elbow).toBeInstanceOf(Bone);
    expect(elbow.children).toHaveLength(1);
    expect(elbow.children[0]).toBeInstanceOf(Mesh);
  });

  it("propagates the landed §62 joint-ceiling refusal for a 49-bone skin", async () => {
    const jointCount = 49;
    const nodes: Record<string, unknown>[] = [{ mesh: 0, skin: 0 }];
    for (let i = 0; i < jointCount; i += 1) {
      nodes.push({});
    }
    const asset = await parse(
      skinnedDocument((c) => {
        const skins = c["skins"] as Record<string, unknown>[];
        skins[0]["joints"] = Array.from(
          { length: jointCount },
          (_, i) => i + 1,
        );
        delete skins[0]["inverseBindMatrices"];
        c["nodes"] = nodes;
        c["scenes"] = [{ nodes: [0] }];
      }),
    );
    const error = (() => {
      try {
        instantiateGltf(asset);
        return undefined;
      } catch (thrown) {
        return thrown;
      }
    })();
    expect(isFourError(error)).toBe(true);
    if (isFourError(error)) {
      expect(error.code).toBe("UNSUPPORTED_GPU_FEATURE");
    }
  });
});

describe("instantiateGltf: animations (§17, RFC 0003)", () => {
  it("plays a loaded rotation clip onto the instance through the mixer", async () => {
    const asset = await parse(skinnedDocument());
    const instance = instantiateGltf(asset);
    expect(instance.animations[0].name).toBe("bend");

    const elbow = instance.nodes[2];
    const mixer = new AnimationMixer(instance);
    mixer.play(instance.animations[0]);
    mixer.advance(1);
    expect(elbow.transform.rotation.z).toBeCloseTo(Math.SQRT1_2, 5);
    expect(elbow.transform.rotation.w).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it("builds translation and scale tracks, and names unnamed clips by index", async () => {
    const asset = await parse(
      skinnedDocument((c) => {
        const animations = c["animations"] as Record<string, unknown>[];
        delete animations[0]["name"];
        // Reuse the VEC4 output shape for rotation, and add VEC3 channels
        // over a fresh sampler pair reusing the times accessor with the
        // positions accessor as output (4 keys? times has 2 — so build a
        // proper VEC3 output instead).
        const times = new Float32Array([0, 1]);
        const values = new Float32Array([0, 0, 0, 3, 0, 0]);
        const { bytes, offsets } = pack(times, values);
        (c["buffers"] as unknown[])[1] = {
          byteLength: bytes.byteLength,
          uri: dataUri(bytes),
        };
        (c["bufferViews"] as unknown[]).push(
          { buffer: 1, byteOffset: offsets[0], byteLength: times.byteLength },
          { buffer: 1, byteOffset: offsets[1], byteLength: values.byteLength },
        );
        (c["accessors"] as unknown[]).push(
          { bufferView: 7, componentType: 5126, count: 2, type: "SCALAR" },
          { bufferView: 8, componentType: 5126, count: 2, type: "VEC3" },
        );
        animations[0]["samplers"] = [
          { input: 5, output: 6, interpolation: "LINEAR" },
          { input: 7, output: 8, interpolation: "STEP" },
        ];
        animations[0]["channels"] = [
          { sampler: 0, target: { node: 2, path: "rotation" } },
          { sampler: 1, target: { node: 1, path: "translation" } },
          { sampler: 1, target: { node: 1, path: "scale" } },
        ];
      }),
    );
    const instance = instantiateGltf(asset);
    const clip = instance.animations[0];
    expect(clip.name).toBe("animation.0");
    expect(clip.tracks.map((track) => track.path)).toEqual([
      "nodes.2.transform.rotation",
      "nodes.1.transform.position",
      "nodes.1.transform.scale",
    ]);

    const mixer = new AnimationMixer(instance);
    mixer.play(clip);
    mixer.advance(1);
    expect(instance.nodes[1].transform.position.x).toBe(3);
    expect(instance.nodes[1].transform.scale.x).toBe(3);
  });
});

describe("instantiateGltf: one-target morph (RFC 0003 WP-SK.4)", () => {
  it("builds positions1 and attaches MorphWeights, preferring node weights", async () => {
    const deltas = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]);
    const { bytes, offsets } = pack(TRI_POSITIONS, TRI_INDICES, deltas);
    const asset = await parse({
      asset: { version: "2.0" },
      buffers: [{ byteLength: bytes.byteLength, uri: dataUri(bytes) }],
      bufferViews: [
        { buffer: 0, byteOffset: offsets[0], byteLength: 36 },
        { buffer: 0, byteOffset: offsets[1], byteLength: 6 },
        { buffer: 0, byteOffset: offsets[2], byteLength: 36 },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
        { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
        { bufferView: 2, componentType: 5126, count: 3, type: "VEC3" },
      ],
      meshes: [
        {
          weights: [0.5],
          primitives: [
            {
              attributes: { POSITION: 0 },
              indices: 1,
              targets: [{ POSITION: 2 }],
            },
          ],
        },
      ],
      nodes: [{ mesh: 0, weights: [0.25] }],
      scenes: [{ nodes: [0] }],
      scene: 0,
    });
    const mesh = instantiateGltf(asset).nodes[0] as Mesh;
    expect(Array.from(mesh.geometry.positions1 ?? [])).toEqual([
      0, 1, 0, 1, 1, 0, 0, 2, 0,
    ]);
    const weights = mesh.getComponent(MorphWeights);
    expect(weights).toBeDefined();
    expect(Array.from(weights!.weights)).toEqual([0.25]);
    expect(mesh.morphTargetWeights).toBe(weights!.weights);
  });
});
