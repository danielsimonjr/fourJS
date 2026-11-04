/**
 * §82's GPU compute on the WebGPU backend (WP-R1.8) — compute pipelines, bind
 * groups over storage buffers, dispatch, and buffer readback, plus the §36
 * GPU particle **integrator** kernel that makes gap row `R-31` movable.
 *
 * ## Where §82's `ComputePass` lives — the Q3 promotion, executed
 *
 * WP-R1.8 landed the descriptor **here** because `packages/render` was inside
 * RFC 0004's concurrent scope; the recorded follow-up — the R-1 plan's owner
 * question Q3 — executed on 2026-08-29 as the promised **one re-export**:
 * {@link ComputePassDescriptor}, {@link ComputeBinding},
 * {@link ComputeBindingAccess} and {@link COMPUTE_ENTRY_POINT} now live in
 * `@fourjs/render`'s `compute.ts` (with the structural `ComputeBuffer` handle
 * and the optional `Renderer.compute?()` member), and this module re-exports
 * them — the capability-token identity precedent, so no call site moved.
 * What stays here is everything device-shaped: {@link WgpuComputeBuffer}
 * (the one `ComputeBuffer` implementor), the cache, the helpers, and the §36
 * integrator kernel.
 *
 * §82's spec example spells `bindings` as a *named map*
 * (`{ positions, velocities, parameters }`); the seam takes an **ordered
 * array**, where index *i* is `@group(0) @binding(i)` — order is what a
 * bind-group layout actually consumes, and the named-map sugar is the
 * umbrella-level `Four.ComputePass`, landed with the same promotion. Because
 * the handle type is now structural, {@link WgpuComputeCache.dispatch}
 * additionally refuses a buffer some *other* backend minted — an
 * `instanceof` narrowing per binding, loud rather than a guess (§85).
 *
 * ## Presence is the capability (§62, R-30b)
 *
 * WebGL 2 has no compute, and a device double built before this packet has no
 * compute members. Every compute entry point on the structural device surface
 * is therefore **optional** (`webgpu-device.ts`), and the helpers here answer
 * `null`/`false` for a surface that lacks them — `WebgpuRenderer` turns that
 * into `UNSUPPORTED_GPU_FEATURE`, exactly as `readPixels` does. §82's own
 * closing sentence — *"basic graphics and physics functionality must not
 * require compute support"* — is honoured structurally: nothing in the frame
 * path calls anything in this module.
 *
 * ## Pipelines are cached on the emitted source, lazily
 *
 * A compute pipeline is immutable, like a render pipeline, so
 * {@link WgpuComputeCache} keys pipelines on the tuple that gives them
 * identity — the binding access pattern (it selects the layout), the entry
 * point, and the WGSL source itself. Keying on the *source* is the RFC 0001
 * program-cache decision one stage over: two descriptors carrying the same
 * string dispatch through one pipeline, and a shader module is compiled once
 * however many entry points or binding patterns use it. `createShaderModule`
 * and `createComputePipeline` do not throw for a shader that fails to
 * compile — the failure surfaces through the device's error scopes and the
 * dispatch does nothing — which is the render-pipeline cache's recorded
 * reading of WebGPU's error model, unchanged.
 *
 * ## The §36 integrator (R-31's GPU-simulation half)
 *
 * {@link PARTICLE_INTEGRATOR_SHADER_SOURCE} is the emitter's semi-implicit
 * Euler step (`v += g·dt`, then `p += v·dt` — `@fourjs/particles`' documented
 * closed form) over flat `array<f32>` position/velocity lanes in the pool's
 * own x,y,z layout, under a constant gravity. It is the *integrator* the
 * WP-R1.8 packet scopes and nothing more: §27's force fields and §36's
 * `collisions: "depth-buffer"` are each their own follow-up packet, and
 * `@fourjs/particles`' `simulation: "gpu"` option widens only in the change
 * that wires this kernel to the emitter (the recorded WP-9.1 rule: an option
 * that silently does nothing is worse than one that does not exist yet).
 * The `count` lane travels as **f32** — the light block's precedent: the
 * params pack through one `Float32Array`, and f32 is exact far beyond §112's
 * 100 000-particle budget.
 */

import { FourError } from "@fourjs/core";
import {
  COMPUTE_ENTRY_POINT,
  type ComputeBinding,
  type ComputeBindingAccess,
  type ComputeBuffer,
  type ComputePassDescriptor,
} from "@fourjs/render";

import {
  GPU_BUFFER_USAGE,
  GPU_MAP_MODE,
  GPU_SHADER_STAGE,
  type GpuBindGroupLayout,
  type GpuComputePipeline,
  type GpuDevice,
  type GpuPipelineLayout,
  type GpuShaderModule,
  type GpuBuffer,
} from "./webgpu-device.js";

// The Q3 promotion's re-export (module header): the descriptor vocabulary is
// `@fourjs/render`'s and these are the very tokens, so a pre-promotion import
// from this package still names identical types.
export { COMPUTE_ENTRY_POINT };
export type { ComputeBinding, ComputeBindingAccess, ComputePassDescriptor };

