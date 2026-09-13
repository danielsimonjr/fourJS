/**
 * The skinned pipelines (§54, §62; RFC 0003 — gaps PH-10 + R-22, 2026-08-28):
 * a skinned variant of the unlit and of the lit program, reached only through
 * {@link registerSkinningPipeline}.
 *
 * ## Skinning is a separate program, not a uniform switch (RFC 0003 §5)
 *
 * R-19's recorded rule — *textured meshes are a uniform switch, not shader
 * variants* — works because `useMap`/`useVertexColors` are **fragment**-stage
 * branches over data already bound. A `useSkinning` uniform would add four
 * joint fetches, four weight fetches, four `mat4` reads, and a weighted sum to
 * the **vertex stage of every draw in the scene**, taxing the unskinned 99% to
 * serve the skinned 1% in the stage where per-vertex cost accumulates. So the
 * skinned draws compile their own programs, and byte-identity for skinless
 * scenes is preserved the lazy way instead:
 *
 * - **nothing here is reachable from `WebglRenderer`** — the renderer imports
 *   only the registry slot (`gl-skinning-registry.ts`), and this module links
 *   into a bundle only when the application calls
 *   {@link registerSkinningPipeline} (the pipeline-cost law's registration
 *   seam, fourth application);
 * - **programs compile on the first skinned draw, never at initialize**, so a
 *   scene with no skinned mesh issues the byte-identical GL sequence R-19
 *   landed under and F13 re-proved — asserted by transcript comparison in
 *   `tests/integration/skinning.test.ts`;
 * - a compile failure inside the frame is caught by the renderer (§61 forbids
 *   throwing there), warned once, and skinning is off for that context.
 *
 * ## The palette, and the declared joint limit
 *
 * The palette is `uniform mat4 jointMatrices[MAX_SKINNING_JOINTS]` — 48
 * joints, `@fourjs/render`'s declared constant, sized to fit WebGL 2's
 * guaranteed-minimum vertex uniform budget (see `MAX_SKINNING_JOINTS` for the
 * arithmetic). A rig over the limit was already refused **at setup** by
 * `Mesh.skeleton` (§89 `UNSUPPORTED_GPU_FEATURE`), so the upload here can
 * assume its bound. Joint indices arrive as non-normalized `UNSIGNED_SHORT`
 * floats at location 4 and weights at location 5 (`gl-geometry.ts`), indexed
 * with `int(...)` — exact for every index a `Uint16Array` carries.
 *
 * Weights are used as authored — not renormalized — matching
 * `BufferGeometry.weights`' contract that a per-vertex sum of 1 is the
 * author's promise, and keeping the deformation an exact function of the
 * authored data.
 *
 * ## Determinism (§33, RFC 0003 §6)
 *
 * This is the boundary where skeletal animation (deterministic, CPU, inside
 * the §33 envelope) hands over to vertex deformation (GPU, outside it by
 * construction). The palette goes up; nothing comes back — no readback, no
 * skinned bounds, no engine API returning skinned positions.
 */

import type { Disposable } from "@fourjs/core";
import type { Matrix4 } from "@fourjs/math";
import type { SceneLights } from "@fourjs/render";

import { SKINNING_GLSL } from "./gl-skinning-glsl.js";

export { SKINNING_GLSL };

import {
  FRAGMENT_SHADER_SOURCE,
  LIT_FRAGMENT_SHADER_SOURCE,
  MAP_TEXTURE_UNIT,
  HemisphereLightUniforms,
  PunctualLightUniforms,
  ShadowUniforms,
  createLinkedProgram,
  matrixScratch,
  requireUniform,
  type GlProgramHandle,
  type GlUniformLocation,
  type WebglContext,
} from "./gl-program.js";
import {
  setSkinningPipelineFactory,
  type SkinnedLitPipeline,
  type SkinnedPrograms,
  type SkinnedShadowPipeline,
  type SkinnedUnlitPipeline,
} from "./gl-skinning-registry.js";

/**
 * The skinned unlit vertex stage: `gl-program.ts`'s unlit stage with the
 * position run through the skin matrix first. The fragment stage is the unlit
 * one, verbatim — same source string, so the two cannot drift.
 */
const SKINNED_VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 2) in vec2 uv;
layout(location = 3) in vec4 vertexColor;
${SKINNING_GLSL}
uniform mat4 viewProjection;
uniform mat4 model;

