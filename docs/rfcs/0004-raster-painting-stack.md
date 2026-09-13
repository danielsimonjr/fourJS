# RFC 0004: 2D raster painting stack (§77a proposed, §73, §77)

- **Status:** accepted (owner, 2026-08-21 — "Continue with the remaining WPs and the RFCs"; the recommended dispositions of the flagged questions are adopted)
- **Date:** 2026-08-09
- **Owner decision:** accepted (2026-08-21); implemented 2026-08-29 (spec revision 1.12, §77a)
- **Spec sections affected:** §77 (primary), a proposed new **§77a**, §73, §33, §34, §40, §55, §58, §62, §63, §79, §83, §85, §89, §90, §96, §98

## Context

**This RFC exists because the owner asked for it, and that is the honest first sentence.**
Unlike RFCs 0001–0003, it does not close a filed gap. There is no `R-nn` for raster
painting, because there is nothing in the specification for a gap analysis to find missing.
§50–§52 specify a **vector** 2D stack (shapes, paths, tessellation into GPU geometry);
§55 specifies sprites that _consume_ a raster; §58 specifies paints that _reference_ an
image pattern; §77 specifies a texture _system_ whose sources are listed but whose
production is nobody's section. Nowhere does the specification say that an application may
_paint pixels_ — imperatively, per frame — and have the engine carry them. The retained-mode
choice runs the whole document, and this proposal is a deliberate addition to it, not a
correction of it.

Verified before writing, because the whole argument depends on it:

- `grep -rn "getImageData|OffscreenCanvas|CanvasRenderingContext2D|RasterSource|CanvasTexture|fillRect" packages/*/src` returns **four hits, all prose**: three doc comments in
  `render-webgl` about what kind of host object a canvas may be, and
  `packages/render/src/renderer.ts:150`'s note on why `RendererOptions.canvas` is typed
  `unknown`. There is no painting API, no partial one, and no staging note claiming one is
  coming.
- `packages/render-canvas/src/index.ts` is one line: `export const PACKAGE_NAME`. It is a
  reserved stub, and it is a **backend** — a thing that draws the scene _via_ Canvas 2D.
  It is not a painting API and would not become one by being implemented. §2c below insists
  on that distinction rather than assuming the reader shares it.
- §73's `canvas view` widget is staged on exactly this absence.
  `packages/ui/src/widget.ts:157` states the blocker verbatim: _"canvas view needs the
  immediate-mode drawing surface the dependency matrix keeps out of this package"_, and
  `packages/ui/README.md:24` repeats it. Nine of §73's sixteen controls ship; the canvas
  view is one of the seven that do not, and it is the only one whose blocker is a missing
  **engine surface** rather than a missing §74/§56/§48 feature.

Three recorded positions constrain the design before any of it is written.

1. **The texture seam already exists and has already been re-used once.** R-4's recorded
   decision — _"the render-to-texture seam is `MaterialTexture`, not a new type;
   `RenderTarget.colorTexture` satisfies it, so R-5/R-6 inherit zero adapter work and
   `@fourjs/materials` needed no widening"_ — is the template. A raster surface that produces
   `{ id, version, width, height, data, disposed, colorSpace }` is already a texture to
   every material and every backend in the repository, with no backend change and **no new
   duck-typed contract** (the count stays at five).
2. **The §40 display-only rule is the closest analogue this repository has to what raster
   painting needs, and its enforcement is mechanical.**
   `tests/integration/units-display.test.ts` scans every `packages/*/src` file and fails if
   any of them imports `@fourjs/core`'s `units.ts`, with a visible `ALLOWED` allowlist whose
   editing is _"deliberately a visible act"_. The rule it enforces — a conversion tier that
   is inexact by construction must never touch a simulation path — transfers to host-painted
   pixels with the word "inexact" replaced by "unreproducible". §3 is that transfer.
3. **Seams in this repository are structural and never DOM-typed.** `FetchLike`,
   `PointerSurface`, `KeySurface`, `SurfaceObserver`, and `RendererOptions.canvas: unknown`
   are all the same move: the engine names a shape, the host supplies a value, and the
   five-line browser adapter lives in the application. `TextureSource` already states it for
   textures specifically — _"structural and DOM-free … a test can build a 2×2 checkerboard
   with no browser at all"_. A raster painting seam that named `HTMLCanvasElement` would be
   the first exception, and this RFC does not propose one.

## Proposed decision

Three tiers, separable, each landing on its own. **Tier (c) is explicitly not taken.**

### 1. Motivation, bounded honestly

**What users want.** A texture whose contents change at runtime and are produced by
something other than the engine's own renderer: a minimap redrawn when the world moves,
procedural or generative art, a chart or gauge face drawn with the host's 2D API, a
video-like surface, a paint/annotation tool, and the §73 canvas view — a widget whose entire
purpose is "the application draws here". Two of those have a second-order motivation worth
naming: §58's paint model is `R-16`, a **blocker**-severity item with an `L` estimate that
is itself gated on `R-24`/`R-25` (path model and tessellation, both `L`), so an application
that wants a gradient fill or a dashed stroke today has no engine path at all and will not
have one soon. A host 2D context has had all of it since 2005.

**What works today, stated so the alternative is real.** An application can already do all
of this without a line of engine change:

```ts
const canvas = new OffscreenCanvas(256, 256);
const ctx = canvas.getContext("2d")!;
ctx.fillStyle = "#4466ff";
ctx.fillRect(0, 0, 256, 256);

const image = ctx.getImageData(0, 0, 256, 256); // top row first
const bytes = flipRows(image.data, 256, 256); // §7a wants v=0 at row 0
const texture = new Texture({ width: 256, height: 256, data: bytes });
// each repaint: paint, read, flip into texture.data, texture.markDirty()
```

That is fifteen lines and it works. **Alternative A is to write those fifteen lines into a
guide and stop.** It is argued at full strength below, and it is not a straw man.

**Why engine surface still earns its place.** Four things the recipe does not give, in
descending order of how much they matter:

- **The §73 widget.** `@fourjs/ui`'s frozen §3.1 row is `core, math, scene, input, text` — no
  `render`, no `materials`. A widget cannot own a texture, so the canvas view cannot be
  built out of the recipe by the application _inside a widget_; it needs a seam. §2b shows
  the seam is much smaller than the recorded blocker assumes.
