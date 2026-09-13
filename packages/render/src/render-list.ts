/**
 * Render-list construction (§64) — scene graph in, flat sorted draw list out.
 *
 * §64 requires the renderer pipeline to separate eight stages: traversal,
 * visibility and layer filtering, frustum and occlusion culling, render-item
 * generation, sorting, batching and instancing, backend command encoding, and
 * GPU submission. This module is stages **1, 2, 4, and 5** — the backend-
 * independent half — and produces "compact render items" exactly as §64 asks,
 * so the drawing hot path never makes a virtual call on a node.
 *
 * Two node kinds generate an item: §49's `Renderable` — which §55's `Sprite`
 * has been a subclass of since §57's `Material` base landed (2026-08-06) — and,
 * structurally and never by inheritance, a §36 particle system, which
 * contributes **one batched item for the whole system** (plan P9-3). The second
 * is a duck-typed contract because the frozen dependency matrix forbids an edge
 * in either direction (see `particles.ts`).
 *
 * Which pipeline a renderable draws through is read off its **material's**
 * `kind` (§57), not off the node's class: that is one property load, it is what
 * makes a family member a consumer writes reachable without editing this file,
 * and it is why the sprite no longer needs an `instanceof` of its own.
 *
 * Not here, and why:
 *
 * - **Culling (stage 3).** Frustum culling needs a camera, and this module has
 *   none: one list serves every view of the frame. It landed in `view-list.ts`
 *   as a **derivation** of this list per view (R-8, 2026-08-09) — see that
 *   module for why the frame builds one list and a view queries it rather than
 *   building its own. What this module contributes is the item's
 *   `frustumCulled` snapshot and, through `bounds.ts`, the world bounds §87
 *   asks for; every visible renderable is still generated here.
 * - **Batching (stage 6).** §65 is a whole packet, and batching decisions
 *   depend on the backend's pipeline model (WP-3.5). The one exception is a
 *   particle system, which arrives *already* batched: one item carrying every
 *   particle, because §112's 100 000-particle target is not reachable any other
 *   way (plan P9-3, WP-9.3).
 * - **Encoding and submission (stages 7–8).** Backend work by definition; the
 *   render list is the handover point, and it deliberately contains no GL
 *   objects.
 *
 * ## Ordering (§66 subset)
 *
 * §66's full order is: render layer, opaque versus transparent, pipeline and
 * material compatibility, depth, explicit render order. {@link buildRenderList}
 * sorts by **render layer, then opaque before transparent, then explicit render
 * order, then scene-graph order** — keys 1, 2, and 5.
 *
 * {@link compareRenderItems} is the one §66 comparator: layer, opaque before
 * transparent, pipeline and material, depth, explicit render order. Key 3
 * (pipeline/material) outranks key 4 (depth), so transparent items sort
 * back-to-front only *within* the same pipeline and material. The builders
 * still default to keys 1, 2 and 5 — a scene that never asks for depth sort
 * keeps the order it has had since 2026-08-06, byte for byte. Depth sort is
 * {@link sortRenderListByDepth}, which writes `viewDepth` and then applies
 * the combined comparator. Key 3 also ships as the
 * {@link groupRenderListByPipeline} verb:
 *
 * - key 3 cannot be the default order, and the reason is stronger than
 *   byte-identity (R-10, 2026-08-09). Grouping by pipeline permutes draws that
 *   were tied under keys 1, 2 and 5 — which, in this engine, is most of a 2D
 *   scene — and **co-planar opaque draws are order-dependent**: §61 fixes the
 *   depth function at `LEQUAL`, so of two surfaces at the same depth the one
 *   submitted *later* wins. That is not an accident to be fixed; it is what
 *   makes a §58 stroke paint over its own fill (R-16) and what makes a later
 *   sibling draw on top in every 2D scene. A default-on key 3 would therefore
 *   repaint existing scenes, not merely reorder their GL calls. §66 lists the
 *   key for content whose overlap is resolved by depth, and this engine's
 *   own 2D layer model is the case where that is untrue, so the key is offered
 *   and never imposed. See {@link groupRenderListByPipeline};
 * - key 4 needs a camera to measure distance along and a **per-view** list to
 *   store the measurement in, because one list serves every view of a frame: a
 *   depth key computed for one camera would order the others by the wrong
 *   number. R-8's per-view derivation supplied both on 2026-08-09, and the key
 *   ships there — on the derived list, never on this one. It is opt-in for key
 *   3's reason, unchanged: under `LEQUAL` a depth sort permutes co-planar
 *   opaque draws, and co-planar opaque draws are what a 2D scene is made of.
 *   See `view-list.ts`'s `sortRenderListByDepth`, which now applies
 *   {@link compareRenderItems} after writing `viewDepth`.
 *
 * Key 2 landed on 2026-08-06 with §57's `transparent` flag (`material.ts`).
 * It is a **no-op for every scene that does not use it**: with the base's
 * `transparent: false` default every item classifies opaque, the comparator
 * returns 0, and the stable sort leaves the list exactly as it was — which is
 * the property that let the key land under the pixel-golden gate. The sprite
 * and particle pipelines blend by construction but are *classified* by their
 * material's flag like everything else; reclassifying them wholesale is a
 * follow-up (2026-08-06), because it would reorder existing scenes.
 *
 * The tie-break is **scene-graph order** — the depth-first, insertion-ordered
 * walk of §6 — which makes the list a deterministic function of the scene (§33)
 * and gives authors the one ordering guarantee 2D content actually relies on:
 * later siblings draw on top. It comes for free from a stable sort, since items
 * are generated in traversal order.
 *
 * ## Allocation (plan D7)
 *
 * Both builders fill a caller-supplied `out` array and reuse **pooled item
 * objects** keyed to that array, so the steady state allocates nothing at all —
 * no items, no matrices, no `Vector3`/`Quaternion` scratch. The consequences
 * are stated on {@link buildRenderList} and matter: the items are valid until
 * the next build into the same array.
 */

import { DEV, devWarnOnce } from "@fourjs/core";
import type { BufferGeometry } from "@fourjs/geometry";
import { Matrix4, Quaternion, Vector3 } from "@fourjs/math";
import type {
  LitMaterial,
  Material,
  NodeMaterial,
  SpriteMaterial,
  StandardMaterial,
  UnlitMaterial,
} from "@fourjs/materials";
import {
  ALL_LAYERS,
  DEFAULT_LAYER_MASK,
  assertLayerMask,
  isLayerMask,
  layersMatch,
  type LayerMask,
  type Node,
  type PoseBuffer,
  type Skeleton,
  type Viewport,
} from "@fourjs/scene";

import {
  computeWorldBoundingSphereFromBox,
  type BoundingSphere,
} from "./bounds.js";
import { ClipPlaneAllocator, type RenderItemClip } from "./clip.js";
import {
  PARTICLE_INSTANCE_FLOATS,
  isParticleDrawable,
  particleQuadGeometry,
} from "./particles.js";
import { Renderable } from "./renderable.js";
import type { ScissorRect } from "./scissor.js";
import type { SpriteFrame } from "./sprite.js";

/**
 * A drawable that may carry §55's frame, as this module reads it (R-29,
 * 2026-08-08).
 *
 * Structural, and deliberately not `node instanceof Sprite`. Which pipeline a
 * node draws through is read off its **material** here (see `pipelineOf`), so
 * "is a sprite item" and "is a `Sprite`" are not the same predicate: a plain
 * `Renderable` carrying a `SpriteMaterial` produces a sprite item and has no
 * `frame`, and that must read as "no frame" rather than as a type error or a
 * crash. It also keeps the `instanceof` this module removed in 2026-08-06 from
 * coming back, and keeps the import type-only — no runtime edge from the list
 * to the node class.
 */
interface FramedDrawable {
  readonly frame?: SpriteFrame | null;
}

/**
 * A drawable that may carry §54's skin and morph state, as this module reads
 * it (RFC 0003, 2026-08-28).
 *
 * Structural, and deliberately not `node instanceof Mesh`, for
 * {@link FramedDrawable}'s reason exactly: the read is one property load on
 * every renderable, a plain `Renderable` reports `undefined` for both, and
 * the type-only shape keeps `mesh.ts` out of every bundle whose scene never
 * constructs one. The `Skeleton` named here is a type import — no runtime
 * edge.
 */
interface SkinnedDrawable {
  readonly skeleton?: Skeleton | null;
  readonly skinningMode?: "gpu" | "cpu";
  updateCpuGeometry?(worldOf?: (node: Node) => Matrix4): BufferGeometry;
  readonly morphTargetWeights?: Float32Array;
}

/**
 * A drawable that may carry §67's per-item scissor, as this module reads it.
 *
 * Structural: a `Renderable` has the field; a particle double or a host's
 * own minimal node reports `undefined`, which must read as "no scissor".
 */
interface ScissoredDrawable {
  readonly scissor?: ScissorRect | null;
}

/** `undefined` and `null` both mean "inherit the view scissor only". */
function scissorOf(node: object): ScissorRect | null {
  return (node as ScissoredDrawable).scissor ?? null;
}

