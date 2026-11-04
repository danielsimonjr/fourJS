import { beforeEach, describe, expect, it } from "vitest";

import {
  constructionCount,
  Matrix4,
  Quaternion,
  resetConstructionCount,
  Vector3,
} from "../src/index.js";

const HALF_SQRT2 = Math.SQRT1_2; // sin(π/4) = cos(π/4)

/** Unit axes reused across the suite; never mutated by a test. */
const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);

/** Rotates `v` by `q` into a fresh vector — test convenience, not a hot path. */
function rotated(q: Quaternion, v: Vector3): Vector3 {
  return q.rotateVector3(v, new Vector3());
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

function expectQuaternionCloseTo(
  actual: Quaternion,
  x: number,
  y: number,
  z: number,
  w: number,
  digits = 12,
): void {
  expect(actual.x).toBeCloseTo(x, digits);
  expect(actual.y).toBeCloseTo(y, digits);
  expect(actual.z).toBeCloseTo(z, digits);
  expect(actual.w).toBeCloseTo(w, digits);
}

function length(q: Quaternion): number {
  return Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
}

describe("Quaternion basics", () => {
  it("defaults to the identity rotation and stores constructor arguments", () => {
    const q = new Quaternion();
    expect([q.x, q.y, q.z, q.w]).toEqual([0, 0, 0, 1]);
    const explicit = new Quaternion(1, 2, 3, 4);
    expect([explicit.x, explicit.y, explicit.z, explicit.w]).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("the identity rotation leaves vectors untouched", () => {
    const identity = new Quaternion();
    expectVectorCloseTo(rotated(identity, new Vector3(1, -2, 3)), 1, -2, 3);
    expectVectorCloseTo(rotated(identity, AXIS_Y), 0, 1, 0);
  });

  it("set overwrites all components and returns this", () => {
    const q = new Quaternion();
    expect(q.set(1, 2, 3, 4)).toBe(q);
    expect([q.x, q.y, q.z, q.w]).toEqual([1, 2, 3, 4]);
  });

  it("identity resets any rotation back to (0, 0, 0, 1)", () => {
    const q = new Quaternion(1, 2, 3, 4);
    expect(q.identity()).toBe(q);
    expect([q.x, q.y, q.z, q.w]).toEqual([0, 0, 0, 1]);
  });

  it("copy takes the components of the source without linking the objects", () => {
    const source = new Quaternion(1, 2, 3, 4);
    const target = new Quaternion().copy(source);
    expect([target.x, target.y, target.z, target.w]).toEqual([1, 2, 3, 4]);
    source.identity();
    expect([target.x, target.y, target.z, target.w]).toEqual([1, 2, 3, 4]);
  });

  it("clone allocates an independent copy without the change hook", () => {
    const q = new Quaternion(1, 2, 3, 4);
    q.onChanged = () => {
      throw new Error("clone must not carry the hook");
    };
    const copy = q.clone();
    expect(copy).not.toBe(q);
    expect([copy.x, copy.y, copy.z, copy.w]).toEqual([1, 2, 3, 4]);
    expect(copy.onChanged).toBeUndefined();
    copy.identity();
    expect(q.x).toBe(1);
  });
});

describe("Quaternion.setFromAxisAngle (radians, §7a)", () => {
  it("produces the known components of a 90 degree rotation about Y", () => {
    const q = new Quaternion().setFromAxisAngle(AXIS_Y, Math.PI / 2);
    expectQuaternionCloseTo(q, 0, HALF_SQRT2, 0, HALF_SQRT2);
    expect(length(q)).toBeCloseTo(1, 12);
  });

  it("produces the known components of a 180 degree rotation about X", () => {
    const q = new Quaternion().setFromAxisAngle(AXIS_X, Math.PI);
    expectQuaternionCloseTo(q, 1, 0, 0, 0);
  });

  it("produces the known components of a 60 degree rotation about Z", () => {
    const q = new Quaternion().setFromAxisAngle(AXIS_Z, Math.PI / 3);
    expectQuaternionCloseTo(q, 0, 0, 0.5, Math.sqrt(3) / 2);
  });

  it("rotates the basis vectors the right-handed way", () => {
    const aboutY = new Quaternion().setFromAxisAngle(AXIS_Y, Math.PI / 2);
    // Right-handed, +Y up (§7a): +X goes to -Z and +Z goes to +X.
    expectVectorCloseTo(rotated(aboutY, AXIS_X), 0, 0, -1);
    expectVectorCloseTo(rotated(aboutY, AXIS_Z), 1, 0, 0);
    expectVectorCloseTo(rotated(aboutY, AXIS_Y), 0, 1, 0);

    const aboutZ = new Quaternion().setFromAxisAngle(AXIS_Z, Math.PI / 2);
    expectVectorCloseTo(rotated(aboutZ, AXIS_X), 0, 1, 0);

    const aboutX = new Quaternion().setFromAxisAngle(AXIS_X, Math.PI / 2);
    expectVectorCloseTo(rotated(aboutX, AXIS_Y), 0, 0, 1);
  });

  it("normalizes a non-unit axis internally", () => {
    const unit = new Quaternion().setFromAxisAngle(AXIS_Y, Math.PI / 3);
    const scaled = new Quaternion().setFromAxisAngle(
      new Vector3(0, 7, 0),
      Math.PI / 3,
    );
    expectQuaternionCloseTo(scaled, unit.x, unit.y, unit.z, unit.w);
  });

  it("returns the identity for a zero angle and for a zero-length axis", () => {
    const zeroAngle = new Quaternion(1, 2, 3, 4).setFromAxisAngle(AXIS_Y, 0);
    expect([zeroAngle.x, zeroAngle.y, zeroAngle.z, zeroAngle.w]).toEqual([
      0, 0, 0, 1,
    ]);
    const zeroAxis = new Quaternion(1, 2, 3, 4).setFromAxisAngle(
      new Vector3(),
      Math.PI / 2,
    );
    expect([zeroAxis.x, zeroAxis.y, zeroAxis.z, zeroAxis.w]).toEqual([
      0, 0, 0, 1,
    ]);
    expect(Number.isNaN(zeroAxis.x)).toBe(false);
  });

  it("a full turn is the identity rotation with negated components", () => {
    const q = new Quaternion().setFromAxisAngle(AXIS_Y, Math.PI * 2);
    expectQuaternionCloseTo(q, 0, 0, 0, -1);
    expectVectorCloseTo(rotated(q, new Vector3(1, 2, 3)), 1, 2, 3);
  });
});

describe("Quaternion.multiply", () => {
  it("composes rotations right-to-left, matching sequential rotateVector3", () => {
    const aboutY = new Quaternion().setFromAxisAngle(AXIS_Y, Math.PI / 2);
    const aboutX = new Quaternion().setFromAxisAngle(AXIS_X, Math.PI / 2);
    const composed = aboutX.clone().multiply(aboutY); // applies aboutY first

    const scratch = new Vector3();
    const inputs = [
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, 0, 1),
      new Vector3(1, -2, 3),
    ];
    for (const v of inputs) {
      aboutY.rotateVector3(v, scratch);
      aboutX.rotateVector3(scratch, scratch);
      const viaComposition = rotated(composed, v);
      expectVectorCloseTo(viaComposition, scratch.x, scratch.y, scratch.z, 12);
    }
  });

  it("is not commutative for non-parallel axes", () => {
    const aboutY = new Quaternion().setFromAxisAngle(AXIS_Y, Math.PI / 2);
    const aboutX = new Quaternion().setFromAxisAngle(AXIS_X, Math.PI / 2);
    const xy = aboutX.clone().multiply(aboutY);
    const yx = aboutY.clone().multiply(aboutX);
    const v = new Vector3(1, 0, 0);
    const a = rotated(xy, v);
    const b = rotated(yx, v);
    expect(a.equalsApprox(b)).toBe(false);
  });

  it("multiplying by the identity changes nothing, in either order", () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3), 0.7);
    const right = q.clone().multiply(new Quaternion());
    const left = new Quaternion().multiply(q);
    expectQuaternionCloseTo(right, q.x, q.y, q.z, q.w);
    expectQuaternionCloseTo(left, q.x, q.y, q.z, q.w);
  });

  it("mutates this, returns this, and leaves the argument untouched", () => {
    const a = new Quaternion().setFromAxisAngle(AXIS_Y, Math.PI / 2);
    const b = new Quaternion().setFromAxisAngle(AXIS_X, Math.PI / 2);
    expect(a.multiply(b)).toBe(a);
    expectQuaternionCloseTo(b, HALF_SQRT2, 0, 0, HALF_SQRT2);
  });

  it("is aliasing-safe when squaring a quaternion", () => {
    const q = new Quaternion().setFromAxisAngle(AXIS_Y, Math.PI / 4);
    const squared = q.clone().multiply(q);
    q.multiply(q);
    expectQuaternionCloseTo(q, squared.x, squared.y, squared.z, squared.w);
    // Twice 45 degrees about Y is 90 degrees about Y.
    expectQuaternionCloseTo(q, 0, HALF_SQRT2, 0, HALF_SQRT2);
  });

  it("stays unit length when composing unit quaternions", () => {
    const a = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3), 1.1);
    const b = new Quaternion().setFromAxisAngle(new Vector3(-3, 0.5, 2), -0.4);
    expect(length(a.multiply(b))).toBeCloseTo(1, 12);
  });
});

