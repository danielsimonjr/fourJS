import { noteConstruction } from "./alloc-counter.js";
import type { Matrix4 } from "./matrix4.js";

/**
 * Default tolerance for {@link Matrix3.equalsApprox}. See `vector2.ts` for the
 * rationale; every type in the family uses the same value.
 */
const DEFAULT_EPSILON = 1e-6;

/**
 * Mutable 3×3 matrix stored **column-major** in a `Float64Array(9)` (§7b).
 *
 * Element layout — `elements[column * 3 + row]`, the same order GPU APIs and
 * `WebGL2RenderingContext.uniformMatrix3fv` expect:
 *
 * ```text
 * | e[0] e[3] e[6] |
 * | e[1] e[4] e[7] |
 * | e[2] e[5] e[8] |
 * ```
 *
 * `Float64Array` (not `Float32Array`) is deliberate: the scene graph does its
 * arithmetic in double precision and narrows to float only at the backend
 * boundary (§62), so accumulated transform error stays below anything the
 * determinism tiers (§33) care about.
 *
 * Allocation policy (§7b, plan D7): every method mutates in place and returns
 * `this`; only {@link Matrix3.clone} allocates. Scalar queries
 * ({@link Matrix3.determinant}) never allocate and never mutate.
 *
 * Change notification (plan D3): every mutator invokes {@link Matrix3.onChanged}
 * exactly once, after the last element is written. Writing `elements` directly
 * bypasses the hook by design — the same rule as `v.x = 1` on the vector types.
 */
export class Matrix3 {
  /**
   * The nine elements in column-major order. The array itself is never
   * replaced, so views taken by a renderer stay valid for the matrix's
   * lifetime; only its contents change.
   */
  readonly elements: Float64Array;

  /**
   * Optional change hook invoked at the end of every mutator that actually
   * writes elements. Engine-internal: owners install it, user code normally
   * leaves it unset. It is intentionally *not* copied by {@link Matrix3.copy}
   * or {@link Matrix3.clone}.
   */
  onChanged?: () => void;

  /** Constructs the identity matrix. */
  constructor() {
    const e = new Float64Array(9);
    e[0] = 1;
    e[4] = 1;
    e[8] = 1;
    this.elements = e;
    noteConstruction();
  }

  /** Resets this matrix to the identity. */
  identity(): this {
    const e = this.elements;
    e[0] = 1;
    e[1] = 0;
    e[2] = 0;
    e[3] = 0;
    e[4] = 1;
    e[5] = 0;
    e[6] = 0;
    e[7] = 0;
    e[8] = 1;
    this.onChanged?.();
    return this;
  }

  /** Copies the elements of `m` into this matrix. The change hook is not copied. */
  copy(m: Matrix3): this {
    this.elements.set(m.elements);
    this.onChanged?.();
    return this;
  }

  /**
   * Reads nine **column-major** elements starting at `offset`. This is the
   * inverse of reading {@link Matrix3.elements} and the entry point used by
   * serialization (§79) and by tests that build matrices from raw numbers.
   */
  fromArray(values: ArrayLike<number>, offset = 0): this {
    const e = this.elements;
    for (let i = 0; i < 9; i += 1) {
      e[i] = values[offset + i];
    }
    this.onChanged?.();
    return this;
  }

  /**
   * Allocates a new matrix with the same elements. The clone has no change
   * hook. This is the only allocating method on the type (§7b).
   */
  clone(): Matrix3 {
    return new Matrix3().copy(this);
  }

  /**
   * Matrix product `this = this * m` — this matrix is the left operand, so the
   * combined transform applies `m` first and this matrix second (the same
   * ordering as `Quaternion.multiply`). Aliasing-safe: `m` may be `this`.
   */
  multiply(m: Matrix3): this {
    const a = this.elements;
    const b = m.elements;

    const a11 = a[0];
    const a21 = a[1];
    const a31 = a[2];
    const a12 = a[3];
    const a22 = a[4];
    const a32 = a[5];
    const a13 = a[6];
    const a23 = a[7];
    const a33 = a[8];

    const b11 = b[0];
    const b21 = b[1];
    const b31 = b[2];
    const b12 = b[3];
    const b22 = b[4];
    const b32 = b[5];
    const b13 = b[6];
    const b23 = b[7];
    const b33 = b[8];

    a[0] = a11 * b11 + a12 * b21 + a13 * b31;
    a[1] = a21 * b11 + a22 * b21 + a23 * b31;
    a[2] = a31 * b11 + a32 * b21 + a33 * b31;

    a[3] = a11 * b12 + a12 * b22 + a13 * b32;
    a[4] = a21 * b12 + a22 * b22 + a23 * b32;
    a[5] = a31 * b12 + a32 * b22 + a33 * b32;

    a[6] = a11 * b13 + a12 * b23 + a13 * b33;
    a[7] = a21 * b13 + a22 * b23 + a23 * b33;
    a[8] = a31 * b13 + a32 * b23 + a33 * b33;

    this.onChanged?.();
    return this;
  }

  /** Determinant of this matrix. Does not mutate and does not allocate. */
  determinant(): number {
    const e = this.elements;
    const n11 = e[0];
    const n21 = e[1];
    const n31 = e[2];
    const n12 = e[3];
    const n22 = e[4];
    const n32 = e[5];
    const n13 = e[6];
    const n23 = e[7];
    const n33 = e[8];
    return (
      n11 * (n22 * n33 - n23 * n32) -
      n12 * (n21 * n33 - n23 * n31) +
      n13 * (n21 * n32 - n22 * n31)
    );
  }

