/**
 * The batched particle pipeline for the WebGL 2 backend (§36, §64 stage 6,
 * §112; plan P9-3).
 *
 * One particle system is **one draw call**: `drawArraysInstanced` over the six
 * vertices of `@fourjs/render`'s shared unit quad, with `count` instances fed from
 * a per-system dynamic vertex buffer that is re-uploaded once per frame. That is
 * what makes §112's "≥100 000 simple particles … rendered at interactive rates"
 * a question about fill rate rather than about draw-call overhead: the CPU cost
 * of drawing a system is a `bufferSubData` of `count × 32` bytes plus five GL
 * calls, whatever `count` is.
 *
 * Three things live here, grouped for the reason `gl-program.ts`'s header
 * gives:
 *
 * 1. **{@link ParticleGlContext}** — the WebGL 2 entry points *only* the
 *    particle path calls, layered on `WebglContext` (see "Why the context type
 *    is extended here" below).
 * 2. **{@link ParticleProgram}** — the pipeline: a screen-aligned quad
 *    billboarded in view space, coloured per instance, blended with straight
 *    alpha.
 * 3. **{@link ParticleBatchCache}** — one vertex array plus one dynamic
 *    instance buffer per particle system, keyed by the emitting node's id,
 *    invalidated and rebuilt exactly like `gl-geometry.ts`'s records.
 *
 * ## Points versus instanced quads (decision, WP-9.3)
 *
 * The cheaper-looking option is `gl.POINTS` with `gl_PointSize`: one vertex per
 * particle, no corner attribute, no instancing. It is **not** used, because the
 * largest point a rasterizer will draw is an implementation-defined limit
 * (`ALIASED_POINT_SIZE_RANGE`) that the specification does not floor at any
 * useful value, and a size past it is **silently clamped** rather than
 * reported — a particle that renders at the authored size on the developer's
 * GPU and at a different one on the user's, which is precisely the class of
 * defect a per-backend visual baseline (§92) cannot catch.
 *
 * **This packet did not measure that limit on SwiftShader**, the software
 * rasterizer the project's browser gate runs against: no browser run was in
 * scope for WP-9.3. That is the honest reason to avoid the mechanism rather
 * than to bet on it (reported to the orchestrator). Instanced quads have no
 * such cap, size correctly under any projection, and cost one extra 72-byte
 * vertex buffer for the entire application.
 *
 * `drawArraysInstanced` and `vertexAttribDivisor` are **core WebGL 2** — the
 * functionality WebGL 1 had to reach for `ANGLE_instanced_arrays` to get — so no
 * extension is queried and none can be missing: a context that lacks them is not
 * a WebGL 2 context, which is precisely what `webgl-renderer.ts`'s structural
 * check already rejects.
 *
 * ## Why the context type is extended here, not in `gl-program.ts`
 *
 * `WebglContext` is that module's written-down GL budget, and the particle path
 * needs three entry points outside it: `bufferSubData`, `vertexAttribDivisor`,
 * and `drawArraysInstanced`. They belong in `WebglContext` — but `gl-program.ts`
 * was outside this packet's file set (plan §1 rule 11: touch only your packet's
 * files), so they are declared as an **extension interface** the renderer
 * narrows to once, at initialization, through the same structural check that
 * accepts the context in the first place. The effect on a caller is nil: a real
 * `WebGL2RenderingContext` satisfies both, and the test fake implements both.
 * **Folding {@link ParticleGlContext} back into `WebglContext` is a mechanical
 * follow-up** (reported to the orchestrator) — it widens the exported
 * `WebglContext` contract, so it is not done as a drive-by.
 *
 * The program-building helpers this module once duplicated for the same reason
 * (`createLinkedProgram`, `requireUniform`, and the matrix scratch) were
 * consolidated back into `gl-program.ts` on 2026-08-05; the GL call sequences
 * and error messages are unchanged, as the fake-GL suite pins.
 *
 * ## Blending (§66, decision WP-9.3)
 *
 * Particles are transparent by construction — §36's colour ramp exists to fade
 * them out — so the particle pass runs with `GL_BLEND` **enabled**, and the
 * renderer turns it off again when the run ends, exactly as it does for sprites.
 * The blend *function* is the one this backend fixes once at initialization:
 * `SRC_ALPHA` / `ONE_MINUS_SRC_ALPHA`, i.e. **straight (non-premultiplied)
 * alpha**, which is §66's stated policy for every colour this tier touches. The
 * per-instance RGBA is therefore used exactly as `@fourjs/particles` authored it,
 * with no premultiply step anywhere.
 *
 * Two consequences, stated rather than hidden:
 *
 * - **Additive particles are staged.** Additive (`ONE`/`ONE`) is the other look
 *   §36 implies, and it needs per-material blend state from §57's `Material`
 *   base; a global switch here would apply to sprites too.
 * - **Depth writing stays on**, as it does for sprites, so overlapping systems
 *   composite in render-list order (layer, then `renderOrder`, then scene
 *   order). §66's transparency sorting is deferred with the same material state.
 *   Turning depth *writes* off for the particle pass would need `depthMask`,
 *   which is not in this backend's GL budget.
 */

