# fourJS compatibility tables

§90 requires the project to publish compatibility tables for five things:
browser support, WebGPU/WebGL feature tiers, physics solver adapters, scene
format versions, and plugin API versions. This document is those five, and it
is the first time they have been published — until 2026-08-07 every reference
to them in the repository was forward-looking (`docs/GAP ANALYSIS v0.md`,
A-26).

Two rules govern everything below.

**A row says what is true today, not what is planned.** Where a §90 row has no
implementation behind it, the row says so and names the gap item, rather than
describing an intention in the present tense. "Supported" is reserved for
things something in this repository actually exercises.

**The solver-adapter and renderer-backend tables are generated.** §37 says
capability declarations "drive `solver: "auto"` selection (§20) and the
compatibility tables of §90"; §62 says the same of `RendererCapabilities`.
Section 2's live-declaration table and section 3 are emitted from constructed
instances by `tools/generate-compatibility.mjs` and verified by its `--check`
mode. A hand-maintained copy of a declaration that already exists is exactly
how a compatibility table goes quietly wrong.

Nothing is published to npm yet: all 24 workspace packages sit at version
`0.0.0`. §90's semantic-versioning contract (section 6) therefore governs
releases that have not happened; the format and API versions in sections 3–4
exist today and are the ones a document on disk has to match.

**Decision 2026-09-06 — publish the reserved stubs as real 0.x packages.** The
four reserved directories (`physics-box2d`, `physics-soft`, `render-canvas`,
`render-svg`) already exist, build, and export `PACKAGE_NAME`; the umbrella
depends on them and re-exports each as a subpath, so Changesets cannot
`ignore` them without also skipping `four` (see `.changeset/README.md`).
Dropping the subpaths would break §98; optional peers would push the
resolution problem onto every consumer. A stub that says "reserved; not
implemented" in its README is the honest 0.x package. `NPM_TOKEN` remains an
owner secret and is not in this repository. GitHub Pages is already the
docs-workflow deploy target (`.github/workflows/docs.yml`).

**TypeScript 7 is the ROOT compiler, and the root now has only one** (2026-09-08).
This paragraph twice said something weaker and both readings were wrong: first *"do
not lift the pin until TypeDoc accepts 7.x"*, which put the compiler on another
project's release schedule; then *"two TypeScripts, deliberately"*, which was true
for a day.

- **Root: `typescript@7.0.2`.** Builds, type-checks, and backs the linter. Verified
  from a clean tree: 24 packages, 315 `.d.ts` emitted, 7,246 tests across 282 files.
- **Linting: `oxlint` + `oxlint-tsgolint`.** ESLint and typescript-eslint are no
  longer dependencies. Oxlint's type-aware mode *requires* TypeScript 7 — it is
  `typescript-go` underneath — so the linter went from blocking the migration to
  depending on it. `.oxlintrc.json` reproduces all 47 `recommendedTypeChecked`
  rules plus the two repo-specific guards; lint runs in ~13 s where ESLint took
  3 m 56 s.
