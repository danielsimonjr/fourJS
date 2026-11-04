/**
 * §69's shadow-atlas math (W6.3, 2026-11-04) — cascade fitting, the punctual
 * perspective maps, and the tile grid they are packed into.
 *
 * Everything here is **pure CPU arithmetic over `out` parameters** (§7b): the
 * light collector (`lights.ts`) calls it once per frame, and both backends
 * consume the results as plain numbers — a tile matrix per caster pass, a
 * handful of arrays per receiver upload. No backend derives a shadow matrix of
 * its own, which is what keeps the two backends' maps identical (§33).
 *
 * ## The atlas
 *
 * One frame's shadow maps are **tiles of one depth texture**:
 *
 * ```text
 * tile 0 … C-1        the directional light's C cascades        (C = 1 … 4)
 * then, per shadowed punctual light in scene-graph order:
 *   spot  → 1 tile    one perspective map along the cone axis
 *   point → 6 tiles   +X, −X, +Y, −Y, +Z, −Z cube faces
 * ```
 *
 * Every tile is a square of `T` texels, `T` being the largest `mapSize` among
 * the frame's casters (a smaller map is rendered at tile resolution — the
 * honest reading of "the atlas is one texture"). The grid is
 * `columns = ceil(sqrt(n))`, `rows = ceil(n / columns)`, tiles in row-major
 * order; one tile is `1 × 1` and is the pre-W6.3 map exactly. A tile's index is
 * all a shader needs to find its rectangle, so no per-tile rectangle is ever
 * uploaded.
 *
 * ## Cascades
 *
 * The practical split scheme (Zhang et al., "Parallel-Split Shadow Maps"):
 * `split(i) = λ·n·(f/n)^(i/N) + (1 − λ)·(n + (f − n)·i/N)`. Each slice of the
 * camera frustum is bounded by a **sphere** (its eight corners' mean and the
 * largest distance to it, the radius rounded up to 1/16 m), so the volume's
 * size is independent of the camera's rotation, and the volume's centre is
 * snapped to whole texels in light space — the two together are what stop a
 * cascade shimmering as the camera turns (§33: a function of authored state,
 * never of time or frame history).
 *
 * @module
 */

import { Matrix4, Vector3 } from "@fourjs/math";

/** The most cascades one directional light may use. */
export const MAX_SHADOW_CASCADES = 4;

/** The most point/spot lights that cast in one frame. */
export const MAX_SHADOWED_PUNCTUAL_LIGHTS = 4;

/** Tiles in the largest possible atlas: 4 cascades + 4 point lights × 6 faces. */
export const MAX_SHADOW_TILES =
  MAX_SHADOW_CASCADES + MAX_SHADOWED_PUNCTUAL_LIGHTS * 6;

/**
 * Longest atlas edge, in texels. 8192 is the `maxTextureDimension2D` every
 * WebGPU adapter guarantees to reach and a common WebGL 2 `MAX_TEXTURE_SIZE`;
 * a frame whose casters would need more drops its later punctual lights with a
 * development warning rather than allocating a texture the device refuses.
 */
export const SHADOW_ATLAS_MAX_EDGE = 8192;

/** `shadowPunctualParams.w` for a spot light's single perspective map. */
export const SHADOW_KIND_SPOT = 1;

/** `shadowPunctualParams.w` for a point light's six cube faces. */
export const SHADOW_KIND_POINT = 2;

/** Widest field of view a spot shadow uses, in radians (160°). */
export const MAX_SPOT_SHADOW_FOV = (160 * Math.PI) / 180;

/** One face of a point light's shadow cube. */
export interface ShadowCubeFace {
  /** The axis the face looks along. */
  readonly forward: readonly [number, number, number];
  /** The face's up vector. */
  readonly up: readonly [number, number, number];
  /** `forward × up` — the face's +x direction. */
  readonly right: readonly [number, number, number];
}

function face(
  forward: readonly [number, number, number],
  up: readonly [number, number, number],
): ShadowCubeFace {
  return {
    forward,
    up,
    right: [
      forward[1] * up[2] - forward[2] * up[1],
      forward[2] * up[0] - forward[0] * up[2],
      forward[0] * up[1] - forward[1] * up[0],
    ],
  };
}