out vec2 vUv;
out vec4 vColor;

void main() {
  vUv = uv;
  vColor = vertexColor;
  gl_Position = viewProjection * model * (skinMatrix() * vec4(position, 1.0));
}
`;

/**
 * The skinned lit vertex stage: `gl-program.ts`'s lit stage with the model
 * matrix composed with the skin matrix — the normal's inverse-transpose is
 * taken of the *composed* matrix, so a bone that rotates or non-uniformly
 * scales its verts bends their normals with them. The fragment stage is the
 * lit one, verbatim.
 */
const SKINNED_LIT_VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in vec2 uv;
${SKINNING_GLSL}
uniform mat4 viewProjection;
uniform mat4 model;

out vec3 vNormal;
out vec3 vWorldPosition;
out vec2 vUv;

void main() {
  mat4 skinned = model * skinMatrix();
  vNormal = transpose(inverse(mat3(skinned))) * normal;
  vec4 worldPosition = skinned * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vUv = uv;
  gl_Position = viewProjection * worldPosition;
}
`;

/** Scratch for colour uploads; `gl-program.ts`'s `matrixScratch` argument. */
const colorScratch = new Float32Array(4);

/** Scratch for the lit pipeline's `vec3` uploads. */
const vec3Scratch = new Float32Array(3);

/**
 * The palette upload both programs share: `uniformMatrix4fv` straight from the
 * skeleton's own `Float32Array` — no copy, no scratch, and uploading fewer
 * matrices than the declared `MAX_SKINNING_JOINTS` writes the palette's own
 * length and leaves the dead tail untouched, which is legal GL and exactly
 * what a 3-bone rig wants.
 */
function uploadPalette(
  gl: WebglContext,
  location: GlUniformLocation,
  palette: Float32Array,
): void {
  gl.uniformMatrix4fv(location, false, palette);
}

/**
 * The skinned flat-colour pipeline (§54, §57; RFC 0003) — `UnlitProgram`'s
 * contract plus {@link SkinnedUnlitProgram.setJointMatrices}. See that class
 * for every inherited rule (mirror-at-GL-initial features, lazy sampler,
 * dispose-on-live-context-only); only what skinning adds is documented here.
 */
export class SkinnedUnlitProgram implements SkinnedUnlitPipeline, Disposable {
  readonly #gl: WebglContext;

  readonly #program: GlProgramHandle;

  readonly #viewProjectionLocation: GlUniformLocation;

  readonly #modelLocation: GlUniformLocation;

  readonly #colorLocation: GlUniformLocation;

  readonly #mapLocation: GlUniformLocation;

  readonly #useMapLocation: GlUniformLocation;

  readonly #useVertexColorsLocation: GlUniformLocation;

  readonly #jointMatricesLocation: GlUniformLocation;

  /** CPU mirror of the feature uniforms, at GL's initial `0` — see `UnlitProgram`. */
  #useMap = false;

  #useVertexColors = false;

  #samplerUploaded = false;

  #disposed = false;

  /**
   * CPU mirror of the last colour this program uploaded (audit A5,
   * 2026-09-11) — four numbers plus a validity bit. A draw whose colour and
   * opacity resolve to the four values already in the program object uploads
   * nothing: with N items sharing one material that is one `uniform4fv` per
   * program per frame instead of N. Invalidated by {@link use}, so a switch
   * away and back re-uploads (uniform values do survive a switch, but the
   * mirror does not claim to know what ran in between); a context restore
   * builds a new program and therefore a fresh mirror.
   *
   * Plain doubles, **not** a `Float32Array`: the comparison is against the
   * material's own doubles, and a float32 mirror rounds `0.2` to
   * `0.2000000029…` and never matches — the skip silently never fires for
   * any colour that is not float32-exact (found on the render-batching
   * benchmark scene: 5 000 shapes over one `[0.2, 0.6, 1, 1]` material still
   * uploaded 5 000 times). The scratch `Float32Array` is filled from the
   * mirror for the upload itself.
   */
  readonly #colorMirror: [number, number, number, number] = [0, 0, 0, 0];

  #colorMirrorValid = false;

