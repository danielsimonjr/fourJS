# The digital twin

A digital twin needs four properties on top of an ordinary simulation: its
state can be **saved and restored** (§79 serialization, §34 snapshots), its
runs are **reproducible** (§33 determinism), its history can be **replayed
and inspected** (§34/§113), and its content can be **loaded** from data
(§76 assets). All four are shipped; this guide composes them and marks the
boundaries.

## Reproducibility is the foundation (§33)

Same inputs, same steps, same state — verified by checksums that quantize
every body's state to a 1e-6 grid and visit bodies in monotonic id order:

```ts
const digest = world.checksum(); // a uint32 over every body, sleeping included
```

The current tier is **same-runtime determinism**: one build, one runtime,
bit-identical streams — proven cross-process in the committed goldens (the
Phase 10 exit replays 240/240 step checksums bit-identically). Rules you
must keep: never feed wall-clock time into simulation, seed every RNG
(`SeededRandom`, particle `seed`s), and apply external inputs on the same
step live and replayed.

## Record, replay, inspect (§34, §113)

`fourJS/diagnostics` records a live world and replays it step-exactly.
A complete headless round trip:

```ts
import {
  ReplayPlayer,
  ReplayRecorder,
  encodeReplayRecording,
} from "fourJS/diagnostics";
import { PhysicsWorld, RigidBody, Collider } from "fourJS/physics";
import { Rapier2dAdapter } from "fourJS/physics-rapier";
import { Group } from "fourJS/scene";
import { Vector2 } from "fourJS/math";

const world = new PhysicsWorld({
  dimension: "2d",
  adapter: new Rapier2dAdapter(),
});
await world.initialize();

const crate = new Group();
crate.transform.position.set(0, 3, 0);
crate.transformAuthority = "physics";
crate.addComponent(new RigidBody({ type: "dynamic" }));
crate.addComponent(
  new Collider({
    shape: { type: "rectangle", halfExtents: new Vector2(0.3, 0.3) },
  }),
);
world.addBody(crate);

// -- record a two-second run, with a periodic snapshot for cheap seeking --
const recorder = new ReplayRecorder();
recorder.begin(world, {
  fixedDeltaTime: 1 / 60,
  seed: 1337,
  snapshotIntervalSteps: 30,
});
for (let i = 0; i < 120; i += 1) {
  world.step(1 / 60);
  recorder.recordFrame(1, 0); // steps this frame, dropped time
}
const recording = recorder.end();
const text = encodeReplayRecording(recording); // canonical, versioned envelope

// -- replay into the same (or a fresh, identically built) target --
const player = new ReplayPlayer(recording, {
  target: world, // duck-typed ReplayTarget
  stepFn: (dt) => {
    world.step(dt);
  }, // the player owns bookkeeping only
});
player.load(); // restores the initial snapshot
while (player.stepOnce()) {
  // frame-by-frame inspection: read poses, contacts, checksums here (§113)
}
console.log(player.verifyChecksum()); // true ⇔ the run reproduced the recording
```

`seekToStep` jumps anywhere (restoring the nearest snapshot and
re-simulating at most `snapshotIntervalSteps − 1` steps); slow motion is the
host feeding smaller elapsed time — replay is exact at any playback rate.
External inputs recorded with `recordInput` are re-applied through the
target's optional `applyInput`; one code path must apply inputs live **and**
on replay (the reference pattern is
`tests/integration/helpers/replay-scenarios.ts`).

The envelope format is versioned (`LATEST_REPLAY_FORMAT_VERSION`; a document
declares the lowest supported version that expresses its content) and
validated structurally on decode — a twin can archive recordings as plain
JSON text. Recording is non-perturbing: snapshotting is a pure read (tested).

## Saving the scene itself (§79, §80)

Replay recordings capture _solver_ state. The scene — hierarchy, transforms,
components — serializes separately into a canonical `SceneDocument`:

```ts
import {
  decodeSceneDocument,
  encodeSceneDocument,
  instantiateScene,
  serializeScene,
} from "fourJS/serialization";
import { registerSceneNodeTypes, resourceCatalog } from "fourJS";

// The umbrella call — not createDefaultComponentSerializers() alone.
// @fourjs/serialization knows "scene" / "group" and PoseTarget. Every other
// node class (Renderable, Text, cameras, lights, UI) needs nodeTypeOf /
// nodeFactory; registerSceneNodeTypes() is that pair, plus RigidBody /
// Collider / MotionComponent. Geometries and materials travel as catalog
// keys, not inlined buffers; Text / Label also need the glyph atlas.
const io = registerSceneNodeTypes({
  atlas,
  geometries: resourceCatalog(geometries),
  materials: resourceCatalog(materials),
});

const document = serializeScene(app.scene, io.components, io.write);
const saved = encodeSceneDocument(document); // canonical text; §33: byte-stable
const restored = instantiateScene(
  decodeSceneDocument(saved),
  io.components,
  io.read,
);
```

`createDefaultComponentSerializers()` plus `serializeScene(app.scene, registry)`
is the first save a reader of this guide used to write, and it **throws** on
any ordinary drawable (`INVALID_APPLICATION_STATE`, naming `registerSceneNodeTypes()`).
Unregistered _components_ also throw (`unknownComponents: "throw"`, A-15 since
2026-08-06 — this paragraph said "silently unsaved" until 2026-09-09). `"skip"`
is opt-in. Versioned migrations (§80) run on load via the migration registry,
with warnings surfaced.

**The §79/§34 boundary, measured:** a contact-free save round-trips
bit-identically for 200 further steps; an in-contact save diverges slightly,
because solver warm-start state is carried by §34 snapshots and deliberately
not by §79 scene documents. A twin that must resume mid-contact exactly
pairs a scene document with a §34 snapshot.

## Loading content (§76)

`AssetManager` (`fourJS/assets`) is a coalescing, ref-counted cache over
pluggable loaders (`jsonLoader`, `textLoader`, `binaryLoader`,
`createImageLoader`, `createGltfLoader`) — the natural home for a twin's
configuration, textures, and §78 models. glTF **ships**: pass the loader to
`AssetManager.load` and assemble the result with `instantiateGltf` from the
umbrella (`examples/gltf-model` is the worked page). Procedural geometry
(`fourJS/geometry`) remains the other path.

## Honest boundaries, collected

- Same-runtime determinism only; `"cross-platform"` is a declared §33 tier,
  not yet a claim.
- §34 world-_configuration_ mismatch is not refused on restore (adapter
  name/version are checked; gravity etc. are your responsibility).
- Restored node ids can collide with the live id counter — instantiate into
  a fresh application, as the round-trip suites do.
- Debug overlays for force vectors and joint anchors are staged
  (`DEBUG_DRAW_STAGED`).

## Cross-references

- §33, §34, §79, §80, §76, §113, §116/§119 (the motor-twin demonstrations).
- `tests/integration/helpers/replay-scenarios.ts` and
  `registerSceneNodeTypes()` / `registerPhysicsSerializers()` (`fourJS`
  umbrella) — the shipped wiring;
  [fixed-step simulation](fixed-step-simulation.md) for why any of this is
  possible.