import type { Disposable } from "@fourjs/core";
import type { Matrix4 } from "@fourjs/math";
import {
  PARTICLE_COLOR_OFFSET,
  PARTICLE_POSITION_OFFSET,
  PARTICLE_ROTATION_OFFSET,
  PARTICLE_SIZE_OFFSET,
  PARTICLE_SOFTNESS_OFFSET,
  PARTICLE_WIDE_INSTANCE_FLOATS,
  TRAIL_COLOR_OFFSET,
  TRAIL_POSITION_OFFSET,
  TRAIL_VERTEX_FLOATS,
  type ParticleRenderItem,
} from "@fourjs/render";

import {
  GL,
  POSITION_ATTRIBUTE_LOCATION,
  MAP_TEXTURE_UNIT,
  createLinkedProgram,
  matrixScratch,
  requireUniform,
  type GlBuffer,
  type GlProgramHandle,
  type GlUniformLocation,
  type GlVertexArray,
  type WebglContext,
} from "./gl-program.js";
import {
  particleItemFloats,
  setParticlePipelineFactory,
  type ParticlePrograms,
} from "./gl-particles-registry.js";

/**
 * The WebGL 2 / OpenGL ES 3.0 enumerants only the particle path uses. See
 * `gl-program.ts`'s header for why these are literals rather than reads off the
 * context.
 */
export const PARTICLE_GL = {
  /**
   * `GL_DYNAMIC_DRAW` — the usage hint for a buffer written once per frame and
   * drawn from once per frame, which is exactly the instance stream. Everything
   * else this backend uploads is `STATIC_DRAW`.
   */
  DYNAMIC_DRAW: 0x88e8,
} as const;

/**
 * Vertex attribute slots the particle pipeline binds, all fixed by
 * `layout(location = …)` in the vertex shader — the rule
 * {@link POSITION_ATTRIBUTE_LOCATION} already establishes, so no
 * `getAttribLocation` and no per-program vertex array.
 *
 * Slot 0 is the shared corner quad, three floats per vertex, advancing per
 * vertex (divisor 0); slots 1–3 are the interleaved instance stream, advancing
 * once per particle (divisor 1).
 */
export const PARTICLE_ATTRIBUTE_LOCATIONS = {
  /** Unit-quad corner offset, from the shared geometry. Same slot as every other pipeline. */
  corner: POSITION_ATTRIBUTE_LOCATION,
  /** Particle centre in the node's local space (`vec3`). */
  instancePosition: 1,
  /** Current size in world units (`float`). */
  instanceSize: 2,
  /** Current straight-alpha RGBA (`vec4`). */
  instanceColor: 3,
  /** Billboard rotation in radians — wide stream only (R-32). */
  instanceRotation: 4,
  /** Softness in `[0, 1]` — wide stream only (R-32). */
  instanceSoftness: 5,
} as const;

// `particleItemFloats` moved to the registry module on 2026-09-11 so the
// renderer's draw loop can read it without linking this module; re-exported
// here so every existing import keeps resolving.
export { particleItemFloats };

/**
 * The GL 2 entry points the particle path adds to `WebglContext` — see the
 * module header for why they are declared here.
 *
 * A real `WebGL2RenderingContext` satisfies this interface structurally, as it
 * does `WebglContext`.
 */
export interface ParticleGlContext extends WebglContext {
  /**
   * The **five-argument** form: source offset and length are in *elements* of
   * `data`, not bytes.
   *
   * Deliberately not the three-argument form (plan D7): uploading
   * `data.subarray(0, n)` would allocate a typed-array view every frame, which
   * is precisely the per-frame allocation the particle path exists to avoid.
   */
  bufferSubData(
    target: number,
    dstByteOffset: number,
    data: ArrayBufferView,
    srcOffset: number,
    length: number,
  ): void;

  /** Sets an attribute's instance divisor: 0 per vertex, 1 per instance. */
  vertexAttribDivisor(index: number, divisor: number): void;

  /** Draws `instanceCount` copies of `count` vertices starting at `first`. */
  drawArraysInstanced(
    mode: number,
    first: number,
    count: number,
    instanceCount: number,
  ): void;
}

/**
 * The particle vertex stage: a screen-aligned quad, sized in world units.
 *
 * ```text
 * centre_view = view · model · vec4(instancePosition, 1)
 * corner_view = centre_view.xy + corner.xy · instanceSize
 * gl_Position = projection · vec4(corner_view, …)
 * ```
 *
 * Offsetting in **view space** — after the view transform, before the
 * projection — is what makes the quad face the camera without a per-system
 * billboard matrix and without the camera appearing in the render item (§55's
 * `billboardMode` is deferred for exactly the reason this pipeline sidesteps:
 * a per-view model transform would need a per-view render list). `view` and
 * `projection` arrive as **separate** uniforms rather than the premultiplied
 * `viewProjection` the other two pipelines take, because the offset has to
 * happen between them.
 *
 * `instanceSize` is the quad's edge length in world units, so a particle of size
 * `s` spans `s` units across at any depth under a perspective projection —
 * *not* a constant number of pixels. The node's own scale does **not** scale it
 * (the size never passes through `model`'s linear part); that is a documented
 * limitation, and the fix is §36's `sizeMode`, which the MVP tier does not have.
 *
 * Exported so the picking id pass (`ParticleIdProgram`) shares this stage
 * rather than duplicating the billboard math.
 */
