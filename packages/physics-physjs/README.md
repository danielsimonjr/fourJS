# @fourjs/physics-physjs

PhysJS solver adapters (2D and 3D, pure TypeScript). Part of [fourJS](../../README.md).

Implements RFC 0010 ([`docs/rfcs/0010-physjs-solver-adapter.md`](../../docs/rfcs/0010-physjs-solver-adapter.md)) behind the §37 solver seam. Depends on `@danielsimonjr/physjs`, pinned exactly at `0.5.0`.

## Honest state

`PhysJSAdapter2D` / `PhysJSAdapter3D` are complete adapters (package unit tests plus the cross-solver conformance suites in `tests/integration/physics-solvers.test.ts` and `tests/determinism/solver-determinism.test.ts`). Registration is opt-in: `registerPhysJSSolver()` puts `"physjs"` in `SolverRegistry`, last in the `"auto"` order.

**Supported:** dynamic/static/kinematic bodies; spheres/circles, boxes/rectangles, capsules, convex polygons centred on their centroid; `fixed`, `spring`, `revolute` (2D pin / 3D hinge) and `spherical` (3D) joints; persistent forces and torques, impulses, velocities; raycast (including `mode: "all"`), overlap, point queries; collision start/stay/end and sleep/wake events; speculative CCD; same-runtime determinism; `createSnapshot` / `restoreSnapshot` / `checksum`.

**Refused with `FourError("NOT_IMPLEMENTED")` (never emulated):** sensors (no trigger volumes), collider offsets, non-all-ones collision groups, `shapeCast`, swept CCD, prismatic and rope joints, joint limits and motors, breakable joints (no reaction reporting), cylinder/cone/hull/trimesh/heightfield/polyline/chain shapes, non-zero `centerOfMass`, non-diagonal inertia, rolling/spinning friction and sleep thresholds. `docs/benchmarks/physjs-vs-rapier.md` lists the differences next to the measured cost.

**Caveats you will notice:**

- **Soft joints drift.** PhysJS joints are soft constraints. A hinge pendulum's bob wanders off its circle by about 2.3 cm over 4 s (measured) where Rapier holds it to about 4 micrometres; the conformance suite bounds PhysJS at 0.05 m and Rapier at 0.001 m. Do not build stiff mechanisms on this adapter.
- **Friction combines as a geometric mean**, not the arithmetic average Appendix A specifies (restitution is a max, matching). Two surfaces with friction 0 and 1 give 0, not 0.5.
- **Collision events carry no contact points** (`contacts: []`, zero `totalImpulse`); `relativeVelocity` is the difference of the bodies' linear velocities.
- **Determinism is `same-runtime`** only; no cross-process golden is claimed.

`"physjs"` registered last keeps it last in the `"auto"` order.

Workspace name `@fourjs/physics-physjs`; publishes as `@danielsimonjr/fourjs-physics-physjs`.
