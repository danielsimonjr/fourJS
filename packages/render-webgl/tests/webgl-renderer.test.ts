/**
 * Unit tests for the WebGL 2 backend, driven by a hand-rolled fake context.
 *
 * ## Why a fake and not jsdom, headless-gl, or a browser
 *
 * The packet's testability split: the backend talks to GL through exactly one
 * interface (`WebglContext`, whose whole surface is written out in
 * `src/gl-program.ts`), so a hand-written object implementing those ~30 methods
 * is a *complete* double, not a partial stub. That buys three things a real
 * context cannot:
 *
 * 1. **Failure paths are reachable.** A driver will not fail to compile a
 *    shader on request, nor return `null` from `createVertexArray`, nor lose
 *    its context on cue. The fake does all three.
 * 2. **Call *sequences* are assertable.** The §61 clear/viewport contract is an
 *    ordering contract — rectangles before clears, colour only when
 *    `clearColor` is present, depth always — and ordering is invisible to a
 *    pixel comparison that happens to come out right for the wrong reason.
 * 3. **It runs in Node.** No jsdom (this package deliberately has no DOM
 *    dependency at all), no GPU, no SwiftShader, no flake.
 *
 * What the fake cannot check is whether the GL calls *mean* what we think —
 * that the shader links on a real driver, that the winding is right, that
 * anything appears on screen. That is WP-3.8's Playwright test against real
 * WebGL 2, and it is the reason this file asserts sequences rather than pixels.
 *
 * ## Why the scene objects are doubles too
 *
 * `@fourjs/render-webgl`'s dependencies are `core`, `math`, and `render` (plan
 * §3.1, frozen — a worker may not add an edge). Cameras, `BufferGeometry`, and
 * `UnlitMaterial` live in `@fourjs/scene`, `@fourjs/geometry`, and
 * `@fourjs/materials`, so importing them here — even in a test — would be a
 * phantom dependency outside the matrix. They are therefore typed doubles,
 * derived from the very types the renderer consumes
 * (`RenderItem["geometry"]`, `Parameters<Renderer["render"]>`), which keeps
 * them structurally exact while adding no edge. `Renderable` and
 * `buildRenderList` are used for real: `@fourjs/render` *is* a dependency.
 */

import { FourError, isFourError, resetDevWarnings } from "@fourjs/core";
import { Matrix4, Quaternion, Rectangle2, Vector3 } from "@fourjs/math";
import {
  MAX_PUNCTUAL_LIGHTS,
  PARTICLE_INSTANCE_FLOATS,
  PARTICLE_ROTATION_OFFSET,
  PARTICLE_SOFTNESS_OFFSET,
  PARTICLE_WIDE_INSTANCE_FLOATS,
  TRAIL_VERTEX_FLOATS,
  RenderTarget,
  Renderable,
  Sprite,
  createRenderStatistics,
  createSceneLights,
  particleQuadGeometry,
  resetRenderStatistics,
  type EffectRenderPass,
  type GraphEffect,
  type RenderBatch,
  type ShaderGraph,
  type RenderStatistics,
  type LitRenderItem,
  type ParticleRenderItem,
  type RenderItem,
  type Renderer,
  type SpriteRenderItem,
  type StandardRenderItem,
  type UnlitRenderItem,
} from "@fourjs/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COLOR_ATTRIBUTE_LOCATION,
  EFFECT_TEXTURE_UNIT,
  EffectProgram,
  GL,
  GeometryCache,
  JOINTS_ATTRIBUTE_LOCATION,
  LitProgram,
  MAP_TEXTURE_UNIT,
  METAL_ROUGHNESS_TEXTURE_UNIT,
  EMISSIVE_TEXTURE_UNIT,
  NORMAL_ATTRIBUTE_LOCATION,
  PARTICLE_ATTRIBUTE_LOCATIONS,
  PARTICLE_GL,
  POSITION_ATTRIBUTE_LOCATION,
  ParticleAppearanceProgram,
  ParticleBatchCache,
  ParticleProgram,
  ParticleTrailBatchCache,
  ParticleTrailProgram,
  PunctualLightUniforms,
  RenderTargetCache,
  SHADOW_GLSL,
  SHADOW_TEXTURE_UNIT,
  ShadowProgram,
  SpriteProgram,
  StandardProgram,
  TextureCache,
  SKINNING_GLSL,
  SkinnedLitProgram,
  SkinnedShadowProgram,
  SkinnedUnlitProgram,
  UV_ATTRIBUTE_LOCATION,
  UnlitProgram,
  WEIGHTS_ATTRIBUTE_LOCATION,
  NODE_SURFACE_TEXTURE_UNIT_BASE,
  WebglRenderer,
  WebglPickingService,
  clearRegisteredEffectPipeline,
  clearRegisteredNodeMaterialPipeline,
  clearRegisteredParticlePipeline,
  clearRegisteredPickingPipeline,
  clearRegisteredShadowPipeline,
  clearRegisteredSkinningPipeline,
  clearRegisteredStandardPipeline,
  createGlBatching,
  registerEffectPipeline,
  registerParticlePipeline,
  registerPickingPipeline,
  registerNodeMaterialPipeline,
  registerShadowPipeline,
  registerSkinningPipeline,
  registerStandardPipeline,
  resolveEffectPipelineFactory,
  resolveParticlePipelineFactory,
  resolveShadowPipelineFactory,
  resolveSkinningPipelineFactory,
  resolveStandardPipelineFactory,
  type BatchGlContext,
  type NodeItemMaterial,
  type ParticleGlContext,
  type WebglCanvas,
  type WebglContextAttributes,
  type WebglContextEventLike,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Types borrowed from the interface under test (no new dependency edges).
// ---------------------------------------------------------------------------

type RenderView = Parameters<Renderer["render"]>[1][number];
type RenderCamera = RenderView["camera"];
type ItemGeometry = RenderItem["geometry"];
/** The *unlit* half of the render item union — §57's `UnlitMaterial`. */
type ItemMaterial = UnlitRenderItem["material"];
/** The *lit* arm — §57's `LitMaterial` (§68, 2026-08-04). */
type ItemLitMaterial = LitRenderItem["material"];
/** The *standard* arm — §57's `StandardMaterial` (§59; R-13, 2026-08-08). */
type ItemStandardMaterial = StandardRenderItem["material"];
type ItemSpriteMaterial = SpriteRenderItem["material"];
type ItemTexture = ItemSpriteMaterial["texture"];
type RenderInterpolation = NonNullable<Parameters<Renderer["render"]>[2]>;
type RenderPoseBuffer = RenderInterpolation["poseBuffer"];
type RenderNode = Parameters<Renderer["render"]>[0];

// ---------------------------------------------------------------------------
// The fake GL context.
// ---------------------------------------------------------------------------

/** One recorded entry point call. */
interface RecordedCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

/** Knobs the failure-path tests turn. */
interface FakeGlOptions {
  /** Result of `getShaderParameter(..., COMPILE_STATUS)`. Default true. */
  compileStatus?: boolean;
  /** Result of `getProgramParameter(..., LINK_STATUS)`. Default true. */
  linkStatus?: boolean;
  /** `getParameter(MAX_TEXTURE_SIZE)`. Default 4096. */
  maxTextureSize?: unknown;
  /** When false, `createShader` returns null. Default true. */
  allocateShaders?: boolean;
  /** When false, `createProgram` returns null. Default true. */
  allocatePrograms?: boolean;
  /**
   * 1-based index of the `createProgram` call that returns null; every other
   * call succeeds. `initialize` builds its pipelines in a fixed order (unlit,
   * sprite, particles, lit, standard, effect), so this is how a test reaches
   * the *partial* failure paths — the ones that have to dispose the programs
   * already built rather than leak them (R-6, 2026-08-07; R-13, 2026-08-08).
   */
  failProgramAt?: number;
  /** When false, `createVertexArray` returns null. Default true. */
  allocateVertexArrays?: boolean;
  /** When false, `createTexture` returns null. Default true. */
  allocateTextures?: boolean;
  /**
   * When false, the double declares **no** `generateMipmap` at all — a context
   * that cannot build a mip chain (R-30b). Default true.
   *
   * Absent rather than throwing, because `WebglContext.generateMipmap` is
   * optional and "presence is the capability" is the contract under test.
   */
  canGenerateMipmaps?: boolean;
  /**
   * When false, `getExtension` returns `null` for every name — a device with no
   * `EXT_texture_filter_anisotropic` (R-30b, §62). Default true. `null` (as
   * opposed to `false`) removes `getExtension` from the double entirely.
   */
  anisotropyExtension?: boolean | null;
  /**
   * When true, `getExtension("EXT_disjoint_timer_query_webgl2")` returns
   * an object and the query entry points exist (A-1). Default false — a
   * device without the timer extension, which is the CI/SwiftShader case.
   */
  timerExtension?: boolean;
  /**
   * What `getQueryParameter(..., QUERY_RESULT)` reports in nanoseconds
   * once `QUERY_RESULT_AVAILABLE` is true. Default 2_000_000 (2 ms).
   */
  timerResultNanoseconds?: number;
  /** When false, a completed query reports as still in flight. Default true. */
  timerResultAvailable?: boolean;
  /** When true, `getParameter(GPU_DISJOINT_EXT)` is true. Default false. */
  timerDisjoint?: boolean;
  /**
   * What `getParameter(MAX_TEXTURE_MAX_ANISOTROPY_EXT)` reports (R-30b).
   * Default 16; `unknown` so a test can hand back what a hostile driver would.
   */
  maxAnisotropy?: unknown;
  /** When false, `createBuffer` returns null. Default true. */
  allocateBuffers?: boolean;
  /** When false, `createFramebuffer` returns null. Default true (R-4). */
  allocateFramebuffers?: boolean;
  /** When false, `createRenderbuffer` returns null. Default true (R-4). */
  allocateRenderbuffers?: boolean;
  /**
   * Result of `checkFramebufferStatus`. Default `GL.FRAMEBUFFER_COMPLETE`;
   * anything else is what a driver reports for an attachment combination it
   * cannot render into (R-4).
   */
  framebufferStatus?: number;
  /**
   * When false, the double declares **no** `readPixels` at all — a context
   * without the optional read-back entry point (§62's presence-is-the-
   * capability stance; `gl-picking.test.ts` builds the same absence for the
   * picking service). Default true.
   *
   * When present, the fake writes the deterministic byte
   * `(fy * 1024 + fx * 4 + channel) % 251` for framebuffer texel
   * `(fx, fy)` — a function of *absolute* coordinates, so a region read
   * yields exactly the sub-rectangle of a whole read and an offset mistake
   * changes bytes rather than hiding (the `recording-gpu.ts` prime-period
   * trick, extended to 2D).
   */
  canReadPixels?: boolean;
  /** When false, `getUniformLocation` returns null. Default true. */
  resolveUniforms?: boolean;
  /**
   * Text returned by both info-log getters. `null` is legal in WebGL and is
   * what a driver that has nothing to say may return.
   */
  infoLog?: string | null;
}

/**
 * The double: the backend's whole GL surface plus the recording the tests read.
 *
 * Typed against {@link ParticleGlContext} — `WebglContext` plus the three
 * instancing entry points `gl-particles.ts` adds (WP-9.3) — because that union
 * is what the renderer narrows its context to, and a fake that implemented only
 * the smaller half would be rejected at `initialize` exactly as a WebGL 1
 * context is.
 */
interface FakeGl extends ParticleGlContext {
  readonly calls: RecordedCall[];
  /**
   * Uniform handles by name, from the **first** program that resolved each name
   * — which is the unlit one, since the renderer builds it first. Uniform
   * locations are per-program in real GL, so a name a second pipeline also
   * declares (`viewProjection`, `model`) gets a *different* handle there; see
   * {@link FakeGl.uniformsByProgram}.
   */
  readonly uniformLocations: Map<string, object>;
  /** Uniform handles by program, then by name — real GL's actual scoping. */
  readonly uniformsByProgram: Map<object, Map<string, object>>;
  names(): string[];
  callsOf(name: string): RecordedCall[];
  countOf(name: string): number;
  reset(): void;
}

/**
 * Copies typed-array arguments when recording.
 *
 * The renderer uploads out of a *shared* module-level scratch buffer (plan D7),
 * so retaining the reference would make every recorded upload show the last
 * frame's values. Snapshotting is what makes the uniform assertions mean
 * anything.
 */
function snapshot(args: readonly unknown[]): readonly unknown[] {
  return args.map((arg) =>
    ArrayBuffer.isView(arg) && !(arg instanceof DataView)
      ? Array.from(arg as unknown as ArrayLike<number>)
      : arg,
  );
}

function createFakeGl(options: FakeGlOptions = {}): FakeGl {
  const {
    compileStatus = true,
    linkStatus = true,
    maxTextureSize = 4096,
    allocateShaders = true,
    allocatePrograms = true,
    failProgramAt = 0,
    allocateVertexArrays = true,
    allocateTextures = true,
    canGenerateMipmaps = true,
    anisotropyExtension = true,
    timerExtension = false,
    timerResultNanoseconds = 2_000_000,
    timerResultAvailable = true,
    timerDisjoint = false,
    maxAnisotropy = 16,
    allocateBuffers = true,
    allocateFramebuffers = true,
    allocateRenderbuffers = true,
    framebufferStatus = GL.FRAMEBUFFER_COMPLETE,
    canReadPixels = true,
    resolveUniforms = true,
    infoLog = "",
  } = options;

  const calls: RecordedCall[] = [];
  const uniformLocations = new Map<string, object>();
  const uniformsByProgram = new Map<object, Map<string, object>>();
  let handleCount = 0;
  let programCount = 0;

  const record = (name: string, ...args: unknown[]): void => {
    calls.push({ name, args: snapshot(args) });
  };
  const handle = (kind: string): object => {
    handleCount += 1;
    return { kind, serial: handleCount };
  };

  const gl: FakeGl = {
    calls,
    uniformLocations,
    uniformsByProgram,
    names: () => calls.map((call) => call.name),
    callsOf: (name) => calls.filter((call) => call.name === name),
    countOf: (name) => calls.filter((call) => call.name === name).length,
    reset: () => {
      calls.length = 0;
    },

    createShader(type) {
      record("createShader", type);
      return allocateShaders ? handle("shader") : null;
    },
    shaderSource(shader, source) {
      record("shaderSource", shader, source);
    },
    compileShader(shader) {
      record("compileShader", shader);
    },
    getShaderParameter(shader, pname) {
      record("getShaderParameter", shader, pname);
      return compileStatus;
    },
    getShaderInfoLog(shader) {
      record("getShaderInfoLog", shader);
      return infoLog;
    },
    deleteShader(shader) {
      record("deleteShader", shader);
    },

    createProgram() {
      record("createProgram");
      programCount += 1;
      if (!allocatePrograms || programCount === failProgramAt) {
        return null;
      }
      return handle("program");
    },
    attachShader(program, shader) {
      record("attachShader", program, shader);
    },
    linkProgram(program) {
      record("linkProgram", program);
    },
    getProgramParameter(program, pname) {
      record("getProgramParameter", program, pname);
      return linkStatus;
    },
    getProgramInfoLog(program) {
      record("getProgramInfoLog", program);
      return infoLog;
    },
    deleteProgram(program) {
      record("deleteProgram", program);
    },

    getUniformLocation(program, name) {
      record("getUniformLocation", program, name);
      if (!resolveUniforms) {
        return null;
      }
      let perProgram = uniformsByProgram.get(program);
      if (perProgram === undefined) {
        perProgram = new Map<string, object>();
        uniformsByProgram.set(program, perProgram);
      }
      let location = perProgram.get(name);
      if (location === undefined) {
        location = handle(`uniform:${name}`);
        perProgram.set(name, location);
        if (!uniformLocations.has(name)) {
          uniformLocations.set(name, location);
        }
      }
      return location;
    },
    useProgram(program) {
      record("useProgram", program);
    },
    uniformMatrix4fv(location, transpose, data) {
      record("uniformMatrix4fv", location, transpose, data);
    },
    uniformMatrix3fv(location, transpose, data) {
      record("uniformMatrix3fv", location, transpose, data);
    },
    uniform4fv(location, data) {
      record("uniform4fv", location, data);
    },
    uniform3fv(location, data) {
      record("uniform3fv", location, data);
    },
    uniform1f(location, value) {
      record("uniform1f", location, value);
    },
    uniform1i(location, value) {
      record("uniform1i", location, value);
    },

    createTexture() {
      record("createTexture");
      return allocateTextures ? handle("texture") : null;
    },
    bindTexture(target, texture) {
      record("bindTexture", target, texture);
    },
    texImage2D(
      target,
      level,
      internalFormat,
      width,
      height,
      border,
      format,
      type,
      pixels,
    ) {
      record(
        "texImage2D",
        target,
        level,
        internalFormat,
        width,
        height,
        border,
        format,
        type,
        pixels,
      );
    },
    texParameteri(target, pname, param) {
      record("texParameteri", target, pname, param);
    },
    deleteTexture(texture) {
      record("deleteTexture", texture);
    },
    activeTexture(unit) {
      record("activeTexture", unit);
    },

    createFramebuffer() {
      record("createFramebuffer");
      return allocateFramebuffers ? handle("framebuffer") : null;
    },
    bindFramebuffer(target, framebuffer) {
      record("bindFramebuffer", target, framebuffer);
    },
    framebufferTexture2D(target, attachment, textureTarget, texture, level) {
      record(
        "framebufferTexture2D",
        target,
        attachment,
        textureTarget,
        texture,
        level,
      );
    },
    checkFramebufferStatus(target) {
      record("checkFramebufferStatus", target);
      return framebufferStatus;
    },
    deleteFramebuffer(framebuffer) {
      record("deleteFramebuffer", framebuffer);
    },
    ...(canReadPixels
      ? {
          readPixels(
            x: number,
            y: number,
            width: number,
            height: number,
            format: number,
            type: number,
            into: ArrayBufferView | number,
          ): void {
            record("readPixels", x, y, width, height, format, type);
            if (typeof into === "number" || !(into instanceof Uint8Array)) {
              return;
            }
            // GL's own layout: row 0 of the destination is framebuffer row
            // `y` — the bottom of the read rectangle — rows ascending.
            for (let row = 0; row < height; row += 1) {
              for (let col = 0; col < width; col += 1) {
                for (let channel = 0; channel < 4; channel += 1) {
                  into[(row * width + col) * 4 + channel] =
                    ((y + row) * 1024 + (x + col) * 4 + channel) % 251;
                }
              }
            }
          },
        }
      : {}),

    createRenderbuffer() {
      record("createRenderbuffer");
      return allocateRenderbuffers ? handle("renderbuffer") : null;
    },
    bindRenderbuffer(target, renderbuffer) {
      record("bindRenderbuffer", target, renderbuffer);
    },
    renderbufferStorage(target, internalFormat, width, height) {
      record("renderbufferStorage", target, internalFormat, width, height);
    },
    framebufferRenderbuffer(
      target,
      attachment,
      renderbufferTarget,
      renderbuffer,
    ) {
      record(
        "framebufferRenderbuffer",
        target,
        attachment,
        renderbufferTarget,
        renderbuffer,
      );
    },
    deleteRenderbuffer(renderbuffer) {
      record("deleteRenderbuffer", renderbuffer);
    },

    createBuffer() {
      record("createBuffer");
      return allocateBuffers ? handle("buffer") : null;
    },
    bindBuffer(target, buffer) {
      record("bindBuffer", target, buffer);
    },
    bufferData(target, data, usage) {
      record("bufferData", target, data, usage);
    },
    bufferSubData(target, dstByteOffset, data, srcOffset, length) {
      record("bufferSubData", target, dstByteOffset, data, srcOffset, length);
    },
    deleteBuffer(buffer) {
      record("deleteBuffer", buffer);
    },

    createVertexArray() {
      record("createVertexArray");
      return allocateVertexArrays ? handle("vertexArray") : null;
    },
    bindVertexArray(array) {
      record("bindVertexArray", array);
    },
    deleteVertexArray(array) {
      record("deleteVertexArray", array);
    },
    enableVertexAttribArray(index) {
      record("enableVertexAttribArray", index);
    },
    vertexAttribDivisor(index, divisor) {
      record("vertexAttribDivisor", index, divisor);
    },
    vertexAttribPointer(index, size, type, normalized, stride, offset) {
      record(
        "vertexAttribPointer",
        index,
        size,
        type,
        normalized,
        stride,
        offset,
      );
    },

    getParameter(pname) {
      record("getParameter", pname);
      if (pname === GL.MAX_TEXTURE_MAX_ANISOTROPY_EXT) {
        return maxAnisotropy;
      }
      if (pname === GL.GPU_DISJOINT_EXT) {
        return timerDisjoint;
      }
      return maxTextureSize;
    },
    enable(capability) {
      record("enable", capability);
    },
    disable(capability) {
      record("disable", capability);
    },
    depthFunc(func) {
      record("depthFunc", func);
    },
    frontFace(mode) {
      record("frontFace", mode);
    },
    viewport(x, y, width, height) {
      record("viewport", x, y, width, height);
    },
    scissor(x, y, width, height) {
      record("scissor", x, y, width, height);
    },
    clearColor(red, green, blue, alpha) {
      record("clearColor", red, green, blue, alpha);
    },
    clearDepth(depth) {
      record("clearDepth", depth);
    },
    clear(mask) {
      record("clear", mask);
    },
    blendFunc(sourceFactor, destinationFactor) {
      record("blendFunc", sourceFactor, destinationFactor);
    },
    depthMask(enabled) {
      record("depthMask", enabled);
    },
    colorMask(red, green, blue, alpha) {
      record("colorMask", red, green, blue, alpha);
    },
    stencilFunc(func, ref, mask) {
      record("stencilFunc", func, ref, mask);
    },
    stencilOp(fail, depthFail, pass) {
      record("stencilOp", fail, depthFail, pass);
    },
    stencilMask(mask) {
      record("stencilMask", mask);
    },
    drawArrays(mode, first, count) {
      record("drawArrays", mode, first, count);
    },
    drawArraysInstanced(mode, first, count, instanceCount) {
      record("drawArraysInstanced", mode, first, count, instanceCount);
    },
    drawElements(mode, count, type, offset) {
      record("drawElements", mode, count, type, offset);
    },
    isContextLost() {
      record("isContextLost");
      return false;
    },
  };

  // R-30b: both entry points are *optional* on `WebglContext` — presence is the
  // capability — so a double that lacks them is a legal context, and building
  // them conditionally is the only way to test that path.
  if (canGenerateMipmaps) {
    gl.generateMipmap = (target: number): void => {
      record("generateMipmap", target);
    };
  }
  if (anisotropyExtension !== null || timerExtension) {
    gl.getExtension = (name: string): unknown => {
      record("getExtension", name);
      if (name === "EXT_texture_filter_anisotropic") {
        return anisotropyExtension ? { name } : null;
      }
      if (name === "EXT_disjoint_timer_query_webgl2") {
        return timerExtension ? { name } : null;
      }
      return null;
    };
  }
  if (timerExtension) {
    gl.createQuery = (): object => {
      record("createQuery");
      return handle("query");
    };
    gl.deleteQuery = (query: object): void => {
      record("deleteQuery", query);
    };
    gl.beginQuery = (target: number, query: object): void => {
      record("beginQuery", target, query);
    };
    gl.endQuery = (target: number): void => {
      record("endQuery", target);
    };
    gl.getQueryParameter = (query: object, pname: number): unknown => {
      record("getQueryParameter", query, pname);
      if (pname === GL.QUERY_RESULT_AVAILABLE) {
        return timerResultAvailable;
      }
      if (pname === GL.QUERY_RESULT) {
        return timerResultNanoseconds;
      }
      return 0;
    };
  }

  return gl;
}

// ---------------------------------------------------------------------------
// The fake canvas.
// ---------------------------------------------------------------------------

class TestCanvas implements WebglCanvas {
  width = 300;

  height = 150;

  readonly attributes: (WebglContextAttributes | undefined)[] = [];

  readonly listeners = new Map<
    string,
    ((event: WebglContextEventLike) => void)[]
  >();

  readonly #context: unknown;

  constructor(context: unknown) {
    this.#context = context;
  }

  getContext(
    contextId: "webgl2",
    attributes?: WebglContextAttributes,
  ): unknown {
    expect(contextId).toBe("webgl2");
    this.attributes.push(attributes);
    return this.#context;
  }

  addEventListener(
    type: string,
    listener: (event: WebglContextEventLike) => void,
  ): void {
    const existing = this.listeners.get(type);
    if (existing === undefined) {
      this.listeners.set(type, [listener]);
    } else {
      existing.push(listener);
    }
  }

  removeEventListener(
    type: string,
    listener: (event: WebglContextEventLike) => void,
  ): void {
    const existing = this.listeners.get(type);
    if (existing === undefined) {
      return;
    }
    const index = existing.indexOf(listener);
    if (index !== -1) {
      existing.splice(index, 1);
    }
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.length ?? 0;
  }

  /** Delivers an event; returns whether a listener called `preventDefault`. */
  dispatch(type: string): boolean {
    let prevented = false;
    const event: WebglContextEventLike = {
      preventDefault() {
        prevented = true;
      },
    };
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
    return prevented;
  }
}

// ---------------------------------------------------------------------------
// Scene-side doubles (see the header for why these are not the real classes).
// ---------------------------------------------------------------------------

let nextTestGeometryId = 0;

/** A `BufferGeometry` reduced to what the backend reads (§53). */
class TestGeometry {
  readonly id: string;

  version = 0;

  positions: Float32Array;

  /** Optional per-vertex normal stream (§53, §68) — undefined by default. */
  normals: Float32Array | undefined;

  /** Optional uv stream (§53, §55; R-19) — undefined by default. */
  uvs: Float32Array | undefined;

  /** Optional per-vertex colour stream (§53, §60a; R-19) — undefined too. */
  colors: Float32Array | undefined;

  /** Optional joint-index stream (§53, §54; RFC 0003) — undefined too. */
  joints: Uint16Array | undefined;

  /** Optional joint-weight stream (§53, §54; RFC 0003) — undefined too. */
  weights: Float32Array | undefined;

  indices: Uint16Array | Uint32Array | undefined;

  mode: "triangles" | "lines" = "triangles";

  constructor(
    positions: Float32Array,
    indices?: Uint16Array | Uint32Array,
    mode: "triangles" | "lines" = "triangles",
    normals?: Float32Array,
    uvs?: Float32Array,
    colors?: Float32Array,
  ) {
    nextTestGeometryId += 1;
    this.id = `test-geometry-${String(nextTestGeometryId)}`;
    this.positions = positions;
    this.indices = indices;
    this.mode = mode;
    this.normals = normals;
    this.uvs = uvs;
    this.colors = colors;
  }

  /** §53's vertex count — `positions.length / 3`, as `BufferGeometry` has it. */
  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get drawCount(): number {
    return this.indices === undefined
      ? this.positions.length / 3
      : this.indices.length;
  }

  /** §53's `markDirty()`: announce an edit the geometry could not see. */
  markDirty(): void {
    this.version += 1;
  }

  /** §53's `dispose()`: empties the arrays and bumps the version. */
  dispose(): void {
    this.positions = new Float32Array(0);
    this.normals = undefined;
    this.uvs = undefined;
    this.colors = undefined;
    this.joints = undefined;
    this.weights = undefined;
    this.indices = undefined;
    this.markDirty();
  }

  get asGeometry(): ItemGeometry {
    return this as unknown as ItemGeometry;
  }
}

/**
 * An `UnlitMaterial` reduced to what the backend reads (§57).
 *
 * §57's six render-state fields are **optional and unset by default**, which is
 * deliberate: a material double that predates them is exactly the case the
 * backend has to keep drawing unchanged, so the default double proves the
 * compatibility claim and a test that wants blending sets the field it needs.
 */
class TestMaterial {
  readonly color: [number, number, number, number];

  transparent?: boolean;

  blendMode?: "normal" | "additive" | "multiply" | "screen";

  depthTest?: boolean;

  depthWrite?: boolean;

  colorWrite?: boolean;

  opacity?: number;

  /**
   * §57's `map` and §53's per-vertex colour switch (R-19) — also optional and
   * unset by default, for the same reason: the double that predates them is
   * exactly the case whose GL sequence must not change.
   */
  map?: ItemTexture | null;

  vertexColors?: boolean;

  /**
   * §57's optional stencil record (§67, R-7) — optional and unset by default
   * for `map`'s reason, and typed as a *partial* record on purpose: the
   * backend reads every field defensively, and this double is what proves the
   * fallbacks are reachable rather than decorative.
   */
  stencil?: Partial<NonNullable<ItemMaterial["stencil"]>>;

  constructor(color: [number, number, number, number] = [1, 1, 1, 1]) {
    this.color = color;
  }

  get asMaterial(): ItemMaterial {
    return this as unknown as ItemMaterial;
  }
}

/**
 * A `LitMaterial` reduced to what the backend reads (§57, §68): the `kind`
 * discriminant the render list branches on, and the color the lit pipeline
 * uploads. That the discriminant is a plain readable property — not an
 * `instanceof` — is exactly what makes this double possible; see
 * `@fourjs/render`'s `lights.ts` header.
 */
class TestLitMaterial {
  readonly kind = "lit" as const;

  readonly color: [number, number, number, number];

  /** §57's albedo `map` (R-19); unset by default, like the unlit double's. */
  map?: ItemTexture | null;

  constructor(color: [number, number, number, number] = [1, 1, 1, 1]) {
    this.color = color;
  }

  get asMaterial(): ItemLitMaterial {
    return this as unknown as ItemLitMaterial;
  }
}

/**
 * A `StandardMaterial` reduced to what the backend reads (§57, §59): the
 * `kind` discriminant the render list branches on, §59's base colour, its two
 * metallic-roughness scalars, and its emissive term. Same technique and same
 * reason as {@link TestLitMaterial} — the discriminant is a plain readable
 * property, so a double is possible at all.
 */
class TestStandardMaterial {
  readonly kind = "standard" as const;

  readonly baseColor: [number, number, number, number];

  metalness: number;

  roughness: number;

  readonly emissive: [number, number, number];

  /** §59's albedo map; unset by default, like the other doubles'. */
  map?: ItemTexture | null;

  metalRoughnessMap?: ItemTexture | null;

  emissiveMap?: ItemTexture | null;
  normalMap?: ItemTexture | null;
  occlusionMap?: ItemTexture | null;
  normalScale = 1;
  occlusionStrength = 1;

  constructor(
    baseColor: [number, number, number, number] = [1, 1, 1, 1],
    metalness = 0,
    roughness = 1,
    emissive: [number, number, number] = [0, 0, 0],
  ) {
    this.baseColor = baseColor;
    this.metalness = metalness;
    this.roughness = roughness;
    this.emissive = emissive;
  }

  get asMaterial(): ItemStandardMaterial {
    return this as unknown as ItemStandardMaterial;
  }
}

let nextTestTextureId = 0;

/**
 * A `Texture` reduced to the `SpriteTexture` read surface a backend sees (§77).
 *
 * The concrete class lives in `@fourjs/render`, which *is* a dependency — but the
 * cache is typed against `SpriteRenderItem["material"]["texture"]`, i.e. the
 * structural contract, and a double is what proves the cache reads nothing
 * outside it. It also makes the failure paths reachable: a real texture cannot
 * be asked to report a version that never advanced.
 */
class TestTexture {
  readonly id: string;

  version = 0;

  width: number;

  height: number;

  data: Uint8Array | null;

  disposed = false;

  /**
   * §60a's colour-space tag (R-15, 2026-08-08). Left `undefined` by default,
   * exactly as a texture written before the field existed leaves it, so every
   * other test in this file exercises the `?? "linear"` path.
   */
  colorSpace?: "srgb" | "linear";

  /**
   * §77's sampler state (R-30, 2026-08-13). Both left `undefined` by default,
   * exactly as every texture written before the fields existed leaves them —
   * which is what keeps the four `texParameteri` calls of every other test in
   * this file byte-identical, and what makes the `?? default` path the one they
   * exercise.
   */
  filter?: "nearest" | "linear";

  /** See {@link TestTexture.filter}. */
  wrap?: "clamp-to-edge" | "repeat" | "mirrored-repeat";

  /**
   * §77's mip chain, its min-filter split, and its anisotropy request (R-30b,
   * 2026-08-21). All three left `undefined` by default for
   * {@link TestTexture.filter}'s reason: every other test in this file is a
   * texture written before they existed, and its upload must stay byte-for-byte
   * what it was.
   */
  mipmaps?: boolean;

  /** See {@link TestTexture.mipmaps}. */
  minFilter?:
    | "nearest"
    | "linear"
    | "nearest-mipmap-nearest"
    | "linear-mipmap-nearest"
    | "nearest-mipmap-linear"
    | "linear-mipmap-linear";

  /** See {@link TestTexture.mipmaps}. */
  anisotropy?: number;

  constructor(width = 2, height = 2, data: Uint8Array | null = null) {
    nextTestTextureId += 1;
    this.id = `test-texture-${String(nextTestTextureId)}`;
    this.width = width;
    this.height = height;
    this.data = data ?? new Uint8Array(width * height * 4);
  }

  /** §77's `markDirty()`: announce a texel edit the texture could not see. */
  markDirty(): void {
    this.version += 1;
  }

  /** §77's `dispose()`: drops the data and bumps the version. */
  dispose(): void {
    this.disposed = true;
    this.data = null;
    this.markDirty();
  }

  /**
   * No cast is needed — the double satisfies the `SpriteTexture` contract
   * structurally, which is the point of that contract. The accessor exists so
   * the doubles all read the same way.
   */
  get asTexture(): ItemTexture {
    return this;
  }
}

/**
 * A `SpriteMaterial` reduced to what the backend reads (§55, §57).
 *
 * The `kind` discriminant is part of that surface since §57's `Material` base
 * landed (2026-08-06): the render list picks an item's pipeline from the
 * *material*, not from the node's class, so a sprite material that does not
 * declare itself would be drawn flat-coloured — which is precisely the
 * documented fallback, and precisely wrong for a double that claims to be a
 * sprite material.
 */
class TestSpriteMaterial {
  readonly kind = "sprite" as const;

  readonly tint: [number, number, number, number];

  texture: ItemTexture;

  constructor(
    texture: TestTexture = new TestTexture(),
    tint: [number, number, number, number] = [1, 1, 1, 1],
  ) {
    this.texture = texture.asTexture;
    this.tint = tint;
  }

  get asMaterial(): ItemSpriteMaterial {
    return this as unknown as ItemSpriteMaterial;
  }
}

/** A `Camera` reduced to what the backend reads and calls (§47). */
class TestCamera {
  readonly projectionMatrix = new Matrix4();

  readonly viewMatrix = new Matrix4();

  /**
   * §47's camera is a `Node`, so it carries a transform whose world matrix
   * `updateViewMatrix()` resolves. The standard pipeline reads the eye position
   * out of that matrix's translation column (§59's specular lobe needs a view
   * vector), which is the one member of the camera contract this double gained
   * on 2026-08-08 (R-13).
   */
  readonly transform = { worldMatrix: new Matrix4() };

  /**
   * §47's visibility mask (R-38, 2026-08-08), left `undefined` so that every
   * other case in this file keeps exercising the *pre-field* double — which is
   * the shape `viewLayerMask`'s `?? ALL_LAYERS` fallback exists for, and the
   * evidence that a camera which never heard of layers still draws everything.
   * {@link TestCamera.sees} opts a single case in.
   */
  layers: number | undefined = undefined;

  updateViewMatrixCalls = 0;

  updateViewMatrix(): void {
    this.updateViewMatrixCalls += 1;
  }

  /** Narrows what this camera sees to `mask` (§47). */
  sees(mask: number): this {
    this.layers = mask;
    return this;
  }

  /** Places the eye, as a real camera's resolved world matrix would. */
  placeAt(x: number, y: number, z: number): this {
    this.transform.worldMatrix.elements[12] = x;
    this.transform.worldMatrix.elements[13] = y;
    this.transform.worldMatrix.elements[14] = z;
    return this;
  }

  get asCamera(): RenderCamera {
    return this as unknown as RenderCamera;
  }
}

/**
 * A `PoseBuffer` reduced to the one method the interpolated render list calls
 * (§43).
 *
 * `PoseBuffer` lives in `@fourjs/scene`, outside this package's dependency
 * matrix, so — like the camera, geometry, and material above — it is a double.
 * The interpolation *arithmetic* under test is `@fourjs/render`'s real
 * `buildInterpolatedRenderList`; what this double supplies is the pair of poses
 * a simulation would have captured, so the assertion is about which list the
 * backend built and what it uploaded, not about lerp.
 */
class TestPoseBuffer {
  /** Nodes this buffer claims to track, with the two poses §43 blends. */
  readonly tracked = new Map<
    RenderNode,
    { readonly from: Vector3; readonly to: Vector3 }
  >();

  /** Alphas the render list asked about, in call order. */
  readonly alphas: number[] = [];

  track(node: RenderNode, from: Vector3, to: Vector3): this {
    this.tracked.set(node, { from, to });
    return this;
  }

  /** `PoseBuffer.computeRenderPose`: lerp position, leave rotation identity. */
  computeRenderPose(
    node: RenderNode,
    alpha: number,
    outPosition: Vector3,
    outRotation: Quaternion,
  ): boolean {
    const entry = this.tracked.get(node);
    if (entry === undefined) {
      return false;
    }
    this.alphas.push(alpha);
    outPosition.copy(entry.from).lerp(entry.to, alpha);
    outRotation.identity();
    return true;
  }

  get asPoseBuffer(): RenderPoseBuffer {
    return this as unknown as RenderPoseBuffer;
  }
}

/** The §43 argument `Application` passes to `render` each frame. */
function interpolationAt(
  poses: TestPoseBuffer,
  alpha: number,
): RenderInterpolation {
  return { poseBuffer: poses.asPoseBuffer, alpha };
}

/** The model matrices uploaded by the last render, in upload order. */
function modelUploads(gl: FakeGl): number[][] {
  const model = gl.uniformLocations.get("model");
  return gl
    .callsOf("uniformMatrix4fv")
    .filter((call) => call.args[0] === model)
    .map((call) => call.args[2] as number[]);
}

/** Three vertices, one unindexed triangle. */
function triangleGeometry(): TestGeometry {
  return new TestGeometry(
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    undefined,
  );
}

/** Four vertices, two indexed triangles (`Uint16Array` indices). */
function quadGeometry(): TestGeometry {
  return new TestGeometry(
    new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    new Uint16Array([0, 1, 2, 0, 2, 3]),
  );
}

function renderable(
  geometry: TestGeometry,
  material: TestMaterial = new TestMaterial(),
): Renderable {
  return new Renderable(geometry.asGeometry, material.asMaterial);
}

/**
 * A real `Sprite` — `@fourjs/render` is a dependency, and the quad it builds
 * from its anchor, size, and frame is exactly what the authored-uv assertions
 * are about. Only the material and the texture are doubles.
 */
function sprite(
  material: TestSpriteMaterial = new TestSpriteMaterial(),
  options?: ConstructorParameters<typeof Sprite>[1],
): Sprite {
  return new Sprite(material.asMaterial, options);
}

/**
 * The sprite program's uniform handles, found by the one uniform name only it
 * declares. Uniform locations are per-program (see {@link FakeGl}), so this is
 * what distinguishes a sprite `model` upload from an unlit one.
 */
function spriteUniforms(gl: FakeGl): Map<string, object> {
  for (const perProgram of gl.uniformsByProgram.values()) {
    if (perProgram.has("tint")) {
      return perProgram;
    }
  }
  throw new Error("the sprite program never resolved its uniforms");
}

/** Values uploaded to `location` by the recorded calls, in upload order. */
function uploadsAt(gl: FakeGl, location: object | undefined): unknown[] {
  return gl.calls
    .filter((call) => call.args[0] === location)
    .map((call) => call.args[call.args.length - 1]);
}

/**
 * A container node.
 *
 * `Group`/`Scene` live in `@fourjs/scene`, which is outside this package's
 * dependency matrix, so the root is a `Renderable` carrying an *empty*
 * geometry: it generates a render item, the geometry cache reports "nothing to
 * draw", and it contributes no GL call — a container in everything but name.
 */
function createRoot(): Renderable {
  return renderable(new TestGeometry(new Float32Array(0)));
}

/**
 * A directional light double (§68): the structural
 * `DirectionalLightSource` contract from `@fourjs/render`'s `lights.ts`,
 * carried by a container node (see {@link createRoot} for why the node base
 * is an empty `Renderable` — `DirectionalLight` itself lives in
 * `@fourjs/scene`, outside this package's dependency matrix). The empty
 * geometry keeps it from contributing any draw of its own.
 */
class TestLight extends Renderable {
  readonly isDirectionalLight = true as const;

  readonly color: [number, number, number];

  intensity: number;

  /** Written into `out` by {@link TestLight.getWorldDirection}. */
  direction: [number, number, number];

  /** How many times the renderer asked for the direction. */
  directionReads = 0;

  constructor(
    color: [number, number, number] = [1, 1, 1],
    intensity = 1,
    direction: [number, number, number] = [0, 0, -1],
  ) {
    super(
      new TestGeometry(new Float32Array(0)).asGeometry,
      new TestMaterial().asMaterial,
    );
    this.color = color;
    this.intensity = intensity;
    this.direction = direction;
  }

  getWorldDirection(out: Vector3): Vector3 {
    this.directionReads += 1;
    return out.set(this.direction[0], this.direction[1], this.direction[2]);
  }
}

/**
 * A render root carrying the scene ambient term (§68): the structural
 * `AmbientLightSource` contract `Scene.ambientLight` satisfies, on the same
 * empty-geometry container {@link createRoot} builds.
 */
class AmbientRoot extends Renderable {
  readonly ambientLight: [number, number, number];

  constructor(ambient: [number, number, number] = [0, 0, 0]) {
    super(
      new TestGeometry(new Float32Array(0)).asGeometry,
      new TestMaterial().asMaterial,
    );
    this.ambientLight = ambient;
  }
}

/**
 * The lit program's uniform handles, found by a uniform name only it declares
 * — the sprite-program lookup's pattern (see {@link spriteUniforms}).
 */
function litUniforms(gl: FakeGl): Map<string, object> {
  for (const perProgram of gl.uniformsByProgram.values()) {
    if (perProgram.has("ambientLight")) {
      return perProgram;
    }
  }
  throw new Error("the lit program never resolved its uniforms");
}

function createView(
  camera: TestCamera,
  overrides: Partial<RenderView> = {},
): RenderView {
  return {
    id: "main",
    camera: camera.asCamera,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    normalized: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Harness.
// ---------------------------------------------------------------------------

interface Harness {
  gl: FakeGl;
  canvas: TestCanvas;
  renderer: WebglRenderer;
  camera: TestCamera;
}

async function initialized(options: FakeGlOptions = {}): Promise<Harness> {
  const gl = createFakeGl(options);
  const canvas = new TestCanvas(gl);
  const renderer = new WebglRenderer();
  await renderer.initialize({ canvas });
  return { gl, canvas, renderer, camera: new TestCamera() };
}

/** Awaits a rejection and returns the `FourError` it carried. */
async function rejection(promise: Promise<unknown>): Promise<FourError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (isFourError(error)) {
      return error;
    }
    throw new Error(`expected a FourError, got ${String(error)}`);
  }
  throw new Error("expected the promise to reject");
}

/** Runs `body`, expecting a `FourError`, and returns it. */
function thrown(body: () => void): FourError {
  try {
    body();
  } catch (error: unknown) {
    if (isFourError(error)) {
      return error;
    }
    throw new Error(`expected a FourError, got ${String(error)}`);
  }
  throw new Error("expected the call to throw");
}

/** Index of the first call named `name`, or -1. */
function indexOf(gl: FakeGl, name: string): number {
  return gl.names().indexOf(name);
}

beforeEach(() => {
  nextTestGeometryId = 0;
  // The four pipelines that moved behind registration seams on 2026-09-11
  // (§69 shadows, §70 effects, §36 particles, and — by owner decision — §59's
  // standard surface) are registered for every test by default, so the
  // suites written while they compiled at initialize keep asserting the same
  // draws; the seam suites below clear the slot they exercise in their own
  // `beforeEach`, the skinning precedent.
  registerShadowPipeline();
  registerEffectPipeline();
  registerParticlePipeline();
  registerStandardPipeline();
});

afterEach(() => {
  clearRegisteredShadowPipeline();
  clearRegisteredEffectPipeline();
  clearRegisteredParticlePipeline();
  clearRegisteredStandardPipeline();
});

// ---------------------------------------------------------------------------

describe("WebglRenderer — initialization (§61, §62)", () => {
  it("implements the Renderer interface", async () => {
    const { renderer } = await initialized();
    const asInterface: Renderer = renderer;

    expect(typeof asInterface.initialize).toBe("function");
    expect(typeof asInterface.render).toBe("function");
    expect(typeof asInterface.resize).toBe("function");
    expect(typeof asInterface.dispose).toBe("function");
    expect(asInterface.events.listenerCount("contextlost")).toBe(0);
  });

  it("reports the webgl2 backend before initialization, with no texture limit", () => {
    const renderer = new WebglRenderer();

    expect(renderer.capabilities.backend).toBe("webgl2");
    expect(renderer.capabilities.maxTextureSize).toBe(0);
    expect(renderer.initialized).toBe(false);
  });

  it("publishes MAX_TEXTURE_SIZE from the context after initialization (§62)", async () => {
    const { renderer, gl } = await initialized({ maxTextureSize: 8192 });

    expect(renderer.capabilities.maxTextureSize).toBe(8192);
    expect(renderer.initialized).toBe(true);
    expect(gl.callsOf("getParameter")[0].args[0]).toBe(GL.MAX_TEXTURE_SIZE);
  });

  it("reports 0 when the driver answers MAX_TEXTURE_SIZE with a non-number", async () => {
    const { renderer } = await initialized({ maxTextureSize: null });

    expect(renderer.capabilities.maxTextureSize).toBe(0);
  });

  it("answers §62's whole capability list, without asking GL anything new", async () => {
    const { renderer, gl } = await initialized();
    const capabilities = renderer.capabilities;

    // Every member is a statement about *this backend on WebGL 2*, and each is
    // true by construction (see `WEBGL_STATIC_CAPABILITIES`): WebGL 2 has no
    // compute stage, no storage buffers and no indirect draw at all, this
    // default fake has no timer extension and no float target, and GLSL ES
    // 3.00 requires fragment-stage `highp`.
    expect(capabilities.computeShaders).toBe(false);
    expect(capabilities.storageBuffers).toBe(false);
    expect(capabilities.indirectDraw).toBe(false);
    expect(capabilities.floatRenderTargets).toBe(false);
    // timestampQueries is a getter: unread here so initialize's transcript
    // is still one getParameter (MAX_TEXTURE_SIZE). See the dedicated test.
    expect(Object.hasOwn(capabilities, "timestampQueries")).toBe(true);
    expect(capabilities.multisampling).toBe(true);
    expect(capabilities.shaderPrecision).toBe("highp");
    expect(capabilities.textureFormats).toEqual(["rgba8"]);
    expect(capabilities.compressedTextureFormats).toEqual([]);
    // maxAnisotropy is a getter: unread, so initialize's transcript is
    // still one getParameter (MAX_TEXTURE_SIZE). See the dedicated test.
    expect(Object.hasOwn(capabilities, "maxAnisotropy")).toBe(true);

    // §62's "maximum uniforms and bindings" is deliberately **not** reported:
    // two more `getParameter` calls at initialization would move every landed
    // integration transcript for a number nothing reads yet (R-30b's recorded
    // lazy-query law). `undefined` says "not reported", which is a third
    // answer distinct from a confident wrong one.
    expect(capabilities.maxUniformBufferBytes).toBeUndefined();
    expect(capabilities.maxBindings).toBeUndefined();
    expect(gl.countOf("getParameter")).toBe(1);
  });

  it("reports maxAnisotropy from the extension after init, not during it (R-30c)", async () => {
    const { renderer, gl } = await initialized({ maxAnisotropy: 8 });

    expect(gl.countOf("getExtension")).toBe(0);
    expect(gl.countOf("getParameter")).toBe(1);
    expect(renderer.capabilities.maxAnisotropy).toBe(8);
    expect(gl.callsOf("getExtension").map((call) => call.args[0])).toEqual([
      "EXT_texture_filter_anisotropic",
    ]);
    expect(renderer.capabilities.maxAnisotropy).toBe(8);
    expect(gl.countOf("getExtension")).toBe(1);
  });

  it("reports maxAnisotropy 1 when the extension is absent (R-30c)", async () => {
    const { renderer } = await initialized({ anisotropyExtension: false });

    expect(renderer.capabilities.maxAnisotropy).toBe(1);
  });

  it("reports timestampQueries from the extension after init, not during it (A-1)", async () => {
    const { renderer, gl } = await initialized({ timerExtension: true });

    expect(gl.countOf("getExtension")).toBe(0);
    expect(gl.countOf("getParameter")).toBe(1);
    expect(renderer.capabilities.timestampQueries).toBe(true);
    expect(gl.callsOf("getExtension").map((call) => call.args[0])).toEqual([
      "EXT_disjoint_timer_query_webgl2",
    ]);
    expect(renderer.capabilities.timestampQueries).toBe(true);
    expect(gl.countOf("getExtension")).toBe(1);
  });

  it("reports timestampQueries false when the timer extension is absent (A-1)", async () => {
    const { renderer } = await initialized();

    expect(renderer.capabilities.timestampQueries).toBe(false);
  });

  it("does not issue timer queries until lastGpuFrameTimeSeconds is read (A-1)", async () => {
    const { renderer, gl, camera } = await initialized({
      timerExtension: true,
    });
    gl.reset();
    renderer.render(createRoot(), [createView(camera)]);
    expect(gl.countOf("beginQuery")).toBe(0);
    expect(gl.countOf("createQuery")).toBe(0);
  });

  it("publishes a completed elapsed-time query as lastGpuFrameTimeSeconds (A-1)", async () => {
    const { renderer, gl, camera } = await initialized({
      timerExtension: true,
      timerResultNanoseconds: 4_000_000,
    });

    expect(renderer.lastGpuFrameTimeSeconds).toBeNaN();
    gl.reset();
    renderer.render(createRoot(), [createView(camera)]);
    expect(gl.countOf("beginQuery")).toBe(1);
    expect(gl.countOf("endQuery")).toBe(1);
    expect(renderer.lastGpuFrameTimeSeconds).toBeNaN();

    renderer.render(createRoot(), [createView(camera)]);
    expect(renderer.lastGpuFrameTimeSeconds).toBeCloseTo(0.004, 12);
  });

  it("discards a disjoint elapsed-time sample (A-1)", async () => {
    const { renderer, camera } = await initialized({
      timerExtension: true,
      timerDisjoint: true,
    });

    expect(renderer.lastGpuFrameTimeSeconds).toBeNaN();
    renderer.render(createRoot(), [createView(camera)]);
    renderer.render(createRoot(), [createView(camera)]);
    expect(renderer.lastGpuFrameTimeSeconds).toBeNaN();
  });

  it("stays NaN when the timer extension is missing, even after the getter is read (A-1)", async () => {
    const { renderer, gl, camera } = await initialized();
    expect(renderer.lastGpuFrameTimeSeconds).toBeNaN();
    renderer.render(createRoot(), [createView(camera)]);
    renderer.render(createRoot(), [createView(camera)]);
    expect(renderer.lastGpuFrameTimeSeconds).toBeNaN();
    expect(gl.countOf("beginQuery")).toBe(0);
  });

  it("requests a webgl2 context with depth, no stencil, and the antialias hint", async () => {
    const gl = createFakeGl();
    const canvas = new TestCanvas(gl);
    const renderer = new WebglRenderer();

    await renderer.initialize({ canvas, antialias: true });

    expect(canvas.attributes).toEqual([
      { alpha: true, antialias: true, depth: true, stencil: false },
    ]);
  });

  it("defaults antialias to false when the option is absent (§45 hint)", async () => {
    const { canvas } = await initialized();

    expect(canvas.attributes[0]?.antialias).toBe(false);
  });

  it("rejects with RENDERER_INITIALIZATION_FAILED when no canvas is given", async () => {
    const renderer = new WebglRenderer();

    const error = await rejection(renderer.initialize());

    expect(error.code).toBe("RENDERER_INITIALIZATION_FAILED");
    expect(renderer.initialized).toBe(false);
  });

  it("rejects when `canvas` is not an object", async () => {
    const renderer = new WebglRenderer();

    const error = await rejection(renderer.initialize({ canvas: "canvas" }));

    expect(error.code).toBe("RENDERER_INITIALIZATION_FAILED");
  });

  it("rejects when `canvas` lacks the members this backend uses", async () => {
    const renderer = new WebglRenderer();

    const error = await rejection(
      renderer.initialize({ canvas: { getContext: () => null } }),
    );

    expect(error.code).toBe("RENDERER_INITIALIZATION_FAILED");
  });

  it("rejects when getContext returns null (WebGL 2 unavailable or blocked)", async () => {
    const renderer = new WebglRenderer();

    const error = await rejection(
      renderer.initialize({ canvas: new TestCanvas(null) }),
    );

    expect(error.code).toBe("RENDERER_INITIALIZATION_FAILED");
    expect(error.context?.received).toBe("null");
  });

  it("rejects a WebGL 1 style context that lacks createVertexArray", async () => {
    const gl = createFakeGl() as unknown as Record<string, unknown>;
    delete gl.createVertexArray;
    const renderer = new WebglRenderer();

    const error = await rejection(
      renderer.initialize({ canvas: new TestCanvas(gl) }),
    );

    expect(error.code).toBe("RENDERER_INITIALIZATION_FAILED");
  });

  it("rejects a second initialize with INVALID_APPLICATION_STATE", async () => {
    const { renderer, canvas } = await initialized();

    const error = await rejection(renderer.initialize({ canvas }));

    expect(error.code).toBe("INVALID_APPLICATION_STATE");
  });

  it("sets the fixed GL state: depth test, LEQUAL, CCW, no culling, scissor on", async () => {
    const { gl } = await initialized();

    expect(gl.callsOf("enable").map((call) => call.args[0])).toEqual([
      GL.DEPTH_TEST,
      GL.SCISSOR_TEST,
    ]);
    expect(gl.callsOf("disable").map((call) => call.args[0])).toEqual([
      GL.CULL_FACE,
    ]);
    expect(gl.callsOf("depthFunc")[0].args[0]).toBe(GL.LEQUAL);
    expect(gl.callsOf("frontFace")[0].args[0]).toBe(GL.CCW);
  });

  it("wires both context-loss listeners onto the canvas (§61)", async () => {
    const { canvas } = await initialized();

    expect(canvas.listenerCount("webglcontextlost")).toBe(1);
    expect(canvas.listenerCount("webglcontextrestored")).toBe(1);
  });

  it("adopts the canvas's current size as the drawing-buffer size", async () => {
    const gl = createFakeGl();
    const canvas = new TestCanvas(gl);
    canvas.width = 640;
    canvas.height = 480;
    const renderer = new WebglRenderer();
    await renderer.initialize({ canvas });
    const camera = new TestCamera();
    gl.reset();

    renderer.render(createRoot(), [createView(camera)]);

    expect(gl.callsOf("scissor")[0].args).toEqual([0, 0, 640, 480]);
  });

  it("lets a resize issued before initialize win over the canvas attributes", async () => {
    const gl = createFakeGl();
    const canvas = new TestCanvas(gl);
    const renderer = new WebglRenderer();

    renderer.resize(200, 100, 2);
    await renderer.initialize({ canvas });

    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(200);
  });
});

describe("UnlitProgram — compilation and linking (§61, §89)", () => {
  it("compiles both stages, links, and resolves the six uniforms", () => {
    const gl = createFakeGl();

    const program = UnlitProgram.create(gl);

    expect(gl.countOf("createShader")).toBe(2);
    expect(gl.callsOf("createShader").map((call) => call.args[0])).toEqual([
      GL.VERTEX_SHADER,
      GL.FRAGMENT_SHADER,
    ]);
    expect(gl.countOf("linkProgram")).toBe(1);
    // `map`/`useMap`/`useVertexColors` joined with R-19 (2026-08-07): the
    // pipeline gained two optional multipliers as uniform switches rather than
    // as shader variants, so the program count is still one.
    expect(
      gl.callsOf("getUniformLocation").map((call) => call.args[1]),
    ).toEqual([
      "viewProjection",
      "model",
      "color",
      "map",
      "useMap",
      "useVertexColors",
    ]);
    expect(program.disposed).toBe(false);
  });

  it("emits GLSL ES 3.00 sources with the version directive on line 1", () => {
    const gl = createFakeGl();

    UnlitProgram.create(gl);

    const sources = gl.callsOf("shaderSource").map((call) => call.args[1]);
    for (const source of sources) {
      expect(typeof source).toBe("string");
      expect(String(source).startsWith("#version 300 es\n")).toBe(true);
    }
    expect(String(sources[0])).toContain(
      `layout(location = ${String(POSITION_ATTRIBUTE_LOCATION)}) in vec3 position;`,
    );
    expect(String(sources[1])).toContain("uniform vec4 color;");
  });

  it("deletes both shader objects after a successful link", () => {
    const gl = createFakeGl();

    UnlitProgram.create(gl);

    expect(gl.countOf("deleteShader")).toBe(2);
  });

  it("throws SHADER_COMPILATION_FAILED with the info log when a stage fails", () => {
    const gl = createFakeGl({ compileStatus: false, infoLog: "ERROR: 0:3" });

    const error = thrown(() => {
      UnlitProgram.create(gl);
    });

    expect(error.code).toBe("SHADER_COMPILATION_FAILED");
    expect(error.context?.stage).toBe("vertex");
    expect(error.context?.log).toBe("ERROR: 0:3");
    expect(typeof error.context?.source).toBe("string");
  });

  it("deletes the vertex shader when the fragment stage is the one that fails", () => {
    let compiled = 0;
    const gl = createFakeGl();
    const base = gl.getShaderParameter.bind(gl);
    gl.getShaderParameter = (shader, pname): boolean => {
      base(shader, pname);
      compiled += 1;
      return compiled === 1;
    };

    const error = thrown(() => {
      UnlitProgram.create(gl);
    });

    expect(error.context?.stage).toBe("fragment");
    // One from the failing stage's own cleanup, one for the vertex shader.
    expect(gl.countOf("deleteShader")).toBe(2);
    expect(gl.countOf("createProgram")).toBe(0);
  });

  it("throws SHADER_COMPILATION_FAILED when linking fails, and deletes the program", () => {
    const gl = createFakeGl({ linkStatus: false, infoLog: "link error" });

    const error = thrown(() => {
      UnlitProgram.create(gl);
    });

    expect(error.code).toBe("SHADER_COMPILATION_FAILED");
    expect(error.context?.stage).toBe("link");
    expect(error.context?.log).toBe("link error");
    expect(gl.countOf("deleteProgram")).toBe(1);
  });

  it("reports an empty log when the driver returns null from either getter", () => {
    const compileError = thrown(() => {
      UnlitProgram.create(
        createFakeGl({ compileStatus: false, infoLog: null }),
      );
    });
    const linkError = thrown(() => {
      UnlitProgram.create(createFakeGl({ linkStatus: false, infoLog: null }));
    });

    expect(compileError.context?.log).toBe("");
    expect(linkError.context?.log).toBe("");
  });

  it("throws when GL will not allocate a shader object", () => {
    const gl = createFakeGl({ allocateShaders: false });

    const error = thrown(() => {
      UnlitProgram.create(gl);
    });

    expect(error.code).toBe("SHADER_COMPILATION_FAILED");
    expect(error.context?.stage).toBe("vertex");
  });

  it("throws when GL will not allocate a program object", () => {
    const gl = createFakeGl({ allocatePrograms: false });

    const error = thrown(() => {
      UnlitProgram.create(gl);
    });

    expect(error.code).toBe("SHADER_COMPILATION_FAILED");
    expect(error.context?.stage).toBe("link");
  });

  it("throws when a uniform the backend wrote is missing from the link", () => {
    const gl = createFakeGl({ resolveUniforms: false });

    const error = thrown(() => {
      UnlitProgram.create(gl);
    });

    expect(error.code).toBe("SHADER_COMPILATION_FAILED");
    expect(error.context?.uniform).toBe("viewProjection");
    expect(gl.countOf("deleteProgram")).toBe(1);
  });

  it("propagates a shader failure out of initialize as a rejection", async () => {
    const gl = createFakeGl({ compileStatus: false });
    const renderer = new WebglRenderer();

    const error = await rejection(
      renderer.initialize({ canvas: new TestCanvas(gl) }),
    );

    expect(error.code).toBe("SHADER_COMPILATION_FAILED");
    expect(renderer.initialized).toBe(false);
  });

  it("deletes the GL program once, idempotently", () => {
    const gl = createFakeGl();
    const program = UnlitProgram.create(gl);

    program.dispose();
    program.dispose();

    expect(gl.countOf("deleteProgram")).toBe(1);
    expect(program.disposed).toBe(true);
  });
});

describe("GeometryCache — vertex arrays keyed by id and version (§53, §64)", () => {
  it("uploads positions and indices into one vertex array", () => {
    const gl = createFakeGl();
    const cache = new GeometryCache(gl);
    const geometry = quadGeometry();

    const record = cache.acquire(geometry.asGeometry);

    expect(record).not.toBeNull();
    expect(record?.mode).toBe(GL.TRIANGLES);
    expect(record?.count).toBe(6);
    expect(record?.indexType).toBe(GL.UNSIGNED_SHORT);
    expect(gl.countOf("createVertexArray")).toBe(1);
    expect(gl.countOf("createBuffer")).toBe(2);
    expect(gl.callsOf("vertexAttribPointer")[0].args).toEqual([
      POSITION_ATTRIBUTE_LOCATION,
      3,
      GL.FLOAT,
      false,
      0,
      0,
    ]);
    expect(cache.size).toBe(1);
  });

  it("unbinds the vertex array before clearing ARRAY_BUFFER, never the index binding", () => {
    const gl = createFakeGl();
    new GeometryCache(gl).acquire(quadGeometry().asGeometry);

    const names = gl.names();
    const unbindVao = names.lastIndexOf("bindVertexArray");
    const unbindArray = names.lastIndexOf("bindBuffer");
    expect(unbindVao).toBeLessThan(unbindArray);
    expect(gl.callsOf("bindBuffer").at(-1)?.args).toEqual([
      GL.ARRAY_BUFFER,
      null,
    ]);
  });

  it("creates one buffer and uses drawArrays data for a non-indexed geometry", () => {
    const gl = createFakeGl();
    const record = new GeometryCache(gl).acquire(triangleGeometry().asGeometry);

    expect(record?.indexType).toBeNull();
    expect(record?.count).toBe(3);
    expect(gl.countOf("createBuffer")).toBe(1);
  });

  it("maps the lines draw mode and Uint32 indices onto their GL enumerants", () => {
    const gl = createFakeGl();
    const geometry = new TestGeometry(
      new Float32Array([0, 0, 0, 1, 1, 1]),
      new Uint32Array([0, 1]),
      "lines",
    );

    const record = new GeometryCache(gl).acquire(geometry.asGeometry);

    expect(record?.mode).toBe(GL.LINES);
    expect(record?.indexType).toBe(GL.UNSIGNED_INT);
  });

  it("reuses the cached vertex array while the version is unchanged", () => {
    const gl = createFakeGl();
    const cache = new GeometryCache(gl);
    const geometry = quadGeometry();

    const first = cache.acquire(geometry.asGeometry);
    const second = cache.acquire(geometry.asGeometry);

    expect(second).toBe(first);
    expect(gl.countOf("createVertexArray")).toBe(1);
  });

  it("refreshes data without rebuilding an unchanged layout (§53 cache key)", () => {
    const gl = createFakeGl();
    const cache = new GeometryCache(gl);
    const geometry = quadGeometry();
    cache.acquire(geometry.asGeometry);
    gl.reset();

    geometry.positions[0] = 5;
    geometry.markDirty();
    const record = cache.acquire(geometry.asGeometry);

    expect(gl.countOf("deleteVertexArray")).toBe(0);
    expect(gl.countOf("deleteBuffer")).toBe(0);
    expect(gl.countOf("createVertexArray")).toBe(0);
    expect(gl.countOf("createBuffer")).toBe(0);
    expect(gl.countOf("bufferData")).toBe(2);
    expect(record?.version).toBe(1);
    expect(cache.size).toBe(1);
  });

  it("keeps one entry per geometry id", () => {
    const gl = createFakeGl();
    const cache = new GeometryCache(gl);

    cache.acquire(quadGeometry().asGeometry);
    cache.acquire(triangleGeometry().asGeometry);

    expect(cache.size).toBe(2);
    expect(gl.countOf("createVertexArray")).toBe(2);
  });

  it("returns null and creates no entry for a geometry with nothing to draw", () => {
    const gl = createFakeGl();
    const cache = new GeometryCache(gl);

    const record = cache.acquire(
      new TestGeometry(new Float32Array(0)).asGeometry,
    );

    expect(record).toBeNull();
    expect(cache.size).toBe(0);
    expect(gl.countOf("createVertexArray")).toBe(0);
  });

  it("evicts a disposed geometry lazily, on its next acquire", () => {
    const gl = createFakeGl();
    const cache = new GeometryCache(gl);
    const geometry = quadGeometry();
    cache.acquire(geometry.asGeometry);
    gl.reset();

    geometry.dispose();
    const record = cache.acquire(geometry.asGeometry);

    expect(record).toBeNull();
    expect(cache.size).toBe(0);
    expect(gl.countOf("deleteVertexArray")).toBe(1);
    expect(gl.countOf("deleteBuffer")).toBe(2);
  });

  it("returns null rather than throwing when GL will not allocate a vertex array", () => {
    const gl = createFakeGl({ allocateVertexArrays: false });

    const record = new GeometryCache(gl).acquire(quadGeometry().asGeometry);

    expect(record).toBeNull();
  });

  it("cleans up a partly built record when a buffer allocation fails", () => {
    const gl = createFakeGl({ allocateBuffers: false });

    const record = new GeometryCache(gl).acquire(quadGeometry().asGeometry);

    expect(record).toBeNull();
    expect(gl.countOf("deleteVertexArray")).toBe(1);
  });

  it("deletes the index buffer allocation failure's earlier objects", () => {
    let created = 0;
    const gl = createFakeGl();
    const base = gl.createBuffer.bind(gl);
    gl.createBuffer = (): ReturnType<ParticleGlContext["createBuffer"]> => {
      created += 1;
      const buffer = base();
      return created === 1 ? buffer : null;
    };

    const record = new GeometryCache(gl).acquire(quadGeometry().asGeometry);

    expect(record).toBeNull();
    expect(gl.countOf("deleteBuffer")).toBe(1);
    expect(gl.countOf("deleteVertexArray")).toBe(1);
  });

  it("deletes every vertex array and buffer on dispose, idempotently", () => {
    const gl = createFakeGl();
    const cache = new GeometryCache(gl);
    cache.acquire(quadGeometry().asGeometry);
    cache.acquire(triangleGeometry().asGeometry);
    gl.reset();

    cache.dispose();
    cache.dispose();

    expect(gl.countOf("deleteVertexArray")).toBe(2);
    expect(gl.countOf("deleteBuffer")).toBe(3);
    expect(cache.size).toBe(0);
    expect(cache.disposed).toBe(true);
  });

  it("forget() drops records without touching the context (§61 loss)", () => {
    const gl = createFakeGl();
    const cache = new GeometryCache(gl);
    cache.acquire(quadGeometry().asGeometry);
    gl.reset();

    cache.forget();

    expect(cache.size).toBe(0);
    expect(gl.calls).toHaveLength(0);
  });
});

describe("WebglRenderer.render — viewport and clear semantics (§61, §48)", () => {
  it("sets the scissor rectangle before the viewport, and clears after both", async () => {
    const { renderer, gl, camera } = await initialized();
    gl.reset();

    renderer.render(createRoot(), [
      createView(camera, { clearColor: [0.1, 0.2, 0.3, 1] }),
    ]);

    const names = gl.names();
    expect(indexOf(gl, "scissor")).toBeLessThan(indexOf(gl, "viewport"));
    expect(indexOf(gl, "viewport")).toBeLessThan(indexOf(gl, "clearColor"));
    expect(indexOf(gl, "clearColor")).toBeLessThan(indexOf(gl, "clear"));
    expect(names).toContain("clearDepth");
  });

  it("resolves a normalized rectangle against the drawing-buffer size", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.resize(400, 300, 2);
    gl.reset();

    renderer.render(createRoot(), [
      createView(camera, { x: 0.5, y: 0, width: 0.5, height: 1 }),
    ]);

    expect(gl.callsOf("scissor")[0].args).toEqual([400, 0, 400, 600]);
    expect(gl.callsOf("viewport")[0].args).toEqual([400, 0, 400, 600]);
  });

  it("uses an unnormalized rectangle as drawing-buffer pixels, unscaled", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.resize(400, 300, 2);
    gl.reset();

    renderer.render(createRoot(), [
      createView(camera, {
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        normalized: false,
      }),
    ]);

    expect(gl.callsOf("scissor")[0].args).toEqual([10, 20, 100, 50]);
  });

  it("keeps the bottom-left origin unflipped — GL's convention is already §7a's", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.resize(200, 100);
    gl.reset();

    // A view pinned to the bottom half of the surface.
    renderer.render(createRoot(), [
      createView(camera, { x: 0, y: 0, width: 1, height: 0.5 }),
    ]);

    expect(gl.callsOf("viewport")[0].args).toEqual([0, 0, 200, 50]);
  });

  it("clamps a negative extent to zero rather than passing a GL error along", async () => {
    const { renderer, gl, camera } = await initialized();
    gl.reset();

    renderer.render(createRoot(), [
      createView(camera, { width: -0.5, normalized: true }),
    ]);

    expect(gl.callsOf("scissor")[0].args[2]).toBe(0);
  });

  it("clears colour and depth together when the view carries a clearColor", async () => {
    const { renderer, gl, camera } = await initialized();
    gl.reset();

    renderer.render(createRoot(), [
      createView(camera, { clearColor: [0.25, 0.5, 0.75, 1] }),
    ]);

    expect(gl.callsOf("clearColor")[0].args).toEqual([0.25, 0.5, 0.75, 1]);
    expect(gl.callsOf("clearDepth")[0].args).toEqual([1]);
    expect(gl.callsOf("clear")[0].args).toEqual([
      GL.DEPTH_BUFFER_BIT | GL.COLOR_BUFFER_BIT,
    ]);
  });

  it("clears depth only when clearColor is absent (§61 composite-over case)", async () => {
    const { renderer, gl, camera } = await initialized();
    gl.reset();

    renderer.render(createRoot(), [createView(camera)]);

    expect(gl.countOf("clearColor")).toBe(0);
    expect(gl.callsOf("clear")[0].args).toEqual([GL.DEPTH_BUFFER_BIT]);
  });

  it("draws views in array order, each with its own rectangle and clear", async () => {
    const { renderer, gl, camera } = await initialized();
    const second = new TestCamera();
    gl.reset();

    renderer.render(createRoot(), [
      createView(camera, { id: "main" }),
      createView(second, {
        id: "minimap",
        x: 0,
        y: 0,
        width: 0.25,
        height: 0.25,
      }),
    ]);

    expect(gl.callsOf("scissor").map((call) => call.args[2])).toEqual([
      300, 75,
    ]);
    expect(gl.countOf("clear")).toBe(2);
    expect(camera.updateViewMatrixCalls).toBe(1);
    expect(second.updateViewMatrixCalls).toBe(1);
  });

  it("draws and clears nothing at all when the view list is empty (§61)", async () => {
    const { renderer, gl } = await initialized();
    gl.reset();

    renderer.render(createRoot(), []);

    expect(gl.calls).toHaveLength(0);
  });

  it("throws INVALID_APPLICATION_STATE when rendering before initialize", () => {
    const renderer = new WebglRenderer();
    const camera = new TestCamera();

    const error = thrown(() => {
      renderer.render(createRoot(), [createView(camera)]);
    });

    expect(error.code).toBe("INVALID_APPLICATION_STATE");
  });
});

describe("WebglRenderer.render — per-item scissor (§67)", () => {
  it("issues no extra scissor calls when no item names a rectangle", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.resize(640, 480);
    const root = createRoot();
    root.add(renderable(quadGeometry()));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.callsOf("scissor")).toHaveLength(1);
    expect(gl.callsOf("scissor")[0]?.args).toEqual([0, 0, 640, 480]);
  });

  it("intersects the item rectangle with the view and restores it after", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.resize(640, 480);
    const root = createRoot();
    const child = renderable(quadGeometry());
    child.scissor = { x: 100, y: 50, width: 200, height: 100 };
    root.add(child);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    const scissors = gl.callsOf("scissor").map((call) => call.args);
    expect(scissors[0]).toEqual([0, 0, 640, 480]);
    expect(scissors).toContainEqual([100, 50, 200, 100]);
    expect(scissors.at(-1)).toEqual([0, 0, 640, 480]);
  });
});

describe("WebglRenderer.render — uniforms and draws (§64, §57)", () => {
  it("uploads projection · view once per view, then a model matrix per item", async () => {
    const { renderer, gl, camera } = await initialized();
    camera.projectionMatrix.identity();
    camera.viewMatrix.identity();
    const root = createRoot();
    const child = renderable(quadGeometry());
    child.transform.worldMatrix.fromArray([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1,
    ]);
    root.add(child);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    const uploads = gl.callsOf("uniformMatrix4fv");
    expect(uploads).toHaveLength(2);
    expect(uploads[0].args[0]).toBe(gl.uniformLocations.get("viewProjection"));
    expect(uploads[0].args[1]).toBe(false);
    expect(uploads[1].args[0]).toBe(gl.uniformLocations.get("model"));
    expect(uploads[1].args[2]).toEqual([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1,
    ]);
  });

  it("multiplies the camera's projection by its view matrix, in that order", async () => {
    const { renderer, gl, camera } = await initialized();
    camera.projectionMatrix.setOrthographic(-2, 2, -1, 1, 0.1, 10);
    camera.viewMatrix.identity();
    camera.viewMatrix.elements[12] = -3;
    const expected = camera.projectionMatrix
      .clone()
      .multiply(camera.viewMatrix);
    gl.reset();

    renderer.render(createRoot(), [createView(camera)]);

    expect(gl.callsOf("uniformMatrix4fv")[0].args[2]).toEqual(
      Array.from(new Float32Array(expected.elements)),
    );
  });

  it("updates the camera's view matrix before uploading it (§47)", async () => {
    const { renderer, camera } = await initialized();

    renderer.render(createRoot(), [createView(camera)]);
    renderer.render(createRoot(), [createView(camera)]);

    expect(camera.updateViewMatrixCalls).toBe(2);
  });

  it("uploads each item's material colour (§57 straight-alpha RGBA)", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(quadGeometry(), new TestMaterial([1, 0, 0, 1])));
    root.add(
      renderable(triangleGeometry(), new TestMaterial([0, 0.5, 1, 0.25])),
    );
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.callsOf("uniform4fv").map((call) => call.args[1])).toEqual([
      [1, 0, 0, 1],
      [0, 0.5, 1, 0.25],
    ]);
  });

  it("issues drawElements for indexed geometry with count, type, and offset", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(quadGeometry()));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.callsOf("drawElements")[0].args).toEqual([
      GL.TRIANGLES,
      6,
      GL.UNSIGNED_SHORT,
      0,
    ]);
    expect(gl.countOf("drawArrays")).toBe(0);
  });

  it("issues drawArrays for non-indexed geometry", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(triangleGeometry()));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.callsOf("drawArrays")[0].args).toEqual([GL.TRIANGLES, 0, 3]);
    expect(gl.countOf("drawElements")).toBe(0);
  });

  it("binds the item's vertex array before drawing it", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(triangleGeometry()));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    const names = gl.names();
    expect(names.indexOf("bindVertexArray")).toBeLessThan(
      names.indexOf("drawArrays"),
    );
  });

  it("leaves no vertex array bound when the frame ends", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(triangleGeometry()));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.callsOf("bindVertexArray").at(-1)?.args).toEqual([null]);
  });

  it("uploads geometry once and draws it twice across two frames", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(quadGeometry()));
    gl.reset();

    renderer.render(root, [createView(camera)]);
    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("createVertexArray")).toBe(1);
    expect(gl.countOf("drawElements")).toBe(2);
  });

  it("shares one vertex array between renderables that share a geometry", async () => {
    const { renderer, gl, camera } = await initialized();
    const geometry = quadGeometry();
    const root = createRoot();
    root.add(renderable(geometry), renderable(geometry));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("createVertexArray")).toBe(1);
    expect(gl.countOf("drawElements")).toBe(2);
  });

  it("re-uploads a geometry whose version advanced between frames", async () => {
    const { renderer, gl, camera } = await initialized();
    const geometry = quadGeometry();
    const root = createRoot();
    root.add(renderable(geometry));
    renderer.render(root, [createView(camera)]);
    gl.reset();

    geometry.markDirty();
    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("deleteVertexArray")).toBe(0);
    expect(gl.countOf("createVertexArray")).toBe(0);
    expect(gl.countOf("bufferData")).toBe(2);
    expect(gl.countOf("drawElements")).toBe(1);
  });

  it("skips a render item whose geometry has nothing to draw", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(new TestGeometry(new Float32Array(0))));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("drawArrays")).toBe(0);
    expect(gl.countOf("drawElements")).toBe(0);
    expect(gl.countOf("uniform4fv")).toBe(0);
  });

  it("honours §64 filtering: a hidden subtree contributes no draw", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const hidden = renderable(quadGeometry());
    hidden.visible = false;
    root.add(hidden);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("drawElements")).toBe(0);
  });

  it("draws every item once per view", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(quadGeometry()), renderable(triangleGeometry()));
    gl.reset();

    renderer.render(root, [createView(camera), createView(new TestCamera())]);

    expect(gl.countOf("drawElements")).toBe(2);
    expect(gl.countOf("drawArrays")).toBe(2);
    expect(gl.countOf("useProgram")).toBe(1);
  });
});

describe("WebglRenderer.render — §46 layer filtering (R-38, §47, §48)", () => {
  /**
   * A root with two drawables on different §46 layers: `world` on the default
   * layer (bit 0, drawn with `drawElements`) and `panel` on bit 1 (drawn with
   * `drawArrays`), so the two are told apart by which entry point fired.
   */
  function layeredRoot(): Renderable {
    const root = createRoot();
    const world = renderable(quadGeometry());
    const panel = renderable(triangleGeometry());
    panel.layers = 0b10;
    root.add(world, panel);
    return root;
  }

  it("draws everything when neither the view nor the camera narrows (no-op)", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = layeredRoot();
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("drawElements")).toBe(1);
    expect(gl.countOf("drawArrays")).toBe(1);
  });

  it("skips an item whose layers miss the viewport's mask (§48)", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = layeredRoot();
    gl.reset();

    renderer.render(root, [createView(camera, { layerMask: 0b01 })]);

    expect(gl.countOf("drawElements")).toBe(1);
    expect(gl.countOf("drawArrays")).toBe(0);
  });

  it("falls back to the camera's own mask when the viewport sets none (§47)", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = layeredRoot();
    camera.sees(0b10);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("drawElements")).toBe(0);
    expect(gl.countOf("drawArrays")).toBe(1);
  });

  it("lets the viewport override a camera that would have seen more", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = layeredRoot();
    camera.sees(0b11);
    gl.reset();

    renderer.render(root, [createView(camera, { layerMask: 0b10 })]);

    expect(gl.countOf("drawElements")).toBe(0);
    expect(gl.countOf("drawArrays")).toBe(1);
  });

  it("draws two different slices of one list into two views (the §48 case)", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = layeredRoot();
    gl.reset();

    renderer.render(root, [
      createView(camera, { id: "world", layerMask: 0b01 }),
      createView(camera, { id: "ui", layerMask: 0b10 }),
    ]);

    // Two views, two clears, but each item drawn exactly once — which is the
    // whole point of the field: a screen-space overlay stops costing a second
    // full pass over the world.
    expect(gl.countOf("clear")).toBe(2);
    expect(gl.countOf("drawElements")).toBe(1);
    expect(gl.countOf("drawArrays")).toBe(1);
  });

  it("draws nothing into a view that selects no layer at all", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = layeredRoot();
    gl.reset();

    renderer.render(root, [createView(camera, { layerMask: 0 })]);

    // Cleared, but nothing drawn: the rectangle is still this view's.
    expect(gl.countOf("clearDepth")).toBe(1);
    expect(gl.countOf("drawElements")).toBe(0);
    expect(gl.countOf("drawArrays")).toBe(0);
  });

  it("never acquires a GPU resource for an item it filters out", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const panel = renderable(triangleGeometry());
    panel.layers = 0b10;
    root.add(panel);
    gl.reset();

    renderer.render(root, [createView(camera, { layerMask: 0b01 })]);

    // The filter runs before `geometries.acquire`, so a layer nobody views
    // costs no buffer, no vertex array, and no upload.
    expect(gl.countOf("createBuffer")).toBe(0);
    expect(gl.countOf("createVertexArray")).toBe(0);
    expect(gl.countOf("drawArrays")).toBe(0);
  });
});

describe("WebglRenderer.render — §43 interpolated poses (WP-3.6)", () => {
  /** A root with one drawable child; the root itself draws nothing. */
  function interpolationScene(): { root: Renderable; child: Renderable } {
    const root = createRoot();
    const child = renderable(quadGeometry());
    root.add(child);
    return { root, child };
  }

  it("draws the render pose at alpha, not the resolved world matrix", async () => {
    const { renderer, gl, camera } = await initialized();
    const { root, child } = interpolationScene();
    // The world matrix says one thing, the captured poses another: only the
    // interpolated list can produce the alpha-blended answer.
    child.transform.worldMatrix.fromArray([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -99, -99, -99, 1,
    ]);
    const poses = new TestPoseBuffer().track(
      child,
      new Vector3(0, 0, 0),
      new Vector3(10, 0, 0),
    );

    gl.reset();
    renderer.render(root, [createView(camera)], interpolationAt(poses, 0));
    const atZero = modelUploads(gl);

    gl.reset();
    renderer.render(root, [createView(camera)], interpolationAt(poses, 1));
    const atOne = modelUploads(gl);

    gl.reset();
    renderer.render(root, [createView(camera)], interpolationAt(poses, 0.25));
    const atQuarter = modelUploads(gl);

    expect(atZero).toHaveLength(1);
    expect(atOne).toHaveLength(1);
    expect(atZero[0].slice(12, 15)).toEqual([0, 0, 0]);
    expect(atOne[0].slice(12, 15)).toEqual([10, 0, 0]);
    expect(atQuarter[0].slice(12, 15)).toEqual([2.5, 0, 0]);
    // The point of §43: the same scene, a different alpha, a different frame.
    expect(atZero[0]).not.toEqual(atOne[0]);
  });

  it("passes the frame's alpha through to the pose buffer unchanged", async () => {
    const { renderer, camera } = await initialized();
    const { root, child } = interpolationScene();
    const poses = new TestPoseBuffer().track(
      child,
      new Vector3(0, 0, 0),
      new Vector3(4, 0, 0),
    );

    renderer.render(root, [createView(camera)], interpolationAt(poses, 0.75));

    expect(poses.alphas).toEqual([0.75]);
  });

  it("uses the live local transform of a node the buffer does not track", async () => {
    const { renderer, gl, camera } = await initialized();
    const { root, child } = interpolationScene();
    child.transform.position.set(1, 2, 3);
    const poses = new TestPoseBuffer();

    gl.reset();
    renderer.render(root, [createView(camera)], interpolationAt(poses, 0.5));

    expect(poses.alphas).toEqual([]);
    expect(modelUploads(gl)[0].slice(12, 15)).toEqual([1, 2, 3]);
  });

  it("never writes a render pose back into the scene (§42, §43)", async () => {
    const { renderer, camera } = await initialized();
    const { root, child } = interpolationScene();
    const poses = new TestPoseBuffer().track(
      child,
      new Vector3(0, 0, 0),
      new Vector3(10, 0, 0),
    );
    const version = child.transform.version;

    renderer.render(root, [createView(camera)], interpolationAt(poses, 0.5));

    const { x, y, z } = child.transform.position;
    expect([x, y, z]).toEqual([0, 0, 0]);
    expect(child.transform.version).toBe(version);
  });

  it("builds the ordinary render list when no interpolation is passed", async () => {
    const { renderer, gl, camera } = await initialized();
    const { root, child } = interpolationScene();
    child.transform.worldMatrix.fromArray([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 7, 8, 9, 1,
    ]);
    const poses = new TestPoseBuffer().track(
      child,
      new Vector3(0, 0, 0),
      new Vector3(10, 0, 0),
    );
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // The resolved world matrix, and the buffer was never consulted: the
    // non-interpolated path is a matter of omitting the argument, not of
    // configuring the renderer.
    expect(modelUploads(gl)[0].slice(12, 15)).toEqual([7, 8, 9]);
    expect(poses.alphas).toEqual([]);
  });

  it("skips the frame while the context is lost, interpolation and all (§61)", async () => {
    const { renderer, canvas, camera } = await initialized();
    const { root, child } = interpolationScene();
    const poses = new TestPoseBuffer().track(
      child,
      new Vector3(0, 0, 0),
      new Vector3(10, 0, 0),
    );
    canvas.dispatch("webglcontextlost");

    expect(() => {
      renderer.render(root, [createView(camera)], interpolationAt(poses, 0.5));
    }).not.toThrow();
    expect(poses.alphas).toEqual([]);
  });
});

describe("WebglRenderer — resize (§61, §45)", () => {
  it("scales the drawing buffer by the resolution", async () => {
    const { renderer, canvas } = await initialized();

    renderer.resize(800, 600, 2);

    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
  });

  it("defaults the resolution to 1", async () => {
    const { renderer, canvas } = await initialized();

    renderer.resize(640, 480);

    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(480);
  });

  it("does not touch cameras (§47 explicit recomputation)", async () => {
    const { renderer, camera } = await initialized();
    const before = camera.projectionMatrix.clone();

    renderer.resize(1024, 768);

    expect(Array.from(camera.projectionMatrix.elements)).toEqual(
      Array.from(before.elements),
    );
  });

  it("records the size but leaves the surface alone while the context is lost", async () => {
    const { renderer, canvas } = await initialized();
    canvas.dispatch("webglcontextlost");

    renderer.resize(800, 600);

    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(150);
  });
});

describe("WebglRenderer — context loss and restore (§61)", () => {
  it("prevents the default on webglcontextlost, without which restore never fires", async () => {
    const { canvas } = await initialized();

    expect(canvas.dispatch("webglcontextlost")).toBe(true);
  });

  it("emits contextlost with the renderer, after marking itself lost", async () => {
    const { renderer, canvas } = await initialized();
    let observed: { lostAtDispatch: boolean } | null = null;
    renderer.events.on("contextlost", (event) => {
      expect(event.renderer).toBe(renderer);
      observed = { lostAtDispatch: renderer.contextLost };
    });

    canvas.dispatch("webglcontextlost");

    expect(observed).toEqual({ lostAtDispatch: true });
  });

  it("emits contextlost once even if the event arrives twice", async () => {
    const { renderer, canvas } = await initialized();
    let count = 0;
    renderer.events.on("contextlost", () => {
      count += 1;
    });

    canvas.dispatch("webglcontextlost");
    canvas.dispatch("webglcontextlost");

    expect(count).toBe(1);
  });

  it("issues no GL call while losing the context — every handle is already dead", async () => {
    const { gl, canvas } = await initialized();
    gl.reset();

    canvas.dispatch("webglcontextlost");

    expect(gl.calls).toHaveLength(0);
  });

  it("returns from render silently while lost, and never throws (§61)", async () => {
    const { renderer, gl, canvas, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(quadGeometry()));
    canvas.dispatch("webglcontextlost");
    gl.reset();

    expect(() => {
      renderer.render(root, [createView(camera)]);
    }).not.toThrow();
    expect(gl.calls).toHaveLength(0);
  });

  it("re-creates every program and the fixed state on restore", async () => {
    const { renderer, gl, canvas } = await initialized();
    canvas.dispatch("webglcontextlost");
    gl.reset();

    canvas.dispatch("webglcontextrestored");

    // Unlit, sprite (WP-3a.3) and lit (§68, 2026-08-04): §61 requires
    // engine-owned GPU resources to be re-created before `contextrestored`
    // is emitted, and every eager pipeline is. The particle, effect, shadow
    // and standard pipelines are registered seams since 2026-09-11 and come
    // back lazily, on the next draw that needs them — the skinned pair's
    // rule (see their own suites).
    expect(gl.countOf("createProgram")).toBe(3);
    expect(gl.callsOf("enable").map((call) => call.args[0])).toEqual([
      GL.DEPTH_TEST,
      GL.SCISSOR_TEST,
    ]);
    expect(renderer.contextLost).toBe(false);
  });

  it("emits contextrestored after the rebuild, so the first frame draws", async () => {
    const { renderer, gl, canvas, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(triangleGeometry()));
    canvas.dispatch("webglcontextlost");
    let drewInListener = 0;
    renderer.events.on("contextrestored", (event) => {
      expect(event.renderer).toBe(renderer);
      gl.reset();
      renderer.render(root, [createView(camera)]);
      drewInListener = gl.countOf("drawArrays");
    });

    canvas.dispatch("webglcontextrestored");

    expect(drewInListener).toBe(1);
  });

  it("re-creates vertex arrays after a restore rather than reusing dead handles", async () => {
    const { renderer, gl, canvas, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(quadGeometry()));
    renderer.render(root, [createView(camera)]);
    canvas.dispatch("webglcontextlost");
    canvas.dispatch("webglcontextrestored");
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("createVertexArray")).toBe(1);
    expect(gl.countOf("deleteVertexArray")).toBe(0);
    expect(gl.countOf("drawElements")).toBe(1);
  });

  it("re-applies the size recorded while the context was lost", async () => {
    const { renderer, canvas } = await initialized();
    canvas.dispatch("webglcontextlost");
    renderer.resize(800, 600);

    canvas.dispatch("webglcontextrestored");

    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
  });

  it("re-reads capabilities on restore", async () => {
    const { renderer, canvas } = await initialized({ maxTextureSize: 2048 });
    canvas.dispatch("webglcontextlost");

    canvas.dispatch("webglcontextrestored");

    expect(renderer.capabilities.maxTextureSize).toBe(2048);
  });

  it("ignores webglcontextrestored when the context was never lost", async () => {
    const { renderer, gl, canvas } = await initialized();
    let restored = 0;
    renderer.events.on("contextrestored", () => {
      restored += 1;
    });
    gl.reset();

    canvas.dispatch("webglcontextrestored");

    expect(restored).toBe(0);
    expect(gl.calls).toHaveLength(0);
  });

  it("stays lost and emits nothing when the program will not rebuild", async () => {
    const gl = createFakeGl();
    const canvas = new TestCanvas(gl);
    const renderer = new WebglRenderer();
    await renderer.initialize({ canvas });
    let restored = 0;
    renderer.events.on("contextrestored", () => {
      restored += 1;
    });
    canvas.dispatch("webglcontextlost");
    gl.getShaderParameter = (): boolean => false;

    expect(() => {
      canvas.dispatch("webglcontextrestored");
    }).toThrow(FourError);
    expect(restored).toBe(0);
    expect(renderer.contextLost).toBe(true);
  });
});

describe("WebglRenderer — disposal (§83)", () => {
  it("deletes every program and every vertex array", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(quadGeometry()), renderable(triangleGeometry()));
    renderer.render(root, [createView(camera)]);
    gl.reset();

    renderer.dispose();

    // The three eager programs; nothing in this scene acquired a registered
    // pipeline (2026-09-11).
    expect(gl.countOf("deleteProgram")).toBe(3);
    expect(gl.countOf("deleteVertexArray")).toBe(2);
    expect(gl.countOf("deleteBuffer")).toBe(3);
    expect(renderer.disposed).toBe(true);
  });

  it("removes both canvas listeners and every emitter listener", async () => {
    const { renderer, canvas } = await initialized();
    renderer.events.on("contextlost", () => undefined);

    renderer.dispose();

    expect(canvas.listenerCount("webglcontextlost")).toBe(0);
    expect(canvas.listenerCount("webglcontextrestored")).toBe(0);
    expect(renderer.events.listenerCount("contextlost")).toBe(0);
  });

  it("is idempotent", async () => {
    const { renderer, gl } = await initialized();
    gl.reset();

    renderer.dispose();
    renderer.dispose();

    expect(gl.countOf("deleteProgram")).toBe(3);
  });

  it("succeeds during a lost context, without touching the context", async () => {
    const { renderer, gl, canvas } = await initialized();
    canvas.dispatch("webglcontextlost");
    gl.reset();

    renderer.dispose();

    expect(gl.calls).toHaveLength(0);
    expect(renderer.disposed).toBe(true);
    expect(canvas.listenerCount("webglcontextlost")).toBe(0);
  });

  it("throws INVALID_APPLICATION_STATE from render after disposal", async () => {
    const { renderer, camera } = await initialized();
    renderer.dispose();

    const error = thrown(() => {
      renderer.render(createRoot(), [createView(camera)]);
    });

    expect(error.code).toBe("INVALID_APPLICATION_STATE");
  });

  it("throws INVALID_APPLICATION_STATE from resize after disposal", async () => {
    const { renderer } = await initialized();
    renderer.dispose();

    const error = thrown(() => {
      renderer.resize(100, 100);
    });

    expect(error.code).toBe("INVALID_APPLICATION_STATE");
  });

  it("rejects initialize after disposal", async () => {
    const { renderer, canvas } = await initialized();
    renderer.dispose();

    const error = await rejection(renderer.initialize({ canvas }));

    expect(error.code).toBe("INVALID_APPLICATION_STATE");
  });

  it("ignores a context-loss event that arrives after disposal", async () => {
    const { renderer, canvas } = await initialized();
    const listeners = [...(canvas.listeners.get("webglcontextlost") ?? [])];
    renderer.dispose();

    for (const listener of listeners) {
      listener({ preventDefault: () => undefined });
    }

    expect(renderer.contextLost).toBe(false);
  });
});

describe("SpriteProgram — compilation and linking (§55, §61, §89)", () => {
  it("compiles both stages, links, and resolves the four uniforms", () => {
    const gl = createFakeGl();

    const program = SpriteProgram.create(gl);

    expect(gl.countOf("createShader")).toBe(2);
    expect(gl.countOf("linkProgram")).toBe(1);
    expect(
      gl.callsOf("getUniformLocation").map((call) => call.args[1]),
    ).toEqual(["viewProjection", "model", "tint", "map"]);
    expect(program.disposed).toBe(false);
  });

  it("emits GLSL ES 3.00 sources binding position at the shared location", () => {
    const gl = createFakeGl();

    SpriteProgram.create(gl);

    const sources = gl.callsOf("shaderSource").map((call) => call.args[1]);
    for (const source of sources) {
      expect(String(source).startsWith("#version 300 es\n")).toBe(true);
    }
    // The same attribute slot the unlit pipeline uses, which is what lets one
    // geometry cache serve both.
    expect(String(sources[0])).toContain(
      `layout(location = ${String(POSITION_ATTRIBUTE_LOCATION)}) in vec3 position`,
    );
    // Atlas UVs are an authored attribute; the retired `quad` uniform is gone.
    expect(String(sources[0])).toContain(
      `layout(location = ${String(UV_ATTRIBUTE_LOCATION)}) in vec2 uv`,
    );
    expect(String(sources[0])).not.toContain("uniform vec4 quad");
    expect(String(sources[1])).toContain("texture(map, vUv) * tint");
  });

  it("fails with SHADER_COMPILATION_FAILED, naming the sprite pipeline", () => {
    const error = thrown(() => {
      SpriteProgram.create(createFakeGl({ compileStatus: false }));
    });

    expect(error.code).toBe("SHADER_COMPILATION_FAILED");
    expect(error.context?.stage).toBe("vertex");
    expect(error.message).toContain("sprite");
  });

  it("deletes the program when a uniform is missing from the link", () => {
    const gl = createFakeGl({ resolveUniforms: false });

    const error = thrown(() => {
      SpriteProgram.create(gl);
    });

    expect(error.context?.uniform).toBe("viewProjection");
    expect(gl.countOf("deleteProgram")).toBe(1);
  });

  it("deletes the GL program once, idempotently", () => {
    const gl = createFakeGl();
    const program = SpriteProgram.create(gl);

    program.dispose();
    program.dispose();

    expect(gl.countOf("deleteProgram")).toBe(1);
    expect(program.disposed).toBe(true);
  });
});

describe("TextureCache — textures keyed by id and version (§77, §61)", () => {
  it("uploads RGBA8 texels with clamped, linearly filtered sampler state", () => {
    const gl = createFakeGl();
    const cache = new TextureCache(gl);
    const data = new Uint8Array(2 * 3 * 4);
    const texture = new TestTexture(2, 3, data);

    const record = cache.acquire(texture.asTexture);

    expect(record).not.toBeNull();
    expect(gl.countOf("createTexture")).toBe(1);
    expect(gl.callsOf("texImage2D")[0].args).toEqual([
      GL.TEXTURE_2D,
      0,
      GL.RGBA8,
      2,
      3,
      0,
      GL.RGBA,
      GL.UNSIGNED_BYTE,
      Array.from(data),
    ]);
    expect(
      gl.callsOf("texParameteri").map((call) => [call.args[1], call.args[2]]),
    ).toEqual([
      [GL.TEXTURE_MIN_FILTER, GL.LINEAR],
      [GL.TEXTURE_MAG_FILTER, GL.LINEAR],
      [GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE],
      [GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE],
    ]);
    // Nothing left bound: an upload mid-frame must not displace the texture
    // being drawn.
    expect(gl.callsOf("bindTexture").at(-1)?.args).toEqual([
      GL.TEXTURE_2D,
      null,
    ]);
    expect(cache.size).toBe(1);
  });

  it("allocates SRGB8_ALPHA8 for an sRGB-tagged texture, RGBA8 otherwise (§60a)", () => {
    // R-15, 2026-08-08. The tag is opt-in and read defensively, so a double
    // that predates the field — every other one in this file — still uploads
    // the byte-identical RGBA8 call it always did.
    const gl = createFakeGl();
    const cache = new TextureCache(gl);
    const untagged = new TestTexture(1, 1);
    const tagged = new TestTexture(1, 1);
    tagged.colorSpace = "srgb";

    cache.acquire(untagged.asTexture);
    cache.acquire(tagged.asTexture);

    expect(gl.callsOf("texImage2D").map((call) => call.args[2])).toEqual([
      GL.RGBA8,
      GL.SRGB8_ALPHA8,
    ]);
  });

  it("writes the texture's own filter and wrap (§77, R-30)", () => {
    const gl = createFakeGl();
    const cache = new TextureCache(gl);
    const texture = new TestTexture(2, 2);
    texture.filter = "nearest";
    texture.wrap = "repeat";

    cache.acquire(texture.asTexture);

    expect(
      gl.callsOf("texParameteri").map((call) => [call.args[1], call.args[2]]),
    ).toEqual([
      [GL.TEXTURE_MIN_FILTER, GL.NEAREST],
      [GL.TEXTURE_MAG_FILTER, GL.NEAREST],
      [GL.TEXTURE_WRAP_S, GL.REPEAT],
      [GL.TEXTURE_WRAP_T, GL.REPEAT],
    ]);
  });

  it("maps mirrored-repeat, and every unset field to its default (§77, R-30)", () => {
    const gl = createFakeGl();
    const cache = new TextureCache(gl);
    const mirrored = new TestTexture(1, 1);
    mirrored.wrap = "mirrored-repeat";
    const linear = new TestTexture(1, 1);
    linear.filter = "linear";
    linear.wrap = "clamp-to-edge";

    cache.acquire(mirrored.asTexture);
    cache.acquire(linear.asTexture);

    const written = gl
      .callsOf("texParameteri")
      .map((call) => [call.args[1], call.args[2]]);
    expect(written.slice(0, 4)).toEqual([
      // The filter is unset on this one: the default arm of `glFilter`.
      [GL.TEXTURE_MIN_FILTER, GL.LINEAR],
      [GL.TEXTURE_MAG_FILTER, GL.LINEAR],
      [GL.TEXTURE_WRAP_S, GL.MIRRORED_REPEAT],
      [GL.TEXTURE_WRAP_T, GL.MIRRORED_REPEAT],
    ]);
    // Naming the defaults explicitly must produce the identical four calls a
    // texture that names neither produces — the byte-identity claim, from the
    // other direction.
    expect(written.slice(4)).toEqual([
      [GL.TEXTURE_MIN_FILTER, GL.LINEAR],
      [GL.TEXTURE_MAG_FILTER, GL.LINEAR],
      [GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE],
      [GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE],
    ]);
  });

  it("adds nothing at all for a texture naming no mipmaps or anisotropy (R-30b)", () => {
    // The byte-identity claim, structurally: the whole recorded transcript of
    // an ordinary upload, in order, with no `generateMipmap`, no
    // `getExtension`, and no fifth `texParameteri` — even though this context
    // offers all three.
    const gl = createFakeGl();
    const cache = new TextureCache(gl);

    cache.acquire(new TestTexture(2, 2).asTexture);

    expect(gl.names()).toEqual([
      "createTexture",
      "bindTexture",
      "texImage2D",
      "texParameteri",
      "texParameteri",
      "texParameteri",
      "texParameteri",
      "bindTexture",
    ]);
  });

  it("generates the mip chain and writes the derived min filter (§77, R-30b)", () => {
    const gl = createFakeGl();
    const cache = new TextureCache(gl);
    const texture = new TestTexture(4, 4);
    texture.mipmaps = true;
    texture.minFilter = "linear-mipmap-linear";

    cache.acquire(texture.asTexture);

    // Ordering matters: the chain must exist before a mip-choosing min filter
    // is written, and `generateMipmap` reads the level-0 image.
    expect(gl.names().slice(0, 5)).toEqual([
      "createTexture",
      "bindTexture",
      "texImage2D",
      "generateMipmap",
      "texParameteri",
    ]);
    expect(
      gl.callsOf("texParameteri").map((call) => [call.args[1], call.args[2]]),
    ).toEqual([
      [GL.TEXTURE_MIN_FILTER, GL.LINEAR_MIPMAP_LINEAR],
      // Magnification has no levels to choose between: it stays `filter`.
      [GL.TEXTURE_MAG_FILTER, GL.LINEAR],
      [GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE],
      [GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE],
    ]);
  });

  it("maps every mip-choosing min filter to its GL enum (§77, R-30b)", () => {
    const gl = createFakeGl();
    const cache = new TextureCache(gl);
    const expected = [
      ["nearest", GL.NEAREST],
      ["nearest-mipmap-nearest", GL.NEAREST_MIPMAP_NEAREST],
      ["linear-mipmap-nearest", GL.LINEAR_MIPMAP_NEAREST],
      ["nearest-mipmap-linear", GL.NEAREST_MIPMAP_LINEAR],
      ["linear-mipmap-linear", GL.LINEAR_MIPMAP_LINEAR],
      ["linear", GL.LINEAR],
    ] as const;

    for (const [minFilter] of expected) {
      const texture = new TestTexture(2, 2);
      texture.mipmaps = true;
      texture.minFilter = minFilter;
      cache.acquire(texture.asTexture);
    }

    expect(
      gl
        .callsOf("texParameteri")
        .filter((call) => call.args[1] === GL.TEXTURE_MIN_FILTER)
        .map((call) => call.args[2]),
    ).toEqual(expected.map(([, value]) => value));
  });

  it("derives the min filter from `filter` when the texture names none (R-30b)", () => {
    const gl = createFakeGl();
    const cache = new TextureCache(gl);
    const smooth = new TestTexture(2, 2);
    smooth.mipmaps = true;
    const crisp = new TestTexture(2, 2);
    crisp.mipmaps = true;
    crisp.filter = "nearest";

    cache.acquire(smooth.asTexture);
    cache.acquire(crisp.asTexture);

    expect(
      gl
        .callsOf("texParameteri")
        .filter((call) => call.args[1] === GL.TEXTURE_MIN_FILTER)
        .map((call) => call.args[2]),
    ).toEqual([GL.LINEAR_MIPMAP_LINEAR, GL.NEAREST_MIPMAP_NEAREST]);
  });

  it("degrades to one level on a context that cannot generate mipmaps (R-30b)", () => {
    // A mip-choosing min filter on a one-level texture is *incomplete* in GL
    // and samples as opaque black. Degrading the quality beats a black surface.
    const gl = createFakeGl({ canGenerateMipmaps: false });
    const cache = new TextureCache(gl);
    const texture = new TestTexture(4, 4);
    texture.mipmaps = true;
    texture.minFilter = "linear-mipmap-linear";
    const crisp = new TestTexture(4, 4);
    crisp.mipmaps = true;
    crisp.minFilter = "nearest-mipmap-nearest";

    cache.acquire(texture.asTexture);
    cache.acquire(crisp.asTexture);

    expect(gl.countOf("generateMipmap")).toBe(0);
    expect(
      gl
        .callsOf("texParameteri")
        .filter((call) => call.args[1] === GL.TEXTURE_MIN_FILTER)
        .map((call) => call.args[2]),
    ).toEqual([GL.LINEAR, GL.NEAREST]);
  });

  it("clamps an anisotropy request to the device ceiling, querying once (§62, R-30b)", () => {
    const gl = createFakeGl({ maxAnisotropy: 4 });
    const cache = new TextureCache(gl);
    const modest = new TestTexture(2, 2);
    modest.anisotropy = 2;
    const greedy = new TestTexture(2, 2);
    greedy.anisotropy = 64;

    cache.acquire(modest.asTexture);
    cache.acquire(greedy.asTexture);

    expect(gl.callsOf("getExtension").map((call) => call.args[0])).toEqual([
      "EXT_texture_filter_anisotropic",
    ]);
    expect(
      gl
        .callsOf("texParameteri")
        .filter((call) => call.args[1] === GL.TEXTURE_MAX_ANISOTROPY_EXT)
        .map((call) => call.args[2]),
    ).toEqual([2, 4]);
  });

  it("writes no anisotropy, and asks nothing, for a request of 1 (R-30b)", () => {
    const gl = createFakeGl();
    const cache = new TextureCache(gl);
    const texture = new TestTexture(2, 2);
    texture.anisotropy = 1;

    cache.acquire(texture.asTexture);

    expect(gl.countOf("getExtension")).toBe(0);
    expect(gl.countOf("texParameteri")).toBe(4);
  });

  it("ignores anisotropy where the extension is absent (§62's clamp, not §85)", () => {
    for (const options of [
      { anisotropyExtension: false },
      // A context that does not even declare `getExtension`.
      { anisotropyExtension: null },
      // A driver that answers the query with something that is not a number.
      { maxAnisotropy: null },
    ] as const) {
      const gl = createFakeGl(options);
      const cache = new TextureCache(gl);
      const texture = new TestTexture(2, 2);
      texture.anisotropy = 8;

      cache.acquire(texture.asTexture);

      expect(gl.countOf("texParameteri")).toBe(4);
    }
  });

  it("re-uploads with the new sampler state after a version bump (§77, R-30)", () => {
    // Sampler state is upload-time state, so changing it on a resident texture
    // needs the same announcement an in-place texel edit needs.
    const gl = createFakeGl();
    const cache = new TextureCache(gl);
    const texture = new TestTexture(1, 1);

    cache.acquire(texture.asTexture);
    texture.filter = "nearest";
    cache.acquire(texture.asTexture);
    // Still one upload: the version did not move, so the cache answered from
    // its record and the GPU still samples linearly.
    expect(gl.countOf("texImage2D")).toBe(1);

    texture.markDirty();
    cache.acquire(texture.asTexture);

    expect(gl.countOf("texImage2D")).toBe(2);
    expect(
      gl
        .callsOf("texParameteri")
        .slice(4)
        .map((call) => call.args[2]),
    ).toEqual([GL.NEAREST, GL.NEAREST, GL.CLAMP_TO_EDGE, GL.CLAMP_TO_EDGE]);
  });

  it("allocates zero-filled storage for a texture with no CPU-side data", () => {
    const gl = createFakeGl();
    const cache = new TextureCache(gl);
    const texture = new TestTexture(4, 4);
    texture.data = null;

    cache.acquire(texture.asTexture);

    expect(gl.callsOf("texImage2D")[0].args[8]).toBeNull();
  });

  it("returns the same record for an unchanged texture", () => {
    const gl = createFakeGl();
    const cache = new TextureCache(gl);
    const texture = new TestTexture();

    const first = cache.acquire(texture.asTexture);
    const second = cache.acquire(texture.asTexture);

    expect(second).toBe(first);
    expect(gl.countOf("createTexture")).toBe(1);
  });

  it("deletes and re-uploads when the version advances", () => {
    const gl = createFakeGl();
    const cache = new TextureCache(gl);
    const texture = new TestTexture();
    cache.acquire(texture.asTexture);

    texture.data![0] = 255;
    texture.markDirty();
    const record = cache.acquire(texture.asTexture);

    expect(record?.version).toBe(1);
    expect(gl.countOf("deleteTexture")).toBe(1);
    expect(gl.countOf("createTexture")).toBe(2);
    expect(cache.size).toBe(1);
  });

  it("drops a disposed texture and keeps no entry (§83)", () => {
    resetDevWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const gl = createFakeGl();
    const cache = new TextureCache(gl);
    const texture = new TestTexture();
    cache.acquire(texture.asTexture);

    texture.dispose();

    expect(cache.acquire(texture.asTexture)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("disposed");
    expect(gl.countOf("deleteTexture")).toBe(1);
    expect(gl.countOf("createTexture")).toBe(1);
    expect(cache.size).toBe(0);
  });

  it("returns null without an entry when GL will not allocate a texture", () => {
    const gl = createFakeGl({ allocateTextures: false });
    const cache = new TextureCache(gl);

    expect(cache.acquire(new TestTexture().asTexture)).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("forgets every record without touching the context (§61 loss)", () => {
    const gl = createFakeGl();
    const cache = new TextureCache(gl);
    cache.acquire(new TestTexture().asTexture);
    gl.reset();

    cache.forget();

    expect(gl.calls).toHaveLength(0);
    expect(cache.size).toBe(0);
  });

  it("deletes every texture on dispose, idempotently (§83)", () => {
    const gl = createFakeGl();
    const cache = new TextureCache(gl);
    cache.acquire(new TestTexture().asTexture);
    cache.acquire(new TestTexture().asTexture);
    gl.reset();

    cache.dispose();
    cache.dispose();

    expect(gl.countOf("deleteTexture")).toBe(2);
    expect(cache.disposed).toBe(true);
    expect(cache.size).toBe(0);
  });
});

describe("WebglRenderer.render — sprites (§55, §66)", () => {
  it("switches to the sprite pipeline, binds the sampler, and enables blending", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(sprite());
    gl.reset();

    renderer.render(root, [createView(camera)]);

    const names = gl.names();
    // Unlit is the frame's starting state; the sprite run switches to the
    // second pipeline once and switches blending on with it.
    expect(gl.countOf("useProgram")).toBe(2);
    expect(uploadsAt(gl, spriteUniforms(gl).get("map"))).toEqual([0]);
    expect(gl.callsOf("activeTexture")[0].args).toEqual([GL.TEXTURE0]);
    expect(gl.callsOf("enable").map((call) => call.args[0])).toEqual([
      GL.BLEND,
    ]);
    // Ordering: program, then sampler, then a texture bind, then the draw.
    const drawIndex = names.indexOf("drawElements");
    expect(names.indexOf("useProgram")).toBeLessThan(
      names.indexOf("uniform1i"),
    );
    expect(names.indexOf("uniform1i")).toBeLessThan(drawIndex);
    const boundBeforeDraw = gl.calls
      .slice(0, drawIndex)
      .filter((call) => call.name === "bindTexture" && call.args[1] !== null);
    expect(boundBeforeDraw).not.toHaveLength(0);
  });

  it("blends with straight alpha, and fixes the function once at initialize (§66)", async () => {
    const { gl } = await initialized();

    expect(gl.callsOf("blendFunc")[0].args).toEqual([
      GL.SRC_ALPHA,
      GL.ONE_MINUS_SRC_ALPHA,
    ]);
    // GL's initial state already has BLEND off, so nothing disables it here.
    expect(gl.callsOf("disable").map((call) => call.args[0])).toEqual([
      GL.CULL_FACE,
    ]);
  });

  it("disables blending and unbinds the texture when the frame ends", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(sprite());
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.callsOf("disable").map((call) => call.args[0])).toEqual([
      GL.BLEND,
    ]);
    expect(gl.callsOf("bindTexture").at(-1)?.args).toEqual([
      GL.TEXTURE_2D,
      null,
    ]);
  });

  it("leaves the opaque unlit path untouched — no blending, one program", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(quadGeometry()));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("useProgram")).toBe(1);
    expect(gl.countOf("enable")).toBe(0);
    expect(gl.countOf("disable")).toBe(0);
    expect(gl.countOf("bindTexture")).toBe(0);
    expect(gl.countOf("uniform1i")).toBe(0);
  });

  it("uploads the tint; atlas uvs ride the geometry, not a uniform", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const node = sprite(
      new TestSpriteMaterial(new TestTexture(), [1, 0.5, 0, 0.25]),
      {
        width: 4,
        height: 2,
        anchor: { x: 0, y: 0 },
      },
    );
    root.add(node);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    const uniforms = spriteUniforms(gl);
    expect(uploadsAt(gl, uniforms.get("tint"))).toEqual([[1, 0.5, 0, 0.25]]);
    expect(uniforms.has("quad")).toBe(false);
    expect(Array.from(node.geometry.uvs ?? [])).toEqual([
      0, 0, 1, 0, 1, 1, 0, 1,
    ]);
  });

  it("keeps whole-texture uvs when the sprite is resized", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const node = sprite(new TestSpriteMaterial(), { width: 2, height: 2 });
    root.add(node);
    renderer.render(root, [createView(camera)]);

    node.width = 6;
    gl.reset();
    renderer.render(root, [createView(camera)]);

    expect(Array.from(node.geometry.uvs ?? [])).toEqual([
      0, 0, 1, 0, 1, 1, 0, 1,
    ]);
    expect(spriteUniforms(gl).has("quad")).toBe(false);
  });

  it("authors a §55 frame onto the uv stream (R-29 / atlas packet)", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    // An 8 × 4 atlas, and the quad shows its top-right 4 × 2 cell.
    const node = sprite(new TestSpriteMaterial(new TestTexture(8, 4)), {
      width: 4,
      height: 2,
      anchor: { x: 0, y: 0 },
    });
    node.setFrame(4, 2, 4, 2);
    root.add(node);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(Array.from(node.geometry.uvs ?? [])).toEqual([
      0.5, 0.5, 1, 0.5, 1, 1, 0.5, 1,
    ]);
    // Tint only — the retired `quad` uniform is gone.
    expect(gl.countOf("uniform4fv")).toBe(1);
    expect(spriteUniforms(gl).has("quad")).toBe(false);
  });

  it("authors the frameless uvs for an identity frame", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const framed = sprite(new TestSpriteMaterial(new TestTexture(8, 4)), {
      width: 3,
      height: 2,
      anchor: { x: 0.25, y: 0.75 },
    });
    framed.setFrame(0, 0, 8, 4);
    root.add(framed);
    gl.reset();
    renderer.render(root, [createView(camera)]);
    const withFrame = Array.from(framed.geometry.uvs ?? []);

    const plain = sprite(new TestSpriteMaterial(new TestTexture(8, 4)), {
      width: 3,
      height: 2,
      anchor: { x: 0.25, y: 0.75 },
    });
    const plainRoot = createRoot();
    plainRoot.add(plain);
    gl.reset();
    renderer.render(plainRoot, [createView(camera)]);

    expect(withFrame).toEqual(Array.from(plain.geometry.uvs ?? []));
    expect(withFrame).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
  });

  it("maps a bottom-left frame, and a sub-texel inset", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const node = sprite(new TestSpriteMaterial(new TestTexture(8, 4)), {
      width: 2,
      height: 2,
      anchor: { x: 0, y: 0 },
    });
    node.setFrame(0, 0, 4, 2);
    root.add(node);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // Left half of an 8 × 4 atlas, full height of a 2-texel-tall cell.
    expect(Array.from(node.geometry.uvs ?? [])).toEqual([
      0, 0, 0.5, 0, 0.5, 0.5, 0, 0.5,
    ]);
  });

  it("returns to the whole texture when the frame is cleared", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const node = sprite(new TestSpriteMaterial(new TestTexture(8, 4)), {
      width: 2,
      height: 2,
      anchor: { x: 0, y: 0 },
    });
    node.setFrame(0, 0, 4, 2);
    root.add(node);
    renderer.render(root, [createView(camera)]);

    node.frame = null;
    gl.reset();
    renderer.render(root, [createView(camera)]);

    expect(Array.from(node.geometry.uvs ?? [])).toEqual([
      0, 0, 1, 0, 1, 1, 0, 1,
    ]);
  });

  it("draws two frames of one atlas through one texture and one binding", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    // The workaround this discharges: one material, one texture, two cells.
    const material = new TestSpriteMaterial(new TestTexture(8, 4));
    const left = sprite(material, {
      width: 2,
      height: 2,
      anchor: { x: 0, y: 0 },
    });
    const right = sprite(material, {
      width: 2,
      height: 2,
      anchor: { x: 0, y: 0 },
    });
    left.setFrame(0, 0, 4, 4);
    right.setFrame(4, 0, 4, 4);
    root.add(left, right);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(Array.from(left.geometry.uvs ?? [])).toEqual([
      0, 0, 0.5, 0, 0.5, 1, 0, 1,
    ]);
    expect(Array.from(right.geometry.uvs ?? [])).toEqual([
      0.5, 0, 1, 0, 1, 1, 0.5, 1,
    ]);
    // One upload and one GL texture for both cells — the point of an atlas.
    expect(gl.countOf("texImage2D")).toBe(1);
    expect(gl.countOf("createTexture")).toBe(1);
  });

  it("uploads the sprite view-projection once per view, after switching to it", async () => {
    const { renderer, gl, camera } = await initialized();
    camera.projectionMatrix.identity();
    camera.viewMatrix.identity();
    const root = createRoot();
    root.add(sprite(), sprite());
    gl.reset();

    renderer.render(root, [createView(camera)]);

    const uniforms = spriteUniforms(gl);
    expect(uploadsAt(gl, uniforms.get("viewProjection"))).toHaveLength(1);
    expect(uploadsAt(gl, uniforms.get("model"))).toHaveLength(2);
  });

  it("uploads a sprite view-projection per view when there are two", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(sprite());
    gl.reset();

    renderer.render(root, [createView(camera), createView(new TestCamera())]);

    expect(
      uploadsAt(gl, spriteUniforms(gl).get("viewProjection")),
    ).toHaveLength(2);
  });

  it("switches pipelines and blending back and forth for interleaved items", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    // renderOrder decides the sequence: unlit, sprite, unlit.
    const first = renderable(quadGeometry());
    first.renderOrder = 0;
    const middle = sprite(new TestSpriteMaterial(), { renderOrder: 1 });
    const last = renderable(triangleGeometry());
    last.renderOrder = 2;
    root.add(first, middle, last);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // The frame's opening `use` of the unlit pipeline, then two switches:
    // unlit → sprite → unlit.
    expect(gl.countOf("useProgram")).toBe(3);
    expect(gl.callsOf("enable").map((call) => call.args[0])).toEqual([
      GL.BLEND,
    ]);
    expect(gl.callsOf("disable").map((call) => call.args[0])).toEqual([
      GL.BLEND,
    ]);
    const names = gl.names();
    expect(names.indexOf("enable")).toBeLessThan(names.indexOf("disable"));
    expect(gl.countOf("drawElements")).toBe(2);
    expect(gl.countOf("drawArrays")).toBe(1);
  });

  it("uploads a texture once and reuses it across frames", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(sprite());
    gl.reset();

    renderer.render(root, [createView(camera)]);
    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("createTexture")).toBe(1);
    expect(gl.countOf("drawElements")).toBe(2);
  });

  it("shares one GL texture between sprites that share a texture", async () => {
    const { renderer, gl, camera } = await initialized();
    const texture = new TestTexture();
    const root = createRoot();
    root.add(
      sprite(new TestSpriteMaterial(texture)),
      sprite(new TestSpriteMaterial(texture)),
    );
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("createTexture")).toBe(1);
    // Two from the single upload (bind, then unbind), one for the first draw,
    // and the end-of-frame unbind. Five until 2026-09-11 (audit A6): the
    // second sprite's bind of the very texture unit 0 already holds is now
    // skipped by the frame's bound-texture mirror — the same picture with one
    // fewer redundant bind, which is the whole point of the mirror.
    expect(gl.countOf("bindTexture")).toBe(4);
  });

  it("re-uploads a texture whose version advanced between frames", async () => {
    const { renderer, gl, camera } = await initialized();
    const texture = new TestTexture();
    const root = createRoot();
    root.add(sprite(new TestSpriteMaterial(texture)));
    renderer.render(root, [createView(camera)]);
    gl.reset();

    texture.data![0] = 255;
    texture.markDirty();
    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("deleteTexture")).toBe(1);
    expect(gl.countOf("createTexture")).toBe(1);
  });

  it("skips a sprite whose texture has been disposed (§83)", async () => {
    const { renderer, gl, camera } = await initialized();
    const texture = new TestTexture();
    const root = createRoot();
    root.add(sprite(new TestSpriteMaterial(texture)));
    texture.dispose();
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("drawElements")).toBe(0);
    // Never switched pipelines either: the skip happens before the switch.
    expect(gl.countOf("useProgram")).toBe(1);
    expect(gl.countOf("enable")).toBe(0);
  });

  it("skips a disposed sprite, whose quad has no vertices", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const node = sprite();
    root.add(node);
    node.dispose();
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("drawElements")).toBe(0);
    expect(gl.countOf("createTexture")).toBe(0);
  });

  it("draws the §43 interpolated pose of a sprite like any other item", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const node = sprite();
    // §87 (R-8): `TestCamera`'s projection and view are both the identity, so
    // its frustum is the NDC cube and a sprite interpolated to `x = 2` is
    // genuinely off screen. This test is about which *model matrix* the
    // interpolated list uploads, not about culling, so the node opts out —
    // §49's flag doing exactly what it is for.
    node.frustumCulled = false;
    root.add(node);
    const poses = new TestPoseBuffer().track(
      node,
      new Vector3(0, 0, 0),
      new Vector3(8, 0, 0),
    );
    gl.reset();

    renderer.render(root, [createView(camera)], interpolationAt(poses, 0.25));

    const models = uploadsAt(gl, spriteUniforms(gl).get("model")) as number[][];
    expect(models[0].slice(12, 15)).toEqual([2, 0, 0]);
  });

  it("forgets textures on context loss and re-uploads after restore (§61)", async () => {
    const { renderer, gl, canvas, camera } = await initialized();
    const root = createRoot();
    root.add(sprite());
    renderer.render(root, [createView(camera)]);

    canvas.dispatch("webglcontextlost");
    canvas.dispatch("webglcontextrestored");
    gl.reset();
    renderer.render(root, [createView(camera)]);

    // A fresh upload, and no `deleteTexture` against the dead handle.
    expect(gl.countOf("createTexture")).toBe(1);
    expect(gl.countOf("deleteTexture")).toBe(0);
    expect(gl.countOf("drawElements")).toBe(1);
  });

  it("deletes every GL texture on disposal (§83)", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(sprite(), sprite());
    renderer.render(root, [createView(camera)]);
    gl.reset();

    renderer.dispose();

    expect(gl.countOf("deleteTexture")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Particles (§36, §64 stage 6, plan P9-3).
//
// The emitting node is a double for the same reason the camera and the pose
// buffer are: `@fourjs/particles`' `ParticleRenderable` is outside this package's
// dependency matrix — and, by design, outside `@fourjs/render`'s too. What
// `buildRenderList` recognises is the *structural* `ParticleDrawable` contract,
// so a double implementing that contract is not a shortcut here: it is the
// contract, exercised exactly as the real class will be.
// ---------------------------------------------------------------------------

let nextTestParticlesId = 0;

/**
 * A particle system node reduced to what the render list reads: §6's traversal
 * flags plus `@fourjs/render`'s `ParticleDrawable` contract.
 *
 * The instance array is filled with recognisable values — particle `i` sits at
 * `(i, i + 0.5, 0)` with size `i + 1` and colour `(i, 0, 0, 0.5)` — so an
 * upload assertion can name the floats it expects.
 */
class TestParticles {
  readonly isParticleDrawable = true;

  readonly id: string;

  readonly parent = null;

  readonly children: unknown[] = [];

  visible = true;

  enabled = true;

  renderLayer = 0;

  renderOrder = 0;

  particleCount: number;

  readonly particleInstances: Float32Array;

  /** Calls to `updateParticleInstances`, which the render list owes exactly one per build. */
  updateCalls = 0;

  /** A `Transform` reduced to what the two render-list paths touch (§7, §43). */
  readonly transform = {
    worldMatrix: new Matrix4(),
    localMatrix: new Matrix4(),
    scale: new Vector3(1, 1, 1),
    pivot: new Vector3(),
    updateLocalMatrix(): void {
      // Nothing to recompose: the double's local matrix is written directly.
    },
  };

  constructor(capacity: number, count = capacity) {
    nextTestParticlesId += 1;
    this.id = `test-particles-${String(nextTestParticlesId)}`;
    this.particleInstances = new Float32Array(
      capacity * PARTICLE_INSTANCE_FLOATS,
    );
    this.particleCount = count;
    for (let i = 0; i < capacity; i += 1) {
      const base = i * PARTICLE_INSTANCE_FLOATS;
      this.particleInstances[base] = i;
      this.particleInstances[base + 1] = i + 0.5;
      this.particleInstances[base + 2] = 0;
      this.particleInstances[base + 3] = i + 1;
      this.particleInstances[base + 4] = i;
      this.particleInstances[base + 7] = 0.5;
    }
  }

  updateParticleInstances(): void {
    this.updateCalls += 1;
  }

  get asNode(): RenderNode {
    return this as unknown as RenderNode;
  }
}

/**
 * A container node reduced to §6's traversal surface, so a test can put a
 * particle double and a real `Renderable` under one root.
 *
 * `Group` lives in `@fourjs/scene` (outside the matrix) and `createRoot`'s
 * `Renderable` cannot adopt a double, since `Node.add` takes a real node.
 */
class TestGroup {
  visible = true;

  enabled = true;

  readonly parent = null;

  readonly children: unknown[] = [];

  add(...nodes: { asNode: RenderNode }[]): this {
    for (const node of nodes) {
      this.children.push(node.asNode);
    }
    return this;
  }

  addRenderables(...nodes: (Renderable | Sprite)[]): this {
    this.children.push(...nodes);
    return this;
  }

  get asNode(): RenderNode {
    return this as unknown as RenderNode;
  }
}

/** The particle program's uniform handles, found by the one name only it declares. */
function particleUniforms(gl: FakeGl): Map<string, object> {
  for (const perProgram of gl.uniformsByProgram.values()) {
    if (perProgram.has("projection") && !perProgram.has("useMap")) {
      return perProgram;
    }
  }
  throw new Error("the particle program never resolved its uniforms");
}

/** R-32 appearance program — distinguished by `useMap` / `hasSceneDepth`. */
function appearanceUniforms(gl: FakeGl): Map<string, object> {
  for (const perProgram of gl.uniformsByProgram.values()) {
    if (perProgram.has("useMap")) {
      return perProgram;
    }
  }
  throw new Error("the appearance program never resolved its uniforms");
}

/** A render item as `buildRenderList` writes it, for the cache's direct tests. */
function particleItem(
  instances: Float32Array,
  count: number,
  id = "item-particles",
): ParticleRenderItem {
  return {
    kind: "particles",
    id,
    count,
    instances,
    worldMatrix: new Matrix4(),
    geometry: particleQuadGeometry(),
    renderLayer: 0,
    renderOrder: 0,
    // §46's membership mask, as `buildRenderList` snapshots it off the emitting
    // node (R-38): the default layer, which every view's mask contains.
    layers: 1,
    // §66 key 2, as `buildRenderList` writes it for a particle system: the
    // pipeline blends by construction but the item classifies opaque, so the
    // sort leaves particle scenes in the order they were authored in.
    transparent: false,
    // §66 key 3's material half (R-10, 2026-08-09): a particle system has no
    // material, so it has no material identity to group by.
    materialId: "",
    // §69 (R-18): §36's billboards neither cast nor receive — no surface to
    // project, no lighting term to attenuate.
    castShadow: false,
    receiveShadow: false,
    // §87 (R-8, 2026-08-09): never culled, because the item's `geometry` is the
    // shared instance quad rather than a bound over the live particles.
    frustumCulled: false,
    // §66 key 4, unmeasured until a view sorts by it.
    viewDepth: 0,
    trailVertexCount: 0,
  };
}

function trailParticleItem(
  trailVertices: Float32Array,
  trailVertexCount: number,
  id = "item-trail",
): ParticleRenderItem {
  return {
    ...particleItem(new Float32Array(PARTICLE_INSTANCE_FLOATS), 0, id),
    trailVertices,
    trailVertexCount,
  };
}

describe("ParticleProgram — compilation and linking (§36, §61, §89)", () => {
  it("compiles both stages, links, and resolves the three uniforms", () => {
    const gl = createFakeGl();

    const program = ParticleProgram.create(gl);

    expect(gl.callsOf("createShader").map((call) => call.args[0])).toEqual([
      GL.VERTEX_SHADER,
      GL.FRAGMENT_SHADER,
    ]);
    expect(gl.countOf("linkProgram")).toBe(1);
    expect(
      gl.callsOf("getUniformLocation").map((call) => call.args[1]),
    ).toEqual(["projection", "view", "model"]);
    expect(program.disposed).toBe(false);
  });

  it("emits GLSL ES 3.00 sources binding the corner and instance attributes", () => {
    const gl = createFakeGl();

    ParticleProgram.create(gl);

    const [vertex, fragment] = gl
      .callsOf("shaderSource")
      .map((call) => call.args[1] as string);
    expect(vertex.startsWith("#version 300 es")).toBe(true);
    expect(vertex).toContain(
      `layout(location = ${String(PARTICLE_ATTRIBUTE_LOCATIONS.corner)}) in vec3 corner;`,
    );
    expect(vertex).toContain(
      `layout(location = ${String(PARTICLE_ATTRIBUTE_LOCATIONS.instancePosition)}) in vec3 instancePosition;`,
    );
    expect(vertex).toContain(
      `layout(location = ${String(PARTICLE_ATTRIBUTE_LOCATIONS.instanceSize)}) in float instanceSize;`,
    );
    expect(vertex).toContain(
      `layout(location = ${String(PARTICLE_ATTRIBUTE_LOCATIONS.instanceColor)}) in vec4 instanceColor;`,
    );
    // The billboard: offset in view space, then project (WP-9.3).
    expect(vertex).toContain("center.xy += corner.xy * instanceSize;");
    expect(vertex).toContain("gl_Position = projection * center;");
    expect(fragment.startsWith("#version 300 es")).toBe(true);
    expect(fragment).toContain("fragColor = vColor;");
  });

  it("fails with SHADER_COMPILATION_FAILED, naming the particle pipeline", () => {
    const gl = createFakeGl({ compileStatus: false, infoLog: "bad" });

    const error = thrown(() => {
      ParticleProgram.create(gl);
    });

    expect(error.code).toBe("SHADER_COMPILATION_FAILED");
    expect(error.context?.stage).toBe("vertex");
    expect(error.context?.log).toBe("bad");
  });

  it("deletes the vertex shader when the fragment stage fails", () => {
    const gl = createFakeGl();
    let compiled = 0;
    gl.getShaderParameter = (): boolean => {
      compiled += 1;
      return compiled === 1;
    };

    const error = thrown(() => {
      ParticleProgram.create(gl);
    });

    expect(error.context?.stage).toBe("fragment");
    expect(gl.countOf("deleteShader")).toBe(2);
    expect(gl.countOf("createProgram")).toBe(0);
  });

  it("throws when GL will not allocate a shader or a program object", () => {
    const noShaders = thrown(() => {
      ParticleProgram.create(createFakeGl({ allocateShaders: false }));
    });
    const noPrograms = thrown(() => {
      ParticleProgram.create(createFakeGl({ allocatePrograms: false }));
    });

    expect(noShaders.context?.stage).toBe("vertex");
    expect(noPrograms.context?.stage).toBe("link");
  });

  it("throws SHADER_COMPILATION_FAILED when linking fails, and deletes the program", () => {
    const gl = createFakeGl({ linkStatus: false, infoLog: "link error" });

    const error = thrown(() => {
      ParticleProgram.create(gl);
    });

    expect(error.context?.stage).toBe("link");
    expect(error.context?.log).toBe("link error");
    expect(gl.countOf("deleteProgram")).toBe(1);
  });

  it("reports an empty log when the driver returns null from either getter", () => {
    const compileError = thrown(() => {
      ParticleProgram.create(
        createFakeGl({ compileStatus: false, infoLog: null }),
      );
    });
    const linkError = thrown(() => {
      ParticleProgram.create(
        createFakeGl({ linkStatus: false, infoLog: null }),
      );
    });

    expect(compileError.context?.log).toBe("");
    expect(linkError.context?.log).toBe("");
  });

  it("deletes the program when a uniform is missing from the link", () => {
    const gl = createFakeGl({ resolveUniforms: false });

    const error = thrown(() => {
      ParticleProgram.create(gl);
    });

    expect(error.context?.uniform).toBe("projection");
    expect(gl.countOf("deleteProgram")).toBe(1);
  });

  it("uploads the projection, view, and model matrices it is given", () => {
    const gl = createFakeGl();
    const program = ParticleProgram.create(gl);
    const uniforms = particleUniforms(gl);
    const model = new Matrix4();
    model.elements[12] = 7;

    program.use();
    program.setProjection(new Matrix4());
    program.setView(new Matrix4());
    program.setModel(model);

    expect(uploadsAt(gl, uniforms.get("model"))[0]).toEqual([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 7, 0, 0, 1,
    ]);
    expect(uploadsAt(gl, uniforms.get("projection"))).toHaveLength(1);
    expect(uploadsAt(gl, uniforms.get("view"))).toHaveLength(1);
  });

  it("deletes the GL program once, idempotently", () => {
    const gl = createFakeGl();
    const program = ParticleProgram.create(gl);

    program.dispose();
    program.dispose();

    expect(gl.countOf("deleteProgram")).toBe(1);
    expect(program.disposed).toBe(true);
  });
});

describe("ParticleAppearanceProgram — R-32 textured/rotated/soft (opt-in)", () => {
  it("compiles the appearance stages and names the extra uniforms", () => {
    const gl = createFakeGl();
    const program = ParticleAppearanceProgram.create(gl);

    const [vertex, fragment] = gl
      .callsOf("shaderSource")
      .map((call) => call.args[1] as string);
    expect(vertex).toContain("instanceRotation");
    expect(vertex).toContain("instanceSoftness");
    expect(vertex).toContain("cos(instanceRotation)");
    expect(fragment).toContain("texture(map, vUv)");
    expect(fragment).toContain("abs(vViewZ) * vSoftness");
    expect(fragment).toContain("hasSceneDepth");
    expect(
      gl.callsOf("getUniformLocation").map((call) => call.args[1]),
    ).toEqual(
      expect.arrayContaining([
        "projection",
        "view",
        "model",
        "useMap",
        "hasSceneDepth",
        "depthWidth",
        "depthHeight",
      ]),
    );
    expect(program.disposed).toBe(false);
    program.dispose();
  });

  it("uploads map and scene-depth uniforms and disposes once", () => {
    const gl = createFakeGl();
    const program = ParticleAppearanceProgram.create(gl);
    const uniforms = appearanceUniforms(gl);
    const model = new Matrix4();
    model.elements[12] = 4;

    program.use();
    program.setProjection(new Matrix4());
    program.setView(new Matrix4());
    program.setModel(model);
    program.setUseMap(true);
    program.setSceneDepth(true, 128, 64);
    program.setUseMap(false);
    program.setSceneDepth(false);

    expect(uploadsAt(gl, uniforms.get("model"))[0]).toEqual([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 0, 0, 1,
    ]);
    expect(uploadsAt(gl, uniforms.get("useMap"))).toEqual([1, 0]);
    expect(uploadsAt(gl, uniforms.get("hasSceneDepth"))).toEqual([1, 0]);
    expect(uploadsAt(gl, uniforms.get("depthWidth"))).toEqual([128, 1]);
    expect(uploadsAt(gl, uniforms.get("depthHeight"))).toEqual([64, 1]);

    program.dispose();
    program.dispose();
    expect(program.disposed).toBe(true);
    expect(gl.countOf("deleteProgram")).toBe(1);
  });

  it("deletes the program when a required uniform is missing", () => {
    const gl = createFakeGl({ resolveUniforms: false });
    const error = thrown(() => {
      ParticleAppearanceProgram.create(gl);
    });
    expect(error.context?.uniform).toBe("projection");
    expect(gl.countOf("deleteProgram")).toBe(1);
  });

  it("still constructs when the optional map and depth samplers are missing", () => {
    const gl = createFakeGl();
    const original = gl.getUniformLocation.bind(gl);
    gl.getUniformLocation = (program, name) => {
      if (name === "map" || name === "sceneDepth") {
        return null;
      }
      return original(program, name);
    };

    const program = ParticleAppearanceProgram.create(gl);
    expect(program.disposed).toBe(false);
    expect(gl.callsOf("uniform1i").map((call) => call.args[1])).not.toContain(
      MAP_TEXTURE_UNIT,
    );
    program.dispose();
  });
});

describe("ParticleBatchCache — one vertex array per system (§61, §64)", () => {
  const cornerBuffer = { kind: "corner" };

  it("builds the corner and instance attributes with the documented divisors", () => {
    const gl = createFakeGl();
    const cache = new ParticleBatchCache(gl);
    const item = particleItem(
      new Float32Array(4 * PARTICLE_INSTANCE_FLOATS),
      4,
    );

    const record = cache.acquire(item, cornerBuffer);

    expect(record).not.toBeNull();
    expect(cache.size).toBe(1);
    // Corner stream from the shared quad, then the interleaved instance stream.
    const pointers = gl.callsOf("vertexAttribPointer").map((call) => call.args);
    expect(pointers).toEqual([
      [PARTICLE_ATTRIBUTE_LOCATIONS.corner, 3, GL.FLOAT, false, 0, 0],
      [
        PARTICLE_ATTRIBUTE_LOCATIONS.instancePosition,
        3,
        GL.FLOAT,
        false,
        32,
        0,
      ],
      [PARTICLE_ATTRIBUTE_LOCATIONS.instanceSize, 1, GL.FLOAT, false, 32, 12],
      [PARTICLE_ATTRIBUTE_LOCATIONS.instanceColor, 4, GL.FLOAT, false, 32, 16],
    ]);
    expect(gl.callsOf("vertexAttribDivisor").map((call) => call.args)).toEqual([
      [PARTICLE_ATTRIBUTE_LOCATIONS.instancePosition, 1],
      [PARTICLE_ATTRIBUTE_LOCATIONS.instanceSize, 1],
      [PARTICLE_ATTRIBUTE_LOCATIONS.instanceColor, 1],
    ]);
  });

  it("allocates the instance buffer once, at full capacity, as DYNAMIC_DRAW", () => {
    const gl = createFakeGl();
    const cache = new ParticleBatchCache(gl);
    const item = particleItem(
      new Float32Array(4 * PARTICLE_INSTANCE_FLOATS),
      1,
    );

    cache.acquire(item, cornerBuffer);

    const [call] = gl.callsOf("bufferData");
    expect(call.args[0]).toBe(GL.ARRAY_BUFFER);
    expect((call.args[1] as number[]).length).toBe(32);
    expect(call.args[2]).toBe(PARTICLE_GL.DYNAMIC_DRAW);
    // …and the vertex array is left unbound, with no stale ARRAY_BUFFER binding.
    expect(gl.callsOf("bindVertexArray").at(-1)?.args[0]).toBeNull();
    expect(gl.callsOf("bindBuffer").at(-1)?.args[1]).toBeNull();
  });

  it("returns the same record for an unchanged system", () => {
    const gl = createFakeGl();
    const cache = new ParticleBatchCache(gl);
    const item = particleItem(
      new Float32Array(2 * PARTICLE_INSTANCE_FLOATS),
      2,
    );

    const first = cache.acquire(item, cornerBuffer);
    gl.reset();
    const second = cache.acquire(item, cornerBuffer);

    expect(second).toBe(first);
    expect(gl.countOf("createVertexArray")).toBe(0);
  });

  it("rebuilds when the capacity or the shared corner buffer changes", () => {
    const gl = createFakeGl();
    const cache = new ParticleBatchCache(gl);
    const small = particleItem(new Float32Array(PARTICLE_INSTANCE_FLOATS), 1);
    const grown = particleItem(
      new Float32Array(2 * PARTICLE_INSTANCE_FLOATS),
      2,
    );

    const first = cache.acquire(small, cornerBuffer);
    const afterGrowth = cache.acquire(grown, cornerBuffer);
    const afterRebuiltQuad = cache.acquire(grown, { kind: "corner-2" });

    expect(afterGrowth).not.toBe(first);
    expect(afterRebuiltQuad).not.toBe(afterGrowth);
    expect(cache.size).toBe(1);
    expect(gl.countOf("deleteVertexArray")).toBe(2);
    expect(gl.countOf("deleteBuffer")).toBe(2);
  });

  it("returns null without an entry for a system with no capacity", () => {
    const gl = createFakeGl();
    const cache = new ParticleBatchCache(gl);

    expect(
      cache.acquire(particleItem(new Float32Array(0), 0), cornerBuffer),
    ).toBeNull();
    expect(cache.size).toBe(0);
    expect(gl.countOf("createVertexArray")).toBe(0);
  });

  it("returns null when GL will not allocate a vertex array or a buffer", () => {
    const item = particleItem(new Float32Array(PARTICLE_INSTANCE_FLOATS), 1);
    const noArrays = new ParticleBatchCache(
      createFakeGl({ allocateVertexArrays: false }),
    );
    const bufferless = createFakeGl({ allocateBuffers: false });
    const noBuffers = new ParticleBatchCache(bufferless);

    expect(noArrays.acquire(item, cornerBuffer)).toBeNull();
    expect(noBuffers.acquire(item, cornerBuffer)).toBeNull();
    // The vertex array it had already created is released, not leaked.
    expect(bufferless.countOf("deleteVertexArray")).toBe(1);
  });

  it("uploads only the live prefix, and nothing at all for an empty system", () => {
    const gl = createFakeGl();
    const cache = new ParticleBatchCache(gl);
    const instances = new Float32Array(4 * PARTICLE_INSTANCE_FLOATS);
    instances[0] = 3;
    const item = particleItem(instances, 2);
    const record = cache.acquire(item, cornerBuffer);
    gl.reset();

    cache.upload(record!, item);
    cache.upload(record!, particleItem(instances, 0));

    const [call] = gl.callsOf("bufferSubData");
    expect(gl.countOf("bufferSubData")).toBe(1);
    expect(call.args[0]).toBe(GL.ARRAY_BUFFER);
    expect(call.args[1]).toBe(0);
    expect((call.args[2] as number[])[0]).toBe(3);
    expect(call.args[3]).toBe(0);
    expect(call.args[4]).toBe(2 * PARTICLE_INSTANCE_FLOATS);
  });

  it("forgets every record without touching the context (§61 loss)", () => {
    const gl = createFakeGl();
    const cache = new ParticleBatchCache(gl);
    cache.acquire(
      particleItem(new Float32Array(PARTICLE_INSTANCE_FLOATS), 1),
      cornerBuffer,
    );
    gl.reset();

    cache.forget();

    expect(cache.size).toBe(0);
    expect(gl.calls).toHaveLength(0);
  });

  it("binds the wide-stream rotation and softness attributes (R-32)", () => {
    const gl = createFakeGl();
    const cache = new ParticleBatchCache(gl);
    const item: ParticleRenderItem = {
      ...particleItem(new Float32Array(2 * PARTICLE_WIDE_INSTANCE_FLOATS), 2),
      instanceFloats: PARTICLE_WIDE_INSTANCE_FLOATS,
    };

    const record = cache.acquire(item, cornerBuffer);
    expect(record).not.toBeNull();
    const strideBytes = PARTICLE_WIDE_INSTANCE_FLOATS * 4;
    expect(gl.callsOf("vertexAttribPointer").map((call) => call.args)).toEqual(
      expect.arrayContaining([
        [
          PARTICLE_ATTRIBUTE_LOCATIONS.instanceRotation,
          1,
          GL.FLOAT,
          false,
          strideBytes,
          PARTICLE_ROTATION_OFFSET * 4,
        ],
        [
          PARTICLE_ATTRIBUTE_LOCATIONS.instanceSoftness,
          1,
          GL.FLOAT,
          false,
          strideBytes,
          PARTICLE_SOFTNESS_OFFSET * 4,
        ],
      ]),
    );
    expect(gl.callsOf("vertexAttribDivisor").map((call) => call.args)).toEqual(
      expect.arrayContaining([
        [PARTICLE_ATTRIBUTE_LOCATIONS.instanceRotation, 1],
        [PARTICLE_ATTRIBUTE_LOCATIONS.instanceSoftness, 1],
      ]),
    );
  });

  it("deletes every vertex array and buffer on dispose, idempotently (§83)", () => {
    const gl = createFakeGl();
    const cache = new ParticleBatchCache(gl);
    cache.acquire(
      particleItem(new Float32Array(PARTICLE_INSTANCE_FLOATS), 1, "a"),
      cornerBuffer,
    );
    cache.acquire(
      particleItem(new Float32Array(PARTICLE_INSTANCE_FLOATS), 1, "b"),
      cornerBuffer,
    );
    gl.reset();

    cache.dispose();
    cache.dispose();

    expect(cache.disposed).toBe(true);
    expect(cache.size).toBe(0);
    expect(gl.countOf("deleteVertexArray")).toBe(2);
    expect(gl.countOf("deleteBuffer")).toBe(2);
  });
});

describe("ParticleTrailProgram — compilation and linking (§36 trail tier)", () => {
  it("compiles, links, and resolves the three uniforms", () => {
    const gl = createFakeGl();
    const program = ParticleTrailProgram.create(gl);
    expect(gl.countOf("linkProgram")).toBe(1);
    expect(
      gl.callsOf("getUniformLocation").map((call) => call.args[1]),
    ).toEqual(["projection", "view", "model"]);
    program.dispose();
    program.dispose();
    expect(program.disposed).toBe(true);
    expect(gl.countOf("deleteProgram")).toBe(1);
  });

  it("uploads the three matrices and deletes the program on a missing uniform", () => {
    const gl = createFakeGl();
    const program = ParticleTrailProgram.create(gl);
    const uniforms = particleUniforms(gl);
    const model = new Matrix4();
    model.elements[14] = 3;
    program.use();
    program.setProjection(new Matrix4());
    program.setView(new Matrix4());
    program.setModel(model);
    expect(uploadsAt(gl, uniforms.get("model"))[0]).toEqual([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 3, 1,
    ]);
    program.dispose();

    const unresolved = createFakeGl({ resolveUniforms: false });
    const error = thrown(() => {
      ParticleTrailProgram.create(unresolved);
    });
    expect(error.context?.uniform).toBe("projection");
    expect(unresolved.countOf("deleteProgram")).toBe(1);
  });
});

describe("ParticleTrailBatchCache — ribbon vertex cache (§36 trail tier)", () => {
  it("builds position and colour attributes for trail vertices", () => {
    const gl = createFakeGl();
    const cache = new ParticleTrailBatchCache(gl);
    const vertices = new Float32Array(TRAIL_VERTEX_FLOATS * 2);
    const item = trailParticleItem(vertices, 2);

    const record = cache.acquire(item);
    expect(record).not.toBeNull();
    expect(cache.acquire(item)).toBe(record);
    expect(cache.size).toBe(1);
    expect(gl.callsOf("vertexAttribPointer").map((call) => call.args)).toEqual([
      [0, 3, GL.FLOAT, false, TRAIL_VERTEX_FLOATS * 4, 0],
      [1, 4, GL.FLOAT, false, TRAIL_VERTEX_FLOATS * 4, 12],
    ]);
  });

  it("returns null without trail vertices and rebuilds when capacity changes", () => {
    const gl = createFakeGl();
    const cache = new ParticleTrailBatchCache(gl);
    expect(cache.acquire(trailParticleItem(new Float32Array(0), 0))).toBeNull();

    const small = trailParticleItem(new Float32Array(TRAIL_VERTEX_FLOATS), 1);
    const first = cache.acquire(small);
    const grown = trailParticleItem(
      new Float32Array(TRAIL_VERTEX_FLOATS * 3),
      3,
    );
    const second = cache.acquire(grown);
    expect(second).not.toBe(first);
    expect(cache.size).toBe(1);
  });

  it("uploads the live trail prefix and disposes cleanly", () => {
    const gl = createFakeGl();
    const cache = new ParticleTrailBatchCache(gl);
    const vertices = new Float32Array(TRAIL_VERTEX_FLOATS * 2);
    const item = trailParticleItem(vertices, 2);
    const record = cache.acquire(item);
    expect(record).not.toBeNull();
    gl.reset();
    cache.upload(record!, item);
    expect(gl.countOf("bufferSubData")).toBe(1);
    cache.dispose();
    expect(cache.disposed).toBe(true);
    expect(gl.countOf("deleteVertexArray")).toBe(1);
    expect(gl.countOf("deleteBuffer")).toBe(1);
  });

  it("returns null when GL will not allocate trail buffers", () => {
    const vertices = new Float32Array(TRAIL_VERTEX_FLOATS);
    const item = trailParticleItem(vertices, 1);
    expect(
      new ParticleTrailBatchCache(
        createFakeGl({ allocateVertexArrays: false }),
      ).acquire(item),
    ).toBeNull();
    const bufferless = createFakeGl({ allocateBuffers: false });
    expect(new ParticleTrailBatchCache(bufferless).acquire(item)).toBeNull();
    expect(bufferless.countOf("deleteVertexArray")).toBe(1);
  });

  it("skips upload when there are no live trail vertices", () => {
    const gl = createFakeGl();
    const cache = new ParticleTrailBatchCache(gl);
    const record = cache.acquire(
      trailParticleItem(new Float32Array(TRAIL_VERTEX_FLOATS), 1),
    );
    gl.reset();
    cache.upload(record!, trailParticleItem(new Float32Array(0), 0));
    expect(gl.countOf("bufferSubData")).toBe(0);
  });

  it("dispose is idempotent", () => {
    const gl = createFakeGl();
    const cache = new ParticleTrailBatchCache(gl);
    cache.acquire(trailParticleItem(new Float32Array(TRAIL_VERTEX_FLOATS), 1));
    cache.dispose();
    gl.reset();
    cache.dispose();
    expect(gl.calls).toHaveLength(0);
  });

  it("forgets records without touching the context (§61 loss)", () => {
    const gl = createFakeGl();
    const cache = new ParticleTrailBatchCache(gl);
    cache.acquire(trailParticleItem(new Float32Array(TRAIL_VERTEX_FLOATS), 1));
    gl.reset();
    cache.forget();
    expect(cache.size).toBe(0);
    expect(gl.calls).toHaveLength(0);
  });
});

describe("WebglRenderer.render — particles (§36, §112, plan P9-3)", () => {
  it("draws the whole system in ONE instanced call, and no per-particle draw", async () => {
    const { renderer, gl, camera } = await initialized();
    const particles = new TestParticles(1000, 250);
    gl.reset();

    renderer.render(particles.asNode, [createView(camera)]);

    expect(gl.countOf("drawArraysInstanced")).toBe(1);
    expect(gl.countOf("drawArrays")).toBe(0);
    expect(gl.countOf("drawElements")).toBe(0);
    // Six vertices of the shared, non-indexed unit quad; one instance per live
    // particle.
    expect(gl.callsOf("drawArraysInstanced")[0].args).toEqual([
      GL.TRIANGLES,
      0,
      6,
      250,
    ]);
    expect(particles.updateCalls).toBe(1);
  });

  it("uploads count × stride floats out of the node's own array, once per frame", async () => {
    const { renderer, gl, camera } = await initialized();
    const particles = new TestParticles(8, 3);
    const views = [createView(camera)];
    renderer.render(particles.asNode, views);
    gl.reset();

    renderer.render(particles.asNode, views);
    renderer.render(particles.asNode, views);

    const uploads = gl.callsOf("bufferSubData");
    expect(uploads).toHaveLength(2);
    expect(uploads[0].args[4]).toBe(3 * PARTICLE_INSTANCE_FLOATS);
    // Particle 1 of the double: centre (1, 1.5, 0), size 2, colour (1,0,0,0.5).
    expect((uploads[0].args[2] as number[]).slice(8, 16)).toEqual([
      1, 1.5, 0, 2, 1, 0, 0, 0.5,
    ]);
    // Warm: no new GL objects, no re-allocation of the instance buffer.
    expect(gl.countOf("createBuffer")).toBe(0);
    expect(gl.countOf("createVertexArray")).toBe(0);
    expect(gl.countOf("bufferData")).toBe(0);
  });

  it("enables blending for the particle pass and restores the frame state", async () => {
    const { renderer, gl, camera } = await initialized();
    const particles = new TestParticles(4);
    gl.reset();

    renderer.render(particles.asNode, [createView(camera)]);

    const names = gl.names();
    expect(
      gl.callsOf("enable").map((call) => call.args[0] as number),
    ).toContain(GL.BLEND);
    expect(names.indexOf("enable")).toBeLessThan(
      names.indexOf("drawArraysInstanced"),
    );
    expect(gl.callsOf("disable").map((call) => call.args[0])).toEqual([
      GL.BLEND,
    ]);
    expect(names.lastIndexOf("disable")).toBeGreaterThan(
      names.indexOf("drawArraysInstanced"),
    );
    // Nothing textured ran, so nothing is unbound from the texture unit.
    expect(gl.countOf("bindTexture")).toBe(0);
    expect(gl.callsOf("bindVertexArray").at(-1)?.args[0]).toBeNull();
  });

  it("uploads the camera's projection and view separately, once per view", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = new TestGroup().add(
      new TestParticles(2),
      new TestParticles(2),
    );
    gl.reset();

    renderer.render(root.asNode, [createView(camera)]);

    const uniforms = particleUniforms(gl);
    expect(uploadsAt(gl, uniforms.get("projection"))).toHaveLength(1);
    expect(uploadsAt(gl, uniforms.get("view"))).toHaveLength(1);
    // …but one model matrix per system.
    expect(uploadsAt(gl, uniforms.get("model"))).toHaveLength(2);
    expect(gl.countOf("drawArraysInstanced")).toBe(2);
  });

  it("switches pipelines back and forth for interleaved items", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = new TestGroup();
    root.addRenderables(renderable(triangleGeometry()));
    root.add(new TestParticles(2));
    root.addRenderables(renderable(triangleGeometry()));
    gl.reset();

    renderer.render(root.asNode, [createView(camera)]);

    // unlit (frame start) → particles → unlit, with blending following.
    expect(gl.countOf("useProgram")).toBe(3);
    expect(gl.callsOf("enable").map((call) => call.args[0])).toEqual([
      GL.BLEND,
    ]);
    expect(gl.callsOf("disable").map((call) => call.args[0])).toEqual([
      GL.BLEND,
    ]);
    expect(gl.names().indexOf("disable")).toBeLessThan(
      gl.names().lastIndexOf("drawArrays"),
    );
  });

  it("shares the corner quad between systems and gives each its own instance buffer", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = new TestGroup().add(
      new TestParticles(2),
      new TestParticles(2),
    );
    gl.reset();

    renderer.render(root.asNode, [createView(camera)]);

    // One vertex array + buffer for the shared quad, then one of each per system.
    expect(gl.countOf("createVertexArray")).toBe(3);
    expect(gl.countOf("createBuffer")).toBe(3);
    const staticUploads = gl
      .callsOf("bufferData")
      .filter((call) => call.args[2] === GL.STATIC_DRAW);
    expect(staticUploads).toHaveLength(1);
    expect((staticUploads[0].args[1] as number[]).length).toBe(18);
  });

  it("skips a system with no live particles, without allocating GPU state", async () => {
    const { renderer, gl, camera } = await initialized();
    const empty = new TestParticles(16, 0);
    gl.reset();

    renderer.render(empty.asNode, [createView(camera)]);

    expect(gl.countOf("drawArraysInstanced")).toBe(0);
    expect(gl.countOf("createVertexArray")).toBe(1); // the shared quad only
    expect(gl.countOf("bufferSubData")).toBe(0);
    expect(gl.countOf("useProgram")).toBe(1); // the unlit resting state
  });

  it("skips a system whose instance buffer GL will not allocate", async () => {
    const { renderer, gl, camera } = await initialized();
    const particles = new TestParticles(2);
    // The shared quad gets its buffer; the instance stream does not.
    let buffers = 0;
    gl.createBuffer = (): ReturnType<ParticleGlContext["createBuffer"]> => {
      buffers += 1;
      return buffers <= 1 ? { kind: "buffer" } : null;
    };
    gl.reset();

    renderer.render(particles.asNode, [createView(camera)]);

    expect(gl.countOf("drawArraysInstanced")).toBe(0);
    expect(gl.countOf("bufferSubData")).toBe(0);
    // The frame carries on rather than throwing (§61).
    expect(renderer.contextLost).toBe(false);
  });

  it("skips a system when even the shared quad will not upload", async () => {
    const { renderer, gl, camera } = await initialized();
    const particles = new TestParticles(2);
    gl.createVertexArray = () => null;
    gl.reset();

    renderer.render(particles.asNode, [createView(camera)]);

    expect(gl.countOf("drawArraysInstanced")).toBe(0);
  });

  it("disposes the programs it already built when a later one fails to compile", async () => {
    // Six shader stages are compiled in pipeline order: unlit, sprite,
    // particles. Failing the fifth fails the particle pipeline and must leave
    // no GL program behind (§61, §83).
    const failAfter = (stages: number) => {
      const gl = createFakeGl();
      let compiled = 0;
      gl.getShaderParameter = (): boolean => {
        compiled += 1;
        return compiled <= stages;
      };
      return gl;
    };

    const spriteFailed = failAfter(2);
    const particlesFailed = failAfter(4);
    const spriteError = await rejection(
      new WebglRenderer().initialize({ canvas: new TestCanvas(spriteFailed) }),
    );
    const particleError = await rejection(
      new WebglRenderer().initialize({
        canvas: new TestCanvas(particlesFailed),
      }),
    );

    expect(spriteError.code).toBe("SHADER_COMPILATION_FAILED");
    expect(spriteFailed.countOf("deleteProgram")).toBe(1);
    expect(particleError.code).toBe("SHADER_COMPILATION_FAILED");
    expect(particlesFailed.countOf("deleteProgram")).toBe(2);
  });

  it("draws the §43 interpolated pose of a particle system", async () => {
    const { renderer, gl, camera } = await initialized();
    const particles = new TestParticles(2);
    const poses = new TestPoseBuffer().track(
      particles.asNode,
      new Vector3(0, 0, 0),
      new Vector3(4, 0, 0),
    );
    gl.reset();

    renderer.render(
      particles.asNode,
      [createView(camera)],
      interpolationAt(poses, 0.25),
    );

    const model = uploadsAt(
      gl,
      particleUniforms(gl).get("model"),
    )[0] as number[];
    expect(model[12]).toBeCloseTo(1, 12);
    expect(poses.alphas).toEqual([0.25]);
  });

  it("re-creates the batch after a context loss and restore (§61)", async () => {
    const { renderer, gl, canvas, camera } = await initialized();
    const particles = new TestParticles(2);
    const views = [createView(camera)];
    renderer.render(particles.asNode, views);

    canvas.dispatch("webglcontextlost");
    canvas.dispatch("webglcontextrestored");
    gl.reset();
    renderer.render(particles.asNode, views);

    // Fresh handles, and no delete against the dead ones.
    expect(gl.countOf("createVertexArray")).toBe(2);
    expect(gl.countOf("deleteVertexArray")).toBe(0);
    expect(gl.countOf("drawArraysInstanced")).toBe(1);
  });

  it("deletes the particle vertex array and instance buffer on disposal (§83)", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.render(new TestParticles(2).asNode, [createView(camera)]);
    gl.reset();

    renderer.dispose();

    // The shared quad's array and buffers, plus this system's pair.
    expect(gl.countOf("deleteVertexArray")).toBe(2);
    expect(gl.countOf("deleteBuffer")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The lit pipeline (§57 LitMaterial, §68, §120 "lighting" — 2026-08-04).
// ---------------------------------------------------------------------------

/** Three vertices, one unindexed triangle, +Z normals on every vertex. */
function litTriangleGeometry(): TestGeometry {
  return new TestGeometry(
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    undefined,
    "triangles",
    new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  );
}

/** Lit triangle plus a uv stream — an emissive-only (no albedo) draw still interpolates uvs. */
function litUvTriangleGeometry(): TestGeometry {
  return new TestGeometry(
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    undefined,
    "triangles",
    new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    new Float32Array([0, 0, 1, 0, 0, 1]),
  );
}

function litRenderable(
  geometry: TestGeometry = litTriangleGeometry(),
  material: TestLitMaterial = new TestLitMaterial(),
): Renderable {
  return new Renderable(geometry.asGeometry, material.asMaterial);
}

describe("LitProgram — compilation and linking (§61, §68, §89)", () => {
  it("compiles both stages, links, and resolves the twenty-four uniforms", () => {
    const gl = createFakeGl();

    const program = LitProgram.create(gl);

    expect(gl.countOf("createShader")).toBe(2);
    expect(gl.countOf("linkProgram")).toBe(1);
    expect(
      gl.callsOf("getUniformLocation").map((call) => call.args[1]),
    ).toEqual([
      "viewProjection",
      "model",
      "normalMatrix",
      "color",
      "ambientLight",
      "lightDirection",
      "lightColor",
      // §57's albedo `map` and its switch (R-19, 2026-08-07).
      "map",
      "useMap",
      // §68's light set (R-17, 2026-08-09). Resolving five more locations is
      // the *only* thing R-17 costs a scene that has no point or spot light:
      // it happens once, at program creation, and no frame that draws such a
      // scene issues a single call for them (see the byte-identity suite).
      // The array names carry the explicit `[0]` GLSL ES 3.00 names.
      "punctualCount",
      "punctualPosition[0]",
      "punctualColor[0]",
      "punctualDirection[0]",
      "punctualParams[0]",
      // §68's hemisphere (2026-09-10). Four more locations resolved once;
      // a frame with no hemisphere issues no call for them.
      "hemisphereSky",
      "hemisphereGround",
      "hemisphereUp",
      "useHemisphere",
      // §69's shadow map (R-18, 2026-08-09). Six more locations resolved once,
      // at program creation, and — exactly as R-17's five — not one call
      // issued by a frame in which no light casts (see the byte-identity
      // suite in `tests/integration/shadows.test.ts`).
      "useShadow",
      "shadowMap",
      "shadowMatrix",
      "shadowBias",
      "shadowNormalBias",
      "shadowTexelSize",
    ]);
    expect(program.disposed).toBe(false);
  });

  it("declares both attribute streams at the fixed locations", () => {
    const gl = createFakeGl();

    LitProgram.create(gl);

    const sources = gl.callsOf("shaderSource").map((call) => call.args[1]);
    for (const source of sources) {
      expect(String(source).startsWith("#version 300 es\n")).toBe(true);
    }
    expect(String(sources[0])).toContain(
      `layout(location = ${String(POSITION_ATTRIBUTE_LOCATION)}) in vec3 position;`,
    );
    expect(String(sources[0])).toContain(
      `layout(location = ${String(NORMAL_ATTRIBUTE_LOCATION)}) in vec3 normal;`,
    );
    expect(String(sources[0])).toContain("uniform mat3 normalMatrix;");
    expect(String(sources[0])).toContain("vNormal = normalMatrix * normal;");
    expect(String(sources[0])).not.toContain("transpose(inverse");
    expect(String(sources[1])).toContain("uniform vec3 ambientLight;");
    expect(String(sources[1])).toContain("uniform vec3 lightDirection;");
    expect(String(sources[1])).toContain("uniform vec3 lightColor;");
  });

  it("uploads the light uniforms as vec3s out of copied scratch", () => {
    const gl = createFakeGl();
    const program = LitProgram.create(gl);
    program.use();

    const ambient: [number, number, number] = [0.25, 0.5, 0.75];
    program.setAmbientLight(ambient);
    program.setDirectionalLight(new Vector3(0, -1, 0), [2, 1, 0.5]);

    const uploads = gl.callsOf("uniform3fv");
    expect(uploads.map((call) => call.args[1])).toEqual([
      [0.25, 0.5, 0.75],
      [0, -1, 0],
      [2, 1, 0.5],
    ]);
    // Scratch is copied at upload time: mutating the source afterwards must
    // not rewrite what was recorded (the snapshot proves the copy).
    ambient[0] = 1;
    expect(gl.callsOf("uniform3fv")[0].args[1]).toEqual([0.25, 0.5, 0.75]);
  });

  it("throws SHADER_COMPILATION_FAILED and cleans up exactly as the unlit program does", () => {
    const failed = createFakeGl({ compileStatus: false });
    const error = thrown(() => {
      LitProgram.create(failed);
    });
    expect(error.code).toBe("SHADER_COMPILATION_FAILED");
    expect(error.context?.stage).toBe("vertex");

    const unresolved = createFakeGl({ resolveUniforms: false });
    const uniformError = thrown(() => {
      LitProgram.create(unresolved);
    });
    expect(uniformError.code).toBe("SHADER_COMPILATION_FAILED");
    expect(unresolved.countOf("deleteProgram")).toBe(1);
  });

  it("deletes the GL program once, idempotently", () => {
    const gl = createFakeGl();
    const program = LitProgram.create(gl);

    program.dispose();
    program.dispose();

    expect(gl.countOf("deleteProgram")).toBe(1);
    expect(program.disposed).toBe(true);
  });

  it("uploads the model matrix and a 9-float normal matrix from setModel", () => {
    const gl = createFakeGl();
    const program = LitProgram.create(gl);
    program.use();
    const uniforms = litUniforms(gl);

    const model = new Matrix4().fromArray([
      2, 0, 0, 0, 0, 4, 0, 0, 0, 0, 8, 0, 1, 2, 3, 1,
    ]);
    program.setModel(model);

    expect(uploadsAt(gl, uniforms.get("model"))).toEqual([
      [2, 0, 0, 0, 0, 4, 0, 0, 0, 0, 8, 0, 1, 2, 3, 1],
    ]);
    // Inverse-transpose of diag(2, 4, 8) is diag(1/2, 1/4, 1/8).
    expect(uploadsAt(gl, uniforms.get("normalMatrix"))).toEqual([
      [0.5, 0, 0, 0, 0.25, 0, 0, 0, 0.125],
    ]);
    const matrix3 = gl.callsOf("uniformMatrix3fv");
    expect(matrix3).toHaveLength(1);
    expect(matrix3[0].args[1]).toBe(false);
    expect((matrix3[0].args[2] as number[]).length).toBe(9);
  });
});

describe("GeometryCache — the normal stream (§53, §68)", () => {
  it("uploads normals into the same vertex array at the fixed second location", () => {
    const gl = createFakeGl();
    const cache = new GeometryCache(gl);
    const geometry = litTriangleGeometry();

    const record = cache.acquire(geometry.asGeometry);

    expect(record).not.toBeNull();
    expect(record?.normalBuffer).not.toBeNull();
    // One vertex array; two buffers — positions and normals.
    expect(gl.countOf("createVertexArray")).toBe(1);
    expect(gl.countOf("createBuffer")).toBe(2);
    expect(
      gl.callsOf("enableVertexAttribArray").map((call) => call.args[0]),
    ).toEqual([POSITION_ATTRIBUTE_LOCATION, NORMAL_ATTRIBUTE_LOCATION]);
    expect(gl.callsOf("vertexAttribPointer")[1].args).toEqual([
      NORMAL_ATTRIBUTE_LOCATION,
      3,
      GL.FLOAT,
      false,
      0,
      0,
    ]);
    // The normals themselves went up.
    expect(gl.callsOf("bufferData")[1].args[1]).toEqual([
      0, 0, 1, 0, 0, 1, 0, 0, 1,
    ]);
  });

  it("leaves the normal slot untouched for position-only geometry", () => {
    const gl = createFakeGl();
    const record = new GeometryCache(gl).acquire(triangleGeometry().asGeometry);

    expect(record?.normalBuffer).toBeNull();
    expect(
      gl.callsOf("enableVertexAttribArray").map((call) => call.args[0]),
    ).toEqual([POSITION_ATTRIBUTE_LOCATION]);
  });

  it("retains the normal buffer when a stale version re-uploads (§53)", () => {
    const gl = createFakeGl();
    const cache = new GeometryCache(gl);
    const geometry = litTriangleGeometry();
    cache.acquire(geometry.asGeometry);
    gl.reset();

    geometry.markDirty();
    cache.acquire(geometry.asGeometry);

    expect(gl.countOf("deleteVertexArray")).toBe(0);
    expect(gl.countOf("deleteBuffer")).toBe(0);
    expect(gl.countOf("createBuffer")).toBe(0);
    // Both attribute data stores are replaced, but their handles stay live.
    expect(gl.countOf("bufferData")).toBe(2);
  });

  it("cleans up the position buffer when GL refuses the normal buffer", () => {
    const gl = createFakeGl();
    let buffers = 0;
    const base = gl.createBuffer.bind(gl);
    gl.createBuffer = (): object | null => {
      buffers += 1;
      return buffers === 2 ? null : base();
    };
    const cache = new GeometryCache(gl);

    expect(cache.acquire(litTriangleGeometry().asGeometry)).toBeNull();
    expect(gl.countOf("deleteBuffer")).toBe(1);
    expect(gl.countOf("deleteVertexArray")).toBe(1);
    expect(cache.size).toBe(0);
  });

  it("cleans up both attribute buffers when GL refuses the index buffer", () => {
    const gl = createFakeGl();
    let buffers = 0;
    const base = gl.createBuffer.bind(gl);
    gl.createBuffer = (): object | null => {
      buffers += 1;
      return buffers === 3 ? null : base();
    };
    const geometry = new TestGeometry(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Uint16Array([0, 1, 2]),
      "triangles",
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    );

    expect(new GeometryCache(gl).acquire(geometry.asGeometry)).toBeNull();
    expect(gl.countOf("deleteBuffer")).toBe(2);
    expect(gl.countOf("deleteVertexArray")).toBe(1);
  });
});

describe("WebglRenderer.render — lit surfaces (§68, §120)", () => {
  it("draws a lit item through the lit pipeline with the frame's lights", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = new AmbientRoot([0.25, 0.5, 0.75]);
    const light = new TestLight([1, 0.5, 0.25], 2, [0, -1, 0]);
    const material = new TestLitMaterial([1, 0, 0, 1]);
    root.add(light, litRenderable(litTriangleGeometry(), material));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    const uniforms = litUniforms(gl);
    expect(uploadsAt(gl, uniforms.get("ambientLight"))).toEqual([
      [0.25, 0.5, 0.75],
    ]);
    expect(uploadsAt(gl, uniforms.get("lightDirection"))).toEqual([[0, -1, 0]]);
    // color × intensity, premultiplied on the CPU (SceneLights).
    expect(uploadsAt(gl, uniforms.get("lightColor"))).toEqual([[2, 1, 0.5]]);
    expect(uploadsAt(gl, uniforms.get("color"))).toEqual([[1, 0, 0, 1]]);
    expect(gl.countOf("drawArrays")).toBe(1);
    // The frame starts on the unlit program and switches once.
    expect(gl.countOf("useProgram")).toBe(2);
    // Lit surfaces are opaque: blending never turns on.
    expect(
      gl.callsOf("enable").filter((call) => call.args[0] === GL.BLEND),
    ).toHaveLength(0);
  });

  it("uploads the documented no-light state when no directional light exists", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(litRenderable());
    gl.reset();

    renderer.render(root, [createView(camera)]);

    const uniforms = litUniforms(gl);
    expect(uploadsAt(gl, uniforms.get("ambientLight"))).toEqual([[0, 0, 0]]);
    expect(uploadsAt(gl, uniforms.get("lightDirection"))).toEqual([[0, 0, -1]]);
    expect(uploadsAt(gl, uniforms.get("lightColor"))).toEqual([[0, 0, 0]]);
    // The draw still happens — an unlit-black surface is the scene author's
    // statement, not an error.
    expect(gl.countOf("drawArrays")).toBe(1);
  });

  it("ignores a light in a hidden subtree, like the render list ignores its draws", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const arm = createRoot();
    arm.visible = false;
    arm.add(new TestLight([1, 1, 1], 5, [0, -1, 0]));
    root.add(arm, litRenderable());
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(uploadsAt(gl, litUniforms(gl).get("lightColor"))).toEqual([
      [0, 0, 0],
    ]);
  });

  it("collects lights only for frames that contain a lit item", async () => {
    const { renderer, camera } = await initialized();
    const root = createRoot();
    const light = new TestLight();
    root.add(light, renderable(triangleGeometry()));

    renderer.render(root, [createView(camera)]);
    // An unlit frame never asked the light for anything.
    expect(light.directionReads).toBe(0);

    root.add(litRenderable());
    renderer.render(root, [createView(camera)]);
    expect(light.directionReads).toBe(1);
  });

  it("uploads the lit view state once per view, per view", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(new TestLight(), litRenderable(), litRenderable());
    gl.reset();

    renderer.render(root, [
      createView(camera, { id: "a", width: 0.5 }),
      createView(camera, { id: "b", x: 0.5, width: 0.5 }),
    ]);

    const uniforms = litUniforms(gl);
    // Two views × one upload each — not one per draw, not one per frame.
    expect(uploadsAt(gl, uniforms.get("ambientLight"))).toHaveLength(2);
    expect(uploadsAt(gl, uniforms.get("lightDirection"))).toHaveLength(2);
    // Two views × two draws.
    expect(uploadsAt(gl, uniforms.get("model"))).toHaveLength(4);
    expect(gl.countOf("drawArrays")).toBe(4);
  });

  it("switches back to the unlit program after a lit run", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const lit = litRenderable();
    lit.renderOrder = 0;
    const unlit = renderable(triangleGeometry());
    unlit.renderOrder = 1;
    root.add(lit, unlit);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // Frame start (unlit), the lit run, back to unlit.
    expect(gl.countOf("useProgram")).toBe(3);
    expect(gl.countOf("drawArrays")).toBe(2);
    expect(
      gl.callsOf("enable").filter((call) => call.args[0] === GL.BLEND),
    ).toHaveLength(0);
  });

  it("disables blending when a lit item follows a sprite", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const first = sprite();
    first.renderOrder = 0;
    const second = litRenderable();
    second.renderOrder = 1;
    root.add(first, second);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    const names = gl.names();
    const blendOn = names.indexOf("enable");
    const blendOff = names.lastIndexOf("disable");
    expect(gl.callsOf("enable")[0].args[0]).toBe(GL.BLEND);
    // The lit switch turns blending off before the lit draw runs.
    expect(blendOn).toBeLessThan(blendOff);
    // The sprite's indexed quad, then the lit triangle.
    expect(gl.countOf("drawElements")).toBe(1);
    expect(gl.countOf("drawArrays")).toBe(1);
  });

  it("shades a normal-less geometry through the lit pipeline without a normal stream", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    // A lit material on a position-only geometry: draws, reads the attribute
    // default at the normal slot, and the shader's zero-length guard makes it
    // ambient-only — never a crash, never a NaN.
    root.add(litRenderable(triangleGeometry()));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("drawArrays")).toBe(1);
    expect(
      gl.callsOf("enableVertexAttribArray").map((call) => call.args[0]),
    ).toEqual([POSITION_ATTRIBUTE_LOCATION]);
  });
});

// ---------------------------------------------------------------------------
// §57 material render state (R-11, 2026-08-06).
//
// The claim under test is two-sided: state a material declares reaches GL, and
// state it does *not* declare costs the frame nothing at all — the second half
// is what keeps every scene authored before §57's base rendering byte for byte
// as it did.
// ---------------------------------------------------------------------------

/** A renderable whose unlit material carries the given §57 state. */
function stateful(
  state: Partial<TestMaterial>,
  color: [number, number, number, number] = [1, 1, 1, 1],
): Renderable {
  const material = new TestMaterial(color);
  Object.assign(material, state);
  return new Renderable(triangleGeometry().asGeometry, material.asMaterial);
}

/** GL capability toggles recorded this frame, in call order. */
function toggles(gl: FakeGl): [string, unknown][] {
  return gl.calls
    .filter((call) => call.name === "enable" || call.name === "disable")
    .map((call) => [call.name, call.args[0]]);
}

describe("WebglRenderer.render — §57 render state (R-11)", () => {
  it("costs nothing for a material that declares none of it", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(triangleGeometry()));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // The compatibility guarantee, asserted as the absence of every call the
    // state could have made.
    expect(gl.countOf("enable")).toBe(0);
    expect(gl.countOf("disable")).toBe(0);
    expect(gl.countOf("depthMask")).toBe(0);
    expect(gl.countOf("colorMask")).toBe(0);
    expect(gl.countOf("blendFunc")).toBe(0);
  });

  it("blends a transparent unlit item, and stops when the frame ends", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(stateful({ transparent: true }));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    const names = gl.names();
    expect(toggles(gl)).toEqual([
      ["enable", GL.BLEND],
      ["disable", GL.BLEND],
    ]);
    expect(names.indexOf("enable")).toBeLessThan(names.indexOf("drawArrays"));
    expect(names.lastIndexOf("disable")).toBeGreaterThan(
      names.indexOf("drawArrays"),
    );
    // The function was fixed at initialization and is still straight alpha.
    expect(gl.countOf("blendFunc")).toBe(0);
  });

  it("blends an opaque-flagged unlit whose color alpha is not 1, and restores after", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(stateful({}, [1, 0, 0, 0.5]));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(toggles(gl)).toEqual([
      ["enable", GL.BLEND],
      ["disable", GL.BLEND],
    ]);
    expect(gl.names().indexOf("enable")).toBeLessThan(
      gl.names().indexOf("drawArrays"),
    );
    expect(gl.names().lastIndexOf("disable")).toBeGreaterThan(
      gl.names().indexOf("drawArrays"),
    );
    expect(gl.countOf("blendFunc")).toBe(0);
  });

  it("leaves an opaque unlit (color alpha 1, transparent false) unblended", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(stateful({ transparent: false }, [1, 0, 0, 1]));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(
      gl.callsOf("enable").filter((call) => call.args[0] === GL.BLEND),
    ).toHaveLength(0);
    expect(
      gl.callsOf("disable").filter((call) => call.args[0] === GL.BLEND),
    ).toHaveLength(0);
  });

  it("blends a transparent lit item — the alpha that used to be dead", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const material = new TestLitMaterial([1, 0, 0, 0.5]);
    const node = new Renderable(
      litTriangleGeometry().asGeometry,
      material.asMaterial,
    );
    (material as { transparent?: boolean }).transparent = true;
    root.add(node);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(toggles(gl)).toEqual([
      ["enable", GL.BLEND],
      ["disable", GL.BLEND],
    ]);
    expect(uploadsAt(gl, litUniforms(gl).get("color"))).toEqual([
      [1, 0, 0, 0.5],
    ]);
  });

  it("switches blending off between a transparent and an opaque item", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    // Layers, not render order: §66 key 2 outranks key 5, so a transparent
    // item can only precede an opaque one from an earlier layer — which is
    // exactly the case that makes the backend switch blending back off
    // mid-frame.
    const glass = stateful({ transparent: true });
    glass.renderLayer = 0;
    const wall = renderable(triangleGeometry());
    wall.renderLayer = 1;
    root.add(glass, wall);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // One enable, one disable — and the disable lands before the second draw,
    // not at the end of the frame.
    expect(toggles(gl)).toEqual([
      ["enable", GL.BLEND],
      ["disable", GL.BLEND],
    ]);
    expect(gl.names().indexOf("disable")).toBeLessThan(
      gl.names().lastIndexOf("drawArrays"),
    );
    // Both draws ran through the one unlit program.
    expect(gl.countOf("useProgram")).toBe(1);
  });

  it("maps each blend mode onto its GL function, and restores it", async () => {
    const cases: [string, [number, number]][] = [
      ["additive", [GL.SRC_ALPHA, GL.ONE]],
      ["multiply", [GL.DST_COLOR, GL.ZERO]],
      ["screen", [GL.ONE, GL.ONE_MINUS_SRC_COLOR]],
    ];
    for (const [mode, factors] of cases) {
      const { renderer, gl, camera } = await initialized();
      const root = createRoot();
      root.add(
        stateful({
          transparent: true,
          blendMode: mode as TestMaterial["blendMode"],
        }),
      );
      gl.reset();

      renderer.render(root, [createView(camera)]);

      expect(gl.callsOf("blendFunc").map((call) => call.args)).toEqual([
        factors,
        // Restored to straight alpha before returning: the function outlives
        // the enable, and the next frame starts from the fixed state.
        [GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA],
      ]);
    }
  });

  it("issues one blendFunc for a run of items sharing a mode", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(
      stateful({ transparent: true, blendMode: "additive" }),
      stateful({ transparent: true, blendMode: "additive" }),
    );
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // Once for the run, once to restore.
    expect(gl.countOf("blendFunc")).toBe(2);
    expect(gl.countOf("drawArrays")).toBe(2);
  });

  it("leaves the blend function alone for an opaque material that names one", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(stateful({ blendMode: "additive" }));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // A mode on a material that does not blend has nothing to change.
    expect(gl.countOf("blendFunc")).toBe(0);
    expect(gl.countOf("enable")).toBe(0);
  });

  it("honours a sprite material's blend mode, which blends either way", async () => {
    const { renderer, gl, camera } = await initialized();
    const material = new TestSpriteMaterial();
    (material as { blendMode?: string }).blendMode = "additive";
    const root = createRoot();
    root.add(sprite(material));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.callsOf("blendFunc")[0].args).toEqual([GL.SRC_ALPHA, GL.ONE]);
    expect(
      gl.callsOf("enable").map((call) => call.args[0] as number),
    ).toContain(GL.BLEND);
  });

  it("maps depthTest, depthWrite, and colorWrite onto GL, and restores them", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(
      stateful({ depthTest: false, depthWrite: false, colorWrite: false }),
    );
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(toggles(gl)).toEqual([
      ["disable", GL.DEPTH_TEST],
      ["enable", GL.DEPTH_TEST],
    ]);
    expect(gl.callsOf("depthMask").map((call) => call.args[0])).toEqual([
      false,
      true,
    ]);
    expect(gl.callsOf("colorMask").map((call) => call.args)).toEqual([
      [false, false, false, false],
      [true, true, true, true],
    ]);
    const names = gl.names();
    expect(names.indexOf("depthMask")).toBeLessThan(
      names.indexOf("drawArrays"),
    );
    expect(names.lastIndexOf("depthMask")).toBeGreaterThan(
      names.indexOf("drawArrays"),
    );
  });

  it("puts the depth and colour masks back before the next view clears", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(stateful({ depthWrite: false, colorWrite: false }));
    gl.reset();

    renderer.render(root, [
      createView(camera),
      createView(camera, { clearColor: [0, 0, 0, 1] }),
    ]);

    // §61's clear is masked by both, so a view following a masked draw would
    // clear nothing: the second view restores them before its `clear`.
    const names = gl.names();
    const secondClear = names.lastIndexOf("clear");
    const restoreDepth = gl.calls.findIndex(
      (call, index) =>
        call.name === "depthMask" &&
        call.args[0] === true &&
        index < secondClear,
    );
    expect(restoreDepth).toBeGreaterThan(-1);
    expect(restoreDepth).toBeLessThan(secondClear);
  });

  it("restores the depth mask a particle system does not declare", async () => {
    const { renderer, gl, camera } = await initialized();
    const masked = stateful({ depthWrite: false });
    masked.renderOrder = 0;
    const particles = new TestParticles(2);
    particles.renderOrder = 1;
    const root = new TestGroup().addRenderables(masked).add(particles);
    gl.reset();

    renderer.render(root.asNode, [createView(camera)]);

    // §36 carries no material, so it draws with §57's defaults: the mask the
    // previous item turned off is back on before the instanced draw.
    const names = gl.names();
    const restore = gl.calls.findIndex(
      (call) => call.name === "depthMask" && call.args[0] === true,
    );
    expect(restore).toBeGreaterThan(-1);
    expect(restore).toBeLessThan(names.indexOf("drawArraysInstanced"));
  });

  it("multiplies opacity into the uploaded alpha, and leaves the material alone", async () => {
    const { renderer, gl, camera } = await initialized();
    // Values exact in binary, so the assertion is about the multiply and not
    // about float32 rounding: 0.75 × 0.5 = 0.375.
    const material = new TestMaterial([1, 0.5, 0, 0.75]);
    material.opacity = 0.5;
    const root = createRoot();
    root.add(
      new Renderable(triangleGeometry().asGeometry, material.asMaterial),
    );
    gl.reset();

    renderer.render(root, [createView(camera)]);

    const uploads = uploadsAt(gl, gl.uniformLocations.get("color"));
    expect(uploads).toEqual([[1, 0.5, 0, 0.375]]);
    // The material's own array is untouched — the scale happens in scratch.
    expect(material.color).toEqual([1, 0.5, 0, 0.75]);
  });

  it("scales a sprite tint by opacity too", async () => {
    const { renderer, gl, camera } = await initialized();
    const material = new TestSpriteMaterial(new TestTexture(), [1, 1, 1, 0.5]);
    (material as { opacity?: number }).opacity = 0.5;
    const root = createRoot();
    root.add(sprite(material));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(uploadsAt(gl, spriteUniforms(gl).get("tint"))).toEqual([
      [1, 1, 1, 0.25],
    ]);
  });
});

// ---------------------------------------------------------------------------
// §53 standard attributes, §57 `map`, and per-vertex colour (R-19, R-35).
//
// The claim under test is the same two-sided one §57's render state makes: a
// material that asks for a texture or for vertex colours gets them, and a
// material that asks for neither costs the frame **nothing** — no extra
// program, no extra uniform upload, no texture binding. The second half is what
// keeps every scene authored before R-19 issuing byte-for-byte the GL sequence
// it always did, and it is why the two features are uniform switches on one
// program rather than shader variants.
// ---------------------------------------------------------------------------

/** Three vertices with a uv per vertex — the textured-triangle double. */
function uvTriangleGeometry(): TestGeometry {
  return new TestGeometry(
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    undefined,
    "triangles",
    undefined,
    new Float32Array([0, 0, 1, 0, 0, 1]),
  );
}

/** The unlit program's uniform handles — it is the first program built. */
function unlitUniforms(gl: FakeGl): Map<string, object> {
  for (const perProgram of gl.uniformsByProgram.values()) {
    if (perProgram.has("useVertexColors")) {
      return perProgram;
    }
  }
  throw new Error("the unlit program never resolved its uniforms");
}

describe("GeometryCache — the uv and colour streams (§53, R-19)", () => {
  it("uploads uvs at the fixed third location, two floats per vertex", () => {
    const gl = createFakeGl();
    const record = new GeometryCache(gl).acquire(
      uvTriangleGeometry().asGeometry,
    );

    expect(record?.uvBuffer).not.toBeNull();
    expect(record?.colorBuffer).toBeNull();
    expect(gl.countOf("createBuffer")).toBe(2);
    expect(
      gl.callsOf("enableVertexAttribArray").map((call) => call.args[0]),
    ).toEqual([POSITION_ATTRIBUTE_LOCATION, UV_ATTRIBUTE_LOCATION]);
    expect(gl.callsOf("vertexAttribPointer")[1].args).toEqual([
      UV_ATTRIBUTE_LOCATION,
      2,
      GL.FLOAT,
      false,
      0,
      0,
    ]);
    expect(gl.callsOf("bufferData")[1].args[1]).toEqual([0, 0, 1, 0, 0, 1]);
  });

  it("uploads colours at the fixed fourth location, four floats per vertex", () => {
    const gl = createFakeGl();
    const geometry = new TestGeometry(
      new Float32Array([0, 0, 0, 1, 0, 0]),
      undefined,
      "lines",
      undefined,
      undefined,
      new Float32Array([1, 0, 0, 1, 0, 0, 1, 1]),
    );

    const record = new GeometryCache(gl).acquire(geometry.asGeometry);

    expect(record?.colorBuffer).not.toBeNull();
    expect(record?.mode).toBe(GL.LINES);
    expect(
      gl.callsOf("enableVertexAttribArray").map((call) => call.args[0]),
    ).toEqual([POSITION_ATTRIBUTE_LOCATION, COLOR_ATTRIBUTE_LOCATION]);
    expect(gl.callsOf("vertexAttribPointer")[1].args).toEqual([
      COLOR_ATTRIBUTE_LOCATION,
      4,
      GL.FLOAT,
      false,
      0,
      0,
    ]);
    expect(gl.callsOf("bufferData")[1].args[1]).toEqual([
      1, 0, 0, 1, 0, 0, 1, 1,
    ]);
  });

  it("binds all four streams in the documented slot order", () => {
    const gl = createFakeGl();
    const geometry = new TestGeometry(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Uint16Array([0, 1, 2]),
      "triangles",
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      new Float32Array([0, 0, 1, 0, 0, 1]),
      new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
    );

    const record = new GeometryCache(gl).acquire(geometry.asGeometry);

    expect(record?.normalBuffer).not.toBeNull();
    expect(record?.uvBuffer).not.toBeNull();
    expect(record?.colorBuffer).not.toBeNull();
    expect(record?.indexBuffer).not.toBeNull();
    // Positions, normals, uvs, colours — and the index buffer, which is not an
    // attribute and enables nothing.
    expect(gl.countOf("createBuffer")).toBe(5);
    expect(
      gl.callsOf("enableVertexAttribArray").map((call) => call.args[0]),
    ).toEqual([
      POSITION_ATTRIBUTE_LOCATION,
      NORMAL_ATTRIBUTE_LOCATION,
      UV_ATTRIBUTE_LOCATION,
      COLOR_ATTRIBUTE_LOCATION,
    ]);
  });

  it("leaves both slots untouched for a position-only geometry", () => {
    const gl = createFakeGl();
    const record = new GeometryCache(gl).acquire(triangleGeometry().asGeometry);

    expect(record?.uvBuffer).toBeNull();
    expect(record?.colorBuffer).toBeNull();
    expect(gl.countOf("createBuffer")).toBe(1);
  });

  it("retains every attribute buffer when a stale version re-uploads (§53)", () => {
    const gl = createFakeGl();
    const cache = new GeometryCache(gl);
    const geometry = new TestGeometry(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      undefined,
      "triangles",
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      new Float32Array([0, 0, 1, 0, 0, 1]),
      new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
    );
    cache.acquire(geometry.asGeometry);
    gl.reset();

    geometry.markDirty();
    cache.acquire(geometry.asGeometry);

    expect(gl.countOf("deleteVertexArray")).toBe(0);
    expect(gl.countOf("deleteBuffer")).toBe(0);
    expect(gl.countOf("createBuffer")).toBe(0);
    expect(gl.countOf("bufferData")).toBe(4);
  });

  it("unwinds every buffer it allocated when GL refuses a later one", () => {
    // Positions and uvs succeed, the colour buffer does not: the record is
    // abandoned, and nothing it created survives.
    const gl = createFakeGl();
    let buffers = 0;
    const base = gl.createBuffer.bind(gl);
    gl.createBuffer = (): object | null => {
      buffers += 1;
      return buffers === 3 ? null : base();
    };
    const geometry = new TestGeometry(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      undefined,
      "triangles",
      undefined,
      new Float32Array([0, 0, 1, 0, 0, 1]),
      new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
    );
    const cache = new GeometryCache(gl);

    expect(cache.acquire(geometry.asGeometry)).toBeNull();
    expect(gl.countOf("deleteBuffer")).toBe(2);
    expect(gl.countOf("deleteVertexArray")).toBe(1);
    expect(cache.size).toBe(0);
  });

  it("unwinds when GL refuses the uv buffer itself", () => {
    const gl = createFakeGl();
    let buffers = 0;
    const base = gl.createBuffer.bind(gl);
    gl.createBuffer = (): object | null => {
      buffers += 1;
      return buffers === 2 ? null : base();
    };

    expect(new GeometryCache(gl).acquire(uvTriangleGeometry().asGeometry)).toBe(
      null,
    );
    expect(gl.countOf("deleteBuffer")).toBe(1);
    expect(gl.countOf("deleteVertexArray")).toBe(1);
  });
});

describe("UnlitProgram / LitProgram — the R-19 feature switches", () => {
  it("declares the uv and colour attributes at the fixed locations", () => {
    const gl = createFakeGl();

    UnlitProgram.create(gl);

    const sources = gl.callsOf("shaderSource").map((call) => call.args[1]);
    expect(String(sources[0])).toContain(
      `layout(location = ${String(UV_ATTRIBUTE_LOCATION)}) in vec2 uv;`,
    );
    expect(String(sources[0])).toContain(
      `layout(location = ${String(COLOR_ATTRIBUTE_LOCATION)}) in vec4 vertexColor;`,
    );
    expect(String(sources[1])).toContain("uniform sampler2D map;");
    expect(String(sources[1])).toContain("uniform bool useMap;");
    expect(String(sources[1])).toContain("uniform bool useVertexColors;");
  });

  it("declares the uv attribute on the lit pipeline too", () => {
    const gl = createFakeGl();

    LitProgram.create(gl);

    const sources = gl.callsOf("shaderSource").map((call) => call.args[1]);
    expect(String(sources[0])).toContain(
      `layout(location = ${String(UV_ATTRIBUTE_LOCATION)}) in vec2 uv;`,
    );
    expect(String(sources[1])).toContain("uniform sampler2D map;");
  });

  it("uploads nothing while both features stay off — GL already starts there", () => {
    const gl = createFakeGl();
    const program = UnlitProgram.create(gl);
    gl.reset();

    program.setFeatures(false, false);
    program.setFeatures(false, false);

    expect(gl.countOf("uniform1i")).toBe(0);
  });

  it("uploads the sampler unit once, on the first textured draw", () => {
    const gl = createFakeGl();
    const program = UnlitProgram.create(gl);
    const uniforms = unlitUniforms(gl);
    gl.reset();

    program.setFeatures(true, false);
    program.setFeatures(true, false);
    program.setFeatures(false, false);
    program.setFeatures(true, false);

    expect(uploadsAt(gl, uniforms.get("map"))).toEqual([MAP_TEXTURE_UNIT]);
    // On, off, on — three switch uploads, and never one for an unchanged value.
    expect(uploadsAt(gl, uniforms.get("useMap"))).toEqual([1, 0, 1]);
  });

  it("switches vertex colours independently of the texture", () => {
    const gl = createFakeGl();
    const program = UnlitProgram.create(gl);
    const uniforms = unlitUniforms(gl);
    gl.reset();

    program.setFeatures(false, true);
    program.setFeatures(false, true);
    program.setFeatures(false, false);

    expect(uploadsAt(gl, uniforms.get("useVertexColors"))).toEqual([1, 0]);
    // No texture was ever asked for, so the sampler was never uploaded.
    expect(uploadsAt(gl, uniforms.get("map"))).toEqual([]);
  });

  it("mirrors the lit pipeline's one switch the same way", () => {
    const gl = createFakeGl();
    const program = LitProgram.create(gl);
    const uniforms = litUniforms(gl);
    gl.reset();

    program.setFeatures(false);
    program.setFeatures(true);
    program.setFeatures(true);
    program.setFeatures(false);

    expect(uploadsAt(gl, uniforms.get("useMap"))).toEqual([1, 0]);
    expect(uploadsAt(gl, uniforms.get("map"))).toEqual([MAP_TEXTURE_UNIT]);
  });
});

describe("WebglRenderer.render — textured and vertex-coloured meshes (R-19)", () => {
  it("costs an untextured, uncoloured scene nothing at all", async () => {
    // The compatibility guarantee, asserted as the absence of every call the
    // two features could have made — the same shape as R-11's assertion, and
    // the reason this could land under the pixel-golden gate.
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(uvTriangleGeometry()));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("useProgram")).toBe(1);
    expect(gl.countOf("uniform1i")).toBe(0);
    expect(gl.countOf("bindTexture")).toBe(0);
    expect(gl.countOf("activeTexture")).toBe(0);
    expect(gl.countOf("createTexture")).toBe(0);
    expect(gl.countOf("drawArrays")).toBe(1);
  });

  it("binds a mapped unlit material's texture and switches the sampler on", async () => {
    const { renderer, gl, camera } = await initialized();
    const texture = new TestTexture();
    const material = new TestMaterial([1, 1, 1, 1]);
    material.map = texture.asTexture;
    const root = createRoot();
    root.add(renderable(uvTriangleGeometry(), material));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    const uniforms = unlitUniforms(gl);
    expect(uploadsAt(gl, uniforms.get("useMap"))).toEqual([1]);
    expect(uploadsAt(gl, uniforms.get("map"))).toEqual([MAP_TEXTURE_UNIT]);
    expect(gl.callsOf("activeTexture")[0].args[0]).toBe(
      GL.TEXTURE0 + MAP_TEXTURE_UNIT,
    );
    // Bound before the draw, and unbound when the frame ends.
    const names = gl.names();
    expect(names.indexOf("bindTexture")).toBeLessThan(
      names.indexOf("drawArrays"),
    );
    expect(gl.callsOf("bindTexture").at(-1)?.args[1]).toBeNull();
    // Still one pipeline: the switch is a uniform, not a variant.
    expect(gl.countOf("useProgram")).toBe(1);
  });

  it("switches the sampler back off for an untextured item after a textured one", async () => {
    const { renderer, gl, camera } = await initialized();
    const textured = new TestMaterial();
    textured.map = new TestTexture().asTexture;
    const root = createRoot();
    root.add(renderable(uvTriangleGeometry(), textured));
    root.add(renderable(triangleGeometry()));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(uploadsAt(gl, unlitUniforms(gl).get("useMap"))).toEqual([1, 0]);
    expect(gl.countOf("drawArrays")).toBe(2);
    // One `activeTexture` for the frame, whatever the mix.
    expect(gl.countOf("activeTexture")).toBe(1);
  });

  it("skips the map of a disposed texture rather than drawing undefined content", async () => {
    const { renderer, gl, camera } = await initialized();
    const texture = new TestTexture();
    texture.dispose();
    const material = new TestMaterial();
    material.map = texture.asTexture;
    const root = createRoot();
    root.add(renderable(uvTriangleGeometry(), material));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // §83: the geometry still draws, flat-coloured — the *texture* is what is
    // unusable, not the mesh.
    expect(gl.countOf("drawArrays")).toBe(1);
    expect(gl.countOf("bindTexture")).toBe(0);
    expect(gl.countOf("uniform1i")).toBe(0);
  });

  it("binds a lit material's albedo map through the lit pipeline", async () => {
    const { renderer, gl, camera } = await initialized();
    const material = new TestLitMaterial([1, 0, 0, 1]);
    material.map = new TestTexture().asTexture;
    const geometry = new TestGeometry(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      undefined,
      "triangles",
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      new Float32Array([0, 0, 1, 0, 0, 1]),
    );
    const root = createRoot();
    root.add(litRenderable(geometry, material));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    const uniforms = litUniforms(gl);
    expect(uploadsAt(gl, uniforms.get("useMap"))).toEqual([1]);
    expect(uploadsAt(gl, uniforms.get("map"))).toEqual([MAP_TEXTURE_UNIT]);
    // The last thing the frame does is unbind, whatever the upload path bound
    // on the way (§61: leave nothing bound).
    expect(gl.callsOf("bindTexture").at(-1)?.args[1]).toBeNull();
    expect(gl.countOf("drawArrays")).toBe(1);
    // The geometry's uv stream went up alongside its normals.
    expect(
      gl.callsOf("enableVertexAttribArray").map((call) => call.args[0]),
    ).toEqual([
      POSITION_ATTRIBUTE_LOCATION,
      NORMAL_ATTRIBUTE_LOCATION,
      UV_ATTRIBUTE_LOCATION,
    ]);
  });

  it("shares one GL texture between a sprite and a mapped mesh", async () => {
    const { renderer, gl, camera } = await initialized();
    const texture = new TestTexture();
    const material = new TestMaterial();
    material.map = texture.asTexture;
    const root = createRoot();
    root.add(sprite(new TestSpriteMaterial(texture)));
    root.add(renderable(uvTriangleGeometry(), material));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // The texture cache is keyed on the texture, not on the pipeline that
    // reaches it, so one upload serves both.
    expect(gl.countOf("createTexture")).toBe(1);
    // The sprite's quad is indexed and the mesh is not, so the two draws come
    // out of different entry points.
    expect(gl.countOf("drawElements") + gl.countOf("drawArrays")).toBe(2);
  });

  it("draws a lines-mode geometry with per-vertex colour in ONE call (R-35)", async () => {
    // The §113 debug-draw overlay, end to end: `DebugDrawBuffer`'s seven-float
    // segment layout splits into positions plus straight-RGBA colours, uploads
    // as one `"lines"` geometry, and draws through the unlit pipeline with
    // `vertexColors` on. Before R-19 there was no colour attribute and no
    // switch to consume it, so the overlay had never been shown as pixels.
    const { renderer, gl, camera } = await initialized();
    // Two segments: a red one along +X, a green one along +Y.
    const geometry = new TestGeometry(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0]),
      undefined,
      "lines",
      undefined,
      undefined,
      new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]),
    );
    const material = new TestMaterial();
    material.vertexColors = true;
    const root = createRoot();
    root.add(renderable(geometry, material));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    const uniforms = unlitUniforms(gl);
    // The switch is on, the texture switch is not, and no texture was bound.
    expect(uploadsAt(gl, uniforms.get("useVertexColors"))).toEqual([1]);
    expect(uploadsAt(gl, uniforms.get("useMap"))).toEqual([]);
    expect(gl.countOf("bindTexture")).toBe(0);
    // The colours reached the GPU at the documented slot, four per vertex.
    expect(
      gl.callsOf("enableVertexAttribArray").map((call) => call.args[0]),
    ).toEqual([POSITION_ATTRIBUTE_LOCATION, COLOR_ATTRIBUTE_LOCATION]);
    expect(gl.callsOf("vertexAttribPointer")[1].args).toEqual([
      COLOR_ATTRIBUTE_LOCATION,
      4,
      GL.FLOAT,
      false,
      0,
      0,
    ]);
    expect(gl.callsOf("bufferData")[1].args[1]).toEqual([
      1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1,
    ]);
    // Four vertices, two segments, **one** draw call — the property that makes
    // an overlay of thousands of segments affordable (§84).
    expect(gl.countOf("drawArrays")).toBe(1);
    expect(gl.callsOf("drawArrays")[0].args).toEqual([GL.LINES, 0, 4]);
    // The material's flat colour still multiplies, so an overlay can be faded.
    expect(uploadsAt(gl, uniforms.get("color"))).toEqual([[1, 1, 1, 1]]);
  });

  it("re-uploads the feature state after a context loss and restore (§61)", async () => {
    const { renderer, gl, canvas, camera } = await initialized();
    const material = new TestMaterial();
    material.map = new TestTexture().asTexture;
    const root = createRoot();
    root.add(renderable(uvTriangleGeometry(), material));
    renderer.render(root, [createView(camera)]);

    canvas.dispatch("webglcontextlost");
    canvas.dispatch("webglcontextrestored");
    gl.reset();
    renderer.render(root, [createView(camera)]);

    // A restored context brings a fresh program whose uniforms are back at
    // GL's defaults — and a fresh CPU mirror with them — so both the sampler
    // unit and the switch go up again rather than being assumed still set.
    expect(gl.countOf("uniform1i")).toBe(2);
    expect(gl.countOf("drawArrays")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// A throw mid-frame costs one frame, not the renderer (F13, 2026-08-07).
//
// The frame runs application code — a material or geometry accessor, a texture
// the application disposed between draws — and that code can raise. Before the
// `finally` in `render`, whatever GL state the frame had borrowed was simply
// abandoned while the §57 mirror was reset by the *next* frame to the defaults
// it had stopped guaranteeing; the skip logic then never re-issued the calls
// that would have fixed the context, so one transient exception left every
// later frame drawing blended, masked, or depth-testless, permanently and
// silently. These tests fold the recorded call stream back into the state the
// context is actually in, which is the only way to see that.
// ---------------------------------------------------------------------------

/** The GL state the recorded calls left the context in. */
function effectiveGlState(gl: FakeGl): Record<string, unknown> {
  // Seeded with the fixed state `#applyFixedState` establishes plus GL's own
  // defaults — i.e. the state the tests below `reset()` on top of.
  const state: Record<string, unknown> = {
    blend: false,
    depthTest: true,
    depthWrite: true,
    colorWrite: true,
    blendFunc: [GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA],
    texture: null,
    vertexArray: null,
    // R-4: an off-screen pass binds a framebuffer, and a frame that threw
    // while holding one would send every later frame — on-screen included —
    // into a surface nobody is looking at.
    framebuffer: null,
  };
  for (const call of gl.calls) {
    if (call.name === "enable" || call.name === "disable") {
      const on = call.name === "enable";
      if (call.args[0] === GL.BLEND) {
        state.blend = on;
      } else if (call.args[0] === GL.DEPTH_TEST) {
        state.depthTest = on;
      }
    } else if (call.name === "depthMask") {
      state.depthWrite = call.args[0];
    } else if (call.name === "colorMask") {
      state.colorWrite = call.args[0];
    } else if (call.name === "blendFunc") {
      state.blendFunc = [call.args[0], call.args[1]];
    } else if (call.name === "bindTexture") {
      state.texture = call.args[1];
    } else if (call.name === "bindVertexArray") {
      state.vertexArray = call.args[0];
    } else if (call.name === "bindFramebuffer") {
      state.framebuffer = call.args[1];
    }
  }
  return state;
}

/** The state a frame that borrowed nothing (or gave it all back) leaves. */
const RESTING_GL_STATE: Record<string, unknown> = {
  blend: false,
  depthTest: true,
  depthWrite: true,
  colorWrite: true,
  blendFunc: [GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA],
  texture: null,
  vertexArray: null,
  framebuffer: null,
};

/** §57 state that makes a draw borrow every mirrored toggle at once. */
const BORROWS_EVERYTHING: Partial<TestMaterial> = {
  transparent: true,
  blendMode: "additive",
  depthTest: false,
  depthWrite: false,
  colorWrite: false,
};

/**
 * A renderable whose material cannot be read: the application code that raises
 * mid-draw, placed where the unlit pipeline has already applied the state and
 * bound whatever the material asked for (`program.setColor` reads `color`).
 */
function throwingRenderable(
  state: Partial<TestMaterial> = {},
  map?: ItemTexture,
): Renderable {
  const material = new TestMaterial();
  Object.assign(material, state);
  if (map !== undefined) {
    material.map = map;
  }
  Object.defineProperty(material, "color", {
    get(): never {
      throw new Error("the application's material accessor raised");
    },
  });
  return new Renderable(triangleGeometry().asGeometry, material.asMaterial);
}

/** Names of the calls recorded after `mark`. */
function callsSince(gl: FakeGl, mark: number): string[] {
  return gl.calls.slice(mark).map((call) => call.name);
}

describe("WebglRenderer.render — a throw costs one frame (F13)", () => {
  it("gives back every piece of state the frame borrowed", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    // Both transparent, so §66's sort key 2 keeps them in `renderOrder` —
    // and both declaring the same state, so the second draw changes nothing
    // before it raises and the frame dies holding all of it.
    const borrower = stateful(BORROWS_EVERYTHING);
    borrower.renderOrder = 0;
    const thrower = throwingRenderable(
      BORROWS_EVERYTHING,
      new TestTexture().asTexture,
    );
    thrower.renderOrder = 1;
    root.add(borrower, thrower);
    gl.reset();

    expect(() => {
      renderer.render(root, [createView(camera)]);
    }).toThrow(/material accessor raised/);

    // It really did borrow: the additive function, the two masks, the depth
    // test, and a texture on unit 0 were all issued before the throw.
    const names = gl.names();
    expect(names).toContain("blendFunc");
    expect(names).toContain("colorMask");
    expect(names).toContain("activeTexture");
    // And gave every one of them back on the way out.
    expect(effectiveGlState(gl)).toEqual(RESTING_GL_STATE);
  });

  it("leaves the next frame drawing exactly as it would have", async () => {
    const { renderer, gl, camera } = await initialized();
    const broken = createRoot();
    const borrower = stateful(BORROWS_EVERYTHING);
    borrower.renderOrder = 0;
    const thrower = throwingRenderable(BORROWS_EVERYTHING);
    thrower.renderOrder = 1;
    broken.add(borrower, thrower);
    const healthy = createRoot();
    healthy.add(renderable(triangleGeometry()));
    gl.reset();

    expect(() => {
      renderer.render(broken, [createView(camera)]);
    }).toThrow(/material accessor raised/);
    const mark = gl.calls.length;
    renderer.render(healthy, [createView(camera)]);

    // §57's defaults still cost nothing — the compatibility guarantee the
    // mirror exists for, unbroken by the frame that died holding the state.
    const after = callsSince(gl, mark);
    expect(after).not.toContain("enable");
    expect(after).not.toContain("disable");
    expect(after).not.toContain("depthMask");
    expect(after).not.toContain("colorMask");
    expect(after).not.toContain("blendFunc");
    expect(after.filter((name) => name === "drawArrays")).toHaveLength(1);
    // The claim that makes the previous four assertions safe rather than
    // merely quiet: issuing nothing is correct because the context is already
    // in the state the mirror says it is. With the state abandoned, this frame
    // would have drawn an opaque triangle additively, with both masks off.
    expect(effectiveGlState(gl)).toEqual(RESTING_GL_STATE);
  });

  it("keeps the program-lifetime feature mirrors in step (R-19)", async () => {
    const { renderer, gl, camera } = await initialized();
    const broken = createRoot();
    // The throwing draw switches `useMap` and `useVertexColors` on and dies
    // before the frame can switch them off. Those mirrors live on the program
    // object, not on the frame — the uniforms they track live there too — so
    // they are still accurate, and the next frame turns both off.
    const thrower = throwingRenderable(
      { vertexColors: true },
      new TestTexture().asTexture,
    );
    broken.add(thrower);
    const healthy = createRoot();
    healthy.add(renderable(triangleGeometry()));
    gl.reset();

    expect(() => {
      renderer.render(broken, [createView(camera)]);
    }).toThrow(/material accessor raised/);
    const uniforms = unlitUniforms(gl);
    const mark = gl.calls.length;
    renderer.render(healthy, [createView(camera)]);

    const switchedOff = gl.calls
      .slice(mark)
      .filter((call) => call.name === "uniform1i")
      .map((call) => [call.args[0], call.args[1]]);
    expect(switchedOff).toEqual([
      [uniforms.get("useMap"), 0],
      [uniforms.get("useVertexColors"), 0],
    ]);
    expect(effectiveGlState(gl)).toEqual(RESTING_GL_STATE);
  });

  it("mirrors one context per renderer, not one per module", async () => {
    // Two renderers, two contexts (§61 allows several over one application).
    // The mirror moved onto the instance with F13; before that both of these
    // drove one module-level object, and only `render`'s reset-on-entry kept
    // the second renderer from inheriting the first's idea of the GL state.
    const first = await initialized();
    const second = await initialized();
    const blended = createRoot();
    blended.add(stateful(BORROWS_EVERYTHING));
    const plain = createRoot();
    plain.add(renderable(triangleGeometry()));
    first.gl.reset();
    second.gl.reset();

    first.renderer.render(blended, [createView(first.camera)]);
    second.renderer.render(plain, [createView(second.camera)]);
    first.renderer.render(blended, [createView(first.camera)]);

    // The second renderer's frame declares §57's defaults and pays nothing for
    // them, whatever the first renderer's frames borrowed from *its* context.
    expect(second.gl.countOf("enable")).toBe(0);
    expect(second.gl.countOf("disable")).toBe(0);
    expect(second.gl.countOf("blendFunc")).toBe(0);
    expect(effectiveGlState(first.gl)).toEqual(RESTING_GL_STATE);
    expect(effectiveGlState(second.gl)).toEqual(RESTING_GL_STATE);
  });
});

// ---------------------------------------------------------------------------
// Render targets (§61, §48, §63; R-4, 2026-08-07).
//
// Two halves, deliberately separate. `RenderTargetCache` owns allocation,
// eviction, and the failure paths a driver will not perform on request; the
// renderer owns binding, viewport resolution, exception safety, and the one
// property everything else rests on — that a frame with **no** target issues no
// framebuffer call at all, so the on-screen GL sequence is byte-for-byte what
// it was before render targets existed.
// ---------------------------------------------------------------------------

/** The handle attached as `COLOR_ATTACHMENT0` by the nth allocation. */
function attachedColorTexture(gl: FakeGl, index = 0): unknown {
  const call = gl.callsOf("framebufferTexture2D")[index];
  if (call === undefined) {
    throw new Error("no framebuffer colour attachment was recorded");
  }
  return call.args[3];
}

describe("RenderTargetCache — allocation (§61, §48)", () => {
  it("allocates a colour texture, a depth renderbuffer, and a complete framebuffer", () => {
    const gl = createFakeGl();
    const cache = new RenderTargetCache(gl);
    const target = new RenderTarget({ width: 64, height: 32 });

    const record = cache.acquire(target);

    expect(record).not.toBeNull();
    expect(cache.size).toBe(1);
    expect(gl.names()).toEqual([
      // The colour attachment, allocated exactly as `TextureCache` allocates a
      // texture with no CPU-side data: zero-filled storage, so sampling a
      // target that was never rendered into reads transparent black.
      "createTexture",
      "bindTexture",
      "texImage2D",
      "texParameteri",
      "texParameteri",
      "texParameteri",
      "texParameteri",
      "bindTexture",
      // The depth buffer (§61's per-view depth clear needs somewhere to land).
      "createRenderbuffer",
      "bindRenderbuffer",
      "renderbufferStorage",
      "bindRenderbuffer",
      // The framebuffer that binds the two together, checked and unbound.
      "createFramebuffer",
      "bindFramebuffer",
      "framebufferTexture2D",
      "framebufferRenderbuffer",
      "checkFramebufferStatus",
      "bindFramebuffer",
    ]);
  });

  it("allocates the colour attachment as RGBA8 at the target's size, with no pixels", () => {
    const gl = createFakeGl();
    new RenderTargetCache(gl).acquire(
      new RenderTarget({ width: 8, height: 4 }),
    );

    expect(gl.callsOf("texImage2D")[0]?.args).toEqual([
      GL.TEXTURE_2D,
      0,
      GL.RGBA8,
      8,
      4,
      0,
      GL.RGBA,
      GL.UNSIGNED_BYTE,
      null,
    ]);
  });

  it("gives the colour attachment the same fixed sampler state every texture gets", () => {
    const gl = createFakeGl();
    new RenderTargetCache(gl).acquire(
      new RenderTarget({ width: 2, height: 2 }),
    );

    expect(gl.callsOf("texParameteri").map((call) => call.args)).toEqual([
      [GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.LINEAR],
      [GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.LINEAR],
      [GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE],
      [GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE],
    ]);
  });

  it("sizes the depth renderbuffer to match and attaches it", () => {
    const gl = createFakeGl();
    new RenderTargetCache(gl).acquire(
      new RenderTarget({ width: 16, height: 9 }),
    );

    expect(gl.callsOf("renderbufferStorage")[0]?.args).toEqual([
      GL.RENDERBUFFER,
      GL.DEPTH_COMPONENT16,
      16,
      9,
    ]);
    const attach = gl.callsOf("framebufferRenderbuffer")[0];
    expect(attach?.args[0]).toBe(GL.FRAMEBUFFER);
    expect(attach?.args[1]).toBe(GL.DEPTH_ATTACHMENT);
    expect(attach?.args[2]).toBe(GL.RENDERBUFFER);
  });

  it("skips the depth buffer entirely for a target built with depth: false", () => {
    const gl = createFakeGl();
    const cache = new RenderTargetCache(gl);

    const record = cache.acquire(
      new RenderTarget({ width: 4, height: 4, depth: false }),
    );

    expect(record?.depthBuffer).toBeNull();
    expect(gl.countOf("createRenderbuffer")).toBe(0);
    expect(gl.countOf("framebufferRenderbuffer")).toBe(0);
  });

  it("leaves nothing bound — not the texture, not the renderbuffer, not the framebuffer", () => {
    const gl = createFakeGl();
    new RenderTargetCache(gl).acquire(
      new RenderTarget({ width: 2, height: 2 }),
    );

    const last = (name: string): unknown =>
      gl.callsOf(name).at(-1)?.args.at(-1);
    expect(last("bindTexture")).toBeNull();
    expect(last("bindRenderbuffer")).toBeNull();
    expect(last("bindFramebuffer")).toBeNull();
  });

  it("reports the size it allocated at, which is what the viewport resolves against", () => {
    const gl = createFakeGl();
    const record = new RenderTargetCache(gl).acquire(
      new RenderTarget({ width: 128, height: 64 }),
    );

    expect(record?.width).toBe(128);
    expect(record?.height).toBe(64);
    expect(record?.version).toBe(0);
  });
});

describe("RenderTargetCache — eviction (§83, §61)", () => {
  it("returns the same record for an unchanged target without touching GL", () => {
    const gl = createFakeGl();
    const cache = new RenderTargetCache(gl);
    const target = new RenderTarget({ width: 4, height: 4 });
    const first = cache.acquire(target);
    gl.reset();

    const second = cache.acquire(target);

    expect(second).toBe(first);
    expect(gl.calls).toHaveLength(0);
  });

  it("re-allocates at the new size after a resize, deleting all three objects", () => {
    const gl = createFakeGl();
    const cache = new RenderTargetCache(gl);
    const target = new RenderTarget({ width: 4, height: 4 });
    const first = cache.acquire(target);
    target.resize(32, 16);
    gl.reset();

    const second = cache.acquire(target);

    expect(second).not.toBe(first);
    expect(second?.width).toBe(32);
    expect(second?.version).toBe(1);
    expect(gl.countOf("deleteFramebuffer")).toBe(1);
    expect(gl.countOf("deleteTexture")).toBe(1);
    expect(gl.countOf("deleteRenderbuffer")).toBe(1);
    expect(gl.callsOf("renderbufferStorage")[0]?.args).toEqual([
      GL.RENDERBUFFER,
      GL.DEPTH_COMPONENT16,
      32,
      16,
    ]);
    expect(cache.size).toBe(1);
  });

  it("deletes and forgets a disposed target, and never draws into it again", () => {
    const gl = createFakeGl();
    const cache = new RenderTargetCache(gl);
    const target = new RenderTarget({ width: 4, height: 4 });
    cache.acquire(target);
    target.dispose();
    gl.reset();

    expect(cache.acquire(target)).toBeNull();

    expect(gl.countOf("deleteFramebuffer")).toBe(1);
    expect(cache.size).toBe(0);
    // And a second attempt neither re-allocates nor deletes again.
    gl.reset();
    expect(cache.acquire(target)).toBeNull();
    expect(gl.calls).toHaveLength(0);
  });

  it("refuses a target that was disposed before it was ever allocated", () => {
    const gl = createFakeGl();
    const target = new RenderTarget({ width: 4, height: 4 });
    target.dispose();

    expect(new RenderTargetCache(gl).acquire(target)).toBeNull();
    expect(gl.calls).toHaveLength(0);
  });

  it("forget() drops every record without touching the lost context (§61)", () => {
    const gl = createFakeGl();
    const cache = new RenderTargetCache(gl);
    cache.acquire(new RenderTarget({ width: 4, height: 4 }));
    gl.reset();

    cache.forget();

    expect(cache.size).toBe(0);
    expect(gl.calls).toHaveLength(0);
  });

  it("dispose() deletes everything it created and is idempotent (§83)", () => {
    const gl = createFakeGl();
    const cache = new RenderTargetCache(gl);
    cache.acquire(new RenderTarget({ width: 4, height: 4 }));
    cache.acquire(new RenderTarget({ width: 8, height: 8, depth: false }));
    gl.reset();

    cache.dispose();
    cache.dispose();

    expect(cache.disposed).toBe(true);
    expect(cache.size).toBe(0);
    expect(gl.countOf("deleteFramebuffer")).toBe(2);
    expect(gl.countOf("deleteTexture")).toBe(2);
    // Only the depth-carrying target had a renderbuffer to delete.
    expect(gl.countOf("deleteRenderbuffer")).toBe(1);
  });
});

describe("RenderTargetCache — failure paths never throw (§61, §85)", () => {
  it("returns null when GL will not allocate the colour texture", () => {
    const gl = createFakeGl({ allocateTextures: false });
    const cache = new RenderTargetCache(gl);

    expect(cache.acquire(new RenderTarget({ width: 4, height: 4 }))).toBeNull();
    expect(cache.size).toBe(0);
    expect(gl.countOf("createFramebuffer")).toBe(0);
  });

  it("returns null and frees the texture when the renderbuffer will not allocate", () => {
    const gl = createFakeGl({ allocateRenderbuffers: false });
    const cache = new RenderTargetCache(gl);

    expect(cache.acquire(new RenderTarget({ width: 4, height: 4 }))).toBeNull();
    expect(gl.countOf("deleteTexture")).toBe(1);
    expect(gl.countOf("createFramebuffer")).toBe(0);
    expect(cache.size).toBe(0);
  });

  it("returns null and frees both attachments when the framebuffer will not allocate", () => {
    const gl = createFakeGl({ allocateFramebuffers: false });
    const cache = new RenderTargetCache(gl);

    expect(cache.acquire(new RenderTarget({ width: 4, height: 4 }))).toBeNull();
    expect(gl.countOf("deleteTexture")).toBe(1);
    expect(gl.countOf("deleteRenderbuffer")).toBe(1);
    expect(cache.size).toBe(0);
  });

  it("frees a depth-less target's texture when the framebuffer will not allocate", () => {
    const gl = createFakeGl({ allocateFramebuffers: false });
    const cache = new RenderTargetCache(gl);

    expect(
      cache.acquire(new RenderTarget({ width: 4, height: 4, depth: false })),
    ).toBeNull();
    expect(gl.countOf("deleteTexture")).toBe(1);
    expect(gl.countOf("deleteRenderbuffer")).toBe(0);
  });

  it("refuses an incomplete framebuffer rather than drawing into it", () => {
    // `GL_FRAMEBUFFER_INCOMPLETE_ATTACHMENT`. An incomplete framebuffer turns
    // every subsequent draw into a GL_INVALID_FRAMEBUFFER_OPERATION nobody
    // reads, which is why this is a refusal and not a warning.
    const gl = createFakeGl({ framebufferStatus: 0x8cd6 });
    const cache = new RenderTargetCache(gl);

    expect(cache.acquire(new RenderTarget({ width: 4, height: 4 }))).toBeNull();
    expect(gl.countOf("deleteFramebuffer")).toBe(1);
    expect(gl.countOf("deleteTexture")).toBe(1);
    expect(gl.countOf("deleteRenderbuffer")).toBe(1);
    // Unbound before the refusal — the default drawing buffer is where the
    // next frame has to find itself.
    expect(gl.callsOf("bindFramebuffer").at(-1)?.args[1]).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("frees a depth-less target's objects when its framebuffer is incomplete", () => {
    const gl = createFakeGl({ framebufferStatus: 0x8cd6 });
    const cache = new RenderTargetCache(gl);

    expect(
      cache.acquire(new RenderTarget({ width: 4, height: 4, depth: false })),
    ).toBeNull();
    expect(gl.countOf("deleteFramebuffer")).toBe(1);
    expect(gl.countOf("deleteTexture")).toBe(1);
    expect(gl.countOf("deleteRenderbuffer")).toBe(0);
  });
});

describe("WebglRenderer.render — the no-target path is unchanged (R-4)", () => {
  it("issues no framebuffer call at all for an on-screen frame", async () => {
    // The load-bearing regression guard. Every pixel golden and every browser
    // test rests on this: a scene that never renders to texture must produce
    // the GL sequence it produced before render targets existed, down to the
    // absence of a single `bindFramebuffer(FRAMEBUFFER, null)`.
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(
      renderable(quadGeometry()),
      sprite(),
      stateful(BORROWS_EVERYTHING),
    );
    gl.reset();

    renderer.render(root, [createView(camera)]);
    renderer.render(root, [createView(camera)], undefined, null);

    expect(gl.countOf("bindFramebuffer")).toBe(0);
    expect(gl.countOf("createFramebuffer")).toBe(0);
    expect(gl.countOf("checkFramebufferStatus")).toBe(0);
  });

  it("resolves normalized rectangles against the drawing buffer, as before", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.resize(200, 100, 2);
    gl.reset();

    renderer.render(createRoot(), [createView(camera)]);

    expect(gl.callsOf("viewport")[0]?.args).toEqual([0, 0, 400, 200]);
  });
});

describe("WebglRenderer.render — into a target (§61, §48, R-4)", () => {
  it("binds the target's framebuffer before the first clear and unbinds after", async () => {
    const { renderer, gl, camera } = await initialized();
    const target = new RenderTarget({ width: 64, height: 64 });
    gl.reset();

    renderer.render(createRoot(), [createView(camera)], undefined, target);

    const names = gl.names();
    const framebuffer = gl.callsOf("bindFramebuffer").at(-2)?.args[1];
    expect(framebuffer).not.toBeNull();
    // Bound before the rectangles and the clear, unbound at the very end.
    expect(names.indexOf("bindFramebuffer")).toBeLessThan(
      names.indexOf("scissor"),
    );
    expect(names.at(-1)).toBe("bindFramebuffer");
    expect(gl.callsOf("bindFramebuffer").at(-1)?.args).toEqual([
      GL.FRAMEBUFFER,
      null,
    ]);
    expect(effectiveGlState(gl)).toEqual(RESTING_GL_STATE);
  });

  it("allocates once and re-binds the same framebuffer on later frames", async () => {
    const { renderer, gl, camera } = await initialized();
    const target = new RenderTarget({ width: 32, height: 32 });

    renderer.render(createRoot(), [createView(camera)], undefined, target);
    const framebuffer = gl.callsOf("bindFramebuffer")[0]?.args[1];
    gl.reset();
    renderer.render(createRoot(), [createView(camera)], undefined, target);

    expect(gl.countOf("createFramebuffer")).toBe(0);
    expect(gl.callsOf("bindFramebuffer")[0]?.args).toEqual([
      GL.FRAMEBUFFER,
      framebuffer,
    ]);
  });

  it("resolves normalized rectangles against the target, not the drawing buffer", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.resize(800, 600, 2);
    const target = new RenderTarget({ width: 256, height: 128 });
    gl.reset();

    renderer.render(createRoot(), [createView(camera)], undefined, target);

    expect(gl.callsOf("viewport")[0]?.args).toEqual([0, 0, 256, 128]);
    expect(gl.callsOf("scissor")[0]?.args).toEqual([0, 0, 256, 128]);
  });

  it("takes an unnormalized rectangle as target pixels, unscaled by the resolution", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.resize(800, 600, 3);
    const target = new RenderTarget({ width: 256, height: 256 });
    gl.reset();

    renderer.render(
      createRoot(),
      [
        createView(camera, {
          x: 8,
          y: 16,
          width: 64,
          height: 32,
          normalized: false,
        }),
      ],
      undefined,
      target,
    );

    expect(gl.callsOf("viewport")[0]?.args).toEqual([8, 16, 64, 32]);
  });

  it("draws the same scene the same way, target or not", async () => {
    const { renderer, gl, camera } = await initialized();
    const target = new RenderTarget({ width: 300, height: 150 });
    const root = createRoot();
    root.add(renderable(quadGeometry()));
    // Warm both caches, so neither pass below pays an upload the other does
    // not: what is under test is the *draw* sequence, not the allocation one.
    renderer.render(root, [createView(camera)]);
    renderer.render(root, [createView(camera)], undefined, target);

    gl.reset();
    renderer.render(root, [createView(camera)], undefined, target);
    const offscreen = gl
      .names()
      .filter(
        (name) =>
          name !== "bindFramebuffer" &&
          name !== "createFramebuffer" &&
          name !== "createRenderbuffer" &&
          name !== "bindRenderbuffer" &&
          name !== "renderbufferStorage" &&
          name !== "framebufferTexture2D" &&
          name !== "framebufferRenderbuffer" &&
          name !== "checkFramebufferStatus",
      );
    gl.reset();
    // The drawing buffer is 300×150 (the fake canvas's size), so the same
    // normalized view covers the same pixel rectangle in both passes.
    renderer.render(root, [createView(camera)]);

    expect(offscreen).toEqual(gl.names());
  });

  it("re-allocates and draws into the new framebuffer after a resize", async () => {
    const { renderer, gl, camera } = await initialized();
    const target = new RenderTarget({ width: 32, height: 32 });
    renderer.render(createRoot(), [createView(camera)], undefined, target);
    target.resize(64, 16);
    gl.reset();

    renderer.render(createRoot(), [createView(camera)], undefined, target);

    expect(gl.countOf("createFramebuffer")).toBe(1);
    expect(gl.countOf("deleteFramebuffer")).toBe(1);
    expect(gl.callsOf("viewport")[0]?.args).toEqual([0, 0, 64, 16]);
  });

  it("skips the whole pass for a disposed target — no bind, no clear, no draw", async () => {
    const { renderer, gl, camera } = await initialized();
    const target = new RenderTarget({ width: 32, height: 32 });
    target.dispose();
    const root = createRoot();
    root.add(renderable(quadGeometry()));
    gl.reset();

    renderer.render(root, [createView(camera)], undefined, target);

    expect(gl.calls).toHaveLength(0);
  });

  it("skips the pass when the framebuffer comes back incomplete", async () => {
    const { renderer, gl, camera } = await initialized({
      framebufferStatus: 0x8cd6,
    });
    const root = createRoot();
    root.add(renderable(quadGeometry()));
    gl.reset();

    renderer.render(
      root,
      [createView(camera)],
      undefined,
      new RenderTarget({ width: 32, height: 32 }),
    );

    // The allocation was attempted and cleaned up; nothing was drawn.
    expect(gl.countOf("clear")).toBe(0);
    expect(gl.countOf("drawElements")).toBe(0);
    expect(gl.callsOf("bindFramebuffer").at(-1)?.args[1]).toBeNull();
  });

  it("unbinds the framebuffer when a draw throws mid-pass (F13 + R-4)", async () => {
    const { renderer, gl, camera } = await initialized();
    const target = new RenderTarget({ width: 32, height: 32 });
    const root = createRoot();
    root.add(throwingRenderable(BORROWS_EVERYTHING));
    gl.reset();

    expect(() => {
      renderer.render(root, [createView(camera)], undefined, target);
    }).toThrow(/material accessor raised/);

    // The framebuffer really was bound, and really was given back — along with
    // every other piece of state the frame borrowed.
    expect(
      gl.callsOf("bindFramebuffer").some((call) => call.args[1] !== null),
    ).toBe(true);
    expect(effectiveGlState(gl)).toEqual(RESTING_GL_STATE);
  });

  it("draws into a target with interpolated §43 poses like any other frame", async () => {
    const { renderer, gl, camera } = await initialized();
    const target = new RenderTarget({ width: 32, height: 32 });
    const root = createRoot();
    const moved = renderable(triangleGeometry());
    root.add(moved);
    const poses = new TestPoseBuffer().track(
      moved,
      new Vector3(0, 0, 0),
      new Vector3(4, 0, 0),
    );
    gl.reset();

    renderer.render(
      root,
      [createView(camera)],
      interpolationAt(poses, 0.5),
      target,
    );

    expect(poses.alphas).toContain(0.5);
    expect(modelUploads(gl).at(-1)?.[12]).toBe(2);
  });
});

describe("WebglRenderer — render to texture (R-4, the R-5/R-6 unblock)", () => {
  it("binds the target's colour attachment when a material samples it", async () => {
    const { renderer, gl, camera } = await initialized();
    const target = new RenderTarget({ width: 32, height: 32 });
    // Pass 1: fill the target.
    renderer.render(createRoot(), [createView(camera)], undefined, target);
    const colorTexture = attachedColorTexture(gl);

    // Pass 2: sample it on screen, through the ordinary §57 `map` field.
    const material = new TestMaterial();
    material.map = target.colorTexture;
    const root = createRoot();
    root.add(renderable(triangleGeometry(), material));
    gl.reset();
    renderer.render(root, [createView(camera)]);

    expect(gl.callsOf("bindTexture")[0]?.args).toEqual([
      GL.TEXTURE_2D,
      colorTexture,
    ]);
    // Nothing was uploaded: a render-target texture has no CPU-side texels, so
    // it must never reach `TextureCache`.
    expect(gl.countOf("texImage2D")).toBe(0);
    expect(gl.countOf("createTexture")).toBe(0);
  });

  it("allocates the framebuffer on first *sample*, so an unrendered target reads as transparent black", async () => {
    const { renderer, gl, camera } = await initialized();
    const target = new RenderTarget({ width: 8, height: 8 });
    const material = new TestMaterial();
    material.map = target.colorTexture;
    const root = createRoot();
    root.add(renderable(triangleGeometry(), material));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // Allocated here rather than skipped: `texImage2D(…, null)` is zero-filled
    // storage, which samples as transparent black — a defined result.
    expect(gl.countOf("createFramebuffer")).toBe(1);
    expect(gl.callsOf("texImage2D")[0]?.args.at(-1)).toBeNull();
    expect(gl.callsOf("bindTexture").at(-2)?.args[1]).toBe(
      attachedColorTexture(gl),
    );
  });

  it("switches the map sampler on for a render-target texture like any other", async () => {
    const { renderer, gl, camera } = await initialized();
    const target = new RenderTarget({ width: 8, height: 8 });
    const material = new TestMaterial();
    material.map = target.colorTexture;
    const root = createRoot();
    root.add(renderable(triangleGeometry(), material));
    const uniforms = gl.uniformLocations;
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("activeTexture")).toBe(1);
    const useMap = gl
      .callsOf("uniform1i")
      .filter((call) => call.args[0] === uniforms.get("useMap"));
    expect(useMap.at(-1)?.args[1]).toBe(1);
  });

  it("samples a target through a sprite material too (§55)", async () => {
    const { renderer, gl, camera } = await initialized();
    const target = new RenderTarget({ width: 8, height: 8 });
    renderer.render(createRoot(), [createView(camera)], undefined, target);
    const colorTexture = attachedColorTexture(gl);

    const material = new TestSpriteMaterial();
    material.texture = target.colorTexture;
    const root = createRoot();
    root.add(sprite(material));
    gl.reset();
    renderer.render(root, [createView(camera)]);

    expect(gl.callsOf("bindTexture")[0]?.args).toEqual([
      GL.TEXTURE_2D,
      colorTexture,
    ]);
    // The sprite quad is indexed (see the sprite pipeline's own tests).
    expect(gl.countOf("drawElements")).toBe(1);
  });

  it("skips a draw that samples the target it is drawing into (feedback loop)", async () => {
    const { renderer, gl, camera } = await initialized();
    const target = new RenderTarget({ width: 16, height: 16 });
    const material = new TestMaterial();
    material.map = target.colorTexture;
    const root = createRoot();
    root.add(renderable(triangleGeometry(), material));
    // Allocate the framebuffer up front, so the counts below are the frame's.
    renderer.render(createRoot(), [createView(camera)], undefined, target);
    gl.reset();

    renderer.render(root, [createView(camera)], undefined, target);

    // The geometry still draws — it simply draws untextured, because the one
    // thing that cannot happen is reading and writing one surface at once.
    expect(gl.countOf("drawArrays")).toBe(1);
    expect(gl.countOf("bindTexture")).toBe(0);
    expect(gl.countOf("activeTexture")).toBe(0);
  });

  it("skips a *sprite* that samples the target it is drawing into", async () => {
    const { renderer, gl, camera } = await initialized();
    const target = new RenderTarget({ width: 16, height: 16 });
    const material = new TestSpriteMaterial();
    material.texture = target.colorTexture;
    const root = createRoot();
    root.add(sprite(material));
    gl.reset();

    renderer.render(root, [createView(camera)], undefined, target);

    // A sprite with no texture has nothing to draw at all.
    expect(gl.countOf("drawElements")).toBe(0);
  });

  it("ping-pong between two targets is not a feedback loop", async () => {
    const { renderer, gl, camera } = await initialized();
    const read = new RenderTarget({ width: 16, height: 16 });
    const write = new RenderTarget({ width: 16, height: 16 });
    renderer.render(createRoot(), [createView(camera)], undefined, read);
    const readTexture = attachedColorTexture(gl);
    renderer.render(createRoot(), [createView(camera)], undefined, write);
    const material = new TestMaterial();
    material.map = read.colorTexture;
    const root = createRoot();
    root.add(renderable(triangleGeometry(), material));
    gl.reset();

    renderer.render(root, [createView(camera)], undefined, write);

    expect(gl.callsOf("bindTexture")[0]?.args).toEqual([
      GL.TEXTURE_2D,
      readTexture,
    ]);
    expect(gl.countOf("drawArrays")).toBe(1);
  });

  it("skips a draw whose target was disposed under it", async () => {
    const { renderer, gl, camera } = await initialized();
    const target = new RenderTarget({ width: 8, height: 8 });
    renderer.render(createRoot(), [createView(camera)], undefined, target);
    const material = new TestSpriteMaterial();
    material.texture = target.colorTexture;
    const root = createRoot();
    root.add(sprite(material));
    target.dispose();
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // §83's "disposed resource still in use": deleted, then skipped.
    expect(gl.countOf("deleteFramebuffer")).toBe(1);
    expect(gl.countOf("drawArrays")).toBe(0);
  });
});

describe("WebglRenderer — render targets across a context loss (§61)", () => {
  it("forgets framebuffers without deleting them, and re-allocates on restore", async () => {
    const { renderer, gl, canvas, camera } = await initialized();
    const target = new RenderTarget({ width: 32, height: 32 });
    renderer.render(createRoot(), [createView(camera)], undefined, target);
    gl.reset();

    canvas.dispatch("webglcontextlost");

    // The handles died with the context; deleting them would be a GL call
    // against a lost context for no benefit.
    expect(gl.countOf("deleteFramebuffer")).toBe(0);

    canvas.dispatch("webglcontextrestored");
    gl.reset();
    renderer.render(createRoot(), [createView(camera)], undefined, target);

    // §61's "re-creates engine-owned GPU resources … render targets", done by
    // the pass that asks for one rather than eagerly.
    expect(gl.countOf("createFramebuffer")).toBe(1);
    expect(gl.countOf("deleteFramebuffer")).toBe(0);
  });

  it("skips an off-screen frame while the context is lost", async () => {
    const { renderer, gl, canvas, camera } = await initialized();
    const target = new RenderTarget({ width: 32, height: 32 });
    canvas.dispatch("webglcontextlost");
    gl.reset();

    expect(() => {
      renderer.render(createRoot(), [createView(camera)], undefined, target);
    }).not.toThrow();
    expect(gl.calls).toHaveLength(0);
  });

  it("deletes every framebuffer it allocated when the renderer is disposed (§83)", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.render(
      createRoot(),
      [createView(camera)],
      undefined,
      new RenderTarget({ width: 8, height: 8 }),
    );
    gl.reset();

    renderer.dispose();

    expect(gl.countOf("deleteFramebuffer")).toBe(1);
    expect(gl.countOf("deleteRenderbuffer")).toBe(1);
  });
});

describe("WebglRenderer.initialize — the framebuffer entry points are required (§62)", () => {
  it("rejects a context that cannot allocate a framebuffer", async () => {
    const gl = createFakeGl() as unknown as Record<string, unknown>;
    delete gl.createFramebuffer;
    const renderer = new WebglRenderer();

    const error = await rejection(
      renderer.initialize({ canvas: new TestCanvas(gl) }),
    );

    expect(error.code).toBe("RENDERER_INITIALIZATION_FAILED");
  });
});

describe("WebglRenderer.render — §84 statistics (A-1)", () => {
  it("counts nothing at all until a record is assigned", async () => {
    const { renderer, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(quadGeometry()), renderable(triangleGeometry()));

    renderer.render(root, [createView(camera)]);

    expect(renderer.statistics).toBeNull();
  });

  it("counts one draw call per submitted draw, with its triangles", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    // Two indexed triangles plus one unindexed one: 6 indices + 3 vertices.
    root.add(renderable(quadGeometry()), renderable(triangleGeometry()));
    const statistics = createRenderStatistics();
    renderer.statistics = statistics;

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("drawElements") + gl.countOf("drawArrays")).toBe(2);
    expect(statistics).toEqual({ drawCalls: 2, triangles: 3, instances: 2 });
  });

  it("counts an instanced particle draw once, with all of its instances", async () => {
    const { renderer, gl, camera } = await initialized();
    const particles = new TestParticles(1000, 250);
    const statistics = createRenderStatistics();
    renderer.statistics = statistics;

    renderer.render(particles.asNode, [createView(camera)]);

    expect(gl.countOf("drawArraysInstanced")).toBe(1);
    // One call; 250 instances of the shared six-vertex quad = 500 triangles.
    expect(statistics).toEqual({
      drawCalls: 1,
      triangles: 500,
      instances: 250,
    });
  });

  it("counts a lines geometry's draw but none of its vertices as triangles", async () => {
    const { renderer, camera } = await initialized();
    const lines = new TestGeometry(
      new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
      undefined,
      "lines",
    );
    const statistics = createRenderStatistics();
    renderer.statistics = statistics;

    renderer.render(renderable(lines), [createView(camera)]);

    expect(statistics).toEqual({ drawCalls: 1, triangles: 0, instances: 1 });
  });

  it("counts a draw per view, because each view submits its own", async () => {
    const { renderer, camera } = await initialized();
    const statistics = createRenderStatistics();
    renderer.statistics = statistics;

    renderer.render(renderable(triangleGeometry()), [
      createView(camera),
      createView(camera, { id: "inset", x: 0.5, width: 0.5 }),
    ]);

    expect(statistics.drawCalls).toBe(2);
    expect(statistics.triangles).toBe(2);
  });

  it("accumulates across the render calls of one frame and never clears", async () => {
    const { renderer, camera } = await initialized();
    const statistics = createRenderStatistics();
    renderer.statistics = statistics;
    const root = renderable(triangleGeometry());
    const views = [createView(camera)];

    // §84's counters are frame totals, and an off-screen pass plus an on-screen
    // pass is one frame: the backend adds, the owner of the record clears.
    renderer.render(
      root,
      views,
      undefined,
      new RenderTarget({
        width: 16,
        height: 16,
      }),
    );
    renderer.render(root, views);

    expect(statistics).toEqual({ drawCalls: 2, triangles: 2, instances: 2 });
  });

  it("does not count a draw it skipped", async () => {
    const { renderer, gl, camera } = await initialized();
    const statistics = createRenderStatistics();
    renderer.statistics = statistics;
    // A sprite whose texture is disposed is skipped before its draw (§83), and
    // a zero-particle system never reaches one either. Counting the render list
    // instead of the submissions would report both.
    const texture = new TestTexture();
    texture.dispose();
    const root = createRoot();
    root.add(sprite(new TestSpriteMaterial(texture)));
    const empty = new TestParticles(16, 0);

    renderer.render(root, [createView(camera)]);
    renderer.render(empty.asNode, [createView(camera)]);

    expect(gl.countOf("drawArrays")).toBe(0);
    expect(gl.countOf("drawArraysInstanced")).toBe(0);
    expect(statistics).toEqual({ drawCalls: 0, triangles: 0, instances: 0 });
  });

  it("counts nothing for a frame the context loss made this backend skip", async () => {
    const { renderer, canvas, camera } = await initialized();
    const statistics = createRenderStatistics();
    renderer.statistics = statistics;
    canvas.dispatch("webglcontextlost");

    renderer.render(renderable(triangleGeometry()), [createView(camera)]);

    expect(statistics).toEqual({ drawCalls: 0, triangles: 0, instances: 0 });
  });

  it("stops counting the moment the record is cleared", async () => {
    const { renderer, camera } = await initialized();
    const statistics = createRenderStatistics();
    renderer.statistics = statistics;
    const root = renderable(triangleGeometry());
    const views = [createView(camera)];

    renderer.render(root, views);
    renderer.statistics = null;
    renderer.render(root, views);

    expect(statistics.drawCalls).toBe(1);
  });

  it("counts the draws of a frame that throws, up to the throw (F13)", async () => {
    const { renderer, camera } = await initialized();
    const statistics = createRenderStatistics();
    renderer.statistics = statistics;
    const root = createRoot();
    const drawn = renderable(triangleGeometry());
    drawn.renderOrder = 0;
    const thrower = throwingRenderable();
    thrower.renderOrder = 1;
    root.add(drawn, thrower);

    expect(() => {
      renderer.render(root, [createView(camera)]);
    }).toThrow(/material accessor raised/);

    // The first draw really did reach the GPU; the second never did. A
    // statistics record that unwound with the frame would under-report work the
    // driver has already been given.
    expect(statistics.drawCalls).toBe(1);
  });
});

describe("WebglRenderer.render — statistics change no GL call (A-1)", () => {
  /**
   * The load-bearing regression guard for A-1, and the sibling of R-4's
   * "no framebuffer call at all" test.
   *
   * §84's counters are a diagnostic; a diagnostic that changes the thing it
   * measures is not one. Every pixel golden and every browser test rests on the
   * frame with statistics *on* issuing the byte-identical GL call list — same
   * names, same arguments, same order — as the frame with them off.
   */
  async function sequenceOf(statistics: RenderStatistics | null): Promise<{
    names: string[];
    calls: string;
  }> {
    const { renderer, gl, camera } = await initialized();
    renderer.statistics = statistics;
    // All four pipelines in one frame, so the comparison covers every draw
    // site: indexed and unindexed unlit, a blended material, a sprite, and the
    // instanced particle path.
    const root = new TestGroup();
    root.add(new TestParticles(64, 12));
    root.addRenderables(
      renderable(quadGeometry()),
      stateful({ transparent: true }, [1, 0, 0, 0.5]),
      sprite(),
    );
    gl.reset();
    renderer.render(root.asNode, [createView(camera)]);
    return {
      names: gl.names(),
      calls: JSON.stringify(gl.calls),
    };
  }

  it("issues the identical call sequence with and without a record", async () => {
    const without = await sequenceOf(null);
    const statistics = createRenderStatistics();
    const with_ = await sequenceOf(statistics);

    expect(with_.names).toEqual(without.names);
    expect(with_.calls).toBe(without.calls);
    // …and the frame that was measured really did draw something, so the
    // comparison above is not two empty lists agreeing.
    expect(without.names).toContain("drawElements");
    expect(statistics.drawCalls).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// §70 full-screen effects (R-6, 2026-08-07).
//
// Two halves again, for the reason R-4's block gives. `EffectProgram` owns the
// pipeline, its uniform mirrors, and the failure paths a driver will not
// perform on request; `WebglRenderer.renderEffect` owns binding, sizing,
// exception safety, the refusals — and the property the whole packet rests on,
// that **`render` is byte-for-byte the function it was before effects
// existed**: an effect is a separate entry point, so a frame that runs none
// cannot have gained or lost a single GL call.
// ---------------------------------------------------------------------------

/** The effect program's uniform handles — the `spriteUniforms` pattern. */
function effectUniforms(gl: FakeGl): Map<string, object> {
  for (const perProgram of gl.uniformsByProgram.values()) {
    if (perProgram.has("useGrade")) {
      return perProgram;
    }
  }
  throw new Error("the effect program never resolved its uniforms");
}

/** The `useProgram` handle of the effect pipeline. */
function effectProgramHandle(gl: FakeGl): object {
  for (const [program, perProgram] of gl.uniformsByProgram) {
    if (perProgram.has("useGrade")) {
      return program;
    }
  }
  throw new Error("the effect program was never linked");
}

/** An effect pass over `source`, typed off the interface under test. */
type EffectPass = Parameters<NonNullable<Renderer["renderEffect"]>>[0];

function effectPass(
  source: RenderTarget,
  effect: EffectPass["effect"] = { kind: "copy" },
  destination: RenderTarget | null = null,
): EffectPass {
  return {
    kind: "effect",
    source: source.colorTexture,
    effect,
    target: destination,
  };
}

describe("EffectProgram — the §70 pipeline (R-6)", () => {
  it("compiles, links, and resolves exactly its four uniforms", () => {
    const gl = createFakeGl();
    const program = EffectProgram.create(gl);

    expect(program.disposed).toBe(false);
    expect(
      gl.callsOf("getUniformLocation").map((call) => call.args[1]),
      // `useEncode` is R-15's §60a output transform (2026-08-08) — the fourth
      // uniform, and the second switch that starts at GL's own initial `false`.
    ).toEqual(["source", "useGrade", "grade", "useEncode"]);
    // No geometry of any kind: the full-screen triangle is three `gl_VertexID`
    // corners, so this pipeline allocates no buffer and no vertex array.
    expect(gl.countOf("createBuffer")).toBe(0);
    expect(gl.countOf("createVertexArray")).toBe(0);
  });

  it("throws SHADER_COMPILATION_FAILED and cleans up exactly as the unlit program does", () => {
    const gl = createFakeGl({ resolveUniforms: false });

    const error = thrown(() => EffectProgram.create(gl));

    expect(error.code).toBe("SHADER_COMPILATION_FAILED");
    expect(error.message).toMatch(/effect program has no active uniform/);
    expect(gl.countOf("deleteProgram")).toBe(1);
  });

  it("uploads the sampler once in the program's lifetime", () => {
    const gl = createFakeGl();
    const program = EffectProgram.create(gl);
    gl.reset();

    program.use();
    program.setSampler(EFFECT_TEXTURE_UNIT);
    program.use();
    program.setSampler(EFFECT_TEXTURE_UNIT);

    expect(gl.callsOf("uniform1i").map((call) => call.args)).toEqual([
      [effectUniforms(gl).get("source"), EFFECT_TEXTURE_UNIT],
    ]);
  });

  it("issues nothing at all for a chain of copies", () => {
    // The R-19 property, restated for §70: the mirror starts at GL's own
    // initial `0`, so `useGrade` is never uploaded by a program that has only
    // ever copied — and the fragment stage runs its no-arithmetic path, which
    // is what makes a copy the bit-exact blit it is documented to be.
    const gl = createFakeGl();
    const program = EffectProgram.create(gl);
    program.setSampler(EFFECT_TEXTURE_UNIT);
    gl.reset();

    program.setCopy();
    program.setCopy();

    expect(gl.calls).toEqual([]);
  });

  it("uploads the grade once and not again while the numbers hold", () => {
    const gl = createFakeGl();
    const program = EffectProgram.create(gl);
    gl.reset();

    program.setGrade(1.5, 1, 0.5);
    program.setGrade(1.5, 1, 0.5);

    expect(gl.callsOf("uniform1i").map((call) => call.args)).toEqual([
      [effectUniforms(gl).get("useGrade"), 1],
    ]);
    expect(gl.callsOf("uniform3fv").map((call) => call.args)).toEqual([
      [effectUniforms(gl).get("grade"), [1.5, 1, 0.5]],
    ]);
  });

  it("re-uploads only the coefficients when one of them moves", () => {
    const gl = createFakeGl();
    const program = EffectProgram.create(gl);
    program.setGrade(1, 1, 1);
    gl.reset();

    program.setGrade(1, 1, 0.25);

    expect(gl.countOf("uniform1i")).toBe(0);
    expect(gl.callsOf("uniform3fv")[0]?.args).toEqual([
      effectUniforms(gl).get("grade"),
      [1, 1, 0.25],
    ]);
  });

  it("switches back to the copy path with one call", () => {
    const gl = createFakeGl();
    const program = EffectProgram.create(gl);
    program.setGrade(2, 2, 2);
    gl.reset();

    program.setCopy();
    program.setCopy();

    expect(gl.callsOf("uniform1i").map((call) => call.args)).toEqual([
      [effectUniforms(gl).get("useGrade"), 0],
    ]);
  });

  it("uploads §60a's encode switch once and turns it off with one call", () => {
    // R-15, 2026-08-08. The second switch obeys the first one's rule: it starts
    // at GL's initial `false`, so a program that never encodes never uploads
    // it, and a chain that always encodes uploads it once.
    const gl = createFakeGl();
    const program = EffectProgram.create(gl);
    gl.reset();

    program.setOutputTransform();
    program.setOutputTransform();

    expect(gl.callsOf("uniform1i").map((call) => call.args)).toEqual([
      [effectUniforms(gl).get("useEncode"), 1],
    ]);

    gl.reset();
    program.setCopy();

    expect(gl.callsOf("uniform1i").map((call) => call.args)).toEqual([
      [effectUniforms(gl).get("useEncode"), 0],
    ]);
  });

  it("keeps the two switches exclusive when a chain mixes them", () => {
    // A grade and an output transform are different passes: switching from one
    // to the other moves both switches, so a graded frame is never
    // accidentally encoded twice or presented ungraded.
    const gl = createFakeGl();
    const program = EffectProgram.create(gl);
    program.setGrade(2, 1, 1);
    gl.reset();

    program.setOutputTransform();

    expect(gl.callsOf("uniform1i").map((call) => call.args)).toEqual([
      [effectUniforms(gl).get("useGrade"), 0],
      [effectUniforms(gl).get("useEncode"), 1],
    ]);

    gl.reset();
    program.setGrade(2, 1, 1);

    expect(gl.callsOf("uniform1i").map((call) => call.args)).toEqual([
      [effectUniforms(gl).get("useGrade"), 1],
      [effectUniforms(gl).get("useEncode"), 0],
    ]);
    // The coefficients did not move, so the mirror suppresses their upload.
    expect(gl.countOf("uniform3fv")).toBe(0);
  });

  it("deletes its program once, idempotently (§83)", () => {
    const gl = createFakeGl();
    const program = EffectProgram.create(gl);
    gl.reset();

    program.dispose();
    program.dispose();

    expect(program.disposed).toBe(true);
    expect(gl.countOf("deleteProgram")).toBe(1);
  });
});

describe("WebglRenderer.initialize — a partial pipeline failure (R-6)", () => {
  it.each([
    // Three eager programs since 2026-09-11 — unlit, sprite, lit; the
    // particle, effect, shadow and standard pipelines compile behind their
    // seams on first use and have their own fail-once tests.
    ["sprite", 2, 1],
    ["lit", 3, 2],
  ])(
    "disposes the programs already built when the %s one will not allocate",
    async (_name, failProgramAt, alreadyBuilt) => {
      // §61's "leaves the renderer uninitialized rather than
      // half-initialized": each `create` failure has to give back every
      // program before it, or a rejected `initialize` leaks the whole
      // pipeline set for the lifetime of the context.
      const gl = createFakeGl({ failProgramAt });
      const renderer = new WebglRenderer();

      const error = await rejection(
        renderer.initialize({ canvas: new TestCanvas(gl) }),
      );

      expect(error.code).toBe("SHADER_COMPILATION_FAILED");
      expect(gl.countOf("deleteProgram")).toBe(alreadyBuilt);
      expect(renderer.initialized).toBe(false);
    },
  );
});

describe("WebglRenderer.renderEffect — drawing one (§70, R-6)", () => {
  it("draws the full-screen triangle over the drawing buffer, with no geometry", async () => {
    const { renderer, gl } = await initialized();
    renderer.resize(320, 240);
    const source = new RenderTarget({ width: 64, height: 64 });
    // The registered pipeline compiles on the first effect (2026-09-11); a
    // throwaway pass over another target absorbs that — and the program's
    // once-per-lifetime sampler upload with it — so the transcript below is
    // the steady-state pass, while `source` is still seen for the first
    // time, which the cache's allocation calls at its head depend on.
    renderer.renderEffect(effectPass(new RenderTarget({ width: 4, height: 4 })));
    gl.reset();

    renderer.renderEffect(effectPass(source));

    expect(gl.names()).toEqual([
      // The source's framebuffer is allocated on first sight (R-4's cache),
      // because nothing has drawn into it yet.
      "createTexture",
      "bindTexture",
      "texImage2D",
      "texParameteri",
      "texParameteri",
      "texParameteri",
      "texParameteri",
      "bindTexture",
      "createRenderbuffer",
      "bindRenderbuffer",
      "renderbufferStorage",
      "bindRenderbuffer",
      "createFramebuffer",
      "bindFramebuffer",
      "framebufferTexture2D",
      "framebufferRenderbuffer",
      "checkFramebufferStatus",
      "bindFramebuffer",
      // The effect itself. No `bindFramebuffer` at all on this path: the
      // destination is the drawing buffer, exactly as an on-screen `render`
      // issues none (R-4).
      "scissor",
      "viewport",
      "disable",
      "useProgram",
      // No `uniform1i` here: the sampler uploaded once, in the warm-up pass.
      "activeTexture",
      "bindTexture",
      "bindVertexArray",
      "drawArrays",
      // The envelope gives back the depth test and the texture binding.
      "enable",
      "bindTexture",
    ]);
    expect(gl.callsOf("scissor")[0]?.args).toEqual([0, 0, 320, 240]);
    expect(gl.callsOf("viewport")[0]?.args).toEqual([0, 0, 320, 240]);
    expect(gl.callsOf("drawArrays")[0]?.args).toEqual([GL.TRIANGLES, 0, 3]);
    expect(gl.callsOf("bindVertexArray")[0]?.args).toEqual([null]);
    expect(effectiveGlState(gl)).toEqual(RESTING_GL_STATE);
  });

  it("binds the destination framebuffer and sizes to it, then unbinds", async () => {
    const { renderer, gl } = await initialized();
    renderer.resize(800, 600, 2);
    const source = new RenderTarget({ width: 64, height: 64 });
    const destination = new RenderTarget({ width: 128, height: 32 });
    // Warm both allocations so the assertion is about the effect, not the
    // cache's first-sight work.
    renderer.renderEffect(effectPass(source, { kind: "copy" }, destination));
    gl.reset();

    renderer.renderEffect(effectPass(source, { kind: "copy" }, destination));

    const framebuffers = gl.callsOf("bindFramebuffer");
    expect(framebuffers).toHaveLength(2);
    expect(framebuffers[0]?.args[1]).not.toBeNull();
    expect(framebuffers[1]?.args).toEqual([GL.FRAMEBUFFER, null]);
    // The destination's size, not the drawing buffer's — the same rule R-4
    // states for a normalized viewport rectangle.
    expect(gl.callsOf("scissor")[0]?.args).toEqual([0, 0, 128, 32]);
    expect(gl.callsOf("viewport")[0]?.args).toEqual([0, 0, 128, 32]);
    expect(gl.names().at(-1)).toBe("bindFramebuffer");
    expect(effectiveGlState(gl)).toEqual(RESTING_GL_STATE);
  });

  it("binds the source's colour attachment on the map unit", async () => {
    const { renderer, gl } = await initialized();
    const source = new RenderTarget({ width: 8, height: 8 });
    renderer.renderEffect(effectPass(source));
    const attachment = attachedColorTexture(gl);
    gl.reset();

    renderer.renderEffect(effectPass(source));

    expect(gl.callsOf("activeTexture")[0]?.args).toEqual([
      GL.TEXTURE0 + EFFECT_TEXTURE_UNIT,
    ]);
    expect(gl.callsOf("bindTexture")[0]?.args).toEqual([
      GL.TEXTURE_2D,
      attachment,
    ]);
  });

  it("uses the effect pipeline, not one of the scene pipelines", async () => {
    const { renderer, gl } = await initialized();
    const source = new RenderTarget({ width: 8, height: 8 });
    // Compiled on the first effect, not at initialize (2026-09-11).
    renderer.renderEffect(effectPass(source));
    const effect = effectProgramHandle(gl);
    gl.reset();

    renderer.renderEffect(effectPass(source));

    expect(gl.callsOf("useProgram").map((call) => call.args[0])).toEqual([
      effect,
    ]);
  });

  it("uploads a grade's coefficients, defaulting each omitted one to 1", async () => {
    const { renderer, gl } = await initialized();
    const source = new RenderTarget({ width: 8, height: 8 });
    renderer.renderEffect(effectPass(source));
    gl.reset();

    renderer.renderEffect(
      effectPass(source, { kind: "grade", saturation: 0.25 }),
    );

    expect(uploadsAt(gl, effectUniforms(gl).get("grade"))).toEqual([
      [1, 1, 0.25],
    ]);
    expect(uploadsAt(gl, effectUniforms(gl).get("useGrade"))).toEqual([1]);
  });

  it("selects §60a's encode for an output-transform pass, and only it", async () => {
    // R-15, 2026-08-08: the transform is one pass over the composited frame,
    // so what reaches GL is the encode switch — no grade, no second draw.
    const { renderer, gl } = await initialized();
    const source = new RenderTarget({ width: 8, height: 8 });
    renderer.renderEffect(effectPass(source));
    gl.reset();

    renderer.renderEffect(effectPass(source, { kind: "output-transform" }));

    expect(uploadsAt(gl, effectUniforms(gl).get("useEncode"))).toEqual([1]);
    expect(uploadsAt(gl, effectUniforms(gl).get("useGrade"))).toEqual([]);
    expect(gl.countOf("uniform3fv")).toBe(0);
    expect(gl.countOf("drawArrays")).toBe(1);
  });

  it("counts one draw call, one instance and one triangle (§84)", async () => {
    const { renderer } = await initialized();
    const statistics = createRenderStatistics();
    renderer.statistics = statistics;

    renderer.renderEffect(
      effectPass(new RenderTarget({ width: 4, height: 4 })),
    );

    expect(statistics).toEqual({ drawCalls: 1, instances: 1, triangles: 1 });
  });
});

describe("WebglRenderer.renderEffect — what it refuses (§70, §83, R-4)", () => {
  it("refuses a pass that draws into the surface it samples", async () => {
    // R-4's feedback rule, applied to the pass instead of to a material's
    // `map`: the draw is refused rather than producing undefined content, and
    // `RenderGraph.validate` reports the same mistake statically.
    const { renderer, gl } = await initialized();
    const surface = new RenderTarget({ width: 16, height: 16 });
    gl.reset();

    renderer.renderEffect(effectPass(surface, { kind: "copy" }, surface));

    expect(gl.calls).toEqual([]);
  });

  it("skips a disposed source, and a disposed destination", async () => {
    const { renderer, gl } = await initialized();
    const source = new RenderTarget({ width: 8, height: 8 });
    const destination = new RenderTarget({ width: 8, height: 8 });
    renderer.renderEffect(effectPass(source, { kind: "copy" }, destination));

    source.dispose();
    gl.reset();
    renderer.renderEffect(effectPass(source, { kind: "copy" }, destination));
    expect(gl.countOf("drawArrays")).toBe(0);

    const live = new RenderTarget({ width: 8, height: 8 });
    destination.dispose();
    gl.reset();
    renderer.renderEffect(effectPass(live, { kind: "copy" }, destination));
    expect(gl.countOf("drawArrays")).toBe(0);
    // Nothing was left bound by the pass it declined to draw.
    expect(effectiveGlState(gl)).toEqual(RESTING_GL_STATE);
  });

  it("skips a destination whose framebuffer GL will not allocate", async () => {
    const { renderer, gl } = await initialized({ allocateFramebuffers: false });
    gl.reset();

    renderer.renderEffect(
      effectPass(
        new RenderTarget({ width: 8, height: 8 }),
        { kind: "copy" },
        new RenderTarget({ width: 8, height: 8 }),
      ),
    );

    expect(gl.countOf("drawArrays")).toBe(0);
  });

  it("skips a source that is not a render-target texture", async () => {
    // The structural read: a caller that bypassed `validateEffectRenderPass`
    // hands over an ordinary texture, and gets a skipped effect rather than a
    // black screen with nothing to explain it.
    const { renderer, gl } = await initialized();
    gl.reset();

    renderer.renderEffect({
      kind: "effect",
      source: new TestTexture().asTexture,
      effect: { kind: "copy" },
    } as unknown as EffectPass);

    expect(gl.calls).toEqual([]);
  });

  it("skips an effect kind this build does not implement", async () => {
    // `{ kind: "bloom" }` is a compile error; this is the same value arriving
    // from JSON. It must not become a copy — that would be a different
    // picture than the one asked for, silently.
    const { renderer, gl } = await initialized();
    const source = new RenderTarget({ width: 8, height: 8 });
    renderer.renderEffect(effectPass(source));
    gl.reset();

    renderer.renderEffect({
      kind: "effect",
      source: source.colorTexture,
      effect: { kind: "bloom" },
    } as unknown as EffectPass);

    expect(gl.countOf("drawArrays")).toBe(0);
  });

  it("returns silently while the context is lost, and never throws (§61)", async () => {
    const { renderer, gl, canvas } = await initialized();
    const source = new RenderTarget({ width: 8, height: 8 });
    canvas.dispatch("webglcontextlost");
    gl.reset();

    expect(() => {
      renderer.renderEffect(effectPass(source));
    }).not.toThrow();
    expect(gl.calls).toEqual([]);
  });

  it("throws INVALID_APPLICATION_STATE before initialize and after disposal", async () => {
    const source = new RenderTarget({ width: 8, height: 8 });
    const uninitialized = new WebglRenderer();
    expect(
      thrown(() => uninitialized.renderEffect(effectPass(source))).code,
    ).toBe("INVALID_APPLICATION_STATE");

    const { renderer } = await initialized();
    renderer.dispose();
    expect(thrown(() => renderer.renderEffect(effectPass(source))).code).toBe(
      "INVALID_APPLICATION_STATE",
    );
  });
});

describe("WebglRenderer.renderEffect — the F13 envelope (R-6)", () => {
  it("gives back the depth test and every binding when the draw throws", async () => {
    const { renderer, gl } = await initialized();
    const source = new RenderTarget({ width: 8, height: 8 });
    const destination = new RenderTarget({ width: 8, height: 8 });
    renderer.renderEffect(effectPass(source, { kind: "copy" }, destination));
    gl.reset();
    // A driver-side failure, standing in for anything that can raise between
    // the binds and the end of the pass.
    const drawArrays = gl.drawArrays.bind(gl);
    gl.drawArrays = (): never => {
      throw new Error("the driver raised mid-effect");
    };

    try {
      expect(() => {
        renderer.renderEffect(
          effectPass(source, { kind: "copy" }, destination),
        );
      }).toThrow(/raised mid-effect/);
    } finally {
      gl.drawArrays = drawArrays;
    }

    // It really did borrow — the depth test was disabled, a texture and a
    // framebuffer were bound — and gave every one of them back.
    expect(gl.names()).toContain("disable");
    expect(effectiveGlState(gl)).toEqual(RESTING_GL_STATE);
  });

  it("leaves the next frame drawing exactly as it would have", async () => {
    const { renderer, gl, camera } = await initialized();
    const source = new RenderTarget({ width: 8, height: 8 });
    const root = createRoot();
    root.add(renderable(triangleGeometry()));

    // A clean frame, for comparison.
    renderer.render(root, [createView(camera)]);
    gl.reset();
    renderer.render(root, [createView(camera)]);
    const expected = JSON.stringify(gl.calls);

    const drawArrays = gl.drawArrays.bind(gl);
    gl.drawArrays = (): never => {
      throw new Error("the driver raised mid-effect");
    };
    try {
      expect(() => {
        renderer.renderEffect(effectPass(source));
      }).toThrow(/raised mid-effect/);
    } finally {
      gl.drawArrays = drawArrays;
    }

    gl.reset();
    renderer.render(root, [createView(camera)]);
    expect(JSON.stringify(gl.calls)).toBe(expected);
  });
});

describe("WebglRenderer.render — untouched by §70 (R-6)", () => {
  it("issues no effect-pipeline call in a frame that runs no effect", async () => {
    // The load-bearing regression guard, in the same shape R-4's is. An effect
    // is a separate entry point, so the only thing R-6 adds to a frame that
    // uses none is one more program compiled at initialization — and this
    // asserts that the frame itself never touches it.
    const { renderer, gl, camera } = await initialized();
    // Since 2026-09-11 the effect program compiles on the first effect pass
    // rather than at initialize; run one so there is a handle to assert
    // against, then check the frame never selects it.
    renderer.renderEffect(effectPass(new RenderTarget({ width: 4, height: 4 })));
    const effect = effectProgramHandle(gl);
    const root = createRoot();
    root.add(
      renderable(quadGeometry()),
      sprite(),
      stateful(BORROWS_EVERYTHING),
    );
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.callsOf("useProgram").map((call) => call.args[0])).not.toContain(
      effect,
    );
    // This scene has no lit item, so the lit pipeline's light uploads are the
    // only other `uniform3fv` in the backend and they cannot have run: the
    // count is the effect pipeline's `grade` upload, and it is zero.
    expect(gl.countOf("uniform3fv")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §59's metallic-roughness pipeline (R-13, 2026-08-08).
// ---------------------------------------------------------------------------

/**
 * The standard program's uniform handles, found by a uniform name only it
 * declares — the lit and sprite lookups' pattern (see {@link litUniforms}).
 */
function standardUniforms(gl: FakeGl): Map<string, object> {
  for (const perProgram of gl.uniformsByProgram.values()) {
    if (perProgram.has("cameraPosition")) {
      return perProgram;
    }
  }
  throw new Error("the standard program never resolved its uniforms");
}

function standardRenderable(
  geometry: TestGeometry = litTriangleGeometry(),
  material: TestStandardMaterial = new TestStandardMaterial(),
): Renderable<ItemStandardMaterial> {
  // The type parameter is named, unlike `litRenderable`'s: `Renderable`
  // defaults to §57's `SurfaceMaterial` (`UnlitMaterial | LitMaterial`), and
  // §59's member is deliberately not in it — see `renderable.ts` for why that
  // union stays narrow.
  return new Renderable(geometry.asGeometry, material.asMaterial);
}

describe("StandardProgram — compilation and linking (§59, §61, §89)", () => {
  it("compiles both stages, links, and resolves the thirty-two uniforms", () => {
    const gl = createFakeGl();

    const program = StandardProgram.create(gl);

    expect(gl.countOf("createShader")).toBe(2);
    expect(gl.countOf("linkProgram")).toBe(1);
    expect(
      gl.callsOf("getUniformLocation").map((call) => call.args[1]),
    ).toEqual([
      "viewProjection",
      "model",
      "normalMatrix",
      "baseColor",
      "metalness",
      "roughness",
      "emissive",
      "ambientLight",
      "lightDirection",
      "lightColor",
      "cameraPosition",
      "map",
      "useMap",
      "metalRoughnessMap",
      "useMetalRoughnessMap",
      "emissiveMap",
      "useEmissiveMap",
      "normalMap",
      "useNormalMap",
      "occlusionMap",
      "useOcclusionMap",
      "normalScaleOffset",
      "occlusionStrengthOffset",
      // §68's light set (R-17, 2026-08-09) — the same five names, in the same
      // order, as the lit pipeline's, because both resolve them through the
      // one `PunctualLightUniforms.resolve`.
      "punctualCount",
      "punctualPosition[0]",
      "punctualColor[0]",
      "punctualDirection[0]",
      "punctualParams[0]",
      // §68's hemisphere — the same four names, in the same order, as the
      // lit pipeline's, because both resolve them through the one
      // `HemisphereLightUniforms.resolve`.
      "hemisphereSky",
      "hemisphereGround",
      "hemisphereUp",
      "useHemisphere",
      // §69's shadow map (R-18, 2026-08-09) — the same six names, in the same
      // order, as the lit pipeline's, because both resolve them through the
      // one `ShadowUniforms.resolve`.
      "useShadow",
      "shadowMap",
      "shadowMatrix",
      "shadowBias",
      "shadowNormalBias",
      "shadowTexelSize",
    ]);
    expect(program.disposed).toBe(false);
  });

  it("declares the three attribute streams at the fixed shared locations", () => {
    // One geometry cache serves all six programs precisely because every
    // pipeline names the same slots (`gl-geometry.ts`).
    const gl = createFakeGl();

    StandardProgram.create(gl);

    const sources = gl
      .callsOf("shaderSource")
      .map((call) => String(call.args[1]));
    for (const source of sources) {
      expect(source.startsWith("#version 300 es\n")).toBe(true);
    }
    expect(sources[0]).toContain(
      `layout(location = ${String(POSITION_ATTRIBUTE_LOCATION)}) in vec3 position;`,
    );
    expect(sources[0]).toContain(
      `layout(location = ${String(NORMAL_ATTRIBUTE_LOCATION)}) in vec3 normal;`,
    );
    expect(sources[0]).toContain(
      `layout(location = ${String(UV_ATTRIBUTE_LOCATION)}) in vec2 uv;`,
    );
    expect(sources[0]).toContain("uniform mat3 normalMatrix;");
    expect(sources[0]).toContain("vNormal = normalMatrix * normal;");
    expect(sources[0]).not.toContain("transpose(inverse");
    // The world position is the one varying the lit stage does not produce.
    expect(sources[0]).toContain("out vec3 vWorldPosition;");
    // §59's parameters, and the BRDF's own constants.
    expect(sources[1]).toContain("uniform float metalness;");
    expect(sources[1]).toContain("uniform float roughness;");
    expect(sources[1]).toContain("uniform vec3 emissive;");
    expect(sources[1]).toContain("uniform sampler2D emissiveMap;");
    expect(sources[1]).toContain("uniform bool useEmissiveMap;");
    expect(sources[1]).toContain("texture(emissiveMap, vUv)");
    expect(sources[1]).toContain("const float DIELECTRIC_F0 = 0.04;");
    expect(sources[1]).toContain("const float MIN_ROUGHNESS = 0.045;");
  });

  it("uploads the view-projection, the model matrix and the base colour", () => {
    const gl = createFakeGl();
    const program = StandardProgram.create(gl);
    program.use();
    const uniforms = standardUniforms(gl);

    const viewProjection = new Matrix4();
    viewProjection.elements[12] = 7;
    program.setViewProjection(viewProjection);
    const model = new Matrix4();
    model.elements[13] = -2;
    program.setModel(model);
    program.setBaseColor([1, 0.5, 0.25, 0.5], 0.5);

    expect(uploadsAt(gl, uniforms.get("viewProjection"))).toHaveLength(1);
    expect(uploadsAt(gl, uniforms.get("model"))).toHaveLength(1);
    expect(uploadsAt(gl, uniforms.get("normalMatrix"))).toEqual([
      [1, 0, 0, 0, 1, 0, 0, 0, 1],
    ]);
    // `opacity` multiplies alpha only, exactly as the unlit program does.
    expect(uploadsAt(gl, uniforms.get("baseColor"))).toEqual([
      [1, 0.5, 0.25, 0.25],
    ]);
  });

  it("defaults opacity to 1, so an untouched material uploads its alpha unchanged", () => {
    const gl = createFakeGl();
    const program = StandardProgram.create(gl);
    program.use();

    program.setBaseColor([1, 1, 1, 0.25]);

    expect(uploadsAt(gl, standardUniforms(gl).get("baseColor"))).toEqual([
      [1, 1, 1, 0.25],
    ]);
  });

  it("uploads §59's surface parameters as two scalars and one vec3", () => {
    const gl = createFakeGl();
    const program = StandardProgram.create(gl);
    program.use();
    const uniforms = standardUniforms(gl);

    const emissive: [number, number, number] = [4, 2, 1];
    program.setSurface(0.75, 0.2, emissive);

    expect(uploadsAt(gl, uniforms.get("metalness"))).toEqual([0.75]);
    expect(uploadsAt(gl, uniforms.get("roughness"))).toEqual([0.2]);
    expect(uploadsAt(gl, uniforms.get("emissive"))).toEqual([[4, 2, 1]]);
    // Scratch is copied at upload time, as everywhere in this backend.
    emissive[0] = 0;
    expect(uploadsAt(gl, uniforms.get("emissive"))).toEqual([[4, 2, 1]]);
  });

  it("uploads the lights and the eye out of copied scratch", () => {
    const gl = createFakeGl();
    const program = StandardProgram.create(gl);
    program.use();
    const uniforms = standardUniforms(gl);

    program.setAmbientLight([0.25, 0.5, 0.75]);
    program.setDirectionalLight(new Vector3(0, -1, 0), [2, 1, 0.5]);
    program.setCameraPosition(1, 2, 3);

    expect(uploadsAt(gl, uniforms.get("ambientLight"))).toEqual([
      [0.25, 0.5, 0.75],
    ]);
    expect(uploadsAt(gl, uniforms.get("lightDirection"))).toEqual([[0, -1, 0]]);
    expect(uploadsAt(gl, uniforms.get("lightColor"))).toEqual([[2, 1, 0.5]]);
    expect(uploadsAt(gl, uniforms.get("cameraPosition"))).toEqual([[1, 2, 3]]);
  });

  it("uploads the sampler unit once, lazily, and mirrors the map switch", () => {
    const gl = createFakeGl();
    const program = StandardProgram.create(gl);
    program.use();
    const uniforms = standardUniforms(gl);

    // Already off: the mirror starts where GL starts, so this costs nothing.
    program.setFeatures(false);
    expect(gl.countOf("uniform1i")).toBe(0);

    program.setFeatures(true);
    expect(uploadsAt(gl, uniforms.get("map"))).toEqual([MAP_TEXTURE_UNIT]);
    expect(uploadsAt(gl, uniforms.get("useMap"))).toEqual([1]);

    program.setFeatures(true);
    expect(gl.countOf("uniform1i")).toBe(2);

    program.setFeatures(false);
    expect(uploadsAt(gl, uniforms.get("useMap"))).toEqual([1, 0]);
    // The sampler unit is uploaded once in the lifetime of the program.
    program.setFeatures(true);
    expect(uploadsAt(gl, uniforms.get("map"))).toEqual([MAP_TEXTURE_UNIT]);
  });

  it("uploads the metallic-roughness sampler on unit 2, lazily, without touching unit 0", () => {
    const gl = createFakeGl();
    const program = StandardProgram.create(gl);
    program.use();
    const uniforms = standardUniforms(gl);

    program.setFeatures(false, false);
    expect(gl.countOf("uniform1i")).toBe(0);

    program.setFeatures(false, true);
    expect(uploadsAt(gl, uniforms.get("metalRoughnessMap"))).toEqual([
      METAL_ROUGHNESS_TEXTURE_UNIT,
    ]);
    expect(uploadsAt(gl, uniforms.get("useMetalRoughnessMap"))).toEqual([1]);
    expect(uploadsAt(gl, uniforms.get("map"))).toEqual([]);
    expect(uploadsAt(gl, uniforms.get("useMap"))).toEqual([]);

    program.setFeatures(false, true);
    expect(gl.countOf("uniform1i")).toBe(2);

    program.setFeatures(false, false);
    expect(uploadsAt(gl, uniforms.get("useMetalRoughnessMap"))).toEqual([1, 0]);
    program.setFeatures(false, true);
    expect(uploadsAt(gl, uniforms.get("metalRoughnessMap"))).toEqual([
      METAL_ROUGHNESS_TEXTURE_UNIT,
    ]);
  });

  it("uploads the emissive sampler on unit 3, lazily, without touching units 0 or 2", () => {
    const gl = createFakeGl();
    const program = StandardProgram.create(gl);
    program.use();
    const uniforms = standardUniforms(gl);

    program.setFeatures(false, false, false);
    expect(gl.countOf("uniform1i")).toBe(0);

    program.setFeatures(false, false, true);
    expect(uploadsAt(gl, uniforms.get("emissiveMap"))).toEqual([
      EMISSIVE_TEXTURE_UNIT,
    ]);
    expect(uploadsAt(gl, uniforms.get("useEmissiveMap"))).toEqual([1]);
    expect(uploadsAt(gl, uniforms.get("map"))).toEqual([]);
    expect(uploadsAt(gl, uniforms.get("useMap"))).toEqual([]);
    expect(uploadsAt(gl, uniforms.get("metalRoughnessMap"))).toEqual([]);
    expect(uploadsAt(gl, uniforms.get("useMetalRoughnessMap"))).toEqual([]);

    program.setFeatures(false, false, true);
    expect(gl.countOf("uniform1i")).toBe(2);

    program.setFeatures(false, false, false);
    expect(uploadsAt(gl, uniforms.get("useEmissiveMap"))).toEqual([1, 0]);
    program.setFeatures(false, false, true);
    expect(uploadsAt(gl, uniforms.get("emissiveMap"))).toEqual([
      EMISSIVE_TEXTURE_UNIT,
    ]);
  });

  it("throws SHADER_COMPILATION_FAILED and cleans up exactly as the unlit program does", () => {
    const failed = createFakeGl({ compileStatus: false });
    const error = thrown(() => {
      StandardProgram.create(failed);
    });
    expect(error.code).toBe("SHADER_COMPILATION_FAILED");
    expect(error.context?.stage).toBe("vertex");

    const unresolved = createFakeGl({ resolveUniforms: false });
    const uniformError = thrown(() => {
      StandardProgram.create(unresolved);
    });
    expect(uniformError.code).toBe("SHADER_COMPILATION_FAILED");
    expect(unresolved.countOf("deleteProgram")).toBe(1);
  });

  it("deletes the GL program once, idempotently", () => {
    const gl = createFakeGl();
    const program = StandardProgram.create(gl);

    program.dispose();
    program.dispose();

    expect(gl.countOf("deleteProgram")).toBe(1);
    expect(program.disposed).toBe(true);
  });
});

describe("WebglRenderer.render — standard surfaces (§59, §68)", () => {
  it("draws a standard item through its own pipeline with the frame's lights and the eye", async () => {
    const { renderer, gl, camera } = await initialized();
    camera.placeAt(0, 0, 8);
    const root = new AmbientRoot([0.25, 0.5, 0.75]);
    const light = new TestLight([1, 0.5, 0.25], 2, [0, -1, 0]);
    // Components exact in 32-bit float, so the recorded upload compares
    // without a tolerance.
    const material = new TestStandardMaterial(
      [0.75, 0.5, 0.25, 1],
      1,
      0.25,
      [0, 0, 0.5],
    );
    root.add(light, standardRenderable(litTriangleGeometry(), material));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    const uniforms = standardUniforms(gl);
    expect(uploadsAt(gl, uniforms.get("ambientLight"))).toEqual([
      [0.25, 0.5, 0.75],
    ]);
    expect(uploadsAt(gl, uniforms.get("lightDirection"))).toEqual([[0, -1, 0]]);
    expect(uploadsAt(gl, uniforms.get("lightColor"))).toEqual([[2, 1, 0.5]]);
    expect(uploadsAt(gl, uniforms.get("cameraPosition"))).toEqual([[0, 0, 8]]);
    expect(uploadsAt(gl, uniforms.get("baseColor"))).toEqual([
      [0.75, 0.5, 0.25, 1],
    ]);
    expect(uploadsAt(gl, uniforms.get("metalness"))).toEqual([1]);
    expect(uploadsAt(gl, uniforms.get("roughness"))).toEqual([0.25]);
    expect(uploadsAt(gl, uniforms.get("emissive"))).toEqual([[0, 0, 0.5]]);
    expect(gl.countOf("drawArrays")).toBe(1);
    // The frame starts on the unlit program and switches once.
    expect(gl.countOf("useProgram")).toBe(2);
    // Standard surfaces are opaque by default (§57): blending never turns on.
    expect(
      gl.callsOf("enable").filter((call) => call.args[0] === GL.BLEND),
    ).toHaveLength(0);
  });

  it("uploads the per-view state once however many standard items draw", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(new TestLight(), standardRenderable(), standardRenderable());
    gl.reset();

    renderer.render(root, [createView(camera)]);

    const uniforms = standardUniforms(gl);
    expect(uploadsAt(gl, uniforms.get("ambientLight"))).toHaveLength(1);
    expect(uploadsAt(gl, uniforms.get("cameraPosition"))).toHaveLength(1);
    // …and the per-draw state once per draw.
    expect(uploadsAt(gl, uniforms.get("model"))).toHaveLength(2);
    expect(uploadsAt(gl, uniforms.get("metalness"))).toHaveLength(2);
    expect(gl.countOf("drawArrays")).toBe(2);
    expect(gl.countOf("useProgram")).toBe(2);
  });

  it("re-uploads the per-view state for a second viewport", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(new TestLight(), standardRenderable());
    const second = new TestCamera().placeAt(3, 0, 0);
    gl.reset();

    renderer.render(root, [createView(camera), createView(second)]);

    expect(uploadsAt(gl, standardUniforms(gl).get("cameraPosition"))).toEqual([
      [0, 0, 0],
      [3, 0, 0],
    ]);
  });

  it("honours §57's render state on a standard draw", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const material = new TestStandardMaterial();
    const transparent = material as unknown as {
      transparent: boolean;
      blendMode: string;
      depthWrite: boolean;
      opacity: number;
    };
    transparent.transparent = true;
    transparent.blendMode = "additive";
    transparent.depthWrite = false;
    transparent.opacity = 0.5;
    root.add(standardRenderable(litTriangleGeometry(), material));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(
      gl.callsOf("enable").filter((call) => call.args[0] === GL.BLEND),
    ).toHaveLength(1);
    expect(gl.callsOf("blendFunc")[0].args).toEqual([GL.SRC_ALPHA, GL.ONE]);
    expect(gl.callsOf("depthMask").map((call) => call.args[0])).toEqual([
      false,
      true,
    ]);
    expect(uploadsAt(gl, standardUniforms(gl).get("baseColor"))).toEqual([
      [1, 1, 1, 0.5],
    ]);
  });

  it("binds the base-colour map on the shared unit and switches it off again", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const texture = new TestTexture();
    const mapped = new TestStandardMaterial();
    mapped.map = texture.asTexture;
    root.add(
      standardRenderable(litTriangleGeometry(), mapped),
      standardRenderable(),
    );
    // One warm-up frame: the first upload of a texture binds it too, and this
    // test is about the *draw* bindings.
    renderer.render(root, [createView(camera)]);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.callsOf("activeTexture").map((call) => call.args[0])).toEqual([
      GL.TEXTURE0 + MAP_TEXTURE_UNIT,
    ]);
    const bound = gl.callsOf("bindTexture").map((call) => call.args[1]);
    expect(bound).toHaveLength(2);
    expect(bound[1]).toBeNull();
    expect(uploadsAt(gl, standardUniforms(gl).get("useMap"))).toEqual([1, 0]);
  });

  it("binds the packed metallic-roughness map on unit 2 and restores after the draw", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const texture = new TestTexture();
    const mapped = new TestStandardMaterial();
    mapped.metalRoughnessMap = texture.asTexture;
    root.add(standardRenderable(litTriangleGeometry(), mapped));
    renderer.render(root, [createView(camera)]);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.callsOf("activeTexture").map((call) => call.args[0])).toEqual([
      GL.TEXTURE0 + METAL_ROUGHNESS_TEXTURE_UNIT,
      GL.TEXTURE0,
    ]);
    const bound = gl.callsOf("bindTexture").map((call) => call.args[1]);
    expect(bound).toHaveLength(2);
    expect(bound[0]).not.toBeNull();
    expect(bound[1]).toBeNull();
    // Program-lifetime mirror: the warmup frame already turned the flag on,
    // so this frame issues no `useMetalRoughnessMap` upload. `useMap` never
    // turned on at all.
    expect(
      uploadsAt(gl, standardUniforms(gl).get("useMetalRoughnessMap")),
    ).toEqual([]);
    expect(uploadsAt(gl, standardUniforms(gl).get("useMap"))).toEqual([]);
  });

  it("re-selects unit 2 when restoring after a draw that also bound unit 0", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const mapped = new TestStandardMaterial();
    mapped.map = new TestTexture().asTexture;
    mapped.metalRoughnessMap = new TestTexture().asTexture;
    root.add(standardRenderable(litTriangleGeometry(), mapped));
    renderer.render(root, [createView(camera)]);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.callsOf("activeTexture").map((call) => call.args[0])).toEqual([
      GL.TEXTURE0 + MAP_TEXTURE_UNIT,
      GL.TEXTURE0 + METAL_ROUGHNESS_TEXTURE_UNIT,
      GL.TEXTURE0 + MAP_TEXTURE_UNIT,
      GL.TEXTURE0 + METAL_ROUGHNESS_TEXTURE_UNIT,
      GL.TEXTURE0,
    ]);
    const bound = gl.callsOf("bindTexture").map((call) => call.args[1]);
    expect(bound).toHaveLength(4);
    expect(bound[0]).not.toBeNull();
    expect(bound[1]).not.toBeNull();
    expect(bound[2]).toBeNull();
    expect(bound[3]).toBeNull();
  });

  it("binds the emissive map on unit 3 without an albedo map and restores after the draw", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const texture = new TestTexture();
    const mapped = new TestStandardMaterial();
    mapped.emissiveMap = texture.asTexture;
    root.add(standardRenderable(litUvTriangleGeometry(), mapped));
    renderer.render(root, [createView(camera)]);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.callsOf("activeTexture").map((call) => call.args[0])).toEqual([
      GL.TEXTURE0 + EMISSIVE_TEXTURE_UNIT,
      GL.TEXTURE0,
    ]);
    const bound = gl.callsOf("bindTexture").map((call) => call.args[1]);
    expect(bound).toHaveLength(2);
    expect(bound[0]).not.toBeNull();
    expect(bound[1]).toBeNull();
    // Program-lifetime mirror: the warmup frame already turned the flag on.
    expect(uploadsAt(gl, standardUniforms(gl).get("useEmissiveMap"))).toEqual(
      [],
    );
    expect(uploadsAt(gl, standardUniforms(gl).get("useMap"))).toEqual([]);
    expect(
      uploadsAt(gl, standardUniforms(gl).get("useMetalRoughnessMap")),
    ).toEqual([]);
  });

  it("writes uvs when only emissiveMap is set", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const mapped = new TestStandardMaterial();
    mapped.emissiveMap = new TestTexture().asTexture;
    root.add(standardRenderable(litUvTriangleGeometry(), mapped));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(
      gl.callsOf("enableVertexAttribArray").map((call) => call.args[0]),
    ).toContain(UV_ATTRIBUTE_LOCATION);
    expect(
      gl
        .callsOf("vertexAttribPointer")
        .some(
          (call) =>
            call.args[0] === UV_ATTRIBUTE_LOCATION && call.args[1] === 2,
        ),
    ).toBe(true);
    expect(uploadsAt(gl, standardUniforms(gl).get("useEmissiveMap"))).toEqual([
      1,
    ]);
    expect(uploadsAt(gl, standardUniforms(gl).get("useMap"))).toEqual([]);
    expect(uploadsAt(gl, standardUniforms(gl).get("emissiveMap"))).toEqual([
      EMISSIVE_TEXTURE_UNIT,
    ]);
  });

  it("switches the emissive sampler off for an unmapped item after a mapped one", async () => {
    const { renderer, gl, camera } = await initialized();
    const mapped = new TestStandardMaterial();
    mapped.emissiveMap = new TestTexture().asTexture;
    const root = createRoot();
    root.add(
      standardRenderable(litUvTriangleGeometry(), mapped),
      standardRenderable(),
    );
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(uploadsAt(gl, standardUniforms(gl).get("useEmissiveMap"))).toEqual([
      1, 0,
    ]);
    expect(gl.countOf("drawArrays")).toBe(2);
  });

  it("re-selects unit 3 when restoring after a draw that also bound unit 0", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const mapped = new TestStandardMaterial();
    mapped.map = new TestTexture().asTexture;
    mapped.emissiveMap = new TestTexture().asTexture;
    root.add(standardRenderable(litUvTriangleGeometry(), mapped));
    renderer.render(root, [createView(camera)]);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.callsOf("activeTexture").map((call) => call.args[0])).toEqual([
      GL.TEXTURE0 + MAP_TEXTURE_UNIT,
      GL.TEXTURE0 + EMISSIVE_TEXTURE_UNIT,
      GL.TEXTURE0 + MAP_TEXTURE_UNIT,
      GL.TEXTURE0 + EMISSIVE_TEXTURE_UNIT,
      GL.TEXTURE0,
    ]);
    const bound = gl.callsOf("bindTexture").map((call) => call.args[1]);
    expect(bound).toHaveLength(4);
    expect(bound[0]).not.toBeNull();
    expect(bound[1]).not.toBeNull();
    expect(bound[2]).toBeNull();
    expect(bound[3]).toBeNull();
  });

  it("re-selects units 2 and 3 when restoring a draw that bound MR then emissive", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const mapped = new TestStandardMaterial();
    mapped.metalRoughnessMap = new TestTexture().asTexture;
    mapped.emissiveMap = new TestTexture().asTexture;
    root.add(standardRenderable(litUvTriangleGeometry(), mapped));
    renderer.render(root, [createView(camera)]);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.callsOf("activeTexture").map((call) => call.args[0])).toEqual([
      GL.TEXTURE0 + METAL_ROUGHNESS_TEXTURE_UNIT,
      GL.TEXTURE0 + EMISSIVE_TEXTURE_UNIT,
      GL.TEXTURE0 + METAL_ROUGHNESS_TEXTURE_UNIT,
      GL.TEXTURE0 + EMISSIVE_TEXTURE_UNIT,
      GL.TEXTURE0,
    ]);
  });

  it("draws a material whose emissive map the application disposed with no emissive sample", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const texture = new TestTexture();
    texture.disposed = true;
    const material = new TestStandardMaterial();
    material.emissiveMap = texture.asTexture;
    root.add(standardRenderable(litUvTriangleGeometry(), material));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("bindTexture")).toBe(0);
    expect(gl.countOf("drawArrays")).toBe(1);
    expect(uploadsAt(gl, standardUniforms(gl).get("useEmissiveMap"))).toEqual(
      [],
    );
  });

  it("draws a material whose texture the application disposed with no map at all", async () => {
    // The `TextureCache` returns null, and the draw proceeds untextured — the
    // §83 behaviour the unlit and lit paths already have.
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const texture = new TestTexture();
    texture.disposed = true;
    const material = new TestStandardMaterial();
    material.map = texture.asTexture;
    root.add(standardRenderable(litTriangleGeometry(), material));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("bindTexture")).toBe(0);
    expect(gl.countOf("drawArrays")).toBe(1);
  });

  it("mixes a lit and a standard surface in one frame, one switch each", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(new TestLight(), litRenderable(), standardRenderable());
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // Unlit (the resting state), lit, standard — three distinct programs.
    const programs = gl.callsOf("useProgram").map((call) => call.args[0]);
    expect(programs).toHaveLength(3);
    expect(new Set(programs).size).toBe(3);
    expect(gl.countOf("drawArrays")).toBe(2);
    // One light collection serves both families: the lit and the standard
    // pipeline read the same `SceneLights` record.
    expect(uploadsAt(gl, litUniforms(gl).get("lightColor"))).toHaveLength(1);
    expect(uploadsAt(gl, standardUniforms(gl).get("lightColor"))).toHaveLength(
      1,
    );
  });

  it("counts a standard draw in §84's statistics like any other", async () => {
    const { renderer, gl, camera } = await initialized();
    const statistics = createRenderStatistics();
    renderer.statistics = statistics;
    const root = createRoot();
    root.add(standardRenderable());
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(statistics.drawCalls).toBe(1);
    expect(statistics.triangles).toBe(1);
    expect(statistics.instances).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §61's loss/restore contract, end to end (A-24, 2026-08-08).
// ---------------------------------------------------------------------------

/**
 * Every GPU handle the recorded calls mention.
 *
 * The double mints handles as `{ kind, serial }` objects and `snapshot` turns
 * typed arrays into plain `Array`s, so "an object argument that is not an
 * array" is exactly "a GL object" — programs, shaders, buffers, vertex arrays,
 * textures, framebuffers, renderbuffers, and uniform locations alike.
 */
function glHandles(calls: readonly RecordedCall[]): Set<object> {
  const handles = new Set<object>();
  for (const call of calls) {
    for (const argument of call.args) {
      if (
        typeof argument === "object" &&
        argument !== null &&
        !Array.isArray(argument)
      ) {
        handles.add(argument);
      }
    }
  }
  return handles;
}

/**
 * A transcript in which handles are compared by *position*, not identity.
 *
 * `RecordingGl.transcript` in `tests/integration/helpers` serializes handles as
 * themselves, which is what makes "the same objects in the same order" an
 * assertable claim there. Across a context loss the objects are necessarily
 * different — that is the whole point — so each handle is replaced by the index
 * of its first appearance. Two frames match here when they issue the same calls
 * with the same arguments against handles used in the same pattern, which is
 * what "the restore put the renderer back exactly where it was" means.
 */
function shapedTranscript(calls: readonly RecordedCall[]): string[] {
  const identifiers = new Map<object, string>();
  const describe = (value: unknown): string => {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      let identifier = identifiers.get(value);
      if (identifier === undefined) {
        identifier = `#${String(identifiers.size)}`;
        identifiers.set(value, identifier);
      }
      return identifier;
    }
    return JSON.stringify(value) ?? String(value);
  };
  return calls.map(
    (call) => `${call.name}(${call.args.map(describe).join(", ")})`,
  );
}

/** The `create*` entry points that hand out a GPU object other than a program. */
const RESOURCE_ALLOCATORS = [
  "createBuffer",
  "createVertexArray",
  "createTexture",
  "createFramebuffer",
  "createRenderbuffer",
] as const;

describe("WebglRenderer — §61 context-loss recovery (A-24)", () => {
  /**
   * A scene that touches every cache the renderer owns: indexed geometry
   * (`GeometryCache`), a sprite and therefore a texture (`TextureCache`), and
   * — through the `target` argument the tests pass — a framebuffer
   * (`RenderTargetCache`).
   */
  function lossScene(): { root: Renderable; texture: TestTexture } {
    const texture = new TestTexture();
    const root = createRoot();
    root.add(
      renderable(quadGeometry()),
      sprite(new TestSpriteMaterial(texture)),
    );
    return { root, texture };
  }

  it("draws the frame after a restore call for call as it drew before the loss", async () => {
    const { renderer, gl, canvas, camera } = await initialized();
    const { root } = lossScene();
    const views = [createView(camera)];
    gl.reset();
    renderer.render(root, views);
    const before = shapedTranscript(gl.calls);

    canvas.dispatch("webglcontextlost");
    canvas.dispatch("webglcontextrestored");
    gl.reset();
    renderer.render(root, views);

    // Not "it draws again" — the *same* frame, against handles used in the
    // same pattern. A restore that rebuilt one pipeline differently, skipped a
    // re-upload, or left the §57 state mirror claiming state the fresh context
    // does not have would show up as a diff here and nowhere else.
    expect(shapedTranscript(gl.calls)).toEqual(before);
    expect(before.length).toBeGreaterThan(0);
  });

  it("never touches a handle from before the loss again — the whole point of forget()", async () => {
    const { renderer, gl, canvas, camera } = await initialized();
    const { root } = lossScene();
    const views = [createView(camera)];
    const target = new RenderTarget({ width: 16, height: 16 });
    const source = new RenderTarget({ width: 8, height: 8 });
    renderer.render(root, views);
    renderer.render(root, views, undefined, target);
    renderer.render(createRoot(), views, undefined, source);
    renderer.renderEffect(effectPass(source));
    // Every program, shader, buffer, vertex array, texture, framebuffer,
    // renderbuffer and uniform location the live context ever handed out.
    const dead = glHandles(gl.calls);
    expect(dead.size).toBeGreaterThan(20);

    canvas.dispatch("webglcontextlost");
    canvas.dispatch("webglcontextrestored");
    gl.reset();
    renderer.render(root, views);
    renderer.render(root, views, undefined, target);
    renderer.render(createRoot(), views, undefined, source);
    renderer.renderEffect(effectPass(source));

    // The class of bug this suite exists to catch: a cache that kept a record,
    // a program field that was not nulled, a uniform location resolved against
    // a dead program. Every one of them surfaces as a handle from the first
    // list appearing in the second.
    const reused = [...glHandles(gl.calls)].filter((handle) =>
      dead.has(handle),
    );
    expect(reused).toEqual([]);
  });

  it("rebuilds the pipelines eagerly and every resource lazily", async () => {
    const { renderer, gl, canvas, camera } = await initialized();
    const { root } = lossScene();
    const views = [createView(camera)];
    renderer.render(
      root,
      views,
      undefined,
      new RenderTarget({ width: 8, height: 8 }),
    );
    canvas.dispatch("webglcontextlost");
    gl.reset();

    canvas.dispatch("webglcontextrestored");

    // §61 splits the restore in two: engine-owned *pipelines* come back before
    // `contextrestored` is emitted, because a shader compile inside a frame
    // could throw where §61 forbids throwing; everything keyed by an
    // application object comes back on the next draw that asks for it, because
    // the caches cannot know which of them the next frame will use. Three
    // since 2026-09-11: the registered particle, effect, shadow and standard
    // pipelines are re-acquired lazily too (their own suites assert that).
    expect(gl.countOf("createProgram")).toBe(3);
    for (const allocator of RESOURCE_ALLOCATORS) {
      expect([allocator, gl.countOf(allocator)]).toEqual([allocator, 0]);
    }
  });

  it("re-uploads a texture edited while the context was lost at its new version", async () => {
    const { renderer, gl, canvas, camera } = await initialized();
    const { root, texture } = lossScene();
    const views = [createView(camera)];
    renderer.render(root, views);

    canvas.dispatch("webglcontextlost");
    // §77's `markDirty()` while there is no context to upload into: the record
    // that would have been invalidated is already gone, and the *next* upload
    // has to carry the new version or the frame after that re-uploads forever.
    texture.markDirty();
    canvas.dispatch("webglcontextrestored");
    gl.reset();
    renderer.render(root, views);
    const firstUploads = gl.countOf("texImage2D");
    gl.reset();
    renderer.render(root, views);

    expect(firstUploads).toBe(1);
    expect(gl.countOf("texImage2D")).toBe(0);
    // Both draws still happen: the mesh's indexed quad and the sprite's.
    expect(gl.countOf("drawElements")).toBe(2);
  });

  it("re-allocates a render target resized while the context was lost at its new size", async () => {
    const { renderer, gl, canvas, camera } = await initialized();
    const views = [createView(camera)];
    const target = new RenderTarget({ width: 8, height: 8 });
    renderer.render(createRoot(), views, undefined, target);

    canvas.dispatch("webglcontextlost");
    // Same argument as the texture above, one resource along: the record the
    // version bump would have invalidated is already gone, so the allocation
    // that comes back has to read the *current* size, not the cached one.
    target.resize(32, 16);
    canvas.dispatch("webglcontextrestored");
    gl.reset();
    renderer.render(createRoot(), views, undefined, target);

    expect(gl.countOf("createFramebuffer")).toBe(1);
    expect(gl.callsOf("texImage2D")[0]?.args.slice(3, 5)).toEqual([32, 16]);
    // The pass draws into the new surface, not the old one.
    expect(gl.callsOf("viewport")[0]?.args).toEqual([0, 0, 32, 16]);
  });

  it("keeps the F13 envelope when the context is lost mid-frame", async () => {
    const { renderer, gl, canvas, camera } = await initialized();
    const views = [createView(camera)];
    const material = new TestMaterial();
    // A loss that arrives *inside* a frame, at the one place an application's
    // own code runs during one: a material accessor. The browser cannot
    // deliver `webglcontextlost` here — DOM events do not interleave with a
    // synchronous call — but a renderer whose caches are emptied under it is
    // exactly the state a mid-frame loss produces, and the frame still has to
    // leave through its `finally`.
    Object.defineProperty(material, "transparent", {
      configurable: true,
      get(): boolean {
        canvas.dispatch("webglcontextlost");
        return false;
      },
    });
    const root = createRoot();
    root.add(renderable(quadGeometry(), material));
    gl.reset();

    expect(() => {
      renderer.render(root, views);
    }).not.toThrow();

    // The envelope closed: nothing left bound for whatever touches this
    // context next (§61 allows several renderers over one application).
    const names = gl.names();
    expect(names).toContain("bindVertexArray");
    const lastVertexArray = gl.callsOf("bindVertexArray").at(-1);
    expect(lastVertexArray?.args).toEqual([null]);
    expect(renderer.contextLost).toBe(true);

    // And the mirror survived it: after the restore this renderer draws the
    // frame a renderer that never lost its context draws.
    Object.defineProperty(material, "transparent", {
      configurable: true,
      value: false,
      writable: true,
    });
    canvas.dispatch("webglcontextrestored");
    gl.reset();
    renderer.render(root, views);
    const recovered = shapedTranscript(gl.calls);

    const reference = await initialized();
    const referenceRoot = createRoot();
    referenceRoot.add(renderable(quadGeometry(), new TestMaterial()));
    reference.gl.reset();
    reference.renderer.render(referenceRoot, [createView(reference.camera)]);

    expect(recovered).toEqual(shapedTranscript(reference.gl.calls));
  });

  it("brings the §70 effect pipeline back with the rest (R-6)", async () => {
    const { renderer, gl, canvas, camera } = await initialized();
    const source = new RenderTarget({ width: 8, height: 8 });
    const views = [createView(camera)];
    gl.reset();
    renderer.render(createRoot(), views, undefined, source);
    renderer.renderEffect(effectPass(source));
    const before = shapedTranscript(gl.calls);

    canvas.dispatch("webglcontextlost");
    canvas.dispatch("webglcontextrestored");
    gl.reset();
    renderer.render(createRoot(), views, undefined, source);
    renderer.renderEffect(effectPass(source));

    // The effect program is compiled by `initialize` and never lazily, so a
    // restore that forgot it would leave `renderEffect` a silent no-op — the
    // failure mode §70's pipeline is compiled eagerly to avoid. The off-screen
    // surface it samples comes back the same way every other target does: the
    // pass that asks for one allocates it.
    expect(gl.countOf("drawArrays")).toBe(1);
    expect(gl.countOf("createFramebuffer")).toBe(1);
    expect(shapedTranscript(gl.calls)).toEqual(before);
  });

  it("survives a second loss, and the second restore reuses nothing from the first", async () => {
    const { renderer, gl, canvas, camera } = await initialized();
    const { root } = lossScene();
    const views = [createView(camera)];
    const cycle: string[] = [];
    renderer.events.on("contextlost", () => cycle.push("lost"));
    renderer.events.on("contextrestored", () => cycle.push("restored"));

    canvas.dispatch("webglcontextlost");
    canvas.dispatch("webglcontextrestored");
    gl.reset();
    renderer.render(root, views);
    const first = shapedTranscript(gl.calls);
    const firstHandles = glHandles(gl.calls);

    canvas.dispatch("webglcontextlost");
    canvas.dispatch("webglcontextrestored");
    gl.reset();
    renderer.render(root, views);

    // A restore path that worked once and not twice is a real shape of this
    // bug: `webglcontextlost` can arrive again the moment after a restore, and
    // a browser tab that is losing its context is usually losing it repeatedly.
    expect(cycle).toEqual(["lost", "restored", "lost", "restored"]);
    expect(shapedTranscript(gl.calls)).toEqual(first);
    expect(
      [...glHandles(gl.calls)].filter((handle) => firstHandles.has(handle)),
    ).toEqual([]);
  });

  it("stays disposable while lost, deleting nothing and leaving no listener (§83)", async () => {
    const { renderer, gl, canvas, camera } = await initialized();
    const { root } = lossScene();
    renderer.render(root, [createView(camera)]);
    canvas.dispatch("webglcontextlost");
    gl.reset();

    renderer.dispose();

    expect(gl.calls).toEqual([]);
    expect(canvas.listenerCount("webglcontextlost")).toBe(0);
    expect(canvas.listenerCount("webglcontextrestored")).toBe(0);
    // A loss event delivered after disposal reaches nothing at all.
    expect(canvas.dispatch("webglcontextlost")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §68's light set (R-17, 2026-08-09).
//
// The claim is the two-sided one every uniform switch in this backend makes: a
// scene with point or spot lights gets them, and a scene with none costs the
// frame **nothing at all** — no count upload, no array upload. The second half
// is what keeps `FRAME_BEFORE_R13` and every pixel golden valid, and it is why
// the count is an `int` uniform mirrored on the CPU at GL's own initial `0`
// rather than a `#define` and a second linked program.
// ---------------------------------------------------------------------------

/** The light-set uniform handles of whichever program declares them. */
function punctualUniforms(gl: FakeGl, marker: string): Map<string, object> {
  for (const perProgram of gl.uniformsByProgram.values()) {
    if (perProgram.has(marker) && perProgram.has("punctualCount")) {
      return perProgram;
    }
  }
  throw new Error(`no program resolved ${marker} and the light set`);
}

/** One point light in slot 0, as `collectSceneLights` would have packed it. */
function oneLampSet(): ReturnType<typeof createSceneLights> {
  const lights = createSceneLights();
  lights.punctualCount = 1;
  lights.punctualPositions[0] = 1;
  lights.punctualPositions[1] = 2;
  lights.punctualPositions[2] = 3;
  lights.punctualColors[0] = 4;
  lights.punctualColors[1] = 5;
  lights.punctualColors[2] = 6;
  lights.punctualParams[0] = 12;
  return lights;
}

describe("PunctualLightUniforms — the light set (§68, R-17)", () => {
  it("declares the five uniforms in both shaded pipelines' fragment stages", () => {
    const builders = [
      (gl: FakeGl) => LitProgram.create(gl),
      (gl: FakeGl) => StandardProgram.create(gl),
    ];
    for (const create of builders) {
      const gl = createFakeGl();
      create(gl);
      const fragment = String(gl.callsOf("shaderSource")[1].args[1]);

      expect(fragment).toContain("uniform int punctualCount;");
      expect(fragment).toContain(
        `const int MAX_PUNCTUAL_LIGHTS = ${String(MAX_PUNCTUAL_LIGHTS)};`,
      );
      expect(fragment).toContain(
        "uniform vec3 punctualPosition[MAX_PUNCTUAL_LIGHTS];",
      );
      expect(fragment).toContain(
        "uniform vec4 punctualParams[MAX_PUNCTUAL_LIGHTS];",
      );
      // The loop is bounded by the *uniform*, which is what makes one linked
      // program shade zero through MAX lamps.
      expect(fragment).toContain("i < punctualCount");
    }
  });

  it("carries the world position the falloff needs into the lit fragment stage", () => {
    const gl = createFakeGl();
    LitProgram.create(gl);
    const [vertex, fragment] = gl
      .callsOf("shaderSource")
      .map((call) => String(call.args[1]));

    expect(vertex).toContain("out vec3 vWorldPosition;");
    // The clip-space product is left exactly as it was — a re-association
    // into `viewProjection * (model * position)` would move pixels.
    expect(vertex).toContain(
      "gl_Position = viewProjection * model * vec4(position, 1.0);",
    );
    expect(fragment).toContain("in vec3 vWorldPosition;");
  });

  it("uploads nothing when the frame has no hemisphere", () => {
    const gl = createFakeGl();
    const program = LitProgram.create(gl);
    program.use();
    gl.reset();

    program.setHemisphereLight(createSceneLights());
    expect(gl.calls).toHaveLength(0);
  });

  it("uploads sky, ground, up, and the use flag once a hemisphere exists", () => {
    const gl = createFakeGl();
    const program = LitProgram.create(gl);
    program.use();
    gl.reset();

    const lights = createSceneLights();
    lights.hasHemisphereLight = true;
    lights.hemisphereSky[0] = 0.6;
    lights.hemisphereSky[1] = 0.7;
    lights.hemisphereSky[2] = 1;
    lights.hemisphereGround[0] = 0.2;
    lights.hemisphereGround[1] = 0.1;
    lights.hemisphereGround[2] = 0.05;
    lights.hemisphereUp.set(0, 1, 0);
    program.setHemisphereLight(lights);

    const uniforms = punctualUniforms(gl, "ambientLight");
    expect(uploadsAt(gl, uniforms.get("hemisphereSky"))).toEqual([
      [Math.fround(0.6), Math.fround(0.7), 1],
    ]);
    expect(uploadsAt(gl, uniforms.get("hemisphereGround"))).toEqual([
      [Math.fround(0.2), Math.fround(0.1), Math.fround(0.05)],
    ]);
    expect(uploadsAt(gl, uniforms.get("hemisphereUp"))).toEqual([[0, 1, 0]]);
    expect(uploadsAt(gl, uniforms.get("useHemisphere"))).toEqual([1]);
  });

  it("uploads nothing when the frame has no point or spot light", () => {
    const gl = createFakeGl();
    const program = LitProgram.create(gl);
    program.use();
    gl.reset();

    program.setPunctualLights(createSceneLights());

    // Not the count, not the arrays: the CPU mirror starts where GL's own
    // `int` uniform starts, so there is nothing to say.
    expect(gl.calls).toHaveLength(0);
  });

  it("uploads the count and all four arrays once a light exists", () => {
    const gl = createFakeGl();
    const program = LitProgram.create(gl);
    program.use();
    gl.reset();

    program.setPunctualLights(oneLampSet());

    const uniforms = punctualUniforms(gl, "ambientLight");
    expect(uploadsAt(gl, uniforms.get("punctualCount"))).toEqual([1]);
    const positions = uploadsAt(
      gl,
      uniforms.get("punctualPosition[0]"),
    )[0] as number[];
    expect(positions).toHaveLength(MAX_PUNCTUAL_LIGHTS * 3);
    expect(positions.slice(0, 3)).toEqual([1, 2, 3]);
    expect(
      (uploadsAt(gl, uniforms.get("punctualColor[0]"))[0] as number[]).slice(
        0,
        3,
      ),
    ).toEqual([4, 5, 6]);
    expect(
      (uploadsAt(gl, uniforms.get("punctualParams[0]"))[0] as number[])[0],
    ).toBe(12);
    expect(uploadsAt(gl, uniforms.get("punctualDirection[0]"))).toHaveLength(1);
  });

  it("re-uploads the arrays every frame but the count only on change", () => {
    const gl = createFakeGl();
    const program = LitProgram.create(gl);
    program.use();
    const lights = oneLampSet();
    program.setPunctualLights(lights);
    gl.reset();

    // A lamp that moved: the arrays must go up again, the count must not.
    program.setPunctualLights(lights);
    expect(gl.countOf("uniform1i")).toBe(0);
    expect(gl.countOf("uniform3fv")).toBe(3);
    expect(gl.countOf("uniform4fv")).toBe(1);
  });

  it("puts the count back to zero when the last lamp leaves, and then goes quiet", () => {
    const gl = createFakeGl();
    const program = LitProgram.create(gl);
    program.use();
    program.setPunctualLights(oneLampSet());
    gl.reset();

    program.setPunctualLights(createSceneLights());
    const uniforms = punctualUniforms(gl, "ambientLight");
    // The count is corrected; the arrays are not uploaded, because nothing
    // reads them at count zero.
    expect(uploadsAt(gl, uniforms.get("punctualCount"))).toEqual([0]);
    expect(gl.countOf("uniform3fv")).toBe(0);
    expect(gl.countOf("uniform4fv")).toBe(0);

    gl.reset();
    program.setPunctualLights(createSceneLights());
    expect(gl.calls).toHaveLength(0);
  });

  it("is the same class, with the same behaviour, on the standard pipeline", () => {
    const gl = createFakeGl();
    const program = StandardProgram.create(gl);
    program.use();
    gl.reset();

    program.setPunctualLights(createSceneLights());
    expect(gl.calls).toHaveLength(0);

    program.setPunctualLights(oneLampSet());
    const uniforms = punctualUniforms(gl, "baseColor");
    expect(uploadsAt(gl, uniforms.get("punctualCount"))).toEqual([1]);
  });

  it("refuses to build when a driver cannot resolve the array names (§89)", () => {
    const gl = createFakeGl({ resolveUniforms: false });
    const error = thrown(() => {
      PunctualLightUniforms.resolve(gl, gl.createProgram()!, "lit");
    });
    expect(error.code).toBe("SHADER_COMPILATION_FAILED");
  });
});

// ---------------------------------------------------------------------------
// §69 — shadow maps (R-18, 2026-08-09).
// ---------------------------------------------------------------------------

/**
 * A directional light double that *casts* — {@link TestLight} plus the three
 * optional members `DirectionalLightSource` declares for §69.
 *
 * The matrix it hands back is a plain scale, not a real orthographic volume:
 * `@fourjs/scene` owns the derivation and tests it, and what this package has to
 * prove is that whatever matrix arrives is the one uploaded, unchanged.
 */
class TestShadowLight extends TestLight {
  castShadow = true;

  shadow = { mapSize: 8, bias: 0.002, normalBias: 0.03 };

  /** The value written by {@link TestShadowLight.computeShadowMatrix}. */
  readonly matrix = new Matrix4();

  /** How many times the collector asked for the matrix. */
  matrixReads = 0;

  constructor(mapSize = 8) {
    super();
    this.shadow.mapSize = mapSize;
    this.matrix.elements[0] = 2;
    this.matrix.elements[12] = 5;
  }

  computeShadowMatrix(out: Matrix4): Matrix4 {
    this.matrixReads += 1;
    return out.copy(this.matrix);
  }
}

/** The unskinned shadow program's uniform handles — see {@link spriteUniforms}. */
function shadowUniforms(gl: FakeGl): Map<string, object> {
  for (const perProgram of gl.uniformsByProgram.values()) {
    if (
      perProgram.has("shadowViewProjection") &&
      !perProgram.has("jointMatrices[0]")
    ) {
      return perProgram;
    }
  }
  throw new Error("the shadow program never resolved its uniforms");
}

/** The skinned caster's uniform handles — `shadowViewProjection` plus the palette. */
function skinnedShadowUniforms(gl: FakeGl): Map<string, object> {
  for (const perProgram of gl.uniformsByProgram.values()) {
    if (
      perProgram.has("shadowViewProjection") &&
      perProgram.has("jointMatrices[0]")
    ) {
      return perProgram;
    }
  }
  throw new Error("the skinned shadow program never resolved its uniforms");
}

/** Just the call names, for asserting the shape of a pass. */
function names(calls: readonly RecordedCall[]): string[] {
  return calls.map((call) => call.name);
}

describe("ShadowProgram — the §69 caster pipeline (R-18)", () => {
  it("compiles both stages, links, and resolves its two uniforms", () => {
    const gl = createFakeGl();

    const program = ShadowProgram.create(gl);

    expect(gl.countOf("createShader")).toBe(2);
    expect(gl.countOf("linkProgram")).toBe(1);
    expect(
      gl.callsOf("getUniformLocation").map((call) => call.args[1]),
    ).toEqual(["shadowViewProjection", "model"]);
    expect(program.disposed).toBe(false);
  });

  it("declares position only — no normal, no uv, no colour", () => {
    const gl = createFakeGl();

    ShadowProgram.create(gl);

    const sources = gl
      .callsOf("shaderSource")
      .map((call) => String(call.args[1]));
    expect(
      sources[0].includes(
        `layout(location = ${String(POSITION_ATTRIBUTE_LOCATION)}) in vec3 position;`,
      ),
    ).toBe(true);
    expect(sources[0]).not.toContain("in vec3 normal");
    expect(sources[0]).not.toContain("in vec2 uv");
    // The product association is the lit stage's, deliberately: the depth a
    // receiver computes and the depth the map holds must agree.
    expect(sources[0]).toContain(
      "gl_Position = shadowViewProjection * model * vec4(position, 1.0);",
    );
    // A defined colour write rather than an undeclared output.
    expect(sources[1]).toContain("fragColor = vec4(1.0);");
  });

  it("throws SHADER_COMPILATION_FAILED and cleans up exactly as the unlit program does", () => {
    const failing = createFakeGl({ compileStatus: false });
    expect(thrown(() => ShadowProgram.create(failing)).code).toBe(
      "SHADER_COMPILATION_FAILED",
    );
    expect(thrown(() => ShadowProgram.create(failing)).message).toContain(
      "shadow",
    );

    // A linked program whose uniforms cannot be resolved is deleted, never
    // returned half-built.
    const unresolvable = createFakeGl({ resolveUniforms: false });
    expect(thrown(() => ShadowProgram.create(unresolvable)).code).toBe(
      "SHADER_COMPILATION_FAILED",
    );
    expect(unresolvable.countOf("deleteProgram")).toBe(1);
  });

  it("uploads both matrices out of copied scratch and disposes idempotently", () => {
    const gl = createFakeGl();
    const program = ShadowProgram.create(gl);
    const uniforms = shadowUniforms(gl);
    gl.reset();

    program.use();
    const view = new Matrix4();
    view.elements[0] = 3;
    program.setViewProjection(view);
    const model = new Matrix4();
    model.elements[12] = 7;
    program.setModel(model);

    expect(names(gl.calls)).toEqual([
      "useProgram",
      "uniformMatrix4fv",
      "uniformMatrix4fv",
    ]);
    expect(gl.calls[1].args[0]).toBe(uniforms.get("shadowViewProjection"));
    expect((gl.calls[1].args[2] as Float32Array)[0]).toBe(3);
    expect(gl.calls[2].args[0]).toBe(uniforms.get("model"));
    expect((gl.calls[2].args[2] as Float32Array)[12]).toBe(7);

    gl.reset();
    program.dispose();
    program.dispose();
    expect(gl.countOf("deleteProgram")).toBe(1);
    expect(program.disposed).toBe(true);
  });
});

describe("ShadowUniforms — the receiver half (§69, R-18)", () => {
  it("uploads nothing at all when no light casts", () => {
    const gl = createFakeGl();
    const program = LitProgram.create(gl);
    const lights = createSceneLights();
    gl.reset();

    program.setShadow(lights);
    program.setReceivesShadow(false);

    // The byte-identity contract: `useShadow` mirrors GL's initial `false`, so
    // a shadowless frame's shaded pipeline is the one it was before §69.
    expect(gl.calls).toHaveLength(0);
  });

  it("uploads the sampler once, then the matrix and three scalars per view", () => {
    const gl = createFakeGl();
    const program = LitProgram.create(gl);
    const uniforms = litUniforms(gl);
    const lights = createSceneLights();
    lights.hasShadow = true;
    lights.shadowMatrix.elements[5] = 4;
    lights.shadowMapSize = 256;
    lights.shadowBias = 0.001;
    lights.shadowNormalBias = 0.05;
    gl.reset();

    program.setShadow(lights);
    program.setShadow(lights);

    expect(names(gl.calls)).toEqual([
      // The sampler unit, lazily and once.
      "uniform1i",
      "uniformMatrix4fv",
      "uniform1f",
      "uniform1f",
      "uniform1f",
      // Second view: everything but the sampler.
      "uniformMatrix4fv",
      "uniform1f",
      "uniform1f",
      "uniform1f",
    ]);
    expect(gl.calls[0].args).toEqual([
      uniforms.get("shadowMap"),
      SHADOW_TEXTURE_UNIT,
    ]);
    expect((gl.calls[1].args[2] as Float32Array)[5]).toBe(4);
    expect(gl.calls[2].args).toEqual([uniforms.get("shadowBias"), 0.001]);
    expect(gl.calls[3].args).toEqual([uniforms.get("shadowNormalBias"), 0.05]);
    // The tap offset: one reciprocal per frame, not one per fragment.
    expect(gl.calls[4].args).toEqual([
      uniforms.get("shadowTexelSize"),
      1 / 256,
    ]);
  });

  it("switches receiving per draw, and only on change", () => {
    const gl = createFakeGl();
    const program = LitProgram.create(gl);
    const uniforms = litUniforms(gl);
    gl.reset();

    program.setReceivesShadow(true);
    program.setReceivesShadow(true);
    program.setReceivesShadow(false);

    expect(gl.calls).toHaveLength(2);
    expect(gl.calls[0].args).toEqual([uniforms.get("useShadow"), 1]);
    expect(gl.calls[1].args).toEqual([uniforms.get("useShadow"), 0]);
  });

  it("is the same class for both shaded pipelines", () => {
    // Not "they behave alike" — one implementation, so the skip rule cannot
    // drift apart between them.
    const gl = createFakeGl();
    const program = StandardProgram.create(gl);
    const uniforms = standardUniforms(gl);
    gl.reset();

    program.setShadow(createSceneLights());
    expect(gl.calls).toHaveLength(0);

    program.setReceivesShadow(true);
    expect(gl.calls[0].args).toEqual([uniforms.get("useShadow"), 1]);
  });

  it("splices the receiver chunk into both shaded fragment stages", () => {
    const gl = createFakeGl();
    LitProgram.create(gl);
    const litFragment = String(gl.callsOf("shaderSource")[1].args[1]);
    gl.reset();
    StandardProgram.create(gl);
    const standardFragment = String(gl.callsOf("shaderSource")[1].args[1]);

    for (const source of [litFragment, standardFragment]) {
      expect(source).toContain(SHADOW_GLSL);
      // Outside the volume is lit, not shadowed.
      expect(source).toContain("return 1.0;");
    }
    // The shadow multiplies the *existing* directional product, in place —
    // the pixel half of byte-identity (see `ShadowUniforms`).
    expect(litFragment).toContain("vec3 direct = lightColor * diffuse;");
    expect(litFragment).toContain(
      "vec3 lighting = ambientLight + hemisphereAmbient(len, n) + direct;",
    );
    expect(standardFragment).toContain("shaded += direct;");
  });
});

describe("RenderTargetCache — samplable depth (§69, R-18)", () => {
  it("allocates a DEPTH_COMPONENT24 texture instead of a renderbuffer", () => {
    const gl = createFakeGl();
    const cache = new RenderTargetCache(gl);
    const target = new RenderTarget({
      width: 4,
      height: 4,
      depthTexture: true,
    });

    const record = cache.acquire(target);

    expect(record?.depthBuffer).toBeNull();
    expect(record?.depthTexture).not.toBeNull();
    expect(gl.countOf("createRenderbuffer")).toBe(0);
    const depthUpload = gl.callsOf("texImage2D")[1];
    expect(depthUpload.args[2]).toBe(GL.DEPTH_COMPONENT24);
    expect(depthUpload.args[6]).toBe(GL.DEPTH_COMPONENT);
    expect(depthUpload.args[7]).toBe(GL.UNSIGNED_INT);
    // Not filterable in GLES 3.0 — `LINEAR` would make the texture incomplete
    // and every receiver would read as fully occluded.
    const filters = gl
      .callsOf("texParameteri")
      .slice(4)
      .map((call) => call.args[2]);
    expect(filters).toEqual([
      GL.NEAREST,
      GL.NEAREST,
      GL.CLAMP_TO_EDGE,
      GL.CLAMP_TO_EDGE,
    ]);
    // Attached to the depth slot as a texture, not as a renderbuffer.
    const attach = gl.callsOf("framebufferTexture2D")[1];
    expect(attach.args[1]).toBe(GL.DEPTH_ATTACHMENT);
    expect(gl.countOf("framebufferRenderbuffer")).toBe(0);
  });

  it("deletes the depth texture with the rest of the record", () => {
    const gl = createFakeGl();
    const cache = new RenderTargetCache(gl);
    const target = new RenderTarget({
      width: 4,
      height: 4,
      depthTexture: true,
    });
    cache.acquire(target);
    gl.reset();

    cache.dispose();

    // Colour and depth, plus the framebuffer.
    expect(gl.countOf("deleteTexture")).toBe(2);
    expect(gl.countOf("deleteFramebuffer")).toBe(1);
    expect(gl.countOf("deleteRenderbuffer")).toBe(0);
  });

  it("frees the depth texture when the framebuffer will not allocate", () => {
    const gl = createFakeGl({ allocateFramebuffers: false });
    const cache = new RenderTargetCache(gl);

    expect(
      cache.acquire(
        new RenderTarget({ width: 4, height: 4, depthTexture: true }),
      ),
    ).toBeNull();
    expect(gl.countOf("deleteTexture")).toBe(2);
  });

  it("frees the colour texture when the depth texture will not allocate", () => {
    // `allocateTextures: false` fails the *first* texture, so the second
    // allocation is unreachable that way; a cache miss on the depth texture is
    // reached by failing every texture after the first.
    const gl = createFakeGl();
    const cache = new RenderTargetCache(gl);
    let created = 0;
    const realCreateTexture = gl.createTexture.bind(gl);
    gl.createTexture = (): object | null => {
      created += 1;
      return created > 1 ? null : realCreateTexture();
    };

    expect(
      cache.acquire(
        new RenderTarget({ width: 4, height: 4, depthTexture: true }),
      ),
    ).toBeNull();
    expect(gl.countOf("deleteTexture")).toBe(1);
  });

  it("deletes the depth texture when the framebuffer is incomplete", () => {
    const gl = createFakeGl({ framebufferStatus: 0x8cd6 });
    const cache = new RenderTargetCache(gl);

    expect(
      cache.acquire(
        new RenderTarget({ width: 4, height: 4, depthTexture: true }),
      ),
    ).toBeNull();
    expect(gl.countOf("deleteTexture")).toBe(2);
    expect(gl.countOf("deleteFramebuffer")).toBe(1);
  });
});

describe("WebglRenderer.render — the §69 shadow pass (R-18)", () => {
  /** A lit root under a casting light, plus the two doubles a test steers. */
  function shadowScene(mapSize = 8): {
    root: AmbientRoot;
    light: TestShadowLight;
    caster: Renderable;
    receiver: Renderable;
  } {
    const root = new AmbientRoot([0.1, 0.1, 0.1]);
    const light = new TestShadowLight(mapSize);
    const caster = litRenderable();
    const receiver = litRenderable();
    root.add(light, caster, receiver);
    return { root, light, caster, receiver };
  }

  it("issues no shadow call at all when nothing casts", async () => {
    const { renderer, gl, camera } = await initialized();
    const { root, light } = shadowScene();
    light.castShadow = false;
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // The byte-identity contract, at the frame level: no framebuffer, no
    // second texture unit, no `useShadow`.
    expect(gl.countOf("bindFramebuffer")).toBe(0);
    expect(gl.countOf("createFramebuffer")).toBe(0);
    expect(gl.countOf("activeTexture")).toBe(0);
    const useShadow = litUniforms(gl).get("useShadow");
    expect(uploadsAt(gl, useShadow)).toEqual([]);
  });

  it("renders the map, then binds it to unit 1 for the view loop", async () => {
    const { renderer, gl, camera } = await initialized();
    const { root, light } = shadowScene(16);
    const views = [createView(camera)];
    // One warm-up frame, so the framebuffer cache's own bind/unbind during
    // allocation is not confused with the pass's.
    renderer.render(root, views);
    gl.reset();

    renderer.render(root, views);

    const framebuffers = gl.callsOf("bindFramebuffer").map((c) => c.args[1]);
    // Into the map, back to the drawing buffer after the pass, and the
    // envelope's own unbind in the `finally` (F13 — the pass binds a
    // framebuffer on the on-screen path, so the frame owes an unbind whether
    // or not it also drew into a target).
    expect(framebuffers).toHaveLength(3);
    expect(framebuffers[0]).not.toBeNull();
    expect(framebuffers[1]).toBeNull();
    expect(framebuffers[2]).toBeNull();

    // The pass opens the scissor to the whole attachment before clearing:
    // `SCISSOR_TEST` is on for the renderer's lifetime, so a stale rectangle
    // would clear only part of the map.
    const scissor = gl.callsOf("scissor")[0];
    expect(scissor.args).toEqual([0, 0, 16, 16]);
    expect(gl.callsOf("viewport")[0].args).toEqual([0, 0, 16, 16]);
    // Depth only: the colour attachment is written and read by nothing.
    expect(gl.callsOf("clear")[0].args).toEqual([GL.DEPTH_BUFFER_BIT]);

    // The light's own matrix, unchanged.
    const shadowView = shadowUniforms(gl).get("shadowViewProjection");
    expect((uploadsAt(gl, shadowView)[0] as Float32Array)[0]).toBe(2);
    expect(light.matrixReads).toBe(2);

    // The map, on the unit the shaded stages sample from.
    const activeUnits = gl.callsOf("activeTexture").map((call) => call.args[0]);
    expect(activeUnits[0]).toBe(GL.TEXTURE0 + SHADOW_TEXTURE_UNIT);
    // …and released at the end of the frame, leaving unit 0 selected.
    expect(activeUnits[activeUnits.length - 1]).toBe(GL.TEXTURE0);
    const binds = gl.callsOf("bindTexture");
    expect(binds[binds.length - 1].args[1]).toBeNull();
  });

  it("draws every caster once, and skips the ones that opted out", async () => {
    const { renderer, gl, camera } = await initialized();
    const { root, caster, receiver } = shadowScene();
    receiver.castShadow = false;
    // A §55 quad never casts: a depth-only pass writes geometry, not alpha.
    root.add(sprite());
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // One model upload, one caster: the opted-out mesh and the sprite are both
    // out, and the two empty-geometry container nodes never had a draw.
    const shadowModel = shadowUniforms(gl).get("model");
    expect(uploadsAt(gl, shadowModel)).toHaveLength(1);
    expect(caster.castShadow).toBe(true);
  });

  it("switches the comparison off for a non-receiving draw only", async () => {
    const { renderer, gl, camera } = await initialized();
    const { root, receiver } = shadowScene();
    receiver.receiveShadow = false;
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // One draw receives, the next does not: on, then off — and nothing more,
    // because the uniform is mirrored.
    expect(uploadsAt(gl, litUniforms(gl).get("useShadow"))).toEqual([1, 0]);
  });

  it("re-uses one target, resizing it when the light's map size changes", async () => {
    const { renderer, gl, camera } = await initialized();
    const { root, light } = shadowScene(8);
    const views = [createView(camera)];
    renderer.render(root, views);
    gl.reset();

    // Same size: the framebuffer cache hands back the record it already has.
    renderer.render(root, views);
    expect(gl.countOf("createFramebuffer")).toBe(0);

    light.shadow.mapSize = 32;
    gl.reset();
    renderer.render(root, views);
    // A resize bumps the target's version, which is what re-allocates it —
    // and a *new* `RenderTarget` would have leaked the old one's §83 bytes.
    expect(gl.countOf("createFramebuffer")).toBe(1);
    expect(gl.callsOf("viewport")[0].args).toEqual([0, 0, 32, 32]);
  });

  it("skips the shadow, not the frame, when the framebuffer is incomplete", async () => {
    const { renderer, gl, camera } = await initialized({
      framebufferStatus: 0x8cd6,
    });
    const { root } = shadowScene();
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // §61: nothing throws inside a frame. The scene still draws, unshadowed.
    expect(gl.countOf("drawArrays") + gl.countOf("drawElements")).toBe(2);
    expect(uploadsAt(gl, litUniforms(gl).get("useShadow"))).toEqual([]);
  });

  it("counts caster draws in §84's statistics", async () => {
    const { renderer, gl, camera } = await initialized();
    const { root } = shadowScene();
    const statistics = createRenderStatistics();
    renderer.statistics = statistics;
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // Two casters drawn twice: once into the map, once on screen. A frame that
    // doubled its draw calls should say so.
    expect(statistics.drawCalls).toBe(4);
  });

  it("restores the off-screen target's framebuffer after the pass", async () => {
    const { renderer, gl, camera } = await initialized();
    const { root } = shadowScene();
    const target = new RenderTarget({ width: 16, height: 16 });
    gl.reset();

    renderer.render(root, [createView(camera)], undefined, target);

    const binds = gl.callsOf("bindFramebuffer").map((call) => call.args[1]);
    // Target, map, back to the target, and `null` at the end of the frame.
    expect(binds[0]).toBe(binds[2]);
    expect(binds[1]).not.toBe(binds[0]);
    expect(binds[binds.length - 1]).toBeNull();
  });

  it("disposes the target it created for itself (§83)", async () => {
    const { renderer, gl, camera } = await initialized();
    const { root } = shadowScene();
    renderer.render(root, [createView(camera)]);
    gl.reset();

    renderer.dispose();

    // Colour texture, depth texture, framebuffer — plus the caches' own.
    expect(gl.countOf("deleteFramebuffer")).toBe(1);
    expect(renderer.disposed).toBe(true);
    // Disposing twice must not subtract the target's §83 bytes twice.
    expect(() => {
      renderer.dispose();
    }).not.toThrow();
  });

  it("re-allocates the map after a context loss, from the same descriptor", async () => {
    const { renderer, gl, canvas, camera } = await initialized();
    const { root } = shadowScene();
    const views = [createView(camera)];
    renderer.render(root, views);

    canvas.dispatch("webglcontextlost");
    canvas.dispatch("webglcontextrestored");
    gl.reset();
    renderer.render(root, views);

    // The descriptor is CPU-side and survived; only the cache's handles died,
    // so the map is re-allocated (two binds inside `#allocate`) and then used
    // (bind, back to the drawing buffer, and the envelope's unbind).
    expect(gl.countOf("createFramebuffer")).toBe(1);
    expect(gl.countOf("bindFramebuffer")).toBe(5);
  });
});

describe("WebglRenderer.render — the caster pass across the surface kinds (R-18)", () => {
  it("draws indexed and non-indexed casters through the one pipeline", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = new AmbientRoot([0.1, 0.1, 0.1]);
    root.add(
      new TestShadowLight(8),
      // `litRenderable`'s geometry is non-indexed, `quadGeometry`'s is indexed:
      // one program draws every caster whatever shades it on screen, and both
      // draw entry points are reachable from it.
      litRenderable(),
      renderable(quadGeometry(), new TestMaterial()),
    );
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // Two casters into the map, the same two on screen.
    expect(gl.countOf("drawArrays")).toBe(2);
    expect(gl.countOf("drawElements")).toBe(2);
  });

  it("compares a §59 standard receiver against the map too", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = new AmbientRoot([0.1, 0.1, 0.1]);
    const receiver = standardRenderable();
    const opted = standardRenderable();
    opted.receiveShadow = false;
    root.add(new TestShadowLight(8), receiver, opted);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // Both shaded pipelines resolve the switch through the one `ShadowUniforms`
    // — on for the receiver, off for the node that opted out.
    expect(uploadsAt(gl, standardUniforms(gl).get("useShadow"))).toEqual([
      1, 0,
    ]);
  });
});

describe("WebglRenderer.render — the shadow pass inside the F13 envelope (R-18)", () => {
  it("unbinds the shadow framebuffer when an on-screen draw throws", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = new AmbientRoot([0.1, 0.1, 0.1]);
    // A casting light, a caster, and then a draw whose material accessor
    // raises — the F13 case, on the **on-screen** path, which before §69 could
    // not have a framebuffer bound at all.
    root.add(
      new TestShadowLight(8),
      litRenderable(),
      throwingRenderable(BORROWS_EVERYTHING),
    );
    gl.reset();

    expect(() => {
      renderer.render(root, [createView(camera)]);
    }).toThrow(/material accessor raised/);

    // The map really was bound, and the drawing buffer really was given back:
    // without this the next on-screen frame would render into the shadow map
    // and the canvas would simply stop updating, with no error to explain it.
    const binds = gl.callsOf("bindFramebuffer");
    expect(binds.some((call) => call.args[1] !== null)).toBe(true);
    expect(binds.at(-1)?.args[1]).toBeNull();
    expect(effectiveGlState(gl)).toEqual(RESTING_GL_STATE);
  });

  it("releases the shadow texture unit and leaves unit 0 selected on a throw", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = new AmbientRoot([0.1, 0.1, 0.1]);
    root.add(
      new TestShadowLight(8),
      litRenderable(),
      throwingRenderable(BORROWS_EVERYTHING),
    );
    gl.reset();

    expect(() => {
      renderer.render(root, [createView(camera)]);
    }).toThrow();

    const units = gl.callsOf("activeTexture").map((call) => call.args[0]);
    expect(units.at(-1)).toBe(GL.TEXTURE0);
    expect(gl.callsOf("bindTexture").at(-1)?.args[1]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §65 batching (R-9, 2026-08-09).
// ---------------------------------------------------------------------------

/**
 * A scene of `count` renderables over one material — the shape §65 batches, and
 * the shape §86's sprite and shape rows are written in.
 */
function batchableRoot(
  count: number,
  material: TestMaterial | TestSpriteMaterial = new TestMaterial(),
  geometry: () => TestGeometry = quadGeometry,
): Renderable {
  const root = createRoot();
  for (let i = 0; i < count; i += 1) {
    root.add(
      new Renderable(
        geometry().asGeometry,
        material.asMaterial as ItemMaterial,
      ),
    );
  }
  return root;
}

describe("WebglRenderer — §65 batching, opt-in (R-9)", () => {
  it("batches nothing by default: the field is null and the frame is unchanged", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = batchableRoot(3);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(renderer.batching).toBeNull();
    expect(gl.countOf("drawElements")).toBe(3);
    expect(gl.countOf("bufferSubData")).toBe(0);
  });

  it("merges a run of items sharing one material into one draw call", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.batching = createGlBatching();
    const root = batchableRoot(3);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // Three indexed quads: 18 indices, one draw, 32-bit indices.
    expect(gl.callsOf("drawElements")).toHaveLength(1);
    expect(gl.callsOf("drawElements")[0].args).toEqual([
      GL.TRIANGLES,
      18,
      GL.UNSIGNED_INT,
      0,
    ]);
  });

  it("uploads the merged streams and specifies the interleaved layout once", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.batching = createGlBatching();
    const root = batchableRoot(2);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // Two buffers and one vertex array for the whole batch path.
    expect(gl.countOf("createVertexArray")).toBe(1);
    const pointers = gl.callsOf("vertexAttribPointer");
    expect(pointers).toHaveLength(1);
    expect(pointers[0].args).toEqual([
      POSITION_ATTRIBUTE_LOCATION,
      3,
      GL.FLOAT,
      false,
      12,
      0,
    ]);
    // The first frame allocates the stores. An idle second frame whose
    // geometry versions and transforms have not moved skips the re-upload
    // (§65 / §86 change-detecting batch cache).
    gl.reset();
    renderer.render(root, [createView(camera)]);
    expect(gl.countOf("bufferData")).toBe(0);
    expect(gl.countOf("createVertexArray")).toBe(0);
    expect(gl.countOf("bufferSubData")).toBe(0);
  });

  it("skips batch re-upload while the source is idle, and uploads after a move", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.batching = createGlBatching();
    const root = createRoot();
    const material = new TestMaterial();
    const a = new Renderable(quadGeometry().asGeometry, material.asMaterial);
    const b = new Renderable(quadGeometry().asGeometry, material.asMaterial);
    root.add(a, b);
    renderer.render(root, [createView(camera)]);
    gl.reset();

    renderer.render(root, [createView(camera)]);
    expect(gl.countOf("bufferSubData")).toBe(0);
    expect(gl.countOf("drawElements")).toBe(1);

    b.transform.worldMatrix.fromArray([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 0, 0, 1,
    ]);
    gl.reset();
    renderer.render(root, [createView(camera)]);
    expect(gl.countOf("bufferSubData")).toBe(2);
  });

  it("uploads the identity model matrix, because positions arrive in world space", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.batching = createGlBatching();
    const root = createRoot();
    const material = new TestMaterial();
    const near = new Renderable(quadGeometry().asGeometry, material.asMaterial);
    const far = new Renderable(quadGeometry().asGeometry, material.asMaterial);
    // The §7 resolve pass lives in `@fourjs/scene`, which is not a dependency of
    // this package, so the world matrix is written the way every other test in
    // this file writes one.
    far.transform.worldMatrix.fromArray([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1,
    ]);
    root.add(near, far);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(modelUploads(gl)).toEqual([
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    ]);
    // …and the far quad's own translation is in the vertex stream instead.
    const vertices = gl.callsOf("bufferData")[0].args[1] as number[];
    expect(vertices.slice(12, 15)).toEqual([5, 0, 0]);
  });

  it("draws a sprite run through the unlit program with the tint as its colour", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.batching = createGlBatching();
    const material = new TestSpriteMaterial(new TestTexture(), [1, 0.5, 0, 1]);
    const root = createRoot();
    root.add(sprite(material), sprite(material));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    const uniforms = unlitUniforms(gl);
    expect(gl.countOf("drawElements")).toBe(1);
    expect(gl.callsOf("drawElements")[0].args[1]).toBe(12);
    expect(uploadsAt(gl, uniforms.get("color"))).toEqual([[1, 0.5, 0, 1]]);
    // Batched sprites already interleave authored uvs, so the sprite program
    // is never used — and it no longer even declares `quad`.
    expect(spriteUniforms(gl).has("quad")).toBe(false);
    expect(uploadsAt(gl, uniforms.get("useMap"))).toEqual([1]);
    expect(gl.countOf("bindTexture")).toBeGreaterThan(0);
  });

  it("skips a whole sprite run whose texture will not resolve, as the single-sprite path skips one", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.batching = createGlBatching();
    const texture = new TestTexture();
    const material = new TestSpriteMaterial(texture);
    const root = createRoot();
    root.add(sprite(material), sprite(material));
    texture.dispose();
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("drawElements")).toBe(0);
    expect(gl.countOf("drawArrays")).toBe(0);
  });

  it("keeps one vertex array per interleaved layout", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.batching = createGlBatching();
    const plain = new TestMaterial();
    const coloured = new TestMaterial();
    coloured.vertexColors = true;
    const root = createRoot();
    root.add(
      new Renderable(quadGeometry().asGeometry, plain.asMaterial),
      new Renderable(quadGeometry().asGeometry, plain.asMaterial),
      new Renderable(quadGeometry().asGeometry, coloured.asMaterial),
      new Renderable(quadGeometry().asGeometry, coloured.asMaterial),
    );
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("drawElements")).toBe(2);
    expect(gl.countOf("createVertexArray")).toBe(2);
    // Position-only, then position plus colour at stride 28.
    const pointers = gl.callsOf("vertexAttribPointer");
    expect(pointers.map((call) => call.args[0])).toEqual([
      POSITION_ATTRIBUTE_LOCATION,
      POSITION_ATTRIBUTE_LOCATION,
      COLOR_ATTRIBUTE_LOCATION,
    ]);
    expect(pointers[2].args).toEqual([
      COLOR_ATTRIBUTE_LOCATION,
      4,
      GL.FLOAT,
      false,
      28,
      12,
    ]);
    // A second frame reuses both arrays and re-specifies neither.
    gl.reset();
    renderer.render(root, [createView(camera)]);
    expect(gl.countOf("createVertexArray")).toBe(0);
    expect(gl.countOf("vertexAttribPointer")).toBe(0);
  });

  it("points a textured layout's uv attribute past the position stream", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.batching = createGlBatching();
    const material = new TestMaterial();
    material.map = new TestTexture().asTexture;
    const root = createRoot();
    root.add(
      new Renderable(uvTriangleGeometry().asGeometry, material.asMaterial),
      new Renderable(uvTriangleGeometry().asGeometry, material.asMaterial),
    );
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.callsOf("vertexAttribPointer")[1].args).toEqual([
      UV_ATTRIBUTE_LOCATION,
      2,
      GL.FLOAT,
      false,
      20,
      12,
    ]);
  });

  it("counts one draw call and the same triangles §84 counted before (§65 diagnostics)", async () => {
    const { renderer, gl, camera } = await initialized();
    const statistics = createRenderStatistics();
    renderer.statistics = statistics;
    const root = batchableRoot(4);
    gl.reset();

    renderer.render(root, [createView(camera)]);
    const unbatched = {
      drawCalls: statistics.drawCalls,
      triangles: statistics.triangles,
    };

    resetRenderStatistics(statistics);
    renderer.batching = createGlBatching();
    renderer.render(root, [createView(camera)]);

    expect(unbatched).toEqual({ drawCalls: 4, triangles: 8 });
    expect(statistics.drawCalls).toBe(1);
    expect(statistics.triangles).toBe(8);
    expect(statistics.instances).toBe(1);
  });

  it("leaves an unbatchable item on exactly the path it was on", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.batching = createGlBatching();
    const shared = new TestMaterial();
    const alone = new TestMaterial();
    const root = createRoot();
    root.add(
      new Renderable(quadGeometry().asGeometry, shared.asMaterial),
      new Renderable(quadGeometry().asGeometry, shared.asMaterial),
      new Renderable(triangleGeometry().asGeometry, alone.asMaterial),
    );
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // One merged `drawElements` plus the lone triangle's own `drawArrays`.
    expect(gl.countOf("drawElements")).toBe(1);
    expect(gl.countOf("drawArrays")).toBe(1);
  });

  it("splits a run at the configured vertex cap", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.batching = createGlBatching({ maxVertices: 8 });
    const root = batchableRoot(4);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("drawElements")).toBe(2);
  });

  it("draws the same batch into every view of the frame", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.batching = createGlBatching();
    const root = batchableRoot(2);
    gl.reset();

    renderer.render(root, [
      createView(camera, { id: "left", width: 0.5 }),
      createView(camera, { id: "right", x: 0.5, width: 0.5 }),
    ]);

    expect(gl.countOf("drawElements")).toBe(2);
  });

  it("merges across a masked-out item, because the view never draws it", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.batching = createGlBatching();
    const material = new TestMaterial();
    const root = createRoot();
    const hidden = new Renderable(
      quadGeometry().asGeometry,
      material.asMaterial,
    );
    hidden.layers = 2;
    root.add(
      new Renderable(quadGeometry().asGeometry, material.asMaterial),
      hidden,
      new Renderable(quadGeometry().asGeometry, material.asMaterial),
    );
    gl.reset();

    renderer.render(root, [createView(camera, { layerMask: 1 })]);

    // One draw, not two — and the change is R-8's, recorded here because it is
    // the only observable behaviour difference the per-view list produced.
    //
    // Before R-8 the backend tested each item's mask inside the draw loop and
    // handed the batcher the **frame's** list, where a masked-out item sits
    // between the two survivors and ends the run (`RenderBatcher.next` stops at
    // it, deliberately: it is an item the scan cannot merge across because a
    // later view might draw it). The backend now hands the batcher a list
    // `buildViewRenderList` has already reduced to what *this* view draws, so
    // the two survivors are adjacent and merge — which is exactly as correct,
    // because the hidden item is not submitted into this view at all and the
    // merged draws are consecutive in the only order that exists here.
    //
    // `RenderBatcher.next` keeps its mask parameter for a caller that batches
    // over an unfiltered list; the renderer no longer passes one.
    expect(gl.countOf("drawElements")).toBe(1);
  });

  it("drops its GL objects on context loss and rebuilds them on the next frame", async () => {
    const { renderer, gl, canvas, camera } = await initialized();
    renderer.batching = createGlBatching();
    const root = batchableRoot(2);
    renderer.render(root, [createView(camera)]);
    gl.reset();

    canvas.dispatch("webglcontextlost");

    expect(gl.countOf("deleteBuffer")).toBe(0);
    expect(gl.countOf("deleteVertexArray")).toBe(0);

    canvas.dispatch("webglcontextrestored");
    gl.reset();
    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("createVertexArray")).toBe(1);
    expect(gl.countOf("drawElements")).toBe(1);
  });

  it("deletes its GL objects on dispose, and tolerates never having drawn", async () => {
    const drawn = await initialized();
    drawn.renderer.batching = createGlBatching();
    drawn.renderer.render(batchableRoot(2), [createView(drawn.camera)]);
    drawn.gl.reset();
    drawn.renderer.dispose();

    expect(drawn.gl.countOf("deleteVertexArray")).toBeGreaterThan(0);
    expect(drawn.gl.countOf("deleteBuffer")).toBeGreaterThan(0);

    const untouched = await initialized();
    untouched.renderer.batching = createGlBatching();
    untouched.gl.reset();

    expect(() => {
      untouched.renderer.dispose();
    }).not.toThrow();
  });

  it("skips the batch rather than throwing when GL will not allocate", async () => {
    const { renderer, gl, camera } = await initialized({
      allocateVertexArrays: false,
    });
    renderer.batching = createGlBatching();
    gl.reset();

    expect(() => {
      renderer.render(batchableRoot(2), [createView(camera)]);
    }).not.toThrow();
    expect(gl.countOf("drawElements")).toBe(0);
  });

  it("switches back to the unlit program when a batch follows another pipeline", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.batching = createGlBatching();
    const material = new TestMaterial();
    const root = createRoot();
    root.add(
      new Renderable(
        quadGeometry().asGeometry,
        new TestLitMaterial().asMaterial,
      ),
      new Renderable(quadGeometry().asGeometry, material.asMaterial),
      new Renderable(quadGeometry().asGeometry, material.asMaterial),
    );
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // The frame starts on the unlit program, the lit draw takes its own, and
    // the batch takes the unlit one back — three `useProgram` calls, the last
    // of them the batch's.
    expect(gl.countOf("useProgram")).toBe(3);
    expect(gl.countOf("drawElements")).toBe(2);
  });

  it("batches a run of line geometries, counting no triangles (§84)", async () => {
    const { renderer, gl, camera } = await initialized();
    const statistics = createRenderStatistics();
    renderer.statistics = statistics;
    renderer.batching = createGlBatching();
    const material = new TestMaterial();
    const lines = (): TestGeometry =>
      new TestGeometry(
        new Float32Array([0, 0, 0, 1, 0, 0]),
        undefined,
        "lines",
      );
    const root = createRoot();
    root.add(
      new Renderable(lines().asGeometry, material.asMaterial),
      new Renderable(lines().asGeometry, material.asMaterial),
    );
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.callsOf("drawElements")[0].args).toEqual([
      GL.LINES,
      4,
      GL.UNSIGNED_INT,
      0,
    ]);
    expect(statistics.drawCalls).toBe(1);
    expect(statistics.triangles).toBe(0);
  });

  it("does not leak the survivor when only one of the two buffers is allocated", () => {
    let created = 0;
    const deleted: unknown[] = [];
    // Only two entry points are reached: the buffers are acquired before
    // anything else, and a half-built pair returns before the vertex array,
    // the uploads, or the draw.
    const failing = {
      createBuffer: () => {
        created += 1;
        return created === 1 ? { kind: "buffer" } : null;
      },
      deleteBuffer: (buffer: unknown) => {
        deleted.push(buffer);
      },
    } as unknown as BatchGlContext;

    expect(() => {
      createGlBatching().draw(
        failing,
        {} as unknown as UnlitProgram,
        {} as unknown as RenderBatch,
        false,
      );
    }).not.toThrow();
    expect(created).toBe(2);
    expect(deleted).toEqual([{ kind: "buffer" }]);

    // The mirror image: the vertex buffer fails and the index buffer is the one
    // handed back.
    created = 0;
    deleted.length = 0;
    const other = {
      createBuffer: () => {
        created += 1;
        return created === 1 ? null : { kind: "index" };
      },
      deleteBuffer: (buffer: unknown) => {
        deleted.push(buffer);
      },
    } as unknown as BatchGlContext;
    createGlBatching().draw(
      other,
      {} as unknown as UnlitProgram,
      {} as unknown as RenderBatch,
      false,
    );

    expect(deleted).toEqual([{ kind: "index" }]);
  });
});

/**
 * A `TestGeometry` that can state its bounds (§53, §87; R-8).
 *
 * `TestGeometry` deliberately does **not** have `computeBounds`, and that is
 * what keeps every other case in this file on the "cannot be bounded, therefore
 * drawn" path — the shape `computeWorldBoundingSphere`'s probe exists for, and
 * the evidence that a geometry double written before §87 still draws. This
 * subclass opts a single suite in, so culling is exercised against a real
 * bounding box without moving one existing assertion.
 */
class BoundedTestGeometry extends TestGeometry {
  readonly #min = new Vector3(-0.5, -0.5, 0);

  readonly #max = new Vector3(0.5, 0.5, 0);

  constructor() {
    super(
      new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0]),
      new Uint16Array([0, 1, 2]),
    );
  }

  /** §53's cached local box, as `BufferGeometry` returns it. */
  computeBounds(): { readonly min: Vector3; readonly max: Vector3 } {
    return { min: this.#min, max: this.#max };
  }
}

/**
 * A bounded unit quad at `(x, 0, 0)` in world space.
 *
 * The world matrix is written directly, as every other positioned double in
 * this file does: `resolveWorldTransforms` lives in `@fourjs/scene`, which is
 * outside this package's dependency matrix (plan §3.1, frozen).
 */
function boundedAt(x: number, material = new TestMaterial()): Renderable {
  const node = new Renderable(
    new BoundedTestGeometry().asGeometry,
    material.asMaterial,
  );
  node.transform.worldMatrix.elements[12] = x;
  return node;
}

describe("WebglRenderer.render — §87 per-view frustum culling (R-8)", () => {
  it("draws what the view can see and drops what it cannot", async () => {
    // `TestCamera`'s projection and view are both the identity, so its frustum
    // is the NDC cube: `x ∈ [-1, 1]`. A quad at `x = 5` is wholly outside it.
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(boundedAt(0), boundedAt(5));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("drawElements")).toBe(1);
  });

  it("keeps a quad that only straddles a plane", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    // Centre one unit outside the right plane; the sphere's radius is
    // `√2 / 2 ≈ 0.707`, so it does not reach in — but at `x = 1.5` it does.
    root.add(boundedAt(1.5));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("drawElements")).toBe(1);
  });

  it("honours §49's frustumCulled = false on the node", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const pinned = boundedAt(5);
    pinned.frustumCulled = false;
    root.add(boundedAt(0), pinned);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("drawElements")).toBe(2);
  });

  it("draws a geometry that cannot state its bounds, wherever it is", async () => {
    // The compatibility claim, as a frame: a `TestGeometry` at `x = 5` is off
    // screen and still submitted, because a missing `computeBounds` reads as
    // "cannot be culled" rather than as a `TypeError` inside a frame (§61).
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const node = renderable(quadGeometry());
    node.transform.worldMatrix.elements[12] = 5;
    root.add(node);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("drawElements")).toBe(1);
  });

  it("culls per view: two cameras of one frame disagree", async () => {
    // The property R-8 exists for. One frame list; the left camera sees the
    // left quad only, the right camera the right quad only, so the frame issues
    // two draws where a shared list filtered by nothing would have issued four.
    const { renderer, gl } = await initialized();
    const root = createRoot();
    root.add(boundedAt(-5), boundedAt(5));
    const left = new TestCamera();
    left.viewMatrix.elements[12] = 5;
    const right = new TestCamera();
    right.viewMatrix.elements[12] = -5;
    gl.reset();

    renderer.render(root, [
      createView(left, { id: "left", width: 0.5 }),
      createView(right, { id: "right", x: 0.5, width: 0.5 }),
    ]);

    expect(gl.countOf("drawElements")).toBe(2);
  });

  it("keeps a caster in the shadow map that no view can see (§69, §46)", async () => {
    // R-18's argument, now load-bearing rather than merely recorded: the
    // shadow pass consumes the **frame's** list before the view loop, so a
    // caster outside every view still occludes. Had the pass been moved onto a
    // view's list, this would be one depth draw instead of two — and a shadow
    // would appear and disappear as its caster left the screen.
    const { renderer, gl, camera } = await initialized();
    const root = new AmbientRoot([0.1, 0.1, 0.1]);
    const light = new TestShadowLight();
    const onScreen = new Renderable(
      new BoundedTestGeometry().asGeometry,
      new TestLitMaterial().asMaterial,
    );
    const offScreen = new Renderable(
      new BoundedTestGeometry().asGeometry,
      new TestLitMaterial().asMaterial,
    );
    offScreen.transform.worldMatrix.elements[12] = 5;
    root.add(light, onScreen, offScreen);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // Two casters into the depth-only map, one survivor into the colour pass.
    expect(gl.countOf("drawElements")).toBe(3);
  });

  it("draws an on-screen item into every view that can see it", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(boundedAt(0));
    gl.reset();

    renderer.render(root, [
      createView(camera, { id: "left", width: 0.5 }),
      createView(camera, { id: "right", x: 0.5, width: 0.5 }),
    ]);

    expect(gl.countOf("drawElements")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §67's stencil state (R-7, 2026-08-11).
//
// The two-sided claim every state switch in this backend makes, once more: a
// material that declares `stencil` gets it, applied group by group and only
// where a group moved, and a material that declares none costs the frame
// **nothing at all** — no enable, no func, no mask, not even a restore. The
// second half is what keeps every recorded transcript and every pixel golden
// valid, and it is why the mirror is seeded at GL's own initial values rather
// than at "unknown".
// ---------------------------------------------------------------------------

/** The frame's stencil calls, as `[name, ...args]`, in call order. */
function stencilCalls(gl: FakeGl): unknown[][] {
  return gl.calls
    .filter(
      (call) =>
        call.name.startsWith("stencil") ||
        ((call.name === "enable" || call.name === "disable") &&
          call.args[0] === GL.STENCIL_TEST),
    )
    .map((call) => [call.name, ...call.args]);
}

describe("WebglRenderer.render — §57's stencil state (§67, R-7)", () => {
  it("costs a frame nothing when no material declares one", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(stateful({ depthTest: false }));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // Depth state moved, so this frame is not trivially call-free — and it
    // still contains not one stencil call.
    expect(toggles(gl)).toEqual([
      ["disable", GL.DEPTH_TEST],
      ["enable", GL.DEPTH_TEST],
    ]);
    expect(stencilCalls(gl)).toEqual([]);
    expect(gl.countOf("stencilFunc")).toBe(0);
    expect(gl.countOf("stencilOp")).toBe(0);
    expect(gl.countOf("stencilMask")).toBe(0);
  });

  it("enables the test and nothing more for a record that names GL's defaults", async () => {
    // The `{}` record is the reachability proof for every `??` in
    // `applyStencilState`: a structurally-typed material may carry a partial
    // record, and a missing field has to mean the documented default rather
    // than `undefined` reaching a GL entry point.
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(stateful({ stencil: {} }));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(stencilCalls(gl)).toEqual([
      ["enable", GL.STENCIL_TEST],
      ["disable", GL.STENCIL_TEST],
    ]);
  });

  it("maps every field onto its GL entry point", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(
      stateful({
        stencil: {
          func: "equal",
          ref: 2,
          readMask: 0b0011,
          writeMask: 0b1100,
          failOp: "zero",
          depthFailOp: "invert",
          passOp: "replace",
        },
      }),
    );
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(stencilCalls(gl)).toEqual([
      ["enable", GL.STENCIL_TEST],
      ["stencilFunc", GL.EQUAL, 2, 0b0011],
      ["stencilOp", GL.ZERO, GL.INVERT, GL.REPLACE],
      ["stencilMask", 0b1100],
      // The frame's exit envelope: the test off, and the write mask reopened
      // so the next frame's clear is not masked by it.
      ["disable", GL.STENCIL_TEST],
      ["stencilMask", 0xff],
    ]);
    const names = gl.names();
    expect(names.indexOf("stencilFunc")).toBeLessThan(
      names.indexOf("drawArrays"),
    );
    expect(names.lastIndexOf("stencilMask")).toBeGreaterThan(
      names.indexOf("drawArrays"),
    );
  });

  it("translates all eight comparisons and all eight operations", async () => {
    const funcs = [
      ["never", GL.NEVER],
      ["less", GL.LESS],
      ["equal", GL.EQUAL],
      ["lequal", GL.LEQUAL],
      ["greater", GL.GREATER],
      ["notequal", GL.NOTEQUAL],
      ["gequal", GL.GEQUAL],
      ["always", GL.ALWAYS],
    ] as const;
    const ops = [
      ["keep", GL.KEEP],
      ["zero", GL.ZERO],
      ["replace", GL.REPLACE],
      ["increment", GL.INCR],
      ["increment-wrap", GL.INCR_WRAP],
      ["decrement", GL.DECR],
      ["decrement-wrap", GL.DECR_WRAP],
      ["invert", GL.INVERT],
    ] as const;

    for (const [name, expected] of funcs) {
      const { renderer, gl, camera } = await initialized();
      const root = createRoot();
      // `ref: 1` so even `always` differs from the mirror and issues its call.
      root.add(stateful({ stencil: { func: name, ref: 1 } }));
      gl.reset();
      renderer.render(root, [createView(camera)]);
      expect(gl.callsOf("stencilFunc")[0].args).toEqual([expected, 1, 0xff]);
    }
    for (const [name, expected] of ops) {
      const { renderer, gl, camera } = await initialized();
      const root = createRoot();
      root.add(stateful({ stencil: { failOp: name, passOp: name } }));
      gl.reset();
      renderer.render(root, [createView(camera)]);
      if (name === "keep") {
        // Already the mirror's value: no call, which is the point of mirroring.
        expect(gl.countOf("stencilOp")).toBe(0);
        continue;
      }
      expect(gl.callsOf("stencilOp")[0].args).toEqual([
        expected,
        GL.KEEP,
        expected,
      ]);
    }
  });

  it("re-issues only the group that moved between two stencil materials", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    // The §67 composition: write the mask, then test against it. The two agree
    // on the operations only after the second pass restores them, so what this
    // asserts is that the *func* group and the *mask* group move on their own.
    root.add(
      stateful({ stencil: { func: "always", ref: 1, passOp: "replace" } }),
    );
    root.add(stateful({ stencil: { func: "equal", ref: 1, writeMask: 0 } }));
    root.add(stateful({ stencil: { func: "equal", ref: 1, writeMask: 0 } }));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(stencilCalls(gl)).toEqual([
      ["enable", GL.STENCIL_TEST],
      ["stencilFunc", GL.ALWAYS, 1, 0xff],
      ["stencilOp", GL.KEEP, GL.KEEP, GL.REPLACE],
      ["stencilFunc", GL.EQUAL, 1, 0xff],
      ["stencilOp", GL.KEEP, GL.KEEP, GL.KEEP],
      ["stencilMask", 0],
      // The third item is identical to the second: not one call.
      ["disable", GL.STENCIL_TEST],
      ["stencilMask", 0xff],
    ]);
  });

  it("turns the test off with one call, leaving the rest where it was", async () => {
    // With `STENCIL_TEST` disabled GL performs no stencil test and no stencil
    // write, so returning to "no stencil" is one `disable` — the func and op
    // state is deliberately not restored call by call.
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(stateful({ stencil: { func: "equal", ref: 4 } }));
    root.add(stateful({}));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(stencilCalls(gl)).toEqual([
      ["enable", GL.STENCIL_TEST],
      ["stencilFunc", GL.EQUAL, 4, 0xff],
      ["disable", GL.STENCIL_TEST],
    ]);
  });

  it("reopens the write mask before the next view clears", async () => {
    // `clear` is masked by the stencil write mask whether or not the test is
    // enabled, so a view following a read-only mask material would clear
    // nothing at all. Two views make the restore visible inside one frame.
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(stateful({ stencil: { func: "equal", ref: 1, writeMask: 0 } }));
    gl.reset();

    renderer.render(root, [createView(camera), createView(camera)]);

    const names = gl.names();
    const firstClear = names.indexOf("clear");
    const closed = names.indexOf("stencilMask");
    const secondClear = names.indexOf("clear", firstClear + 1);
    expect(closed).toBeGreaterThan(firstClear);
    expect(closed).toBeLessThan(secondClear);
    expect(gl.callsOf("stencilMask").map((call) => call.args[0])).toEqual([
      0, 0xff, 0, 0xff,
    ]);
  });

  it("clears the stencil buffer only when the surface has one (§33, §61)", async () => {
    // A stencil buffer that is never cleared is a mask leaking from one frame
    // into the next. A renderer that did not ask for one issues the identical
    // `clear` it always did — which is the byte-identity half of the clause.
    const plain = await initialized();
    plain.gl.reset();
    plain.renderer.render(createRoot(), [createView(plain.camera)]);
    for (const call of plain.gl.callsOf("clear")) {
      expect(Number(call.args[0]) & GL.STENCIL_BUFFER_BIT).toBe(0);
    }

    const gl = createFakeGl();
    const renderer = new WebglRenderer();
    await renderer.initialize({ canvas: new TestCanvas(gl), stencil: true });
    gl.reset();
    renderer.render(createRoot(), [createView(new TestCamera())]);
    const clears = gl.callsOf("clear");
    expect(clears.length).toBeGreaterThan(0);
    for (const call of clears) {
      expect(Number(call.args[0]) & GL.STENCIL_BUFFER_BIT).toBe(
        GL.STENCIL_BUFFER_BIT,
      );
    }
  });

  it("asks the context for the buffer only when told to", async () => {
    const off = createFakeGl();
    const offCanvas = new TestCanvas(off);
    await new WebglRenderer().initialize({ canvas: offCanvas });
    expect(offCanvas.attributes[0]?.stencil).toBe(false);

    const on = createFakeGl();
    const onCanvas = new TestCanvas(on);
    await new WebglRenderer().initialize({ canvas: onCanvas, stencil: true });
    expect(onCanvas.attributes[0]?.stencil).toBe(true);
  });
});

describe("RenderTargetCache — the packed stencil attachment (§67, R-7)", () => {
  it("allocates DEPTH24_STENCIL8 on the combined attachment point", () => {
    const gl = createFakeGl();
    const cache = new RenderTargetCache(gl);
    const target = new RenderTarget({ width: 4, height: 4, stencil: true });

    const record = cache.acquire(target);

    expect(record?.stencil).toBe(true);
    expect(record?.depthBuffer).not.toBeNull();
    // One renderbuffer, not two: the packed format *is* both buffers, which is
    // what makes the exclusion with R-18's depth texture structural.
    expect(gl.countOf("createRenderbuffer")).toBe(1);
    expect(gl.callsOf("renderbufferStorage")[0].args[1]).toBe(
      GL.DEPTH24_STENCIL8,
    );
    expect(gl.callsOf("framebufferRenderbuffer")[0].args[1]).toBe(
      GL.DEPTH_STENCIL_ATTACHMENT,
    );
  });

  it("leaves a target that asked for no stencil exactly as it was", () => {
    const gl = createFakeGl();
    const cache = new RenderTargetCache(gl);

    const record = cache.acquire(new RenderTarget({ width: 4, height: 4 }));

    expect(record?.stencil).toBe(false);
    expect(gl.callsOf("renderbufferStorage")[0].args[1]).toBe(
      GL.DEPTH_COMPONENT16,
    );
    expect(gl.callsOf("framebufferRenderbuffer")[0].args[1]).toBe(
      GL.DEPTH_ATTACHMENT,
    );
  });
});

// ---------------------------------------------------------------------------
// §67's engine-composed clips (R-23, 2026-08-28).
//
// The render list composes the records (`@fourjs/render`'s `clip.ts` — mask
// draws first, one shared test per subtree); what this backend owes them is
// three things, and this block pins each: a mask pass draws colourlessly,
// depthlessly, writing exactly its bit plane; a clipped draw's record replaces
// the material's own §57 stencil; and a scene that names no clip reaches
// `applyMaterialState` with `null` and issues the GL sequence it always did —
// which the whole rest of this file is the recorded proof of.
// ---------------------------------------------------------------------------

describe("WebglRenderer.render — §67 clips (R-23)", () => {
  /** A harness whose drawing buffer actually has the stencil bits (R-7). */
  async function initializedWithStencil(): Promise<Harness> {
    const gl = createFakeGl();
    const canvas = new TestCanvas(gl);
    const renderer = new WebglRenderer();
    await renderer.initialize({ canvas, stencil: true });
    return { gl, canvas, renderer, camera: new TestCamera() };
  }

  /** A clipping panel with one child, over plain unlit materials. */
  function clippedScene(): Renderable {
    const root = createRoot();
    const panel = renderable(triangleGeometry());
    panel.clip = true;
    panel.add(renderable(triangleGeometry()));
    root.add(panel);
    return root;
  }

  it("draws the mask first: stencil write on its plane, colour and depth off", async () => {
    const { renderer, gl, camera } = await initializedWithStencil();
    const root = clippedScene();
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(stencilCalls(gl)).toEqual([
      // The mask draw: always/replace onto plane 0, write mask = its bit.
      ["enable", GL.STENCIL_TEST],
      ["stencilFunc", GL.ALWAYS, 0b1, 0xff],
      ["stencilOp", GL.KEEP, GL.KEEP, GL.REPLACE],
      ["stencilMask", 0b1],
      // The panel's own draw is not clipped by its own clip: test off.
      ["disable", GL.STENCIL_TEST],
      // The child: read-only equality test over the accumulated bits.
      ["enable", GL.STENCIL_TEST],
      ["stencilFunc", GL.EQUAL, 0b1, 0b1],
      ["stencilOp", GL.KEEP, GL.KEEP, GL.KEEP],
      ["stencilMask", 0],
      // The frame's exit envelope (R-7): the test off, the write mask open so
      // the next clear is not masked by the child's read-only state.
      ["disable", GL.STENCIL_TEST],
      ["stencilMask", 0xff],
    ]);
    // The mask contributes no pixels and no depth: colour and depth writes and
    // the depth test go off for it and come back for the panel's own draw.
    expect(gl.callsOf("colorMask").map((call) => call.args)).toEqual([
      [false, false, false, false],
      [true, true, true, true],
    ]);
    expect(gl.callsOf("depthMask").map((call) => call.args[0])).toEqual([
      false,
      true,
    ]);
    // Three draws: the mask, the panel, the child — the mask is a real draw.
    expect(gl.countOf("drawArrays")).toBe(3);
  });

  it("clears the stencil buffer with every view, so no mask leaks a frame", async () => {
    const { renderer, gl, camera } = await initializedWithStencil();
    const root = clippedScene();
    gl.reset();

    renderer.render(root, [createView(camera)]);
    const clears = gl.callsOf("clear");
    expect(clears).toHaveLength(1);
    expect(Number(clears[0].args[0]) & GL.STENCIL_BUFFER_BIT).toBe(
      GL.STENCIL_BUFFER_BIT,
    );
  });

  it("lets the engine's record outrank the material's own §57 stencil", async () => {
    const { renderer, gl, camera } = await initializedWithStencil();
    const root = createRoot();
    const panel = renderable(triangleGeometry());
    panel.clip = true;
    // The child's material composes a mask by hand (R-7's tier) — and it is
    // *inside* an engine-composed clip, so the engine's containment wins.
    const child = stateful({
      stencil: { func: "notequal", ref: 7, writeMask: 0xf0 },
    });
    panel.add(child);
    root.add(panel);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    const funcs = gl.callsOf("stencilFunc").map((call) => call.args);
    // Mask write, then the engine's equality test — never NOTEQUAL/7.
    expect(funcs).toEqual([
      [GL.ALWAYS, 0b1, 0xff],
      [GL.EQUAL, 0b1, 0b1],
    ]);
  });

  it("warns once, in a development build, for a clip with no stencil buffer", async () => {
    resetDevWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // The default surface: no stencil bits (R-7's context attribute).
      const { renderer, gl, camera } = await initialized();
      const root = clippedScene();
      gl.reset();

      renderer.render(root, [createView(camera)]);
      renderer.render(root, [createView(camera)]);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain("§67");
      expect(warn.mock.calls[0]?.[0]).toContain("stencil: true");
      // The defined behaviour is fail-toward-drawing: the draws still happen —
      // mask included, though the buffer it writes does not exist — and GL
      // treats every test as passing.
      expect(gl.countOf("drawArrays")).toBe(6);
    } finally {
      warn.mockRestore();
      resetDevWarnings();
    }
  });

  it("does not warn for a clipless frame on a stencil-less surface", async () => {
    resetDevWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { renderer, gl, camera } = await initialized();
      const root = createRoot();
      root.add(renderable(triangleGeometry()));
      gl.reset();

      renderer.render(root, [createView(camera)]);
      renderer.render(root, [createView(camera)]);

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      resetDevWarnings();
    }
  });
});

// ---------------------------------------------------------------------------
// §54's skinned pipelines (RFC 0003 — gaps PH-10 + R-22).
// ---------------------------------------------------------------------------

/**
 * A `Skeleton` reduced to what the backend's render list and draw path read
 * (§54): the bone count, the palette, and `update` — a double for the reason
 * every scene-side object here is one (`@fourjs/scene` is outside the frozen
 * dependency matrix). The palette starts at per-joint identities and a test
 * writes recognisable values into it directly.
 */
class TestSkeleton {
  readonly bones: readonly null[];

  readonly jointMatrices: Float32Array;

  updates = 0;

  constructor(count = 1) {
    this.bones = new Array<null>(count).fill(null);
    this.jointMatrices = new Float32Array(count * 16);
    for (let i = 0; i < count; i += 1) {
      const base = i * 16;
      this.jointMatrices[base] = 1;
      this.jointMatrices[base + 5] = 1;
      this.jointMatrices[base + 10] = 1;
      this.jointMatrices[base + 15] = 1;
    }
  }

  update(): void {
    this.updates += 1;
  }
}

/** A drawable carrying §54's skin surface — `Mesh`, structurally. */
class SkinnedTestNode extends Renderable {
  skeleton: TestSkeleton | null = null;
}

/** A triangle carrying §53's full skin layout. */
function skinnedGeometry(): TestGeometry {
  const geometry = triangleGeometry();
  geometry.joints = new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  geometry.weights = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  return geometry;
}

/** A root holding one skinned drawable over `material`. */
function skinnedScene(
  material: TestMaterial | TestLitMaterial = new TestMaterial(),
  skeleton = new TestSkeleton(),
): { root: Renderable; node: SkinnedTestNode; skeleton: TestSkeleton } {
  const root = createRoot();
  const node = new SkinnedTestNode(
    skinnedGeometry().asGeometry,
    material.asMaterial,
  );
  node.skeleton = skeleton;
  root.add(node);
  return { root, node, skeleton };
}

/** The per-program uniform maps that resolved `jointMatrices[0]`. */
function skinnedUniformMaps(gl: FakeGl): Map<string, object>[] {
  const maps: Map<string, object>[] = [];
  for (const perProgram of gl.uniformsByProgram.values()) {
    if (perProgram.has("jointMatrices[0]")) {
      maps.push(perProgram);
    }
  }
  return maps;
}

/** The skinned-unlit program's uniforms (declares `useVertexColors`). */
function skinnedUnlitUniforms(gl: FakeGl): Map<string, object> {
  for (const map of skinnedUniformMaps(gl)) {
    if (map.has("useVertexColors")) {
      return map;
    }
  }
  throw new Error("the skinned-unlit program never resolved its uniforms");
}

/** The skinned-lit program's uniforms (declares `ambientLight`). */
function skinnedLitUniforms(gl: FakeGl): Map<string, object> {
  for (const map of skinnedUniformMaps(gl)) {
    if (map.has("ambientLight")) {
      return map;
    }
  }
  throw new Error("the skinned-lit program never resolved its uniforms");
}

describe("registerSkinningPipeline — the registry slot (RFC 0003)", () => {
  beforeEach(() => {
    clearRegisteredSkinningPipeline();
  });

  it("starts empty, fills on registration, and clears for tests", () => {
    expect(resolveSkinningPipelineFactory()).toBeNull();
    registerSkinningPipeline();
    const factory = resolveSkinningPipelineFactory();
    expect(factory).not.toBeNull();
    // Idempotent: registering again installs an equivalent factory.
    registerSkinningPipeline();
    expect(resolveSkinningPipelineFactory()).not.toBeNull();
    clearRegisteredSkinningPipeline();
    expect(resolveSkinningPipelineFactory()).toBeNull();
  });

  it("compiles both programs through the factory, paired for disposal", () => {
    registerSkinningPipeline();
    const gl = createFakeGl();
    const programs = resolveSkinningPipelineFactory()?.create(gl);
    expect(programs).toBeDefined();
    // Both linked; the registry interface is satisfied by the real classes.
    expect(gl.countOf("linkProgram")).toBe(2);
    programs?.dispose();
    expect(gl.countOf("deleteProgram")).toBe(2);
    // Idempotent per program.
    programs?.dispose();
    expect(gl.countOf("deleteProgram")).toBe(2);
  });

  it("disposes the unlit half when the lit half fails to compile", () => {
    registerSkinningPipeline();
    const gl = createFakeGl({ failProgramAt: 2 });
    expect(() => resolveSkinningPipelineFactory()?.create(gl)).toThrow();
    // The first program was built and must not leak (§83).
    expect(gl.countOf("deleteProgram")).toBe(1);
  });

  it("compiles the skinned caster lazily on acquireShadow, not with the colour pair", () => {
    registerSkinningPipeline();
    const gl = createFakeGl();
    const programs = resolveSkinningPipelineFactory()?.create(gl);
    expect(programs).toBeDefined();
    expect(gl.countOf("linkProgram")).toBe(2);
    const shadow = programs?.acquireShadow();
    expect(shadow).toBeDefined();
    expect(gl.countOf("linkProgram")).toBe(3);
    // Reuse: a second ask compiles nothing.
    expect(programs?.acquireShadow()).toBe(shadow);
    expect(gl.countOf("linkProgram")).toBe(3);
    programs?.dispose();
    expect(gl.countOf("deleteProgram")).toBe(3);
  });

  it("does not retry a failed skinned-caster compile (failProgramAt would otherwise succeed)", () => {
    registerSkinningPipeline();
    // Colour pair occupies 1 and 2; the caster is 3.
    const gl = createFakeGl({ failProgramAt: 3 });
    const programs = resolveSkinningPipelineFactory()?.create(gl);
    expect(programs).toBeDefined();
    expect(() => programs?.acquireShadow()).toThrow();
    // `createProgram` returned null — there is no program object to delete.
    // A retry must not issue a fourth createProgram that would miss the latch.
    expect(gl.countOf("deleteProgram")).toBe(0);
    expect(() => programs?.acquireShadow()).toThrow();
    expect(gl.countOf("createProgram")).toBe(3);
    programs?.dispose();
    // Colour pair only — the caster never landed.
    expect(gl.countOf("deleteProgram")).toBe(2);
  });
});

describe("SkinnedUnlitProgram / SkinnedLitProgram (RFC 0003)", () => {
  it("uploads the palette verbatim and mirrors its feature switches", () => {
    const gl = createFakeGl();
    const program = SkinnedUnlitProgram.create(gl);
    program.use();
    const palette = new Float32Array(32);
    palette[0] = 7;
    palette[17] = 9;
    program.setJointMatrices(palette);
    const location = skinnedUnlitUniforms(gl).get("jointMatrices[0]");
    const uploads = uploadsAt(gl, location);
    expect(uploads).toHaveLength(1);
    expect((uploads[0] as number[])[0]).toBe(7);
    expect((uploads[0] as number[])[17]).toBe(9);

    // The mirror-at-GL-initial rule, inherited from the unlit program: both
    // features off uploads nothing; a change uploads once.
    const before = gl.countOf("uniform1i");
    program.setFeatures(false, false);
    expect(gl.countOf("uniform1i")).toBe(before);
    program.setFeatures(true, true);
    program.setFeatures(true, true);
    // map sampler + useMap + useVertexColors, each exactly once.
    expect(gl.countOf("uniform1i")).toBe(before + 3);
    expect(program.disposed).toBe(false);
    program.dispose();
    expect(program.disposed).toBe(true);
    program.dispose();
    expect(gl.countOf("deleteProgram")).toBe(1);
  });

  it("carries the lit contract: lights, shadow state, colour, palette", () => {
    const gl = createFakeGl();
    const program = SkinnedLitProgram.create(gl);
    program.use();
    program.setViewProjection(new Matrix4());
    program.setModel(new Matrix4());
    program.setColor([1, 0.5, 0.25, 1], 0.5);
    program.setAmbientLight([0.1, 0.2, 0.3]);
    program.setDirectionalLight(new Vector3(0, -1, 0), [1, 1, 1]);
    const lights = createSceneLights();
    program.setPunctualLights(lights);
    program.setShadow(lights);
    program.setReceivesShadow(false); // mirrored at GL's initial false
    const uniformCalls = gl.countOf("uniform1i");
    program.setReceivesShadow(true);
    expect(gl.countOf("uniform1i")).toBe(uniformCalls + 1);
    const colorUpload = uploadsAt(
      gl,
      skinnedLitUniforms(gl).get("color"),
    )[0] as number[];
    expect(colorUpload).toEqual([1, 0.5, 0.25, 0.5]);
    program.setFeatures(true);
    program.setFeatures(true);
    program.setJointMatrices(new Float32Array(16));
    program.dispose();
    program.dispose();
    expect(gl.countOf("deleteProgram")).toBe(1);
  });

  it("cleans up when its own uniforms are missing from the link (§89)", () => {
    const gl = createFakeGl({ resolveUniforms: false });
    expect(() => SkinnedUnlitProgram.create(gl)).toThrow();
    expect(() => SkinnedLitProgram.create(gl)).toThrow();
    expect(() => SkinnedShadowProgram.create(gl)).toThrow();
    expect(gl.countOf("deleteProgram")).toBe(3);
  });
});

describe("SkinnedShadowProgram — the §69 skinned caster (RFC 0003 residue)", () => {
  it("skins position before the light's clip product and writes the depth-only constant", () => {
    const gl = createFakeGl();

    const program = SkinnedShadowProgram.create(gl);

    expect(
      gl.callsOf("getUniformLocation").map((call) => call.args[1]),
    ).toEqual(["shadowViewProjection", "model", "jointMatrices[0]"]);
    const sources = gl
      .callsOf("shaderSource")
      .map((call) => String(call.args[1]));
    expect(sources[0]).toContain(SKINNING_GLSL);
    expect(sources[0]).toContain(
      "gl_Position = shadowViewProjection * model * (skinMatrix() * vec4(position, 1.0));",
    );
    expect(sources[1]).toContain("fragColor = vec4(1.0);");
    expect(program.disposed).toBe(false);
    program.dispose();
    program.dispose();
    expect(gl.countOf("deleteProgram")).toBe(1);
    expect(program.disposed).toBe(true);
  });

  it("uploads the light matrix, the caster model, and the palette", () => {
    const gl = createFakeGl();
    const program = SkinnedShadowProgram.create(gl);
    const uniforms = skinnedShadowUniforms(gl);
    gl.reset();

    program.use();
    const view = new Matrix4();
    view.elements[0] = 3;
    program.setViewProjection(view);
    const model = new Matrix4();
    model.elements[12] = 7;
    program.setModel(model);
    const palette = new Float32Array(16);
    palette[13] = 5;
    program.setJointMatrices(palette);

    expect(names(gl.calls)).toEqual([
      "useProgram",
      "uniformMatrix4fv",
      "uniformMatrix4fv",
      "uniformMatrix4fv",
    ]);
    expect((gl.calls[1].args[2] as Float32Array)[0]).toBe(3);
    expect(gl.calls[2].args[0]).toBe(uniforms.get("model"));
    expect((gl.calls[2].args[2] as Float32Array)[12]).toBe(7);
    expect(gl.calls[3].args[0]).toBe(uniforms.get("jointMatrices[0]"));
    expect((gl.calls[3].args[2] as number[])[13]).toBe(5);
  });
});

describe("GeometryCache — the joint and weight streams (§53, §54)", () => {
  it("uploads joints and weights at locations 4 and 5, and deletes them", () => {
    const gl = createFakeGl();
    const cache = new GeometryCache(gl);
    const geometry = skinnedGeometry();
    const record = cache.acquire(geometry.asGeometry);
    expect(record?.jointBuffer).not.toBeNull();
    expect(record?.weightBuffer).not.toBeNull();

    const pointers = gl.callsOf("vertexAttribPointer");
    const joints = pointers.find(
      (call) => call.args[0] === JOINTS_ATTRIBUTE_LOCATION,
    );
    const weights = pointers.find(
      (call) => call.args[0] === WEIGHTS_ATTRIBUTE_LOCATION,
    );
    // Non-normalized UNSIGNED_SHORT floats — see JOINTS_ATTRIBUTE_LOCATION.
    expect(joints?.args.slice(1)).toEqual([4, GL.UNSIGNED_SHORT, false, 0, 0]);
    expect(weights?.args.slice(1)).toEqual([4, GL.FLOAT, false, 0, 0]);

    geometry.dispose();
    cache.acquire(geometry.asGeometry);
    // position + joints + weights buffers all deleted with the stale record.
    expect(gl.countOf("deleteBuffer")).toBe(3);
  });

  it("uploads neither stream for a geometry that carries none", () => {
    const gl = createFakeGl();
    const cache = new GeometryCache(gl);
    cache.acquire(triangleGeometry().asGeometry);
    const locations = gl
      .callsOf("enableVertexAttribArray")
      .map((call) => call.args[0]);
    expect(locations).not.toContain(JOINTS_ATTRIBUTE_LOCATION);
    expect(locations).not.toContain(WEIGHTS_ATTRIBUTE_LOCATION);
  });

  it("abandons a half-allocated skinned upload without leaking (§83)", () => {
    // Buffers: 1 position, 2 joints, 3 weights — fail the third.
    const gl = createFakeGl();
    let created = 0;
    const original = gl.createBuffer.bind(gl);
    gl.createBuffer = () => {
      created += 1;
      return created === 3 ? null : original();
    };
    const cache = new GeometryCache(gl);
    expect(cache.acquire(skinnedGeometry().asGeometry)).toBeNull();
    // The two live buffers and the vertex array are unwound.
    expect(gl.countOf("deleteBuffer")).toBe(2);
    expect(gl.countOf("deleteVertexArray")).toBe(1);
  });
});

describe("WebglRenderer.render — skinned draws (§54, §62; RFC 0003)", () => {
  beforeEach(() => {
    resetDevWarnings();
    clearRegisteredSkinningPipeline();
  });

  it("reports the declared joint limit as a §62 capability", async () => {
    const { renderer } = await initialized();
    expect(renderer.capabilities.maximumSkinningJoints).toBe(48);
  });

  it("skips skinned draws with one warning when nothing is registered", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { renderer, gl, camera } = await initialized();
      const { root } = skinnedScene();
      gl.reset();

      renderer.render(root, [createView(camera)]);
      renderer.render(root, [createView(camera)]);

      // No draw, no compile — and the warning names the fix, once.
      expect(gl.countOf("drawArrays")).toBe(0);
      expect(gl.countOf("createProgram")).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain(
        "registerSkinningPipeline",
      );
    } finally {
      warn.mockRestore();
      resetDevWarnings();
    }
  });

  it("keeps a skinless frame's transcript byte-identical under registration", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(triangleGeometry()));
    const views = [createView(camera)];
    renderer.render(root, views);
    gl.reset();
    renderer.render(root, views);
    const before = JSON.stringify(gl.calls);

    registerSkinningPipeline();
    try {
      gl.reset();
      renderer.render(root, views);
      expect(JSON.stringify(gl.calls)).toBe(before);
    } finally {
      clearRegisteredSkinningPipeline();
    }
  });

  it("compiles lazily on the first skinned draw, once, and draws through it", async () => {
    registerSkinningPipeline();
    const { renderer, gl, camera } = await initialized();
    const { root, skeleton } = skinnedScene();
    skeleton.jointMatrices[13] = 5;
    const views = [createView(camera)];
    // Three programs at initialize (2026-09-11), none skinned.
    expect(gl.countOf("createProgram")).toBe(3);
    gl.reset();

    renderer.render(root, views);

    // Two more programs, compiled inside the frame — the first skinned colour
    // draw. No third program: this scene has no lights, so the skinned caster
    // stays uncompiled.
    expect(gl.countOf("createProgram")).toBe(2);
    // The render list ran the palette update in the same build (the
    // particle-repack precedent), and the draw uploaded the palette verbatim.
    expect(skeleton.updates).toBe(1);
    const palette = uploadsAt(
      gl,
      skinnedUnlitUniforms(gl).get("jointMatrices[0]"),
    );
    expect(palette).toHaveLength(1);
    expect((palette[0] as number[])[13]).toBe(5);
    expect(gl.countOf("drawArrays")).toBe(1);

    // The second frame reuses the compiled pair.
    gl.reset();
    renderer.render(root, views);
    expect(gl.countOf("createProgram")).toBe(0);
    expect(gl.countOf("drawArrays")).toBe(1);
  });

  it("shades a skinned-lit draw with the frame's lights", async () => {
    registerSkinningPipeline();
    const { renderer, gl, camera } = await initialized();
    const root = new AmbientRoot([0.2, 0.3, 0.4]);
    const node = new SkinnedTestNode(
      skinnedGeometry().asGeometry,
      new TestLitMaterial([1, 0, 0, 1]).asMaterial,
    );
    node.skeleton = new TestSkeleton(2);
    root.add(node);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    const uniforms = skinnedLitUniforms(gl);
    const ambient = uploadsAt(gl, uniforms.get("ambientLight"))[0] as number[];
    // Uploaded through a Float32Array scratch, so compare at f32 precision.
    expect(ambient.map((v) => Math.fround(v))).toEqual(
      [0.2, 0.3, 0.4].map((v) => Math.fround(v)),
    );
    expect(uploadsAt(gl, uniforms.get("jointMatrices[0]"))).toHaveLength(1);
    expect(gl.countOf("drawArrays")).toBe(1);
  });

  it("latches a compile failure: one warning, no draw, no retry", async () => {
    registerSkinningPipeline();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // Program 4 is the first skinned compile (3 at initialize).
      const { renderer, gl, camera } = await initialized({ failProgramAt: 4 });
      const { root } = skinnedScene();
      const views = [createView(camera)];
      gl.reset();

      renderer.render(root, views);
      renderer.render(root, views);

      // Asked once, refused once, never asked again (§61: no throw escaped).
      expect(gl.countOf("createProgram")).toBe(1);
      expect(gl.countOf("drawArrays")).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("failed to compile");
    } finally {
      warn.mockRestore();
      resetDevWarnings();
    }
  });

  it("drops the pair on context loss and recompiles lazily after restore", async () => {
    registerSkinningPipeline();
    const { renderer, gl, canvas, camera } = await initialized();
    const { root } = skinnedScene();
    const views = [createView(camera)];
    renderer.render(root, views);

    canvas.dispatch("webglcontextlost");
    gl.reset();
    canvas.dispatch("webglcontextrestored");
    // The restore rebuilds the three eager programs only — the skinned pair
    // waits for the next skinned draw.
    expect(gl.countOf("createProgram")).toBe(3);

    gl.reset();
    renderer.render(root, views);
    expect(gl.countOf("createProgram")).toBe(2);
    expect(gl.countOf("drawArrays")).toBe(1);
  });

  it("disposes the compiled pair with the renderer (§83)", async () => {
    registerSkinningPipeline();
    const { renderer, gl, camera } = await initialized();
    const { root } = skinnedScene();
    renderer.render(root, [createView(camera)]);
    gl.reset();

    renderer.dispose();

    // Three eager programs plus the skinned colour pair. This scene has no
    // shadow light, so neither caster was ever compiled — 5, not 7.
    expect(gl.countOf("deleteProgram")).toBe(5);
  });

  it("casts a skinned mesh's deformed silhouette in the §69 shadow pass", async () => {
    registerSkinningPipeline();
    const { renderer, gl, camera } = await initialized();
    const root = new AmbientRoot([0.1, 0.1, 0.1]);
    const light = new TestShadowLight(8);
    const caster = litRenderable();
    const skinned = new SkinnedTestNode(
      skinnedGeometry().asGeometry,
      new TestLitMaterial().asMaterial,
    );
    const skeleton = new TestSkeleton();
    skeleton.jointMatrices[13] = 5;
    skinned.skeleton = skeleton;
    const skinnedAgain = new SkinnedTestNode(
      skinnedGeometry().asGeometry,
      new TestLitMaterial().asMaterial,
    );
    skinnedAgain.skeleton = skeleton;
    root.add(light, caster, skinned, skinnedAgain);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // The registered §69 caster (1, first — the shadow pass runs before the
    // view loop), the colour pair (2) and the skinned caster (1), all
    // compiled inside the frame because this scene both skins and casts.
    expect(gl.countOf("createProgram")).toBe(4);
    // Two casters: unskinned ShadowProgram, then the skinned sibling.
    expect(uploadsAt(gl, shadowUniforms(gl).get("model"))).toHaveLength(1);
    const casterUniforms = skinnedShadowUniforms(gl);
    expect(uploadsAt(gl, casterUniforms.get("model"))).toHaveLength(2);
    const shadowPalette = uploadsAt(gl, casterUniforms.get("jointMatrices[0]"));
    expect(shadowPalette).toHaveLength(2);
    expect((shadowPalette[0] as number[])[13]).toBe(5);
    // The skinned colour draws still happened, on their own program.
    expect(
      uploadsAt(gl, skinnedLitUniforms(gl).get("jointMatrices[0]")),
    ).toHaveLength(2);
  });

  it("skips skinned casters when nothing is registered (bind-pose guard)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { renderer, gl, camera } = await initialized();
      const root = new AmbientRoot([0.1, 0.1, 0.1]);
      const light = new TestShadowLight(8);
      const caster = litRenderable();
      const skinned = new SkinnedTestNode(
        skinnedGeometry().asGeometry,
        new TestLitMaterial().asMaterial,
      );
      skinned.skeleton = new TestSkeleton();
      root.add(light, caster, skinned);
      gl.reset();

      renderer.render(root, [createView(camera)]);

      // Unskinned caster only — a bind-pose shadow is a different picture.
      // The one program is the registered §69 caster itself (2026-09-11).
      expect(uploadsAt(gl, shadowUniforms(gl).get("model"))).toHaveLength(1);
      expect(gl.countOf("createProgram")).toBe(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain(
        "registerSkinningPipeline",
      );
    } finally {
      warn.mockRestore();
      resetDevWarnings();
    }
  });

  it("does not draw a skinned mesh with castShadow: false in the shadow pass", async () => {
    registerSkinningPipeline();
    const { renderer, gl, camera } = await initialized();
    const root = new AmbientRoot([0.1, 0.1, 0.1]);
    const light = new TestShadowLight(8);
    const caster = litRenderable();
    const skinned = new SkinnedTestNode(
      skinnedGeometry().asGeometry,
      new TestLitMaterial().asMaterial,
    );
    skinned.skeleton = new TestSkeleton();
    skinned.castShadow = false;
    root.add(light, caster, skinned);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // The §69 caster plus the colour pair — opting out of casting must not
    // compile the skinned caster.
    expect(gl.countOf("createProgram")).toBe(3);
    expect(uploadsAt(gl, shadowUniforms(gl).get("model"))).toHaveLength(1);
    expect(() => skinnedShadowUniforms(gl)).toThrow(
      /skinned shadow program never resolved/,
    );
    expect(
      uploadsAt(gl, skinnedLitUniforms(gl).get("jointMatrices[0]")),
    ).toHaveLength(1);
  });

  it("switches back to ShadowProgram after a skinned caster", async () => {
    registerSkinningPipeline();
    const { renderer, gl, camera } = await initialized();
    const root = new AmbientRoot([0.1, 0.1, 0.1]);
    const light = new TestShadowLight(8);
    const first = litRenderable();
    const skinned = new SkinnedTestNode(
      skinnedGeometry().asGeometry,
      new TestLitMaterial().asMaterial,
    );
    skinned.skeleton = new TestSkeleton();
    const last = litRenderable();
    root.add(light, first, skinned, last);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(uploadsAt(gl, shadowUniforms(gl).get("model"))).toHaveLength(2);
    expect(uploadsAt(gl, skinnedShadowUniforms(gl).get("model"))).toHaveLength(
      1,
    );
  });

  it("skips skinned casters when the caster program fails to compile, and still shades", async () => {
    registerSkinningPipeline();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // 3 at initialize; the registered §69 caster is 4; the colour pair is
      // 5–6 (the shadow pass compiles them first); the skinned caster is 7.
      const { renderer, gl, camera } = await initialized({
        failProgramAt: 7,
      });
      const root = new AmbientRoot([0.1, 0.1, 0.1]);
      const light = new TestShadowLight(8);
      const caster = litRenderable();
      const skinned = new SkinnedTestNode(
        skinnedGeometry().asGeometry,
        new TestLitMaterial().asMaterial,
      );
      skinned.skeleton = new TestSkeleton();
      root.add(light, caster, skinned);
      const views = [createView(camera)];
      gl.reset();

      renderer.render(root, views);
      renderer.render(root, views);

      // Asked once, refused once, never asked again. The §69 caster and the
      // colour pair compiled.
      expect(gl.countOf("createProgram")).toBe(4);
      expect(uploadsAt(gl, shadowUniforms(gl).get("model"))).toHaveLength(2);
      expect(() => skinnedShadowUniforms(gl)).toThrow(
        /skinned shadow program never resolved/,
      );
      expect(
        uploadsAt(gl, skinnedLitUniforms(gl).get("jointMatrices[0]")),
      ).toHaveLength(2);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("skinned shadow");
    } finally {
      warn.mockRestore();
      resetDevWarnings();
    }
  });

  it("draws an indexed skinned caster through drawElements", async () => {
    registerSkinningPipeline();
    const { renderer, gl, camera } = await initialized();
    const root = new AmbientRoot([0.1, 0.1, 0.1]);
    const light = new TestShadowLight(8);
    const geometry = quadGeometry();
    geometry.joints = new Uint16Array(16);
    geometry.weights = new Float32Array(16);
    for (let i = 0; i < 4; i += 1) {
      geometry.weights[i * 4] = 1;
    }
    const skinned = new SkinnedTestNode(
      geometry.asGeometry,
      new TestLitMaterial().asMaterial,
    );
    skinned.skeleton = new TestSkeleton();
    root.add(light, skinned);
    const statistics = createRenderStatistics();
    renderer.statistics = statistics;
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // Shadow pass + colour pass, both indexed.
    expect(gl.countOf("drawElements")).toBe(2);
    expect(
      uploadsAt(gl, skinnedShadowUniforms(gl).get("jointMatrices[0]")),
    ).toHaveLength(1);
    // Two submissions: the caster and the colour draw.
    expect(statistics.drawCalls).toBe(2);
  });

  it("disposes the colour pair and the caster together when both compiled", async () => {
    registerSkinningPipeline();
    const { renderer, gl, camera } = await initialized();
    const root = new AmbientRoot([0.1, 0.1, 0.1]);
    const light = new TestShadowLight(8);
    const skinned = new SkinnedTestNode(
      skinnedGeometry().asGeometry,
      new TestLitMaterial().asMaterial,
    );
    skinned.skeleton = new TestSkeleton();
    root.add(light, skinned);
    renderer.render(root, [createView(camera)]);
    gl.reset();

    renderer.dispose();

    // Three eager + the §69 caster + colour pair + skinned caster.
    expect(gl.countOf("deleteProgram")).toBe(7);
  });

  it("casts a skinned-unlit mesh through the same caster program", async () => {
    registerSkinningPipeline();
    const { renderer, gl, camera } = await initialized();
    const root = new AmbientRoot([0.1, 0.1, 0.1]);
    const light = new TestShadowLight(8);
    const caster = litRenderable();
    const skinned = new SkinnedTestNode(
      skinnedGeometry().asGeometry,
      new TestMaterial().asMaterial,
    );
    skinned.skeleton = new TestSkeleton();
    root.add(light, caster, skinned);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(uploadsAt(gl, shadowUniforms(gl).get("model"))).toHaveLength(1);
    expect(
      uploadsAt(gl, skinnedShadowUniforms(gl).get("jointMatrices[0]")),
    ).toHaveLength(1);
    expect(
      uploadsAt(gl, skinnedUnlitUniforms(gl).get("jointMatrices[0]")),
    ).toHaveLength(1);
  });

  it("skips a skinned caster whose geometry will not upload", async () => {
    registerSkinningPipeline();
    const { renderer, gl, camera } = await initialized();
    const root = new AmbientRoot([0.1, 0.1, 0.1]);
    const light = new TestShadowLight(8);
    const caster = litRenderable();
    const geometry = new TestGeometry(new Float32Array(0));
    geometry.joints = new Uint16Array(0);
    geometry.weights = new Float32Array(0);
    const skinned = new SkinnedTestNode(
      geometry.asGeometry,
      new TestLitMaterial().asMaterial,
    );
    skinned.skeleton = new TestSkeleton();
    root.add(light, caster, skinned);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // The caster compiles (the item is a skinned caster) then skips the draw,
    // matching the colour path's pipeline-then-geometry order. Four with the
    // registered §69 caster (2026-09-11).
    expect(gl.countOf("createProgram")).toBe(4);
    expect(uploadsAt(gl, shadowUniforms(gl).get("model"))).toHaveLength(1);
    expect(uploadsAt(gl, skinnedShadowUniforms(gl).get("model"))).toHaveLength(
      0,
    );
  });

  it("skips skinned casters when the colour pair fails to compile", async () => {
    registerSkinningPipeline();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // 3 at initialize; the registered §69 caster is 4; the colour pair's
      // first program is 5.
      const { renderer, gl, camera } = await initialized({
        failProgramAt: 5,
      });
      const root = new AmbientRoot([0.1, 0.1, 0.1]);
      const light = new TestShadowLight(8);
      const caster = litRenderable();
      const skinned = new SkinnedTestNode(
        skinnedGeometry().asGeometry,
        new TestLitMaterial().asMaterial,
      );
      skinned.skeleton = new TestSkeleton();
      root.add(light, caster, skinned);
      gl.reset();

      renderer.render(root, [createView(camera)]);

      expect(uploadsAt(gl, shadowUniforms(gl).get("model"))).toHaveLength(1);
      // The §69 caster, then the refused first half of the colour pair.
      expect(gl.countOf("createProgram")).toBe(2);
      expect(() => skinnedLitUniforms(gl)).toThrow();
    } finally {
      warn.mockRestore();
      resetDevWarnings();
    }
  });
});

describe("skinned draws — textures and feature mirrors (RFC 0003, R-19)", () => {
  beforeEach(() => {
    resetDevWarnings();
    clearRegisteredSkinningPipeline();
  });

  it("binds a skinned-unlit material's map and mirrors the switches", async () => {
    registerSkinningPipeline();
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const material = new TestMaterial();
    material.map = new TestTexture().asTexture;
    material.vertexColors = true;
    const node = new SkinnedTestNode(
      skinnedGeometry().asGeometry,
      material.asMaterial,
    );
    node.skeleton = new TestSkeleton();
    // A second, untextured skinned draw after it: the unit stays active and
    // the switches mirror back off.
    const plainMaterial = new TestMaterial();
    const plain = new SkinnedTestNode(
      skinnedGeometry().asGeometry,
      plainMaterial.asMaterial,
    );
    plain.skeleton = new TestSkeleton();
    root.add(node, plain);
    const views = [createView(camera)];
    gl.reset();

    renderer.render(root, views);

    // One activeTexture for the map unit, one bind for the one texture.
    expect(gl.countOf("activeTexture")).toBe(1);
    const uniforms = skinnedUnlitUniforms(gl);
    expect(uploadsAt(gl, uniforms.get("useMap"))).toEqual([1, 0]);
    expect(uploadsAt(gl, uniforms.get("useVertexColors"))).toEqual([1, 0]);
    expect(gl.countOf("drawArrays")).toBe(2);

    // A second frame re-binds the map on the already-active unit — the
    // sampler is uploaded once for the program's life.
    gl.reset();
    renderer.render(root, views);
    const sampler = uploadsAt(gl, uniforms.get("map"));
    expect(sampler).toEqual([]);
  });

  it("binds a skinned-lit material's map, and drops a disposed one's draw", async () => {
    registerSkinningPipeline();
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const material = new TestLitMaterial();
    const texture = new TestTexture();
    material.map = texture.asTexture;
    const node = new SkinnedTestNode(
      skinnedGeometry().asGeometry,
      material.asMaterial,
    );
    node.skeleton = new TestSkeleton();
    root.add(node);
    const views = [createView(camera)];
    gl.reset();

    renderer.render(root, views);
    const uniforms = skinnedLitUniforms(gl);
    expect(uploadsAt(gl, uniforms.get("useMap"))).toEqual([1]);
    expect(gl.countOf("drawArrays")).toBe(1);

    // A disposed map degrades the draw to untextured — §83's rule, exactly as
    // the lit pipeline treats it (a texture the cache cannot resolve).
    texture.dispose();
    gl.reset();
    renderer.render(root, views);
    expect(uploadsAt(gl, uniforms.get("useMap"))).toEqual([0]);
    expect(gl.countOf("drawArrays")).toBe(1);
  });
});

describe("skinned program mirrors — the sampler uploads once", () => {
  it("re-raising useMap after a drop does not re-upload the unit (unlit)", () => {
    const gl = createFakeGl();
    const program = SkinnedUnlitProgram.create(gl);
    program.use();
    program.setFeatures(true, false);
    program.setFeatures(false, false);
    program.setFeatures(true, false);
    const sampler = uploadsAt(gl, skinnedUnlitUniforms(gl).get("map"));
    expect(sampler).toEqual([0]);
    // The vertex-colour switch moves independently of the map switch.
    program.setFeatures(true, true);
    expect(
      uploadsAt(gl, skinnedUnlitUniforms(gl).get("useVertexColors")),
    ).toEqual([1]);
  });

  it("re-raising useMap after a drop does not re-upload the unit (lit)", () => {
    const gl = createFakeGl();
    const program = SkinnedLitProgram.create(gl);
    program.use();
    expect(program.disposed).toBe(false);
    program.setFeatures(true);
    program.setFeatures(false);
    program.setFeatures(true);
    const sampler = uploadsAt(gl, skinnedLitUniforms(gl).get("map"));
    expect(sampler).toEqual([0]);
    program.dispose();
    expect(program.disposed).toBe(true);
  });
});

describe("GeometryCache — the joint buffer's own failure path (§83)", () => {
  it("abandons the upload when the joint buffer will not allocate", () => {
    const gl = createFakeGl();
    let created = 0;
    const original = gl.createBuffer.bind(gl);
    gl.createBuffer = () => {
      created += 1;
      // 1 position, 2 joints — fail the joints allocation itself.
      return created === 2 ? null : original();
    };
    const cache = new GeometryCache(gl);
    expect(cache.acquire(skinnedGeometry().asGeometry)).toBeNull();
    expect(gl.countOf("deleteBuffer")).toBe(1);
    expect(gl.countOf("deleteVertexArray")).toBe(1);
  });
});

describe("skinned draws — indexed geometry, statistics, disposed skips", () => {
  beforeEach(() => {
    resetDevWarnings();
    clearRegisteredSkinningPipeline();
  });

  it("draws an indexed skinned geometry through drawElements and counts it", async () => {
    registerSkinningPipeline();
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const geometry = quadGeometry();
    geometry.joints = new Uint16Array(16);
    geometry.weights = new Float32Array(16);
    for (let i = 0; i < 4; i += 1) {
      geometry.weights[i * 4] = 1;
    }
    const node = new SkinnedTestNode(
      geometry.asGeometry,
      new TestMaterial().asMaterial,
    );
    node.skeleton = new TestSkeleton();
    root.add(node);
    const statistics = createRenderStatistics();
    renderer.statistics = statistics;
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("drawElements")).toBe(1);
    // §84: one submitted draw, two triangles, one instance.
    expect(statistics.drawCalls).toBe(1);
    expect(statistics.triangles).toBe(2);
  });

  it("skips a skinned draw with nothing to draw (§83's empty geometry)", async () => {
    registerSkinningPipeline();
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    // Zero vertices carrying (empty) influence streams: the render list still
    // classifies the draw skinned, and the geometry cache answers "nothing to
    // draw" — the same skip a disposed geometry takes, after the pipeline
    // resolution rather than before it.
    const geometry = new TestGeometry(new Float32Array(0));
    geometry.joints = new Uint16Array(0);
    geometry.weights = new Float32Array(0);
    const node = new SkinnedTestNode(
      geometry.asGeometry,
      new TestMaterial().asMaterial,
    );
    node.skeleton = new TestSkeleton();
    root.add(node);
    gl.reset();

    renderer.render(root, [createView(camera)]);
    expect(gl.countOf("drawArrays")).toBe(0);
    expect(gl.countOf("drawElements")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §60 — node materials (RFC 0001, 2026-08-28).
// ---------------------------------------------------------------------------

let nextTestNodeMaterialId = 0;

/**
 * A `NodeMaterial` reduced to what the backend reads (§57, §60): the `kind`
 * discriminant the render list branches on, the frozen graph the program
 * cache keys on, and the per-name uniform/texture reads the draw uploads.
 * Same technique, same reason, as every double above — and what proves the
 * backend reads nothing outside the structural surface.
 */
class TestNodeMaterial {
  readonly kind = "node" as const;

  readonly id: string;

  readonly graph: ShaderGraph;

  opacity?: number;

  transparent?: boolean;

  /** Bound textures by sampler name; unset names read as `null`. */
  readonly textures = new Map<string, TestTexture | null>();

  /** Uniform values by name; unset names read as zeroed vec4s. */
  readonly uniforms = new Map<string, Float32Array>();

  constructor(graph: ShaderGraph) {
    nextTestNodeMaterialId += 1;
    this.id = `test-node-material-${String(nextTestNodeMaterialId)}`;
    this.graph = graph;
  }

  getUniform(name: string): Float32Array {
    return this.uniforms.get(name) ?? new Float32Array(4);
  }

  getTexture(name: string): TestTexture | null {
    return this.textures.get(name) ?? null;
  }

  get asMaterial(): NodeItemMaterial {
    return this as unknown as NodeItemMaterial;
  }
}

/** A constant-colour surface graph — no samplers, no uniforms, no time. */
function flatNodeGraph(): ShaderGraph {
  return {
    domain: "surface",
    nodes: [{ kind: "constant", type: "vec4", value: [1, 0, 0, 1] }],
    color: 0,
  };
}

/** A surface graph sampling one texture named `map` over the uv stream. */
function texturedNodeGraph(): ShaderGraph {
  return {
    domain: "surface",
    nodes: [
      { kind: "attribute", name: "uv" },
      { kind: "texture", name: "map", uv: 0 },
    ],
    color: 1,
  };
}

/** A surface graph whose colour pulses with §9 render time. */
function timedNodeGraph(): ShaderGraph {
  return {
    domain: "surface",
    nodes: [
      { kind: "time" },
      { kind: "compose", type: "vec4", parts: [0, 0, 0, 0] },
    ],
    color: 1,
  };
}

/** A displaced surface graph — the §69 caster exclusion's subject. */
function displacedNodeGraph(): ShaderGraph {
  return {
    domain: "surface",
    nodes: [
      { kind: "constant", type: "vec3", value: [0, 1, 0] },
      { kind: "constant", type: "vec4", value: [0, 1, 0, 1] },
    ],
    color: 1,
    positionOffset: 0,
  };
}

/** A screen graph copying `source`, optionally scaled by a uniform. */
function screenNodeGraph(withUniform = false): ShaderGraph {
  const nodes: ShaderGraph["nodes"] = withUniform
    ? [
        { kind: "attribute", name: "uv" },
        { kind: "texture", name: "source", uv: 0 },
        { kind: "uniform", type: "float", name: "gain" },
        { kind: "binary", op: "multiply", left: 1, right: 2 },
      ]
    : [
        { kind: "attribute", name: "uv" },
        { kind: "texture", name: "source", uv: 0 },
      ];
  return { domain: "screen", nodes, color: nodes.length - 1 };
}

/** A node-material renderable over `geometry`. */
function nodeRenderable(
  material: TestNodeMaterial,
  geometry: TestGeometry = triangleGeometry(),
): Renderable<NodeItemMaterial> {
  return new Renderable(geometry.asGeometry, material.asMaterial);
}

/** The node program's uniform handles — `spriteUniforms`' pattern. */
function nodeUniforms(gl: FakeGl): Map<string, object> {
  for (const perProgram of gl.uniformsByProgram.values()) {
    if (perProgram.has("opacity")) {
      return perProgram;
    }
  }
  throw new Error("the node program never resolved its uniforms");
}

describe("WebglRenderer — §60 node materials (RFC 0001)", () => {
  beforeEach(() => {
    resetDevWarnings();
    clearRegisteredNodeMaterialPipeline();
  });

  it("skips an unregistered node draw — absent, never flat-coloured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { renderer, gl, camera } = await initialized();
      const root = createRoot();
      root.add(renderable(triangleGeometry()));
      gl.reset();
      renderer.render(root, [createView(camera)]);
      const withoutNode = gl.calls.map((call) => call.name).join("|");

      const rig = await initialized();
      const rigRoot = createRoot();
      rigRoot.add(renderable(triangleGeometry()));
      rigRoot.add(nodeRenderable(new TestNodeMaterial(flatNodeGraph())));
      rig.gl.reset();
      rig.renderer.render(rigRoot, [createView(rig.camera)]);

      expect(rig.gl.calls.map((call) => call.name).join("|")).toBe(withoutNode);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain(
        "registerNodeMaterialPipeline",
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("compiles one program per graph structure on the first draw, shared by materials", async () => {
    registerNodeMaterialPipeline();
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(
      nodeRenderable(new TestNodeMaterial(flatNodeGraph())),
      nodeRenderable(new TestNodeMaterial(flatNodeGraph())),
    );
    const statistics = createRenderStatistics();
    renderer.statistics = statistics;
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // Two materials, structurally one graph: exactly one new program, one
    // `useProgram` switch onto it, two draws.
    expect(gl.countOf("createProgram")).toBe(1);
    expect(statistics.drawCalls).toBe(2);
    expect(gl.countOf("drawArrays")).toBe(2);

    // The next frame compiles nothing further.
    gl.reset();
    renderer.render(root, [createView(camera)]);
    expect(gl.countOf("createProgram")).toBe(0);
  });

  it("uploads view state once per view per program, and per-draw state per draw", async () => {
    registerNodeMaterialPipeline();
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(
      nodeRenderable(new TestNodeMaterial(flatNodeGraph())),
      nodeRenderable(new TestNodeMaterial(flatNodeGraph())),
    );
    gl.reset();
    renderer.render(root, [
      createView(camera),
      createView(camera, { id: "second" }),
    ]);

    const uniforms = nodeUniforms(gl);
    const viewUploads = uploadsAt(gl, uniforms.get("viewProjection"));
    const modelUploadsList = uploadsAt(gl, uniforms.get("model"));
    // Two views: two view-projection uploads; two draws per view: four models.
    expect(viewUploads).toHaveLength(2);
    expect(modelUploadsList).toHaveLength(4);
    // Opacity: mirror starts at GL's 0, both materials report 1 — one upload.
    expect(uploadsAt(gl, uniforms.get("opacity"))).toEqual([1]);
  });

  it("feeds §9 render time to a graph that reads it", async () => {
    registerNodeMaterialPipeline();
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(nodeRenderable(new TestNodeMaterial(timedNodeGraph())));
    renderer.renderTime = 1.25;
    gl.reset();
    renderer.render(root, [createView(camera)]);
    const uniforms = nodeUniforms(gl);
    expect(uploadsAt(gl, uniforms.get("time"))).toEqual([1.25]);
  });

  it("binds node textures above the fixed units and unbinds them in the finally", async () => {
    registerNodeMaterialPipeline();
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const material = new TestNodeMaterial(texturedNodeGraph());
    material.textures.set("map", new TestTexture(2, 2));
    root.add(nodeRenderable(material));
    gl.reset();
    renderer.render(root, [createView(camera)]);

    const nodeUnit = GL.TEXTURE0 + NODE_SURFACE_TEXTURE_UNIT_BASE;
    const unitSelections = gl
      .callsOf("activeTexture")
      .map((call) => call.args[0]);
    // Selected to bind, re-selected to unbind, ending back at unit 0.
    expect(unitSelections).toEqual([
      nodeUnit,
      GL.TEXTURE0,
      nodeUnit,
      GL.TEXTURE0,
    ]);
    const binds = gl.callsOf("bindTexture");
    expect(binds[binds.length - 1].args[1]).toBeNull();
    expect(gl.countOf("drawArrays")).toBe(1);
  });

  it("skips a node draw whose sampler is unbound or disposed — nothing at all", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      registerNodeMaterialPipeline();
      const { renderer, gl, camera } = await initialized();
      const root = createRoot();
      const unbound = new TestNodeMaterial(texturedNodeGraph());
      const disposed = new TestNodeMaterial(texturedNodeGraph());
      const gone = new TestTexture(2, 2);
      gone.disposed = true;
      disposed.textures.set("map", gone);
      root.add(nodeRenderable(unbound), nodeRenderable(disposed));
      gl.reset();
      renderer.render(root, [createView(camera)]);
      expect(gl.countOf("drawArrays")).toBe(0);
      expect(gl.countOf("bufferData")).toBe(0);
      // Two node-material skip warnings (unbound + disposed sampler) plus one
      // §83 disposed-in-use warning when the texture cache refuses the texture.
      expect(warn).toHaveBeenCalledTimes(3);
    } finally {
      warn.mockRestore();
    }
  });

  it("skips a node draw whose graph the cache refused, with one warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      registerNodeMaterialPipeline();
      const { renderer, gl, camera } = await initialized();
      const root = createRoot();
      const broken: ShaderGraph = { domain: "surface", nodes: [], color: 0 };
      root.add(nodeRenderable(new TestNodeMaterial(broken)));
      gl.reset();
      renderer.render(root, [createView(camera)]);
      renderer.render(root, [createView(camera)]);
      expect(gl.countOf("drawArrays")).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("draws an indexed node geometry through drawElements", async () => {
    registerNodeMaterialPipeline();
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(
      nodeRenderable(new TestNodeMaterial(flatNodeGraph()), quadGeometry()),
    );
    const statistics = createRenderStatistics();
    renderer.statistics = statistics;
    gl.reset();
    renderer.render(root, [createView(camera)]);
    expect(gl.countOf("drawElements")).toBe(1);
    expect(statistics.triangles).toBe(2);
  });

  it("skips a node draw with nothing to draw (§83's empty geometry)", async () => {
    registerNodeMaterialPipeline();
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(
      nodeRenderable(
        new TestNodeMaterial(flatNodeGraph()),
        new TestGeometry(new Float32Array(0)),
      ),
    );
    gl.reset();
    renderer.render(root, [createView(camera)]);
    expect(gl.countOf("drawArrays")).toBe(0);
    expect(gl.countOf("drawElements")).toBe(0);
  });

  it("drops the cache on context loss and dispose", async () => {
    registerNodeMaterialPipeline();
    const { renderer, gl, camera, canvas } = await initialized();
    const root = createRoot();
    root.add(nodeRenderable(new TestNodeMaterial(flatNodeGraph())));
    renderer.render(root, [createView(camera)]);
    expect(gl.countOf("deleteProgram")).toBe(0);

    canvas.dispatch("webglcontextlost");
    canvas.dispatch("webglcontextrestored");
    gl.reset();
    // The next node frame recreates the cache and recompiles the graph.
    renderer.render(root, [createView(camera)]);
    expect(gl.countOf("createProgram")).toBe(1);

    gl.reset();
    renderer.dispose();
    // Three eager programs plus the node program (2026-09-11: the particle,
    // effect, shadow and standard pipelines are registered seams this scene
    // never acquired) — assert only that the node program's delete is among
    // them.
    expect(gl.countOf("deleteProgram")).toBeGreaterThanOrEqual(4);
  });

  it("a displaced node material casts nothing; an undisplaced one casts exactly (§69)", async () => {
    registerNodeMaterialPipeline();
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(new TestShadowLight());
    const lit = new Renderable(
      triangleGeometry().asGeometry,
      new TestLitMaterial().asMaterial,
    );
    root.add(lit);
    root.add(nodeRenderable(new TestNodeMaterial(flatNodeGraph())));
    root.add(nodeRenderable(new TestNodeMaterial(displacedNodeGraph())));
    gl.reset();
    renderer.render(root, [createView(camera)]);

    // The caster pass drew the lit triangle and the undisplaced node mesh:
    // two model uploads through the shadow program, never a third.
    const casters = uploadsAt(gl, shadowUniforms(gl).get("model"));
    expect(casters).toHaveLength(2);
    // Both node materials still drew in the colour pass (3 surface draws +
    // 2 caster draws).
    expect(gl.countOf("drawArrays")).toBe(5);
  });
});

describe("WebglRenderer.renderEffect — §70 graph effects (§60; RFC 0001)", () => {
  beforeEach(() => {
    resetDevWarnings();
    clearRegisteredNodeMaterialPipeline();
  });

  /** A pass over a fresh 8×8 source, with `effect` and an optional target. */
  function graphPass(
    effect: GraphEffect,
    destination?: RenderTarget,
  ): { pass: EffectRenderPass; source: RenderTarget } {
    const source = new RenderTarget({ width: 8, height: 8 });
    return {
      pass: {
        kind: "effect",
        source: source.colorTexture,
        effect,
        ...(destination === undefined ? {} : { target: destination }),
      },
      source,
    };
  }

  it("skips silently while nothing is registered, warning once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { renderer, gl } = await initialized();
      const { pass } = graphPass({ kind: "graph", graph: screenNodeGraph() });
      gl.reset();
      renderer.renderEffect(pass);
      expect(gl.countOf("drawArrays")).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("draws the full-screen triangle over the source, on and off screen", async () => {
    registerNodeMaterialPipeline();
    const { renderer, gl } = await initialized();
    const destination = new RenderTarget({ width: 4, height: 4 });
    const { pass } = graphPass(
      { kind: "graph", graph: screenNodeGraph() },
      destination,
    );
    gl.reset();
    renderer.renderEffect(pass);
    // One compile, one framebuffer bind + unbind, the destination's whole
    // rectangle, one triangle, and the source bound at unit 0 then released.
    expect(gl.countOf("createProgram")).toBe(1);
    expect(gl.countOf("drawArrays")).toBe(1);
    const scissor = gl.callsOf("scissor")[0];
    expect(scissor.args).toEqual([0, 0, 4, 4]);
    const frameBinds = gl.callsOf("bindFramebuffer");
    expect(frameBinds[frameBinds.length - 1].args[1]).toBeNull();
    const unitSelections = gl
      .callsOf("activeTexture")
      .map((call) => call.args[0]);
    expect(unitSelections).toEqual([GL.TEXTURE0, GL.TEXTURE0]);

    // On screen: once the source's framebuffer is cached, no framebuffer
    // call at all — and the compiled program is reused for the structurally
    // identical graph.
    const onScreen = graphPass({ kind: "graph", graph: screenNodeGraph() });
    renderer.renderEffect(onScreen.pass); // warms the source's record
    gl.reset();
    renderer.renderEffect(onScreen.pass);
    expect(gl.countOf("createProgram")).toBe(0);
    expect(gl.countOf("bindFramebuffer")).toBe(0);
    expect(gl.countOf("drawArrays")).toBe(1);
  });

  it("uploads pass uniforms — scalars and arrays — and §9 render time", async () => {
    registerNodeMaterialPipeline();
    const { renderer, gl } = await initialized();
    const graph: ShaderGraph = {
      domain: "screen",
      nodes: [
        { kind: "attribute", name: "uv" },
        { kind: "texture", name: "source", uv: 0 },
        { kind: "uniform", type: "float", name: "gain" },
        { kind: "uniform", type: "vec4", name: "tint" },
        { kind: "time" },
        { kind: "binary", op: "multiply", left: 1, right: 2 },
        { kind: "binary", op: "multiply", left: 5, right: 3 },
        { kind: "binary", op: "multiply", left: 6, right: 4 },
      ],
      color: 7,
    };
    renderer.renderTime = 0.5;
    const { pass } = graphPass({
      kind: "graph",
      graph,
      uniforms: { tint: [1, 2, 3, 4], gain: 2 },
    });
    gl.reset();
    renderer.renderEffect(pass);
    // A screen program has no `opacity`; find it by its own uniform.
    let uniforms: Map<string, object> | undefined;
    for (const perProgram of gl.uniformsByProgram.values()) {
      if (perProgram.has("u_gain")) {
        uniforms = perProgram;
      }
    }
    if (uniforms === undefined) {
      throw new Error("the graph-effect program never resolved its uniforms");
    }
    expect(uploadsAt(gl, uniforms.get("u_gain"))).toEqual([2]);
    expect(uploadsAt(gl, uniforms.get("u_tint"))).toEqual([[1, 2, 3, 4]]);
    expect(uploadsAt(gl, uniforms.get("time"))).toEqual([0.5]);
    // §84: the triangle counted as one submitted draw.
    const statistics = createRenderStatistics();
    renderer.statistics = statistics;
    renderer.renderEffect(pass);
    expect(statistics.drawCalls).toBe(1);
    expect(statistics.triangles).toBe(1);
  });

  it("resolves declared extra inputs and refuses a feedback loop through one", async () => {
    registerNodeMaterialPipeline();
    const { renderer, gl } = await initialized();
    const noise = new RenderTarget({ width: 8, height: 8 });
    const graph: ShaderGraph = {
      domain: "screen",
      nodes: [
        { kind: "attribute", name: "uv" },
        { kind: "texture", name: "source", uv: 0 },
        { kind: "texture", name: "noise", uv: 0 },
        { kind: "binary", op: "add", left: 1, right: 2 },
      ],
      color: 3,
    };
    const good = graphPass({
      kind: "graph",
      graph,
      textures: { noise: noise.colorTexture },
    });
    gl.reset();
    renderer.renderEffect(good.pass);
    expect(gl.countOf("drawArrays")).toBe(1);
    // Two samplers: units 0 and 1, bound then unbound in reverse.
    const unitSelections = gl
      .callsOf("activeTexture")
      .map((call) => call.args[0]);
    expect(unitSelections).toEqual([
      GL.TEXTURE0,
      GL.TEXTURE0 + 1,
      GL.TEXTURE0 + 1,
      GL.TEXTURE0,
    ]);

    // The same pass aimed *at* its own extra input: skipped before any state.
    const feedback = graphPass(
      { kind: "graph", graph, textures: { noise: noise.colorTexture } },
      noise,
    );
    gl.reset();
    renderer.renderEffect(feedback.pass);
    expect(gl.countOf("drawArrays")).toBe(0);

    // A sampler the pass never declared: skipped too.
    const undeclared = graphPass({ kind: "graph", graph });
    gl.reset();
    renderer.renderEffect(undeclared.pass);
    expect(gl.countOf("drawArrays")).toBe(0);

    // A declared input that is not a render-target texture (a caller that
    // bypassed validation): skipped structurally, like the fixed path's
    // source check.
    const wrongKind = graphPass({
      kind: "graph",
      graph,
      textures: { noise: {} as never },
    });
    gl.reset();
    renderer.renderEffect(wrongKind.pass);
    expect(gl.countOf("drawArrays")).toBe(0);
  });

  it("skips a graph the cache latched as failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      registerNodeMaterialPipeline();
      const { renderer, gl } = await initialized();
      const broken: ShaderGraph = { domain: "screen", nodes: [], color: 0 };
      const { pass } = graphPass({ kind: "graph", graph: broken });
      gl.reset();
      renderer.renderEffect(pass);
      expect(gl.countOf("drawArrays")).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// §71's picking service seam (RFC 0005) — the renderer's half: the gated
// factory method and the live host window it opens. The service's own pass
// and read-back live in `gl-picking.test.ts`.
// ---------------------------------------------------------------------------

describe("WebglRenderer.createPickingService (§71, RFC 0005)", () => {
  it("refuses when no picking pipeline is registered (§85)", async () => {
    clearRegisteredPickingPipeline();
    const { renderer } = await initialized();
    const error = thrown(() => renderer.createPickingService());
    expect(error.code).toBe("INVALID_APPLICATION_STATE");
    expect(String(error.message)).toContain("registerPickingPipeline");
  });

  it("refuses on a disposed renderer (§83)", async () => {
    registerPickingPipeline();
    try {
      const { renderer } = await initialized();
      renderer.dispose();
      const error = thrown(() => renderer.createPickingService());
      expect(error.code).toBe("INVALID_APPLICATION_STATE");
    } finally {
      clearRegisteredPickingPipeline();
    }
  });

  it("builds a service whose host window tracks the live renderer state", async () => {
    registerPickingPipeline();
    try {
      // Built without the optional read-back entry point (`canReadPixels`,
      // 2026-08-29 — the fake used to lack the whole group), so the pick
      // below still exercises the refusal-by-name path.
      const { renderer, gl, camera } = await initialized({
        canReadPixels: false,
      });
      renderer.resize(8, 8);
      const service = renderer.createPickingService();
      expect(service).toBeInstanceOf(WebglPickingService);
      // Creation alone issues no GL call (the lazy-compile contract).
      const before = gl.calls.length;
      expect(gl.calls.length).toBe(before);

      // The host's surface size and caches are live: an update over the
      // renderer's own context compiles the id program and draws through
      // the renderer's geometry cache.
      const root = createRoot();
      root.add(renderable(triangleGeometry()));
      const view = createView(camera);
      camera.projectionMatrix.identity();
      camera.viewMatrix.identity();
      service.update(root, view);
      expect(gl.countOf("drawArrays")).toBeGreaterThan(0);

      // A context without the read-back entry point: presence is the
      // capability (§62), so the pick refuses by name.
      const error = await rejection(
        service.pick({ viewport: view, ndcX: 0, ndcY: 0 }),
      );
      expect(error.code).toBe("UNSUPPORTED_GPU_FEATURE");

      // Disposal under a live renderer releases through the shared caches.
      service.dispose();
      expect(service.disposed).toBe(true);
    } finally {
      clearRegisteredPickingPipeline();
    }
  });

  it("hands the service a lost-context view of the renderer (§61)", async () => {
    registerPickingPipeline();
    try {
      const { renderer, gl, canvas, camera } = await initialized();
      renderer.resize(8, 8);
      const service = renderer.createPickingService();
      const root = createRoot();
      root.add(renderable(triangleGeometry()));
      const view = createView(camera);
      service.update(root, view);
      const drawsBefore = gl.countOf("drawArrays");

      canvas.dispatch("webglcontextlost");
      // The standing buffer did not survive the loss the host reports.
      const lost = await rejection(
        service.pick({ viewport: view, ndcX: 0, ndcY: 0 }),
      );
      expect(lost.code).toBe("CONTEXT_LOST");
      // A pass attempted while lost is skipped and drops the stale buffer,
      // so the refusal becomes "no id buffer" rather than a stale answer.
      service.update(root, view);
      expect(gl.countOf("drawArrays")).toBe(drawsBefore);
      const noBuffer = await rejection(
        service.pick({ viewport: view, ndcX: 0, ndcY: 0 }),
      );
      expect(noBuffer.code).toBe("INVALID_APPLICATION_STATE");
    } finally {
      clearRegisteredPickingPipeline();
    }
  });
});

describe("WebglRenderer.readPixels (§61, §92; 2026-08-29)", () => {
  /** The fake's deterministic byte for framebuffer texel (fx, fy), channel. */
  function patternByte(fx: number, fy: number, channel: number): number {
    return (fy * 1024 + fx * 4 + channel) % 251;
  }

  it("reads a whole target back as tightly packed bytes, rows bottom-to-top", async () => {
    const { renderer, gl } = await initialized();
    const target = new RenderTarget({ width: 3, height: 2 });
    gl.reset();

    const pixels = new Uint8Array(await renderer.readPixels(target));
    expect(pixels.byteLength).toBe(3 * 2 * 4);
    // Row 0 of the result is framebuffer row 0 — the bottom — exactly as the
    // fake (and real GL) writes it; no flip happens or is needed.
    for (let fy = 0; fy < 2; fy += 1) {
      for (let fx = 0; fx < 3; fx += 1) {
        for (let channel = 0; channel < 4; channel += 1) {
          expect(pixels[(fy * 3 + fx) * 4 + channel]).toBe(
            patternByte(fx, fy, channel),
          );
        }
      }
    }
    // One whole-target read off the target's framebuffer, binding restored.
    expect(gl.callsOf("readPixels")[0]?.args).toEqual([
      0,
      0,
      3,
      2,
      GL.RGBA,
      GL.UNSIGNED_BYTE,
    ]);
    const names = gl.names();
    const bindings = gl.callsOf("bindFramebuffer").map((call) => call.args[1]);
    expect(bindings.at(-1)).toBeNull();
    expect(names.indexOf("readPixels")).toBeGreaterThan(
      names.indexOf("bindFramebuffer"),
    );
    renderer.dispose();
    target.dispose();
  });

  it("reads a region as exactly the sub-rectangle of the whole read (§7a bottom-left origin)", async () => {
    const { renderer, gl } = await initialized();
    const target = new RenderTarget({ width: 4, height: 4 });

    const whole = new Uint8Array(await renderer.readPixels(target));
    gl.reset();
    const region = new Rectangle2(1, 2, 2, 2);
    const part = new Uint8Array(await renderer.readPixels(target, region));

    expect(part.byteLength).toBe(2 * 2 * 4);
    // The region's coordinates pass straight through to GL — no flip, no
    // origin conversion: GL's readback space is already §7a's.
    expect(gl.callsOf("readPixels")[0]?.args).toEqual([
      1,
      2,
      2,
      2,
      GL.RGBA,
      GL.UNSIGNED_BYTE,
    ]);
    // Byte-for-byte the sub-rectangle of the whole-target read.
    for (let row = 0; row < 2; row += 1) {
      for (let col = 0; col < 2; col += 1) {
        for (let channel = 0; channel < 4; channel += 1) {
          expect(part[(row * 2 + col) * 4 + channel]).toBe(
            whole[((row + 2) * 4 + (col + 1)) * 4 + channel],
          );
        }
      }
    }
    renderer.dispose();
    target.dispose();
  });

  it("rejects a malformed region with the shared §85 RangeError", async () => {
    const { renderer } = await initialized();
    const target = new RenderTarget({ width: 4, height: 4 });

    await expect(
      renderer.readPixels(target, new Rectangle2(0, 0, 5, 1)),
    ).rejects.toThrow(/does not lie inside the 4 × 4 target/);
    await expect(
      renderer.readPixels(target, new Rectangle2(0.5, 0, 1, 1)),
    ).rejects.toThrow(/region x must be an integer/);
    await expect(
      renderer.readPixels(target, new Rectangle2(0, 0, 0, 1)),
    ).rejects.toThrow(/non-empty/);
    renderer.dispose();
    target.dispose();
  });

  it("rejects with INVALID_APPLICATION_STATE before initialize, after dispose, and for a disposed target", async () => {
    const target = new RenderTarget({ width: 2, height: 2 });
    const uninitialized = new WebglRenderer();
    expect((await rejection(uninitialized.readPixels(target))).code).toBe(
      "INVALID_APPLICATION_STATE",
    );

    const { renderer } = await initialized();
    const disposedTarget = new RenderTarget({ width: 2, height: 2 });
    disposedTarget.dispose();
    expect((await rejection(renderer.readPixels(disposedTarget))).code).toBe(
      "INVALID_APPLICATION_STATE",
    );

    renderer.dispose();
    expect((await rejection(renderer.readPixels(target))).code).toBe(
      "INVALID_APPLICATION_STATE",
    );
    target.dispose();
  });

  it("rejects with INVALID_APPLICATION_STATE for a target GL cannot allocate", async () => {
    const { renderer } = await initialized({ allocateFramebuffers: false });
    const target = new RenderTarget({ width: 2, height: 2 });
    const error = await rejection(renderer.readPixels(target));
    expect(error.code).toBe("INVALID_APPLICATION_STATE");
    expect(error.message).toContain("could not be allocated");
    renderer.dispose();
    target.dispose();
  });

  it("rejects with CONTEXT_LOST while the context is lost — rejects, never skips", async () => {
    const { renderer, canvas } = await initialized();
    const target = new RenderTarget({ width: 2, height: 2 });
    canvas.dispatch("webglcontextlost");
    expect((await rejection(renderer.readPixels(target))).code).toBe(
      "CONTEXT_LOST",
    );
    renderer.dispose();
    target.dispose();
  });

  it("rejects with UNSUPPORTED_GPU_FEATURE on a context without the entry point", async () => {
    const { renderer } = await initialized({ canReadPixels: false });
    const target = new RenderTarget({ width: 2, height: 2 });
    const error = await rejection(renderer.readPixels(target));
    expect(error.code).toBe("UNSUPPORTED_GPU_FEATURE");
    renderer.dispose();
    target.dispose();
  });
});

describe("Standard material normal and occlusion maps", () => {
  it("binds both linear data maps, transitions to scalar shading, and releases units", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const material = new TestStandardMaterial();
    material.normalMap = new TestTexture().asTexture;
    material.occlusionMap = new TestTexture().asTexture;
    material.normalScale = 0.5;
    material.occlusionStrength = 0.25;
    root.add(standardRenderable(litUvTriangleGeometry(), material));
    renderer.render(root, [createView(camera)]);
    const uniforms = standardUniforms(gl);
    expect(uploadsAt(gl, uniforms.get("normalScaleOffset"))).toEqual([-0.5]);
    expect(uploadsAt(gl, uniforms.get("occlusionStrengthOffset"))).toEqual([
      -0.75,
    ]);
    expect(uploadsAt(gl, uniforms.get("normalMap"))).toEqual([4]);
    expect(uploadsAt(gl, uniforms.get("occlusionMap"))).toEqual([5]);
    expect(uploadsAt(gl, uniforms.get("useNormalMap"))).toEqual([1]);
    expect(uploadsAt(gl, uniforms.get("useOcclusionMap"))).toEqual([1]);
    expect(gl.callsOf("activeTexture").at(-1)?.args[0]).toBe(GL.TEXTURE0);
    gl.reset();
    renderer.render(root, [createView(camera)]);
    expect(uploadsAt(gl, uniforms.get("useNormalMap"))).toEqual([]);
    expect(gl.callsOf("activeTexture").map((call) => call.args[0])).toEqual([
      GL.TEXTURE0 + 4,
      GL.TEXTURE0 + 5,
      GL.TEXTURE0 + 4,
      GL.TEXTURE0 + 5,
      GL.TEXTURE0,
    ]);
    material.normalMap = null;
    material.occlusionMap = null;
    gl.reset();
    renderer.render(root, [createView(camera)]);
    expect(uploadsAt(gl, uniforms.get("useNormalMap"))).toEqual([0]);
    expect(uploadsAt(gl, uniforms.get("useOcclusionMap"))).toEqual([0]);
    material.normalMap = new TestTexture().asTexture;
    material.occlusionMap = new TestTexture().asTexture;
    gl.reset();
    renderer.render(root, [createView(camera)]);
    expect(uploadsAt(gl, uniforms.get("useNormalMap"))).toEqual([1]);
    expect(uploadsAt(gl, uniforms.get("useOcclusionMap"))).toEqual([1]);
    expect(uploadsAt(gl, uniforms.get("normalMap"))).toEqual([]);
    expect(uploadsAt(gl, uniforms.get("occlusionMap"))).toEqual([]);
    renderer.dispose();
  });

  it("keeps derivative evaluation outside normal branches and occlusion outside direct lighting", () => {
    const gl = createFakeGl();
    const program = StandardProgram.create(gl);
    const source = gl.callsOf("shaderSource")[1].args[1] as string;
    expect(source).toContain("dFdx(vWorldPosition)");
    expect(source).toContain("frameLength <= 1e-20");
    expect(source).toContain("diffuseColor * occlusion");
    expect(source).toContain("vec4(shaded + emit, base.a)");
    program.dispose();
  });
});

// ---------------------------------------------------------------------------
// The registration seams of 2026-09-11 — §69 shadows, §70 effects, §36
// particles and (owner decision) §59's standard surface moved out of `initialize` and behind `register…Pipeline()`,
// the skinning slot's shape (RFC 0003). Each suite clears its own slot in
// `beforeEach` (the file-level `beforeEach` registers all three) and asserts
// the four answers: unregistered → skipped with one warning; registered →
// drawn, compiled once; context loss → re-acquired lazily; compile failure →
// latched once.
// ---------------------------------------------------------------------------

describe("registerShadowPipeline — the registry slot (§69, 2026-09-11)", () => {
  beforeEach(() => {
    clearRegisteredShadowPipeline();
  });

  it("starts empty, fills on registration, and clears for tests", () => {
    expect(resolveShadowPipelineFactory()).toBeNull();
    registerShadowPipeline();
    expect(resolveShadowPipelineFactory()).not.toBeNull();
    registerShadowPipeline();
    expect(resolveShadowPipelineFactory()).not.toBeNull();
    clearRegisteredShadowPipeline();
    expect(resolveShadowPipelineFactory()).toBeNull();
  });

  it("compiles the caster program through the factory", () => {
    registerShadowPipeline();
    const gl = createFakeGl();
    const program = resolveShadowPipelineFactory()?.create(gl);
    expect(program).toBeDefined();
    expect(gl.countOf("linkProgram")).toBe(1);
    program?.dispose();
    program?.dispose();
    expect(gl.countOf("deleteProgram")).toBe(1);
  });
});

describe("WebglRenderer.render — the §69 shadow seam (2026-09-11)", () => {
  function shadowScene(): { root: AmbientRoot; light: TestShadowLight } {
    const root = new AmbientRoot([0.1, 0.1, 0.1]);
    const light = new TestShadowLight(8);
    root.add(light, litRenderable(), litRenderable());
    return { root, light };
  }

  beforeEach(() => {
    resetDevWarnings();
    clearRegisteredShadowPipeline();
  });

  it("skips the shadow pass with one warning when nothing is registered, and still lights", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { renderer, gl, camera } = await initialized();
      const { root } = shadowScene();
      const views = [createView(camera)];
      gl.reset();

      renderer.render(root, views);
      renderer.render(root, views);

      // No map: no framebuffer, no compile, no `useShadow` — but both lit
      // surfaces still draw, unshadowed, under their lights.
      expect(gl.countOf("createProgram")).toBe(0);
      expect(gl.countOf("bindFramebuffer")).toBe(0);
      expect(gl.countOf("createFramebuffer")).toBe(0);
      expect(gl.countOf("drawArrays")).toBe(4);
      expect(uploadsAt(gl, litUniforms(gl).get("useShadow"))).toEqual([]);
      expect(
        uploadsAt(gl, litUniforms(gl).get("lightColor")).length,
      ).toBeGreaterThan(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain(
        "registerShadowPipeline",
      );
    } finally {
      warn.mockRestore();
      resetDevWarnings();
    }
  });

  it("compiles the caster lazily on the first shadowed frame, once, and renders the map", async () => {
    registerShadowPipeline();
    const { renderer, gl, camera } = await initialized();
    const { root } = shadowScene();
    const views = [createView(camera)];
    expect(gl.countOf("createProgram")).toBe(3);
    gl.reset();

    renderer.render(root, views);

    expect(gl.countOf("createProgram")).toBe(1);
    expect(gl.countOf("createFramebuffer")).toBe(1);
    expect(uploadsAt(gl, shadowUniforms(gl).get("model"))).toHaveLength(2);
    expect(uploadsAt(gl, litUniforms(gl).get("useShadow"))).toEqual([1]);

    gl.reset();
    renderer.render(root, views);
    expect(gl.countOf("createProgram")).toBe(0);
    expect(uploadsAt(gl, shadowUniforms(gl).get("model"))).toHaveLength(2);
  });

  it("issues no shadow call in a frame whose light does not cast, registered or not", async () => {
    const { renderer, gl, camera } = await initialized();
    const { root, light } = shadowScene();
    light.castShadow = false;
    const views = [createView(camera)];
    renderer.render(root, views);
    gl.reset();
    renderer.render(root, views);
    const before = JSON.stringify(gl.calls);

    registerShadowPipeline();
    gl.reset();
    renderer.render(root, views);

    expect(JSON.stringify(gl.calls)).toBe(before);
    expect(gl.countOf("createProgram")).toBe(0);
  });

  it("latches a compile failure: one warning, no map, no retry, lit draws intact", async () => {
    registerShadowPipeline();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // Program 4 is the caster (3 at initialize).
      const { renderer, gl, camera } = await initialized({ failProgramAt: 4 });
      const { root } = shadowScene();
      const views = [createView(camera)];
      gl.reset();

      renderer.render(root, views);
      renderer.render(root, views);

      expect(gl.countOf("createProgram")).toBe(1);
      expect(gl.countOf("bindFramebuffer")).toBe(0);
      expect(gl.countOf("drawArrays")).toBe(4);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("failed to compile");
    } finally {
      warn.mockRestore();
      resetDevWarnings();
    }
  });

  it("drops the caster on context loss and recompiles lazily after restore", async () => {
    registerShadowPipeline();
    const { renderer, gl, canvas, camera } = await initialized();
    const { root } = shadowScene();
    const views = [createView(camera)];
    renderer.render(root, views);

    canvas.dispatch("webglcontextlost");
    gl.reset();
    canvas.dispatch("webglcontextrestored");
    expect(gl.countOf("createProgram")).toBe(3);

    gl.reset();
    renderer.render(root, views);
    expect(gl.countOf("createProgram")).toBe(1);
    expect(gl.countOf("createFramebuffer")).toBe(1);
    // Two caster draws into the map plus the two lit draws — the dead
    // program's uniform table still sits in the fake, so count draws rather
    // than look a location up by name.
    expect(gl.countOf("drawArrays")).toBe(4);
  });

  it("recompiles after a restore even when the lost context had refused the caster", async () => {
    registerShadowPipeline();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { renderer, gl, canvas, camera } = await initialized({
        failProgramAt: 4,
      });
      const { root } = shadowScene();
      const views = [createView(camera)];
      renderer.render(root, views);
      canvas.dispatch("webglcontextlost");
      canvas.dispatch("webglcontextrestored");
      gl.reset();

      renderer.render(root, views);

      // The latch cleared with the context: asked again, and this time built.
      expect(gl.countOf("createProgram")).toBe(1);
      expect(gl.countOf("createFramebuffer")).toBe(1);
    } finally {
      warn.mockRestore();
      resetDevWarnings();
    }
  });

  it("disposes the compiled caster with the renderer (§83)", async () => {
    registerShadowPipeline();
    const { renderer, gl, camera } = await initialized();
    const { root } = shadowScene();
    renderer.render(root, [createView(camera)]);
    gl.reset();

    renderer.dispose();

    // Three eager programs plus the caster.
    expect(gl.countOf("deleteProgram")).toBe(4);
  });
});

describe("registerEffectPipeline — the registry slot (§70, 2026-09-11)", () => {
  beforeEach(() => {
    clearRegisteredEffectPipeline();
  });

  it("starts empty, fills on registration, and clears for tests", () => {
    expect(resolveEffectPipelineFactory()).toBeNull();
    registerEffectPipeline();
    expect(resolveEffectPipelineFactory()).not.toBeNull();
    registerEffectPipeline();
    expect(resolveEffectPipelineFactory()).not.toBeNull();
    clearRegisteredEffectPipeline();
    expect(resolveEffectPipelineFactory()).toBeNull();
  });

  it("compiles the effect program through the factory", () => {
    registerEffectPipeline();
    const gl = createFakeGl();
    const program = resolveEffectPipelineFactory()?.create(gl);
    expect(program).toBeDefined();
    expect(gl.countOf("linkProgram")).toBe(1);
    program?.dispose();
    program?.dispose();
    expect(gl.countOf("deleteProgram")).toBe(1);
  });
});

describe("WebglRenderer.renderEffect — the §70 effect seam (2026-09-11)", () => {
  beforeEach(() => {
    resetDevWarnings();
    clearRegisteredEffectPipeline();
  });

  it("skips the pass with one warning when nothing is registered", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { renderer, gl } = await initialized();
      const source = new RenderTarget({ width: 8, height: 8 });
      gl.reset();

      renderer.renderEffect(effectPass(source));
      renderer.renderEffect(effectPass(source, { kind: "grade" }));

      // No program selected, no triangle, no state borrowed — the source's
      // allocation is the cache's and happens before the seam is consulted.
      expect(gl.countOf("createProgram")).toBe(0);
      expect(gl.countOf("useProgram")).toBe(0);
      expect(gl.countOf("drawArrays")).toBe(0);
      expect(gl.countOf("disable")).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain(
        "registerEffectPipeline",
      );
    } finally {
      warn.mockRestore();
      resetDevWarnings();
    }
  });

  it("refuses a feedback loop before consulting the seam — no warning at all", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { renderer, gl } = await initialized();
      const target = new RenderTarget({ width: 8, height: 8 });
      gl.reset();

      renderer.renderEffect(effectPass(target, { kind: "copy" }, target));

      expect(gl.calls).toHaveLength(0);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      resetDevWarnings();
    }
  });

  it("compiles lazily on the first effect, once, and draws through it", async () => {
    registerEffectPipeline();
    const { renderer, gl } = await initialized();
    const source = new RenderTarget({ width: 8, height: 8 });
    expect(gl.countOf("createProgram")).toBe(3);
    gl.reset();

    renderer.renderEffect(effectPass(source));

    expect(gl.countOf("createProgram")).toBe(1);
    expect(gl.countOf("drawArrays")).toBe(1);
    expect(gl.callsOf("useProgram")[0]?.args[0]).toBe(effectProgramHandle(gl));

    gl.reset();
    renderer.renderEffect(effectPass(source, { kind: "grade" }));
    expect(gl.countOf("createProgram")).toBe(0);
    expect(gl.countOf("drawArrays")).toBe(1);
    expect(uploadsAt(gl, effectUniforms(gl).get("useGrade"))).toEqual([1]);
  });

  it("latches a compile failure: one warning, no draw, no retry", async () => {
    registerEffectPipeline();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { renderer, gl } = await initialized({ failProgramAt: 4 });
      const source = new RenderTarget({ width: 8, height: 8 });
      gl.reset();

      renderer.renderEffect(effectPass(source));
      renderer.renderEffect(effectPass(source));

      expect(gl.countOf("createProgram")).toBe(1);
      expect(gl.countOf("drawArrays")).toBe(0);
      expect(effectiveGlState(gl)).toEqual(RESTING_GL_STATE);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("failed to compile");
    } finally {
      warn.mockRestore();
      resetDevWarnings();
    }
  });

  it("drops the program on context loss and recompiles lazily after restore", async () => {
    registerEffectPipeline();
    const { renderer, gl, canvas } = await initialized();
    const source = new RenderTarget({ width: 8, height: 8 });
    renderer.renderEffect(effectPass(source));

    canvas.dispatch("webglcontextlost");
    gl.reset();
    canvas.dispatch("webglcontextrestored");
    expect(gl.countOf("createProgram")).toBe(3);

    gl.reset();
    renderer.renderEffect(effectPass(source));
    expect(gl.countOf("createProgram")).toBe(1);
    expect(gl.countOf("drawArrays")).toBe(1);
    // A fresh program, so the sampler uploads again — once.
    expect(gl.countOf("uniform1i")).toBe(1);
  });

  it("disposes the compiled program with the renderer (§83)", async () => {
    registerEffectPipeline();
    const { renderer, gl } = await initialized();
    renderer.renderEffect(effectPass(new RenderTarget({ width: 8, height: 8 })));
    gl.reset();

    renderer.dispose();

    // Three eager programs plus the effect program.
    expect(gl.countOf("deleteProgram")).toBe(4);
  });
});

describe("registerParticlePipeline — the registry slot (§36, 2026-09-11)", () => {
  beforeEach(() => {
    clearRegisteredParticlePipeline();
  });

  it("starts empty, fills on registration, and clears for tests", () => {
    expect(resolveParticlePipelineFactory()).toBeNull();
    registerParticlePipeline();
    expect(resolveParticlePipelineFactory()).not.toBeNull();
    registerParticlePipeline();
    expect(resolveParticlePipelineFactory()).not.toBeNull();
    clearRegisteredParticlePipeline();
    expect(resolveParticlePipelineFactory()).toBeNull();
  });

  it("compiles the billboard program with the caches, and the two tiers on demand", () => {
    registerParticlePipeline();
    const gl = createFakeGl();
    const programs = resolveParticlePipelineFactory()?.create(gl);
    expect(programs).toBeDefined();
    expect(gl.countOf("linkProgram")).toBe(1);
    expect(programs?.batches.size).toBe(0);
    expect(programs?.trailBatches.size).toBe(0);

    const appearance = programs?.acquireAppearance();
    expect(appearance).not.toBeNull();
    expect(gl.countOf("linkProgram")).toBe(2);
    expect(programs?.acquireAppearance()).toBe(appearance);
    const trail = programs?.acquireTrail();
    expect(trail).not.toBeNull();
    expect(gl.countOf("linkProgram")).toBe(3);
    expect(programs?.acquireTrail()).toBe(trail);
    expect(gl.countOf("linkProgram")).toBe(3);

    programs?.dispose();
    expect(gl.countOf("deleteProgram")).toBe(3);
    expect(programs?.batches.disposed).toBe(true);
    expect(programs?.trailBatches.disposed).toBe(true);
  });

  it("latches a refused appearance or trail compile without retrying", () => {
    registerParticlePipeline();
    const gl = createFakeGl({ failProgramAt: 2 });
    const programs = resolveParticlePipelineFactory()?.create(gl);
    expect(programs?.acquireAppearance()).toBeNull();
    expect(programs?.acquireAppearance()).toBeNull();
    // 1 (billboard) + 1 (the refused appearance); the trail still compiles.
    expect(gl.countOf("createProgram")).toBe(2);
    expect(programs?.acquireTrail()).not.toBeNull();
    expect(gl.countOf("createProgram")).toBe(3);

    const gl2 = createFakeGl({ failProgramAt: 2 });
    const programs2 = resolveParticlePipelineFactory()?.create(gl2);
    expect(programs2?.acquireTrail()).toBeNull();
    expect(programs2?.acquireTrail()).toBeNull();
    expect(gl2.countOf("createProgram")).toBe(2);
    programs2?.dispose();
    expect(gl2.countOf("deleteProgram")).toBe(1);
  });
});

describe("WebglRenderer.render — the §36 particle seam (2026-09-11)", () => {
  beforeEach(() => {
    resetDevWarnings();
    clearRegisteredParticlePipeline();
  });

  it("skips particle items with one warning when nothing is registered — not even the quad uploads", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { renderer, gl, camera } = await initialized();
      const particles = new TestParticles(4);
      const views = [createView(camera)];
      gl.reset();

      renderer.render(particles.asNode, views);
      renderer.render(particles.asNode, views);

      expect(gl.countOf("createProgram")).toBe(0);
      expect(gl.countOf("drawArraysInstanced")).toBe(0);
      expect(gl.countOf("createVertexArray")).toBe(0);
      expect(gl.countOf("createBuffer")).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain(
        "registerParticlePipeline",
      );
    } finally {
      warn.mockRestore();
      resetDevWarnings();
    }
  });

  it("keeps a particle-free frame's transcript byte-identical under registration", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(triangleGeometry()), sprite());
    const views = [createView(camera)];
    renderer.render(root, views);
    gl.reset();
    renderer.render(root, views);
    const before = JSON.stringify(gl.calls);

    registerParticlePipeline();
    gl.reset();
    renderer.render(root, views);
    expect(JSON.stringify(gl.calls)).toBe(before);
  });

  it("compiles lazily on the first particle item, once, and draws through it", async () => {
    registerParticlePipeline();
    const { renderer, gl, camera } = await initialized();
    const particles = new TestParticles(4);
    const views = [createView(camera)];
    expect(gl.countOf("createProgram")).toBe(3);
    gl.reset();

    renderer.render(particles.asNode, views);

    expect(gl.countOf("createProgram")).toBe(1);
    expect(gl.countOf("drawArraysInstanced")).toBe(1);
    // Compiled before the quad uploads — the skinned arm's pipeline-then-
    // geometry order, so a skipped item contributes nothing at all.
    expect(indexOf(gl, "createProgram")).toBeLessThan(
      indexOf(gl, "createBuffer"),
    );

    gl.reset();
    renderer.render(particles.asNode, views);
    expect(gl.countOf("createProgram")).toBe(0);
    expect(gl.countOf("drawArraysInstanced")).toBe(1);
  });

  it("latches a compile failure: one warning, no draw, no retry", async () => {
    registerParticlePipeline();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { renderer, gl, camera } = await initialized({ failProgramAt: 4 });
      const particles = new TestParticles(4);
      const views = [createView(camera)];
      gl.reset();

      renderer.render(particles.asNode, views);
      renderer.render(particles.asNode, views);

      expect(gl.countOf("createProgram")).toBe(1);
      expect(gl.countOf("drawArraysInstanced")).toBe(0);
      expect(gl.countOf("createVertexArray")).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("failed to compile");
    } finally {
      warn.mockRestore();
      resetDevWarnings();
    }
  });

  it("drops the programs and caches on context loss and re-acquires lazily after restore", async () => {
    registerParticlePipeline();
    const { renderer, gl, canvas, camera } = await initialized();
    const particles = new TestParticles(4);
    const views = [createView(camera)];
    renderer.render(particles.asNode, views);

    canvas.dispatch("webglcontextlost");
    gl.reset();
    canvas.dispatch("webglcontextrestored");
    expect(gl.countOf("createProgram")).toBe(3);

    gl.reset();
    renderer.render(particles.asNode, views);
    expect(gl.countOf("createProgram")).toBe(1);
    // Fresh quad and batch handles, and no delete against the dead ones.
    expect(gl.countOf("createVertexArray")).toBe(2);
    expect(gl.countOf("deleteVertexArray")).toBe(0);
    expect(gl.countOf("drawArraysInstanced")).toBe(1);
  });

  it("disposes the compiled programs and both caches with the renderer (§83)", async () => {
    registerParticlePipeline();
    const { renderer, gl, camera } = await initialized();
    renderer.render(new TestParticles(4).asNode, [createView(camera)]);
    gl.reset();

    renderer.dispose();

    // Three eager programs plus the billboard program; the shared quad's
    // vertex array and this system's, and the quad's buffer plus the
    // instance buffer.
    expect(gl.countOf("deleteProgram")).toBe(4);
    expect(gl.countOf("deleteVertexArray")).toBe(2);
    expect(gl.countOf("deleteBuffer")).toBe(2);
  });
});

describe("WebglRenderer.render — the trail tier behind the particle seam (§36, 2026-09-11)", () => {
  /** A particle double carrying a two-triangle ribbon (§36's trail tier). */
  function trailed(): TestParticles {
    const particles = new TestParticles(2);
    const withTrail = particles as unknown as {
      hasTrail: boolean;
      trailVertices: Float32Array;
      trailVertexCount: number;
    };
    withTrail.hasTrail = true;
    withTrail.trailVertices = new Float32Array(6 * TRAIL_VERTEX_FLOATS);
    withTrail.trailVertexCount = 6;
    return particles;
  }

  beforeEach(() => {
    resetDevWarnings();
    clearRegisteredParticlePipeline();
    registerParticlePipeline();
  });

  it("compiles the trail program on the first ribbon and draws it after the billboards", async () => {
    const { renderer, gl, camera } = await initialized();
    const particles = trailed();
    const views = [createView(camera)];
    gl.reset();

    renderer.render(particles.asNode, views);

    // Billboard program, then the trail program — both inside the frame.
    expect(gl.countOf("createProgram")).toBe(2);
    expect(gl.countOf("drawArraysInstanced")).toBe(1);
    expect(gl.callsOf("drawArrays").map((call) => call.args)).toEqual([
      [GL.TRIANGLES, 0, 6],
    ]);
    expect(indexOf(gl, "drawArraysInstanced")).toBeLessThan(
      indexOf(gl, "drawArrays"),
    );

    gl.reset();
    renderer.render(particles.asNode, views);
    // Warm: no compile, one ribbon upload, one ribbon draw.
    expect(gl.countOf("createProgram")).toBe(0);
    expect(gl.countOf("bufferSubData")).toBe(2);
    expect(gl.countOf("drawArrays")).toBe(1);
  });

  it("counts the ribbon's triangles in §84's statistics", async () => {
    const { renderer, camera } = await initialized();
    const statistics = createRenderStatistics();
    renderer.statistics = statistics;

    renderer.render(trailed().asNode, [createView(camera)]);

    // One instanced billboard draw (two instances of the quad's two
    // triangles) plus one ribbon draw of two triangles.
    expect(statistics.drawCalls).toBe(2);
    expect(statistics.triangles).toBe(2 * 2 + 2);
  });

  it("skips only the ribbon when the trail program will not compile — the billboards still draw", async () => {
    // 3 at initialize; the billboard is 4; the trail is 5.
    const { renderer, gl, camera } = await initialized({ failProgramAt: 5 });
    const particles = trailed();
    const views = [createView(camera)];
    gl.reset();

    renderer.render(particles.asNode, views);
    renderer.render(particles.asNode, views);

    // Asked once for the trail, refused once, never asked again.
    expect(gl.countOf("createProgram")).toBe(2);
    expect(gl.countOf("drawArraysInstanced")).toBe(2);
    expect(gl.countOf("drawArrays")).toBe(0);
  });

  it("disposes the trail program and its cache with the renderer (§83)", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.render(trailed().asNode, [createView(camera)]);
    gl.reset();

    renderer.dispose();

    // Three eager + billboard + trail.
    expect(gl.countOf("deleteProgram")).toBe(5);
    // The shared quad's array, the system's instance array, and the ribbon's.
    expect(gl.countOf("deleteVertexArray")).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// §59's standard surface behind a seam (2026-09-11, owner decision) — the
// same four answers as the three seams above.
// ---------------------------------------------------------------------------

describe("registerStandardPipeline — the registry slot (§59, 2026-09-11)", () => {
  beforeEach(() => {
    clearRegisteredStandardPipeline();
  });

  it("starts empty, fills on registration, and clears for tests", () => {
    expect(resolveStandardPipelineFactory()).toBeNull();
    registerStandardPipeline();
    expect(resolveStandardPipelineFactory()).not.toBeNull();
    registerStandardPipeline();
    expect(resolveStandardPipelineFactory()).not.toBeNull();
    clearRegisteredStandardPipeline();
    expect(resolveStandardPipelineFactory()).toBeNull();
  });

  it("compiles the standard program through the factory", () => {
    registerStandardPipeline();
    const gl = createFakeGl();
    const program = resolveStandardPipelineFactory()?.create(gl);
    expect(program).toBeDefined();
    expect(gl.countOf("linkProgram")).toBe(1);
    program?.dispose();
    program?.dispose();
    expect(gl.countOf("deleteProgram")).toBe(1);
  });
});

describe("WebglRenderer.render — the §59 standard seam (2026-09-11)", () => {
  function standardScene(): AmbientRoot {
    const root = new AmbientRoot([0.1, 0.1, 0.1]);
    root.add(standardRenderable(), litRenderable());
    return root;
  }

  beforeEach(() => {
    resetDevWarnings();
    clearRegisteredStandardPipeline();
  });

  it("skips standard draws with one warning when nothing is registered — the lit draw still lands", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { renderer, gl, camera } = await initialized();
      const root = standardScene();
      const views = [createView(camera)];
      gl.reset();

      renderer.render(root, views);
      renderer.render(root, views);

      // Never a Lambert stand-in: the lit triangle draws, the standard one
      // does not, and nothing compiles.
      expect(gl.countOf("createProgram")).toBe(0);
      expect(gl.countOf("drawArrays")).toBe(2);
      expect(() => standardUniforms(gl)).toThrow();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain(
        "registerStandardPipeline",
      );
    } finally {
      warn.mockRestore();
      resetDevWarnings();
    }
  });

  it("keeps a standard-free frame's transcript byte-identical under registration", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = new AmbientRoot([0.1, 0.1, 0.1]);
    root.add(litRenderable(), renderable(triangleGeometry()));
    const views = [createView(camera)];
    renderer.render(root, views);
    gl.reset();
    renderer.render(root, views);
    const before = JSON.stringify(gl.calls);

    registerStandardPipeline();
    gl.reset();
    renderer.render(root, views);
    expect(JSON.stringify(gl.calls)).toBe(before);
  });

  it("compiles lazily on the first standard item, once, and draws through it", async () => {
    registerStandardPipeline();
    const { renderer, gl, camera } = await initialized();
    const root = standardScene();
    const views = [createView(camera)];
    expect(gl.countOf("createProgram")).toBe(3);
    gl.reset();

    renderer.render(root, views);

    expect(gl.countOf("createProgram")).toBe(1);
    expect(gl.countOf("drawArrays")).toBe(2);
    expect(uploadsAt(gl, standardUniforms(gl).get("model"))).toHaveLength(1);

    gl.reset();
    renderer.render(root, views);
    expect(gl.countOf("createProgram")).toBe(0);
    expect(gl.countOf("drawArrays")).toBe(2);
  });

  it("latches a compile failure: one warning, no standard draw, no retry", async () => {
    registerStandardPipeline();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // Program 4 is the standard compile (3 at initialize).
      const { renderer, gl, camera } = await initialized({ failProgramAt: 4 });
      const root = standardScene();
      const views = [createView(camera)];
      gl.reset();

      renderer.render(root, views);
      renderer.render(root, views);

      expect(gl.countOf("createProgram")).toBe(1);
      expect(gl.countOf("drawArrays")).toBe(2);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("failed to compile");
    } finally {
      warn.mockRestore();
      resetDevWarnings();
    }
  });

  it("drops the program on context loss and recompiles lazily after restore", async () => {
    registerStandardPipeline();
    const { renderer, gl, canvas, camera } = await initialized();
    const root = standardScene();
    const views = [createView(camera)];
    renderer.render(root, views);

    canvas.dispatch("webglcontextlost");
    gl.reset();
    canvas.dispatch("webglcontextrestored");
    expect(gl.countOf("createProgram")).toBe(3);

    gl.reset();
    renderer.render(root, views);
    expect(gl.countOf("createProgram")).toBe(1);
    expect(gl.countOf("drawArrays")).toBe(2);
  });

  it("disposes the compiled program with the renderer (§83)", async () => {
    registerStandardPipeline();
    const { renderer, gl, camera } = await initialized();
    renderer.render(standardScene(), [createView(camera)]);
    gl.reset();

    renderer.dispose();

    // Three eager programs plus the standard program.
    expect(gl.countOf("deleteProgram")).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Audit A5 — the colour mirrors (2026-09-11): each program remembers the last
// four floats it uploaded and skips an identical upload; `use()` forgets.
// ---------------------------------------------------------------------------

describe("colour mirrors — one upload per distinct colour per use() (audit A5)", () => {
  const RED: [number, number, number, number] = [1, 0, 0, 1];
  const BLUE: [number, number, number, number] = [0, 0, 1, 1];

  function colorUploads(gl: FakeGl): number {
    return gl.countOf("uniform4fv");
  }

  it("UnlitProgram.setColor", () => {
    const gl = createFakeGl();
    const program = UnlitProgram.create(gl);
    program.use();
    program.setColor(RED);
    program.setColor(RED);
    expect(colorUploads(gl)).toBe(1);
    program.setColor(BLUE);
    expect(colorUploads(gl)).toBe(2);
    // Same RGB, different opacity: a different alpha is a different colour.
    program.setColor(BLUE, 0.5);
    expect(colorUploads(gl)).toBe(3);
    program.setColor(BLUE, 0.5);
    expect(colorUploads(gl)).toBe(3);
    // A switch away and back forgets: the mirror does not claim to know
    // what ran in between.
    UnlitProgram.create(gl).use();
    program.use();
    program.setColor(BLUE, 0.5);
    expect(colorUploads(gl)).toBe(4);
    expect(gl.callsOf("uniform4fv").at(-1)?.args[1]).toEqual([0, 0, 1, 0.5]);
  });

  it("SpriteProgram.setTint", () => {
    const gl = createFakeGl();
    const program = SpriteProgram.create(gl);
    program.use();
    program.setTint(RED);
    program.setTint(RED);
    expect(colorUploads(gl)).toBe(1);
    program.setTint(BLUE);
    expect(colorUploads(gl)).toBe(2);
    SpriteProgram.create(gl).use();
    program.use();
    program.setTint(BLUE);
    expect(colorUploads(gl)).toBe(3);
  });

  it("LitProgram.setColor", () => {
    const gl = createFakeGl();
    const program = LitProgram.create(gl);
    program.use();
    program.setColor(RED);
    program.setColor(RED);
    expect(colorUploads(gl)).toBe(1);
    program.setColor(BLUE);
    expect(colorUploads(gl)).toBe(2);
    LitProgram.create(gl).use();
    program.use();
    program.setColor(BLUE);
    expect(colorUploads(gl)).toBe(3);
  });

  it("StandardProgram.setBaseColor", () => {
    const gl = createFakeGl();
    const program = StandardProgram.create(gl);
    program.use();
    program.setBaseColor(RED);
    program.setBaseColor(RED);
    expect(colorUploads(gl)).toBe(1);
    program.setBaseColor(BLUE);
    expect(colorUploads(gl)).toBe(2);
    StandardProgram.create(gl).use();
    program.use();
    program.setBaseColor(BLUE);
    expect(colorUploads(gl)).toBe(3);
  });

  it("SkinnedUnlitProgram.setColor", () => {
    const gl = createFakeGl();
    const program = SkinnedUnlitProgram.create(gl);
    program.use();
    program.setColor(RED);
    program.setColor(RED);
    expect(colorUploads(gl)).toBe(1);
    program.setColor(BLUE);
    expect(colorUploads(gl)).toBe(2);
    SkinnedUnlitProgram.create(gl).use();
    program.use();
    program.setColor(BLUE);
    expect(colorUploads(gl)).toBe(3);
  });

  it("SkinnedLitProgram.setColor", () => {
    const gl = createFakeGl();
    const program = SkinnedLitProgram.create(gl);
    program.use();
    program.setColor(RED);
    program.setColor(RED);
    expect(colorUploads(gl)).toBe(1);
    program.setColor(BLUE);
    expect(colorUploads(gl)).toBe(2);
    SkinnedLitProgram.create(gl).use();
    program.use();
    program.setColor(BLUE);
    expect(colorUploads(gl)).toBe(3);
  });

  it("a frame of N unlit items over one material uploads the colour once (renderer)", async () => {
    const { renderer, gl, camera } = await initialized();
    // Deliberately *not* float32-exact: a `Float32Array` mirror would round
    // 0.2 and never match the material's double, so the skip would silently
    // never fire — this scene is the benchmark's `[0.2, 0.6, 1, 1]`.
    const material = new TestMaterial([0.2, 0.6, 1, 1]);
    const other = new TestMaterial([1, 0.2, 0.2, 1]);
    const root = createRoot();
    root.add(
      renderable(triangleGeometry(), material),
      renderable(triangleGeometry(), material),
      renderable(triangleGeometry(), material),
      renderable(triangleGeometry(), other),
    );
    const views = [createView(camera)];
    renderer.render(root, views);
    gl.reset();

    renderer.render(root, views);

    // Two distinct colours in one program: two uploads, four draws. Before
    // 2026-09-11 this was four uploads.
    expect(gl.countOf("drawArrays")).toBe(4);
    const uploads = uploadsAt(gl, unlitUniforms(gl).get("color")) as number[][];
    expect(uploads).toHaveLength(2);
    expect(uploads[0]?.[0]).toBeCloseTo(0.2, 6);
    expect(uploads[0]?.[1]).toBeCloseTo(0.6, 6);
    expect(uploads[1]?.[0]).toBe(1);
    expect(uploads[1]?.[1]).toBeCloseTo(0.2, 6);
  });
});

// ---------------------------------------------------------------------------
// Audit A6 — the bound-texture mirror on the map unit (2026-09-11).
// ---------------------------------------------------------------------------

describe("bound-texture mirror — one bind per texture run on unit 0 (audit A6)", () => {
  it("binds a shared sprite atlas once per frame, not once per sprite", async () => {
    const { renderer, gl, camera } = await initialized();
    const texture = new TestTexture();
    const root = createRoot();
    root.add(
      sprite(new TestSpriteMaterial(texture)),
      sprite(new TestSpriteMaterial(texture)),
      sprite(new TestSpriteMaterial(texture)),
    );
    const views = [createView(camera)];
    renderer.render(root, views);
    gl.reset();

    renderer.render(root, views);

    // One bind for the run, one unbind at the end of the frame. Three binds
    // (one per sprite) until 2026-09-11.
    expect(gl.countOf("drawElements")).toBe(3);
    const binds = gl.callsOf("bindTexture").map((call) => call.args[1]);
    expect(binds).toHaveLength(2);
    expect(binds[0]).not.toBeNull();
    expect(binds[1]).toBeNull();
  });

  it("rebinds when the texture changes, and again when it changes back", async () => {
    const { renderer, gl, camera } = await initialized();
    const a = new TestTexture();
    const b = new TestTexture();
    const root = createRoot();
    root.add(
      sprite(new TestSpriteMaterial(a)),
      sprite(new TestSpriteMaterial(b)),
      sprite(new TestSpriteMaterial(a)),
    );
    const views = [createView(camera)];
    renderer.render(root, views);
    gl.reset();

    renderer.render(root, views);

    const binds = gl.callsOf("bindTexture").map((call) => call.args[1]);
    expect(binds).toHaveLength(4);
    expect(binds[0]).not.toBeNull();
    expect(binds[1]).not.toBe(binds[0]);
    expect(binds[2]).toBe(binds[0]);
    expect(binds[3]).toBeNull();
  });

  it("forgets the binding when the pipeline changes, even for the same texture", async () => {
    const { renderer, gl, camera } = await initialized();
    const texture = new TestTexture();
    const mapped = new TestMaterial();
    mapped.map = texture.asTexture;
    const root = createRoot();
    root.add(
      sprite(new TestSpriteMaterial(texture)),
      renderable(quadGeometry(), mapped),
    );
    const views = [createView(camera)];
    renderer.render(root, views);
    gl.reset();

    renderer.render(root, views);

    // Sprite pipeline binds it; the unlit pipeline binds it again after the
    // switch — the mirror is keyed by pipeline as well as by handle.
    const binds = gl.callsOf("bindTexture").map((call) => call.args[1]);
    expect(binds).toHaveLength(3);
    expect(binds[0]).toBe(binds[1]);
    expect(binds[2]).toBeNull();
  });

  it("starts every frame with nothing claimed", async () => {
    const { renderer, gl, camera } = await initialized();
    const texture = new TestTexture();
    const root = createRoot();
    root.add(sprite(new TestSpriteMaterial(texture)));
    const views = [createView(camera)];
    renderer.render(root, views);
    gl.reset();

    renderer.render(root, views);
    renderer.render(root, views);

    // Bind + unbind per frame: the `finally` unbinds unit 0, so the next
    // frame must bind again rather than trust a mirror that outlived it.
    expect(gl.countOf("bindTexture")).toBe(4);
  });
});

describe("bound-texture mirror — the shaded and skinned map sites (audit A6)", () => {
  function bindsOf(gl: FakeGl): (object | null)[] {
    return gl.callsOf("bindTexture").map((call) => call.args[1] as object | null);
  }

  it("binds a map shared by two lit surfaces once", async () => {
    const { renderer, gl, camera } = await initialized();
    const texture = new TestTexture();
    const material = new TestLitMaterial();
    material.map = texture.asTexture;
    const root = new AmbientRoot([0.1, 0.1, 0.1]);
    root.add(litRenderable(undefined, material), litRenderable(undefined, material));
    const views = [createView(camera)];
    renderer.render(root, views);
    gl.reset();

    renderer.render(root, views);

    // Bind once for the run, unbind at the end of the frame (two binds until
    // 2026-09-11 — one per draw).
    expect(gl.countOf("drawArrays")).toBe(2);
    expect(bindsOf(gl)).toHaveLength(2);
    expect(bindsOf(gl)[1]).toBeNull();
  });

  it("binds a map shared by two standard surfaces once", async () => {
    const { renderer, gl, camera } = await initialized();
    const texture = new TestTexture();
    const material = new TestStandardMaterial();
    material.map = texture.asTexture;
    const root = new AmbientRoot([0.1, 0.1, 0.1]);
    root.add(
      standardRenderable(undefined, material),
      standardRenderable(undefined, material),
    );
    const views = [createView(camera)];
    renderer.render(root, views);
    gl.reset();

    renderer.render(root, views);

    expect(gl.countOf("drawArrays")).toBe(2);
    expect(bindsOf(gl)).toHaveLength(2);
    expect(bindsOf(gl)[1]).toBeNull();
  });

  it("binds a map shared by two unlit surfaces once, and rebinds it for a lit one", async () => {
    const { renderer, gl, camera } = await initialized();
    const texture = new TestTexture();
    const unlit = new TestMaterial();
    unlit.map = texture.asTexture;
    const lit = new TestLitMaterial();
    lit.map = texture.asTexture;
    const root = new AmbientRoot([0.1, 0.1, 0.1]);
    root.add(
      renderable(quadGeometry(), unlit),
      renderable(quadGeometry(), unlit),
      litRenderable(undefined, lit),
    );
    const views = [createView(camera)];
    renderer.render(root, views);
    gl.reset();

    renderer.render(root, views);

    // The lit draw sorts before the unlit ones or after them — either way the
    // same handle is bound once per pipeline run, never once per draw: two
    // binds plus the unbind, not three plus the unbind.
    const binds = bindsOf(gl);
    expect(binds).toHaveLength(3);
    expect(binds[0]).toBe(binds[1]);
    expect(binds[2]).toBeNull();
  });

  it("binds a map shared by two skinned-unlit and two skinned-lit meshes once each", async () => {
    registerSkinningPipeline();
    try {
      const { renderer, gl, camera } = await initialized();
      const texture = new TestTexture();
      const unlit = new TestMaterial();
      unlit.map = texture.asTexture;
      const lit = new TestLitMaterial();
      lit.map = texture.asTexture;
      const root = new AmbientRoot([0.1, 0.1, 0.1]);
      const skeleton = new TestSkeleton();
      for (const material of [unlit, unlit, lit, lit]) {
        const node = new SkinnedTestNode(
          skinnedGeometry().asGeometry,
          material.asMaterial,
        );
        node.skeleton = skeleton;
        root.add(node);
      }
      const views = [createView(camera)];
      renderer.render(root, views);
      gl.reset();

      renderer.render(root, views);

      // One bind per skinned pipeline run (the kind is part of the key) plus
      // the end-of-frame unbind: four draws, three binds.
      expect(gl.countOf("drawArrays")).toBe(4);
      const binds = bindsOf(gl);
      expect(binds).toHaveLength(3);
      expect(binds[0]).toBe(binds[1]);
      expect(binds[2]).toBeNull();
    } finally {
      clearRegisteredSkinningPipeline();
    }
  });
});
