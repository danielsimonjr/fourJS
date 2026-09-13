/**
 * The depth-only caster pipeline (§69) — this backend's seventh program (R-18,
 * 2026-08-09).
 *
 * §69 lists ten shadow features. **One tier ships**: a single directional
 * light's shadow map, rendered depth-only into an off-screen
 * `DEPTH_COMPONENT24` texture and sampled back with a 3×3 percentage-closer
 * filter. `@fourjs/scene`'s `DirectionalLightShadow` owns the list of what is
 * staged and why; this module and `gl-program.ts`'s `SHADOW_GLSL` /
 * `ShadowUniforms` own how the shipped tier becomes GL.
 *
 * The split between the two files is `gl-standard.ts`'s: shared receiver-side
 * GLSL and its uniform helper sit beside the pipelines that splice them in,
 * and a pipeline of its own gets a file of its own.
 *
 * ## Why a seventh program and not a mode of an existing one
 *
 * A depth-only pass has no material, no lights, no uv, no normal, and no
 * colour. Drawing casters through the lit or unlit pipeline would mean
 * uploading uniforms nothing reads — per caster, per frame — and would make the
 * caster pass's GL sequence depend on which surface family the caster happens
 * to belong to. One program draws every **unskinned** caster instead, whatever
 * shades it on screen, and `gl-geometry.ts`'s vertex arrays serve it unchanged:
 * position is always at `POSITION_ATTRIBUTE_LOCATION`, and the streams this
 * stage does not declare are simply ignored. Skinned casters use a sibling
 * program behind `registerSkinningPipeline` — this module never names it, so a
 * bundle that never skins does not carry GPU skinning GLSL.
 *
 * ## Determinism (§33)
 *
 * A shadow map is *scene rendering*, not simulation: the caster pass reads the
 * same resolved world matrices the colour pass reads, from the same render list
 * in the same order, and writes to a surface no simulation ever reads back. It
 * introduces **no new determinism hazard** — no time source, no RNG, no
 * readback, and no feedback into physics state (§43's rule is untouched,
 * because the pass consumes the very `item.worldMatrix` the view loop
 * consumes). What it adds is a second traversal of the frame's render list, in
 * that list's order, which is why the pass draws from the list rather than
 * re-walking the scene.
 */

import type { Disposable } from "@fourjs/core";
import type { Matrix4 } from "@fourjs/math";

import {
  createLinkedProgram,
  matrixScratch,
  requireUniform,
  type GlProgramHandle,
  type GlUniformLocation,
  type WebglContext,
} from "./gl-program.js";
import { setShadowPipelineFactory } from "./gl-shadow-registry.js";

/**
 * The caster vertex stage: object space → the light's clip space.
 *
 * Position only — the shadow map records *where geometry is*, and a caster's
 * material, uv, normal and colour say nothing about that.
 *
 * `shadowViewProjection * model * vec4(position, 1.0)` is deliberately spelled
 * with the same association as `LIT_VERTEX_SHADER_SOURCE`'s `gl_Position`: a
 * caster and its own on-screen draw then transform through the same product
 * shape, which is one fewer source of disagreement between the depth a receiver
 * computes and the depth the map holds.
 */
const SHADOW_VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec3 position;

uniform mat4 shadowViewProjection;
uniform mat4 model;

void main() {
  gl_Position = shadowViewProjection * model * vec4(position, 1.0);
}
`;

/**
 * The caster fragment stage: a constant.
 *
 * The pass exists for its depth writes; the colour attachment of the shadow
 * target is written and never read. A stage declaring no output at all would
 * leave that attachment's contents *undefined* per GLES 3.0 rather than merely
 * unused, so one opaque white is written instead — defined behaviour for one
 * instruction, and a debug view of the map that shows a silhouette rather than
 * whatever the driver left there.
 */
const SHADOW_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

out vec4 fragColor;

void main() {
  fragColor = vec4(1.0);
}
`;

/**
 * The depth-only caster pipeline (§69).
 *
 * ```ts
 * const program = ShadowProgram.create(gl);
 * program.use();
 * program.setViewProjection(lights.shadowMatrix);  // once per shadow pass
 * program.setModel(item.worldMatrix);              // once per caster
 * ```
 *
 * Owns its GL objects and nothing else. Since 2026-09-11 it compiles
 * **lazily**, on the first frame whose light asks for a shadow map, and only
 * once {@link registerShadowPipeline} has been called — the renderer drops
 * it on context loss and re-acquires it on the next shadowed frame (§61),
 * exactly as it handles the skinned pair.
 */
export class ShadowProgram implements Disposable {
  readonly #gl: WebglContext;

  readonly #program: GlProgramHandle;

  readonly #viewProjectionLocation: GlUniformLocation;

  readonly #modelLocation: GlUniformLocation;

  #disposed = false;

  private constructor(
    gl: WebglContext,
    program: GlProgramHandle,
    viewProjectionLocation: GlUniformLocation,
    modelLocation: GlUniformLocation,
  ) {
    this.#gl = gl;
    this.#program = program;
    this.#viewProjectionLocation = viewProjectionLocation;
    this.#modelLocation = modelLocation;
  }

  /**
   * Compiles and links the shadow program on `gl`.
   *
   * Fails exactly as `UnlitProgram.create` does — see it for the contract; the
   * messages name `"shadow"` and the §89 code is the same.
   */
  static create(gl: WebglContext): ShadowProgram {
    const program = createLinkedProgram(
      gl,
      "shadow",
      SHADOW_VERTEX_SHADER_SOURCE,
      SHADOW_FRAGMENT_SHADER_SOURCE,
    );
    try {
      return new ShadowProgram(
        gl,
        program,
        requireUniform(gl, program, "shadowViewProjection", "shadow"),
        requireUniform(gl, program, "model", "shadow"),
      );
    } catch (error: unknown) {
      gl.deleteProgram(program);
      throw error;
    }
  }

  /** Whether {@link ShadowProgram.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** Makes this the current program. Call before any upload below. */
  use(): void {
    this.#gl.useProgram(this.#program);
  }

  /**
   * Uploads the light's view-projection for the pass —
   * `SceneLights.shadowMatrix`. Column-major, so `transpose` is false (§7b).
   */
  setViewProjection(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(
      this.#viewProjectionLocation,
      false,
      matrixScratch,
    );
  }

  /**
   * Uploads one caster's world matrix. See
   * {@link ShadowProgram.setViewProjection}.
   */
  setModel(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#modelLocation, false, matrixScratch);
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
 * Opts this process's `WebglRenderer`s into §69's shadow pass (§62;
 * 2026-09-11).
 *
 * ```ts
 * import { registerShadowPipeline } from "@fourjs/render-webgl";
 * registerShadowPipeline();            // once, at application setup
 * ```
 *
 * Calling it is what links this module — the depth-only caster program and
 * its two shaders — into the bundle; a build that never calls it carries none
 * of it. The program still compiles **lazily, on each renderer's first
 * shadowed frame**, never here and never at renderer initialize, so
 * registration alone changes no GL transcript. Without it, a light that asks
 * for a shadow map gets one development warning and the frame's lit surfaces
 * draw unshadowed. Idempotent; calling it twice re-installs the same factory.
 */
export function registerShadowPipeline(): void {
  setShadowPipelineFactory({
    create(gl: WebglContext): ShadowProgram {
      return ShadowProgram.create(gl);
    },
  });
}
