/**
 * The WebGPU surface this backend touches, described structurally (§61, §62).
 *
 * This is the twin of `@fourjs/render-webgl`'s `WebglContext`, and it exists for
 * the same two reasons, both of which matter more here than they did there:
 *
 * 1. **The package compiles without `lib.dom` and without `@webgpu/types`.**
 *    `@fourjs/render` types `RendererOptions.canvas` as `unknown` precisely so a
 *    backend narrows it where it can validate it, and the §3.2 pin set carries
 *    no WebGPU typings — adding one would be a new toolchain dependency for
 *    declarations the engine can write itself in a page (ground rule 7).
 * 2. **A structural interface is what makes a *complete* double possible.**
 *    Node has no `navigator.gpu` at all, so every Vitest-tier test in this
 *    package runs against a fake device that records what it was asked to do
 *    (`tests/integration/helpers/recording-gpu.ts`, the twin of that directory's
 *    `recording-gl.ts`).
 *    A transcript assertion is only as honest as the interface it is written
 *    against: an interface naming exactly the entry points the backend calls
 *    makes "the frame issued these commands, in this order" checkable with no
 *    GPU and no browser.
 *
 * ## What is deliberately *not* modelled
 *
 * Everything this backend does not call: external textures. Each joins the
 * interface with the packet that calls it, so the double never has to fake a
 * member no code path reaches — the property that keeps it a double rather
 * than a reimplementation. `mapAsync` and `copyTextureToBuffer` joined with
 * WP-R1.6's readback, §82's compute members (`createComputePipeline`,
 * `beginComputePass`, `copyBufferToBuffer`) with WP-R1.8, and query sets
 * (`createQuerySet`, `resolveQuerySet`) with A-1's GPU-frame timer, all as
 * **optional** members: presence is the capability (R-30b's rule), so every
 * double written before them still satisfies the surface — and WebGL 2,
 * which has no compute at all, keeps an honest structural mirror of that
 * absence.
 *
 * ## Names
 *
 * The interfaces are named `Gpu*` rather than `GPU*` so that nothing here
 * shadows or is mistaken for the real global types in an editor that has
 * `lib.dom` loaded. They are structurally satisfied by the real ones.
 */

/**
 * Bit flags for `GpuBufferDescriptor.usage`, from the WebGPU specification's
 * `GPUBufferUsage` namespace.
 *
 * Written out rather than read off a global for the reason `GL` in the WebGL
 * backend is written out: the values are normative constants of a published
 * specification, and reading them from `globalThis.GPUBufferUsage` would make
 * the backend un-testable in Node — where that global does not exist — for no
 * gain at all.
 */
export const GPU_BUFFER_USAGE = Object.freeze({
  /** Buffer may be mapped for reading (`mapAsync`) — WP-R1.6's readback. */
  MAP_READ: 0x0001,
  /** Buffer may be the destination of a query-set resolve (A-1). */
  QUERY_RESOLVE: 0x0200,
  /** Buffer may be the source of a copy. */
  COPY_SRC: 0x0004,
  /** Buffer may be the destination of a copy, including `queue.writeBuffer`. */
  COPY_DST: 0x0008,
  /** Buffer may be bound as an index buffer. */
  INDEX: 0x0010,
  /** Buffer may be bound as a vertex buffer. */
  VERTEX: 0x0020,
  /** Buffer may be bound as a uniform buffer. */
  UNIFORM: 0x0040,
  /** Buffer may be bound as a storage buffer (§82, WP-R1.8). */
  STORAGE: 0x0080,
});

/**
 * Bit flags for `GpuBuffer.mapAsync`'s mode (`GPUMapMode`) — WP-R1.6's
 * readback. Written out for {@link GPU_BUFFER_USAGE}'s reason: `GPUMapMode`
 * does not exist in Node, and the value is a normative constant.
 */
export const GPU_MAP_MODE = Object.freeze({
  /** Map for reading — the only mode `readPixels` needs. */
  READ: 0x0001,
});

