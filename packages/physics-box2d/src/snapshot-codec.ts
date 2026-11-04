/**
 * Byte codec for the Box2D adapter's §34 snapshot envelope (W8.3).
 *
 * `@box2d/core` has no serialization of its own, so the adapter writes an
 * explicit little-endian binary format: every number that is a float goes in as
 * an IEEE-754 float64 (bit-exact, `-0` included), counts and ids as uint32,
 * strings as a uint32 byte length plus UTF-8. Nothing is parsed from text.
 */

import { FourError } from "@fourjs/core";

const ERROR_CODE = "INVALID_APPLICATION_STATE";

/** The envelope magic, the bytes `FJB2` read as a little-endian uint32. */
export const SNAPSHOT_MAGIC = 0x3242_4a46;

/** Bumped whenever the layout below changes. */
export const SNAPSHOT_FORMAT_VERSION = 1;

/** Growable little-endian writer. */
export class SnapshotWriter {
  #bytes = new Uint8Array(1024);
  #view = new DataView(this.#bytes.buffer);
  #length = 0;

  #reserve(extra: number): void {
    const needed = this.#length + extra;
    if (needed <= this.#bytes.length) {
      return;
    }
    let capacity = this.#bytes.length;
    while (capacity < needed) {
      capacity *= 2;
    }
    const grown = new Uint8Array(capacity);
    grown.set(this.#bytes.subarray(0, this.#length));
    this.#bytes = grown;
    this.#view = new DataView(grown.buffer);
  }

  u8(value: number): void {
    this.#reserve(1);
    this.#view.setUint8(this.#length, value);
    this.#length += 1;
  }

  bool(value: boolean): void {
    this.u8(value ? 1 : 0);
  }

  u32(value: number): void {
    this.#reserve(4);
    this.#view.setUint32(this.#length, value, true);
    this.#length += 4;
  }

  f64(value: number): void {
    this.#reserve(8);
    this.#view.setFloat64(this.#length, value, true);
    this.#length += 8;
  }

  str(value: string): void {
    const encoded = new TextEncoder().encode(value);
    this.u32(encoded.length);
    this.#reserve(encoded.length);
    this.#bytes.set(encoded, this.#length);
    this.#length += encoded.length;
  }

  finish(): ArrayBuffer {
    return this.#bytes.slice(0, this.#length).buffer;
  }
}

/** Bounds-checked little-endian reader; every overrun is a `FourError`. */
export class SnapshotReader {
  readonly #view: DataView;
  readonly #bytes: Uint8Array;
  #offset = 0;

  constructor(buffer: ArrayBuffer) {
    this.#view = new DataView(buffer);
    this.#bytes = new Uint8Array(buffer);
  }

  #take(count: number): number {
    if (this.#offset + count > this.#bytes.length) {
      throw new FourError(
        ERROR_CODE,
        "Snapshot is truncated: the envelope ends before its declared contents (§34).",
        { context: { offset: this.#offset, wanted: count } },
      );
    }
    const at = this.#offset;
    this.#offset += count;
    return at;
  }

  u8(): number {
    return this.#view.getUint8(this.#take(1));
  }

  bool(): boolean {
    return this.u8() !== 0;
  }

  u32(): number {
    return this.#view.getUint32(this.#take(4), true);
  }

  f64(): number {
    return this.#view.getFloat64(this.#take(8), true);
  }

  str(): string {
    const length = this.u32();
    const at = this.#take(length);
    return new TextDecoder().decode(this.#bytes.subarray(at, at + length));
  }

  /** Whether every byte has been consumed. */
  get done(): boolean {
    return this.#offset === this.#bytes.length;
  }
}
