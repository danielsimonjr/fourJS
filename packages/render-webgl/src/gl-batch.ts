/**
 * §65 batching for the WebGL 2 backend — the GPU half of `@fourjs/render`'s
 * {@link RenderBatcher} (R-9, 2026-08-09).
 *
 * `@fourjs/render`'s planner decides *which* consecutive draws merge and produces
 * one interleaved vertex stream plus one index stream; this module owns the two
 * buffer objects and the vertex array those streams are uploaded into, and
 * issues the single `drawElements` that replaces them. Nothing here decides
 * what may batch — read `batch.ts`'s header for that, and for why the tier is
 * "consecutive items sharing a pipeline and a material instance".
 *
 * ```ts
 * const renderer = new WebglRenderer();
 * await renderer.initialize({ canvas });
 * renderer.batching = createGlBatching();     // §65, opt in
 * // W11.4: also merge draws that differ only by texture, over atlas pages —
 * // renderer.batching = createGlBatching({ atlas: { pageSize: 1024 } });
 * ```
 *
 * ## Why batching is opt-in (decision, R-9)
 *
 * §65 asks for batching to be "transparent to ordinary users". It is not
 * switched on for everybody here, and the reason is measured rather than
 * stylistic: **nothing reachable from a class method tree-shakes** (A-1, R-6,
 * R-13, R-18 — a compiled-at-init pipeline costs 0.75–1.9 kB gzip in every
 * bundle that carries `WebglRenderer`, whether the application uses it or not).
 * Three of this repository's six size budgets sit within 1 kB of their limit,
 * and a 2D application that draws twelve shapes gains nothing from a batcher.
 *
 * So the seam is the one this repository already uses for exactly this problem
 * (`registerRapierSolver`, `registerWebglRenderer`, `RendererRegistry`'s
 * lazily-created module `let`): **`WebglRenderer` never names anything in this
 * module at runtime.** It holds an interface-typed field, imported
 * `import type`, and calls methods through it. An application that never calls
 * {@link createGlBatching} does not link this module, does not link
 * `@fourjs/render`'s planner, and pays **zero bytes** — measured, both ways.
 *
 * The transparency §65 asks for is then true of everything *above* the switch:
 * no node, material, geometry, render item or scene knows whether batching is
 * on, and turning it on changes no API.
 *
 * ## Why "the day A-4's seam exists" was the wrong thing to wait for
 *
 * This header used to end: *"Making it the default is a one-line change the day
 * the build-time pipeline-selection seam A-4 records exists."* A-4 closed on
 * 2026-08-07 and its remainder on 2026-09-07, and what it shipped is **not that
 * seam** (corrected 2026-09-16).
 *
 * A-4 shipped `__FOUR_DEV__` — a build **mode** flag, and the only build-time
 * define in this repository. `@fourjs/core`'s `dev.ts` states its contract:
 * only warnings, assertions, measurement and diagnostic bookkeeping may sit
 * behind it, and *"if deleting the guarded block changed any number the engine
 * computes, the block does not belong behind this flag"*. Batching changes what
 * the engine computes — it is the difference between 13 draws and 3 — so it is
 * barred from that flag by the same §33 rule, not merely unimplemented on it.
 * (`TODO.md`'s A-4 remainder records step 3 as WON'T-DO for exactly this
 * reason: the §33 simulation envelope.)
 *
 * What this repository actually uses to keep an unused pipeline out of a bundle
 * is a **runtime** seam, called at application setup: `registerShadowPipeline`,
 * `registerStandardPipeline`, `registerSkinningPipeline`,
 * `registerParticlePipeline` and the rest. Calling one is what links its module;
 * a build that never calls it carries none of it. {@link createGlBatching} is
 * already that shape, so batching is not missing a seam — it *is* the seam.
 *
 * So making batching the default is not a one-line change waiting on a ticket.
 * A default-on switch has to link this module in every bundle that carries
 * `WebglRenderer`, and the only way back to zero bytes for the application that
 * never batches is for that application to configure something — which is what
 * opting in already is, one call shorter. Turning it on by default is therefore
 * an owner decision about who pays, not a blocked one; nothing is missing.
 *
 * ## What one draw becomes
 *
 * A batch draws through the **unlit program**, whatever pipeline its items
 * came from, because that program is the one whose shading is a product of
 * uniforms and interpolated vertex values:
 *
 * ```text
 * unlit  : fragColor = color [× vColor] [× texture(map, vUv)]
 * sprite : fragColor = texture(map, vUv) × tint
 * ```
 *
 * A sprite batch uploads the material's tint as `color`, switches `useMap` on
 * and `useVertexColors` off, and carries uv per vertex (which is exactly what
 * `render-list.ts` predicted §65 would need). The two expressions are then the
 * same product in the opposite order, and float multiplication is commutative,
 * so the fragment stage is **bit-identical** to the sprite pipeline's. The
 * vertex stage is not, and `batch.ts` says why: a batch has one model matrix,
 * so world transforms are baked on the CPU.
 *
 * Drawing through an existing program is also what keeps this cheap: no sixth
 * pipeline is compiled, no shader is edited, and the per-frame GL cost of a
 * batch is one `bufferSubData` pair, at most three `vertexAttribPointer`s, and
 * one `drawElements`.
 *
 * ## One vertex array per layout, specified once
 *
 * The interleaved layout depends on the material's §57 feature switches
 * (position, then uv iff the material samples, then colour iff it declares
 * `vertexColors`), so a frame that mixes sprite batches with vertex-coloured
 * shape batches uses two layouts. Attribute pointers are **vertex-array
 * state**, so rather than re-specifying one array per layout change, this
 * module keeps one array per layout — four at most, created on first use, over
 * the *same* two buffers. Switching layouts then costs one `bindVertexArray`
 * instead of up to five calls, and no attribute is ever left enabled over a
 * stride that no longer describes it, which is the failure mode a re-specified
 * array has to remember to avoid.
 *
 * ## Context loss (§61)
 *
 * The buffers and the vertex arrays belong to the context that created them.
 * {@link GlBatching.forget} drops the handles **without** calling `delete*`, as
 * every other cache in this backend does on loss, and the next draw recreates
 * them; {@link GlBatching.dispose} deletes them on a live context.
 */