/** Bit flags for `GpuTextureDescriptor.usage` (`GPUTextureUsage`). */
export const GPU_TEXTURE_USAGE = Object.freeze({
  /** Texture may be the source of a copy. */
  COPY_SRC: 0x01,
  /** Texture may be the destination of a copy. */
  COPY_DST: 0x02,
  /** Texture may be sampled by a shader. */
  TEXTURE_BINDING: 0x04,
  /** Texture may be a colour or depth attachment of a render pass. */
  RENDER_ATTACHMENT: 0x10,
});

/** Bit flags for a bind-group-layout entry's `visibility` (`GPUShaderStage`). */
export const GPU_SHADER_STAGE = Object.freeze({
  /** Vertex stage. */
  VERTEX: 0x1,
  /** Fragment stage. */
  FRAGMENT: 0x2,
  /** Compute stage (§82, WP-R1.8). */
  COMPUTE: 0x4,
});

/**
 * The alignment a dynamic uniform-buffer offset must satisfy.
 *
 * 256 bytes is the WebGPU default `minUniformBufferOffsetAlignment`, and it is
 * also the specification's *maximum* permitted value for that limit — so a
 * fixed 256 is valid on every conforming device, while reading the limit and
 * using a smaller stride would only ever save memory on devices that permit it.
 * A fixed stride keeps the per-frame uniform packing arithmetic a constant
 * (§33: the frame's byte layout must not vary with the device), which is worth
 * more here than the bytes are (decision, WP-R1.1).
 */
export const UNIFORM_STRIDE_BYTES = 256;

/** Why a device was lost, as `GpuDevice.lost` resolves it. */
export interface GpuDeviceLostInfo {
  /** `"destroyed"` when the application called `destroy()`, else `"unknown"`. */
  readonly reason?: string;
  /** Human-readable detail from the implementation. */
  readonly message?: string;
}

/**
 * An opaque GPU query-set handle (A-1 timestamp queries).
 *
 * Optional on {@link GpuDevice.createQuerySet} — presence is the capability
 * (R-30b). A double written before this packet still satisfies `GpuDevice`.
 */
export interface GpuQuerySet {
  /** Releases the allocation (§83). */
  destroy(): void;
}

/**
 * An opaque GPU buffer handle.
 *
 * The three mapping members are **optional, and presence is the capability** —
 * R-30b's optional-context-member rule, applied here so every double built
 * before WP-R1.6's readback still satisfies the type. Only a buffer created
 * with `MAP_READ` usage may be mapped, and only `readPixels` creates one;
 * `WebgpuRenderer.readPixels` rejects with `UNSUPPORTED_GPU_FEATURE` on a
 * device whose buffers cannot map, rather than crashing into an absent member.
 */
export interface GpuBuffer {
  /** Releases the allocation (§83). */
  destroy(): void;
  /**
   * Resolves when the buffer's contents are mapped into CPU memory —
   * WP-R1.6's readback path. `mode` is a {@link GPU_MAP_MODE} bit.
   */
  mapAsync?(mode: number): Promise<void>;
  /** The mapped bytes. Valid only between `mapAsync` resolving and `unmap`. */
  getMappedRange?(): ArrayBuffer;
  /** Returns the mapped range to the GPU; the `ArrayBuffer` is detached. */
  unmap?(): void;
}

/** An opaque texture view — what a render pass attaches, and what a shader samples. */
export type GpuTextureView = object;

/**
 * Which levels of a texture a view exposes (`GPUTextureViewDescriptor`).
 *
 * Every member is optional and the whole descriptor is optional, so
 * `createView()` still means "the whole texture" — which is the only form
 * WP-R1.1 needed and the form the swap chain and the depth attachment still
 * use. The two members are here because mip generation cannot be expressed
 * without them: a blit reads level *n* and writes level *n + 1*, and a WebGPU
 * pass attaches a **view**, not a texture, so "write level 3" is spelled as a
 * one-level view based at 3 (§77, WP-R1.2).
 */
