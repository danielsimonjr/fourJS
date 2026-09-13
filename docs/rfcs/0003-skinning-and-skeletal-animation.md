# RFC 0003: Skinning and skeletal animation (§54, §14, §17)

- **Status:** accepted (owner, 2026-08-21 — "Continue with the remaining WPs and the RFCs"; the recommended dispositions of the flagged questions are adopted)
- **Date:** 2026-08-07
- **Owner decision:** accepted (2026-08-21)
- **Spec sections affected:** §54 (primary), §14, §17, §18, §19, §33, §42, §49, §53, §62, §71, §79, §85, §86, §98, §100, §113a

## Context

`PH-10` and `R-22` are two halves of one problem, and the gap analysis says so explicitly in its closing note: _"§54 skinning (`R-22`) and skeletal animation (`PH-10`) are two halves of one RFC."_ This is that RFC.

`PH-10` (**major / L**): _"Repo-wide grep for `Skeleton|skinning|skinIndex|morphTarget` finds only those two doc comments plus an unrelated `ui/widget.ts` hit. There is no bone/joint model in `@fourjs/scene`, no skin attribute in `@fourjs/geometry`, no skinning path in `@fourjs/render-webgl`, and `ValueKind` has no `morphWeight`/`skeletalJoint` member. §17's track-type list is therefore 7 of 9."_ Its provenance is a deferral to a phase that was never written: `packages/animation/src/track.ts:40-45` says the missing track types _"arrive with the phase that introduces skinning"_ — and, in the gap doc's words, **"no such phase exists in Part IX."**

`R-22` (**major / L**, and flagged ⚠️ **silent — §54 has no staging note anywhere in the repository**): all eleven §54 rows verified absent, with `AUDIT-120.md` folding the section into _"basic 3D meshes: shipped, §53–54"_. The gap doc calls it _"the highest-value silent gap in the domain after R-6"_, precisely because `@fourjs/animation` ships a mixer with no skinning target and `@fourjs/assets` stages glTF partly on it.

`PH-10`'s closure plan names the decision that needs an owner: _"Needs an RFC (`docs/rfcs/`) for the bone-axis convention — note `packages/motion/src/ik.ts` already ships two-bone IK **in positions, not angles**, precisely because no bone-axis convention is pinned (MEMORY 2026-08-02)."_

Two 2026-08-07 landings constrain the design:

- **`AnimationController` (PH-9, partially closed)** shipped the §18 state-machine tier with a specific channel model: _"the controller is a pose evaluator, not a mixer scheduler … the controller owns one channel per path, blends via `ValueAdapter`, and writes once under one claim in the same §16 registry"_, and _"un-animated channels contribute the `play()` baseline — the pose is a pure function of (state, time, weight); a controller pins every channel it owns."_ Blend trees and layered/additive animation remain staged.
- **R-19** landed `uvs`/`colors` on `BufferGeometry` with fixed attribute locations _0 position, 1 normal, 2 uv, 3 colour_, and **staged joints/weights deliberately**: `buffer-geometry.ts` says the rest of §53's standard attribute set _"and `clone()` are deliberately absent rather than sketched: each of them pins a public layout that the WebGL backend and the §79 scene format both have to agree with."_ This RFC is the act of pinning that layout.

## Proposed decision

### 1. The §3.1 matrix decides the split — and it decides one thing the spec does not

The frozen matrix is the strongest constraint in this design, so it is worked out first rather than discovered later.

| Package     | §3.1 deps                              | Can it see…                                                                |
| ----------- | -------------------------------------- | -------------------------------------------------------------------------- |
| `geometry`  | core, math                             | **not** `scene` — it can never name a bone node                            |
| `scene`     | core, math                             | **not** `geometry`, **not** `render`                                       |
| `animation` | core, math, scene, motion              | `scene` ✓; **not** `geometry`, **not** `render`                            |
| `render`    | core, math, scene, geometry, materials | both `scene` and `geometry` ✓ — the only package that can see a skin whole |

Three consequences follow mechanically:

