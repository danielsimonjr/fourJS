/**
 * The WebGL 2 surface this backend uses, and the pipelines it draws with
 * (§61, §62, §120, §106a).
 *
 * Four things live here because they are the same decision seen from four
 * sides:
 *
 * 1. **{@link WebglContext}** — a structural description of *exactly* the GL
 *    entry points this package calls, and nothing else.
 * 2. **{@link UnlitProgram}** — the MVP tier's first pipeline: positions in,
 *    `viewProjection * model * position` out, one uniform colour in the
 *    fragment stage (§57's `UnlitMaterial`, §120's "unlit colored geometry"),
 *    times an optional texture sample and an optional per-vertex colour, both
 *    selected by a uniform switch (R-19, 2026-08-07).
 * 3. **{@link SpriteProgram}** — §55's textured quad: the same vertex arrays,
 *    authored uv at {@link UV_ATTRIBUTE_LOCATION}, one texture sample times a
 *    tint. Both pipelines bind position at the same fixed location, so
 *    `gl-geometry.ts`'s vertex arrays serve both.
 * 4. **{@link LitProgram}** — §68's Lambert-lit surface (§120 "lighting",
 *    2026-08-04): positions plus the optional normal stream at a second fixed
 *    location, one directional light plus the scene ambient term as uniforms.
 *    The same vertex arrays again — a geometry without normals binds nothing
 *    at the normal slot and shades from its ambient term alone.
 *
 * ## Why a hand-written context type instead of `WebGL2RenderingContext`
 *
 * `WebGL2RenderingContext` is a `lib.dom` type. `@fourjs/render` already refuses
 * to name DOM types (its `RendererOptions.canvas` is `unknown` for exactly this
 * reason), and this package keeps the same discipline one level down: nothing
 * here needs `lib.dom`, so nothing here pulls it in, and the package
 * type-checks and unit-tests under plain Node with no DOM lib and no jsdom.
 *
 * The cost is that the interface has to be maintained by hand; the benefit is
 * that it *is* the package's GL budget, written down. Every method on
 * {@link WebglContext} is called somewhere in this package, and a call that
 * needs a new entry point has to add it here first — which is what makes the
 * hand-rolled fake in the unit tests a complete, honest double rather than a
 * partial stub that happens to work. A real `WebGL2RenderingContext` satisfies
 * this interface structurally, so the browser path (WP-3.8) needs no adapter.
 *
 * ## Why the enum values are constants here, not reads off the context
 *
 * {@link GL} spells the numeric values out. They are normative in OpenGL ES 3.0
 * and WebGL 2 — `GL_TRIANGLES` is `0x0004` in every implementation that exists
 * — so reading them back off the context buys nothing but forces every fake and
 * every mock to carry twenty-odd constant properties in addition to its methods
 * (decision, WP-3.5). Keeping the interface to methods is what keeps the test
 * double small enough to be read in one sitting.
 */

import { FourError, type Disposable } from "@fourjs/core";
import { Matrix3, type Matrix4, type Vector3 } from "@fourjs/math";
import { MAX_PUNCTUAL_LIGHTS, type SceneLights } from "@fourjs/render";

/**
 * The WebGL 2 / OpenGL ES 3.0 enumerants this package uses, by their normative
 * values. See the module header for why these are literals.
 */
export const GL = {
  /** `GL_LINES` — two vertices per primitive. */
  LINES: 0x0001,
  /** `GL_TRIANGLES` — three vertices per primitive. */
  TRIANGLES: 0x0004,
  /** `GL_ZERO` — destination factor of the `"multiply"` blend mode (§57). */
  ZERO: 0,
  /** `GL_ONE` — destination factor of `"additive"`, source of `"screen"`. */
  ONE: 1,
  /** `GL_SRC_COLOR`; declared for completeness of the blend-factor set. */
  SRC_COLOR: 0x0300,
  /** `GL_ONE_MINUS_SRC_COLOR` — destination factor of `"screen"`. */
  ONE_MINUS_SRC_COLOR: 0x0301,
  /** `GL_SRC_ALPHA` — source factor of the straight-alpha blend (§66). */
  SRC_ALPHA: 0x0302,
  /** `GL_ONE_MINUS_SRC_ALPHA` — destination factor of the same blend. */
  ONE_MINUS_SRC_ALPHA: 0x0303,
  /** `GL_DST_COLOR` — source factor of the `"multiply"` blend mode. */
  DST_COLOR: 0x0306,
  /** `GL_DEPTH_BUFFER_BIT`, for {@link WebglContext.clear}. */
  DEPTH_BUFFER_BIT: 0x00000100,
  /** `GL_COLOR_BUFFER_BIT`, for {@link WebglContext.clear}. */
  COLOR_BUFFER_BIT: 0x00004000,
  /** `GL_STENCIL_BUFFER_BIT`, for {@link WebglContext.clear} (§67, R-7). */
  STENCIL_BUFFER_BIT: 0x00000400,
  // §67's eight comparisons (R-7). GL numbers them contiguously from `NEVER`,
  // and the four shared with the depth function keep their depth-function
  // names — `LEQUAL` below is `GL_LEQUAL` whichever test asks for it.
  /** `GL_NEVER` — a stencil test that never passes. */
  NEVER: 0x0200,
  /** `GL_LESS`. */
  LESS: 0x0201,
  /** `GL_EQUAL` — the mask test: draw only where the mask was written. */
  EQUAL: 0x0202,
  /** `GL_LEQUAL` — the depth comparison this backend uses, and a stencil one. */
  LEQUAL: 0x0203,
  /** `GL_GREATER`. */
  GREATER: 0x0204,
  /** `GL_NOTEQUAL` — the inverse mask test. */
  NOTEQUAL: 0x0205,
  /** `GL_GEQUAL`. */
  GEQUAL: 0x0206,
  /** `GL_ALWAYS` — the stencil test's initial state, and what a mask pass uses. */
  ALWAYS: 0x0207,
  // §67's eight stencil operations (R-7). `KEEP`, `ZERO` and `REPLACE` are the
  // three a flat mask needs; the increment/decrement pair is what a *nested*
  // clip counts with, in both its saturating and its wrapping form.
  /** `GL_KEEP` — leave the stored value alone; the initial state of all three ops. */
  KEEP: 0x1e00,
  /** `GL_REPLACE` — store the reference value. */
  REPLACE: 0x1e01,
  /** `GL_INCR` — increment, saturating at 255. */
  INCR: 0x1e02,
  /** `GL_DECR` — decrement, saturating at 0. */
  DECR: 0x1e03,
  /** `GL_INVERT` — bitwise-invert the stored value. */
  INVERT: 0x150a,
  /** `GL_INCR_WRAP` — increment, wrapping 255 to 0. */
  INCR_WRAP: 0x8507,
  /** `GL_DECR_WRAP` — decrement, wrapping 0 to 255. */
  DECR_WRAP: 0x8508,
  /** `GL_STENCIL_TEST` — disabled until a material declares `stencil` (§57). */
  STENCIL_TEST: 0x0b90,
  /** `GL_TEXTURE_MAG_FILTER`. */
  TEXTURE_MAG_FILTER: 0x2800,
  /** `GL_TEXTURE_MIN_FILTER`. */
  TEXTURE_MIN_FILTER: 0x2801,
  /** `GL_TEXTURE_WRAP_S`. */
  TEXTURE_WRAP_S: 0x2802,
  /** `GL_TEXTURE_WRAP_T`. */
  TEXTURE_WRAP_T: 0x2803,
  /**
   * `GL_NEAREST` — point sampling. The one place this tier uses it is §69's
   * shadow map (R-18): a `DEPTH_COMPONENT` texture is *not* filterable in
   * GLES 3.0, so `LINEAR` would leave it incomplete and sample as black. The
   * percentage-closer filter is therefore explicit taps in the shader rather
   * than hardware filtering — see `gl-shadow.ts`.
   */
  NEAREST: 0x2600,
  /** `GL_LINEAR` — bilinear sampling, and the default §77 filter (R-30). */
  LINEAR: 0x2601,
  /** `GL_NEAREST_MIPMAP_NEAREST` — point in level, one level (§77, R-30b). */
  NEAREST_MIPMAP_NEAREST: 0x2700,
  /** `GL_LINEAR_MIPMAP_NEAREST` — bilinear in level, one level (§77, R-30b). */
  LINEAR_MIPMAP_NEAREST: 0x2701,
  /** `GL_NEAREST_MIPMAP_LINEAR` — point in level, two levels (§77, R-30b). */
  NEAREST_MIPMAP_LINEAR: 0x2702,
  /** `GL_LINEAR_MIPMAP_LINEAR` — trilinear (§77, R-30b, 2026-08-21). */
  LINEAR_MIPMAP_LINEAR: 0x2703,
  /**
   * `GL_TEXTURE_MAX_ANISOTROPY_EXT` — the per-texture anisotropy limit of
   * `EXT_texture_filter_anisotropic` (§77, R-30b).
   *
   * Written with `texParameteri` rather than `texParameterf`: the extension
   * accepts both, `Texture.anisotropy` is an integer by construction (§85), and
   * an integer keeps this package's GL budget at the entry points it already
   * declares (see {@link WebglContext}).
   */
  TEXTURE_MAX_ANISOTROPY_EXT: 0x84fe,
  /**
   * `GL_MAX_TEXTURE_MAX_ANISOTROPY_EXT` — the device's ceiling, read once per
   * cache the first time a texture asks for anisotropy (§62, §77, R-30b).
   */
  MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84ff,
  /**
   * `GL_TIME_ELAPSED_EXT` — `EXT_disjoint_timer_query_webgl2`'s elapsed-time
   * query target (§62 timestamp queries, A-1). Nanoseconds between
   * `beginQuery` and `endQuery`.
   */
  TIME_ELAPSED_EXT: 0x88bf,
  /**
   * `GL_GPU_DISJOINT_EXT` — `true` when the GPU reset its timers this
   * interval. A completed elapsed-time query whose disjoint flag is set is
   * discarded rather than published as `gpuFrameTime`.
   */
  GPU_DISJOINT_EXT: 0x8fbb,
  /** `GL_QUERY_RESULT` — the completed query's value (nanoseconds here). */
  QUERY_RESULT: 0x8866,
  /** `GL_QUERY_RESULT_AVAILABLE` — whether {@link GL.QUERY_RESULT} may be read. */
  QUERY_RESULT_AVAILABLE: 0x8867,
  /** `GL_CCW` — counter-clockwise front faces (§7a right-handed, Y-up). */
  CCW: 0x0901,
  /** `GL_CULL_FACE`, deliberately left disabled — see `webgl-renderer.ts`. */
  CULL_FACE: 0x0b44,
  /** `GL_DEPTH_TEST`. */
  DEPTH_TEST: 0x0b71,
  /** `GL_BLEND` — enabled around sprite and particle passes; see `webgl-renderer.ts`. */
  BLEND: 0x0be2,
  /** `GL_SCISSOR_TEST` — enabled for the lifetime of the renderer. */
  SCISSOR_TEST: 0x0c11,
  /** `GL_TEXTURE_2D` — the one texture target this tier binds (§77). */
  TEXTURE_2D: 0x0de1,
  /** `GL_MAX_TEXTURE_SIZE`, the one §62 limit the MVP reports. */
  MAX_TEXTURE_SIZE: 0x0d33,
  /** `GL_UNSIGNED_BYTE` — the RGBA8 texel component type. */
  UNSIGNED_BYTE: 0x1401,
  /** `GL_UNSIGNED_SHORT` — index type of a `Uint16Array` index buffer. */
  UNSIGNED_SHORT: 0x1403,
  /** `GL_UNSIGNED_INT` — index type of a `Uint32Array` index buffer. */
  UNSIGNED_INT: 0x1405,
  /** `GL_FLOAT` — the position attribute's component type. */
  FLOAT: 0x1406,
  /** `GL_DEPTH_COMPONENT` — the texel *format* of a depth texture (R-18). */
  DEPTH_COMPONENT: 0x1902,
  /** `GL_RGBA` — the texel upload format. */
  RGBA: 0x1908,
  /** `GL_CLAMP_TO_EDGE` — the default wrap mode of a §77 texture (R-30). */
  CLAMP_TO_EDGE: 0x812f,
  /** `GL_REPEAT` — §77's tiling wrap mode (R-30, 2026-08-13). */
  REPEAT: 0x2901,
  /** `GL_MIRRORED_REPEAT` — §77's mirrored tiling wrap mode (R-30). */
  MIRRORED_REPEAT: 0x8370,
  /**
   * `GL_DEPTH_COMPONENT16` — storage format of a render target's depth
   * renderbuffer (R-4). The narrowest depth format WebGL 2 guarantees is
   * renderbuffer-renderable everywhere; 24-bit depth and packed
   * depth-stencil are staged with §67 and §69 (see `gl-render-target.ts`).
   */
  DEPTH_COMPONENT16: 0x81a5,
  /**
   * `GL_DEPTH_COMPONENT24` — sized internal format of a *samplable* depth
   * attachment (R-18, §69). Twenty-four bits rather than the renderbuffer's
   * sixteen because a shadow map's whole content is a depth *comparison*, and
   * 16-bit quantization over a 100 m volume shows as banded self-shadowing
   * before any bias can help; WebGL 2 requires this format for textures.
   */
  DEPTH_COMPONENT24: 0x81a6,
  /**
   * `GL_DEPTH24_STENCIL8` — the packed depth-plus-stencil renderbuffer storage
   * a render target asks for with `stencil: true` (R-7, §67).
   *
   * Packed rather than a separate `STENCIL_INDEX8` renderbuffer: WebGL 2
   * guarantees this combination is framebuffer-complete, a separate stencil
   * attachment beside a separate depth attachment is not guaranteed to be, and
   * one renderbuffer is one allocation. The consequence is stated where it
   * matters (`gl-render-target.ts`): the packed form is a *renderbuffer*, so a
   * target cannot ask for a stencil and R-18's samplable `depthTexture` at once.
   */
  DEPTH24_STENCIL8: 0x88f0,
  /** `GL_DEPTH_STENCIL_ATTACHMENT` — where {@link GL.DEPTH24_STENCIL8} attaches. */
  DEPTH_STENCIL_ATTACHMENT: 0x821a,
  /** `GL_TEXTURE0` — the one texture unit the sprite pipeline samples from. */
  TEXTURE0: 0x84c0,
  /** `GL_RGBA8` — the sized internal format of an MVP-tier texture. */
  RGBA8: 0x8058,
  /**
   * `GL_SRGB8_ALPHA8` — the sized internal format of a texture whose texels are
   * sRGB-encoded (§60a, R-15).
   *
   * Chosen instead of a decode in the shader because the hardware does it on
   * *sample*, i.e. before filtering: bilinear interpolation between two
   * sRGB-encoded texels is wrong in exactly the way a colour space exists to
   * prevent, and a shader-side `pow` would interpolate first and decode after.
   * The alpha channel of this format is **not** encoded, which matches
   * `srgbToLinearRGBA`'s rule that alpha is coverage, not light.
   */
  SRGB8_ALPHA8: 0x8c43,
  /** `GL_ARRAY_BUFFER` — vertex attribute storage. */
  ARRAY_BUFFER: 0x8892,
  /** `GL_ELEMENT_ARRAY_BUFFER` — index storage; part of vertex-array state. */
  ELEMENT_ARRAY_BUFFER: 0x8893,
  /** `GL_STATIC_DRAW` — the only usage hint this tier uploads with. */
  STATIC_DRAW: 0x88e4,
  /** `GL_FRAGMENT_SHADER`. */
  FRAGMENT_SHADER: 0x8b30,
  /** `GL_VERTEX_SHADER`. */
  VERTEX_SHADER: 0x8b31,
  /** `GL_COMPILE_STATUS`. */
  COMPILE_STATUS: 0x8b81,
  /** `GL_LINK_STATUS`. */
  LINK_STATUS: 0x8b82,
  /** `GL_FRAMEBUFFER_COMPLETE` — the one status a usable framebuffer reports. */
  FRAMEBUFFER_COMPLETE: 0x8cd5,
  /** `GL_COLOR_ATTACHMENT0` — a render target's colour texture (R-4). */
  COLOR_ATTACHMENT0: 0x8ce0,
  /** `GL_DEPTH_ATTACHMENT` — a render target's depth renderbuffer (R-4). */
  DEPTH_ATTACHMENT: 0x8d00,
  /** `GL_FRAMEBUFFER` — the bind point for both drawing and attaching (R-4). */
  FRAMEBUFFER: 0x8d40,
  /** `GL_RENDERBUFFER` — the bind point for depth storage (R-4). */
  RENDERBUFFER: 0x8d41,
} as const;