- **Docs: `tools/docs`**, a workspace package pinning `typedoc@0.28.20` and
  `typescript@6.0.3` as **direct** dependencies. TypeDoc consumes the legacy
  compiler API that TS 7 removed, and its own issue
  ([TypeStrong/typedoc#3098](https://github.com/TypeStrong/typedoc/issues/3098)) is
  open with no timeline, so it is isolated rather than waited on. Docs still build
  at 0 errors / 24 warnings — unchanged from before the move.
- **`typecheck:ts6` remains a CI gate.** TypeDoc still parses this source with 6.0.3,
  so two compilers read the code and can disagree — 6.0 rejects the `.ts` import
  extensions in three §93 examples that 5.9 and 7.0 accept. The gate turns that into
  a red build instead of a docs build that silently stops covering part of the API.

**Why a workspace package rather than a dev dependency.** `bun add --dev typedoc`
does not work, and it is worth recording why so nobody retries it: a **peer**
dependency resolves from the root, so Bun satisfied TypeDoc's `typescript` peer with
the hoisted 7.0.2 and TypeDoc crashed. A **direct** dependency of a workspace member
gets its own `node_modules`. Both paths were measured on 2026-09-08.

The root carries **no** `typescript` version ignore in `.github/dependabot.yml` any
more. Do not re-add one.

---

## 1. Browser and runtime support (§90)

Split deliberately into what is **verified** — something in this repository
runs it and fails when it breaks — and what is **expected**, which is an
engineering judgement with no gate behind it.

| Target                                    | Status             | What backs the claim                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node >= 20                                | verified           | Root `engines.node`. The unit suites, `tests/integration`, `tests/determinism` and every `tools/` script run here, headless and with no GPU.                                                                                                                                                   |
| Headless Chromium, ANGLE over SwiftShader | verified           | `playwright.config.ts` launches with `--use-gl=angle --use-angle=swiftshader` and drives six built example sites (`bun run test:browser`); the `visual` project additionally compares committed SwiftShader goldens.                                                                              |
| Chromium on a real GPU                    | expected           | The same code path with a different rasteriser. No gate runs it, which is why the browser suite asserts thresholds rather than pixels in the `chromium` project.                                                                                                                               |
| Firefox, Safari, other evergreen browsers | expected, untested | Nothing in the engine is Chromium-specific and the requirements below are all standard, but there is no Playwright project and no CI job for them. Do not read this row as support.                                                                                                            |
| Browsers with WebGL 1 only                | not supported      | §120 fixes the MVP renderer tier at WebGL 2, and neither shipped GPU backend (section 2) has a WebGL 1 path. There is no WebGL 1 fallback and none is planned. (This row called `@fourjs/render-webgl` "the only backend" until 2026-08-29 — stale since WP-R1.1 shipped `@fourjs/render-webgpu`.) |
| Deno, Bun, other non-Node runtimes        | untested           | The packages are plain ESM with no Node built-ins in the browser-safe set, so they are likely to work; nothing checks it.                                                                                                                                                                      |

What an application needs at runtime:

- **ES2022 and ESM.** `tsconfig.base.json` targets `ES2022` with
  `module: "NodeNext"`; every package declares `"type": "module"` and an
  `exports` map with an `import` condition and **no `require` condition**.
  There is no CommonJS entry point and no bundled UMD build.
- **WebGL 2 or WebGPU**, for anything that draws (section 2; WebGL 2 is the
  §120 MVP tier, WebGPU an explicit opt-in). Headless _simulation_ needs no
  GPU at all — run the scene, motion and physics with `NullRenderer` or with
  no renderer (§62, §104).
- **WebAssembly**, for physics. Both Rapier adapters load a
  `@dimforge/rapier{2,3}d-compat` wasm image (base64-embedded, so no separate
  fetch and no MIME configuration).
- **No cross-origin isolation.** Everything shipped runs in §88's main-thread
  mode, so `SharedArrayBuffer` is not required and COOP/COEP headers are not
  needed. See `docs/guides/workers-and-cross-origin-isolation.md` for what
  changes if split-simulation mode lands.
- **Bun 1.4.2** (`packageManager` pins `bun@1.4.2`) to build from source,
  which is the only way to consume the packages until first publish.

## 2. Render backends and capability tiers (§62)

§62 lists five backends. Two ship, one headless tier ships, and two are
reserved package directories — `RendererBackend` names all five so that the
interface does not change when a backend lands. (This section said "one ships
… and three are reserved" until 2026-08-29, and its feature rows below were
stale from as early as 2026-08-08; each corrected row keeps its old wording
with the date it stopped being true.)

| §62 backend | `RendererBackend` | Package               | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------- | ----------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebGPU      | `"webgpu"`        | `@fourjs/render-webgpu` | **shipped (WP-R1.1–R1.9, 2026-08-21…29; the R-1 plan is complete)** — `WebgpuRenderer` behind `registerWebgpuRenderer()`: unlit/sprite/lit/standard families, opt-in §65 batching, textures + samplers, §67 clips + §57 stencil parity, render targets / §70 effects / `readPixels`, the §69 directional shadow tier, §36 instanced particles, §82 compute, §60 node materials + §70 graph effects behind `registerWebgpuNodeMaterialPipeline()`, §71 picking behind `registerPickingPipeline()` (`createPickingService` throws until registered; the id pass draws one id per particle emitter on the CPU 8-float stream and a deformed silhouette for skinned meshes), and RFC 0003's skinned colour pair behind `registerSkinningPipeline()` (unlit + lit + §69 caster via `acquireShadow`). Absent, not stubbed: GPU morph / CPU skinning / bone-texture palette |
| WebGL 2     | `"webgl2"`        | `@fourjs/render-webgl`  | **shipped** — `WebglRenderer` behind `registerWebglRenderer()`; the §120 MVP tier, feature table below                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| headless    | `"null"`          | `@fourjs/render`        | **shipped** — `NullRenderer`, alongside the `Renderer` interface                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Canvas 2D   | `"canvas2d"`      | `@fourjs/render-canvas` | reserved stub — the package builds and exports `PACKAGE_NAME`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| SVG         | `"svg"`           | `@fourjs/render-svg`    | reserved stub — the package builds and exports `PACKAGE_NAME`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Registering the WebGPU backend is a real decision, not a free upgrade:
`AUTO_RENDERER_ORDER` prefers WebGPU, so an application that calls
`registerWebgpuRenderer()` and selects `"auto"` moves off WebGL 2 wherever a
device is granted.

What the WebGL 2 tier actually carries:

| Feature                        | State                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pipelines, compiled at init    | three — unlit, sprite, lit (`gl-program.ts`). This row said "seven" from 2026-08-29 until 2026-09-11, when the particle, effect and shadow pipelines moved behind the registered seams below (they had compiled at initialize since P9-3/R-6/R-18 and rode every bundle that carried `WebglRenderer`, including `first-2d-scene` and `ui-demo`, which use none of them), and "four" for the rest of that day until the owner authorised moving §59's standard pipeline (`gl-standard.ts`, R-13) behind a seam as well |
| Pipelines, registered (opt-in) | seven seams an application links by calling them — a bundle that never calls one pays nothing for it: `registerSkinningPipeline()` (§54 skinned unlit + lit, plus a lazy depth-only caster on the first skinned `castShadow`, RFC 0003), `registerPickingPipeline()` (§71 id-buffer pass, RFC 0005), `registerNodeMaterialPipeline()` (§60 GLSL emitter — one program compiled per distinct graph, on first draw, RFC 0001), and since 2026-09-11 `registerShadowPipeline()` (§69 depth-only caster, `gl-shadow.ts`, compiled on the first shadowed frame), `registerEffectPipeline()` (§70 full-screen copy / grade / output transform, `gl-effect.ts`, compiled on the first fixed effect pass) `registerParticlePipeline()` (§36 instanced billboards plus the lazy R-32 appearance and trail programs and both batch caches, `gl-particles.ts`, compiled on the first particle item) and `registerStandardPipeline()` (§59 metallic-roughness surface, `gl-standard.ts`, compiled on the first `StandardMaterial` item; owner decision). Each unregistered feature is skipped with one development warning naming the call — shadows fall back to unshadowed lighting; effects, particles and standard surfaces to absence, never a Lambert stand-in — and each is dropped on context loss and re-acquired lazily after restore, the skinned pair's rule |
| Geometry                       | one vertex array object per geometry, cached and evicted (`gl-geometry.ts`)                                                                                                                                                                                                                                                                                                                                                                              |
| Clip depth                     | `"negative-one-to-one"` (plan D8) — the WebGL convention, not WebGPU's                                                                                                                                                                                                                                                                                                                                                                                   |
| Context loss and restore (§61) | implemented; `contextlost`/`contextrestored` are emitted on `Renderer.events`                                                                                                                                                                                                                                                                                                                                                                            |
| Lighting (§68)                 | one directional light plus scene ambient, first light in scene-graph DFS order (§33-deterministic) — **plus up to `MAX_PUNCTUAL_LIGHTS = 8` point and spot lights** (R-17, 2026-08-09; overflow keeps the first eight in traversal order, deterministically, and warns once) **plus one `HemisphereLight`** (2026-09-10; first-match, +Y sky axis, two-colour ambient). This row stopped at the directional light until 2026-08-29                                                                                                                 |
| Shadows (§69)                  | one tier: the directional light's shadow map — a depth-only caster pass into a `DEPTH_COMPONENT24` target, 3×3 percentage-closer filtering on receivers (R-18, 2026-08-09), behind `registerShadowPipeline()` since 2026-09-11 (unregistered: the pass is skipped once-warned and lit surfaces draw unshadowed). §69's remaining features are staged with reasons in `@fourjs/scene`'s `DirectionalLightShadow`                                                                                                                                                                                 |
| Sprite batching (§65)          | **shipped, opt-in** (R-9, 2026-08-09): `renderer.batching = createGlBatching()` merges consecutive items sharing a pipeline and a material instance into one draw through the unlit program; without the opt-in it stays one draw call per sprite. Opt-in by measured decision — the batcher costs bundle bytes every non-batching application would otherwise carry (`gl-batch.ts`). This row said "absent — one draw call per sprite" until 2026-08-29 |
| Post-processing (§70)          | copy, colour grade, the sRGB output transform (R-15) — behind `registerEffectPipeline()` since 2026-09-11 (unregistered: the pass is skipped once-warned, never quietly copied) — and §60 graph effects through `registerNodeMaterialPipeline()`; all driven as `RenderGraph` effect passes (R-6, 2026-08-07; RFC 0001, 2026-08-28)                                                                                                                                                                                                                                                                                              |
| Anti-aliasing                  | `RendererOptions.antialias` is a hint; a backend that cannot honour it never fails initialization                                                                                                                                                                                                                                                                                                                                                        |
| Particles (§36)                | one instanced draw per `ParticleRenderable` (plan P9-3), plus the R-32 appearance tier and trails — behind `registerParticlePipeline()` since 2026-09-11 (unregistered: particle items are skipped once-warned; the §71 id pass then sees no particle batches either) |
| Picking (§71)                  | id-buffer + fence read-back, behind `registerPickingPipeline()` (RFC 0005, 2026-08-29): one id per `Renderable`, one id per particle emitter (when `registerParticlePipeline()` has also been called, 2026-09-11), and a deformed silhouette for skinned meshes (`SkinnedIdProgram`, 2026-09-09) |

§62's capability-reporting clause lists eleven fields. `RendererCapabilities`
covers **all eleven** since WP-R1.1 (2026-08-21): `maxTextureSize`,
`textureFormats`, `multisampling`, `floatRenderTargets`, `timestampQueries`,
`storageBuffers`, `computeShaders`, `indirectDraw`,
`compressedTextureFormats`, `shaderPrecision`, and — §62's "maximum uniforms
and bindings", split into the two quantities a caller actually sizes against —
`maxUniformBufferBytes` and `maxBindings`; plus `backend`, RFC 0003's
`maximumSkinningJoints`, and R-30c's `maxAnisotropy`, fifteen members in all.
(This paragraph said the record carried **two** of the eleven until 2026-08-29
— true when WP-3.4 wrote it, stale since the WP-R1.1 widening.) Every member
the widening added is **optional, and absent means "not reported"**:
`undefined` is a third answer distinct from `false` — "this backend has not
been taught to answer", not "this backend cannot" — preserving WP-3.4's
original rule that a backend reports only what it has queried, because
"capability negotiation is precisely the place where a confident wrong answer
costs a crash". Concretely: `NullRenderer` answers every member with the
floor (`maxAnisotropy` is `1`, isotropic); `WebgpuRenderer` answers from the
device's own limits (and reports `maximumSkinningJoints` for RFC 0003's
colour pair); `WebglRenderer` answers everything **except**
`maxUniformBufferBytes` and `maxBindings`, and omits `maxAnisotropy` until
the field is read after `initialize` — querying the anisotropy extension at
initialization would move recorded GL transcripts (R-30b's lazy-query law,
`webgl-renderer.ts`).

The table below is the same record, read off constructed instances before
`initialize` — adding a capability member or a backend column is then a
generator change, not a prose edit.

<!-- BEGIN GENERATED: renderer-backends -->

<!-- Generated by tools/generate-compatibility.mjs from constructed renderer
     instances, before `initialize`. Do not edit by hand: run
     `node tools/generate-compatibility.mjs`, and
     `node tools/generate-compatibility.mjs --check` to verify.
     Device-derived members (`maxTextureSize` on both GPU backends; most
     WebGPU fields) stay at the construction-time floor until a context
     exists. Those floors mean "not yet queried", not "this backend cannot". -->

| Declaration                | `null`           | `webgl2`               | `webgpu`                |
| -------------------------- | ---------------- | ---------------------- | ----------------------- |
| Package (§98)              | `@fourjs/render` | `@fourjs/render-webgl` | `@fourjs/render-webgpu` |
| Exported class             | `NullRenderer`   | `WebglRenderer`        | `WebgpuRenderer`        |
| `backend`                  | `null`           | `webgl2`               | `webgpu`                |
| `maxTextureSize`           | 0                | 0                      | 0                       |
| `maxAnisotropy`            | 1                | not reported           | not reported            |
| `textureFormats`           | none             | `rgba8`                | none                    |
| `multisampling`            | no               | yes                    | no                      |
| `floatRenderTargets`       | no               | no                     | no                      |
| `timestampQueries`         | no               | no                     | no                      |
| `storageBuffers`           | no               | no                     | no                      |
| `computeShaders`           | no               | no                     | no                      |
| `indirectDraw`             | no               | no                     | no                      |
| `compressedTextureFormats` | none             | none                   | none                    |
| `shaderPrecision`          | `none`           | `highp`                | `none`                  |
| `maxUniformBufferBytes`    | 0                | not reported           | 0                       |
| `maxBindings`              | 0                | not reported           | 0                       |
| `maximumSkinningJoints`    | 0                | 48                     | 48                      |

Renderer packages that declare no renderer class:

- `@fourjs/render-canvas` — reserved stub (§62): the package builds and exports `PACKAGE_NAME` only.
- `@fourjs/render-svg` — reserved stub (§62): the package builds and exports `PACKAGE_NAME` only.

<!-- END GENERATED: renderer-backends -->

§62's other half — "applications may declare required and optional
capabilities" — landed with WP-R1.9 (2026-08-29):
`RendererResolveOptions.capabilities` takes `required` and `optional` lists
over the six declarable boolean names (`RENDERER_CAPABILITY_NAMES`:
`multisampling`, `floatRenderTargets`, `timestampQueries`, `storageBuffers`,
`computeShaders`, `indirectDraw`). `"auto"` skips a backend that does not
affirm every required name (`undefined` never satisfies a requirement) and
reports the skip as `"missing-capability"`; an explicitly named backend that
falls short fails fast instead of downgrading; optional shortfalls are
reported through `onCapabilityShortfall` and never gate selection. The
numeric members and format lists are deliberately not declarable yet — a
requirement over a quantity needs a threshold grammar, and none has a
consumer.

§62's `renderer: "auto"` selection **is implemented** (R-2, closing gap A-8;
registry landed 2026-08-07, the string form on `ApplicationOptions.renderer`
with it — this paragraph said "not implemented" until 2026-08-29, which had
been stale for three weeks). `ApplicationOptions.renderer` takes a `Renderer`
instance, a backend name, or `"auto"`; a name resolves against the §62
registry, into which an application opts each backend explicitly
(`registerWebglRenderer()`, `registerWebgpuRenderer()`) — an explicit call,
never a side-effect import, because every package declares
`"sideEffects": false`. `"auto"` walks `AUTO_RENDERER_ORDER` (`webgpu`,
`webgl2`, `canvas2d`, `svg`; `"null"` is never auto-chosen) and takes the
first registered backend that reports support and initializes, reporting each
one skipped through the `onFallback` callback — §62's diagnostics event; a
named backend that cannot start fails fast with
`RENDERER_INITIALIZATION_FAILED` (§89) rather than silently downgrading. An
application still chooses its backends by importing them: nothing in
`@fourjs/render` or the umbrella package imports a backend, and a bundle that
hands `Application` a constructed instance carries no registry at all.