export interface GpuTextureViewDescriptor {
  /** Diagnostic name. */
  readonly label?: string;
  /** First mip level the view exposes; `0` — the whole texture — by default. */
  readonly baseMipLevel?: number;
  /** How many levels from `baseMipLevel`; all of them by default. */
  readonly mipLevelCount?: number;
  /** View dimension (`"cube"`, `"2d-array"`, `"3d"`, `"2d"`); the texture's own by default (§77, R-30c). */
  readonly dimension?: string;
  /** First array layer / cube face the view exposes. */
  readonly baseArrayLayer?: number;
  /** How many layers from `baseArrayLayer`. */
  readonly arrayLayerCount?: number;
}

/** An opaque GPU texture handle. */
export interface GpuTexture {
  /** A view of the whole texture, or of the mip range `descriptor` names. */
  createView(descriptor?: GpuTextureViewDescriptor): GpuTextureView;
  /** Releases the allocation (§83). Absent on a swap-chain texture. */
  destroy?(): void;
}

/**
 * An opaque sampler — filter and wrap state as an **object** (§77).
 *
 * The one structural difference between this backend's texture tier and the
 * WebGL one, and the reason `wgpu-texture.ts` has a second cache in it: GL
 * writes filter and wrap onto the texture with `texParameteri`, so R-30's
 * sampler state is per-texture and costs nothing to vary. WebGPU makes it a
 * separate, immutable object bound alongside the texture, so a thousand
 * textures sharing one filter/wrap pair should share **one** sampler rather
 * than allocate a thousand identical ones.
 */
export type GpuSampler = object;

/** A compiled WGSL module. */
export type GpuShaderModule = object;

/** A bind-group layout — the *declared* shape of a shader's bindings (§7's RFC-0001 debt). */
export type GpuBindGroupLayout = object;

/** A pipeline layout: the ordered bind-group layouts a pipeline expects. */
export type GpuPipelineLayout = object;

/** A bound set of resources. */
export type GpuBindGroup = object;

/** An immutable, fully specified render pipeline (§4.2 of the R-1 plan). */
export type GpuRenderPipeline = object;

/** An immutable compute pipeline (§82, WP-R1.8). */
export type GpuComputePipeline = object;

/** A compute pipeline descriptor, reduced to the members this backend sets. */
export interface GpuComputePipelineDescriptor {
  /** Diagnostic name. */
  readonly label?: string;
  /** Explicit layout — never `"auto"`, `wgpu-bindings.ts`'s standing rule. */
  readonly layout: GpuPipelineLayout;
  /** The kernel: module and entry point. */
  readonly compute: {
    readonly module: GpuShaderModule;
    readonly entryPoint: string;
  };
}

/**
 * The commands a compute pass records (§82, WP-R1.8) — no viewport, no
 * scissor, no vertex state: a dispatch is a grid, not a rasterisation.
 */
export interface GpuComputePassEncoder {
  /** Selects the pipeline subsequent dispatches use. */
  setPipeline(pipeline: GpuComputePipeline): void;
  /** Binds a bind group of storage buffers. */
  setBindGroup(index: number, bindGroup: GpuBindGroup): void;
  /** Dispatches a workgroup grid. A zero count is a defined no-op. */
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
  /** Closes the pass. Every `beginComputePass` owes exactly one of these. */
  end(): void;
}

/** A recorded, submittable command buffer. */
export type GpuCommandBuffer = object;

/** One buffer's vertex layout inside a pipeline descriptor. */
export interface GpuVertexBufferLayout {
  /** Distance between consecutive elements, in bytes. */
  readonly arrayStride: number;
  /** `"vertex"`, or `"instance"` for §36's particle stream (WP-R1.8). */
  readonly stepMode?: "vertex" | "instance";
  /** The attributes read out of this buffer. */
  readonly attributes: readonly {
    readonly format: string;
    readonly offset: number;
    readonly shaderLocation: number;
  }[];
}

/** One colour attachment's blend state. */
export interface GpuBlendState {
  /** Colour-channel blend factors and operation. */
  readonly color: GpuBlendComponent;
  /** Alpha-channel blend factors and operation. */
  readonly alpha: GpuBlendComponent;
}

/** One channel group's blend factors and operation. */
export interface GpuBlendComponent {
  /** Multiplier applied to the fragment's output. */
  readonly srcFactor: string;
  /** Multiplier applied to the attachment's existing value. */
  readonly dstFactor: string;
  /** How the two are combined; `"add"` throughout this tier. */
  readonly operation: string;
}

