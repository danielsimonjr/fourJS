# RFC 0010: PhysJS solver adapter (`@fourjs/physics-physjs`)

- **Status:** proposed (awaiting the owner)
- **Date:** 2026-10-16
- **Owner decision:** pending
- **Spec sections affected:** 20, 21, 24, 28, 30, 31, 33, 34, 37, 90, 98

## Context

PhysJS (`danielsimonjr/PhysJS`, npm `@danielsimonjr/physjs` and
`@danielsimonjr/physjs-core`, 0.5.0 published 2026-10-16) is a data-driven
rigid-body engine built on MathTS. Its merged design plan
(`docs/design/PHYSICS_ENGINE_PLAN.md`, decision 3 and milestone 0.6.0) calls
for fourJS to reach it through a new `@fourjs/physics-physjs` adapter behind
`SolverRegistry`, beside `physics-rapier`.

This crosses package boundaries, so it needs an accepted RFC before any packet
(95; plan 2; `CONTRIBUTING.md` 3-4):

- It **adds a package**. 98 fixes the package list, and CONTRIBUTING 3.4 says
  never add one without an owner decision.
- It **widens a stable API**. `SolverName` in
  `packages/physics/src/solver-registry.ts` is the closed union
  `"rapier" | "box2d" | "soft"`, so registering `"physjs"` changes
  `@fourjs/physics`.
- It **adds an external runtime dependency** (`@danielsimonjr/physjs`, which
  brings `@danielsimonjr/mathts-functions` with it) and a lockfile change. Both
  are the maintainer's to make.
- It **adds a publish-name mapping row**
  (`tools/apply-publish-names.mjs`: `@fourjs/physics-physjs` maps to
  `@danielsimonjr/fourjs-physics-physjs`).

What PhysJS 0.5.0 provides, checked against its tree at `bdddff4`:

| 37 surface   | PhysJS 0.5.0                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------- |
| dimensions   | `createWorld({ dims: 2 \| 3 })`, one engine                                                   |
| bodies       | `addBody`/`removeBody`: dynamic, kinematic, static; generation-tagged handles                 |
| shapes (3-D) | sphere, box, capsule                                                                          |
| shapes (2-D) | circle, rectangle, capsule (`capsule2d`), convex polygon                                      |
| joints       | fixed, spherical (the 2-D pin), spring, hinge (3-D only)                                      |
| step         | `step(world, dt)`: PGS with friction, restitution, warm start, speculative contacts, sleeping |
| events       | `drainEvents`: contactBegin, contactEnd, wake, sleep, in step order                           |
| queries      | `raycast`, `overlap`, `pointQuery`                                                            |
| snapshots    | `snapshot`/`restore` (exact float64 bits) and an FNV-1a `checksum`                            |

Gaps against fourJS's contract:

- **Shapes:** cylinder, cone, convex-hull, triangle-mesh, height-field, polyline
  and chain are missing.
- **Joints:** prismatic and rope are missing. There are no limits or motors.
- **Bodies:** no sensors/triggers and no per-collider offset (colliders are
  centred on the body origin).
- **Queries and CCD:** no `shapeCast`; CCD is speculative only.
- **Tuning:** no rolling or spinning friction.

## Proposed decision

1. **Add the package.** Add `packages/physics-physjs` (`@fourjs/physics-physjs`,
   npm `@danielsimonjr/fourjs-physics-physjs`). It depends on `@fourjs/physics`
   (workspace), `@fourjs/math` and `@danielsimonjr/physjs`, pinned exactly per
   the toolchain rule.
2. **Implement the contract.** It exports `PhysJSAdapter2D` and `PhysJSAdapter3D`,
   both implementing `PhysicsSolverAdapter`, plus `SolverJointAccess` for the
   joints PhysJS builds. It also exports `registerPhysJSSolver(registry?)`, which
   mirrors `registerRapierSolver`.
3. **Widen `SolverName`** to `"rapier" | "box2d" | "soft" | "physjs"`. `"auto"`
   keeps today's preference order, with PhysJS last, so no existing world changes
   solver.