  private constructor(gl: WebglContext, program: GlProgramHandle) {
    this.#gl = gl;
    this.#program = program;
    this.#viewProjectionLocation = requireUniform(
      gl,
      program,
      "viewProjection",
      "skinned-unlit",
    );
    this.#modelLocation = requireUniform(gl, program, "model", "skinned-unlit");
    this.#colorLocation = requireUniform(gl, program, "color", "skinned-unlit");
    this.#mapLocation = requireUniform(gl, program, "map", "skinned-unlit");
    this.#useMapLocation = requireUniform(
      gl,
      program,
      "useMap",
      "skinned-unlit",
    );
    this.#useVertexColorsLocation = requireUniform(
      gl,
      program,
      "useVertexColors",
      "skinned-unlit",
    );
    this.#jointMatricesLocation = requireUniform(
      gl,
      program,
      "jointMatrices[0]",
      "skinned-unlit",
    );
  }

  /** Compiles and links the program — `UnlitProgram.create`'s contract (§89). */
  static create(gl: WebglContext): SkinnedUnlitProgram {
    const program = createLinkedProgram(
      gl,
      "skinned-unlit",
      SKINNED_VERTEX_SHADER_SOURCE,
      FRAGMENT_SHADER_SOURCE,
    );
    try {
      return new SkinnedUnlitProgram(gl, program);
    } catch (error: unknown) {
      gl.deleteProgram(program);
      throw error;
    }
  }

  /** Whether {@link SkinnedUnlitProgram.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  use(): void {
    this.#gl.useProgram(this.#program);
    this.#colorMirrorValid = false;
  }

  setViewProjection(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(
      this.#viewProjectionLocation,
      false,
      matrixScratch,
    );
  }

  setModel(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#modelLocation, false, matrixScratch);
  }

  setColor(
    color: readonly [number, number, number, number],
    opacity = 1,
  ): void {
    const alpha = color[3] * opacity;
    const mirror = this.#colorMirror;
    if (
      this.#colorMirrorValid &&
      mirror[0] === color[0] &&
      mirror[1] === color[1] &&
      mirror[2] === color[2] &&
      mirror[3] === alpha
    ) {
      return;
    }
    mirror[0] = color[0];
    mirror[1] = color[1];
    mirror[2] = color[2];
    mirror[3] = alpha;
    this.#colorMirrorValid = true;
    colorScratch[0] = mirror[0];
    colorScratch[1] = mirror[1];
    colorScratch[2] = mirror[2];
    colorScratch[3] = mirror[3];
    this.#gl.uniform4fv(this.#colorLocation, colorScratch);
  }

  setFeatures(useMap: boolean, useVertexColors: boolean): void {
    if (useMap !== this.#useMap) {
      if (useMap && !this.#samplerUploaded) {
        this.#gl.uniform1i(this.#mapLocation, MAP_TEXTURE_UNIT);
        this.#samplerUploaded = true;
      }
      this.#gl.uniform1i(this.#useMapLocation, useMap ? 1 : 0);
      this.#useMap = useMap;
    }
    if (useVertexColors !== this.#useVertexColors) {
      this.#gl.uniform1i(
        this.#useVertexColorsLocation,
        useVertexColors ? 1 : 0,
      );
      this.#useVertexColors = useVertexColors;
    }
  }

  /**
   * Uploads the draw's joint palette (§54). Unconditional — a palette changes
   * per skeleton per frame, so there is nothing to mirror.
   */
  setJointMatrices(palette: Float32Array): void {
    uploadPalette(this.#gl, this.#jointMatricesLocation, palette);
  }

  /** Deletes the GL program (§83). Idempotent; live context only. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#gl.deleteProgram(this.#program);
  }
}

/**
 * The skinned Lambert-lit pipeline (§54, §57, §68; RFC 0003) — `LitProgram`'s
 * contract plus the palette. Lights, punctual set, and §69 shadow state are
 * the same shared uniform classes the lit and standard pipelines use, so the
 * skip rules cannot drift.
 */
export class SkinnedLitProgram implements SkinnedLitPipeline, Disposable {
  readonly #gl: WebglContext;

  readonly #program: GlProgramHandle;

  readonly #viewProjectionLocation: GlUniformLocation;

  readonly #modelLocation: GlUniformLocation;

  readonly #colorLocation: GlUniformLocation;

  readonly #ambientLightLocation: GlUniformLocation;

  readonly #lightDirectionLocation: GlUniformLocation;

  readonly #lightColorLocation: GlUniformLocation;

  readonly #mapLocation: GlUniformLocation;

  readonly #useMapLocation: GlUniformLocation;

  readonly #jointMatricesLocation: GlUniformLocation;

  readonly #punctual: PunctualLightUniforms;

  readonly #hemisphere: HemisphereLightUniforms;

  readonly #shadow: ShadowUniforms;

  #useMap = false;

  #samplerUploaded = false;

  #disposed = false;

  /**
   * CPU mirror of the last colour this program uploaded (audit A5,
   * 2026-09-11) — four numbers plus a validity bit. A draw whose colour and
   * opacity resolve to the four values already in the program object uploads
   * nothing: with N items sharing one material that is one `uniform4fv` per
   * program per frame instead of N. Invalidated by {@link use}, so a switch
   * away and back re-uploads (uniform values do survive a switch, but the
   * mirror does not claim to know what ran in between); a context restore
   * builds a new program and therefore a fresh mirror.
   *
   * Plain doubles, **not** a `Float32Array`: the comparison is against the
   * material's own doubles, and a float32 mirror rounds `0.2` to
   * `0.2000000029…` and never matches — the skip silently never fires for
   * any colour that is not float32-exact (found on the render-batching
   * benchmark scene: 5 000 shapes over one `[0.2, 0.6, 1, 1]` material still
   * uploaded 5 000 times). The scratch `Float32Array` is filled from the
   * mirror for the upload itself.
   */
  readonly #colorMirror: [number, number, number, number] = [0, 0, 0, 0];

  #colorMirrorValid = false;

  private constructor(gl: WebglContext, program: GlProgramHandle) {
    this.#gl = gl;
    this.#program = program;
    this.#viewProjectionLocation = requireUniform(
      gl,
      program,
      "viewProjection",
      "skinned-lit",
    );
    this.#modelLocation = requireUniform(gl, program, "model", "skinned-lit");
    this.#colorLocation = requireUniform(gl, program, "color", "skinned-lit");
    this.#ambientLightLocation = requireUniform(
      gl,
      program,
      "ambientLight",
      "skinned-lit",
    );
    this.#lightDirectionLocation = requireUniform(
      gl,
      program,
      "lightDirection",
      "skinned-lit",
    );
    this.#lightColorLocation = requireUniform(
      gl,
      program,
      "lightColor",
      "skinned-lit",
    );
    this.#mapLocation = requireUniform(gl, program, "map", "skinned-lit");
    this.#useMapLocation = requireUniform(gl, program, "useMap", "skinned-lit");
    this.#jointMatricesLocation = requireUniform(
      gl,
      program,
      "jointMatrices[0]",
      "skinned-lit",
    );
    this.#punctual = PunctualLightUniforms.resolve(gl, program, "skinned-lit");
    this.#hemisphere = HemisphereLightUniforms.resolve(
      gl,
      program,
      "skinned-lit",
    );
    this.#shadow = ShadowUniforms.resolve(gl, program, "skinned-lit");
  }

  /** Compiles and links the program — `LitProgram.create`'s contract (§89). */
  static create(gl: WebglContext): SkinnedLitProgram {
    const program = createLinkedProgram(
      gl,
      "skinned-lit",
      SKINNED_LIT_VERTEX_SHADER_SOURCE,
      LIT_FRAGMENT_SHADER_SOURCE,
    );
    try {
      return new SkinnedLitProgram(gl, program);
    } catch (error: unknown) {
      gl.deleteProgram(program);
      throw error;
    }
  }

  /** Whether {@link SkinnedLitProgram.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  use(): void {
    this.#gl.useProgram(this.#program);
    this.#colorMirrorValid = false;
  }

  setViewProjection(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(
      this.#viewProjectionLocation,
      false,
      matrixScratch,
    );
  }

  setModel(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#modelLocation, false, matrixScratch);
  }

  setColor(
    color: readonly [number, number, number, number],
    opacity = 1,
  ): void {
    const alpha = color[3] * opacity;
    const mirror = this.#colorMirror;
    if (
      this.#colorMirrorValid &&
      mirror[0] === color[0] &&
      mirror[1] === color[1] &&
      mirror[2] === color[2] &&
      mirror[3] === alpha
    ) {
      return;
    }
    mirror[0] = color[0];
    mirror[1] = color[1];
    mirror[2] = color[2];
    mirror[3] = alpha;
    this.#colorMirrorValid = true;
    colorScratch[0] = mirror[0];
    colorScratch[1] = mirror[1];
    colorScratch[2] = mirror[2];
    colorScratch[3] = mirror[3];
    this.#gl.uniform4fv(this.#colorLocation, colorScratch);
  }

  setAmbientLight(color: readonly [number, number, number]): void {
    vec3Scratch[0] = color[0];
    vec3Scratch[1] = color[1];
    vec3Scratch[2] = color[2];
    this.#gl.uniform3fv(this.#ambientLightLocation, vec3Scratch);
  }

  setDirectionalLight(
    direction: { readonly x: number; readonly y: number; readonly z: number },
    color: readonly [number, number, number],
  ): void {
    vec3Scratch[0] = direction.x;
    vec3Scratch[1] = direction.y;
    vec3Scratch[2] = direction.z;
    this.#gl.uniform3fv(this.#lightDirectionLocation, vec3Scratch);
    vec3Scratch[0] = color[0];
    vec3Scratch[1] = color[1];
    vec3Scratch[2] = color[2];
    this.#gl.uniform3fv(this.#lightColorLocation, vec3Scratch);
  }

  setPunctualLights(lights: SceneLights): void {
    this.#punctual.upload(lights);
  }

  setHemisphereLight(lights: SceneLights): void {
    this.#hemisphere.upload(lights);
  }

  setShadow(lights: SceneLights): void {
    this.#shadow.uploadView(lights);
  }

  setReceivesShadow(receiving: boolean): void {
    this.#shadow.setReceiving(receiving);
  }

  setFeatures(useMap: boolean): void {
    if (useMap === this.#useMap) {
      return;
    }
    if (useMap && !this.#samplerUploaded) {
      this.#gl.uniform1i(this.#mapLocation, MAP_TEXTURE_UNIT);
      this.#samplerUploaded = true;
    }
    this.#gl.uniform1i(this.#useMapLocation, useMap ? 1 : 0);
    this.#useMap = useMap;
  }

  setJointMatrices(palette: Float32Array): void {
    uploadPalette(this.#gl, this.#jointMatricesLocation, palette);
  }

  /** Deletes the GL program (§83). Idempotent; live context only. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#gl.deleteProgram(this.#program);
  }
}

/**
 * The skinned caster vertex stage: `gl-shadow.ts`'s depth-only product with
 * the position run through the skin matrix first, so a `castShadow` skinned
 * mesh writes its **deformed** silhouette rather than the bind pose.
 *
 * The fragment stage is the shadow program's constant, copied rather than
 * imported — `gl-shadow.ts` must not name this module (pipeline-cost law),
 * and this module must not name `gl-shadow.ts` (no cycle).
 */
