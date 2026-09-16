# fourJS — Gap Analysis v0

> **SUPERSEDED 2026-08-08 by `docs/GAP ANALYSIS v1.md`** (which re-analyses the tree at
> `e0ddd3b`, after the 2026-08-07 closure campaign). This document is kept unchanged as the
> historical record — its 97 filings, closure plans, dependency graphs, and dated closure
> banners remain the evidence trail behind v1's status table, and v1 cites them by ID. Read
> v1 for current status; read this for why each finding was filed and what closing it was
> expected to take. Two caveats a reader of the banners below should carry: the banner set is
> **incomplete** — commits `ab13840` and `fe8eb6f` (both 2026-08-06) closed `PH-2`, `PH-3`,
> `PH-4`, `PH-7`, `PH-14`, `PH-15`, `PH-16`, `PH-1` stage 1, `R-11`, and `R-12`/`R-10` at
> their base tiers without adding banners here or entries in `CHANGELOG.md`; and several
> banners read `CLOSED` for a closure that shipped at a **named tier** narrower than the spec
> section (`R-4`, `R-5`, `R-6`, `A-1`, `A-10`), with the residue named in v1 §3 and §4.
> Per the `MEMORY.md` convention, nothing below was rewritten.

**Date:** 2026-08-05
**Tree ref:** `cff56e7` on branch `claude/tools-integration-rji2sr` (working tree clean; this analysis is read-only — nothing in the tree was edited to produce it).
**Spec baseline:** `docs/SPECIFICATION.md` (revision per its own amendments table), Parts I–XIII, §1–§120 plus the lettered sections.

**Method.** Three independent Opus analysts each took one tier of the tree and read it against the specification end to end:

| Analyst | Tier                        | Packages / areas                                                                                                                                        | Spec range                                    | ID series                             |
| ------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------- |
| A       | Application & cross-cutting | `input`, `text`, `ui`, `assets`, `serialization`, `diagnostics`, `four`, `examples/`, `docs/guides/`, `tests/`, `tools/`, CI, `website/`, `benchmarks/` | §71–§101, §113–§120, plus §40/§45/§46/§55/§56 | `A-1…A-28`                            |
| B       | Rendering                   | `render`, `render-webgl`, `render-webgpu`, `render-canvas`, `render-svg`, `geometry`, `materials`, `particles`                                          | §43–§70, §86, §112, §118–§120                 | `R-1…R-41`, doc defects `D-1…D-6`     |
| C       | Simulation                  | `physics`, `physics-rapier`, `physics-box2d`, `physics-soft`, `motion`, `animation`, `scene`, `core`, `math`                                            | §6–§42, §98–§102, §104–§111                   | `PH-1…PH-22` (renumbered — see below) |

Every claim in every fragment was verified against source, not against `MEMORY.md`, `TODO.md`, `CHANGELOG.md`, or `docs/AUDIT-120.md`. Where the tracking files and the tree disagree, the tree wins and the disagreement is itself filed as a finding. Each finding carries a **severity**, an **effort** estimate, and a **provenance** marker distinguishing gaps the repository already records from gaps nobody wrote down anywhere (_silent_).

**ID renumbering applied at assembly.** The simulation analyst's series was originally `S-1…S-22`. `docs/AUDIT-120.md` already owns an `S-1…S-7` namespace for its staged items (layers, §24 shapes, debug-draw wiring, §50/§51 primitives, lighting), and the analyst flagged the collision. The series has been renumbered one-for-one to `PH-*` throughout this document — `S-n` → `PH-n`, `S-22x` → `PH-22x` — including every intra-fragment cross-reference. Any bare `S-*` appearing in this document refers to `AUDIT-120.md`'s staged items.

---

## Executive summary

### Headline counts

**91 findings** across the three tiers, plus **6 documentation defects** filed separately by the render analyst.

