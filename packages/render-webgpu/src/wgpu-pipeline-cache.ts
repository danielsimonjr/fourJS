/**
 * The lazy, descriptor-keyed render-pipeline cache (§4.2 of the R-1 plan).
 *
 * ## Why a cache, and why lazy
 *
 * A GL program is an object you mutate: bind it, set uniforms, draw. A
 * `GPURenderPipeline` is **immutable and combinatorial** — its identity
 * includes the target format, the depth-stencil state, the blend state, the
 * primitive topology and the vertex layout. The WebGL backend's seven programs
 * therefore do not become seven objects here; they become a cache keyed by the
 * tuple of everything a pipeline bakes in.
 *
 * The cache is **lazy by rule, not by taste**. R-6's recorded pipeline-cost law
 * — *"a fifth compiled-at-init pipeline costs 0.75 kB gzip in every example
 * bundle … nothing reachable from a class method tree-shakes"* — is about
 * bundle cost, and it lands with more force here because the combinatorial
 * space is larger: a variant per (kind × vertex colours × blend × depth ×
 * colour write × topology × format) compiled at `initialize` would be dozens of
 * pipelines, nearly all of them for draws the scene never issues. So:
 * **pipelines are created on first use, never in `initialize()`** — a deliberate
 * departure from the GL backend's compile-at-init, for a measured reason rather
 * than an aesthetic one.
 *
 * That departure has one consequence worth stating plainly, because it looks
 * like a §61 violation and is not: pipeline *creation* now happens inside
 * `render`. WebGPU's `createRenderPipeline` does not throw for a shader that
 * fails to compile — it surfaces the failure asynchronously through the
 * device's error scopes and yields a pipeline that draws nothing — so the frame
 * neither throws nor unwinds, which is exactly what §61 requires of `render`.
 * A frame that cannot get a pipeline skips the draw, the same way a frame that
 * cannot get a geometry record skips it.
 *
 * ## Keys are canonical strings
 *
 * §33's hazard, recorded in the R-1 plan (§5): a `Map` keyed by a descriptor
 * *object* has iteration order determined by allocation identity, and two
 * structurally identical descriptors miss each other. Both are fixed by keying
 * on a **canonical string built in a fixed field order** — the key is a total,
 * deterministic function of the descriptor, so the same frame always produces
 * the same key sequence and the cache's iteration order is insertion order over
 * a value type. {@link pipelineKey} is that function, and it is exported so a
 * test can assert the key rather than infer it from a cache hit.
 */

import type { RenderItemStencil } from "@fourjs/render";

import {
  type GpuBindGroupLayout,
  type GpuBlendState,
  type GpuDevice,
  type GpuPipelineLayout,
  type GpuRenderPipeline,
  type GpuShaderModule,
  type GpuStencilFaceState,
  type GpuVertexBufferLayout,
} from "./webgpu-device.js";
import { batchVertexBufferLayout } from "./wgpu-batch.js";
import { effectShaderSource, type WgpuEffectKind } from "./wgpu-effect.js";
import { litShaderSource, shadedVertexBufferLayouts } from "./wgpu-lit.js";
import {
  PARTICLE_GPU_VERTEX_BUFFER_LAYOUTS,
  PARTICLE_SHADER_SOURCE,
  PARTICLE_VERTEX_BUFFER_LAYOUTS,
} from "./wgpu-particles.js";
import { SHADOW_SHADER_SOURCE } from "./wgpu-shadow.js";
import { SPRITE_SHADER_SOURCE } from "./wgpu-sprite.js";
import {
  NO_SURFACE_MAPS,
  standardShaderSource,
  type SurfaceMaps,
} from "./wgpu-standard.js";
import {
  CLEAR_SHADER_SOURCE,
  FRAGMENT_ENTRY_POINT,
  POSITION_BUFFER_LAYOUT,
  UV_BUFFER_LAYOUT,
  VERTEX_ENTRY_POINT,
  unlitShaderSource,
  unlitVertexBufferLayouts,
  type WgpuMorph,
} from "./wgpu-unlit.js";

/**
 * §57's four blend modes as WebGPU blend states, plus `"none"` for an opaque
 * draw.
 *
 * The factor pairs are the exact WebGPU spellings of `BLEND_FUNCTIONS` in
 * `webgl-renderer.ts` — `"src-alpha"` is `SRC_ALPHA`, and so on down the table.
 * Alpha is blended with the same pair as colour, matching the GL backend, whose
 * single `blendFunc` applies to both channel groups.
 */
const BLEND_STATES: Readonly<Record<string, GpuBlendState>> = Object.freeze({
  normal: blendState("src-alpha", "one-minus-src-alpha"),
  additive: blendState("src-alpha", "one"),
  multiply: blendState("dst", "zero"),
  screen: blendState("one", "one-minus-src"),
});

function blendState(srcFactor: string, dstFactor: string): GpuBlendState {
  const component = Object.freeze({
    srcFactor,
    dstFactor,
    operation: "add",
  });
  return Object.freeze({ color: component, alpha: component });
}

/**
 * The WebGPU blend state for one §57 blend mode, or `undefined` for an opaque
 * draw — the module's `BLEND_STATES` table behind a total function, exported
 * (WP-R1.9) so the node pipeline store (`wgpu-node-program.ts`) builds its
 * descriptors from the very objects every landed family bakes in, rather
 * than from a second table that could drift.
 */
export function blendStateFor(
  blend: WgpuPipelineDescriptor["blend"],
): GpuBlendState | undefined {
  return blend === "none" ? undefined : BLEND_STATES[blend];
}

/** All four colour channels writable (`GPUColorWrite.ALL`). */
const COLOR_WRITE_ALL = 0xf;

/**
 * §57's stencil comparisons as WebGPU compare functions — the exact spellings
 * of `webgl-renderer.ts`'s `STENCIL_FUNCS`, minus the GL enum indirection.
 */
const STENCIL_COMPARES: Readonly<Record<RenderItemStencil["func"], string>> =
  Object.freeze({
    never: "never",
    less: "less",
    equal: "equal",
    lequal: "less-equal",
    greater: "greater",
    notequal: "not-equal",
    gequal: "greater-equal",
    always: "always",
  });

