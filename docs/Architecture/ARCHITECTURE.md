# fourJS - System Architecture

**Version**: Unreleased (workspace 0.0.0 — implementation plan Phases 0–11 complete; §120 MVP audit 43/43 shipped-or-MVP; first publish as `@danielsimonjr/fourjs` pending per §94 release 0.1)
**Last Updated**: 2026-08-05

Section references like "§42" mean [`../SPECIFICATION.md`](../SPECIFICATION.md)
numbering. For the newcomer-facing what-and-why, read
[OVERVIEW.md](./OVERVIEW.md) first.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Principles](#architecture-principles)
3. [System Context](#system-context)
4. [Layering and the Frozen Dependency Matrix](#layering-and-the-frozen-dependency-matrix)
5. [The Seams](#the-seams)
6. [The Fixed-Step Loop](#the-fixed-step-loop)
7. [Transform Authority](#transform-authority)
8. [Components and Eventing](#components-and-eventing)
9. [Determinism Architecture](#determinism-architecture)
10. [Key Design Decisions](#key-design-decisions)
11. [Build & Packaging](#build--packaging)
12. [Testing Strategy](#testing-strategy)

---

## System Overview

fourJS is a unified JS/TS framework in which four coequal pillars — **Scene,
Render, Motion, Physics** (§3) — operate over one shared scene graph. 2D
shapes, 3D meshes, text, UI, rigid bodies, joints, and particle emitters all
participate in the same hierarchy, the same clock, and the same
transform-authority model.

### Key Statistics

Numbers below are extracted from the authoritative
`dependency-summary.compact.json` produced by the vendored dependency-graph
tooling (`bun run graph` regenerates everything under `docs/Architecture/`),
last regenerated 2026-08-05.

| Metric                          | Value                              |
| ------------------------------- | ---------------------------------- |
| Packages                        | 24 (`@fourjs/*` + umbrella `four`) |
| Source files                    | 161 TypeScript files               |
| Lines of code                   | 56,760                             |
| Total exports                   | 1,244                              |
| Re-exports (barrel)             | 817                                |
| Classes                         | 91                                 |
| Interfaces                      | 276                                |
| Functions                       | 185                                |
| Type guards                     | 12                                 |
| Type-only imports               | 172                                |
| Runtime circular dependencies   | 0                                  |
| Type-only circular dependencies | 0                                  |

### Package Distribution

| Package                                                        | Files  | Key Exports                                                                                                                                                                                                      |
| -------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core`                                                         | 8      | `EventEmitter`, `ComponentRegistry`, `FourError`, `Disposable`/`disposeAll`, `SeededRandom`, `JsonValue`/`cloneJsonValue`, `DEFAULT_GRAVITY_Y`                                                                   |
| `math`                                                         | 9      | `Vector2/3/4`, `Matrix3/4`, `Quaternion`, `ColorRGBA`, `DepthRange`                                                                                                                                              |
| `scene`                                                        | 12     | `Node`, `Group`, `Scene`, `Transform`, `PerspectiveCamera`/`OrthographicCamera`, `Viewport`, `DirectionalLight`, `TransformAuthority` + `warnAuthorityConflict`, `PoseBuffer`, `PoseTarget`                      |
| `geometry`                                                     | 3      | `BufferGeometry`, `boxGeometry`, `planeGeometry`, `circleGeometry2D`                                                                                                                                             |
| `materials`                                                    | 4      | `UnlitMaterial`, `LitMaterial`, `SpriteMaterial` (all carrying a `kind` discriminant)                                                                                                                            |
| `assets`                                                       | 3      | `AssetManager`, `ImageAsset`, `textLoader`/`jsonLoader`/`binaryLoader`/`createImageLoader`                                                                                                                       |
| `motion`                                                       | 14     | `Scheduler`, `SystemRegistry`, `TimeState`, `MotionComponent`/`MotionSystem`, `KinematicController`, `INTEGRATORS`, eight trajectory classes, `PIDController`, `SpringDamper`, `SteeringAgent`, `solveTwoBoneIK` |
| `input`                                                        | 5      | `PointerInput`, `ScenePointerEvent`, `pick`/`createPickRay`, `DragManager`                                                                                                                                       |
| `serialization`                                                | 4      | `SceneDocument`, `validateSceneDocument`, `encodeSceneDocument`/`decodeSceneDocument`, `SceneMigrationRegistry`, `ComponentSerializerRegistry`                                                                   |
| `diagnostics`                                                  | 6      | `createChecksum`/`hashFloats`, `ReplayRecorder`, `ReplayPlayer`, `DebugDrawBuffer`, collect\* debug providers, `DEBUG_DRAW_STAGED`                                                                               |
| `particles`                                                    | 8      | `ParticleEmitter`, `ParticleSystem`, `ParticlePool`, `ParticleRenderable`, §27 field factories (`uniformGravityField`, `vortexField`, `turbulenceField`, …)                                                      |
| `text`                                                         | 4      | `BUILTIN_FONT`, `createBitmapFont`, `buildGlyphAtlas`, `layoutText`                                                                                                                                              |
| `render`                                                       | 8      | `Renderer` (interface), `NullRenderer`, `Renderable`, `Sprite`, `Texture`, `buildRenderList`/`buildInterpolatedRenderList`, `collectSceneLights`, `ParticleDrawable`                                             |
| `animation`                                                    | 10     | `Tween`/`animate`, `Timeline`, `AnimationClip`/`AnimationTrack`, `AnimationMixer`, `AnimationSystem`, 34-key easing registry, value adapters                                                                     |
| `physics`                                                      | 15     | `PhysicsWorld`, `RigidBody`, `Collider`, `PhysicsMaterial`, six joint classes, `PhysicsSystem`, `PhysicsSolverAdapter`, `SolverBodyAccess`, `SolverJointAccess`, `PhysicsCapabilities`                           |
| `physics-rapier`                                               | 7      | `Rapier2dAdapter`, `Rapier3dAdapter`, conversion helpers                                                                                                                                                         |
| `render-webgl`                                                 | 6      | `WebglRenderer`, `UnlitProgram`/`SpriteProgram`/`LitProgram`/`ParticleProgram`, `GeometryCache`, `TextureCache`, the structural `GL` seam                                                                        |
| `ui`                                                           | 5      | `UIWidget`, `Panel`, `Button`, `Label`, `WidgetSkin`, layout types                                                                                                                                               |
| `four`                                                         | 25     | `Application` + one re-export module per workspace package                                                                                                                                                       |
| `physics-box2d`, `physics-soft`, `render-canvas`, `render-svg` | 1 each | `PACKAGE_NAME` only — reserved stubs                                                                                                                                                                             |
| `render-webgpu`                                                | 24     | `WebgpuRenderer`, `registerWebgpuRenderer`, pipeline/bind-group/WGSL testing seams (§62 backend 1; R-1 complete 2026-08-29)                                                                                      |

Package-by-package detail lives in [COMPONENTS.md](./COMPONENTS.md); the full
per-file import/export listing is autogenerated into
[DEPENDENCY_GRAPH.md](./DEPENDENCY_GRAPH.md).

---

## Architecture Principles

### 1. One Scene Model

- Everything visible, animated, or simulated is a `Node` in one hierarchy
  (§6); 2D is 3D with `z = 0`, not a parallel system.
- One set of conventions everywhere: right-handed Y-up in both dimensions,
  radians, seconds (§7a/§7b).

### 2. Stable API / Adapter Split

- Application code targets `@fourjs/physics` and `@fourjs/render` interfaces —
  never a concrete solver or backend — except inside adapter/backend packages
  themselves.
- Adapters declare capability differences (`PhysicsCapabilities`) instead of
  silently diverging.

### 3. Determinism Is a Feature

- Fixed-step accumulator loop, seeded RNG, no wall-clock in simulation code,
  deterministic timeline evaluation, checksum tests with committed goldens
  (§33–34).

### 4. Single Transform Authority

- Exactly one system owns a node's transform (§42); conflicts produce
  development warnings, never silent overwrites.

### 5. Frozen Dependency Direction

- The package dependency matrix (implementation plan §3.1) is frozen; edges
  are never added or reversed casually. Where a contract must cross a
  forbidden edge, it is duck-typed and pinned by tests (see
  [The Seams](#the-seams)).

### 6. Honesty About Scope

- Unshipped features are staged with dated notes at their would-be home in
  the source (e.g. `DEBUG_DRAW_STAGED`, `UI_STAGED`), never silently accepted
  and ignored. Package READMEs state real status.

---

## System Context

```
┌──────────────────────────────────────────────────────────────┐
│        Application code / examples / flagship demos          │
└──────────────────────────────┬───────────────────────────────┘
                               │ `four` umbrella (§45 Application
                               │  composition root + subpath per package)
┌──────────────────────────────┴───────────────────────────────┐
│                        fourJS engine                        │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Pillar APIs (solver- and backend-independent)          │  │
│  │  scene   motion   animation   physics   render         │  │
│  │  + geometry, materials, input, text, ui, assets,       │  │
│  │    particles, serialization, diagnostics               │  │
│  └───────────────┬───────────────────────┬────────────────┘  │
│                  │ PhysicsSolverAdapter  │ Renderer (§61)    │
│                  │ + SolverBodyAccess    │                   │
│                  │ + SolverJointAccess   │                   │
│  ┌───────────────┴────────────┐  ┌───────┴────────────────┐  │
│  │ physics-rapier (2D + 3D)   │  │ render-webgl (WebGL 2) │  │
│  │ physics-box2d  (stub)      │  │ render-webgpu (shipped)│  │
│  │ physics-soft   (stub)      │  │ render-canvas  (stub)  │  │
│  │                            │  │ render-svg     (stub)  │  │
│  └───────────────┬────────────┘  └───────┬────────────────┘  │
│                  │                       │                   │
│  ┌───────────────┴───────────────────────┴────────────────┐  │
│  │ Foundation: core (events/components/errors/RNG/JSON)   │  │
│  │             math (vectors/matrices/quaternion/color)   │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬───────────────────────────────┘
                               │
                ┌──────────────┴──────────────┐
                │  Browser platform           │
                │  WebGL 2 · Rapier wasm ·    │
                │  pointer events · rAF       │
                └─────────────────────────────┘
```

### External Actors

1. **Application code**: TypeScript/JavaScript apps importing `four/*`
   subpaths (or individual `@fourjs/*` packages).
2. **Rapier wasm** (`@dimforge/rapier2d-compat` / `rapier3d-compat`, pinned
   0.19.3): loaded asynchronously inside adapter `initialize()`; outside the
   §86 payload budget.
3. **The browser**: WebGL 2 context, pointer events, `requestAnimationFrame`.
   Headless composition (no renderer) is a supported mode — the scene graph
   deterministically steps without one.

---

## Layering and the Frozen Dependency Matrix

The package graph is not emergent — it was **pinned before the first line of
implementation** in the implementation plan
([`../plans/IMPLEMENTATION_PLAN.md`](../plans/IMPLEMENTATION_PLAN.md) §3.1)
and every package manifest copies it verbatim. "Wave" is the parallel
build/dispatch group: a package may depend only on packages in earlier waves.

| Wave | Package                                                           | Direct deps                            |
| ---- | ----------------------------------------------------------------- | -------------------------------------- |
| 1    | `core`                                                            | —                                      |
| 1    | `math`                                                            | —                                      |
| 2    | `scene`                                                           | core, math                             |
| 2    | `geometry`                                                        | core, math                             |
| 2    | `materials`                                                       | core, math                             |
| 2    | `assets`                                                          | core                                   |
| 3    | `motion`                                                          | core, math, scene                      |
| 3    | `input`                                                           | core, math, scene                      |
| 3    | `serialization`                                                   | core, math, scene                      |
| 3    | `diagnostics`                                                     | core, math, scene                      |
| 3    | `particles`                                                       | core, math, scene                      |
| 3    | `text`                                                            | core, math, geometry                   |
| 3    | `render`                                                          | core, math, scene, geometry, materials |
| 4    | `animation`                                                       | core, math, scene, motion              |
| 4    | `physics`                                                         | core, math, scene, motion              |
| 4    | `render-webgpu` / `render-webgl` / `render-canvas` / `render-svg` | core, math, render                     |
| 4    | `ui`                                                              | core, math, scene, input, text         |
| 5    | `physics-rapier` / `physics-box2d` / `physics-soft`               | physics                                |
| 6    | `four`                                                            | all 23 above                           |

One dated amendment exists (2026-08-01): `physics-rapier` additionally
declares `@fourjs/core` + `@fourjs/math` directly, because the adapter genuinely
imports both and "transitives implied" should not hide a real import — no new
edge, both were already transitively present via `physics`.

### Why the matrix is frozen

**Decision**: fix the complete dependency matrix up front; never add or
reverse an edge without an owner decision (RFC/ADR per §95).

**Rationale**:

- The implementation was executed as parallel work packets by subagents;
  packets could only run concurrently because their packages sat in the same
  wave with disjoint file sets. A mutable graph would have serialized
  everything.
- Every edge is a permanent public coupling (workspace `dependencies`,
  `tsconfig` project references, publish-time peer surface). Freezing forces
  each would-be edge through a deliberate decision instead of an expedient
  import.
- The matrix is machine-checked: the dependency-graph tooling regenerates the
  real graph (`bun run graph`) and CI gates (`bun run graph:check`,
  `bun run graph:duplicates`) fail on violations — including any `node:` builtin
  reaching a browser-facing entry point.

**Trade-offs**:

- Some functionality must be duplicated or duck-typed rather than imported
  (see below): the FNV-1a checksum exists in both `diagnostics` and
  `physics`; `PARTICLE_INSTANCE_FLOATS` exists in both `particles` and
  `render`. Both duplications are deliberate, allowlisted in
  `duplicate-allowlist.json`, and pinned against drift by tests.
- Notably, `animation` and `physics` may not import each other — `scene` is
  their shared home, which is why `PoseTarget`, `PoseBuffer`, and the
  transform-authority machinery live in `@fourjs/scene` rather than either
  pillar.

The real, generated graph (24 packages, 161 files; zero runtime and zero
type-only cycles) is in [DEPENDENCY_GRAPH.md](./DEPENDENCY_GRAPH.md) and
`dependency-summary.compact.json`.

---

## The Seams

Three seams keep the engine's promises about pluggability. Two are explicit
interfaces; the third is a set of deliberate duck-typed contracts.

### Seam 1: The Physics Solver Adapter

The stable `@fourjs/physics` API (`PhysicsWorld`, `RigidBody`, `Collider`,
joints, queries) sits above `PhysicsSolverAdapter` (§37):

- `name`, `version`, `capabilities` (`PhysicsCapabilities`: dimensions, joint
  types, CCD modes, determinism tier, snapshot/query support);
- `initialize()` (may return a Promise — Rapier's wasm loads here);
- create/destroy for bodies, colliders, joints; `step`;
- `drainEvents` — physics events are **pulled after `step`**, never delivered
  as callbacks from inside the solver;
- scene↔solver sync, the §30 query set, optional snapshot support, `dispose`.

Implementation surfaced two engine seams **beyond** §37's sketch, defined in
`@fourjs/physics` and mirrored member-for-member by every adapter (future
adapters must implement both):

- **`SolverBodyAccess`** — per-handle transform/velocity/force/kinematic
  accessors, in-place body retyping via `setBodyType` (kinematic↔dynamic
  transitions preserve handle, id, colliders, and mass), and
  `getBodyCenterOfMass`.
- **`SolverJointAccess`** — live joint commands (`setJointLimits`,
  `setJointMotor`) and joint statistics.

Shipped adapters: `Rapier2dAdapter` and `Rapier3dAdapter` over
`@dimforge/rapier{2d,3d}-compat@0.19.3`. Capability honesty, measured rather
than assumed:

- Rapier exposes **no joint-reaction getters**, so `reportsJointReactions`
  is `false` and breakable joints are refused (§28 breakage semantics were
  proven via scripted adapters instead).
- Rapier's motor `maxTorque`/`maxForce` is a force-based **gain**, not §28's
  hard cap — a recorded deviation, cross-referenced in the stable API docs.
- Restitution combine is forced to `Max` (Rapier's default `Average`
  contradicts Appendix A); §32 sleep thresholds have no Rapier binding (only
  `enabled` maps — an honest gap).
- Adapters own **monotonic, never-reused body ids** (Rapier handles are
  unordered doubles), which is what gives §33 checksums a stable visit order.

`physics-box2d` and `physics-soft` are reserved stubs. The §90/§102
compatibility tables are published in `docs/COMPATIBILITY.md` (since
2026-08-07; this paragraph read "are expected to name `SolverBodyAccess` /
`SolverJointAccess` when a second adapter lands" until then). They do name
both seams, per adapter — and the solver-adapter block is generated from the
adapters' own capability declarations by `tools/generate-compatibility.mjs`,
so it cannot drift from them.

### Seam 2: The Renderer Interface

`@fourjs/render` defines the backend-independent surface (§61):

- The `Renderer` interface plus `NullRenderer` (headless tier).
- **Render lists**: scene traversal compiles renderables into compact render
  items (§64) via `buildRenderList`, and `buildInterpolatedRenderList`
  produces §43 interpolation-aware items. Item kinds — unlit, lit, sprite,
  particles — are discriminated by `material.kind` (with an `"unlit"`
  fallback), never `instanceof`.
- Backend-independent light collection (`collectSceneLights`): one
  directional light + scene ambient, first light in scene-graph DFS order
  wins (§33-deterministic).

`@fourjs/render-webgl` is the shipped backend: a **34-method structural GL
seam** (an interface, so unit tests run against a fake GL), four programs
(`UnlitProgram`, `SpriteProgram`, `ParticleProgram`, `LitProgram`), and
geometry/texture caches. `Application` takes a `Renderer` **instance** — a
recorded departure from §45's string union, deferred to a §62 registry packet
so the umbrella never imports backends at runtime (the payload evidence made
the case). Canvas/SVG backends remain reserved stubs; WebGPU shipped with the
R-1 plan (2026-08-21…29).

### Seam 3: Duck-Typed Cross-Package Contracts

Where two packages must agree on a shape but the frozen matrix forbids the
edge, the contract is **duck-typed** — structurally identical types declared
on both sides, with drift caught by tests rather than the compiler:

| Contract                                                                                                            | Sides                       | Forbidden edge                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ParticleDrawable` (instanced particle data for the render list) and the particle system's `SimulationSystem` shape | `render` ↔ `particles`      | `particles` may only see core/math/scene; `render` never sees `particles`                                                                                                               |
| `PARTICLE_INSTANCE_FLOATS` (instance stride)                                                                        | duplicated constant in both | same                                                                                                                                                                                    |
| `ReplayTarget` duck-types `PhysicsWorld` (apps wrap world + input-applier)                                          | `diagnostics` ↔ `physics`   | no edge either direction                                                                                                                                                                |
| Debug-draw providers (`DebugBodyAccess`, `DebugJointAccess`, …) accept solver-access shapes structurally            | `diagnostics` ↔ `physics`   | same                                                                                                                                                                                    |
| §33 FNV-1a checksum duplicated in physics' `world.ts`, pinned against the `diagnostics` reference implementation    | `physics` ↔ `diagnostics`   | no `physics → diagnostics` edge                                                                                                                                                         |
| Light discovery (`isDirectionalLightSource` brand + ambient duck-read)                                              | `render` → `scene`          | edge **exists** — duck-typed anyway so `render-webgl`'s doubles-only tests can fake lights; here drift _is_ type-pinned (render's tests assign the real scene classes to the contracts) |

**Why not just add the edges?** Each of these consumers needs a few fields of
the producer, not its package: an edge would pull a whole pillar into the
dependency cone (and its wave), permanently, for a stride constant or a
`step()` signature. Duck-typing keeps the contract exactly as wide as its
use. The cost — silent drift — is managed explicitly: cross-package contract
tests exercise the real classes against the duck types, and the
duplicate-symbol CI gate (`bun run graph:duplicates`) fails on any duplicated
symbol not listed in `duplicate-allowlist.json` (legitimately independent
forever) or `duplicate-baseline.json` (an accepted, shrinking backlog —
currently empty).

---

## The Fixed-Step Loop

The main loop (§10) is the canonical fixed-step accumulator, and it is the
spine every pillar hangs from:

```
frame time ──► accumulator ──► while (accumulator ≥ fixedDeltaTime):
                                   fixedUpdate (simulation, in system order)
                                   accumulator -= fixedDeltaTime
               (clamped at maximumSubSteps, default 5 — excess time is
                DROPPED and surfaced via TimeState.droppedTime)
               alpha = accumulator / fixedDeltaTime   // in [0, 1]
               update  (per-frame listeners)
               render  (interpolated by alpha)
```

- **`TimeState`** (§9) distinguishes real, render, simulation, scaled, and
  unscaled time; every field is in **seconds**; animation time is clip-local.
- **Systems, not callbacks**: simulation work registers as
  `SimulationSystem`s in the `SystemRegistry` (§39) with explicit numeric
  priorities — nothing edits the scheduler directly. Registered priorities in
  effect: pose-target capture 299, `AnimationSystem` 300
  (`PRIORITY_ANIMATION_TARGETS`), `MotionSystem` 400, particles 500
  (`PRIORITY_PARTICLES`). The canonical §39 ordering is: input → commands →
  animation targets → kinematics → forces → physics solve → constraint solve
  → sensor update → collision event dispatch → snapshot → render
  interpolation.
- World matrices resolve **per fixed step** (spec rev 1.3); `Application`
  resolves world transforms before `update`/`render` listeners fire.
- **Interpolated rendering** (§43): each fixed step, a snapshot system
  captures poses into the scene-side `PoseBuffer` (one store, lerp for
  positions, slerp for rotations); `buildInterpolatedRenderList` blends
  previous→current by `interpolationAlpha`. A skinned item's palette is
  the product of those composed locals (`Skeleton.update(skinRoot,
worldOf)`), not a lerp of `jointMatrices`. Render interpolation **never
  feeds back** into simulation state.
- One deliberately frozen wart: the accumulator's ULP drift can fire a
  boundary-sitting timeline marker one step late; this is pinned in a golden
  (`golden/phase4.json`) rather than papered over.

See [DATAFLOW.md](./DATAFLOW.md) for the step-by-step path of one frame.

---

## Transform Authority

§42 answers the question every hybrid engine fumbles: _who is allowed to
write this node's transform?_

```ts
type TransformAuthority =
  | "manual"
  | "animation"
  | "kinematic"
  | "physics"
  | "blended"
  | "constraint"
  | "network";
```

- Exactly one system owns a node's transform at a time. Any other writer
  triggers `warnAuthorityConflict` (a development warning — never a silent
  overwrite, never a hard crash in production).
- Within the animation pillar, same-property conflicts resolve by a
  **last-started-wins claim registry** shared by `Tween` and
  `AnimationMixer`, with a dev warning.
- `"blended"` selects the §19 physics-animation pipeline as the single owner:
  **animation target pose → kinematic modification → physics solve →
  interpolated render pose.** Concretely: `PoseTarget` (in `@fourjs/scene`, the
  shared home) carries the animated target; per-body `physicsWeight` /
  `animationWeight` live on `RigidBody` (independent, normalized at use);
  feed and publish happen **inside `PhysicsWorld.step`** — there is no
  separate blend system. Applications using blending must register the
  pose-target capture system (priority 299); weight extremes are bit-identical
  to pure physics / pure target, and kinematic↔dynamic transitions retype the
  solver body in place via `SolverBodyAccess.setBodyType`.

The one-owner rule is also what makes authority _handover_ an explicit,
observable act — e.g. the drag example performs the §42 untrack + handover
pair rather than writing a physics-owned transform behind the solver's back.

---

## Components and Eventing

### Component Model (§6a, decisions D1/D2)

- `Node` is **single inheritance**: `abstract class Node extends
EventEmitter<NodeEventMap>` — no TypeScript mixins (declaration-emit and
  generic-widening hazards). Components live in an internal
  `ComponentRegistry`; Node delegates
  `addComponent`/`getComponent`/`removeComponent`.
- Components are classes carrying `static readonly typeName`; the registry is
  keyed by `typeName`, **one component per type per node**, with explicit
  lifecycle (`onAttach`/`onDetach`/`dispose`).
- `RigidBody`, colliders, and `MotionComponent` are components — not `Node`
  subclasses. Joints, by contrast, register on the **world**
  (`world.addJoint`), not as components (a recorded plan decision).
- Serialization round-trips components through a `ComponentSerializerRegistry`
  keyed by component class (§79).

### Eventing (§6b)

- One typed `EventEmitter` serves nodes and the application; `on` returns an
  unsubscriber; emit during dispatch **queues and defers** rather than
  re-entering (while the system registry deliberately _throws_ on re-entrancy
  — protecting §34 replay).
- Event maps are extended across packages by TypeScript **declaration
  merging**, not new edges: `@fourjs/input` augments `NodeEventMap` via
  `declare module "@fourjs/scene"`; the §29 collision keys merge into
  `RigidBodyEventMap` the same way.
- Input events propagate **capture → target → bubble** (§72), with
  `capture:`-prefixed listener keys on the propagating pointer types.
- Physics events are collected by the adapter and dispatched **after each
  fixed step** (§39 step 9, after the sensor update) via `drainEvents` —
  never from inside the solver step.

---

## Determinism Architecture

Determinism (§33) is tiered — `none | same-runtime | same-platform |
cross-platform` — and the shipped target is **same-runtime**: same solver,
same timestep, same input sequence, no nondeterministic multithreaded paths.
The architecture makes that a testable property rather than a hope:

1. **Seeded randomness.** `SeededRandom` (xorshift128 with splitmix32
   seeding) lives in `@fourjs/core`; engine code never touches `Math.random`.
   RNG _draw counts_ are part of the contract — e.g. particle spawning burns
   a fixed 4 draws per spawn even for dropped spawns, so pool capacity is
   part of the stream.
2. **Stable iteration order.** Checksums visit bodies (including sleeping
   ones) in monotonic body-id order — ids the adapters mint themselves,
   because Rapier handles are unordered.
3. **Checksums.** `createChecksum`/`hashFloats` (FNV-1a over float
   sequences, `@fourjs/diagnostics`) digest simulation state; committed golden
   digests are verified both in-process and in a freshly spawned Node
   process, with sensitivity evidence (a perturbed input changes the digest).
4. **Snapshots (§34).** `PhysicsWorld.createSnapshot()` /
   `restoreSnapshot()` with versioned envelopes carrying the body-id
   registry; restore refuses mismatched world configuration field-by-field
   (dimension, resolved gravity, sleeping, determinism, solver iterations)
   when the snapshot carries it. The §79/§34 boundary is measured: a
   contact-free scene save round-trips **bit-identically for 200 further
   steps**, while an in-contact save diverges only through solver warm-start
   state — §34 snapshots carry that state, §79 scene documents deliberately
   don't.
5. **Replay.** `ReplayRecorder` (recording is non-perturbing — proven, since
   Rapier's snapshot is a pure read) produces a versioned, canonically
   validated JSON document (`LATEST_REPLAY_FORMAT_VERSION`, with a document
   declaring the lowest supported version that expresses it; strict
   canonical base64); `ReplayPlayer` owns bookkeeping only while the host
   supplies the step function, with checksum verification as the runtime
   signal that the pairing is right. The Phase 10 exit proof: record →
   bit-identical replay (240/240 checksums) → snapshot-seek → frame-by-frame
   inspection of contact geometry at the exact recorded steps → exact slow
   motion.
6. **Determinism test suites** live in `tests/determinism/` with eight
   goldens mapping 1:1 to determinism specs; even the 2D and 3D Rapier
   solvers are proven bit-identical on mirrored scenarios.

---

## Key Design Decisions

### 1. Why Four Coequal Pillars over One Scene Graph?

**Decision**: Scene, Render, Motion, and Physics are peers over a single
shared hierarchy (§3), rather than a renderer with bolted-on subsystems.

**Rationale**: the target audience's pain is _integration_ — separate scene
models, clocks, and conventions. One graph means picking, animation, physics,
text, and UI compose without glue code; the §118 flagship criterion is
explicitly "one motion-capable engine, not a graphics library with physics
bolted on."

**Trade-offs**: the base `Node` must stay lightweight while serving every
pillar — hence components (§6a) instead of a deep inheritance tree.

### 2. Why a Stable Physics API over Solver Adapters?

**Decision**: users write against `@fourjs/physics`; solvers plug in beneath
`PhysicsSolverAdapter` + `SolverBodyAccess`/`SolverJointAccess` (§37).

**Rationale**: excellent solvers already exist (Rapier); fourJS adapts
rather than reinvents. The adapter boundary also localizes solver quirks —
Rapier's motor-gain semantics, missing joint reactions, restitution defaults
— as _recorded capability differences_ instead of leaking them into user
code.

**Trade-offs**: the stable API can only promise what the weakest relevant
capability allows; features a solver cannot honor are refused loudly (e.g.
breakable joints on Rapier) rather than approximated silently.

### 3. Why Duck-Typed Contracts Instead of New Edges?

See [Seam 3](#seam-3-duck-typed-cross-package-contracts). **Decision**: keep
the matrix frozen; duck-type the handful of cross-pillar shapes.
**Trade-off**: compiler-invisible drift, bought back with contract tests and
the duplicate-symbol CI gate.

### 4. Why Fixed-Step Simulation + Interpolated Rendering?

**Decision**: physics and simulation advance on a fixed accumulator clamped
at `maximumSubSteps`; rendering runs at display rate and interpolates (§10,
§43).

**Rationale**: stable integration, bounded per-frame simulation cost, and —
decisive for this project — _determinism and replay_, which variable-step
loops structurally cannot offer. Dropped time is surfaced
(`TimeState.droppedTime`), never hidden.

**Trade-offs**: rendered state lags true simulation state by up to one fixed
step, and boundary-timing artifacts (the pinned ULP-drift golden) must be
documented rather than wished away.

### 5. Why Single Transform Authority?

**Decision**: one enum, one owner per node, warnings on conflict (§42);
`"blended"` is itself an authority selecting the §19 pipeline.

**Rationale**: "tween fights physics for the same transform" is the classic
glue-stack bug; making ownership explicit turns it into a visible handover.

**Trade-offs**: legitimate multi-writer scenarios must be expressed through
the blending pipeline or explicit handovers, which is more ceremony than
last-write-wins.

### 6. Why Was the Whole Dependency Matrix Pre-Decided?

See [Layering](#layering-and-the-frozen-dependency-matrix). The plan's
work-packet execution model (parallel subagents, disjoint file sets,
wave-ordered dispatch) required a graph that could not shift underfoot; the
matrix doubles as the permanent architectural constraint, now machine-gated
in CI.

---

## Build & Packaging

- **Toolchain** (§91, exact pins in plan §3.2): strict TypeScript, ESM
  only, Bun workspace (`>= 1.4.2`), Vitest, Playwright, **Oxlint** (type-aware),
  Prettier, Vite 8, TypeDoc, Changesets (release workflow deferred to first
  publish). ESLint and typescript-eslint were removed 2026-09-08. Task orchestration is
  `bun run --filter './packages/*'` (Turborepo was replaced 2026-08-03).
- **The ROOT is TypeScript 7.0.2 only** (2026-09-08). TS 7 is the Go port: its
  package exports `.` as `lib/version.cjs` plus `unstable/*` modules, so the
  legacy `import ts from "typescript"` compiler API is gone, and every tool that
  consumed it breaks rather than degrades.
- **One consumer of TypeScript 6 survives, and it is isolated.** TypeDoc lives in
  the `tools/docs` workspace package with `typescript@6.0.3` as a **direct**
  dependency, so it resolves its own compiler and constrains nothing above it.
  A peer dependency cannot do this — `bun add --dev typedoc` at the root resolves
  the peer to the hoisted 7.0.2 and TypeDoc dies with `Cannot read properties of
undefined (reading 'PropertyDeclaration')`. Measured both ways.
- **Linting is Oxlint, and that is what freed the root.** typescript-eslint
  refuses TS 7 by name; Oxlint's type-aware mode _requires_ TS 7 (it is
  `typescript-go` underneath). All 47 `recommendedTypeChecked` rules are
  reproduced in `.oxlintrc.json`, 16 of them mutation-verified.

  Consequences a reader needs:
  - Every `tsc` invocation **names its compiler by path**. Both packages install
    a binary called `tsc`, so `node_modules/.bin/tsc` is decided by install
    order — it silently pointed at TS 7 while `typescript` resolved to 6.0.3.
    Package builds run `node ../../node_modules/ts7/bin/tsc`; nothing relies on
    the ambiguous shim.
  - Two compilers read this source, and they **do** disagree. `typecheck:ts6`
    is a CI gate for exactly that: it caught TS 6 rejecting the `.ts` import
    extensions in three §93 examples that 5.9 and 7.0 both accept.

- **Build**: `tsc -b` with project references mirroring the §3.1 matrix. Each
  package carries two tsconfigs — `tsconfig.json` (dev/lint, `noEmit`) and
  `tsconfig.build.json` (declaration-emitting, `references` per dependency).
  Relative imports use `.js` suffixes (NodeNext resolution).
- **Exports**: every package is `"sideEffects": false` with a types-first
  exports map; the umbrella `four` additionally exposes one subpath per
  workspace package (`four/scene`, `four/math`, …) carrying the §91
  tree-shaking requirement. Publish mapping: `four` → `@danielsimonjr/fourjs`,
  `@fourjs/<name>` → `@danielsimonjr/fourjs-<name>` at first publish.
- **CI gates** beyond build/test/lint/docs:
  - **§86 payload budget**: size-limit pins the minimal 2D app
    (core + math + scene + render-webgl) at **33.28 kB gzip of a 150 kB
    budget**; example sites carry their own budgets. Solver wasm is outside
    the budget by §86's wording.
  - **Graph gates**: `bun run graph:check` (e.g. no `node:` builtin may reach a
    browser-facing `.` entry, 24/24 pass) and `bun run graph:duplicates`
    (fails on unallowlisted duplicate symbols).
  - **Spec checker**: `node tools/check-spec.mjs` after any spec edit
    (section sequence, fence balance, TOC anchors, banned terms).
  - Coverage thresholds ≥ 95% are tooling-enforced at package level.

---

## Testing Strategy

### Test Pyramid

```
            /\
           /  \
          / Browser / visual \        38 Playwright tests (pixel goldens,
         /______________________\     interaction, six example webServers)
        /                        \
       /  Cross-package suites    \   174 tests in tests/{integration,
      /____________________________\  visual,determinism}/
     /                              \
    /      Unit tests (colocated)    \  3,083 tests, per package,
   /__________________________________\ coverage ≥ 95% everywhere
  /                                    \
 /   Benchmarks (committed records)     \  benchmarks/ harness, five suites
/________________________________________\
```

### Test Organization

| Location             | Purpose                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `packages/*/tests/`  | Unit tests, colocated per package (§92)                                                                     |
| `tests/integration/` | Cross-package workflows (scene + renderer, physics + interpolation, blending round trips)                   |
| `tests/visual/`      | Playwright pixel-golden project (SwiftShader-to-SwiftShader goldens in `tests/visual/*-snapshots/`)         |
| `tests/determinism/` | Checksum/golden suites; identical inputs ⇒ identical digests, snapshot restore reproduces subsequent states |
| `tests/browser/`     | Browser interaction gates (ANGLE/SwiftShader-pinned Chromium)                                               |
| `benchmarks/`        | Performance harness with committed measurement records                                                      |

Two testing postures worth knowing:

- **Fakes at the seams**: the WebGL backend is unit-tested against a fake GL
  implementing the structural seam; adapters are exercised both against fakes
  and against live Rapier; scripted adapters prove behaviors Rapier cannot
  express (e.g. joint breakage).
- **Benchmarks record, they don't advertise**: the committed particle number
  is "100k particles + 3 fields = 16.54 ms/step mean on a 4-core CI Xeon" —
  a measurement, explicitly not a 60 fps claim. Other recorded findings:
  contacts + events are ~88% of a physics step's cost; a clean scene pass is
  only ~3× cheaper than full recompute.

Current totals (2026-08-05): **3,083 unit + 174 suite + 38 browser/visual
tests**, all 24 packages building, determinism goldens bit-exact, TypeDoc
0 warnings. The per-package breakdown lives in
[TEST_COVERAGE.md](./TEST_COVERAGE.md).

---

## Conclusion

The fourJS architecture prioritizes:

- **Unification**: one scene graph, one clock, one set of conventions across
  2D/3D, animation, and physics
- **Determinism**: fixed-step simulation, seeded RNG, checksums, snapshots,
  and replay as first-class, tested requirements
- **Pluggability**: stable APIs above the solver-adapter and renderer seams,
  with capabilities declared instead of assumed
- **Discipline**: a frozen, machine-gated dependency matrix; single-authority
  transforms; staged features marked honestly with dated notes
- **Verifiability**: every claim above traces to the spec (§N), the
  implementation plan, or a committed measurement

Related: [OVERVIEW.md](./OVERVIEW.md) · [COMPONENTS.md](./COMPONENTS.md) ·
[DATAFLOW.md](./DATAFLOW.md) · [API.md](./API.md) ·
[DEPENDENCY_GRAPH.md](./DEPENDENCY_GRAPH.md) ·
[TEST_COVERAGE.md](./TEST_COVERAGE.md)
