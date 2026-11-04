/**
 * GPU-side textures and samplers for the WebGPU backend: one `GPUTexture` per
 * `@fourjs/render` `Texture`, cached and invalidated by version, plus a
 * **separate, deduplicated sampler cache** (§77, §83, §61).
 *
 * The port of `@fourjs/render-webgl`'s `gl-texture.ts`, and deliberately so —
 * same key (`id`), same validator (`version`), same lazy eviction, same
 * loss-aware {@link WgpuTextureCache.forget}, same refusal to throw inside
 * `render`. Reading one module tells you how the other behaves. Everything
 * below is about the three places where WebGPU makes the port *not* a
 * transliteration.
 *
 * ## 1. A sampler is an object, so sampler state is deduplicated (§77)
 *
 * R-30 and R-30b made filter, wrap, mipmaps, min filter and anisotropy
 * upload-time state on the GL backend: five `texParameteri` calls written onto
 * the texture object, read by nothing on the draw path. WebGPU has no such
 * calls. The same five decisions become a `GPUSampler` — an immutable object,
 * bound beside the texture — and a thousand sprites sharing one atlas's filter
 * and wrap pair would otherwise allocate a thousand identical samplers.
 *
 * So this module keys samplers on a **canonical string of everything a sampler
 * bakes in**, exactly as `wgpu-pipeline-cache.ts` keys pipelines: address mode,
 * magnification filter, in-level minification filter, between-level filter, and
 * the resolved anisotropy. Two textures that name the same §77 state share one
 * sampler object; two that differ in any of the five get two. {@link samplerKey}
 * is exported so a test can assert the key rather than infer it from a hit.
 *
 * The key is built from the **resolved** values, not from the texture's raw
 * fields, which is what makes the deduplication real: a texture naming
 * `filter: "linear"` and one naming nothing at all resolve to the same five
 * values and therefore to the same sampler.
 *
 * ## 2. There is no `generateMipmap`, so the chain is drawn (§77, R-30b)
 *
 * WebGL 2 builds a mip chain with one call. WebGPU has no such entry point at
 * all — by design, because the filter a chain should be built with is a
 * decision the API declines to make for you. That leaves two honest tiers, and
 * this module picks the second:
 *
 * - **Degrade**: allocate one level and collapse a mip-choosing min filter to
 *   its in-level half, which is precisely what `gl-texture.ts` does for a
 *   *context* that cannot mipmap. Cheap, already precedented — and it would
 *   make this backend strictly worse than the WebGL one at a feature WebGPU
 *   supports perfectly well, which is the wrong trade for the backend §62 lists
 *   first. It would also make §84's accounting a lie in the other direction:
 *   `Texture.byteLength` bills the whole chain (R-30b), so a one-level
 *   allocation reports bytes it never allocated.
 * - **Generate**: allocate the chain and fill levels 1…n by **drawing** — a
 *   half-size blit per level, sampling the level above with a linear clamped
 *   sampler. That is what every WebGPU engine does, it is a box filter (the
 *   same filter `generateMipmap` is specified to be free to use), and it is
 *   what this module ships.
 *
 * The cost objection is answered the way `wgpu-pipeline-cache.ts` answers it:
 * **the generator is lazy**. The blit's WGSL module, its pipeline layout, its
 * sampler and its pipeline are created on the first upload that actually asks
 * for a chain, and are cached per texture format thereafter. An application
 * that mipmaps nothing compiles nothing, allocates nothing, and issues exactly
 * the command sequence it issued before this packet — the pipeline-cost law
 * (R-6) and the lazy-query law (R-30b) applied to a whole subsystem rather than
 * to one `getExtension`.
 *
 * A mipmapped texture that carries **no CPU data** skips generation entirely:
 * WebGPU zero-initializes every level, and filtering zeroes into zeroes is
 * `n - 1` render passes to compute what is already there.
 *
 * ## 3. An upload cannot disturb the frame
 *
 * `gl-texture.ts` ends every upload with `bindTexture(TEXTURE_2D, null)`, so an
 * upload triggered mid-frame cannot leave the wrong texture bound to unit 0.
 * There is nothing to undo here: `queue.writeTexture` names its destination and
 * binds nothing, and mip generation records into **its own command encoder**,
 * submitted before the frame's. WebGPU orders submissions, so the chain is
 * complete before the pass that samples it runs, and the frame's own encoder —
 * still recording — is untouched.
 *
 * ## Accounting (§83, §84)
 *
 * {@link WgpuTextureCache.byteLength} is the sum of the resident textures'
 * described bytes, computed level by level with the same loop
 * `Texture.byteLength` uses, so a cache holding one texture reports exactly
 * that texture's `byteLength` — 256 × 256 RGBA8 is 262 144 bytes, and 4 × 4
 * mipmapped is 84, on both backends. It is backend-side diagnostics, and it is
 * deliberately *not* wired into `@fourjs/render`'s process-wide totals: those are
 * fed by `Texture` itself at construction and disposal (`resource-memory.ts`),
 * which is what keeps them true for a texture no renderer has met yet.
 *
 * Regional dirty histories preserve allocations and bind groups when storage
 * and sampler metadata are unchanged; writeTexture receives the region origin,
 * source offset and original row stride. prepareTexture waits for queue completion.
 *
 * ## Eviction policy
 *
 * Identical to `WgpuGeometryCache`'s and to the GL twin's, for identical
 * reasons: a **version bump** re-uploads on the next `acquire`, a
 * **`dispose()`d texture** is destroyed and then skipped (§83's "disposed
 * resources still in use"), and **device loss is not eviction** —
 * {@link WgpuTextureCache.forget} drops the records without destroying
 * allocations that belong to a device that is gone (§61).
 */

