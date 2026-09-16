# fourJS — API Reference Map

A curated map of the public API, organized by consumer task. For the system
design behind these surfaces see [ARCHITECTURE.md](ARCHITECTURE.md) and
[OVERVIEW.md](OVERVIEW.md); for per-package internals see
[COMPONENTS.md](COMPONENTS.md); for how data moves through a frame see
[DATAFLOW.md](DATAFLOW.md). This document is deliberately **not**
per-member-exhaustive — TypeDoc (`bun run docs`) generates that — it names
the entry points for each task, gives their contracts and main signatures,
and links into the prose guides in [`docs/guides/`](../guides/README.md).

Every symbol named here exists in the machine-verified export inventory
[`package-export-surfaces.json`](package-export-surfaces.json) (generated
2026-08-05). Section references like "§45" mean
[`docs/SPECIFICATION.md`](../SPECIFICATION.md) numbering.

---

## Table of Contents

1. [Import spellings](#import-spellings)
2. [Bootstrapping an Application](#bootstrapping-an-application)
3. [Building a scene](#building-a-scene)
4. [Rendering, materials, and lighting](#rendering-materials-and-lighting)
5. [Authoring animation](#authoring-animation)
6. [Driving motion](#driving-motion)
7. [Physics: worlds, bodies, joints, queries](#physics-worlds-bodies-joints-queries)
8. [Solver adapters](#solver-adapters)
9. [Particles](#particles)
10. [Input and picking](#input-and-picking)
11. [Text, sprites, and UI](#text-sprites-and-ui)
12. [Serialization and assets](#serialization-and-assets)
13. [Diagnostics: checksums, replay, debug draw](#diagnostics-checksums-replay-debug-draw)
14. [Foundation: core and math](#foundation-core-and-math)
15. [Reserved surfaces](#reserved-surfaces)

---

## Import spellings

Three equivalent ways to reach every symbol. The examples and guides use the
umbrella subpaths; library code inside the workspace uses the `@fourjs/*`
package names directly.

```typescript
// 1. Umbrella subpaths — the form every example and guide uses.
//    Tree-shaken: importing "four/scene" pulls in no renderer, no physics.
import { Application } from "fourJS/application";
import { Group, OrthographicCamera } from "fourJS/scene";
import { Vector3 } from "fourJS/math";

// 2. The umbrella root — one namespace per package (§98).
//    `Application` is the only symbol `four` owns rather than re-exports.
import * as Four from "fourJS";
const pid = new Four.motion.PIDController({ kp: 8, ki: 2, kd: 0.4 });

// 3. Workspace package names — what the umbrella re-exports.
import { PhysicsWorld } from "@fourjs/physics";
```

`four/application` is the **headless composition subpath**: its emitted
JavaScript imports no renderer package, so a program that never names a
backend never carries one (§86). Backend packages (`four/render-webgl`,
`four/physics-rapier`) are always imported explicitly, by the application
author.

**Publish naming (§98):** at first npm publish the umbrella becomes
`@danielsimonjr/fourjs` and sub-packages `@danielsimonjr/fourjs-<name>`;
workspace names stay `four` / `@fourjs/*`. Subpath spellings are unchanged.

---

## Bootstrapping an Application

**Package:** `four/application` · **Guide:**
[fixed-step-simulation](../guides/fixed-step-simulation.md) · **Spec:** §45,
§10, §39

`Application` is the §45 composition root: the default `Scene`, the §10
fixed-step `Scheduler`, the §39 `SystemRegistry`, the §48 viewport list, the
§43 `PoseBuffer`, and — optionally — a §61 renderer, wired together. Every
part is also constructible independently (`new Scheduler()`, `new Scene()`);
`Application` only saves you the wiring.

```typescript
class Application extends EventEmitter<ApplicationEventMap> {
  constructor(options?: ApplicationOptions);

  readonly scene: Scene; // the default scene the app owns
  readonly scheduler: Scheduler; // §10 accumulator; .timeScale, .time
  readonly systems: SystemRegistry; // §39 fixed-step system registry
  readonly renderer: Renderer | null; // driven, not owned (§83)
  readonly views: Viewport[]; // §48 — mutable, drawn in order
  readonly poses: PoseBuffer; // §43 previous/current pose store

  get initialized(): boolean;
  get running(): boolean;
  get paused(): boolean;
  get disposed(): boolean;
  get time(): ReadonlyTimeState; // §9 live time record

  initialize(): Promise<void>; // awaits renderer.initialize({ canvas })
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  step(elapsedSeconds: number): void; // the host drives the loop — no rAF inside
  dispose(): void; // detaches systems; leaves scene + renderer alone
}

interface ApplicationOptions {
  fixedTimeStep?: number; // seconds; default 1/60 (Appendix A)
  maximumSubSteps?: number; // default 5 (Appendix A)
  renderer?: Renderer | false; // an INSTANCE, not a string (decision WP-3.6)
  canvas?: unknown; // handed to renderer.initialize({ canvas })
  views?: readonly Viewport[]; // copied into app.views; empty = draws nothing
  poseInterpolation?: boolean; // default true iff a renderer is configured
}
```

**Events** (`ApplicationEventMap`, §10/§6b): `fixedUpdate` fires 0..N times
per `step` after registered systems ran; `update` and `render` fire exactly
once, in that order, with world transforms already resolved (§7). Every
event carries the scheduler's **live** `ReadonlyTimeState` — copy with
`copyTimeState` (from `four/motion`) to retain a frame's values.

**Headless by construction:** there is no `requestAnimationFrame` driver
inside the class; the host calls `app.step(elapsedSeconds)`. That is what
makes determinism (§33) and replay (§34) testable. The
[quick start in the root README](../../README.md#quick-start-93) shows the
browser driver; `examples/first-2d-scene/main.ts` is the compiling version.

---

## Building a scene

**Package:** `four/scene` · **Guides:**
[scene-graph-and-transforms](../guides/scene-graph-and-transforms.md),
[cameras-and-coordinate-conversion](../guides/cameras-and-coordinate-conversion.md),
[transform-authority](../guides/transform-authority.md) · **Spec:** §6–§7b,
§42, §47–§48

| Symbol                                          | Contract                                                                                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Node`                                          | Base scene participant: typed `EventEmitter` (§6b) + `Transform` + parent/children + components (§6a).                                                           |
| `Group`                                         | A plain container node; children inherit its transform.                                                                                                          |
| `Scene`                                         | The root node the application owns; carries `ambientLight` (scene-wide RGB, §68).                                                                                |
| `Transform`                                     | Mutable position/rotation/scale with a dirty channel (D3); `node.position` etc. alias the live members.                                                          |
| `TransformAuthority`                            | §42's one-owner enum: `"manual" \| "animation" \| "kinematic" \| "physics" \| "blended" \| "constraint" \| "network"`; conflicts warn, never silently overwrite. |
| `OrthographicCamera` / `PerspectiveCamera`      | §47 cameras — nodes with a projection; call `updateProjectionMatrix()` after changing parameters.                                                                |
| `Viewport` / `createFullscreenViewport(camera)` | §48: binds a camera to a canvas region and clear color; push onto `app.views`.                                                                                   |
| `DirectionalLight`                              | §68 MVP light — a node shining along its **−Z world axis**; color + intensity.                                                                                   |
| `resolveWorldTransforms(scene)`                 | The §7 world-matrix resolver `Application` calls for you.                                                                                                        |
| `PoseBuffer` / `PoseTarget`                     | §43/§37 previous+current pose store; interpolation is opt-in per node via `poses.track(node)`.                                                                   |
| `Bone` / `Skeleton`                             | §54 joints. `Skeleton.update(skinRoot, worldOf?)` writes the palette; omit `worldOf` for resolved worlds. The interpolated list supplies a composer.             |
| `NodeEventMap`                                  | The typed event map; `four/input` and physics augment it (`click`, collision events, …).                                                                         |

The one-graph principle (§6): 2D shapes, 3D meshes, sprites, text glyphs, UI
widgets, and the nodes carrying rigid bodies or particle emitters are all
siblings in one right-handed, **Y-up** world (§7a) — radians and seconds
everywhere, no milliseconds.

```typescript
import {
  Group,
  OrthographicCamera,
  createFullscreenViewport,
} from "fourJS/scene";

const camera = new OrthographicCamera({
  left: -4,
  right: 4,
  bottom: -3,
  top: 3,
  near: 0.1,
  far: 10,
});
camera.transform.position.set(0, 0, 5);
camera.updateProjectionMatrix();

const assembly = new Group();
assembly.transform.position.set(-1, 0.5, 0); // children inherit — one write moves all (§7)
app.scene.add(assembly);
app.views.push(createFullscreenViewport(camera));
```

Components attach with `node.addComponent(...)`, one per type per node
(§6a) — `RigidBody`, `Collider`, and `MotionComponent` are all components,
not node subclasses.

---

## Rendering, materials, and lighting

**Packages:** `four/render`, `four/render-webgl`, `four/materials`,
`four/geometry` · **Guides:**
[materials-and-render-graph](../guides/materials-and-render-graph.md),
[custom-shaders](../guides/custom-shaders.md) · **Spec:** §57–§68

| Symbol                                                                 | Contract                                                                                                                                      |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `Renderer` (`four/render`)                                             | The §61 backend-independent interface: `initialize`, `render(scene, views, interpolation?)`, `resize`, `dispose`.                             |
| `WebglRenderer` (`four/render-webgl`)                                  | The shipped WebGL 2 backend (§120 MVP tier).                                                                                                  |
| `NullRenderer` (`four/render`)                                         | Headless no-op backend for tests and servers.                                                                                                 |
| `Renderable`                                                           | A node with a `BufferGeometry` and a material — the mesh/shape type.                                                                          |
| `Sprite` / `Texture`                                                   | §55/§77 textured quad tier; a `Texture` wraps an RGBA8 buffer you own.                                                                        |
| `UnlitMaterial` / `LitMaterial` (`four/materials`)                     | Flat color vs. Lambert-diffuse + scene-ambient color (§68 MVP); both carry a `readonly kind` discriminant that selects the pipeline.          |
| `SpriteMaterial`                                                       | Texture + tint for sprites; sprites and particles are the only blended passes (§66).                                                          |
| `boxGeometry` / `planeGeometry` / `circleGeometry2D` (`four/geometry`) | Procedural primitives returning `BufferGeometry` (box/plane carry per-face normals for the lit path).                                         |
| `buildRenderList` / `buildInterpolatedRenderList`                      | The scene→draw-list step (§64–§66); interpolated path also refreshes skin palettes from composed §43 poses (never a lerp of `jointMatrices`). |
| `Mesh`                                                                 | §54 renderable that can carry a `Skeleton`; skinned when geometry has `joints`/`weights`.                                                     |
| `collectSceneLights`                                                   | §68 light discovery: first `DirectionalLight` in DFS order + `Scene.ambientLight`.                                                            |

```typescript
import { planeGeometry } from "fourJS/geometry";
import { LitMaterial, UnlitMaterial } from "fourJS/materials";
import { Renderable } from "fourJS/render";
import { DirectionalLight } from "fourJS/scene";

const slab = new Renderable(
  planeGeometry({ width: 2, height: 1 }),
  new UnlitMaterial({ color: [0.16, 0.18, 0.24, 1] }), // straight RGBA in 0..1 (§60a)
);
slab.material.setColor(0.1, 0.52, 0.45, 1); // recolour in place; read per draw

const sun = new DirectionalLight({ color: [1, 1, 1], intensity: 1 });
app.scene.add(sun); // shines along the node's −Z world axis
app.scene.ambientLight[0] = 0.1; // readonly tuple: write INTO it (§68)
app.scene.ambientLight[1] = 0.1;
app.scene.ambientLight[2] = 0.12; // scene-wide term, not a node
```

Honest tier boundaries the guide states: one directional light (multi-light,
point/spot, shadows §69, and `StandardMaterial`/PBR §59 are staged); unlit
alpha never reaches a blend equation; sprites map the whole texture (§55
frame regions staged). WebGPU/Canvas 2D/SVG backends are
[reserved surfaces](#reserved-surfaces).

---

## Authoring animation

**Package:** `four/animation` · **Spec:** §14–§18 · Worked examples:
`examples/first-2d-scene` (tweens, clips, timelines), `examples/blending`

| Symbol                                                                                     | Contract                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `animate(target)` / `tween(target, props, durationSeconds)`                                | Tween builders: `animate(...)` returns a fluent `Tween` (`.to().ease().yoyo().repeat().play()`); `tween(...)` builds unplayed, for timeline children. Durations are **seconds** (§7a). |
| `Tween`                                                                                    | One property animation; `repeat(n)` = _extra cycles_. Writer conflicts resolve last-started-wins, shared with the mixer.                                                               |
| `Timeline`                                                                                 | Sequences children (`TimelineChild`) with elapsed-space markers; `loop` = _total iterations_ (documented divergence from `tween.repeat`).                                              |
| `AnimationClip` / `AnimationTrack`                                                         | The §17 keyframe form: `path`, `adapter`, `times`, `values`, `interpolation` (`"step" \| "linear" \| "cubic"`; quaternions slerp).                                                     |
| `AnimationMixer`                                                                           | Plays clips on a node: `new AnimationMixer(node).play(clip, { loop })`; root-motion options included.                                                                                  |
| `AnimationSystem`                                                                          | The §39 fixed-step driver (priority 300, before `MotionSystem` at 400); `track()` what should advance.                                                                                 |
| `EASINGS` / `EasingName` / `resolveEasing`                                                 | The 34-key §15 easing registry (`"sine-in-out"`, `"bounce-out"`, …).                                                                                                                   |
| `PropertyBinding` / `createBinding`                                                        | Path-resolved property writes (in-place for reference types — identity and change hooks preserved).                                                                                    |
| `ValueAdapter` (`numberAdapter`, `vector3Adapter`, `quaternionAdapter`, `colorAdapter`, …) | Typed interpolation per value kind (§17).                                                                                                                                              |

```typescript
import {
  AnimationClip,
  AnimationMixer,
  AnimationSystem,
  AnimationTrack,
  animate,
  quaternionAdapter,
} from "fourJS/animation";
import { Quaternion, Vector3 } from "fourJS/math";

const animationSystem = new AnimationSystem();
app.systems.register(animationSystem);

// A yoyo position tween — the target is the NODE, so §42 authority is inferred.
animationSystem.track(
  animate(beacon)
    .to({ "transform.position": new Vector3(0, 2.4, 0) }, 2.2)
    .ease("sine-in-out")
    .yoyo()
    .repeat(Infinity)
    .play(),
);

// A §17 clip: one turn about +Z in three 120° spans (slerp takes the short way).
const axis = new Vector3(0, 0, 1);
const spin = new AnimationClip({
  name: "vane-spin",
  tracks: [
    new AnimationTrack({
      path: "transform.rotation",
      adapter: quaternionAdapter,
      times: [0, 1, 2, 3],
      values: [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3, 2 * Math.PI].map((a) =>
        new Quaternion().setFromAxisAngle(axis, a),
      ),
      interpolation: "linear",
    }),
  ],
});
animationSystem.track(new AnimationMixer(vane).play(spin, { loop: Infinity }));
```

Animation drives nodes under `"animation"` (or `"blended"`, §19) transform
authority; the [transform-authority guide](../guides/transform-authority.md)
covers the handovers, and the §19 animation↔physics blending pipeline is
under [Physics](#physics-worlds-bodies-joints-queries).

---

## Driving motion

**Package:** `four/motion` · **Guides:**
[fixed-step-simulation](../guides/fixed-step-simulation.md),
[engineering-dashboard](../guides/engineering-dashboard.md) · **Spec:** §9–§13,
§38–§39, §111

The kinematics-and-control pillar: things that move by rule rather than by
keyframe (animation) or by force (physics).

| Symbol                                                                                               | Contract                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Scheduler`                                                                                          | The §10 fixed-delta accumulator (`step(elapsedSeconds)`, clamped at `maximumSubSteps`, excess surfaced as `droppedTime`); event-free — `Application` composes it. |
| `SystemRegistry` / `SimulationSystem`                                                                | §39: per-fixed-step engine work registers here in `PRIORITY_*` order (`PRIORITY_INPUT` … `PRIORITY_SNAPSHOT`); nothing edits the loop.                            |
| `TimeState` / `createTimeState` / `copyTimeState`                                                    | §9 time domains: real, render, simulation, scaled/unscaled, `interpolationAlpha`, `droppedTime`.                                                                  |
| `MotionComponent` + `MotionSystem`                                                                   | Velocity-driven nodes: attach the component (linear/angular velocity), register the system, `track(node)` under `"kinematic"` authority.                          |
| `KinematicController` + `KinematicSystem`                                                            | §40 command channels (`move`, `rotate`, path-follow) with float-safe completion; refused commands freeze the channel.                                             |
| `INTEGRATORS` (`explicitEuler`, `semiImplicitEuler`, `rk2`, `rk4`, `velocityVerlet`)                 | The five §38 integrators over `IntegratorState` + `AccelerationFn`.                                                                                               |
| `Trajectory` family                                                                                  | Eight §13 paths: `Linear`, `Circular`, `Elliptical`, `Parabolic`, `Ballistic`, `CubicBezier`, `CatmullRom`, `Parametric`, plus `DampedSpringTrajectory`.          |
| `seek` / `flee` / `arrive` / `pursue` / `evade` / `wander` / `separation` / `cohesion` / `alignment` | Reynolds steering set (+ `SteeringAgent` flocking); acceleration out-params, brute-force neighbors (spatial hash staged).                                         |
| `PIDController`                                                                                      | Scalar PID with conditional-integration anti-windup, derivative-on-measurement default: `update(setpoint, measurement, deltaSeconds)`, `reset()`.                 |
| `SpringDamper`                                                                                       | Exact zero-order-hold matrix-exponential step — unconditionally stable smoothing for setpoints and cameras.                                                       |
| `solveTwoBoneIK` / `createTwoBoneIKSolution`                                                         | Analytic two-bone IK over positions.                                                                                                                              |
| `predictBallistic` / `predictLinear` / `interceptPoint` / `interceptTime`                            | Ballistic and intercept prediction.                                                                                                                               |
| `SeededRandom`                                                                                       | Deterministic xorshift128 RNG (§33) — canonical home is `@fourjs/core`; re-exported here.                                                                         |

```typescript
import { PIDController } from "fourJS/motion";

// The §119 actuation cascade: PID output becomes a joint motor's
// targetVelocity; maxTorque stays fixed as the effort bound.
const pid = new PIDController({ kp: 8, ki: 2, kd: 0.4, outputLimits: [-6, 6] });
app.on("fixedUpdate", (time) => {
  const speed = pid.update(targetAngle, measuredAngle, time.fixedDeltaTime);
  shaftHinge.setMotor({ enabled: true, targetVelocity: speed, maxTorque: 400 });
});
```

Camera rigs (§44) belong to this package per the spec but have not shipped —
place cameras manually or drive them with tweens/trajectories (honest-state
note in the [cameras guide](../guides/cameras-and-coordinate-conversion.md)).

---

## Physics: worlds, bodies, joints, queries

**Package:** `four/physics` · **Guides:**
[collision-filtering](../guides/collision-filtering.md),
[transform-authority](../guides/transform-authority.md) (§19 blending),
[units-and-numerical-stability](../guides/units-and-numerical-stability.md) ·
**Spec:** §20–§32

The stable API above pluggable solver adapters (§37). Bodies attach to nodes
as **components**; worlds are stepped explicitly or by the `PhysicsSystem`.

```typescript
class PhysicsWorld {
  constructor(init: PhysicsWorldInit); // { dimension: "2d" | "3d", adapter, ...options }
  initialize(): Promise<void>;         // adapter wasm decodes here (§37)

  addBody(node: Node): RigidBody;      // reads RigidBody + Collider components
  removeBody(node: Node): boolean;
  getBody(node: Node): RigidBody | undefined;
  setBodyControlMode(/* §19/§22 re-typing in place */): void;

  addJoint(joint: Joint): Joint;       // world-space anchors convert here — pose before jointing
  removeJoint(joint: Joint): boolean;

  step(deltaSeconds: number): void;    // one fixed step; events dispatch after (§39 step 9)
  capturePoseTargets(): void;          // §19 blending feed

  raycast(query: RaycastQuery): WorldRaycastHit[];       // §30 — all take QueryFilter
  shapeCast(query: ShapeCastQuery): WorldShapeCastHit[];
  overlapSphere(...): WorldOverlapHit[];
  overlapBox(...): WorldOverlapHit[];
  pointQuery(point: Vector3Input, options?: QueryOptions): WorldPointHit[];

  checksum(): number;                  // §33 digest, 1e-6 grid, monotonic body-id order
  createSnapshot(): PhysicsSnapshot;   // §34
  restoreSnapshot(snapshot: PhysicsSnapshot): void;
  dispose(): void;

  get gravity(): Vector3;  get dimension(): PhysicsDimension;
  get supportsJoints(): boolean;  get joints(): IterableIterator<Joint>;
}
```

| Symbol                          | Contract                                                                                                                                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RigidBody`                     | §22 body component: `type: "dynamic" \| "static" \| "kinematic-position" \| "kinematic-velocity"`; mass density-derived by default — read `body.mass` after registration. Carries §19 `BlendWeights`.                                                                                      |
| `Collider`                      | Shape + `collisionGroups`/`collisionMask` bits (§24, mutual filtering), `sensor` flag, friction/restitution (explicit fields beat `PhysicsMaterial`; restitution combines `max` per Appendix A).                                                                                           |
| `CollisionShape`                | `circle`, `rectangle`, `polygon`, `capsule` (2D) / `sphere`, `box`, `capsule` (3D) descriptor unions — see `COLLISION_SHAPE_TYPES_2D/3D`.                                                                                                                                                  |
| Joints                          | `HingeJoint`/`RevoluteJoint`, `SliderJoint`/`PrismaticJoint`, `BallJoint`/`SphericalJoint`, `FixedJoint`, `RopeJoint`, `SpringJoint` (§28). Anchors/axes authored in **world space**, converted once at `addJoint`. `setMotor`/`setLimits` are live; geometry is frozen post-registration. |
| Events                          | `collisionstart`/`collisionstay`/`collisionend` on bodies, `triggerenter`/`triggerexit` on sensor colliders, `sleep`/`wake`, joint `break` — all dispatched **after** the fixed step (§29, §39 step 9).                                                                                    |
| `PhysicsSystem`                 | Registers world stepping into the §39 registry at `PRIORITY_PHYSICS_SOLVE`.                                                                                                                                                                                                                |
| `createPoseTargetCaptureSystem` | **Required** (priority 299) for §19 blending/velocity-inheritance users — an uncaptured animated target inherits wildly inflated velocity.                                                                                                                                                 |
| `PhysicsMaterial`               | §25 shared friction/restitution/density with combine modes.                                                                                                                                                                                                                                |

```typescript
import { Collider, PhysicsWorld, RigidBody } from "fourJS/physics";
import { Rapier2dAdapter } from "fourJS/physics-rapier";
import { Group } from "fourJS/scene";

const world = new PhysicsWorld({
  dimension: "2d",
  adapter: new Rapier2dAdapter(),
});
await world.initialize();

const ball = new Group();
ball.transform.position.set(0, 3, 0); // 2D bodies sit on the z = 0 plane (§21)
ball.transformAuthority = "physics"; // §42
ball.addComponent(new RigidBody({ type: "dynamic" }));
ball.addComponent(new Collider({ shape: { type: "circle", radius: 0.5 } }));
world.addBody(ball);

for (let i = 0; i < 120; i += 1) world.step(1 / 60);
console.log(ball.transform.position.y, world.checksum()); // solved pose + §33 digest
```

Worked mechanisms: `examples/mechanism` (motorized slider-crank with limits),
`examples/blending` (§19 animated ↔ ragdoll ↔ recover),
`examples/physics-playground` (mixed 2D/3D worlds).

---

## Solver adapters

**Packages:** `four/physics-rapier` (shipped), `four/physics-box2d`,
`four/physics-soft` (reserved) · **Guide:**
[custom-solver-adapters](../guides/custom-solver-adapters.md) · **Spec:** §37,
§90, §102

| Symbol                                                                 | Contract                                                                                                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Rapier2dAdapter` / `Rapier3dAdapter`                                  | The shipped §37 adapters over Rapier 0.19.3 (`-compat` wasm, decoded inside `initialize()`). Swapping the adapter is the only line that changes (§20). |
| `PhysicsSolverAdapter` / `PhysicsWorldAdapter` (`four/physics`)        | The contract a new solver implements: lifecycle, body/collider/joint registration, step, queries, `drainEvents`, snapshots.                            |
| `PhysicsCapabilities`                                                  | What the adapter honestly declares (e.g. `reportsJointReactions: false` on Rapier — breakable joints are refused there).                               |
| `SolverBodyAccess` / `SolverJointAccess` (`four/physics`)              | Required engine seams beyond §37's sketch: per-handle transform/velocity/force/kinematic accessors and live joint limit/motor commands.                |
| `initializeRapier2d` / `initializeRapier3d`, `RAPIER_2D` / `RAPIER_3D` | Direct wasm-module access for advanced hosts.                                                                                                          |

Adapter capability deviations that leak into application behavior (measured,
recorded): Rapier motor `maxTorque` is a force-based **gain**, not §28's hard
cap; §32 sleep thresholds have no Rapier binding (only `enabled` maps);
velocities written after `world.addBody` reach no solver — author them on the
descriptor.

---

## Particles

**Package:** `four/particles` · **Spec:** §27, §36, §112 · Worked example:
`examples/particles-demo`

| Symbol               | Contract                                                                                                                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ParticleEmitter`    | SoA pool + spawn rules: `maxParticles`, `seed` (fixed 4-draws-per-spawn RNG contract, §33), `emissionRate`, `lifetime`/`initialSpeed` ranges, `direction`+`spreadAngle`, size/color ramps, `fields`, plane collision. `emit(count)` for bursts (§36). |
| `ParticleSystem`     | The §39 fixed-step simulator (priority `PRIORITY_PARTICLES` = 500); register and `track(emitter)`.                                                                                                                                                    |
| `ParticleRenderable` | The scene node: one instanced draw call per emitter at any count (stride-8 interleaved quads, straight-alpha blending).                                                                                                                               |
| Force fields (§27)   | `uniformGravityField`, `dragField`, `windField`, `vortexField`, `radialField`, `turbulenceField`, `volumeField` — factories sampled and summed in array order.                                                                                        |

```typescript
import {
  ParticleEmitter,
  ParticleRenderable,
  dragField,
  uniformGravityField,
  vortexField,
} from "fourJS/particles";
import { Vector3 } from "fourJS/math";

const fountain = new ParticleEmitter({
  maxParticles: 2600,
  seed: 42, // §33: seeded, deterministic
  position: new Vector3(0, 0.05, 0),
  emissionRate: 900, // particles/second
  lifetime: { min: 1.6, max: 2.4 },
  initialSpeed: { min: 5.4, max: 7 },
  direction: new Vector3(0, 1, 0),
  spreadAngle: 0.3, // radians
  fields: [
    uniformGravityField(new Vector3(0, -9.81, 0)),
    dragField(0.35), // stability bound: c · dt < 1
    vortexField(new Vector3(0, -0.4, 0), new Vector3(0, 0, 1), 2.2, {
      minDistance: 0.6,
    }),
  ],
});
app.scene.add(new ParticleRenderable(fountain));
```

Recorded scale (a measurement, not a 60 fps claim — see
[TEST_COVERAGE.md](TEST_COVERAGE.md)): 100k particles + 3 fields at
16.54 ms/step mean on the CI host, one draw call.

---

## Input and picking

**Package:** `four/input` · **Guide:**
[cameras-and-coordinate-conversion](../guides/cameras-and-coordinate-conversion.md) ·
**Spec:** §71–§72

| Symbol                                          | Contract                                                                                                                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PointerInput`                                  | Platform pointer → NDC (Y-flip, DPR) → pick ray → scene events with capture/bubble propagation; `click` is synthesized (press + release, no drag between). A real `HTMLCanvasElement` satisfies `PointerSurface` structurally. |
| `pick` / `createPickRay`                        | §71 picking primitives: `createPickRay(camera, ndcX, ndcY, outOrigin, outDirection)`; ray vs. local-space AABB/oriented boxes.                                                                                                 |
| `Pickable`                                      | `{ node, boundsMin, boundsMax }` — the caller states bounds; this package never reads geometry (dependency-matrix rule).                                                                                                       |
| `DragManager`                                   | Pointer motion → **world-space deltas** handed to app callbacks; never writes transforms — the §42 authority handover is yours.                                                                                                |
| `dispatchPointerEvent` / `buildPropagationPath` | The §72 propagation machinery, public for custom sources.                                                                                                                                                                      |

```typescript
import { DragManager, PointerInput, type Pickable } from "fourJS/input";

const pickables: readonly Pickable[] = [disc, cube].map((node) => {
  const bounds = node.geometry.computeBounds();
  return { node, boundsMin: bounds.min, boundsMax: bounds.max };
});
const pointerInput = new PointerInput(canvas, {
  camera,
  pickables: () => pickables,
});

disc.on("click", (event) => console.log("hit at", event.worldPoint));

const drags = new DragManager({
  pointerInput,
  onDragStart: (node) => {
    motion.untrack(node);
    node.transformAuthority = "manual";
  },
  onDrag: (node, worldDelta) => {
    const p = node.transform.position;
    p.set(p.x + worldDelta.x, p.y + worldDelta.y, p.z);
  },
  onDragEnd: (node) => {
    node.transformAuthority = "kinematic";
    motion.track(node);
  },
});
drags.makeDraggable(cube);
```

---

## Text, sprites, and UI

**Packages:** `four/text`, `four/render` (Sprite), `four/ui` · **Spec:** §55–§56,
§73–§75 · Worked examples: `examples/first-2d-scene` (text),
`examples/ui-demo` (widgets)

**Text (§56, bitmap MVP tier):**

| Symbol                                             | Contract                                                                                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `BUILTIN_FONT` / `createBitmapFont` / `BitmapFont` | The built-in 6×12 face (ASCII U+0020–U+007E); custom bitmap fonts via `createBitmapFont`. SDF text is staged behind a shaping-engine RFC. |
| `buildGlyphAtlas`                                  | Packs the font into one RGBA8 buffer with a uv rectangle per glyph.                                                                       |
| `layoutText(text, atlas, options)`                 | Pure layout: baseline-origin quads (`TextQuad`), +Y up; `size` is world units per line.                                                   |

**UI (§73–§75):** layout and state are engine-owned; **visuals are
app-supplied** through the `WidgetSkin` seam (the dependency matrix keeps
`@fourjs/ui` renderer-free).

| Symbol                                                                   | Contract                                                                                                                                                                                        |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UIWidget`                                                               | Base widget node: measured box, state, focus, §72 pointer + keyboard activation.                                                                                                                |
| `Panel` / `Button` / `Label`                                             | The shipped widgets; `PanelLayout` gives flex/stack/absolute layout.                                                                                                                            |
| `WidgetSkin`                                                             | The seam: reads the widget's measured box and state, returns/updates its visual nodes.                                                                                                          |
| `focusedWidget` / `UIFocusEvent` / `WidgetActivateEvent`                 | Focus ring + activation (pointer or Enter).                                                                                                                                                     |
| `collectFocusOrder` / `keyboardFocusTarget` / `installKeyboardTraversal` | §75 keyboard traversal (2026-08-07): Tab/Shift-Tab over `accessibility.tabIndex`, resolver seam for `KeyboardInput`.                                                                            |
| `UI_STAGED`                                                              | Named staging record — the a11y DOM mirror, screen-reader/high-contrast/scalable-text, and reduced motion remain staged with dated notes (the keyboard-navigation entry was closed 2026-08-07). |

---

## Serialization and assets

**Packages:** `fourJS/serialization`, `fourJS/assets` · **Guide:**
[digital-twin](../guides/digital-twin.md) · **Spec:** §76, §79–§80

**Scene documents (§79):** canonical, versioned (`SCENE_FORMAT_VERSION`),
byte-stable text (§33).

```typescript
import {
  decodeSceneDocument,
  encodeSceneDocument,
  instantiateScene,
  serializeScene,
} from "fourJS/serialization";
import { registerSceneNodeTypes, resourceCatalog } from "fourJS";

const io = registerSceneNodeTypes({
  atlas,
  geometries: resourceCatalog(geometries),
  materials: resourceCatalog(materials),
});
const document = serializeScene(app.scene, io.components, io.write);
const saved = encodeSceneDocument(document); // canonical text
const restored = instantiateScene(
  decodeSceneDocument(saved),
  io.components,
  io.read,
);
```

`createDefaultComponentSerializers()` only knows `PoseTarget` and the built-in
`"scene"` / `"group"` node types. A scene holding a `Renderable` or `Text`
throws until `nodeTypeOf` / `nodeFactory` are supplied — `registerSceneNodeTypes()`
is that pair. Serializers are keyed by component **class**; an unregistered
component fails the save loudly (`unknownComponents: "throw"`, the A-15 default
since 2026-08-06 — this line said "silently unsaved (known boundary)" until
2026-08-07, which stopped being true with that change; `"skip"` restores the
old tolerance, minus the silence). Versioned migrations (§80) run on load via
`SceneMigrationRegistry` / `migrateSceneDocument`, with warnings surfaced.
Reference `RigidBody`/`Collider` serializers live in
`RIGID_BODY_SERIALIZER` / `COLLIDER_SERIALIZER`, shipped from `@fourjs/physics` since
2026-08-06 (previously reference code in the test helpers), and are registered
by `registerSceneNodeTypes()`. The §79/§34 boundary is
measured: a contact-free save round-trips bit-identically; resuming
mid-contact exactly requires pairing the document with a §34 snapshot.

**Assets (§76):**

| Symbol                                                             | Contract                                                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `AssetManager`                                                     | Coalescing, ref-counted cache: `load<T>(url, loader): Promise<T>`, `release`, `refCount`, `clear`, `dispose`. |
| `jsonLoader` / `textLoader` / `binaryLoader` / `createImageLoader` | The shipped `AssetLoader<T>` implementations; `ImageAsset` is the disposal wrapper.                           |

glTF loading ships (`createGltfLoader` + `instantiateGltf`;
`examples/gltf-model`). Procedural geometry (`fourJS/geometry`) is the other path.

---

## Diagnostics: checksums, replay, debug draw

**Package:** `fourJS/diagnostics` · **Guide:**
[digital-twin](../guides/digital-twin.md) · **Spec:** §33–§34, §113

| Symbol                                                                                                                                          | Contract                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createChecksum` / `Checksum` / `hashFloats`                                                                                                    | The §33 FNV-1a checksum utility behind `world.checksum()` — pinned against golden vectors.                                                                                                                                            |
| `ReplayRecorder`                                                                                                                                | `begin(world, options)` → `recordFrame(steps, droppedTime)` / `recordInput(...)` → `end(): ReplayRecording`. Recording is non-perturbing (snapshotting is a pure read — tested).                                                      |
| `ReplayPlayer`                                                                                                                                  | Bookkeeping only; the host supplies `stepFn`. `load()`, `stepOnce()`, `seekToStep(n)` (nearest snapshot + ≤ interval−1 re-steps), `verifyChecksum()`.                                                                                 |
| `encodeReplayRecording` / `decodeReplayRecording` / `validateReplayRecording`                                                                   | The canonical, versioned envelope (`LATEST_REPLAY_FORMAT_VERSION` 2 / `MINIMUM_REPLAY_FORMAT_VERSION` 1, per the lowest-version-that-expresses rule; strict base64; structural validation on decode) — archivable as plain JSON text. |
| `isReplayCompatible` / `assertReplayCompatible`                                                                                                 | Adapter-identity gate before replaying a recording into a target.                                                                                                                                                                     |
| `DebugDrawBuffer` + `collectBodyOrigins` / `collectBodyVelocities` / `collectContactPoints` / `collectContactImpulses` / `collectCentersOfMass` | §113 debug-draw providers writing 7-float line-list vertices; duck-typed over solver access seams, proven against live Rapier.                                                                                                        |
| `solverStatistics` / `solverJointStatistics`                                                                                                    | Per-step solver counters for dashboards.                                                                                                                                                                                              |
| `DEBUG_DRAW_STAGED`                                                                                                                             | Named staging record: joint-anchor viz, force vectors, per-segment color — staged with dated reasons.                                                                                                                                 |

```typescript
import {
  ReplayPlayer,
  ReplayRecorder,
  encodeReplayRecording,
} from "fourJS/diagnostics";

const recorder = new ReplayRecorder();
recorder.begin(world, {
  fixedDeltaTime: 1 / 60,
  seed: 1337,
  snapshotIntervalSteps: 30,
});
for (let i = 0; i < 120; i += 1) {
  world.step(1 / 60);
  recorder.recordFrame(1, 0);
}
const recording = recorder.end();
const text = encodeReplayRecording(recording); // canonical, versioned envelope

const player = new ReplayPlayer(recording, {
  target: world, // duck-typed ReplayTarget
  stepFn: (dt) => world.step(dt),
});
player.load();
while (player.stepOnce()) {
  /* frame-by-frame inspection (§113) */
}
console.log(player.verifyChecksum()); // true ⇔ the run reproduced the recording
```

---

## Foundation: core and math

**Packages:** `four/core`, `four/math` · **Spec:** §7b, §6a–§6b, §89

| Symbol                                                 | Contract                                                                                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `EventEmitter<TMap>` (`four/core`)                     | The one typed emitter (§6b) under nodes, worlds, and the application; re-entrant emits queue-and-defer.                                |
| `Component` / `ComponentRegistry` / `ComponentHost`    | The §6a model: `typeName`-keyed, one per type per host.                                                                                |
| `FourError` / `FourErrorCode` / `isFourError`          | §89 closed error-code union (`INVALID_APPLICATION_STATE`, `INVALID_RENDER_GRAPH`, `NOT_IMPLEMENTED`, …) with structured `context`.     |
| `Disposable` / `disposeAll`                            | §83 disposal contract — whoever created a resource disposes it.                                                                        |
| `SeededRandom`                                         | xorshift128 + splitmix32 seeding (§33) — canonical home; re-exported by `four/motion` and `four/particles` with bit-identical streams. |
| `JsonValue` / `cloneJsonValue`                         | Structured-clone-safe JSON with `__proto__` refusal (TypeError, not silent re-parenting).                                              |
| `Vector2/3/4`, `Quaternion`, `Matrix3/4` (`four/math`) | Mutable types with `out`-parameter hot paths (§7b, D7: the loop allocates nothing per frame); shortest-arc `slerp`.                    |
| `ColorRGBA`, `DepthRange`                              | Color tuple type (canonical home `@fourjs/math`); depth-range parameterization for projections (D8).                                   |

---

## Reserved surfaces

Five packages are **deliberate placeholders** — their `index.ts` exports only
`PACKAGE_NAME`, their READMEs say "interface reserved; not yet implemented",
and nothing here should be documented as usable:

| Package                 | Reserved for                       |
| ----------------------- | ---------------------------------- |
| `@fourjs/render-webgpu` | §62 WebGPU backend tier            |
| `@fourjs/render-canvas` | §62 Canvas 2D backend tier         |
| `@fourjs/render-svg`    | §62 SVG backend tier               |
| `@fourjs/physics-box2d` | §102 second solver adapter (Box2D) |
| `@fourjs/physics-soft`  | Soft-body tier                     |

`physics-matter` / `physics-cannon` do not exist and must not be added
without a spec amendment (ERRATA E-3).

---

_Cross-references: [ARCHITECTURE.md](ARCHITECTURE.md) ·
[OVERVIEW.md](OVERVIEW.md) · [COMPONENTS.md](COMPONENTS.md) ·
[DATAFLOW.md](DATAFLOW.md) · [TEST_COVERAGE.md](TEST_COVERAGE.md) ·
[guides index](../guides/README.md) · generated API reference: `bun run docs`
(TypeDoc)._
