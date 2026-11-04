/**
 * §69's shadow **atlas** on a real WebGL 2 context (W6.3, 2026-11-04).
 *
 * The unit and integration suites drive the GL backend through a recording
 * double, which cannot compile GLSL. This spec is the other half of the claim:
 * the receiver chunk the lit and standard fragment stages splice in
 * (`SHADOW_GLSL`, with `PUNCTUAL_LIGHT_GLSL`) is **imported** from
 * `@fourjs/render-webgl`, never retyped, compiled by a real driver, fed the
 * uniforms `ShadowUniforms.uploadView` uploads (names and layouts verbatim),
 * and read back by threshold — never a golden (§92).
 *
 * Two claims, mirroring `webgpu/webgpu-shadows.spec.ts`:
 *
 * 1. **A cascade is chosen by view depth.** The caster is drawn into atlas tile 1
 *    only. A plane whose view depth falls inside the second split is shadowed at
 *    its centre; the same plane with the splits moved so it selects cascade 0 (an
 *    empty tile) is lit; past the last split it is lit.
 * 2. **A spot light's perspective map darkens what the caster occludes** and
 *    leaves the rest of the lit disc alone.
 *
 * Mechanics are the sibling specs': the page program is a string, the page is
 * served (a `data:` page would have no origin), and the spec skips when the
 * browser offers no WebGL 2.
 */

import { Matrix4 } from "@fourjs/math";
import { writeSpotShadowMatrix } from "@fourjs/render";
import { PUNCTUAL_LIGHT_GLSL, SHADOW_GLSL } from "@fourjs/render-webgl";
import { expect, test } from "@playwright/test";

/** Readback surface edge, in pixels. */
const SIZE = 128;

/** Atlas tile edge, in texels. */
const TILE = 64;

interface Region {
  readonly centre: number;
  readonly edge: number;
}

interface AtlasResult {
  readonly webgl2: boolean;
  readonly error: string | null;
  readonly inSecond: Region;
  readonly inFirst: Region;
  readonly beyond: Region;
  readonly spot: Region;
  readonly spotOpen: Region;
}