/**
 * The six cube faces in tile order: +X, −X, +Y, −Y, +Z, −Z. The backends
 * generate their shaders' basis tables from this array, so the caster pass and
 * the receiver's analytic projection cannot disagree about a face.
 */
export const SHADOW_CUBE_FACES: readonly ShadowCubeFace[] = [
  face([1, 0, 0], [0, 1, 0]),
  face([-1, 0, 0], [0, 1, 0]),
  face([0, 1, 0], [0, 0, -1]),
  face([0, -1, 0], [0, 0, 1]),
  face([0, 0, 1], [0, 1, 0]),
  face([0, 0, -1], [0, 1, 0]),
];

/**
 * The camera a cascaded light is fitted to — the structural half of
 * `@fourjs/scene`'s `Camera` this module reads.
 */
export interface ShadowFitCamera {
  /** Distance to the near plane (positive). */
  readonly near: number;
  /** Distance to the far plane (positive). */
  readonly far: number;
  /** Camera space → clip space (`[-1, 1]` or `[0, 1]` depth — only x/y scale and the perspective flag are read). */
  readonly projectionMatrix: Matrix4;
  /** World space → camera space. */
  readonly viewMatrix: Matrix4;
  /** Refreshes {@link ShadowFitCamera.viewMatrix}, when the camera offers it. */
  updateViewMatrix?(): void;
}

/**
 * Writes the `count` practical split distances into `out[0…count-1]` and `0`
 * into the rest. `out[i]` is the **far** view distance of cascade `i`; cascade
 * `i` starts where `i − 1` ends (cascade 0 at `near`).
 */
export function computeCascadeSplits(
  near: number,
  far: number,
  count: number,
  lambda: number,
  out: Float32Array,
): void {
  for (let i = 0; i < 4; i += 1) {
    if (i >= count) {
      out[i] = 0;
      continue;
    }
    const fraction = (i + 1) / count;
    const logarithmic = near * Math.pow(far / near, fraction);
    const uniform = near + (far - near) * fraction;
    out[i] = lambda * logarithmic + (1 - lambda) * uniform;
  }
  // The last split is exactly `far` whatever the rounding of the above.
  out[count - 1] = far;
}

const worldScratch = new Matrix4();
const basisRight = new Vector3();
const basisUp = new Vector3();
const basisForward = new Vector3();
const cornerScratch = new Vector3();
const centerScratch = new Vector3();
const viewScratch = new Matrix4();
const projectionScratch = new Matrix4();

/** Builds an orthonormal `right`/`up` for `forward`, stable for any direction. */
function buildBasis(
  fx: number,
  fy: number,
  fz: number,
  right: Vector3,
  up: Vector3,
  forward: Vector3,
): void {
  const length = Math.hypot(fx, fy, fz) || 1;
  forward.set(fx / length, fy / length, fz / length);
  // World +Y unless the direction is (almost) vertical, then +Z (§7a: Y-up).
  const ux = 0;
  const uy = Math.abs(forward.y) > 0.999 ? 0 : 1;
  const uz = Math.abs(forward.y) > 0.999 ? 1 : 0;
  // right = forward × up
  right.set(
    forward.y * uz - forward.z * uy,
    forward.z * ux - forward.x * uz,
    forward.x * uy - forward.y * ux,
  );
  const rightLength = Math.hypot(right.x, right.y, right.z) || 1;
  right.set(
    right.x / rightLength,
    right.y / rightLength,
    right.z / rightLength,
  );
  // up = right × forward
  up.set(
    right.y * forward.z - right.z * forward.y,
    right.z * forward.x - right.x * forward.z,
    right.x * forward.y - right.y * forward.x,
  );
}

/**
 * Writes the view matrix of an eye at `(px, py, pz)` looking along `forward`
 * with `up` and `right = forward × up`, into `out` (column-major, §7b).
 */
function writeViewMatrix(
  out: Matrix4,
  right: { x: number; y: number; z: number },
  up: { x: number; y: number; z: number },
  forward: { x: number; y: number; z: number },
  px: number,
  py: number,
  pz: number,
): Matrix4 {
  const e = out.elements;
  e[0] = right.x;
  e[1] = up.x;
  e[2] = -forward.x;
  e[3] = 0;
  e[4] = right.y;
  e[5] = up.y;
  e[6] = -forward.y;
  e[7] = 0;
  e[8] = right.z;
  e[9] = up.z;
  e[10] = -forward.z;
  e[11] = 0;
  e[12] = -(right.x * px + right.y * py + right.z * pz);
  e[13] = -(up.x * px + up.y * py + up.z * pz);
  e[14] = forward.x * px + forward.y * py + forward.z * pz;
  e[15] = 1;
  return out;
}

