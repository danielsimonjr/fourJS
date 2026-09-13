# RFC 0005 residue — WebGPU skinned id pass: subagent plan

**Status:** **superseded 2026-09-10** — the residue closed in #91 the same day this plan was written (WebGPU skinned id pass in `wgpu-picking.ts`). Retained as a record of the intended shape; only the A3 record-hygiene items remained, and those landed in spec revision 1.16 / the 2026-09-11 sync. Originally: plan only, written 2026-09-10 against `claude/rfc-review-planning-s2clzd`.
Scope: the one open residue in `TODO.md`'s "RFC 0005 residue" row, plus the record
hygiene the RFC's *Post-acceptance corrections* found. **Crew:** 3 haiku-class agents
(the fourth slot is unused on purpose: the seam is one file). Format per
`docs/plans/IMPLEMENTATION_PLAN.md` §2.

## 1. What is being built

`WebgpuPickingService` stops skipping `"skinned-unlit"` / `"skinned-lit"` items: a lazily
created **skinned id pipeline** whose vertex stage is the id vertex stage with
`skinningWgsl(1)` prefixed and the joint-palette bind group at group 1 (dynamic offset
from `packPalette`), fail-once on compile failure with a §61 diagnostic, falling back to
the bounds tier exactly as WebGL's `SkinnedIdProgram` does. Plus: re-record
`benchmarks/results/pick-latency.json`'s stale caveat, fix the stray sentence in
`renderer.ts:806`, and add the missing spec amendments row (owner).

## 2. Anti-hallucination sheet