/**
 * Which pipeline a render item needs (§64 stage 7, §66 sort key 3).
 *
 * A backend cannot draw a textured quad with the flat-colour pipeline, so an
 * item has to say which one it is. The discriminant is carried **on the item**
 * rather than derived from the material's class at draw time, for the reason
 * §64 gives for compact render items in the first place: the draw path must not
 * make a virtual call, an `instanceof` check, or a property probe per object.
 * It is also the field §66's key 3 ("pipeline/material compatibility") will sort
 * on when batching (§65) lands (decision, WP-3a.3).
 *
 * A string union rather than an enum, matching `TransformAuthority`,
 * `RendererBackend`, and `GeometryDrawMode`: it serializes, logs, and compares
 * as itself.
 *
 * `"lit"` joined with the §68 lighting packet (2026-08-04): a `Renderable`
 * generates `"unlit"` or `"lit"` according to its material's own `kind`
 * discriminant (§57) — a material property, not a node property, because
 * which pipeline shades a surface is exactly what a material *is*.
 *
 * `"standard"` joined with §59's metallic-roughness workflow (R-13,
 * 2026-08-08), by the same rule and for the same reason. Widening this union is
 * still an edit to this package, which is R-12's remaining half: the closed
 * union is the **staging mechanism**, not the destination — it keeps every arm
 * type-checked end to end while the pipeline registry §64 asks for is designed
 * (see `pipelineOf`).
 *
 * `"skinned-unlit"` and `"skinned-lit"` joined with §54's skinning (RFC 0003,
 * 2026-08-28), and they are the one pair whose discriminant is **not** the
 * material's `kind` alone: a skinned draw is the same §57 material family
 * through a different *vertex* stage, so the kind is the material's family
 * crossed with "this node has an active skin" — a `Mesh` with a `Skeleton`
 * over a geometry carrying `joints`/`weights` (see `collect`). Skinning is a
 * separate pipeline rather than a uniform switch because `useMap`'s trade
 * inverts in the vertex stage: a `useSkinning` uniform would add four palette
 * fetches and a weighted sum to **every vertex of every draw** to serve the
 * rare skinned one (RFC 0003 §5, alternative B rejected).
 *
 * ## Note for RFC 0001 (which inherits this shape)
 *
 * RFC 0003 landed first, so this widened closed union — one string member per
 * compiled pipeline, discriminating the item union, with the backend's draw
 * loop switching on it — is the shape RFC 0001's `pipelineId` follow-up
 * refines rather than reinvents: a registry-issued pipeline id would replace
 * the *closed-ness* (a consumer material could bring its own arm), not the
 * discriminant-on-the-item design, and the two skinned members show what a
 * vertex-stage variant looks like in it (family × vertex path, decided at
 * item-generation time, never per draw). Until then, widening remains an edit
 * to this file, and an exhaustive consumer `switch` over `RenderItemKind` is
 * broken by every widening — the §90 note both RFCs record.
 *
 * `"node"` joined with §60's node materials (RFC 0001, 2026-08-28), and it is
 * the shape that note anticipated, implemented at the item tier: **one**
 * member discriminates the whole node-material family — decided at
 * item-generation time from the material's `kind`, like every other member —
 * while the *compiled-pipeline* identity inside that family is the graph's
 * structure, resolved by the backend's program cache off
 * `item.material.graph` (one program per distinct graph, however many
 * materials share it). The registry-issued `pipelineId` that would replace
 * this union's closed-ness therefore remains a follow-up; what §60 needed was
 * a member whose pipeline *count* is open while the member set stays closed.
 * An unregistered backend **skips** a `"node"` item with a one-time §85
 * warning — `pipelineOf`'s flat-colour fallback is deliberately excluded for
 * it, because a graph the author wrote is a specific picture and drawing an
 * unrelated one is R-6's "a JSON value must not become a different picture"
 * in the material domain.
 */
export type RenderItemKind =
  | "unlit"
  | "lit"
  | "standard"
  | "sprite"
  | "particles"
  | "skinned-unlit"
  | "skinned-lit"
  | "node";

/**
 * The fields every render item carries, whatever pipeline draws it — one draw in
 * the compact form §64 asks for: no node reference, no virtual calls, nothing
 * the backend has to walk.
 *
 * Every field is a snapshot or a reference taken during list construction. The
 * item object itself is **pooled and rewritten** by the next build into the same
 * `out` array — see {@link buildRenderList}.
 */
interface RenderItemBase {
  /**
   * World transform of the drawn node.
   *
   * {@link buildRenderList} stores a **reference to the node's own**
   * `transform.worldMatrix`, so the item costs nothing to fill and always
   * reflects the last resolve. {@link buildInterpolatedRenderList} stores a
   * pooled matrix holding the §43 render pose instead. Either way: read it,
   * upload it, do not mutate it.
   */
  worldMatrix: Matrix4;
  /** Vertex data to draw (§53). */
  geometry: BufferGeometry;
  /** §66 sort key 5, copied from the drawable node. */
  renderOrder: number;
  /** §66 sort key 1, copied from the drawable node. */
  renderLayer: number;
  /**
   * The drawable node's §46 layer mask, snapshotted at generation time (R-38,
   * 2026-08-08).
   *
   * Not a sort key and not read by the comparator — it is what lets **one**
   * render list serve several views with different masks, which is the shape
   * this engine has: the frame builds one list and `view-list.ts`'s
   * `buildViewRenderList` derives each view's from it, testing
   * `item.layers & effectiveViewMask` once per item per view (R-8,
   * 2026-08-09; the WebGL backend tested it inline before that). Filtering *at
   * build time* is the other half and is {@link buildRenderList}'s `layerMask`
   * parameter, for the caller whose views differ so much that a shared list
   * would carry mostly-rejected items; the two compose, since an item that was
   * never generated cannot be drawn into any view.
   *
   * On the item rather than reached through a node reference for the reason §64
   * gives for compact render items in the first place — and because a compact
   * item has no node reference to reach through.
   *
   * Confusingly adjacent to `renderLayer` above, and unrelated: that is §66's
   * ordering ordinal, this is §46's membership set.
   */
  layers: LayerMask;
  /**
   * §66 sort key 2, read off the item's material (§57's `transparent`) at
   * generation time: `false` for an opaque draw, `true` for a blended one.
   *
   * Snapshotted onto the item rather than reached through `material.transparent`
   * inside the comparator, for the reason §64 gives for compact render items —
   * a comparator runs O(n log n) times and must not chase a reference per
   * call — and because a particle item has no material to ask.
   */
  transparent: boolean;
  /**
   * The item's material's stable `id` (§57), snapshotted at generation time —
   * the *material* half of §66's sort key 3 (R-10, 2026-08-09). `""` for a
   * particle item, which has no material.
   *
   * Key 3 is "pipeline **and** material compatibility", and this item carries it
   * as two fields rather than one: `kind` is the pipeline and this is the
   * material. Not one concatenated key, because building `${kind}:${id}` would
   * allocate a string per item per frame, which is exactly what the pooled item
   * exists to avoid (plan D7). Not read through `material.id` inside the
   * comparator either, for the reason §64 gives for compact render items — a
   * comparator runs O(n log n) times and must not chase a reference per call.
   *
   * Ids are assigned from `Material`'s monotonic counter in construction order,
   * so ordering by them is a deterministic function of the program that built
   * the scene (§33) — the property {@link groupRenderListByPipeline} rests on.
   * They are compared as strings, so the order is lexicographic
   * (`material-10` before `material-9`) rather than numeric: §66 asks for
   * *grouping*, and any total order that puts equal ids together satisfies it.
   */
  materialId: string;
  /**
   * §49's `castShadow`, snapshotted from the drawable node (§69; R-18,
   * 2026-08-09).
   *
   * Read by the backend's **depth-only shadow pass**, which walks this same
   * list before the view loop and draws the items carrying `true` — of the
   * three *surface* kinds only, since a §55 quad would cast its rectangle
   * rather than its texture (see `Renderable.castShadow`). On
   * the item rather than reached through a node reference for the reason §64
   * gives for compact render items in the first place — and because a compact
   * item has no node reference to reach through.
   *
   * Always `false` on a particle item: §36's billboards have no surface to
   * project (see {@link ParticleRenderItem}).
   */
  castShadow: boolean;
  /**
   * §49's `receiveShadow`, snapshotted from the drawable node (§69; R-18,
   * 2026-08-09).
   *
   * Read by the two **shaded** pipelines, which switch the shadow comparison
   * off for a draw carrying `false`; the unlit and sprite pipelines have no
   * lighting term to attenuate and never ask. Always `false` on a particle
   * item, for the reason above.
   */
  receiveShadow: boolean;

  /**
   * §49's `frustumCulled`, snapshotted from the drawable node (§87; R-8,
   * 2026-08-09).
   *
   * Read by `buildViewRenderList`, which tests an item's world bounds against
   * the view's frustum only when this is `true`. On the item rather than
   * reached through a node reference for the reason §64 gives for compact
   * render items in the first place — and because a compact item has no node
   * reference to reach through.
   *
   * **`false` on a particle item that has no live-particle bound** — the
   * shared instance quad sits at the emitter and says nothing about where
   * the particles are. When the emitter publishes a local AABB via
   * structural `computeBounds(outMin, outMax)`, the builders copy a world
   * sphere onto {@link RenderItemBase.worldBounds} and set this `true` so
   * §87 can cull the system (R-8 follow-up b).
   */
  frustumCulled: boolean;

  /**
   * Optional world-space cull sphere, written when the drawable publishes
   * a bound that is not its `geometry` box — today, a §36 particle system
   * whose node has structural `computeBounds`. `null` / absent means
   * "derive from geometry" (the ordinary path). Optional so a hand-built
   * item predating the field still typechecks.
   */
  worldBounds?: BoundingSphere | null;

  /**
   * The drawable node's `transform.worldVersion` at generation time — the
   * stamp §65's idle batch cache keys on. Absent on a hand-built item, which
   * is what tells the cache "versions unavailable, re-upload".
   */
  transformVersion?: number;

  /**
   * §66 sort key 4, in view space — written by `sortRenderListByDepth` and
   * meaningless until it has run (R-8, 2026-08-09).
   *
   * Distance from the camera along its forward axis, larger meaning farther.
   * The measurement lives on the item, like every other sort key, because a
   * comparator runs O(n log n) times and must not transform a matrix per call
   * (§64's compact-item rule).
   *
   * Reset to `0` by both builders, so the value a pooled slot carries is a fact
   * of the item and not of whatever occupied the slot last frame — the hazard
   * the `material` and `frame` resets in `collect` exist for. A caller reading
   * it without having sorted reads that `0`.
   */
  viewDepth: number;

  /**
   * §67's clip, or `null` for a draw no clip touches (R-23, 2026-08-21) — the
   * overwhelmingly common case, and the one every scene had before clipping
   * existed.
   *
   * Three things read it. A backend applies `clip.stencil` **in place of** the
   * material's own §57 `stencil` and, when `clip.maskPass` is set, forces
   * colour writes, depth writes and the depth test off; §65's batcher breaks a
   * run where two consecutive items carry different records, because the same
   * material under two different clips is two different draws; and the
   * comparators below sort mask draws to the front of the list.
   *
   * The record is a **shared, pooled object** — every item under one clip
   * carries the identical reference — which is what makes the batcher's check
   * one `!==` rather than a seven-field comparison. Like every other field on a
   * pooled item it is rewritten by the next build; see `clip.ts` for what it
   * means and why it is not a `StencilState`.
   *
   * **Optional, and `undefined` means exactly what `null` means.** The
   * builders always write it (`null` for the unclipped case), so an item this
   * module produced answers with one property load; the field is optional so
   * that a **hand-built item literal or structural double predating §67** —
   * R-38's recorded gotcha, answered structurally this time — still
   * typechecks, and reports `undefined`, which every reader treats as "no
   * clip". Same move as `RendererCapabilities`' optional members (R-1): widen
   * a shipped shape additively, and let absence mean the pre-feature
   * behaviour.
   */
  clip?: RenderItemClip | null;

