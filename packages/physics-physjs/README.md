# @fourjs/physics-physjs

PhysJS solver adapters (2D and 3D, pure TypeScript). Part of [fourJS](../../README.md).

Implements RFC 0010 ([`docs/rfcs/0010-physjs-solver-adapter.md`](../../docs/rfcs/0010-physjs-solver-adapter.md)) behind the §37 solver seam. Depends on `@danielsimonjr/physjs`, pinned exactly at `0.5.0`.

## Status

Skeleton (packet W9.1). `PhysJSAdapter2D` / `PhysJSAdapter3D` declare the RFC's capability record (no cylinder/cone/hull/trimesh/heightfield/polyline/chain, no prismatic/rope, no limits/motors, no sensors, no collider offset, no `shapeCast`, speculative CCD only, no rolling/spinning friction) and `registerPhysJSSolver()` opts into `SolverRegistry`. Every operation throws `FourError("NOT_IMPLEMENTED")` until W9.2-W9.4.

`"physjs"` registered last keeps it last in the `"auto"` order.

Workspace name `@fourjs/physics-physjs`; publishes as `@danielsimonjr/fourjs-physics-physjs`.