/** Options for {@link createComputeBuffer}: a byte size, or initial contents. */
export interface ComputeBufferOptions {
  /** Diagnostic name. */
  readonly label?: string;
  /**
   * Allocation size in bytes — a positive multiple of 4 (`writeBuffer`'s own
   * rule, §62). Exactly one of `size` and `data` must be given.
   */
  readonly size?: number;
  /** Initial contents; the allocation takes the view's `byteLength`. */
  readonly data?: ArrayBufferView;
}

/**
 * A storage buffer the application owns (§82, §83) — created by
 * `WebgpuRenderer.createComputeBuffer`, disposed by whoever created it.
 *
 * Allocated `STORAGE | COPY_DST | COPY_SRC`, so every compute buffer can be
 * written (`writeComputeBuffer`), bound to a kernel, and read back
 * (`readComputeBufferBytes`) — three usage bits against a per-usage-tier
 * split that would complicate §82's tiny surface for no measured saving.
 * (`wgpu-particle-simulation.ts` mints one with `VERTEX` added, for a buffer
 * the §36 draw also binds as an instance stream — its header owns the
 * deviation.)
 *
 * The one implementor of `@fourjs/render`'s structural {@link ComputeBuffer}
 * (the Q3 promotion): the brand plus the §83 trio are the cross-seam face;
 * {@link WgpuComputeBuffer.buffer} stays this backend's own.
 */
export class WgpuComputeBuffer implements ComputeBuffer {
  /** The {@link ComputeBuffer} brand — one property load discriminates. */
  readonly isComputeBuffer = true;

  /**
   * The device allocation — a backend seam, not an application surface: the
   * dispatch and readback paths read it, and nothing else should.
   */
  readonly buffer: GpuBuffer;

  /** Allocation size in bytes. */
  readonly byteLength: number;

  #disposed = false;

  /** Internal — obtain instances through `WebgpuRenderer.createComputeBuffer`. */
  constructor(buffer: GpuBuffer, byteLength: number) {
    this.buffer = buffer;
    this.byteLength = byteLength;
  }

  /** Whether {@link WgpuComputeBuffer.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Releases the allocation (§83). Idempotent — and safe after a device loss:
   * WebGPU's `destroy()` on an invalidated buffer is a defined no-op, unlike
   * GL's delete-on-a-lost-context.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.buffer.destroy();
  }
}

/** Throws `INVALID_APPLICATION_STATE` for a descriptor this module refuses. */
function refuse(message: string, context: Record<string, unknown>): never {
  throw new FourError("INVALID_APPLICATION_STATE", message, { context });
}

/**
 * Allocates one storage buffer (§82), uploading `data` when given.
 *
 * Throws a `FourError` carrying `INVALID_APPLICATION_STATE` for an option
 * record naming both `size` and `data`, neither, a size that is not a
 * positive multiple of 4, or contents whose `byteLength` is not a multiple
 * of 4 — `writeBuffer`'s and the storage-address-space's shared granularity,
 * surfaced at creation rather than as a device-side validation error later.
 */
export function createComputeBuffer(
  device: GpuDevice,
  options: ComputeBufferOptions,
): WgpuComputeBuffer {
  const data = options.data;
  const size = data === undefined ? options.size : data.byteLength;
  if (
    size === undefined ||
    (data !== undefined && options.size !== undefined)
  ) {
    refuse(
      "createComputeBuffer takes exactly one of `size` (bytes) and `data` " +
        "(initial contents) (§82).",
      { size: options.size, hasData: data !== undefined },
    );
  }
  if (!Number.isInteger(size) || size <= 0 || size % 4 !== 0) {
    refuse(
      "A compute buffer's size must be a positive multiple of 4 bytes (§62).",
      { size },
    );
  }
  const buffer = device.createBuffer({
    label: options.label ?? "fourJS:compute-buffer",
    size,
    usage:
      GPU_BUFFER_USAGE.STORAGE |
      GPU_BUFFER_USAGE.COPY_DST |
      GPU_BUFFER_USAGE.COPY_SRC,
  });
  if (data !== undefined) {
    device.queue.writeBuffer(buffer, 0, data);
  }
  return new WgpuComputeBuffer(buffer, size);
}

/**
 * Uploads `data` into `buffer` at `byteOffset` (§82) — `queue.writeBuffer`,
 * with the range validated here so a mistake is a named `FourError` rather
 * than a device-side validation message: the buffer must be live (§83), the
 * offset a non-negative multiple of 4, and the written range inside the
 * allocation.
 */
export function writeComputeBuffer(
  device: GpuDevice,
  buffer: WgpuComputeBuffer,
  data: ArrayBufferView,
  byteOffset = 0,
): void {
  if (buffer.disposed) {
    refuse("writeComputeBuffer was given a disposed buffer (§83).", {
      byteLength: buffer.byteLength,
    });
  }
  if (
    !Number.isInteger(byteOffset) ||
    byteOffset < 0 ||
    byteOffset % 4 !== 0 ||
    byteOffset + data.byteLength > buffer.byteLength
  ) {
    refuse(
      "writeComputeBuffer's range must sit inside the allocation at a " +
        "4-byte-aligned offset (§62).",
      {
        byteOffset,
        dataBytes: data.byteLength,
        bufferBytes: buffer.byteLength,
      },
    );
  }
  device.queue.writeBuffer(buffer.buffer, byteOffset, data);
}

/**
 * Copies `buffer`'s contents into a tightly packed `ArrayBuffer` —
 * `copyBufferToBuffer` + `mapAsync`, `readTexturePixels`' shape for a buffer
 * instead of a texture, with the same discipline: the staging buffer is
 * created per call and destroyed before resolving.
 *
 * Resolves `null` when the device surface lacks the entry points
 * (`copyBufferToBuffer`, the mapping trio — presence is the capability); the
 * caller turns that into `UNSUPPORTED_GPU_FEATURE`. Throws
 * `INVALID_APPLICATION_STATE` for a disposed buffer (§83) — a validation
 * fact, not a capability one.
 */
export async function readComputeBufferBytes(
  device: GpuDevice,
  buffer: WgpuComputeBuffer,
): Promise<ArrayBuffer | null> {
  if (buffer.disposed) {
    refuse("readComputeBufferBytes was given a disposed buffer (§83).", {
      byteLength: buffer.byteLength,
    });
  }
  const encoder = device.createCommandEncoder({
    label: "fourJS:compute-readback",
  });
  if (encoder.copyBufferToBuffer === undefined) {
    return null;
  }
  const staging = device.createBuffer({
    label: "fourJS:compute-readback",
    size: buffer.byteLength,
    usage: GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.MAP_READ,
  });
  if (
    staging.mapAsync === undefined ||
    staging.getMappedRange === undefined ||
    staging.unmap === undefined
  ) {
    staging.destroy();
    return null;
  }

  encoder.copyBufferToBuffer(buffer.buffer, 0, staging, 0, buffer.byteLength);
  device.queue.submit([encoder.finish()]);

  try {
    await staging.mapAsync(GPU_MAP_MODE.READ);
    const bytes = new Uint8Array(staging.getMappedRange()).slice();
    staging.unmap();
    return bytes.buffer;
  } finally {
    staging.destroy();
  }
}

/** A binding normalized to its buffer-and-access pair. */
interface ResolvedBinding {
  readonly buffer: WgpuComputeBuffer;
  readonly access: ComputeBindingAccess;
}

/**
 * Per-device store of compute pipelines, layouts and modules (§82) — the
 * compute half of `WgpuPipelineCache`, kept separate so the frame path never
 * links it: the renderer creates one lazily on the first `compute()` call
 * (the lazy-subsystem precedent), and drops it whole on device loss and
 * disposal (nothing here has a `destroy()`; dropping the maps is the
 * release, the render cache's §83 reading).
 */
export class WgpuComputeCache {
  readonly #device: GpuDevice;

