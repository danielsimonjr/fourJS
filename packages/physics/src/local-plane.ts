/**
 * §21's `"local-plane"` simulation frame (PH-12 remainder).
 *
 * A body with `RigidBody.space === "local-plane"` authors its 2D pose in the
 * plane's own frame (`u` along {@link ResolvedLocalPlane.xAxis}, `v` along
 * {@link ResolvedLocalPlane.yAxis}, rotation about the plane normal). The
 * solver still sees world-space poses; {@link planeToWorld} / {@link worldToPlane}
 * are the feed/publish mapping.
 *
 * Default plane: origin `0`, normal `+Z`, xAxis `+X` — the world XY plane,
 * which is the identity map for a `"2d"` world. Existing world/local tests
 * therefore stay bit-identical: they never opt into `"local-plane"`.
 */

import { FourError } from "@fourjs/core";
import { Quaternion, Vector3 } from "@fourjs/math";

import { widenToVector3, type LocalPlane } from "./descriptors.js";

const PLANE_ERROR_CODE = "INVALID_APPLICATION_STATE";

export type { LocalPlane };

/** Orthonormal right-handed basis `{ xAxis, yAxis, normal }` plus origin. */
export interface ResolvedLocalPlane {
  readonly origin: Vector3;
  readonly normal: Vector3;
  readonly xAxis: Vector3;
  readonly yAxis: Vector3;
  /** Rotation that maps plane-local `(1,0,0)/(0,1,0)/(0,0,1)` onto the basis. */
  readonly rotation: Quaternion;
}

const DEFAULT_ORIGIN = Object.freeze(new Vector3(0, 0, 0)) as Vector3;
const DEFAULT_NORMAL = Object.freeze(new Vector3(0, 0, 1)) as Vector3;
const DEFAULT_X_AXIS = Object.freeze(new Vector3(1, 0, 0)) as Vector3;
const DEFAULT_Y_AXIS = Object.freeze(new Vector3(0, 1, 0)) as Vector3;
const DEFAULT_ROTATION = Object.freeze(
  new Quaternion(0, 0, 0, 1),
) as Quaternion;

/**
 * The XY plane — origin 0, normal +Z, xAxis +X. Shared; do not mutate.
 *
 * This is the identity map: plane `(u, v, w)` is world `(u, v, w)`, and a
 * Z-rotation stays a Z-rotation.
 */
export const DEFAULT_LOCAL_PLANE: ResolvedLocalPlane = Object.freeze({
  origin: DEFAULT_ORIGIN,
  normal: DEFAULT_NORMAL,
  xAxis: DEFAULT_X_AXIS,
  yAxis: DEFAULT_Y_AXIS,
  rotation: DEFAULT_ROTATION,
});

/** Whether `plane` is the shared default XY plane (pointer or values). */
export function isDefaultLocalPlane(plane: ResolvedLocalPlane): boolean {
  if (plane === DEFAULT_LOCAL_PLANE) {
    return true;
  }
  return (
    plane.origin.x === 0 &&
    plane.origin.y === 0 &&
    plane.origin.z === 0 &&
    plane.normal.x === 0 &&
    plane.normal.y === 0 &&
    plane.normal.z === 1 &&
    plane.xAxis.x === 1 &&
    plane.xAxis.y === 0 &&
    plane.xAxis.z === 0
  );
}

/**
 * Completes and orthonormalizes an authored plane.
 *
 * Omitted `plane` returns {@link DEFAULT_LOCAL_PLANE} and allocates nothing.
 *
 * @throws FourError if `normal` is zero or `xAxis` is parallel to it (§85)
 */
export function resolveLocalPlane(plane?: LocalPlane): ResolvedLocalPlane {
  if (plane === undefined) {
    return DEFAULT_LOCAL_PLANE;
  }

  const origin = widenToVector3(plane.origin);
  const normal = widenToVector3(plane.normal);
  if (normal.lengthSq() === 0 || !isFiniteVec(normal)) {
    throw new FourError(
      PLANE_ERROR_CODE,
      `PhysicsWorldOptions.localPlane.normal must be a finite non-zero vector (§21, §85); got (${String(normal.x)}, ${String(normal.y)}, ${String(normal.z)}).`,
      {
        context: {
          field: "localPlane.normal",
          x: normal.x,
          y: normal.y,
          z: normal.z,
        },
      },
    );
  }
  normal.normalize();

  const xAxis = new Vector3();
  if (plane.xAxis !== undefined) {
    widenToVector3(plane.xAxis, xAxis);
    if (xAxis.lengthSq() === 0 || !isFiniteVec(xAxis)) {
      throw new FourError(
        PLANE_ERROR_CODE,
        `PhysicsWorldOptions.localPlane.xAxis must be a finite non-zero vector (§21, §85); got (${String(xAxis.x)}, ${String(xAxis.y)}, ${String(xAxis.z)}).`,
        {
          context: {
            field: "localPlane.xAxis",
            x: xAxis.x,
            y: xAxis.y,
            z: xAxis.z,
          },
        },
      );
    }
    // Gram-Schmidt: drop the normal component so the basis stays orthogonal.
    const along = xAxis.dot(normal);
    xAxis.set(
      xAxis.x - normal.x * along,
      xAxis.y - normal.y * along,
      xAxis.z - normal.z * along,
    );
    if (xAxis.lengthSq() === 0) {
      throw new FourError(
        PLANE_ERROR_CODE,
        "PhysicsWorldOptions.localPlane.xAxis is parallel to normal, so the plane has no in-plane +X (§21, §85).",
        { context: { field: "localPlane.xAxis" } },
      );
    }
  } else {
    // Prefer world +X; fall back to +Y when the normal is along +X.
    xAxis.set(1, 0, 0);
    const along = xAxis.dot(normal);
    xAxis.set(1 - normal.x * along, -normal.y * along, -normal.z * along);
    if (xAxis.lengthSq() === 0) {
      xAxis.set(0, 1, 0);
      const alongY = xAxis.dot(normal);
      xAxis.set(-normal.x * alongY, 1 - normal.y * alongY, -normal.z * alongY);
    }
  }
  xAxis.normalize();

  const yAxis = new Vector3(normal.x, normal.y, normal.z).cross(xAxis);
  yAxis.normalize();
  // Re-derive x so the triple is exactly orthonormal (x = y × n).
  xAxis.set(yAxis.x, yAxis.y, yAxis.z).cross(normal);
  xAxis.normalize();

  const rotation = new Quaternion();
  setFromBasis(
    rotation,
    xAxis.x,
    xAxis.y,
    xAxis.z,
    yAxis.x,
    yAxis.y,
    yAxis.z,
    normal.x,
    normal.y,
    normal.z,
  );

  return Object.freeze({ origin, normal, xAxis, yAxis, rotation });
}

