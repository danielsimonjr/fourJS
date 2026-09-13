# @fourjs/physics

## 0.1.1

### Patch Changes

- Updated dependencies [3f48b1d]
  - @fourjs/motion@0.2.0

## 0.1.0

### Minor Changes

- 13748d1: Add optional `ForceField.sampleTorque` (always N·m) and per-entry `wakesSleepingBodies` so a field can twist a body and opt into waking sleepers without defeating §32. Route §42's `warnAuthorityConflict` through `devWarnOnce`.
- 13748d1: Add optional `ForceField.sampleAll` (stride-3 SoA, binary64 out-params) so `ForceFieldSystem` can apply a §27 field to many bodies in one call, and fold steering's private intercept-time quadratic into `interceptTime`'s export via `{ onMiss, validateSpeed }`.

### Patch Changes

- Updated dependencies [13748d1]
- Updated dependencies [13748d1]
  - @fourjs/scene@0.0.1
  - @fourjs/motion@0.1.0