import { FourError } from "@fourjs/core";
import type { RenderItem } from "@fourjs/render";
import { warnDisposedInUse } from "@fourjs/render";

import {
  GPU_SHADER_STAGE,
  GPU_TEXTURE_USAGE,
  type GpuBindGroup,
  type GpuBindGroupLayout,
  type GpuDevice,
  type GpuPipelineLayout,
  type GpuRenderPipeline,
  type GpuSampler,
  type GpuShaderModule,
  type GpuTexture,
  type GpuTextureView,
} from "./webgpu-device.js";
import {
  MAP_SAMPLER_BINDING,
  MAP_TEXTURE_BINDING,
  createTextureBindGroupLayout,
} from "./wgpu-bindings.js";
import { FRAGMENT_ENTRY_POINT, VERTEX_ENTRY_POINT } from "./wgpu-unlit.js";

/**
 * The texture type this cache stores, taken from the unlit item's material
 * rather than imported by name.
 *
 * The choice `CacheableGeometry` and `gl-texture.ts`'s `CacheableTexture` both
 * make: it types the cache against **what the render list actually hands it** —
 * `@fourjs/materials`' `MaterialTexture` read contract — so the module keeps
 * working unchanged if a second texture implementation ever satisfies that
 * contract, and it cannot reach for state a render item does not carry.
 *
 * Named `WgpuCacheableTexture` rather than `CacheableTexture` because the WebGL
 * backend exports that name for its own (sprite-derived, differently-shaped)
 * type, and two backend-local types with one name across the workspace is a
 * confusion no reader benefits from.
 */
export type WgpuCacheableTexture = NonNullable<
  Extract<RenderItem, { kind: "unlit" }>["material"]["map"]
>;

/** Engine compressed format -> WebGPU device feature that enables it (R-30c). */
export const COMPRESSED_FORMAT_FEATURES: Readonly<Record<string, string>> =
  Object.freeze({
    "bc7-rgba-unorm": "texture-compression-bc",
    "etc2-rgba8unorm": "texture-compression-etc2",
    "astc-4x4-unorm": "texture-compression-astc",
  });

/** The engine names this device can upload, from its feature set (§62). */
export function supportedCompressedFormats(
  features: { has(name: string): boolean } | undefined,
): readonly string[] {
  return Object.entries(COMPRESSED_FORMAT_FEATURES)
    .filter(([, feature]) => features?.has(feature) === true)
    .map(([format]) => format);
}

/** Bytes per texel of the two formats this tier allocates (§60a). */
const BYTES_PER_TEXEL = 4;

/**
 * The anisotropy ceiling assumed when the device reports none.
 *
 * WebGPU defines **no `maxAnisotropy` limit** — the specification says an
 * implementation clamps `GPUSamplerDescriptor.maxAnisotropy` to what it
 * supports, and exposes no way to ask what that is. So there is no query to
 * make lazy here, and R-30b's law is satisfied vacuously: this backend issues
 * zero capability calls for anisotropy. `device.limits` is still consulted
 * first — reading a property of a record the device already exposes costs
 * nothing and is not a device call — so an implementation that ever begins
 * reporting the limit wins over this constant without a code change.
 *
 * 16 is the value GL's `MAX_TEXTURE_MAX_ANISOTROPY_EXT` reports on essentially
 * every device that has the extension at all, so the two backends clamp a
 * `anisotropy: 64` request to the same 16 (§62's tiers exist to keep exactly
 * that true).
 */
const ASSUMED_MAX_ANISOTROPY = 16;

/**
 * How many mip levels a `width` × `height` texture's full chain has — WebGPU's
 * `mipLevelCount`.
 *
 * The count is `1 + floor(log2(max(width, height)))`, which is exactly the
 * number of halvings `Texture.byteLength`'s loop performs plus the base level.
 * Computed by halving rather than with `Math.log2` so it cannot disagree with
 * that loop by a floating-point ulp at a power of two — the two numbers have to
 * match or the accounting is wrong (§84).
 */
export function mipLevelCount(
  width: number,
  height: number,
  depth = 1,
): number {
  let levels = 1;
  let currentWidth = width;
  let currentHeight = height;
  let currentDepth = depth;
  while (currentWidth > 1 || currentHeight > 1 || currentDepth > 1) {
    currentWidth = Math.max(1, currentWidth >> 1);
    currentHeight = Math.max(1, currentHeight >> 1);
    currentDepth = Math.max(1, currentDepth >> 1);
    levels += 1;
  }
  return levels;
}

/**
 * Bytes a `width` × `height` RGBA8 texture describes, chain included when
 * `mipmaps` (§83, §84).
 *
 * The same summation `Texture.byteLength` performs, restated here because this
 * module accounts for what it *allocated* rather than for what the CPU-side
 * descriptor claims — and the claim that the two agree is only worth making if
 * they are computed independently.
 */