/**
 * §57's stencil operations as WebGPU operations. The two saturating forms are
 * the renames worth reading twice: WebGPU spells GL's saturating
 * `INCR`/`DECR` as `-clamp`, and the wrap forms keep their names.
 */
const STENCIL_OPERATIONS: Readonly<
  Record<RenderItemStencil["passOp"], string>
> = Object.freeze({
  keep: "keep",
  zero: "zero",
  replace: "replace",
  increment: "increment-clamp",
  "increment-wrap": "increment-wrap",
  decrement: "decrement-clamp",
  "decrement-wrap": "decrement-wrap",
  invert: "invert",
});

/**
 * Which family of shader a pipeline belongs to.
 *
 * `"sprite"` is §55's quad pipeline (`wgpu-sprite.ts`); `"batch"` is §65's
 * merged draw, which compiles from the **unlit** WGSL modules over the
 * planner's interleaved vertex layout — a key family of its own because the
 * vertex layout is baked into the pipeline here, not a shader family of its
 * own (`wgpu-batch.ts`); `"lit"` and `"standard"` are WP-R1.5's two shaded
 * families (`wgpu-lit.ts`, `wgpu-standard.ts`), which read the light block at
 * group 1 and — the standard family — a widened group-0 uniform block;
 * `"effect"` is §70's full-screen pass (WP-R1.6, `wgpu-effect.ts`), whose
 * WGSL module is picked by the descriptor's `effect` member; `"shadow"` is
 * §69's depth-only caster pass (WP-R1.7, `wgpu-shadow.ts`), one module over
 * the shared `DrawUniforms` layout whatever family shades its caster on
 * screen — `gl-shadow.ts`'s one-program argument, restated as one family;
 * `"particles"` is §36's instanced billboard draw (WP-R1.8,
 * `wgpu-particles.ts`), one variant-free module — like the sprite's — over
 * its own three-matrix group-0 layout and the per-instance vertex stream.
 */
export type WgpuPipelineKind =
  | "unlit"
  | "clear"
  | "sprite"
  | "batch"
  | "lit"
  | "standard"
  | "effect"
  | "shadow"
  | "particles";

/**
 * §67's stencil state as a pipeline bakes it (WP-R1.3) — §57's record minus
 * `ref`, which is a **pass command** on WebGPU (`setStencilReference`) and so
 * stays out of pipeline identity: a mask writing bit 4 and one writing bit 1
 * share a pipeline and differ by one recorded pass command.
 *
 * Field values are the engine's §57 spellings, mapped to WebGPU's at creation
 * (the module-private `STENCIL_COMPARES` and `STENCIL_OPERATIONS` tables); the
 * renderer builds the record with §57's documented defaults applied, so two draws
 * under one clip record always produce one key.
 */
export interface WgpuStencilDescriptor {
  /** The comparison, `(ref & readMask) OP (stored & readMask)`. */
  readonly func: RenderItemStencil["func"];
  /** The bits the test looks at. */
  readonly readMask: number;
  /** The bits a write may change; `0` for a read-only test. */
  readonly writeMask: number;
  /** Stored on stencil-test failure. */
  readonly failOp: RenderItemStencil["failOp"];
  /** Stored when the stencil test passes and the depth test fails. */
  readonly depthFailOp: RenderItemStencil["depthFailOp"];
  /** Stored when both tests pass. */
  readonly passOp: RenderItemStencil["passOp"];
}

/**
 * What a `kind: "batch"` pipeline's one interleaved vertex buffer *contains*
 * (`wgpu-batch.ts`): the stride and offsets. What the variant *reads* is the
 * descriptor's own `map`/`vertexColors`, which may name fewer streams — see
 * {@link batchVertexBufferLayout}.
 */
export interface WgpuBatchStream {
  /** Whether the stream interleaves §55/§77's uv floats. */
  readonly uvs: boolean;
  /** Whether the stream interleaves §53's colour floats. */
  readonly colors: boolean;
}

/**
 * Everything a `GPURenderPipeline` bakes in — the cache's key material.
 *
 * A plain readonly record rather than a class: it is a value, it is built once
 * per draw on the stack, and {@link pipelineKey} is a pure function of it.
 */
export interface WgpuPipelineDescriptor {
  /** Which shader family (and so which WGSL module). */
  readonly kind: WgpuPipelineKind;
  /** Whether the variant reads the per-vertex colour stream (§53, §60a). */
  readonly vertexColors: boolean;
  /**
   * Whether the variant samples §57's `map` — and therefore reads the uv
   * stream and binds group 1 (§77, WP-R1.2).
   *
   * A pipeline field rather than a uniform, for the reason `wgpu-unlit.ts`
   * gives at length: the cache is lazy, so a variant nothing draws is never
   * created, which inverts R-19's measured argument for the WebGL backend.
   */
  readonly map: boolean;
  /** §57's blend mode, or `"none"` for an opaque draw. */
  readonly blend: "none" | "normal" | "additive" | "multiply" | "screen";
  /** §57's `depthTest` — `"always"` when off, `"less"` when on (GL's default). */
  readonly depthTest: boolean;
  /** §57's `depthWrite`. */
  readonly depthWrite: boolean;
  /** §57's `colorWrite`, all four channels together as §57 declares it. */
  readonly colorWrite: boolean;
  /** §53's draw mode. */
  readonly topology: "triangle-list" | "line-list";
  /** The colour attachment's texel format — the swap chain's, in this tier. */
  readonly colorFormat: string;
  /** The depth attachment's format, or `null` for a pass with no depth. */
  readonly depthFormat: string | null;
  /**
   * §67's stencil state, or absent/`null` for the overwhelmingly common draw
   * that tests nothing — every draw of every scene that predates §67, whose
   * key and whose `createRenderPipeline` descriptor are unchanged to the byte
   * (see {@link pipelineKey}). Requires a stencil-capable `depthFormat`.
   */
  readonly stencil?: WgpuStencilDescriptor | null;
  /**
   * The interleaved stream of a `kind: "batch"` pipeline; absent/`null` for
   * every other kind.
   */
  readonly batch?: WgpuBatchStream | null;