describe("Quaternion.conjugate", () => {
  it("negates the vector part and returns this", () => {
    const q = new Quaternion(1, 2, 3, 4);
    expect(q.conjugate()).toBe(q);
    expect([q.x, q.y, q.z, q.w]).toEqual([-1, -2, -3, 4]);
  });

  it("is the inverse rotation for a unit quaternion", () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, -2, 0.5), 1.3);
    const roundTrip = q.clone().multiply(q.clone().conjugate());
    expectQuaternionCloseTo(roundTrip, 0, 0, 0, 1);
  });

  it("undoes a rotation applied to a vector", () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0.3, 1, -2), 2.1);
    const v = new Vector3(4, -5, 6);
    const forward = rotated(q, v);
    const back = rotated(q.clone().conjugate(), forward);
    expectVectorCloseTo(back, 4, -5, 6);
  });
});

describe("Quaternion.normalize", () => {
  it("scales a non-unit quaternion to unit length without changing its direction", () => {
    const unit = new Quaternion().setFromAxisAngle(AXIS_Y, Math.PI / 3);
    const scaled = new Quaternion(
      unit.x * 5,
      unit.y * 5,
      unit.z * 5,
      unit.w * 5,
    );
    expect(scaled.normalize()).toBe(scaled);
    expect(length(scaled)).toBeCloseTo(1, 12);
    expectQuaternionCloseTo(scaled, unit.x, unit.y, unit.z, unit.w);
  });

  it("normalizes a known non-unit quaternion to exact halves", () => {
    const q = new Quaternion(1, 1, 1, 1).normalize();
    expect([q.x, q.y, q.z, q.w]).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it("resets an all-zero quaternion to the identity rather than producing NaN", () => {
    const q = new Quaternion(0, 0, 0, 0).normalize();
    expect([q.x, q.y, q.z, q.w]).toEqual([0, 0, 0, 1]);
  });
});

describe("Quaternion.slerp", () => {
  const quarterTurnY = new Quaternion().setFromAxisAngle(AXIS_Y, Math.PI / 2);

  it("returns the start at t = 0 and the end at t = 1", () => {
    const start = new Quaternion();
    expect(start.slerp(quarterTurnY, 0)).toBe(start);
    expectQuaternionCloseTo(start, 0, 0, 0, 1);

    const end = new Quaternion().slerp(quarterTurnY, 1);
    expectQuaternionCloseTo(
      end,
      quarterTurnY.x,
      quarterTurnY.y,
      quarterTurnY.z,
      quarterTurnY.w,
    );
  });

  it("halfway through a 90 degree rotation is the 45 degree rotation", () => {
    const midpoint = new Quaternion().slerp(quarterTurnY, 0.5);
    const expected = new Quaternion().setFromAxisAngle(AXIS_Y, Math.PI / 4);
    expectQuaternionCloseTo(
      midpoint,
      expected.x,
      expected.y,
      expected.z,
      expected.w,
    );
    // Closed form: sin(π/8) and cos(π/8).
    expectQuaternionCloseTo(
      midpoint,
      0,
      Math.sin(Math.PI / 8),
      0,
      Math.cos(Math.PI / 8),
    );
    expectVectorCloseTo(rotated(midpoint, AXIS_X), HALF_SQRT2, 0, -HALF_SQRT2);
  });

  it("moves at constant angular speed across the arc", () => {
    for (const t of [0.25, 0.5, 0.75]) {
      const q = new Quaternion().slerp(quarterTurnY, t);
      const expected = new Quaternion().setFromAxisAngle(
        AXIS_Y,
        (Math.PI / 2) * t,
      );
      expectQuaternionCloseTo(
        q,
        expected.x,
        expected.y,
        expected.z,
        expected.w,
      );
      expect(length(q)).toBeCloseTo(1, 12);
    }
  });

  it("takes the shortest arc when the inputs have opposite signs (D8)", () => {
    // -q denotes the same rotation as q; interpolating toward it must still
    // travel the short 90 degree way, not the long 270 degree way. Asserted on
    // rotated vectors, since the components legitimately differ in sign.
    const negated = new Quaternion(
      -quarterTurnY.x,
      -quarterTurnY.y,
      -quarterTurnY.z,
      -quarterTurnY.w,
    );

    const shortWay = new Quaternion().slerp(negated, 0.5);
    expectVectorCloseTo(rotated(shortWay, AXIS_X), HALF_SQRT2, 0, -HALF_SQRT2);

    // The long way round would have landed at 135 degrees about -Y.
    const longWay = rotated(
      new Quaternion().setFromAxisAngle(AXIS_Y, -(Math.PI * 3) / 4),
      AXIS_X,
    );
    expect(rotated(shortWay, AXIS_X).equalsApprox(longWay)).toBe(false);

    // At t = 1 the result is -target: opposite components, same rotation.
    const end = new Quaternion().slerp(negated, 1);
    expectQuaternionCloseTo(
      end,
      quarterTurnY.x,
      quarterTurnY.y,
      quarterTurnY.z,
      quarterTurnY.w,
    );
    expectVectorCloseTo(rotated(end, AXIS_X), 0, 0, -1);
  });

  it("agrees with the positive-sign case at every t when the target is negated", () => {
    const negated = new Quaternion(
      -quarterTurnY.x,
      -quarterTurnY.y,
      -quarterTurnY.z,
      -quarterTurnY.w,
    );
    for (const t of [0, 0.1, 0.5, 0.9, 1]) {
      const viaNegated = rotated(new Quaternion().slerp(negated, t), AXIS_X);
      const viaPositive = rotated(
        new Quaternion().slerp(quarterTurnY, t),
        AXIS_X,
      );
      expectVectorCloseTo(
        viaNegated,
        viaPositive.x,
        viaPositive.y,
        viaPositive.z,
      );
    }
  });

  it("falls back to nlerp for nearly parallel inputs without producing NaN", () => {
    // 0.01 rad apart: dot ≈ 0.9999875, above the 0.9995 threshold.
    const target = new Quaternion().setFromAxisAngle(AXIS_Y, 0.01);
    const midpoint = new Quaternion().slerp(target, 0.5);
    const expected = new Quaternion().setFromAxisAngle(AXIS_Y, 0.005);
    expectQuaternionCloseTo(
      midpoint,
      expected.x,
      expected.y,
      expected.z,
      expected.w,
      9,
    );
    expect(length(midpoint)).toBeCloseTo(1, 12);
  });

  it("handles identical inputs (dot = 1) without dividing by zero", () => {
    const q = new Quaternion().setFromAxisAngle(AXIS_Y, Math.PI / 3);
    const result = q.clone().slerp(q, 0.5);
    expectQuaternionCloseTo(result, q.x, q.y, q.z, q.w);
    expect(Number.isNaN(result.w)).toBe(false);
  });

  it("extrapolates outside [0, 1] without clamping", () => {
    const q = new Quaternion().slerp(quarterTurnY, 2);
    const expected = new Quaternion().setFromAxisAngle(AXIS_Y, Math.PI);
    expectQuaternionCloseTo(q, expected.x, expected.y, expected.z, expected.w);
  });

  it("leaves the target untouched", () => {
    const target = quarterTurnY.clone();
    new Quaternion().slerp(target, 0.3);
    expectQuaternionCloseTo(
      target,
      quarterTurnY.x,
      quarterTurnY.y,
      quarterTurnY.z,
      quarterTurnY.w,
    );
  });
});

describe("Quaternion.rotateVector3", () => {
  it("writes into out, returns out, and does not touch this or v", () => {
    const q = new Quaternion().setFromAxisAngle(AXIS_Y, Math.PI / 2);
    const v = new Vector3(1, 0, 0);
    const out = new Vector3();
    expect(q.rotateVector3(v, out)).toBe(out);
    expectVectorCloseTo(out, 0, 0, -1);
    expect([v.x, v.y, v.z]).toEqual([1, 0, 0]);
    expectQuaternionCloseTo(q, 0, HALF_SQRT2, 0, HALF_SQRT2);
  });

  it("rotates known vectors by known angles", () => {
    const out = new Vector3();
    const aboutZ = new Quaternion().setFromAxisAngle(AXIS_Z, Math.PI / 2);
    aboutZ.rotateVector3(new Vector3(2, 0, 0), out);
    expectVectorCloseTo(out, 0, 2, 0);

    const aboutX = new Quaternion().setFromAxisAngle(AXIS_X, Math.PI);
    aboutX.rotateVector3(new Vector3(0, 1, 1), out);
    expectVectorCloseTo(out, 0, -1, -1);

    const aboutY45 = new Quaternion().setFromAxisAngle(AXIS_Y, Math.PI / 4);
    aboutY45.rotateVector3(new Vector3(1, 5, 0), out);
    expectVectorCloseTo(out, HALF_SQRT2, 5, -HALF_SQRT2);
  });

  it("preserves length and the component along the rotation axis", () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3), 1.7);
    const v = new Vector3(4, -1, 2);
    const out = rotated(q, v);
    expect(out.length()).toBeCloseTo(v.length(), 12);
    const axis = new Vector3(1, 2, 3).normalize();
    expect(out.dot(axis)).toBeCloseTo(v.dot(axis), 12);
  });

  it("is aliasing-safe when v and out are the same vector", () => {
    const q = new Quaternion().setFromAxisAngle(AXIS_Y, Math.PI / 2);
    const shared = new Vector3(1, 2, 3);
    const separate = rotated(q, shared);
    expect(q.rotateVector3(shared, shared)).toBe(shared);
    expectVectorCloseTo(shared, separate.x, separate.y, separate.z);
    expectVectorCloseTo(shared, 3, 2, -1);
  });
});

