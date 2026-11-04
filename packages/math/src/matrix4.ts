import { noteConstruction } from "./alloc-counter.js";
import { setQuaternionFromBasis, type Quaternion } from "./quaternion.js";
import type { Vector3 } from "./vector3.js";

/**
 * Default tolerance for {@link Matrix4.equalsApprox}. See `vector2.ts` for the
 * rationale; every type in the family uses the same value.
 */
const DEFAULT_EPSILON = 1e-6;

/**
 * Clip-space depth convention of a projection matrix (plan D8).
 *
 * - `"negative-one-to-one"` — OpenGL/WebGL 2 clip space, where the near plane
 *   maps to `z = -1` and the far plane to `z = +1`.
 * - `"zero-to-one"` — WebGPU (and Direct3D/Vulkan) clip space, where the near
 *   plane maps to `z = 0` and the far plane to `z = +1`.
 *
 * §7a requires that backend NDC differences be absorbed by the projection
 * matrix and never leak into user code, so this is the only place in the math
 * package where a rendering backend is visible at all. The default is
 * `"negative-one-to-one"` because the MVP renders with WebGL 2 (§120); the
 * WebGPU backend passes `"zero-to-one"` explicitly.
 */
export type DepthRange = "negative-one-to-one" | "zero-to-one";

/**
 * Mutable 4×4 matrix stored **column-major** in a `Float64Array(16)` (§7b) —
 * the transform type of the scene graph (§7) and of camera projections (§47).
 *
 * Element layout — `elements[column * 4 + row]`, the order GPU APIs and
 * `WebGL2RenderingContext.uniformMatrix4fv` expect; for an affine transform the
 * translation therefore lives in `e[12..14]`:
 *
 * ```text
 * | e[0] e[4] e[ 8] e[12] |
 * | e[1] e[5] e[ 9] e[13] |
 * | e[2] e[6] e[10] e[14] |
 * | e[3] e[7] e[11] e[15] |
 * ```
 *
 * `Float64Array` (not `Float32Array`) is deliberate: the scene graph does its
 * arithmetic in double precision and narrows to float only at the backend
 * boundary (§62), so accumulated transform error stays below anything the
 * determinism tiers (§33) care about.
 *
 * Allocation policy (§7b, plan D7): every method mutates in place and returns
 * `this`; only {@link Matrix4.clone} allocates. {@link Matrix4.decompose}
 * produces three results that are not `this`, so it takes three **required**
 * out objects and allocates nothing either.
 *
 * Change notification (plan D3): every mutator invokes {@link Matrix4.onChanged}
 * exactly once, after the last element is written. Writing `elements` directly
 * bypasses the hook by design — the same rule as `v.x = 1` on the vector types.
 */
export class Matrix4 {
  /**
   * The sixteen elements in column-major order. The array itself is never
   * replaced, so views taken by a renderer stay valid for the matrix's
   * lifetime; only its contents change.
   */
  readonly elements: Float64Array;

  /**
   * Optional change hook invoked at the end of every mutator that actually
   * writes elements. Engine-internal: owners install it, user code normally
   * leaves it unset. It is intentionally *not* copied by {@link Matrix4.copy}
   * or {@link Matrix4.clone}.
   */
  onChanged?: () => void;

  /** Constructs the identity matrix. */
  constructor() {
    const e = new Float64Array(16);
    e[0] = 1;
    e[5] = 1;
    e[10] = 1;
    e[15] = 1;
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
    e[4] = 0;
    e[5] = 1;
    e[6] = 0;
    e[7] = 0;
    e[8] = 0;
    e[9] = 0;
    e[10] = 1;
    e[11] = 0;
    e[12] = 0;
    e[13] = 0;
    e[14] = 0;
    e[15] = 1;
    this.onChanged?.();
    return this;
  }

  /** Copies the elements of `m` into this matrix. The change hook is not copied. */
  copy(m: Matrix4): this {
    this.elements.set(m.elements);
    this.onChanged?.();
    return this;
  }