## 3. Physics solver adapters (§37, §102)

§102 defines the solver package set as `@fourjs/physics-rapier` and
`@fourjs/physics-box2d`; `@fourjs/physics-soft` is §35's soft-body package on the
same seam. The table below is generated from the adapters' own
`PhysicsCapabilities` records, read off constructed instances before
`initialize`, plus the two structural access seams
(`SolverBodyAccess`, `SolverJointAccess`) probed member by member against
`@fourjs/physics`'s emitted declarations. Regenerate with
`node tools/generate-compatibility.mjs` after any adapter change.

<!-- BEGIN GENERATED: solver-adapters -->

<!-- Generated by tools/generate-compatibility.mjs from the adapters' own §37
     capability declarations. Do not edit by hand: run
     `node tools/generate-compatibility.mjs`, and
     `node tools/generate-compatibility.mjs --check` to verify. -->

| Declaration                     | `rapier2d`                                         | `rapier3d`                                                      |
| ------------------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| Package (§98)                   | `@fourjs/physics-rapier`                           | `@fourjs/physics-rapier`                                        |
| Exported class                  | `Rapier2dAdapter`                                  | `Rapier3dAdapter`                                               |
| Underlying solver               | `@dimforge/rapier2d-compat` 0.20.0                 | `@dimforge/rapier3d-compat` 0.20.0                              |
| `dimensions` (§21)              | `2d`                                               | `3d`                                                            |
| `determinism` (§33)             | `same-runtime`                                     | `same-runtime`                                                  |
| `snapshots` (§34)               | yes                                                | yes                                                             |
| `ccdModes` (§31)                | `disabled`, `speculative`, `swept`                 | `disabled`, `speculative`, `swept`                              |
| `jointTypes` (§28)              | `fixed`, `spring`, `revolute`, `prismatic`, `rope` | `fixed`, `spring`, `revolute`, `prismatic`, `spherical`, `rope` |
| `queries.raycast` (§30)         | yes                                                | yes                                                             |
| `queries.shapeCast` (§30)       | yes                                                | yes                                                             |
| `queries.overlap` (§30)         | yes                                                | yes                                                             |
| `queries.point` (§30)           | yes                                                | yes                                                             |
| `tuning.rollingFriction` (§25)  | no                                                 | no                                                              |
| `tuning.spinningFriction` (§25) | no                                                 | no                                                              |
| `tuning.sleepThresholds` (§32)  | no                                                 | no                                                              |
| `reportsJointReactions` (§28)   | no                                                 | no                                                              |
| `SolverBodyAccess` implemented  | yes                                                | yes                                                             |
| `SolverJointAccess` implemented | yes                                                | yes                                                             |

