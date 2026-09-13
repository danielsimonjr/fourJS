# RFC 0003 residue — skinning follow-ups: subagent plan

**Status:** plan only. Written 2026-09-10 against `claude/rfc-review-planning-s2clzd`.
Scope: the `TODO.md` row "RFC 0003 residue" as re-read in the RFC's *Post-acceptance
corrections*. **Crew:** ≤ 4 haiku-class agents, disjoint files. Format per
`docs/plans/IMPLEMENTATION_PLAN.md` §2.

## 1. Scope decision

| Residue item | This plan | Why |
| --- | --- | --- |
| WebGPU skinned **shadow caster** | **closed 2026-09-10 (#92)** — `SkinnedPrograms.acquireShadow()` on WebGPU; WP-SK.1 below is retained as the record of what landed | — |
| WebGPU skinned **id pass** | **closed 2026-09-10 (#91)** | — |
| CPU skinning (`same-runtime` golden; home for skinned bounds) | **WP-SK.2** | Deterministic path, no backend; unblocks skinned bounds |
| Skinned bounds for culling/picking (uses WP-SK.2) | **WP-SK.3** | RFC §6's named inaccuracy; opt-in, never default |
| GPU morph path | **WP-SK.4 — layout decision only + one-target WebGL path** | The extra-vertex-stream layout is a public ABI (§53/§79); this packet pins it at locations 6/7 for `POSITION_1`/`NORMAL_1` and ships one target; more targets are a follow-up |
| Bone-texture palette (unbounded joints) | **gated** on R-4's `RenderTargetFormat` union widening + vertex texture fetch (RFC §5, `mesh.ts:83-87`) | needs its own decision |

## 2. Anti-hallucination sheet

| Fact | Pinned at |
| --- | --- |
| `Bone extends Node` with **no** `typeName`; `Skeleton.update(skinRoot, worldOf?)`; `MorphWeights` component (`typeName "morph-weights"`) | `packages/scene/src/skeleton.ts:72-82, 289, 336-353` |
| `MAX_SKINNING_JOINTS = 48`; joints/weights at attribute locations **4 / 5**; `Mesh.morphTargetWeights` accessor; the staged note for the GPU morph path | `packages/render/src/mesh.ts:15-35, 83-95` |
| Render items carry `jointMatrices` and `morphWeights: Float32Array \| null` (snapshotted per frame); kinds `"skinned-unlit"` / `"skinned-lit"` | `packages/render/src/render-list.ts:172, 263-264, 474-493, 754, 1485-1490` |
| WebGL: `SKINNING_GLSL` (`gl-skinning-glsl.ts:23`), `SkinnedShadowProgram` via `acquireShadow()` (`gl-skinning.ts:531-654`), `SkinnedIdProgram` (`gl-picking.ts:438-536`) | those files |
| WebGPU: `skinningWgsl(paletteGroup)`, `createJointPaletteBindGroupLayout`, `JOINT_PALETTE_BYTES = 48*64`, `skinnedUnlitVertexBufferLayouts`, `registerSkinningPipeline()`, `SkinnedPrograms.packPalette`, `#drawSkinned`; the shadow pass in `wgpu-shadow.ts` **skips** skinned items (grep `skinned`) | `packages/render-webgpu/src/wgpu-skinning.ts:90-300, 678`, `wgpu-skinning-registry.ts:123`, `webgpu-renderer.ts:2857-2952` |
| §33 rule: **no engine API returns skinned vertex positions**; the palette is the last CPU value in the envelope (spec §54, rev 1.10). CPU skinning therefore ships as an explicit, opt-in producer whose output is display/bounds data, never fed back into physics | `docs/SPECIFICATION.md` §54 |
| Culling uses bind-pose bounds (R-8); picking bounds tier likewise | RFC 0003 §6, `packages/input/src/pick.ts` |
| `BufferGeometry` attribute locations 0 position, 1 normal, 2 uv, 3 colour, 4 joints, 5 weights; `JOINTS_1`/`WEIGHTS_1` reserved for the next two (§54, rev 1.10) — so morph streams must **not** take 6/7 without an amendment row stating so | `packages/geometry/src/buffer-geometry.ts:60-75`, spec §54 |
| Browser gate for skinning is a counted-pixel test, not a golden | `tests/browser/skinning.spec.ts:16-24` |
| WebGPU browser tests: `tests/browser/webgpu/webgpu-<name>.spec.ts`, `--project=webgpu` | `playwright.config.ts:351` |
| Determinism suites: `tests/determinism/skinned-pose.test.ts` + `helpers/skinned-pose-scenario.ts` | those files |

## 3. Roster and waves

| Agent | Owns | Wave |
| --- | --- | --- |
| ~~**A1 — WebGPU skinned shadow**~~ | landed in #92 before dispatch; the slot is free (crew is three) | — |
| **A2 — CPU skinning** | `packages/render/src/cpu-skinning.ts` (new), `packages/render/tests/cpu-skinning.test.ts`, `tests/determinism/cpu-skinning.test.ts` + helper | 1 |
| **A3 — skinned bounds** | `packages/render/src/skinned-bounds.ts` (new; consumes A2), `packages/render/src/mesh.ts` (edit: opt-in `boundsMode: "bind-pose" \| "skinned"`), `packages/input/src/pick.ts` (edit: read the same bounds), tests | 2 |
| **A4 — morph layout + one-target WebGL path** | spec amendment draft text (handed to the lead), `packages/geometry/src/buffer-geometry.ts` (edit: `positions1`/`normals1` streams at locations 6/7), `packages/render-webgl/src/gl-geometry.ts` + unlit/lit programs (edit: `morphWeight0` uniform + blend), tests, `tests/browser/morph.spec.ts` | 2 (spec row first — see §4) |

## 4. Packets

**WP-SK.1 [S] — landed 2026-09-10 (#92), kept as the record.** Mirror `SkinnedShadowProgram`: a `skinnedShadowShaderSource()` in
`wgpu-skinning.ts` that prefixes `skinningWgsl(1)` to the existing shadow vertex stage
(read `wgpu-shadow.ts`'s depth-only pipeline and its bind group 0), a lazily created
pipeline (fail-once flag, §61 diagnostic `"webgpu-shadow-skinned-compile-failed"`)
acquired on the first skinned caster, binding the joint palette at group 1 with the
dynamic offset `packPalette` returns; delete the skip. Tests: fake-device transcript
shows the skinned pipeline bound once and the palette offset per item; browser gate: a
skinned quad casts a shadow (counted dark pixels > 0 where the bind-pose caster would
miss). Update `COMPATIBILITY.md` §2 WebGPU row wording ("shadow still skips" → shipped).

**WP-SK.2 [S] — A2.** `skinVertices(geometry, palette: Float32Array, out: { positions: Float32Array; normals?: Float32Array })`:
per vertex, 4 influences, `position' = Σ w_i · M_{j_i} · p` (and normals with the
palette's upper-3×3, no inverse-transpose at this tier — state it), pure, allocation-
free, insertion-ordered. **Not** exposed as an engine query of skinned positions on any
node (§33 rule): it is a free function over buffers the caller owns. Tests: two-bone
rotation matches a hand computation to 1e-12; golden checksum in the determinism suite
over 600 steps of the existing skinned-pose scenario.

**WP-SK.3 [S] — A3.** `computeSkinnedBounds(geometry, palette, out: Box3)` over WP-SK.2's
positions (scratch buffers cached per geometry id/version); `Mesh.boundsMode` opt-in;
`buildRenderList`'s culling and `pick.ts`'s bounds tier read it when set. Default stays
bind-pose (RFC §6). Tests: an animated arm swung outside bind bounds is culled under
`"bind-pose"` and drawn under `"skinned"`; picking hits the deformed arm only under
`"skinned"`.

**WP-SK.4 [M] — A4.** First: draft the §54 amendment sentence (morph target `k` occupies
`POSITION_k`/`NORMAL_k` at locations `6 + 2(k−1)` / `7 + 2(k−1)`, one target shipped,
`JOINTS_1`/`WEIGHTS_1` keep their reserved slots — hand it to the lead; the lead adds the
row **before** A4 edits code). Then: `BufferGeometry` gains optional `positions1`/`normals1`
(same length rule as `positions`, validated §85), the WebGL geometry cache uploads them at
6/7, unlit + lit programs gain a `uniform float morphWeight0` applied as
`p = mix(p0, p1, w)` when the attribute is present (compile a variant only when the
geometry carries the stream — the same lazy discipline as skinning), `render-list.ts`'s
`morphWeights[0]` feeds it. Tests: fake-GL sequence shows the variant used only for
morphing meshes; browser: a quad morphing to a diamond at `w = 1` changes the counted
silhouette pixels. WebGPU: **skips** morphing meshes with the standard "opaque/skip"
diagnostic in this packet (documented; follow-up).

## 5. Lead's closing packet

Spec rows (WP-SK.4 layout; WP-SK.1 §62 row); `COMPATIBILITY.md` §2; RFC 0003 residue
paragraph; `TODO.md`, `MEMORY.md`, `CHANGELOG.md`. Gate as in the other plans plus
`bunx playwright test --project=webgpu`.

## 6. Traps

- Do not add `typeName` to `Bone`; do not lerp palettes; do not return skinned positions
  from any node API.
- Locations 6/7 are **not** free until the amendment row exists.
- 48 is a declared constant, not a device query; do not query `MAX_VERTEX_UNIFORM_VECTORS`.