  /** Bind-group layouts by access pattern (e.g. `"rw"`, `"rww"`). */
  readonly #layouts = new Map<string, GpuBindGroupLayout>();

  /** Pipeline layouts by the same access pattern. */
  readonly #pipelineLayouts = new Map<string, GpuPipelineLayout>();

  /** Modules by WGSL source — one compile per kernel string. */
  readonly #modules = new Map<string, GpuShaderModule>();

  /** Pipelines by `pattern|entryPoint|source`. */
  readonly #pipelines = new Map<string, GpuComputePipeline>();

  #disposed = false;

  constructor(device: GpuDevice) {
    this.#device = device;
  }

  /** How many distinct compute pipelines have been created. Diagnostics and tests. */
  get pipelineCount(): number {
    return this.#pipelines.size;
  }

  /** How many WGSL modules have been compiled. Diagnostics and tests. */
  get moduleCount(): number {
    return this.#modules.size;
  }

  /** Whether {@link WgpuComputeCache.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Records and submits one §82 dispatch.
   *
   * Returns `false` — having recorded nothing — when the device surface lacks
   * the compute entry points (`createComputePipeline`, `beginComputePass`);
   * the caller turns that into `UNSUPPORTED_GPU_FEATURE`. Throws
   * `INVALID_APPLICATION_STATE` for a descriptor this module refuses: a
   * workgroup count that is not a non-negative integer, a disposed buffer in
   * `bindings`, or a call on a disposed cache.
   */
  dispatch(pass: ComputePassDescriptor): boolean {
    if (this.#disposed) {
      refuse(
        "compute() was called after the renderer released its device (§83).",
        {
          label: pass.label,
        },
      );
    }
    const device = this.#device;
    if (device.createComputePipeline === undefined) {
      return false;
    }
    for (const count of pass.workgroups) {
      if (!Number.isInteger(count) || count < 0) {
        refuse(
          "ComputePass.workgroups must be three non-negative integers (§82).",
          { workgroups: pass.workgroups },
        );
      }
    }
    const bindings: ResolvedBinding[] = pass.bindings.map((entry) => {
      const bare = (entry as Partial<ComputeBuffer>).isComputeBuffer === true;
      const buffer: unknown = bare ? entry : (entry as ComputeBinding).buffer;
      if (!(buffer instanceof WgpuComputeBuffer)) {
        // The promoted handle type is structural (`@fourjs/render`'s
        // `ComputeBuffer`), so a buffer minted by some other backend
        // type-checks; only this class carries a device allocation this
        // dispatch can bind. Loud, never a guess (§85).
        refuse(
          "ComputePass.bindings names a buffer this backend did not " +
            "create (§82) — compute buffers are only meaningful to the " +
            "renderer that allocated them.",
          { label: pass.label },
        );
      }
      return {
        buffer,
        access: bare
          ? "read-write"
          : ((entry as ComputeBinding).access ?? "read-write"),
      };
    });
    for (const binding of bindings) {
      if (binding.buffer.disposed) {
        refuse("ComputePass.bindings names a disposed buffer (§83).", {
          label: pass.label,
        });
      }
    }

    const pattern = bindings
      .map((binding) => (binding.access === "read-only" ? "r" : "w"))
      .join("");
    const bindGroupLayout = this.#acquireBindGroupLayout(pattern);
    const pipeline = this.#acquirePipeline(
      device.createComputePipeline.bind(device),
      pattern,
      pass.entryPoint ?? COMPUTE_ENTRY_POINT,
      pass.shader,
    );

