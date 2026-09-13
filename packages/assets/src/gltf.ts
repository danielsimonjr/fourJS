/**
 * The §78 glTF 2.0 loader — the **parse tier** (A-19's last half, 2026-08-29).
 *
 * ```ts
 * const gltfLoader = createGltfLoader({
 *   fetch,                          // the manager's own transport, for .bin
 *   decodeTexture: decodePng,       // the createTextureLoader seam, reused
 * });
 * const asset = await assets.load("/models/robot.glb", gltfLoader);
 * // …assembly into live nodes is `four`'s `instantiateGltf(asset)` (§3.1).
 * ```
 *
 * ## The tier, stated against §78's full promise
 *
 * §78 asks for geometry, materials, textures, skins, morph targets,
 * animations, cameras, lights extensions, compression extensions, and user
 * metadata. This module ships **glTF 2.0 core** at the tier the engine can
 * honestly carry today:
 *
 * - **Containers**: `.gltf` JSON and the GLB binary container; buffers from
 *   the GLB `BIN` chunk, base64 `data:` URIs, and external URIs through an
 *   {@link FetchLike} — the injected one, or `globalThis.fetch` when none is
 *   passed, the same default {@link AssetManager} makes (WP-11.2). A runtime
 *   with no transport at all still refuses loudly: presence is still the
 *   capability, the loader just looks for one before giving up.
 * - **Geometry**: every attribute the engine's geometry layer has — positions,
 *   normals, uvs, colors, joints, weights — plus indices, `triangles` and
 *   `lines` modes, interleaved and strided accessors.
 * - **Materials**: §59's metallic-roughness tier — base colour factor and
 *   texture, metallic/roughness factors, packed `metallicRoughnessTexture`
 *   (linear), emissive factor, `OPAQUE`/`BLEND`. Packed MR and emissive
 *   textures are decoded and assigned; remaining unstaged slots
 *   (`normalTexture`, `occlusionTexture`) decode as linear data and carry
 *   their normal scale / occlusion strength through instantiation.
 *   WebGL samples the packed map (unit 2) and the emissive map (unit 3);
 *   WebGPU samples the packed map and still shades emissive from the factor
 *   alone (four-group budget when albedo and MR occupy groups 2 and 3).
 * - **Textures**: decoded through {@link createTextureLoader}'s injected
 *   seam with its §96 decompression bounds, tagged `srgb` for colour maps
 *   and `linear` for the packed metallic-roughness map, rows flipped to
 *   §7a's bottom-first order; uvs are converted (`v → 1 − v`) in the same
 *   pass, so a loaded model samples exactly what its author painted.
 * - **Skins**: joints, inverse bind matrices (glTF's +Y-bone authoring
 *   convention is absorbed by the inverse binds — RFC 0003 — so no axis
 *   conversion happens anywhere). The §62 48-joint ceiling is **not**
 *   re-declared here: `Mesh.skeleton`'s landed refusal fires at instantiation,
 *   where the constant lives.
 * - **Animations**: `translation`/`rotation`/`scale` channels with `LINEAR`
 *   and `STEP` samplers, parsed into per-channel keyframe arrays that
 *   `instantiateGltf` binds through RFC 0003's indexed-array forms
 *   (`nodes.<i>.transform.<channel>`).
 * - **User metadata**: `extras` on the document, nodes, meshes, and materials,
 *   detached via `cloneJsonValue`.
 *
 * **Refused, loudly and by name** (§85, §96 — retrying cannot fix a file):
 * any `extensionsRequired` entry (Draco and every other compression extension
 * arrives as one), sparse accessors, morph targets (`primitive.targets`,
 * `mesh.weights`, `node.weights`, `weights` animation channels — the GPU
 * morph path is staged, and loading weights that deform nothing would draw
 * the wrong picture), `CUBICSPLINE` samplers, `MASK` alpha (no cutoff in the
 * material tier), point/strip/fan primitive modes, `TEXCOORD_1`-indexed
 * texture slots, accessors without a buffer view, and non-base64 `data:`
 * URIs.
 *
 * **Ignored with a record** (content whose absence cannot corrupt the
 * picture; each is pushed into {@link GltfAsset.ignored} and §85-warned
 * once): cameras, `extensionsUsed`-only extensions, unrecognized vertex
 * attributes (`TANGENT`, `TEXCOOORD_1`, second sets), mip-selecting
 * `minFilter` values, and a `wrapT` differing from `wrapS` (the texture tier
 * carries one wrap mode).
 *
 * ## §96: a glTF file is exactly the untrusted input this section exists for
 *
 * Every byte offset is checked against the container it indexes before it is
 * read: GLB chunks against the declared and actual lengths, buffer views
 * against buffers, accessors against buffer views (stride included), indices
 * against vertex counts, joints against their skin's joint list, and every
 * cross-reference (node children, meshes, skins, materials, textures, images,
 * samplers, scenes, animation targets) against its array. Subresources —
 * external buffers, embedded base64, decoded images — are bounded by
 * {@link GltfLoaderOptions.maximumBytes} and the texture tier's §96
 * decompression bounds **before** allocation wherever a size is declared.
 * Every float that can reach a transform — node TRS and matrices, inverse
 * bind matrices, animation times and values, and every decoded vertex
 * attribute — is validated finite (§85: no NaN, no Infinity). The JSON body
 * goes through `parseUntrustedJson`'s depth and length guards before any
 * recursive consumer sees it.
 *
 * ## Determinism (§33)
 *
 * Parsing is a pure function of the input bytes: every walk follows the
 * file's own arrays by index, object-key scans follow JSON insertion order
 * (the document's own order), accessor reads are explicit little-endian
 * `DataView` arithmetic, and nothing consults a clock, a `Map` iteration, or
 * the platform's endianness. Same bytes, same asset — byte-identical typed
 * arrays included.
 *
 * ## Why this package cannot assemble a scene (§3.1)
 *
 * `@fourjs/assets` depends on `core` alone (the frozen matrix), so a `Mesh`, a
 * `Skeleton`, a `StandardMaterial`, and an `AnimationClip` are all names it
 * must not know. The parse tier therefore produces **plain validated data**
 * — typed arrays and records — and the umbrella package, which sees
 * everything, owns `instantiateGltf` (the `TextureAsset`/`TextureSource`
 * precedent, one level up: data below the seam, assembly above it).
 */

import { assertImageDecoderMemory } from "./image-memory.js";

import {
  FourError,
  cloneJsonValue,
  devWarnOnce,
  isFourError,
  parseUntrustedJson,
  type Disposable,
  type JsonValue,
} from "@fourjs/core";

import {
  DEFAULT_MAXIMUM_BYTES,
  resolveGlobalFetch,
  type AssetLoader,
  type FetchLike,
  type FetchResponse,
} from "./asset-manager.js";
import {
  resolveGlobalTextDecoder,
  type TextDecodeLike,
} from "./content-hash.js";
import {
  createTextureDecoder,
  type TexelDecodeLike,
  type TexelProbeLike,
  type TextureAsset,
  type TextureFilterMode,
  type TextureWrapMode,
} from "./texture.js";

/** GLB header magic — `"glTF"` read as a little-endian `u32`. */
const GLB_MAGIC = 0x46546c67;

/** GLB chunk type `"JSON"`. */
const CHUNK_JSON = 0x4e4f534a;

/** GLB chunk type `"BIN\0"`. */
const CHUNK_BIN = 0x004e4942;

/** glTF component types, by their GL enum values. */
const COMPONENT_BYTES: Readonly<Record<number, number>> = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
};

/** Components per accessor element, by glTF `type`. */
const TYPE_COMPONENTS: Readonly<Record<string, number>> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

/**
 * How a primitive's vertices assemble — the two modes the geometry layer
 * draws (§53). glTF's other five modes are refused by name.
 */
export type GltfPrimitiveMode = "triangles" | "lines";

/** An animation channel's target transform channel (§17). */
export type GltfChannelPath = "translation" | "rotation" | "scale";

/** One primitive's decoded vertex streams, in the geometry layer's layout. */
export interface GltfPrimitiveRecord {
  /** Vertex positions, xyz triplets — finite (§85, §96). */
  readonly positions: Float32Array;
  /** Optional normals, xyz triplets, index-aligned with positions. */
  readonly normals?: Float32Array;
  /**
   * Optional texture coordinates, uv pairs, **already converted to §7a's
   * bottom-up `v`** (`v → 1 − v`), matching the row flip the texture tier
   * performs — see the module header.
   */
  readonly uvs?: Float32Array;
  /** Optional straight RGBA colors, 4 floats per vertex (VEC3 gains alpha 1). */
  readonly colors?: Float32Array;
  /** Optional joint indices, 4 per vertex, validated against the skin. */
  readonly joints?: Uint16Array;
  /** Optional joint weights, 4 per vertex, index-parallel with `joints`. */
  readonly weights?: Float32Array;
  /** Optional indices, each validated `< vertexCount` (§96). */
  readonly indices?: Uint16Array | Uint32Array;
  /** Primitive assembly. */
  readonly mode: GltfPrimitiveMode;
  /** Index into {@link GltfAsset.materials}, or `null` for the default. */
  readonly material: number | null;
}

/** One glTF mesh: a name and its primitives. */
export interface GltfMeshRecord {
  /** The mesh's authored name, or `""`. */
  readonly name: string;
  /** The mesh's primitives, in file order; never empty. */
  readonly primitives: readonly GltfPrimitiveRecord[];
  /** §78 user metadata (`extras`), detached from the parsed document. */
  readonly extras?: JsonValue;
}

/**
 * One glTF material at §59's metallic-roughness tier.
 *
 * Factors carry **glTF's own defaults** (`metalness` and `roughness` default
 * to `1`, unlike `StandardMaterial`'s constructor defaults) so the record
 * means what the file meant; instantiation passes every value explicitly.
 */