  /**
   * §67 rectangular scissor, or `null` for a draw that inherits the view
   * scissor only (2026-09-06).
   *
   * Drawing-buffer pixels, bottom-left origin, +Y up — the same space as
   * `view.rect` after `resolveRect`. A backend intersects this with the view
   * rectangle and restores the view rect after the draw. Default-off: a
   * scene that never names one issues the same scissor calls it issued
   * before the field existed.
   *
   * **Optional, and `undefined` means exactly what `null` means** — the
   * R-23 move: the builders always write it, the field is optional so a
   * hand-built item predating the field still typechecks, and
   * `MutableRenderItem` re-declares it required so a pooled slot cannot go
   * stale.
   */
  scissor?: ScissorRect | null;

  /**
   * §54's morph-target weights — the node's `MorphWeights` component array —
   * or `null` for the overwhelmingly common draw that carries none (RFC 0003,
   * 2026-08-28).
   *
   * A **reference to the component's own array**, snapshotted like `frame` and
   * `instances`: the item is pooled and the weights may be rewritten by the
   * next fixed step, so a consumer reads them during the call that built the
   * list. Nothing in the shipped backends consumes it yet — the GPU morph
   * path (additional vertex streams) is deferred by RFC 0003 §7 — so today it
   * is the plumbing that lets that packet, a CPU morpher, or a diagnostic read
   * the animated weights off the item without a node reference (§64's
   * compact-item rule).
   *
   * **Optional, and `undefined` means exactly what `null` means** — the R-23
   * move, third application: the builders always write it, the field is
   * optional so a hand-built item literal or structural double predating RFC
   * 0003 still typechecks, and `MutableRenderItem` re-declares it required so
   * a pooled slot cannot go stale.
   */
  morphWeights?: Float32Array | null;
}

/** A draw generated from a `Renderable` (§49) — flat colour, no texture. */
export interface UnlitRenderItem extends RenderItemBase {
  kind: "unlit";
  /** Surface appearance (§57). */
  material: UnlitMaterial;
}

/**
 * The palette half every skinned item carries (§54; RFC 0003) — what the
 * backend uploads as `uniform mat4 jointMatrices[]` for the draw.
 *
 * `jointMatrices` is a **reference to the skeleton's own palette**, rewritten
 * by `Skeleton.update` — which `collect` ran in the same pass that built this
 * item (the particle-repack precedent: the uploaded array can never be a step
 * older than the item pointing at it). Upload it during the call; never retain
 * it. `jointCount` bounds the upload: the array holds exactly
 * `16 × jointCount` floats.
 */
interface SkinnedRenderItemBase extends RenderItemBase {
  /** The skeleton's palette: 16 floats per joint, in joint-index order (§33). */
  jointMatrices: Float32Array;
  /** Number of joints in the palette; positive on every skinned item. */
  jointCount: number;
}

/**
 * A skinned draw over §57's `UnlitMaterial` (§54; RFC 0003) — the unlit
 * pipeline's vertex-stage variant. Produced only for a `Mesh` whose skeleton
 * and geometry agree; see {@link RenderItemKind}.
 */
export interface SkinnedUnlitRenderItem extends SkinnedRenderItemBase {
  kind: "skinned-unlit";
  /** Surface appearance (§57). */
  material: UnlitMaterial;
}

/**
 * A skinned draw over §57's `LitMaterial` (§54, §68; RFC 0003) — the Lambert
 * pipeline's vertex-stage variant, shaded by the same frame `SceneLights`
 * record every lit item is.
 */
export interface SkinnedLitRenderItem extends SkinnedRenderItemBase {
  kind: "skinned-lit";
  /** Surface appearance (§57, §68). */
  material: LitMaterial;
}

/**
 * A draw generated from a `Renderable` carrying a `LitMaterial` (§49, §57,
 * §68) — Lambert diffuse plus the scene ambient term. The item is the draw
 * only; the lights it is shaded by travel separately, in the frame's
 * `SceneLights` record (`lights.ts`), because they are per-frame state shared
 * by every lit item, not per-draw state.
 */
export interface LitRenderItem extends RenderItemBase {
  kind: "lit";
  /** Surface appearance (§57, §68). */
  material: LitMaterial;
}

/**
 * A draw generated from a `Renderable` carrying a `StandardMaterial` (§49,
 * §57, §59) — metallic-roughness PBR, one diffuse and one specular lobe under
 * the same §68 lighting a {@link LitRenderItem} is shaded by.
 *
 * Structurally identical to a lit item, and deliberately a **separate arm**
 * rather than a widened `LitRenderItem.material`: the two draw through
 * different programs, and §66's sort key 3 is a pipeline key. The frame's
 * lights travel in the shared `SceneLights` record exactly as they do for the
 * lit pipeline — they are per-frame state, not per-draw state.
 */
export interface StandardRenderItem extends RenderItemBase {
  kind: "standard";
  /** Surface appearance (§57, §59, §68). */
  material: StandardMaterial;
}

/**
 * A draw generated from a `Renderable` carrying a `NodeMaterial` (§49, §57,
 * §60; RFC 0001) — shaded by the material's own compiled graph.
 *
 * Structurally a base item: the graph, the material's uniform values, and its
 * texture bindings all travel on the **material** (`material.graph`,
 * `material.getUniform`, `material.getTexture`), one property load away, and
 * the backend's program cache keys on the graph's structure — a thousand
 * materials sharing one graph share one compiled program and differ only in
 * the per-draw uniform uploads (RFC 0001 §3; Q3's per-material tier).
 *
 * Unlit at this tier: the frame's `SceneLights` record is deliberately not
 * consumed by this pipeline (RFC 0001 §6 — lighting-aware graphs wait on
 * R-17's light-uniform contract).
 */
export interface NodeRenderItem extends RenderItemBase {
  kind: "node";
  /** Surface appearance (§57, §60): the frozen graph plus its bindings. */
  material: NodeMaterial;
}

/** A draw generated from a {@link Sprite} (§55) — one textured, tinted quad. */
export interface SpriteRenderItem extends RenderItemBase {
  kind: "sprite";
  /** Surface appearance (§55, §57). */
  material: SpriteMaterial;
  /**
   * §55's frame sub-rectangle in texels, or `null` for the whole texture
   * (R-29, 2026-08-08) — a **reference to the sprite's own record**, snapshotted
   * like every other field at generation time.
   *
   * A reference rather than a copy for the reason `worldMatrix` and
   * `material.tint` are: the item is pooled and rewritten, and copying four
   * floats per sprite per frame buys nothing a backend can observe — it reads
   * the frame during the same call that built the list. Read it, resolve it to
   * uv, do not retain it.
   *
   * `null` rather than absent so a backend's read is one property load and one
   * comparison on every sprite item, framed or not, with no `in` check and no
   * shape change between the two cases — which is what keeps a frameless
   * sprite on exactly the code path it was on before frames existed.
   *
   * On the sprite item and not on the item base: no other pipeline
   * samples an atlas today. §65 batching is where that changes, and it changes
   * by carrying uv per vertex rather than per draw.
   */
  frame: SpriteFrame | null;
}

/**
 * A draw generated from a particle system (§36) — **one batched, instanced
 * draw for the whole system**, whatever its particle count (§64 stage 6, plan
 * P9-3).
 *
 * The contract, the interleaved instance layout, and the blending and
 * billboarding a backend owes it live in `particles.ts`; read that module's
 * header before implementing one. In this file the item is just the third arm
 * of the union, and it differs from the other two in exactly two ways:
 *
 * - **`geometry` is the *instance* mesh**, not the drawn shape:
 *   {@link particleQuadGeometry}'s shared unit quad, drawn `count` times.
 *   Carrying it here rather than inventing a fourth item field is what lets a
 *   backend's ordinary geometry cache upload it, once, like any other geometry.
 * - **There is no material.** §36 puts colour on the particle, not on a shared
 *   surface, so every particle carries its own straight-alpha RGBA in the
 *   instance stream. The field is declared as `material?: undefined` rather
 *   than omitted so that `item.material` stays *readable* on the union — a
 *   backend or a test can ask any item for its material and get `undefined`
 *   here, instead of failing to compile.
 */
export interface ParticleRenderItem extends RenderItemBase {
  kind: "particles";

  /**
   * Stable identity of the emitting node (§6), for a backend to key this
   * system's GPU buffers on — see `ParticleDrawable.id`.
   */
  id: string;

  /** Live particles to draw; the instance count of the batched draw. */
  count: number;

  /**
   * The emitting node's interleaved instance array (`particles.ts`), valid for
   * `count × PARTICLE_INSTANCE_FLOATS` floats. Owned by the node and rewritten
   * every frame: upload it during the call, never retain it.
   */
  instances: Float32Array;

  /** Particles carry no material — see the interface documentation. */
  material?: undefined;

  /**
   * Optional trail ribbon vertices for this system. When present and
   * {@link trailVertexCount} > 0, the backend draws them as blended triangles
   * after the instanced particle quads.
   */
  trailVertices?: Float32Array;

  /** Live trail vertices to draw; `0` means skip the trail pass. */
  trailVertexCount?: number;

  /**
   * Instance stride in floats. Absent / `8` is the default stream; `10` is
   * the R-32 wide stream (rotation + softness).
   */
  instanceFloats?: number;

  /**
   * Texture-like handle or `true` when the emitter opted into textured
   * particles. Backends sample `map` like an unlit sprite.
   */
  particleTexture?: object | true;
}

/**
 * One draw (§64), as a **discriminated union** on {@link RenderItemKind}.
 *
 * ```ts
 * for (const item of buildRenderList(scene, out)) {
 *   if (item.kind === "sprite") {
 *     bind(item.material.texture);      // narrowed to SpriteMaterial
 *   } else if (item.kind === "particles") {
 *     upload(item.instances, item.count);
 *   } else {
 *     upload(item.material.color);      // narrowed to UnlitMaterial
 *   }
 * }
 * ```
 *
 * A union rather than one interface with a widened `material` so that a backend
 * gets the concrete material type from an ordinary `kind` check, with no cast
 * and no `instanceof` on the draw path. The builders pay for that with **one**
 * documented cast where the invariant is actually established — see
 * `itemAt`.
 */