- **Lifecycle and accounting.** The recipe's byte array is invisible to §83: it is not in
  `textureMemoryBytes`, a leaked repaint buffer is not in `liveTextureCount`, and §84's
  `textureMemory` under-reports by exactly the amount an application is churning most
  aggressively. A `CanvasTexture` reports itself the way `Texture` does, at construction and
  at dispose.
- **Dirty tracking, and therefore upload efficiency.** The recipe re-reads and re-uploads
  whenever the application remembers to; there is no shared vocabulary for "this surface
  changed" versus "this surface was repainted with the same pixels". A version-driven
  `update()` that returns whether anything was re-read is the difference between one upload
  per repaint and one upload per frame.
- **One flip rule, written once.** `MaterialTexture.data` is row-0-is-`v`-=-0; every host 2D
  API is top-row-first. Every application writing the recipe writes `flipRows` again, and
  the ones that get it wrong get a vertically mirrored minimap and a confusing bug report.

**What this does not claim.** It is not a 2D drawing API. The engine gains no `fillRect`,
no path builder, no font rasterizer, no compositing model. Every pixel is painted by the
host or by the application; the engine's contribution is a buffer, a version, a size rule,
and a place to put it.

### 2a. `RasterSource` and `CanvasTexture` — `@fourjs/render`, no new §3.1 edge

**Placement.** `packages/render/src/raster.ts`, beside `texture.ts`. `render`'s §3.1 row is
`core, math, scene, geometry, materials`; it already owns `Texture`, `TextureSource`, the
§83 `resource-memory.ts` accounting, and the `implements SpriteTexture` declaration that
pins the `MaterialTexture` contract from the other side. Nothing is added to the matrix.
Alternative E argues the `@fourjs/materials` placement and loses.

**The seam is a read model, not a draw model.**

```ts
/**
 * A surface an application paints and the engine reads (§77a).
 *
 * Structural and DOM-free, in the discipline of `TextureSource`, `FetchLike`,
 * `PointerSurface`, and `SurfaceObserver`: the engine names a shape, the host
 * supplies a value, and the browser adapter is a few lines in the application.
 */
export interface RasterSource {
  /** Width in texels. Finite integer ≥ 1, and constant for this source's life. */
  readonly width: number;

  /** Height in texels. Finite integer ≥ 1, and constant for this source's life. */
  readonly height: number;

  /**
   * Which row `readPixels` writes first.
   *
   * `"bottom-left"` matches `MaterialTexture.data` and needs no work.
   * `"top-left"` is what every host 2D API produces; the engine reverses the
   * rows during the copy it is already making. Default `"bottom-left"`.
   */
  readonly origin?: RasterOrigin;

  /**
   * The colour space of the texels this source produces. Default `"srgb"` —
   * see below; this is a deliberate difference from `TextureSource`'s default.
   */
  readonly colorSpace?: ColorSpace;

  /**
   * Repaint, if this source paints on demand. Called by `CanvasTexture.update()`
   * immediately before `readPixels`, and never from a fixed step (§3).
   */
  paint?(): void;

  /**
   * Write exactly `width * height * 4` tightly packed RGBA8 bytes into `out`,
   * straight alpha, in the order declared by `origin`.
   *
   * `out` is engine-owned and exactly the right length; a source neither
   * allocates nor retains it.
   */
  readPixels(out: Uint8Array): void;
}

export type RasterOrigin = "bottom-left" | "top-left";
```

The browser adapter is the few lines the seam discipline promises:

```ts
const canvas = new OffscreenCanvas(256, 256);
const ctx = canvas.getContext("2d")!;

const source: RasterSource = {
  width: 256,
  height: 256,
  origin: "top-left",
  paint: () => drawMinimap(ctx, world),
  readPixels: (out) => out.set(ctx.getImageData(0, 0, 256, 256).data),
};
```

**Why a read model and not a paint-callback model.** A paint callback whose parameter is an
engine-defined drawing context (`(ctx: PaintContext) => void`) requires the engine to
_define_ `PaintContext` — which is a 2D drawing API, which is §50–§52 and §58 re-invented
in raster form, which is alternative C. A paint callback whose parameter is the _host's_
context is not a seam at all: the engine would have to name `CanvasRenderingContext2D`,
which is alternative F. `RasterSource.paint()` takes **no parameter** for exactly this
reason: the source closes over whatever it paints with, and the engine never learns what
that is. The hook exists only so the engine can order the repaint against the read.

**`CanvasTexture` is a `MaterialTexture`, and that is the whole integration.**

```ts
export interface CanvasTextureOptions {
  /** §96 ceiling on `width * height * 4`. Finite by default — see §4. */
  readonly maximumBytes?: number;
}

export class CanvasTexture implements MaterialTexture, Disposable {
  constructor(source: RasterSource, options?: CanvasTextureOptions);

  readonly id: string; // `canvas-texture-<n>`, monotonic (§33)
  get version(): number;
  get width(): number;
  get height(): number;
  get data(): Uint8Array | null; // engine-owned buffer; null once disposed
  get disposed(): boolean;
  get colorSpace(): ColorSpace; // `"srgb"` unless the source says otherwise
  get byteLength(): number; // §83/§84, `0` once disposed

  /** Marks the surface stale. Cheap, idempotent, allocation-free. */
  invalidate(): void;

  /**
   * If stale: call `source.paint?.()`, `source.readPixels(buffer)`, bump
   * `version`, clear the stale flag, and return `true`. Otherwise return
   * `false` and touch nothing.
   */
  update(): boolean;

  dispose(): void;
}
```

Five properties follow, and each is a decision rather than an implementation detail:

- **No backend changes, none.** `render-webgl`'s `TextureCache` keys on `id` and validates
  on `version`; a `CanvasTexture` satisfies both and uploads through the path that already
  exists. This is R-4's seam paying off a second time, and it is the strongest single
  argument for this shape over any other.
- **The engine owns the buffer; the source owns the pixels.** One `Uint8Array` of
  `width * height * 4` is allocated at construction and reused for the life of the texture.
  No per-frame allocation, and §83's accounting has something concrete to count.
- **`update()` is called by the application, never by the engine.** Nothing polls, nothing
  subscribes, and no per-frame hook is introduced. This is the same "version, not events"
  stance `Texture` records, and it keeps the raster tier off the render loop's critical
  path where R-4/R-5/F13's byte-identity proofs live.
