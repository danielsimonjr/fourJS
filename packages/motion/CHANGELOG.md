# @fourjs/motion

## 0.2.0

### Minor Changes

- 3f48b1d: Add waypoint planning and steering, opt-in HarfBuzz text shaping, GPU raster snapshots, CPU skinning integrated with picking/culling/serialization, shader composition and diagnostics, regional/host texture updates and preparation, and WebGL normal/occlusion maps with glTF factors. Preserve default entry-point WASM isolation and explicitly retain unfinished roadmap items.

## 0.1.0

### Minor Changes

- 13748d1: Add optional `ForceField.sampleAll` (stride-3 SoA, binary64 out-params) so `ForceFieldSystem` can apply a §27 field to many bodies in one call, and fold steering's private intercept-time quadratic into `interceptTime`'s export via `{ onMiss, validateSpeed }`.

### Patch Changes

- Updated dependencies [13748d1]
  - @fourjs/scene@0.0.1
