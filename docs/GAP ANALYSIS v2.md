# fourJS — Gap Analysis v2

**Date:** 2026-08-29
**Tree ref:** `df572c6` on branch `claude/tools-integration-rji2sr` (working tree clean; this
analysis is read-only apart from the superseded-pointer paragraph it adds to v1 and the
first-run measurement recorded into
`tests/browser/webgpu/webgpu-readpixels-region.spec.ts`'s header per that suite's
convention).
**Supersedes:** `docs/GAP ANALYSIS v1.md` (2026-08-08, tree `e0ddd3b`), which stays in place
as the campaign's running record. Unlike v0 — frozen at filing — v1 was **amended in place**
as the campaign advanced: its rows carry dated closure banners through 2026-08-29, so it is
both the previous analysis and the campaign log. Read v2 for final status; read v1 for the
per-row arguments and the order things fell in; read v0 for why each finding was filed.
**Spec baseline:** `docs/SPECIFICATION.md` revision 1.12 (2026-08-29).

**Method.** v1's method, applied to v1 itself: every filing row (`A-*`, `R-*`, `PH-*`,
`D-*`), every §5 register row, and every closure banner was re-read against source at
`df572c6` — named exports grepped, named files opened, named tests confirmed present and in
the suites — never against `CHANGELOG.md`, `TODO.md`, or `MEMORY.md` alone. Where a claim
names a measurement, the mechanism (benchmark script + committed result) was confirmed
rather than every number re-run. The full house gate suite was then run once, on this tree,
as the campaign-closing verification (§8). Nothing in `packages/*` was edited: a closing
pass records, it does not patch. Where this pass found v1 and the tree disagreeing, the tree
wins and the disagreement is filed in §7 — honesty over tidiness.

The v0 ID space is kept verbatim. `S-*` still means `docs/AUDIT-120.md`'s staged items.

---

## 1. Executive summary

### Headline

**The campaign is over, and the ledger balances.** Of 97 filings: **74 closed** (each at a
named, dated tier), **21 partially closed** with the residue named and owned, **2 open**
(both minor, both with a staged design and a named owner packet), and **0 blocked on
RFCs** — all five RFCs (0001–0005) were accepted 2026-08-21 and implemented 2026-08-28/29.
The rendering tier, which v1 called "now the project" (26 of 37 open items), collapsed from
26 open to 2: the lighting chain, the 2D vector stack, text, skinning, shader graphs,
picking, raster painting, and the entire WebGPU backend (WP-R1.1–R1.9) all landed between
v1's date and this one.

Honest qualifications, in v1's own tradition:

- "Closed" still means **closed at a named tier**, and the tier is declared in source with a
  dated note naming what it defers. The 21 partial rows and the residue index (§6) are the
  map of what "done" does not include. Nothing was found claiming more than it shipped.
- Four of the 74 closures are **status changes this document itself makes** — rows whose v1
  text lagged the tree (`A-19`, `A-20`, `R-3`, `R-31`; see §7.2). Each was verified in
  source before being counted.
- Every discrepancy this pass found is **documentation-level** (stale or duplicated v1 rows,
  stale tracker lines). No code-level discrepancy was found: every named export, file, test,
  golden, and spec revision that any row claims was verified present at the tip.

### Counts by tier — final

| Tier                      | Filed | Closed | Partially closed | Open |
| ------------------------- | ----- | ------ | ---------------- | ---- |
| Application (`A-1…A-28`)  | 28    | 18     | 10               | 0    |
| Rendering (`R-1…R-41`)    | 41    | 31     | 8                | 2    |
| Simulation (`PH-1…PH-22`) | 22    | 19     | 3                | 0    |
| Doc defects (`D-1…D-6`)   | 6     | 6      | —                | —    |
| **Total**                 | 97    | 74     | 21               | 2    |

v1's duplicate-filing note still applies: `A-2`/`PH-13`, `A-22`/`PH-18`, `A-8`/`R-2`/`PH-19`
and `R-22`/`PH-10` are shared closures, so the 74 represent 69 distinct pieces of work.

### The campaign in five dates