4. **Declare capabilities honestly** from the table above:
   - `dimensions: ["2d", "3d"]`
   - `jointTypes`: `fixed` and `spring` in both dimensions. In 2-D, `revolute`
     is built on PhysJS `spherical` (the 2-D pin). In 3-D, `spherical` is built on
     PhysJS `spherical` and `revolute` on PhysJS `hinge`.
   - `ccdModes: ["disabled", "speculative"]`
   - `determinism: "same-runtime"`
   - `snapshots: true`
   - queries: raycast, overlap and point `true`; shapeCast `false`
   - `tuning`: `sleepThresholds: false` until PhysJS exposes per-world thresholds
     (today they live in `SOLVER_DEFAULTS`), and all the other fields `false`
5. **Refuse what PhysJS lacks.** An unsupported shape, joint or flag throws
   `FourError("NOT_IMPLEMENTED")` at creation. Nothing is approximated silently.
6. **Map descriptors in one place.** The descriptor mapping is a table in the
   adapter, keyed by fourJS shape or joint type, because PhysJS descriptor field
   names already follow fourJS's (PhysJS plan, "API"). Vectors are copied out of
   `Vector2`/`Vector3`/`Quaternion` into the plain arrays PhysJS takes; a 2-D
   rotation is the angle `[theta]`.
7. **Add a conformance test.** It runs fourJS's existing physics scenarios
   (`tests/integration/helpers/physics-scenarios.ts` and the
   `tests/determinism/helpers` scenarios, which today build Rapier adapters)
   against `"physjs"` beside Rapier through `SolverRegistry`. Scenarios
   behind an undeclared capability are skipped by the declaration, not by a
   hand-kept list. Differences are reported in the test output and a
   `docs/benchmarks` note, not hidden, and the adapter block of
   `docs/COMPATIBILITY.md` is regenerated (`node tools/generate-compatibility.mjs`).
8. **Benchmark it.** `benchmarks/physics-step.mjs` gains a `physjs` column.
   Retiring Rapier or Box2D is **not** part of this RFC; that waits for a
   separate decision against these numbers.

## Alternatives

- **Inline PhysJS in `@fourjs/physics`.** This loses: it breaks 20's
  solver-neutral promise and the 3.1 dependency matrix.
- **Replace `physics-box2d` (today a one-line stub) with the PhysJS adapter.**
  This loses: it reuses a name for a different engine and confuses 90's
  tables.
- **Wait for PhysJS to close every gap.** This loses: the capability record
  exists precisely so that a partial solver can ship honestly, and the
  conformance run is what tells PhysJS which gaps matter.

## Consequences

- A third solver, pure TypeScript with no WASM, becomes available for both
  dimensions. Snapshots and checksums are exact.
- fourJS takes an external dependency on a pre-1.0 engine. Pinning it exactly
  means every PhysJS release needs a deliberate bump PR here.
- `SolverName` widens, which is source-compatible for callers. An exhaustive
  `switch` over `SolverName` in user code gains a case.

## Compatibility analysis

- **Public API:** `SolverName` gains `"physjs"`, an additive change. There is
  also a new package. Existing worlds are unchanged, because the `"auto"` order
  keeps PhysJS last.
- **Scene format and snapshots:** none for existing scenes. PhysJS snapshots
  carry adapter name `physjs2d`/`physjs3d` and the PhysJS version, so 34 refuses
  to restore them under another solver.
- **Solver adapters:** a new row in 90's adapter table. The adapter block in
  `docs/COMPATIBILITY.md` is regenerated.
- **Plugin API:** none.
- **Spec:** 98 gains the package. That needs an amendments-table row on
  acceptance (letter-suffixed if it adds a section).

## Prototype / benchmark

PhysJS's own test suite (92 functions tests, 26 core tests at 0.5.0) covers
each mapped surface. The conformance run and benchmark in decisions 7-8 are
this RFC's acceptance evidence. They are produced by the implementation
packet, once the RFC is accepted.