  /**
   * Reads sixteen **column-major** elements starting at `offset`. This is the
   * inverse of reading {@link Matrix4.elements} and the entry point used by
   * serialization (§79), by `matrixAutoUpdate = false` authoring (§7), and by
   * tests that build matrices from raw numbers.
   */
  fromArray(values: ArrayLike<number>, offset = 0): this {
    const e = this.elements;
    for (let i = 0; i < 16; i += 1) {
      e[i] = values[offset + i];
    }
    this.onChanged?.();
    return this;
  }

  /**
   * Allocates a new matrix with the same elements. The clone has no change
   * hook. This is the only allocating method on the type (§7b).
   */
  clone(): Matrix4 {
    return new Matrix4().copy(this);
  }

  /**
   * Matrix product `this = this * m` — this matrix is the left operand, so the
   * combined transform applies `m` first and this matrix second (the same
   * ordering as `Quaternion.multiply`, and the ordering the §7 composition
   * formula is written in). Aliasing-safe: `m` may be `this`.
   */
  multiply(m: Matrix4): this {
    const a = this.elements;
    const b = m.elements;

    const a11 = a[0];
    const a21 = a[1];
    const a31 = a[2];
    const a41 = a[3];
    const a12 = a[4];
    const a22 = a[5];
    const a32 = a[6];
    const a42 = a[7];
    const a13 = a[8];
    const a23 = a[9];
    const a33 = a[10];
    const a43 = a[11];
    const a14 = a[12];
    const a24 = a[13];
    const a34 = a[14];
    const a44 = a[15];

    const b11 = b[0];
    const b21 = b[1];
    const b31 = b[2];
    const b41 = b[3];
    const b12 = b[4];
    const b22 = b[5];
    const b32 = b[6];
    const b42 = b[7];
    const b13 = b[8];
    const b23 = b[9];
    const b33 = b[10];
    const b43 = b[11];
    const b14 = b[12];
    const b24 = b[13];
    const b34 = b[14];
    const b44 = b[15];

    a[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
    a[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
    a[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
    a[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;

    a[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
    a[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
    a[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
    a[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;

    a[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
    a[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
    a[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
    a[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;

    a[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
    a[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
    a[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
    a[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;

    this.onChanged?.();
    return this;
  }

  /** Determinant of this matrix. Does not mutate and does not allocate. */
  determinant(): number {
    const e = this.elements;
    const n11 = e[0];
    const n21 = e[1];
    const n31 = e[2];
    const n41 = e[3];
    const n12 = e[4];
    const n22 = e[5];
    const n32 = e[6];
    const n42 = e[7];
    const n13 = e[8];
    const n23 = e[9];
    const n33 = e[10];
    const n43 = e[11];
    const n14 = e[12];
    const n24 = e[13];
    const n34 = e[14];
    const n44 = e[15];

    // Cofactors of the first column, expanded once and reused: the same four
    // terms that open `invert()`.
    const t11 =
      n23 * n34 * n42 -
      n24 * n33 * n42 +
      n24 * n32 * n43 -
      n22 * n34 * n43 -
      n23 * n32 * n44 +
      n22 * n33 * n44;
    const t12 =
      n14 * n33 * n42 -
      n13 * n34 * n42 -
      n14 * n32 * n43 +
      n12 * n34 * n43 +
      n13 * n32 * n44 -
      n12 * n33 * n44;
    const t13 =
      n13 * n24 * n42 -
      n14 * n23 * n42 +
      n14 * n22 * n43 -
      n12 * n24 * n43 -
      n13 * n22 * n44 +
      n12 * n23 * n44;
    const t14 =
      n14 * n23 * n32 -
      n13 * n24 * n32 -
      n14 * n22 * n33 +
      n12 * n24 * n33 +
      n13 * n22 * n34 -
      n12 * n23 * n34;

    return n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
  }

  /**
   * Inverts this matrix in place (general inverse via the adjugate — no
   * assumption that the matrix is affine, orthogonal, or uniformly scaled, so
   * it also inverts projection matrices, §47's `inverseProjectionMatrix`).
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
    const n41 = e[3];
    const n12 = e[4];
    const n22 = e[5];
    const n32 = e[6];
    const n42 = e[7];
    const n13 = e[8];
    const n23 = e[9];
    const n33 = e[10];
    const n43 = e[11];
    const n14 = e[12];
    const n24 = e[13];
    const n34 = e[14];
    const n44 = e[15];

    const t11 =
      n23 * n34 * n42 -
      n24 * n33 * n42 +
      n24 * n32 * n43 -
      n22 * n34 * n43 -
      n23 * n32 * n44 +
      n22 * n33 * n44;
    const t12 =
      n14 * n33 * n42 -
      n13 * n34 * n42 -
      n14 * n32 * n43 +
      n12 * n34 * n43 +
      n13 * n32 * n44 -
      n12 * n33 * n44;
    const t13 =
      n13 * n24 * n42 -
      n14 * n23 * n42 +
      n14 * n22 * n43 -
      n12 * n24 * n43 -
      n13 * n22 * n44 +
      n12 * n23 * n44;
    const t14 =
      n14 * n23 * n32 -
      n13 * n24 * n32 -
      n14 * n22 * n33 +
      n12 * n24 * n33 +
      n13 * n22 * n34 -
      n12 * n23 * n34;

    const determinant = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
    if (determinant === 0) {
      return this;
    }
    const inverseDeterminant = 1 / determinant;

    e[0] = t11 * inverseDeterminant;
    e[1] =
      (n24 * n33 * n41 -
        n23 * n34 * n41 -
        n24 * n31 * n43 +
        n21 * n34 * n43 +
        n23 * n31 * n44 -
        n21 * n33 * n44) *
      inverseDeterminant;
    e[2] =
      (n22 * n34 * n41 -
        n24 * n32 * n41 +
        n24 * n31 * n42 -
        n21 * n34 * n42 -
        n22 * n31 * n44 +
        n21 * n32 * n44) *
      inverseDeterminant;
    e[3] =
      (n23 * n32 * n41 -
        n22 * n33 * n41 -
        n23 * n31 * n42 +
        n21 * n33 * n42 +
        n22 * n31 * n43 -
        n21 * n32 * n43) *
      inverseDeterminant;

    e[4] = t12 * inverseDeterminant;
    e[5] =
      (n13 * n34 * n41 -
        n14 * n33 * n41 +
        n14 * n31 * n43 -
        n11 * n34 * n43 -
        n13 * n31 * n44 +
        n11 * n33 * n44) *
      inverseDeterminant;
    e[6] =
      (n14 * n32 * n41 -
        n12 * n34 * n41 -
        n14 * n31 * n42 +
        n11 * n34 * n42 +
        n12 * n31 * n44 -
        n11 * n32 * n44) *
      inverseDeterminant;
    e[7] =
      (n12 * n33 * n41 -
        n13 * n32 * n41 +
        n13 * n31 * n42 -
        n11 * n33 * n42 -
        n12 * n31 * n43 +
        n11 * n32 * n43) *
      inverseDeterminant;

    e[8] = t13 * inverseDeterminant;
    e[9] =
      (n14 * n23 * n41 -
        n13 * n24 * n41 -
        n14 * n21 * n43 +
        n11 * n24 * n43 +
        n13 * n21 * n44 -
        n11 * n23 * n44) *
      inverseDeterminant;
    e[10] =
      (n12 * n24 * n41 -
        n14 * n22 * n41 +
        n14 * n21 * n42 -
        n11 * n24 * n42 -
        n12 * n21 * n44 +
        n11 * n22 * n44) *
      inverseDeterminant;
    e[11] =
      (n13 * n22 * n41 -
        n12 * n23 * n41 -
        n13 * n21 * n42 +
        n11 * n23 * n42 +
        n12 * n21 * n43 -
        n11 * n22 * n43) *
      inverseDeterminant;

    e[12] = t14 * inverseDeterminant;
    e[13] =
      (n13 * n24 * n31 -
        n14 * n23 * n31 +
        n14 * n21 * n33 -
        n11 * n24 * n33 -
        n13 * n21 * n34 +
        n11 * n23 * n34) *
      inverseDeterminant;
    e[14] =
      (n14 * n22 * n31 -
        n12 * n24 * n31 -
        n14 * n21 * n32 +
        n11 * n24 * n32 +
        n12 * n21 * n34 -
        n11 * n22 * n34) *
      inverseDeterminant;
    e[15] =
      (n12 * n23 * n31 -
        n13 * n22 * n31 +
        n13 * n21 * n32 -
        n11 * n23 * n32 -
        n12 * n21 * n33 +
        n11 * n22 * n33) *
      inverseDeterminant;

    this.onChanged?.();
    return this;
  }

  /**
   * Sets this matrix to the §7 local transform `T · Tp · R · S · Tp⁻¹`:
   * translate by `position`, then rotate and scale **about `pivot`**. The pivot
   * therefore affects rotation and scale but not `position` — a node at
   * `position` with any pivot still has its pivot point at `position`.
   *
   * Expanding the product, the upper-left 3×3 block is exactly `R · S` (the
   * rotation columns scaled by `scale.x/y/z`) and the translation column is
   *
   * ```text
   * position + (I − R · S) · pivot
   * ```
   *
   * which is how the formula is evaluated here — one pass over raw scalars, no
   * intermediate matrices and no allocation. `rotation` is assumed unit length
   * (§7b); a non-unit quaternion scales the result by its squared length.
   *
   * All four inputs are required: `pivot` has no default because §7 makes it a
   * first-class field of `Transform`, and an implicit zero would quietly hide a
   * caller that forgot to pass it. Pass a zero vector for "no pivot".
   */
  compose(
    position: Vector3,
    rotation: Quaternion,
    scale: Vector3,
    pivot: Vector3,
  ): this {
    const { x, y, z, w } = rotation;
    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;
    const xx = x * x2;
    const xy = x * y2;
    const xz = x * z2;
    const yy = y * y2;
    const yz = y * z2;
    const zz = z * z2;
    const wx = w * x2;
    const wy = w * y2;
    const wz = w * z2;

    const sx = scale.x;
    const sy = scale.y;
    const sz = scale.z;

    // Columns of R · S: column j is rotation column j scaled by scale[j].
    const m11 = (1 - (yy + zz)) * sx;
    const m21 = (xy + wz) * sx;
    const m31 = (xz - wy) * sx;
    const m12 = (xy - wz) * sy;
    const m22 = (1 - (xx + zz)) * sy;
    const m32 = (yz + wx) * sy;
    const m13 = (xz + wy) * sz;
    const m23 = (yz - wx) * sz;
    const m33 = (1 - (xx + yy)) * sz;

    const px = pivot.x;
    const py = pivot.y;
    const pz = pivot.z;

    const e = this.elements;
    e[0] = m11;
    e[1] = m21;
    e[2] = m31;
    e[3] = 0;
    e[4] = m12;
    e[5] = m22;
    e[6] = m32;
    e[7] = 0;
    e[8] = m13;
    e[9] = m23;
    e[10] = m33;
    e[11] = 0;
    e[12] = position.x + px - (m11 * px + m12 * py + m13 * pz);
    e[13] = position.y + py - (m21 * px + m22 * py + m23 * pz);
    e[14] = position.z + pz - (m31 * px + m32 * py + m33 * pz);
    e[15] = 1;

    this.onChanged?.();
    return this;
  }

  /**
   * Splits this matrix into translation, rotation, and scale, writing each into
   * the corresponding **required** out object (plan D7) and returning `this`.
   * This matrix is not modified and its own change hook does not fire; each out
   * object is written through a single `set(...)`, so each of their hooks fires
   * exactly once.
   *
   * Two documented limitations, both inherent rather than implementation
   * shortcuts:
   *
   * - **Pivot is not recovered.** `compose` folds the pivot into the
   *   translation column, and infinitely many `(position, pivot)` pairs produce
   *   the same matrix. `outPosition` therefore receives the *composed*
   *   translation `position + (I − R · S) · pivot`, which equals `position`
   *   exactly when the pivot is zero. Round-tripping a transform means keeping
   *   the pivot alongside the matrix (§7 keeps it on `Transform`).
   * - **Scale is assumed positive.** Column lengths are magnitudes, so a
   *   negative (mirroring) scale reads back as positive with the mirror folded
   *   into the returned rotation — which is then not the rotation that was
   *   composed. Mirrored transforms cannot be decomposed unambiguously by any
   *   method; keep the authored values if you need them back.
   *
   * A zero scale component collapses a column, leaving no direction to recover:
   * `outRotation` is set to the identity rather than `NaN` (defined here — the
   * same "no-op beats poisoning the frame" reasoning as `Quaternion.normalize`).
   * Shear (a non-orthogonal upper-left block) is not detected; the returned
   * rotation is then the closest thing the column-normalization produces.
   */
  decompose(
    outPosition: Vector3,
    outRotation: Quaternion,
    outScale: Vector3,
  ): this {
    const e = this.elements;

    const sx = Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]);
    const sy = Math.sqrt(e[4] * e[4] + e[5] * e[5] + e[6] * e[6]);
    const sz = Math.sqrt(e[8] * e[8] + e[9] * e[9] + e[10] * e[10]);

    outPosition.set(e[12], e[13], e[14]);
    outScale.set(sx, sy, sz);

    if (sx === 0 || sy === 0 || sz === 0) {
      outRotation.set(0, 0, 0, 1);
      return this;
    }

    const inverseSx = 1 / sx;
    const inverseSy = 1 / sy;
    const inverseSz = 1 / sz;

    const m11 = e[0] * inverseSx;
    const m21 = e[1] * inverseSx;
    const m31 = e[2] * inverseSx;
    const m12 = e[4] * inverseSy;
    const m22 = e[5] * inverseSy;
    const m32 = e[6] * inverseSy;
    const m13 = e[8] * inverseSz;
    const m23 = e[9] * inverseSz;
    const m33 = e[10] * inverseSz;

    // Shepperd's method, shared with `Quaternion.setFromLookDirection` — see
    // `setQuaternionFromBasis`, which owns the branch selection and the
    // arithmetic this method used to carry inline.
    setQuaternionFromBasis(
      outRotation,
      m11,
      m21,
      m31,
      m12,
      m22,
      m32,
      m13,
      m23,
      m33,
    );

    return this;
  }

  /**
   * Sets this matrix to a right-handed perspective projection (plan D8, §47).
   *
   * The camera looks down its own **−Z** axis with +Y up (§7a), so `near` and
   * `far` are positive *distances* in front of the camera, not Z coordinates:
   * `0 < near < far`. `fovYRadians` is the full vertical field of view in
   * radians (§7a — there is no degree overload) and `aspect` is width ÷ height.
   *
   * The name says `set` because this **overwrites every element** rather than
   * post-multiplying — the same reason `identity()` is a mutator, and the
   * reason it is not called `perspective()`.
   *
   * `depthRange` selects the backend's clip-space depth convention and defaults
   * to `"negative-one-to-one"` (WebGL 2, §120); WebGPU passes `"zero-to-one"`.
   * Nothing above this method ever sees the difference (§7a).
   *
   * Degenerate arguments (`near === far`, `aspect === 0`, a field of view at or
   * beyond π) produce non-finite or meaningless elements rather than throwing:
   * the math package validates nothing, and camera types (§47) are the layer
   * that reports configuration errors.
   */
  setPerspective(
    fovYRadians: number,
    aspect: number,
    near: number,
    far: number,
    depthRange: DepthRange = "negative-one-to-one",
  ): this {
    const focalLength = 1 / Math.tan(fovYRadians * 0.5);
    const nearMinusFar = near - far;

    const e = this.elements;
    e[0] = focalLength / aspect;
    e[1] = 0;
    e[2] = 0;
    e[3] = 0;
    e[4] = 0;
    e[5] = focalLength;
    e[6] = 0;
    e[7] = 0;
    e[8] = 0;
    e[9] = 0;
    e[11] = -1;
    e[12] = 0;
    e[13] = 0;
    e[15] = 0;

    if (depthRange === "zero-to-one") {
      e[10] = far / nearMinusFar;
      e[14] = (far * near) / nearMinusFar;
    } else {
      e[10] = (far + near) / nearMinusFar;
      e[14] = (2 * far * near) / nearMinusFar;
    }

    this.onChanged?.();
    return this;
  }

  /**
   * Sets this matrix to a right-handed orthographic projection (plan D8, §47).
   *
   * `left/right/bottom/top` bound the view volume in camera space with +Y up
   * (§7a); the camera looks down its own **−Z** axis, so `near` and `far` are
   * positive *distances* in front of the camera, not Z coordinates.
   *
   * The name says `set` because this **overwrites every element** rather than
   * post-multiplying — see {@link Matrix4.setPerspective}.
   *
   * `depthRange` selects the backend's clip-space depth convention and defaults
   * to `"negative-one-to-one"` (WebGL 2, §120); WebGPU passes `"zero-to-one"`.
   *
   * A degenerate box (`right === left`, `top === bottom`, `far === near`)
   * produces non-finite elements rather than throwing — see
   * {@link Matrix4.setPerspective}.
   */
  setOrthographic(
    left: number,
    right: number,
    bottom: number,
    top: number,
    near: number,
    far: number,
    depthRange: DepthRange = "negative-one-to-one",
  ): this {
    const width = right - left;
    const height = top - bottom;
    const depth = far - near;

    const e = this.elements;
    e[0] = 2 / width;
    e[1] = 0;
    e[2] = 0;
    e[3] = 0;
    e[4] = 0;
    e[5] = 2 / height;
    e[6] = 0;
    e[7] = 0;
    e[8] = 0;
    e[9] = 0;
    e[11] = 0;
    e[12] = -(right + left) / width;
    e[13] = -(top + bottom) / height;
    e[15] = 1;

    if (depthRange === "zero-to-one") {
      e[10] = -1 / depth;
      e[14] = -near / depth;
    } else {
      e[10] = -2 / depth;
      e[14] = -(far + near) / depth;
    }

    this.onChanged?.();
    return this;
  }

  /**
   * Transposes this matrix in place: the diagonal stays, the six off-diagonal
   * pairs swap. Fires the change hook once, after the last write.
   */
  transpose(): this {
    const e = this.elements;
    const m01 = e[4];
    const m02 = e[8];
    const m03 = e[12];
    const m12 = e[9];
    const m13 = e[13];
    const m23 = e[14];
    e[4] = e[1];
    e[8] = e[2];
    e[12] = e[3];
    e[9] = e[6];
    e[13] = e[7];
    e[14] = e[11];
    e[1] = m01;
    e[2] = m02;
    e[3] = m03;
    e[6] = m12;
    e[7] = m13;
    e[11] = m23;
    this.onChanged?.();
    return this;
  }

  /** Element-wise approximate equality over all sixteen elements (absolute `epsilon`). */
  equalsApprox(m: Matrix4, epsilon: number = DEFAULT_EPSILON): boolean {
    const a = this.elements;
    const b = m.elements;
    for (let i = 0; i < 16; i++) {
      if (!(Math.abs(a[i] - b[i]) <= epsilon)) {
        return false;
      }
    }
    return true;
  }
}
