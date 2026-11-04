/**
 * Vertex shaders for 2..4-target GPU morphing (§54): `p + Σ wᵢ(pᵢ − p)` with
 * the weights in one `vec4`. Reached only through {@link registerGlMorphTargets};
 * see `gl-morph-registry.ts`.
 */

import { morphNormalLocation, morphPositionLocation } from "./gl-program.js";
import { setMorphSources } from "./gl-morph-registry.js";

/** Σ wᵢ(pᵢ − p) expression, weights in `morphWeights.{x,y,z,w}`. */
function morphSum(name: string, base: string, count: number): string {
  const lanes = "xyzw";
  let expr = base;
  for (let k = 1; k <= count; k += 1) {
    expr += ` + morphWeights.${lanes[k - 1]} * (${name}${String(k)} - ${base})`;
  }
  return expr;
}

/** N-target (2..4) unlit morph vertex shader. */
function morphVertexSource(count: number): string {
  let attrs = "";
  for (let k = 1; k <= count; k += 1) {
    attrs += `layout(location = ${String(morphPositionLocation(k))}) in vec3 position${String(k)};\n`;
  }
  return `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 2) in vec2 uv;
layout(location = 3) in vec4 vertexColor;
${attrs}
uniform mat4 viewProjection;
uniform mat4 model;
uniform vec4 morphWeights;

out vec2 vUv;
out vec4 vColor;

void main() {
  vUv = uv;
  vColor = vertexColor;
  vec3 p = ${morphSum("position", "position", count)};
  gl_Position = viewProjection * model * vec4(p, 1.0);
}
`;
}

/** N-target (2..4) lit morph vertex shader. */
function morphLitVertexSource(count: number): string {
  let attrs = "";
  for (let k = 1; k <= count; k += 1) {
    attrs += `layout(location = ${String(morphPositionLocation(k))}) in vec3 position${String(k)};\n`;
    attrs += `layout(location = ${String(morphNormalLocation(k))}) in vec3 normal${String(k)};\n`;
  }
  return `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in vec2 uv;
${attrs}
uniform mat4 viewProjection;
uniform mat4 model;
uniform mat3 normalMatrix;
uniform vec4 morphWeights;

out vec3 vNormal;
out vec3 vWorldPosition;
out vec2 vUv;

void main() {
  vec3 p = ${morphSum("position", "position", count)};
  vec3 n = ${morphSum("normal", "normal", count)};
  vNormal = normalMatrix * n;
  vWorldPosition = (model * vec4(p, 1.0)).xyz;
  vUv = uv;
  gl_Position = viewProjection * model * vec4(p, 1.0);
}
`;
}

/**
 * Opts this process's `WebglRenderer`s into 2..4-target morphing. Idempotent;
 * without it a geometry's extra targets are ignored with one development
 * warning and the first target morphs as before.
 */
export function registerGlMorphTargets(): void {
  setMorphSources({ unlit: morphVertexSource, lit: morphLitVertexSource });
}