/** Opaque `WebGLShader` handle. */
export type GlShader = object;

/** Opaque `WebGLProgram` handle. */
export type GlProgramHandle = object;

/** Opaque `WebGLBuffer` handle. */
export type GlBuffer = object;

/** Opaque `WebGLVertexArrayObject` handle. */
export type GlVertexArray = object;

/** Opaque `WebGLUniformLocation` handle. */
export type GlUniformLocation = object;

/** Opaque `WebGLTexture` handle. */
export type GlTexture = object;

/** Opaque `WebGLFramebuffer` handle (R-4, `gl-render-target.ts`). */
export type GlFramebuffer = object;

/** Opaque `WebGLRenderbuffer` handle (R-4, `gl-render-target.ts`). */
export type GlRenderbuffer = object;

/** Opaque `WebGLSync` handle (§71's fence read-back; RFC 0005, `gl-picking.ts`). */
export type GlSync = object;

/** Opaque `WebGLQuery` handle (§62 timestamp queries; A-1, `gl-gpu-timer.ts`). */
export type GlQuery = object;

/**
 * The GL 2 entry points this package calls — the whole of them.
 *
 * Grouped by the module that uses each group, because that grouping is the
 * package's internal layering: shaders and uniforms here, buffers and vertex
 * arrays in `gl-geometry.ts`, per-frame state and draws in
 * `webgl-renderer.ts`.
 *
 * Return types are narrowed relative to the WebIDL where the WebGL 2
 * specification pins the answer for the specific enumerant this package passes
 * — `getShaderParameter(shader, COMPILE_STATUS)` is a `GLboolean`, so it is
 * typed `boolean` — and left `unknown` where it does not
 * ({@link WebglContext.getParameter}), so the caller has to narrow.
 */
export interface WebglContext {
  // --- Shaders and programs (this module) ---

  createShader(type: number): GlShader | null;
  shaderSource(shader: GlShader, source: string): void;
  compileShader(shader: GlShader): void;
  getShaderParameter(shader: GlShader, pname: number): boolean;
  getShaderInfoLog(shader: GlShader): string | null;
  deleteShader(shader: GlShader): void;

  createProgram(): GlProgramHandle | null;
  attachShader(program: GlProgramHandle, shader: GlShader): void;
  linkProgram(program: GlProgramHandle): void;
  getProgramParameter(program: GlProgramHandle, pname: number): boolean;
  getProgramInfoLog(program: GlProgramHandle): string | null;
  deleteProgram(program: GlProgramHandle): void;

  getUniformLocation(
    program: GlProgramHandle,
    name: string,
  ): GlUniformLocation | null;
  useProgram(program: GlProgramHandle | null): void;
  uniformMatrix4fv(
    location: GlUniformLocation,
    transpose: boolean,
    data: Float32Array,
  ): void;
  /**
   * Uploads one `mat3` uniform, column-major.
   *
   * Added with the lit/standard normal-matrix hoist (2026-09-09): those two
   * vertex stages used to derive `transpose(inverse(mat3(model)))` per vertex,
   * and now consume a per-draw 9-float upload. Growing this interface is the
   * same explicit budget bump `uniform1f` documented when §59 landed — a new
   * entry point rather than packing the 3×3 into a `mat4`. The node-material
   * pipeline still pads `mat3` to `mat4` so its transcripts stay untouched.
   */
  uniformMatrix3fv(
    location: GlUniformLocation,
    transpose: boolean,
    data: Float32Array,
  ): void;
  uniform4fv(location: GlUniformLocation, data: Float32Array): void;
  uniform3fv(location: GlUniformLocation, data: Float32Array): void;
  /**
   * Uploads one `float` uniform.
   *
   * Added with §59's standard pipeline (R-13, 2026-08-08), which is the first
   * one to carry a scalar the shader reads on its own — `metalness` and
   * `roughness`. Packing the two into a `vec3` would have kept this interface
   * unchanged; two named scalars are what the shader actually declares, and
   * this interface exists precisely so a new entry point is an explicit,
   * reviewable growth of the package's GL budget rather than a silent one (see
   * the module header).
   */
  uniform1f(location: GlUniformLocation, value: number): void;
  uniform1i(location: GlUniformLocation, value: number): void;

  // --- Textures (`gl-texture.ts`) ---

  createTexture(): GlTexture | null;
  bindTexture(target: number, texture: GlTexture | null): void;
  /**
   * The nine-argument, explicitly sized form — the only one this tier calls.
   * `pixels` is `null` for a texture with no CPU-side data, which allocates
   * zero-filled storage (§77).
   */
  texImage2D(
    target: number,
    level: number,
    internalFormat: number,
    width: number,
    height: number,
    border: number,
    format: number,
    type: number,
    pixels: ArrayBufferView | null,
  ): void;
  /** Updates existing RGBA8 storage without reallocating it. */
  texSubImage2D?(
    target: number,
    level: number,
    x: number,
    y: number,
    width: number,
    height: number,
    format: number,
    type: number,
    pixels: ArrayBufferView,
  ): void;
  texParameteri(target: number, pname: number, param: number): void;
  /**
   * Builds the full mip chain of the bound texture (§77's mipmaps; R-30b,
   * 2026-08-21).
   *
   * **Optional, and its presence is the capability** — the stance this package
   * takes for every entry point that is not needed to draw a frame. WebGL 2 has
   * it unconditionally; a *double* written before this field existed does not,
   * and a texture asking for `mipmaps: true` against such a context uploads
   * with one level and an in-level min filter (`gl-texture.ts`) rather than
   * leaving GL a texture it would treat as incomplete and sample as black.
   * Every existing double therefore keeps compiling and keeps issuing the call
   * sequence it always did.
   */
  generateMipmap?(target: number): void;
  /**
   * Requests an extension object, or `null` where the device has none (§62's
   * capability tiers; R-30b).
   *
   * Optional for {@link WebglContext.generateMipmap}'s reason, and called
   * **lazily**: the one caller today is the texture cache, on the first texture
   * that asks for anisotropy above 1, so a context that never meets one issues
   * no query at all and every already-recorded GL transcript is unchanged. The
   * return is `unknown` because this package must not name a `lib.dom` type;
   * the caller checks it for `null` and reads the enum it needs off {@link GL}.
   */
  getExtension?(name: string): unknown;
  deleteTexture(texture: GlTexture): void;
  activeTexture(unit: number): void;

  // --- Framebuffers and render targets (`gl-render-target.ts`, R-4) ---

  createFramebuffer(): GlFramebuffer | null;
  /**
   * Binds `framebuffer` for drawing, or `null` for the default drawing buffer
   * — the canvas (§61).
   *
   * `target` is always `GL.FRAMEBUFFER` in this tier: WebGL 2 can bind separate
   * read and draw framebuffers, and the packet that needs that split (a
   * multisample resolve blit, `readPixels` off a non-current target) is the one
   * that will pass anything else.
   */
  bindFramebuffer(target: number, framebuffer: GlFramebuffer | null): void;
  framebufferTexture2D(
    target: number,
    attachment: number,
    textureTarget: number,
    texture: GlTexture | null,
    level: number,
  ): void;
  /**
   * Reports whether the bound framebuffer is usable. Narrowed to `number`
   * (WebIDL `GLenum`); the caller compares it against `GL.FRAMEBUFFER_COMPLETE`
   * and refuses to draw into anything else.
   */
  checkFramebufferStatus(target: number): number;
  deleteFramebuffer(framebuffer: GlFramebuffer): void;

