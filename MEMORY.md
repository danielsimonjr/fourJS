# MEMORY

Persistent memory for agents and contributors working across sessions: decisions made, facts
that are easy to lose, and conventions in force. Append new entries with a date; never silently
rewrite a recorded decision — supersede it with a new entry. Tasks go in `TODO.md`; released
changes in `CHANGELOG.md`. **Compaction convention (2026-07-29):** at each phase close (see
the implementation plan), the orchestrator may collapse superseded/expired entries into a
one-line pointer at their original position ("superseded by <date> entry") so this file stays
readable; never delete the pointer itself.

## Standing facts

- The repository is **fully implemented** (implementation plan complete 2026-08-02; this
  bullet said "scaffold only" until 2026-08-05 — it predated Phase 0): 24 packages build,
  test (~3,000 unit + suites + browser/visual), and lint, with ≥95% coverage gates. Four
  packages are deliberate reserved stubs (physics-box2d/soft, render-canvas/svg).
  `render-webgpu` left that list 2026-08-21…29 (the R-1 plan; standing-fact wording
  corrected 2026-08-30).
- `docs/SPECIFICATION.md` is the working reference — the current revision is whatever tops
  its amendments table (1.15 as of 2026-09-10; do not freeze the number in other files)
  (amendments table at its top; § numbering 1–120 frozen, lettered sections for insertions).
  `docs/archive/four-js-specification.pdf` is the unmodified original, frozen at the pre-1.0
  text, and still contains the old duplicate numbering — translate its references via the map
  in `docs/ERRATA.md`. Run `bun tools/check-spec.mjs` after any spec edit.
- Plain "§N" citations mean `SPECIFICATION.md` numbering. Cite the PDF explicitly when meant
  ("PDF §49, second range").
- All 24 packages under `packages/` are `@fourjs/`-scoped; `four` is the umbrella package.
  Layering: stable `@fourjs/physics` API above solver adapters; backend-independent `@fourjs/render`
  above `render-*` backends; the logical scene never depends on a concrete backend.

## Decisions

- **2026-09-10 — Hemisphere light (§68).** `HemisphereLight` is a
  two-colour directional ambient, not a punctual slot. First-match like
  the sun. Sky axis is the node's **+Y** (world up), deliberately not the
  −Z shine axis. GL: `HemisphereLightUniforms` skip-when-absent.
  WebGPU: pack at 672 in the existing 768-byte stride; do not move the
  shadow tail (592–672) or `LIGHT_UNIFORM_BYTES` (592). Binding size
  widens to `LIGHT_BINDING_BYTES` (720). Metals stay black under
  hemisphere alone (ambient-reaches-diffuse-only). Do not close the
  lighting checkbox.

- **2026-09-10 — WebGPU skinned shadow caster (RFC 0003).**
  `SkinnedPrograms.acquireShadow()` compiles a private depth-only
  pipeline (palette group 1, `skinMatrix(joints, weights)`, clip-depth
  remap). `WebgpuRenderer` still imports only the registry. Fail-once
  skip, never bind-pose. GPU morph / CPU skinning / bone-texture remain;
  do not close the RFC 0003 checkbox.

- **2026-09-10 — Open-TODO audit: 11 still open, 260 closed.** A
  subagent-team review of every `- [ ]` row against source. Closed
  **RFC 0005 residue**: WebGPU skinned id pass (`wgpu-picking.ts`,
  private pipeline, `skinMatrix()` + 3072-byte palette group at bind
  group 1, fail-once skip, never bind-pose). Same-day slice on the
  still-open batching row: WebGPU idle-skip (`WgpuBatching.#canSkipUpload`,
  per-slot `contentVersion`; `0` always uploads). The other 11 cannot
  close: dogfood is standing; first publish is owner-gated (no git tag,
  nothing on npm); R-33 still needs non-SwiftShader; RFC 0001/0003/0004,
  lighting, R-1 deferred, batching, R-30c, and §96 each still have named
  remaining slices (GPU morph / CPU skinning / bone-texture / WebGPU
  skinned shadow; cube/array/3D and compressed/video/async; extra
  directionals / cascades / PBR rest). TypeDoc/`typescript@6.0.3`
  isolation stays in Priority-index tier 4, not a new checkbox. RFC
  0007/0008/0009 stay Proposed. Do not re-triage the 11 as quick wins.
  Same-day doc-drift follow-up (not a packet close): §96 decompression
  guide row absent → partial; GPU radial field no longer called staged;
  lighting-aware graphs no longer wait on a missing R-17 contract;
  `angle` / §58 paint struck from the custom-shaders deferred list;
  spec revision 1.15.

- **2026-09-09 — Open-TODO audit: 12 still open, 257 closed.** A
  subagent-team review of every `- [ ]` row against source. None of the 12
  packets can close: dogfood is standing; first publish is owner-gated
  (no git tag, nothing on npm); R-33 still needs non-SwiftShader; RFC
  0001/0003/0004/0005, lighting, R-1 deferred, batching, R-30c, and §96
  each still have named remaining slices (WebGPU skinned id/shadow skip;
  GPU morph / CPU skinning / bone-texture absent; cube/array/3D and
  compressed/video/async absent). Header closed-count was 249 — seven
  `[x]` rows had never been added. Hygiene only: stale “remaining”
  sentences on closed rows (rigs, PH-11c, scissor, `recording-gl` adopt,
  flagship §46 layers, WebGPU `maximumSkinningJoints`) and Priority-index
  leftovers (A-4/A-5/A-19, R-32, camera-rig residue, particle-trail
  spatial-hash). Remaining-work wording follow-up: R-17 point/spot
  (8 punctual) is not “multi-light still open”; §27 GPU fields /
  depth-buffer are stub-tier; §96 shader trust is the closed union
  (extensible operators still deferred); WebGPU batch idle-skip absent.
  Do not re-triage the 12 as quick wins.

- **2026-09-09 — WebGPU skinned colour pair (RFC 0003).** Opt-in
  `registerSkinningPipeline()` from `@fourjs/render-webgpu`. `WebgpuRenderer`
  imports only `wgpu-skinning-registry.ts` (pipeline-cost law). Palette is
  a separate 3072-byte bind group (`48 × 64`), `hasDynamicOffset`, vertex
  stage only — `DRAW_UNIFORM_BYTES` stays 192. Group index after existing
  groups: unlit 1, unlit+map/lit 2, lit+map 3. Joints `@location(4)`
  `uint16x4`, weights `@location(5)` `float32x4`; LBS, weights not
  renormalized. Classes are not named `SkinnedUnlitProgram` /
  `SKINNING_GLSL` (`graph:duplicates`). Unregistered or factory failure
  skips, never bind-pose. Shadow caster and RFC 0005 id pass still skip.
  `maximumSkinningJoints` is reported. RFC 0003 checkbox stays `[ ]`.

- **2026-09-09 — WebGL `StandardMaterial.emissiveMap` on unit 3.** Packed
  glTF factor × texture (sRGB). Allocator: 0 albedo, 1 shadow, 2 MR, 3
  emissive. Uniform switch `useEmissiveMap` (R-19), not a shader variant.
  Unresolved/disposed map degrades — the draw continues, matching albedo
  / MR. glTF `emissiveTexture` is decoded sRGB and dropped from
  `ignoredTextures`. WebGPU does **not** sample it: groups 2 and 3 already
  hold albedo and MR when both maps exist, and the four-group budget is
  full. No fifth bind group. Occlusion stays staged (no AO term); normal
  stays staged (tangents). Lighting leftover checkbox stays `[ ]`.

- **2026-09-09 — Dogfood cycle 7: WebGL skinned GPU picking.** Read from
  a consumer seat. `registerPickingPipeline` + `registerSkinningPipeline`
  then `createPickingService`. One-bone plane, bone +1 Y: id pass uses
  `SKINNING_GLSL` + `pickId`, uploads the live palette (y-translation
  1, not bind pose). Unskinned control id/colour transcripts are
  identical with or without the skinning seam. Recording GL cannot
  rasterise, so deformed-vs-bind hit/miss is staged texels + the
  silhouette claim is the program. Engine clean. Guide index patched.
  WebGPU still skips skinned items. Standing checkbox stays `[ ]`.

- **2026-09-09 — R-30c map roles.** Optional `TextureMapRole` `"color"` |
  `"data"` on `TextureSource` / `Texture.role`. Omitting `role` invents
  **no** default and leaves `colorSpace` at R-15's `"linear"` — that is
  the golden-stability rule, not a missing default. `role: "color"` with
  no `colorSpace` resolves to `"srgb"`; `"data"` stays linear; an
  authored `colorSpace` always wins. Backends still sample
  `texture.colorSpace` only; glTF already passes `"linear"` for
  metallic-roughness. Invalid role is `RangeError` via `validateEnum`
  (same as filter/wrap). R-30c checkbox stays `[ ]` (cube/array/3D,
  compressed, video/`ImageBitmap`, async upload).

- **2026-09-09 — `wgpu-picking.ts` on the `GATED` list.** Wave 5's WebGPU
  picking id pipelines wrap compile-failure notices in `if (DEV)` (mesh
  + particle). `gl-picking.ts` was already listed; the WebGPU twin was
  not, so `tests/integration/dev-build-mode.test.ts` failed on #87.
  Argument matches the WebGL entry: failure latched in both builds,
  picking is a §34 input, nothing an id pass draws re-enters simulation
  (§42/§43).

- **2026-09-09 — RFC 0005 WebGL `SkinnedIdProgram`.** The id pass draws
  skinned-unlit / skinned-lit items through a deformed silhouette
  (`SKINNING_GLSL` in `gl-skinning-glsl.ts`, spliced into the id
  fragment). Lives in `gl-picking.ts` so `registerPickingPipeline` does
  not link the colour pair. Lazy compile, fail-once skip, same palette
  upload as the colour pass. WebGPU still skips: no RFC 0003 skinned
  pipelines there. RFC 0005 checkbox stays `[ ]`.

- **2026-09-09 — Size budgets after #86.** Main CI failed at `bun run size`
  with the browser gate green (107/107). particles-demo 43.04/43 kB (+38 B),
  ui-demo 49.51/49.5 kB (+11 B). Limits 43.5 / 50 kB. first-3d holds.
  PickProvider and the WebGL particle id arm ride those two graphs.

- **2026-09-09 — Open-TODO wave 5, simple → complex.** Twelve checkboxes
  remain; three slices landed without pretending the packets closed.
  (1) RFC 0005 WebGPU particle id: one id per emitter, private pipeline
  (not exported as `ParticleIdProgram`); 208-byte `PARTICLE_ID_*` block;
  CPU 8-float stream; trails / GPU-sim / wide stream skip. Remaining:
  WebGPU skinned id pass (needs RFC 0003 skinned pipelines). (2) Lighting leftover: WebGPU
  samples `StandardMaterial.metalRoughnessMap` (G=roughness, B=metalness);
  group 3 with albedo, group 2 without (`shadedMrBindingWgsl`). `|mr:y`
  only when true. Remaining: multi-light / cascades / PBR / §60a / light
  layers / other texture slots. (3) Dogfood cycle 6 sat on §43 palettes;
  engine clean; guides patched; standing checkbox stays open. First
  publish and R-33's §112 exit stay blocked.

- **2026-09-09 — WebGPU particle id arm (RFC 0005 residue).** One id per
  emitter, mirroring WebGL's `ParticleIdProgram` without exporting that
  class name (`graph:duplicates`). `PickingRendererHost.particles()` is
  the live `WgpuParticleCache` accessor. Mesh `IdUniforms` stay 144
  bytes; the particle id block is 208 bytes (projection 0 / view 64 /
  model 128 / pickId 192) in the 256-byte stride. Billboard vertex math
  is `PARTICLE_SHADER_SOURCE`'s. Default 8-float CPU stream only; trails,
  GPU-sim layouts, and the R-32 wide stream skip. WebGL now draws
  skinned ids (`SkinnedIdProgram`); WebGPU still skips (no RFC 0003
  skinned pipelines). RFC 0005 is not closed.

- **2026-09-09 — Dogfood cycle 6: §43 interpolated skin palettes.**
  Read from a consumer seat. `Skeleton.update(skinRoot, worldOf?)` and
  `buildInterpolatedRenderList` compose interpolated local poses, then
  run the palette product. Palettes are never matrix-lerped; scene
  transforms are unchanged. Engine clean. Evidence:
  `tests/integration/interpolated-skin-palettes.test.ts` (two-bone, 90°
  hip; mid-alpha ≠ lerp of endpoints). Guides and architecture docs
  patched. Standing dogfood checkbox stays open.

- **2026-09-09 — WebGPU samples `StandardMaterial.metalRoughnessMap`.** Packed
  G=roughness / B=metalness, matching WebGL unit 2. Bind-group index is
  **3 when albedo occupies group 2, 2 when it does not** (`shadedMrBindingWgsl`).
  `|mr:y` appends to the pipeline key only when true, so scalar-only
  transcripts stay byte-identical. Unresolved named maps skip the draw.
  `normalMap` / `occlusionMap` / `emissiveMap` remain unstaged. Lighting
  follow-ups stay open.

- **2026-09-09 — WebGPU browser gates follow `DRAW_UNIFORM_BYTES`.** The
  Playwright page programs are not the renderer: they bind their own
  layouts. After `DrawUniforms` grew to 192 bytes (`normalMatrix` at 144)
  and sprites dropped `quad` (R-19/R-20), six `[webgpu]` specs still
  declared `minBindingSize: 144` and the sprite gate still used a 160-byte
  quad uniform with position-only vertices. Validation: "shader uses more
  bytes than minBindingSize" and "vertex attribute slot 2 not present".
  Harnesses now import `DRAW_UNIFORM_BYTES` / `SPRITE_UNIFORM_BYTES` and
  authored uv at `@location(2)`. Node-material 144-byte prefixes are a
  different block — leave them.

- **2026-09-09 — Open-TODO wave 4, simple → complex.** Twelve
  checkboxes remain; four slices landed without pretending the packets
  closed. (1) RFC 0003 §43: `Skeleton.update(skinRoot, worldOf?)`;
  interpolated collect composes local poses then the palette product
  (never matrix-lerps palettes; scene transforms unchanged). (2) RFC
  0003 WebGL skinned shadow: `SkinnedShadowProgram` via
  `pair.acquireShadow()` on the first caster (third `createProgram`);
  colour pair still compiles on first colour draw; `gl-shadow.ts` does
  not import `gl-skinning.ts`. Unregistered still skips. WebGPU has no
  skinned pipelines. (3) RFC 0005 WebGPU `PickingService`: the same
  `registerPickingPipeline()` seam as WebGL; `mapAsync` 1×1 readback;
  skips particles and skinned items. (4) Dogfood cycle 5 sat on GPU
  pick / PickProvider; engine clean; cameras guide and package READMEs
  patched. Remaining: RFC 0005 WebGPU `ParticleIdProgram`; RFC 0003
  GPU morph / CPU skinning / bone-texture. First publish and R-33's
  §112 exit stay blocked.

- **2026-09-09 — Open-TODO second wave, simple → complex.** Twelve
  checkboxes remain; three slices landed without pretending the packets
  closed. (1) Lighting leftover: WebGPU `DrawUniforms` is 192 bytes
  (`normalMatrix` at 144, std140-padded mat3); `StandardUniforms` 224
  (emissive 192, surface 208); sprites stay 144. Lit/standard vertex
  stages read `draw.normalMatrix`; `NORMAL_MATRIX_WGSL` stays exported
  and is not spliced. `#writeBlock` uses a module-level `Matrix3`
  scratch and `setNormalFromMatrix4` (identity on null/singular).
  (2) RFC 0005 `ParticleIdProgram`: `collectPickCandidates` includes
  `isParticleDrawable`; WebGL id pass instances the §36 billboard with
  one `pickId` per emitter; skinned still skipped; trails not drawn.
  (3) §72: optional `PointerInputOptions.pickProvider`; default
  handlers stay fully synchronous; provider path copies the event and
  serializes per `pointerId`. Remaining on those rows: WebGPU
  `PickingService` `mapAsync`; multi-light / cascades / PBR / §60a.
  First publish and R-33's §112 exit stay blocked.

- **2026-09-09 — R-19/R-20 closed (§55 authored sprite uvs).** `Sprite`
  writes a 4-vertex `uvs` stream (`frame / textureSize`, or 0…1 if
  frameless). WebGL `SpriteProgram` and WebGPU sprite WGSL sample
  `@location(2) uv`. `uniform vec4 quad` and `SPRITE_QUAD_OFFSET` are
  gone. `setFrame` is a no-op when unchanged; a real change
  `markDirty()`s so GeometryCache re-uploads eight floats. Trade-off vs
  the 2026-08-08 affine-quad design: animation clips no longer get a
  zero-upload frame flip. Texture/material stay shared. Graph regen
  dropped the export.

- **2026-09-09 — Stale-item honesty on two follow-ups.** The batching
  "still scene re-uploads every frame" sentence was false:
  `contentVersion` + `#canSkipUpload` already skip `bufferSubData` on
  an idle batched run (tested). §52 already caps concave extrudes;
  `polygonGeometry2D` already takes holes. Struck both. Remaining on
  those rows: shaded instancing, atlas grouping, default-on batching,
  §55 authored sprite uvs.

- **2026-09-09 — Open-TODO first wave, simple → complex.** Thirteen
  checkboxes remain; four slices landed without pretending the packets
  closed. (1) Lighting: `Matrix3.setNormalFromMatrix4` + WebGL
  lit/standard hoist; singular models upload identity; WebGPU stays
  per-vertex cofactor until `DrawUniforms` widens (144 → ~192).
  CSS light colors were already shipped (`parseColorRGB`). (2) RFC 0005
  §86: `benchmarks/pick-latency.mjs` — N=64 id-pass ≈ list (1.03×);
  10k–100k ≈ 3–4×; fence vs stall is JS+seam only (no host WebGL 2).
  (3) R-33: `data-simulate` / `data-present` seconds on particles-demo;
  gate asserts existence, not 16.6 ms. (4) Dogfood cycle 4: the three
  leftover surfaces work; `digital-twin.md` taught the throwing save.
  First publish and R-33's §112 exit stay blocked.

- **2026-09-09 — tools/docs must stay on typescript@6.0.3.** Dependabot #82
  bumped it to 7.0.2 with the root. TypeDoc 0.28's peer is 5.0–6.0; CI died
  on `PropertyDeclaration`. Isolation is a version pin, not a directory.
  `check-compiler.mjs` refuses anything else. Root 7.x is free to move.

- **2026-09-09 — RFC 0003 prototype measurements recorded.** Bones-as-nodes
  at 60 ×1/×10 is within noise of ordinary Groups at ×10; alternative A does
  not return. 180-channel controller is ~0.03 ms/step on the recording host,
  within 0.002 ms of the mixer. Proposed §86: 227 independent 60-bone
  characters inside one 60 Hz step (host-specific, not a gate).

- **2026-09-09 — Vitest 5 particles follow-up.** Landing the bump on the
  five named failures left `@fourjs/particles` at 92.1% branches
  (455/494) under honest v8 remap — CI `bun run coverage` caught it.
  The misses were real: `copySizeRamp` / `copyColorRamp` reject `t`
  outside `(0, 1)` and unsorted stops; `evaluateLifetimeRamp*` empty
  `stops` and the after-last-stop `span <= 0` guard (NaN age past a
  stop at `t >= 1`); `ParticleTrailStore` out-of-range
  `readSample` / `#assertSlot`; `buildTrailRibbonMesh` `sampleCount < 2`;
  `ParticleRenderable.computeBounds` non-positive lifetime. Re-measured
  **97.16% branches (480/494)**. Gate unchanged. Lesson: remasure every
  package, not only the ones a local Vitest 5 probe named.

- **2026-09-09 — Vitest 5.0.0 landed.** The coverage campaign closed the
  last honest gap: physics-rapier branches 95.26% (724/760) after
  `rapier-defensive-branches.test.ts` (countContacts + snapshot-envelope
  guards). physics 97.27%, render-webgl 95.57%, text 100%, render 97.59%.
  `vitest` and `@vitest/coverage-v8` bumped together. Gate unchanged at 95%.
  Oxlint `**/tests/**` now also allows `typescript/no-unsafe-*` — Vitest 5
  mock types trip them; `tsc -p tests` is still clean. Package test
  tsconfigs set `"types": ["node"]` because Vitest 5 dropped the Node
  triple-slash that 3.2.7 shipped (TypeDoc/TS 6 typechecks those tests).
  Supersedes the same-day "second measurement / bump still waits" note.
  **Same-day follow-up:** particles was a sixth miss — see the entry above.

- **2026-09-09 — Vitest 5 coverage campaign, second measurement.** After
  executing the previously-unrun Rapier init reject path, stale-handle
  context, and R-32 particle appearance/wide-stream/trail branches, four of
  the five failing packages clear 95% under Vitest 5. Remaining: physics-rapier
  global branches 92.1% (adapter defensive paths). Bump still waits.
  **Superseded the same day — see the 5.0.0 landing entry above.**


- **2026-09-09 — Browser-gate follow-up on the open-TODO PR.** Pause-during-
  grab was not enough: `waitForVirtualFrameCount` pumped the patched rAF and
  aliased even frames only. Host rAF (`__fourHostRaf`) is the pump. Character
  walk test had the same wall-clock starvation the look test already fixed —
  wait on settled `data-pz`, not `waitForTimeout(4s)`.

- **2026-09-09 — Open-TODO contained-item pass.** Smoothness flake was
  screenshot-stride aliasing against the period-2 virtual clock, not
  dropped-time; pause rAF during `grab()`. §79 diagnostics name authored type
  strings only — never `constructor.name`. Oxlint correctness warnings triaged
  to zero (fixes + test-scoped allow for `no-unsafe-optional-chaining`). The
  12.8s barrels duration is under an explicit 30s suite timeout; application
  9809ms is a file aggregate. A-5 `auditFinalizedLeaks` stays opt-in (finalizers
  are nondeterministic). A-19 merged into R-30c. Still open: RFC residues,
  lighting/batching/§77/§96/tessellation packets, R-33 (hardware), first
  publish (owner), dogfooding map (standing), vitest 5 coverage campaign.

- **2026-09-07 — Size budgets after #76.** `bun run size` sits after
  `test:browser`, so #76/#77 never measured the Rapier 0.20 wasm jump.
  CI 34068239028: first-3d 42.1, particles 42.21, ui-demo 48.47 kB;
  flagship 1.98, twin 1.22, character 1.15 MB. Limits 43 / 43 / 49.5 kB
  and 2.05 / 1.25 / 1.20 MB. first-2d 56.23/150 unchanged. Browser gate
  on that run was 105/105 after the assertion retune.

- **2026-09-06 — Browser-gate leftovers from #76.** The four Chromium
  failures on `cursor/ci-fix-after-merge-8caa` were #76-on-main fallout
  (Docs / graph died first on that PR, so `test:browser` never ran). Twin
  `contacts` is produced by `recordSolverStatistics` now — assert finite
  ≥ 0, keep `gpuframe` as `nan` on SwiftShader. Playground settle keeps
  `SETTLED_CENTROID_TOLERANCE` (0.25) and drops `toBeCloseTo(..., 1)`.
  Impulse rise is 0.5 after a recorded 0.85 on 0.20. Flagship panel
  chrome is glyphs with `x ≥ PANEL_LEFT_EDGE`; left-side HUD in the
  lower 60 % is world glyphs.

- **2026-09-06 — R-32 particle offsets are allowlisted duplicates.**
  `PARTICLE_WIDE_INSTANCE_FLOATS` / `PARTICLE_ROTATION_OFFSET` /
  `PARTICLE_SOFTNESS_OFFSET` sit in both `@fourjs/particles` and
  `@fourjs/render` for the same matrix reason as `PARTICLE_INSTANCE_FLOATS`
  (no particles↔render edge). Drift stays test-pinned.

- **2026-09-06 — A-4 FinalizationRegistry lives in `@fourjs/core`.**
  `trackDisposable` / `disposeTracked` / `auditFinalizedLeaks` moved out of
  `@fourjs/diagnostics` so Texture, CanvasTexture, RenderTarget,
  BufferGeometry, and Material can register at construction without a
  forbidden diagnostics edge. Package `resource-memory` helpers wrap the
  calls in `if (DEV)` so production DCE drops the registry from
  Texture-carrying bundles. `auditFinalizedLeaks` stays opt-in (same
  shape as `auditResourceLeaks`); constructors capture the stack as the
  creation site. `trackedDisposableId` is the test hook because
  constructors do not return the registry id.

- **2026-09-06 — A-1 `gpuFrameTime` is last-completed-frame seconds.**
  `Renderer.lastGpuFrameTimeSeconds` is optional; reading the getter arms
  measurement (R-30b: unread → no extra GPU commands). WebGL 2 uses
  `EXT_disjoint_timer_query_webgl2` (discard on `GPU_DISJOINT_EXT`).
  WebGPU requests `timestamp-query` when the adapter has it and times the
  views pass with a resolve/copy/mapAsync ping-pong. `Application` copies
  a finite number into `stats.gpuFrameTime` and leaves `NaN` otherwise.

- **2026-09-06 — PH-22f live joint anchors are body-local.** `setAnchors`
  and the field setters take the same local frames `addJoint` stores after
  converting world-space constructor options. They are not re-measured
  against current or authoring world poses. The world drains them through
  `SolverJointAccess.setJointAnchors` (Rapier `setAnchor1`/`setAnchor2`).
  Axis / rope length / spring terms / swing cone stay frozen.

- **2026-09-06 — A-5 materials / solver-handle counts.** Process-wide
  `liveMaterialCount` and `liveSolver{Body,Collider,Joint,Handle}Count` are
  always-on numbers (no `DEV` in those packages). `auditResourceLeaks` still
  gates the *message*. No new `FrameStats` fields.

- **2026-09-06 — RFCs 0007–0009 proposed (owner pending).** Path-planning
  adapters (`0007`: waypoint polyline + `followWaypoints`, grid/navmesh later);
  §56 shaping (`0008`: optional HarfBuzz-compatible WASM, identity default);
  GPU readback as a raster source (`0009`: between-frames `refresh()` snapshot,
  display-only, no feedback). Implementation waits on acceptance.

- **2026-09-10 — RFCs 0007–0009 corrected; subagent plans written.** Standing
  facts the review pinned (each was wrong in a draft): `DeterminismLevel` is
  declared in `@fourjs/physics`, unreachable from motion — motion-side
  contracts spell their own literal union; the umbrella's specifier is
  `fourJS/…` (`packages/fourjs/package.json`), `four` is only the workspace
  nickname; `layoutText` iterates code points (`for…of`); `FourErrorCode` is
  an open union — reuse `NOT_IMPLEMENTED` for staged API rather than minting
  codes; `Renderer` has no begin/end-frame pair (`render` is the frame);
  `tests/integration/raster-display-only.test.ts` is a fixed `FORBIDDEN`
  identifier list, so new raster-tier names must be added to it; no
  workspace tsconfig pins `lib`, so "DOM-free" is a seam rule, not a compiler
  guarantee; Roboto is Apache-2.0, Noto Sans is OFL. Plans live in
  `docs/plans/RFC-000{7,8,9}-*_PLAN.md`: ≤ 4 agents, disjoint file ownership,
  waves, an anti-hallucination table per plan citing file:line, and "stop and
  report" rules for network-gated steps (harfbuzzjs install, Noto download).

