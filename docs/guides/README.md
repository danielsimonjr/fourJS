# fourJS guides

The prose half of the §93 Documentation Plan. §93 lists nineteen documentation
items; the first six — installation and quick start, and the five worked
scenes — are carried by the root `README.md` and the example apps:

| §93 item                     | where it lives                                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| installation and quick start | root `README.md`                                                                                                                                            |
| first 2D scene               | `examples/first-2d-scene`                                                                                                                                   |
| first 3D scene               | `examples/first-3d-scene` — a `PerspectiveCamera` over `LitMaterial` meshes under one `DirectionalLight` plus scene ambient, written 2026-08-07 (see below) |
| first animated scene         | `examples/first-animated-scene` — thin §93 entry (2026-09-06) that re-exports `examples/first-2d-scene` (tweens, a clip, a timeline)                         |
| first physics scene          | `examples/first-physics-scene` — thin §93 entry (2026-09-06) that re-exports `examples/physics-playground`                                                  |
| mixed 2D/3D/physics example  | `examples/mixed-scene` — thin §93 entry (2026-09-06) that re-exports `examples/physics-playground`, which steps a 2D and a 3D world side by side            |

This table listed the four placeholder rows as though they were written until 2026-08-05.
The first 3D scene's row itself read as an empty directory until 2026-08-07, when that
example was written. The remaining three §93 names were `.gitkeep` until 2026-09-06,
when each gained a real `main.ts` that imports its stand-in — dated in
`docs/AUDIT-120.md` as **S-8**, now closed. They are not independently authored
scenes; they exist so the §93 names resolve to a buildable site.

The remaining thirteen items are these guides. Read them in this order — each
assumes the ones above it:

1. **[The scene graph and transforms](scene-graph-and-transforms.md)** — nodes,
   groups, components (§6a), events (§6b), and the transform system (§7).
2. **[Cameras and coordinate conversion](cameras-and-coordinate-conversion.md)** —
   §47 cameras, §48 viewports, and the full pixel → NDC → world → pick path
   (§71/§72), including pointer input, dragging, `hitTestMode = "gpu"`,
   `registerPickingPipeline` / `createPickingService`, and
   `createPickProvider` / `PointerInput.pickProvider`. (WebGL 2's other
   registration seams — `registerShadowPipeline`, `registerEffectPipeline`,
   `registerParticlePipeline`, `registerStandardPipeline`, 2026-09-11 — are
   listed in
   [materials and the render graph](materials-and-render-graph.md).)
3. **[Fixed-step simulation](fixed-step-simulation.md)** — §9 time domains, the
   §10 accumulator, §39 system ordering, and §43 interpolated rendering
   (including skin palettes via `Skeleton.update(..., worldOf)`).
4. **[Transform authority](transform-authority.md)** — §42's one-owner rule,
   authority handovers, and the §19 physics-animation blending pipeline.
