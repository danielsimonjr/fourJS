import { FourError } from "@fourjs/core";

/**
 * Copies a single-memory Wasm32 codec and caps its declared linear memory.
 * The WebAssembly runtime enforces this maximum for guest memory.grow calls,
 * including those in a start function before instantiation returns.
 * Codecs must define their own unshared memory; imported/shared/memory64 heaps
 * are refused. Existing smaller maxima are preserved, and byte budgets are
 * rounded down to whole 64 KiB pages. This bounds the codec's linear memory,
 * not JavaScript host allocations, stacks, or engine compilation allocations.
 * The result is validated without instantiation. Instantiate the returned
 * bytes, not the original module.
 */
export function limitWasmMemory(
  binary: Uint8Array,
  maximumBytes: number,
): Uint8Array<ArrayBuffer> {
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 65536 ||
    maximumBytes > 4294967296
  )
    throw new RangeError(
      "maximumBytes must be a safe integer from 64 KiB through 4 GiB.",
    );
  const fail = (): never => {
    throw new FourError(
      "UNTRUSTED_INPUT_REJECTED",
      "Codec requires a valid single defined unshared Wasm32 memory within the budget.",
    );
  };
  // Parse and return the same snapshot even when the caller passes a view
  // backed by shared memory that another thread can subsequently mutate.
  binary = new Uint8Array(binary);
  if (
    binary.length < 8 ||
    binary[0] !== 0 ||
    binary[1] !== 97 ||
    binary[2] !== 115 ||
    binary[3] !== 109 ||
    binary[4] !== 1 ||
    binary[5] !== 0 ||
    binary[6] !== 0 ||
    binary[7] !== 0
  )
    fail();
  let cursor = 8;
  let boundary = binary.length;
  const read = (): number => {
    let value = 0;
    let shift = 0;
    while (true) {
      if (cursor >= boundary) fail();
      const byte = binary[cursor++];
      if (shift === 28 && (byte & 0xf0) !== 0) fail();
      value += (byte & 127) * 2 ** shift;
      if ((byte & 128) === 0) return value;
      shift += 7;
    }
  };
  const skipName = (): void => {
    const size = read();
    if (size > boundary - cursor) fail();
    cursor += size;
  };
  const encode = (value: number): number[] => {
    const out: number[] = [];
    do {
      const byte = value % 128;
      value = Math.floor(value / 128);
      out.push(byte | (value ? 128 : 0));
    } while (value);
    return out;
  };
  let memoryStart = -1;
  let memoryEnd = -1;
  let replacement: number[] = [];
  while (cursor < binary.length) {
    boundary = binary.length;
    const start = cursor;
    const section = binary[cursor++];
    const length = read();
    if (length > binary.length - cursor) fail();
    const end = cursor + length;
    boundary = end;
    if (section === 2) {
      const count = read();
      for (let i = 0; i < count; i += 1) {
        skipName();
        skipName();
        if (cursor >= end) fail();
        const kind = binary[cursor++];
        if (kind === 0) read();
        else if (kind === 1) {
          if (cursor >= end || ![0x70, 0x6f].includes(binary[cursor++])) fail();
          const flags = read();
          if (flags > 1) fail();
          read();
          if (flags === 1) read();
        } else if (kind === 3) {
          if (cursor + 2 > end) fail();
          cursor += 2;
        } else if (kind === 4) {
          read();
          read();
        } else fail(); // Imported memory has a separately supplied host maximum.
      }
      if (cursor !== end) fail();
    } else if (section === 5) {
      if (memoryStart !== -1 || read() !== 1) fail();
      const flags = read();
      if (flags > 1) fail();
      const initial = read();
      const authoredMaximum = flags === 1 ? read() : 65536;
      const maximum = Math.min(
        authoredMaximum,
        Math.floor(maximumBytes / 65536),
      );
      if (initial > maximum || authoredMaximum > 65536 || cursor !== end)
        fail();
      const payload = [1, 1, ...encode(initial), ...encode(maximum)];
      replacement = [5, ...encode(payload.length), ...payload];
      memoryStart = start;
      memoryEnd = end;
    }
    cursor = end;
  }
  if (memoryStart === -1) fail();
  const result = new Uint8Array(
    binary.length - (memoryEnd - memoryStart) + replacement.length,
  );
  result.set(binary.subarray(0, memoryStart));
  result.set(replacement, memoryStart);
  result.set(binary.subarray(memoryEnd), memoryStart + replacement.length);
  // Let the engine check sections not interpreted here, import types, index
  // references, and section ordering. Never return malformed executable code
  // just because its memory declaration was readable.
  if (typeof WebAssembly === "undefined" || !WebAssembly.validate(result))
    fail();
  return result;
}
