# RFC 0004 residue — raster follow-ups: subagent plan

**Status:** plan only. Written 2026-09-10 against `claude/rfc-review-planning-s2clzd`.
Scope: the `TODO.md` row "RFC 0004 residue" as re-read in the RFC's *Post-acceptance
corrections*. **Crew:** ≤ 4 haiku-class agents, disjoint files. Format per
`docs/plans/IMPLEMENTATION_PLAN.md` §2.

## 1. Scope decision

| Residue item | This plan | Why |
| --- | --- | --- |
| `CanvasTexture` sampler fields (`filter`, `wrap`, `mipmaps`, `minFilter`, `anisotropy`) | **WP-RS.1** | `MaterialTexture` already declares them optionally; both backends already honour them for `Texture`; purely additive |
| Dirty-rectangle upload | **WP-RS.2** | `texSubImage2D` / `writeTexture` with an origin; the seam is a `dirtyRegion` the application reports on `invalidate` |
| Decoded-image raster source (`ImageBitmap`/`ImageData`-shaped, DOM-free) | **WP-RS.3** | A structural `{ width, height, data }` source is the raster twin of A-19's asset decoder; no cancellation seam needed for a source the app already decoded |
| In-place resize | **gated** on §77 change notification (spec §77a, `raster.ts:320`) | needs the change-notification decision |
| Video textures | **gated** — needs a DOM-free frame-arrival signal (RFC §6) | own RFC |
| GPU readback | RFC 0009 (`docs/plans/RFC-0009-GPU-READBACK_PLAN.md`) | — |
| Canvas 2D backend | stub by decision (RFC §2c) | — |
| The dead `"four"` allowlist entry | **fixed 2026-09-10** (`"fourjs"`) | — |

## 2. Anti-hallucination sheet

| Fact | Pinned at |
| --- | --- |
| `RasterSource`, `CanvasTexture` (`update()` / `invalidate()` / `dispose()`, private `#source`, `#buffer`, `#version`), `DEFAULT_MAXIMUM_BYTES` 64 MiB (module-private today; RFC 0009's plan exports it as `DEFAULT_RASTER_MAXIMUM_BYTES` — coordinate) | `packages/render/src/raster.ts:142-199, 206, 328-500` |
| `MaterialTexture` optional sampler fields: `filter?`, `wrap?`, `mipmaps?`, `minFilter?`, `anisotropy?` (types beside them) | `packages/materials/src/texture.ts:109-232` |
| WebGL upload: whole-texture `texImage2D` on version change; sampler state applied from the `MaterialTexture` fields; mipmaps via one `generateMipmap` | `packages/render-webgl/src/gl-texture.ts:30-90, 245-380` |
| WebGPU upload: `device.queue.writeTexture` | `packages/render-webgpu/src/wgpu-texture.ts:648`, `webgpu-device.ts:538` |
| `Rectangle2 { x, y, width, height }` | `packages/math/src/rectangle2.ts` |
| Display-only scan `FORBIDDEN` list — every new raster-tier identifier must be added | `tests/integration/raster-display-only.test.ts:100-120` |
| Browser raster gate + fixture | `tests/browser/raster.spec.ts`, `fixtures/raster-page.ts` |
| A-19 decoded-asset loader (static textures, injected `decode`, 64 MiB decoded bound) — the precedent for "decoded content is §96 content" | `packages/assets/src/texture.ts:5-13, 69, 103` |
| Sizes are constant for a `CanvasTexture`'s life; resize is refused with `INVALID_APPLICATION_STATE` | `raster.ts:466-490` |
| No `lib.dom` pin anywhere; DOM-free is a seam rule: no `ImageBitmap`/`HTMLCanvasElement` **type** may appear in `@fourjs/render` | RFC 0004 alt. F, MEMORY 2026-09-10 |

## 3. Roster and waves

| Agent | Owns | Wave |
| --- | --- | --- |
| **A1 — sampler fields** | `packages/render/src/raster.ts` (edit: `CanvasTextureOptions` gains the five optional fields, validated like `Texture` does — read `packages/render/src/texture.ts:344-420`; `CanvasTexture` exposes them read-only), `packages/render/tests/raster.test.ts` (append), `tests/browser/raster.spec.ts` (append one probe: `filter: "nearest"` on a 2×2 source shows hard edges) | 1 |
| **A2 — dirty-rect** | `packages/render/src/raster.ts` (**after A1**: `invalidate(region?: Rectangle2)` accumulates a union rect; `update()` exposes `dirtyRegion: Rectangle2 \| null` consumed-once via a `takeDirtyRegion()` the backends call), `packages/render-webgl/src/gl-texture.ts` (`texSubImage2D` path when a `MaterialTexture` exposes `takeDirtyRegion`), `packages/render-webgpu/src/wgpu-texture.ts` (`writeTexture` with `origin`), tests in all three packages | 2 |
| **A3 — decoded-image source** | `packages/render/src/decoded-raster-source.ts` (new: `DecodedImageSource implements RasterSource` over `{ width, height, data: Uint8ClampedArray \| Uint8Array, origin?: RasterOrigin, colorSpace? }`, bytes copied or borrowed by option, §96 `maximumBytes`), tests, `tests/integration/raster-display-only.test.ts` (`FORBIDDEN` additions), guide section | 1 |
| **A4 — evidence** | `benchmarks/raster-upload.mjs` (dirty-rect vs full upload on the counting-GL seam at 1024², 5 % / 50 % / 100 % dirty), results, `tools/size-budgets.mjs` row, `docs/guides/raster-painting.md` sections for A1–A3 | 2 |

## 4. Packet notes

- **WP-RS.1 (A1).** Defaults must equal today's behaviour (backend defaults) so
  existing browser goldens are unchanged; state the resolved defaults in the doc comment.
- **WP-RS.2 (A2).** The origin flip (`"top-left"` sources) applies to the dirty rect too:
  convert once in `raster.ts`, hand backends a bottom-left rect. A backend without the
  sub-upload path (or a `null` region) falls back to the whole upload — never a skip.
  Determinism: uploads are display; nothing enters §33.
- **WP-RS.3 (A3).** No decode inside the engine, no `createImageBitmap` call, no DOM type;
  the application passes decoded bytes. `maximumBytes` over → `UNTRUSTED_INPUT_REJECTED`
  (bytes are content; A-23's split) while a bad option → `RangeError`.
- **WP-RS.4 (A4).** Numbers recorded, never gated; the guide's snippets must typecheck
  under `tools/check-docs.mjs`'s runnable-example rule.

## 5. Lead's closing packet

Spec §77a paragraph for sampler fields + dirty rect (amendments row); RFC 0004 residue
paragraph; `COMPATIBILITY.md` §2 note; `TODO.md`, `MEMORY.md`, `CHANGELOG.md`. Gate as in
the other plans plus `bun run test:browser`.

## 6. Traps

- `paint()` and `readPixels()` stay synchronous; nothing here goes async.
- Size stays constant; a dirty rect outside the surface is a `RangeError` (§85).
- Every new identifier goes into `FORBIDDEN`; never into `ALLOWED_PACKAGES`.
