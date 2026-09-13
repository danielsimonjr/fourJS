# RFC 0001 residue — node-material follow-ups: subagent plan

**Status:** plan only. Written 2026-09-10 against `claude/rfc-review-planning-s2clzd`.
Scope is the `TODO.md` row "RFC 0001 residue" as re-read in the RFC's
*Post-acceptance corrections* (2026-09-10). **Not everything in that row is scheduled
here**: the row's items are post-1.0 by the RFC's own §6 and by the tracker's tiering.
This plan takes the four that are packet-sized and leave the closed operator union
closed; it names the rest as gated. **Crew:** ≤ 4 haiku-class agents, disjoint files.
**Format:** `docs/plans/IMPLEMENTATION_PLAN.md` §2 packets; §1 ground rules apply.

## 1. Scope decision

| Residue item | This plan | Why |
| --- | --- | --- |
| Node-material / graph-effect pixel golden (owed by the RFC's prototype §, never landed) | **WP-NM.1** | Pure test debt; no design |
| Source maps (per-node provenance on `SHADER_COMPILATION_FAILED`) | **WP-NM.2** | Additive diagnostics; both emitters already own the ordered walk |
| Lighting-aware graphs (a `lights` node family bound to R-17's `SceneLights`) | **WP-NM.3** | Prerequisite exists (`packages/render/src/lights.ts`); closed union grows by data-only nodes, which is the tier the RFC allows |
| Uniform blocks (std140) with the measurement the RFC asked for | **WP-NM.4** | Measurement first; the WebGPU node pipeline already packs a `NodeUniforms` block, so this is "make WebGL match, and measure" |
| Reusable functions / named subgraphs, conditional variants, storage-buffer nodes, data-declared operators (alternative E) | **gated** — each widens the serializable graph's shape (§79) or the operator union; needs an RFC or an amendment row, not a packet | RFC §1, §6; RFC 0002 §81 note |

## 2. Anti-hallucination sheet

| Fact | Pinned at |
| --- | --- |
| The graph is a closed union of node kinds: `constant, uniform, attribute, texture, time, compose, swizzle, unary, binary, mix` (read the full union before adding one) | `packages/materials/src/shader-graph.ts:110-160` |
| `ShaderUnaryOp` includes `"angle"` (2026-09-06); `"uv"` is nameable in the screen domain, other attributes are not | `shader-graph.ts:66-94` |
| GLSL emitter `emitShaderGraphGlsl(graph)` → `EmittedNodeShader`; program `GlNodeProgram`; cache `GlNodeProgramCache` keyed on emitted source; `registerNodeMaterialPipeline()` | `packages/render-webgl/src/gl-node-program.ts:320, 431, 657, 759` |
| WGSL emitter `emitShaderGraphWgsl(graph)` → `EmittedWgslNodeShader`; store `WgpuNodePipelineStore`; `registerWebgpuNodeMaterialPipeline()`; node uniforms already packed into an all-`vec4` `NodeUniforms` uniform block | `packages/render-webgpu/src/wgpu-node-program.ts:36-45, 508, 754, 1624` |
| Compile failure is `FourError` `SHADER_COMPILATION_FAILED` with source + driver log in `context` | `gl-node-program.ts` (grep `SHADER_COMPILATION_FAILED`), `packages/core/src/errors.ts:23` |
| `ScreenEffect = CopyEffect \| ColorGradeEffect \| OutputTransformEffect \| GraphEffect`; `GraphEffect { kind, graph, uniforms, textures? }` | `packages/render/src/effect-pass.ts:284-314` |
| R-17 light contract: `SceneLights`, `DirectionalLightSource`, `PointLightSource`, `SpotLightSource`, `AmbientLightSource`, `MAX_PUNCTUAL_LIGHTS = 8`, first-N-in-traversal-order rule | `packages/render/src/lights.ts:20-40, 74-260` |
| Node materials are **unlit at this tier** by decision (RFC 0001, spec rev 1.11: sequenced R-14 → R-17 → R-13) | `packages/materials/src/node-material.ts:13-20`, `render-list.ts:585` |
| Pixel goldens live in `tests/visual/<name>.spec.ts` + `<name>.spec.ts-snapshots/` under the Playwright `visual` project; read `tests/visual/text.spec.ts`'s header ("Why a golden is sound here") before adding one | `tests/visual/`, `playwright.config.ts:336` |
| `ShaderOperatorRegistry` + `SHADER_OPERATORS` token exist; factories produce **closed** nodes; the registry method is `register` (no `registerShaderOperator` symbol exists) | `packages/materials/src/shader-operators.ts`, `capabilities.ts:29` |
| Materials package deps: `core, math` only — no render import ever | `packages/materials/package.json` |
| Size gate: example budgets in `.size-limit.json`; the recorded law is "+0.75 kB gzip per compiled-at-init pipeline" — anything new must stay lazy and registered | `tools/size-budgets.mjs`, RFC 0001 §4 |
| Spec: §60's shipped/deferred split is normative text (rev 1.11); moving an item from deferred to shipped needs an amendments-table row | `docs/SPECIFICATION.md` §60 and row 1.11 |

## 3. Roster and waves

| Agent | Owns | Wave |
| --- | --- | --- |
| **A1 — golden** | `tests/visual/node-material.spec.ts` (+ snapshots), `tests/browser/fixtures/node-material-page.ts` (read-only reuse; if it lacks a deterministic scene, add `tests/visual/fixtures/node-material-golden-page.ts`) | 1 |
| **A2 — source maps** | `packages/materials/src/shader-graph.ts` (edit: optional `label?: string` on every node — read §79 first: additive optional field, document-unchanged when absent), `packages/render-webgl/src/gl-node-program.ts` (edit: provenance table in the emitter, richer `SHADER_COMPILATION_FAILED.context`), `packages/render-webgpu/src/wgpu-node-program.ts` (same), tests in both backends' `tests/` | 1 |
| **A3 — lighting nodes** | `packages/materials/src/shader-graph.ts` (**append-only** new node kinds — coordinate with A2 through the lead: A2 edits existing node shapes, A3 adds kinds; the lead merges), `packages/materials/src/node-material-builder.ts`, `packages/render/src/render-list.ts` (lit node kind), both emitters' *lighting sections* (new functions, called from a single hook each emitter exposes), tests | 2 (after A2's node-shape edit lands) |
| **A4 — uniform blocks + measurement** | `packages/render-webgl/src/gl-node-program.ts` (a `NodeUniforms` UBO path mirroring WebGPU's packing — **after** A2), `benchmarks/node-uniforms.mjs` + results, `tools/size-budgets.mjs` row | 2 |

## 4. Packets

### WP-NM.1 [S] Pixel golden for a node material and a graph effect — **A1**

Reads: `tests/visual/text.spec.ts` (the category argument), `tests/browser/node-material.spec.ts`,
`tests/browser/fixtures/node-material-page.ts`. Build one deterministic scene (a quad with a
`NodeMaterialBuilder` graph mixing `uv`-driven gradient with a `time`-free constant; a
`GraphEffect` inverting colour) rendered once with `WebglRenderer` at a fixed 256×256; add
`tests/visual/node-material.spec.ts` with `toHaveScreenshot` under the `visual` project's
existing tolerance; commit the snapshot. Done when `bunx playwright test --project=visual`
is green twice in a row (stability), and the spec header states why the golden is sound
(no text, no host paint, no time).

### WP-NM.2 [S] Per-node provenance on compile failure — **A2**

Both emitters walk the graph in order and emit one statement per node. Add a
`provenance: readonly { nodeIndex: number; label?: string; line: number }[]` to
`EmittedNodeShader` / `EmittedWgslNodeShader` (line = first emitted line for that node), and
on `SHADER_COMPILATION_FAILED` include `context.provenance` plus, when the driver log names
a line, `context.node` resolved through it. Optional `label?: string` on `ShaderNode`
members is additive; serialization must round-trip it when present and omit it when
absent (extend `packages/serialization` tests only if node materials serialize there —
grep `ShaderGraph` in `packages/serialization/src` first; if absent, no change).
Tests: a graph that emits invalid GLSL through a deliberately bad `constant` (e.g. NaN
literal handling — check what the emitter does with `NaN` first; if it validates, force a
failure through the fake-GL harness `tests/integration/helpers/recording-gl.ts`'s
compile-failure switch) reports the offending node index; WGSL twin via the fake device.
Done when both backends' tests are green and the emitted source for every existing
graph fixture is **byte-identical** to before (provenance is metadata, not emission).

### WP-NM.3 [M] Lighting-aware graphs — **A3**

Design fixed here so no agent improvises: add node kinds `lightDirection`,
`lightColor`, `ambientLight` (data-only; no callbacks) that lower to the **same uniforms
`LitProgram` already binds** (read `packages/render-webgl/src/gl-lit.ts` and the WGSL
`wgpu-lit.ts` for the uniform names and the `MAX_PUNCTUAL_LIGHTS` array layout; copy the
binding code, do not re-derive it). A graph using any of them makes the material's render
item kind `"node-lit"` (new `RenderItemKind` member, mirroring `"skinned-lit"`'s
precedent) so `buildRenderList` attaches `SceneLights`. Builder gains `lightDirection(i)`,
`lightColor(i)`, `ambientLight()`. Both emitters gain one function each
(`emitLightingPrelude`) called only when the graph reaches those kinds — reachability
analysis already exists (RFC 0001 §1). Tests: emission includes the light uniforms only
when reached; a lit node material under one directional light shades a normal-facing quad
brighter than an away-facing one in the fake-GL sequence test; GL-sequence golden
(`tests/integration/node-materials.test.ts`) updated. Spec: amendments row moving
"lighting-aware graphs" from deferred to shipped in §60 (lead). Done when
`bun run test`, `bun run test:suites`, `bun run size` unchanged for examples that use no
node material.

### WP-NM.4 [S] std140 uniform block on WebGL + the measurement — **A4**

WebGL 2 supports UBOs; the WebGPU node pipeline already packs `NodeUniforms`. Port that
packing to `gl-node-program.ts` behind the **same** `NodeUniforms` layout (all `vec4`,
std140-trivial), keeping the per-uniform `uniform4f` path as the fallback when
`getUniformBlockIndex` is unavailable (it is not on WebGL 2, but the counting-GL test
double may not implement it — read `tests/integration/helpers/recording-gl.ts` and extend
the double with `uniformBlockBinding`/`bindBufferBase` counters first). Measurement:
`benchmarks/node-uniforms.mjs` — 1 000 node-material draws with 8 uniforms each, calls
per frame before/after (the counting seam), recorded in `benchmarks/results/`, registered
in `SUITE`. Done when GL-sequence tests are updated deliberately (the call sequence
changes — that is the point; re-record with the reason in the test), size unchanged.

## 5. Lead's closing packet

Merge A2/A3's `shader-graph.ts` edits; spec row 1.15 for WP-NM.3; `docs/guides/custom-shaders.md`
gains the lighting nodes and the provenance context; RFC 0001's residue paragraph and
`TODO.md` row updated; MEMORY; CHANGELOG. Gate: `bun run build && bun run lint && bun run test && bun run test:suites && bun run coverage && bun run examples:build && bun run size && bun run check-spec && node tools/check-docs.mjs && bunx playwright test --project=visual`.

## 6. Traps

- Never emit user source; every new node is data. No `custom` node kind.
- `@fourjs/materials` cannot import `@fourjs/render` — light *uniform names* are
  strings both sides agree on, declared in materials as constants and consumed by render.
- `angle` already exists; do not add a second `atan2`.
- The cache key is the emitted source; provenance must not enter the key.
