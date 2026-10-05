/**
 * Header probes for encoded raster formats (§96).
 *
 * A probe reads only the dimensions an encoded payload *claims*, so
 * {@link createTextureLoader} can refuse a decompression bomb before the
 * codec runs. Unrecognised bytes return `undefined` — "unknown", not "fine" —
 * and the post-decode check still runs.
 */

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

function u16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function u16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

/** PNG IHDR — big-endian width/height at bytes 16 and 20. */
export function probePng(data: ArrayBuffer): ImageDimensions | undefined {
  const bytes = new Uint8Array(data);
  if (bytes.length < 24) return undefined;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i += 1) {
    if (bytes[i] !== signature[i]) return undefined;
  }
  if (
    bytes[12] !== 0x49 ||
    bytes[13] !== 0x48 ||
    bytes[14] !== 0x44 ||
    bytes[15] !== 0x52
  ) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * JPEG SOF0/SOF1/SOF2 — scan markers until a Start Of Frame, then read
 * precision, height, width. APP/COM/DHT payloads are skipped by length.
 */
export function probeJpeg(data: ArrayBuffer): ImageDimensions | undefined {
  const bytes = new Uint8Array(data);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return undefined;
  }
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return undefined;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) return undefined; // SOS without SOF
    if (offset + 1 >= bytes.length) return undefined;
    const length = u16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return undefined;
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      if (length < 7 || offset + 7 > bytes.length) return undefined;
      const height = u16be(bytes, offset + 3);
      const width = u16be(bytes, offset + 5);
      return { width, height };
    }
    offset += length;
  }
  return undefined;
}

/**
 * WebP (RIFF) canvas size: VP8 (lossy), VP8L (lossless), or VP8X (extended).
 */
export function probeWebp(data: ArrayBuffer): ImageDimensions | undefined {
  const bytes = new Uint8Array(data);
  if (bytes.length < 30) return undefined;
  const ascii = (start: number, n: number): string =>
    String.fromCharCode(...bytes.subarray(start, start + n));
  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WEBP") return undefined;
  const fourcc = ascii(12, 4);
  if (fourcc === "VP8 " && bytes.length >= 30) {
    const width = u16le(bytes, 26) & 0x3fff;
    const height = u16le(bytes, 28) & 0x3fff;
    return { width, height };
  }
  if (fourcc === "VP8L" && bytes.length >= 25) {
    const bits =
      bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (fourcc === "VP8X" && bytes.length >= 30) {
    return {
      width: u24le(bytes, 24) + 1,
      height: u24le(bytes, 27) + 1,
    };
  }
  return undefined;
}

/** First matching PNG, JPEG, or WebP probe; `undefined` when none recognise. */
export function probeImage(data: ArrayBuffer): ImageDimensions | undefined {
  return probePng(data) ?? probeJpeg(data) ?? probeWebp(data);
}
