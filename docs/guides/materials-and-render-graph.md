# Materials and the render graph

This guide covers the material family that ships today, how a scene becomes
draw calls (render lists, §64–§66), and — honestly — how much of §57's
unified material model and §63's render graph exists at the tip. Short
version (rewritten 2026-08-29; the previous one predated every landing below
and still called PBR, shadows and the render graph "staged"): the §57
`Material` base is complete, five material classes ship — §59's
metallic-roughness `StandardMaterial` and §60's graph-driven `NodeMaterial`
(RFC 0001) included — the §63 render graph runs linear scene, custom and
§70 effect passes, §68 lighting covers a directional light plus up to eight
punctual lights with one §69 shadow tier, and two GPU backends (WebGL 2 and
WebGPU) consume the same render list.

## The shipped materials

Five material classes (`four/materials`) over a §57-complete `Material` base,
plus one instanced path for particles. This section said "two material
classes" and omitted `LitMaterial` until 2026-08-05, and "three" until
2026-08-29 — `StandardMaterial` (R-13, 2026-08-08) and `NodeMaterial`
(RFC 0001, 2026-08-28) had landed:

```ts
import { SpriteMaterial, UnlitMaterial } from "fourJS/materials";
import { Renderable, Sprite, Texture } from "fourJS/render";
import { planeGeometry } from "fourJS/geometry";

// Flat colour, straight (non-premultiplied) RGBA in 0..1 (§60a, §66):
const slab = new Renderable(
  planeGeometry({ width: 2, height: 1 }),
  new UnlitMaterial({ color: [0.16, 0.18, 0.24, 1] }),
);

// Recolour in place; setColor announces the change:
slab.material.setColor(0.1, 0.52, 0.45, 1);

// A textured quad. The texture is an RGBA8 buffer you own:
const texture = new Texture({ width: 6, height: 12, data: rgbaBytes });
const badge = new Sprite(new SpriteMaterial({ texture, tint: [1, 1, 1, 1] }), {
  width: 0.5,
  height: 1,
  anchor: { x: 0, y: 0 },
  renderLayer: 1, // draw after opaque shapes — sprites blend (§66)
});
```

The family, member by member:

- **`UnlitMaterial`** — one colour (optionally a texture map and vertex
  colours), no lights.
- **`SpriteMaterial`** — the sampled texture and a straight-RGBA tint;
  frame regions live on the `Sprite` node itself (below).
- **`LitMaterial`** — colour-only, mirroring `UnlitMaterial`, shaded by §68's
  directional light, `Scene.ambientLight`, and — since R-17 (2026-08-09) —
  up to eight point and spot lights (`MAX_PUNCTUAL_LIGHTS`,
  `packages/render/src/lights.ts`; this paragraph named only the one
  directional light until 2026-08-29). It needs geometry carrying the
  optional `normals` attribute — `boxGeometry` and `planeGeometry` generate
  per-face normals; 2D shapes stay unlit and position-only.
- **`StandardMaterial`** — §59's metallic-roughness workflow (R-13,
  2026-08-08): `baseColor` (plus an optional `map`), `metalness`,
  `roughness`, `emissive`. `normalMap` and `occlusionMap` are staged with
  recorded reasons (no tangent attribute yet; one texture unit per draw), and
  §59's physical extensions belong to a `PhysicalMaterial` that does not
  exist — see `standard-material.ts`.