/** A render pipeline descriptor, reduced to the members this backend sets. */
export interface GpuRenderPipelineDescriptor {
  /** Diagnostic name, echoed by implementations in validation errors. */
  readonly label?: string;
  /** Explicit layout — never `"auto"`; see `wgpu-bindings.ts`. */
  readonly layout: GpuPipelineLayout;
  /** Vertex stage: module, entry point and buffer layouts. */
  readonly vertex: {
    readonly module: GpuShaderModule;
    readonly entryPoint: string;
    readonly buffers: readonly GpuVertexBufferLayout[];
  };
  /** Fragment stage and its colour targets. */
  readonly fragment: {
    readonly module: GpuShaderModule;
    readonly entryPoint: string;
    readonly targets: readonly {
      readonly format: string;
      readonly blend?: GpuBlendState;
      readonly writeMask: number;
    }[];
  };
  /** Topology and winding. */
  readonly primitive: {
    readonly topology: string;
    readonly frontFace?: string;
    readonly cullMode?: string;
  };
  /** Depth-stencil state, absent for a pass with no depth attachment. */
  readonly depthStencil?: {
    readonly format: string;
    readonly depthWriteEnabled: boolean;
    readonly depthCompare: string;
    /**
     * §67's stencil test and operations (WP-R1.3), present only on a pipeline
     * that actually tests or writes stencil bits — a clipless pipeline's
     * descriptor omits all four members, which is what keeps its recorded
     * `createRenderPipeline` line byte-identical to WP-R1.1's.
     *
     * Front and back are always the same state in this backend: GL's
     * `stencilFunc`/`stencilOp` are two-sided, and culling is disabled on both
     * backends, so a per-face split would be a distinction nothing draws.
     */
    readonly stencilFront?: GpuStencilFaceState;
    readonly stencilBack?: GpuStencilFaceState;
    /** The bits the test looks at (§57's `readMask`). */
    readonly stencilReadMask?: number;
    /** The bits a write may change (§57's `writeMask`). */
    readonly stencilWriteMask?: number;
  };
}

/** One face's stencil comparison and operations (`GPUStencilFaceState`). */
export interface GpuStencilFaceState {
  /** The comparison, against the pass's stencil reference. */
  readonly compare: string;
  /** Stored on stencil-test failure. */
  readonly failOp: string;
  /** Stored when the stencil test passes and the depth test fails. */
  readonly depthFailOp: string;
  /** Stored when both tests pass. */
  readonly passOp: string;
}

/** A render pass descriptor, reduced to what this packet attaches. */
export interface GpuRenderPassDescriptor {
  /** Diagnostic name. */
  readonly label?: string;
  /** Colour attachments — exactly one in this tier. */
  readonly colorAttachments: readonly {
    readonly view: GpuTextureView;
    readonly loadOp: "load" | "clear";
    readonly storeOp: "store" | "discard";
    readonly clearValue?: readonly [number, number, number, number];
  }[];
  /** The depth attachment, when the surface has one. */
  readonly depthStencilAttachment?: {
    readonly view: GpuTextureView;
    readonly depthLoadOp: "load" | "clear";
    readonly depthStoreOp: "store" | "discard";
    readonly depthClearValue?: number;
    /**
     * Stencil-aspect ops (§67, WP-R1.3) — **required by validation when the
     * attachment's format carries a stencil aspect, and forbidden when it does
     * not**, which is why they are optional here and written only on a frame
     * whose depth attachment is `depth24plus-stencil8`. Always `"load"`: §61
     * confines clears to the viewport rectangle, so the stencil clear is a
     * scissored draw per view, exactly as the colour and depth clears are.
     */
    readonly stencilLoadOp?: "load" | "clear";
    readonly stencilStoreOp?: "store" | "discard";
  };
  /**
   * Timestamp writes for this pass (A-1). Optional, and omitted on every
   * frame that has not armed GPU timing, so a tape that never reads
   * `lastGpuFrameTimeSeconds` stays the object it always was.
   */
  readonly timestampWrites?: {
    readonly querySet: GpuQuerySet;
    readonly beginningOfPassWriteIndex?: number;
    readonly endingOfPassWriteIndex?: number;
  };
}

