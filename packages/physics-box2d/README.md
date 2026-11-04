# @fourjs/physics-box2d

Box2D solver adapter for [fourJS](../../README.md): `Box2dAdapter`, a 2D `PhysicsSolverAdapter` (§37) over [`@box2d/core`](https://www.npmjs.com/package/@box2d/core) **0.11.0** (pinned exactly), a pure-TypeScript port of Box2D 2.4. No wasm, no async initialisation.

```ts
import { PhysicsWorld, SolverRegistry } from "@fourjs/physics";
import { registerBox2dSolver } from "@fourjs/physics-box2d";

const registry = new SolverRegistry();
registerBox2dSolver(registry);
const world = new PhysicsWorld({
  dimension: "2d",
  solver: "box2d",
  solverRegistry: registry,
});
await world.initialize();
```

## Supported

- 2D worlds, the four §22 body types, circle / rectangle / convex-polygon (at most 8 vertices) / capsule colliders. A capsule is three fixtures (rectangle plus two circles) under one collider handle.
- Joints: `fixed`, `spring`, `revolute`, `prismatic`, `rope`. **Motor `maxTorque` / `maxForce` is a real hard cap** (`tuning.jointMotorEffortCap: true`), unlike Rapier's force-based gain. `reportsJointReactions` is `true`, so breakable joints work.
- The four §30 queries, collision / trigger / sleep / wake events, `ccdModes` `disabled` and `swept`.
- §34 snapshots in an explicit float64 envelope; determinism tier `same-runtime`.

## Refused / not provided

- 3D worlds. `solver: "auto"` skips this adapter for a `"3d"` world and names it in the failure.
- `spherical` joints, speculative CCD, rolling / spinning friction, sleep-threshold tuning.
- Cross-platform determinism (not claimed).

## Differences from Rapier you should know

- **Friction combines by `sqrt(a * b)`**, not Appendix A's average. Restitution combines by `max`.
- **Snapshot caveat.** `capabilities.snapshots` is a plain boolean (`true`), but snapshots do not capture warm-start contact or joint impulses. A restore reproduces body, joint and sleep state, and the continuation is bit-identical to the uninterrupted run only from a snapshot taken with no touching contacts and no loaded joints. From a loaded state the continuation is a valid simulation that can differ from the original in its first steps.

Registered capabilities appear as the `box2d` column of [docs/COMPATIBILITY.md](../../docs/COMPATIBILITY.md). Cost numbers: [docs/benchmarks/box2d-vs-rapier.md](../../docs/benchmarks/box2d-vs-rapier.md). The adapter contract: [docs/guides/custom-solver-adapters.md](../../docs/guides/custom-solver-adapters.md).

Unit tests are colocated in `tests/` per §92; cross-package suites are `tests/integration/box2d-conformance.test.ts` and `tests/determinism/box2d-determinism.test.ts`.

Workspace name `@fourjs/physics-box2d`; publishes as `@danielsimonjr/fourjs-physics-box2d`.