  createRenderbuffer(): GlRenderbuffer | null;
  bindRenderbuffer(target: number, renderbuffer: GlRenderbuffer | null): void;
  renderbufferStorage(
    target: number,
    internalFormat: number,
    width: number,
    height: number,
  ): void;
  framebufferRenderbuffer(
    target: number,
    attachment: number,
    renderbufferTarget: number,
    renderbuffer: GlRenderbuffer | null,
  ): void;
  deleteRenderbuffer(renderbuffer: GlRenderbuffer): void;

  // --- Read-back (`gl-picking.ts`; §71, RFC 0005) ---
  //
  // Every member of this group is **optional, and its presence is the
  // capability** — `generateMipmap`/`getExtension`'s stance (R-30b): real
  // WebGL 2 has them all unconditionally, a double written before this group
  // existed reports `undefined` and keeps compiling, and the picking service
  // degrades path by path (fence read-back → stalling read-back → a §89
  // refusal naming the missing entry point) rather than crashing a frame.
  // Nothing on the *draw* path calls any of them.

  /**
   * Reads one rectangle of the bound framebuffer (§71's id read-back; RFC
   * 0005 Q5's adopted disposition: the single-texel path, deliberately not
   * §61's `readPixels(target, region)` — that member still waits on
   * `Rectangle2`). `into` is a destination view for the direct, **stalling**
   * form, or a byte offset into the bound `PIXEL_PACK_BUFFER` for the
   * non-stalling fence form — WebGL 2's own two overloads, collapsed.
   */
  readPixels?: (
    x: number,
    y: number,
    width: number,
    height: number,
    format: number,
    type: number,
    into: ArrayBufferView | number,
  ) => void;
  /** Inserts a fence the GPU signals when prior commands complete. */
  fenceSync?: (condition: number, flags: number) => GlSync | null;
  /**
   * Polls `sync` without blocking (`timeout` is 0 in this package — a
   * *blocking* client wait would be the stall the fence path exists to
   * avoid). Returns one of `ALREADY_SIGNALED` / `TIMEOUT_EXPIRED` /
   * `CONDITION_SATISFIED` / `WAIT_FAILED` (`PICKING_GL`, `gl-picking.ts`).
   */
  clientWaitSync?: (sync: GlSync, flags: number, timeout: number) => number;
  deleteSync?: (sync: GlSync) => void;
  /** Copies the bound `PIXEL_PACK_BUFFER`'s bytes back to the CPU. */
  getBufferSubData?: (
    target: number,
    sourceByteOffset: number,
    into: ArrayBufferView,
  ) => void;

  // --- Timestamp queries (`gl-gpu-timer.ts`; §62, §84, A-1) ---
  //
  // Core WebGL 2 query objects plus `EXT_disjoint_timer_query_webgl2`.
  // Optional, presence is the capability (R-30b): a double written before
  // this group still compiles, and a renderer that never reads
  // `lastGpuFrameTimeSeconds` never calls any of them.

  /** Allocates an elapsed-time query object. */
  createQuery?(): GlQuery | null;
  /** Releases `query` (§83). */
  deleteQuery?(query: GlQuery): void;
  /** Starts `TIME_ELAPSED_EXT` accumulation into `query`. */
  beginQuery?(target: number, query: GlQuery): void;
  /** Stops the active query of `target`. */
  endQuery?(target: number): void;
  /**
   * Reads `QUERY_RESULT_AVAILABLE` (boolean) or `QUERY_RESULT` (nanoseconds)
   * from a completed query. Typed `unknown` so the caller narrows, same as
   * {@link WebglContext.getParameter}.
   */
  getQueryParameter?(query: GlQuery, pname: number): unknown;

  // --- Buffers and vertex arrays (`gl-geometry.ts`) ---

  createBuffer(): GlBuffer | null;
  bindBuffer(target: number, buffer: GlBuffer | null): void;
  bufferData(target: number, data: ArrayBufferView, usage: number): void;
  deleteBuffer(buffer: GlBuffer): void;
  /** Optional on structural test contexts; required by opt-in node std140. */
  getUniformBlockIndex?(program: GlProgramHandle, name: string): number;
  uniformBlockBinding?(
    program: GlProgramHandle,
    index: number,
    binding: number,
  ): void;
  bindBufferBase?(target: number, index: number, buffer: GlBuffer | null): void;

  createVertexArray(): GlVertexArray | null;
  bindVertexArray(array: GlVertexArray | null): void;
  deleteVertexArray(array: GlVertexArray): void;
  enableVertexAttribArray(index: number): void;
  vertexAttribPointer(
    index: number,
    size: number,
    type: number,
    normalized: boolean,
    stride: number,
    offset: number,
  ): void;

  // --- Per-frame state and draws (`webgl-renderer.ts`) ---

  getParameter(pname: number): unknown;
  enable(capability: number): void;
  disable(capability: number): void;
  depthFunc(func: number): void;
  frontFace(mode: number): void;
  viewport(x: number, y: number, width: number, height: number): void;
  scissor(x: number, y: number, width: number, height: number): void;
  clearColor(red: number, green: number, blue: number, alpha: number): void;
  clearDepth(depth: number): void;
  clear(mask: number): void;
  blendFunc(sourceFactor: number, destinationFactor: number): void;
  /**
   * Enables or disables writing to the depth buffer (§57's `depthWrite`).
   *
   * Separate from `enable(DEPTH_TEST)`, which is what §57's `depthTest`
   * controls: the usual transparent surface *tests* depth and does not *write*
   * it, and only two GL entry points can say that.
   */
  depthMask(enabled: boolean): void;
  /**
   * Enables or disables writing each colour channel (§57's `colorWrite`).
   *
   * Per-channel in GL; this tier only ever sets all four together, because §57
   * declares one boolean. A per-channel mask is what a later `colorWrite`
   * carrying a channel set would drive.
   */
  colorMask(red: boolean, green: boolean, blue: boolean, alpha: boolean): void;
  /**
   * Sets the stencil comparison for both faces (§67's `func`, `ref`,
   * `readMask`).
   *
   * Both faces, always: this backend leaves `CULL_FACE` disabled and draws
   * every polygon with one state, so the two-sided `stencilFuncSeparate` — the
   * entry point a shadow-volume or a non-zero-winding fill pass needs — would
   * be a second way to say the same thing until such a pass exists.
   */
  stencilFunc(func: number, ref: number, mask: number): void;
  /**
   * Sets what a stencil-fail, depth-fail, and pass store, for both faces
   * ({@link WebglContext.stencilFunc}'s reason).
   */
  stencilOp(fail: number, depthFail: number, pass: number): void;
  /**
   * Sets the bits a stencil write — including `clear(STENCIL_BUFFER_BIT)` —
   * may change (§67's `writeMask`).
   *
   * The clear is the trap and is why this is a mirrored value rather than a
   * per-draw call: GL masks the *clear* with this too, so a frame that ended
   * with a read-only mask material would clear nothing at all the next time
   * round. `webgl-renderer.ts` puts it back before every clear, and with no
   * stencil in the frame that comparison issues no call.
   */
  stencilMask(mask: number): void;
  drawArrays(mode: number, first: number, count: number): void;
  drawElements(mode: number, count: number, type: number, offset: number): void;
  isContextLost(): boolean;
}

/**
 * Vertex attribute slot the position stream is bound to.
 *
 * Fixed by `layout(location = 0)` in the vertex shader rather than looked up
 * with `getAttribLocation` (decision, WP-3.5). GLSL ES 3.00 supports explicit
 * attribute locations, so the location is a property of the *source*, not of a
 * particular link; that removes one query from initialization, removes one
 * method from {@link WebglContext}, and — more usefully — makes vertex arrays
 * built by `gl-geometry.ts` independent of any program, which is what will let
 * a second pipeline reuse them unchanged.
 */
export const POSITION_ATTRIBUTE_LOCATION = 0;

/**
 * Vertex attribute slot the optional normal stream is bound to (§53, §68) —
 * fixed by `layout(location = 1)` exactly as the position slot is, and for the
 * same reasons. Location 1 collides with nothing: the particle pipeline's
 * instance attributes live in its own vertex arrays (attribute bindings are
 * VAO state), and `gl-geometry.ts`'s arrays bind this slot only when the
 * geometry carries normals. A program that does not declare the slot (unlit,
 * sprite) simply ignores an enabled stream; the lit program run over a
 * geometry that never enabled it reads GL's constant default `(0, 0, 0, 1)`,
 * which the lit fragment stage treats as "no normal — ambient only".
 */
export const NORMAL_ATTRIBUTE_LOCATION = 1;

/**
 * Vertex attribute slot the optional uv stream is bound to (§53, §55; R-19,
 * 2026-08-07) — fixed by `layout(location = 2)`, exactly as the position and
 * normal slots are.
 *
 * Location 2 collides with nothing: the particle pipeline's instance
 * attributes live in *its own* vertex arrays and attribute bindings are VAO
 * state, so the same number means different things in two arrays that are never
 * bound at the same time. A geometry without uvs enables nothing here and a
 * textured draw of it reads GL's constant default `(0, 0, 0, 1)`, i.e. samples
 * the texel at the texture's origin for every fragment.
 */
export const UV_ATTRIBUTE_LOCATION = 2;

/**
 * Vertex attribute slot the optional per-vertex colour stream is bound to
 * (§53, §60a; R-19). Four floats — straight RGBA — at `layout(location = 3)`,
 * for the same reasons as the three slots above.
 *
 * A geometry without colors reads GL's constant default `(0, 0, 0, 1)`, so a
 * `vertexColors` material drawn over one renders black; that is the documented
 * behaviour on `UnlitMaterial.vertexColors`, chosen because a visible mistake
 * beats a silently ignored flag.
 */
export const COLOR_ATTRIBUTE_LOCATION = 3;

/**
 * Vertex attribute slot the optional joint-index stream is bound to (§53,
 * §54; RFC 0003, 2026-08-28) — fixed by `layout(location = 4)` in the skinned
 * vertex stages (`gl-skinning.ts`), continuing R-19's numbering, and a public
 * layout commitment: `@fourjs/geometry`'s `BufferGeometry.joints` documents it,
 * and glTF's second influence set (`JOINTS_1`/`WEIGHTS_1`) is the named
 * extension point at the next two locations.
 *
 * The stream is uploaded as **non-normalized `UNSIGNED_SHORT` floats**
 * (`vertexAttribPointer`, not `vertexAttribIPointer`): the shader declares
 * `in vec4 joints` and indexes with `int(...)`, which is exact for every
 * index a `Uint16Array` can carry and keeps this package's GL surface — and
 * every recorded double — free of an integer-attribute entry point. A program
 * that does not declare the slot ignores it, as with every optional stream.
 */
export const JOINTS_ATTRIBUTE_LOCATION = 4;

/**
 * Vertex attribute slot the optional joint-weight stream is bound to (§53,
 * §54; RFC 0003) — `layout(location = 5)`, four floats per vertex,
 * index-parallel with {@link JOINTS_ATTRIBUTE_LOCATION}'s stream.
 */
export const WEIGHTS_ATTRIBUTE_LOCATION = 5;

/**
 * The texture unit the `map` sampler of the unlit and lit pipelines reads from.
 *
 * Unit 0, permanently, and the same unit the sprite pipeline uses: this tier
 * binds exactly one texture per draw, and §77's multi-texture materials
 * (normal maps, masks, atlases plus data maps) are what will need a unit
 * allocator. Naming the constant keeps the `activeTexture` call in
 * `webgl-renderer.ts` and the sampler upload here from drifting apart.
 */
