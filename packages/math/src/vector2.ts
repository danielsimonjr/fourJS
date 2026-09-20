import { noteConstruction } from "./alloc-counter.js";

/**
 * Default tolerance for {@link Vector2.equalsApprox}. Chosen to sit a little
 * above float32 round-trip error so values that survive a GPU round trip still
 * compare equal, while staying far below any meaningful world-space distance
 * in the default metre unit system (§40).
 */
const DEFAULT_EPSILON = 1e-6;

/**
 * Mutable two-component vector (§7b).
 *
 * Allocation policy (§7b, plan D7): instance methods that produce a
 * "this-shaped" result mutate in place and return `this`; only
 * {@link Vector2.clone} allocates. Scalar queries (`dot`, `lengthSq`,
 * `length`) and `equalsApprox` never allocate and never mutate.
 *
 * Change notification (plan D3): every mutator invokes {@link Vector2.onChanged}
 * after writing, which lets owners such as `Transform` bump their `version`
 * when a member vector is mutated through a method (§7). Direct field writes
 * (`v.x = 1`) bypass the hook by design and require an explicit `markDirty()`
 * on the owner.
 */
export class Vector2 {
  x: number;
  y: number;

  /**
   * Optional change hook invoked at the end of every mutator. Engine-internal:
   * owners install it, user code normally leaves it unset. It is intentionally
   * *not* copied by {@link Vector2.copy} or {@link Vector2.clone} — the hook
   * belongs to the owner of the instance, not to the value.
   */
  onChanged?: () => void;

  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
    noteConstruction();
  }

  /** Sets both components. */
  set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    this.onChanged?.();
    return this;
  }

  /** Copies the components of `v` into this vector. The change hook is not copied. */
  copy(v: Vector2): this {
    this.x = v.x;
    this.y = v.y;
    this.onChanged?.();
    return this;
  }

  /**
   * Allocates a new vector with the same components. The clone has no change
   * hook. This is the only allocating method on the type (§7b).
   */
  clone(): Vector2 {
    return new Vector2(this.x, this.y);
  }

  /** Adds `v` component-wise. */
  add(v: Vector2): this {
    this.x += v.x;
    this.y += v.y;
    this.onChanged?.();
    return this;
  }

  /** Subtracts `v` component-wise. */
  sub(v: Vector2): this {
    this.x -= v.x;
    this.y -= v.y;
    this.onChanged?.();
    return this;
  }

  /** Multiplies both components by the scalar `s`. */
  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.onChanged?.();
    return this;
  }

  /** Dot product with `v`. Does not mutate. */
  dot(v: Vector2): number {
    return this.x * v.x + this.y * v.y;
  }

  /** Squared length. Preferred over {@link Vector2.length} for comparisons. */
  lengthSq(): number {
    return this.x * this.x + this.y * this.y;
  }

  /** Euclidean length. */
  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  /**
   * Scales this vector to unit length.
   *
   * Zero-length behaviour (defined here, no other convention is normative):
   * normalizing a zero-length vector leaves it at `(0, 0)` rather than
   * producing `NaN` or throwing. There is no meaningful direction to pick, and
   * silently poisoning a hot path with `NaN` is worse than a no-op. The change
   * hook still fires, because the method completed as a mutator.
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
   *   to `Infinity`, so the reciprocal is `0` and this vector becomes `(0, 0)`.
   * - **Non-finite input.** An infinite component gives `NaN` in that slot and
   *   `0` in the other; a `NaN` component leaves the vector untouched, because
   *   `NaN > 0` is false.
   */
  normalize(): this {
    const lengthSquared = this.x * this.x + this.y * this.y;
    if (lengthSquared > 0) {
      const inverseLength = 1 / Math.sqrt(lengthSquared);
      this.x *= inverseLength;
      this.y *= inverseLength;
    }
    this.onChanged?.();
    return this;
  }

  /**
   * Moves this vector toward `target` by the factor `t`, mutating this vector.
   * `t = 0` leaves it unchanged, `t = 1` makes it equal to `target`. Values
   * outside `[0, 1]` extrapolate; no clamping is applied.
   */
  lerp(target: Vector2, t: number): this {
    this.x += (target.x - this.x) * t;
    this.y += (target.y - this.y) * t;
    this.onChanged?.();
    return this;
  }

  /**
   * Component-wise approximate equality: true when every component differs by
   * at most `epsilon` (absolute tolerance).
   */
  equalsApprox(v: Vector2, epsilon: number = DEFAULT_EPSILON): boolean {
    return (
      Math.abs(this.x - v.x) <= epsilon && Math.abs(this.y - v.y) <= epsilon
    );
  }
}