export interface GltfMaterialRecord {
  /** The material's authored name, or `""`. */
  readonly name: string;
  /** Base colour factor, straight RGBA, finite. */
  readonly baseColor: readonly [number, number, number, number];
  /** Metallic factor; glTF's default is `1`. */
  readonly metalness: number;
  /** Roughness factor; glTF's default is `1`. */
  readonly roughness: number;
  /** Emissive factor, RGB, finite. */
  readonly emissive: readonly [number, number, number];
  /** Index into {@link GltfAsset.textures}, or `null` for no base map. */
  readonly baseColorTexture: number | null;
  /** Packed metallic-roughness map index, or `null`. Decoded linear. */
  readonly metallicRoughnessTexture: number | null;
  /** Emissive map index, or `null`. Decoded sRGB. */
  readonly emissiveTexture: number | null;
  /** Linear normal map index. */
  readonly normalTexture: number | null;
  readonly normalScale: number;
  /** Linear ambient occlusion map index. */
  readonly occlusionTexture: number | null;
  readonly occlusionStrength: number;
  /** Whether `alphaMode` was `"BLEND"`. */
  readonly transparent: boolean;
  /**
   * Whether the file declared the material double-sided. Recorded only: the
   * WebGL tier draws with face culling disabled, so single-sided intent is a
   * documented divergence, not a switch.
   */
  readonly doubleSided: boolean;
  /**
   * Texture slots the file carries but this tier cannot sample
   * for future extensions. All five core metallic-roughness texture slots
   * are decoded; rendering support remains backend-dependent.
   */
  readonly ignoredTextures: readonly string[];
  /** §78 user metadata (`extras`). */
  readonly extras?: JsonValue;
}

/** One glTF node — the transform either as TRS or as a raw matrix. */
export interface GltfNodeRecord {
  /** The node's authored name, or `""`. */
  readonly name: string;
  /** Child node indices, in file order; each child has exactly one parent. */
  readonly children: readonly number[];
  /** Translation, finite; `[0, 0, 0]` unless authored. */
  readonly translation: readonly [number, number, number];
  /** Rotation quaternion xyzw, finite; identity unless authored. */
  readonly rotation: readonly [number, number, number, number];
  /** Scale, finite; `[1, 1, 1]` unless authored. */
  readonly scale: readonly [number, number, number];
  /**
   * The node's column-major matrix, when the file used the matrix form —
   * mutually exclusive with authored TRS (refused otherwise). Decomposed at
   * instantiation, where `@fourjs/math` is visible.
   */
  readonly matrix: Float32Array | null;
  /** Index into {@link GltfAsset.meshes}, or `null`. */
  readonly mesh: number | null;
  /** Index into {@link GltfAsset.skins}, or `null`. */
  readonly skin: number | null;
  /** §78 user metadata (`extras`). */
  readonly extras?: JsonValue;
}

/** One glTF scene: its root node indices. */
export interface GltfSceneRecord {
  /** The scene's authored name, or `""`. */
  readonly name: string;
  /** Root node indices, in file order; each is validated parentless. */
  readonly nodes: readonly number[];
}

/** One glTF skin, as data — bones are assembled at instantiation. */
export interface GltfSkinRecord {
  /** The skin's authored name, or `""`. */
  readonly name: string;
  /** Joint node indices, in file order — the joint index is the position. */
  readonly joints: readonly number[];
  /**
   * One column-major inverse bind matrix per joint (16 floats each, finite),
   * or `null` for the identity default. glTF's bone-axis convention is
   * absorbed here (RFC 0003): no conversion is applied, none is needed.
   */
  readonly inverseBindMatrices: Float32Array | null;
}

/** One animation channel: a keyframe run targeting one node's transform. */
export interface GltfChannelRecord {
  /** Target node index. */
  readonly node: number;
  /** Which transform channel the keyframes drive. */
  readonly path: GltfChannelPath;
  /** Sampler interpolation, in the engine's §17 spelling. */
  readonly interpolation: "linear" | "step";
  /** Keyframe times in seconds — finite, strictly increasing (§85). */
  readonly times: Float32Array;
  /**
   * Keyframe values, tightly packed — 3 floats per key for
   * `translation`/`scale`, 4 for `rotation`. Finite (§96).
   */
  readonly values: Float32Array;
}

/** One glTF animation: a name and its channels. */
export interface GltfAnimationRecord {
  /** The animation's authored name, or `""`. */
  readonly name: string;
  /** The animation's channels, in file order; never empty. */
  readonly channels: readonly GltfChannelRecord[];
}

/** Construction options for {@link createGltfLoader}. */
export interface GltfLoaderOptions {
  /**
   * Transport for **external** buffer and image URIs (`.bin` files, image
   * files), resolved against the asset's own URL — the same {@link FetchLike}
   * seam the `AssetManager` uses, and typically the very same function.
   *
   * **Presence is the capability**: without it, embedded content (GLB `BIN`
   * chunks, base64 `data:` URIs) loads exactly as with it, and a document
   * naming an external URI is refused loudly at the reference — a model with
   * a missing buffer is not a model with fewer vertices.
   */
  readonly fetch?: FetchLike;
  /**
   * The image decoder for base-colour textures — {@link createTextureLoader}'s
   * own seam, injected for its reason (this package names no `Blob`, no
   * `ImageBitmap`, no canvas).
   *
   * **Presence is the capability, and the failure is a refusal**: a document
   * whose materials sample a base-colour texture cannot load without a
   * decoder — a silently untextured model is the wrong picture. Documents
   * that use no textures need none.
   */
  readonly decodeTexture?: TexelDecodeLike;
  /** Optional header probe, forwarded to the texture tier (§96 pre-checks). */
  readonly probeTexture?: TexelProbeLike;
  /**
   * §96 size bound for each **subresource** this loader fetches or decodes
   * itself — an external buffer, a base64 payload. Defaults to
   * {@link DEFAULT_MAXIMUM_BYTES}. The glTF body itself is bounded by the
   * `AssetManager` that fetched it.
   */
  readonly maximumBytes?: number;
  /** §96 decoded-texture bound, forwarded to {@link createTextureLoader}. */
  readonly maximumDecodedBytes?: number;
  /** §96 expansion-ratio bound, forwarded to {@link createTextureLoader}. */
  readonly maximumExpansionRatio?: number;
  /** Require a bounded image decoder; forwarded to the texture tier (§96). */
  readonly maximumWorkingBytes?: number;
  /**
   * UTF-8 decoder for `.gltf` bodies and GLB JSON chunks. Defaults to
   * `globalThis.TextDecoder`; refused loudly when neither exists.
   */
  readonly decodeText?: TextDecodeLike;
  /** Diagnostics label used in error `context.loader`. Defaults to `"gltf"`. */
  readonly name?: string;
}

/**
 * A parsed, validated glTF document — plain data plus decoded textures, with
 * an explicit lifetime (§83).
 *
 * Everything in it is a pure function of the input bytes (§33). Assembly
 * into scene nodes is `four`'s `instantiateGltf`; an assets-only consumer may
 * read the records directly.
 */
export class GltfAsset implements Disposable {
  /** The URL the asset was loaded from — diagnostics and warning keys. */
  readonly url: string;

  /** The meshes, in file order. */
  readonly meshes: readonly GltfMeshRecord[];

  /** The materials, in file order. */
  readonly materials: readonly GltfMaterialRecord[];

  /**
   * Decoded base-colour textures, index-aligned with the file's `textures`
   * array; `null` for entries no supported material slot references (they are
   * validated, never decoded).
   */
  readonly textures: readonly (TextureAsset | null)[];

  /** The nodes, in file order — the index is the animation-binding ABI. */
  readonly nodes: readonly GltfNodeRecord[];

  /** The scenes, in file order. */
  readonly scenes: readonly GltfSceneRecord[];

  /** Index of the file's default scene, or `null`. */
  readonly defaultScene: number | null;

  /** The skins, in file order. */
  readonly skins: readonly GltfSkinRecord[];

  /** The animations, in file order. */
  readonly animations: readonly GltfAnimationRecord[];

  /**
   * What the file carried that this tier deliberately does not: one entry per
   * ignored feature, in parse order (§85-warned once each at parse). Empty
   * for a file entirely inside the tier.
   */
  readonly ignored: readonly string[];

  /** §78 user metadata: the document's own `extras`, when present. */
  readonly extras?: JsonValue;

  #disposed = false;

  /** Built by the loader; applications never construct one. */
  constructor(fields: {
    url: string;
    meshes: readonly GltfMeshRecord[];
    materials: readonly GltfMaterialRecord[];
    textures: readonly (TextureAsset | null)[];
    nodes: readonly GltfNodeRecord[];
    scenes: readonly GltfSceneRecord[];
    defaultScene: number | null;
    skins: readonly GltfSkinRecord[];
    animations: readonly GltfAnimationRecord[];
    ignored: readonly string[];
    extras?: JsonValue;
  }) {
    this.url = fields.url;
    this.meshes = fields.meshes;
    this.materials = fields.materials;
    this.textures = fields.textures;
    this.nodes = fields.nodes;
    this.scenes = fields.scenes;
    this.defaultScene = fields.defaultScene;
    this.skins = fields.skins;
    this.animations = fields.animations;
    this.ignored = fields.ignored;
    if (fields.extras !== undefined) {
      this.extras = fields.extras;
    }
  }

  /** Whether {@link dispose} has run. */
  get isDisposed(): boolean {
    return this.#disposed;
  }

  /**
   * Disposes every decoded {@link TextureAsset} (§83). Idempotent. The plain
   * records stay readable — they are data, and dropping them would only turn
   * a use-after-dispose into a `TypeError` instead of a legible empty read.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const texture of this.textures) {
      texture?.dispose();
    }
  }
}

/** Throws this loader's §85-precise refusal (§96: never accept malformed data). */
function refuse(
  url: string,
  where: string,
  message: string,
  context: Record<string, unknown> = {},
): never {
  throw new FourError(
    "ASSET_LOAD_FAILED",
    `Cannot load glTF "${url}": ${where}: ${message}`,
    { context: { url, where, ...context } },
  );
}

/** Narrows to a JSON object, refusing anything else. */
function asObject(
  value: unknown,
  url: string,
  where: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    refuse(url, where, "expected an object.");
  }
  return value as Record<string, unknown>;
}

/** `Array.isArray`, typed to `unknown[]` rather than `any[]`. */
const isUnknownArray = (value: unknown): value is readonly unknown[] =>
  Array.isArray(value);

/** Narrows to a JSON array, refusing anything else. */
function asArray(
  value: unknown,
  url: string,
  where: string,
): readonly unknown[] {
  if (!isUnknownArray(value)) {
    refuse(url, where, "expected an array.");
  }
  return value;
}

/** An optional top-level collection: absent means empty. */
function collection(
  document: Record<string, unknown>,
  key: string,
  url: string,
): readonly unknown[] {
  const value = document[key];
  return value === undefined ? [] : asArray(value, url, key);
}