/**
 * Fits `count` cascaded orthographic volumes to `camera` for a light shining
 * along `(dx, dy, dz)` and writes their view-projections into `matrices[0…]`,
 * the split distances into `splits` and the camera's view-depth row
 * (`depth = dot(row.xyz, p) + row.w`) into `depthRow`.
 *
 * `reach` is how far toward the light, beyond a slice's bounding sphere,
 * casters are collected. Returns `false` — leaving the outputs unspecified —
 * when the camera is degenerate (non-finite matrices, or an empty range), in
 * which case the caller falls back to the light's authored single volume.
 */
export function fitDirectionalCascades(
  camera: ShadowFitCamera,
  dx: number,
  dy: number,
  dz: number,
  count: number,
  lambda: number,
  distance: number,
  mapSize: number,
  reach: number,
  splits: Float32Array,
  depthRow: Float32Array,
  matrices: readonly Matrix4[],
): boolean {
  camera.updateViewMatrix?.();
  worldScratch.copy(camera.viewMatrix).invert();
  const w = worldScratch.elements;
  const p = camera.projectionMatrix.elements;
  const near = camera.near;
  const far = Math.min(camera.far, distance);
  if (
    !(near > 0) ||
    !(far > near) ||
    !Number.isFinite(p[0]) ||
    !Number.isFinite(p[5]) ||
    p[0] === 0 ||
    p[5] === 0 ||
    !Number.isFinite(w[12]) ||
    !Number.isFinite(w[14])
  ) {
    return false;
  }
  const perspective = p[11] === -1;
  const halfWidthScale = Math.abs(1 / p[0]);
  const halfHeightScale = Math.abs(1 / p[5]);

  computeCascadeSplits(near, far, count, lambda, splits);

  // Camera forward in world space (its −Z column), for the depth row.
  const fl = Math.hypot(w[8], w[9], w[10]) || 1;
  const fx = -w[8] / fl;
  const fy = -w[9] / fl;
  const fz = -w[10] / fl;
  depthRow[0] = fx;
  depthRow[1] = fy;
  depthRow[2] = fz;
  depthRow[3] = -(fx * w[12] + fy * w[13] + fz * w[14]);

  buildBasis(dx, dy, dz, basisRight, basisUp, basisForward);

  let sliceNear = near;
  for (let cascade = 0; cascade < count; cascade += 1) {
    const sliceFar = splits[cascade];
    centerScratch.set(0, 0, 0);
    for (let corner = 0; corner < 8; corner += 1) {
      const depth = (corner & 4) === 0 ? sliceNear : sliceFar;
      const halfWidth = perspective ? depth * halfWidthScale : halfWidthScale;
      const halfHeight = perspective
        ? depth * halfHeightScale
        : halfHeightScale;
      const cx = (corner & 1) === 0 ? -halfWidth : halfWidth;
      const cy = (corner & 2) === 0 ? -halfHeight : halfHeight;
      // world = M · (cx, cy, −depth, 1)
      const x = w[0] * cx + w[4] * cy - w[8] * depth + w[12];
      const y = w[1] * cx + w[5] * cy - w[9] * depth + w[13];
      const z = w[2] * cx + w[6] * cy - w[10] * depth + w[14];
      centerScratch.set(
        centerScratch.x + x,
        centerScratch.y + y,
        centerScratch.z + z,
      );
    }
    const cxw = centerScratch.x / 8;
    const cyw = centerScratch.y / 8;
    const czw = centerScratch.z / 8;
    let radius = 0;
    for (let corner = 0; corner < 8; corner += 1) {
      const depth = (corner & 4) === 0 ? sliceNear : sliceFar;
      const halfWidth = perspective ? depth * halfWidthScale : halfWidthScale;
      const halfHeight = perspective
        ? depth * halfHeightScale
        : halfHeightScale;
      const cx = (corner & 1) === 0 ? -halfWidth : halfWidth;
      const cy = (corner & 2) === 0 ? -halfHeight : halfHeight;
      cornerScratch.set(
        w[0] * cx + w[4] * cy - w[8] * depth + w[12] - cxw,
        w[1] * cx + w[5] * cy - w[9] * depth + w[13] - cyw,
        w[2] * cx + w[6] * cy - w[10] * depth + w[14] - czw,
      );
      radius = Math.max(
        radius,
        Math.hypot(cornerScratch.x, cornerScratch.y, cornerScratch.z),
      );
    }
    radius = Math.max(Math.ceil(radius * 16) / 16, 1 / 16);

    // Light-space centre, snapped to whole texels so the map does not swim.
    const texel = (2 * radius) / mapSize;
    let sx = cxw * basisRight.x + cyw * basisRight.y + czw * basisRight.z;
    let sy = cxw * basisUp.x + cyw * basisUp.y + czw * basisUp.z;
    const sf =
      cxw * basisForward.x + cyw * basisForward.y + czw * basisForward.z;
    sx = Math.floor(sx / texel) * texel;
    sy = Math.floor(sy / texel) * texel;
    const zNear = sf - radius - reach;

    // View: x' = dot(right, p) − sx, y' = dot(up, p) − sy, z' = zNear − dot(f, p).
    const e = viewScratch.elements;
    e[0] = basisRight.x;
    e[1] = basisUp.x;
    e[2] = -basisForward.x;
    e[3] = 0;
    e[4] = basisRight.y;
    e[5] = basisUp.y;
    e[6] = -basisForward.y;
    e[7] = 0;
    e[8] = basisRight.z;
    e[9] = basisUp.z;
    e[10] = -basisForward.z;
    e[11] = 0;
    e[12] = -sx;
    e[13] = -sy;
    e[14] = zNear;
    e[15] = 1;
    projectionScratch.setOrthographic(
      -radius,
      radius,
      -radius,
      radius,
      0,
      2 * radius + reach,
    );
    matrices[cascade].copy(projectionScratch).multiply(viewScratch);
    sliceNear = sliceFar;
  }
  return true;
}

