# AGENTS.md

Orientation for AI agents (and new contributors) working in this repository. Read this before
making changes. A shorter companion file, `CLAUDE.md`, exists for Claude Code; this document is
the detailed reference.

---

## 1. What this repository is

fourJS — "One scene. Every dimension. Everything moves." — is a unified
JavaScript/TypeScript framework combining 2D, 2.5D, and 3D graphics with animation, motion
systems, and physics (rigid-body and particles shipped; soft-body reserved) in a single
shared scene model.

**Current state: fully implemented** (implementation plan §103–§113a complete 2026-08-02;
this block said "scaffold only" until 2026-08-05 — it predated Phase 0).

- All 24 `packages/*` packages carry real source and colocated tests (~3,000 unit tests,
  ≥95% per-package coverage enforced); four are deliberate reserved stubs
  (`physics-box2d`, `physics-soft`, `render-canvas`, `render-svg`). `render-webgpu`
  left the stub list 2026-08-21…29 (the R-1 plan).
- Root `package.json` + Bun workspace + CI workflow exist; `tests/{integration,
determinism}/` hold cross-package suites, `tests/browser/` the Playwright gates,
  `tests/visual/` pixel goldens, `benchmarks/` committed performance records, and ten
  `examples/` sites build and are browser-tested.
- Common commands: `bun run build` / `test` / `test:suites` / `test:browser` / `lint` /
  `run coverage` / `run docs` / `graph` / `check-spec` / `run size`. See
  `docs/Architecture/OVERVIEW.md` for orientation.

License: MIT (`LICENSE`).

## 2. Documentation inventory

