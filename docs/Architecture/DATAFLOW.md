# fourJS - Data Flow Documentation

**Version**: Unreleased (implementation plan complete — Phases 0–11 closed per `MEMORY.md`)
**Last Updated**: 2026-08-05

Companion documents: [ARCHITECTURE.md](./ARCHITECTURE.md) (system design), [OVERVIEW.md](./OVERVIEW.md) (orientation), [COMPONENTS.md](./COMPONENTS.md) (per-package catalog), [API.md](./API.md) (API surface), [TEST_COVERAGE.md](./TEST_COVERAGE.md) (test counts). Plain `§N` citations refer to [`docs/SPECIFICATION.md`](../SPECIFICATION.md).

Every flow below is verified against the shipped source — the file that implements each stage is named inline. The load-bearing invariants repeat across all five flows: **time is injected, never read** (§33); **all times are seconds** (§7a); **iteration order is insertion order, never hash order** (§33); **render interpolation never feeds back into simulation state** (§42/§43); **events dispatch after the step, never during it** (§6b).

---

## Table of Contents

1. [Overview](#overview)
2. [The §10 Frame Loop](#the-10-frame-loop)
3. [The §19 Physics-Animation Blending Pipeline](#the-19-physics-animation-blending-pipeline)
4. [Pointer Input Flow](#pointer-input-flow)
5. [Physics Event Flow](#physics-event-flow)
6. [Serialization & Replay Flow](#serialization--replay-flow)

---

## Overview

One frame of a fully composed application moves data through the layers like this:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Host (rAF callback, test harness, or replay player)                 │
│      app.step(elapsedSeconds)          ← the host owns the cadence   │
└───────────────────────────┬──────────────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  four/src/application.ts — Application (composition root, §45)       │
│      scheduler.step(elapsedSeconds)                                  │
└───────────────────────────┬──────────────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  motion/src/scheduler.ts — §10 fixed-step accumulator                │
│      0..maximumSubSteps × onFixedStep │ then onUpdate │ then onRender│
└──────────┬──────────────────────────┬─────────────────┬──────────────┘
           ▼                          ▼                 ▼
┌────────────────────┐  ┌──────────────────────┐  ┌────────────────────┐
│ motion/systems.ts  │  │ scene/               │  │ render/            │
│ SystemRegistry:    │  │ world-transforms.ts  │  │ render-list.ts +   │
│ §39 priority order │  │ resolve once/frame   │  │ render-webgl:      │
│ (animation 300 …   │  │ (version-cached)     │  │ build list → draw  │
│  physics 600 …     │  │                      │  │ (§43 interpolated) │
│  snapshot 1000)    │  │                      │  │                    │
└────────────────────┘  └──────────────────────┘  └────────────────────┘
```

Alongside the frame loop, three event-shaped flows run at their own rates: pointer input (hardware rate, `@fourjs/input`), physics events (once per fixed step, after the solve), and serialization/replay (on demand).

---

## The §10 Frame Loop

**Sources**: `packages/fourjs/src/application.ts`, `packages/motion/src/scheduler.ts`, `packages/motion/src/systems.ts`, `packages/scene/src/world-transforms.ts`, `packages/scene/src/interpolation.ts`, `packages/render/src/render-list.ts`, `packages/render-webgl/src/webgl-renderer.ts`.

`Application.step(elapsedSeconds)` is one frame. The host — a rAF driver, a test, or the replay player — chooses the cadence; nothing in the engine reads a wall clock.

```
app.step(elapsedSeconds)
      │  (lifecycle + re-entrancy guards: INVALID_APPLICATION_STATE)
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 1. ACCUMULATE (§10, scheduler.ts)                                   │
│    frame += 1; realTime += elapsed                                  │
│    deltaTime = paused ? 0 : elapsed × timeScale                     │
│    accumulator += deltaTime                                         │
│    (pause ≡ timeScale 0 for the frame; timeScale itself preserved)  │
└─────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. FIXED STEPS — while accumulator ≥ fixedDeltaTime                 │
│                  and steps < maximumSubSteps (default 5):           │
│    simulationStep += 1; simulationTime += fixedDeltaTime            │
│    onFixedStep(time):                                               │
│      a. systems.runFixedStep(time)   ← §39 ascending priority:      │
│         299  createPoseTargetCaptureSystem  (§19 history shift)     │
│         300  AnimationSystem     — animation target evaluation      │
│         400  MotionSystem / KinematicSystem — kinematic motion      │
│         500  ParticleSystem      (PRIORITY_PARTICLES)               │
│         600  PhysicsSystem       — solve, then §29 event dispatch   │
│              (steps 6–9 internally; see Physics Event Flow)         │
│        1000  PoseSnapshotSystem  — §43 previous ← current capture   │
│         (equal priorities run in registration order — inserted,     │
│          never sorted; snapshot-iterated, re-entrancy throws)       │
│      b. emit("fixedUpdate", time)    ← listeners see a COMPLETED    │
│                                        step, never a partial one    │
│    accumulator -= fixedDeltaTime                                    │
└─────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. CLAMP (§10)                                                      │
│    if accumulator ≥ fixedDeltaTime:   ← long frame / background tab │
│      droppedTime += accumulator − fixedDeltaTime  (§9 surfaces it)  │
│      accumulator = fixedDeltaTime                                   │
│    interpolationAlpha = accumulator / fixedDeltaTime  ∈ [0, 1]      │
└─────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. UPDATE — onUpdate(time), exactly once per step call              │
│    resolveWorldTransforms(scene)  ← §7: once per frame, version-    │
│      cached — a frame that moved nothing recomputes nothing         │
│    emit("update", time)                                             │
└─────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. RENDER — onRender(time), exactly once, last                      │
│    emit("render", time)     ← listeners FIRST: move the camera,     │
│                               edit a viewport for THIS frame        │
│    #draw(time):                                                     │
│      no renderer or no viewport → draws nothing (both normal)       │
│      renderer.render(scene, views[, { poseBuffer, alpha }])         │
└─────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 6. BACKEND DRAW (render-webgl/src/webgl-renderer.ts)                │
│    per viewport, in order (§48):                                    │
│    ├── build the render list (render/src/render-list.ts, §64):      │
│    │     buildRenderList          ← live world matrices, or         │
│    │     buildInterpolatedRenderList ← §43 render poses:            │
│    │       poseBuffer.computeRenderPose(node, alpha, out…) =        │
│    │       lerp(prevPos, currPos, α) + slerp(prevRot, currRot, α)   │
│    │       skinned: Skeleton.update(mesh, worldOf) composes those   │
│    │       locals, then the palette product — never lerp palettes   │
│    │     items pooled per out-array; sort: renderLayer →            │
│    │     renderOrder → scene-graph order (stable, §33)              │
│    ├── collectSceneLights — only for frames whose list has a        │
│    │     lit item; first DFS-order DirectionalLight wins (§68)      │
│    └── encode + submit: pipeline picked from item.kind              │
│          ("unlit" | "lit" | "sprite" | "particles") — no instanceof │
│          on the draw path; particles are ONE instanced item (§112)  │
└─────────────────────────────────────────────────────────────────────┘
```

Contract points, each pinned by tests:

- `fixedUpdate` fires **0..maximumSubSteps** times per step; `update` and `render` fire **exactly once**, in that order — even when zero fixed steps run.
- During a fixed step, `interpolationAlpha` still holds the previous frame's value and **must not be read** (§42); it is only meaningful in `update`/`render`.
- The §43 previous pose needs no physics-side capture: the solver publishes at priority 600, the snapshot captures at 1000, so "current" is always the post-step pose and last step's "current" **is** this step's pre-step pose. A second capture inside the physics step would flatten interpolation to a constant (stated in both `world.ts` and `interpolation.ts`).
- A render pose is **never written back** into `node.transform` — `PoseBuffer.computeRenderPose` writes caller-owned `out` objects, and no API assigns a render pose to a transform (§42/§43).
- Which nodes interpolate is opt-in: `app.poses.track(node)`. The physics world tracks its dynamic (and all `"blended"`) bodies' nodes automatically; untracked nodes draw their live transform.
- The loop allocates nothing in steady state (plan D7): one live `TimeState` mutated in place, one reused interpolation record, pooled render items.

---

## The §19 Physics-Animation Blending Pipeline

**Sources**: `packages/physics/src/world.ts` (module header + `step`/`capturePoseTargets`), `packages/scene/src/pose-target.ts`, `packages/animation/src/animation-system.ts`, `packages/physics/src/physics-system.ts`.

§19's pipeline — _animation pose → kinematic modification → physics solve → interpolated render pose_ — is not a dedicated system. It is the §39 priority order doing its job, plus per-body work inside `PhysicsWorld.step` (a deliberate Phase 7 decision: **no separate BlendSystem** — feed and publish live inside the step).

A blended node needs the **trio** — `transformAuthority = "blended"` (§42), a registered `RigidBody`, and a `PoseTarget` component — and the step raises a `FourError` naming any missing piece.

```
   fixed step N (§39 order)
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ priority 299 — createPoseTargetCaptureSystem                        │
│    world.capturePoseTargets(): every registered body's              │
│    PoseTarget.capturePrevious()  ← shifts the one-step history      │
│    BEFORE this step's animation writes. Forgetting this system      │
│    does not break the blend, but leaves history stale — velocity    │
│    inheritance then divides TOTAL displacement by one dt            │
│    (measured: ~30× inflated velocity, WP-7.3-fix1 / WP-7.5)         │
└─────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ priority 300 — AnimationSystem: ANIMATION POSE                      │
│    mixers/tweens sample clips and write the node's PoseTarget       │
│    (or, for non-blended nodes, the transform under "animation"      │
│    authority)                                                       │
└─────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ priority 400 — MotionSystem / KinematicSystem: KINEMATIC            │
│    MODIFICATION of the animated pose (procedural adjustments)       │
└─────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ priority 600 — PhysicsSystem → world.step(dt): PHYSICS SOLVE        │
│    feed:    "blended" node → its PoseTarget pose is fed to the      │
│             solver body as the kinematic target (UNWEIGHTED — the   │
│             §19 weights apply once, at publish)                     │
│    solve:   adapter.step(dt)                                        │
│    publish: node.transform = blend(target pose, solver pose)        │
│             by RigidBody's BlendWeights { physics, animation }      │
│             (independent, normalized at use, defaults 1/0;          │
│             both-zero warns once and falls back physical;           │
│             weight extremes are bit-identical to pure physics /     │
│             pure target — Object.is-tested)                         │
│    transitions retype the body IN PLACE via                         │
│    SolverBodyAccess.setBodyType; velocity inheritance finite-       │
│    differences the PoseTarget history (world-frame quat delta)      │
└─────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ priority 1000 — PoseSnapshotSystem, then §43 at draw time:          │
│    INTERPOLATED RENDER POSE                                         │
│    the blended result is captured like any other pose and the       │
│    frame draws lerp/slerp(previous, current, alpha) — §19 stage 4   │
└─────────────────────────────────────────────────────────────────────┘
```

The `"blended"` authority value is §42's selector for this pipeline; a `"blended"` node is pose-tracked whatever its §22 body type, and tracking follows the node's **live** authority (re-evaluated in the publish pass, so flipping `transformAuthority` takes effect next step). Recorded exit evidence (Phase 7): the chain re-locks onto its animation **bit-identically** two wave periods after a ragdoll cycle.

---

## Pointer Input Flow

**Sources**: `packages/input/src/pointer-input.ts`, `packages/input/src/pick.ts`, `packages/input/src/pointer-events.ts`, `packages/input/src/drag.ts`, `packages/ui/src/widget.ts`.

Runs at hardware event rate, outside the fixed step. Input **never writes a transform** (§42) — it reports; the application (or `DragManager`'s callbacks, or a widget's skin) decides.

```
platform pointer event  { clientX, clientY, pointerId }
      │   (PointerSurface — structural seam; browser event, Playwright
      │    synthesis, and plain test objects are all acceptable)
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 1. NORMALIZE (pointer-input.ts)                                     │
│    client pixels → NDC [-1, 1], +Y UP (§7a) — the Y flip happens    │
│    here, exactly once, against the surface's bounding rect          │
└─────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. RESOLVE TARGET                                                   │
│    pointer captured?  → the capturing node IS the target            │
│    otherwise: createPickRay(camera, ndc) → pick(ray, pickables)     │
│    (§71: ray vs AABB / oriented box; NEAREST hit wins;              │
│     `pickables` is a caller-owned candidate function — input        │
│     holds no scene reference)                                       │
└─────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. SYNTHESIZE what the platform doesn't send at scene level         │
│    click        ← press + release on one node, travel under         │
│                   DEFAULT_CLICK_MOVE_THRESHOLD (NDC units)          │
│    pointerenter / pointerleave ← change of hovered node             │
│    (all state keyed by pointerId — two fingers are two              │
│     independent interactions)                                       │
└─────────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. DISPATCH (pointer-events.ts) — §72's three phases, verbatim:     │
│    buildPropagationPath(target)  root … target                      │
│    CAPTURE  root → target     emits "capture:<type>" keys           │
│    TARGET / BUBBLE  target → root   emits "<type>" keys             │
│    event.stopPropagation() halts either direction; only the four    │
│    propagating types (pointerdown/pointerup/pointermove/click)      │
│    have capture keys; enter/leave are targeted-only                 │
│    (keys widen scene's NodeEventMap by declaration merging — one    │
│     typed event API, §6b; phase is part of the key because the      │
│     emitter has no addEventListener flag)                           │
└─────────────────────────────────────────────────────────────────────┘
      │
      ├──────────────────────────────┐
      ▼                              ▼
┌───────────────────────────┐  ┌─────────────────────────────────────┐
│ 5a. DragManager (drag.ts) │  │ 5b. UIWidget state (ui/widget.ts)   │
│  press → threshold →      │  │  widgets are §71 pickables          │
│  world-delta computed on  │  │  (collectPickables); pointer        │
│  the pick plane, handed   │  │  events drive the hover/press/      │
│  to APP callbacks — the   │  │  focus state machines →             │
│  app performs the §42     │  │  WidgetStateChangeEvent +           │
│  untrack + authority-     │  │  WidgetSkin hooks (app draws        │
│  handover pair and writes │  │  the visuals) → click becomes       │
│  the transform itself     │  │  "uiactivate" (WidgetActivateEvent) │
└───────────────────────────┘  └─────────────────────────────────────┘
```

Each dispatch allocates one `ScenePointerEvent` and one path array — deliberate (events outlive their dispatch when listeners store them; pointer rates are human rates); the picking and drag math underneath uses `out` parameters per plan D7. `pointercancel` (2026-08-06) and keyboard (2026-08-07: `KeyboardInput` routes `keydown`/`keyup` through the same three-phase path, targeted at `@fourjs/ui`'s focused widget via an injected resolver) are handled; wheel, gamepad, and XR are not yet (recorded in `packages/input/README.md`).

---

## Physics Event Flow

**Sources**: `packages/physics/src/world.ts` (`step`, `#collectEvents`, `dispatchEvents`), `packages/physics/src/physics-system.ts`, `packages/physics/src/events.ts`.

§6b forbids dispatching physics events during the step; §39 puts "collision event dispatch" at step 9, after the solve and sensor update. The engine implements this as **drain-then-dispatch across two passes**:

```
   fixed step (PhysicsSystem.fixedUpdate, priority 600)
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ PASS 1 — for each world, in tracking order: world.step(dt)          │
│    1. per body (registration order): resetForces → §26 command      │
│       buffer → §32 sleep command → clear; kinematic feed            │
│       (or §19 PoseTarget feed for "blended" nodes)                  │
│       per joint (registration order): queued §28 limit/motor cmds   │
│    2. adapter.syncSceneToSolver()      ← §37 call-order hook        │
│    3. adapter.step(fixedDeltaTime)     ← seconds, never ms          │
│    4. adapter.syncSolverToScene()                                   │
│    5. per body: publish transforms per §42 authority; refresh       │
│       RigidBody velocities + .sleeping (§23, §32)                   │
│    6. adapter.drainEvents() → SOLVER events translated to           │
│       COMPONENT references (RigidBody/Collider/Joint) and QUEUED    │
│       — adapter order is §37-required deterministic; the world      │
│       neither sorts nor derives events (collisionstay is the        │
│       ADAPTER's to report)                                          │
│    7. per breakable joint: reaction vs §28 thresholds →             │
│       destroy + queue "jointbreak" (breaks are the engine's         │
│       CONCLUSION from the solved step, so they queue last)          │
└─────────────────────────────────────────────────────────────────────┘
      │   (every world has now finished stepping)
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ PASS 2 — for each world, in tracking order:                         │
│          world.dispatchEvents()          (§39 step 9, §6b)          │
│    queue handed over BEFORE the first callback → listeners may      │
│    create/remove bodies or step another world without re-entering   │
│    the dispatch or losing events                                    │
│                                                                     │
│    collisionstart/stay/end → bodyA.emit first, then bodyB.emit,     │
│        SAME payload object (§29 fixes no meaning to A/B order);     │
│        a pair sharing one body emits once                           │
│    triggerenter/exit → the SENSOR collider's emitter only           │
│        (two overlapping sensors = two adapter events)               │
│    sleep/wake → the body's emitter (RigidBody.sleeping already      │
│        refreshed — the listener sees the announced state)           │
│    jointbreak → the JOINT's emitter only; the joint is already      │
│        destroyed and joint.broken === true                          │
└─────────────────────────────────────────────────────────────────────┘
```

The two-pass split is why a listener on one world's body always observes every **other** world in a finished state — nothing can be caught mid-solve (§108's mixed 2D+3D application relies on this). Events removed mid-flight are still delivered: a body removed after step 6 keeps its queued events, delivered with component references that remain valid on the final state.

---

## Serialization & Replay Flow

**Sources**: `packages/serialization/src/serializer.ts`, `format.ts`, `migration.ts`; `packages/diagnostics/src/recorder.ts`, `replay-format.ts`, `replay-player.ts`; `packages/physics/src/world.ts` (checksum/snapshot surface).

Two distinct persistence surfaces with a recorded boundary (WP-11.5): a **§79 scene document** captures authored structure; a **§34 replay recording** captures simulation state including solver warm-start internals. A contact-free scene save round-trips bit-identically for 200 further steps; an in-contact save diverges only through warm-start state — which §34 snapshots carry and §79 documents don't.

### §79 scene documents (save / load)

```
serializeScene(scene, options)                 instantiateScene(document, opts)
      │                                              ▲
      ▼                                              │
┌──────────────────────────────┐    ┌────────────────────────────────────┐
│ 1. WALK the node tree        │    │ 5. VALIDATE (validateSceneDocument │
│    Scene → "scene",          │    │    — canonical, prototype-         │
│    Group → "group" by EXACT  │    │    pollution-safe) then MIGRATE    │
│    class identity (subclass  │    │    (§80: SceneMigrationRegistry,   │
│    ≠ group — no silent       │    │    runSceneMigrations, versioned   │
│    downgrade); app classes   │    │    from SCENE_FORMAT_VERSION = 1)  │
│    via nodeTypeOf, else      │    ├────────────────────────────────────┤
│    FourError                 │    │ 6. REBUILD nodes (nodeFactory for  │
├──────────────────────────────┤    │    app types), restore transforms  │
│ 2. TRANSFORMS + saved        │    │    (applyTransformDocument) and    │
│    node ids (§79: ids are    │    │    the SAVED ids (§79 stability;   │
│    stable and restored)      │    │    known boundary: restored ids    │
├──────────────────────────────┤    │    can collide with the live       │
│ 3. COMPONENTS: walk the      │    │    counter)                        │
│    SERIALIZER registry,      │    ├────────────────────────────────────┤
│    probe node.getComponent   │    │ 7. COMPONENTS by registered        │
│    per registered type,      │    │    typeName; unknown component     │
│    keyed by §6a typeName.    │    │    type: throw (default) or skip   │
│    KNOWN BLIND SPOT: a       │    │    per unknownComponents           │
│    component with no         │    └────────────────────────────────────┘
│    serializer is silently    │
│    unsaved (staged P11-1)    │      Round trips are byte-identical;
├──────────────────────────────┤      documents are diff-friendly JSON
│ 4. ENCODE                    │      (encodeSceneDocument /
│    (encodeSceneDocument)     │      decodeSceneDocument).
└──────────────────────────────┘
```

### §34 record → replay → seek

```
RECORD (diagnostics/src/recorder.ts)
      │
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ recorder.begin(target, { fixedDeltaTime, snapshotIntervalSteps })   │
│    target is the duck-typed ReplayTarget — PhysicsWorld satisfies   │
│    it structurally: checksum() / createSnapshot() /                 │
│    restoreSnapshot(); an initial snapshot anchors step 0            │
│ per external input:  recorder.recordInput(step, payload)            │
│ per rendered frame:  recorder.recordFrame(stepCount, droppedTime)   │
│    ← §10's EXECUTED step counts are stored, so replay never         │
│      re-derives them from a clock; interval snapshots captured      │
│      at exact multiples of snapshotIntervalSteps                    │
│    recording is non-perturbing (Rapier takeSnapshot is a pure       │
│    read — tested)                                                   │
└─────────────────────────────────────────────────────────────────────┘
      │  finish → ReplayRecording (formatVersion 1; adapter identity;
      │  finalChecksum; snapshots as strict canonical base64;
      │  encode(decode(t)) === t; validateReplayRecording)
      ▼
REPLAY (diagnostics/src/replay-player.ts)
┌─────────────────────────────────────────────────────────────────────┐
│ new ReplayPlayer({ target, stepFn, recording })                     │
│    the SEAM: the player owns replay bookkeeping (current step,      │
│    inputs due, nearest snapshot, checksum verdict); the HOST owns   │
│    the simulation via stepFn = "advance my world by exactly one     │
│    fixed step" — the player never drives a scheduler, because the   │
│    recording already knows how many steps each frame ran (§34)      │
│                                                                     │
│ per replayed step:                                                  │
│    1. apply this step's recorded inputs, in recorded order          │
│       (target.applyInput — optional; app-level targets route it)    │
│    2. stepFn(fixedDeltaTime)                                        │
│    3. onStep listeners (optional per-step checksum when             │
│       verifyChecksums is on)                                        │
│                                                                     │
│ controls (§113): play/pause · singleStep · speed (0.25 = slow       │
│ motion, via advanceRealtime with a §10-style sub-step clamp) ·      │
│ seekToStep(n): restore NEAREST snapshot ≤ n, re-simulate forward    │
│ (cost ≤ interval − 1 steps; sound because replay is §33-            │
│ deterministic, so re-simulating ≡ having played forward)            │
│                                                                     │
│ verifyChecksum() → target.checksum() vs recording.finalChecksum     │
│    — the §33 signal; a mismatched target/stepFn pairing fails       │
│    HERE (runtime signal by design — nothing can type-check it)      │
└─────────────────────────────────────────────────────────────────────┘
```

Recorded proof of the whole chain (Phase 10 exit, `MEMORY.md`): record → bit-identical replay (240/240 step checksums; recorded and replayed checksum digests pinned equal in `golden/phase10.json`) → snapshot-seek → frame-by-frame inspection reading contact geometry at exact recorded steps → exact slow motion. Snapshot restore refuses foreign snapshots (adapter name/version) and — when the optional `PhysicsSnapshotConfiguration` is present — refuses world-configuration mismatches field-by-field.

---

**Document Version**: Unreleased (post-Phase 11)
**Last Updated**: 2026-08-05
**Maintained By**: Daniel Simon Jr.

<!-- repo-map:no-verification -->

## Verification

`repo-tools check` does not check this document. It describes runtime flow and states no number that the gate measures.
