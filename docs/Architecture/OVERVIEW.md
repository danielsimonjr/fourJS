# fourJS — Project Overview

_"One scene. Every dimension. Everything moves."_

A unified TypeScript framework combining 2D, 2.5D, and 3D graphics with
animation, motion systems, and physics in a **single shared scene model**: 2D
shapes, 3D meshes, text, UI, rigid bodies, joints, and particle emitters all
live in one scene graph with one clock, one transform-authority model, one
event system, and one set of conventions. Deterministic fixed-step simulation
with snapshots and replay is a first-class requirement, not an afterthought.

Workspace packages are `@fourjs/*`-scoped (umbrella: `four`); the decided publish
names are **`@danielsimonjr/fourjs`** (umbrella) and
`@danielsimonjr/fourjs-<name>` (sub-packages). Nothing is published yet — the
mechanical rename happens in the release workflow at first publish (§94, 0.1).

Section references like "§42" mean [`docs/SPECIFICATION.md`](../SPECIFICATION.md)
numbering — the working reference whose current revision is whatever tops the
amendments table at its top. The outward-facing why-exist case is
[`docs/POSITIONING.md`](../POSITIONING.md).

## Why it exists, in one paragraph

An interactive 2D/3D web app today is an integration project: three.js for 3D,
Pixi or Canvas for 2D, Rapier or Matter for physics, GSAP for animation, DOM
for UI — five libraries, five scene models, five clocks, five coordinate
conventions. The glue is where projects bleed: render meshes chasing physics
bodies a frame late, tweens fighting physics for the same transform,
milliseconds in one API and seconds in another, and no story for determinism
or replay. fourJS's bet is that **the integration itself is the product**.
The first audience is engineering/simulation web apps and digital twins (which
need determinism, replay, explicit units, and mixed 2D diagrams + 3D models),
then interactive-content developers, then games.

## The four pillars

Four coequal architectural pillars (§3) over one shared scene graph:

| Pillar      | Responsibility                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| **Scene**   | Hierarchy, transforms, visibility, grouping, ownership                                                             |
| **Render**  | Logical scene state → pixels, behind a backend-independent renderer interface (§61)                                |
| **Motion**  | Deterministic change through time: velocity/acceleration, trajectories, kinematic control, steering, interpolation |
| **Physics** | Forces, mass, collisions, constraints, joints, fields — a stable API (§20) above pluggable solver adapters (§37)   |

The recurring distinction: _animation_ specifies how something **should** move,
_kinematics_ moves objects directly, _dynamics_ derives motion from forces —
all supported, with controlled blending between them (§19) governed by a
single transform-authority model (§42).

## Key capabilities

