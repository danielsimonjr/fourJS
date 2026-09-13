# @fourjs/assets

## 0.1.0

### Minor Changes

- b3ec9d6: §81 tokens for the five remaining extension points: `ASSET_LOADERS`, `SHADER_OPERATORS`, `UI_CONTROLS`, `EDITOR_TOOLS` (host-side, umbrella), and `COMPUTE_WORKLOADS`, each with a named registry. The umbrella re-exports the same objects.
- 5737b7e: Add bounded raw gzip asset loading through an injected streaming decoder. Isolate asynchronous texture residency by GPU allocation and preserve identity shaping for custom character atlases without glyph-ID maps.

  Skip winding tests for points outside ring bounds, preserving exact containment while reducing disjoint-path fill work.

- d9347f2: Add runtime-capped PNG WebAssembly decoding and strict working-memory requirements
  for image, texture, and glTF loaders. Refuse uncappable platform callbacks before
  decoding when a finite working-memory budget is requested, and validate image
  output sizes and cleanup on rejection.
- 3f48b1d: Add waypoint planning and steering, opt-in HarfBuzz text shaping, GPU raster snapshots, CPU skinning integrated with picking/culling/serialization, shader composition and diagnostics, regional/host texture updates and preparation, and WebGL normal/occlusion maps with glTF factors. Preserve default entry-point WASM isolation and explicitly retain unfinished roadmap items.

## 0.0.1

### Patch Changes

- 13748d1: Warn once when `AssetManager.load` takes another reference on a settled cache slot (§83 duplicate asset loads). In-flight coalescing stays silent.
