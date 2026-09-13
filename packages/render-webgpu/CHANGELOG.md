# @fourjs/render-webgpu

## 0.1.0

### Minor Changes

- 3f48b1d: Add waypoint planning and steering, opt-in HarfBuzz text shaping, GPU raster snapshots, CPU skinning integrated with picking/culling/serialization, shader composition and diagnostics, regional/host texture updates and preparation, and WebGL normal/occlusion maps with glTF factors. Preserve default entry-point WASM isolation and explicitly retain unfinished roadmap items.

### Patch Changes

- 5737b7e: Add bounded raw gzip asset loading through an injected streaming decoder. Isolate asynchronous texture residency by GPU allocation and preserve identity shaping for custom character atlases without glyph-ID maps.

  Skip winding tests for points outside ring bounds, preserving exact containment while reducing disjoint-path fill work.

- Updated dependencies [b3ec9d6]
- Updated dependencies [3f48b1d]
  - @fourjs/render@0.1.0

## 0.0.2

### Patch Changes

- @fourjs/render@0.0.2