/**
 * Writes a spot light's perspective view-projection into `out` — an eye at
 * `(px, py, pz)` looking along `(dx, dy, dz)`, a field of view of
 * `2 × outerConeAngle` clamped to {@link MAX_SPOT_SHADOW_FOV}, aspect 1.
 */
export function writeSpotShadowMatrix(
  out: Matrix4,
  px: number,
  py: number,
  pz: number,
  dx: number,
  dy: number,
  dz: number,
  outerConeAngle: number,
  near: number,
  far: number,
): Matrix4 {
  buildBasis(dx, dy, dz, basisRight, basisUp, basisForward);
  writeViewMatrix(viewScratch, basisRight, basisUp, basisForward, px, py, pz);
  const fov = Math.min(Math.max(2 * outerConeAngle, 0.01), MAX_SPOT_SHADOW_FOV);
  projectionScratch.setPerspective(fov, 1, near, far);
  return out.copy(projectionScratch).multiply(viewScratch);
}

/** Writes cube face `faceIndex`'s (0…5) 90° view-projection for a light at `(px, py, pz)`. */
export function writeCubeFaceShadowMatrix(
  out: Matrix4,
  faceIndex: number,
  px: number,
  py: number,
  pz: number,
  near: number,
  far: number,
): Matrix4 {
  const f = SHADOW_CUBE_FACES[faceIndex];
  basisForward.set(f.forward[0], f.forward[1], f.forward[2]);
  basisUp.set(f.up[0], f.up[1], f.up[2]);
  basisRight.set(f.right[0], f.right[1], f.right[2]);
  writeViewMatrix(viewScratch, basisRight, basisUp, basisForward, px, py, pz);
  projectionScratch.setPerspective(Math.PI / 2, 1, near, far);
  return out.copy(projectionScratch).multiply(viewScratch);
}

/**
 * The tile grid for `tileCount` tiles of `tileSize` texels: columns, rows, and
 * the atlas width and height in texels, written into `out[0…3]`.
 */
export function computeAtlasGrid(
  tileCount: number,
  tileSize: number,
  out: Float64Array | number[],
): void {
  const columns = Math.max(1, Math.ceil(Math.sqrt(tileCount)));
  const rows = Math.max(1, Math.ceil(tileCount / columns));
  out[0] = columns;
  out[1] = rows;
  out[2] = columns * tileSize;
  out[3] = rows * tileSize;
}
