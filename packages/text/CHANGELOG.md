# @fourjs/text

## 0.1.0

### Minor Changes

- 3f48b1d: Add waypoint planning and steering, opt-in HarfBuzz text shaping, GPU raster snapshots, CPU skinning integrated with picking/culling/serialization, shader composition and diagnostics, regional/host texture updates and preparation, and WebGL normal/occlusion maps with glTF factors. Preserve default entry-point WASM isolation and explicitly retain unfinished roadmap items.

### Patch Changes

- 5737b7e: Add bounded raw gzip asset loading through an injected streaming decoder. Isolate asynchronous texture residency by GPU allocation and preserve identity shaping for custom character atlases without glyph-ID maps.

  Skip winding tests for points outside ring bounds, preserving exact containment while reducing disjoint-path fill work.

- d9347f2: Restore harfbuzzjs 0.4.13, the supported ABI for the optional shaping adapter.
  The incompatible 1.x dependency update removed the explicit Wasm initialization
  and resource disposal APIs used by fourJS, preventing the adapter from loading.
- Updated dependencies [5737b7e]
- Updated dependencies [3f48b1d]
  - @fourjs/geometry@0.1.0