/** The commands a render pass records. */
export interface GpuRenderPassEncoder {
  /** Selects the pipeline subsequent draws use. */
  setPipeline(pipeline: GpuRenderPipeline): void;
  /** Binds a bind group, optionally at dynamic offsets. */
  setBindGroup(
    index: number,
    bindGroup: GpuBindGroup,
    dynamicOffsets?: readonly number[],
  ): void;
  /** Binds a vertex buffer into a slot of the pipeline's vertex layout. */
  setVertexBuffer(
    slot: number,
    buffer: GpuBuffer | null,
    offset?: number,
  ): void;
  /** Binds the index buffer. */
  setIndexBuffer(
    buffer: GpuBuffer,
    indexFormat: "uint16" | "uint32",
    offset?: number,
  ): void;
  /**
   * Sets the draw rectangle, in **framebuffer** pixels with a top-left origin
   * (see `webgpu-renderer.ts` for the flip out of §48's bottom-left rectangle).
   */
  setViewport(
    x: number,
    y: number,
    width: number,
    height: number,
    minDepth: number,
    maxDepth: number,
  ): void;
  /** Confines writes — including this backend's clear draws — to a rectangle. */
  setScissorRect(x: number, y: number, width: number, height: number): void;
  /**
   * Sets the stencil reference the pipeline's `compare` and `"replace"` op
   * read (§67, WP-R1.3). Pass state, initially `0` — the renderer mirrors it
   * per frame and issues this only when a stencil-carrying draw needs a
   * different value, so a clipless frame records none at all.
   */
  setStencilReference(reference: number): void;
  /** Non-indexed draw. */
  draw(
    vertexCount: number,
    instanceCount?: number,
    firstVertex?: number,
    firstInstance?: number,
  ): void;
  /** Indexed draw. */
  drawIndexed(
    indexCount: number,
    instanceCount?: number,
    firstIndex?: number,
    baseVertex?: number,
    firstInstance?: number,
  ): void;
  /** Closes the pass. Every `beginRenderPass` owes exactly one of these. */
  end(): void;
}

/** Records passes into a command buffer. */
export interface GpuCommandEncoder {
  /** Opens a render pass. */
  beginRenderPass(descriptor: GpuRenderPassDescriptor): GpuRenderPassEncoder;
  /**
   * Opens a compute pass (§82, WP-R1.8). Optional for
   * {@link GpuBuffer.mapAsync}'s reason: presence is the capability, and only
   * the compute path calls it — the frame path never does (§82's "basic
   * graphics … must not require compute support", held structurally).
   */
  beginComputePass?(descriptor?: {
    readonly label?: string;
  }): GpuComputePassEncoder;
  /**
   * Copies a buffer range into another buffer — compute readback's mechanism
   * (`wgpu-compute.ts`), the buffer-to-buffer half of WP-R1.6's
   * `copyTextureToBuffer`, optional on the same presence-is-the-capability
   * terms.
   */
  copyBufferToBuffer?(
    source: GpuBuffer,
    sourceOffset: number,
    destination: GpuBuffer,
    destinationOffset: number,
    size: number,
  ): void;
  /**
   * Copies a texture's texels into a buffer — `readPixels`' mechanism
   * (WP-R1.6, RFC 0005). Optional for {@link GpuBuffer.mapAsync}'s reason:
   * presence is the capability, and only the readback path calls it.
   * `bytesPerRow` must be a multiple of 256 (the WebGPU constant
   * `COPY_BYTES_PER_ROW_ALIGNMENT`); `wgpu-readback.ts` owns that arithmetic.
   */
  copyTextureToBuffer?(
    source: {
      readonly texture: GpuTexture;
      readonly mipLevel?: number;
      /**
       * Top-left corner of the copied rectangle in the texture's own
       * top-first coordinates, `[x, y]` — §61's region form (2026-08-29).
       * Omitted for a whole-texture copy, and *only* then, so the
       * whole-target tape WP-R1.6 recorded stays byte-identical.
       * `wgpu-readback.ts` owns the §7a bottom-origin conversion.
       */
      readonly origin?: readonly [number, number];
    },
    destination: {
      readonly buffer: GpuBuffer;
      readonly bytesPerRow: number;
      readonly rowsPerImage?: number;
    },
    size: readonly [number, number],
  ): void;
  /**
   * Copies query results into `destination` (A-1). Optional — presence is
   * the capability, and only the GPU-frame timer calls it.
   */
  resolveQuerySet?(
    querySet: GpuQuerySet,
    firstQuery: number,
    queryCount: number,
    destination: GpuBuffer,
    destinationOffset: number,
  ): void;
  /** Closes the encoder and yields the buffer to submit. */
  finish(): GpuCommandBuffer;
}