import { Matrix4 } from "@fourjs/math";
import {
  INSTANCE_FLOATS,
  RenderBatcher,
  type BatchAtlasStatistics,
  type InstancedRun,
  type RenderBatch,
  type RenderBatchOptions,
  type RenderItem,
} from "@fourjs/render";

import {
  resolveStandardPipelineFactory,
  type StandardPipeline,
} from "./gl-standard-registry.js";
import {
  COLOR_ATTRIBUTE_LOCATION,
  GL,
  POSITION_ATTRIBUTE_LOCATION,
  LitProgram,
  UV_ATTRIBUTE_LOCATION,
  type GlBuffer,
  type GlUniformLocation,
  type GlVertexArray,
  type UnlitProgram,
  type WebglContext,
} from "./gl-program.js";

/** `GL_DYNAMIC_DRAW` — see `gl-particles.ts`, which names it for the same reason. */
const DYNAMIC_DRAW = 0x88e8;

/**
 * The GL 2 entry point the batch path adds to {@link WebglContext} — the
 * five-argument `bufferSubData`, declared here as an extension interface for
 * the reason `gl-particles.ts`'s {@link ParticleGlContext} declares its three:
 * `gl-program.ts`'s `WebglContext` is that module's written-down GL budget and
 * widening it is a separate, mechanical change.
 *
 * A real `WebGL2RenderingContext` satisfies it, as does this backend's own
 * context type (which already carries the same method for the particle path),
 * so the renderer passes its context straight in.
 */
export interface BatchGlContext extends WebglContext {
  /**
   * Source offset and length are in **elements** of `data`, not bytes —
   * deliberately not the three-argument form, which would need
   * `data.subarray(0, n)` and allocate a view per batch per frame.
   */
  bufferSubData(
    target: number,
    dstByteOffset: number,
    data: ArrayBufferView,
    srcOffset: number,
    length: number,
  ): void;
}