  /**
   * Which §70 effect a `kind: "effect"` pipeline draws (WP-R1.6), or
   * absent/`null` for every other kind — module identity, exactly as
   * `vertexColors`/`map` are for the unlit family, carried as its own member
   * because the effect kinds are not a boolean pair. Appends a key segment
   * only when carried (the `stencil`/`batch`/`normals` rule, fourth
   * application), so every landed key is byte-identical.
   */
  readonly effect?: WgpuEffectKind | null;

  /**
   * Whether a shaded variant reads the §53 normal stream (§68, WP-R1.5), or
   * absent for every unshaded kind.
   *
   * **Optional, and carried — `true` or `false` — by exactly the shaded
   * kinds**: on WebGPU the normal stream is a vertex-layout fact a pipeline
   * bakes in (`wgpu-lit.ts`'s departure 2), so both values are pipeline
   * identity and both append a key segment; absence appends nothing, which is
   * what keeps every pre-WP-R1.5 key — and every `fourJS:<key>` label in landed
   * transcripts — byte-identical (the `stencil`/`batch` rule, third
   * application).
   */
  readonly normals?: boolean;

  /**
   * Whether a shaded variant multiplies §69's shadow term in (WP-R1.7,
   * `wgpu-shadow.ts`) — GL's per-draw `useShadow` uniform as pipeline
   * identity, appended to the key **only when `true`**: a non-receiver
   * inside a shadowed frame then shares the very pipeline (and key, and
   * transcript label) a shadowless frame compiles, exactly as GL's
   * `useShadow: false` draw is the plain program path. `false` and absent
   * are deliberately one key — they name identical pipeline content — so
   * the renderer may pass the flag unconditionally on shaded draws.
   */
  readonly shadow?: boolean;

  /**
   * Whether a `kind: "particles"` pipeline sources instance positions from
   * a GPU simulation's storage buffer instead of the interleaved CPU stream
   * (§36 `simulation: "gpu"`, R-31 wiring, 2026-08-29) — vertex-layout
   * identity (`PARTICLE_GPU_VERTEX_BUFFER_LAYOUTS` vs
   * `PARTICLE_VERTEX_BUFFER_LAYOUTS`) over the **same** WGSL module.
   * Appended to the key **only when `true`** (the `shadow` rule, second
   * application): `false` and absent name the very pipeline every landed
   * CPU-simulated transcript compiled, so its key and its `fourJS:<key>`
   * label stay byte-identical.
   */
  readonly gpuInstances?: boolean;

  /**
   * Whether a `kind: "standard"` variant samples §59's packed
   * metallic-roughness map (`wgpu-standard.ts`) — GL's per-draw
   * `useMetalRoughnessMap` as pipeline identity. Appended to the key
   * **only when `true`** (the `shadow` rule, third application): `false`
   * and absent name the very pipeline every landed scalar-only transcript
   * compiled. The renderer passes the flag on shaded draws; the lit family
   * ignores it (layout and module stay the unmapped/mapped pair they
   * always were).
   */
  readonly metalRoughness?: boolean;

  /**
   * One-target GPU morph (RFC 0003 WP-SK.4): which target streams an
   * `unlit` or `lit` variant reads beyond the base ones — `"p"` positions1,
   * `"pn"` positions1 and normals1. Vertex-layout and module identity;
   * appended to the key **only when carried**, so every morph-free key and
   * label is byte-identical.
   */
  readonly morph?: WgpuMorph;

  /**
   * WP-W4.2: the standard family's surface-detail maps (normal / occlusion /
   * emissive) as pipeline identity — each a compile-time WGSL variant flag
   * and, when any is set, the surface bind-group layout. Appended to the key
   * only when `true`, so every map-free key and label is byte-identical.
   */
  readonly normalMap?: boolean;
  readonly occlusionMap?: boolean;
  readonly emissiveMap?: boolean;
}

/**
 * The canonical cache key for a descriptor: every field, in a fixed order,
 * separated by a character no field value contains.
 *
 * Fixed order and total coverage are both load-bearing. Fixed order makes the
 * key a deterministic function of the value (§33). Total coverage makes a cache
 * hit *mean* something: a field left out of the key is a pipeline reused with
 * the wrong state baked in, which is the failure mode this function exists to
 * make impossible — so a new field on {@link WgpuPipelineDescriptor} is a
 * compile error here until it is added below.
 *
 * The **optional** fields (§67's `stencil`, §65's `batch`, §68's `normals`,
 * §70's `effect`, §69's `shadow`, §59's `metalRoughness`) append a prefixed
 * segment only when carried — `shadow` and `metalRoughness` only when carried
 * *true*, since `false` names the same pipeline content as absence. That is
 * still a total, injective function — absence appends nothing, and no
 * required field's value can spell the prefixes — and it is what keeps every
 * earlier packet's key, and therefore every `fourJS:<key>` pipeline label
 * already recorded in landed transcripts, byte-identical for a descriptor
 * that does not carry them.
 */
export function pipelineKey(descriptor: WgpuPipelineDescriptor): string {
  let key = [
    descriptor.kind,
    descriptor.vertexColors ? "vc" : "-",
    descriptor.map ? "map" : "-",
    descriptor.blend,
    descriptor.depthTest ? "dt" : "-",
    descriptor.depthWrite ? "dw" : "-",
    descriptor.colorWrite ? "cw" : "-",
    descriptor.topology,
    descriptor.colorFormat,
    descriptor.depthFormat ?? "-",
  ].join("|");
  const stencil = descriptor.stencil ?? null;
  if (stencil !== null) {
    key +=
      `|s:${stencil.func},${String(stencil.readMask)},` +
      `${String(stencil.writeMask)},${stencil.failOp},` +
      `${stencil.depthFailOp},${stencil.passOp}`;
  }
  const batch = descriptor.batch ?? null;
  if (batch !== null) {
    key += `|b:${batch.uvs ? "uv" : "-"},${batch.colors ? "col" : "-"}`;
  }
  const normals = descriptor.normals;
  if (normals !== undefined) {
    key += `|n:${normals ? "y" : "-"}`;
  }
  const effect = descriptor.effect ?? null;
  if (effect !== null) {
    key += `|e:${effect}`;
  }
  if (descriptor.shadow === true) {
    key += "|sh:y";
  }
  if (descriptor.metalRoughness === true) {
    key += "|mr:y";
  }
  if (descriptor.gpuInstances === true) {
    key += "|gi:y";
  }
  if (descriptor.morph !== undefined) {
    key += `|mo:${descriptor.morph}`;
  }
  if (descriptor.normalMap === true) {
    key += "|nm:y";
  }
  if (descriptor.occlusionMap === true) {
    key += "|oc:y";
  }
  if (descriptor.emissiveMap === true) {
    key += "|em:y";
  }
  return key;
}

