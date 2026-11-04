# Optimization and completion audit (2026-11-04)

**Audited 2026-11-04** against `main` at `b55fd9a` (branch
`audit/optimization-and-completion-2026-11`). Baseline before any change: frozen install,
`bun run build`, every per-package unit suite, and `bun run lint` all passed.

This document records what a four-model audit team found across all 24 `packages/*`
packages, which findings were verified, rejected, or deferred, and what was implemented in
the same pull request. It is an audit in the sense of `docs/AUDIT-120.md`: it points at the
file and line that proves each claim and says plainly where a finding did not survive
verification.

## Method

| Role            | Model  | Task                                                                                                                                                           |
| --------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Helper          | Haiku  | Inventory: package sizes, dependency edges, code markers, stubs, console use                                                                                   |
| Worker          | Sonnet | Hot-path scan of every per-frame / per-step loop for allocation and redundant work                                                                             |
| Reviewer        | Opus   | Correctness and completion: API symmetry, leaks, determinism, event semantics, hygiene                                                                         |
| Planner / fixer | Fable  | Verified every finding against the source, rejected or deferred the unsound ones, cut the rest into disjoint work packets, and fixed the core defects directly |

Each HIGH or CONFIRMED finding was re-read in full by the planner before it entered a
packet. The four reserved stubs (`physics-box2d`, `physics-soft`, `render-canvas`,
`render-svg`) are owner decisions and were out of scope.

## Inventory

24 packages, about 165k lines of non-test source. All packages declare
`"sideEffects": false`, a `"."` export, MIT license, `files: ["dist"]`, and a README. The
only real code markers are the §46 selector TODO in `packages/scene/src/scene.ts`, the
`Node.position` alias TODO in `packages/scene/src/node.ts`, and the typed deferred §61
members in `packages/render/src/renderer.ts`; every other "not implemented" string is a
dated, tracker-linked refusal. The direct `console.warn` calls in `physics`, `scene`, and
`animation` are deliberate: simulation packages must not import the dev-build gate, and
every one uses `DEV_WARNING_PREFIX`.

## Verdict

| Area                                     | Result                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| Correctness defects found                | 2 (core `EventEmitter`), both fixed with regression tests                    |
| Hot-path allocation findings verified    | 6 HIGH + 1 MEDIUM implemented; 7 deferred with reasons                       |
| API completion gaps verified             | 9 math gaps filled; 2 duplicated helpers removed; 1 determinism defect fixed |
| Findings rejected after reading the code | 9 (listed below)                                                             |
| Reserved stubs                           | unchanged by owner decision                                                  |

## Findings

### Review findings on the implementation (fixed before merge)

The Opus reviewer read the whole branch diff against `main` and confirmed two gaps in the
sleeping-body publish skip, both fixed in the same PR with regression tests in
`packages/physics/tests/world-sleeping-publish.test.ts`:

- a body that fell asleep under `"manual"` or `"animation"` authority and was handed back to
  `"physics"` kept its stale pose, because an authority change goes through no world method.
  `BodyRegistration.publishedAuthority` now forces one publish on any change;
- a hand-edited `linearVelocity` on a sleeping body was no longer refreshed to the solver's
  zero. Velocities are now published every step (two cheap reads, no `Transform.version`).

Everything else in the diff was checked and found correct: the deferred-queue drop, every
`begin`/`end` pairing, the numeric keys, the half-open rectangle and p-vertex frustum
conventions, and bit-identical particle and slerp arithmetic.

### Correctness (fixed in this PR)

