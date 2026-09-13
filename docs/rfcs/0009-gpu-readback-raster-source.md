# RFC 0009: GPU readback as a raster source (§77a residue)

- **Status:** accepted 2026-09-11 — implementation requested by the owner; recommendations adopted.
- **Date:** 2026-09-06
- **Owner decision:** 2026-09-11: implement all RFCs and remaining TODO items.
- **Spec sections affected:** §77a (primary), §33, §34, §61, §62, §63, §77, §83, §85, §89, §90, §96

## Context

RFC 0004 §6 deferred **GPU readback as a raster source** on purpose:

> Waits on A-11's pixel-picking question, which the gap analysis already says
> "wants an RFC, not a packet"; it is a different determinism argument and
> must not ride in on this one.

A-11 closed and RFC 0005 was implemented (2026-08-29; its one open
residue, the WebGPU skinned id pass, does not touch readback). `Renderer.readPixels`
exists on both shipped GPU backends: asynchronous, tightly packed RGBA8,
rows bottom-to-top, `region` in target texels from the bottom-left.
`RasterSource.readPixels` is the opposite shape: **synchronous**,
application-owned `out`, called from `CanvasTexture.update()`.

No RFC in `docs/rfcs/` covers joining the two. Particle GPU _snapshots_
(`packages/particles/src/types.ts`) name "the GPU-readback RFC the R-1
plan names" as a **simulation-state** question; that is not this RFC.
This document is only: may a render target's colour attachment be a
§77a `RasterSource`?

The temptation is a live source:

```ts
const source: RasterSource = {
  width: target.width,
  height: target.height,
  readPixels: (out) => {
    /* renderer.readPixels(target) — but that is a Promise */
  },
};
```

That does not type-check, and making it work by blocking on `mapAsync`
or GL `readPixels` inside `update()` would put a GPU stall on a path
RFC 0004 promised was "version, not events" and "never from a fixed
step." WebGPU has no synchronous readback at all (RFC 0005's permanent
`Promise`).

The determinism argument is also different from host 2D paint. Host
paint is unreproducible because of fonts, hinting, and GPU-backed
canvases. GPU readback is unreproducible because of the same shading
float behaviour §33 already places outside the envelope — **and**
because it can close a **feedback loop** (render target →
`CanvasTexture` → material on a drawable in that target). R-4 already
refuses those loops for `RenderTarget.colorTexture`. A CPU copy does
not make the loop safe; it only makes it a frame late.

## Proposed decision

### 1. Snapshot source, not a live GPU surface

Add `GpuReadbackSource` in `@fourjs/render` (beside `raster.ts`). It
**implements `RasterSource`**. It does not widen `RasterSource`, does
not make `readPixels` async, and leaves `CanvasTexture`'s contract intact
(§3 adds one readonly accessor, `readbackTarget`, for the feedback check;
no behaviour of `update` / `invalidate` / `dispose` changes).

```ts
export interface GpuReadbackSourceOptions {
  /** Target texels from the bottom-left (§7a); whole target if omitted. */
  readonly region?: Rectangle2;
  /** Defaults to `"srgb"` (RFC 0004 Q3); never inferred from the target. */
  readonly colorSpace?: ColorSpace;
  /**
   * Snapshot byte ceiling; defaults to `CanvasTexture`'s 64 MiB constant.
   * Checked once, at construction, because the size is fixed for life.
   */
  readonly maximumBytes?: number;
}

export class GpuReadbackSource implements RasterSource, Disposable {
  constructor(target: RenderTarget, options?: GpuReadbackSourceOptions);

  /** The target sampled by `refresh`; what the feedback check reads (§3). */
  readonly target: RenderTarget;
  readonly width: number;
  readonly height: number;
  readonly origin: "bottom-left"; // matches Renderer.readPixels
  readonly colorSpace: ColorSpace;
  // No `paint` hook: `RasterSource.paint` is synchronous and the GPU read
  // is not, so the read is the explicit `refresh` below.

  /**
   * Pull `renderer.readPixels(target, region)` into the CPU snapshot.
   * Between frames only; never from a fixed step; never from inside a
   * `Renderer.render(...)` / `RenderGraph.execute(...)` call (the
   * `Renderer` interface has no begin/end-frame pair; `render` is the
   * frame).
   */
  refresh(renderer: Renderer): Promise<boolean>;

  /** Sync. Copies the last snapshot into `out`, or zeros if none. */
  readPixels(out: Uint8Array): void;

  dispose(): void;
}
```