| Fact | Pinned at |
| --- | --- |
| The skip: `if (item.kind === "skinned-unlit" \|\| item.kind === "skinned-lit") continue;` | `packages/render-webgpu/src/wgpu-picking.ts:486-488` |
| Existing lazy arm to copy: `#particlePipeline`, `#particlePipelineFailed`, `PARTICLE_ID_SHADER_SOURCE`, its own 208-byte `ParticleIdUniforms`; the main id pipeline uses a 144-byte `IdUniforms { viewProjection, model, pickId }` at group 0 binding 0 | `wgpu-picking.ts:135-230, 342-358, 844-901` |
| `registerPickingPipeline()` is the registration seam; `createPickingService` throws until called | `wgpu-picking.ts:4, 69, 317` |
| Skinning WGSL and layouts: `skinningWgsl(paletteGroup)`, `createJointPaletteBindGroupLayout`, `JOINT_PALETTE_BINDING = 0`, `JOINTS_SHADER_LOCATION 4` / `WEIGHTS_SHADER_LOCATION 5`, `skinnedUnlitVertexBufferLayouts(...)`, `skinnedPaletteBindGroupIndex` | `packages/render-webgpu/src/wgpu-skinning.ts:90-220` |
| Palette packing and the dynamic offset: `programs.packPalette(item.jointMatrices)` in `#drawSkinned`; `SkinnedPrograms` in the registry | `webgpu-renderer.ts:2857-2952`, `wgpu-skinning-registry.ts:123` |
| Render items: `jointMatrices` (Float32Array palette), kinds `"skinned-unlit"`/`"skinned-lit"` | `packages/render/src/render-list.ts:263-264` (grep `jointMatrices`) |
| WebGL template: `SkinnedIdProgram` (`static create`, `setJointMatrices(palette)`, `setId`), `#acquireSkinnedProgram` fail-once + diagnostic `"webgl-picking-skinned-compile-failed"`, `activeKind: "id" \| "particles" \| "skinned"`, per-era reset | `packages/render-webgl/src/gl-picking.ts:438-536, 650, 1092-1110, 1142, 1221` |
| Pick ids are a table index (§33-fixed order) encoded by `encodePickId`; `MAX_PICK_CANDIDATES` | `packages/render/src/picking.ts` |
| Unit test double: fake `GPUDevice` command-encoder transcript (R-1's harness) — find it via `grep -rl "createRenderPipeline" packages/render-webgpu/tests` | that directory |
| Browser gates: `tests/browser/picking.spec.ts` (WebGL) and `tests/browser/webgpu/*.spec.ts` (`--project=webgpu`); skinning browser scene in `tests/browser/skinning.spec.ts` + its fixture | those files |
| Stale records to fix: `renderer.ts:806` ("RFC 0005 names the region form as the pixel-picking fallback" — the RFC does not); `renderer.ts:726` and MEMORY lines saying WebGPU has "no RFC 0003 skinned pipelines"; `benchmarks/results/pick-latency.json` `hostCaveat` "WebGPU has no PickingService" | audit 2026-09-10 |

## 3. Roster and waves

| Agent | Owns | Wave |
| --- | --- | --- |
| **A1 — pipeline** | `packages/render-webgpu/src/wgpu-picking.ts` (the skinned arm), `packages/render-webgpu/tests/wgpu-picking-skinned.test.ts` (new, fake device) | 1 |
| **A2 — browser gate** | `tests/browser/webgpu/webgpu-skinned-picking.spec.ts` + fixture (reuse the skinning fixture's rig; probe `pick()` at a pixel covered only by the *deformed* silhouette) | 1 (runs against A1's branch when it lands; author against the WebGL twin meanwhile) |
| **A3 — records** | `packages/render/src/renderer.ts` (two comment fixes), `benchmarks/pick-latency.mjs` re-run + `results/pick-latency.json`, `docs/COMPATIBILITY.md` §2 WebGPU row ("skinned id: deformed silhouette"), draft spec amendments row text for the lead | 1 |

## 4. Packet notes

- **A1.** `SKINNED_ID_SHADER_SOURCE = skinningWgsl(1) + <id vertex/fragment with position replaced by skinMatrix() * position>`; pipeline layout = [id bind group layout (group 0), `createJointPaletteBindGroupLayout(device)` (group 1)]; vertex buffers from `skinnedUnlitVertexBufferLayouts`; per item: write `IdUniforms`, `setBindGroup(1, paletteGroup, [offset])` where `offset = programs.packPalette(item.jointMatrices)` — obtain `programs` the way `#drawSkinned` does (read how the renderer hands the skinning registry to the picking service; if it does not, add one constructor argument mirroring the particle arm's device handoff, nothing wider). Fail-once + diagnostic `"webgpu-picking-skinned-compile-failed"`. Remove the skip. Tests: transcript shows one pipeline creation across two frames, palette bind per skinned item, id encoding identical to the unskinned arm; compile failure → items fall to bounds and the diagnostic fires once.
- **A2.** Deterministic rig: one bone rotated 90° so a quad's deformed silhouette covers pixel P that the bind pose does not; `pick(P)` returns the node under WebGPU (and, as a control, under WebGL).
- **A3.** Re-run the benchmark after A1 lands (its caveat text is generated from capability probing — read the script; if the caveat is hard-coded, fix the string). Amendments row text: "§71 — RFC 0005 dispositions recorded: `hitTestMode` values, `"custom"` absent, id-buffer tiers, one-frame-late contract; §79 gains `hitTestMode`".

## 5. Lead's closing packet

Spec row (owner-gated; the RFC never got one); `MEMORY.md` lines claiming "no WebGPU skinned pipelines" struck; `TODO.md` RFC 0005 row closed; `CHANGELOG.md`. Gate: `bun run build && bun run lint && bun run test && bun run test:suites && bunx playwright test --project=webgpu && bun run examples:build && bun run size`.

## 6. Traps

- Do not read the id texel through `Renderer.readPixels`; the service owns its `mapAsync` path.
- One id per `Renderable`, same table index as the unskinned arm — never a new id space.
- Never bind-pose-fallback silently: skipped skinned items must be reported by the same diagnostic path WebGL uses.
