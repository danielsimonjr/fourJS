# @fourjs/physics-box2d

Box2D solver adapter — **a reserved stub. This package contains no implementation today.** Part of [fourJS](../../README.md).

What a consumer gets by installing it: **one export, `PACKAGE_NAME`, and nothing else** — measured from a consumer seat on 2026-09-19 (dogfood cycle 9) against installed tarballs, in Node and in Chrome. There is no `register*` function and no adapter class. `fourJS/physics-box2d` imports cleanly and registers no solver, so selecting `solver: "box2d"` fails with the registry's "no physics solver is registered" message (§37), not with a module error. **The shipped solver capability lives in [`@fourjs/physics-rapier`](../physics-rapier/README.md)** (`Rapier2dAdapter`, `Rapier3dAdapter`); unlike the renderer seam, there is no consumer-side workaround short of writing a whole §37 adapter — see [docs/guides/custom-solver-adapters.md](../../docs/guides/custom-solver-adapters.md) for that contract.

Reserved for the 2D solver adapter backed by Box2D, implementing `@fourjs/physics`'s `PhysicsSolverAdapter` (§37) plus the `SolverBodyAccess`/`SolverJointAccess` seams, and declaring its capability differences per §102 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md).

The package exists in the workspace so the §98 monorepo tree and the §102 solver list stay accurate (see ERRATA E-3: `physics-rapier`, `physics-box2d`, and `physics-soft` are the deliberate set — no `physics-matter` or `physics-cannon` without a spec amendment). The barrel currently exports only `PACKAGE_NAME`, and `tests/` holds a single smoke test.

One recorded motivation for this adapter: Box2D could honor §28's motor `maxTorque`/`maxForce` as a real hard cap, which Rapier treats as a force-based gain (capability-table item).

Unit tests are colocated in `tests/` per §92.

Workspace name `@fourjs/physics-box2d`; publishes as `@danielsimonjr/fourjs-physics-box2d`.