describe("Quaternion.setFromLookDirection (§44/§47, R-36)", () => {
  const FORWARD = new Vector3(0, 0, -1);

  /** Where a rotation sends the engine's forward axis (−Z, §7a/D8). */
  function facing(q: Quaternion): Vector3 {
    return rotated(q, FORWARD);
  }

  it("leaves the identity alone when already aimed down −Z", () => {
    const q = new Quaternion(1, 2, 3, 4);
    expect(q.setFromLookDirection(FORWARD, AXIS_Y)).toBe(q);
    expectQuaternionCloseTo(q, 0, 0, 0, 1);
  });

  it("aims −Z along the direction and keeps +Y near up, for each axis", () => {
    const cases: readonly (readonly [number, number, number])[] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
      [3, -4, 5],
      [-2, 7, -1],
    ];
    const q = new Quaternion();
    for (const [x, y, z] of cases) {
      const direction = new Vector3(x, y, z);
      q.setFromLookDirection(direction, AXIS_Y);

      const unit = direction.clone().normalize();
      expectVectorCloseTo(facing(q), unit.x, unit.y, unit.z);
      expect(length(q)).toBeCloseTo(1, 12);

      // +Y stays on the same side of the aim as the reference up: the local
      // up has a non-negative dot with world +Y for any aim that is not
      // straight up or down.
      expect(rotated(q, AXIS_Y).dot(AXIS_Y)).toBeGreaterThan(0);
      // Local +X is perpendicular to world up when up is world +Y.
      expect(rotated(q, AXIS_X).dot(AXIS_Y)).toBeCloseTo(0, 12);
    }
  });

  it("produces a right-handed orthonormal frame", () => {
    const q = new Quaternion().setFromLookDirection(
      new Vector3(1, 2, -3),
      new Vector3(0.2, 1, 0.1),
    );
    const x = rotated(q, AXIS_X);
    const y = rotated(q, AXIS_Y);
    const z = rotated(q, AXIS_Z);
    expect(x.dot(y)).toBeCloseTo(0, 12);
    expect(y.dot(z)).toBeCloseTo(0, 12);
    expect(z.dot(x)).toBeCloseTo(0, 12);
    const cross = x.clone().cross(y);
    expectVectorCloseTo(cross, z.x, z.y, z.z);
  });

  it("ignores the lengths of direction and up", () => {
    const scaled = new Quaternion().setFromLookDirection(
      new Vector3(300, -400, 500),
      new Vector3(0, 17, 0),
    );
    const unit = new Quaternion().setFromLookDirection(
      new Vector3(3, -4, 5),
      AXIS_Y,
    );
    expectQuaternionCloseTo(scaled, unit.x, unit.y, unit.z, unit.w);
  });

  it("accepts an up that is not perpendicular to the direction", () => {
    const tilted = new Quaternion().setFromLookDirection(
      FORWARD,
      new Vector3(0, 1, -5),
    );
    // The up hint's component along the aim is projected out, so the frame is
    // the same one world +Y gives.
    expectQuaternionCloseTo(tilted, 0, 0, 0, 1);
  });

  it("hits every Shepperd branch and stays unit length", () => {
    // Each aim/up pair selects a different largest-divisor branch.
    const pairs: readonly (readonly [Vector3, Vector3])[] = [
      [FORWARD, AXIS_Y], // trace > 0
      [new Vector3(0, 0, 1), AXIS_Y], // m11 branch (180° about Y)
      [new Vector3(0, 0, 1), new Vector3(0, -1, 0)], // m22 branch
      [new Vector3(0, 1, 0), new Vector3(0, 0, 1)], // m33 branch
    ];
    for (const [direction, up] of pairs) {
      const q = new Quaternion().setFromLookDirection(direction, up);
      expect(length(q)).toBeCloseTo(1, 12);
      const unit = direction.clone().normalize();
      expectVectorCloseTo(facing(q), unit.x, unit.y, unit.z);
    }
  });

  it("agrees with Matrix4.decompose of the composed transform", () => {
    const q = new Quaternion().setFromLookDirection(
      new Vector3(2, -1, 4),
      new Vector3(0, 1, 0),
    );
    const composed = new Matrix4().compose(
      new Vector3(5, 6, 7),
      q,
      new Vector3(1, 1, 1),
      new Vector3(),
    );
    const back = new Quaternion();
    composed.decompose(new Vector3(), back, new Vector3());
    expectQuaternionCloseTo(back, q.x, q.y, q.z, q.w);
  });

  it("leaves the quaternion untouched for a zero or non-finite direction", () => {
    for (const bad of [
      new Vector3(0, 0, 0),
      new Vector3(Number.NaN, 0, 0),
      new Vector3(0, Number.POSITIVE_INFINITY, 0),
    ]) {
      const q = new Quaternion(0.1, 0.2, 0.3, 0.4);
      let calls = 0;
      q.onChanged = (): void => {
        calls += 1;
      };
      expect(q.setFromLookDirection(bad, AXIS_Y)).toBe(q);
      expect([q.x, q.y, q.z, q.w]).toEqual([0.1, 0.2, 0.3, 0.4]);
      expect(calls).toBe(0);
    }
  });

  it("leaves the quaternion untouched for a zero, parallel, or NaN up", () => {
    for (const bad of [
      new Vector3(0, 0, 0),
      new Vector3(0, 0, -1),
      new Vector3(0, 0, 2),
      new Vector3(Number.NaN, 1, 0),
    ]) {
      const q = new Quaternion(0.1, 0.2, 0.3, 0.4);
      let calls = 0;
      q.onChanged = (): void => {
        calls += 1;
      };
      expect(q.setFromLookDirection(FORWARD, bad)).toBe(q);
      expect([q.x, q.y, q.z, q.w]).toEqual([0.1, 0.2, 0.3, 0.4]);
      expect(calls).toBe(0);
    }
  });

  it("fires the change hook exactly once and allocates nothing", () => {
    const q = new Quaternion();
    let calls = 0;
    q.onChanged = (): void => {
      calls += 1;
    };
    const direction = new Vector3(1, 2, 3);
    resetConstructionCount();
    q.setFromLookDirection(direction, AXIS_Y);
    expect(constructionCount()).toBe(0);
    expect(calls).toBe(1);
  });
});