| File                                     | Role                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/SPECIFICATION.md`                  | **The working reference** — current revision is whatever tops the amendments table in the file (hardcoded revision numbers elsewhere go stale). Parts I–XIII, sections 1–120 plus lettered insertions (6a, 6b, 7a, 7b, 60a, 106a, 113a) and Appendices A–B; no duplicates. § numbering 1–120 is frozen — new sections use letter suffixes. |
| `docs/SPEC-REVIEW.md`                    | Technical review R-1…R-35 that drove revision 1.1; header records the disposition (all applied).                                                                                                                                                                                                                                           |
| `docs/POSITIONING.md`                    | Outward-facing why-exist case, audience order, migration story, demo-first principle, stated risks.                                                                                                                                                                                                                                        |
| `docs/plans/IMPLEMENTATION_PLAN.md`      | Work-packet plan (subagent-driven; stress-tested).                                                                                                                                                                                                                                                                                         |
| `docs/rfcs/`                             | RFC/ADR home (§95 + plan governance gate): process README and template.                                                                                                                                                                                                                                                                    |
| `docs/archive/four-js-specification.pdf` | Original source (65 pages), archived unchanged. **Still contains the numbering defects** — translate its references via the errata map.                                                                                                                                                                                                    |
| `docs/ERRATA.md`                         | Correction log: the PDF's defects, how each was resolved, and the PDF→Markdown numbering map.                                                                                                                                                                                                                                              |
| `README.md`                              | Project summary; points at the spec and errata.                                                                                                                                                                                                                                                                                            |
| `TODO.md`                                | Task tracker (root). Check it at session start; update it as work completes.                                                                                                                                                                                                                                                               |
| `CHANGELOG.md`                           | Chronological log of notable repository changes (root). Add entries for substantive changes.                                                                                                                                                                                                                                               |
| `MEMORY.md`                              | Cross-session memory (root): decisions, standing facts, open questions, gotchas. Append, don't rewrite; supersede old decisions with dated entries.                                                                                                                                                                                        |

## 3. Specification numbering — corrected; use the errata map for PDF references

The PDF had three internal defects. All were **resolved in `SPECIFICATION.md`** by the
author's decision (2026-07-28); `docs/ERRATA.md` is now a correction log:

- **E-1 (resolved):** the PDF used `Part VII` for two different parts. The second occurrence
  (_Package Architecture_) is now `Part VIII`, and later parts shifted by one — the PDF's
  Parts VIII–XII are the Markdown's Parts IX–XIII.
- **E-2 (resolved):** the PDF assigned section numbers 45–67 twice. The second range was
  renumbered **+53** to §98–120: Package Architecture §98–102, Implementation Plan (Phases
  0–10) §103–113, Public API Examples §114–117, Flagship Demonstrations §118–119, Revised
  MVP §120. Plain "§N" citations now unambiguously mean `SPECIFICATION.md` numbering; when
  citing the PDF, say so explicitly ("PDF §49, second range").
- **E-3 (resolved):** the PDF's Solver Packages section contradicted the monorepo tree by
  naming `physics-matter` and `physics-cannon`. The tree won: §102 (Solver Packages) now
  lists only `@fourjs/physics-rapier` and `@fourjs/physics-box2d`. The scaffold contains
  `physics-rapier`, `physics-box2d`, and `physics-soft` only — **do not add `physics-matter`
  or `physics-cannon` directories** without a further spec amendment.

Non-defects already checked and dismissed (do not "rediscover" them): §118 exists (its title
begins with a typographic quote: `"One Scene, Everything Moves"`); repeated low numbers
(1., 2., 3., …) inside sections are numbered _lists_, not sections.

Do not edit the PDF, and do not reintroduce the old dual numbering when quoting it —
translate PDF references through the ERRATA map instead.

**Revisions beyond the PDF:** the specification was amended after the corrected rendering —
revision 1.1 (2026-07-28) applied all 35 items of `docs/SPEC-REVIEW.md` (new sections 6a
Component Model, 6b Eventing, 7a Coordinate/Unit Conventions, 7b Math Conventions, 60a Color
Management; Appendices A Normative Defaults and B Glossary), followed by revisions 1.2–1.6
(2026-07-29): payload budget confirmed, verification-pass fixes, Application root moved to
`four`, MVP phases §106a/§113a added, publish names decided
(`@danielsimonjr/fourjs`). The archived PDF is **frozen at the pre-1.0 text** and
predates all of this. Amendments are recorded in the spec's own amendments table; ERRATA.md
covers only the PDF's extraction defects. Run `bun tools/check-spec.mjs` (or `bun run check-spec`) after any spec
edit.

## 4. Core concept and design principles

Every visible, interactive, animated, or simulated entity lives in **one shared scene**:
static geometry, animated objects, dynamic bodies, constraints/joints, particle systems,
cameras, lights, 2D diagrams, 3D models, and UI all participate in the same lifecycle.

Four coequal **architectural pillars** (§3):

1. **Scene** — hierarchy, transforms, visibility, grouping, ownership.
2. **Render** — logical scene state → pixels via WebGPU, WebGL 2, Canvas 2D, SVG, or headless.
3. **Motion** — deterministic change through time: animation, velocity/acceleration,
   trajectories, interpolation, procedural movement, kinematic control.
4. **Physics** — forces, mass, collisions, constraints, impulses, joints, fields, integration.

Motion vs. physics distinction (recurs throughout the spec):

- _Animation_ specifies how something **should** move.
- _Physics_ calculates how something **must** move under physical rules.
- _Kinematics_ moves objects directly without solving forces.
- _Dynamics_ derives motion from forces, mass, and constraints.
  All four are supported, with controlled blending between them.

Headline goals (§4): unified 2D/3D scene graph; animation/motion as first-class systems; one
physics API for 2D and 3D; deterministic fixed-step simulation; logical physics state separate
from rendering backends; pluggable solvers under a stable API; interpolated rendering;
worker/GPU simulation; **engineering and scientific applications, not only games**;
serialization, replay, debugging, reproducible simulation.

Non-goals for the initial release (§5): industrial FEM, certified safety-critical simulation,
CFD, CAD geometric kernel, full game editor, exact all-scale real-world simulation.

The defining object model (Part XIII): `Object → Transform / Appearance / Motion / Animation /
Physics / Interaction`. Promise: _"Create once. Position anywhere. Animate naturally. Simulate
physically. Render everywhere."_

## 5. Architecture reference by spec part

### Part I — Core Scene Architecture (§6–8, incl. 6a/6b/7a/7b)

- **Unified `Node`** (§6): `id`, `name`, `parent`/`children`, `transform`, `visible`,
  `enabled`, `opacity`, `tags`, `metadata`, `add/remove/traverse`. The base Node stays
  lightweight; behavior attaches via **typed components** or subclasses. Nodes optionally
  participate in rendering, animation, input, physics, layout, audio, serialization.
- **Component model** (§6a): `addComponent`/`getComponent(type)`/`removeComponent`, one
  component per type per node, explicit lifecycle (`onAttach`/`onDetach`/`dispose`).
  `RigidBody`, colliders, and `MotionComponent` are components, not Node subclasses.
- **Eventing** (§6b): one typed `EventEmitter` for nodes and the application; `on` returns
  an unsubscriber; input events propagate capture→target→bubble; physics events dispatch
  after each fixed step (§39 step 9, following the sensor update), never during the solver
  step.
- **Conventions** (§7a/§7b): right-handed **Y-up world in both 2D and 3D** (2D gravity is
  negative Y); CCW front faces; radians in all APIs; **all engine times are seconds**;
  math types are mutable, in-place methods return `this`, hot paths take `out` parameters,
  no steady-state per-frame allocation.
- **Transform** (§7): always full 3D (`position`/`rotation` quaternion/`scale`/`pivot`,
  local/world `Matrix4`, `matrixAutoUpdate`, `version`). 2D nodes simply use `position.z = 0`,
  `scale.z = 1` — one hierarchy serves 2D scenes, 3D scenes, UI, billboards, physics bodies,
  skeletons.
- **Space modes** (§8): `world | screen | viewport | camera | billboard | local-plane`.
  Physics operates in world/local-plane space; screen-space UI does not join simulation unless
  explicitly mapped to a plane.

### Part II — Time and Motion (§9–13)

- **`TimeState`** (§9): `realTime`, `renderTime`, `simulationTime`, `deltaTime`,
  `unscaledDeltaTime`, `fixedDeltaTime`, `timeScale`, `paused`, `interpolationAlpha`,
  `frame`, `simulationStep`, `droppedTime`. Time domains: real, render, simulation, scaled,
  unscaled (animation time is clip-local, on players/timelines). All fields are seconds.
- **Main loop** (§10): separate `fixedUpdate` (physics), `update` (animation/controls), and
  `render` events. Canonical fixed-step accumulator, **clamped at `maximumSubSteps`**
  (default 5, Appendix A): excess time after a long frame is dropped (recorded in
  `droppedTime` + diagnostics warning) so simulation cost stays bounded;
  `alpha = accumulator/fixedDeltaTime` stays in [0, 1]. This buys stable physics, smooth
  rendering, deterministic playback, pause/step, slow motion, replay.
- **`MotionComponent`** (§11): linear/angular velocity and acceleration, damping, max speeds —
  non-physics procedural motion and the bridge to physics solvers.
- **Kinematics** (§12): `moveTo`/`rotateTo`/`followPath`; steering, look-at, orbit, spline,
  camera rigs, character controllers, motion limits.
- **`Trajectory`** (§13): sample position/velocity/acceleration by time. Built-ins: linear,
  parabolic, circular, elliptical, Bézier, Catmull-Rom, ballistic, damped spring, custom.

### Part III — Animation (§14–19)

- Tween API: `Four.animate(obj).to({...}, seconds).ease("cubic-out").play()` — durations are
  **seconds**, not milliseconds (§7a, §15); 12 easing families including spring/bounce/
  elastic.
- `Timeline` (§16): `.at(time, tween|callback)`, nesting, labels, markers, parallel tracks,
  looping, reversing, scrubbing, speed, **deterministic evaluation**. Value tracks are a pure
  function of timeline time; callbacks are markers that fire once per forward crossing and
  are suppressed on seek/scrub by default; same-property conflicts: last-started wins + dev
  warning.
- `AnimationClip`/`AnimationTrack` (§17): track types scalar/vector/quaternion/color/Boolean/
  discrete/morph/skeletal/custom; interpolation step/linear/cubic/Hermite/slerp.
- Animation state machines (§18): states, condition-based transitions
  (`{ from: "idle", to: "walk", when: "speed > 0.1" }`), blend trees, layers.
- **Physics-animation blending** (§19): governed by **transform authority** (§42) — the
  `"blended"` authority selects this pipeline, with `physicsWeight`/`animationWeight`.
  Canonical pipeline: animation target pose → kinematic modification → physics solve →
  interpolated render pose → optional blend. (There is no separate `MotionAuthority` enum.)

### Part IV — Physics (§20–37)

- Stable, renderer-independent API; users never write solver-specific code for common tasks
  (§20). `new Four.PhysicsWorld({ dimension, gravity, solver: "auto" })`.
- Dimensions `"2d" | "3d"` with parallel naming/semantics (§21).
- Body types: `static | dynamic | kinematic-position | kinematic-velocity` (§22).
- `RigidBody` (§23): mass, inertia, velocities, damping, `gravityScale`, sleeping, CCD,
  `applyForce/ForceAtPoint/Torque/Impulse/ImpulseAtPoint/AngularImpulse`. `mass` is
  authoritative (`inverseMass` read-only derived; omitted mass = density × volume);
  `sleeping` is read-only with explicit `wake()`/`sleep()`; it is a **component** (§6a).
- Colliders (§24): shape + offset, friction/restitution/density, `sensor`, collision
  groups/masks. 2D shapes: circle, rectangle, capsule, polygon, polyline, chain, compound.
  3D: sphere, box, capsule, cylinder, cone, convex hull, trimesh, height field, compound.
- `PhysicsMaterial` (§25) with combine modes `average | minimum | maximum | multiply`.
- Forces/impulses and force generators (§26); `ForceField.sample(position, velocity, time)`
  with built-ins uniform/radial gravity, vortex, wind, drag, turbulence, spring, callback,
  GPU (§27).
- Joints (§28): fixed, distance, spring, revolute/hinge, prismatic/slider, spherical/ball,
  rope, gear, motorized — with limits, motors, springs, damping, break force/torque.
- Collision events (§29): `collisionstart/stay/end`, `triggerenter/exit` with contacts,
  relative velocity, total impulse.
- Queries (§30): `raycast`, `shapeCast`, `overlapSphere/Box`, `pointQuery`, with
  groups/masks/filters, first/all/sorted hits.
- CCD modes `disabled | speculative | swept` (§31); sleeping thresholds (§32).
- **Determinism** (§33): tiers `none | same-runtime | same-platform | cross-platform`; initial
  target is **same-runtime** determinism (same solver, timestep, input sequence, no
  nondeterministic multithreaded paths). Seeded RNG, recorded inputs, snapshots, replay,
  rollback, checksums.
- Snapshots/replay (§34): `world.createSnapshot()` / `restoreSnapshot()`; replay format stores
  initial state, solver settings, timestep, seed, inputs, optional periodic snapshots.
- Soft bodies/deformables (§35), particles (§36).
- **`PhysicsSolverAdapter`** (§37): `name`, `version`, `capabilities`
  (`PhysicsCapabilities`: dimensions, joint types, CCD modes, determinism tier, snapshot and
  query support), `initialize`, `create/destroy` for bodies/colliders/joints, `step`,
  `drainEvents` (events pulled after `step`, never callbacks from inside it),
  `syncSceneToSolver`/`syncSolverToScene`, the §30 query set (`raycast`/`shapeCast`/
  `overlap`/`pointQuery`), optional `createSnapshot`/`restoreSnapshot`, `dispose`. The
  stable fourJS API sits **above** adapters (Rapier, Box2D, Matter.js, Cannon-es, Ammo.js,
  custom solvers are candidates).

### Part V — Numerical Integration and Simulation (§38–41)

- Built-in lightweight integrators: `explicit-euler | semi-implicit-euler | velocity-verlet |
rk2 | rk4`. Defaults: semi-implicit Euler (rigid real-time), velocity Verlet (conservative
  particles), RK4 (small accurate engineering demos). Solver adapters use their own methods.
- `SimulationSystem` (§39) with explicit, configurable priority ordering: input → commands →
  animation targets → kinematics → forces → physics solve → constraints → collision events →
  sensors → snapshot → render interpolation.
- **Units** (§40): never silently assume 1 unit = 1 meter; `UnitSystem` declares length/mass/
  time/angle and scale factors. Physics default: meter, kilogram, second, radian.
- Numerical stability guidance (§41) is a documentation requirement; diagnostics should warn
  about suspicious values (mass ratios, extreme scales, etc.).

### Part VI — Rendering and Motion Synchronization (§42–44)

- **`TransformAuthority`** (§42): `manual | animation | kinematic | physics | blended |
constraint | network`. Exactly one system owns a node's transform; `"blended"` selects the
  §19 pipeline as that single owner; conflicts produce development warnings, never silent
  overwrites.
- Physics-to-render sync (§43): fixed-rate physics, any-rate rendering; positions lerp between
  previous/current physics state by `interpolationAlpha`, rotations slerp. Render transforms
  never feed back into physics unless explicitly requested.
- Camera motion (§44) uses the same timeline/constraint/motion systems as ordinary nodes.

### Part VII — Graphics, Rendering, Application, Platform (§45–97)

- **Application model** (§45): `Four.Application` owns scene, renderer, time, scheduler,
  input, assets, diagnostics, cameras, viewports; lifecycle `initialize/start/stop/pause/