export function textureByteLength(
  width: number,
  height: number,
  mipmaps: boolean,
  layers = 1,
  volume = false,
): number {
  // `layers` is faces / array layers / volume depth; only a volume halves it.
  let bytes = width * height * layers * BYTES_PER_TEXEL;
  if (!mipmaps) {
    return bytes;
  }
  let currentWidth = width;
  let currentHeight = height;
  let currentLayers = layers;
  while (
    currentWidth > 1 ||
    currentHeight > 1 ||
    (volume && currentLayers > 1)
  ) {
    currentWidth = Math.max(1, currentWidth >> 1);
    currentHeight = Math.max(1, currentHeight >> 1);
    if (volume) currentLayers = Math.max(1, currentLayers >> 1);
    bytes += currentWidth * currentHeight * currentLayers * BYTES_PER_TEXEL;
  }
  return bytes;
}

/** Box-filters a `w`×`h`×`d` RGBA8 volume down one level (CPU: a volume cannot be blitted). */
export function downsampleVolume(
  source: Uint8Array,
  w: number,
  h: number,
  d: number,
): { data: Uint8Array; w: number; h: number; d: number } {
  const nw = Math.max(1, w >> 1);
  const nh = Math.max(1, h >> 1);
  const nd = Math.max(1, d >> 1);
  const data = new Uint8Array(nw * nh * nd * BYTES_PER_TEXEL);
  for (let z = 0; z < nd; z += 1) {
    for (let y = 0; y < nh; y += 1) {
      for (let x = 0; x < nw; x += 1) {
        for (let c = 0; c < BYTES_PER_TEXEL; c += 1) {
          let sum = 0;
          let count = 0;
          for (let dz = 0; dz < 2; dz += 1) {
            for (let dy = 0; dy < 2; dy += 1) {
              for (let dx = 0; dx < 2; dx += 1) {
                const sx = Math.min(w - 1, x * 2 + dx);
                const sy = Math.min(h - 1, y * 2 + dy);
                const sz = Math.min(d - 1, z * 2 + dz);
                sum += source[((sz * h + sy) * w + sx) * BYTES_PER_TEXEL + c];
                count += 1;
              }
            }
          }
          data[((z * nh + y) * nw + x) * BYTES_PER_TEXEL + c] = Math.round(
            sum / count,
          );
        }
      }
    }
  }
  return { data, w: nw, h: nh, d: nd };
}

/** §77's `wrap` as a WebGPU address mode; see `gl-texture.ts`'s `glWrap`. */
function addressMode(wrap: string | undefined): string {
  if (wrap === "repeat") return "repeat";
  // WebGPU spells it `mirror-repeat`, GL spells it `MIRRORED_REPEAT`, and §77
  // spells it `mirrored-repeat`. This is the one place the three meet.
  if (wrap === "mirrored-repeat") return "mirror-repeat";
  return "clamp-to-edge";
}

/** §77's `filter` as a WebGPU filter mode. The fallback arm is the default. */
function filterMode(filter: string | undefined): string {
  return filter === "nearest" ? "nearest" : "linear";
}

/**
 * §77's five sampler decisions, resolved against what this upload actually
 * allocated — the value the sampler cache is keyed on.
 */
export interface ResolvedSamplerState {
  /** Both axes' wrap mode; §77 carries one field, so both read it. */
  readonly addressMode: string;
  /** Magnification filter — §77's `filter`, which has no mip levels to choose. */
  readonly magFilter: string;
  /** The in-level half of §77's `minFilter`. */
  readonly minFilter: string;
  /** The between-levels half of §77's `minFilter`. */
  readonly mipmapFilter: string;
  /** §77's `anisotropy`, resolved to what this device and state can honour. */
  readonly anisotropy: number;
}

/**
 * Splits §77's `minFilter` into WebGPU's two fields, given whether this upload
 * built a chain.
 *
 * WebGPU separates the choice *within* a level (`minFilter`) from the choice
 * *between* levels (`mipmapFilter`), where GL fuses both into one of six enums.
 * The split is mechanical — `"linear-mipmap-nearest"` is `minFilter: "linear"`
 * with `mipmapFilter: "nearest"` — and the derived default is `gl-texture.ts`'s,
 * restated in WebGPU's vocabulary: no named `minFilter` means "sample both
 * directions with `filter`", chain-aware when there is a chain.
 *
 * `hasMipmaps` collapses the mip-choosing values exactly as the GL twin does.
 * It is reachable here for a *different* reason, and one that matters: a
 * mipmapped texture with no CPU data allocates its chain but does not fill it,
 * and §85 refuses a mip-choosing filter on a texture with `mipmaps: false`, so
 * the collapse guards the case where those two meet. WebGPU is stricter than GL
 * about the pairing — `mipmapFilter: "linear"` on a one-level texture is legal
 * but samples nothing extra — so the collapse is about honesty, not validity.
 */
function splitMinFilter(
  minFilter: string | undefined,
  filter: string | undefined,
  hasMipmaps: boolean,
): { readonly minFilter: string; readonly mipmapFilter: string } {
  if (minFilter === undefined) {
    const base = filterMode(filter);
    return {
      minFilter: base,
      mipmapFilter: hasMipmaps ? base : "nearest",
    };
  }
  const base = minFilter.startsWith("nearest") ? "nearest" : "linear";
  if (!hasMipmaps || !minFilter.includes("-mipmap-")) {
    // WebGPU has no "no mipmap filter" value; `"nearest"` with one level means
    // "always level 0", which is what an in-level filter asks for.
    return { minFilter: base, mipmapFilter: "nearest" };
  }
  return {
    minFilter: base,
    mipmapFilter: minFilter.endsWith("-linear") ? "linear" : "nearest",
  };
}

