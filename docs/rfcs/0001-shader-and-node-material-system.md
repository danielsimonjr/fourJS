# RFC 0001: Shader and node-material system (§60)

- **Status:** accepted (owner, 2026-08-21 — "Continue with the remaining WPs and the RFCs"; the recommended dispositions of the flagged questions are adopted)
- **Date:** 2026-08-07
- **Owner decision:** accepted 2026-08-21; implemented 2026-08-28 (R-14 closed)
- **Spec sections affected:** §60 (primary), §57, §53, §61–§64, §66, §70, §79, §85, §89, §90, §92, §96, §98, §120

## Context

Gap `R-14` states the position without softening it: _"Nothing in the shipped surface accepts user GLSL or WGSL. The four programs (`UnlitProgram`, `LitProgram`, `SpriteProgram`, `ParticleProgram`) are compiled from string constants private to `packages/render-webgl/src/gl-program.ts` and `gl-particles.ts`. None of §60's compiler … node graph, reusable functions, uniform blocks, storage buffers, conditional variants, reflection metadata, or source maps exists."_ The gap doc classifies it **blocker for the "advanced users" §60 names, and the root cause of R-1's cost and R-6's impossibility**, effort **L — the largest single item in the domain**, and prescribes _"RFC first (the guide already flags the §96 constraint: declarative, not raw string injection). Sequence R-12 → R-14 → {R-1, R-6, R-13}."_

`R-12` (the abstract `Material` base) landed: `packages/materials/src/material.ts` now exports `abstract class Material` with an `abstract readonly kind: string` discriminant and a documented `class GlowMaterial extends Material` example. §57's family is therefore **open to a new member** — which is the precondition this RFC consumes, and which means `NodeMaterial` is an addition rather than a restructuring.

Three things that landed on **2026-08-07** constrain the design directly, and this RFC is written to build on them rather than around them:

1. **`ScreenEffect` is a closed union, and widening it is named as this RFC's job.** `packages/render/src/effect-pass.ts:69` says so in the module header: _"user-authored shader source is R-14's RFC (§60) … `ScreenEffect` is a **closed union** so that widening it is that RFC's job and an unsupported request is a compile error today, not a silent no-op."_ The recorded rationale is stronger than convenience: _"a JSON value must not become a different picture"_ (MEMORY, R-6).
2. **R-19's byte-identity property.** _"Textured meshes are a uniform switch, not shader variants (`useMap`/`useVertexColors` on the one unlit/lit program each): the CPU-mirrored default at GL's initial `0` is what keeps an untextured scene's GL sequence byte-identical, which is what let R-19 land under the pixel-golden gate."_ Any new pipeline must leave that sequence alone for scenes that do not use it.
3. **R-5/R-6's validation model, and its recorded principle: an effect the graph cannot see inside must report its own opacity.** `RenderGraph.validate()` runs the real `buildRenderList` and reads `isRenderTargetTexture`, _"seeing what the backend sees"_; `CustomRenderPass` _"always emits an `\"opaque\"` info issue; a graph that stopped being checkable says so."_