/** Bytes per float, named so the stride arithmetic reads as what it is. */
const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;

/** What an instanced shaded draw (R-22) adds to {@link BatchGlContext}. */
export interface InstanceGlContext extends BatchGlContext {
  vertexAttribDivisor(index: number, divisor: number): void;
  disableVertexAttribArray(index: number): void;
  drawElementsInstanced(
    mode: number,
    count: number,
    type: number,
    offset: number,
    instanceCount: number,
  ): void;
  drawArraysInstanced(
    mode: number,
    first: number,
    count: number,
    instanceCount: number,
  ): void;
}

/** The geometry record fields an instanced draw reads (`GeometryRecord`'s). */
export interface InstancedGeometryRecord {
  readonly vertexArray: GlVertexArray;
  readonly mode: number;
  readonly count: number;
  readonly indexType: number | null;
}

/** First of the four `vec4` attributes carrying the instance model matrix. */
export const INSTANCE_MODEL_LOCATION = 8;

/** First of the three `vec3` attributes carrying the instance normal matrix. */
export const INSTANCE_NORMAL_LOCATION = 12;

const INSTANCE_ATTRIBUTE_COUNT = 7;

/**
 * Rewrites a lit/standard vertex stage so `model` and `normalMatrix` come from
 * per-instance attributes (R-22) instead of uniforms. String-level, so the
 * shaded vertex stages stay owned by the files that define them: the rewrite
 * applies only to a source declaring both uniforms, and any other source is
 * returned untouched.
 */
export function instanceVertexSource(source: string): string {
  const model = "uniform mat4 model;";
  const normal = "uniform mat3 normalMatrix;";
  if (
    !source.includes(model) ||
    !source.includes(normal) ||
    !source.includes("void main() {")
  ) {
    return source;
  }
  const m = INSTANCE_MODEL_LOCATION;
  const n = INSTANCE_NORMAL_LOCATION;
  return source
    .replace(
      model,
      [0, 1, 2, 3]
        .map(
          (i) =>
            `layout(location = ${String(m + i)}) in vec4 iModel${String(i)};`,
        )
        .join("\n"),
    )
    .replace(
      normal,
      [0, 1, 2]
        .map(
          (i) =>
            `layout(location = ${String(n + i)}) in vec3 iNormal${String(i)};`,
        )
        .join("\n"),
    )
    .replace(
      "void main() {",
      "void main() {\n  mat4 model = mat4(iModel0, iModel1, iModel2, iModel3);\n" +
        "  mat3 normalMatrix = mat3(iNormal0, iNormal1, iNormal2);",
    );
}

/** Stands in for the uniforms the rewrite removed; uploads to it are dropped. */
const ABSENT_UNIFORM: GlUniformLocation = {};

/**
 * A view of `gl` through which the shaded program classes compile the
 * instanced variant of their vertex stage unchanged: `shaderSource` rewrites
 * it ({@link instanceVertexSource}), the two removed uniforms resolve to a
 * placeholder, and `setModel`'s uploads to that placeholder are dropped.
 */
export function createInstanceGl(gl: WebglContext): WebglContext {
  const cache = new Map<string | symbol, unknown>();
  const overrides: Record<string, (...args: never[]) => unknown> = {
    shaderSource: (shader: never, source: never) => {
      gl.shaderSource(shader, instanceVertexSource(source));
    },
    getUniformLocation: (program: never, name: never) =>
      gl.getUniformLocation(program, name) ??
      (name === "model" || name === "normalMatrix" ? ABSENT_UNIFORM : null),
    uniformMatrix4fv: (location: never, ...rest: never[]) => {
      if (location !== ABSENT_UNIFORM) {
        (gl.uniformMatrix4fv as (...a: unknown[]) => void)(location, ...rest);
      }
    },
    uniformMatrix3fv: (location: never, ...rest: never[]) => {
      if (location !== ABSENT_UNIFORM) {
        (gl.uniformMatrix3fv as (...a: unknown[]) => void)(location, ...rest);
      }
    },
  };
  return new Proxy(gl, {
    get(target, property) {
      const cached = cache.get(property);
      if (cached !== undefined) return cached;
      const override = overrides[property as string];
      let value: unknown = (
        target as unknown as Record<string | symbol, unknown>
      )[property];
      if (override !== undefined) {
        value = override;
      } else if (typeof value === "function") {
        value = (value as (...a: unknown[]) => unknown).bind(target);
      }
      cache.set(property, value);
      return value;
    },
  });
}

