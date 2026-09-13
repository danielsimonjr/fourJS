# Changelog

All notable changes to this repository are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Once packages
are published, releases will follow [Semantic Versioning](https://semver.org/) per §90 of the
specification; until then, entries are grouped by date under **Unreleased**.

## Unreleased — bounded image decoding (2026-09-12)

### Added

- Static PNG to RGBA8 decoder with a runtime-enforced Wasm heap maximum established
  before codec initialization, bounded output copies, and PNG framing/CRC checks.
- Strict `maximumWorkingBytes` requirements for image, texture, and glTF loading;
  uncappable native callbacks are refused before transport/decode. Existing
  callbacks remain available without this option. Other image formats have no
  bounded adapter yet; this is not a process-memory ceiling.
- Real PNG codec regression fixtures and Chromium checks, including allocator
  exhaustion; guest Wasm growth and startup-code tests verify the memory ceiling.

### Fixed

- Image loaders check RGBA8 output-size estimates and expansion limits, validate
  header probes, and close rejected bitmaps. Texture loaders validate safe sizes
  and backing-buffer retention before creating row-flip copies.
- Snapshot decoder options to prevent replacement after memory-cap verification;
  preserve original input size when probes or worker decoders transfer a buffer.
- Restored the existing HarfBuzz adapter's supported 0.4.13 dependency and the
  TypeDoc workspace's TypeScript 6.0.3 pin. The merged 1.6.1/7.0.2 pins broke
  shaping integration and the docs compiler guard independently of this change.

### Validation

7,763 package tests and 685 integration/determinism tests pass. The assets gate
passes 508 tests at 99.21% lines / 98.04% branches; the 77 PNG tests use the real
codec and 73 Wasm tests include guest/start-function growth. Focused Chromium
152 PNG decoding, checksum rejection and allocator-exhaustion check passes.
All packages and examples build; TypeScript 7/6 checks, lint, warning-free API
docs, spec/docs/compatibility, architecture/duplicate checks, 13 publish-name
and 10 graph-tool tests, frozen install, and all seven bundle budgets pass.
The complete browser matrix and all-package coverage were not rerun locally.

## Unreleased — post-merge review (2026-09-11)

### Fixed

- WebGL/WebGPU texture residency no longer reports a new completed allocation as
  uploading while an obsolete allocation's wait is outstanding.
- Fixed the merged-main CI timeout: ring bounds skip impossible containment
  tests; the large-shape fixture still crosses 65,536 vertices and verifies the
  highest index, using smaller rings under the unchanged timeout.
- Replaced the blending browser test's screenshot-speed deadline with exactly
  three required capture pairs under its existing timeout; pixel assertions remain.
- Restored docs TypeScript 6.0.3 declaration/lock consistency and added four
  compiler-guard regressions. Removed obsolete Vitest 5 update exclusions.
- Repaired broken API documentation links and stale TypeDoc exclusions; docs
  now build without warnings.
- Identity shaping retains legacy custom-atlas glyphs, advances and cell widths
  without requiring the optional glyph-ID map.
- Asset/security documentation reflects shipped glTF, safe shader functions and
  bounded texture/gzip decoding.

### Added

- Raw gzip asset loader over a host streaming decoder, with finite output/ratio
  bounds, cancellation and cleanup, and no partial return before checksum validation.
- Regression cases for allocation replacement/recovery and custom atlas parity;
  real gzip corruption/limit tests and a Chromium host-adapter check.

### Validation

Validation completed 2026-09-12: 7,574 package tests / 299 files and all 24
coverage gates pass; 685 integration/determinism tests pass; the complete serial
browser run passes all 114 checks, including three unchanged visual goldens.
Chromium 152 / software GPU only, not R-33 hardware evidence. Builds, TypeScript
7/6 checks, lint, spec/docs/compatibility, dependency/duplicate gates, 13 release-name
and 10 graph-tool tests pass. API docs are warning-free and four compiler-guard
regressions pass. Frozen install succeeds. All existing bundle budgets pass;
minimal 2D app: 61.34 kB gzip / 150 kB limit. No threshold, timeout or bundle budget
was relaxed. Nothing published or merged by this follow-up.

## Unreleased — RFC implementation packets (2026-09-11)

### Added

- RFC 0007 waypoint planning, deterministic steering and trajectory conversion; plugin
  token and independent oracle/golden/65,536-node performance evidence.
- RFC 0008 optional HarfBuzz shaping, glyph-ID layout, Text/Label forwarding and OFL
  Latin/Arabic fixtures; explicit wasm/font input and bounded SFNT validation.
- RFC 0009 GPU-readback raster snapshots with disposal/concurrency/size validation and
  delayed-feedback detection, including every standard-material texture slot.
- CPU skinning integrated into Mesh rendering, interpolation, bounds, picking and
  scene serialization, including rigs larger than the GPU uniform-palette limit.
- Shader functions, safe declarative operators, finite variants, per-node GLSL/WGSL
  diagnostics and opt-in WebGL std140 uploads with a recorded call/byte comparison.
- Regional texture upload journals, bitmap/video sources, raster sampler settings,
  asynchronous texture preparation and residency reporting.
- WebGL normal/occlusion texture sampling and authored glTF scale/strength factors.

### Fixed

- Shader graph validation now rejects unknown unary/binary operators and inherited
  type/attribute names instead of allowing source injection through serialized input.
- Path distance overflow is refused before it can produce invalid indices/NaNs.
- Render-graph feedback detection includes metallic-roughness, emissive, normal and AO
  samplers, not just base color.

- Release staging skips private tooling workspaces and preserves nested shaping
  imports. Its regression suite now runs in pull-request CI. A local staging pass
  validates all 24 public packages; it does not publish to npm.

### Validation

- 7,556 package tests in 298 files pass under coverage; all 24 package gates
  (95% aggregate / 80% per-file floor) remain unchanged. 685 integration and
  determinism tests in 98 files pass, including fresh-process planning goldens.
- Chromium/WebGPU full run: 108/110 passed; the two failures exposed a stale
  pre-hemisphere browser fixture (592-byte prefix used as a 720-byte binding).
  Corrected it to use `LIGHT_BINDING_BYTES`; both reruns pass. All three existing
  visual goldens pass unchanged. Runtime: Chromium 152 with SwiftShader; pinned
  Chromium 153 download was unavailable. This is not physical-GPU R-33 evidence.
- Workspace/example builds, TS 7 test checks and isolated TS 6 cross-checks, lint,
  spec/docs/compatibility checks, browser-safe dependency graph and duplicate gates
  pass. Release-name tests (13) and graph-tool tests (10) pass; local staging
  preserves 26 umbrella exports across all 24 public packages.
- Clean main-versus-branch gzip measurements justify three example-budget updates
  in `tools/size-budgets.mjs`. The minimal 2D app is 61.29 kB against the unchanged
  150 kB normative ceiling. The optional HarfBuzz WASM is outside default bundles.

### Scope

This is a feature implementation wave, not a declaration that every TODO is complete.
The dated TODO section names the remaining backend, graph, batching, rendering,
hardware and release work. Coverage thresholds and the normative 150 kB budget remain.

## Unreleased — hemisphere light (2026-09-10)

### Added

- **`HemisphereLight` (§68).** Two-colour directional ambient (sky / ground)
  beside `Scene.ambientLight`. First visible, enabled node in scene-graph
  order; sky axis is the node's +Y (world up). Mix
  `0.5 · n·up + 0.5` added to constant ambient; on `StandardMaterial` the
  term reaches the diffuse lobe only. WebGL uploads nothing when none is
  present (`useHemisphere` skip). WebGPU packs sky/ground/up at bytes
  672–720 of the 768-byte light stride (after the shadow tail). §79 type
  `scene:hemisphere-light`. Lighting checkbox stays open (area, extra
  directionals, clustered, IBL, …).

## Unreleased — WebGPU skinned shadow caster (2026-09-10)

### Added

- **WebGPU skinned shadow caster (RFC 0003 residue).** `acquireShadow()` on
  the registered colour pair (`wgpu-skinning.ts`, not a
  `SkinnedShadowProgram` class). Depth-only WGSL skins then transforms
  through the shared `DrawUniforms` block; palette at group 1. Lazy on the
  first skinned caster; compile failure skips, never bind-pose.
  Unregistered casters still skip. RFC 0003 stays open (GPU morph, CPU
  skinning, bone-texture).

## Unreleased — open-TODO audit + RFC 0005 close (2026-09-10)

### Added

- **WebGPU skinned id pass (RFC 0005 residue, last named slice).** Private
  pipeline in `wgpu-picking.ts` (not a `SkinnedIdProgram` class —
  `graph:duplicates`). `skinMatrix(joints, weights)` over a 3072-byte
  palette bind group (`hasDynamicOffset`, vertex stage), joints
  `@location(4)` `uint16x4`, weights `@location(5)` `float32x4`. Lazy on
  the first skinned item; compile failure skips, never bind-pose. Mesh
  `IdUniforms` stay 144 bytes. RFC 0005 checkbox closed.

### Changed

- **WebGPU batch idle-skip.** `WgpuBatching.draw` skips `writeBuffer` when
  the planner's `contentVersion` is unchanged on that slot (`#canSkipUpload`,
  the GL twin). `contentVersion === 0` still always uploads. A still scene
  now issues the uniform rewrite only. Skip key includes `floatsPerVertex`
  so a UV/vertex-colour stream-shape change cannot reuse the old stride.

- **WebGPU skinned id palettes upload the packed region only**, matching
  `wgpu-skinning.ts` (`packed * SKINNED_ID_PALETTE_FLOATS`), not the grown
  staging buffer.

- **TODO.md recount: 11 open / 260 closed.** RFC 0005 residue closed.
  Hygiene: RFC 0008 Proposed note on the live Priority index; PH-11c
  “owner-gated” struck on closed rows; idle-cache index names both
  backends.

- **Doc-drift follow-up from the same audit.** §96 decompression limits
  are **partial** in the security guide (`createTextureLoader` bounds;
  gzip/Draco/Basis still absent). `fields.ts` records radial GPU fields
  as shipped on `simulation: "gpu"`. Custom-shaders / `NodeMaterial`
  stop claiming R-17's light-uniform contract is missing; `angle` and
  the §58 paint tier leave the deferred list. Spec revision **1.15**
  matches that §60 honesty.

## Unreleased — RFC 0007–0009 review pass (2026-09-10)

### Changed

- **RFC 0007 (path-planning adapters) corrected in place.** `PathPlannerDeterminism`
  replaces the unreachable physics-owned `DeterminismLevel`; `followWaypoints` takes
  `FollowWaypointsOptions { agentRadius, slowRadius? }` and composes the existing
  `arrive(context, target, slowRadius, out)`; `PATH_PLANNERS` is non-revocable by
  `defineCapability`'s default; the compatibility list names every export.
- **RFC 0008 (§56 shaping engine) corrected in place.** Subpath is
  `@fourjs/text/harfbuzz` / `fourJS/text/harfbuzz`; `layoutText` walks code points; the
  shaper hook is a `TextLayoutOptions` field; vertical text refuses with
  `NOT_IMPLEMENTED`; §96 error split stated; Noto Sans (OFL) replaces the mislabelled
  Roboto; new §7 glyph-id → quad rule (`GlyphAtlas.glyphsById`).
- **RFC 0009 (GPU readback raster source) corrected in place.** "Never inside
  `render`/`RenderGraph.execute`" replaces the non-existent `beginFrame`/`endFrame`;
  the source owns a `maximumBytes` checked at construction (`RangeError`, raster
  precedent); the display-only scan's `FORBIDDEN` list must gain the new names; the
  feedback check mechanism (`CanvasTexture.readbackTarget` → `collectSampledTargets`)
  is spelled; RFC 0005's pick-latency numbers cited as landed.

### Added

- `docs/plans/RFC-0007-PATH-PLANNING_PLAN.md`, `RFC-0008-TEXT-SHAPING_PLAN.md`,
  `RFC-0009-GPU-READBACK_PLAN.md` — subagent-driven plans (≤ 4 haiku-class agents,
  disjoint file ownership, waves, per-plan anti-hallucination sheets with file:line
  citations, gates). Plan only; implementation waits on owner acceptance.

## Unreleased — open-TODO burndown (2026-09-09)

Closed the remaining *contained* open items. Feature packets, RFC residues, the
standing dogfooding map, first publish, and R-33 (needs non-SwiftShader hardware)
stay on the tracker. A same-day audit recounts **12 open / 257 closed**
(header had 249) and strikes leftover “remaining” prose on closed rows.
No packet closed.

### Fixed

- **`dev-build-mode` GATED list includes `wgpu-picking.ts`.** Wave 5's
  WebGPU picking id pipelines wrap compile-failure notices in `if (DEV)`
  (mesh + particle), matching `gl-picking.ts`, but the §33 gate only
  listed the WebGL twin. Cross-package suites failed on #87 until the
  WebGPU file was recorded with the same picking-is-input argument.

- **Size budgets after #86.** CI `bun run size` failed with the browser
  gate green (107/107): particles-demo 43.04/43 kB (+38 B), ui-demo
  49.51/49.5 kB (+11 B). Limits 43.5 / 50 kB. first-3d 42.74/43 kB holds.
  Rationale in `tools/size-budgets.mjs`.

- **WebGPU Playwright gates match the 192-byte `DrawUniforms` block.** After
  the `normalMatrix` hoist, six `[webgpu]` specs still bound
  `minBindingSize: 144` (shader reads 192). Sprites still packed a retired
  `quad` uniform into a 160-byte block with position-only vertices. Harnesses
  now import `DRAW_UNIFORM_BYTES` / `SPRITE_UNIFORM_BYTES`, write the identity
  std140 mat3 at float 36, and feed authored uv at `@location(2)`.

- **`graph:duplicates` allowlists the parallel picking seams.** WebGL and
  WebGPU each own `registerPickingPipeline` / `PickingServiceFactory` /
  `PickingRendererHost`. The names match on purpose; the backends cannot
  share a body. Same class as `CacheableGeometry`.

- **`tools/docs` TypeScript pin restored to 6.0.3.** Dependabot #82 bumped the
  isolated docs package to 7.0.2 with the root and `bun run docs` died on
  TypeDoc's `PropertyDeclaration` read — the exact failure the isolation was
  built to prevent. Main was already red. `tools/docs/check-compiler.mjs` now
  refuses any resolve that is not 6.0.x so the next bump is a one-line revert.

- **`smoothness.spec.ts` interpolation flake.** Two leaks, both required:
  Playwright's screenshot let the patched rAF advance 1.5Δ frames during
  SwiftShader PNG encode (pause via `__fourPauseRaf`), *and* the wait helper
  pumped that same patched rAF, adding a phantom frame per sample. Together
  they produced only even virtual frames (alpha 0.0). The wait now uses
  `__fourHostRaf`. `MINIMUM_MID_STEP_FRAMES` stays 2. `examples/first-2d-scene`
  publishes `data-alpha` / `data-dropped` / `data-substeps`.

- **`character-controller.spec.ts` walk gate no longer uses a 4 s wall-clock
  hold.** Same starvation pattern the look test already fixed: on a contended
  runner the capsule reached `WALL_REACHED_Z` while still sliding into the
  wall. The walk now waits on settled `data-pz`.

- **Particle appearance/trail matrix assertions typecheck under TypeDoc/TS 6.**
  `uploadsAt(...)[0]?.[12]` indexed `unknown[]` (TS7053). The assertions
  now compare the full uploaded matrix, matching the existing particle
  program case.


- **§79 diagnostics no longer interpolate `constructor.name`.** A minified
  `Renderable` reported as `"Ur"`. Messages and context now name authored
  document types (`"scene"`, `"group"`, registered `typeName`) and the
  `nodeTypeOf` / `static readonly typeName` options. The 2026-09-07 caveat and
  `*IsMinifiable` flags are gone.

### Changed

- **TODO tracker audit.** Recounted **12 open / 257 closed** (header said
  249). No open packet closed — each remaining `[ ]` still has named
  work or is standing/owner-gated. Struck leftover “remaining” prose on
  closed rows (rigs, PH-11c, scissor, `recording-gl` adopt, flagship §46
  layers, WebGPU `maximumSkinningJoints`) and Priority-index leftovers
  (A-4/A-5/A-19, R-32, camera-rig residue, particle-trail spatial-hash).
  Remaining-work wording: R-17 point/spot (8) is landed; §27/§36 GPU
  stubs named; §96 closed-union vs extensible operators; WebGPU batch
  idle-skip is GL-only.

- **WebGPU skinned colour pair (RFC 0003).** `registerSkinningPipeline()`
  from `@fourjs/render-webgpu` compiles unlit + lit on first skinned
  draw. Palette is a 3072-byte bind group (`MAX_SKINNING_JOINTS` × 64),
  not inside `DrawUniforms` (192 bytes stays). Unregistered or failed
  factories skip — never bind pose. Shadow caster and id pass still
  skip. RFC 0003 stays open.

- **WebGL `StandardMaterial.emissiveMap` (unit 3).** glTF factor ×
  texture, sRGB. Lazy sampler; unresolved/disposed map degrades (draw
  continues). `emissiveTexture` leaves `ignoredTextures`. WebGPU leaves
  it unsampled — groups 2/3 already hold albedo/MR. Lighting leftover
  stays open (`normalMap` / `occlusionMap` / WebGPU emissive).

- **Dogfood cycle 7: WebGL skinned GPU picking.** Consumer-seat
  `tests/integration/skinned-gpu-picking.test.ts`: both registration
  seams, live palette on the id pass, unskinned control unchanged.
  Recording GL cannot rasterise the deformed silhouette; staged texels
  still resolve. Guide index notes WebGL `SkinnedIdProgram`; WebGPU
  still skips skinned items. Standing map stays open.

- **Texture map roles (R-30c).** Optional `TextureSource.role` /
  `Texture.role` (`"color"` | `"data"`). Omitting the field invents no
  default and leaves `colorSpace` at R-15's `"linear"`, so already-
  authored textures and goldens stay byte-identical. `role: "color"`
  with no `colorSpace` resolves to `"srgb"`; `"data"` stays linear;
  an authored `colorSpace` always wins. Backends still read
  `colorSpace` only. Cube/array/3D, compressed, video/`ImageBitmap`,
  and async upload remain. R-30c stays open.

- **WebGL skinned id pass (RFC 0005).** `SkinnedIdProgram` draws a
  deformed silhouette into the picking buffer (`SKINNING_GLSL` spliced
  into the id fragment). Compiled on the first skinned item; a compile
  failure skips (bounds). Isolated from `gl-skinning.ts` so
  `registerPickingPipeline` does not link the colour pair. WebGPU still
  skips skinned items (no RFC 0003 skinned pipelines). RFC 0005 stays
  open.

- **WebGPU particle id pass (RFC 0005).** Emitters pick by GPU id — one
  colour per system — through a private billboard pipeline (CPU 8-float
  instance stream, 208-byte `PARTICLE_ID_*` block). Trails stay undrawn;
  GPU-sim / R-32 wide streams skip; skinned items still bounds-only on
  both backends. RFC 0005 stays open.

- **WebGPU `StandardMaterial.metalRoughnessMap`.** Packed G=roughness /
  B=metalness, matching WebGL. Bind group 3 when albedo occupies group 2,
  group 2 when it does not (`shadedMrBindingWgsl`). Scalar-only keys stay
  byte-identical (`|mr:y` only when true). WebGL now samples `emissiveMap`
  (unit 3); `normalMap` / `occlusionMap` remain unstaged. WebGPU emissive
  stays unsampled (four-group budget).

- **§43 interpolated skin palettes.** `Skeleton.update` takes an optional
  `worldOf` provider. The interpolated render list composes bone local
  poses at `interpolationAlpha` then runs the palette product. Palettes
  are never matrix-lerped. Scene transforms are unchanged.

- **WebGL skinned casters write a deformed silhouette (§69).**
  `registerSkinningPipeline()` now also exposes a lazy
  `SkinnedShadowProgram` compiled on the first skinned `castShadow`.
  Unregistered or failed skinning still skips rather than casting a
  bind pose. WebGPU has no skinned pipelines.

- **WebGPU `PickingService` (RFC 0005).** `registerPickingPipeline()` from
  `@fourjs/render-webgpu`, then `createPickingService()`. `pick` copies
  one texel through `mapAsync`. Particle emitters now have their own id
  arm (see the particle id-pass bullet); skinned items stay skipped.

- **WebGPU lit/standard read `draw.normalMatrix`.** `DRAW_UNIFORM_BYTES`
  is 192; `STANDARD_UNIFORM_BYTES` is 224 (`emissive` 192, `surface` 208).
  Sprites stay 144. The per-vertex cofactor function is still exported
  and is no longer spliced into those shaders.

- **Particle systems pick as one node (RFC 0005).** `collectPickCandidates`
  includes `isParticleDrawable`. The WebGL id pass draws them through
  `ParticleIdProgram` (shared §36 billboard vertex, flat `pickId`). One
  id per emitter; trails skipped; skinned items still bounds-only.

- **`PointerInput` accepts an optional `PickProvider` (§72).** GPU-mode
  nodes resolve through that seam. The default (no provider) path stays
  fully synchronous. The provider path copies the event and serializes
  per `pointerId`.

- **§55 sprites author UVs; `quad` uniform retired.** `Sprite.frame` writes
  the cell into `geometry.uvs`. WebGL and WebGPU sample that attribute.
  `SPRITE_QUAD_OFFSET` is gone. Changing a frame re-uploads eight floats
  (geometry version), not the atlas texture. §65 batches copy the stream.

- **Oxlint correctness warnings triaged to zero.** The 40 remaining default-
  category warnings (down from 42) were either one-line fixes (`Array.from`,
  `localeCompare`, computed quaternion `w`, a JSDoc that accidentally contained
  `*/`) or explicit allows (self-assign probes, NUL-delimited guide slots,
  `no-unsafe-optional-chaining` off under `**/tests/**`). `bun run lint` prints
  nothing.

- **Vitest 3.2.7 → 5.0.0.** `vitest` and `@vitest/coverage-v8` bumped
  together after the five-package coverage campaign cleared the 95% gate
  under honest v8 remapping (physics-rapier 95.26% branches). The gate
  itself is unchanged. Oxlint's `**/tests/**` override now also turns off
  `typescript/no-unsafe-*`: Vitest 5's `vi.spyOn` / `MockInstance` types
  trip those rules on suites that were clean under 3.2.7. `tsc -p tests`
  stays clean. Package `tsconfig.json` files (the ones that include
  tests) now set `"types": ["node"]` — Vitest 3 referenced Node from its
  own typings; 5 does not, and TypeDoc's TS 6 pass typechecks those tests.
  Same-day CI follow-up: `@fourjs/particles` was a sixth miss (92.1%
  branches). Ramp-stop validation, empty/NaN lifetime ramps, trail
  store guards, and `computeBounds` non-positive lifetime lift it to
  97.16%.

### Added

- **Dogfooding cycle 6 — §43 interpolated skin palettes.** Guides and
  architecture docs no longer describe interpolated rendering as
  node-matrix lerp only. Consumer-seat proof:
  `tests/integration/interpolated-skin-palettes.test.ts`. Engine was
  clean. The standing dogfood checkbox stays open.

- **`Matrix3` normal-matrix utility and per-draw hoist.** `transpose()`,
  `setFromMatrix4Upper3x3()`, `setNormalFromMatrix4()` — the inverse-transpose
  of a `Matrix4`'s upper 3×3. Lit and standard WebGL vertex stages upload
  `uniform mat3 normalMatrix` once per draw instead of
  `transpose(inverse(mat3(model)))` per vertex. WebGPU follows:
  `DrawUniforms.normalMatrix` (192-byte block); standard extras shifted
  to 192/208. Singular models upload identity on both backends.

- **RFC 0005 pick-latency record.** `benchmarks/pick-latency.mjs` times
  id-pass vs the render list (flagship-order 64 and R-8 10k/50k/100k) and
  fence vs stall `pick()` on the counting-GL seam. Not a gate. The harness
  still times unlit rectangles (no particle systems in those scenes).

- **R-33 simulate / present split.** `examples/particles-demo` publishes
  `data-simulate` and `data-present` in seconds on `#status`. The browser
  gate checks they exist and stay finite; it does not assert a frame budget.
  §112's rendered exit still needs non-SwiftShader hardware.

- **RFC 0003 prototype measurements.** `benchmarks/skinning-resolve.mjs` records
  the 60-bone ×1/×10 resolve (Bone vs Group) and the 180-channel controller vs
  mixer path. Alternative A does not return on cost. The record proposes a
  skinned-mesh §86 sentence from those numbers; it is not a spec amendment.

- **Rapier snapshot-envelope guards.** `rapier-defensive-branches.test.ts`
  covers `countContacts` and the paths a rewritten §34 envelope can reach:
  unknown mass mode, Rapier colliders the metadata dropped, a collider whose
  body left the envelope, and collisionstay without adapter body records.


### Documented

- **Two follow-up rows were already shipped.** The §65 idle-scene batch
  cache (`contentVersion` / `#canSkipUpload`, 0 `bufferSubData` on a still
  run) and §52's concave-extrude lift (`extrudeGeometry` + tessellator)
  were on the tree with tests; TODO.md still described them as open.
  Struck. §55 atlas and shaded-pipeline instancing remain.

- **Dogfooding cycle 4.** Consumer seat (`.dogfood/cycle4`) exercised §56
  `Text`, `.four.json` + §34 snapshot round-trip, and 2D+3D in one scene.
  `digital-twin.md` no longer teaches the throwing `serializeScene` call;
  `fourJS/text` header states `Text` lives on the umbrella; guides README
  distinguishes `examples/mixed-scene` (two worlds) from the one-scene
  flagship. Architecture API/COMPONENTS samples match.

- **12.8s barrels test vs 5s default timeout.** The suite sets `{ timeout: 30_000 }`;
  the 9809ms application figure is a file-aggregate, not a hidden config.
- **A-5 leak audit is opt-in by design.** `auditFinalizedLeaks` is a drain, not a
  runtime warning, for the same reason as `auditResourceLeaks`: finalizers run on
  an unspecified turn.
- **A-19 remainder merged into R-30c.** Same §77 upload work; one checkbox.

## Unreleased — the root is TypeScript 7 only

> **Note on the commit split, recorded because `git log` is misleading here.** This work
> landed as two commits whose messages do not match their contents: `2d05ece`
> (*"build: root is TypeScript 7 only…"*) contains **only** the `eslint.config.js`
> deletion, and `75f0b34` (*"docs: …"*) contains the **entire** toolchain change plus the
> docs. Cause: the staging command hit a bad pathspec and aborted, and I committed without
> checking its exit code. History was already pushed, so it is left intact and corrected
> here rather than rewritten. **Read `75f0b34` for the change.**

The migration to TypeScript-on-Bun is complete for the workspace root. `typescript@6.0.3` had
exactly **two** consumers, so neither could be removed alone; both were addressed together.

### Added

- **Recorded what Bun does and does not offer for docs** (`docs/MIGRATION.md` 3.1b), so nobody
  re-researches it. **Bun ships no documentation generator** — verified three ways: `bun --help`
  (24 commands), `bun pm --help` (11 subcommands), and Bun's own documentation. The docgen work
  in the Bun repo makes Bun's *own types consumable by* an external generator; it is not a
  generator.

  **A check that lied, worth knowing:** `bun docs` did **not** error — it ran this repo's `docs`
  **script**, because Bun falls back to `package.json` scripts for unknown commands. The absence
  of an error proved nothing.

  **`bunx typedoc@<version>` is a real alternative to the tools package**, and an earlier draft
  of this entry was wrong to call it unpinnable. A bare `bunx typedoc` crashes in-repo (Bun
  resolves a locally installed binary first, and the workspace TypeDoc is hoisted to the root
  where it meets TypeScript 7); an explicit version bypasses that and resolves TypeScript 6.0.3
  in its own temp install. It stays unsuitable for the **gate** for three reasons: it is outside
  `bun.lock`, it needs the network on a cold cache, and the peer resolution that makes it work is
  **undocumented** — an observation, not a contract.

  Footgun documented: `bunx typedoc` at the repo root fails with `Cannot read properties of
  undefined (reading 'PropertyDeclaration')`. Nothing is broken; use `bun run docs`.
### Changed

- **ESLint and typescript-eslint are gone; linting is Oxlint.** typescript-eslint refuses
  TypeScript 7 by name. Oxlint's type-aware mode **requires** it — `oxlint-tsgolint` is
  `typescript-go` underneath — so the linter stopped blocking the migration and started
  depending on it. `.oxlintrc.json` replaces `eslint.config.js`.

  Treated as a gate-semantics change, not a dependency bump, so parity was established
  **before** the old config was deleted: **47 of 47** `recommendedTypeChecked` rules reproduced,
  **16 mutation-verified** (a real violation injected for each, and required to be reported),
  0 errors on the tree under both linters. Lint wall-clock **3 m 56 s → 13 s**.

  The load-bearing detail was found by running it rather than reading it: omitting the
  `disableTypeChecked`-for-JavaScript override produced **1,612 findings**, 97% `no-unsafe-*`
  in `tools/*.mjs` and `benchmarks/*.mjs` — plain JS type-linted with no types. With the
  override: 0 errors. An eyeballed port would have shipped that.

  One deliberate difference: Oxlint's default `correctness` category adds **42 warnings** that
  `recommendedTypeChecked` never enabled. They are warnings, the gate passes, and they are kept
  rather than silenced because they are real coverage the old linter lacked. Triage is filed.

- **TypeDoc moved into `tools/docs`, a workspace package owning `typescript@6.0.3`.** It
  consumes the compiler API TS 7 removed, and [its own issue](https://github.com/TypeStrong/typedoc/issues/3098)
  is open with no timeline — so it is isolated rather than waited on. Docs still build at
  **0 errors / 24 warnings**, unchanged.

  **`bun add --dev typedoc` does not work, and the reason is worth recording** so nobody
  retries it: a **peer** dependency resolves from the root, so Bun satisfied TypeDoc's
  `typescript` peer with the hoisted 7.0.2 and TypeDoc died on `PropertyDeclaration`. A
  **direct** dependency of a workspace member gets its own `node_modules`. Both measured.

- **The `ts7` alias is removed.** With the root name free, `ts7@npm:typescript@7.0.2` alongside
  `typescript@7.0.2` was the same package installed twice under two names — a second source of
  truth. All 24 package builds and every root script now name `node_modules/typescript/bin/tsc`
  directly. The explicit path stays: a workspace member can hoist a `tsc`, so `.bin/tsc` is not
  guaranteed to be the root's.

### Fixed

- **`.github/dependabot.yml` carried two ignores that are now false.** The `typescript >= 6`
  ignore would have pinned the root off the compiler it just adopted, and the `eslint >= 10`
  ignore named a dependency the repo no longer has. Both removed, with the reasons recorded.
  The `vitest` ignore stays — blocked by the coverage gap in `docs/MIGRATION.md` section 5,
  which is unrelated to TypeScript.
## Unreleased — TypeScript 7 and Bun 1.4.2

The release gate that said *"wait for TypeDoc"* is gone. It was never the compiler's gate.

### Fixed

- **59 capability tokens and GPU labels still carried the `four:` namespace.** The console prefix
  was fixed on 2026-09-07; this is the rest of the same miss, and it is the larger half —
  **292 occurrences across 59 files**.

  Two classes, both of them "four as a name, tag or handler":
  · **§81 capability tokens** — `four:renderer-registry`, `four:solver-registry`,
    `four:asset-loaders`, `four:component-serializers` and the rest. These are a **public
    extension-point API**: third-party plugins bind to these exact strings. Renaming is free
    now and breaking later, which is the argument for doing it before 0.1 rather than after.
  · **WebGPU debug labels** — `four:frame`, `four:shadow`, `four:lights`, `four:draw-uniforms`.
    These surface in browser GPU captures, so they are user-visible whenever anyone profiles.

  Verified not to be a data-format change first: the tokens are registry keys, never written
  into serialized scenes, and **no JSON, golden or snapshot** contains one.

  The rename is anchored on the string-literal openers (`"four:` and `` `four: ``) rather than on
  the bare token, because this repo has prose that reads *"The remaining four: offset path"* and
  *"Three decimals, not four:"*. A blanket substitution would have corrupted three English
  sentences — they are deliberately untouched.

- **`dev.ts` stopped shipping the retired brand in its own explanation.** The comment describing
  the rebrand spelled the old prefix, and that comment ships in `dist/*.d.ts` — so the fix was
  putting the retired brand back in front of consumers. The lesson is kept; the literal is gone.
  No built artifact now contains it.
- **Every runtime warning still said `[four]` to the user.** The rebrand renamed the packages,
  the scope and the specifiers, but the console prefix is a string literal, not an identifier, so
  it was never touched — `const PREFIX = "[four]"`. Verified at runtime after the fix:
  `devWarn("probe message")` now prints `[fourJS] probe message`.

  Worse than one line: **thirteen hardcoded `"[four] "` literals across eight source files**,
  each re-implementing the prefix in a direct `console.warn` rather than importing it — thirteen
  copies of one fact. `DEV_WARNING_PREFIX` is now exported from `@fourjs/core` and every call
  site imports it, so the next rename is one edit.

  One assertion escaped the first sweep because it is a **regex** (`/\[four\] §10 dropped/`), where
  the brackets are escaped and a plain-string search walks straight past it. Same trap the rebrand
  hit in September; caught here by the test suite rather than by the search.
### Changed

- **The library now builds and type-checks with `typescript@7.0.2`.** Verified from a clean
  tree, not from an exit code: 24 packages, **315 `.js` + 315 `.d.ts`** emitted, and **7,246
  tests across 282 files** passing against artifacts TS 7 produced. TS 7 was also proved to be
  really checking — an injected `TS2322` is caught at the right line, so the green is not a
  compiler that looked at nothing.

- **`typescript@6.0.3` stays installed, for TypeDoc and typescript-eslint only.** TS 7 is the Go
  port; its package exports `.` as `lib/version.cjs` plus `unstable/*`, so the legacy
  `import ts from "typescript"` compiler API no longer exists. Measured rather than inferred:
  TypeDoc dies with `Cannot read properties of undefined (reading 'PropertyDeclaration')` and
  typescript-eslint refuses with `typescript-eslint does not support TS 7.0`. 6.0.3 is the newest
  release both accept, and both are still the latest published versions — this is not a stale pin.

- **Every `tsc` call now names its compiler by path.** Both packages ship a binary called `tsc`,
  so `node_modules/.bin/tsc` is decided by install order — it was pointing at TS 7 while
  `typescript` resolved to 6.0.3, meaning the build had already switched compilers by accident.
  The 24 package builds run `node ../../node_modules/ts7/bin/tsc`; nothing uses the shim.

- **Bun 1.4.2** locally (was 1.4.0 while CI ran 1.4.2 — every local gate this week ran on a
  different runtime than CI), and `engines.bun` raised `>=1.2.0` → `>=1.4.2` to match the
  `packageManager` pin and the workflows.

### Added

- **The TypeDoc blocker now has a TESTED solution, not a sketch** (`docs/MIGRATION.md` 3.1b).
  A workspace package carrying `typedoc` + `typescript@6.0.3` as its own dependencies, with the
  root moved to `typescript@7.0.2` and TypeDoc removed from it: Bun nested the conflicting
  version rather than hoisting it (root **7.0.2**, tool package **6.0.3**), and the nested
  TypeDoc built the repo's real docs at **exit 0, 0 errors, 24 warnings** — identical to the
  current baseline.

  **The finding that matters is that isolating TypeDoc alone buys nothing.** With TypeDoc
  isolated and the root on TS 7, the root immediately fails on `typescript-eslint does not
  support TS 7.0`. `typescript@6.0.3` has two consumers, so removing one leaves the other
  holding the root exactly where it was. Isolation + the Oxlint swap together take the root to
  **TypeScript 7.0.2 only**; either alone changes nothing. Both halves are now verified
  independently on this repository; neither is landed.
- **`docs/MIGRATION.md` — blocker research and alternatives (2026-09-08).** Each blocker was
  tested on this repository rather than read about.

  **Oxlint is a real answer to one of the three, and it inverts the problem.** Its type-aware
  mode does not merely tolerate TypeScript 7 — it **requires** it, being powered by
  `oxlint-tsgolint`, i.e. `typescript-go`. Verified here: type-aware rules genuinely fire
  (injected `no-unsafe-call` / `no-unsafe-member-access` caught at the right positions), and all
  three repo-specific guards survive — `Date.now` and `Math.random` via
  `no-restricted-properties`, `export default` via `import/no-default-export`, which is a better
  instrument than the AST selector it replaces. Measured: **4.4 s** whole-repo, **13 s** with
  `--type-aware`, against **3 min 56 s** for the current ESLint run. The one genuine gap is
  `no-restricted-syntax`, which Oxlint reports as absent by name and which this repo only used
  for the default-export ban.

  **TypeDoc cannot be waited on.** Its TS 7 issue is open with no timeline, the work is an API
  port done "an hour or two per week", and it depends on TypeScript **internals**, which carry
  no compatibility promise. Isolation or replacement is the plan; `@microsoft/api-extractor`
  proves the pattern by declaring `typescript` as a direct dependency rather than a peer.

  **A verdict in this document was wrong and is corrected.** Section 4.1 said the `bun build`
  declaration gap was "not a small gap". Measured across all 24 packages, the codebase is
  **107 `isolatedDeclarations` annotations** away from a tsc-free `.d.ts` emit, with **9
  packages already clean**. That is a bounded task, not a blocker — the reason to keep `tsc -b`
  is now cost/benefit, not capability.
- **`docs/MIGRATION.md`** — what TypeScript-on-Bun can and cannot do here, and why.

  Written because the question kept being answered from summary rather than from measurement,
  and because the previous answer in `COMPATIBILITY.md` was wrong in a way that cost real time:
  it read the TypeDoc peer range as the constraint, which put this library's compiler on another
  project's release schedule.

  Scores the five layers separately — package manager, type checking, library build, test runner,
  example bundling — because they are said in one breath but succeed and fail independently. Two
  are done, one is ours to fix, and two are blocked on other projects.

  Records the root cause once: TypeScript 7 is the Go port, its `"."` export is
  `lib/version.cjs`, and the compiler API every type-aware tool consumes no longer exists. Shows
  both resulting failures verbatim rather than describing them, states what is **not** a blocker
  so nobody re-investigates it, and carries the commands to re-measure every figure — a
  measurement expires when its instrument changes.
- **`typecheck:ts6` — a CI gate for the two compilers disagreeing.** It earned itself
  immediately: TS 6.0.3 rejects the `.ts` import extensions in three §93 examples that 5.9 and
  7.0 both accept (`TS5097`). Without the gate the examples would have quietly become
  TS7-only. Fixed with `allowImportingTsExtensions` on the examples project, which is `noEmit`
  and bundled by Vite.

- **`tsconfig.json` at the root, and `typecheck:config`.** `playwright.config.ts` and the two
  vitest configs belonged to **no project at all**, so nothing type-checked them and type-aware
  lint read them through typescript-eslint's inferred default project. That worked by luck: the
  inferred project happened to supply `@types/node` under TS 5.9 and stopped under 6.0, turning
  `process` into an unresolved type and producing **24 `no-unsafe-*` errors** in
  `playwright.config.ts` alone. They have a real project now, `allowDefaultProject` no longer
  claims `*.ts`, and type-aware linting on that file is verified by mutation.

### Fixed

- **Stale `node_modules/four` and `node_modules/@four`** from before the rebrand — declared by no
  manifest, so a leftover `@four/*` import would have resolved locally and failed on CI's fresh
  install. No such import exists (checked); the debris is gone and the build still passes.

- Two false claims in `examples/tsconfig.json`'s own comment: the umbrella specifier is `fourJS/`,
  not `four/`, and this repo runs `bun`, not `pnpm`.
## Unreleased — a red gate nobody was reading, and two docs that had gone false

Closes (D) and (E1) of the four decisions delegated on 2026-09-07, and fixes a failing test
gate found while running them.

### Fixed

- **`bun run test` was RED on `main`.** `SeededRandom > scales nextFloat01 exactly by 2^-32`
  exceeded vitest's 5s deadline (5435ms) and failed as a timeout, which reads as a broken PRNG
  rather than as a slow test. The cause was **60,000 `expect()` calls** (20,000 iterations x 3)
  to prove one deterministic identity: the draws are free, the assertion machinery is not.

  The proof sits in the same file — `is uniform enough` makes **80,000** draws in **17ms**, four
  times the work, because it asserts nine times instead of a quarter of a million.

  Both hot loops now compare in plain JS and assert once. Coverage is identical (every draw is
  still checked against every condition) and the failure message gained the draw index and the
  value, which `expect`-in-a-loop never gave. `nextRange` went **3774ms -> 4ms**; the suite now
  reports no timeouts and no failing tests.

  Verified by mutation, not by the green tick: dividing by `2^32 - 1` instead of `2^32` is caught
  at draw 0. The first mutation attempt proved nothing — `@fourjs/core` resolves to the **built**
  package, so a `src` edit stays invisible until that package is rebuilt.

### Changed

- **`KeyboardInput`'s dev error pointed at an answer that no longer exists.** It told callers
  wanting raw game input to "listen to the DOM directly, as `examples/character-controller`
  does" — untrue in both halves since `KeyboardState` shipped and that example adopted it. It
  now names `KeyboardState`, and the two classes cross-reference each other.

  The proposed **rename of `KeyboardInput` was deliberately not carried out.** `PointerInput` and
  `KeyboardInput` are a symmetric pair of §72 event sources — platform events in, scene events
  out, routed by picking and by focus respectively — and the name is accurate in that frame. The
  real defect was that the package offered no polled-state option at all, so the one
  keyboard-shaped class got reached for by people who wanted the other thing. `KeyboardState`
  removed that cause; renaming would churn 100 references and break a documented pair to fix
  something already fixed.

- **`TimeState` now states its unit.** Six of its duration fields never said "seconds", and both
  `performance.now()` and `requestAnimationFrame` hand out milliseconds — a substitution that
  type-checks and produces motion 1000x too fast rather than an error.
## Unreleased — the two capability gaps dogfooding found are closed

Decisions (B) and (C) of the four delegated on 2026-09-07. Both were found by building a
consumer app rather than by reading the code, and both are about what the library did not
offer rather than what it got wrong.

### glTF loads its own external buffers now

`createGltfLoader()` defaults its transport to `globalThis.fetch`. The commonest glTF shape —
a `.gltf` naming an external `.bin` — failed on a first attempt, because `AssetManager`
resolves the global by explicit WP-11.2 decision while the loader it is handed did not. The
manager fetched the document and the loader could not fetch the buffer beside it.

Implemented by EXPORTING `AssetManager`'s existing `resolveGlobalFetch` package-internally,
not by writing a second copy: two implementations of "what transport do we default to" is the
second-source-of-truth defect found elsewhere in this repo three times this week. Resolved per
load rather than at construction, so a stubbed or late-installed global is still seen — which
is also what makes it testable. The refusal survives for the case it was written for: a
runtime with NO transport still refuses loudly and still names `{ fetch }`.

### `KeyboardState`, the twenty lines every consumer rewrote

`@fourjs/input` shipped without the thing "input" most obviously means — *is W down right
now*. Three consumers in this repo had written it themselves and disagreed:
`character-controller` keyed on `code`, a flight-sim probe on `key.toLowerCase()`.

`KeyboardState(surface)` gives `isDown(code)`, a frozen live `held` view and an idempotent
`dispose()`. It keys on **`code`**, the physical key, so an AZERTY layout cannot change which
key WASD means. `held` is a Proxy that passes reads through and throws on mutation — a plain
`ReadonlySet` cast compiles and still lets a JS caller corrupt engine state.

Built on the existing `KeySurface` seam rather than taking `window`, so the behaviour that
justifies owning this centrally — clearing every held key on `blur` — is covered by a test
with **no DOM**, instead of a comment claiming it.

**A correction, because it is the better argument.** Converting
`examples/character-controller` I first wrote that it "had the bug". It did not — it handled
`blur` correctly all along. That makes the case for the helper stronger, not weaker: the code
was right and every consumer still had to write it, so whoever forgot the `blur` half walked
forever after an alt-tab. Deleting a *correct* copy is the point.

This does not close the `KeyboardInput` naming trap — that is (D). What it removes is the
reason people reach for the wrong class: there is now a right one.

### And a gate I ignored

`94a0ecc` was committed and pushed with `bun run lint` FAILING. I ran it, it printed FAIL, and
I pushed anyway. The failure was trivial (a redundant `as never` in a test) and is fixed in
`021b5aa`, but the miss is worth recording on its own: a gate that is ignored is worse than a
gate that is missing, because the next reader reasonably takes green as checked.

## Unreleased — Stage 3, and the TS 7 block turns out not to be a block

**Stage 3.** The repository and its directory are `fourJS`: GitHub renamed, remote updated,
local directory moved, fetch verified from the new path. The old `four.js` name survives only
where it is history (CHANGELOG entries) or data (`gltf-scene` asserting a fixture's content).

One thing worth keeping from the rename: `mv` failed with **"Device or resource busy"** and the
holder was my own shell — its working directory had been inside the repo. Renaming from a
separate process succeeded immediately. A directory you are standing in cannot be renamed by
the process standing in it, and the error names a device rather than the cause.

**The TypeScript 7 item was mis-framed, and researching it properly dissolved it.**

It read "lift the pin once typedoc supports TS 7" — which put a release gate on another
project's roadmap. It does not need to:

- **TS 7 is the Go port of the compiler.** typedoc consumes the compiler API, so it CRASHES
  rather than warning — and a peer-range bump was never going to be the signal to watch for.
- **The repo's own measured matrix already said the answer:** TS 7.0.2 gives *docs crash, lint
  **passes***. Only the docs step blocks it.
- **typedoc resolves its OWN TypeScript.** Verified: an isolated install printed *"Using
  TypeScript 6.0.3 from ./node_modules/typescript"*.
- **Proven end to end:** that isolated typedoc, run against this repo's real sources and
  `typedoc.json`, produced **0 errors / 24 warnings** — identical to the workspace baseline.
  The "TS 6.0.3 → docs 7 errors" recorded in `dependabot.yml` was `@types/node` unresolved
  through workspace hoisting, not a typedoc/TypeScript incompatibility.

So the docs step can keep its own pinned typedoc + TypeScript and the workspace is free to
move to TS 7 whenever that is wanted. Nothing is broken today — the workspace is on 5.9.3 with
every gate green — so this is a deferred UPGRADE, not a defect, and should not count against a
release gate.

**Two corrections to my own research**, recorded because each nearly became a false finding.
typedoc's `1.0.0-dev.*` versions sort last in `npm view versions` but were published in **2020**
— I briefly read them as a newer release that fixed this. And my earlier "still blocked" rested
on `peerDependencies` from the `latest` tag alone: one signal, reported as research.

## Unreleased — Stage 2: the packages are `fourJS` / `@fourjs`, and it broke twice first

Authorised by Daniel: *"Stage 2 @fourjs"*, *"All imports from four/* need to change to
fourJS/*"*, *"We can't use four as a name or tag or handler for a library."* Nothing in the
workspace is called `four` any more.

| | | |
|---|---|---|
| `@four/<pkg>` | `@fourjs/<pkg>` | 7,378 replacements, 848 files |
| `four` | **`fourJS`** | umbrella package + every module specifier |
| `packages/four` | `packages/fourjs` | directory (lowercase — see below) |
| `four.js-monorepo` | `fourjs-monorepo` | root workspace |

The case split is deliberate: the SCOPE is lowercase `@fourjs/*`, the package NAME is
`fourJS`, and the DIRECTORY is lowercase. Published identity is untouched —
`@danielsimonjr/fourjs`, because npm forbids capitals.

Done surgically, not by blanket replace: bare `four` is a WORD here (`assert.equal(count,
"four")`, `"four": 52`), so only module specifiers, package names, dependency keys and
paths moved.

**It broke twice, and each break is worth keeping.**

**1. Bun's path filter cannot match a capitalised directory.** CI died on Linux with a bare
`error: FileNotFound` from `bun run --filter './packages/*'`. Isolated:

```
bun run --filter 'fourJS' build             -> exit 0
bun run --filter './packages/fourJS' build  -> "No workspace packages matched"
```

Resolving a workspace by NAME with a capital is fine; filtering by PATH is not. So the
directory is lowercase and the name keeps its capital — they need not agree, and none of the
others do (`@fourjs/render-webgl` has always lived in `packages/render-webgl`). It passed
locally because Windows is case-insensitive: only a case-sensitive runner could show it.

**2. A rename can miss a regex precisely because the regex escapes the thing being renamed.**
`apply-publish-names.mjs` matches with regex literals where the scope is written `@four\/`
— with an escaping backslash — so the literal `@four/` never appears and a string-level
rename walks straight past it. `rewriteCode` then matched NOTHING: the test expected 5
substitutions and got 0. Its fixture also used an UNQUOTED `four:` key, invisible to a
quoted-key pattern. The test now pins the capitalisation by asserting lowercase `fourjs` is
NOT the umbrella.

**Three gates caught what no search could**, because their paths are BUILT rather than
written: §33's `GATED` map (`join("packages", "four", …)`), §96's bare-name package
allowlist, and the publish-mapping test. Each failed loudly and named the cause.

Verified on the runner, not just locally: CI, Docs and Release all green.

## Unreleased — a directory-scoped `git stash` ate part of the rebrand

Asked whether the rebrand was finished, I measured instead of recalling — and found 11
occurrences of `four.js` still in the AUTHORED architecture docs (`API`, `ARCHITECTURE`,
`COMPONENTS`, `DATAFLOW`, `OVERVIEW`) plus the `COMPATIBILITY` preamble.
`# four.js - System Architecture` was still the first line of the architecture doc an hour
after I reported the rebrand done.

They had been rebranded, and then I destroyed them. Testing whether the dependency-graph
generator was stable, I ran `git stash push -- docs/Architecture/` for a clean baseline,
regenerated, and later `git stash drop`.

**The trap is that the directory holds both kinds of file.** The generated ones were rebuilt
by the next `bun run graph`, so they lost nothing and everything looked fine. The authored
ones in the same directory had their edits thrown away with the stash — silently, because
nothing re-reads a hand-written doc after a regeneration, and no gate compares prose to a
brand.

Restored: 11 replacements across the five authored docs, plus `COMPATIBILITY.md`'s title,
which sits outside its `BEGIN GENERATED` block (the generator contains no occurrences, so
the title is authored text). Generated blocks verified untouched — check-compat, check-docs
and check-spec all OK.

The 11 that remain are deliberate: CHANGELOG history (5), `TODO.md` quoting the old name
inside filed items (3), `ui-demo`'s rendered label (1, blocked on a Linux golden), and
`gltf-scene.test.ts` asserting the fixture file's own content (1).

**Carry this forward: `git stash` scoped to a directory mixes generated and authored files,
and regenerating restores only one of them.** The half that cannot regenerate disappears
with no failing gate to announce it.

## Unreleased — what the rebrand broke, and why local green was not CI green

The rebrand turned `main` red twice. Both were mine, both are fixed, and the second one is
the more useful failure.

**1. A rendered string is pixel-coupled.** `examples/ui-demo`'s title label is drawn on the
canvas, so changing it invalidated the §92 visual goldens. Those are `-visual-linux.png`
because CI is ubuntu, and `--update-snapshots` on Windows writes `-visual-win32.png` beside
them — leaving CI equally red plus two dead files. With no Docker here and no snapshot-update
path in CI, that one label keeps its old spelling, with the reason at the call site and the
exact Linux command filed as Stage 1b. Stray `-visual-win32/-darwin.png` are now gitignored so
a local run cannot leak a golden that could never match CI.

**2. The pass rewrote an assertion about a file it did not rewrite.**

```
- Expected: "fourJS §78 integration quad"     <- the test
+ Received: "four.js §78 integration quad"    <- the fixture file
```

That assertion is not branding. It checks the parse tier carried the DOCUMENT's own `extras`
faithfully, so the string belongs to `tests/fixtures/gltf/quad.gltf`. The pass covered
`.md/.ts/.mjs/.html/.json`; a glTF document is `.gltf`. The expectation moved, the data did
not. Reverted, with the reason at the call site.

**The lesson is about verification, not renaming.** I checked with `bun run test`, which runs
the 24 PACKAGE suites — and `tests/integration` is not among them. My green was a smaller claim
than CI's. Now verified the way CI verifies: typecheck:examples, typecheck:tests, check-compat,
check-docs, check-spec, plus `tests/integration` (507) and `tests/determinism` (169).

`docs/COMPATIBILITY.md` was regenerated too: correctly excluded from the pass as a generated
file, but its SOURCE declarations were rebranded, so the committed output went stale.

## Unreleased — both described personas re-run against current main

They were last exercised on 09-06, before ten commits landed. A scenario that passed yesterday
says nothing about today's tree, so both were re-run rather than recalled. **Both pass, and the
fixes they produced are holding.**

**Flight simulator (indie studio).** Flown under real key input, not merely loaded: orientation
composes from identity to `[-0.398, -0.138, 0.553, 0.719]`, position `[0,60,350]` →
`[-237,176,746]` — rolled left, climbed, accelerated 120→157 — chase camera trailing, zero page
errors. The `FollowRig` crash found on 09-06 stays fixed.

**A drift bug I nearly reported, and did not.** The quaternion norm computed from the app's
telemetry read `1.000062`, which looks exactly like normalisation drift a simulator cannot
tolerate. The app's diagnostic rounds the quaternion to 4 decimals. Measured at full precision
from the live value, the norm is **exactly 1**. The instrument was mine, and a rounded readout
cannot measure a deviation smaller than its own rounding.

**Two-cylinder boxer (engineering student).** The crank turns — θ swept a full revolution over
400 samples — so the frozen-engine defect from 09-06 (a dynamic body with no collider has zero
angular inertia) stays fixed. Against closed form: piston error **mean 0.46 %, max 0.99 %** of a
1.0043 stroke; mirror invariant `|x_A + x_B|` mean 3.4 mm, max 9.5 mm; piston **y-drift exactly
0**; zero errors.

**One number left unexplained on purpose.** On 09-06 I recorded a mean piston error of 1.56 mm
(0.16 %); today the same app measures 4.62 mm (0.46 %) — about 3×. Both are small and every
invariant holds, but calling that "consistent" would be smoothing: the sample window, crank
speed and Rapier version (0.20 landed 09-06) all differ, and no controlled comparison was run.
Neither figure should be quoted as the engine's accuracy until one is.

## Unreleased — the duplicate "First publish" row is deleted, not pointed at

Follow-up to the audit. Two verifiers independently recommended deleting the duplicate row
rather than keeping the pointer I left this morning, and they are right: the charter's rule is
that **deleting a duplicate beats syncing it**, and a pointer is a mild form of syncing — a row
that itself has to be maintained and re-read. It carried no unique content, and
"Gap-closure wave 3" appears nowhere else in the file, so nothing referenced it.

Verified after deleting rather than assumed, because deleting the wrong row would be silent:
the canonical row survives, and `git diff` shows exactly the three pointer lines removed. (A
first check printed "0 rows remaining" and looked alarming — that was a broken grep pattern in
my own command, not a lost row.)

## Unreleased — TODO audited against CHANGELOG and code: 1 closed, 2 sub-parts struck

The first audit that cross-referenced **TODO.md against CHANGELOG.md**, not just against the
code — the direction never checked before. 23 open rows, all 23 examined, three fan-out
verifiers plus my own checks on the rest.

**Result: 1 item closed, 2 sub-parts struck, 20 correctly open.** A low yield, which is the
honest finding: this backlog is mostly deferred-by-decision packets, not stale bookkeeping.

- **`A-1 follow-ups` CLOSED.** Its last live sub-part asked that `__FOUR_DEV__` drop the §84
  path from production bundles. It already does: `examples/ui-demo/dist`, rebuilt from source,
  contains **zero** occurrences of `cpuFrameTime`, `textureMemory` or `__FOUR_DEV__`, and
  `dev-build-mode.test.ts` proves it through a real Vite build with `stats: true` explicitly
  asked for. The trailing "ui-demo headroom is still thin" is a standing measurement (48.47 kB
  against 49.5 kB), not an unmet ask, and it has its own row — closed 2026-09-07. Sub-part (e)
  is a stated non-goal ("§84 does not name it").
- **§65 glyph batching struck** from the batching row. CHANGELOG (R-28) and
  `four/src/text-node.ts:71` both say it outright: labels sharing a material merge into one
  draw, which *"closes §65's glyph-batching strategy at the label level"*. The residue named
  there — grouping labels that do NOT share a material — is the atlas-grouping sub-part already
  listed separately, not a second open claim.
- **RFC 0005's `Rectangle2` prerequisite struck** from the R-1 follow-ups.
  `render/src/renderer.ts:464` states it directly: *"`readPixels` joined the interface when
  `Rectangle2` landed in `@fourjs/math` (2026-08-29; RFC 0005's recorded prerequisite, cleared)"*.

**One verifier was overruled.** It reported `A-1 follow-ups` should stay open. The synthetic
bundle test it relied on is not the same claim as the real example bundle, so I rebuilt
`ui-demo` and checked the shipped artifact. A relayed verdict is a hypothesis until the
load-bearing half is checked.

## Unreleased — dogfooding cycle 3d: our error messages name minified classes

Round-tripped a scene through §34/§79 in the browser — the "save my game" path — and the failure
told me my node was **"a Ur"**.

It is a `Renderable`. `Ur` is what the minifier called that class, and the message interpolates
`constructor.name`. Proven by A/B on the same app with only `build.minify` changed: unminified
says `Renderable`, minified says `Ur`. Minified is what every consumer ships, so the useful
name exists only in the build where the error matters least.

It happens **twice per site** — in the prose and again in the structured `context.nodeClass`, so
a tool reading the context gets the mangled name too — across **5 sites in 2 packages**
(`core/src/component.ts`, `serialization/src/serializer.ts`). Every one is a §79 diagnostic:
the errors that fire while a consumer is still wiring serialization up. The fix is to source
the name from something minification cannot rewrite — the registry's type names, or a
`static readonly nodeType`.

Learned alongside it, and worth stating because it shapes the first save a consumer attempts:
`serializeScene` refuses any node it has no type name for, which today means anything that is
not a `Group`. So "save my scene" fails on the most ordinary scene there is — one holding a
`Renderable` — until `nodeTypeOf`/`nodeFactory` are supplied. Documented, clearly signposted by
the error, and the same shape as the glTF transport gap: the default path does not cover the
common case.

## Unreleased — §62's renderer abstraction verified from outside: a two-line swap

Dogfooding cycle 3c. The claim a renderer abstraction makes is that a consumer can change
backends without changing their app; that had never been tested from a consumer's seat, only
from inside the suite.

Swapping `WebglRenderer` → `WebgpuRenderer` in the cycle-3 app is **two lines** — the import and
the constructor — and nothing else moved. Measured side by side on the same app:

| | WebGL | WebGPU |
|---|---|---|
| glTF | loaded | loaded |
| particles alive | 245 | 247 |
| tween range | 1.025–1.550 | 1.050–1.575 |
| lit pixels | 9,462 | 10,903 |
| console errors | 0 | 0 |

Assets, particles, animation, UI and §42 authority all behaved identically across backends.

The single WebGPU-only message is §10's dropped-time guard on the slower first frame — *"dropped
0.0666s of simulation time this frame (maximumSubSteps=5) … TimeState.droppedTime is now
0.0666s"*. That is the documented guard doing its job, and it names the field to inspect. It is
also the same mechanism behind the look-key gate fixed earlier today, which is a useful
consistency: the engine reports the thing that bit that test.

Recorded as a **strength**, not a finding — the coverage map now carries it, and the surfaces
still unexercised are text/§56, browser §34 round-trip, and the 2D↔3D story.

## Unreleased — §78 glTF is demonstrated, not just tested

Cycle 3's fourth finding, fixed. `examples/gltf-model` is the fourteenth example: it builds a
loader with `createGltfLoader`, hands it to `AssetManager.load`, and assembles the result with
`instantiateGltf`. "Load my model" is the first thing anyone tries with a 3D engine, and until
now the only worked reference was a test.

It is written around the two things a first attempt gets wrong — both found by doing exactly
that in cycle 3: the entry point is `createGltfLoader`, not the `loadGltf` a newcomer reaches
for, and a `.gltf` naming an external buffer needs `{ fetch }` or the load fails on the `.bin`
the manager never sees.

Gated like the other authored sites. `tests/browser/gltf-model.spec.ts` (port 4183) asserts
**both** halves, because either alone can pass while the feature is broken: that the external
buffer assembled (`nodes > 1`, which a document-only load cannot reach) and that the result
reached the screen (13,340 lit pixels measured; floor 4,000).

Two notes from building it:

- **The docs gates earned their keep.** They refused the change twice on counts I had not
  thought about — AUDIT-120's example count (it reads `git ls-files`, so it stayed red until
  the files were staged) and `tests/README.md`'s spec count. Both now say 14 and 31.
- **The readback in the new spec deliberately differs from its siblings.** Drawing a WebGL
  canvas into a 2D context after compositing yields a blank image without
  `preserveDrawingBuffer` — it measured 0 lit pixels while the model was plainly drawn. The
  sibling specs decode the PNG with a local `decodePng`, a ~241-line block each carries its own
  copy of; one assertion does not earn a sixth copy, so the page decodes its own screenshot.

## Unreleased — the README now names the one rule that stops your animation working

Cycle 3's fifth finding, fixed. §42's transform authority is mandatory knowledge for animating
anything and appeared **0 times** in `README.md`. The note now sits in the blockquote that
already sends readers on to *"authored animation"* — the precise step where the rule bites.

The snippet is deliberately unchanged: it writes `circle.position` by hand, which is legal
under the default `"manual"` owner, so it was never wrong. What was missing is the sentence
after it — that handing the node to a tween or a motion system requires saying so, and that the
engine **refuses** the write rather than applying it, so the symptom is a node that simply does
not move.

Gates re-run rather than assumed: `check-docs` OK, `check-spec` OK, and the README browser gate
still passes 2/2 — which matters here, because that gate executes the snippet.

## Unreleased — dogfooding cycle 3: five findings, none of them a broken engine

Built a character-select screen from a consumer's seat (`.dogfood/charselect`) to reach the
surfaces the coverage map listed as untouched, and ran it in a real browser rather than
headless-only. **The engine did not misbehave once.** Every finding is about what a user is
told, not about what the code does — which is its own signal at 0.1.

- **`KeyboardInput` is a naming trap, and a DEV message did not fix it.** I wrote
  `new KeyboardInput({ target: window })` and `keys.isDown(…)`; both wrong. The class's own
  comment *predicts that exact mistake*, and a DEV error was added for it on 2026-09-06 — yet I
  made it again from scratch with the mitigation in place. Worse, the gap it hides is real: a
  grep for `isDown`/`heldKeys`/`pressedKeys` across every package returns **zero**, and
  `examples/character-controller` hand-rolls `new Set<string>()` off DOM listeners. Every game
  consumer reimplements ~20 lines the library should own.
- **`TimeState` breaks the convention the library teaches.** 163 uses of `deltaSeconds`
  against 27 of `deltaTime`, 13 distinct `*Seconds` identifiers, a README promising "radians
  and seconds everywhere" — and the object every `update` handler receives calls it
  `deltaTime`. I typed `deltaSeconds` without hesitating.
- **The first glTF a consumer loads fails.** `createGltfLoader({})` cannot fetch an external
  `.bin`, while `AssetManager` already defaults its transport to `globalThis.fetch` by explicit
  decision (WP-11.2). The manager fetches the document and the loader cannot fetch the buffer
  beside it. Proven both ways: failed with `{}`, loaded with `{ fetch }`.
- **§78 glTF ships tested but undemonstrated** — zero examples mention glTF, so the first thing
  a user tries with a 3D engine has no worked reference.
- **§42 `transformAuthority` is mandatory to animate anything and appears 0 times in the
  README.** A tween on a README-shaped scene moved nothing: timeline running, `scale.x` pinned
  at 1.000, because "manual" owns the transform. Setting the authority fixed it — 1.000 → 1.050,
  and the rendered box grew 7,938 → 10,080 lit pixels.

**What went right, and is worth protecting:** every one of those failures announced itself with
an actionable message naming the fix — `start()` before `initialize()`, the glTF transport, a
mistyped tween path (`"t.s.nope"` throws with the path and key in context), and the §42 refusal.
The §42 warning is unconditional, so production users get it too. Nothing failed silently.

**Two corrections to my own measurements**, recorded because they nearly became findings:
`readPixels` returned `0,0,0,0` and looked like "nothing rendered" — it is the
after-composite trap, and a screenshot showed 7,938 lit pixels. And my browser probe captured
only `console.error`, so it reported "0 errors" while the §42 warning was being emitted the
whole time.

## Unreleased — A-4 closed: step 3 was never possible, and the item knew why

`A-4 remainder` carried three sub-parts. Two were settled; the third contradicted the second,
and nobody had said so.

- **Step 2 (the §85 validation catalogue) is done**, verified rather than assumed:
  `diagnostics/src/validation.ts` is 278 lines / 18 exports, re-exported from the package
  entry, covered by its own test, and consumed by `packages/fourjs`. A catalogue nothing
  imported would not have counted.
- **Step 3 (convert scene/physics checks to `devAssert`) is WON'T-DO.** `devAssert` opens
  `if (!DEV) return`, so converting those checks means the simulation packages import the
  build flag. They do not, and may not: `GATED` in `dev-build-mode.test.ts` lists 26 files and
  **not one** is from `packages/scene` or `packages/physics`.
- **Step 4 was already reverted on 2026-09-06 for exactly this reason**, and the item recorded
  that revert one line above the step it invalidated. The contradiction sat in plain sight.

This is §33 working, not §33 in the way: a replay recorded in a development build must
reproduce bit-exactly in a production one, so a simulation package has to behave identically
in both. Checks that want `DEV` belong in `@fourjs/diagnostics` — already gated, and already the
catalogue's home. Scene and physics keep unconditional `console.warn` with WeakMap
suppression, which is what `warnAuthorityConflict` settled on when step 4 came out.

Method note: the first grep for the flag reported 3 hits in scene and 2 in physics. All five
were **prose** — `authority.ts` literally says *"not `DEV` / `devWarnOnce`"*. Matching real
`import` statements instead returns zero across all six simulation packages.

## Unreleased — AUDIT-120 had drifted in both directions at once

Chasing one TODO row — "qualify `AUDIT-120.md`'s *basic 3D meshes: shipped* row honestly" —
turned up three defects, and the original row was wrong the opposite way round from the one
the TODO assumed.

- **`basic 3D meshes` was UNDER-evidenced, not overstated.** Its evidence column named only
  `boxGeometry`, which reads as a box-only tier. `primitives-3d.ts` ships nine more — sphere,
  cylinder, cone, capsule, torus, lathe, extrude, tube, heightField. Now cited, with what is
  genuinely staged (skinning/morph per RFC 0003, and §52 tessellation for the concave-extrude
  restriction) named instead of implied.
- **`basic colliders` still said "§24's remaining shapes are staged"** — a month after they
  shipped (PH-22a, 2026-08-02).
- **S-2 still claimed `{ type: "cylinder" }` is "deliberately a compile error".** It compiles;
  the shape ships. The staging record is kept as history, now labelled RESOLVED with its
  untrue lines called out, rather than quietly rewritten.

Re-verified rather than taken on the older entries' word: all eight §24 shapes are defined in
`packages/physics/src/shapes.ts` AND wired into both Rapier converters — a type with no
converter would not have counted. `TODO.md` also carried a **stale duplicate** row for the same
§24 work, still open beside the line that recorded it done; the 2026-08-05 sweep that "retired
stale §24/§12 entries" had missed this copy. Gates: `check-docs` and `check-spec` both OK.

## Unreleased — the look gate measured the runner, not the controller

`main` went red on a **docs-only** commit (run 34090671121), which is the tell that the gate
was never testing our code:

```
Error: yaw moved -0.133 — → did not turn right      (YAW_MINIMUM = 0.35)
```

The message misled twice over. The camera turned the **right way** — `yaw0 - yaw1` was `+0.133`
— it simply did not turn far enough, and "did not turn right" reads as a direction bug.

Root cause: look is integrated in `fixedUpdate` as `rad/s × the injected fixed delta`, so it
advances with SIMULATED time, while the gate held the key for 0.6 seconds of **wall-clock**.
§10's dropped-time guard discards the backlog when the rAF loop is starved, so on a contended
runner 0.6 real seconds bought about 0.12 simulated ones. The gate was measuring the
container's spare capacity.

`YAW_MINIMUM`'s own doc claimed "59 % margin on the measurement" — and the run came in at
0.133, **6.4× under** the 0.853 reference. Margin is the wrong instrument for starvation: no
threshold chosen against measurement noise survives a loop that barely ran.

`holdUntilMoved` now holds each look key until the published value has moved far enough, capped
by a 10 s timeout that exists to end a hung page rather than to time the turn. A slow runner
takes longer in wall-clock to reach the same simulated state instead of failing. The gate still
fails for every reason it should: no turn, too slow, or the wrong way — the wait is on the
absolute delta, and the signed assertion that follows still owns the direction claim. Verified:
5/5 character-controller specs pass.

## Unreleased — TODO audit against the code (2026-09-07)

A verification pass over the 21 open items after #70-#78, to find any that the code had already
closed. **Result: one row was wrong, one was duplicated, and the rest were open for good reason.**
Two of the three findings are corrections to claims, not code changes.

- **`A-5` "leaked resources" stays open — but not for the reason it said.** The row read "now
  _derivable_ from the counters, but nothing warns". The mechanism does now exist and is tested:
  `trackDisposable` is wired behind `if (DEV)` at `geometry`/`materials`/`render`
  `resource-memory.ts`, with `core/tests/leak-registry.test.ts` and its diagnostics twin covering
  it. What is missing is a trigger: `auditFinalizedLeaks` — "the call that prints", by its own
  doc — is reached only from the re-export lists and its own tests. **No engine path calls it**,
  so it is an opt-in audit rather than a warning the runtime raises. Closing it needs either an
  engine-side caller or an explicit line saying opt-in is the design. Row rewritten to say that.
- **"First publish (§94 0.1)" existed TWICE**, in wave 3 and again under Documentation, each
  looking authoritative. Two rows for one task drift apart; the second is now a pointer. The
  canonical row records what is actually done — `release.yml`, `apply-publish-names.mjs` with its
  own test, #67 merged, versions bumped — and what is not: **no tag, nothing on npm.** It is
  blocked on the owner's "not ready until more dogfooding", not on missing work.
- **The other 19 are correctly open**, including two that describe the same unshipped renderer
  gap (§77 cube/array/3D + compressed containers) from two places, and one standing assignment
  that by design never terminates.

## Unreleased — browser gate: assert §84's contract, not the runner's GPU

`main` went red on 2026-09-07 (run 34082373822, 104 passed / 1 failed) at
`motor-digital-twin.spec.ts:613`:

```
expect(status["gpuframe"]).toBe("nan")   Expected: "nan"   Received: "0.015531"
```

**The code was right and the test was stale.** `A-1 (c)` shipped
`Renderer.lastGpuFrameTimeSeconds` the day before; the runner's GL stack simply started
answering `EXT_disjoint_timer_query`. The assertion had hard-coded the opposite, with a comment
asserting it as fact: *"SwiftShader / CI has no `timestamp-query` / `EXT_disjoint_timer_query`."*

§84's GPU-frame row is a **capability**, not a contract, and pinning a capability makes the gate
flip with the runner's GPU rather than with our code — a test that fails for a feature *working*.
It now asserts what §84 actually promises: the `nan` sentinel, or a finite positive duration,
never a counter with no producer quietly reading `0`. Same shape as the `contacts` row three
lines above, corrected in #76.

Also: the `contacts` assertion now reports the value it received. Chasing this failure locally
cost two wrong turns that a message would have shortened — the local `dist/` predated `#74`, so
the example ran pre-`A-5` code and failed on a *different* line, which looked like a second bug
and was only stale build output. Verified after `bun run build`: 9/9 twin specs pass.

## [Unreleased]

### 2026-09-06 — CI after #76

- **`graph:duplicates`.** Allowlist the R-32 wide-layout constants
  (`PARTICLE_WIDE_INSTANCE_FLOATS`, `PARTICLE_ROTATION_OFFSET`,
  `PARTICLE_SOFTNESS_OFFSET`) as the same particles↔render duck-typed
  contract as `PARTICLE_INSTANCE_FLOATS`.
- **Docs / TypeDoc.** `NodeSpaceSerializerShape.deserialize` takes an
  optional `node`; PH-11c shape-cast fixtures include `body`; widget
  accessibility fixture is typed as `WidgetAccessibility`.
- **Browser gate.** Four leftover #76 assertions that never ran on that PR:
  twin `contacts` is a finite `SolverStatistics.contactCount` (not `nan`);
  playground settle/re-settle uses the existing ±0.25 band (Rapier 0.20
  centroid ≈ −2.29); impulse rise threshold 1.0 → 0.5 (CI measured 0.85);
  one-scene `panelLeft` only walks glyphs in the panel column. Chromium
  `test:browser` is 105/105 on the retune.
- **Size budgets.** `#76` never reached `bun run size`. CI measured
  first-3d 42.1, particles 42.21, ui-demo 48.47 kB; flagship 1.98 MB,
  twin 1.22 MB, character 1.15 MB (Rapier 0.20 wasm). Limits → 43 / 43 /
  49.5 kB and 2.05 / 1.25 / 1.20 MB. Rationale in `tools/size-budgets.mjs`.

### 2026-09-06 — A-4 FinalizationRegistry leak tracking

- **Tracker in `@fourjs/core`.** `trackDisposable` / `disposeTracked` /
  `auditFinalizedLeaks` / `trackedDisposableId` live next to `DEV` so
  geometry, render, and materials can register without importing
  `@fourjs/diagnostics`. Diagnostics re-exports the same functions.
- **Constructors register.** `Texture`, `CanvasTexture`, `RenderTarget`,
  `BufferGeometry`, and `Material` call the tracker at construct and
  `dispose()`. Reading the getter is not required; `auditFinalizedLeaks`
  remains the opt-in drain (finalizers only enqueue).
- **Production.** Helpers are `if (DEV)` so `__FOUR_DEV__: false` drops
  the registry from Texture-carrying bundles.

### 2026-09-06 — A-1 `gpuFrameTime`

- **`Renderer.lastGpuFrameTimeSeconds`.** Optional last-completed GPU-frame
  duration in seconds. Reading the getter arms measurement so unread
  renderers keep byte-identical GPU transcripts (R-30b).
- **WebGL 2.** Lazy `EXT_disjoint_timer_query_webgl2`; ping-pong
  `TIME_ELAPSED_EXT` queries; disjoint samples discarded.
- **WebGPU.** Requests `timestamp-query` when the adapter has it; views-pass
  `timestampWrites` + resolve/copy/`mapAsync` ping-pong.
- **`Application.stats.gpuFrameTime`.** Copies a finite backend number;
  stays `NaN` when the member is absent, in flight, or disjoint.
- **Coverage.** `GlGpuTimer` unit tests cover spare reuse, null queries,
  forget/dispose, and missing entry points (per-file floor was 77%).

### 2026-09-06 — Open-TODO subagent pass (fourth landing)

- **Rapier 0.20.** `@dimforge/rapier{2,3}d-compat` 0.20.0; `contactPair`
  takes `bodies`; CCD / contact-distance / snapshot-joint goldens updated.
- **`NodeSpace` + local-plane.** §8 component + serializer; §21 plane mapping
  and `local-plane.json` golden.
- **PH-11c / §40 / PH-1.** Character push impulse; `PhysicsWorldOptions.units`;
  authority-gated live velocity writes.
- **Motion.** `CameraShake` (interpolated value-noise), `wanderSpherical`,
  `solveCCD` / `solveFABRIK`.
- **PH-9.** Blend trees, layer stack, controller clip events, `from: "*"`,
  `when` sugar, one-depth live interrupt.
- **§81 tokens.** `ASSET_LOADERS`, `SHADER_OPERATORS`, `UI_CONTROLS`,
  `EDITOR_TOOLS`, `COMPUTE_WORKLOADS`.
- **A-13 / A-18.** Opt-in a11y DOM mirror; asset progress/stream/graph/worker/watch.
- **R-32 / geometry / render.** Opt-in particle appearance; Boolean ops + SVG
  document tokenizer; combined §66 comparator, idle batch cache, effect rects,
  `maxAnisotropy`, `Clock` alias, `groupSpritesByTexture`.
- **Materials / lights.** Closed-union `angle` operator + conic lowering;
  CSS color strings on punctual lights.
- **Docs / Pages.** Guides rendered to `/guides/`; Demos section; SolverBodyAccess
  and motor-cap deviations; S-8 example names are thin real wrappers.
- **Rapier 0.20 goldens (reviewed re-record).** Phase 5/6/7/10, force-fields,
  event-dispatch-split, and swept-character goldens rewritten from their
  scenario helpers after the 0.20.0 bump — the documented exception in each
  `_warning`. Integration thresholds follow the measured 0.20 contact/PID/joint
  behaviour (`FIRST_CONTACT_STEP` 35; dull-ball stay without a 3-event close;
  3D shaft coast 2e-3; PID droop 1e-5).
- **§33 / §96 hygiene.** `Node.#detach` and `rejectStalePhysicsHandle` no
  longer import `DEV` (simulation envelope); a11y mirror writes individual
  style properties instead of `cssText`; GATED list covers the new diagnostics
  and render warn modules.
- **RFCs 0007–0009 proposed** (path-planning adapters, §56 shaping engine,
  GPU readback as a raster source). Owner acceptance pending; not implemented.
- **A-5 live counts.** `liveMaterialCount` and solver-handle counters
  (`body` / `collider` / `joint` / sum) plus `readLiveResourceCounts()`.
- **PH-22f live anchors.** Body-local `Joint.setAnchors` +
  `SolverJointAccess.setJointAnchors` on Rapier 2D/3D.

### 2026-09-06 — Open-TODO subagent pass (third landing)

- **Windows browser gate.** `animation.spec.ts` watches published cluster
  metrics (`#status` on `first-2d-scene`) instead of screenshot throughput;
  Windows Playwright timeout 180 s.
- **`buildRenderList`.** Homogeneous sort skip, sprite fast path, and
  `ALL_LAYERS` layer test; benchmark re-recorded.
- **Size budgets.** `.size-limit.json` bumped (first-3d 39 kB, particles
  37.5 kB, ui-demo 46 kB); rationale in `tools/size-budgets.mjs`.
- **Rapier types.** `physics-rapier` uses `moduleResolution: bundler` and
  upstream `@dimforge/rapier*` type aliases instead of the transcribed subset.
- **`app.stats.contacts`.** Rapier adapters expose `countContacts()`; wired
  through `SolverStatistics` to `Application.stats`.
- **A-4/A-5 partial.** `@fourjs/diagnostics` §85 validation catalogue; extended
  leak audit; materials and solver live-instance counts.
- **CPU particle trails.** Optional `trail` on `ParticleEmitter`; ribbon mesh
  in `@fourjs/render` + WebGL trail pipeline; multi-stop lifetime ramps.
- **CI.** Example typecheck fix (`#status` null guard); coverage tests for
  diagnostics validation, particle trails/ramps, live resource counts, and
  exported `ParticleTrailProgram` / `ParticleTrailBatchCache`; allowlist
  `TRAIL_VERTEX_FLOATS` duck-typed stride (graph:duplicates gate).

### 2026-09-06 — §83 dev warnings batch (A-5 remainder, #73)

- **`resource-warnings.ts`.** `warnDisposedInUse` — one-time §83 warning when
  a disposed geometry, texture, or render target is still referenced; wired in
  WebGL and WebGPU backend caches.
- **`Node.#detach`.** Warns once when a detached node still has event listeners
  (`EventEmitter.listenerCountAll`).
- **`stale-handle.ts`.** `rejectStalePhysicsHandle` pairs
  `INVALID_APPLICATION_STATE` with a one-time stale-handle warning; Rapier 2D/3D
  adapters and the fake adapter use it.
- **`allocation-audit.ts`.** `auditFrameAllocations` turns
  `@fourjs/math`'s `constructionCount` delta into a one-time per-frame allocation
  warning; `Application.step` calls it when `stats` is enabled and `DEV` is true.

### 2026-09-06 — Auto-selection follow-ups (A-8/R-2 residue)

- **`backend-selection.test.ts`.** The §62 fallback and preference tests now
  register real `registerWebgpuRenderer()` instead of a WebGPU double — the
  WebGPU rung of `"auto"` is exercised end-to-end through `Application`.

### 2026-09-06 — RenderTarget byteLength follows depth/stencil formats (A-5)

- **`render-target-bytes.ts`.** Centralises per-texel accounting for colour,
  plain depth (`DEPTH_COMPONENT16`), samplable depth (`depthTexture`), and packed
  stencil (`DEPTH24_STENCIL8`). Staged float colour constants are wired for when
  §62 widens `RenderTargetFormat`. `RenderTarget.byteLength` delegates here.

### 2026-09-06 — SpatialHash (WP-8.2, #73)

- **`@fourjs/motion`.** Uniform-grid spatial index with explicit rebuild;
  query returns insertion order for §33 determinism.


### 2026-09-06 — Smoothness interpolation waiter

- **`waitForVirtualFrameCount`.** Poll `__fourVirtualFrames` through
  `page.evaluate` and pump one real `requestAnimationFrame` per poll — not
  `waitForFunction`, which deadlocks against this test's rAF override and ate
  the 120 s CI budget (`b55a8c1`). Each sample waits for `start + 1` rather
  than odd/even parity against a stale counter (parity matching failed when rAF
  delivered two increments per pump).

### 2026-09-06 — Windows animation browser gate sweep cost

- **`animation.spec.ts`.** Four cases share one 16-sample SwiftShader sweep
  in `beforeAll` (serial describe) instead of four independent 22-screenshot
  sweeps (~56 s of a 60 s Playwright budget each on Windows). Samples are
  spaced at 0.4 s (6 s minimum span unchanged); the trailing wait is skipped.
  Measured on Linux/SwiftShader: **4 passed in 16.2 s** (was 43.3 s with four
  sweeps). Visual project: **3/3 in 21 s**. Playwright default timeout remains
  **120 s** for remaining screenshot-bound specs.

### 2026-09-06 — Camera rigs TODO residue (docs)

- **`docs/guides/cameras-and-coordinate-conversion.md`.** Added §44 rig
  coverage: `OrbitRig`/`FollowRig`, `TrackballRig` (`@fourjs/scene`, R-37), and
  the fly-camera application snippet. Updated the stale "no rig classes
  shipped" honest-state bullet.
- **`TODO.md`.** Closed trackball and fly items in §44/§47 residue and staged
  rigs; `CameraShake` remains open (value-noise decision).

### 2026-09-06 — §33 GATED list and §42 warn policy

- **`asset-manager.ts`** is allowlisted for `devWarnOnce` (duplicate-load warn).
- **`warnAuthorityConflict`** uses unconditional `console.warn` — `@fourjs/scene`
  cannot gate on `DEV` per `dev-build-mode.test.ts` (simulation envelope).


### 2026-09-06 — WebGL F13 / metal-roughness restore

- **Unlit draw order.** Texture bind and `setFeatures` run before
  `unlitColorBlends` reads `color`, so a throwing accessor still
  restores the borrowed unit and program-lifetime flags (F13).
- **Metal-roughness unit 2.** Restore skips the redundant
  `activeTexture(TEXTURE2)` when that unit is already active.

### 2026-09-06 — Field torque, field-driven waking, §42 `devWarnOnce`

- **`ForceField.sampleTorque`.** Optional angular channel, always N·m.
  Linear `"force"` / `"acceleration"` units do not scale it. Built-in
  particle fields omit the method and stay assignable.
- **`wakesSleepingBodies`.** Per-entry, default off.
  `PhysicsWorld.forEachSleepingDynamicBody` is the complementary walk.
  A waking field that samples zero leaves the body asleep; a non-zero
  contribution calls `RigidBody.wake()` because `applyForce` does not.
  The batched `#bodies` scratch is truncated and cleared after each
  gather so a removed `RigidBody` is not retained (§83).
- **§42.** `warnAuthorityConflict` emits through `devWarnOnce` (A-4
  remainder step 4). Production builds print nothing.
- **§83 duplicate asset loads.** A second `AssetManager.load` of a
  *settled* `(url, loader)` slot warns once via `devWarnOnce`. In-flight
  coalescing stays silent.

### 2026-09-06 — PoseTarget scale channel

- **`PoseTarget.scale`.** Animated scale, default identity. The physical
  side of a §19 blend is also identity — a solver body has no scale.
  `copyFrom` copies `transform.scale`; `capturePrevious` keeps
  `previousScale`. §79 writes the vector only when it is not `(1, 1, 1)`.

### 2026-09-06 — Rotational root motion

- **`AnimationMixer` quaternion `rootMotion`.** A quaternion track is no
  longer `NOT_IMPLEMENTED`. The mixer differences
  `conjugate(previous) * sampled` and multiplies the delta onto
  `transform.rotation` (local composition). Loop wraps compose the same
  way translation adds strides. Scalar/colour tracks are still rejected.

### 2026-09-06 — §67 rectangular scissor clipping

- **`Renderable.scissor`.** A per-draw axis-aligned rectangle in
  drawing-buffer pixels (bottom-left, +Y up), default `null`. Snapshotted
  onto `RenderItem.scissor`. WebGL and WebGPU intersect it with the view
  scissor and restore the view rect after the item (and after a batched
  run). A scene that never names one issues the same scissor calls it
  issued before.
- **Batching.** `RenderBatcher` breaks a run where the rectangle changes
  (value equality, so independently written identical rects still merge).
- **§79.** The rectangle is written when present and omitted when null;
  a corrupted object restores the default.

### 2026-09-06 — Open-TODO pass: flakes, README gate, metallic-roughness, unlit blend

- **Smoothness interpolation flake.** `tests/browser/smoothness.spec.ts`
  screenshots after a known `window.__fourVirtualFrames` count (alternating
  odd/even) so mid-step and on-step poses are chosen instead of aliased
  against the 1.5-Δt virtual clock.
- **Blending sample-count flakes.** RECOVER / ANIMATED / RAGDOLL watches
  read `data-chain-y` until the span/floor is met. Screenshots stay for
  pixel assertions only.
- **README snippet browser gate.** `tests/browser/readme.spec.ts` serves
  the extracted quick-start and asserts a two-colour frame.
- **`check-docs` pins.** 24 packages, `tests/README.md` suite counts, and
  the AUDIT-120 43-item census.
- **§59 metallic-roughness map.** `StandardMaterial.metalRoughnessMap`
  (glTF packed G/B). WebGL binds texture unit 2. WebGPU field is staged
  inert. The glTF loader decodes that slot as linear.
- **Unlit alpha blend.** Unlit draws enable `SRC_ALPHA` /
  `ONE_MINUS_SRC_ALPHA` when `color[3] !== 1` or `transparent === true`.
  Opaque unlit stays `GL_BLEND` off.

### 2026-09-06 — Open-TODO pass: Windows runner, Dependabot lockfile, A-26 renderer table

- **Windows unit-test timeouts.** `packages/fourjs/tests/barrels.test.ts` now
  imports each barrel inside its test so the first `await` does not pay every
  dynamic import at once. `packages/core/tests/random.test.ts` and
  `packages/geometry/tests/svg-path.test.ts` take a 30 s timeout (Vitest 3.2
  describe options). Playwright's default test timeout is 120 s so
  screenshot-bound Windows SwiftShader runs have margin.
- **`CHROMIUM_BINARIES` knows Windows.** `playwright.config.ts` resolves
  `chrome-win64/chrome.exe` and the headless-shell-win64 layout when
  `PLAYWRIGHT_BROWSERS_PATH` is set.
- **Dependabot can go green without a human lockfile push.**
  `.github/workflows/dependabot-bun-lock.yml` runs `bun install` on
  `dependabot[bot]` PRs only, commits `bun.lock` when it changes, and
  dispatches CI onto that SHA. The main CI job still uses `--frozen-lockfile`.
- **A-26 renderer backends.** `tools/generate-compatibility.mjs` now emits a
  live `RendererCapabilities` table (`null` / `webgl2` / `webgpu`, plus the
  two reserved stubs) from constructed instances before `initialize`.
  `--check` covers both generated blocks. Rapier's `inheritVelocityFrom`
  no-op is recorded in the hand-written deviations list.
- **§42 warn-count isolation.** `world-blend.test.ts` and
  `world-joints.test.ts` restore `console.warn` spies in `afterEach`. Vitest 4
  was reusing unrestored spies and counting leftover §19 / §42 /
  `jointMotorEffortCap` warnings from earlier tests in the same file. That
  was the #62 / eslint-10 blocker. Assertions were not widened.
- **A-16 manifest catalog.** `preloadManifestIntoCatalog` walks a §79
  manifest, loads each key, and returns a synchronous `SceneResourceCatalog`.
- **§27 field batch + interceptTime.** `ForceField.sampleAll` is the optional
  stride-3 SoA path; steering's intercept-time now calls prediction's export.
- **Per-file coverage floor.** Package gate stays ≥95%. An Istanbul reporter
  (`tools/per-file-coverage-floor.cjs`) fails any non-empty file below 80%
  lines/functions/statements so a 0% file cannot hide behind the average.

### 2026-09-06 — removed a dead helper, and added the Windows binaries it pretended to be

- **`windowsFullChromium()` deleted: it never ran.** Measured by importing the config and
  printing each project's `executablePath` — `chromium.executablePath()` already returns
  the full build, so a helper that derives one from a `chromium_headless_shell-<rev>` path
  matched nothing. The WebGPU gate passes **22/22 without it**, which is the proof.
  A helper that looks load-bearing while doing nothing is worse than no helper: the next
  person debugging this would have trusted it.

- **`CHROMIUM_BINARIES` gained its Windows entries.** The list covered `chrome-linux` and
  `chrome-mac` only, so `findPreinstalledChromium()` could resolve nothing on Windows —
  a sandbox that sets `PLAYWRIGHT_BROWSERS_PATH` got the same `undefined` as one that does
  not, and the escape hatch the function exists to be simply was not there. Verified
  against a real install tree: with the variable set, the config now resolves
  `chromium-1200/chrome-win64/chrome.exe`.

### 2026-09-06 — `js-yaml 5` breaks the dependency-graph tool, and the fix is not ours

- **#68 closed; `js-yaml >=5` ignored.** Dependabot re-proposed the dev-dependency group
  without eslint 10 (the earlier ignore working). Its lockfile was regenerated by hand —
  Dependabot cannot write `bun.lock`, so CI failed at install with `lockfile had changes,
  but lockfile is frozen`. That got it past install, and it then failed on the
  architecture-invariants step:

  ```text
  SyntaxError: Missing 'default' export in module '.../js-yaml@5.4.1/dist/js-yaml.mjs'
  ```

  js-yaml 5 removed its default export, and `tools/create-dependency-graph` does
  `import yaml from 'js-yaml'`. That tool is **vendored and kept byte-identical with the**
  **copy in llm-wiki** — patching the import here would guarantee the two copies drift,
  which is worse than staying on js-yaml 4. Ignored with that reason rather than worked
  around.

  The rest of the group was sound: with the lock regenerated, build, tests-typecheck,
  `test:suites` (89/90 — the failure is the documented `determinism/path` contention
  flake), `size` and `check-docs` all passed. Dependabot will re-propose the remainder.

  Recorded for the next attempt: the group also carries **@playwright/test 1.57 → 1.62**,
  which moves the pinned Chromium revision `playwright.config.ts` resolves for the WebGPU
  project on Windows. Re-run the webgpu specs after it lands.

### 2026-09-06 — `bun run lint` fails on a machine that has dogfooded

- **`.dogfood/**` is now ignored by ESLint.** The dogfooding scratch directory holds
  throwaway consumer apps written deliberately the way a *user* would write them, so they
  neither share this config's project service nor belong under the library's own rules.
  Without the ignore, `bun run lint` fails on any machine that has run a dogfooding pass
  while CI stays green — the directory is gitignored, so the runner never sees it.
  Same green-in-CI/broken-locally shape as the three Windows-only defects fixed today, and
  self-inflicted this time. The config already ignored agent worktrees for the same reason.

### 2026-09-06 — open PRs and branches swept

- **Two Dependabot PRs closed, neither blocked on a rebase.**
  - **#65** (`@dimforge/rapier` 0.19.3 → 0.20.0) is the change merged as #63 and reverted
    on 2026-09-05. CI red for the same recorded cause: four *behavioural* differences, not
    an API break — a bullet that no longer tunnels at a small CCD prediction distance, a
    contact distance of 0.005 where `<= 0` was expected, and a snapshot-restored joint at
    −0.75 where `> −0.22` was expected. Adopting 0.20 is a decision, and it needs the
    `contactPair(c1, c2, bodies, f)` adapter change besides.
  - **#66** (eight dev-dependencies, including **eslint 9 → 10**) went red on `warn`-count
    assertions — the **pre-existing test-isolation defect** already tracked here, where the
    §42 authority warning fires an extra time under a full run and the affected tests pass
    in isolation. A dependency bump neither caused it nor can fix it.

  Both are now **ignored in `.github/dependabot.yml`** with their reasons, so they stop
  returning every Monday to spend a CI run going red the same way.

- **Three stale branches deleted, each verified superseded by content rather than by
  ancestry** — a squash-merged branch reads as "unmerged" and deleting on that signal
  alone would be guesswork:
  - `claude/tools-integration-rji2sr` (13 commits): every sampled artifact is in `main` —
    `docs/GAP ANALYSIS v2.md`, `examples/character-controller/main.ts`,
    `packages/math/src/rectangle2.ts`, `packages/render/src/read-pixels.ts`.
  - `cursor/sanitize-todo-security-coverage-28a3`: **zero** diff lines against `main`.
  - `cursor/typescript-on-bun-b951`: RFC 0006 landed — `main`'s `test` script already runs
    `bun tools/run-in-packages.mjs`.

  Remaining: `main` and `changeset-release/main`, which Changesets manages itself.

- **#67 ("Release: version packages") is deliberately left open.** It is the standing
  release-staging PR: Changesets regenerates it from the pending changeset on the next
  push, so closing it is churn rather than cleanup. It should be merged when 0.1 is
  actually being cut, not before — merging it now would version packages we are not
  releasing.

### 2026-09-06 — a dynamic body with nothing to derive inertia from now says so

- **A dynamic body with no collider and no `inertiaTensor` has zero angular inertia, so the
  solver never rotates it — and nothing said so.** It translates, it answers joints in
  translation, and a torque or a motor does nothing. `derivedMass` is simply left
  `undefined` and the scene steps happily, perfectly still.

  Found by building a two-cylinder engine as a pure linkage, which is a reasonable thing to
  do when the joints are the only constraints. The crank could not turn, so nothing moved,
  and **every accuracy invariant scored a perfect 0.0 error** — because there was no motion
  to be wrong about. `mass` supplies mass, not the inertia tensor.

  `PhysicsWorld` now warns once per body, naming both fixes (attach a `Collider`, or pass
  `inertiaTensor`).

  **Raised at the first step, not at `addBody`, and the placement is the design.** PH-5
  supports `addCollider` after registration, so at registration a body that is about to be
  fine is indistinguishable from one that never will be; a registration-time check would
  fire on a supported workflow. By the first step the mass properties are the ones the
  solver is actually going to use. A control test covers exactly that path.

  Unconditional, not `DEV`-gated: `physics` is a simulation package and §33 forbids it from
  branching on the build flag at all — matching `#warnUnhonouredMaterials` and
  `#warnSuspiciousNumbers` beside it.

  `force-field.test.ts` now expects **two** warnings for a collider-less dynamic body. That
  is accurate rather than noisy: §25 cannot accelerate a massless body and §23 will never
  rotate an inertia-less one — the same mistake, two consequences, and the second is the one
  that froze a mechanism silently.

  Verified in a browser against the original frozen engine: five warnings, one per dynamic
  body, where there had been none.

### 2026-09-06 — re-registering the same solver is a no-op, not a conflict (§37)

- **`SolverRegistry.register` (and so `registerRapierSolver()`) accepted only one call**
  per solver name. Registration is process-global, so a helper that builds a world could
  not simply ensure the solver was available — it had to know whether some other
  component had already registered it, or the second call threw
  `INVALID_APPLICATION_STATE`. Found by dogfooding, with a `makeWorld()` helper.

  Re-adding the **identical** registration is now a no-op returning the registry. A
  *different* solver under a name already taken still throws, with the same message and
  context.

  **Why this does not weaken §33.** The refusal exists to stop a silent *overwrite*:
  which solver `"auto"` builds would otherwise depend on module evaluation order, and a
  simulation that changes solver for that reason is not reproducible. Adding the same
  entry twice overwrites nothing — the map holds the same registration, `solvers` keeps
  the same order, and `"auto"` builds the same adapter — so none of that reasoning
  applied to it. What the old contract actually caught was defensive code.

  Compared by **identity**, deliberately: `registerRapierSolver()` builds a fresh object
  literal per call, but `isSupported` and `create` are module-level bindings, so two
  calls carry the same two function references. Anything that would change what `"auto"`
  builds carries different ones and still throws.

  Verified from outside the library, before and after:

  ```text
  before:  first makeWorld() ok · second makeWorld() THREW FourError
  after:   first ok · second ok · third (3d) ok · registeredSolvers() == ["rapier"]
  ```

### 2026-09-06 — `blending.spec.ts` asserted on the runner's throughput

- **Two of its watches were bounded by wall clock and then asserted on how many samples
  they managed to take.** Each iteration costs a screenshot, so the count measured the
  runner: ~10–12 on a normal machine, 7–8 on one 19% slower, against floors of `>= 8` and
  `> 10`. It failed CI twice on 2026-09-06 with nothing about the chain's motion wrong.

  Both now sample until **both** the window has elapsed and a floor is met. On a normal
  runner the duration still dominates and behaviour is unchanged; on a slow one the window
  grows, which only strengthens the "did the centroid actually move" assertions the counts
  wrap. No threshold was widened — widening moves the cliff instead of removing it.

  Measured on Windows/SwiftShader: **1 of 4 passing → 3 of 4**.

- **The remaining failure is understood but not fixed, and the attempted fix was rolled
  back.** "RECOVER" asserts the centroid's *span* exceeds 0.2, and a span needs a full
  wave period to reach both extremes. `WAVE_PERIOD` is **3.6 s**, and the watch runs for
  4 s of *wall clock* — but §10 **drops simulation time** on a frame that cannot keep up,
  so on a slow machine 4 s of clock is less than 3.6 s of simulation and the chain is
  sampled across a fraction of its wave. A running wave then measures 0.156.

  Bounding the loop by `data-step` — the fixed-step counter the page already publishes —
  is the correct fix in principle and was implemented. It was **reverted** because it is
  not viable here: waiting for 216 simulation steps exceeded the 60 s test timeout, and
  raising the timeout to 180 s made the results worse still (3 of 4 failing, versus 1 of 4
  with the floors alone). The screenshots these loops take are themselves part of what
  starves the simulation, so watching harder makes the thing being watched slower.

  Recorded rather than shipped: the analysis is the useful part, and the change that
  measured worse did not land.

### 2026-09-06 — the glTF tests could not open their own fixture on Windows

- **`tests/determinism/gltf-load.test.ts` and `tests/integration/gltf-scene.test.ts`**
  failed here with `ENOENT: open 'C:/Users/.../four.js/quad.bin'` — the relative buffer
  URI resolving against the process working directory instead of the asset's folder.

  The loader is not at fault. `resolveUri` in `@fourjs/assets` resolves a glTF's relative
  URIs against the asset's **URL**, lexically, splitting on `/`; its docblock says why
  (§33 — the package names no `URL` global, so resolution is identical everywhere). The
  tests handed it `fileURLToPath(...)`, a *native* path. On Windows the separator is `\`,
  so `lastIndexOf("/")` is −1, the base collapses to `""`, and every relative URI
  resolves against the CWD. On POSIX a native path is also `/`-separated, which is why a
  determinism suite could prove determinism on CI and fail to open its own fixture here.

  Both tests now keep the fixture directory as a URL all the way to the loader and convert
  to a path at the one call that touches the filesystem. **No library change.**

  `bun run test:suites` is now 90/90 on Windows, where it had never completed.

### 2026-09-06 — reverted the `new Node()` guard: §33 forbids the flag in `@fourjs/scene`

- **The DEV-gated `new Node()` warning is withdrawn.** It put `if (DEV && …)` in
  `packages/scene/src/node.ts`, and `tests/integration/dev-build-mode.test.ts` refuses
  that outright: `scene` is on its simulation list — `math`, `motion`, `scene`,
  `physics`, `animation`, `particles` — and *"none of them may branch on the build mode
  at all"*, because those are the packages a replay's numbers come out of (§33).
  Registering it in `GATED` was not an option either; that is the same test's other half.

  Nor could it simply drop the flag and run unconditionally: the message costs ~100 B
  gzip in every bundle that carries `@fourjs/scene`, and `examples/ui-demo` currently sits
  **at** its 45 kB §86 budget with no headroom.

  The underlying finding stands and is back open in `TODO.md`: `abstract` is erased at
  runtime, so a JavaScript consumer who writes `new Node()` still gets a working-looking
  object and no signal. What is now known is that the fix cannot be a DEV-gated warning
  inside `scene`, which makes it an owner decision rather than an oversight.

- **`packages/input/src/keyboard-input.ts` is now registered in `GATED`** with its §33
  argument. `@fourjs/input` is not a simulation package, and the refusal is unreachable
  from any well-formed call: the constructor requires `(surface, { focusTarget })` in
  both builds, and only the diagnostic prose moves with the flag.

  Caught by CI, correctly. The gate is a good one — a DEV-only branch inside a
  simulation package is exactly how a replay stops reproducing.

### 2026-09-06 — `bun run test` and `bun run coverage` were dead on Windows

- **`tools/run-in-packages.mjs` never reached a single package on Windows.** It built its
  root as `new URL("..", import.meta.url).pathname`, which on Windows yields a
  leading-slash POSIX path (`/C:/Users/...`); `join()` then produced a path beginning
  `\C:` and the directory scan failed before any test ran:

  ```text
  ENOENT: no such file or directory, scandir '\C:\Users\danie\Github\four.js\packages'
  ```

  Now `join(dirname(fileURLToPath(import.meta.url)), "..")`, which is what
  `check-docs.mjs`, `check-spec.mjs`, `apply-publish-names.mjs` and
  `generate-compatibility.mjs` already do — this file was the only one in `tools/` that
  did not. Both scripts it backs (`test`, `coverage`) now run.

  Invisible on CI, where `.pathname` needs no translation. That is the point worth
  keeping: the repository's two most important commands were broken on a platform while
  every gate stayed green, because no gate runs there.

### 2026-09-06 — `new Node()` now says something in development builds

- **`Node` is `abstract`, but `abstract` is erased at compile time**, so it protected
  TypeScript callers and nobody else. A JavaScript consumer who guessed `new Node()` got
  an object that looked like it worked — id, transform, children, event emitter — and was
  missing everything that makes a node do anything. Found by dogfooding: a bouncing ball
  simulated for a full run before a typecheck revealed the base class was wrong.

  It now emits a `devWarnOnce` naming the concrete class to use (`Group` for a plain
  container, or `Renderable` / `Scene` / a camera / a light).

  **Warned, not thrown**, deliberately: throwing would break callers whose code runs
  today, and §42 already sets warn-rather-than-overwrite as this library's answer to an
  authoring mistake. `devWarnOnce` rather than `devWarn` because this is one wrong line
  executed many times — the opposite of §6a's duplicate-component case, where every call
  is a distinct mistake.

  **Free in a shipped build.** Under §85's build mode `DEV` is a literal `false`, so the
  branch and its message text are deleted by the tree-shaker (A-4). `DEV` defaults to
  `true` for anyone who has not configured `__FOUR_DEV__` — precisely the audience that
  reaches for `new Node()`. In development the cost is one reference comparison per node.

### 2026-09-06 — `KeyboardInput` now refuses a malformed options object clearly

- **`new KeyboardInput({ surface: window })` threw `TypeError: Cannot read properties of
  undefined (reading 'focusTarget')`** — an internal property access naming a private
  field, with no hint of the real signature. The constructor takes **two** arguments,
  `(surface, { focusTarget })`, and `focusTarget` is required.
  It now throws a `FourError` naming the call shape, the way `SpringDamper` answers the
  same class of mistake ("options must supply either {stiffness, damping} or {frequencyHz,
  dampingRatio}") — a message that makes the fix a one-step correction instead of a
  source-reading exercise.
- **The message also says what the class is for**, because the name is what invites the
  mistake. In a package called `@fourjs/input`, `KeyboardInput` reads like "the way to read
  the keyboard", but it routes events to a *focused scene node* and pairs with
  `@fourjs/ui`'s `keyboardFocusTarget(root)`. Game code reading WASD wants neither, and
  four offers no first-class alternative: its own `examples/character-controller` uses
  plain DOM listeners. The error now points there rather than leaving a game developer to
  discover it by reading the examples.

  **The validation is `DEV`-gated**, and that was not the first attempt. Shipping the
  message unconditionally put `examples/ui-demo` **245 B over its 45 kB §86 budget** and
  turned CI red — roughly 400 characters of guidance were riding in every production
  bundle that touches `@fourjs/input`. Gating the whole check restores a byte-identical
  production build: under §85's build mode `DEV` is a literal `false` and the tree-shaker
  deletes branch and text alike (A-4). A consumer meets this error while developing,
  which is when the mistake is made — the same trade-off the library takes everywhere
  else it checks an authoring error.

  Found by building a flight simulator against the library. No call site changes: all
  three in-repo constructions already pass `keyboardFocusTarget(uiRoot)`.

### 2026-09-06 — the WebGPU gate ran nowhere on Windows; 22 skips are now 22 passes

- **All 22 specs in the `webgpu` project skipped on Windows**, so four's second render
  backend was gated by tests that never executed. They self-skip when
  `requestAdapter()` resolves `null`, and it always did.

  Measured across both Chromium builds and four flag sets, on a served origin:

  | binary | flags | `requestAdapter()` |
  | --- | --- | --- |
  | full | `--use-gl=angle --use-angle=swiftshader --enable-unsafe-webgpu` (previous) | **null** |
  | shell | same | **null** |
  | full | `--enable-unsafe-webgpu` only | nvidia / pascal, 20 features |
  | full | `+ --use-webgpu-adapter=swiftshader` | google / swiftshader, 18 features |
  | shell | `--use-gl=angle --enable-unsafe-webgpu` | nvidia / pascal, 20 features |

  **`--use-angle=swiftshader` is the cause.** It governs ANGLE — WebGL's rasteriser —
  and remains exactly right for the `chromium` and `visual` projects, but on Windows it
  also denies Dawn an adapter. `--use-webgpu-adapter=swiftshader` is its WebGPU-side
  counterpart, so the gate still measures a **software** adapter rather than whatever GPU
  the developer happens to own — the property the flag was there to protect.

  **Corrected 2026-09-06, later the same day: the paragraph below was wrong.** It said the
  project additionally needed the full Chromium build, resolved by a `windowsFullChromium()`
  helper. Measured by importing the config and printing what it resolves,
  `chromium.executablePath()` **already returns the full build**
  (`chromium-1200/chrome-win64/chrome.exe`), so that helper's regex never matched, it always
  returned `undefined`, and it never selected anything. The flag change alone is the fix;
  the helper has been removed and the gate still passes 22/22 without it. Original text:

  ~~The `webgpu` project additionally needs the **full** Chromium build on Windows: the
  headless shell yields no adapter under any flag set that also pins a software one. Its
  path is derived from `chromium.executablePath()` rather than searched for, so the
  revision cannot drift from the one Playwright expects.~~

  **Non-Windows argv is unchanged, deliberately.** CI runs 103/103 on Linux with the
  previous flags; a Windows-only defect must not perturb the platform that already works.

  Result on Windows: **22 passed, 0 skipped, 0 failed** (2.7 min), where it was 22 skipped.

  An earlier diagnosis in `TODO.md` blamed `chrome-headless-shell` for lacking
  `dxcompiler.dll`. That was **wrong** and is corrected there: the full build ships the
  DLL and still returned a null adapter. The binary was never the variable.

### 2026-09-06 — `FollowRig` killed the frame loop on a zero-length step

- **`FollowRig.apply()` threw on the first frame and the application never recovered.**
  It handed `deltaSeconds` straight to its `SpringDamper`, which deliberately rejects a
  non-positive delta, and the `RangeError` escaped through `Application.step()` into the
  caller's `requestAnimationFrame` loop — one zero-length frame and nothing rendered again:

  ```
  RangeError: SpringDamper step deltaSeconds must be a finite positive number of
  seconds (§7a); received 0
  ```

  The zero is not exotic. `README.md`'s own loop is
  `app.step(Math.max(0, now - last) / 1000)`, and `requestAnimationFrame`'s frame
  timestamp can precede the `performance.now()` captured just before the loop starts, so
  the clamp yields exactly `0` on the first frame.

  `apply()` now counts a non-positive step as a **skip** — the case the class already
  models with `skippedSteps` at three other call sites — and returns `false`. A
  zero-length step advances nothing, so there is nothing to place. The condition is
  written `!(deltaSeconds > 0)` so `NaN` is skipped rather than handed to the spring.

  Deliberately narrow in two directions. A spring-less rig never reads the delta, so it
  still places at `dt === 0` exactly as before. And `SpringDamper`'s rejection of `0` is
  **unchanged** — `it.each([0, -DT, NaN, Infinity])` asserts it, so it is a deliberate
  invariant, and widening it is a separate decision for the owner.

  Found by building a flight simulator against the library: the chase camera threw before
  it drew a single frame. It had never surfaced because `FollowRig` appears only in unit
  tests — no example drives it inside a real animation loop, and unit tests always pass a
  positive `DT`.

### 2026-09-06 — the README quick-start could not run; found by running it

- **`README.md`'s quick-start snippet threw before drawing anything.** It awaited
  `app.initialize()` and went straight into a `requestAnimationFrame` loop calling
  `app.step(...)`, never calling `app.start()`. §45 rejects exactly that:

  ```
  FourError: Application.step() requires an initialized, started, undisposed
  application: call `await app.initialize()` then `app.start()` (§45).
  ```

  Found by extracting the block **verbatim** from `README.md`, serving it with Vite and
  loading it in Chrome — the canvas stayed blank. Adding `app.start()` was the only
  change needed: the same page then rendered the circle and orbited it. Control: all ten
  `examples/*/main.ts` call `start()` exactly once, so the README was the only place in
  the repository that omitted it — which made the first program a new reader runs the one
  program here that could not run.
- **`tools/check-docs.mjs` now gates the lifecycle**, because the fix alone would rot
  again: a fenced block is prose, and the paragraph under this one called the snippet
  "illustrative", which is what licensed the omission. The check flags any fenced
  TypeScript block that drives `new Application(...)`'s own variable with `.step()`
  without `.start()`. Two details are load-bearing and both came from testing the check
  against the known-bad input before trusting it:
  - It matches `\r?\n`, not `\n`. `core.autocrlf` gives this working tree CRLF, and the
    first version matched **zero** blocks — passing while catching nothing, which is the
    failure mode the check exists to prevent.
  - It binds to the application's identifier. A looser version flagged any block with
    `.initialize()` and `.step()`, hitting four guides that step a *`PhysicsWorld`*
    (`world.step(1 / 60)`) and rightly never call `app.start()` — four false positives
    out of five hits.

### 2026-09-05 — the publish path could not stage a tree; found by dogfooding it

- **`bun tools/apply-publish-names.mjs` exited 1 with 8 problems, so nothing could be published.**
  Its rewriter and its own validator disagreed about what a quoted name is:

  ```
  rewriter   /(["'])@four\/([a-z0-9-]+)/     <- [a-z0-9-]+ cannot cross a "/"
  validator  /(["'])@four\//                    <- flags any quote followed by @fourjs/
  ```

  So `"@fourjs/render-webgl"` was rewritten and `"@fourjs/render-webgl/register"` was not, and the
  validator then failed the run on the survivor. Every one of the 8 was that same subpath shape.
  Harmless today because all of them sit in JSDoc — but that is luck, not safety: a real
  `import "@fourjs/render-webgl/register"` would have staged unrewritten beside a manifest whose
  dependency had been renamed, resolved to nothing, and shipped broken on the first release, which
  is verbatim the failure this tool's header says it exists to prevent. The validator was right;
  the rewriter was one character short. `SCOPED_STRING` now matches subpath segments.
- **Two renderer error messages named the workspace package to consumers who cannot have it.**
  `"…Call registerSkinningPipeline() from " + "@fourjs/render-webgl at application setup (RFC 0003)."`
  put the package name at the start of a prose string, where the rewriter deliberately does not
  reach — so a consumer of `@danielsimonjr/fourjs-render-webgl` would be told to import
  `@fourjs/render-webgl`, which does not exist on npm. Split so the name is its own quoted token,
  which is exactly the shape the rewriter is built to rename. The workspace build still says
  `@fourjs/render-webgl`; the staged build now says `@danielsimonjr/fourjs-render-webgl`.

`apply-publish-names` now exits 0: 24 packages staged, 25 umbrella exports preserved, 724 code
specifiers rewritten.

### 2026-09-05 — reverted #62 and #63: `main` was red on three workflows

- **Reverted the dev-dependency bump (#62).** It moved TypeScript 5.9.3 -> 7.0.2 together with
  vitest 3 -> 4, and that pair has **no working TypeScript version** in this repo:

  | TypeScript | `bun run docs` | `bun run lint` |
  |---|---|---|
  | 7.0.2 | **crash** — `Cannot read properties of undefined (reading 'PropertyDeclaration')` | pass |
  | 6.0.3 | 7 errors — `@types/node` unresolved in test files | 76 errors |
  | 5.9.3 | **pass** | 38 errors |

  typedoc 0.28.20 is the latest published version and peers at TypeScript `<= 6.0.x`, so TS 7 has
  no supported typedoc at all; below TS 7, vitest 4's types degrade to `any`, which is what the
  lint errors are. The bump also caused 7 test failures by exposing a pre-existing test-isolation
  defect (the §42 authority warning fires an extra time; the affected tests pass in isolation).
- **Reverted the production-dependency bump (#63)**, `@dimforge/rapier` 0.19.3 -> 0.20.0. Four
  physics tests failed on solver behaviour drift — a bullet that no longer tunnels at a tiny CCD
  prediction distance, a contact distance of 0.005 where `<= 0` was expected, and a snapshot-
  restored joint at −0.75 where `> −0.22` was expected. Adopting 0.20 is a deliberate decision
  (the CCD change looks like an improvement, the joint one may be a regression); it should not
  arrive as an unreviewed dependency bump. This also reverts the `contactPair` adapter fix, which
  is only needed for 0.20 and is recorded here for whoever picks that up: rapier 0.20 inserted a
  `bodies: RigidBodySet` parameter, so `contactPair(c1, c2, f)` became `contactPair(c1, c2, bodies, f)`.
- **Both are now pinned in `.github/dependabot.yml`** with the measured reason, so the same
  incompatible set is not re-proposed next Monday. Lift `typescript` and `vitest` together, in one
  PR, once typedoc supports TypeScript 7.

- **`@changesets/cli` kept at 3.0.1**, i.e. NOT reverted with the rest of #62. The workflow uses
  `changesets/action@v2` (from the #61 actions bump), which refuses CLI v2 outright:
  *"This version of the Changesets action is designed to work with Changesets CLI v3."* That bump
  is unrelated to the TypeScript/vitest conflict, so reverting it wholesale broke `Release` a
  second way. Restored surgically; `docs` and `lint` stay green.

- **`release.yml` updated for `changesets/action@v2`'s renamed inputs.** The action bump (#61)
  renamed `version` -> `version-script`, `title` -> `pr-title` and `commit` -> `commit-message`,
  and it ERRORS on the old names rather than warning — so `Release` failed on every run since that
  bump, independently of the dependency reverts. Three failures were stacked here: the CLI major,
  the action's CLI-version check, and these renamed inputs; each was only visible once the one
  before it was fixed.

After the reverts: `docs`, `lint` and `build` all exit 0, and `@fourjs/physics-rapier` is back to
341/341 passing (it was 337 passing / 4 failing on 0.20).

### 2026-09-05 — repository configuration repairs (Docs, Release, Dependabot)

- **GitHub Pages enabled (`build_type: workflow`).** The `Docs` workflow had been failing on every
  run with `Get Pages site failed. Please verify that the repository has Pages enabled` — it was
  built to deploy to Pages, and Pages had never been turned on. Docs is green and the site serves
  HTTP 200 at https://danielsimonjr.github.io/four.js/.
- **Actions may now create pull requests.** `Release` failed with
  `GitHub Actions is not permitted to create or approve pull requests`, so the changesets flow
  could never open its version PR — 24 packages sat at `0.0.0` with the workflow itself warning
  that `changeset version` had to run first. `can_approve_pull_request_reviews` is now true while
  `default_workflow_permissions` stays **read**, matching MathTS and memoryjs. Release is green.
- **Dependabot enabled and configured.** Security updates were `disabled` and there was no
  `.github/dependabot.yml` at all: alerts were detected but nothing remediated them. Both fixed.
  The config uses the **npm** ecosystem, not bun — Dependabot's bun parser handles only `bun.lock`
  lockfileVersion 1 and this repo's is 2, so a bun ecosystem would fail every run while leaving
  "0 open PRs" looking healthy.

### 2026-09-05 — TypeScript-on-Bun toolchain (RFC 0006)

#### Changed

- Workspace package manager and script runner is **Bun** (≥ 1.2). Root
  `package.json` declares `"workspaces": ["packages/*"]`; committed lockfile is
  text `bun.lock`; `bunfig.toml` enables the text lockfile. Removed
  `pnpm-workspace.yaml` / `pnpm-lock.yaml` / the `tsx` root dependency.
- Root scripts, CI (`ci.yml` / `docs.yml` / `release.yml`), CONTRIBUTING,
  README, AGENTS/CLAUDE, and tools docs use `bun install` / `bun run` /
  `bunx`. Coverage uses `tools/run-in-packages.mjs`. Publish-name discovery
  reads `package.json` workspaces.
- Spec revision **1.14**: §91 baseline is a Bun workspace (Turborepo/Nx
  dropped from the recommended list); §103 Phase 0 lists `bun.lock` /
  `bunfig.toml`. Library emit remains `tsc -b`; Vitest remains the unit/suite
  runner (`bun:test` staged).

#### Added

- `docs/rfcs/0006-typescript-on-bun.md` (accepted).

#### Fixed

- `examples-build-coverage` matches `bun run <script>` chains (was hard-coded to
  `pnpm`). Determinism fresh-process spawns pass `--experimental-strip-types`
  so Node < 22.18 can load `.ts` scenario helpers; CI pins Node 22.22.
- Package `test` runs with `--concurrency=4` (via `tools/run-in-packages.mjs`)
  instead of unbounded `--parallel`, matching the old pnpm workspace cap; the
  glyph-atlas determinism assertion compares TypedArrays directly so it does
  not time out under CI load.

### 2026-09-04 — WebGL geometry-buffer reuse

#### Changed

- Reuse VAOs and buffers for dirty geometries whose attribute/index presence is
  unchanged. Full `bufferData` uploads preserve resized stores and prior queued
  draws; draw count, mode and index width update with each acquired version.
- Share a typed optional-attribute table and upload helper across allocation,
  refresh and cleanup. Initial uploads no longer allocate temporary buffer lists
  or allocation closures. No new public API, dependency or bundle-budget change.
- Add a registered counting benchmark: dirty geometry calls fall 11 → 5 for
  position-only, 15 → 7 for indexed quads, and 45 → 17 for all seven streams.
  Upload bytes are unchanged; these are not GPU-time/FPS claims.

#### Fixed

- A disposed `GeometryCache` no longer silently allocates new GPU resources.

#### Tests

- 76 new unit cases cover all 64 stream combinations, data/binding integrity,
  growth/shrinkage, index-width changes, layout changes, allocation refusal,
  empty geometry, disposal and context loss. Update obsolete recreation-count
  assertions in existing unit and shape integration tests without removing
  their data/draw assertions.
- Add two real-driver pixel comparisons of queued old/new draws against fresh
  allocations, for indexed and unindexed geometry.

## 2026-09-03 - security: js-yaml 4.3.0 -> 4.3.2 (CVE-2026-59870, HIGH)

- Dependabot alert #2: quadratic CPU consumption in `!!omap` resolution, affecting
  `>= 4.0.0, < 4.3.1`. Only reachable through `tools/create-dependency-graph`, which is a
  build-time tool rather than shipped runtime code.
- Verified the patched copy is actually INSTALLED and works, not merely written into the
  lockfile: `npm ci` then a parse of a document containing `!!omap` -- the exact construct
  the advisory names -- against js-yaml 4.3.2. A lockfile edit alone proves nothing about
  what runs.
- First change since the 08-28 development hold on this repo was lifted 2026-09-03.

### 2026-08-30 — Unblocked-defect sanitization (sprite flags, graph errors, docs truth)

#### Fixed

- **Sprite §79 round trip.** `SpriteOptions` now _extends_ `RenderableOptions`
  and the constructor forwards the whole record to `super` (the Shape2D
  pattern). Restating a subset had dropped `castShadow` / `receiveShadow` /
  `frustumCulled`; a new drawable field cannot be dropped the same way
  again. Constructor unit + scene-serializer round trip.
- **`INVALID_RENDER_GRAPH` (§89, R-5 follow-up).** Added to the
  `FourErrorCode` union; `RenderGraph`'s `GRAPH_ERROR_CODE` switched.
  `errors.test.ts` exhaustiveness-checks the whole union so a new code
  cannot ship unlisted. Spec revision **1.13** brings §89's example-code
  list in line with the shipped union (it had lagged `INVALID_APPLICATION_STATE`,
  `UNTRUSTED_INPUT_REJECTED`, `NOT_IMPLEMENTED`, and the new graph code);
  the header revision number was also lagging the table (1.11 vs 1.12).
- **§10 dropped-time warning (PH-22n).** `Application.step` emits a
  `devWarnOnce` when `TimeState.droppedTime` is non-zero — the scheduler
  already recorded the number; nothing told an author a frame had just
  lost simulation time. The message reports **this frame's** drop, then
  the cumulative total. Application tests swallow `console.warn` and
  `resetDevWarnings()` between cases so a long-frame determinism run no
  longer prints the once-per-process warning to stderr.
- **`examples-build-coverage` nested paths.** The capture stopped at `/`,
  so both flagships collapsed to `"flagship"` and a missing twin would
  still look covered.
- **Shape 32-bit-index test timeout.** 20 s so `--coverage` on a loaded
  box cannot flake the assertion.

#### Tests

- `tests/integration/camera-rigs.test.ts` now chases a Rapier 3D dynamic
  body with `FollowRig` + `LookAtConstraint` — §44's physics attachment
  is no longer argued from priority numbers alone.

#### Docs

- `@fourjs/render-webgpu`'s README, `docs/Architecture/{OVERVIEW,ARCHITECTURE,COMPONENTS}.md`,
  `AGENTS.md`, and `MEMORY.md` standing facts no longer call WebGPU a reserved
  stub (R-1 closed 2026-08-29). `@fourjs/scene` / `@fourjs/motion` READMEs no
  longer claim camera rigs are unshipped.
- `tools/check-docs.mjs` scans `docs/Architecture/` hand-written files and
  `packages/*/README.md`, and pins the retired `render-webgpu (stub)` wording.
  Generated Architecture reports (`**Generated**:` stamp, plus the
  `DEPENDENCY*` graph dumps) stay excluded, including `TEST_COVERAGE.md`.
- Tracker honesty: A-6's "members still absent" row, the §93/§118 examples
  `.gitkeep` row, and "§65 batching is unshipped" were all false of the
  tree. Camera-rig remainder no longer claims `ConstraintSystem` is empty.
  Per-item scissor stays open.

### 2026-08-29 — Gap Analysis v2: the campaign-closing honesty pass

- **`docs/GAP ANALYSIS v2.md`** — every v1 row (97 filings, 22 register rows)
  re-read against source at `df572c6`. Final ledger: **74 closed / 21 partially
  closed / 2 open (`R-32`, `R-33`) / 0 RFC-blocked**. Four statuses corrected
  against the tree — `A-19`, `A-20`, `R-3`, `R-31`, all closed; their v1 rows
  lagged the packets that closed them. v1 gains the superseded banner (v0's
  convention); nothing below it rewritten. v1's internal defects (a duplicated
  §3 table, duplicated §4 rows, frozen §1 counts) are itemised in v2 §7 rather
  than edited away.
- **The full house gate suite ran green on `df572c6`**: build, coverage, suites
  (90 files / 661 tests), the full browser gate (**101/101**, 5.6 m — including
  `webgpu-readpixels-region.spec.ts`'s first run, measurement recorded into its
  header; existing goldens byte-unchanged), lint, docs (0 warnings),
  typecheck:tests, check-spec, check-docs, check-compat, graph:check,
  graph:duplicates, size (all seven budgets in limit). No package code changed:
  a closing pass records, it does not patch.

### 2026-08-29 — the two recorded example follow-ups: §12 character controllers and §39 step-8 sensor bookkeeping

#### Added

- **`examples/character-controller` — the §12 controller family in one
  first-person page (tenth example; the PH-11/PH-11b follow-up).** A
  `SweptCharacterController` capsule walked with WASD through §30 shape casts
  on real Rapier 3D — walls slide it, three 0.24 m risers are climbed by the
  step-up (`stepHeight` 0.32, the browser gate counts exactly 3), Space
  jumps — with `FirstPersonLook` on a child eye node (§44's yaw ∘ pitch
  decomposition, arrow-key and drag look) and a plane-tier
  `CharacterController` patrolling a circle with no physics body at all, under
  the §39 ordering spelled out in the header: input (100) → patrol commands
  (200) → KinematicSystem + SweptCharacterSystem (400, disjoint component
  types) → solve (600). Two dynamic balls collide with the character's
  kinematic-position body. One wasm image (directly-constructed
  `Rapier3dAdapter`), 2.46 MB raw / 0.90 MB gzip — budgeted at 0.95 MB. Tenth
  browser-gate site (port 4182); 5 new threshold specs in
  `tests/browser/character-controller.spec.ts` (platform height 1.580 reached
  with 3 step-ups, wall stop at z = −3.140, jump apex, yaw/pitch + a
  376 941-pixel view swing, patrol drift vs. an idle player that writes
  nothing).
- **Step-8 sensor bookkeeping in `examples/physics-playground` (the PH-21
  follow-up).** The playground now runs
  `PhysicsSystem({ dispatchEvents: false })` with `PhysicsEventSystem` at
  900 — PH-21's split, consumed outside a test for the first time — and a
  `ZoneTallySystem` at `PRIORITY_SENSOR_UPDATE` (800) re-measures each zone
  per fixed step with a §30 `overlapBox` (sensors excluded by the query
  default, dynamic bodies only). The step-9 listeners consume the tally: the
  repaint colour is `tally > 0`, with the ±1 §29 event counter kept and
  mirrored beside it (`data-zone*` vs `data-tally*`,
  `data-dispatch="step-9"`). +405 B gzip (A/B); all four existing playground
  gate tests unchanged and green; new `tests/browser/sensor-tally.spec.ts`
  holds the two accounts against each other at rest (reference run: 3 = 3 in
  both halves). `docs/AUDIT-120.md`'s examples row moves 9 → 10 in the same
  change (check-docs counts tracked `main.ts` files).

### 2026-08-29 — RFC 0002 §2's token spelling executed, and §61's `readPixels` lands whole (Rectangle2 prerequisite cleared)

#### Added

- **`Rectangle2` in `@fourjs/math`** (RFC 0005's recorded prerequisite, cleared):
  a mutable `x/y/width/height` type in the §7b family spelling — plan-D3
  changed hook, `clone` the only allocating method, `equalsApprox` at the
  family tolerance, half-open `containsPoint`, `isEmpty`. Deliberately
  origin-agnostic: each consuming API documents its own origin (`readPixels`:
  bottom-left, §7a). No §85 validation, per the family — consumers validate.
- **§61's `readPixels?(target, region?: Rectangle2)` joined the `Renderer`
  interface** — the last line of WP-R1.6's typed TODO, shipped exactly as
  sketched: optional (presence is the capability — `supportsReadPixels` /
  `PixelReader` in the `renderEffect` discipline), `Promise`-returning forever
  (RFC 0005), tightly packed RGBA8, rows bottom-to-top (§7a; the recorded
  WP-R1.6 decision), region in target texels from the bottom-left,
  rejects-not-skips. `validateReadbackRegion` is the shared §85 check, so both
  backends refuse a malformed region with the same words.
- **The region form on `WebgpuRenderer`**: `copyTextureToBuffer` gains an
  optional `origin` (presence-is-the-capability descriptor widening); the §7a
  bottom origin converts to WebGPU's top-first origin in exactly one place, and
  the region rides the existing 256-byte alignment, strip, and flip machinery.
  A whole-target call records no `origin` member at all — pinned, which is
  what keeps WP-R1.6's transcripts byte-identical.
- **`readPixels` on `WebglRenderer`** — the staged `gl-render-target.ts`
  entry, landed: the stalling `gl.readPixels` wrapped in §61's promise shape
  (the method doc defends the choice against the picking fence path: a
  readback is a between-frames, once-per-call operation; a fence buys nothing
  its caller is racing for). GL's native row order and read space are already
  §7a's, so the two backends agree byte for byte. Rejection contract mirrors
  WebGPU's with `CONTEXT_LOST` as this backend's loss code. A self-skipping
  region pixel proof waits in
  `tests/browser/webgpu/webgpu-readpixels-region.spec.ts` for the next
  browser-gate run.

#### Changed

- **The six §81 capability tokens moved to their owning packages** (RFC 0002
  §2's spelling; the recorded reversible spelling-difference, reversed):
  `SIMULATION_SYSTEMS` → `@fourjs/motion`, `RENDERER_REGISTRY` + `RENDER_GRAPH`
  → `@fourjs/render`, `SOLVER_REGISTRY` → `@fourjs/physics`,
  `COMPONENT_SERIALIZERS` + `SCENE_MIGRATIONS` → `@fourjs/serialization` — each
  a `capabilities.ts` declaring only `defineCapability` plus type-only
  registry imports, `@__PURE__`-annotated. `four/plugins.ts` re-exports the
  very objects, so every existing import keeps working; identity is pinned by
  `toBe` in `plugins.test.ts`. No §3.1 edge moved in either direction. The §96
  boundary test now distinguishes host machinery (banned everywhere but
  `core`/`four`, deserializers absolutely) from token declaration (allowed in
  exactly the four registry owners, reason and date recorded): a token is a
  key, not authority, and nothing a document names can become a plugin,
  exactly as before. The four tokens `Application` never references still
  grep 0 in every bundle. Measured: +0.56 kB gzip per WebGL-bearing bundle
  (the `readPixels` method on the class — the `createPickingService`
  precedent); token migration ±0.01 kB; budgets first-3d 37.5→38, particles
  36→36.5, ui-demo 44.5→45 with the A/B.

### 2026-08-29 — §71 analytic picking + node.hitTestMode (A-11 closed) and the §58 paint-object tier (R-16 closed)

#### Added

- **§71's analytic tier and its mode selector (A-11's last half; adopted RFC
  0005 Q3).** `Node.hitTestMode` exists:
  `"bounds" | "geometry" | "pixel" | "gpu"` or `null` — the default, §71's "the
  engine should select the cheapest valid method", resolved per candidate from
  what the candidate carries, which is byte-for-byte the pre-field behaviour.
  The mode gates the node, not the subtree (the `layers` scope, not the `clip`
  scope); `"custom"` is deliberately absent until a callback strategy exists.
  `@fourjs/input` gains `Pickable.triangles` (structural `positions`/`indices` —
  `BufferGeometry`'s layout without the import; plan §3.1 intact) and `pick()`
  refines a box hit by exact Möller–Trumbore ray/triangle intersection:
  unnormalized-local-ray world distances, index-order iteration and
  NaN-fails-toward-miss (§33), §85 refusals for non-whole-triangle lengths,
  out-of-range indices (WeakSet-cached scan), and an explicit mode whose
  candidate carries no data. "What draws is what picks": a §50 shape's
  candidate is built from its own tessellation. §79: `hitTestMode` rides one
  wrapper around every umbrella node-type pair (widgets included), written only
  when set — unset scenes serialize byte-identically — and corrupt values
  (`"custom"` included) restore `null`. Scenes that never pick carry ~0 B; the
  tier rides only `pick()`-using bundles (+0.60 kB gzip in ui-demo — budget
  44 → 44.5 kB with the A/B). Closes `A-11`.
- **§58 paint-object tier on `Shape2D` (R-16 follow-up, unblocked by RFC
  0001):** `LinearGradientPaint`, `RadialGradientPaint`, and `PatternPaint`
  (image _and_ render-target textures via the `MaterialTexture` seam) accepted
  by `ShapeFill`/`StrokeStyle` behind `registerShapePaints()`. A shape
  constructed without a `material` derives a §60 `NodeMaterial` that evaluates
  its paints exactly per fragment — one geometry, one `"node"` draw; different
  fill/stroke paints blend through a baked selector stream. Conic refused
  naming §60's missing angle operator; procedural covered by `NodeMaterial`
  directly. §79: paints written whole, paint-derived shapes write no material
  key, pattern textures key against a new `textures` catalog. New §33 golden
  `shape-paint-glsl.json`; browser gate now 94 tests (`shape-paint.spec.ts`,
  worst channel difference 3/255 over 34 analytic probes). Byte-identity for
  every scene naming no object paint; 0 B in bundles that never register
  (+0.41 kB shape-glue in the twin only). Unregistered = skipped-not-
  approximated (inherits §60's rule; transcript-pinned). `ShapeMaterial`
  unshipped a third time: the derived material _is_ `NodeMaterial`.

### 2026-08-29 — Fixed: three recorded truth fixes + two follow-ons

#### Fixed

- **Three recorded truth fixes (the 2026-08-29 sweep's found-not-fixed items).**
  `packages/render/src/renderer.ts`'s capability doc no longer claims the three
  backends "answer **all** of them" — it now records `WebglRenderer`'s
  deliberate omission of `maxUniformBufferBytes`/`maxBindings` (R-30b's
  lazy-query law) and `WebgpuRenderer`'s omission of `maximumSkinningJoints`,
  and the phantom `MAX_VERTEX_UNIFORM_VECTORS` byte-conversion aside is deleted
  (no such code ever existed). Comment-only; `@fourjs/render` tests green
  unchanged. `docs/guides/materials-and-render-graph.md` rewritten to the tip:
  §60 shipped (RFC 0001), §62's WebGPU backend shipped (R-1 complete), §65
  opt-in batching (R-9), §68–§70's punctual-light/shadow/post-processing tiers,
  and `Sprite.frame` (R-29) replace the "not implemented" rows and the
  atlas-cutting workaround; the §57–§59 row, material-class count, blending and
  colour-edit bullets, and the sort description were also stale and now match
  `render-list.ts`, `material.ts` and `unlit-material.ts`.
  `docs/guides/README.md` item 5's description moved with it.
  `tools/check-docs.mjs`'s §55-batched pin is kept — `renderer.batching`
  defaults to `null`, so the unqualified "batched" is still false of the
  default path — with its stale "§65 batching is unshipped" rationale replaced
  by the opt-in truth.
- **Two follow-ons at landing** (the packet's own found-not-fixed items):
  `docs/AUDIT-120.md`'s sprites row no longer says §65 batching is unshipped
  (opt-in since R-9, dated correction in place), and `CLAUDE.md`'s repository
  state counts **four** reserved stubs — `render-webgpu` left the list with the
  R-1 plan (WP-R1.1–R1.9).

### 2026-08-29 — §78 glTF 2.0 loader (A-19 closed: parse tier in `@fourjs/assets`, assembly in `four`)

#### Added

- **`createGltfLoader` / `GltfAsset`** (`@fourjs/assets`): the §78 parse tier at
  the honest glTF 2.0-core slice — `.gltf` + separate `.bin` through the
  injected `FetchLike`, base64 `data:` URIs, and the GLB container; every
  geometry attribute the §53 layer has (positions/normals/uvs/colors/
  joints/weights + u8/u16/u32 indices, `triangles`/`lines`, strided and
  interleaved accessors); §59 metallic-roughness materials with the base-colour
  texture decoded through the landed texture tier (`srgb`, sampler mapping, §96
  decompression bounds, §7a row flip — uv `v` converts at parse to match);
  skins as joints + inverse binds (no axis conversion — the binds absorb the
  authoring convention, RFC 0003); `LINEAR`/`STEP` animations as per-channel
  keyframe records; `extras` metadata. Refused loudly by name:
  `extensionsRequired` (compression included), sparse accessors, morph targets
  (GPU path staged — weights that deform nothing would draw the wrong picture),
  `CUBICSPLINE`, `MASK` alpha, point/strip/fan modes, non-zero texCoord sets.
  Ignored with a record (`GltfAsset.ignored`, §85-warned once): cameras,
  non-required extensions, unrecognized attributes, mip minFilters,
  `wrapT`≠`wrapS`. §96 throughout: every offset bounds-checked against its
  container, every subresource size-bounded before allocation where a size is
  declared, every float that can reach a transform validated finite, JSON
  through `parseUntrustedJson`'s guards. §33: parsing is a pure function of the
  input bytes — file-array traversal, explicit little-endian `DataView` reads —
  pinned by digest in `tests/determinism/gltf-load.test.ts`.
- **`instantiateGltf` / `GltfInstance`** (`four`): §78 assembly, in the
  umbrella because `@fourjs/assets`' frozen §3.1 row is `core` alone (the
  `scene-serializers.ts` argument). §78's sharing sentence applied literally:
  geometry, textures, and clips built once per asset and shared; nodes and
  (mutable) materials fresh per call. Joints become `Bone`s, skins become one
  `Skeleton` per instantiation (the landed 48-joint `UNSUPPORTED_GPU_FEATURE`
  refusal fires at `Mesh.skeleton`), skinned meshes are created
  `frustumCulled: false`, matrix-form nodes decompose here, and clips bind
  through RFC 0003's indexed-array form (`nodes.<i>.transform.<channel>`) so
  one clip plays onto any instantiation via `new AnimationMixer(instance)`.
  Texture slots the single-unit §59 tier cannot sample
  (`metallicRoughnessTexture`, normal/occlusion/emissive) are validated,
  surfaced as `GltfMaterialRecord.ignoredTextures`, and warned at
  instantiation — never silently dropped; factors still apply.
- **`createTextureDecoder`** (`@fourjs/assets`): the fetch-free half of the
  landed texture decode path as a standalone export — `createTextureLoader`
  now wraps it, and the glTF loader reuses it whole for embedded and
  buffer-view images. No behaviour change.
- **Committed fixtures** `tests/fixtures/gltf/` (hand-built, tiny):
  `quad.gltf` + `quad.bin` and `skinned-column.glb`. New gates: unit
  (malformed files are half the parse suite), integration (fixtures round-trip
  into a drawn scene; the GLB skin animates through the mixer and moves the
  palette), determinism (digest-pinned), and a browser spec
  (`tests/browser/gltf.spec.ts`) rasterising the committed quad on
  ANGLE/SwiftShader — 784/784 threshold pixels in-region, 0/784 out, one draw.

#### Notes

- `docs/SPECIFICATION.md` untouched: §78's list states requirements, not
  status (the revision-1.9 precedent for §96), so the tier is recorded here and
  in the gap register rather than as an amendment.
- Bundle cost: **0 B** in every non-loading bundle (worktree A/B: first-2d,
  first-3d, ui-demo, and particles-demo bundles byte-identical at HEAD vs
  HEAD+packet).

### 2026-08-29 — §36 GPU particle simulation wired + the Q3 ComputePass promotion (R-31 closed)

#### Added

- **§36 `simulation: "gpu"` + the Q3 `ComputePass` promotion (R-31 residue
  closed, 2026-08-29).** `@fourjs/render` gains `compute.ts`
  (`ComputePassDescriptor`, structural `ComputeBuffer`, `supportsCompute`) and
  optional `Renderer.compute?()` — the optional-member pattern's fourth
  instance; `@fourjs/render-webgpu` re-exports the promoted tokens (identity
  preserved, no call site moved) and refuses foreign buffer handles per binding;
  the umbrella ships §82's `Four.ComputePass` named-map sugar (record-key
  insertion order = binding order). `@fourjs/particles` widens
  `ParticleEmitterOptions.simulation` **in the same change** that wires
  `PARTICLE_INTEGRATOR_SHADER_SOURCE` to the emitter (the WP-9.1 rule): CPU
  spawn + GPU integrate through the structural `ParticleGpuSimulation`
  contract, implemented by `WebgpuRenderer.createParticleSimulation` —
  GPU-resident flat-lane buffers, swap-remove mirrored via a scratch, and the
  draw re-sourcing `@location(1)` from the simulation's `STORAGE|VERTEX`
  position buffer (`|gi:y` pipeline variant, zero new WGSL, joined by node id).
  GPU mode refuses `fields`/`collisionPlaneY`/unbound stepping loudly;
  GPU-simulated state is display-tier (§33) with no snapshot surface (§34) —
  recorded in `types.ts`. CPU-simulated scenes byte-identical (suites
  bit-exact; seven of nine example bundles hash-identical); compute symbols in
  0/9 bundles; particles-demo +0.55 kB (the emitter's non-shakeable option
  branch — budget bumped 35.5 → 36 kB with the measurement).

### 2026-08-29 — Docs: the documentation truth sweep (COMPATIBILITY §2, custom shaders, §77a guide)

#### Docs

- **`docs/COMPATIBILITY.md` §2 refreshed to the tip** (the recorded staleness
  item; every corrected row keeps its old wording with the date it stopped being
  true). The WebGL feature table now counts **seven** pipelines compiled at
  initialize (said "four"; stale since R-6/R-13/R-18, 2026-08-07…09) plus the
  three registered opt-in seams (skinning, picking, node materials); lighting
  gains the §68 punctual tier (`MAX_PUNCTUAL_LIGHTS = 8`, R-17); §65 sprite
  batching reads **shipped, opt-in** (`createGlBatching()`, R-9; said "absent");
  new §69 shadow and §70 post-processing rows. The capability paragraph now
  states that `RendererCapabilities` covers **all eleven** §62 fields across
  fourteen members (said "two of eleven"; stale since WP-R1.1), with the
  per-backend honesty — including the two limits `WebglRenderer` deliberately
  leaves unreported (R-30b) — and the WP-R1.9 required/optional declaration. The
  `renderer: "auto"` paragraph reads **implemented** (said "not implemented";
  stale since the §62 registry closed A-8 on 2026-08-07). The WebGPU row moved
  from "shipping in tiers" to **shipped, R-1 complete** (WP-R1.7–R1.9 landed
  2026-08-29), naming the honest absences (skinned pipelines, §71 picking). Two
  §1 consequences corrected: the WebGL-1 row's "the only backend" and the
  "WebGL 2, for anything that draws" runtime bullet.
- **`docs/guides/custom-shaders.md` rewritten around the landed §60** (the
  recorded staleness item — the guide promised "expect a declarative surface
  when §60 lands"; RFC 0001 shipped 2026-08-28). It now documents the
  graph-never-source-string §96 boundary (`ShaderMaterial` permanently
  unshipped, rev 1.11), `NodeMaterialBuilder`/`ShaderGraphBuilder`/
  `NodeMaterial`, per-backend registration (`registerNodeMaterialPipeline()` /
  `registerWebgpuNodeMaterialPipeline()`, skipped-not-drawn-flat), the closed
  operator set, vertex displacement, screen-domain `GraphEffect` passes, the
  unlit-at-this-tier limitation, and the staged RFC 0001 residue. Every sample
  typechecks against the built packages and every graph in them passes
  `analyzeShaderGraph`.
- **New guide: `docs/guides/raster-painting.md`** (§77a), closing RFC 0004's
  guide residue: the DOM-free browser-adapter recipe reproduced from
  `packages/render/src/raster.ts`'s module header, the Q6-mandated "nothing
  polls — call `update()` yourself" rule, and the §33 display-only, origin-flip,
  `"srgb"`-default, fixed-size, §96-limit and §83-lifetime rules. Listed as
  guide 15 in `docs/guides/README.md`; guide 10's description updated to the
  post-landing guide.
- **Found and reported, not fixed**: `renderer.ts`'s capability doc-comment
  overclaims ("the three backends answer all of them" — `WebglRenderer` omits
  `maxUniformBufferBytes`/`maxBindings` by R-30b decision, and the comment's
  WebGL byte-conversion aside describes code that does not exist);
  `docs/guides/materials-and-render-graph.md` remains stale across its §60, §62,
  §65 and §68–§70 rows and its §55 `frame` claim; `tools/check-docs.mjs`'s
  `/§55; batched/` retired-claim rationale still says §65 batching is unshipped.

### 2026-08-29 — WP-R1.9: §62 capability declaration and the WGSL node pipeline (R-1 complete)

#### Added

- **render: §62's "applications may declare required and optional capabilities"
  (WP-R1.9, first half).** `RendererResolveOptions.capabilities` takes a
  `RendererCapabilityDeclaration` over a closed `RendererCapabilityName` union
  (the six boolean §62 members; quantities deliberately undeclarable at this
  tier), validated per §85 before any backend is constructed
  (`validateCapabilityDeclaration`, exported). The tri-state honesty rule is
  law: a **required** capability is satisfied only by an affirmative `true` —
  `undefined` ("not taught to answer") refuses exactly as `false` does, and the
  two non-answers stay distinguishable in every report. Under `"auto"` a
  shortfalling backend is disposed and skipped with fallback reason
  `"missing-capability"` (plus per-capability
  `RendererResolveOptions.onCapabilityShortfall` reports); an explicitly named
  backend fails fast with `RENDERER_INITIALIZATION_FAILED`, spelling out each
  non-answer — §62's "rather than silently downgrading", extended from starting
  to sufficing. **Optional never gates**: the selected backend's shortfalls are
  reported, that is all. The check runs after `initialize` (§61 — the record is
  authoritative only then). §45: `ApplicationOptions.rendererCapabilities` and
  `onRendererCapabilityShortfall` forward verbatim for the string form.
  Declaration-less resolutions are unchanged; measured cost +0.10–0.12 kB gzip
  per Application bundle (the §45 fields), all budgets green, no bumps.
- **render-webgpu: WP-R1.9 — §60 node materials and §70 graph effects: the WGSL
  emitter (second half; the R-1 plan is complete).** `wgpu-node-program.ts`
  emits WGSL from the shader-graph IR — §33-deterministic (two runs
  byte-identical; new golden `tests/determinism/golden/node-material-wgsl.json`
  beside the GLSL one, pinned over structurally identical graphs) — with the
  GLSL emitter's closed-operator semantics: identical componentwise arithmetic,
  mixed `min`/`max`/`step` splat the scalar explicitly, `saturate` is the
  builtin, the §3.3.8 depth remap rides the surface vertex stage, and uniforms
  travel as all-`vec4` lanes in one block (the declare-wide/read-narrow padding
  rule, generalised to a buffer). Reached only through
  `registerWebgpuNodeMaterialPipeline()` (`wgpu-node-registry.ts`, the GL
  seam's twin — the renderer imports the slot, never the emitter): modules
  compile lazily per distinct graph on the first frame that needs one, keyed on
  the emitted source (one module for N materials sharing a structure), with
  §57-state pipelines beneath each. Surface draws ride the store's own
  256-strided uniform block (group 0: matrices + opacity/§9 time + uniform
  lanes; texture/sampler pairs at group 1, reflection order — groups documented
  as data); `positionOffset` displaces in the vertex stage; §67 clips,
  `material.stencil` (via `frameWantsStencil`'s registration-scoped node
  clause), blend/depth/colour-write state and §84 counters all apply; an
  undisplaced node caster joins §69's map (GL's rule verbatim), a displacing
  one is excluded. **§70's `"graph"` kind now draws on WebGPU** — the recorded
  R1.6 absence retired, its pin flipped deliberately — through the same store
  in its own pass: `"source"` plus declared inputs as one texture group, pass
  uniforms sorted into the screen block (zero uniform traffic for a graph copy,
  structurally), R-4's feedback refusal per sampled surface. Failure direction
  is absence throughout: unregistered, latched-emission,
  unbound/disposed/feedback textures, and missing vertex streams (a recorded
  divergence — GL shades with the default attribute) all skip with one §85
  warning. Byte-identity held: nodeless scenes transcript-identical registered
  or not, and {scene} ≡ {scene + unregistered node item}, pinned as full tapes
  on the fake device and in `tests/integration/webgpu-node-materials.test.ts`.
  Emitter 0 B unless registered (grep: node symbols in 0 of 9 bundles; control
  9/9). Browser (SwiftShader, all self-skipping without an adapter): five
  emitted module shapes compiled and rasterised to exact texels; the graph copy
  proven a per-pixel identity over an asymmetric source (the screen-domain
  `(u, 1−v)` sample flip, measured); the radial-gradient proof through the
  registered renderer — worst channel difference 3/255 over 24 probes, one
  draw call; the graph effect halving a specification-fixed source. The full
  `test:browser` gate ran 91/91, executing WP-R1.7's and WP-R1.8's
  committed-but-never-run specs for the first time — all passed unchanged;
  first-run measurements recorded into their headers per the gate convention.

### 2026-08-29 — WP-R1.8: WebGPU instanced particles and §82 compute

#### Added

- **render-webgpu: WP-R1.8 — §36 instanced particles and §82 compute.** The
  `"particles"` item kind draws on WebGPU: one instanced draw of the shared unit
  quad per system (`wgpu-particles.ts`, the `gl-particles.ts` port — view-space
  billboard over separate view/projection matrices in a third lazily-created
  192-byte group-0 block, straight-alpha blend, §67 clip stencils honoured), fed
  by a per-system instance buffer uploaded once per frame (queue-ordering forbids
  GL's per-view cadence; stated in source). Zero-count systems are skipped before
  the geometry cache uploads anything — stricter than GL, pinned as a full-tape
  A/B — and particle-less scenes record byte-identical transcripts. §82 lands as
  `WebgpuRenderer.compute()` plus
  `createComputeBuffer`/`writeComputeBuffer`/`readComputeBuffer`
  (`wgpu-compute.ts`): storage-buffer bind groups, lazy source-keyed compute
  pipelines, dispatch, exact readback — over **optional** device members
  (presence is the capability; WebGL 2's absence stays structural) — plus the
  §36 GPU particle integrator kernel (semi-implicit Euler, the emitter's closed
  form, count as f32). The `ComputePass` descriptor lives in
  `@fourjs/render-webgpu` pending Q3's `@fourjs/render` promotion (one re-export +
  optional `Renderer.compute?()`; RFC 0004 held `packages/render` concurrently).
  `simulation: "gpu"` in `@fourjs/particles` is deliberately **not** widened (the
  WP-9.1 rule: it widens in the change that wires the kernel to the emitter).
  R-31 closes on WebGPU only. Browser specs written (particle rasterisation; an
  exact integrator readback), pending the next `test:browser` run.

### 2026-08-29 — RFC 0004: the 2D raster painting stack (§77a)

#### Added

- **§77a raster painting (RFC 0004, accepted 2026-08-21; tier (b) — the seam
  tier).** `@fourjs/render` gains `RasterSource` — a structural, DOM-free read seam
  in the `TextureSource`/`FetchLike` discipline: the application paints with
  whatever it likes (its `paint()` hook takes no parameter and the engine never
  learns what it closed over), `readPixels(out)` writes RGBA8 into an
  engine-owned buffer — and `CanvasTexture`, a `MaterialTexture` that reaches
  every backend through the existing id/version upload path with **zero backend
  changes**. One buffer for the texture's life (§83-accounted via `noteTexture`);
  explicit dirty tracking (`invalidate()`/`update()` — nothing polls, per the
  adopted Q6); the §7a row flip written once in the engine
  (`origin: "top-left"`); `colorSpace` defaulting `"srgb"`, deliberately unlike
  `TextureSource`'s `"linear"`, with the reason at both (Q3); size constant for
  the texture's life, in-place resize refused `INVALID_APPLICATION_STATE` and
  gated on R-30 (Q5); §96's 64 MiB default byte ceiling with `Infinity` as the
  explicit opt-out. Painted pixels are **display content, never simulation
  input** (§33): no §79 representation, no §34 replay content, enforced by
  `tests/integration/raster-display-only.test.ts` — §40's display-only scan with
  "inexact" replaced by "unreproducible".
- **§73's canvas view ships** (`@fourjs/ui` `CanvasViewWidget`, document type
  `ui:canvas-view`): a skin-drawn control — box, supplied device-pixel
  `resolution` (`pixelWidth`/`pixelHeight`), and a monotonic `contentVersion`
  bumped by `invalidate()` through the existing `onContentChange` hook; no new
  skin hook, no dependency edge, and the widget names no texture type. Its
  recorded blocker ("needs the immediate-mode drawing surface the dependency
  matrix keeps out of this package") was **wrong** and is corrected in
  `UI_STAGED` — the widget never draws; the skin owns the §77a surface. Ten of
  §73's sixteen controls now ship. §79 payload is the box and `resolution` only —
  painted pixels are never serialized.
- Spec revision **1.12**: new §77a (letter suffix; `"77a"` added to
  `ALLOWED_LETTERED`), the §73 skin-drawn note, and the amendments row recording
  every adopted disposition. §62's Canvas 2D backend is explicitly untouched and
  `render-canvas` stays a reserved stub.
- Browser proof `tests/browser/raster.spec.ts`: a real 2D canvas painted by
  application code renders the right way up through a real WebGL 2 driver
  (upper-red/lower-blue 400/400 box counts), and only `update()` re-uploads — a
  host repaint alone and `invalidate()` alone leave the frame unchanged. Measured
  A/B: painting symbols in 0 of 9 example bundles; six bundles byte-identical,
  ui-demo +28 B / flagship +30 B (the corrected `UI_STAGED` prose), twin +213 B
  (the `ui:canvas-view` serializer pair — the one example calling
  `registerSceneNodeTypes`). No budget bumps.

### 2026-08-29 — WP-R1.7: WebGPU shadows and stencil parity

#### Added

- **WebGPU shadows and stencil parity (WP-R1.7).** §69's directional shadow tier
  lands on the WebGPU backend: a depth-only caster pass into the renderer's own
  samplable `depth32float` map (`wgpu-shadow.ts`), GL's 3×3 PCF as nine explicit
  `textureSampleCompareLevel` taps through a nearest `less-equal`
  `sampler_comparison` — a structurally distinct binding that joins a widened
  lights group riding the light buffer's spare stride bytes — and a lazy `|sh`
  variant of both shaded families, so shadowless scenes record byte-identical
  transcripts and non-receivers share the shadowless pipeline. §57 stencil parity
  completes (`wgpu-stencil.ts`): R1.3's recorded residue is retired — a
  `material.stencil` alone now selects the stencil-carrying frame format on
  screen via a frame scan (R-7's mask-by-hand tier, no renderer option needed;
  off screen the target's `stencil` option still decides, GL's parity). New
  browser parity specs (shadow threshold; the stencil 1/6 mirror) under
  `tests/browser/webgpu/`.

### 2026-08-29 — RFC 0005: pixel/GPU-id picking (A-11's remaining half)

#### Added

- **§71 pixel/GPU-id picking (RFC 0005 — A-11's remaining half).** `@fourjs/render`
  gains the backend-neutral seam (`PickingService`,
  `Renderer.createPickingService?()` — presence-is-the-capability; Canvas 2D/SVG
  declare the tier absent by omission per the adopted Q6), the §33 candidate-table
  rules (`collectPickCandidates`, traversal-ordered, rebuilt per pass) and the
  exact id codec (`encodePickId`/`decodePickId`, index+1 in RGBA8, 0 = nothing,
  overflow refused per §85). `@fourjs/render-webgl` executes it behind
  `registerPickingPipeline()` (fifth registration seam): a lazily compiled flat id
  program draws the frame's own view list — §66 order, frustum cull, material
  depth/colour state and §67 clip stencils included; skinned and particle items
  resolve through absence, stated — into a service-owned target, read back
  asynchronously on WebGL 2's fence path (`PIXEL_PACK_BUFFER` + `fenceSync`,
  stalling `readPixels` as the degradation) with `CONTEXT_LOST`-honest staleness
  by cache-era identity. `@fourjs/input` gains the render-free `PickProvider` seam
  and RFC 0005's adopted Alternative D: `Pickable.alphaMask` confirms a bounds hit
  against CPU-resident texel alpha (§55 frames via `region`). `four` gains the
  promised adapter `createPickProvider(service, viewport)`. Scenes that never pick
  are byte-identical (transcript-proven, including the frame _after_ an id pass);
  the GPU tier is grep-absent from all nine example bundles; browser-proven on a
  real driver (`tests/browser/picking.spec.ts`: co-planar submission order
  resolves the front-most id). ui-demo budget 43.5→44 kB with the measurement.

### 2026-08-28 — WP-R1.6: WebGPU render targets, effects, readPixels

#### Added

- **render-webgpu: WP-R1.6 — render targets, §70 effects, §63 graph
  participation, §61 `readPixels` (§48, §61, §62, §63, §67, §69, §70, §92;
  RFC 0005).** The WebGPU backend renders off screen: `wgpu-render-target.ts` is
  the fourth id/version cache (colour `rgba8unorm` with attachment+sampling+copy
  usage; depth per an exported format table — `depth24plus` plain,
  **`depth32float`** for the samplable `depthTexture` form (guaranteed sampleable
  _and_ copyable, unlike `depth24plus`'s depth aspect), `depth24plus-stencil8`
  for `stencil: true`, so §67's `stencil` ⊥ `depthTexture` exclusivity survives
  the port for WebGPU's own reason). A rendered target is sampled back through
  R-4's `resolveTexture` seam — one lazy bind group over the texture cache's own
  layout object, one shared linear-clamp sampler, and the same feedback refusal:
  a draw sampling the active target is dropped, an effect writing its own source
  is skipped, and `RenderGraph.validate()` names both statically. `renderEffect`
  draws §70's copy, grade and output transform as lazy per-(kind × format)
  pipelines through the shared cache (conditional `|e:` key suffix — landed keys
  byte-identical); each kind is its own WGSL module with no per-fragment branch,
  only the grade touches a 16-byte uniform block, and there is no state envelope
  to restore because a WebGPU pass has no ambient state. RFC 0001's `"graph"`
  kind is absent-not-approximated until the WGSL emitter lands. `RenderGraph`
  needed no change — `graph.execute` over this backend emits the byte-identical
  transcript of the hand-written `render`+`renderEffect` sequence (pinned in
  `tests/integration/webgpu-render-to-texture.test.ts`).
  `WebgpuRenderer.readPixels(target)` ships §61's member in the whole-target
  form (`region` waits on `Rectangle2`, RFC 0005's named prerequisite):
  `copyTextureToBuffer` + `mapAsync` — WebGPU has no synchronous readback, the
  standing evidence for RFC 0005's Promise-forever contract — with 256-byte row
  alignment stripped on repack and rows returned bottom-to-top (§7a's order, and
  the order GL's `readPixels` will naturally produce). §67 into targets: a
  stencilled target masks and serves `material.stencil` without clips; a clip
  into a stencil-less target warns once (DEV) and fails toward drawing. Browser
  specs written (`tests/browser/webgpu/webgpu-effects.spec.ts`, self-skipping):
  a compile-and-rasterise line per effect module — copy bit-exact, grade and
  encode threshold-matched against CPU models. Coverage 99.70/99.41 → 99.75/99.53
  (new files 100×4); 0 B in every bundle (rebuilt bundles byte-identical; no
  WebGPU symbol in any of 9, `createVertexArray` control 9/9); no budget bump.

### 2026-08-28 — RFC 0001: the §60 shader and node-material system (R-14)

#### Added

- **RFC 0001 — §60 shader and node-material system (gap R-14; §57, §58, §60, §63,
  §70, §96).** The unit of extension is a serializable graph, never a source
  string. `@fourjs/materials` gains the §60 IR — `ShaderGraph`, a closed-operator,
  JSON-ready graph validated and reflected by `analyzeShaderGraph` (§85 caps on
  nodes and samplers) — the fluent `NodeMaterialBuilder`/`ShaderGraphBuilder`
  authoring surface (§60's own example compiles), and §57's `NodeMaterial` (frozen
  graph; per-material uniforms and textures, RFC Q3's decided tier; unlit at this
  tier, sequenced R-14 → R-17 → R-13). `RenderItemKind` gains `"node"` — one
  member for the family, decided at item-generation time; the per-graph
  compiled-pipeline identity is the graph's structure, resolved by the backend's
  program cache, and `pipelineOf`'s flat-colour fallback deliberately excludes it
  (an unregistered node draw is skipped with one §85 warning, never substituted).
  `ScreenEffect` gains `GraphEffect` — §70's custom full-screen passes as data,
  moved staged → shipped — whose full sample set stays visible to
  `RenderGraph.validate()` (declared inputs; no `"opaque"` issue; feedback and
  ordering checks run over them, and over a scene pass's node-material bindings).
  The WebGL 2 backend emits GLSL ES 3.00 behind `registerNodeMaterialPipeline()` —
  the fifth explicit-registration seam — compiling lazily, per distinct graph, on
  first draw; one program serves any number of materials (structural source-pair
  key), per-graph compile failures are latched and warned once, and vec2/mat3
  uniforms travel padded as vec4/mat4 so the backend's GL budget is unchanged.
  Emission is §33-deterministic (array-order walk; dead-node elimination is the
  only transform), pinned byte-for-byte by
  `tests/determinism/shader-graph-glsl.test.ts` + `golden/node-material-glsl.json`.
  Byte-identity for node-material-free scenes proven by whole-transcript A/B
  (with/without registration; with/without the node renderable) in
  `tests/integration/node-materials.test.ts`; real-driver proof
  `tests/browser/node-material.spec.ts` — a radial-gradient graph (the picture
  per-vertex colour cannot produce) matches its analytic model within 3/255 over
  24 probes, one draw. Spec revision 1.11 records §57's `ShaderMaterial` as
  permanently unshipped and §60's no-raw-source narrowing + shipped/deferred
  tier; the security guide's shader row moved partial → met. §58's linear/radial
  gradients, image pattern, procedural and render-target paints are now
  expressible exactly per fragment (conic waits on an angle operator). Measured
  +0.60–0.79 kB gzip frame-path cost per WebglRenderer bundle (A/B against a HEAD
  worktree); the emitter is 0 B unless registered (grep: emitted-GLSL strings in
  0 of 9 bundles). Budgets bumped 36.5→37.5, 34.5→35.5, 43→43.5 with the numbers.

### 2026-08-28 — WP-R1.5: WebGPU lit and standard pipelines, lights

#### Added

- **render-webgpu: WP-R1.5 — lit and standard pipelines, lights (§68, §59,
  §60a).** The WebGPU backend shades: `wgpu-lit.ts` and `wgpu-standard.ts`
  hand-port the GL backend's Lambert and Cook-Torrance (GGX/Smith/Schlick) stages
  to WGSL — same operation order, 1/π folded out of both lobes per R-13, same
  guards; shadows arrive with WP-R1.7, and until then the stages match GL with
  `useShadow` at its initial `false`, exactly. `wgpu-lights.ts` replaces GL's five
  per-program uniform uploads with **one uniform buffer**: a 592-byte all-`vec4`
  block per rendered view (768-byte stride), bound at group 1 with a dynamic
  offset, packed from the same `collectSceneLights` record both backends consume —
  same eight-light limit, same first-in-scene-order selection. `useMap` and the
  normal stream are lazy pipeline _variants_ (eight WGSL modules across the two
  families, each compiled only when drawn, each with its own browser
  compile-and-rasterise line); §59's extra uniforms ride a third group-0 layout
  over the same strided buffer (the sprite precedent). Normals upload per shaded
  acquisition, so a scene with no lit materials — normal-carrying geometry
  included — records the byte-identical transcript it always did.

### 2026-08-28 — WP-R1.4: WebGPU shapes and vertex colours

#### Added

- **WP-R1.4 (R-1): §50 shapes and §53/§58 vertex colours proven on the WebGPU
  backend** — a tests-only packet, as planned: a scene of `Shape2D`s records the
  byte-identical WebGPU command transcript (tape, serials and uniform bytes
  included) as plain `Renderable`s over the same geometries; a painted, stroked
  shape is one draw through the lazy `unlit|vc` variant with its colour stream at
  slot 1; the render-list consumption contract holds kind for kind between WebGL 2
  and WebGPU for tessellated shape scenes; and RFC 0003's skinned kinds are pinned
  as transcript-invisibly skipped (no upload, no draw, never bind pose) until a
  joint-palette pipeline exists. New self-skipping browser spec compiles the vc
  variant's WGSL on a real adapter — the one unlit variant no adapter had run. No
  backend behavior changed; comment-only staging notes in `webgpu-renderer.ts`.
  (`tests/integration/webgpu-shapes.test.ts`,
  `tests/browser/webgpu/webgpu-vertex-colors.spec.ts`)

### 2026-08-28 — RFC 0003: §54 skinning and skeletal animation (PH-10 + R-22)

#### Added

- **RFC 0003 implemented — §54 skinning and skeletal animation (gaps `PH-10` +
  `R-22`; spec revision 1.10).** `@fourjs/scene` gains `Bone` (an ordinary `Node` —
  §42 authority, §19 blending, §79 and animation apply with no new mechanism),
  `Skeleton` (joint index = position in `bones`, insertion order the §33 ABI;
  `update` derives the palette `inverse(skinRootWorld)·boneWorld·inverseBind[i]`
  in a fixed association order), and the `MorphWeights` component (+ serializer,
  registered the same packet). `BufferGeometry` gains the §53 `joints`/`weights`
  attributes (4 influences/vertex, §85-validated; weight sums are the author's
  contract), bound by the WebGL backend at fixed locations **4/5**. `@fourjs/render`
  gains §54's `Mesh` (skeleton refused over `MAX_SKINNING_JOINTS = 48` at setup
  with `UNSUPPORTED_GPU_FEATURE`; `morphTargetWeights` is an accessor over the
  component; §79 skeleton reference restored by id on first read via
  `restoreMeshSkeleton`), the `"skinned-unlit"`/`"skinned-lit"` render-item kinds
  with the palette refreshed in the same list build, and the optional
  `RendererCapabilities.maximumSkinningJoints`. `@fourjs/render-webgl` gains the
  lazily-registered skinning pipeline (`registerSkinningPipeline()`; programs
  compile on a renderer's first skinned draw — skinless scenes transcribe
  byte-identically, transcript-asserted; unregistered/uncompilable/unskinnable
  draws are skipped with one warning, never shown in bind pose). §17 is **9 of 9**
  with zero new `ValueKind`s — the two "missing" track types are the indexed-array
  binding form (`bones.<i>.…`, `weights.<i>`), documented and tested in
  `@fourjs/animation` (+ `createArrayElementBinding`). New determinism golden
  `skinned-pose.json` (§33 `same-runtime`; the palette is the envelope's last CPU
  value — no engine API returns skinned vertex positions), new browser proof
  (two-bone column bends 90° on a real driver: arm region 0→480 px, top 560→0,
  one draw). Bone-axis disposition adopted: the engine imposes **none**; +Y is a
  helper convention only (`ik.ts` reconciled). Bundle cost: +0.75–0.80 kB gzip per
  WebglRenderer bundle (frame-path); the pipeline itself is 0 B unless registered.
  Budgets: first-3d-scene 36→36.5, particles-demo 34→34.5, ui-demo 42→43 kB.

### 2026-08-28 — WP-R1.3: WebGPU sprites, text, batching and §67 clips

#### Added

- **WP-R1.3 — WebGPU sprites, text, §65 batching and §67 clip application.**
  `@fourjs/render-webgpu` gains the §55 sprite pipeline (`wgpu-sprite.ts`: quad-uniform
  uv derivation, `texture × tint`, always-blend, R-29 frame reparametrization) over a
  second, lazily-created group-0 layout — the shared `DrawUniforms` layout does not
  move, so spriteless transcripts are byte-identical; §56 text needs nothing new
  (a label is one textured unlit draw since R-28, proved on WebGPU in
  `tests/integration/webgpu-sprites-text.test.ts`); and the §65 uploader
  (`wgpu-batch.ts`, `createWgpuBatching`) behind the shared planner — opt-in,
  type-only-imported, drawing merged runs through the unlit WGSL modules over one
  interleaved vertex buffer. Structural note recorded in source: `queue.writeBuffer`
  executes in queue order, not issue order, so the uploader keeps a buffer pair per
  batch slot rather than GL's single pair; §65's staging ring is noted, not built.
  §67 clips now apply: mask draws write stencil bit planes (colour/depth forced off,
  through the flat unlit pipeline — a mask is coverage, not shading), clipped draws
  test `equal` over the accumulated planes, `item.clip` outranks `material.stencil`,
  batch runs break on record identity, and the stencil reference is the one §57
  field left as a pass command (issued only on change). The depth format is decided
  per frame from R-23's O(1) sort-key question: `depth24plus-stencil8` only when the
  frame clips — no `stencil` option and no no-stencil diagnostic, because this
  backend owns its depth attachment and can always widen it. Clipless scenes record
  the WP-R1.1/R1.2 transcript byte for byte (every landed expectation unmodified).
  New browser specs (self-skipping): sprite/batch rasterisation with real texture
  sampling (the deferred WP-R1.2 evidence), and two-plane stencil intersection.
  Coverage 99.61/99.24, new files 100×4; no bundle carries a WebGPU symbol (grep).

### 2026-08-28 — R-23: §67's clipping API

#### Added

- **R-23 — §67's clipping API (2026-08-28).** `node.clip = true` on any drawable
  masks its subtree to the node's own drawn shape, expressed entirely in §57
  stencil records over R-7's substrate: the render list emits a colour/depth-less
  mask draw per clip ahead of all content, assigns stencil bit planes 0–7 in
  traversal order (§33), and hands every clipped item one shared read-only `equal`
  test over the accumulated planes — so nested clips intersect by construction and
  a clip boundary ends a §65 batch run by record identity. The ninth concurrent
  clip is dropped with §67's required diagnostic and its subtree spills rather
  than vanishing; a clip on a non-drawing node and a clip without a stencil buffer
  warn in development and fail toward drawing. §79 writes `clip` beside the three
  §49 flags on every drawable (`RenderableOptions.clip`, `SpriteOptions.clip`).
  New browser gate: nested clips visibly intersect on a real driver (69 browser
  tests). Scenes with no clips are byte-identical at the GL boundary
  (`FRAME_BEFORE_R7` unmoved); +0.50 kB gzip in every bundle, no budget bumps.

### 2026-08-28 — WP-R1.2: WebGPU texture and sampler caches (§77, §83)

#### Added

- **WP-R1.2 — WebGPU texture and sampler caches (§77, §83).** `@fourjs/render-webgpu`
  gains `WgpuTextureCache`: id/version-keyed `queue.writeTexture` uploads
  (`rgba8unorm`, `rgba8unorm-srgb` for §60a-tagged textures), a separate sampler
  cache deduplicating `GPUSampler`s on the canonical resolved key
  (wrap | magFilter | minFilter | mipmapFilter | anisotropy), and blit-based mip
  generation — WebGPU has no `generateMipmap`, so the chain is drawn, one half-size
  pass per level, through a lazily compiled generator that costs nothing when
  unused. The unlit tier gains its `map` variant: uv stream at `@location(2)`,
  texture+sampler bound at group 1 with the layout declared as data; the geometry
  cache uploads uvs. §84 accounting matches the GL backend byte for byte
  (4 × 4 mipmapped = 84 bytes, asserted against `Texture.byteLength`). New
  cross-package suite `tests/integration/webgpu-textures.test.ts`;
  `recording-gpu.ts` gained `writeTexture`, `createSampler`, and mip-level view
  recording. Coverage 99.57/99.18 (from 99.33/98.75); all six bundles unchanged.

### 2026-08-28 — A-3: the §81 plugin system (RFC 0002)

#### Added

- **`@fourjs/core` gains the §81 plugin host (RFC 0002, gap `A-3`).** `FourPlugin`,
  `PluginContext`, `PluginHost`, `installPlugins`, `defineCapability`,
  `bindCapability`, `satisfiesPluginRange`, and `PLUGIN_API_VERSION`. A plugin
  declares `name`, `version`, optional `dependencies`, and an optional
  `engineRange`; `install` may be asynchronous. Install order is **topological
  over `dependencies`, ties broken by the order plugins were supplied** — a §33
  requirement, not a convenience, because a plugin may register a `SimulationSystem`
  and equal-priority systems run in registration order, so an unspecified install
  order would be an unspecified fixed-step order.
- **Six capability tokens, exported from `four`** (the umbrella is the one package
  that sees all four registry owners at once, and `@fourjs/core` may name none of
  them under the frozen §3.1 matrix): `SIMULATION_SYSTEMS` (§39),
  `RENDERER_REGISTRY` (§62), `SOLVER_REGISTRY` (§37), `COMPONENT_SERIALIZERS` (§79),
  `SCENE_MIGRATIONS` (§80), `RENDER_GRAPH` (§63). §79's shipped promise —
  "components serialize under registered type names; plugins register theirs
  (§81)" — is executable for the first time.
  **Five of §81's eleven extension points have no token at all** (asset formats,
  materials and shader nodes, UI controls, editor tools, compute workloads): there
  is no registry to hand over, so a plugin asking is refused by name rather than
  registering into nothing. Adding a token later is additive.
- **`ApplicationOptions.plugins`** (§45, as amended — see below). Installed in
  `initialize()`, last, so a plugin sees a resolved renderer and an initialized
  world; a refusal rejects `initialize` and leaves the application uninitialized.
  `Application` provides `SIMULATION_SYSTEMS` always and `RENDERER_REGISTRY` when
  §45's `rendererRegistry` option supplied one; a plugin needing a solver registry,
  a serializer registry, or a render graph installs through a standalone
  `PluginHost`, because an `Application` holds none of those and naming them would
  put `@fourjs/physics` and `@fourjs/serialization` in every bundle. `app.pluginContext`
  publishes the sealed context.
- **`PLUGIN_API_VERSION` starts at `0.1.0`** and is versioned independently of
  package semver (§90), like the §79 scene format. The range grammar is
  deliberately restricted to `*`, `X.Y.Z`, `^X.Y.Z`, `~X.Y.Z`, `>=X.Y.Z`; anything
  else is refused with a message saying so, rather than taking a semver dependency
  into the package every other package depends on. Consequence worth knowing:
  a caret range below 1.0.0 is minor-locked, so `^0.1.0` refuses `0.2.0`.

#### Changed

- **Specification revision 1.9.** §45's `ApplicationOptions` gains
  `plugins?: readonly FourPlugin[]` and the paragraph stating that installation
  happens in `initialize` (RFC 0002 open question 1, owner disposition (a) —
  the §40 "don't invent §45 options" precedent turned on `units` being absent from
  §45's own list, whereas §81 requires an install lifecycle and §45 owns the
  lifecycle). §81 gains `dependencies`/`engineRange` (the declaration its own
  closing sentence already required and its code block omitted), the
  capability-token statement, the specified install order, the revocability rule,
  and the §96 boundary. Frozen §1–120 numbering untouched.
- **`docs/guides/security-and-untrusted-content.md`:** §96's _"safe shader/plugin
  boundaries"_ row moves **absent → partial**. See below.

#### Security

- **§96's plugin half is answered, and the answer is a boundary rather than a
  sandbox.** A plugin is JavaScript the application imported and runs with the
  application's authority; nothing here isolates it and nothing claims to. What is
  enforced is that **untrusted content can never become a plugin**: `PluginHost.add`
  and `ApplicationOptions.plugins` take a `FourPlugin` _value_ — no URL, no module
  specifier, no name resolved out of a document — so no deserialization path can
  reach the host, and a scene document naming an unregistered component type gets
  §79's existing error rather than a load. Plugins named in a scene file were
  rejected outright rather than staged, because that is arbitrary code execution
  from a scene file in the plainest possible form. Both halves are checked, not
  asserted: `tests/integration/plugin-boundary.test.ts` fails if any package but
  `core` and `four` so much as mentions the host, and pins that `add`'s parameter
  admits no string.

#### Fixed

- Nothing. `A-3` was an absence, not a defect.

#### Notes

- **Uninstall is not symmetric, and the design says so instead of pretending.**
  A capability declares its revocability (default `false`, owner decision), and a
  plugin that acquired a non-revocable one **cannot be uninstalled**: the attempt
  raises `INVALID_APPLICATION_STATE` naming the capability that pins it, rather than
  running `uninstall` and leaving a half-removed registration behind. Only
  `SIMULATION_SYSTEMS` is revocable, because only `SystemRegistry` has real removal;
  `ComponentSerializerRegistry` has none, deliberately, so a document's shape cannot
  depend on evaluation order. For most plugins the honest lifecycle is install-once.
- **Measured: `PluginHost` tree-shakes out of every bundle** (grep-verified in all
  four tight examples), but the **installer does not**, and cannot: a plugin is a
  value passed at runtime, and side-effect registration is forbidden, so
  `Application.initialize` must statically reach it. **+1.28–1.31 kB gzip in every
  bundle carrying an `Application`** (A/B by revert-and-rebuild). Three budgets
  bumped with the measurements: first-3d 34.5→36, particles 32→34, ui-demo 40.5→42.

### 2026-08-21 — RFCs 0001–0005 accepted

#### Decided

- **RFC 0001 (shader + node materials), 0002 (plugin system), 0003 (skinning), 0004
  (raster painting), 0005 (pixel picking) are accepted** by owner instruction
  ("Continue with the remaining WPs and the RFCs"), with each RFC's recommended
  dispositions of its flagged questions adopted. Implementation joins the queue in
  dependency order — 0002 (independent), 0003 (unblocks §54's silent rows, `R-22`,
  glTF's third blocker, the `PH-22g/h/i` cross-tier letters), 0001 (unblocks `R-14`,
  the shape paint pipeline, `ShaderMaterial`, and WP-R1.9's WGSL emitter), 0005
  (`A-11`'s pixel half), 0004 (the raster painting stack) — interleaved with the
  remaining WebGPU work packets. Coordination rule re-affirmed: RFC 0001 and 0003 both
  widen `RenderItemKind`, and whichever implementation lands first owns the
  `pipelineId` shape.

### 2026-08-21 — WP-R1.1: the WebGPU backend's foundation

#### Added

- **`@fourjs/render-webgpu`: the WebGPU backend's foundation (R-1, WP-R1.1).** The
  reserved stub is now a real backend: `WebgpuRenderer` acquires an adapter, a device
  and the canvas's `"webgpu"` context (the first `initialize` for which the `Promise` is
  not a formality), clears per view, and draws unlit geometry through the same
  `buildRenderList` → `buildViewRenderList` → draw path the WebGL 2 backend uses.
  `registerWebgpuRenderer()` opts into §62's registry. **Calling it moves your
  application off WebGL 2**, because `AUTO_RENDERER_ORDER` prefers WebGPU — the
  registration is deliberately an explicit, per-application opt-in and there is no
  "register everything" convenience. Sprites, text, lighting, particles, shadows,
  effects and compute are packets R1.2–R1.8 and are absent rather than stubbed: an item
  this tier cannot draw is skipped, never approximated.
- **Hand-written WGSL, with its bind-group layout declared as data** — a table in
  TypeScript rather than implicit in a shader string, so RFC 0001's future WGSL emitter
  targets the same layout instead of inventing a second one. No `layout: "auto"`
  anywhere in the backend.
- **A WebGPU browser gate**, `tests/browser/webgpu/`, running against a real SwiftShader
  adapter: a cleared surface read back through `mapAsync`, and the backend's own unlit
  WGSL compiled and rasterised. The specs skip themselves where no adapter can be had.
- **The render-list consumption contract as a test**
  (`tests/determinism/render-list-consumption.test.ts`): `NullRenderer`,
  `WebglRenderer` and `WebgpuRenderer` are shown to receive the identical
  `RenderItem[]` — same items, same order, same transforms — for one scene and two
  views. The first time §61's "the logical scene shall remain independent of the
  selected backend" is testable rather than aspirational.

#### Changed

- **`RendererCapabilities` now covers all of §62's list** — texture formats,
  multisampling, floating-point targets, timestamp queries, storage buffers, compute
  shaders, indirect draw, compressed textures, shader precision, and maximum
  uniform-buffer size and bindings. Every added member is **optional**, and `undefined`
  means "this backend has not been taught to answer" — a third answer distinct from
  `false`, which keeps the widening additive: existing implementations and test doubles
  satisfy the type unchanged. `NullRenderer` answers the headless floor; the WebGL 2
  backend answers every member it can state without a new GL query
  (`computeShaders: false` on WebGL 2 is a true statement, not a shortfall) and omits
  "maximum uniforms and bindings" rather than move landed transcripts for numbers
  nothing reads yet.
- `playwright.config.ts` gains a third project, `webgpu`, whose browser is launched with
  `--enable-unsafe-webgpu`. The flag is **per project**: with it set globally the §118
  flagship's slow-motion assertion fails reproducibly, because initialising Dawn changes
  the frame pacing that spec measures.

### 2026-08-21 — PH-11b: the solver-backed character controller

#### Added

- **§12 solver-backed character controller (`PH-11b`).** `@fourjs/physics` ships
  `SweptCharacterController` — a capsule swept through `PhysicsWorld.shapeCast` (§30)
  with **slide along wall**, **step height** and a **slope limit** — and
  `SweptCharacterSystem`, which advances it at §39 step 4 (`PRIORITY_KINEMATICS`, 400)
  under §42's `"kinematic"` authority, before the solve at 600 so a character carrying a
  `"kinematic-position"` body feeds the solver this step's pose. It **holds** a
  `@fourjs/motion` `CharacterController` rather than extending one: the held instance is
  the heading/intent/parameter store (unit-disc clamp, unbounded yaw, every §85 refusal,
  executed once), while the swept class owns the vertical integrator and the collision
  resolution. Collide-and-slide is bounded by a stated `maxSlides` (default 4) and
  leftover motion is dropped rather than tunnelled; step-up is one up/forward/down triple
  per step whose forward reach has a floor of one capsule radius (a step that stops on
  the lip contacts the step's _edge_, whose normal is not the tread's). §85 refuses
  rather than clamps: capsule size, a skin thicker than the radius, a slope limit outside
  `[0, π/2)`, a non-integer slide budget, a `"2d"` world. **Staged with the seams
  named:** pushing dynamic bodies (§26 impulse policy) and moving-platform carry — for
  which `groundBody` and `translate()` are published so an application can do it today.
  §79 serializer registered by `registerPhysicsSerializers` (vertical state round-trips,
  move intent does not; the world is re-bound after a reload). §33 tier `same-runtime`
  with a new golden on real Rapier 3D. Bundle cost measured: **0 B** in five of six
  budgets, **+2.14 kB gzip** in `motor-digital-twin`; no budget bumps.

### 2026-08-21 — R-30b: §77 mipmaps, the min-filter split, and anisotropy

#### Added

- **§77 mipmaps, the min-filter split, and anisotropy (R-30b).** `TextureSource.mipmaps`,
  `.minFilter` and `.anisotropy` in `@fourjs/render`, mirrored as optional `MaterialTexture`
  fields and applied by `TextureCache` at upload. R-30 recorded that the `minFilter` split
  would "land with mipmaps, beside this field", and it did: `filter` is unchanged and _is_
  the magnification filter, `minFilter` is the min-side override carrying GL's four
  `*-mipmap-*` modes, and there is deliberately no `magFilter` — magnification has no mip
  levels to choose between, so the pair would split a direction that cannot carry the four
  values motivating the split. `minFilter` defaults to a **derived** value, never a
  constant: `filter` with no chain (which is what its absence always meant), that filter's
  chain-aware form with one. A mip-choosing `minFilter` without `mipmaps: true` is refused
  (§85) — GL calls such a texture incomplete and samples it opaque black. WebGL 2 needs no
  power-of-two size for either mipmaps or `REPEAT`; a §62 WebGL 1 tier would have to
  refuse both. **Anisotropy is §62, not §85**: `EXT_texture_filter_anisotropic` is an
  extension, so a request is clamped to the device ceiling and dropped where the extension
  is absent — presence is the capability — while §85 still refuses what no device could
  honour (a non-integer, or below 1). The extension is queried **lazily**, on the first
  texture asking for more than 1, so a context that never meets one issues no GL call and
  every recorded transcript is unchanged. `WebglContext.generateMipmap` and `.getExtension`
  are optional for the same reason; a context lacking the first degrades to one level with
  an in-level min filter rather than a black surface. `Texture.byteLength` now bills the
  whole chain, summed level by level, so §84's `textureMemory` stays true. Byte-identity is
  structural: a texture naming none of the three issues the identical five-call upload in
  the identical order, asserted as a whole transcript in the backend suite and through the
  real renderer in `tests/integration/texture-mipmaps.test.ts` (a mipmapped upload is the
  plain one plus exactly one `generateMipmap` and one changed argument). Proven on a real
  driver in the new `tests/browser/mipmaps.spec.ts`: a minified checkerboard is 81% extreme
  pixels bilinearly and 1% trilinearly, and a half-pixel nudge moves the un-mipmapped frame
  by 120 mean luma against the mip chain's 39 — the shimmer, as a number. Still deferred
  from §77, each with its reason: cube/array/3D targets (sampler-type work in every
  shader), compressed containers (a new upload call plus §62's format report), video and
  `ImageBitmap` sources (per-frame update semantics, an assets-side adapter), async upload
  with residency diagnostics. Measured +0.33–0.69 kB gzip per bundle carrying `Texture`;
  budgets bumped 34.5 / 32 / 40.5 kB with the A/B numbers.

### 2026-08-21 — R-1 scoped: the WebGPU backend has an executable plan

#### Documentation

- **`R-1` (§62 WebGPU backend) has an executable tiered plan**:
  `docs/plans/R1-WEBGPU_PLAN.md` re-reads §62's promises against the render interface as
  it stands today (seven pipelines, three resource caches, a batching planner, a graph, a
  registry) and decomposes the backend into nine serial work packets in the house
  `IMPLEMENTATION_PLAN.md` §2 format. Three findings change what the gap row can claim:
  - **CI can run WebGPU.** Measured in the sandbox against the pre-installed Chromium:
    the single flag `--enable-unsafe-webgpu` yields a SwiftShader adapter on both the
    full binary and `headless_shell`, running a WGSL render pipeline, render-to-texture,
    a `mapAsync` readback and a compute pipeline with storage buffers. The flag does not
    disturb the existing WebGL 2 gate. Node has no `navigator.gpu`, so the Vitest tier
    stays doubles-only.
  - **Pixel identity between backends is not claimable and must never be asserted.** The
    shared invariant is the _render-list consumption contract_ — both backends receive
    byte-identical render lists and batch plans, asserted by a shared harness. Transcript
    identity stays a per-backend, code-path claim.
  - **RFC 0001 is a soft blocker, not a hard one.** The RFC defers WGSL generation
    because no backend exists; the gap row says the backend needs the shader model. The
    plan breaks the deadlock by hand-porting the seven pipelines (what the GL backend
    already did once), leaving the emitter as a follow-up that hand-written WGSL finally
    makes testable.
    No package, test, or specification file was touched. Four owner questions join the §5
    register (rows 21–22).

### 2026-08-21 — PH-11's residue closed: §12 character controllers and §44's first-person camera

#### Added

- **§12 character controllers (`PH-11`'s residue) and §44's first-person camera
  (`R-36`'s last substantive staged rig).** `@fourjs/motion` ships `CharacterController` —
  parameter-driven planar move intent clamped to the unit disc, the character's yaw as
  the single source of its heading, gravity/vertical velocity/terminal velocity/jumping
  against a ground plane — and `FirstPersonLook`, the pitch-only look channel. Both are
  §6a components advanced by the existing `KinematicSystem` at §39 step 4 under §42's
  `"kinematic"` authority (locomotion → free look → commands, per node), because all
  three components write the same node's transform under the same authority and §42
  compares the authority rather than the system. A first-person camera is the
  character's yaw composed with a child eye's local pitch — two nodes, one writer each,
  no authority conflict to arbitrate; proved over 240 fixed steps of a walking,
  pitching, jumping character whose world forward matches
  `(−cos p·sin yaw, sin p, −cos p·cos yaw)` on every step, with zero §42 warnings,
  beside a `FollowRig` + `LookAtConstraint` chase camera in the same registry. §85
  refusals at authoring; a non-finite pose mid-step is a counted `skippedSteps`, never a
  throw — both writes commit or neither does. §79 pairs ship in the same batch and are
  registered by `registerSceneNodeTypes()`. §33 tier `same-runtime` with a new
  three-form golden (`tests/determinism/golden/character-controller.json` — pinning both
  arms of `jump()`'s refusal, the pitch-pole guard being reached, and the
  terminal-velocity clamp biting). Slide, step height, slope limits and capsule sweeps
  are **staged** as a `@fourjs/physics`-tier packet over `PhysicsWorld.shapeCast` (§30),
  because §3.1 runs the dependency edge `physics → motion` and not the reverse. Bundle
  cost: **0 B** in every bundle that does not call `registerSceneNodeTypes()`,
  **+0.93 kB gzip** in `motor-digital-twin`.

### 2026-08-21 — RFC 0005 drafted; the tests/ typecheck hole closed

#### Added

- **RFC 0005 — pixel and GPU-identifier picking (§71)** (`docs/rfcs/0005-pixel-picking.md`,
  draft, owner decision pending). Closes `A-11`'s outstanding half at the _design_ level:
  the analytic half fell with R-23/R-24's `toPath()`, but the pixel/GPU-id half needs a
  render target that plan §3.1 forbids `@fourjs/input` from importing. The RFC proposes a
  `PickingService` in `@fourjs/render` plus a structural `PickProvider` seam
  (`pick(ndcX, ndcY): Promise<string | undefined>`) that the application hands to input —
  the FetchLike / SurfaceSizedCamera precedent, so `@fourjs/input` gains no new dependency.
  Records the design constraint an implementer would otherwise miss: `Node.id` is a
  _string_, so an id buffer must encode a traversal-ordered per-pass table index (a §33
  obligation), never the id itself. Six flagged owner questions (§5 register rows 18–20).
- **`pnpm typecheck:tests`** — `tests/tsconfig.json` existed but no script ever ran it, so
  `tests/{integration,determinism,browser,visual}` sat outside every tsc project and
  excess-property checking never applied there. Wired into CI immediately after
  `typecheck:examples` (and, for the same reason, after `Build`).

#### Fixed

- **21 type errors the new `tests/` gate found**, in five classes, each fixed as the
  misspelled intent rather than by weakening an assertion: 13 ×
  `new OrthographicCamera({ height, aspect })` (silently ignored, leaving the default unit
  box — rewritten as explicit bounds per R-8's precedents; all 500 suite tests pass
  unchanged, confirming latent traps rather than configuration); 4 ×
  `createFullscreenViewport(camera, { clearColor })` in `tests/browser/fixtures` (the
  second parameter is the view _id_, so four pages asked for an opaque clear and got a
  view that never cleared — fixed as a spread plus the field, validated by re-running
  those specs; `text.spec.ts`'s visual golden was regenerated deliberately, its whole
  diff being the background that now actually clears); one `Sprite({ size })` → explicit
  `width`/`height`; one joint-seam narrowing through `supportsSolverJointAccess` (which
  _strengthens_ the test); two `ReplaySnapshot` → `PhysicsSnapshot` conversions through a
  documented helper whose narrowing is not trusted (§34's own field-by-field refusal is),
  correcting a header that falsely claimed both directions compiled.

### 2026-08-21 — examples modernized onto Text, lookAt, and the ScreenCamera recipe

#### Changed

- **Examples modernized onto the APIs that landed after they were written.** Four
  follow-ups from `TODO.md` discharged in one packet:
  - **Text (R-28).** `first-2d-scene`, `ui-demo` and both flagships drew labels by
    cutting one `Texture` per distinct glyph cell out of the atlas and issuing one
    `Sprite` per drawn glyph — the §55 workaround `first-2d-scene` documented and every
    later example inherited. All four now use `Text`: one node, one geometry, one draw
    per label, over one shared atlas texture sampled with §77's `"nearest"` filter.
    Measured draw-call drops: first-2d 30 → 1, ui-demo 44 → 3,
    `one-scene-everything-moves` 78 → 7 text draws, and `motor-digital-twin`
    **159 → 59 total draw calls** (its own `data-drawcalls`, §84), with triangles
    unchanged at 2014. The twin's §79 catalog carries one glyph material instead of
    ninety-odd and still round-trips byte-identically.
  - **`Node.lookAt` (R-36).** `first-3d-scene` no longer composes its camera pitch or
    its sun's yaw∘pitch out of `setFromAxisAngle` quaternions. The camera aims at a
    scene point (deriving −0.17021 rad against the hand-written −0.17); the sun is
    placed 10 units up-and-left and aimed at the origin, so the travel direction the
    header used to assert in prose is now read off the code.
  - **The screen-camera recipe (R-37/R-38).** Both flagships drew their UI by parenting
    it to the `PerspectiveCamera` node at a fixed local depth, because §47's
    `ScreenCamera` and §46's layer registry did not exist. Both now use the standard
    arrangement — a `"ui"` layer, a second full-surface viewport with a `ScreenCamera`,
    `layerMask` per view — and the workaround notes are deleted.
    `one-scene-everything-moves`'s panel is re-authored in pixels and its
    control-position publisher collapsed from twenty lines to two; `motor-digital-twin`
    keeps its instrument units under one scale on a screen-space root, which makes that
    move pixel-exact.
  - **Doc fixes.** `@fourjs/motion`'s rig table now points at `@fourjs/scene`'s
    `TrackballRig`; `docs/AUDIT-120.md`'s "ScreenCamera is absent" bullet and
    `packages/text/README.md`'s one-texture-per-glyph advisory are corrected, with a
    new `check-docs` retired-claim pin so neither can return undated.
  - **Goldens.** `tests/visual/ui-demo.spec.ts`'s two goldens were regenerated
    deliberately: the diff is confined to glyph pixels and the text is crisper
    (nearest-filtered atlas sampling replaces linear-magnified per-cell textures).
    `text-label-nearest-visual-linux.png` is byte-unchanged. Bundles: first-2d
    45.32 → 45.17, ui-demo 38.98 → 38.82, twin 945.41 → 945.26 kB gzip; first-3d
    +10 B; flagship unchanged. The one budget change is pre-existing:
    `particles-demo` was +109 B over at HEAD (same built-file hash before and after
    this packet), bumped 31 → 31.5 kB with the measurement.

### 2026-08-21 — §76 content hashing, §79 asset manifest, §77 texture loader tier (A-18, A-19)

#### Added

- **`@fourjs/assets`: content hashing (§76) and verification (§79, §96).**
  `load(url, loader, { hashContent: true })` records a hash readable through
  `AssetManager.contentHash(url, loader)`; `{ expectedHash }` verifies the bytes and
  **refuses** a mismatch (`ASSET_LOAD_FAILED`, `context.reason === "hash-mismatch"`,
  carrying `expectedHash`/`observedHash`), handing the caller's reference back exactly as
  an abort does. SHA-256 over `globalThis.crypto.subtle` by default — the algorithm
  argument is in `src/content-hash.ts`: a non-cryptographic hash is collidable by
  construction, so a manifest verified with one would announce integrity without providing
  it. Overridable via `AssetManagerOptions.digest`; `canHashContent` reports whether the
  runtime has one (an insecure browser context does not), and a hash that cannot be
  computed **refuses** rather than passing. The hash covers the response's _bytes_
  whatever the loader reads, so the same URL hashes identically under `binaryLoader` and
  `jsonLoader`; hashing wraps inside the §96 size bound, so an over-budget body is refused
  before any digest is taken. Verification is per caller, not per load: one waiter's wrong
  expectation does not disturb the others.
- **`@fourjs/assets`: the §79 manifest.** `manifestLoader` / `parseAssetManifest` (a
  manifest is untrusted content too — shape-validated, with the offending key in
  `context`), `loadFromManifest(assets, manifest, key, loader)` resolving logical
  key → URL → verified bytes, `ManifestLoadOptions.requireHash` for the production
  posture, and `manifestUrl` for the matching `release`. This is the substrate `A-16`'s
  §79 manifest was blocked on.
- **`@fourjs/assets`: the texture loader tier (§77's assets half, A-19).**
  `createTextureLoader({ decode })` — the decoder injected, as `createImageLoader`'s is,
  so the package still names no `Blob`, `ImageBitmap`, or canvas — producing a
  `Disposable` `TextureAsset` shaped **structurally** as `@fourjs/render`'s `TextureSource`
  (no dependency edge; the `PARTICLE_INSTANCE_FLOATS` precedent), carrying §60a/§77
  `colorSpace`/`filter`/`wrap` and flipping the codec's top-first rows so row 0 is
  `v = 0` (§7a).
- **§96 decompression limits, first instalment.** `createTextureLoader` bounds decoded
  output (`maximumDecodedBytes`, default 64 MiB = 4096²·4) **and** expansion ratio
  (`maximumExpansionRatio`, default 1000×) — the latter is the bound that catches a bomb
  the absolute one misses. Checked pre-decode when an optional `probe` reads the header,
  post-decode otherwise; the residue (a platform `createImageBitmap` cannot be pre-bounded
  at all) is stated in source rather than implied away.
- New suites: `packages/assets/tests/{content-hash,manifest,texture}.test.ts` (assets
  stays at 100 % on all four counters) and `tests/integration/texture-manifest.test.ts`,
  which proves the `TextureSource` contract against the real `Texture` and runs §79's
  manifest → verified bytes → `SceneResourceCatalog` wiring end to end.

### 2026-08-21 — R-37 closed: §47's `ScreenCamera` and the trackball rig

#### Added

- **§47 `ScreenCamera` (`R-37`)** — the pixel-rectangle camera, in `@fourjs/scene` beside the
  others. All three origins §47 requires (`"top-left"`, `"bottom-left"`, `"centered"`) in
  either unit system (`"logical"`, `"physical"`), so UI content is authored in the units a
  designer hands over and does not move when the world camera does. It extends `Camera`
  rather than `OrthographicCamera` on purpose: the box is _derived_ from the surface, and
  subclassing would leave `left`/`right`/`bottom`/`top` writable and lying, since the next
  resize overwrites them. §7a's default is honoured — `"top-left"` in logical pixels — and
  that origin is the only one that flips Y, as one sign inside the projection matrix and
  nowhere else in the engine; `"bottom-left"` and `"centered"` are Y-up because they are
  the origins a caller picks _for_ the world convention. Near/far default to `-1000`/`1000`
  so that a camera nobody moved can see the `z = 0` plane its content is authored on. A
  zero, negative or non-finite size is refused with `FourError("INVALID_APPLICATION_STATE")`
  rather than clamped (§85): unlike an authored orthographic box, this rectangle is a
  _measurement_, and a `NaN` from a `ResizeObserver` must not silently place every UI node
  off screen. §79 pair: `scene:screen-camera`, origin and units written always, a corrupted
  rectangle restoring the default rather than failing the scene.
- **`Application.resize` feeds it (§45)** — every full-surface viewport whose camera accepts
  a surface size is handed `(width, height, resolution)` and rebuilt, beside the existing
  `PerspectiveCamera` aspect update, under A-7's argument: only the application knows which
  rectangle a camera was authored for. The test is **structural** — a new exported type
  `SurfaceSizedCamera`, matched by `typeof camera.setSurfaceSize === "function"` — so §47's
  fifth camera type (the custom projection camera) opts in the same way, and no bundle pays
  for `ScreenCamera` unless it uses one. The view loop was considered and rejected: a
  projection should change when a _size_ changes, not when a frame is drawn, and a headless
  application never runs a view loop.
- **§44/§47 `TrackballRig` (`R-37`)** — the last staged camera rig, landing where `R-36`
  said it would: with `ScreenCamera`, because it is defined over a viewport. The classic
  virtual sphere (Shoemake's arcball with Bell's sheet, the two meeting tangentially at
  `d = 1/√2`), world-space composition so a second drag turns about screen axes, no pole and
  no up vector. Deliberately **not** a component: it is event-driven rather than per-step,
  and `ConstraintSystem` lives in `@fourjs/motion`, which may not import this package — so
  `applyTo(node)` is the application's write, under §42's `"manual"` authority, and a node
  owned by another authority is refused and warned about once. Parameter-driven like every
  other rig: four numbers in viewport pixels, no `@fourjs/input` edge. §33 tier
  `same-runtime`.

#### Proved

- `tests/browser/screen-camera.spec.ts` (new, 65th browser test): on ANGLE/SwiftShader, one
  100 × 40 panel authored at pixel `(20, 30)` lights **exactly** 4000 pixels, and the same
  authored numbers land in three different corners under the three origins — the pixel-exact
  placement claim the feature exists to earn, at zero tolerance. Existing goldens unmoved.
- `tests/integration/screen-camera.test.ts`: the standard recipe (one scene, two
  full-surface views with disjoint §46 layers, a world camera and a `ScreenCamera`) draws
  each item exactly once; a scene with no screen camera emits its frame unchanged.

### 2026-08-21 — R-21 and R-34 closed: §53's geometry model complete, §27 field sampling batched

#### Added

- **§53 geometry model completed (`R-21`).** `@fourjs/geometry` now exports the abstract
  `Geometry` base §53 declares — `id`, `version`, `bounds`, `computeBounds()`, `clone()`,
  `dispose()` — with `BufferGeometry` re-parented onto it and the monotonic geometry-id
  counter hoisted into the base, so every §53 family member and every clone draws from one
  §33-safe sequence.
- **`BoundingVolume` (§53).** A geometry's local extent as both the axis-aligned box and
  the sphere circumscribing it (`min`, `max`, `center`, `radius`). `GeometryBounds`
  becomes an alias of it, so the widening is additive: every existing reader of
  `.min`/`.max` — `computeWorldBoundingSphere` (`R-8`), `batch.ts`, `input/pick.ts`, the
  WebGL renderer — sees byte-identical values and is unmodified. An empty geometry keeps
  the union-identity box and reports `NaN` centre and radius, written explicitly so a
  culler can never read an empty bound as "everywhere".
- **`BufferGeometry.clone()` (§53).** Deep in every typed array, new `id`, version `0`;
  refuses a disposed source (§83). Deep and not shallow because attributes are held by
  reference and edited in place under `markDirty()` — one buffer behind two version
  counters is a cache-coherence bug, not a cheaper clone.
- **§27 batched field sampling (`R-34`).** `ParticleForceField` gains an optional
  `sampleAll(positions, velocities, count, time, out)` that adds a whole lane's
  contribution into a binary64 accumulator; all seven built-in fields implement it, and
  `ParticleEmitter` engages it only when a configured field offers it, falling back to
  `sample` per field for those that do not. Bit-identical to the scalar path by
  construction and by test — same summation association, explicit zero adds on degenerate
  inputs, and the accumulator takes the same swap the pool's `kill()` takes. Re-recorded
  on the canonical host: the 3-field 100 000-particle step falls from 16.58 ms to
  **4.51 ms** median, per-field marginal from ~5.15 ms to **1.12 ms** — the headline §112
  stack moves from ~99.5% of the fixed-step budget to ~27%.

#### Changed

- `benchmarks/results/particles-100k.json` re-recorded with the batched path engaged;
  `R-33`'s §112 rendered-exit measurement now has headroom instead of a pre-failed budget.

### 2026-08-21 — R-7 closed: §67 stencil substrate

#### Added

- **§67 stencil support (`R-7`)** — §57's seventh material member ships, with the buffer it
  drives. `StencilState` (`@fourjs/materials`) carries §67's eight comparisons, eight
  operations, reference and read/write masks, every value refused rather than clamped
  outside 0…255 (§85 — every stencil buffer WebGL 2 can allocate is 8 bits deep, and GL
  would mask a larger value down silently) and validated on assignment as well as at
  construction (F14). `Material.stencil` is a plain property holding one: the class is
  nominal, so the validating constructor is the only way in, and `material.ts` can import
  it type-only — a bundle whose scenes never mask does not carry the class.
  `RendererOptions.stencil` and `RenderTargetOptions.stencil` allocate the buffer (packed
  `DEPTH24_STENCIL8` on `DEPTH_STENCIL_ATTACHMENT` off screen);
  `{ stencil: true, depthTexture: true }` is refused, because a framebuffer has one depth
  attachment and R-18's samplable form is a texture. The WebGL 2 backend applies the state
  per draw against a CPU mirror seeded at GL's initial values, so a scene naming no
  stencil emits the GL sequence recorded before this existed, call for call
  (`FRAME_BEFORE_R7`, recorded on the reverted build; every pixel golden unmoved). Proven
  on a real driver in `tests/browser/stencil.spec.ts`: a mask pass clips the draw after it
  to exactly one sixth of its area, in the right place, in the same two draw calls. §67's
  _clipping API_ — nesting, bit-plane assignment, the backend-limit diagnostic — stays
  staged; this is the substrate it will be expressed in. +0.85 kB gzip in every bundle
  carrying `WebglRenderer`; budgets bumped 34 / 31 / 39.5 kB with the A/B measurements.

### 2026-08-21 — PH-21 and PH-20 closed: §39 step 9 becomes an occupiable priority, and §33 gets its rollback API

#### Added

- **§39 step 9 as a registered system (PH-21).** `PhysicsEventSystem` in `@fourjs/physics`,
  registered at `PRIORITY_EVENT_DISPATCH` (900), dispatches the queued physics events of a
  `PhysicsSystem`'s tracked worlds — the pass `PhysicsSystem` performed internally at step
  6's priority. Opt in with the new `PhysicsSystemOptions.dispatchEvents: false`; the
  default stays `true`, so no existing application and no committed golden changes. With
  dispatch at 900, a system at `PRIORITY_CONSTRAINTS` (700) or `PRIORITY_SENSOR_UPDATE`
  (800) runs _before_ application listeners, which is the ordering §39 asks for and the
  reason the split exists. `PhysicsSystem.dispatchesEvents` reports the choice;
  `PhysicsSystem.claimEventDispatch()` silences the "nobody is draining the queue" warning
  for an application that dispatches by hand. Constructing a `PhysicsEventSystem` over a
  source that still dispatches its own events is refused (§85) rather than silently
  draining an empty queue. `PhysicsWorld.step` and `PhysicsWorld.dispatchEvents` were not
  edited, so every §33 golden is unmoved by construction — PH-8's step-5 technique, reused
  for step 9.
- **§33 rollback (PH-20).** `RollbackBuffer` in `@fourjs/diagnostics`: a bounded, ordered ring
  of snapshots over the new `RollbackTarget` shape (`createSnapshot`/`restoreSnapshot`;
  `PhysicsWorld` satisfies it). `capture(step)` snapshots the end of a fixed step and evicts
  the oldest once full; `rollbackTo(step)` restores that exact step, forgets everything
  after it, and returns **how many fixed steps the caller must re-simulate**. It
  deliberately does not re-simulate: the only thing it could step is the target, which would
  skip every other §39 occupant, so the caller re-runs its own registry loop. An unheld or
  evicted step throws and names the window still held, rather than restoring the nearest
  older snapshot and silently rewinding further than asked. Rollback was the last of §33's
  six facilities without an API.
- **Two determinism gates.** `tests/determinism/event-dispatch-split.test.ts` +
  `golden/event-dispatch-split.json` (three-form; 180 fixed steps, eight stacked boxes plus
  a second tracked world, all seven §29 event kinds listened to) records that the combined
  and split arms are equal step for step and event for event — one digest set covers both
  arms, because equality is the claim — and that the one recorded difference is _when_ the
  listeners ran: a step-7 marker's count is `n − 1` at dispatch-600 and `n` at dispatch-900,
  on all 149 event-bearing steps. `tests/determinism/rollback.test.ts` rewinds a live
  Rapier2d run from step 120 to step 100 and re-simulates through the same registry,
  reproducing the reference run's 200 per-step checksums with zero divergence.

#### Documented

- **§39 steps 7 and 8 are not splittable, and it is a solver fact, not an omission.** A
  solver's constraint solve and its sensor/intersection update happen inside one
  `adapter.step()` call, so no engine system can be interposed between them without asking
  every adapter to expose a half-stepped world. `PRIORITY_CONSTRAINTS` and
  `PRIORITY_SENSOR_UPDATE` legitimately hold _engine-side_ work at those points — 700 is
  `ConstraintSystem`'s since 2026-08-09, and 800 is where an application's own sensor
  bookkeeping belongs. Recorded in `physics-event-system.ts`'s module header, which is the
  §90/§102 material PH-21's filing asked for. No adapter capability changed, so
  `docs/COMPATIBILITY.md` was not regenerated.

### 2026-08-13 — R-28 closed, R-30 advanced: the §49/§56 `Text` node and §77 sampler state

#### Added

- **§77 texture sampler state (R-30, sampler-state tier).** `TextureSource.filter`
  (`"nearest" | "linear"`) and `TextureSource.wrap`
  (`"clamp-to-edge" | "repeat" | "mirrored-repeat"`), resolved on `Texture.filter` /
  `Texture.wrap`, mirrored as optional `MaterialTexture.filter` / `.wrap`, and applied by
  `@fourjs/render-webgl`'s `TextureCache` at upload time. Both default to the pair this tier
  hard-coded before 2026-08-13, so every already-authored texture issues the identical four
  `texParameteri` calls with the identical enums — byte-identity is structural, not
  numerical. One field rather than `minFilter`/`magFilter` because the other four GL filter
  values name a choice between mip levels and this tier generates none; one field for both
  wrap axes because nothing authors anisotropic addressing yet. §85 refuses an unknown value
  and never substitutes. §77's mipmaps, anisotropy, cube/array/3D targets, compressed
  containers, video and `ImageBitmap` sources remain deferred and named.
- **§49/§56 `Text` node (R-28).** `new Text(atlas, material, { text, size, letterSpacing,
align })` — a `Renderable<UnlitMaterial>` in the umbrella package `four` that turns a
  string into **one** indexed vertex buffer of glyph quads with per-vertex uv over **one**
  atlas material. One draw call per label unconditionally; consecutive labels sharing a
  material merge into one draw under §65 batching, which closes §65's glyph-batching
  strategy at the label level with nothing added to `batch.ts`. It costs the frame path
  nothing: no `RenderItemKind` arm, no new pipeline, no shader edit. Geometry is derived,
  owned, rebuilt lazily behind a stable id, and resizes through R-23's empty-index pivot.
  §79 pair `render:text` (`registerTextSerializers`, chained by `registerSceneNodeTypes`),
  with the font supplied through the `atlas` option `Label` already used and a **loud
  refusal** when it is absent. `castShadow` defaults `false` on this class alone — a
  depth-only pass writes geometry, not alpha, so a label would cast its rectangles.
- **§56 horizontal alignment.** `layoutText`'s new `align: "left" | "center" | "right"`
  (`TextAlign`), applied per line within the widest line's extent. `"left"` — the default —
  never enters the shift loop, so an unaligned layout is bit-identical to the previous one.
  `layoutText`'s §33 tier is now stated as **cross-platform**: every operation is one of
  IEEE-754's exactly-rounded five, with no transcendental and no hash-order iteration.
- **Gates.** `tests/integration/text-rendering.test.ts` (a label is one draw and emits the
  transcript of a plain textured `Renderable`), `tests/browser/text.spec.ts` +
  `fixtures/text-page.ts` (glyphs on a real WebGL 2 driver; `NEAREST` and `LINEAR` differ),
  and `tests/visual/text.spec.ts` with a new golden — the one text assertion that is a pixel
  match, because a v-flip or an off-by-one-cell uv keeps ink count, row structure and draw
  count intact.

#### Changed

- `benchmarks/text-layout.mjs` measures **both** CPU halves of §86's animated-glyph row: the
  layout (~2.1 ms at 20 000 glyphs) and the `Text` geometry rebuild (~14 ms, ~700 ns/glyph,
  800 draw calls — 1 batched — against 20 000 before R-28). `benchmarks/README.md`'s
  `feature` block on the row's drawing half is amended in place.
- Doc-truth: `@fourjs/text`'s "a `Text` node … is not this package's to write" and
  `@fourjs/render`'s `Renderable` family note now name where `Text` landed and why the frozen
  §3.1 matrix put it there.

### 2026-08-09 — R-36 rig half + PH-11 closed: §44/§47 camera rigs, §42's first constraint producer

#### Added

- **§44/§47 camera rigs and §12 look-at constraints (`R-36` rig half + `PH-11`).**
  `@fourjs/motion` gains `OrbitRig` (§44 orbit control), `FollowRig` (§44 follow target
  and spring arm — one class, switched by `frame: "world" | "target"`, smoothed by an
  optional `SpringDamper`, with `resetSmoothing()` so a teleported target does not send
  the camera sailing), `LookAtConstraint` (§12) and `ConstraintSystem`, the first
  producing system §42's `"constraint"` transform authority has ever had, at §39 step 7
  (`PRIORITY_CONSTRAINTS`). A rig **places** and a constraint **aims**, both in one
  system under one authority, because §42 allows a node exactly one owner. The aim is
  `Node.lookAt` on a clock, with an optional `maxAngularSpeed` slew limit in
  `MotionComponent`'s spelling (radians per second, absent means unlimited). Rigs never
  read `@fourjs/input` — the frozen §3.1 matrix has no `motion → input` edge, so
  `orbit(yawDelta, pitchDelta)` and `dolly(delta)` take deltas the application feeds,
  which is also what makes a rig replayable (§33/§34). §85 refusals on authored values
  (non-finite angles, non-positive distances, a zero or non-finite `up`, inconsistent
  limits); a mid-simulation degeneracy is a **counted skip** on `skippedSteps` rather
  than a throw inside a fixed step. All three components ship with their §79 serializers,
  registered in `registerSceneNodeTypes`. New determinism golden
  `tests/determinism/golden/camera-rigs.json` (§33 tier `same-runtime`; three rigged
  cameras, 300 fixed steps, two in-process runs and one fresh process agreeing
  byte-for-byte). Measured: **0 B** in five of six size-limited bundles, **+2.8 kB
  gzip** in `motor-digital-twin`, the one bundle that calls `registerSceneNodeTypes()`.
  §44's _path animation_ and _physics attachment_ need no rig class and are documented
  compositions; fly, first-person, trackball, shake/impulse and the stereo/XR point stay
  staged with named owners.

### 2026-08-09 — Dependabot high closed: nanoid override

#### Fixed

- **GHSA-2v37-7h3g-55p8 (high): `nanoid` < 3.3.17** — reached only through the dev
  toolchain (`vite → postcss → nanoid`), never shipped in any package. A pnpm override
  (`"nanoid@<3.3.17": ">=3.3.17"`) forces the patched line; `pnpm audit` reports no known
  vulnerabilities.

### 2026-08-09 — R-8 closed: §64 per-view render lists, §87 frustum culling, §66 key 4

#### Added

- **§64 per-view render lists and §87 frustum culling (gap `R-8`).** The frame builds
  **one** render list and each viewport now _derives_ its own from it:
  `buildViewRenderList(source, view, out, { frustum })` in `@fourjs/render` applies §46's
  layer mask (§48's `view.layerMask`-else-`camera.layers` fallback) and §87's frustum
  test, keeping the surviving items in order and sharing the frame list's pooled item
  objects, so a view costs one linear scan and no allocation. The substrate is
  `@fourjs/math`'s new **`Frustum`** — the six normalized clip planes of a view-projection
  matrix, extracted for either `DepthRange` convention, with a conservative
  `intersectsSphere` — and `@fourjs/render`'s **`computeWorldBoundingSphere`**, which turns
  §53's cached local box into a world-space sphere by the absolute-value transform (never
  too small, so a cull can never remove something visible). §49's **`frustumCulled`**
  lands on `Renderable`, defaults to `true`, and round-trips through §79. The WebGL 2
  backend derives and culls per view; §69's shadow map is still built from the _frame's_
  list before the view loop, so a caster no camera can see still occludes.
- **§66 sort key 4 (gap `R-10`).** `sortRenderListByDepth(list, viewMatrix)` sorts a
  view's own list by depth — opaque near-to-far, transparent far-to-near — under keys 1
  and 2 and above key 5. A **verb, not a default**, for key 3's reason: under §61's
  `LEQUAL` a depth sort permutes co-planar opaque draws, and co-planar opaque draws are
  what a 2D scene is made of. It could not have been written before `R-8`: one list
  served every view, so a depth measured along one camera would have misordered the rest.
- `benchmarks/view-culling.mjs` + `benchmarks/results/view-culling.json` — not a §86 row;
  the measurement behind `R-8`'s design decision (derive per view against traverse per
  view, at 10 000–100 000 nodes × 1–4 viewports) and the CPU price of the cull itself.
- `tests/browser/culling.spec.ts` (+ `fixtures/culling-page.ts`) — the pixel half: the
  same scene drawn with §49's flag on and off, compared **exactly**. Measured on
  ANGLE/SwiftShader: **0 of 76 800 pixels differ**, 19 draws → 10.

#### Changed

- `@fourjs/render-webgl`'s view loop no longer tests `item.layers` inline; it draws the list
  `buildViewRenderList` derived. Consequence, stated because it is observable: a batch run
  may now span an item the _frame_ list had between its members — a masked-out or culled
  draw no longer ends a run. This is strictly better batching and exactly as correct, since
  the skipped item is not submitted into that view at all. `RenderBatching.next`'s
  `layerMask` becomes optional and the renderer no longer passes one.
- `RenderItem` carries two new snapshots, `frustumCulled` and `viewDepth`. Hand-built item
  literals need both (a `tsc`-only break — Vitest does not typecheck).
- **Bundle:** +0.77 kB gzip in every bundle carrying `WebglRenderer` (§64 lists culling as
  a _stage_, not an option, so the culler is referenced unconditionally). Budgets bumped
  with the same-tree A/B measurements: first-3d-scene 31.5 → 32.5 kB, particles-demo
  29 → 30 kB, ui-demo 37 → 38 kB. `sortRenderListByDepth` tree-shakes out of bundles that
  do not call it.

#### Fixed

- Three integration harnesses were rendering nothing and asserting draw counts for it.
  `new OrthographicCamera({ height: 4, aspect: 1 })` names two fields
  `OrthographicCameraOptions` does not have, so the object was accepted and every property
  ignored, leaving the default unit box `[-1, 1]²`; `render-batching.test.ts`'s camera sat
  at the origin with content at `z = 0`, in front of its own near plane. Culling made all
  three visible by removing the draws. `frame-statistics.test.ts`,
  `renderer-context-loss.test.ts` and `render-batching.test.ts` now use cameras that can
  see their scenes.

### 2026-08-09 — PH-8 and PH-12 closed: §26/§27 force fields for bodies, §8 space modes

#### Added

- **§26/§27 force fields for rigid bodies (`PH-8`).** `@fourjs/physics` gains `ForceField` — §27's
  interface, transcribed — and `ForceFieldSystem`, the engine occupant of §39's step 5 ("force
  generation") at `PRIORITY_FORCES`. It samples every registered field at every dynamic, awake
  body once per fixed step and applies the sum through §26's `applyForce`. Units are declared per
  field and the argument is **required**: `"force"` (newtons, as authored) or `"acceleration"`
  (m/s², multiplied by the body's mass), because §27's own built-in list mixes the two.
  `PhysicsWorld.forEachActiveBody(visit)` is the §22/§32-filtered, registration-ordered (§33)
  iteration it walks, handing over each body's solver-read world-space centre of mass (§25).
  `ParticleForceField` from `@fourjs/particles` is structurally identical, so every built-in field
  there works here with no adapter, no cast and **no new §3.1 dependency edge**;
  `tests/integration/physics-force-fields.test.ts` is where the two declarations are type-checked
  against each other. `world.step` was not edited — fields reach the solver through the same §26
  command buffer user code uses — so every existing determinism golden is untouched by
  construction. New golden `tests/determinism/golden/force-fields.json` (same-runtime tier, real
  Rapier 2D, 300 steps, twelve bodies, four fields).
- **§8 space modes (`PH-12`).** `@fourjs/core` gains the §8 vocabulary — `SpaceMode`,
  `SPACE_MODES`, `DEFAULT_SPACE_MODE`, `isSimulationSpaceMode` — and `@fourjs/physics` gains
  `RigidBody.space` (also `RigidBodyDescriptor.space`), the frame a body is solved in.
  `PhysicsWorld.addBody` now enforces §8's sentence: the four presentation frames are refused
  because "screen-space UI should not automatically participate in physical simulation unless
  explicitly mapped to a simulation plane", and `"local-plane"` is refused separately because
  §21's plane→XY mapping is unbuilt — two messages, because the fixes differ. The default is
  `"world"` and `toDescriptor()` omits it there, so no existing body, descriptor, document or
  solver call changes. The space round-trips through §79 (written only when non-default, read as
  a defaulted field), because dropping it would turn a body every world refuses into one every
  world accepts after a reload.

### 2026-08-09 — R-10 keys 3–4 and R-9 closed at tier: §66 pipeline grouping and §65 batching

#### Added

- **`groupRenderListByPipeline(list)` (`@fourjs/render`)** — §66's **sort key 3**, pipeline
  and material compatibility, as a **second verb** rather than a mode of `buildRenderList`.
  It re-sorts an already-built list with key 3 inserted between keys 2 and 5, stably, so a
  scene already grouped is unchanged and a scene of one pipeline and one material is left
  exactly as it was. `buildRenderList` is untouched, so every existing scene keeps the order
  it has had since 2026-08-06 — byte for byte. The reason key 3 is offered and never imposed
  is recorded in source and is a **correctness** argument, not a byte-identity one: §61 fixes
  the depth comparison at `LEQUAL`, so of two opaque surfaces at one depth the later draw
  wins, and all of this engine's 2D content sits at one depth. Grouping by material would
  therefore _repaint_ a 2D scene — it is what makes a §58 stroke cover its own fill (R-16)
  and a later sibling cover an earlier one.
- **`RenderItem.materialId` (`@fourjs/render`)** — the material half of key 3, snapshotted at
  generation time; `kind` was already the pipeline half. Two fields rather than one
  concatenated key, because `${kind}:${id}` would allocate a string per item per frame.
  `""` for a particle system, which has no material, and for a structural material double
  predating §57's `id` — `undefined < undefined` is false in both directions, which is not a
  total order.
- **§65 batching (`RenderBatcher` in `@fourjs/render`, `createGlBatching()` in
  `@fourjs/render-webgl`)** — **sprite batching and compatible shape batching**: consecutive
  render items sharing a pipeline **and a material instance** merge into one `drawElements`.
  The planner concatenates a run into one interleaved vertex stream (position, then uv iff
  the material samples, then colour iff it declares `vertexColors`) plus one 32-bit index
  stream, baking each item's world transform into its vertices; the backend owns two buffers
  and one vertex array per layout and issues the single draw. A batch draws through the
  **existing unlit program** — no sixth pipeline is compiled and no shader was edited: a
  sprite batch uploads its tint as `color` and carries uv per vertex, and `tint × texel`
  versus `texel × tint` is bit-identical arithmetic.
- **`WebglRenderer.batching`** — the opt-in field, `null` by default (the
  `WebglRenderer.statistics` precedent). With none assigned the backend issues exactly the
  GL sequence it always did: the field is read once per frame and costs one `null`
  comparison per item. Opt-in because nothing reachable from a class method tree-shakes, and
  three of the six size budgets sit within 1 kB of their limit; the type is imported
  `import type`, so a bundle that never calls `createGlBatching` links neither module and
  pays **0 B** (measured both ways).
- **`benchmarks/render-batching.mjs`** and its record — §86's _batched sprites (100 000)_ and
  _simple batched shapes (50 000)_ rows, preparation half. Both rows leave the **feature**
  column of `benchmarks/README.md` for **half**.
- **`tests/browser/batching.spec.ts`** — the pixel half, against ANGLE/SwiftShader: the same
  scene rendered batched and unbatched into one canvas, read back in the same task.
  **0 of 76 800 pixels differ**, 13 draw calls become 3. The spec bundles its own fixture
  with Vite's JS API rather than adding a tenth example site and a tenth preview server.
- **`tests/integration/render-batching.test.ts`** — the three claims that live only in the
  composition: identical GL transcripts with and without a batcher over a scene that has
  nothing to batch, the merged stream equal to the world-space geometry of the draws it
  replaced, and §66 key 3 turning an interleaved scene from four unbatchable draws into two
  batches (the recorded `R-10 → R-9` dependency, demonstrated).

#### Changed

- **§66 key 4 (depth) is deferred on `R-8`, not on "needs a camera".** The note in
  `render-list.ts` now says why the old reason was too weak: this backend builds one list per
  frame and draws it into every view, so a depth key measured along one camera would order
  the others by the wrong number. A key 4 written today would be _wrong_, not merely
  disruptive.
- **`benchmarks/README.md`** — eight scripts; the batched-sprite and batched-shape rows are
  rewritten from "there is no sprite batching" / "there is no shape system to batch" to
  **half** rows, and the summary sentence moves from "five measured … three feature-blocked"
  to "seven measured or partly measured … one feature-blocked (mesh instancing)".

#### Measured

- **The batcher costs the bundles that do not use it +0.17 kB gzip**, all of it the seam (the
  field, the branch in the draw loop, `materialId`) — the batcher itself tree-shakes away.
  first-2d 42.88 → 43.05, first-3d 31.11 → 31.30, particles 28.55 → 28.70, ui-demo
  36.56 → 36.73, motor-twin 937.81 → 937.99 kB; every budget still met, none moved.
- **100 000 atlas sprites become 7 draw calls and 50 000 rectangles become 4** — one per
  65 536 vertices, which is the only thing that splits a run of one material. On the recorded
  (GPU-less, shared) host their _preparation_ costs 78.4 ms and 38.7 ms per frame, so both
  §86 rows remain unmet as whole rows and are now bounded by CPU preparation rather than by
  draw calls; about half of that is `buildRenderList`, which the unbatched frame pays too.

### 2026-08-09 — R-36 closed (helper tier): §44/§47's `lookAt` and orientation helpers

#### Added

- **`Node.lookAt(target, up?)` (`@fourjs/scene`)** — the §44/§47 helper the tree had nowhere
  at all: aiming a camera or a light meant hand-composing quaternions, which the
  `first-3d-scene` packet recorded as the roughest edge of writing a 3D scene. It turns the
  node so its **−Z axis** points at a **world-space** `target`, with +Y as near `up` as the
  aim allows (`up` defaults to world +Y, §7a). It lives on `Node` rather than on `Camera`
  because −Z is _every_ node's forward, not a camera's privilege — the same call aims a
  `DirectionalLight` or a `SpotLight` (§68). Under a parent the local rotation is derived as
  `conjugate(parentWorldRotation) · worldRotation`, so a node on a rotated, translated, or
  uniformly scaled rig aims correctly; a non-uniformly scaled parent inherits
  `Matrix4.decompose`'s documented closest-rotation limitation, and a zero-scaled one
  decomposes to the identity so the aim lands in world terms.
- **`Node.getWorldDirection(out)` (`@fourjs/scene`)** — the inverse: the world-space unit
  vector a node faces. **Hoisted** from `DirectionalLight` and `SpotLight`, which carried two
  byte-identical copies; both are deleted and both classes inherit it unchanged, so the
  `@fourjs/render` structural light contract is untouched and the bundle is one copy lighter.
- **`Quaternion.setFromLookDirection(direction, up)` (`@fourjs/math`)** — the primitive under
  both. Neither argument need be unit and `up` need not be perpendicular; the basis is
  `z = normalize(−direction)`, `x = normalize(up × z)`, `y = z × x`, converted with
  Shepperd's method. Allocation-free (the basis lives in plain scalars) and the change hook
  fires exactly once.
- **`packages/scene/tests/look-at.test.ts` (28 tests)** and
  **`tests/integration/look-at.test.ts` (8 tests)** — the integration suite pins the four
  claims no single package can: the aim survives the §7 → §47 chain (a lookAt'd camera
  projects its target to the centre of clip space), `@fourjs/render`'s `collectSceneLights`
  reads the same axis, the umbrella barrel exposes it, and it is a `"manual"` write a §42
  owner then drives without either side warning.

#### Changed

- **`Matrix4.decompose` and `Quaternion.setFromLookDirection` share one Shepperd
  implementation** (`setQuaternionFromBasis`, module-internal to `quaternion.ts`, not in the
  barrel). The arithmetic and branch order moved verbatim — every `tests/determinism/*`
  golden is unchanged, bit for bit — and `matrix4.ts` coverage rose 98.58% → 100% because the
  look-at tests reach the branch its own suite never did.

#### Decisions

- **Forward is −Z for every node.** Verified against `Matrix4.setPerspective`,
  `Camera.updateViewMatrix` (`inverse(worldMatrix)`), and §68's light axis rather than
  asserted; a test builds the classic gluLookAt view matrix independently and compares all
  sixteen elements, so `lookAt` produces exactly what `updateViewMatrix` inverts.
- **The target is world-space, always.** It is the only contract under which "point the
  camera at the player" is one call and under which the call keeps meaning the same thing
  when the node is reparented onto a moving rig — §44's follow-rig and spring-arm case.
- **Degenerate aims are refused, not repaired (§85).** `Node.lookAt` throws
  `FourError("INVALID_SCENE_GRAPH")` — the code `Node.add` already uses for §85's
  scene-graph rule — when the target coincides with the node's world position or when `up`
  is zero, non-finite, or parallel to the aim (the top-down aim with the default +Y is
  exactly this case, and wants an explicit `up` such as world −Z). Picking a fallback `up`
  would silently rewrite the orientation the caller asked for; leaving the node unturned
  would be indistinguishable from a frozen rig. The **math** primitive, by contrast,
  validates nothing and leaves its quaternion untouched on degenerate input without firing
  the hook — the layer split `Matrix4.setPerspective` already states.
- **`lookAt` neither checks nor warns about §42 authority.** It is an ordinary _manual_
  transform write, identical to `node.rotation.setFromAxisAngle(...)`, and §42's enforcement
  is writer-side by design. Warning would make it the only self-policing write in the engine
  and would fire on aiming a `"physics"`-owned body at its starting pose.
- **§33 tier: `same-runtime`.** Pure quaternion arithmetic from exact inputs — bit-identical
  across repeated calls and bit-idempotent on re-aim (both asserted with `toBe`) — but
  `sqrt` on the path keeps the claim at §33's initial tier.

#### Known / deferred

- **§44/§47's camera rigs are still unshipped** (orbit, fly, first-person, trackball, follow,
  spring arm, shake, path animation, physics attachment). `lookAt` is the primitive they will
  be built on, not a substitute — `R-36`'s rig half and all of `PH-11` remain open.
- **The examples still hand-roll their orientations.** `examples/first-3d-scene/main.ts`
  aims its camera and sun with `setFromAxisAngle`; replacing them derives the quaternion
  through `sqrt` where the current code uses `sin`/`cos`, which could move a pixel golden.
  Deferred to a packet that can run the browser gate.
- **Bundle cost**: +0.50 kB gzip in every bundle that carries `@fourjs/scene` (measured A/B:
  first-3d 30.80 → 31.30 against a 31.5 kB budget; ui-demo 36.23 → 36.73 against 37;
  particles 28.20 → 28.70 against 29). All budgets pass; the headroom left is 0.20–0.30 kB
  and a bump is proposed in `TODO.md`.

### 2026-08-09 — R-16 closed: §58 paints, fills and strokes; §50's family complete

#### Added

- **§58's paint model at its solid tier (`@fourjs/render`)** — `Paint`/`SolidPaint` (linear-light
  RGBA plus §50's separate `opacity`, which multiplies the alpha), `ShapeFill`
  (`"inherit"` | a paint | `"none"`, SVG's vocabulary because §50 asks for SVG compatibility),
  and `StrokeStyle`. `Paint` is a **closed one-member tagged union** so the six staged kinds are
  a compile error rather than an object silently ignored at rebuild time (R-6's `ScreenEffect`
  staging mechanism, second application). Reading `shape.fill` / `shape.stroke` gives a
  **resolved** record (`ResolvedPaint`, `ResolvedShapeFill`, `ResolvedStrokeStyle`) — every
  optional filled in, validated and copied, so an in-place edit of the object you passed cannot
  desynchronise the geometry from the style that built it.
- **§52 stroke expansion (`@fourjs/geometry`, `tessellation.ts`)** — `expandStroke` widens
  polylines into §58's band: `inside`/`center`/`outside` alignment, butt/round/square caps,
  miter/round/bevel joins with a miter limit that falls back to a bevel, and dashes with a phase
  offset walked by arc length. §52 puts stroke expansion in that module _by name_, beside the
  fill tessellator, and that is where it went. `Path.polylines(tolerance)` is the flattening it
  takes — `flatten()` plus the one bit a `Point2D[]` cannot carry.
- **§50's last three primitives** — `Line`, `Polyline` and the open `Arc`, whose absence `R-23`
  recorded as deliberate ("a stroke without a join rule is _wrong_ at every corner"). Their
  `stroke` is **required** and their `fill` defaults to `"none"`; the family now covers **all
  fourteen** §50 rows with twelve classes.
- **§79 pairs, additive in both directions** — `render:line`, `render:polyline`, `render:arc`,
  plus `fill`/`stroke` on every shape document. Both fields are written **only when they differ
  from the class's own default**, so a shape naming no paint writes the byte-identical document
  `R-23` wrote, and a pre-`R-16` document restores a fill-only shape with nothing missing.
- **`tests/determinism/stroke.test.ts` + `golden/stroke.json`** — §52's **second** golden,
  labelled `same-runtime` beside the fill tessellator's `cross-platform` one.

#### Decided, and the alternative is recorded

- **A fill and a stroke are two colours in one draw, carried as per-vertex colour.** The §57
  pipelines already multiply `vertexColors` into the material's colour (`R-19`), so a stroked,
  painted shape adds **no render-item kind, no backend pipeline and no frame-path edit** —
  `R-23`'s property, kept, and `render-webgl` was never opened. A material that cannot multiply
  vertex colours is refused (§85) naming `vertexColors: true`, because the alternative is a
  stroke that vanishes into the fill.
- **Gradients are staged, not approximated.** Per-vertex colour is exact for a solid and for a
  two-stop _linear_ gradient and for nothing else §58 lists: a three-stop linear gradient needs
  vertices on its stop lines, and radial and conic are not affine at all. The exact tier is a
  paint pipeline, measured at **~1.9 kB gzip in every bundle carrying `WebglRenderer`** whether
  or not the app draws one, plus a `RenderItemKind` arm `RFC 0001` and `RFC 0003` are both
  queued to own.
- **`ShapeMaterial` stays unshipped** — the answer is unchanged by §58's arrival rather than
  unexamined: the paints live on the _node_, where §50's own example puts them, and a stroke's
  width and joins are geometry rather than shading.
- **The stroke's triangles come last in the index buffer**, which is load-bearing: §61 fixes the
  depth comparison at `LEQUAL`, so equal depths let the later draw through and a stroke paints
  over its fill.

#### Measured

- **Byte-identical for every scene that names no paint** — a full GL transcript plus the
  `positions`/`uvs`/`colors`/`indices` of all nine `R-23` shapes, recorded on the reverted build
  and on this one: identical (md5 `c957ce62…`). Five of six example bundles are hash-identical;
  `motor-digital-twin` is **+3.62 kB gzip** (937.36/1000), paid only by the bundle that calls
  `registerSceneNodeTypes()`.
- **The overlap is documented, not removed.** Joins and caps are drawn on a corner's outer side
  only; the inner side is covered twice by the two quads. Invisible under an opaque paint,
  double-blended under a translucent one, and `alignment: "outside"` on a convex outline avoids
  it entirely. The exact answer is the same planar-subdivision pass §52's self-intersection row
  waits on.
- **A lone point strokes to nothing.** `Path.flatten` says explicitly it is not the operation
  that decides whether a stray `moveTo` is a dot; this is that operation deciding — a dot is a
  `Circle`, and inventing one would make every stray `moveTo` in an imported document sprout a
  blob.

### 2026-08-09 — A-18's abort half and A-9's `pointerType` closed

#### Added

- **§76 cancellation (A-18)** — `assets.load(url, loader, { signal })` takes any
  `AbortSignalLike` (the DOM's `AbortSignal` satisfies it structurally). Three rules, each
  with the test that would fail without it: (1) **an aborted load never holds a reference** —
  a signal that already fired is refused before the cache is consulted, one that fires later
  hands its reference back, so an aborted load must not be released, exactly like a failed
  one; (2) **one waiter's abort is not the others'** — aborting decrements, and the request is
  abandoned only when the last waiter goes, so a coalesced load still delivers to whoever
  stayed; (3) **`release` is not `abort`** — releasing the last reference to a pending load
  still lets it settle, because rejecting a promise the caller is still holding turns an
  orderly teardown into an unhandled rejection in application code. Cancellation rejects with
  `ASSET_LOAD_FAILED` and `context.reason === "aborted"` (§89 has no cancellation code, and a
  discriminating context says it without widening the engine's error vocabulary).
- **Transport-level abort (A-18)** — `AssetManagerOptions.abortController: () => new
AbortController()`, reported by `AssetManager.canAbortTransport`. **Presence is the
  capability**: without it the promise semantics are identical and the socket drains; with it
  the last waiter's abort cancels the request, and so does a load that outruns
  `timeoutSeconds` — the §96 deadline no longer leaves a request running.
- **`pointerType` on every pointer event (A-9 remainder)** — `PointerDeviceType`
  (`"mouse" | "pen" | "touch"`) on `ScenePointerEvent`, fed from
  `SurfacePointerEvent.pointerType` and carried onto synthesized events (`click`, enter,
  leave) too.

#### Fixed

- **A mouse no longer loses its hover when it clicks (A-9).** The A-9 teardown ended hover for
  every device, so a `@fourjs/ui` widget dropped its hover highlight the instant it was clicked
  and regained it on the next move. A release now forgets the pointer _unless_ the device
  outlives its own gesture and has a hover worth keeping — in practice a mouse over a node.
  `pointercancel` still ends every pointer (the platform said it is gone; second-guessing that
  with device knowledge would be a guess), pen is not treated as persistent, and a source that
  reports no device keeps its pre-2026-08-09 behaviour exactly.

#### Measured, and it decided the design

- **The generic `FetchLike<TSignal>` seam works** — `typeof fetch` is assignable to
  `FetchLike<AbortSignal>`, so `{ fetch, abortController }` still needs no adapter and
  `@fourjs/assets` still names no DOM type. The 2026-08-07 finding it replaces (a _concrete_
  `AbortSignalLike` parameter makes the platform `fetch` stop satisfying the seam) is kept in
  source.
- **`TSignal` must not reach the instance type.** With `#fetch: FetchLike<TSignal>`,
  `AssetManager<AbortSignal>` is **not** assignable to `AssetManager` — which would have
  broken `new Application({ assets })` for exactly the managers that gained the capability.
  The seam is therefore erased at the constructor; every instantiation stays mutually
  assignable, asserted in `tests/integration/asset-abort.test.ts`.
- **`SurfacePointerEvent.pointerType` is typed `string`, not the union.** `lib.dom` declares
  `PointerEvent.pointerType: string`, so narrowing the seam makes a real `PointerEvent` stop
  satisfying it. The narrowing happens once inside `@fourjs/input`, and a vendor value or `""`
  becomes an **absent** `pointerType` rather than a refusal: §85's refuse-don't-clamp governs
  configuration the application got wrong, not hardware telemetry arriving mid-gesture, where
  a throw would break input on a device newer than the union.

#### Unchanged, proven

- **No §83 regression from the retained mouse entry**: it exists only to hold a live hover, a
  mouse over nothing is forgotten like any other pointer, and a mouse's `pointerId` is stable —
  10 000 mouse clicks leave `trackedPointerCount` at 1, and A-9's original 10 000-gesture
  touch/cancel test is untouched at 0.
- Coverage stays 100/100/100/100 on both `@fourjs/assets` (77 tests) and `@fourjs/input` (133).
  Bundle: `@fourjs/assets` is in no example bundle; `@fourjs/input` +111 B gzip A/B-measured in
  isolation, `ui-demo` at 36.06/37 kB.

### 2026-08-09 — R-23 closed (solid-fill tier): §50 native 2D shape nodes

#### Added

- **§50's shape family (R-23)** — `Shape2D` plus nine concrete nodes in `@fourjs/render`,
  beside `Renderable` and `Sprite`: `Circle`, `Ellipse`, `Rectangle` (square-cornered or
  rounded — §50's own example passes `radius` to `Rectangle`, so §49's
  `RoundedRectangle` is that class), `RegularPolygon`, `Polygon`, `Star`, `Sector`,
  `Ring`, and `PathShape` (§50's "path" and "Bézier path" alike). **Eleven of §50's
  fourteen primitives ship**, filled in one solid colour, entirely on the R-24/R-25
  substrate: `toPath()` → `Path.fillRings` → `triangulatePolygon`.
- **`Shape2D.toPath()`** — the family's one polymorphic operation, a fresh §51 `Path`
  per call: the seam §50's SVG import/export (`R-26`), §51's booleans, and `A-11`'s
  analytic picking all need, and the reason a consumer of a shape never has to learn
  which shape it is holding.
- **§79 pairs for all nine** (`render:circle` … `render:path`), through a new
  `registerShapeSerializers` split out on the `registerPhysicsSerializers` precedent and
  composed into `registerSceneNodeTypes`. No geometry key — a shape derives and owns its
  fill (§83). A field the class defaults restores its default when corrupt; a parameter
  that _is_ the shape is refused loudly rather than invented. Paths replay through §51's
  builder, which is where the well-formedness invariant lives.

#### Deliberately not shipped, with arguments in source

- **No stroke, and therefore no `Line`, `Polyline`, or open `Arc` node.** §58's paint
  model is `R-16`; §52 puts stroke expansion in `@fourjs/geometry`'s tessellation module by
  name; and a stroke without a join rule is wrong at every corner, not merely plain. A
  node that draws nothing while claiming to draw something is worse than a missing one.
- **No `ShapeMaterial`.** Without §58's paints it is `UnlitMaterial` renamed, and it costs
  either a new `RenderItemKind` arm (a closed union RFC 0001 and RFC 0003 are both queued
  to widen) plus a compiled-at-init pipeline measured at 0.75–1.9 kB gzip in every bundle
  carrying `WebglRenderer`, or a discriminant that lies. Shapes carry a `SurfaceMaterial`
  and draw through the flat-colour pipeline that already existed.

#### Fixed / found

- **`rotation` is not available as a shape parameter** — §6's `Node` publishes it as the
  live alias of its transform quaternion (§15/§97), so an `Ellipse.rotation` shadows the
  node's orientation. `tsc` refuses it; vitest would not have. The family's name is
  `startAngle` throughout: where the outline begins, measured from +X.

#### Unchanged, proven

- **No backend edit, no render-item kind, no frame-path change.** A scene of shapes emits
  the _identical_ GL call sequence as a scene of plain `Renderable`s holding the same
  geometry, asserted call for call in `tests/integration/shape-rendering.test.ts`. Five of
  six example bundles are hash-identical; only `motor-digital-twin` (the one example that
  registers §79 node types) grows, +10.46 kB gzip to 933.34/1000 kB. Goldens unmoved;
  59/59 browser gate.

### 2026-08-09 — R-26 closed (path-data tier): §50 SVG import/export

#### Added

- **§50 SVG path data (R-26)** — `parseSvgPathData(d, options?)` reads an SVG `d`
  attribute into a §51 `Path`, `formatSvgPathData(path)` writes one back out, both in
  `@fourjs/geometry` (§98's placement: the `d` attribute is the serialized form of the
  path model, so it lives beside the model — `render-svg` is a backend, `@fourjs/assets`
  owns SVG as a file). **Grammar coverage is complete**: all ten commands in both cases,
  implicit argument-set repetition, the implicit lineto after a moveto, optional
  separators (`1-2` is two numbers), the greedy scan that reads `1.5.5` as two, and arc
  flags that abut what follows (`a1 1 0 011 1`). `B`/`b` (bearing, an SVG 2 draft removed
  before CR) is refused. **No `fromCommands`** was needed or added — export reads
  `Path.commands` and a cursor; the R-24 decision stands.
- **Coordinates are transcribed, not flipped** — SVG's Y-down user space is not
  reconciled with §7a's Y-up world by the parser, because the transform that would do it
  (`y ↦ height − y`) needs the document's `viewBox`, which is not in the `d` attribute. A
  bare flip would be _half_ a transform performed silently. The correction is one exact
  `Path.transform` at the caller (a reflection is a similarity, so arcs survive it), and
  the document tier will apply it because it is the tier that knows `height`.
- **A format conformance rule is not an §85 clamp** — SVG 1.1 F.6.6 defines what a
  conforming reader does with an out-of-range arc radius, so those rules are honoured
  (negative radii → abs, zero radius → line, coincident endpoints → omitted, radii too
  small → uniform `√Λ` scale-up) while malformed input is refused with a `SyntaxError`
  naming the offset. Unlike an SVG viewer, nothing parsed before an error is kept.
- **§96 hardening, checked rather than asserted** — no regular expressions anywhere (a
  single forward character-code scan: O(n) on _every_ input, so no catastrophic
  backtracking), one finite `maximumTextLength` bound (4 Mi code units, `FourError`
  `UNTRUSTED_INPUT_REJECTED` with `limitName`/`limit`/`observed`), and totality proved by
  30 000 fuzzed strings plus five ReDoS shapes.
- **Second two-tier §33 golden** (`tests/determinism/golden/svg-path.json`) — `text`
  claims cross-platform because ECMA-262 specifies decimal→double and `Number::toString`
  _exactly_, proved mechanically (all 2 408 parsed coordinates are dyadic rationals, and
  every case's text is a byte-for-byte fixed point of parse→format→parse); `arc` claims
  same-runtime. The stated edge is ECMA-262's: a literal with more than 20 significant
  digits may legally round two ways.
- **`tests/integration/svg-path-pipeline.test.ts`** — the §50 → §51 → §52 claim proved
  across packages against analytic areas: rectangle, rounded rectangle, circle, washer
  and a smooth-shorthand blob all parse, group by fill rule, and tessellate.

#### Fixed

- **An arc's start is authoritative over the segment that reaches it.** SVG's `A` begins
  at the current point by definition; §51's arc begins where its centre form lands, and
  no centre makes that hit an arbitrary point exactly (measured: ~83% over 200 000 random
  arcs, because `(a − b) + b` is not an identity in binary floating point). The two ulps
  of disagreement became §51's implicit connecting segment, pointing _back_ along the line
  that just arrived — a zero-area spike §52 correctly refuses, which made the rounded
  rectangle (`L … A …`, four times) unfillable. The reader now holds each line, quadratic
  and cubic back by one command and retargets its endpoint onto a following arc's computed
  start. It is the only coordinate in this module that is not exactly what the document
  said, and it is documented as such. Residual, stated: arc → arc seams still carry the
  implicit segment; they are tangentially continuous and have produced no refusal.

#### Changed

- `packages/geometry/src/path.ts` exports `arcPoint`, `advance`, `newCursor` and
  `PathCursor` **package-internally** (not through the barrel) so the SVG writer shares
  one implementation of "where does a command start" and "a `close` leaves you at the
  subpath's first point". No behaviour change; `golden/path.json` is unmoved.
- `packages/geometry/README.md` corrected in place, dated: it still said the path model
  and tessellation were "staged / not yet implemented" after R-24 and R-25 shipped.

### 2026-08-09 — R-18 closed (directional shadow-map tier): §69 shadows

#### Added

- **§69 directional shadow maps (R-18)** — `DirectionalLight.castShadow` + a validated
  `DirectionalLightShadow` settings object (`mapSize`, `bias`, `normalBias`, `extent`,
  `near`, `far`; refuse-don't-clamp, F14 accessors), §49's `castShadow`/`receiveShadow`
  on `Renderable` (both default `true` — the asymmetry with the light's `false` is the
  point: switching a _light_ on buys a whole pass, switching a _node_ off is an
  exclusion), a seventh depth-only `ShadowProgram`, and a 3×3 PCF comparison in both
  shaded pipelines through one shared `SHADOW_GLSL` chunk. **Two of §69's ten features
  ship**, plus configurable resolution and both bias controls; cascades, point/spot
  shadows, the atlas, transparent masks and contact shadows are staged with named owners
  in `DirectionalLightShadow`.
- **R-4's samplable-depth residue closed** — `RenderTargetOptions.depthTexture` swaps the
  `DEPTH_COMPONENT16` renderbuffer for a `DEPTH_COMPONENT24` texture;
  `{ depth: false, depthTexture: true }` refused (§85); `byteLength` accounts 4 B/texel
  for it. Material-slot sampling of a depth attachment stays staged (needs an attachment
  discriminant + a non-filterable sampler policy).
- **The shadow pass is backend-internal, not a §63 graph pass** — §63's diagram lists
  shadow passes as a renderer stage, and the pass has no camera, viewport or
  application-named target. R-5's transcript-identity property is untouched.
- **Byte-identical for scenes whose light does not cast** — `FRAME_BEFORE_R18` recorded
  on the reverted build at `dab68c9`, and byte-identical to R-17's independently recorded
  transcript; 59/59 browser gate with goldens unmoved.

#### Fixed

- **F13 envelope widened (R-18):** the frame's `finally` unbound its framebuffer only for
  off-screen frames. §69's caster pass binds one on the on-screen path too, so a
  mid-frame throw could have left every later frame rendering into the shadow map. The
  condition is now a flag; two tests pin it.

#### Changed

- §79: `scene:directional-light` gains `castShadow` + a `shadow` record;
  `render:renderable` and `render:sprite` gain both §49 flags. Additive — a document
  written before this build carries none of the keys and restores not-casting with the
  documented defaults. A corrupted shadow value restores that field's default rather than
  failing the scene (`near`/`far` admitted as a pair, since their check is a relation).
- **Bundle:** +2.42 / +1.96 / +1.82 kB gzip (first-3d / particles / ui-demo), A/B
  measured — ~1.9 kB of it is the seventh compiled-at-init pipeline in every bundle
  carrying `WebglRenderer` (R-6's law at scale). Budgets bumped 29 → 31.5 kB,
  27 → 29 kB, 35 → 37 kB with the measurements.

### 2026-08-09 — R-24 closed (model + flatten tier): the §51 path model

#### Added

- **§51 `Path` in `@fourjs/geometry` (R-24)** — §98's own placement ("path model,
  tessellation module"). Six segment kinds as a readable command list behind a fluent
  builder (spec's names — `cubicCurveTo`, not Canvas's; **no `fromCommands`**: the
  builder _is_ the well-formedness invariant, so every reader below can assume it).
  **13 of 17 §51 operations ship**: flatten (adaptive), subdivide (exact de Casteljau/
  angle halving), simplify, reverse, transform (a non-similarity matrix on an
  arc-bearing path is **refused**, not silently squashed), length, arc-length
  `pointAt`/`tangentAt`/`normalAt` (what text-along-path needs), `closestPoint`, and
  both fill rules via `fillRings`. Staged with named owners: offset path → R-16 (an
  offset at a concave corner _is_ §58's join rule — building it first invents that
  rule twice); the four booleans → the planar-subdivision packet §52 also needs, built
  once together. Arcs canonicalize to a **signed sweep** rather than the raw end angle
  — reverse/subdivide/transform become one line each.
- **The first §33 golden pinning two tiers at once**, because §51 has two kinds of
  segment and only one can be exact: Béziers **cross-platform** (de Casteljau at t=½ is
  exact halving — and the claim is _asserted mechanically_: integer control points +
  power-of-two tolerances make every emitted coordinate a dyadic rational, checked as
  `x·2²⁴ ∈ ℤ` for all 25 330 of them), arcs **same-runtime** (a point on an arc _is_
  sin/cos, and the sample _count_ comes from `acos`+`ceil`). Two `_tier` strings, two
  digests — merging them would let a transcendental slipped into the Bézier path hide
  inside the arc half's weaker claim.
- **The flatten → tessellate handoff proven against analytic areas** (no magic
  epsilons — the bound is the flattening's own `tolerance × length`): every fillable
  §50 shape fills across the package boundary, including a three-ring letter "e" —
  `fillRings`' grouping is what makes an **island** expressible (its own region, not a
  hole-in-a-hole §52 refuses). Three real bugs found by the oracles, not by reading:
  an inverted winding sign, a full-turn arc missing its own start by an ulp, an open
  subpath double-counting its closing edge. **R-23 is unblocked for all 14 §50 shape
  fills; R-26 has a model to import SVG into; §119's chart workaround becomes
  retirable when R-23 lands.** Bundle cost: **zero bytes, A/B byte-identical**
  (`Matrix3` is a type-only import). Graph artifacts regenerated.

### 2026-08-09 — R-25 closed (polygon tier): §52 tessellation; the 2D vector stack begins

#### Added

- **§52 polygon tessellation (`packages/geometry/src/tessellation.ts`, R-25)** — the
  load-bearing prerequisite of the entire 2D vector stack: `triangulatePolygon(outline,
holes?)` (ear clipping with bridged holes, O(n²), no dependencies, nothing vendored),
  the `PolygonTessellator` replaceability seam §52 demands, `earClippingTessellator`,
  and `polygonGeometry2D` (§50's "arbitrary polygon" as a standard `BufferGeometry`).
  **The deciding argument for ear clipping over monotone decomposition is determinism,
  not simplicity** — sweep-line equal-y tie-breaking is exactly where a determinism
  claim quietly stops being true; the seam makes the upgrade one export.
- **The repo's first cross-platform-tier §33 claim**: only exactly-rounded IEEE ops
  (`+ - * /`), squared distances, cross-product signs, integer tie-breaks — no
  `atan2`/`sqrt`/`hypot` anywhere (the classic angle-sort tricks are precisely how a
  tessellator acquires a platform dependency). Pinned by
  `tests/determinism/tessellation.test.ts` + `golden/tessellation.json` (8 hand shapes
  - 200 seeded integer-grid stars, refusals recorded too, fresh-process matched). Any
    future edit introducing a transcendental there breaks a committed golden's _stated
    tier_, not just its numbers.
- **Simplicity is proved, not assumed**: ear clipping fed a pentagram succeeds
  _wrongly_ (silently overlapping triangles), so the module proves the input simple
  before clipping and refuses with both rings named (§85). The honest measured limit
  is in-source: 60 000 adversarial fuzz cases against an area/winding oracle —
  hole-free and single-hole inputs **never failed** (26 641 cases); ~2/1000 multi-hole
  configurations are refused, **nothing was ever wrong**. Two real bugs the fuzz found
  (bridge-seam self-veto, stacked bridges) are fixed — found by fuzzing against an
  oracle, not by reasoning, because bridged rings are only weakly simple and the
  two-ears theorem does not apply.
- **`extrudeGeometry` no longer refuses concave capped outlines** — caps are
  tessellated with one index list serving both ends (§52's index-buffer reuse), the
  centroid vertex is gone (`2(n+1) → 2n`), and the superseded refusal is quoted in
  place. Self-intersecting/zero-area outlines still refused pending §52's fill-rule
  tier. Staged with dated notes naming their owners: stroke expansion + AA fringe →
  R-16; adaptive subdivision + incremental rebuild → R-24; extrusion holes → the §50
  shape-node question. **R-24's fill half now has no blocker; R-23 can build fill
  geometry for all 14 §50 shapes via `polygonGeometry2D`.** Graph artifacts
  regenerated (four new exports).

### 2026-08-09 — R-17 closed (eight-lamp forward tier): §68 multi-light

#### Added

- **`PointLight` and `SpotLight` (R-17, §68)** — two new `@fourjs/scene` nodes over a
  shared `PunctualLight` base, collected by the existing `collectSceneLights` walk into
  a bounded uniform-array light set (`MAX_PUNCTUAL_LIGHTS = 8` — a TS constant
  interpolated into the GLSL so the two cannot disagree; a runtime `maxLights` would
  mean recompiling inside a frame, which §61 forbids; 8 fits the GLES 3.0 _guaranteed_
  uniform minimum with no capability query). Attenuation is `KHR_lights_punctual`'s
  inverse-square with an optional range window (a **culling aid, not physics** —
  `range: 0` = unbounded, the honest default); spot cones are glTF's inner/outer
  half-angles in radians, precomputed CPU-side where the division lives (R-13's
  placement rule). **The R-13 irradiance-over-π convention extends to distance**:
  `color × intensity` is the irradiance at unit distance, so a point and a directional
  light of equal intensity agree at 1 m and one scene mixes them — both shaded
  pipelines consume the set through one shared GLSL chunk (~400 B instead of ~700).
  Past the bound the **first eight in scene-graph order** win — authored order, never
  nearest/brightest (both flicker, §33) — with a once-per-root warning (122 B,
  measured). §79 pairs: `scene:point-light`, `scene:spot-light`.
- **Byte-identity, with a new pixel half to the technique** (fourth confirmation of
  the GL half): a directional-only scene issues byte-for-byte its old sequence
  (`FRAME_BEFORE_R17`, **recorded on the reverted build** — a hand-copied transcript
  was wrong in four plausible-looking places, now a recorded rule) — and the pixel
  half requires the new term _added to_ the old expression in source order:
  re-association (`viewProjection * (model * p)`) moves pixels. Deliberately not
  widened: **still exactly one directional light** — a second sun needs a third entry
  kind, which is the clustered/forward-plus path's job. Hemisphere staged (a
  two-colour ambient term, not a punctual light); area lights staged (LTC). R-18
  shadows now needs only R-4's samplable-depth residue.

#### Changed

- **Size budgets: first-3d-scene 28 → 29 kB, particles-demo 25 → 27 kB, ui-demo
  33 → 35 kB** (measured A/B: the light set costs +1.10–1.17 kB gzip per shaded
  bundle; the two tightest budgets had 50 B and 20 B of headroom before the packet, so
  any bundle-touching change was going to overflow them — the bumps restore working
  headroom per the R-13 precedent; §86's 150 kB untouched).

### 2026-08-09 — RFC 0004 drafted: 2D raster painting stack (owner-requested)

#### Documentation

- **`docs/rfcs/0004-raster-painting-stack.md`** — proposes **§77a**: a structural,
  DOM-free `RasterSource` seam (`paint()` takes **no parameter**, deliberately — a
  parameter would be either an engine rasterizer duplicating the R-16/R-24/R-25 stack
  or a named DOM type, both refused) and a `CanvasTexture` satisfying the existing
  `MaterialTexture` contract — **no backend change, no new duck-typed contract, no
  closed union widened** (R-4's seam decision paying off a second time). A
  `CanvasViewWidget` for §73 that needs no drawing API in `@fourjs/ui` and no new skin
  hook — **the recorded §73 blocker is wrong, and the RFC corrects it**: `ImageWidget`
  already established the widget-owns-identity/skin-owns-texture split, and a repaint
  request is content with no layout transition, exactly what A-12's `onContentChange`
  exists for. §33 rule transposed verbatim from §40: painted pixels are display
  content, never simulation input, enforced in the `units-display.test.ts` pattern —
  with the honest limit stated (a reachability rule, not a readability one).
  Constant-size by refusal (the cheap answer to R-29's frame hazard; resize gates on
  R-30, which this RFC makes load-bearing for the first time rather than claiming it
  falls out). §62's Canvas 2D backend delineated as a different concern that stays a
  stub. Alternatives A–F with "do nothing" argued at full strength — and its honest
  consequence named: a "no" means _withdrawing the canvas view from §73 by amendment_,
  because its blocker is wrong either way. **Owner decision pending** — first question
  is whether raster painting is in the product's scope at all (the spec chose retained
  mode; the RFC exists because the owner asked). Register rows 15–17 added to v1 §5.

### 2026-08-08 — Specification revision 1.8: the consolidated amendment pass

#### Documentation

- **Spec revision 1.8** (`docs/SPECIFICATION.md`, one amendments-table row, frozen
  §1–120 numbering untouched, no new lettered sections). **Reversed four statements
  shipping had made false**: §18 + §97a's "`AnimationController` is not implemented"
  (replaced with a compiling shipped-form snippet, the pose-evaluator rationale, and a
  per-feature shipped/scheduled split of §18's nine); §20 + §97a's deferred
  `solver: "auto"`/`renderer: "auto"` (rewritten with the registry semantics —
  including why registration is never an import side effect); §97a's `StandardMaterial`
  row; §97's "a world is built and tracked, not an app option". **Corrected two
  never-implementable statements**: §54's `morphTargetWeights` placement (→ a §6a
  `MorphWeights` scene component with the declared field kept as an accessor — the
  frozen dependency matrix made the original placement impossible) and §17's two
  "missing track types" (binding forms over existing value kinds, not new
  discriminants). **Added**: `LitMaterial` to §57's family (the 2026-08-04 revisit
  note discharged); a _provisionally withdrawn_ marker on §57's `ShaderMaterial` row
  carrying RFC 0001's draft status inline (acceptance makes it permanent, rejection
  restores the row — deliberately not settled while the RFC is a draft); §61's
  deferred-by-decision note on `createTexture`/`createRenderTarget`.
- **Triaged out, with the rule that emerged recorded in MEMORY**: §100, §65, and §55
  are _requirements lists_, never status claims — a spec section is not stale merely
  because its requirement is unbuilt; only implementation-status statements are
  amendment targets. §111's namespace note was already fixed by revision 1.7 (the TODO
  entry was the stale artifact). Code-side follow-up recorded:
  `packages/animation/src/track.ts:40-45` still promises the opposite of §17's new
  text — corrected in the RFC 0003 packet or as a chore.

### 2026-08-08 — R-29 (frame half): §55 sprite frame sub-rectangles

#### Added

- **§55 sprite `frame` sub-rectangles (R-29).** `Sprite.frame`/`setFrame()`/
  `SpriteOptions.frame` select a texture region in **texels, bottom-left origin**
  (forced, not chosen: `MaterialTexture.data` documents row 0 as `v = 0`, §7a puts +Y
  up — and normalized units would make §85's containment check vacuous);
  `SpriteRenderItem.frame` carries it; the WebGL 2 backend resolves it **into the
  existing `quad` uniform**. Many sprites now share one atlas texture, one material,
  one upload — proven end to end: four glyph cells go from 4 `createTexture` +
  4 `texImage2D` to 1 + 1, with identical uv rectangles. §85 refuses out-of-bounds
  frames (validated before the first write; one named hole dated in place — a later
  texture swap is unchecked and samples clamp-to-edge, wanting R-30's §77 change
  notification). A frame write re-uploads nothing — the property §55's animation
  clips and §86's glyph batching need.
- **The 2026-08-07 mechanism prediction is retracted in place, with the derivation
  that disproves it**: a frame is an affine _reparametrization_ of the derived-uv map
  (`quad.zw = w·tw/fw`, `quad.xy = minX − fx·w/fw`), so the unchanged shader samples
  the sub-rectangle exactly — no uv attribute, no new uniform, no new GL call, and
  frameless sprites are byte-identical **by code path** (tenth recorded-sequence run;
  the R-13-era pinned transcript containing a sprite still asserts verbatim). A real
  uv stream remains §65 batching's answer, recorded there. Staged with dated notes:
  the named-frame atlas object (a §77 metadata container for `@fourjs/assets`) and
  sprite animation clips (§14/§17 step tracks — a private timeline inside `Sprite`
  would be a second animation system). §55 now 5 of 11.
- **Diagnostics cost bytes, measured**: five per-component §85 messages were +330 B
  gzip — more than the rest of the feature; collapsed to two whole-value messages.
  ui-demo at 32.98/33 kB (**20 B headroom — effectively exhausted**; flagged). The
  four examples' `cutGlyphCell` workaround and `packages/text`'s one-texture-per-cell
  advisory are now retirable (recorded, not touched). Serializer follow-up recorded:
  `Sprite` documents don't yet carry `frame`.

### 2026-08-08 — A-24 closed: §61's context-loss contract has its suite

#### Tests

- **A-24 — three tiers, 17 tests, no product change needed.** Unit
  (`webgl-renderer.test.ts`, 9): the frame after a restore equals the frame before the
  loss **call for call** (handles normalized to first-appearance); **not one GPU
  handle from before the loss is ever touched again** — programs, shaders, buffers,
  VAOs, textures, framebuffers, renderbuffers, uniform locations, asserted disjoint
  across a full post-restore workload _and_ across a second loss/restore cycle;
  pipelines rebuild eagerly, resources lazily (restore alone: 6 `createProgram`, zero
  resource creations); a texture edited and a target resized _while lost_ come back at
  their new version/size; the F13 envelope closes on a loss delivered mid-frame (from
  inside a material accessor); the §70 effect pipeline survives; dispose-while-lost
  issues zero GL calls. Integration (`renderer-context-loss.test.ts`, 7): an
  `Application` steps to **bit-identical §12 positions** across four contextless
  frames with zero GL calls (loss is invisible above the renderer); the
  `NullRenderer.events` seam finally does the job it was built for; `app.stats` counts
  no draw for a skipped frame; a `RenderGraph` target re-allocates at its post-loss
  size. Browser (`context-loss.spec.ts`, real ANGLE context via `WEBGL_lose_context`):
  the restore arrives **only because the backend calls `preventDefault()`** — the one
  clause a double can only inspect — with an empty error log while the context is
  gone. **The loss path was correct before it was tested** — A-24 was a behavioural
  gap, not a coverage one (the path was already at 100% lines; the four remaining
  uncovered statements are invariant guards unreachable through the public API — do
  not chase them). One §83 corner recorded for the owner: `dispose()` after a
  _failed_ restore leaks the rebuilt programs; the obvious fix would break the tested
  "not one GL call while lost" property, so it is deliberately unmade.

### 2026-08-08 — R-38 closed: §46 symbolic layers

#### Added

- **§46's layer registry (`packages/scene/src/layers.ts`)** — named layers compiled to
  a 32-bit `LayerMask` ("compile to efficient masks internally … preserving
  human-readable names"): `defineLayer`/`layerMask`/`layerMaskNames`/`layerNames`/
  `layersMatch`/`applyLayers`/`resetLayers`, with `Node.layers` (default the
  `"default"` layer), §47's `Camera.layers` (default `ALL_LAYERS` — discharging the
  `TODO(§46/§47)` `camera.ts` carried since WP-3.1), and §48's `Viewport.layerMask`.
  `@fourjs/render` filters during §64 stage-2 traversal (`buildRenderList(root, out,
layerMask?)` + the interpolated form), snapshots each node's mask onto
  `RenderItem.layers`, and resolves §48's fallback once in `viewLayerMask(view)`;
  `@fourjs/render-webgl` skips a filtered item per view before touching a GPU resource —
  **one camera can feed two viewports with no overdraw** (proved: 7 drawables × 2
  disjoint views = 7 draws, not 14). Scene files carry **names, never bits** —
  round-trip is `layerNames()` out, `resetLayers()` + replay in saved order back.
- **Decision — layers do not inherit.** A node's mask gates that node only (a layer is
  _identity, not state_; subtree gating is strictly less expressive, and changing a
  layer can never make something _else_ disappear — §46's editor-only surprise);
  `applyLayers` is the subtree spelling, as Three.js and Unity spell it. Consequence:
  a masked list is a **subsequence** of the unmasked one, never a permutation
  (asserted), and traversal is unchanged. `Camera.layers` overrides `Node.layers`
  (nothing ever reads a camera's membership); the registry is module-level, not
  per-`Scene` (nodes exist, move, and deserialize before their scene is assembled).
- **Byte-identity, ninth run**: a six-pipeline scene emits the identical GL transcript
  with and without layers declared; a masked view emits exactly the GL of the scene
  without the filtered nodes (filtering is indistinguishable from never-having-been);
  all four pre-R-38 pinned transcripts, both goldens, and 58/58 browser unchanged —
  and the new tests are mutation-tested, not vacuous. Cost +120 B gzip on ui-demo: the
  render tier's §85 diagnostic is `DEV`-gated (~115 B, stripped in production; its
  GATED-allowlist §33 argument recorded), while **`@fourjs/scene`'s `assertLayerMask` is
  unconditional** — the dev-build suite holds simulation packages to the blunt rule
  that they may not branch on build mode at all. Unblocks R-8 (the mask parameter
  already tested), R-37 (`ScreenCamera`'s missing half), §71 picking filters
  (`layersMatch` is the whole predicate), and the flagships' viewport follow-up.
  Staged with reasons: §25 physics groups, §70 inclusion, the §71 filter itself.

### 2026-08-08 — A-6 closed: the §45 composition root completed

#### Added

- **§45's absent members (A-6).** `Application` gains: **`physics`** — a `PhysicsWorld`
  instance or a **factory handed `app.poses`** (`physics: ({ poses }) => new
PhysicsWorld({ …, poses })`; the factory form exists because a world built before the
  `Application` can never reach the pose buffer, so an instance-only option would ship
  an `app.physics` that silently cannot interpolate §43), stepped at §39 step 6 and
  disposed only when the application built it (§83: ownership follows construction, in
  both directions — the renderer rule). §45's literal `PhysicsWorldOptions` form is
  deferred for the recorded bundle reason (a static `@fourjs/physics` import would put a
  solver in every UI bundle — the third instance of the deferred-string-selection
  pattern; the import is type-only, zero runtime bytes). **`assets`** (§76's
  `app.assets`, instance form — the manager carries its own host seams).
  **`autoResize`** with an injected `SurfaceObserver` seam (defaults true iff an
  observer was supplied, so one is never accepted-and-ignored). **`reducedMotion`**
  (`"auto" | boolean`) resolved through an injected `reducedMotionSource` **on every
  read, never cached** — a mid-session preference change is honoured with no
  subscription; closes A-13's reduced-motion policy half and PH-22m's policy half.
  `app.input` and `app.diagnostics` are **refused with recorded reasons** (§45 names
  them in prose only, no option, no example reads them — the §40 precedent; §84's
  surface is spelled `app.stats` in the spec's own example and ships).
- **§84 `physicsStepTime` and `activeBodies` are measured** whenever a world is
  attached and stats are on — `physicsStepTime` covers `world.step()` only (not §39
  step 9 event delivery), in a `finally` so a throwing solver still reports;
  `activeBodies` is read once after the frame (a level, the A-5 pattern). `contacts`
  stays staged with its reason recorded: the world publishes §29 _events_, not a live
  manifold count — differencing events answers a different question. Load-bearing
  proof: the same Rapier scene run §97-style and as `physics: () => …` produces
  element-identical checksum sequences over 20 distinct-value frames.
- **`solverStatistics` moved from `debug-draw.ts` to `stats.ts`** (same export, same
  barrel) — naming it used to drag **939 B gzip** of debug-draw module state
  (module-level scratch `Vector3`s, frozen staged lists) into every bundle; now 24 B.
  Third measured instance of the cannot-tree-shake class: producers belong in the
  module of the record they write.

#### Changed

- **ui-demo's budget: 32 → 33 kB, one coordinated bump for both wave-6 packets** —
  HEAD sat at 31 995/32 000 (5 B headroom); A-6's composition-root growth is
  structural (+352 B — nothing reachable from a class method tree-shakes) and the
  in-flight §46-layers packet independently measured +254 B. §86's 150 kB budget
  untouched. Spec-revisit recorded: §97's "a world is built and tracked, not an app
  option" comment is stale after A-6.

### 2026-08-08 — R-15 closed (policy + opt-in-transform tier): §60a colour management

#### Added

- **§60a colour management (R-15)** — v1's highest-leverage open render item.
  `@fourjs/math` gains the colour tier: `ColorRGB` (hoisted from `@fourjs/scene`, exactly
  what R-13's emissive note asked for — the duplicate gate confirms 0), `ColorSpace`,
  the sRGB transfer functions (piecewise IEC 61966-2-1, component + RGB/RGBA
  out-param forms, **odd-extended below zero** so extended-range values round-trip
  rather than clamp — WP-3.3's rule extended to the curves; **alpha is never run
  through a transfer curve** — coverage, not light), and `parseColor`/`parseColorRGB`
  over a documented CSS subset (`#rgb…#rrggbbaa`, all `rgb()/rgba()` syntaxes,
  `transparent`, the sixteen Level 1 keywords) that refuses everything outside it.
  `color.ts` went 0% → 100% coverage. **The working-space policy is written down
  once**, in `color.ts`'s header: material/light/vertex colours _are_ linear-light (a
  per-value tag would have one legal value); §60a's metadata lives on _resources_ —
  `TextureSource.colorSpace` (`SRGB8_ALPHA8` allocation: hardware decodes before
  filtering) and `RenderTarget.colorSpace`, which `validateEffectRenderPass` uses to
  refuse double encodes at setup.
- **The output transform is a pass, never a per-material encode** — §60a's own words
  ("is the final render-graph pass") select the design: `OutputTransformEffect`, the
  fourth `ScreenEffect` member, executed as one `renderEffect`. Tone mapping stays
  staged on R-4's float formats and lands as a field on this effect.
- **Two dated deviations, both opt-in-instead-of-default** (textures default
  `"linear"`, transform off), taken so no golden moved — every authored scene predates
  the pipeline having an output space; the transform ships, a scene opts in, goldens
  move deliberately. Flagged as owner decisions with the CSS-string-options question
  (§101's mapping row pins tuples; `srgbToLinearRGBA(parseColor(css), out)` is the
  one-line path). Eighth run of the recorded-sequence method: the R-6-era pinned
  transcript passes unchanged; a copy-effect frame issues zero `uniform1i`; 58/58
  browser with MD5-identical goldens. ui-demo at 31.99/32 kB — the encode GLSL was
  inlined specifically to fit; A-4's build-time pipeline selection remains the
  structural fix.

### 2026-08-08 — §119 flagship: the motor digital twin (S-8's example program complete)

#### Added

- **`examples/flagship/motor-digital-twin`** — §119's engineering demonstration and the
  positioning demo (`docs/POSITIONING.md`'s first audience): a procedural 3D motor
  (stator frame, end bells, fins, rotor, shaft, coupling — §53 primitives under
  `LitMaterial`), the rotor turned **by the solver** through a §28 hinge motor with
  **two coaxial bearings** (stable on Rapier 3D over 900 steps with a contact fault
  applied and released), **emergent vibration** (an off-axis collider + a
  slider-and-spring mount — ~11.6 mm p-p at 200 rpm), a lumped first-order thermal
  model with a 135 °C trip, waveform charts drawn as **one draw call** via the R-35
  lines+vertex-colour path, two fault injections (bearing rub via a slider-driven
  caliper; drive sag as a second `PIDController` with derated `outputLimits` — §111's
  own anti-windup, after measuring that external clamping + `ki = 0` produces a
  two-step limit cycle), `PIDController` closed on the measured shaft speed, §34
  record/seek/replay with a published verify, and §79 save/load (208 nodes
  round-tripping). **Three firsts**: `app.stats` read in an example (§84 — readable
  only _after_ `app.step` returns, measured), §40's conversion helpers at the display
  edge (RPM/deg/mm/ms), and a deliberate **dev build** (`__FOUR_DEV__` not defined
  false — a page about instrumentation cannot ship the build that strips it; the one
  documented deviation). One-wasm solver path (`new Rapier3dAdapter()` — 917.9 kB gzip
  vs the §118 flagship's 1.54 MB), budget 1.00 MB.
- **`tests/browser/motor-digital-twin.spec.ts`** (9 tests; browser 49 → 58) — measured:
  bearings asserted from the joints, §84 counters (`drawcalls` 158, `contacts` honestly
  `nan`), unit readouts equal to engine values through the declared conversions, two
  page loads publishing the **identical** mark checksum, PID within 4 rpm of setpoint,
  rub and sag behaviours, pause = exactly 0 changed pixels, replay-seek re-simulating
  ≤5 steps with `replayverified` true, save round-trip true.
- §119's residue staged in the file header with v1 citations: real chart primitives
  (R-24/R-23), camera-parented instruments (R-37), _measured_ joint reactions (no
  adapter reports them — the torque/force glyphs are the twin's estimate, labelled),
  glTF model (S-7). **S-8's §118–§119 example program is complete**; only the three §93
  stand-in directories remain (owner retire-or-write).

### 2026-08-08 — A-27 closed (CPU tier): §86 benchmarks for UI layout and glyph layout

#### Added

- **Two new §86 benchmarks + a runner (A-27).** `benchmarks/ui-layout.mjs` measures the
  layout-and-state half of _retained UI nodes: 5 000_ — **11.7 ms cold / 10.1 ms warm**
  per `layout()` on the recorded host, inside a 60 Hz frame (60 Hz stated explicitly as
  an interpretation borrowed from neighbouring rows — §86 gives this row a count, no
  rate). `benchmarks/text-layout.mjs` measures the layout half of _animated glyphs:
  20 000_ — **2.19 ms, 109 ns/glyph**, with a two-term per-call/per-glyph attribution
  (residual 4.3%, published). `run-all.mjs` + `pnpm bench` run all seven scripts
  process-per-script (JIT/heap isolation; a throw cannot take the run's records) and
  write `results/suite.json` — a manifest, **never a gate**: the runner asserts on no
  timing (a threshold would be the back door `benchmarks/README.md` forbids).
- **Both §86 rows stay unmet as whole rows, honestly**: their draw halves are blocked
  on §55 `frame`/§65 batching and on a GPU — the README table gains a third category,
  **`half`**, beside `hardware` and `feature`. Findings recorded, not acted on: §74's
  layout has no dirty tracking (text measurement is only 15–25% of a cold pass — the
  rest is an unconditional walk, the `resolveWorldTransforms` shape in a second
  subsystem); `layoutText`'s per-glyph cost is ~80% allocate-and-freeze, so the future
  optimisation is a flat coordinate buffer, not faster math. The five pre-existing
  records were re-recorded on this (loaded, shared) host — `physics-step`'s +24% is
  explicitly non-attributable (concurrent agents + the PH-22 rebuild) and should be
  re-recorded on a quiet host, not read as a regression. Still absent: the non-gating
  CI trend job (stated in the README, not implied).

### 2026-08-08 — PH-22 sweep: all fourteen roll-ups triaged; four closed or advanced

#### Added

- **§24's remaining collision shapes (PH-22a, closed — 7 of 8 shipped).** 2D gains
  `polyline` (open strip) and `chain` (closed loop); 3D gains `cylinder`, `cone`,
  `convex-hull`, `triangle-mesh`, `height-field` — each §85-validated, with §79
  document forms whose round-trip test asserts the fixture set _equals_ the shape-type
  unions (a future tag cannot ship without a document form), and both Rapier adapters
  converting. Three facts **measured against Rapier 0.19.3, not assumed**: the
  heightfield's column-major `heights` layout and row→Z/column→X axis mapping
  (raycast-verified), the cone's apex at `+halfHeight`, and composite shapes returning
  **zero** intersections from `intersectionsWithShape` — which is why the new
  `validateQueryShape` refuses them as §30 query shapes in all four adapter
  overlap/shapeCast entry points (a composite is a legal collider and an illegal query
  shape, because Rapier answers _wrongly_ rather than failing). `compound` is
  deliberately not a tag: it is several colliders on one body, which PH-5 made
  runtime-assemblable — composition by decision.
- **`PhysicsTuningCapabilities.jointMotorEffortCap` (PH-22e, closed)** — the first
  capability field whose `false` means "applied, _differently_" rather than "not
  applied" (Rapier's `maxTorque`/`maxForce` is a gain, not a cap); `false` on both
  adapters, warn-once on the first **enabled** motor.
- **`Joint.collisionEnabled` is live on a registered joint (PH-22f, partial)** — the
  per-property survey of Rapier's joint surface replaced the blanket freeze claim:
  `setContactsEnabled` lives on the _base_ `ImpulseJoint`, so it queues through the
  new `SolverJointAccess.setJointCollisionEnabled` and drains world-side; it was the
  only mutable-with-throw property in the whole joint surface (the rest are `readonly`
  fields — compile errors, which the header previously mis-described). Anchors
  re-staged with the real reason (the world→local conversion happens once at
  `addJoint`; a live re-anchor needs a which-pose decision).
- **§41 numerical-stability diagnostics (PH-22n, half)** — registration-time warn-once
  for distance-from-origin > 1e5, dynamic collider extents outside [1e-2, 1e3]
  (static/kinematic exempt — a ground slab is not a scale mistake), and cumulative
  dynamic mass ratio > 1000:1; each threshold a decade past the units guide's advice
  so the warning never becomes routine. **Adds no solver call** — mass threaded out of
  the existing refresh. The §10 dropped-time §84 warning is app-tier and moves to that
  backlog.

#### Blocked, re-verified (not closed, honestly)

- PH-22b (distance/gear joints), PH-22c (break force), PH-22d (spherical cone limits):
  re-verified against Rapier 0.19.3's actual declarations — the constraints/getters do
  not exist at this pin; stiff-spring stand-ins would be the "almost right" wrong
  simulation. PH-22j (box2d/soft stubs) stays an owner §102 scope decision.
  PH-22g/h/i/k/l/m are cross-tier items belonging to animation/motion/math/core/four
  packets (recorded per item). Diagnostics' joint-seam prose updated for the sixth
  member.

### 2026-08-08 — R-13 closed (scalar + base-colour-map tier): §59 `StandardMaterial`

#### Added

- **§59 `StandardMaterial` — metallic-roughness PBR (R-13).** `@fourjs/materials` gains
  §57's sixth family member: `baseColor` (+ optional base-colour `map`), `metalness`
  (default 0), `roughness` (default 1), `emissive` (straight RGB; unclamped
  pass-through already gives HDR emissive, so no unnamed `emissiveIntensity` field).
  `@fourjs/render-webgl` gains a sixth pipeline (`StandardProgram`): Cook-Torrance GGX +
  height-correlated Smith + Schlick Fresnel against §68's one directional light and
  the scene ambient, with the **1/π folded out of both lobes** — the engine's
  radiometric convention is now written down (light colour × intensity is an
  irradiance already divided by π), which is what makes a fully-rough dielectric
  reduce to the `LitMaterial` convention and the two families compose in one scene.
  Ambient reaches the diffuse lobe only (no IBL — `metalness: 1` under ambient alone
  renders black, honestly). Roughness floored in the shader (0.045) where the 0/0
  division lives; the material keeps WP-3.3's no-silent-rewrites rule.
  `RenderItemKind` gains `"standard"` as its own union arm; `WebglContext` grew
  `uniform1f` (its first new entry point since the lit packet — three GL doubles had
  to declare it, which is the point of the written-down budget). Staged with named
  prerequisites: `normalMap` (R-19's deliberately-deferred tangents), the other §59
  maps (§77's texture-unit allocator), the seven physical extensions
  (`PhysicalMaterial`). No tone mapping/output transform — §60a/R-15 moves both lit
  families at once.
- **Seventh run of the recorded-sequence method**: a scene using every pre-R-13
  pipeline emits the transcript recorded at `e0ddd3b` call for call (pinned in
  `tests/integration/standard-material.test.ts`); browser 49/49, goldens
  byte-unchanged. The duplicate-symbol gate refused a second `ColorRGB` export —
  the shared RGB alias belongs in `@fourjs/math` with R-15's colour packet (inline
  tuple + dated note instead).

#### Changed

- **ui-demo's size budget: 31 → 32 kB (orchestrator decision on the agent's proof).**
  The sixth pipeline costs ~1.18 kB gzip per bundle (a BRDF, not a blit); with the
  draw branch stripped, compile-at-init alone measures 31.547 kB — §61's
  no-compile-in-a-frame rule and the 31 kB budget were provably incompatible. ui-demo
  has now absorbed two consecutive pipeline additions; A-4's build-time
  pipeline-selection seam remains the structural fix (recorded).

### 2026-08-07 — A-4 closed (build-mode tier): development/production builds

#### Added

- **§85 development/production builds (A-4).** `@fourjs/core` exports `DEV`, `devWarn`,
  `devWarnOnce`, `devAssert`, `resetDevWarnings`, resolved from an optional
  `__FOUR_DEV__` global (`typeof … ? … : true` — read only under `typeof`, so an
  unaware host cannot crash). **Dev is the default; you opt out**: bare consumption,
  Vitest, and the determinism suites are development builds automatically; a bundler
  `define: { __FOUR_DEV__: "false" }` folds the guarded paths away. `devAssert` skips
  its check entirely in production — and every `FourError` stays unconditional (§85's
  "essential safety checks" asymmetry, deliberate). `@fourjs/diagnostics` gains
  `auditResourceLeaks` — §83's first development warning, an **audit you call, not a
  watcher that runs** (only the caller knows which span was supposed to balance;
  `FinalizationRegistry` rejected again for the A-5 reason).
- **The flag may remove work, never change a number (§33) — enforced mechanically**:
  `tests/integration/dev-build-mode.test.ts` allowlists the five files permitted to
  import the dev channel (each with its §33 argument recorded; a sixth fails the
  suite), refuses the simulation packages outright, asserts every example config
  carries the define, and proves the stripping with a real bundler. Pixel goldens
  passed against the production ui-demo bundle — independent evidence the flag moved
  no pixel.

#### Changed

- §84's statistics wiring, §6a's duplicate-component warning, and §83's leak audit are
  gated on `DEV`; `app.stats` is `null` in a production build even with `stats: true`
  (declared types unchanged). All eight example Vite configs define the flag false, so
  `pnpm run size` now measures what a user ships: **0.46–0.52 kB gzip saved per
  example** (ui-demo 30.96 → **30.46 kB** — headroom 40 B → ~540 B; `.size-limit.json`
  deliberately unchanged, nothing loosened). Two enabling fixes recorded:
  `monotonicNowSeconds` carries `/* @__PURE__ */` (a bare top-level call otherwise
  survives tree-shaking), and `Application` stores `options.now` as given rather than
  pre-resolved (the default lives in a package production drops). Deliberately NOT
  gated: R-6's effect pipeline — `renderEffect` is a production feature; its 0.75 kB
  needs an opt-in registry split (recorded), not a dev flag.

### 2026-08-07 — §118 flagship: "One Scene, Everything Moves" (gap A-21, second half)

#### Added

- **`examples/flagship/one-scene-everything-moves` — the §118 flagship demonstration.**
  Every item on §118's list in one scene graph, one `Application`, one `PhysicsWorld`,
  one frame: a textured lit cube on a `MotionComponent`, a 2D vector orbit, a
  `SpringJoint` pendulum (spring period 0.5 s inside a 2.9 s swing, so it bounces
  _and_ swings), a bouncing body whose §29 landings drive a particle burst and a
  re-launch impulse, a motorised `HingeJoint`, two world-space labels (one rides the
  body), a `@fourjs/ui` panel parented to the camera (screen-space until §46 layers land
  — a second viewport would draw the whole scene twice; documented), a §16 `Timeline`
  with a lap marker, and pause / slow-motion / single-step controls, keyboard-operable.
  **First example to use the §62/§37 registries** (`renderer: "auto"`,
  `solver: "auto"`) and **first to assemble the §113 debug overlay** from the R-35
  streams. Eighth Vite site and Playwright server (port 4180); budget 1.65 MB gzip
  (measured 1.54 — `registerRapierSolver()` carries both wasm images; a per-dimension
  registration is the recorded fix).
- **`tests/browser/one-scene-everything-moves.spec.ts`** (6 tests; browser 43 → 49) —
  measures rather than asserts: a hue census of six objects in one frame; ~27 000
  changed pixels running vs **exactly 0 paused** (the strongest available proof that
  §10's pause is `timeScale = 0` and nothing else writes); one single step advancing
  `sim` by exactly 1/60 s; the overlay's colours 0 → 315; the slider's minimum
  accruing 0.05 s of simulation per wall-clock second vs 1.000 at full speed;
  Tab/Home/End/Enter through §75 with `source: "keyboard"`.
- **`check-compat` CI fix**: the generator treated every export ending in "Adapter" as
  a constructor, so 191ee41's factory `createRapierAdapter` turned the gate red;
  adapter detection now also requires an upper-case initial. Found by this packet's
  gate run.

#### Changed

- `docs/AUDIT-120.md` examples row 7 → 8; S-8 narrowed to the three §93 stand-in
  scenes and §119's motor twin. `examples/README.md`, root `README.md`,
  `website/README.md` + `website/index.html` (which also gained the missing
  `first-3d-scene` row and now leads with the flagship), and `docs.yml`'s EXAMPLES
  list updated; `tools/check-docs.mjs` pins move to 8 runnable / 4 placeholders.

### 2026-08-07 — A-5 (accounting tier): §83 resource accounting; two §84 counters live

#### Added

- **§83 resource accounting (gap A-5).** `BufferGeometry.byteLength`,
  `Texture.byteLength`, `RenderTarget.byteLength` (colour + the backend's real
  `DEPTH_COMPONENT16` when `depth`), and process-wide live totals:
  `geometryMemoryBytes()`/`liveGeometryCount()` (`@fourjs/geometry`),
  `textureMemoryBytes()`/`liveTextureCount()`/`liveRenderTargetCount()`
  (`@fourjs/render`). **Leak-safe by holding numbers, not references** (a tracker
  retaining its resources would _be_ the leak; a `WeakRef` registry answers "was this
  collected?", not §83's "was this disposed?"). A resource dropped without `dispose()`
  stays billed — a counter that healed itself on GC would hide the only thing it
  exists to show. One rule ("a disposed resource holds nothing": `byteLength → 0`)
  makes double-dispose, resurrection-by-setter, and delta arithmetic fall out with no
  call-site special cases. `recordResourceMemory` in `@fourjs/diagnostics` is the §84
  bridge — deliberately two numbers, not a transcribed record (no producer-owned shape
  exists, so the seam is allocation-free by construction; the duck-typed-contract
  count stays at five).

#### Changed

- **`app.stats.textureMemory` and `.bufferMemory` are measured** rather than staged
  `NaN`; staged counters drop five → three. Both are **levels** (the first
  `FrameStats` fields describing the engine, not the frame), reported with or without
  a renderer, and are an accounting of what the engine _holds and would upload_, not a
  driver query — stated on the fields. No backend file changed; the GL sequence is
  byte-identical (structural: `render-webgl` untouched; also proven by the recording
  rig). Size: +0.22 kB gzip; ui-demo at 30.96/31 kB — A-4's `__FOUR_DEV__` define is
  now the practical blocker for the next `four`/`ui`-touching packet.

### 2026-08-07 — §79 drawing-tier node types (A-16 remainder)

#### Added

- **`registerRenderSerializers()` in `four` (§47/§49/§55/§68, §79)** — node-type pairs
  for `Renderable` (`render:renderable`), `Sprite` (`render:sprite`),
  `PerspectiveCamera`/`OrthographicCamera` (`scene:perspective-camera`/
  `scene:orthographic-camera`), and `DirectionalLight` (`scene:directional-light`),
  chained into `registerSceneNodeTypes()` by the new exported `composeSceneNodeTypes()`.
  Cameras and the light serialize completely (projection parameters only — the matrices
  are derived, and `depthRange` is deliberately absent because it belongs to the
  renderer, so a document is not pinned to the backend that saved it); a sprite carries
  no geometry key because it derives and owns its quad. Type names follow
  `<package>:<class>` (the `ui:*` precedent) — the prefix is a namespace, not an import
  path.
- **`SceneResourceCatalog<T>` + `resourceCatalog(entries)` (§79 "referenced by logical
  key")** — geometry and material cross the boundary as **keys**, resolved by an
  injected catalog (`keyOf` out, `get` in; a bare `Map` satisfies the read half —
  proven). §79's manifest document (key → URL + content hash) stays staged behind A-18
  content hashing and will sit behind this seam, not replace it.
  `unknownResources: "throw" | "skip"` relaxes the **write side only** — there is
  deliberately no read-side skip (a `Renderable` cannot default its resources without
  inventing ones the application must dispose, §83). Material `kind` is checked for
  `Sprite` only — a read-side whitelist would make a consumer's `Renderable<GlowMaterial>`
  savable and unloadable; dispatch is on the §57 discriminant, never `instanceof`.
- All 14 `*_NODE_TYPE` constants are now re-exported from `four` (the six A-12 control
  names were missed when they shipped). No format change: `SCENE_FORMAT_VERSION` is
  unmoved and documents without these node types encode byte for byte as before.

### 2026-08-07 — RFCs 0001–0003 drafted (R-14, A-3, PH-10/R-22)

#### Added

- **`docs/rfcs/0001-shader-and-node-material-system.md` (§60, gap R-14)** — a
  serializable shader graph in `@fourjs/materials` as the unit of extension; **no user
  GLSL/WGSL at any tier**. The argument is R-5/R-6's opacity principle, not only §96: a
  source string makes every user §70 pass unvalidatable exactly where feedback and
  ordering mistakes live, while a graph keeps `RenderGraph.validate()` able to
  enumerate what a pass samples. Node materials are their own `RenderItemKind`,
  compiled lazily on first draw (R-19 byte-identity preserved) behind an explicit
  `registerNodeMaterialPipeline()`; `ScreenEffect` gains one member, `GraphEffect`.
  Status draft, owner decision pending.
- **`docs/rfcs/0002-plugin-system.md` (§81, gap A-3)** — `PluginContext` as a typed
  capability bag (`defineCapability<T>` tokens exported by each registry's owning
  package, since §3.1 gives `core` no dependencies and five of six registries live
  downstream). Five of §81's eleven extension points are real today, one partial, five
  absent — tabulated rather than stubbed. §96's plugin half answered narrowly: **no
  sandbox**, but untrusted content can never become a plugin (objects only, never
  specifiers), enforced by an integration test in the A-23 CSP-test style. Alternative
  E (do nothing; the registries stay ordinary package APIs) is argued as genuinely
  defensible and flagged for the owner rather than argued away. Status draft, owner
  decision pending.
- **`docs/rfcs/0003-skinning-and-skeletal-animation.md` (§54/§14/§17, gaps PH-10 +
  R-22)** — the §3.1 matrix decides the split: joints/weights as `BufferGeometry`
  attributes at locations 4/5 (continuing R-19's numbering), `Bone`/`Skeleton` as
  scene-graph nodes (§42 authority, §19 blending, and §79 serialization then need no
  new mechanism), skinned draws as a separate lazily-compiled pipeline (a vertex-stage
  branch would tax every unskinned draw). Two findings: §54's `morphTargetWeights` on
  `Mesh` is **unanimatable under §3.1** and becomes a `@fourjs/scene` component; §17's
  two "missing track types" are binding gaps, not `ValueKind` gaps. Status draft,
  owner decision pending — bone-axis convention is the named question.

### 2026-08-07 — A-8/R-2/PH-19 closed: `renderer: "auto"` and `solver: "auto"`

#### Added

- **§62 renderer registry and §37 solver registry (A-8/R-2/PH-19, closed together).**
  Backends and solvers register themselves into a neutral host via an **explicit call**
  (`registerWebglRenderer()`, `registerRapierSolver()`) — never a side-effect import,
  which `"sideEffects": false` on all 24 packages makes _correctly deletable_ by any
  bundler; `four` and `@fourjs/physics` still import no backend and no solver. `"auto"`
  walks §62's WebGPU → WebGL 2 → Canvas 2D → SVG order for renderers (registration
  order deliberately not consulted — §33; the headless tier is never auto-selected;
  fallback past a rejecting `initialize` disposes what it built and reports each skip
  through `onFallback` — §62's diagnostics event as a callback, since §3.1 gives
  `render` no diagnostics edge) and **registration order filtered by §37 capabilities**
  for solvers (§37 fixes no preference; inventing one would editorialize). A named
  backend/solver fails fast; every failure names what _is_ registered (§85), with
  structured `context.tried`. `ApplicationOptions` gains `antialias` (its TODO said it
  belonged with this packet), `onRendererFallback`, `rendererRegistry`;
  `PhysicsWorldInit` gains `solver`/`solverRegistry`/`onSolverReject` with `adapter`
  becoming the optional alternative (xor, both refusals loud).
- **Tree-shaking is a stated discipline, measured both ways**: `resolveRenderer`/
  `resolveSolver` never statically reference their registry class (a lazily-created
  module `let`), so an app naming a concrete instance keeps an eight-line resolver
  (+0.2–0.3 kB gzip) and drops the registry, the §62 order, the probes, and every
  backend (grep-proven: zero hits in all four bundles); `"auto"` costs 0.78 kB gzip,
  paid only by the app that asks (controlled A/B in the packet report).
- `isSupported` probes never touch the caller's canvas — a canvas serves one context
  per type, so a probing `getContext` would fix the attributes the backend later
  acquires, silently disabling `antialias`. The probe is an environment question;
  `initialize` is the real gate.

#### Changed

- `Application.renderer` is a **getter** — `null` until `initialize()` resolves a
  string selection; unchanged for an instance. The WP-3.6/§45 departure is **retired,
  not reversed**: §45's string form now works, and `four` still never imports a
  backend.

### 2026-08-07 — PH-9 closed (state-machine tier): §18 `AnimationController`

#### Added

- **`AnimationController` in `@fourjs/animation` (PH-9, §18)** — declarative states over
  clips; transitions with **typed conditions** (`{parameter, is, value}` — all six
  numeric comparisons, Booleans, latched triggers; the string DSL `"speed > 0.1"` was
  deliberately not built: a parser is a second §33 surface, staged as optional sugar),
  cross-fade `duration`, `exitTime` in **seconds of source-state time** (§7a — a gate,
  not a trigger instant), and transition interruption (the outgoing pose is frozen per
  channel through the same blend path, so the frozen pose is exactly what the next
  write would have produced). Seven of §18's nine features ship; blend trees and
  layered/additive animation are staged with dated notes, with clip events and
  "any state" transitions.
- **The controller is a pose evaluator, not a mixer scheduler** — §18's cross-fade
  needs two clips writing one property at once, which the mixer's claim semantics
  define as a conflict; so the controller owns one _channel_ per animated path,
  samples source and destination into scratch, mixes through the channel's
  `ValueAdapter`, and writes once under one claim in the **same** §16 registry
  (controller-vs-tween still resolves by the single rule). A state with no track for a
  channel contributes the baseline captured at `play()` — the pose is a pure function
  of (state, time, weight), and fades over partially-animated channels don't snap.
  Consequence stated: a controller pins every channel it owns. No `seek` — a machine's
  pose is a function of history; §34 replays it by replaying deltas.
- **New determinism golden** `tests/determinism/golden/animation-controller.json` —
  600 fixed steps, four states, six transitions, scripted parameter schedule; two
  in-process runs and a fresh child process all byte-identical; all-`"linear"` tracks
  keep the arithmetic transcendental-free so a mismatch means the controller changed.
  **No existing golden touched.**

### 2026-08-07 — R-6 closed (full-screen effect tier): §70 post-processing

#### Added

- **§70 post-processing at the full-screen effect tier (R-6).** `@fourjs/render` gains
  `EffectRenderPass` — a **third `RenderGraph` pass kind**, not an escape-hatch pass:
  a pass whose sampling is a _field_ (`source`) is validated exactly with no traversal,
  the inverse of the `CustomRenderPass` opacity problem — plus the **closed**
  `ScreenEffect` union (`"copy"`, `"grade"`: exposure → contrast → saturation),
  `COPY_EFFECT`, `COLOR_GRADE_DEFAULTS`, `validateEffectRenderPass`,
  `supportsScreenEffects`, and the optional `Renderer.renderEffect` (presence is the
  capability, the A-1 stance). `@fourjs/render-webgl` gains `EffectProgram` — a
  full-screen-triangle pipeline compiled at initialization beside the other four (§61
  forbids compiling inside a frame) — and `WebglRenderer.renderEffect`, with all state
  borrowing inside the F13 envelope. Ping-pong chains between two `RenderTarget`s are
  the supported form; copy is **bit-exact** (a chain of copies issues zero uniform
  traffic), which is what makes the blit usable as §63's future debug view. Closed
  unions are the staging mechanism: `{ kind: "bloom" }` is a compile error today, and
  the backend _skips_ an unknown kind rather than quietly copying. Eight §70 effects
  are staged, each naming the resource it waits on (tone mapping → §60a + float
  targets; bloom → transient pool; AA/DoF/motion blur/SSAO → MSAA/samplable
  depth/MRT; outlines → R-7/§71; user shaders → R-14's RFC; distortion → second input).
- **The no-post GL path is unchanged** — `renderEffect` is a separate entry point, so
  `render`'s body was not edited at all; the steady-state frame transcript is
  call-for-call identical to the pre-R-6 build (pinned as a literal in
  `tests/integration/render-effects.test.ts`, handle-aliased) modulo the constant
  serial shift of the six objects the fifth program mints.

#### Changed

- **ui-demo's size budget: 30 → 31 kB (owner-recorded cost).** A fifth
  compiled-at-init pipeline costs 0.75 kB gzip per example bundle, and the conflict is
  structural, measured, not code golf: **even a stubbed `renderEffect` exceeds the old
  limit by 99 B** — "compile at init" (§61) and the 30 kB budget were provably
  incompatible; ui-demo sat at 98.9% of budget before this packet. `@fourjs/render`'s
  half tree-shakes completely (grep-verified: zero effect bytes in bundles); the GL
  half cannot (nothing reachable from a class method tree-shakes — second instance of
  A-1's cannot-tree-shake class; A-4's `__FOUR_DEV__`/opt-in seam is the recorded
  eventual fix). The §86 spec budget (150 kB) is untouched and distant.

### 2026-08-07 — A-2/PH-13 closed: §40 `UnitSystem` (display/authoring conversion only)

#### Added

- **§40 `UnitSystem` in `@fourjs/core`** — `UnitSystem`, `SI_UNITS`, `resolveUnitSystem`
  (returns the shared frozen `SI_UNITS` with zero allocation when given nothing),
  `{angle,time,length,mass}{To,From}Display`, the SI accessors §101 will read
  (`worldLengthToMeters` …), `unitSymbol`, and `format{Length,Mass,Time,Angle}`.
  **Declaring a unit system changes nothing the engine computes** — every API signature
  stays radians, seconds, and world units (spec rev 1.3's narrowing, quoted in the
  module header). §85 validation refuses selectors outside §40's unions and non-finite/
  non-positive scale factors — refused, not clamped. The two under-specified points
  were decided, not guessed: `"custom"` means "the display unit _is_ the world unit"
  (exact identity) and gets no symbol (§40 supplies no label field).
- **The display-only rule is enforced mechanically**:
  `tests/integration/units-display.test.ts` fails if any package source outside
  `@fourjs/core` imports the module (visible `ALLOWED` allowlist), and proves authoring
  through the helpers is **bit-identical** to authoring in engine units on a real
  motion command — because the conversions are measurably inexact in their last bits
  (8.8% of degree round trips, 2.5% of millisecond ones), a solver calling them would
  diverge from its own replay (§33–§34). Closes gap items **A-2 and PH-13** (one item,
  filed twice). No `ApplicationOptions.units` — §45 does not list one, and adding it
  would be inventing API. Staged with dates: §101 unit application in physics, §79
  header serialization (after A-16), text parsing. The units guide's "no `UnitSystem`
  API has shipped" honest-state paragraph is corrected in place, dated.

### 2026-08-07 — R-5 closed (linear-pass tier): the §63 render graph

#### Added

- **`RenderGraph` in `@fourjs/render` (R-5, §63)** — an ordered, named, individually
  enableable list of render passes executed by one `execute(renderer, interpolation?)`
  call, each pass one `renderer.render(root, views, interpolation, target)` over R-4's
  seam — asserted **transcript-identical** to the hand-written calls it replaces, which
  is what makes adopting the graph a refactor rather than a rendering change. Ships
  §63's pass dependencies (declared `inputs` validated at `addPass` — **acyclicity by
  construction**: an input must name an already-added pass and insertion order is
  execution order, so cycles are unconstructable — plus a discovered sampled-target
  check: `validate()` runs the real `buildRenderList` and reads the
  `isRenderTargetTexture` marker, seeing exactly what the backend sees), pass
  enable/disable (a disabled pass issues zero GL), per-pass viewports, and a textual
  `describe()`. Clear policy stays on `Viewport.clearColor` (§48) — which is exactly
  what makes a compositing pass expressible. The `CustomRenderPass` escape hatch always
  reports an `"opaque"` validation issue, so an unchecked graph says so instead of
  returning a clean bill it did not earn. Transient targets, resource lifetimes, and
  barriers staged with dated reasons; the module tree-shakes out of every example
  bundle (byte-identical md5s, `RenderGraph` absent from all seven).
- **R-6 (§70 post-processing) is now unblocked** — effects are graph passes.
- Correction recorded against the R-4 note: "feedback loops are refused, not drawn"
  holds for **sprites** (draw skipped); an `UnlitMaterial`/`LitMaterial` sampling its
  own target has the `map` refused but the draw survives untextured — one rule for the
  sample, two outcomes for the draw. The `"feedback"` issue documentation states this
  accurately.

### 2026-08-07 — PH-5 closed: runtime collider add/remove

#### Added

- **`PhysicsWorld.addCollider(collider)` / `removeCollider(collider)` (PH-5)** —
  register and unregister **one** `Collider` on a body the world already holds, without
  re-creating the body: its solver handle, monotonic id, §33 checksum position, joints,
  and pose all survive (which `removeBody` + `addBody` destroyed). Which body a collider
  joins is `Collider.requireBody()` — §24's own resolution, the same predicate
  `addBody`'s subtree scan applies, so there is no second rule and no `node` parameter.
  Explicit by design (the `refreshCollider` precedent; a diffing `refreshBody` would be
  a second rule _and_ a per-step cost). `removeCollider` returns `false` like
  `removeBody`/`removeJoint` (unconditional teardown); `addCollider` throws with §85
  refusals that all run before the adapter is touched.
- **Mass is re-established in both directions**, proven against the structural double
  and against real Rapier in both dimensions: a derived-mass body gains and loses
  collider contributions and, left with no collider, stops reporting a mass at all
  (`derivedMass` clears **only at zero colliders** — §23 forbids reading a solver's 0 as
  "no mass"); an authored mass survives, carried by PH-3's heir when its collider goes,
  created massless on the new collider. **The adapters needed nothing** — F8's kept
  `destroyCollider` mass refresh was written for exactly this body-survives case — and
  **§34 snapshots needed nothing**: the envelope's collider table already re-derives
  each body's collider list, proven by bit-identical restore + replay checksum streams
  across a runtime add and a runtime remove.
- Determinism: goldens unchanged; a world that never adds or removes makes the
  identical solver calls (deep-equal call sequences + identical 40-step checksum
  streams). PH-1's "refreshCollider refuses a post-registration collider" blocker is
  lifted; a pending refresh is dropped with its collider; `#warnUnhonouredMaterials`
  split per collider so `addCollider` warns for the new one only.

### 2026-08-07 — PH-1 stage 2: §37 property changes reach the solver

#### Added

- **`SolverBodyTuningAccess` (`@fourjs/physics`)** — the §37 seam for post-registration
  property changes: `setBodyMassProperties`, `setBodyDamping`, `setBodyGravityScale`,
  `setBodyCcdMode`, `setColliderMaterial`, `setColliderFilter`. Optional and
  **structurally detected** (`supportsSolverBodyTuning` / `missingSolverBodyTuning`),
  **all-or-nothing** across the six methods, on the `SolverJointAccess` precedent —
  `PhysicsCapabilities` stays frozen and an adapter implementing none of it is still a
  legal `PhysicsWorldAdapter`. Both Rapier adapters implement all six (the live mass
  write re-runs `resolveMassMode` and rewrites `BodyRecord.massMode`, so a live `mass`
  and a re-registration converge and PH-3's heir logic keeps working).
- **`PhysicsWorld.supportsLiveProperties`** (readable before registration — a tuning UI
  can disable sliders instead of learning from a warn), **`refreshCollider(collider)`**
  (explicit by design — §24/§25 fields are plain public data that cannot be
  intercepted), **`teleport(node, position, rotation?, wake?)`** (§37's "teleports"
  finally has a stable-API route), **`RigidBody.markMassPropertiesChanged()`**,
  **`pendingSolverWrites`** (a bit set — §23's triple is one bit, the damping pair one),
  **`liveSolverWriteWorldCount`** (a body in two worlds where one can't carry the write
  still warns, because that is the truth).

#### Fixed

- **`mass`, `linearDamping`, `angularDamping`, `gravityScale`, and `ccdMode` written
  after `world.addBody` now reach the solver** at the top of the next fixed step —
  before commands and kinematic feed, so a force applied the same frame as a mass change
  acts on the new mass — and a `Collider`'s §25 material / §24 filter does too via
  `refreshCollider`. The `rigid-body.ts` truth table is now a two-column table (adapter
  with seam / without), dated; warn-once machinery stays exactly where a write is still
  unreachable. `mass = undefined` is documented as **permanently** unreachable (not
  staged): un-authoring means restoring collider densities only the registration path
  holds.

#### Changed

- Determinism: the drain walks ascending body id, ascending collider id within a body,
  seam-declaration order per body; draining clears, so a body in two worlds hands its
  writes to whichever steps first (§26's command-buffer semantics). **A quiet world makes
  no extra solver call** — asserted by deep-equalling adapter call sequences — so every
  §33 golden is byte-identical.

### 2026-08-07 — A-1 closed (measurable tier): §84 runtime statistics

#### Added

- **§84 runtime statistics (gap A-1).** `@fourjs/diagnostics` gains `FrameStats` — §84's
  **eleven** counters (the gap entry said twelve; the spec lists eleven, pinned by a
  test) — with `createFrameStats`/`resetFrameStats`/`copyFrameStats` (out-param),
  `recordRenderStatistics`, `recordSolverStatistics`, and `createMonotonicClock`.
  `@fourjs/render` gains `RenderStatistics` and an **optional `Renderer.statistics`
  capability — presence is the capability** (the `RendererCapabilities` stance applied
  to counters; a backend that cannot count omits the member instead of reporting
  zeros); `@fourjs/render-webgl` counts the draw calls, triangles, and instances it
  actually **submits** (a skipped geometry, disposed texture, zero-particle system, or
  lost-context frame counts nothing). `Application` gains `stats: FrameStats | null`,
  opt-in via `ApplicationOptions.stats` (default off) with an injectable `now` clock —
  closing the `app.stats` slice of A-6. Renderer counters reach diagnostics through a
  structural transcription (fifth duck-typed-contract instance), no §3.1 edge.
- **A field reading `NaN` was not measured; `0` was measured zero** — the rule that let
  §84 ship before all its producers: `gpuFrameTime` (§62 timestamp queries),
  `physicsStepTime` + `contacts` (`PhysicsWorld.step`'s to report), `textureMemory` +
  `bufferMemory` (A-5's ownership tracking) are staged as `NaN`-with-a-reason and
  test-asserted to stay `NaN` so none can quietly start reading 0. `Date.now` is banned
  repo-wide (§33), so the clock has **no fallback** — a host without `performance`
  measures nothing rather than measuring badly.
- **Statistics off is byte-identical in GL calls and allocation-free** — proven at unit
  and application level (recorded-sequence equality, the F13/R-4 method's third
  survival) plus determinism traces with stats on vs off. Cost when off: one `!== null`
  per fixed step, frame, and draw. Honest size note: `Application`'s unconditional
  references cost ~0.3–0.5 kB gzip per example bundle (ui-demo at 29.68/30 kB) — A-4's
  `__FOUR_DEV__` define is the recorded fix.

### 2026-08-07 — R-4 closed: render targets, render-to-texture

#### Added

- **Render targets (R-4, §61/§48/§63)** — `RenderTarget`, `RenderTargetOptions`,
  `RenderTargetFormat` (one-member `"rgba8"` union — unsupported formats are a compile
  error), `RenderTargetTexture`, and `isRenderTargetTexture` in `@fourjs/render`;
  `Renderer.render` takes an optional fourth `target` argument; `RenderTargetCache`
  (FBO + RGBA8 colour texture + optional `DEPTH_COMPONENT16` renderbuffer,
  completeness-checked, version-keyed, loss-aware) in `@fourjs/render-webgl`.
  **`RenderTarget.colorTexture` satisfies `MaterialTexture`**, so an off-screen pass is
  sampled by assigning it to any material's `map`/`texture` — no adapter, and
  `@fourjs/materials` was not touched at all. Target depth defaults **on** (a depth-less
  target would composite the same scene differently off-screen than on). Feedback loops
  are refused, not drawn (a material sampling the target being rendered into is skipped;
  ping-pong between two targets is the supported form). `bindFramebuffer` lives inside
  the F13 `try`/`finally` envelope — a throwing target pass cannot leave the FBO bound —
  and every pre-existing exception-safety test now also asserts it.
- **A frame with no target issues no framebuffer call at all**: the on-screen GL
  sequence is byte-identical (449-call recorded comparison, the F13 method) and every
  pixel golden is unchanged; a permanent regression test pins the zero-framebuffer-call
  property. **R-5 (§63 render graph) and R-6 (§70 post-processing) are now unblocked.**
  Staged with dated notes: stencil (R-7), MRT, multisample, float formats, samplable
  depth (§69), `readPixels` (needs `Rectangle2` in `@fourjs/math`; §92 first consumer).
  Deviations from the gap doc's sketch, documented in source: the target rides on
  `render` rather than `Viewport.renderTarget` (scene was outside the change's file
  set), and §61's `createRenderTarget` factory stays deferred **by decision** — a render
  target is a CPU-side descriptor and the framebuffer a backend cache, the
  `GeometryCache`/`TextureCache` pattern.

### 2026-08-07 — A-12 cheap tier closed: six new §73 controls

#### Added

- **Six §73 controls in `@fourjs/ui` (gap A-12, the unblocked half)** — `Toggle`,
  `Checkbox`, `RadioButton` (exclusive by **group name scoped to the tree**, the same
  scope `focusedWidget` uses; enforced on the transition to checked only, never at
  construction or attach, so a §79 document reloads exactly as saved), `Slider` (§72
  pointer drag via `worldPoint` + inverse world matrix — what moves is a number, not the
  transform, so `DragManager` was deliberately not used; §75 arrows/Home/End; clamp →
  snap → step-back resolve rule), `ProgressIndicator`, and `ImageWidget` (named with the
  suffix because `Image` is a browser global; the widget owns box + §79 `source` key,
  the skin decodes and draws). Each ships complete: §72 pointer state, §75 keyboard
  activation, a `WidgetSkin` hook, §79 node-type pair (`ui:toggle` … `ui:image`) from
  `registerUISerializers`. **Nine of §73's sixteen controls now ship.**
- **`WidgetStateSnapshot.checked`** (`boolean | null` — `null` for non-checkable
  controls, ARIA's absent-vs-false distinction) and **`WidgetSkin.onContentChange`** (a
  fifth hook for value/`indeterminate`/`source` changes — neither layout nor §75 state).
  `UIWidget.captureState`/`publishState` are now `protected`; `Button.willActivate()` is
  the pre-emit hook so `uiactivate` listeners read post-flip state (DOM order). All
  additive.

#### Changed

- **`UI_STAGED[0]` narrowed** to the genuinely blocked names, each with its blocker:
  text input (§56 selection/caret), scroll view + virtual list (§74 overflow + §67
  clipping), embedded 3D viewport (§48), canvas view, menu + tooltip (a hover delay is a
  §9 time reading widgets cannot reach), list (selection model + overflow).

### 2026-08-07 — R-35 closed: the §84/§113 debug overlay draws (+ review F7)

#### Added

- **`@fourjs/diagnostics`: `debugDrawStreams(buffer, out?)` + `applyDebugDrawStreams`
  (R-35)** — de-interleaves a `DebugDrawBuffer`'s 7-float layout into exactly-sized
  `positions`/`colors` `Float32Array`s whose field names spread straight into
  `BufferGeometryOptions` (`new BufferGeometry({ ...streams, mode: "lines" })` is the
  whole bridge — no new §3.1 edge; the duck-typed-contract pattern's third instance,
  after `ParticleDrawable` and `ReplayTarget`). With R-19's `colors` attribute and
  `vertexColors` material flag, the whole overlay is **one draw call** at any segment
  count — proven end to end in `tests/integration/debug-overlay-render.test.ts`.
  Supporting surface: `writeColors`, `colorFloatLength`, `DEBUG_COLOR_FLOATS_PER_SEGMENT`,
  `DebugGeometrySink`. `DEBUG_DRAW_STAGED` loses `"per-segment-colored-draw"`; the two
  survivors are still genuinely seam-blocked.

#### Changed

- **`REPLAY_FORMAT_VERSION` renamed (review F7)** — `LATEST_REPLAY_FORMAT_VERSION` (2)
  and `MINIMUM_REPLAY_FORMAT_VERSION` (1) say what became true when PH-6's
  lowest-version-that-expresses rule landed; the old name stays as a deprecated alias.
  **No document bytes changed** — asserted by a test, not assumed; goldens bit-identical.
  Doc mentions across Architecture/COMPATIBILITY/guides updated.

### 2026-08-07 — Render-tier review fixes: exception-safe GL state, validated material writes

The remaining four findings from the adversarial closure review (F13–F16), re-verified
against HEAD after R-19/R-20 moved the code around them.

#### Fixed

- **`@fourjs/render-webgl`: a mid-frame exception no longer corrupts rendering permanently
  (F13).** The §57 GL state mirror moved from module scope onto each `WebglRenderer`, and
  `render` wraps its draw work in `try`/`finally` so the state restore, texture unbind,
  and vertex-array unbind always run. Previously any throw from application code (a
  material or geometry accessor, a disposed texture) abandoned the borrowed GL state while
  every later frame asserted the defaults — one transient error left the scene drawing
  blended, masked, or depth-testless, silently and forever. R-19 had widened the leak (a
  bound texture and selected unit also escaped). The happy-path GL sequence is
  **byte-identical, proven** — 449 recorded calls across all four pipelines compared
  against the previous implementation — and the new regression tests fail on the old code
  (verified against a baseline copy). The R-19 program-lifetime uniform mirrors were
  audited and deliberately left alone: they belong to the program object, as does the
  uniform they track, so they survive a throw correctly.
- **`@fourjs/materials`: `opacity` and `blendMode` validate on assignment, not only at
  construction (F14).** `material.opacity = NaN` used to reach `uniform4fv`; `blendMode`
  was never validated at all. Both are now accessors applying the constructor's rules
  (§85 finite; §57's modes), rejecting before the first write. Out-of-range opacity still
  passes unclamped and neither bumps `Material.version` — both unchanged, deliberate,
  with the superseded doc wording quoted in place.
- `restoreGlState` no longer passes a blend mode its helper ignores (F15); the dead
  `BLEND_FUNCTIONS` fallback is removed now that `blendMode` is provably total, and the
  remaining defensive material reads are documented as guarding structurally-typed test
  doubles and the material-less particles path (F16).

### 2026-08-07 — S-8 half-closed: `examples/first-3d-scene`, the first 3D browser proof

#### Added

- **`examples/first-3d-scene`** — §93's first 3D scene and the first example of any kind
  to construct a `PerspectiveCamera` or draw a `LitMaterial`: two **identical** spheres
  (one geometry instance, one material instance — the projection is the only variable) at
  different depths, a torus spun by a §38 `MotionComponent`, a capsule bobbed by a §15
  tween, and a ground plane, all under one `DirectionalLight` plus `Scene.ambientLight`
  (§47, §53, §57, §68). Non-wasm, 23.31 kB gzip; seventh Vite site and preview server
  (port 4179), `.size-limit.json` budget 28 kB.
- **`tests/browser/first-3d-scene.spec.ts`** (5 tests; browser total 38 → 43) — measures
  rather than asserts: the near sphere covers **4.04×** the pixels of the identical far
  one (an orthographic camera scores exactly 1.0; the §47 prediction was 4.1), and each
  sphere's lit quadrant is 3.0–3.7× brighter than its shadowed one with the §68 ambient
  term keeping the dark side above the background.

#### Changed

- `docs/AUDIT-120.md` examples row 6 → 7; **S-8** restated as partially closed (five
  placeholder directories remain) with its superseded wording quoted and dated;
  `examples/README.md`, root `README.md`, `website/README.md`, `docs.yml`'s deploy list,
  `docs/guides/README.md`, and `docs/guides/cameras-and-coordinate-conversion.md`
  corrected in place — "no example exercises a perspective camera" stopped being true on
  this date. `tools/check-docs.mjs`'s retired-claim reason updated to match (now pins
  seven).

### 2026-08-07 — Closure-review fixes: 24 findings from the adversarial pass over the wave commits

An adversarial code review of the five landed closure batches (93cda8d, ab13840, fe8eb6f,
c843e2d, b48f053) produced 25 verified findings; the 24 whose files were free are fixed
here (the render-tier `glState` findings land separately). Each behavioral fix carries a
regression test; each doc contradiction now has doc and code agreeing, with dated in-place
corrections.

#### Fixed

- **`KinematicController` has a §79 serializer** and `registerSceneNodeTypes` registers it
  — a scene using the component could not be saved at all after A-15's throw-by-default
  (the right default, which obliges the umbrella to cover every shipped component). The
  payload is deliberately empty (`{}`): the class has no constructor options, in-flight
  commands are §79-excluded simulation state, and `followPath` holds a live `Trajectory`
  no document can name. **Registry completeness is now enforced mechanically**: an
  enumerating test walks every umbrella barrel for `static typeName` classes and requires
  each to be registered — a sixth component must be registered or the suite fails.
- **Physics teardown no longer does O(N·M) discarded work**: `#destroyRegistration` issues
  one `destroyBody` (§37: "destroys a body and everything attached to it") instead of N
  per-collider destroys each running a full-world heir scan and a doomed mass
  recomputation; Rapier `BodyRecord`s keep a per-body `colliderIds` list so the heir
  lookup is O(1) anyway. Snapshot bytes unchanged; goldens bit-identical.
- **`wrap: false` keyboard traversal really leaves the widget tree** (it was a focus trap
  with an extra step: the next Tab re-entered via the root fallback and suppressed the
  host default). Leaving now costs the documented two keystrokes.
- **`Button` suppresses the platform default only when it consumed the key** — a disabled
  focused button no longer swallows Space's scroll while emitting nothing.
- **`PointerInput` no longer erases a gesture started from inside a `pointerleave`**
  (ending-state flag; a re-press during teardown mints a fresh entry, as the doc claimed).
- **`KeyboardInput` is inert after `dispose()`** (a retained surface listener no longer
  reaches the scene).
- **`Application` validates `options.resolution` on the resolution-only path**
  (`resolution: 0` reached `renderer.resize` unchecked).
- **`reserveNodeId` no longer saturates at `MAX_SAFE_INTEGER`** (a hostile id then handed
  every subsequent node the same id — the exact collision the guard exists to prevent).
- **A malformed `inertiaTensor` in a §79 document is refused loudly** instead of silently
  switching the body to collider-derived rotational inertia (a §33 checksum divergence
  with nothing to point at).
- Doc corrections: the fabricated §61 quotation about camera aspect is restated as the
  A-7 decision it was (citing §47/§48), and `resize` is §45's seventh method, not eighth.

#### Changed

- `RigidBodyDocument.sleeping` is now optional on the read side (write side still emits it
  — bytes unchanged); it is write-only diagnostics and says so.
- `dispatchThreePhase` type-pairs its two listener keys (`capture:pointerup` with
  `keydown` no longer type-checks); drift warnings fire only on real value changes
  (self-assignment no longer burns the one-shot warn slot); `RigidBody.#massAuthored`
  deleted (derived from `#mass !== undefined`); keyboard traversal allocates its focus
  order per keystroke, matching `PointerInput`'s stated re-entrancy discipline.

### 2026-08-07 — A-23 closed: §96 untrusted-content limits enforced and tested

Asset loads and document decoders now enforce input-size limits and a deadline, and the
CSP posture is documented and mechanically tested. `grep -rn "§96"` went from zero source
citations to 40+.

#### Security

- **`@fourjs/assets`**: `AssetManagerOptions.maximumBytes` (default 64 MiB) checked against
  `content-length` **before** the body is read _and_ against the body a loader actually
  reads (a lying header is caught by the second check — tested), and `timeoutSeconds`
  (default 30, injectable `TimerLike`; seconds per repo convention — milliseconds appear
  only at the platform boundary parameter) covering transport and decode together.
  Refusals are `ASSET_LOAD_FAILED` with `context.limitName`/`.limit`/`.observed`, uncached
  and retryable. This closes the **deadline half of A-18** (a stalled load can no longer
  pin a refcount forever); caller-driven abort remains, with its compatible design
  (`FetchLike<TSignal>` + injected abort handle) recorded in `asset-manager.ts` — the
  naive `signal` widening is proven incompatible with `typeof fetch`.
- **`@fourjs/serialization` / `@fourjs/diagnostics`**: new `decodeSceneDocument(text, limits?)`
  (§79) and `decodeReplayRecording(text, limits?)` (§34) route through `@fourjs/core`'s new
  `parseUntrustedJson` — `maximumTextLength` (32 Mi code units) and `maximumDepth` (1024
  levels, walked **iteratively**: a recursive checker would overflow on exactly the input
  it refuses; the vulnerability is proven by tests showing the unguarded validators
  stack-overflow at 50 000 nesting generations). New §89 error code
  `UNTRUSTED_INPUT_REJECTED` separates "hostile input" from the validators' "malformed
  input". Guards live at the text boundary only — `validateSceneDocument` /
  `validateReplayRecording` are unchanged by design, which is what kept every golden
  byte-identical.
- **New guide `docs/guides/security-and-untrusted-content.md`** (§96 requirement table —
  met/partial/absent, honestly — and the CSP posture) and
  **`tests/integration/security-csp.test.ts`**, which fails if any shipped source gains
  `eval`, `new Function`, a string-argument timer, `innerHTML`/`document.write`, or
  `style.cssText`; each matcher self-tests against a positive example so it cannot rot
  into a no-op.

### 2026-08-07 — R-19 + R-20 closed: §53 vertex attributes, textured meshes, nine 3D primitives

The render tier's two keystone gaps close together. Until now a mesh could not be textured
at all (only `Sprite` sampled a texture, deriving uv from position) and the 3D primitive
set stopped at box/plane.

#### Added

- **`BufferGeometry.uvs` / `.colors` (R-19, §53)** — on the `normals` precedent exactly:
  optional, index-aligned, §85-validated on assignment, version-bumping setters, dropped by
  `dispose()`. Uvs now ship from `boxGeometry` (per-face), `planeGeometry`, and
  `circleGeometry2D`. The remaining §53 attributes (tangents, second uv, joints/weights,
  instance transform) stay deferred with the existing notes.
- **`UnlitMaterial.map` / `.vertexColors`, `LitMaterial.map`** — the texture contract is
  the new `MaterialTexture` (`packages/materials/src/texture.ts`); `SpriteTexture` stays
  exported as an alias, so `@fourjs/render`'s `Texture` is untouched. The lit map multiplies
  the base colour **before** the lighting term.
- **Nine 3D primitives (R-20, §53)** — `sphere`, `cylinder`, `cone`, `capsule`, `torus`,
  `lathe`, `extrude`, `tube`, `heightField`: Y-up, centred, CCW, analytic normals, uvs.
  `capsule.height` measures the cylindrical section only (§24's collider convention);
  `tube` uses a parallel-transported frame (Frenet flips at straight runs); `extrude`
  **rejects concave outlines when `capped`** (§85 — centroid-fan caps would draw folded;
  §52's tessellation module lifts this). Tests recompute face normals from positions as an
  independent oracle.
- **Vertex-colour unlit path (unblocks R-35)** — a `"lines"` geometry with per-endpoint
  colours draws as one call with `useVertexColors=1`; the §84/§113 debug-overlay data path
  now exists end to end.

#### Changed

- **Untextured scenes issue a byte-identical GL sequence.** The unlit/lit pipelines sample
  the map through a uniform switch on one program (`useMap`/`useVertexColors`, CPU mirror
  seeded at GL's initial `0`), not shader variants — a material naming neither feature
  issues no extra GL call. That property is what let this land under the pixel-golden
  gate. Attribute locations are now fixed: 0 position, 1 normal, 2 uv, 3 colour.
- `Sprite`'s derived-uv path is deliberately unchanged (the rewrite belongs to §55's atlas
  packet, which can retire `SpriteProgram`'s `quad` uniform with it — dated note in
  `sprite.ts`).

Gates: geometry/materials/render/render-webgl 96/57/130/211 unit tests; geometry and
materials at 100% coverage (kept), render 99.65 / render-webgl 99.55; suites 183
bit-exact; 38/38 browser with byte-unchanged visual goldens; TypeDoc 0; sizes within
limits (ui-demo 28.1/30 kB — 1.9 kB headroom left).

### 2026-08-07 — A-25: §94 release machinery built (publish stays owner-gated)

#### Added

- **Changesets, initialized by hand** (no `changeset init`, no lockfile change):
  `.changeset/config.json` (`baseBranch: main`, `access: public`, `linked` groups for the
  render and physics families) plus a README recording the repo-specific rules — including
  the discovered blocker that **the five reserved stubs cannot be `ignore`d** while the
  umbrella `four` depends on and re-exports them (Changesets validation refuses it,
  reproduced); they will publish unless the owner decides otherwise.
- **`tools/apply-publish-names.mjs`** + `node --test` suite — applies the §98 `@fourjs/*` →
  `@danielsimonjr/fourjs-*` mapping into a staging copy, never in place. It must (and
  does) rewrite **emitted code**, not just manifests: `dist/*.js`/`.d.ts` carry
  `from "@fourjs/core"` workspace specifiers (405 rewrite sites), and `workspace:*` ranges
  are resolved the way pnpm would. A test asserts the umbrella's 25 subpath exports
  survive the rewrite (§91 tree-shaking).
- **`.github/workflows/release.yml`** — reuses the whole of `ci.yml` via a new
  `workflow_call` trigger (a release clears exactly the PR gates), then `changesets/action`
  with publish inert unless `NPM_TOKEN` exists. **`.github/workflows/docs.yml`** — TypeDoc
  plus the six example sites (built with `--base=/four.js/examples/<name>/`, honoring the
  recorded subpath-hosting gotcha) to GitHub Pages. `website/` gains an honest README and
  a minimal static index.
- **`check-compat` wired** (A-26 follow-up): root script + a `ci.yml` step after
  check-docs, failing when an adapter capability declaration changes without
  `docs/COMPATIBILITY.md` being regenerated. `tools/README.md` now documents
  `check-docs.mjs`, `generate-compatibility.mjs`, and `apply-publish-names.mjs`.

### 2026-08-07 — A-26 closed: §90 compatibility tables published

#### Added

- **`docs/COMPATIBILITY.md`** — §90's five compatibility tables, published for the first
  time (gap A-26): browser/runtime support split into _verified_ versus _expected_ (Firefox
  and Safari are explicitly marked untested), §62 render-backend tiers, the physics solver
  adapters, scene/replay/snapshot format versions with the PH-6 lowest-version rule, and
  the plugin API (n/a — §81 unimplemented, gap A-3).
- **`tools/generate-compatibility.mjs`** — emits the solver-adapter block of that document
  from the adapters' own §37 capability declarations, read off constructed instances of the
  built packages, with `SolverBodyAccess` / `SolverJointAccess` probed structurally against
  `@fourjs/physics`'s emitted declarations. `--check` fails when the committed document has
  drifted; adding a third adapter adds a column with no tool edit.

#### Changed

- `docs/Architecture/ARCHITECTURE.md`, `docs/guides/custom-solver-adapters.md`, and
  `docs/rfcs/0000-template.md` now point at the published tables instead of anticipating
  them; `README.md` and `docs/guides/README.md` index the document.

### 2026-08-07 — A-10 closed, A-13 keyboard half closed: `KeyboardInput` + UI traversal

The gap analysis's A-10 ("`@fourjs/input` has exactly one input source") and the keyboard half
of A-13 ("`WidgetAccessibility` is fully inert") close together, because they are one
feature: keys enter through `@fourjs/input` and land on the focused widget through `@fourjs/ui`.
Focus crosses that boundary as an **injected resolver** (`focusTarget(): Node | null`),
never an import — §3.1's one-way `ui → input` edge stays frozen.

#### Added

- **`KeyboardInput` in `@fourjs/input` (A-10, §70, §72)** — the keyboard analogue of
  `PointerInput`: a duck-typed `KeySurface` (satisfied by `window`, `document`, or a plain
  test object; no DOM lib type named anywhere), `SceneKeyEvent` (`keydown`/`keyup`, `key`,
  `code`, grouped `modifiers`, `repeat`, plus `preventDefault()` forwarded to the platform
  event via `KeyDefaultSuppressor` — Tab and Space mean something to the host), and
  `dispatchKeyEvent`. `NodeEventMap` gains `keydown`/`keyup` + `capture:` pairs by the same
  declaration merging the pointer events use. `keypress` is deliberately absent (documented).
- **`propagation.ts` in `@fourjs/input`** — the three-phase machinery generalized out of
  `pointer-events.ts`: `SceneInputEvent` (abstract `target`/`stopPropagation` base),
  `buildPropagationPath`, `dispatchThreePhase(event, path, type, captureKey)`. Listener keys
  are parameters, not string concatenation, so `emit` stays fully checked with no cast.
  `dispatchPointerEvent` / `ScenePointerEvent` / `buildPropagationPath` keep their exact
  public surface — no import path changed.
- **Keyboard traversal in `@fourjs/ui` (A-13, §75)** — `collectFocusOrder` (prune rules of
  `collectPickables`; ascending `accessibility.tabIndex`, scene order on ties; negative
  `tabIndex` opts out of traversal but stays programmatically focusable),
  `keyboardFocusTarget(root)` (the resolver for `KeyboardInput`; falls back to the root so
  the first Tab is deliverable), `installKeyboardTraversal(root, { wrap })` for
  Tab/Shift-Tab, and `Button` activation on Enter/Space with `source: "keyboard"`
  (`WidgetActivationSource` widened with `"keyboard"`). One stated DOM deviation: `tabIndex`
  sorts plainly ascending — no positive-before-zero rule, which exists only because HTML
  interleaves with a document order this tree can see directly.

#### Changed

- **`UI_STAGED` shrinks by one**: the §75 keyboard-navigation entry is deleted;
  `WidgetAccessibility.tabIndex` is live. DOM mirror, screen-reader/high-contrast/scalable
  text, and reduced-motion entries remain, verbatim.
- **`examples/ui-demo` drops its page-level `keydown` workaround** (20 lines → 2:
  `new KeyboardInput(window, { focusTarget: keyboardFocusTarget(uiRoot) })` +
  `installKeyboardTraversal(uiRoot)`). No visual change; `tests/browser/ui.spec.ts` now
  asserts `source: "keyboard"` and covers Shift-Tab and Space.

Gates: input 115 + ui 128 unit tests (51 new), both packages 100% ×4 coverage; suites 176;
38/38 browser with byte-unchanged visual goldens; TypeDoc 0 warnings; ui-demo
28.1/30 kB.

### 2026-08-08 — docs: GAP ANALYSIS v1 (supersedes v0) + tracking-hole repair

#### Added

- **`docs/GAP ANALYSIS v1.md`** — the current-state re-analysis after the 2026-08-07
  closure campaign: 97 filings → **42 closed · 14 partially closed · 4 RFC-drafted ·
  37 open**, with verifiable pointers per claim, a re-prioritized attack order
  (§4.6), and a consolidated owner-decision register (§5, 14 questions with
  recommendations). Headline: the application tier is largely closed, simulation
  almost entirely, and **the rendering tier is now the project** (26 of 37 open items
  are `R-*` — every render keystone closed, almost no render feature). v0 stays as
  the historical record with a superseded pointer at its top.
- **Tracking-hole repair (v1's "tracking integrity" finding):** the two 2026-08-06
  batches below landed code with no CHANGELOG entry, no gap banner, and no TODO/MEMORY
  line — the analysis's own A-28 failure mode aimed at itself. Recorded now, verified
  in source by the v1 pass:

### 2026-08-06 — physics wave 1 (recorded 2026-08-08): PH-2/3/4/7/14/15/16 + PH-1 stage 1

Commit `ab13840`, previously unrecorded here. Both Rapier adapters' collider teardown
mass fix (PH-3: `#forgetCollider` decrements and re-homes authored mass to the
lowest-id heir), the 3D `#rebuildRegistries` §34 validity check (PH-7),
`#massAuthored`/`derivedMass` authority split (PH-4), `PhysicsTuningCapabilities` +
warn-once for accepted-but-unhonoured §25 fields (PH-14/15), the registered-body
`type`-setter warn (PH-16), `getBodyHandle`/`getColliderHandle` (PH-2), and
`rigid-body.ts`'s property truth table (PH-1 stage 1).

### 2026-08-06 — Material base (recorded 2026-08-08): §57 abstract `Material`, R-11, R-12/R-10 base tier

Commit `fe8eb6f`, previously unrecorded here. The §57 abstract `Material` base
(opacity/transparent/blendMode/depthTest/depthWrite/colorWrite, shared id counter,
abstract `kind`); `Renderable<M extends Material>`; the backend honouring render state
via CPU-mirrored change-only GL issuance (R-12 base tier); §66 key 2
(opaque-before-transparent) in `compareRenderItems` with default-opaque scenes
byte-identical (R-10 base tier); alpha/blending live for unlit materials (R-11 — the
dead `color[3]` field).

### 2026-08-06 — PH-17 remainder: shipped `RigidBody` / `Collider` serializers

Closes the follow-up the wave-1 entry below records as "deliberately not done". The §79
component serializers for the two physics components now ship from the package that owns
them, so a scene carrying physics saves and reloads through one umbrella call instead of
through a serializer copied out of a test helper.

#### Added

- **`RIGID_BODY_SERIALIZER` and `COLLIDER_SERIALIZER` from `@fourjs/physics` (PH-17, §23–§25,
  §79)** — with `serializeCollisionShape` / `deserializeCollisionShape` and the
  `RigidBodyDocument` / `ColliderDocument` / `PhysicsMaterialDocument` shapes. Declared
  against `ComponentSerializerShape`, the structural transcription `@fourjs/motion` already
  exports, **imported over the existing `physics → motion` edge** — so registering them into
  `@fourjs/serialization`'s registry needs no cast and adds no §3.1 edge, and the repository
  holds one transcription rather than two that can drift. The same honest cost applies:
  nothing type-checks it against `ComponentSerializer`, so a transcribed-mirror assignability
  test asserts it, as `@fourjs/motion`'s suite does.
- **`registerPhysicsSerializers()` on the umbrella `four` package** — registers both on a
  caller's registry and returns it. `registerSceneNodeTypes()` calls it, so one call now
  covers the §73 widgets, `MotionComponent`, `RigidBody`, and `Collider`; it stays separate
  so a headless simulation need not pull `@fourjs/ui` and `@fourjs/text` into its bundle (§91).

#### Changed

- **A physics scene no longer needs `{ unknownComponents: "skip" }` to save.** That opt-in
  was the loud-but-lossy stopgap the A-15 change left in place for physics components.
- **§25's fallback chain survives as a chain.** The WP-11.5 reference serializer wrote
  `effectiveFriction` / `effectiveRestitution` / `effectiveDensity`, pinning today's defaults
  into every document; the shipped one writes the §24 fields **as authored** and the
  `PhysicsMaterial` by value, so the same chain re-resolves to the same numbers on load and a
  later change to `DEFAULT_FRICTION` moves reloaded scenes exactly as it moves saved ones.
  A material round-trips by value, not by identity — two colliders sharing one material
  reload with one each, because sharing is a §79 _resource_ relationship.
- `RigidBody` documents also carry what the reference dropped: the §23 inertia tensor, the
  §37 initial pose (which outranks the node transform at `addBody`), and §31's
  `ccdPredictionDistance` — each written exactly when `toDescriptor()` emits it, so `mass`
  and `centerOfMass` stay absent for a body that asked the solver to derive them.
- `tests/integration/helpers/roundtrip-scenarios.ts` lost its ~400 lines of duplicate
  serializers and now calls the shipped registration; `scene-roundtrip.test.ts` gains a case
  proving a contact-free save reloads **bit-identically** — the control's §33 checksum stream
  element by element — through `registerSceneNodeTypes()` alone.

### 2026-08-06 — gap-closure wave 1 (A-7, A-9, A-14/PH-17, A-15, A-17, PH-6)

Six verified gaps from `docs/GAP ANALYSIS v0.md` closed, each with regression tests. Three
are correctness defects (a real memory leak, a save that silently lost state, an identity
collision), one is a missing §45 lifecycle method, and two are §34/§79 promises the code
contradicted.

#### Fixed

- **`PointerInput` no longer leaks a `Node`-pinning entry per dead pointer id (A-9, §72,
  §83).** Per-pointer state was inserted on demand and removed only by `dispose()`, so a
  surface that saw N touch or pen contacts — the platform issues a fresh `pointerId` for each
  one — kept N entries alive, each retaining `downTarget` and `captured`, both references to
  nodes the application had already removed from the graph. The entry is now torn down and
  deleted when the pointer ends. A 10 000-gesture regression test asserts
  `trackedPointerCount === 0` throughout.
- **A component with no registered serializer is refused on save instead of silently dropped
  (A-15, §79, §6a).** The writer walked the _serializer_ registry and probed each registered
  class, because `Node` offered no enumeration — so an unregistered component was unsaved and
  the omission could not be detected. `Node.components` (a four-line getter forwarding §6a's
  registry, which had exposed the iterator all along) closed it; `serializeScene` now throws
  `INVALID_APPLICATION_STATE` naming the component, or drops it when the caller opts in with
  `unknownComponents: "skip"`. **Output ordering is unchanged** — the walk is over the node,
  the emission over the registry — so every byte-identical round-trip test still holds.
- **A restored node id can no longer be re-issued to a node built after the load (A-17,
  §79).** `NodeOptions.id` restores an id at construction _and reserves it_ against
  `@fourjs/scene`'s monotonic counter; `restoreNodeId` moved into `@fourjs/scene` (the module
  that owns the field) for the `nodeFactory` path that cannot use the constructor, and
  `instantiateScene` refuses a document producing one id twice with `INVALID_SCENE_GRAPH`.
- **§34 replay documents carry the world configuration they were captured under (PH-6).**
  `ReplaySnapshot.configuration` was dropped at record time and never rebuilt at replay time,
  so `PhysicsWorld.restoreSnapshot`'s field-by-field refusal no-oped for every replay: a run
  captured at gravity −9.81 replayed into a world built with gravity 0 ran silently and
  diverged, signalled only by `finalChecksum` at the very end.

#### Added

- **`Application.resize(width, height, resolution?)` (A-7, §45)** — §45's eighth lifecycle
  method. Records the surface size (`app.width` / `app.height` / `app.resolution`), forwards
  to `renderer.resize`, and updates the `aspect` and projection of perspective cameras on
  full-surface viewports. A renderer no-op when headless; the size and cameras are still
  updated. `ApplicationOptions` gained `width`, `height`, `resolution`, and `depthRange`
  (plan D8, for the projection rebuild).
- **`ReplayRecording.worldConfiguration` and a format-version range (PH-6, §34).**
  `REPLAY_FORMAT_VERSION` is `2` and `SUPPORTED_REPLAY_FORMAT_VERSIONS` is `[1, 2]`. **A
  document declares the lowest version that can express its content**, so a recording with no
  configuration is still a version-1 document, byte for byte as before, and every recording on
  disk keeps validating and re-encoding identically. A version-1 document carrying a
  configuration is refused rather than silently upgraded; deleting the field from a version-2
  document and re-validating yields a valid version 1.
- **`MOTION_COMPONENT_SERIALIZER` from `@fourjs/motion` (PH-17, §11, §79)** — declared against
  a structural `ComponentSerializerShape` so no `motion → serialization` dependency edge is
  needed (the `ParticleDrawable` / `ReplayTarget` duck-typing pattern).
- **`registerSceneNodeTypes()` / `registerUISerializers()` from the umbrella `four` package
  (A-14, §73, §79).** §73 promises UI objects "share … serialization"; a `Panel`/`Label`/
  `Button` tree previously round-tripped as bare `Node` state. It now round-trips completely
  — §74 box model and layout, interaction flags, §75 accessibility record — through the one
  package allowed to see both `@fourjs/ui` and `@fourjs/serialization`.
- **`SceneNodeDocument.data` and `SerializeSceneOptions.nodeDataOf` (§79).** One opaque JSON
  value per node, written by the application and handed back verbatim to `nodeFactory` — the
  seam subclass state needed and the format did not have. Distinct from §6's `metadata`,
  which belongs to whoever authored the scene. Absent unless a writer produces one, so
  `SCENE_FORMAT_VERSION` is unmoved and existing documents encode identically.
- **`pointercancel` as a propagating scene event (§72)**, with `DragManager` ending a drag on
  it, plus `PointerInput.trackedPointerCount` and `Node.components`.

#### Changed

- **`tests/determinism/golden/phase10.json` was amended — envelope only, with proof.**
  `recordingDigest` 2642391973 → 1754656889 and `recordingLength` 46822 → 47008 (+186 bytes),
  because the §34 document now carries `worldConfiguration` and therefore declares
  `formatVersion: 2`. **Nothing else moved:** `initialSnapshotDigest`, `stepChecksumDigest`,
  `replayChecksumDigest`, `seekTailDigest`, the first/last/final checksums, the adapter
  identity and every contact count are bit-identical to the 2026-08-02 record — so the
  simulation, Rapier's snapshot bytes and the replay path are all unchanged. The claim was
  verified rather than assumed: re-running the scenario with the new capture neutralized (a
  `ReplayTarget` wrapper that drops `ReplaySnapshot.configuration`) reproduces the previous
  digest and length exactly. The golden records that verification in a new `_amended` field,
  and gained `formatVersion` and `worldConfigurationKeys` so the §34 configuration is pinned
  from now on.
- **Behaviour change, stated rather than hidden (A-9):** a `pointerup` now ends the pointer's
  hover, so a mouse press-and-release fires `pointerleave` and the next `pointermove` fires
  `pointerenter` again. That is correct for touch and pen, where the contact really ceased to
  exist, and is a regression for the mouse, whose pointer persists. Telling them apart needs
  `pointerType` on the structural `SurfacePointerEvent`, which this change did not widen.
- `application.ts`'s module header no longer says input, assets and physics "arrive with the
  phases that build them (§103)" — those phases all landed and wired none of them in. It is
  now a dated post-plan note pointing at A-6.
- `UIWidgetOptions` extends `NodeOptions`, so every widget accepts a restored `id`.

#### Deliberately not done

- `RigidBody` / `Collider` component serializers (the rest of PH-17). They belong in
  `@fourjs/physics`, which this change could not touch; they are tracked in `TODO.md`.

### 2026-08-05 — documentation-truth sweep

No behaviour changed; a set of verified-false claims in the repository's prose were
corrected in place, each with the date and the superseded wording kept. Corrected:
`ROADMAP.md` ("nothing on this roadmap has shipped yet" — the plan completed 2026-08-02);
`README.md` ("42/43 … lighting is the single staged absence" — 43/43 since 2026-08-04);
`docs/AUDIT-120.md` (the examples count, `tests/visual/` "an empty placeholder", and the
sprites "batched" note, plus a new staged line **S-8** for the missing §93/§118–119
examples); `tests/README.md` (rewritten from §92's taxonomy to the suites that exist, with
a per-category "not yet covered" list); `playwright.config.ts` ("There are no golden
images", now scoped to the `chromium` project); `docs/guides/materials-and-render-graph.md`
(the render-list sort keys, the batching row, and the post-lighting material/lighting
rows); `docs/guides/custom-shaders.md` ("three" internal programs → four);
`benchmarks/README.md` (a blocked-by column separating §86 rows that need hardware from the
four that need engine features); `docs/guides/cameras-and-coordinate-conversion.md` (an
empty example cited as exercising the 3D path); `examples/README.md` and
`docs/guides/README.md` (placeholder directories now marked as such).

**Correction to the Phase 0 entry below (dated 2026-08-05).** That entry says
`examples/` "gained the §93 quick-start examples and the two flagship demos (§118–119)".
It gained **directories**, each holding a `.gitkeep` and nothing else, and four of them
plus both flagship directories are still empty today (`git ls-files examples/`). Six
runnable examples exist — `first-2d-scene`, `physics-playground`, `mechanism`, `blending`,
`particles-demo`, `ui-demo` — and none of them is a flagship demo. The historical entry is
left as written, per this file's convention of not rewriting history; `docs/AUDIT-120.md`
**S-8** is the dated statement of what is absent.

#### Added

- `tools/check-docs.mjs` and `pnpm check-docs`, wired into CI next to `check-spec`: a
  mechanical doc-truth gate that fails if a doc references an empty `examples/*` directory
  without a placeholder marker, if `docs/AUDIT-120.md`'s example count drifts from
  `git ls-files`, or if any of the false claims listed above reappears verbatim.

### 2026-08-05 — team code review + simplification sweep

Owner-directed: a five-agent review of all 24 packages, applying
behavior-preserving simplifications along the way. Confirmed bugs, all fixed
with regression tests: torn material color state on rejected `setColor`/
`setTint` (all three materials now validate before writing); UI ancestors
stuck `pressed` forever via bubbled downs (state reactions are target-only
now; ancestors still observe events) and focus surviving reparenting into a
stale scope (attachment blurs, as in the DOM); `RigidBody` silently dropping
`ccdPredictionDistance` on the component path; the adapters' CCD resolver
diverging from the pinned WP-5.2 table for `true` + `"disabled"`; time-0
marker/event double-fire on zero-delta advance in `Timeline` and
`AnimationMixer`. Simplifications: shared `resolveCcdMode` (physics-rapier),
render-webgl program machinery consolidated (~120 lines, GL sequence
byte-identical), `requireNonNegativeSeconds` de-triplicated, `hashFloats`
now composes the checksum primitives, assorted allocation and doc-truth
cleanups. PLAUSIBLE findings recorded for follow-up: pointer-state map
growth over dead pointer ids; first-collider mass loss on direct-adapter
collider destruction; 3D joint-registry mismatch not detected on corrupt
§34 envelopes. Verified: 3,083 unit + 174 suite + 38 browser/visual tests,
coverage gates ≥95% everywhere (physics/diagnostics/animation/materials/ui
at 100%), determinism goldens bit-exact, lint, TypeDoc 0 warnings.

### 2026-08-04 (lighting)

#### Added — Lighting MVP (§68, §120's last unshipped bullet; owner-directed tier)

The minimal defensible tier: one directional light, Lambert diffuse plus a scene
ambient term. No shadows, no point/spot lights, no PBR — each staged with a dated
note where its design will land (§69, §59, §60a; see `docs/AUDIT-120.md` S-5).

- `@fourjs/scene`: `DirectionalLight` node (color + intensity, shines along its node's
  −Z world axis — the camera look convention; `getWorldDirection(out)` resolves on
  demand) and `Scene.ambientLight`, §68's "ambient" as a scene-wide term.
- `@fourjs/materials`: `LitMaterial` mirroring `UnlitMaterial` (color-only, same §60a
  no-color-space/no-clamp stance); both surface materials now carry a `kind`
  pipeline discriminant.
- `@fourjs/geometry`: optional `normals` vertex attribute on `BufferGeometry`
  (index-aligned with positions, §85-validated); `boxGeometry` now emits 24
  vertices with per-face normals (same 12 triangles), `planeGeometry` +Z normals;
  2D shapes stay position-only and unlit.
- `@fourjs/render`: `"lit"` render-item kind chosen from `material.kind`;
  backend-independent `collectSceneLights` with duck-typed light discovery
  (first light in scene-graph order; render-list-identical visibility pruning).
- `@fourjs/render-webgl`: fourth GL program (`LitProgram`; normal matrix derived
  in-shader, no-light frames upload black and need no shader variant), normal
  stream at fixed attribute location 1, `uniform3fv` added to the GL seam.

The unlit path is untouched — a scene with no lit items issues the same GL call
sequence as before, and every browser spec and pixel golden passes unchanged.
On the merged tree (this packet landed alongside the backlog burn-down below):
3,077 unit + 174 suite + 38 browser/visual tests, coverage ≥95% everywhere,
TypeDoc 0 warnings, payload gate 33.28/150 kB; §120 audit amended to 43/43
shipped-or-MVP.

### 2026-08-04 (backlog burn-down)

Owner-directed: implement the recorded backlog, deferring nothing. One batch:

#### Added

- **UI browser proof** — `examples/ui-demo` (a `@fourjs/ui` panel of buttons and
  labels, app-supplied `WidgetSkin`s, real pointer + keyboard interaction,
  25 kB gzip) and `tests/browser/ui.spec.ts` (4 tests). Closes the plan's one
  recorded packet-intent shortfall (WP-11.5). `.size-limit.json` gains the
  missing particles-demo entry (19.36/25 kB) and ui-demo (25/30 kB).
- **§92 visual regression category seeded** — `tests/visual/ui-demo.spec.ts`
  under a new Playwright `visual` project with committed
  SwiftShader-to-SwiftShader pixel goldens (2 tests; stability verified across
  repeated runs). The browser suite's "no golden images" doctrine concerns
  SwiftShader-vs-GPU drift and does not apply to same-rasteriser comparison.
- **`Node.position` / `Node.rotation` / `Node.scale`** alias getters onto the
  live `transform.*` members — the §15/§97 idiom (`camera.position.set(0, 2, 8)`)
  now works; 11 new scene tests.
- **`SolverBodyAccess.getBodyCenterOfMass`** (+ both Rapier adapters via
  `RigidBody.worldCom()`, the fake and scripted adapters) and diagnostics'
  **`collectCentersOfMass`** provider — §113's centre-of-mass display, unstaged
  from `DEBUG_DRAW_STAGED`. All seven debug providers now run against a live
  Rapier adapter in the integration suites (previously 4 of 6 were
  fake-exercised only).
- **`PhysicsWorldOptions.solverIterations`** (§28) → Rapier's
  `World.numSolverIterations`, proven behaviourally: 1 vs 4 iterations diverge
  on a contact stack; an explicit 4 is bit-identical to omitting the option,
  so every recorded checksum and replay stands.
- **`RigidBodyDescriptor.ccdPredictionDistance`** (§31) replaces the WP-5.4
  pinned 1 m speculative-CCD constant per body, proven at the boundary it
  controls (0.001 m tunnels a thin wall at 200 m/s; 10 m catches it);
  contradictory non-speculative use is refused.
- **§34 world-configuration refusal** — `PhysicsSnapshot` gains an optional
  `configuration` record (dimension, resolved gravity, resolved sleeping,
  determinism, solverIterations-if-set); `restoreSnapshot` refuses a mismatch
  field by field. Absent configuration (pre-existing envelopes, §34 replay
  documents) restores exactly as before.

#### Added — documentation

- **The thirteen §93 prose guides** (`docs/guides/`, + index): §93's own list,
  one file per item, every code sample cross-checked against
  `docs/Architecture/package-export-surfaces.json` and the source doc
  comments; staged/unshipped surfaces stated honestly (custom shaders, §40
  units record, workers, lighting). 1,853 lines.

#### Fixed — tooling and docs hygiene

- **TypeDoc: 123 warnings → 0.** Stale links repointed, unexported-symbol
  links backticked, cross-package links qualified for the umbrella
  conversion, declaration-merging comments demoted on the augmenting side
  (`NodeEventMap`, `RigidBodyEventMap`), `@inheritDoc` blocks that carried
  extra paragraphs rewritten as own summaries, `TypeError` mapped to MDN via
  `externalSymbolLinkMappings`, and `physics-rapier`'s transcribed `Rapier*`
  types declared `intentionallyNotExported` in a package-level typedoc.json.
- `eslint` no longer descends into `.claude/worktrees/**` (agent worktrees
  are full second checkouts; linting one from the root produces phantom
  project-service errors).

#### Fixed

- **`blending.spec.ts` RECOVER de-flaked** (1-in-3 hard fail, recorded since
  Phase 11): the sweep clock started _after_ a SwiftShader screenshot that
  could swallow 500+ ms of the 1.5 s sweep, tripping the ≥1 s lower bound. The
  clock now starts before the click that starts the sweep (a strict superset
  of the sweep interval — deterministic), and the collapse wait is a poll
  rather than a fixed pause.
- **All 24 package READMEs** rewritten truthfully (they still said "scaffold
  only"); key exports verified against `docs/Architecture/`; the five
  placeholder packages (box2d, soft, webgpu, canvas, svg) now say "interface
  reserved; not yet implemented". Root README rewritten with the §93
  quick-start, examples table, and dev-commands reference — every identifier
  in the snippet checked against the real API.

### 2026-08-04 (later)

#### Changed — every dependency-graph finding resolved: 0 duplicates, 0 cycles, 0 unused exports

Owner-directed sweep ("resolve all issues the tools report; defer nothing"):
every issue in `docs/Architecture/` is now zero, and the gates hold it there.

- **All 5 baselined TRUE_DUPLICATE names consolidated** —
  `duplicate-baseline.json` re-seeded to empty:
  - `SeededRandom` → `@fourjs/core` (`core/src/random.ts`, the WP-8.2 original
    verbatim; both copies carried this exact hoist as their dated plan).
    `@fourjs/motion` and `@fourjs/particles` re-export it; streams are unchanged
    for every seed. Motion's known-answer tests moved to `core/tests/`;
    particles' independent BigInt-oracle suite stays put and still pins
    stream identity.
  - `JsonValue` + `cloneJsonValue` → `@fourjs/core` (`core/src/json.ts`),
    keeping `@fourjs/serialization`'s `__proto__` refusal — the strengthening
    both files' notes wanted shared. Behavior change in `@fourjs/diagnostics`:
    a recorded payload with a `__proto__` own key is now refused with a
    `TypeError` instead of silently re-parenting the copy (the original
    contradicted its own "never carry a `__proto__` into the player"
    contract at the payload level). New `core/tests/json.test.ts` covers
    every branch; diagnostics/serialization re-export both names.
  - `DEFAULT_GRAVITY_Y` → `@fourjs/core` (`core/src/conventions.ts`, the
    Appendix A normative default); `@fourjs/physics` and `@fourjs/particles`
    re-export.
  - `ColorRGBA` → `@fourjs/math` (`math/src/color.ts`, the value-type home
    below both consumers); `@fourjs/animation` and `@fourjs/materials`
    re-export.
- **Both type-only import cycles broken** (graph now reports 0 of any kind):
  - `scene/authority.ts ⇄ scene/node.ts`: `warnAuthorityConflict` now takes
    a structural `AuthorityNode` (id, name, transformAuthority — the slice it
    reads) instead of importing `Node`; every `Node` satisfies it, callers
    unchanged. `AuthorityNode` is exported from the barrel.
  - `physics/collider.ts ⇄ physics/rigid-body.ts`: `RigidBodyCollisionEvent`
    moved to `collider.ts`, and the three §29 collision keys of
    `RigidBodyEventMap` are merged in from there by declaration merging
    (the `@fourjs/input` → `NodeEventMap` pattern); `rigid-body.ts` keeps the
    two §32 sleep keys and no longer imports `Collider`. The `@fourjs/physics`
    public surface is unchanged.
- **All 21 "potentially unused exports" resolved**: the transcribed Rapier
  type subset in `physics-rapier/src/init.ts` had 21 interfaces exported but
  referenced only in-file — now plain (un-exported) interfaces.
- TypeDoc: 123 warnings vs 125 before the sweep (the merged-interface
  augmentation deliberately carries a plain comment, not a doc comment —
  TypeDoc warns when two declarations of one merged interface are both
  documented).
- Verified green end-to-end: 24/24 build, 2,985 unit tests (core 91,
  incl. the moved RNG pins and the new JSON suite), coverage thresholds
  ≥95% everywhere, lint, check-spec, suites 174, browser 32, size gate
  32.13 kB unchanged, `graph` + `graph:check` + `graph:duplicates` +
  `graph:test` all green.

### 2026-08-04

#### Added — duplicate-symbol gate (`pnpm graph:duplicates`) — CDG/QDG integration complete

The last unwired piece of the vendored dependency-graph toolkit,
`tools/create-dependency-graph/check-duplicates.mjs`, is now a script and a CI
gate. It reads the `duplicate-symbols.json` that `pnpm graph` regenerates
(`--no-regen`, matching the repo's graph-generates/`graph:*`-consumes
convention) and fails on any `TRUE_DUPLICATE` symbol name beyond
`docs/Architecture/duplicate-baseline.json`, so new copy-paste duplicates
cannot accumulate while the accepted backlog shrinks deliberately.

- Baseline seeded with the 5 current TRUE_DUPLICATE names, all pre-recorded
  backlog: `cloneJsonValue` + `JsonValue` (diagnostics/serialization — no
  matrix edge between them), `DEFAULT_GRAVITY_Y` (particles/physics),
  `SeededRandom` (the dated Phase 9 hoist-to-core item), `ColorRGBA`
  (animation/materials).
- Two four.js entries added to `duplicate-allowlist.json` for
  legitimately-independent names that must never be "consolidated":
  per-package `PACKAGE_NAME` (23 packages, the analog of MathTS's per-package
  `VERSION`) and `PARTICLE_INSTANCE_FLOATS` (deliberate duck-typed contract;
  the dependency matrix forbids the particles↔render edge — MEMORY
  2026-08-02, Phase 9). The allowlist is per-repo **data**, exempt from the
  vendored-code byte-identity rule with llm-wiki (noted in `tools/README.md`);
  MathTS's entries stay in place, inert, so code diffs against llm-wiki stay
  clean.
- CI runs `pnpm graph:duplicates` inside the architecture-invariants step,
  right after `pnpm graph`.
- Re-seed after consolidating a name:
  `node tools/create-dependency-graph/gen-duplicate-baseline.mjs`.

### 2026-08-03

#### Fixed — `Lint` was red in CI since bfa0cb9

Two separate causes, both introduced by earlier commits in this same effort and
neither caught because CI was not checked after pushing:

- `tests/integration/examples-build-coverage.test.ts` (added in bfa0cb9) used
  four `!` non-null assertions that `@typescript-eslint/no-unnecessary-type-assertion`
  rejects — the types were already narrowed. Removed; the guard still passes and
  still fails on build/preview drift.
- The vendored `tools/create-dependency-graph/**` and `tools/query-dependency-graph/**`
  are now eslint-ignored. They come from MathTS and are kept byte-identical with
  the copies in llm-wiki, so restyling them here would guarantee the two copies
  drift. They are verified by being run (`pnpm graph`) and by QDG's own unit
  tests (`pnpm graph:test`), not by this repo's lint config.

`pnpm lint` is green again, along with build, test, typecheck:examples,
check-spec, graph, graph:check and graph:test.

#### Added — dependency-graph tooling (CDG + QDG) wired into the build

Vendored the MathTS dependency-graph tools under `tools/` and integrated them as
real scripts plus a CI gate, rather than leaving them as loose files.

- `pnpm graph` — CDG, the full-parse generator. Writes `docs/Architecture/`:
  dependency graph (JSON/YAML/Markdown), file inventory, package export
  surfaces, duplicate symbols, and unused/dormant analysis.
- `pnpm graph:query` — QDG emits `dependency-reverse.json` and
  `node-safety.json` from CDG's JSON without re-parsing the codebase.
- `pnpm graph:check` — **new CI gate.** Asserts every package's `.` (main) entry
  is free of `node:` builtins.
- `pnpm graph:test` — QDG's own unit tests (6 cases).

`docs/Architecture/` is committed on purpose: QDG and any agent read that JSON
instead of re-running the heavy parse, so it has to be in the tree to be useful.

QDG also gained `--root=<path>` (written test-first in llm-wiki, mirrored here so
the two vendored copies stay byte-identical). It previously resolved
`docs/Architecture/` from its own location two levels up, which is correct for
four.js but breaks wherever the tools do not sit directly above the scanned root.
The flag mirrors the one CDG already had, and is consumed so it is never misread
as a command. QDG's suite goes 6 -> 10 tests.

First run is clean across all **24 workspace packages** — 318 files, 1198 exports,
**0 runtime circular dependencies** (2 type-only, which are safe), 0 orphaned
files, and no `node:` leaks. The census self-check passes: 318 files counted
equals an independent maximal repo walk.

The `graph:check` gate earns its place because a `node:` import reaching a
browser-facing entry is invisible to both `tsc` and the unit tests — those run
under Node, where `node:` resolves happily — and only fails once the package is
loaded in a browser. The gate starts green, so it catches the first regression
rather than documenting an existing mess.

**Upstream fix required to make CDG work here.** It discovered workspaces only
from `package.json`'s `workspaces` field. pnpm does not use that field, so
four.js looked like a single package and the scan reported "Found 0 TypeScript
files". `readWorkspacePatterns()` now also reads `pnpm-workspace.yaml`'s
`packages:` list, plus yarn's `{ packages: [...] }` object form, and drops
pnpm's negated globs (`!packages/legacy`) rather than treating them as literal
directory names. The same fix is mirrored in `llm-wiki/tools/`.

#### Removed — the last `turbo.exe` on disk

`turbo` left `pnpm-lock.yaml` when the build scripts were converted on
2026-08-02, but `node_modules/.pnpm/@turbo+windows-64@2.10.7/.../turbo.exe` was
still present locally. Nothing referenced it — not `package.json`, not
`pnpm-workspace.yaml`, not CI — so it was pure leftover from the build that
bugchecked the machine. Removed; the workspace still builds 24/24.

### 2026-08-02

#### Added (Phase 11 — Assets, Serialization, UI, Tooling, §113a; packets WP-11.1…WP-11.6 — THE FINAL PHASE)

- `@fourjs/serialization`: SceneDocument v1 with canonical validation, a
  component-class-keyed serializer registry, §80 migrations — byte-identical
  round trips; 84 tests, 100% coverage.
- `@fourjs/assets`: AssetManager (coalescing refcounted cache, disposal-aware image
  wrapper) + JSON/text/binary/image loaders; glTF staged with a dated note — 33
  tests, 100% coverage.
- `@fourjs/ui`: retained-mode Panel/Label/Button over a WidgetSkin visuals seam,
  flex/stack/absolute layout, §72-driven state machines, focus management;
  accessibility mirror + keyboard staged — 90 tests, 100% coverage.
- `benchmarks/`: a shared harness + five suites (math, scene, physics, animation,
  particles) with committed measured-not-gated records, and `docs/AUDIT-120.md`
  (42/43 §120 bullets shipped-or-MVP; lighting the single dated staged absence).
- Integration (13 tests): the §79/§34 boundary proven — contact-free scene saves
  reload bit-identically for 200 further steps; in-contact saves diverge only via
  unserialized solver warm-start state. Reference RigidBody/Collider serializers.
- **Final exit GREEN. The implementation plan (§103–§113a) is complete**: 2,971 unit
  - 172 suite + 32 browser tests; 24/24 packages; coverage ≥95% everywhere; §86 at
    32.13/150 kB; docs 0 errors.

#### Added (Phase 10 — Replay, Snapshots, Diagnostics, §33–34/§113; packets WP-10.1…WP-10.5)

- `@fourjs/diagnostics`: the §34 replay format (canonical serialization, strict base64,
  adapter-validity refusal), `ReplayRecorder` + `ReplayPlayer` (host-supplied stepFn,
  periodic-snapshot seeking, slow motion, verify hooks), and `DebugDrawBuffer` with
  duck-typed providers (contacts/normals/impulses, velocities, origins, solver
  statistics; COM/joint-anchor/force-vector display staged with dated seam-gap notes)
  — 210 tests, 100% coverage.
- End-to-end §113 proof on real Rapier: recording is non-perturbing; replay
  bit-identical (240/240 checksums); seek costs ≤ snapshot interval; contact geometry
  appears at exactly the recorded steps under frame stepping; slow-motion arithmetic
  exact; the phase10 golden pins the recording bytes themselves cross-process.
- Phase 10 exit GREEN, zero defects: 2,766 unit + 159 suite + 32 browser tests.

#### Added (Phase 9 — Particles, §27/§36/§112; packets WP-9.1…WP-9.5)

- `@fourjs/particles`: SoA particle core (pool/emitter with seeded 4-draw spawn
  contract, plane collision, over-lifetime ramps), the §27 force-field set
  (gravity/drag/wind/radial/vortex/bounded hash-noise turbulence/volumes), and a
  `ParticleSystem` at priority 500 — 174 tests, 100% coverage.
- Batched particle rendering: a new `"particles"` RenderItem drawn as instanced quads
  (6 GL calls per frame at any count) with straight-alpha blending; duck-typed
  cross-package contracts where the dependency matrix forbids edges (plan-noted).
- `benchmarks/particles-100k.mjs` + committed results: 100k particles + 3 fields at
  16.54 ms/step mean on CI hardware, with per-field cost attribution (integrator
  1.35 ms; ~5.3 ms per polymorphic field) — recorded, not gated.
- `examples/particles-demo` (fifth site, non-wasm, 18.9 kB gzip) + browser spec;
  phase9 determinism golden (cross-process). Suites 138, browser 32.
- Phase 9 exit GREEN per the plan's honest §112 reading; four doc-hygiene defects
  fixed in-line (dated staging notes, plan-level governance note).

#### Added (Phase 8 — Advanced Motion, §111; packets WP-8.1…WP-8.5)

- `@fourjs/motion`: `PIDController` (§111 sketch verbatim, anti-windup, derivative on
  measurement), `SpringDamper` (exact matrix-exponential stepping), the Reynolds
  steering set + flocking with a seeded xorshift128 RNG (BigInt-oracle-pinned),
  ballistic/intercept trajectory prediction, and two-bone analytic IK — six new
  modules, each at 100% coverage with independent analytic test oracles; declined
  §111 components staged with dated notes.
- Integration (7 suite tests): PID speed loop settling a real Rapier motorized hinge
  to exact setpoint in both dimensions; spring-damped camera follow matching its
  exact discrete transfer function to 3e-15; steering agents beside physics with
  checksum-stream-identity proof; ballistic interception vs the substepped solver;
  IK driving the §19 blend pipeline.
- Phase 8 exit GREEN (plan-defined criterion, owner-to-confirm): 2,359 unit + 131
  suite + 27 browser tests; coverage ≥95% everywhere.

#### Added (Phase 7 — Physics-Animation Blending, §19/§42/§110; packets WP-7.1…WP-7.8)

- `@fourjs/scene`: `PoseTarget` component (animation-drivable target poses with
  finite-difference history); the `"blended"` transform authority unlocked (§42's
  reserved value, guarded since Phase 2).
- `@fourjs/physics`: §19 blend weights on `RigidBody`; in-place body retype
  (`setBodyControlMode`) with velocity inheritance; the §19 pipeline inside
  `PhysicsWorld.step` (unweighted kinematic feed → solve → weighted lerp/slerp
  publish under `"blended"`, bit-identical at the weight extremes) plus
  `createPoseTargetCaptureSystem` at priority 299; `SolverBodyAccess.setBodyType`
  implemented on both Rapier adapters (verified in-place on live wasm).
- `@fourjs/animation`: root-motion MVP (loop-aware translation deltas from a designated
  clip track; rotational staged; seek never accumulates).
- Integration: §19's four examples end-to-end on Rapier (17 tests) — the ragdoll
  cycle's kinematic→dynamic switch uses 6 ppm of its derived continuity bound.
- `examples/blending` (fourth example site): a hanging chain cycling
  ANIMATED→RAGDOLL→RECOVERING on click (675.9 kB gzip, wasm, outside §86).
- Gates: phase7 determinism golden (600-step scripted mode cycle, cross-process;
  switch steps pinned BELOW the wave's own per-step motion) + blending browser spec
  (suites 124, browser 27, four webServers).
- Phase 7 exit GREEN, zero defects: 2,176 unit tests, suites ×2, browser ×2,
  coverage ≥95% everywhere (physics/animation at 100%), §86 gate at 30.92/150 kB.

#### Added (Phase 6 — Joints and Constraints, §28/§109; packets WP-6.1…WP-6.7)

- `@fourjs/physics`: §28 joint classes (Fixed/Hinge/Slider/Rope/Spring/Spherical +
  Revolute/Prismatic/Ball aliases) over body-local descriptor unions; world-space
  anchors converted once at `world.addJoint`; live limits/motors via command queues;
  engine-level break monitoring with `jointbreak` events; `SolverJointAccess` seam;
  distance/gear staged with P6-1-citing errors — 109 new tests, still 100% coverage.
- `@fourjs/physics-rapier`: joint mapping in both dimensions (2D five types, 3D six)
  against measured 0.19.3 behavior — `reportsJointReactions: false` (no reaction API
  exists; breakable joints refused rather than faked), motor efforts as documented
  ForceBased gains, disabled motors as a measured-inert gain (bit-identical to
  never-motored), spherical without non-cone "limits"; snapshot envelopes v2 with
  joint tables — 96 new wasm-backed tests.
- `tests/integration/physics-joints.test.ts`: 24 end-to-end tests incl. the §109
  stability core (3600 steps, hinge drift 1.3e-5 m, zero rope slack/limit overshoot)
  and breakage through the full Application pipeline on a scripted adapter.
- `examples/mechanism`: the §109 slider-crank — motorized shaft, hinges, limited
  slider with limit-switch lamps, spring buffer, click-to-coast motor and speed
  plates (674 kB gzip, wasm, outside §86).
- Gates: phase6 determinism golden (two jointed worlds, scripted §28 reconfiguration
  incl. joint removal, cross-process) + mechanism browser spec (suites 95, browser 23,
  three Playwright webServers).
- Phase 6 exit: §109 TRUE; one CI-wiring defect found and fixed (WP-6.6-fix1 — CI now
  builds all three example sites before the browser gate; the playground half predates
  Phase 6) plus stable-API doc caveats for the motor-gain deviation.

### 2026-08-01 (later)

#### Added (Phase 5 — Physics API + Rapier Adapter, §108; packets WP-5.1…WP-5.9)

- `@fourjs/physics`: complete §20–§34 public API — types/shapes/descriptors/materials/
  events/queries + the §37 `PhysicsSolverAdapter` contract with branded handles;
  `RigidBody` + `Collider` components (§26 command buffers, §29 typed events,
  density-derived mass per §23 restored by WP-5.2-fix1's authoredness rule);
  `PhysicsWorld` + `PhysicsSystem` (priority 600; sync → step → publish under
  "physics" authority → dispatch-after-step; §30 queries with §21 2D naming; §33
  FNV-1a checksums; §34 snapshots with adapter validity metadata) and the
  `SolverBodyAccess` per-handle seam — 281 tests, 100% coverage.
- `@fourjs/physics-rapier`: Rapier 2D + 3D adapters on pinned
  `@dimforge/rapier{2d,3d}-compat@0.19.3` wasm — P5-6 shape tier, all four §22 body
  types, sensors, adapter-derived collisionstay, monotonic id registries, snapshot
  envelopes, honest capabilities (joints staged per P5-4) — 185 wasm-backed tests.
- `tests/integration/physics-rapier.test.ts`: first §92 integration suite — 26 tests
  proving gravity/collisions/impulses/sensors/queries/authority/interpolation/
  checksum/snapshot-replay in both dimensions plus the §108 mixed-world shape.
- `examples/physics-playground`: the §108 demonstration — 2D and 3D worlds side by
  side, click impulses, sensor zones; 1.51 MB gzip (wasm; outside the §86 budget).
- Gates (WP-5.8): phase5 determinism golden (600 steps, two worlds, §33 checksums,
  cross-process, same-runtime tier stated) and a 4-test playground browser spec
  (browser total 19; two Playwright webServers).
- Phase 5 exit GREEN, zero defects: 1,827 unit tests, suites ×2 (60), browser ×2 (19),
  coverage gate green repo-wide, first-2d-scene unchanged at 30.19 kB gzip vs §86.

#### Added (Phase 4 — Animation Core, §107; packets WP-4.0…WP-4.9)

- `@fourjs/animation`: §15 easing (12 families × in/out/in-out, 34-key registry, pinned
  constants incl. a normalized damped-spring closed form); value adapters + property
  bindings (§16 resolved-once paths, in-place writes, zero-allocation hot paths);
  `Tween` builder (§15 API, last-started-wins conflict registry shared with the mixer,
  §42 authority gating with all-or-nothing transform writes); `Timeline` (§16 complete:
  nesting, labels, markers with forward-crossing-once + seek suppression + replayOnSeek,
  loop/reverse/scrub/speed); `AnimationTrack`/`AnimationClip` (§17 shape,
  step/linear/cubic/Hermite + quaternion slerp, binary-search sampling);
  `AnimationMixer` (clip playback with §16 event semantics); fixed-step
  `AnimationSystem` at priority 300 — animation poses before kinematics (§19 order) —
  324 tests, 100% coverage on all four metrics.
- Tooling (WP-4.0): `typecheck:examples` (examples now typechecked in CI against built
  d.ts) and a tooling-enforced repo-wide ≥95% coverage gate (`pnpm run coverage`,
  package-level vitest thresholds, wired into CI); umbrella barrel-wiring test.
- Example: beacon + vane animated cluster demonstrating every §107 value kind under a
  looping timeline with a palette-stepping marker; 30.19 kB gzip vs the 150 kB §86 gate.
- Gates (WP-4.8): phase4 determinism golden (21 quantities × 1000 fixed steps,
  in-process + fresh-child-process digests, marker-fire steps pinned), marker
  seek-suppression determinism test, and a 4-test browser animation spec (browser total 15) incl. a standing cluster-isolation invariant.
- Phase 4 exit GREEN (§107 criterion TRUE): 1,363 unit tests, suites ×2 with goldens
  byte-identical, browser ×2, coverage gate green, docs/spec checks clean.

#### Added (Phase 3a — Interaction, Sprites, Text MVP, §106a; packets WP-3a.1…WP-3a.7)

- `@fourjs/input`: §71 picking (ray from +Y-up NDC, AABB + oriented-box tests), §72-subset
  pointer routing with scene-graph propagation (`capture:`-prefixed capture-phase keys on
  the four propagating types), `NodeEventMap` augmentation, DragManager (near-plane
  unprojected world deltas handed to app callbacks; input never writes transforms) —
  80 tests, 100% coverage.
- `@fourjs/render`/`@fourjs/materials`/`@fourjs/render-webgl`: §55/§77 MVP textures + sprite
  quads (`kind: "sprite"` render items, SpriteMaterial/SpriteTexture contract, GL texture
  uploads). §55 frame regions deferred (whole-texture mapping only; backlogged).
- `@fourjs/text`: §56 bitmap MVP tier — embedded 6×12 monospace font (95 printable ASCII,
  base-32 row encoding), glyph atlas, text layout (Y-up baselines); SDF staged — 48 tests,
  100% coverage.
- Example upgrade: click-to-recolour palettes, pointer dragging with the §42
  untrack + authority handover pair, per-glyph text label; 21.46 kB gzip vs the 150 kB
  §86 gate.
- Browser interaction gate (5 new Playwright tests, 11 total): real Chromium mouse input,
  framebuffer-pixel assertions for click/miss/drag/tumble-resume/label ink/no-errors.
- Phase 3a exit GREEN (§106a criterion TRUE): 1,015 unit tests, browser suite ×2, goldens
  untouched, coverage ≥95% every touched package; demo-ready static build confirmed.

#### Added (Phase 3 — Renderer Foundation, §106; packets WP-3.1…WP-3.9)

- `@fourjs/scene`: §47 cameras (D8 depth ranges) + §48 viewport. `@fourjs/geometry`/
  `@fourjs/materials`: BufferGeometry + primitives, UnlitMaterial. `@fourjs/render`: §61
  Renderer interface (context-loss contract) + NullRenderer, render lists incl. the §43
  interpolated builder. `@fourjs/render-webgl`: WebGL 2 backend over a structural GL seam
  (fake-GL unit tests, 90 tests). `four`: renderer integration with RenderInterpolation.
- Real moving example (14.88 kB gzip vs the 150 kB §86 gate) + Playwright browser gate
  (headless Chromium/SwiftShader; caught and fixed a real rAF-seed defect) + smoothness
  exit spec proving interpolated draws between simulation states.
- Phase 3 exit GREEN, zero defects; coverage ≥95% statements everywhere
  (geometry/materials/render at 100%).

### 2026-08-01

#### Added (Phase 2 — Motion Foundation, §105; packets WP-2.1…WP-2.7)

- `@fourjs/motion`: five §38 integrators, MotionComponent + MotionSystem (pinned
  semi-implicit update, §42 enforcement), eight §13 trajectories with pinned constructors,
  KinematicController (moveTo/rotateTo/followPath, channel state machines) — 200 tests.
- `@fourjs/scene`: TransformAuthority (§42, `blended` reserved via NOT_IMPLEMENTED),
  PoseBuffer interpolation store (§43/§37 single owner, no write-back) — 114 tests.
- Phase 2 exit: §105 demos vs independently derived closed forms (worst deviation
  3.1e-13), cross-process golden determinism; coverage ≥95% statements everywhere.
- Fixes: CI Node 22 (type-strip test children), `four/application` subpath export.

#### Added (Phase 1 — Math, Scene, and Time, §104; packets WP-1.1…WP-1.14)

- `@fourjs/math`: mutable Vector2/3/4, Quaternion (shortest-arc slerp), column-major
  Matrix3/4 with §7 pivot compose, D8 projections, change-hooks, allocation counter —
  154 tests incl. zero-allocation proofs.
- `@fourjs/core`: typed EventEmitter (§6b), typeName-keyed component model (§6a),
  FourError (§89 + INVALID_APPLICATION_STATE) and Disposable — 57 tests.
- `@fourjs/scene`: Transform with the D3 dirty channel, Node/Group/Scene (D1 single
  inheritance, §46 lookups, cycle prevention), version-cached world-transform resolver —
  84 tests.
- `@fourjs/motion`: TimeState/Clock, the §10 fixed-step scheduler (clamp, droppedTime,
  pause semantics), §39 SimulationSystem registry — 56 tests.
- `@fourjs/diagnostics`: D6 FNV-1a checksum with cross-checked immutable known-answer
  vectors — 28 tests. `four`: §45 Application composition root (headless) — 25 tests.
- Phase 1 exit (`tests/determinism/`): 100-node/1000-frame golden-digest scenario, green
  in-process and in a fresh node process; coverage ≥95% statements in every package.
  Tooling: `tests/tsconfig.json`, `@types/node`, `@vitest/coverage-v8`.

### 2026-07-31

#### Added (Phase 0 — Project Foundation, §103; plan packets WP-0.1…WP-0.15)

- Working monorepo: root manifests with the pinned §3.2 toolchain, `tsconfig.base.json`,
  Turborepo pipeline, all 24 `@fourjs/*`/`four` packages scaffolded per the §3.4 template
  (split dev/build tsconfigs, `tsc -b`, types-first exports; umbrella with per-package
  subpaths and a 23-package integration test), ESLint/Prettier config (type-checked,
  determinism bans per §33, named-exports rule), Vite example (`examples/first-2d-scene`),
  §86 size gate (425 B / 150 kB gzip), TypeDoc (`docs/api`), root vitest suite wiring,
  GitHub Actions CI, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `ROADMAP.md`.
- Phase 0 exit verified independently: all gates green twice (cold + warm), zero defects.
- Plan corrections discovered in execution (dated in place): WP-0.2 Done check, WP-0.4/0.5
  Files lines, `pnpm run docs` builtin pitfall, `*.tsbuildinfo` gitignore, WP-0.7-fix1.

### 2026-07-29

#### Changed (spec revision 1.6)

- npm publish names decided by the owner: umbrella `@danielsimonjr/fourjs`, sub-packages
  `@danielsimonjr/fourjs-<name>`, published from the personal scope (no org claim or
  dispute). §98 note updated; workspace names remain `four`/`@fourjs/*`; TODO owner item
  closed.

#### Added (gap-closure pass)

- `docs/POSITIONING.md` — outward-facing why-exist case: the integration-is-the-product
  bet, audience order (engineering/digital-twins first), migration story, demo-first
  principle, and plainly stated risks.
- `docs/rfcs/` — RFC home (`README.md` process + `0000-template.md`), backing the §95 /
  implementation-plan governance gate.

#### Changed (spec revision 1.5 + plan revision 2.1)

- `docs/SPECIFICATION.md` → **revision 1.5**: added §106a (Phase 3a — input, picking,
  dragging, sprites, MVP-tier text) and §113a (Phase 11 — assets, serialization, UI,
  benchmark harness, docs), closing the hole where Part IX never scheduled the §120 MVP's
  interaction/content/tooling scope; §56 gains an MVP text tier (full shaping staged behind
  a shaping-engine decision); §98 gains a publish-names note (npm `four`/`four-js`
  occupied; `fourjs`/`@fourjs` free 2026-07-29). `tools/check-spec.mjs` allows the new
  lettered sections.
- `docs/plans/IMPLEMENTATION_PLAN.md` → **revision 2.1**: Phase −1 smoke ran the full
  pinned toolchain together successfully; template corrected to split dev/build tsconfigs,
  `pnpm.onlyBuiltDependencies`, validated ESLint config, example wiring, gzip size gate;
  phase table gains 3a and 11 rows, the CI packet gains a non-blocking `pnpm audit` step,
  and Phase 3 records the Playwright + SwiftShader GPU-in-CI strategy.
- `MEMORY.md` — compaction convention added; naming/scope-cut/demo-first decisions
  recorded. `TODO.md` — owner items: merge PR, secure npm names before 0.1; milestone
  items for demo-first, shaping RFC, release workflow.

#### Changed (plan revision 2 + spec revision 1.4)

- `docs/plans/IMPLEMENTATION_PLAN.md` rewritten as **revision 2** after a five-way stress
  test (Haiku dry-run + executability/spec-fidelity/orchestration/design reviews, ~85
  findings): exact toolchain pins (TS 5.9.3, not 7.x), frozen 24-package dependency matrix
  with dispatch waves, `tsc -b` build template with `types`-first exports and `.js` import
  suffixes, design decisions D1–D8 (Node inheritance, component identity, Transform dirty
  channel, Application in `four`, §39 system registry, checksum utility, out-policy,
  projections/slerp), Phase 0 regrown to 15 packets (adds umbrella integration, lockfile
  refresh, Vite example, TypeDoc, root suite wiring), Phase 1 to 14 (adds system registry,
  Application, checksum utility), Phase 2 in full packet format with pinned constructors,
  and a real orchestration protocol (per-packet commits, orchestrator-only installs,
  retries/escalation, independent [S] review, fix-packet convention, RFC gate).
- `docs/SPECIFICATION.md` bumped to **revision 1.4**: §98 Application composition root
  moved from `core` to the `four` umbrella (dependency-direction inversion found by the
  stress test); AGENTS.md package map updated.

#### Added

- `docs/plans/IMPLEMENTATION_PLAN.md` — Phase 0 deliverable (§103; created at the root,
  moved to `docs/plans/` the same day by owner direction), written for subagent-driven
  execution: work packets `WP-N.M` with mechanical Done-checks and [H]aiku/[S]tronger model
  tiers; §1 ground rules distilled from the spec's conventions (§6a/§6b/§7a/§7b, §33, §42);
  Phase 0 (11 packets) and Phases 1–2 (19 packets) fully decomposed; Phases 3–10 held at
  milestone level for rolling-wave decomposition; verification stack table (build/test/
  lint/check-spec/size/determinism). Directory tree verified complete against §98 — no new
  directories needed.

#### Changed (spec revision 1.3)

- `docs/SPECIFICATION.md` bumped to **revision 1.3** after a two-lens adversarial
  verification pass over the 1.1 material (16 unique findings, all fixed): world matrices
  resolve per fixed step, not per frame (§7); pause semantics defined (§10); the replay
  format now records per-frame step counts and dropped time, and §10 cites §34 rather than
  §113; §39 sensor update moved before collision-event dispatch (§6b now step 9);
  previous-pose capture for interpolation defined in §37; collider density authoritative
  over material density (§25); checksum visits existing bodies (incl. sleeping) in monotonic
  body-id order (§33); local-plane→XY mapping stated (§21); marker behavior under
  replay/snapshot-restore defined (§16); reduced motion added to §14; §40 unit options
  restricted to display/authoring conversion; `ForceField.sample` gains `out` (§27); §97
  field of view converted to radians; cameras/viewports assigned to `@fourjs/scene` (§98,
  package README updated); Part VII group renamed "Renderables and 2D Vector Graphics";
  §6 audio marked plugin-provided.

#### Added

- `tools/check-spec.mjs` — mechanical consistency checker for `docs/SPECIFICATION.md`
  (section sequence with frozen 1–120 numbering, duplicates, fence balance, TOC/body
  agreement, §-reference validity, banned pre-revision terms). Intended as the docs job of
  the future Phase 0 CI workflow.
- Phase 0 toolchain decisions recorded in `MEMORY.md` (proposed at owner direction,
  overridable): Turborepo; evergreen browsers + Safari ≥ 16.4, WebGL 2 required, Node ≥ 20;
  Rapier via `@dimforge/rapier2d`/`rapier3d` wasm loaded in `initialize()`, version pinned at
  Phase 5, excluded from the §86 payload budget; size-limit CI gate as a Phase 0
  deliverable; TypeDoc for API docs.

#### Changed

- Scaffold docs synced to specification revision 1.2: `CLAUDE.md`, `AGENTS.md`, `README.md`,
  `docs/ERRATA.md` (scope note — amendments live in the spec's table; the archived PDF is
  formally frozen at the pre-1.0 text), `website/README.md`, and the `core`/`motion`/
  `physics`/`geometry` package READMEs (transform authority incl. `blended`, seconds
  convention, Y-up in both dimensions, component model, revised adapter contract, camera
  rigs in `@fourjs/motion`, unit system in `@fourjs/core`, tessellation as a geometry module).
  Also fixed a pre-existing AGENTS.md error (phase order is Part IX, not VIII).
- `docs/SPECIFICATION.md` bumped to **revision 1.2**: the §86 payload budget (minimal 2D
  application ≤ 150 kB gzip) was confirmed by the owner and its provisional marker removed;
  amendments table updated. `docs/SPEC-REVIEW.md` disposition note updated to match.

### 2026-07-28

#### Added

- `docs/SPEC-REVIEW.md` — technical review of `SPECIFICATION.md` proposing improvements
  R-1…R-35 (contradictions, underspecified designs, missing topics, structure), with a
  suggested disposition order keyed to the implementation phases. Proposals only; the
  specification itself is unchanged.
- `AGENTS.md` — detailed orientation for AI agents and new contributors (repo state,
  architecture reference, package map, implementation phases, guardrails).
- `CLAUDE.md` — guidance for Claude Code sessions.
- `TODO.md`, `CHANGELOG.md`, `MEMORY.md` — root tracking files.
- `docs/archive/` — archive location for the original specification PDF.
- `.claude/settings.json` — registers the `local-marketplace` plugin marketplace
  (`danielsimonjr/skills` on GitHub) and enables three portable skill plugins as project
  defaults: `rfl`, `dev-workflow`, `honest-claude`.
- Directory tree built out from the specification: every `packages/*` package gained a
  `README.md` (responsibilities + spec references) plus `src/` and `tests/` placeholders;
  `examples/` gained the §93 quick-start examples and the two flagship demos (§118–119);
  `tests/` gained `integration/`, `visual/`, and `determinism/` per the §92 taxonomy;
  `benchmarks/`, `tools/`, and `website/` gained purpose READMEs.

#### Changed

- `docs/SPECIFICATION.md` revised to **revision 1.1**, applying all 35 review items from
  `docs/SPEC-REVIEW.md` (owner-directed): contradictions resolved (force API §23/§26,
  authority enums §19/§42 merged into `TransformAuthority` + `"blended"`, 2D gravity sign,
  ms→s time units, `TimeState` completed, accumulator substep clamp); new lettered sections
  6a (Component Model), 6b (Eventing), 7a (Coordinate and Unit Conventions), 7b (Math Type
  Conventions), 60a (Color Management); solver adapter contract extended (destroy/query/
  `drainEvents`, `PhysicsCapabilities` defined); scope settled (audio and networking added
  to §5 non-goals); context-loss handling, precision-at-scale, COOP/COEP, per-backend visual
  baselines, package responsibilities for all 24 packages, Part VII group headings, RFC 2119
  conformance note, Amendments table, and Appendices A (Normative Defaults) and B (Glossary).
  §1–120 numbering unchanged.
- `docs/SPEC-REVIEW.md` header updated with the disposition (all items applied in 1.1;
  §86 payload budget provisional).
- `docs/SPECIFICATION.md` typeset for readability: all 96 code snippets and ASCII diagrams
  fenced (`ts`/`json`/`text`) with indentation restored, `•` bullets converted to Markdown
  lists, the §86 performance targets converted to a real table, and a parts table of
  contents added. Word-for-word equivalence with the pre-typeset text was machine-verified
  (7,257 words preserved exactly); no wording changed.
- `docs/SPECIFICATION.md` rewritten as the **corrected working rendering** of the
  specification (by owner decision): the duplicated `Part VII` became `Part VIII` with later
  parts shifted to IX–XIII (E-1); the twice-assigned section range 45–67 renumbered +53 to
  §98–120, giving one sequence 1–120 (E-2); §102 (Solver Packages) aligned with the monorepo
  tree — `physics-rapier` and `physics-box2d` only (E-3); extraction artifacts repaired
  (kerning splits, ligature, mid-word line-break hyphens); Markdown headings added.
- `docs/ERRATA.md` rewritten as a correction log with a PDF→Markdown numbering map; all
  three defects (E-1, E-2, E-3) marked resolved.
- `README.md` updated to present `SPECIFICATION.md` as the working reference and the PDF as
  the archived original.
- `docs/four-js-specification.pdf` moved unchanged to `docs/archive/`.

### Earlier

- Initial commit: directory scaffold (24 empty `@fourjs/*` package directories, empty
  `examples/`, `benchmarks/`, `tests/`, `tools/`, `website/`), specification PDF and
  extracted Markdown, `ERRATA.md`, `README.md`, MIT `LICENSE`.
