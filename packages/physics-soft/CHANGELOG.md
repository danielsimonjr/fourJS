# @fourjs/physics-soft

## 0.1.0

### Patch Changes

- @fourjs/physics@0.1.0

### Patch Changes

- Updated dependencies [13748d1]
- Updated dependencies [13748d1]
  - @fourjs/physics@0.1.0

## Unreleased

- W10.1: RFC 0011 API skeleton: `SoftBody` component, `SoftBodySystem`, `PRIORITY_SOFT_BODY` (610), rope/cloth/pressure descriptors.
- W10.2: CPU position-based-dynamics solver for rope and cloth (distance and bending constraints, substeps x iterations, pin interpolation), `examples/soft-body` and a browser gate. `fixedUpdate` no longer throws `NOT_IMPLEMENTED`.
- W10.3: pressure/volume bodies, one-way raycast coupling to a `PhysicsWorld` (`world`, `particleRadius`), and `createSnapshot` / `restoreSnapshot` / `checksum`.