/**
 * Which of the four vertex arrays draws `batch` — its interleaved layout as a
 * two-bit number: bit 0 is the uv stream, bit 1 the colour stream.
 *
 * A number rather than a string key, and a fixed-length array rather than a
 * `Map`, so nothing in the draw path allocates, hashes, or iterates object keys
 * (§33, plan D7).
 */
function layoutSlot(batch: RenderBatch): number {
  return (batch.hasUvs ? 1 : 0) | (batch.hasColors ? 2 : 0);
}

/**
 * The batching support a {@link WebglRenderer} draws through when an
 * application assigns one — the interface, so the renderer names no
 * implementation and this module drops out of a bundle that never asks for it.
 *
 * Implemented by {@link GlBatching}; construct one with
 * {@link createGlBatching}.
 */
export interface RenderBatching {
  /**
   * Plans and assembles the batch starting at `items[from]`, or `null` when
   * that item does not start one. See `@fourjs/render`'s `RenderBatcher.next`:
   * the returned record is pooled and valid until the next call.
   *
   * `layerMask` is **optional since R-8 (2026-08-09)**, and the renderer no
   * longer passes one: it hands this method a list `buildViewRenderList` has
   * already reduced to what the view draws, so the mask would be vacuous.
   * Omitting it means every layer, which is what a pre-filtered list needs. It
   * stays in the signature for a caller that batches over an unfiltered frame
   * list, where a masked-out item must still end a run.
   */
  next(
    items: readonly RenderItem[],
    from: number,
    layerMask?: number,
  ): RenderBatch | null;

  /**
   * Uploads `batch` and issues its single draw call, leaving the batch's
   * vertex array bound (the renderer binds a geometry's array before its next
   * ordinary draw, exactly as it does after a particle system's).
   *
   * Uniform state — the model matrix (identity: positions arrive in world
   * space), the colour, and the two feature switches — is uploaded here through
   * `program`, so a caller that never links this module never links those calls
   * either. Everything a caller *shares* with the ordinary draw path — the
   * program switch, §57's render state, the texture bind — stays with the
   * caller.
   *
   * @param useMap whether a texture is bound for this draw; `false` makes the
   * batch draw untextured, which is the same outcome an unlit item with an
   * unresolvable `map` has.
   * @returns nothing; the caller counts the draw (§84) from `batch.indexCount`.
   */
  draw(
    gl: BatchGlContext,
    program: UnlitProgram,
    batch: RenderBatch,
    useMap: boolean,
  ): void;

  /** R-22: the instanced shaded run at `items[from]`, or `null`. */
  nextInstanced?(
    items: readonly RenderItem[],
    from: number,
    layerMask?: number,
  ): InstancedRun | null;

  /** R-22: the instanced lit program for `gl`, or `null` if it will not build. */
  instancedLit?(gl: WebglContext): LitProgram | null;

  /** R-22: the instanced standard program for `gl`, or `null`. */
  instancedStandard?(gl: WebglContext): StandardPipeline | null;

  /** R-22: one instanced draw of `record` over the run's instance buffer. */
  drawInstanced?(
    gl: InstanceGlContext,
    record: InstancedGeometryRecord,
    run: InstancedRun,
  ): void;

  /**
   * W11.4: the atlas-grouping counters (pages, packed textures, draws saved),
   * or `null` when atlas grouping is off. Optional so a hand-written batching
   * object keeps working.
   */
  atlasStatistics?(): BatchAtlasStatistics | null;

  /** Drops the GL objects without touching the context (§61 context loss). */
  forget(): void;

  /** Deletes the GL objects on a live context (§83). */
  dispose(): void;
}