export const PARTICLE_VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec3 corner;
layout(location = 1) in vec3 instancePosition;
layout(location = 2) in float instanceSize;
layout(location = 3) in vec4 instanceColor;

uniform mat4 projection;
uniform mat4 view;
uniform mat4 model;

out vec4 vColor;

void main() {
  vec4 center = view * model * vec4(instancePosition, 1.0);
  center.xy += corner.xy * instanceSize;
  gl_Position = projection * center;
  vColor = instanceColor;
}
`;

/**
 * The particle fragment stage: the interpolated per-instance colour, unchanged.
 *
 * **A solid, opaque-edged square** (decision, WP-9.3). Round particles need
 * either a `discard` on the corner's radius — a branch in the fragment stage of
 * the one draw that is meant to scale to 100 000 instances — or the §55 texture
 * path, which is where soft, textured, and animated particles belong and which
 * this tier deliberately does not reach for (§36's sprite/mesh particle modes
 * are staged with it). A flat quad is the honest MVP: it draws exactly what the
 * simulation says, and nothing about the pipeline changes when a texture and a
 * uv are added to the instance stream later.
 *
 * Straight (non-premultiplied) alpha, matching §66 and every other colour this
 * backend touches.
 */
const PARTICLE_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

in vec4 vColor;

out vec4 fragColor;

void main() {
  fragColor = vColor;
}
`;

/**
 * The instanced particle pipeline (§36) — the program the §112 tier added to
 * this backend (WP-9.3).
 *
 * ```ts
 * const program = ParticleProgram.create(gl);
 * program.use();
 * program.setProjection(camera.projectionMatrix);   // once per viewport
 * program.setView(camera.viewMatrix);               // once per viewport
 * program.setModel(item.worldMatrix);               // once per system
 * ```
 *
 * Owns its GL objects and nothing else; the renderer re-creates it on context
 * restore exactly as it re-creates the other two (§61).
 */
export class ParticleProgram implements Disposable {
  readonly #gl: WebglContext;

  readonly #program: GlProgramHandle;

  readonly #projectionLocation: GlUniformLocation;

  readonly #viewLocation: GlUniformLocation;

  readonly #modelLocation: GlUniformLocation;

  #disposed = false;

  private constructor(
    gl: WebglContext,
    program: GlProgramHandle,
    projectionLocation: GlUniformLocation,
    viewLocation: GlUniformLocation,
    modelLocation: GlUniformLocation,
  ) {
    this.#gl = gl;
    this.#program = program;
    this.#projectionLocation = projectionLocation;
    this.#viewLocation = viewLocation;
    this.#modelLocation = modelLocation;
  }

  /**
   * Compiles and links the particle program on `gl`.
   *
   * Throws a {@link @fourjs/core!FourError | FourError} carrying `SHADER_COMPILATION_FAILED` (§89) with
   * the driver's info log in `context.log` when a stage fails to compile, when
   * linking fails, when GL refuses to allocate an object, or when a uniform this
   * backend wrote is missing from the linked program — the contract
   * `UnlitProgram.create` and `SpriteProgram.create` state, with `"particle"` in
   * the message. Shader objects are deleted on every path.
   */
  static create(gl: WebglContext): ParticleProgram {
    const program = createLinkedProgram(
      gl,
      "particle",
      PARTICLE_VERTEX_SHADER_SOURCE,
      PARTICLE_FRAGMENT_SHADER_SOURCE,
    );
    try {
      return new ParticleProgram(
        gl,
        program,
        requireUniform(gl, program, "projection", "particle"),
        requireUniform(gl, program, "view", "particle"),
        requireUniform(gl, program, "model", "particle"),
      );
    } catch (error: unknown) {
      gl.deleteProgram(program);
      throw error;
    }
  }

  /** Whether {@link ParticleProgram.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** Makes this the current program. Call before any upload below. */
  use(): void {
    this.#gl.useProgram(this.#program);
  }

  /**
   * Uploads the camera's projection. Column-major, so `transpose` is false —
   * the engine's `Matrix4` layout is already GL's (§7b).
   */
  setProjection(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#projectionLocation, false, matrixScratch);
  }

  /** Uploads the camera's view matrix. See {@link ParticleProgram.setProjection}. */
  setView(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#viewLocation, false, matrixScratch);
  }

  /** Uploads one particle system's world matrix. */
  setModel(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#modelLocation, false, matrixScratch);
  }

