# Fixed-step simulation

Simulation in fourJS advances in **fixed steps**; rendering runs at whatever
rate the display refreshes and draws **interpolated** poses. This guide covers
the §10 loop, the §9 time domains, §39 system ordering, and the §43
interpolation that ties them together. It is the single most load-bearing
design in the engine: determinism (§33), replay (§34), and physics stability
(§41) all rest on it.

## Start-up order

Three calls have to happen in one order, and it is not the order the code reads in:

1. `await world.initialize()` — **before the first `addBody`.** A WebAssembly solver
   decodes its module here (§37), so a world that has not initialized has nothing to
   register a body with. `addBody` throws rather than guess.
2. `await app.initialize()`
3. `app.start()` — before the first `app.step(…)`. §45 rejects a step on an application
   that was initialized but never started.

The trap is step 1. Everywhere else in four you build a scene and then initialize it, so
"construct the world, add the bodies, initialize" is the natural guess and it fails:

```text
FourError: PhysicsWorld has not been initialized; await world.initialize() before
registering bodies or stepping (§37: a WebAssembly solver loads its module there).
```

`examples/mechanism` shows the working sequence: both `initialize` calls, and only then
the function that creates every body and joint.

## The accumulator (§10)

`app.step(elapsedSeconds)` feeds real elapsed time into an accumulator. Each
call runs zero or more fixed steps of `fixedTimeStep` seconds (default 1/60,
Appendix A), clamped at `maximumSubSteps` (default 5); excess time is
**dropped**, not simulated, and surfaced as `TimeState.droppedTime` so a slow
machine slows down instead of spiralling. The remainder becomes
`interpolationAlpha` — how far between the last two simulation states the
frame being drawn sits.

The wall clock is allowed in exactly one place: the frame loop boundary,
where the rAF timestamp is converted to seconds. Inside the engine every
system receives the same injected `fixedDeltaTime`; nothing reads a clock
(§33).

```ts
let last: number | null = null; // seed from the FIRST rAF timestamp
function frame(now: number): void {
  if (last !== null) {
    app.step((now - last) / 1000); // milliseconds → seconds at the boundary
  }
  last = now;
  requestAnimationFrame(frame);
}
```

## A complete headless example

`Application` runs without a renderer — the default is headless — which is
how the determinism suites and benchmarks drive it, and the easiest way to
see the loop's anatomy. This runs under Node:

```ts
import { Application } from "fourJS/application";
import { Vector3 } from "fourJS/math";
import { MotionComponent, MotionSystem } from "fourJS/motion";
import { Group } from "fourJS/scene";

const app = new Application({ fixedTimeStep: 1 / 60, maximumSubSteps: 5 });

const spinner = new Group();
spinner.transformAuthority = "kinematic";
spinner.addComponent(
  new MotionComponent({ angularVelocity: new Vector3(0, 0, 1) }),
);
app.scene.add(spinner);

const motion = new MotionSystem();
app.systems.register(motion);
motion.track(spinner);

let fixedSteps = 0;
app.on("fixedUpdate", (time) => {
  fixedSteps += 1; // fires once per fixed step: 0..maximumSubSteps per app.step
  void time.fixedDeltaTime; // always exactly 1/60 here
});
app.on("update", (time) => {
  // once per app.step, after that call's fixed steps have run
  void time.interpolationAlpha; // 0..1, the render-side blend factor
});

await app.initialize();
app.start();
app.step(0.05); // 3 fixed steps run (48 ms simulated), 2 ms accumulates
console.log(fixedSteps); // 3
```

## Time domains (§9)

`TimeState` distinguishes the clocks so each system can pick the right one:

| domain     | fields                                               | who uses it                |
| ---------- | ---------------------------------------------------- | -------------------------- |
| real       | `realTime`                                           | profiling, presentation    |
| render     | `renderTime`, `interpolationAlpha`                   | drawing, §43 interpolation |
| simulation | `simulationTime`, `simulationStep`, `fixedDeltaTime` | physics, motion, animation |
| scaled     | time-scale-adjusted simulation time                  | slow motion, pause         |
| dropped    | `droppedTime`                                        | overload diagnostics       |

Animation time is clip-local on top of these. Slow motion scales simulation
time; it never changes `fixedDeltaTime`, so physics stays stable at any time
scale.

## System ordering (§39)

Systems register on `app.systems` and run per fixed step in **priority
order**, whatever order you register them. The shipped priorities:

```text
299  createPoseTargetCaptureSystem  (§19 pose history — register it yourself when blending)
300  AnimationSystem                (animation writes values / pose targets)
400  MotionSystem / KinematicSystem (kinematics integrates)
500  ParticleSystem                 (force generation)
600  PhysicsSystem                  (solve, then §29 event dispatch after the step)
     pose snapshot                  (§43 capture, registered by Application)
```

That order _is_ §19's pipeline — animation pose → kinematic modification →
physics solve — so blending needs no extra machinery, just the priorities.

## Interpolated rendering (§43)

Rendering never shows raw simulation state for moving nodes. `app.poses` is a
`PoseBuffer`: every tracked node's position and rotation are captured after
each fixed step, and the frame is drawn from
`lerp/slerp(previous, current, interpolationAlpha)`. Track every mover:

```ts
app.poses.track(spinner); // untracked nodes draw from their live transform
```

`PhysicsWorld` tracks its dynamic bodies automatically when constructed with
`poses: app.poses`. Two rules keep the design sound: interpolation **never
feeds back** into simulation state (§42), and a per-step measurement (from
`fixedUpdate`) is the only honest place to look for discontinuities — a
per-frame number folds several steps together.

Skinned meshes ride the same buffer. `buildInterpolatedRenderList`
supplies a `worldOf` provider to `Skeleton.update(skinRoot, worldOf)`
that composes those interpolated locals, then runs the palette product.
The palette itself is never lerped. Track every bone whose local pose
moves, the same way you track any other mover.

One consequence worth knowing: the accumulator's floating-point drift can
fire a timeline marker sitting exactly on a step boundary one step late.
This is frozen, pinned behaviour (`golden/phase4.json`) — do not place
markers on exact step boundaries and expect step-exact firing.

## Cross-references

- §9, §10, §33, §39, §43 — the normative text; Appendix A for defaults.
- `examples/first-2d-scene` — the loop with three motion systems;
  `examples/physics-playground` — two physics worlds on one accumulator.
- Next: [transform authority](transform-authority.md),
  [the digital twin](digital-twin.md) for replaying recorded steps.
