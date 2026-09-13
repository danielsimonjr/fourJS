# RFC 0005: Pixel and GPU-identifier picking (§71)

- **Status:** accepted (owner, 2026-08-21 — "Continue with the remaining WPs and the RFCs"; the recommended dispositions of the flagged questions are adopted)
- **Date:** 2026-08-21
- **Owner decision:** accepted (2026-08-21); implemented 2026-08-29 (WebGL, analytic tier A-11), 2026-09-09 (WebGPU `PickingService`, particle ids, WebGL skinned ids, §72 `PickProvider` dispatch, §86 measurements); residue (WebGPU skinned id pass) closed 2026-09-10 (#91). **No spec amendments-table row was added until revision 1.16 (2026-09-11)** — dispositions live in source and MEMORY only (see corrections below).
- **Spec sections affected:** §71 (primary), §6b, §33, §34, §45, §47, §48, §55, §61, §62, §63, §72, §73, §85, §89, §90, §92, §96, §98

## Context

Gap `A-11` is filed against §71 and has been half-closed since 2026-08-09. Its addendum
states the split this RFC exists to resolve:

> the `R-23` half fell — every §50 shape answers `toPath()` with a §51 `Path`, so analytic
> hit testing has its geometry. Still blocked on the pixel/GPU-id half: a render target
> `@fourjs/input` may not import. Wants an RFC, not a packet.

§71 asks for one unified picking API over seven strategies:

> analytic primitive testing; bounding-volume testing; path geometry testing; ray/triangle
> intersection; **pixel-alpha testing**; **GPU identifier buffer**; custom callbacks.
>
> ```ts
> node.hitTestMode = "bounds" | "geometry" | "pixel" | "gpu" | "custom";
> ```
>
> The engine should select the cheapest valid method by default.

### What exists today, verified

- `packages/input/src/pick.ts` (471 lines) ships **exactly one** of the seven: the
  bounding-volume tier. `pick(camera, ndcX, ndcY, pickables, hits)` casts a camera ray from
  a normalized device coordinate and tests it against a per-candidate **local** AABB
  (the ray is transformed into local space, so the test is on the true oriented box).
- The candidate list is passed in, not read off the scene, and the module says why:
  `@fourjs/input` depends on `core`, `math`, `scene` only (plan §3.1), so it cannot see
  `Renderable` or `BufferGeometry` and could not discover a node's bounds if it wanted to.
  The `Pickable` record — `{ node, boundsMin, boundsMax }` — is a **structural** candidate,
  which is why a UI rectangle (§73), a collider AABB (§21) and a hot zone with no drawn
  geometry are all pickable through the same call.
- `node.hitTestMode` **does not exist**. `Node` has no such field, and pick.ts records the
  reason: a mode selector between one method is not a selector. "Absent from the candidate
  list" is today's honest spelling of `hitTestMode = "none"`.
- The analytic tier (`"geometry"` for §50 shapes) is **unblocked but unwritten**: `toPath()`
  landed with R-23/R-24, so the geometry an analytic test needs is reachable — by a layer
  that may import `@fourjs/geometry`, which `@fourjs/input` still may not.
- `readPixels` is **staged, not implemented, in both packages that would own it**. §61
  types it `readPixels?(target: RenderTarget, region?: Rectangle2): Promise<ArrayBuffer>`;
  `packages/render/src/renderer.ts` carries it as a typed TODO ("needs `Rectangle2`, which
  `@fourjs/math` does not define; §92's visual regression tier is its first consumer");
  `packages/render-webgl/src/gl-render-target.ts` says the same from the backend side
  ("one entry point here, but `@fourjs/math` has no `Rectangle2`").
- Render targets themselves **do** exist (R-4, 2026-08-07): `RenderTarget` is a CPU-side
  descriptor with an id and a version, `colorTexture` satisfies `MaterialTexture`, depth
  _textures_ landed with R-18, stencil with R-7. Nothing about the target substrate blocks
  an id-buffer pass.

### The edge that forces an RFC rather than a packet

Plan §3.1 is frozen and gives `input` exactly `core, math, scene`. A GPU-id or pixel-alpha
pick needs, at minimum, a render target, a pass that draws into it, and a read-back — all
three of which live in `@fourjs/render` and a backend. So the strategy §71 names cannot be
implemented in the package §98 charters as _"input sources and event propagation (§72),
picking front end (§71)"_, and the fix is not an import: `input → render` would put input
**below** the renderer in the layering, and `ui → input` would drag every UI application
into the renderer graph.

This is the same shape as three settled precedents, which is why this RFC is short on
invention:

1. **`FetchLike`** — `@fourjs/assets` names a _shape_ (`fetch`-compatible), the host supplies
   a value, the browser adapter is five lines in the application.
2. **`SurfaceSizedCamera`** — `Application.resize` feeds any camera with a `setSurfaceSize`
   method rather than testing `camera instanceof ScreenCamera`, so §47's custom projection
   camera opts in without `four` naming it, and the feature costs **0 B** where unused.
3. **The A-8 auto-selection registries** (2026-08-07) — with their binding rule:
   _"Explicit registration calls, never side-effect imports — forced by
   `"sideEffects": false` on all 24 packages. **Applies to every future registry in this
   repo**"_, and _"`resolveRenderer`/`resolveSolver` must never statically reference their
   registry class"_.

### One finding that changes the design before it is written

**A node's id is a string, not a number.** `Node.id` is `node-<n>` (§6, §33: a counter, not
a random id, so two identical construction sequences produce identical ids). An RGBA8 id
buffer stores 32 bits per texel. `"node-1234"` cannot be written to a pixel.

So an id-buffer pass cannot encode `node.id`; it must encode a **dense integer index into a
per-pass table**, and the table's ordering is a §33 determinism obligation, not an
implementation detail. This is stated here because it is the single most likely thing to be
got wrong by an implementer who assumes the id is numeric.

## Proposed decision

**Add a picking _service_ on the render side, and hand it to input as a structural
provider. Do not give `@fourjs/input` a render dependency, and do not give `@fourjs/render` an
input dependency.**

Four parts.

### 1. `@fourjs/render` gains `PickingService` (§71's `"gpu"` and `"pixel"` tiers)

A renderer-adjacent object that owns an offscreen `RenderTarget`, draws one id pass into it,
and reads it back. It is constructed with a renderer, exactly like the render graph, and it
is **never** referenced statically by `Application` (the A-8 lazily-created-module-`let`
discipline applies verbatim: an application that never picks by pixel must carry 0 B of
this).

```ts
// @fourjs/render — sketch, not final signatures
export interface PickRequest {
  /** The view the pick is against (§48); its camera supplies the projection. */
  readonly viewport: Viewport;
  /** Normalized device coordinate, the same input `@fourjs/input`'s ray pick takes. */
  readonly ndcX: number;
  readonly ndcY: number;
}

export interface PickResult {
  /** `Node.id` of the front-most candidate under the point, or `undefined`. */
  readonly nodeId: string | undefined;
  /** Frame index the id buffer was produced in — see §4 below on staleness. */
  readonly frame: number;
}

export interface PickingService extends Disposable {
  /** Renders the id pass for `scene`/`viewport` into the service's own target. */
  update(scene: Scene, viewport: Viewport): void;
  /** Reads back one texel. Async, always — see "sync vs async" below. */
  pick(request: PickRequest): Promise<PickResult>;
}
```

`nodeId` is a **string** — the service owns the index↔id table and never leaks the integer
it wrote into the texel. Callers get the identity §6 defines; the encoding stays internal
and can change (RGBA8 → R32UI on WebGPU) without a public break.

### 2. The seam `@fourjs/input` sees is structural and render-free

```ts
// @fourjs/input — the whole of the new surface
export interface PickProvider {
  pick(ndcX: number, ndcY: number): Promise<string | undefined>;
}
```

That is the entire contract: two numbers in, a node id out, asynchronously. It names no
render type, no target, no texture, no `Scene`, no `Viewport` — so `@fourjs/input` gains **no
new dependency**, and the four-line adapter that closes over a `PickingService` and a
`Viewport` lives in the application (or in `four`, which may import both). A test can
satisfy `PickProvider` with a `Map` lookup and no GPU at all, exactly as `TextureSource`
lets a test build a 2×2 checkerboard with no browser.

`@fourjs/input`'s existing synchronous `pick()` is **not changed and not deprecated**. The
bounds tier stays the cheap default; the provider is what a pointer handler consults when
the bounds tier is not precise enough.

### 3. The pass encodes a table index, and the table's order is §33-fixed

The pass draws the same render list the frame draws, with the material replaced by a flat
id shader. The value written is the candidate's **index in the pass's candidate list**,
+1 so that `0` is unambiguously "nothing" (the target clears to `0`). The candidate list is
built in **scene traversal order** — the same order `resolveWorldTransforms` walks and the
same order §33 already relies on for checksums — never in a hash or set iteration order.

RGBA8 gives 2³²−1 addressable candidates, which is not the limit that matters; the limit
that matters is that a pass with more candidates than the table can express must **refuse**
(§85), not wrap. `FourError("INVALID_APPLICATION_STATE")` with the count in the context.

### 4. The contract is asynchronous, and the result is honestly frame-late

WebGL 2's `readPixels` against the currently bound framebuffer is a **synchronous stall**:
it blocks the CPU until the GPU has finished the frame. A synchronous `pick()` is therefore
implementable and is a performance trap that would be discovered by users, not by us. WebGL 2
does have the non-stalling path — `readPixels` into a `PIXEL_PACK_BUFFER`, then
`clientWaitSync` on a fence — and WebGPU has `mapAsync` on a mapped buffer. Both are
asynchronous, so:

- `pick()` returns a `Promise`, on **every** backend, including any future one that could
  answer synchronously. A capability tier that changes an API's _shape_ per backend is the
  thing §62 exists to avoid.
- The result carries the `frame` its id buffer came from. A pick resolved one frame late is
  correct for the picture the user actually clicked on and stale for the picture now on
  screen; which of those an application wants is an application decision, and the field is
  what lets it tell.
- `PickResult` therefore reports identity, not a hit _point_. A world-space intersection
  from a depth read-back is deliberately not in this tier — see Alternatives (C).

### 5. `node.hitTestMode` arrives with the second strategy, not with this RFC

§71's field becomes meaningful once there is more than one method to select between, and
the honest MVP order is: bounds (ships) → analytic/`"geometry"` (unblocked, a packet) →
`"pixel"`/`"gpu"` (this RFC). Adding the field now would be adding a selector over one
option and a promise that "the engine should select the cheapest valid method by default"
with nothing to select. **Recommendation: the analytic packet adds the field, this one
adds two of its values.** Owner question 3 puts the alternative.

## Alternatives

**A. Give `@fourjs/input` a dependency on `@fourjs/render`.** Loses on §3.1, which is frozen,
and on layering: `ui → input → render` puts the renderer under every UI application. It
also breaks the property that makes pick.ts good — a `Pickable` need not be drawable.

**B. Put picking entirely in `@fourjs/four` (the umbrella).** Workable, and it is where the
_wiring_ goes. But the pass itself is a render pass — it needs the render list, the
backend's program cache, and the target — and `four` may not reach into `render-webgl`'s
internals any more than input may. The service belongs beside the graph that already owns
those; only the composition belongs in `four`.

**C. Depth read-back + ray refinement instead of an id buffer.** Reading the depth texture
(R-18 landed depth _textures_, so this is reachable) and unprojecting gives a world-space
**point**, which is what dragging wants. It does not give **identity**, which is what
picking is; recovering identity from a point means the analytic tier again. It is a genuine
follow-on tier for §72's drag plane, not a substitute, and it should be a separate packet
once `Rectangle2` exists. Deferred, with the reason recorded rather than assumed.

**D. Pixel-alpha testing as a CPU-side sprite operation, no GPU at all.** §71 lists
`"pixel"` and `"gpu"` as separate strategies, and `"pixel"` on a §55 sprite really is a
CPU question: sample the texture's alpha at the hit uv. This is much cheaper and needs
**no renderer** — only a `TextureSource`'s `data`, which is already CPU-side. It is a real
alternative for the sprite case and a non-answer for meshes and particles.
**This RFC recommends doing D as well, in `@fourjs/input`, as a `Pickable` extension** — it
costs no new edge — and keeping the id buffer for the cases D cannot serve.

**E. Do nothing; bounds plus analytic is enough for the MVP.** §120's MVP scope is
"WebGL 2 only, one solver adapter, basic 2D/3D primitives", and bounds + analytic covers
every §50 shape and every UI rectangle. Honest and defensible. The cases it leaves broken
are exactly: a mesh with concave silhouette, a particle system (§27 — no per-particle node
to test), pixel-accurate UI over an image, and any node whose visible shape is produced by
a shader rather than by geometry. If the owner takes E, this RFC becomes a recorded
deferral with the seam already decided, which is still worth having.

## Consequences

**Easier.** Meshes, particles, and shader-shaped content become pickable at all. Picking
precision stops being a function of what geometry the input package can see. The
`PickProvider` seam makes picking testable headlessly. §73's pixel-accurate UI hit testing
gets an answer that does not require `@fourjs/ui` to grow a renderer edge.

**Harder.** Picking acquires a frame of latency and a second render pass whose cost is
proportional to the render list — meaning §86 gains a row and the pass must be opt-in per
frame, not standing. §34's replay gains a surface that must be excluded from checksums (a
pick is an _input_, and the id table is a per-frame artifact — neither belongs in a §33
digest). Context loss (§61) now has one more renderer-owned resource to rebuild, which is
precisely the property R-4 argued against creating; here it is unavoidable, because a pass
target genuinely cannot exist before a renderer.