/** The device's submission queue. */
export interface GpuQueue {
  /** Resolves after work submitted before this call completes on the GPU. */
  onSubmittedWorkDone?(): Promise<void>;
  /** Uploads CPU bytes into a buffer allocation. */
  writeBuffer(
    buffer: GpuBuffer,
    bufferOffset: number,
    data: ArrayBufferView,
    dataOffset?: number,
    size?: number,
  ): void;
  /**
   * Uploads CPU bytes into a texture's mip level.
   *
   * The WebGPU counterpart of `texImage2D`, and note what it is *not*: there is
   * no bound texture and no unit, so an upload triggered mid-frame cannot
   * disturb anything the frame has already bound — the `gl.bindTexture(…, null)`
   * the WebGL cache issues after every upload has no counterpart here because
   * it has nothing to undo.
   */
  writeTexture(
    destination: {
      readonly texture: GpuTexture;
      readonly mipLevel?: number;
      readonly origin?: readonly [number, number, number];
    },
    data: ArrayBufferView,
    dataLayout: {
      readonly offset?: number;
      readonly bytesPerRow: number;
      readonly rowsPerImage?: number;
    },
    size: readonly [number, number] | readonly [number, number, number],
  ): void;
  /** Submits recorded command buffers, in order. */
  submit(commandBuffers: readonly GpuCommandBuffer[]): void;
}

/** A sampler allocation request (`GPUSamplerDescriptor`) — see {@link GpuSampler}. */
export interface GpuSamplerDescriptor {
  /** Diagnostic name. */
  readonly label?: string;
  /** §77's wrap mode on the U axis. */
  readonly addressModeU: string;
  /** §77's wrap mode on the V axis; one field feeds both (§77's single `wrap`). */
  readonly addressModeV: string;
  /** §77's magnification filter. */
  readonly magFilter: string;
  /** The in-level half of §77's `minFilter`. */
  readonly minFilter: string;
  /** The between-levels half of §77's `minFilter`. */
  readonly mipmapFilter: string;
  /** §77's anisotropy, present only above 1 — see `wgpu-texture.ts`. */
  readonly maxAnisotropy?: number;
  /**
   * The comparison a `sampler_comparison` evaluates per tap (§69, WP-R1.7) —
   * present exactly on the shadow sampler (`wgpu-shadow.ts`), absent on every
   * ordinary sampler, mirroring the WebGPU descriptor: presence is what makes
   * the object a comparison sampler.
   */
  readonly compare?: string;
}

/** A buffer allocation request. */
export interface GpuBufferDescriptor {
  /** Diagnostic name. */
  readonly label?: string;
  /** Allocation size in bytes; must be a multiple of 4 for `writeBuffer`. */
  readonly size: number;
  /** Bit set from {@link GPU_BUFFER_USAGE}. */
  readonly usage: number;
}