**(a) Skin influences are plain numeric attributes on `BufferGeometry`.** `geometry` cannot name a `Bone`, so joints are _indices_, and what they index is somebody else's problem. This follows the `normals`/`uvs`/`colors` precedent exactly — optional, index-aligned, §85-validated on assignment, dropped by `dispose()`, `markDirty()`-announced.

```ts
// @fourjs/geometry — BufferGeometry gains two optional attributes (§53)
/** 4 joint indices per vertex; `joints[4 * i]` is vertex i's first influence. */
joints?: Uint16Array;
/** 4 weights per vertex, index-parallel with `joints`; should sum to 1. */
weights?: Float32Array;
```

Fixed attribute locations continue R-19's numbering: **4 joints, 5 weights**. That is a public layout commitment and is the point of this section.

Four influences per vertex, matching glTF's `JOINTS_0`/`WEIGHTS_0` — see Open questions for the 8-influence case. Weights are **not** normalised by the engine (§85 checks finiteness; a warning when a vertex's weights sum outside `1 ± 1e-3` is a development-only check, following the `normals` precedent of _"unit length is the author's contract, not validated here"_).

**(b) The skeleton is scene-graph nodes.**

```ts
// @fourjs/scene
export class Bone extends Node {
  static readonly typeName = "bone";
}

export class Skeleton {
  /** Joint index = position in this array. Insertion order is the ABI (§33). */
  readonly bones: readonly Bone[];
  /** 16 floats per bone, column-major to match `Matrix4`. */
  readonly inverseBindMatrices: Float32Array;
  /** The palette: 16 floats per bone, rewritten in place each frame. */
  readonly jointMatrices: Float32Array;
  /** palette[i] = inverse(skinRootWorld) · bones[i].worldMatrix · inverseBind[i] */
  update(skinRoot: Node): void;
}
```

A bone is a `Node`, not a parallel hierarchy, and this is the decision with the largest downstream payoff: it means bones already have `Transform`, already resolve through `resolveWorldTransform`, already carry `transformAuthority` (§42), already participate in §19's `"blended"` pipeline, already work with `@fourjs/motion`'s two-bone IK, already serialize as node types (§79), and are already animatable by everything `@fourjs/animation` ships. **No new mechanism is required for any of it.** The cost is real and stated under Consequences.

**(c) Morph-target weights cannot live where §54 puts them.** §54 declares `morphTargetWeights?: Float32Array` on `Mesh`, and `Mesh extends Renderable` (§49) — which lives in `@fourjs/render`. `animation`'s §3.1 row is `core, math, scene, motion`: **it cannot see `@fourjs/render`**, so it cannot bind a track to `Mesh.morphTargetWeights`. §14 requires morph-target animation, so the spec's own placement makes its own requirement unimplementable under the frozen matrix.

Resolution: morph weights are a **§6a component in `@fourjs/scene`**.

```ts
// @fourjs/scene
export class MorphWeights implements Component {
  static readonly typeName = "morph-weights";
  readonly weights: Float32Array;
}
```

`animation` reaches it through `node.getComponent(MorphWeights)` — an edge that already exists. `render` reads the same component when building the render item. `Mesh.morphTargetWeights` remains available as a **getter that reads the component**, so §54's spelling still works and the storage sits where §3.1 permits. As a bonus it becomes serializable through the existing §79 component registry with no new machinery.

Note for the packet: `packages/fourjs/tests/scene-serializers.test.ts` _"enumerates every umbrella barrel class carrying `static typeName` … and requires each registered; a sixth component fails the suite until registered."_ `MorphWeights` is that sixth component, and `Bone` needs a node-type registration. Both are gates, not follow-ups.

### 2. §17's two "missing track types" are binding gaps, not value-kind gaps

`track.ts` stages morph-weight and skeletal-joint tracks with the note that they _"will add their kinds to `ValueKind` then."_ Read against the shipped design, that is not what they need:

