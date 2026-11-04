/**
 * Bounded KTX2 container parser (§77, §96; R-30c). Reads the header, level
 * index, Data Format Descriptor basics, supercompression scheme and key/value
 * data of a KTX 2.0 file **without decoding any texel**. Every header-declared
 * offset and length is checked against the actual byte length, and the sum of
 * the declared level sizes must fit `maximumWorkingBytes`, before a caller
 * hands the file to a transcoder.
 */
import { FourError } from "@fourjs/core";

import { DEFAULT_IMAGE_WORKING_BYTES } from "./bounded-png.js";

/** The twelve-byte KTX 2.0 file identifier. */
export const KTX2_IDENTIFIER: readonly number[] = Object.freeze([
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** Fixed header + index size (identifier through `sgdByteLength`). */
export const KTX2_HEADER_BYTES = 80;
/** Most mip levels a 2^31 extent can have; also the parser's hard cap. */
const MAX_LEVELS = 32;

export type Ktx2Supercompression = "none" | "basislz" | "zstd" | "zlib";
/** Basis Universal codec named by the DFD colour model. */
export type Ktx2BasisCodec = "etc1s" | "uastc";

export interface Ktx2Level {
  readonly byteOffset: number;
  readonly byteLength: number;
  readonly uncompressedByteLength: number;
}

export interface Ktx2Dfd {
  readonly colorModel: number;
  readonly colorPrimaries: number;
  readonly transferFunction: number;
  readonly flags: number;
  /** `"etc1s"` (model 163) / `"uastc"` (model 166), else `undefined`. */
  readonly basis: Ktx2BasisCodec | undefined;
}

export interface Ktx2Info {
  readonly vkFormat: number;
  readonly typeSize: number;
  readonly width: number;
  readonly height: number;
  /** 0 for a 2D image. */
  readonly depth: number;
  /** 0 for a non-array texture. */
  readonly layerCount: number;
  readonly faceCount: number;
  /** As declared; 0 means "generate at load" (reported as one stored level). */
  readonly declaredLevelCount: number;
  readonly supercompression: Ktx2Supercompression;
  readonly levels: readonly Ktx2Level[];
  readonly dfd: Ktx2Dfd | undefined;
  readonly keyValues: ReadonlyMap<string, Uint8Array>;
  /**
   * The `KTXorientation` key/value as text (`"rd"` rows top-down like PNG,
   * `"ru"` rows bottom-up), trailing NUL removed; `undefined` when the key is
   * absent (which readers treat as `"rd"`, the KTX2 default for 2D).
   */
  readonly orientation: string | undefined;
  readonly globalDataOffset: number;
  readonly globalDataLength: number;
}

export interface Ktx2ParseOptions {
  /** Ceiling on the sum of level byte lengths + file size. Default 128 MiB. */
  readonly maximumWorkingBytes?: number;
}

const SUPERCOMPRESSION: readonly Ktx2Supercompression[] = [
  "none",
  "basislz",
  "zstd",
  "zlib",
];

const refuse = (message: string): FourError =>
  new FourError("UNTRUSTED_INPUT_REJECTED", message, {
    context: { loader: "ktx2" },
  });

/** Parses a KTX2 file. Throws `UNTRUSTED_INPUT_REJECTED` on anything malformed. */
export function parseKtx2(
  data: ArrayBuffer,
  options: Ktx2ParseOptions = {},
): Ktx2Info {
  const limit = options.maximumWorkingBytes ?? DEFAULT_IMAGE_WORKING_BYTES;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError(
      "maximumWorkingBytes must be a positive safe integer.",
    );
  }
  const total = data.byteLength;
  if (total < KTX2_HEADER_BYTES)
    throw refuse("KTX2 data is shorter than its header.");
  if (total > limit)
    throw refuse("KTX2 data exceeds the working-memory budget.");
  const bytes = new Uint8Array(data);
  for (let i = 0; i < 12; i++) {
    if (bytes[i] !== KTX2_IDENTIFIER[i])
      throw refuse("Not a KTX2 file (bad identifier).");
  }
  const view = new DataView(data);
  const u32 = (offset: number): number => view.getUint32(offset, true);
  const u64 = (offset: number): number => {
    const value = view.getBigUint64(offset, true);
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      throw refuse("KTX2 64-bit field is out of range.");
    return Number(value);
  };
  const inRange = (offset: number, length: number): boolean =>
    offset <= total && length <= total - offset;

  const width = u32(20);
  const height = u32(24);
  const depth = u32(28);
  const layerCount = u32(32);
  const faceCount = u32(36);
  const declaredLevelCount = u32(40);
  const scheme = u32(44);
  if (width < 1) throw refuse("KTX2 pixelWidth must be at least 1.");
  if (faceCount !== 1 && faceCount !== 6)
    throw refuse("KTX2 faceCount must be 1 or 6.");
  if (declaredLevelCount > MAX_LEVELS)
    throw refuse("KTX2 levelCount is implausible.");
  if (scheme >= SUPERCOMPRESSION.length)
    throw refuse(`Unsupported KTX2 supercompression scheme ${String(scheme)}.`);
  if (height === 0 && depth !== 0)
    throw refuse("KTX2 depth needs a non-zero height.");

  if (faceCount === 6 && (width !== height || depth !== 0))
    throw refuse("KTX2 cube maps must be square and have no depth.");

  const storedLevels = Math.max(1, declaredLevelCount);
  const indexEnd = KTX2_HEADER_BYTES + storedLevels * 24;
  if (indexEnd > total)
    throw refuse("KTX2 level index runs past the end of the data.");

  let sum = total;
  const copies = Math.max(1, layerCount) * faceCount;
  const levels: Ktx2Level[] = [];
  for (let i = 0; i < storedLevels; i++) {
    const at = KTX2_HEADER_BYTES + i * 24;
    const level: Ktx2Level = {
      byteOffset: u64(at),
      byteLength: u64(at + 8),
      uncompressedByteLength: u64(at + 16),
    };
    if (!inRange(level.byteOffset, level.byteLength)) {
      throw refuse(`KTX2 level ${String(i)} runs past the end of the data.`);
    }
    if (level.byteOffset < indexEnd) {
      throw refuse(`KTX2 level ${String(i)} overlaps the header.`);
    }
    for (const prior of levels) {
      if (
        level.byteLength > 0 &&
        prior.byteLength > 0 &&
        level.byteOffset < prior.byteOffset + prior.byteLength &&
        prior.byteOffset < level.byteOffset + level.byteLength
      ) {
        throw refuse(`KTX2 level ${String(i)} overlaps another level.`);
      }
    }
    sum += level.uncompressedByteLength * copies;
    if (!Number.isSafeInteger(sum) || sum > limit) {
      throw refuse(
        "KTX2 declared level sizes exceed the working-memory budget.",
      );
    }
    levels.push(Object.freeze(level));
  }

  const dfdOffset = u32(48);
  const dfdLength = u32(52);
  const kvdOffset = u32(56);
  const kvdLength = u32(60);
  const sgdOffset = u64(64);
  const sgdLength = u64(72);
  if (
    !inRange(dfdOffset, dfdLength) ||
    !inRange(kvdOffset, kvdLength) ||
    !inRange(sgdOffset, sgdLength)
  ) {
    throw refuse(
      "KTX2 descriptor, key/value or global-data range runs past the end of the data.",
    );
  }

  let dfd: Ktx2Dfd | undefined;
  if (dfdLength > 0) {
    if (dfdLength < 28)
      throw refuse("KTX2 DFD is too short for a basic descriptor block.");
    // Word 0 is dfdTotalSize; the basic block follows.
    const block = dfdOffset + 4;
    const colorModel = bytes[block + 8];
    dfd = Object.freeze({
      colorModel,
      colorPrimaries: bytes[block + 9],
      transferFunction: bytes[block + 10],
      flags: bytes[block + 11],
      basis:
        colorModel === 163 ? "etc1s" : colorModel === 166 ? "uastc" : undefined,
    });
  }

  const keyValues = new Map<string, Uint8Array>();
  let cursor = kvdOffset;
  const kvdEnd = kvdOffset + kvdLength;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  while (cursor < kvdEnd) {
    if (kvdEnd - cursor < 4) throw refuse("KTX2 key/value data is truncated.");
    const entry = u32(cursor);
    cursor += 4;
    if (entry < 2 || entry > kvdEnd - cursor)
      throw refuse("KTX2 key/value entry runs past its block.");
    const slice = bytes.subarray(cursor, cursor + entry);
    const nul = slice.indexOf(0);
    if (nul < 1) throw refuse("KTX2 key/value key is empty or unterminated.");
    let key: string;
    try {
      key = decoder.decode(slice.subarray(0, nul));
    } catch {
      throw refuse("KTX2 key is not valid UTF-8.");
    }
    keyValues.set(key, slice.slice(nul + 1));
    cursor += Math.ceil(entry / 4) * 4;
  }

  const orientationBytes = keyValues.get("KTXorientation");
  let orientation: string | undefined;
  if (orientationBytes !== undefined) {
    const end = orientationBytes.indexOf(0);
    orientation = String.fromCharCode(
      ...orientationBytes.subarray(
        0,
        end === -1 ? orientationBytes.length : end,
      ),
    );
  }

  return Object.freeze({
    vkFormat: u32(12),
    typeSize: u32(16),
    width,
    height,
    depth,
    layerCount,
    faceCount,
    declaredLevelCount,
    supercompression: SUPERCOMPRESSION[scheme],
    levels: Object.freeze(levels),
    dfd,
    keyValues,
    orientation,
    globalDataOffset: sgdOffset,
    globalDataLength: sgdLength,
  });
}