- **`colorSpace` defaults to `"srgb"`, deliberately unlike `TextureSource`.** R-15's
  linear default exists because flipping it _"would silently darken every texture already
  authored against this engine and move every pixel golden"_. A texture class that does not
  yet exist has no authored content and no goldens, and a host 2D canvas produces
  sRGB-encoded bytes unambiguously. Choosing `"linear"` here for consistency would make the
  new tier wrong on purpose to match a default that exists only for backward compatibility.
  The two defaults differ, and the reason is written at both.
- **The size is fixed for the texture's life.** `RasterSource.width`/`height` are
  `readonly` and re-validated on every `update()`; a source that changes size is refused
  with `INVALID_APPLICATION_STATE` (§89) rather than silently reallocating. Resizing means
  constructing a new `CanvasTexture` and disposing the old one.

**Interaction with `R-30`, stated as it is rather than as one would like.** The last point
is where §77's missing change-notification bites, and this RFC does **not** deliver it.
R-29 recorded the hole: _"containment is write-time only; a later texture swap samples
clamp-to-edge (wants R-30's §77 change notification)"_ — a §55 sprite `frame` is validated
against the texture's size when written, and nothing re-checks it if the size changes
later. Static atlases made that hazard theoretical. A raster surface makes it real, because
resizing a minimap when the panel resizes is the obvious thing to do. The cheap, honest
answer is the refusal above: **in-place resize is forbidden, so the hazard cannot arise**,
and lifting the restriction is explicitly gated on `R-30`. A version bump is not a
notification — it tells a cache to re-read, not a dependent to re-validate — and pretending
otherwise would be the kind of claim `check-docs.mjs` exists to catch.

### 2b. The §73 canvas-view widget — and the recorded blocker is wrong

The blocker in `widget.ts:157` says the canvas view needs _"the immediate-mode drawing
surface the dependency matrix keeps out of this package"_. Read against what `@fourjs/ui`
already ships, that premise does not hold: **the widget does not draw, and never should.**
`ImageWidget` established the split on 2026-08-07 and stated it in its own header — the
widget owns the box, the intrinsic size, and the logical identity of its content; the
`WidgetSkin` owns the texture, the material, and the quad, because the skin is application
code that can see `@fourjs/render` while the widget cannot.

A canvas view is `ImageWidget` with two differences: its content has no logical key (the
application paints it), and its content changes (so it must say when). Both are expressible
with what `@fourjs/ui` has:

```ts
export class CanvasViewWidget extends UIWidget {
  static readonly typeName = "ui:canvas-view";

  constructor(options?: CanvasViewWidgetOptions);

  /**
   * Device-pixel scale for the backing surface (§74's device-pixel scaling).
   * Supplied, never discovered — this package cannot see §45's `resolution`,
   * exactly as `ImageWidget.naturalWidth` is supplied rather than loaded.
   */
  get resolution(): number;
  set resolution(value: number);

  /** Backing-surface size in texels: `round(layout size * resolution)`. */
  get pixelWidth(): number;
  get pixelHeight(): number;

  /**
   * Announce that the content should be repainted. Bumps `contentVersion`
   * and fires the skin's existing `onContentChange` hook.
   */
  invalidate(): void;

  /** Monotonic; the skin compares it to decide whether to repaint. */
  get contentVersion(): number;
}
```

**No new skin hook is required.** `WidgetSkin` already has five, and `onContentChange` was
added by A-12 for precisely this category — _"a value, an `indeterminate` flag, an image
source — content with no layout or state transition"_. A repaint request is content with no
layout and no state transition. The skin, which is application code, holds the
`CanvasTexture`, repaints, and calls `update()`. `onLayout` already tells it when
`pixelWidth`/`pixelHeight` changed, which is when it constructs a replacement texture (§2a's
no-resize rule).

So tier (b) is roughly one hundred lines over `UIWidget` plus a §79 pair, it adds no
dependency, and it is buildable **the day tier (a) lands** — or, strictly, the day an
application is willing to write the skin, since the widget itself does not name
`CanvasTexture` at all. The `widget.ts` blocker text is corrected by the packet, and the
correction is recorded here because "the reason we said we could not build it was wrong" is
worth more than the widget.

Two gates the packet inherits: `packages/fourjs/tests/scene-serializers.test.ts` _"enumerates
every umbrella barrel class carrying `static typeName` … and requires each registered"_, so
the `ui:canvas-view` pair is a gate rather than a follow-up; and the widget's §79 payload is
its box, `resolution`, and nothing else — **painted pixels are never serialized** (§3).

### 2c. The §62 Canvas 2D backend is a different concern, and this RFC does not touch it

The two are routinely confused, so the difference is stated as a table rather than a
sentence:

|                       | §62 Canvas 2D backend (`render-canvas`) | §77a raster painting (this RFC) |
| --------------------- | --------------------------------------- | ------------------------------- |
| What draws            | the engine                              | the application or the host     |
| What is drawn         | the scene graph, via `Canvas2D` calls   | arbitrary pixels                |
| Direction             | scene → host canvas                     | host canvas → texture           |
| Public type           | a `Renderer` implementation             | a `MaterialTexture` producer    |
| §3.1 home             | `render-canvas` (core, math, render)    | `render`                        |
| Status after this RFC | **unchanged reserved stub**             | proposed                        |

**Recommendation: `render-canvas` stays a stub.** This RFC neither implements nor schedules
it, and accepting this RFC must not be read as progress toward it. The only thing worth
recording is the shared seam: both tiers meet the host through an untyped surface —
`RendererOptions.canvas: unknown` for the backend, `RasterSource` for the painter — and a
Canvas 2D backend, if it is ever built, would be a legal `RasterSource` producer (render a
sub-scene into a canvas, feed it back as a texture). That composition is also a **feedback
hazard**, and R-4 already has the rule for it: _"feedback loops are refused, not drawn"_. If
`render-canvas` is ever implemented, refusing a `CanvasTexture` whose source is the surface
currently being rendered into is that packet's obligation, not this one's. It is named here
so it is not discovered.

### 3. Determinism (§33): painted pixels are display content, never simulation input

This is the load-bearing section, and the rule is copied from §40 rather than invented.

**The problem.** Host-rendered raster output is not reproducible. Font rasterization differs
by platform, hinting engine, and font version; anti-aliasing differs by implementation;
`getContext("2d")` may be GPU-backed, so the same call sequence on the same machine can
produce different bytes in different browsers or after a driver update; and
`getImageData` on a GPU-backed canvas is subject to the same float behaviour §33 already
places outside the envelope for shading. Nothing about this is fixable by the engine, and
an engine that took a dependency on it in a simulation path would have made §34's replay
guarantee false on every platform at once.

**The rule.**

> **Painted pixels are display and content only.** Nothing inside §33's determinism
> envelope may read them. No value derived from a `RasterSource`, a `CanvasTexture`, or a
> `CanvasViewWidget`'s content may reach a fixed step, a §33 checksum, a §34 snapshot, or a
> replay document.

This is §40's sentence with one word changed. §40's `UnitSystem` is _"a conversion tier,
never an engine mode"_ whose functions are documented as inexact and forbidden from
simulation paths; painted pixels are a content tier, never a simulation input, and are
unreproducible rather than inexact. The category is identical: a legitimate, useful,
non-deterministic thing that must be kept on one side of a line.

**The enforcement, and the honest limit of it.** §40's enforcement is
`tests/integration/units-display.test.ts`, which scans every `packages/*/src` file for the
forbidden import and fails with a visible `ALLOWED` allowlist. The packet ships the direct
analogue, `tests/integration/raster-display-only.test.ts`:

- No source file in `core`, `math`, `scene`, `motion`, `animation`, `physics`,
  `physics-*`, `particles`, or `serialization` may import `@fourjs/render`'s raster module —
  most of them cannot see `@fourjs/render` at all under §3.1, and the test states the rule
  for the ones that could and for every package added later.
- `ALLOWED` holds `packages/render/src/*` (which owns it), `packages/render-webgl/src/*`
  (which uploads it, through the `MaterialTexture` path it already has), and the `four`
  umbrella barrel. Editing the list is a visible act, per the §40 precedent.
- A vacuity guard, as §40's has: the scan must find more than 100 files and must contain
  named ones, so a broken directory walk cannot pass green.

The limit worth stating plainly: **this is a reachability rule, not a readability rule.**
`MaterialTexture.data` is public and must be — the upload path reads it — so the bytes are
readable by anyone holding the texture. What is enforceable is that no _simulation package_
can reach the module at all, which is exactly the shape §40 chose for the same reason (its
conversions are also callable by anyone). An application that reads `canvasTexture.data`
and branches its own fixed-step logic on a pixel has broken its own determinism, and the
engine can document that but cannot prevent it. Saying so is better than implying a
guarantee the test does not make.

**Three consequences, each decided rather than left open.**

- **`CanvasTexture` is not serializable, and that falls out of an existing decision.** A-16
  settled that _"resources are keys, not payloads"_ — §79 references resources by key
  through `SceneResourceCatalog`, never inline. A painted surface has no key: it is not a
  file, it has no URL, and its bytes are produced by code. So a `CanvasTexture` has no §79
  representation, a document naming one is refused by the existing unknown-resource path,
  and no scene file can ever carry megabytes of unreproducible pixels. The `ui:canvas-view`
  document carries the widget's box and `resolution`, nothing more.
- **§34 replay never records painted content.** A replay records inputs and deltas; a
  canvas repaint is neither. A recorded session replays with whatever the application paints
  on the replay run, which is correct — the simulation is identical, the pictures may not
  be, and that is the same status shading already has under §42/§43's _"render interpolation
  never feeds back into physics state"_.
- **`paint()` and `update()` are forbidden from a fixed step**, documented at both types.
  They belong to §9's render or real time domain. A repaint driven from `fixedUpdate` would
  couple an unreproducible cost to the accumulator that §10 clamps, which is a performance
  bug and a determinism smell in one.

### 4. §96: painted and decoded content is untrusted-adjacent

Three claims, each matched to an enforcement, following A-23's stance that _"a limit
defaulting to `Infinity` is documentation, not a limit"_ and that _"the CSP claim is
enforced, not asserted"_.

**Size limits are finite by default.** `CanvasTextureOptions.maximumBytes` defaults to
**64 MiB** — A-23's asset default, and exactly a 4096 × 4096 RGBA8 surface, which is also
the `maxTextureSize` most WebGL 2 devices report. `Number.POSITIVE_INFINITY` is the
explicit in-source opt-out, as it is for the four A-23 limits. `width * height * 4` is
checked at construction and re-checked on every `update()`, because the re-check is what
makes the constant-size rule of §2a enforced rather than merely documented.

**Two error paths, on A-23's own distinction.** A-23 separated
`UNTRUSTED_INPUT_REJECTED` ("hostile input") from a plain `TypeError`/`RangeError`
("malformed input the process itself built"), on the principle that _"§96 guards belong at
the text boundary, never at `validate*` — the validators take values the process itself
built, so guarding them refuses nothing an attacker controls"_. Applied here:

- A `RasterSource` an application wrote with bad dimensions is a §85 programming error →
  `RangeError`, matching `Texture`'s existing validation, with the same message shape.
- A raster source whose dimensions came from **decoded external content** — a
  network-fetched image, a video frame — is untrusted, and its refusal is
  `UNTRUSTED_INPUT_REJECTED` with `context.limitName`/`limit`/`observed`, per A-23. **No
  such source ships in this RFC** (decode is deferred, §6), so the path is specified and
  unbuilt, and the deferral is what keeps that honest rather than a stub that refuses
  nothing.

**The CSP posture is unchanged, and one sentence needs to be written down.** Nothing here
needs `eval`, `new Function`, `Blob` URLs, or `data:` scripts;
`tests/integration/security-csp.test.ts` requires no change, and per the recorded rule _"a
package that needs `eval` changes the guide first"_. The sentence worth adding, because a
reader will otherwise ask:

> A `RasterSource`'s `paint` is **application code the application imported** — a function
> value, passed to a constructor. It is not loaded content, it is not named by a scene
> document, and `CanvasTexture` accepts no URL and no module specifier.

That is RFC 0002's rule in a second place (_"untrusted content can never become a plugin …
`PluginHost.add` accepts a plugin object only"_), and it is mechanically checkable by the
same means: the raster test asserts that `CanvasTexture`'s parameter type admits no string,
and that no module reachable from `@fourjs/serialization` or `@fourjs/assets` imports the raster
module. §2a's "no §79 representation" is what makes the second assertion true by
construction rather than by discipline.

### 5. Spec placement: a new **§77a**, and one §73 amendment note

**Proposed: `### 77a. Raster Painting and Dynamic Textures`**, immediately after §77.

The §-numbering rule is frozen for 1–120, so a new section takes a letter suffix; the
question is which number it suffixes. §77 wins over the three plausible rivals:

- **§77 (Texture System)** already lists _"canvas and image-bitmap sources"_ and _"video
  textures"_ among its requirements. Raster painting is the production side of exactly those
  rows, its entire public contract is a `MaterialTexture`, and a reader looking for "how do
  pixels get into a texture" looks at §77 first. It also puts §77a in the same Part VII
  Assets group as the sections it interacts with (§76 decode, §79 serialization).
- **§55 (Sprite and Raster System)** is tempting on its title alone, but it specifies how a
  sprite _consumes_ a raster — anchors, atlases, frames, billboarding. Putting a production
  seam there would make every sprite requirement read as if it applied to painting.
- **§58 (Paints, Fills, and Strokes)** lists _"image pattern"_ as a paint, but §58 is the
  vector stack's paint model (`R-16`), and hanging raster production off a blocked
  vector-tier section would make this RFC transitively blocked on `R-24`/`R-25` for no
  reason.
- **§62 (Rendering Backends)** is where a reader would put the Canvas 2D backend, which is
  §2c's whole point about not conflating them.

Mechanically, the packet adds `"77a"` to `ALLOWED_LETTERED` in `tools/check-spec.mjs` — the
set is currently `{6a, 6b, 7a, 7b, 60a, 97a, 106a, 113a}` and an unlisted lettered section
is a gate failure, which is the frozen-numbering rule being enforced rather than trusted.

**What §77a says** (contents, not text): the raster source contract and its structural,
DOM-free discipline; the row-order and colour-space conventions and how they differ from
§77's `TextureSource`; the constant-size rule and its `R-30` dependency; the §33
display-only rule and that it is mechanically enforced; the §96 limits; and the explicit
statement that this is not a drawing API and that §62's Canvas 2D backend is a different
thing.

**§73's canvas-view row gains an amendment note**, in the shape §57's `ShaderMaterial` row
already uses — _"RFC-derived amendments carry the RFC's status"_, so it is marked
**draft, owner decision pending** and settles only if this RFC is accepted:

> **Canvas view.** The canvas view is a **skin-drawn** control, in the split `image`
> already follows: the widget owns its box, its device-pixel backing size, and a content
> revision; the `WidgetSkin` owns the texture and the quad. `@fourjs/ui` gains no drawing API
> — §73 does not require one, and the frozen package dependency matrix forbids it. The
> painting surface it draws into is §77a. _(RFC 0004, draft, owner decision pending.)_

**Amendments-table row sketch:**

| Revision | Date      | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.9      | 2026-08-… | New §77a "Raster Painting and Dynamic Textures": a structural, DOM-free raster source contract feeding §77's texture system, with the §33 rule that painted pixels are display content and never simulation input (mechanically enforced, in the pattern §40's display-only rule established), the §96 size limits, and the constant-size restriction pending §77 change notification (`R-30`). §73's canvas-view control is recorded as a skin-drawn widget requiring no drawing API in `@fourjs/ui`, correcting the staging note that said otherwise. §62's Canvas 2D backend is explicitly a separate concern and is unchanged. Frozen §1–120 numbering respected: the new section takes a letter suffix, added to `ALLOWED_LETTERED`. _(RFC 0004.)_ |