    const encoder = device.createCommandEncoder({ label: "fourJS:compute" });
    if (encoder.beginComputePass === undefined) {
      return false;
    }
    const computePass = encoder.beginComputePass({
      label: `fourJS:compute:${pass.label ?? "pass"}`,
    });
    computePass.setPipeline(pipeline);
    // `null` exactly for a binding-less kernel — the layout and the bindings
    // array empty out together, so one comparison serves both.
    if (bindGroupLayout !== null) {
      computePass.setBindGroup(
        0,
        device.createBindGroup({
          label: `fourJS:compute:${pass.label ?? "pass"}`,
          layout: bindGroupLayout,
          entries: bindings.map((binding, index) => ({
            binding: index,
            resource: {
              buffer: binding.buffer.buffer,
              offset: 0,
              size: binding.buffer.byteLength,
            },
          })),
        }),
      );
    }
    computePass.dispatchWorkgroups(
      pass.workgroups[0],
      pass.workgroups[1],
      pass.workgroups[2],
    );
    computePass.end();
    device.queue.submit([encoder.finish()]);
    return true;
  }

  /**
   * Drops every pipeline, layout and module. Nothing is destroyed — WebGPU
   * compute pipelines and modules have no `destroy()` (§83, the render
   * cache's rule). Idempotent.
   */
  dispose(): void {
    this.#disposed = true;
    this.#layouts.clear();
    this.#pipelineLayouts.clear();
    this.#modules.clear();
    this.#pipelines.clear();
  }

  /** The pipeline for (`pattern`, `entryPoint`, `source`), created on first use. */
  #acquirePipeline(
    createComputePipeline: NonNullable<GpuDevice["createComputePipeline"]>,
    pattern: string,
    entryPoint: string,
    source: string,
  ): GpuComputePipeline {
    const key = `${pattern}|${entryPoint}|${source}`;
    const existing = this.#pipelines.get(key);
    if (existing !== undefined) {
      return existing;
    }
    let module = this.#modules.get(source);
    if (module === undefined) {
      module = this.#device.createShaderModule({
        label: "fourJS:compute",
        code: source,
      });
      this.#modules.set(source, module);
    }
    const pipeline = createComputePipeline({
      label: `fourJS:compute:${entryPoint}`,
      layout: this.#acquirePipelineLayout(pattern),
      compute: { module, entryPoint },
    });
    this.#pipelines.set(key, pipeline);
    return pipeline;
  }

  /**
   * The bind-group layout for `pattern`, created on first use — one
   * `COMPUTE`-visible storage entry per binding, read-only where the pattern
   * says `r` — or `null` for the empty pattern: a binding-less kernel's
   * pipeline layout carries **no** bind-group layouts at all, so nothing
   * requires a group the dispatch never sets.
   */
  #acquireBindGroupLayout(pattern: string): GpuBindGroupLayout | null {
    if (pattern.length === 0) {
      return null;
    }
    const existing = this.#layouts.get(pattern);
    if (existing !== undefined) {
      return existing;
    }
    const layout = this.#device.createBindGroupLayout({
      label: `fourJS:compute:${pattern}`,
      entries: Array.from(pattern).map((access, index) => ({
        binding: index,
        visibility: GPU_SHADER_STAGE.COMPUTE,
        buffer: {
          type: access === "r" ? "read-only-storage" : "storage",
        },
      })),
    });
    this.#layouts.set(pattern, layout);
    return layout;
  }

  /**
   * The pipeline layout for `pattern`, created on first use over
   * `#acquireBindGroupLayout`'s answer for it.
   */
  #acquirePipelineLayout(pattern: string): GpuPipelineLayout {
    const existing = this.#pipelineLayouts.get(pattern);
    if (existing !== undefined) {
      return existing;
    }
    const layout = this.#acquireBindGroupLayout(pattern);
    const pipelineLayout = this.#device.createPipelineLayout({
      label: `fourJS:compute:${pattern}`,
      bindGroupLayouts: layout === null ? [] : [layout],
    });
    this.#pipelineLayouts.set(pattern, pipelineLayout);
    return pipelineLayout;
  }
}

/** Invocations per workgroup of the §36 integrator kernel, along x. */
export const PARTICLE_INTEGRATOR_WORKGROUP_SIZE = 64;