resume/step/resize/dispose`. Advanced users may construct systems independently — the
  wrapper is a convenience, not a requirement.
- Scene queries (§46): `findById/Name/Tag/Component`, selector syntax
  (`scene.query("Mesh.dynamic[visible=true]")`); symbolic **layers** compile to masks but keep
  human-readable names in APIs and serialized files.
- Cameras (§47): Perspective, Orthographic, Screen (top-left/bottom-left/centered origins),
  Oblique, custom projection; rigs (orbit, fly, first-person, trackball, follow, spring arm,
  XR extension point, shake).
- Viewports (§48): camera → rect region + optional render target; split-screen, minimaps, CAD
  views, picture-in-picture, offscreen textures, portals.
- Renderable hierarchy (§49): `Renderable` (material, renderLayer, renderOrder,
  depthMode, shadows, frustumCulled) → `Shape2D` (Circle, Ellipse, Rectangle,
  RoundedRectangle, Polygon, Polyline, Arc, Path), `Sprite`, `Text`, `Mesh`, `Line3D`,
  `PointCloud`, `ParticleSystem`, `CustomRenderable`.
- Native 2D shapes (§50) with full fill/stroke model, Boolean ops, analytic hit testing, SVG
  import/export. Path model (§51): moveTo/lineTo/quadratic/cubic/arc/close plus flatten,
  simplify, offset, length, point/tangent/normal evaluation, closest point, union/intersect/
  subtract/xor; fill rules nonzero and even-odd.
- **Tessellation** (§52) is an isolated, replaceable **module of `@fourjs/geometry`** with a
  stable interface (concave polygons, holes, adaptive subdivision, stroke expansion, AA
  fringe, incremental rebuild).
- Geometry (§53): `Geometry2D` (path/fill/stroke) and `Geometry3D` (buffer/indexed/
  procedural); 11 3D primitives; standard attributes including instance transforms.
- Mesh/instancing/LOD (§54); sprites with atlases, nine-slice, billboarding (§55).
- **Text is a core capability** (§56): Unicode, bidi, shaping, wrapping, rich spans, text on
  paths, bitmap/SDF/MSDF rendering, accessible semantic mirror.
- Materials (§57): unified `Material` base; families Shape/Sprite/Text/Line/Unlit/Standard/
  Physical/Shader/Node/Compute. Paints (§58): solid, linear/radial/conic gradients, patterns,
  procedural shaders, render-target textures; full `StrokeStyle`. `StandardMaterial` (§59) is
  glTF-compatible metallic-roughness.
- **Node-material shader system** (§60): backend-independent; compiles to WGSL
  (WebGPU) and GLSL ES (WebGL 2) with reduced Canvas/SVG fallbacks.
- Renderer interface (§61); backends and capability tiers (§62): auto-selection prefers
  WebGPU → WebGL 2 → 2D backend; capability reporting; apps declare required/optional
  capabilities.
- **Render graph** (§63): DAG of passes (scene prep → depth prepass → shadows → opaque →
  transparent → world-space vectors/text → post-processing → screen-space UI → composite)
  managing transient targets, lifetimes, barriers.
- Render pipeline stages (§64): traversal → visibility/layers → culling → render items →
  sorting → batching/instancing → command encoding → submission. Avoid per-node virtual calls
  in the hot path; compile renderables into compact render items.
- Batching (§65) is automatic but inspectable. Sort order (§66): layer →
  opaque/transparent → pipeline/material → depth → explicit order.
- Clipping/masks/stencils (§67) including 3D clipping planes and engineering
  section views.
- Lighting (§68), shadows (§69), post-processing (§70).
- **Unified 2D/3D picking** (§71): `hitTestMode = "bounds" | "geometry" | "pixel" | "gpu" |
"custom"`; engine picks the cheapest valid method.
- Input (§72): DOM-mirroring capture → target → bubble phases; pointer capture across mixed
  2D/3D.
- Retained-mode UI (§73–75): `@fourjs/ui` controls are scene nodes; layout modes absolute/
  stack/flex/grid/anchor/constraints; **accessibility via a hidden DOM mirror** (roles,
  labels, keyboard nav, focus, reduced motion, high contrast).
- Assets (§76–78): declarative `app.assets.load({...})`; dedup, caching, refcounting,
  streaming, worker decoding, hot reload; glTF/GLB is the model format.
- **Serialization** (§79–80): `.four.json` (human-readable) and `.four` (binary); versioned,
  deterministic, diff-friendly, preserves unknown extension data; physics/animation/replay
  state are separate optional sections. Scene-format versioning is independent of package
  semver; migrations are explicit, testable, deterministic, composable.
- Plugins (§81): `FourPlugin` with install/uninstall; extension points include render passes,
  backends, asset formats, materials, physics solvers, UI controls, serialization types.
- GPU compute (§82) is optional — basic graphics/physics must not require it.
- Resource lifecycle (§83): explicit `dispose()` everywhere plus ownership tracking; dev
  warnings for leaks, stale handles, per-frame allocation storms.
- Diagnostics (§84): `app.stats.*` (cpu/gpu frame time, draw calls, contacts, memory…) and a
  long list of debug overlays (colliders, contacts, joints, overdraw, batch boundaries…).
- Validation (§85): dev builds detect NaN, singular transforms, graph cycles, authority
  conflicts, impossible mass/inertia, version mismatches; production keeps essential checks.
- Performance targets (§86, benchmark goals): 100k batched sprites @60fps, 50k shapes, 5k UI
  nodes, 20k animated glyphs, 25k CPU / 100k+ GPU particles, 5k active rigid bodies,
  near-zero idle work, and a **payload budget**: minimal 2D app (core + math + scene +
  render-webgl) ≤ 150 kB gzip.
- Spatial indexing (§87): systems may keep specialized indices; the public scene graph is
  never forced to mirror a spatial tree.
- Threading (§88): main-thread mode, worker-rendering mode (OffscreenCanvas), split-simulation
  mode. MVP may be main-thread only, but **APIs must not preclude worker migration**.
- Errors (§89): `FourError` with `code` (e.g. `RENDERER_INITIALIZATION_FAILED`,
  `PHYSICS_SOLVER_FAILED`), `context`, `cause`; recoverable failures report via events.
- Versioning (§90): semver; published compatibility tables (browsers, GPU tiers, solvers,
  scene formats, plugin API).
- Security (§96): asset loaders and deserializers treat all external content as untrusted —
  bounds checks, size/decompression limits, no code execution from scene files, safe
  shader/plugin boundaries, decoder timeouts.
- §97 is a complete mixed-scene example (3D physics cube + billboard label + screen-space UI
  panel applying impulses) worth reading as the canonical "feel" of the API.

### Part VIII — Package Architecture (§98–102)

See §7 below (package map).

### Part IX — Implementation Plan (§103–113 = Phases 0–10)

| Phase               | Scope                                                                                                                                                                                                                                                                                                     | Exit criterion                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 0                   | Root files: `package.json`, `bun.lock`, `bunfig.toml`, `tsconfig.base.json`, `.oxlintrc.json`, `.github/workflows/ci.yml`, CONTRIBUTING, CODE_OF_CONDUCT, ROADMAP — plus the implementation plan, which lives at `docs/plans/IMPLEMENTATION_PLAN.md` (owner decision; §103 names the file without a path) | Monorepo installs; packages compile; tests run; docs build; example starts      |
| 1                   | Vector2/3/4, Matrix3/4, Quaternion, Transform, Node, Group, Scene, component model (§6a), EventEmitter (§6b), Clock, TimeState, fixed-step scheduler, dirty transform propagation                                                                                                                         | Scene graph deterministically steps **without a renderer**                      |
| 2                   | MotionComponent, kinematic controller, paths, trajectories, spring motion, transform authority, interpolation buffers                                                                                                                                                                                     | Motion is deterministic, renderer-independent, unit tested                      |
| 3                   | Renderer interface, **WebGL 2 backend**, cameras, render list, buffers, shaders, textures, viewports, interpolation-aware rendering                                                                                                                                                                       | Moving 2D/3D primitives render smoothly under fixed-step simulation             |
| 4                   | Tween, easing, Timeline, AnimationClip/Track, property binding, deterministic evaluation                                                                                                                                                                                                                  | Any numeric/vector/quaternion/color/transform property is animatable            |
| 5                   | PhysicsWorld, RigidBody, Collider, materials, forces, collision events, raycasts, sync, debug draw — **first adapter: Rapier** (modern WASM, covers 2D+3D)                                                                                                                                                | Mixed 2D/3D demo with gravity, collisions, impulses, sensors via the common API |
| 6                   | Joints (fixed/distance/spring/hinge/slider/spherical), motors, limits, break thresholds                                                                                                                                                                                                                   | Constraints stable under real-time loads                                        |
| 7                   | Transform authority (§42), kinematic↔dynamic transitions, ragdoll, blended poses, root motion                                                                                                                                                                                                             | Animated↔kinematic↔physical control without discontinuities                     |
| 8                   | Steering, flocking, IK, trajectory prediction, spring-damper, **PID controller utility**                                                                                                                                                                                                                  | — (plan-defined exit pending owner confirmation)                                |
| 9                   | Particle emitters, CPU + GPU compute simulation, force fields, trails                                                                                                                                                                                                                                     | 100k simple particles at interactive rates                                      |
| 10                  | Snapshots, input recording, replay, checksums, frame stepping, solver stats                                                                                                                                                                                                                               | A physics defect can be captured, replayed, inspected frame by frame            |
| 3a (§106a, rev 1.5) | Input routing, picking, dragging, sprites, MVP-tier text                                                                                                                                                                                                                                                  | Pointer events, picking, dragging, sprites, labels in a mixed 2D/3D example     |
| 11 (§113a, rev 1.5) | Assets/glTF, serialization+migration, UI MVP subset, benchmark harness, docs                                                                                                                                                                                                                              | Scene saves/reloads/benchmarks; §120 tooling complete                           |

### Parts X–XIII

- Part X (§114–117): canonical public API examples — animated circle, dynamic
  ball, motorized hinge, physics/animation blend with impact-triggered ragdoll.
- Part XI (§118–119): flagship demos — _"One Scene, Everything Moves"_ (success
  criterion: "one motion-capable engine, not a graphics library with physics bolted on") and
  the _Electric Motor Digital Twin_ engineering demo (PID speed control, fault injection,
  torque overlays, replay).
- Part XII (§120): **Revised MVP** — Node/Group/Scene/Transform/cameras/layers;
  clock + fixed-step + MotionComponent + path motion + interpolation; Tween/easing/Timeline/
  transform tracks; PhysicsWorld with 2D+3D descriptors, static/dynamic/kinematic bodies,
  basic colliders, gravity/forces/impulses, collision events, raycasts, **one solver
  adapter**, debug drawing; **WebGL 2 only**, 2D primitives, basic meshes, lighting, sprites,
  text; pointer events, 2D picking, 3D raycasting, dragging; tests, examples, API docs,
  benchmark harness, deterministic simulation tests.
- Part XIII: final design statement (object model + promise, quoted in §4 above).

## 6. Toolchain, standards, and testing (spec §91–95)

When implementation begins, the prescribed baseline is: **strict TypeScript** (no implicit
`any`), **ESM**, **Bun workspace**, **Vitest**, **Playwright**,
**ESLint**, **Prettier**, **API Extractor or TypeDoc**, **Vite**, **Changesets**, **GitHub
Actions**. Requirements: documented public APIs, tree-shakable modules, package-boundary
checks, browser compatibility matrix, changelogs.

Test taxonomy (§92):

- **Unit**: math (vectors/matrices/quaternions), transforms, scene graph, clocks/scheduling,
  animation interpolation, geometry generation, path ops, serialization, physics descriptor/
  adapter normalization.
- **Integration**: scene+renderer, fixed-step physics + interpolated rendering, 2D/3D
  picking, assets+materials, animation-to-physics transitions, UI focus/accessibility bridge.
- **Visual regression**: fills/strokes, joins/caps, transparency, materials/lighting, text
  layout, clipping, mixed 2D/3D ordering, debug overlays.
- **Determinism**: identical input stream ⇒ identical checksums; snapshot restore reproduces
  subsequent states; replay stable within the declared tier.
- **Performance**: CPU/GPU/simulation time, draw calls, contacts, memory, allocations,
  loading throughput.

Release roadmap (§94): 0.1 math/scene/time/basic WebGL → 0.2 2D shapes/sprites/text/picking →
0.3 meshes/materials/lights/shadows → 0.4 motion/tweens/timelines → 0.5 first physics adapter
→ 0.6 joints/motors/blending/replay → 0.7 assets/glTF/serialization/UI/accessibility →
0.8 WebGPU preview/render graph/compute/workers → 0.9 optimization/stabilization → 1.0 stable
API + scene format + compatibility policy.

Governance (§95): lead-maintainer model; **major architectural changes require an RFC/ADR**
(context, decision, alternatives, consequences, compatibility analysis, prototype/benchmark
where practical, maintainer approval).

## 7. Package map (`packages/`)

All packages are `@fourjs/`-scoped. The scaffold matches §98 (Proposed Monorepo) exactly —
24 packages plus the top-level dirs `examples/`, `benchmarks/`, `docs/`, `tests/`, `tools/`,
`website/`.

| Package                                                        | Layer / responsibility                                                                                                                                                                                                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core`                                                         | Foundation: eventing (§6b), component model (§6a), unit system (§40), plugin host (§81), `FourError` (§89), lifecycle/validation infrastructure                                                                                                       |
| `math`                                                         | Vector2/3/4, Matrix3/4, Quaternion, Transform math; math conventions (§7b)                                                                                                                                                                            |
| `scene`                                                        | Node, Group, Scene, transforms, layers, queries                                                                                                                                                                                                       |
| `motion`                                                       | Clocks, fixed-step scheduler, MotionComponent, velocity/acceleration, kinematic controllers, path following, **camera rigs/controls** (§44, §47), trajectories, spring motion, steering, interpolation, **transform authority** (§99, Motion Package) |
| `animation`                                                    | Tweens, easing, timelines, clips, tracks, state machines, blend trees, skeletons, IK, physics-animation blending (§100, Animation Package)                                                                                                            |
| `physics`                                                      | **Stable public API**: body/collider descriptors, materials, constraints, joints, force fields, queries, event normalization, solver adapters, snapshots, unit application (unit system lives in `core`), debug data (§101, Physics Package)          |
| `physics-rapier`, `physics-box2d`                              | Solver adapters implementing the shared adapter interface, declaring capability differences (§102, Solver Packages). _No `physics-matter`/`physics-cannon` — see ERRATA E-3._                                                                         |
| `physics-soft`                                                 | Soft bodies and deformables (not a solver adapter)                                                                                                                                                                                                    |
| `particles`                                                    | Particle emitters and simulation                                                                                                                                                                                                                      |
| `geometry`                                                     | 2D/3D geometry, path model, tessellation module (§52)                                                                                                                                                                                                 |
| `materials`                                                    | Material families, paints, node materials                                                                                                                                                                                                             |
| `render`                                                       | Backend-independent renderer interface, render graph                                                                                                                                                                                                  |
| `render-webgpu`, `render-webgl`, `render-canvas`, `render-svg` | Rendering backends                                                                                                                                                                                                                                    |
| `input`                                                        | Pointer/keyboard/gamepad input, event propagation, picking                                                                                                                                                                                            |
| `assets`                                                       | Asset manager, loaders (glTF, images, fonts)                                                                                                                                                                                                          |
| `text`                                                         | Typography, shaping, SDF rendering                                                                                                                                                                                                                    |
| `ui`                                                           | Retained-mode UI controls, layout, accessibility mirror                                                                                                                                                                                               |
| `serialization`                                                | `.four.json` / `.four` formats, migration                                                                                                                                                                                                             |
| `diagnostics`                                                  | Stats, debug overlays, validation warnings                                                                                                                                                                                                            |
| `four`                                                         | Umbrella package (the `import * as Four from "fourJS"` surface); hosts the §45 `Application` composition root (rev 1.4)                                                                                                                               |