const SCRIPT = `(options) => {
  const { size, tile, punctualGlsl, shadowGlsl, spotMatrix } = options;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const gl = canvas.getContext("webgl2");
  if (gl === null) return { webgl2: false };

  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
  };
  const link = (vertex, fragment) => {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    return program;
  };

  const caster = link(
    "#version 300 es\\nlayout(location = 0) in vec3 position;\\nuniform mat4 vp;\\nvoid main() { gl_Position = vp * vec4(position, 1.0); }",
    "#version 300 es\\nprecision highp float;\\nout vec4 c;\\nvoid main() { c = vec4(1.0); }",
  );
  const receiver = link(
    "#version 300 es\\nlayout(location = 0) in vec3 position;\\nout vec3 vWorldPosition;\\nvoid main() { vWorldPosition = position; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    "#version 300 es\\nprecision highp float;\\n"
      + "uniform vec3 ambientLight;\\nuniform vec3 lightDirection;\\nuniform vec3 lightColor;\\n"
      + "in vec3 vWorldPosition;\\nout vec4 fragColor;\\n"
      + punctualGlsl + "\\n" + shadowGlsl + "\\n"
      + "void main() {\\n"
      + "  vec3 n = vec3(0.0, 0.0, 1.0);\\n"
      + "  vec3 direct = lightColor * max(dot(n, -lightDirection), 0.0);\\n"
      + "  if (useShadow) { direct *= shadowFactor(vWorldPosition, n); }\\n"
      + "  vec3 lighting = ambientLight + direct;\\n"
      + "  for (int i = 0; i < punctualCount; i += 1) {\\n"
      + "    vec3 l; vec3 irradiance = punctualIrradiance(i, vWorldPosition, l);\\n"
      + "    if (useShadow) { irradiance *= punctualShadowFactor(i, vWorldPosition, n); }\\n"
      + "    lighting += irradiance * max(dot(n, l), 0.0);\\n"
      + "  }\\n"
      + "  fragColor = vec4(lighting, 1.0);\\n}",
  );

  const quad = (half, z) => new Float32Array([
    -half, -half, z,  half, -half, z,  half, half, z,
    -half, -half, z,  half, half, z,  -half, half, z,
  ]);
  const buffer = gl.createBuffer();
  const draw = (positions) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STREAM_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, positions.length / 3);
  };
  const flipZ = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,-1,0, 0,0,0,1]);

  // An atlas of 'columns' x 1 tiles; casters[i] drawn into tile i, or empty.
  const atlas = (columns, matrices, casters) => {
    const depth = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, depth);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, tile * columns, tile, 0,
      gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) {
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    }
    const color = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, color);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tile * columns, tile, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("shadow framebuffer incomplete");
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.viewport(0, 0, tile * columns, tile);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(caster);
    for (let i = 0; i < columns; i += 1) {
      if (casters[i] === null) continue;
      gl.viewport(i * tile, 0, tile, tile);
      gl.uniformMatrix4fv(gl.getUniformLocation(caster, "vp"), false, matrices[i]);
      draw(casters[i]);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return depth;
  };

  const u = (name) => gl.getUniformLocation(receiver, name);
  const renderPlane = (depth, columns, state) => {
    gl.useProgram(receiver);
    gl.viewport(0, 0, size, size);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depth);
    gl.uniform1i(u("shadowMap"), 1);
    gl.uniform1i(u("useShadow"), 1);
    gl.uniform1i(u("shadowExtended"), 1);
    gl.uniform3f(u("ambientLight"), 0.1, 0.1, 0.1);
    gl.uniform3f(u("lightDirection"), 0, 0, -1);
    gl.uniform3f(u("lightColor"), state.sun, state.sun, state.sun);
    gl.uniform1f(u("shadowBias"), 0.005);
    gl.uniform1f(u("shadowNormalBias"), 0);
    gl.uniform1i(u("shadowCascadeCount"), state.cascades);
    gl.uniformMatrix4fv(u("shadowCascadeMatrix"), false, state.cascadeMatrices);
    gl.uniform4fv(u("shadowCascadeSplits"), state.splits);
    gl.uniform4fv(u("shadowViewDepth"), state.viewDepth);
    gl.uniform4fv(u("shadowAtlas"), new Float32Array([columns, 1, 1 / (tile * columns), 1 / tile]));
    gl.uniform4fv(u("shadowPunctualSlot"), state.slot);
    gl.uniform4fv(u("shadowPunctualParams"), state.params);
    gl.uniform4fv(u("shadowPunctualRange"), state.range);
    gl.uniformMatrix4fv(u("shadowSpotMatrix"), false, state.spotMatrices);
    gl.uniform1i(u("punctualCount"), state.punctualCount);
    gl.uniform3fv(u("punctualPosition"), state.position);
    gl.uniform3fv(u("punctualColor"), state.color);
    gl.uniform3fv(u("punctualDirection"), state.direction);
    gl.uniform4fv(u("punctualParams"), state.punctualParams);
    draw(quad(0.9, 0));
    const pixels = new Uint8Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const mean = (x0, x1, y0, y1) => {
      let sum = 0; let count = 0;
      for (let y = Math.floor(size * y0); y < Math.floor(size * y1); y += 1) {
        for (let x = Math.floor(size * x0); x < Math.floor(size * x1); x += 1) {
          const base = (y * size + x) * 4;
          sum += (pixels[base] + pixels[base + 1] + pixels[base + 2]) / 3;
          count += 1;
        }
      }
      return sum / count;
    };
    return { centre: mean(0.44, 0.56, 0.44, 0.56), edge: mean(0.08, 0.16, 0.08, 0.16) };
  };

  const blank = () => ({
    sun: 0, cascades: 0,
    cascadeMatrices: new Float32Array(64), splits: new Float32Array(4),
    viewDepth: new Float32Array(4), slot: new Float32Array(12),
    params: new Float32Array(16), range: new Float32Array(16),
    spotMatrices: new Float32Array(64), punctualCount: 0,
    position: new Float32Array(33), color: new Float32Array(33),
    direction: new Float32Array(33), punctualParams: new Float32Array(44),
  });

  try {
    const cascadeCase = (splits) => {
      const state = blank();
      state.sun = 0.9;
      state.cascades = 2;
      state.cascadeMatrices.set(flipZ, 0);
      state.cascadeMatrices.set(flipZ, 16);
      state.splits.set(splits);
      state.viewDepth.set([0, 0, -1, 5]);
      const depth = atlas(2, [flipZ, flipZ], [null, quad(0.4, 0.5)]);
      return renderPlane(depth, 2, state);
    };
    const inSecond = cascadeCase([3, 20, 0, 0]);
    const inFirst = cascadeCase([10, 20, 0, 0]);
    const beyond = cascadeCase([2, 4, 0, 0]);

    const spotState = blank();
    spotState.punctualCount = 1;
    spotState.position.set([0, 0, 3]);
    spotState.color.set([9, 9, 9]);
    spotState.direction.set([0, 0, -1]);
    const cosOuter = Math.cos(0.6);
    spotState.punctualParams.set([0, cosOuter, 1 / (1 - cosOuter), 1]);
    spotState.spotMatrices.set(spotMatrix, 0);
    spotState.slot.set([1, 0, 0, 0]);
    spotState.params.set([0, 0.001, 0, 1]);
    spotState.range.set([0.1, 20, 0, 0]);
    const spotM = new Float32Array(spotMatrix);
    const spot = renderPlane(atlas(1, [spotM], [quad(0.3, 1.5)]), 1, spotState);
    const spotOpen = renderPlane(atlas(1, [spotM], [null]), 1, spotState);
    return { webgl2: true, error: null, inSecond, inFirst, beyond, spot, spotOpen };
  } catch (error) {
    return { webgl2: true, error: String(error) };
  }
}`;