  /**
   * Deletes the GL program (§83). Idempotent.
   *
   * **Only call this on a live context** — after a loss every handle is already
   * invalid and the renderer drops its reference instead (§61).
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
 * R-32 appearance pipeline — textured / rotated / soft particles. Compiled
 * only when an emitter opts in; the default {@link ParticleProgram} is
 * unchanged so goldens and the 8-float path do not move.
 *
 * Soft particles: fade by depth difference vs `sceneDepth` when
 * `hasSceneDepth` is set; otherwise `saturate(1 − |viewZ| · softness)`.
 */
const APPEARANCE_VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec3 corner;
layout(location = 1) in vec3 instancePosition;
layout(location = 2) in float instanceSize;
layout(location = 3) in vec4 instanceColor;
layout(location = 4) in float instanceRotation;
layout(location = 5) in float instanceSoftness;
uniform mat4 projection;
uniform mat4 view;
uniform mat4 model;
out vec4 vColor;
out vec2 vUv;
out float vSoftness;
out float vViewZ;
void main() {
  vec4 center = view * model * vec4(instancePosition, 1.0);
  float c = cos(instanceRotation);
  float s = sin(instanceRotation);
  vec2 r = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
  center.xy += r * instanceSize;
  gl_Position = projection * center;
  vColor = instanceColor;
  vUv = corner.xy + 0.5;
  vSoftness = instanceSoftness;
  vViewZ = center.z;
}
`;

const APPEARANCE_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D map;
uniform int useMap;
uniform int hasSceneDepth;
uniform sampler2D sceneDepth;
uniform float depthWidth;
uniform float depthHeight;
in vec4 vColor;
in vec2 vUv;
in float vSoftness;
in float vViewZ;
out vec4 fragColor;
void main() {
  vec4 color = vColor;
  if (useMap > 0) color *= texture(map, vUv);
  float fade = 1.0;
  if (vSoftness > 0.0) {
    if (hasSceneDepth > 0) {
      float sceneZ = texture(sceneDepth, gl_FragCoord.xy / vec2(depthWidth, depthHeight)).r;
      fade = clamp(abs(sceneZ - gl_FragCoord.z) / max(vSoftness, 1e-5), 0.0, 1.0);
    } else {
      fade = clamp(1.0 - abs(vViewZ) * vSoftness, 0.0, 1.0);
    }
  }
  color.a *= fade;
  fragColor = color;
}
`;

/** Texture unit for the optional scene-depth soft-particle sample. */
export const PARTICLE_DEPTH_TEXTURE_UNIT = 1;

/**
 * Opt-in R-32 particle program. Same matrix setters as {@link ParticleProgram},
 * plus `map` / soft-depth uniforms.
 */
export class ParticleAppearanceProgram implements Disposable {
  readonly #gl: WebglContext;
  readonly #program: GlProgramHandle;
  readonly #projectionLocation: GlUniformLocation;
  readonly #viewLocation: GlUniformLocation;
  readonly #modelLocation: GlUniformLocation;
  readonly #useMapLocation: GlUniformLocation;
  readonly #hasSceneDepthLocation: GlUniformLocation;
  readonly #depthWidthLocation: GlUniformLocation;
  readonly #depthHeightLocation: GlUniformLocation;
  #disposed = false;

  private constructor(
    gl: WebglContext,
    program: GlProgramHandle,
    projectionLocation: GlUniformLocation,
    viewLocation: GlUniformLocation,
    modelLocation: GlUniformLocation,
    useMapLocation: GlUniformLocation,
    hasSceneDepthLocation: GlUniformLocation,
    depthWidthLocation: GlUniformLocation,
    depthHeightLocation: GlUniformLocation,
  ) {
    this.#gl = gl;
    this.#program = program;
    this.#projectionLocation = projectionLocation;
    this.#viewLocation = viewLocation;
    this.#modelLocation = modelLocation;
    this.#useMapLocation = useMapLocation;
    this.#hasSceneDepthLocation = hasSceneDepthLocation;
    this.#depthWidthLocation = depthWidthLocation;
    this.#depthHeightLocation = depthHeightLocation;
  }