/**
 * The canonical cache key for a resolved sampler state: every field, in a fixed
 * order, separated by a character no field value contains.
 *
 * {@link ResolvedSamplerState} is small enough that the argument for a string
 * key looks pedantic, and it is the same argument `pipelineKey` makes and for
 * the same §33 reason: a `Map` keyed by an object misses on structural equality
 * and iterates in allocation order. Total coverage is what makes a hit *mean*
 * something — a field left out of the key is a sampler reused with the wrong
 * state, which draws a blurred atlas instead of failing.
 */
export function samplerKey(state: ResolvedSamplerState): string {
  return [
    state.addressMode,
    state.magFilter,
    state.minFilter,
    state.mipmapFilter,
    String(state.anisotropy),
  ].join("|");
}

/** Everything one cached texture needs at draw time. */
export interface WgpuTextureRecord {
  /** The allocation. */
  readonly texture: GpuTexture;
  /** A view of the whole texture — what the bind group binds. */
  readonly view: GpuTextureView;
  /** The shared sampler for this texture's §77 state. */
  readonly sampler: GpuSampler;
  /** Group 1's bind group: this texture and its sampler (`wgpu-bindings.ts`). */
  readonly bindGroup: GpuBindGroup;
  /** `Texture.version` this record was uploaded from. */
  readonly version: number;
  /** §77 target kind: `"2d"`, `"cube"`, `"array"` or `"3d"` (R-30c). */
  readonly dimension: string;
  /** Layers / faces / slices held (1 for 2D, 6 for a cube). */
  readonly depth: number;
  /** Levels allocated: the full chain, or `1`. */
  readonly levels: number;
  /** Bytes this record describes (§84) — see {@link textureByteLength}. */
  readonly byteLength: number;
}

/**
 * The mip-generation blit's WGSL: a full-surface triangle sampling the level
 * above.
 *
 * `@group(0)` here and `@group(1)` in the unlit shader, from **one** bind-group
 * layout object (`createTextureBindGroupLayout`): the layout describes the
 * shape, the pipeline layout assigns the index, and a blit that binds nothing
 * else has no reason to leave group 0 empty.
 *
 * The uv is derived from the clip-space corner rather than carried in a vertex
 * buffer, so the blit binds no geometry at all — `(x + 1) / 2` and
 * `(1 - y) / 2`, the second flipped because WebGPU's framebuffer origin is
 * top-left while its uv origin is the top of the image.
 */
export const MIPMAP_SHADER_SOURCE = `@group(0) @binding(${String(MAP_TEXTURE_BINDING)}) var sourceTexture : texture_2d<f32>;
@group(0) @binding(${String(MAP_SAMPLER_BINDING)}) var sourceSampler : sampler;

struct BlitOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn ${VERTEX_ENTRY_POINT}(@builtin(vertex_index) index : u32) -> BlitOutput {
  let corner = i32(index);
  let x = f32(corner / 2) * 4.0 - 1.0;
  let y = f32(corner & 1) * 4.0 - 1.0;
  var output : BlitOutput;
  output.position = vec4<f32>(x, y, 0.0, 1.0);
  output.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
  return output;
}

@fragment
fn ${FRAGMENT_ENTRY_POINT}(input : BlitOutput) -> @location(0) vec4<f32> {
  return textureSample(sourceTexture, sourceSampler, input.uv);
}
`;

/** Vertices the mip blit draws: one oversized triangle, as the clear draw does. */
const MIPMAP_VERTEX_COUNT = 3;

/** All four colour channels writable (`GPUColorWrite.ALL`). */
const COLOR_WRITE_ALL = 0xf;

/**
 * Per-device store of uploaded textures and their samplers (§77, §61, §83).
 *
 * One cache belongs to one device; the renderer builds it during `initialize`
 * — which allocates nothing, so a frame that draws no texture costs exactly
 * what it did before this packet — and drops it whole on device loss.
 *
 * ```ts
 * const record = textures.acquire(material.map);
 * if (record !== null) {
 *   pass.setBindGroup(MAP_BIND_GROUP_INDEX, record.bindGroup);
 *   // draw…
 * }
 * ```
 */
export class WgpuTextureCache {
  readonly #device: GpuDevice;

  /** Records by `Texture.id`; see the module header for eviction. */
  readonly #records = new Map<string, WgpuTextureRecord>();

  /** Samplers by {@link samplerKey} — the deduplication this port exists for. */
  readonly #samplers = new Map<string, GpuSampler>();

  /** Group 1's layout, created on the first textured upload. */
  #bindGroupLayout: GpuBindGroupLayout | null = null;

  /** Layouts for cube / 2d-array / 3d view dimensions (R-30c), by view dimension. */
  readonly #layouts = new Map<string, GpuBindGroupLayout>();

  /** The blit's pipeline layout, created with the first mip chain. */
  #mipPipelineLayout: GpuPipelineLayout | null = null;

  /** The blit's WGSL module — format-independent, so one for all pipelines. */
  #mipModule: GpuShaderModule | null = null;

  /** The blit's sampler: linear, clamped — created with the first mip chain. */
  #mipSampler: GpuSampler | null = null;

  /** Blit pipelines by texel format; a chain is drawn into its own format. */
  readonly #mipPipelines = new Map<string, GpuRenderPipeline>();