export type RenderItem =
  | UnlitRenderItem
  | LitRenderItem
  | StandardRenderItem
  | SpriteRenderItem
  | ParticleRenderItem
  | SkinnedUnlitRenderItem
  | SkinnedLitRenderItem
  | NodeRenderItem;

/**
 * The pooled item as the builders write it: one mutable shape covering every
 * union member, because a pooled object is rewritten field by field and
 * TypeScript cannot track a union member across independent assignments.
 *
 * Fields that belong to one arm are present on all of them here and carry
 * harmless defaults for the others — `material` is `undefined` on a particle
 * item, `frame` is `null` on everything but a framed sprite, `count` is `0` and
 * `instances` empty on the other two. The exported union is what hides them,
 * which is why a caller never sees a sprite item offering a particle count.
 *
 * Not exported: outside this module an item is always a {@link RenderItem}, and
 * the correlation between `kind` and the arm-specific fields is an invariant the
 * builders maintain rather than a contract callers may break.
 */
interface MutableRenderItem extends RenderItemBase {
  kind: RenderItemKind;
  material?:
    | UnlitMaterial
    | LitMaterial
    | StandardMaterial
    | SpriteMaterial
    | NodeMaterial;
  frame: SpriteFrame | null;
  id: string;
  count: number;
  instances: Float32Array;
  /** RFC 0003's palette; meaningful only on the two skinned arms. */
  jointMatrices: Float32Array;
  jointCount: number;
  /**
   * Required here though optional on the base, for `clip`'s reason: the
   * builders write it on every drawable item, so a pooled slot cannot hand a
   * stale weights array to whatever lands in it next.
   */
  morphWeights: Float32Array | null;
  /**
   * Required here though optional on the base: the builders must write it on
   * every item (a pooled slot must not hand a stale clip to whatever lands in
   * it next), and re-declaring it non-optional makes forgetting that a type
   * error rather than a leak.
   */
  clip: RenderItemClip | null;
  /**
   * Required here though optional on the base, for `clip`'s reason: the
   * builders write it on every drawable item, so a pooled slot cannot hand a
   * stale rectangle to whatever lands in it next.
   */
  scissor: ScissorRect | null;
  /** §36 trail ribbon; meaningful only on particle items. */
  trailVertices?: Float32Array;
  trailVertexCount: number;
  instanceFloats: number;
  particleTexture?: object | true;
  worldBounds: BoundingSphere | null;
  transformVersion: number;
}

/**
 * Which pipeline draws a node carrying `material` (§57, §64).
 *
 * One property load and a short chain of comparisons, with `"unlit"` as the
 * fallback so that a structurally-typed material double predating the
 * discriminant — or a family member no backend knows yet — keeps drawing
 * flat-coloured rather than vanishing. Replacing this mapping with the registry
 * §64 wants, so a consumer's material can bring its own pipeline, is R-12's
 * remaining half and is recorded as a follow-up (2026-08-06).
 *
 * The chain is ordered by how often each arm is taken, not alphabetically:
 * `"lit"` and `"standard"` are the two surface families a 3D scene mixes, and
 * `"sprite"` is asked last because §55's quads reach this function through the
 * same `Renderable` slot but are a minority of the items in any scene that has
 * both.
 */
function pipelineOf(material: Material): RenderItemKind {
  if (material.kind === "lit") {
    return "lit";
  }
  if (material.kind === "standard") {
    return "standard";
  }
  if (material.kind === "sprite") {
    return "sprite";
  }
  // §60's node material (RFC 0001) — deliberately **not** part of the
  // flat-colour fallback below: a backend with no registered node pipeline
  // skips the draw with a one-time §85 warning, because a graph the author
  // wrote is a specific picture and flat colour would be a different one.
  if (material.kind === "node") {
    return "node";
  }
  return "unlit";
}

/**
 * The `instances` a non-particle pooled item carries: shared, empty, never
 * uploaded. One array for the whole module, so pooling a thousand items does
 * not allocate a thousand empty buffers.
 */
const EMPTY_INSTANCES = new Float32Array(0);

/**
 * The `jointMatrices` a non-skinned pooled item carries: shared, empty, never
 * uploaded — {@link EMPTY_INSTANCES}' twin for RFC 0003's palette.
 */
const EMPTY_JOINT_MATRICES = new Float32Array(0);

/** Narrows `item` to the textured-quad pipeline (§55). */
export function isSpriteItem(item: RenderItem): item is SpriteRenderItem {
  return item.kind === "sprite";
}

/** Narrows `item` to the flat-colour pipeline (§57's `UnlitMaterial`). */
export function isUnlitItem(item: RenderItem): item is UnlitRenderItem {
  return item.kind === "unlit";
}

/** Narrows `item` to the Lambert-lit pipeline (§57's `LitMaterial`, §68). */
export function isLitItem(item: RenderItem): item is LitRenderItem {
  return item.kind === "lit";
}

/**
 * Narrows `item` to the metallic-roughness pipeline (§57's `StandardMaterial`,
 * §59; R-13).
 */
export function isStandardItem(item: RenderItem): item is StandardRenderItem {
  return item.kind === "standard";
}

/** Narrows `item` to the batched particle pipeline (§36; see `particles.ts`). */
export function isParticlesItem(item: RenderItem): item is ParticleRenderItem {
  return item.kind === "particles";
}

/** Narrows `item` to the node-material pipeline (§60; RFC 0001). */
export function isNodeItem(item: RenderItem): item is NodeRenderItem {
  return item.kind === "node";
}

/** Narrows `item` to the skinned flat-colour pipeline (§54; RFC 0003). */
export function isSkinnedUnlitItem(
  item: RenderItem,
): item is SkinnedUnlitRenderItem {
  return item.kind === "skinned-unlit";
}

/** Narrows `item` to the skinned Lambert-lit pipeline (§54, §68; RFC 0003). */
export function isSkinnedLitItem(
  item: RenderItem,
): item is SkinnedLitRenderItem {
  return item.kind === "skinned-lit";
}

/**
 * The §46 layer mask a view actually draws (§47, §48; R-38, 2026-08-08) —
 * `view.layerMask` when it has one, the camera's own `layers` otherwise.
 *
 * ```ts
 * const mask = viewLayerMask(view);
 * for (const item of list) {
 *   if ((item.layers & mask) === 0) continue;   // layersMatch, inlined
 *   draw(item);
 * }
 * ```
 *
 * §48's fallback rule in exactly one place, so every backend and every consumer
 * that draws a viewport resolves it identically. Both defaults are `ALL_LAYERS`
 * — a viewport with no mask over a camera with no mask draws every layer — so
 * this returns `ALL_LAYERS` for every view built before layers existed.
 *
 * The trailing `?? ALL_LAYERS` is not dead: `Camera.layers` is non-optional in
 * the type system, but a **structurally typed camera** predating the field
 * (`@fourjs/render-webgl`'s test double, a host's own minimal camera object)
 * reports `undefined`, and that must resolve to "draws everything" rather than
 * to a mask of zero that silently empties the view. Same defence, same reason,
 * as `material.transparent === true` in `collect`.
 */
export function viewLayerMask(view: Viewport): LayerMask {
  const mask = view.layerMask ?? view.camera.layers ?? ALL_LAYERS;
  // §85, and only in a development build: this runs once per view per frame, so
  // the cheap predicate gates the message — a template literal built here would
  // allocate a string every frame, which is precisely what `@fourjs/core`'s
  // `dev.ts` tells callers not to do. `assertLayerMask` re-tests and throws.
  if (DEV && !isLayerMask(mask)) {
    assertLayerMask(mask, `viewport "${view.id}" layer mask`);
  }
  return mask;
}

/** Pooled backing store for one `out` array. */
interface ListPool {
  /** Item objects, indexed by generation order (not by final sorted order). */
  readonly items: MutableRenderItem[];
  /**
   * §67's bit-plane allocator for this list (R-23). Reset by both builders
   * before traversal, so a clip's plane depends on the scene and not on how
   * many frames have been drawn. Pooled with the items for the same reason they
   * are: two simultaneously live lists must not share one buffer's eight
   * planes.
   */
  readonly clips: ClipPlaneAllocator;
  /**
   * World matrices for the interpolated builder, index-aligned with `items` and
   * grown only when that builder runs — {@link buildRenderList} never
   * constructs one.
   */
  readonly matrices: Matrix4[];
}

/**
 * Pools, keyed by the `out` array they serve.
 *
 * Keying on `out` rather than using one module-wide pool is what makes two
 * simultaneously live render lists safe (two viewports, or a main list plus a
 * shadow list): each keeps its own items. A `WeakMap` so a discarded list takes
 * its pool with it. Steady state is one `WeakMap` lookup per build.
 */
const pools = new WeakMap<readonly RenderItem[], ListPool>();

function poolFor(out: RenderItem[]): ListPool {
  let pool = pools.get(out);
  if (pool === undefined) {
    pool = { items: [], matrices: [], clips: new ClipPlaneAllocator() };
    pools.set(out, pool);
  }
  return pool;
}

/**
 * Returns pooled item `index`, creating it (once, ever, for this `out` array)
 * from the two fields that have no meaningful default — a geometry and a
 * matrix, both of which the caller has in hand. **Every field is overwritten by
 * the caller immediately**, including these two; they are parameters only
 * because `MutableRenderItem` cannot be constructed without them.
 */
function itemAt(
  pool: ListPool,
  index: number,
  geometry: BufferGeometry,
  worldMatrix: Matrix4,
): MutableRenderItem {
  let item = pool.items[index];
  if (item === undefined) {
    item = {
      kind: "unlit",
      worldMatrix,
      geometry,
      material: undefined,
      frame: null,
      renderOrder: 0,
      renderLayer: 0,
      layers: DEFAULT_LAYER_MASK,
      transparent: false,
      materialId: "",
      castShadow: false,
      receiveShadow: false,
      frustumCulled: true,
      viewDepth: 0,
      clip: null,
      scissor: null,
      id: "",
      count: 0,
      instances: EMPTY_INSTANCES,
      jointMatrices: EMPTY_JOINT_MATRICES,
      jointCount: 0,
      morphWeights: null,
      trailVertexCount: 0,
      instanceFloats: PARTICLE_INSTANCE_FLOATS,
      worldBounds: null,
      transformVersion: 0,
    };
    pool.items[index] = item;
  }
  return item;
}