**Committed to.** An asynchronous picking API forever, on every backend. A public
`nodeId: string` result that hides the encoding. Traversal-order candidate tables as a §33
obligation.

## Compatibility analysis

- **Public API (§90 table 1):** additive. New exports in `@fourjs/render`
  (`PickingService`, `PickRequest`, `PickResult`) and one new interface in `@fourjs/input`
  (`PickProvider`). `pick()`'s existing signature is untouched.
- **Scene format (§90 table 2):** unchanged, **unless** owner question 3 goes the other way
  and `node.hitTestMode` ships in this RFC — a new serialized `Node` field is a §79/§80
  migration row.
- **Solver adapters:** unaffected.
- **Plugin API:** unaffected today; if RFC 0002 is accepted, "picking strategies" is a
  candidate registration point and should be listed there rather than invented here.
- **§62 capability tiers:** gains a row. WebGPU answers via `mapAsync`; WebGL 2 answers via
  pixel-pack-buffer + fence, with the stalling `readPixels` as the fallback when
  `PIXEL_PACK_BUFFER` is unavailable; Canvas 2D and SVG have **no** id-buffer tier at all
  and must say so rather than silently degrading to bounds.
- **`docs/COMPATIBILITY.md`:** the §71 row moves from "bounds only" to "bounds + gpu/pixel
  (WebGPU, WebGL 2)".
