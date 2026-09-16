# fourJS - Component Reference

**Version**: Unreleased (implementation plan complete — Phases 0–11 closed per `MEMORY.md`; §120 MVP at 43/43 shipped-or-MVP after the 2026-08-04 lighting packet)
**Last Updated**: 2026-08-05

Companion documents: [ARCHITECTURE.md](./ARCHITECTURE.md) (system design), [OVERVIEW.md](./OVERVIEW.md) (orientation), [DATAFLOW.md](./DATAFLOW.md) (runtime flows), [API.md](./API.md) (API surface), [TEST_COVERAGE.md](./TEST_COVERAGE.md) (test counts). Plain `§N` citations refer to [`docs/SPECIFICATION.md`](../SPECIFICATION.md). Every export named below is verified against [`package-export-surfaces.json`](./package-export-surfaces.json) (generated 2026-08-05); the dependency edges are the frozen §3.1 matrix from [`docs/plans/IMPLEMENTATION_PLAN.md`](../plans/IMPLEMENTATION_PLAN.md).

---

## Table of Contents

1. [Overview](#overview)
2. [The §6a Component Model](#the-6a-component-model)
3. [Node Types](#node-types)
4. [Foundation Layer](#foundation-layer)
5. [Scene & Time Layer](#scene--time-layer)
6. [Motion & Animation Layer](#motion--animation-layer)
7. [Physics Layer](#physics-layer)
8. [Rendering Layer](#rendering-layer)
9. [Application Layer](#application-layer)
10. [Package Dependencies](#package-dependencies)

---

## Overview

fourJS is a Bun workspace of 24 `@fourjs/`-scoped packages (the umbrella is plain `four`), layered strictly by the §3.1 dependency matrix — never add or reverse an edge:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Application   │  four · input · assets · text · ui · serialization ·   │
│                │  diagnostics                                           │
├─────────────────────────────────────────────────────────────────────────┤
│  Rendering     │  geometry · materials · render (interface) ·           │
│                │  render-webgl · [render-webgpu · render-canvas ·       │
│                │  render-svg — reserved stubs]                          │
├─────────────────────────────────────────────────────────────────────────┤
│  Physics       │  physics (stable API) · physics-rapier (adapter) ·     │
│                │  particles · [physics-box2d · physics-soft — stubs]    │
├─────────────────────────────────────────────────────────────────────────┤
│  Motion &      │  motion (time, §10 loop, §39 registry, kinematics) ·   │
│  Animation     │  animation (tweens, timelines, clips, mixer)           │
├─────────────────────────────────────────────────────────────────────────┤
│  Scene & Time  │  scene (nodes, transforms, §42 authority, cameras,     │
│                │  lights, §43 pose buffer)                              │
├─────────────────────────────────────────────────────────────────────────┤
│  Foundation    │  core (components, events, errors, RNG) · math         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Total** (from [`FILE_INVENTORY.md`](./FILE_INVENTORY.md), generated 2026-08-05): 335 tracked TypeScript files — 161 `src/`, 158 tests, plus tools/configs/examples. Zero orphans, zero runtime circular dependencies. Repo test counts as of the last recorded exit (`MEMORY.md`, 2026-08-04): 3,077 unit + 174 suite + 38 browser/visual tests; coverage ≥95% in every package; the §86 payload gate stands at 33.28 of 150 kB gzip.

**Implementation status**: 20 of 24 packages are implemented. Four are **reserved stubs** whose barrels export only `PACKAGE_NAME` (each holds a truthful README and a single smoke test): `physics-box2d`, `physics-soft`, `render-canvas`, `render-svg`. `@fourjs/render-webgpu` left that list 2026-08-21…29 (the R-1 plan). Each stub's entry below says what it is reserved for.

Conventions in force everywhere (§7a/§7b): right-handed **Y-up world in both 2D and 3D** (2D gravity is negative Y), radians, **all times in seconds**, mutable math types with `out`-parameter hot paths, deterministic iteration (insertion order, never hash-map order), no wall clocks or unseeded RNG in engine code (§33).

---

## The §6a Component Model

Behavior and state attach to nodes as **components**, keyed by class. The contract lives in `@fourjs/core` (`component.ts`) and `Node` delegates to a private `ComponentRegistry`:

```typescript
export interface ComponentHost {
  addComponent<T extends Component>(component: T): T;
  getComponent<T extends Component>(type: ComponentType<T>): T | undefined;
  removeComponent(component: Component): boolean;
}

export interface Component {
  readonly host: ComponentHost | null; // assigned only by the registry
  onAttach?(host: ComponentHost): void;
  onDetach?(host: ComponentHost): void;
  dispose?(): void;
}

export type ComponentType<T extends Component> = {
  readonly typeName: string; // registry key AND the §79 serialization name
  new (...args: never[]): T;
};
```

Rules (§6a, plan D2):

- **At most one component of a given type per host** — adding a second replaces the first with a development warning.
- Lifecycle is explicit: `onAttach` after registration, `onDetach` on removal or replacement; **detaching does not dispose**.
- Components are keyed by `static readonly typeName`, which doubles as the §79 serialization type name.

The components that ship today: `RigidBody` and `Collider` (`@fourjs/physics`), `MotionComponent` (`@fourjs/motion`), `PoseTarget` (`@fourjs/scene`, the §19 blending target). Joints are deliberately **not** components — they register on the world (`world.addJoint`, plan P6-3). Usage:

```typescript
const ball = new Group();
ball.transformAuthority = "physics"; // §42: the solver owns the pose
ball.addComponent(new RigidBody({ type: "dynamic" }));
ball.addComponent(new Collider({ shape: { type: "circle", radius: 0.5 } }));
world.addBody(ball);
```

---

## Node Types

Everything in the scene is a `Node` (single inheritance extending `EventEmitter<NodeEventMap>`, plan D1). The concrete node types, by owning package:

| Node type                                                      | Package             | Role                                                                                                             |
| -------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `Node` / `Group` / `Scene`                                     | `@fourjs/scene`     | Hierarchy base, plain container, root (§6, §46)                                                                  |
| `Bone`                                                         | `@fourjs/scene`     | §54 joint — an ordinary node; `Skeleton` is shared palette state, not a node                                     |
| `Camera` (abstract), `OrthographicCamera`, `PerspectiveCamera` | `@fourjs/scene`     | §47 cameras — a camera is a node (spec rev 1.3 placement)                                                        |
| `DirectionalLight`                                             | `@fourjs/scene`     | §68 MVP lighting — shines along its node's −Z world axis; scene-wide ambient is `Scene.ambientLight`, not a node |
| `Renderable`                                                   | `@fourjs/render`    | §49 geometry + material drawable                                                                                 |
| `Sprite`                                                       | `@fourjs/render`    | §55 textured quad (implements `Disposable`)                                                                      |
| `ParticleRenderable`                                           | `@fourjs/particles` | One node per particle system; satisfies `@fourjs/render`'s duck-typed `ParticleDrawable` contract                |
| `UIWidget` (abstract), `Panel`, `Button`, `Label`              | `@fourjs/ui`        | §73 widgets — scene nodes with a box model and interaction state; visuals are app-supplied (`WidgetSkin`)        |

---

## Foundation Layer

### @fourjs/core

**Purpose**: Dependency-free foundation — §6a component model, §6b eventing, error model, disposal, and the shared utilities hoisted here by the 2026-08-04 zero-findings sweep.

**Spec**: §6a, §6b, §83/§85 (errors/disposal), §33 (seeded RNG). **Direct deps**: none (wave 1). **Status**: implemented.

Key exports (19 total):

- **Component model** — `Component`, `ComponentHost`, `ComponentHostBinding`, `ComponentRegistry`, `ComponentType` (see [above](#the-6a-component-model)).
- **Eventing (§6b)** — `EventEmitter`, `EventListener`, `Unsubscribe`: the one typed event API nodes and the application share. Re-entrant emission queues-and-defers.
- **Errors (§89 codes)** — `FourError`, `FourErrorCode` (closed union — a typo is a compile error), `FourErrorOptions`, `isFourError`.
- **Disposal (§83)** — `Disposable`, `disposeAll`.
- **Hoisted utilities** — `SeededRandom` (xorshift128 with splitmix32 seeding; motion and particles re-export it, streams bit-identical), `JsonValue` + `cloneJsonValue` (refuses `__proto__` own keys with a `TypeError`), `DEFAULT_GRAVITY_Y`.

---

### @fourjs/math

**Purpose**: Math primitives per the §7b conventions — mutable types, `out?`-optional allocation policy (plan D7), radians, right-handed Y-up.

**Spec**: §7, §7b. **Direct deps**: none (wave 1). **Status**: implemented.

Key exports (12 total):

- **Types** — `Vector2`, `Vector3`, `Vector4`, `Quaternion` (shortest-arc slerp, plan D8), `Matrix3`, `Matrix4`, `ColorRGBA`, `DepthRange` (depth-range-parameterized projections, plan D8).
- **Allocation accounting** — `constructionCount`, `noteConstruction`, `resetConstructionCount`: test instrumentation backing the "steady state allocates nothing" claims elsewhere.

---

## Scene & Time Layer

### @fourjs/scene

**Purpose**: The shared scene graph all four pillars act on — nodes, transforms with dirty tracking, world-transform resolution, §42 transform authority, cameras, viewports, the §68 directional light, and the engine's single §43 previous/current pose store.

**Spec**: §6–8, §42–43, §46–48, §68 (MVP tier), §19 (`PoseTarget`). **Direct deps**: `core`, `math`. **Status**: implemented.

Key exports (33 total):

- **Hierarchy** — `Node`, `Group`, `Scene`, `NodeType`, `NodeEventMap` (an `interface` so other packages widen it by declaration merging — `@fourjs/input` does), `NodeHierarchyEvent`. `Node.position/rotation/scale` alias getters return the live `Transform` members (§15/§97 idiom).
- **Transforms** — `Transform` (dirty via math change-hooks + `markDirty`, plan D3), `resolveWorldTransform`, `resolveWorldTransforms`, `WorldTransformStats`. World matrices are version-cached: a frame that moved nothing recomputes nothing.
- **Authority (§42)** — `TransformAuthority` (`"manual" | "animation" | "kinematic" | "physics" | "blended" | "constraint" | "network"`), `TRANSFORM_AUTHORITIES`, `DEFAULT_TRANSFORM_AUTHORITY`, `AuthorityNode`, `warnAuthorityConflict`: conflicts warn and refuse rather than silently overwrite.
- **Cameras & viewports (§47–48)** — `Camera`, `OrthographicCamera`, `PerspectiveCamera`, `Viewport`, `createFullscreenViewport`.
- **Lighting (§68 MVP)** — `DirectionalLight`, `DirectionalLightOptions`, `ColorRGB`. One directional light + `Scene.ambientLight`; point/spot/area lights and shadows (§69) are staged with dated notes.
- **Pose interpolation (§43)** — `PoseBuffer`, `PoseSnapshotSystem`, `createSnapshotSystem`, `POSE_SNAPSHOT_PRIORITY` (1000 — duplicated from motion's `PRIORITY_SNAPSHOT` because scene must not depend on motion; a test pins the two equal). `PoseTarget` is the §19 blending target component with one-step finite-difference history. `Skeleton.update(skinRoot, worldOf?)` is how a skinned palette reaches those poses: the interpolated list supplies a `worldOf` that composes locals, then the palette product — palettes are never matrix-lerped.
- **Bones (§54)** — `Bone`, `Skeleton`, `MorphWeights` / `MORPH_WEIGHTS_SERIALIZER`.

---

## Motion & Animation Layer

### @fourjs/motion

**Purpose**: The time pillar — §9 `TimeState`, the §10 fixed-step scheduler, the §39 system registry and priority constants, `MotionComponent` + integrators, trajectories, and the §111 advanced-motion tier (PID, springs, steering, IK, prediction).

**Spec**: §9–§13, §38–§39, §111. **Direct deps**: `core`, `math`, `scene`. **Status**: implemented.

Key exports (selected from ~110):

```typescript
export class Scheduler {
  constructor(options?: SchedulerOptions); // fixedDeltaTime (1/60), maximumSubSteps (5)
  step(elapsedRealSeconds: number): void; // the §10 accumulator, verbatim
  onFixedStep?: SchedulerCallback;
  onUpdate?: SchedulerCallback;
  onRender?: SchedulerCallback;
  get time(): ReadonlyTimeState; // §9 — the live record, mutated in place
  timeScale: number; // preserved across pause/resume
  paused: boolean; // pause ≡ timeScale 0 for the frame
}

export class SystemRegistry {
  register(system: SimulationSystem): Unregister; // ascending priority, stable
  unregister(system: SimulationSystem): boolean;
  runFixedStep(time: ReadonlyTimeState): void; // re-entrancy throws (§34)
  attachToScheduler(scheduler: Scheduler): Detach; // D5's only seam
  dispose(): void; // reverse registry order
}

export interface SimulationSystem {
  priority: number; // read once, at registration
  initialize(context: SimulationContext): void;
  fixedUpdate(context: FixedUpdateContext): void;
  dispose(): void;
}
```

- **Time (§9)** — `TimeState`, `ReadonlyTimeState`, `createTimeState`, `copyTimeState`, `DEFAULT_FIXED_DELTA_TIME`, `DEFAULT_MAXIMUM_SUB_STEPS`: real, render, simulation, scaled and unscaled time plus `droppedTime` and `interpolationAlpha`.
- **§39 priority landmarks** (spaced by 100 for insertion): `PRIORITY_INPUT` 100, `PRIORITY_COMMANDS` 200, `PRIORITY_ANIMATION_TARGETS` 300, `PRIORITY_KINEMATICS` 400, `PRIORITY_FORCES` 500, `PRIORITY_PHYSICS_SOLVE` 600, `PRIORITY_CONSTRAINTS` 700, `PRIORITY_SENSOR_UPDATE` 800, `PRIORITY_EVENT_DISPATCH` 900, `PRIORITY_SNAPSHOT` 1000, `PRIORITY_RENDER_INTERPOLATION` 1100.
- **Kinematics** — `MotionComponent` (§11 verbatim: velocities, accelerations, damping, speed clamps) + `MotionSystem` (pinned semi-implicit Euler with damping and clamp between the half-updates; parent-frame angular premultiply); `KinematicController` + `KinematicSystem` (channel state machines; refused §42 writes freeze the command).
- **Integrators (§38)** — `explicitEuler`, `semiImplicitEuler`, `velocityVerlet`, `rk2`, `rk4`, `INTEGRATORS`, `DEFAULT_INTEGRATOR`.
- **Trajectories (§13)** — `LinearTrajectory`, `CircularTrajectory`, `EllipticalTrajectory`, `ParabolicTrajectory`, `BallisticTrajectory`, `CubicBezierTrajectory`, `CatmullRomTrajectory`, `DampedSpringTrajectory`, `ParametricTrajectory`.
- **§111 tier** — `PIDController` (conditional-integration anti-windup), `SpringDamper` (exact ZOH matrix-exponential step, unconditionally stable), steering (`seek`, `flee`, `arrive`, `pursue`, `evade`, `wander`, `separation`, `cohesion`, `alignment`, `SteeringAgent`), prediction (`predictLinear`, `predictBallistic`, `interceptTime`, `interceptPoint`), two-bone IK (`solveTwoBoneIK`, `createTwoBoneIKSolution`).

---

### @fourjs/animation

**Purpose**: The animation pillar — easing registry, property bindings, tweens, timelines, keyframe tracks/clips, and the clip mixer, all advanced on the fixed step by `AnimationSystem` (§39 step 3, priority 300 — deliberately before `MotionSystem` at 400 so the §19 pipeline order holds).

**Spec**: §14–§18, §39 step 3, §19 (feeds the blend). **Direct deps**: `core`, `math`, `scene`, `motion`. **Status**: implemented.

Key exports (selected from ~100):

- **Easing (§15)** — 34 named easing functions (`linear`, `quadraticIn/Out/InOut` … `springIn/Out/InOut`), `EASINGS`, `EASING_NAMES`, `resolveEasing`, plus the pinned constants (`BACK_OVERSHOOT`, `ELASTIC_PERIOD`, `SPRING_DAMPING_RATIO`, …).
- **Bindings** — `PropertyBinding`, `createBinding`, `claimProperty` / `releaseProperty` (the writer-agnostic last-started-wins claim registry shared by tween and mixer), `ValueAdapter` + `numberAdapter`/`vector2Adapter`/`vector3Adapter`/`vector4Adapter`/`quaternionAdapter` (slerp)/`colorAdapter`/`booleanAdapter`/`discreteAdapter`/`detectAdapter`. Paths resolve once; in-place writes preserve identity so `Transform` change-hooks fire.
- **Players** — `Tween` + `tween`/`animate` builders (repeat = extra cycles), `Timeline` (elapsed-space markers, `(from, to]` crossing, seek suppression + `replayOnSeek`), `AnimationTrack`, `AnimationClip` (§17 shape; cubic = Catmull-Rom; quaternion cubic rejected), `AnimationMixer` (`prepare()` + `play()`, translation-only root motion), `AnimationSystem` (tracks anything `Advanceable`; auto-untracks finished players). Durations are **seconds** — no milliseconds anywhere.

---

## Physics Layer

### @fourjs/physics

**Purpose**: The stable, solver-independent physics API — the `PhysicsWorld` pipeline, `RigidBody`/`Collider` components, joints, §30 queries, §29 events, §33 checksums, §34 snapshots — phrased entirely over the §37 `PhysicsSolverAdapter` seam, never over a concrete solver.

**Spec**: §19–§34, §37, §39 steps 6+9, §42–43. **Direct deps**: `core`, `math`, `scene`, `motion`. **Status**: implemented.

Key exports (selected from ~190):

```typescript
export class PhysicsWorld {
  constructor(options: PhysicsWorldOptions); // { dimension, adapter, poses? }
  initialize(): Promise<void>; // async: wasm solvers load here (§37)
  addBody(node: Node): void; // reads RigidBody + Collider components
  addJoint(descriptor: JointDescriptor): Joint; // joints register on the WORLD (P6-3)
  step(deltaSeconds: number): void; // pipeline steps 1–6 (see DATAFLOW.md)
  dispatchEvents(): void; // §39 step 9 — §29 events on node emitters
  capturePoseTargets(): void; // §19 history shift (priority 299 system)
  raycast(query: RaycastQuery): WorldRaycastHit[]; // §30, plus shapeCast/
  //   overlapSphere/overlapBox/pointQuery — filters via passesQueryFilter
  checksum(): number; // §33 uint32 FNV-1a, monotonic body-id order
  createSnapshot(): PhysicsSnapshot; // §34 { adapterName, adapterVersion, data }
  restoreSnapshot(snapshot: PhysicsSnapshot): void; // refuses foreign snapshots
}
```

- **Components (§6a)** — `RigidBody` (§22 `BodyType`, §19 `BlendWeights`, command buffer via `RigidBodyCommands`), `Collider` (`CollisionShape` unions per dimension: circle/rectangle/polygon in 2D, sphere/box/capsule in 3D; sensors; `PhysicsMaterial` with `combineFriction`/`combineRestitution`), plus descriptor validation (`validateRigidBodyDescriptor`, `validateColliderDescriptor`, …).
- **Systems** — `PhysicsSystem` (§39 step 6, `PRIORITY_PHYSICS_SOLVE` 600; steps every world, then dispatches every world's events), `createPoseTargetCaptureSystem` (`POSE_TARGET_CAPTURE_PRIORITY` 299 — **must** be registered by applications using §19 blending or velocity inheritance).
- **Joints (§28)** — `FixedJoint`, `RevoluteJoint`/`HingeJoint`, `PrismaticJoint`/`SliderJoint`, `SphericalJoint`/`BallJoint`, `RopeJoint`, `SpringJoint`, with `JointLimits`, `LinearJointMotor`/`AngularJointMotor`, breakage thresholds (`JointBreakEvent`), and `SHIPPED_JOINT_TYPES` vs `STAGED_JOINT_TYPES` (distance and gear staged loudly).
- **Adapter seams (§37)** — `PhysicsSolverAdapter`, `PhysicsCapabilities`, `SolverBodyAccess` and `SolverJointAccess` (engine seams beyond §37's sketch — required of every adapter), `PhysicsSnapshot` + `PhysicsSnapshotConfiguration` (restore refuses configuration mismatches field-by-field when present).
- **Events (§29)** — `CollisionEvent`/`RigidBodyCollisionEvent` (`collisionstart`/`collisionstay`/`collisionend`), `TriggerEvent`/`ColliderTriggerEvent`, `SleepEvent`/`RigidBodySleepEvent`, `JointBreakEvent`, merged into `RigidBodyEventMap`/`ColliderEventMap`/`JointEventMap`.

---

### @fourjs/physics-rapier

**Purpose**: The first solver adapter (Phase 5, §108) — Rapier 2D and 3D via `@dimforge/rapier*-compat@0.19.3` WebAssembly, implementing `PhysicsSolverAdapter` plus the `SolverBodyAccess`/`SolverJointAccess` seams.

**Spec**: §37, §102, §108. **Direct deps**: `physics` (+ `core`, `math` declared directly per WP-5.4-fix1). **Status**: implemented.

Key exports (selected from ~45): `Rapier2dAdapter`, `Rapier3dAdapter`, `RapierBodyAccess`, `initializeRapier2d`/`initializeRapier3d` (async wasm init inside `adapter.initialize()`), and the conversion helpers (`toRapierVector2/3`, `fromRapierVector2/3`, `toRapierRotation3`, `packInteractionGroups`, `resolveCcdMode`, …). Recorded capability facts: adapters own monotonic never-reused ids (§33 checksum order); `collisionstay` is adapter-derived from a touching-pair map; restitution combine forced to Max per Appendix A; `reportsJointReactions` is false (Rapier 0.19.3 has no reaction getters, so breakable joints are refused); motor `maxTorque`/`maxForce` is a force-based gain, not §28's hard cap (recorded deviation).

---

### @fourjs/physics-box2d — reserved stub

**Purpose**: Reserved for the Box2D 2D solver adapter per §102. **Direct deps** (declared): `physics`. **Status**: **stub — barrel exports only `PACKAGE_NAME`**; one smoke test. Kept so the §98 monorepo tree and §102 solver list stay accurate (ERRATA E-3: no `physics-matter`/`physics-cannon` without a spec amendment). One recorded motivation: Box2D could honor §28's motor force cap as a real hard cap, which Rapier cannot.

---

### @fourjs/physics-soft — reserved stub

**Purpose**: Reserved for §35 soft bodies and deformables (cloth, rope, pressure/volume models). **Not** a solver adapter. **Direct deps** (declared): `physics`. **Status**: **stub — barrel exports only `PACKAGE_NAME`**; no implementation phase has been scheduled for §35.

---

### @fourjs/particles

**Purpose**: Deterministic CPU particle simulation with force fields (§27, §36) — SoA `Float32Array` pools, seeded emission with a fixed RNG-draws-per-spawn contract, and a one-batched-render-item contract toward `@fourjs/render`.

**Spec**: §27, §36, §112 (100k target). **Direct deps**: `core`, `math`, `scene`. **Status**: implemented.

Key exports (selected from ~45): `ParticleSystem` (structurally satisfies motion's `SimulationSystem` — the dependency matrix forbids the edge, so the contract is duck-typed with drift caught by tests), `PRIORITY_PARTICLES` (500), `ParticleEmitter` (bursts, ranges, lifetime ramps; `PARTICLE_DRAWS_PER_SPAWN` fixed at 4 — dropped spawns burn none), `ParticlePool` (swap-remove SoA layout — a deterministic function of history, not insertion-ordered), `ParticleRenderable` (the scene node; implements render's `ParticleDrawable` contract structurally), and the §27 field factories: `uniformGravityField`, `dragField`, `windField`, `radialField` (inverse-square), `vortexField`, `turbulenceField` (bounded hash-noise curl — honestly not divergence-free), `volumeField` with `BoxFieldVolume`/`SphereFieldVolume`.

---

## Rendering Layer

### @fourjs/geometry

**Purpose**: Vertex data — `BufferGeometry` (positions, optional index, optional per-face `normals` since the lighting packet; finite-validated) and the MVP primitive factories.

**Spec**: §50–53 MVP tier, §7a. **Direct deps**: `core`, `math`. **Status**: implemented.

Key exports (12 total): `BufferGeometry`, `GeometryBounds`, `GeometryDrawMode`, `GeometryIndexArray`, `boxGeometry` (24 vertices, per-face normals), `planeGeometry` (+Z normals), `circleGeometry2D` (position-only, unlit tier).

---

### @fourjs/materials

**Purpose**: Surface appearance at the MVP tier — color-only materials carrying a `readonly kind` discriminant the render list picks pipelines from (no `instanceof` on the draw path).

**Spec**: §57–60 MVP tier, §60a (no color-space conversion, no clamping — the recorded stance). **Direct deps**: `core`, `math`. **Status**: implemented.

Key exports (9 total): `UnlitMaterial` (`kind: "unlit"`), `LitMaterial` (`kind: "lit"`, mirrors `UnlitMaterial` member-for-member; Lambert diffuse under the §68 MVP light — note §57's family list has no LitMaterial; recorded spec-revisit item), `SpriteMaterial` + `SpriteTexture`, `ColorRGBA` (re-export). §59 StandardMaterial/PBR staged.

---

### @fourjs/render

**Purpose**: The backend-independent renderer half — the §61 `Renderer` interface, §64 render-list construction (flat, sorted, pooled compact items), sprites and textures, §68 light collection, and the §43 interpolated list builder. The logical scene never depends on a concrete backend.

**Spec**: §61–66 MVP tier, §49, §55, §68, §43. **Direct deps**: `core`, `math`, `scene`, `geometry`, `materials`. **Status**: implemented.

Key exports (selected from ~40):

- **Interface (§61–62)** — `Renderer`, `RendererBackend`, `RendererCapabilities`, `RendererOptions`, `RendererEventMap`, `NullRenderer` (headless tier), `RenderInterpolation` (`{ poseBuffer, alpha }`).
- **Render list (§64/§66)** — `buildRenderList`, `buildInterpolatedRenderList` (§43 poses **and** skinned palettes via `Skeleton.update(..., worldOf)` — composed locals, never a lerp of `jointMatrices`), `RenderItem` discriminated by `RenderItemKind` (unlit / lit / sprite / particles / node / skinned-unlit / skinned-lit), sorted by render layer → opaque/transparent → explicit `renderOrder` → scene-graph order (deterministic, §33).
- **Drawables** — `Renderable` (§49), `Mesh` (§54, optional `skeleton`), `Sprite` + `Texture`/`TextureSource` (§55).
- **Lights (§68)** — `collectSceneLights`, `SceneLights`, `DirectionalLightSource`, `AmbientLightSource`, `isDirectionalLightSource` (duck-typed brand check — deliberate, so render-webgl's doubles-only tests can fake lights). First light in scene-graph DFS order wins; light collection runs only for frames whose list contains a lit item; lights are not §43-interpolated (dated trade).
- **Particle contract** — `ParticleDrawable`, `isParticleDrawable`, `particleQuadGeometry`, `PARTICLE_INSTANCE_FLOATS` and offsets: the duck-typed seam `@fourjs/particles` satisfies (the matrix forbids the edge in either direction).

---

### @fourjs/render-webgl

**Purpose**: The WebGL 2 backend — the §120 MVP renderer. Four programs (`UnlitProgram`, `LitProgram`, `SpriteProgram`, `ParticleProgram`), VAO-cached geometry, texture cache, instanced particle batching (6 GL calls/frame at any count), all over a 34-method structural GL seam so units run against fake GL.

**Spec**: §62 (backend 2), §86 (payload budget). **Direct deps**: `core`, `math`, `render`. **Status**: implemented.

Key exports (selected from ~30): `WebglRenderer`, `WebglContext`/`WebglCanvas` (structural seams — no DOM types), `GeometryCache`, `TextureCache`, `ParticleBatchCache`, `UnlitProgram`/`LitProgram`/`SpriteProgram`/`ParticleProgram`, `createLinkedProgram`, `POSITION_ATTRIBUTE_LOCATION` (0), `NORMAL_ATTRIBUTE_LOCATION` (1), `PARTICLE_ATTRIBUTE_LOCATIONS`. Lit shading: `lightColor` premultiplied by intensity CPU-side (black when no light — one shader, no variants); normal matrix computed in the vertex shader; fragment guards zero-length normals (ambient-only, never NaN).

---

### @fourjs/render-webgpu

**Purpose**: The WebGPU backend — §62 backend 1. `WebgpuRenderer` behind `registerWebgpuRenderer()`: unlit/sprite/lit/standard families, opt-in §65 batching, textures + samplers, §67 clips + §57 stencil parity, render targets / §70 effects / `readPixels`, the §69 directional shadow tier, §36 instanced particles, §82 compute, and §60 node materials + §70 graph effects behind `registerWebgpuNodeMaterialPipeline()`. Absent, not stubbed: RFC 0003's skinned pipelines and §71 picking. **Direct deps**: `core`, `math`, `scene`, `render`. **Status**: implemented (R-1, WP-R1.1–R1.9, 2026-08-21…29). This entry said "reserved stub" until 2026-08-30.

---

### @fourjs/render-canvas — reserved stub

**Purpose**: Reserved for the Canvas 2D backend (2D scenes and fallback rendering) per §62. **Direct deps** (declared): `core`, `math`, `render`. **Status**: **stub — barrel exports only `PACKAGE_NAME`**.

---

### @fourjs/render-svg — reserved stub

**Purpose**: Reserved for the SVG backend (vector output) per §62. **Direct deps** (declared): `core`, `math`, `render`. **Status**: **stub — barrel exports only `PACKAGE_NAME`**.

---

## Application Layer

### four (umbrella)

**Purpose**: The §45 `Application` composition root — the only API this package owns — plus one namespace re-export per workspace package (`Four.scene`, `Four.physics`, …). A renderer-free headless composition path ships as the `four/application` subpath.

**Spec**: §45, §98, §10 (loop), §39 (registry wiring). **Direct deps**: all 23 packages (wave 6). **Status**: implemented.

```typescript
export class Application extends EventEmitter<ApplicationEventMap> {
  constructor(options?: ApplicationOptions);
  readonly scene: Scene; // owned
  readonly scheduler: Scheduler; // §10; callbacks belong to Application
  readonly systems: SystemRegistry; // §39 — features register here (D5)
  readonly renderer: Renderer | null; // injected INSTANCE, never a string
  readonly views: Viewport[]; // §48, drawn in order; empty = draws nothing
  readonly poses: PoseBuffer; // §43 — empty until something tracks a node
  initialize(): Promise<void>; // idempotent; awaits renderer.initialize
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void; // pause ≡ timeScale 0
  step(elapsedSeconds: number): void; // the whole driver — host owns cadence
  dispose(): void; // terminal; renderer and scene NOT disposed (§83)
}
```

`ApplicationEventMap`: `fixedUpdate` (0..N per step, after systems ran), `update` (once, after world transforms resolve), `render` (once, last; the draw runs after the listeners). Recorded §45 departure: `renderer` takes an instance, not §45's string union — `"auto"` selection is deferred to a §62 registry so `four` never imports backends at runtime.

---

### @fourjs/input

**Purpose**: §71 picking and the §72 pointer subset — platform events in, `ScenePointerEvent`s propagated capture → target → bubble out. Never writes a transform (§42: input reports, the application decides).

**Spec**: §71, §72 (MVP subset — no wheel/gamepad/XR yet; keyboard landed 2026-08-07, `pointercancel` 2026-08-06). **Direct deps**: `core`, `math`, `scene`. **Status**: implemented.

Key exports: `PointerInput` (NDC normalization with the +Y-up flip, picking, capture, click/enter/leave synthesis, `pointercancel` teardown), `KeyboardInput` (duck-typed `KeySurface`, injected `focusTarget(): Node | null` resolver — focus stays `@fourjs/ui`'s; §3.1 unchanged), `SceneKeyEvent`/`dispatchKeyEvent` (with `preventDefault()` forwarded via `KeyDefaultSuppressor`), the shared three-phase machinery in `propagation.ts` (`SceneInputEvent`, `dispatchThreePhase`), `pick` + `createPickRay` + `Pickable`/`PickHit` (ray/AABB/oriented-box, nearest hit wins), `ScenePointerEvent`, `dispatchPointerEvent`, `buildPropagationPath`, `CAPTURE_KEY_PREFIX` (`"capture:"`-prefixed keys select the capture phase on the propagating types), `DragManager` (world-delta handoff to app callbacks), `PointerSurface`/`SurfacePointerEvent` (structural DOM seams). Widens scene's `NodeEventMap` by declaration merging — importing `@fourjs/input` adds pointer and key events to every node.

---

### @fourjs/assets

**Purpose**: The MVP asset tier — an `AssetManager` with a coalescing, refcounted cache and pluggable typed loaders.

**Spec**: §76–78 MVP tier (§113a). **Direct deps**: `core`. **Status**: implemented (glTF staged — needs §55 textures + non-unlit materials).

Key exports (13 total): `AssetManager`, `AssetLoader`, `textLoader`, `jsonLoader`, `binaryLoader`, `createImageLoader`, `ImageAsset` (disposal wrapper), plus the structural seams `FetchLike`/`FetchResponse`/`ImageBitmapLike`/`ImageDecodeLike`.

---

### @fourjs/text

**Purpose**: §56's MVP bitmap text tier — a built-in 6×12 font (95 glyphs), glyph atlases in exactly the shape `@fourjs/render`'s `TextureSource` accepts, and layout. **Produces data, never nodes** (deps are `core`, `math`, `geometry` only).

**Spec**: §56 MVP tier (full shaping staged behind a shaping-engine RFC). **Direct deps**: `core`, `math`, `geometry`. **Status**: implemented.

Key exports (17 total): `BitmapFont`, `createBitmapFont`, `BUILTIN_FONT`, `glyphFor`, `glyphPixel`, `glyphToAscii`, `buildGlyphAtlas`/`GlyphAtlas`, `layoutText`/`TextLayout`/`TextQuad`.

---

### @fourjs/ui

**Purpose**: Retained-mode UI at §113a's MVP tier — widgets are scene nodes with a box model, flex/stack/absolute layout, and §72-driven hover/press/focus state machines. **Widgets do not draw themselves**: the dependency matrix gives `ui` no `render`/`materials`/`geometry`, so visuals arrive through the app-supplied `WidgetSkin` seam.

**Spec**: §73–75 MVP tier. **Direct deps**: `core`, `math`, `scene`, `input`, `text`. **Status**: implemented (keyboard traversal + activation landed 2026-08-07; a11y DOM mirror staged — `UI_STAGED`).

Key exports (28 total): `UIWidget` (abstract `Node`), `Panel` + `PanelLayout` (`LayoutType` flex/stack/absolute, `LayoutDirection`, `LayoutAlign`, `LayoutJustify`, `Insets`/`applyInsets`), `Button`, `Label` (measures via `@fourjs/text`), `WidgetSkin` (four optional hooks), `collectPickables` (§71 candidates), `focusedWidget`, `isUIWidget`, `UI_LAYOUT_AUTHORITY` (`"constraint"` — layout writes under §42 constraint authority; a widget under other authority has its position write refused with a warning), events `WidgetActivateEvent` (`uiactivate`), `WidgetStateChangeEvent`, `UIFocusEvent`, `WidgetAccessibility`. Layout is explicit: `root.layout()` runs one measure + one arrange pass.

---

### @fourjs/serialization

**Purpose**: §79 scene documents — versioned, canonical, diff-friendly, byte-identical round trips — plus the §80 migration registry. Components cross the boundary through a serializer registry keyed by the component class's `typeName` (§6a's key is the §79 name).

**Spec**: §79–80 (§113a). **Direct deps**: `core`, `math`, `scene`. **Status**: implemented.

Key exports (selected from ~35): `serializeScene`, `instantiateScene`, `instantiateSceneNodes`, `SceneDocument` + `SceneNodeDocument`/`TransformDocument`/`ComponentDocument`, `SCENE_FORMAT_VERSION` (1), `encodeSceneDocument`/`decodeSceneDocument`, `validateSceneDocument` (canonical validation, prototype-pollution-safe), `ComponentSerializer` + `ComponentSerializerRegistry` + `createDefaultComponentSerializers` (`POSE_TARGET_SERIALIZER` ships here — the one component this package can see), `SceneMigration`/`SceneMigrationRegistry`/`migrateSceneDocument`/`runSceneMigrations`, `applyTransformDocument`. Known boundaries (recorded): components with no registered serializer **throw** on save (`unknownComponents: "throw"`, A-15; `"skip"` is opt-in); restored ids can collide with the live counter. Node classes other than `Scene`/`Group` need `registerSceneNodeTypes()` from the umbrella (or an equivalent `nodeTypeOf` / `nodeFactory` pair).

---

### @fourjs/diagnostics

**Purpose**: Determinism checksums, §34 record/replay, and debug-draw data. Depends only on `core`/`math`/`scene`, so it reaches physics through the duck-typed `ReplayTarget` contract that `PhysicsWorld` satisfies structurally.

**Spec**: §33–34, §41/§84–85 (data side), §113. **Direct deps**: `core`, `math`, `scene`. **Status**: implemented.

Key exports (selected from ~55):

- **Checksums (§33)** — `Checksum`, `createChecksum`, `hashFloats` (FNV-1a; golden vectors cross-checked in fresh processes).
- **Replay (§34)** — `ReplayRecorder` (`begin`/`recordInput`/`recordFrame`, `snapshotIntervalSteps`), `ReplayPlayer` (play/pause, `speed` slow motion, `advanceRealtime` with a sub-step clamp, `seekToStep` via nearest snapshot + re-simulation, `verifyChecksum`), `ReplayTarget`/`ReplaySnapshot` (duck-typed `PhysicsWorld` contract), `ReplayRecording` + `encodeReplayRecording`/`decodeReplayRecording` (versioned envelope — a document declares the lowest version that expresses it, canonical base64, `encode(decode(t)) === t`), `assertReplayCompatible`/`isReplayCompatible`, `LATEST_REPLAY_FORMAT_VERSION`/`MINIMUM_REPLAY_FORMAT_VERSION` (2026-08-07; `REPLAY_FORMAT_VERSION` is a deprecated alias).
- **Debug draw** — `DebugDrawBuffer` (7-floats-per-vertex line list), the seven `collect*` providers (`collectBodyOrigins`, `collectBodyVelocities`, `collectCentersOfMass`, `collectContactPoints`, `collectContactImpulses`, `solverStatistics`, `solverJointStatistics`) over duck-typed `Debug*Access` shapes — all seven verified against live Rapier; `DEBUG_DRAW_STAGED` names what is honestly staged (joint-anchor viz, force vectors, per-segment color).

---

## Package Dependencies

The frozen §3.1 matrix (direct workspace deps only; transitives implied). Wave = parallel dispatch group from the implementation plan:

```
Wave 1   core ──────────── (none)          math ─────────── (none)
Wave 2   scene ─────────── core, math
         geometry ──────── core, math
         materials ─────── core, math
         assets ────────── core
Wave 3   motion ────────── core, math, scene
         input ─────────── core, math, scene
         serialization ─── core, math, scene
         diagnostics ───── core, math, scene
         particles ─────── core, math, scene
         text ──────────── core, math, geometry
         render ────────── core, math, scene, geometry, materials
Wave 4   animation ─────── core, math, scene, motion
         physics ────────── core, math, scene, motion
         render-webgl ──── core, math, render     (same for -webgpu/-canvas/-svg)
         ui ─────────────── core, math, scene, input, text
Wave 5   physics-rapier ── physics (+ core, math direct, WP-5.4-fix1)
         physics-box2d ─── physics             physics-soft ── physics
Wave 6   four ───────────── all 23 above
```

Where the matrix forbids an edge the codebase needs, the standing pattern is a **duck-typed structural contract with drift pinned by tests**, never a new edge:

- `render` ↔ `particles`: `ParticleDrawable` + the `PARTICLE_INSTANCE_FLOATS` layout constant (duplicated by design, allowlisted).
- `diagnostics` → `physics`: `ReplayTarget`/`ReplaySnapshot` mirror `PhysicsWorld`'s checksum/snapshot surface; the `Debug*Access` provider shapes mirror the solver-access seams.
- `scene` → `motion`: `POSE_SNAPSHOT_PRIORITY` duplicates `PRIORITY_SNAPSHOT` (a test asserts equality).
- `particles`/`ui` → `motion`: `ParticleSystem` and the widgets satisfy `SimulationSystem`/`Pickable` structurally.
- `render` → `scene` lights: `collectSceneLights` duck-types `DirectionalLight` (`isDirectionalLightSource` brand) even though the edge exists, so fake-GL tests can double it — here drift **is** type-pinned.

Per-file dependency data lives in [`dependency-graph.json`](./dependency-graph.json) / [`dependency-reverse.json`](./dependency-reverse.json); the CI gates (`bun run graph:check`, `bun run graph:duplicates`) hold every report at zero findings.

---

**Document Version**: Unreleased (post-Phase 11)
**Last Updated**: 2026-08-05
**Maintained By**: Daniel Simon Jr.