/**
 * Per-device store of compiled pipelines, WGSL modules and the shared pipeline
 * layout.
 *
 * Owned by the renderer, dropped whole on device loss (§61's "re-create
 * engine-owned GPU resources" — a lost device's pipelines are already invalid,
 * and there is nothing to release on a device that no longer exists).
 */
export class WgpuPipelineCache {
  readonly #device: GpuDevice;

  readonly #layout: GpuPipelineLayout;

  /** Group 0's layout, retained so a textured pipeline layout can name it too. */
  readonly #drawLayout: GpuBindGroupLayout;

  /**
   * Group 1's layout, reached only when a textured pipeline is first created.
   *
   * A provider rather than a layout, because the object has to be **the same
   * one** the texture cache creates its bind groups against and because
   * creating it eagerly would put a `createBindGroupLayout` into the
   * initialization transcript of every application, textured or not (R-30b's
   * lazy-query law). `undefined` for a cache built without one: such a cache
   * answers `null` for a textured descriptor, which skips the draw the way
   * every other unsatisfiable request in this backend is skipped.
   */
  readonly #textureLayout: (() => GpuBindGroupLayout) | undefined;

  /** The two-group pipeline layout, built with the first textured pipeline. */
  #texturedPipelineLayout: GpuPipelineLayout | null = null;

  /**
   * The sprite draw's group-0 layout, reached only when a sprite pipeline is
   * first created — a provider for `#textureLayout`'s two reasons: it must be
   * **the same object** the renderer binds its sprite uniform block against,
   * and creating it eagerly would put a `createBindGroupLayout` into every
   * application's initialization transcript (`wgpu-sprite.ts`). `undefined`
   * for a cache built without one: such a cache answers `null` for a sprite
   * descriptor, which skips the draw.
   */
  readonly #spriteLayout: (() => GpuBindGroupLayout) | undefined;

  /** The sprite pipeline layout, built with the first sprite pipeline. */
  #spritePipelineLayout: GpuPipelineLayout | null = null;

  /**
   * The particle draw's group-0 layout (WP-R1.8, `wgpu-particles.ts`),
   * reached only when a particle pipeline is first created — the sprite
   * provider's two reasons, verbatim: it must be **the same object** the
   * renderer binds its particle uniform block against, and an eager layout
   * would put a `createBindGroupLayout` into every particle-less
   * application's initialization transcript. `undefined` for a cache built
   * without one: such a cache answers `null` for a particle descriptor,
   * which skips the draw.
   */
  readonly #particleLayout: (() => GpuBindGroupLayout) | undefined;

  /** The particle pipeline layout, built with the first particle pipeline. */
  #particlePipelineLayout: GpuPipelineLayout | null = null;

  /**
   * The light block's group-1 layout (WP-R1.5), reached only when a shaded
   * pipeline is first created — a provider for `#textureLayout`'s two reasons:
   * it must be **the same object** the renderer binds its per-view light
   * blocks against, and an eager layout would put a `createBindGroupLayout`
   * into every unshaded application's initialization transcript. `undefined`
   * for a cache built without one: such a cache answers `null` for a shaded
   * descriptor, which skips the draw.
   */
  readonly #lightsLayout: (() => GpuBindGroupLayout) | undefined;

  /**
   * The standard draw's widened group-0 layout (`wgpu-standard.ts`), reached
   * only when a standard pipeline is first created — the sprite provider's
   * reasoning, verbatim.
   */
  readonly #standardLayout: (() => GpuBindGroupLayout) | undefined;

  /**
   * The surface bind-group layout provider (WP-W4.2) — reached only when a
   * standard pipeline with a normal / occlusion / emissive map is created.
   */
  readonly #surfaceLayout: (() => GpuBindGroupLayout) | undefined;

  /** Surface-group pipeline layouts, keyed `shadow|map` (lazy). */
  readonly #surfaceShadedLayouts = new Map<string, GpuPipelineLayout>();

  /** The lit families' pipeline layouts, built with each family's first pipeline. */
  #litPipelineLayout: GpuPipelineLayout | null = null;

  #litMapPipelineLayout: GpuPipelineLayout | null = null;

  #standardPipelineLayout: GpuPipelineLayout | null = null;

  #standardMapPipelineLayout: GpuPipelineLayout | null = null;

  /**
   * Mr-only and map+mr standard layouts — built with each variant's first
   * pipeline. Separate from `#standardMapPipelineLayout` so an mr-only
   * frame labels `…:standard:mr` rather than borrowing `:map`, even though
   * both compositions are `[uniforms, lights, texture]`.
   */
  #standardMrPipelineLayout: GpuPipelineLayout | null = null;

  #standardMapMrPipelineLayout: GpuPipelineLayout | null = null;

  /**
   * The **shadowed** shaded families' group-1 layout (WP-R1.7,
   * `wgpu-shadow.ts`) — the widened light block plus the comparison pair —
   * reached only when a shadowed pipeline is first created: a provider for
   * `#lightsLayout`'s two reasons, verbatim (same object the renderer binds
   * its shadow group against; no eager `createBindGroupLayout` in a
   * shadowless application's transcript). `undefined` for a cache built
   * without one: such a cache answers `null` for a shadowed descriptor,
   * which skips the draw.
   */
  readonly #shadowLightsLayout: (() => GpuBindGroupLayout) | undefined;