/** Most §27 fields the integrator evaluates per step (mirrors `MAX_GPU_FIELDS`). */
export const PARTICLE_SIMULATION_MAX_FIELDS = 8;

/** Floats before the field array: header lanes plus the view-projection. */
export const PARTICLE_SIMULATION_HEADER_FLOATS = 32;

/** Floats per field record (six vec4s; see {@link writeParticleSimulationParams}). */
export const PARTICLE_SIMULATION_FIELD_FLOATS = 24;

/**
 * Floats in the integrator's params block (R-31 residue, field stack):
 *
 * - lanes 0-7: `deltaSeconds`, `count`, 0, 0, gravity xyz, collision mode
 *   (`0` off, `1` ground rest, `2` scene-depth kill);
 * - lane 11: ground `y`; lane 12: field count; lane 13: simulation time;
 *   lane 14: depth bias;
 * - lanes 16-31: the column-major view-projection (depth collision);
 * - then {@link PARTICLE_SIMULATION_MAX_FIELDS} records of
 *   {@link PARTICLE_SIMULATION_FIELD_FLOATS} floats: `a = [kind, strength,
 *   minDistance, volumeShape]`, `b = [primary xyz, volumeFalloff]`, `c =
 *   [axis xyz, frequency]`, `d = [volume centre xyz, radius]`, `e = [box
 *   extents xyz, amplitude]`, `s = [saltX, saltY, saltZ, 0]` as raw uint32.
 *
 * Every lane is written each call so no uploaded byte is history (§33).
 */
export const PARTICLE_SIMULATION_PARAMS_FLOATS =
  PARTICLE_SIMULATION_HEADER_FLOATS +
  PARTICLE_SIMULATION_MAX_FIELDS * PARTICLE_SIMULATION_FIELD_FLOATS;

/** Field kind codes of the record's `a.x` lane. */
export const PARTICLE_FIELD_KIND = Object.freeze({
  radial: 1,
  uniform: 2,
  drag: 3,
  wind: 4,
  vortex: 5,
  turbulence: 6,
});

/**
 * Structural twin of `@fourjs/particles`' `ParticleGpuField` (this package
 * does not import it): `kind` plus the optional numeric lanes of every kind.
 */
export interface ParticleSimulationField {
  readonly kind: keyof typeof PARTICLE_FIELD_KIND;
  readonly originX?: number;
  readonly originY?: number;
  readonly originZ?: number;
  readonly strength?: number;
  readonly minDistance?: number;
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly coefficient?: number;
  readonly windX?: number;
  readonly windY?: number;
  readonly windZ?: number;
  readonly centerX?: number;
  readonly centerY?: number;
  readonly centerZ?: number;
  readonly axisX?: number;
  readonly axisY?: number;
  readonly axisZ?: number;
  readonly saltX?: number;
  readonly saltY?: number;
  readonly saltZ?: number;
  readonly frequency?: number;
  readonly amplitude?: number;
  readonly scrollX?: number;
  readonly scrollY?: number;
  readonly scrollZ?: number;
  readonly volume?: {
    readonly shape: "sphere" | "box";
    readonly centerX: number;
    readonly centerY: number;
    readonly centerZ: number;
    readonly radius: number;
    readonly extentX: number;
    readonly extentY: number;
    readonly extentZ: number;
    readonly falloff: number;
  };
}

/** Optional §27 GPU field / collision extras for {@link writeParticleSimulationParams}. */
export interface ParticleSimulationFieldParams {
  /** The ordered field stack (at most {@link PARTICLE_SIMULATION_MAX_FIELDS}). */
  readonly fields?: readonly ParticleSimulationField[];
  /** Simulation time in seconds (turbulence scroll). */
  readonly time?: number;
  readonly collisionGroundY?: number;
  /** `0` off, `1` rest-on-ground, `2` scene-depth kill. */
  readonly collisionMode?: number;
  /** NDC depth bias of the scene-depth test. */
  readonly depthBias?: number;
  /** Column-major view-projection (16 floats) for mode 2. */
  readonly viewProjection?: ArrayLike<number>;
}

const uint32Views = new WeakMap<Float32Array, Uint32Array>();

/**
 * Packs the integrator's params block into `out` at index 0 and returns it —
 * the light-block writer's shape for §36. `count` travels as f32 (module
 * header; exact far beyond §112's budget). Allocation-free after the first
 * call per `out` (the uint32 salt view is cached).
 */
