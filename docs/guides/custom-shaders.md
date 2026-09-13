# Custom shaders

§60 specifies a shader and node-material system: a node-based material graph,
reflection metadata, and safe shader/plugin boundaries (§96). **It landed.**
RFC 0001 (accepted 2026-08-21) shipped on 2026-08-28: the shader-graph IR and
the authoring builders live in `four/materials`, the §70 screen half in
`four/render`, and each GPU backend carries an opt-in emitter —
`registerNodeMaterialPipeline()` on WebGL 2 (2026-08-28) and
`registerWebgpuNodeMaterialPipeline()` on WebGPU (WP-R1.9, 2026-08-29). This
guide said "there is no custom shader API yet … expect a declarative surface
rather than raw string injection" until 2026-08-29; what landed is exactly
that declarative surface, so this is now the guide to it.

## The unit of extension is a graph, never a source string

Nothing in the public surface accepts GLSL or WGSL text, at any tier, and that
is the design rather than a gap (§96, made binding by spec revision 1.11):

- §57's `ShaderMaterial` is recorded as **permanently unshipped** (RFC 0001
  Q1, owner decision). `NodeMaterial` is the material family's one sanctioned
  extension surface.
- Shading is a `ShaderGraph` — a JSON-serializable IR over a **closed** set of
  operators (`packages/materials/src/shader-graph.ts`). An operator the
  repository has not implemented is a compile error, never a value a backend
  quietly drops; widening the set is a versioned, reviewed act.
- Because the graph is data, every texture it samples is enumerable
  (`analyzeShaderGraph`), which is what lets `RenderGraph.validate()` run its
  feedback and ordering checks over a custom pass exactly as over a built-in
  one. A scene document can carry a picture, never a program.

## A first node material

`NodeMaterialBuilder` is the fluent authoring surface; `build()` validates the
graph and wraps it in a `NodeMaterial`, which is an ordinary §57 material —
hand it to a `Renderable` like any other:

```ts
import { planeGeometry } from "fourJS/geometry";
import { NodeMaterialBuilder } from "fourJS/materials";
import { Renderable, Texture } from "fourJS/render";

const texture = new Texture({ width: 4, height: 4, data: rgbaBytes });

const builder = new NodeMaterialBuilder();
const albedo = builder.texture(texture); // sampled at the mesh uv by default
const tint = builder.uniform("tint", "vec3");
const pulse = builder.sin(builder.time().multiply(2)).multiply(0.5).add(0.5);
builder.output.color = albedo
  .multiply(builder.vec4(tint.multiply(pulse), 1))
  .saturate();

const material = builder.build();
material.setUniform("tint", [1, 0.6, 0.2]);

const quad = new Renderable(planeGeometry({ width: 1, height: 1 }), material);
```

Facts worth knowing before you fight them:

- **The graph is immutable** — frozen at construction. Changing shading means
  building a new graph and a new material; that is what makes a backend's
  program cache a pure function of the graph.
- **One program per distinct graph, however many materials share it.** Each
  `NodeMaterial` owns its own uniform values and texture bindings
  (`setUniform` / `setTexture`), uploaded per draw; writing them does **not**
  bump `Material.version`, exactly like the rest of §57's render state
  (RFC 0001 Q3 — per-_node_ values remain a separate deferred API).
- **Validation happens at setup, loudly** (§85). A broken graph is refused
  with a `RangeError` naming the node while the code that built it is on the
  stack — a backend never validates inside a frame (§61).
- `builder.time()` reads §9 **render** time, never simulation time: a shader
  is a rendering artefact, and nothing downstream of one may become simulation
  input (§42/§43).

## Registering a backend's node pipeline

The emitters are the largest modules either backend owns, so neither is linked
by default — an application opts in with one call per backend, the same seam
as `registerWebglRenderer()` and the §37 solver registry:

```ts
import { Application } from "fourJS/application";
import {
  registerNodeMaterialPipeline,
  registerWebglRenderer,
} from "fourJS/render-webgl";

registerWebglRenderer(); // §62 registry: "auto" can now pick WebGL 2
registerNodeMaterialPipeline(); // §60: links the GLSL emitter + program cache
// A §70 graph effect draws through this same node pipeline; the *fixed*
// effects (copy, grade, output transform) are a separate seam on WebGL 2 —
// `registerEffectPipeline()` (2026-09-11) — and are not needed for this page.

const app = new Application({ renderer: "auto", canvas });
await app.initialize();
```

On WebGPU the pair is `registerWebgpuRenderer()` and
`registerWebgpuNodeMaterialPipeline()` from `four/render-webgpu` (the WGSL
emitter, WP-R1.9). Registration compiles nothing: programs compile lazily, per
distinct graph, on the first draw that needs one.

**An unregistered node material is skipped, not drawn flat**, with a one-time
§85 development warning naming the fix. A graph the author wrote is a specific
picture, and drawing an unrelated one would be worse than drawing nothing
(RFC 0001 §4).

## The operator set, closed on purpose

Sources: `constant` (numbers and 2–4/9/16-component arrays), `uniform`,
`attribute`, `texture`/`sampler`, `time`. Structure: `vec2`/`vec3`/`vec4`
composition and `swizzle` (`xyzw` patterns). Math: the unary set `sin`, `cos`,
`abs`, `floor`, `fract`, `normalize`, `negate`, `saturate`, `length`; the
binary set `add`, `subtract`, `multiply`, `divide`, `min`, `max`, `dot`,
`step`; and `mix`. That is all of it — anything else is a compile error today
and a reviewed widening tomorrow.

Two domains, fixed at builder construction:

- **`"surface"`** (the `NodeMaterialBuilder` default) shades a `Renderable`
  and may read the four R-19 vertex attributes: `position`, `normal`, `uv`,
  `color`.
