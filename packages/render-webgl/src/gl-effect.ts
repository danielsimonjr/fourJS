/**
 * The full-screen effect pipeline for the WebGL 2 backend — §70's blit, colour
 * grade and §60a output transform, one program (R-6, 2026-08-07; R-15,
 * 2026-08-08).
 *
 * The fifth and smallest of this backend's pipelines, and the only one that
 * draws **no geometry**: a full-screen triangle generated from `gl_VertexID`
 * with no vertex buffer, no vertex array, and no attributes at all. What it
 * samples is a render target's colour attachment, which `gl-render-target.ts`
 * already allocates and caches; what it writes is another target, or the
 * drawing buffer. `@fourjs/render`'s `effect-pass.ts` owns the *policy* — which
 * of §70's ten effects this tier ships, and what each staged one is waiting on
 * — and this module owns the GL.
 *
 * ```ts
 * const program = EffectProgram.create(gl);
 * program.use();
 * program.setSampler(EFFECT_TEXTURE_UNIT);   // once per program lifetime
 * program.setGrade(1.2, 1, 0.8);             // or setCopy() / setOutputTransform()
 * gl.drawArrays(GL.TRIANGLES, 0, EFFECT_VERTEX_COUNT);
 * ```
 *
 * ## Why a triangle and not a quad
 *
 * A single oversized triangle covers the viewport with no diagonal seam, no
 * index buffer, and no vertex data — the standard full-screen idiom. Deriving
 * its three corners from `gl_VertexID` rather than from a buffer is what keeps
 * this pipeline's cost at *one program*: no geometry to allocate, nothing to
 * evict on context loss beyond the program itself, and no interaction with
 * `gl-geometry.ts`'s vertex-array cache — so an application that never runs an
 * effect pays for this file exactly one compiled program at initialization and
 * not a byte of per-frame work.
 *
 * ## One program, one uniform switch (the R-19 argument, applied again)
 *
 * `useGrade` is a **uniform, not a `#define`d variant**, for the reason
 * `gl-program.ts`'s `FRAGMENT_SHADER_SOURCE` gives in full: a variant set means
 * another program compiled at initialization for every effect, or a lazy
 * compile inside a frame, which §61 forbids throwing from. And it buys the
 * property that matters here — the mirror starts at GL's own initial `0`, so a
 * **copy uploads nothing at all** beyond the one-time sampler, and with
 * `useGrade` off the fragment stage assigns the sampled texel to the output
 * with no arithmetic in between. That is what makes {@link CopyEffect} the
 * bit-exact blit its documentation promises.
 */

import type { Disposable } from "@fourjs/core";

import {
  createLinkedProgram,
  requireUniform,
  type GlProgramHandle,
  type GlUniformLocation,
  type WebglContext,
} from "./gl-program.js";
import {
  EFFECT_TEXTURE_UNIT,
  EFFECT_VERTEX_COUNT,
  setEffectPipelineFactory,
} from "./gl-effect-registry.js";

// `EFFECT_TEXTURE_UNIT` and `EFFECT_VERTEX_COUNT` moved to the registry module
// on 2026-09-11 so `renderEffect` can read them without linking this module;
// re-exported here so every existing import keeps resolving.
export { EFFECT_TEXTURE_UNIT, EFFECT_VERTEX_COUNT };

/**
 * The full-screen-triangle vertex stage: three clip-space corners and their uv,
 * from `gl_VertexID` alone.
 *
 * ```text
 * id 0 -> uv (0, 0) -> clip (-1, -1)
 * id 1 -> uv (2, 0) -> clip ( 3, -1)
 * id 2 -> uv (0, 2) -> clip (-1,  3)
 * ```
 *
 * The triangle overhangs the viewport on two sides; the visible part of it is
 * the whole surface, with uv running `0..1` across exactly that part. `v = 0`
 * is the **bottom** edge — matching §7a's Y-up world, the sprite pipeline's
 * uv derivation, and the bottom-row-first texel order a render target's colour
 * attachment is allocated in — so a copy needs no flip anywhere and is an exact
 * identity rather than a mirror image.
 */