- **Prerequisite:** `Rectangle2` in `@fourjs/math`. §61's `readPixels(target, region?)`
  cannot be typed without it, and two packages already carry the staging note. This RFC
  does **not** claim that packet; it names it as a hard dependency.

## §33 / §85 / §96 considerations

**§33 (determinism).** Three obligations, all of them about the _table_, not the pixels:
(1) the candidate list is built in traversal order, never in `Set`/`Map` iteration order
over a container the pass happens to hold; (2) the index↔id table is rebuilt per pass and
never carried across frames, so a node added mid-frame cannot shift another node's index
retroactively; (3) **a pick result never enters a checksum**. A pick is a user input; §34
records inputs as opaque JSON and replays them, and an application that drives simulation
from a pick must record the resulting _action_, not the pick. The GPU read-back is not
reproducible across drivers and must never be treated as if it were.

**§85 (validation).** Refuse, do not clamp: a `ndcX`/`ndcY` outside `[-1, 1]`, a viewport
with zero area, a candidate count that exceeds the encoding, a `pick()` on a disposed
service, and a `pick()` before any `update()` (there is no id buffer to read — a stale
`undefined` would be indistinguishable from "nothing there"). All `FourError` with §89
codes, all from the call that can see the mistake.

**§96 (security).** Two real items. (1) An id buffer is a **read-back of rendered content**,
which is the classic cross-origin texture leak: if the scene draws a texture from an
untainted-but-cross-origin source, `readPixels` is how that content escapes. The pass must
therefore refuse to run — or the service must refuse to construct — against a target whose
inputs include a tainted source, and the honest MVP position is to state the hazard and let
the browser's own canvas-tainting rules do the enforcing (they already will, by throwing on
read-back). (2) A node id in the result is an internal identifier, and §96's untrusted-content
rule applies: an application that echoes it into a DOM string is doing that on its own head,
but the id format (`node-<n>`) is deliberately not user-controlled.