  /** Bytes the resident textures describe (§84). */
  #byteLength = 0;

  /** The device's anisotropy ceiling, or `0` while it has never been resolved. */
  #maxAnisotropy = 0;

  readonly #pending = new WeakMap<WgpuTextureRecord, number>();

  #disposed = false;

  readonly #states = new WeakMap<WgpuTextureRecord, string>();

  constructor(device: GpuDevice) {
    this.#device = device;
  }

  /** Number of textures currently uploaded. Diagnostics and tests (§83, §84). */
  get size(): number {
    return this.#records.size;
  }

  /**
   * Number of **distinct** samplers created (§77).
   *
   * The measurable form of this module's central claim: a scene whose fifty
   * textures all sample the same way holds one sampler, not fifty.
   */
  get samplerCount(): number {
    return this.#samplers.size;
  }

  /** Bytes the resident textures describe — see the module header on §84. */
  get byteLength(): number {
    return this.#byteLength;
  }

  /** Whether {@link WgpuTextureCache.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Group 1's bind-group layout (`wgpu-bindings.ts`), created on first use.
   *
   * Lazy, and the laziness is the point: a `createBindGroupLayout` in
   * `initialize` would put one more call into every recorded transcript in this
   * repository, including those of applications that never draw a texture —
   * R-30b's lazy-query law, which is about not moving what nothing asked to
   * move. The pipeline cache reaches this through the provider the renderer
   * hands it, so the layout a textured pipeline is built against and the layout
   * its bind group is created against are the same object by construction.
   *
   * Returns the same object for the life of the cache; `forget()` and
   * `dispose()` drop it.
   */
  get bindGroupLayout(): GpuBindGroupLayout {
    this.#bindGroupLayout ??= createTextureBindGroupLayout(this.#device);
    return this.#bindGroupLayout;
  }