test.describe("WebGL shadow atlas, on a real context (§69, W6.3)", () => {
  test("selects a cascade by view depth and shadows through a spot map", async ({
    page,
  }) => {
    await page.goto("/");
    const spotMatrix = Array.from(
      writeSpotShadowMatrix(new Matrix4(), 0, 0, 3, 0, 0, -1, 0.6, 0.1, 20)
        .elements,
    );
    const result = await page.evaluate<AtlasResult>(
      `(${SCRIPT})(${JSON.stringify({
        size: SIZE,
        tile: TILE,
        punctualGlsl: PUNCTUAL_LIGHT_GLSL,
        shadowGlsl: SHADOW_GLSL,
        spotMatrix,
      })})`,
    );
    test.skip(!result.webgl2, "no WebGL 2 context in this browser");

    // A compile or link failure names the GLSL line rather than a black pixel.
    expect(result.error).toBeNull();
    // Cascade 1 holds the caster: view depth 5 inside the second split is
    // shadowed at the centre and lit at the edge.
    expect(result.inSecond.edge).toBeGreaterThan(100);
    expect(result.inSecond.centre).toBeLessThan(result.inSecond.edge * 0.45);
    // Moving the splits so depth 5 selects cascade 0 (an empty tile) lights it:
    // selection really is by view depth.
    expect(result.inFirst.centre).toBeGreaterThan(result.inFirst.edge * 0.9);
    // Beyond the last split the receiver is lit.
    expect(result.beyond.centre).toBeGreaterThan(result.beyond.edge * 0.9);
    // The spot map: the open map lights the centre, the umbra darkens it and
    // leaves the edge alone.
    expect(result.spotOpen.centre).toBeGreaterThan(60);
    expect(result.spot.centre).toBeLessThan(result.spotOpen.centre * 0.5);
    expect(result.spot.edge).toBeGreaterThan(result.spotOpen.edge * 0.8);
  });
});