## Prototype / benchmark

None run; this is a design RFC and the prerequisite (`Rectangle2`, `readPixels`) does not
exist yet. What the implementing packet must measure, in the shape §86 already uses:

1. **Zero cost when unused** — grep the example bundles for the service's symbols; an
   application that never picks by pixel carries 0 B. This is the A-8 discipline and the
   thing most likely to regress.
2. **Pass cost** — one id pass against the flagship scene, as a §86 row, at 1× and at the
   render list sizes R-8's culling suite already uses.
3. **Latency, honestly reported** — frames between `update()` and a resolved `pick()`, on
   the fence path and on the stalling path, so the "one frame late" claim above is a
   measurement rather than an assumption.

## Open questions

1. **Does `PickingService` live in `@fourjs/render` or in a backend?** The pass needs the
   backend's program cache and its framebuffer, which argues for `render-webgl`; the _type_
   must be backend-neutral, which argues for `@fourjs/render`. The render-graph precedent
   splits exactly this way (interface in `render`, execution in the backend) and this RFC
   assumes the split — but it means the service is an interface in one package and a class
   in another, and the owner may prefer one concrete home for the MVP's single backend.
2. **Is `PickProvider` the right seam, or should input not know about picking-by-pixel at
   all?** The alternative is that the application consults the service directly in its
   pointer handler and `@fourjs/input` gains nothing. That is _less_ API and arguably more
   honest — but it means §72's propagation (capture → target → bubble) cannot dispatch on a
   pixel-picked target without the application re-implementing it. Recommendation: keep
   `PickProvider`, because event propagation is the thing input is for.