export function writeParticleSimulationParams(
  out: Float32Array,
  deltaSeconds: number,
  count: number,
  gravityX: number,
  gravityY: number,
  gravityZ: number,
  fields?: ParticleSimulationFieldParams,
): Float32Array {
  out[0] = deltaSeconds;
  out[1] = count;
  out[2] = 0;
  out[3] = 0;
  out[4] = gravityX;
  out[5] = gravityY;
  out[6] = gravityZ;
  out[7] = fields?.collisionMode ?? 0;
  if (out.length < PARTICLE_SIMULATION_PARAMS_FLOATS) {
    return out;
  }
  const stack = fields?.fields;
  const fieldCount = stack === undefined ? 0 : stack.length;
  if (fieldCount > PARTICLE_SIMULATION_MAX_FIELDS) {
    refuse(
      "The particle integrator holds at most " +
        `${String(PARTICLE_SIMULATION_MAX_FIELDS)} fields (§27 GPU stack).`,
      { fields: fieldCount },
    );
  }
  out[8] = 0;
  out[9] = 0;
  out[10] = 0;
  out[11] = fields?.collisionGroundY ?? 0;
  out[12] = fieldCount;
  out[13] = fields?.time ?? 0;
  out[14] = fields?.depthBias ?? 0;
  out[15] = 0;
  const matrix = fields?.viewProjection;
  for (let i = 0; i < 16; i += 1) {
    out[16 + i] = matrix === undefined ? 0 : matrix[i];
  }
  let salts = uint32Views.get(out);
  if (salts === undefined) {
    salts = new Uint32Array(out.buffer, out.byteOffset, out.length);
    uint32Views.set(out, salts);
  }
  for (let f = 0; f < PARTICLE_SIMULATION_MAX_FIELDS; f += 1) {
    const base =
      PARTICLE_SIMULATION_HEADER_FLOATS + f * PARTICLE_SIMULATION_FIELD_FLOATS;
    if (stack === undefined || f >= fieldCount) {
      out.fill(0, base, base + PARTICLE_SIMULATION_FIELD_FLOATS);
      continue;
    }
    packParticleField(out, salts, base, stack[f]);
  }
  return out;
}

/** Packs one field record at `base` (layout: see the params constant). */
function packParticleField(
  out: Float32Array,
  salts: Uint32Array,
  base: number,
  field: ParticleSimulationField,
): void {
  out.fill(0, base, base + PARTICLE_SIMULATION_FIELD_FLOATS);
  const volume = field.volume;
  out[base] = PARTICLE_FIELD_KIND[field.kind];
  out[base + 3] = volume === undefined ? 0 : volume.shape === "sphere" ? 1 : 2;
  switch (field.kind) {
    case "radial":
      out[base + 1] = field.strength ?? 0;
      out[base + 2] = field.minDistance ?? 0;
      out[base + 4] = field.originX ?? 0;
      out[base + 5] = field.originY ?? 0;
      out[base + 6] = field.originZ ?? 0;
      break;
    case "uniform":
      out[base + 4] = field.x ?? 0;
      out[base + 5] = field.y ?? 0;
      out[base + 6] = field.z ?? 0;
      break;
    case "drag":
      out[base + 1] = field.coefficient ?? 0;
      break;
    case "wind":
      out[base + 1] = field.coefficient ?? 0;
      out[base + 4] = field.windX ?? 0;
      out[base + 5] = field.windY ?? 0;
      out[base + 6] = field.windZ ?? 0;
      break;
    case "vortex":
      out[base + 1] = field.strength ?? 0;
      out[base + 2] = field.minDistance ?? 0;
      out[base + 4] = field.centerX ?? 0;
      out[base + 5] = field.centerY ?? 0;
      out[base + 6] = field.centerZ ?? 0;
      out[base + 8] = field.axisX ?? 0;
      out[base + 9] = field.axisY ?? 0;
      out[base + 10] = field.axisZ ?? 0;
      break;
    case "turbulence":
      out[base + 4] = field.scrollX ?? 0;
      out[base + 5] = field.scrollY ?? 0;
      out[base + 6] = field.scrollZ ?? 0;
      out[base + 11] = field.frequency ?? 0;
      out[base + 19] = field.amplitude ?? 0;
      salts[base + 20] = field.saltX ?? 0;
      salts[base + 21] = field.saltY ?? 0;
      salts[base + 22] = field.saltZ ?? 0;
      break;
  }
  if (volume !== undefined) {
    out[base + 7] = volume.falloff;
    out[base + 12] = volume.centerX;
    out[base + 13] = volume.centerY;
    out[base + 14] = volume.centerZ;
    out[base + 15] = volume.radius;
    out[base + 16] = volume.extentX;
    out[base + 17] = volume.extentY;
    out[base + 18] = volume.extentZ;
  }
}

/**
 * The workgroup grid that covers `count` particles along x — §82's
 * `workgroups` for the integrator. Zero for an empty system, which
 * dispatches WebGPU's defined no-op.
 */
export function particleIntegratorWorkgroups(
  count: number,
): readonly [number, number, number] {
  return [Math.ceil(count / PARTICLE_INTEGRATOR_WORKGROUP_SIZE), 1, 1];
}

/**
 * The §36 GPU particle integrator (R-31's simulation half) — semi-implicit
 * Euler under constant gravity, `@fourjs/particles`' documented step order
 * (`v += g·dt`, then `p += v·dt`) over the pool's flat x,y,z `Float32Array`
 * lanes.
 *
 * Bindings, in {@link ComputePassDescriptor.bindings} order:
 *
 * 0. params — {@link PARTICLE_SIMULATION_PARAMS_FLOATS} floats, `"read-only"`
 *    (see {@link writeParticleSimulationParams});
 * 1. positions — `array<f32>`, 3 lanes per particle, `"read-write"`;
 * 2. velocities — `array<f32>`, 3 lanes per particle, `"read-write"`.
 *
 * One invocation integrates one particle; invocations past `count` return —
 * the workgroup rounding of {@link particleIntegratorWorkgroups} makes the
 * overshoot at most one workgroup.
 */