/** Returns pooled render-pose matrix `index`, creating it once. */
function matrixAt(pool: ListPool, index: number): Matrix4 {
  let matrix = pool.matrices[index];
  if (matrix === undefined) {
    matrix = new Matrix4();
    pool.matrices[index] = matrix;
  }
  return matrix;
}

/**
 * Tracks whether §66's default comparator would permute generation order.
 *
 * When every item shares the same mask, render layer, transparency, and render
 * order, a stable sort is a no-op — and for the §86 sprite row that is the
 * common case (one atlas, one layer, default keys). Skipping it removes an
 * O(n log n) pass that dominated list construction at 100 000 nodes.
 */
interface SortTracker {
  /** Set when any item would compare unequal under {@link compareDefaultRenderItems}. */
  permute: boolean;
  /** False until the first sortable item is written. */
  seen: boolean;
  renderLayer: number;
  transparent: boolean;
  renderOrder: number;
}

/**
 * Records one item's §66 keys against the **previous** item's; sets
 * {@link SortTracker.permute} only when this item sorts *before* the one
 * generated ahead of it — i.e. when the default comparator would actually
 * move something. A list that is merely heterogeneous but already in §66
 * order (opaque items first, then transparent; ascending `renderOrder`) is a
 * fixed point of the stable sort, so it skips the O(n log n) pass entirely
 * (2026-09-11; until then any mixed scene re-sorted every frame). The three
 * comparisons mirror `compareDefaultRenderItems` key for key.
 */
function noteSortKeys(tracker: SortTracker, item: MutableRenderItem): void {
  if (item.clip?.maskPass === true) {
    tracker.permute = true;
    return;
  }
  if (tracker.seen && !tracker.permute) {
    if (item.renderLayer !== tracker.renderLayer) {
      if (item.renderLayer < tracker.renderLayer) {
        tracker.permute = true;
      }
    } else if (item.transparent !== tracker.transparent) {
      if (tracker.transparent) {
        tracker.permute = true;
      }
    } else if (item.renderOrder < tracker.renderOrder) {
      tracker.permute = true;
    }
  }
  tracker.renderLayer = item.renderLayer;
  tracker.transparent = item.transparent;
  tracker.renderOrder = item.renderOrder;
  tracker.seen = true;
}

/** §46 layer test inlined for the default {@link ALL_LAYERS} build-time mask. */
function nodeOnLayer(nodeLayers: LayerMask, mask: LayerMask): boolean {
  return mask === ALL_LAYERS ? nodeLayers !== 0 : layersMatch(nodeLayers, mask);
}

/**
 * Scratch used by {@link composeRenderPoseMatrix}. Module-level and reused, so
 * interpolated list building allocates nothing per node (§7b, plan D7); the
 * price is that composition is not re-entrant, which is fine on a single-
 * threaded render path that never calls user code.
 */
const ancestorChain: Node[] = [];
const scratchLocal = new Matrix4();
const scratchPosition = new Vector3();
const scratchRotation = new Quaternion();
/**
 * Interpolated world matrix for {@link Skeleton.update}'s `worldOf` provider.
 * Distinct from {@link writeWorldMatrix}'s pooled `out`: composing a bone
 * into the item's world matrix would clobber the mesh pose just written.
 */
const paletteWorldScratch = new Matrix4();
/**
 * Pose source for {@link interpolatedWorldOf}. Set immediately before
 * `Skeleton.update` on the interpolated path so the provider itself is a
 * stable function (plan D7: no per-item closure).
 */
let palettePoses: PoseBuffer | null = null;
let paletteAlpha = 0;
/** Local AABB scratch for a particle system's structural `computeBounds`. */
const particleBoundMin = new Vector3();
const particleBoundMax = new Vector3();

/**
 * Writes `node`'s **interpolated** world matrix into `out` (§43).
 *
 * The world matrix is composed from the outermost ancestor down, using each
 * level's interpolated local pose where the pose buffer has one and its live
 * local matrix where it does not:
 *
 * ```text
 * out = L(root) · … · L(parent) · L(node)
 * L(n) = compose(lerp(prev, cur, alpha), slerp(prev, cur, alpha), scale, pivot)
 * ```
 *
 * Cost is **O(depth) per item**, since each node re-walks its own ancestor
 * chain; a depth-`d` subtree of `n` nodes costs `O(n · d)` rather than the
 * `O(n)` the ordinary resolver achieves by composing top-down as it descends.
 * That is a deliberate simplification: the interpolated path composes into
 * per-item scratch matrices instead of into the scene, so it has nowhere to
 * cache a parent result, and a depth-keyed matrix stack is an optimization for
 * the packet that finds it necessary. Scene depths in the MVP are single
 * digits.
 *
 * **Nothing in the scene is written.** §43 is explicit that the render
 * transform must not feed back into simulation state, and §42 would make any
 * such write a second authority over the node. This function reads
 * `transform.scale`/`transform.pivot`, calls the lazy, idempotent
 * `updateLocalMatrix()` on untracked nodes — which recomposes the local matrix
 * from unchanged inputs and does not touch `version` — and writes only into
 * `out`. `transform.version`, `transform.worldVersion`, and
 * `transform.worldMatrix` are all left exactly as they were.
 */
function composeRenderPoseMatrix(
  node: Node,
  poses: PoseBuffer,
  alpha: number,
  out: Matrix4,
): void {
  ancestorChain.length = 0;
  for (let n: Node | null = node; n !== null; n = n.parent) {
    ancestorChain.push(n);
  }

  for (let i = ancestorChain.length - 1; i >= 0; i -= 1) {
    const current = ancestorChain[i];
    const transform = current.transform;
    let local: Matrix4;
    if (
      poses.computeRenderPose(current, alpha, scratchPosition, scratchRotation)
    ) {
      local = scratchLocal.compose(
        scratchPosition,
        scratchRotation,
        transform.scale,
        transform.pivot,
      );
    } else {
      // Untracked: the node did not move under the simulation, so its live
      // local transform *is* its render pose.
      transform.updateLocalMatrix();
      local = transform.localMatrix;
    }

    if (i === ancestorChain.length - 1) {
      out.copy(local);
    } else {
      out.multiply(local);
    }
  }

  // Do not keep the walked nodes reachable between builds.
  ancestorChain.length = 0;
}

/**
 * `worldOf` for {@link Skeleton.update} on the interpolated path: compose the
 * node's §43 render pose into {@link paletteWorldScratch} and return it.
 * Local poses interpolate, then the palette product runs — the palette
 * matrices themselves are never lerped.
 */
function interpolatedWorldOf(node: Node): Matrix4 {
  composeRenderPoseMatrix(
    node,
    palettePoses as PoseBuffer,
    paletteAlpha,
    paletteWorldScratch,
  );
  return paletteWorldScratch;
}

/**
 * Points `item.worldMatrix` at the right matrix for the frame: the node's own
 * resolved one when the list is not interpolating, or a pooled matrix holding
 * its §43 render pose when it is.
 *
 * Shared by every drawable kind, because §43 applies to a particle system's
 * *transform* exactly as it does to a mesh's — only the particles inside it are
 * not interpolated (see `particles.ts`).
 */
function writeWorldMatrix(
  item: MutableRenderItem,
  node: Node,
  pool: ListPool,
  index: number,
  poses: PoseBuffer | null,
  alpha: number,
): void {
  if (poses === null) {
    item.worldMatrix = node.transform.worldMatrix;
    return;
  }
  const matrix = matrixAt(pool, index);
  composeRenderPoseMatrix(node, poses, alpha, matrix);
  item.worldMatrix = matrix;
}

/**
 * Copies a particle system's live AABB onto the item as a world sphere so
 * §87 can cull it (R-8 follow-up b).
 *
 * `@fourjs/particles`' `ParticleRenderable.computeBounds` writes a **local**
 * box; this package cannot import that class, so the method is probed
 * structurally. No method, a `false` return (empty / GPU-simulated), or a
 * non-finite box leaves `frustumCulled = false` — the pre-follow-up
 * behaviour, so a double that never published bounds still draws.
 */
function writeParticleWorldBounds(
  item: MutableRenderItem,
  node: { computeBounds?: (outMin: Vector3, outMax: Vector3) => boolean },
): void {
  if (typeof node.computeBounds !== "function") {
    return;
  }
  if (!node.computeBounds(particleBoundMin, particleBoundMax)) {
    return;
  }
  let sphere = item.worldBounds;
  if (sphere === null) {
    sphere = { center: new Vector3(), radius: 0 };
    item.worldBounds = sphere;
  }
  if (
    computeWorldBoundingSphereFromBox(
      particleBoundMin,
      particleBoundMax,
      item.worldMatrix,
      sphere,
    )
  ) {
    item.frustumCulled = true;
  } else {
    item.worldBounds = null;
  }
}

/**
 * Narrows `node` to a drawable renderable, whatever material it carries.
 *
 * `node instanceof Renderable` on its own narrows to `Renderable<any>`, because
 * the class is generic in its material — and an `any` would spread from
 * `node.material` into every read that follows. This guard states the
 * instantiation the render list actually wants: the material is a
 * {@link Material}, and its `kind` says which pipeline draws it.
 */
function isRenderable(node: Node): node is Renderable<Material> {
  return node instanceof Renderable;
}

/**
 * Appends one §55 sprite item — the hot path for atlas scenes (§86).
 *
 * Skips §54 skinning probes and {@link pipelineOf}: a sprite material never
 * deforms and always draws through the `"sprite"` pipeline.
 */