/**
 * Maps a plane-frame pose into world space. Writes `outPosition` / `outRotation`
 * and returns nothing; aliasing `local*` with `out*` is safe.
 */
export function planeToWorld(
  plane: ResolvedLocalPlane,
  localPosition: Vector3,
  localRotation: Quaternion,
  outPosition: Vector3,
  outRotation: Quaternion,
): void {
  const { origin, xAxis, yAxis, normal, rotation } = plane;
  const x = localPosition.x;
  const y = localPosition.y;
  const z = localPosition.z;
  outPosition.set(
    origin.x + x * xAxis.x + y * yAxis.x + z * normal.x,
    origin.y + x * xAxis.y + y * yAxis.y + z * normal.y,
    origin.z + x * xAxis.z + y * yAxis.z + z * normal.z,
  );
  // q_world = q_basis * q_local
  const lx = localRotation.x;
  const ly = localRotation.y;
  const lz = localRotation.z;
  const lw = localRotation.w;
  const bx = rotation.x;
  const by = rotation.y;
  const bz = rotation.z;
  const bw = rotation.w;
  outRotation.set(
    bw * lx + bx * lw + by * lz - bz * ly,
    bw * ly - bx * lz + by * lw + bz * lx,
    bw * lz + bx * ly - by * lx + bz * lw,
    bw * lw - bx * lx - by * ly - bz * lz,
  );
}

/**
 * Maps a world-space pose back into the plane's frame. Aliasing-safe.
 */
export function worldToPlane(
  plane: ResolvedLocalPlane,
  worldPosition: Vector3,
  worldRotation: Quaternion,
  outPosition: Vector3,
  outRotation: Quaternion,
): void {
  const { origin, xAxis, yAxis, normal, rotation } = plane;
  const dx = worldPosition.x - origin.x;
  const dy = worldPosition.y - origin.y;
  const dz = worldPosition.z - origin.z;
  outPosition.set(
    dx * xAxis.x + dy * xAxis.y + dz * xAxis.z,
    dx * yAxis.x + dy * yAxis.y + dz * yAxis.z,
    dx * normal.x + dy * normal.y + dz * normal.z,
  );
  // q_local = q_basis⁻¹ * q_world  (unit inverse is the conjugate)
  const ix = -rotation.x;
  const iy = -rotation.y;
  const iz = -rotation.z;
  const iw = rotation.w;
  const wx = worldRotation.x;
  const wy = worldRotation.y;
  const wz = worldRotation.z;
  const ww = worldRotation.w;
  outRotation.set(
    iw * wx + ix * ww + iy * wz - iz * wy,
    iw * wy - ix * wz + iy * ww + iz * wx,
    iw * wz + ix * wy - iy * wx + iz * ww,
    iw * ww - ix * wx - iy * wy - iz * wz,
  );
}

/**
 * Maps a plane-frame vector (velocity, impulse) into world space. No origin.
 * Aliasing-safe.
 */
export function planeToWorldVec(
  plane: ResolvedLocalPlane,
  local: Vector3,
  out: Vector3,
): void {
  const { xAxis, yAxis, normal } = plane;
  const x = local.x;
  const y = local.y;
  const z = local.z;
  out.set(
    x * xAxis.x + y * yAxis.x + z * normal.x,
    x * xAxis.y + y * yAxis.y + z * normal.y,
    x * xAxis.z + y * yAxis.z + z * normal.z,
  );
}

/**
 * Maps a world-space vector back into the plane's frame. Aliasing-safe.
 */
export function worldToPlaneVec(
  plane: ResolvedLocalPlane,
  world: Vector3,
  out: Vector3,
): void {
  const { xAxis, yAxis, normal } = plane;
  out.set(
    world.x * xAxis.x + world.y * xAxis.y + world.z * xAxis.z,
    world.x * yAxis.x + world.y * yAxis.y + world.z * yAxis.z,
    world.x * normal.x + world.y * normal.y + world.z * normal.z,
  );
}

function isFiniteVec(value: Vector3): boolean {
  return (
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.z)
  );
}

/**
 * Shepperd's method: rotation whose columns are the images of +X, +Y, +Z.
 * Local copy — `@fourjs/math` keeps the same conversion module-internal.
 */
function setFromBasis(
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
): void {
  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    out.set((m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s);
    return;
  }
  if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    out.set(0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s);
    return;
  }
  if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    out.set((m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s);
    return;
  }
  const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
  out.set((m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s);
}
