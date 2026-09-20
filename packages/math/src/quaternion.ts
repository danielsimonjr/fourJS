import { noteConstruction } from "./alloc-counter.js";
import type { Vector3 } from "./vector3.js";

/**
 * Above this dot product the two ends of a {@link Quaternion.slerp} are treated
 * as nearly parallel and normalized linear interpolation (nlerp) is used
 * instead of the trigonometric form.
 *
 * Rationale: the spherical form divides by `sin(theta)`, which goes to zero as
 * the inputs converge, so the quotient loses precision and finally becomes
 * `0 / 0`. At `dot = 0.9995` the half-angle between the quaternions is about
 * 1.8 degrees (a 3.6 degree rotation difference); across an arc that small the
 * nlerp path deviates from the true constant-speed arc by well under 1e-4
 * radians, which is far below any tolerance the engine cares about, while
 * remaining numerically stable all the way to `dot = 1`.
 */
const SLERP_LINEAR_THRESHOLD = 0.9995;

/**
 * Writes the rotation described by an **orthonormal, right-handed** basis into
 * `out` and returns it, using Shepperd's method: pick the branch whose divisor
 * is largest so the square root never operates on a value near zero.
 *
 * The nine scalars are the basis **columns** in `Matrix4`'s naming
 * (`m<row><column>`), i.e. column 1 is `(m11, m21, m31)` — the image of local
 * +X — column 2 the image of +Y, and column 3 the image of +Z.
 *
 * Module-internal and deliberately not re-exported from the package barrel: it
 * is the one implementation of the matrix→quaternion conversion, shared by
 * `Matrix4.decompose` (which normalizes its columns first) and by
 * {@link Quaternion.setFromLookDirection} (which builds its columns from cross
 * products). Nothing here validates orthonormality — a caller that passes a
 * sheared or scaled basis gets a meaningless rotation, exactly as it did when
 * each caller carried its own copy.
 *
 * `out` is written through a single `set(...)`, so its change hook fires
 * exactly once.
 */
export function setQuaternionFromBasis(
  out: Quaternion,
  m11: number,
  m21: number,
  m31: number,
  m12: number,
  m22: number,
  m32: number,
  m13: number,
  m23: number,
  m33: number,
): Quaternion {
  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return out.set((m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s);
  }
  if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    return out.set(0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s);
  }
  if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    return out.set((m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s);
  }
  const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
  return out.set((m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s);
}

/**
 * Mutable unit quaternion `(x, y, z, w)` representing a 3D rotation (§7b). The
 * world is right-handed with +Y up (§7a) and **every angle is radians**;
 * quaternions compose with the Hamilton product, so `a.multiply(b)` yields the
 * rotation that applies `b` first and `a` second.
 *
 * The identity rotation is `(0, 0, 0, 1)` — hence `w` defaults to 1 while the
 * vector part defaults to 0.
 *
 * Allocation policy (§7b, plan D7): mutating methods mutate in place and return
 * `this`; only {@link Quaternion.clone} allocates. {@link Quaternion.rotateVector3}
 * produces a result that is *not* `this`, so it takes a required `out`
 * parameter and returns it — nothing on that path allocates either.
 *
 * Change notification (plan D3): every mutator invokes {@link Quaternion.onChanged}
 * exactly once, after the last component is written. Direct field writes
 * (`q.x = 1`) bypass the hook by design.
 *
 * Methods assume unit quaternions where the mathematics requires it
 * ({@link Quaternion.conjugate} as inverse, {@link Quaternion.rotateVector3},
 * {@link Quaternion.slerp}); nothing normalizes defensively on those hot paths.
 */