const EFFECT_VERTEX_SHADER_SOURCE = `#version 300 es
out vec2 vUv;

void main() {
  vUv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(vUv * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * The effect fragment stage: one texture sample, optionally graded (§70) and
 * optionally encoded (§60a).
 *
 * With both switches off, `fragColor` is the sampled texel with nothing done to
 * it — the bit-exact copy §70's blit and §63's on-screen debug view both need.
 *
 * With `useGrade` on, the three operations run in the order `ColorGradeEffect`
 * documents (exposure, then contrast about a linear `0.5` pivot, then
 * saturation towards the Rec. 709 linear luma), on straight, linear-light RGB
 * (§60a), and **alpha is carried through untouched** so an effect over a
 * transparent background composites afterwards exactly as its source would
 * have.
 *
 * With `useEncode` on, the linear-light RGB is encoded as sRGB — §60a's output
 * transform, and the same curve `@fourjs/math`'s `linearToSrgb` computes on the
 * CPU: the piecewise IEC 61966-2-1 function (`m * 12.92` below the `0.0031308`
 * breakpoint, `1.055 · m^(1/2.4) − 0.055` above it), **odd-extended below zero**
 * by taking the magnitude and restoring the sign, so a negative texel is not
 * fed to a `pow` of a negative base — undefined in GLSL, `NaN` in practice —
 * and an extended-range value survives rather than clamping.
 * **Alpha is not encoded** — a coverage fraction is not a light quantity — and
 * the two switches are independent: a grade *then* an encode is one pass, and
 * it is the order §60a asks for (operate in linear, encode last). Written
 * inline rather than as a `linearToSrgb` helper because this string ships in
 * every bundle that initializes this backend, and §86's `ui-demo` budget is
 * measured to the byte (R-15, 2026-08-08).
 *
 * The switches are separate `bool` uniforms rather than one `int` mode for the
 * mirror argument below: each starts at GL's own initial `false`, so a pipeline
 * that only ever copies uploads neither, and adding the second changed no call
 * any existing frame issues.
 *
 * Nothing is clamped here: `rgba8` saturates on write, and the float targets
 * R-4 staged will not — clamping in the shader would silently make the two
 * behave the same and hide the difference the format was chosen for.
 */
const EFFECT_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D source;
uniform bool useGrade;
uniform vec3 grade;
uniform bool useEncode;

in vec2 vUv;

out vec4 fragColor;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

void main() {
  vec4 texel = texture(source, vUv);
  if (useGrade) {
    vec3 color = texel.rgb * grade.x;
    color = (color - 0.5) * grade.y + 0.5;
    color = mix(vec3(dot(color, LUMA)), color, grade.z);
    texel = vec4(color, texel.a);
  }
  if (useEncode) {
    vec3 m = abs(texel.rgb);
    vec3 high = 1.055 * pow(m, vec3(1.0 / 2.4)) - 0.055;
    texel = vec4(sign(texel.rgb) * mix(high, m * 12.92, step(m, vec3(0.0031308))), texel.a);
  }
  fragColor = texel;
}
`;

/** Scratch for the `grade` upload; one per module, exactly like `matrixScratch`. */
const gradeScratch = new Float32Array(3);

/**
 * §70's full-screen effect pipeline (R-6) — see the module header.
 *
 * Owns its GL program and nothing else: the texture it samples belongs to
 * `gl-render-target.ts`'s cache. Since 2026-09-11 it compiles **lazily**, on
 * the renderer's first fixed effect pass, and only once
 * {@link registerEffectPipeline} has been called — the renderer drops it on
 * context loss and re-acquires it on the next effect (§61), exactly as it
 * handles the skinned pair.
 */
export class EffectProgram implements Disposable {
  readonly #gl: WebglContext;

  readonly #program: GlProgramHandle;

  readonly #sourceLocation: GlUniformLocation;

  readonly #useGradeLocation: GlUniformLocation;

  readonly #gradeLocation: GlUniformLocation;

  readonly #useEncodeLocation: GlUniformLocation;

  /**
   * CPU mirror of the grade switch and its coefficients, seeded with GL's own
   * initial values for a `bool` and a `vec3` uniform — `false` and
   * `(0, 0, 0)`. Because the mirror starts where GL starts, a chain of copies
   * issues no `uniform` call at all, and a steady-state graded chain issues one
   * per program lifetime rather than one per frame.
   *
   * Uniform values live in the program object, so the mirror stays accurate
   * across pipeline switches and frames; a context loss builds a new program
   * and therefore a new mirror.
   */
  #useGrade = false;

  readonly #grade = new Float32Array(3);

  /**
   * CPU mirror of §60a's encode switch, seeded with GL's initial `false` for
   * the same reason {@link EffectProgram} seeds the grade switch: a chain that
   * never encodes never uploads it, which is what let R-15 add a second switch
   * to this program without changing one GL call any existing frame issues.
   */
  #useEncode = false;

  /** Whether the sampler unit has been uploaded — see {@link setSampler}. */
  #samplerUploaded = false;

  #disposed = false;

  private constructor(
    gl: WebglContext,
    program: GlProgramHandle,
    sourceLocation: GlUniformLocation,
    useGradeLocation: GlUniformLocation,
    gradeLocation: GlUniformLocation,
    useEncodeLocation: GlUniformLocation,
  ) {
    this.#gl = gl;
    this.#program = program;
    this.#sourceLocation = sourceLocation;
    this.#useGradeLocation = useGradeLocation;
    this.#gradeLocation = gradeLocation;
    this.#useEncodeLocation = useEncodeLocation;
  }