3. **Does `node.hitTestMode` ship here or with the analytic packet?** This RFC recommends
   the analytic packet (see §5 above). The counter-argument is that the field is §71's
   _stated_ public API and its absence is currently a silent spec divergence, which the
   analytic packet may not be scheduled to fix soon. If the owner wants the field now, it is
   a §79 serialized-field addition and a §90 scene-format row.
4. **Alternative D (CPU pixel-alpha for sprites) — separate RFC, this packet, or never?**
   It needs no new edge and it answers §71's `"pixel"` for the most common 2D case at a
   fraction of the cost. Recommendation: fold it into this RFC's scope as a `@fourjs/input`
   extension. It is only listed as a question because doing so makes one RFC cover two
   strategies with very different mechanics.
5. **Does the `Rectangle2` prerequisite gate this, or does the service read back through a
   backend-private path?** The service reads one texel, not a region, so it could bypass
   §61's `readPixels` entirely and never need `Rectangle2`. That gets picking shipped sooner
   and leaves §61's optional member still unimplemented — which is either pragmatic or a
   second read-back path to maintain, and the owner should say which.
6. **Should Canvas 2D / SVG declare the tier absent, or emulate it?** SVG has native hit
   testing and Canvas 2D has `isPointInPath`; both could answer `"pixel"` natively and
   _better_ than an id buffer. Declaring the tier absent is honest and simple; emulating it
   means §71's result quality varies by backend in a way §62's tiers would have to document.

## Post-acceptance corrections (2026-09-10 review pass)

