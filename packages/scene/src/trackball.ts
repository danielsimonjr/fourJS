/**
 * §44/§47's **trackball** rig (R-37, 2026-08-21) — the last of the seven camera
 * rigs that had a design reason to be somewhere other than `@fourjs/motion`.
 *
 * ```ts
 * const trackball = new TrackballRig({ width: 960, height: 540, distance: 6 });
 * // …from wherever your pointer events live, in viewport pixels:
 * trackball.drag(previous.x, previous.y, current.x, current.y);
 * trackball.applyTo(camera);
 * ```
 *
 * ## Why it lives here and not with the other rigs
 *
 * `camera-rigs.ts` staged it with a one-line reason: "defined in **screen
 * space**, and `@fourjs/motion` may not import `render` or `input` (§3.1); it
 * belongs with the §47 `ScreenCamera` packet." That is exactly right, and this
 * is that packet. A trackball is not parameterised by angles the way an orbit
 * rig is — its whole definition is *a mapping from two points on a viewport to
 * a rotation* — so the package that owns §48's `Viewport` and §47's
 * {@link ScreenCamera} is the one that can state it. `@fourjs/scene` is also the
 * lowest package that can: it needs a rectangle and a quaternion, nothing else.
 *
 * ## It is a rig, not a component (decision, R-37)
 *
 * `OrbitRig` and `FollowRig` are components that `ConstraintSystem` calls once
 * per fixed step, under §42's `"constraint"` authority. A trackball is not that
 * shape, for two independent reasons:
 *
 * - **It is event-driven, not per-step.** Its state advances when a drag
 *   arrives and at no other time; a per-step `apply` would spend every fixed
 *   step re-writing a transform that had not changed. `OrbitRig` accumulates
 *   angles and *is* re-evaluated per step because its target may move; a
 *   trackball's pivot is a point the caller owns.
 * - **`ConstraintSystem` is in `@fourjs/motion` and names its three component
 *   classes literally.** A component here could not be driven by it without
 *   `motion` importing `scene`'s rig — which the staging note exists to
 *   prevent. Inventing a second constraint system to drive one rig would be
 *   worse than admitting the shape is different.
 *
 * So {@link TrackballRig.applyTo} is called by the application, from the same
 * place the pointer event was handled, and the node it writes is under §42's
 * default `"manual"` authority — the application *is* the writer. A node owned
 * by another system is refused through `warnAuthorityConflict`, once, exactly
 * as a system's own write would be: §42 does not exempt application code.
 *
 * ## The mapping (the classic virtual sphere)
 *
 * A screen point becomes a point on a unit sphere centred on the viewport, and
 * the rotation of a drag is the rotation that takes the first sphere point to
 * the second. Inside the sphere's silhouette the height is
 * `sqrt(1 - d²)` out to its 45° parallel; beyond that the sphere is continued by
 * the hyperbolic sheet `1 / (2d)`, and the result is normalized. The two meet
 * tangentially at `d = 1/√2` — same height, same slope — which is what stops
 * the rotation from dying at the rim and lets a drag past the edge keep
 * spinning (Shoemake's arcball with Bell's sheet: the mapping every trackball
 * in the wild uses, because the naive "clamp to the rim" version has a
 * discontinuous derivative exactly where users drag fastest).
 *
 * The composition is `rotation = delta · rotation`: the drag's rotation is
 * applied in **world** space, on the outside, so a second drag turns the object
 * about screen axes rather than about the axes the first drag left behind. That
 * is the property that distinguishes a trackball from an orbit rig, and it is
 * why a trackball can reach orientations an azimuth/elevation pair cannot (it
 * has no pole and no up vector).
 *
 * ## Parameter-driven, like every other rig (R-36)
 *
 * {@link TrackballRig.drag} takes four numbers in viewport pixels. There is no
 * `@fourjs/input` import — `@fourjs/scene` may not have one under the frozen §3.1
 * matrix — and, as R-36 recorded for the other rigs, that constraint is the
 * right design anyway: a rig whose only inputs are numbers is replayable (§34),
 * testable without a device, and leaves sensitivity, inversion and acceleration
 * where they belong, in the application.
 *
 * ## Refusals (§85) and determinism (§33)
 *
 * A non-finite coordinate, size, radius or distance is refused with
 * `RangeError` rather than clamped — the other rigs' rule, and the reason is
 * theirs: `NaN` is not a value at the end of a range, and a rig that swallowed
 * one would place its camera at `NaN` on some later frame instead of at the
 * mistake. A drag between two points that map to the *same* sphere point is not
 * an error: it is a drag of zero rotation, and it returns `false` after bumping
 * {@link TrackballRig.degenerateDrags} rather than writing an undefined axis.
 *
 * `sqrt`, `acos` and `sin`/`cos` are on the path, so this is §33's
 * **same-runtime** tier — the same statement every floating-point feature in
 * the engine carries. No clock, no RNG, no iteration order, and no allocation
 * after construction: the three scratch vectors and the delta quaternion are
 * per-instance.
 */

