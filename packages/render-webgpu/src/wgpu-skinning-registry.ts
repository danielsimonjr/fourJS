/**
 * The skinning pipeline's registration slot (§54, §62; RFC 0003) — the
 * lazily-filled module `let` that keeps two skinned colour pipelines and a
 * joint-palette uploader out of every bundle that never skins.
 *
 * The pipeline-cost law (R-6), restated for this backend: `WebgpuRenderer`
 * imports **this** module — one `let`, three functions, and the interfaces
 * the draw loop is typed against — and never `wgpu-skinning.ts`; an
 * application opts in with
 *
 * ```ts
 * import { registerSkinningPipeline } from "@fourjs/render-webgpu";
 * registerSkinningPipeline();
 * ```
 *
 * which is what links the heavy module. The renderer resolves this slot on
 * the first skinned item of a frame; a `null` answer skips the draw with a
 * one-time §85 development warning naming the fix. Drawing the bind pose
 * instead was rejected by RFC 0003 §5: a character standing in T-pose is a
 * different picture, and the recorded rule is that a value must not become
 * one.
 *
 * This slice ships the colour pair (skinned unlit + skinned lit) and the
 * §69 caster through {@link SkinnedPrograms.acquireShadow} — compiled on
 * the first skinned caster, never with the colour pair. Unregistered or
 * failed casters skip, never bind-pose. The RFC 0005 skinned id pass
 * lives in `wgpu-picking.ts`.
 */

import type {
  GpuBindGroup,
  GpuBindGroupLayout,
  GpuDevice,
  GpuRenderPipeline,
} from "./webgpu-device.js";
import type { WgpuStencilDescriptor } from "./wgpu-pipeline-cache.js";

/**
 * The live window a `WebgpuRenderer` opens for its skinned colour pair —
 * the layouts the pair's pipeline layouts must share with the frame's
 * already-bound draw, map, and light groups, so a skinned draw reuses the
 * same group-0 uniform block every other family writes.
 *
 * Every member is a **live accessor** (a method), not a snapshot, because
 * the layouts change identity under the renderer's feet: a §61 device loss
 * drops them, and a pair that captured `drawLayout` once would compile
 * against a layout the renderer has already abandoned.
 */
export interface SkinningPipelineHost {
  /** The renderer's device, or `null` before `initialize` / after `dispose`. */
  device(): GpuDevice | null;
  /**
   * Group 0's `DrawUniforms` layout — the same object the frame's draw bind
   * group is created against.
   */
  drawLayout(): GpuBindGroupLayout | null;
  /**
   * The texture/sampler layout, created by the first textured upload.
   * `null` until then; a textured skinned draw that cannot name it skips.
   */
  textureLayout(): GpuBindGroupLayout | null;
  /** Group 1's light-block layout, created by the first shaded draw. */
  lightsLayout(): GpuBindGroupLayout | null;
  /**
   * Group 1's **shadowed** light-block layout, created by the first
   * receiving draw.
   */
  shadowLightsLayout(): GpuBindGroupLayout | null;
}

/**
 * Everything a skinned colour pipeline bakes in — the unlit/lit families'
 * `WgpuPipelineDescriptor` minus `kind`, plus the two flags only a skinned
 * lit draw reads (`normals`, `shadow`). Structural, so the renderer never
 * names the class that compiles it.
 */
export interface WgpuSkinnedDrawDescriptor {
  /** Whether the unlit variant reads the per-vertex colour stream. */
  readonly vertexColors: boolean;
  /** Whether the variant samples §57's `map`. */
  readonly map: boolean;
  /** Whether the lit variant reads the normal stream. */
  readonly normals: boolean;
  /** Whether the lit variant receives §69's shadow map. */
  readonly shadow: boolean;
  /** §57's blend mode, or `"none"` for an opaque draw. */
  readonly blend: "none" | "normal" | "additive" | "multiply" | "screen";
  readonly depthTest: boolean;
  readonly depthWrite: boolean;
  readonly colorWrite: boolean;
  readonly topology: "triangle-list" | "line-list";
  readonly colorFormat: string;
  readonly depthFormat: string | null;
  readonly stencil: WgpuStencilDescriptor | null;
  /**
   * Whether the pipeline fetches the palette from the bone texture
   * (`Mesh.skinningMode === "texture"`) instead of the uniform block. Part of
   * the pipeline, module and layout keys; absent means the uniform palette.
   */
  readonly paletteTexture?: boolean;
}

/**
 * Everything a skinned **caster** pipeline bakes in — topology plus the
 * shadow target's colour and depth formats. Structural, so the renderer
 * never names the class that compiles it (`graph:duplicates`).
 */
export interface WgpuSkinnedShadowDescriptor {
  readonly topology: "triangle-list" | "line-list";
  readonly colorFormat: string;
  readonly depthFormat: string;
}

/**
 * The surface the renderer's draw loop needs from the skinned **unlit**
 * family — a lazy pipeline cache keyed by {@link WgpuSkinnedDrawDescriptor}.
 */
export interface SkinnedUnlitPipeline {
  /**
   * Returns the pipeline for `descriptor`, compiling on first use.
   * `null` once disposed or when a required layout is missing.
   */
  acquire(descriptor: WgpuSkinnedDrawDescriptor): GpuRenderPipeline | null;
}