- **2026-08-06/07** — the keystone wave (v1 §2's 42 closures): materials base, sort,
  registries, render targets/graph/effects, physics tuning/serializers, §97a.
- **2026-08-08/09** — the lighting chain (`R-15`→`R-13`→`R-17`→`R-18`), per-view culling
  (`R-8`), batching (`R-9`/`R-10` key 3–4), the whole 2D vector stack
  (`R-25`→`R-24`→`R-23`→`R-16`→`R-26`), force fields (`PH-8`), spaces (`PH-12`), rigs
  (`R-36`), the composition root (`A-6`).
- **2026-08-13** — `Text` (`R-28`) and sampler state (`R-30`).
- **2026-08-21** — the owner decision day: all five RFCs accepted; stencil (`R-7`),
  geometry base (`R-21`), `ScreenCamera` (`R-37`), character controllers (`PH-11`/`11b`),
  rollback (`PH-20`), event-dispatch split (`PH-21`), batched fields (`R-34`), mipmaps
  (`R-30b`), texture loader (`A-19` assets half), WP-R1.1.
- **2026-08-28/29** — the RFC implementations (0002, 0003, 0001, 0005, 0004 in that order),
  §67 clipping, WP-R1.2–R1.9 (**`R-1` closed** — the WebGPU backend is real), GPU particles
  (`R-31`), §82 compute + the `ComputePass` promotion, glTF (`A-19`), analytic picking
  (`A-11`), the §58 paint-object tier (`R-16` final), §61 `readPixels` whole + region
  (`Rectangle2`), the character-controller example (tenth site), and the documentation truth
  sweep.

---

## 2. Closed — the final ledger

One line per filing: the closure date, and the tier where the closure is narrower than the
spec section. Every pointer named by v1 for these rows was re-verified at `df572c6`; the
per-row arguments live in v1 and in the dated source notes.

### Application (18)

| ID     | §                | Closed     | At what tier / how                                                                                                                                                                                                                                                                                     |
| ------ | ---------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `A-1`  | 84               | 2026-08-07 | 9 of 11 counters measured (two more discharged by `A-6` 08-08); `gpuFrameTime` + `contacts` staged `NaN`-with-a-reason in `stats.ts` — re-verified                                                                                                                                                     |
| `A-2`  | 40               | 2026-08-07 | With `PH-13`; display-only enforced by test                                                                                                                                                                                                                                                            |
| `A-3`  | 81, 45           | 2026-08-28 | RFC 0002 implemented as accepted; `PLUGIN_API_VERSION = "0.1.0"` verified; token spelling executed 08-29                                                                                                                                                                                               |
| `A-6`  | 45               | 2026-08-08 | Composition root; two recorded refusals (`app.input`/`app.diagnostics`) stand                                                                                                                                                                                                                          |
| `A-7`  | 45               | 2026-08-07 | `Application.resize` + surface options                                                                                                                                                                                                                                                                 |
| `A-8`  | 45, 62           | 2026-08-07 | With `R-2`/`PH-19` (registries)                                                                                                                                                                                                                                                                        |
| `A-9`  | 72, 83           | 2026-08-07 | Per-pointer teardown; `pointerType` end-to-end 08-09                                                                                                                                                                                                                                                   |
| `A-10` | 72               | 2026-08-07 | Keyboard tier                                                                                                                                                                                                                                                                                          |
| `A-11` | 71               | 2026-08-29 | Both halves: pixel/GPU-id via RFC 0005 (08-29) + analytic `"geometry"` tier with `node.hitTestMode` (08-29); render-side residues re-filed (RFC 0005 residue, §6)                                                                                                                                      |
| `A-14` | 73, 79           | 2026-08-07 | `registerUISerializers()`                                                                                                                                                                                                                                                                              |
| `A-15` | 79, 6a           | 2026-08-07 | Throw-by-default on unserializable components                                                                                                                                                                                                                                                          |
| `A-17` | 79               | 2026-08-07 | Duplicate-id refusal                                                                                                                                                                                                                                                                                   |
| `A-19` | 77, 78           | 2026-08-29 | Loader tier: `createTextureLoader` (08-21) + §78 glTF 2.0 core (`createGltfLoader`/`instantiateGltf`, 08-29). Renderer-side §77 residue re-owned under `R-30`'s row; four unsampleable material texture slots wait on the multi-unit widening (R-13 follow-up). **Status change this pass** — see §7.2 |
| `A-20` | 82               | 2026-08-29 | §82 is no longer silent in either sense: `ComputePass` descriptor in `@fourjs/render` (the Q3 promotion), `compute()`/buffers on WebGPU (WP-R1.8), browser-proven; structurally absent on WebGL 2 by §62 tier, stated in source. **Status change this pass** — see §7.2                                |
| `A-22` | 97, 114–117, 97a | 2026-08-06 | Spec revision 1.7                                                                                                                                                                                                                                                                                      |
| `A-23` | 96               | 2026-08-07 | Limits, `parseUntrustedJson`, CSP grep test                                                                                                                                                                                                                                                            |
| `A-26` | 90               | 2026-08-07 | Five tables, solver block generated; §2 truth-swept to the tip 08-29, `check-compat` green                                                                                                                                                                                                             |
| `A-28` | —                | 2026-08-05 | Corrections + the `check-docs` gate (10 retired claims pinned at the tip)                                                                                                                                                                                                                              |

### Rendering (31)

| ID     | §          | Closed     | At what tier / how                                                                                                                                                                                                                                                                                                            |
| ------ | ---------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `R-1`  | 62         | 2026-08-29 | WP-R1.1 (08-21) → WP-R1.9 (08-29), all nine packets; successor filings recorded (canvas2d/svg stub tiers, WebGPU skinned kinds). Plan: `docs/plans/R1-WEBGPU_PLAN.md`                                                                                                                                                         |
| `R-2`  | 62, 45     | 2026-08-07 | Backend registry                                                                                                                                                                                                                                                                                                              |
| `R-3`  | 62         | 2026-08-29 | Capability record widened to §62's full list (WP-R1.1, 08-21; 14 members verified in `renderer.ts`, incl. rev 1.10's `maximumSkinningJoints`) + the required/optional **declaration API** (`RendererResolveOptions.capabilities`, WP-R1.9, 08-29); `A-26`'s backend table consumes it. **Status change this pass** — see §7.2 |
| `R-4`  | 61, 48, 63 | 2026-08-07 | Minimal tier; samplable depth landed with `R-18` (08-09); `readPixels` whole (WP-R1.6, 08-28) + region (`Rectangle2`, 08-29, both backends)                                                                                                                                                                                   |
| `R-5`  | 63         | 2026-08-07 | Linear-pass tier                                                                                                                                                                                                                                                                                                              |
| `R-6`  | 70         | 2026-08-07 | Effect tier (copy + grade); output transform joined 08-08 (`R-15`), `GraphEffect` 08-28 (RFC 0001) — 4 fixed + user graphs of §70's list; the rest blocked on resources (float targets), not API                                                                                                                              |
| `R-7`  | 67         | 2026-08-21 | Stencil-substrate tier; the §67 **clipping API** (`Node.clip`, plane allocator, mask passes) discharged 08-28. Residue: alpha masks, 3D clip planes, per-item scissor (named in `clip.ts`)                                                                                                                                    |
| `R-8`  | 64, 87     | 2026-08-09 | Per-view-list + frustum-cull tier                                                                                                                                                                                                                                                                                             |
| `R-11` | 57, 66     | 2026-08-06 | Blend state honoured                                                                                                                                                                                                                                                                                                          |
| `R-13` | 59         | 2026-08-08 | Scalar + base-colour-map PBR tier                                                                                                                                                                                                                                                                                             |
| `R-14` | 60         | 2026-08-28 | RFC 0001 implemented as accepted; spec revision 1.11; GLSL golden + WGSL golden (WP-R1.9)                                                                                                                                                                                                                                     |
| `R-15` | 60a        | 2026-08-08 | Policy + opt-in-transform tier; the defaults **flip** is the recorded owner decision (§6)                                                                                                                                                                                                                                     |
| `R-16` | 58         | 2026-08-29 | Solid-paint + full-stroke tier 08-09; **paint-object tier 08-29** (`registerShapePaints()`, gradients/patterns exact via `NodeMaterial`, golden `shape-paint-glsl.json`). Conic waits on §60's angle operator (amendment, §6); §52 fringe open; `ShapeMaterial` settled unshipped                                             |
| `R-17` | 68         | 2026-08-09 | Eight-lamp forward tier                                                                                                                                                                                                                                                                                                       |
| `R-18` | 69         | 2026-08-09 | Directional-shadow-map tier; WebGPU parity 08-29 (WP-R1.7)                                                                                                                                                                                                                                                                    |
| `R-19` | 53         | 2026-08-07 | uvs/colours/maps                                                                                                                                                                                                                                                                                                              |
| `R-20` | 53         | 2026-08-07 | Nine 3D primitives                                                                                                                                                                                                                                                                                                            |
| `R-21` | 53         | 2026-08-21 | `Geometry` base + `BoundingVolume` + deep `clone()`                                                                                                                                                                                                                                                                           |
| `R-23` | 50         | 2026-08-09 | Solid-fill tier; all fourteen §50 rows with `R-16`                                                                                                                                                                                                                                                                            |
| `R-24` | 51         | 2026-08-09 | Model + flatten tier (13 of 17 operations)                                                                                                                                                                                                                                                                                    |
| `R-25` | 52         | 2026-08-09 | Polygon tier; first cross-platform §33 golden                                                                                                                                                                                                                                                                                 |
| `R-26` | 50 (SVG)   | 2026-08-09 | Path-data tier; `<svg>` document tier is an owner seam decision (§6)                                                                                                                                                                                                                                                          |
| `R-28` | 49, 56     | 2026-08-13 | Bitmap-label tier; adopted by every example 08-21                                                                                                                                                                                                                                                                             |
| `R-31` | 36, 112    | 2026-08-29 | Mechanism + integrator (WP-R1.8) **and** the wiring: `simulation: "gpu"` functions end-to-end on WebGPU; absent on WebGL 2 by §62 tier, structurally. §27 GPU fields and depth-buffer collisions refused-not-pretended                                                                                                        |
| `R-34` | 27, 112    | 2026-08-21 | `sampleAll` batch seam; 100k 3-field stack 16.58 → 4.51 ms (result committed)                                                                                                                                                                                                                                                 |
| `R-35` | 113, 120   | 2026-08-07 | One-draw debug overlay                                                                                                                                                                                                                                                                                                        |
| `R-36` | 44, 47     | 2026-08-09 | Helper + rig tiers; first-person 08-21 (with `PH-11`), trackball 08-21 (with `R-37`). Staged: fly, shake/impulse, stereo/XR — with arguments                                                                                                                                                                                  |
| `R-37` | 47, 48     | 2026-08-21 | `ScreenCamera`, three origins, pixel-exact                                                                                                                                                                                                                                                                                    |
| `R-38` | 46         | 2026-08-08 | Named layers                                                                                                                                                                                                                                                                                                                  |
| `R-40` | 118        | 2026-08-07 | §118 flagship, browser-gated                                                                                                                                                                                                                                                                                                  |
| `R-41` | 119        | 2026-08-21 | Instrument panel on the `ScreenCamera` recipe; 159 → 59 draws                                                                                                                                                                                                                                                                 |