5. **[Materials and the render graph](materials-and-render-graph.md)** — the
   five shipped material classes over §57's complete base (§59's
   `StandardMaterial` and §60's `NodeMaterial` included), render lists
   (`buildInterpolatedRenderList` also refreshes §43 skin palettes),
   opt-in §65 batching, and the shipped §63 render graph with its §69/§70
   tiers. (Until 2026-08-29 this entry read "the shipped unlit/sprite
   material tier … and the honest state of the §63 render graph", describing
   the guide's pre-rewrite staleness.)
6. **[Collision filtering](collision-filtering.md)** — bodies, colliders,
   physics materials, groups and masks (§24), events (§29), and queries (§30).
7. **[Units and numerical stability](units-and-numerical-stability.md)** —
   §7a/§40 unit conventions and the §41 stability guidance, with the measured
   numbers behind it.
8. **[Workers and cross-origin isolation](workers-and-cross-origin-isolation.md)** —
   §88's three threading modes, what ships today (main-thread), and the
   COOP/COEP deployment requirement.
9. **[Performance optimization](performance-optimization.md)** — §86 targets,
   what the committed benchmarks actually measured, and the practices the
   engine's own hot paths use.
10. **[Custom shaders](custom-shaders.md)** — the landed §60 node-material
    system (RFC 0001): shader graphs, `NodeMaterialBuilder`, screen-domain
    graph effects, per-backend registration, and what stays deferred. (Until
    2026-08-29 this entry read "the honest state of §60 … today and what is
    staged", describing the pre-landing guide.)
11. **[Custom solver adapters](custom-solver-adapters.md)** — the §37
    `PhysicsWorldAdapter` contract, capabilities, and the access seams the
    shipped adapters implement.
12. **[The engineering dashboard](engineering-dashboard.md)** — motors, PID
    control, limit switches, and live instrumentation (§119's dashboard half).
13. **[The digital twin](digital-twin.md)** — serialization (§79), snapshots
    and replay (§34), determinism (§33), and assets (§76), composed.

A fourteenth guide sits alongside those thirteen. It is not one of §93's
nineteen documentation items; §96 asks for the documentation itself, in its
"documented content-security-policy behavior" requirement, and the answer reads
as a guide:

14. **[Security and untrusted content](security-and-untrusted-content.md)** —
    §96's seven requirements with an honest met/partial/absent table, the
    input-size limits and load deadline on `AssetManager` (§76), the text-length
    and nesting bounds on the §79 and §34 document decoders, and the CSP
    posture, which `tests/integration/security-csp.test.ts` enforces rather than
    asserts.

A fifteenth carries the §77a browser-adapter recipe RFC 0004 promised a guide
for (until 2026-08-29 it lived only in `raster.ts`'s module header):

15. **[Raster painting and dynamic textures](raster-painting.md)** — §77a's
    `RasterSource`/`CanvasTexture` seam, the DOM-free browser adapter, the
    "nothing polls — call `update()` yourself" rule, and the §33 display-only
    boundary painted pixels live under.

## Conventions every guide assumes

- The world is **right-handed, Y-up, in 2D and 3D alike** (§7a). 2D gravity is
  negative Y. Angles are **radians**; every engine time is **seconds** — tween
  and timeline durations included, never milliseconds.
- Components attach with `node.addComponent(...)`, one per type per node (§6a).
- Simulation advances in fixed steps; rendering interpolates between them
  (§10, §43).
- Exactly one system owns any node's transform at a time (§42).
- Imports use the umbrella package's subpaths, exactly as the examples do:

  ```ts
  import { Application } from "fourJS/application";
  import { Group, OrthographicCamera } from "fourJS/scene";
  import { Vector3 } from "fourJS/math";
  ```

Section references like "§42" mean `docs/SPECIFICATION.md` numbering. Every
code sample in these guides is written against the implemented API surface
(`docs/Architecture/package-export-surfaces.json`) and modeled on the example
apps; where a §93 topic covers something not yet implemented, the guide says
so and cites the staging note instead of pretending.

## Verified from outside

A short dogfooding checklist. These surfaces already ship; the job is to
drive them as a reader would, not to re-implement them. Hosted demos live
under `/examples/<name>/` on Pages; browser gates live in `tests/browser/`.

| Surface | Where to look |
| ------- | ------------- |
| WebGL 2 | `examples/first-2d-scene`, `examples/first-3d-scene` (every Pages demo) |
| WebGPU | shipped backend; no Pages demo calls `registerWebgpuRenderer()` (the flagship registers WebGL only). `tests/integration/backend-selection.test.ts` and `@fourjs/render-webgpu` |
| Tweens / clips / timelines | `examples/first-2d-scene` / `examples/first-animated-scene`; `tests/browser/animation.spec.ts` |
| glTF | no example site; `tests/browser/gltf.spec.ts` loads the committed fixture through the real loader |
| UI | `examples/ui-demo`; `tests/browser/ui.spec.ts` |
| Input / picking / dragging | `examples/first-2d-scene`; `tests/browser/interaction.spec.ts`. First-person: `examples/character-controller`. GPU/pixel: `registerPickingPipeline` + `createPickProvider` in [cameras-and-coordinate-conversion](cameras-and-coordinate-conversion.md); `tests/browser/picking.spec.ts`. Skinned GPU pick: `tests/integration/skinned-gpu-picking.test.ts` (WebGL `SkinnedIdProgram`; WebGPU private skinned id pipeline) |
| Particles | `examples/particles-demo`; `tests/browser/particles.spec.ts` |
| Mixed 2D / 3D / physics | `examples/mixed-scene` / `examples/physics-playground` (a 2D world and a 3D world side by side); the §118 flagship (2D + 3D in **one** scene) |
| Text / §56 | `examples/first-2d-scene`; `tests/browser/text.spec.ts`. `buildGlyphAtlas` lives on `fourJS/text`; the `Text` node is imported from `fourJS`, not that subpath |
| Scene save / §79 + §34 snapshot | `examples/flagship/motor-digital-twin`; [digital-twin](digital-twin.md). `registerSceneNodeTypes()` then `serializeScene` / `instantiateScene` — `createDefaultComponentSerializers()` alone refuses a `Renderable`. `PhysicsWorld.createSnapshot()` is the solver half |
| §43 interpolated skin palettes | `Skeleton.update(skinRoot, worldOf?)` + `buildInterpolatedRenderList` — local poses interpolate, then the palette product; palettes are never matrix-lerped. [materials-and-render-graph](materials-and-render-graph.md), [fixed-step-simulation](fixed-step-simulation.md). Consumer check: `tests/integration/interpolated-skin-palettes.test.ts` |
| WebGL / WebGPU skinned GPU picking | `registerPickingPipeline` + `registerSkinningPipeline` then `createPickingService` — WebGL draws the deformed silhouette (`SkinnedIdProgram`, live palette); WebGPU draws the same silhouette through a private skinned id pipeline. [cameras-and-coordinate-conversion](cameras-and-coordinate-conversion.md). Consumer check: `tests/integration/skinned-gpu-picking.test.ts` |

## Beside the guides

Not a §93 guide, but the document a guide sends you to when the question is
"does this work here?":

| Document                                    | What it carries                                                                                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Compatibility tables](../COMPATIBILITY.md) | §90's five tables — browser and runtime support (tested versus expected), §62 render-backend tiers, the solver adapters (generated from their own declarations), format versions, and the plugin API |