  /** Group-1 layout for a view dimension other than `"2d"` (R-30c). */
  #layoutFor(viewDimension: string): GpuBindGroupLayout {
    let layout = this.#layouts.get(viewDimension);
    if (layout === undefined) {
      layout = this.#device.createBindGroupLayout({
        label: `fourJS:map:${viewDimension}`,
        entries: [
          {
            binding: MAP_TEXTURE_BINDING,
            visibility: GPU_SHADER_STAGE.FRAGMENT,
            texture: { sampleType: "float", viewDimension },
          },
          {
            binding: MAP_SAMPLER_BINDING,
            visibility: GPU_SHADER_STAGE.FRAGMENT,
            sampler: { type: "filtering" },
          },
        ],
      });
      this.#layouts.set(viewDimension, layout);
    }
    return layout;
  }

  /**
   * Returns the bind group for `texture`, uploading it on first use and
   * re-uploading whenever `texture.version` has advanced.
   *
   * Returns `null` — and creates no entry — when the texture has been disposed
   * or once the cache is disposed, so the draw is skipped rather than painting
   * undefined content (§83). **Never throws**: this runs inside
   * `Renderer.render`, and §61 forbids throwing there.
   */
  acquire(texture: WgpuCacheableTexture): WgpuTextureRecord | null {
    return this.#acquire(texture, false);
  }

  /**
   * Like {@link WgpuTextureCache.acquire}, but also uploads `"cube"`,
   * `"array"` and `"3d"` textures (§77, R-30c). The record's bind group uses a
   * layout of the matching view dimension, which no shipped shader consumes
   * yet; `acquire` stays 2D-only so a cube can never be bound where
   * `texture_2d` is declared.
   */
  acquireResource(texture: WgpuCacheableTexture): WgpuTextureRecord | null {
    return this.#acquire(texture, true);
  }

  #acquire(
    texture: WgpuCacheableTexture,
    any: boolean,
  ): WgpuTextureRecord | null {
    if (this.#disposed) {
      return null;
    }
    if (!any && (texture.dimension ?? "2d") !== "2d") {
      return null;
    }
    const existing = this.#records.get(texture.id);
    if (existing !== undefined) {
      if (existing.version === texture.version) {
        return existing;
      }
      const region = texture.getDirtyRegion?.(existing.version);
      if (
        !texture.disposed &&
        texture.data !== null &&
        region != null &&
        this.#states.get(existing) === textureState(texture)
      ) {
        this.#device.queue.writeTexture(
          { texture: existing.texture, origin: [region.x, region.y, 0] },
          texture.data,
          {
            offset: (region.y * texture.width + region.x) * BYTES_PER_TEXEL,
            bytesPerRow: texture.width * BYTES_PER_TEXEL,
            rowsPerImage: texture.height,
          },
          [region.width, region.height],
        );
        if (existing.levels > 1)
          this.#generateMipmaps(
            existing.texture,
            (texture.colorSpace ?? "linear") === "srgb"
              ? "rgba8unorm-srgb"
              : "rgba8unorm",
            texture.width,
            texture.height,
            existing.levels,
          );
        const updated = { ...existing, version: texture.version };
        this.#states.set(updated, textureState(texture));
        this.#records.set(texture.id, updated);
        return updated;
      }
      this.#destroyRecord(existing);
      this.#records.delete(texture.id);
    }

    if (texture.disposed) {
      warnDisposedInUse("texture", texture.id);
      return null;
    }

    const record = this.#upload(texture);
    this.#states.set(record, textureState(texture));
    this.#records.set(texture.id, record);
    this.#byteLength += record.byteLength;
    return record;
  }

  /** Submitted-version residency; async preparation exposes work still in flight. */
  residency(
    texture: WgpuCacheableTexture,
  ): "absent" | "stale" | "uploading" | "resident" {
    const record = this.#records.get(texture.id);
    if (record === undefined || texture.disposed) return "absent";
    if (record.version !== texture.version) return "stale";
    return this.#pending.has(record) ? "uploading" : "resident";
  }

  /** Pre-upload and resolve only after the device queue completes that work. */
  async acquireAsync(
    texture: WgpuCacheableTexture,
  ): Promise<WgpuTextureRecord | null> {
    if (this.#disposed || texture.disposed) return null;
    const queue = this.#device.queue;
    if (queue.onSubmittedWorkDone === undefined)
      throw new FourError(
        "NOT_IMPLEMENTED",
        "Asynchronous texture preparation requires queue completion notification.",
      );
    const record = this.#acquire(texture, true);
    if (record === null) return null;
    this.#pending.set(record, (this.#pending.get(record) ?? 0) + 1);
    try {
      await queue.onSubmittedWorkDone();
      return !this.#disposed &&
        !texture.disposed &&
        texture.version === record.version &&
        this.#records.get(texture.id) === record
        ? record
        : null;
    } catch (error) {
      if (this.#records.get(texture.id) === record) {
        this.#records.delete(texture.id);
        this.#destroyRecord(record);
      }
      throw error;
    } finally {
      const count = this.#pending.get(record) ?? 1;
      if (count <= 1) this.#pending.delete(record);
      else this.#pending.set(record, count - 1);
    }
  }

  /**
   * Drops every record, sampler and pipeline **without destroying anything** —
   * the device-loss path (§61). The allocations belong to a device that no
   * longer exists.
   */
  forget(): void {
    this.#records.clear();
    this.#samplers.clear();
    this.#mipPipelines.clear();
    this.#bindGroupLayout = null;
    this.#layouts.clear();
    this.#mipPipelineLayout = null;
    this.#mipModule = null;
    this.#mipSampler = null;
    this.#byteLength = 0;
  }

  /**
   * Destroys every texture this cache created (§83). Idempotent.
   *
   * Only the textures: samplers, bind groups, layouts and pipelines have no
   * `destroy()` in WebGPU — they are released when the last reference goes away
   * — so dropping the maps *is* their release, exactly as it is in
   * `wgpu-pipeline-cache.ts`. The *application's* `Texture` objects are
   * untouched: the renderer did not create them, so it does not dispose them.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const record of this.#records.values()) {
      this.#destroyRecord(record);
    }
    this.forget();
  }

  /**
   * Clamps a texture's anisotropy request to what this device and this sampler
   * state can honour (§62, §77; R-30b).
   *
   * Two clamps, not one. The device ceiling is
   * {@link ASSUMED_MAX_ANISOTROPY}'s story. The second is WebGPU's own rule:
   * `maxAnisotropy` above 1 is only legal when the magnification,
   * minification **and** mip filters are all `"linear"`, because anisotropic
   * filtering is defined as a refinement of trilinear sampling. A nearest-
   * filtered texture asking for 16× is therefore not an authoring error — it is
   * a request the API cannot express — and §62's answer to that is the same one
   * it gives a device without the GL extension: draw it isotropically.
   */
  #resolveAnisotropy(requested: number, trilinear: boolean): number {
    if (requested <= 1 || !trilinear) {
      return 1;
    }
    if (this.#maxAnisotropy === 0) {
      const reported = this.#device.limits?.["maxAnisotropy"];
      this.#maxAnisotropy =
        typeof reported === "number" && reported >= 1
          ? Math.floor(reported)
          : ASSUMED_MAX_ANISOTROPY;
    }
    return Math.min(Math.floor(requested), this.#maxAnisotropy);
  }

  /**
   * Resolves `texture`'s §77 state into {@link ResolvedSamplerState}, then
   * returns the shared sampler for it, creating one on first sight.
   */
  #acquireSampler(
    texture: WgpuCacheableTexture,
    hasMipmaps: boolean,
  ): GpuSampler {
    const split = splitMinFilter(texture.minFilter, texture.filter, hasMipmaps);
    const magFilter = filterMode(texture.filter);
    const state: ResolvedSamplerState = {
      addressMode: addressMode(texture.wrap),
      magFilter,
      minFilter: split.minFilter,
      mipmapFilter: split.mipmapFilter,
      anisotropy: this.#resolveAnisotropy(
        texture.anisotropy ?? 1,
        magFilter === "linear" &&
          split.minFilter === "linear" &&
          split.mipmapFilter === "linear",
      ),
    };
    const key = samplerKey(state);
    const existing = this.#samplers.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const sampler = this.#device.createSampler({
      label: `fourJS:sampler:${key}`,
      addressModeU: state.addressMode,
      addressModeV: state.addressMode,
      magFilter: state.magFilter,
      minFilter: state.minFilter,
      mipmapFilter: state.mipmapFilter,
      // Present only above 1, so an isotropic sampler's descriptor is the
      // object it would have been if this field did not exist.
      ...(state.anisotropy > 1 ? { maxAnisotropy: state.anisotropy } : {}),
    });
    this.#samplers.set(key, sampler);
    return sampler;
  }

  /**
   * Uploads `texture` into a fresh allocation.
   *
   * ## Colour space (§60a, R-15)
   *
   * A texture tagged `colorSpace: "srgb"` is allocated `rgba8unorm-srgb`
   * instead of `rgba8unorm`, so the GPU decodes every sample to linear-light
   * before filtering and before the fragment stage sees it — the WebGPU
   * spelling of the GL backend's `SRGB8_ALPHA8`, read just as defensively
   * (`?? "linear"`) so a test double and every pre-R-15 texture allocate what
   * they always did.
   *
   * ## No data is not no allocation
   *
   * `data === null` allocates the storage and writes nothing: WebGPU
   * zero-initializes a new texture, so the sampler stays valid and the surface
   * draws as transparent black — a defined outcome, and the same one
   * `gl-texture.ts` gets by uploading `null` pixels.
   */
  #upload(texture: WgpuCacheableTexture): WgpuTextureRecord {
    const device = this.#device;
    const width = texture.width;
    const height = texture.height;
    const mipmaps = texture.mipmaps === true;
    const dimension = texture.dimension ?? "2d";
    const volume = dimension === "3d";
    const layers = dimension === "cube" ? 6 : (texture.depth ?? 1);
    const srgb = (texture.colorSpace ?? "linear") === "srgb";
    // R-30c: a block-compressed 2D texture uploads its levels as authored. A
    // device without the matching feature allocates zero-filled storage
    // instead (transparent black) rather than throwing inside `render`.
    const carried = texture as typeof texture & {
      readonly format?: string;
      readonly levels?: readonly Uint8Array[] | null;
    };
    const compressedLevels =
      carried.format !== undefined &&
      carried.format !== "rgba8unorm" &&
      carried.levels != null &&
      this.#device.features?.has(
        COMPRESSED_FORMAT_FEATURES[carried.format] ?? "",
      ) === true
        ? carried.levels
        : null;
    const format =
      compressedLevels === null
        ? srgb
          ? "rgba8unorm-srgb"
          : "rgba8unorm"
        : `${carried.format!}${srgb ? "-srgb" : ""}`;
    const data = texture.data;
    const levels =
      compressedLevels !== null
        ? compressedLevels.length
        : mipmaps
          ? mipLevelCount(width, height, volume ? layers : 1)
          : 1;
    // A 2D / cube / array chain is *drawn*, so its texture must be attachable
    // and readable; a volume's chain is filtered on the CPU (a volume cannot
    // be a 2D blit source), and a one-level texture is neither.
    const generate = levels > 1 && data !== null && !volume;
    const handle = device.createTexture({
      label: `fourJS:texture:${texture.id}`,
      size: dimension === "2d" ? [width, height] : [width, height, layers],
      ...(volume ? { dimension: "3d" as const } : {}),
      format,
      usage:
        GPU_TEXTURE_USAGE.TEXTURE_BINDING |
        GPU_TEXTURE_USAGE.COPY_DST |
        (generate ? GPU_TEXTURE_USAGE.RENDER_ATTACHMENT : 0),
      ...(levels > 1 ? { mipLevelCount: levels } : {}),
    });

    if (compressedLevels !== null) {
      compressedLevels.forEach((bytes, mip) => {
        const blocksWide = Math.ceil(Math.max(1, width >> mip) / 4);
        const blocksHigh = Math.ceil(Math.max(1, height >> mip) / 4);
        device.queue.writeTexture(
          { texture: handle, mipLevel: mip },
          bytes,
          { offset: 0, bytesPerRow: blocksWide * 16, rowsPerImage: blocksHigh },
          [blocksWide * 4, blocksHigh * 4],
        );
      });
    } else if (data !== null) {
      device.queue.writeTexture(
        { texture: handle },
        data,
        {
          offset: 0,
          bytesPerRow: width * BYTES_PER_TEXEL,
          rowsPerImage: height,
        },
        dimension === "2d" ? [width, height] : [width, height, layers],
      );
    }
    if (generate) {
      this.#generateMipmaps(
        handle,
        format,
        width,
        height,
        levels,
        dimension === "2d" ? 1 : layers,
      );
    } else if (levels > 1 && data !== null) {
      let level = data;
      let lw = width;
      let lh = height;
      let ld = layers;
      for (let mip = 1; mip < levels; mip += 1) {
        const next = downsampleVolume(level, lw, lh, ld);
        device.queue.writeTexture(
          { texture: handle, mipLevel: mip },
          next.data,
          {
            offset: 0,
            bytesPerRow: next.w * BYTES_PER_TEXEL,
            rowsPerImage: next.h,
          },
          [next.w, next.h, next.d],
        );
        level = next.data;
        lw = next.w;
        lh = next.h;
        ld = next.d;
      }
    }

    const viewDimension =
      dimension === "array"
        ? "2d-array"
        : dimension === "2d"
          ? "2d"
          : dimension;
    const view =
      dimension === "2d"
        ? handle.createView()
        : handle.createView({ dimension: viewDimension });
    const sampler = this.#acquireSampler(texture, levels > 1);
    return {
      texture: handle,
      view,
      sampler,
      bindGroup: device.createBindGroup({
        label: `fourJS:map:${texture.id}`,
        layout:
          dimension === "2d"
            ? this.bindGroupLayout
            : this.#layoutFor(viewDimension),
        entries: [
          { binding: MAP_TEXTURE_BINDING, resource: view },
          { binding: MAP_SAMPLER_BINDING, resource: sampler },
        ],
      }),
      version: texture.version,
      dimension,
      depth: dimension === "2d" ? 1 : layers,
      levels,
      byteLength:
        compressedLevels === null
          ? textureByteLength(width, height, mipmaps, layers, volume)
          : compressedLevels.reduce((sum, bytes) => sum + bytes.length, 0),
    };
  }

  /**
   * Fills levels 1…`levels - 1` by drawing each from the one above.
   *
   * One command encoder for the whole chain and one `submit`, recorded and
   * submitted *before* the frame's encoder finishes — WebGPU orders
   * submissions, so the chain is complete before the pass that samples it runs.
   * Each level is its own render pass, because a pass writes one attachment and
   * these are `levels - 1` different attachments.
   */
  #generateMipmaps(
    texture: GpuTexture,
    format: string,
    width: number,
    height: number,
    levels: number,
    layers = 1,
  ): void {
    const device = this.#device;
    const pipeline = this.#mipPipeline(format);
    const sampler = this.#mipBlitSampler();
    const encoder = device.createCommandEncoder({ label: "fourJS:mipmaps" });
    let levelWidth = width;
    let levelHeight = height;
    for (let level = 1; level < levels; level += 1) {
      levelWidth = Math.max(1, levelWidth >> 1);
      levelHeight = Math.max(1, levelHeight >> 1);
      for (let layer = 0; layer < layers; layer += 1) {
        const source = texture.createView({
          label: `fourJS:mip-source:${String(level - 1)}`,
          baseMipLevel: level - 1,
          mipLevelCount: 1,
          ...(layers > 1
            ? { dimension: "2d", baseArrayLayer: layer, arrayLayerCount: 1 }
            : {}),
        });
        const destination = texture.createView({
          label: `fourJS:mip-target:${String(level)}`,
          baseMipLevel: level,
          mipLevelCount: 1,
          ...(layers > 1
            ? { dimension: "2d", baseArrayLayer: layer, arrayLayerCount: 1 }
            : {}),
        });
        const pass = encoder.beginRenderPass({
          label: `fourJS:mipmap:${String(level)}`,
          colorAttachments: [
            {
              view: destination,
              // The whole level is written by the triangle, so there is nothing
              // to preserve and no scissor in play — the one place in this
              // backend where `loadOp: "clear"` is the right answer, precisely
              // because this pass is not a §61 viewport clear.
              loadOp: "clear",
              storeOp: "store",
              clearValue: [0, 0, 0, 0],
            },
          ],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(
          0,
          this.#device.createBindGroup({
            label: `fourJS:mip-bind:${String(level)}`,
            layout: this.bindGroupLayout,
            entries: [
              { binding: MAP_TEXTURE_BINDING, resource: source },
              { binding: MAP_SAMPLER_BINDING, resource: sampler },
            ],
          }),
        );
        pass.draw(MIPMAP_VERTEX_COUNT);
        pass.end();
      }
    }
    device.queue.submit([encoder.finish()]);
  }

  /** The blit's sampler: linear, clamped, mip-free — created on first use. */
  #mipBlitSampler(): GpuSampler {
    this.#mipSampler ??= this.#device.createSampler({
      label: "fourJS:mipmap-sampler",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: "linear",
      minFilter: "linear",
      // The source view is one level, so there is nothing to filter between:
      // the box filter is the four-tap bilinear read of the level above.
      mipmapFilter: "nearest",
    });
    return this.#mipSampler;
  }

  /** The blit pipeline for `format`, compiled on first use — see the header. */
  #mipPipeline(format: string): GpuRenderPipeline {
    const existing = this.#mipPipelines.get(format);
    if (existing !== undefined) {
      return existing;
    }
    const device = this.#device;
    this.#mipPipelineLayout ??= device.createPipelineLayout({
      label: "fourJS:mipmap-layout",
      bindGroupLayouts: [this.bindGroupLayout],
    });
    // One module for every format: the WGSL names no format — the render
    // target's does — so an sRGB chain after a linear one compiles a second
    // *pipeline* but never a second module (`wgpu-pipeline-cache.ts`'s
    // module-under-pipeline split, restated for a two-entry cache).
    this.#mipModule ??= device.createShaderModule({
      label: "fourJS:mipmap",
      code: MIPMAP_SHADER_SOURCE,
    });
    const module = this.#mipModule;
    const pipeline = device.createRenderPipeline({
      label: `fourJS:mipmap:${format}`,
      layout: this.#mipPipelineLayout,
      vertex: { module, entryPoint: VERTEX_ENTRY_POINT, buffers: [] },
      fragment: {
        module,
        entryPoint: FRAGMENT_ENTRY_POINT,
        targets: [{ format, writeMask: COLOR_WRITE_ALL }],
      },
      primitive: { topology: "triangle-list" },
    });
    this.#mipPipelines.set(format, pipeline);
    return pipeline;
  }

  #destroyRecord(record: WgpuTextureRecord): void {
    record.texture.destroy?.();
    this.#byteLength -= record.byteLength;
  }
}

/** Storage and sampler identity; a metadata edit requires a full upload. */
function textureState(texture: WgpuCacheableTexture): string {
  return [
    texture.width,
    texture.height,
    texture.dimension,
    texture.depth,
    texture.colorSpace,
    texture.filter,
    texture.minFilter,
    texture.wrap,
    texture.mipmaps,
    texture.anisotropy,
  ].join("|");
}