That third point is the whole argument of this RFC, so it is worth stating as a sentence rather than a citation: **a shader expressed as a string is an opaque pass, and a shader expressed as a graph is a checkable one.** If §60 ships as GLSL source injection, every §70 effect written by a user becomes `CustomRenderPass`-grade — the render graph can no longer tell which targets a pass samples, so it can no longer refuse a feedback loop (R-4's _"feedback loops are refused, not drawn"_) or report a read-before-write. The declarative form is not merely §96 compliance; it is what keeps the machinery R-4/R-5/R-6 built in the last week from being switched off by its first advanced user.

`docs/guides/custom-shaders.md` already promises this shape publicly: _"When §60 lands it must respect §96 (no arbitrary code execution from scene files; safe shader boundaries), so expect a declarative surface rather than raw string injection."_ This RFC is the decision that makes the promise binding.

Downstream, `R-14` gates `R-1` (further backends — _"a second backend without a backend-independent shader model duplicates all four pipelines by hand"_), `R-6`'s remaining eight §70 effects, and `R-13` (§59 PBR, whose extension list is a shading-model problem before it is a texture problem).

## Proposed decision

### 1. The unit of extension is a serializable graph, not a source string

Add `packages/materials/src/shader-graph.ts`: a **backend-independent, JSON-serializable shader IR**, and the fluent builder §60's example uses. Nothing in the public surface accepts GLSL or WGSL text, at any tier, in this RFC.

`@fourjs/materials` is the home §98 assigns (_"`materials`: material families, paints, node materials, color management (§60a)"_), and its §3.1 row is `core, math` — no scene, no geometry, no render. A pure data IR fits that row exactly and **adds no §3.1 edge**: `render` already depends on `materials` (wave 3), and `render-webgl`'s row is `core, math, render`, so a backend reads the IR through the type `render` already re-exposes. This is the same legality argument the §62 registry made (_"The §3.1 matrix is unchanged and no edge is added"_).

```ts
/** A node's identity inside one graph — its index in `ShaderGraph.nodes`. */
export type ShaderNodeId = number;

/** The value shape flowing along an edge (§60 "reflection metadata"). */
export type ShaderValueType =
  "float" | "vec2" | "vec3" | "vec4" | "mat3" | "mat4";

/**
 * Which stage inputs a graph may name (§60 "vertex attributes"), and therefore
 * which emitter validates it. `"surface"` graphs shade a `Renderable`;
 * `"screen"` graphs shade a §70 full-screen pass and have no geometry at all.
 */
export type ShaderDomain = "surface" | "screen";

/**
 * One operator, as a closed discriminated union — closed for exactly the reason
 * `ScreenEffect` and `RenderTargetFormat` are: an operator this repository has
 * not implemented must be a compile error, never a value a backend receives and
 * quietly drops.
 */
export type ShaderNode =
  | {
      readonly kind: "constant";
      readonly type: ShaderValueType;
      readonly value: readonly number[];
    }
  | {
      readonly kind: "uniform";
      readonly type: ShaderValueType;
      readonly name: string;
    }
  | { readonly kind: "attribute"; readonly name: ShaderAttributeName }
  | {
      readonly kind: "texture";
      readonly name: string;
      readonly uv: ShaderNodeId;
    }
  | { readonly kind: "time" }
  | {
      readonly kind: "compose";
      readonly type: ShaderValueType;
      readonly parts: readonly ShaderNodeId[];
    }
  | {
      readonly kind: "swizzle";
      readonly source: ShaderNodeId;
      readonly pattern: string;
    }
  | {
      readonly kind: "unary";
      readonly op: ShaderUnaryOp;
      readonly source: ShaderNodeId;
    }
  | {
      readonly kind: "binary";
      readonly op: ShaderBinaryOp;
      readonly left: ShaderNodeId;
      readonly right: ShaderNodeId;
    }
  | {
      readonly kind: "mix";
      readonly a: ShaderNodeId;
      readonly b: ShaderNodeId;
      readonly t: ShaderNodeId;
    };

export type ShaderAttributeName = "position" | "normal" | "uv" | "color";
export type ShaderUnaryOp =
  | "sin"
  | "cos"
  | "abs"
  | "floor"
  | "fract"
  | "normalize"
  | "negate"
  | "saturate"
  | "length";
export type ShaderBinaryOp =
  "add" | "subtract" | "multiply" | "divide" | "min" | "max" | "dot" | "step";

/** A validated graph: nodes in insertion order (§33), plus its two outputs. */
export interface ShaderGraph {
  readonly domain: ShaderDomain;
  readonly nodes: readonly ShaderNode[];
  /** `vec4`, required. The fragment result, in the domain's colour space (§60a). */
  readonly color: ShaderNodeId;
  /**
   * `vec3` object-space displacement added to `position`, or `undefined`.
   * `"screen"` graphs must omit it — a full-screen pass has no vertices to move.
   */
  readonly positionOffset?: ShaderNodeId;
}
```

`ShaderAttributeName`'s four members are exactly R-19's four fixed locations (_"0 position, 1 normal, 2 uv, 3 colour"_). §53's remaining standard attributes (tangent, secondary uv, joints/weights, instance transform) are unnameable until the packets that add them land — the same closed-union staging, applied to the attribute set.

### 2. `NodeMaterial` is a §57 family member; `ShaderMaterial` is deliberately not implemented

```ts
export class NodeMaterial extends Material {
  readonly kind = "node" as const;

  /** Frozen at construction — see "The graph is immutable" below. */
  readonly graph: ShaderGraph;

  constructor(graph: ShaderGraph, options?: NodeMaterialOptions);

  /** Uniform values by `uniform`-node name; validated against the graph (§85). */
  setUniform(name: string, value: number | readonly number[]): this;
  setTexture(name: string, texture: MaterialTexture | null): this;
}
```

§60's own example must compile against this API — the Part X example-compilation discipline (`A-22`/`PH-18`) applies to §60's snippet as much as to §114's. The builder is therefore the authoring surface, and the graph is its output:

```ts
const material = new Four.NodeMaterialBuilder();
const albedo = material.texture(albedoTexture);
const pulse = material.sin(material.time().multiply(2));
material.output.color = albedo.multiply(pulse.add(1));
const built = material.build(); // NodeMaterial
```

§57 lists **both** `ShaderMaterial` and `NodeMaterial`. This RFC implements the second and proposes that the first stay unimplemented, because `ShaderMaterial` has no meaning other than "raw source" and every argument in this document is an argument against it. That is a deliberate departure from §57's family list and is raised under **Open questions**.

**The graph is immutable.** A `ShaderGraph` handed to a `NodeMaterial` is frozen; changing shading means building a new graph and a new material. This is what makes the program cache a pure function of the graph and keeps `Material.version`'s meaning intact (F14: _"render state is read per draw, never cached"_ — a mutable graph would make the _program_ cacheable on a counter that deliberately does not move).

### 3. Compilation lives in the backend, cached by structural hash

`packages/render-webgl/src/gl-node-program.ts` emits GLSL ES 3.00 from a `ShaderGraph` and caches the compiled program under a **structural hash of the graph** — not under the material's `id`. A thousand `NodeMaterial`s sharing one graph share one program; their uniform values differ per draw. This is the same CPU-descriptor/GPU-cache split `GeometryCache`, `TextureCache`, and `RenderTarget` already use (MEMORY, R-4: _"a render target is a CPU-side descriptor; the framebuffer is a backend cache"_ — this is the fourth instance).

Emission rules, all of them load-bearing:

- **Nodes are visited in `nodes` array order** (§33: _"simulation code must iterate collections in insertion order and must not derive behavior from object-key enumeration or `Set`/`Map` ordering"_). The rule is written for simulation; applying it to the emitter is what makes the emitted source, and therefore the structural hash, and therefore the program cache, a deterministic function of the graph.
- **The MVP compiler performs no algebraic optimisation.** Dead-node elimination (unreachable from `color`/`positionOffset`) is the only transform. Reassociating float expressions changes pixels, and §92's pixel-golden tier would then be gated on a compiler's mood.
- **`time()` reads §9 render time, never simulation time**, and is documented as such at the type. A graph is a rendering artefact; §42/§43's _"render interpolation never feeds back into physics state"_ means nothing downstream of a shader may become simulation input.
- Compilation failure raises `SHADER_COMPILATION_FAILED` (§89, already in `FourErrorCode`) with the emitted source and the driver log in `context` — §60's _"readable compiler diagnostics"_, at the tier available without source maps.

### 4. Coexistence with the uniform-switch design: a separate pipeline, compiled lazily, registered explicitly

R-19's byte-identity property is preserved by construction, in three steps.

**(a) A node material is its own pipeline, not a uniform on an existing one.** `RenderItemKind` gains `"node"`; `pipelineOf` in `packages/render/src/render-list.ts` maps `material.kind === "node"`. It cannot be a `useNodeGraph` uniform on `UnlitProgram`, because the point of the uniform switch is that `useMap`/`useVertexColors` select between _two behaviours already compiled into one program_; a graph is an unbounded set of behaviours, and there is no uniform that expresses "and now run these forty instructions instead".

**(b) The node program is compiled on first node-material draw, not at renderer initialisation.** A scene containing no `NodeMaterial` therefore issues the identical GL call sequence it issues today — the property R-19 landed under and F13 re-proved with a 449-call comparison. The packet must re-prove it the same way, and must add a golden for it.

**(c) The compiler is reached through an explicit registration call, not a static import from the renderer.** `packages/render-webgl/src/node-pipeline-registry.ts` exports `registerNodeMaterialPipeline()`; `webgl-renderer.ts`'s `"node"` branch resolves through a lazily-created module `let` that **never statically references the compiler**, exactly as `resolveRenderer` never statically references `RendererRegistry`.

Step (c) exists because of a measured fact recorded on the same day: _"a fifth compiled-at-init pipeline costs **0.75 kB gzip in every example bundle** — nothing reachable from a class method tree-shakes … Even a stubbed `renderEffect` exceeded ui-demo's 30 kB by 99 B."_ A GLSL emitter is not 0.75 kB; it is the largest new module in the backend. Lazy _compilation_ fixes the GL sequence but not the bundle, because the emitter is still reachable from `WebglRenderer.render`. Only an explicit registration call — the value a bundler can see being used — keeps it out of the seventeen example bundles that will never draw a node material. This applies the **explicit registration, never a side-effect import** rule (2026-08-07, forced by `"sideEffects": false` on all 24 packages) to a third registry, and the packet must produce the same grep-proven evidence the §62/§37 registries did.

**An unregistered node material is skipped with a one-time `§85` warning, not drawn flat.** `pipelineOf`'s existing fallback (_"a family member no backend knows yet keeps drawing flat-coloured rather than vanishing"_) is the wrong behaviour for this case and must be excluded from it: a graph the author wrote is a specific picture, and drawing an unrelated one is R-6's _"a JSON value must not become a different picture"_ in the material domain. Skipping matches how the backend already treats an unknown `ScreenEffect` kind and a feedback-looping sprite.

### 5. `ScreenEffect` gains exactly one member, and the graph keeps the pass checkable

```ts
/** §70's "custom full-screen passes", as data. */
export interface GraphEffect {
  readonly kind: "graph";
  readonly graph: ShaderGraph; // domain must be "screen"
  readonly uniforms?: Readonly<Record<string, number | readonly number[]>>;
}

export type ScreenEffect = CopyEffect | ColorGradeEffect | GraphEffect;
```

The union stays closed. It gains one member whose payload is itself a closed structure, so `{ kind: "bloom" }` is still a compile error and `custom full-screen passes` moves from _staged_ to _shipped_ in `effect-pass.ts`'s §70 table.

`"screen"`-domain validation is where R-5/R-6's model is honoured rather than escaped:

- The `attribute` node is **rejected** in the screen domain (there is no mesh); the pass's inputs are `texture` nodes and `uniform` nodes only.
- `texture` nodes name their sampler. `EffectRenderPass` carries exactly one `source` today; a graph effect may name additional textures, and `validateEffectRenderPass` resolves each name against the pass's declared inputs. **Every texture a graph samples is enumerable from the graph**, which is precisely what a source string would destroy.
- Therefore `RenderGraph.validate()` can run the existing feedback check over a graph effect's full sample set, and a `GraphEffect` pass **does not emit an `"opaque"` info issue**. That asymmetry against `CustomRenderPass` is the recorded principle applied in the affirmative: the escape hatch reports its opacity because the graph cannot see inside it; a node graph does not, because the graph can.

### 6. What the MVP packet ships and what it defers

| §60 requirement              | MVP packet                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| node graph                   | **ships** — the IR above, the fluent builder, `NodeMaterial`, §85 validation                                                                     |
| GLSL ES generation (WebGL 2) | **ships** — both domains                                                                                                                         |
| WGSL generation (WebGPU)     | **defers** — there is no WebGPU backend (`render-webgpu` is a reserved stub, `R-1`). Emitting WGSL nothing can run is untestable by construction |
| reduced Canvas/SVG fallbacks | **defers** — both backends are reserved stubs; §60 says "where meaningful" and nothing is meaningful against a stub                              |
| uniforms                     | **ships** — individual uniforms, reflected from the graph                                                                                        |
| uniform blocks               | **defers** — a UBO is a layout decision (std140 padding) worth making once, with a measurement, not speculatively                                |
| textures and samplers        | **ships** — through `MaterialTexture`, so `RenderTarget.colorTexture` works as a graph input with no adapter (R-4's seam)                        |
| vertex attributes            | **ships**, restricted to R-19's four fixed locations; widens with §53's remaining attributes                                                     |
| reflection metadata          | **ships** — `ShaderReflection { uniforms, textures, attributes }`, because uniform binding needs it anyway and withholding it would be arbitrary |
| reusable functions           | **defers** — a named subgraph needs its own emission scope and a call-site cache key; inlining covers the MVP                                    |
| conditional variants         | **defers** — a variant key is a second cache dimension; one program per graph until a consumer has measured the need                             |
| storage buffers              | **defers** — §82 compute, which is WebGPU-only                                                                                                   |
| source maps                  | **defers** — line mapping needs the emitter to carry provenance per node; the error path ships source + driver log instead                       |
| lighting integration         | **defers** — a node material in the MVP is **unlit**: it does not see §68's directional light or `Scene.ambientLight`. Stated at the type        |

The last row is the MVP's sharpest limitation and it should not be softened. A node material that cannot be lit is enough for §70 effects, procedural colour, UV animation, and screen-space work, and is _not_ enough for `R-13`'s PBR path. Lighting-aware graphs need a light-uniform contract that §68's one-light tier does not have yet (`R-17`), so sequencing is `R-14` → `R-17` → `R-13`, and this RFC does not pretend otherwise.

## Alternatives

**A. Raw GLSL/WGSL strings (`ShaderMaterial`, `onBeforeCompile`-style chunk injection).** The obvious design, and the one every comparable engine ships. It loses on four independent counts, any one of which is sufficient: (1) §96 requires _"no arbitrary code execution from scene files"_ and _"safe shader/plugin boundaries"_ — a source string in a `.four.json` is exactly the thing §96 names; (2) it makes every user pass opaque to `RenderGraph.validate()`, switching off the feedback and resource checks R-4/R-5/R-6 built, which is the recorded _"a graph that stopped being checkable says so"_ principle inverted; (3) it is not backend-independent, and §60's own first sentence is _"advanced users require a backend-independent shader model"_ — a GLSL string is a WebGL asset, so the shipped scene stops being portable to the WebGPU backend `R-1` exists to add; (4) it pins the internal program sources as public contract, which `docs/guides/custom-shaders.md` explicitly disclaims (_"their GLSL is not part of the public contract and may change without notice"_). Chunk injection loses on (2), (3), and (4) with extra force, since a chunk is only meaningful against a specific internal shader.

**B. A fixed catalogue of parameterised effects and materials, no graph.** This is what the shipped `ScreenEffect` union already is, and it is honest at the current tier. It loses because it does not close the gap: `R-14` is filed as _"blocker for the 'advanced users' §60 names"_, and a catalogue can only ever serve the users the catalogue anticipated. It also fails to unblock `R-1`: a second backend still hand-writes every pipeline.

**C. Put the IR in `@fourjs/render` rather than `@fourjs/materials`.** Tempting because compilation is a rendering concern. It loses on §98 (which assigns _"node materials"_ to `materials`) and on §3.1: `materials` sits in wave 2 with `core, math`, so an IR there is visible to every package that can see a material, while an IR in `render` (wave 3) would be invisible to `@fourjs/materials` itself — and `NodeMaterial` must live beside the other family members, or §57's family is split across two packages for no reason a reader could reconstruct.

**D. Compile at `NodeMaterial` construction rather than at first draw.** Simpler error reporting: a bad graph throws where it was written. It loses because `@fourjs/materials` has no `render` dependency and must not acquire one — a material that compiled GLSL would be a WebGL material, defeating the point. Validation of the _graph_ still happens at construction (§85, the R-5 precedent of setup-time checks); only emission is deferred to the backend that knows the language.

**E. Make the node-kind union open (a `custom` node carrying an emitter callback).** Would let a plugin add operators without a spec change — attractive against `A-3`'s §81 point _"materials and shader nodes"_. It loses at this tier because an emitter callback is a function that produces source text, which reintroduces alternative A through a side door: a graph containing one is no longer serializable, no longer portable across backends, and no longer checkable. The extensible-operator tier is a real want and is deferred to a follow-up RFC, gated on a design where a custom node declares its _signature and semantics_ as data. RFC 0002 records the dependency in the other direction.

**F. A fifth compiled-at-init program instead of lazy + explicit registration.** Simplest backend code. It loses on the measured 0.75 kB-per-bundle figure recorded for `renderEffect`, and the emitter is far larger; it would tax every example that never writes a shader, which is currently all of them.

## Consequences

**Easier.** `R-6`'s remaining §70 effects stop being blocked on API shape and become blocked only on resources (float targets, MRT, depth textures) — several of them (distortion, a simple outline over a supplied edge texture) become expressible the day this lands. `R-1` gains the backend-independent model without which a second backend re-implements four pipelines by hand. `R-13` gains the surface a PBR material will eventually be authored against. §79 gains, for the first time, a way for a scene file to carry custom shading _without_ carrying code — the §96-safe answer to a question that otherwise has none.

**Harder.** The WebGL backend acquires a compiler, which is the largest new module it has had; the packet is honestly **L**, and it is the largest single item in the render domain by the gap doc's own estimate. Every emitter rule above (visit order, no reassociation, no algebraic simplification) is a constraint on future optimisation work: making the compiler smarter later means re-baselining the pixel goldens, which is a cost this RFC accepts deliberately rather than discovers later. The bundle discipline (explicit registration, module `let`, no static reference) is now load-bearing in a third place and _"breaking it silently regresses every example"_.

**Committed to.** A closed operator union whose growth is a versioned, reviewed act; an immutable graph; no user source text at any tier without a new owner decision; and the property that a `GraphEffect` pass is exactly as checkable as a built-in one.

## Compatibility analysis

Rows in `docs/COMPATIBILITY.md` this RFC moves:

- **WebGPU/WebGL feature tiers (§62).** No capability is added or required by the MVP: the emitter targets GLSL ES 3.00, which the WebGL 2 backend already requires. A later WGSL emitter moves this row; this packet does not.
- **Scene format versions (§79).** **Unmoved by decision.** `NodeMaterial` is _not_ serialized in this packet. Materials are not serialized at all today (`packages/fourjs/src/scene-serializers.ts` covers the nine §73 widgets, five components, and node types; _"camera, light, sprite and renderable node types are still absent (A-16)"_), so adding the first material serializer here would bundle two unrelated decisions. When it lands, a `ShaderGraph` is already JSON by construction and carries its own `domain`, which is what makes it a safe payload under §96.
- **Plugin API versions (§81).** Unmoved. RFC 0002 discusses the interaction: §81's _"materials and shader nodes"_ extension point is only partly served by this RFC, because a plugin can supply a _graph_ (data) but not an _operator_ (alternative E, deferred).
- **Physics solver adapters.** Untouched — no regeneration of the generated block needed.

Public API effects, in §90 terms:

| Change                                                                      | §90 class                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New exports from `@fourjs/materials` (`ShaderGraph`, `NodeMaterial`, builder) | **minor** — additive                                                                                                                                                                                                                                                                                                |
| `ScreenEffect` gains `GraphEffect`                                          | **minor for applications** (the union is a parameter position: every existing value still type-checks) — but **breaking for any exhaustive `switch` over `ScreenEffectKind` in third-party code**, including a third-party backend. Called out because the type is exported precisely so callers can switch over it |
| `RenderItemKind` gains `"node"`                                             | same shape: additive for producers, breaking for an exhaustive consumer. `RenderItemKind` is exported and `isUnlitItem`-style guards exist, so most consumers are unaffected                                                                                                                                        |
| `RendererCapabilities`                                                      | unchanged in this packet                                                                                                                                                                                                                                                                                            |

**Determinism (§33).** Shading is outside the determinism envelope by §42/§43 — _"render interpolation never feeds back into physics state"_ — and no API in this RFC returns a shaded value to the CPU, so GPU float behaviour is not a §33 hazard. Three genuine §33 obligations remain, and they are on the _compiler_, not the shader: (1) node visitation is array order, never `Map`/`Set` enumeration, so the emitted source is a pure function of the graph; (2) the structural hash used as the program-cache key is computed over that same ordered walk, so cache hits do not depend on construction history; (3) `time()` is §9 **render** time and is typed and documented as such, so a graph cannot become a hidden simulation input. The §92 determinism suites need no new golden; the §92 **pixel-golden** tier needs one new baseline per shipped example graph, and the byte-identical-GL-sequence test from R-19/F13 must be extended with a no-node-material case.

## Prototype / benchmark

None run; this RFC is a design decision ahead of the packet, and §95 item 6 asks for evidence _where practical_. What the packet must measure, stated now so it cannot be skipped:

1. **The byte-identical GL sequence** for a scene with no `NodeMaterial`, by the same method F13 used (call-sequence comparison, 449 calls in that instance) — this is the acceptance gate, not a nice-to-have.
2. **Bundle delta with and without `registerNodeMaterialPipeline()`**, grep-proven absent from the un-registering bundles, in the A/B style the §62 registry packet used (which reported +0.2–0.3 kB instance / +0.78 kB `"auto"`). If the compiler cannot be kept out of a non-using bundle, decision (c) has failed and the RFC needs revisiting before the packet completes.
3. **Program-cache behaviour under many materials sharing a graph** — the claim is one program for N materials; assert it as a compile count, not as prose.

## Open questions

1. **Should `ShaderMaterial` (§57) ever exist?** This RFC proposes it stay unimplemented indefinitely and that §57's family list get an amendment note saying so. The alternative is a source-string material behind an explicit opt-in that documents its §96 and §63 costs. Owner call: amend §57, or keep the row and accept that it is permanently unshipped.
2. **Extensible operators.** Alternative E is deferred, but §81's _"materials and shader nodes"_ extension point names it directly and RFC 0002 has to say something about it. Is a data-declared custom node (signature + a per-backend emission template, still not free-form source) worth a follow-up RFC, or is the closed set the permanent answer?
3. **Uniform-value ownership.** `NodeMaterial.setUniform` puts values on the material, which means a material shared by a thousand draws has one value. §60's `material.time()` suggests per-frame values; per-_node_ values would need a per-drawable uniform block and would change `RenderItem`'s shape. Confirm that per-material is the intended tier for the MVP.
4. **`positionOffset` and physics.** A graph may displace vertices; nothing tells the physics world. This RFC's position is that it must not — §42's authority model says the transform is owned by one system and a vertex displacement is not a transform. Confirm that no §85 warning is wanted when a `NodeMaterial` with `positionOffset` is attached to a node carrying a collider.
5. **Whether §60 needs an amendments-table row.** Nothing in §60's text is contradicted by this RFC, but "no raw shader source" is a normative narrowing of _"advanced users require a backend-independent shader model"_ that a reader would benefit from finding in the spec rather than only here.

## Post-acceptance corrections (2026-09-10 review pass)

The decision text above is the record as accepted on 2026-08-21 and is left as
written. Re-verified against the tree on 2026-09-10; the statements below are
now false or were imprecise, with the tree's actual state. None changes the
decision.

- **§1 `ShaderUnaryOp` (lines ~102–111) lists nine ops.** The union gained
  `"angle"` (`atan2`, §58's conic gradient) on 2026-09-06 as this RFC's one-row
  closed-union amendment (`packages/materials/src/shader-graph.ts:80-94`;
  builder `angle()` in `node-material-builder.ts`). §6's affected-sections
  list should read §58 as well.
- **§5 `ScreenEffect = CopyEffect | ColorGradeEffect | GraphEffect`.** The
  shipped union is `CopyEffect | ColorGradeEffect | OutputTransformEffect |
  GraphEffect` — `OutputTransformEffect` (R-15, 2026-08-08) predates this RFC's
  landing (`packages/render/src/effect-pass.ts:313-314`).
- **§5 `GraphEffect` shape.** Shipped with a fourth field,
  `textures?: Record<string, RenderTargetTexture>` (`effect-pass.ts:284-310`),
  which the prose two paragraphs later already required.
- **§5 "the `attribute` node is rejected in the screen domain".** Deviation
  recorded in source: `"uv"` is nameable in `"screen"` as the pass's
  normalised coordinate; only position / normal / colour are rejected
  (`shader-graph.ts:66-73`, `effect-pass.ts:280-281`).
- **§6 "WGSL generation defers — there is no WebGPU backend".** The WGSL
  emitter shipped 2026-08-29 (WP-R1.9, `packages/render-webgpu/src/wgpu-node-program.ts`,
  `registerWebgpuNodeMaterialPipeline`); `docs/COMPATIBILITY.md` §2's WebGPU
  row already lists §60 node materials + §70 graph effects. The compatibility
  bullet "a later WGSL emitter moves this row" has happened.
- **§3 "cached … under a structural hash of the graph".** The cache is keyed
  on the **emitted GLSL source** (a structural key) with a per-graph `WeakMap`
  fast path; no hash function exists (`gl-node-program.ts:23-26`).
- **Alternative E "deferred to a follow-up RFC" / §81 point "absent".** Half
  landed 2026-09-06: `ShaderOperatorRegistry` (named factories producing
  *closed* nodes, `packages/materials/src/shader-operators.ts`) and the
  `SHADER_OPERATORS` token (`materials/src/capabilities.ts`). The
  data-declared-operator half (widening the node-kind union) remains deferred.
- **§4 "exceeded ui-demo's 30 kB by 99 B" / "seventeen example bundles".**
  Historical figures from 2026-08-07; ui-demo's budget is 50 kB today
  (`.size-limit.json`, `tools/size-budgets.mjs`), and MEMORY counts nine
  measured bundles. "Seventeen" has no source in the tree.
- **Prototype item 3 / §4 "must add a golden".** No node-material or
  graph-effect pixel golden exists under `tests/visual/` (only `text` and
  `ui-demo`); the GL-sequence gate is asserted instead
  (`tests/integration/node-materials.test.ts`). Recorded as residue below.
- **Context citations** (`effect-pass.ts:69` header, `custom-shaders.md`
  "When §60 lands…") quote text that was rewritten on implementation
  (2026-08-28/29); read them as historical.
- **Compatibility row names.** The rows are titled "2. Render backends and
  capability tiers (§62)" and "4. Scene, replay and snapshot format versions
  (§34, §79, §80)" in `docs/COMPATIBILITY.md`.
- **Quoted A-16 sentence** ("camera, light, sprite and renderable node types
  are still absent") is not in the tree; the umbrella's serializers record
  those types as added 2026-08-07, this RFC's own date.

**Residue (open, `TODO.md` "RFC 0001 residue"):** uniform blocks (WebGPU's
node pipeline already packs an all-`vec4` `NodeUniforms` block by necessity;
WebGL has none; no measurement), reusable functions / named subgraphs
(nothing), conditional variants (nothing for graphs), storage buffers
(§82 compute infra exists; no graph node), source maps (nothing), lighting-
aware graphs (still unlit; R-17's prerequisite exists), data-declared
operators (the `SHADER_OPERATORS` hook exists), plus the missing pixel
golden. Plan: `docs/plans/RFC-0001-RESIDUE_PLAN.md`.