function collectSpriteItem(
  node: Renderable<SpriteMaterial>,
  out: RenderItem[],
  pool: ListPool,
  index: number,
  nodeLayers: LayerMask,
  clip: RenderItemClip | null,
  poses: PoseBuffer | null,
  alpha: number,
  sortTracker: SortTracker,
): number {
  const geometry = node.geometry;
  const material = node.material;
  const item = itemAt(pool, index, geometry, node.transform.worldMatrix);
  item.kind = "sprite";
  item.geometry = geometry;
  item.material = material;
  item.frame = (node as FramedDrawable).frame ?? null;
  item.renderLayer = node.renderLayer;
  item.renderOrder = node.renderOrder;
  item.layers = nodeLayers;
  item.transparent = material.transparent === true;
  item.materialId = material.id ?? "";
  item.castShadow = node.castShadow !== false;
  item.receiveShadow = node.receiveShadow !== false;
  item.frustumCulled = node.frustumCulled !== false;
  item.viewDepth = 0;
  item.clip = clip;
  item.scissor = scissorOf(node);
  item.worldBounds = null;
  item.transformVersion = node.transform.worldVersion;
  if (poses === null) {
    item.worldMatrix = node.transform.worldMatrix;
  } else {
    writeWorldMatrix(item, node, pool, index, poses, alpha);
  }
  item.morphWeights = null;
  out[index] = item as RenderItem;
  noteSortKeys(sortTracker, item);
  return index + 1;
}

/**
 * Appends render items for `node`'s subtree to `out`, starting at index
 * `count`, and returns the new count. Depth-first in insertion order (§6).
 *
 * Filtering is §64 stage 2, and it comes in two shapes.
 *
 * **Subtree pruning**, for the two §6 flags:
 *
 * - `visible === false` — §6's rendering flag. Pruning rather than skipping the
 *   single node is the behaviour authors expect (hiding a group hides what is
 *   in it) and is what makes hiding a subtree cost O(1) instead of O(subtree).
 * - `enabled === false` — §6's "participates in simulation and updates" flag.
 *   A disabled subtree is inert in every other system, so it does not draw
 *   either (decision, WP-3.3: the alternative — a disabled node that still
 *   renders — would show a frozen object that no longer responds to anything,
 *   which reads as a bug rather than a feature).
 *
 * Both are checked on every node, including the traversal root: passing a
 * hidden root yields an empty list.
 *
 * **Per-node skipping**, for §46's layer mask (R-38, 2026-08-08): a node whose
 * `layers` shares no bit with `mask` generates no item, and **its children are
 * still visited**. That asymmetry is deliberate and is §46's model — a layer is
 * membership, not state, so it does not inherit (see `@fourjs/scene`'s
 * `layers.ts` for the recorded decision). The consequence here is that layer
 * filtering costs one `&` per node and never changes the traversal, which is
 * what keeps a masked list a permutation-free subsequence of the unmasked one
 * (§33) and what makes `ALL_LAYERS` a true no-op.
 */