export const MAP_TEXTURE_UNIT = 0;

/**
 * The texture unit §69's shadow map is bound to (R-18, 2026-08-09).
 *
 * Unit **1**, permanently, and the one place this backend uses a unit other
 * than 0: the map stays bound across draws that also bind an albedo texture to
 * {@link MAP_TEXTURE_UNIT}, so the two cannot share. It is bound once per
 * frame, before the view loop, and unbound in that frame's `finally` — see
 * `webgl-renderer.ts`.
 */
export const SHADOW_TEXTURE_UNIT = 1;

/**
 * Packed metallic-roughness map unit (`StandardMaterial.metalRoughnessMap`).
 * Unit 2: 0 is albedo, 1 is the shadow map that stays live across a shaded
 * draw. Node-material samplers also start at 2 and overwrite this unit on
 * their own draws — never simultaneous. Unbound in `render`'s `finally`.
 */
export const METAL_ROUGHNESS_TEXTURE_UNIT = 2;

/**
 * Emissive map unit (`StandardMaterial.emissiveMap`). Unit 3: 0 is albedo,
 * 1 is the shadow map that stays live across a shaded draw, 2 is the packed
 * metallic-roughness map. Node-material samplers that occupy two or more
 * units also reach 3 on their own draws — never simultaneous with a standard
 * draw's emissive bind. Unbound in `render`'s `finally`.
 *
 * WebGPU does not sample this slot: groups 2 and 3 already hold albedo and
 * metallic-roughness when both maps exist, and the four-group budget is full.
 */
export const EMISSIVE_TEXTURE_UNIT = 3;

/**
 * The MVP vertex stage: object space → clip space, plus the two optional
 * streams the fragment stage may multiply by.
 *
 * `viewProjection` is `projection * view` and is uploaded once per viewport;
 * `model` is the render item's world matrix and changes per draw. Splitting
 * them (rather than uploading one pre-multiplied MVP) keeps the per-draw upload
 * to one matrix and matches how §64's render items are already shaped.
 *
 * `uv` and `vertexColor` were added by R-19 (2026-08-07). `gl_Position` is
 * computed from exactly the same expression as before, so a scene that uses
 * neither rasterizes identically — which is what the pixel goldens check.
 */
const VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 2) in vec2 uv;
layout(location = 3) in vec4 vertexColor;

uniform mat4 viewProjection;
uniform mat4 model;

out vec2 vUv;
out vec4 vColor;

void main() {
  vUv = uv;
  vColor = vertexColor;
  gl_Position = viewProjection * model * vec4(position, 1.0);
}
`;

/**
 * The MVP fragment stage: one flat colour (§57 `UnlitMaterial`), optionally
 * multiplied by a texture sample and by the interpolated vertex colour.
 *
 * `highp` because GLSL ES 3.00 requires fragment-stage `highp` support (unlike
 * ES 1.00, where `mediump` was the portable floor), and because the colour is
 * written straight to the framebuffer — there is nothing to gain from a lower
 * precision here. Straight (non-premultiplied) alpha, linear-light components,
 * matching `Viewport.clearColor` and §60a.
 *
 * ## One program, two uniform switches (decision, R-19)
 *
 * `useMap` and `useVertexColors` are **uniforms, not `#define`d variants**. A
 * variant set would mean two more programs to compile at initialization (or a
 * lazy compile inside `render`, which §61 forbids throwing from), two more sets
 * of uniform locations to keep, and a pipeline switch between a textured and an
 * untextured draw. The switch costs one uniform branch per fragment on a
 * pipeline that does nothing else, and — the property that mattered — **a
 * material that names neither feature issues no additional GL call at all**:
 * both uniforms sit at GL's initial `0`, the backend mirrors that on the CPU,
 * and it uploads only when a draw actually changes them.
 *
 * With both off, `fragColor` is assigned `color` with no arithmetic in between,
 * so the frame is bit-identical to the one this shader drew before R-19.
 *
 * Exported (RFC 0003, 2026-08-28) because the skinned unlit pipeline
 * (`gl-skinning.ts`) is this fragment stage over a different **vertex** stage
 * — one source, not a copy that could drift, and no new bytes in any bundle,
 * since the string already rides wherever `WebglRenderer` does.
 */
export const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform vec4 color;
uniform sampler2D map;
uniform bool useMap;
uniform bool useVertexColors;

in vec2 vUv;
in vec4 vColor;

out vec4 fragColor;

void main() {
  vec4 result = color;
  if (useVertexColors) {
    result *= vColor;
  }
  if (useMap) {
    result *= texture(map, vUv);
  }
  fragColor = result;
}
`;

/**
 * The sprite vertex stage: object space → clip space, plus the authored uv
 * the fragment stage samples with (§55 atlas packet).
 *
 * `Sprite` writes the atlas cell onto `BufferGeometry.uvs` at the same fixed
 * {@link UV_ATTRIBUTE_LOCATION} the unlit `map` path already binds, so one
 * geometry cache serves both pipelines. There is no `quad` uniform: a frame
 * change is a versioned attribute rewrite, not a per-draw `vec4`.
 *
 * `v = 0` is the quad's **bottom** edge, matching §7a's Y-up world and the
 * bottom-row-first texel order `@fourjs/render`'s `TextureSource` documents.
 */
const SPRITE_VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 2) in vec2 uv;

uniform mat4 viewProjection;
uniform mat4 model;

out vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = viewProjection * model * vec4(position, 1.0);
}
`;

/**
 * The sprite fragment stage: one texture sample, multiplied by a tint (§55).
 *
 * Both sides are **straight (non-premultiplied) alpha** — §66 requires the
 * engine to state its policy, and the MVP tier commits to straight, matching
 * `UnlitMaterial.color`, `SpriteMaterial.tint`, and `Viewport.clearColor`. The
 * multiply is therefore componentwise, and the blend equation that consumes it
 * is `SRC_ALPHA`/`ONE_MINUS_SRC_ALPHA` (see `webgl-renderer.ts`).
 *
 * No alpha test and no discard: §66 lists alpha test and alpha-to-coverage as
 * requirements, and both are material state that §57's `Material` base has to
 * carry before a shader can branch on it.
 */
const SPRITE_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D map;
uniform vec4 tint;

in vec2 vUv;

out vec4 fragColor;

void main() {
  fragColor = texture(map, vUv) * tint;
}
`;

/**
 * The **light set** every shaded fragment stage shares (§68, R-17 2026-08-09):
 * the uniform array declarations and the one function that turns a light index
 * plus a world position into an irradiance and a direction to shade with.
 *
 * One string, spliced into both `LIT_FRAGMENT_SHADER_SOURCE` and
 * `gl-standard.ts`'s stage, rather than two copies: the falloff and the cone
 * are one model and a scene mixing a `LitMaterial` with a `StandardMaterial`
 * under the same lamp must not be able to disagree about it. It also ships the
 * text once in a bundle instead of twice, which on this backend is real bytes
 * (§86).
 *
 * ## Names, and why the count is an `int` uniform
 *
 * `punctualCount` is a *uniform*, not a `#define`, so one linked program shades
 * a scene with any number of lamps from zero to
 * {@link @fourjs/render!MAX_PUNCTUAL_LIGHTS} — the uniform-switch argument
 * `useMap` records, one size up. That it is an `int` uniform is also the whole
 * byte-identity story: GL initializes it to `0`, so a program whose scene has
 * no punctual light never uploads it, the loop below never runs, and the frame
 * emits exactly the GL sequence it emitted before this chunk existed.
 *
 * ## The model (§68, "physically coherent units where practical")
 *
 * ```text
 * d           = |lightPosition − p|
 * attenuation = 1 / max(d², 1e-8)
 *             × clamp(1 − (d / range)⁴, 0, 1)        when range > 0
 *             × clamp((cos θ − cos outer) × z, 0, 1) when the light is a spot
 * ```
 *
 * Inverse-square because a point emitter obeys it; the range window and the
 * cone ramp are `KHR_lights_punctual`'s, so a loaded glTF light transfers
 * without reinterpretation. `punctualParams[i].z` is the precomputed
 * `1 / max(cos inner − cos outer, 1e-6)` — see `@fourjs/render`'s `lights.ts`,
 * which packs it.
 *
 * The `max(d², 1e-8)` is the same placement rule R-13 fixed for `roughness`:
 * the guard lives where the division does. A surface at the light's exact
 * position renders very bright, never `NaN`.
 *
 * No `1/π` appears anywhere, here or in either lobe that consumes this — the
 * engine's light colour × intensity is an irradiance already divided by π
 * (R-13, 2026-08-08), which is what lets a point light and the directional
 * light add up to one lighting model.
 */
export const PUNCTUAL_LIGHT_GLSL = `const int MAX_PUNCTUAL_LIGHTS = ${String(
  MAX_PUNCTUAL_LIGHTS,
)};
uniform int punctualCount;
uniform vec3 punctualPosition[MAX_PUNCTUAL_LIGHTS];
uniform vec3 punctualColor[MAX_PUNCTUAL_LIGHTS];
uniform vec3 punctualDirection[MAX_PUNCTUAL_LIGHTS];
uniform vec4 punctualParams[MAX_PUNCTUAL_LIGHTS];

vec3 punctualIrradiance(int i, vec3 p, out vec3 l) {
  vec3 offset = punctualPosition[i] - p;
  float distanceSquared = max(dot(offset, offset), 1e-8);
  float d = sqrt(distanceSquared);
  l = offset / d;
  vec4 params = punctualParams[i];
  float attenuation = 1.0 / distanceSquared;
  if (params.x > 0.0) {
    float ratio = d / params.x;
    float squared = ratio * ratio;
    attenuation *= clamp(1.0 - squared * squared, 0.0, 1.0);
  }
  if (params.w > 0.0) {
    float cosTheta = dot(punctualDirection[i], -l);
    attenuation *= clamp((cosTheta - params.y) * params.z, 0.0, 1.0);
  }
  return punctualColor[i] * attenuation;
}
`;

/**
 * The hemisphere chunk both shaded fragment stages splice in (§68;
 * 2026-09-10) — a two-colour directional ambient, not a lamp.
 *
 * ```text
 * w    = 0.5 · n · up + 0.5
 * hemi = mix(ground, sky, w)
 * ```
 *
 * Sky and ground are already `color × intensity` (R-13). `useHemisphere`
 * starts at GL's initial `false`, so a scene with no hemisphere issues
 * **no upload at all** — {@link HemisphereLightUniforms}' skip rule, the
 * same contract {@link PunctualLightUniforms} states for the light set.
 * A fragment with no normal uses the 0.5 mix (constant extra ambient)
 * rather than inventing a world-up; a metal on the standard stage still
 * multiplies the term by the diffuse colour, so it stays black.
 */
export const HEMISPHERE_LIGHT_GLSL = `uniform vec3 hemisphereSky;
uniform vec3 hemisphereGround;
uniform vec3 hemisphereUp;
uniform bool useHemisphere;

vec3 hemisphereAmbient(float normalLength, vec3 n) {
  if (!useHemisphere) {
    return vec3(0.0);
  }
  float w = normalLength > 0.0
    ? clamp(0.5 * dot(n, hemisphereUp) + 0.5, 0.0, 1.0)
    : 0.5;
  return mix(hemisphereGround, hemisphereSky, w);
}
`;

const HEMISPHERE_UNIFORM_NAMES = [
  "hemisphereSky",
  "hemisphereGround",
  "hemisphereUp",
  "useHemisphere",
] as const;

/**
 * One shaded pipeline's hemisphere uniforms: the four locations, and the
 * CPU mirror that keeps a scene without a hemisphere emitting **no GL
 * call at all**.
 *
 * Shared by {@link LitProgram}, `gl-standard.ts`'s `StandardProgram`, and
 * the skinned lit program for the same reason {@link PunctualLightUniforms}
 * is shared: the skip rule must not drift.
 *
 * `#enabled` starts at `false`, which is what GL initializes a `bool`
 * uniform to. A frame whose `SceneLights.hasHemisphereLight` is `false`
 * while the mirror is `false` therefore uploads nothing.
 */
