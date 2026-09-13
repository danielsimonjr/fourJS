# @fourjs/materials

## 0.1.0

### Minor Changes

- b3ec9d6: §81 tokens for the five remaining extension points: `ASSET_LOADERS`, `SHADER_OPERATORS`, `UI_CONTROLS`, `EDITOR_TOOLS` (host-side, umbrella), and `COMPUTE_WORKLOADS`, each with a named registry. The umbrella re-exports the same objects.
- 3f48b1d: Add waypoint planning and steering, opt-in HarfBuzz text shaping, GPU raster snapshots, CPU skinning integrated with picking/culling/serialization, shader composition and diagnostics, regional/host texture updates and preparation, and WebGL normal/occlusion maps with glTF factors. Preserve default entry-point WASM isolation and explicitly retain unfinished roadmap items.
