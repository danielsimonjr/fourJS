# four

## 0.1.0

### Minor Changes

- b3ec9d6: §81 tokens for the five remaining extension points: `ASSET_LOADERS`, `SHADER_OPERATORS`, `UI_CONTROLS`, `EDITOR_TOOLS` (host-side, umbrella), and `COMPUTE_WORKLOADS`, each with a named registry. The umbrella re-exports the same objects.
- 3f48b1d: Add waypoint planning and steering, opt-in HarfBuzz text shaping, GPU raster snapshots, CPU skinning integrated with picking/culling/serialization, shader composition and diagnostics, regional/host texture updates and preparation, and WebGL normal/occlusion maps with glTF factors. Preserve default entry-point WASM isolation and explicitly retain unfinished roadmap items.

### Patch Changes

- 5737b7e: Add bounded raw gzip asset loading through an injected streaming decoder. Isolate asynchronous texture residency by GPU allocation and preserve identity shaping for custom character atlases without glyph-ID maps.

  Skip winding tests for points outside ring bounds, preserving exact containment while reducing disjoint-path fill work.

- Updated dependencies [b3ec9d6]
- Updated dependencies [5737b7e]
- Updated dependencies [d9347f2]
- Updated dependencies [3f48b1d]
- Updated dependencies [d9347f2]
  - @fourjs/assets@0.1.0
  - @fourjs/materials@0.1.0
  - @fourjs/ui@0.1.0
  - @fourjs/render@0.1.0
  - @fourjs/geometry@0.1.0
  - @fourjs/render-webgl@0.1.0
  - @fourjs/render-webgpu@0.1.0
  - @fourjs/text@0.1.0
  - @fourjs/motion@0.2.0
  - @fourjs/render-canvas@0.1.0
  - @fourjs/render-svg@0.1.0
  - @fourjs/animation@0.0.2
  - @fourjs/physics@0.1.1
  - @fourjs/physics-box2d@0.1.1
  - @fourjs/physics-rapier@0.1.1
  - @fourjs/physics-soft@0.1.1

## 0.0.2

### Patch Changes

- Updated dependencies [13748d1]
- Updated dependencies [13748d1]
- Updated dependencies [13748d1]
- Updated dependencies [871a545]
  - @fourjs/assets@0.0.1
  - @fourjs/physics@0.1.0
  - @fourjs/scene@0.0.1
  - @fourjs/motion@0.1.0
  - @fourjs/render-webgl@0.0.2
  - @fourjs/physics-box2d@0.1.0
  - @fourjs/physics-rapier@0.1.0
  - @fourjs/physics-soft@0.1.0
  - @fourjs/animation@0.0.1
  - @fourjs/diagnostics@0.0.1
  - @fourjs/input@0.0.1
  - @fourjs/particles@0.0.1
  - @fourjs/render@0.0.2
  - @fourjs/serialization@0.0.1
  - @fourjs/ui@0.0.1
  - @fourjs/render-canvas@0.0.2
  - @fourjs/render-svg@0.0.2
  - @fourjs/render-webgpu@0.0.2

## 0.0.1

### Patch Changes

- Updated dependencies [b4e0ac8]
  - @fourjs/render-webgl@0.0.1
