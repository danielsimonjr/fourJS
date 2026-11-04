import { noteConstruction } from "./alloc-counter.js";
import type { Matrix4 } from "./matrix4.js";

/**
 * Default tolerance for {@link Vector3.equalsApprox}. See `vector2.ts` for the
 * rationale; all three vector types use the same value.
 */
const DEFAULT_EPSILON = 1e-6;

/**
 * Mutable three-component vector (§7b) — the primary vector type of the engine
 * (§7 transforms, §11 motion, §20+ physics). The world is right-handed with +Y
 * up in both 2D and 3D (§7a).
 *
 * Allocation policy (§7b, plan D7): instance methods that produce a
 * "this-shaped" result mutate in place and return `this`; only
 * {@link Vector3.clone} allocates. Scalar queries (`dot`, `lengthSq`,
 * `length`) and `equalsApprox` never allocate and never mutate.
 *
 * Change notification (plan D3): every mutator invokes {@link Vector3.onChanged}
 * after writing. Direct field writes (`v.x = 1`) bypass the hook by design.
 */
export class Vector3 {
  x: number;
  y: number;
  z: number;

  /**
   * Optional change hook invoked at the end of every mutator. Engine-internal:
   * owners install it, user code normally leaves it unset. It is intentionally
   * *not* copied by {@link Vector3.copy} or {@link Vector3.clone}.
   */
  onChanged?: () => void;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
    noteConstruction();
  }

  /** Sets all three components. */
  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.onChanged?.();
    return this;
  }

  /** Copies the components of `v` into this vector. The change hook is not copied. */
  copy(v: Vector3): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    this.onChanged?.();
    return this;
  }

  /**
   * Allocates a new vector with the same components. The clone has no change
   * hook. This is the only allocating method on the type (§7b).
   */
  clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }

  /** Adds `v` component-wise. */
  add(v: Vector3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    this.onChanged?.();
    return this;
  }

  /** Subtracts `v` component-wise. */
  sub(v: Vector3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    this.onChanged?.();
    return this;
  }

  /** Multiplies every component by the scalar `s`. */
  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    this.onChanged?.();
    return this;
  }

  /** Dot product with `v`. Does not mutate. */
  dot(v: Vector3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  /**
   * Right-handed cross product, mutating this vector to `this × v` (this
   * vector is the left operand). Reading the result requires the temporaries
   * below because two components are overwritten before the third is read.
   *
   * Aliasing-safe: `v` may be `this`. **Both** operands are read into scalars
   * first, not just the receiver — reading `v` live while writing `this` is
   * the whole bug when the two are the same object, and `a.cross(a)` must be
   * the zero vector.
   */
  cross(v: Vector3): this {
    const { x, y, z } = this;
    const { x: vx, y: vy, z: vz } = v;
    this.x = y * vz - z * vy;
    this.y = z * vx - x * vz;
    this.z = x * vy - y * vx;
    this.onChanged?.();
    return this;
  }

  /** Squared length. Preferred over {@link Vector3.length} for comparisons. */
  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  /** Euclidean length. */
  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  /**
   * Scales this vector to unit length.
   *
   * Zero-length behaviour (defined here): normalizing a zero-length vector
   * leaves it at `(0, 0, 0)` rather than producing `NaN` or throwing — there is
   * no meaningful direction to pick, and poisoning a hot path with `NaN` is
   * worse than a no-op. The change hook still fires.
   *
   * Range behaviour — the guard below tests the **squared** length, so three
   * ranges leave this vector non-unit and none of them reports an error
   * (measured from a consumer seat, dogfood cycle 10):
   *
   * - **Underflow.** A vector whose squared length rounds to `0` — every
   *   component below about `1.57e-162` — takes the zero-length branch and is
   *   left unchanged, non-unit. Just above that bound the square is denormal
   *   and has lost most of its mantissa, so the result can be as far off as
   *   `0.707` in length.
   * - **Overflow.** A component at or above `1.3407807929942597e+154` squares
   *   to `Infinity`, so `1 / Math.sqrt(lengthSquared)` is `0` and every
   *   component is written as `0`: a large finite vector normalizes to the
   *   **zero vector**.
   * - **Non-finite input.** An infinite component gives `NaN` in that slot and
   *   `0` in the others. A `NaN` component leaves the vector untouched,
   *   because `NaN > 0` is false. The zero-length promise above covers a zero
   *   input, not a non-finite one — `normalize()` does produce `NaN` here.
   *
   * Nothing clamps and nothing throws (§85, §61): a hot path that can see such
   * magnitudes scales into range before normalizing.
   */
  normalize(): this {
    const lengthSquared = this.x * this.x + this.y * this.y + this.z * this.z;
    if (lengthSquared > 0) {
      const inverseLength = 1 / Math.sqrt(lengthSquared);
      this.x *= inverseLength;
      this.y *= inverseLength;
      this.z *= inverseLength;
    }
    this.onChanged?.();
    return this;
  }

  /**
   * Moves this vector toward `target` by the factor `t`, mutating this vector.
   * `t = 0` leaves it unchanged, `t = 1` makes it equal to `target`. Values
   * outside `[0, 1]` extrapolate; no clamping is applied.
   */
  lerp(target: Vector3, t: number): this {
    this.x += (target.x - this.x) * t;
    this.y += (target.y - this.y) * t;
    this.z += (target.z - this.z) * t;
    this.onChanged?.();
    return this;
  }

  /**
   * Component-wise approximate equality: true when every component differs by
   * at most `epsilon` (absolute tolerance).
   */
  equalsApprox(v: Vector3, epsilon: number = DEFAULT_EPSILON): boolean {
    return (
      Math.abs(this.x - v.x) <= epsilon &&
      Math.abs(this.y - v.y) <= epsilon &&
      Math.abs(this.z - v.z) <= epsilon
    );
  }

  /** Euclidean distance to `v`; `sqrt` of the squared sum, never `Math.hypot`, so results are bit-stable per runtime. Does not mutate. */
  distanceTo(v: Vector3): number {
    return Math.sqrt(this.distanceToSq(v));
  }

  /** Squared distance to `v`; preferred over {@link Vector3.distanceTo} for comparisons. Does not mutate. */
  distanceToSq(v: Vector3): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }

  /** Negates every component in place (reverses direction without allocating). */
  negate(): this {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    this.onChanged?.();
    return this;
  }

  /** Multiplies by `v` component-wise (Hadamard product), e.g. for non-uniform scale. Alias-safe: `a.multiply(a)` squares. */
  multiply(v: Vector3): this {
    this.x *= v.x;
    this.y *= v.y;
    this.z *= v.z;
    this.onChanged?.();
    return this;
  }

  /** Replaces each component with the smaller of it and the matching component of `v` (AABB min accumulation). */
  min(v: Vector3): this {
    this.x = Math.min(this.x, v.x);
    this.y = Math.min(this.y, v.y);
    this.z = Math.min(this.z, v.z);
    this.onChanged?.();
    return this;
  }

  /** Replaces each component with the larger of it and the matching component of `v` (AABB max accumulation). */
  max(v: Vector3): this {
    this.x = Math.max(this.x, v.x);
    this.y = Math.max(this.y, v.y);
    this.z = Math.max(this.z, v.z);
    this.onChanged?.();
    return this;
  }

  /** Adds `v * s` in place (`this += v * s`) — the fused step integrators need, with no temporary vector. */
  addScaled(v: Vector3, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    this.onChanged?.();
    return this;
  }

  /**
   * Transforms this vector as a **point** by the affine matrix `m`: columns
   * 0-2 plus translation `e[12..14]`. Affine `m` only — the homogeneous row
   * is ignored (use {@link Vector3.applyProjection} for projections).
   * Operands are read into scalars first, so it is alias-safe.
   */
  applyMatrix4(m: Matrix4): this {
    const e = m.elements;
    const x = this.x;
    const y = this.y;
    const z = this.z;
    this.x = e[0] * x + e[4] * y + e[8] * z + e[12];
    this.y = e[1] * x + e[5] * y + e[9] * z + e[13];
    this.z = e[2] * x + e[6] * y + e[10] * z + e[14];
    this.onChanged?.();
    return this;
  }

  /**
   * Transforms this vector as a **direction** by the upper-left 3x3 of `m`
   * (translation ignored). The result is **not renormalized**: callers such
   * as ray picking need the scaled length to stay meaningful under scale.
   */
  transformDirection(m: Matrix4): this {
    const e = m.elements;
    const x = this.x;
    const y = this.y;
    const z = this.z;
    this.x = e[0] * x + e[4] * y + e[8] * z;
    this.y = e[1] * x + e[5] * y + e[9] * z;
    this.z = e[2] * x + e[6] * y + e[10] * z;
    this.onChanged?.();
    return this;
  }

  /**
   * Transforms this vector as a point by the full homogeneous matrix `m` and
   * divides by `w`. When `w === 0` the result is `(0, 0, 0)` rather than
   * `Infinity`/`NaN`, mirroring the unproject policy in `pick.ts` and
   * `Matrix4.invert`'s refusal of singular input.
   */
  applyProjection(m: Matrix4): this {
    const e = m.elements;
    const x = this.x;
    const y = this.y;
    const z = this.z;
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (w === 0) {
      this.x = 0;
      this.y = 0;
      this.z = 0;
    } else {
      const inverseW = 1 / w;
      this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * inverseW;
      this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * inverseW;
      this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * inverseW;
    }
    this.onChanged?.();
    return this;
  }
}