### 6. Staging

**MVP packet (S–M).** `RasterSource`, `RasterOrigin`, `CanvasTexture` in
`packages/render/src/raster.ts`, with §85 validation, §83 accounting through the existing
`noteTexture`, and the §96 limit; `CanvasViewWidget` in `@fourjs/ui` plus its `ui:canvas-view`
§79 pair; `tests/integration/raster-display-only.test.ts`; §77a and the §73 note; a guide
section carrying the browser adapter. **No backend change and no new duck-typed contract** —
the count stays at five.

**Deferred, each with the thing it waits on:**

| Deferred                                         | Waits on                                                                                                                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Video textures (§77)                             | a frame-arrival signal; `requestVideoFrameCallback` is a host concern, and the seam must stay DOM-free                                                                       |
| `ImageBitmap` / decoded-image sources (§76, §77) | `A-18`'s remaining half — the recorded generic `FetchLike<TSignal>` widening plus an injected abort factory; decoding without cancellation is the §96 row A-23 left open     |
| Resize in place                                  | `R-30` (§77 change notification), per §2a                                                                                                                                    |
| Partial / dirty-rectangle upload                 | `R-30`'s wrap and filter tier, and a sub-rectangle upload path in `TextureCache`                                                                                             |
| GPU readback (`readPixels` from a render target) | `A-11`'s pixel-picking question, which the gap analysis already says _"wants an RFC, not a packet"_; it is a different determinism argument and must not ride in on this one |
| Mipmaps and filter modes for raster surfaces     | `R-30`                                                                                                                                                                       |
| The §62 Canvas 2D backend                        | nothing in this RFC; it stays a stub by decision (§2c)                                                                                                                       |