/**
 * The batcher plus the GL objects its output is drawn from — see the module
 * header.
 *
 * One per renderer. Holds no scene state: between frames it retains its two
 * buffers, its vertex array, and the planner's staging arrays.
 */
export class GlBatching implements RenderBatching {
  readonly #batcher: RenderBatcher;

  /** The context the handles below belong to; `null` before the first draw. */
  #gl: BatchGlContext | null = null;

  #vertexBuffer: GlBuffer | null = null;

  #indexBuffer: GlBuffer | null = null;

  /**
   * One vertex array per interleaved layout, indexed by
   * {@link layoutSlot} — `null` until a batch of that layout is first drawn.
   * Fixed length, so nothing here iterates an object's keys (§33).
   */
  readonly #vertexArrays: (GlVertexArray | null)[] = [null, null, null, null];

  /**
   * Floats the vertex buffer's store currently holds, and indices the index
   * buffer's does — the sizes last passed to `bufferData`. A batch that fits
   * uploads with `bufferSubData` instead, which is the steady state.
   */
  #vertexCapacity = 0;

  #indexCapacity = 0;

  /**
   * Last upload into the shared buffers — the idle-cache key (§65 / §86).
   * `contentVersion === 0` is "always re-upload" and is never treated as a
   * hit, so a run whose items have no transform versions keeps today's
   * `bufferSubData` every frame.
   */
  #lastUploadSlot = -1;

  #lastContentVersion = 0;

  #lastVertexCount = -1;

  #lastIndexCount = -1;

  #instanceGlFor: WebglContext | null = null;

  #instanceGlView: WebglContext | null = null;

  #instancedLit: LitProgram | null = null;

  #instancedStandard: StandardPipeline | null = null;

  #instancedLitFailed = false;

  #instancedStandardFailed = false;

  #instanceBuffer: GlBuffer | null = null;

  #instanceCapacity = 0;

  #lastInstanceVersion = 0;

  #lastInstanceFloats = -1;

  constructor(options: RenderBatchOptions = {}) {
    this.#batcher = new RenderBatcher(options);
  }

  next(
    items: readonly RenderItem[],
    from: number,
    layerMask?: number,
  ): RenderBatch | null {
    // Forwarded as-is, `undefined` included: a JavaScript default parameter
    // applies to an explicit `undefined`, so `RenderBatcher.next`'s own
    // `ALL_LAYERS` stays the single definition of "no mask" without this method
    // growing a branch of its own to say so (R-8).
    return this.#batcher.next(items, from, layerMask);
  }

  nextInstanced(
    items: readonly RenderItem[],
    from: number,
    layerMask?: number,
  ): InstancedRun | null {
    return this.#batcher.nextInstanced(items, from, layerMask);
  }

  atlasStatistics(): BatchAtlasStatistics | null {
    return this.#batcher.atlasStatistics();
  }

  instancedLit(gl: WebglContext): LitProgram | null {
    if (this.#instanceGlFor !== gl) {
      this.#resetInstanced(gl);
    }
    if (this.#instancedLit === null && !this.#instancedLitFailed) {
      try {
        this.#instancedLit = LitProgram.create(this.#instanceGl(gl));
      } catch {
        this.#instancedLitFailed = true;
      }
    }
    return this.#instancedLit;
  }

  instancedStandard(gl: WebglContext): StandardPipeline | null {
    if (this.#instanceGlFor !== gl) {
      this.#resetInstanced(gl);
    }
    const factory = resolveStandardPipelineFactory();
    if (
      this.#instancedStandard === null &&
      !this.#instancedStandardFailed &&
      factory !== null
    ) {
      try {
        this.#instancedStandard = factory.create(this.#instanceGl(gl));
      } catch {
        this.#instancedStandardFailed = true;
      }
    }
    return this.#instancedStandard;
  }

