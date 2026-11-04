/**
 * The bone-texture skin palette (§54, §62; RFC 0003 residue, decision D7).
 *
 * `Mesh.skinningMode === "texture"` uploads a skeleton's joint palette as a
 * **`"rgba32float"` texture** that the vertex stage fetches with explicit
 * integer coordinates (`texelFetch` / `textureLoad` — no sampler, no filtering,
 * no `textureSize`), which unbounds the uniform tier's
 * {@link MAX_SKINNING_JOINTS} = 48.
 *
 * ## Normative layout (the §54 amendment)
 *
 * - Texel format `"rgba32float"` ({@link SKIN_PALETTE_TEXTURE_FORMAT}).
 * - Width {@link SKIN_PALETTE_TEXTURE_WIDTH} = 2048 texels (the WebGL 2
 *   `MAX_TEXTURE_SIZE` floor), i.e. {@link SKIN_PALETTE_JOINTS_PER_ROW} = 512
 *   joints per row; height `ceil(jointCount / 512)` rows.
 * - A joint matrix is **4 consecutive texels**, one per matrix column
 *   (column-major, the skeleton's own `Float32Array` order): joint `j`, column
 *   `c` is texel `4 * j + c`, at `x = (4 * j + c) % 2048`,
 *   `y = floor((4 * j + c) / 2048)`. Because 2048 is a multiple of 4 a joint
 *   never straddles a row. The texel stream is therefore *byte-identical* to the
 *   uniform palette (§33), zero-padded to a whole number of rows.
 * - The joint limit is {@link MAX_TEXTURE_SKINNING_JOINTS} = 65535 (the
 *   `uint16` joint-index attribute), further bounded per device by
 *   `RendererCapabilities.maximumTextureSkinningJoints`.
 */

import type { RenderTargetFormat } from "./render-target.js";

/** The texel format of the palette texture. */
export const SKIN_PALETTE_TEXTURE_FORMAT: RenderTargetFormat = "rgba32float";

/** Palette texture width in texels. */
export const SKIN_PALETTE_TEXTURE_WIDTH = 2048;

/** Texels one joint matrix occupies (one per column). */
export const SKIN_PALETTE_TEXELS_PER_JOINT = 4;

/** Joints per palette-texture row. */
export const SKIN_PALETTE_JOINTS_PER_ROW =
  SKIN_PALETTE_TEXTURE_WIDTH / SKIN_PALETTE_TEXELS_PER_JOINT;

/** Floats per palette-texture row. */
export const SKIN_PALETTE_FLOATS_PER_ROW = SKIN_PALETTE_TEXTURE_WIDTH * 4;

/** The most joints a `"texture"` skeleton may have (`uint16` joint indices). */
export const MAX_TEXTURE_SKINNING_JOINTS = 65535;

/** Rows the palette texture needs for `jointCount` joints (at least one). */
export function skinPaletteRows(jointCount: number): number {
  return Math.max(1, Math.ceil(jointCount / SKIN_PALETTE_JOINTS_PER_ROW));
}

/**
 * Copies `palette` (16 floats per joint) into `out` — a `Float32Array` of
 * `skinPaletteRows(n) * SKIN_PALETTE_FLOATS_PER_ROW` floats — and zeroes the
 * tail. No allocation; `out` is the reusable staging array.
 */
export function stageSkinPalette(
  palette: Float32Array,
  out: Float32Array,
): void {
  const count = Math.min(palette.length, out.length);
  if (count === palette.length) {
    out.set(palette, 0);
  } else {
    out.set(palette.subarray(0, count), 0);
  }
  out.fill(0, count);
}
