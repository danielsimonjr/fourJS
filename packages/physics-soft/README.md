# @fourjs/physics-soft

Soft bodies and deformables (§35/§35a, [RFC 0011](../../docs/rfcs/0011-soft-bodies.md)) — **design skeleton: the API is defined, the simulation is not implemented yet.** Part of [fourJS](../../README.md).

What ships today: the `SoftBody` component (rope, cloth and pressure descriptors, validated; a dynamic `BufferGeometry` via `.geometry`; one per node like `RigidBody`) and `SoftBodySystem` (`PRIORITY_SOFT_BODY` = `PRIORITY_PHYSICS_SOLVE + 10`), whose `fixedUpdate` throws `FourError("NOT_IMPLEMENTED")` until packet W10.2 (PBD solver) lands. There is no cloth, rope or pressure simulation yet.

Model (RFC 0011): position-based dynamics with distance, bending and volume constraints; `substeps` x `iterations` per fixed step; the `"physics"` owner holds vertex positions (§42); rigid coupling only through §37 queries; `same-runtime` determinism. Out of scope: FEM, GPU, tearing. This is not a solver adapter (ERRATA E-3).

Unit tests are colocated in `tests/` per §92.

Workspace name `@fourjs/physics-soft`; publishes as `@danielsimonjr/fourjs-physics-soft`.
