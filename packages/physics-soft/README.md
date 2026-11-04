# @fourjs/physics-soft

Soft bodies and deformables (§35/§35a, [RFC 0011](../../docs/rfcs/0011-soft-bodies.md)): CPU rope, cloth and pressure bodies. Part of [fourJS](../../README.md). Shipped 2026-11-04. This is **not** a solver adapter (ERRATA E-3); it has no §37 capabilities.

## Model

Position-based dynamics (PBD) in world space: particles with distance (stretch) and bending constraints, plus a volume constraint for pressure bodies. Each fixed step runs `substeps` substeps (substep delta = `fixedDeltaTime / substeps`) of `iterations` constraint projections. Stiffness fractions are iteration-count independent (`1 - (1 - k)^(1/iterations)`). Arithmetic is float64 internally; the published geometry is node-local Float32.

## Descriptors

`new SoftBody(descriptor)` attaches via `node.addComponent(...)` (one per node, like `RigidBody`) and exposes a dynamic `BufferGeometry` as `.geometry` for any `Renderable`.

- `{ kind: "rope", segments, length, pinned? }` (pinned defaults to `[0]`)
- `{ kind: "cloth", columns, rows, width, height, pinned? }`
- `{ kind: "pressure", positions, indices, pressure?, pressureStiffness? }` (closed triangle mesh)

Shared tuning: `substeps` (4), `iterations` (4), `stiffness` (1), `bendingStiffness` (0.1), `damping` per second (0.1), `mass` in kilograms (1). Lengths are metres, times seconds. Invalid values throw `FourError("INVALID_APPLICATION_STATE")`.

## System

`SoftBodySystem` runs in `fixedUpdate` at `PRIORITY_SOFT_BODY` = 610 (`PRIORITY_PHYSICS_SOLVE + 10`, just after the rigid solve):

```ts
const soft = new SoftBodySystem({ world }); // world optional
app.systems.register(soft);
soft.track(body); // also untrack(body)
```

Gravity is read live from `world.gravity` when given, else `options.gravity` (default `(0, -9.81, 0)`).

## Ownership (§42)

The soft system owns the body's vertex geometry (the `"physics"` owner). The node transform is not written; pinned particles follow the node transform, interpolated across the substeps and landing exactly on the target at the last substep.

## Coupling to rigid bodies

Pass `world` (anything with `raycast`, normally a `PhysicsWorld`) and particles collide against its colliders, one-way: nothing is applied to rigid bodies. Each particle is tested with a short ray from its pre-substep to post-substep position, extended by `particleRadius` (0.01 m). Limits: a particle that starts a substep already inside a collider (for example one teleported onto it) is not detected; `PhysicsWorld.raycast` allocates its result array each call; colliders are solid whether or not their body sleeps.

## Snapshots and determinism

`createSnapshot()` returns `{ version: 1, kind: "soft-bodies", bodies: [{ id, kind, particleCount, positions, previous, velocities }] }` with exact float64 arrays; `restoreSnapshot(snapshot)` refuses mismatched bodies. `checksum()` is an FNV-1a hash over positions, previous and velocities using the 1e-6-quantized `PhysicsWorld.checksum` encoding. Tier: `same-runtime` (§33); no RNG is used.

## Out of scope

FEM or volumetric solids, GPU simulation, tearing/cutting, two-way rigid coupling, self-collision, `cross-platform` determinism.

Unit tests are colocated in `tests/` per §92. Workspace name `@fourjs/physics-soft`; publishes as `@danielsimonjr/fourjs-physics-soft`. See `docs/guides/soft-bodies.md` and `examples/soft-body`.