const SKINNED_SHADOW_VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec3 position;
${SKINNING_GLSL}
uniform mat4 shadowViewProjection;
uniform mat4 model;

void main() {
  gl_Position = shadowViewProjection * model * (skinMatrix() * vec4(position, 1.0));
}
`;

/** Copied from `gl-shadow.ts` — see {@link SKINNED_SHADOW_VERTEX_SHADER_SOURCE}. */
const SKINNED_SHADOW_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

out vec4 fragColor;

void main() {
  fragColor = vec4(1.0);
}
`;

/**
 * The depth-only skinned caster pipeline (§69, RFC 0003 residue) —
 * `ShadowProgram`'s contract plus {@link SkinnedShadowProgram.setJointMatrices}.
 *
 * Compiled lazily on the first skinned caster, never with the colour pair
 * and never at initialize: a skinned mesh that does not cast must not add a
 * third `createProgram`.
 */
export class SkinnedShadowProgram implements SkinnedShadowPipeline, Disposable {
  readonly #gl: WebglContext;

  readonly #program: GlProgramHandle;

  readonly #viewProjectionLocation: GlUniformLocation;

  readonly #modelLocation: GlUniformLocation;

  readonly #jointMatricesLocation: GlUniformLocation;

  #disposed = false;

  private constructor(
    gl: WebglContext,
    program: GlProgramHandle,
    viewProjectionLocation: GlUniformLocation,
    modelLocation: GlUniformLocation,
    jointMatricesLocation: GlUniformLocation,
  ) {
    this.#gl = gl;
    this.#program = program;
    this.#viewProjectionLocation = viewProjectionLocation;
    this.#modelLocation = modelLocation;
    this.#jointMatricesLocation = jointMatricesLocation;
  }