### Simulation (19)

| ID      | §       | Closed     | At what tier / how                                                                                                                    |
| ------- | ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `PH-1`  | 37, 23  | 2026-08-07 | Stage 1 (08-06) + stage 2 tuning access + `teleport()`                                                                                |
| `PH-2`  | 37, 20  | 2026-08-06 | Handle escape hatches (`ab13840`)                                                                                                     |
| `PH-3`  | 23, 25  | 2026-08-06 | Collider-destroy mass heir                                                                                                            |
| `PH-4`  | 23      | 2026-08-06 | `derivedMass` mirror                                                                                                                  |
| `PH-5`  | 24, 37  | 2026-08-07 | Runtime collider add/remove                                                                                                           |
| `PH-6`  | 34      | 2026-08-07 | `worldConfiguration` in replay format                                                                                                 |
| `PH-7`  | 34, 37  | 2026-08-06 | 3D registry rebuild parity                                                                                                            |
| `PH-8`  | 26, 27  | 2026-08-09 | `ForceField`/`ForceFieldSystem` at §39 step 5; structural contract with `@fourjs/particles`                                           |
| `PH-10` | 54, 17  | 2026-08-28 | RFC 0003 implemented (with `R-22`'s skinning rows); spec revision 1.10; `skinned-pose.json` golden                                    |
| `PH-11` | 12, 44  | 2026-08-21 | Kinematic tier + `PH-11b` swept tier (same day); `PH-11c` push policy is the one owner-gated residue (§6)                             |
| `PH-13` | 40      | 2026-08-07 | With `A-2`                                                                                                                            |
| `PH-14` | 25      | 2026-08-06 | Tuning capabilities + one-shot warning                                                                                                |
| `PH-15` | 32      | 2026-08-06 | Sleep-threshold mechanism                                                                                                             |
| `PH-16` | 22, 42  | 2026-08-06 | `type`-setter warning                                                                                                                 |
| `PH-17` | 6a, 79  | 2026-08-07 | Component serializers                                                                                                                 |
| `PH-18` | 114–117 | 2026-08-06 | With `A-22`                                                                                                                           |
| `PH-19` | 20, 37  | 2026-08-07 | `solver: "auto"`                                                                                                                      |
| `PH-20` | 33      | 2026-08-21 | `RollbackBuffer` (exact-step, never re-simulates, no input log — three argued deviations)                                             |
| `PH-21` | 39      | 2026-08-21 | `PhysicsEventSystem` at step 9; steps 7–8 closed as not splittable; the split's first consumer landed 08-29 (playground sensor tally) |

### Documentation (6)

`D-1`…`D-6` — all corrected 2026-08-05, four gated by `tools/check-docs.mjs` (which now also
pins ten retired claims).

---

## 3. Partially closed (21)

The shipped tier is real and verified; the "remains" column is the precise residue, restated
from the newest version of each v1 row and re-checked against source.

| ID      | Shipped (verified)                                                                                                                                                                                                                                                                                                                                                                | Precisely what remains                                                                                                                                                                                                                                             | Tracked in                                                    |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `A-4`   | §85 build-mode half (`DEV`/`devWarn`/`devAssert`)                                                                                                                                                                                                                                                                                                                                 | The §85 validation catalogue; `devAssert` conversions; §42 warn routing; §41 envelope check                                                                                                                                                                        | `TODO.md` "A-4 remainder"                                     |
| `A-5`   | §83 accounting tier                                                                                                                                                                                                                                                                                                                                                               | All six §83 development warnings; creation-site capture; duplicate-load warning; materials + solver handles unaccounted                                                                                                                                            | `TODO.md` "A-5 remainder"                                     |
| `A-12`  | **10** of §73's 16 controls (canvas view landed 08-29 with RFC 0004)                                                                                                                                                                                                                                                                                                              | Text input (§56/S-6), scroll view + virtual list (§74/§67 — backend half unblocked by `R-7`'s clipping API), list, embedded viewport (§48), menu + tooltip (widget-reachable §9 clock)                                                                             | `UI_STAGED`, `TODO.md`                                        |
| `A-13`  | Keyboard half; reduced-motion policy discharged by `A-6`                                                                                                                                                                                                                                                                                                                          | DOM mirror, screen-reader updates, high contrast, scalable text (all behind a DOM integration policy)                                                                                                                                                              | `UI_STAGED`, `TODO.md`                                        |
| `A-16`  | §79 pairs; `SceneResourceCatalog`; the §79 manifest substrate (08-21)                                                                                                                                                                                                                                                                                                             | The umbrella preload-then-catalog wiring (the packet that knows what a geometry/material _is_ — `instantiateGltf` is now the second consumer of the shape); the §80 `.four` binary format                                                                          | v1's row, `TODO.md`                                           |
| `A-18`  | 9 of 13 §76 capabilities incl. hashing + manifest (08-21); first dependency-loading loader (glTF, 08-29)                                                                                                                                                                                                                                                                          | Streaming; manager-level dependency tracking (refcounts across sub-assets); progress reporting; worker decoding; hot reload                                                                                                                                        | `TODO.md` "A-18 remainder"                                    |
| `A-21`  | **Ten** runnable, browser-gated examples (tenth: `character-controller`, 08-29)                                                                                                                                                                                                                                                                                                   | Only the three §93 stand-in directories — the owner retire-or-write call (register row 12)                                                                                                                                                                         | `docs/AUDIT-120.md` S-8, `TODO.md`                            |
| `A-24`  | Renderer context-loss suite at three tiers (08-08)                                                                                                                                                                                                                                                                                                                                | The other §92 categories (scene+renderer, picking, assets+materials); the §83 dispose-after-failed-restore corner (owner)                                                                                                                                          | v1's row, `TODO.md`                                           |
| `A-25`  | Release machinery whole (Changesets, publish-name mapping, workflows, minimal site)                                                                                                                                                                                                                                                                                               | The real site; three owner steps: stub packaging (row 10), `NPM_TOKEN` + Pages (row 11)                                                                                                                                                                            | `TODO.md` "A-25 owner decisions"                              |
| `A-27`  | Eleven benchmark scripts + runner + committed results                                                                                                                                                                                                                                                                                                                             | The non-gating CI trend job — regressions visible only via `git diff` over `results/`                                                                                                                                                                              | `benchmarks/README.md`, `TODO.md`                             |
| `R-9`   | Consecutive-run batching (sprites + shapes, opt-in, pixel-identical); glyph batching closed by `R-28`; WebGPU uploader (WP-R1.3)                                                                                                                                                                                                                                                  | Instancing (`R-22`), atlas grouping, persistent/multi-draw (not core WebGL 2), batching the shaded pipelines, default-on (A-4's seam)                                                                                                                              | v1 §3's row, `TODO.md`                                        |
| `R-10`  | All four §66 sort keys for this tier                                                                                                                                                                                                                                                                                                                                              | The keys-3+4 single-comparator design (a real staged question, not an omission); OIT, weighted-blended, depth-prepass control, alpha-to-coverage, premultiplied policy                                                                                             | v1 §3's row                                                   |
| `R-12`  | §57 base **7 of 7 members** (stencil 08-21); of the eight family members: `StandardMaterial` shipped (08-08), `NodeMaterial` shipped (08-28), `ShaderMaterial` permanently withdrawn (rev 1.11), `ShapeMaterial` settled unshipped; `RenderItemKind` widened (`"node"`, skinned kinds) with lazily-registered pipelines behind `registerNodeMaterialPipeline()` and its WGSL twin | `TextMaterial`, `LineMaterial`, `PhysicalMaterial`, `ComputeMaterial`; a fully general pipeline registry beyond the node/skinned registrations (RFC 0001 residue)                                                                                                  | `material.ts`, RFC 0001; v1's row is stale here (§7.1)        |
| `R-22`  | Skinning rows end-to-end (08-28, RFC 0003)                                                                                                                                                                                                                                                                                                                                        | GPU morph path, material groups (`R-12`), **instancing** (the §86 blocker), indirect, dynamic buffers, LOD/impostors/merging, CPU skinning, bone textures, dual-quaternion, skinned shadow caster, skinned bounds/picking; WebGPU skinned kinds (successor filing) | `mesh.ts`, §54 rev 1.10                                       |
| `R-27`  | `Shape2D` + twelve §50 nodes; `Text` (08-13); `Mesh` (08-28); `frustumCulled` (08-09)                                                                                                                                                                                                                                                                                             | `depthMode`; `material: Material[]` (wanted for §54 submeshes); `Line3D`, `PointCloud`, `CustomRenderable`                                                                                                                                                         | `renderable.ts`; v1's second copy of this row is stale (§7.1) |
| `R-29`  | The `frame` half (08-08); §55 at 5 of 11                                                                                                                                                                                                                                                                                                                                          | Named-frame atlas (→ `@fourjs/assets`); sprite animation clips (→ §14/§17 step tracks)                                                                                                                                                                             | v1 §4's row                                                   |
| `R-30`  | Sampler-state tier (08-13) + mipmaps/anisotropy/`minFilter` (`R-30b`, 08-21); WebGPU parity (WP-R1.2)                                                                                                                                                                                                                                                                             | Cube/array/3D targets (pipeline-entangled), compressed containers, §77 map roles, video + `ImageBitmap`/canvas sources, async upload + residency diagnostics — now also carrying `A-19`'s renderer-side residue                                                    | `TODO.md` "A-19 remainder", `R-30b` row                       |
| `R-39`  | `half`-row discipline; eleven scripts; animated-glyph row measured (08-13)                                                                                                                                                                                                                                                                                                        | CI integration + trend reporting; mesh-instance row (`R-22`); the §112 present-half measurement (`R-33`)                                                                                                                                                           | `benchmarks/README.md`, `TODO.md`                             |
| `PH-9`  | §18 state-machine tier                                                                                                                                                                                                                                                                                                                                                            | Blend trees; layered + additive animation; clip events from a controller; "any state" transitions                                                                                                                                                                  | `controller.ts` dated notes, `TODO.md`                        |
| `PH-12` | Physics tier (`RigidBody.space` + refusals, 08-09); §8 vocabulary in `@fourjs/core`                                                                                                                                                                                                                                                                                               | The node-level `NodeSpace` component packet (its render-side consumer exists since `R-37`); §21's `"local-plane"` mapping (refused loudly meanwhile)                                                                                                               | v1 §4's row                                                   |
| `PH-22` | Roll-up: `22a`/`22e` closed; `22n` half; `22i` advanced twice (skeleton blocker fell 08-28)                                                                                                                                                                                                                                                                                       | `22f` anchors (owner which-pose decision); `22b/c/d` blocked on Rapier 0.19.3; `22g/h/k/m` cross-tier; `22i` limits/ownership/convergence contract; `22j` §102 scope (owner); `22l` naming-only (owner)                                                            | v1 §4's row, `ik.ts`, `TODO.md`                               |

---

## 4. Open (2)

| ID     | §   | State at the tip                                                                                                                                                                                                                                                                                                                                                           |
| ------ | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `R-32` | 36  | Feature-tier particle rendering (texture, rotation, `sizeMode`, soft edges, additive blend). The design is staged in v1's row and confirmed against source: it is `render-webgl`'s packet (widen the 8-float instance stream, program variant). Its stated sequencing constraint — after the ScreenCamera wave — has been satisfied since 08-21, so it is schedulable now  |
| `R-33` | 112 | The §112 100 000-particle browser measurement. After `R-34` the simulation runs at ~27% of the fixed-step budget on the canonical host, so this is a measurement task with headroom, on hardware that is not SwiftShader; the honest form reports simulate-ms and present-ms separately. The GPU arm now also exists (`R-31`), which the eventual measurement should cover |

---

## 5. The §5 owner-decision register — final state

Verified row by row against the register itself, the RFCs, the spec's amendments table, and
source.

**Decided and implemented (16 rows).** Rows 1–9 (RFCs 0001/0002/0003 and their questions) —
DECIDED 2026-08-21, IMPLEMENTED 2026-08-28; spec revisions 1.9/1.10/1.11 verified, one
recorded deviation on row 9 (`Bone` carries no `static typeName`; its §79 identity is
`"scene:bone"`). Rows 15–17 (RFC 0004) and 18–20 (RFC 0005) — DECIDED 2026-08-21,
IMPLEMENTED 2026-08-29; §77a + revision 1.12, `ALLOWED_LETTERED`, split colour-space
defaults, `PickingService`/`PickProvider`/Alternative D all verified in source. Rows 21–22
(the R-1 plan's questions) — recommendations adopted in the implementation: registration
stayed an explicit opt-in, the capability record widened once (WP-R1.1), and `ComputePass`
landed in `@fourjs/render` exactly as row 22 recommended (the Q3 promotion, 08-29).

**The owner-only remainder (5 register rows + 6 recorded off-register decisions):**

| Item                                                                                                                                                                                                                                                                                                                                                   | Where recorded                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Row 10 — stub packaging (publish the five reserved stubs, or restructure)                                                                                                                                                                                                                                                                              | Register row 10, `TODO.md` "A-25 owner decisions", `.changeset/README.md`                                         |
| Row 11 — `NPM_TOKEN` secret; enable Pages                                                                                                                                                                                                                                                                                                              | Register row 11, `TODO.md`                                                                                        |
| Row 12 — §93 stand-in retirement (retire two, write `mixed-scene` — or write all)                                                                                                                                                                                                                                                                      | Register row 12, `docs/AUDIT-120.md` S-8, `TODO.md`                                                               |
| Row 13 — the batched spec-amendment pass. **Correction:** row 13's original four queued items were discharged by revision 1.8 the same day v1 was written (the row was never marked — §7.1). What survives is the _successor_ queue: §60's angle operator (RFC 0001's one-row closed-union amendment, conic's sole blocker) and any items queued since | Register row 13; revision 1.8's amendments entry; `TODO.md` (shape-paint row)                                     |
| Row 14 — payload policy: budget vs the opt-in registry split                                                                                                                                                                                                                                                                                           | Register row 14, `MEMORY.md` 2026-08-07 (R-6), `TODO.md`                                                          |
| `PH-11c` — how much impulse a kinematic character imparts (§26/§23/§32 policy)                                                                                                                                                                                                                                                                         | `TODO.md` "PH-11c"; seam named in `swept-character-controller.ts` (`applyImpulseAtPoint` at `ShapeCastHit.point`) |
| §60a defaults flip — move both `"linear"` defaults to sRGB and move goldens deliberately                                                                                                                                                                                                                                                               | `MEMORY.md` 2026-08-08 (R-15); dated opt-in notes in source                                                       |
| Prettier exemption — make the spec's de-facto exemption explicit (`.prettierignore`)                                                                                                                                                                                                                                                                   | `MEMORY.md` 2026-08-07 gotcha ("owner call: make the exemption explicit")                                         |
| `PH-22f` — joint anchors' which-pose decision                                                                                                                                                                                                                                                                                                          | v1 §4.3, `TODO.md`                                                                                                |
| `PH-22j` — §102 solver scope (ERRATA E-3 standing decision)                                                                                                                                                                                                                                                                                            | v1 §4.3, `docs/ERRATA.md`                                                                                         |
| `R-26` `<svg>` document tier — XML-reader seam decision                                                                                                                                                                                                                                                                                                | `TODO.md` "R-26 follow-ups"                                                                                       |

Two smaller recorded owner calls ride along: `PH-22l` (`Clock` naming-only) and `A-24`'s
§83 dispose-after-failed-restore corner (the fix breaks a tested property; needs a policy).

---

## 6. Residue index

Every staged-with-owner or staged-with-named-packet item at the tip, and where its staging
note lives. (Owner-gated items also appear in §5; this is the complete map.)

- **Owner decisions:** the eleven §5 items above.
- **`@fourjs/render` / backends:** RFC 0005 residue — instanced-particle id arm + two §86
  picking rows (`TODO.md` "RFC 0005 residue"); WebGPU skinned kinds (`R-1` successor filing,
  v1's R-1 row); canvas2d/svg stub tiers (stubs **by decision**, RFC 0004 §6 + `TODO.md`);
  `R-32`'s staged design (v1's row); `R-30` remainder incl. `A-19`'s renderer half
  (`TODO.md` "A-19 remainder"); `R-12`'s four family members (`material.ts`, RFC 0001);
  §52's anti-alias fringe + conic paints (`TODO.md` shape-paint row; `shape-paint.ts`);
  §67 alpha masks / 3D clip planes / per-item scissor (`clip.ts`); tone-mapping operator
  (waits on float targets — `effect-pass.ts` §70 table); `R-10`'s comparator design (v1's
  row); values-as-uniforms lowering for animated gradient stops (`shape-paint.ts`
  determinism section).
- **`@fourjs/assets` / umbrella:** `A-18` remainder (streaming, dependency tracking, progress,
  worker decoding, hot reload — `TODO.md`); `A-16`'s preload-then-catalog wiring + §80
  (v1's row); glTF refusal list widening (CUBICSPLINE → `@fourjs/animation` tangent decision,
  morph targets → RFC 0003 GPU-morph staging — `TODO.md` "A-19 remainder").
- **`@fourjs/ui` / input:** `A-12`'s six remaining widgets, `A-13`'s DOM-gated set
  (`UI_STAGED`, `TODO.md`); §72 dispatch on `PickProvider` results (input packet,
  `TODO.md`).
- **Animation/motion/physics:** `PH-9` residue (`controller.ts`); `PH-12`'s `NodeSpace`
  packet (v1's row); `PH-22i` IK contract (`ik.ts` staging note); the three staged rigs
  (`camera-rigs.ts` / v1's R-36 row); platform carry recipe published
  (`swept-character-controller.ts`).
- **Diagnostics/benchmarks/CI:** `A-27`/`R-39` CI trend job (`benchmarks/README.md`);
  `A-4`/`A-5` catalogues (`TODO.md`); `R-33`'s measurement (v1's row;
  `tests/browser/particles.spec.ts` header states the ~1 800-particle scale);
  `registerRapierSolver` dual-wasm payload — per-dimension registration is the recorded fix
  (`TODO.md`); `INVALID_RENDER_GRAPH` §89 code (R-5 follow-up, `TODO.md`); the §-indexed
  `STAGED.md` both v0 analysts proposed remains unwritten (v1 §6's recommendation stands).

---

## 7. Discrepancies found by this pass

All are documentation-level. Nothing in `packages/*` was touched; the tracker one-liners are
listed for the owner to land.

### 7.1 Defects inside v1 itself

v1 was amended in place by many hands, and it shows. None of these change any status; they
are why v2 exists as a clean restatement.

1. **The §3 partially-closed table is duplicated wholesale** — a second header row and a
   stale copy of every row follow the current ones (the stale copies lack `R-28`'s `Text`
   landing in `R-27`, carry the older `R-39`, and omit `R-9`).
2. **§4.1 duplicates `R-28`/`R-29`/`R-30`** — the second `R-28` copy is the pre-close "No
   `Text` node" text, contradicting the closed row above it.
3. **§4.1 duplicates `R-36`/`R-37`** — the second `R-36` copy is the stale "PARTLY CLOSED
   (helper tier)" text.
4. **§4.6 Group 3 and Group 7 paragraphs are each duplicated/garbled** mid-sentence where
   updates were appended rather than merged.
5. **`A-24`'s row is malformed** in both copies of the §3 table (a five-column v0-format row
   in a four-column table).
6. **§1's executive counts were frozen at 2026-08-08** (42/14/4/37) while the rows beneath
   them closed in place — by the tip they contradict the document's own banners. §1 above is
   the corrected final count.
7. **Register row 13 was never marked** although revision 1.8 discharged its four queued
   items on v1's own date (§5).
8. **Stale row details:** `R-12` still says "eight §57 members missing" (four are
   shipped-or-settled); `R-27`'s residue still lists `Mesh` (shipped 08-28); `A-12` still
   counts canvas view as missing (shipped 08-29); v1 §4.5's "§97a is already partially
   stale" bullet was discharged by revision 1.8, its "graph artifacts are stale" bullet by
   the tip commit (`df572c6` regenerates them), and its `color.ts`-at-0% bullet by `R-15`
   (100×4 at the tip).

### 7.2 Rows whose status v2 itself changes (verified in source first)

- **`A-20` → CLOSED 2026-08-29.** v1's row still reads "still literally silent"; the tree
  disagrees: `ComputePass` is a `@fourjs/render` descriptor (the Q3 promotion), WebGPU
  implements `compute()` with exact browser-proven readback (WP-R1.8), WebGL 2's answer is
  the structural absence §62's capability record reports, and `CHANGELOG.md` carries two
  dated entries. Silent in neither code nor record.
- **`R-3` → CLOSED (widening 2026-08-21, declaration API 2026-08-29).** v1's row still
  reads "2 of 11 categories, no declaration API"; `renderer.ts` carries §62's full record
  (13 members) and `RendererResolveOptions.capabilities` is the declaration API, consumed by
  `"auto"` and by `docs/COMPATIBILITY.md`'s regenerated table.
- **`A-19` → CLOSED at the loader tier 2026-08-29.** v1's row wording lags the tree:
  `CHANGELOG.md` and `TODO.md` record the closure with the renderer-side residue re-owned
  under `R-30`'s remainder row — where it belongs, since every remaining item is renderer
  work.
- **`R-31` → counted closed.** v1's own banner says CLOSED (mechanism 08-29, wiring 08-29)
  but the row still sits in the "open" table; v2 files it in §2.

### 7.3 Tracking-file staleness (for the orchestrator's landing pass)

- `TODO.md`'s RFC-queue row still says "Remaining R-1 packets: WP-R1.8 (in flight), WP-R1.9"
  — both landed 08-29.
- `TODO.md` carries stale unchecked duplicates below their DONE rows: "A-11 / RFC 0005 —
  owner decision", "A-11 analytic tier", and a second "Character-controller example
  follow-up".
- `TODO.md`'s RFC 0004 residue row ends in a garbled fragment ("listed as guide
  15).ts`'s header and §77a).").
- The two pre-existing Prettier warnings the R-5 follow-up names remain (the repo-wide
  `prettier --check` is not a gate; the spec-exemption decision is §5's).

### 7.4 Code-level discrepancies

**None found.** Every export, file, test, golden, benchmark result, spec revision and
tooling gate named by a v1 row was verified present and as described at `df572c6`.

---

## 8. The closing gate table

Run once, in full, on `df572c6`, 2026-08-29, as the campaign-closing verification.

| Gate                        | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                | **PASS** (exit 0, all 24 packages)                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm run coverage`         | **PASS** (exit 0; the ≥95% per-package gate held everywhere it applies)                                                                                                                                                                                                                                                                                                                                                                                                      |
| `pnpm test:suites`          | **PASS** — 90 files, 661 tests, 0 failures                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `pnpm test:browser` (full)  | **PASS** — **101/101** in 5.6 m, 0 skips (the WebGPU adapter was present). Includes `webgpu-readpixels-region.spec.ts`'s **first run** — byte-for-byte region equality on a real adapter, no validation error; measurement recorded into the spec header per the suite's convention. The `blending.spec.ts` RECOVER flake v1 §4.5 recorded did **not** reproduce. Existing goldens **byte-unchanged** (`git status` clean apart from this document's three sanctioned edits) |
| `pnpm lint`                 | **PASS** (exit 0)                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm run docs`             | **PASS** (TypeDoc exit 0, **0 warnings**)                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `pnpm typecheck:tests`      | **PASS** (exit 0)                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `node tools/check-spec.mjs` | **PASS** — OK, 129 sections, 103 code blocks                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `node tools/check-docs.mjs` | **PASS** — OK, 10 runnable examples, 3 placeholders, 10 retired claims pinned                                                                                                                                                                                                                                                                                                                                                                                                |
| `pnpm check-compat`         | **PASS** — 2 adapters, 2 reserved solver packages; `docs/COMPATIBILITY.md` current                                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm graph:check`          | **PASS** — all 24 browser-safe packages node-free                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm graph:duplicates`     | **PASS** — 0 current, 0 baselined, 0 new                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `pnpm run size`             | **PASS** (exit 0, all seven budgets within their limits — first-2d 52.21/150 kB (§86's minimal-2D-app gate), first-3d 37.88/38, particles 36.26/36.5, ui-demo 44.91/45, flagship 1.56/1.65 MB, twin 958.71/1000 kB, character-controller 898.45/950 kB)                                                                                                                                                                                                                      |

---

## 9. Closing observations

- **The tier discipline held to the end.** Every closure re-verified for this document
  declares its tier in source with a dated note naming what it defers, and no tier label
  was found overstating what shipped. The one thing that rotted was v1's own text — rows
  edited in place by many hands accumulated duplicates and stale copies (§7.1). The lesson
  v1 drew about tracking files ("a batch that lands code without touching a tracking file is
  invisible within a day") has a v2 corollary: **a status document amended in place by many
  hands needs a closing re-read by one** — which is this document.
- **Byte-identity remained the working discipline** through the largest packets of the
  campaign (R-1's transcript-identity tests across three backends, R-16's
  registered-vs-not transcripts, RFC 0001's node-free identity), and it is still why the
  closures are trustworthy.
- **The remaining work has no internal blockers.** Both open rows are schedulable today;
  all 21 partial rows name their residue and its owner; everything owner-gated is
  enumerated in §5. The free list is empty in the only sense that matters: nothing waits on
  anything but a decision or a scheduled packet.

---

_End of Gap Analysis v2._