  /**
   * The shadowed shaded compositions, keyed `lit`/`lit|map`/`standard`/
   * `standard|map`/`standard|mr`/`standard|map|mr` — a small map rather
   * than more fields, because the four landed fields stay exactly where
   * the landed transcripts put them and these compositions are new objects
   * a shadowless frame never creates.
   */
  readonly #shadowShadedLayouts = new Map<string, GpuPipelineLayout>();

  /**
   * The grade effect's group-1 layout (WP-R1.6, `wgpu-effect.ts`), reached
   * only when a grade pipeline is first created — a provider for
   * `#textureLayout`'s two reasons: it must be **the same object** the
   * renderer binds its effect uniform block against, and an eager layout
   * would put a `createBindGroupLayout` into every effectless application's
   * initialization transcript. `undefined` for a cache built without one:
   * such a cache answers `null` for an effect descriptor, which skips the
   * effect the way every other unsatisfiable request is skipped.
   */
  readonly #effectLayout: (() => GpuBindGroupLayout) | undefined;

  /** The effect pipeline layouts: source-only, and source-plus-grade-block. */
  #effectPipelineLayout: GpuPipelineLayout | null = null;

  #effectGradePipelineLayout: GpuPipelineLayout | null = null;

  /** Pipelines by {@link pipelineKey}. Insertion-ordered, string-keyed (§33). */
  readonly #pipelines = new Map<string, GpuRenderPipeline>();

  /**
   * WGSL modules by variant key (`"unlit"`, `"unlit|vc"`, `"unlit|map"`,
   * `"unlit|vc|map"`, `"clear"`).
   *
   * A second cache, one level below the pipelines, because a module is shared
   * by every pipeline of its variant: the flat unlit shader is compiled once
   * however many blend and depth combinations draw with it.
   */
  readonly #modules = new Map<string, GpuShaderModule>();

  #disposed = false;