  /**
   * Compiles and links the skinned caster on `gl`.
   *
   * Fails exactly as `ShadowProgram.create` does — the messages name
   * `"skinned-shadow"` and the §89 code is the same.
   */
  static create(gl: WebglContext): SkinnedShadowProgram {
    const program = createLinkedProgram(
      gl,
      "skinned-shadow",
      SKINNED_SHADOW_VERTEX_SHADER_SOURCE,
      SKINNED_SHADOW_FRAGMENT_SHADER_SOURCE,
    );
    try {
      return new SkinnedShadowProgram(
        gl,
        program,
        requireUniform(gl, program, "shadowViewProjection", "skinned-shadow"),
        requireUniform(gl, program, "model", "skinned-shadow"),
        requireUniform(gl, program, "jointMatrices[0]", "skinned-shadow"),
      );
    } catch (error: unknown) {
      gl.deleteProgram(program);
      throw error;
    }
  }

  /** Whether {@link SkinnedShadowProgram.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  use(): void {
    this.#gl.useProgram(this.#program);
  }

  setViewProjection(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(
      this.#viewProjectionLocation,
      false,
      matrixScratch,
    );
  }

  setModel(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#modelLocation, false, matrixScratch);
  }

  setJointMatrices(palette: Float32Array): void {
    uploadPalette(this.#gl, this.#jointMatricesLocation, palette);
  }

  /** Deletes the GL program (§83). Idempotent; live context only. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#gl.deleteProgram(this.#program);
  }
}

/**
 * Both skinned colour programs for one context, with the paired disposal the
 * renderer's `dispose()` calls (§83). The caster is compiled on
 * {@link SkinnedProgramPair.acquireShadow}, not here.
 */
class SkinnedProgramPair implements SkinnedPrograms {
  readonly unlit: SkinnedUnlitProgram;