describe("Quaternion changed hook (plan D3)", () => {
  it("fires once per mutator and never for queries", () => {
    let calls = 0;
    const q = new Quaternion();
    q.onChanged = () => {
      calls += 1;
    };
    const other = new Quaternion().setFromAxisAngle(AXIS_X, Math.PI / 3);

    const mutators: Array<[string, () => void]> = [
      ["set", () => void q.set(0, 0, 0, 1)],
      ["copy", () => void q.copy(other)],
      ["identity", () => void q.identity()],
      ["setFromAxisAngle", () => void q.setFromAxisAngle(AXIS_Y, Math.PI / 2)],
      ["multiply", () => void q.multiply(other)],
      ["conjugate", () => void q.conjugate()],
      ["normalize", () => void q.normalize()],
      ["slerp", () => void q.slerp(other, 0.5)],
    ];
    for (const [name, run] of mutators) {
      const before = calls;
      run();
      expect(calls, `${name} must invoke the changed hook exactly once`).toBe(
        before + 1,
      );
    }
    expect(calls).toBe(mutators.length);

    const after = calls;
    q.clone();
    q.rotateVector3(AXIS_X, new Vector3());
    expect(calls).toBe(after);
  });

  it("fires on the degenerate branches of normalize and setFromAxisAngle", () => {
    let calls = 0;
    const q = new Quaternion(0, 0, 0, 0);
    q.onChanged = () => {
      calls += 1;
    };
    q.normalize();
    expect(calls).toBe(1);
    q.setFromAxisAngle(new Vector3(), 1);
    expect(calls).toBe(2);
  });

  it("does not fire for direct field writes (owners must markDirty)", () => {
    let calls = 0;
    const q = new Quaternion();
    q.onChanged = () => {
      calls += 1;
    };
    q.w = 0.5;
    expect(calls).toBe(0);
  });

  it("rotateVector3 fires the out vector's hook exactly once", () => {
    let calls = 0;
    const out = new Vector3();
    out.onChanged = () => {
      calls += 1;
    };
    new Quaternion()
      .setFromAxisAngle(AXIS_Y, Math.PI / 2)
      .rotateVector3(new Vector3(1, 0, 0), out);
    expect(calls).toBe(1);
  });
});