- **C-1 `@fourjs/core` — a throwing listener leaked deferred events into the next unrelated
  `emit()`.** `EventEmitter.emit` ran `#dispatch` then `#drain`; when a listener re-emitted
  the same type (deferred by rule 4) and a later listener threw, the drain never ran and the
  queued event surfaced at the start of whatever `emit()` came next, possibly to listeners
  registered since. `emit` now drops the deferred queue when the outermost dispatch aborts;
  a nested throw that an outer listener catches leaves the queue for the outer frame to
  drain. Tests: `packages/core/tests/events.test.ts` ("drops events deferred by a dispatch
  that a listener aborted", "keeps the deferred queue when an outer listener catches a
  nested throw").
- **C-2 `@fourjs/core` — `removeAllListeners()` ignored the deferred queue.** Teardown from
  inside a handler (a node disposed by its own event) left rule-4 events queued for the
  next registrant. Full teardown now clears the queue; per-type teardown filters it in
  place without allocating. Tests in the same file under "removeAllListeners and the
  deferred queue".
- **C-3 `@fourjs/core` — duplicate public method.** `totalListenerCount()` had the same body
  as the documented `listenerCountAll()`. It is now a `@deprecated` alias.

### Optimization (implemented in this PR)

- **H1 `@fourjs/particles` — three to four objects per particle per frame.**
  `ParticleEmitter.evaluateColor` built `start`/`end`/result literals and a ramp wrapper for
  every live particle on every render-list build (`updateParticleInstances`), while its
  documentation promised no allocation. `types.ts` gains
  `evaluateLifetimeRampColorInto(ramp, t, out)` (the allocating form is now a wrapper over
  it) and the emitter keeps persistent ramp scratches. Expression order is unchanged, so
  results are bit-identical. Test: `packages/particles/tests/ramp-into.test.ts`.
- **H2 `@fourjs/physics` — sleeping bodies were re-published every fixed step.**
  `#publishBody` read the pose and velocities of every dynamic body (four Wasm reads and
  four objects per body in Rapier) and wrote them back, which bumped `Transform.version`
  and forced a world-matrix recompute of the node's whole subtree, defeating the
  version-based skip in `world-transforms.ts`. A settled pile paid this on every step. The
  world now reads the sleep flag first and skips the publish of a dynamic, non-blended body
  that was already published asleep, unless `BodyRegistration.publishPending` is set
  (registration, `teleport`, velocity setters, `setBodyControlMode`, `restoreSnapshot`).
  The sleep flag refresh and `#retrackPose` still run every step. Test:
  `packages/physics/tests/world-sleeping-publish.test.ts` (six cases on the fake adapter).
- **H4 nine closure allocations per step/frame.** `runOwnedTransformWrite(fn)` was called
  with a fresh closure per body per step (`world.ts`), per tracked node
  (`motion-component.ts`, `kinematic-controller.ts`, `constraints.ts`,
  `swept-character-controller.ts`), per mixer per frame (`mixer.ts`), per widget per
  layout (`widget.ts`) and per trackball update. `@fourjs/scene` now exports
  `beginOwnedTransformWrite` / `endOwnedTransformWrite`; `runOwnedTransformWrite` is built
  on them and stays for cold paths. Every site is `begin(); try { … } finally { end(); }`.
- **H6 `@fourjs/motion` — `SpatialHash` allocated on every query and keyed cells by
  string.** Its header promised "query allocates nothing", but each call built a `matches`
  array and a comparator closure, and every cell visit built a template-string key. Cells
  are now packed into one integer key (three 17-bit fields; cells 131,072 apart share a
  bucket, which is harmless because every candidate is re-checked by squared distance and
  results are sorted by insertion order, so the result order is unchanged), the match
  buffer is reused, the comparator is hoisted, and `update` early-outs when the entry stays
  in its cell (compared by index, not by wrapped key). Tests appended to
  `packages/motion/tests/spatial-hash.test.ts`.
- **M1 `@fourjs/physics-rapier` — a string key per touching pair per step.** `#pairKey`
  returns `lo * 2^32 + hi` over the ascending monotonic ids (exact below 2^53 while
  `lo < 2^21`, about two million colliders per adapter lifetime). The per-contact `Vector3`
  allocations in `#buildContacts` are a documented hand-over contract and were left.

### Completion (implemented in this PR)

- **Opus 3–11 `@fourjs/math` — API asymmetries.** `Matrix3` had `transpose` and `Matrix4`
  did not; `Vector2/3/4` and `Rectangle2` had `equalsApprox` and the matrices and
  `Quaternion` did not; `Vector3` had `cross` and `Vector2` had no scalar cross; distances,
  negation, component-wise multiply, min/max and `addScaled` were missing from every
  vector; `Rectangle2` could only test containment; `Frustum` could only test spheres. All
  are added in the file style (in place, return `this`, one change-hook call, no
  `noteConstruction`). `Quaternion.slerp` now uses the new `dot`.
- **Opus 4 `@fourjs/input`, `@fourjs/ui` — duplicated matrix helpers.** `transformPoint`
  was copied verbatim in `pick.ts` and `slider.ts`, next to `transformDirection` and
  `unprojectPoint`. They are replaced by `Vector3.applyMatrix4` (affine),
  `transformDirection` (upper 3×3, deliberately not renormalized) and `applyProjection`
  (`w === 0` writes the zero vector, as the deleted helper did). The singular-matrix
  determinant pre-check stays, because `Matrix4.invert` no-ops silently on singular input.
- **Opus 7 `@fourjs/motion` — determinism defect.** `waypoint-graph-planner.ts` measured
  edges with `Math.hypot` while declaring `determinism: "same-runtime"`; the package's own
  rule (`character-controller.ts`) is that `hypot` is implementation-defined and `sqrt` is
  exactly rounded. It now uses `Vector3.distanceTo`. No golden moved.

### Rejected after verification

- Opus 13 (math exports test instrumentation): `constructionCount` is §7b/§83
  instrumentation that the diagnostics package depends on; documented and intentional.
- M2 `#publishEventInterest`: one Map scan with an early break; already cheap.
- M4 double determinant in `pick.ts`: `Matrix4.invert` no-ops silently on a singular
  matrix, so the pre-check is the contract, not waste.
- L1/L2/L3/L4/L5/L7: setup-scale, validation-time, documented hand-over contracts, or a
  deliberate iteration snapshot (`SystemRegistry.runFixedStep`).
- `Quaternion.setFromEuler`: no package hand-rolls Euler conversion, so there is no caller
  to serve.

### Deferred (each needs its own packet)

- **H3** cached `isBodySleeping` in the Rapier adapters: the record flag is refreshed only
  in `#collectEvents` by design and ten tests read it between steps.
- **H5** interpolated render-list ancestor re-walk (`render-list.ts`
  `composeRenderPoseMatrix`, O(nodes × depth)): needs a per-build memo inside a
  golden-tested 1,800-line module.
- **M2** skipping `resetForces` when no force was applied: needs proof that no other path
  adds solver forces.
- **M3** skeleton palette cache: `CpuSkinning.update` re-skins unconditionally and bind
  matrices have no invalidation hook.
- **M4** pick broad-phase sphere test before the per-pickable inverse: a design change.
- **M5/M6** animation tangent precompute and transition bucketing: invalidation protocol.

## Verification

Run locally on 2026-11-04 against the branch head, mirroring `ci.yml` and `doc-gates.yml`:

| Gate                                                                                                 | Result                                                                                               |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `bun install --frozen-lockfile`, `bun run build`                                                     | pass                                                                                                 |
| `bun run test` (per-package unit suites)                                                             | 7,969 tests in 310 files, 0 failures (new tests in core, math, particles, physics, scene and motion) |
| `bun run coverage` (≥95 % package, ≥80 % per file, all 24 packages)                                  | pass                                                                                                 |
| `bun run test:suites` (integration + determinism)                                                    | 685 tests in 98 files, 0 failures                                                                    |
| `bun run lint` (oxlint type-aware), `bun run format:check`                                           | pass                                                                                                 |
| `typecheck:tests`, `typecheck:examples`, `typecheck:benchmarks`, `typecheck:config`, `typecheck:ts6` | pass                                                                                                 |
| `check-spec`, `check-docs`, `check-compat`, `publish-names:test`, `graph:test`                       | pass                                                                                                 |
| `bun run graph`, `graph:check`, `graph:duplicates` (0 new duplicates)                                | pass                                                                                                 |
| `repo-tools check . --docs=docs/Architecture` (`typeOnlyCircularDeps` 10, runtime 0)                 | pass                                                                                                 |
| `bun run examples:build`, `bun run size` (all budgets)                                               | pass                                                                                                 |
| `bun run docs` (TypeDoc)                                                                             | pass after retyping one math test helper for TypeScript 6                                            |
| `bun run test:browser`                                                                               | run in progress at the time of this commit; result recorded in the next commit                       |

No threshold, timeout, golden or bundle budget was relaxed. No benchmark result file was
committed; the particle and physics benchmarks are the suggested follow-up measurements
(`benchmarks/particles-100k.mjs`, and a sleeping-on pile scenario that
`benchmarks/physics-step.mjs` does not yet have).
