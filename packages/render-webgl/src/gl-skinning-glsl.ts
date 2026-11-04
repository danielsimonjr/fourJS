/**
 * The vertex-stage skinning chunk both the colour/caster programs
 * (`gl-skinning.ts`) and the picking id program (`gl-picking.ts`) splice in.
 *
 * Isolated so {@link registerPickingPipeline} can draw a deformed silhouette
 * without linking `gl-skinning.ts` (pipeline-cost law: that module is the
 * `registerSkinningPipeline` seam). The two consumers interpolate the same
 * exported string; they must not drift.
 *
 * Linear blend skinning, four influences summed in attribute order — a
 * fixed association order, though the result never re-enters the §33
 * envelope either way. Dual-quaternion skinning is deferred (RFC 0003 §8).
 * Joint indices arrive as non-normalized `UNSIGNED_SHORT` floats at
 * location 4 and weights at location 5 (`gl-geometry.ts`).
 */

import {
  MAX_SKINNING_JOINTS,
  SKIN_PALETTE_TEXTURE_WIDTH,
} from "@fourjs/render";

/**
 * The two influence attributes at their fixed locations, the palette, and
 * the blended skin matrix. Spliced into every skinned vertex stage.
 */
export const SKINNING_GLSL = `const int MAX_SKINNING_JOINTS = ${String(
  MAX_SKINNING_JOINTS,
)};
layout(location = 4) in vec4 joints;
layout(location = 5) in vec4 weights;
uniform mat4 jointMatrices[MAX_SKINNING_JOINTS];

mat4 skinMatrix() {
  return weights.x * jointMatrices[int(joints.x)]
       + weights.y * jointMatrices[int(joints.y)]
       + weights.z * jointMatrices[int(joints.z)]
       + weights.w * jointMatrices[int(joints.w)];
}
`;

/** Texture unit the bone-texture palette is bound on (maps use 0; shadows 1). */
export const JOINT_TEXTURE_UNIT = 6;

/**
 * The bone-texture variant of {@link SKINNING_GLSL} (decision D7): the palette
 * is an `rgba32float` texture fetched with `texelFetch` at explicit integer
 * coordinates — no sampler state, no filtering, no `textureSize`. Joint `j`,
 * column `c` is texel `4 * j + c` of a row-major, ${"`"}SKIN_PALETTE_TEXTURE_WIDTH${"`"}-wide
 * texture (`skin-palette.ts`), so the four fetches are the uniform palette's
 * four columns. The sampler is `highp` explicitly: a vertex stage defaults to
 * `lowp`, which would quantise the matrices.
 */
export const SKINNING_TEXTURE_GLSL = `layout(location = 4) in vec4 joints;
layout(location = 5) in vec4 weights;
uniform highp sampler2D jointTexture;

mat4 jointMatrix(int joint) {
  int texel = joint * 4;
  int row = texel / ${String(SKIN_PALETTE_TEXTURE_WIDTH)};
  int column = texel - row * ${String(SKIN_PALETTE_TEXTURE_WIDTH)};
  return mat4(
    texelFetch(jointTexture, ivec2(column, row), 0),
    texelFetch(jointTexture, ivec2(column + 1, row), 0),
    texelFetch(jointTexture, ivec2(column + 2, row), 0),
    texelFetch(jointTexture, ivec2(column + 3, row), 0));
}

mat4 skinMatrix() {
  return weights.x * jointMatrix(int(joints.x))
       + weights.y * jointMatrix(int(joints.y))
       + weights.z * jointMatrix(int(joints.z))
       + weights.w * jointMatrix(int(joints.w));
}
`;