| Tier                | Findings | Severity breakdown                                                                                                                  |
| ------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Application (`A-*`) | 28       | 2 Critical · 14 High · 11 Medium · 1 Low                                                                                            |
| Rendering (`R-*`)   | 41       | 9 blocker · 20 major · 8 minor (+ `R-38`/`R-39`/`R-40` graded major and `R-41` mixed in place, outside the analyst's summary table) |
| Simulation (`PH-*`) | 22       | 1 blocker · 11 major · 9 minor (+ `PH-22`, a roll-up of 14 recorded absences)                                                       |
| Doc defects (`D-*`) | 6        | all cheap, all misleading                                                                                                           |

The two severity vocabularies are the analysts' own and are not merged here; read _Critical_ ≈ _blocker_ and _High_ ≈ _major_.

### The three keystone unblockers

The render analyst's dependency graph is the cleanest structure in the whole analysis, and it identifies three packets that between them unblock most of the rendering backlog. These are the highest-leverage work in the document:

1. **`R-12` — §57's abstract `Material` base.** The material set is currently _closed_: three concrete classes, no base type, 8 of 10 spec family members absent. `R-12` directly unblocks `R-7`, `R-10`, `R-11`, `R-13`, `R-16`, `R-27`, `R-29`, `R-32`, and transitively `R-14` (§60 shaders) → `R-1` (backends), `R-6` (§70 post-processing), `R-13` (§59 PBR). Bundled with `R-11` and `R-10` it also fixes two live correctness defects — invisible alpha, and interleaved transparency.
2. **`R-19` + `R-20` — standard vertex attributes (uvs) and the nine missing 3D primitives.** §53 ships 2 of 8 standard attributes and 3 of 11 primitives: nothing can be textured and there is no sphere, cylinder, capsule, or torus. Together these unblock `R-9` (batching), `R-13`, `R-22`, `R-30`, `R-32`, `R-35` (the debug overlay), and are prerequisites for both flagship demos.
3. **`R-4` — render targets, `createTexture`, `readPixels`.** Nothing renders off-screen today. `R-4` unblocks `R-5` (§63 render graph) → `R-6` (post-processing) and `R-18` (§69 shadows), plus minimaps/portals and the §92 visual test tier.

One sequencing constraint rides on top: **`R-15` (§60a colour management) must land before `R-13`/`R-17`**, or the PBR and lighting work is built on a non-linear pipeline and rebuilt afterwards.

### Top Critical / blocker items across all tiers

| ID              | Tier   | Finding                                                                                                            | Why it tops the list                                                                                                      |
| --------------- | ------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `A-1`           | App    | §84 runtime statistics (`app.stats.*`) do not exist                                                                | Gates §119, `A-5`, `A-27`; silent                                                                                         |
| `A-21`          | App    | Four §93 worked scenes and **both** §118/§119 flagships are empty `.gitkeep` directories that shipped docs link to | The project's largest single gap; §118 carries the spec's own success criterion                                           |
| `PH-1`          | Sim    | Post-registration property changes never reach the solver — **and `rigid-body.ts` documents the opposite**         | Spec-conformance blocker plus an actively misleading module header; user writes a velocity, sees nothing, gets no warning |
| `R-12`          | Render | §57 `Material` base and 8 of 10 family members absent; material set closed                                         | Keystone (above)                                                                                                          |
| `R-19` / `R-20` | Render | 2 of 8 standard attributes; 3 of 11 3D primitives                                                                  | Keystone (above)                                                                                                          |
| `R-4`           | Render | No render targets / `createTexture` / `readPixels`                                                                 | Keystone (above)                                                                                                          |
| `R-2`           | Render | No backend selection; `renderer: "auto"` does not exist                                                            | Mirrored by `A-8` and `PH-19` (`solver: "auto"`) — the same unimplemented affordance in three tiers                       |
| `R-9`           | Render | No batching: one draw call per renderable and per sprite                                                           | Makes 4 of §86's 10 performance rows unreachable (`R-39`)                                                                 |
| `R-14`          | Render | §60 shader / node-material system: no user shaders at any level                                                    | Needs an RFC before code                                                                                                  |
| `R-16`          | Render | §58 paints, fills, strokes: no `Paint`, no gradients, no `StrokeStyle`                                             | Silent; blocks the entire 2D vector story with `R-23`/`R-24`                                                              |
| `R-24`          | Render | §51 `Path` model absent                                                                                            | Silent; blocks `R-23`, SDF text, `R-41`                                                                                   |

### The structural root cause all three analysts converged on

This is the single most important finding in the document, and it was reached independently three times.

**The repository's staging discipline is genuinely excellent — and it is indexed on the wrong key.**

All three analysts went looking for dishonesty and found none. Where an absence was staged, it was staged well: dated notes at the would-be home in source, exported `DEBUG_DRAW_STAGED` / `UI_STAGED` constants so absence is discoverable at runtime, deliberate _type-level_ rejection of unsupported options (`simulation: "gpu"` is an excess-property error, not a silent no-op), a guide that opens with a section titled "Honest state", and `AUDIT-120.md`'s `S-1…S-7` as model staging records. The application analyst put it flatly: _"I found no case of a staging note that was false — the honesty discipline holds."_

The failure mode is structural. **The discipline is indexed on §120's MVP checklist and on the phase plan §103–§113a.** A spec section that §120 never names, and that no phase was ever assigned, produces _no record at all_ — not a staging note, not a TODO row, not an audit line. `AUDIT-120.md` was structurally incapable of catching these, and says so itself under "What this audit does not cover". The whole-plan audit (WP-11.6) was meant to close that hole and, on this evidence, did not.

The silent sections — those with no owner, no staging note, and no audit row anywhere in the repository:

| §       | Subject                                                                 | Findings |
| ------- | ----------------------------------------------------------------------- | -------- |
| §54     | Mesh, instancing, LOD, morph targets, skinning                          | `R-22`   |
| §58     | Paints, fills, strokes                                                  | `R-16`   |
| §60     | Shader / node-material system                                           | `R-14`   |
| §63     | Render graph                                                            | `R-5`    |
| §67     | Clipping, masks, stencils                                               | `R-7`    |
| §70     | Post-processing                                                         | `R-6`    |
| §84     | Runtime statistics                                                      | `A-1`    |
| §81     | Plugin system (already referenced by §79)                               | `A-3`    |
| §96     | Security requirements                                                   | `A-23`   |
| §8      | `SpaceMode`                                                             | `PH-12`  |
| §26/§27 | Force fields applied to **rigid bodies** (they apply to particles only) | `PH-8`   |

Nine further application findings (`A-1`, `A-2`, `A-3`, `A-4`, `A-5`, `A-20`, `A-23`, `A-26`, `A-28`) share the same cause: no phase §103–§113a was ever assigned to them. §53's nine missing 3D primitives (`R-20`) fell through the same crack because §120 says only "basic 3D meshes".

Both the render and application analysts independently proposed the same remedy: **a `STAGED.md` indexed on § number rather than on §120 rows.** See _Cross-cutting findings_ below.

---

## Cross-cutting findings

### (a) The documentation-drift cluster

Three analysts independently found shipped documentation asserting things the tree contradicts. Merged and deduplicated below — `A-28`'s examples row and `D-1` are the same defect, filed twice, and `R-40`/`R-41` cite the same `AUDIT-120` / `CHANGELOG` pair as `D-1`/`D-5`.

| #   | Source         | Location                                    | Claim                                                                                                                                                                                                                                | Reality                                                                                                                                                                                                                                                    |
| --- | -------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `A-28`         | `ROADMAP.md:7`                              | "currently at the scaffold-and-specification stage; **nothing on this roadmap has shipped yet**"                                                                                                                                     | The implementation plan completed 2026-08-02. `CLAUDE.md` and `MEMORY.md` carried the identical staleness until 2026-08-05 and both now flag it in place; `ROADMAP.md` was missed in that sweep.                                                           |
| 2   | `A-28`         | `README.md:13`                              | "§120 MVP audit stands at **42/43**; lighting is the single staged absence"                                                                                                                                                          | `AUDIT-120.md` was amended 2026-08-04 to **43/43**; lighting shipped at MVP tier that day.                                                                                                                                                                 |
| 3   | `A-28` + `D-1` | `docs/AUDIT-120.md:125–126`                 | "**10 example applications** under `examples/` … incl. the five §93 guide scenes and the flagship"                                                                                                                                   | 6 real examples exist. `examples/flagship/*` and four `first-*`/`mixed-scene` dirs hold only `.gitkeep`. Directly contradicts `docs/Architecture/TEST_COVERAGE.md:189`. (**`A-21`**, **`R-40`**, **`R-41`**)                                               |
| 4   | `A-28`         | `docs/AUDIT-120.md:126`                     | "`tests/visual/` **is an empty placeholder**"                                                                                                                                                                                        | A visual suite with 2 committed goldens landed 2026-08-04. (**`A-24`**)                                                                                                                                                                                    |
| 5   | `D-2`          | `docs/AUDIT-120.md`, Rendering table        | sprites "§55; **batched**"                                                                                                                                                                                                           | Not batched — one VAO bind and one draw per sprite (`webgl-renderer.ts:766-800`). (**`R-9`**)                                                                                                                                                              |
| 6   | `A-28`         | `tests/README.md:6–7`                       | integration and visual category lists                                                                                                                                                                                                | Describe §92's _taxonomy_, not the tests that exist. (**`A-24`**)                                                                                                                                                                                          |
| 7   | `A-28`         | `packages/fourjs/src/application.ts:8–13`   | §45's absent systems "arrive with the phases that build them"                                                                                                                                                                        | The plan is complete; no phase remains. (**`A-6`**)                                                                                                                                                                                                        |
| 8   | `A-28`         | `playwright.config.ts:20`                   | "There are no golden images"                                                                                                                                                                                                         | `tests/visual/` has them. (**`A-24`**)                                                                                                                                                                                                                     |
| 9   | `D-3`          | `docs/guides/materials-and-render-graph.md` | "Items sort by render layer, then kind…, then material"                                                                                                                                                                              | `compareRenderItems` compares `renderLayer` then `renderOrder` only (`render-list.ts:547`). (**`R-10`**)                                                                                                                                                   |
| 10  | `D-4`          | `docs/guides/custom-shaders.md`             | "three fixed, internal programs"                                                                                                                                                                                                     | Four since `LitProgram` landed 2026-08-04.                                                                                                                                                                                                                 |
| 11  | `D-5`          | `CHANGELOG.md:644`                          | "`examples/` gained … the two flagship demos (§118–119)"                                                                                                                                                                             | It gained two empty directories. (**`A-21`**, **`R-40`**)                                                                                                                                                                                                  |
| 12  | `D-6`          | `benchmarks/README.md`, §86 table           | remaining rows "are GPU-bound … need a GPU"                                                                                                                                                                                          | Four are blocked by _missing engine features_, not by hardware. (**`R-39`**)                                                                                                                                                                               |
| 13  | `PH-1`         | `packages/physics/src/rigid-body.ts:26–32`  | "`linearVelocity`, `angularVelocity`, `centerOfMass` and friends are what the engine pushes into the solver at `syncSceneToSolver` … Writing one between steps is therefore an authoring action that takes effect at the next sync." | **False for every dynamic body.** Nothing pushes them post-registration, and no warning fires. This is the most actively harmful row in the table: the others overstate progress, this one instructs the user to do something that silently does not work. |

Twelve of the thirteen are doc-only edits. Row 13 needs a doc correction _now_ (stage 1 of `PH-1`) even though its capability half is `L`.

Severity note: the application analyst grades this cluster **High, not Low**, and the reasoning generalises. `AUDIT-120.md` is the named exit artefact for §113a's clause "the §120 tooling list is complete", `MEMORY.md`'s standing-facts section instructs agents to trust these files, and the repository's documentation discipline is otherwise unusually strong. That is precisely what makes the drift corrosive — a reader who has correctly learned to trust the staging notes will also trust these.

### (b) The process fix both analysts named

Independently, the application and rendering analysts arrived at the same remedy, in two complementary halves:

1. **A `STAGED.md` indexed on § number, not on §120 rows.** One page, one row per specification section, stating for each: shipped / partial / staged / not assigned, with a pointer to the staging note or the finding ID. Because it enumerates §1–§120 exhaustively rather than filtering through §120's MVP bullet list, a section that no phase was ever assigned shows up as a blank row instead of vanishing. The render analyst's assessment is unambiguous: _"A one-page `STAGED.md` indexed on § number rather than on §120 rows would have caught every one of them."_
2. **A `tools/check-docs.mjs` companion to `tools/check-spec.mjs`, wired into CI next to `pnpm check-spec`.** Asserts the mechanically checkable subset of the drift cluster, so rows 1–12 above cannot recur:
   - every `examples/*` directory referenced by a README or a guide contains a real entry point (`main.ts`), not just a `.gitkeep`;
   - every count asserted in `AUDIT-120.md` matches a `git ls-files` query;
   - every § number in `STAGED.md` exists in `SPECIFICATION.md`, and every § in `SPECIFICATION.md` has a `STAGED.md` row (this is the check that closes the root cause);
   - claims about test-suite contents in `tests/README.md` and `playwright.config.ts` match what is on disk.

Corrections themselves should follow the repository's existing and good convention from `MEMORY.md`: **supersede with a dated in-place note, never silently rewrite.**

### (c) Unified priority matrix

Merged from the three analysts' own recommended orders and dependency graphs.

**Quick wins — small effort, immediate value, no decision required.**

| ID      | Tier | What                                                                                            |
| ------- | ---- | ----------------------------------------------------------------------------------------------- |
| `A-28`  | App  | Seven doc corrections + `check-docs.mjs` (rows 1–12 above)                                      |
| `A-9`   | App  | `PointerInput` leaks per-pointer state for every dead pointer id — a real leak, ~10 lines       |
| `A-15`  | App  | ~4-line `Node` getter closing a silent-data-loss path (unregistered components dropped on save) |
| `A-7`   | App  | `Application.resize` missing from §45's lifecycle                                               |
| `A-14`  | App  | UI widgets do not survive serialization                                                         |
| `A-17`  | App  | Restored node ids can collide with engine-assigned ids                                          |
| `PH-3`  | Sim  | First-collider mass loss + `colliderCount` leak                                                 |
| `PH-7`  | Sim  | 3D adapter misses joint-registry mismatch on a corrupt §34 envelope                             |
| `PH-14` | Sim  | §25 `rollingFriction`/`spinningFriction` accepted and ignored with no runtime signal            |
| `PH-16` | Sim  | `RigidBody.type` assignment silently desynchronises component from solver                       |

Add to this wave the doc-only half of `PH-1` (correct `rigid-body.ts`'s header and warn on the mutators) and `PH-2` (a public node → solver-handle route, `S` effort, which makes the `PH-1` escape hatch usable immediately).

**Keystone packets — larger, but each unblocks a wide surface.**

| ID                        | Tier   | Unblocks                                                                                            |
| ------------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| `R-12` (+ `R-11`, `R-10`) | Render | `R-7`, `R-10`, `R-11`, `R-13`, `R-16`, `R-27`, `R-29`, `R-32`, and via `R-14`: `R-1`, `R-6`, `R-13` |
| `R-19` + `R-20`           | Render | `R-9`, `R-13`, `R-22`, `R-30`, `R-32`, `R-35`, both flagships                                       |
| `R-4`                     | Render | `R-5` → `R-6`, `R-18`; minimaps/portals; the §92 visual tier                                        |
| `A-1`                     | App    | §119, `A-5`, `A-27`                                                                                 |
| `A-10`                    | App    | `KeyboardInput` — the sole blocker on `A-13`'s accessibility requirement                            |

`R-15` (§60a colour management) is a scheduling constraint on this wave, not an independent packet: it must precede `R-13` and `R-17`.

**Decision-gated — needs an owner decision or an RFC before any code.**

| Item             | Decision required                                                                                                                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `A-22` / `PH-18` | Part X's public-API examples (§97, §114–§117) do not compile against the shipped surface. Either amend the specification to the shipped names or add aliases — **a spec amendment, owner decision**. Unblocks `A-21`, the largest single gap. |
| `A-3`            | §81 plugin system. Silent, already referenced by §79; needs an RFC before anything else.                                                                                                                                                      |
| `PH-10`          | Skeletal animation, skinning, morph targets — absent everywhere, spans `animation`, `scene`, `geometry`, `render`; needs an RFC. Overlaps `R-22`.                                                                                             |
| `R-14`           | §60 shader / node-material system. No user shaders at any level; the API shape is a design decision, not an implementation task.                                                                                                              |

**Long tail — real, staged, and correctly recorded; schedule normally.** `A-11`, `A-12`, `A-16`, `A-18`, `A-19`, `A-20`, `A-23`, `A-24`, `A-25`, `A-26`, `A-27`; `R-1`, `R-3`, `R-5`, `R-6`, `R-7`, `R-8`, `R-13`, `R-17`, `R-18`, `R-21`, `R-22`, `R-23`, `R-25`, `R-26`, `R-28`, `R-29`, `R-30`, `R-31`, `R-32`, `R-33`, `R-34`, `R-35`, `R-36`, `R-37`, `R-38`, `R-39`, `R-40`, `R-41`; `PH-5`, `PH-6`, `PH-8`, `PH-9`, `PH-11`, `PH-12`, `PH-13`, `PH-15`, `PH-17`, `PH-19`, `PH-20`, `PH-21`, and the fourteen roll-up items under `PH-22`. `A-23`, `A-25`, and `A-26` are fully self-contained and can run in parallel with anything.

---

# Application Tier & Cross-Cutting Concerns — Gap Analysis

**Scope:** `packages/{input,text,ui,assets,serialization,diagnostics,four}`, `examples/`, `docs/guides/`, `tests/`, `tools/`, CI, `website/`, `benchmarks/`; spec §71–§101 and §113–§120, plus §40/§46/§55/§56 as they land in this tier.
**Branch:** `claude/tools-integration-rji2sr` (read-only; nothing edited).
**Method:** every claim below was checked against source, not against `MEMORY.md`/`AUDIT-120.md`. Where the tracking files and the tree disagree, the tree wins and the disagreement is itself filed as a gap.

**Severity:** _Critical_ = a spec promise an application depends on, absent with no record. _High_ = spec promise absent or wrong, recorded but untracked, or a correctness defect. _Medium_ = recorded MVP-tier narrowing with real user cost. _Low_ = drift, naming, cosmetics.
**Effort:** S ≤ 1 packet, M = 1–2 packets, L = multi-packet / needs a decision first.

**Staging vocabulary used below:**

- **RECORDED** — a dated in-source or audit note names the absence and the reason.
- **SEMI-RECORDED** — noted somewhere (a guide, a README, a TODO comment) but not in `TODO.md`/`MEMORY.md`/`AUDIT-120.md`, so it is invisible to the tracking loop.
- **SILENT** — no note anywhere; discovered by reading the tree against the spec.

---

## A. Cross-cutting engine surfaces §98 assigns to a package that never built them

### A-1 — §84 runtime statistics (`app.stats.*`) do not exist

> **CLOSED (measurable tier) 2026-08-07** — `app.stats` exists
> (`ApplicationOptions.stats`, default off). `FrameStats` in `@fourjs/diagnostics`
> carries §84's **eleven** counters (this entry said twelve — the spec lists eleven);
> `cpuFrameTime`, `simulationTime`, `drawCalls`, `triangles`, `instances` are measured,
> `activeBodies` reachable via `recordSolverStatistics`. `gpuFrameTime`,
> `physicsStepTime`, `contacts`, `textureMemory`, `bufferMemory` staged as
> NaN-with-a-reason (A-5, A-6, §62 timestamp queries). Renderer counters arrive through
> an optional §61 capability (presence is the capability), not a `render` out-param.
> Stats-off is byte-identical in GL calls and allocation-free, proven. Unblocks A-5,
> A-27, §119's overlay data. Kept for the record.

**§84, §98 (`diagnostics`: "statistics, overlays, validation")** · **Severity: Critical** · **Effort: M** · **SILENT**

_What exists:_ `@fourjs/diagnostics` exports checksum, replay recorder/player/format, and debug-draw providers (`packages/diagnostics/src/index.ts`). `NullRenderer.renderCount`/`lastRenderRoot` (`packages/render/src/renderer.ts:488`) are test-double inspection fields, not statistics.

_What's missing:_ the entire §84 statistics block. `grep -rn "cpuFrameTime|drawCalls|textureMemory|activeBodies|bufferMemory" packages/*/src` returns **zero hits**. None of the twelve named counters exists, there is no `Stats` type, and `Application` has no `stats` member. §84 is the second half of the package's §98 charter and no phase was ever assigned it — §113 (Phase 10) shipped only "solver statistics" as `solverStatistics`/`solverJointStatistics` inside debug-draw.

_Why it matters beyond the letter of the spec:_ §119's engineering flagship (`torque and angular-velocity visualization`, `waveform charts`) and §113a's "benchmarked" exit both presuppose a live counter surface. `benchmarks/` measures out-of-process instead, which is why five §86 rows are unmeasurable (see A-24).

_Closure plan:_

1. Add `packages/diagnostics/src/stats.ts`: a mutable `FrameStats` record with §84's twelve fields plus a `reset()`; zero-allocation, written in place per frame (plan D7).
2. Producers write into it through narrow duck-typed sinks, exactly as `debug-draw.ts` reads through `SolverBodyAccess` — `@fourjs/diagnostics` may not import `render` or `physics`. `Renderer.render` gains an optional `stats` out-param for `drawCalls`/`triangles`/`instances`; `PhysicsWorld.step` for `activeBodies`/`contacts`/`physicsStepTime`; `Scheduler` for `simulationTime`.
3. `Application` owns one instance and exposes `app.stats` (A-6 is the same file).
4. `textureMemory`/`bufferMemory` need A-5's ownership tracking; ship them last or as `NaN`-with-a-note rather than guessed.

_Dependencies:_ A-5 (memory counters), A-6 (surface), and the render/physics analysts' packages for the sinks.

---

### A-2 — §40 `UnitSystem` never shipped, though §98 assigns it to `@fourjs/core`

> **CLOSED 2026-08-07** (one closure with PH-13) — shipped as
> `packages/core/src/units.ts` at the conversion/authoring tier §40 actually specifies:
> `UnitSystem`/`SI_UNITS`/`resolveUnitSystem`, the eight `To/FromDisplay` conversions,
> SI accessors, `unitSymbol`, `format*`. Display-only is enforced mechanically — an
> integration test forbids any other package importing the module and proves
> helper-authored values bit-identical to engine-unit authoring. Steps 1–2 of the plan
> done; step 3 (`PhysicsWorldOptions.units`) staged as a physics packet; step 4 blocked
> on A-16. No `ApplicationOptions.units` — §45 lists none. Kept for the record.

**§40, §98, §101** · **Severity: High** · **Effort: M** · **SEMI-RECORDED**

_What exists:_ `packages/core/src/conventions.ts` holds exactly one constant, `DEFAULT_GRAVITY_Y`. `docs/guides/units-and-numerical-stability.md:23` states the absence honestly ("no `UnitSystem` API has shipped … today the conversion layer is yours").

_What's missing:_ the `UnitSystem` interface, its `scale.lengthToMeters`/`massToKilograms` factors, and §101's "unit application in simulation". `grep -rn "UnitSystem|lengthToMeters|massToKilograms" packages/*/src` returns **nothing**. §40 opens with "fourJS should not silently assume that one world unit is always one meter" — today it silently does, everywhere.

_Why the record is inadequate:_ the only note lives in a guide. Nothing in `TODO.md`, `MEMORY.md`, or `AUDIT-120.md` names §40, so it is not on any backlog. §40 is also not a §120 row, which is precisely why the §120-scoped audit could not catch it.

_Closure plan:_

1. `packages/core/src/units.ts`: the §40 record verbatim, plus a frozen `SI_UNITS` default and a `resolveUnitSystem(partial)`.
2. Honor §40's own narrowing — `angle` and `time` govern _display and authoring input only_; add `toDisplay`/`fromDisplay` helpers and assert in tests that no engine signature changes.
3. `PhysicsWorldOptions` gains an optional `units`; `resolveGravity` scales by `lengthToMeters`; density→mass derivation scales by `massToKilograms`.
4. Serialize the unit system into the §79 document header so a scene reloads in its authored units (depends on A-16's format revision).

_Dependencies:_ physics analyst for step 3; A-16 for step 4.

---

### A-3 — §81 plugin system does not exist, and §79 already references it

> **RFC DRAFTED 2026-08-07** — `docs/rfcs/0002-plugin-system.md` proposes `PluginContext`
> as a typed capability bag (tokens declared by each registry's owning package, since §3.1
> gives `core` no dependencies), an explicit-registration-only lifecycle, and a §96
> boundary that is enforced (documents never name modules) rather than sandboxed. Five of
> §81's eleven extension points are real today, one partial, five absent. Status draft,
> **owner decision pending**; one blocking sub-question (`ApplicationOptions.plugins` vs
> the §40 precedent), and alternative E (do nothing) is genuinely defensible.

**§81, §98 (`core`: "plugin host (§81)"), §79, §90** · **Severity: High** · **Effort: L** · **SILENT**

_What exists:_ nothing. `grep -rn "FourPlugin|PluginContext" packages/*/src` returns **one hit**, and it is prose: `packages/serialization/src/serializer.ts:12` cites §79's "plugins register theirs (§81)" as the justification for the component-serializer registry.

_What's missing:_ the `FourPlugin` interface, `PluginContext`, install/uninstall lifecycle, dependency and compatibility-range declaration, and all eleven extension points. There is no staging note in `packages/core/src/**` — §98's `core` charter line ("plugin host (§81)") is simply unimplemented, and no phase §103–§113a scheduled it.

_Mitigating fact worth stating:_ the _shape_ §81 needs already exists in several places, independently invented — `ComponentSerializerRegistry` (§79), `SceneMigrationRegistry` (§80), the injectable `AssetLoader` value, `WidgetSkin`. A plugin host is largely a matter of unifying these behind one registration surface, not of inventing eleven new seams.

_Closure plan:_

1. RFC first (`docs/rfcs/`) — §95 requires one for a change of this reach, and §81's compatibility-range semantics interact with A-22's absent §90 tables.
2. `packages/core/src/plugin.ts`: `FourPlugin`, `PluginContext` as a bag of _registries_ (not of engine objects, which `core` cannot name), `PluginHost` with install/uninstall and topological dependency ordering.
3. `Application` grows `plugins` and installs during `initialize()` (§45's `install(): void | Promise<void>` is why it must be there and not in the constructor).
4. Retrofit the four existing registries as `PluginContext` members; do not move them.

_Dependencies:_ A-22 (compatibility ranges), A-6.

---

### A-4 — §85 validation is scattered and has no development/production split

> **CLOSED 2026-08-07 (build-mode tier).** `packages/core/src/dev.ts` ships
> `DEV`/`devWarn`/`devWarnOnce`/`devAssert` behind an optional `__FOUR_DEV__` define
> (dev-default, opt-out; identifier read only under `typeof`); §84's stats wiring,
> §6a's duplicate-component warning, and §83's new `auditResourceLeaks` are gated; all
> eight example builds define it false (0.46–0.52 kB gzip saved each; ui-demo
> 30.46/31). `tests/integration/dev-build-mode.test.ts` proves the stripping with a
> real bundler and mechanically enforces the §33 allowlist (simulation packages
> refused outright). **Still open under A-4:** the §85 validation catalogue (step 2),
> converting scattered scene/physics checks to `devAssert` (step 3), routing §42's
> authority-conflict warn through the channel (step 4).

**§85, §98 (`diagnostics`: "… validation (§84-85)"), §41** · **Severity: High** · **Effort: M** · **SILENT**

_What exists:_ real, well-tested validation, but in the wrong places and only for some of §85's list. `packages/physics/src/validation.ts` covers mass/inertia/dimensions/joint limits; `packages/scene/src/node.ts:293,301` catches scene-graph cycles; `packages/serialization/src/format.ts` refuses non-finite numbers and version mismatches; `packages/geometry` validates index ranges; `render-webgl` surfaces shader-compilation failures.

_What's missing:_

- No `@fourjs/diagnostics` validation module at all, despite §98 assigning §85 there.
- **Conflicting transform authority** — §42 requires a warning; `packages/scene/src/authority.ts` has the once-per-node warn map, but it is not reachable as a §85 diagnostic.
- **Singular transforms** — `camera.ts:173` notes `Matrix4.invert` "refuses singular input and leaves its elements alone" and warns nobody.
- **Unstable scales and extreme ratios**, and §41's normative 1e5-unit precision envelope ("validation (§85) warns beyond it") — `grep -rn "1e5|extreme"` over `scene`/`core` returns nothing. This is a spec clause with an explicit "warns" and no implementation.
- **Unsupported renderer features** as a validation category.
- The §85 closing requirement: _"Production builds may disable expensive validation while preserving essential safety checks."_ There is no build-mode flag, no `__DEV__` convention, no tree-shakable guard. Every check listed above ships in production unconditionally.

_Closure plan:_

1. `packages/core/src/dev.ts`: a `__FOUR_DEV__` boolean, statically replaceable by Vite/Rollup `define`, plus `devAssert`/`devWarn` helpers that minify to nothing when false. Add a size-limit row proving the production bundle drops them (`.size-limit.json` already gates 150 kB).
2. `packages/diagnostics/src/validation.ts`: the §85 catalogue as named, individually-toggleable checks over duck-typed inputs, plus §41's coordinate-envelope check.
3. Convert existing scattered checks to `devAssert` where they are expensive and leave them unconditional where they are safety (`FourError` throws stay).
4. Route §42's authority-conflict warn through the new channel.

_Dependencies:_ A-1 (same package, same frame hook); scene/render analysts for step 3.

---

### A-5 — §83 development warnings and ownership tracking are absent

> **PARTIALLY CLOSED 2026-08-07 (accounting tier).** §83's "reference counting or
> ownership tracking" now exists as _ownership-free accounting_: `resource-memory.ts`
> in `@fourjs/geometry` and `@fourjs/render` hold process-wide live-instance counts and
> byte totals for `BufferGeometry`/`Texture`/`RenderTarget`, fed at
> construction/mutation/disposal from new `byteLength` getters. Holding numbers
> rather than references is what keeps the tracker from being the leak it reports; a
> resource collected without `dispose()` is deliberately never subtracted. §84's
> `textureMemory`/`bufferMemory` are measured as of this packet (A-1 dependency
> discharged) via `recordResourceMemory`. **Still open:** the six development
> _warnings_ and creation-site capture (folded into A-4's dev-mode work), the
> AssetManager duplicate-load warning, and materials/solver-handle accounting.

**§83** · **Severity: Medium** · **Effort: M** · **SILENT**

_What exists:_ the disposal half of §83 is solid — `Disposable`, `disposeAll` (`packages/core/src/disposable.ts`), idempotent terminal `dispose()` on `Application`, `PointerInput`, `NullRenderer`, `Texture`, `ImageAsset`; and §83's reference counting exists in exactly one place, `AssetManager`.

_What's missing:_ all six §83 development warnings — leaked textures/buffers, disposed resources still in use, duplicate asset loads, detached nodes retaining listeners, stale physics handles, excessive per-frame allocations. Also the general "reference counting **or ownership tracking** for shared resources" — a `Texture` shared by two materials has no owner and no count.

_Notable:_ the "excessive per-frame allocations" warning has a working prototype already — `@fourjs/math`'s `constructionCount()` is what `benchmarks/math-ops.mjs` uses to prove zero steady-state allocation. It is a benchmark instrument, not a runtime diagnostic.

_Closure plan:_ fold into A-4's dev-mode work. A `ResourceTracker` in `@fourjs/diagnostics` registering GPU/solver handles with a creation site; a `FinalizationRegistry` for leak detection (dev only); promote `constructionCount()` to a per-frame delta warning; `AssetManager` gains a duplicate-load warning when two distinct loader objects share a URL (`asset-manager.ts` already documents that case as legal-but-suspicious).

_Dependencies:_ A-4 (dev flag), A-1 (memory counters read the same tracker).

---

## B. §45 Application composition root

### A-6 — `Application` owns 4 of §45's 9 systems; the header note explaining why is now stale

**§45, §97** · **Severity: High** · **Effort: M** · **SEMI-RECORDED (note has expired)**

_What exists:_ `packages/fourjs/src/application.ts` owns scene, scheduler, system registry, viewports, pose buffer, and optionally a renderer.

_What's missing:_ §45's sentence is "owns the default scene, renderer, time system, simulation scheduler, **input routing, assets, diagnostics**, cameras, and viewports". `app.input`, `app.assets`, `app.diagnostics`, `app.stats` (A-1), and `app.physics` do not exist. `ApplicationOptions` accepts 6 of §45's 13 options; `width`, `height`, `resolution`, `antialias`, `alpha`, `powerPreference`, `autoResize`, `reducedMotion`, and `physics` are all absent.

_Why this is now a gap rather than a plan:_ the module header (lines 8–13) says these "arrive with the phases that build them (§103)" and that omitting them is better than accepting-and-ignoring. That was correct through Phase 10. **Phase 11 built `@fourjs/assets`, `@fourjs/ui`, and `@fourjs/serialization` and wired none of them into the composition root**, and the plan is now complete — so the note points at a future that no longer exists. Every example must hand-wire `PointerInput`, `AssetManager`, and the render loop itself (`examples/ui-demo/main.ts` is 4 separate constructions).

_Closure plan:_

1. Widen `ApplicationOptions` with `assets?: AssetManager | false` and `input?: PointerInputOptions | false`, constructed lazily; expose `app.assets` / `app.input`. Both packages are already `four` dependencies.
2. Add `app.stats` (A-1) and `app.diagnostics`.
3. Add `reducedMotion: "auto" | boolean` — §45 makes it an application-level policy, §75 requires the UI module to honor it, and `UI_STAGED` already names the missing policy as its blocker. This is the cheapest of the nine and unblocks a recorded UI staging item.
4. Update the module header to a dated post-plan note; the current text misleads a reader into thinking the wiring is scheduled.

_Dependencies:_ A-1, A-7, A-14.

---

### A-7 — `Application.resize` is missing from §45's lifecycle

> **CLOSED 2026-08-06.** `Application.resize(width, height, resolution?)` ships, with
> `width`/`height`/`resolution`/`depthRange` construction options; full-surface perspective
> cameras get their aspect and projection rebuilt, a headless application still records the
> size. `autoResize` remains open (A-6).

**§45** · **Severity: High** · **Effort: S** · **SEMI-RECORDED (a TODO comment, not a tracked item)**

_What exists:_ `initialize`, `start`, `stop`, `pause`, `resume`, `step`, `dispose` — 7 of §45's 8 lifecycle methods. `WebglRenderer.resize(w, h, dpr)` exists and every example calls it directly.

_What's missing:_ `Application.resize`. §45 lists it as a lifecycle requirement. The only record is a `TODO(§62, renderer-selection packet)` comment at `application.ts:148` deferring the surface options that would accompany it.

_Closure plan:_ `resize(width, height, resolution?)` forwarding to `renderer.resize` and updating any fullscreen viewport; no-op when headless; add `autoResize` in the same packet (it is a `ResizeObserver` on the canvas, which the host owns — take an injected observer factory to keep the package DOM-free, as `PointerInput` does with `PointerSurface`).

_Dependencies:_ none blocking. Pairs naturally with A-6.

---

### A-8 — `renderer: "auto"` and the string backend form are unimplemented

> **CLOSED 2026-08-07** — §45's string form works and `four` still imports no backend:
> `@fourjs/render`'s `renderer-registry.ts` is a neutral host backends opt into with an
> explicit call (`registerWebglRenderer()`). `ApplicationOptions.renderer` accepts
> `Renderer | "auto" | <name> | false`; `antialias` landed with it;
> `Application.renderer` is a getter (`null` until `initialize()` resolves a string).
> See R-2's banner for the registry design.

**§45, §62, §97** · **Severity: Medium** · **Effort: M** · **RECORDED**

`ApplicationOptions.renderer` takes a `Renderer` instance, not §45's `"auto" | "webgpu" | "webgl2" | "canvas2d" | "svg"`. Recorded twice, with the correct reason (a string form makes `four` statically import every backend) and the correct fix (a backend-opt-in registry) — `application.ts:167–190` and `TODO.md` ("§45 renderer-string ('auto') selection via §62 registry packet"). No new analysis needed; flagged because it is the single most visible divergence from §97's opening lines. Owned by the render analyst.

---

## C. §71–§72 input

### A-9 — `PointerInput` leaks per-pointer state for every dead pointer id

> **CLOSED 2026-08-06.** Teardown-and-delete on `pointerup` and on the new `pointercancel`
> (a new `PropagatingPointerEventType`; `DragManager` ends a drag on it). 10 000-gesture
> regression test via the new `PointerInput.trackedPointerCount`. **Left open:**
> `SurfacePointerEvent` has no `pointerType`, so a mouse release now ends its hover like a
> touch does — see `TODO.md`.

**§72, §83** · **Severity: High (defect)** · **Effort: S** · **RECORDED as PLAUSIBLE in `CHANGELOG.md`, absent from `TODO.md`**

_Verified:_ `packages/input/src/pointer-input.ts:199` declares `#pointers = new Map<number, PointerState>()`. `#stateFor` (line 477) inserts on demand. `grep -c "pointers.delete"` over the file returns **0**. The map is emptied only by `dispose()` (line 316).

_Consequence:_ on mouse this is bounded (one id). On touch and pen — where the browser issues a **fresh `pointerId` per contact** — the map grows without bound for the life of the surface. Each entry retains `downTarget` and `captured`, both `Node` references, so the leak is not just a map slot: **it pins scene nodes that the application has already removed from the graph.** That makes it a §83 "detached nodes retaining listeners"-class leak as well as unbounded memory.

_Aggravating factor:_ the class registers listeners for `pointerdown`/`pointermove`/`pointerup` only (line 311–314). There is no `pointercancel` listener, and the header (line 38) records that absence for a different reason — "a cancelled pointer currently looks like a pointer that stopped moving". A cancelled touch therefore leaks its entry _and_ leaves a stale capture permanently held.

_Closure plan:_

1. In `#handleUp`, after dispatch: release capture, emit the pending `pointerleave`, then `this.#pointers.delete(event.pointerId)`. Retain nothing across the boundary — the click decision is already computed before dispatch (lines 356–360), so ordering is safe.
2. Add a `pointercancel` listener that runs the same teardown _without_ synthesizing `click`, and dispatches a `pointercancel` scene event (new member of `PropagatingPointerEventType`).
3. Regression test: 10 000 synthetic down/up cycles with distinct ids leave `#pointers.size === 0` (expose a test-only size accessor or assert via `getHovered` returning `null`).
4. Move the item from the CHANGELOG's prose into `TODO.md` — a PLAUSIBLE finding recorded only in a changelog entry is not tracked.

---

### A-10 — §72 input sources: 6 of 8 unimplemented

> **CLOSED 2026-08-07** (keyboard, the load-bearing hole) — `KeyboardInput` ships from
> `@fourjs/input` over a duck-typed `KeySurface`, with `SceneKeyEvent` (`preventDefault()`
> forwarded via `KeyDefaultSuppressor`), `dispatchKeyEvent`, and the generalized
> three-phase `propagation.ts` (`dispatchThreePhase`; `dispatchPointerEvent` delegates,
> surface unchanged). Focus is injected as a `focusTarget(): Node | null` resolver — §3.1
> untouched. Wheel, gamepad, XR, `keypress`, and focus/blur-as-input-events remain staged,
> recorded in `packages/input/README.md`. Kept for the record.

**§72, §75** · **Severity: Medium** · **Effort: M** · **RECORDED**

Ships: mouse/touch/pen (through the unified `PointerEvent` shape), and drag (`DragManager`). Absent: **wheel and trackpad, keyboard, gamepad, XR controllers**, plus the synthesized `double-click`, `pinch`, and `rotate` gestures and node-level `focus`/`blur` as _input_ events. Honestly recorded at `pointer-events.ts:106` and `pointer-input.ts:38`.

**The keyboard hole is load-bearing and worth escalating above its neighbours:** `@fourjs/ui`'s `UI_STAGED` names it as the blocker for §75 keyboard navigation _and_ §75's activation path — "§72 lists keyboard events and @fourjs/input implements none — it has no key source at all". `examples/ui-demo/main.ts` works around it with a page-level `keydown` handler calling `Button.activate()`. So one absent `KeyboardInput` source is currently the sole blocker on an accessibility requirement.

_Closure plan:_ a `KeyboardInput` sibling of `PointerInput` — same structural-event, injected-surface, no-DOM-lib discipline; `keydown`/`keyup`/`keypress` through `dispatchPointerEvent`'s three-phase path (rename it `dispatchSceneEvent`); focus-scoped routing so the focused node is the target. Then `WheelInput`. Gamepad and XR stay staged.

_Dependencies:_ unblocks A-13.

---

### A-11 — §71 ships 1 of 7 picking strategies and no `hitTestMode`

**§71** · **Severity: Medium** · **Effort: L** · **RECORDED**

Bounding-volume only. `node.hitTestMode` does not exist. Recorded thoroughly at `pick.ts:1–65` with a correct dependency analysis: analytic tests need §50's shape nodes (staged, `AUDIT-120` S-4); ray/triangle, pixel-alpha, and GPU-id need `@fourjs/geometry` index data and a render target that the frozen §3.1 dependency matrix forbids `@fourjs/input` from importing. **The blocker is architectural, not scheduling** — closing §71 properly means either moving the picking back end above `render`, or a `Pickable` variant that carries a strategy callback. Worth an RFC before a packet.

---

## D. §73–§75 retained-mode UI

### A-12 — §73 ships 3 of 16 controls

> **PARTIALLY CLOSED 2026-08-07** — the cheap tier shipped: `Toggle`, `Checkbox`,
> `RadioButton` (group-by-name, enforced on transition so §79 stays faithful), `Slider`,
> `ProgressIndicator`, `ImageWidget`, all serialized by `registerUISerializers`. Nine of
> sixteen §73 controls ship. Still open behind stated blockers: text input (§56/S-6),
> scroll view + virtual list (§74 + §67), embedded 3D viewport (§48), canvas view,
> menu + tooltip (a per-frame §9 update hook widgets cannot reach), list.
> `UI_STAGED[0]` no longer claims the shipped six.

**§73** · **Severity: Medium** · **Effort: L** · **RECORDED (`UI_STAGED[0]`)**

Ships `Panel`, `Label`, `Button`. Absent: toggle, checkbox, radio, slider, text input, scroll view, list, virtual list, image, progress indicator, menu, tooltip, canvas view, embedded 3D viewport. The staging note's claim — "each remaining control is a widget subclass over this same base and needs no new engine surface" — is true for toggle/checkbox/radio/progress/image, and **not true** for three of them: text input needs §56's selection and caret support (staged, S-6), scroll view needs §74 overflow and scroll extent (staged, `UI_STAGED[2]`) plus §67 clipping, and the embedded 3D viewport needs a §48 nested render surface. Recommend splitting the note so the cheap ten are separable from the three that are blocked.

_Closure plan:_ one packet for the ten stateless/state-only controls (each ~60–100 lines over `UIWidget` + a skin hook); text input, scroll view, and embedded viewport each get their own packet behind their blockers.

---

### A-13 — §75 accessibility mirror is inert; keyboard traversal absent

> **PARTIALLY CLOSED 2026-08-07** — the keyboard half shipped: `collectFocusOrder` /
> `keyboardFocusTarget` / `installKeyboardTraversal` in `@fourjs/ui` (Tab/Shift-Tab from
> `accessibility.tabIndex`, plainly ascending — a stated DOM deviation), `Button`
> Enter/Space activation with `source: "keyboard"`, and the `UI_STAGED` keyboard entry
> deleted. Still open: the DOM mirror, screen-reader updates, high contrast, scalable
> text (all behind the DOM integration policy) and reduced motion (behind A-6).

**§75** · **Severity: High** · **Effort: M** · **RECORDED (`UI_STAGED[3][4][5][6]`)**

`WidgetAccessibility` ships as typed, serializable, **inert** data (`widget.ts:322–341`; nothing reads it — verified, the only consumers are constructor assignment at line 672). Focus itself works (focus/blur, one focused widget per scene root, blur-on-reparent fixed 2026-08-05). Absent: the hidden DOM mirror, keyboard navigation and traversal order, screen-reader updates, high-contrast hooks, scalable text, and reduced-motion consultation.

The staging notes are exemplary, and they identify the two real blockers precisely: a **DOM integration policy** (who owns the element, where it mounts, how a DOM-free package reaches one) and the **absent key source** (A-10).

_Closure plan:_

1. A-10 lands `KeyboardInput`.
2. `packages/ui/src/a11y-mirror.ts` taking an injected `MirrorHost` (structural `{ createElement, appendChild, setAttribute, remove }`) so `@fourjs/ui` still names no DOM type — the same discipline `AssetManager` uses for `FetchLike` and `PointerInput` for `PointerSurface`. The host adapter is ~15 lines in the application.
3. Tab-order traversal from `accessibility.tabIndex` + scene order; Enter/Space → `activate()`.
4. `reducedMotion` from A-6 step 3.

_Dependencies:_ A-10 (hard), A-6 (for reduced motion).

---

### A-14 — UI widgets are scene nodes that do not survive serialization, contradicting §73

> **CLOSED 2026-08-06.** `registerSceneNodeTypes()` / `registerUISerializers()` ship from the
> umbrella `four` package (the closure plan's preferred option), carrying the §74 box model,
> layout, interaction flags and §75 accessibility record through the new
> `SceneNodeDocument.data` seam. A-16's remaining node classes are additions to the same file.

**§73, §79** · **Severity: High** · **Effort: S** · **SEMI-RECORDED (asserted in a test's prose, not tracked)**

§73: _"UI objects are scene nodes and therefore share animation, input, clipping, serialization, and diagnostics."_ Of those five, **serialization does not hold**. `createDefaultComponentSerializers()` registers exactly one serializer, `POSE_TARGET_SERIALIZER`, and `instantiateScene` reconstructs only `"scene"` and `"group"` by class identity. A `Panel`/`Label`/`Button` tree round-trips as bare `Node` state — no size, no layout, no text, no accessibility record, no widget class.

`tests/integration/scene-roundtrip.test.ts:20–24` states this honestly ("no widget serializers exist, so what round-trips is exactly the base-`Node` state") — but a note inside a test file is not a tracked staging item, and §73 is a positive spec promise being contradicted.

_Closure plan:_ `packages/ui/src/serializers.ts` exporting `registerUISerializers(registry, options)` — a `nodeTypeOf`/`nodeFactory` pair for the three widget classes plus their layout, sizing, and `accessibility` payloads. `@fourjs/ui` may depend on `serialization`? No — check §3.1 first; if the edge is forbidden, the pair lives in `tests/integration/helpers/` style, i.e. shipped from the umbrella `four` package, which already depends on both. Prefer the umbrella.

_Dependencies:_ A-16 (widget size/layout is exactly the "subclass state" the format stages).

---

## E. §76–§81 assets and serialization

### A-15 — §79 silently drops components with no registered serializer

> **CLOSED 2026-08-06.** `Node.components` forwards §6a's registry; `serializeComponents`
> walks the node and emits in registry order (so existing byte-identical goldens are
> unmoved), throwing `INVALID_APPLICATION_STATE` on an unserializable component unless
> `SerializeSceneOptions.unknownComponents: "skip"` is passed. The staging paragraph is gone.

**§79, §6a** · **Severity: High** · **Effort: S** · **RECORDED (staged 2026-08-02, P11-1)**

_Verified mechanism:_ `serializer.ts:26–38` — `Node` exposes `addComponent`/`getComponent`/`removeComponent` and no enumeration, so the writer walks the **serializer registry** and probes each registered type with `node.getComponent(type)`. A component whose type is not registered is not written, **and the writer cannot detect the omission.** A save that quietly loses state is, as the note says, the one failure mode the design cannot warn about. (The read side is sound: `unknownComponents` defaults to `"throw"`.)

_The recorded blocker is smaller than the note implies._ `ComponentRegistry` already exposes `get components(): IterableIterator<Component>` (`packages/core/src/component.ts:109`). `Node` simply does not forward it. The fix is a ~4-line getter, not a new API design.

_Closure plan:_

1. `packages/scene/src/node.ts`: `get components(): IterableIterator<Component> { return this.#components.components; }`.
2. `serializeNode` walks `node.components` instead of the registry, looks each up by `typeName`, and on a miss throws `FourError` — or honors a new `SerializeSceneOptions.unknownComponents: "throw" | "skip"` mirroring the read side. Default `"throw"`: losing state must be opt-in on both sides.
3. Preserve registration-order output by sorting the walked components by registry order, so existing byte-identical round-trip goldens do not move.
4. Delete the staging paragraph.

_Dependencies:_ touches `@fourjs/scene` (foundation analyst's package) — coordinate.

---

### A-16 — §79 carries no subclass node state; §79 §80 `.four` binary format absent

> **PARTIALLY CLOSED 2026-08-07** — all five named node classes have §79 pairs shipping
> from the umbrella (`registerRenderSerializers()`), with geometry/material referenced
> by logical key through an injected resolver (`SceneResourceCatalog`) — the format's
> dependency stance is unchanged and no document version moved. `unknownResources`
> relaxes the write side only (a read-side skip would invent resources the application
> must dispose, §83). Still open: §79's asset **manifest** (key → URL + content hash,
> blocked on A-18) and the §80 `.four` binary format.

**§79** · **Severity: Medium** · **Effort: M** · **RECORDED (`format.ts:29`, `packages/serialization/README.md:18`)**

The document carries `Node`'s own fields only — no camera FOV, no geometry reference, no sprite texture key, no light color, no widget box. The stated reason (the §3.1 matrix lets `serialization` see `core`/`math`/`scene` only) is correct, and `nodeFactory`/`nodeTypeOf` is the intended seam. But **nothing ships a factory for any of the eleven node subclasses the repo actually has**, so in practice every non-trivial scene needs application-authored round-trip code (A-14 is the UI instance of this).

Separately, §79's binary `.four` package format is not implemented (README records it), and §79's asset-manifest clause — "assets are referenced by logical key, resolved through a manifest that maps each key to a URL and content hash (§76)" — has no implementation either, because §76 content hashing is staged (A-18).

_Closure plan:_ ship `registerSceneNodeTypes()` from the umbrella `four` package (which may import everything) covering `Renderable`, `Sprite`, `PerspectiveCamera`, `OrthographicCamera`, `DirectionalLight`, and the three widgets; keep the format's dependency stance unchanged. `.four` binary and the asset manifest stay staged behind A-18.

---

### A-17 — §79 restored node ids can collide with engine-assigned ids

> **CLOSED 2026-08-06.** `NodeOptions.id` restores and _reserves_ an id at construction;
> `restoreNodeId` moved into `@fourjs/scene` (which owns the field) for the `nodeFactory` path;
> `instantiateScene` refuses a document producing one id twice with `INVALID_SCENE_GRAPH`.

**§79** · **Severity: Medium** · **Effort: S** · **RECORDED (staged 2026-08-02, P11-1)**

_Verified mechanism:_ `Node.id` is `readonly id: string = assignNodeId()` (`packages/scene/src/node.ts:121`), fed by a module-private monotonic counter formatting `node-<n>`. `restoreNodeId` (`serializer.ts:495`) writes the saved id through a cast, and **the counter is never advanced past it**. So a node constructed after a load can be assigned an id a loaded node already holds — silently, and `findById` then returns whichever comes first in traversal order.

The note calls the fresh-process case "safe because the counter starts below every id it ever issued". That is true, but it is exactly the _in-process reload_ case — an editor, a level restart, a replay seek — that a scene format exists to serve.

_Closure plan:_ widen the `Node` constructor with an optional `id`, as `node.ts:115–120` already anticipates in writing; have `assignNodeId` parse `node-<n>` ids on restore and bump the counter to `max(counter, n+1)`; drop the cast in `restoreNodeId`. Keep the format's id strings opaque — the counter bump is a best-effort collision _avoidance_, so also add a duplicate-id check in `instantiateScene` that throws `INVALID_SCENE_GRAPH`.

_Dependencies:_ `@fourjs/scene` constructor change — coordinate with the foundation analyst.

---

### A-18 — §76 asset manager ships 5 of 13 required capabilities

**§76** · **Severity: Medium** · **Effort: L** · **RECORDED (`asset-manager.ts:86–104`)**

Ships: deduplication, caching, reference counting, lazy loading, retries (as "call `load` again"; failures are never cached). Staged: **cancellation/`AbortSignal`, streaming, dependency graphs, progress reporting, worker decoding, hot reload, content hashing**, and §76's own record form `assets.load({ robot: "…", icon: "…" })`.

The staging reasoning is sound per item. Two observations to add:

- **Cancellation is also a §96 requirement** ("cancellation and timeouts for expensive decoders"), not only a §76 convenience — see A-23. Framing it purely as an unpinned policy question understates it.
- **Content hashing is a §79 dependency**, not an isolated §76 feature: §79's manifest clause requires "a URL and content hash". Ordering matters if A-16 is ever finished.

_Closure plan:_ one packet for cancellation + progress (both need a widened `FetchLike` exposing `body`/`AbortSignal`; pin the coalescing policy in an ADR first — "one aborting caller does not cancel a coalesced load; the last release of a pending load aborts it"). Content hashing next (it is `crypto.subtle.digest` behind an injected hasher). Streaming, dependency graphs, worker decoding, hot reload stay staged behind glTF (A-19).

---

### A-19 — §77 texture system and §78 glTF/GLB loading absent

**§77, §78** · **Severity: Medium** · **Effort: L** · **RECORDED (`loaders.ts:41–56`, `texture.ts:178–182`, `AUDIT-120` S-7)**

`Texture` is 2D RGBA8, non-mipmapped, from a plain byte array. §77's cube/array/3D targets, mipmaps, wrap/filter/anisotropy, color-space metadata, compressed containers, render targets, and video textures are all staged. glTF is staged behind that plus §59 materials plus a skin/morph representation `@fourjs/geometry` does not have. The "dishonest to ship as a stub" decision is right and I would not disturb it. Flagged only so the §94 0.7 rung ("assets, glTF, serialization, UI, and accessibility") is understood as **partly** met: serialization and UI shipped at MVP tier, glTF did not ship at all, and accessibility is inert (A-13).

---

### A-20 — §82 GPU compute / `ComputePass` does not exist

**§82** · **Severity: Low** · **Effort: L** · **SILENT**

`Four.ComputePass` from §82's example has no implementation and no staging note. §82 explicitly makes compute optional ("Basic graphics and physics functionality must not require compute support") and `render-webgpu` is a declared reserved stub, so this is legitimately out of MVP scope — but it should carry a dated line rather than be silent, since §94's 0.8 rung names "compute particles" and `TODO.md`'s particles backlog says "GPU compute (WebGPU tier)" without citing §82.

_Closure plan:_ one line in `packages/render-webgpu/README.md` and a `TODO.md` entry citing §82; no code.

---

## F. §93/§97/§118–119 documentation, examples, flagship

### A-21 — Four §93 worked scenes and both §118/§119 flagships are empty `.gitkeep` directories that shipped docs link to

> **PARTIALLY CLOSED 2026-08-07** (second half; `first-3d-scene` was the first) —
> `examples/flagship/one-scene-everything-moves` is written: §118's full list in one
> scene (textured lit cube, 2D vector orbit, spring pendulum, bouncing body with §29
> event-driven bursts, motorised hinge, world text riding a body, camera-parented UI
> panel, §16 timeline, pause/slow-motion/single-step, keyboard operable), built by
> `pnpm examples:build`, previewed on Playwright's eighth server, measured by six tests
> counting objects by hue and checking pause (exactly 0 changed pixels) and single-step
> (exactly 1/60 s) against §10's accumulator. First example on the §62/§37 `"auto"`
> registries and the first to assemble the §113 overlay. Still open: the three §93
> stand-in scenes (owner retire-or-write decision) and §119's `motor-digital-twin`.

**§93, §97, §118, §119, §113a** · **Severity: Critical** · **Effort: L** · **SILENT (and actively mis-stated in `docs/AUDIT-120.md`)**

_Verified by `git ls-files examples/`:_

| directory                                       | contents                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| `examples/first-3d-scene/`                      | `.gitkeep` — **written 2026-08-07** (see banner above this table's section) |
| `examples/first-animated-scene/`                | `.gitkeep`                                                                  |
| `examples/first-physics-scene/`                 | `.gitkeep`                                                                  |
| `examples/mixed-scene/`                         | `.gitkeep`                                                                  |
| `examples/flagship/one-scene-everything-moves/` | `.gitkeep`                                                                  |
| `examples/flagship/motor-digital-twin/`         | `.gitkeep`                                                                  |

**Six real examples exist** (seven since 2026-08-07: `first-3d-scene` was written — first `PerspectiveCamera`, first lit 3D mesh in a browser, 5 measuring Playwright tests) — `first-2d-scene`, `physics-playground`, `mechanism`, `blending`, `particles-demo`, `ui-demo` — and each is genuinely good (built by `pnpm examples:build`, previewed and asserted by a Playwright spec, guarded against config drift by `tests/integration/examples-build-coverage.test.ts`).

**Three separate documents assert otherwise:**

1. `docs/AUDIT-120.md:126` — _"examples | shipped | **10 example applications** under `examples/` … **incl. the five §93 guide scenes and the flagship**"_. Four of the five guide scenes and both flagships do not exist. The count was taken over directories, including empty ones. This row is the evidence for §113a's exit clause "the §120 tooling list is complete", so a §120 exit criterion is resting on a miscount.
2. `docs/guides/README.md:8–13` — a table headed _"where it lives"_ pointing readers at all four empty directories as though they contained something.
3. `examples/README.md` — the most honest of the three; it lists the six as "**Implemented.**" and leaves the rest unmarked, but it still presents the six missing entries as bullet items with descriptions and does not say "empty".

_Why Critical:_ §93 requires "every major feature should have a runnable example", and §118's success criterion is the project's stated reason for existing (`docs/POSITIONING.md`, demo-first). The §118 flagship is the one artifact that demonstrates the thesis — _"it must feel like one motion-capable engine, not a graphics library with physics bolted on"_ — and it is the only §118/§119 deliverable, and it is empty. Combined with A-25 (`website/` is a README) the project has **no public demonstration at all**, which is the exact risk `POSITIONING.md` names.

_Mitigating:_ `examples/physics-playground/README.md` explicitly says it "fulfils the role sketched for `first-physics-scene/`", and `first-2d-scene` has grown well past its §93 remit. So the _capability_ gap is smaller than the _artifact_ gap — most of §118's bullet list already exists across the six demos (rotating 3D, 2D orbit, spring pendulum, bouncing body, world-space labels, screen-space panel, motorized hinge, collision events, slow motion). §118 is largely a **composition** job, not new engine work.

_Closure plan:_

1. **Immediately (S, doc-only):** correct `AUDIT-120.md`'s examples row to "6 example applications; 4 of §93's 5 worked scenes and both §118/§119 flagships are unbuilt (dated line S-8)", add staged line **S-8**, and mark the four rows in `docs/guides/README.md` and `examples/README.md` as _not yet written_. A shipped doc must not link to an empty directory.
2. **§118 flagship (M):** compose from the existing six. Every bullet has a working precedent except "a timeline" driving the whole scene and the unified pause/slow-motion/step control bar — `app.scheduler.timeScale` and `Application.step` already give both. This is the single highest-leverage remaining item in the repository.
3. **§93 scenes (M):** `first-3d-scene` and `first-animated-scene` are small extractions from `first-2d-scene`/`blending`. `first-physics-scene` should either be written or the directory deleted and the guides table pointed at `physics-playground` (its README already claims the role). `mixed-scene` should be §97's example, which requires A-22 first.
4. **§119 digital twin (L):** blocked on §84 stats (A-1) for its instrumentation and waveform charts; `docs/guides/engineering-dashboard.md` and `digital-twin.md` are already written against it, which is itself a drift risk.

_Dependencies:_ A-1 (for §119), A-22 (for `mixed-scene`).

---

### A-22 — §97 and §114–§117 do not compile against the shipped API

**§97, §114–§117, §98** · **Severity: High** · **Effort: M (spec amendment) or L (aliases)** · **SEMI-RECORDED (one instance in `TODO.md`)**

_Verified._ The umbrella barrel is namespace re-exports — `export * as scene from "@fourjs/scene"` etc. (`packages/fourjs/src/index.ts`) — a decision recorded 2026-07-28 (WP-0.7-fix1, "to avoid symbol collisions"). So `import * as Four from "fourJS"` yields `Four.scene.Group`, not `Four.Group`. Of the symbols Part X's examples use, **`Four.Application` is the only one that resolves.**

| spec symbol                                                                              | shipped reality                                                  |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `Four.Mesh`                                                                              | no `Mesh`; the class is `Renderable` (`@fourjs/render`)          |
| `Four.BoxGeometry` / `Four.SphereGeometry`                                               | functions `boxGeometry`; no sphere primitive at all              |
| `Four.StandardMaterial`                                                                  | absent (§59 PBR staged, `AUDIT-120` S-5)                         |
| `Four.BoxCollider` / `Four.SphereCollider`                                               | one `Collider` component + a `ColliderDescriptor` union          |
| `Four.Text`                                                                              | absent — `@fourjs/text` produces data, never nodes               |
| `Four.Circle`                                                                            | absent (§50 catalogue staged, S-4)                               |
| `Four.animate`                                                                           | exists, but as `Four.animation.animate`                          |
| `Four.SceneMigrator.upgrade`                                                             | ships as `migrateSceneDocument` + `SceneMigrationRegistry`       |
| `Four.ComputePass`                                                                       | absent (A-20)                                                    |
| `Four.PIDController`                                                                     | `Four.motion.PIDController` — **the one case `TODO.md` records** |
| `Four.HingeJoint`, `Four.Panel`, `Four.Button`, `Four.PerspectiveCamera`, `Four.Vector3` | exist, under their package namespaces                            |
| `app.scene.activeCamera = camera`                                                        | absent; cameras reach the renderer through `app.views` viewports |
| `renderer: "auto"`, `physics: {…}` options                                               | absent (A-8, A-6)                                                |

`TODO.md` records exactly one of these ("§111 sketch namespace: spec writes `Four.PIDController`; real path is `Four.motion.PIDController` (pre-existing umbrella convention — spec-revisit note)"), correctly identifying it as pre-existing and systemic — but it is filed as a Phase-8 item, so the reader never learns that the same convention invalidates §97 and all four §114–§117 examples.

_Why it matters:_ §97 is titled "Complete Mixed-Scene Example" and is the specification's showcase. A newcomer copying it gets a wall of type errors. It is also why `examples/mixed-scene/` (A-21) cannot simply be written — there is no agreed spelling for it.

_Closure plan (recommend option 1):_

1. **Spec amendment (preferred).** One lettered section — **§97a, "Namespace and Naming Conventions"** — recording that (a) the umbrella barrel uses per-package namespaces, so Part X's `Four.X` reads `Four.<package>.X`; (b) the shipped names for `Mesh`→`Renderable`, `*Geometry`→factory functions, `*Collider`→`Collider` + descriptor, `SceneMigrator`→`migrateSceneDocument`; (c) `activeCamera` is served by `app.views`. Then rewrite §97 and §114–§117 verbatim against the shipped surface, and run `node tools/check-spec.mjs`. This respects the frozen §1–120 numbering and the amendments-table convention.
2. Only after (1): write `examples/mixed-scene/` as the executable proof of §97, and add it to `examples:build` + `playwright.config.ts` (`examples-build-coverage.test.ts` will enforce the pair).
3. **Do not** add flat aliases to the umbrella barrel to make `Four.Mesh` work — the collision-avoidance decision that produced namespaces is sound and reversing it would reintroduce the problem WP-0.7-fix1 solved.

_Dependencies:_ owner decision (spec amendment); blocks A-21 step 3.

---

## G. §86/§90/§92/§94/§96 process, quality, release

### A-23 — §96 security requirements are entirely unimplemented

> **CLOSED 2026-08-07** — asset `maximumBytes` (64 MiB, checked against `content-length`
> before the body is read and again against the bytes a loader reads) + `timeoutSeconds`
> (30 s, injectable `TimerLike`); `decodeSceneDocument`/`decodeReplayRecording` over
> `@fourjs/core`'s `parseUntrustedJson` (32 Mi code units, 1024 levels, **iterative** depth
> walk); new `UNTRUSTED_INPUT_REJECTED` code; `docs/guides/security-and-untrusted-content.md`
> with the honest requirement table; the CSP posture enforced by
> `tests/integration/security-csp.test.ts`. Closes A-18's deadline half. Still absent, now
> recorded: decompression limits (no compressed path exists yet) and plugin boundaries
> (A-3). Kept for the record.

**§96, §76, §79** · **Severity: High** · **Effort: M** · **SILENT**

§96 opens _"Asset loaders and scene deserializers shall treat external content as untrusted"_ and lists seven requirements. Verified state:

| §96 requirement                                  | state                                                                                                                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bounds checking                                  | **partial** — `validateSceneDocument` and `validateReplayRecording` rebuild field-by-field and drop unknown keys; geometry validates index ranges                |
| no arbitrary code execution from scene files     | **met** — the format is JSON, `cloneJsonValue` refuses `__proto__` (hardened and hoisted to `@fourjs/core` 2026-08-04), `thawJsonObject` copies by `Object.keys` |
| input-size limits                                | **absent** — `grep -rn "maxBytes\|sizeLimit"` over `assets`/`serialization` returns nothing; a 4 GB response is fetched and decoded                              |
| decompression limits                             | **absent** — no compressed path exists yet, but no policy either                                                                                                 |
| cancellation and timeouts for expensive decoders | **absent** — cancellation is staged in `asset-manager.ts` as a §76 API-shape question with no mention that §96 _requires_ it                                     |
| safe shader/plugin boundaries                    | **absent** — no plugin system at all (A-3)                                                                                                                       |
| documented content-security-policy behavior      | **absent** — no CSP text anywhere in `docs/`                                                                                                                     |

`grep -rn "§96"` over the whole tree returns **zero** citations in source and zero in the guides. §96 has never been read against the implementation.

_Closure plan:_

1. `AssetManagerOptions` gains `maximumBytes` (default a documented finite number, not `Infinity`) and `timeoutMs`, enforced in `#fetch` before `arrayBuffer()`; failures are `ASSET_LOAD_FAILED` with `context.limit`. This also delivers half of A-18's cancellation.
2. `decodeSceneDocument` / `decodeReplayRecording` gain `maximumTextLength` and `maximumDepth` (a deeply-nested JSON document is a stack-overflow DoS against `thawJson`'s recursion — the same recursion depth limit `benchmarks/scene-propagation.mjs` measured at ~8 000 for `resolveWorldTransforms`).
3. A `docs/guides/security-and-untrusted-content.md` guide covering the §96 list and the CSP posture (the engine ships no `eval`, no `new Function`, no inline-style injection — this is worth stating and testing, not just being true by accident).
4. Add a §96 row to the guides README index (it currently maps 13 items and has no security entry).

---

### A-24 — §92 test taxonomy: `tests/README.md` and `AUDIT-120.md` both overstate coverage

**§92, §113a** · **Severity: High** · **Effort: M** · **SILENT (doc drift) + real coverage gap**

_What exists (verified against `git ls-files tests/`):_ 8 determinism suites with 8 committed goldens (excellent); 6 integration suites — `motion-advanced`, `physics-blending`, `physics-joints`, `physics-rapier`, `physics-replay`, `scene-roundtrip` — plus `examples-build-coverage`; 9 Playwright browser specs; 1 visual spec (`tests/visual/ui-demo.spec.ts`) with 2 committed PNG goldens.

_The drift:_

- `tests/README.md:6` claims `integration/` holds _"scene+renderer, fixed-step physics with interpolated rendering, 2D/3D picking, assets+materials, animation-to-physics transitions, UI focus/accessibility bridge"_. Of §92's seven named integration categories, **three exist** (fixed-step physics + interpolated rendering, animation-to-physics via `physics-blending`, and — partially — UI focus inside `scene-roundtrip`). **Four do not:** scene+renderer, picking across 2D and 3D, asset loading + materials, and renderer context loss and restore. The last is doubly notable because `packages/render/src/renderer.ts:476` explicitly designs `NullRenderer.events` to make that test cheap and calls it "exactly the §92 integration test's cheap half" — the seam was built and the test was never written.
- `tests/README.md:7` claims `visual/` covers eight categories; one ships. `AUDIT-120.md:126` says `tests/visual/` "is an empty placeholder" — stale in the opposite direction, since the visual suite landed 2026-08-04.
- `playwright.config.ts:20` states _"There are no golden images"_ as a doctrine; `tests/visual/` has golden images. The visual spec's header resolves the apparent contradiction correctly (forced ANGLE-over-SwiftShader, SwiftShader-to-SwiftShader comparison), but the config's blanket sentence is now wrong and should point at the exception.

_Closure plan:_

1. Rewrite `tests/README.md` to describe what exists, with a "not yet covered" list per §92 category. A taxonomy README that describes the taxonomy rather than the tests is worse than none.
2. Write the four missing integration suites. `renderer context loss and restore` is ~40 lines against `NullRenderer.events` and should land first. `assets+materials` needs A-19's texture tier — stage it with a dated line instead.
3. Extend `tests/visual/` per the spec's own recorded next step (the visual spec names it: an "app-side deterministic stepping hook" so animated sites can have goldens). That hook is `Application.step` plus a query-param seed — small, and it unlocks 5 of the remaining 7 categories.
4. Correct `AUDIT-120.md`'s visual sentence and `playwright.config.ts`'s "no golden images" sentence.

---

### A-25 — §94 release machinery does not exist; `website/` is a stub

> **MACHINERY CLOSED 2026-08-07** — steps 1–4 shipped: hand-authored Changesets config
> (with the discovered blocker that the reserved stubs cannot be `ignore`d while the
> umbrella depends on them — owner decision recorded in TODO), `apply-publish-names.mjs`
> (+tests; rewrites emitted code, not just manifests — 405 specifier sites),
> `release.yml` reusing ci.yml via `workflow_call` with publish gated on `NPM_TOKEN`,
> `docs.yml` Pages deploy of TypeDoc + the six examples, honest `website/README.md` +
> minimal index. Still open: the real site (guides hosting, flagship demo — A-21) and the
> owner-only steps (token, Pages enablement, stub packaging decision).

**§94, §93, §113a, §90** · **Severity: High** · **Effort: M** · **SEMI-RECORDED**

_Verified:_

- `@changesets/cli@2.31.1` is a root devDependency, and there is **no `.changeset/` directory** — so `changeset` has never been initialized. No config, no `baseBranch`, no `ignore` list for the five reserved stubs, no fixed/linked package groups.
- `.github/workflows/` contains **`ci.yml` only**. No release workflow, no npm publish job, no docs-deploy job. `pnpm run docs` generates `docs/api/` in CI and the output goes nowhere.
- The `@fourjs/*` → `@danielsimonjr/fourjs-*` publish-name mapping decided 2026-07-29 (spec §98 rev 1.6) has **no tooling** — `tools/` holds `check-spec.mjs` and the two dependency-graph tools, nothing that rewrites package names at release time. The spec says the mapping "is applied mechanically at release time"; there is no mechanism.
- Every `packages/*/package.json` is at `version: 0.0.0`.
- `website/` contains one file, `README.md`, ending _"Scaffold only — no implementation yet."_

_Record status:_ `TODO.md` carries "First publish (§94 0.1): Changesets release workflow + the @danielsimonjr/fourjs publish-name mapping — owner step" twice (post-plan backlog and Later milestones), and "Deploy the public interactive demo". So the _intent_ is tracked. What is not tracked is that **§113a's exit criterion explicitly includes "documentation and website per §93"**, and Phase 11 was closed GREEN with the website untouched — the guides half was delivered (13 guides, genuinely good) and the site half was not. That is an unrecorded exit-criterion shortfall, not merely a backlog item.

_Closure plan:_

1. `pnpm changeset init`; configure `.changeset/config.json` with the five reserved stubs in `ignore` and `linked` groups for the `render-*`/`physics-*` families.
2. `tools/apply-publish-names.mjs` — rewrites `name` and intra-workspace `dependencies` keys from `@fourjs/x` to `@danielsimonjr/fourjs-x` (and `four` → `@danielsimonjr/fourjs`) into a staging copy, never in place; a unit test asserts the umbrella's 25 subpath exports survive the rewrite (this is the §91 tree-shaking requirement and the rewrite is exactly where it would break).
3. `.github/workflows/release.yml` — `changesets/action` gated on the full `ci.yml` job set, running step 2 before publish.
4. `.github/workflows/docs.yml` — publish `docs/api/` plus the six built example sites to Pages. Note `TODO.md`'s recorded gotcha: subpath hosting needs `--base` at build time.
5. Then the website: at minimum an index over the guides, the API reference, and live example iframes. Given A-21, the flagship demo is the page that matters.

_Dependencies:_ owner decision for the actual publish; steps 1–4 are mechanical and unblocked. A-21 for the site's centrepiece.

---

### A-26 — §90 compatibility tables have never been published

> **CLOSED 2026-08-07** — `docs/COMPATIBILITY.md` publishes the five tables; the
> solver-adapter block is generated from the adapters' own capability declarations by
> `tools/generate-compatibility.mjs` (`--check` detects drift), which names
> `SolverBodyAccess`/`SolverJointAccess` per ARCHITECTURE.md's expectation. The three
> forward-looking references now point at the real document. Kept for the record.

**§90** · **Severity: Medium** · **Effort: S** · **SILENT**

§90 requires published compatibility tables for browser support, WebGPU/WebGL feature tiers, physics solver adapters, scene format versions, and plugin API versions. **None exists.** Every reference in the repo is forward-looking: `docs/Architecture/ARCHITECTURE.md:303` ("The §90/§102 compatibility tables **are expected to** name `SolverBodyAccess`…"), `docs/guides/custom-solver-adapters.md:105,123`, `docs/rfcs/0000-template.md:26`. Grep confirms no table.

Much of the data is already computed and merely unpublished: solver capability differences are declared per adapter and discussed at length in `custom-solver-adapters.md`; `SCENE_FORMAT_VERSION` is a live constant with a migration registry; the browser floor is implied by `playwright.config.ts` (Chromium + SwiftShader) and `engines.node >= 20`.

_Closure plan:_ `docs/COMPATIBILITY.md` with the five tables, generated where possible — the adapter table can be emitted from the adapters' own capability declarations by a `tools/` script so it cannot drift, in the style of `tools/create-dependency-graph`. Plugin API versions stay "n/a — §81 not implemented (A-3)".

---

### A-27 — §86 benchmark coverage: 5 of 10 rows unmeasured, harness not wired to anything

**§86, §92, §113a** · **Severity: Medium** · **Effort: M** · **RECORDED (`benchmarks/README.md` is exemplary)**

Five scripts cover: math throughput/allocation, world-transform resolution, physics step (5 000 active bodies), animation sampling, 100k CPU particles. The payload row is gated by `.size-limit.json` (150 kB / 25 kB / 30 kB across three examples) in CI.

Unmeasured §86 rows: **batched sprites (100 000)**, **simple batched shapes (50 000)**, **simple mesh instances (100 000)**, **retained UI nodes (5 000)**, **animated glyphs (20 000)**, **GPU particles (100 000+)**. The README's reasoning — "GPU-bound, UI-tier or already covered elsewhere … measuring them headless would produce numbers about the wrong thing" — is right for the four GPU rows. It is **not** right for **retained UI nodes**, which is a pure CPU layout-and-state number `@fourjs/ui` can produce headlessly today, and it is arguable for **animated glyphs**, since `layoutText` is CPU work.

Also: `node benchmarks/harness.mjs` "runs nothing; it is the suite's index"; there is no runner, no CI integration, and no regression detection. The "never a gate" doctrine is correct and should be preserved — but a _recorded_ number with no trend is only marginally better than no number.

_Closure plan:_

1. `benchmarks/ui-layout.mjs` — 5 000 retained widgets through `Panel.layout()`, cold and incremental. Closes a §86 row with existing code and no GPU.
2. `benchmarks/text-layout.mjs` — 20 000 glyphs through `layoutText`; honest about being the CPU half of the "animated glyphs" row.
3. `benchmarks/run-all.mjs` driving all seven and emitting one combined record.
4. A **non-gating** CI job on `main` only that runs the suite and posts a delta comment. Explicitly `continue-on-error: true`, as `pnpm audit` already is — trend visibility without a flaky gate.

---

## H. Documentation-versus-reality drift (each independently verified false)

### A-28 — Four shipped documents make factually incorrect claims

**Severity: High (a stale audit is worse than no audit)** · **Effort: S** · **SILENT**

| file                                      | claim                                                                                                                  | reality                                                                                                                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ROADMAP.md:7`                            | _"This repository is currently at the scaffold-and-specification stage; **nothing on this roadmap has shipped yet**."_ | The implementation plan completed 2026-08-02. This is the identical staleness that `CLAUDE.md` and `MEMORY.md` carried until 2026-08-05 and that both now flag in-place — `ROADMAP.md` was missed in that sweep. |
| `README.md:13`                            | _"The §120 MVP audit stands at **42/43** shipped-or-MVP; **lighting is the single staged absence**."_                  | `AUDIT-120.md` was amended 2026-08-04 to **43/43**; lighting shipped at MVP tier that day.                                                                                                                       |
| `docs/AUDIT-120.md:126`                   | _"**10 example applications** … incl. the five §93 guide scenes and the flagship"_                                     | 6 real examples; 4 guide scenes and both flagships are empty (**A-21**).                                                                                                                                         |
| `docs/AUDIT-120.md:126`                   | _"`tests/visual/` **is an empty placeholder**"_                                                                        | A visual suite with 2 committed goldens landed 2026-08-04 (**A-24**).                                                                                                                                            |
| `tests/README.md:6–7`                     | integration and visual category lists                                                                                  | Describe §92's taxonomy, not the tests (**A-24**).                                                                                                                                                               |
| `packages/fourjs/src/application.ts:8–13` | §45's absent systems _"arrive with the phases that build them"_                                                        | The plan is complete; no phase remains (**A-6**).                                                                                                                                                                |
| `playwright.config.ts:20`                 | _"There are no golden images"_                                                                                         | `tests/visual/` has them (**A-24**).                                                                                                                                                                             |

_Why this is High rather than Low:_ `AUDIT-120.md` is the named exit artefact for §113a's clause "the §120 tooling list is complete", and `MEMORY.md`'s standing-facts section instructs agents to trust these files. Two of its rows are wrong, and one of them (examples) is load-bearing for an exit criterion. The repository's documentation discipline is otherwise unusually strong — the staging notes in `UI_STAGED`, `DEBUG_DRAW_STAGED`, `asset-manager.ts`, and `benchmarks/README.md` are the best I have seen — which is exactly why these seven drifted claims are corrosive: a reader who has learned to trust the notes will trust these too.

_Closure plan:_ single doc-only packet. Amend all seven with dated in-place corrections following the existing convention (`MEMORY.md`'s "supersede, never rewrite"); add **S-8** to `AUDIT-120.md` for the examples shortfall; add a `tools/check-docs.mjs` companion to `check-spec.mjs` asserting the mechanically checkable subset — every `examples/*` directory referenced by a README or guide contains a `main.ts`, and every count in `AUDIT-120.md` matches a `git ls-files` query. Wire it into CI next to `pnpm check-spec`.

---

## Summary

| #    | Title                                                                | §                | Sev      | Eff | Record               |
| ---- | -------------------------------------------------------------------- | ---------------- | -------- | --- | -------------------- |
| A-1  | §84 runtime statistics absent                                        | 84, 98           | Critical | M   | SILENT               |
| A-2  | §40 `UnitSystem` never shipped                                       | 40, 98, 101      | High     | M   | SEMI                 |
| A-3  | §81 plugin system absent                                             | 81, 98, 79       | High     | L   | SILENT               |
| A-4  | §85 validation scattered; no dev/prod split                          | 85, 98, 41       | High     | M   | SILENT               |
| A-5  | §83 dev warnings / ownership tracking absent                         | 83               | Medium   | M   | SILENT               |
| A-6  | `Application` owns 4 of §45's 9 systems                              | 45               | High     | M   | SEMI (stale)         |
| A-7  | `Application.resize` missing                                         | 45               | High     | S   | SEMI                 |
| A-8  | `renderer: "auto"` unimplemented                                     | 45, 62           | Medium   | M   | RECORDED             |
| A-9  | Pointer-state map leaks dead pointer ids **(defect)**                | 72, 83           | High     | S   | RECORDED (untracked) |
| A-10 | §72: 6 of 8 input sources absent; no key source                      | 72, 75           | Medium   | M   | RECORDED             |
| A-11 | §71: 1 of 7 picking strategies; no `hitTestMode`                     | 71               | Medium   | L   | RECORDED             |
| A-12 | §73: 3 of 16 controls                                                | 73               | Medium   | L   | RECORDED             |
| A-13 | §75 a11y mirror inert; no keyboard traversal                         | 75               | High     | M   | RECORDED             |
| A-14 | UI widgets do not survive serialization                              | 73, 79           | High     | S   | SEMI                 |
| A-15 | Unregistered components silently dropped on save                     | 79, 6a           | High     | S   | RECORDED             |
| A-16 | No subclass node state; `.four` binary absent                        | 79               | Medium   | M   | RECORDED             |
| A-17 | Restored node ids can collide                                        | 79               | Medium   | S   | RECORDED             |
| A-18 | §76: 5 of 13 asset capabilities                                      | 76               | Medium   | L   | RECORDED             |
| A-19 | §77 texture tier / §78 glTF absent                                   | 77, 78           | Medium   | L   | RECORDED             |
| A-20 | §82 `ComputePass` absent                                             | 82               | Low      | L   | SILENT               |
| A-21 | 4 §93 scenes + both flagships are empty dirs                         | 93, 97, 118, 119 | Critical | L   | SILENT               |
| A-22 | §97/§114–117 do not compile against shipped API                      | 97, 114–117, 98  | High     | M/L | SEMI                 |
| A-23 | §96 security requirements unimplemented                              | 96, 76, 79       | High     | M   | SILENT               |
| A-24 | §92 taxonomy overstated; 4 integration + 7 visual categories missing | 92, 113a         | High     | M   | SILENT               |
| A-25 | §94 release machinery absent; `website/` a stub                      | 94, 93, 113a     | High     | M   | SEMI                 |
| A-26 | §90 compatibility tables never published                             | 90               | Medium   | S   | SILENT               |
| A-27 | §86: 5 of 10 rows unmeasured; harness unwired                        | 86, 92           | Medium   | M   | RECORDED             |
| A-28 | Seven false claims in shipped docs                                   | —                | High     | S   | SILENT               |

**Recommended order of attack.** Cheap and high-value first: **A-28** (doc corrections + `check-docs.mjs`), **A-9** (a real leak, ~10 lines), **A-15** (~4-line `Node` getter closes a silent-data-loss path), **A-7**, **A-14**, **A-17**. Then the two that unblock the most downstream work: **A-1** (§84 stats — gates §119, A-5, A-27) and **A-10** (`KeyboardInput` — sole blocker on A-13's accessibility requirement). Then **A-22** (spec amendment, owner decision) which unblocks **A-21**, the project's largest single gap. **A-23**, **A-25**, **A-26** are self-contained and can run in parallel. **A-3** (§81) needs an RFC before anything else.

**Two structural observations for the composite doc.** First, the gaps cluster hard by _cause_: nine of them (**A-1, A-2, A-3, A-4, A-5, A-20, A-23, A-26, A-28**) are things **no phase §103–§113a was ever assigned**, and the §120-scoped `AUDIT-120.md` was structurally incapable of catching them because none is a §120 row — the audit says so itself under "What this audit does not cover". The whole-plan audit (WP-11.6) was meant to close that, and on this evidence it did not. Second, the repository's _recorded_ staging is genuinely excellent and I found no case of a staging note that was false — the honesty discipline holds. The failure mode here is not dishonesty; it is that **absence of a spec section from the plan produces no note at all**, and four shipped documents drifted after the work they described moved on.

---

# Domain B — Rendering, Materials, Geometry, Lighting, Particles, Backends

**Analyst scope:** `packages/{render,render-webgl,render-webgpu,render-canvas,render-svg,geometry,materials,particles}` against `docs/SPECIFICATION.md` §43–§70, §86, §112, §118–§120.
**Tree audited:** `claude/tools-integration-rji2sr` @ `cff56e7`, working tree clean.

## How to read this section

Every claim below was checked against source, not against documentation. Where a gap is **recorded** I cite the dated staging note; where it is **silent** nobody wrote it down anywhere (source, `TODO.md`, `MEMORY.md`, `docs/AUDIT-120.md`, `docs/Architecture/*`). Silent gaps are marked ⚠️.

**Headline:** the domain ships a genuinely well-built _thin vertical slice_ — one backend, four fixed pipelines, three geometry builders, three material classes, one light. Nearly everything above that slice is absent. The staging discipline is real and unusually good (`AUDIT-120.md` S-1…S-7, dated module headers), but it is organised around §120's MVP checklist, so **the sections §120 never mentions — §54, §58, §60, §63, §67, §70 — have no owner and no staging record at all.** Those are the five most important findings here.

| Severity | Count | IDs                                                                                                              |
| -------- | ----- | ---------------------------------------------------------------------------------------------------------------- |
| blocker  | 9     | R-2, R-4, R-9, R-12, R-14, R-16, R-19, R-20, R-24                                                                |
| major    | 20    | R-1, R-3, R-5, R-6, R-7, R-8, R-10, R-11, R-13, R-15, R-17, R-18, R-21, R-22, R-25, R-26, R-27, R-30, R-31, R-33 |
| minor    | 8     | R-23, R-28, R-29, R-32, R-34, R-35, R-36, R-37                                                                   |

---

## Renderer core and backends

### R-1 — Four of five §62 backends are one-line stubs

**§62.** `packages/render-webgpu/src/index.ts`, `render-canvas/src/index.ts`, `render-svg/src/index.ts` each contain exactly one line (`export const PACKAGE_NAME = …`). There is no headless/software _rendering_ tier either — `NullRenderer` (`packages/render/src/renderer.ts:~470`) records calls and rasterizes nothing, and its own docs say so.
**Missing:** WebGPU, Canvas 2D, SVG, software raster.
**Severity:** major (§120 says "WebGL 2 only", so this is on-plan) — but it compounds R-14 and R-32: WebGPU is the prerequisite for GPU particles and compute, and Canvas/SVG are the prerequisite for §60a's documented sRGB-native divergence.
**Effort:** L each. **Depends on:** R-12 (Material base), R-14 (shader model) — a second backend without a backend-independent shader model duplicates all four pipelines by hand.
**Recorded:** yes — `MEMORY.md` standing facts, `OVERVIEW.md` package table, package READMEs ("interface reserved; not yet implemented").
**Closure:** a backend package is only tractable after §60's shader IR exists. Sequence R-14 → R-1.

### R-2 — No backend selection; `renderer: "auto"` does not exist

> **CLOSED 2026-08-07** — `packages/render/src/renderer-registry.ts` +
> `registerWebglRenderer()`. §62's preference order (WebGPU → WebGL 2 → Canvas 2D →
> SVG; registration order ignored — §33; headless never auto-selected),
> fallback-on-initialization-failure with disposal, fail-fast on an explicit name, §85
> failures naming what is registered. §62's diagnostics event is an `onFallback`
> callback (no `render → diagnostics` edge exists). Explicit registration, never
> side-effect imports (`"sideEffects": false` makes those deletable). **Left open:**
> only one backend is registrable, so the ladder's upper rungs are exercised against
> doubles (R-1).

**§62, §45.** §62 requires `renderer: "auto"` with WebGPU → WebGL 2 → 2D preference, a diagnostics event on WebGPU failure, and fail-fast `RENDERER_INITIALIZATION_FAILED` on explicit `"webgpu"`. `ApplicationOptions.renderer` (`packages/fourjs/src/application.ts:197`) is `Renderer | false` — an **instance** the app constructs. There is no registry, no string form, no fallback path.
**Missing:** the whole §62 selection layer; also §45's `width`/`height`/`resolution`/`alpha`/`powerPreference`/`autoResize` (TODO at `application.ts:146`).
**Severity:** blocker for a real app — every consumer must hardcode a backend import, which defeats the payload argument the deferral was made for.
**Effort:** M. **Depends on:** R-1 (needs ≥2 backends to be meaningful; the fail-fast half is buildable today).
**Recorded:** yes — `TODO.md` "Phase 3 exit findings", `MEMORY.md` 2026-08-01, in-source TODOs at `application.ts:146,185`.
**Closure:** new `packages/render/src/registry.ts` (backend id → lazy factory), widen `ApplicationOptions.renderer` to `Renderer | RendererBackend | "auto" | false`, emit the diagnostics event through the existing `@fourjs/diagnostics` channel.

### R-3 — §62 capability reporting is 2 of 11 categories, and applications cannot declare requirements

**§62.** `RendererCapabilities` (`packages/render/src/renderer.ts:~95`) has `backend` and `maxTextureSize`. §62 requires eleven: texture dimensions, formats, multisampling, float targets, timestamp queries, storage buffers, compute shaders, indirect draw, compressed textures, shader precision, max uniforms/bindings. §62 also states _"Applications may declare required and optional capabilities"_ — there is no such API anywhere.
**Severity:** major. **Effort:** S for the fields (all are `gl.getParameter` / extension probes in `readCapabilities`, `packages/render-webgl/src/webgl-renderer.ts:288`); M for the declaration/negotiation API.
**Recorded:** the _fields_ are recorded as a WP-3.4 decision in `renderer.ts`. ⚠️ **The required/optional declaration API is silent** — no note anywhere mentions it.
**Closure:** widen `RendererCapabilities`; add `RequiredCapabilities` to `RendererOptions` and reject in `initialize` with `RENDERER_INITIALIZATION_FAILED` (§89).

### R-4 — No render targets, no `createTexture`, no `readPixels` — nothing renders off-screen

> **CLOSED 2026-08-07** (minimal tier) — `RenderTarget` in `@fourjs/render`,
> `RenderTargetCache` in `@fourjs/render-webgl`, `Renderer.render(root, views,
interpolation?, target?)`; render-to-texture verified end-to-end
> (`tests/integration/render-to-texture.test.ts`) through the untouched
> `MaterialTexture` seam. A no-target frame issues zero framebuffer calls (byte-identical
> 449-call proof); FBO binding lives inside the F13 exception envelope; feedback loops
> refused. Deviations documented in source: target rides on `render`, not
> `Viewport.renderTarget`; `createRenderTarget` deferred by decision (CPU descriptor +
> backend cache). Still absent, staged with dates: `readPixels` (needs `Rectangle2`),
> stencil (R-7), MRT, multisample, float formats, samplable depth (§69). Unblocks
> R-5/R-6. Kept for the record.

**§61, §48, §63.** Three of §61's eight members are absent, written out as a typed TODO at `packages/render/src/renderer.ts:273-290`. Consequence chain, all verified:

- `Viewport` (`packages/scene/src/viewport.ts:50`) has no `renderTarget` → §48's minimaps-to-texture, picture-in-picture, mirrors, portals, offscreen textures, and "3D model previews inside 2D UI" are all unbuildable.
- No `readPixels` → §92's pixel-level regression tier can only run through Playwright screenshots (`tests/visual/` holds exactly one spec).
- No render-target texture → §63's transient resources and §70's entire effect chain have nowhere to write.

**Severity:** blocker — "render this camera to a texture" is table stakes and there is no public path to it.
**Effort:** M (WebGL FBO wrapper + `RenderTarget` type + `Rectangle2` in `@fourjs/math`). **Depends on:** nothing. **Blocks:** R-5, R-6, R-7 (stencil), R-31.
**Recorded:** yes — typed TODO in `renderer.ts`, `viewport.ts:35-42`, `texture.ts:32-56`.
**Closure:** `packages/render/src/render-target.ts` (id/version/size/format, same cache contract as `Texture`), `packages/render-webgl/src/gl-render-target.ts` (FBO cache mirroring `GeometryCache`/`TextureCache`), add the optional `Viewport.renderTarget`, bind per view in `WebglRenderer.render`'s view loop.

### R-5 — §63 render graph does not exist

> **CLOSED 2026-08-07 (linear-pass tier).** `RenderGraph` in `@fourjs/render`: named,
> ordered, enableable passes over R-4's target seam, one `execute()` call,
> transcript-identical to the hand-written `renderer.render` calls it replaces.
> Shipped: declared `inputs` (acyclic by construction) + discovered sampled-target
> validation (`buildRenderList` + `isRenderTargetTexture` — sees what the backend
> sees), enable/disable, per-pass viewports, textual `describe()`, an honest `"opaque"`
> issue on every `CustomRenderPass`. Staged with dated reasons: transient targets,
> resource lifetimes, barriers (backend facts; real for WebGPU), on-screen debug view
> (needs §70's blit). §63's fixed pass order is now _expressible_ but not prescribed —
> R-10/R-29 still own ordering/sorting. Unblocks R-6: effects are graph passes. Kept
> for the record.

**§63.** Zero implementation. The only source references are three lines naming §63 as _somebody else's_ prerequisite (`renderer.ts:285`, `texture.ts:181`, `viewport.ts:42`). The spec's `Four.RenderGraph` example, pass dependencies, transient targets, resource lifetime, barriers, pass enable/disable, per-viewport pipelines, and debug visualization are all absent. `docs/guides/materials-and-render-graph.md` is honest about this.
**Severity:** major. **Effort:** L. **Depends on:** R-4.
**Recorded:** ⚠️ **partially — no design note or dated staging record owns §63.** It appears only in `OVERVIEW.md:190`'s staged list, added after the fact. No file in `packages/render/src` claims it.
**Closure:** `packages/render/src/render-graph.ts` (DAG of passes + resource handles, backend-independent) plus a backend pass-executor seam. Note §63's fixed pass order (depth prepass → shadows → opaque → transparent → world vectors/text → post → screen UI → composite) is also the missing structure behind R-10 and R-29.

### R-6 — §70 post-processing: zero references anywhere in the codebase ⚠️

> **CLOSED 2026-08-07 (full-screen effect tier)** — the ⚠️ silent flag drops: blit
> (`COPY_EFFECT`, bit-exact) + colour grade ship as `EffectRenderPass`, a first-class
> third `RenderGraph` pass kind whose `source` field `validate()` checks exactly;
> `Renderer.renderEffect` is optional (presence is the capability) and a separate verb,
> so `render`'s transcript is pinned unchanged. The eight staged effects each name the
> resource they wait on in `packages/render/src/effect-pass.ts` (tone mapping → §60a +
> float targets; bloom → transient pool; AA/DoF/motion-blur/SSAO → MSAA/samplable
> depth/MRT; outlines → R-7/§71; user shaders → R-14, which widens the closed
> `ScreenEffect` union; distortion → second input). ui-demo's budget moved 30 → 31 kB
> on a proven structural conflict, recorded in CHANGELOG/MEMORY. Kept for the record.

**§70.** Grepping `§70`, `postProcess`, `toneMapping`, `bloom`, `SSAO`, `outline` across `packages/*/src` returns **nothing**. None of tone mapping, colour grading, bloom, AA, DoF, motion blur, SSAO, outlines/selection highlighting, distortion, or custom full-screen passes exists, and there is no seam through which a consumer could add one. §70's "composable per viewport" requirement has no carrier (`Viewport.postProcessing` is absent, R-4).
**Severity:** major (blocker for anything wanting selection outlines — an explicit §70 bullet and an obvious need for the §119 engineering demo).
**Effort:** L. **Depends on:** R-4, R-5, R-14.
**Recorded:** ⚠️ **silent.** `OVERVIEW.md` does not list it; the only acknowledgement anywhere is one sentence in `docs/guides/custom-shaders.md`.
**Closure:** effects are render-graph passes; do not build a parallel mechanism. Sequence R-4 → R-5 → R-14 → R-6.

### R-7 — §67 clipping, masks and stencils absent

**§67.** The only trace is a comment: `stencil: false` with `/** No stencil until §67's masks land. */` (`packages/render-webgl/src/webgl-renderer.ts:151,944`) — the GL context is requested **without a stencil buffer**, so nothing can be added without a context re-creation. Rectangular scissor exists only as the per-viewport rect (`webgl-renderer.ts:690`), not as a user-facing clip. Missing: path masks, alpha masks, stencil masks, nested clipping, UI overflow clipping, 3D clipping planes, engineering section views, and the "defined behavior and diagnostics when backend limits are exceeded" §67 demands.
**Severity:** major — UI overflow clipping is required by §74/§73 and `@fourjs/ui` ships scrollable-looking panels without it; section views are a named §119 need.
**Effort:** M. **Depends on:** R-12 (§57's `stencil?: StencilState` is the carrier).
**Recorded:** ⚠️ **near-silent** — one inline comment, no dated note, absent from `AUDIT-120.md` and `TODO.md`.
**Closure:** request `stencil: true` in `createContext`; add `StencilState` to the §57 base; add `Renderable.clip`/scissor rect; nested-depth diagnostic against `MAX_STENCIL_BITS`.

### R-8 — §64 stage 3 (culling) is not implemented; `frustumCulled` does not exist

**§64, §87, §49.** `buildRenderList` (`packages/render/src/render-list.ts`) implements stages 1, 2, 4, 5 only. Every visible, enabled drawable is submitted for every viewport — no frustum test, no occlusion, no spatial index. `Renderable` (`packages/render/src/renderable.ts`) has no `frustumCulled` field. The render list is also built **once per frame, not per view** (`webgl-renderer.ts:~650`), so per-view culling and §48's `layerMask` are structurally impossible without reworking that loop.
**Severity:** major (perf). **Effort:** M–L. **Depends on:** R-38 (layers), and the per-view-list restructure.
**Recorded:** yes — `render-list.ts:19-23`, `renderable.ts:51`, `buffer-geometry.ts:88`.
**Closure:** world-space AABB per item (needs `BoundingVolume` transform, R-22), frustum planes off `Camera`, a `views.length > 1` fast path that builds one list per view.

### R-9 — §65 batching does not exist: one draw call per renderable and per sprite ⚠️

**§65, §86.** Verified in the draw loop (`packages/render-webgl/src/webgl-renderer.ts:724-840`): every non-particle item does `bindVertexArray` + `drawArrays`/`drawElements`. **Nothing is batched.** None of §65's nine strategies is implemented except the single instanced particle path (`gl-particles.ts`): no sprite batching, no glyph batching, no compatible-shape batching, no instanced meshes, no material/pipeline sorting (see R-10), no texture-atlas grouping, no persistent/staged buffers, no multi-draw. §65's closing requirement — _"inspectable through diagnostics"_ — has no implementation either: there are **zero** draw-call/frame counters anywhere (`packages/diagnostics/src` contains only checksum, debug-draw, recorder, replay).

Direct consequences measured, not inferred:

- The §106a text label costs **one texture + one draw call per glyph cell** (`examples/first-2d-scene/main.ts:628-690` builds a `SpriteMaterial` per cell).
- §86's "100,000 batched sprites at 60 FPS" and "50,000 simple batched shapes" are **architecturally unreachable**, not merely unmeasured.

**Severity:** blocker at any real scale. **Effort:** L. **Depends on:** R-10 (needs pipeline sorting to make batches contiguous), R-21 (needs uv attributes for atlas batching), R-30 (frame regions).
**Recorded:** partially — `TODO.md` backlog has "§55 frame regions + §65 sprite batching"; `render-list.ts:24` records the deferral. ⚠️ **Silent:** the general absence of _any_ batching, and §65's diagnostics-inspectability clause.
⚠️ **Doc defect:** `docs/AUDIT-120.md`'s Rendering table marks sprites _"shipped … §55; batched"_. They are not batched.
**Closure:** dynamic vertex-stream batcher in `@fourjs/render-webgl` keyed on `(kind, program, texture)`; requires the sort in R-10 first, otherwise batches never form.

### R-10 — §66 ordering: 2 of 5 sort keys; no transparency machinery at all

**§66.** `compareRenderItems` (`packages/render/src/render-list.ts:547-551`) compares `renderLayer` then `renderOrder`, tie-broken by scene order via stable sort. §66's keys 2 (opaque/transparent), 3 (pipeline/material) and 4 (depth) are all absent. Also absent: the OIT extension point, weighted-blended transparency, depth-prepass control, explicit alpha test, alpha-to-coverage, and any premultiplied-alpha policy (everything is straight alpha).

Two concrete consequences:

1. Opaque and blended items **interleave in scene-graph order** within a layer, so the backend's `activeKind` switch (`webgl-renderer.ts:681-836`) can thrash `program.use()` once per item; and a blended sprite authored before opaque geometry draws first and gets depth-rejected wrongly. The only control an author has is manual `renderLayer`/`renderOrder`.
2. Because key 3 does not sort, R-9's batcher would never see contiguous runs even if it existed.

**Severity:** major. **Effort:** S for keys 2–4 once §57's `transparent`/`blendMode` exist; M for OIT/weighted-blended.
**Recorded:** yes — `render-list.ts:33-50`, `sprite.ts:76`, `webgl-renderer.ts:393`.
⚠️ **Doc defect:** `docs/guides/materials-and-render-graph.md` states _"Items sort by render layer, then kind (opaque unlit first, then blended sprites, then particles), then material"_. The comparator does none of that. Fix the guide or the comparator — currently the guide describes an engine that does not exist.
**Closure:** extend `compareRenderItems` after R-12 lands `transparent`; add `pipelineKey` to `RenderItemBase`; depth key needs the per-view list from R-8.

### R-11 — Unlit and lit materials render with blending disabled; alpha is a dead field

**§57, §66, §60a.** `webgl-renderer.ts:717,807,831` explicitly `gl.disable(GL.BLEND)` for the unlit and lit pipelines. `UnlitMaterial.color[3]` and `LitMaterial.color[3]` therefore have no effect — animating opacity is silently invisible, which the animation package can do and the examples work around with hue tricks.
**Severity:** major (a silent no-op on a public, animatable, type-checked field is worse than a missing feature).
**Effort:** S once §57's `transparent`/`blendMode` exist. **Depends on:** R-12, R-10.
**Recorded:** yes — `TODO.md` "Chores (Phase 4 exit-verifier notes)", `docs/guides/materials-and-render-graph.md`.

---

## Materials and shading

### R-12 — §57's abstract `Material` base and 8 of 10 family members are absent; the material set is closed

**§57, §49.** `@fourjs/materials` exports exactly `UnlitMaterial`, `LitMaterial`, `SpriteMaterial`. There is no abstract base, so none of §57's shared state exists anywhere: `opacity`, `transparent`, `blendMode`, `depthTest`, `depthWrite`, `colorWrite`, `stencil`. Missing family members: `ShapeMaterial`, `TextMaterial`, `LineMaterial`, `StandardMaterial`, `PhysicalMaterial`, `ShaderMaterial`, `NodeMaterial`, `ComputeMaterial`.

The set is **closed at the type level**, which is the ergonomics half of this gap: `Renderable.material` is the union `UnlitMaterial | LitMaterial` (`packages/render/src/renderable.ts:100`), `RenderItemKind` is the closed union `"unlit" | "lit" | "sprite" | "particles"` (`render-list.ts:97`), and `WebglRenderer.render` dispatches on it with an `else` fallback. **A consumer cannot add a material type without editing three packages.** §49's `material: Material | Material[]` (multi-material submeshes) is likewise unreachable.

**Severity:** blocker for extensibility; the single largest structural debt in the domain — R-7, R-10, R-11, R-13, R-14, R-16, R-30 all wait on it.
**Effort:** M for the base; L including the family.
**Recorded:** yes, and well — `unlit-material.ts:4-21` argues the deferral, `sprite.ts:12-38` records the exact type-level obstacle that keeps `Sprite` off `Renderable`. `TODO.md` carries the related spec-revisit item (§57's family list has no `LitMaterial`).
**Closure:** `packages/materials/src/material.ts` (abstract base + `RenderState`), re-parent all three concretes, widen `Renderable.material`, re-parent `Sprite` onto `Renderable` and delete its four re-declared members (`sprite.ts` documents this as a mechanical change), replace `RenderItemKind`'s closed union with a `pipelineId` string the backend resolves through a registry.

### R-13 — §59 `StandardMaterial` / PBR absent

**§59.** No metallic-roughness workflow, no `baseColor`/`roughness`/`metalness`, no normal/occlusion/emissive maps, no glTF compatibility. The lit tier is Lambert-diffuse-times-colour (`packages/materials/src/lit-material.ts`). §59's extension list (clearcoat, transmission, IOR, sheen, anisotropy, subsurface, iridescence) is correspondingly absent.
**Severity:** major (blocker for any 3D app that wants to look like 2026). **Effort:** L.
**Depends on:** R-12, R-21 (needs uv + tangent attributes), R-15 (PBR is meaningless without linear-light), R-17 (needs >1 light), R-31 (needs real textures).
**Recorded:** yes — `TODO.md` lighting follow-ups, `AUDIT-120.md` S-5, `lit-material.ts:12-19`, `MEMORY.md` 2026-08-04. Also blocks glTF (S-7).

### R-14 — §60 shader / node-material system: no user shaders exist, at any level

> **RFC DRAFTED 2026-08-07** — `docs/rfcs/0001-shader-and-node-material-system.md`
> proposes a serializable shader graph in `@fourjs/materials` as the unit of extension,
> with no user GLSL/WGSL at any tier; a separate lazily-compiled, explicitly-registered
> node pipeline preserving R-19's byte-identical GL sequence; and one new `ScreenEffect`
> member (`GraphEffect`) that stays checkable by `RenderGraph.validate()` rather than
> reporting opacity. Status draft, **owner decision pending** — the packet is blocked on
> it.

**§60.** Nothing in the shipped surface accepts user GLSL or WGSL. The four programs (`UnlitProgram`, `LitProgram`, `SpriteProgram`, `ParticleProgram`) are compiled from string constants private to `packages/render-webgl/src/gl-program.ts` and `gl-particles.ts`. None of §60's compiler (WGSL/GLSL ES generation, reduced Canvas/SVG fallbacks), node graph, reusable functions, uniform blocks, storage buffers, conditional variants, reflection metadata, or source maps exists.
**Severity:** blocker for the "advanced users" §60 names, and the root cause of R-1's cost and R-6's impossibility.
**Effort:** L (largest single item in the domain).
**Recorded:** **yes, exemplarily** — `docs/guides/custom-shaders.md` opens with an "Honest state" section saying plainly _"There is no custom shader API yet… You cannot write a custom material for the WebGL backend today"_, and correctly ties §59/§63/§68/§70 to the same missing seam. ⚠️ Minor staleness: that guide says "three fixed, internal programs"; `LitProgram` made it four on 2026-08-04.
**Closure:** RFC first (the guide already flags the §96 constraint: declarative, not raw string injection). Sequence R-12 → R-14 → {R-1, R-6, R-13}.

### R-15 — §60a colour management is entirely unimplemented; the pipeline is not linear-light

**§60a.** The spec makes the GPU pipeline linear-light with an sRGB output transform as the final graph pass. Reality:

- No colour-space metadata on `Texture`/`TextureSource` (`packages/render/src/texture.ts:100-110` says so explicitly) — sRGB colour maps are sampled **raw**, so the lit pipeline's Lambert product is computed in sRGB space.
- No output transform, no tone mapping, no exposure (§68 requires both).
- No CSS colour-string parsing anywhere. §50/§59/§68's own examples (`fill: "#4466ff"`, `color: "#ffffff"`) **do not compile** against the shipped API; every colour is a numeric tuple.
- `Viewport.clearColor` is documented as linear-light (`viewport.ts:87-95`) while textures are sRGB-raw — the two are inconsistent today.

**Severity:** major — this is a correctness gap, not a feature gap: shading results are wrong, and they get _more_ wrong as R-13/R-17 land.
**Effort:** M. **Depends on:** nothing hard; do it **before** R-13/R-17 or both get rebuilt.
**Recorded:** yes, consistently — `unlit-material.ts:36-43`, `lit-material.ts:28-38`, `texture.ts:100-110`, `light.ts:18-20`, `AUDIT-120.md` S-5, `TODO.md`.
**Closure:** `packages/math/src/color.ts` (`Color` type + CSS parse + sRGB↔linear), `colorSpace: "srgb" | "linear"` on `TextureSource` → `SRGB8_ALPHA8` internal format in `TextureCache`, tone-map + encode as the final pass (needs R-4/R-5) or as a shader epilogue in the interim.

### R-16 — §58 paints, fills and strokes: no `Paint`, no gradients, no `StrokeStyle` ⚠️

**§58.** Grepping `§58`, `Paint`, `gradient`, `StrokeStyle` across `packages/*/src` returns nothing. Missing in full: solid/linear-gradient/radial-gradient/conic-gradient/image-pattern/procedural-shader/render-target paints, and the entire `StrokeStyle` interface (`width`, `alignment`, `lineCap`, `lineJoin`, `miterLimit`, `dash`, `dashOffset`).
**Severity:** blocker for the 2D/vector half of the product thesis — a framework that advertises "vector graphics" cannot fill a shape with a gradient or stroke a line with a round join.
**Effort:** L. **Depends on:** R-24/R-25/R-26 (nothing to paint yet), R-12.
**Recorded:** ⚠️ **silent.** `AUDIT-120.md` S-4 stages §50/§51/§52 including "stroke generation — joins, caps, dashes, stroke alignment", but **§58's paint model is named nowhere** — not in S-4, not in `TODO.md`, not in any module header.
**Closure:** fold into the tessellation packet; `Paint` belongs in `@fourjs/materials` next to `ShapeMaterial` (R-12), `StrokeStyle` in `@fourjs/geometry` next to the stroke expander (R-26).

---

## Lighting and shadows

### R-17 — §68: exactly one directional light, no light types, no environment, no exposure

**§68.** `collectSceneLights` (`packages/render/src/lights.ts:250-280`) walks the graph depth-first and takes **the first** `DirectionalLightSource` it finds; every subsequent directional light is silently ignored. `Scene.ambientLight` is a scene-wide RGB constant, not a node. Missing: multi-light, hemisphere, point, spot, rectangular area, light layers, environment lighting, IBL, tone mapping, exposure, physically coherent units, and the clustered/forward-plus path.
**Severity:** blocker for a real 3D app — a scene cannot have two lamps.
**Effort:** L (per-light uniform arrays, then the clustered path). **Depends on:** R-15 (units/tone mapping), R-12.
**Recorded:** yes, and precisely dated — `packages/scene/src/light.ts:1-25` (2026-08-04), `packages/render/src/lights.ts:11-20`, `MEMORY.md` 2026-08-04, `AUDIT-120.md` S-5, `TODO.md`. `castShadow` is _deliberately absent rather than accepted-and-ignored_, which is the right call.

### R-18 — §69 shadows: nothing

**§69.** No shadow maps of any kind. `Renderable` has no `castShadow`/`receiveShadow` (`renderable.ts:49-52`); `DirectionalLightOptions` has no `castShadow`. Missing in full: directional maps, point cubemaps, spot shadows, cascades, resolution config, bias/normal-bias, PCF, transparent shadow masks, contact shadows, atlas management.
**Severity:** major. **Effort:** L. **Depends on:** R-4 (depth render targets), R-5 (shadow passes are graph passes), R-17.
**Recorded:** yes — `light.ts:15-17`, `lit-material.ts:18`, `lights.ts:20`, `gl-program.ts:956`, `renderable.ts:50`, `TODO.md`, `AUDIT-120.md` S-5.

### R-19 — Sprites and 3D geometry cannot be textured; §53 ships two of eight standard attributes

> **CLOSED 2026-08-07** (the load-bearing half) — `BufferGeometry.uvs`/`.colors` on the
> `normals` precedent; `UnlitMaterial.map`/`.vertexColors` and `LitMaterial.map` over the
> new `MaterialTexture` contract; uv/colour streams in `@fourjs/render-webgl` behind a
> uniform switch whose GL-initial-`0` default keeps untextured scenes byte-identical
> (pixel goldens unchanged). R-35's data path now exists. Sprite's derived-uv path stays,
> deliberately — §55's atlas packet owns the rewrite. Tangents, second uv, joints/weights,
> and instance transform remain deferred. Kept for the record.

**§53, §54, §55.** `BufferGeometry` carries `positions`, optional `normals`, optional `indices`, `mode` — and nothing else (`packages/geometry/src/buffer-geometry.ts:293-355`). §53's standard set requires position, normal, **tangent, color, uv and secondary uv, joints and weights, instance transform, custom typed attributes**. Six of eight are absent.

The sharpest consequence is not obvious from the attribute list: **there is no way to texture a mesh.** `UnlitMaterial` and `LitMaterial` carry a colour and no texture; only `Sprite` samples a texture, and it derives uv **from vertex position** as a documented workaround (`packages/render/src/sprite.ts:56-66`). So a textured box, a textured ground plane, or a textured glTF mesh is unreachable through the public API.

Secondary consequence: no per-vertex `color` attribute is why §113's debug-draw overlay cannot be drawn (R-35), and no `joints`/`weights` is why skeletal animation has no render path.
**Severity:** blocker. **Effort:** M (attribute set) + S (`textureMap` on the material, after R-12).
**Recorded:** partially — the _attribute_ deferral is recorded (`buffer-geometry.ts:5-20`, `primitives.ts:35`). ⚠️ **The consequence — "no textured meshes exist in this engine" — is stated nowhere**, and `AUDIT-120.md`'s "basic 3D meshes: shipped" row obscures it.
**Closure:** generalize `BufferGeometry` to a named-attribute map (keeping `positions`/`normals` as typed accessors for source compatibility), emit uvs from `boxGeometry`/`planeGeometry`/`circleGeometry2D`, add a `map` slot to the §57 base, extend `UnlitProgram`/`LitProgram` with a sampler.

---

## Geometry

### R-20 — §53: 3 of 11 required 3D primitives; no sphere, no cylinder, no capsule, no torus

> **CLOSED 2026-08-07** — nine primitives shipped (`sphere`, `cylinder`, `cone`,
> `capsule`, `torus`, `lathe`, `extrude`, `tube`, `heightField`): Y-up, centred, CCW,
> analytic normals + uvs, §85-validated, tests recomputing face normals from positions as
> an independent oracle. `extrude` rejects concave capped outlines until §52's
> tessellation module; `tube` is parallel-transported; `capsule.height` matches §24's
> collider measurement. Kept for the record.

**§53.** `@fourjs/geometry` exports `boxGeometry`, `planeGeometry`, `circleGeometry2D` (`packages/geometry/src/primitives.ts`). Missing: **sphere, cylinder, cone, capsule, torus, lathe, extrusion, tube, height field** — nine of eleven.
**Severity:** blocker. `@fourjs/physics` ships sphere, capsule and cylinder _colliders_; there is no way to draw them. Every physics demo therefore renders boxes for round bodies, and §119's motor model is unbuildable.
**Effort:** M (mechanical; the winding/normal conventions and validation patterns are already established and tested).
**Recorded:** ⚠️ **semi-silent.** `primitives.ts:4-9` names the eleven and says "the rest are later packets" — but this appears in **no** tracker: not `TODO.md`, not `AUDIT-120.md` (S-4 covers 2D shapes only), not `MEMORY.md`, not `OVERVIEW.md`'s staged list. Nothing schedules it, and `AUDIT-120.md` marks "basic 3D meshes" as unqualified **shipped**.
**Closure:** extend `packages/geometry/src/primitives.ts` (or split per-primitive modules); each is ~60 lines plus a winding/normal test in `packages/geometry/tests/geometry.test.ts`. Do this **with** R-19 so the new primitives emit uvs once rather than twice.

### R-21 — §53 geometry family, `clone()`, and `BoundingVolume` are absent

**§53.** §53 defines `abstract class Geometry` with `id`, `version`, `bounds: BoundingVolume`, `computeBounds()`, `clone()`, `dispose()`, and the family `Geometry2D` (`PathGeometry2D`, `FillGeometry2D`, `StrokeGeometry2D`) / `Geometry3D` / `BufferGeometry` / `IndexedGeometry` / `ProceduralGeometry`. Shipped: one concrete class. `clone()` does not exist. `bounds` is an AABB-only `computeBounds()` returning `{min, max}` (`buffer-geometry.ts:414`), not a `BoundingVolume` (no sphere, no OBB) — which is also what R-8's frustum culling needs.
**Severity:** major (the missing `clone()` is a real ergonomics hole: §78 requires loaded assets to share immutable geometry safely, and there is no supported way to fork one).
**Effort:** S–M. **Recorded:** yes — `buffer-geometry.ts:5-16,86-91`.

### R-22 — §54 Mesh, instancing, LOD, morph targets, skinning: entirely absent ⚠️

> **RFC DRAFTED 2026-08-07** — `docs/rfcs/0003-skinning-and-skeletal-animation.md`
> covers both halves (PH-10 + R-22's skinning rows): joints/weights as `BufferGeometry`
> attributes at locations 4/5, `Bone`/`Skeleton` as scene-graph nodes (§42 authority and
> §19 blending need no new mechanism), skinned draws as a separate lazily-compiled
> pipeline. Findings: §54's `morphTargetWeights` placement is unimplementable under the
> frozen §3.1 matrix; §17's two missing track types are binding gaps, not `ValueKind`
> gaps. Status draft, **owner decision pending** — bone-axis convention is the named
> question.

**§54.** Grepping `§54` across `packages/*/src` returns **one** incidental hit. Verified absent, all of it:

| §54 requirement                                             | state                                                                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `class Mesh extends Renderable` with `geometry: Geometry3D` | ✗ — only the concrete `Renderable`                                                                                             |
| indexed and non-indexed geometry                            | ✓                                                                                                                              |
| multiple material groups                                    | ✗                                                                                                                              |
| hardware instancing                                         | ✗ — instancing exists **only** in the particle pipeline (`gl-particles.ts`)                                                    |
| indirect rendering                                          | ✗                                                                                                                              |
| morph targets (`morphTargetWeights`)                        | ✗                                                                                                                              |
| skeletal deformation (`skeleton`)                           | ✗                                                                                                                              |
| static **and dynamic** GPU buffers                          | ✗ — every geometry buffer uploads `STATIC_DRAW` (`gl-geometry.ts:275,292,306`); a per-frame-changing geometry re-uploads whole |
| level-of-detail selection                                   | ✗                                                                                                                              |
| impostors and billboards                                    | ✗                                                                                                                              |
| geometry merging / batching tools                           | ✗                                                                                                                              |

**Severity:** major; the instancing row is a **blocker** for §86's "100,000 simple mesh instances", which is unreachable by construction.
**Effort:** L. **Depends on:** R-19 (instance-transform attribute), R-12 (material groups).
**Recorded:** ⚠️ **silent — §54 has no staging note anywhere in the repository.** It is absent from `AUDIT-120.md` (which folds it into "basic 3D meshes: shipped, §53–54"), `TODO.md`, `MEMORY.md`, and `OVERVIEW.md`'s staged list. Given `@fourjs/animation` ships a mixer with no skinning target and `@fourjs/assets` stages glTF partly on this, it is the highest-value silent gap in the domain after R-6.

---

## 2D vector graphics

### R-23 — §50 shape catalogue: 0 of 14 shape _nodes_

**§50.** No `Shape2D`, `Circle`, `Ellipse`, `Rectangle`, `RoundedRectangle`, `Polygon`, `Polyline`, `Arc`, `Star`, `Line`, `Sector`, `Ring`, `Path`, or Bézier path node exists. `circleGeometry2D` is a geometry builder, not a node, and it is the only 2D primitive. None of §50's shape requirements (fill/stroke, opacities, stroke alignment, dashes, joins, caps, clipping/masks, boolean ops, bounds, analytic hit testing, SVG import/export) is implemented. §50's own example (`new Four.Rectangle({ width, height, radius, fill, stroke })`) does not compile against the shipped API; nor does §97's mixed-scene example.
**Severity:** minor _for the shipped MVP_, **blocker for the product** — this is half of what "2D graphics" means in §1.
**Effort:** L. **Depends on:** R-12, R-16, R-26.
**Recorded:** yes — `AUDIT-120.md` S-4 (dated 2026-08-02), and `packages/input/src/pick.ts:55-59` correctly defers analytic picking to it.

### R-24 — §51 `Path` model absent

**§51.** No path type. Missing: `moveTo`/`lineTo`/`quadraticCurveTo`/`cubicCurveTo`/`arc`/`close`, flatten, subdivide, simplify, reverse, transform, length, point/tangent/normal evaluation, closest-point query, offset path, boolean union/intersection/subtraction/xor, and the nonzero/even-odd fill rules.
**Severity:** blocker for vector work; also blocks §56's "text along paths" and §13-adjacent path authoring.
**Effort:** L. **Recorded:** yes — `AUDIT-120.md` S-4.

### R-25 — §52 tessellation subsystem absent, including its explicitly-required module boundary

**§52.** §52 states _"The tessellator shall be an isolated module of `@fourjs/geometry` with a stable interface so implementations can be replaced without changing the scene API."_ No such module exists — `packages/geometry/src` contains `buffer-geometry.ts`, `primitives.ts`, `index.ts`. Missing: concave polygons, holes, self-intersections, adaptive curve subdivision, stroke expansion, AA fringe generation, index-buffer reuse, incremental rebuild of modified segments.
**Severity:** major — this is the load-bearing prerequisite for R-16, R-23, R-24, and for SDF text.
**Effort:** L. **Recorded:** yes — `AUDIT-120.md` S-4 ("a tessellation packet is the natural home"); `MEMORY.md:570` records the spec decision to keep it inside `@fourjs/geometry`.

### R-26 — SVG import/export compatibility (§50) unaddressed ⚠️

**§50** lists "SVG import/export compatibility" as a shape requirement. Nothing in `@fourjs/geometry`, `@fourjs/assets`, or `@fourjs/serialization` parses or emits SVG path data.
**Severity:** major (it is the practical on-ramp for 2D content and the natural pairing with the `render-svg` stub).
**Effort:** M once R-24 exists. **Recorded:** ⚠️ **silent** — S-4 lists the shape catalogue and the path model but not SVG interop.

---

## Renderable hierarchy, text, sprites, textures

### R-27 — §49's Renderable family and five of its seven fields are missing

**§49.** `Renderable` is **concrete**, not abstract, and the family is unbuilt: `Shape2D` (R-23), `Text` (R-28), `Mesh` (R-22), `Line3D`, `PointCloud`, `CustomRenderable` — none exists. `Sprite` extends `Node`, not `Renderable` (type-level, documented). `ParticleRenderable` is recognised structurally, not by inheritance. Of §49's seven declared fields, only `material`, `renderLayer`, `renderOrder` ship; `depthMode`, `castShadow`, `receiveShadow`, `frustumCulled` are absent and `material` is narrowed from `Material | Material[]`.

**API ergonomics:** the only extension point for a custom drawable is the duck-typed `ParticleDrawable` brand (`packages/render/src/particles.ts:139-196`), which forces the caller into the fixed 8-float instanced-quad layout. There is no `CustomRenderable` and no way to register a pipeline. A consumer wanting a line-strip with per-vertex colour, a point cloud, or an impostor must fork `@fourjs/render` and `@fourjs/render-webgl`.
**Severity:** major. **Effort:** M (mostly falls out of R-12). **Recorded:** yes — `renderable.ts:20-56`.

### R-28 — There is no `Text` node; text is data-only, and each glyph costs its own texture ⚠️

**§49, §56, §97.** `@fourjs/text` states its own boundary plainly (`packages/text/src/index.ts:24-30`): _"This package produces data, never nodes."_ It exports `BUILTIN_FONT`, `buildGlyphAtlas`, `layoutText` — and no node. The §56/§97 example `new Four.Text({ text, fontFamily, fontSize, color, space: "billboard" })` has no counterpart in the shipped API. **No package assembles the atlas + layout into a node**, so every consumer hand-rolls it, exactly as `examples/first-2d-scene/main.ts:621-690` does.

Worse, because §55's `frame` sub-rectangle is missing (R-30) a sprite maps its _whole_ texture, so the workaround **cuts every glyph cell into its own `Texture`** and its own `SpriteMaterial` and its own draw call. A 40-character label is 40 textures, 40 materials, 40 draw calls.
**Severity:** blocker (both ergonomics and performance). **Effort:** M.
**Depends on:** R-30 (frame regions) and R-9 (glyph batching) to be _good_; the node itself is buildable today.
**Recorded:** partially — `TODO.md` backlog records "§55 frame regions + §65 sprite batching (evidence: the example labels cost one texture per glyph cell)", and the guide repeats it. ⚠️ **Silent: the absence of a `Text` node.** `AUDIT-120.md` marks text "shipped (MVP tier)" citing the three data modules; S-6 discusses shaping and SDF but never the missing node. §120's Rendering list says "text", and what ships is a glyph-quad calculator.
**Closure:** `packages/render/src/text.ts` — a `Text` node owning one atlas `Texture`, one `SpriteMaterial`, and one geometry built from `layoutText`'s quads (which merges the label into **one** draw immediately, even before R-9).

### R-29 — §55 sprite features: 4 of 11

**§55.** Ships: world-space sizing, anchor, tint, opacity-through-tint. Missing: `sizeMode: "pixels"`, `frame?: Rectangle2` and atlas regions, nine-slice, `billboardMode`, per-instance data, alpha masks, normal-mapped sprites, sprite animation clips.
**Severity:** major (`frame` is the blocker inside R-28; `billboardMode` needs a per-view render list, R-8).
**Effort:** S for `frame`; M for the rest. **Recorded:** yes — `sprite.ts:67-77`, `sprite-material.ts:158`.

### R-30 — §77 texture system: one format, one filter, one dimension

**§77.** `Texture` is 2D RGBA8, non-mipmapped, from a plain byte array. `TextureCache` fixes sampler state at upload to `LINEAR` + `CLAMP_TO_EDGE` and never changes it (`packages/render-webgl/src/gl-texture.ts:29-38`). Missing: cube/array/3D textures, mipmaps and generation, configurable wrap/filter, anisotropy, colour-space metadata (R-15), compressed containers, render-target textures (R-4), video textures, `ImageBitmap`/canvas sources, async upload and residency diagnostics.
**Severity:** major — no mipmaps means every minified texture aliases; no `ImageBitmap` source means `@fourjs/assets`' `ImageAsset` cannot reach the GPU without a manual byte-array conversion.
**Effort:** M. **Recorded:** yes — `texture.ts:176-186`, `gl-texture.ts:29-38`, `packages/assets/src/loaders.ts:47`.
**Note:** §61's `createTexture` is _deliberately_ not implemented; `texture.ts:32-56` argues convincingly for CPU-resource + backend-cache instead. That is a considered divergence, not a gap — but it should be reflected in a spec amendment rather than left as a permanent unimplemented interface member.

---

## Particles

### R-31 — §36 GPU compute simulation absent; §86's "GPU particles 100,000+" has no path

**§36, §112, §86.** `simulation: "gpu"` is not an accepted option — its absence from `ParticleEmitterOptions` is a deliberate type-level rejection (`packages/particles/src/emitter.ts:41-46`, dated 2026-08-02). GPU compute requires the WebGPU backend (R-1), itself a stub. Likewise `collisions: "depth-buffer"` and §27 GPU fields.
**Severity:** minor today (CPU tier is honest and works), major against §86.
**Effort:** L. **Depends on:** R-1 (WebGPU), §82 GPU compute. **Recorded:** yes, thoroughly.

### R-32 — §36 trails, custom data channels, sprite/mesh particles, sizeMode, rotation

**§36.** Staged with reasons: trails need a per-slot position-history ring plus a ribbon path (neither the SoA pool nor the render item carries history); custom data channels need a pool-layout extension API; attractors are expressible as negative-strength `radialField`. Additionally verified absent: particles are **flat opaque-edged squares** — no texture, no round mask, no rotation, no `sizeMode` (`gl-particles.ts:213-248`), and node scale does not scale particle size (documented limitation). Multi-stop colour/size ramps are two-stop only (`types.ts:120`). Additive blending is staged (`gl-particles.ts:82-87`).
**Severity:** minor–major depending on the app (textured/soft particles are what most consumers expect).
**Effort:** M. **Depends on:** R-19 (uv on the instance stream), R-12 (per-material blend state for additive).
**Recorded:** yes — the best-staged area in the domain (`emitter.ts:26-46`, `fields.ts:44-56`, `particle-renderable.ts:127,159`, `TODO.md` Phase 9 backlog).

### R-33 — §112's exit criterion is proven for simulation only, never for simulation _and_ rendering

**§112.** §112 requires 100,000 particles **"simulated and rendered"** at interactive rates. `benchmarks/results/particles-100k.json` records CPU simulation at 16.39 ms/step mean (98.4% of the 16.67 ms budget, p95 over budget) on a GPU-less CI container — and its own `hostCaveat` says _"CPU simulation only: no GL context, no upload, no draw."_ The rendered demo (`examples/particles-demo/main.ts`) runs a 2,600-particle fountain plus a burst. **The two halves have never been measured together at 100k.**
**Severity:** minor (honestly recorded, not a defect) but worth a named line: the §112 exit is half-proven.
**Effort:** S — a browser benchmark page at 100k against the existing instanced path would close it.
**Recorded:** yes — `benchmarks/README.md`, `AUDIT-120.md` "What this audit does not cover", the result file's own caveat.

### R-34 — §27 field sampling costs ~5.1 ms per field per 100k particles

**§27, §112.** Attribution in the same result file: integrator alone 1.31 ms, +1 field 8.03, +2 fields 11.61, +3 fields 16.24 — i.e. each polymorphic `sample()` costs ~5.15 ms/100k. Three fields consume the entire fixed-step budget.
**Severity:** minor. **Effort:** M (a batch `sampleAll(positions, velocities, out, count)` entry point on `ParticleForceField`).
**Recorded:** yes — `TODO.md` "Phase 9 backlog: §27 field batching".

### R-35 — §113/§120 debug drawing cannot be rendered: `GL.LINES` carries no per-vertex colour

> **CLOSED 2026-08-07** — `debugDrawStreams(buffer, out?)` / `applyDebugDrawStreams`
> in `@fourjs/diagnostics` de-interleave the 7-float layout into exactly-sized
> `positions`/`colors` arrays that spread straight into `BufferGeometryOptions` (no new
> §3.1 edge — the duck-typed-contract pattern's third instance), over R-19's `colors`
> attribute and `vertexColors` material flag; the whole overlay is one draw call at any
> segment count, proven in `tests/integration/debug-overlay-render.test.ts` and the
> render-webgl lines test. `DEBUG_DRAW_STAGED` loses `"per-segment-colored-draw"`;
> `joint-anchors` and `applied-force-vectors` remain genuinely seam-blocked. Unblocks
> the §118/§119 force/torque overlays. Kept for the record.

**§120 "debug drawing", §84.** The data path ships (seven providers in `packages/diagnostics/src/debug-draw.ts`). Drawing them needs a per-segment vertex-colour attribute, which `BufferGeometry` does not have (R-19) and `UnlitProgram` does not consume. So the overlay has never been shown as pixels.
**Severity:** minor for a shipping app, **major** for §118/§119 (both list force/torque vector overlays as required features).
**Effort:** S once R-19 lands a `color` attribute.
**Recorded:** yes — `AUDIT-120.md` S-3 (dated 2026-08-02), `TODO.md` Phase 10 backlog, `MEMORY.md:203`.

---

## Cameras, viewports, layers (§44, §46–§48)

### R-36 — §44 camera motion: no rigs or controls of any kind

**§44, §47.** Grepping `orbit`/`fly`/`trackball`/`springArm`/`shake`/`follow` across `packages/*/src` finds only unrelated prose. None of §44's nine (orbit, fly, first-person, trackball, follow rigs, spring arms, shake, path animation, physics attachment) exists.
**Severity:** major ergonomics — every 3D consumer's first line of code after `new PerspectiveCamera()` is orbit controls, and there are none.
**Effort:** M (§44 says rigs should use the same timeline/constraint/motion systems, which all ship — this is composition, not new machinery).
**Recorded:** yes — `docs/Architecture/API.md:342` ("Camera rigs (§44) belong to this package per the spec but have not shipped — place cameras manually or drive them with tweens/trajectories"), plus `docs/guides/cameras-and-coordinate-conversion.md`.

### R-37 — §47 camera types and `layers`; §48 viewport fields

**§47, §48.** Ships `PerspectiveCamera` + `OrthographicCamera`. Missing: `ScreenCamera` (with §47's top-left/bottom-left/centered origins and logical/physical pixel units — note `@fourjs/ui` therefore places widgets in _world_ space under an `OrthographicCamera`, `examples/ui-demo/main.ts:129`), `ObliqueCamera`, custom projection camera, and `layers: LayerMask` (explicit `TODO(§46/§47)` at `packages/scene/src/camera.ts:105`). `Viewport` is missing `clearDepth`, `layerMask`, `renderTarget`, `postProcessing` (`viewport.ts:35-42`).
**Severity:** minor–major (`ScreenCamera`'s absence is what makes §66's "screen-space UI renders after world content" unimplementable).
**Effort:** S–M. **Depends on:** R-38 for `layers`/`layerMask`, R-4 for `renderTarget`, R-5 for `postProcessing`. **Recorded:** yes.

### R-38 — §46 named layers: `renderLayer` is a bare number

**§46.** `Renderable.renderLayer` and `ParticleRenderable.renderLayer` are plain numbers used as sort key 1. §46 requires human-readable names compiling to masks, shared across camera visibility, render order, physics interaction groups, picking, post-processing inclusion, editor-only objects, and debug visualization — and preserved in serialized scene files (§79).
**Severity:** major (it is the shared prerequisite for R-8's per-view filtering, R-37's `layerMask`, and §71 picking filters).
**Effort:** M. **Recorded:** yes — `AUDIT-120.md` S-1 (dated 2026-08-02), `renderable.ts:~115`, `camera.ts:93-105`.

---

## Performance targets and flagship demonstrations

### R-39 — §86: 5 of 10 rows are architecturally unreachable, not merely unmeasured ⚠️

**§86, §92.** Status of each row in my domain:

| §86 row                          | state                                                                |
| -------------------------------- | -------------------------------------------------------------------- |
| Batched sprites 100,000 @ 60 FPS | **unreachable** — no sprite batching (R-9); one draw call per sprite |
| Simple batched shapes 50,000     | **unreachable** — no shape system at all (R-23), no batching         |
| Simple mesh instances 100,000    | **unreachable** — no hardware instancing outside particles (R-22)    |
| Animated glyphs 20,000           | **unreachable** — one texture + one draw per glyph (R-28)            |
| CPU particles 25,000             | measured at 4× (100k @ 16.4 ms/step, CI host) ✓                      |
| GPU particles 100,000+           | **unreachable** — no WebGPU (R-1, R-31)                              |
| Idle scene: near-zero uploads    | plausible (version-keyed caches) but **unmeasured**                  |
| Payload ≤150 kB gzip             | ✓ 33.28 kB, gated by `pnpm size`                                     |
| Retained UI nodes 5,000          | unmeasured (UI domain)                                               |
| Active rigid bodies 5,000        | measured (physics domain)                                            |

**Severity:** major. **Effort:** covered by R-9/R-22/R-23/R-28.
**Recorded:** partially — `benchmarks/README.md` says the GPU-bound rows "need a GPU" and would measure "the wrong thing" headless. ⚠️ **Silent:** that four of them are blocked by a _missing engine feature_, not by the absence of a GPU. A reader of `benchmarks/README.md` would reasonably conclude the numbers are merely unmeasured.
**Closure:** add a one-line "blocked by" column to `benchmarks/README.md`'s §86 table so the distinction between _unmeasured_ and _unimplementable_ is visible.

### R-40 — §118 "One Scene, Everything Moves" flagship demo does not exist

**§118.** `examples/flagship/one-scene-everything-moves/` contains a single `.gitkeep` and has contained nothing else since the directory scaffold (`git log --all -- examples/flagship` → one commit, `506a6a7`). None of §118's ten required elements is demonstrated together: rotating 3D cube, 2D vector orbit, spring pendulum, bouncing rigid body, world-space label, screen-space control panel, timeline, motorized hinge, collision events, pause/slow-motion/single-step.
**Severity:** major for the project (§118 carries the spec's own success criterion: _"It must feel like one motion-capable engine, not a graphics library with physics bolted on"_ — the criterion `ARCHITECTURE.md:526` cites as the architecture's justification), minor for a consumer app. Six real examples exist (`blending`, `first-2d-scene`, `mechanism`, `particles-demo`, `physics-playground`, `ui-demo`) and each demonstrates one phase; nothing demonstrates the thesis.
**Effort:** M — every ingredient ships; it is composition plus a screen-space panel workaround (R-37).
**Recorded:** **yes in one place, contradicted in another.** `docs/Architecture/TEST_COVERAGE.md:189-193` states plainly that `examples/flagship/*` and four `first-*`/`mixed-scene` dirs "hold only `.gitkeep` … The six real examples are all served under the browser gate." ⚠️ But `docs/AUDIT-120.md:125` claims _"10 example applications under `examples/` … incl. the five §93 guide scenes and the flagship"_, and `CHANGELOG.md:644` says `examples/` "gained … the two flagship demos (§118–119)". **Both are false.** Reconcile.

### R-41 — §119 Electric Motor Digital Twin does not exist

**§119.** `examples/flagship/motor-digital-twin/` is empty. Of §119's twelve features, the engine cannot currently supply at least five: the 3D motor model (no cylinder/torus primitives, R-20; no textures, R-19), temperature indicators and waveform charts (no 2D shape/path system, R-23/R-24), force and torque vector overlays (debug draw cannot render, R-35), and any screen-space panel (no `ScreenCamera`, R-37). `docs/guides/digital-twin.md` and `engineering-dashboard.md` exist and are the design notes for it.
**Severity:** minor for a consumer, major as evidence for the positioning claim in `docs/POSITIONING.md`.
**Effort:** L. **Depends on:** R-19, R-20, R-23, R-24, R-35, R-37.
**Recorded:** same split as R-40 — recorded in `TEST_COVERAGE.md`, contradicted in `AUDIT-120.md` and `CHANGELOG.md`.

---

## Cross-cutting closure order

The dependency structure is unusually clean; three items unblock most of the rest.

```
R-12 (§57 Material base)  ──┬─→ R-7, R-10, R-11, R-13, R-16, R-27, R-29, R-32
                            └─→ R-14 (§60 shaders) ──┬─→ R-1 (backends)
                                                     ├─→ R-6 (§70 post-FX)
                                                     └─→ R-13 (§59 PBR)
R-19 (§53 attributes/uv)  ──┬─→ R-9 (batching), R-13, R-20, R-22, R-30, R-32, R-35
R-4  (§61 render targets) ──┴─→ R-5 (§63 graph) ──→ R-6, R-18 (§69 shadows)

R-15 (§60a colour) should land BEFORE R-13/R-17, or both are rebuilt.
R-26 (§52 tessellation) gates R-16, R-23, R-24 — and SDF text.
```

**Recommended first three packets, by unblocked-surface per unit of effort:**

1. **R-12 + R-11 + R-10** (Material base + render state + full §66 sort) — M, unblocks eight items and fixes two live correctness defects (invisible alpha; interleaved transparency).
2. **R-19 + R-20** (standard attributes with uvs + the nine missing 3D primitives) — M, turns "you cannot draw a sphere or texture anything" into "you can", and unblocks batching, PBR, glTF, and the debug overlay.
3. **R-4** (render targets + readPixels) — M, unblocks the graph, post-processing, shadows, minimaps/portals, and the §92 visual tier.

## Documentation defects found while verifying (all cheap, all misleading)

| #   | Location                                    | Claim                                                             | Reality                                                                                               |
| --- | ------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| D-1 | `docs/AUDIT-120.md:125`                     | "10 example applications under `examples/`… incl. … the flagship" | 6 exist; `examples/flagship/*` and 4 others hold only `.gitkeep`. Contradicts `TEST_COVERAGE.md:189`. |
| D-2 | `docs/AUDIT-120.md` Rendering table         | sprites "§55; **batched**"                                        | Not batched — one VAO bind + one draw per sprite (`webgl-renderer.ts:766-800`).                       |
| D-3 | `docs/guides/materials-and-render-graph.md` | "Items sort by render layer, then kind…, then material"           | `compareRenderItems` compares `renderLayer` then `renderOrder` only (`render-list.ts:547`).           |
| D-4 | `docs/guides/custom-shaders.md`             | "three fixed, internal programs"                                  | Four since `LitProgram` (2026-08-04).                                                                 |
| D-5 | `CHANGELOG.md:644`                          | "`examples/` gained … the two flagship demos (§118–119)"          | It gained two empty directories.                                                                      |
| D-6 | `benchmarks/README.md` §86 table            | remaining rows "are GPU-bound … need a GPU"                       | Four are blocked by missing engine features (R-39), not by hardware.                                  |

## Assessment of the staging discipline

Worth recording because it materially changes how the backlog should be read. The staging convention in this domain is **excellent** where it was applied: dated notes at the would-be home in source, exported `DEBUG_DRAW_STAGED`/`UI_STAGED` constants so absence is discoverable at runtime, deliberate type-level rejection of unsupported options (`simulation: "gpu"` is an excess-property error, not a silent no-op), and `docs/guides/custom-shaders.md` opening with a section titled "Honest state". `AUDIT-120.md` S-1…S-7 are model staging records.

The failure mode is structural, not cultural: **the discipline is indexed on §120's MVP bullet list.** Sections §120 never names got no note — §54 (mesh/instancing/LOD), §58 (paints), §60 (shaders), §63 (render graph), §67 (clipping), §70 (post-processing) — and §53's missing nine 3D primitives fell through the same crack because §120 says only "basic 3D meshes". Those seven are the silent gaps that matter. A one-page `STAGED.md` indexed on **§ number** rather than on §120 rows would have caught every one of them.

---

# Physics / Motion / Animation / Scene-Core — Gap Analysis

**Scope:** `packages/{physics, physics-rapier, physics-box2d, physics-soft, motion, animation, scene, core, math}` against `docs/SPECIFICATION.md` rev 1.6 §6–§42, §98–§102, §104–§111. Read-only pass on `claude/tools-integration-rji2sr` @ `cff56e7`. Every claim below was verified against source; file:line references are exact.

> **Editorial note (applied at assembly).** This fragment's findings were originally numbered `S-1…S-22`. Because `docs/AUDIT-120.md` already owns an `S-1…S-7` staged-item namespace (layers, §24 shapes, debug-draw wiring, §50/§51 primitives, lighting), the series has been renumbered one-for-one to the `PH-*` prefix throughout — `S-n` to `PH-n`, `S-22x` to `PH-22x` — including every cross-reference below. Any bare `S-*` elsewhere in this document refers to `AUDIT-120.md`'s staged items, not to these findings.

**Legend — provenance:** _recorded_ = an existing dated staging note / MEMORY / TODO / CHANGELOG entry states the absence; _silent_ = nothing in the repo says it is missing.

---

## PH-1 — Post-registration property changes never reach the solver (and the doc claims they do)

> **CLOSED 2026-08-07 (stage 2; stage 1 truth table 2026-08-06).**
> `SolverBodyTuningAccess` (`packages/physics/src/body-access.ts`) carries §37's property
> changes; `PhysicsWorld.step` drains `RigidBody.pendingSolverWrites` and
> `refreshCollider`'s per-collider flag at the top of the step, ascending body id then
> ascending collider id. Both Rapier adapters implement the seam;
> `PhysicsWorld.supportsLiveProperties` declares it. `mass`, both dampings,
> `gravityScale`, `ccdMode`, and a collider's §25 material / §24 filter are live;
> `mass = undefined` stays warn-only, documented as permanently unreachable.
> `PhysicsWorld.teleport` closes the "teleports have no stable-API route" half. Goldens
> unmoved — a quiet world's solver-call sequence is unchanged. Kept for the record.

|                       |                                                                                                                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spec**              | §37 (`syncSceneToSolver` "pushes scene-authored state into the solver (kinematic targets, **teleports, property changes**)"), §23, §24                                                                                                          |
| **Severity / Effort** | **blocker** (spec-conformance) / **L**                                                                                                                                                                                                          |
| **Provenance**        | **partly recorded** (MEMORY 2026-08-02, Phase 8: _"a velocity written after `world.addBody` reaches no solver (author it on the descriptor)"_ — velocities only); the wider property set is **silent**, and the source doc asserts the opposite |

**What exists.** `PhysicsWorld.step` (`packages/physics/src/world.ts:1283`) runs `#applyCommands` → `#feedKinematic` → `adapter.syncSceneToSolver()` → `step`. `#applyCommands` (`world.ts:1947`) drains only §26 forces/impulses and the §32 sleep command. `#feedKinematic` (`world.ts:2019`) pushes a _kinematic-position_ body's pose and a _kinematic-velocity_ body's authored velocities. `#refreshMassProperties` (`world.ts:1930`) runs once, at `addBody`.

**What's missing.** For a **dynamic** body, nothing pushes `RigidBody.linearVelocity`, `angularVelocity`, `mass`, `centerOfMass`, `inertiaTensor`, `linearDamping`, `angularDamping`, `gravityScale`, or `continuousCollisionDetection`/`ccdMode` after registration; nothing pushes any `Collider` change (`friction`, `restitution`, `density`, `sensor`, `collisionGroups`, `collisionMask`). `SolverBodyAccess` (`packages/physics/src/body-access.ts`) has **no** `setBodyMass`, `setBodyDamping`, `setGravityScale`, `setCcdMode`, or any collider mutator, so the seam cannot express these even if the world wanted to. `setBodyTransform` exists on the seam (`body-access.ts:124`, implemented at `rapier2d-adapter.ts:1797` / `rapier3d-adapter.ts:1850`) but is **never called from `PhysicsWorld`** — §37's "teleports" have no stable-API route.

The load-bearing defect is that `packages/physics/src/rigid-body.ts:26-32` states: _"`linearVelocity`, `angularVelocity`, `centerOfMass` and friends are what the engine pushes into the solver at `syncSceneToSolver` … Writing one between steps is therefore an authoring action that takes effect at the next sync."_ That is false for every dynamic body. A user follows the doc, sees no effect, and gets no warning.

**Closure plan.** Two-stage: (1) **truth now** — correct the `rigid-body.ts` module header and add a dirty-flag warning (or `FourError`) on the mutators for a registered body, mirroring the §42 `warnAuthorityConflict` deduplication pattern in `packages/scene/src/authority.ts`; (2) **capability** — widen `SolverBodyAccess` with `setBodyMassProperties` / `setBodyDamping` / `setBodyGravityScale` / `setColliderMaterial` / `setColliderFilter`, implement in both Rapier adapters (Rapier exposes `setMass`, `setLinearDamping`, `setGravityScale`, `Collider.setFriction/setRestitution/setCollisionGroups`), and drain a per-component dirty set in `#applyCommands`. Add a `PhysicsWorld.teleport(node, position, rotation?)` over `setBodyTransform`.
**Depends on:** PH-2 (a handle route makes the escape hatch usable immediately, before the full seam widening lands).

---

## PH-2 — No public route from a node/`RigidBody` to its solver handle

|                       |                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Spec**              | §37 (adapter seam), §20 ("users should not need to write solver-specific application code for common tasks" — but must not be _unable_ to) |
| **Severity / Effort** | **major** (API ergonomics) / **S**                                                                                                         |
| **Provenance**        | **silent**                                                                                                                                 |

**What exists.** `PhysicsWorld.adapter` is public (`world.ts:687`). `BodyRegistration.handle` (`world.ts:416`) lives on a non-exported interface inside a private `Map` (`#bodiesByNode`, `world.ts:532`). `PhysicsWorld.getBody(node)` returns the _component_. `RigidBody` and `Collider` expose no solver id (verified: no `get id` / `solverId` / `bodyId` member).

**What's missing.** There is no supported way to obtain the `PhysicsBodyHandle` for a registered body, so every `SolverBodyAccess` method — including the ones that would work around PH-1 today (`setBodyTransform`, `setBodyVelocities`) — is unreachable from application code. `SolverBodyAccess.forEachBody(visit(handle, id))` yields handles but nothing correlates an id back to a node.

**Closure plan.** Add `PhysicsWorld.getBodyHandle(node): PhysicsBodyHandle | undefined` and `getColliderHandle(collider)`, documented as the escape hatch below the stable API (same framing the TODO already uses for `SolverBodyAccess` in the §90/§102 compatibility material). Files: `packages/physics/src/world.ts`, barrel `packages/physics/src/index.ts`.

---

## PH-3 — First-collider mass loss + `colliderCount` leak on direct-adapter collider destruction

|                       |                                                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spec**              | §23 (mass authoritative), §25, §37 (`destroyCollider`)                                                                                                                     |
| **Severity / Effort** | **major** / **S**                                                                                                                                                          |
| **Provenance**        | **recorded** — CHANGELOG 2026-08-05, _"PLAUSIBLE findings recorded for follow-up: … first-collider mass loss on direct-adapter collider destruction"_. **Confirmed here.** |

**What exists.** `resolveMassMode` (`rapier2d-adapter.ts:2786`, mirrored 3D) picks `"first-collider"` when a descriptor names `mass` but no `centerOfMass`/`inertiaTensor`. `applyColliderMass` (`rapier2d-adapter.ts:2808`) then puts the body's whole explicit mass on the **first** collider (`setMass(body.explicitMass)`) and gives every later collider `setDensity(0)`. `createCollider` increments `bodyRecord.colliderCount` and calls `recomputeMassPropertiesFromColliders()` (`rapier2d-adapter.ts:1058-1060`).

**What's missing.** `destroyCollider` (`rapier2d-adapter.ts:1079` / `rapier3d-adapter.ts:1174`) calls `world.removeCollider` then `#forgetCollider` (`rapier2d-adapter.ts:2333` / `rapier3d-adapter.ts:2410`), which **never decrements `colliderCount`** and **never recomputes mass properties**. Two consequences:

1. Destroying the _first_ collider of a `"first-collider"` body silently removes the body's entire mass — a dynamic body becomes massless, which §23 explicitly forbids as an expressible state.
2. Because `colliderCount` never falls back to `0`, a replacement collider created afterwards takes the `else` branch and gets `setDensity(0)`, so the mass can never be restored.
3. Even in `"collider-density"` mode, `getBodyMass` stays stale after a destroy (`createCollider` recomputes, `destroyCollider` does not).

Unreachable through `PhysicsWorld` today (its only `destroyCollider` call is inside full body teardown, `world.ts:2532`), which is why it is "direct adapter" — but PH-4's closure would expose it.

**Closure plan.** In both adapters: decrement `bodyRecord.colliderCount` in `#forgetCollider` (needs the body record — `record.bodyId` is already on `ColliderRecord`), and call `recomputeMassPropertiesFromColliders()` on the surviving parent after `world.removeCollider`. Refuse (or re-apply the explicit mass to the new first collider) when a `"first-collider"` body's mass-bearing collider is destroyed. Regression tests in `packages/physics-rapier/tests/`.
**Depends on:** nothing. **Blocks:** PH-4.

---

## PH-4 — Mass authoredness laundering across re-registration

|                       |                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Spec**              | §23 ("when `mass` is omitted it defaults to collider density times volume; an explicit `mass` overrides density") |
| **Severity / Effort** | **minor** / **S**                                                                                                 |
| **Provenance**        | **silent**                                                                                                        |

`#refreshMassProperties` (`world.ts:1930`) writes the solver's _derived_ mass onto `registration.body.mass`. `RigidBody.toDescriptor()` (`rigid-body.ts:1040-1053`) then emits that value as an explicit `descriptor.mass`. So a body that was `removeBody`'d and `addBody`'d again — or serialized and reloaded — silently flips from `"collider-density"` to `"first-collider"` mass mode, and thereafter ignores collider density. The `centerOfMass` path deliberately avoids exactly this via a `#centerOfMassAuthored` sticky flag (`rigid-body.ts:541`, `centerOfMassAuthored:683`); mass has no equivalent.

**Closure plan.** Add a `#massAuthored` flag set only by the constructor and the public setter; have `#refreshMassProperties` write a separate `derivedMass` read-only mirror rather than the authored field, and have `toDescriptor` emit `mass` only when authored. Files: `packages/physics/src/rigid-body.ts`, `packages/physics/src/world.ts`.

---

## PH-5 — No runtime collider add/remove on a registered body

> **CLOSED 2026-08-07.** `PhysicsWorld.addCollider` / `removeCollider`, resolving the
> body through `Collider.requireBody()` (one source of truth with `addBody`'s scan).
> `registration.colliders` stays ascending-by-id; `#collidersById`/`#collidersByComponent`
> give event, query, and handle visibility; a pending `refreshCollider` is dropped with
> its collider. Mass proven across add **and** remove on authored- and derived-mass
> bodies, against the double and real Rapier in both dimensions. §34 needed nothing —
> the envelope's collider table already re-derives `BodyRecord.colliderIds`. Goldens
> unchanged. Kept for the record.

|                       |                                    |
| --------------------- | ---------------------------------- |
| **Spec**              | §24, §83 (resource lifecycle), §37 |
| **Severity / Effort** | **major** / **M**                  |
| **Provenance**        | **silent**                         |

`addBody` (`world.ts:837`) scans the subtree once via `#collectColliders` (`world.ts:1746`) and creates every collider then. There is no `world.addCollider` / `removeCollider`; adding a `Collider` component (or a child node carrying one) after registration does nothing, with no warning. The only route is `removeBody` + `addBody`, which mints a new solver body id — breaking §33's checksum ordering, §34 snapshot compatibility, and any joint referencing the body.

**Closure plan.** `PhysicsWorld.addCollider(collider)` / `removeCollider(collider)` maintaining `#collidersById` and `registration.colliders`, followed by a mass refresh. Land **after** PH-3, whose defect this API would otherwise expose to ordinary users.

---

## PH-6 — §34 replay documents carry no world configuration

> **CLOSED 2026-08-06.** `ReplaySnapshot.configuration` (structural `unknown`) and
> `ReplayRecording.worldConfiguration`; captured in `ReplayRecorder.begin`, round-tripped
> through `validateReplayRecording`, re-attached in `ReplayPlayer.#snapshotAt`.
> `REPLAY_FORMAT_VERSION` is 2 with `SUPPORTED_REPLAY_FORMAT_VERSIONS = [1, 2]`; a document
> declares the lowest version that can express it, so every version-1 recording still
> validates _and re-encodes byte for byte_. `golden/phase10.json` was amended envelope-only
> (`recordingDigest`, `recordingLength`) with the neutralized-capture proof recorded in the
> file — see `CHANGELOG.md`.

|                       |                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spec**              | §34 ("A replay format should store: initial scene state; **solver settings**; time step; random seed; …")                                                                                                                                                                                                                                                        |
| **Severity / Effort** | **major** / **M**                                                                                                                                                                                                                                                                                                                                                |
| **Provenance**        | **recorded, twice, and now stale.** MEMORY 2026-08-02 (Phase 10): _"Known boundary: §34 world-CONFIGURATION mismatch is not refused (name/version only — pre-existing Phase 5 scope)."_ MEMORY/CHANGELOG 2026-08-04 closed **half** of it for snapshots: _"absent configuration (pre-existing envelopes, **§34 replay documents**) restores exactly as before."_ |

**What exists.** `PhysicsSnapshot` gained an optional `configuration: PhysicsSnapshotConfiguration` (dimension, resolved gravity, resolved sleeping, determinism, `solverIterations`) — `world.ts:337, 352-360` — and `restoreSnapshot` refuses field-by-field via `#refuseConfigurationMismatch` (`world.ts:1604, 1654-1694`). `replay-format.ts:17-45` honestly records that _"'Solver settings' has no dedicated field"_.

**What's missing.** The replay path cannot reach that refusal:

- `ReplaySnapshot` (`packages/diagnostics/src/recorder.ts:73-90`) is a hand-mirrored copy of `PhysicsSnapshot` with **three** fields — it never gained `configuration`, so the duck-typed mirror has drifted from its original.
- `ReplayRecorder.begin` (`recorder.ts:265-267`) reads only `adapterName` / `adapterVersion` / `data` off the snapshot; the configuration is discarded at record time.
- `ReplayPlayer.#snapshotAt` (`packages/diagnostics/src/replay-player.ts:768-775`) reconstructs `{adapterName, adapterVersion, data}`, so `#refuseConfigurationMismatch` no-ops for every replay.

Net effect: replaying a recording captured at gravity −9.81 into a world built with gravity 0 (or different `solverIterations`, sleeping config, or determinism tier) runs silently and diverges. The only signal is `finalChecksum`, checked at the _end_ of the run.

**Closure plan.** Add `readonly configuration?: unknown` (structurally, to preserve the no-`@fourjs/physics`-edge rule) to `ReplaySnapshot` and a `worldConfiguration?` field to `ReplayRecording`; capture it in `ReplayRecorder.begin`, round-trip it through `validateReplayRecording`'s canonical rebuild (`replay-format.ts:490+` — note the byte-identity property that determinism goldens rely on), and re-attach it in `#snapshotAt`. Bump `REPLAY_FORMAT_VERSION` (currently `1`, `replay-format.ts:87`) and the §34 "where each item lives" table. Files: `packages/diagnostics/src/{recorder,replay-format,replay-player}.ts`; refresh `tests/determinism/golden/phase10.json` only if the canonical encoding changes.
**Depends on:** nothing. Also fixes the mirror-drift the `recorder.ts:30-36` note warns about.

---

## PH-7 — 3D adapter has no joint-registry mismatch detection on a corrupt §34 envelope

|                       |                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spec**              | §34 (snapshot validity), §37                                                                                                                             |
| **Severity / Effort** | **major** / **S**                                                                                                                                        |
| **Provenance**        | **recorded** — CHANGELOG 2026-08-05, _"3D joint-registry mismatch not detected on corrupt §34 envelopes"_. **Confirmed here, with a second sub-defect.** |

The 2D and 3D `#rebuildRegistries` diverge in two ways:

|                                                                 | 2D (`rapier2d-adapter.ts:2679-2707`)                                                                            | 3D (`rapier3d-adapter.ts:2756-2772`)           |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| null-joint check                                                | throws `FourError` — _"Snapshot names a `${type}` joint that the restored Rapier world does not contain (§34)"_ | **absent**                                     |
| re-assigns `type` / `bodyIdA` / `bodyIdB` on an existing record | yes (`record.type`, `record.axisSign`, `record.bodyIdA`, `record.bodyIdB`)                                      | **no** — only `rapierHandle`, `joint`, `alive` |

Bodies and colliders re-assign every field in **both** adapters; joints are the sole exception, and only in 3D. Worse, the 3D transcription types `getImpulseJoint(handle: number): RapierImpulseJoint3d` as non-nullable (`rapier3d-adapter.ts:422`) — and the module's own note at `rapier3d-adapter.ts:410-413` records the measured behaviour: _"an unknown handle returns a live-looking object with `handle === 0` rather than `null`"_. So a corrupt envelope in 3D yields a bogus joint object plus a stale type/body pairing, both silently.

**Closure plan.** Port the 2D shape to 3D: re-assign `type`/`bodyIdA`/`bodyIdB` on the existing record, and add an explicit validity check (`joint == null || joint.handle !== rapierHandle`) throwing the same §34-worded `FourError`. Add a corrupt-envelope regression test to `packages/physics-rapier/tests/rapier3d-adapter.test.ts` mirroring the existing 2D one.

---

## PH-8 — §26/§27 force fields never apply to rigid bodies

|                       |                                                                                                                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spec**              | §26 (force generators: gravity, drag, springs, buoyancy, wind, magnetic, attractors, repulsors, custom fields), §27 (`ForceField.sample`), §101 (_"@fourjs/physics responsibilities: … **force fields**"_), §39 step 5 |
| **Severity / Effort** | **major** / **M**                                                                                                                                                                                                      |
| **Provenance**        | **silent for physics.** Part IX schedules "force fields" only once, in §112 Phase 9 (particles) — verified by grepping §103–§113a.                                                                                     |

`ForceField` exists solely as `ParticleForceField` in `packages/particles/src/fields.ts` (7 of §27's 9 built-ins, plus `volumeField` for §27's volume inclusion). Nothing in `@fourjs/physics` samples a field: `PhysicsWorld.step` (`world.ts:1283`) has no force-generation pass, and `@fourjs/motion`'s `PRIORITY_FORCES` (§39 step 5) has **no** engine-supplied occupant for rigid bodies — only `@fourjs/particles` registers there (`particles/src/particle-system.ts:57,122`). §101's "force fields" line is unshipped; `@fourjs/physics` exports no `ForceField` type at all (verified against `packages/physics/src/index.ts`).

**Closure plan.** Hoist the §27 `ForceField` interface into `@fourjs/physics` (or `@fourjs/core`, with `particles` re-exporting — the same shape the 2026-08-04 `SeededRandom`/`DEFAULT_GRAVITY_Y` hoists used), then add a `ForceFieldSystem` at `PRIORITY_FORCES` that samples registered fields per body centre-of-mass and calls `RigidBody.applyForce`. Note the recorded cost profile before designing: TODO's Phase 9 entry measures each polymorphic `sample()` at ~5.3 ms/100k, with field batching named as the scoped fix.

---

## PH-9 — §18 state machines, blend trees, layered and additive animation: never scheduled

> **PARTIALLY CLOSED 2026-08-07** — the §18 state-machine tier ships
> (`packages/animation/src/controller.ts`): states over clips, typed transitions with
> duration/exit time (seconds, §7a)/interruption, parameters + latched triggers — seven
> of §18's nine features, blending per channel through `ValueAdapter` under one claim
> in the §16 registry, with unit coverage at 100% and its own 600-step determinism
> golden (`golden/animation-controller.json`, transcendental-free). Blend trees and
> layered/additive animation remain open, staged in the module header with dated
> notes; the §18/§97a/§100 spec claims are now stale and recorded as a spec-revisit
> item in TODO.

|                       |                                                                                                                                                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spec**              | §14, §18 (`Four.AnimationController` with states/transitions/parameters/triggers/exit time/interruption/blend trees/layers), §100 (_"@fourjs/animation responsibilities: … state machines; blend trees"_)                                                                    |
| **Severity / Effort** | **major** / **L**                                                                                                                                                                                                                                                            |
| **Provenance**        | **recorded as a Phase-4 deferral, but never rescheduled** — `packages/animation/src/track.ts:41-42` and `mixer.ts:212-219` (_"Cross-fading, layering, and additive blending are §18/§19 material and are staged out of Phase 4 (plan P4-3)"_). No later phase picks them up. |

`@fourjs/animation` ships `Tween`, `Timeline`, `AnimationClip`, `AnimationTrack`, `AnimationMixer`, `AnimationSystem`, easing, bindings, value adapters. There is no `AnimationController`, no state/transition model, no blend tree, no layer stack — verified: the only repo-wide hits for `AnimationController`/`StateMachine`/`BlendTree` are the doc comments above. `AnimationMixer` plays **one clip at a time** (`mixer.ts:395-401`); two clips on one target means two mixers resolving through the last-started-wins conflict registry with a warning, which is not blending.

This is the same **structural** class of gap that `docs/AUDIT-120.md` documents for lighting (_"the one never-scheduled item"_): §107 Phase 4's component list and §110 Phase 7's both omit it, so no packet ever owned it.

**Closure plan.** New phase-scale work packet. Design surface: `AnimationController` over the existing `AnimationMixer` (parameters map, typed transition predicates rather than §18's `"speed > 0.1"` string DSL — the string form needs an expression parser and a §33 determinism argument), plus a weighted layer stack that must integrate with the shared claim registry in `packages/animation/src/tween.ts` (`claimProperty`/`releaseProperty`, deliberately not in the barrel). Record it as a spec-scheduling amendment first (letter-suffix rule), mirroring the §106a/§113a precedent from spec rev 1.5.

---

## PH-10 — Skeletal animation, skinning, and morph targets absent everywhere

> **RFC DRAFTED 2026-08-07** — `docs/rfcs/0003-skinning-and-skeletal-animation.md`
> covers both halves (PH-10 + R-22's skinning rows): joints/weights as `BufferGeometry`
> attributes at locations 4/5, `Bone`/`Skeleton` as scene-graph nodes (§42 authority and
> §19 blending need no new mechanism), skinned draws as a separate lazily-compiled
> pipeline. Findings: §54's `morphTargetWeights` placement is unimplementable under the
> frozen §3.1 matrix; §17's two missing track types are binding gaps, not `ValueKind`
> gaps. Status draft, **owner decision pending** — bone-axis convention is the named
> question.

|                       |                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spec**              | §14 (skeletal animation, morph-target animation), §17 (track types: morph weight, skeletal joint), §100 (_"skeletons"_)                                                                           |
| **Severity / Effort** | **major** / **L**                                                                                                                                                                                 |
| **Provenance**        | **recorded as a Phase-4 deferral** (`packages/animation/src/track.ts:40-45`, `values.ts:55`) — _"They arrive with the phase that introduces skinning"_ — but **no such phase exists in Part IX.** |

Repo-wide grep for `Skeleton|skinning|skinIndex|morphTarget` finds only those two doc comments plus an unrelated `ui/widget.ts` hit. There is no bone/joint model in `@fourjs/scene`, no skin attribute in `@fourjs/geometry`, no skinning path in `@fourjs/render-webgl`, and `ValueKind` has no `morphWeight`/`skeletalJoint` member. §17's track-type list is therefore 7 of 9.

**Closure plan.** Cross-package: `Skeleton`/`Bone` in `@fourjs/scene`, joint-index/weight attributes on `BufferGeometry`, a skinning program in `render-webgl`, and the two `ValueKind` additions in `@fourjs/animation`. Needs an RFC (`docs/rfcs/`) for the bone-axis convention — note `packages/motion/src/ik.ts` already ships two-bone IK _in positions, not angles_, precisely because no bone-axis convention is pinned (MEMORY 2026-08-02).
**Depends on:** an RFC decision; blocks the §113a glTF loader (MEMORY records glTF staged pending textures + non-unlit materials — skinning is the third blocker).

---

## PH-11 — §12's remaining kinematic features were deferred to a phase that shipped something else

|                       |                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Spec**              | §12 (steering, **look-at constraints, orbit motion, camera rigs, character controllers, motion limits**), §44, §98 (_"Camera rigs and controls (§12, §44, §47) live in `@fourjs/motion`"_), §99                                                                                                                                                                                                              |
| **Severity / Effort** | **major** / **L**                                                                                                                                                                                                                                                                                                                                                                                            |
| **Provenance**        | **recorded but mis-routed.** `packages/motion/src/kinematic-controller.ts:22-24`: _"§12's remaining required features (steering behaviours, look-at constraints, orbit motion, camera rigs, character controllers, motion limits) arrive with the Phase 8 advanced-motion packets (§111)."_ Phase 8 shipped PID, spring-damper, steering, RNG, prediction, and two-bone IK — and **none** of the other five. |

Verified absent: no `lookAt`/`LookAt`, `Orbit`, `CharacterController`, `CameraRig`, `FollowRig`, `springArm`, or `shake` anywhere in `motion`, `scene`, or `animation`. Consequently §44's whole camera-motion list (orbit/fly/first-person/trackball control, follow rigs, spring arms, shake, path animation, physics attachment) has no implementation, and §42's `"constraint"` transform authority has **no producing system** — look-at was its natural first client.

**Closure plan.** A `@fourjs/motion` packet: `LookAtConstraint` and `OrbitController` as components writing under the `"constraint"`/`"kinematic"` authorities via `warnAuthorityConflict`; camera rigs composed from `KinematicController` + `SpringDamper` (both already ship); character controller last (needs a shape-cast sweep loop, which `world.shapeCast` supports — note the recorded Rapier 2D limit of ≤1 hit per shape cast, MEMORY 2026-08-01). Motion limits partially exist as `MotionComponent.maxSpeed`/`maxAngularSpeed` (`motion-component.ts:151-153`) — decide whether §12 wants more.

---

## PH-12 — §8 `SpaceMode` does not exist

|                       |                                                                                                                                                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spec**              | §8 (`"world" \| "screen" \| "viewport" \| "camera" \| "billboard" \| "local-plane"`), §21 (_"Nodes simulating in local-plane space (§8) use the plane's own 2D frame, which the engine maps to the world XY frame of the `"2d"` world"_), §98 (space modes → `scene`) |
| **Severity / Effort** | **major** / **M**                                                                                                                                                                                                                                                     |
| **Provenance**        | **silent** — no `SpaceMode` type, no staging note, and no Part IX phase schedules it (verified by grep over §103–§113a and over all `packages/*/src`).                                                                                                                |

Nothing in `@fourjs/scene` carries a space mode; `Node` has `transform`, `visible`, `enabled`, `opacity`, `tags`, `metadata`, `transformAuthority` and nothing else. Downstream consequences: §21's local-plane→world-XY mapping is unimplemented (a 2D physics body must literally sit at `z = 0` in world space — MEMORY 2026-08-01: _"§21 z-plane rule shapes node structure (2D bodies must sit at z=0; visuals go on child nodes)"_, which is the workaround for the missing space mode); §55's `billboardMode` is separately deferred in `render/src/sprite.ts:72`; screen-space UI has no declared mode.

**Closure plan.** Add `SpaceMode` to `@fourjs/scene` with a `Node.spaceMode` field defaulting to `"world"`, and make `resolveWorldTransform` (`packages/scene/src/world-transforms.ts`) honour `"local-plane"` by composing the plane's frame. Gate physics participation on it per §8's _"Screen-space UI should not automatically participate in physical simulation"_. Consider whether this should be a spec-scheduling amendment (it is a §120-MVP-adjacent item that no phase owns).

---

## PH-13 — §40 `UnitSystem` unshipped

> **CLOSED 2026-08-07** — one closure with A-2 (this was the same item filed from two
> tiers); see A-2's banner. The physics-side step (§41 envelope in SI via
> `PhysicsWorldOptions.units`) is staged as its own `@fourjs/physics` packet.

|                       |                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Spec**              | §40, §98 (unit system → `core`), §101 (_"unit application in simulation"_ → `physics`)                                                                       |
| **Severity / Effort** | **minor** / **M**                                                                                                                                            |
| **Provenance**        | **recorded** — `docs/guides/units-and-numerical-stability.md:22-25`: _"§40 sketches a `UnitSystem` record … Honest state: no `UnitSystem` API has shipped."_ |

Verified: no `UnitSystem`, `lengthToMeters`, or `massToKilograms` anywhere. `@fourjs/core` exports only `DEFAULT_GRAVITY_Y`, `JsonValue`, `SeededRandom`, the component model, `Disposable`, `FourError`, `EventEmitter`. Spec-side this is low-risk (§40 restricts the record to _display and authoring conversion_ — every API signature stays radians/seconds/metres), but §40's _"Engineering applications must be able to declare and display units explicitly"_ is the audience `docs/POSITIONING.md` names first.

**Closure plan.** `packages/core/src/units.ts` — the §40 record plus `formatLength`/`formatAngle`/`parseAngle` conversion helpers; `@fourjs/physics` reads `scale.lengthToMeters` for the §41 envelope check. No hot-path impact.

---

## PH-14 — §25 `rollingFriction` / `spinningFriction` are accepted and ignored with no runtime signal

|                       |                                                                                                                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spec**              | §25                                                                                                                                                                                                                                                                  |
| **Severity / Effort** | **minor** / **S**                                                                                                                                                                                                                                                    |
| **Provenance**        | **recorded in a doc comment only** — `rapier2d-adapter.ts:992-994` / `rapier3d-adapter.ts:1083`: _"§25's `rollingFriction` and `spinningFriction` have no Rapier 2D binding at 0.19.3 and are ignored (their `undefined` default means most callers never notice)."_ |

`PhysicsMaterial` accepts and validates both (`packages/physics/src/material.ts:97-100, 145-148, 170-175`); no adapter, world, or collider path ever reads them (verified: the only non-`material.ts` source hits are the two doc comments). This contradicts the repo's own stated doctrine in two places — `packages/particles/src/fields.ts:49` (_"Nothing here is accepted-and-ignored: an option that silently does nothing is worse than one that does not exist yet"_) and the lighting decision that `castShadow` was _"deliberately NOT accepted-and-ignored"_ (MEMORY 2026-08-04).

**Closure plan.** Emit a one-shot development warning (or `FourError`) from `PhysicsMaterial`'s constructor when either is set and the resolved adapter declares no support; add a `materialFeatures` entry to `PhysicsCapabilities` so the refusal is capability-driven rather than Rapier-specific. Files: `packages/physics/src/{material,adapter}.ts`, both adapters' `CAPABILITIES` blocks.

---

## PH-15 — §32 sleeping thresholds accepted and ignored with no runtime signal

|                       |                                                                                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spec**              | §32, Appendix A (_"Sleeping: enabled; linear 0.01, angular 0.01, time 0.5 s"_)                                                                                                                                                                                    |
| **Severity / Effort** | **minor** / **S**                                                                                                                                                                                                                                                 |
| **Provenance**        | **recorded** — MEMORY 2026-08-01: _"§32 sleep thresholds have NO Rapier binding (only `enabled` maps — honest gap)"_; adapter note at `rapier2d-adapter.ts:757-769` / `rapier3d-adapter.ts:828-840` enumerates the `IntegrationParameters` prototype as evidence. |

`PhysicsWorldOptions.sleeping` is validated (`validation.ts:656-657`), resolved (`descriptors.ts:876`), stored, and used in the §34 configuration refusal (`world.ts:1688`) — so a mismatch in an _ignored_ value can refuse a snapshot restore, while setting the value itself does nothing. Only `enabled` reaches `RigidBodyDesc.setCanSleep`.

**Closure plan.** Same as PH-14: capability-declared refusal or a one-shot warning when a non-default threshold is set against an adapter that cannot honour it. This is also a concrete §102 motivation for the Box2D adapter, alongside the recorded `maxTorque` hard-cap item.

---

## PH-16 — `RigidBody.type` assignment silently desynchronises component from solver

|                       |                                                                                                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spec**              | §22, §42 (_"conflicts must warn rather than silently overwrite"_ — the same principle)                                                                                                                                                                  |
| **Severity / Effort** | **minor** / **S**                                                                                                                                                                                                                                       |
| **Provenance**        | **documented, not enforced** — `rigid-body.ts:580-596` states _"Assigning `body.type` after registration changes the **component** and not the solver — the two would then disagree about what is being simulated"_ and points at `setBodyControlMode`. |

The setter (`rigid-body.ts:601-604`) validates mass and writes `#type` unconditionally; it has no knowledge of registration, so nothing warns. `PhysicsWorld.setBodyControlMode` (`world.ts:1051`) is the correct call and does re-type in place. A user who follows the §22 type union naturally writes `body.type = "dynamic"` and gets a component that lies about the simulation — which then also poisons `toDescriptor()`.

**Closure plan.** Give `RigidBody` a world-registration back-reference (or a `#registered` flag set by `PhysicsWorld.addBody`/cleared by `removeBody`) and warn-once from the setter, naming `setBodyControlMode`. Cheap; same pattern as PH-1 stage 1.

---

## PH-17 — No shipped `ComponentSerializer`s for `RigidBody`, `Collider`, or `MotionComponent`

> **CLOSED 2026-08-06** — `RIGID_BODY_SERIALIZER`/`COLLIDER_SERIALIZER` ship from
> `@fourjs/physics`, `MOTION_COMPONENT_SERIALIZER` from `@fourjs/motion`, registered via
> `registerPhysicsSerializers()`/`registerSceneNodeTypes()`; the unregistered-component
> silent drop became `unknownComponents: "throw" | "skip"` (A-15). Kept for the record.

|                       |                                                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Spec**              | §6a (_"components serialize under registered type names (§79)"_), §79                                                                                                                                                                |
| **Severity / Effort** | **major** / **M**                                                                                                                                                                                                                    |
| **Provenance**        | **recorded as a boundary** — MEMORY 2026-08-02, Phase 11: _"known boundaries: unregistered components silently unsaved"_; reference serializers live at `tests/integration/helpers/roundtrip-scenarios.ts:19-20`, i.e. in test code. |

`@fourjs/serialization` may depend on `scene` only (`serializer.ts:15`: _"it can never name `RigidBody`, an animation component, or an …"_), so the registry is empty by construction. Every fourJS scene containing physics or motion components therefore round-trips through §79 **losing them silently** unless the application hand-writes and registers serializers copied out of a test helper.

**Closure plan.** Ship the serializers from the package that owns each component — `@fourjs/physics` exports `RIGID_BODY_SERIALIZER` / `COLLIDER_SERIALIZER`, `@fourjs/motion` exports `MOTION_COMPONENT_SERIALIZER` — each typed against a structural `ComponentSerializer` shape so no new dependency edge is needed (the same duck-typing pattern as `ParticleDrawable` and `collectSceneLights`). Separately, make an _unregistered_ component a warning rather than a silent drop in `@fourjs/serialization`.
**Note:** the §79↔§34 boundary itself is already proven and documented (MEMORY WP-11.5: contact-free saves round-trip bit-identically; in-contact saves diverge through warm-start state) — that part is not a gap.

---

## PH-18 — Part X public-API examples do not match the shipped surface

|                       |                                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spec**              | §11, §15, §16, §18, §20, §28, §111, §114–§117                                                                                                                                                                     |
| **Severity / Effort** | **minor** (docs/ergonomics, but user-facing) / **S** (spec amendment) or **M** (aliases)                                                                                                                          |
| **Provenance**        | **partly recorded** — TODO: _"§111 sketch namespace: spec writes `Four.PIDController`; real path is `Four.motion.PIDController` (pre-existing umbrella convention — spec-revisit note)"_. The rest is **silent**. |

The umbrella (`packages/fourjs/src/index.ts`) exports one namespace per package plus `Application`. So every Part X snippet is wrong at the identifier level, not just the namespace:

| Spec writes                                                       | Reality                                                                                                   |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `Four.animate(...)` (§15, §114)                                   | `Four.animation.animate(...)`                                                                             |
| `new Four.Timeline()` (§16)                                       | `new Four.animation.Timeline()`                                                                           |
| `new Four.Motion({...})` (§11)                                    | `new Four.motion.MotionComponent({...})` — class renamed                                                  |
| `new Four.PhysicsWorld({... solver: "auto"})` (§20)               | `new Four.physics.PhysicsWorld({... adapter})` — see PH-19                                                |
| `new Four.SphereCollider({radius, restitution, friction})` (§115) | `new Four.physics.Collider({shape: {type: "sphere", radius}, ...})` — no per-shape collider classes exist |
| `new Four.AnimationController({...})` (§18)                       | absent entirely — PH-9                                                                                    |
| `robot.physicsWeight = 0.2` (§117)                                | `RigidBody.physicsWeight` (`rigid-body.ts:788`), not the node                                             |
| `robot.animation.play("walk")` (§117)                             | no `Node.animation` member                                                                                |
| `Four.PIDController` (§111)                                       | `Four.motion.PIDController`                                                                               |

`Four.Application`, `Four.Vector3`-via-`Four.math`, the tween builder chain (`.to(props, seconds).ease(name).play()` — `tween.ts:489,533,672`), `Timeline.at()` (`timeline.ts:360`), and `HingeJoint`'s options shape (§116) **do** match. Node's `position`/`rotation`/`scale` alias getters landed 2026-08-04, closing the previously recorded §15 snippet defect.

**Closure plan.** Owner decision between (a) a spec amendment rewriting §114–§117 (and the §11/§15/§16/§18/§20/§111 inline snippets) against the real namespaced surface, or (b) adding curated flat re-exports on the umbrella for the handful of names the examples use. (a) is cheaper and matches the existing "spec-revisit note" precedent; (b) risks the tree-shaking requirement §91 imposes on the umbrella.

---

## PH-19 — `solver: "auto"` selection and capability-driven solver choice unimplemented

> **CLOSED 2026-08-07** — `packages/physics/src/solver-registry.ts` +
> `registerRapierSolver()`; `PhysicsWorldInit.solver` takes `"auto"` or a §102 name
> (`adapter` becomes the optional alternative, xor enforced loudly). `"auto"` filters
> on §37 `capabilities` (dimension, determinism tier) in registration order — §37
> fixes no preference and one was not invented. A named solver is handed back
> unfiltered so the world reports mismatches with its own §21/§33 message. **Left
> open:** only Rapier is registrable (§102's box2d/soft are still stubs).

|                       |                                                                                                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spec**              | §20, §37 (_"Capability declarations drive `solver: "auto"` selection (§20)"_)                                                                                                                                           |
| **Severity / Effort** | **minor** / **M**                                                                                                                                                                                                       |
| **Provenance**        | **recorded** — `world.ts:239-241`: _"plan P5-5: an instance, not a `solver: "auto"` string — that selection joins the §45 registry backlog"_; TODO: _"§45 renderer-string ('auto') selection via §62 registry packet"_. |

`PhysicsWorldInit.adapter` (`world.ts:237-247`) takes an adapter instance; `PhysicsWorldOptions` (`descriptors.ts:674-716`) has no `solver` field. The world _does_ validate the requested `dimension` and `determinism` against `adapter.capabilities`, so the capability machinery is live — only the selection front-end is missing. Same architectural deferral as the renderer, for the same payload reason, and it should land in the same registry packet.

---

## PH-20 — §33 rollback has no affordance

|                       |                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Spec**              | §33 (_"The engine should support: seeded RNG; recorded inputs; state snapshots; replay; **rollback**; checksums"_) |
| **Severity / Effort** | **minor** / **M**                                                                                                  |
| **Provenance**        | **silent** — the only repo hit for "rollback" is the §33 quotation in `recorder.ts:6`.                             |

Five of six ship: `SeededRandom` (`@fourjs/core`), `ReplayRecording.inputs`, `PhysicsWorld.createSnapshot/restoreSnapshot`, `ReplayPlayer`, `PhysicsWorld.checksum()`. Rollback — rewind _N_ steps, re-apply corrected inputs, re-simulate — has the primitives (`ReplayPlayer.seek` already does snapshot-seek-then-resimulate, `replay-player.ts:650-668`) but no API and no test. Note §34 lists "network rollback" as a snapshot use case, and §42's `"network"` authority is explicitly an _enabler only_ (transport is out of scope, §5), so the bar here is a local rollback utility, not replication.

**Closure plan.** `RollbackBuffer` in `@fourjs/diagnostics` over `ReplayTarget`: ring of snapshots + input log, `rollbackTo(step)` = restore nearest ≤ step then re-run. Largely a refactor of `ReplayPlayer.seek`.

---

## PH-21 — §39 steps 6–9 are not independently orderable

|                       |                                                          |
| --------------------- | -------------------------------------------------------- |
| **Spec**              | §39 (_"The ordering must be explicit and configurable"_) |
| **Severity / Effort** | **minor** / **M**                                        |
| **Provenance**        | **silent**                                               |

`@fourjs/motion` exports all eleven §39 priority constants (`systems.ts`, barrel lines 96–110), and `SystemRegistry` orders by numeric priority — so the _mechanism_ is configurable. But `PhysicsSystem` (`packages/physics/src/physics-system.ts:105`) registers once at `PRIORITY_PHYSICS_SOLVE` (600) and internally performs step 6 (solve), step 7 (constraint solve, inside the adapter), step 8 (sensor update, inside the adapter) and step 9 (event dispatch, its second pass). `PRIORITY_CONSTRAINTS`, `PRIORITY_SENSOR_UPDATE`, and `PRIORITY_EVENT_DISPATCH` have **no** engine occupant; `PRIORITY_FORCES` has one only in `@fourjs/particles` (see PH-8). An application cannot interpose work between the solve and the event dispatch, nor between constraints and sensors.

**Closure plan.** Split `PhysicsSystem` into `PhysicsStepSystem` (600) and `PhysicsEventDispatchSystem` (`PRIORITY_EVENT_DISPATCH`, 900), preserving the current two-pass semantics as the default registration; steps 7–8 stay inside the adapter (correctly — they are one solver call) but should be _documented_ as unsplittable in the §90/§102 capability material rather than implied by the unused constants.

---

## PH-22 — Small recorded absences (roll-up)

Each is already staged with a dated note; listed for completeness, not re-litigation. Severity **minor** unless noted.

| ID     | Item                                                                                                                                                                                                                                                                       | Spec          | Where recorded                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| PH-22a | 8 of §24's collision shapes staged (polyline, chain, cylinder, cone, convex hull, triangle mesh, height field, compound) — **major**                                                                                                                                       | §24           | `packages/physics/src/shapes.ts:4-22`; TODO Phase-5 backlog                                      |
| PH-22b | §28 `distance` and `gear` joints staged with a loud refusal                                                                                                                                                                                                                | §28           | `descriptors.ts:343-350`, `validation.ts:436-450`                                                |
| PH-22c | §28 break force/torque refused on Rapier (no reaction getters at 0.19.3, verified against typings + prototypes + wasm exports)                                                                                                                                             | §28           | `rapier2d-adapter.ts:2027-2048`, `rapier3d-adapter.ts:2093-2116`                                 |
| PH-22d | §28 spherical-joint cone limits refused, with measured numbers (±0.3 rad per-axis lets a diagonal swing reach 1.1247 rad)                                                                                                                                                  | §28           | `rapier3d-adapter.ts:2360-2370`                                                                  |
| PH-22e | §28 motor `maxTorque`/`maxForce` is a force-based **gain**, not a hard cap, on both Rapier adapters                                                                                                                                                                        | §28           | MEMORY 2026-08-02 Phase 6; TODO capability-table item                                            |
| PH-22f | Joint anchors/axis/rope/spring/cone/`collisionEnabled` frozen after `addJoint`; remove-and-re-add is the route                                                                                                                                                             | §28           | `joints.ts:62, 75, 453, 568-589, 714-728`                                                        |
| PH-22g | Rotational root motion staged — a quaternion `trackPath` throws `NOT_IMPLEMENTED`                                                                                                                                                                                          | §110          | `mixer.ts:215-219, 958-960`; TODO Phase-7 backlog                                                |
| PH-22h | `PoseTarget` has no scale channel (P7-1 MVP cut; solver bodies have no scale)                                                                                                                                                                                              | §19           | TODO Phase-7 backlog                                                                             |
| PH-22i | Iterative IK (CCD, FABRIK), spatial-hash steering neighbours, spherical wander, path-planning adapters, robotic joint commands all staged                                                                                                                                  | §111          | `ik.ts:10-20`, `steering.ts:80-91, 586`, `prediction.ts:48-53`                                   |
| PH-22j | `@fourjs/physics-box2d` and `@fourjs/physics-soft` are reserved stubs exporting only `PACKAGE_NAME` — **major** for §102's _"Each solver package implements the shared adapter interface and declares capability differences"_                                             | §35, §102     | both package `README.md`s; ERRATA E-3; MEMORY standing facts                                     |
| PH-22k | `Curve` (§98: _"math: … curves"_) does not exist; §12's `followPath(path: Curve)` takes a §13 `Trajectory` instead                                                                                                                                                         | §12, §98      | `kinematic-controller.ts:24-26` (decision, WP-2.5)                                               |
| PH-22l | No class literally named `Clock` (§104's component list); §9 is modelled as `TimeState` + the application clock                                                                                                                                                            | §104          | `docs/AUDIT-120.md`, Time and Motion table                                                       |
| PH-22m | §14's reduced-motion consultation: no `reducedMotion` policy on `ApplicationOptions` and no animation-side hook                                                                                                                                                            | §14, §45, §75 | `packages/fourjs/src/application.ts:141` (option list deferral), `packages/ui/src/widget.ts:175` |
| PH-22n | §10's dropped-time **diagnostics warning (§84)** and §41's _"diagnostics should warn about suspicious values"_ (mass ratios, world scale, coordinates beyond ~1e5) are unimplemented; the §41 _documentation_ half ships in `docs/guides/units-and-numerical-stability.md` | §10, §41      | silent                                                                                           |

---

## What I checked and found **no** gap in

Recorded so the next pass does not redo the work: §6 `Node` (all members incl. `tags`/`metadata`/`opacity`); §6a component model (one-per-type, replace-with-warning at `core/src/component.ts:144-148`, explicit lifecycle); §6b `EventEmitter` (queue-and-defer during dispatch); §7 `Transform` (pivot composition `T·Tp·R·S·Tp⁻¹`, `matrixAutoUpdate`, `version` change-hooks, lazy world resolution); §7a/§7b conventions and the `out`-parameter allocation policy; §9 all twelve `TimeState` fields; §10 accumulator, clamp, `droppedTime`, pause-as-`timeScale=0`-with-preservation; §11 `MotionComponent` complete incl. `maxSpeed`/`maxAngularSpeed`; §13 all nine trajectories; §15 the full easing table; §16 every listed timeline feature incl. the marker/scrub/replay-on-seek semantics; §17 seven of nine track types plus all five interpolation modes (slerp folded into the quaternion adapter); §19 the blend pipeline with weights on `RigidBody`; §21 `Vector2`-widening and the 2D plane constraint; §22 all four body types in both adapters; §23 the complete `RigidBody` surface incl. all six force/impulse methods and `NaN`-not-zero `inverseMass`; §25 combine modes and the collider-density-beats-material rule; §29 the full `CollisionEvent` payload and post-step dispatch; §30 all five queries with groups/masks/ignores/first/all/sorted/sensors/predicates; §31 all three CCD modes plus `ccdPredictionDistance`; §33 checksum definition, insertion-order iteration, tier validation against adapter capabilities; §37 every method of the adapter interface plus `PhysicsCapabilities`; §38 all five integrators; §42 authority enum with refuse-and-warn-once enforcement; §43 interpolation with no write-back path.

---

# Closure-wave plan

Derived from the three analysts' own dependency graphs and recommended orders — the rendering closure graph in §R, the application "recommended order of attack", and the `Depends on:` / `Blocks:` lines carried by the `PH-*` findings. Waves are sequencing, not staffing: items inside a wave are independent of one another and can run in parallel.

## Wave 1 — Truth and quick wins

_No decisions required, no dependencies, all `S` effort. Do this first because every later wave is planned against documentation that is currently wrong in thirteen places._

- **Documentation corrections.** All twelve doc-only rows of the drift table, as dated in-place supersessions (`A-28`, `D-1…D-6`). Add an `S-8` row to `AUDIT-120.md` for the examples shortfall. Add the "blocked by" column to `benchmarks/README.md`'s §86 table so _unmeasured_ and _unimplementable_ stop looking alike (`D-6`, `R-39`).
- **`PH-1` stage 1 — truth now.** Correct the `rigid-body.ts` module header and add a dirty-flag warning (or `FourError`) on the mutators for a registered body, mirroring the §42 `warnAuthorityConflict` dedup pattern in `packages/scene/src/authority.ts`. The capability half is wave 4; the lie must not survive wave 1.
- **Correctness defects.** `A-9` (pointer-state leak), `A-15` (silent component drop on save), `A-17` (id collision on restore), `A-14` (UI widgets lost on serialize), `A-7` (`Application.resize`), `PH-3` (first-collider mass loss + `colliderCount` leak), `PH-16` (`RigidBody.type` desync), `PH-7` (joint-registry mismatch detection).
- **Silent-ignore signals.** `PH-14` and `PH-15` — capability-declared refusal or a one-shot warning where §25 friction terms and §32 sleep thresholds are accepted and dropped.
- **`PH-2`** — a public node → solver-handle route, which makes the `PH-1` escape hatch usable before the seam widening lands.
- **Process.** Land `STAGED.md` (§-indexed, §1–§120 exhaustive) and `tools/check-docs.mjs`, wired into CI beside `pnpm check-spec`. This is what stops wave 1 from being needed again.

**Exit criterion:** no shipped document asserts something the tree contradicts, and CI fails if one starts to.

## Wave 2 — Keystones

_The unblocking work. Ordered by unblocked-surface per unit of effort; `R-15` is a hard ordering constraint inside the wave._

1. **`R-12` + `R-11` + `R-10`** — §57 `Material` base, render state, full §66 sort. Unblocks eight rendering items and fixes two live correctness defects (invisible alpha; interleaved transparency).
2. **`R-19` + `R-20`** — standard vertex attributes with uvs, plus the nine missing 3D primitives. Turns "you cannot draw a sphere or texture anything" into "you can", and unblocks batching, PBR, glTF, and the debug overlay.
3. **`R-4`** — render targets, `createTexture`, `readPixels`. Unblocks the §63 graph, post-processing, shadows, minimaps/portals, and the §92 visual tier.
4. **`R-15`** — §60a colour management. **Must land before `R-13` and `R-17`**, or the PBR and lighting work is built on a non-linear pipeline and rebuilt afterwards. Schedule it alongside items 1–3, not after them.
5. **`A-1`** — §84 runtime statistics. Gates §119, `A-5`, and `A-27`.
6. **`A-10`** — `KeyboardInput`, the sole blocker on `A-13`'s accessibility requirement.

**Exit criterion:** the three render keystones are closed and their dependents are schedulable; `app.stats.*` exists and the §86 harness has something to read.

## Wave 3 — Decision-gated (after owner sign-off)

_Nothing here starts before a written decision. Each gate is cheap to decide and expensive to guess wrong._

- **`A-22` / `PH-18` — spec amendment.** Part X's public-API examples (§97, §114–§117) do not compile against the shipped surface. The owner decides: amend the specification to the shipped names, or add aliases to the shipped surface. This gate blocks **`A-21`**, the project's largest single gap — four §93 worked scenes and both §118/§119 flagships. Decide it early in wave 2 so wave 3 can start on schedule.
- **`A-3` — §81 plugin RFC.** The plugin system is silent and §79 already references it; the extension surface must be designed before it is built.
- **`PH-10` — skinning RFC.** Skeletal animation, skinning, and morph targets are absent everywhere and span `animation`, `scene`, `geometry`, and `render`. Overlaps `R-22` (§54) — one RFC should cover both.
- **`R-14` — §60 shader / node-material RFC.** No user shaders exist at any level. The API shape is a design decision; `R-14` in turn gates `R-1` (further backends), `R-6` (post-processing), and `R-13` (PBR).

Once `A-22`/`PH-18` is decided, **`A-21`** becomes the headline deliverable of this wave: the §93 scenes and, with wave 2's keystones in hand, §118 "One Scene, Everything Moves" (`R-40`). §119's motor digital twin (`R-41`) trails it, depending additionally on `R-23`, `R-24`, `R-35`, and `R-37`.

## Wave 4 — Long tail

_Real, correctly recorded, and schedulable in any order once their dependencies clear._

- **Rendering, dependency-ordered:** `R-13`, `R-17`, `R-18` (after `R-12`/`R-15`/`R-4`); `R-9`, `R-22`, `R-30`, `R-32`, `R-35` (after `R-19`/`R-20`); `R-5`, `R-6` (after `R-4`); `R-7`, `R-16`, `R-27`, `R-29` (after `R-12`); `R-25` → `R-16`, `R-23`, `R-24` and SDF text; then `R-1`, `R-3`, `R-8`, `R-21`, `R-26`, `R-28`, `R-31`, `R-33`, `R-34`, `R-36`, `R-37`, `R-38`, `R-39`, `R-2`.
- **Simulation:** `PH-1` stage 2 (widen `SolverBodyAccess`, drain a dirty set), then `PH-4` and `PH-5` (both gated on `PH-3`, which closes in wave 1), `PH-6`, `PH-8`, `PH-9`, `PH-11`, `PH-12`, `PH-13`, `PH-17`, `PH-19`, `PH-20`, `PH-21`, and the fourteen roll-up items under `PH-22`. `PH-22j` (the `physics-box2d` / `physics-soft` reserved stubs) is a §102 conformance item and needs its own decision about scope.
- **Application, parallelisable immediately:** `A-23` (§96 security), `A-25` (§94 release machinery, `website/`), `A-26` (§90 compatibility tables) are self-contained. Then `A-5`, `A-27` (after `A-1`), `A-13` (after `A-10`), `A-2`/`PH-13` (§40 `UnitSystem`, one item filed in two tiers), `A-4`, `A-6`, `A-8`/`R-2`/`PH-19` (the three `"auto"` selection affordances — close them together), `A-11`, `A-12`, `A-16`, `A-18`, `A-19`, `A-20`, `A-24`.

**Note on duplicate and parallel filings.** Two findings were reached by two analysts each and should be closed once, not twice: §40 `UnitSystem` (`A-2` / `PH-13`) and Part X example compilation (`A-22` / `PH-18`). `renderer: "auto"` is filed from both sides (`A-8` / `R-2`) and is one item; `solver: "auto"` (`PH-19`) is the same unimplemented affordance in a different subsystem, so the three are best designed together even though they are two pieces of work. §54 skinning (`R-22`) and skeletal animation (`PH-10`) are two halves of one RFC.

---

_End of Gap Analysis v0._