/** Reads an optional string field, defaulting to `""`. */
function nameOf(
  record: Record<string, unknown>,
  url: string,
  where: string,
): string {
  const value = record["name"];
  if (value === undefined) {
    return "";
  }
  if (typeof value !== "string") {
    refuse(url, `${where}.name`, "expected a string.");
  }
  return value;
}

/** Reads a required non-negative integer index below `length`. */
function requiredIndex(
  value: unknown,
  length: number,
  url: string,
  where: string,
): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    refuse(url, where, "expected a non-negative integer index.", {
      found: value,
    });
  }
  if (value >= length) {
    refuse(
      url,
      where,
      `index ${String(value)} is out of range (the array has ${String(length)} entries; §96 bounds checking).`,
      { found: value, length },
    );
  }
  return value;
}

/** Reads an optional index field below `length`, or `null` when absent. */
function optionalIndex(
  record: Record<string, unknown>,
  key: string,
  length: number,
  url: string,
  where: string,
): number | null {
  const value = record[key];
  if (value === undefined) {
    return null;
  }
  return requiredIndex(value, length, url, `${where}.${key}`);
}

/** Reads an optional finite number, defaulting. */
function optionalNumber(
  record: Record<string, unknown>,
  key: string,
  fallback: number,
  url: string,
  where: string,
): number {
  const value = record[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    refuse(url, `${where}.${key}`, "expected a finite number (§85).", {
      found: value,
    });
  }
  return value;
}

/** Reads an optional fixed-length finite-number tuple, defaulting. */
function optionalTuple(
  record: Record<string, unknown>,
  key: string,
  length: number,
  fallback: readonly number[],
  url: string,
  where: string,
): readonly number[] {
  const value = record[key];
  if (value === undefined) {
    return fallback;
  }
  const array = asArray(value, url, `${where}.${key}`);
  if (array.length !== length) {
    refuse(
      url,
      `${where}.${key}`,
      `expected ${String(length)} numbers; got ${String(array.length)}.`,
    );
  }
  const numbers: number[] = [];
  for (let i = 0; i < array.length; i += 1) {
    const entry = array[i];
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      refuse(
        url,
        `${where}.${key}[${String(i)}]`,
        "expected a finite number (§85: NaN and infinite values).",
        { found: entry },
      );
    }
    numbers.push(entry);
  }
  return numbers;
}

/** Detaches an `extras` field as engine-owned JSON, when one exists (§78). */
function extrasOf(record: Record<string, unknown>): JsonValue | undefined {
  const value = record["extras"];
  if (value === undefined) {
    return undefined;
  }
  // The value came out of `JSON.parse`, so it is a `JsonValue` by
  // construction; the clone detaches it from the parse tree.
  return cloneJsonValue(value);
}

/** The base64 alphabet, decoded per character code; -1 marks a non-member. */
const BASE64_CODES: Int8Array = (() => {
  const codes = new Int8Array(128).fill(-1);
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < alphabet.length; i += 1) {
    codes[alphabet.charCodeAt(i)] = i;
  }
  return codes;
})();

/**
 * Decodes standard base64 — hand-rolled because `atob` is a web global this
 * package must not name, and because the §96 bound must be checked against
 * the *declared* output size before the output is allocated.
 */
function decodeBase64(
  text: string,
  maximumBytes: number,
  url: string,
  where: string,
): Uint8Array {
  if (text.length % 4 !== 0) {
    refuse(url, where, "base64 payload length is not a multiple of 4.", {
      length: text.length,
    });
  }
  let padding = 0;
  if (text.endsWith("==")) {
    padding = 2;
  } else if (text.endsWith("=")) {
    padding = 1;
  }
  const byteLength = (text.length / 4) * 3 - padding;
  if (byteLength > maximumBytes) {
    refuse(
      url,
      where,
      `base64 payload decodes to ${String(byteLength)} bytes, over the ${String(maximumBytes)}-byte limit (§96).`,
      { limitName: "maximumBytes", limit: maximumBytes, observed: byteLength },
    );
  }
  const bytes = new Uint8Array(byteLength);
  let out = 0;
  const dataLength = text.length - padding;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < dataLength; i += 1) {
    const charCode = text.charCodeAt(i);
    const code = charCode < 128 ? BASE64_CODES[charCode] : -1;
    if (code < 0) {
      refuse(url, where, "base64 payload carries an invalid character.", {
        index: i,
      });
    }
    buffer = (buffer << 6) | code;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (out < byteLength) {
        bytes[out] = (buffer >> bits) & 0xff;
        out += 1;
      }
    }
  }
  return bytes;
}

/**
 * Resolves a glTF URI against the asset's URL — lexically, with `.` and `..`
 * segments normalized, because this package names no `URL` global and a §33
 * loader should resolve identically everywhere.
 */
function resolveUri(baseUrl: string, uri: string): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(uri) || uri.startsWith("/")) {
    return uri;
  }
  const slash = baseUrl.lastIndexOf("/");
  const base = slash === -1 ? "" : baseUrl.slice(0, slash + 1);
  const segments: string[] = [];
  for (const segment of (base + uri).split("/")) {
    if (segment === "" && segments.length === 0) {
      segments.push("");
    } else if (segment === ".") {
      // The current directory: contributes nothing.
    } else if (segment === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") {
        segments.pop();
      } else {
        segments.push("..");
      }
    } else if (segment !== "") {
      segments.push(segment);
    }
  }
  return segments.join("/");
}

/** A parsed GLB container: the JSON chunk's bytes and the optional BIN chunk. */
interface GlbChunks {
  readonly json: Uint8Array;
  readonly binary: Uint8Array | null;
  readonly unknownChunks: number;
}

/** Parses the GLB container, refusing every malformed shape by name (§96). */
function parseGlbContainer(bytes: Uint8Array, url: string): GlbChunks {
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20) {
    refuse(
      url,
      "glb",
      "truncated: a GLB needs a 12-byte header and at least one chunk.",
      {
        byteLength: bytes.byteLength,
      },
    );
  }
  const version = header.getUint32(4, true);
  if (version !== 2) {
    refuse(url, "glb", `container version ${String(version)} is not 2.`, {
      version,
    });
  }
  const declaredLength = header.getUint32(8, true);
  if (declaredLength < 20 || declaredLength > bytes.byteLength) {
    refuse(
      url,
      "glb",
      `declared length ${String(declaredLength)} does not fit the ${String(bytes.byteLength)} bytes received (§96 bounds checking).`,
      { declaredLength, byteLength: bytes.byteLength },
    );
  }

  let json: Uint8Array | null = null;
  let binary: Uint8Array | null = null;
  let unknownChunks = 0;
  let offset = 12;
  while (offset < declaredLength) {
    if (offset + 8 > declaredLength) {
      refuse(url, "glb", "trailing bytes after the last chunk.", { offset });
    }
    const chunkLength = header.getUint32(offset, true);
    const chunkType = header.getUint32(offset + 4, true);
    if (chunkLength % 4 !== 0) {
      refuse(
        url,
        "glb",
        `chunk at offset ${String(offset)} has unaligned length ${String(chunkLength)} (GLB chunks are 4-byte aligned).`,
        { offset, chunkLength },
      );
    }
    if (offset + 8 + chunkLength > declaredLength) {
      refuse(
        url,
        "glb",
        `chunk at offset ${String(offset)} overruns the container (§96 bounds checking).`,
        { offset, chunkLength, declaredLength },
      );
    }
    const chunk = bytes.subarray(offset + 8, offset + 8 + chunkLength);
    if (chunkType === CHUNK_JSON) {
      if (json !== null) {
        refuse(url, "glb", "a second JSON chunk is not a GLB.", { offset });
      }
      json = chunk;
    } else if (chunkType === CHUNK_BIN) {
      if (json === null) {
        refuse(url, "glb", "the first chunk must be JSON.", { offset });
      }
      if (binary !== null) {
        refuse(url, "glb", "a second BIN chunk is not a GLB.", { offset });
      }
      binary = chunk;
    } else {
      // The GLB spec says readers should ignore unknown chunk types.
      unknownChunks += 1;
    }
    offset += 8 + chunkLength;
  }
  if (json === null) {
    refuse(url, "glb", "no JSON chunk.");
  }
  return { json, binary, unknownChunks };
}

/** A structural buffer-view record, bounds-checked against its buffer. */
interface ViewRecord {
  readonly bytes: Uint8Array;
  readonly byteStride: number | null;
}

/** A structural accessor record, bounds-checked lazily per read. */
interface AccessorRecord {
  readonly view: number;
  readonly byteOffset: number;
  readonly componentType: number;
  readonly count: number;
  readonly type: string;
  readonly normalized: boolean;
}

/** Which normalized integer component types a float read may accept. */
type NormalizedPolicy = "none" | "unsigned" | "all";

/**
 * Everything the per-document parse shares: the validated pools plus the
 * options, so helper signatures stay legible.
 */
interface ParseContext {
  readonly url: string;
  readonly views: readonly ViewRecord[];
  readonly accessors: readonly AccessorRecord[];
  readonly ignored: string[];
}

/** Records an ignored feature once, in parse order, and §85-warns once. */
function ignore(context: ParseContext, what: string): void {
  context.ignored.push(what);
  devWarnOnce(
    `gltf:${context.url}:${what}`,
    `glTF "${context.url}": ${what} — outside the §78 tier, ignored (§85).`,
  );
}

/**
 * Reads one accessor as converted floats — explicit little-endian
 * `DataView` arithmetic (§33), every value validated finite (§85, §96).
 */