describe("Quaternion allocation counter (§7b, §83)", () => {
  beforeEach(() => {
    resetConstructionCount();
  });

  it("counts quaternion constructions, clone included", () => {
    expect(constructionCount()).toBe(0);
    const q = new Quaternion();
    expect(constructionCount()).toBe(1);
    q.clone();
    expect(constructionCount()).toBe(2);
  });

  it("performs 1000 iterations of chained ops with zero constructions", () => {
    const q = new Quaternion();
    const rotation = new Quaternion().setFromAxisAngle(AXIS_Y, Math.PI / 3);
    const target = new Quaternion().setFromAxisAngle(AXIS_X, Math.PI / 5);
    const axis = new Vector3(0.5, 1, -2);
    const source = new Vector3(1, 2, 3);
    const scratch = new Vector3();

    let accumulator = 0;

    resetConstructionCount();
    for (let i = 0; i < 1000; i += 1) {
      q.identity()
        .setFromAxisAngle(axis, 0.25)
        .multiply(rotation)
        .conjugate()
        .normalize()
        .slerp(target, 0.25);
      q.rotateVector3(source, scratch);
      q.rotateVector3(scratch, scratch);
      accumulator += scratch.lengthSq() + q.w;
    }

    expect(constructionCount()).toBe(0);
    expect(Number.isFinite(accumulator)).toBe(true);
  });
});

