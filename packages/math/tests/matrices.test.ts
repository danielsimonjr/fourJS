import { beforeEach, describe, expect, it } from "vitest";

import {
  constructionCount,
  Matrix3,
  Matrix4,
  Quaternion,
  resetConstructionCount,
  Vector3,
} from "../src/index.js";

const IDENTITY_3 = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const;
const IDENTITY_4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;

/** Unit axes reused across the suite; never mutated by a test. */
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);
const ZERO = new Vector3(0, 0, 0);

function expectElementsCloseTo(
  actual: Matrix3 | Matrix4,
  expected: readonly number[],
  digits = 12,
): void {
  expect(actual.elements.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    expect(actual.elements[i], `element ${i}`).toBeCloseTo(expected[i], digits);
  }
}

function expectElementsExactly(
  actual: Matrix3 | Matrix4,
  expected: readonly number[],
): void {
  expect(Array.from(actual.elements)).toEqual(Array.from(expected));
}

function expectVectorCloseTo(
  actual: Vector3,
  x: number,
  y: number,
  z: number,
  digits = 12,
): void {
  expect(actual.x).toBeCloseTo(x, digits);
  expect(actual.y).toBeCloseTo(y, digits);
  expect(actual.z).toBeCloseTo(z, digits);
}

/**
 * `q` and `-q` denote the same rotation, so a decomposed rotation is compared
 * up to sign.
 */
function expectRotationEquivalent(
  actual: Quaternion,
  expected: Quaternion,
  digits = 12,
): void {
  const dot =
    actual.x * expected.x +
    actual.y * expected.y +
    actual.z * expected.z +
    actual.w * expected.w;
  const sign = dot < 0 ? -1 : 1;
  expect(actual.x).toBeCloseTo(sign * expected.x, digits);
  expect(actual.y).toBeCloseTo(sign * expected.y, digits);
  expect(actual.z).toBeCloseTo(sign * expected.z, digits);
  expect(actual.w).toBeCloseTo(sign * expected.w, digits);
}

/** Applies a Matrix4 to a column vector `(x, y, z, w)`, reading `elements` only. */
function transform4(
  m: Matrix4,
  x: number,
  y: number,
  z: number,
  w: number,
): [number, number, number, number] {
  const e = m.elements;
  return [
    e[0] * x + e[4] * y + e[8] * z + e[12] * w,
    e[1] * x + e[5] * y + e[9] * z + e[13] * w,
    e[2] * x + e[6] * y + e[10] * z + e[14] * w,
    e[3] * x + e[7] * y + e[11] * z + e[15] * w,
  ];
}

/** Clip-space depth of a camera-space point on the −Z axis, after the w divide. */
function projectedDepth(m: Matrix4, viewZ: number): number {
  const [, , clipZ, clipW] = transform4(m, 0, 0, viewZ, 1);
  return clipZ / clipW;
}

