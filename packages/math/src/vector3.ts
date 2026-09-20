import { noteConstruction } from "./alloc-counter.js";

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
}
