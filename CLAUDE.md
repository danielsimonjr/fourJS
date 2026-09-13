# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository State

fourJS is a unified JS/TS framework combining 2D/2.5D/3D graphics, animation, motion, and
physics in one shared scene model. **The implementation plan (§103–§113a) is complete**
(2026-08-02; this section was stale "scaffold only" text until 2026-08-05): all 24
`packages/*` packages build, test, and lint — ~3,000 unit tests with a tooling-enforced
≥95% per-package coverage gate, cross-package suites in `tests/{integration,determinism}/`,
Playwright browser gates in `tests/browser/`, pixel-golden visual tests in `tests/visual/`,
and performance records in `benchmarks/`. Four packages are deliberate reserved stubs
(`physics-box2d`, `physics-soft`, `render-canvas`, `render-svg`); `render-webgpu`
left the stub list 2026-08-21…29 (the R-1 plan, WP-R1.1–R1.9 — a full second GPU
backend).

Toolchain (§91, RFC 0006): strict TypeScript, ESM with `.js` import suffixes, Bun
workspace, Vitest, Playwright, ESLint, Prettier, Vite, TypeDoc, Changesets. Common
commands: `bun run build`, `bun run test`, `bun run test:suites`,
`bun run test:browser`, `bun run lint`, `bun run coverage`, `bun run docs` (always with `run`),
`bun run graph` + `graph:check`/`graph:duplicates`, `bun run check-spec`, `bun run size`.
Architecture orientation lives in `docs/Architecture/` (OVERVIEW, ARCHITECTURE, COMPONENTS,
DATAFLOW, API, TEST_COVERAGE + the generated dependency-graph reports).

## Tracking files (root)

Read `MEMORY.md` (decisions, standing facts, gotchas) and `TODO.md` (task tracker — open
rows only; closed rows are archived in `docs/archive/TODO-DONE.md`) at the start of a
session. Before finishing: record new decisions in `MEMORY.md` (append-only: supersede,
never rewrite), update `TODO.md` (move a row you close to the archive in the same commit),
and add substantive changes to `CHANGELOG.md`.

## The Specification

- `docs/SPECIFICATION.md` is the **working reference** — the current revision is whatever
  tops the amendments table in the file itself; do not trust hardcoded numbers elsewhere (see the
  amendments table at its top): parts I–XIII, sections 1–120, no duplicate numbering.
  Revision 1.1 applied all 35 items from `docs/SPEC-REVIEW.md`; new material lives in
  lettered sections (**6a** Component Model, **6b** Eventing, **7a** Coordinate/Unit
  Conventions, **7b** Math Conventions, **60a** Color Management) and Appendices **A**
  (Normative Defaults) / **B** (Glossary). **§ numbering 1–120 is frozen** — new sections get
  letter suffixes; amendments are recorded in the spec's amendments table (owner decision).
- `docs/archive/four-js-specification.pdf` is the unmodified original (65 pages), **frozen at
  the pre-1.0 text**. It still contains the old defects (duplicate `Part VII`, section
  numbers 45–67 assigned twice) and predates all revisions — when reading the PDF,
  translate references via the numbering map in `docs/ERRATA.md` (PDF second-range §45–67 =
  Markdown §98–120). Do not edit the PDF.
- Run `bun tools/check-spec.mjs` (or `bun run check-spec`) after editing the spec — it verifies section sequence,
  fence balance, TOC anchors, and the absence of banned pre-revision terms.
- ERRATA E-3 (resolved): the scaffold deliberately contains only `physics-rapier`,
  `physics-box2d`, and `physics-soft`, matching §102 (Solver Packages). Do **not** add
  `physics-matter` or `physics-cannon` without a decision to amend the specification.

## Architecture (from the specification)

Four coequal pillars — **Scene, Render, Motion, Physics** — over one shared scene graph in
which 2D shapes, 3D meshes, text, UI, rigid bodies, joints, and particle emitters all
participate. Key cross-cutting designs to understand before implementing anything:

- **Conventions (§7a/§7b):** right-handed **Y-up world in both 2D and 3D** (2D gravity is
  negative Y), radians everywhere, **all times in seconds** (tween/timeline durations
  included — no milliseconds anywhere), mutable math types with `out`-parameter hot paths.
- **Components and events (§6a/§6b):** `RigidBody`, colliders, and `MotionComponent` are
  _components_ attached via `node.addComponent(...)` (one per type); one typed
  `EventEmitter` API serves nodes and the application; physics events dispatch after each
  fixed step.
- **Fixed-step simulation loop (§10):** physics steps on a fixed-delta accumulator clamped
  at `maximumSubSteps` (excess time is dropped and surfaced via `TimeState.droppedTime`);
  rendering runs at its own rate and interpolates between the previous and current physics
  state using `interpolationAlpha`. Separate `fixedUpdate` / `update` / `render` events.
- **Time domains (§9):** `TimeState` distinguishes real, render, simulation, scaled, and
  unscaled time (animation time is clip-local); each system picks its time source.
- **Transform authority (§42):** exactly one system (`manual`, `animation`, `kinematic`,
  `physics`, `blended`, `constraint`, `network`) owns a node's transform; conflicts must
  warn rather than silently overwrite. `"blended"` selects the §19 physics-animation
  pipeline. Render interpolation never feeds back into physics state.
- **Motion vs. animation vs. physics:** animation specifies how something _should_ move,
  kinematics moves objects directly, dynamics derives motion from forces — the engine
  supports all of these with controlled blending (§19: animation pose → kinematic
  modification → physics solve → interpolated render pose).
- **Pluggable physics solvers (§37):** the stable `@fourjs/physics` API sits above a
  `PhysicsSolverAdapter` interface; solver packages (`physics-rapier`, `physics-box2d`)
  implement it and declare capability differences.
- **Determinism (§33–34):** tiered (`none` → `cross-platform`); initial target is
  same-runtime determinism. Seeded RNG, snapshots, replay, and checksum tests are
  first-class requirements.
- **Rendering backends (§62):** one renderer interface over WebGPU, WebGL 2, Canvas 2D,
  SVG, and headless tiers.

## Package layout

`packages/` follows the monorepo tree in Part VIII, §98 (Proposed Monorepo). All
packages are `@fourjs/`-scoped; `packages/fourjs` is the umbrella package. Rough layering:

- Foundation: `core`, `math`
- Scene/time: `scene`, `motion`, `animation`
- Physics: `physics` (stable API), `physics-rapier` / `physics-box2d` (solver adapters),
  `physics-soft`, `particles`
- Rendering: `geometry`, `materials`, `render` (interface), `render-webgpu`, `render-webgl`,
  `render-canvas`, `render-svg`
- Application: `input`, `assets`, `text`, `ui`, `serialization`, `diagnostics`

Implementation is planned in phases (Part IX, §103–113a): foundation → math/scene/time →
motion → renderer → **interaction/sprites/text (§106a)** → animation → physics adapter →
joints → physics-animation blending → advanced motion → particles/GPU →
replay/diagnostics → **assets/serialization/UI/tooling (§113a)**. The MVP scope is defined
in Part XII, §120: WebGL 2 only, one solver adapter, basic 2D/3D primitives. The
executable plan is `docs/plans/IMPLEMENTATION_PLAN.md` (work packets; stress-tested);
`docs/POSITIONING.md` states why the project exists; `docs/rfcs/` hosts the RFC process.