describe("Quaternion dot / invert / equalsApprox", () => {
  it("dot is the four-component product and does not mutate", () => {
    const a = new Quaternion(1, 2, 3, 4);
    const b = new Quaternion(5, 6, 7, 8);
    expect(a.dot(b)).toBe(70);
    expect([a.x, a.y, a.z, a.w]).toEqual([1, 2, 3, 4]);
  });

  it("invert round-trips multiply to identity, for non-unit input too", () => {
    const q = new Quaternion(1, 2, 3, 4);
    const product = q.clone().multiply(q.clone().invert());
    expect(product.equalsApprox(new Quaternion(0, 0, 0, 1), 1e-12)).toBe(true);
  });

  it("invert of a zero quaternion is the identity; hook fires once in both branches", () => {
    const z = new Quaternion(0, 0, 0, 0);
    let calls = 0;
    z.onChanged = () => calls++;
    expect(z.invert()).toBe(z);
    expect([z.x, z.y, z.z, z.w]).toEqual([0, 0, 0, 1]);
    expect(calls).toBe(1);
    const q = new Quaternion(0, 0, 0, 2);
    q.onChanged = () => calls++;
    q.invert();
    expect(q.w).toBe(0.5);
    expect(calls).toBe(2);
  });

  it("equalsApprox is sign-insensitive and respects epsilon", () => {
    const q = new Quaternion(0.1, 0.2, 0.3, 0.9);
    const neg = new Quaternion(-0.1, -0.2, -0.3, -0.9);
    expect(q.equalsApprox(q.clone())).toBe(true);
    expect(q.equalsApprox(neg)).toBe(true);
    expect(q.equalsApprox(new Quaternion(0.1, 0.2, 0.3, 0.8))).toBe(false);
    // Mixed signs match neither q nor -q.
    expect(q.equalsApprox(new Quaternion(-0.1, 0.2, 0.3, 0.9))).toBe(false);
    expect(q.equalsApprox(new Quaternion(0.1, 0.2, 0.3, 0.8), 0.2)).toBe(true);
  });

  it("the new methods allocate nothing", () => {
    const q = new Quaternion(0, 0, 0, 1);
    resetConstructionCount();
    q.invert();
    q.dot(q);
    q.equalsApprox(q);
    expect(constructionCount()).toBe(0);
  });
});