Decision text left as accepted. The Context section is a 2026-08-21
snapshot; everything it calls absent has since landed. Verified 2026-09-10:

- **Spec.** No amendments-table row exists for this RFC; §71 still lists
  `"custom"` and §86 has no picking row (`benchmarks/README.md` proposes
  one). Owner action: add the row, or record here that the spec is not
  amended.
- **Context "`pick.ts` (471 lines) ships exactly one of the seven",
  "`node.hitTestMode` does not exist", "analytic tier unwritten",
  "`readPixels` staged", "`Rectangle2` does not exist".** All landed
  2026-08-29: `pick.ts` ships bounds, `alphaMask`, `triangles` (ray/triangle)
  and `hitTestMode` dispatch plus `PickProvider`; `HitTestMode =
  "bounds" | "geometry" | "pixel" | "gpu"` on `Node` (`null` = engine
  chooses; `"custom"` deliberately absent) — all four values arrived
  together, not "two of them"; `Rectangle2` in `@fourjs/math`;
  `Renderer.readPixels?` with the §61 contract.
- **§1 sketch.** Shipped shapes differ (marked "sketch, not final"):
  `update(root: Node, view: Viewport)`; `PickingService` has `disposed` +
  `dispose()` rather than `extends Disposable`; `frame` is the service's
  update ordinal from 1 (`packages/render/src/picking.ts`).
- **§1 / Prototype "costs 0 B where unused".** Pass and service are 0 B; the
  `createPickingService` seam rides every `WebglRenderer` bundle at
  +0.15–0.17 kB gzip, +~0.4 kB where `pick()` rides (MEMORY 2026-08-29).
- **Alternative D "recommended as well".** Landed: `PickableAlphaMask`
  composes under `null` mode.
- **Compatibility.** Additive surface is larger than listed: `MAX_PICK_CANDIDATES`,
  `assertEncodableCandidateCount`, `collectPickCandidates`, `encodePickId`,
  `decodePickId`, `supportsPicking`, `Renderer.createPickingService?`;
  input adds `PickableAlphaMask`, `PickableTriangles`,
  `PointerInputOptions.pickProvider`; scene adds `HitTestMode`.
  **§79 did move:** `hitTestMode` is serialized (unset scenes byte-identical).
  §62 gains no `RendererCapabilities` row — the capability is the presence of
  `createPickingService` (Q6 adopted). The real `COMPATIBILITY.md` §71 row
  reads "id-buffer + fence read-back, behind `registerPickingPipeline()` …
  one id per `Renderable`, one id per particle emitter, deformed silhouette
  for skinned meshes (`SkinnedIdProgram`, 2026-09-09)". The `Rectangle2`
  prerequisite is satisfied, and the service reads its texel through its own
  PBO/fence path, never through `Renderer.readPixels`. RFC 0002 never gained
  the "picking strategies" registration point this RFC asked for.
- **Q2 "§72 propagation cannot dispatch".** Landed 2026-09-09:
  `PointerInputOptions.pickProvider`, per-pointer queueing, ray-tier fallback.
- **Prototype "None run" and "one frame late".** `benchmarks/pick-latency.mjs`
  (2026-09-09): 64 nodes id pass 1.025× the list; 10k 3.56×; 100k 4.27×;
  fence 0.0025 ms vs stall 0.0008 ms with `extraFrames` 0 — all on the
  counting-GL seam (`hostGpu.source: "none"`). "One frame late" is
  **unmeasured on real hardware**. The results file's caveat "WebGPU has no
  `PickingService`" predates the same-day landing and should be re-recorded.
- **Wrong when written:** "if RFC 0002 is accepted" — it was accepted in the
  same decision, the same day.

**Residue: closed 2026-09-10 (#91).** The WebGPU skinned id pass landed as a
private pipeline on `WebgpuPickingService` (`wgpu-picking.ts`: `skinMatrix()`
plus the 3072-byte palette group at bind group 1, fail-once skip, never
bind-pose). Spec revision 1.16 records §71's shipped form. The plan written for
it (`docs/plans/RFC-0005-RESIDUE_PLAN.md`) is retained as a record only.
