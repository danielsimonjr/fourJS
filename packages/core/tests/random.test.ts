import { describe, expect, it } from "vitest";

import { SeededRandom } from "../src/random.js";

// Contention under `bun run test --concurrency=4`: this file passes alone and
// times out at the 5 s default when the Windows runner is busy. Same shape as
// the coverage flake in `packages/render/tests/shape.test.ts`.

/**
 * Independent BigInt implementation of the documented formulas (SplitMix32-style
 * seed expansion + xorshift128 with the `(11, 8, 19)` triple).
 *
 * Deliberately written with `BigInt` and explicit masking rather than `|0`,
 * `>>>`, and `Math.imul`: it shares no arithmetic path with `random.ts`, so
 * agreement between the two is evidence that the implementation matches the
 * documented recurrence rather than evidence that it agrees with itself. The
 * pinned literals further down were produced by *this* reference.
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
 * Known-answer vectors: the first eight outputs and the thousandth output for
 * five seeds, produced by {@link referenceStream}. A change to the generator,
 * the seeding, or the draw order breaks these — which is the point (§33: the
 * stream is a contract, not an implementation detail).
 */
const KNOWN_ANSWERS: readonly {
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
    seed: 1,
    first8: [
      2233662645, 3039942649, 311921131, 3056118715, 612183711, 533249014,
      2982064437, 1111007690,
    ],
    draw1000: 3182029784,
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
    seed: 0xdeadbeef,
    first8: [
      2869057879, 3192775043, 601419942, 768854004, 2493705208, 1160921366,
      2710295766, 315902836,
    ],
    draw1000: 2197019646,
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

describe(
  "SeededRandom — known answers (xorshift128, §33)",
  { timeout: 30_000 },
  () => {
    it("matches the pinned first eight outputs for five seeds", () => {
      for (const { seed, first8 } of KNOWN_ANSWERS) {
        expect(draw(seed, 8), `seed ${seed}`).toEqual([...first8]);
      }
    });

    it("matches the pinned state after 1000 draws", () => {
      for (const { seed, draw1000 } of KNOWN_ANSWERS) {
        const values = draw(seed, 1000);
        expect(values[999], `seed ${seed}`).toBe(draw1000);
      }
    });

    it("agrees with an independent BigInt reference over 500 draws", () => {
      for (const { seed } of KNOWN_ANSWERS) {
        const random = new SeededRandom(seed);
        const reference = referenceStream(seed);
        for (let i = 0; i < 500; i += 1) {
          expect(random.nextUint32(), `seed ${seed}, draw ${i}`).toBe(
            reference(),
          );
        }
      }
    });
  },
);

describe("SeededRandom — seed contract", { timeout: 30_000 }, () => {
  it("rejects a non-finite seed", () => {
    expect(() => new SeededRandom(Number.NaN)).toThrow(RangeError);
    expect(() => new SeededRandom(Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
    expect(() => new SeededRandom(Number.NEGATIVE_INFINITY)).toThrow(
      RangeError,
    );
    expect(() => new SeededRandom(Number.NaN)).toThrow(/finite seed/);
  });

  it("reduces the seed with ToUint32: negatives wrap, fractions truncate", () => {
    expect(new SeededRandom(-1).seed).toBe(0xffffffff);
    expect(draw(-1, 4)).toEqual(draw(0xffffffff, 4));

    expect(new SeededRandom(1.9).seed).toBe(1);
    expect(draw(1.9, 4)).toEqual(draw(1, 4));

    expect(new SeededRandom(4294967296).seed).toBe(0);
    expect(draw(4294967296, 4)).toEqual(draw(0, 4));
  });

  it("records the normalized seed", () => {
    expect(new SeededRandom(12345).seed).toBe(12345);
    expect(new SeededRandom(-2.5).seed).toBe(0xfffffffe);
  });

  it("survives seed 0 — the all-zero state is unreachable", () => {
    const values = draw(0, 200);
    expect(values.some((v) => v !== 0)).toBe(true);
    expect(new Set(values).size).toBe(200);
  });

  it("decorrelates neighbouring seeds", () => {
    const firsts = new Set<number>();
    for (let seed = 0; seed < 256; seed += 1) {
      firsts.add(new SeededRandom(seed).nextUint32());
    }
    // 256 distinct first outputs: the avalanche, not raw state injection.
    expect(firsts.size).toBe(256);
  });
});

describe("SeededRandom — output ranges", { timeout: 30_000 }, () => {
  it("returns uint32 integers", () => {
    const random = new SeededRandom(99);
    let outOfRange = 0;
    for (let i = 0; i < 50000; i += 1) {
      const value = random.nextUint32();
      if (!Number.isInteger(value) || value < 0 || value >= 4294967296) {
        outOfRange += 1;
      }
    }
    expect(outOfRange).toBe(0);
  });

  it("scales nextFloat01 exactly by 2⁻³²", () => {
    const random = new SeededRandom(7);
    const twin = random.clone();
    for (let i = 0; i < 1000; i += 1) {
      expect(random.nextFloat01()).toBe(twin.nextUint32() / 4294967296);
    }
  });

  it("keeps nextFloat01 in [0, 1)", () => {
    const random = new SeededRandom(2024);
    let min = 1;
    let max = 0;
    let outOfRange = 0;
    for (let i = 0; i < 50000; i += 1) {
      const value = random.nextFloat01();
      if (value < 0 || value >= 1) {
        outOfRange += 1;
      }
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    expect(outOfRange).toBe(0);
    expect(min).toBeLessThan(0.001);
    expect(max).toBeGreaterThan(0.999);
  });

  it("is uniform enough for procedural motion", () => {
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

  it("maps nextRange onto [min, max)", () => {
    const random = new SeededRandom(5);
    let outOfRange = 0;
    for (let i = 0; i < 50000; i += 1) {
      const value = random.nextRange(-Math.PI, Math.PI);
      if (value < -Math.PI || value >= Math.PI) {
        outOfRange += 1;
      }
    }
    expect(outOfRange).toBe(0);
  });

  it("handles a degenerate and a reversed range", () => {
    const random = new SeededRandom(11);
    expect(random.nextRange(2.5, 2.5)).toBe(2.5);
    let outOfRange = 0;
    for (let i = 0; i < 5000; i += 1) {
      const value = random.nextRange(10, 4);
      if (value <= 4 || value > 10) {
        outOfRange += 1;
      }
    }
    expect(outOfRange).toBe(0);
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

describe("SeededRandom — streams (§33, §34)", { timeout: 30_000 }, () => {
  it("reproduces a sequence from the same seed", () => {
    const a = new SeededRandom(0xbeef);
    const b = new SeededRandom(0xbeef);
    for (let i = 0; i < 1000; i += 1) {
      expect(a.nextUint32()).toBe(b.nextUint32());
    }
  });

  it("diverges immediately for different seeds", () => {
    const a = new SeededRandom(1);
    const b = new SeededRandom(2);
    expect(a.nextUint32()).not.toBe(b.nextUint32());
  });

  it("clones at the current position and then runs independently", () => {
    const random = new SeededRandom(77);
    for (let i = 0; i < 10; i += 1) {
      random.nextUint32();
    }
    const copy = random.clone();
    expect(copy.seed).toBe(random.seed);
    const fromOriginal: number[] = [];
    const fromCopy: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      fromOriginal.push(random.nextUint32());
      fromCopy.push(copy.nextUint32());
    }
    expect(fromCopy).toEqual(fromOriginal);

    // Independent afterwards: draining one does not move the other.
    for (let i = 0; i < 5; i += 1) {
      random.nextUint32();
    }
    expect(copy.nextUint32()).not.toBe(random.nextUint32());
  });

  it("is not a fresh stream when cloned", () => {
    const random = new SeededRandom(77);
    const first = random.nextUint32();
    random.nextUint32();
    expect(random.clone().nextUint32()).not.toBe(first);
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