- **2026-09-06 — Rapier 0.20 goldens re-recorded.** Deliberate solver bump
  (the exception each golden's `_warning` names). Values came from the
  scenario helpers, not from editing hashes by hand. 0.20 contact persistence
  and first-contact timing (step 35) are accepted behaviour. Simulation
  packages (`scene`, `physics`) must not import `DEV`/`devWarnOnce` — the
  detached-listener and stale-handle warns are unconditional `console.warn`
  with a WeakSet/Set once-suppress.

- **2026-09-06 — open-TODO subagent pass (fourth landing).** Decisions
  executed rather than re-parked: Rapier 0.20 adopted (measured goldens);
  PH-11c push is reduced-mass + wake; CameraShake uses interpolated
  value-noise at `simulationTime`; local-plane default is XY; NodeSpace
  ships with its serializer; A-25 stubs are published as real 0.x
  packages; A-13 mirror is opt-in `DocumentLike`; A-18 worker/watch are
  injected seams. TypeDoc still has no TS 7 support (typedoc#3098);
  `NPM_TOKEN` remains an owner secret.

- **2026-09-06 — open-TODO subagent pass (third landing).** Six parallel
  agents landed: Windows animation gate (simulation-bound `#status` sampling,
  not screenshot throughput); `buildRenderList` sort skip + sprite fast path;
  size budgets with measured A/B in `tools/size-budgets.mjs`; Rapier upstream
  types via `moduleResolution: bundler`; partial A-4/A-5 (validation catalogue,
  format-aware render-target bytes); CPU particle trails. Still owner-gated or
  deferred: rapier 0.20, typedoc/TS 7, first publish, RFC residues, PH-11c,
  batching follow-ups, GPU particle items.

- **2026-09-06 — TODO sprint: actionable items closed; ~45 remain blocked
  (#73).** Subagent sprint landed A-5 §83 dev warnings (`warnDisposedInUse`,
  `rejectStalePhysicsHandle`, `auditFrameAllocations`, detached-node listener
  warn), `SpatialHash` (WP-8.2), size-budget bumps, auto-selection WebGPU
  integration test, and camera-rigs docs.

- **2026-09-06 — SpatialHash lives in `@fourjs/motion` (WP-8.2).**
  Explicit rebuild (`clear` + `insert` / `update`); query returns insertion order
  for §33 determinism; cell size is caller-chosen (no default). Steering flocking
  behaviours stay agnostic — they accept `Iterable<SteeringNeighbor>` from brute
  force or this index.


- **2026-09-06 — §42 warn stays off the DEV flag.** A-4 step 4
  routed `warnAuthorityConflict` through `devWarnOnce`, which
  `dev-build-mode.test.ts` refuses in `@fourjs/scene` (simulation
  envelope). The WeakMap still suppresses once per node per writer;
  the message is unconditional `console.warn`. Production prints the
  first conflict. `asset-manager.ts` stays on `devWarnOnce` and is
  on the GATED list — assets is IO.

- **2026-09-06 — R-36 size-budget TODO closed; limits at 38.5/37/45.5 kB.**
  The 2026-08-09 proposal (31.5→32, 37→37.5, 29→29.5 kB) was absorbed through
  R-8 and later bumps (38/36.5/45 kB). Fresh A/B measured
  38.18/36.77/45.27 kB gzip; +0.5 kB headroom each restores green. Growth is
  #70's field torque / unlit blend / metal-roughness path, not the smoothness
  waiter.

- **2026-09-06 — smoothness virtual-frame wait cannot use `waitForFunction`.**
  `useVirtualFrameClock` replaces `requestAnimationFrame`. Playwright's
  `waitForFunction` defaults to `polling: "raf"` and never observes
  `__fourVirtualFrames` moving — CI hung 120 s on `b55a8c1`. Poll through
  `page.evaluate`, pump one real rAF per poll, and wait for `start + 1` (parity-
  against-stale-`since` also failed when two increments landed per pump).


- **2026-09-06 — unlit `color` is read after bind + features (F13).**
  `unlitColorBlends` must not run before the texture unit and
  `setFeatures` mirrors are borrowed. A throwing `color` accessor is
  F13's mid-draw raise; blend still applies before `draw*`. Metal-
  roughness restore on unit 2 skips `activeTexture(TEXTURE2)` only when
  that unit is still active (no unit-0 restore in the same `finally`).

- **2026-09-06 — §83 dev-warning tier (A-5 remainder).** Four of six §83
  development warnings now ship: `warnDisposedInUse` in render backend caches;
  `Node.#detach` + `listenerCountAll` for detached nodes retaining listeners;
  `rejectStalePhysicsHandle` in Rapier/fake adapters; `auditFrameAllocations`
  (+ `Application.step` when stats on). Still open: explicit leaked-resource
  warn (derivable from A-5 counters via `auditResourceLeaks` only), creation-
  site capture, FinalizationRegistry.

- **2026-09-06 — §83 duplicate-load warns on a settled cache hit.**
  Concurrent `load`s of the same key coalesce without a warning — that
  is the API. A later `load` of a slot that already decoded is the
  authoring mistake §83 names; `devWarnOnce` keys
  `asset-dup:${url}:${loader.name}`.

- **2026-09-06 — field torque is a second method; waking is per-entry OR.**
  §27's `sample` stays one linear vector so a `ParticleForceField` remains
  assignable. `ForceField.sampleTorque` is optional and always N·m —
  `"acceleration"` units would need the inertia tensor, which a field does
  not have. `wakesSleepingBodies` is per registration, default off. Two
  entries that disagree do not share a visit: persistent gravity cannot
  wake a pile just because an explosion field is also registered. A zero
  sample does not wake; `applyForce`/`applyTorque` still do not wake
  (WP-5.2), so a non-zero waking contribution calls `RigidBody.wake()`.
  `forEachSleepingDynamicBody` is the complementary walk.

- **2026-09-06 — §42 authority conflicts go through `devWarnOnce`.**
  Superseded the same day: `@fourjs/scene` cannot import `DEV`. See
  "§42 warn stays off the DEV flag" above.

- **2026-09-06 — PoseTarget scale blends against identity.** A solver
  body has no scale, so the invented physical side is `(1, 1, 1)`. At
  `animationWeight === 1` the node's `transform.scale` is
  `PoseTarget.scale`; at `physicsWeight === 1` it is identity; between,
  a lerp. Pivot stays off the target. §79 omits identity so documents
  written before the channel stay byte-identical.

- **2026-09-06 — rotational root motion is local composition.** A
  quaternion root-motion track extracts `conjugate(previous) * sampled`
  and `transform.rotation.multiply(delta)`. That is the same space
  translation uses (`position.add`). Identity start + 90° Y over one
  loop, twice, lands at 180° Y. The 2026-08-02 `NOT_IMPLEMENTED` throw
  is gone.

- **2026-09-06 — §67 scissor is a render-list field, not a stencil.**
  `SCISSOR_TEST` was already on per view. The missing piece was a per-item
  rectangle intersected with `view.rect`. Coordinates stay §48 / §7a
  (bottom-left); WebGPU flips on the way in, as it already does for the
  view rect. Default-off keeps every existing transcript test identical.
  Stencil `clip = true` still composes: a node can punch a path mask and
  also restrict pixels to this rectangle.

- **2026-09-06 — open-TODO pass, second landing.** The diagnosed browser
  flakes were sampler defects, not physics: smoothness now picks virtual-frame
  parity; blending watches the page's `data-chain-y` instead of screenshot
  throughput. README snippet is a Playwright spec (two-colour threshold —
  one unlit circle on a uniform clear). `check-docs` now fails if the 24
  package count, suite-count table, or AUDIT-120 census drift. Metallic-
  roughness is the second WebGL texture unit; remaining glTF slots
  (normal/occlusion/emissive) stay warned-inert. Unlit blend is on only
  when alpha or `transparent` asks. **Owner-gated items are no longer
  parked:** the next pass implements them (scissor, PoseTarget scale,
  rotational root motion, A-25 stub `files` allow-list, RFC residues,
  rapier 0.20) rather than waiting. Secrets (`NPM_TOKEN`) and typedoc's
  TS 7 peer still cannot be invented here.

- **2026-09-06 — open-TODO pass, first landing.** Four items closed without an
  owner product decision: Windows Chromium binary layouts + lazy barrel imports
  + slower-runner timeouts; a Dependabot-only workflow that regenerates
  `bun.lock` (does not weaken `--frozen-lockfile` on CI); A-26's generated
  renderer-backend table, read before `initialize` so device-derived WebGPU
  fields stay at the construction-time floor (captioned, not claimed as "cannot");
  Rapier `inheritVelocityFrom` documented as nearly a no-op. **Isolation
  leak:** unrestored `vi.spyOn(console, "warn")` in two physics files —
  Vitest 4 keeps the spy history, Vitest 3 did not. Not leftover worlds.
  `#62` and `eslint >=10` are unblocked on that axis; the typedoc/TS 7
  joint pin remains. Remaining packets still in flight: diagnosed flakes,
  scissor, §59 textures, field batching, docs gates. Owner-gated items
  (first publish, rapier 0.20, typedoc/TS 7, A-25 secrets, RFC residues)
  stay owner-gated. Superceded for remaining-packet policy by the
  2026-09-06 second-landing entry.

- **2026-09-06 — three headline claims verified FROM OUTSIDE the library, against the published
  packages.** Not the repo's own suite: the staged `@danielsimonjr/fourjs-*` tree laid out in a
  clean consumer's `node_modules`, importing published names only.
  - **§33/§34 determinism holds.** Two independently built worlds, 9 bodies, 300 steps with
    collisions and stacking → identical checksums (`4186985384`), while a 0.0001 perturbation gave
    a different one. The control is the point: without it, "the checksums matched" is equally
    consistent with a constant.
  - **§34 snapshot/restore is bit-faithful, and the restored world evolves identically.** Checksum
    after restore equalled the checksum at snapshot (`3990209039`), and continuing 120 steps from
    the restored world reproduced the live world's checksum exactly (`1175110499`). Control:
    continuing changed the checksum, so the equality is not trivial.
  - **§7a's Y-up-in-2D convention is real.** A 2D body falls in −Y, matches the closed form to
    ~10 mm over 30 steps, and stays on the z = 0 plane. 2D gravity takes a `Vector2`.
  Also: all 25 umbrella subpath exports resolve, and a strict-mode TypeScript consumer typechecks
  clean with `skipLibCheck: false` — so the shipped `.d.ts` files are internally consistent, not
  merely present.

- **2026-09-05 — repository configuration was three-quarters broken, and none of it showed in
  the tree.** `Docs` had failed on every run because **Pages was never enabled**, while the
  workflow existed solely to deploy to it. `Release` had failed because **Actions were not
  permitted to create pull requests**, so the changesets flow could never open a version PR —
  which is why 24 packages sat at `0.0.0` with the workflow itself warning that
  `changeset version` had to run first. **Dependabot security updates were `disabled` and there
  was no `.github/dependabot.yml` at all**, while vulnerability alerts were on: problems were
  detected and nothing remediated them.
  Lesson worth keeping: **a repo can be green in CI and still be broken everywhere CI does not
  look.** Three of these were repository *settings*, invisible to any check that reads the
  working tree, and each had been failing quietly for weeks. When a workflow fails on a step it
  does not own (`Configure Pages`, `Create version pull request`), suspect a setting before
  suspecting the code.
  Dependabot uses the **npm** ecosystem deliberately, not bun: its bun parser handles only
  `bun.lock` lockfileVersion 1 and this repo writes 2, so a bun ecosystem fails every run while
  leaving "0 open PRs" looking like health. Diagnosed three times elsewhere in the workspace
  (deepthinking-mcp `524ada7f`, fzf-mcp `387ee494`, MathTS `c0dd0d12`) before it was written down.

- **2026-09-05 — TypeScript-on-Bun toolchain (RFC 0006).** The workspace package
  manager and script runner is Bun (≥ 1.2). `package.json` declares
  `"workspaces": ["packages/*"]`; committed lockfile is text `bun.lock`;
  `bunfig.toml` sets `saveTextLockfile` / `exact`. CI uses `oven-sh/setup-bun`
  and `bun install --frozen-lockfile`. Library emit stays `tsc -b` (composite
  project references); unit/suite tests stay on Vitest for this landing
  (`bun:test` is staged). Spec revision **1.14** updates §91 and §103.
  Supersedes the pnpm-10 + `pnpm -r` orchestration decision (itself the
  2026-08-03 replacement for Turborepo). Node remains available for Playwright
  browser install and the two `node --test` tool suites. Fresh-process
  determinism helpers now pass `--experimental-strip-types` explicitly so
  Node < 22.18 (and local 22.14 sandboxes) can import the `.ts` scenario
  files; CI pins Node 22.22. The `examples:build` coverage test accepts
  `bun run <script>` chains.

- **2026-09-04 — geometry cache: reuse objects, not in-flight storage.**
  Supersedes the WebGL dirty-version delete/recreate policy recorded earlier.
  `bufferData` replaces each data store while retaining buffer handles and the
  VAO's fixed layout. Rebuilding is needed for attribute/index presence changes,
  not array length, primitive mode or index width. The version still invalidates
  all streams; reference equality does not prove an array was not edited in place.
  Keep the element buffer write inside its VAO and unbind the VAO before clearing
  ARRAY_BUFFER. Disposed caches must not resurrect. A typed optional-stream
  table owns allocation/cleanup; a private layout mask and unrolled shared
  writer avoid dynamic-key loops on dirty updates. No WebGPU change:
  queued writes and deferred command submission need a separate lifetime review.
  Counting-seam timings are not driver/GPU timing. The committed benchmark names
  baseline `6a22580`; call counts/bytes are primary, browser pixels are separate.
  Local Node 22.16 needs `NODE_OPTIONS=--experimental-strip-types` for existing
  fresh-process determinism helpers; newer Node 22 CI enables stripping by default.

- **2026-08-30 — unblocked-defect sanitization.** Lessons:
  - **A constructor that filters `RenderableOptions` is a serializer bug
    waiting to happen.** The §79 writer always writes `castShadow` /
    `receiveShadow` / `frustumCulled`; the reader spreads them into the
    options record; if the class's options type omits them, restore
    silently drops authored flags. `clip` was plumbed through explicitly
    in R-23; the other three were not. The durable fix is
    `SpriteOptions extends RenderableOptions` + `super(…, options)` —
    the Shape2D pattern — not another one-line pass-through that will
    miss the next field. A round-trip that _asserts the non-default_ is
    the test.
  - **§89's example-code list is not the union, but a host matching on
    documented names should see every code the engine throws.** The
    previous `errors.test.ts` list omitted three shipped codes; the new
    `satisfies` + `Exclude` exhaustiveness check makes that a compile
    error. `INVALID_RENDER_GRAPH` is the first code added because a
    graph authoring mistake is not a lifecycle one.
  - **`check-docs` that does not scan `packages/*/README.md` or
    `docs/Architecture/` will not catch a stub README that outlived the
    implementation.** `render-webgpu`'s README still said "barrel exports
    only `PACKAGE_NAME`" two days after R-1 closed. The scan now covers
    both surfaces; generated Architecture reports (`**Generated**:` stamp
    plus the `DEPENDENCY*` dumps, including `TEST_COVERAGE.md`) stay
    excluded.
  - **An examples-build-coverage capture that stops at `/` makes two
    nested flagships look like one example.** Nested path capture, plus
    an assertion that `"flagship"` itself is not in the list.

- **2026-08-29 — Gap Analysis v2 (campaign close).** Lessons worth keeping:
  - **A status document amended in place by many hands rots like unreviewed
    code** — v1 accumulated a wholesale duplicate of its §3 table, duplicated
    §4 rows (R-28/R-29/R-30, R-36/R-37), garbled §4.6 paragraphs, §1 counts
    frozen at its birth date, and four rows lagging the tree. The working
    alternatives are v0's (append-only banners, never edit) and v2's (one
    closing re-reader). Concurrent in-place row edits are the worst of both.
  - **A closure that rides another packet doesn't update its own row** — A-20
    closed as a side effect of WP-R1.8 + the ComputePass promotion, R-3 as a
    side effect of WP-R1.1/R1.9; neither packet owned the gap row, so nobody
    moved it. When a packet discharges another filing's content, moving that
    filing's row belongs in the packet's definition of done.
  - **Register markers must land same-day** — row 13's items were discharged by
    spec revision 1.8 on v1's own date and the row was never marked, making
    the owner remainder look longer than it was for three weeks.
  - Gate facts for the record: the full browser gate is 101 tests / ~5.6 m on
    this host, 0 skips with the WebGPU adapter present; the blending RECOVER
    flake did not reproduce at the closing run; goldens byte-unchanged.

- **2026-08-29 — the examples follow-up packet (character-controller + sensor
  tally).**
  - **An example lands atomically with docs/AUDIT-120.md's examples row.**
    `check-docs` counts _tracked_ `examples/*/main.ts` (git index included)
    against the row's `**N** runnable example` — staging a new example without
    the same-change AUDIT bump fails the gate.
  - **The wasm size-budget precedent was split and is now decided by row:**
    `character-controller` is budgeted (0.95 MB over its measured 0.90 MB
    gzip, the flagship precedent); playground/mechanism/blending stay
    row-less.
  - **A §29 event counter and a §30 overlap re-measure may disagree by one at
    an exact contact boundary** — the playground's drop layout rests
    stack-top's underside mathematically on the zone's top face (y = −1.6),
    which is why `sensor-tally.spec.ts` asserts a ±1 band, not equality
    (reference run: 0 disagreement in both halves).

- **2026-08-29 — RFC 0002 token migration + §61 `readPixels` whole
  (Rectangle2).** Decisions worth keeping:
  - **The reversible spelling-difference reversed on schedule, and the reversal
    cost one test split.** Each token moved to its registry's owner; `four`
    re-exports the very objects (`toBe`-pinned — object identity, not just the
    `name` string, is what makes provide-by-one-spelling/require-by-the-other
    one key). §3.1: no edge either way — every owner already had `core` and
    its own registry type. The §96 boundary test's name list split into HOST
    (authority: banned everywhere but core/four) vs TOKEN (declaration: the
    four owners, dated) — declaring `{ name, revocable }` confers nothing, so
    serialization declaring its tokens does not weaken "untrusted content can
    never become a plugin". The ban is textual and blunt on purpose: the new
    capability modules _reword their prose_ to avoid banned identifiers rather
    than weakening the check to skip comments.
  - **`Rectangle2` is deliberately origin-agnostic.** A rectangle is four
    numbers; the space belongs to the consuming API (`readPixels`: bottom-left
    §7a; §55's `frame` will state its own). `containsPoint` is half-open so
    adjacent rectangles partition — texel-region semantics.
  - **The region form rides the whole-target machinery unchanged.** WebGPU's
    §7a-to-top-first conversion happens in exactly one place; the repack never
    branches on region-vs-whole (a region's rows are just shorter); a
    whole-target copy passes no `origin` member at all — tape-pinned, which is
    the byte-identity proof for WP-R1.6's transcripts.
  - **WebGL `readPixels` is the stalling form, and that is a shape decision,
    not a shortcut**: a target readback is between-frames/once, its caller
    already awaits the GPU round trip; the picking fence path exists for
    every-frame picks racing a frame budget, and reusing it would couple this
    member to that service's pass state. The promise contract makes a later
    upgrade invisible. Lint corollary: an await-less async is
    `require-await`-red — a promise _executor_ keeps refusals as rejections
    without one.
  - **Coverage-hole rule, another confirmation:** a `renderTargets === null`
    guard behind `#requireContext` was unreachable; mirroring WebgpuRenderer's
    shape — assert-usable then one reachable pair-null check — made every
    branch real (render-webgl 99.92/99.62).
  - **A §61 member implemented as a class method rides every bundle of that
    backend** (a used class's methods don't tree-shake): +0.56 kB gzip per
    WebGL bundle, ±0.01 for the token migration. The `createPickingService`
    precedent accepted; budgets 37.5→38 / 36→36.5 / 44.5→45.

- **2026-08-29 — A-11 analytic tier + `node.hitTestMode` (adopted RFC 0005 Q3).**
  Decisions worth keeping:
  - **`hitTestMode` is `HitTestMode | null = null`, and `null` is not a fifth
    string.** §71's union stays verbatim (`"custom"` omitted until a strategy
    exists — a selector value with nothing behind it would be a silent no-op);
    "no author decision" is `null`, resolved per candidate at pick time from
    what the candidate carries. Scope stated per the §46/§67 precedent: the mode
    gates the node, not the subtree (`layers`' scope, `clip`'s opposite).
  - **Presence-opts-in composes under `null`; explicit modes are exclusive and
    refuse missing data.** The alphaMask precedent extended: `null` = box →
    triangles (if present, refining `t`/`point` to the surface) → mask at the
    refined `t`; `"geometry"`/`"pixel"` select one strategy and throw §85
    (`INVALID_APPLICATION_STATE`) when box-hit without their data — an explicit
    mode is the author saying the box is not an acceptable answer; `"gpu"`
    skips before the box test (the id pass answers; no double-resolve).
  - **`Pickable.triangles` is `BufferGeometry`'s layout without the import** —
    `{ positions, indices? }`, the fifth structural-seam instance; §3.1's
    `core, math, scene` row survived the analytic tier too.
  - **Triangle-record validation is WeakSet-cached** — O(n) index scan once per
    record at first consult (hot-path rule; `markDirty`'s no-revalidation
    caveat restated), and Möller–Trumbore's guards are written in the accepting
    direction so NaN fails toward a miss (`intersectBox`'s discipline, third
    statement). Unnormalized local ray ⇒ `t` is world distance (the box test's
    trick, inherited free).
  - **§79 rides one wrapper, not five writers.** `withHitTestMode(support)`
    wraps every umbrella pair (widgets included), writes the key **only when
    set** — argued against the flags' written-always rule: `null` is
    absence-of-decision frozen by the spec, and eliding it keeps unset scenes
    byte-identical — and restores by post-construction assignment, so
    `RenderableOptions` (a render-package record) was not widened.
  - **Measured:** tier symbols in only the 4 `pick()`-using bundles; first-3d
    ±0, particles +0.01 kB (inert field initializer); ui-demo 43.74 → 44.34 kB
    — budget bumped 44 → 44.5 with the A/B. input/four/geometry 100×4; scene
    99.85/99.72 (≥ baseline).
- **2026-08-29 — §58 paint-object tier (R-16 closed).** Decisions worth keeping:
  - **An object paint derives the shape's material; a supplied material
    excludes object paints — both directions refused (§85).** The tiers never
    mix: solids stay per-vertex through the author's material (byte-identical);
    object paints make the shape a `"node"` item wearing a derived
    `NodeMaterial`. `Shape2DOptions.material` became optional;
    `shape.paintDerived` is fixed for the shape's lifetime. R-16's two
    objections to a shape inventing a material dissolve exactly here: the
    derived material owns nothing disposable, and §79 writes the paint itself.
  - **The fill/stroke selector rides the colour stream** — `(0,0,0,0)` fill /
    `(1,1,1,1)` stroke, `mix(fill, stroke, color.x)`, exact at both ends —
    emitted only when the halves' paint values differ (value keys; patterns key
    on texture object identity).
  - **Paint values are graph constants, not uniforms** (recorded trade): the
    lowering is a pure value→bytes function, so RFC 0001's source-keyed program
    cache does all sharing with no cache in the lowering; one program per
    distinct paint value — re-authoring a paint per frame is the wrong tool,
    stated on `Paint`. Values-as-uniforms is the staged upgrade for animated
    stops.
  - **The stop ramp** `c₀ + Σ Δcᵢ·saturate((t−pᵢ₋₁)/Δpᵢ)` is exact for any stop
    count, pads both ends for free, and spells hard edges as `step(pᵢ, t)` —
    graph structure is a function of the value, which is fine because program
    identity already is.
  - **Unregistered = skipped, in the frame and in §79** — the tier inherits
    §60's skip-not-flat rule (the R-16 per-vertex fallback would be a
    _different picture_, R-6's rule; R-8's fails-toward-drawing governs culling
    of the same picture, not substitution), and the reader lets a material key
    win over object paints so a document's picture never depends on
    registration; keyless unrestorable documents refuse loudly naming
    `registerShapePaints()`.
  - **`registerShapePaints()` is the authoring-side registration slot** (A-3's
    module-`let` move applied to authoring rather than drawing): the lowering
    is 0 B unless called; the in-`shape.ts` glue is +414 B gzip and reaches
    only Shape2D-carrying bundles (today: the twin alone).
  - **`ShapeMaterial` unshipped a third time** — the pipeline that was to give
    it content arrived, and the derived material is `NodeMaterial`; a
    `ShapeMaterial` would be it renamed or a `kind: "node"` discriminant that
    lies.
  - **§79 grew a `textures` catalog** (`SceneNodeTypeOptions.textures`,
    additive): a pattern's texture is the one _resource_ inside a paint, so it
    follows the resource rules (loud unresolvable-key refusal; `null` under
    `"skip"`), not the drop rules.

- **A retired-claim pin can outlive the feature's shipping when the ship was
  opt-in** (2026-08-29, check-docs §55-batched pin): the pin guards the
  _original unqualified wording_, not the feature's absence. §65 batching
  shipped (R-9) but defaults off, so "batched" without "opt-in" is still false —
  keep such pins and rewrite their `why` to name the default-path truth, rather
  than deleting them because the claim became conditionally true.

- **2026-08-29 — A-19 / §78: the glTF loader.** Decisions worth keeping:
  - **The parse/assembly split is the TextureAsset seam one level up.**
    `@fourjs/assets` (§3.1 row: `core` alone) parses to plain validated data —
    typed arrays and records, no engine class named — and `four` owns
    `instantiateGltf`, because the umbrella is the one package that sees
    geometry, materials, render, scene, and animation at once (the
    `scene-serializers.ts` argument, third application). Zero new edges.
  - **Refuse what would draw the wrong picture; ignore-with-record what
    cannot.** Morph targets, CUBICSPLINE, MASK, sparse, texCoord ≥ 1,
    unsupported modes → §85-precise refusals (a mesh authored to morph must not
    draw un-morphed). Cameras, non-required extensions, TANGENT, mip
    minFilters, wrapT≠wrapS → `GltfAsset.ignored` + one devWarnOnce each
    (absence cannot corrupt the picture — the §67 warned-inert posture).
    `extensionsRequired` is where every compression extension is refused.
  - **The single-texture-unit material tier bounded the §59 half.** The packet
    sketch assumed metallicRoughness textures were consumable; R-13's landed
    StandardMaterial has `map` only. The four unsampleable slots are parsed,
    validated, surfaced as `GltfMaterialRecord.ignoredTextures`, and warned at
    instantiation — never dropped silently; factors always apply. The loader
    needs no format change when the unit allocator lands.
  - **glTF's uv convention converts at parse (`v → 1 − v`), textures keep the
    landed flip.** One row flip in the engine (the texture tier's) plus one
    coordinate conversion in the adapter — the §7a "flipped by the adapter that
    produces them" rule extended to coordinates. Inverse binds absorb the
    bone-axis convention; no axis conversion anywhere (RFC 0003 confirmed in
    practice).
  - **The 48-joint ceiling fires through the landed refusal, not a restated
    constant** — `mesh.skeleton = skeleton` at instantiation throws
    `UNSUPPORTED_GPU_FEATURE`; the number lives in one place.
  - **All accessor reads are explicit little-endian `DataView` arithmetic** —
    slower than typed-array views and chosen anyway: one code path for tight
    and strided layouts, and parse output is byte-identical even on a
    big-endian host, which is what let the determinism suite pin FNV-1a digests
    of the committed fixtures (`quad.gltf` → 925a50c2, `skinned-column.glb` →
    637ac47b).
  - **A synthetic FetchResponse is a coverage dead-end — export the decode half
    instead.** The first draft wrapped image bytes in a fake response to reuse
    `createTextureLoader.load`; its never-called `text()`/`json()` were
    uncoverable. `createTextureDecoder` (encoded bytes → TextureAsset) is now
    the real seam, `createTextureLoader` wraps it, both suites cover it. When a
    reuse needs a fake of an interface, extract the half you actually use.
  - **Loaded clips target the instantiation object, not a node** — paths are
    `nodes.<i>.transform.<channel>` (RFC 0003's indexed-array form), clips
    build once per asset and play onto any instance; no §42 authority is
    claimed (the mixer's non-Node-target posture), applications assign
    authorities per node.
  - **Measured: 0 B in every bundle** — worktree A/B: first-2d, first-3d,
    ui-demo, and particles-demo bundles byte-identical at HEAD vs HEAD+packet;
    grep: no glTF symbol in any tight bundle. Coverage: assets and four both
    hold **100×4**. Browser gate 93/93; the glTF spec measured 784/784 orange
    in-region, 0/784 out, 1 draw call.

- **2026-08-29 — R-31 wiring + Q3 promotion (§36 `simulation: "gpu"`; §82
  `ComputePass` promoted).** Decisions worth keeping:
  - **CPU spawn + GPU integrate.** Every §33-bearing decision (RNG stream,
    4-draw order, bursts, accumulator, ageing, expiry, ramps) stays CPU-side — a
    GPU emitter's spawn stream is bit-identical to a CPU emitter's, pinned; the
    device takes only the O(n) Euler step. GPU-resident state is
    **display-tier**: outside every §33 tier the engine claims (no cross-adapter
    float promise; f32 vs binary64-intermediate rounding), no golden may
    checksum it, and §34 has no surface for it by design — a CPU-side snapshot
    would be spawn-stale and restoring it a lie.
  - **The draw joins by node id, not by an item field.** The renderer registry
    (`createParticleSimulation({ systemId })`) is what let the wiring land
    without touching `ParticleDrawable`/`ParticleRenderItem`;
    `WgpuParticleCache` already keys on the same id. Residual stated hazard: a
    different renderer drawing a GPU system shows spawn positions.
  - **The position buffer is the instance stream** —
    `STORAGE|VERTEX|COPY_DST|COPY_SRC` (the one usage deviation from the
    compute trio), bound at 12-byte stride to the same `@location(1)`;
    size/colour keep riding the interleaved CPU repack (ramps are functions of
    CPU age). One pipeline variant `gpuInstances` (`|gi:y`, appended
    only-when-true — landed keys byte-identical), zero new WGSL.
  - **Swap-remove mirrors through a 24-byte scratch** (WebGPU forbids
    same-buffer copies), in exactly the CPU compaction order; never
    `from === to`. Batching many moves per encoder is a recorded, unbuilt
    refinement.
  - **Refuse, never degrade:** unbound GPU `step()`/`emit()` throw; GPU mode
    refuses `fields`/`collisionPlaneY`/capacity 0; only a compute-capable
    surface mints a driver (`UNSUPPORTED_GPU_FEATURE`, probed at creation);
    binding is once (device loss ⇒ new emitter). Silent CPU fallback would
    change results silently — §62's anti-downgrade sentence reaches simulation.
  - **Q3 executed as recorded:** one re-export; the promoted handle is
    structural (`ComputeBuffer`, branded), so the backend dispatch now refuses
    foreign buffers loudly; allocation stays backend API; `Four.ComputePass`
    maps record-key insertion order to `@binding(i)` and never reflects on the
    shader.
  - Measured: render-webgpu 99.89/99.80 held exactly (new files 100×4);
    particles/four 100×4; compute symbols 0/9 bundles (`createVertexArray`
    control 9/9); 7 of 9 bundles hash-identical; particles-demo +0.55 kB
    (budget bumped 35.5 → 36 kB with the measurement).
  - **Multi-agent note (eighth confirmation):** the glTF sibling shared
    `packages/fourjs/src/index.ts` (both packets' export blocks coexisted; the
    file was left unstaged so neither packet claimed the other's hunk — the
    second landing took it); a docs sibling moved the tip mid-session; all
    gates ran green on the moved tree.

- **2026-08-29 (doc-truth sweep): trust the backend, not the interface comment,
  for capability coverage.** `renderer.ts`'s `RendererCapabilities` doc claims
  all three shipped backends answer every member; the authority is each
  backend's own record: `WebglRenderer` deliberately never reports
  `maxUniformBufferBytes`/`maxBindings` (R-30b — querying at initialize would
  move recorded GL transcripts), and `WebgpuRenderer` omits
  `maximumSkinningJoints`. Any §90/§62 documentation of capability coverage must
  be counted off `WEBGL_STATIC_CAPABILITIES` / `readCapabilities`, not off the
  interface's prose.

- **2026-08-29 — WP-R1.9: §62 capability declaration + the WGSL node pipeline
  (R-1 complete).** Decisions worth keeping:
  - **A required §62 capability is satisfied only by an affirmative `true` —
    refuse, never warn.** `undefined` ("not taught to answer") refuses exactly
    as `false`: silence promoted to satisfaction is the confident wrong answer
    the capability record's own doc warns about, and §62's "rather than silently
    downgrading" reaches sufficing, not just starting. The two non-answers stay
    distinguishable (`RendererCapabilityShortfall.answer`), the check runs after
    `initialize` (only then is the record authoritative, §61), `"auto"`
    disposes-and-skips with reason `"missing-capability"`, a named backend
    throws. The declarable set is the six boolean members as a closed union —
    quantities need a threshold grammar and stay undeclarable until a consumer
    asks. Optional shortfalls report and never gate.
  - **The WGSL emitter's uniform transport is all-`vec4` lanes in one block**
    (`node.u[k].x/.xy/.xyz`, mat3 = 3 lanes with written-zero w, mat4 = 4) —
    the GLSL declare-wide/read-narrow padding rule generalised to a buffer, and
    the light-block alignment answer applied to a generated shader. Mixed
    min/max/step splat the scalar explicitly (WGSL builtins want matching
    types; identical componentwise arithmetic, spelled out).
  - **Node surface draws ride the store's own per-program-strided buffer**
    (stride = block bytes aligned to 256), sized in `beginFrame` before the
    pass records — the sized-before-recording discipline holds even though
    stride varies per program; every stride byte including pad lanes is written
    per frame (§33). Compilation moved to `beginFrame` with it, so first-sight
    modules appear before the frame's clear module on the tape.
  - **Screen-domain texture samples flip `v` (`(u, 1−v)`); the `"uv"`
    coordinate itself stays §7a bottom-up.** A sampled target stores its
    picture top-down on WebGPU, so the flip is what makes a graph copy the
    per-pixel identity (browser-measured over an asymmetric source);
    surface-domain samples are unflipped, the landed `map` path's convention.
    Screen groups: textures at 0, block behind them (or at 0 texture-less),
    present only when time/uniforms are reachable — a graph copy has zero
    uniform traffic structurally.
  - **`frameWantsStencil` scans node materials exactly when the node pipeline
    is registered** — a registered node item is a real draw whose §57 stencil
    must reach the format decision (R1.7's parity), an unregistered one must
    stay format-invisible ({scene} ≡ {scene + skipped node item}). One honest
    corner recorded: a registered graph whose emission later fails still
    selects the format — an unused stencil aspect, never a wrong picture.
  - **Missing vertex streams skip on WebGPU where GL shades with the default
    attribute** — a pipeline must be given every buffer it declares, and a
    default-value variant per missing-stream subset would multiply modules for
    an authoring error; recorded divergence, §85-warned. Cross-domain draws
    (screen graph on a renderable, surface graph as an effect) likewise skip —
    the domains bake different bind-group/vertex shapes here.
  - **Undisplaced node casters joined §69's caster pass** (GL's rule verbatim,
    registration-independent — the caster module is the backend's own); R1.7's
    "reachable only with the WGSL emitter" deviation retired.
  - **The renderer's post-scan disposal re-check is scoped to the accessors the
    new scan runs** (`nodePipelines !== null && this.#disposed`): a nodeless
    frame keeps the pinned lose-its-shadows behaviour for a light-accessor
    teardown; a graph-accessor teardown bails before allocating onto a dead
    device.
  - Measured: render-webgpu coverage 99.85/99.73 → **99.89/99.80** (new files
    100×4); render 99.94/99.91; node symbols in 0/9 bundles (control 9/9);
    declaration surface +0.10–0.12 kB gzip per Application bundle (worktree
    A/B), all budgets green, no bumps. Browser gate **91/91**, including the
    first executions of the R1.7/R1.8 specs (all passed as committed;
    measurements recorded in headers). One §119 twin frame-pacing flake on the
    first full run, green in isolation and on the rerun — the recorded
    load-sensitivity, reconfirmed.

- **2026-08-29 — WP-R1.8: WebGPU particles (§36) and compute (§82).** Decisions
  worth keeping:
  - **The particle block is a third group-0 layout — 192 B, projection/view/model,
    vertex-only.** The sprite second-layout precedent, again for a byte reason
    (`minBindingSize` in landed init transcripts); the matrices travel separately
    because the billboard offset happens _between_ view and projection; the block
    fills its binding exactly, so no uploaded byte of it is history.
  - **Instance streams upload once per frame, not per view — a stated deviation
    from GL.** `updateParticleInstances` runs once per render call, so the bytes
    cannot differ between views; and `queue.writeBuffer` executes in queue order,
    so a per-view re-upload would overwrite the first before either recorded draw
    executes (the `wgpu-batch.ts` hazard). Identical bytes make per-view
    harmless; one upload makes it impossible. Gate = a renderer frame ordinal on
    the record.
  - **A zero-count (or count-outruns-capacity) system skips before the geometry
    cache** — stricter than GL, which acquires its record first; {scene} ≡
    {scene + zero-count system} is pinned as a full-tape A/B across two fresh
    devices. No VAO to guard: the record is two fields where GL's is four,
    because attribute layouts are pipeline state.
  - **Q3 executed conservatively: `ComputePass` lives in `render-webgpu`,
    promotion recorded as one re-export** + optional `Renderer.compute?()`
    (token-identity precedent) — RFC 0004 held `packages/render` concurrently and
    landed mid-session (ec6aab5); zero file overlap, clean diff separation.
    Bindings are an **ordered array** (index _i_ = `@binding(i)`); the spec's
    named map is the umbrella sugar's, at promotion.
  - **Compute joined the device surface as optional members**
    (`createComputePipeline`, `beginComputePass`, `copyBufferToBuffer`) —
    presence-is-the-capability; every pre-R1.8 double compiles;
    `UNSUPPORTED_GPU_FEATURE` on absence (`readPixels`' contract); WebGL 2's
    no-compute stays an honest structural mirror.
  - **Compute pipelines cache on (access pattern | entry point | source)** — the
    RFC 0001 source-keyed program cache one stage over; one module per source; a
    binding-less kernel's pipeline layout carries no bind-group layouts at all,
    so nothing requires a group the dispatch never sets.
  - **The integrator's `count` travels as f32** (the light-block one-packer
    precedent; exact far past §112's budget); params bind read-only storage,
    positions/velocities read-write flat f32 lanes in the pool's own x,y,z
    layout; `v += g·dt` then `p += v·dt`, the emitter's documented closed form —
    the browser spec reads one exact step back and observes the count guard on an
    untouched lane.
  - **`frameWantsStencil` keeps excluding `"particles"`, for a new reason:**
    drawn now, but material-less (`material?: undefined`) — there is nothing to
    scan, and §67's clip record (clause 1) is a particle item's only stencil.
  - **Two more reentrant-family pins made two "unreachable" narrowings honest**
    (a disposing unlit `map` getter; a disposing sprite `blendMode` getter — both
    surface as the disposed pipeline cache's null); the mask/shadow/particle
    pipeline-null narrowings remain genuinely unreachable — no application
    accessor runs between cache and acquire — and say so in source.
  - Measured: coverage 99.77/99.58 → **99.85/99.73** (new files 100×4); 0/9
    bundles carry any WebGPU or compute symbol (`computeMain`/
    `dispatchWorkgroups`/`ParticleUniforms` joined the grep; `createVertexArray`
    control 9/9); all size budgets green, no bumps.

- **2026-08-29 — RFC 0004 / §77a: the raster painting stack.** Decisions worth
  keeping:
  - **R-4's `MaterialTexture` seam paid off a third time**: `CanvasTexture`
    uploads through the id/version path with zero backend edits and no new
    duck-typed contract (count stays five). A new texture _producer_ needs no
    consumer change anywhere — quote this before ever proposing an upload-path
    edit.
  - **The flip is folded into the read, and the scratch is one row.**
    `"top-left"` sources are reversed in place via a `width*4` scratch allocated
    at construction — no per-repaint allocation. Measured: the flip costs the
    same order as the `readPixels` copy itself (2048²: 0.96 ms vs 1.32 ms; 256²:
    24 µs), both far under a frame.
  - **The constant-size check runs _after_ `paint()` and before the read** — the
    obvious hazard is a panel-resize repaint that grows its own canvas mid-paint,
    and the rule must catch the size the read would see, not the size at entry.
  - **A node class must not carry `static typeName` — second application** (the
    `Bone` rule): RFC 0004 §2b's sketch shows one on `CanvasViewWidget` and is
    overridden by RFC 0003's recorded deviation; the §79 identity is
    `"ui:canvas-view"` via `registerUISerializers`.
  - **The display-only scan catches prose, and that is a feature.** The widget's
    first draft mentioned `CanvasTexture` in a doc comment; the scan flagged it
    and the docs were reworded — "the widget names no texture type" is now true
    of comments too, which is what keeps the claim greppable.
  - **`UI_STAGED` text is bundle mass** (R-29's finding, reconfirmed): correcting
    the canvas-view blocker note cost +109 B gzip in every `@fourjs/ui` bundle at
    first draft, trimmed to +28 B — the full story lives in `canvas-view.ts`'s
    header, the staged array carries one line.
  - **§96's two error paths split on who built the value** (A-23, applied): the
    over-budget refusal is a `RangeError` because the size came from the
    application's own source object; `UNTRUSTED_INPUT_REJECTED` is specified for
    decoded-external-content sources and deliberately unbuilt — decode is
    deferred with `ImageBitmap` sources on A-18's remaining half, and a stub that
    refuses nothing would have been dishonest.
  - **Measured:** painting symbols in 0 of 9 bundles; six bundles byte-identical;
    ui-demo 43.63/44 (no bump); twin +213 B carries the serializer pair (only
    `registerSceneNodeTypes` caller). Browser: orientation 400/400 box counts
    both ways; paint-only and invalidate-only frames byte-stable on screen.
    Suites bit-exact; goldens untouched.
  - **Multi-agent note (seventh confirmation):** shared-tree lint (17 errors) and
    TypeDoc (2 warnings) failures were entirely the WP-R1.8 sibling's mid-flight
    `render-webgpu` files; a HEAD+packet clean-room worktree ran every gate
    green.

- **2026-08-29 — WP-R1.7: WebGPU shadows and stencil parity.** Decisions worth
  keeping:
  - **The shadow binding joins the lights group, widened — not a fourth group.**
    `sampler_comparison`/`texture_depth_2d` cannot ride the `map` layout
    (API-invalid pairing), so they join a second group-1 layout whose uniform
    half is the landed light block plus 80 bytes in the stride's spare (592…672
    of 768; `SHADOW_UNIFORM_SPARE_BYTES` pins what's left). No landed layout,
    `minBindingSize` or transcript moves; the member list is one shared string so
    the two structs cannot drift. Frame-level group like GL's frame-level unit
    bind; dropped on lights-buffer regrowth and on map reallocation (view
    identity is the cache key).
  - **`useShadow` is a variant appended only-when-true** (`|sh:y` — the
    conditional-suffix rule's fifth application, with a twist): `false` and
    absent share one key _deliberately_, because they name identical pipeline
    content — a non-receiver in a shadowed frame draws the shadowless frame's
    very pipeline, which is the transcript-label half of GL's
    mirror-at-initial-false byte-identity claim. The R1.5 statement "shaded
    stages are GL-with-`useShadow`-false" now describes the unshadowed variant
    only.
  - **`textureSampleCompareLevel`, never `textureSampleCompare`** — the `Level`
    form has no implicit derivatives, so the nine taps are legal inside the
    non-uniform `len > 0` guard where GL also evaluates them; with a nearest
    comparison sampler each tap is exactly one `receiver <= occluder`, keeping
    §33's explicit-arithmetic filter. The receiver's `v` flips
    (`0.5 − ndc.y·0.5`) for the top-left map origin; the caster's §3.3.8 remap
    lands stored depth on GL's [0,1] convention, so the comparison needs no
    depth-side correction.
  - **Skinned and node casters are excluded by absence, not by rule**: the caster
    whitelist is "what this backend draws" (unlit/lit/standard) — an invisible
    surface must not cast. GL's finer undisplaced-node-casts-exactly rule becomes
    reachable only with the WGSL emitter; recorded in source as a deviation, not
    an omission.
  - **The stencil residue retired by a frame scan, and the scan follows from a
    landed decision**: with no `{stencil:true}` option (R1.3 — the backend owns
    its attachment), the frame's list is the only place "does this frame need
    stencil bits" can be answered. `frameWantsStencil` = the O(1) clip read plus
    an early-exit material scan over drawable kinds; GL asks its surface, WebGPU
    asks its frame, both ask the target off screen. The R1.3-pinned inertness
    test was flipped in the same packet that retired the residue it pinned.
  - **The scan moved application accessors ahead of every allocation, so the
    frame now bails on `#disposed` right after it** — a reentrant dispose in a
    stencil getter resurrects nothing (the R1.6 rule); a dispose in a _light_
    accessor (collect-time, pre-existing exposure) still costs only the frame,
    pinned including the map-not-produced path.
  - **`depthLoadOp:"clear"` is the shadow pass's to use** — the mip blits'
    exception gains its second member: a shadow pass has no sub-rectangle, so
    §61's scissored-clear argument does not reach it. And the caster pass is
    where the GL mirror-state discipline visibly evaporates: GL's
    `#renderShadowMap` borrows framebuffer/rectangles/program and owes re-binds;
    here it is a pass of its own borrowing nothing — recorded per the plan as the
    place this backend is structurally safer.
  - **Multi-agent note:** the RFC 0005 sibling committed mid-session, moving the
    tip under this packet's working tree; the forecast gl-picking GATED failure
    never fired (their commit carried the entry), suites ran green on the moved
    tree, and the packet's staged diff separated cleanly.
  - Measured: coverage 99.75/99.53 → **99.77/99.58** (new files 100×4); 0/9
    bundles carry any WebGPU shadow/stencil symbol (`createVertexArray` control
    9/9); all size budgets green.

- **2026-08-29 — RFC 0005 / A-11 pixel half: GPU-id picking.** Decisions worth
  keeping:
  - **The item→node join is the worldMatrix object.** Render items carry no node
    reference (§64), but the non-interpolated builder documents
    `item.worldMatrix` as the node's own matrix — one object per node, so
    `Map<Matrix4, index>` joins the sorted draw list to the traversal-ordered §33
    table exactly, allocation-free. Breaks if the plain builder ever pools
    matrices; the doc on `RenderItemBase.worldMatrix` is now load-bearing.
  - **Staleness is detected by cache-era identity, not flags.** A WebGL restore
    keeps the context _object_; what changes identity is the renderer's rebuilt
    caches. The pass records `host.geometries()` as its era; `pick` compares and
    rejects `CONTEXT_LOST` — and an update skipped under §61 drops the previous
    pass, because a stale `undefined` is indistinguishable from "nothing there"
    (the RFC's own argument, applied twice).
  - **The host seam is seven `this`-capturing arrows, and that is a bundle
    decision.** Getter-object and this-alias forms cost ~250 B more per
    WebglRenderer bundle and the latter is lint-banned; accessor _methods_ keep
    the window live across restores (new caches seen, never captured). The
    `createPickingService` ride-along is the seam's whole never-picking cost
    (~0.15 kB gzip), the `maximumSkinningJoints` precedent.
  - **The id pass mirrors what decides "on top", and nothing else**: material
    depthTest/depthWrite/colorWrite and §67 clip stencils (the target takes the
    packed stencil form per pass via `items[0].clip?.maskPass` — WP-R1.3's O(1)
    decision on a target option). Ignored on purpose, stated in source: blending
    (D's CPU tier answers alpha), R-7's `material.stencil`, skinned items (§69's
    caster-exclusion, third application), particles (staged: needs the instanced
    billboard vertex stage).
  - **Every skip resolves before the first state or uniform call** — otherwise a
    never-drawn item (empty geometry, mid-build reentrancy miss) uploads an id or
    moves the mirror; found by the unit tape, fixed by ordering, matching the
    frame renderer's "a skipped draw contributes nothing at all".
  - **An unreachable presence re-check is a coverage hole (sixth confirmation)** —
    the fenced reader takes the four narrowed entry points as values instead of
    re-probing gl; and the §85 count refusal lives in an exported pure function so
    the 2³² branch is testable.
  - **WebglContext read-back members are function-typed properties, not
    methods** — method syntax + extraction trips
    `@typescript-eslint/unbound-method`; property syntax keeps `.call(gl, …)`
    (needed for real contexts) lint-clean.
  - **Measured:** GPU-tier symbols in 0 of 9 bundles; +0.15–0.17 kB gzip (seam)
    in WebglRenderer bundles, +~0.4 kB more where `pick()` rides (Alternative D);
    ui-demo 43.60/43.5 — bumped 43.5→44. Transcripts: frame-after-id-pass
    byte-identical.
  - **Multi-agent note:** HEAD advanced mid-packet (sibling landed WP-R1.6,
    2ff733c); one `pnpm run docs` run failed on the sibling's mid-flight
    `wgpu-shadow.ts` and passed unchanged on re-run — another confirmation that a
    red gate on a loaded shared tree indicts the tree state first.

- **2026-08-28 — WP-R1.6: WebGPU render targets, effects, `readPixels`.**
  Decisions worth keeping:
  - **The samplable depth form is `depth32float`, and the table is exported
    data.** The plan's wording allowed `depth24plus`; `depth32float` is the
    format WebGPU guarantees can be both sampled and copied out
    (`copyTextureToBuffer` forbids `depth24plus`'s depth aspect), and its
    4 B/texel is what R-18's accounting already bills. `renderTargetDepthFormat()`
    is the whole decision — R1.7's shadow sampling and the R-4 float-format
    widening target the table, not string literals.
  - **Off-screen colour is `rgba8unorm`, deliberately not the preferred canvas
    format**: `"rgba8"` means precision, channel order is backend detail — and
    RGBA order is what makes `readPixels` swizzle-free. The consequence —
    off-screen pipelines carry a different `colorFormat` — is exactly what the
    per-format pipeline cache absorbs; an application's first off-screen frame
    compiles its variants a second time, by design.
  - **`readPixels` rows are bottom-to-top by decision** (§61's sketch is silent;
    first implementation fixes it): §7a's Y-up, and the order GL's `readPixels`
    produces natively, so cross-backend byte agreement was decided once instead
    of discovered as a flip. The flip rides the 256-byte padding strip the map
    forces anyway.
  - **The frame's stencil question split in two**: `frameStencil` (does the
    surface carry the aspect — the pass descriptor's ops, `material.stencil`'s
    reach, the clear's stencil zeroing) vs `frameClips` (do masks draw). On
    screen they coincide with the landed behaviour byte-for-byte; off screen
    `frameStencil` is the target's `stencil` option (GL's `stencilAttached`), so
    R-7's mask-by-hand tier works into stencilled targets clipless, and a clip
    into a plain target warns-inert (`webgpu-clip-without-stencil`,
    GATED-registered) — the condition GL always had is reachable on WebGPU only
    off screen.
  - **`renderEffect` has no state envelope, and the kinds are modules.** GL's
    try/finally borrows four states; here each effect is its own pass in its own
    encoder and there is nothing ambient to restore. The R-19 inversion's third
    application: GL's `useGrade`/`useEncode` uniform switches became three lazy
    modules; only the grade binds uniforms, so a copy chain has zero uniform
    traffic _structurally_ rather than by mirror discipline.
  - **A grade coefficient accessor is application code — the reentrant-dispose
    family's fourth member.** The scratch write (app getters) runs before
    `pipelines.acquire`, so a mid-call teardown surfaces as the cache's `null`
    and skips the effect without resurrecting an allocation; pinned as a test,
    which is what made the "unreachable" narrowing coverable.
  - **The device surface grew only optional members** (`copyTextureToBuffer`,
    `mapAsync`/`getMappedRange`/`unmap`; `GPU_MAP_MODE`) —
    presence-is-the-capability, so every pre-R1.6 double still compiles, and
    `readPixels` rejects `UNSUPPORTED_GPU_FEATURE` on one that lacks them.
    `recording-gpu.ts`'s `getMappedRange` returns an `i % 251` byte pattern — a
    prime period can never align with 256-byte rows, so the padding strip and
    row flip are assertable exactly.
  - **Graph participation cost zero graph edits**, as the plan said:
    `supportsScreenEffects` detects the new member, and graph-vs-hand
    **full-tape** transcript identity is pinned
    (`webgpu-render-to-texture.test.ts`) — R-5's "the graph is a driver" now
    holds on two backends.
  - **Multi-agent note, fifth confirmation:** the RFC 0001 sibling committed
    mid-session and an RFC 0005 picking wave started on the shared tree; one
    shared-tree `pnpm run docs` run failed on its unexported symbols and 56
    prettier warnings are its files'. A clean-room worktree (HEAD + this packet
    only) ran every gate green — a red gate on a loaded shared tree indicts the
    tree state first.
  - Measured: coverage 99.70/99.41 → **99.75/99.53** (new files 100×4); rebuilt
    example bundles byte-identical, 0/9 carry any WebGPU symbol.

- **2026-08-28 — RFC 0001 / R-14: §60 node materials.** Decisions worth keeping:
  - **The IR lives in `@fourjs/materials`; backends read it through `@fourjs/render`'s
    re-export** — the RFC's §3.1 legality argument executed: `analyzeShaderGraph`
    and the graph types are re-exported from `render`, so `render-webgl`'s frozen
    `core, math, render` row gained no edge.
  - **The program cache keys on the emitted source pair, not a hash of the
    graph.** Two graphs that emit the same GLSL are one program (a `Map` on the
    source; a `WeakMap` identity fast path in front); a per-graph compile failure
    is latched `null` in the same `WeakMap` — the skinning latch, per graph
    instead of per context.
  - **vec2/mat3 uniforms are declared vec4/mat4 and read back narrow** (`u_x.xy`,
    `mat3(u_x)`), uploads padded: the `WebglContext` GL budget has no
    `uniform2fv`/`uniformMatrix3fv`, and growing it would have touched every
    recorded double. IR, reflection and `setUniform` validation stay narrow; only
    declaration and upload widen. Reuse this transport move before growing the GL
    budget.
  - **The screen domain gets exactly one attribute: `"uv"` means the pass's own
    normalized coordinate** — a recorded deviation from RFC §5's blanket attribute
    rejection, because without a coordinate the domain cannot express even a copy.
    The other three stay rejected there.
  - **`texture` nodes are refused reachable-from-`positionOffset`** (the
    displacement runs in the vertex stage, where implicit-derivative sampling does
    not exist) — a §85 validation rule, not a driver's discretion.
  - **Node texture units start at 2** (0 is the map's, 1 the §69 shadow's — both
    can be live in a node frame); screen programs start at 0; the constant lives
    in the registry module so the renderer's `finally` can unbind without linking
    the emitter.
  - **Per-view uploads with many programs need no map: a module-level monotonic
    view stamp** (`nodeViewStamp`), each program recording the last stamp it saw —
    one view-projection (+ time) upload per program per view, allocation-free.
  - **§9 render time reaches the backend as `WebglRenderer.renderTime`**, a plain
    public field on the statistics/batching precedent, defaulting to GL's initial
    0 so time-less scenes pay nothing. Never simulation time (§42/§43).
  - **A displaced node caster is excluded from the §69 pass; an undisplaced one
    casts exactly** — depth ignores colour, so the caster program is right for it
    (the skinned bind-pose rule, applied only where the picture would actually
    differ).
  - **Conic is the one §58 paint the closed operator set cannot spell** (no
    `atan`); the other five non-solid paints are now exact per fragment. An angle
    operator is a one-row closed-union amendment when a consumer wants it.
  - **Lazy, observed:** initialize compiles 7 programs registered or not; the
    first node frame adds exactly 1; three materials sharing a graph structure
    still add exactly 1.
  - **Measured: +0.60–0.79 kB gzip frame path in every WebglRenderer bundle**
    (A/B against a HEAD worktree); the emitter is 0 B unless
    `registerNodeMaterialPipeline()` is called (grep: `uniform sampler2D s_` in 0
    of 9 bundles; the twin's one text hit is the DEV warning string — it builds
    with DEV on). Budgets moved 36.5→37.5, 34.5→35.5, 43→43.5.

- **2026-08-28 — WP-R1.5: WebGPU lit/standard pipelines and the light block.**
  Decisions worth keeping:
  - **The light block is all-`vec4`, and that is the alignment answer, not a
    style.** WGSL's `vec3<f32>` is 16-byte aligned, so any `vec3` member means
    implicit padding the CPU packer must know about; a layout with no `vec3` slot
    makes every byte named. The count travels as **f32** (`counts.x`, read back
    with `i32()`) because the block is packed through one `Float32Array` and a
    `u32` word would need a second view over the same bytes — exact over 0…8.
  - **The per-view group arrived at group 1 as promised, which pushed the shaded
    families' `map` to group 2** — the _same_ texture layout object and bind
    groups, because a bind group carries no index (the pipeline layout assigns
    it). Corollary: the map group index is now per-family data
    (`MAP_BIND_GROUP_INDEX` for unlit/sprite, `SHADED_MAP_BIND_GROUP_INDEX` for
    lit/standard).
  - **Light blocks index by _rendered_ view ordinal, not view array index** — a
    zero-area view writes no block and leaves no gap, so every uploaded byte was
    written this frame (the `clearSceneLights` transcript-determinism argument,
    one buffer later). The eye rides the light block (per-view state like the
    lights); the lit WGSL simply never reads it.
  - **Normals upload per shaded acquisition, not per geometry** —
    `acquire(geometry, normals)` with an in-place one-buffer upgrade. Forced by
    byte-identity: `planeGeometry` carries normals, so the GL cache's
    upload-whatever-exists rule would have moved every landed sprite/shape
    transcript. The honest unit of need on a loose-buffer backend is the draw,
    not the package.
  - **The hasLit scan excludes `skinned-lit`, deliberately** — a skinned item is
    transcript-invisible here (WP-R1.4), and a light block allocated for skipped
    draws would break that byte-identity from the side. Pinned as a transcript
    A/B.
  - **WGSL has no `inverse()`** — the inverse-transpose is a hand-written
    cofactor function (`transpose(inverse(A)) = [a₁×a₂ a₂×a₀ a₀×a₁]/det`), per
    vertex like GL's, hoistable to a per-draw uniform for both backends at once
    when `Matrix3` grows the utility. And WGSL has no `out` params — the punctual
    chunk returns a two-member struct.
  - **GL's default-attribute zero normal becomes a variant** (a WebGPU pipeline
    cannot leave a declared vertex buffer unbound): the normal-less variant's
    vertex stage writes the same zero vector, the shared fragment guard shades it
    ambient-only — two variants, one arithmetic. The descriptor's `normals?`
    field appends `|n:y`/`|n:-` only when carried (conditional-suffix rule, third
    application).
  - **A reentrant mid-frame dispose is reachable through a material accessor**,
    not just `camera.updateViewMatrix` — pinned twice (a `map` getter and a
    `stencil` getter), which is what made the shaded arm's two "unreachable"
    narrowings coverable: the lights group is read off the field _after_ the
    material getters run.
  - **Multi-agent note, fourth confirmation:** one `pnpm run docs` run failed on
    the RFC 0001 sibling's mid-flight `render-webgl` test edits and passed
    unchanged on re-run; the three tight-bundle size overruns (+61…576 B) at this
    packet's gate run carry the sibling's staged `render`/`materials` changes —
    zero WebGPU symbols reach any bundle (control grep unchanged).
  - Measured: coverage 99.61/99.24 → **99.70/99.41**; 0 B in every tight bundle.

- **2026-08-28 — WP-R1.4: WebGPU shapes and vertex colours.** Decisions worth keeping:
  - **The packet proved a negative, which was its point**: no unlit-variant plumbing
    was deferred from R1.1 — colour-only-no-uv was already a lazy variant with a
    positional vertex layout — so WP-R1.4 shipped zero behavior lines. The WebGPU
    identity test is _stronger_ than the GL original it restates: full-tape equality
    (handle serials and uniform bytes included), not names+draw-args, because
    `recording-gpu.ts` copies typed arrays at record time and the uniform path is one
    strided upload.
  - **A skinned item is transcript-invisible on this backend, and that is now pinned
    from both sides**: {scene + skinned mesh} records the byte-identical tape of
    {scene}, and the same scene through GL-with-registerSkinningPipeline draws one
    more item than WebGPU — the honest "closed on WebGL 2, absent on WebGPU"
    wording, in a test rather than a sentence.
  - **The vc variant's WGSL had never met a real adapter** — the browser gate
    compiled only `unlitShaderSource(false)`. Rule worth keeping: a _variant_
    family's browser evidence covers only the variants it compiles; each generated
    module needs its own compile-and-rasterise line once, or "the WGSL compiles"
    quietly means "one of the four compiles".

- **2026-08-28 — RFC 0003 / PH-10 + R-22: §54 skinning.** Decisions worth keeping:
  - **A skinned draw's failure direction is absence, and the check sits above the
    geometry upload.** Unregistered pipeline, failed compile (latched per context,
    cleared on restore), and a material family with no skinned variant all skip with
    one §85 warning — a T-pose is a different picture. The skinned arm is a
    self-contained `continue` block like the particle arm, resolved _before_
    `geometries.acquire`, so a skipped draw contributes not even a buffer; that is
    what made the with/without-mesh transcript A/B exact.
  - **The joint limit is a declared constant, not a query — R-30b's law decided
    it.** `MAX_SKINNING_JOINTS = 48` (192 of WebGL 2's guaranteed 256 vertex uniform
    vec4s), reported through the optional-tri-state
    `RendererCapabilities.maximumSkinningJoints` (WP-R1.1's widening law overrode
    the RFC's required-member sketch), enforced at `Mesh.skeleton` assignment with
    `UNSUPPORTED_GPU_FEATURE` — setup-time, per §61. The unbounded path is a bone
    texture, deferred.
  - **A node class must not carry `static typeName`** — that key is §6a's component
    key and the umbrella completeness test enumerates it; `Bone`'s §79 identity is
    the node type `"scene:bone"`. Deviation from RFC 0003's sketch, recorded at the
    class.
  - **A §79 intra-file object reference resolves on first read.** A mesh's skeleton
    is written as bone ids + inverse binds and resolved by walking to the mesh's
    root when `skeleton` is first read — the earliest moment mesh and bones share a
    tree (a factory runs mid-assembly; `restoreNodeId`'s reasoning one level up).
    Missing ids stay pending and retry; a non-Bone id throws. The serializer's
    writer triggers resolution, which is what keeps the P11-1 textual idempotency
    exact.
  - **§17's "missing track types" cost zero code** — an element _is_ a property of
    its array (`"2" in float32Array`), so the existing dotted path grammar already
    addresses `weights.2` and `bones.0.transform.rotation`; the packet's whole §2
    was documentation, tests, and `createArrayElementBinding`. Check whether a
    "missing" feature is a missing _spelling_ before building machinery.
  - **The palette follows the particle-repack precedent**: `Skeleton.update` runs
    inside `collect`, so the uploaded matrices can never be a step older than the
    item pointing at them; under the §43 interpolated builder the palette uses the
    last _resolved_ pose (palette interpolation deferred with CPU skinning, stated
    in source). Skinned casters are excluded from the §69 pass — a bind-pose shadow
    is a different picture too.
  - **Measured: +0.75–0.80 kB gzip in every WebglRenderer bundle** (frame-path:
    draw arm, collect decision, geometry streams; A/B against a HEAD worktree —
    worktrees are the sanctioned baseline mechanism, never stash). The pipeline
    itself is 0 B unless `registerSkinningPipeline()` is called (grep: `skinMatrix`
    in 0 of 9 bundles). Budgets moved: 36→36.5, 34→34.5, 42→43 (ui-demo's 0.40 kB
    headroom was consumed exactly as R-23 warned).
  - **Purity, observed**: the skinned-pose golden's 600 steps contain only 121
    distinct digests — a looping clip reproduces every pose bit-exactly across
    loops, the strongest cheap purity evidence a determinism scenario has produced
    yet.

- **2026-08-28 — WP-R1.3: WebGPU sprites, text, batching, §67 clips.** Decisions worth
  keeping:
  - **The stencil format is a per-frame decision, and R-23's sort key is what makes it
    O(1).** `items[0].clip?.maskPass` picks `depth24plus-stencil8` over `depth24plus`;
    only clipping frames pay for stencil-carrying pipelines and the attachment byte —
    the pipeline-cost law applied to a _format_ (it is baked into every pipeline key).
    A scene that starts/stops clipping reallocates once, like a resize. Corollary: no
    `stencil` renderer option and no no-stencil diagnostic on WebGPU — the backend
    owns its depth attachment and can always widen it; GL needs both only because its
    stencil buffer is a context-creation attribute. Honest residue, stated in source:
    §57 `material.stencil` is inert on clipless frames (= GL without
    `{stencil:true}`).
  - **§57's stencil record splits across WebGPU's seam: test/ops/masks are pipeline
    identity, `ref` is a pass command.** `ref` stays out of the descriptor and the
    key, so a mask writing bit 4 shares the pipeline of one writing bit 1; the
    renderer mirrors the pass's reference and issues `setStencilReference` only on
    change — a clipless frame records none.
  - **A §67 mask is coverage, not shading.** With colour writes forced off, every
    material family rasterises the identical fragment set, so one flat unlit variant
    draws every mask — and a lit/standard clip node masks correctly on WebGPU before
    WP-R1.5 gives its content a pipeline. (GL reuses the item's own program because a
    program costs nothing to switch; a pipeline is a compiled object.)
  - **`queue.writeBuffer` executes in queue order, not issue order — so the GL batch
    uploader's single buffer pair cannot be ported.** A second batch's upload into a
    shared buffer would land before the first batch's recorded draw executes.
    `wgpu-batch.ts` keeps a buffer pair per batch _slot_ (slot k of every frame
    reuses pair k; `beginFrame()` resets the counter — the one contract member GL
    lacks); growth destroys immediately because a slot's previous use was an
    already-submitted frame. §65's staging ring is the noted follow-up, not built.
  - **A second group-0 layout is how a per-draw uniform block widens without moving
    anything.** §55's `quad` needs 16 bytes `DrawUniforms` doesn't have; widening the
    shared block would move `minBindingSize` in every recorded init transcript. The
    sprite layout (160 B) binds the _same_ strided buffer and is created by the first
    sprite draw — the WP-R1.2 "group 1 is created by the first textured upload"
    precedent, second application. The stride's spare bytes were already allocated.
  - **`pipelineKey` grows by conditional suffix, and that is what byte-identity
    demands.** `|s:…`/`|b:…` append only when carried; absence appends nothing, no
    required field can spell the prefixes, so the key stays total and injective while
    every pre-R1.3 key — and every `four:<key>` label in landed transcripts — is
    byte-identical. Batches key as their own _kind_ but share the unlit _modules_
    (one compile per variant across both families).
  - **Text was already done, and knowing why saved a pipeline.** R-28 made a label
    one textured unlit item with per-glyph uvs, so WP-R1.2's `map` variant draws text
    with zero new code; WP-R1.3's text deliverable is the WebGPU restatement of the
    R-28 claims as tests. The plan's "text rides the sprite path" was stale by one
    packet.
  - **A reentrant mid-frame `dispose()` (application code inside
    `camera.updateViewMatrix`) is the one reachable path to a disposed cache inside a
    frame** — pinned as a test: the frame skips every remaining draw and does not
    throw (§61), which is what the draw paths' "unreachable" null-narrowings actually
    encode.
  - **Multi-agent note, third confirmation:** two suite tests failed once while the
    RFC 0003 sibling's edits were mid-flight on the shared tree and passed unchanged
    on re-run. A red suite on a loaded shared tree indicts the tree state first.
  - **Measured: 0 B in every bundle** — no WebGPU symbol (`vertexMain`,
    `requestAdapter`, `depth24plus`, `SpriteUniforms`, `batch-vertices`,
    `setStencilReference`) reaches any tight bundle; `createVertexArray` control 3×
    each. The three tight-budget overruns observed at this packet's gate run
    (+134…385 B) carry the sibling's `jointMatrices` and are RFC 0003's to account.

- **2026-08-28 — R-23: §67's clipping API.** Decisions worth keeping:
  - **A clip is one extra draw and one shared record, and the record's _identity_ is
    the API.** Every item under one clip carries the identical pooled
    `RenderItemClip`, which is what makes the batcher's boundary check one `!==`,
    the backend's read one property load, and nesting free: the subtree test is
    `equal` over the accumulated bits, so no mask ever needs masking — an inner mask
    writing outside the outer region is harmless because the conjunction requires
    the outer bit.
  - **Self-not-subtree has a mirror: subtree-not-self.** §46's layers gate the node
    and not its children; §67's clip gates the children and not the node (a panel
    paints its own background, then contains). The two fields sit adjacent in
    `node.ts` with opposite scopes stated — when adding a per-node render field,
    decide and _say_ which scope it has.
  - **The ninth clip fails toward drawing, and toward a superset.** It is dropped;
    its subtree keeps the eight clips that fit — content spills at a visible
    boundary that points at the offending clip, instead of vanishing
    indistinguishably from a culling bug (R-8's precedent, second application).
    Same direction for the other two failure modes: a clip on a `Group` and a clip
    with no stencil buffer are warned-inert, never masked-to-nothing.
  - **The exhaustion warning is once per allocator, not once per frame** — `begin()`
    resets the plane counter, not the warned flag. An over-budget scene is over
    budget every frame, and a frame-rate warning hides its own first line (§42/§39
    precedent). The _count_ (`refused`) is still per build — it is §84-shaped
    state, unwired until a diagnostics packet wants it.
  - **"Masks first" is a sort key, not a list phase — and it makes a diagnostic
    O(1).** The comparators' key 0 puts mask draws ahead of every §66 key; a single
    `items[0].clip?.maskPass` read then answers "does this frame clip at all",
    which is how the backend's no-stencil-buffer warning costs one comparison
    instead of a scan.
  - **Optional-with-required-override is how a pooled interface widens.**
    `RenderItemBase.clip?` keeps every hand-built item literal and pre-§67
    structural double compiling (`undefined` ≡ `null` ≡ unclipped — R-38's gotcha
    answered structurally); `MutableRenderItem` re-declares it required so the
    builders cannot leave a pooled slot stale. Batcher and backend normalize with
    `?? null`.
  - **The engine's record outranks `material.stencil` on clipped draws** — a
    documented collision, resolved for the containment guarantee an author cannot
    restore by hand. R-7's mask-by-hand tier is untouched everywhere else.
  - **Clips are screen-space, per view; shadows are not clipped, structurally.**
    Plane assignment is frame state (one traversal), mask draws happen per view
    after that view's stencil clear; the §69 pass ignores clips because its
    framebuffer _cannot_ carry stencil bits (R-7's packed-format exclusion) —
    stated in source as the analogue of a sprite casting its rectangle.
  - **A browser gate can prove _intersection_, not just masking, without a golden**:
    full-view content under two offset 4×4 clips leaves 1/6 — a footprint one mask
    (1/3) or the union (5/9) cannot produce. Measured exactly: 76 800 → 12 800
    orange pixels, ratio 0.1667, box x 120…199 y 40…199.
  - **Gotcha (found, not fixed): `Sprite`'s constructor drops the three §49 flags
    its §79 writer writes.** `clip` was passed through by hand;
    `castShadow`/`receiveShadow`/`frustumCulled` still are not — a sprite
    round-trips those as defaults. Filed in TODO.
  - **Measured: +0.50 kB gzip in every bundle** (the allocator and mask emission
    ride in `buildRenderList` — R-6/R-7's law), +0.68/+1.26 kB where §79 and the ui
    staging note ride along. No bumps; **ui-demo is at 41.60/42 kB — 0.40 kB of
    headroom**, the next ui-touching packet must A/B first.

- **2026-08-28 — WP-R1.2: the WebGPU texture tier.** Decisions worth keeping:
  - **Mipmaps are generated, not degraded — and the generator is lazy.** WebGPU has no
    `generateMipmap`; degrading (R-30b's no-`generateMipmap`-context path) would make
    the §62-first backend strictly worse than GL at a feature WebGPU supports, and
    would falsify §84's chain-billed `byteLength`. The blit's module/layout/sampler/
    pipeline are first-chain-lazy and format-keyed, so an application that mipmaps
    nothing records the identical WP-R1.1 transcript — the pipeline-cost law applied
    to a subsystem. `data: null` chains allocate but skip generation (zero-filled
    levels) and skip `RENDER_ATTACHMENT`.
  - **The blit passes are the one legitimate `loadOp: "clear"` in this backend** —
    they are not §61 viewport clears; the whole level is the triangle's.
  - **Sampler-state-as-upload-state becomes sampler-state-as-object**: a second cache
    keyed on the canonical string of the five _resolved_ values, so "names the
    default" and "names nothing" share one sampler. Total key coverage is what makes
    a hit mean something.
  - **WebGPU has no queryable anisotropy limit** — `limits.maxAnisotropy` is honored
    if a device ever reports one, else 16 is assumed (GL's de-facto ceiling, so both
    backends clamp 64→16); and `maxAnisotropy > 1` is API-invalid without full
    trilinear filtering, so non-trilinear textures degrade to isotropic — §62's
    degrade reached for an API-validity reason.
  - **Group 1 is per-texture; group 0 stays per-draw.** Merging them would allocate
    one bind group per (draw × texture) inside the frame. The pipeline cache takes a
    layout _provider_ so the compiled-against and bound-against layout are one
    object, created lazily.
  - **Vertex slots are positional, shader locations are names**: uv keeps
    `@location(2)` whether it lands in slot 1 or 2; both sides are one counter.
    Getting it wrong validates cleanly and draws garbage — stated in source.
  - **Two opaque `object` aliases cannot share a union**
    (`no-duplicate-type-constituents`): `GpuBindGroupEntry.resource` is typed
    `GpuBufferBinding | GpuTextureView` with the prose naming three kinds — the
    layout entry, not the handle's type, disambiguates.
  - **`recording-gpu.ts` records `createView`'s descriptor only when passed**, so
    WP-R1.1 transcript lines stayed byte-identical while mip-level views became
    assertable.
  - Map without uvs degrades to the flat draw; map disposed skips the draw (§83) —
    degradation to a variant's _absence_, never to undefined content.

- **2026-08-28 — A-3 / RFC 0002: the §81 plugin system.** Decisions worth keeping:
  - **§3.1 chose the design, not taste: a capability _token_ beats a fixed
    `PluginContext`.** Five of the six registries §81 hands over live downstream of
    `core`, so an interface naming them would invert five edges of a frozen matrix,
    and `unknown` members would type nothing. A token is `{ name, revocable }` plus a
    phantom `T`, declared by whoever owns the value — so `core` names a string and a
    type parameter, a plugin gets `context.require(RENDERER_REGISTRY): RendererRegistry`
    checked by the compiler, and a sixth capability is additive. Use this move whenever
    a lower package must hand over a higher package's type.
  - **The phantom is a plain optional property, not a `unique symbol` brand.** A
    module-private `declare const brand: unique symbol` breaks declaration emit
    (`tsc -b` writes `.d.ts` for every package), and exporting it would ship a runtime
    name with no runtime value. `readonly capabilityType?: T` costs nothing and emits.
  - **Absence is the honest signal, and it is worth saying eleven times.** Six of §81's
    extension points have a token; five (asset formats, shader nodes, UI controls,
    editor tools, compute) have **none**, because there is no registry to hand over. A
    plugin asking is refused _by name_ at install. The alternative — a fixed interface
    with five `undefined`-valued members — would make "not implemented" and "not
    provided by this host" indistinguishable.
  - **Acquisition is the enforceable proxy for "wrote into".** The host cannot observe
    a write into a registry it does not own; it can observe that a plugin _asked_. So
    asking for a non-revocable capability is what pins a plugin, and `uninstall` refuses
    naming it — `removeCollider`-returns-false vs `addCollider`-throws, again.
    `SIMULATION_SYSTEMS` is the one revocable token because `SystemRegistry` is the one
    registry with real removal.
  - **Sealing the context beat wrapping a registry.** RFC 0002 proposed an
    `isSealed`-aware wrapper for `SIMULATION_SYSTEMS`. Sealing the _context_ after
    `install()` — `get`/`require` refuse, `plugins`/`capabilities` still read — is
    general over all six capabilities, needs no edit in any registry's package, and is
    sealed in a `finally` so a plugin whose `install` threw cannot keep fetching. What
    a plugin does with a registry it already fetched remains beyond the seam's reach,
    and the source says so rather than implying otherwise.
  - **A defensive branch no caller can reach is a coverage hole (fifth confirmation).**
    Three of them appeared in the first cut — an `isInstalled` check for a runtime that
    can only install once, a `?? []` for a map every install path populates, a
    `#current === undefined` guard on a method only a running plugin can reach.
    Restructuring so the state cannot be missing (`#currentName: string`, `#pins` keyed
    by plugin name, first-non-revocable recorded off the token at acquisition) took
    `plugin.ts` from 99.13% branches to **100×4** and deleted code.
  - **The zero-cost-when-unused target is unreachable once §45 owns the option, and
    the reason generalizes.** `resolveRenderer`'s lazy module-`let` works because a
    _backend package_ calls `registerRenderer` and thereby brings the registry in. A
    plugin is a **value passed at runtime**, and the same RFC forbids side-effect
    registration (`"sideEffects": false`), so nothing a plugin-using application imports
    can populate a slot. `Application.initialize` must statically reach the installer.
    What _was_ achievable and is achieved: `installPlugins` is the front door and
    `PluginHost` references _it_, so the host class and all its messages tree-shake out
    (grep-verified 0 occurrences in four bundles). **Measured +1.28–1.31 kB gzip in
    every Application-bearing bundle**; trimming the refusal messages once bought
    0.36 kB of the original 1.64. Rule: _a lazily-created module `let` only helps when
    the thing that needs the feature is a module, not a value._
  - **§96's plugin boundary is a rule about arrival, not about containment, and saying
    so is the deliverable.** No sandbox is proposed or provided. The enforceable claim
    — untrusted content can never _become_ a plugin — is pinned by an A-2-style
    allowlist test (no package but `core`/`four` may mention the host) plus
    `@ts-expect-error` that `add` admits no string. Plugins named in a scene document
    were rejected without a staging note, because staging would imply it is coming.
  - **Install order is a §33 property because it becomes fixed-step order.** Two
    plugins registering equal-priority systems produce different transcripts by install
    order. Kahn driven by a scan of the supplied list gives topological order with
    supply-order tie-breaks; `tests/integration/plugin-order.test.ts` asserts two
    listings differ **only** where the declared dependencies permit.
  - **Gotcha (tracking): GAP v1 register row 4's recommendation text still said
    "defer explicitly (Alternative E)" while the same row was marked DECIDED/accepted
    and the RFC header says accepted.** Implemented per the RFC header and rows 5–6;
    row 4's wording reconciled at landing. A row whose _recommendation_ and
    _decision_ disagree is worth reading twice before implementing either.
  - **Landed with the batch:** `docs/COMPATIBILITY.md` §5 rewritten (was "n/a — the
    §81 plugin system is not implemented", which became false at this landing).

- **2026-08-21 — WP-R1.1: the WebGPU backend's foundation.** Decisions worth keeping:
  - **A clear is a draw on WebGPU, and that is forced rather than chosen.** §61 confines
    a clear to the viewport rectangle; `loadOp` clears the whole attachment and has no
    scissor, so a `loadOp: "clear"` implementation would erase view 1 when view 2 began.
    `setScissorRect` plus a full-surface triangle _is_ the GL backend's scissored
    `clear`, expressed in the primitives WebGPU has — colour-write-masked for a view
    that carries no `clearColor`, `depthCompare: "always"` with `z = 1` for the depth
    clear every view owes.
  - **One render pass per frame, not per view** — WebGPU's scissor and viewport are pass
    commands, not ambient state. The one place this backend is structurally _safer_
    than the GL one: no state mirror, nothing to restore in a `finally`, and a draw
    that throws cannot leak state because the pass is never submitted.
  - **The depth remap goes in the shader, not on the camera.**
    `Camera.updateProjectionMatrix` accepts `"zero-to-one"` and this backend
    deliberately does not call it: a renderer that rewrote an application-owned
    camera's projection would corrupt any other renderer sharing that camera (§61:
    rendering mutates nothing in the scene). `(clip.z + clip.w) * 0.5` in the vertex
    stage is exact and leaves frustum culling against the one convention both backends
    share — which is what makes cross-backend render-list identity hold.
  - **Uniforms: one buffer, one bind group, a dynamic offset per draw**, sized _before_
    the pass is recorded from an upper bound. Growing mid-frame would orphan the bind
    group the pass has already been handed. One `queue.writeBuffer` per frame.
  - **The lazy cache inverts R-19's uniform-vs-variant argument.**
    `useMap`/`useVertexColors` are uniforms on WebGL because variants meant more
    programs compiled at init. With a lazy descriptor-keyed cache a variant nothing
    draws is never created, so on WebGPU they are variants — no per-fragment branch,
    and the vertex layout can omit the colour buffer entirely.
  - **The widened `RendererCapabilities` is optional-with-a-tri-state, and that is what
    makes it additive.** `undefined` means "this backend has not been taught to
    answer", distinct from `false`. Zero test doubles and zero umbrella files changed.
    The WebGL backend answers everything it can state _without a new GL call_ and
    **omits** the two `getParameter`-needing members — R-30b's lazy-query law again.
  - **Gotcha (browser gate): `--enable-unsafe-webgpu` is NOT free for the other
    projects.** A `webgl2` context still initialises alongside it — true, and not the
    whole gate: the §118 flagship's slow-motion assertion fails reproducibly with the
    flag on (initialising Dawn changes the frame pacing that spec measures). The flag
    belongs on the `webgpu` project's own `launchOptions`, with
    `testIgnore: "webgpu/**"` on `chromium` so the new specs do not run twice.
  - **Gotcha (doubles): `globalThis.navigator` is a getter-only own property under
    Node 22.** A plain assignment throws; installing a fake host needs
    `Object.defineProperty` and the captured descriptor to restore.
  - **`recording-gl.ts` retains typed-array arguments, and the GL backend uploads
    matrices out of a module-level scratch** — every matrix read off that tape after
    the frame is the frame's _last_ matrix. `recording-gpu.ts` copies at record time;
    the cross-backend harness snapshots GL's matrices through a thin wrapper rather
    than changing the landed helper underneath the suites that depend on it.
  - **Cross-backend identity, measured:** NullRenderer, WebGL 2 and WebGPU submit the
    same draws, in the same order, with the same transforms, for a scene mixing opaque,
    transparent, explicitly-ordered and frustum-culled nodes across two views.
  - **Measured: the umbrella's `export * as renderWebgpu` still tree-shakes.** No
    WebGPU symbol reaches any tight bundle (grep for
    `vertexMain`/`requestAdapter`/`depth24plus` against a `createVertexArray` control).
    The uniform +0.10–0.11 kB gzip is the two capability records, not the backend. No
    budget bump.

- **2026-08-21 — PH-11b: the solver-backed character controller.** Decisions worth
  keeping:
  - **The extends-vs-holds question was decided by ES privacy, not by taste, and the
    rule generalizes: inherit only when you can keep every inherited promise.**
    `CharacterController`'s `#verticalVelocity`/`#grounded` have no setters, so a
    subclass overriding `step` cannot maintain the state its own inherited getters
    report — and it should not want to, because `grounded` is a promise about a
    _plane_ and a swept controller's is a promise about _geometry_. Holding lets the
    swept class expose the half that stays true (intent, heading, parameters —
    executed once by the held object) and **re-declare** the half whose meaning
    changed. It also cost `@fourjs/motion` no edit at all.
  - **A subclass sharing a `typeName` would have bought a free system and sold §79 to
    get it.** The registry refuses a duplicate serializer name, so a swept controller
    would round-trip through the plain one's serializer. Correct §79 outranks a free
    system.
  - **§39 placement is decided by `PhysicsWorld.step`'s own step 1.** Kinematic bodies
    are fed `setNextKinematicTransform` from the _node transform_ at the top of the
    step, so a character written at 400 reaches the solver at 600 and one written
    after the solve would leave its collider a step behind the pose it just computed.
    Corollary: the geometry the casts see is start-of-step geometry —
    `ForceFieldSystem`'s velocity convention, the only self-consistent pairing.
  - **§42 asks who _writes_, not who _reads_.** Consulting the solver does not make a
    controller `"physics"`; §12's "kinematic controllers directly prescribe movement"
    settles the tier, and `"physics"` would additionally make the publish pass
    overwrite the character with a pose that does not exist.
  - **The "one authority, one system" rule has exactly one permitted exception, and
    §3.1 is what creates it.** `@fourjs/motion` may not name `PhysicsWorld`, so
    `KinematicSystem` _cannot_ advance a solver-backed controller. The hazard the rule
    protected against — an uncatchable second writer — is caught by dispatching on
    disjoint component types and refusing (once, `console.warn`) a node carrying both
    locomotion components.
  - **A collide-and-slide loop needs a stated constant, not an epsilon.** Each
    iteration consumes distance or removes a degree of freedom, so it converges — but
    §30 reports an already-overlapping cast as `distance: 0`, and "converges" is not
    "terminates". `maxSlides` caps solver calls per character per step; leftover
    motion is **dropped**, because the alternative is moving the capsule into
    geometry.
  - **Gotcha, found by measurement: a step-up must reach forward by at least one
    capsule radius.** Stopping with half the capsule over the lip contacts the step's
    _edge_, and an edge normal is not the tread's — measured `normal.y = 0.564` on a
    flat 0.25 m riser against a 0.707 limit, so the flat surface read as unwalkable
    and the character jittered on the lip for ever. A step is taken only if the feet
    land _on_ the tread; the price is a deliberate over-step of up to one radius, once
    per step.
  - **Snap distance ships and coyote time does not, and the line between them is "is
    it a collision fact?".** The ground under a character walking down a ramp _is_
    there, just lower. The frames a player is forgiven after leaving a ledge are a
    feel policy, composable from `grounded` in three lines.
  - **A staged feature is better shipped as a published handle than as a paragraph.**
    Platform carry is staged — but `groundBody` costs nothing (the probe's hit already
    carries it) and `translate()` applies un-swept displacement, so an application can
    carry itself today. Pushing dynamics stays fully staged because it needs a
    _policy_, and there is nothing to hand over.
  - **Measured, and it is honest that it is not zero: the character does not push a
    dynamic box.** It stops one skin short, so the solver sees no penetration. Pinned
    as a test rather than hidden.
  - **§33: a controller that consumes solver queries inherits the solver's tier** —
    `same-runtime`, because every shape-cast distance and normal is f64→f32 across the
    wasm boundary before this code touches it. The golden pins `jumpsTaken: 7` of 300
    attempts, `landings === jumpsTaken`, the fall clamp at exactly −6, one accepted
    step-up at floor + riser, and a 60° ramp never climbed against a 45° limit.
  - **§79 splits by package, not by section.** The swept controller registers with
    `registerPhysicsSerializers` beside `RigidBody`/`Collider`. The umbrella's
    enumerating test caught the registration mechanically, exactly as built.
  - **Multi-agent note, second confirmation:** `@fourjs/particles`' `random.test.ts`
    times out only under full-tree parallelism while a sibling is in flight; passes
    standalone. A red test on a loaded shared tree indicts the tree state first.
  - Gotcha, seventh confirmation: **`pnpm run docs` is the type _and_ link gate** — a
    `{@link}` from `@fourjs/physics` cannot resolve a symbol that lives in `four`; plain
    code span.

- **2026-08-21 — R-30b: §77 mipmaps, the min-filter split, anisotropy.** Decisions worth
  keeping:
  - **A union widens when the feature giving its members meaning arrives — and it widens
    beside the field it refines, not instead of it.** R-30 wrote that the `minFilter`
    split would "land with mipmaps, beside this field". It did: `filter` is untouched and
    _is_ the magnification filter; `TextureMinFilter` is `filter`'s two values plus GL's
    four `*-mipmap-*` modes, on the min side only. **There is no `magFilter`, and that is
    the non-obvious half**: GL accepts only `NEAREST`/`LINEAR` for magnification, so the
    classic `minFilter`/`magFilter` pair would split a direction that can never carry the
    four values that motivated splitting.
  - **A derived default beats a constant default when the constant would be nonsense.**
    `minFilter` resolves to `filter` with no chain (the byte-identity anchor) and to that
    filter's chain-aware form with one. Defaulting to `LINEAR` on a mipmapped texture
    would build a chain nothing samples.
  - **§85 refuses what no device could honour; §62 negotiates what some device cannot.**
    A mip-choosing `minFilter` without `mipmaps: true` is _refused_ (GL samples the
    incomplete texture as opaque black — a silent whole-surface failure), while
    `anisotropy: 16` is _clamped_ to the device ceiling and dropped where the extension is
    absent. A quality knob that turned a legal scene into an error on half the fleet
    would be worse than one that quietly costs less.
  - **A capability query must be lazy if the alternative moves recorded transcripts.**
    `getExtension` is fetched on the first texture asking for anisotropy above 1, never
    at `initialize` — reading it at init would add two GL calls to every context and move
    every landed integration transcript. The §62 _report_ for anisotropy is therefore
    staged with the texture-format report, stated in source. Pipeline-cost law, applied
    to a query.
  - **Optional context members are how a GL surface grows without breaking its doubles.**
    `WebglContext.generateMipmap` and `.getExtension` are optional — presence is the
    capability — so every pre-existing double still satisfies the type, and a context
    that cannot mipmap degrades to one level rather than a black surface.
  - **Accounting follows the allocation.** `Texture.byteLength` sums the mip chain level
    by level (4 × 4 mipmapped = 84 bytes, not 4/3 × 64), keeping §84's `textureMemory`
    true; no chain, no change, so no landed §84 number moved.
  - **What is left of §77 is what is _not_ upload-time state.** Wrap, filter, colour
    space, mipmaps and anisotropy were all cheap for one reason: set on the texture
    object at upload, read by nothing on the draw path. Cube/array/3D change the sampler
    type in every shader; compressed containers change the upload call; video needs
    per-frame update semantics. That is the boundary to quote when the next §77 packet is
    scoped.
  - **A browser gate can measure a shimmer.** A one-texel checkerboard proves nothing —
    plain `LINEAR` averages it to grey by itself, which is how the first draft of
    `mipmaps.spec.ts` failed. Eight-texel cells at 8× minification put a bilinear tap
    _inside_ one cell, and then the claim is assertable: 81% extreme pixels → 1%, and a
    half-pixel nudge moving the frame 120 mean luma → 39.
  - **Measured: +0.33–0.69 kB gzip in every bundle carrying `Texture`** (A/B). Budgets
    bumped 34.5 / 32 / 40.5 kB with the numbers.

- **2026-08-21 — R-1 WebGPU scoping.** Decisions worth keeping:
  - **CI can run WebGPU, and the flag is exactly one.** Measured against the sandbox's
    pre-installed Chromium (`/opt/pw-browsers`): `--enable-unsafe-webgpu` alone yields a
    SwiftShader adapter on both `chrome` and `headless_shell` — a WGSL render pipeline,
    render-to-texture, `mapAsync` readback and a compute pipeline with storage buffers
    all run. Extra Vulkan flags are redundant (Dawn resolves the `libvk_swiftshader.so`
    shipped in both browser trees). Adding the flag alongside the existing
    `--use-gl=angle --use-angle=swiftshader` does not disturb the WebGL 2 gate.
  - **Gotcha (probing WebGPU): `about:blank` reports `navigator.gpu` absent.** The same
    browser on `http://localhost` reports it present — an opaque origin is not the
    secure context WebGPU wants. Any WebGPU probe or gate page must be _served_, never
    `page.setContent`-ed.
  - **Node has no WebGPU** (`globalThis.navigator.gpu` is `undefined`), so every
    Vitest-tier WebGPU test is against a structural double — the same position
    `WebglContext`/`recording-gl.ts` already occupy.
  - **Cross-backend determinism has exactly one claimable invariant: render-list
    consumption.** Pixel identity between rasterisers is not claimable, and transcripts
    are lists in different languages. What _is_ assertable — and what makes §61's "the
    logical scene shall remain independent of the selected backend" testable for the
    first time — is that every backend receives the identical `RenderItem[]` and
    `RenderBatch[]` for a given scene/view/alpha.
  - **The batching seam is the render tier's best-factored one.** `RenderBatcher` is a
    pure planner in `@fourjs/render`; `gl-batch.ts` is only the uploader. A second
    backend's batch module is a twin of `gl-batch.ts`, not of `batch.ts`.
  - **`RendererCapabilities` is the one shared-interface change a second backend
    forces** — two members today against §62's eleven; widen **once**, additively, in
    the first packet, or churn three implementors nine times.
  - **`RenderTarget`'s stencil ⊥ depthTexture exclusivity survives the WebGPU port for
    an independent reason** (`depth24plus-stencil8`'s combined aspect). A constraint two
    backends reach independently is a design, not an artefact of the first one.
  - **On WebGPU, pipelines are lazy and descriptor-keyed — a deliberate departure from
    compile-at-init.** `GPURenderPipeline` is immutable and combinatorial, and R-6's
    pipeline-cost law says the cache must be lazy or it taxes every example that never
    selects WebGPU. New hazard: pipeline-cache keys must be canonical strings, not
    objects.
  - **RFC 0001 and R-1 were in a circular wait, and hand-written WGSL is the break.**
    Hand-porting the seven pipelines is the same duplication the project accepted for
    GLSL, is bounded, and makes the emitter testable afterwards. One thing R-1 owes the
    RFC: bind-group layouts declared as data, so the future emitter targets the same
    layout.
  - **`AUTO_RENDERER_ORDER` already prefers `"webgpu"`**, so the day the backend is
    registrable, `registerWebgpuRenderer()` silently moves an application off WebGL 2.
    Filed as an owner question rather than decided.
  - **Gotcha (bundles): the umbrella re-exports the WebGPU stub**
    (`export * as renderWebgpu` in `packages/fourjs/src/index.ts`), and four examples
    import from `four`. Free today; at sub-kB headroom it must be a `pnpm run size`
    gate in the first packet, not an assumption about namespace tree-shaking.

- **2026-08-21 — PH-11's residue: §12 character controllers + §44's first-person rig.**
  Decisions worth keeping:
  - **The first-person "arbitration" was a decomposition, and asking which writer wins
    was the wrong question.** R-36 staged the rig on aim-vs-free-look arbitration under
    §42's one authority. The answer is that yaw and pitch belong to _different
    objects_: yaw **is** the character's heading (the direction it walks and the
    direction it faces are one number, so a second writer of it is a second definition
    of where the character is going), and pitch is not a property of a walking body at
    all. So pitch moves to a child node and the composition `yaw ∘ pitch` falls out of
    the scene graph — no roll, no gimbal arithmetic, and §42 satisfied
    **structurally**, because an authority is per _node_. Generalizes: when two writers
    want one node, ask whether they want the same node.
  - **One authority means one system, even when the components are unrelated.**
    `CharacterController`, `FirstPersonLook` and `KinematicController` all write under
    `"kinematic"`, so they are advanced by the **existing** `KinematicSystem`; §42
    compares the authority, not the system instance, so a second system would be a
    second writer nothing could catch. Order within a node: locomotion → free look →
    commands, with the command channel **last** and winning — alternatives, not layers.
  - **§12's one bullet decides the tier, and the sentence above it decides it harder.**
    "Kinematic controllers directly prescribe movement" is the whole scope argument: a
    §12 character controller is not a solver object, so gravity against a _plane_ is
    the honest tier and ships complete, while slide/step-height/slope/capsule sweeps
    are staged.
  - **The staged half's blocker is a direction, not a missing capability.**
    `PhysicsWorld.shapeCast` (§30) already exists — the reason a swept controller is
    not in `@fourjs/motion` is that §3.1 gives motion only `core`/`math`/`scene` and the
    edge runs `physics → motion`. So the solver-backed half is a `@fourjs/physics` packet
    (`SweptCharacterController` reusing this class's intent/heading/gravity state), and
    an injected query interface with no implementor was declined: absent beats
    accepted-and-ignored. **Re-check a blocker against source** — this one was one
    `grep` away from being mis-filed as "the adapter has no queries".
  - **`maxAngularSpeed` was deliberately NOT reused, and that is consistent with the
    rule rather than an exception to it.** `LookAtConstraint` has a rate limit because
    it computes its own goal from a moving target. `turn(delta)`/`look(delta)` take
    deltas the application already chose, so a second limit would silently discard
    input the caller believed was accepted. The spelling arrives when a controller
    grows a _desired heading_ — i.e. when there is something to limit.
  - **Diagonal movement is the oldest bug in the genre, and the fix is one `sqrt`.**
    `setMoveIntent` clamps the intent's _magnitude_ to 1. `Math.sqrt` not
    `Math.hypot`, because the scale multiplies straight into a transform and only
    `sqrt` is specified exactly rounded (§33).
  - **The write gate is what keeps the §42 idle rule true for a component that is never
    really idle.** A character with gravity writes every airborne step, so `active` is
    `!grounded || headingDirty || intent ≠ 0` — a grounded, still, unturned character
    writes nothing and therefore warns about nothing. Corollary chosen on purpose:
    with `gravity: 0` a character above the plane **hovers and stays ungrounded** — it
    is falling at zero speed, and pretending otherwise would make `jump()` succeed in
    mid-air.
  - **Both writes commit or neither does.** The whole pose is computed into locals and
    checked for finiteness before `position.set`, so a `NaN` arriving from elsewhere
    leaves the transform _and the vertical state_ untouched and counts one
    `skippedSteps`.
  - **A golden can pin the two arms of a refusal.** `jumpsTaken: 3` against six
    attempts is the evidence that `jump()` refuses in mid-air, and
    `landings === jumpsTaken` that every jump came back down; `pitchLimitHits: 162`
    says the pole guard was _reached_, and `fallerVerticalVelocity: −6` that the
    terminal-velocity clamp bit. Four readable numbers that localise a change before
    anyone opens a debugger.
  - **§79 asymmetry worth remembering: vertical motion is scene state, move intent is
    not.** A character saved mid-jump is at a height the document already carries,
    moving at a speed nothing can reconstruct — so `verticalVelocity`/`grounded`
    round-trip. The move intent is this frame's input, and §79 documents do not carry
    the player's thumb. `maxFallSpeed` is written **by omission** when infinite,
    because `Infinity` is not JSON and absence already means "unbounded" on both
    sides.
  - **Multi-agent note (orchestrator, 2026-08-21):** the playground sensor-zone browser
    test failed consistently while this packet's `packages/motion`/`four` edits were in
    flight (the example builds against the shared tree's source) and passed immediately
    on the settled tree. A red browser test on a shared tree indicts the tree state
    before it indicts the spec — settle, then re-run, before bisecting.
  - **Measured:** **0 B** in five of six bundles — checked structurally
    (`character-controller`/`first-person-look` appear zero times in each) —
    **+0.93 kB gzip** in `motor-digital-twin`. No budget bumps.
  - Gotcha, sixth confirmation: **`pnpm run docs` is the type gate, vitest is not.**

- **2026-08-21 — RFC 0005 (pixel/GPU-id picking) + the `tests/` typecheck gate.**
  Decisions worth keeping:
  - **A node's id is a `string`, and that is a picking design constraint, not a
    detail.** `Node.id` is `node-<n>` because §33 forbids random ids. An RGBA8 id buffer
    holds 32 bits per texel, so an id pass can never encode `node.id` — it encodes a
    **dense index into a per-pass table**, built in **scene traversal order** (never
    `Set`/`Map` iteration order) and rebuilt every pass. The public result hands back
    the string; the integer never leaves the service.
  - **A picking result must never enter a §33 checksum.** A pick is a §34 _input_; a GPU
    read-back is not reproducible across drivers. An application driving simulation from
    a pick records the resulting **action**, not the pick.
  - **Async is the honest contract on every backend, including one that could answer
    synchronously.** WebGL 2's plain `readPixels` stalls; the non-stalling paths
    (`PIXEL_PACK_BUFFER` + `clientWaitSync`, WebGPU `mapAsync`) are both async. A
    capability tier may change _quality or availability_; it must never change an API's
    **shape**. The result carries the `frame` it came from, so "correct for what was
    clicked" is distinguishable from "stale for what is on screen".
  - **The seam is `PickProvider { pick(ndcX, ndcY): Promise<string | undefined> }`**, in
    `@fourjs/input`, naming no render type — the fourth instance of the FetchLike /
    SurfaceSizedCamera move. `@fourjs/input` gains no dependency; the adapter is four
    lines in the application; a test satisfies the provider with a `Map`.
  - **`tests/tsconfig.json` existed for months and nothing ran it.** A config file is
    not a gate until a script invokes it — check for the _script_, never for the _file_.
    Its first run found 21 errors: 13 more `OrthographicCamera({ height, aspect })`,
    4 browser fixtures that passed `clearColor` through the **id** parameter and
    therefore never cleared, one `Sprite({ size })`, one joint-seam narrowing, and two
    `ReplaySnapshot` conversions.
  - **A behavioral fixture fix invalidates the golden recorded against the bug.** The
    four never-clearing fixtures were fixed types-first by a packet that could not run
    the browser gate; the orchestrator's verification run caught
    `text-label-nearest-visual-linux.png` failing at 97% of pixels — the background that
    now actually clears — and regenerated it deliberately. Rule: a fixture behavior fix
    and its golden must be validated in the same landing, whoever owns the browser gate.
  - **Gotcha: prose that names a compiler as its assertion must be checked against the
    script list.** `replay-scenarios.ts`'s header claimed the
    `ReplaySnapshot` ↔ `PhysicsSnapshot` compatibility was verified **in both
    directions**; the consume direction never compiled (`configuration` is `unknown` by
    package-boundary design). Two files cited `tsc --noEmit -p tests/tsconfig.json` as
    their real assertion; neither had ever been run by anything.
  - **A structural double narrows through the guard the owning package already exports,
    never through `as any`.** `supportsSolverJointAccess` as both an `expect` and a
    narrowing throw turns a compile hole into a _stronger_ runtime assertion. Where a
    cast is genuinely unavoidable, it goes in a named helper whose doc states why it is
    safe.
  - **Gotcha (playwright): `pnpm test:browser -- <spec> --update-snapshots` does not
    forward the flag** in this repo's script setup — the golden stays untouched while
    the run appears to update. `pnpm exec playwright test <spec> --update-snapshots` is
    the form that works.

- **2026-08-21 — the examples modernization packet (Text, lookAt, ScreenCamera).**
  Decisions worth keeping:
  - **§7a's default screen origin is the wrong one for a `@fourjs/ui` tree.** §74 lays
    children out at `(left, −top)` — a Y-**up** frame with downward offsets expressed
    as negative numbers — and `"top-left"` is the one origin that flips Y in the
    projection, so every one of those offsets would climb the screen. Both flagships
    use `origin: "bottom-left"`. Generalizes: the default origin is right for content
    authored the way CSS is, and wrong for content authored the way the world is.
  - **A plane at constant depth is a scale and a translation, and that made one
    flagship's move pixel-exact.** `motor-digital-twin`'s instrument column kept its
    own unit under `UI_UNIT_PIXELS = HEIGHT / (2·UI_DEPTH·tan(fov/2))` on a
    screen-space root, so forty authored literals meant exactly what they meant when
    the column hung 2.2 units in front of the camera. The §118 flagship was
    re-authored in pixels instead, because _its_ numbers are §74 layout sizes. Rule:
    keep the unit when the numbers are a picture, convert it when the numbers are a
    layout.
  - **Name only the layer you are adding.** Both flagships define `"ui"` and leave the
    world on `DEFAULT_LAYER_MASK`, rather than `defineLayer("world")` plus a mask on
    every mesh. §46 is self-not-subtree, so the second form has to be maintained by
    every future packet that adds a renderable. The cost of the first form — every UI
    drawable needs the mask — is paid in the two or three funnels that build UI nodes
    and nowhere else.
  - **`Text` was load-bearing for the layer work, not merely tidier.** A skin that
    rebuilds glyph `Sprite`s whenever the status text changes creates nodes on the
    default layer every frame; `applyLayers` at setup cannot reach them. One `Text`
    node created at attach makes the mask a single write.
  - **`Text.size`/`letterSpacing` have no equality check; `text` does.** Writing all
    three on every `layout()` pass marks the node dirty every frame and rebuilds
    vertex buffers that did not move. Every skin here guards the two that do not
    self-dedup. Worth a look the next time a derived-geometry node grows a setter.
  - **A rewritten aim is allowed to move, and the number belongs in the comment.**
    `camera.lookAt((0, 0.25, 0))` derives −0.17021 rad where the file wrote −0.17 —
    2 × 10⁻⁴ rad, ≈ 0.14 px, no golden at risk, every threshold held. The sun's move
    is _exact_: `‖(−3.45, 7.51, 5.63)‖ = 10.000`.
  - **`OrbitRig`/`LookAtConstraint` were declined for `first-3d-scene`, on merit.**
    Neither the camera nor the sun moves; a per-step component plus an authority plus
    a system registration is three concepts bought to replace two one-line writes.
    §44's rigs exist for targets that _move_.
  - **The measurement to reuse: `data-drawcalls`.** The twin publishes §84 statistics,
    which made the draw-call claim a before/after read (159 → 59) rather than an
    argument; triangles held at 2014, the cheapest check that the rewrite drew the
    same picture.
  - **Gotcha (`controlPixels`): a widget's `transform.position` is its parent's frame,
    not the canvas.** The first cut published every control's position relative to its
    row; the browser gate caught it as `hover === "none"`.
    `resolveWorldTransform(widget).elements[12]/[13]` is the answer — plus
    `[0]`/`[5]` when the screen-space root is scaled.
  - **Measured:** the Text rewrite _shrinks_ bundles (a cut-cell cache and a sprite
    loop cost more than a `Text` import): first-2d 45.32 → 45.17, ui-demo
    38.98 → 38.82, twin 945.41 → 945.26 kB gzip. Two goldens moved, both ui-demo's,
    both confined to glyph pixels. `particles-demo`'s +109 B overrun predates the
    packet (same file hash both arms) — bumped 31 → 31.5 kB with the measurement.

- **2026-08-21 — A-18 content hashing + §79 manifest, A-19 texture tier.** Decisions worth
  keeping:
  - **The hash is SHA-256 because of what §79 asks it to DO.** §79's manifest clause
    carries two jobs: cache-busting (any hash) and verification on reload (integrity
    against whoever answers the request — §96's untrusted party). A non-cryptographic
    hash is collidable by construction, so verifying with one would _announce_ integrity
    without providing it — worse than no check, because callers would trust it. Async is
    free: `load` is already async, hashing is IO, and §33 is untouched for the same
    reason the manager is allowed `globalThis.fetch`. `crypto.subtle` is reached through
    a `globalThis` probe with a local structural interface — no `node:` import, so
    `graph:check` is unaffected, and the package still names no platform type.
  - **Presence is the capability — but hashing's missing-capability behaviour is the
    OPPOSITE of abort's.** No `abortController` → cancellation degrades quietly (the
    socket drains). No `digest` (an insecure browser context has `crypto` without
    `subtle`) → the load is **refused**, loudly, at the call. A verification that
    silently passes is worse than no verification; a cancellation that silently drains is
    not.
  - **The hash covers the response's BYTES, whatever the loader reads.** A hashed load
    reads the body once as bytes and derives `text()`/`json()` from them through an
    injected `decodeText` (`globalThis.TextDecoder` by default). Rejected alternatives:
    hashing only byte-reading loaders (a §79 manifest verifying a JSON scene is a
    first-class case), and hashing re-encoded text (the same URL would then hash
    differently under `binaryLoader` and `jsonLoader` — a hash that depends on its
    observer cannot go in a manifest).
  - **Verification is per caller, not per load** — the coalescing-consistent answer,
    matching abort rule 2. The shared load computes one hash; each waiter compares its
    own `expectedHash` and a failure detaches only that waiter's reference. **The
    verification wrapper goes OUTSIDE the abort wrapper**: reversed, a waiter that
    aborted and then saw the shared load settle would hand its reference back twice.
    (Measured, not assumed — the `#withAbort` `done` latch only makes abort-vs-settle
    exclusive, not abort-vs-verify.)
  - **Hashing wraps inside `boundedResponse`**, so §96's size limit refuses an
    over-budget body before a digest is ever computed over it.
  - **A-16 was never blocked on more than this.** §79's manifest is now executable; the
    remaining half is that `SceneResourceCatalog.get(key)` is _synchronous_
    (deserialization is), so manifest → catalog is necessarily preload-then-catalog. That
    is a `@fourjs/four` packet, not an assets one.
    `tests/integration/texture-manifest.test.ts` runs the seam.
  - **A-19 shipped at the "assets half" tier, and the row says which half.** The §77
    loader tier lives in `@fourjs/assets`; everything renderer-side (cube/array/3D,
    mipmaps, anisotropy, compressed containers, render targets, video) is `R-30b`'s, and
    §78 glTF's three blockers are unchanged. `TextureAsset` satisfies `TextureSource`
    **structurally** (`PARTICLE_INSTANCE_FLOATS` precedent) — `@fourjs/assets` sits below
    the renderer in §3.1 and §62 allows several backends, so the dependency edge would be
    the wrong direction.
  - **The §7a row flip belongs in the loader.** `TextureSource.data` already said so
    ("flipped by the adapter that produces them (§76), not by the backend"); `flipY`
    defaults to `true` because every codec decodes top-row-first.
  - **§96's decompression-limit residue is now half-discharged.** The first decoder in
    the engine brought both bounds with it: absolute decoded size (64 MiB = 4096²·4)
    _and_ expansion ratio (1000×) — the ratio is the one that catches a bomb, since the
    absolute bound lets a 200-byte file legitimately claim 60 MiB. Pre-decode with an
    optional `probe`, post-decode without one; the honest residue (a platform
    `createImageBitmap` cannot be pre-bounded at all) is written in source, not implied
    away.

- **2026-08-21 — R-37 `ScreenCamera` + the trackball rig.** Decisions worth keeping:
  - **A derived projection must not inherit an authored one.** `ScreenCamera extends
Camera`, not `OrthographicCamera`: the six bounds come from
    `(width, height, resolution, origin, units)`, and inheriting writable
    `left/right/bottom/top` would give a caller fields whose writes the next resize
    silently discards. The generalisation: _never inherit a settable field you intend to
    overwrite._
  - **§7a's screen space reconciles at the camera, and only for `"top-left"`.** The flip
    is `bottom > top` inside `setOrthographic` — one sign, nowhere else in the engine.
    `"bottom-left"` and `"centered"` stay Y-up on purpose: they are chosen _because_ the
    caller wants the world convention. Consequence to remember: a negative-determinant
    projection mirrors winding — free while the WebGL backend keeps `CULL_FACE` disabled,
    and a note the packet that enables culling must read.
  - **A screen camera's default near must be negative.** `-1000`/`1000`, so a camera
    nobody moved sees the `z = 0` plane its content is authored on. `near = 0.1` is right
    for a frustum and wrong for a slab; `R-8` lost time to the same trap in three
    harnesses.
  - **Refuse a _measured_ number, tolerate an _authored_ one.** The other cameras
    deliberately do not validate (a degenerate authored box yields non-finite elements
    and says so). A screen camera's rectangle arrives from a `ResizeObserver`, so it
    throws `FourError("INVALID_APPLICATION_STATE")` — from the constructor,
    `setSurfaceSize`, _and_ `updateProjectionMatrix`, because §47's plain-field idiom
    means a direct write is only catchable at the projection. This asymmetry is the rule,
    not an inconsistency.
  - **Structural opt-in beats `instanceof` at a package boundary.** `Application.resize`
    feeds any camera with a `setSurfaceSize` method (`SurfaceSizedCamera`), never
    `camera instanceof ScreenCamera`. Two payoffs: §47's _custom projection camera_ opts
    in without `four` knowing it exists, and `Application` — which is in every bundle —
    names no class, so the feature costs **0 B** where it is unused. Reach for this
    whenever an always-loaded module would otherwise name an optional one.
  - **A rig's shape follows its input, not its family.** `OrbitRig`/`FollowRig` are
    per-step components because their targets move; `TrackballRig` is event-driven and
    writes on demand, so it is a plain class the application calls under §42's
    `"manual"` authority. Forcing it into a component would have required
    `@fourjs/motion`'s `ConstraintSystem` — which names its three classes literally — to
    import `@fourjs/scene`'s rig, i.e. exactly the §3.1 edge the R-36 staging note existed
    to avoid. §42 still applies to application writes: `applyTo` calls
    `warnAuthorityConflict` and refuses a node owned elsewhere.
  - **The trackball crossover is at `d = 1/√2`, not at the silhouette.** Sphere
    `sqrt(1 - d²)` to the 45° parallel, then Bell's sheet `1/(2d)`; both give `1/√2`
    there with matching slope. Switching at `d = 1` leaves a half-radius jump — the
    continuity test caught exactly that bug in the first cut. Worth remembering as _the_
    classic trackball mis-implementation.
  - **Gotcha (testing): `helpers/recording-gl.ts` retains uniform arrays by reference.**
    A transcript read _after_ a later frame reports that later frame's uniform values, so
    two transcripts are comparable only when both frames wrote the same values last. An
    A/B with _different view counts_ cannot be asserted on uniforms — assert on bindings
    (`bindVertexArray`), which the double records by value.
  - **`Vector3.applyQuaternion` still does not exist**, deliberately: `trackball.ts`
    writes out the one special case it needs (rotating `(0, 0, z)`) rather than adding a
    math primitive whose naming and `out` conventions (§7b) belong to a `@fourjs/math`
    packet.
  - Bundle cost measured: **0 B** in every bundle that does not call
    `registerSceneNodeTypes`; ≤ ~0.5 kB gzip in `motor-digital-twin`, the only example
    that does. No budget bumps.

- **2026-08-21 — R-21 §53 geometry model + R-34 §27 field batching.** Decisions worth
  keeping:
  - **A base class earns its place through identity, not through shape.** §53's
    `Geometry` ships with exactly one concrete member and the other seven names still
    absent; what justifies it today is that §33 forbids random ids, so the monotonic
    counter must be shared, and `clone()` — the one operation that must _not_ copy an
    id — needs one place to draw from. "The diagram has seven boxes" is not a reason to
    write seven classes; each of them pins an attribute layout the WebGL backend and §79
    both must agree with.
  - **Widen a bounds type by aliasing, never by replacing.** `GeometryBounds` became a
    type alias of `BoundingVolume` (box + circumscribing sphere), so four packages that
    read `.min`/`.max` needed no edit and produce byte-identical values. **R-8 keeps
    deriving its _world_ sphere from the box on purpose** — transforming a local sphere
    under non-uniform scale is a looser bound than transforming the box.
  - **The empty bound's centre and radius must be written, not computed.** Left to IEEE
    the two disagree: `(+∞ + −∞)/2` is `NaN` but `|−∞ − +∞|/2` is `+∞`, and an infinite
    radius reads to a culler as "everywhere" — the one error direction that is never
    conservative. Both are pinned to `NaN`; consumers gate on
    `Number.isFinite(radius)`, the same gate `computeWorldBoundingSphere` already
    applied.
  - **§53's `computeBounds(): void` is a spelling, not a constraint.** Narrowing the
    existing return value to match the letter of the spec would have broken `render`,
    `input` and `render-webgl` to gain nothing; the `bounds` _property_ §53 also
    declares ships as a getter returning the identical object. Both spellings live.
  - **A clone must be deep wherever the class documents an in-place fast path.**
    `BufferGeometry` holds attributes by reference and documents
    edit-then-`markDirty()`; a shallow clone would give two geometries one buffer and
    two version counters, so a write through either handle changes what the other draws
    while leaving the other's backend cache valid. Cloning a disposed geometry throws
    rather than silently producing a valid empty mesh (§83).
  - **Geometries serialize as catalog key references, not by value** — so `clone()` and
    a new bounds type needed no §79 pairing at all. Checked, not assumed.
  - **The cost of a `ForceField` was never its arithmetic.** ~5.15 ms per field per 100k
    was one megamorphic `sample()`, two `Vector3.set`s and three property reads per
    particle per field. Batching those away (`sampleAll`) cut the per-field marginal
    cost ~5× with the same math — re-recorded on the canonical host: 16.58 → 4.51 ms
    for the 3-field 100k stack, per-field 5.15 → 1.12 ms.
  - **A batched fast path must be bit-identical or it is a different engine.** Three
    things that would each have broken it silently: accumulating in `Float32Array`
    (rounds after every field), starting the accumulator at zero instead of at gravity
    (changes `(g+s₁)+s₂` into `g+(s₁+s₂)`), and `continue`-ing on a degenerate input
    instead of `+= 0` (a positive zero added to a negative-zero accumulator is not
    "nothing"). The batched accumulator also has to **mirror `pool.kill`'s
    swap-remove**, or a swap-removed slot draws the dead particle's acceleration.
  - **An optional fast path must not be all-or-nothing.** Fields without `sampleAll` are
    sampled per particle **in their own place in the declaration order** into the same
    accumulator, so one custom field neither reorders the sum nor disables batching for
    its neighbours. Note for Changesets: `sampleAll` on `ParticleForceField` is a public
    extension seam — a third-party field with a different-shaped `sampleAll` property
    now fails to typecheck; name it a minor, not a patch.
  - **`pnpm run docs` earned its keep again.** It caught `speed:` where `initialSpeed:`
    was meant in a new emitter test; vitest ran it green because both sides of the
    comparison ignored the same unknown property.
  - **Bundle A/B by revert-and-rebuild, not by estimate.** All six budgets moved by 0.
    Two are under 1 kB of headroom after this wave's `@fourjs/scene` growth (first-3d
    33.07/34, ui-demo 38.98/39.5) — the next bundle-touching packet in _any_ lane must
    A/B before writing code.

- **2026-08-21 — R-7 §67 stencil substrate.** Decisions worth keeping:
  - **A state record is not an API — and saying which one you shipped is the packet.** §67
    lists six clipping mechanisms; §57 lists one optional material member. R-7 shipped the
    member completely rather than the mechanisms partly. A `clip()` is a _scene-graph_
    design (subtree inheritance, nesting, bit-plane assignment, the backend-limit
    diagnostic §67 requires) and belongs to a packet that may edit `@fourjs/scene`.
    `readMask` is already the bit-plane selector it will need.
  - **A nominal class beats a validating accessor, and the reason is bytes.** The first
    cut normalized `stencil: { func: "equal" }` literals into a validated `StencilState`
    through a `Material` accessor. It cost **0.62 kB gzip in every bundle carrying a
    material**, masked or not, because `material.ts` then imported the class at runtime.
    Making `StencilState` nominal (private fields ⇒ a literal is not assignable) moves the
    same guarantee into the type system and lets the import be **type-only**. New reusable
    technique: _when a field's validation can be carried by the value's own type, the
    holder needs no accessor — and the class tree-shakes away for everyone who never uses
    it._ This is R-23's "add nothing to the frame path" applied to bytes.
  - **Refusing at the 8-bit boundary is a §85 refusal, not pedantry.** WebGL 2 has exactly
    two stencil formats and both are 8 bits; GL _silently_ masks a larger reference down.
    `ref: 256` becoming `0` does not draw wrong pixels loudly — it draws a mask that never
    matches. That refusal is also what makes mirroring the all-ones mask as `0xff` (rather
    than GL's literal `0xFFFFFFFF`) exact rather than a narrowing.
  - **`clear` is masked by the stencil _write_ mask, test enabled or not.** A frame ending
    with a read-only mask material clears nothing the next time round, and the mask leaks
    across frames (§33). The write mask must be reopened before **every view clear**, not
    only at frame exit — F13/F15's envelope rule, third extension.
  - **Turning a test off does not need the rest put back.** With `STENCIL_TEST` disabled
    GL performs no stencil write either, so returning to "no stencil" is one `disable`
    and the func/op mirrors are deliberately left dirty. Cheapest correct restore.
  - **Sixth confirmation of mirror-at-GL-initial**, and the first where the mirrored
    initial values were factored into one `INITIAL_STENCIL` object — those values _are_
    the byte-identity claim, and a claim stated twice is a claim that can drift.
  - **The packed depth-stencil makes an exclusion structural rather than a policy.**
    `DEPTH24_STENCIL8` is a renderbuffer and R-18's samplable depth is a
    `DEPTH_COMPONENT24` texture; a framebuffer has one depth attachment, so
    `{ stencil, depthTexture }` is refused in `@fourjs/render` and `gl-render-target.ts`
    never has to choose. Corollary: **a target cannot be both a shadow map and a masked
    surface.**
  - **A defensive branch that no caller can reach is a coverage hole, not a safety net.**
    `stencil: target.stencil && depthBuffer !== null` was unreachable (stencil ⇒ depth ⇒
    a renderbuffer, and a failed allocation returns `null` before the record) and cost a
    branch. Deleted with the argument written where it was.
  - **A fixture page is the third way to get a browser gate.** `batching.spec.ts`'s
    Vite-bundled-and-injected fixture is now the pattern for any gate whose subject is a
    _renderer option_: §67 needed a canvas built with `stencil: true`, and no example
    asks for one. No tenth server, no page nobody would visit.
  - **§79 needed nothing, and that is worth knowing before the next material packet.**
    Materials serialize by catalog _reference_ (A-16), so a new material field adds no
    serializer — and adds no contention with a sibling editing `scene-serializers.ts`.
  - **Measured:** +0.85 kB gzip in every bundle carrying `WebglRenderer` (R-6's 0.75 kB
    law again); three budgets bumped with measurements (`first-3d` 32.5→34, `particles`
    30→31, `ui-demo` 38→39.5, superseding the queued 38.5).
  - **Gotcha (pre-existing, not R-7's):** `packages/render/tests/shape.test.ts`'s
    65 536-vertex widening test times out at the default 5 s under `--coverage` on a
    loaded box; it passes alone and at `--testTimeout=30000`. It is a tessellation-time
    flake, not a regression — do not "fix" it by editing the assertion.

- **2026-08-21 — PH-21 §39 step 9 + PH-20 §33 rollback.** Decisions worth keeping:
  - **A default kept is worth more than a name made right.** GAP v0's plan for PH-21 was to
    split `PhysicsSystem` into `PhysicsStepSystem` + `PhysicsEventDispatchSystem`. The
    rename was declined: it breaks every application, example and golden helper that names
    the class, and the filing's own requirement — "preserving the current two-pass
    semantics as the default registration" — is satisfied by an _option_
    (`dispatchEvents: false`) and not by a rename. Rule: when a closure plan bundles a
    rename with a behaviour, ship the behaviour and re-decide the rename on its own merits.
  - **PH-8's technique, third use, and now at a step that already had an occupant.**
    `ForceFieldSystem` took empty step 5, `ConstraintSystem` took empty step 7; step 9 was
    different because `PhysicsSystem` was _already doing the work_ there, inside step 6's
    priority. The move that kept the goldens still is that the existing loop was not
    touched — it was wrapped in `if (dispatch) { …; return; }`, so the default arm executes
    the identical statements in the identical order and byte-identity is a **code-path**
    argument rather than a numerical one. Generalizes: to relocate work that already runs,
    gate it rather than move it, and let the new location be the empty one.
  - **§39's four unused constants named two different absences, and only one was a gap.**
    Steps 7 and 8 are inside one `adapter.step()` call — a solver's constraint solve and
    its sensor/intersection update are one internal pipeline — so interposing an engine
    system between them would require every adapter to expose a half-stepped world, which
    neither Rapier nor Box2D does. The constants are still legitimate: they hold
    _engine-side_ work at those points (700 is `ConstraintSystem`'s; 800 is application
    sensor bookkeeping). Only step 9 was structurally unavailable. Rule: an empty priority
    is not evidence of a missing feature until you have asked what could occupy it.
  - **An unbounded queue must announce itself.** `dispatchEvents: false` with nothing
    claiming step 9 leaves `PhysicsWorld.#queue` growing forever — `#collectEvents` appends
    and only `dispatchEvents` drains. So the first such fixed step warns once (plain
    `console.warn` behind a flag; a simulation package may not import `devWarn` —
    confirmed again), and `claimEventDispatch()` exists so an application that dispatches
    by hand can silence it. The _inverse_ misconfiguration — a `PhysicsEventSystem` over a
    source that still dispatches — is a §85 **refusal at construction**, because it looks
    wired and is not. Two failure modes, two different treatments, because the fixes
    differ.
  - **A golden can pin an equality rather than a value.**
    `golden/event-dispatch-split.json` carries **one** digest set for **both** arms,
    because the packet's whole claim is that they are equal; recording two sets would have
    made a divergence look like data. The one recorded difference is deliberately a
    _different_ number: a step-7 marker's run count as seen by the first listener of each
    step, −1 at dispatch-600 and 0 at dispatch-900, on all 149 event-bearing steps.
    Reusable shape for any packet whose claim is "this re-ordering changes nothing".
  - **A rollback buffer that re-simulates for you is wrong, and the reason is §39.** The
    only thing `RollbackBuffer` could step is its target — `world.step(dt)` — which would
    skip forces at step 5, constraints at 7 and dispatch at 9, so the re-simulated steps
    would not be the steps that were rolled back. It therefore restores state and returns
    the number of fixed steps owed; the caller re-runs its own registry loop. Same family
    as "a force is not a transform write": the class that owns a piece of state does not
    thereby own the frame.
  - **`rollbackTo` is exact, and "nearest ≤ step" was rejected on purpose.** GAP v0's
    sketch said restore-nearest. A predictor that asked for step 41, silently got step 38,
    and re-simulated the three steps it accounted for would drift with no error anywhere.
    Refusing and naming the window still held ("held steps are 4…5") answers the question
    the caller actually has at that moment. Third instance of refuse-don't-substitute at a
    seam rather than at a value.
  - **A snapshot is adapter state and nothing else, said out loud.** The header states that
    the caller must also rewind its `SeededRandom` stream, its animation clock and its own
    accumulators. A rollback API that implied otherwise would be the most expensive kind of
    lie — one that only shows up as a desync in someone else's netcode.
  - **Measured: +160 B gzip in bundles carrying `@fourjs/physics`** (`motor-digital-twin`
    947 090 → 947 250 B, reproduced exactly on a second build), and **0 B** in the four
    tight budgets — verified structurally rather than by subtraction: `claimEventDispatch`,
    `RollbackBuffer` and `PhysicsSystem`'s error string appear **zero** times in each of
    those built bundles. `PhysicsEventSystem` and `RollbackBuffer` are unreferenced named
    bindings under `"sideEffects": false` and link nothing; the 160 B is the branch and the
    warning string alone.
  - Gotcha, fifth confirmation: **`pnpm run docs` is the type gate, vitest is not.**
    Dropping `PhysicsEventSystem.fixedUpdate`'s unused `context` parameter (an ESLint fix)
    left two `events.fixedUpdate(ctx)` calls in a suite of 13 **passing** tests. TypeDoc
    found both; vitest found neither.
  - Gotcha (same-tree A/B, new instance): reverting `physics-system.ts` to HEAD is not
    enough to build arm A — the _new_ file that references its new members must be moved
    aside too, or `tsc -b` fails and the example silently rebuilds against **stale
    `dist/`**, i.e. against arm B. The symptom is a suspiciously round zero-delta. Joins
    the sibling-rebuild incident class from 2026-08-09.

- **2026-08-13 — R-30 §77 sampler state + R-28 §49/§56 `Text`.** Decisions worth keeping:
  - **A blocker that names another row's residue must be re-checked against source —
    second confirmation.** GAP v0 gave R-28 `Depends on: R-30 (frame regions)`; frame
    regions are §55's and shipped as **R-29** on 2026-08-08, so R-28's last blocker had
    fallen five days before the row still said otherwise. R-30 was shipped anyway, at the
    one tier text actually wants (filter), and the row is now honest about which bullet
    closed.
  - **The dependency matrix decides where a §49 family member lives, and it is not
    negotiable.** `render` may not import `text`; `text` may not import `render`. The
    umbrella is the only package that sees both, so `Text` lives in `four` beside the §45
    composition root and the §79 serializers. §49's family was _already_ split this way
    (`ParticleSystem` in `@fourjs/particles`, recognised structurally because it cannot
    even extend `Renderable`) — `Text` does better, because `four` is _above_ `render`
    rather than beside it, so it really extends `Renderable` and no consumer has a
    special case. Rule: when the matrix and a spec's class diagram disagree, the class
    moves up, never the edge sideways.
  - **One geometry beats N sprites, and the argument is expressiveness before speed.**
    §55 derives uv affinely from position (`uv = (p.xy − quad.xy)/quad.zw`), which is
    exact for one rectangle sampling one sub-rectangle and **cannot** map twelve glyphs
    onto twelve atlas cells in one buffer. §53's `uvs` (R-19) and §57's `map` can. So a
    label is one unlit textured draw — one draw call _unconditionally_, where N sprites
    is one only if the application opted into `createGlBatching()`. Third application of
    R-23's "close a gap by adding nothing to the frame path": no `RenderItemKind` arm, no
    pipeline, no shader edit, `render-webgl` untouched by R-28.
  - **§65's glyph batching was a `Text` packet, and it closed by construction.**
    Consecutive `Text` nodes over one material are a run of same-material unlit items,
    which `RenderBatcher` already merges. Nothing was added to `batch.ts`. What is left
    of §65 is instancing and atlas grouping.
  - **Sampler state is upload-time state, which is why R-30 is nearly free.** Four
    `texParameteri` arguments became variables; no draw path reads them, so no frame does
    one thing more. Byte-identity is _structural_: both fields resolve to the value the
    backend hard-coded, so a pre-R-30 texture issues the same four calls with the same
    enums in the same order. Corollary worth remembering: **changing `filter`/`wrap` on a
    resident texture needs `markDirty()`**, the same announcement an in-place texel edit
    needs.
  - **Two filter values, one field, and the reason generalises.** §77's other four filter
    modes name a choice _between mip levels_; a one-level texture has none to choose
    between, so naming them would accept a value the backend must reinterpret. Same rule
    as `minFilter`/`magFilter`: they are a pair _because_ minification is the direction
    with mips in it. A union widens when the feature that gives its members meaning
    arrives.
  - **`castShadow` defaults `false` on `Text` alone, and the asymmetry is data because it
    has to be.** A depth-only pass writes geometry, not alpha, so a label would cast its
    rectangles — a black bar under every word. `Sprite` is excluded _structurally_ (the
    list builder sees `kind === "sprite"`); `Text` draws through the same pipeline as an
    opaque wall, so nothing structural distinguishes it. It becomes the right default the
    day §69's transparent masks land.
  - **A refusal is better than a substituted font.** A `Label` restored without an atlas
    measures 0×0, which is what it _is_; a `Text` has no such state, so a document naming
    one with no `atlas` option **throws**. Inventing a built-in face would reload
    someone's scene in a font they never chose and never asked about.
  - **`"left"` is a code path, not an offset of zero.** `layoutText`'s alignment shift
    loop does not run for the default, so no `x + 0` is evaluated and no `-0` becomes
    `+0`; an unaligned layout is bit-identical to the pre-R-28 one rather than merely
    equal. Same technique as the permissive default mask and the `bool` uniform at GL's
    initial `false`.
  - **`layoutText` is cross-platform tier, and the proof is a closed list of
    operations**: `+ − × ÷` and `Math.max` over doubles, no `sqrt`, no transcendental, no
    `Math.fround`, no iteration over hash order (the atlas is `Map.get`, never walked).
    An edit adding a rotation, an italic shear, or a round-to-whole-texels breaks the
    _stated tier_.
  - **Measured: +0.11 kB gzip in every bundle carrying `Texture`** (R-30's two validation
    calls and two enum tables), +0.26 kB more in bundles carrying `@fourjs/text`
    (alignment), and **+1.6 kB on `motor-digital-twin` alone** — the only example that
    calls `registerSceneNodeTypes`, confirming R-23's finding that the §79 pairs cost 0 B
    in bundles that do not. ui-demo is at **37.86 / 38 kB**: 0.14 kB of headroom, and a
    bump to 38.5 is proposed with the measurement.
  - **§86's animated-glyph row: closing the draw-call gap moved the bottleneck.** 20 000
    glyphs are one `drawElements` (800 unbatched) against 20 000 before; but the geometry
    rebuild costs ~14 ms against ~2 ms for the layout alone, i.e. ~700 ns/glyph of
    typed-array allocation and scanning. Exactly R-9's finding for sprites, one tier up.
    Text that only _moves_ pays none of it — only content changes re-enter the rebuild.
  - **A golden earns its place where thresholds structurally cannot reach.**
    `tests/browser/text.spec.ts` counts ink and checks a two-line structure; a v-flip, an
    off-by-one atlas cell, or a reversed string keeps ink count, row structure _and_ draw
    count intact. `tests/visual/text.spec.ts` is the one text assertion that is a pixel
    match. Its fixture is shared with the chromium gate deliberately — a golden of a
    different page would guard a different thing.
  - Gotcha (browser fixtures): a WebGL drawing buffer is **cleared on present** unless
    `preserveDrawingBuffer`, so a canvas drawn once and then screenshotted photographs
    black. A visual golden of a one-shot render needs a rAF loop redrawing the same
    static frame; the readback probe beside it works because it reads inside the same
    task.
  - Gotcha (index widths): `vertexCount - 1 > 65 535` is the correct `Uint16Array` test,
    not `vertexCount > 65 535` — 16 384 glyphs are exactly 65 536 vertices whose highest
    index is still addressable. Cost one test iteration.
  - Multi-agent: the A/B was done by reverting only files this packet exclusively owns
    plus **one** exact-string toggle in the shared `scene-serializers.ts`, restored by
    the _inverse_ string replacement applied to the file's then-current content — never a
    wholesale copy-back. md5 verified identical before and after; arm A rebuilt to
    hash-identical bundle names.
- **2026-08-09 — R-36 rig half + PH-11: §44/§47 camera rigs and §42's first
  `"constraint"` producer.** Decisions worth keeping:
  - **A rig _places_; a constraint _aims_; and the split is forced by §42, not
    chosen.** §42 allows a node **exactly one** transform authority, so a rig that both
    placed and aimed would either duplicate `lookAt`'s world→local derivation or claim
    an authority the aiming system also needs. Under one system and one authority the
    two compose in the only correct order — placement first, then the aim, which
    therefore reads the pose written _this_ step. §44's own closing sentence ("camera
    motion should use the same timeline, constraint, and motion systems as ordinary
    nodes") is the licence for making rigs components rather than camera classes.
    Generalizes: when two writers want one node, the question is not how to arbitrate
    them but which single system owns both.
  - **§44's _path animation_ and _physics attachment_ close with no class at all, and
    path animation needs two nodes.** A path-driven camera is a parent under
    `"kinematic"` (`KinematicController.followPath`) carrying a constraint-aimed child
    under `"constraint"`; one node can never be both, because §42 says so. Measured, not
    argued — 120 steps round a `CircularTrajectory` with the subject at NDC (0,0) every
    step and zero warnings. Physics attachment is free because a rig _reads_ its target
    and writes only its own node, and `PRIORITY_CONSTRAINTS` (700) is after
    `PRIORITY_PHYSICS_SOLVE` (600). Sixth application of
    absent-beats-accepted-and-ignored, and the first where the absence is discharged by
    _composition_ rather than by deferral.
  - **`Node.lookAt` predicted its own caller, and the guard is the refusal test
    hoisted.** `lookAt` throws on a degenerate aim and its doc says a rig "must guard
    the call". `LookAtConstraint` makes exactly `lookAt`'s two tests _before_ calling
    it, so the call that follows **cannot** throw — and a failed guard leaves the
    rotation untouched and increments a public `skippedSteps`. §85's
    refuse-don't-substitute rule governs **authoring** (the constructors refuse a zero
    `up`, a non-positive distance, inconsistent limits); a value that only goes bad
    mid-step is a transient the simulation must survive. The counter exists because a
    camera that has silently stopped aiming is otherwise indistinguishable from one
    whose target stopped moving, and a `console.warn` per step is the 60-lines-a-second
    noise §42's own dedup was built to avoid.
  - **The orbit rig's default pitch limit is a §85 argument, not a taste.**
    `DEFAULT_ORBIT_PITCH_LIMIT = π/2 − 1e-3` exists because the pole is _exactly_ the
    aim `lookAt` refuses with the default +Y `up`. A rig that could reach it would hand
    its constraint an impossible aim at the moment a user drags one pixel too far.
    1e-3 rad keeps the horizontal component at ~1e-3 · distance — thirteen orders above
    the double noise floor — and is invisible. The escape (±π/2 plus a non-vertical
    `up`) is explicit rather than accidental.
  - **Rigs never read `@fourjs/input`, and the reason is the frozen matrix.** §3.1 gives
    `motion` only `core/math/scene`; an `input` edge would drag a device layer into
    `physics` and `animation` too. So the surface is parameter-driven
    (`orbit(dYaw, dPitch)`, `dolly(delta)`) — which is also the only reason the
    determinism golden exists, since a rig's inputs are then _data_ a `SeededRandom` can
    supply and a replay can reproduce (§33/§34). **Trackball is staged for the same
    edge, from the other side:** it is defined over a viewport in screen space, so its
    honest home is the `ScreenCamera` packet, not the motion tier.
  - **`maxAngularSpeed`, not a new word.** The slew limit reuses `MotionComponent`'s
    exact spelling and its absent-means-unlimited convention, rather than inventing a
    `RotateOptions`-style `duration`: a rate limit and a duration are different
    quantities, and the package already had a name for the rate. Applied as a
    shortest-arc rate limit on the _angle_ — never overshoots, arrives in
    `angle / rate` seconds exactly.
  - **A slew step writes the rotation twice, deliberately.** The goal is obtained by
    letting `Node.lookAt` write it and blending back from the captured previous
    rotation. The alternative is a second copy of `lookAt`'s world→local rotation
    division living in `@fourjs/motion`, and a duplicated coordinate-space conversion is a
    far worse thing to own than an extra `Transform.version` increment — `markDirty`
    sets no flags and walks no children, so the cost really is the increment. Rule:
    prefer an extra version bump to a second implementation of a frame conversion.
  - **No `@fourjs/math` method was added, and that was the bundle decision.** The slew
    angle is four multiplies plus `Math.min`/`acos` inline over the existing `slerp`;
    the parent-inverse point transform and the target-frame basis are read straight off
    `Matrix4.elements`. R-36's gotcha stands and now has a second data point: a method
    on `Vector3`/`Quaternion`/`Node` is paid by **every** bundle, a class in
    `@fourjs/motion` by only the bundles that name it. Measured: **0 B** in five of six
    budgets, +2.8 kB in `motor-digital-twin` (the `registerSceneNodeTypes()` bundle).
  - **`Math.sqrt`, never `Math.hypot`, on a path whose result multiplies into a
    transform** — ECMA-262 specifies `sqrt` as exactly rounded and leaves `hypot`'s
    accuracy implementation-defined. Small, but it is the difference between a
    same-runtime claim that is true for a stated reason and one that is true by luck.
  - **A node reference is not serializable, and the precedent already existed.** §79's
    component serializers are handed `(data, node)` — the node being restored, with no
    pass in which a sibling id could be resolved — so a rig's `Node` target is dropped
    and only a `Vector3` target is written. That is `KINEMATIC_CONTROLLER_SERIALIZER`'s
    `followPath`-holds-a-`Trajectory`-by-reference rule applied to a second kind of live
    reference. **A spring round-trips in its coefficient form**
    (`stiffness`/`damping`), not as `frequencyHz`/`dampingRatio`: the coefficients are
    what `SpringDamper` stores, so they reconstruct bit-for-bit, where the frequency
    form goes out through a `sqrt` and a division by 2π and comes back a few ulps away.
  - **`OrbitRig`'s limits are `readonly`** (`SpringDamper`'s rule): a retuned limit is a
    new rig, because a limit changed underneath a value already inside it needs a policy
    for that value. The angles clamp **on assignment**, so a rig can never hold a value
    outside its own limits and a caller reads back the clamp immediately rather than
    discovering it a step later. Corollary for §79: the readonly limits must be written
    to the document, because the reader has to _construct_ with them.
  - **A branch that cannot be reached on demand should be a branchless clamp.** The
    `acos` domain guard started as `if (cosHalf > 1)` — unreachable except by a rounding
    accident, and therefore permanently uncovered. `Math.min(1, …)` is the same
    arithmetic with no branch to cover. Reusable: prefer `min`/`max` to an `if` when the
    `if` exists only for a rounding overshoot.
  - **Gotcha (multi-agent, new instance class): `dist/` can be built from a _sibling's_
    momentarily swapped-out source.** A suite that had passed twice began failing with
    "component has no registered serializer" while the source on disk was correct — a
    concurrent agent was running its own HEAD-swap A/B and rebuilt in between.
    Diagnosis is `grep` the symbol in `packages/*/dist/*.js` and compare mtimes; the fix
    is a rebuild, never a source edit. Joins the stash/revert/ports incident classes.
  - **Gotcha (multi-agent): never `git show HEAD:<file> > <file>` on a file a sibling is
    also editing.** Doing it to `packages/fourjs/src/scene-serializers.ts` for a size A/B
    silently discarded the sibling's in-flight work (caught immediately by the build,
    restored from a scratchpad copy taken beforehand). The safe form of a same-tree A/B
    is a **surgical** removal of only your own lines; back the file up first, and
    md5-verify the restore.
  - **Gotcha, fourth confirmation: `pnpm run docs` is the type gate, vitest is not.**
    Two of this packet's own errors were invisible to 448 passing tests —
    `new Group({ name })` (`NodeOptions` carries only `id`) and a `{@link Node}` to a
    symbol `@fourjs/motion` does not re-export. Both are TypeDoc-only failures.
  - **Container-restore note (2026-08-09, second occurrence class):** this packet was
    fully built and verified once, destroyed uncommitted by a container restore, and
    rebuilt from its own report. The rebuild's regenerated numbers (coverage branch
    99.44 vs 99.47, `pitchLimitHits` 16 vs 36 under different scenario constants,
    +2.8 vs +2.9 kB) agreed with the original within noise — evidence that a
    report-with-arguments is a sufficient rebuild spec. Push-per-batch remains the only
    real protection.
- **2026-08-09 — R-8 §64 per-view lists + §87 culling (+ R-10 key 4).** Decisions worth
  keeping:
  - **The frame's list is the model; a view's list is a query over it.** The rejected
    alternative (`buildRenderList` per view) loses on three independent grounds, and only
    the third is about speed: (1) **traversal has side effects** — it calls
    `updateParticleInstances()` and rebuilds a `Sprite`'s quad — so rebuilding per view
    would make _the work a frame does_ depend on how many viewports were configured;
    (2) **§69's shadow map is frame state**, and a base list no view has touched is what
    makes R-18's pass expressible at all; (3) measured, `benchmarks/view-culling.mjs`:
    the two arms are within noise at one view and the rebuild costs 1.34–1.39× at two,
    1.90–2.65× at four. Generalizes: when a stage has side effects, "do it once and query
    the result" is a correctness argument before it is a performance one.
  - **A derived list is a subsequence, and that is the whole byte-identity argument.**
    Items removed, never reordered, sharing the _same pooled objects_ — so a view that
    filters nothing is the frame list item for item, and replacing the backend's inline
    `item.layers & mask` test changed no GL call. `FRAME_BEFORE_R8` (54 calls, every
    pipeline) recorded on the reverted build.
  - **Culling is default-on and that is the honest reading of §64.** §64 lists culling as
    a _stage_, not an option, and §49's `frustumCulled: true` default is meaningless
    unless culling runs. A cull that removes nothing is byte-identical by construction;
    one that removes something invisible changes no pixel — proved exactly rather than
    within a tolerance: **0 of 76 800 pixels differ** on ANGLE/SwiftShader.
    `batching.spec.ts` needs a tolerance because a batch re-evaluates a product; a cull
    touches nothing it keeps.
  - **A bound that is too small is a bug; a bound that is too loose is a draw.** The
    cheap radius (local circumradius × longest matrix column) is **wrong**: the largest
    singular value can exceed every column norm, so it can under-estimate. The shipped
    radius is the circumradius of the world AABB obtained by the absolute-value transform
    `|M|·e` — one `sqrt`, conservative by construction, pinned by a 64-angle rotation
    sweep and an all-eight-corners containment test.
  - **A sphere, not a box, and the reason is per-item cost.** A sphere is
    rotation-invariant, so the derivation is a point transform plus a scalar with nothing
    to cache and nothing to invalidate. §87's structures (BVH, quadtree, grid) are an
    index; this tier is the _test at the bottom of all of them_, and §87's "the public
    scene graph must not be forced to mirror a spatial tree" is what makes a linear scan
    an honest first tier.
  - **Every degenerate input fails towards drawing.** §61 forbids throwing in a frame, so
    §85's refusals cannot apply: a zero-length plane normal is written as `(0,0,0,+∞)` (a
    degenerate frustum culls _nothing_, never _everything_), a `NaN` centre or radius
    makes `intersectsSphere` answer `true` by ordinary IEEE comparison, and
    `computeWorldBoundingSphere` returns `false` for an empty geometry, a non-finite
    matrix, or a geometry with no `computeBounds`. Written down because the opposite sign
    on any one of them empties a viewport silently.
  - **The particle exemption is data, not a `kind` check.** `buildRenderList` writes
    `frustumCulled = false` on every particle item, because the item's `geometry` is the
    shared unit quad the particles are _instanced_ from — its bounds are a square at the
    emitter. The culler therefore has no §36 special case.
  - **§66's key 4 is a verb for key 3's reason, and could not have been written
    earlier.** "Needs a camera" was the weak reason; the real one was that one list
    served every view, so a depth measured along one camera would have misordered the
    rest — _wrong_, not disruptive. R-8 supplied the per-view list and the key shipped
    the same day. It stays opt-in because under `LEQUAL` a depth sort permutes co-planar
    opaque draws. Key 3 and key 4 are **alternatives** at this tier: §66 orders them
    pipeline-then-depth, which gives depth ordering only within a material group and so
    destroys the one thing depth sorting is for.
  - **`R-37`'s `layerMask` was never `R-8`'s to ship** — `Viewport.layerMask` landed with
    `R-38` on 2026-08-08. The gap document's `R-8` row said otherwise and was stale when
    written. Rule: a blocker sentence naming _another row's_ residue has to be re-checked
    against source, not inherited.
  - **Pre-filtering lengthens batch runs, and that is correct.** `RenderBatcher.next`
    stops at a masked-out item deliberately (a later view might draw it). Handed a list
    already reduced to what _this_ view draws, it merges across the gap — the skipped
    item is not submitted here at all. One recorded behaviour change; `next`'s mask
    parameter stays for unfiltered callers, and `GlBatching` forwards `undefined` rather
    than branching (a JS default parameter applies to an explicit `undefined` — worth
    remembering, it removed the only uncovered branch in the file).
  - **Finding: an options object whose fields the class does not have is silently
    ignored, and `tests/` is outside every `tsc` project.**
    `new OrthographicCamera({ height: 4, aspect: 1 })` in three integration harnesses
    left the default unit box `[-1, 1]²`, so those suites had been asserting draw counts
    for frames that produced **no pixels**; `render-batching.test.ts` hit the recorded
    near-plane gotcha instead (camera at the origin, content at `z = 0`). Culling found
    all three by removing the draws. Excess-property checking would have caught it — the
    same hole `pnpm run docs` closes for package sources but not for `tests/`.
  - **Gotcha, third confirmation:** a new required field on `RenderItemBase` breaks
    hand-built item literals only under TypeDoc/tsc, never under Vitest. Two fields this
    time (`frustumCulled`, `viewDepth`), one literal.
  - **Gotcha, second confirmation of R-9's:** `TestGeometry` has no `computeBounds`, and
    it was left that way on purpose — that keeps all 400+ existing backend tests on the
    "cannot be bounded ⇒ drawn" path and makes the byte-identity argument structural. A
    `BoundedTestGeometry` subclass opts the new suite in.
  - **Measured: +0.77 kB gzip in every bundle** (first-3d 31.30 → 32.08, particles
    28.70 → 29.45, ui-demo 36.73 → 37.50, first-2d 43.05 → 43.82, twin +0.79 kB), a
    same-tree A/B. Comparable to R-6's 0.75 kB pipeline law and unavoidable while §64
    stage 3 is a stage: the renderer references the culler unconditionally.
    `sortRenderListByDepth` **does** tree-shake (`viewDepth` appears exactly three times
    in the first-3d bundle — the three writes, none of the comparator's six reads).
    Budgets bumped: first-3d 31.5 → 32.5, particles 29 → 30, ui-demo 37 → 38 kB.
  - **The cull is not free, and the benchmark says so out loud:** 0.17–0.40 µs per item
    per view. It buys back a draw call and its uniform uploads, which is backend work a
    headless script cannot measure — so `benchmarks/view-culling.mjs` states the CPU
    price and declines to claim a net win.
- **2026-08-09 — PH-8 §26/§27 force fields for bodies + PH-12 §8 space modes.** Decisions
  worth keeping:
  - **The gap was the seam, not the halves.** §26's six methods shipped in Phase 5 and
    §27's built-in field set shipped in WP-9.2; a field could push a _particle_ and not a
    _body_. Generalizes: a row that reads "§X is silent" may mean "§X's two ends exist
    and nothing joins them" — re-read the section before sizing the packet.
  - **§39's own step list is the design.** Force generation is step 5 and the solve is
    step 6, so the occupant is a **separate `SimulationSystem` at `PRIORITY_FORCES`**,
    not a pass inside `PhysicsWorld.step`. Three things fall out free: `world.step` is
    not edited, so every determinism golden is untouched _by construction_; §27's `time`
    is `context.time.simulationTime`, so no world-side clock or accumulated time had to
    be invented (§33); and a second generator orders against the first by number.
    **Reusable technique** — the physics-tier form of R-23's "close a gap by adding
    nothing to the frame path".
  - **A field's units must be stated, and the argument is the reuse path.** §27's
    built-in list mixes accelerations (uniform/radial gravity) with forces (wind, drag
    volume), and `@fourjs/particles` documents _every_ field as an acceleration because MVP
    particles carry no mass. So `addField(field, units)` takes
    `"force" | "acceleration"` as a **required** argument: a default would make the one
    predictable unit error unwritable to notice on exactly the path the packet
    advertises. §41's SI envelope applied to a seam rather than to a number.
  - **`ParticleForceField` and `ForceField` reconcile structurally, as `types.ts`
    predicted in 2026-08-02.** No adapter, no cast, no §3.1 edge; the check lives in
    `tests/integration/physics-force-fields.test.ts` because that is the only file
    allowed to import both packages — the same arrangement `phase9-particles` uses for
    `ParticleSystem`/`SimulationSystem`. §27's "volume-based inclusion and filtering"
    then needed **nothing**: inclusion is a property of a field, and `volumeField`
    already composes onto any conforming one, in both directions.
  - **A "which bodies can a force move" filter belongs in the world, not in each
    generator.** `PhysicsWorld.forEachActiveBody` is dynamic (§22: a force on a static
    body is discarded work) **and awake** (§32: a non-zero force wakes a body, so a
    persistent field visiting sleepers would wake everything every step and §32 would
    stop meaning anything). Waking is `RigidBody.wake()`, an explicit command. Secondary
    benefit, and the reason it exists as a method at all: it hands over
    `(body, node, centreOfMass)` with **no optional types**, so the generator has no
    unreachable `undefined` branch — the pattern to reuse when a public getter's "cannot
    happen" arm would otherwise cost 100% branch coverage.
  - **Sample at the centre of mass, not the transform origin** — §26 splits `applyForce`
    from `applyForceAtPoint`, and a generator that sampled the origin would describe a
    different place from the one it pushes (a compound body's origin can sit outside its
    shape).
  - **§42: a force is not a transform write**, so `ForceFieldSystem` performs no
    authority check. Consistent with R-36's finding from the other side: enforcement is
    writer-side, and §26 is the sanctioned channel for influencing a solver-owned body.
  - **Gotcha, now confirmed for a _simulation_ package: `@fourjs/physics` may not import
    `DEV`/`devWarn`/`devWarnOnce` at all.** `tests/integration/dev-build-mode.test.ts`
    fails twice over (unlisted file, and "GATED names no simulation package"). The idiom
    is `RigidBody`'s: plain `console.warn` with a lazily-allocated once-per-subject
    `Set`.
  - **PH-12: §8's honest home for the _mode_ is `@fourjs/core`, and for the _declaration_
    is `RigidBody.space`.** The vocabulary is hoisted for the `DEFAULT_GRAVITY_Y` reason
    (§8's two halves serve pillars that cannot import each other). Two refusals with two
    messages — the presentation frames because §8 forbids them, `"local-plane"` because
    §21's plane→XY mapping is unbuilt — because the fixes differ (an authoring mistake
    vs. an unbuilt feature). `isSimulationSpaceMode` answers **§8's** question and not
    the world's; they differ exactly at `"local-plane"`, and a test pins the difference
    so nobody "fixes" the predicate to match the implementation.
  - **Blocker worth remembering: a new component class cannot land in one package
    alone.** A `static typeName` is §79's key, `serializeScene` **throws** on a component
    with no registered serializer, and `packages/fourjs/tests/scene-serializers.test.ts`
    enumerates every exported class carrying one. So class + serializer +
    `registerSceneNodeTypes` registration are **one packet**, always — which is why
    PH-12's node-level `NodeSpace` was built, measured against the gate, and withdrawn in
    favour of `RigidBody.space`. New instance of the cross-package-packet class alongside
    A-6's world-front-door and R-38's registry.
  - **A refused value must still round-trip (§79).** `RigidBody.space` is written only
    when non-default and read as a _defaulted_ field, because dropping it would turn a
    body every world refuses into one every world accepts after a save-and-reload — the
    same class of lie `derivedMass` was split out of `mass` to prevent.
  - **Measured:** physics coverage stays 100×4 with `force-field.ts` and the new
    `world.ts` method at 100%; core rises to 99.49/99.15. Bundle impact **0 B** on all
    four tight budgets — none carries `@fourjs/physics`, and the three new `@fourjs/core`
    exports are unreferenced named bindings under `"sideEffects": false`.
  - Gotcha, repeat (third time recorded): **vitest does not typecheck.** Two test-only
    errors (`ComponentSerializerShape.deserialize` takes `(data, node)`) surfaced only
    under `typedoc`.
- **2026-08-09 — R-10 keys 3–4 + R-9 §65 batching.** Decisions worth keeping:
  - **§66's key 3 cannot be a default, and the argument is correctness rather than
    byte-identity.** §61 fixes the depth func at `LEQUAL`, so of two _opaque_ co-planar
    surfaces the later draw wins — which is what makes a §58 stroke cover its fill (R-16)
    and a later sibling cover an earlier one. All 2D content sits at one depth, so
    grouping by material **repaints** a 2D scene rather than merely permuting its GL
    calls. §66 lists key 3 for depth-resolved content and no item property distinguishes
    that from co-planar 2D. Shipped as a **second verb** (`groupRenderListByPipeline`),
    R-6's technique reused: the first verb stays byte-identical by not being edited at
    all.
  - **Key 4 was deferred for the wrong reason until now.** "Needs a camera" is weak; the
    real blocker is R-8 — one list serves every view, so a depth key measured along one
    camera orders the others by the wrong number. A key written before R-8 would be
    _wrong_, not disruptive. Generalizes: a deferral whose stated reason is weaker than
    the real one invites someone to ship it the day the weak reason expires.
  - **Batching consecutive same-material runs is exact, not approximate.** GL rasterises
    a draw call's primitives in submission order and blending/depth respect it, so
    merging N consecutive draws that share all state into one, primitives concatenated in
    order, is the same picture — the `LEQUAL` case included. "Same material **instance**"
    (`===`) is what makes it checkable in one comparison: every §57 state field lives on
    that object, so a run cannot straddle a state change. **Measured on ANGLE/SwiftShader:
    0 of 76 800 pixels differ**, with a rotated sprite row and a §55 atlas.
  - **A batch needs no new pipeline.** Sprites batch through the **unlit** program with
    the tint as `color` and uv per vertex; `tint × texel` and `texel × tint` are
    bit-identical (float multiply is commutative). Second application of R-23's "close a
    gap by adding nothing to the frame path" to a _backend_: no shader was edited, so the
    goldens were never at risk. The uv-per-vertex move is the one `render-list.ts`
    predicted in 2026-08-08.
  - **The one divergence is stated, not hidden**: a batch has one model matrix, so world
    transforms are baked on the CPU. Geometrically identical, not _claimed_
    bit-identical — and the browser gate compares a batched scene against itself rather
    than against an unbatched golden, because the guarantee is about the design and not
    about one rasteriser's luck.
  - **A capability can be opt-in and still tree-shake to zero.** `WebglRenderer.batching`
    is an `import type`-only field assigned by the application (`createGlBatching()`), so
    a bundle that never calls the factory links neither `gl-batch.ts` nor
    `@fourjs/render`'s planner: **0 B**, measured both ways. The seam itself still costs
    **+0.17 kB gzip in every bundle** (field, branch, `materialId`) — an order of
    magnitude cheaper than R-6/R-13/R-18's 0.75–1.9 kB pipeline law, and the price of not
    paying that law again. A-4's build-time pipeline-selection seam remains the fix that
    would make batching the default.
  - **§33: batch assembly is a left-to-right scan with no `Map`, no `Set` and no
    object-key iteration**; the GL side indexes four vertex arrays by a two-bit layout
    number for the same reason. Layouts get one vertex array each rather than one
    re-specified array — attribute pointers are VAO state, and an array that is
    re-specified is an array someone must remember to disable attributes on.
  - **§86's two batching rows are now bounded by CPU preparation, not by draw calls.**
    100 000 sprites → 7 draw calls (14 286×) but 78 ms of preparation, of which ~34 ms is
    `buildRenderList` — which the unbatched frame pays too. Both stay `half` rows; the
    finding is that closing the draw-call gap moved the bottleneck rather than removing
    it.
  - **`R-28`'s "to be _good_" dependency on `R-9` has fallen**: glyphs that are sprites
    over one atlas material batch with no further work, so R-28 is blocked on `R-30`
    alone.
  - Gotcha (test doubles): the WebGL backend's `TestGeometry` had no `vertexCount` — the
    backend never needed it and the batcher does. A structural double is only as complete
    as the last consumer that read it; adding a reader means auditing the doubles, and
    the failure is a silently _unbatched_ frame, not a type error.
  - Gotcha (browser gates): a page with content at `z = 0` and an orthographic camera
    left at the origin renders **nothing** — the near plane clips it. Cost one debugging
    cycle in the new gate; `examples/first-2d-scene` moves its camera to `z = 5` for this
    reason.
  - Technique worth reusing: a browser gate can build **its own fixture** with Vite's JS
    API and inject it into a page served by an existing example's server. That buys
    real-GL evidence for a feature that does not deserve a tenth example site or a tenth
    preview server.
- **2026-08-09 — R-36 `lookAt` and orientation helpers (helper tier).** Decisions worth
  keeping:
  - **−Z is every node's forward, not a camera's privilege.** `Node.lookAt` /
    `Node.getWorldDirection` therefore live on `Node`, and one call aims a camera, a
    `DirectionalLight`, or a `SpotLight`. The claim was _verified_ against three existing
    sites (`Matrix4.setPerspective`, `Camera.updateViewMatrix = inverse(worldMatrix)`,
    §68's light axis) and is pinned by a test that builds the classic gluLookAt matrix
    independently and compares all sixteen elements — so `lookAt` produces exactly what
    `updateViewMatrix` inverts, by test rather than by assertion.
  - **`lookAt`'s target is world-space, always.** Under a parent the local rotation is
    `conjugate(parentWorldRotation) · worldRotation`, the parent's rotation read via
    `Matrix4.decompose` of its already-resolved world matrix. It is the only contract
    under which the call survives reparenting onto a moving rig, which is §44's whole
    follow-rig case. Non-uniform parent scale inherits `decompose`'s closest-rotation
    limitation; zero parent scale decomposes to identity, so the aim lands in world terms.
  - **The validation split follows the layer, not the call.** `@fourjs/math` validates
    nothing (the rule `Matrix4.setPerspective` already states): `setFromLookDirection`
    leaves its quaternion **untouched and unhooked** on a zero/NaN direction or a
    zero/parallel/NaN up — `Matrix4.invert`'s "refusing beats substituting a
    plausible-looking wrong answer". `@fourjs/scene` is the policy layer: `Node.lookAt`
    makes the _same two tests_ on its own inputs and throws
    `FourError("INVALID_SCENE_GRAPH")`, so a scene node never reaches the silent branch.
    The top-down aim with the default +Y up is a **throw**, not a fallback roll — a
    silent fallback rewrites the orientation the caller asked for and hides the mistake
    (WP-3.3's no-silent-rewrites rule).
  - **`Node.lookAt` does not check §42 authority, and that is the consistent answer, not
    a shortcut.** Enforcement is writer-side everywhere in the engine
    (`warnAuthorityConflict` is called by `MotionSystem`/`KinematicSystem`/`Tween`/
    `AnimationMixer`/`AnimationController`, never by `Transform`), and **direct writes
    never warn** — `node.rotation.setFromAxisAngle(...)` on a `"physics"` node is silent
    today. `lookAt` _is_ the `"manual"` authority. Warning would make it the only
    self-policing write in the engine and would fire on aiming a physics-owned body at
    its starting pose. Pinned by two tests (helper silent under three foreign
    authorities; the _system_ warns once).
  - **One Shepperd implementation.** `setQuaternionFromBasis` (module-internal to
    `quaternion.ts`, deliberately not in the barrel) is now shared by `Matrix4.decompose`
    and `setFromLookDirection`. The arithmetic moved verbatim, so every determinism
    golden is bit-identical — and `matrix4.ts` coverage rose 98.58% → **100%** because
    the look-at tests reach a branch its own suite never did. **Gotcha for reviewers:**
    any future edit to that function is a change to the physics/animation decomposition
    path; the `tests/determinism/*` goldens are the guard.
  - **`getWorldDirection` was hoisted, not duplicated.** `DirectionalLight` and
    `SpotLight` carried two byte-identical copies; both were deleted and the doc
    references retargeted to `Node.getWorldDirection`. `@fourjs/render`'s structural light
    predicates are unaffected — both are gated on the brand _before_ they probe for the
    method, so every node now carrying `getWorldDirection` cannot misclassify.
  - **Bundle gotcha: class methods on `Node`/`Quaternion` are never tree-shaken**, so a
    helper on either is paid by _every_ bundle whether or not it is called. R-36 measured
    **+0.50 kB gzip** across first-3d (30.80 → 31.30 / 31.5), ui-demo
    (36.23 → 36.73 / 37) and particles-demo (28.20 → 28.70 / 29) in a same-tree A/B. All
    pass; 0.20–0.30 kB of headroom is left, and the only lever that would have avoided
    the cost — a free function `lookAt(node, target, up?)` — is exactly the ergonomics
    R-36 exists to fix.
  - **PH-11 is not this packet, and the reason is §42.** §12 calls it a look-at
    _constraint_; §42 gives constraints the `"constraint"` authority, which still has no
    producing system. A `faceTo` on `KinematicController` would write as `"kinematic"`
    and pre-empt that design, and `steering.ts` has no node access by construction (pure
    acceleration functions, no scratch) and should keep it. Named seam: a
    `LookAtConstraint` component + a system at `PRIORITY_CONSTRAINTS` (empty today,
    PH-21) calling `setFromLookDirection` per step under `"constraint"` authority.
  - **Multi-agent note:** `pnpm lint`, `pnpm run docs` and repo-wide `prettier --check .`
    can all be red from a _sibling's_ in-flight work while the tree is shared.
    Scope-restricted runs are the honest gate when a sibling holds the tree:
    `eslint <my paths>`, `typedoc --entryPoints <my packages>`,
    `prettier --check <my paths>`.
- **2026-08-09 — R-16 §58 paints, fills and strokes.** Decisions worth keeping:
  - **Two colours reach one draw as per-vertex colour**, not as two materials. §57's
    pipelines already multiply `vertexColors` (`R-19`), so a fill and a stroke share one
    geometry, one material and one `drawElements`: **no `RenderItemKind` arm, no
    pipeline, no frame-path edit**, and `render-webgl` was never opened. Second
    application of R-23's "a packet can close a gap by adding nothing to the frame
    path", and the concrete reason §49's `material: Material[]` was _not_ needed for 2D.
  - **A paint union widens by kind, not by ambition.** `Paint` has one member and that
    member carries a discriminant, so `{ kind: "linear-gradient" }` is a compile error.
    The deciding measurement is that per-vertex colour is **exact** for a solid and for a
    _two-stop linear_ gradient and silently faceted for every other §58 kind — a union
    whose members work for some of their own arguments is worse than one that is
    honestly narrow. The exact tier is a pipeline: R-6/R-13/R-18's
    ~1.9 kB-per-`WebglRenderer`-bundle law plus a `RenderItemKind` arm RFC 0001 _and_
    RFC 0003 both want.
  - **`ShapeMaterial` is unshipped a second time, and that is a finding.** R-23 left it
    conditional on §58 giving it content; §58 landed and the answer did not change,
    because §50's own example puts `fill`/`stroke` on the _shape constructor_ and a
    stroke's width and joins are geometry, not shading. A conditional deferral has to be
    re-decided out loud when its condition arrives, or it silently becomes a habit.
  - **A getter and its setter should have two types when one of them resolves defaults.**
    `shape.stroke = { width }` writes; `shape.stroke` reads `ResolvedStrokeStyle` with
    `lineJoin: "miter"` rather than `undefined`. Saying that in the type system removed
    the whole `?? default` family from both the shape and the §79 writer — which is also
    what took `scene-serializers.ts` back to 100% branch coverage, since every one of
    those `??`s was a dead arm.
  - **`LEQUAL` is what makes a stroke paint over its fill.** Both sit at z = 0, index
    order is draw order inside one geometry, and §61's depth func lets the later draw
    through. Written down because a backend that "tightened" the comparison to `LESS`
    would make every stroke vanish under its own fill with no test naming depth.
  - **The join/cap overlap is documented, not removed** (the `fillRings` precedent):
    joins and caps are outer-side only, the inner side of every corner is covered twice,
    invisible under an opaque paint and double-blended under a translucent one. Measured
    against analytic areas — a 496-segment stroked circle overshoots 10π by 0.785, which
    is exactly 496 × (w/2)²·tan(θ/2). `alignment: "outside"` on a convex outline is the
    escape.
  - **§33, second two-tier module:** stroke expansion is **same-runtime** where the fill
    tessellator is cross-platform, because offsetting needs a unit normal (`Math.sqrt`)
    and a round join needs `Math.acos`/`cos`/`sin`. `tessellation.ts`'s determinism
    section now scopes itself explicitly — a module-level tier claim goes stale the
    moment the module grows an operation.
  - **Alignment is named from the path's own direction**: `inside` is the band to the
    _left_. On a counter-clockwise ring (every §50 shape) the interior _is_ the left, and
    on a clockwise one (a `Ring`'s hole) the two swap — which is also correct, because an
    annulus's material is outside its inner circle. One rule, no second case.
  - **A lone point strokes to nothing** — `Path.flatten` explicitly declines to decide
    whether a stray `moveTo` is a dot; `expandStroke` decides, and the answer is that a
    dot is a `Circle`. Same rule kills zero-length dash "on" entries (so SVG's `[0, 4]`
    dot pattern draws nothing here, stated on the option).
  - Gotcha: **`0.27` is not a `Float32Array` value.** Vertex-colour assertions must use
    exactly representable components (0.25, 0.5, 1) or `toBeCloseTo`; three tests were
    written against the authored tuple and failed on the round trip.
  - Gotcha, repeat: **`pnpm graph` rewrites `docs/Architecture/*` and will sweep a
    sibling's in-flight exports into your diff.** Run it for `graph:duplicates`, then
    `git checkout -- docs/Architecture/`.
- **2026-08-09 — A-18 abort half + A-9 `pointerType`.** Decisions worth keeping:
  - **Cancellation semantics for `AssetManager` (A-18).** Three rules, in source as the
    contract: (1) an aborted load never holds a reference — a pre-aborted signal is
    refused before the cache is consulted, a later abort hands the reference back, and an
    aborted load must therefore never be `release`d; (2) one waiter's abort is not the
    others' — aborting decrements and the request is abandoned only at refcount zero;
    (3) **`release` is not `abort`** — releasing the last reference to a pending load
    still lets it settle. Rule 3 deviates from GAP v0's closure sketch ("the last release
    of a pending load aborts it") on purpose: the caller still holds that promise, and
    rejecting it turns a tidy teardown into an unhandled rejection in application code.
    Cancellation has its own channel because it is the caller asking for the rejection.
  - **A generic type parameter must not reach a class's instance type when the class is
    named in another package's option type (measured).** `AssetManager<TSignal>` with
    `#fetch: FetchLike<TSignal>` makes `AssetManager<AbortSignal>` unassignable to
    `AssetManager`, breaking `ApplicationOptions.assets`. Fix: keep the parameter in the
    _options_ interface (where it forces `fetch` and `abortController` to agree) and
    erase it at the constructor. Generalizes to every future capability-typed seam.
  - **`typeof fetch` IS assignable to `FetchLike<TSignal = never>` =
    `(url, init?: { signal?: TSignal }) => …` (measured).** This supersedes nothing in
    the 2026-08-07 note — that finding was about a _concrete_ structural
    `AbortSignalLike` parameter, which does break it. Generic in, concrete out.
  - **Unknown platform enum values are reported as absent, not refused (A-9).**
    `SurfacePointerEvent.pointerType` is typed `string` (because `lib.dom` types
    `PointerEvent.pointerType` as `string`, and narrowing the seam breaks structural
    assignability — measured); the `"mouse" | "pen" | "touch"` union lives on the scene
    event, and a vendor value or `""` yields an absent field. §85's refuse-don't-clamp
    governs _configuration_, not hardware telemetry arriving mid-gesture: throwing there
    would break input on a device newer than the union.
  - **A pointer's teardown is a property of the device, not of the ending (A-9).** A
    release forgets the pointer unless the device outlives its gesture _and_ has a hover
    worth keeping (a mouse over a node). `pointercancel` ends every pointer regardless —
    the platform withdrew it, and device knowledge must not override that. The retained
    entry cannot re-open §83's leak: a mouse's `pointerId` is stable, and an entry with
    no hover is dropped.
- **2026-08-09 — R-23 §50 shape nodes.** Decisions worth keeping:
  - **The honest tier is fill-only, and the three stroke-only primitives get no class at
    all** — line, polyline and the open arc. Fifth application of
    absent-beats-accepted-and-ignored, and the first where the absence is a whole _class_
    rather than a field. Three independent reasons, not one: §58 is silent, §52 puts
    stroke expansion in `@fourjs/geometry` by name, and a stroke without a join rule is
    _wrong_ at every corner rather than merely plain.
  - **A packet can close a gap by adding nothing to the frame path.** Shapes carry a
    `SurfaceMaterial` and draw through the existing unlit pipeline, so `RenderItemKind`
    was not widened, no pipeline was compiled, `render-webgl` was not opened, and the
    byte-identity argument is a _code-path_ argument. The mechanical form: a scene of
    shapes emits the identical GL transcript as a scene of plain `Renderable`s over the
    same geometries. Reusable technique.
  - **`ShapeMaterial` is deliberately unshipped** — without §58 it is `UnlitMaterial`
    renamed, and it costs either a `RenderItemKind` arm (which RFC 0001 _and_ RFC 0003
    both want, first-to-land owning `pipelineId`) plus 0.75–1.9 kB gzip in every
    `WebglRenderer` bundle, or a discriminant that lies. §57's family list is not a build
    order.
  - **`Node.rotation` is taken** (the §15/§97 live-quaternion alias), so no node subclass
    may have a scalar `rotation`. `tsc` refuses it; vitest does not — third confirmation
    that `pnpm run docs` is the real type gate. The family's name is `startAngle`: where
    the outline begins, from +X, for ellipse, regular polygon, star and sector alike.
  - **§53's validate-against-current-attributes rule has no legal end to swap from** when
    the vertex count changes: dropping indices leaves a non-indexed triangle geometry at
    an arbitrary count, replacing positions leaves indices dangling. **An empty index
    buffer is the configuration legal at every count** — the pivot every derived,
    resizable geometry has to pass through.
  - **§79's validating parse of a §51 path is the builder, replayed** (R-24's
    no-`fromCommands` rule), so a malformed document fails exactly where a malformed call
    sequence does. **Write the arc's _end_ angle, never its sweep**:
    `fl(fl(s+d) − s) ≠ d` for 63% of samples (worst 1.8e-15 rad) and no end angle can fix
    it, but `fl(s + arcSweep(s,e)) === e` in 500 000/500 000 — so the _document_ stays
    byte-exact while the reloaded sweep may move a bit.
  - **A shape parameter is required exactly when it _is_ the shape** (side count, star
    radii, sector angles, ring hole, polygon points, path); everything with an obvious
    unit size defaults to 1. The §79 read side follows the same line: defaulted fields
    restore their default when corrupt, required ones are refused loudly — inventing a
    triangle looks like a bug in the author's data.
  - **A ring's hole is a winding decision, not a second draw**: outer CCW, inner CW, so
    nonzero sees zero inside. Same-winding rings fill the middle twice — invisible under
    an opaque fill, wrong under a translucent one.
  - Measured: registering the nine §79 pairs pulls `Path` + the tessellator into any
    bundle calling `registerSceneNodeTypes()` — **+10.46 kB gzip** on
    `motor-digital-twin`, 0 B on the five examples that do not (hash-identical).
    Composing the pair in anyway is deliberate: a shape that failed to match `nodeTypeOf`
    would save as a bare `Node`, which is A-15's failure mode.
- **2026-08-09 — R-26 §50 SVG path data.** Decisions worth keeping:
  - **A format conformance rule is not an §85 clamp.** SVG 1.1 F.6.6 _defines_ what a
    reader does with a negative, zero, or too-small arc radius; refusing those would make
    valid documents unreadable, which is the opposite of §50's requirement. The line is
    drawn in a table in-source: format-defined normalizations are honoured, malformed
    text is refused with a `SyntaxError` naming the offset. Corollary, and a deliberate
    divergence from SVG: a viewer renders _up to_ the error; an importer must not, because
    that turns a typo into silently missing geometry — nothing parsed is kept.
  - **A `d` parser transcribes; it does not flip Y.** The transform that lands SVG in a
    Y-up world is `y ↦ height − y`, and `height` lives in the `viewBox`, not in `d`.
    Negating alone is _half_ a transform performed silently, and half a correction is
    worse than none because none is visible. Transcription also makes
    `format(parse(d))` a checkable identity — which is what §50's word _compatibility_
    has to mean. The one-liner (`Matrix3().fromArray([1,0,0, 0,-1,0, 0,height,1])`) is
    exact and arcs survive it, because a reflection is a similarity.
  - **An arc's start is authoritative over the segment that reaches it — the finding that
    changed the design.** SVG's `A` begins at the current point _by definition_; §51's arc
    begins where `centre + R(rot)·(rx cos θ₁, ry sin θ₁)` lands, and no centre hits an
    arbitrary point exactly (**measured: ~83% over 200 000 arcs**; `(a−b)+b` is not an
    identity in binary FP). The two ulps became §51's implicit connecting segment pointing
    _back_ along the arriving line — a zero-area spike §52 refuses, making the **rounded
    rectangle** unfillable. Fix: the reader is one command behind and retargets the held
    segment's endpoint onto the arc's start. This is the concrete, unavoidable form of
    R-24's recorded "ulp trap" (an arc's analytic start never equals a hand-written
    `lineTo` to the same coordinates) — an SVG document _always_ writes that `lineTo`, so
    the trap is not avoidable by authoring convention on the import path.
  - **`fromCommands` is still not needed** — export is a read of `Path.commands` plus a
    cursor; import is builder calls. The R-24 decision stands, unamended. The single
    temptation (`Path.ellipse` re-deriving the sweep as `(θ₁+Δ) − θ₁`, ±1 ulp) was
    resisted: the quantity is already same-runtime tier.
  - **A §33 cross-platform claim can rest on ECMA-262 rather than on geometry.**
    `golden/svg-path.json`'s `text` half is exact because decimal→double (≤20 significant
    digits) and `Number::toString` are _exactly specified_, which is why `String(value)`
    is the writer's number format: cross-platform **and** lossless, where any
    fixed-decimal format is neither. Proof is mechanical, two ways (all 2 408 coordinates
    dyadic; every case a byte-for-byte text fixed point). The stated edge is ECMA-262's
    > 20-significant-digit freedom.
  - **A parser's §96 story is one bound plus a structural argument.** No regexes anywhere
    (single forward character-code scan ⇒ O(n) on _every_ input, so ReDoS is impossible
    rather than unlikely); one finite `maximumTextLength`, because the parser recurses
    nowhere and allocates linearly, so bounding the text bounds time, stack and heap
    together — a second limit would be a number with no independent meaning. Totality
    (path-or-throw, three documented error types) is fuzzed, not asserted.
  - Gotcha: **`pnpm graph:duplicates` counts only _exported_ names** (`collectOwnDefiners`
    reads `file.exports`), so a module-private `TAU` beside `path.ts`'s costs nothing —
    but any newly _exported_ helper must be checked repo-wide first.
  - Doc-truth: `packages/geometry/README.md` still said the path model and tessellation
    were "staged / not yet implemented" a day after R-24/R-25 shipped. Package READMEs are
    **not** scanned by `tools/check-docs.mjs` (it walks the root list plus `docs/`) — the
    24 package READMEs are an unguarded doc-truth surface.
- **2026-08-09 — R-18 §69 shadows.** Decisions worth keeping:
  - **§69 ships one tier: the sun's map.** Point/spot carry no `castShadow` at all —
    §69's answer for them is a cube map and a per-light index the single-map tier has
    nowhere to put. Absent beats accepted-and-ignored, fourth application of the rule.
  - **A shadow volume must be authored, not fitted** — auto-fit needs §87's bounds pass
    and makes texel density frame-dependent, which is shimmer §33 forbids. The volume is
    the light's _node_: position matters for shadows even though §68 says it does not
    matter for lighting.
  - **`castShadow` defaults `false` on the light and `true` on the node.** Switching a
    light on buys a whole pass (§61: a renderer does not silently spend that); switching
    a node off is a per-object exclusion. The asymmetry is what makes "enable the sun and
    shadows appear" true.
  - **Byte-identity, fifth confirmation of mirror-at-GL-initial-0** — a `bool` uniform at
    `false` plus a `hasShadow` flag suppressing the pass. The pixel half needs the shadow
    to _multiply the existing product in place_, never a rewrite:
    `direct = lightColor*diffuse; if (useShadow) direct *= f; lighting = ambient + direct`.
  - **`targetRecord !== null` was never the right F13 condition** — it was only
    accidentally right while off-screen frames were the only ones that bound a
    framebuffer. Any new pass that binds one must extend the `framebufferBound` flag, not
    add a second condition. (New instance class: an envelope condition that encodes _why_
    a resource was bound rather than _that_ it was.)
  - **Explicit PCF taps beat hardware `sampler2DShadow`** — compare mode is sampler
    state, so it would couple `gl-render-target.ts`'s cache to what a consumer intends;
    2×2 is a smaller filter than §69 asks for; and a fake GL context can assert
    arithmetic but not what a driver does inside a shadow sampler.
  - **Depth textures are not filterable** — `LINEAR` on `DEPTH_COMPONENT` makes the
    texture incomplete and every receiver reads fully occluded. `NEAREST` is mandatory,
    not a preference.
  - **Measured:** a seventh compiled-at-init pipeline plus a pass costs **~1.9 kB gzip in
    every bundle carrying `WebglRenderer`**, regardless of whether the app uses lights at
    all — R-6's 0.75 kB law at scale. Making §69 opt-in needs a registration seam (A-4's
    define/opt-in), not a smaller shader.
  - **Gotcha (multi-agent, joins the ports set): `ss` is not installed in this
    container**, so port checks must read `/proc/net/tcp`; and orphaned preview servers
    do **not** match `pkill -f "vite preview"` — their cmdline is
    `node .../vite.js preview`. A killed `pnpm test:browser` leaves all nine servers
    running and the next run dies with "port 4173 is already used".
  - **Gotcha, second confirmation of R-38's:** a new required field on `RenderItemBase`
    breaks hand-built item literals only under TypeDoc/tsc, never under Vitest —
    `pnpm run docs` was the gate that caught it.
- **2026-08-09 — R-24 §51 Path.** Decisions worth keeping:
  - **A determinism tier is a property of the operation, not the module** — R-25's
    one-tier rule does not survive §51 (Béziers can be exact, arcs cannot); the honest
    answer is two goldens with two `_tier` labels, because merging them lets a
    transcendental hide inside the weaker claim.
  - **The dyadic-rational assertion is a better tier proof than a digest** — integer
    inputs + power-of-two tolerances make "cross-platform" _checkable_ (`x·2²⁴ ∈ ℤ`),
    not argued.
  - **A canonical model beats a faithful one** — storing the signed sweep instead of
    the raw end angle makes reverse/subdivide/transform one line each.
  - **Analytic-area oracles find winding-sign bugs that reading does not** — all three
    real bugs came from the area tests. The ulp trap: an arc's analytic start never
    equals a hand-written `lineTo` to the same coordinates — author arc-bearing shapes
    with implicit connecting segments. After `close()` the current point is the
    subpath's first point — a _disjoint_ ring needs an explicit `moveTo` (hit twice).
  - **No `fromCommands`** — the builder is the well-formedness invariant every reader
    assumes; §79 gets the validating parse. Offset paths belong to R-16 (an offset at
    a concave corner _is_ the §58 join rule); the four booleans belong to the one
    planar-subdivision packet §52 also needs.

- **2026-08-09 — R-25 §52 tessellation.** Decisions worth keeping:
  - **§52 ships ear clipping, not monotone — the deciding argument is determinism**
    (sweep-line equal-y tie-breaking is where a determinism claim quietly stops being
    true), not simplicity; `PolygonTessellator` is the swap seam.
  - **First cross-platform-tier §33 claim in the repo**: exactly-rounded IEEE ops only,
    squared distances, cross-product signs, integer tie-breaks — no
    `atan2`/`sqrt`/`hypot`. An edit introducing a transcendental there breaks the
    golden's _stated tier_, not just its numbers.
  - **A tessellator must prove its input simple before clipping** — ear clipping fed a
    pentagram succeeds _wrongly_; the O(n²) pairwise proof costs nothing beside the
    O(n²) clip and makes every §85 refusal precise.
  - **Bridged rings are only weakly simple** — the two-ears theorem does not apply;
    the two real bugs (bridge-seam self-veto, stacked bridges) were found by fuzzing
    against an area/winding oracle, not by reasoning. The multi-hole residual
    (~2/1000 refused, never wrong) is documented in-source with the fuzz table.
  - `Point2D` now lives in `tessellation.ts` (export path unchanged). Third
    shared-worktree incident class: **an agent's in-flight file can be silently
    reverted to HEAD by a concurrent process** — verify with `md5sum` vs
    `git show HEAD:` after any unexplained modification notice.

- **2026-08-09 — R-17 §68 multi-light.** Decisions worth keeping:
  - **The bound is the shader's, not the API's** — `MAX_PUNCTUAL_LIGHTS = 8` is a TS
    constant interpolated into the GLSL so the two cannot disagree; a runtime
    `maxLights` would recompile inside a frame (§61 forbids throwing there). Overflow
    order is **authored** (scene-graph), never nearest/brightest — both flicker (§33).
  - **The R-13 irradiance-over-π convention extends to distance**: `color × intensity`
    is the irradiance at _unit distance_ for a punctual light — what lets point and
    directional lights agree at 1 m and mix in one scene. The range window is a
    culling aid, not physics; `range: 0` = unbounded is the honest default.
  - **Byte-identity now has a pixel half**: the GL half is the mirror-at-GL-initial-0
    technique (fourth confirmation); the pixel half requires adding the new term to
    the old expression in source order — re-association moves pixels
    (`viewProjection * model * p` must not become `viewProjection * (model * p)`).
  - **A recorded transcript must be recorded on the reverted build**, never
    hand-copied from a neighbouring packet (four plausible-looking errors).
  - **Never `git stash` in the shared worktree** (now the fourth multi-agent incident
    class): swap your own files with `git show HEAD:<f> > <f>` and restore from a
    scratchpad copy. A shared GLSL chunk is worth real bytes (~400 vs ~700); one
    ungated `console.warn` costs 122 B (vs R-29's five at 330 B).
  - Still exactly one directional light — deliberately; a second sun needs a third
    set-entry kind (the clustered/forward-plus path). Hemisphere is a two-colour
    ambient term beside `Scene.ambientLight`, not a punctual light.

- **2026-08-08 — Spec revision 1.8 (consolidated amendment pass).** All queued
  spec-revisit items applied in one pass; no new lettered sections, `ALLOWED_LETTERED`
  unchanged. Rules that emerged:
  - **A spec section that lists requirements is not stale merely because the
    requirement is unbuilt** — only statements about implementation _status_ are
    amendment targets (why §65/§55/§100 were triaged out while §18/§97a were
    rewritten).
  - **When the spec's own placement of a field is unimplementable under the frozen
    dependency matrix, correct the spec** rather than annotate the source (§54's
    `morphTargetWeights` → `MorphWeights` component, declared spelling kept as an
    accessor).
  - **RFC-derived amendments carry the RFC's status** — §57's `ShaderMaterial` row is
    _provisionally withdrawn, RFC 0001 draft, decision pending_, never settled while
    the RFC is a draft.
  - Gotcha: **"§3.1" in the RFCs/plan is the implementation plan's dependency matrix,
    not the spec's §3.1 ("Scene")** — `check-spec`'s reference check resolves the
    number and cannot catch the confusion.
  - Gotcha: `docs/SPECIFICATION.md` + `docs/ERRATA.md` are hand-formatted and have
    never been prettier-clean (2,128 diff-lines at HEAD) though neither is in
    `.prettierignore`; CI runs no prettier job — treat the spec as prettier-exempt and
    never `--write` it as a side effect (owner call: make the exemption explicit).

- **2026-08-08 — R-29 sprite frames + A-24 context-loss suite.** Decisions worth
  keeping:
  - **A §55 frame does not need authored uv** — it is an affine reparametrization of
    the derived-uv map (`quad.zw = w·tw/fw`, `quad.xy = minX − fx·w/fw`); the `quad`
    uniform survives generalized and its _name_ is load-bearing (an argument of
    `getUniformLocation`). The 2026-08-07 retire-the-uniform prediction is retracted
    in place. A real uv stream remains §65 batching's answer.
  - **Frames are texels, bottom-left origin** — forced by `MaterialTexture.data`'s
    row-0-is-`v=0`; normalized units would make §85's containment check vacuous. A
    frame write re-uploads nothing (the property §55 clips and §86 batching need).
    Named hole: containment is write-time only; a later texture swap samples
    clamp-to-edge (wants R-30's §77 change notification).
  - **Diagnostics cost bytes, measured**: five per-component §85 messages = +330 B
    gzip, more than the feature; two whole-value messages are the trade. ui-demo at
    32.98/33 kB — **20 B left**; next bundle-touching packet needs a proposal.
  - **§61's loss path was correct before it was tested** (A-24: 17 tests, no product
    bug) — the gap was proof, not behaviour. The four remaining uncovered
    render-webgl statements are invariant guards unreachable through the public API —
    do not chase 100% there. `getExtension` on a lost context returns `null` —
    capture `WEBGL_lose_context` before losing.
  - **Owner call recorded:** dispose-after-failed-restore leaks rebuilt programs
    (§83); the obvious `gl.isContextLost()` fix breaks the tested
    not-one-GL-call-while-lost property — deliberately unmade.
  - Serializer follow-up: `Sprite` documents don't yet carry `frame` (one field;
    round-trip passes today because the field is simply absent).

- **2026-08-08 — R-38 §46 layers.** Decisions worth keeping:
  - **Layers are self-only, never subtree** — a layer is identity, not state (off-ness
    inherits; belonging doesn't); subtree gating is strictly less expressive (a `"ui"`
    node could not carry a `"default"` child); changing a layer can never make
    something _else_ disappear. `applyLayers` is the subtree spelling (the
    Three.js/Unity model).
  - `Camera.layers` **overrides** `Node.layers` — safe because nothing reads a
    camera's membership. The registry is **module-level, not per-Scene** (nodes exist,
    move between scenes, and deserialize before their scene is assembled).
  - **§46 requires names in scene files, never bits** — round-trip is `layerNames()`
    out, `resetLayers()` + replay in saved order back.
  - **`@fourjs/scene` may not branch on `DEV` at all** (the dev-build suite's blunt §33
    rule for simulation packages) — its §85 check is unconditional; the render tier's
    copy is GATED with a recorded argument (~115 B, the difference between +240 B and
    +120 B).
  - Byte-identity technique, third confirmation: **a permissive default mask makes a
    new filter a no-op on the existing path**, exactly as a `bool` uniform at GL's
    initial `false` did. Gotcha: a new required field on `RenderItemBase` breaks
    hand-built item literals only under TypeDoc/tsc, not Vitest.

- **2026-08-08 — A-6 composition root.** Decisions worth keeping:
  - **A world cannot be an option-record here** — `four/application` importing
    `@fourjs/physics` puts a solver in every UI bundle; §45's `PhysicsWorldOptions` form
    waits for a world front-door the way `renderer: "auto"` waited for §62's registry
    (third deferred-string-selection instance; the import is type-only).
  - **The factory form exists because `PhysicsWorld` takes `poses` at construction** —
    an instance-only option would ship an `app.physics` that silently cannot
    interpolate (§43). **Ownership follows construction, in both directions** (§83).
  - `reducedMotion` resolves through the injected source **on every read, never
    cached**; a boolean short-circuits the source. `autoResize` defaults true iff an
    observer was supplied — an observer is never accepted-and-ignored.
  - `contacts` stays staged: the world publishes §29 _events_, not a live manifold
    count — differencing them answers a different question (§37 seam needed).
  - **Measured gotcha (third cannot-tree-shake instance):** naming one leaf function
    in `debug-draw.ts` cost 939 B gzip (module-level scratch + frozen lists);
    producers belong in the module of the record they write. Spec-revisit: §97's
    "a world is built and tracked, not an app option" is stale after A-6.

- **2026-08-08 — R-15 §60a colour management.** Decisions worth keeping:
  - **The working-space policy is written down once** (`@fourjs/math` `color.ts` header):
    material/light/vertex colours _are_ linear-light — no per-value tag (it would have
    one legal value); §60a's metadata lives on _resources_ only (textures §77, targets
    §63).
  - **The output transform is a pass, never a per-material encode** — §60a's "is the
    final render-graph pass" selects the design (a per-shader encode would encode five
    times into one framebuffer and blend between draws in the wrong space).
  - **Both new defaults are `"linear"`** (deviating from §60a's sRGB texture default),
    so opt-in preserves every golden — owner decision to flip + move goldens
    deliberately. Alpha never runs through a transfer curve; nothing clamps (odd
    extension).
  - **§101's mapping row settles the CSS-string-options question** — §59/§68 show
    strings in _examples_, §101 pins tuples as the shipped tier; not widened;
    `srgbToLinearRGBA(parseColor(css), out)` is the one-line path (owner may widen).
  - Byte-identity technique, reconfirmed twice: a second `bool` uniform seeded at GL's
    initial `false` costs nothing; an optional resource field read as `?? "linear"`
    keeps every pre-existing double on the old call. §86 gotcha: effect-program GLSL
    ships in every backend bundle — the encode was inlined to fit ui-demo at
    31.99/32 kB.

- **2026-08-08 — §119 motor digital twin.** Decisions worth keeping:
  - **§84 is readable only _after_ `app.step` returns** — `step` resets the record on
    entry; reading from the `update` event gives all-`NaN` (measured).
  - **An instrumented example must not define `__FOUR_DEV__: "false"`** — A-4 gates
    `Application.stats` on `DEV`; a page about instrumentation cannot ship the build
    that strips it. The twin is the one documented dev-build example.
  - **A derated actuator is a second controller's `outputLimits`, never an external
    clamp** — clamping after `update` + `ki = 0` removes the accumulated term from the
    output too and produces a two-step limit cycle (measured: command alternating
    8.7/14.0 rad/s); §111's own anti-windup solves it exactly.
  - Short horizontal `GL_LINES` segments are dropped by the diamond-exit rule —
    decimate chart traces below ~4 px/segment. A rebuilt text line must `dispose()`
    its removed sprites or it leaks one geometry per character per rebuild (measured:
    953 kB → 1.44 MB before the fix).
  - Two coaxial hinges are stable on Rapier 3D over 900 steps with a contact fault
    applied and released. `collectBodyOrigins`' default cross size confirmed unusable
    in 3D a second time; an over-long cross projects across the frame off-axis.
  - **Index-race gotcha (second occurrence):** an agent staging files for
    check-docs' `git ls-files` + the orchestrator committing another batch sweeps the
    staged files into the wrong commit (dc8e1ae carries an intermediate twin
    snapshot; superseded by the twin's own batch). Rule: `git reset` before every
    selective staging, always.

- **2026-08-08 — A-27 §86 benchmarks (CPU tier).** Decisions worth keeping:
  - **A §86 row with a measurable CPU half and a blocked draw half is recorded as
    `half`, never as measured** — the benchmarks README now has that third category
    beside `hardware` and `feature`.
  - §86 states the retained-UI and animated-glyph rows as **counts with no rate**;
    60 Hz is an interpretation borrowed from neighbouring rows and must be labelled as
    such wherever it appears.
  - **The runner asserts on no timing** — exit 1 = a benchmark failed, exit 2 =
    operator error; a timing threshold would be the back door the benchmarks README
    forbids. Process-per-script is deliberate isolation (JIT, heap, throw containment).
  - **Gotcha:** a committed benchmark record may not contain a short array of scalars —
    Prettier collapses it while `JSON.stringify(…,null,2)` expands it, so the format
    gate fails; use an object (written into the README's Results section).
  - The 2026-08-08 re-records were taken on a loaded shared host; `physics-step`'s
    +24% is explicitly non-attributable — re-record on a quiet host before reading any
    trend.

- **2026-08-08 — PH-22 sweep.** Decisions worth keeping:
  - **A composite shape is a legal collider and an illegal §30 query shape** — Rapier
    answers _wrongly_ (zero intersections) rather than failing; `validateQueryShape`
    refuses them at all four adapter query entry points.
  - **§24 `compound` is deliberately not a tag** — several colliders on one body,
    runtime-assemblable since PH-5; Rapier models it the same way.
  - `jointMotorEffortCap` is the first capability field whose `false` means "applied,
    _differently_" rather than "not applied" — documented as such.
  - The per-property Rapier joint survey replaced the blanket freeze claim;
    `collisionEnabled` was the only mutable-with-throw property (base-class
    `setContactsEnabled`), the rest are `readonly` compile errors.
  - **A diagnostic threshold sits a decade past the guide's advice** so it never
    becomes routine (§41 warnings: 1e5 origin, [1e-2,1e3] dynamic extents, 1000:1
    mass ratio; static/kinematic exempt from the extent check).
  - Heightfield facts measured, not assumed: `heights` is column-major with row→local
    Z, column→local X (the opposite of the intuitive reading); the public shape counts
    samples, the adapter subtracts one. Gotcha repeat: vitest doesn't typecheck —
    three test-only type errors only surfaced at `pnpm run docs`.

- **2026-08-08 — R-13 StandardMaterial.** Decisions worth keeping:
  - **The radiometric convention is now written down**: light colour × intensity is an
    irradiance already divided by π — neither lobe carries a `1/π`. This is what makes
    `LitMaterial` and `StandardMaterial` composable in one scene, and the constraint
    any future BRDF must honour.
  - Defaults are `metalness: 0` / `roughness: 1` (three.js's, not glTF's 1/1) — a glTF
    importer assigns both explicitly, so it cannot inherit the difference.
  - Ambient reaches the diffuse lobe only (no IBL; a metal under ambient alone renders
    black, honestly); roughness is floored in the shader (0.045) where the 0/0 lives,
    not clamped in the material.
  - `SurfaceMaterial` deliberately NOT widened (would strip `color`/`setColor` off
    every ordinary renderable's material type — the `SpriteMaterial` exclusion
    argument); inference handles `new Renderable(geo, new StandardMaterial())`.
  - The duplicate-symbol gate is load-bearing — it refused a second `ColorRGB`; the
    shared RGB tuple alias belongs in `@fourjs/math` with R-15.
  - ui-demo budget 31 → 32 kB on the R-6-style structural proof (compile-at-init
    alone was 547 B over); two consecutive pipeline additions absorbed — A-4's
    build-time pipeline-selection seam is the structural fix.

- **2026-08-08 — Gotcha (multi-agent, joins the rebase/stash/ports set): a batch that
  lands code without touching a tracking file is undiscoverable within a day.** The
  `ab13840`/`fe8eb6f` closures (nine gap items) were invisible to every later agent
  and to the gap document until the v1 rewrite re-verified them in source — the
  analysis's own A-28 failure mode aimed at itself. Rule: no batch commits without its
  CHANGELOG entry and gap banner in the same commit. Also: `docs/GAP ANALYSIS v1.md`
  supersedes v0 as the working gap document (v0 kept as history with a pointer).

- **2026-08-07 — A-4 dev/prod builds.** Decisions worth keeping:
  - **Dev is the default; you opt out** — `typeof __FOUR_DEV__ !== "undefined" ?
__FOUR_DEV__ : true` in one file (`@fourjs/core` `dev.ts`); the identifier is never
    read outside `typeof`; un-bundled runs (tests, determinism) are dev automatically.
  - **The flag may remove work, never change a number (§33)** — enforced by the
    `GATED` allowlist in `tests/integration/dev-build-mode.test.ts`, not prose;
    simulation packages refused outright. **Guard at the call site** — the helpers'
    internal early-return only stops the console write, not message construction.
  - **Gotchas (measured):** a private class method cannot be tree-shaken off a class
    (empty it with a leading `if (!DEV) return;`); a top-level _call_ survives
    tree-shaking without `/* @__PURE__ */`; storing the option beats storing the
    resolved value when the default lives in a package production drops.
  - **§83's leak check is an audit you call, not a watcher** — a growing counter is
    not a leak; only the caller knows which span should balance. §85's asymmetry is
    deliberate: `devAssert` skips entirely in production; every `FourError` stays
    unconditional. R-6's pipeline is NOT dev-gated — `renderEffect` is a production
    feature; its cost needs a registry split.
- **2026-08-07 — §118 flagship.** Decisions worth keeping:
  - **A screen-space UI is a camera child until §46 layers land** — §48's `layerMask`
    is deferred, so a second viewport would draw the whole scene twice; camera
    parenting gives screen-space behaviour, one pass, and working §71 picking (first
    perspective pick in the repo, measured).
  - **A browser gate must not re-derive §74 layout** — the page publishes
    `data-controls` in canvas pixels and the spec validates the claim via `data-hover`
    before clicking. `page.mouse` needs `boundingBox()` added (canvas-relative vs
    viewport is the trap; measured offset).
  - **Pause is exactly 0 changed pixels**; single-step is exact because the
    accumulator is public (`fixedDeltaTime − accumulator + 1e-6` runs exactly one
    step, and `fixedStepsLastFrame` lets the claim be checked, not trusted).
  - `data-*` published with `toFixed(4)` cannot support `toBeCloseTo(…, 4)` — two
    roundings carry 1e-4. Particle hue counts swing 5× with burst phase — thresholds
    must be set at "never ran", not "typical".
  - **`registerRapierSolver()` pulls both wasm images** (1.54 MB gzip vs 0.69 for one
    adapter) — the measured price of `solver: "auto"`; per-dimension registration is
    the recorded fix.
  - Gate repair: `generate-compatibility.mjs` now requires an upper-case initial on
    `*Adapter` exports (the `createRapierAdapter` factory turned check-compat red at
    HEAD for ~5 commits until the flagship's gate run caught it).
- **2026-08-07 — A-5 §83 resource accounting.** Decisions worth keeping:
  - **Numbers, not references** — a tracker holding its resources would _be_ the leak;
    `WeakRef`/`FinalizationRegistry` answers "was this collected?", not §83's "was this
    disposed?", and non-deterministically.
  - **A resource dropped without `dispose()` is never subtracted** — a self-healing
    counter would hide the leak signal it exists to show; §83's contract is explicit
    lifetimes and the accounting refuses to be more forgiving than the spec.
  - **"A disposed resource holds nothing"** (`byteLength → 0`) — one rule makes
    double-dispose, resurrection-by-setter, and delta arithmetic all fall out.
  - **Levels, not per-frame counters** — `textureMemory`/`bufferMemory` describe the
    engine, not the frame; reported with or without a renderer; an accounting of what
    the engine holds and would upload, not GPU residency — stated on the fields.
  - **Not every seam needs a transcribed shape** — `ResourceMemoryLike` was built then
    deleted (no producer-owned record exists); `recordResourceMemory(stats, tex, buf)`
    is allocation-free by construction. Duck-typed-contract count stays at five.
  - **Gotchas (measured):** folding accounting into `markDirty()` with an
    `#accountedBytes` field is _larger_ minified and puts byte math on a per-frame
    path — don't retry. A-5 costs +0.22 kB gzip; ui-demo at 30.96/31 — A-4's
    `__FOUR_DEV__` is now the practical blocker for the next four/ui-touching packet.
- **2026-08-07 — A-16 remainder (drawing-tier §79 pairs).** Decisions worth keeping:
  - **Resources are keys, not payloads, and the catalog is a seam not a format** — §79
    mandates key-plus-manifest; the manifest needs A-18 content hashing, so what ships
    is `SceneResourceCatalog` (`keyOf`/`get`, method syntax for bivariance per the
    `ComponentSerializer` precedent; a bare `Map` is a valid read catalog), which a
    manifest later implements.
  - **`unknownResources: "skip"` is write-side only** — A-15's symmetry does not
    survive here: a component can be dropped and leave a valid node; a `Renderable`
    cannot default its resources without inventing ones the application must dispose
    (§83). A _node_-level skip is inexpressible through `nodeTypeOf`/`nodeDataOf`
    (per-node data, not a filter) — recorded.
  - **Material kind is checked for `Sprite` only** — `Renderable<M>` is generic on
    purpose; a read-side kind whitelist would make `Renderable<GlowMaterial>` savable
    and unloadable. Dispatch is on the §57 discriminant, never `instanceof`.
  - **Type names are `<package>:<class>`** (extends `ui:*`); the prefix is a namespace,
    not an import path — rev 1.3 already moved cameras between packages and a published
    name must outlive that. Camera documents carry no `depthRange` (renderer-owned,
    §47).
- **2026-08-07 — Auto-selection registries (A-8/R-2/PH-19).** Decisions worth keeping:
  - **The WP-3.6/§45 departure is retired, not reversed** — §45's string works as a
    _widening_; `four` still never imports a backend. Payload measured both ways:
    instance +0.2–0.3 kB gzip, `"auto"` +0.78 kB paid only by the asker.
  - **Explicit registration calls, never side-effect imports** — forced by
    `"sideEffects": false` on all 24 packages (a side-effect module is _correctly_
    deletable). Applies to every future registry in this repo.
  - **`resolveRenderer`/`resolveSolver` must never statically reference their registry
    class** (lazily-created module `let`) — the single discipline keeping registries
    and backends out of instance-naming bundles; breaking it silently regresses every
    example.
  - **§62's diagnostics event is a callback in both tiers** (`onFallback`/
    `onSolverReject`) — §3.1 gives neither `render` nor `physics` a diagnostics edge.
  - **`isSupported` must never touch the caller's canvas** — a probing `getContext`
    would fix the context attributes and silently disable `antialias`; the probe is an
    environment question, `initialize` is the real gate, and `"auto"` recovers from its
    failure.
  - Renderer `"auto"` uses §62's order (registration order ignored — §33); solver
    `"auto"` uses registration order (§37 fixes no preference); the headless tier is
    never auto-selected; a _named_ solver is handed back unfiltered so `PhysicsWorld`
    reports mismatches with its own precise message.
- **2026-09-06 — Auto-selection follow-ups closed.** `backend-selection.test.ts`
  now registers real `registerWebgpuRenderer()` for §62's WebGPU rung (fallback when
  `requestAdapter()` resolves null, and preference over WebGL 2 through `Application`).
  ui-demo's TODO budget note (30.74/31 kB) was stale — `.size-limit.json` is 45 kB.
- **2026-08-07 — PH-9 AnimationController.** Decisions worth keeping:
  - **The controller is a pose evaluator, not a mixer scheduler** — cross-fades need
    two clips writing one property at once, which the mixer's claim semantics call a
    conflict; the controller owns one channel per path, blends via `ValueAdapter`, and
    writes once under one claim in the same §16 registry.
  - **Un-animated channels contribute the `play()` baseline** — the pose is a pure
    function of (state, time, weight); a controller pins every channel it owns.
  - **Typed predicates over the string DSL** — a parser is a second §33 surface; the
    sugar can compile to the records later. `exitTime` is seconds of source-state time
    (§7a), a gate not an instant. Interruption freezes the outgoing pose (captured
    through the same blend path). No `seek` — a machine's pose is a function of
    history; §34 replays deltas. Controllers are never `finished` and are deliberately
    not §6a components / not serialized (§18 constructs directly; `Node.animation` is
    unshipped per §97a).
- **2026-08-07 — R-6 post-processing (full-screen effect tier).** Decisions worth
  keeping:
  - **An effect is a graph pass kind, not an escape-hatch pass** — a pass whose
    sampling is a _field_ is validated exactly with no traversal; expressing §70
    through `CustomRenderPass` would be unvalidatable exactly where feedback and
    ordering mistakes live. That asymmetry, not convenience, is the argument.
  - **A second verb keeps the first byte-identical** — `renderEffect` is a separate
    entry point; `render` was not edited; the frame transcript is identical modulo a
    constant handle-serial shift of exactly 6. Routing effects through `render` would
    put a branch in the loop R-4/R-5/F13 each had to re-prove.
  - **Closed unions are the staging mechanism** — `ScreenEffect` is
    `"copy" | "grade"`; `{ kind: "bloom" }` is a compile error, and the backend skips
    an unknown kind rather than quietly copying (a JSON value must not become a
    different picture). R-14's RFC widens the union.
  - **Copy is bit-exact** (`useGrade` seeded at GL initial `0`, zero uniform traffic on
    copy chains) — what makes the blit usable as §63's debug view.
  - **Measured gotcha:** a fifth compiled-at-init pipeline costs **0.75 kB gzip in
    every example bundle** — nothing reachable from a class method tree-shakes
    (second instance of A-1's cannot-tree-shake class). Even a stubbed `renderEffect`
    exceeded ui-demo's 30 kB by 99 B, so the budget moved to 31 kB (owner-recorded
    trade; §86's 150 kB untouched). A-4's define/opt-in seam is the eventual fix.
  - `renderEffect` does **not** reset the §57 mirror — it borrows only the depth test
    and restores exactly that, strictly more conservative than `render`'s
    reset-on-entry.
- **2026-08-07 — §40 UnitSystem (A-2/PH-13).** Decisions worth keeping:
  - Shipped in `@fourjs/core` as a **conversion tier, never an engine mode**;
    `tests/integration/units-display.test.ts` mechanically forbids any package source
    outside `@fourjs/core` from importing it (visible `ALLOWED` allowlist) and proves
    helper-authored values bit-identical to engine-unit authoring.
  - `"custom"` = "the display unit _is_ the world unit" (exact identity) and has **no
    symbol** — §40's two under-specified points, decided rather than guessed.
  - **No `ApplicationOptions.units`, no `PhysicsWorldOptions.units`** — §45's record
    lists neither; adding one would be inventing API. The physics §41 envelope reading
    `lengthToMeters` is a staged `@fourjs/physics` packet.
  - The conversions are documented as **inexact** (8.8% / 2.5% last-bit divergence for
    degrees / milliseconds over 2 000 samples) — an intentional non-fix; the only safe
    answer is keeping them off simulation paths (§33–§34).
- **2026-08-07 — R-5 render graph (linear-pass tier).** Decisions worth keeping:
  - **The graph is a driver, not a backend** — one pass = one `renderer.render(root,
views, interpolation, target)`, asserted transcript-identical against hand-written
    calls. Re-prove that property after any backend restructure.
  - **Acyclicity by construction beats a topological sort** — inputs must already exist;
    insertion order is execution order (§63's own example is written in execution
    order); a sort would buy reordering nobody asked for and cost "the graph does what
    the list says". `removePass` refused while a consumer names it.
  - **Sampling is discovered, not declared** — `validate()` runs the real
    `buildRenderList` and reads `isRenderTargetTexture`, seeing what the backend sees;
    deliberately setup-time (a `map` reassignment makes any cache unsound; per-frame
    checking doubles traversal).
  - **An escape hatch must report its own opacity** — `CustomRenderPass` always emits an
    `"opaque"` info issue; a graph that stopped being checkable says so.
  - **Correction to the R-4 entry (supersede, not rewrite):** "feedback loops are
    refused, not drawn" holds for _sprites_; for `UnlitMaterial`/`LitMaterial` the
    `map` is refused but the draw survives untextured — one rule for the sample, two
    outcomes for the draw (`webgl-renderer.ts` sprite skip vs `setFeatures(false)`).
  - Clear policy stays on `Viewport` — what makes a compositing pass (no `clearColor`)
    expressible. No new duck-typed contract — the graph reuses `isRenderTargetTexture`.
- **2026-08-07 — PH-5 (runtime colliders).** Decisions worth keeping:
  - **No `node` parameter, no diffing refresh** — `Collider.requireBody()` is the single
    source of truth about which body a collider joins, shared verbatim with `addBody`'s
    subtree scan; a diffing `refreshBody(node)` would be a second rule and a per-step
    cost.
  - **`removeCollider` returns `false`; `addCollider` throws** — removal follows
    `removeBody`/`removeJoint` (unconditional teardown paths); `refreshCollider` throws
    because a silent no-op refresh is invisible. Contrast documented in the methods.
  - **`derivedMass` clears only at zero colliders**, never on a non-positive reported
    mass — §23 forbids reading a solver's 0 as "no mass" (non-dynamic bodies answer 0).
    `setRigidBodyDerivedMass` takes `number | undefined` (package-internal).
  - **The adapters and §34 needed nothing**: F8's kept mass refresh was written for the
    body-survives case, PH-3's heir logic holds, and F8's re-derivation of `colliderIds`
    from the envelope's collider table makes a runtime add snapshot-safe for free —
    proven, not assumed.
- **2026-08-07 — PH-1 stage 2 (live solver writes).** Decisions worth keeping:
  - **A third optional seam, detected structurally, not a seventh capability field** —
    `supportsSolverBodyTuning` is **all-or-nothing** across six methods (per-property
    bits would push a warn table into `RigidBody`). `PhysicsTuningCapabilities` still
    answers "which coefficients apply"; the new predicate answers "can anything change
    after `createBody`".
  - **The dirty set is a bit set, one bit per solver call** (§23's triple one bit, the
    damping pair one). `0` keeps the goldens still — a quiet world makes no extra call,
    proven by deep-equalling adapter `callOrder` with and without the seam.
  - **Draining clears** — a body in two worlds hands writes to whichever steps first
    (§26 command-buffer semantics), chosen over per-world dirty sets.
  - **Colliders cannot be intercepted** (§24/§25 plain public fields) → `refreshCollider`
    is explicit by design; the alternative was shadow-copying six values per collider
    and diffing every step.
  - **`mass = undefined` is permanently unreachable, not staged** — un-authoring means
    restoring collider densities only the registration path holds.
  - **Rapier's live mass write re-runs `resolveMassMode`** and rewrites
    `BodyRecord.massMode`, so live writes and re-registration converge and PH-3's heir
    logic keeps working.
  - **Gotcha:** vitest transpiles without typechecking — a changed package-internal
    signature passes unit suites and only fails at `pnpm run docs`/`tsc`; run the docs
    gate after touching any cross-file signature.
- **2026-08-07 — A-1 §84 statistics.** Decisions worth keeping:
  - **`NaN` means "not measured", `0` means "measured zero"** — the rule that let §84
    ship before all its producers; staged counters are test-asserted to stay `NaN` so
    none can quietly start reading 0.
  - **Presence is the capability**: `Renderer.statistics` is optional; a backend that
    cannot count omits the member instead of reporting zeros. **Backends accumulate,
    owners clear** — a frame may be several `render` calls (off-screen + on-screen), so
    totals only work if the backend never resets.
  - `Date.now` is banned repo-wide (§33) → `createMonotonicClock` has **no fallback**; a
    wall clock in diagnostics is not a §33 violation because nothing there feeds a
    simulation. `FrameStats.simulationTime` is a **duration** (seconds inside the
    frame's fixed steps), not §9's clock — one name, two quantities, settled by §84's
    neighbouring fields.
  - The renderer-counter transcription (`RenderStatisticsLike`) is the **fifth**
    duck-typed contract; a `@fourjs/render` test pins the real type against it.
  - **Gotcha:** `four/application`'s runtime import of `@fourjs/diagnostics` costs
    ~0.4 kB gzip per example even with stats off — the first diagnostic that cannot
    tree-shake; concrete motivation for A-4's `__FOUR_DEV__` define.
- **2026-08-07 — R-4 render targets.** Decisions worth keeping:
  - **A render target is a CPU-side descriptor; the framebuffer is a backend cache** —
    third instance of the `GeometryCache`/`TextureCache` pattern, and why §61's
    `createRenderTarget` stays deferred _by decision_: a renderer-owned target cannot
    exist before a renderer and must be hand-rebuilt after context loss. Loss
    re-allocates lazily; the application is told nothing.
  - **The render-to-texture seam is `MaterialTexture`, not a new type** —
    `RenderTarget.colorTexture` satisfies it, so R-5/R-6 inherit zero adapter work and
    `@fourjs/materials` needed no widening. Backends distinguish via the marker guard
    `isRenderTargetTexture` (4th duck-typed contract).
  - **Target depth defaults `true`** — a depth-less target would composite the same
    scene differently off-screen than on, the exact difference render-to-texture exists
    to avoid.
  - **`bindFramebuffer` belongs inside the F13 envelope** — an FBO left bound by a
    throwing frame sends every later on-screen frame into a surface nobody sees;
    `effectiveGlState` now folds framebuffer binds so all exception-safety tests assert
    it. The byte-identical-sequence property survived a second structural change
    (no-target frames issue _no_ framebuffer call, not even an unbind).
  - **Feedback loops are refused, not drawn** — a material sampling the target currently
    rendered into is skipped like a disposed texture; ping-pong is the supported form.
- **2026-08-07 — A-12 cheap tier (six §73 controls).** Decisions worth keeping:
  - **Radio groups are names scoped to the tree** (the `focusedWidget` scope — one notion
    of "the tree we're in"), enforced **on the transition to checked only**, never at
    construction or attach — §79 documents reload exactly as saved (two radios authored
    `checked: true` stay both-checked until one is re-checked; tested and documented).
    Group-by-parent was rejected because wrapping radios in a layout `Panel` would
    silently dissolve the group.
  - **`Slider` owns its pointer math** (`worldPoint` + inverse world matrix), not
    `DragManager` — §42: the slider's transform is layout-owned; what moves is a number.
    Drag-past-the-track is staged on A-9's captured-pointer `worldPoint: null` decision.
    `resolveValue` is clamp → snap → step-back-if-over-max (the `<input type=range>`
    rule: a step that doesn't divide the range leaves the top unreachable).
  - Checkedness is §75 _state_ on `WidgetStateSnapshot` (`checked: boolean | null`,
    ARIA's absent-vs-false); values flow through `uivaluechange` + the new
    `onContentChange` skin hook — neither layout nor state.
  - `ImageWidget` carries the suffix because `Image` is a browser global that
    `import { Image } from "@fourjs/ui"` would shadow exactly where pictures load.
  - Menu/tooltip staged honestly: a hover delay is a §9 time reading, and the §10 loop
    that owns time lives above `@fourjs/ui` — a tooltip built today would invent a clock.
- **2026-08-07 — R-35 + F7 (diagnostics).** Decisions worth keeping:
  - `diagnostics → geometry` re-confirmed **absent** from the frozen §3.1 matrix; R-35
    closed by emitting `Float32Array`s whose field names (`positions`, `colors`) spread
    straight into `BufferGeometryOptions` — third instance of the duck-typed-contract
    pattern (`ParticleDrawable`, `ReplayTarget`, `DebugGeometrySink`).
  - `debugDrawStreams` deliberately does **not** copy `DebugDrawBuffer`'s
    grow-never-shrink policy: §85 index alignment makes an oversized colour array
    _illegal_, not merely wasteful. The `colors = undefined` → `positions` → `colors`
    assignment order in `applyDebugDrawStreams` is required by `BufferGeometry`'s
    validate-against-current-attributes rule — a shrinking overlay throws in any other
    order.
  - **A version constant that names a bound must say so** (F7): `REPLAY_FORMAT_VERSION`'s
    name silently became false on 2026-08-06 when PH-6 introduced the lowest-version
    rule; renamed `LATEST_`/`MINIMUM_` with a deprecated alias, and existing documents'
    byte-identity is now asserted by a test rather than assumed.
- **2026-08-07 — Render-tier review fixes (F13–F16).** Decisions worth keeping:
  - **F14 policy: validated accessors, unchanged version semantics.** `opacity`/
    `blendMode` are accessors applying the constructor's validation on every write; the
    four boolean §57 fields stay plain (no invalid values). Neither bumps `version` —
    R-12's "render state is read per draw, never cached" stands, and bumping would
    invalidate the geometry/texture bindings that _are_ cached on that counter.
  - **F13 audit: only `glState` was both module-global and frame-scoped** — now
    per-`WebglRenderer`, with the frame in `try`/`finally`. The R-19 program-lifetime
    mirrors (`useMap`/`useVertexColors`/sampler, seeded at GL initial `0`) were audited
    and deliberately left alone — they belong to the program object and survive a throw
    correctly; the byte-identical-sequence property was re-proved (449-call comparison).
  - **Follow-up not taken:** `renderList`/`viewProjection`/`sceneLights`/`rect` remain
    module-global _scratch_ (fully written before read, safe while `render` is
    synchronous and non-re-entrant); a re-entrant `render` would corrupt them
    independently of F13.
  - **Gotcha (multi-agent): the Playwright browser gate is not concurrency-safe** — seven
    fixed-port `vite preview` servers with `reuseExistingServer: false`; two agents
    running `test:browser` kill each other's servers (`ERR_CONNECTION_REFUSED` that looks
    like regressions). Check ports 4173–4179; re-run cut-off specs by path.
- **2026-08-07 — first-3d-scene (S-8 half-closure).** Decisions worth keeping:
  - **A perspective claim must be measured in pixels**: two spheres sharing a geometry
    _instance_ and a material _instance_ at 5.0 m / 10.2 m give a 4.04× area ratio; an
    orthographic camera gives exactly 1.0. A `data-camera` page attribute is context, not
    evidence.
  - **Hue classifiers need every channel pair pinned** — `blue − red` alone let lit green
    `(86,255,143)` pass as violet (5 287 capsule pixels misattributed, measured). The
    palette is stated as byte values in both the example and its spec.
  - **Ergonomics gaps observed, no engine change made**: no `lookAt` on `Node`/`Camera`
    (aiming camera and light is hand-composed quaternions — §44 camera rigs still
    unshipped, roughest edge of the first 3D scene); the 3D primitives' segment-option
    names are inconsistent across the family (`widthSegments`/`tubularSegments`/
    `capSegments`) — candidates for a future naming pass.
  - Gotcha: `vite preview --strictPort` servers survive an interrupted Playwright run —
    kill `vite.js preview` processes before re-running `pnpm test:browser`.
- **2026-08-07 — Closure-review fix batch (24 findings).** Decisions worth keeping:
  - **`KinematicController`'s §79 payload is deliberately empty** (`{}`): no constructor
    options; in-flight commands are simulation state; `followPath` holds a live
    `Trajectory` no document can reference. **Registry completeness is enforced
    mechanically** — `packages/fourjs/tests/scene-serializers.test.ts` enumerates every
    umbrella barrel class carrying `static typeName` (currently `collider,
kinematic-controller, motion, pose-target, rigid-body`) and requires each registered;
    a sixth component fails the suite until registered.
  - **`PhysicsWorld.#destroyRegistration` issues one `destroyBody`** (§37: "destroys a
    body and everything attached to it"), teardown-path-only; adapters keep
    `destroyCollider`'s mass refresh for the body-survives case, and Rapier `BodyRecord`s
    carry `colliderIds` so heir lookup is O(1). The §34 snapshot envelope still writes a
    collider _count_ (format-2 layout pinned); restore re-derives the id list from the
    collider table.
  - `RigidBodyDocument.sleeping` stays write-only diagnostics, now optional on the read
    side — dropping it would move every document's bytes for no reader.
  - The §25 unhonoured-material warning stays registration-time-only, documented in the
    method; moving it belongs to the packet that widens §37 for live material changes.
  - `worldDrivenTypeWrite` is a process-global suppression, safe only while the `type`
    setter runs no callbacks — a setter that gains one must carry its own suppression
    token (hazard paragraph added in place).
  - `wrap: false` traversal exits cost two keystrokes (blur, then pass-through) — the
    one-shot `exited` flag is forgotten by any programmatic focus.
- **2026-08-07 — A-23 (§96 untrusted content).** Decisions worth keeping:
  - **A signal cannot cross the `FetchLike` seam today — measured, not assumed.** Widening
    to `(url, init?: { signal?: AbortSignalLike })` breaks `typeof fetch` assignability
    (contravariant parameters; `RequestInit.signal` is `AbortSignal | null`, and a
    structural stand-in is missing `onabort`/`reason`/`throwIfAborted`/`dispatchEvent`).
    The compatible widening is generic — `FetchLike<TSignal = never>` plus an injected
    `() => { signal: TSignal; abort(): void }` — recorded in `asset-manager.ts` as A-18's
    remaining half. `FetchResponse` **property** widening is safe
    (`headers?: ResponseHeadersLike`) and is how the `content-length` pre-check got in.
  - **§96 guards belong at the text boundary (`decode*`), never at `validate*`** — the
    validators take values the process itself built, so guarding them refuses nothing an
    attacker controls and would bound the recorder's own output. This is what kept every
    golden byte-identical.
  - **Any depth checker must be iterative** — a recursive one overflows on precisely the
    input it guards (proven: the unguarded validators stack-overflow at 50 000 nesting
    generations while `JSON.parse` succeeds).
  - **A limit defaulting to `Infinity` is documentation, not a limit** — all four defaults
    are finite (64 MiB / 30 s / 32 Mi code units / 1024 levels);
    `Number.POSITIVE_INFINITY` is the explicit in-source opt-out.
  - New §89 code `UNTRUSTED_INPUT_REJECTED` ("hostile input") vs the validators'
    `TypeError` ("malformed input"); asset refusals stay `ASSET_LOAD_FAILED`; all carry
    `context.limitName`/`.limit`.
  - **The CSP claim is enforced, not asserted** (`tests/integration/security-csp.test.ts`,
    self-testing matchers) — per the 2026-08-05 doc-truth rule. A package that needs
    `eval` changes the guide first.
- **2026-08-07 — R-19/R-20 (render keystones).** Decisions worth keeping:
  - **Textured meshes are a uniform switch, not shader variants** (`useMap`/
    `useVertexColors` on the one unlit/lit program each): the CPU-mirrored default at GL's
    initial `0` is what keeps an untextured scene's GL sequence byte-identical, which is
    what let R-19 land under the pixel-golden gate. Fixed attribute locations: 0 position,
    1 normal, **2 uv, 3 colour**; `MAP_TEXTURE_UNIT = 0` shared with the sprite pipeline.
  - The material texture contract is `MaterialTexture` (`@fourjs/materials`, `texture.ts`);
    `SpriteTexture` is an alias of it — published name kept, `@fourjs/render`'s `Texture`
    untouched.
  - `extrudeGeometry` **rejects concave outlines when capped** (centroid-fan caps); §52's
    tessellation module lifts the restriction. `tubeGeometry` uses parallel transport, not
    Frenet. `capsuleGeometry.height` measures the cylindrical section only, matching §24's
    capsule collider.
  - Sprite's derived-uv path deliberately not rewritten — identical mapping makes a
    rewrite unfalsifiable by the goldens; §55's atlas packet owns it (dated note in
    `sprite.ts`).
  - Gotcha (repeat offender): **never `git stash` in the shared worktree** — the keystone
    agent's baseline-comparison stash swept another agent's in-flight files for ~9 minutes
    (restored and verified, nothing lost). Same lesson as the rebase incident.
- **2026-08-07 — A-25: §94 machinery built, publish owner-gated.** Changesets config
  hand-authored (no `changeset init`, no lockfile change); `release.yml` calls `ci.yml`
  via a new `workflow_call` trigger so a release clears exactly the PR gates; publish is
  inert without `NPM_TOKEN`. Two standing facts discovered:
  - **The §98 rename must include emitted code.** `dist/*.js` and `.d.ts` carry
    `from "@fourjs/core"` — renaming only manifests would publish 24 mutually-unresolvable
    packages. `apply-publish-names.mjs` rewrites quoted workspace specifiers in staged
    code (405 sites), resolves `workspace:` ranges, and publishes from the staging tree so
    the checkout is never renamed.
  - **The five reserved stubs cannot be Changesets-`ignore`d** while `four` depends on and
    re-exports them (validation error reproduced). `ignore: []` until the owner decides
    the packaging question (publish stubs / drop subpaths / optional peers).
- **2026-08-07 — A-26 closed: §90 compatibility tables.** `docs/COMPATIBILITY.md` carries
  the five tables. The solver-adapter section is **generated** between
  `<!-- BEGIN/END GENERATED: solver-adapters -->` markers by
  `tools/generate-compatibility.mjs` from live `PhysicsCapabilities` instances — never
  hand-edit it. The generator imports the built `dist/` (deliberate: a source parse would
  re-implement a const evaluator) and pads tables exactly as Prettier does, so `--check`
  and `prettier --check` agree — changing one convention without the other breaks the gate.
  The Rapier snapshot envelope version (2) is module-private and therefore hand-cited in
  the format section, not generated — the one number there that can drift.
- **2026-08-07 — Gotcha (concurrent agents + rebase): `git rebase` with autostash while
  agents hold uncommitted work wiped their in-flight files** (autostash carries tracked
  edits but the reset window still clobbered untracked files mid-write; the A-26 agent had
  to rebuild from a scratchpad backup). When the remote moves during a multi-agent wave,
  prefer: let agents finish → commit their batches → rebase once, or snapshot untracked
  work first.
- **2026-08-07 — GAP-CLOSURE WAVE 2: keyboard tier (A-10 done, A-13 keyboard half).**
  `KeyboardInput` in `@fourjs/input`, traversal + activation in `@fourjs/ui`. Decisions:
  - **Focus crosses `ui → input` as an injected resolver** — `KeyboardInput(surface,
{ focusTarget: () => Node | null })`. `@fourjs/ui` supplies `keyboardFocusTarget(root)`;
    `@fourjs/input` never imports it. §3.1 stays frozen; a `null` answer dispatches nothing
    (the analogue of a pointer that hit nothing).
  - **Three-phase dispatch is shared machinery** (`packages/input/src/propagation.ts`):
    `SceneInputEvent` base + `dispatchThreePhase(event, path, type, captureKey)`. The two
    listener keys are _arguments_ typed against `NodeEventMap` — no `"capture:" + type`
    string concatenation, no cast. `dispatchPointerEvent` delegates to it; its public
    surface (and `ScenePointerEvent`'s members) is unchanged.
  - **`SceneKeyEvent.preventDefault()` forwards to the platform event** through an optional
    `KeyDefaultSuppressor` — default-suppression (Tab/Space mean something to the host) is
    deliberately separate from `stopPropagation`.
  - **Traversal sorts `accessibility.tabIndex` plainly ascending** (ties by scene order,
    stable sort; negative opts out of traversal but stays programmatically focusable) —
    deliberately _not_ the DOM's positive-before-zero rule, which exists only because HTML
    interleaves with a document order it cannot see. `tabIndex: 0,1,2` means what an author
    intends.
  - **Enter/Space live on `Button`; Tab lives on the tree** (the DOM's split). Both
    activation keys fire on `keydown` — the DOM's Enter-down/Space-up asymmetry is a stated,
    deliberate simplification. `WidgetActivationSource` is an open union; adding
    `"keyboard"` was additive.
  - `keypress` is deliberately unimplemented (documented in `key-events.ts`); wheel, gamepad,
    XR, and focus/blur-as-input-events are recorded in `packages/input/README.md`.
- **2026-08-06 — GAP-CLOSURE WAVE 1 (A-7, A-9, A-14/PH-17 partial, A-15, A-17, PH-6).**
  Six `docs/GAP ANALYSIS v0.md` items closed, each with regression tests. Decisions worth
  keeping:
  - **A-9 (`PointerInput` leak).** Per-pointer state is now deleted on `pointerup` _and_ on
    the new `pointercancel`; `pointercancel` joined `PropagatingPointerEventType` (and
    `DragManager` ends a drag on it). **Known behaviour change:** because
    `SurfacePointerEvent` carries no `pointerType`, a mouse release now also fires
    `pointerleave` and the next move re-fires `pointerenter`. That is right for touch/pen
    (the contact ceased to exist) and a regression for the mouse; retaining a mouse's hover
    needs `pointerType` on that structural interface and is left to the packet that widens
    it. `PointerInput.trackedPointerCount` was added so the leak stays testable.
  - **A-15 (silent component drop on save).** `Node.components` forwards §6a's registry;
    `serializeComponents` walks the node and emits in _registry_ order, so output ordering —
    and therefore every byte-identical golden — is unchanged. Unserializable components now
    throw `INVALID_APPLICATION_STATE`; `SerializeSceneOptions.unknownComponents: "skip"`
    mirrors the read side.
  - **A-17 (id collisions).** `NodeOptions.id` restores an id at construction and _reserves_
    it against the module counter; `restoreNodeId` moved from `@fourjs/serialization` (where it
    cast a foreign class's `readonly` field) into `@fourjs/scene`, which owns the field, for the
    `nodeFactory` path that cannot use the constructor. `instantiateScene` refuses a document
    that produces one id twice with `INVALID_SCENE_GRAPH`.
  - **§79 node data (enabling change for A-14).** `SceneNodeDocument.data` + the
    `SerializeSceneOptions.nodeDataOf` writer carry one opaque JSON value per node — the seam
    A-16 records as missing, and the only place a widget's box model could go without
    polluting §6's user `metadata`. Absent unless a writer produces one, so every document
    written before it encodes byte for byte as before; `SCENE_FORMAT_VERSION` is unmoved.
  - **A-14/PH-17 (partial).** `MOTION_COMPONENT_SERIALIZER` ships from `@fourjs/motion` against
    a structural `ComponentSerializerShape` (no new §3.1 edge, the `ParticleDrawable` pattern);
    `registerSceneNodeTypes()` / `registerUISerializers()` ship from the umbrella `four`
    package, which is the only place allowed to see `ui` + `serialization`. **`RigidBody` and
    `Collider` serializers are the follow-up** — they belong in `@fourjs/physics`, which this
    change could not touch.
  - **PH-6 (§34 world configuration).** `ReplayRecording.worldConfiguration` carries §34's
    "solver settings", captured off `ReplaySnapshot.configuration` at `begin` and re-attached
    by `ReplayPlayer.#snapshotAt`, so `PhysicsWorld.restoreSnapshot`'s field-by-field refusal
    finally fires on the replay path. **Versioning rule: a document declares the lowest
    version that can express its content** — `2` with a configuration, `1` without — so
    `REPLAY_FORMAT_VERSION` is 2, `SUPPORTED_REPLAY_FORMAT_VERSIONS` is `[1, 2]`, and every
    existing version-1 recording still validates _and re-encodes byte for byte_.
  - **The phase-10 golden was amended, envelope only, with proof.** `recordingDigest`
    2642391973 → 1754656889 and `recordingLength` 46822 → 47008 (+186 bytes); _nothing else
    moved_ — `initialSnapshotDigest`, both checksum-stream digests, `seekTailDigest`, the
    first/last/final checksums and every contact count are bit-identical to the 2026-08-02
    record. The claim was proved, not assumed: re-running the scenario with the capture
    neutralized (a wrapper dropping `ReplaySnapshot.configuration`) reproduces the old digest
    and length exactly. The golden carries that proof in a new `_amended` field, and gained
    `formatVersion` / `worldConfigurationKeys` so the §34 configuration is now pinned too.
  - **`Application.resize(width, height, resolution?)` (A-7).** Records the size, forwards to
    `renderer.resize`, and updates the `aspect` + projection of perspective cameras on
    _full-surface_ viewports only (`normalized` `(0,0,1,1)`) — §61 says the aspect is the
    application's to set and this class is the only thing that knows the viewport→camera
    mapping. `ApplicationOptions` gained `width`/`height`/`resolution` and a `depthRange`
    (D8) for the projection rebuild. Orthographic extents and partial viewports are left
    alone, deliberately.

- **2026-08-05 — DOC-TRUTH GATE (`tools/check-docs.mjs`, `pnpm check-docs`, wired into CI
  next to `check-spec`).** A sweep found prose claims that were false when written and
  survived for months, because prose has no type checker: `ROADMAP.md` still said "nothing
  on this roadmap has shipped yet" three days after the plan closed; `README.md` said
  "42/43 … lighting is the single staged absence" after lighting shipped;
  `docs/AUDIT-120.md` claimed "10 example applications" when six exist (the other six
  `examples/*` directories hold a `.gitkeep` — now staged as **S-8**), called
  `tests/visual/` "an empty placeholder" after a golden suite landed there, and called
  sprites "batched" when the WebGL backend draws one per draw call;
  `playwright.config.ts` said "There are no golden images" after the `visual` project
  landed; `materials-and-render-graph.md` described a sort by "layer, then kind, then
  material" that `compareRenderItems` has never implemented (it is `renderLayer` then
  `renderOrder`, stable-sorted); `custom-shaders.md` said "three" internal GL programs
  after `LitProgram` made it four. **Standing rules from this:** (1) any count in prose
  that the filesystem can decide must be pinned mechanically — check-docs compares
  AUDIT-120's example count against `git ls-files`; (2) a doc may name an empty
  `examples/*` directory only in a block that also carries the marker "not yet written;
  directory is a placeholder"; (3) corrections are **dated in place**, quoting the
  superseded wording, and check-docs re-reads those quotes to require a nearby date, so
  the house style is enforced rather than merely recommended; (4) documents whose subject
  _is_ the false claims (`docs/GAP ANALYSIS v0.md`, `docs/SPEC-REVIEW.md`) are excluded by
  name in `QUOTES_DEFECTS` — a gate must not fire on the report that found the defect.
  Also recorded: `benchmarks/README.md`'s §86 table now separates rows blocked by
  **hardware** (need a GPU) from rows blocked by a missing **feature** (no sprite
  batching, no instancing outside particles, no shape system, per-glyph textures) —
  reading "needs a GPU" across all of them had been hiding four unbuilt features.

- **2026-08-04 — LIGHTING MVP SHIPPED (owner-directed; §120 now 43/43 shipped-or-MVP —
  AUDIT-120 amended).** Tier: ONE directional light, Lambert diffuse + scene ambient,
  nothing else — §68's smallest honest slice. Standing decisions: `DirectionalLight`
  lives in `@fourjs/scene` (mirrors the rev-1.3 cameras placement; a light is a node),
  shines along its node's **−Z world axis** (camera look convention; direction read via
  `getWorldDirection(out)`, resolve-on-demand like `Camera.updateViewMatrix`; degenerate
  scale → zero vector → lights nothing); §68's "ambient" is `Scene.ambientLight`, a
  scene-wide RGB term (default black), NOT an AmbientLight node (dated staging note in
  light.ts); light discovery in `@fourjs/render` (`collectSceneLights`) is **duck-typed**
  (`isDirectionalLight` brand + ambient duck-read off the root) even though the
  render→scene edge exists — `instanceof` would be unfakeable in render-webgl's
  doubles-only tests; unlike the particle contract, drift IS type-pinned (render's tests
  assign the real classes to the contracts). First light in scene-graph DFS order wins
  (§33-deterministic); light collection runs only for frames whose list contains a lit
  item; lights are NOT §43-interpolated (same trade as particle positions, dated).
  Materials: `LitMaterial` mirrors `UnlitMaterial` member-for-member (color-only, §60a
  no-color-space/no-clamp stance); both carry a NEW `readonly kind` discriminant
  ("unlit"/"lit") — the render list picks the pipeline from `material.kind` with an
  "unlit" fallback, no instanceof (SpriteMaterial gets a kind only when it joins a
  discriminated union). NOTE: §57's family list has no LitMaterial — spec-revisit item
  in TODO. Geometry: optional `normals` attribute on BufferGeometry (index-aligned,
  finite-validated, unit length is the author's contract); `boxGeometry` went 8→24
  vertices (per-face normals — same 12 triangles, unlit rendering identical);
  `planeGeometry` +Z normals; circle/2D stay position-only (unlit tier). WebGL:
  `NORMAL_ATTRIBUTE_LOCATION = 1` (VAO-scoped, no clash with particle instance slots);
  fourth program `LitProgram` (uniforms viewProjection/model/color + vec3
  ambientLight/lightDirection/lightColor; lightColor premultiplied by intensity CPU-side
  — black when no light, so one shader, no variants); normal matrix =
  `transpose(inverse(mat3(model)))` **in the vertex shader** (GLSL ES 3.00 builtins;
  hoist-to-uniform staged until math has a Matrix3 utility); fragment guards zero-length
  normals → a normal-less geometry under LitMaterial shades ambient-only (never NaN);
  lit runs are opaque (blend disabled on switch, mirroring unlit); `uniform3fv` added to
  the GL seam (now 34 methods) and to REQUIRED_CONTEXT_METHODS (fail-fast, not
  discriminating). Unlit path byte-identical: a scene with no lit items issues the same
  GL sequence as before (only init/restore gain the fourth program build); all 32
  browser specs + pixel goldens pass unchanged. Exit numbers (worktree; merged-tree
  verification below): coverage geometry/materials 100%, scene 99.66 (light.ts 100),
  render 99.63 (lights.ts 97.36 — two defensive branches), render-webgl 99.5
  (gl-program/gl-geometry 100); §86 gate 33.28/150 kB (+1.13 kB, genuine). Merged with
  the same-day backlog burn-down: 3,077 unit + 174 suite + 38 browser/visual tests,
  TypeDoc 0 warnings (the packet's two new private-symbol `{@link}`s were demoted to
  backticks pre-merge). Staged with dated notes
  (2026-08-04): point/spot/hemisphere/area + multi-light (uniform arrays / §68 clustered
  path), shadows §69 (castShadow deliberately NOT accepted-and-ignored), §59
  StandardMaterial/PBR, §60a color strings + tone mapping, light layers, per-material
  specular/emissive/maps.
- **2026-08-04 (backlog burn-down, owner-directed "implement all your suggestions and
  more").** Landed in one batch: (1) **README truth** — all 24 package READMEs rewritten
  against `package-export-surfaces.json` (the five placeholder packages honestly say
  "interface reserved; not yet implemented"); root README rewritten with the §93
  quick-start (every identifier verified against the real API). (2) **De-flake** —
  blending RECOVER's sweep clock now starts BEFORE the click (the old placement started
  it after a SwiftShader screenshot that could eat 500+ ms of the 1.5 s sweep — the
  recorded 1-in-3 fail); collapse wait → `expect.poll`; 3/3 local runs green.
  (3) **UI browser proof** (closes the WP-11.5 shortfall) — `examples/ui-demo` (panel/
  buttons/labels, app-supplied WidgetSkins, §72 pointer + staged-seam keyboard hosting,
  25 kB gzip) + `tests/browser/ui.spec.ts` (4 tests, sixth webServer, port 4178);
  `.size-limit.json` gains particles-demo (19.36/25 kB) and ui-demo (25/30 kB).
  (4) **§92 visual category seeded** — `tests/visual/ui-demo.spec.ts`, a second
  Playwright project (`visual`), committed SwiftShader-to-SwiftShader pixel goldens
  (the browser suite's "no goldens" doctrine is about SwiftShader-vs-GPU and does not
  apply; animated sites need a deterministic stepping hook first — recorded next step).
  (5) **Node.position/rotation/scale alias getters** (the §15/§97 idiom; getter-only,
  returns the LIVE transform members so change-hooks fire; WP-3.1 flag resolved).
  (6) **getBodyCenterOfMass** on SolverBodyAccess (+ both Rapier adapters via
  `worldCom()`, fakes, scripted adapters) and **collectCentersOfMass** in diagnostics —
  the center-of-mass DEBUG_DRAW_STAGED entry is unstaged; all seven debug providers now
  run against LIVE Rapier (replay rig runs origins/velocities/COM/impulses per step;
  the jointed pendulum asserts solverJointStatistics) — the "fakes only" verifier note
  is closed. (7) **§28 solverIterations** world option → Rapier
  `World.numSolverIterations` (proven behaviourally: 1 vs 4 diverge on a stack;
  explicit 4 bit-identical to omitted, so recorded checksums stand). (8) **§31
  ccdPredictionDistance** descriptor field replaces the WP-5.4 pinned 1 m constant
  (proven at the boundary: 0.001 m tunnels a thin wall at 200 m/s, 10 m catches it;
  contradiction with a non-speculative resolved mode is refused). (9) **§34
  world-configuration refusal** — PhysicsSnapshot gains optional
  `PhysicsSnapshotConfiguration` (dimension, resolved gravity, resolved sleeping,
  determinism, solverIterations-if-set); restore refuses field-by-field when present;
  absent = pre-existing envelopes and §34 replay documents (which record adapter
  identity only) restore exactly as before. Gotcha: the visual goldens live in
  `tests/visual/*-snapshots/` and refresh with
  `npx playwright test --project visual --update-snapshots` — review the diff first.
- **2026-08-04 (later) — ZERO-FINDINGS SWEEP (owner-directed: "resolve all issues the
  tools report; defer nothing"): all 5 baselined duplicates consolidated, both type-only
  cycles broken, all 21 unused exports resolved; every docs/Architecture report is now 0
  and duplicate-baseline.json is empty.** Standing homes: `SeededRandom` →
  `@fourjs/core/src/random.ts` (WP-8.2 original verbatim; motion/particles re-export;
  streams bit-identical, motion's known-answer suite moved to core, particles'
  BigInt-oracle suite still pins stream identity); `JsonValue`+`cloneJsonValue` →
  `core/src/json.ts` carrying serialization's `__proto__` refusal — this is the "owner
  decision" the serialization module note was waiting on, and it CHANGES diagnostics
  behavior: a payload with a `__proto__` own key is now refused with TypeError instead of
  silently re-parenting the copy; `DEFAULT_GRAVITY_Y` → `core/src/conventions.ts`;
  `ColorRGBA` → `math/src/color.ts`. Cycle breaks: scene's `warnAuthorityConflict` takes
  structural `AuthorityNode` (exported from the barrel; every Node satisfies it);
  physics' `RigidBodyCollisionEvent` lives in `collider.ts` and the three §29 collision
  keys merge into `RigidBodyEventMap` via `declare module "./rigid-body.js"` declaration
  merging (the @fourjs/input→NodeEventMap pattern) — public surface unchanged, but the
  type's DECLARING file moved (deep-importers of `../src/rigid-body.js` must use
  `../src/collider.js`). physics-rapier's 21 transcribed-subset interfaces are no longer
  exported (in-file type contracts only). Gotchas: (1) the interface-merging
  augmentation must NOT carry a doc comment — TypeDoc emits "multiple declarations with
  a comment" once per package that re-exports the map (12 warnings); (2) typedoc
  baseline is now 123 warnings (was 125). Verified: 24/24 build, 2,985 unit, coverage
  ≥95% everywhere (core 99.01 with new json.test.ts at 100%), suites 174, browser 32,
  size 32.13 kB unchanged, all four graph gates + check-spec green.
- **2026-08-04 — Dependency-graph tooling (CDG/QDG) fully integrated; duplicate-symbol
  gate wired.** Context (2026-08-03, recorded in CHANGELOG but not here until now): the
  MathTS dependency-graph tools were vendored under `tools/` — `pnpm graph` (CDG full
  parse → committed `docs/Architecture/`), `pnpm graph:query`/`graph:check`/`graph:test`
  (QDG), with `graph:check` a CI gate (no `node:` builtin may reach a browser-facing `.`
  entry; 24/24 pass); turbo was replaced by `pnpm -r --workspace-concurrency=4` the same
  day; the vendored tool **code** is eslint-ignored and kept byte-identical with
  `llm-wiki/tools/`. Today's decision closes the last gap: `pnpm graph:duplicates`
  (CDG's `check-duplicates.mjs --no-regen`, reading the report `pnpm graph` regenerates)
  joins the CI architecture-invariants step and fails on any TRUE_DUPLICATE symbol name
  beyond `docs/Architecture/duplicate-baseline.json`. Split applied: **allowlist** (=
  legitimately independent forever, per-repo _data_ exempt from the byte-identity rule) got
  per-package `PACKAGE_NAME` and `PARTICLE_INSTANCE_FLOATS` (deliberate duck-typed
  contract, matrix forbids the particles↔render edge — Phase 9 entry below); **baseline**
  (= accepted shrinking backlog, re-seed via `gen-duplicate-baseline.mjs` after
  consolidating) holds `cloneJsonValue`, `JsonValue`, `DEFAULT_GRAVITY_Y`, `SeededRandom`
  (the dated hoist-to-core item), `ColorRGBA`. Gotcha: `duplicate-allowlist.json` is
  hand-formatted — do not round-trip it through `JSON.stringify` (rewraps 500+ lines);
  append entries textually.
- **2026-08-02 — PHASE 11 CLOSED — THE IMPLEMENTATION PLAN IS COMPLETE (final exit
  GREEN; §113a exit TRUE: saved, reloaded, benchmarked; §120 complete at 42/43
  shipped-or-MVP with lighting the single dated staged absence — a traceable
  scheduling gap, never assigned to any phase).** Five packets. Key surfaces:
  @fourjs/serialization (SceneDocument v1, canonical validation, ComponentSerializer
  registry keyed by component CLASS, §80 migrations; byte-identical round trips;
  known boundaries as of Phase 11 — unregistered components silently unsaved, restored
  ids can collide with the live counter — **both closed 2026-08-06, see the A-15/A-17
  entry above**); @fourjs/assets (AssetManager with coalescing
  refcounted cache, ImageAsset disposal wrapper; glTF staged — needs §55 textures +
  non-unlit materials); @fourjs/ui (WidgetSkin seam: layout/state owned, visuals
  app-supplied per the matrix; flex/stack/absolute layout; a11y mirror + keyboard
  staged); benchmarks harness + five suites with committed records (findings:
  contacts+events = ~88% of a physics step; clean scene pass only ~3× cheaper than
  full recompute; recursion-limited scene depth ~8k); docs/AUDIT-120.md. THE §79/§34
  BOUNDARY (WP-11.5): a contact-free save round-trips BIT-IDENTICALLY for 200
  further steps; an in-contact save diverges only through solver warm-start state —
  §34 snapshots carry that, §79 documents don't. Reference RigidBody/Collider
  serializers live in tests/integration/helpers/roundtrip-scenarios.ts. Whole-plan
  audit: all 13 phase sections (§103–§113a) decomposed, dispatched, closed, dated;
  8 goldens 1:1 with determinism specs; §94 release workflow correctly owner-gated.
  Final numbers: **2,971 unit / 172 suite / 32 browser tests; 24/24 build; coverage
  ≥95% everywhere (Phase 11 packages 100%); §86 at 32.13/150 kB; docs 0 errors.**
  Remaining backlog (priority order, verifier G-list): package README sweep (all 24
  say "scaffold only"); UI browser proof (WP-11.5 substituted a node-level §72
  assertion — the one packet-intent shortfall); lighting packet (owner tier
  decision); de-flake blending.spec.ts RECOVER (1 hard fail in 3 full runs,
  retries: 0 — Phase 7 wall-clock thresholds under SwiftShader); §93 quick-start +
  prose guides (the guide half is thin — examples + doc-comments today); gotcha:
  `pnpm size` is a pnpm builtin like `pnpm docs` — always `pnpm run size`.
- **2026-08-02 — PHASE 10 CLOSED (exit GREEN, zero defects; §113 exit sentence TRUE:
  record → bit-identical replay (240/240 checksums; stepChecksumDigest ===
  replayChecksumDigest pinned in golden/phase10.json) → snapshot-seek (cost ≤
  interval−1) → frame-by-frame inspection reading contact geometry at the exact
  recorded steps → exact slow motion).** Five packets. Standing decisions: §34
  envelope in @fourjs/diagnostics (formatVersion 1 exact-match; canonical re-build
  validation → encode(decode(t))===t, prototype-pollution-safe; strict canonical
  base64, hand-rolled, RFC-vector-pinned); ReplayTarget duck-types PhysicsWorld
  (applyInput OPTIONAL — apps wrap world+input-applier, PhysicsReplayTarget in
  tests/integration/helpers/replay-scenarios.ts is the reference pattern; one code
  path applies inputs live AND on replay); ReplayPlayer owns bookkeeping only, host
  supplies stepFn (nothing type-checks the pairing — runtime signal via
  verifyChecksum, deliberately tested); recording is non-perturbing (Rapier
  takeSnapshot is a pure read — tested); DebugDrawBuffer 7-floats/vertex line list +
  duck-typed providers; STAGED with dated notes + DEBUG_DRAW_STAGED export: COM
  display (no seam accessor; Rapier localCom/worldCom exist — unblock verified),
  joint-anchor/constraint viz (seam has no anchors), force vectors (channel is
  write-only), per-segment-colored draw (needs vertex colors — "lines" GeometryDrawMode
  → GL.LINES wiring exists but is undemonstrated; §118 flagship pickup). Known
  boundary: §34 world-CONFIGURATION mismatch is not refused (name/version only —
  pre-existing Phase 5 scope). Exit: 2,766 unit + 159 suite + 32 browser; diagnostics
  210 tests at 100%. Verifier notes: all 24 package READMEs still say "scaffold only"
  (sweep chore); 4 of 6 debug providers exercised via fakes only (one-line rig
  extension would close it).
- **2026-08-02 — PHASE 9 CLOSED (exit GREEN; the plan's honest §112 reading TRUE: 100k
  measured-and-recorded, one-draw-call batching asserted in fake-GL tests, browser demo
  at SwiftShader scale).** Five packets + doc fixes. Key facts: SoA Float32Array pools
  with swap-remove (layout = deterministic function of history — the accepted P9-4
  reading; literal insertion order NOT preserved); fixed 4-draws-per-spawn RNG
  contract (dropped spawns burn none — capacity is part of the stream); SeededRandom
  duplicated from motion (dated, hoist-to-core backlog); §27 fields as factories
  (turbulence = bounded hash-value-noise curl, honestly NOT divergence-free; radial =
  inverse-square, positive-outward); "particles" RenderItem: instanced quads, stride-8
  interleaved, 6 GL calls/frame at any count, straight-alpha blending (first blended
  non-sprite pass); ParticleDrawable + ParticleSystem's SimulationSystem are DUCK-TYPED
  cross-package contracts (matrix forbids the edges; drift caught by tests — plan §6h
  dated note); PRIORITY_PARTICLES = 500. **Benchmark (recorded, NOT a 60fps claim):**
  100k + 3 fields = 16.54 ms/step mean (99.2% of the 60 Hz budget; p95 over), on a
  4-core CI Xeon; integrator alone 1.35 ms — each polymorphic §27 sample() call site
  costs ~5.3 ms/100k; field batching is a scoped future optimization. Exit: 2,585 unit
  - 138 suite + 32 browser tests (five example sites, five webServers); particles/
    render 100%, render-webgl 99.83%; §86 gate 32.13 kB (grew +1.21 kB from the render
    union — verified genuine); particles-demo 18.9 kB gzip non-wasm.
- **2026-08-02 — PHASE 8 CLOSED (exit GREEN; plan-defined criterion TRUE — §111 sets no
  exit, the plan's "PID + steering pass analytic tests, demo composes with the stack"
  stands owner-to-confirm).** Five packets + one doc fix, all in `@fourjs/motion`.
  Shipped: PIDController (§111 sketch verbatim; conditional-integration anti-windup,
  bit-identical to naive while unsaturated; derivative-on-measurement default);
  SpringDamper (exact ZOH matrix-exponential step, memoised per dt, unconditionally
  stable; matched an independent scaling-and-squaring exponential to 1e-12); steering
  (Reynolds set + flocking, acceleration out-params, brute-force neighbors —
  spatial hash staged; the implicit 1 s⁻¹ gain documented); SeededRandom (xorshift128,
  splitmix32 seeding, BigInt oracle known answers); prediction (ballistic + stable-
  quadratic intercept); two-bone analytic IK (positions not angles — no bone-axis
  convention pinned yet). Staged with dated notes: path-planning adapters (RFC),
  CCD/FABRIK, spatial hash, spherical wander, robotic joint commands (MAY declined;
  the PID→setMotor hinge scenario demonstrates the mapping). Integration facts: PID
  actuation = targetVelocity cascade (maxTorque held; on Rapier it is the loop GAIN if
  modulated); a velocity written after world.addBody reaches no solver (author it on
  the descriptor); steering probes (12k overlapSphere calls) provably perturb no
  solver state (checksum-stream identity). Exit: 2,359 unit + 131 suite + 27 browser;
  motion 99.78% (all six new modules 100%); typedoc warnings now 74 (chore count
  stale).
- **2026-08-02 — PHASE 7 CLOSED (exit GREEN, zero defects; §110 criterion TRUE —
  uniquely, both control switches cost LESS than the animation's own per-step motion:
  activation 9.33 mm and retype 2.69 mm vs the wave's 14.63 mm, pinned in
  golden/phase7.json; the chain re-locks onto its animation bit-identically two wave
  periods after a ragdoll cycle).** Eight packets + one doc fix. Standing decisions:
  `PoseTarget` lives in `@fourjs/scene` (position+rotation MVP, no scale — backlog;
  previous* history + capturePrevious); §19 weights on RigidBody (independent,
  normalized at use, defaults 1/0, both-zero warns once and falls back physical);
  transitions retype IN PLACE via SolverBodyAccess.setBodyType (Rapier verified both
  dims — handle/id/colliders/mass survive); velocity inheritance = finite-differenced
  PoseTarget history (world-frame quaternion delta, atan2 form); **no separate
  BlendSystem** — feed and publish live inside PhysicsWorld.step, plus
  createPoseTargetCaptureSystem at 299 (MUST be registered by applications using
  blending/inheritance — an uncaptured animated target inherits ~30× inflated
  velocity, WP-7.3-fix1); kinematic feed is UNWEIGHTED (weights apply once, at
  publish); blending covers every §22 body type; missing-trio throws from the step;
  weight extremes are bit-identical (Object.is-tested) to pure physics/pure target;
  root motion = translation-only mixer option (rotational staged 2026-08-02, seek
  never accumulates); "blended" authority unlocked (WP-2.3 guard removed). Rapier
  note for capability tables: a driven kinematic-position body already carries
  solver-derived velocity, so inheritVelocityFrom is nearly a no-op there (2.4e-7 m
  / 0.5 s) — it matters on solvers that do not derive it. Exit: 2,176 unit + 124
  suite + 27 browser tests (four webServers); scene 99.64, physics/animation 100%
  coverage; first-2d-scene 30.72 kB gzip vs §86; blending example 675.9 kB (wasm,
  ungated).
- **2026-08-02 — PHASE 6 CLOSED (exit verdict: §109 criterion TRUE; one CI-wiring
  defect WP-6.6-fix1 landed by the orchestrator — build all three example sites before
  test:browser — after which the verifier's stated condition for GREEN holds; zero
  engine defects).** Seven packets + two fixes. Standing decisions: joints register on
  the WORLD (`world.addJoint`), not as §6a components (P6-3); anchors/axes authored in
  world space, converted once at addJoint from live solver poses (pose before
  jointing); limits + motors are live (command queues via `SolverJointAccess`
  setJointLimits/setJointMotor); anchors/axis/rope/spring/cone/collisionEnabled frozen
  post-registration (dated staging). `SolverJointAccess` joins SolverBodyAccess as
  required engine surface beyond §37. **Rapier 0.19.3 facts (all measured):** no joint
  reaction getters exist (typings + prototypes + wasm exports) → reportsJointReactions
  false on both adapters, breakable joints refused, §28 breakage proven via scripted
  adapters through the full Application pipeline; motor maxTorque/maxForce is a
  ForceBased GAIN, not §28's hard cap (deviation recorded in the stable API docs with
  cross-references; Box2D could honor a real cap — capability-table item); disabled
  motor = INERT_MOTOR_GAIN 1e-12, measured bit-identical to never-motored over 3600
  steps in BOTH dims (2D initially threw; unified by WP-6.2-fix1 after measurement);
  spherical ships 3D-only WITHOUT limits (per-axis limits do not form a cone — ±0.3
  rad limit lets a diagonal swing reach 1.1247 rad; limited descriptors refused
  quoting the numbers); distance + gear staged loudly (P6-1); FixedJoint with no
  anchor welds origins (documented trap); §28 solver-iterations feature not exposed
  anywhere (recorded gap, TODO). Stability evidence: 3600-step mechanism, hinge
  anchor drift 1.3e-5 m, rope slack 0, slider off-axis ≤1.6e-11, pendulum period
  within 6e-5 of the amplitude-corrected closed form. Exit: 1,998 unit + 95 suite +
  23 browser tests; physics 390 @ 100%, physics-rapier 248 @ 98.14/96.44/100/98.14;
  mechanism example 674 kB gzip (wasm, ungated); first-2d-scene 30.19 kB vs §86.
- **2026-08-01 — PHASE 5 CLOSED (exit GREEN, zero defects; §108 criterion TRUE on three
  axes: mixed-world integration test, playground demo + browser pixels, cross-process
  determinism golden).** Nine packets + two fix packets. Key decisions/facts:
  **SolverBodyAccess** (per-handle transform/velocity/force/kinematic accessors) is an
  engine seam beyond §37's sketch, defined in `@fourjs/physics` and mirrored
  member-for-member by the adapters — future adapters (Box2D) must implement it and the
  §90/§102 compatibility tables should name it. Rapier pinned `-compat@0.19.3` (base64
  wasm, async init; NodeNext cannot resolve its .d.ts → a verified transcribed subset
  lives in `physics-rapier/src/init.ts`, cleanup backlogged). Mass model: density-derived
  by default (delegated to Rapier; WP-5.2-fix1's authoredness union rule — sticky flag OR
  non-origin — keeps an unauthored origin centerOfMass out of descriptors); three
  MassModes; inertia tensors diagonal-only (off-diagonal throws). Adapters own monotonic
  never-reused ids (Rapier handles are unordered doubles) → §33 checksum order;
  snapshot envelopes F4R2/F4R3 carry the id registry. collisionstay is adapter-derived
  from a touching-pair map (Rapier has only start/stop); restitution combine forced Max
  (Rapier default Average contradicts Appendix A); §32 sleep thresholds have NO Rapier
  binding (only `enabled` maps — honest gap); §31 "speculative" = softCcdPrediction(1.0),
  distance param backlogged. §33 FNV-1a duplicated in world.ts (matrix has no
  physics→diagnostics edge; pinned against a reference impl). Verified: 2D and 3D solvers
  bit-identical on mirrored scenarios (identical scenes hash identically across
  dimensions — checksums include z/quaternion, so divergence must be authored into
  tests). §21 z-plane rule shapes node structure (2D bodies must sit at z=0; visuals go
  on child nodes). Rapier 0.19.3 surprises recorded in the WP-5.4/5.5 reports (world
  retains gravity object; colliders query-invisible until next step; dt/4 substepping;
  shapeCast ≤1 hit in 2D). Exit: 1,827 unit + 60 suite (first §92 integration suite) +
  19 browser tests; physics 100/100/100/100, physics-rapier 97.99/96.94/100/97.99;
  first-2d-scene still 30.19 kB gzip vs §86; playground 1.51 MB gzip (wasm, ungated per
  MEMORY 2026-07-29).
- **2026-08-01 — PHASE 4 CLOSED (exit GREEN, zero defects; §107 criterion TRUE per value
  kind with unit + golden + browser-pixel evidence).** Ten packets. API surface:
  34-key easing registry (§15 families, pinned constants incl. damped-spring closed form);
  `ValueAdapter` with `mutatesInPlace` split (primitives return, references mutate `out`);
  `PropertyBinding` (paths resolved once, in-place writes preserve identity + change
  hooks); `Tween` builder (repeat = extra cycles) with a writer-agnostic last-started-wins
  claim registry shared by tween AND mixer (internal exports, not in the barrel);
  `Timeline` (elapsed-space markers, `(from, to]` crossing shared with clip events,
  seek suppresses + per-marker/per-play replayOnSeek, loop = total iterations —
  documented divergence from tween.repeat); `AnimationTrack`/`AnimationClip` (§17 shape;
  cubic = motion's Catmull-Rom convention; quaternion linear = slerp, cubic/hermite
  rejected; morph/skeletal staged per P4-3); `AnimationMixer` (`prepare()`+`play()`,
  satisfies TimelineChild, seek in elapsed time); `AnimationSystem` (priority 300 <
  MotionSystem 400, fixed scaled delta = `fixedDeltaTime` (timeScale already applied by
  the accumulator), auto-untracks finished/stopped). **Renderer findings (WP-4.7):**
  unlit draws run with GL_BLEND off (alpha animation invisible — §60a/blending backlog);
  material color is read per draw (no version cache), so in-place tuple animation works.
  **Frozen behavior:** the fixed-step accumulator's ULP drift fires boundary-sitting
  markers one step late (step 199 not 198) — pinned in golden/phase4.json. WP-4.0 made
  the ≥95% coverage gate tooling-enforced (package-level thresholds; per-file granularity
  noted as a future hardening) + typecheck:examples in CI; barrel-wiring test took the
  umbrella to truthful 100%. Exit: 1,363 unit + 26 suite + 15 browser tests, animation
  100/100/100/100, example 30.19 kB gzip (21% of §86). Verifier notes adopted: §15's
  `node.position` snippet is not copy-pasteable (scene has `node.transform.position` —
  existing ergonomics backlog item); §17's slerp is folded into the quaternion adapter
  rather than named as a mode; 8 new cosmetic typedoc link warnings (cleanup chore).
- **2026-08-01 — PHASE 3a CLOSED (exit GREEN; §106a criterion TRUE with browser input +
  pixel evidence).** Seven packets: §71 picking (ray/AABB/oriented-box, +Y-up NDC), §72
  subset pointer input (capture:-prefixed capture keys on the four propagating types only;
  `NodeEventMap` augmentation via `declare module "@fourjs/scene"`), DragManager (world-delta
  handoff to app callbacks — @fourjs/input never writes transforms), §55/§77 MVP textures +
  sprites, §56 bitmap-tier text (6×12 font, 95 glyphs, base-32 rows; SDF staged), example
  upgrade (click palettes + drag with the §42 untrack+authority handover pair), 5-test
  browser interaction gate. Exit: 1,015 unit tests, 11 browser tests ×2, goldens untouched,
  example 21.46 kB gzip; coverage 100% on input/text/render/materials, render-webgl 99.42%
  (two defensive branches). **Advisory WP-3a.3-fix1:** §55 frame regions unimplemented —
  sprites map whole textures, so labels cost one texture per glyph cell (already in TODO;
  owner may record a spec-amendment deferral). **Exit-verifier notes adopted as chores:**
  examples are typechecked by nothing in CI (verifier's manual `tsc --noEmit` clean today;
  `typecheck:examples` chore queued for Phase 4), coverage ≥95% is review-enforced (no
  vitest thresholds configured — tooling chore queued), example dist uses base "/" (fine for
  root hosting + preview; subpath deploys need `--base`, a deployment-time flag).
  "Ship the public demo" = demo-ready static artifact confirmed (index.html + hashed asset,
  no dev-server references); actual deployment is the owner's step per POSITIONING.
- **2026-08-01 — PHASE 3 CLOSED (exit GREEN, zero defects; §106 criterion met with
  browser-pixel evidence).** Nine packets: cameras/viewport (§47-48, D8 depth ranges),
  geometry/materials/renderable lite + render lists (WeakMap-keyed pools, §43 interpolated
  builder), §61 Renderer interface + NullRenderer, WebGL 2 backend (33-method structural GL
  seam, fake-GL units, 99.66%), Application renderer integration (injected Renderer
  INSTANCE, RenderInterpolation plumbing), real example (14.88 kB gzip vs 150 kB §86),
  Playwright browser gate (ANGLE/SwiftShader pinned; caught a real rAF-seed defect =
  WP-3.7-fix1), exit with centroid-tracked smoothness + a virtual-clock test proving
  alpha-0.5 interpolated draws. **Deferral recorded (spec §45 departure):**
  `ApplicationOptions.renderer` takes a Renderer instance, not §45's string union —
  string/"auto" selection deferred to a §62 registry packet so `four` never imports
  backends at runtime (payload evidence: 14.88 kB). Informational: §106 "textures" deferred
  to §106a/§55 tier; tests/integration+visual still empty (§92 backlog);
  four-package barrel coverage artifact persists (cosmetic). Repo: 813 unit tests +
  17 suite + 6 browser.
- **2026-08-01 — PHASE 2 CLOSED (exit GREEN; §105 criterion met; coverage ≥95% everywhere).**
  Seven packets: five §38 integrators; MotionComponent+MotionSystem (pinned semi-implicit
  formula, explicit track/untrack, parent-frame angular premultiply); eight §13 trajectories
  (CR antisymmetric-tangent bug caught by symmetry tests); §42 TransformAuthority
  (NOT_IMPLEMENTED added to FourErrorCode; refusals skip whole advance);
  KinematicController (channel state machines, float-safe completion tolerance, refused
  commands freeze); scene-side PoseBuffer (single §37 store, lerp/slerp, no write-back API,
  turbo override orders scene#test after motion#build). Exit verified against independently
  derived closed forms (Barry-Goldman, RK4 ODE, algebraic recurrence; worst dev 3.1e-13),
  golden digests cross-process. Motion 200 tests / 99.63%, scene 114 / 99.55%. Fixes: CI
  Node 20→22 (type-strip children); four/application subpath (renderer-free headless
  composition). Repo: 545 tests. Next: Phase 3 rolling-wave decomposition (renderer
  foundation §106 + §61-62, cameras §47 in @fourjs/scene per spec rev 1.3).
- **2026-08-01 — PHASE 1 CLOSED (exit GREEN; §104 criterion met; coverage ≥95% everywhere).**
  All 14 packets landed (Opus workers, per-packet commits): math (Vector2/3/4, Quaternion,
  Matrix3/4 — 154 tests), core (EventEmitter, component model, FourError+Disposable — 57),
  scene (Transform with D3 dirty channel, Node/Group/Scene, world-transform resolver — 84),
  motion (Clock/TimeState, §10 scheduler, §39 system registry — 56), diagnostics (D6
  checksum with independently cross-checked golden vectors — 28), four (Application root —
  25), plus the WP-1.14 exit: 100-node/1000-frame determinism scenario with committed
  golden digests, proven in-process AND in a fresh node process, with sensitivity evidence.
  Coverage: math 98.9 / core 98.5 / scene 99.3 / motion 99.3 / diagnostics 100 /
  application.ts 100 (% statements). **API decisions recorded from [S] packets:** registry
  re-entrancy throws (protects §34 replay) while EventEmitter queues-and-defers; Node's
  parent setter delegates to add/remove; world resolver's three-part staleness incl.
  parent-identity (catches version-less reparenting); Application wraps
  attachToScheduler's installed callback (registry first, then event), resolves world
  transforms before update/render listeners; `INVALID_APPLICATION_STATE` added to
  FourErrorCode (WP-1.12-fix1); @types/node@22 + tests/tsconfig.json (WP-1.14-fix1);
  @vitest/coverage-v8 pin added — coverage joins phase-exit gates. Node 22 runs .ts
  helpers natively (type-strip) — the determinism child process imports the same .ts
  scenario file Vitest uses.
- **2026-07-31 — PHASE 0 CLOSED (exit verifier: GREEN, zero defects).** All 15 packets
  executed by Opus workers under the plan's protocol; 24/24 packages scaffolded, building
  (`tsc -b`, cold and warm), testing, linting; docs, example, size gate (425 B / 150 kB),
  CI workflow, community files, ROADMAP all landed. Per-packet commits `WP-0.*` on the
  working branch. **Findings folded back into the plan (dated in-place revisions):**
  WP-0.2's original Done check was vacuous (TS18003 with no .ts files); WP-0.4/0.5 Files
  lines omitted `tsconfig.build.json`; **`pnpm docs` without `run` is a pnpm builtin
  no-op** — always `pnpm run docs` (CI updated); `*.tsbuildinfo` needed gitignoring;
  root-level `.ts` files need `allowDefaultProject: "*.ts"` (WP-0.7-fix1); the umbrella's
  root barrel uses namespace re-exports to avoid symbol collisions. Dormant-but-harmless:
  turbo's `lint` task (root eslint is the gate); `test:suites` vacuous until WP-1.14.
  Phase 1 dispatch begins with WP-1.1 (math vectors) and the batched core trio
  (WP-1.4/1.5/1.6 — batched because all three edit core's `src/index.ts`).

- **2026-07-28 — Spec corrected in place (owner decision).** E-1/E-2/E-3 from `ERRATA.md`
  resolved directly in `SPECIFICATION.md`: second `Part VII` → `Part VIII` (later parts
  IX–XIII); second §45–67 range renumbered +53 to §98–120; §102 lists only `physics-rapier`
  and `physics-box2d` as solver packages. The PDF was left unmodified.
- **2026-07-28 — PDF archived.** Original spec PDF moved to `docs/archive/`; the corrected
  Markdown is the working reference for the repository.
- **2026-07-28 — Plugin marketplace registered (owner decision).** `.claude/settings.json`
  registers `local-marketplace` (GitHub `danielsimonjr/skills`, a **private** repo — sessions
  need the owner's GitHub auth to clone it) and enables `rfl`, `dev-workflow`, and
  `honest-claude` as project defaults. Machine-bound plugins from that marketplace (Windows
  automation, Outlook, local symlink/junction sources, personal MCP servers) are deliberately
  NOT project defaults — they belong in the owner's user-level settings. The settings file
  was created by the owner directly; agent writes to `.claude/settings.json` are blocked by
  the permission classifier in this environment.
- **2026-07-28 — Repository layout conventions.** Per package: `README.md` + `src/`
  (strict TS, ESM) + `tests/` (unit tests colocated, §92). Cross-package suites live in
  `tests/{integration,visual,determinism}/`; performance tests in `benchmarks/`. Examples
  follow §93 naming (`first-*-scene`, `mixed-scene`) with flagship demos under
  `examples/flagship/`. Still no `package.json`/toolchain — that remains Phase 0 (§103).
- **Pre-existing (recorded in ERRATA E-3):** the scaffold follows the monorepo tree —
  `physics-matter` and `physics-cannon` are deliberately absent and must not be added without
  a spec amendment.
- **From the spec (not yet revisited):** first physics adapter is Rapier (§108); MVP renders
  with WebGL 2 only (§120); toolchain baseline is strict TS + ESM + pnpm + Vitest +
  Playwright + ESLint + Prettier + Vite + Changesets (§91).

- **2026-07-28 — Specification review recorded, not applied.** `docs/SPEC-REVIEW.md` proposes
  improvements R-1…R-35 (P1 = internal contradictions, e.g. §23 vs §26 force signatures,
  §19 vs §42 authority enums, §52 tessellator package missing from §98; P2 = underspecified
  load-bearing designs, e.g. component model, event system, coordinate conventions, adapter
  interface gaps; P3 = structural/editorial). Cite items as "R-N" (same style as ERRATA
  "E-N"). _Superseded the same day by the revision-1.1 entry below._
- **2026-07-28 — Spec revision 1.1 applied (owner-directed).** All 35 review items applied to
  `SPECIFICATION.md`; Amendments table added at the top of the spec. Key standing rules the
  revision established: **§ numbering 1–120 is frozen** — new sections use letter suffixes
  (now 6a Component Model, 6b Eventing, 7a Coordinate/Unit Conventions, 7b Math Conventions,
  60a Color Management) and appendices (A Normative Defaults, B Glossary); world space is
  right-handed **Y-up in both 2D and 3D** (2D gravity is negative Y); **all engine times are
  seconds** (tween/timeline durations included — no milliseconds anywhere); the single
  authority enum is `TransformAuthority` (§42, now includes `"blended"`; `MotionAuthority`
  no longer exists); force APIs use explicit `…AtPoint` names; `RigidBody`/colliders are
  _components_ (§6a); the solver adapter contract (§37) includes destroy/query/drainEvents
  methods and a defined `PhysicsCapabilities`. §86 payload budget (≤150 kB gzip) was
  confirmed by the owner on 2026-07-29 (revision 1.2; no longer provisional). The `dev-workflow` plugin could not load in this
  remote session (private `danielsimonjr/skills` marketplace repo is outside the session's
  GitHub scope), so the revision was done inline.

- **2026-07-29 — Phase 0 toolchain decisions (proposed by Claude at owner direction to
  "close the open decisions"; each overridable by a superseding entry before Phase 0
  starts):**
  - **Task runner: Turborepo** (§91 permitted either). Rationale: simpler config surface for
    a pnpm workspace with uniform package shapes; no need for Nx's generator/plugin layer.
    Revisit via RFC (§95) only if remote caching/constraints prove insufficient.
  - **Browser/Node baseline** (feeds §90 compatibility tables): evergreen last-2 versions of
    Chrome/Edge/Firefox and Safari ≥ 16.4; **WebGL 2 required** for the MVP (§120); WebGPU
    is an optional tier. Node ≥ 20 (LTS) for tooling and headless simulation.
  - **Rapier strategy** (§108): official `@dimforge/rapier2d` + `@dimforge/rapier3d` wasm
    packages; the wasm loads asynchronously inside `PhysicsSolverAdapter.initialize()` (§37
    permits a Promise); exact version pinned when Phase 5 starts (tracked in TODO). Solver
    wasm is **outside** the §86 payload budget, which by its wording covers only
    core + math + scene + render-webgl.
  - **Budget enforcement**: a size-limit check in CI is a **Phase 0 deliverable**, gating
    the §86 payload row from the first compilable package onward.
  - **API docs: TypeDoc** for generated reference docs (§93). API Extractor deferred;
    revisit before 1.0 if API-report/compat gating is wanted (§90).
- **2026-07-29 — Implementation plan written for subagent execution.**
  `docs/plans/IMPLEMENTATION_PLAN.md` (Phase 0 deliverable, §103; moved from the root to
  `docs/plans/` by owner direction the same day — §103's deliverable list names the file
  without a path, so this is a location choice, not a spec deviation) structures all work
  as **work packets** `WP-<phase>.<n>` with a fixed format (Depends/Reads/Files/Steps/Done). Packets
  are tiered: **[H]** = mechanical, pre-decided, Haiku-executable; **[S]** = needs judgment,
  stronger model. Conventions in force: §1 ground rules go verbatim into every worker
  prompt; parallel packets need disjoint `Files` sets; two retries then escalate; a phase's
  exit packet must pass before the next phase starts; Phases 0–2 are fully decomposed,
  Phases 3–10 are deliberately rolling-wave (decomposed only when their predecessor exits
  green). The §98 directory tree was verified complete — packets fill directories, never
  create packages.
- **2026-07-29 — npm publish names decided (owner): `@danielsimonjr/fourjs`.** Spec
  revision 1.6. Umbrella publishes as `@danielsimonjr/fourjs`, all other packages as
  `@danielsimonjr/fourjs-<name>`, from the owner's personal npm scope — no org claim or
  dispute needed (supersedes the `fourjs`/`@fourjs` fallback in the 1.5 note below).
  Workspace names stay `four`/`@fourjs/*`; the mechanical rename happens in the release
  workflow at first publish (§94 0.1). Subpath exports (`@danielsimonjr/fourjs/scene`)
  carry the §91 tree-shaking requirement.
- **2026-07-29 — Gap-closure pass (spec 1.5, plan 2.1) after the "what else are we
  missing" review.** (1) **Naming:** npm `four` (0.0.1-a, unrelated) and `four-js` are
  occupied; `fourjs`/`@fourjs` were free 2026-07-29 (org pages bot-blocked — claiming needs
  the owner's npm account). Workspace names stay `four`/`@fourjs/*`; rename-or-dispute is an
  owner decision due before release 0.1 (TODO). (2) **MVP coverage hole closed:** Part IX
  never scheduled §120's interaction/content/tooling scope — spec 1.5 adds §106a (Phase 3a:
  input, picking, dragging, sprites, MVP-tier text) and §113a (Phase 11: assets,
  serialization, UI, benchmark harness, docs); §56 gains an MVP text tier with full shaping
  staged behind a shaping-engine RFC (HarfBuzz-wasm the likely route). (3) **Phase −1
  smoke passed:** the full §3.2 pin set installed and ran together (build/test/lint/docs/
  vite/size-limit); template corrections folded into plan 2.1 — split dev/build tsconfigs
  per package, `pnpm.onlyBuiltDependencies: ["esbuild"]`, validated ESLint config, example
  needs a root `four` workspace devDep, size-limit set to gzip. (4) **Process homes:**
  `docs/rfcs/` created (template + process, backing the plan's RFC gate);
  `docs/POSITIONING.md` states the why-exist case, audience order (engineering/digital-twin
  first), migration story, demo-first principle (public demo ships at Phase 3a exit), and
  plain-language risks; CI gains a non-blocking `pnpm audit` step; visual tests will run
  Playwright + Chromium/SwiftShader in CI (plan Phase 3 note); MEMORY compaction convention
  added to this file's header. Release (Changesets) workflow deliberately deferred to first
  publish (§94 0.1).
- **2026-07-29 — Implementation plan stress-tested; revision 2 written.** Five independent
  passes (Haiku dry-run of WP-0.1 in a worktree — succeeded, logged 5 forced guesses;
  executability review with empirical probes; spec-fidelity review; Sonnet orchestration
  red-team; Opus technical-design red-team) produced ~85 findings, all applied in plan
  revision 2. Standing outcomes: **toolchain pins are exact** (TypeScript 5.9.3 — never
  7.x; eslint 9.39.5; typescript-eslint 8.65.0; vitest 3.2.7; turbo 2.10.7; full table in
  plan §3.2, orchestrator-adjusts-only); **frozen dependency matrix** (plan §3.1, 6 waves);
  build is **`tsc -b`** with `types`-first exports maps and `.js` relative-import suffixes;
  design decisions **D1–D8** pre-decided (Node = single inheritance extending
  EventEmitter, no mixins; `typeName`-keyed components; Transform dirty via math
  change-hooks + `markDirty`; Application composition root in `four` (spec rev 1.4);
  §39 system registry — nothing edits the scheduler; diagnostics checksum utility with
  fresh-process golden-hash determinism tests; `out?`-optional allocation policy;
  depth-range-parameterized projections, shortest-arc slerp). Orchestration now specifies:
  per-packet orchestrator commits scoped to Files, orchestrator-only installs/lockfile,
  worktree merge order, retry-with-failure-output then validate-the-Done-check escalation,
  in-place packet revisions, independent second-agent review for [S] packets,
  `WP-N.M-fixK` defect convention, orchestrator-owned tracking files, RFC gate for
  rolling-wave API surfaces. **Spec revision 1.4** (found by this pass): §98 Application
  composition root moved from `core` to `four`.
- **2026-07-29 — Spec revision 1.3 (verification pass).** Two independent adversarial
  re-reads of the 1.1 material (time/physics-semantics lens and cross-reference lens)
  surfaced 16 unique findings — 7 confirmed, 9 plausible — all fixed in revision 1.3 (see
  the spec's amendments table and CHANGELOG). Notable standing corrections: world matrices
  resolve **per fixed step**; §39 order is now …7 constraint solve, **8 sensor update,
  9 collision event dispatch**…; `Collider.density` beats `PhysicsMaterial.density`;
  checksums visit existing bodies (incl. sleeping) in monotonic body-id order; cameras and
  viewports belong to `@fourjs/scene` (rigs stay in `@fourjs/motion`); §40's degree/millisecond
  options are display/authoring conversion only.
- **2026-07-29 — Scaffold docs synced to revision 1.2.** CLAUDE.md, AGENTS.md, README.md,
  ERRATA.md (scope note: amendments live in the spec's table, ERRATA covers only PDF
  defects), website/README.md, and the core/motion/physics/geometry package READMEs were
  updated to match the revised spec (transform authority incl. `blended`, seconds, Y-up,
  components, adapter contract, camera rigs in `@fourjs/motion`, units in `@fourjs/core`,
  tessellation as a geometry module). `tools/check-spec.mjs` added as the mechanical spec
  checker (future CI docs job).

## Open questions

- Whether/when to regenerate the PDF from the corrected Markdown (it is now formally frozen
  at the pre-1.0 text — regeneration is optional, not blocking).

## Gotchas

- The ERRATA "non-defects" list exists so known false alarms aren't rediscovered: §118's
  title starts with a typographic quote (easy to miss in heading scans), and low repeated
  numbers (1., 2., 3., …) in the spec body are lists, not sections.
- The spec body text is hard-wrapped plain text under Markdown headings; code snippets have
  been fenced since 2026-07-28.

### 2026-09-11 — Owner-directed RFC/TODO implementation

Owner requested all RFCs, PHs and TODO remainder implemented. Accepted RFCs 0007–0009
and amended §56 (spec 1.16) before text-shaping implementation. New first packets are
implemented; broad roadmap residue is explicitly retained in TODO rather than closed.

Key decisions: waypoint A* scales Euclidean heuristic by minimum authored cost/distance
so cheap/zero-cost edges remain admissible; reject distance overflow. GPU raster feedback
scans every standard-map slot, not only albedo. Shared raster limits avoid a runtime cycle.
HarfBuzz 0.4.13 is optional and injected through Emscripten instantiateWasm; default entry
contains no wasm. Identity shaping retains original atlas advances for exact default
parity. Normal/AO factors are preserved glTF→material→WebGL; GPU parity remains staged.
CPU skinning owns independent output, preserves bind geometry in serialization, and uses
interpolated palettes for rendering. std140 trades fewer uploads for padded bytes, not an
unmeasured GPU-speed claim. Safe declarative shaders still lower to closed operators.

Pinned Chromium 153 download failed (timeouts/502). An isolated Chromium 152 runtime was
obtained separately for software-renderer validation; physical-GPU R-33 remains unproven.

Final checks: 7,556 coverage tests / 24 package gates; 685 integration/determinism
checks. Browser full run 108/110, then stale hemisphere fixture corrected to use
LIGHT_BINDING_BYTES and 2/2 rerun passed; visual 3/3 unchanged. Chromium 152/SwiftShader
only, not R-33 hardware evidence. Release staging had included the private docs
workspace; now excluded, nested shaping imports preserved; 13 regression tests in PR CI,
and 24 packages stage locally. Example-size A/B recorded in tools/size-budgets.mjs.

### 2026-09-11 — PR #93 post-merge review

Merged baseline: 3f48b1d. Texture async waiter identity must be the GPU allocation,
not the authored texture ID: version replacement and device/context recovery can
outlive an earlier waiter. WeakMap record counts retain concurrency semantics and
isolate replaced allocations. Identity shaping must read the character atlas and
use its cell width, preserving legacy custom atlases without a glyph-ID map.

Next §96 packet adds createGzipLoader with an injected cancellable pull reader.
Finite defaults: 64 MiB output / 1000× expansion. The host validates gzip checksums;
the loader validates headers and bounds output before each copy, returning only
after stream completion. Growth plus trimming requires at most twice the output
limit; host-internal allocations and deadline preemption remain host concerns.
Draco/Basis are still absent. No dependency or normative size/coverage gate changed.

Merged-main CI 34658678579 failed because shape.test.ts's 257×256-ring fixture
exceeded its 20s timeout, not a coverage percentage. Path.fillRings now skips
winding tests when a probe is outside a precomputed ring bound. The fixture uses
1,025×64 rings (65,600 vertices), checks the highest index, and retains the 20s
limit; full local instrumented render run measured 932ms. Exact winding still
handles overlapping bounds/nesting. TypeDoc declaration was bumped to 7.0.2 by
#84 although the lock's nested resolution stayed 6.0.3. Restored the declaration,
regenerated lock, verified frozen install, and test declared/resolved mismatch in
the compiler guard. API documentation warnings fixed without disabling validation.

Browser review also caught the blending ANIMATED test's 1.6s screenshot deadline:
only two of three required pairs fit on the software renderer. It now captures
exactly three pairs under the existing test timeout, preserving all pixel/motion
assertions. Full browser validation uses the repository's serial worker setting.

Validation completed 2026-09-12: 7,574 package tests / 299 files and all 24
coverage gates pass; 685 integration/determinism tests pass; the complete serial
browser run passes all 114 checks, including three unchanged visual goldens.
Chromium 152 / software GPU only, not R-33 hardware evidence. Builds, TypeScript
7/6 checks, lint, spec/docs/compatibility, dependency/duplicate gates, 13 release-name
and 10 graph-tool tests pass. API docs are warning-free and four compiler-guard
regressions pass. Frozen install succeeds. All existing bundle budgets pass;
minimal 2D app: 61.34 kB gzip / 150 kB limit. No threshold, timeout or bundle budget
was relaxed. Nothing published or merged by this follow-up.

### 2026-09-12 — §96 bounded image decoding

Owner requested a team implementation of the remaining image decoder heap boundary.
Verified main at 7fe7098 lacks earlier local roadmap commit b1240b4 (including
Draco/Basis); this focused change builds directly on main without importing that
337-file roadmap diff. It preserves the earlier local work.

Native createImageBitmap/WebCodecs expose no allocator maximum. Implemented a
real PNG alternative using the application-pinned @jsquash/png3.1.1 Wasm binary,
with a runtime-enforced single unshared Wasm32 heap cap before initialization and
our own narrow wasm-bindgen bridge (no singleton glue/global ImageData). Encoded
bytes, RGBA copies, process RSS, retained assets, and Wasm code compilation are
separate from the linear-heap limit. PNG preflight validates framing/CRCs because
real-codec testing showed upstream accepted corrupt IHDR CRC. APNG is refused.

Strict maximumWorkingBytes on image/texture/glTF requires private registration
from the real bounded factory; user-set properties/wrappers cannot assert a cap.
Options are snapshotted against replacement. ImageBitmap strict mode has no public
bounded bitmap producer; supported strict image data comes through PNG texture
loading. Codec traps poison an instance; do not reuse an allocator after unwinding
through Wasm. Capture encoded byte count before probe/decode: transferred buffers
otherwise become zero bytes and bypass expansion checks. Image output sizes are
RGBA8 estimates; rejected bitmaps close once, and texture backing buffers are bounded.

Validation completed: 7,763 package tests / 685 integration-determinism tests;
assets coverage: 508 tests, 99.21% lines, 98.04% branches; 77 real PNG tests and 73 Wasm
cap tests. Focused Chromium 152 test passes normal decode, native guest OOM, and
CRC refusal. Builds/examples,TS7/TS6,lint,API docs,spec/docs/compatibility,
architecture/duplicate gates,13 release-name/10 graph-tool tests,frozen install,
and7 size budgets pass. Full browser matrix/all-package coverage not rerun.

Validation caught two preexisting merged dependency regressions: HarfBuzz 1.6.1
removes the adapter's imported subpaths and explicit destruction/instantiation
contracts; restore 0.4.13 pending a deliberate 1.x migration. TypeDoc 0.28.20 supports
TS6 and the guard requires 6; restore the isolated docs compiler 6.0.3 while the
root stays TS 7.0.2. These changes are separate from PNG semantics.