Dependency direction to preserve: `math`/`core` at the bottom; `scene`, `motion`, `animation`
above them; `physics` defines the API that `physics-*` adapters implement; `render` defines
the interface that `render-*` backends implement; the logical scene never depends on a
concrete backend; `four` aggregates everything.

## 8. Rules and guardrails for agents

1. **Don't fabricate tooling.** There is no build/lint/test today. If asked to "run the
   tests", explain the repo state instead of inventing commands.
2. **`SPECIFICATION.md` is the working reference; the PDF is the unmodified original.** The
   Markdown was corrected and then revised by owner decision (see the amendments table) —
   don't edit the PDF, and don't reintroduce its dual numbering. Substantive spec changes
   need an owner decision, recorded in the spec's **amendments table**; § numbering 1–120 is
   frozen (new sections use letter suffixes). `docs/ERRATA.md` covers only PDF extraction
   defects. Run `bun tools/check-spec.mjs` (or `bun run check-spec`) after spec edits.
3. **Plain "§N" means `SPECIFICATION.md` numbering.** When citing the PDF, say so explicitly
   and translate through the ERRATA numbering map (PDF second-range §45–67 = §98–120). Keep
   `docs/ERRATA.md` updated if new defects are genuinely discovered (check its "non-defects"
   list first).