**Size and tree-shaking expectations**, against measured precedents rather than hope:

- **`@fourjs/render`.** `CanvasTexture` is a class nobody references unless they use it, so it
  should shake out entirely. That claim needs proving, not assuming: the recorded
  counter-examples are _"a fifth compiled-at-init pipeline costs **0.75 kB gzip in every
  example bundle** — nothing reachable from a class method tree-shakes"_, _"naming one leaf
  function in `debug-draw.ts` cost 939 B gzip"_, and _"`four/application`'s runtime import
  of `@fourjs/diagnostics` costs ~0.4 kB gzip per example even with stats off"_. The rule the
  packet must respect is that nothing on the render path may statically reference the raster
  module — the backend reaches a `CanvasTexture` only through `MaterialTexture`, which it
  already does, so the discipline is satisfied by construction and must be **grep-proven**
  in the A/B style the §62 registry packet used.
- **`@fourjs/ui` is the real risk, and it has 20 bytes of headroom.** R-29 recorded ui-demo at
  **32.98 / 33 kB — twenty bytes left** — and the standing note that _"the next
  bundle-touching packet needs a proposal"_. `CanvasViewWidget` is unreferenced by ui-demo
  and should shake out; but any example that calls `registerUISerializers()` pays for the
  widget's serializer pair unconditionally, because the registry names the class. The packet
  therefore cannot land on an unmeasured claim: either the A/B measurement shows zero delta
  for ui-demo, or this packet is the one that forces the budget decision the gap analysis
  already has open as owner question 14 (_"is the budget the constraint, or the split the
  priority?"_). That is stated up front so it is not discovered at the gate.

## Alternatives

**A. Do nothing — document the application-side recipe and stop.** This is the strongest
alternative and it deserves to be argued rather than dismissed, in the shape RFC 0002's
alternative E took.

The recipe in §1 is fifteen lines, needs no engine change, and delivers the actual pixels.
It costs the application one `flipRows` helper and one `markDirty()` call. Against that, the
four benefits in §1 are honestly modest: §83 accounting for a buffer the application already
knows the size of; a dirty flag the application could keep in its own variable; a flip rule
that could live in a guide instead of in code; and the §73 widget, which is one of sixteen
controls and the only benefit the recipe genuinely cannot deliver.

And the cost side is not zero. The specification chose retained mode deliberately and
completely — §50–§52's vector stack exists so that 2D content is _scene data_, tessellated,
batched (§65), picked analytically (§71), serialized (§79), and reproducible. A painting
surface is the first sanctioned way to put content into a fourJS scene that none of those
apply to: it cannot be batched, cannot be picked, cannot be serialized, cannot be replayed,
and cannot be checked. Every one of those is a documented limitation in this RFC, which is
another way of saying the feature is an exception to five of the framework's properties. A
reasonable owner may look at that list and conclude that the right place for host-painted
pixels is the application, with the engine's answer being "here is the recipe, and here is
`R-16` when it lands".

**Where it loses, if it loses.** §73's canvas view is currently staged on a blocker that
§2b shows to be wrong, and leaving it staged means the specification names a control the
repository has decided not to build while recording an incorrect reason for it. If the
answer to Open question 1 is "raster painting is out of scope", then the honest consequence
is not "do nothing" but "**remove the canvas view from §73 by amendment**", and that is a
real decision the owner should make either way — a permanently unbuilt control with a wrong
blocker note is the worst of the three outcomes. §5's §73 note is written so it can be
inverted into a withdrawal, the way §57's `ShaderMaterial` row was.

**B. Wait for the §62 Canvas 2D backend.** Superficially attractive: `render-canvas` is
already a reserved package, and a Canvas 2D backend produces a painted canvas, so surely
raster painting falls out. It does not, in either direction. A backend draws _the scene_,
so it produces the pixels the engine already knows how to make and none of the pixels an
application wants to paint — a minimap drawn by application code is not a scene, and a chart
axis label is not a `Renderable`. Conversely, this RFC's seam does not help build the
backend: it is a read path from a host surface, and a backend needs a write path into one
plus §63's whole render-graph mapping. The two share a host canvas and nothing else (§2c).
Waiting also means waiting on an `L`-sized packet that nothing has scheduled, to unblock a
widget that needs one hundred lines.

**C. An engine-owned immediate-mode drawing API — what the recorded blocker literally
asks for.** A `PaintContext` with `fillRect`, `moveTo`, `fillText`, and the rest, living in
`@fourjs/render` or a new package, with `@fourjs/ui` drawing through it. This is the biggest
thing anyone could build here and it loses on four counts, any one sufficient. (1) It is a
second rasterizer: §50–§52 already specify a full 2D vector stack whose output is GPU
geometry, and a raster path with its own fills, strokes, joins, and dashes would duplicate
`R-16`, `R-24`, and `R-25` in a different output space, with two implementations of "what a
round join looks like" to keep agreeing. (2) `fillText` means a font rasterizer, and §56's
text tier is explicitly staged behind a shaping-engine decision that _"must be recorded by
amendment before that work begins"_ — an immediate-mode `fillText` would pre-empt that
decision by accident. (3) It is `L` at minimum and probably larger than `R-25`. (4) It buys
nothing the host does not already do better: the reason to paint imperatively is precisely
to reach the platform's 2D engine, and an engine-defined one that runs on the CPU into a
byte array would be slower and less capable than the thing it replaces.

**D. Widen `TextureSource`/`Texture` instead of adding a class.** `Texture.source` is
already assignable and already bumps `version`; let the application assign a fresh
`TextureSource` each repaint and add nothing at all. This is genuinely close to alternative
A and shares its virtues. It loses on three specifics: assigning a new source re-runs the
full §85 validation and re-does the §83 delta arithmetic every repaint, on what is by
definition a per-frame path; it allocates a source object (and usually a byte array) per
repaint, which is the allocation pattern §86's budgets exist to discourage; and it gives the
`@fourjs/ui` seam nothing, because `Texture` is as unnameable from `@fourjs/ui` as
`CanvasTexture` is. It also has no place to hang the §96 limit, the origin rule, or the
constant-size refusal, so each of those becomes prose in a guide — which is alternative A
with extra steps.

**E. Put `RasterSource` in `@fourjs/materials`, beside `MaterialTexture`.** Symmetric-looking:
`materials` is where the texture _contract_ lives, so why not the raster contract too? It
loses on what the two things are. `MaterialTexture` is declared in `materials` because
`materials` is **below** `render` and must be able to name what a material points at; the
module header says so at length. A `RasterSource` is not something a material points at —
nothing in `materials` would ever name it — and `CanvasTexture`, which is the class that
consumes it, must live where `Texture`, `resource-memory.ts`, and the `MaterialTexture`
implementation already are. Splitting the pair across two packages would put the interface
where nothing uses it and the implementation where the interface is not, for symmetry alone.

**F. A DOM-typed seam: `CanvasTexture(canvas: HTMLCanvasElement | OffscreenCanvas)`.** By
far the nicest call site — no adapter, no `readPixels`, no origin flag, and the engine could
call `getImageData` itself and get the flip right every time. It is rejected on a rule this
repository has applied five times without exception: `FetchLike`, `PointerSurface`,
`KeySurface`, `SurfaceObserver`, and `RendererOptions.canvas: unknown` are all structural
precisely so the engine runs and type-checks in Node, in a worker, and in a headless test.
`@fourjs/render` compiles with **no `lib.dom`**; naming those types would not merely be
inconsistent, it would not compile, and fixing that by adding the DOM lib would drag it into
every consumer of the backend-independent renderer interface. `TextureSource`'s own header
already refused this exact widening for this exact reason. The nicety is available anyway,
in the application, as the four-line adapter in §2a.

## Consequences

**Easier.** §73's canvas view becomes buildable, and one of the seven staged controls stops
being blocked. Dynamic textures — minimaps, gauges, procedural surfaces, chart faces —
acquire a supported path with lifecycle, accounting, and one flip rule, instead of a recipe
each application re-derives. Applications wanting §58's paints get a usable stand-in years
before `R-16` can land, and the RFC says so rather than pretending the vector stack is
imminent. §84's `textureMemory` stops under-reporting the most churn-heavy allocation an
application makes.

**Harder.** The framework acquires its first sanctioned content that is not scene data:
unbatchable, unpickable, unserializable, unreplayable, and unreproducible. Each is
documented, and together they are a real dilution of the retained-mode promise — the cost
alternative A exists to weigh. §33's envelope gains a second mechanically enforced boundary
to maintain, and a second `ALLOWED` allowlist someone must be careful about. `@fourjs/ui` gets
a tenth control against a 20-byte bundle headroom, which likely forces the budget decision
that is already open. And there will be pressure — immediately, and forever — to add
`fillRect`, because the moment an application can hand over pixels it will ask the engine to
help make them; alternative C is the answer, and it will need repeating.

**Committed to.** The seam is structural and DOM-free. The engine defines no drawing API.
Painted pixels are display content and never simulation input, enforced by test. A raster
surface's size is constant for its life. Painted content has no §79 representation. `paint`
is a value the application passed, never a name a document supplied. §62's Canvas 2D backend
is untouched and remains a reserved stub.

## Compatibility analysis

Rows in `docs/COMPATIBILITY.md` this RFC moves:

- **Public API (§90).** Additive throughout — new exports from `@fourjs/render`
  (`RasterSource`, `RasterOrigin`, `CanvasTexture`, `CanvasTextureOptions`) and `@fourjs/ui`
  (`CanvasViewWidget`, its options), re-exported through the umbrella barrels per §97a.
  **Minor**, with no exceptions: unlike RFCs 0001 and 0003, this RFC widens **no closed
  union** — not `RenderItemKind`, not `ScreenEffect`, not `Material`'s family. A
  `CanvasTexture` enters through `MaterialTexture`, which is an interface a new type
  implements rather than a union a new member joins, so no exhaustive consumer `switch`
  breaks. That is a direct consequence of R-4's seam choice and worth recording as its
  second dividend.
- **Scene format versions (§79).** **Moves, minimally.** One new node type, `ui:canvas-view`,
  carrying a box and a `resolution` — additive, so existing documents load unchanged, and a
  document containing it cannot be read by an older reader. **No resource entry, no
  manifest row, no bytes**: §3 forbids painted content from any document, and A-16's
  keys-not-payloads rule is what makes the prohibition natural rather than a special case.
- **WebGPU/WebGL feature tiers (§62).** **Unmoved.** No capability is added or required; the
  upload path is the RGBA8 2D path that already exists, and `maxTextureSize` is already
  reported and is what §4's default limit is chosen against. `render-canvas` stays a stub,
  so §62's backend ladder is unchanged.
- **Plugin API versions (§81).** Unmoved. RFC 0002's capability set is unaffected: no new
  registry is created, and there is nothing to register — a raster source is a value an
  application constructs, which is the shape RFC 0002 prefers anyway.
- **Solver adapters.** Untouched. No regeneration of the generated block in
  `docs/COMPATIBILITY.md`.

**Determinism (§33).** Covered in full in §3. Summary for the table: painted pixels sit
**outside** the envelope by construction and by an enforced import rule, in the pattern §40
established; no §33 checksum changes (the checksum is over body transforms and velocities,
and no raster value reaches one); no §34 replay format changes, and no golden moves. Two
smaller obligations land on the implementation rather than the application: `CanvasTexture`
ids come from a monotonic counter, never a clock or a random source, matching `Texture`,
`Node`, and `BufferGeometry` (§33 forbids clock-derived identity); and `update()` performs
no `Map`/`Set` enumeration, though at one buffer per texture that is trivially satisfied.

## Prototype / benchmark

None run; §95 item 6 asks for evidence _where practical_, and this is a design decision
ahead of a packet. What the packet must measure, stated now so it cannot be skipped:

1. **Bundle delta, grep-proven, in the A/B style the §62 registry packet used.** Two
   numbers: `@fourjs/render` with and without a `CanvasTexture` reference (target: zero, and
   the raster module absent from every example bundle by grep), and **ui-demo with and
   without `CanvasViewWidget` referenced** — the second against a 20-byte headroom, which is
   the number most likely to fail. If ui-demo moves at all, the packet stops and the budget
   question goes to the owner rather than being absorbed.
2. **Upload cost per repaint at three sizes** (256², 1024², 2048²): the `readPixels` copy,
   the row-reversal when `origin` is `"top-left"`, and the resulting `texSubImage2D`. The
   claim this RFC makes is that the flip is folded into a copy the engine is already making
   and is therefore near-free; that is an assertion until it is a number, and 2048² is 16 MB
   per repaint where "near-free" stops being obvious.
3. **The §83 accounting is exact**: construct, update N times, dispose, and assert
   `textureMemoryBytes` and `liveTextureCount` return to their starting values — the A-5
   property that a dropped-without-dispose resource is never silently subtracted must hold
   here too.
4. **The display-only test is a gate, not a benchmark**, and is listed under §6's MVP packet.

## Open questions

1. **Is raster painting in the product's scope at all?** This is the question, and the rest
   are details. The specification chose retained mode deliberately and completely; nothing in
   §1–§120 asks for a painting API; no gap item exists because nothing is missing against the
   text. **This RFC exists because the owner asked for it**, and the analysis owes the owner
   the observation that a well-argued "no" is available and costs nothing already built.
   Three coherent answers, and the recommendation is deliberately the middle one:
   **(a) No.** Publish the §1 recipe as a guide, and — importantly — **amend §73 to withdraw
   the canvas view**, because leaving a control staged behind a blocker §2b shows to be
   wrong is worse than not having it. **(b) Yes, at the tier proposed here**: a read seam, a
   texture, a widget, no drawing API, everything else deferred. **(c) Yes, and further**:
   alternative C's immediate-mode API, which is a large multi-packet program and would
   pre-empt §56's shaping-engine decision. _Recommendation: (b)_ — it is `S–M`, adds no
   dependency edge, widens no union, changes no backend, and its determinism story is a
   copy of one that already works. But (a) is genuinely defensible and should be chosen
   plainly if it is chosen, in the way RFC 0002's alternative E is written to be choosable.
2. **The §77a number.** §5 argues §77 over §55, §58, and §62. Confirm, since it also means
   adding `"77a"` to `ALLOWED_LETTERED` — a one-line change to a gate that exists to make
   exactly this an owner decision rather than an agent's.
3. **The `colorSpace` default differs from `TextureSource`'s on purpose** (`"srgb"` here,
   `"linear"` there). The reasoning is in §2a and it is sound, but it means two texture types
   in one package answer the same question differently, which a reader will trip over.
   Accept the difference with the note at both, or make both `"linear"` and require every
   canvas source to opt in?
