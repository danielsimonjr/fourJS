/**
 * Projection helpers for the Canvas 2D backend (§48, §7a).
 *
 * Pure arithmetic over `elements` arrays, no allocation per vertex: a vertex
 * goes object space -> clip space through one pre-multiplied
 * `viewProjection * world` matrix, then clip -> viewport pixels. The only
 * convention this file owns is the §48 flip: viewport rectangles are
 * **bottom-left origin, +Y up**; Canvas 2D is top-left, +Y down, so the flip
 * happens here, on the way in, and never leaks into a caller.
 */

/** A viewport rectangle in drawing-buffer pixels, §48 bottom-left origin. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A projected point: canvas pixels (top-left origin) and clip-space `w`. */
export interface ProjectedPoint {
  x: number;
  y: number;
  w: number;
}

/**
 * Resolves a viewport into drawing-buffer pixels (§48): `normalized`
 * fractions multiply the buffer size, pixel rectangles are used verbatim.
 * Values are rounded and extents clamped at zero.
 */
export function resolveViewRect(
  view: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly normalized?: boolean;
  },
  bufferWidth: number,
  bufferHeight: number,
  out: PixelRect,
): PixelRect {
  const sx = view.normalized === true ? bufferWidth : 1;
  const sy = view.normalized === true ? bufferHeight : 1;
  out.x = Math.round(view.x * sx);
  out.y = Math.round(view.y * sy);
  out.width = Math.max(0, Math.round(view.width * sx));
  out.height = Math.max(0, Math.round(view.height * sy));
  return out;
}

/**
 * Canvas-space top edge of a bottom-left-origin rectangle (the §48 flip).
 */
export function canvasTop(rect: PixelRect, bufferHeight: number): number {
  return bufferHeight - rect.y - rect.height;
}

/**
 * Projects `(x, y, z)` through the column-major matrix `m` into `rect`.
 * `top` is {@link canvasTop} of the rect. Returns `out`; `out.w` is the clip
 * `w`, which callers use to reject points at or behind the eye.
 */
export function projectPoint(
  m: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  rect: PixelRect,
  top: number,
  out: ProjectedPoint,
): ProjectedPoint {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  const inv = w !== 0 ? 1 / w : 0;
  const ndcX = (m[0] * x + m[4] * y + m[8] * z + m[12]) * inv;
  const ndcY = (m[1] * x + m[5] * y + m[9] * z + m[13]) * inv;
  out.x = rect.x + (ndcX * 0.5 + 0.5) * rect.width;
  out.y = top + (1 - (ndcY * 0.5 + 0.5)) * rect.height;
  out.w = w;
  return out;
}