export const PARTICLE_INTEGRATOR_SHADER_SOURCE = `struct FieldRecord {
  a : vec4<f32>,
  b : vec4<f32>,
  c : vec4<f32>,
  d : vec4<f32>,
  e : vec4<f32>,
  s : vec4<u32>,
};

struct ParticleSimulationParams {
  deltaSeconds : f32,
  count : f32,
  unusedA : f32,
  unusedB : f32,
  gravity : vec4<f32>,
  ground : vec4<f32>,
  info : vec4<f32>,
  viewProjection : mat4x4<f32>,
  fields : array<FieldRecord, ${String(PARTICLE_SIMULATION_MAX_FIELDS)}>,
};

@group(0) @binding(0) var<storage, read> params : ParticleSimulationParams;
@group(0) @binding(1) var<storage, read_write> positions : array<f32>;
@group(0) @binding(2) var<storage, read_write> velocities : array<f32>;

fn hashCell(ix : i32, iy : i32, iz : i32, salt : u32) -> u32 {
  var h = salt;
  h = (h ^ bitcast<u32>(ix)) * 0x27d4eb2du;
  h = h ^ (h >> 15u);
  h = (h ^ bitcast<u32>(iy)) * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = (h ^ bitcast<u32>(iz)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  h = h * 0x9e3779b1u;
  h = h ^ (h >> 16u);
  return h;
}

fn cornerValue(ix : i32, iy : i32, iz : i32, salt : u32) -> f32 {
  return (f32(hashCell(ix, iy, iz, salt)) / 4294967296.0) * 2.0 - 1.0;
}

fn fadeCurve(t : f32) -> f32 {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

fn valueNoise(p : vec3<f32>, salt : u32) -> f32 {
  let fl = floor(p);
  let ix = i32(fl.x);
  let iy = i32(fl.y);
  let iz = i32(fl.z);
  let ux = fadeCurve(p.x - fl.x);
  let uy = fadeCurve(p.y - fl.y);
  let uz = fadeCurve(p.z - fl.z);
  let c000 = cornerValue(ix, iy, iz, salt);
  let c100 = cornerValue(ix + 1, iy, iz, salt);
  let c010 = cornerValue(ix, iy + 1, iz, salt);
  let c110 = cornerValue(ix + 1, iy + 1, iz, salt);
  let c001 = cornerValue(ix, iy, iz + 1, salt);
  let c101 = cornerValue(ix + 1, iy, iz + 1, salt);
  let c011 = cornerValue(ix, iy + 1, iz + 1, salt);
  let c111 = cornerValue(ix + 1, iy + 1, iz + 1, salt);
  let x00 = c000 + (c100 - c000) * ux;
  let x10 = c010 + (c110 - c010) * ux;
  let x01 = c001 + (c101 - c001) * ux;
  let x11 = c011 + (c111 - c011) * ux;
  let y0 = x00 + (x10 - x00) * uy;
  let y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

fn sampleField(f : FieldRecord, p : vec3<f32>, v : vec3<f32>, time : f32) -> vec3<f32> {
  let kind = u32(f.a.x);
  let shape = u32(f.a.w);
  var weight = 1.0;
  if (shape != 0u) {
    let q = p - f.d.xyz;
    var depth = 0.0;
    if (shape == 1u) {
      depth = f.d.w - length(q);
    } else {
      let dx = f.e.x - abs(q.x);
      let dy = f.e.y - abs(q.y);
      let dz = f.e.z - abs(q.z);
      depth = min(min(dx, dy), dz);
    }
    if (depth <= 0.0) {
      return vec3<f32>(0.0);
    }
    if (f.b.w > 0.0 && depth < f.b.w) {
      let t = depth / f.b.w;
      weight = t * t * (3.0 - 2.0 * t);
    }
  }
  var result = vec3<f32>(0.0);
  if (kind == 1u) {
    let r = p - f.b.xyz;
    let distance = length(r);
    if (distance != 0.0) {
      let clamped = select(distance, f.a.z, distance < f.a.z);
      result = r * (f.a.y / (clamped * clamped * distance));
    }
  } else if (kind == 2u) {
    result = f.b.xyz;
  } else if (kind == 3u) {
    result = -f.a.y * v;
  } else if (kind == 4u) {
    result = f.a.y * (f.b.xyz - v);
  } else if (kind == 5u) {
    let r = p - f.b.xyz;
    let axis = f.c.xyz;
    let t = vec3<f32>(
      axis.y * r.z - axis.z * r.y,
      axis.z * r.x - axis.x * r.z,
      axis.x * r.y - axis.y * r.x
    );
    let distance = length(t);
    if (distance != 0.0) {
      let clamped = select(distance, f.a.z, distance < f.a.z);
      result = t * (f.a.y / (clamped * distance));
    }
  } else if (kind == 6u) {
    let s = (p - f.b.xyz * time) * f.c.w;
    let h = 0.5;
    let sx = vec3<f32>(h, 0.0, 0.0);
    let sy = vec3<f32>(0.0, h, 0.0);
    let sz = vec3<f32>(0.0, 0.0, h);
    let dzy = valueNoise(s + sy, f.s.z) - valueNoise(s - sy, f.s.z);
    let dyz = valueNoise(s + sz, f.s.y) - valueNoise(s - sz, f.s.y);
    let dxz = valueNoise(s + sz, f.s.x) - valueNoise(s - sz, f.s.x);
    let dzx = valueNoise(s + sx, f.s.z) - valueNoise(s - sx, f.s.z);
    let dyx = valueNoise(s + sx, f.s.y) - valueNoise(s - sx, f.s.y);
    let dxy = valueNoise(s + sy, f.s.x) - valueNoise(s - sy, f.s.x);
    let scale = f.e.w / 4.0;
    result = vec3<f32>(scale * (dzy - dyz), scale * (dxz - dzx), scale * (dyx - dxy));
  }
  return result * weight;
}

@compute @workgroup_size(${String(PARTICLE_INTEGRATOR_WORKGROUP_SIZE)})
fn ${COMPUTE_ENTRY_POINT}(@builtin(global_invocation_id) id : vec3<u32>) {
  let index = id.x;
  if (f32(index) >= params.count) {
    return;
  }
  let base = index * 3u;
  if (positions[base] > 1.0e30) {
    return;
  }
  let dt = params.deltaSeconds;
  let p0 = vec3<f32>(positions[base], positions[base + 1u], positions[base + 2u]);
  let v0 = vec3<f32>(velocities[base], velocities[base + 1u], velocities[base + 2u]);
  var a = params.gravity.xyz;
  let fieldCount = u32(params.info.x);
  for (var i = 0u; i < fieldCount; i = i + 1u) {
    a = a + sampleField(params.fields[i], p0, v0, params.info.y);
  }
  var vx = v0.x + a.x * dt;
  var vy = v0.y + a.y * dt;
  var vz = v0.z + a.z * dt;
  var px = p0.x + vx * dt;
  var py = p0.y + vy * dt;
  var pz = p0.z + vz * dt;
  // collisions: "depth-buffer" without a bound scene depth — rest on
  // y = ground (mode 1). Mode 2 is resolved by the depth kernel afterwards.
  if (params.gravity.w > 0.5 && params.gravity.w < 1.5 && py < params.ground.w) {
    py = params.ground.w;
    vx = 0.0;
    vy = 0.0;
    vz = 0.0;
  }
  velocities[base] = vx;
  velocities[base + 1u] = vy;
  velocities[base + 2u] = vz;
  positions[base] = px;
  positions[base + 1u] = py;
  positions[base + 2u] = pz;
}
`;