  readonly lit: SkinnedLitProgram;

  readonly #gl: WebglContext;

  #shadow: SkinnedShadowProgram | null = null;

  #shadowFailed = false;

  constructor(gl: WebglContext) {
    this.#gl = gl;
    const unlit = SkinnedUnlitProgram.create(gl);
    try {
      this.lit = SkinnedLitProgram.create(gl);
    } catch (error: unknown) {
      unlit.dispose();
      throw error;
    }
    this.unlit = unlit;
  }

  acquireShadow(): SkinnedShadowPipeline {
    const existing = this.#shadow;
    if (existing !== null) {
      return existing;
    }
    // A refusing driver must not be asked again: `createProgram` indices
    // advance, so a `failProgramAt` latch would succeed on the retry and
    // silently ship a program the first attempt established as unusable.
    if (this.#shadowFailed) {
      throw new Error("skinned-shadow previously failed to compile");
    }
    try {
      const compiled = SkinnedShadowProgram.create(this.#gl);
      this.#shadow = compiled;
      return compiled;
    } catch (error: unknown) {
      this.#shadowFailed = true;
      throw error;
    }
  }

  dispose(): void {
    this.unlit.dispose();
    this.lit.dispose();
    this.#shadow?.dispose();
  }
}

/**
 * Opts this process's `WebglRenderer`s into GPU skinning (§54, §62; RFC 0003).
 *
 * ```ts
 * import { registerSkinningPipeline } from "@fourjs/render-webgl";
 * registerSkinningPipeline();          // once, at application setup
 * ```
 *
 * Calling it is what links this module — the two skinned colour programs, the
 * lazy caster, and their GLSL — into the bundle; a build that never calls it
 * carries none of it (grep-proven in the packet's A/B). The colour pair still
 * compiles **lazily, on each renderer's first skinned colour draw**, and the
 * caster on the first skinned caster, never here and never at renderer
 * initialize, so registration alone changes no GL transcript. Idempotent;
 * calling it twice re-installs the same factory.
 */
export function registerSkinningPipeline(): void {
  setSkinningPipelineFactory({
    create(gl: WebglContext): SkinnedPrograms {
      return new SkinnedProgramPair(gl);
    },
  });
}