import { Quaternion, Vector3 } from "@fourjs/math";

import { runOwnedTransformWrite, warnAuthorityConflict } from "./authority.js";
import type { Node } from "./node.js";
import { DEFAULT_SCREEN_ORIGIN, type ScreenOrigin } from "./screen-camera.js";

/**
 * Default {@link TrackballRig.radius}: `1` — the virtual sphere's silhouette
 * touches the nearer pair of viewport edges. Values below 1 make the sphere
 * smaller than the viewport (more of the drag area is on the hyperbolic sheet,
 * so the spin is looser); above 1 make it larger (the drag feels stiffer).
 */
export const DEFAULT_TRACKBALL_RADIUS = 1;

/** Construction options for {@link TrackballRig}. */
export interface TrackballRigOptions {
  /** Viewport width in pixels. Finite and `> 0`. Default `1`. */
  width?: number;
  /** Viewport height in pixels. Finite and `> 0`. Default `1`. */
  height?: number;
  /**
   * How the pixel coordinates handed to {@link TrackballRig.drag} are measured
   * (§47, §7a). Default `"top-left"` — the §7a default, and what a DOM pointer
   * event reports. Only the Y direction and the location of `(0, 0)` differ;
   * see {@link ScreenCamera}.
   */
  origin?: ScreenOrigin;
  /** Virtual sphere radius, as a fraction of half the shorter viewport side. Default `1`. */
  radius?: number;
  /** Point the camera is placed around, in its parent's space. Copied, not held. */
  target?: Vector3;
  /** Distance from {@link TrackballRig.target}. Finite and `> 0`. Default `1`. */
  distance?: number;
  /** Initial orientation. Copied, not held. Default identity. */
  rotation?: Quaternion;
}

/** Throws unless `value` is finite (§85). */
function assertFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `${what} must be a finite number (§85); received ${String(value)}`,
    );
  }
}

/** Throws unless `value` is finite and positive (§85). */
function assertPositive(value: number, what: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `${what} must be a finite number > 0 (§85); received ${String(value)}`,
    );
  }
}

/**
 * Rotates `(0, 0, z)` by the unit quaternion `q`, into `out`.
 *
 * Written out here rather than added to `@fourjs/math` as a general
 * `Vector3.applyQuaternion`: that primitive is a math-package decision with its
 * own naming and `out` conventions (§7b), and this file needs exactly one
 * special case of it — the camera's own +Z offset. The identity used is
 * `v' = v + 2w(u × v) + 2(u × (u × v))` with `u` the vector part, specialised
 * for `v = (0, 0, z)`.
 */
function rotateZAxis(q: Quaternion, z: number, out: Vector3): Vector3 {
  // u × v for v = (0, 0, z)
  const cx = q.y * z;
  const cy = -q.x * z;
  // u × (u × v); the third component of (u × v) is zero, which drops six terms
  const ccx = -q.z * cy;
  const ccy = q.z * cx;
  const ccz = q.x * cy - q.y * cx;
  return out.set(2 * (q.w * cx + ccx), 2 * (q.w * cy + ccy), z + 2 * ccz);
}

/**
 * A virtual-sphere trackball (§44, §47) — see the module documentation for the
 * mapping, the placement decision, and why this is not a component.
 *
 * The rig holds an orientation and, optionally, a pivot and a distance. Used
 * for its {@link TrackballRig.rotation} alone it is a pure "spin this object"
 * control; given a `target` and a `distance` it is a camera rig, and
 * {@link TrackballRig.applyTo} places and aims a camera in one call.
 */