/**
 * The §36 scene-depth collide-and-kill kernel (`collisions: "depth-buffer"`
 * on WebGPU): bindings 0-2 as the integrator's, binding 3 the scene's
 * `depth32float` texture (`texture_depth_2d`, `textureLoad`). Each live
 * particle is projected through `params.viewProjection`; one in front of the
 * view volume whose NDC depth exceeds the sampled scene depth plus
 * `params.info.z` is behind a surface and is killed — parked at a far
 * sentinel with zero velocity (the CPU still ages the slot out). Assumes the
 * WebGPU [0, 1] depth convention.
 */
export const PARTICLE_DEPTH_COLLIDE_SHADER_SOURCE = `struct ParticleSimulationParams {
  deltaSeconds : f32,
  count : f32,
  unusedA : f32,
  unusedB : f32,
  gravity : vec4<f32>,
  ground : vec4<f32>,
  info : vec4<f32>,
  viewProjection : mat4x4<f32>,
};

@group(0) @binding(0) var<storage, read> params : ParticleSimulationParams;
@group(0) @binding(1) var<storage, read_write> positions : array<f32>;
@group(0) @binding(2) var<storage, read_write> velocities : array<f32>;
@group(0) @binding(3) var sceneDepth : texture_depth_2d;

@compute @workgroup_size(${String(PARTICLE_INTEGRATOR_WORKGROUP_SIZE)})
fn ${COMPUTE_ENTRY_POINT}(@builtin(global_invocation_id) id : vec3<u32>) {
  let index = id.x;
  if (f32(index) >= params.count) {
    return;
  }
  let base = index * 3u;
  if (positions[base] > 1.0e30) {
    return;
  }
  let clip = params.viewProjection * vec4<f32>(positions[base], positions[base + 1u], positions[base + 2u], 1.0);
  if (clip.w <= 0.0) {
    return;
  }
  let ndc = clip.xyz / clip.w;
  if (abs(ndc.x) > 1.0 || abs(ndc.y) > 1.0 || ndc.z < 0.0 || ndc.z > 1.0) {
    return;
  }
  let dims = textureDimensions(sceneDepth);
  let tx = min(u32((ndc.x * 0.5 + 0.5) * f32(dims.x)), dims.x - 1u);
  let ty = min(u32((0.5 - ndc.y * 0.5) * f32(dims.y)), dims.y - 1u);
  let surface = textureLoad(sceneDepth, vec2<u32>(tx, ty), 0);
  if (ndc.z > surface + params.info.z) {
    positions[base] = 1.0e37;
    positions[base + 1u] = 1.0e37;
    positions[base + 2u] = 1.0e37;
    velocities[base] = 0.0;
    velocities[base + 1u] = 0.0;
    velocities[base + 2u] = 0.0;
  }
}
`;