Solver packages that declare no adapter:

- `@fourjs/physics-box2d` — reserved stub (§102): the package builds and exports `PACKAGE_NAME` only.
- `@fourjs/physics-soft` — reserved stub (§102): the package builds and exports `PACKAGE_NAME` only.

<!-- END GENERATED: solver-adapters -->

### The access seams (required engine surface beyond §37)

§37 sketches `PhysicsSolverAdapter`: identity, a `capabilities` record,
create/destroy, `step`, `drainEvents`, the two `sync*` hooks, the §30 query
set, optional snapshots, `dispose`. That is a contract about the **step**. It
has no per-body read and no per-joint command, so it cannot move a solved pose
onto a node or drive a motor. The engine therefore requires two further
interfaces, defined in `@fourjs/physics` and detected structurally (the
generated table's `SolverBodyAccess implemented` / `SolverJointAccess
implemented` rows are member-by-member probes against the emitted
declarations, not a capability flag):

- **`SolverBodyAccess`** — **required.** `PhysicsWorldAdapter` is
  `PhysicsSolverAdapter & SolverBodyAccess`; an adapter without it cannot back
  a world. Both shipped Rapier adapters implement the whole seam today:

  | Member | What Rapier does with it |
  | ------ | ------------------------ |
  | `getBodyTransform` / `setBodyTransform` | solved pose onto the node under `"physics"` authority; teleports (§37) |
  | `getBodyVelocities` / `setBodyVelocities` | §23 reads; kinematic-velocity drive; §19 velocity inheritance |
  | `applyForce` / `applyForceAtPoint` / `applyTorque` / `applyImpulse` / `applyImpulseAtPoint` / `applyAngularImpulse` / `resetForces` | §26 command buffer |
  | `setNextKinematicTransform` | kinematic-position target; Rapier derives the motion |
  | `setBodyType` | in-place re-type (§19 / §22); handle, id, colliders and mass stay |
  | `wakeBody` / `sleepBody` / `isBodySleeping` | §32 explicit sleep; `sleeping` is read-only on `RigidBody` |
  | `getBodyCcdMode` / `getBodyMass` / `getBodyCenterOfMass` | read-back after the solver resolves them |
  | `getBodyId` / `forEachBody` / `getColliderBody` / `getColliderId` / `forEachCollider` | monotonic never-reused ids; §33 checksum visit order |

  A third, **optional** seam — `SolverBodyTuningAccess` — carries the rare
  post-registration writes (§23 mass/damping/gravityScale/CCD, §25 material,
  §24 filter). It is all-or-nothing and structurally detected; both Rapier
  adapters implement it. It is not a generated-table row because it is not
  required to construct a world.

- **`SolverJointAccess`** — required of any adapter that accepts `addJoint`.
  Live `setJointLimits` / `setJointMotor`, monotonic joint ids, and
  `getJointReaction` for §28 breakage. Its one _declared_ member is
  `reportsJointReactions`, which appears as a row in the table above. Both
  Rapier adapters implement the seam and declare that member `false`.

### Deviations the capability record cannot express

Honest differences that no field of `PhysicsCapabilities` can carry, recorded
here because §90 tables are where a user looks for them (each is documented at
its source in `packages/physics-rapier/src`):

- **Break thresholds do not work on either Rapier adapter.** Rapier 0.20.0
  exposes no joint reaction, so `reportsJointReactions` is `false` and
  `PhysicsWorld.addJoint` **refuses** a joint carrying `breakForce` or
  `breakTorque` rather than accepting a threshold that could never fire.
- **A motor's `maxTorque` / `maxForce` is a force-based gain, not §28's hard
  ceiling.** Documented **now**, not when Box2D lands: Rapier 0.20.0 exposes
  no JS-reachable motor-force cap, so both adapters supply the value as a
  `ForceBased` gain — effort ≈ `maxEffort · (target − current)` — which is
  monotone in strength but does not clamp. `PhysicsCapabilities` has no field
  for that distinction, so the Rapier column lives here until a capping
  adapter arrives and earns its own column:

  | Adapter            | `maxTorque` / `maxForce`                                      |
  | ------------------ | ------------------------------------------------------------- |
  | `rapier2d`         | force-based gain                                              |
  | `rapier3d`         | force-based gain                                              |
  | `box2d` (reserved) | — (capping adapter; column when `@fourjs/physics-box2d` ships) |
- **`inheritVelocityFrom` is nearly a no-op on both Rapier adapters.** Rapier
  derives kinematic velocity itself from the pose it is given, so seeding
  velocities from a `PoseTarget` does not change what the solver already
  computes. Other solvers may need the seed; record it on their column when
  they land.
- **A 3D `spherical` joint ships without limit support.** A limited one is
  refused loudly rather than simulated unlimited.
- **Restitution combine is forced to `Max`.** Rapier's default is `Average`,
  which contradicts Appendix A.
- **`SleepingConfig.enabled` is honoured; the three thresholds are not.** The
  thresholds are the `tuning.sleepThresholds` row above; `enabled` maps to
  `RigidBodyDesc.setCanSleep` and is deliberately not part of that flag.
- **`shapeCast` has a multiplicity limit** on both adapters — see each
  adapter's `shapeCast` documentation for what `maxHits` and `sorted` can ask
  for. The capability stays `true` because the query is implemented.

`determinism: "same-runtime"` on both adapters is Appendix A's target and no
more: the same build on the same engine reproduces a run exactly (proven by
the §92 determinism goldens). Nothing stronger is claimed, because the
adapters' own conversions use `Math.atan2` / `Math.sin` / `Math.cos`, whose
results are not specified across JavaScript engines — which is exactly what
`"same-platform"` would forbid.

## 4. Scene, replay and snapshot format versions (§34, §79, §80)

§80 makes format versioning **independent of package semantic versioning**: a
number here moves only when a document's _shape_ changes, never because a
package released.

| Format                         | Constant                                                            | Writes | Reads    | Where                  |
| ------------------------------ | ------------------------------------------------------------------- | ------ | -------- | ---------------------- |
| Scene document (§79)           | `SCENE_FORMAT_VERSION`                                              | `1`    | `1`      | `@fourjs/serialization`  |
| Replay recording (§34)         | `LATEST_REPLAY_FORMAT_VERSION` / `SUPPORTED_REPLAY_FORMAT_VERSIONS` | `2`    | `1`, `2` | `@fourjs/diagnostics`    |
| Rapier snapshot envelope (§34) | `SNAPSHOT_FORMAT_VERSION` (module-private, not exported)            | `2`    | `2`      | `@fourjs/physics-rapier` |
| `.four` binary package (§79)   | —                                                                   | —      | —        | not implemented (A-16) |

**The versioning rule, decided 2026-08-06 (PH-6): a document declares the
lowest version that can express its content**, not the version of the build
that wrote it. A replay recording carrying a `worldConfiguration` is a `2`; one
without is still a `1`, byte for byte the same text the format produced before
version 2 existed. That is what makes a bump safe in both directions — old
documents still run and re-encode identically, new documents are refused by old
builds _loudly_ (`SERIALIZATION_VERSION_MISMATCH` naming both numbers) instead
of being silently stripped, and downgrading is a real operation rather than a
hack: delete the field, re-validate, and the version is re-derived from the
content.

Notes per row:

- **Scene documents** are at version `1` and there is exactly one version, so
  `SceneMigrationRegistry` currently holds no steps. §80's requirements —
  explicit, testable, deterministic, warning-capable, composable migrations —
  are implemented in `migration.ts` and waiting for a first bump. A document
  declaring any other version is refused by `validateSceneDocument` and has to
  go through `runSceneMigrations` first.
- **Scene documents carry `Node`'s own fields only.** No camera FOV, no
  geometry reference, no sprite texture key, no light colour, no widget box:
  round-tripping a subclass needs an application-supplied `nodeFactory`
  (gap A-16). This is a compatibility fact, not a defect of the format
  version.
- **The Rapier snapshot envelope is adapter-private.** Its version is not
  exported, so it is not in the generated table; both adapters are at `2`
  (raised from `1` in WP-6.2, when the metadata grew a joints table), and
  `restoreSnapshot` refuses anything else. A snapshot is opaque solver bytes
  plus that envelope — it is not interchangeable between adapters, between
  dimensions, or across a Rapier version bump.
- **§34 replay documents pin an adapter identity**, so a recording made on one
  adapter is refused on another rather than replayed into a mismatched world.

## 5. Plugin API versions (§81)

**Implemented 2026-08-28 (RFC 0002, gap A-3 closed).** The §81 plugin host lives
in `@fourjs/core` (`FourPlugin`, `PluginContext`, `PluginHost`, `installPlugins`),
and the owning packages declare the capability tokens (the first six listed here; the umbrella `fourJS` re-exports them)
(`SIMULATION_SYSTEMS`, `RENDERER_REGISTRY`, `SOLVER_REGISTRY`,
`COMPONENT_SERIALIZERS`, `SCENE_MIGRATIONS`, `RENDER_GRAPH`).

| Surface              | Version | Governed by                                                                           |
| -------------------- | ------- | ------------------------------------------------------------------------------------- |
| `PLUGIN_API_VERSION` | `0.1.0` | this section — independent of package semver (§90), like the §79 scene format version |

A plugin's optional `engineRange` is matched against `PLUGIN_API_VERSION` with a
**deliberately restricted range grammar**: `*`, `X.Y.Z`, `^X.Y.Z`, `~X.Y.Z`, and
`>=X.Y.Z` only. Anything else is refused with a message saying so, rather than
taking a semver dependency into the package every other package depends on. One
consequence worth knowing before publishing a plugin: a caret range below
`1.0.0` is minor-locked, so `^0.1.0` accepts `0.1.z` and **refuses** `0.2.0` —
which is exactly the honesty starting at `0.1.0` buys.

**All eleven** §81 extension points now have a token (2026-09-06): the six
above plus `ASSET_LOADERS` (`@fourjs/assets`), `SHADER_OPERATORS`
(`@fourjs/materials`), `UI_CONTROLS` (`@fourjs/ui`), `COMPUTE_WORKLOADS`
(`@fourjs/render`) and `EDITOR_TOOLS` (the umbrella), each over a minimal
registry. Until that date the last five were absent by design (a plugin asking
for one was refused by name at install). Adding tokens was additive and did not
move `PLUGIN_API_VERSION`'s major. Tokens are declared in their owning packages
since 2026-08-29; the umbrella package (`fourJS`, directory `packages/fourjs`)
re-exports the same objects.

The registries the tokens hand over — `ComponentSerializerRegistry` (§79),
`SceneMigrationRegistry` (§80), `SystemRegistry` (§39), `RendererRegistry`
(§62), `SolverRegistry` (§37) — remain ordinary package APIs governed by
section 6's semantic versioning; the plugin API version covers the host's
contract (install lifecycle, capability acquisition, revocability), not the
shapes behind the tokens.

## 6. Package versioning (§90)

§90's contract for the packages themselves:

| Bump  | Means                        |
| ----- | ---------------------------- |
| patch | compatible defect correction |
| minor | backward-compatible feature  |
| major | breaking API change          |

All 24 workspace packages are at `0.0.0` and none is published. §98 fixes the
publish naming: the umbrella package publishes as `@danielsimonjr/fourjs` and
the sub-packages as `@danielsimonjr/fourjs-<name>`, while the workspace names
stay `four` and `@fourjs/*`. Changesets is the configured release tool (§91);
`docs/GAP ANALYSIS v0.md` A-25 records that the release machinery around it
does not exist yet.

Two things are deliberately _not_ governed by these numbers: the format
versions of section 4 (§80 makes them independent) and a solver adapter's
capability record, which is a declaration about the underlying solver build
rather than about this project's API.

## Regenerating and checking this document

```sh
node tools/generate-compatibility.mjs           # refresh the generated block
node tools/generate-compatibility.mjs --check   # fail if the block is stale
```

The generator imports the built adapters from `dist/`, so run `bun run build`
first. Everything outside the `BEGIN GENERATED` / `END GENERATED` markers is
hand-written and has to be reviewed against the code the same way any other
document does; `tools/check-spec.mjs` and `tools/check-docs.mjs` are the
sibling checks and neither reads this file.