/** A texture allocation request — the depth attachment and §77's uploads. */
export interface GpuTextureDescriptor {
  /** Diagnostic name. */
  readonly label?: string;
  /**
   * Extent, as WebGPU's array form; the third entry is array layers (cube:
   * 6) for a `"2d"` allocation and depth for a `"3d"` one (§77, R-30c).
   */
  readonly size: readonly [number, number] | readonly [number, number, number];
  /** Allocation dimension; `"2d"` when omitted. */
  readonly dimension?: "2d" | "3d";
  /** Texel format. */
  readonly format: string;
  /** Bit set from {@link GPU_TEXTURE_USAGE}. */
  readonly usage: number;
  /**
   * How many mip levels to allocate; `1` — a single level — when omitted.
   *
   * Omitted rather than passed as `1` for the whole tier that does not mipmap,
   * so the depth attachment's descriptor is the object it always was.
   */
  readonly mipLevelCount?: number;
}

/** One entry of a bind-group layout — see `wgpu-bindings.ts`. */
export interface GpuBindGroupLayoutEntry {
  /** Binding number, matching the shader's `@binding`. */
  readonly binding: number;
  /** Bit set from {@link GPU_SHADER_STAGE}. */
  readonly visibility: number;
  /** Buffer binding shape — group 0's uniform block. */
  readonly buffer?: {
    readonly type: "uniform" | "storage" | "read-only-storage";
    readonly hasDynamicOffset?: boolean;
    readonly minBindingSize?: number;
  };
  /** Sampled-texture binding shape — group 1's `map` (§77). */
  readonly texture?: {
    readonly sampleType: string;
    readonly viewDimension: string;
  };
  /** Sampler binding shape — group 1's `mapSampler` (§77). */
  readonly sampler?: {
    readonly type: string;
  };
}

/** A bound buffer range — group 0's dynamically-offset uniform block. */
export interface GpuBufferBinding {
  /** The buffer the range lives in. */
  readonly buffer: GpuBuffer;
  /** Byte offset of the range; `0` when omitted. */
  readonly offset?: number;
  /** Byte length of the range; the rest of the buffer when omitted. */
  readonly size?: number;
}

/** A bound resource: a buffer range, a texture view, or a sampler. */
export interface GpuBindGroupEntry {
  /** Binding number, matching the layout's. */
  readonly binding: number;
  /**
   * The bound resource: a buffer range, a texture view, or a sampler.
   *
   * Typed as two constituents though the prose names three, because
   * {@link GpuTextureView} and {@link GpuSampler} are both opaque `object`
   * aliases on this surface — naming both would duplicate one union
   * constituent — and it is the matching *layout entry*, never the handle's
   * shape, that tells WebGPU which kind it received.
   */
  readonly resource: GpuBufferBinding | GpuTextureView;
}

/** The device: everything the backend allocates and submits through. */
export interface GpuDevice {
  /** The submission queue. */
  readonly queue: GpuQueue;
  /**
   * The device's limits, by their WebGPU names. Optional because a double need
   * not carry them — an absent limit is reported as "not reported" rather than
   * guessed (`renderer.ts`'s tri-state).
   */
  readonly limits?: Readonly<Record<string, number>>;
  /** The device's optional features; `has` is the §62 query. */
  readonly features?: { has(name: string): boolean };
  /**
   * Resolves when the device is lost (§61's first-class loss event). Optional
   * so that a double may omit it; the renderer subscribes only when present.
   */
  readonly lost?: Promise<GpuDeviceLostInfo>;
  /** Allocates a buffer. */
  createBuffer(descriptor: GpuBufferDescriptor): GpuBuffer;
  /** Allocates a texture. */
  createTexture(descriptor: GpuTextureDescriptor): GpuTexture;
  /** Creates a sampler — §77's filter and wrap state as an object. */
  createSampler(descriptor: GpuSamplerDescriptor): GpuSampler;
  /** Compiles a WGSL module. */
  createShaderModule(descriptor: {
    readonly label?: string;
    readonly code: string;
  }): GpuShaderModule;
  /** Declares a bind-group layout (§7's "layouts as data"). */
  createBindGroupLayout(descriptor: {
    readonly label?: string;
    readonly entries: readonly GpuBindGroupLayoutEntry[];
  }): GpuBindGroupLayout;
  /** Composes bind-group layouts into a pipeline layout. */
  createPipelineLayout(descriptor: {
    readonly label?: string;
    readonly bindGroupLayouts: readonly GpuBindGroupLayout[];
  }): GpuPipelineLayout;
  /** Binds resources against a layout. */
  createBindGroup(descriptor: {
    readonly label?: string;
    readonly layout: GpuBindGroupLayout;
    readonly entries: readonly GpuBindGroupEntry[];
  }): GpuBindGroup;
  /** Creates an immutable render pipeline (lazily — see `wgpu-pipeline-cache.ts`). */
  createRenderPipeline(
    descriptor: GpuRenderPipelineDescriptor,
  ): GpuRenderPipeline;
  /**
   * Creates an immutable compute pipeline (§82, WP-R1.8). Optional —
   * presence is the capability, and it is the one member `compute()` gates
   * on before recording anything (`wgpu-compute.ts`).
   */
  createComputePipeline?(
    descriptor: GpuComputePipelineDescriptor,
  ): GpuComputePipeline;
  /** Opens a command encoder. */
  createCommandEncoder(descriptor?: {
    readonly label?: string;
  }): GpuCommandEncoder;
  /**
   * Allocates a query set (A-1). Optional — presence is the capability,
   * and only the GPU-frame timer calls it. A double written before this
   * packet still satisfies the device.
   */
  createQuerySet?(descriptor: {
    readonly type: "occlusion" | "timestamp";
    readonly count: number;
  }): GpuQuerySet;
  /** Releases the device (§83). */
  destroy(): void;
}