4. **Should `CanvasViewWidget` ship without tier (a)?** It genuinely can: the widget names
   no texture type, so tier (b) compiles against nothing tier (a) provides, and an
   application could pair it with the §1 recipe today. Shipping it alone would close §73's
   row at the lowest possible cost — and would also be the natural consequence of answering
   question 1 with (a)-but-keep-the-widget. Worth an explicit call, because it changes what
   "accept this RFC" means.
5. **The constant-size restriction.** §2a forbids in-place resize and gates lifting it on
   `R-30`. The alternative is to allow resize now and accept the recorded §55 `frame`
   hazard (a stale frame silently sampling clamp-to-edge). Recommendation is the refusal —
   a resize is one line for the application and the hazard is silent — but a UI panel that
   resizes is the obvious first use, so the friction is real and the owner may weigh it
   differently.
6. **`update()` is application-driven; should there be a hook?** Nothing polls, by design,
   which means an application that forgets to call `update()` sees a stale texture and no
   diagnostic. A §85 development-only warning after N frames of a stale-but-invalidated
   texture would catch it, at the cost of the raster tier learning what a frame is — which
   it currently does not, and which is the same argument that keeps `menu` and `tooltip`
   staged in `@fourjs/ui` (_"a hover delay is a §9 time reading, and the loop that owns time
   lives above this package"_). Recommendation: no hook, no warning, and a prominent line in
   the guide.

## Post-acceptance corrections (2026-09-10 review pass)

Decision text left as accepted. Verified against the tree 2026-09-10:

- **§2b `static readonly typeName = "ui:canvas-view"` and "the
  typeName-enumerating test makes the pair a gate".** `CanvasViewWidget`
  deliberately carries **no `typeName`** (the `Bone` rule, RFC 0003); its §79
  identity is the node type registered by `registerUISerializers`, and the
  gate is the serializer round-trip test (`packages/fourjs/tests/scene-serializers.test.ts`).
- **Context / §2b "`widget.ts:157` states the blocker", "nine of sixteen
  controls ship".** The note was corrected on 2026-08-29 ("was wrong") and
  **ten** of sixteen ship (`packages/ui/README.md`); the old sentence survives
  only as a quotation in `canvas-view.ts`.
- **§1 motivation "§58 paint is `R-16`, no engine path at all".** R-16
  (solid paint + full stroke incl. dashes) closed 2026-08-09, this RFC's own
  date; §58's gradient/image Paint tier landed 2026-08-29 with this RFC's
  packet. The stand-in motivation is historical.
- **§3 `ALLOWED` "holds the `four` umbrella barrel".** The directory is
  `packages/fourjs` and the package is `fourJS`; the test's `"four"` entry
  never matched and passed only because the umbrella never names
  `CanvasTexture`. Fixed 2026-09-10 (`"fourjs"`).
- **§4 "`width * height * 4` re-checked on every `update()`".** The byte
  check runs in the constructor only; `update()` refuses any size *change*,
  so the check cannot be escaped (`raster.ts:361-362, 466-490`).
- **§5 amendments-row sketch "1.9".** Landed as row **1.12**, 2026-08-29; the
  §73 note settled with acceptance (no longer "draft, owner decision pending").
- **§6 deferred table.** "Dirty-rect upload waits on R-30's wrap and filter
  tier" and "mipmaps / filter modes wait on R-30": R-30 (2026-08-13), R-30b
  (mipmaps, 2026-08-21) and R-30c (map roles, 2026-09-09) have all shipped for
  `Texture`; what remains is that `CanvasTexture` declares none of the
  optional `MaterialTexture` sampler fields, and no backend has a
  sub-rectangle upload (`texSubImage2D` absent). "GPU readback waits on A-11"
  → now **RFC 0009** (draft, corrected 2026-09-10). Only in-place resize still
  waits on §77 change notification.
- **§6 "`four/application`" and "ui-demo 32.98 / 33 kB — twenty bytes".**
  Specifier is `fourJS/application`; at landing ui-demo measured
  43.63 / 44 kB with painting symbols in 0 of 9 bundles and +213 B on the twin
  for the serializer pair (MEMORY 2026-08-29); today 49.51 / 50 kB.
- **Alternative F "`@fourjs/render` compiles with no `lib.dom` … would not
  compile".** No workspace tsconfig pins `lib`; DOM-free is a seam rule the
  types keep, not a compiler guarantee (`raster.ts:29` repeats the claim).
- **Consequences "`maxTextureSize` is already reported".** Declared `0` for
  every backend; WebGL fills it after the first `initialize` (`COMPATIBILITY.md` §2).
- **Prototype "None run".** Measured at landing: bundle A/B (above); flip vs
  read at 2048² 0.96 ms / 1.32 ms, 256² 24 µs; §83 accounting asserted in
  `packages/render/tests/raster.test.ts`. The timings live in MEMORY, not
  under `benchmarks/`.
- **Context "grep returns four hits … `renderer.ts:150`".** A 2026-08-09
  snapshot; the `canvas?: unknown` note is now at `renderer.ts:321` and the
  grep also hits `raster.ts` and `assets/src/texture.ts` (A-19 decoder).
- **Compatibility.** `docs/COMPATIBILITY.md` carries no §77a / `ui:canvas-view`
  row; the "rows this RFC moves" were never written into it (its tables are
  backend/capability tables).

**Residue (open, `TODO.md` "RFC 0004 residue"):** video textures (prose in
`texture.ts` only), decoded-image *raster* sources (A-19's static loader
exists in `@fourjs/assets`; no `RasterSource` producer), in-place resize
(refused; change notification unshipped), dirty-rect upload (none),
`CanvasTexture` sampler fields (none declared), GPU readback (RFC 0009),
Canvas 2D backend (stub by decision). Plan: `docs/plans/RFC-0004-RESIDUE_PLAN.md`.