  static create(gl: WebglContext): ParticleAppearanceProgram {
    const program = createLinkedProgram(
      gl,
      "particle-appearance",
      APPEARANCE_VERTEX_SHADER_SOURCE,
      APPEARANCE_FRAGMENT_SHADER_SOURCE,
    );
    try {
      const created = new ParticleAppearanceProgram(
        gl,
        program,
        requireUniform(gl, program, "projection", "particle-appearance"),
        requireUniform(gl, program, "view", "particle-appearance"),
        requireUniform(gl, program, "model", "particle-appearance"),
        requireUniform(gl, program, "useMap", "particle-appearance"),
        requireUniform(gl, program, "hasSceneDepth", "particle-appearance"),
        requireUniform(gl, program, "depthWidth", "particle-appearance"),
        requireUniform(gl, program, "depthHeight", "particle-appearance"),
      );
      gl.useProgram(program);
      const mapLocation = gl.getUniformLocation(program, "map");
      if (mapLocation !== null) {
        gl.uniform1i(mapLocation, MAP_TEXTURE_UNIT);
      }
      const depthLocation = gl.getUniformLocation(program, "sceneDepth");
      if (depthLocation !== null) {
        gl.uniform1i(depthLocation, PARTICLE_DEPTH_TEXTURE_UNIT);
      }
      return created;
    } catch (error: unknown) {
      gl.deleteProgram(program);
      throw error;
    }
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  use(): void {
    this.#gl.useProgram(this.#program);
  }

  setProjection(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#projectionLocation, false, matrixScratch);
  }

  setView(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#viewLocation, false, matrixScratch);
  }

  setModel(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#modelLocation, false, matrixScratch);
  }

  /** `true` samples `map` (unit 0) like an unlit sprite. */
  setUseMap(enabled: boolean): void {
    this.#gl.uniform1i(this.#useMapLocation, enabled ? 1 : 0);
  }

  /**
   * Soft-particle depth. When `bound` is false, fade is the view-Z fallback
   * documented on `ParticleEmitterOptions.softness`.
   */
  setSceneDepth(bound: boolean, width = 1, height = 1): void {
    this.#gl.uniform1i(this.#hasSceneDepthLocation, bound ? 1 : 0);
    this.#gl.uniform1f(this.#depthWidthLocation, width);
    this.#gl.uniform1f(this.#depthHeightLocation, height);
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#gl.deleteProgram(this.#program);
  }
}

/** Everything one particle system needs at draw time. */
export interface ParticleBatchRecord {
  /** Vertex array holding the corner attribute and the three instance attributes. */
  readonly vertexArray: GlVertexArray;

  /** The dynamic buffer the instance stream is uploaded into. */
  readonly instanceBuffer: GlBuffer;

  /**
   * The shared quad's position buffer this vertex array was built against.
   *
   * Recorded so the cache can tell a *stale* vertex array from a live one: the
   * geometry cache deletes and re-creates its buffers whenever the quad's
   * version advances or a context is restored, and a vertex array still
   * referencing the old buffer would draw from freed storage.
   */
  readonly cornerBuffer: GlBuffer;

  /** Floats the instance buffer was allocated for — the system's capacity × 8. */
  readonly capacityFloats: number;
}

/**
 * Per-context store of particle vertex arrays and instance buffers (§61, §64
 * stage 7).
 *
 * One cache belongs to one GL context, like `GeometryCache` and `TextureCache`:
 * the renderer builds it during `initialize` and builds a *new* one on context
 * restore, since every handle the old one held died with the context.
 *
 * ```ts
 * const record = cache.acquire(item, geometryRecord.positionBuffer);
 * if (record !== null) {
 *   cache.upload(record, item);
 *   gl.bindVertexArray(record.vertexArray);
 *   gl.drawArraysInstanced(mode, 0, 6, item.count);
 * }
 * ```
 *
 * ## Eviction (decision, WP-9.3 — the policy `gl-geometry.ts` sets)
 *
 * Records are keyed by the emitting node's id and rebuilt lazily, on the next
 * `acquire`, whenever the instance array's capacity or the shared corner buffer
 * has changed. There is no background sweep and no finalization hook, so a
 * particle system removed from the scene and never submitted again keeps its
 * vertex array until the renderer is disposed — the same documented leak window
 * `GeometryCache` carries, for the same reasons (§83 puts resource ownership on
 * whoever created the object; a renderer that is done with a scene disposes).
 */
export class ParticleBatchCache {
  readonly #gl: ParticleGlContext;

  /** Records by `ParticleRenderItem.id`. */
  readonly #records = new Map<string, ParticleBatchRecord>();

  #disposed = false;

  constructor(gl: ParticleGlContext) {
    this.#gl = gl;
  }

  /** Number of particle systems currently holding GPU buffers (§83, §84). */
  get size(): number {
    return this.#records.size;
  }

  /** Whether {@link ParticleBatchCache.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Returns the vertex array for `item`, creating it on first use and
   * re-creating it when the system's capacity or the shared `cornerBuffer` has
   * changed.
   *
   * Returns `null` — and creates no entry — when the system has no capacity at
   * all or when GL refuses to allocate an object. **Never throws**: this runs
   * inside `Renderer.render`, where §61 forbids it (see `GeometryCache.acquire`
   * for the whole argument).
   */
  acquire(
    item: ParticleRenderItem,
    cornerBuffer: GlBuffer,
  ): ParticleBatchRecord | null {
    const capacityFloats = item.instances.length;
    const existing = this.#records.get(item.id);
    if (existing !== undefined) {
      if (
        existing.capacityFloats === capacityFloats &&
        existing.cornerBuffer === cornerBuffer
      ) {
        return existing;
      }
      this.#deleteRecord(existing);
      this.#records.delete(item.id);
    }

    if (capacityFloats === 0) {
      return null;
    }

    const record = this.#create(
      item.instances,
      cornerBuffer,
      particleItemFloats(item),
    );
    if (record === null) {
      return null;
    }
    this.#records.set(item.id, record);
    return record;
  }