  drawInstanced(
    gl: InstanceGlContext,
    record: InstancedGeometryRecord,
    run: InstancedRun,
  ): void {
    if (this.#instanceGlFor !== gl) {
      this.#resetInstanced(gl);
    }
    if (this.#instanceBuffer === null) {
      this.#instanceBuffer = gl.createBuffer();
      if (this.#instanceBuffer === null) return;
    }
    const floats = run.items * INSTANCE_FLOATS;
    gl.bindVertexArray(record.vertexArray);
    gl.bindBuffer(GL.ARRAY_BUFFER, this.#instanceBuffer);
    const version = run.contentVersion;
    if (
      version === 0 ||
      version !== this.#lastInstanceVersion ||
      floats !== this.#lastInstanceFloats
    ) {
      if (this.#instanceCapacity < floats) {
        gl.bufferData(GL.ARRAY_BUFFER, run.instances, DYNAMIC_DRAW);
        this.#instanceCapacity = run.instances.length;
      } else {
        gl.bufferSubData(GL.ARRAY_BUFFER, 0, run.instances, 0, floats);
      }
      this.#lastInstanceVersion = version;
      this.#lastInstanceFloats = floats;
    }
    const stride = INSTANCE_FLOATS * FLOAT_BYTES;
    for (let i = 0; i < INSTANCE_ATTRIBUTE_COUNT; i += 1) {
      const isModel = i < 4;
      const location = isModel
        ? INSTANCE_MODEL_LOCATION + i
        : INSTANCE_NORMAL_LOCATION + i - 4;
      const offset = isModel ? i * 4 : 16 + (i - 4) * 3;
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(
        location,
        isModel ? 4 : 3,
        GL.FLOAT,
        false,
        stride,
        offset * FLOAT_BYTES,
      );
      gl.vertexAttribDivisor(location, 1);
    }
    if (record.indexType === null) {
      gl.drawArraysInstanced(record.mode, 0, record.count, run.items);
    } else {
      gl.drawElementsInstanced(
        record.mode,
        record.count,
        record.indexType,
        0,
        run.items,
      );
    }
    // The vertex array belongs to the geometry cache and is also drawn by
    // plain programs: hand it back exactly as found.
    for (let i = 0; i < INSTANCE_ATTRIBUTE_COUNT; i += 1) {
      const location =
        i < 4 ? INSTANCE_MODEL_LOCATION + i : INSTANCE_NORMAL_LOCATION + i - 4;
      gl.vertexAttribDivisor(location, 0);
      gl.disableVertexAttribArray(location);
    }
  }

  #instanceGl(gl: WebglContext): WebglContext {
    this.#instanceGlView ??= createInstanceGl(gl);
    return this.#instanceGlView;
  }

  #resetInstanced(gl: WebglContext | null): void {
    this.#instanceGlFor = gl;
    this.#instanceGlView = null;
    this.#instancedLit = null;
    this.#instancedStandard = null;
    this.#instancedLitFailed = false;
    this.#instancedStandardFailed = false;
    this.#instanceBuffer = null;
    this.#instanceCapacity = 0;
    this.#lastInstanceVersion = 0;
    this.#lastInstanceFloats = -1;
  }

  draw(
    gl: BatchGlContext,
    program: UnlitProgram,
    batch: RenderBatch,
    useMap: boolean,
  ): void {
    if (this.#gl !== gl) {
      // A different context — the first draw, or the first after a restore.
      // The old handles belong to a context that is gone, so they are dropped
      // rather than deleted, exactly as `forget` drops them.
      this.#reset();
      this.#gl = gl;
    }
    if (!this.#acquireBuffers(gl)) {
      return;
    }
    const slot = layoutSlot(batch);
    const existing = this.#vertexArrays[slot];
    const skipUpload = this.#canSkipUpload(batch, slot);
    if (existing !== null) {
      gl.bindVertexArray(existing);
      if (!skipUpload) {
        this.#uploadVertices(gl, batch);
        this.#uploadIndices(gl, batch);
        this.#rememberUpload(batch, slot);
      }
    } else if (!this.#createVertexArray(gl, batch, slot)) {
      return;
    } else {
      this.#rememberUpload(batch, slot);
    }

    // Positions arrive in world space (see `batch.ts`), so the model matrix is
    // the identity — uploaded per batch rather than once, because any ordinary
    // draw in between has overwritten the uniform with its own world matrix.
    program.setModel(IDENTITY_MODEL);
    program.setColor(batch.color, batch.opacity);
    program.setFeatures(useMap, batch.hasColors);
    gl.drawElements(
      batch.mode === "lines" ? GL.LINES : GL.TRIANGLES,
      batch.indexCount,
      GL.UNSIGNED_INT,
      0,
    );
  }

