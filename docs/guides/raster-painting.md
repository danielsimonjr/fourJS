# Raster painting and dynamic textures

§77a (RFC 0004, accepted 2026-08-21; shipped 2026-08-29) is the sanctioned
exception to the vector 2D stack of §50–§52: a texture whose texels are
produced by something other than the engine — a minimap, a gauge face,
procedural art, the §73 canvas view. The engine's whole contribution is **a
buffer, a version, a size rule, and a place to put it**. There is no
`fillRect`, no path builder, no font rasterizer and no compositing model, and
§77a states that normatively: every pixel is painted by the host or the
application, and an engine-defined drawing API is RFC 0004's rejected
alternative C.

Nor is this §62's Canvas 2D _backend_ (`@fourjs/render-canvas`, an unchanged
reserved stub). A backend draws the scene into a host canvas; this seam reads
arbitrary pixels out of one. The two share a host surface and nothing else.

Two types carry the whole tier, both in `four/render`:

- **`RasterSource`** — the read seam: a width, a height, an optional
  `origin`/`colorSpace`, an optional `paint()` hook, and `readPixels(out)`,
  which writes exactly `width * height * 4` tightly packed RGBA8 bytes.
- **`CanvasTexture`** — the `MaterialTexture` it produces: usable in any
  material texture slot (`material.map`, a sprite's texture, a §60 node
  material's sampler) with **no backend changes** — a backend's texture cache
  keys on `id` and validates on `version`, both of which this class satisfies.

## The browser adapter

The seam is structural and DOM-free — `@fourjs/render` compiles with no
`lib.dom`, so it cannot name `HTMLCanvasElement` (RFC 0004, alternative F). In
the discipline of `TextureSource`, `FetchLike`, `PointerSurface` and
`SurfaceObserver`, the engine names a shape, the host supplies a value, and
the browser adapter is a few lines in the application. This is the recipe,
reproduced from `packages/render/src/raster.ts`'s module header:

```ts
import { CanvasTexture, type RasterSource } from "fourJS/render";

const canvas = new OffscreenCanvas(256, 256);
const ctx = canvas.getContext("2d")!;

const source: RasterSource = {
  width: 256,
  height: 256,
  origin: "top-left", // what every host 2D API produces
  paint: () => drawMinimap(ctx, world),
  readPixels: (out) => out.set(ctx.getImageData(0, 0, 256, 256).data),
};
const texture = new CanvasTexture(source);
material.map = texture; // it is a MaterialTexture

// whenever the minimap should change:
texture.invalidate();
// once per frame, from render/real time — never from a fixed step (§33):
texture.update(); // repaints and re-reads only if stale
```

`RasterSource.paint` takes **no parameter**, and that is the seam holding: a
callback taking an engine-defined context would make the engine define a
drawing API (alternative C), and one taking the host's context would make the
engine name a DOM type (alternative F). The source closes over whatever it
paints with; the hook exists only so the engine can order the repaint against
the read.

## `update()` is yours to call — nothing polls

This line is prominent because RFC 0004 (Q6, adopted) decided it must be:
**nothing polls, nothing subscribes, and no per-frame hook exists.** An
application that calls `invalidate()` and forgets `update()` sees a stale
texture and no diagnostic. Call `update()` once per frame from render or real
time — it repaints and re-reads only when the texture is stale, so an
unchanged surface costs one boolean check. Never call it (or `paint`) from a
fixed step: a repaint driven from `fixedUpdate` couples an unreproducible host
cost to the §10 accumulator.

## Rules the tier lives under

- **Painted pixels are display content, never simulation input (§33).** Host
  rasterization is not reproducible across platforms, so nothing inside §33's
  envelope may read them: no value derived from a `RasterSource` or
  `CanvasTexture` may reach a fixed step, a §33 checksum, a §34 snapshot, or a
  replay document. `tests/integration/raster-display-only.test.ts` enforces
  the import half mechanically; an application branching its own fixed-step
  logic on `texture.data` is the half only discipline can enforce.
  Consequently a `CanvasTexture` has **no §79 representation**: no scene
  document can carry unreproducible pixels.
- **The row flip is the engine's job.** `origin: "top-left"` is what
  `getImageData` produces; the engine reverses the rows itself so that row 0
  is `v = 0` (§7a), which is the one flip rule written once instead of once
  per application — the vertically mirrored minimap is RFC 0004's motivating
  bug report. A source that already writes bottom-up says `"bottom-left"`
  (the default) and pays nothing.
- **The colour-space default is `"srgb"`**, deliberately different from
  `TextureSource`'s `"linear"`: a host 2D canvas produces sRGB-encoded bytes
  unambiguously (RFC 0004 Q3, with the note at both types).
- **The size is mutable through `CanvasTexture.resize()`.** Call it after the
  source's `width`/`height` change and before the next `update()`. The buffer
  and §83 totals update immediately; `version` waits for the next successful
  `update()`. A source that changes size without `resize()` is still refused
  with `INVALID_APPLICATION_STATE` (§89). Construction-time `maximumBytes`
  still caps the new size.
- **§96 bounds the surface**: `width * height * 4` may not exceed
  `maximumBytes`, default 64 MiB (exactly a 4096 × 4096 RGBA8 surface);
  `Number.POSITIVE_INFINITY` is the explicit in-source opt-out.
- **Explicit lifetime (§83).** One engine-owned `Uint8Array` is allocated at
  construction and reused — no per-frame allocation — and it is counted in the
  §83/§84 texture-memory totals; `dispose()` releases it.

## Cross-references

- §77a (the normative text), §33/§40 (display-only), §83 (lifetime), §96
  (limits); RFC 0004 (`docs/rfcs/0004-raster-painting-stack.md`).
- `packages/render/src/raster.ts` — `RasterSource`, `CanvasTexture`, and the
  module header this guide's recipe is taken from.
- The §73 canvas-view widget (`CanvasViewWidget` in `four/ui`) draws a
  `CanvasTexture` in the UI layer; deferred siblings — video textures,
  `ImageBitmap` sources, dirty-rectangle upload — are listed
  with what each waits on in RFC 0004's §6 table. In-place resize shipped
  2026-10-05 as `CanvasTexture.resize()`.

## GPU readback snapshots (RFC 0009)

`GpuReadbackSource` bridges asynchronous GPU readback to a synchronous raster
source. Refresh between rendered frames; never feed these display pixels into
simulation, checksums, snapshots, or replay.

```ts
import { CanvasTexture, GpuReadbackSource } from "fourJS/render";

const source = new GpuReadbackSource(target, { colorSpace: "srgb" });
const texture = new CanvasTexture(source);
// After the renderer has finished submitting the target's frame:
if (await source.refresh(renderer)) {
  texture.invalidate();
  texture.update();
}
// Attach texture to a material drawn into a different target.
// When finished:
texture.dispose();
source.dispose();
```

Before the first refresh the snapshot is zero-filled. Refresh returns `false`
for an unsupported renderer or a disposed source; backend failures reject.
Only one refresh may be in flight. A target resize requires a new source.
The default independent snapshot limit is 64 MiB. Rows remain bottom-first;
color space defaults to sRGB and is never guessed from the target.

Render-graph validation detects a texture sampling a snapshot of its own output
target, including delayed feedback. Use `target.colorTexture` directly when
CPU bytes are unnecessary.