`refresh` returns `true` when a new snapshot was stored (and the
paired `CanvasTexture` should `invalidate()`). It returns `false` when
the renderer has no `readPixels` (capability-by-omission, RFC 0005) or
the source is disposed. A lost device / disposed target **rejects**
with the same `FourError` codes `Renderer.readPixels` already uses
(`DEVICE_LOST` / `CONTEXT_LOST`, `INVALID_APPLICATION_STATE`,
`UNSUPPORTED_GPU_FEATURE`).

`readPixels` never calls the GPU. A `CanvasTexture.update()` on a
stale-but-unrefreshed source re-uploads the last snapshot. That is
the honest model: the GPU is sampled when the application says so,
not when a material happens to bind the texture.

### 2. Display-only, same mechanical rule as paint

GPU-readback pixels are **display content**, never simulation input.
The sentence is RFC 0004 §3 with the producer renamed:

> Nothing inside §33's envelope may read them. No value derived from a
> `GpuReadbackSource` or from a `CanvasTexture` fed by one may reach a
> fixed step, a §33 checksum, a §34 snapshot, or a replay document.

`tests/integration/raster-display-only.test.ts` already forbids every
package outside `render`, `render-webgl`, and the umbrella from naming the
raster module. Its scan is a fixed `FORBIDDEN` list of a module path and
four identifiers, so a new class is **not** covered until it is listed:
the packet adds `GpuReadbackSource`, `GpuReadbackSourceOptions`, and the
new module's path (`/gpu-readback.js`) to that list. No new test file;
the allowlist of packages does not change.

`refresh` / `update` stay on §9 render or real time, never
`fixedUpdate`.

This is **not** a particle-pool or compute-buffer snapshot. Those
read device simulation state and need their own §33/§34 argument
(R-31 residue). This RFC does not authorise using `Renderer.readPixels`
or the WebGPU backend's `readComputeBuffer` (a `WebgpuRenderer` method,
not a `Renderer` interface member) as a checksum or replay source.

### 3. Feedback is refused, a frame late is still a loop

R-4: feedback loops are refused, not drawn. A `GpuReadbackSource`
whose `target` is the colour attachment of the view currently being
rendered is the same loop, even though the bytes are from the
_previous_ refresh.

The packet extends the existing feedback check, and the mechanism has
to be named because `CanvasTexture` keeps its source private:
`RenderGraph`'s `collectSampledTargets` (`packages/render/src/render-graph.ts`)
today recognises a sampled target only through `isRenderTargetTexture`.
`CanvasTexture` gains one readonly accessor, `readbackTarget:
RenderTarget | null` — the source's `target` when the source is a
`GpuReadbackSource`, else `null` — and `collectSampledTargets` adds that
target to its set exactly as it adds a `RenderTargetTexture`'s. The
existing `"feedback"` issue then fires unchanged: a material sampling a
`CanvasTexture` fed by `GpuReadbackSource(target)` while a pass draws
into `target` is refused. The accessor is the narrowest seam that works
(no `source` getter, no exposure of the pixel buffer). A graph that
cannot see inside a custom pass still emits the opaque-info issue
R-5/R-6 already require.

Sampling `RenderTarget.colorTexture` directly remains the GPU-to-GPU
path and does **not** go through this RFC. Applications that only
need a minimap-as-sprite should keep using `colorTexture` (R-4's
seam). This source exists for the cases that need **CPU bytes**:
composite with a host 2D `RasterSource`, encode a frame, feed a
paint tool.

### 4. Size, origin, colour

- Size is the region's size (whole target if omitted) and is fixed
  for the source's life — RFC 0004's constant-size rule. Resize the
  target → construct a new source.
- `origin` is `"bottom-left"`. `Renderer.readPixels` already emits
  §7a order; `CanvasTexture` does not flip.
- `colorSpace` defaults to `"srgb"` (RFC 0004 Q3, adopted). A linear
  HDR target must pass `colorSpace` explicitly; the source does not
  guess from the target format.