/**
 * The surface the renderer's draw loop needs from the skinned **lit**
 * family — `SkinnedUnlitPipeline`'s contract over the lit WGSL.
 */
export interface SkinnedLitPipeline {
  acquire(descriptor: WgpuSkinnedDrawDescriptor): GpuRenderPipeline | null;
}

/**
 * One device's compiled skinned colour pair — created lazily on the first
 * skinned draw, dropped on device loss, disposed with the renderer.
 *
 * The palette is a **separate bind group**: 48 × 64-byte matrices are 3072
 * bytes, which will not fit in the 256-byte `DrawUniforms` stride, and
 * widening that block would move every landed unskinned transcript.
 */
export interface SkinnedPrograms {
  readonly unlit: SkinnedUnlitPipeline;
  readonly lit: SkinnedLitPipeline;
  /**
   * Bind-group index the palette occupies for this variant: group 1 on
   * untextured unlit, group 2 on textured unlit and untextured lit, group 3
   * on textured lit — always the slot after the family's existing groups.
   */
  paletteGroup(lit: boolean, map: boolean): number;
  /**
   * Grows the palette buffer to hold `draws` palettes. Call **before** the
   * pass is recorded (sized-before-recording); a mid-pass grow would orphan
   * the bound group. `0` is a no-op.
   */
  prepare(device: GpuDevice, draws: number): void;
  /**
   * Packs `palette` into the next slot of the frame's palette buffer and
   * returns the dynamic offset the draw binds at. The skeleton's own
   * `Float32Array` is copied — no scratch beyond the slot — and a short
   * palette leaves the slot's dead tail zeroed.
   */
  packPalette(palette: Float32Array): number;
  /** The palette bind group, or `null` before {@link SkinnedPrograms.prepare}. */
  paletteBindGroup(): GpuBindGroup | null;
  /**
   * Sizes the bone-texture palette (decision D7) for `draws` palettes totalling
   * `rows` texture rows (palettes pack contiguously by texel, so `rows` is
   * the ceiling of the total texel count over the texture width). Call **before** the pass is recorded, like
   * {@link SkinnedPrograms.prepare}; `0` is a no-op, and a frame with no
   * texture-mode mesh creates nothing.
   */
  prepareTexture(device: GpuDevice, draws: number, rows: number): void;
  /**
   * Packs `palette` (16 floats per joint) into the next free texels of the
   * shared palette texture and returns the dynamic offset of the draw's
   * base-texel uniform, or `-1` when the texture has no room (the draw is
   * skipped, never truncated).
   */
  packTexturePalette(palette: Float32Array): number;
  /** The bone-texture palette bind group, or `null` before `prepareTexture`. */
  paletteTextureBindGroup(): GpuBindGroup | null;
  /**
   * Compiles the §69 skinned caster on first call and returns it.
   * Subsequent calls reuse the pipeline for the same descriptor.
   * Throws on compile failure — the renderer latches that and skips
   * skinned casters on this device. A bind-pose shadow is never drawn.
   */
  acquireShadow(descriptor: WgpuSkinnedShadowDescriptor): GpuRenderPipeline;
  /**
   * Uploads packed palettes after the pass, before submit — the draw
   * uniforms' one-upload-per-frame shape. Absent to the byte when nothing
   * packed.
   */
  upload(device: GpuDevice): void;
  /** Drops pipelines and destroys the palette buffer. Live device only. */
  dispose(): void;
  /** Drops everything without destroying — the §61 device-loss path. */
  forget(): void;
}

/**
 * What `registerSkinningPipeline()` installs: a factory the renderer calls
 * **once per device, on the first skinned draw** — never at initialize, so a
 * scene with no skinned mesh issues the byte-identical GPU sequence it always
 * did (the RFC's acceptance gate), and never per frame.
 *
 * `create` constructs the colour pair (unlit + lit). It compiles nothing
 * itself — pipelines compile lazily on the first draw of each variant — but
 * it may throw; the renderer catches it (§61 forbids a frame from throwing),
 * warns once, and skins nothing on that device.
 */
export interface SkinningPipelineFactory {
  /** Builds one colour pair over `host`. */
  create(host: SkinningPipelineHost): SkinnedPrograms;
}

/** The slot. `null` until `registerSkinningPipeline()` fills it. */
let skinningFactory: SkinningPipelineFactory | null = null;

/**
 * Installs `factory` as the process's skinning pipeline. Called by
 * `registerSkinningPipeline()` (`wgpu-skinning.ts`); replaces any previous
 * factory — renderers that already compiled keep their pair, so replacing
 * mid-run affects only devices that have not skinned yet.
 */
export function setSkinningPipelineFactory(
  factory: SkinningPipelineFactory,
): void {
  skinningFactory = factory;
}

/**
 * The registered factory, or `null` — read by `WebgpuRenderer` on the first
 * skinned item it meets. One function call; no allocation.
 */
export function resolveSkinningPipelineFactory(): SkinningPipelineFactory | null {
  return skinningFactory;
}

/**
 * Empties the slot — for tests that must exercise the unregistered path after
 * another suite registered. Not an application API: an application that wants
 * skinning off simply never registers.
 */
export function clearRegisteredSkinningPipeline(): void {
  skinningFactory = null;
}
