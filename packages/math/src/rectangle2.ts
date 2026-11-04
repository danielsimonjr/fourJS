import { noteConstruction } from "./alloc-counter.js";

/**
 * Default tolerance for {@link Rectangle2.equalsApprox}. See `vector2.ts` for
 * the rationale; every type in the family uses the same value.
 */
const DEFAULT_EPSILON = 1e-6;

/**
 * Mutable axis-aligned rectangle (§7b) — `x`/`y` is one corner, `width` and
 * `height` extend it along the two axes.
 *
 * Which corner `x`/`y` names is deliberately **not** decided here: a rectangle
 * is four numbers, and the space it measures belongs to the API that takes it.
 * §61's `readPixels(target, region)` — the first consumer, and the reason this
 * type exists (RFC 0005's recorded prerequisite) — reads `x`/`y` as the
 * region's **bottom-left** corner in target texels, matching the §7a Y-up
 * bottom-to-top row order its result is defined in; §55's sprite `frame` will
 * document its own atlas convention when it lands. Each consumer states its
 * origin, exactly as `Viewport` documents its own rectangle.
 *
 * Validation posture (§85, per the family): none. Like `Vector2`, this type
 * stores what it is given — negative or fractional extents included — and the
 * API that consumes a rectangle enforces its own §85 constraints (a readback
 * region must be integral and inside the target; a UV frame need not be).
 *
 * Allocation policy (§7b, plan D7): instance methods that produce a
 * "this-shaped" result mutate in place and return `this`; only
 * {@link Rectangle2.clone} allocates. Scalar queries (`containsPoint`,
 * `isEmpty`) and `equalsApprox` never allocate and never mutate.
 *
 * Change notification (plan D3): every mutator invokes
 * {@link Rectangle2.onChanged} after writing. Direct field writes
 * (`r.width = 8`) bypass the hook by design and require an explicit
 * `markDirty()` on the owner.
 */
export class Rectangle2 {
  x: number;
  y: number;
  width: number;
  height: number;

  /**
   * Optional change hook invoked at the end of every mutator. Engine-internal:
   * owners install it, user code normally leaves it unset. It is intentionally
   * *not* copied by {@link Rectangle2.copy} or {@link Rectangle2.clone} — the
   * hook belongs to the owner of the instance, not to the value.
   */
  onChanged?: () => void;

  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    noteConstruction();
  }

  /** Sets all four components. */
  set(x: number, y: number, width: number, height: number): this {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.onChanged?.();
    return this;
  }

  /** Copies the components of `r` into this rectangle. The change hook is not copied. */
  copy(r: Rectangle2): this {
    this.x = r.x;
    this.y = r.y;
    this.width = r.width;
    this.height = r.height;
    this.onChanged?.();
    return this;
  }

  /**
   * Allocates a new rectangle with the same components. The clone has no
   * change hook. This is the only allocating method on the type (§7b).
   */
  clone(): Rectangle2 {
    return new Rectangle2(this.x, this.y, this.width, this.height);
  }

  /**
   * Whether this rectangle covers no area — a non-positive `width` or
   * `height`. Does not mutate.
   */
  isEmpty(): boolean {
    return this.width <= 0 || this.height <= 0;
  }

  /**
   * Whether the point lies inside this rectangle, **half-open on both axes**:
   * the `x`/`y` edge is inside, the `x + width` / `y + height` edge is out.
   * Half-open is what makes adjacent rectangles partition a space with no
   * point in two of them — the texel-region semantics §61's first consumer
   * needs. Does not mutate; an empty rectangle contains nothing.
   */
  containsPoint(x: number, y: number): boolean {
    return (
      x >= this.x &&
      x < this.x + this.width &&
      y >= this.y &&
      y < this.y + this.height
    );
  }

  /**
   * Component-wise approximate equality: true when every component differs by
   * at most `epsilon` (absolute tolerance).
   */
  equalsApprox(r: Rectangle2, epsilon: number = DEFAULT_EPSILON): boolean {
    return (
      Math.abs(this.x - r.x) <= epsilon &&
      Math.abs(this.y - r.y) <= epsilon &&
      Math.abs(this.width - r.width) <= epsilon &&
      Math.abs(this.height - r.height) <= epsilon
    );
  }

  /**
   * Whether this rectangle overlaps `r`. Half-open like
   * {@link Rectangle2.containsPoint}: rectangles that merely share an edge do
   * not intersect, and an empty rectangle intersects nothing. Does not mutate.
   */
  intersects(r: Rectangle2): boolean {
    if (this.isEmpty() || r.isEmpty()) {
      return false;
    }
    return (
      this.x < r.x + r.width &&
      r.x < this.x + this.width &&
      this.y < r.y + r.height &&
      r.y < this.y + this.height
    );
  }

  /**
   * Clips this rectangle to its overlap with `r`, in place. A disjoint pair
   * yields `width` and `height` clamped to `0` (so {@link Rectangle2.isEmpty}
   * is true); `x`/`y` then sit at the clipped corner.
   */
  intersection(r: Rectangle2): this {
    const left = Math.max(this.x, r.x);
    const bottom = Math.max(this.y, r.y);
    const right = Math.min(this.x + this.width, r.x + r.width);
    const top = Math.min(this.y + this.height, r.y + r.height);
    this.x = left;
    this.y = bottom;
    this.width = Math.max(0, right - left);
    this.height = Math.max(0, top - bottom);
    this.onChanged?.();
    return this;
  }

  /**
   * Grows this rectangle to the bounding box of itself and `r`, in place.
   * Empty operands are ignored: an empty `r` leaves this unchanged, and an
   * empty this becomes a copy of `r` (an empty rectangle has no extent to keep).
   */
  union(r: Rectangle2): this {
    if (r.isEmpty()) {
      this.onChanged?.();
      return this;
    }
    if (this.isEmpty()) {
      this.x = r.x;
      this.y = r.y;
      this.width = r.width;
      this.height = r.height;
      this.onChanged?.();
      return this;
    }
    const left = Math.min(this.x, r.x);
    const bottom = Math.min(this.y, r.y);
    const right = Math.max(this.x + this.width, r.x + r.width);
    const top = Math.max(this.y + this.height, r.y + r.height);
    this.x = left;
    this.y = bottom;
    this.width = right - left;
    this.height = top - bottom;
    this.onChanged?.();
    return this;
  }

  /**
   * Grows this rectangle just enough to cover the point `(x, y)`, in place.
   * Treated as a closed bound: the point lies on the far edge afterwards, so
   * the half-open {@link Rectangle2.containsPoint} still excludes it; callers
   * accumulating texel regions add one texel themselves. An empty rectangle
   * becomes the zero-extent rectangle at the point.
   */
  expandByPoint(x: number, y: number): this {
    if (this.isEmpty()) {
      this.x = x;
      this.y = y;
      this.width = 0;
      this.height = 0;
    } else {
      const right = Math.max(this.x + this.width, x);
      const top = Math.max(this.y + this.height, y);
      this.x = Math.min(this.x, x);
      this.y = Math.min(this.y, y);
      this.width = right - this.x;
      this.height = top - this.y;
    }
    this.onChanged?.();
    return this;
  }
}
