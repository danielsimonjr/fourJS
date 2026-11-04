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

| Role | Model | Task |
| --- | --- | --- |
| Helper | Haiku | Inventory: package sizes, dependency edges, code markers, stubs, console use |
| Worker | Sonnet | Hot-path scan of every per-frame / per-step loop for allocation and redundant work |
| Reviewer | Opus | Correctness and completion: API symmetry, leaks, determinism, event semantics, hygiene |
| Planner / fixer | Fable | Verified every finding against the source, rejected or deferred the unsound ones, cut the rest into disjoint work packets, and fixed the core defects directly |

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

<!-- VERDICT -->

## Findings

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

<!-- IMPLEMENTED -->

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

<!-- VERIFICATION -->
