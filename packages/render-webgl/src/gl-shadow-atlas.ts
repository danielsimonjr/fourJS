/**
 * The shadow-atlas receiver GLSL (§69, W6.3): cascade selection over the
 * atlas, point-light cube-face lookup and spot-light tiles, each ending in the
 * same nine-tap PCF as the single map. Reached only through
 * {@link registerGlShadowAtlas}; `WebglRenderer` never imports this module
 * (see `gl-shadow-atlas-registry.ts`).
 */

import { SHADOW_CUBE_FACES } from "@fourjs/render";

import { setShadowAtlasGlsl } from "./gl-shadow-atlas-registry.js";

/** A `vec3` literal list of one face axis per cube face, for the shaders. */
function faceTable(axis: "forward" | "up" | "right"): string {
  return SHADOW_CUBE_FACES.map(
    (face) => `vec3(${face[axis].map((v) => v.toFixed(1)).join(", ")})`,
  ).join(", ");
}

const ATLAS_CHUNK = `uniform bool shadowExtended;
uniform int shadowCascadeCount;
uniform mat4 shadowCascadeMatrix[4];
uniform vec4 shadowCascadeSplits;
uniform vec4 shadowViewDepth;
uniform vec4 shadowAtlas;
uniform vec4 shadowPunctualSlot[3];
uniform vec4 shadowPunctualParams[4];
uniform vec4 shadowPunctualRange[4];
uniform mat4 shadowSpotMatrix[4];
const vec3 SHADOW_FACE_FORWARD[6] = vec3[6](${faceTable("forward")});
const vec3 SHADOW_FACE_UP[6] = vec3[6](${faceTable("up")});
const vec3 SHADOW_FACE_RIGHT[6] = vec3[6](${faceTable("right")});

float shadowTileTaps(float tile, vec2 uv, float receiver) {
  float row = floor((tile + 0.5) / shadowAtlas.x);
  float col = tile - row * shadowAtlas.x;
  vec2 grid = shadowAtlas.xy;
  vec2 origin = vec2(col, row) / grid;
  vec2 texel = shadowAtlas.zw;
  vec2 lo = origin + 0.5 * texel;
  vec2 hi = origin + 1.0 / grid - 0.5 * texel;
  vec2 base = origin + uv / grid;
  float lit = 0.0;
  for (int y = -1; y <= 1; y += 1) {
    for (int x = -1; x <= 1; x += 1) {
      vec2 tap = clamp(base + vec2(x, y) * texel, lo, hi);
      float occluder = texture(shadowMap, tap).r;
      lit += receiver <= occluder ? 1.0 : 0.0;
    }
  }
  return lit / 9.0;
}

float shadowReceiverDepth(float z, float near, float far, float bias) {
  float zb = max(z - bias * (far - near), near);
  return far * (zb - near) / ((far - near) * zb);
}

float directionalShadowAtlas(vec3 worldPosition, vec3 n) {
  if (shadowCascadeCount < 1) {
    return 1.0;
  }
  int cascade = 0;
  if (shadowCascadeCount > 1) {
    float depth = dot(shadowViewDepth.xyz, worldPosition) + shadowViewDepth.w;
    cascade = -1;
    for (int i = 0; i < 4; i += 1) {
      if (cascade < 0 && i < shadowCascadeCount && depth <= shadowCascadeSplits[i]) {
        cascade = i;
      }
    }
    if (cascade < 0) {
      return 1.0;
    }
  }
  vec4 lightSpace = shadowCascadeMatrix[cascade] * vec4(worldPosition + n * shadowNormalBias, 1.0);
  vec3 c = (lightSpace.xyz / lightSpace.w) * 0.5 + 0.5;
  if (any(lessThan(c, vec3(0.0))) || any(greaterThan(c, vec3(1.0)))) {
    return 1.0;
  }
  return shadowTileTaps(float(cascade), c.xy, c.z - shadowBias);
}

float punctualShadowFactor(int i, vec3 worldPosition, vec3 n) {
  if (!shadowExtended) {
    return 1.0;
  }
  float entry = shadowPunctualSlot[i / 4][i - (i / 4) * 4];
  if (entry < 0.5) {
    return 1.0;
  }
  int k = int(entry) - 1;
  vec4 params = shadowPunctualParams[k];
  vec4 range = shadowPunctualRange[k];
  vec3 p = worldPosition + n * params.z;
  if (params.w < 1.5) {
    vec4 lightSpace = shadowSpotMatrix[k] * vec4(p, 1.0);
    if (lightSpace.w <= 0.0) {
      return 1.0;
    }
    vec3 c = (lightSpace.xyz / lightSpace.w) * 0.5 + 0.5;
    if (any(lessThan(c, vec3(0.0))) || any(greaterThan(c, vec3(1.0)))) {
      return 1.0;
    }
    return shadowTileTaps(
      params.x, c.xy,
      shadowReceiverDepth(lightSpace.w, range.x, range.y, params.y));
  }
  vec3 d = p - punctualPosition[i];
  vec3 a = abs(d);
  int f;
  if (a.x >= a.y && a.x >= a.z) {
    f = d.x >= 0.0 ? 0 : 1;
  } else if (a.y >= a.z) {
    f = d.y >= 0.0 ? 2 : 3;
  } else {
    f = d.z >= 0.0 ? 4 : 5;
  }
  float vz = dot(d, SHADOW_FACE_FORWARD[f]);
  if (vz <= range.x || vz >= range.y) {
    return 1.0;
  }
  vec2 uv = vec2(dot(d, SHADOW_FACE_RIGHT[f]), dot(d, SHADOW_FACE_UP[f])) / vz * 0.5 + 0.5;
  return shadowTileTaps(
    params.x + float(f), uv,
    shadowReceiverDepth(vz, range.x, range.y, params.y));
}
`;

/**
 * Opts this process's `WebglRenderer`s into the shadow atlas receiver (§69):
 * cascaded directional shadows and point/spot shadow tiles.
 *
 * ```ts
 * import { registerGlShadowAtlas, registerShadowPipeline } from "@fourjs/render-webgl";
 * registerShadowPipeline();
 * registerGlShadowAtlas();      // before the renderer initializes
 * ```
 *
 * Calling it links this module's GLSL into the bundle; a build that never
 * calls it carries none. Idempotent. Without it a light that needs the atlas
 * degrades to the first cascade's single map, with one development warning.
 */
export function registerGlShadowAtlas(): void {
  setShadowAtlasGlsl({
    chunk: ATLAS_CHUNK,
    branch: `if (shadowExtended) {
    return directionalShadowAtlas(worldPosition, n);
  }`,
  });
}