  /**
   * Inverts this matrix in place (general inverse via the adjugate — no
   * assumption of orthogonality or affinity).
   *
   * Singular behaviour (defined here, plan §1 rule 12): a matrix whose
   * determinant is exactly `0` has no inverse, so this method **leaves the
   * elements unchanged, returns `this`, and does not fire the change hook** —
   * the hook reports a change, and nothing changed. Callers that must
   * distinguish "inverted" from "left alone" check `m.determinant() !== 0`
   * first. Resetting to the identity was rejected: it silently substitutes a
   * different, plausible-looking transform for the failure, which is the
   * hardest kind of bug to trace. Throwing was rejected because inversion sits
   * on per-frame paths (§43, §47) where an exception would take down the frame.
   *
   * A *nearly* singular matrix still inverts, producing large elements; this
   * method deliberately applies no epsilon, since the right threshold depends
   * on the caller's units (§40).
   */
  invert(): this {
    const e = this.elements;
    const n11 = e[0];
    const n21 = e[1];
    const n31 = e[2];
    const n12 = e[3];
    const n22 = e[4];
    const n32 = e[5];
    const n13 = e[6];
    const n23 = e[7];
    const n33 = e[8];

    const t11 = n33 * n22 - n32 * n23;
    const t12 = n32 * n13 - n33 * n12;
    const t13 = n23 * n12 - n22 * n13;

    const determinant = n11 * t11 + n21 * t12 + n31 * t13;
    if (determinant === 0) {
      return this;
    }
    const inverseDeterminant = 1 / determinant;

    e[0] = t11 * inverseDeterminant;
    e[1] = (n31 * n23 - n33 * n21) * inverseDeterminant;
    e[2] = (n32 * n21 - n31 * n22) * inverseDeterminant;

    e[3] = t12 * inverseDeterminant;
    e[4] = (n33 * n11 - n31 * n13) * inverseDeterminant;
    e[5] = (n31 * n12 - n32 * n11) * inverseDeterminant;

    e[6] = t13 * inverseDeterminant;
    e[7] = (n21 * n13 - n23 * n11) * inverseDeterminant;
    e[8] = (n22 * n11 - n21 * n12) * inverseDeterminant;

    this.onChanged?.();
    return this;
  }

  /**
   * Transposes this matrix in place. Diagonal elements stay put; the three
   * off-diagonal pairs swap. Fires the change hook once, after the last write.
   */
  transpose(): this {
    const e = this.elements;
    const m01 = e[3];
    const m02 = e[6];
    const m12 = e[7];
    e[3] = e[1];
    e[6] = e[2];
    e[7] = e[5];
    e[1] = m01;
    e[2] = m02;
    e[5] = m12;
    this.onChanged?.();
    return this;
  }

  /**
   * Copies the upper-left 3×3 of a column-major {@link Matrix4} into this
   * matrix. Translation (`e[12..14]`) and the homogeneous row are ignored —
   * the linear part that transforms directions, which is what a normal matrix
   * starts from.
   *
   * Always writes and always fires the change hook: even a copy of the
   * identity is a write.
   */
  setFromMatrix4Upper3x3(m: Matrix4): this {
    const s = m.elements;
    const e = this.elements;
    e[0] = s[0];
    e[1] = s[1];
    e[2] = s[2];
    e[3] = s[4];
    e[4] = s[5];
    e[5] = s[6];
    e[6] = s[8];
    e[7] = s[9];
    e[8] = s[10];
    this.onChanged?.();
    return this;
  }

  /**
   * Builds the **normal matrix** of `m`: `transpose(inverse(upper 3×3))`, the
   * linear map that keeps object-space normals perpendicular to surfaces after
   * a non-uniform scale (§68). Translation does not participate.
   *
   * The inverse is {@link Matrix3.invert}'s general inverse, so a singular
   * upper 3×3 (determinant exactly `0`) is the same no-op: this matrix is
   * left unchanged, the change hook does not fire, and the method returns
   * `this`. Callers that must distinguish "built" from "left alone" check
   * the upper 3×3's determinant first — the same rule invert documents.
   *
   * The change hook fires **once**, after the last write, never per
   * intermediate copy / invert / transpose. That is plan D3: one mutation,
   * one notification.
   */
  setNormalFromMatrix4(m: Matrix4): this {
    const src = m.elements;
    const n11 = src[0];
    const n21 = src[1];
    const n31 = src[2];
    const n12 = src[4];
    const n22 = src[5];
    const n32 = src[6];
    const n13 = src[8];
    const n23 = src[9];
    const n33 = src[10];

    // Same determinant probe {@link Matrix3.invert} uses, so a singular
    // upper 3×3 no-ops without touching this matrix or firing the hook.
    const t11 = n33 * n22 - n32 * n23;
    const t12 = n32 * n13 - n33 * n12;
    const t13 = n23 * n12 - n22 * n13;
    const determinant = n11 * t11 + n21 * t12 + n31 * t13;
    if (determinant === 0) {
      return this;
    }

    const hook = this.onChanged;
    this.onChanged = undefined;
    const e = this.elements;
    e[0] = n11;
    e[1] = n21;
    e[2] = n31;
    e[3] = n12;
    e[4] = n22;
    e[5] = n32;
    e[6] = n13;
    e[7] = n23;
    e[8] = n33;
    this.invert();
    this.transpose();
    this.onChanged = hook;
    this.onChanged?.();
    return this;
  }

  /** Element-wise approximate equality over all nine elements (absolute `epsilon`). */
  equalsApprox(m: Matrix3, epsilon: number = DEFAULT_EPSILON): boolean {
    const a = this.elements;
    const b = m.elements;
    for (let i = 0; i < 9; i++) {
      if (!(Math.abs(a[i] - b[i]) <= epsilon)) {
        return false;
      }
    }
    return true;
  }
}
