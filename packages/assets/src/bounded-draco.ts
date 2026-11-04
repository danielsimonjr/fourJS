/**
 * Bounded Draco mesh decoder (§96; R-30c, the glTF `KHR_draco_mesh_compression`
 * residue). Mirrors the wave-4/7 raw codecs (`bounded-raw-codec.ts`,
 * `bounded-basis.ts`): application-supplied Wasm bytes, heap cap pinned by
 * `limitWasmMemory` before any codec code runs, declared counts and sizes
 * verified against the heap and the finite budgets before anything is copied,
 * and fail-closed poisoning after any ABI failure. No dependency, no glue,
 * no network.
 *
 * ## Raw Draco ABI (no imports)
 *
 * Exports `memory`; `malloc(length) -> ptr`; `free(ptr, length)`; and
 * `decode(ptr, length, infoPtr) -> outPtr` where `ptr/length` is the Draco
 * bitstream of one `KHR_draco_mesh_compression` buffer view (0 on failure).
 * The host allocates {@link DRACO_INFO_BYTES} for `info`; the decoder writes
 * little-endian u32 words there:
 *
 * Attributes the primitive does not name are budgeted and skipped.
 *
 * - `[0]` vertexCount, `[1]` indexCount (0 = non-indexed), `[2]` attributeCount
 *   (1..{@link DRACO_MAX_ATTRIBUTES}), `[3]` indexByteLength, `[4]` index
 *   component bytes (2 or 4; 0 when indexCount is 0);
 * - from word 5, per attribute four words `{ id, componentCount,
 *   componentType, byteLength }` where `id` is the Draco **unique attribute
 *   id** (what the glTF extension's `attributes` map names) and
 *   `componentType` is {@link DRACO_COMPONENT_CODES} (0 float32, 1 uint8,
 *   2 uint16, 3 uint32).
 *
 * The returned `outPtr` addresses the attribute streams in declared order,
 * little-endian and tightly packed, followed by the index stream (Uint16 or
 * Uint32 as declared). The host verifies every count and length against the
 * arithmetic, the budgets and the heap, copies, then frees.
 *
 * Output is deterministic (§33): same bytes, same streams.
 */
import { FourError } from "@fourjs/core";

import { DEFAULT_IMAGE_WORKING_BYTES } from "./bounded-png.js";
import { DEFAULT_MAXIMUM_DECODED_BYTES } from "./texture.js";
import { limitWasmMemory } from "./wasm-memory.js";

/** Most attributes one Draco mesh may declare through the ABI. */
export const DRACO_MAX_ATTRIBUTES = 16;
/** Bytes the host allocates for the `info` block (5 header + 4 per attribute words). */
export const DRACO_INFO_BYTES = 4 * (5 + 4 * DRACO_MAX_ATTRIBUTES);

/** `componentType` words of the raw ABI. */
export const DRACO_COMPONENT_CODES = Object.freeze({
  float32: 0,
  uint8: 1,
  uint16: 2,
  uint32: 3,
});

export interface BoundedDracoDecoderOptions {
  /** Application-pinned Draco decoder Wasm exposing the raw ABI. */
  readonly wasmBinary: Uint8Array;
  /** Linear heap ceiling, including input and output. Default 128 MiB. */
  readonly maximumWorkingBytes?: number;
  /** Decoded attribute + index ceiling in bytes; default 64 MiB. */
  readonly maximumDecodedBytes?: number;
}

/** Draco unique attribute ids named by a primitive's extension `attributes` map. */
export interface DracoAttributeIds {
  readonly POSITION: number;
  readonly NORMAL?: number;
  readonly TEXCOORD_0?: number;
  readonly COLOR_0?: number;
  readonly JOINTS_0?: number;
  readonly WEIGHTS_0?: number;
}

/**
 * The stream shape the glTF loader builds for a primitive. `uvs` are the
 * file's raw `v` (the loader applies the §7a flip); `colors` always carry
 * four floats per vertex (RGB sources gain alpha 1).
 */
export interface DracoStreams {
  readonly vertexCount: number;
  readonly positions: Float32Array;
  readonly normals?: Float32Array;
  readonly uvs?: Float32Array;
  readonly colors?: Float32Array;
  readonly joints?: Uint16Array;
  readonly weights?: Float32Array;
  readonly indices?: Uint16Array | Uint32Array;
}

/** Decodes one Draco bitstream into primitive streams. */
export type DracoDecoder = (
  data: Uint8Array,
  attributeIds: DracoAttributeIds,
) => DracoStreams;

interface RawExports {
  readonly memory: WebAssembly.Memory;
  readonly malloc: (length: number) => number;
  readonly free: (pointer: number, length: number) => void;
  readonly decode: (pointer: number, length: number, info: number) => number;
}

const refuse = (message: string, cause?: unknown): FourError =>
  new FourError("UNTRUSTED_INPUT_REJECTED", message, {
    context: { loader: "bounded-draco" },
    cause,
  });

