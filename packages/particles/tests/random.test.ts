import { describe, expect, it } from "vitest";

import { SeededRandom } from "../src/random.js";

/**
 * `src/random.ts` is a deliberate copy of `@fourjs/motion`'s `SeededRandom` (see
 * that file's provenance note: §3.1 gives `@fourjs/particles` no motion
 * dependency, and `@fourjs/core` has no RNG to hoist into yet). The copy is only
 * worth anything if the two streams are **identical**, so this suite proves it
 * two ways:
 *
 * 1. **Stream identity** — three of `@fourjs/motion`'s own known-answer vectors,
 *    transcribed verbatim from `packages/motion/tests/random.test.ts`
 *    (seeds `0`, `12345`, `0xffffffff`). If either copy's generator or seeding
 *    drifts, these fail here or there.
 * 2. **Independent derivation** — the same numbers re-derived by a BigInt
 *    implementation of the documented formulas, which shares no arithmetic path
 *    with either copy. Agreement is therefore evidence about the recurrence, not
 *    a module comparing itself with itself.
 */

/**
 * Independent BigInt implementation of the documented formulas (SplitMix32-style
 * seed expansion + xorshift128 with the `(11, 8, 19)` triple). Deliberately
 * written with `BigInt` and explicit masking rather than `|0`, `>>>`, and
 * `Math.imul`.
 */
function referenceStream(seed: number): () => number {
  const mask = (v: bigint): bigint => v & 0xffffffffn;
  let a = mask(BigInt(seed >>> 0));
  const mix = (): bigint => {
    a = mask(a + 0x9e3779b9n);
    let t = mask(a ^ (a >> 16n));
    t = mask(t * 0x21f0aaadn);
    t = mask(t ^ (t >> 15n));
    t = mask(t * 0x735a2d97n);
    return mask(t ^ (t >> 15n));
  };
  let x = mask(mix() | 1n);
  let y = mix();
  let z = mix();
  let w = mix();
  return (): number => {
    const t = mask(x ^ mask(x << 11n));
    x = y;
    y = z;
    z = w;
    w = mask(mask(w ^ (w >> 19n)) ^ mask(t ^ (t >> 8n)));
    return Number(w);
  };
}

/**
 * Three of `@fourjs/motion`'s five pinned vectors, copied character for character
 * from `packages/motion/tests/random.test.ts`. **Do not regenerate these from
 * this package** — their whole purpose is to be the *other* copy's numbers.
 */
const MOTION_KNOWN_ANSWERS: readonly {
  seed: number;
  first8: readonly number[];
  draw1000: number;
}[] = [
  {
    seed: 0,
    first8: [
      155036956, 3555408190, 3451112445, 4134021952, 316222940, 2557592688,
      3419281568, 2085296306,
    ],
    draw1000: 1252362924,
  },
  {
    seed: 12345,
    first8: [
      1333010638, 820971536, 3303648126, 3759555397, 243957209, 1181571984,
      3478567544, 2634597564,
    ],
    draw1000: 343218433,
  },
  {
    seed: 0xffffffff,
    first8: [
      3746040542, 1710427422, 1028603318, 3070500734, 679865786, 3588460105,
      2433072078, 107854207,
    ],
    draw1000: 4203989082,
  },
];

/** The first `count` outputs of a fresh stream. */
function draw(seed: number, count: number): number[] {
  const random = new SeededRandom(seed);
  const values: number[] = [];
  for (let i = 0; i < count; i += 1) {
    values.push(random.nextUint32());
  }
  return values;
}

describe("SeededRandom — stream identity with @fourjs/motion (§33)", () => {
  it("matches motion's pinned first eight outputs for three seeds", () => {
    for (const { seed, first8 } of MOTION_KNOWN_ANSWERS) {
      expect(draw(seed, 8), `seed ${seed}`).toEqual([...first8]);
    }
  });

  it("matches motion's pinned output after 1000 draws", () => {
    for (const { seed, draw1000 } of MOTION_KNOWN_ANSWERS) {
      expect(draw(seed, 1000)[999], `seed ${seed}`).toBe(draw1000);
    }
  });

  it("re-derives those vectors from an independent BigInt reference", () => {
    for (const { seed, first8 } of MOTION_KNOWN_ANSWERS) {
      const reference = referenceStream(seed);
      const values: number[] = [];
      for (let i = 0; i < 8; i += 1) {
        values.push(reference());
      }
      expect(values, `seed ${seed}`).toEqual([...first8]);
    }
  });

  it("agrees with the reference over 500 draws", () => {
    for (const { seed } of MOTION_KNOWN_ANSWERS) {
      const random = new SeededRandom(seed);
      const reference = referenceStream(seed);
      for (let i = 0; i < 500; i += 1) {
        expect(random.nextUint32(), `seed ${seed}, draw ${i}`).toBe(
          reference(),
        );
      }
    }
  });
});