  /**
   * Uploads `item`'s live instances into `record`'s buffer — the frame's only
   * particle traffic, `count × 32` bytes.
   *
   * The five-argument `bufferSubData` is what keeps this allocation-free: the
   * three-argument form would need `instances.subarray(0, n)`, i.e. a fresh
   * typed-array view per system per frame (plan D7).
   *
   * A zero-particle system is not uploaded at all: an empty range is a GL call
   * that moves no bytes, and the caller skips the draw anyway.
   */
  upload(record: ParticleBatchRecord, item: ParticleRenderItem): void {
    const floats = item.count * particleItemFloats(item);
    if (floats === 0) {
      return;
    }
    const gl = this.#gl;
    gl.bindBuffer(GL.ARRAY_BUFFER, record.instanceBuffer);
    gl.bufferSubData(GL.ARRAY_BUFFER, 0, item.instances, 0, floats);
    gl.bindBuffer(GL.ARRAY_BUFFER, null);
  }

  /**
   * Drops every record **without touching the context** — the context-loss path
   * (§61). The handles are already invalid.
   */
  forget(): void {
    this.#records.clear();
  }

  /**
   * Deletes every vertex array and buffer this cache created (§83). Idempotent,
   * and valid only on a live context — the renderer calls
   * {@link ParticleBatchCache.forget} instead when the context is lost.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const record of this.#records.values()) {
      this.#deleteRecord(record);
    }
    this.#records.clear();
  }

  /**
   * Builds one vertex array: the shared quad on attribute slot 0 with divisor 0,
   * and the interleaved instance stream on slots 1–3 with divisor 1.
   *
   * The instance buffer is allocated at the system's **full capacity** with
   * `DYNAMIC_DRAW`, once, so a frame never resizes it — the driver keeps one
   * storage allocation and every frame overwrites its live prefix.
   *
   * `ARRAY_BUFFER` is cleared after the vertex array is unbound: the attribute
   * bindings are captured by `vertexAttribPointer` into the vertex array, but
   * the `ARRAY_BUFFER` binding itself is global state this method must not
   * leave dirty (the ordering rule `gl-geometry.ts` documents).
   */
  #create(
    instances: Float32Array,
    cornerBuffer: GlBuffer,
    instanceFloats: number,
  ): ParticleBatchRecord | null {
    const gl = this.#gl;
    const vertexArray = gl.createVertexArray();
    if (vertexArray === null) {
      return null;
    }
    const instanceBuffer = gl.createBuffer();
    if (instanceBuffer === null) {
      gl.deleteVertexArray(vertexArray);
      return null;
    }

    const locations = PARTICLE_ATTRIBUTE_LOCATIONS;
    const strideBytes = instanceFloats * Float32Array.BYTES_PER_ELEMENT;
    gl.bindVertexArray(vertexArray);

    gl.bindBuffer(GL.ARRAY_BUFFER, cornerBuffer);
    gl.enableVertexAttribArray(locations.corner);
    gl.vertexAttribPointer(locations.corner, 3, GL.FLOAT, false, 0, 0);

    gl.bindBuffer(GL.ARRAY_BUFFER, instanceBuffer);
    gl.bufferData(GL.ARRAY_BUFFER, instances, PARTICLE_GL.DYNAMIC_DRAW);

    gl.enableVertexAttribArray(locations.instancePosition);
    gl.vertexAttribPointer(
      locations.instancePosition,
      3,
      GL.FLOAT,
      false,
      strideBytes,
      PARTICLE_POSITION_OFFSET * Float32Array.BYTES_PER_ELEMENT,
    );
    gl.vertexAttribDivisor(locations.instancePosition, 1);

    gl.enableVertexAttribArray(locations.instanceSize);
    gl.vertexAttribPointer(
      locations.instanceSize,
      1,
      GL.FLOAT,
      false,
      strideBytes,
      PARTICLE_SIZE_OFFSET * Float32Array.BYTES_PER_ELEMENT,
    );
    gl.vertexAttribDivisor(locations.instanceSize, 1);

    gl.enableVertexAttribArray(locations.instanceColor);
    gl.vertexAttribPointer(
      locations.instanceColor,
      4,
      GL.FLOAT,
      false,
      strideBytes,
      PARTICLE_COLOR_OFFSET * Float32Array.BYTES_PER_ELEMENT,
    );
    gl.vertexAttribDivisor(locations.instanceColor, 1);

    if (instanceFloats >= PARTICLE_WIDE_INSTANCE_FLOATS) {
      gl.enableVertexAttribArray(locations.instanceRotation);
      gl.vertexAttribPointer(
        locations.instanceRotation,
        1,
        GL.FLOAT,
        false,
        strideBytes,
        PARTICLE_ROTATION_OFFSET * Float32Array.BYTES_PER_ELEMENT,
      );
      gl.vertexAttribDivisor(locations.instanceRotation, 1);

      gl.enableVertexAttribArray(locations.instanceSoftness);
      gl.vertexAttribPointer(
        locations.instanceSoftness,
        1,
        GL.FLOAT,
        false,
        strideBytes,
        PARTICLE_SOFTNESS_OFFSET * Float32Array.BYTES_PER_ELEMENT,
      );
      gl.vertexAttribDivisor(locations.instanceSoftness, 1);
    }

    gl.bindVertexArray(null);
    gl.bindBuffer(GL.ARRAY_BUFFER, null);

    return {
      vertexArray,
      instanceBuffer,
      cornerBuffer,
      capacityFloats: instances.length,
    };
  }

