# Test Coverage Analysis

**Generated**: 2026-08-05, from commands run against this working tree:
`bun run coverage` (and its sequential variant
`bun tools/run-in-packages.mjs --sequential vitest run --coverage --config ../../vitest.coverage.config.ts`,
used to attribute rows to packages unambiguously), `bun run test:suites`, and
`npx playwright test --list`. Every number below comes from one of those runs;
nothing is copied from an earlier report.

## Summary

| Metric                                                        | Count                                                                              |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Packages measured                                             | 24 (all of `packages/*`)                                                           |
| Unit tests (colocated, §92)                                   | **3,081 passed**                                                                   |
| Cross-package suite tests (`tests/{integration,determinism}`) | **174 passed** (15 files)                                                          |
| Browser + visual tests (Playwright)                           | **38** in 10 files (36 `chromium`, 2 `visual`)                                     |
| Coverage threshold                                            | **≥ 95%** statements / branches / functions / lines, per package, tooling-enforced |
| Packages below any threshold                                  | **0**                                                                              |
| Committed determinism goldens                                 | 8 (`tests/determinism/golden/phase*.json`)                                         |
| Benchmark suites (recorded, not gated)                        | 5 (`benchmarks/results/*.json`)                                                    |

---

## The gate structure

Testing follows the §92 taxonomy, split across four runners:

1. **Per-package unit tests, colocated** (`packages/<name>/tests/`, §92) —
   `bun run test` runs each package's own `vitest run` with no instrumentation.
   The coverage gate is a _separate_ command: `bun run coverage` runs every
   package against the shared
   [`vitest.coverage.config.ts`](../../vitest.coverage.config.ts), which sets
   `thresholds: { lines: 95, statements: 95, functions: 95, branches: 95 }`
   and keeps Vitest's `coverage.all` default so **files no test imports stay
   in the denominator** — a package cannot pass by shipping untested modules.
   The config emits the text reporter only (the HTML/JSON reporters would
   land un-eslint-ignored artifacts in `packages/*/coverage/`).