function readFloats(
  context: ParseContext,
  accessorIndex: number,
  expectedTypes: readonly string[],
  normalizedPolicy: NormalizedPolicy,
  where: string,
): Float32Array {
  const { url } = context;
  const accessor = context.accessors[accessorIndex];
  if (!expectedTypes.includes(accessor.type)) {
    refuse(
      url,
      where,
      `accessor ${String(accessorIndex)} has type ${accessor.type}; expected ${expectedTypes.join(" or ")}.`,
      { accessor: accessorIndex, type: accessor.type },
    );
  }
  const componentType = accessor.componentType;
  let scale = 0;
  if (componentType !== 5126) {
    const unsigned = componentType === 5121 || componentType === 5123;
    const signed = componentType === 5120 || componentType === 5122;
    const allowed =
      accessor.normalized &&
      ((unsigned && normalizedPolicy !== "none") ||
        (signed && normalizedPolicy === "all"));
    if (!allowed) {
      refuse(
        url,
        where,
        `accessor ${String(accessorIndex)} has component type ${String(componentType)}` +
          `${accessor.normalized ? " (normalized)" : ""}; this use accepts FLOAT` +
          `${normalizedPolicy === "none" ? "" : " or normalized integers"}.`,
        { accessor: accessorIndex, componentType },
      );
    }
    scale =
      componentType === 5121
        ? 1 / 255
        : componentType === 5123
          ? 1 / 65535
          : componentType === 5120
            ? 1 / 127
            : 1 / 32767;
  }

  const components = TYPE_COMPONENTS[accessor.type];
  const componentBytes = COMPONENT_BYTES[componentType];
  const view = context.views[accessor.view];
  const elementBytes = components * componentBytes;
  const stride = view.byteStride ?? elementBytes;
  boundAccessor(context, accessor, accessorIndex, stride, elementBytes, where);

  const data = view.bytes;
  const reader = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out = new Float32Array(accessor.count * components);
  for (let element = 0; element < accessor.count; element += 1) {
    const base = accessor.byteOffset + element * stride;
    for (let component = 0; component < components; component += 1) {
      const offset = base + component * componentBytes;
      let value: number;
      if (componentType === 5126) {
        value = reader.getFloat32(offset, true);
        if (!Number.isFinite(value)) {
          refuse(
            url,
            where,
            `accessor ${String(accessorIndex)} carries a non-finite float at element ${String(element)} (§85, §96: NaN and infinite values).`,
            { accessor: accessorIndex, element },
          );
        }
      } else if (componentType === 5121) {
        value = reader.getUint8(offset) * scale;
      } else if (componentType === 5123) {
        value = reader.getUint16(offset, true) * scale;
      } else if (componentType === 5120) {
        value = Math.max(reader.getInt8(offset) * scale, -1);
      } else {
        value = Math.max(reader.getInt16(offset, true) * scale, -1);
      }
      out[element * components + component] = value;
    }
  }
  return out;
}

/** Reads a `JOINTS_0` accessor: VEC4 of unsigned bytes or shorts (§54). */
function readJoints(
  context: ParseContext,
  accessorIndex: number,
  where: string,
): Uint16Array {
  const { url } = context;
  const accessor = context.accessors[accessorIndex];
  if (accessor.type !== "VEC4") {
    refuse(url, where, `joints accessor must be VEC4; got ${accessor.type}.`, {
      accessor: accessorIndex,
    });
  }
  const componentType = accessor.componentType;
  if (componentType !== 5121 && componentType !== 5123) {
    refuse(
      url,
      where,
      `joints accessor must be UNSIGNED_BYTE or UNSIGNED_SHORT; got component type ${String(componentType)}.`,
      { accessor: accessorIndex, componentType },
    );
  }
  const componentBytes = COMPONENT_BYTES[componentType];
  const view = context.views[accessor.view];
  const elementBytes = 4 * componentBytes;
  const stride = view.byteStride ?? elementBytes;
  boundAccessor(context, accessor, accessorIndex, stride, elementBytes, where);

  const data = view.bytes;
  const reader = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out = new Uint16Array(accessor.count * 4);
  for (let element = 0; element < accessor.count; element += 1) {
    const base = accessor.byteOffset + element * stride;
    for (let component = 0; component < 4; component += 1) {
      const offset = base + component * componentBytes;
      out[element * 4 + component] =
        componentType === 5121
          ? reader.getUint8(offset)
          : reader.getUint16(offset, true);
    }
  }
  return out;
}

/** Reads an index accessor, range-checking every entry (§96, §85). */
function readIndices(
  context: ParseContext,
  accessorIndex: number,
  vertexCount: number,
  where: string,
): Uint16Array | Uint32Array {
  const { url } = context;
  const accessor = context.accessors[accessorIndex];
  if (accessor.type !== "SCALAR") {
    refuse(
      url,
      where,
      `indices accessor must be SCALAR; got ${accessor.type}.`,
      {
        accessor: accessorIndex,
      },
    );
  }
  const componentType = accessor.componentType;
  if (
    componentType !== 5121 &&
    componentType !== 5123 &&
    componentType !== 5125
  ) {
    refuse(
      url,
      where,
      `indices accessor must be UNSIGNED_BYTE, UNSIGNED_SHORT, or UNSIGNED_INT; got component type ${String(componentType)}.`,
      { accessor: accessorIndex, componentType },
    );
  }
  const view = context.views[accessor.view];
  if (view.byteStride !== null) {
    refuse(url, where, "an index buffer view must not declare byteStride.", {
      accessor: accessorIndex,
    });
  }
  const componentBytes = COMPONENT_BYTES[componentType];
  boundAccessor(
    context,
    accessor,
    accessorIndex,
    componentBytes,
    componentBytes,
    where,
  );

  const data = view.bytes;
  const reader = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out =
    componentType === 5125
      ? new Uint32Array(accessor.count)
      : new Uint16Array(accessor.count);
  for (let i = 0; i < accessor.count; i += 1) {
    const offset = accessor.byteOffset + i * componentBytes;
    const value =
      componentType === 5121
        ? reader.getUint8(offset)
        : componentType === 5123
          ? reader.getUint16(offset, true)
          : reader.getUint32(offset, true);
    if (value >= vertexCount) {
      refuse(
        url,
        where,
        `index ${String(i)} refers to vertex ${String(value)}, but the primitive has ${String(vertexCount)} vertices (§85, §96: invalid geometry indices).`,
        { accessor: accessorIndex, index: i, vertex: value, vertexCount },
      );
    }
    out[i] = value;
  }
  return out;
}

/** Bounds-checks one accessor read against its buffer view (§96). */
function boundAccessor(
  context: ParseContext,
  accessor: AccessorRecord,
  accessorIndex: number,
  stride: number,
  elementBytes: number,
  where: string,
): void {
  if (stride < elementBytes) {
    refuse(
      context.url,
      where,
      `accessor ${String(accessorIndex)}: byteStride ${String(stride)} is smaller than one ${String(elementBytes)}-byte element.`,
      { accessor: accessorIndex, stride, elementBytes },
    );
  }
  const view = context.views[accessor.view];
  const needed =
    accessor.byteOffset + stride * (accessor.count - 1) + elementBytes;
  if (needed > view.bytes.byteLength) {
    refuse(
      context.url,
      where,
      `accessor ${String(accessorIndex)} reads ${String(needed)} bytes from a ${String(view.bytes.byteLength)}-byte buffer view (§96 bounds checking).`,
      {
        accessor: accessorIndex,
        needed,
        viewByteLength: view.bytes.byteLength,
      },
    );
  }
}

/** Reads a strictly-increasing keyframe time accessor (§85, §17). */
function readTimes(
  context: ParseContext,
  accessorIndex: number,
  where: string,
): Float32Array {
  const times = readFloats(context, accessorIndex, ["SCALAR"], "none", where);
  for (let i = 1; i < times.length; i += 1) {
    if (!(times[i] > times[i - 1])) {
      refuse(
        context.url,
        where,
        `keyframe times must be strictly increasing; times[${String(i)}] = ${String(times[i])} does not follow ${String(times[i - 1])} (§17, §85).`,
        { accessor: accessorIndex, index: i },
      );
    }
  }
  return times;
}

/** glTF sampler enums mapped to the texture tier's vocabulary. */
function filterOf(
  value: number | null,
  url: string,
  where: string,
): TextureFilterMode {
  if (value === null || value === 9729) {
    return "linear";
  }
  if (value === 9728) {
    return "nearest";
  }
  refuse(url, where, `unknown magFilter ${String(value)}.`, { found: value });
}

/** glTF wrap enums mapped to the texture tier's vocabulary. */
function wrapOf(value: number, url: string, where: string): TextureWrapMode {
  if (value === 10497) {
    return "repeat";
  }
  if (value === 33071) {
    return "clamp-to-edge";
  }
  if (value === 33648) {
    return "mirrored-repeat";
  }
  refuse(url, where, `unknown wrap mode ${String(value)}.`, { found: value });
}

/** The mip-selecting `minFilter` values (ignored: one filter per texture). */
const MIP_MIN_FILTERS = new Set([9984, 9985, 9986, 9987]);

/**
 * Builds a §78 glTF 2.0 loader for the {@link AssetManager} (§96, §33).
 *
 * See the module header for the exact tier — what parses, what is refused by
 * name, and what is ignored with a record. The result of a load is a
 * {@link GltfAsset}; assembly into scene nodes is `four`'s
 * `instantiateGltf`, because this package may not name a node (§3.1).
 *
 * @param options - The IO and decode seams plus the §96 bounds; all optional.
 * @returns A loader producing {@link GltfAsset}s. Each call returns a
 *   distinct loader object, hence a distinct cache slot — hoist it to a
 *   module constant, exactly as with {@link createTextureLoader}.
 * @throws FourError `INVALID_APPLICATION_STATE` for a non-positive
 *   `maximumBytes`.
 */
export function createGltfLoader(
  options: GltfLoaderOptions = {},
): AssetLoader<GltfAsset> {
  options = { ...options };
  const name = options.name ?? "gltf";
  assertImageDecoderMemory(options.decodeTexture, options.maximumWorkingBytes, {
    loader: name,
  });
  const maximumBytes = options.maximumBytes ?? DEFAULT_MAXIMUM_BYTES;
  if (!(maximumBytes > 0)) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      `GltfLoaderOptions.maximumBytes must be greater than zero (or ` +
        `Number.POSITIVE_INFINITY to disable the limit); got ${String(maximumBytes)}.`,
      { context: { limitName: "maximumBytes", found: maximumBytes } },
    );
  }
  const decodeText = options.decodeText ?? resolveGlobalTextDecoder();

  return {
    name,
    async load(response: FetchResponse, url: string): Promise<GltfAsset> {
      const body = new Uint8Array(await response.arrayBuffer());
      return parseGltf(body, url, {
        // Default to the platform transport, exactly as `AssetManager` does
        // (WP-11.2). Without this the manager fetches the .gltf and the loader
        // cannot fetch the .bin beside it -- the commonest glTF shape failing on
        // a first attempt, found by building a consumer app on 2026-09-07.
        // Resolved per load rather than at construction so a stubbed or
        // late-installed global is still seen.
        fetch: options.fetch ?? resolveGlobalFetch<never>(),
        decodeTexture: options.decodeTexture,
        probeTexture: options.probeTexture,
        maximumBytes,
        maximumDecodedBytes: options.maximumDecodedBytes,
        maximumExpansionRatio: options.maximumExpansionRatio,
        maximumWorkingBytes: options.maximumWorkingBytes,
        decodeText,
        name,
      });
    },
  };
}