- A **skeletal-joint track** animates a bone's translation / rotation / scale. Those are `vector3` and `quaternion` values, with adapters that already exist and a `quaternionAdapter` that already slerps (§17's fifth interpolation entry). A joint track is an ordinary transform track whose target happens to be a `Bone`. **No new `ValueKind`, no new adapter, no new track type.**
- A **morph-weight track** animates a `number`. `numberAdapter` exists. What does _not_ exist is a binding that addresses **an element inside a `Float32Array`** — every binding today addresses a property.

So the packet adds **one new binding form** (an indexed-array target) and **zero new `ValueKind`s`**, and §17's list goes from 7 of 9 to 9 of 9. This corrects the staged note in `track.ts:40-45`in place, and is recorded here because "we said we would add two enum members and then did not" is exactly the kind of drift`check-docs.mjs` exists to catch.

### 3. How this meets `AnimationController`'s channel model (PH-9)

A controller channel is a property path with a `ValueAdapter`, blended per channel and written once under one claim. A skeletal clip maps onto that with no change to the controller:

- One skeletal clip over an N-bone rig produces up to **3N channels** (position, rotation, scale per bone). The controller's channel union, index-parallel state tracks, and single-claim write all work unmodified — this is the design paying off.
- PH-9's rule _"un-animated channels contribute the `play()` baseline"_ and _"a controller pins every channel it owns"_ means a 60-bone controller holds up to 180 claims for its whole life and writes 180 values per fixed step, including for bones that never move in any state. That is correct behaviour (the pose is a pure function of state and time) and a real cost. A rest-pose optimisation — skipping channels whose value is the baseline in every state — is **deferred**, because it would make the pose depend on the _set_ of states rather than on the current one, and PH-9's purity property is worth more than the writes.
- **Skinning does not depend on PH-9's remaining half.** Layered/additive animation is what skeletal rigs most want (upper-body override), but the shipped state-machine tier is sufficient to animate a rig, and this RFC is not gated on blend trees or layers landing first. Stating that prevents an accidental serialisation of two L-sized packets.

### 4. Transform authority (§42) and the §19 blending pipeline

Because a bone is a node, §42 already answers the ragdoll question: a bone's `transformAuthority` is `"animation"` when a clip drives it, `"physics"` when a ragdoll body drives it, and `"blended"` when §19's pipeline mixes them with `animationWeight`/`physicsWeight`. §19's recommended rule — _animation produces a target pose → kinematics may modify it → physics solves → render interpolates → optional blending combines_ — applies per bone with no skeleton-specific code path, and `warnAuthorityConflict` already fires when two systems claim one bone.

One thing this RFC must forbid explicitly: **the skinning palette is never an authority input.** `Skeleton.update` reads bone world matrices _after_ transform resolution and writes only into `jointMatrices`; nothing reads the palette back into a transform. This is §43's _"render interpolation never feeds back into physics state"_ applied one level down.

### 5. GPU skinning: a separate program, compiled lazily, with a declared joint limit

**Skinning is not a uniform switch.** R-19's recorded rule — _"textured meshes are a uniform switch, not shader variants … the CPU-mirrored default at GL's initial `0` is what keeps an untextured scene's GL sequence byte-identical"_ — works because `useMap`/`useVertexColors` are **fragment-stage** branches over data already bound. A `useSkinning` uniform would add, to the vertex stage of _every_ draw in the scene, four joint-index fetches, four weight fetches, four `mat4` reads and a weighted sum, executed per vertex and branch-predicted away only in the best case. That taxes the 99% of unskinned geometry to serve the 1%, in the stage where per-vertex cost actually accumulates.

So: **skinned draws use their own compiled programs** (a skinned variant of `UnlitProgram` and of `LitProgram`), and the byte-identity property is preserved the same way RFC 0001 preserves it:

- `RenderItemKind` gains `"skinned-unlit"` / `"skinned-lit"` (or, if RFC 0001's `pipelineId` follow-up lands first, two pipeline ids — the two RFCs should adopt whichever shape lands first, and the packets must not both invent one).
- **Programs compile on first skinned draw, not at renderer init**, so a scene with no skinned mesh issues the byte-identical GL sequence R-19 landed under and F13 re-proved. The packet re-proves it by call-sequence comparison; this is an acceptance gate.
- The measured payload rule applies (_"a fifth compiled-at-init pipeline costs 0.75 kB gzip in every example bundle — nothing reachable from a class method tree-shakes"_). Two more programs plus a palette uploader is more than 0.75 kB, so the skinned pipeline is reached through an **explicit registration call** in the same shape as the §62/§37 registries and RFC 0001's node pipeline — `registerSkinningPipeline()` resolved through a lazily-created module `let` the draw path never statically references. An unregistered skinned draw is **skipped with a one-time §85 warning**, not drawn in bind pose: a character standing in T-pose is a different picture, and the recorded rule is that a value must not become one.

**The joint limit is a declared capability, not a silent clamp.** The palette is `uniform mat4 jointMatrices[N]`, and N is bounded by `MAX_VERTEX_UNIFORM_VECTORS / 4` minus what the program already uses. §62's capability list includes _"maximum uniforms and bindings"_, and `RendererCapabilities` currently carries only `{ backend, maxTextureSize }`. This RFC widens it:

```ts
export interface RendererCapabilities {
  readonly backend: RendererBackend;
  readonly maxTextureSize: number;
  /** Maximum bones one skinned draw may use; `0` when skinning is unsupported. */
  readonly maximumSkinningJoints: number;
}
```

A `Skeleton` whose bone count exceeds it raises `UNSUPPORTED_GPU_FEATURE` (§89) **at setup**, following R-5/R-6's setup-time validation stance (_"a backend may not throw from inside a frame (§61)"_). Bone textures — a float texture palette with effectively unbounded joints — are deferred: they need R-4's `RenderTargetFormat` union to widen and a sampler in the vertex stage, and the fixed-limit path is the one every WebGL 2 device supports.

### 6. Determinism (§33): the CPU/GPU trade, stated as a rule

The trade is real and resolves cleanly once the boundary is drawn in the right place.

**Skeletal animation is deterministic; vertex skinning is not required to be.**

- Bone transforms are produced on the CPU by `@fourjs/animation`, whose determinism is already established (PH-9 shipped a 600-step golden, transcendental-free). Bones are nodes, so their transforms flow through the same `resolveWorldTransform` every other node uses. Nothing changes about the §33 envelope.
- `Skeleton.update` is CPU arithmetic and must obey §33's iteration rule: bones visited in `bones` array order (insertion order — the joint index _is_ the order), matrix products in a fixed association order, never `Map`/`Set` enumeration.
- The **vertex deformation** happens in the GPU vertex stage, where float behaviour varies across drivers. That is outside the envelope for the same reason shading is: §42/§43 make rendering a consumer of simulation state and never a producer. The palette goes to the GPU; nothing comes back.
- §33's checksum is _"FNV-1a over each existing body's transform and velocities"_ — bodies, not vertices. Skinned vertices are not in it, and should not be.

The rule that keeps this true, and which the packet must enforce:

> **No engine API returns skinned vertex positions.** Skinned bounds, skinned picking, and §54's geometry-merging tools all want them; each would make a CPU or a GPU readback into a value an application could branch on. If one is ever needed it must be a **CPU** implementation with its own determinism argument, and it must be documented as belonging to the `same-runtime` tier at best.

Two honest consequences of that rule, stated rather than hidden:

- **§71 picking against a skinned mesh uses bind-pose bounds and is therefore wrong** whenever the pose differs materially from bind. `packages/input/src/pick.ts` already defers analytic picking to `R-23`; this adds a second known inaccuracy that must be documented at the type, not discovered by a user.
- **Frustum culling (`R-8`) will cull skinned meshes by bind-pose bounds**, so an animation that moves geometry outside them can pop. The conventional fix is an authored bounds expansion factor; deferred, and named.

CPU skinning is **deferred, not rejected**: it is the only path for the Canvas 2D and SVG tiers (both reserved stubs), and it is the honest home for any future skinned-bounds work. When it lands it is a deterministic path and must carry a `same-runtime` golden of its own.

### 7. Scope: which §54 rows this RFC takes

`R-22` covers all of §54. This RFC takes only the rows that need a **cross-package design decision**; the rest are ordinary packets that need no RFC under the governance rule (_"small implementation choices inside one package do not need an RFC"_).

| §54 row                                                     | This RFC                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `class Mesh extends Renderable` with `geometry`, `skeleton` | **ships** — it is the carrier for everything else                                                                                                                                                                                              |
| skeletal deformation                                        | **ships**                                                                                                                                                                                                                                      |
| morph targets                                               | **ships the plumbing** (component, binding, weights on the render item); the GPU morph path is deferred — morph targets are additional _vertex streams_, and a four-target mesh triples the attribute budget, which is its own layout decision |
| multiple material groups                                    | out of scope — `R-12` follow-up, single-package                                                                                                                                                                                                |
| hardware instancing                                         | out of scope — needs R-19's instance-transform attribute; orthogonal to skeletons and the blocker for §86's 100 000-instance target                                                                                                            |
| indirect rendering                                          | out of scope — WebGPU                                                                                                                                                                                                                          |
| static **and dynamic** GPU buffers                          | out of scope, but named: every geometry buffer uploads `STATIC_DRAW` today, and a CPU-skinned or morphed geometry would re-upload whole                                                                                                        |
| level-of-detail, impostors, billboards, merging tools       | out of scope — ordinary packets                                                                                                                                                                                                                |

### 8. What the MVP packet ships

`Bone` + `Skeleton` + `MorphWeights` in `@fourjs/scene`; `joints`/`weights` on `BufferGeometry` at locations 4 and 5, with §85 validation; `Mesh` in `@fourjs/render` with `skeleton`, the skinned render-item kinds, and the palette on the render item; the two skinned programs in `render-webgl` behind `registerSkinningPipeline()`; `maximumSkinningJoints` on `RendererCapabilities`; the indexed-array binding in `@fourjs/animation`; `Bone` and `MorphWeights` serializer/node-type registrations; the byte-identical-sequence gate; one pixel golden of a two-bone skinned quad in a known pose.

**Defers:** GPU morph targets, bone textures, CPU skinning, skinned bounds and picking, dual-quaternion skinning, IK in angles, blend-tree/layer integration (PH-9's half), and the glTF loader — which this unblocks (`MEMORY` records glTF staged pending textures + non-unlit materials; R-19 closed the first, `R-12`/`R-13` the second, and skinning is the third).

## Alternatives

**A. A skeleton with its own transform hierarchy, outside the scene graph.** Cheaper per frame: a 60-bone rig becomes one array walk instead of 60 node resolves, with better locality. It loses on everything else: §42 authority stops applying to bones, so §19's `"blended"` ragdoll needs a parallel conflict mechanism; `@fourjs/motion`'s IK cannot target bones; bones cannot be parented to or from ordinary nodes (a sword in a hand, a camera on a head — both are node parenting today); §79 needs a bespoke serializer instead of the node-type path. The performance argument is real and unmeasured, so the packet must measure it (see Prototype); if 60-node resolution proves to cost more than the whole skinning path, this alternative comes back with evidence rather than by preference.

**B. Skinning as a uniform switch on the existing unlit/lit programs.** Preserves the one-program-per-family shape and needs no new pipeline. Rejected in §5 above: it moves cost into the vertex stage of every unskinned draw, which is the opposite of the trade `useMap` makes, and it adds uniform traffic to the sequence R-19's byte-identity property depends on.

**C. `morphTargetWeights` on `Mesh`, as §54 writes it.** The spec's own placement. Impossible under §3.1: `animation` cannot see `@fourjs/render`, and §14 requires morph-target animation. Adding an `animation → render` edge is forbidden (the matrix is frozen and the edge inverts the layering — the logical scene must never depend on a renderer). The component form keeps §54's spelling working through a getter, which is the smallest possible deviation.

**D. New `ValueKind` members for `morphWeight` and `skeletalJoint`, per §17 and per `track.ts`'s staged note.** What the repository said it would do. It loses to a plain reading of what those tracks contain: a joint track holds vectors and quaternions, a morph track holds numbers, and the only thing missing is a binding that addresses an array element. Adding enum members that duplicate existing adapters would create two ways to express one thing and a synchronisation obligation between them — the exact argument `track.ts` already makes for taking the adapter directly rather than a second discriminant.

**E. CPU skinning first, GPU later.** Simplest, deterministic, and works on every backend including the Canvas/SVG stubs. It loses as a _default_: per-vertex CPU transformation plus a whole-buffer re-upload every frame contradicts §86's performance envelope and would make skinning look like a bad feature rather than an unfinished one. Deferred rather than rejected — it is the right implementation for the 2D tiers and for any future skinned-bounds work.

**F. Bone texture palette from the start (unbounded joints).** Removes the joint limit and the §62 capability question. It needs a float texture sampled in the vertex stage, which needs R-4's format union widened and vertex-texture-fetch limits checked per device; and it is slower per draw on the common case. Deferred with the reason recorded.

## Consequences

**Easier.** §17's track list completes. §14's _skeletal animation_ and _morph-target animation_ stop being unimplementable. §113a's glTF loader loses its third blocker. §19's character example (_"character with animated limbs and physically simulated ragdoll response"_) becomes expressible with no new blending machinery, because bones are nodes and §42 already covers them. `R-22`'s silent status ends, and §54 acquires the staging note the gap doc found missing everywhere.

**Harder.** A 60-bone rig is 60 more nodes in the scene graph, resolved every frame — the cost of decision (b), and the thing alternative A exists to question. `BufferGeometry` grows two attributes and, with them, two more §79 layout commitments and two more §85 validation paths. The renderer grows a third lazily-registered pipeline family, which makes "explicit registration + module `let` + no static reference" load-bearing in a fourth place. Two known inaccuracies enter the codebase deliberately (bind-pose picking, bind-pose culling) and must be documented at their types rather than left for a user to find.

**Committed to.** Attribute locations 4 and 5; four influences per vertex; joint index = `bones` array index; the palette is never read back; no engine API returns skinned vertex positions; skinned draws are their own pipeline.

## Compatibility analysis

- **Public API (§90).** Additive throughout: new exports from `scene` (`Bone`, `Skeleton`, `MorphWeights`), `geometry` (two optional fields), `render` (`Mesh`), `render-webgl` (`registerSkinningPipeline`), `animation` (one binding factory). **Minor**, with two exceptions worth naming: `RendererCapabilities` gains a required member, which is **breaking for any third-party `Renderer` implementation** (the interface is public and `NullRenderer` shows the shape); and `RenderItemKind` gains members, which is breaking for an exhaustive consumer `switch` — the same note RFC 0001 makes, and a reason for the two packets to coordinate on `pipelineId` rather than each widening the union.
- **Scene format versions (§79).** **Moves.** `Bone` is a new node type and `MorphWeights` a new component type — both additive to a document, so existing documents load unchanged, but a document containing them cannot be read by an older reader. Inverse bind matrices are 16 floats per bone: a 60-bone rig is 960 floats of JSON, which is a genuine size argument for §79's binary `.four` container and is named here rather than discovered on the first real character. The packet must state whether `Skeleton` is a document-level resource referenced by id (recommended — §79's _"intra-file references … are by id"_) or inlined per mesh.
- **Solver adapters.** Untouched. No regeneration of the generated block in `docs/COMPATIBILITY.md`.
- **Plugin API (§81).** Untouched; RFC 0002's capability set is unaffected.
- **WebGPU/WebGL feature tiers (§62).** Moves: `maximumSkinningJoints` becomes a reported capability, and the row should say that the WebGL 2 tier's value is device-dependent (uniform-vector budget) rather than a constant.

**Determinism (§33).** Covered in full in §6 above. Summary for the compatibility table: skeletal animation sits inside the existing envelope and needs no new tier; vertex skinning sits outside it by construction and is never read back; `Skeleton.update` is an insertion-order CPU walk and is covered by the existing §33 iteration rule; the per-step checksum is unchanged.

## Prototype / benchmark

None run. What the packet must measure, in priority order:

1. **The byte-identical GL sequence** for a scene with no skinned mesh, by F13's call-comparison method. Acceptance gate.
2. **The cost of decision (b)** — bones as nodes. Resolve time for a scene with a 60-bone rig versus the same scene with the bones removed, and the same comparison at 10 rigs. This is the number that decides whether alternative A ever comes back, and §86 has **no** target for skinned meshes, so the packet should propose one from the measurement rather than inherit a guess.
3. **Controller channel cost**: a 60-bone controller pins up to 180 channels and writes them every fixed step. Measure the per-step cost and compare against the mixer path, since PH-9's purity rule makes this the permanent shape.
4. **Bundle delta** with and without `registerSkinningPipeline()`, grep-proven, in the A/B style the §62 registry used.

## Open questions

1. **Bone-axis convention** — the question `PH-10` says this RFC exists to answer. **Recommendation: the engine imposes none.** A bone is a `Node` with an arbitrary local frame; the inverse bind matrix absorbs whatever convention the authoring tool used, so the _data model_ needs no axis. A convention is needed only by **helpers** that reason about a bone's length direction (procedural rigs, look-at-down-a-bone, IK expressed in angles). For those, pin **+Y as the bone's length axis**, matching §7a's Y-up world, and document it as a helper convention rather than a format requirement. This keeps `motion/src/ik.ts`'s position-based two-bone solver correct as written, and gives an angle-based successor something to be correct against. Owner confirmation wanted, because reversing it later invalidates authored rigs.
2. **Four influences per vertex, or eight?** Four matches glTF's first joint set and fits the attribute budget. Eight doubles two attributes for a quality difference most content never shows. Recommendation: four, with the second set (`JOINTS_1`/`WEIGHTS_1`, locations 6/7) named as the extension point so the layout is not re-litigated.
3. **`morphTargetWeights` placement is a spec deviation.** §54 puts it on `Mesh`; §3.1 makes that unanimatable. The proposal (a `@fourjs/scene` component with a `Mesh` getter) needs either an amendments-table row against §54 or a dated note. Owner call on which.
4. **§17's track-type list should be re-read.** If §2 above is accepted, §17's _"morph weight"_ and _"skeletal joint"_ entries are satisfied by binding forms rather than by track types, and the staged note in `track.ts:40-45` is wrong about what it promised. Worth a spec-revisit item so a future reader does not add the enum members anyway.
5. **What happens when a skeleton exceeds `maximumSkinningJoints`?** This RFC proposes refusing at setup with `UNSUPPORTED_GPU_FEATURE`. The alternatives are splitting the mesh into per-palette submeshes (real work, and it changes draw counts) or falling back to CPU skinning (which does not exist yet). Confirm the refusal.
6. **Is `Bone` worth being a subclass at all**, rather than an ordinary `Node` referenced by a `Skeleton`? A subclass gives a `typeName` for §79 and a place to hang a debug-draw hook; a plain `Node` avoids a class whose only content is its name. Minor, but it is a public type either way.

## Post-acceptance corrections (2026-09-10 review pass)

Decision text left as accepted (2026-08-21; implemented 2026-08-28; spec
revision 1.10). Verified against the tree 2026-09-10:

- **`Bone` "carries `static readonly typeName = "bone"`".** Deliberately
  **no `typeName`** (that key is the §6a component key); §79 identity is the
  node type `"scene:bone"` (`packages/scene/src/skeleton.ts:72-82`,
  `packages/fourjs/src/scene-serializers.ts`). RFC 0004 §2b's `CanvasViewWidget`
  follows the same rule.
- **`Skeleton.update(skinRoot: Node)`.** Now `update(skinRoot, worldOf?)`
  (§43-interpolated palettes, 2026-09-09): the interpolated list composes
  local poses, then the palette product — palettes are never lerped.
- **§5 / Compatibility: `RendererCapabilities.maximumSkinningJoints` is
  required, "breaking for any third-party `Renderer`".** Shipped
  **optional** (`packages/render/src/renderer.ts:288`; absent = not reported)
  under WP-R1.1's widening law; the "breaking" bullet is void.
- **§5 "N is bounded by `MAX_VERTEX_UNIFORM_VECTORS / 4`", "the WebGL 2
  tier's value is device-dependent".** The limit is the **declared constant
  `MAX_SKINNING_JOINTS = 48`** (`packages/render/src/mesh.ts:95`; 192 of the
  guaranteed 256 vec4s), reported by both GPU backends, 0 on the null
  renderer; spec §62 and revision 1.10 say "declared portability constant
  rather than a device query". WebGPU shares it via a 3072-byte palette bind
  group (`wgpu-skinning.ts`).
- **§5 / §8 "two skinned programs" in `render-webgl`.** Four now: the unlit
  and lit colour pair, `SkinnedShadowProgram` (2026-09-09, lazily via
  `acquireShadow()`) and `SkinnedIdProgram` for the §71 id pass (2026-09-09,
  `gl-picking.ts`). WebGPU has the colour pair only (`registerSkinningPipeline()`,
  2026-09-09); its skinned id pass (#91) and skinned shadow caster (#92)
  landed 2026-09-10 — WebGPU now matches WebGL's four.
- **§5 `RenderItemKind` "or `pipelineId` if RFC 0001's follow-up lands
  first".** The kinds `"skinned-unlit"` / `"skinned-lit"` landed; `pipelineId`
  did not.
- **§6 "`pick.ts` already defers analytic picking to `R-23`".** Analytic
  picking landed 2026-08-29 as A-11 / RFC 0005 Q3 (`node.hitTestMode`,
  `Pickable.triangles`); `R-23` is not the label. Skinned picking is bind-pose
  bounds on the CPU and deformed-silhouette ids on WebGL.
- **§7 "every geometry buffer uploads `STATIC_DRAW`".** True of geometry;
  particle instance streams are `DYNAMIC_DRAW` (`gl-particles.ts`).
- **§8 "one pixel golden of a two-bone skinned quad".** No golden; the
  acceptance is a counted-pixel Playwright gate (`tests/browser/skinning.spec.ts`,
  "Why there is no golden").
- **§8 "Defers … the glTF loader".** Shipped 2026-08-29 (A-19,
  `packages/fourjs/src/gltf.ts` builds `Bone`/`Skeleton` from skins).
- **Prototype "None run".** Done 2026-09-09: `benchmarks/skinning-resolve.mjs`
  + `results/skinning-resolve.json` (60 bones ×1/×10 vs Group topology,
  `Skeleton.update`, 180-channel clip through mixer and controller;
  alternative A does not return). Items 1 and 4 were measured at landing
  (byte-identical A/B; +0.75–0.80 kB gzip for the seam, pipelines 0 B unless
  registered).
- **Compatibility "the packet must state whether `Skeleton` is a document-
  level resource".** Decided: inline on the mesh as bone ids + inverse bind
  matrices (spec §54, revision 1.10).
- **Open questions 1–6** are all resolved by revision 1.10 (no bone-axis
  convention, +Y helper only; four influences at locations 4/5 with
  `JOINTS_1`/`WEIGHTS_1` next; amendment row; refusal over the limit;
  `Bone` subclass kept, without `typeName`).
- **§1's dev-only weight-sum warning** was never implemented; weights are
  "not validated or renormalized" (`buffer-geometry.ts`, spec §54) — a
  not-adopted proposal, not a fact.

**Residue (open, `TODO.md` "RFC 0003 residue"):** GPU morph path (plumbing
only — `MorphWeights`, `Mesh.morphTargetWeights`, `morphWeights` on render
items, `createArrayElementBinding`; zero morph code in either backend), CPU
skinning (nothing), bone-texture palette (nothing). The WebGPU skinned shadow
and id passes closed 2026-09-10 (#91, #92). Plan: `docs/plans/RFC-0003-RESIDUE_PLAN.md`.