  /** Deletes one record's GL objects. Live context only. */
  #deleteRecord(record: ParticleBatchRecord): void {
    const gl = this.#gl;
    gl.deleteVertexArray(record.vertexArray);
    gl.deleteBuffer(record.instanceBuffer);
  }
}

/** Bytes per trail vertex — `@fourjs/render`'s interleaved stride. */
const TRAIL_STRIDE_BYTES = TRAIL_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;

const TRAIL_VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec3 trailPosition;
layout(location = 1) in vec4 trailColor;

uniform mat4 projection;
uniform mat4 view;
uniform mat4 model;

out vec4 vColor;

void main() {
  gl_Position = projection * view * model * vec4(trailPosition, 1.0);
  vColor = trailColor;
}
`;

/** Reuses the particle fragment shader — straight-alpha passthrough. */
const TRAIL_FRAGMENT_SHADER_SOURCE = PARTICLE_FRAGMENT_SHADER_SOURCE;

/**
 * The trail ribbon pipeline — one `drawArrays(TRIANGLES)` per system.
 */
export class ParticleTrailProgram implements Disposable {
  readonly #gl: WebglContext;
  readonly #program: GlProgramHandle;
  readonly #projectionLocation: GlUniformLocation;
  readonly #viewLocation: GlUniformLocation;
  readonly #modelLocation: GlUniformLocation;
  #disposed = false;

  private constructor(
    gl: WebglContext,
    program: GlProgramHandle,
    projectionLocation: GlUniformLocation,
    viewLocation: GlUniformLocation,
    modelLocation: GlUniformLocation,
  ) {
    this.#gl = gl;
    this.#program = program;
    this.#projectionLocation = projectionLocation;
    this.#viewLocation = viewLocation;
    this.#modelLocation = modelLocation;
  }

  static create(gl: WebglContext): ParticleTrailProgram {
    const program = createLinkedProgram(
      gl,
      "particle-trail",
      TRAIL_VERTEX_SHADER_SOURCE,
      TRAIL_FRAGMENT_SHADER_SOURCE,
    );
    try {
      return new ParticleTrailProgram(
        gl,
        program,
        requireUniform(gl, program, "projection", "particle-trail"),
        requireUniform(gl, program, "view", "particle-trail"),
        requireUniform(gl, program, "model", "particle-trail"),
      );
    } catch (error: unknown) {
      gl.deleteProgram(program);
      throw error;
    }
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  use(): void {
    this.#gl.useProgram(this.#program);
  }

  setProjection(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#projectionLocation, false, matrixScratch);
  }

  setView(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#viewLocation, false, matrixScratch);
  }

  setModel(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#modelLocation, false, matrixScratch);
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#gl.deleteProgram(this.#program);
  }
}

export interface ParticleTrailBatchRecord {
  readonly vertexArray: GlVertexArray;
  readonly vertexBuffer: GlBuffer;
  readonly capacityFloats: number;
}

/** Per-system trail vertex buffer cache, keyed by `ParticleRenderItem.id`. */
export class ParticleTrailBatchCache {
  readonly #gl: ParticleGlContext;
  readonly #records = new Map<string, ParticleTrailBatchRecord>();
  #disposed = false;

  constructor(gl: ParticleGlContext) {
    this.#gl = gl;
  }

  get size(): number {
    return this.#records.size;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  acquire(item: ParticleRenderItem): ParticleTrailBatchRecord | null {
    const trailVertices = item.trailVertices;
    if (trailVertices === undefined || trailVertices.length === 0) {
      return null;
    }
    const key = `${item.id}:trail`;
    const existing = this.#records.get(key);
    if (existing !== undefined) {
      if (existing.capacityFloats === trailVertices.length) {
        return existing;
      }
      this.#deleteRecord(existing);
      this.#records.delete(key);
    }
    const record = this.#create(trailVertices);
    if (record === null) {
      return null;
    }
    this.#records.set(key, record);
    return record;
  }

  upload(record: ParticleTrailBatchRecord, item: ParticleRenderItem): void {
    const count = item.trailVertexCount ?? 0;
    const floats = count * TRAIL_VERTEX_FLOATS;
    if (floats === 0 || item.trailVertices === undefined) {
      return;
    }
    const gl = this.#gl;
    gl.bindBuffer(GL.ARRAY_BUFFER, record.vertexBuffer);
    gl.bufferSubData(GL.ARRAY_BUFFER, 0, item.trailVertices, 0, floats);
    gl.bindBuffer(GL.ARRAY_BUFFER, null);
  }

  forget(): void {
    this.#records.clear();
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const record of this.#records.values()) {
      this.#deleteRecord(record);
    }
    this.#records.clear();
  }

  #create(vertices: Float32Array): ParticleTrailBatchRecord | null {
    const gl = this.#gl;
    const vertexArray = gl.createVertexArray();
    if (vertexArray === null) {
      return null;
    }
    const vertexBuffer = gl.createBuffer();
    if (vertexBuffer === null) {
      gl.deleteVertexArray(vertexArray);
      return null;
    }

    gl.bindVertexArray(vertexArray);
    gl.bindBuffer(GL.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(GL.ARRAY_BUFFER, vertices, PARTICLE_GL.DYNAMIC_DRAW);

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(
      0,
      3,
      GL.FLOAT,
      false,
      TRAIL_STRIDE_BYTES,
      TRAIL_POSITION_OFFSET * Float32Array.BYTES_PER_ELEMENT,
    );

    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(
      1,
      4,
      GL.FLOAT,
      false,
      TRAIL_STRIDE_BYTES,
      TRAIL_COLOR_OFFSET * Float32Array.BYTES_PER_ELEMENT,
    );

    gl.bindVertexArray(null);
    gl.bindBuffer(GL.ARRAY_BUFFER, null);

    return {
      vertexArray,
      vertexBuffer,
      capacityFloats: vertices.length,
    };
  }

  #deleteRecord(record: ParticleTrailBatchRecord): void {
    const gl = this.#gl;
    gl.deleteVertexArray(record.vertexArray);
    gl.deleteBuffer(record.vertexBuffer);
  }
}

/**
 * One renderer's particle programs and caches — what
 * {@link registerParticlePipeline}'s factory hands the renderer (§36, §62;
 * 2026-09-11).
 *
 * The plain billboard program and both caches are built by the constructor;
 * the R-32 appearance program and the trail program each compile on their
 * first `acquire…`, behind a fail-once latch, so a scene of plain billboards
 * pays one `createProgram` and a driver that refuses an opt-in tier is asked
 * exactly once per context (the `SkinnedPrograms.acquireShadow` rule).
 */
class ParticleProgramSet implements ParticlePrograms {
  readonly particle: ParticleProgram;

  readonly batches: ParticleBatchCache;

  readonly trailBatches: ParticleTrailBatchCache;

  readonly #gl: ParticleGlContext;

  #appearance: ParticleAppearanceProgram | null = null;

  #appearanceFailed = false;

  #trail: ParticleTrailProgram | null = null;

  #trailFailed = false;

  constructor(gl: ParticleGlContext) {
    this.#gl = gl;
    this.particle = ParticleProgram.create(gl);
    this.batches = new ParticleBatchCache(gl);
    this.trailBatches = new ParticleTrailBatchCache(gl);
  }

  acquireAppearance(): ParticleAppearanceProgram | null {
    const existing = this.#appearance;
    if (existing !== null) {
      return existing;
    }
    if (this.#appearanceFailed) {
      return null;
    }
    try {
      const compiled = ParticleAppearanceProgram.create(this.#gl);
      this.#appearance = compiled;
      return compiled;
    } catch {
      // §61: a compile refusal costs the appearance tier, not the frame — the
      // caller draws through the plain program instead, as it always did.
      this.#appearanceFailed = true;
      return null;
    }
  }

  acquireTrail(): ParticleTrailProgram | null {
    const existing = this.#trail;
    if (existing !== null) {
      return existing;
    }
    if (this.#trailFailed) {
      return null;
    }
    try {
      const compiled = ParticleTrailProgram.create(this.#gl);
      this.#trail = compiled;
      return compiled;
    } catch {
      // §61: the ribbon is skipped; the billboards it trails still draw.
      this.#trailFailed = true;
      return null;
    }
  }

  dispose(): void {
    this.particle.dispose();
    this.#appearance?.dispose();
    this.#trail?.dispose();
    this.batches.dispose();
    this.trailBatches.dispose();
  }
}

/**
 * Opts this process's `WebglRenderer`s into §36's instanced particle draws
 * (§62; 2026-09-11).
 *
 * ```ts
 * import { registerParticlePipeline } from "@fourjs/render-webgl";
 * registerParticlePipeline();          // once, at application setup
 * ```
 *
 * Calling it is what links this module — three programs, their GLSL, and the
 * two batch caches — into the bundle; a build that never calls it carries
 * none of it. The billboard program still compiles **lazily, on each
 * renderer's first particle item**, and the appearance and trail programs on
 * the first item that needs them, never here and never at renderer
 * initialize, so registration alone changes no GL transcript. Without it,
 * particle items are skipped with one development warning. Idempotent;
 * calling it twice re-installs the same factory.
 */
export function registerParticlePipeline(): void {
  setParticlePipelineFactory({
    create(gl: ParticleGlContext): ParticlePrograms {
      return new ParticleProgramSet(gl);
    },
  });
}