export class Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;

  /**
   * Optional change hook invoked at the end of every mutator. Engine-internal:
   * owners install it, user code normally leaves it unset. It is intentionally
   * *not* copied by {@link Quaternion.copy} or {@link Quaternion.clone}.
   */
  onChanged?: () => void;

  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    noteConstruction();
  }

  /** Sets all four components. */
  set(x: number, y: number, z: number, w: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    this.onChanged?.();
    return this;
  }

  /** Copies the components of `q` into this quaternion. The change hook is not copied. */
  copy(q: Quaternion): this {
    this.x = q.x;
    this.y = q.y;
    this.z = q.z;
    this.w = q.w;
    this.onChanged?.();
    return this;
  }

  /**
   * Allocates a new quaternion with the same components. The clone has no
   * change hook. This is the only allocating method on the type (§7b).
   */
  clone(): Quaternion {
    return new Quaternion(this.x, this.y, this.z, this.w);
  }

  /** Resets this quaternion to the identity rotation `(0, 0, 0, 1)`. */
  identity(): this {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.w = 1;
    this.onChanged?.();
    return this;
  }

  /**
   * Sets this quaternion to the rotation of `angleRadians` about `axis`,
   * counter-clockwise when looking down the axis toward the origin
   * (right-handed, §7a). Angles are radians (§7a) — there is no degree overload.
   *
   * `axis` need not be unit length: it is normalized from plain scalars, with
   * no temporary vector. A zero-length axis has no direction to rotate about,
   * so it produces the identity rotation rather than `NaN` (defined here; the
   * same "no-op beats poisoning the frame" reasoning as `Vector3.normalize`).
   * The change hook fires in either case.
   */
  setFromAxisAngle(axis: Vector3, angleRadians: number): this {
    const lengthSquared = axis.x * axis.x + axis.y * axis.y + axis.z * axis.z;
    if (lengthSquared > 0) {
      const inverseLength = 1 / Math.sqrt(lengthSquared);
      const halfAngle = angleRadians * 0.5;
      const sinHalf = Math.sin(halfAngle);
      this.x = axis.x * inverseLength * sinHalf;
      this.y = axis.y * inverseLength * sinHalf;
      this.z = axis.z * inverseLength * sinHalf;
      this.w = Math.cos(halfAngle);
    } else {
      this.x = 0;
      this.y = 0;
      this.z = 0;
      this.w = 1;
    }
    this.onChanged?.();
    return this;
  }

  /**
   * Sets this quaternion to the rotation that aims the **−Z axis** along
   * `direction` while keeping the +Y axis as close to `up` as the aim allows
   * (§7a: right-handed, +Y up; §7b: radians and mutable math types).
   *
   * −Z is the engine's one "forward" for every node, not a camera special case:
   * `Matrix4.setPerspective` projects down −Z (plan D8), `Camera.viewMatrix` is
   * the inverse of a world matrix built on that basis, and a directional or
   * spot light shines along its node's −Z (§68). One convention means a rig
   * aims a camera and a light with the same call.
   *
   * Neither argument need be unit length and `up` need not be perpendicular to
   * `direction`: the basis is built as
   *
   * ```text
   * zAxis = normalize(−direction)      // local +Z, opposite the aim
   * xAxis = normalize(up × zAxis)      // local +X
   * yAxis = zAxis × xAxis              // local +Y, already unit
   * ```
   *
   * and converted with Shepperd's method, so the result is a unit quaternion
   * built from an exactly orthonormal basis. Allocates nothing — the basis
   * lives in plain scalars — and writes through a single `set(...)`, so the
   * change hook fires exactly once.
   *
   * ## Degenerate input leaves this quaternion **unchanged**
   *
   * A zero-length `direction`, a zero-length `up`, an `up` parallel to
   * `direction`, or a non-finite component of either leaves every component
   * alone and does **not** fire the change hook: there is no rotation those
   * inputs describe, and the two rejected alternatives are both worse.
   * Resetting to the identity substitutes a different, plausible-looking
   * orientation for the failure (the reasoning `Matrix4.invert` already gives
   * for refusing a singular matrix); picking a fallback `up` silently rewrites
   * the aim the caller asked for. Leaving the previous aim in place is the only
   * outcome that neither invents nor destroys information.
   *
   * The math package validates nothing (see `Matrix4.setPerspective`), so this
   * method reports nothing either. `Node.lookAt` in `@fourjs/scene` is the policy
   * layer: it makes the same two tests on its own inputs and throws, so a scene
   * node never reaches the silent branch.
   */
  setFromLookDirection(direction: Vector3, up: Vector3): this {
    // Local +Z is opposite the aim: the frame looks down its own −Z.
    const zx = -direction.x;
    const zy = -direction.y;
    const zz = -direction.z;
    const zLengthSquared = zx * zx + zy * zy + zz * zz;
    if (!(zLengthSquared > 0)) {
      return this;
    }
    const inverseZLength = 1 / Math.sqrt(zLengthSquared);
    const m13 = zx * inverseZLength;
    const m23 = zy * inverseZLength;
    const m33 = zz * inverseZLength;

    // xAxis = up × zAxis, zero exactly when `up` is parallel to the aim.
    const xx = up.y * m33 - up.z * m23;
    const xy = up.z * m13 - up.x * m33;
    const xz = up.x * m23 - up.y * m13;
    const xLengthSquared = xx * xx + xy * xy + xz * xz;
    if (!(xLengthSquared > 0)) {
      return this;
    }
    const inverseXLength = 1 / Math.sqrt(xLengthSquared);
    const m11 = xx * inverseXLength;
    const m21 = xy * inverseXLength;
    const m31 = xz * inverseXLength;

    // yAxis = zAxis × xAxis; unit already, both operands being unit and
    // perpendicular.
    const m12 = m23 * m31 - m33 * m21;
    const m22 = m33 * m11 - m13 * m31;
    const m32 = m13 * m21 - m23 * m11;

    setQuaternionFromBasis(this, m11, m21, m31, m12, m22, m32, m13, m23, m33);
    return this;
  }

  /**
   * Hamilton product `this = this * q`: the resulting rotation applies `q`
   * first and this quaternion second. Aliasing-safe — `q` may be `this`.
   */
  multiply(q: Quaternion): this {
    const { x: ax, y: ay, z: az, w: aw } = this;
    const bx = q.x;
    const by = q.y;
    const bz = q.z;
    const bw = q.w;
    this.x = aw * bx + ax * bw + ay * bz - az * by;
    this.y = aw * by - ax * bz + ay * bw + az * bx;
    this.z = aw * bz + ax * by - ay * bx + az * bw;
    this.w = aw * bw - ax * bx - ay * by - az * bz;
    this.onChanged?.();
    return this;
  }

  /**
   * Negates the vector part, giving the conjugate. For a **unit** quaternion
   * this is the inverse rotation; for a non-unit quaternion it is not (the
   * inverse would also divide by the squared length).
   */
  conjugate(): this {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    this.onChanged?.();
    return this;
  }

  /**
   * Scales this quaternion to unit length.
   *
   * Zero-length behaviour (defined here): a zero-length quaternion is not a
   * rotation at all and cannot be scaled into one, so it is reset to the
   * identity rather than producing `NaN`. This differs from `Vector3.normalize`,
   * which leaves the zero vector alone — the zero *vector* is a legitimate
   * value downstream, the zero *quaternion* never is. The change hook fires in
   * either case.
   *
   * Range behaviour — the guard below tests the **squared** length, so three
   * ranges do not produce a unit quaternion and none of them reports an error
   * (measured from a consumer seat, dogfood cycle 10):
   *
   * - **Underflow.** A squared length that rounds to `0` (components below
   *   about `1.57e-162`) is read as zero length, so the quaternion is **reset
   *   to the identity** — a tiny but real rotation is discarded silently.
   * - **Overflow.** A component at or above `1.3407807929942597e+154` squares
   *   to `Infinity`, so the reciprocal is `0` and every component becomes `0`,
   *   including `w`. Unlike the zero-length branch, this leaves the **zero**
   *   quaternion rather than the identity.
   * - **Non-finite input.** A `NaN` component makes `lengthSquared > 0` false,
   *   so the quaternion is reset to the identity; an infinite component gives
   *   `NaN` in that slot and `0` in the others.
   */
  normalize(): this {
    const lengthSquared =
      this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
    if (lengthSquared > 0) {
      const inverseLength = 1 / Math.sqrt(lengthSquared);
      this.x *= inverseLength;
      this.y *= inverseLength;
      this.z *= inverseLength;
      this.w *= inverseLength;
    } else {
      this.x = 0;
      this.y = 0;
      this.z = 0;
      this.w = 1;
    }
    this.onChanged?.();
    return this;
  }

  /**
   * Spherically interpolates this quaternion toward `target` by `t`, mutating
   * this quaternion. `t = 0` leaves it unchanged, `t = 1` makes it equal to
   * `target` (up to sign — see below). Values outside `[0, 1]` extrapolate
   * along the same arc; no clamping is applied. Both inputs are assumed unit
   * length.
   *
   * Shortest arc (plan D8): `q` and `-q` denote the same rotation, so when the
   * dot product is negative the *target's* components are negated for the
   * interpolation. The result then travels the short way round, and at `t = 1`
   * equals `-target` — the same rotation as `target`, with opposite components.
   *
   * Nearly parallel inputs (dot above `SLERP_LINEAR_THRESHOLD`, 0.9995)
   * fall back to normalized linear interpolation, which avoids dividing by
   * `sin(theta)` as `theta` goes to zero. See that constant for the error
   * bound.
   */
  slerp(target: Quaternion, t: number): this {
    const { x: ax, y: ay, z: az, w: aw } = this;
    let bx = target.x;
    let by = target.y;
    let bz = target.z;
    let bw = target.w;

    let cosHalfTheta = ax * bx + ay * by + az * bz + aw * bw;
    if (cosHalfTheta < 0) {
      bx = -bx;
      by = -by;
      bz = -bz;
      bw = -bw;
      cosHalfTheta = -cosHalfTheta;
    }

    let scaleFrom: number;
    let scaleTo: number;
    if (cosHalfTheta > SLERP_LINEAR_THRESHOLD) {
      scaleFrom = 1 - t;
      scaleTo = t;
    } else {
      const halfTheta = Math.acos(cosHalfTheta);
      const inverseSinHalfTheta =
        1 / Math.sqrt(1 - cosHalfTheta * cosHalfTheta);
      scaleFrom = Math.sin((1 - t) * halfTheta) * inverseSinHalfTheta;
      scaleTo = Math.sin(t * halfTheta) * inverseSinHalfTheta;
    }

    const x = ax * scaleFrom + bx * scaleTo;
    const y = ay * scaleFrom + by * scaleTo;
    const z = az * scaleFrom + bz * scaleTo;
    const w = aw * scaleFrom + bw * scaleTo;

    // Renormalize inline rather than calling `normalize()`, which would fire
    // the change hook a second time. The nlerp branch needs it; the spherical
    // branch is already unit length up to rounding, so this only tidies drift.
    const lengthSquared = x * x + y * y + z * z + w * w;
    if (lengthSquared > 0) {
      const inverseLength = 1 / Math.sqrt(lengthSquared);
      this.x = x * inverseLength;
      this.y = y * inverseLength;
      this.z = z * inverseLength;
      this.w = w * inverseLength;
    } else {
      // Only reachable for antipodal inputs at exactly t = 0.5, which the
      // shortest-arc negation above already rules out for unit inputs.
      this.x = 0;
      this.y = 0;
      this.z = 0;
      this.w = 1;
    }
    this.onChanged?.();
    return this;
  }

  /**
   * Rotates `v` by this (unit) quaternion and writes the result into `out`,
   * which is **required** (plan D7: the result is not `this`, so the caller
   * owns the storage — nothing here allocates). Returns `out`.
   *
   * Aliasing-safe: `v` and `out` may be the same vector; `v` is read into
   * scalars before `out` is written. This quaternion is not modified and its
   * change hook does not fire; `out` is written through `Vector3.set`, so
   * `out`'s hook fires exactly once.
   *
   * Uses `v' = v + 2 * w * (u x v) + 2 * (u x (u x v))` with `u = (x, y, z)`,
   * the standard expansion of `q * v * q⁻¹` for unit `q`.
   */
  rotateVector3(v: Vector3, out: Vector3): Vector3 {
    const { x: qx, y: qy, z: qz, w: qw } = this;
    const vx = v.x;
    const vy = v.y;
    const vz = v.z;

    // t = 2 * (u x v)
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);

    return out.set(
      vx + qw * tx + (qy * tz - qz * ty),
      vy + qw * ty + (qz * tx - qx * tz),
      vz + qw * tz + (qx * ty - qy * tx),
    );
  }
}
