import { noteConstruction } from "./alloc-counter.js";

/**
 * Default tolerance for {@link Vector4.equalsApprox}. See `vector2.ts` for the
 * rationale; all three vector types use the same value.
 */
const DEFAULT_EPSILON = 1e-6;

/**
 * Mutable four-component vector (§7b) — homogeneous coordinates, plane
 * equations, RGBA channels, and shader uniforms.
 *
 * Allocation policy (§7b, plan D7): instance methods that produce a
 * "this-shaped" result mutate in place and return `this`; only
 * {@link Vector4.clone} allocates. Scalar queries (`dot`, `lengthSq`,
 * `length`) and `equalsApprox` never allocate and never mutate. All four
 * components — `w` included — participate in every operation; there is no
 * perspective divide here.
 *
 * Change notification (plan D3): every mutator invokes {@link Vector4.onChanged}
 * after writing. Direct field writes (`v.x = 1`) bypass the hook by design.
 */
export class Vector4 {
  x: number;
  y: number;
  z: number;
  w: number;

  /**
   * Optional change hook invoked at the end of every mutator. Engine-internal:
   * owners install it, user code normally leaves it unset. It is intentionally
   * *not* copied by {@link Vector4.copy} or {@link Vector4.clone}.
   */
  onChanged?: () => void;

  constructor(x = 0, y = 0, z = 0, w = 0) {
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

  /** Copies the components of `v` into this vector. The change hook is not copied. */
  copy(v: Vector4): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    this.w = v.w;
    this.onChanged?.();
    return this;
  }

  /**
   * Allocates a new vector with the same components. The clone has no change
   * hook. This is the only allocating method on the type (§7b).
   */
  clone(): Vector4 {
    return new Vector4(this.x, this.y, this.z, this.w);
  }

  /** Adds `v` component-wise. */
  add(v: Vector4): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    this.w += v.w;
    this.onChanged?.();
    return this;
  }

  /** Subtracts `v` component-wise. */
  sub(v: Vector4): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    this.w -= v.w;
    this.onChanged?.();
    return this;
  }

  /** Multiplies every component by the scalar `s`. */
  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    this.w *= s;
    this.onChanged?.();
    return this;
  }

  /** Dot product with `v`, including `w`. Does not mutate. */
  dot(v: Vector4): number {
    return this.x * v.x + this.y * v.y + this.z * v.z + this.w * v.w;
  }

  /** Squared length. Preferred over {@link Vector4.length} for comparisons. */
  lengthSq(): number {
    return (
      this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w
    );
  }

  /** Euclidean length over all four components. */
  length(): number {
    return Math.sqrt(
      this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w,
    );
  }

  /**
   * Scales this vector to unit length.
   *
   * Zero-length behaviour (defined here): normalizing a zero-length vector
   * leaves it at `(0, 0, 0, 0)` rather than producing `NaN` or throwing — there
   * is no meaningful direction to pick, and poisoning a hot path with `NaN` is
   * worse than a no-op. The change hook still fires.
   *
   * Range behaviour — the guard below tests the **squared** length, so three
   * ranges leave this vector non-unit and none of them reports an error
   * (measured from a consumer seat, dogfood cycle 10); `Vector3.normalize`
   * documents the same three with numbers:
   *
   * - **Underflow.** A squared length that rounds to `0` (components below
   *   about `1.57e-162`) takes the zero-length branch, so the vector is left
   *   unchanged and non-unit.
   * - **Overflow.** A component at or above `1.3407807929942597e+154` squares
   *   to `Infinity`, so the reciprocal is `0` and every component becomes `0`.
   * - **Non-finite input.** An infinite component gives `NaN` in that slot and
   *   `0` in the others; a `NaN` component leaves the vector untouched,
   *   because `NaN > 0` is false.
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
    }
    this.onChanged?.();
    return this;
  }

  /**
   * Moves this vector toward `target` by the factor `t`, mutating this vector.
   * `t = 0` leaves it unchanged, `t = 1` makes it equal to `target`. Values
   * outside `[0, 1]` extrapolate; no clamping is applied.
   */
  lerp(target: Vector4, t: number): this {
    this.x += (target.x - this.x) * t;
    this.y += (target.y - this.y) * t;
    this.z += (target.z - this.z) * t;
    this.w += (target.w - this.w) * t;
    this.onChanged?.();
    return this;
  }

  /**
   * Component-wise approximate equality: true when every component differs by
   * at most `epsilon` (absolute tolerance).
   */
  equalsApprox(v: Vector4, epsilon: number = DEFAULT_EPSILON): boolean {
    return (
      Math.abs(this.x - v.x) <= epsilon &&
      Math.abs(this.y - v.y) <= epsilon &&
      Math.abs(this.z - v.z) <= epsilon &&
      Math.abs(this.w - v.w) <= epsilon
    );
  }
}
