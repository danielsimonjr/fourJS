# RFC 0009 — `GpuReadbackSource`: subagent plan

**Status:** plan only, no implementation. Written 2026-09-10 against branch
`claude/rfc-review-planning-s2clzd`. **Gated on the owner accepting RFC 0009**
(`docs/rfcs/0009-gpu-readback-raster-source.md`, corrected 2026-09-10) — including its
Q1 (new type rather than a documented recipe).
**Format:** [`docs/plans/IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) §2; §1 ground
rules apply. **Crew:** at most **four** haiku-class agents, disjoint files, two waves.
This is the smallest of the three plans: one class, one accessor, one branch in an
existing scan, two browser gates.

---

## 1. What is being built

`packages/render/src/gpu-readback.ts` with `GpuReadbackSource implements RasterSource, Disposable`
exactly as RFC §1 (corrected sketch: `target`, `width`, `height`, `origin: "bottom-left"`,
`colorSpace`, `refresh(renderer): Promise<boolean>`, synchronous `readPixels(out)`,
`dispose()`, options `{ region?, colorSpace?, maximumBytes? }`); a marker property
`readonly isGpuReadbackSource = true as const` plus an `isGpuReadbackSource(value)` guard
(the `isRenderTargetTexture` pattern); `CanvasTexture.readbackTarget: RenderTarget | null`;
one new branch in `RenderGraph`'s `collectSampledTargets`; the display-only scan's
`FORBIDDEN` list extended; WebGL and WebGPU browser assertions; a guide section; a
between-frames latency record. **Not built:** particle/compute snapshots, async
`RasterSource`, resize, video, `ImageBitmap`, the Canvas 2D backend.

## 2. Anti-hallucination sheet

| Fact                                                                                                                                                                                                                                                                                                                                                                    | Pinned at                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `RasterSource { width, height, origin?: "bottom-left" \| "top-left", colorSpace?: ColorSpace, paint?(): void, readPixels(out: Uint8Array): void }`                                                                                                                                                                                                                      | `packages/render/src/raster.ts:142-187`                                                                                      |
| `CanvasTexture` keeps `#source` private; `update(): boolean` calls `source.paint?.()` then `source.readPixels(buffer)`; `invalidate()` marks stale; `DEFAULT_MAXIMUM_BYTES = 64 * 1024 * 1024` is **module-private** today (`raster.ts:206`)                                                                                                                            | `packages/render/src/raster.ts:328-500`                                                                                      |
| Over-limit size on an application-built source is a **`RangeError`** (§85), not `UNTRUSTED_INPUT_REJECTED` — the comment at `raster.ts:250-252` records why                                                                                                                                                                                                             | that file                                                                                                                    |
| `Renderer.readPixels?(target, region?): Promise<ArrayBuffer>` — optional member, **presence is the capability**; result is tightly packed RGBA8, rows bottom-to-top, `region` in target texels from the bottom-left; rejects with `FourError` `DEVICE_LOST`/`CONTEXT_LOST`, `INVALID_APPLICATION_STATE`, `UNSUPPORTED_GPU_FEATURE`; a never-rendered target reads zeros | `packages/render/src/renderer.ts:762-808`                                                                                    |
| `supportsReadPixels(renderer)` narrows to `PixelReader`; `validateReadbackRegion(target, region)` is the shared §85 check                                                                                                                                                                                                                                               | `packages/render/src/read-pixels.ts:37-90`                                                                                   |
| The `Renderer` interface has **no** `beginFrame`/`endFrame`; the frame is `render(...)` (line 661); `RenderGraph.execute` drives it                                                                                                                                                                                                                                     | `renderer.ts`, `render-graph.ts`                                                                                             |
| `RenderTarget { id, width, height, disposed, colorTexture: RenderTargetTexture }`; `RenderTargetTexture.isRenderTargetTexture = true as const` with `.renderTarget`; guard `isRenderTargetTexture(value)`                                                                                                                                                               | `packages/render/src/render-target.ts:138-160, 409-460`                                                                      |
| `collectSampledTargets(root, out: Set<RenderTarget>)` is the feedback scan: it inspects `item.material.texture` (sprites), `item.material.map` (others), and node-material reflection; issues carry `code: "feedback"` with severity `"error"`                                                                                                                          | `packages/render/src/render-graph.ts:371-405, 700-725`                                                                       |
| `Rectangle2 { x, y, width, height }` (mutable, `@fourjs/math`)                                                                                                                                                                                                                                                                                                          | `packages/math/src/rectangle2.ts:37-60`                                                                                      |
| `ColorSpace = "srgb" \| "linear"` (from `@fourjs/math`); `validateColorSpace(value, who)` is a **render-package** helper in `render-target.ts`, imported by `raster.ts`                                                                                                                                                                                                 | `packages/math/src/color.ts:114`, `packages/render/src/render-target.ts`, `raster.ts:111, 238-240`                           |
| The render barrel's raster block is `packages/render/src/index.ts:162-172`; the umbrella's `render.ts` is `export *`                                                                                                                                                                                                                                                    | those files                                                                                                                  |
| Display-only scan: `ALLOWED_PACKAGES = {render, render-webgl, four}`; `FORBIDDEN` = `/raster\.js"/` path regex + `RasterSource`, `RasterOrigin`, `CanvasTexture`, `CanvasTextureOptions`                                                                                                                                                                                | `tests/integration/raster-display-only.test.ts:54-120`                                                                       |
| Browser gates: `tests/browser/<name>.spec.ts` bundling `tests/browser/fixtures/<name>-page.ts` with Vite (`bundleFixture`), serving on port 4173, probing pixels; WebGPU gates live in `tests/browser/webgpu/webgpu-<name>.spec.ts` under the `webgpu` Playwright project (launch flag `--enable-unsafe-webgpu`, SwiftShader)                                           | `tests/browser/raster.spec.ts`, `tests/browser/webgpu/webgpu-readpixels-region.spec.ts`, `playwright.config.ts:127-145, 351` |
| WebGL `readPixels` at `packages/render-webgl/src/webgl-renderer.ts:3291`; WebGPU at `packages/render-webgpu/src/webgpu-renderer.ts:2506` (`mapAsync`) — **do not edit either**                                                                                                                                                                                          | those files                                                                                                                  |
| Guide 15 is `docs/guides/raster-painting.md`, listed in `docs/guides/README.md:85`                                                                                                                                                                                                                                                                                      | those files                                                                                                                  |
| Commands as in the other plans; `bun run test:browser` runs Playwright (`bunx playwright test`; add `--project=webgpu` for the WebGPU project)                                                                                                                                                                                                                          | root `package.json`                                                                                                          |

## 3. Roster, ownership, waves

| Agent                             | Owns                                                                                                                                                                                                                                                                                                                             | Wave |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| **A1 — the source**               | `packages/render/src/gpu-readback.ts` (new), `packages/render/src/raster.ts` (edit: export `DEFAULT_MAXIMUM_BYTES` as `DEFAULT_RASTER_MAXIMUM_BYTES`; add `readbackTarget` accessor), `packages/render/src/index.ts` (edit), `packages/render/tests/gpu-readback.test.ts` (new), `packages/render/tests/raster.test.ts` (append) | 1    |
| **A2 — feedback check**           | `packages/render/src/render-graph.ts` (edit: one branch), `packages/render/tests/render-graph.test.ts` (append)                                                                                                                                                                                                                  | 2    |
| **A3 — boundary + browser gates** | `tests/integration/raster-display-only.test.ts` (edit `FORBIDDEN`), `tests/browser/fixtures/gpu-readback-page.ts` + `tests/browser/gpu-readback.spec.ts` (new), `tests/browser/webgpu/webgpu-gpu-readback.spec.ts` (new)                                                                                                         | 2    |
| **A4 — guide + latency record**   | `docs/guides/raster-painting.md` (append a section), `docs/guides/README.md` (edit guide 15's blurb), `tests/browser/gpu-readback-latency.spec.ts` (new, opt-in via env), `benchmarks/results/gpu-readback-latency.json` (recorded by hand from that spec's output, with the host line)                                          | 2    |

A1 first (everyone needs the class and the accessor). Then A2–A4 in parallel.

## 4. Packets

### WP-GR.1 [S] `GpuReadbackSource`, shared constant, `readbackTarget` — **A1**

**Reads first:** RFC §1, §4; `raster.ts` whole file; `read-pixels.ts`; `renderer.ts:762-808`;
`render-target.ts:409-460`; `packages/render/tests/read-pixels.test.ts` (how a fake
`readPixels` renderer is written).

**Edits `raster.ts`:** rename the module-private constant to an exported
`DEFAULT_RASTER_MAXIMUM_BYTES` (keep the value and the doc comment; update the one
internal use). Add to `CanvasTexture`:

```ts
/**
 * The render target a `GpuReadbackSource` behind this texture snapshots, or
 * `null` for every other source. Read by `RenderGraph`'s feedback scan
 * (RFC 0009 §3); exposes nothing else about the source.
 */
get readbackTarget(): RenderTarget | null {
  return isGpuReadbackSource(this.#source) ? this.#source.target : null;
}
```

(`isGpuReadbackSource` is imported from `./gpu-readback.js`; `gpu-readback.ts` imports only
**types** from `./raster.js`, so there is no runtime cycle — state this in both headers.)

**Creates `gpu-readback.ts`:**

```ts
export interface GpuReadbackSourceOptions {
  /* RFC §1 corrected sketch */
}
export class GpuReadbackSource implements RasterSource, Disposable {
  readonly isGpuReadbackSource = true as const;
  readonly target: RenderTarget;
  readonly width: number;
  readonly height: number;
  readonly origin = "bottom-left" as const;
  readonly colorSpace: ColorSpace;
  readonly #region: Rectangle2 | null; // copied at construction
  #snapshot: Uint8Array | null; // width*height*4, zero-filled until the first refresh
  #hasSnapshot = false;
  #disposed = false;
  #refreshing = false;
  constructor(target: RenderTarget, options: GpuReadbackSourceOptions = {}) {
    // target.disposed → FourError INVALID_APPLICATION_STATE
    // region → validateReadbackRegion(target, region) (its RangeError propagates)
    // width/height = region's or target's; bytes = w*h*4 > (maximumBytes ?? DEFAULT_RASTER_MAXIMUM_BYTES) → RangeError (§85, raster precedent)
    // colorSpace = options.colorSpace ?? "srgb", validateColorSpace(…, "GpuReadbackSource")
  }
  async refresh(renderer: Renderer): Promise<boolean> {
    // disposed → false; !supportsReadPixels(renderer) → false
    // overlapping refresh (#refreshing) → FourError INVALID_APPLICATION_STATE ("one refresh in flight")
    // const bytes = await renderer.readPixels(this.target, region ?? undefined)  — rejections propagate untouched
    // byteLength !== w*h*4 → FourError INVALID_APPLICATION_STATE (backend contract violation, §61)
    // if disposed during the await → discard, return false
    // copy into #snapshot; #hasSnapshot = true; return true
  }
  readPixels(out: Uint8Array): void {
    // disposed → FourError INVALID_APPLICATION_STATE; out.length < w*h*4 → RangeError
    // out.set(#snapshot) — zeros before the first successful refresh (RFC Q2)
  }
  dispose(): void {
    /* idempotent; drop #snapshot */
  }
}
export function isGpuReadbackSource(value: unknown): value is GpuReadbackSource;
```

No `paint` member. No `DEV` warning in this packet (RFC Q2's "warn after N updates" is
listed as a follow-up in the header, because `raster.ts` today emits no dev warnings and
adding the first is a separate decision).

**`index.ts`:** export `GpuReadbackSource`, `isGpuReadbackSource`,
`type GpuReadbackSourceOptions`, and `DEFAULT_RASTER_MAXIMUM_BYTES` in the raster block,
with the block comment extended: "and the RFC 0009 readback snapshot".

**Tests (`gpu-readback.test.ts`)** using a fake renderer object `{ readPixels: async (t, r) => … }`
(shape from `read-pixels.test.ts:26`) and a real `RenderTarget`: construction copies the
region (mutate after → unchanged); over-limit → `RangeError`; disposed target →
`INVALID_APPLICATION_STATE`; `readPixels` before refresh fills zeros; `refresh` returns
`true` and `readPixels` then yields the fake bytes; a renderer without `readPixels` →
`false` and the snapshot is unchanged; a rejecting fake (`FourError` `CONTEXT_LOST`) rejects
with the **same** error object (`rejects.toBe`); wrong byte length →
`INVALID_APPLICATION_STATE`; overlapping refresh → `INVALID_APPLICATION_STATE`; dispose
during an in-flight refresh → resolves `false`, no write; `CanvasTexture` over the source:
`update()` before refresh uploads zeros, after `refresh` + `invalidate` uploads the bytes
bottom-row-first (no flip for `"bottom-left"`); `readbackTarget` is the target for this
source and `null` for a plain object source (append to `raster.test.ts`).

**Done when:** `cd packages/render && bun run build && bun run test` green; coverage of
the new file ≥ 95 %.

### WP-GR.2 [S] Feedback scan branch — **A2**

**Reads first:** RFC §3; `render-graph.ts:280-420, 690-730`; `packages/render/tests/render-graph.test.ts`
(find the existing `"feedback"` test and copy its scene shape).

**Edit `collectSampledTargets`:** after each `isRenderTargetTexture(x)` check, add the
sibling check `else if (x instanceof CanvasTexture && x.readbackTarget !== null) out.add(x.readbackTarget)`
— in all three places the function inspects a texture (node-material samplers, sprite
`texture`, `map`). Import `CanvasTexture` as a **value** from `./raster.js` (it is the
same package; the display-only scan allows `render`). Update the function's doc comment to
cite RFC 0009 §3.

**Tests:** (1) a pass drawing into `target` whose root holds a `Renderable` with an
`UnlitMaterial` whose `map` is a `CanvasTexture(new GpuReadbackSource(target))` → `execute`
(or the validation entry the existing feedback test uses) reports an issue with
`code: "feedback"`, severity `"error"`, and the pass name; (2) the same texture sampled in a
pass drawing into a _different_ target → no feedback issue; (3) a sprite material variant
of (1); (4) a `CanvasTexture` over a plain source → no issue (regression guard).

**Done when:** render package build + test green; the existing feedback tests unchanged.

### WP-GR.3 [S] Display-only scan + browser gates — **A3**

**Reads first:** RFC §2, prototype item 2; `raster-display-only.test.ts` in full;
`tests/browser/raster.spec.ts` + `fixtures/raster-page.ts` in full;
`tests/browser/webgpu/webgpu-readpixels-region.spec.ts` in full.

- **Scan:** add `/from\s+"[^"]*\/gpu-readback\.js"/`, `/\bGpuReadbackSource\b/`,
  `/\bGpuReadbackSourceOptions\b/`, `/\bisGpuReadbackSource\b/` to `FORBIDDEN`; extend the
  header comment. Run `bun run test:suites` — it must pass, which proves no simulation
  package names the new module (if `render-webgpu` names it, that is a bug in A1, not a
  reason to widen `ALLOWED_PACKAGES`).
- **WebGL gate (`gpu-readback.spec.ts` + `fixtures/gpu-readback-page.ts`):** the fixture
  creates a `WebglRenderer`, a 64×64 `RenderTarget`, clears/renders it to a known colour
  (copy the readpixels-region fixture's way of producing a solid target), constructs
  `new GpuReadbackSource(target)`, `await source.refresh(renderer)`, wraps it in a
  `CanvasTexture`, `invalidate()` + `update()`, draws a full-screen quad with that texture
  into the default framebuffer, and exposes `window.__probe = { pixels, updated, glError }`.
  The spec asserts the centre pixel equals the known colour within ±2 per channel and that
  `updated === true`. Add a second probe where `refresh` is called with a `region`
  (bottom-left 32×32 of a two-colour target) and assert the region's colour.
- **WebGPU gate (`webgpu/webgpu-gpu-readback.spec.ts`):** same scene over `WebgpuRenderer`
  under the `webgpu` project; assert the same two probes. Reuse the launch-args helper the
  neighbouring spec uses.

**Done when:** `bun run test:browser` (chromium project) and
`bunx playwright test --project=webgpu tests/browser/webgpu/webgpu-gpu-readback.spec.ts` are
green locally.

### WP-GR.4 [S] Guide section and latency record — **A4**

- `docs/guides/raster-painting.md`: append "## Snapshotting a render target
  (`GpuReadbackSource`, RFC 0009)" — the corrected RFC's class sketch, the three rules
  (between frames only; display-only; feedback refused, with the exact `"feedback"` issue
  text), a 15-line example, and a _When not to use it_ paragraph pointing at
  `RenderTarget.colorTexture` (R-4). Update guide 15's blurb in `docs/guides/README.md`.
  Run `node tools/check-docs.mjs` (it counts runnable examples — read its rules for how a
  guide snippet is marked runnable vs illustrative before adding one).
- `tests/browser/gpu-readback-latency.spec.ts`: skipped unless `FOURJS_MEASURE=1`; for
  256², 1024², 2048² targets on WebGL and (under the `webgpu` project) WebGPU, time
  `refresh` + `invalidate` + `update` + one draw with `performance.now`, 20 samples each,
  print median/p95 in the spec's output. Record the numbers **by hand** into
  `benchmarks/results/gpu-readback-latency.json` with the host line format the other
  results files use (open one), and a `_note` stating the SwiftShader caveat (RFC
  prototype item 1: a between-frames cost, not a frame budget; never gated).

**Done when:** check-docs green; the JSON committed; the guide's example typechecks against
`dist` the way `check-docs.mjs` verifies runnable examples.

## 5. Lead's closing packet

1. Full gate (§6). Bundle A/B: `bun run examples:build && bun run size` unchanged (RFC
   prototype item 4 — nothing references the new module unless imported).
2. Spec: §77a gains one paragraph naming `GpuReadbackSource` as the readback form of a
   raster source (display-only, explicit `refresh`, feedback refused); amendments-table row;
   `bun run check-spec`.
3. `docs/COMPATIBILITY.md`: no adapter block change; §2 (render backends) gets one line
   "GPU readback raster source uses the optional `readPixels`; absent → `refresh()` is `false`".
4. `MEMORY.md`, `TODO.md` (strike the RFC 0004 residue bullet "GPU readback as a raster
   source"), `CHANGELOG.md`.

## 6. Gate

```
bun run build && bun run lint && bun run test && bun run test:suites
bun run coverage
bun run test:browser && bunx playwright test --project=webgpu
bun run examples:build && bun run size
bun run check-spec && node tools/check-docs.mjs
```

## 7. Hallucination traps specific to this RFC

- `readPixels` on `Renderer` is a **Promise** on every backend, including WebGL; never
  call GL directly and never block.
- `RasterSource.readPixels(out)` is **synchronous** and must stay so; the class copies a
  snapshot, it does not read the GPU.
- There is no `beginFrame`/`endFrame`; the rule is "not from inside `render`/`execute`".
- Over-limit is a `RangeError`, mirroring `CanvasTexture`; do not use
  `UNTRUSTED_INPUT_REJECTED` here.
- `CanvasTexture` does not expose its source; the only new surface is `readbackTarget`.
- Do not touch `packages/particles` or any compute-buffer code (RFC §2, R-31 residue).
- Do not add the new names to `ALLOWED_PACKAGES`; add them to `FORBIDDEN`.