function collect(
  node: Node,
  out: RenderItem[],
  pool: ListPool,
  count: number,
  poses: PoseBuffer | null,
  alpha: number,
  mask: LayerMask,
  clipBits: number,
  clip: RenderItemClip | null,
  sortTracker: SortTracker,
): number {
  if (!node.visible || !node.enabled) {
    return count;
  }

  let next = count;
  // §46's mask, read once and shared by both drawable arms.
  //
  // `?? DEFAULT_LAYER_MASK` for the same reason `material.transparent === true`
  // is written that way below: a **structurally typed** drawable predating the
  // field — a `ParticleDrawable` implemented outside `@fourjs/scene`, a host's own
  // minimal node — reports `undefined`, and that must read as "on the default
  // layer", which is where every real node starts. Reading it as a bare
  // `undefined` would make `undefined & mask` zero and drop the node from every
  // list, silently.
  const nodeLayers = node.layers ?? DEFAULT_LAYER_MASK;
  // `false` skips this node only — the children below are visited either way,
  // because §46 layers do not inherit.
  const onLayer = nodeOnLayer(nodeLayers, mask);
  if (onLayer && isRenderable(node)) {
    const material = node.material;
    if (material.kind === "sprite") {
      next = collectSpriteItem(
        node as Renderable<SpriteMaterial>,
        out,
        pool,
        next,
        nodeLayers,
        clip,
        poses,
        alpha,
        sortTracker,
      );
    } else {
      let geometry: BufferGeometry;
      const drawable = node as SkinnedDrawable;
      if (
        drawable.skinningMode === "cpu" &&
        drawable.updateCpuGeometry !== undefined
      ) {
        palettePoses = poses;
        paletteAlpha = alpha;
        geometry = drawable.updateCpuGeometry(
          poses === null ? undefined : interpolatedWorldOf,
        );
      } else {
        geometry = node.geometry;
      }
      let kind = pipelineOf(material);
      // §54's skin (RFC 0003): a `Mesh` with a skeleton over a geometry
      // carrying joints and weights draws through the skinned variant of its
      // material's family — see `RenderItemKind`. Read structurally, like
      // `frame`, so this costs every plain renderable one property load.
      const skeleton =
        (node as SkinnedDrawable).skinningMode === "cpu"
          ? null
          : ((node as SkinnedDrawable).skeleton ?? null);
      let activeSkin: Skeleton | null = null;
      let skinSkipped = false;
      if (skeleton !== null) {
        if (geometry.joints === undefined || geometry.weights === undefined) {
          // §85, development only: the skin cannot apply, and with no weights
          // there is no other picture — the mesh draws its geometry unskinned.
          if (DEV) {
            devWarnOnce(
              `skin-no-attributes:${node.id}`,
              `§54: node "${node.id}" has a skeleton but its geometry carries ` +
                "no joints/weights attributes, so there is nothing to deform " +
                "and the mesh draws unskinned (RFC 0003).",
            );
          }
        } else if (kind === "unlit") {
          kind = "skinned-unlit";
          activeSkin = skeleton;
        } else if (kind === "lit") {
          kind = "skinned-lit";
          activeSkin = skeleton;
        } else {
          // No skinned variant exists for this material family at this tier
          // (RFC 0003 §7 ships unlit and lit). The draw is skipped rather than
          // issued in bind pose: a character standing in T-pose is a different
          // picture, and the recorded rule is that a value must not become one
          // — the same direction the unregistered-pipeline case fails in
          // (`@fourjs/render-webgl`).
          skinSkipped = true;
          if (DEV) {
            devWarnOnce(
              `skin-material:${node.id}`,
              `§54: node "${node.id}" is skinned but carries a "${kind}" ` +
                "material, which has no skinned pipeline at this tier " +
                "(unlit and lit ship; RFC 0003); the draw is skipped rather " +
                "than shown in bind pose.",
            );
          }
        }
      }
      if (skinSkipped) {
        // Skipped with the one-time warning above; children are still visited.
      } else {
        const item = itemAt(pool, next, geometry, node.transform.worldMatrix);
        item.kind = kind;
        item.geometry = geometry;
        // The cast is the union's, not the material's: `MutableRenderItem` types
        // this slot as the four known surface materials, and `pipelineOf` has just
        // decided which of them the backend will read it as.
        item.material = material as
          | UnlitMaterial
          | LitMaterial
          | StandardMaterial
          | SpriteMaterial
          | NodeMaterial;
        // §55's frame (R-29), read structurally and only where it can mean
        // something. Written on **every** renderable, not only framed sprites: the
        // item is pooled, so a slot that carried a framed sprite last frame would
        // otherwise hand a stale sub-rectangle to whatever lands in it next — the
        // same hazard the `material = undefined` line in the particle arm below
        // exists for. `?? null` because a `Renderable` with a sprite material has
        // no such property at all.
        item.frame =
          item.kind === "sprite"
            ? ((node as FramedDrawable).frame ?? null)
            : null;
        item.renderLayer = node.renderLayer;
        item.renderOrder = node.renderOrder;
        // §46's mask, snapshotted so a per-view filter needs no node reference.
        item.layers = nodeLayers;
        // §66 key 2, snapshotted from §57's flag. `=== true` rather than a truthy
        // read: a material double built before the flag existed reports
        // `undefined`, which classifies opaque — the behaviour every scene had
        // before the key landed.
        item.transparent = material.transparent === true;
        // §66 key 3's material half (R-10), snapshotted like every other field.
        // `?? ""` for `transparent`'s reason, with a sharper consequence: a
        // **structurally typed** material double predating §57's `id` reports
        // `undefined`, and `undefined < undefined` is `false` in both directions —
        // a comparator reading it would answer "after" for both orders, which is
        // not a total order and makes the sort's result implementation-defined.
        // `""` collapses every such double into one group that keeps scene order,
        // which is what those items had before key 3 existed.
        item.materialId = material.id ?? "";
        // §49's two shadow flags (§69, R-18), snapshotted like every other field.
        // `!== false` rather than a truthy read, for `transparent`'s reason turned
        // around: both default to `true` on a `Renderable`, so a **structurally
        // typed** drawable predating the fields — a host's own minimal node —
        // reports `undefined`, which must read as "casts and receives", the
        // behaviour a `Renderable` authored today has.
        item.castShadow = node.castShadow !== false;
        item.receiveShadow = node.receiveShadow !== false;
        // §49's culling flag (§87, R-8), snapshotted like every other field, with
        // `!== false` for `castShadow`'s reason: it defaults to `true` on a
        // `Renderable`, so a **structurally typed** drawable predating the field —
        // a host's own minimal node — reports `undefined`, which must read as "may
        // be culled", the behaviour a `Renderable` authored today has.
        item.frustumCulled = node.frustumCulled !== false;
        // §66 key 4 has no value until a view measures it (`view-list.ts`). Written
        // rather than left, so a pooled slot cannot hand a stale depth to a caller
        // that reads the field without sorting.
        item.viewDepth = 0;
        // §67 (R-23): the accumulated test of every enclosing clip, or `null` where
        // there is none. Written rather than left, for the reason the `material`,
        // `frame` and shadow resets in the particle arm below are — a pooled slot
        // must not hand a stale clip to whatever lands in it next.
        item.clip = clip;
        // §67 scissor, snapshotted like every other field and written on every
        // drawable so a pooled slot cannot hand a stale rectangle forward.
        item.scissor = scissorOf(node);
        item.worldBounds = null;
        item.transformVersion = node.transform.worldVersion;
        writeWorldMatrix(item, node, pool, next, poses, alpha);
        // §54's morph weights (RFC 0003), snapshotted like every other field and
        // written on **every** drawable for `clip`'s reason: the item is pooled,
        // and a slot that carried a morphing mesh last frame must not hand its
        // weights to whatever lands in it next. `?? undefined ?? null`-free: a
        // plain `Renderable` has no such property and reports `undefined`.
        item.morphWeights =
          (node as SkinnedDrawable).morphTargetWeights ?? null;
        // §54's palette (RFC 0003), refreshed in the same pass that builds the
        // item — the particle-repack precedent: the uploaded matrices can never
        // be a step older than the item that points at them. `update` reads
        // world matrices for the skin root and every bone. On the ordinary path
        // those are `resolveWorldTransform` (byte-identical to the pre-§43
        // call). On the interpolated path they are `composeRenderPoseMatrix` at
        // §43's alpha, so a skin deforms at the same pose the mesh's own matrix
        // interpolates to. Local poses interpolate, then the palette product
        // runs — the palette itself is never lerped — and nothing is written
        // back into `node.transform` (§42, §43).
        if (activeSkin !== null) {
          if (poses === null) {
            activeSkin.update(node);
          } else {
            palettePoses = poses;
            paletteAlpha = alpha;
            activeSkin.update(node, interpolatedWorldOf);
          }
          item.jointMatrices = activeSkin.jointMatrices;
          item.jointCount = activeSkin.bones.length;
        }
        // The one cast in the module, and the only place the `kind`/`material`
        // correlation is established: both were just written from the same node, so
        // a "sprite" item carries a `SpriteMaterial`, a "lit" item a `LitMaterial`,
        // a "standard" item a `StandardMaterial`, an "unlit" item an
        // `UnlitMaterial`, and a skinned item its family's material, by
        // construction. TypeScript cannot
        // see that across two assignments to a pooled object — see
        // `MutableRenderItem`.
        out[next] = item as RenderItem;
        noteSortKeys(sortTracker, item);
        next += 1;
      }
    }
  } else if (onLayer && isParticleDrawable(node)) {
    // §36's whole system becomes **one** item (plan P9-3). The repack is the
    // node's own work and happens here, at list-build time, so the uploaded
    // arrays cannot be a step older than the item that points at them — see
    // `particles.ts` for the layout and for why this costs one pass per build.
    node.updateParticleInstances();
    const quad = particleQuadGeometry();
    const item = itemAt(pool, next, quad, node.transform.worldMatrix);
    item.kind = "particles";
    item.geometry = quad;
    // Drop a material this pooled slot may have carried for a `Renderable` in
    // an earlier frame: a particle item has none (§36), and keeping the
    // reference would both mislead a reader and retain a material the scene may
    // have discarded.
    item.material = undefined;
    // Likewise (R-29): a particle system has no texture sub-rectangle, and a
    // pooled slot must not keep one a sprite left in it — nor RFC 0003's
    // morph weights, for the same reason.
    item.frame = null;
    item.morphWeights = null;
    item.id = node.id;
    item.count = node.particleCount;
    item.instances = node.particleInstances;
    item.instanceFloats =
      node.particleInstanceFloats ?? PARTICLE_INSTANCE_FLOATS;
    item.particleTexture = node.particleTexture;
    item.trailVertices =
      node.hasTrail === true ? node.trailVertices : undefined;
    item.trailVertexCount =
      node.hasTrail === true ? (node.trailVertexCount ?? 0) : 0;
    item.renderLayer = node.renderLayer;
    item.renderOrder = node.renderOrder;
    item.layers = nodeLayers;
    // §66 key 2: a particle system has no material to declare `transparent`,
    // and its pipeline blends by construction (§36's colour ramp). It is
    // classified **opaque** so that key 2 leaves particle scenes in exactly the
    // order they drew in before the key existed; giving §36 a render-state
    // carrier of its own is the follow-up (2026-08-06).
    item.transparent = false;
    // §66 key 3's material half (R-10): a particle system has no material, so
    // it has no material identity either. Written rather than left, for the
    // reason `material` and `frame` above are — the pooled slot must not keep a
    // `Renderable`'s id and group this system with a surface.
    item.materialId = "";
    // §69 (R-18): a particle system neither casts nor receives. §36's
    // billboards are camera-facing quads with no surface to project into a
    // shadow map and no lighting term to attenuate, and the pooled slot must
    // not keep a `Renderable`'s flags from an earlier frame — the same hazard
    // the `material` and `frame` resets above exist for. Both are written
    // rather than left, so a particle item's shadow state is a fact of the
    // item, not of what last occupied the slot.
    item.castShadow = false;
    item.receiveShadow = false;
    // §87 (R-8): a particle system is **never** frustum-culled at this tier.
    // Its `geometry` is the shared unit quad the particles are instanced from,
    // so the quad's bounds are a square at the emitter and describe nothing
    // about where the particles actually are — culling by them would hide a
    // wide system whose emitter left the screen. Written rather than left, for
    // the reason the `material`, `frame` and shadow resets above are.
    // §87 (R-8 follow-up b): culled only when the emitter publishes a live
    // AABB via structural `computeBounds`. Without that, the shared instance
    // quad's bounds are a square at the emitter and would hide a wide system
    // whose origin left the frustum. Written rather than left.
    item.frustumCulled = false;
    item.viewDepth = 0;
    item.worldBounds = null;
    item.transformVersion = node.transform.worldVersion;
    // §67 (R-23): a particle system inside a clipped subtree is clipped like
    // everything else — the test is per draw, and §36's batched item is one
    // draw. Written rather than left, for the reason the resets above are.
    item.clip = clip;
    item.scissor = scissorOf(node);
    writeWorldMatrix(item, node, pool, next, poses, alpha);
    writeParticleWorldBounds(item, node);
    out[next] = item as RenderItem;
    noteSortKeys(sortTracker, item);
    next += 1;
  }

  // §67's clip (R-23), resolved *after* this node's own item and *before* the
  // children: the mirror of §46's layers, which gate the node and not the
  // subtree. A panel paints its own background unclipped by itself and then
  // contains what is inside it.
  let childBits = clipBits;
  let childClip = clip;
  if (node.clip === true) {
    if (isRenderable(node)) {
      const scope = pool.clips.allocate(clipBits, node.id);
      // `null` is §67's exhaustion case: the frame's eight bit planes are gone,
      // `clip.ts` has warned, and this subtree keeps the clips it inherited —
      // it spills past this boundary rather than vanishing behind it.
      if (scope !== null) {
        // The mask draw: this node's own geometry again, writing the plane and
        // nothing else. It carries §46's every-layer mask and `frustumCulled:
        // false` deliberately — a mask is not content, and a view that dropped
        // it would draw *none* of this subtree rather than less of it.
        const geometry = node.geometry;
        const material = node.material;
        const item = itemAt(pool, next, geometry, node.transform.worldMatrix);
        item.kind = pipelineOf(material);
        item.geometry = geometry;
        item.material = material as
          | UnlitMaterial
          | LitMaterial
          | StandardMaterial
          | SpriteMaterial
          | NodeMaterial;
        item.frame =
          item.kind === "sprite"
            ? ((node as FramedDrawable).frame ?? null)
            : null;
        // A mask is not content (R-23), so it is never skinned or morphed:
        // the mask a skinned mesh writes is its bind-pose shape, the §67
        // analogue of the bind-pose bounds `Mesh` documents.
        item.morphWeights = null;
        item.renderLayer = node.renderLayer;
        item.renderOrder = node.renderOrder;
        item.layers = ALL_LAYERS;
        item.transparent = false;
        item.materialId = material.id ?? "";
        item.castShadow = false;
        item.receiveShadow = false;
        item.frustumCulled = false;
        item.viewDepth = 0;
        item.worldBounds = null;
        item.transformVersion = node.transform.worldVersion;
        item.clip = scope.write;
        item.scissor = scissorOf(node);
        writeWorldMatrix(item, node, pool, next, poses, alpha);
        out[next] = item as RenderItem;
        noteSortKeys(sortTracker, item);
        next += 1;
        childBits = scope.bits;
        childClip = scope.test;
      }
    } else if (DEV) {
      // §85, and a development build only: a `Group` has no shape to mask
      // with, so the clip is inert. Warned rather than refused — §61 forbids
      // throwing inside a frame — and inert *toward drawing*: the subtree is
      // not narrowed, rather than being masked to nothing.
      devWarnOnce(
        `clip-not-drawable:${node.id}`,
        `§67: node "${node.id}" sets clip = true but draws no geometry, so ` +
          "there is no shape to mask its subtree with and the clip does " +
          "nothing. Put the clip on the node that draws the region (a Shape, " +
          "a Renderable, a Sprite), not on a Group above it.",
      );
    }
  }

  const children = node.children;
  for (let i = 0; i < children.length; i += 1) {
    next = collect(
      children[i],
      out,
      pool,
      next,
      poses,
      alpha,
      mask,
      childBits,
      childClip,
      sortTracker,
    );
  }
  return next;
}

/**
 * §66's comparator, reduced to the three keys this tier has — layer (key 1),
 * opaque before transparent (key 2), explicit render order (key 5). Returns 0
 * for equal keys, which a **stable** sort resolves in favour of generation —
 * i.e. scene-graph — order; `Array.prototype.sort` has been required to be
 * stable since ES2019.
 *
 * Key 2 sits **above** explicit render order, as §66 lists it: within a layer,
 * every opaque draw is issued before any blended one, so a transparent surface
 * composites over the geometry it overlaps instead of racing it in scene order
 * and being depth-rejected. `renderOrder` still orders inside each of the two
 * groups, which is where an author's manual ordering of overlapping
 * transparency belongs.
 *
 * An author who needs a blended draw *underneath* an opaque one — a rare but
 * real case, e.g. a glow behind a mask — reaches for `renderLayer`, which is
 * key 1 and outranks this.
 *
 * Used by the builders. {@link compareRenderItems} is the full §66 order and
 * is applied only when a caller asks for depth sort — a default-on key 3
 * would permute co-planar 2D draws (see the module header).
 */
function compareDefaultRenderItems(a: RenderItem, b: RenderItem): number {
  // §67's mask draws first, ahead of every other key (R-23): the stencil
  // buffer must be complete before the first clipped fragment is tested, and
  // nothing else in §66's order can be allowed to interleave content between a
  // mask and the draws it masks. `false !== false` in every scene that names no
  // clip, so this key is a single comparison and never a reordering.
  const aMask = a.clip?.maskPass === true;
  const bMask = b.clip?.maskPass === true;
  if (aMask !== bMask) {
    return aMask ? -1 : 1;
  }
  if (a.renderLayer !== b.renderLayer) {
    return a.renderLayer - b.renderLayer;
  }
  if (a.transparent !== b.transparent) {
    return a.transparent ? 1 : -1;
  }
  return a.renderOrder - b.renderOrder;
}