export class HemisphereLightUniforms {
  readonly #gl: WebglContext;

  readonly #locations: readonly GlUniformLocation[];

  /** CPU mirror of `useHemisphere`, seeded at GL's initial value. */
  #enabled = false;

  private constructor(
    gl: WebglContext,
    locations: readonly GlUniformLocation[],
  ) {
    this.#gl = gl;
    this.#locations = locations;
  }

  /**
   * Looks the four locations up on a linked program, throwing the §89
   * `SHADER_COMPILATION_FAILED` `requireUniform` throws if a driver
   * optimised one away.
   */
  static resolve(
    gl: WebglContext,
    program: GlProgramHandle,
    label: string,
  ): HemisphereLightUniforms {
    return new HemisphereLightUniforms(
      gl,
      HEMISPHERE_UNIFORM_NAMES.map((name) =>
        requireUniform(gl, program, name, label),
      ),
    );
  }

  /**
   * Uploads the frame's hemisphere, or nothing at all — see the class
   * header. Call once per viewport, beside the ambient upload.
   */
  upload(lights: SceneLights): void {
    const gl = this.#gl;
    const at = this.#locations;
    if (lights.hasHemisphereLight) {
      const up = lights.hemisphereUp;
      vec3Scratch.set(lights.hemisphereSky);
      gl.uniform3fv(at[0], vec3Scratch);
      vec3Scratch.set(lights.hemisphereGround);
      gl.uniform3fv(at[1], vec3Scratch);
      vec3Scratch[0] = up.x;
      vec3Scratch[1] = up.y;
      vec3Scratch[2] = up.z;
      gl.uniform3fv(at[2], vec3Scratch);
      if (!this.#enabled) {
        gl.uniform1i(at[3], 1);
        this.#enabled = true;
      }
    } else if (this.#enabled) {
      gl.uniform1i(at[3], 0);
      this.#enabled = false;
    }
  }
}

/**
 * The five uniform names {@link PUNCTUAL_LIGHT_GLSL} declares, in the order
 * {@link PunctualLightUniforms.resolve} looks them up.
 *
 * The array names carry an explicit `[0]` subscript. WebGL 2 accepts either
 * spelling for the first element of a uniform array, and the subscripted one is
 * what the GLSL ES 3.00 specification names as *the* form — worth a few
 * characters, because a name that resolves to `null` on one driver and a
 * location on another would turn into a §89 throw at initialization on exactly
 * the machines nobody develops on.
 */
const PUNCTUAL_UNIFORM_NAMES = [
  "punctualCount",
  "punctualPosition[0]",
  "punctualColor[0]",
  "punctualDirection[0]",
  "punctualParams[0]",
] as const;

/**
 * One shaded pipeline's light-set uniforms: the five locations, and the CPU
 * mirror that keeps a scene without point or spot lights emitting **no GL call
 * at all** (R-17, 2026-08-09).
 *
 * Shared by {@link LitProgram} and `gl-standard.ts`'s `StandardProgram`
 * because the upload is not a per-pipeline decision — the two stages consume
 * the identical `SceneLights` arrays through the identical GLSL chunk, and a
 * class each would be two places for the skip rule to drift apart.
 *
 * ## The skip rule, and why it is byte-identity rather than an optimisation
 *
 * `#count` starts at `0`, which is what GL initializes an `int` uniform to. A
 * frame whose `SceneLights.punctualCount` is `0` while the mirror is `0`
 * therefore uploads nothing — not the count, not the four arrays — so a scene
 * lit by a directional light and an ambient term issues byte-for-byte the GL
 * sequence it issued before this class existed. The same technique as R-15's
 * `bool` encode switch and R-38's permissive layer mask; the third confirmation
 * that *seeding a CPU mirror at GL's own initial value* is how a feature is
 * added to this backend for free.
 *
 * When the count *is* non-zero the whole array is uploaded, dead tail included,
 * rather than a live sub-range: `uniform3fv` over the record's own
 * `Float32Array` copies nothing on the way (the reason `@fourjs/render` packs
 * those arrays as typed arrays), and a sub-range upload would need the
 * `srcOffset`/`srcLength` overloads this backend's hand-written GL surface
 * deliberately does not carry.
 */
export class PunctualLightUniforms {
  readonly #gl: WebglContext;

  readonly #locations: readonly GlUniformLocation[];

  /** CPU mirror of `punctualCount`, seeded at GL's initial value. */
  #count = 0;

  private constructor(
    gl: WebglContext,
    locations: readonly GlUniformLocation[],
  ) {
    this.#gl = gl;
    this.#locations = locations;
  }

  /**
   * Looks the five locations up on a linked program, throwing the §89
   * `SHADER_COMPILATION_FAILED` `requireUniform` throws if a driver optimised
   * one away — which it cannot, since the loop bound is a uniform.
   *
   * @param label the pipeline name used in the failure message
   */
  static resolve(
    gl: WebglContext,
    program: GlProgramHandle,
    label: string,
  ): PunctualLightUniforms {
    return new PunctualLightUniforms(
      gl,
      PUNCTUAL_UNIFORM_NAMES.map((name) =>
        requireUniform(gl, program, name, label),
      ),
    );
  }

  /**
   * Uploads the frame's point and spot lights (§68), or nothing at all — see
   * the class header for when, and for why "nothing at all" is the contract
   * rather than a shortcut. Call once per viewport, beside the ambient and
   * directional uploads.
   */
  upload(lights: SceneLights): void {
    const count = lights.punctualCount;
    if (count > 0) {
      this.#gl.uniform3fv(this.#locations[1], lights.punctualPositions);
      this.#gl.uniform3fv(this.#locations[2], lights.punctualColors);
      this.#gl.uniform3fv(this.#locations[3], lights.punctualDirections);
      this.#gl.uniform4fv(this.#locations[4], lights.punctualParams);
    }
    if (count !== this.#count) {
      this.#gl.uniform1i(this.#locations[0], count);
      this.#count = count;
    }
  }
}

/**
 * The receiver chunk both shaded fragment stages splice in (§69; R-18,
 * 2026-08-09) — the shared half of shadowing, exactly as
 * {@link PUNCTUAL_LIGHT_GLSL} is the shared half of the light set.
 *
 * ```text
 * p      = worldPosition + n · shadowNormalBias
 * c      = (shadowMatrix · vec4(p, 1)).xyz / w,  mapped from [-1,1] to [0,1]
 * factor = (1/9) Σ over the 3×3 texel neighbourhood of c.xy
 *                [ c.z − shadowBias  ≤  depth(tap) ]
 * ```
 *
 * Four properties are load-bearing and each is a decision:
 *
 * - **Outside the volume is lit, not shadowed.** A receiver whose mapped
 *   coordinate leaves the unit cube on *any* axis — past the near or far plane,
 *   or outside the map's own rectangle — returns `1.0`. One `any(lessThan) ||
 *   any(greaterThan)` covers all three axes, which is both shorter and exactly
 *   the claim. An under-sized `extent` then reads as "shadows stop here", which
 *   an author can see and fix, rather than as "the world beyond the box went
 *   black".
 * - **The perspective divide is performed although this tier's projection is
 *   orthographic** (`w` is 1). It costs one division per fragment and is what
 *   lets §69's spot-light shadows reuse this chunk unchanged when they land.
 * - **`shadowBias` is subtracted from the receiver rather than added to the
 *   caster**, so the sign convention matches every other engine's: a positive
 *   bias moves the surface *towards* the light.
 * - **The normal bias offsets the sample position, not the depth.** It is a
 *   world-space displacement (§40 metres), the only form that scales correctly
 *   with a surface's slope; a constant depth bias cannot.
 *
 * ## Why explicit taps and not hardware PCF
 *
 * GLES 3.00 offers `sampler2DShadow` with `TEXTURE_COMPARE_MODE`, which gives a
 * free 2×2 comparison-filtered tap. This tier uses a plain `sampler2D` with
 * `NEAREST` filtering and nine explicit taps instead:
 *
 * - the comparison mode is *sampler state*, so it would have to be set on the
 *   attachment `gl-render-target.ts` allocates — coupling that cache to what a
 *   particular consumer intends to do with a depth texture, which is exactly
 *   the coupling its design avoids;
 * - a 2×2 hardware tap is a smaller filter than §69's "percentage-closer
 *   filtering" suggests, and widening it later would mean nine *shadow* samples
 *   rather than nine plain ones — no cheaper;
 * - what the taps do is arithmetic this engine can state and test. What a
 *   driver does inside a shadow sampler is not something a fake GL context can
 *   assert anything about, and §33's language is worth the two instructions.
 *
 * The loop bounds are constants, so the nine taps unroll; the tap offset
 * arrives as `shadowTexelSize = 1 / mapSize`, computed once per frame on the
 * CPU rather than once per fragment here.
 */
export const SHADOW_GLSL = `uniform bool useShadow;
uniform sampler2D shadowMap;
uniform mat4 shadowMatrix;
uniform float shadowBias;
uniform float shadowNormalBias;
uniform float shadowTexelSize;

float shadowFactor(vec3 worldPosition, vec3 n) {
  vec4 lightSpace = shadowMatrix * vec4(worldPosition + n * shadowNormalBias, 1.0);
  vec3 c = (lightSpace.xyz / lightSpace.w) * 0.5 + 0.5;
  if (any(lessThan(c, vec3(0.0))) || any(greaterThan(c, vec3(1.0)))) {
    return 1.0;
  }
  float receiver = c.z - shadowBias;
  float lit = 0.0;
  for (int y = -1; y <= 1; y += 1) {
    for (int x = -1; x <= 1; x += 1) {
      float occluder = texture(shadowMap, c.xy + vec2(x, y) * shadowTexelSize).r;
      lit += receiver <= occluder ? 1.0 : 0.0;
    }
  }
  return lit / 9.0;
}
`;

/**
 * The six uniform names {@link SHADOW_GLSL} declares, in the order
 * {@link ShadowUniforms.resolve} looks them up.
 *
 * None can be optimised away: `useShadow` gates a branch the compiler cannot
 * resolve, and every other name is reached from inside it.
 */
const SHADOW_UNIFORM_NAMES = [
  "useShadow",
  "shadowMap",
  "shadowMatrix",
  "shadowBias",
  "shadowNormalBias",
  "shadowTexelSize",
] as const;

/**
 * One shaded pipeline's shadow uniforms: the six locations, the sampler-unit
 * upload, and the CPU mirror that keeps a frame with no casting light emitting
 * **no GL call at all** (§69, R-18).
 *
 * ```ts
 * const shadows = ShadowUniforms.resolve(gl, program, "lit");
 * shadows.uploadView(lights);                            // once per viewport
 * shadows.setReceiving(active && item.receiveShadow);    // once per draw
 * ```
 *
 * Shared by {@link LitProgram} and `gl-standard.ts`'s `StandardProgram` for
 * {@link PunctualLightUniforms}' reason: the two stages consume the identical
 * `SceneLights` fields through the identical GLSL chunk, and a class each would
 * be two places for the skip rule to drift apart.
 *
 * ## The skip rule, and why it is byte-identity rather than an optimisation
 *
 * `useShadow` is a `bool` uniform whose CPU mirror starts at `false`, which is
 * what GL initializes a `bool` uniform to. A frame in which no light casts
 * therefore uploads nothing at all — not the matrix, not the biases, not the
 * sampler, not the switch — so a scene lit the way every scene was lit before
 * §69 shipped issues byte-for-byte the GL sequence it always did. The
 * mirror-at-GL-initial-0 technique on its fourth recorded use (R-15's `bool`
 * encode switch, R-38's permissive layer mask, R-17's light count).
 *
 * The **pixel** half of that claim lives in the two shaded fragment stages, and
 * is kept the way R-17 kept it: the shadow term multiplies the *existing*
 * directional expression inside an `if (useShadow)`, so with the switch off the
 * arithmetic is the arithmetic those stages performed before, operation for
 * operation. Nothing is re-associated.
 *
 * The split between the two methods is the split between per-*view* state (the
 * matrix and the biases, which belong to the light) and per-*draw* state (§49's
 * `receiveShadow`, which belongs to the node).
 */