4. **Respect ERRATA E-3**: no `physics-matter`/`physics-cannon` packages without a spec
   amendment decision from the owner.
5. **Match the scaffold to the spec.** New top-level directories or packages need a basis in
   §98 (Proposed Monorepo) or an explicit owner decision (RFC/ADR per §95 once governance is
   live).
6. **When implementing, follow the phase order** (Part IX): math/scene/time before motion,
   motion before rendering, rendering before animation core, physics API + Rapier adapter
   before joints, etc. Each phase has exit criteria — treat them as definitions of done.
7. **Determinism is a feature, not an afterthought**: fixed-step accumulator loop, seeded
   RNG, no wall-clock in simulation code, deterministic timeline evaluation, checksum tests.
8. **Honor single-authority transforms**: any system writing to a transform must go through
   the transform-authority model; conflicts warn in development.
9. **Keep the stable-API/adapter split**: application code (and examples/tests) targets
   `@fourjs/physics` and `@fourjs/render` interfaces, never a specific solver or backend, except
   inside adapter/backend packages themselves.
10. **Units are explicit** (§40): default meter/kilogram/second/radian, but never hard-code
    the assumption that 1 unit = 1 meter into APIs.
11. **Security posture** (§96): treat scene files, assets, and any deserialized content as
    untrusted input.
12. **Keep the tracking files current**: read `MEMORY.md` and `TODO.md` at the start of a
    work session; record new decisions in `MEMORY.md`, task movement in `TODO.md`, and
    substantive changes in `CHANGELOG.md` before finishing.
