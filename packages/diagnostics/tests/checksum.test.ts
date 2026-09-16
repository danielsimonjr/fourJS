import { describe, expect, it } from "vitest";

import { createChecksum, hashFloats } from "../src/checksum.js";

/**
 * Committed known-answer vectors (§33, D6).
 *
 * These uint32 values are the *truth* for the fourJS checksum: they were
 * computed once from the D6 definition and cross-checked against an independent
 * reference implementation, and any change to `checksum.ts` that moves them is
 * a breaking change to every committed golden hash (phase exits, §92
 * determinism suites). They must never be "updated to match" a new
 * implementation — the implementation is updated to match them.
 */
const KNOWN_ANSWERS: ReadonlyArray<
  readonly [string, readonly number[], number]
> = [
  // Empty sequence digests to the bare FNV-1a offset basis.
  ["empty", [], 2166136261],
  ["zero", [0], 2615243109],
  ["pair", [1.5, -2.25], 4216389416],
  ["mixed", [1e5, -1e5, 0.000001], 2854210778],
];

describe("hashFloats known answers", () => {
  it.each(KNOWN_ANSWERS)(
    "hashes %s to its committed digest",
    (_name, xs, expected) => {
      expect(hashFloats(xs)).toBe(expected);
    },
  );

  it("returns uint32 values", () => {
    for (const [, xs, expected] of KNOWN_ANSWERS) {
      expect(Number.isInteger(expected)).toBe(true);
      expect(expected).toBeGreaterThanOrEqual(0);
      expect(expected).toBeLessThanOrEqual(0xffffffff);
      expect(hashFloats(xs) >>> 0).toBe(hashFloats(xs));
    }
  });
});

describe("signed zero", () => {
  it("hashes -0 identically to +0", () => {
    expect(hashFloats([-0])).toBe(hashFloats([0]));
    expect(hashFloats([-0])).toBe(2615243109);
  });

  it("hashes -0 identically to +0 inside a longer sequence", () => {
    expect(hashFloats([1.5, -0, -2.25])).toBe(hashFloats([1.5, 0, -2.25]));
  });

  it("normalizes values that quantize to -0", () => {
    // Math.round(-5e-7 * 1e6) is Math.round(-0.5), i.e. -0.
    expect(hashFloats([-5e-7])).toBe(hashFloats([0]));
  });
});

describe("rejected inputs", () => {
  it("throws RangeError on NaN", () => {
    expect(() => hashFloats([Number.NaN])).toThrow(RangeError);
    expect(() => hashFloats([Number.NaN])).toThrow(/finite/i);
    expect(() => {
      createChecksum().addFloat(Number.NaN);
    }).toThrow(RangeError);
  });

  it("throws RangeError on infinities", () => {
    expect(() => hashFloats([Number.POSITIVE_INFINITY])).toThrow(RangeError);
    expect(() => hashFloats([Number.NEGATIVE_INFINITY])).toThrow(RangeError);
  });

  it("throws RangeError when quantization leaves the 53-bit-safe range", () => {
    // 1e10 * 1e6 = 1e16 > Number.MAX_SAFE_INTEGER.
    expect(() => hashFloats([1e10])).toThrow(RangeError);
    expect(() => hashFloats([-1e10])).toThrow(RangeError);
    expect(() => hashFloats([1e9])).not.toThrow();
  });

  it("throws on the offending value, leaving earlier values absorbed", () => {
    const checksum = createChecksum();
    checksum.addFloat(1.5);
    expect(() => {
      checksum.addFloat(Number.NaN);
    }).toThrow(RangeError);
    expect(checksum.digest()).toBe(hashFloats([1.5]));
  });
});

describe("quantization", () => {
  it("snaps sub-grid magnitudes to zero", () => {
    // 1e-7 * 1e6 = 0.1 (well under a half-grid step) → 0.
    expect(hashFloats([1e-7])).toBe(hashFloats([0]));
    expect(hashFloats([-1e-7])).toBe(hashFloats([0]));
    expect(hashFloats([4.9e-7])).toBe(hashFloats([0]));
  });

  it("rounds halves up (Math.round semantics: ties toward +Infinity)", () => {
    // 5e-7 * 1e6 is exactly 0.5 → 1, i.e. the same grid cell as 1e-6.
    expect(hashFloats([5e-7])).toBe(hashFloats([0.000001]));
    // 1.5e-6 → 2e-6 and 2.5e-6 → 3e-6: both ties go up, not to even.
    expect(hashFloats([1.5e-6])).toBe(hashFloats([2e-6]));
    expect(hashFloats([2.5e-6])).toBe(hashFloats([3e-6]));
    // Negative ties round toward +Infinity too: -1.5e-6 → -1e-6.
    expect(hashFloats([-1.5e-6])).toBe(hashFloats([-1e-6]));
  });

  it("distinguishes adjacent grid cells", () => {
    expect(hashFloats([0.000001])).not.toBe(hashFloats([0]));
    expect(hashFloats([0.000001])).not.toBe(hashFloats([0.000002]));
    expect(hashFloats([-0.000001])).not.toBe(hashFloats([0.000001]));
  });

  it("collapses values inside one grid cell", () => {
    expect(hashFloats([1.5])).toBe(hashFloats([1.5 + 1e-9]));
  });
});

