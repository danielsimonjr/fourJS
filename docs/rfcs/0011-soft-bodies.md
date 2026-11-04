# RFC 0011: Soft bodies (`@fourjs/physics-soft`)

- **Status:** accepted 2026-11-04 (owner decision delegated to the program lead)
- **Date:** 2026-11-04
- **Owner decision:** accepted 2026-11-04 (D6: 35 gets a scheduled phase)
- **Spec sections affected:** 6a, 10, 33, 34, 35, 35a (new), 37, 42, 98, 113b (new)

## Context

35 called soft bodies "a later module" and left `@fourjs/physics-soft` a one-export
reserved stub (TODO row: closes when 35 is scheduled and lands). Owner decision D6 schedules
it. This RFC fixes the model and the seams so the implementation packets (W10.2 solver,
W10.3 rigid coupling) need no further design. The package is not a 37 solver adapter
(ERRATA E-3): it is a component plus a fixed-step system.

## Proposed decision

1. **Model: position-based dynamics (PBD)** over a mass-spring particle set. Chosen for
   unconditional stability at game timesteps and a simple, order-deterministic loop.
2. **Descriptors:** `rope` (a chain of particles), `cloth` (a rows x columns grid, optional
   pinned particles), `pressure` (a closed triangle mesh with a volume constraint).
3. **Constraints:** distance (stretch) and bending (across-hinge distance) for rope and
   cloth; a global volume/pressure constraint for `pressure`. Stiffness is a unitless
   fraction in `[0, 1]`, made iteration-count-independent by `1 - (1 - k)^(1/iterations)`.
4. **Substeps and iterations:** each fixed step runs `substeps` substeps (default 4), each
   with `iterations` projection passes (default 4). Substep delta is `fixedDelta / substeps`
   seconds; no milliseconds anywhere (7a).
5. **System:** `SoftBodySystem` is a 39 `SimulationSystem` at `PRIORITY_PHYSICS_SOLVE + 10`
   (610): after the rigid solve, so §37 queries see this step's solved rigid poses; before
   `PRIORITY_CONSTRAINTS` (700) and `PRIORITY_EVENT_DISPATCH` (900). Equal priorities keep
   registration order, so body iteration is attach order.
6. **42 authority:** the `"physics"` owner holds a `SoftBody`'s vertex positions, which live
   in a dynamic `BufferGeometry` (`SoftBody.geometry`) the system writes each step and
   `markDirty()`s. The node transform is not written; it remains the body's rest frame
   under its own authority. Pinned particles follow the node transform.
7. **Rigid coupling (W10.3) only through the 37 raycast query** (overlap and point queries
   are not used): particles are pushed out of raycast hits. Limit: a particle that starts a
   substep already inside a collider is not pushed out. No solver internals, no reaction impulses on rigid
   bodies in this RFC; a soft body is a one-way follower.
8. **Determinism:** tier `same-runtime` (33). Particles, constraints and bodies are
   processed in fixed index order; no `Map` or `Set` iteration over unordered keys; any
   randomness (cloth jitter) comes from the seeded RNG in `core`.
9. **Snapshot format (34):** `{ version: 1, kind: "soft-bodies", bodies: [{ id, kind,
particleCount, positions, previous, velocities }] }`, bodies keyed by node id; geometry
   is rebuilt from it. Exact float64 bits. The checksum is a separate
   `SoftBodySystem.checksum()` (FNV-1a), not folded into the world checksum.
10. **Render path:** deformation reuses `BufferGeometry` dynamic vertex data; normals are
    recomputed after the final substep. No new renderer API.
11. **Skeleton behaviour (historical, skeleton phase, superseded 2026-11-04):**
    `SoftBodySystem.fixedUpdate` threw `FourError("NOT_IMPLEMENTED")`. The system now steps
    fully (see 35a).
12. **Out of scope:** FEM and volumetric elasticity, GPU soft bodies, shape matching,
    tearing, self-collision, two-way rigid coupling.

## Alternatives

- **XPBD.** Better compliance semantics, but extra per-constraint state; revisit if
  stiffness-vs-iterations proves insufficient.
- **Explicit mass-spring.** Stiff springs force tiny timesteps; loses on stability.
- **A 37 solver adapter.** Wrong seam: soft bodies have no rigid handles, joints or
  contact manifolds.
- **Write the transform instead of vertices.** Cannot express deformation.

## Consequences

`physics-soft` gains real dependencies (core, math, scene, geometry, motion). Spec revision
1.20 adds 35a and 113b. The TODO stub row closes when Phase 13a lands, not on this RFC.

## Compatibility analysis

- **Public API:** additive (`SoftBody`, `SoftBodySystem`, descriptors); `PACKAGE_NAME` kept.
- **Scene format and snapshots:** new optional component entry and snapshot section;
  old files unaffected.
- **Solver adapters / plugin API:** none.
- **Spec:** amendments row 1.20; check-spec allows `35a` and `113b`.

## Prototype / benchmark

None required for acceptance. W10.2 supplies a 1000-particle step benchmark and a
same-runtime checksum test.