  constructor(
    device: GpuDevice,
    bindGroupLayout: GpuBindGroupLayout,
    textureLayout?: () => GpuBindGroupLayout,
    spriteLayout?: () => GpuBindGroupLayout,
    lightsLayout?: () => GpuBindGroupLayout,
    standardLayout?: () => GpuBindGroupLayout,
    effectLayout?: () => GpuBindGroupLayout,
    shadowLightsLayout?: () => GpuBindGroupLayout,
    particleLayout?: () => GpuBindGroupLayout,
    surfaceLayout?: () => GpuBindGroupLayout,
  ) {
    this.#device = device;
    this.#textureLayout = textureLayout;
    this.#spriteLayout = spriteLayout;
    this.#lightsLayout = lightsLayout;
    this.#standardLayout = standardLayout;
    this.#surfaceLayout = surfaceLayout;
    this.#effectLayout = effectLayout;
    this.#shadowLightsLayout = shadowLightsLayout;
    this.#particleLayout = particleLayout;
    this.#drawLayout = bindGroupLayout;
    this.#layout = device.createPipelineLayout({
      label: "fourJS:pipeline-layout",
      bindGroupLayouts: [bindGroupLayout],
    });
  }

  /** How many distinct pipelines have been created. Diagnostics and tests. */
  get size(): number {
    return this.#pipelines.size;
  }

  /** How many WGSL modules have been compiled. Diagnostics and tests. */
  get moduleCount(): number {
    return this.#modules.size;
  }

  /** Whether {@link WgpuPipelineCache.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Returns the pipeline for `descriptor`, creating it on first use.
   *
   * Returns `null` — and caches nothing — once disposed, so a draw racing
   * teardown skips rather than resurrecting the cache. Never throws: this runs
   * inside `Renderer.render` (see the module header).
   */
  acquire(descriptor: WgpuPipelineDescriptor): GpuRenderPipeline | null {
    if (this.#disposed) {
      return null;
    }
    const key = pipelineKey(descriptor);
    const existing = this.#pipelines.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const layout = this.#layoutFor(descriptor);
    if (layout === null) {
      return null;
    }
    const pipeline = this.#create(descriptor, key, layout);
    this.#pipelines.set(key, pipeline);
    return pipeline;
  }

  /**
   * Drops every pipeline and module.
   *
   * Nothing is destroyed: WebGPU pipelines and shader modules have no
   * `destroy()` — they are released when the last reference to them and to the
   * device goes away — so dropping the maps *is* the release (§83). Idempotent.
   */
  dispose(): void {
    this.#disposed = true;
    this.#pipelines.clear();
    this.#modules.clear();
    this.#texturedPipelineLayout = null;
    this.#spritePipelineLayout = null;
    this.#particlePipelineLayout = null;
    this.#litPipelineLayout = null;
    this.#litMapPipelineLayout = null;
    this.#standardPipelineLayout = null;
    this.#standardMapPipelineLayout = null;
    this.#standardMrPipelineLayout = null;
    this.#standardMapMrPipelineLayout = null;
    this.#surfaceShadedLayouts.clear();
    this.#effectPipelineLayout = null;
    this.#effectGradePipelineLayout = null;
    this.#shadowShadedLayouts.clear();
  }

  /**
   * The pipeline layout `descriptor` needs: group 0 alone; group 0 and
   * group 1 for a variant that samples; the sprite block's own group 0
   * plus group 1 for the sprite family (`wgpu-sprite.ts`); or, for the two
   * shaded families, their group 0 plus the light block at group 1 — the
   * widened shadow-lights layout for a shadowed variant (WP-R1.7) — plus the
   * texture layout at group 2 when the variant samples albedo
   * (`wgpu-lights.ts`), and at group 2 *or* 3 for §59's packed
   * metallic-roughness map (group 3 when albedo already occupies 2; group 2
   * when it does not). §69's caster family (`"shadow"`) reads exactly the
   * shared `DrawUniforms` group, so it resolves through the unsampling arm
   * below. §36's particle family (WP-R1.8) reads its own three-matrix
   * group 0 and nothing else.
   *
   * `null` when a pipeline is asked of a cache that was given no provider for
   * a layout it needs — see {@link WgpuPipelineCache}'s fields.
   */
  #layoutFor(descriptor: WgpuPipelineDescriptor): GpuPipelineLayout | null {
    if (descriptor.kind === "sprite") {
      const sprite = this.#spriteLayout;
      const texture = this.#textureLayout;
      if (sprite === undefined || texture === undefined) {
        return null;
      }
      this.#spritePipelineLayout ??= this.#device.createPipelineLayout({
        label: "fourJS:pipeline-layout:sprite",
        bindGroupLayouts: [sprite(), texture()],
      });
      return this.#spritePipelineLayout;
    }
    if (descriptor.kind === "particles") {
      const particle = this.#particleLayout;
      if (particle === undefined) {
        return null;
      }
      this.#particlePipelineLayout ??= this.#device.createPipelineLayout({
        label: "fourJS:pipeline-layout:particles",
        bindGroupLayouts: [particle()],
      });
      return this.#particlePipelineLayout;
    }
    if (descriptor.kind === "effect") {
      return this.#effectLayoutFor(descriptor);
    }
    if (descriptor.kind === "lit" || descriptor.kind === "standard") {
      return this.#shadedLayoutFor(descriptor);
    }
    if (!descriptor.map) {
      return this.#layout;
    }
    const provider = this.#textureLayout;
    if (provider === undefined) {
      return null;
    }
    this.#texturedPipelineLayout ??= this.#device.createPipelineLayout({
      label: "fourJS:pipeline-layout:map",
      bindGroupLayouts: [this.#drawLayout, provider()],
    });
    return this.#texturedPipelineLayout;
  }

  /**
   * The effect family's pipeline layouts (WP-R1.6): the texture layout alone
   * at group 0 for a copy or an output transform — an effect binds exactly a
   * source and its sampler, through the same layout object the mip blit and
   * every `map` pipeline share — plus the grade uniform block at group 1 for
   * the grade. Two cached compositions, each built with its first pipeline;
   * `null` for a missing provider, which skips the effect.
   */
  #effectLayoutFor(
    descriptor: WgpuPipelineDescriptor,
  ): GpuPipelineLayout | null {
    const texture = this.#textureLayout;
    if (texture === undefined) {
      return null;
    }
    if ((descriptor.effect ?? null) === "grade") {
      const effect = this.#effectLayout;
      if (effect === undefined) {
        return null;
      }
      this.#effectGradePipelineLayout ??= this.#device.createPipelineLayout({
        label: "fourJS:pipeline-layout:effect:grade",
        bindGroupLayouts: [texture(), effect()],
      });
      return this.#effectGradePipelineLayout;
    }
    this.#effectPipelineLayout ??= this.#device.createPipelineLayout({
      label: "fourJS:pipeline-layout:effect",
      bindGroupLayouts: [texture()],
    });
    return this.#effectPipelineLayout;
  }

  /**
   * The shaded families' pipeline layouts (WP-R1.5): the family's group 0 —
   * the shared `DrawUniforms` layout for `"lit"`, the widened standard layout
   * for `"standard"` — then the light block at group 1, then, for a sampling
   * variant, the texture layout at group 2. Four cached compositions, each
   * built with its family's first pipeline; `null` for a missing provider,
   * which skips the draw ({@link WgpuPipelineCache}'s fields).
   *
   * A **shadowed** variant (WP-R1.7) is the same shape with group 1 swapped
   * for the widened shadow-lights layout — compositions cached in
   * {@link WgpuPipelineCache.#shadowShadedLayouts}, none of which a
   * shadowless frame creates.
   *
   * §59's packed metallic-roughness map (standard family only) appends the
   * same texture layout: at group 3 when albedo already occupies group 2,
   * at group 2 when it does not. Lit descriptors ignore `metalRoughness`.
   */
  #shadedLayoutFor(
    descriptor: WgpuPipelineDescriptor,
  ): GpuPipelineLayout | null {
    const shadow = descriptor.shadow === true;
    const lights = shadow ? this.#shadowLightsLayout : this.#lightsLayout;
    if (lights === undefined) {
      return null;
    }
    const standard = descriptor.kind === "standard";
    const drawProvider = standard ? this.#standardLayout : undefined;
    if (standard && drawProvider === undefined) {
      return null;
    }
    const metalRoughness = standard && descriptor.metalRoughness === true;
    const detail =
      standard &&
      (descriptor.normalMap === true ||
        descriptor.occlusionMap === true ||
        descriptor.emissiveMap === true);
    if (detail) {
      return this.#surfaceShadedLayoutFor(descriptor, drawProvider, lights);
    }
    const texture = this.#textureLayout;
    if ((descriptor.map || metalRoughness) && texture === undefined) {
      return null;
    }
    const drawLayout =
      drawProvider === undefined ? this.#drawLayout : drawProvider();
    const family = standard ? "standard" : "lit";
    const bindGroupLayouts: GpuBindGroupLayout[] = [drawLayout, lights()];
    if (descriptor.map && texture !== undefined) {
      bindGroupLayouts.push(texture());
    }
    if (metalRoughness && texture !== undefined) {
      bindGroupLayouts.push(texture());
    }
    const suffix = `${descriptor.map ? ":map" : ""}${metalRoughness ? ":mr" : ""}`;
    if (shadow) {
      const key = `${family}${descriptor.map ? "|map" : ""}${metalRoughness ? "|mr" : ""}`;
      const existing = this.#shadowShadedLayouts.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const created = this.#device.createPipelineLayout({
        label: `fourJS:pipeline-layout:${family}:shadow${suffix}`,
        bindGroupLayouts,
      });
      this.#shadowShadedLayouts.set(key, created);
      return created;
    }
    if (metalRoughness) {
      if (descriptor.map) {
        this.#standardMapMrPipelineLayout ??= this.#device.createPipelineLayout(
          {
            label: "fourJS:pipeline-layout:standard:map:mr",
            bindGroupLayouts,
          },
        );
        return this.#standardMapMrPipelineLayout;
      }
      this.#standardMrPipelineLayout ??= this.#device.createPipelineLayout({
        label: "fourJS:pipeline-layout:standard:mr",
        bindGroupLayouts,
      });
      return this.#standardMrPipelineLayout;
    }
    if (descriptor.map && texture !== undefined) {
      const existing = standard
        ? this.#standardMapPipelineLayout
        : this.#litMapPipelineLayout;
      if (existing !== null) {
        return existing;
      }
      const created = this.#device.createPipelineLayout({
        label: `fourJS:pipeline-layout:${family}:map`,
        bindGroupLayouts,
      });
      if (standard) {
        this.#standardMapPipelineLayout = created;
      } else {
        this.#litMapPipelineLayout = created;
      }
      return created;
    }
    const existing = standard
      ? this.#standardPipelineLayout
      : this.#litPipelineLayout;
    if (existing !== null) {
      return existing;
    }
    const created = this.#device.createPipelineLayout({
      label: `fourJS:pipeline-layout:${family}`,
      bindGroupLayouts,
    });
    if (standard) {
      this.#standardPipelineLayout = created;
    } else {
      this.#litPipelineLayout = created;
    }
    return created;
  }

  /**
   * The standard family's layout when any of the surface-detail maps is set
   * (WP-W4.2): draw, lights, albedo when `map`, then the five-entry surface
   * group at `map ? 3 : 2` (it carries the metallic-roughness pair too, so
   * `metalRoughness` does not change the layout). `null` for a missing
   * provider, skipping the draw.
   */
  #surfaceShadedLayoutFor(
    descriptor: WgpuPipelineDescriptor,
    drawProvider: (() => GpuBindGroupLayout) | undefined,
    lights: () => GpuBindGroupLayout,
  ): GpuPipelineLayout | null {
    const surface = this.#surfaceLayout;
    const texture = this.#textureLayout;
    if (
      surface === undefined ||
      drawProvider === undefined ||
      (descriptor.map && texture === undefined)
    ) {
      return null;
    }
    const shadow = descriptor.shadow === true;
    const key = `${shadow ? "sh" : "-"}|${descriptor.map ? "map" : "-"}`;
    const existing = this.#surfaceShadedLayouts.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const bindGroupLayouts: GpuBindGroupLayout[] = [drawProvider(), lights()];
    if (descriptor.map && texture !== undefined) {
      bindGroupLayouts.push(texture());
    }
    bindGroupLayouts.push(surface());
    const created = this.#device.createPipelineLayout({
      label: `fourJS:pipeline-layout:standard:surface${shadow ? ":shadow" : ""}${descriptor.map ? ":map" : ""}`,
      bindGroupLayouts,
    });
    this.#surfaceShadedLayouts.set(key, created);
    return created;
  }

  /**
   * The WGSL module `kind` compiles from. `"batch"` deliberately maps onto the
   * **unlit** module keys: a batch draws through the unlit shader family
   * (`wgpu-batch.ts`), so a frame mixing batched and unbatched unlit draws of
   * one variant compiles that variant's module exactly once. The two shaded
   * families key on their own variant tuple (`normals` × `map` × WP-R1.7's
   * `shadow` × the standard family's `metalRoughness`) — `"lit"`, `"lit|n"`,
   * `"lit|map"`, `"lit|n|map"`, their `|sh` counterparts, and the `standard`
   * set with optional `|mr` — so a frame mixing normal-carrying and
   * normal-less lit geometry compiles two modules, not one per pipeline,
   * and a shadowed frame's non-receivers share the shadowless module. The
   * effect family keys per kind (WP-R1.6) — `"effect|copy"`,
   * `"effect|grade"`, `"effect|output-transform"` — so a chain grading into
   * two formats compiles one grade module and two pipelines. `"shadow"` is
   * §69's one caster module (WP-R1.7), variant-free like the sprite's —
   * as is `"particles"`, §36's one billboard module (WP-R1.8).
   */
  #module(
    kind: WgpuPipelineKind,
    vertexColors: boolean,
    map: boolean,
    normals: boolean,
    effect: WgpuEffectKind | null,
    shadow: boolean,
    metalRoughness: boolean,
    morph: WgpuMorph | undefined,
    surface: SurfaceMaps,
  ): GpuShaderModule {
    const key =
      kind === "clear"
        ? "clear"
        : kind === "sprite"
          ? "sprite"
          : kind === "shadow"
            ? "shadow"
            : kind === "particles"
              ? "particles"
              : kind === "effect"
                ? `effect|${effect ?? "copy"}`
                : kind === "lit" || kind === "standard"
                  ? `${kind}${normals ? "|n" : ""}${map ? "|map" : ""}${kind === "standard" && metalRoughness ? "|mr" : ""}${shadow ? "|sh" : ""}${morph !== undefined ? `|mo:${morph}` : ""}${kind === "standard" ? `${surface.normal ? "|nm" : ""}${surface.occlusion ? "|oc" : ""}${surface.emissive ? "|em" : ""}` : ""}`
                  : `unlit${vertexColors ? "|vc" : ""}${map ? "|map" : ""}${morph === undefined ? "" : `|mo:${morph}`}`;
    const existing = this.#modules.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const module = this.#device.createShaderModule({
      label: `fourJS:${key}`,
      code:
        kind === "clear"
          ? CLEAR_SHADER_SOURCE
          : kind === "sprite"
            ? SPRITE_SHADER_SOURCE
            : kind === "shadow"
              ? SHADOW_SHADER_SOURCE
              : kind === "particles"
                ? PARTICLE_SHADER_SOURCE
                : kind === "effect"
                  ? effectShaderSource(effect ?? "copy")
                  : kind === "lit"
                    ? litShaderSource(normals, map, shadow, morph)
                    : kind === "standard"
                      ? standardShaderSource(
                          normals,
                          map,
                          shadow,
                          metalRoughness,
                          surface,
                          morph,
                        )
                      : unlitShaderSource(vertexColors, map, morph),
    });
    this.#modules.set(key, module);
    return module;
  }

  /**
   * The vertex-buffer layouts `descriptor`'s pipeline reads: none for the
   * clear and the effect (their triangles are generated from the vertex
   * index), position alone
   * for a sprite (position plus the authored uv stream at `@location(2)`)
   * and for §69's caster
   * (a depth-only stage ignores every other stream, `gl-shadow.ts`'s
   * argument — the vertex arrays' streams-not-declared-are-ignored rule,
   * expressed as a one-buffer layout), the shaded stream
   * list — position, then normals, then uvs — for the lit and standard
   * families (WP-R1.5), the planner's one interleaved buffer for a batch,
   * the corner-plus-instance pair for §36's particles (WP-R1.8), and the
   * positional stream list for the unlit family.
   */
  #vertexBuffers(
    descriptor: WgpuPipelineDescriptor,
  ): readonly GpuVertexBufferLayout[] {
    if (descriptor.kind === "clear" || descriptor.kind === "effect") {
      return [];
    }
    if (descriptor.kind === "shadow") {
      return [POSITION_BUFFER_LAYOUT];
    }
    if (descriptor.kind === "sprite") {
      return [POSITION_BUFFER_LAYOUT, UV_BUFFER_LAYOUT];
    }
    if (descriptor.kind === "particles") {
      // §36 `simulation: "gpu"` re-sources @location(1) from the
      // simulation's storage buffer; the module is shared either way
      // (`wgpu-particles.ts` on the two layout tables).
      return descriptor.gpuInstances === true
        ? PARTICLE_GPU_VERTEX_BUFFER_LAYOUTS
        : PARTICLE_VERTEX_BUFFER_LAYOUTS;
    }
    if (descriptor.kind === "lit" || descriptor.kind === "standard") {
      return shadedVertexBufferLayouts(
        descriptor.normals === true,
        descriptor.map ||
          (descriptor.kind === "standard" &&
            (descriptor.metalRoughness === true ||
              descriptor.normalMap === true ||
              descriptor.occlusionMap === true ||
              descriptor.emissiveMap === true)),
        descriptor.morph,
      );
    }
    const batch = descriptor.batch ?? null;
    if (batch !== null) {
      return [
        batchVertexBufferLayout(
          batch.uvs,
          batch.colors,
          descriptor.map,
          descriptor.vertexColors,
        ),
      ];
    }
    return unlitVertexBufferLayouts(
      descriptor.vertexColors,
      descriptor.map,
      descriptor.morph,
    );
  }

  #create(
    descriptor: WgpuPipelineDescriptor,
    key: string,
    layout: GpuPipelineLayout,
  ): GpuRenderPipeline {
    const module = this.#module(
      descriptor.kind,
      descriptor.vertexColors,
      descriptor.map,
      descriptor.normals === true,
      descriptor.effect ?? null,
      descriptor.shadow === true,
      descriptor.metalRoughness === true,
      descriptor.kind === "lit" ||
        descriptor.kind === "unlit" ||
        descriptor.kind === "standard"
        ? descriptor.morph
        : undefined,
      descriptor.kind === "standard"
        ? {
            normal: descriptor.normalMap === true,
            occlusion: descriptor.occlusionMap === true,
            emissive: descriptor.emissiveMap === true,
          }
        : NO_SURFACE_MAPS,
    );
    const blend = blendStateFor(descriptor.blend);
    return this.#device.createRenderPipeline({
      label: `fourJS:${key}`,
      layout,
      vertex: {
        module,
        entryPoint: VERTEX_ENTRY_POINT,
        buffers: this.#vertexBuffers(descriptor),
      },
      fragment: {
        module,
        entryPoint: FRAGMENT_ENTRY_POINT,
        targets: [
          {
            format: descriptor.colorFormat,
            ...(blend === undefined ? {} : { blend }),
            writeMask: descriptor.colorWrite ? COLOR_WRITE_ALL : 0,
          },
        ],
      },
      primitive: {
        topology: descriptor.topology,
        // Winding and culling are left at WebGPU's defaults (`ccw`, no cull),
        // matching the GL backend, which keeps `CULL_FACE` disabled. The
        // recorded note applies to both backends at once: enabling culling is a
        // decision about the *projection's* winding mirror, and it must be
        // taken for both backends in one change or a scene renders differently
        // per backend (§62's tiers exist to prevent exactly that).
      },
      ...(descriptor.depthFormat === null
        ? {}
        : {
            depthStencil: {
              format: descriptor.depthFormat,
              depthWriteEnabled: descriptor.depthWrite,
              // §57's `depthTest: false` is "draw regardless of what is in
              // front", which is `"always"` — not a missing depth state: the
              // draw may still *write* depth, and a pipeline with no
              // depth-stencil state at all could not, while also being invalid
              // against a pass that has a depth attachment.
              depthCompare: descriptor.depthTest ? "less" : "always",
              // §67's test and operations (WP-R1.3), spread only when the
              // descriptor carries them: WebGPU's defaults for the four
              // members are exactly "test always, change nothing", so a
              // stencil-free pipeline over a stencil-capable format omits
              // them — and a clipless frame's descriptors are then unchanged
              // to the byte from what WP-R1.1 recorded.
              ...stencilStateFor(descriptor.stencil ?? null),
            },
          }),
    });
  }
}