describe("large magnitudes within the §41 envelope", () => {
  // §41 supports coordinates within roughly 1e5 units of the origin; the
  // two-word encoding must stay exact across that whole envelope.
  const ENVELOPE_VALUES = [1e5, -1e5, 99999.999999, -99999.999999, 65536.5];

  it("quantizes envelope values to exactly representable integers", () => {
    for (const x of ENVELOPE_VALUES) {
      const q = Math.round(x * 1e6);
      expect(Number.isSafeInteger(q)).toBe(true);
      // The product itself is exact, so rounding changes nothing.
      expect(x * 1e6).toBe(q);
      // These all need the high word: |q| >= 2^32.
      expect(Math.abs(q)).toBeGreaterThanOrEqual(4294967296);
    }
  });

  it("keeps envelope values distinct down to one grid step", () => {
    expect(hashFloats([1e5])).not.toBe(hashFloats([1e5 + 1e-6]));
    expect(hashFloats([1e5])).not.toBe(hashFloats([-1e5]));
    expect(hashFloats([99999.999999])).not.toBe(hashFloats([99999.999998]));
  });

  it("distinguishes values that differ only in the high word", () => {
    // 4294.967296 * 1e6 = 2^32: low word 0, high word 1 — must not collide
    // with the value whose low word is 0 and high word is 0.
    expect(hashFloats([4294.967296])).not.toBe(hashFloats([0]));
    expect(hashFloats([4294.967296])).not.toBe(hashFloats([-4294.967296]));
  });
});

describe("incremental hasher", () => {
  it("matches hashFloats value by value", () => {
    for (const [, xs, expected] of KNOWN_ANSWERS) {
      const checksum = createChecksum();
      for (const x of xs) {
        checksum.addFloat(x);
      }
      expect(checksum.digest()).toBe(expected);
    }
  });

  it("matches hashFloats when fed in chunks", () => {
    const values = [1e5, -1e5, 0.000001, 1.5, -2.25, 0];
    const checksum = createChecksum();
    checksum.addFloats(values.slice(0, 2));
    checksum.addFloat(values[2]);
    checksum.addFloats(values.slice(3));
    expect(checksum.digest()).toBe(hashFloats(values));
  });

  it("digests an empty hasher to the offset basis", () => {
    expect(createChecksum().digest()).toBe(2166136261);
  });

  it("leaves digest() non-destructive and resumable", () => {
    const checksum = createChecksum();
    checksum.addFloats([1.5, -2.25]);
    expect(checksum.digest()).toBe(4216389416);
    expect(checksum.digest()).toBe(4216389416);
    checksum.addFloat(0);
    expect(checksum.digest()).toBe(hashFloats([1.5, -2.25, 0]));
  });

  it("accepts any iterable, including typed arrays and generators", () => {
    const values = [1.5, -2.25, 0.25];
    function* generate(): Generator<number> {
      yield* values;
    }
    expect(hashFloats(new Float64Array(values))).toBe(hashFloats(values));
    expect(hashFloats(generate())).toBe(hashFloats(values));
    const checksum = createChecksum();
    checksum.addFloats(new Float32Array(values));
    expect(checksum.digest()).toBe(hashFloats(values));
  });
});

describe("determinism", () => {
  it("returns the same digest for the same sequence hashed twice", () => {
    const values = [0, -0, 1.5, -2.25, 1e5, -1e5, 0.000001, 3.14159265];
    expect(hashFloats(values)).toBe(hashFloats(values));
    const first = createChecksum();
    const second = createChecksum();
    first.addFloats(values);
    second.addFloats(values);
    expect(first.digest()).toBe(second.digest());
  });

  it("depends on insertion order", () => {
    expect(hashFloats([1.5, -2.25])).not.toBe(hashFloats([-2.25, 1.5]));
  });

  it("depends on sequence length, not only on the values", () => {
    expect(hashFloats([0])).not.toBe(hashFloats([0, 0]));
  });
});