| Area                       | Description                                                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unified scene graph        | `Node` / `Group` / `Scene` with full-3D transforms (§6–7); 2D nodes simply use `z = 0` — one hierarchy serves 2D, 3D, UI, physics bodies                                                                            |
| Component model            | `node.addComponent(...)`, one component per type, `typeName`-keyed; `RigidBody`, colliders, and `MotionComponent` are components (§6a)                                                                              |
| Eventing                   | One typed `EventEmitter` for nodes and the application; input propagates capture → target → bubble; physics events dispatch after each fixed step (§6b)                                                             |
| Fixed-step simulation      | Accumulator clamped at `maximumSubSteps`, dropped time surfaced via `TimeState.droppedTime`, rendering interpolates by `interpolationAlpha` (§9–10, §43)                                                            |
| Motion                     | `MotionComponent`, five §38 integrators, eight §13 trajectories, `KinematicController`, steering/flocking, `PIDController`, `SpringDamper`, two-bone analytic IK                                                    |
| Animation                  | `Tween` / `Timeline` / `AnimationClip` / `AnimationTrack` / `AnimationMixer`, 34-key easing registry, property bindings, deterministic evaluation (§14–17)                                                          |
| Physics                    | `PhysicsWorld` with `"2d"` / `"3d"` dimensions and parallel semantics (§21); bodies, colliders, materials, forces, collision events, queries — all solver-independent                                               |
| Solver adapters            | `PhysicsSolverAdapter` (§37) plus the `SolverBodyAccess` / `SolverJointAccess` seams; **Rapier 2D + 3D shipped** (`-compat@0.20.0`), Box2D reserved                                                                 |
| Joints                     | Fixed, hinge, slider, rope, spring, spherical shipped with live limits/motors (§28); distance and gear staged with dated notes                                                                                      |
| Physics-animation blending | The `"blended"` §42 authority selects the §19 pipeline; per-body weights, in-place kinematic↔dynamic retyping, velocity inheritance                                                                                 |
| Particles                  | SoA `Float32Array` pools, §27 force fields, instanced-quad rendering at 6 GL calls/frame; 100k particles measured and recorded (§36, §112)                                                                          |
| Rendering                  | §61 `Renderer` interface, `NullRenderer`, WebGL 2 backend with unlit/sprite/lit/particle pipelines; interpolation-aware render lists (§43)                                                                          |
| Lighting                   | §68 MVP tier: **one directional light + scene ambient, Lambert diffuse** — nothing else yet; shadows (§69) and PBR (§59) staged                                                                                     |
| Text                       | §56 MVP bitmap tier (built-in 6×12 font, 95 glyphs, glyph atlases, layout); SDF/shaping staged behind an RFC                                                                                                        |
| Input & picking            | §71 ray/AABB/oriented-box picking, §72 pointer + keyboard propagation with capture keys, `DragManager` world-delta handoff                                                                                          |
| UI                         | Retained-mode `Panel` / `Button` / `Label` scene nodes with flex/stack/absolute layout, keyboard traversal + Enter/Space activation, and the app-supplied `WidgetSkin` seam (§73–75 subset); a11y DOM mirror staged |
| Assets                     | `AssetManager` with coalescing refcounted cache; text/JSON/binary/image loaders; glTF 2.0 core (`createGltfLoader` / `instantiateGltf`)                                                                             |
| Serialization              | `SceneDocument` v1 with canonical validation, component-serializer registry, §80 migrations; byte-identical round trips (§79)                                                                                       |
| Determinism & replay       | Same-runtime tier (§33): `SeededRandom`, float checksums, §34 snapshot envelopes, `ReplayRecorder` / `ReplayPlayer` with bit-identical replay proof                                                                 |
| Diagnostics                | Debug-draw buffer + seven duck-typed providers (origins, velocities, centers of mass, contacts, impulses, solver/joint statistics) (§84, §113)                                                                      |

## Quick architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│           Application code (examples, demos, your app)          │
└───────────────────────────────┬─────────────────────────────────┘
                                │ `four` umbrella — Application (§45)
                                │ + one subpath per workspace package