- `CanvasTextureOptions.maximumBytes` (64 MiB) still applies when
  the application wraps the source. The source cannot see that option,
  so it carries its own `maximumBytes` (same 64 MiB default, exported as
  one shared constant): the constructor refuses a region whose
  `width * height * 4` exceeds it with a `RangeError` (§85 — the size
  came from the application's own target and region, the same reasoning
  `CanvasTexture`'s validation records), never `refresh`, because the
  size is fixed at construction.

### 5. Staging

**Packet (S).** `GpuReadbackSource` + feedback-graph check + the
display-only test still green + a unit double of `Renderer.readPixels`

- one browser assertion (WebGL and WebGPU) that `refresh` then
  `CanvasTexture.update` uploads the known clear colour.

**Out of scope:** particle/compute snapshots; making `RasterSource`
async; in-place resize; video; `ImageBitmap`; the §62 Canvas 2D
backend (still a stub by RFC 0004 §2c).

## Alternatives

**A. Document the recipe and stop.**
`const bytes = await renderer.readPixels(t);` then a literal
`RasterSource` that `out.set(bytes)`. Fifteen lines, no new type.
Loses lifecycle (§83 accounting on a retained snapshot), a single
feedback check, and a place to hang "never from a fixed step."
Worth doing if the owner wants zero new API; the recipe should then
live in `docs/guides/raster-painting.md`. Recommendation: ship the
type — the recipe will otherwise be copy-pasted wrong (sync
`readPixels`, wrong origin, loop into the current target).

**B. Make `RasterSource.readPixels` async.** Breaks every existing
source and `CanvasTexture.update(): boolean`. WebGPU cannot go
sync; host 2D should not go async. Rejected.

**C. Block inside `update()` on the GPU fence.** Turns a version
bump into a stall. RFC 0005 already refused a sync `readPixels` on
`Renderer` for this reason. Rejected.

**D. Treat `RenderTarget.colorTexture` as the raster source.** That
is GPU-to-GPU sampling and already works. It does not produce CPU
bytes and cannot feed a host 2D composite. Different feature.

**E. Ride along with particle GPU snapshots.** Those bytes _are_
simulation state. Mixing the arguments would either ban checksums
of a display blit (fine) or silently bless checksums of a GPU
particle pool (false). Rejected; R-31 keeps its own RFC/packet.

## Consequences

**Easier.** A render-to-texture view can be composited into a
painted HUD or encoded without each application inventing a
snapshot buffer. RFC 0004's deferred row becomes a named type
instead of a comment.

**Harder.** Another display-only producer to keep off the
fixed-step path. Feedback checks must see CPU snapshots as well as
live `colorTexture` identities. Users will ask why the minimap is
a frame late — because `refresh` is between frames, and that is
the point.

**Committed to.** `RasterSource.readPixels` stays synchronous.
GPU readback is an explicit `refresh()`. Pixels stay outside §33.
Particle/compute snapshots are not authorised.

## Compatibility analysis

- **Public API (§90).** Additive: `GpuReadbackSource` from
  `@fourjs/render`. **Minor.** `RasterSource` and `CanvasTexture` are
  unchanged.
- **Scene format (§79).** Unmoved. No representation (RFC 0004 §3:
  painted/readback pixels have no key).
- **WebGPU/WebGL (§62).** Unmoved. Uses the existing optional
  `readPixels`. A backend without it makes `refresh` return
  `false`.
- **Plugin API / solvers.** Unmoved. Do not regenerate
  `COMPATIBILITY.md`'s adapter block.

## Prototype / benchmark

None run. The packet must record:

1. **Latency.** `refresh` + `update` + upload at 256² / 1024² /
   2048² on WebGL (`readPixels`) and WebGPU (`mapAsync`), as a
   between-frames cost, not a frame-time budget. RFC 0005's
   pick-latency numbers exist (`benchmarks/pick-latency.mjs`,
   2026-09-09); this packet should not reuse them (picking is a
   point; this is a whole region).
2. **Correctness.** Clear a target to a known RGBA, `refresh`,
   assert the snapshot bytes match (browser gate, both backends).
3. **Feedback.** A graph that samples a `CanvasTexture` backed by
   `GpuReadbackSource(target)` while rendering into `target` is
   refused.
4. **Bundle.** Unreferenced `GpuReadbackSource` absent from
   example bundles (A/B grep). Target: zero delta.

## Open questions

1. **Recipe-only vs new type?** Recommendation: new type
   (decision §1). Alternative A is coherent if the owner wants no
   more raster API.
2. **Zero snapshot vs refuse `readPixels` before the first
   `refresh`?** Recommendation: zeros (defined, like an unread
   target) plus a §85 dev warning after N `update()`s with no
   successful `refresh`.
3. **Default colour space for a linear HDR target.**
   Recommendation: do not infer; default `"srgb"` and document
   the override.

## Review log

- **2026-09-10 — correction pass against the tree** (no decision changed):
  the `Renderer` interface has no `beginFrame`/`endFrame`, so the "never
  inside a frame" rule now names `render` / `RenderGraph.execute`; the
  source cannot read a `CanvasTexture`'s `maximumBytes`, so it carries its
  own, checked at construction with `RangeError` per the raster precedent;
  the display-only scan is a fixed `FORBIDDEN` identifier list, so the new
  names must be added to it rather than "covered by the allowlist"; the
  feedback check's mechanism is spelled (`CanvasTexture.readbackTarget`
  feeding `collectSampledTargets`) because `CanvasTexture` hides its
  source; `readComputeBuffer` is attributed to the WebGPU backend; the
  RFC 0005 pick-latency measurement is cited as landed, not owed.