  forget(): void {
    this.#reset();
    this.#resetInstanced(null);
  }

  dispose(): void {
    this.#batcher.dispose();
    const gl = this.#gl;
    if (gl !== null) {
      for (const vertexArray of this.#vertexArrays) {
        if (vertexArray !== null) gl.deleteVertexArray(vertexArray);
      }
      if (this.#vertexBuffer !== null) gl.deleteBuffer(this.#vertexBuffer);
      if (this.#indexBuffer !== null) gl.deleteBuffer(this.#indexBuffer);
    }
    if (this.#instanceGlFor !== null) {
      if (this.#instanceBuffer !== null) {
        (this.#instanceGlFor as BatchGlContext).deleteBuffer(
          this.#instanceBuffer,
        );
      }
      this.#instancedLit?.dispose();
      this.#instancedStandard?.dispose();
    }
    this.#reset();
    this.#resetInstanced(null);
  }

  /** Forgets every handle and every capacity claim. */
  #reset(): void {
    this.#gl = null;
    this.#vertexBuffer = null;
    this.#indexBuffer = null;
    this.#vertexArrays[0] = null;
    this.#vertexArrays[1] = null;
    this.#vertexArrays[2] = null;
    this.#vertexArrays[3] = null;
    this.#vertexCapacity = 0;
    this.#indexCapacity = 0;
    this.#lastUploadSlot = -1;
    this.#lastContentVersion = 0;
    this.#lastVertexCount = -1;
    this.#lastIndexCount = -1;
  }

  /**
   * Whether the shared buffers already hold this batch. `contentVersion === 0`
   * is the planner's "versions unavailable" signal and always misses.
   */
  #canSkipUpload(batch: RenderBatch, slot: number): boolean {
    const version = batch.contentVersion ?? 0;
    return (
      version !== 0 &&
      this.#lastUploadSlot === slot &&
      this.#lastContentVersion === version &&
      this.#lastVertexCount === batch.vertexCount &&
      this.#lastIndexCount === batch.indexCount
    );
  }