2. **Cross-package suites** (`tests/integration/`, `tests/determinism/`) —
   `bun run test:suites` via `vitest.suites.config.ts`. Integration proves
   the packages compose (scene+physics round trips, joints, blending, replay,
   live Rapier); determinism proves runs reproduce (see
   [the golden mechanism](#the-determinism-golden-mechanism)).
3. **Browser gates** (`tests/browser/`) — `bun run test:browser` runs Playwright
   against Chromium with ANGLE/SwiftShader pinned, one `webServer` per built
   example app (6 servers: first-2d-scene, physics-playground, mechanism,
   blending, particles-demo, ui-demo). These assert _behavior and readback_
   (event traces, color-classified framebuffer samples), deliberately **not**
   pixel goldens — SwiftShader-vs-GPU output differs.
4. **Visual goldens** (`tests/visual/`) — a second Playwright project
   (`visual`) with committed SwiftShader-to-SwiftShader pixel snapshots
   (`tests/visual/ui-demo.spec.ts-snapshots/`). Refresh with
   `npx playwright test --project visual --update-snapshots` and review the
   diff first.

Performance tests live in [`benchmarks/`](../../benchmarks/README.md) and are
**recorded measurements, not gates** — every committed
`benchmarks/results/*.json` opens with a `_note` saying exactly that.
Adjacent non-test CI gates (for completeness): `bun run lint`, `bun run graph:check`
(no `node:` builtin may reach a browser-facing entry), `bun run graph:duplicates`,
`bun run check-spec`, and `bun run size` (§86: `first-2d-scene` ≤ 150 kB gzip,
`particles-demo` ≤ 25 kB, `ui-demo` ≤ 30 kB, per `.size-limit.json`).

---

## Per-package coverage (measured 2026-08-05)

Each row is the `All files` line of that package's v8 coverage report from
the sequential `bun run coverage` variant above; `Tests` is the package's
`Tests N passed` count from the same run. All 24 packages clear the ≥ 95%
gate on all four metrics.

| Package                 | % Stmts | % Branch | % Funcs | % Lines |     Tests |
| ----------------------- | ------: | -------: | ------: | ------: | --------: |
| `@fourjs/core`            |   99.01 |    98.44 |     100 |   99.01 |        91 |
| `@fourjs/math`            |   98.87 |    97.51 |     100 |   98.87 |       154 |
| `@fourjs/scene`           |   99.67 |    99.41 |     100 |   99.67 |       191 |
| `@fourjs/motion`          |   99.77 |    99.24 |     100 |   99.77 |       363 |
| `@fourjs/animation`       |     100 |      100 |     100 |     100 |       367 |
| `@fourjs/physics`         |     100 |      100 |     100 |     100 |       482 |
| `@fourjs/physics-rapier`  |   98.07 |    96.47 |   99.47 |   98.07 |       276 |
| `@fourjs/physics-box2d` † |     100 |      100 |     100 |     100 |         1 |
| `@fourjs/physics-soft` †  |     100 |      100 |     100 |     100 |         1 |
| `@fourjs/particles`       |     100 |      100 |     100 |     100 |       174 |
| `@fourjs/geometry`        |     100 |      100 |     100 |     100 |        36 |
| `@fourjs/materials`       |     100 |      100 |     100 |     100 |        31 |
| `@fourjs/render`          |   99.63 |    99.29 |     100 |   99.63 |       119 |
| `@fourjs/render-webgl`    |   99.47 |    98.99 |     100 |   99.47 |       177 |
| `@fourjs/render-webgpu` † |     100 |      100 |     100 |     100 |         1 |
| `@fourjs/render-canvas` † |     100 |      100 |     100 |     100 |         1 |
| `@fourjs/render-svg` †    |     100 |      100 |     100 |     100 |         1 |
| `@fourjs/input`           |     100 |      100 |     100 |     100 |        80 |
| `@fourjs/assets`          |     100 |      100 |     100 |     100 |        33 |
| `@fourjs/text`            |     100 |      100 |     100 |     100 |        48 |
| `@fourjs/ui`              |     100 |      100 |     100 |     100 |        91 |
| `@fourjs/serialization`   |     100 |      100 |     100 |     100 |        84 |
| `@fourjs/diagnostics`     |     100 |      100 |     100 |     100 |       214 |
| `four` (umbrella)       |     100 |      100 |     100 |     100 |        65 |
| **Total**               |         |          |         |         | **3,081** |

† Reserved placeholder packages — a single test pinning the `PACKAGE_NAME`
export, so their 100% is trivial, not evidence. See
[what is deliberately not covered](#what-is-deliberately-not-covered).

On the sub-100 rows: the gaps are defensive branches and platform-boundary
code, not untested features — e.g. `@fourjs/render`'s remainder sits in two
defensive branches of `lights.ts`, and `@fourjs/physics-rapier`'s in the
verified transcribed typings subset around the wasm boundary (`init.ts`,
recorded in [MEMORY.md](../../MEMORY.md)). Functions coverage is 100% in 23
of 24 packages.

---

## Cross-package suites (174 tests, 15 files)

From `bun run test:suites` — `Test Files 15 passed (15)`,
`Tests 174 passed (174)`, all green in 7.8 s.

**`tests/integration/`** (7 files): `examples-build-coverage`,
`motion-advanced`, `physics-blending`, `physics-joints`, `physics-rapier`,
`physics-replay`, `scene-roundtrip`. These run against **live Rapier** (wasm
decoded in-process), not fakes — the replay rig reads origins, velocities,
centers of mass, and contact impulses per step, and the round-trip suite
carries the reference `RigidBody`/`Collider` serializers
(shipped as `RIGID_BODY_SERIALIZER`/`COLLIDER_SERIALIZER` from `@fourjs/physics` since
2026-08-06; the helper now registers the shipped serializers).

**`tests/determinism/`** (8 files): `phase1-headless-stepping`,
`phase2-motion`, `phase4-animation`, `phase5-physics`, `phase6-joints`,
`phase7-blending`, `phase9-particles`, `phase10-replay` — one per phase that
shipped a determinism-sensitive surface, 1:1 with the committed goldens.

## The determinism-golden mechanism

Each determinism suite has a scenario helper
(`tests/determinism/helpers/phaseN-scenario.ts`) and a committed golden
(`tests/determinism/golden/phaseN.json`) holding the expected checksum
digests. The mechanism is **cross-process**: the same `.ts` scenario file is
imported both by Vitest and by a freshly spawned `node` child process (Node
≥ 22 runs it natively via type stripping), and both must reproduce the
committed digest — proving the stream is a property of the code, not of one
process's state. Checksums are §33 FNV-1a digests over body state quantized
to a 1e-6 grid, visited in monotonic body-id order (sleeping bodies
included); goldens also pin frozen behaviors on purpose (e.g. the
accumulator's ULP boundary-marker timing in `golden/phase4.json`). The Phase
10 golden pins `stepChecksumDigest === replayChecksumDigest` — record →
replay is bit-identical, 240/240 step checksums.

Sensitivity is part of the proof: suites include evidence that a perturbed
input _changes_ the digest, so a passing golden is not vacuous.

## Browser and visual gates (38 tests, 10 files)

From `npx playwright test --list`: `Total: 38 tests in 10 files` — 36 in the
`chromium` project across 9 specs (`animation`, `blending`, `example`,
`interaction`, `mechanism`, `particles`, `playground`, `smoothness`, `ui`),
2 in the `visual` project (`tests/visual/ui-demo.spec.ts`: idle layout, and
after activating a button). The chromium suite caught real defects unit
tests could not (a rAF-seed defect at Phase 3; §72 capture-phase routing);
`smoothness` asserts centroid-tracked §43 interpolation on real frames. The
visual project is the seeded §92 visual-regression category: pixel goldens
are committed for the static UI demo only, because animated pages need a
deterministic stepping hook first (recorded next step in
[MEMORY.md](../../MEMORY.md)).

## Benchmarks (recorded, not gated)

Five suites with committed records under `benchmarks/results/` — `math-ops`,
`scene-propagation`, `animation-sampling`, `physics-step`, `particles-100k` —
each stamped `"Recorded measurement, not a gate"`. Standing findings from the
committed records: contacts + events dominate a physics step (~88%); 100k
particles + 3 fields ran at 16.54 ms/step mean on the (explicitly
"unsuitable") 4-core CI host; a clean scene pass is only ~3× cheaper than
full recompute. Nothing in CI asserts on these timings.

## What is deliberately not covered

- **The five reserved packages** (`physics-box2d`, `physics-soft`,
  `render-webgpu`, `render-canvas`, `render-svg`) contain only a
  `PACKAGE_NAME` export and one pinning test each. Their table rows are
  green by construction; no behavior exists to cover (ERRATA E-3 / §102:
  the solver set is deliberate).
- **Staged features** carry dated staging notes instead of tests:
  multi-light/shadows/PBR (§68/§69/§59), §60a color strings + tone mapping,
  SDF text shaping (§56), glTF loading (§76), §55 sprite frame regions,
  distance/gear joints and spherical-joint limits (§28), the UI a11y DOM
  mirror (`UI_STAGED` — keyboard navigation shipped and tested 2026-08-07),
  several debug-draw overlays
  (`DEBUG_DRAW_STAGED`). The staging constants are exported precisely so the
  absence is discoverable rather than silent.
- **Placeholder example directories** (`examples/first-3d-scene`,
  `first-animated-scene`, `first-physics-scene`, `mixed-scene`,
  `examples/flagship/*`) hold only `.gitkeep` — they are §93/§98 scaffold
  slots, not built or tested. The six real examples are all served under the
  browser gate.
- **Wall-clock performance** is recorded, never asserted (see above) — a CI
  host cannot make a stable 60 fps claim.
- **Cross-platform determinism** (§33's higher tier) is declared, not yet
  claimed or tested; the goldens prove the same-runtime tier only.

## Provenance

All numbers in this document were produced on 2026-08-05 by:

```sh
bun run coverage            # per-package unit tests + v8 coverage, ≥95% gate
bun tools/run-in-packages.mjs --sequential \
  exec vitest run --coverage --config ../../vitest.coverage.config.ts
                             # same gate, serialized, for unambiguous row→package mapping
bun run test:suites         # tests/{integration,determinism}: 174 passed (15 files)
npx playwright test --list   # browser+visual inventory: 38 tests in 10 files
```

Exit code 0 on all of them. The two coverage runs agree row-for-row; the
table above is transcribed from the sequential run's `All files` lines.

---

_Cross-references: [API.md](API.md) · [ARCHITECTURE.md](ARCHITECTURE.md) ·
[OVERVIEW.md](OVERVIEW.md) · [COMPONENTS.md](COMPONENTS.md) ·
[DATAFLOW.md](DATAFLOW.md) · testing strategy §92 in
[SPECIFICATION.md](../SPECIFICATION.md) · suite layout in
[`tests/README.md`](../../tests/README.md)._