/**
 * The four stencil members of a pipeline's `depthStencil` state, or nothing
 * (see `WgpuPipelineCache`'s `#create`) — a module function rather than a
 * cache method since WP-R1.9, because the node pipeline store bakes the same
 * §57 mapping into its own descriptors and two spellings of the module's
 * `STENCIL_COMPARES`/`STENCIL_OPERATIONS` tables could drift.
 */
export function stencilStateFor(stencil: WgpuStencilDescriptor | null): {
  stencilFront?: GpuStencilFaceState;
  stencilBack?: GpuStencilFaceState;
  stencilReadMask?: number;
  stencilWriteMask?: number;
} {
  if (stencil === null) {
    return {};
  }
  // One state for both faces: GL's stencil calls are two-sided and culling
  // is disabled on both backends (`GpuStencilFaceState`'s note).
  const face: GpuStencilFaceState = {
    compare: STENCIL_COMPARES[stencil.func],
    failOp: STENCIL_OPERATIONS[stencil.failOp],
    depthFailOp: STENCIL_OPERATIONS[stencil.depthFailOp],
    passOp: STENCIL_OPERATIONS[stencil.passOp],
  };
  return {
    stencilFront: face,
    stencilBack: face,
    stencilReadMask: stencil.readMask,
    stencilWriteMask: stencil.writeMask,
  };
}