  #rememberUpload(batch: RenderBatch, slot: number): void {
    this.#lastUploadSlot = slot;
    this.#lastContentVersion = batch.contentVersion ?? 0;
    this.#lastVertexCount = batch.vertexCount;
    this.#lastIndexCount = batch.indexCount;
  }

  /**
   * The two buffer objects every layout's vertex array shares, created on the
   * first batched draw into a context.
   *
   * `false` — and therefore a **skipped batch rather than a thrown frame**
   * (§61) — when GL declines to create one. Whatever was created is deleted
   * again in that case: retrying every frame while keeping the survivor would
   * leak one object per frame (§83).
   */
  #acquireBuffers(gl: BatchGlContext): boolean {
    if (this.#vertexBuffer !== null && this.#indexBuffer !== null) {
      return true;
    }
    const vertexBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    if (vertexBuffer === null || indexBuffer === null) {
      if (vertexBuffer !== null) gl.deleteBuffer(vertexBuffer);
      if (indexBuffer !== null) gl.deleteBuffer(indexBuffer);
      return false;
    }
    this.#vertexBuffer = vertexBuffer;
    this.#indexBuffer = indexBuffer;
    return true;
  }

  /**
   * Creates the vertex array for one interleaved layout, uploads this batch
   * through it, and leaves it bound — the slow path, run at most four times per
   * context.
   *
   * The order matters and is the reason this is not two methods: the element
   * buffer binding is *captured by the bound vertex array*, and
   * `vertexAttribPointer` captures whatever is bound to `ARRAY_BUFFER` when it
   * runs. Binding the array first, then the buffers (which also uploads), then
   * specifying the pointers, gets all three right with no redundant binds.
   */
  #createVertexArray(
    gl: BatchGlContext,
    batch: RenderBatch,
    slot: number,
  ): boolean {
    const vertexArray = gl.createVertexArray();
    if (vertexArray === null) {
      return false;
    }
    gl.bindVertexArray(vertexArray);
    this.#uploadVertices(gl, batch);
    this.#uploadIndices(gl, batch);
    const stride = batch.floatsPerVertex * FLOAT_BYTES;
    gl.enableVertexAttribArray(POSITION_ATTRIBUTE_LOCATION);
    gl.vertexAttribPointer(
      POSITION_ATTRIBUTE_LOCATION,
      3,
      GL.FLOAT,
      false,
      stride,
      0,
    );
    let offset = 3 * FLOAT_BYTES;
    if (batch.hasUvs) {
      gl.enableVertexAttribArray(UV_ATTRIBUTE_LOCATION);
      gl.vertexAttribPointer(
        UV_ATTRIBUTE_LOCATION,
        2,
        GL.FLOAT,
        false,
        stride,
        offset,
      );
      offset += 2 * FLOAT_BYTES;
    }
    if (batch.hasColors) {
      gl.enableVertexAttribArray(COLOR_ATTRIBUTE_LOCATION);
      gl.vertexAttribPointer(
        COLOR_ATTRIBUTE_LOCATION,
        4,
        GL.FLOAT,
        false,
        stride,
        offset,
      );
    }
    this.#vertexArrays[slot] = vertexArray;
    return true;
  }

  /**
   * Uploads the batch's vertices, growing the buffer's store when the planner's
   * staging array has outgrown it.
   *
   * `bufferData` is issued only when the store is too small, and then uploads
   * the whole staging array so the store's size is the array's — after which
   * every batch that fits uploads exactly its own floats with `bufferSubData`.
   * The planner's arrays double and stop, so the reallocating path runs a
   * handful of times in an application's life.
   */
  #uploadVertices(gl: BatchGlContext, batch: RenderBatch): void {
    gl.bindBuffer(GL.ARRAY_BUFFER, this.#vertexBuffer);
    const floats = batch.vertexCount * batch.floatsPerVertex;
    if (this.#vertexCapacity < floats) {
      gl.bufferData(GL.ARRAY_BUFFER, batch.vertices, DYNAMIC_DRAW);
      this.#vertexCapacity = batch.vertices.length;
      return;
    }
    gl.bufferSubData(GL.ARRAY_BUFFER, 0, batch.vertices, 0, floats);
  }

  /** The index stream, uploaded on the vertex stream's terms (see above). */
  #uploadIndices(gl: BatchGlContext, batch: RenderBatch): void {
    gl.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, this.#indexBuffer);
    if (this.#indexCapacity < batch.indexCount) {
      gl.bufferData(GL.ELEMENT_ARRAY_BUFFER, batch.indices, DYNAMIC_DRAW);
      this.#indexCapacity = batch.indices.length;
      return;
    }
    gl.bufferSubData(
      GL.ELEMENT_ARRAY_BUFFER,
      0,
      batch.indices,
      0,
      batch.indexCount,
    );
  }
}

/**
 * The model matrix every batch uploads: the identity, because `batch.ts` bakes
 * world transforms into the vertex stream.
 *
 * Module-level and shared — it is never written, and one per renderer would be
 * one `Float64Array(16)` per renderer for the same sixteen numbers.
 */
const IDENTITY_MODEL = new Matrix4();

/**
 * Creates the §65 batching support a renderer draws through.
 *
 * ```ts
 * renderer.batching = createGlBatching();                     // defaults
 * renderer.batching = createGlBatching({ maxVertices: 4096 }); // smaller batches
 * ```
 *
 * A function rather than an exported class construction at the call site for
 * the reason `createRenderStatistics` is one: the application says *what it
 * wants*, and the renderer names no implementation — which is what keeps this
 * module out of every bundle that does not ask for it (see the module header).
 */
export function createGlBatching(options?: RenderBatchOptions): RenderBatching {
  return new GlBatching(options);
}