- **`NodeMaterial`** — §60's shader-graph member (RFC 0001, 2026-08-28):
  shading is a serializable graph of closed operators, never a source string
  (§57's `ShaderMaterial` is **permanently unshipped** — spec revision 1.11).
  Unlit at this tier; the [custom shaders guide](custom-shaders.md) is the
  full story.

The base itself carries §57's shared render state on every member —
`opacity`, `transparent`, `blendMode` (`"normal"`, `"additive"`,
`"multiply"`, `"screen"`), `depthTest`, `depthWrite`, `colorWrite`, and
`stencil` (R-7, 2026-08-11) — with defaults that reproduce the pre-base
frame byte-for-byte.

Particles use `ParticleRenderable` (see the
[performance guide](performance-optimization.md)); geometry comes from
`four/geometry`'s `boxGeometry`, `planeGeometry`, and `circleGeometry2D`.

On WebGL 2, four of the backend's pipelines are **registration seams**
(2026-09-11, the `registerSkinningPipeline()` shape): call
`registerShadowPipeline()` before a light's `castShadow` can produce a map,
`registerEffectPipeline()` before a `RenderGraph` copy / grade /
output-transform pass will draw, `registerParticlePipeline()` before a
`ParticleRenderable` is drawn, and `registerStandardPipeline()` before a
`StandardMaterial` surface is drawn (an owner decision — §59 is a core
family, and the seam still pays for itself in every bundle that shades with
`LitMaterial` alone). Each is one explicit call at application setup, never
an import side effect; an unregistered feature is skipped with one
development warning naming the call (shadows fall back to unshadowed
lighting; effects, particles and standard surfaces to absence — never a
Lambert stand-in), and a bundle that never calls one carries none of that
pipeline. §60 graph effects go through `registerNodeMaterialPipeline()`
instead. WebGPU compiles all four eagerly.

```ts
import {
  registerEffectPipeline,
  registerParticlePipeline,
  registerShadowPipeline,
  registerStandardPipeline,
  registerWebglRenderer,
} from "fourJS/render-webgl";

registerWebglRenderer();
registerShadowPipeline(); // §69: the depth-only caster pass
registerEffectPipeline(); // §70: copy, colour grade, output transform
registerParticlePipeline(); // §36: instanced billboards, trails, R-32 appearance
registerStandardPipeline(); // §59: the metallic-roughness surface
```

Facts of this tier worth knowing before you fight them:

- **Blending on shapes and meshes is opt-in per material.** The base's
  `transparent: false` default leaves blending off; set `transparent: true`
  (with `opacity` and a `blendMode`) to blend. Sprites and particles blend by
  construction, flag or no flag. This bullet said blending was "enabled for
  sprites and particles only" and that an unlit material's alpha "never
  reaches a blend equation" until 2026-08-29 — stale since §57's base landed
  2026-08-06.
- **Announce in-place colour edits.** `setColor` bumps `material.version`;
  writing components directly into the colour array requires a
  `material.markDirty()` after (the discipline `unlit-material.ts` records).
  This bullet claimed an in-place edit was "picked up next frame without
  touching `material.version`" until 2026-08-29.
- **Atlases work through `sprite.frame`.** §55's `frame` sub-rectangle landed
  as R-29 (2026-08-08): a texel-space region, validated against the texture
  it indexes (§85), and changing it costs no geometry re-upload — which is
  what sprite flip-book animation needs. Named atlas containers and sprite
  animation clips are staged with reasons in `sprite.ts`. This bullet
  described cutting each atlas cell into its own small `Texture` as "the
  documented workaround" for an unlanded `frame` until 2026-08-29.

## From scene to draw calls (§64–§66)

There is no retained display list to manage. Each frame the renderer walks
the scene into a sorted **render list**:

```ts
import { buildInterpolatedRenderList, buildRenderList } from "fourJS/render";

const list = buildRenderList(scene, []); // live transforms
buildInterpolatedRenderList(scene, poses, alpha, list); // §43 render poses
```

For a skinned mesh the same call also refreshes the joint palette. Local
poses interpolate (position lerp, rotation slerp), then
`Skeleton.update(skinRoot, worldOf)` runs the palette product
`inverse(skinRootWorld) · boneWorld · inverseBind[i]`. Palettes are
**never** matrix-lerped — a 90° joint at `alpha = 0.5` is a 45° slerp,
not the average of two matrices — and nothing is written back into
`node.transform` (§42). The live-transform path (`buildRenderList`)
calls `update(skinRoot)` with no provider. See
[fixed-step simulation](fixed-step-simulation.md) for the pose buffer,
and `tests/integration/interpolated-skin-palettes.test.ts` for the
two-bone consumer check.

Items sort by §66's keys 1, 2 and 5 — **`renderLayer`, then opaque before
transparent (the material's `transparent` flag, since 2026-08-06), then
`renderOrder`** — and because `Array.prototype.sort` is stable, equal keys
fall back to generation (scene-graph) order: later siblings draw on top.
§66's other two keys ship as separate, opt-in verbs, for the recorded reason
that both permute co-planar draws a 2D scene depends on
(`render-list.ts`): key 3 (pipeline/material grouping) is
`groupRenderListByPipeline`, and key 4 (depth) is `sortRenderListByDepth` on
the per-view derived list (`view-list.ts`, R-8, 2026-08-09 — which is also
where frustum culling landed). This paragraph claimed a default sort "by
render layer, then kind (opaque unlit first, then blended sprites, then
particles), then material" until 2026-08-05; no such comparator has ever
existed, and until 2026-08-29 the correction overshot by claiming the sort
was `renderLayer`/`renderOrder` "and nothing else". The backend does track
the _current_ pipeline and only re-binds a program when the kind changes —
a per-run state-change saving on an already-ordered list, not a sort.

Two GPU backends consume the list (this paragraph named only one until
2026-08-29): the WebGL 2 backend (`WebglRenderer`, `four/render-webgl`) and
the WebGPU backend (`WebgpuRenderer`, `four/render-webgpu`), both with
cached GPU resources keyed by object identity and version; a particle item
becomes exactly one instanced draw whatever its count.

`Renderer` (§61) is the backend-independent interface; `NullRenderer` is the
headless implementation the determinism suites use. A backend registers
itself into `@fourjs/render`'s §62 registry only when the application calls
its `register*Renderer()` — `four/application` itself imports no backend at
runtime, which is what keeps headless bundles free of GL (R-2/A-8).

## Honest state of the rest

| §       | feature                            | state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §57–§59 | unified material model, PBR        | **§57 base complete** (seven members; `stencil` joined 2026-08-11, R-7) under five shipped classes, §59's metallic-roughness `StandardMaterial` among them (R-13; `normalMap`/`occlusionMap` staged). `PhysicalMaterial` and §59's physical extensions are not implemented; `ShaderMaterial` is permanently unshipped (rev 1.11). This row said "not implemented" beyond three classes until 2026-08-29                                                                                                                                                            |
| §60     | shader & node-material system      | **shipped** (RFC 0001, 2026-08-28): the `ShaderGraph` IR + `analyzeShaderGraph`, `NodeMaterialBuilder`, and `NodeMaterial`; the GLSL emitter registers via `registerNodeMaterialPipeline()` and the WGSL emitter via `registerWebgpuNodeMaterialPipeline()` (WP-R1.9, 2026-08-29). Unlit at this tier (sequenced R-14 → R-17 → R-13) — see [custom shaders](custom-shaders.md). This row said "not implemented" until 2026-08-29                                                                                                                                   |
| §62     | backends                           | WebGL 2 shipped; **`render-webgpu` shipped — the R-1 plan is complete** (WP-R1.1–R1.9, 2026-08-21…29), behind `registerWebgpuRenderer()`, with two honest absences (RFC 0003's skinned pipelines, §71 picking); `render-canvas` and `render-svg` remain reserved stubs. This row called `render-webgpu` "scaffold-only" until 2026-08-29 — stale since WP-R1.1 landed 2026-08-21                                                                                                                                                                                   |
| §63     | render graph                       | **shipped at the linear-pass tier 2026-08-07** (`RenderGraph` in `@fourjs/render`: named passes over R-4's target seam, declared `inputs` + discovered sampled-target validation, enable/disable, per-pass viewports, textual `describe()`). Transient targets, resource lifetimes, and barriers are staged with dated reasons in the module header. This row said "not implemented; the fixed pipeline is list → sort → draw" until 2026-08-07; the fixed pipeline is still what one pass runs                                                                      |
| §65     | batching                           | particles are instanced (one draw per system); **sprite and compatible-shape batching shipped opt-in** (R-9, 2026-08-09): `renderer.batching = createGlBatching()` (or `createWgpuBatching()`, WP-R1.3) merges consecutive draws sharing a pipeline (`unlit`/`sprite`) and a material instance into one draw — without the opt-in it stays one draw call per sprite. Instanced meshes for the shaded pipelines are staged (`batch.ts`). This row said "nothing else is batched" until 2026-08-29                                                                   |
| §68–§70 | lighting, shadows, post-processing | lighting: directional + ambient (2026-08-04) **plus up to eight punctual point/spot lights** (R-17, 2026-08-09) **plus one hemisphere** (2026-09-10; area/IBL/layers staged, `lights.ts`). Shadows (§69): **one tier shipped** — the directional light's depth-only shadow map with 3×3 PCF, on both GPU backends (R-18, 2026-08-09; on WebGL 2 behind `registerShadowPipeline()` since 2026-09-11). Post-processing (§70): **shipped as `RenderGraph` effect passes** — copy, colour grade, the §60a sRGB output transform (R-6/R-15; on WebGL 2 behind `registerEffectPipeline()` since 2026-09-11), and §60 graph effects (RFC 0001). This row said shadows and post-processing were "not implemented" until 2026-08-29 |

When the staged remainders land they are required to slot beneath the same
`Renderer` interface and render-list contract, so scene code written against
today's tier does not change.

## Practical guidance

- Author colours as straight-alpha RGBA in 0…1 and keep a palette; the
  examples' colour-discipline notes exist because tests read hue. Blending
  on shapes is a deliberate opt-in (`transparent: true`), not a default —
  a scene that never opts in renders byte-identically to the pre-§57 tier.
- Overlap is resolved by depth: push scenery behind bodies (negative Z) and
  marks in front, rather than relying on draw order.
- One material instance per logical surface; share materials across nodes
  that recolour together (the glyph cache in `examples/ui-demo` shares one
  material per distinct glyph cell). Sharing also feeds §65's opt-in
  batching, which merges only runs that share a material **instance**.

## Cross-references

- §55, §57–§60, §60a, §61–§66, §68–§70 — the normative text.
- [Custom shaders](custom-shaders.md) (§60), the
  [performance guide](performance-optimization.md) (§86, batching numbers),
  and `docs/COMPATIBILITY.md` section 2 (the per-backend §62 tables).
- `examples/first-2d-scene` (sprites + text), `examples/ui-demo` (skins over
  unlit quads), `examples/particles-demo` (instanced batching).