/** The adapter a device is requested from. */
export interface GpuAdapter {
  /** Optional vendor/architecture strings, where the implementation exposes them. */
  readonly info?: Readonly<Record<string, unknown>>;
  /** The adapter's optional features. */
  readonly features?: { has(name: string): boolean };
  /** Requests a device; resolves `null` — or rejects — when none can be had. */
  requestDevice(descriptor?: {
    readonly label?: string;
    /** Features this device must support — `timestamp-query` for A-1. */
    readonly requiredFeatures?: readonly string[];
  }): Promise<GpuDevice | null>;
}

/** `navigator.gpu`, reduced to what this backend calls. */
export interface Gpu {
  /** Requests an adapter; resolves `null` where WebGPU is present but unusable. */
  requestAdapter(options?: {
    readonly powerPreference?: string;
  }): Promise<GpuAdapter | null>;
  /**
   * The format the host prefers for a canvas swap chain — commonly
   * `"bgra8unorm"`, **not** `"rgba8unorm"` (§60a; see `webgpu-renderer.ts` on
   * why that never widens `RenderTargetFormat`). Optional: a double may omit
   * it, and the backend falls back to `"bgra8unorm"`.
   */
  getPreferredCanvasFormat?(): string;
}

/** The canvas's `"webgpu"` context. */
export interface GpuCanvasContext {
  /** Configures the swap chain. Must precede the first `getCurrentTexture`. */
  configure(configuration: {
    readonly device: GpuDevice;
    readonly format: string;
    readonly alphaMode?: string;
  }): void;
  /** Releases the swap chain (§83). */
  unconfigure?(): void;
  /** The texture for this frame. A fresh one per frame, cleared to zero. */
  getCurrentTexture(): GpuTexture;
}

/**
 * The drawing surface, described by what this backend touches — the twin of
 * `WebglCanvas`, and narrowed at runtime by `WebgpuRenderer.initialize` for the
 * same reason (`RendererOptions.canvas` is `unknown` by design).
 *
 * There is no `addEventListener` here, and its absence is the interesting half:
 * WebGL 2 signals loss through two canvas events, while WebGPU signals it
 * through `GpuDevice.lost`, a promise on the *device*. The surface therefore
 * needs no event target at all, which is why an `OffscreenCanvas` satisfies
 * this interface with nothing added.
 */
export interface WebgpuCanvas {
  /** Swap-chain width in device pixels. Written by `resize`. */
  width: number;
  /** Swap-chain height in device pixels. Written by `resize`. */
  height: number;
  /**
   * Acquires the `"webgpu"` context. Typed to return `unknown` because this
   * package does not name `GPUCanvasContext`; the result is validated
   * structurally before use.
   */
  getContext(contextId: "webgpu"): unknown;
}