  /**
   * Compiles and links the effect program on `gl`.
   *
   * Fails exactly as `UnlitProgram.create` does — see it, and
   * `createLinkedProgram`, for the contract; the messages name `"effect"` and
   * the §89 code is the same `SHADER_COMPILATION_FAILED`.
   */
  static create(gl: WebglContext): EffectProgram {
    const program = createLinkedProgram(
      gl,
      "effect",
      EFFECT_VERTEX_SHADER_SOURCE,
      EFFECT_FRAGMENT_SHADER_SOURCE,
    );
    try {
      return new EffectProgram(
        gl,
        program,
        requireUniform(gl, program, "source", "effect"),
        requireUniform(gl, program, "useGrade", "effect"),
        requireUniform(gl, program, "grade", "effect"),
        requireUniform(gl, program, "useEncode", "effect"),
      );
    } catch (error: unknown) {
      gl.deleteProgram(program);
      throw error;
    }
  }

  /** Whether {@link EffectProgram.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** Makes this the current program. Call before any upload below. */
  use(): void {
    this.#gl.useProgram(this.#program);
  }

  /**
   * Points the `source` sampler at texture `unit`, **once per program
   * lifetime**.
   *
   * `glUniform1i` writes into the currently bound program, so this cannot
   * happen at creation time without putting the renderer's program state in two
   * places (the argument `SpriteProgram.setSampler` records). GL's initial
   * sampler value is already {@link EFFECT_TEXTURE_UNIT}, so the upload is belt
   * and braces — it costs one call in the lifetime of the program and nothing
   * per frame, which is what keeps a chain of copies free of uniform traffic.
   */
  setSampler(unit: number): void {
    if (this.#samplerUploaded) {
      return;
    }
    this.#gl.uniform1i(this.#sourceLocation, unit);
    this.#samplerUploaded = true;
  }

  /**
   * Selects the plain copy for the draw about to be issued — §70's blit.
   *
   * Issues a `uniform1i` only if a *grade* preceded it, so a program that has
   * only ever copied has never uploaded this uniform and the fragment stage
   * runs its no-arithmetic path.
   */
  setCopy(): void {
    this.#setGradeSwitch(false);
    this.#setEncodeSwitch(false);
  }

  /**
   * Selects §60a's output transform for the draw about to be issued: the source
   * encoded as sRGB, with no grade.
   *
   * Issues at most the two switch uploads, and only the ones that actually
   * change — a chain that presents the same way every frame uploads them once
   * in the lifetime of the program.
   */
  setOutputTransform(): void {
    this.#setGradeSwitch(false);
    this.#setEncodeSwitch(true);
  }

  /** Moves the grade switch if it is not already where it is wanted. */
  #setGradeSwitch(value: boolean): void {
    if (this.#useGrade === value) {
      return;
    }
    this.#gl.uniform1i(this.#useGradeLocation, value ? 1 : 0);
    this.#useGrade = value;
  }

  /** Moves §60a's encode switch if it is not already where it is wanted. */
  #setEncodeSwitch(value: boolean): void {
    if (this.#useEncode === value) {
      return;
    }
    this.#gl.uniform1i(this.#useEncodeLocation, value ? 1 : 0);
    this.#useEncode = value;
  }

  /**
   * Selects §70's colour grade with the three coefficients
   * `ColorGradeEffect` documents, in that order.
   *
   * Issues a GL call only where the draw changes something: the switch when it
   * was off, the coefficients when any of the three moved. A chain that grades
   * with the same numbers every frame therefore uploads them once.
   */
  setGrade(exposure: number, contrast: number, saturation: number): void {
    this.#setGradeSwitch(true);
    this.#setEncodeSwitch(false);
    const mirror = this.#grade;
    if (
      mirror[0] === exposure &&
      mirror[1] === contrast &&
      mirror[2] === saturation
    ) {
      return;
    }
    mirror[0] = exposure;
    mirror[1] = contrast;
    mirror[2] = saturation;
    gradeScratch[0] = exposure;
    gradeScratch[1] = contrast;
    gradeScratch[2] = saturation;
    this.#gl.uniform3fv(this.#gradeLocation, gradeScratch);
  }

  /**
   * Deletes the GL program (§83). Idempotent.
   *
   * **Only call this on a live context** — see `UnlitProgram.dispose`.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#gl.deleteProgram(this.#program);
  }
}

/**
 * Opts this process's `WebglRenderer`s into §70's fixed effects — copy,
 * colour grade, and §60a's output transform (§62; 2026-09-11).
 *
 * ```ts
 * import { registerEffectPipeline } from "@fourjs/render-webgl";
 * registerEffectPipeline();            // once, at application setup
 * ```
 *
 * Calling it is what links this module — the full-screen program and its two
 * shaders — into the bundle; a build that never calls it carries none of it.
 * The program still compiles **lazily, on each renderer's first fixed effect
 * pass**, never here and never at renderer initialize, so registration alone
 * changes no GL transcript. Without it, `renderEffect` skips the pass with
 * one development warning. §60's graph effects need
 * `registerNodeMaterialPipeline()` instead, not this. Idempotent; calling it
 * twice re-installs the same factory.
 */
export function registerEffectPipeline(): void {
  setEffectPipelineFactory({
    create(gl: WebglContext): EffectProgram {
      return EffectProgram.create(gl);
    },
  });
}