export class TrackballRig {
  /**
   * The accumulated orientation, as a unit quaternion. Live and mutable — read
   * it, or write into it to snap the trackball somewhere; the instance is never
   * replaced, so a caller that captured it keeps a valid view.
   */
  readonly rotation = new Quaternion();

  /**
   * The point {@link TrackballRig.applyTo} places a node around, in that node's
   * **parent** space. Live and mutable, like `rotation`.
   *
   * Parent space rather than world space, deliberately: a trackball camera is
   * authored as a top-level node or under a single rig parent, and writing the
   * local transform keeps this rig free of world-matrix inversion — the machinery
   * `@fourjs/motion`'s `placeAtWorldPosition` exists for, which a rig driven from a
   * pointer event does not need. A trackball under a moving parent orbits the
   * parent's frame, which is the useful reading of it.
   */
  readonly target = new Vector3();

  /** Viewport width in pixels. Assign a new one on resize (validated on use). */
  width: number;

  /** Viewport height in pixels. */
  height: number;

  /** How {@link TrackballRig.drag}'s coordinates are measured. */
  origin: ScreenOrigin;

  /** Virtual sphere radius as a fraction of half the shorter side. Immutable — retuning is a new rig. */
  readonly radius: number;

  /** Distance from {@link TrackballRig.target}, in world units. */
  distance: number;

  /** Drags that produced a rotation. */
  dragCount = 0;

  /** Drags whose two points mapped to the same sphere point, so nothing was rotated. */
  degenerateDrags = 0;

  /** Scratch: the sphere point a drag starts at (D7 — no per-drag allocation). */
  readonly #from = new Vector3();

  /** Scratch: the sphere point a drag ends at. */
  readonly #to = new Vector3();

  /** Scratch: the rotation axis, and then the placement offset. */
  readonly #axis = new Vector3();

  /** Scratch: one drag's rotation, before it is composed onto `rotation`. */
  readonly #delta = new Quaternion();

  /**
   * @throws RangeError if a size, the radius, or the distance is not a finite
   * positive number (§85).
   */
  constructor(options: TrackballRigOptions = {}) {
    const width = options.width ?? 1;
    const height = options.height ?? 1;
    const radius = options.radius ?? DEFAULT_TRACKBALL_RADIUS;
    const distance = options.distance ?? 1;
    assertPositive(width, "TrackballRigOptions.width");
    assertPositive(height, "TrackballRigOptions.height");
    assertPositive(radius, "TrackballRigOptions.radius");
    assertPositive(distance, "TrackballRigOptions.distance");
    this.width = width;
    this.height = height;
    this.radius = radius;
    this.distance = distance;
    this.origin = options.origin ?? DEFAULT_SCREEN_ORIGIN;
    if (options.target !== undefined) {
      this.target.copy(options.target);
    }
    if (options.rotation !== undefined) {
      this.rotation.copy(options.rotation).normalize();
    }
  }

  /**
   * Records a new viewport size (§45/§48). Both numbers are validated (§85).
   *
   * @returns this rig, for chaining
   * @throws RangeError on a non-finite or non-positive size. Nothing is written.
   */
  setViewportSize(width: number, height: number): this {
    assertPositive(width, "TrackballRig.width");
    assertPositive(height, "TrackballRig.height");
    this.width = width;
    this.height = height;
    return this;
  }