/**
 * §66's comparator with **every key in place**: layer, opaque before
 * transparent, pipeline and material, depth, explicit render order (R-8
 * follow-up a).
 *
 * Key 3 outranks key 4, so a depth sort is *within* a pipeline/material
 * group: transparent items still go back-to-front, but only against siblings
 * that share a pipeline and a material. `viewDepth` is 0 until
 * {@link sortRenderListByDepth} writes it, so calling this before a depth
 * pass is equivalent to {@link groupRenderListByPipeline}.
 *
 * Exported so a backend, a test, or a custom list can apply the same order
 * the verbs do.
 */
export function compareRenderItems(a: RenderItem, b: RenderItem): number {
  const byDefault = compareDefaultRenderItems(a, b);
  if (byDefault !== 0) {
    return byDefault;
  }
  if (a.kind !== b.kind) {
    return a.kind < b.kind ? -1 : 1;
  }
  if (a.materialId !== b.materialId) {
    return a.materialId < b.materialId ? -1 : 1;
  }
  if (a.viewDepth !== b.viewDepth) {
    return a.transparent
      ? b.viewDepth - a.viewDepth
      : a.viewDepth - b.viewDepth;
  }
  return 0;
}

/**
 * Re-sorts an already-built render list with §66's **sort key 3** — pipeline and
 * material compatibility — inserted between key 2 and key 5, in place, and
 * returns it (R-10, 2026-08-09).
 *
 * ```ts
 * buildRenderList(scene, list);       // keys 1, 2, 5 — the order every scene has
 * groupRenderListByPipeline(list);    // keys 1, 2, 3, 5 — draws grouped for §65
 * ```
 *
 * The point of key 3 is that a batcher can only merge draws that are already
 * **adjacent**: grouping is what turns an interleaved scene into runs
 * `@fourjs/render-webgl`'s batcher can collapse (§65, R-9). A scene authored in
 * groups already — a thousand sprites parented to one node, sharing one atlas —
 * needs none of this, which is why the builders do not do it.
 *
 * ## Why this is a second verb and not a parameter (decision, R-10)
 *
 * Because the reordering is **not always safe**, and a default, a flag, or an
 * option would all put the unsafe case one keystroke from an author who never
 * read this paragraph:
 *
 * - §61 fixes the depth comparison at `LEQUAL`, so where two opaque surfaces
 *   sit at the same depth the one drawn *later* wins. All of this engine's 2D
 *   content sits at one depth. Grouping by material therefore **changes the
 *   picture** of a 2D scene, rather than only changing the order of its GL
 *   calls — a §58 fill and its stroke, two overlapping shapes, a sprite over a
 *   background quad.
 * - §66 lists key 3 for content whose overlap is resolved by the depth buffer.
 *   That is true of the 3D half of this engine and false of the 2D half, and no
 *   property of a render item distinguishes them.
 *
 * So the caller who knows their content is depth-resolved (or who is drawing
 * one flat layer of same-depth-independent sprites) asks for the grouping, and
 * everybody else keeps the order they have had since 2026-08-06 — byte for
 * byte, since {@link buildRenderList} is untouched by this function's existence.
 *
 * ## Stability
 *
 * `Array.prototype.sort` is stable (ES2019), so items that compare equal keep
 * their relative order — which, after {@link buildRenderList}, is scene-graph
 * order. Two consequences: sorting a list that is *already* grouped changes
 * nothing at all, and a scene where every item shares one pipeline and one
 * material is left exactly as it was.
 *
 * @param list a list produced by {@link buildRenderList} or
 * {@link buildInterpolatedRenderList}; sorted in place and returned, so the
 * pooled items and the caller's array are the same objects afterwards.
 */
export function groupRenderListByPipeline(list: RenderItem[]): RenderItem[] {
  list.sort(compareRenderItems);
  return list;
}

/**
 * Builds the sorted render list for `root`'s subtree into `out`, and returns
 * `out` (§64).
 *
 * ```ts
 * const list: RenderItem[] = [];        // allocated once, reused every frame
 * // per frame:
 * resolveWorldTransforms(scene);        // §7: world matrices before §64
 * buildRenderList(scene, list);
 * ```
 *
 * **World matrices are not resolved here.** Each item's `worldMatrix` is a
 * reference to the node's own matrix, so the list is only as fresh as the last
 * `resolveWorldTransforms` pass — which §7 requires the frame to run before
 * render-item generation anyway, and which the `Application` composition root
 * already runs before its `render` listeners. Keeping resolution out of this
 * function is what lets the two passes stay separately schedulable (§64 lists
 * them as distinct stages) and what makes the item generation free.
 *
 * `out` is truncated to the number of items generated, so a list that shrinks
 * does not leave stale items behind. The items themselves are **pooled per
 * `out` array**: after a rebuild the array contains the same item *objects*,
 * with new contents and possibly in a new order. Two consequences worth
 * stating —
 *
 * 1. an item read after the next build into the same array describes a
 *    different draw; copy anything you need to keep;
 * 2. two independent lists need two `out` arrays (they then have independent
 *    pools), which is the normal way to render several viewports.
 *
 * Allocates nothing in the steady state: no items, no matrices, no math
 * objects. The first few frames grow the pool to the scene's item count and
 * then stop.
 *
 * ## `layerMask` (§46, §64 stage 2; R-38, 2026-08-08)
 *
 * ```ts
 * buildRenderList(scene, list, camera.layers);   // only what this camera sees
 * ```
 *
 * Only nodes sharing a bit with `layerMask` generate items; their children are
 * traversed regardless, because §46 layers do not inherit (see `collect`). The
 * default is `ALL_LAYERS`, which makes the test true for every node whose mask
 * is non-zero — i.e. every node that has not been explicitly removed from all
 * layers — so a caller that omits it gets exactly the list it got before the
 * parameter existed, in exactly the same order.
 *
 * This is the **build-time** half of §46 filtering, for the caller that builds
 * one list per view. The other half is {@link RenderItem}'s `layers` snapshot,
 * which lets one shared list be filtered per view by `view-list.ts`'s
 * `buildViewRenderList`; the WebGL backend takes that route, because a frame
 * that traverses the scene once and derives per view is cheaper than one that
 * traverses per view (R-8).
 *
 * @throws FourError `INVALID_SCENE_GRAPH` **in a development build** when
 * `layerMask` is not an integer in `[0, 0xffffffff]` (§85) — a `NaN` mask would
 * otherwise empty the list with no diagnostic at all. §85 lets a production
 * build drop expensive validation, and this one costs bytes in every shipped
 * bundle for a mistake that is an authoring error by construction, so it is
 * gated: measured at ~115 B gzip on `ui-demo`, deleted entirely by
 * `__FOUR_DEV__: false` (R-38, 2026-08-08). The check itself,
 * `@fourjs/scene`'s `assertLayerMask`, is unconditional there — `@fourjs/scene` is a
 * §33 simulation package and may not branch on the build mode at all.
 */
export function buildRenderList(
  root: Node,
  out: RenderItem[],
  layerMask: LayerMask = ALL_LAYERS,
): RenderItem[] {
  if (DEV) assertLayerMask(layerMask, "buildRenderList(layerMask)");
  const pool = poolFor(out);
  pool.clips.begin();
  const sortTracker: SortTracker = {
    permute: false,
    seen: false,
    renderLayer: 0,
    transparent: false,
    renderOrder: 0,
  };
  const count = collect(
    root,
    out,
    pool,
    0,
    null,
    0,
    layerMask,
    0,
    null,
    sortTracker,
  );
  out.length = count;
  if (sortTracker.permute && count > 1) {
    out.sort(compareDefaultRenderItems);
  }
  return out;
}

/**
 * Builds the sorted render list for `root`'s subtree into `out` using **§43
 * interpolated render poses** at `alpha`, and returns `out`.
 *
 * ```ts
 * // per rendered frame, between fixed steps:
 * buildInterpolatedRenderList(scene, poses, time.interpolationAlpha, list);
 * ```
 *
 * Identical to {@link buildRenderList} in traversal, filtering, sorting, and
 * pooling; the difference is each item's `worldMatrix` (and, for a skinned
 * mesh, its joint palette), which is composed from interpolated local poses
 * root-first (see `composeRenderPoseMatrix`) instead of a reference to
 * the node's resolved world matrix. This is §43's fix for rendering faster than
 * the simulation steps: at `alpha = 0` every item matches the previous captured
 * pose, at `alpha = 1` the current one, and in between position lerps and
 * rotation slerps. `alpha` is clamped to `[0, 1]` by `PoseBuffer`.
 *
 * Nodes the buffer does not track — static geometry, anything moved directly by
 * the application — contribute their **live local transform** at every alpha, so
 * a mixed scene needs no bookkeeping: track what the simulation moves, leave
 * the rest alone.
 *
 * Because the poses are composed into pooled matrices, this function **never
 * writes scene state** (§43: the render transform must not feed back into the
 * simulation). It also does not need `resolveWorldTransforms` to have run: it
 * derives every matrix itself, at `O(depth)` per item.
 *
 * `layerMask` filters exactly as it does for {@link buildRenderList} — same
 * default, same semantics, same development-only §85 check — and interacts with nothing else
 * here: a filtered node contributes no item, so no render pose is composed for
 * it either.
 */
export function buildInterpolatedRenderList(
  root: Node,
  poses: PoseBuffer,
  alpha: number,
  out: RenderItem[],
  layerMask: LayerMask = ALL_LAYERS,
): RenderItem[] {
  if (DEV) assertLayerMask(layerMask, "buildInterpolatedRenderList(layerMask)");
  const pool = poolFor(out);
  pool.clips.begin();
  const sortTracker: SortTracker = {
    permute: false,
    seen: false,
    renderLayer: 0,
    transparent: false,
    renderOrder: 0,
  };
  const count = collect(
    root,
    out,
    pool,
    0,
    poses,
    alpha,
    layerMask,
    0,
    null,
    sortTracker,
  );
  out.length = count;
  if (sortTracker.permute && count > 1) {
    out.sort(compareDefaultRenderItems);
  }
  return out;
}