- **`"screen"`** shades a §70 full-screen pass; only `"uv"` is readable there
  (the pass's own normalized coordinate — there is no mesh).

Bounds, checked at validation: at most `MAX_SHADER_GRAPH_NODES = 1024` nodes
and `MAX_SHADER_GRAPH_TEXTURES = 8` distinct samplers per graph (§96 input
bounds — a graph is JSON a scene document may some day carry).

## Vertex displacement

A `"surface"` graph may assign `output.positionOffset` — a `vec3` object-space
displacement added to `position`:

```ts
const builder = new NodeMaterialBuilder();
const position = builder.attribute("position");
const wave = builder
  .sin(position.swizzle("x").multiply(6).add(builder.time()))
  .multiply(0.1);
builder.output.color = builder.constant([0.2, 0.5, 0.8, 1]);
builder.output.positionOffset = builder.vec3(0, wave, 0);
const material = builder.build();
```

A displacement is **not** a transform: §42's authority model is untouched and
the physics world is not told — a displacing material on a collider draws away
from where it collides, by decision (RFC 0001 Q4). Texture nodes cannot feed
`positionOffset` at this tier (the displacement runs in the vertex stage,
where implicit-derivative sampling does not exist); the graph is refused at
validation rather than left to a driver.

## Screen graphs: custom full-screen passes (§70)

The same IR in the `"screen"` domain is `GraphEffect` — §70's "custom
full-screen passes", as data, driven through the `RenderGraph` like every
built-in effect. `ShaderGraphBuilder` (the domain-agnostic base) authors it;
the `"source"` sampler is the pass's input, and uniform values live on the
pass:

```ts
import { ShaderGraphBuilder } from "fourJS/materials";
import { RenderGraph, RenderTarget } from "fourJS/render";

const sceneColor = new RenderTarget({ width: 512, height: 512 });

const screen = new ShaderGraphBuilder("screen");
const texel = screen.sampler("source");
const gain = screen.uniform("gain", "float");
screen.output.color = screen.vec4(
  texel.swizzle("xyz").multiply(gain),
  texel.swizzle("w"),
);

const graph = new RenderGraph();
graph.addPass("world", { root: scene, views, target: sceneColor });
graph.addPass(
  "warm",
  {
    kind: "effect",
    source: sceneColor.colorTexture,
    effect: { kind: "graph", graph: screen.graph(), uniforms: { gain: 1.2 } },
  },
  { inputs: ["world"] },
);
graph.execute(renderer);
```

A graph naming samplers beyond `"source"` declares each in
`GraphEffect.textures`, which is precisely what keeps the pass's full sample
set visible to `RenderGraph.validate()` — a `GraphEffect` pass does **not**
emit the `"opaque"` issue a `CustomRenderPass` does, because the graph can see
inside it. `"screen"` graphs must omit `positionOffset` (no vertices to move).

## Unlit at this tier, stated rather than softened

A node material does not see §68's directional light, the punctual lights, or
the scene ambient term — RFC 0001 §6 records this as the MVP's sharpest
limitation. It is enough for §70 effects, procedural colour, exact §58
gradients, UV animation and screen-space work; it is not the PBR path. For lit
surfaces use `LitMaterial` or `StandardMaterial`. R-17's light-uniform
contract exists (`PunctualLightUniforms`, WebGPU `LIGHT_UNIFORM_*`); node
emitters still do not consume it. Lighting-aware graphs remain RFC 0001
residue, not a missing-contract blocker.

## Reusable functions, variants, and diagnostics

`new ShaderFunction({ name, graph, parameters, result? })` defines a safe named
subgraph. Parameters name every uniform in the declaration; `result` defaults
to the graph's colour output and can instead select a typed intermediate node.
`fn.call(builder, ...arguments)` substitutes typed operands and remaps the
subgraph into the caller's scope. Repeating the same call with identical argument
expression handles reuses its result. Named samplers stay explicit resources.

The plugin registry accepts the same JSON-safe declarations through
`SHADER_OPERATORS` → `registerDefinition()`, with `getDefinition()` for lookup.
The closed operator set remains enforced at runtime as well as in TypeScript.

`new ShaderVariantSet({ warm: warmGraph, cool: coolGraph }).select("warm")`
selects a frozen graph alternative. Equivalent emitted sources share a backend
program; different alternatives retain independent reflection and resources.
This is a finite variant family, not an IR-level conditional/define facility.

Both emitters expose `sourceMap`: one-based line/column locations, graph node IDs,
and stages. GLSL maps are separated into `vertex` and `fragment`; WGSL has one
module map. WebGL compilation errors include these maps in their context.
`WgpuNodePipelineStore.compilationErrors` retains mapped asynchronous WebGPU
compiler errors; development warnings include the affected graph nodes.

## Uniform blocks

Call `builder.useUniformBlock()` before `graph()` or `build()` to select padded
std140 on WebGL. Uniform names, logical types, and `setUniform()` do not change.
Scalars/vectors occupy 16 bytes and matrices 64 bytes; surface materials upload
one block per draw. WebGPU already uses a block. Individual WebGL uniforms remain
the default. The deterministic 16-scalar measurement reduces upload calls from
16,000 to 1,000 over 1,000 draws while increasing payload from 64,000 to 256,000
bytes; this is not a GPU timing result. See the
[RFC 0001 addendum](../rfcs/0001-shader-extension-addendum.md) for the design,
measurement command, limits, and screen-effect upload behavior.

## What stays deferred

- Storage-buffer resources for graph shaders (§82, WebGPU).
- Lighting-aware graphs: scene lights are not automatically bound.
- IR-level Boolean conditionals and define specialization; finite named
  alternatives are available through `ShaderVariantSet`.
- Per-renderable uniform overrides: a shared material still shares values.

## Cross-references

- §60 (shader system), §60a (color management), §70 (post-processing), §96
  (security boundaries), §57 (material model); RFC 0001
  (`docs/rfcs/0001-shader-and-node-material-system.md`).
- `packages/materials/src/shader-graph.ts` — the IR and its validation rules;
  `packages/materials/src/node-material-builder.ts` — the builders;
  `packages/render-webgl/src/gl-node-program.ts` and
  `packages/render-webgpu/src/wgpu-node-program.ts` — the two emitters.
- [Materials and the render graph](materials-and-render-graph.md) for the
  material families and the render-list contract beneath all of this.
