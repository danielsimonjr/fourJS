# Custom solver adapters

The stable `@fourjs/physics` API never talks to a physics engine directly: it
talks to an **adapter** (§37). `physics-rapier` ships two of them
(`Rapier2dAdapter`, `Rapier3dAdapter`); `physics-box2d` is the scaffolded
second solver. This guide describes the contract a new adapter signs, the
seams the shipped ones actually implement, and the honest lessons from
adapting Rapier.

## The contract, in layers

What `PhysicsWorld` requires is a type intersection (defined in
`four/physics`):

```ts
type PhysicsWorldAdapter = PhysicsSolverAdapter & SolverBodyAccess;
```

**`PhysicsSolverAdapter`** (§37) is the world-shaped half: identity (`name`,
`version`), a `capabilities` record, async-capable `initialize(options)` —
where a wasm solver decodes its image — `createBody` / `destroyBody`,
`createCollider` / `destroyCollider`, `createJoint` / `destroyJoint`,
`step(delta)`, `drainEvents()`, `syncSceneToSolver()` / `syncSolverToScene()`,
the four §30 queries (`raycast`, `shapeCast`, `overlap`, `pointQuery`),
optional `takeSnapshot?()` / `restoreSnapshot?(buffer)` (§34), and
`dispose()`.

**`SolverBodyAccess`** is an engine seam _beyond_ §37's sketch (decision,
Phase 5): per-handle transform/velocity/force/kinematic accessors, mirrored
member-for-member by both Rapier adapters. §37 alone cannot move a solved
pose onto a node — it has no per-body read — so both halves are required.

**`SolverJointAccess`** joins them for any adapter with joints (§28): live
`setJointLimits` / `setJointMotor` command application, detected structurally
(`supportsSolverJointAccess`) rather than declared.

## Capabilities: declare what you are (§37)

`PhysicsCapabilities` is checked at world construction, not trusted later:

```ts
readonly capabilities: PhysicsCapabilities = {
  dimensions: ["2d"],              // a "3d" world refuses this adapter
  jointTypes: ["fixed", "revolute", "prismatic", "rope", "spring"],
  ccdModes: ["disabled", "speculative"],
  determinism: "same-runtime",     // may not be weaker than the world asks
  snapshots: true,                 // both snapshot methods implemented
  queries: { raycast: true, shapeCast: true, overlap: true, point: true },
};
```

Declare honestly. The engine's posture on missing features is _loud refusal
with the measured reason_, not emulation — Rapier 0.20.0 exposes no joint
reaction forces, so both adapters declare `reportsJointReactions = false` on
their joint-access seam and breakable joints are refused; per-axis limits cannot form a cone, so a limited spherical joint is
refused quoting the numbers.

## Using an adapter (the consumer side, complete)

```ts
import { PhysicsWorld, RigidBody, Collider } from "fourJS/physics";
import { Rapier2dAdapter } from "fourJS/physics-rapier";
import { Group } from "fourJS/scene";

const adapter = new Rapier2dAdapter();
const world = new PhysicsWorld({ dimension: "2d", adapter });
await world.initialize(); // adapter.initialize(): the wasm image decodes here

const ball = new Group();
ball.transform.position.set(0, 3, 0);
ball.transformAuthority = "physics";
ball.addComponent(new RigidBody({ type: "dynamic" }));
ball.addComponent(new Collider({ shape: { type: "circle", radius: 0.5 } }));
world.addBody(ball);

for (let i = 0; i < 120; i += 1) world.step(1 / 60);
console.log(ball.transform.position.y, world.checksum()); // solved pose + §33 digest
```

Swapping `Rapier2dAdapter` for another conforming adapter is the only line
that changes — that is §20's promise, and `examples/physics-playground`
demonstrates it across dimensions with a six-field kit.

## Rules a new adapter must keep

- **Own monotonic, never-reused body ids.** §33 checksums visit bodies in
  monotonic id order; Rapier's raw handles are unordered doubles, so the
  adapters mint their own ids and carry the registry through snapshot
  envelopes (Phase 5 decision — do the same).
- **Derive `collisionstay` if your engine only reports start/stop**, from a
  touching-pair map, as the Rapier adapters do.
- **Honor Appendix A defaults over your engine's**: e.g. restitution combine
  is `max`; Rapier's default `average` is overridden in the adapter.
- **Events are drained, not called back.** Collect during `step`, return them
  from `drainEvents()`; the world dispatches after the step (§39 step 9).
- **Queries must be read-only** — checksum-stream identity under thousands of
  probes is tested behaviour.
- **Snapshots must round-trip ids and warm-start state** (§34): a
  contact-free save replays bit-identically; an in-contact save diverges only
  through solver warm-start data, which §34 snapshots carry and §79 scene
  documents deliberately don't.
- **Document deviations you cannot fix.** The standing example: on Rapier a
  motor's `maxTorque` is a force-based _gain_, not §28's hard cap — recorded
  in the stable API docs rather than papered over. A Box2D adapter could
  honor a real cap; that difference belongs in the capability tables (§90,
  §102) — published since 2026-08-07 as
  [docs/COMPATIBILITY.md](../COMPATIBILITY.md), whose solver-adapter block is
  generated from the declarations themselves. A deviation that no field of
  `PhysicsCapabilities` can express goes in that document's prose beside the
  generated table, which is where the Rapier ones already are.

## Honest state

- Shipped: `Rapier2dAdapter`, `Rapier3dAdapter` (pinned `-compat@0.20.0`,
  base64 wasm), verified bit-identical across dimensions on mirrored scenes.
- Scaffold only: `physics-box2d`, `physics-soft` (§35) — reserved stubs
  (§102). Each package builds, publishes, and exports `PACKAGE_NAME` and
  nothing else, so `fourJS/physics-box2d` and `fourJS/physics-soft` import
  cleanly but register no solver: selecting `solver: "box2d"` fails with the
  registry's "no physics solver is registered" message (§37), not with a
  module error. Measured from a consumer seat 2026-09-19 (dogfood cycle 9):
  **1 export each**, no `register*` function, in Node and in Chrome.
- Known seam gaps: §32 sleep thresholds and §28 solver iterations are not
  yet exposed through the adapter interface (recorded TODOs).
- Reference material: the transcribed Rapier type subset in
  `packages/physics-rapier/src/init.ts`; scripted test adapters exercising
  §28 breakage through the full pipeline in the integration suites.

## Cross-references

- §37 (the contract), §20–§21 (worlds and dimensions), §33–§34
  (determinism and snapshots), §90/§102 (capability and compatibility
  tables).
- [docs/COMPATIBILITY.md](../COMPATIBILITY.md) — the published §90 tables,
  including the generated per-adapter capability matrix and both access seams.
  Refresh it with `node tools/generate-compatibility.mjs` after changing an
  adapter's declarations, and `--check` verifies the committed copy.
- `packages/physics-rapier/src` — the worked example of everything above.