/** The resolved options {@link parseGltf} runs with. */
interface ResolvedOptions {
  readonly fetch: FetchLike | undefined;
  readonly decodeTexture: TexelDecodeLike | undefined;
  readonly probeTexture: TexelProbeLike | undefined;
  readonly maximumBytes: number;
  readonly maximumDecodedBytes: number | undefined;
  readonly maximumExpansionRatio: number | undefined;
  readonly maximumWorkingBytes: number | undefined;
  readonly decodeText: TextDecodeLike | undefined;
  readonly name: string;
}

/** Fetches one external subresource through the injected transport (§96). */
async function fetchSubresource(
  uri: string,
  baseUrl: string,
  kind: string,
  where: string,
  options: ResolvedOptions,
): Promise<Uint8Array> {
  if (options.fetch === undefined) {
    refuse(
      baseUrl,
      where,
      `the document names external ${kind} "${uri}" but this loader was built ` +
        `without a transport. Pass { fetch } to createGltfLoader.`,
      { uri },
    );
  }
  const resolved = resolveUri(baseUrl, uri);
  let response: FetchResponse;
  try {
    response = await options.fetch(resolved);
  } catch (error) {
    refuseFetch(baseUrl, where, resolved, error);
  }
  if (!response.ok) {
    refuse(
      baseUrl,
      where,
      `fetching "${resolved}" answered HTTP ${String(response.status)}.`,
      {
        uri: resolved,
        status: response.status,
      },
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > options.maximumBytes) {
    refuse(
      baseUrl,
      where,
      `"${resolved}" is ${String(bytes.byteLength)} bytes, over the ${String(options.maximumBytes)}-byte subresource limit (§96).`,
      {
        uri: resolved,
        limitName: "maximumBytes",
        limit: options.maximumBytes,
        observed: bytes.byteLength,
      },
    );
  }
  return bytes;
}

/** The transport-failure refusal, split out so the `catch` stays typed. */
function refuseFetch(
  baseUrl: string,
  where: string,
  resolved: string,
  error: unknown,
): never {
  throw new FourError(
    "ASSET_LOAD_FAILED",
    `Cannot load glTF "${baseUrl}": ${where}: fetching "${resolved}" failed.`,
    { context: { url: baseUrl, where, uri: resolved }, cause: error },
  );
}

/** Resolves one buffer's bytes from BIN chunk, data URI, or transport. */
async function resolveBuffer(
  record: Record<string, unknown>,
  index: number,
  binary: Uint8Array | null,
  url: string,
  options: ResolvedOptions,
): Promise<Uint8Array> {
  const where = `buffers[${String(index)}]`;
  const declared = record["byteLength"];
  if (
    typeof declared !== "number" ||
    !Number.isInteger(declared) ||
    declared < 1
  ) {
    refuse(url, `${where}.byteLength`, "expected a positive integer.", {
      found: declared,
    });
  }
  if (declared > options.maximumBytes) {
    refuse(
      url,
      `${where}.byteLength`,
      `declares ${String(declared)} bytes, over the ${String(options.maximumBytes)}-byte subresource limit (§96).`,
      {
        limitName: "maximumBytes",
        limit: options.maximumBytes,
        observed: declared,
      },
    );
  }
  const uri = record["uri"];
  if (uri === undefined) {
    if (binary === null) {
      refuse(url, where, "has no uri, but the container has no BIN chunk.");
    }
    if (declared > binary.byteLength) {
      refuse(
        url,
        where,
        `declares ${String(declared)} bytes, but the BIN chunk holds ${String(binary.byteLength)} (§96 bounds checking).`,
        { declared, binByteLength: binary.byteLength },
      );
    }
    return binary.subarray(0, declared);
  }
  if (typeof uri !== "string") {
    refuse(url, `${where}.uri`, "expected a string.");
  }
  let bytes: Uint8Array;
  if (uri.startsWith("data:")) {
    const comma = uri.indexOf(",");
    if (comma === -1 || !uri.slice(0, comma).endsWith(";base64")) {
      refuse(
        url,
        `${where}.uri`,
        "only base64 data: URIs are supported; a plain-text data URI is refused by name.",
      );
    }
    bytes = decodeBase64(
      uri.slice(comma + 1),
      options.maximumBytes,
      url,
      `${where}.uri`,
    );
  } else {
    bytes = await fetchSubresource(uri, url, "buffer", where, options);
  }
  if (bytes.byteLength < declared) {
    refuse(
      url,
      where,
      `declares ${String(declared)} bytes, but the uri yielded ${String(bytes.byteLength)} (§96 bounds checking).`,
      { declared, observed: bytes.byteLength },
    );
  }
  return bytes.subarray(0, declared);
}

/** The whole-document parse — see the module header for the tier. */
async function parseGltf(
  body: Uint8Array,
  url: string,
  options: ResolvedOptions,
): Promise<GltfAsset> {
  // --- container --------------------------------------------------------
  let jsonBytes = body;
  let binary: Uint8Array | null = null;
  const ignored: string[] = [];
  const isGlb =
    body.byteLength >= 4 &&
    new DataView(body.buffer, body.byteOffset, 4).getUint32(0, true) ===
      GLB_MAGIC;
  if (isGlb) {
    const chunks = parseGlbContainer(body, url);
    jsonBytes = chunks.json;
    binary = chunks.binary;
    if (chunks.unknownChunks > 0) {
      ignored.push(`${String(chunks.unknownChunks)} unknown GLB chunk(s)`);
    }
  }
  if (options.decodeText === undefined) {
    refuse(
      url,
      "json",
      "this runtime has no TextDecoder. Pass { decodeText } to createGltfLoader.",
    );
  }
  const text = options.decodeText(jsonBytes.slice().buffer);
  let parsed: unknown;
  try {
    // §96's depth and length guards run before any recursive consumer.
    parsed = parseUntrustedJson(text, `glTF document "${url}"`);
  } catch (error) {
    if (isFourError(error)) {
      throw error; // The §96 guard's own refusal, already precise.
    }
    throw new FourError(
      "ASSET_LOAD_FAILED",
      `Cannot load glTF "${url}": json: the body is not JSON.`,
      { context: { url, where: "json" }, cause: error },
    );
  }
  const document = asObject(parsed, url, "document");

  // --- asset + extensions ----------------------------------------------
  const asset = asObject(document["asset"], url, "asset");
  const version = asset["version"];
  if (typeof version !== "string" || !version.startsWith("2.")) {
    refuse(
      url,
      "asset.version",
      `expected a 2.x version; got ${String(version)}.`,
      {
        found: version,
      },
    );
  }
  const required = document["extensionsRequired"];
  if (required !== undefined) {
    const list = asArray(required, url, "extensionsRequired");
    if (list.length > 0) {
      refuse(
        url,
        "extensionsRequired",
        `the document requires extension(s) ${list.map(String).join(", ")}; ` +
          "no extension — compression included — is in the §78 tier.",
        { extensions: list.map(String) },
      );
    }
  }

  const context: ParseContext = {
    url,
    views: [],
    accessors: [],
    ignored,
  };

  const used = document["extensionsUsed"];
  if (used !== undefined && asArray(used, url, "extensionsUsed").length > 0) {
    ignore(
      context,
      `extensionsUsed (${asArray(used, url, "extensionsUsed").map(String).join(", ")})`,
    );
  }
  if (collection(document, "cameras", url).length > 0) {
    ignore(context, "cameras");
  }

  // --- buffers → views → accessors (structure first, reads later) ------
  const bufferRecords = collection(document, "buffers", url);
  const buffers: Uint8Array[] = [];
  for (let i = 0; i < bufferRecords.length; i += 1) {
    const record = asObject(bufferRecords[i], url, `buffers[${String(i)}]`);
    buffers.push(await resolveBuffer(record, i, binary, url, options));
  }

  const viewRecords = collection(document, "bufferViews", url);
  const views = context.views as ViewRecord[];
  for (let i = 0; i < viewRecords.length; i += 1) {
    const where = `bufferViews[${String(i)}]`;
    const record = asObject(viewRecords[i], url, where);
    const buffer = requiredIndex(
      record["buffer"],
      buffers.length,
      url,
      `${where}.buffer`,
    );
    const byteOffset = optionalNumber(record, "byteOffset", 0, url, where);
    const byteLength = record["byteLength"];
    if (
      typeof byteLength !== "number" ||
      !Number.isInteger(byteLength) ||
      byteLength < 1
    ) {
      refuse(url, `${where}.byteLength`, "expected a positive integer.", {
        found: byteLength,
      });
    }
    if (
      !Number.isInteger(byteOffset) ||
      byteOffset < 0 ||
      byteOffset + byteLength > buffers[buffer].byteLength
    ) {
      refuse(
        url,
        where,
        `spans bytes ${String(byteOffset)}…${String(byteOffset + byteLength)} of a ${String(buffers[buffer].byteLength)}-byte buffer (§96 bounds checking).`,
        {
          byteOffset,
          byteLength,
          bufferByteLength: buffers[buffer].byteLength,
        },
      );
    }
    let byteStride: number | null = null;
    const strideValue = record["byteStride"];
    if (strideValue !== undefined) {
      if (
        typeof strideValue !== "number" ||
        !Number.isInteger(strideValue) ||
        strideValue < 4 ||
        strideValue > 252 ||
        strideValue % 4 !== 0
      ) {
        refuse(
          url,
          `${where}.byteStride`,
          "expected a multiple of 4 between 4 and 252.",
          { found: strideValue },
        );
      }
      byteStride = strideValue;
    }
    views.push({
      bytes: buffers[buffer].subarray(byteOffset, byteOffset + byteLength),
      byteStride,
    });
  }

  const accessorRecords = collection(document, "accessors", url);
  const accessors = context.accessors as AccessorRecord[];
  for (let i = 0; i < accessorRecords.length; i += 1) {
    const where = `accessors[${String(i)}]`;
    const record = asObject(accessorRecords[i], url, where);
    if (record["sparse"] !== undefined) {
      refuse(url, where, "sparse accessors are refused by name at this tier.");
    }
    const viewValue = record["bufferView"];
    if (viewValue === undefined) {
      refuse(
        url,
        where,
        "an accessor without a bufferView (an all-zeros accessor) is refused by name at this tier.",
      );
    }
    const view = requiredIndex(
      viewValue,
      views.length,
      url,
      `${where}.bufferView`,
    );
    const byteOffset = optionalNumber(record, "byteOffset", 0, url, where);
    if (!Number.isInteger(byteOffset) || byteOffset < 0) {
      refuse(url, `${where}.byteOffset`, "expected a non-negative integer.", {
        found: byteOffset,
      });
    }
    const componentType = record["componentType"];
    if (
      typeof componentType !== "number" ||
      COMPONENT_BYTES[componentType] === undefined
    ) {
      refuse(
        url,
        `${where}.componentType`,
        `unknown component type ${String(componentType)}.`,
        {
          found: componentType,
        },
      );
    }
    const count = record["count"];
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
      refuse(url, `${where}.count`, "expected a positive integer.", {
        found: count,
      });
    }
    const type = record["type"];
    if (typeof type !== "string" || TYPE_COMPONENTS[type] === undefined) {
      refuse(url, `${where}.type`, `unknown accessor type ${String(type)}.`, {
        found: type,
      });
    }
    accessors.push({
      view,
      byteOffset,
      componentType,
      count,
      type,
      normalized: record["normalized"] === true,
    });
  }

  // --- samplers, images, textures, materials ---------------------------
  const samplerRecords = collection(document, "samplers", url);
  const samplers: {
    filter: TextureFilterMode;
    wrap: TextureWrapMode;
  }[] = [];
  for (let i = 0; i < samplerRecords.length; i += 1) {
    const where = `samplers[${String(i)}]`;
    const record = asObject(samplerRecords[i], url, where);
    const magValue = record["magFilter"];
    const filter = filterOf(
      typeof magValue === "number" ? magValue : null,
      url,
      `${where}.magFilter`,
    );
    const minValue = record["minFilter"];
    if (typeof minValue === "number" && MIP_MIN_FILTERS.has(minValue)) {
      ignore(context, `${where}.minFilter (mip-selecting)`);
    } else if (
      minValue !== undefined &&
      minValue !== 9728 &&
      minValue !== 9729
    ) {
      refuse(
        url,
        `${where}.minFilter`,
        "expected 9728, 9729, or a mip-selecting value.",
        { found: minValue },
      );
    }
    const wrapSValue = record["wrapS"];
    const wrapTValue = record["wrapT"];
    const wrapS = wrapOf(
      typeof wrapSValue === "number" ? wrapSValue : 10497,
      url,
      `${where}.wrapS`,
    );
    const wrapT = wrapOf(
      typeof wrapTValue === "number" ? wrapTValue : 10497,
      url,
      `${where}.wrapT`,
    );
    if (wrapT !== wrapS) {
      ignore(
        context,
        `${where}.wrapT (differs from wrapS; one wrap mode per texture)`,
      );
    }
    samplers.push({ filter, wrap: wrapS });
  }

  const imageRecords = collection(document, "images", url);
  const textureRecords = collection(document, "textures", url);
  interface TextureRef {
    readonly source: number;
    readonly sampler: number | null;
  }
  const textureRefs: TextureRef[] = [];
  for (let i = 0; i < textureRecords.length; i += 1) {
    const where = `textures[${String(i)}]`;
    const record = asObject(textureRecords[i], url, where);
    const sourceValue = record["source"];
    if (sourceValue === undefined) {
      refuse(url, where, "a texture without an image source is refused.");
    }
    textureRefs.push({
      source: requiredIndex(
        sourceValue,
        imageRecords.length,
        url,
        `${where}.source`,
      ),
      sampler: optionalIndex(record, "sampler", samplers.length, url, where),
    });
  }

  /** Reads one textureInfo record, enforcing the `texCoord 0` tier. */
  const textureInfo = (value: unknown, where: string): number => {
    const record = asObject(value, url, where);
    const index = requiredIndex(
      record["index"],
      textureRefs.length,
      url,
      `${where}.index`,
    );
    const texCoord = optionalNumber(record, "texCoord", 0, url, where);
    if (texCoord !== 0) {
      refuse(
        url,
        `${where}.texCoord`,
        `texCoord set ${String(texCoord)} is refused by name — the tier samples TEXCOORD_0 only.`,
        { found: texCoord },
      );
    }
    return index;
  };

  const materialRecords = collection(document, "materials", url);
  const materials: GltfMaterialRecord[] = [];
  const referencedTextures = new Set<number>();
  const textureColorSpace = new Map<number, "srgb" | "linear">();
  const referenceTexture = (index: number, space: "srgb" | "linear"): void => {
    referencedTextures.add(index);
    if (space === "srgb" || !textureColorSpace.has(index)) {
      textureColorSpace.set(index, space);
    }
  };
  for (let i = 0; i < materialRecords.length; i += 1) {
    const where = `materials[${String(i)}]`;
    const record = asObject(materialRecords[i], url, where);
    const ignoredTextures: string[] = [];
    let baseColor: readonly number[] = [1, 1, 1, 1];
    let metalness = 1;
    let roughness = 1;
    let baseColorTexture: number | null = null;
    let metallicRoughnessTexture: number | null = null;
    let emissiveTexture: number | null = null;
    let normalTexture: number | null = null;
    let occlusionTexture: number | null = null;
    let normalScale = 1;
    let occlusionStrength = 1;
    const pbrValue = record["pbrMetallicRoughness"];
    if (pbrValue !== undefined) {
      const pbr = asObject(pbrValue, url, `${where}.pbrMetallicRoughness`);
      const pbrWhere = `${where}.pbrMetallicRoughness`;
      baseColor = optionalTuple(
        pbr,
        "baseColorFactor",
        4,
        baseColor,
        url,
        pbrWhere,
      );
      metalness = optionalNumber(pbr, "metallicFactor", 1, url, pbrWhere);
      roughness = optionalNumber(pbr, "roughnessFactor", 1, url, pbrWhere);
      if (pbr["baseColorTexture"] !== undefined) {
        baseColorTexture = textureInfo(
          pbr["baseColorTexture"],
          `${pbrWhere}.baseColorTexture`,
        );
        referenceTexture(baseColorTexture, "srgb");
      }
      if (pbr["metallicRoughnessTexture"] !== undefined) {
        metallicRoughnessTexture = textureInfo(
          pbr["metallicRoughnessTexture"],
          `${pbrWhere}.metallicRoughnessTexture`,
        );
        referenceTexture(metallicRoughnessTexture, "linear");
      }
    }
    for (const slot of ["normalTexture", "occlusionTexture"]) {
      if (record[slot] !== undefined) {
        const index = textureInfo(record[slot], `${where}.${slot}`);
        const info = asObject(record[slot], url, `${where}.${slot}`);
        const parameter = slot === "normalTexture" ? "scale" : "strength";
        const factor = optionalNumber(
          info,
          parameter,
          1,
          url,
          `${where}.${slot}`,
        );
        if (slot === "normalTexture") {
          normalTexture = index;
          normalScale = factor;
        } else {
          occlusionTexture = index;
          occlusionStrength = factor;
        }
        referenceTexture(index, "linear");
      }
    }
    if (record["emissiveTexture"] !== undefined) {
      emissiveTexture = textureInfo(
        record["emissiveTexture"],
        `${where}.emissiveTexture`,
      );
      referenceTexture(emissiveTexture, "srgb");
    }
    const emissive = optionalTuple(
      record,
      "emissiveFactor",
      3,
      [0, 0, 0],
      url,
      where,
    );
    const alphaMode = record["alphaMode"] ?? "OPAQUE";
    if (alphaMode !== "OPAQUE" && alphaMode !== "BLEND") {
      const label = typeof alphaMode === "string" ? alphaMode : "(non-string)";
      refuse(
        url,
        `${where}.alphaMode`,
        `alphaMode ${label} is refused by name — the material tier has OPAQUE and BLEND (MASK needs an alpha cutoff it does not carry).`,
        { found: alphaMode },
      );
    }
    const material: GltfMaterialRecord = {
      name: nameOf(record, url, where),
      baseColor: [baseColor[0], baseColor[1], baseColor[2], baseColor[3]],
      metalness,
      roughness,
      emissive: [emissive[0], emissive[1], emissive[2]],
      baseColorTexture,
      metallicRoughnessTexture,
      emissiveTexture,
      normalTexture,
      occlusionTexture,
      normalScale,
      occlusionStrength,
      transparent: alphaMode === "BLEND",
      doubleSided: record["doubleSided"] === true,
      ignoredTextures,
    };
    const extras = extrasOf(record);
    materials.push(extras === undefined ? material : { ...material, extras });
  }

  // --- decode the referenced textures, ascending index order (§33) -----
  const textures: (TextureAsset | null)[] = new Array<TextureAsset | null>(
    textureRefs.length,
  ).fill(null);
  const wanted = [...referencedTextures].sort((a, b) => a - b);
  for (const index of wanted) {
    const where = `textures[${String(index)}]`;
    if (options.decodeTexture === undefined) {
      refuse(
        url,
        where,
        "a material samples this texture but the loader was built without a " +
          "decoder. Pass { decodeTexture } to createGltfLoader.",
      );
    }
    const ref = textureRefs[index];
    const imageWhere = `images[${String(ref.source)}]`;
    const image = asObject(imageRecords[ref.source], url, imageWhere);
    const uri = image["uri"];
    const viewValue = image["bufferView"];
    let encoded: Uint8Array;
    let textureUrl: string;
    if (uri !== undefined && viewValue !== undefined) {
      refuse(
        url,
        imageWhere,
        "an image must carry a uri or a bufferView, not both.",
      );
    } else if (typeof uri === "string") {
      if (uri.startsWith("data:")) {
        const comma = uri.indexOf(",");
        if (comma === -1 || !uri.slice(0, comma).endsWith(";base64")) {
          refuse(
            url,
            `${imageWhere}.uri`,
            "only base64 data: URIs are supported.",
          );
        }
        encoded = decodeBase64(
          uri.slice(comma + 1),
          options.maximumBytes,
          url,
          `${imageWhere}.uri`,
        );
        textureUrl = `${url}#${imageWhere}`;
      } else {
        encoded = await fetchSubresource(
          uri,
          url,
          "image",
          imageWhere,
          options,
        );
        textureUrl = resolveUri(url, uri);
      }
    } else if (viewValue !== undefined) {
      const view = requiredIndex(
        viewValue,
        views.length,
        url,
        `${imageWhere}.bufferView`,
      );
      encoded = views[view].bytes;
      textureUrl = `${url}#${imageWhere}`;
    } else {
      refuse(url, imageWhere, "an image needs a uri or a bufferView.");
    }
    const sampler =
      ref.sampler === null
        ? { filter: "linear" as const, wrap: "repeat" as const }
        : samplers[ref.sampler];
    // The landed texture tier does the decoding, the §96 decompression
    // bounds, the §7a row flip, and the finite-dimension checks — reused
    // whole through its own decode seam rather than restated.
    const decodeTexture = createTextureDecoder({
      decode: options.decodeTexture,
      probe: options.probeTexture,
      name: `${options.name}-texture`,
      colorSpace: textureColorSpace.get(index) ?? "srgb",
      filter: sampler.filter,
      wrap: sampler.wrap,
      maximumDecodedBytes: options.maximumDecodedBytes,
      maximumExpansionRatio: options.maximumExpansionRatio,
      maximumWorkingBytes: options.maximumWorkingBytes,
    });
    textures[index] = await decodeTexture(encoded.slice().buffer, textureUrl);
  }

  // --- meshes -----------------------------------------------------------
  const meshRecords = collection(document, "meshes", url);
  const meshes: GltfMeshRecord[] = [];
  for (let i = 0; i < meshRecords.length; i += 1) {
    const where = `meshes[${String(i)}]`;
    const record = asObject(meshRecords[i], url, where);
    if (record["weights"] !== undefined) {
      refuse(
        url,
        `${where}.weights`,
        "morph targets are refused by name at this tier — the GPU morph path is staged, and weights that deform nothing would draw the wrong picture.",
      );
    }
    const primitiveValues = asArray(
      record["primitives"],
      url,
      `${where}.primitives`,
    );
    if (primitiveValues.length === 0) {
      refuse(
        url,
        `${where}.primitives`,
        "a mesh needs at least one primitive.",
      );
    }
    const primitives: GltfPrimitiveRecord[] = [];
    for (let p = 0; p < primitiveValues.length; p += 1) {
      const primitiveWhere = `${where}.primitives[${String(p)}]`;
      primitives.push(
        parsePrimitive(
          context,
          asObject(primitiveValues[p], url, primitiveWhere),
          materials.length,
          primitiveWhere,
        ),
      );
    }
    const mesh: GltfMeshRecord = {
      name: nameOf(record, url, where),
      primitives,
    };
    const extras = extrasOf(record);
    meshes.push(extras === undefined ? mesh : { ...mesh, extras });
  }

  // --- skins (structure; the IBM read needs accessors only) ------------
  const skinRecords = collection(document, "skins", url);

  // --- nodes ------------------------------------------------------------
  const nodeRecords = collection(document, "nodes", url);
  const cameraCount = collection(document, "cameras", url).length;
  const nodes: GltfNodeRecord[] = [];
  for (let i = 0; i < nodeRecords.length; i += 1) {
    const where = `nodes[${String(i)}]`;
    const record = asObject(nodeRecords[i], url, where);
    if (record["weights"] !== undefined) {
      refuse(
        url,
        `${where}.weights`,
        "morph-target weights are refused by name at this tier.",
      );
    }
    const childrenValue = record["children"];
    const children: number[] = [];
    if (childrenValue !== undefined) {
      const list = asArray(childrenValue, url, `${where}.children`);
      for (let c = 0; c < list.length; c += 1) {
        children.push(
          requiredIndex(
            list[c],
            nodeRecords.length,
            url,
            `${where}.children[${String(c)}]`,
          ),
        );
      }
    }
    const matrixValue = record["matrix"];
    let matrix: Float32Array | null = null;
    if (matrixValue !== undefined) {
      if (
        record["translation"] !== undefined ||
        record["rotation"] !== undefined ||
        record["scale"] !== undefined
      ) {
        refuse(url, where, "matrix and TRS are mutually exclusive on a node.");
      }
      matrix = new Float32Array(
        optionalTuple(record, "matrix", 16, [], url, where),
      );
    }
    const skin = optionalIndex(record, "skin", skinRecords.length, url, where);
    const mesh = optionalIndex(record, "mesh", meshes.length, url, where);
    if (skin !== null && mesh === null) {
      refuse(
        url,
        `${where}.skin`,
        "a node with a skin must also carry a mesh.",
      );
    }
    if (record["camera"] !== undefined) {
      requiredIndex(record["camera"], cameraCount, url, `${where}.camera`);
      ignore(context, `${where}.camera`);
    }
    const translation = optionalTuple(
      record,
      "translation",
      3,
      [0, 0, 0],
      url,
      where,
    );
    const rotation = optionalTuple(
      record,
      "rotation",
      4,
      [0, 0, 0, 1],
      url,
      where,
    );
    const scale = optionalTuple(record, "scale", 3, [1, 1, 1], url, where);
    const node: GltfNodeRecord = {
      name: nameOf(record, url, where),
      children,
      translation: [translation[0], translation[1], translation[2]],
      rotation: [rotation[0], rotation[1], rotation[2], rotation[3]],
      scale: [scale[0], scale[1], scale[2]],
      matrix,
      mesh,
      skin,
    };
    const extras = extrasOf(record);
    nodes.push(extras === undefined ? node : { ...node, extras });
  }

  // --- hierarchy: one parent each, no cycles (§85, §96) ----------------
  const parents = new Array<number | null>(nodes.length).fill(null);
  for (let i = 0; i < nodes.length; i += 1) {
    for (const child of nodes[i].children) {
      if (parents[child] !== null || child === i) {
        refuse(
          url,
          `nodes[${String(i)}].children`,
          `node ${String(child)} would gain a second parent — a glTF node has at most one (§85: scene graph cycles).`,
          { child },
        );
      }
      parents[child] = i;
    }
  }
  for (let i = 0; i < nodes.length; i += 1) {
    let ancestor = parents[i];
    let steps = 0;
    while (ancestor !== null) {
      steps += 1;
      if (steps > nodes.length) {
        refuse(
          url,
          `nodes[${String(i)}]`,
          "the node hierarchy contains a cycle (§85).",
        );
      }
      ancestor = parents[ancestor];
    }
  }

  // --- skins: joints + inverse binds ------------------------------------
  const skins: GltfSkinRecord[] = [];
  for (let i = 0; i < skinRecords.length; i += 1) {
    const where = `skins[${String(i)}]`;
    const record = asObject(skinRecords[i], url, where);
    const jointValues = asArray(record["joints"], url, `${where}.joints`);
    if (jointValues.length === 0) {
      refuse(url, `${where}.joints`, "a skin needs at least one joint.");
    }
    const joints: number[] = [];
    const seen = new Set<number>();
    for (let j = 0; j < jointValues.length; j += 1) {
      const joint = requiredIndex(
        jointValues[j],
        nodes.length,
        url,
        `${where}.joints[${String(j)}]`,
      );
      if (seen.has(joint)) {
        refuse(
          url,
          `${where}.joints[${String(j)}]`,
          `node ${String(joint)} appears twice; the joint index is the position in the list (§33, §85).`,
          { joint },
        );
      }
      seen.add(joint);
      joints.push(joint);
    }
    let inverseBindMatrices: Float32Array | null = null;
    const ibmValue = record["inverseBindMatrices"];
    if (ibmValue !== undefined) {
      const accessor = requiredIndex(
        ibmValue,
        accessors.length,
        url,
        `${where}.inverseBindMatrices`,
      );
      const floats = readFloats(
        context,
        accessor,
        ["MAT4"],
        "none",
        `${where}.inverseBindMatrices`,
      );
      if (floats.length < joints.length * 16) {
        refuse(
          url,
          `${where}.inverseBindMatrices`,
          `carries ${String(floats.length / 16)} matrices for ${String(joints.length)} joints.`,
          { matrices: floats.length / 16, joints: joints.length },
        );
      }
      inverseBindMatrices = floats.subarray(0, joints.length * 16);
    }
    // `skeleton` is a root hint the engine's own palette math (skin-root
    // relative, §54) does not need; validated implicitly by node indexing
    // rules and otherwise unused.
    skins.push({
      name: nameOf(record, url, where),
      joints,
      inverseBindMatrices,
    });
  }

  // --- cross-check: a skinned primitive's joints index its skin (§96) --
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node.skin === null || node.mesh === null) {
      continue;
    }
    const jointCount = skins[node.skin].joints.length;
    const primitives = meshes[node.mesh].primitives;
    for (let p = 0; p < primitives.length; p += 1) {
      const joints = primitives[p].joints;
      if (joints === undefined) {
        continue;
      }
      for (let j = 0; j < joints.length; j += 1) {
        if (joints[j] >= jointCount) {
          refuse(
            url,
            `nodes[${String(i)}]`,
            `meshes[${String(node.mesh)}].primitives[${String(p)}] indexes joint ${String(joints[j])}, but skins[${String(node.skin)}] has ${String(jointCount)} joints (§96 bounds checking).`,
            { joint: joints[j], jointCount },
          );
        }
      }
    }
  }

  // --- scenes -----------------------------------------------------------
  const sceneRecords = collection(document, "scenes", url);
  const scenes: GltfSceneRecord[] = [];
  for (let i = 0; i < sceneRecords.length; i += 1) {
    const where = `scenes[${String(i)}]`;
    const record = asObject(sceneRecords[i], url, where);
    const nodeValues =
      record["nodes"] === undefined
        ? []
        : asArray(record["nodes"], url, `${where}.nodes`);
    const roots: number[] = [];
    const seen = new Set<number>();
    for (let n = 0; n < nodeValues.length; n += 1) {
      const root = requiredIndex(
        nodeValues[n],
        nodes.length,
        url,
        `${where}.nodes[${String(n)}]`,
      );
      if (parents[root] !== null) {
        refuse(
          url,
          `${where}.nodes[${String(n)}]`,
          `node ${String(root)} is not a root — a scene lists root nodes only.`,
          { node: root },
        );
      }
      if (seen.has(root)) {
        refuse(
          url,
          `${where}.nodes[${String(n)}]`,
          `node ${String(root)} is listed twice.`,
          {
            node: root,
          },
        );
      }
      seen.add(root);
      roots.push(root);
    }
    scenes.push({ name: nameOf(record, url, where), nodes: roots });
  }
  const defaultScene = optionalIndex(
    document,
    "scene",
    scenes.length,
    url,
    "document",
  );

  // --- animations --------------------------------------------------------
  const animationRecords = collection(document, "animations", url);
  const animations: GltfAnimationRecord[] = [];
  for (let i = 0; i < animationRecords.length; i += 1) {
    const where = `animations[${String(i)}]`;
    const record = asObject(animationRecords[i], url, where);
    const samplerValues = asArray(record["samplers"], url, `${where}.samplers`);
    const channelValues = asArray(record["channels"], url, `${where}.channels`);
    if (channelValues.length === 0) {
      refuse(
        url,
        `${where}.channels`,
        "an animation needs at least one channel.",
      );
    }
    const channels: GltfChannelRecord[] = [];
    for (let c = 0; c < channelValues.length; c += 1) {
      const channelWhere = `${where}.channels[${String(c)}]`;
      const channel = asObject(channelValues[c], url, channelWhere);
      const samplerIndex = requiredIndex(
        channel["sampler"],
        samplerValues.length,
        url,
        `${channelWhere}.sampler`,
      );
      const target = asObject(channel["target"], url, `${channelWhere}.target`);
      const nodeValue = target["node"];
      if (nodeValue === undefined) {
        refuse(
          url,
          `${channelWhere}.target`,
          "a channel without a target node is refused (an extension shape).",
        );
      }
      const node = requiredIndex(
        nodeValue,
        nodes.length,
        url,
        `${channelWhere}.target.node`,
      );
      const path = target["path"];
      if (path === "weights") {
        refuse(
          url,
          `${channelWhere}.target.path`,
          "morph-weight channels are refused by name at this tier.",
        );
      }
      if (path !== "translation" && path !== "rotation" && path !== "scale") {
        refuse(
          url,
          `${channelWhere}.target.path`,
          `unknown target path ${String(path)}.`,
          {
            found: path,
          },
        );
      }
      const sampler = asObject(
        samplerValues[samplerIndex],
        url,
        `${where}.samplers[${String(samplerIndex)}]`,
      );
      const samplerWhere = `${where}.samplers[${String(samplerIndex)}]`;
      const interpolationValue = sampler["interpolation"] ?? "LINEAR";
      if (interpolationValue === "CUBICSPLINE") {
        refuse(
          url,
          `${samplerWhere}.interpolation`,
          "CUBICSPLINE samplers are refused by name at this tier.",
        );
      }
      if (interpolationValue !== "LINEAR" && interpolationValue !== "STEP") {
        const label =
          typeof interpolationValue === "string"
            ? interpolationValue
            : "(non-string)";
        refuse(
          url,
          `${samplerWhere}.interpolation`,
          `unknown interpolation ${label}.`,
          { found: interpolationValue },
        );
      }
      const inputIndex = requiredIndex(
        sampler["input"],
        accessors.length,
        url,
        `${samplerWhere}.input`,
      );
      const outputIndex = requiredIndex(
        sampler["output"],
        accessors.length,
        url,
        `${samplerWhere}.output`,
      );
      const times = readTimes(context, inputIndex, `${samplerWhere}.input`);
      const values =
        path === "rotation"
          ? readFloats(
              context,
              outputIndex,
              ["VEC4"],
              "all",
              `${samplerWhere}.output`,
            )
          : readFloats(
              context,
              outputIndex,
              ["VEC3"],
              "none",
              `${samplerWhere}.output`,
            );
      const components = path === "rotation" ? 4 : 3;
      if (values.length !== times.length * components) {
        refuse(
          url,
          `${samplerWhere}.output`,
          `carries ${String(values.length / components)} keys for ${String(times.length)} times.`,
          { keys: values.length / components, times: times.length },
        );
      }
      channels.push({
        node,
        path,
        interpolation: interpolationValue === "STEP" ? "step" : "linear",
        times,
        values,
      });
    }
    animations.push({ name: nameOf(record, url, where), channels });
  }

  const documentExtras = extrasOf(document);
  return new GltfAsset({
    url,
    meshes,
    materials,
    textures,
    nodes,
    scenes,
    defaultScene,
    skins,
    animations,
    ignored,
    ...(documentExtras === undefined ? {} : { extras: documentExtras }),
  });
}