describe("Matrix3 basics", () => {
  it("constructs the identity in a column-major Float64Array(9)", () => {
    const m = new Matrix3();
    expect(m.elements).toBeInstanceOf(Float64Array);
    expectElementsExactly(m, IDENTITY_3);
  });

  it("identity resets a modified matrix and returns this", () => {
    const m = new Matrix3().fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(m.identity()).toBe(m);
    expectElementsExactly(m, IDENTITY_3);
  });

  it("fromArray reads nine column-major values at an offset", () => {
    const m = new Matrix3().fromArray(
      [99, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const,
      1,
    );
    expectElementsExactly(m, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("copy takes the elements of the source without linking the arrays", () => {
    const source = new Matrix3().fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const target = new Matrix3();
    expect(target.copy(source)).toBe(target);
    expectElementsExactly(target, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    source.identity();
    expectElementsExactly(target, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("clone allocates an independent copy without the change hook", () => {
    const m = new Matrix3().fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    m.onChanged = () => {
      throw new Error("clone must not carry the hook");
    };
    const copy = m.clone();
    expect(copy).not.toBe(m);
    expect(copy.elements).not.toBe(m.elements);
    expect(copy.onChanged).toBeUndefined();
    expectElementsExactly(copy, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("Matrix3 multiply", () => {
  // Column-major [1..9] is the matrix with rows [1,4,7] / [2,5,8] / [3,6,9];
  // column-major [9..1] is rows [9,6,3] / [8,5,2] / [7,4,1]. The product below
  // was computed by hand from those rows and columns.
  const A = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
  const B = [9, 8, 7, 6, 5, 4, 3, 2, 1] as const;

  it("computes this = this * m against a hand-computed product", () => {
    const a = new Matrix3().fromArray(A);
    const b = new Matrix3().fromArray(B);
    expect(a.multiply(b)).toBe(a);
    expectElementsExactly(a, [90, 114, 138, 54, 69, 84, 18, 24, 30]);
  });

  it("is not commutative — the reversed product differs", () => {
    const b = new Matrix3().fromArray(B).multiply(new Matrix3().fromArray(A));
    expectElementsExactly(b, [30, 24, 18, 84, 69, 54, 138, 114, 90]);
  });

  it("leaves a matrix unchanged when multiplied by the identity", () => {
    const m = new Matrix3().fromArray(A).multiply(new Matrix3());
    expectElementsExactly(m, A);
  });

  it("is aliasing-safe when the argument is this", () => {
    const m = new Matrix3().fromArray(A);
    m.multiply(m);
    // A * A, computed by hand from the rows above.
    expectElementsExactly(m, [30, 36, 42, 66, 81, 96, 102, 126, 150]);
  });
});

describe("Matrix3 determinant and invert", () => {
  it("computes known determinants", () => {
    expect(new Matrix3().determinant()).toBe(1);
    expect(
      new Matrix3().fromArray([2, 0, 0, 0, 3, 0, 0, 0, 4]).determinant(),
    ).toBe(24);
    // Rows [1,2,3] / [4,5,6] / [7,8,10] — determinant −3.
    expect(
      new Matrix3().fromArray([1, 4, 7, 2, 5, 8, 3, 6, 10]).determinant(),
    ).toBeCloseTo(-3, 12);
    // Rows [1,4,7] / [2,5,8] / [3,6,9] are linearly dependent.
    expect(
      new Matrix3().fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9]).determinant(),
    ).toBeCloseTo(0, 12);
  });

  it("inverts a diagonal matrix to the reciprocal diagonal", () => {
    const m = new Matrix3().fromArray([2, 0, 0, 0, 4, 0, 0, 0, 8]);
    expect(m.invert()).toBe(m);
    expectElementsCloseTo(m, [0.5, 0, 0, 0, 0.25, 0, 0, 0, 0.125]);
  });

  it("inverts a general matrix so that m * m⁻¹ is the identity", () => {
    const original = [1, 4, 7, 2, 5, 8, 3, 6, 10] as const;
    const inverse = new Matrix3().fromArray(original).invert();
    const product = new Matrix3().fromArray(original).multiply(inverse);
    expectElementsCloseTo(product, IDENTITY_3);
  });

  it("leaves a singular matrix unchanged and returns this", () => {
    const singular = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
    const m = new Matrix3().fromArray(singular);
    expect(m.determinant()).toBeCloseTo(0, 12);
    expect(m.invert()).toBe(m);
    expectElementsExactly(m, singular);
  });

  it("leaves the all-zero matrix unchanged rather than producing NaN", () => {
    const zeros = new Array<number>(9).fill(0);
    const m = new Matrix3().fromArray(zeros);
    m.invert();
    expectElementsExactly(m, zeros);
  });
});

describe("Matrix3 transpose", () => {
  it("leaves the identity unchanged and returns this", () => {
    const m = new Matrix3();
    expect(m.transpose()).toBe(m);
    expectElementsExactly(m, IDENTITY_3);
  });

  it("swaps the three off-diagonal pairs of a general matrix", () => {
    const m = new Matrix3().fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    m.transpose();
    expectElementsExactly(m, [1, 4, 7, 2, 5, 8, 3, 6, 9]);
  });

  it("is its own inverse", () => {
    const original = [1, 2, 3, 4, 5, 6, 7, 8, 10] as const;
    const m = new Matrix3().fromArray(original);
    m.transpose().transpose();
    expectElementsExactly(m, original);
  });
});

describe("Matrix3 setFromMatrix4Upper3x3", () => {
  it("copies the identity's upper 3×3 and returns this", () => {
    const m = new Matrix3().fromArray([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(m.setFromMatrix4Upper3x3(new Matrix4())).toBe(m);
    expectElementsExactly(m, IDENTITY_3);
  });

  it("copies a scaled rotation and drops the translation column", () => {
    const m4 = new Matrix4().fromArray([
      2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1,
    ]);
    const m3 = new Matrix3().setFromMatrix4Upper3x3(m4);
    expectElementsExactly(m3, [2, 0, 0, 0, 3, 0, 0, 0, 4]);
  });
});

describe("Matrix3 setNormalFromMatrix4", () => {
  it("leaves the identity as the identity", () => {
    const m = new Matrix3().fromArray([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(m.setNormalFromMatrix4(new Matrix4())).toBe(m);
    expectElementsExactly(m, IDENTITY_3);
  });

  it("maps a uniform scale to the reciprocal scale", () => {
    const scaled = new Matrix4().fromArray([
      2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 9, 8, 7, 1,
    ]);
    const m = new Matrix3().setNormalFromMatrix4(scaled);
    expectElementsCloseTo(m, [0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5]);
  });

  it("maps a non-uniform scale to the inverse-transpose diagonal", () => {
    // Scale (2, 4, 8): inverse is (1/2, 1/4, 1/8), and a diagonal is its
    // own transpose, so the normal matrix is the reciprocal diagonal.
    const scaled = new Matrix4().fromArray([
      2, 0, 0, 0, 0, 4, 0, 0, 0, 0, 8, 0, 1, 2, 3, 1,
    ]);
    const m = new Matrix3().setNormalFromMatrix4(scaled);
    expectElementsCloseTo(m, [0.5, 0, 0, 0, 0.25, 0, 0, 0, 0.125]);
  });

  it("equals copy-then-invert-then-transpose for a general affine transform", () => {
    const m4 = new Matrix4().compose(
      new Vector3(5, 6, 7),
      new Quaternion().setFromAxisAngle(AXIS_Y, 0.7),
      new Vector3(2, 3, 4),
      ZERO,
    );
    const expected = new Matrix3()
      .setFromMatrix4Upper3x3(m4)
      .invert()
      .transpose();
    const actual = new Matrix3().setNormalFromMatrix4(m4);
    expectElementsCloseTo(actual, Array.from(expected.elements));
  });

  it("leaves this matrix unchanged when the upper 3×3 is singular", () => {
    const singular = new Matrix4().fromArray([
      1, 2, 3, 0, 2, 4, 6, 0, 3, 6, 9, 0, 10, 11, 12, 1,
    ]);
    const kept = [2, 0, 0, 0, 4, 0, 0, 0, 8] as const;
    const m = new Matrix3().fromArray(kept);
    expect(m.setNormalFromMatrix4(singular)).toBe(m);
    expectElementsExactly(m, kept);
  });
});

describe("Matrix4 basics", () => {
  it("constructs the identity in a column-major Float64Array(16)", () => {
    const m = new Matrix4();
    expect(m.elements).toBeInstanceOf(Float64Array);
    expectElementsExactly(m, IDENTITY_4);
  });

  it("identity resets a modified matrix and returns this", () => {
    const m = new Matrix4().fromArray([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
    expect(m.identity()).toBe(m);
    expectElementsExactly(m, IDENTITY_4);
  });

  it("fromArray reads sixteen column-major values at an offset", () => {
    const values = [
      -1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ] as const;
    const m = new Matrix4().fromArray(values, 1);
    expectElementsExactly(m, values.slice(1));
    // Column-major: the translation column is the last four values.
    expect(m.elements[12]).toBe(13);
  });

  it("copy takes the elements of the source without linking the arrays", () => {
    const source = new Matrix4().fromArray([
      2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1,
    ]);
    const target = new Matrix4();
    expect(target.copy(source)).toBe(target);
    expectElementsExactly(
      target,
      [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1],
    );
    source.identity();
    expectElementsExactly(
      target,
      [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1],
    );
  });

  it("clone allocates an independent copy without the change hook", () => {
    const m = new Matrix4().fromArray([
      2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1,
    ]);
    m.onChanged = () => {
      throw new Error("clone must not carry the hook");
    };
    const copy = m.clone();
    expect(copy).not.toBe(m);
    expect(copy.elements).not.toBe(m.elements);
    expect(copy.onChanged).toBeUndefined();
    expectElementsExactly(
      copy,
      [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1],
    );
  });
});

describe("Matrix4 multiply", () => {
  // Hand-written column-major transforms: translation lives in e[12..14].
  const TRANSLATE_1_2_3 = [
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1,
  ] as const;
  const SCALE_2_3_4 = [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1] as const;

  it("applies the right operand first: T * S scales then translates", () => {
    const m = new Matrix4()
      .fromArray(TRANSLATE_1_2_3)
      .multiply(new Matrix4().fromArray(SCALE_2_3_4));
    expectElementsExactly(m, [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 1, 2, 3, 1]);
    expect(transform4(m, 1, 1, 1, 1)).toEqual([3, 5, 7, 1]);
  });

  it("S * T scales the translation, showing the product is not commutative", () => {
    const m = new Matrix4()
      .fromArray(SCALE_2_3_4)
      .multiply(new Matrix4().fromArray(TRANSLATE_1_2_3));
    expectElementsExactly(m, [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 2, 6, 12, 1]);
  });

  it("leaves a matrix unchanged when multiplied by the identity", () => {
    const m = new Matrix4().fromArray(TRANSLATE_1_2_3).multiply(new Matrix4());
    expectElementsExactly(m, TRANSLATE_1_2_3);
  });

  it("is aliasing-safe when the argument is this", () => {
    const m = new Matrix4().fromArray(TRANSLATE_1_2_3);
    m.multiply(m);
    expectElementsExactly(m, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 4, 6, 1]);
  });
});

describe("Matrix4 determinant and invert", () => {
  it("computes known determinants", () => {
    expect(new Matrix4().determinant()).toBe(1);
    // Affine translate + scale: determinant is the product of the scales.
    expect(
      new Matrix4()
        .fromArray([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1])
        .determinant(),
    ).toBeCloseTo(24, 12);
    // Rows [1,0,0,0] / [0,2,0,0] / [0,0,0,3] / [0,0,4,0] — determinant −24.
    expect(
      new Matrix4()
        .fromArray([1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 4, 0, 0, 3, 0])
        .determinant(),
    ).toBeCloseTo(-24, 12);
    // Two identical columns.
    expect(
      new Matrix4()
        .fromArray([1, 2, 3, 4, 1, 2, 3, 4, 0, 0, 1, 0, 0, 0, 0, 1])
        .determinant(),
    ).toBeCloseTo(0, 12);
  });

  it("determinant of a composed transform is the product of the scales", () => {
    const m = new Matrix4().compose(
      new Vector3(5, 6, 7),
      new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3), 0.7),
      new Vector3(2, 3, 4),
      new Vector3(1, -2, 0.5),
    );
    expect(m.determinant()).toBeCloseTo(24, 12);
  });

  it("inverts a translate-then-scale matrix to hand-computed values", () => {
    // Rows map x → 2x + 1, y → 4y + 2, z → 8z + 3, so the inverse maps
    // x → (x − 1)/2 = 0.5x − 0.5, y → 0.25y − 0.5, z → 0.125z − 0.375.
    const m = new Matrix4().fromArray([
      2, 0, 0, 0, 0, 4, 0, 0, 0, 0, 8, 0, 1, 2, 3, 1,
    ]);
    expect(m.invert()).toBe(m);
    expectElementsCloseTo(
      m,
      [0.5, 0, 0, 0, 0, 0.25, 0, 0, 0, 0, 0.125, 0, -0.5, -0.5, -0.375, 1],
    );
  });

  it("inverts a composed transform so that m * m⁻¹ is the identity", () => {
    const position = new Vector3(5, -6, 7);
    const rotation = new Quaternion().setFromAxisAngle(
      new Vector3(1, 2, 3),
      0.7,
    );
    const scale = new Vector3(2, 3, 4);
    const m = new Matrix4().compose(position, rotation, scale, ZERO);
    const inverse = m.clone().invert();
    expectElementsCloseTo(m.clone().multiply(inverse), IDENTITY_4);
    expectElementsCloseTo(inverse.clone().multiply(m), IDENTITY_4);
  });

  it("inverts a perspective projection (a non-affine matrix)", () => {
    const projection = new Matrix4().setPerspective(Math.PI / 2, 1.5, 0.1, 100);
    const inverse = projection.clone().invert();
    expectElementsCloseTo(projection.clone().multiply(inverse), IDENTITY_4, 10);
  });

  it("leaves a singular matrix unchanged and returns this", () => {
    const singular = [1, 2, 3, 4, 1, 2, 3, 4, 0, 0, 1, 0, 0, 0, 0, 1] as const;
    const m = new Matrix4().fromArray(singular);
    expect(m.determinant()).toBeCloseTo(0, 12);
    expect(m.invert()).toBe(m);
    expectElementsExactly(m, singular);
  });

  it("leaves the all-zero matrix unchanged rather than producing NaN", () => {
    const zeros = new Array<number>(16).fill(0);
    const m = new Matrix4().fromArray(zeros);
    m.invert();
    expectElementsExactly(m, zeros);
  });
});

describe("Matrix4 compose (§7 T · Tp · R · S · Tp⁻¹)", () => {
  it("matches a hand-constructed matrix for rotation π/2 about Z, scale (2,3,4), pivot (1,0,0)", () => {
    // R(π/2 about Z) has columns (0,1,0), (−1,0,0), (0,0,1); scaling them by
    // (2,3,4) gives R·S columns (0,2,0), (−3,0,0), (0,0,4). The translation is
    // position + pivot − R·S·pivot = (5,6,7) + (1,0,0) − (0,2,0) = (6,4,7).
    const m = new Matrix4().compose(
      new Vector3(5, 6, 7),
      new Quaternion().setFromAxisAngle(AXIS_Z, Math.PI / 2),
      new Vector3(2, 3, 4),
      new Vector3(1, 0, 0),
    );
    expectElementsCloseTo(m, [0, 2, 0, 0, -3, 0, 0, 0, 0, 0, 4, 0, 6, 4, 7, 1]);
  });

  it("matches a hand-constructed matrix for rotation π/2 about Y with pivot (0,0,2)", () => {
    // R(π/2 about Y) has columns (0,0,−1), (0,1,0), (1,0,0); unit scale. The
    // translation is (0,0,0) + (0,0,2) − (2,0,0) = (−2,0,2).
    const m = new Matrix4().compose(
      ZERO,
      new Quaternion().setFromAxisAngle(AXIS_Y, Math.PI / 2),
      new Vector3(1, 1, 1),
      new Vector3(0, 0, 2),
    );
    expectElementsCloseTo(
      m,
      [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, -2, 0, 2, 1],
    );
  });

  it("matches a hand-constructed matrix with no rotation: scale on the diagonal, position in the last column", () => {
    const m = new Matrix4().compose(
      new Vector3(5, 6, 7),
      new Quaternion(),
      new Vector3(2, 3, 4),
      ZERO,
    );
    expectElementsExactly(m, [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1]);
  });

  it("moves the pivot point by the translation alone, whatever the rotation and scale are", () => {
    const pivot = new Vector3(1, 0, 0);
    const position = new Vector3(5, 6, 7);
    const rotationless = new Matrix4().compose(
      position,
      new Quaternion(),
      new Vector3(1, 1, 1),
      pivot,
    );
    const rotated = new Matrix4().compose(
      position,
      new Quaternion().setFromAxisAngle(AXIS_Z, Math.PI / 2),
      new Vector3(2, 3, 4),
      pivot,
    );
    // §7: the pivot is the point rotation and scale act about, so the local
    // point `pivot` lands at `position + pivot` for every rotation and scale.
    for (const m of [rotationless, rotated]) {
      const [x, y, z, w] = transform4(m, pivot.x, pivot.y, pivot.z, 1);
      expect(x).toBeCloseTo(position.x + pivot.x, 12);
      expect(y).toBeCloseTo(position.y + pivot.y, 12);
      expect(z).toBeCloseTo(position.z + pivot.z, 12);
      expect(w).toBe(1);
    }
  });

  it("a pivot is equivalent to composing with pivot zero at position + (I − R·S)·pivot", () => {
    const position = new Vector3(5, 6, 7);
    const rotation = new Quaternion().setFromAxisAngle(AXIS_Z, Math.PI / 2);
    const scale = new Vector3(2, 3, 4);
    const pivot = new Vector3(1, 0, 0);

    const withPivot = new Matrix4().compose(position, rotation, scale, pivot);
    // (I − R·S)·pivot = (1,0,0) − (0,2,0) = (1,−2,0), by hand as above.
    const shifted = new Matrix4().compose(
      new Vector3(6, 4, 7),
      rotation,
      scale,
      ZERO,
    );
    expectElementsCloseTo(withPivot, Array.from(shifted.elements));
  });

  it("holds the same equivalence for an arbitrary rotation, axis and pivot", () => {
    const position = new Vector3(-3, 2, 11);
    const rotation = new Quaternion().setFromAxisAngle(
      new Vector3(1, 2, 3),
      0.7,
    );
    const scale = new Vector3(2, 3, 4);
    const pivot = new Vector3(1, -2, 0.5);

    // (R·S)·pivot without touching Matrix4: scale the pivot, then rotate it.
    const scaledPivot = new Vector3(
      pivot.x * scale.x,
      pivot.y * scale.y,
      pivot.z * scale.z,
    );
    const rotatedPivot = rotation.rotateVector3(scaledPivot, new Vector3());
    const shiftedPosition = new Vector3(
      position.x + pivot.x - rotatedPivot.x,
      position.y + pivot.y - rotatedPivot.y,
      position.z + pivot.z - rotatedPivot.z,
    );

    const withPivot = new Matrix4().compose(position, rotation, scale, pivot);
    const shifted = new Matrix4().compose(
      shiftedPosition,
      rotation,
      scale,
      ZERO,
    );
    expectElementsCloseTo(withPivot, Array.from(shifted.elements));
  });
});

describe("Matrix4 decompose", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly position: Vector3;
    readonly rotation: Quaternion;
    readonly scale: Vector3;
  }> = [
    {
      name: "identity rotation, uniform scale",
      position: new Vector3(1, 2, 3),
      rotation: new Quaternion(),
      scale: new Vector3(1, 1, 1),
    },
    {
      name: "quarter turn about Z, non-uniform scale",
      position: new Vector3(5, 6, 7),
      rotation: new Quaternion().setFromAxisAngle(AXIS_Z, Math.PI / 2),
      scale: new Vector3(2, 3, 4),
    },
    {
      name: "arbitrary axis and angle",
      position: new Vector3(-3, 2, 11),
      rotation: new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3), 0.7),
      scale: new Vector3(2, 3, 4),
    },
    {
      name: "half turn about Y (negative trace branch)",
      position: new Vector3(0, 0, 0),
      rotation: new Quaternion().setFromAxisAngle(AXIS_Y, Math.PI),
      scale: new Vector3(1, 1, 1),
    },
    {
      name: "half turn about Z (third branch)",
      position: new Vector3(1, 1, 1),
      rotation: new Quaternion().setFromAxisAngle(AXIS_Z, Math.PI),
      scale: new Vector3(3, 3, 3),
    },
  ];

  for (const testCase of cases) {
    it(`round-trips compose with pivot zero — ${testCase.name}`, () => {
      const m = new Matrix4().compose(
        testCase.position,
        testCase.rotation,
        testCase.scale,
        ZERO,
      );
      const position = new Vector3();
      const rotation = new Quaternion();
      const scale = new Vector3();
      expect(m.decompose(position, rotation, scale)).toBe(m);

      expectVectorCloseTo(
        position,
        testCase.position.x,
        testCase.position.y,
        testCase.position.z,
      );
      expectVectorCloseTo(
        scale,
        testCase.scale.x,
        testCase.scale.y,
        testCase.scale.z,
      );
      expectRotationEquivalent(rotation, testCase.rotation);
    });
  }

  it("recomposing the decomposed parts reproduces the matrix", () => {
    const m = new Matrix4().compose(
      new Vector3(-3, 2, 11),
      new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3), 0.7),
      new Vector3(2, 3, 4),
      ZERO,
    );
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    m.decompose(position, rotation, scale);
    const recomposed = new Matrix4().compose(position, rotation, scale, ZERO);
    expectElementsCloseTo(recomposed, Array.from(m.elements));
  });

  it("does not recover the pivot: the position is the composed translation", () => {
    const m = new Matrix4().compose(
      new Vector3(5, 6, 7),
      new Quaternion().setFromAxisAngle(AXIS_Z, Math.PI / 2),
      new Vector3(2, 3, 4),
      new Vector3(1, 0, 0),
    );
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    m.decompose(position, rotation, scale);
    // position + (I − R·S)·pivot = (6,4,7), not the authored (5,6,7).
    expectVectorCloseTo(position, 6, 4, 7);
    expectVectorCloseTo(scale, 2, 3, 4);
  });

  it("reports a positive scale for a mirrored transform", () => {
    const m = new Matrix4().fromArray([
      -2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1,
    ]);
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    m.decompose(position, rotation, scale);
    expectVectorCloseTo(scale, 2, 3, 4);
  });

  it("returns the identity rotation when a scale component is zero", () => {
    const m = new Matrix4().compose(
      new Vector3(1, 2, 3),
      new Quaternion().setFromAxisAngle(AXIS_Z, Math.PI / 2),
      new Vector3(2, 0, 4),
      ZERO,
    );
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    m.decompose(position, rotation, scale);
    expectVectorCloseTo(position, 1, 2, 3);
    expectVectorCloseTo(scale, 2, 0, 4);
    expect([rotation.x, rotation.y, rotation.z, rotation.w]).toEqual([
      0, 0, 0, 1,
    ]);
  });

  it("fires each out object's hook exactly once and never the matrix's", () => {
    const m = new Matrix4().compose(
      new Vector3(1, 2, 3),
      new Quaternion().setFromAxisAngle(AXIS_Z, 0.5),
      new Vector3(2, 3, 4),
      ZERO,
    );
    let matrixCalls = 0;
    m.onChanged = () => {
      matrixCalls += 1;
    };
    let positionCalls = 0;
    let rotationCalls = 0;
    let scaleCalls = 0;
    const position = new Vector3();
    position.onChanged = () => {
      positionCalls += 1;
    };
    const rotation = new Quaternion();
    rotation.onChanged = () => {
      rotationCalls += 1;
    };
    const scale = new Vector3();
    scale.onChanged = () => {
      scaleCalls += 1;
    };

    m.decompose(position, rotation, scale);

    expect(positionCalls).toBe(1);
    expect(rotationCalls).toBe(1);
    expect(scaleCalls).toBe(1);
    expect(matrixCalls).toBe(0);
  });
});

describe("Matrix4 setPerspective (plan D8)", () => {
  // fovY = π/2 ⇒ 1/tan(π/4) = 1; aspect = 1; near = 1; far = 3.
  // OpenGL depth: e[10] = (far+near)/(near−far) = 4/−2 = −2,
  //               e[14] = 2·far·near/(near−far) = 6/−2 = −3.
  const GL = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -2, -1, 0, 0, -3, 0] as const;
  // WebGPU depth: e[10] = far/(near−far) = −1.5, e[14] = far·near/(near−far) = −1.5.
  const WEBGPU = [
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.5, -1, 0, 0, -1.5, 0,
  ] as const;

  it("defaults to the −1…1 depth range and matches hand-computed elements", () => {
    const m = new Matrix4().setPerspective(Math.PI / 2, 1, 1, 3);
    expectElementsCloseTo(m, GL);
    expectElementsCloseTo(
      new Matrix4().setPerspective(Math.PI / 2, 1, 1, 3, "negative-one-to-one"),
      GL,
    );
  });

  it("matches hand-computed elements for the 0…1 depth range", () => {
    const m = new Matrix4().setPerspective(Math.PI / 2, 1, 1, 3, "zero-to-one");
    expectElementsCloseTo(m, WEBGPU);
  });

  it("maps the near and far planes to the ends of each depth range", () => {
    const gl = new Matrix4().setPerspective(Math.PI / 2, 1, 1, 3);
    expect(projectedDepth(gl, -1)).toBeCloseTo(-1, 12);
    expect(projectedDepth(gl, -3)).toBeCloseTo(1, 12);

    const webgpu = new Matrix4().setPerspective(
      Math.PI / 2,
      1,
      1,
      3,
      "zero-to-one",
    );
    expect(projectedDepth(webgpu, -1)).toBeCloseTo(0, 12);
    expect(projectedDepth(webgpu, -3)).toBeCloseTo(1, 12);
  });

  it("divides the horizontal term by the aspect ratio and looks down −Z", () => {
    const m = new Matrix4().setPerspective(Math.PI / 2, 2, 1, 3);
    expect(m.elements[0]).toBeCloseTo(0.5, 12);
    expect(m.elements[5]).toBeCloseTo(1, 12);
    // A point on the near plane at the top edge maps to y = +1 after the divide.
    const [, clipY, , clipW] = transform4(m, 0, 1, -1, 1);
    expect(clipY / clipW).toBeCloseTo(1, 12);
  });

  it("overwrites every element of a matrix that held another value", () => {
    const m = new Matrix4().fromArray([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
    m.setPerspective(Math.PI / 2, 1, 1, 3);
    expectElementsCloseTo(m, GL);
  });
});

describe("Matrix4 setOrthographic (plan D8)", () => {
  // left −2, right 6, bottom −1, top 3, near 1, far 5:
  // e[0] = 2/8 = 0.25, e[5] = 2/4 = 0.5,
  // e[12] = −(6−2)/8 = −0.5, e[13] = −(3−1)/4 = −0.5.
  // OpenGL depth: e[10] = −2/4 = −0.5, e[14] = −(5+1)/4 = −1.5.
  const GL = [
    0.25, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, -0.5, 0, -0.5, -0.5, -1.5, 1,
  ] as const;
  // WebGPU depth: e[10] = −1/4 = −0.25, e[14] = −near/4 = −0.25.
  const WEBGPU = [
    0.25, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, -0.25, 0, -0.5, -0.5, -0.25, 1,
  ] as const;

  it("defaults to the −1…1 depth range and matches hand-computed elements", () => {
    const m = new Matrix4().setOrthographic(-2, 6, -1, 3, 1, 5);
    expectElementsCloseTo(m, GL);
    expectElementsCloseTo(
      new Matrix4().setOrthographic(-2, 6, -1, 3, 1, 5, "negative-one-to-one"),
      GL,
    );
  });

  it("matches hand-computed elements for the 0…1 depth range", () => {
    const m = new Matrix4().setOrthographic(-2, 6, -1, 3, 1, 5, "zero-to-one");
    expectElementsCloseTo(m, WEBGPU);
  });

  it("maps the box corners to the clip cube in both depth ranges", () => {
    const gl = new Matrix4().setOrthographic(-2, 6, -1, 3, 1, 5);
    expect(transform4(gl, -2, -1, -1, 1).slice(0, 2)).toEqual([-1, -1]);
    expect(transform4(gl, 6, 3, -1, 1).slice(0, 2)).toEqual([1, 1]);
    expect(projectedDepth(gl, -1)).toBeCloseTo(-1, 12);
    expect(projectedDepth(gl, -5)).toBeCloseTo(1, 12);

    const webgpu = new Matrix4().setOrthographic(
      -2,
      6,
      -1,
      3,
      1,
      5,
      "zero-to-one",
    );
    expect(projectedDepth(webgpu, -1)).toBeCloseTo(0, 12);
    expect(projectedDepth(webgpu, -5)).toBeCloseTo(1, 12);
  });

  it("overwrites every element of a matrix that held another value", () => {
    const m = new Matrix4().fromArray([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
    m.setOrthographic(-2, 6, -1, 3, 1, 5);
    expectElementsCloseTo(m, GL);
  });
});

describe("Matrix changed hook (plan D3)", () => {
  it("fires exactly once per Matrix3 mutator", () => {
    const mutators: ReadonlyArray<readonly [string, (m: Matrix3) => void]> = [
      ["identity", (m) => void m.identity()],
      ["copy", (m) => void m.copy(new Matrix3())],
      ["fromArray", (m) => void m.fromArray([2, 0, 0, 0, 2, 0, 0, 0, 2])],
      ["multiply", (m) => void m.multiply(new Matrix3())],
      ["invert", (m) => void m.invert()],
      ["transpose", (m) => void m.transpose()],
      [
        "setFromMatrix4Upper3x3",
        (m) => void m.setFromMatrix4Upper3x3(new Matrix4()),
      ],
      [
        "setNormalFromMatrix4",
        (m) =>
          void m.setNormalFromMatrix4(
            new Matrix4().fromArray([
              2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 1, 2, 3, 1,
            ]),
          ),
      ],
    ];

    for (const [name, mutate] of mutators) {
      const m = new Matrix3().fromArray([2, 0, 0, 0, 4, 0, 0, 0, 8]);
      let calls = 0;
      m.onChanged = () => {
        calls += 1;
      };
      mutate(m);
      expect(calls, `${name} must invoke the changed hook exactly once`).toBe(
        1,
      );
    }
  });

  it("fires exactly once per Matrix4 mutator", () => {
    const mutators: ReadonlyArray<readonly [string, (m: Matrix4) => void]> = [
      ["identity", (m) => void m.identity()],
      ["copy", (m) => void m.copy(new Matrix4())],
      [
        "fromArray",
        (m) =>
          void m.fromArray([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]),
      ],
      ["multiply", (m) => void m.multiply(new Matrix4())],
      ["invert", (m) => void m.invert()],
      [
        "compose",
        (m) =>
          void m.compose(
            new Vector3(1, 2, 3),
            new Quaternion(),
            new Vector3(1, 1, 1),
            ZERO,
          ),
      ],
      ["setPerspective", (m) => void m.setPerspective(Math.PI / 3, 1, 1, 10)],
      ["setOrthographic", (m) => void m.setOrthographic(-1, 1, -1, 1, 1, 10)],
    ];

    for (const [name, mutate] of mutators) {
      const m = new Matrix4().fromArray([
        2, 0, 0, 0, 0, 4, 0, 0, 0, 0, 8, 0, 1, 2, 3, 1,
      ]);
      let calls = 0;
      m.onChanged = () => {
        calls += 1;
      };
      mutate(m);
      expect(calls, `${name} must invoke the changed hook exactly once`).toBe(
        1,
      );
    }
  });

  it("does not fire when a singular invert leaves the elements alone", () => {
    const m3 = new Matrix3().fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    let calls3 = 0;
    m3.onChanged = () => {
      calls3 += 1;
    };
    m3.invert();
    expect(calls3).toBe(0);

    const dest = new Matrix3().fromArray([2, 0, 0, 0, 4, 0, 0, 0, 8]);
    let callsNormal = 0;
    dest.onChanged = () => {
      callsNormal += 1;
    };
    dest.setNormalFromMatrix4(
      new Matrix4().fromArray([1, 2, 3, 0, 2, 4, 6, 0, 3, 6, 9, 0, 0, 0, 0, 1]),
    );
    expect(callsNormal).toBe(0);

    const m4 = new Matrix4().fromArray([
      1, 2, 3, 4, 1, 2, 3, 4, 0, 0, 1, 0, 0, 0, 0, 1,
    ]);
    let calls4 = 0;
    m4.onChanged = () => {
      calls4 += 1;
    };
    m4.invert();
    expect(calls4).toBe(0);
  });

  it("is not fired by direct element writes", () => {
    const m = new Matrix4();
    let calls = 0;
    m.onChanged = () => {
      calls += 1;
    };
    m.elements[12] = 5;
    expect(calls).toBe(0);
  });
});

describe("Matrix allocation counter (§7b, §83)", () => {
  beforeEach(() => {
    resetConstructionCount();
  });

  it("counts matrix constructions, clone included", () => {
    expect(constructionCount()).toBe(0);
    const m = new Matrix4();
    expect(constructionCount()).toBe(1);
    m.clone();
    expect(constructionCount()).toBe(2);
    new Matrix3().clone();
    expect(constructionCount()).toBe(4);
  });

  it("performs 1000 iterations of compose/decompose/multiply with zero constructions", () => {
    const local = new Matrix4();
    const world = new Matrix4();
    const parent = new Matrix4().compose(
      new Vector3(1, 2, 3),
      new Quaternion().setFromAxisAngle(AXIS_Y, 0.25),
      new Vector3(1, 1, 1),
      ZERO,
    );
    const normalMatrix = new Matrix3().fromArray([2, 0, 0, 0, 3, 0, 0, 0, 4]);
    const scratch3 = new Matrix3();

    const position = new Vector3(1, 2, 3);
    const rotation = new Quaternion().setFromAxisAngle(AXIS_Z, 0.5);
    const scale = new Vector3(2, 3, 4);
    const pivot = new Vector3(0.5, -1, 0.25);

    const outPosition = new Vector3();
    const outRotation = new Quaternion();
    const outScale = new Vector3();

    let accumulator = 0;

    resetConstructionCount();
    for (let i = 0; i < 1000; i += 1) {
      local.compose(position, rotation, scale, pivot);
      world.copy(parent).multiply(local);
      world.decompose(outPosition, outRotation, outScale);
      scratch3.copy(normalMatrix).invert();
      scratch3.setNormalFromMatrix4(world);
      accumulator +=
        world.determinant() +
        outPosition.lengthSq() +
        outRotation.w +
        outScale.x +
        scratch3.determinant();
      local.identity().setPerspective(Math.PI / 3, 1.5, 0.1, 100);
      local.invert();
    }

    expect(constructionCount()).toBe(0);
    expect(Number.isFinite(accumulator)).toBe(true);
  });
});