const SEMANTICS = [
  "POSITION",
  "NORMAL",
  "TEXCOORD_0",
  "COLOR_0",
  "JOINTS_0",
  "WEIGHTS_0",
] as const;
type Semantic = (typeof SEMANTICS)[number];

/** Allowed (componentCount list, componentType list) per semantic. */
const RULES: Readonly<
  Record<Semantic, { counts: readonly number[]; types: readonly number[] }>
> = {
  POSITION: { counts: [3], types: [0] },
  NORMAL: { counts: [3], types: [0] },
  TEXCOORD_0: { counts: [2], types: [0] },
  COLOR_0: { counts: [3, 4], types: [0] },
  JOINTS_0: { counts: [4], types: [1, 2] },
  WEIGHTS_0: { counts: [4], types: [0] },
};
const TYPE_BYTES = [4, 1, 2, 4] as const;

/** Creates a Draco mesh decoder over an application-pinned raw-ABI Wasm. */
export async function createBoundedDracoDecoder(
  options: BoundedDracoDecoderOptions,
): Promise<DracoDecoder> {
  const working = options.maximumWorkingBytes ?? DEFAULT_IMAGE_WORKING_BYTES;
  const decoded = options.maximumDecodedBytes ?? DEFAULT_MAXIMUM_DECODED_BYTES;
  if (!Number.isSafeInteger(decoded) || decoded < 1) {
    throw new RangeError(
      "Draco maximumDecodedBytes must be a positive safe integer.",
    );
  }
  const binary = limitWasmMemory(options.wasmBinary, working);
  let native: RawExports;
  let poisoned = false;
  try {
    const module = await WebAssembly.compile(binary);
    if (WebAssembly.Module.imports(module).length > 0) {
      throw refuse(
        "Unsupported Draco decoder imports; the raw ABI takes none.",
      );
    }
    const exports = (await WebAssembly.instantiate(module, {})).exports;
    if (
      !(exports.memory instanceof WebAssembly.Memory) ||
      typeof exports.malloc !== "function" ||
      typeof exports.free !== "function" ||
      typeof exports.decode !== "function"
    ) {
      throw refuse(
        "Unsupported Draco decoder exports; use a binary built for the raw ABI.",
      );
    }
    native = exports as unknown as RawExports;
  } catch (cause) {
    throw refuse("Unable to initialize the bounded Draco decoder.", cause);
  }

  return (data, attributeIds) => {
    if (poisoned) {
      throw refuse("Draco decoder failed previously; construct a fresh one.");
    }
    const inputLength = data.byteLength;
    if (inputLength < 1) throw refuse("Draco input is empty.");
    if (inputLength > working) {
      throw refuse("Draco input cannot fit the decoder working-memory budget.");
    }
    const requested = new Map<number, Semantic>();
    for (const semantic of SEMANTICS) {
      const id = attributeIds[semantic];
      if (id === undefined) continue;
      if (!Number.isSafeInteger(id) || id < 0 || requested.has(id)) {
        throw refuse(
          `Draco attribute id for ${semantic} is invalid or duplicated.`,
        );
      }
      requested.set(id, semantic);
    }
    if (attributeIds.POSITION === undefined) {
      throw refuse("Draco decoding requires a POSITION attribute id.");
    }
    try {
      const inPtr = native.malloc(inputLength) >>> 0;
      let heap = native.memory.buffer;
      if (
        inPtr === 0 ||
        inPtr > heap.byteLength ||
        inputLength > heap.byteLength - inPtr
      ) {
        throw refuse(
          "Draco input allocation failed inside the bounded decoder.",
        );
      }
      new Uint8Array(heap, inPtr, inputLength).set(data);
      const infoPtr = native.malloc(DRACO_INFO_BYTES) >>> 0;
      heap = native.memory.buffer;
      if (infoPtr === 0 || infoPtr > heap.byteLength - DRACO_INFO_BYTES) {
        throw refuse(
          "Draco info allocation failed inside the bounded decoder.",
        );
      }
      const outPtr = native.decode(inPtr, inputLength, infoPtr) >>> 0;
      heap = native.memory.buffer;
      const view = new DataView(heap);
      const word = (index: number): number =>
        view.getUint32(infoPtr + 4 * index, true);
      const vertexCount = word(0);
      const indexCount = word(1);
      const attributeCount = word(2);
      const indexByteLength = word(3);
      const indexBytes = word(4);
      const bad = (): never => {
        throw refuse(
          "Draco output does not match its header, budgets or bounded heap.",
        );
      };
      if (
        outPtr === 0 ||
        outPtr > heap.byteLength ||
        vertexCount < 1 ||
        attributeCount < requested.size ||
        attributeCount > DRACO_MAX_ATTRIBUTES ||
        (indexCount === 0
          ? indexBytes !== 0 || indexByteLength !== 0
          : (indexBytes !== 2 && indexBytes !== 4) ||
            indexCount * indexBytes !== indexByteLength ||
            (indexBytes === 2 && vertexCount > 65536))
      ) {
        bad();
      }
      let total = indexByteLength;
      const layout: {
        semantic: Semantic;
        components: number;
        type: number;
        offset: number;
        length: number;
      }[] = [];
      const seen = new Set<Semantic>();
      for (let a = 0; a < attributeCount; a += 1) {
        const id = word(5 + 4 * a);
        const components = word(6 + 4 * a);
        const type = word(7 + 4 * a);
        const length = word(8 + 4 * a);
        const semantic = requested.get(id);
        if (
          type > 3 ||
          components < 1 ||
          components > 4 ||
          length !== vertexCount * components * TYPE_BYTES[type] ||
          (semantic !== undefined &&
            (seen.has(semantic) ||
              !RULES[semantic].counts.includes(components) ||
              !RULES[semantic].types.includes(type)))
        ) {
          bad();
        }
        // Attributes the primitive does not name are budgeted and skipped.
        if (semantic !== undefined) {
          seen.add(semantic);
          layout.push({
            semantic,
            components,
            type,
            offset: total - indexByteLength,
            length,
          });
        }
        total += length;
        if (!Number.isSafeInteger(total) || total > decoded) {
          throw refuse("Draco decoded-byte budget was exceeded.");
        }
      }
      if (
        seen.size !== requested.size ||
        inputLength + total > working ||
        total > heap.byteLength - outPtr
      ) {
        bad();
      }
      const streamOf = (semantic: Semantic): (typeof layout)[number] =>
        layout.find(
          (entry) => entry.semantic === semantic,
        ) as (typeof layout)[number];
      const floats = (semantic: Semantic): Float32Array => {
        const entry = streamOf(semantic);
        const out = new Float32Array(vertexCount * entry.components);
        const reader = new DataView(heap, outPtr + entry.offset, entry.length);
        for (let i = 0; i < out.length; i += 1) {
          const value = reader.getFloat32(i * 4, true);
          if (!Number.isFinite(value)) {
            throw refuse(`Draco ${semantic} carries a non-finite float.`);
          }
          out[i] = value;
        }
        return out;
      };
      const positions = floats("POSITION");
      const normals = seen.has("NORMAL") ? floats("NORMAL") : undefined;
      const uvs = seen.has("TEXCOORD_0") ? floats("TEXCOORD_0") : undefined;
      let colors: Float32Array | undefined;
      if (seen.has("COLOR_0")) {
        const raw = floats("COLOR_0");
        if (streamOf("COLOR_0").components === 4) {
          colors = raw;
        } else {
          colors = new Float32Array(vertexCount * 4);
          for (let v = 0; v < vertexCount; v += 1) {
            colors.set(raw.subarray(v * 3, v * 3 + 3), v * 4);
            colors[v * 4 + 3] = 1;
          }
        }
      }
      let joints: Uint16Array | undefined;
      if (seen.has("JOINTS_0")) {
        const entry = streamOf("JOINTS_0");
        const reader = new DataView(heap, outPtr + entry.offset, entry.length);
        joints = new Uint16Array(vertexCount * 4);
        for (let i = 0; i < joints.length; i += 1) {
          joints[i] =
            entry.type === 1
              ? reader.getUint8(i)
              : reader.getUint16(i * 2, true);
        }
      }
      const weights = seen.has("WEIGHTS_0") ? floats("WEIGHTS_0") : undefined;
      let indices: Uint16Array | Uint32Array | undefined;
      if (indexCount > 0) {
        const at = outPtr + total - indexByteLength;
        const reader = new DataView(heap, at, indexByteLength);
        indices =
          indexBytes === 2
            ? new Uint16Array(indexCount)
            : new Uint32Array(indexCount);
        for (let i = 0; i < indexCount; i += 1) {
          const value =
            indexBytes === 2
              ? reader.getUint16(i * 2, true)
              : reader.getUint32(i * 4, true);
          if (value >= vertexCount) {
            throw refuse("Draco index addresses a vertex out of range.");
          }
          indices[i] = value;
        }
      }
      native.free(outPtr, total);
      native.free(infoPtr, DRACO_INFO_BYTES);
      native.free(inPtr, inputLength);
      return Object.freeze({
        vertexCount,
        positions,
        ...(normals === undefined ? {} : { normals }),
        ...(uvs === undefined ? {} : { uvs }),
        ...(colors === undefined ? {} : { colors }),
        ...(joints === undefined ? {} : { joints }),
        ...(weights === undefined ? {} : { weights }),
        ...(indices === undefined ? {} : { indices }),
      });
    } catch (cause) {
      // No `free`: a trap or bad pointer leaves the heap in an unknown state,
      // so poisoning covers the leaked allocations (see bounded-basis.ts).
      poisoned = true;
      if (cause instanceof FourError) throw cause;
      throw refuse(
        "Invalid Draco mesh or exhausted decoder working-memory budget.",
        cause,
      );
    }
  };
}