/** The recognized attribute keys, in the layout's own order. */
const KNOWN_ATTRIBUTES = new Set([
  "POSITION",
  "NORMAL",
  "TEXCOORD_0",
  "COLOR_0",
  "JOINTS_0",
  "WEIGHTS_0",
]);

/** Parses one mesh primitive into the geometry layer's layout (§53, §96). */
function parsePrimitive(
  context: ParseContext,
  record: Record<string, unknown>,
  materialCount: number,
  where: string,
): GltfPrimitiveRecord {
  const { url } = context;
  if (record["targets"] !== undefined) {
    refuse(
      url,
      `${where}.targets`,
      "morph targets are refused by name at this tier — the GPU morph path is staged.",
    );
  }
  const modeValue = record["mode"] ?? 4;
  let mode: GltfPrimitiveMode;
  if (modeValue === 4) {
    mode = "triangles";
  } else if (modeValue === 1) {
    mode = "lines";
  } else {
    const label = typeof modeValue === "number" ? String(modeValue) : "?";
    refuse(
      url,
      `${where}.mode`,
      `primitive mode ${label} is refused by name — the geometry layer draws triangles (4) and lines (1).`,
      { found: modeValue },
    );
  }

  const attributes = asObject(record["attributes"], url, `${where}.attributes`);
  // JSON object keys enumerate in the document's own insertion order, so this
  // scan is deterministic per input bytes (§33).
  for (const key of Object.keys(attributes)) {
    if (!KNOWN_ATTRIBUTES.has(key)) {
      ignore(context, `${where}.attributes.${key}`);
    }
  }
  const positionValue = attributes["POSITION"];
  if (positionValue === undefined) {
    refuse(url, `${where}.attributes`, "POSITION is required at this tier.");
  }
  const positionIndex = requiredIndex(
    positionValue,
    context.accessors.length,
    url,
    `${where}.attributes.POSITION`,
  );
  const positions = readFloats(
    context,
    positionIndex,
    ["VEC3"],
    "none",
    `${where}.attributes.POSITION`,
  );
  const vertexCount = context.accessors[positionIndex].count;

  /** Resolves one optional attribute accessor, enforcing the shared count. */
  const attributeIndex = (key: string): number | null => {
    const value = attributes[key];
    if (value === undefined) {
      return null;
    }
    const index = requiredIndex(
      value,
      context.accessors.length,
      url,
      `${where}.attributes.${key}`,
    );
    if (context.accessors[index].count !== vertexCount) {
      refuse(
        url,
        `${where}.attributes.${key}`,
        `has ${String(context.accessors[index].count)} elements; POSITION has ${String(vertexCount)} (§85).`,
        { count: context.accessors[index].count, vertexCount },
      );
    }
    return index;
  };

  const normalIndex = attributeIndex("NORMAL");
  const normals =
    normalIndex === null
      ? undefined
      : readFloats(
          context,
          normalIndex,
          ["VEC3"],
          "none",
          `${where}.attributes.NORMAL`,
        );

  const uvIndex = attributeIndex("TEXCOORD_0");
  let uvs: Float32Array | undefined;
  if (uvIndex !== null) {
    uvs = readFloats(
      context,
      uvIndex,
      ["VEC2"],
      "unsigned",
      `${where}.attributes.TEXCOORD_0`,
    );
    // glTF's `v` points down from the image's top row; the engine's points up
    // from the bottom one, and the texture tier flips the rows to match — so
    // the coordinate converts here, once, at parse (§7a; module header).
    for (let i = 1; i < uvs.length; i += 2) {
      uvs[i] = 1 - uvs[i];
    }
  }

  const colorIndex = attributeIndex("COLOR_0");
  let colors: Float32Array | undefined;
  if (colorIndex !== null) {
    const raw = readFloats(
      context,
      colorIndex,
      ["VEC3", "VEC4"],
      "unsigned",
      `${where}.attributes.COLOR_0`,
    );
    if (context.accessors[colorIndex].type === "VEC3") {
      colors = new Float32Array(vertexCount * 4);
      for (let v = 0; v < vertexCount; v += 1) {
        colors[v * 4] = raw[v * 3];
        colors[v * 4 + 1] = raw[v * 3 + 1];
        colors[v * 4 + 2] = raw[v * 3 + 2];
        colors[v * 4 + 3] = 1;
      }
    } else {
      colors = raw;
    }
  }

  const jointsIndex = attributeIndex("JOINTS_0");
  const weightsIndex = attributeIndex("WEIGHTS_0");
  if ((jointsIndex === null) !== (weightsIndex === null)) {
    refuse(
      url,
      `${where}.attributes`,
      "JOINTS_0 and WEIGHTS_0 come as a pair (§54).",
    );
  }
  const joints =
    jointsIndex === null
      ? undefined
      : readJoints(context, jointsIndex, `${where}.attributes.JOINTS_0`);
  const weights =
    weightsIndex === null
      ? undefined
      : readFloats(
          context,
          weightsIndex,
          ["VEC4"],
          "unsigned",
          `${where}.attributes.WEIGHTS_0`,
        );

  const indicesValue = record["indices"];
  let indices: Uint16Array | Uint32Array | undefined;
  if (indicesValue !== undefined) {
    const index = requiredIndex(
      indicesValue,
      context.accessors.length,
      url,
      `${where}.indices`,
    );
    indices = readIndices(context, index, vertexCount, `${where}.indices`);
  }

  const primitiveSize = mode === "triangles" ? 3 : 2;
  const drawCount = indices === undefined ? vertexCount : indices.length;
  if (drawCount % primitiveSize !== 0) {
    refuse(
      url,
      where,
      `a "${mode}" primitive needs a multiple of ${String(primitiveSize)} ${indices === undefined ? "vertices" : "indices"}; got ${String(drawCount)} (§85).`,
      { drawCount, primitiveSize },
    );
  }

  const material = optionalIndex(record, "material", materialCount, url, where);
  const result: GltfPrimitiveRecord = {
    positions,
    mode,
    material,
    ...(normals === undefined ? {} : { normals }),
    ...(uvs === undefined ? {} : { uvs }),
    ...(colors === undefined ? {} : { colors }),
    ...(joints === undefined ? {} : { joints }),
    ...(weights === undefined ? {} : { weights }),
    ...(indices === undefined ? {} : { indices }),
  };
  return result;
}
