# @fourjs/materials

Materials and shading. Part of [fourJS](../../README.md).

Implements the MVP tier of §57–60 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped in Phases 3 and 3a.

## What's here

- **`Material`** — the §57 base: the seven shared members (`stencil` among them, R-7) every class below extends.
- **`UnlitMaterial`** — flat-color material (`ColorRGBA`, re-exported from `@fourjs/math`); color is read per draw, so in-place tuple animation works.
- **`SpriteMaterial`** — textured-quad material over the `SpriteTexture` contract (§55/§77 MVP tier), used by `@fourjs/render`'s `Sprite`.
- **`LitMaterial`** (§68, 2026-08-04) — the Lambert diffuse tier: `color × (ambient + lightColor · max(N·−L, 0))`.
- **`StandardMaterial`** (§59, 2026-08-08) — glTF-compatible metallic-roughness: `baseColor`, `metalness`, `roughness`, `emissive`, and the `map` / `metalRoughnessMap` / `emissiveMap` / `normalMap` / `occlusionMap` slots. On WebGL 2 it draws behind `registerStandardPipeline()`; without that call the renderer **skips** those draws and says so (§59).
- **`StencilState`** (§57, 2026-08-21) — the per-material stencil packet, with `MAX_STENCIL_VALUE`.
- **The node-material shader system** (§60, RFC 0001, 2026-08-28) — `ShaderGraphBuilder` / `ShaderExpression` / `ShaderFunction` / `ShaderOperatorRegistry` build the IR, `analyzeShaderGraph` + `freezeShaderGraph` + `forEachShaderNodeReference` validate and walk it, `NodeMaterialBuilder` compiles it into a `NodeMaterial`, and `ShaderVariantSet` + `createShaderSourceMap` carry the variants. Bounds are `MAX_SHADER_GRAPH_NODES` / `MAX_SHADER_GRAPH_TEXTURES`; the emitters register from the backends (`registerNodeMaterialPipeline()`, `registerWebgpuNodeMaterialPipeline()`).
- **`liveMaterialCount`** (§83) — the material half of the resource-accounting pair.

_Corrected 2026-09-19 (dogfood cycle 9): this section listed only `UnlitMaterial` and `SpriteMaterial`, and the section below called `StandardMaterial`, lighting and the node-material system "staged". All three had shipped — lighting on 2026-08-04, `StandardMaterial` on 2026-08-08, the node-material system on 2026-08-28. Measured from a consumer seat against the staged, packed, installed packages: the `fourJS/materials` subpath resolves **26** exports, and an `UnlitMaterial`, a `LitMaterial` and a `StandardMaterial` drew **20,128**, **14,923** and **6,636** pixels in one WebGL 2 frame in Chrome. [`docs/guides/materials-and-render-graph.md`](../../docs/guides/materials-and-render-graph.md) had already been corrected; this file had not._

## Staged / not yet implemented

- `PhysicalMaterial` and §59's physical extensions (clearcoat, transmission, sheen). `ShaderMaterial` is permanently unshipped (spec rev 1.11).
- §55 texture frame regions — sprites currently map whole textures; the paints/fills/strokes model of §58.

Unit tests are colocated in `tests/` per §92.

Workspace name `@fourjs/materials`; publishes as `@danielsimonjr/fourjs-materials`.