export class ShadowUniforms {
  readonly #gl: WebglContext;

  readonly #locations: readonly GlUniformLocation[];

  /** CPU mirror of `useShadow`, seeded at GL's initial value. */
  #receiving = false;

  /** Whether the sampler unit has been uploaded; see {@link LitProgram.setFeatures}. */
  #samplerUploaded = false;

  private constructor(
    gl: WebglContext,
    locations: readonly GlUniformLocation[],
  ) {
    this.#gl = gl;
    this.#locations = locations;
  }

  /**
   * Looks the six locations up on a linked program, throwing the §89
   * `SHADER_COMPILATION_FAILED` `requireUniform` throws if one is missing.
   *
   * @param label the pipeline name used in the failure message
   */
  static resolve(
    gl: WebglContext,
    program: GlProgramHandle,
    label: string,
  ): ShadowUniforms {
    return new ShadowUniforms(
      gl,
      SHADOW_UNIFORM_NAMES.map((name) =>
        requireUniform(gl, program, name, label),
      ),
    );
  }

  /**
   * Uploads the frame's shadow matrix, biases and tap size — or nothing at
   * all, when `lights.hasShadow` is `false`. Call once per viewport, beside the
   * ambient and directional uploads.
   *
   * The sampler unit is uploaded lazily, on the first view that actually has a
   * shadow, exactly as the albedo sampler is: a pipeline that never shades a
   * shadowed frame never mentions the unit.
   */
  uploadView(lights: SceneLights): void {
    if (!lights.hasShadow) {
      return;
    }
    const gl = this.#gl;
    if (!this.#samplerUploaded) {
      gl.uniform1i(this.#locations[1], SHADOW_TEXTURE_UNIT);
      this.#samplerUploaded = true;
    }
    matrixScratch.set(lights.shadowMatrix.elements);
    gl.uniformMatrix4fv(this.#locations[2], false, matrixScratch);
    gl.uniform1f(this.#locations[3], lights.shadowBias);
    gl.uniform1f(this.#locations[4], lights.shadowNormalBias);
    // `1 / mapSize`, computed once per frame here rather than once per fragment
    // in the tap loop. `mapSize` is a positive integer — `@fourjs/scene` refuses
    // anything else — and `hasShadow` is only true for a light carrying a valid
    // record, so this cannot divide by zero on the path that reaches it.
    gl.uniform1f(this.#locations[5], 1 / lights.shadowMapSize);
  }

  /**
   * Switches the shadow comparison on or off for the draw about to be issued
   * (§49's `receiveShadow`, §69) — mirrored on the CPU and uploaded only on
   * change, exactly as {@link LitProgram.setFeatures} mirrors `useMap`.
   *
   * Pass `lights.hasShadow && item.receiveShadow`: the two reasons a draw is
   * not shadowed are "nothing casts" and "this node opted out", and folding
   * them into one uniform is what keeps a shadowless frame at zero calls while
   * a non-receiver inside a shadowed frame costs exactly one.
   */
  setReceiving(receiving: boolean): void {
    if (receiving === this.#receiving) {
      return;
    }
    this.#gl.uniform1i(this.#locations[0], receiving ? 1 : 0);
    this.#receiving = receiving;
  }
}

/**
 * The lit vertex stage (§68): object space → clip space, plus the world-space
 * normal the fragment stage shades with.
 *
 * The normal is transformed by the **inverse transpose** of the model
 * matrix's upper 3×3 — the standard fix for non-uniform scale, under which
 * the plain 3×3 would bend normals off their surfaces. That matrix is
 * `Matrix3.setNormalFromMatrix4` on the CPU, uploaded once per draw as
 * `uniform mat3 normalMatrix` (the 2026-08-04 staging note: landed 2026-09-09).
 * Pixel-identical to the previous per-vertex `transpose(inverse(mat3(model)))`
 * on any non-singular model; a singular model leaves the scratch identity,
 * matching invert()'s no-op rather than GLSL's undefined inverse.
 */
const LIT_VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in vec2 uv;

uniform mat4 viewProjection;
uniform mat4 model;
uniform mat3 normalMatrix;

out vec3 vNormal;
out vec3 vWorldPosition;
out vec2 vUv;

void main() {
  vNormal = normalMatrix * normal;
  vWorldPosition = (model * vec4(position, 1.0)).xyz;
  vUv = uv;
  gl_Position = viewProjection * model * vec4(position, 1.0);
}
`;

/**
 * The lit fragment stage (§57 `LitMaterial`, §68, §60a): Lambert diffuse under
 * one directional light, plus the scene ambient term.
 *
 * ```text
 * fragColor.rgb = color.rgb * (ambientLight
 *                            + hemisphere
 *                            + lightColor * max(dot(N, -L), 0)
 *                            + Σᵢ irradianceᵢ * max(dot(N, Lᵢ), 0))
 * fragColor.a   = color.a
 * ```
 *
 * `hemisphere` is the two-colour sky/ground mix {@link HEMISPHERE_LIGHT_GLSL}
 * evaluates; with `useHemisphere` at GL's initial `false` it is the zero
 * vector and the arithmetic is the arithmetic this stage performed before
 * the hemisphere existed.
 *
 * The sum runs over the frame's point and spot lights (R-17, 2026-08-09) —
 * see {@link PUNCTUAL_LIGHT_GLSL} for the falloff and the cone. It is written
 * as a term *added to* the pre-existing expression, in that order, rather than
 * as a rewrite of it: with `punctualCount` at GL's initial `0` the loop never
 * runs and the arithmetic is the arithmetic this stage performed before the
 * light set existed, operation for operation.
 *
 * - `lightDirection` is the **direction the light travels** (world space,
 *   unit), so the surface term is `dot(N, -L)`; `lightColor` arrives
 *   premultiplied by intensity (`SceneLights.directionalColor`), and a
 *   no-light frame uploads black, which zeroes the Lambert term — one shader,
 *   no variants.
 * - The interpolated normal is re-normalized, guarded against zero length: a
 *   geometry with no normal stream reads the attribute default `(0, 0, 0, 1)`,
 *   whose xyz would turn `normalize()` into NaN — the guard turns it into
 *   "ambient only" instead, the documented shading of a normal-less lit draw.
 * - Lambert is one-sided: a face lit from behind gets `dot ≤ 0`, i.e. ambient
 *   only. With back-face culling off (see `webgl-renderer.ts`) that is the
 *   physically honest look for a plane's back.
 * - Straight alpha, linear-light arithmetic on plain 0…1 numbers; §60a's
 *   transfer functions and tone mapping are a later packet, as everywhere.
 * - `useMap` multiplies the **base colour**, before the lighting term, so a
 *   texture is an albedo and the lights shade it (R-19). Off, the expression
 *   below reduces to exactly the one this shader carried before, uniform switch
 *   and all — see `FRAGMENT_SHADER_SOURCE` for why a uniform, not a variant.
 *
 * ## The shadow (R-18, 2026-08-09)
 *
 * §69's shadow attenuates the **directional** term only — the light set has no
 * shadow maps at this tier ({@link SHADOW_GLSL}, `@fourjs/scene`'s
 * `DirectionalLightShadow`) — and it does so as a multiplication *into* the
 * pre-existing product, in source order:
 *
 * ```text
 * direct   = lightColor * diffuse
 * direct  *= shadowFactor(...)          only when useShadow
 * lighting = ambientLight + direct
 * ```
 *
 * With `useShadow` at GL's initial `false` that is `ambientLight + lightColor *
 * diffuse`, the identical expression this stage evaluated before shadows
 * existed, operation for operation — the pixel half of the byte-identity claim
 * {@link ShadowUniforms} makes about the GL half. The `len > 0.0` guard rides
 * along because the receiver's normal is what the normal-bias offsets, and a
 * geometry with no normal stream has none to offset.
 */
export const LIT_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform vec4 color;
uniform sampler2D map;
uniform bool useMap;
uniform vec3 ambientLight;
uniform vec3 lightDirection;
uniform vec3 lightColor;

in vec3 vNormal;
in vec3 vWorldPosition;
in vec2 vUv;

out vec4 fragColor;

${PUNCTUAL_LIGHT_GLSL}
${HEMISPHERE_LIGHT_GLSL}
${SHADOW_GLSL}
void main() {
  float len = length(vNormal);
  vec3 n = len > 0.0 ? vNormal / len : vec3(0.0);
  float diffuse = len > 0.0
    ? max(dot(n, -lightDirection), 0.0)
    : 0.0;
  vec4 base = color;
  if (useMap) {
    base *= texture(map, vUv);
  }
  vec3 direct = lightColor * diffuse;
  if (useShadow && len > 0.0) {
    direct *= shadowFactor(vWorldPosition, n);
  }
  vec3 lighting = ambientLight + hemisphereAmbient(len, n) + direct;
  if (len > 0.0) {
    for (int i = 0; i < punctualCount; i += 1) {
      vec3 l;
      lighting += punctualIrradiance(i, vWorldPosition, l) * max(dot(n, l), 0.0);
    }
  }
  fragColor = vec4(base.rgb * lighting, base.a);
}
`;

/**
 * Scratch for matrix uploads.
 *
 * `Matrix4.elements` is a `Float64Array` (the engine computes in doubles);
 * `uniformMatrix4fv` wants 32-bit floats. One module-level buffer, reused by
 * every upload of every program — including `gl-particles.ts`'s, which imports
 * it — keeps the per-draw cost to a 16-element `set()` and allocates nothing
 * per frame (plan D7). Safe to share because uploads are synchronous: the data
 * is consumed by the GL call before the next `set()` can happen.
 */
export const matrixScratch = new Float32Array(16);

/**
 * Scratch for the lit/standard `uniform mat3 normalMatrix` upload.
 *
 * A dedicated 9-float buffer rather than a view onto {@link matrixScratch}:
 * `setModel` writes the 4×4 first, and the GL call consumes that buffer
 * synchronously, but a shared backing store would still make recording
 * doubles (which keep the argument by reference) rewrite every earlier
 * `uniformMatrix4fv` line with the 3×3's tail. One extra 36-byte array,
 * module-level, never per draw.
 */
const matrix3Scratch = new Float32Array(9);

/**
 * Reused {@link Matrix3} for {@link uploadNormalMatrix}. Constructed once;
 * `setNormalFromMatrix4` mutates in place and allocates nothing (plan D7).
 */
const normalMatrixScratch = new Matrix3();

/**
 * Derives `transpose(inverse(upper 3×3))` of `model` and uploads it as a
 * column-major `mat3`. Seeds the scratch to identity first so a singular
 * model (invert no-op) cannot leak the previous draw's inverse-transpose.
 */
export function uploadNormalMatrix(
  gl: WebglContext,
  location: GlUniformLocation,
  model: Matrix4,
): void {
  normalMatrixScratch.identity();
  normalMatrixScratch.setNormalFromMatrix4(model);
  matrix3Scratch.set(normalMatrixScratch.elements);
  gl.uniformMatrix3fv(location, false, matrix3Scratch);
}

/** Scratch for {@link UnlitProgram.setColor}; see {@link matrixScratch}. */
const colorScratch = new Float32Array(4);

/** Scratch for the lit pipeline's `vec3` uploads; see {@link matrixScratch}. */
const vec3Scratch = new Float32Array(3);

/**
 * Compiles one shader stage, or throws.
 *
 * The info log travels in the {@link FourError} `context` rather than in the
 * message: §89's codes are for machines, the log is for a human, and putting a
 * multi-line driver log inside an exception message makes both harder to read.
 *
 * `label` names the pipeline in the message only — the code and the `context`
 * fields are identical for every program, so a caller matching on §89's code
 * does not have to care which pipeline failed, and a human reading the message
 * immediately does.
 */
function compileStage(
  gl: WebglContext,
  type: number,
  source: string,
  stageName: string,
  label: string,
): GlShader {
  const shader = gl.createShader(type);
  if (shader === null) {
    throw new FourError(
      "SHADER_COMPILATION_FAILED",
      `WebGL 2 could not allocate the ${stageName} shader object (§61).`,
      { context: { stage: stageName } },
    );
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, GL.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "";
    gl.deleteShader(shader);
    throw new FourError(
      "SHADER_COMPILATION_FAILED",
      `The ${label} ${stageName} shader failed to compile (§61, §89).`,
      { context: { stage: stageName, log, source } },
    );
  }

  return shader;
}

/**
 * Compiles both stages and links them into a program, or throws — the half of
 * every pipeline's `create` ({@link UnlitProgram}, {@link SpriteProgram},
 * {@link LitProgram}, and `gl-particles.ts`'s `ParticleProgram`) that is
 * identical for all of them.
 *
 * Throws a {@link FourError} carrying `SHADER_COMPILATION_FAILED` (§89) with the
 * driver's info log in `context.log` when a stage fails to compile, when linking
 * fails, or when GL refuses to allocate an object. One failure code covers
 * compile *and* link because §89 defines one, and because the two are one
 * operation from a caller's point of view: the program either exists or it does
 * not. `context.stage` says which half failed.
 *
 * Shader objects are deleted on every path — successful or not — because they
 * are only needed until the link completes. Attached shaders are
 * reference-counted by the program, so deleting them frees the compiler-side
 * objects and leaves the linked program intact, which is the standard GL idiom.
 */
export function createLinkedProgram(
  gl: WebglContext,
  label: string,
  vertexSource: string,
  fragmentSource: string,
): GlProgramHandle {
  const vertexShader = compileStage(
    gl,
    GL.VERTEX_SHADER,
    vertexSource,
    "vertex",
    label,
  );

  let fragmentShader: GlShader;
  try {
    fragmentShader = compileStage(
      gl,
      GL.FRAGMENT_SHADER,
      fragmentSource,
      "fragment",
      label,
    );
  } catch (error: unknown) {
    gl.deleteShader(vertexShader);
    throw error;
  }

  try {
    const program = gl.createProgram();
    if (program === null) {
      throw new FourError(
        "SHADER_COMPILATION_FAILED",
        `WebGL 2 could not allocate the ${label} program object (§61).`,
        { context: { stage: "link" } },
      );
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, GL.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? "";
      gl.deleteProgram(program);
      throw new FourError(
        "SHADER_COMPILATION_FAILED",
        `The ${label} program failed to link (§61, §89).`,
        { context: { stage: "link", log } },
      );
    }

    return program;
  } finally {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
  }
}

/** Looks a uniform up, or throws — see {@link UnlitProgram.create}. */
export function requireUniform(
  gl: WebglContext,
  program: GlProgramHandle,
  name: string,
  label: string,
): GlUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (location === null) {
    throw new FourError(
      "SHADER_COMPILATION_FAILED",
      `The ${label} program has no active uniform "${name}"; the linked ` +
        "program is not the one this backend wrote (§61).",
      { context: { uniform: name } },
    );
  }
  return location;
}

/**
 * The single pipeline the MVP tier draws with (§120): unlit, flat-coloured,
 * position-only geometry.
 *
 * ```ts
 * const program = UnlitProgram.create(gl);
 * program.use();
 * program.setViewProjection(viewProjection);   // once per viewport
 * program.setModel(item.worldMatrix);          // once per draw
 * program.setColor(item.material.color);
 * program.setFeatures(hasMap, material.vertexColors);
 * ```
 *
 * Owns its GL objects and nothing else. It is **not** re-created on context
 * loss by itself: the renderer drops its reference when the context goes away
 * and calls {@link UnlitProgram.create} again on restore (§61's "re-creates
 * engine-owned GPU resources"), because only the renderer knows which context
 * is the live one.
 */
export class UnlitProgram implements Disposable {
  readonly #gl: WebglContext;

  readonly #program: GlProgramHandle;

  readonly #viewProjectionLocation: GlUniformLocation;

  readonly #modelLocation: GlUniformLocation;

  readonly #colorLocation: GlUniformLocation;

  readonly #mapLocation: GlUniformLocation;

  readonly #useMapLocation: GlUniformLocation;

  readonly #useVertexColorsLocation: GlUniformLocation;

  /**
   * CPU mirror of the two feature uniforms, seeded with GL's own initial value
   * for an `int`/`bool` uniform — `0`, i.e. both off. Because the mirror starts
   * where GL starts, a frame that never enables a feature never issues a
   * `uniform1i`, which is the whole point (see `FRAGMENT_SHADER_SOURCE`).
   *
   * Uniform values live in the program object, so the mirror stays accurate
   * across pipeline switches, views, and frames; a context loss builds a new
   * program and therefore a new mirror.
   */
  #useMap = false;

  #useVertexColors = false;

  /** Whether the sampler unit has been uploaded — see {@link setFeatures}. */
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

  private constructor(
    gl: WebglContext,
    program: GlProgramHandle,
    viewProjectionLocation: GlUniformLocation,
    modelLocation: GlUniformLocation,
    colorLocation: GlUniformLocation,
    mapLocation: GlUniformLocation,
    useMapLocation: GlUniformLocation,
    useVertexColorsLocation: GlUniformLocation,
  ) {
    this.#gl = gl;
    this.#program = program;
    this.#viewProjectionLocation = viewProjectionLocation;
    this.#modelLocation = modelLocation;
    this.#colorLocation = colorLocation;
    this.#mapLocation = mapLocation;
    this.#useMapLocation = useMapLocation;
    this.#useVertexColorsLocation = useVertexColorsLocation;
  }

  /**
   * Compiles and links the unlit program on `gl`.
   *
   * Throws a {@link @fourjs/core!FourError | FourError} carrying `SHADER_COMPILATION_FAILED` (§89) with
   * the driver's info log in `context.log` when any stage fails to compile,
   * when linking fails, when GL refuses to allocate an object, or when a
   * uniform this backend wrote is missing from the linked program. Shader
   * objects are deleted on every path — successful or not — because they are
   * only needed until the link completes.
   *
   * A single failure code covers compile *and* link because §89 defines one,
   * and because the two are one operation from a caller's point of view: the
   * program either exists or it does not. `context.stage` says which half
   * failed.
   */
  static create(gl: WebglContext): UnlitProgram {
    const program = createLinkedProgram(
      gl,
      "unlit",
      VERTEX_SHADER_SOURCE,
      FRAGMENT_SHADER_SOURCE,
    );
    try {
      return new UnlitProgram(
        gl,
        program,
        requireUniform(gl, program, "viewProjection", "unlit"),
        requireUniform(gl, program, "model", "unlit"),
        requireUniform(gl, program, "color", "unlit"),
        requireUniform(gl, program, "map", "unlit"),
        requireUniform(gl, program, "useMap", "unlit"),
        requireUniform(gl, program, "useVertexColors", "unlit"),
      );
    } catch (error: unknown) {
      gl.deleteProgram(program);
      throw error;
    }
  }

  /** Whether {@link UnlitProgram.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** Makes this the current program. Call once per frame, before any upload. */
  use(): void {
    this.#gl.useProgram(this.#program);
    this.#colorMirrorValid = false;
  }

  /**
   * Uploads `projection * view` for the viewport being drawn. Column-major, so
   * `transpose` is false — the engine's `Matrix4` layout is already GL's (§7b).
   */
  setViewProjection(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(
      this.#viewProjectionLocation,
      false,
      matrixScratch,
    );
  }

  /** Uploads one render item's world matrix. See {@link setViewProjection}. */
  setModel(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#modelLocation, false, matrixScratch);
  }

  /**
   * Uploads a straight-alpha, linear-light RGBA colour (§57, §60a), scaled by
   * the material's `opacity`. Accepts the material's own live array; the values
   * are copied into scratch, so the material keeps ownership of its array.
   *
   * `opacity` multiplies **alpha only** — §57 makes it a uniform transparency
   * over whatever alpha the colour already carries — and defaults to `1`, at
   * which `alpha × 1` is `alpha` bit for bit, so a material that never touches
   * opacity uploads exactly what it did before the field existed.
   */
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

  /**
   * Selects the two optional multipliers for the draw about to be issued
   * (§53's `uvs`/`colors`, §57's `map`, R-19): whether to sample the bound
   * texture, and whether to multiply by the geometry's per-vertex colour.
   *
   * ```ts
   * program.setFeatures(material.map !== null, material.vertexColors);
   * ```
   *
   * **Issues a GL call only where the draw changes something.** The mirror
   * starts at GL's own initial `0`/`0`, so a scene whose materials name neither
   * feature calls this once per draw and uploads nothing — the compatibility
   * guarantee `applyMaterialState` makes for §57's render state, made again
   * here for the same reason and checked the same way.
   *
   * The `map` sampler's texture unit is uploaded lazily, the first time this
   * program is asked for a textured draw: `glUniform1i` writes into the
   * *currently bound* program, and a sampler upload at creation time would put
   * the renderer's program state in two places (the argument
   * `SpriteProgram.setSampler` records). GL's initial sampler value is already
   * {@link MAP_TEXTURE_UNIT}, so the upload is belt and braces — it costs one
   * call in the lifetime of a program that ever draws a texture, and nothing at
   * all in one that does not.
   */
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
   * Deletes the GL program (§83). Idempotent.
   *
   * **Only call this on a live context.** After a context loss every handle is
   * already invalid and the renderer drops its reference instead of disposing
   * — see the class documentation.
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
 * The textured-quad pipeline (§55) — the backend's second and last program in
 * the §106a tier.
 *
 * ```ts
 * const program = SpriteProgram.create(gl);
 * program.use();
 * program.setSampler(0);                        // once per activation
 * program.setViewProjection(viewProjection);    // once per viewport
 * program.setModel(item.worldMatrix);           // once per draw
 * program.setTint(item.material.tint);
 * ```
 *
 * It shares `gl-geometry.ts`'s vertex arrays with {@link UnlitProgram}: both
 * declare the position stream at {@link POSITION_ATTRIBUTE_LOCATION} and the
 * uv stream at {@link UV_ATTRIBUTE_LOCATION}. `Sprite` authors the atlas cell
 * onto that stream; this program interpolates it.
 *
 * Owns its GL objects and nothing else — the texture it samples belongs to
 * `gl-texture.ts`'s cache, and the renderer re-creates this program on context
 * restore exactly as it re-creates the unlit one (§61).
 */
export class SpriteProgram implements Disposable {
  readonly #gl: WebglContext;

  readonly #program: GlProgramHandle;

  readonly #viewProjectionLocation: GlUniformLocation;

  readonly #modelLocation: GlUniformLocation;

  readonly #tintLocation: GlUniformLocation;

  readonly #samplerLocation: GlUniformLocation;

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

  private constructor(
    gl: WebglContext,
    program: GlProgramHandle,
    viewProjectionLocation: GlUniformLocation,
    modelLocation: GlUniformLocation,
    tintLocation: GlUniformLocation,
    samplerLocation: GlUniformLocation,
  ) {
    this.#gl = gl;
    this.#program = program;
    this.#viewProjectionLocation = viewProjectionLocation;
    this.#modelLocation = modelLocation;
    this.#tintLocation = tintLocation;
    this.#samplerLocation = samplerLocation;
  }

  /**
   * Compiles and links the sprite program on `gl`.
   *
   * Fails exactly as {@link UnlitProgram.create} does — see it, and
   * `createLinkedProgram`, for the contract; the messages name `"sprite"` instead
   * of `"unlit"` and the §89 code is the same.
   */
  static create(gl: WebglContext): SpriteProgram {
    const program = createLinkedProgram(
      gl,
      "sprite",
      SPRITE_VERTEX_SHADER_SOURCE,
      SPRITE_FRAGMENT_SHADER_SOURCE,
    );
    try {
      return new SpriteProgram(
        gl,
        program,
        requireUniform(gl, program, "viewProjection", "sprite"),
        requireUniform(gl, program, "model", "sprite"),
        requireUniform(gl, program, "tint", "sprite"),
        requireUniform(gl, program, "map", "sprite"),
      );
    } catch (error: unknown) {
      gl.deleteProgram(program);
      throw error;
    }
  }

  /** Whether {@link SpriteProgram.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** Makes this the current program. Call before any upload below. */
  use(): void {
    this.#gl.useProgram(this.#program);
    this.#colorMirrorValid = false;
  }

  /**
   * Points the `map` sampler at texture `unit`.
   *
   * Uploaded whenever the pipeline becomes current rather than once at creation:
   * `glUniform*` writes into the *currently bound* program, and binding one at
   * creation time would leave the renderer's program state to be guessed at from
   * two places instead of one (decision, WP-3a.3). One `uniform1i` per pipeline
   * switch is not a cost worth optimizing.
   */
  setSampler(unit: number): void {
    this.#gl.uniform1i(this.#samplerLocation, unit);
  }

  /**
   * Uploads `projection * view` for the viewport being drawn. Column-major, so
   * `transpose` is false — the engine's `Matrix4` layout is already GL's (§7b).
   *
   * Uniform values live in the program object, so one upload per viewport holds
   * for every sprite drawn into it, even if the unlit pipeline draws in between.
   */
  setViewProjection(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(
      this.#viewProjectionLocation,
      false,
      matrixScratch,
    );
  }

  /** Uploads one render item's world matrix. See {@link setViewProjection}. */
  setModel(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#modelLocation, false, matrixScratch);
  }

  /**
   * Uploads a straight-alpha RGBA tint (§55, §66) scaled by the material's
   * `opacity` — see `UnlitProgram.setColor` for the multiply and why the
   * default reproduces the previous upload exactly. Accepts the material's own
   * live array; the values are copied into scratch, so the material keeps
   * ownership of its array.
   */
  setTint(tint: readonly [number, number, number, number], opacity = 1): void {
    const alpha = tint[3] * opacity;
    const mirror = this.#colorMirror;
    if (
      this.#colorMirrorValid &&
      mirror[0] === tint[0] &&
      mirror[1] === tint[1] &&
      mirror[2] === tint[2] &&
      mirror[3] === alpha
    ) {
      return;
    }
    mirror[0] = tint[0];
    mirror[1] = tint[1];
    mirror[2] = tint[2];
    mirror[3] = alpha;
    this.#colorMirrorValid = true;
    colorScratch[0] = mirror[0];
    colorScratch[1] = mirror[1];
    colorScratch[2] = mirror[2];
    colorScratch[3] = mirror[3];
    this.#gl.uniform4fv(this.#tintLocation, colorScratch);
  }

  /**
   * Deletes the GL program (§83). Idempotent.
   *
   * **Only call this on a live context** — see {@link UnlitProgram.dispose}.
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
 * The Lambert-lit pipeline (§57 `LitMaterial`, §68, §120 "lighting") — added
 * by the lighting packet, 2026-08-04.
 *
 * ```ts
 * const program = LitProgram.create(gl);
 * program.use();
 * program.setViewProjection(viewProjection);          // once per viewport
 * program.setAmbientLight(lights.ambientColor);       // once per viewport
 * program.setDirectionalLight(
 *   lights.direction,                                 // once per viewport
 *   lights.directionalColor,
 * );
 * program.setPunctualLights(lights);                  // once per viewport
 * program.setModel(item.worldMatrix);                 // once per draw
 * program.setColor(item.material.color);
 * ```
 *
 * It shares `gl-geometry.ts`'s vertex arrays with the other pipelines: the
 * position stream sits at the fixed {@link POSITION_ATTRIBUTE_LOCATION} and
 * the normal stream — when the geometry has one — at the fixed
 * {@link NORMAL_ATTRIBUTE_LOCATION}, so one geometry cache serves all four
 * programs. Light uniforms are per *frame* state uploaded per viewport (they
 * live in the program object, exactly like the view-projection): the scene
 * ambient term, one directional light, and up to
 * {@link @fourjs/render!MAX_PUNCTUAL_LIGHTS} point and spot lights (R-17,
 * 2026-08-09). Shadows (§69), tone mapping (§60a), and §68's remaining light
 * types are staged where `@fourjs/scene`'s `light.ts` records.
 *
 * Owns its GL objects and nothing else; the renderer re-creates it on context
 * restore exactly as it re-creates the unlit one (§61).
 */
export class LitProgram implements Disposable {
  readonly #gl: WebglContext;

  readonly #program: GlProgramHandle;

  readonly #viewProjectionLocation: GlUniformLocation;

  readonly #modelLocation: GlUniformLocation;

  readonly #normalMatrixLocation: GlUniformLocation;

  readonly #colorLocation: GlUniformLocation;

  readonly #ambientLightLocation: GlUniformLocation;

  readonly #lightDirectionLocation: GlUniformLocation;

  readonly #lightColorLocation: GlUniformLocation;

  readonly #mapLocation: GlUniformLocation;

  readonly #useMapLocation: GlUniformLocation;

  readonly #punctual: PunctualLightUniforms;

  readonly #hemisphere: HemisphereLightUniforms;

  readonly #shadow: ShadowUniforms;

  /** CPU mirror of `useMap`; see `UnlitProgram`'s for the contract. */
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

  private constructor(
    gl: WebglContext,
    program: GlProgramHandle,
    viewProjectionLocation: GlUniformLocation,
    modelLocation: GlUniformLocation,
    normalMatrixLocation: GlUniformLocation,
    colorLocation: GlUniformLocation,
    ambientLightLocation: GlUniformLocation,
    lightDirectionLocation: GlUniformLocation,
    lightColorLocation: GlUniformLocation,
    mapLocation: GlUniformLocation,
    useMapLocation: GlUniformLocation,
    punctual: PunctualLightUniforms,
    hemisphere: HemisphereLightUniforms,
    shadow: ShadowUniforms,
  ) {
    this.#gl = gl;
    this.#program = program;
    this.#viewProjectionLocation = viewProjectionLocation;
    this.#modelLocation = modelLocation;
    this.#normalMatrixLocation = normalMatrixLocation;
    this.#colorLocation = colorLocation;
    this.#ambientLightLocation = ambientLightLocation;
    this.#lightDirectionLocation = lightDirectionLocation;
    this.#lightColorLocation = lightColorLocation;
    this.#mapLocation = mapLocation;
    this.#useMapLocation = useMapLocation;
    this.#punctual = punctual;
    this.#hemisphere = hemisphere;
    this.#shadow = shadow;
  }

  /**
   * Compiles and links the lit program on `gl`.
   *
   * Fails exactly as {@link UnlitProgram.create} does — see it for the
   * contract; the messages name `"lit"` and the §89 code is the same.
   */
  static create(gl: WebglContext): LitProgram {
    const program = createLinkedProgram(
      gl,
      "lit",
      LIT_VERTEX_SHADER_SOURCE,
      LIT_FRAGMENT_SHADER_SOURCE,
    );
    try {
      return new LitProgram(
        gl,
        program,
        requireUniform(gl, program, "viewProjection", "lit"),
        requireUniform(gl, program, "model", "lit"),
        requireUniform(gl, program, "normalMatrix", "lit"),
        requireUniform(gl, program, "color", "lit"),
        requireUniform(gl, program, "ambientLight", "lit"),
        requireUniform(gl, program, "lightDirection", "lit"),
        requireUniform(gl, program, "lightColor", "lit"),
        requireUniform(gl, program, "map", "lit"),
        requireUniform(gl, program, "useMap", "lit"),
        PunctualLightUniforms.resolve(gl, program, "lit"),
        HemisphereLightUniforms.resolve(gl, program, "lit"),
        ShadowUniforms.resolve(gl, program, "lit"),
      );
    } catch (error: unknown) {
      gl.deleteProgram(program);
      throw error;
    }
  }

  /** Whether {@link LitProgram.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** Makes this the current program. Call before any upload below. */
  use(): void {
    this.#gl.useProgram(this.#program);
    this.#colorMirrorValid = false;
  }

  /**
   * Uploads `projection * view` for the viewport being drawn. Column-major, so
   * `transpose` is false — the engine's `Matrix4` layout is already GL's (§7b).
   */
  setViewProjection(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(
      this.#viewProjectionLocation,
      false,
      matrixScratch,
    );
  }

  /** Uploads one render item's world matrix and its derived normal matrix. */
  setModel(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#modelLocation, false, matrixScratch);
    uploadNormalMatrix(this.#gl, this.#normalMatrixLocation, matrix);
  }

  /**
   * Uploads a straight-alpha, linear-light RGBA colour (§57, §60a) — the
   * material's base color, scaled by its `opacity` exactly as
   * `UnlitProgram.setColor` does. Accepts the material's own live array; the
   * values are copied into scratch, so the material keeps ownership of its
   * array.
   */
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

  /**
   * Uploads the scene ambient term (§68), straight RGB. Accepts the
   * `SceneLights` record's own live array — copied into scratch, as every
   * upload here is.
   */
  setAmbientLight(color: readonly [number, number, number]): void {
    vec3Scratch[0] = color[0];
    vec3Scratch[1] = color[1];
    vec3Scratch[2] = color[2];
    this.#gl.uniform3fv(this.#ambientLightLocation, vec3Scratch);
  }

  /**
   * Uploads the directional light (§68): the world-space unit vector the
   * light **travels along** (`SceneLights.direction` — the fragment stage
   * negates it for the surface term) and its color premultiplied by intensity
   * (`SceneLights.directionalColor`). A frame with no directional light
   * uploads black, which zeroes the Lambert term — see the fragment source.
   */
  setDirectionalLight(
    direction: Vector3,
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

  /**
   * Uploads the frame's point and spot lights (§68, R-17) — or nothing, for a
   * scene that has none. See {@link PunctualLightUniforms} for the contract
   * and for why "nothing" is load-bearing.
   */
  setPunctualLights(lights: SceneLights): void {
    this.#punctual.upload(lights);
  }

  /**
   * Uploads the frame's hemisphere (§68) — or nothing, for a scene that
   * has none. See {@link HemisphereLightUniforms} for the contract and
   * for why "nothing" is load-bearing.
   */
  setHemisphereLight(lights: SceneLights): void {
    this.#hemisphere.upload(lights);
  }

  /**
   * Uploads the frame's shadow matrix, biases and tap size (§69, R-18) — or
   * nothing, for a frame in which no light casts. Call once per viewport; see
   * {@link ShadowUniforms} for the contract and for why "nothing" is
   * load-bearing.
   */
  setShadow(lights: SceneLights): void {
    this.#shadow.uploadView(lights);
  }

  /**
   * Selects whether the draw about to be issued is shadowed (§49's
   * `receiveShadow`, §69) — see {@link ShadowUniforms.setReceiving}, whose
   * contract this is verbatim.
   */
  setReceivesShadow(receiving: boolean): void {
    this.#shadow.setReceiving(receiving);
  }

  /**
   * Selects whether this draw samples the bound albedo texture (§57's `map`,
   * R-19). Identical in contract to `UnlitProgram.setFeatures` — mirrored on
   * the CPU, uploaded only on change, sampler unit uploaded lazily — minus the
   * vertex-colour switch, which §57 puts on `UnlitMaterial` alone.
   */
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

  /**
   * Deletes the GL program (§83). Idempotent.
   *
   * **Only call this on a live context** — see {@link UnlitProgram.dispose}.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#gl.deleteProgram(this.#program);
  }
}