  /**
   * Maps a viewport point to a point on the virtual sphere, into `out` (§7b's
   * `out` convention).
   *
   * Public because it is the whole mapping, and a caller who wants to draw the
   * trackball's silhouette, unit-test a gesture, or build a different gesture on
   * the same sphere should not have to re-derive it.
   *
   * @throws RangeError if either coordinate is not finite, or if the viewport
   * size is not positive (§85).
   */
  projectToSphere(x: number, y: number, out: Vector3): Vector3 {
    assertFinite(x, "TrackballRig.projectToSphere x");
    assertFinite(y, "TrackballRig.projectToSphere y");
    assertPositive(this.width, "TrackballRig.width");
    assertPositive(this.height, "TrackballRig.height");
    const scale = (this.radius * Math.min(this.width, this.height)) / 2;
    let nx: number;
    let ny: number;
    if (this.origin === "centered") {
      nx = x / scale;
      ny = y / scale;
    } else {
      nx = (x - this.width / 2) / scale;
      ny = (y - this.height / 2) / scale;
      // §7a's screen Y grows downwards; the sphere is in the Y-up world frame,
      // so a top-left drag downwards must tilt the near pole downwards. Same
      // single sign as `ScreenCamera`'s projection flip.
      if (this.origin === "top-left") {
        ny = -ny;
      }
    }
    const squared = nx * nx + ny * ny;
    // The sphere out to `d = 1/√2`, then the sheet `1 / 2d`. The crossover is
    // at the sphere's 45° parallel rather than at its silhouette because that
    // is where the two surfaces meet *and* share a tangent: both give
    // `z = 1/√2` there, and both fall at the same rate, so a drag through the
    // crossover has no visible kink. Switching at `d = 1` instead would leave a
    // jump of half a radius, which is the classic mis-implementation.
    const z = squared < 0.5 ? Math.sqrt(1 - squared) : 0.5 / Math.sqrt(squared);
    return out.set(nx, ny, z).normalize();
  }

  /**
   * Turns a drag from one viewport point to another into a rotation and
   * composes it onto {@link TrackballRig.rotation}.
   *
   * Call it per pointer-move with the previous and current positions; a whole
   * gesture is the composition of its moves, and composing per move is what
   * makes the response continuous rather than snapping from the gesture's
   * origin.
   *
   * @returns `true` when the rig rotated. `false` — and a bumped
   * {@link TrackballRig.degenerateDrags} — when the two points map to the same
   * sphere point (a drag of zero length, or two points diametrically related by
   * the sheet), which has no defined axis.
   * @throws RangeError if any coordinate is not finite, or the viewport size is
   * not positive (§85). Nothing is written when it throws.
   */
  drag(fromX: number, fromY: number, toX: number, toY: number): boolean {
    const from = this.projectToSphere(fromX, fromY, this.#from);
    const to = this.projectToSphere(toX, toY, this.#to);
    const axis = this.#axis.copy(from).cross(to);
    if (axis.lengthSq() === 0) {
      this.degenerateDrags += 1;
      return false;
    }
    // Both points are unit length, so the dot product is a cosine — clamped
    // because rounding can put it a few ULP outside [-1, 1] and `acos` answers
    // `NaN` there.
    const cosine = Math.min(1, Math.max(-1, from.dot(to)));
    this.#delta.setFromAxisAngle(axis, Math.acos(cosine));
    // World-space composition: the drag's rotation goes on the outside, so the
    // next drag is about screen axes rather than the axes this one left behind.
    this.rotation.copy(this.#delta.multiply(this.rotation)).normalize();
    this.dragCount += 1;
    return true;
  }

  /** Returns the rig to the identity orientation. Counters are left alone. */
  reset(): void {
    this.rotation.identity();
  }

  /**
   * Writes the rig's orientation onto `node`, and — when
   * {@link TrackballRig.distance} places it — its position: `target` plus the
   * rotated `+Z` offset, so the node looks down its own −Z at the target (§7a,
   * the convention `Node.lookAt` and `Camera.updateViewMatrix` share).
   *
   * The write is the **application's**, under §42's default `"manual"`
   * authority, because no system drives this rig (see the module
   * documentation). A node owned by any other authority is refused and warned
   * about once, like every other refused write in §42.
   *
   * @returns `true` when the node was written; `false` when §42 refused it.
   */
  applyTo(node: Node): boolean {
    if (node.transformAuthority !== "manual") {
      warnAuthorityConflict(node, "manual");
      return false;
    }
    runOwnedTransformWrite(() => {
      node.rotation.copy(this.rotation);
      const offset = rotateZAxis(this.rotation, this.distance, this.#axis);
      node.position.set(
        this.target.x + offset.x,
        this.target.y + offset.y,
        this.target.z + offset.z,
      );
    });
    return true;
  }
}