describe("SeededRandom — seed contract", () => {
  it("rejects a non-finite seed", () => {
    expect(() => new SeededRandom(Number.NaN)).toThrow(RangeError);
    expect(() => new SeededRandom(Number.NaN)).toThrow(/finite seed/);
    expect(() => new SeededRandom(Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
    expect(() => new SeededRandom(Number.NEGATIVE_INFINITY)).toThrow(
      RangeError,
    );
  });

  it("reduces the seed with ToUint32: negatives wrap, fractions truncate", () => {
    expect(new SeededRandom(-1).seed).toBe(0xffffffff);
    expect(draw(-1, 4)).toEqual(draw(0xffffffff, 4));
    expect(new SeededRandom(1.9).seed).toBe(1);
    expect(draw(1.9, 4)).toEqual(draw(1, 4));
    expect(new SeededRandom(4294967296).seed).toBe(0);
  });

  it("survives seed 0 — the all-zero state is unreachable", () => {
    const values = draw(0, 200);
    expect(new Set(values).size).toBe(200);
  });

  it("decorrelates neighbouring seeds", () => {
    const firsts = new Set<number>();
    for (let seed = 0; seed < 256; seed += 1) {
      firsts.add(new SeededRandom(seed).nextUint32());
    }
    expect(firsts.size).toBe(256);
  });
});

describe("SeededRandom — derived draws", () => {
  it("returns uint32 integers", () => {
    const random = new SeededRandom(99);
    let outOfRange = 0;
    for (let i = 0; i < 20000; i += 1) {
      const value = random.nextUint32();
      if (!Number.isInteger(value) || value < 0 || value >= 4294967296) {
        outOfRange += 1;
      }
    }
    expect(outOfRange).toBe(0);
  });

  it("scales nextFloat01 exactly by 2⁻³² and stays in [0, 1)", () => {
    const random = new SeededRandom(7);
    const twin = random.clone();
    let min = 1;
    let max = 0;
    /*
     * The draws are checked in plain JS and asserted ONCE, rather than through
     * 60,000 `expect()` calls (20,000 iterations x 3). The arithmetic is free;
     * the assertion machinery is not, and at 60,000 calls this test took ~5.4s
     * and failed vitest's 5s deadline -- a timeout that read as a broken PRNG.
     *
     * The proof that the draws were never the cost is in this same file:
     * "is uniform enough" makes 80,000 draws in 17ms, four times the work,
     * because it asserts nine times instead of a quarter of a million.
     *
     * Coverage is unchanged -- every one of the 20,000 values is still checked
     * against all three conditions, and the first violation is reported with
     * its index, which a bare `expect` in a loop did not give either.
     */
    let violation: string | undefined;
    for (let i = 0; i < 20000; i += 1) {
      const value = random.nextFloat01();
      const expected = twin.nextUint32() / 4294967296;
      if (
        violation === undefined &&
        (value !== expected || value < 0 || value >= 1)
      ) {
        violation = `draw ${i}: got ${value}, expected ${expected} in [0, 1)`;
      }
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    expect(violation).toBeUndefined();
    expect(min).toBeLessThan(0.001);
    expect(max).toBeGreaterThan(0.999);
  });

  it("is uniform enough for spawn distributions", () => {
    const random = new SeededRandom(31337);
    const buckets = new Array<number>(8).fill(0);
    const draws = 80000;
    let sum = 0;
    for (let i = 0; i < draws; i += 1) {
      const value = random.nextFloat01();
      sum += value;
      buckets[Math.floor(value * 8)] += 1;
    }
    expect(sum / draws).toBeCloseTo(0.5, 2);
    for (const count of buckets) {
      expect(count / draws).toBeGreaterThan(0.11);
      expect(count / draws).toBeLessThan(0.14);
    }
  });

  it("maps nextRange onto [min, max), degenerate and reversed included", () => {
    const random = new SeededRandom(5);
    // Same shape as the test above, for the same reason: this one ran 3.8s of a
    // 5s budget on 44,000 `expect()` calls and was one slow machine from red.
    let outside: string | undefined;
    for (let i = 0; i < 20000; i += 1) {
      const value = random.nextRange(-Math.PI, Math.PI);
      if (outside === undefined && !(value >= -Math.PI && value < Math.PI)) {
        outside = `draw ${i}: ${value} outside [-PI, PI)`;
      }
    }
    expect(outside).toBeUndefined();
    expect(random.nextRange(2.5, 2.5)).toBe(2.5);
    let reversed: string | undefined;
    for (let i = 0; i < 2000; i += 1) {
      const value = random.nextRange(10, 4);
      if (reversed === undefined && !(value > 4 && value <= 10)) {
        reversed = `reversed draw ${i}: ${value} outside (4, 10]`;
      }
    }
    expect(reversed).toBeUndefined();
  });

  it("consumes exactly one output per derived draw", () => {
    const uints = new SeededRandom(64);
    const floats = new SeededRandom(64);
    const ranges = new SeededRandom(64);
    for (let i = 0; i < 100; i += 1) {
      const expected = uints.nextUint32();
      expect(floats.nextFloat01()).toBe(expected / 4294967296);
      expect(ranges.nextRange(0, 4294967296)).toBe(expected);
    }
  });
});

describe("SeededRandom — streams (§33, §34)", () => {
  it("reproduces a sequence from the same seed and diverges across seeds", () => {
    const a = new SeededRandom(0xbeef);
    const b = new SeededRandom(0xbeef);
    for (let i = 0; i < 500; i += 1) {
      expect(a.nextUint32()).toBe(b.nextUint32());
    }
    expect(new SeededRandom(1).nextUint32()).not.toBe(
      new SeededRandom(2).nextUint32(),
    );
  });

  it("clones at the current position, then runs independently", () => {
    const random = new SeededRandom(77);
    for (let i = 0; i < 10; i += 1) {
      random.nextUint32();
    }
    const copy = random.clone();
    expect(copy.seed).toBe(random.seed);
    for (let i = 0; i < 50; i += 1) {
      expect(copy.nextUint32()).toBe(random.nextUint32());
    }
    for (let i = 0; i < 5; i += 1) {
      random.nextUint32();
    }
    expect(copy.nextUint32()).not.toBe(random.nextUint32());
  });

  it("rewinds to the seed on reset", () => {
    const random = new SeededRandom(4242);
    const expected = draw(4242, 20);
    for (let i = 0; i < 500; i += 1) {
      random.nextUint32();
    }
    expect(random.reset()).toBe(random);
    const replayed: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      replayed.push(random.nextUint32());
    }
    expect(replayed).toEqual(expected);
  });
});