┌───────────────────────────────┴─────────────────────────────────┐
│  Pillar APIs (solver- and backend-independent)                  │
│    scene · motion · animation · physics · render                │
│    + geometry, materials, input, text, ui, assets,              │
│      particles, serialization, diagnostics                      │
├─────────────────────────────────────────────────────────────────┤
│  Seams                                                          │
│    PhysicsSolverAdapter (§37)     Renderer (§61)                │
│      ├ physics-rapier  (shipped)    ├ render-webgl   (shipped)  │
│      ├ physics-box2d   (stub)       ├ render-webgpu  (shipped)  │
│      └ physics-soft    (stub)       ├ render-canvas  (stub)     │
│                                     └ render-svg     (stub)     │
├─────────────────────────────────────────────────────────────────┤
│  Foundation                                                     │
│    core — events, components, errors, disposal, RNG, JSON       │
│    math — Vector2/3/4, Matrix3/4, Quaternion, ColorRGBA         │
└─────────────────────────────────────────────────────────────────┘
```

The full dependency analysis (every file, import, and export) is autogenerated
into [DEPENDENCY_GRAPH.md](./DEPENDENCY_GRAPH.md); the layering rules and the
frozen dependency matrix behind it are explained in
[ARCHITECTURE.md](./ARCHITECTURE.md).

## Package map (24 packages)

All workspace packages are `@fourjs/`-scoped; the scaffold matches the §98
monorepo tree exactly. "Wave" is the build/dispatch layer from the frozen
dependency matrix (implementation plan §3.1).

| Package          | Wave | Responsibility                                                                                                                       | Status                       |
| ---------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| `core`           | 1    | Eventing (§6b), component model (§6a), `FourError` (§89), disposal (§83), `SeededRandom`, JSON utilities                             | Shipped                      |
| `math`           | 1    | Vector2/3/4, Matrix3/4, Quaternion, `ColorRGBA`, math conventions (§7b)                                                              | Shipped                      |
| `scene`          | 2    | Node/Group/Scene, transforms, cameras + viewports (§47–48), `DirectionalLight`, transform authority (§42), `PoseBuffer`/`PoseTarget` | Shipped                      |
| `geometry`       | 2    | `BufferGeometry` + MVP primitives (box, plane, 2D circle) with optional normals (§53)                                                | Shipped                      |
| `materials`      | 2    | `UnlitMaterial`, `LitMaterial`, `SpriteMaterial` with a `kind` pipeline discriminant (§57)                                           | Shipped                      |
| `assets`         | 2    | `AssetManager`, built-in loaders, `ImageAsset`, glTF 2.0 core (§76, §78)                                                             | Shipped                      |
| `motion`         | 3    | Clock/`TimeState`, §10 scheduler, §39 system registry, `MotionComponent`, integrators, trajectories, kinematics, steering, PID, IK   | Shipped                      |
| `input`          | 3    | Pointer input, propagation, picking, dragging (§71–72)                                                                               | Shipped                      |
| `serialization`  | 3    | `SceneDocument`, validation, migrations (§79–80)                                                                                     | Shipped                      |
| `diagnostics`    | 3    | Checksums, replay recorder/player, debug draw, solver stats (§33–34, §84)                                                            | Shipped                      |
| `particles`      | 3    | Emitters, SoA pools, §27 force fields (§36)                                                                                          | Shipped                      |
| `text`           | 3    | Bitmap font, glyph atlas, layout (§56 MVP tier)                                                                                      | Shipped (SDF staged)         |
| `render`         | 3    | §61 `Renderer` interface, render lists, sprites, textures, light collection                                                          | Shipped                      |
| `animation`      | 4    | Tweens, easing, timelines, clips/tracks, mixer, animation system (Part III)                                                          | Shipped                      |
| `physics`        | 4    | The stable physics API: world, bodies, colliders, joints, queries, adapter contract (§101)                                           | Shipped                      |
| `render-webgl`   | 4    | WebGL 2 backend: four GL programs, structural GL seam, caches (§62)                                                                  | Shipped                      |
| `render-webgpu`  | 4    | WebGPU backend — unlit/sprite/lit/standard, clips, shadows, compute, node materials (§62)                                            | Shipped (R-1, 2026-08-29)    |
| `render-canvas`  | 4    | Canvas 2D backend                                                                                                                    | Reserved stub                |
| `render-svg`     | 4    | SVG backend                                                                                                                          | Reserved stub                |
| `ui`             | 4    | Retained-mode widgets, layout, keyboard traversal, `WidgetSkin` seam (§73–75)                                                        | Shipped (a11y mirror staged) |
| `physics-rapier` | 5    | Rapier 2D + 3D solver adapters (§102)                                                                                                | Shipped                      |
| `physics-box2d`  | 5    | Box2D solver adapter                                                                                                                 | Reserved stub                |
| `physics-soft`   | 5    | Soft bodies / deformables (§35, not a solver adapter)                                                                                | Reserved stub                |
| `four`           | 6    | Umbrella: the §45 `Application` composition root + one namespace/subpath per package                                                 | Shipped                      |

The four reserved stubs (`physics-box2d`, `physics-soft`, `render-canvas`,
`render-svg`) each contain a single placeholder file exporting
`PACKAGE_NAME`, and their READMEs say so honestly ("interface reserved; not
yet implemented"). `@fourjs/render-webgpu` left that list 2026-08-21…29 (the
R-1 plan). Per ERRATA E-3, `physics-matter` and `physics-cannon`
directories must **not** be added without a spec amendment.

## Conventions everything assumes

- **Right-handed, Y-up world — in 2D and 3D alike** (§7a). 2D gravity is
  negative Y. Front faces are CCW.
- **Radians** in all APIs; **all engine times are seconds** — tween and
  timeline durations included, never milliseconds.
- Math types are **mutable**; in-place methods return `this`; hot paths take
  `out` parameters; no steady-state per-frame allocation (§7b).
- Simulation advances in **fixed steps**; rendering runs at its own rate and
  interpolates between the previous and current simulation state (§10, §43).
- **Exactly one system owns a node's transform** at a time (§42); conflicts
  warn in development, never silently overwrite.
- Units are explicit (§40): default meter/kilogram/second/radian, but the
  1 unit = 1 meter assumption is never hard-coded.
- Imports use the umbrella package's subpaths, exactly as the examples do:

  ```ts
  import { Application } from "fourJS/application";
  import { Group, OrthographicCamera } from "fourJS/scene";
  import { Vector3 } from "fourJS/math";
  ```

## Current implementation status

All thirteen phases of the implementation plan (§103–§113a, executed via
[`docs/plans/IMPLEMENTATION_PLAN.md`](../plans/IMPLEMENTATION_PLAN.md)) are
closed, and the §120 MVP audit stands at **43/43 items shipped-or-MVP** since
the lighting packet landed (2026-08-04). As of 2026-08-05:

- **3,083 unit tests** (colocated per package) + **174 cross-package suite
  tests** (`tests/{integration,visual,determinism}/`) + **38 browser/visual
  Playwright tests**, coverage gates ≥ 95% everywhere.
- §86 payload gate: the minimal 2D app (core + math + scene + render-webgl) is
  **33.28 kB gzip against the 150 kB budget**.
- Determinism goldens are bit-exact in-process and across fresh processes;
  TypeDoc builds with 0 warnings.

Honesty about what is _not_ there yet — staged features carry dated staging
notes at their would-be home in the source:

- **Backends/solvers**: WebGPU, Canvas 2D, SVG renderers and the Box2D and
  soft-body packages are reserved stubs (see the table above).
- **Rendering**: shadows (§69), `StandardMaterial`/PBR (§59), color strings
  and tone mapping (§60a), point/spot/hemisphere/area lights and multi-light,
  §63's transient-target/lifetime/barrier tier (the linear-pass `RenderGraph` shipped
  2026-08-07), GPU compute (§82).
- **Content**: glTF loading (§78), SDF/shaped text (§56 full tier),
  morph/skeletal animation tracks, distance and gear joints (§28).
- **Platform**: workers (§88) — the engine is main-thread today, with APIs
  deliberately shaped not to preclude worker migration; UI accessibility
  DOM mirror and screen-reader support (§75 — keyboard navigation shipped
  2026-08-07).

## Related documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — in-depth technical architecture: the
  frozen dependency matrix, the seams, determinism, the fixed-step loop
- [COMPONENTS.md](./COMPONENTS.md) — package-by-package breakdown
- [DATAFLOW.md](./DATAFLOW.md) — data-flow patterns through a frame
- [API.md](./API.md) — public API reference
- [DEPENDENCY_GRAPH.md](./DEPENDENCY_GRAPH.md) — autogenerated dependency analysis
- [TEST_COVERAGE.md](./TEST_COVERAGE.md) — test-coverage report
- [../SPECIFICATION.md](../SPECIFICATION.md) — the working specification (§1–120 + lettered sections + appendices)
- [../POSITIONING.md](../POSITIONING.md) — why the project exists
- [../guides/README.md](../guides/README.md) — the thirteen prose guides (§93)
