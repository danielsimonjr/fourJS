/**
 * Per-view render lists (§64 stages 2–3, §66 sort key 4; R-8) — the frame's one
 * list in, one view's draws out.
 *
 * ```ts
 * buildRenderList(scene, frameList);                 // once per frame
 * for (const view of views) {
 *   frustum.setFromViewProjection(viewProjection(view));
 *   buildViewRenderList(frameList, view, viewList, { frustum });
 *   draw(viewList);
 * }
 * ```
 *
 * §64 separates traversal, visibility and layer filtering, culling, item
 * generation, sorting, batching, encoding, and submission. `render-list.ts` is
 * stages 1, 2 and 4 plus the view-independent half of 5; this module is what
 * §64 leaves once a *view* exists — the layer filter resolved against a
 * viewport (stage 2), the frustum cull (stage 3), and the one sort key that
 * cannot be computed without a camera (§66 key 4).
 *
 * ## The frame builds one list; a view derives from it
 *
 * The alternative was a full `buildRenderList(root, list, mask)` per view, and
 * it was rejected on three independent grounds:
 *
 * - **Cost.** `benchmarks/render-batching.mjs` measures list construction at
 *   ~34 ms of a 78 ms 100 000-sprite frame — about 40% — because construction
 *   walks the scene, rebuilds derived geometry, and (for
 *   `buildInterpolatedRenderList`) composes a world matrix per item at
 *   `O(depth)`. A derivation is a linear scan over items that already exist.
 *   Split-screen would otherwise cost 2× the most expensive stage of the frame
 *   to answer a question that differs between the two views by a bitmask and
 *   six planes.
 * - **Side effects.** Traversal is not pure: it calls a particle system's
 *   `updateParticleInstances()` and reads a `Sprite`'s lazily-rebuilt geometry.
 *   Running it per view would repack every particle system once per view, so
 *   the *work a frame does* would depend on how many viewports were configured
 *   — which is the kind of coupling §33 asks the engine not to have even where
 *   the numbers happen to come out the same.
 * - **Frame state that is not a view's.** §69's shadow map is built from the
 *   frame's list before the view loop, deliberately (R-18): it is one map for
 *   one light, shared by every view, and filtering it by a view's mask would
 *   make the shadows in view A depend on the layer mask of view B. A base list
 *   that no view has touched is what makes that pass expressible at all.
 *
 * So: **the frame's list is the model, a view's list is a query over it.** The
 * derived list holds *the same pooled item objects* — nothing is copied, no
 * item is allocated, and `out` is the caller's array reused across views
 * exactly as the frame list is reused across frames. The two consequences are
 * the frame list's own, one level down: a derived list is only valid until the
 * next build into **either** array, and two lists that must be live at once
 * need two arrays.
 *
 * ## Determinism (§33)
 *
 * `buildViewRenderList` is a **subsequence** of its source: it removes items
 * and never reorders them, so a view's list is a deterministic function of the
 * frame's list and the view, and the relative order every §66 key established
 * upstream survives. {@link sortRenderListByDepth} is the one reordering verb
 * here, and it is opt-in for the reason key 3 is (see it). Both are
 * `same-runtime` at best where they touch culling — `Frustum` needs `sqrt` —
 * and neither feeds a number back into the simulation.
 */

import { Frustum, type Matrix4, Vector3 } from "@fourjs/math";
import { layersMatch, type Viewport } from "@fourjs/scene";

import { computeWorldBoundingSphere, type BoundingSphere } from "./bounds.js";
import {
  compareRenderItems,
  viewLayerMask,
  type RenderItem,
} from "./render-list.js";

/**
 * Optional arguments of {@link buildViewRenderList}.
 *
 * An options object rather than positional parameters because the culling half
 * is the one a caller may legitimately not want — an editor overlay, a picking
 * pass, a diagnostic that has to see every item — and `{ frustum }` says which
 * half is being switched off at the call site.
 */
export interface ViewRenderListOptions {
  /**
   * Cull against this frustum (§87, §64 stage 3). Omit it, or pass `null`, and
   * the derivation is a layer filter only.
   *
   * The caller owns the frustum and the matrix it came from, because the
   * renderer already computes `projection · view` for its uniforms and this
   * module must not compute it a second time. See {@link Frustum} for the
   * clip-space convention.
   */
  frustum?: Frustum | null;
}

/**
 * Scratch for the cull, module-level and reused: one sphere for the whole
 * module, so culling a hundred thousand items allocates nothing (§7b, plan D7).
 *
 * Not re-entrant, which is fine on a single-threaded render path that calls no
 * user code — the same argument `render-list.ts` makes for its own scratch.
 */
const scratchSphere: BoundingSphere = { center: new Vector3(), radius: 0 };

/**
 * Derives the render list for one view from the frame's list, into `out`, and
 * returns `out` (§64 stages 2–3; R-8).
 *
 * Two filters, in this order and for a reason:
 *
 * 1. **§46's layer mask** — `view.layerMask` when the viewport sets one, the
 *    camera's own `layers` otherwise, which is §48's fallback rule resolved by
 *    {@link viewLayerMask} so that every caller spells it the same way. Both
 *    default to every layer, so a view that never mentions layers keeps every
 *    item.
 * 2. **§87's frustum test**, when `options.frustum` is given and the item says
 *    it may be culled. It runs second because it is the expensive one: a
 *    masked-out item never has its bounds computed.
 *
 * Order is preserved exactly — this is a subsequence, so §66's keys 1, 2 and 5
 * (and key 3, if `groupRenderListByPipeline` was applied to the source)
 * survive untouched. `out` is truncated to the number of items kept.
 *
 * ## What is never culled
 *
 * - An item whose node set `frustumCulled = false` (§49). That is the flag's
 *   entire job: geometry a vertex shader displaces, a skybox, a node whose
 *   bounds lie about where it draws.
 * - A **particle system** (§36) that has not published live bounds. Its
 *   item carries the shared unit quad as `geometry`, so the quad's box is a
 *   square at the emitter and says nothing about the particles. The builders
 *   write `frustumCulled = false` in that case. When the emitter publishes
 *   a local AABB (`computeBounds`), they copy a world sphere onto
 *   `item.worldBounds` and set `frustumCulled` so this scan can hide it
 *   (R-8 follow-up b) — still no `kind` check here.
 * - An item whose geometry cannot be bounded — see
 *   {@link computeWorldBoundingSphere} for the three cases and why each one
 *   fails towards drawing.
 *
 * ## Byte-identity
 *
 * With no frustum and a view that names no layers this function copies its
 * source, item for item, in order. That is what let it replace the WebGL
 * backend's inline per-item mask test without changing one GL call of any
 * existing scene — the filter moved, the set did not.
 *
 * @param source the frame's list, from `buildRenderList` or
 * `buildInterpolatedRenderList`. Read only; the derived list shares its pooled
 * items, so building the frame list again invalidates both.
 * @param view the viewport being drawn (§48).
 * @param out rewritten and truncated in place, then returned. One array per
 * *concurrently live* list; views drawn one after another can share one.
 * @throws FourError `INVALID_SCENE_GRAPH` **in a development build** when the
 * resolved layer mask is not an integer in `[0, 0xffffffff]` (§85) — see
 * {@link viewLayerMask}.
 */
export function buildViewRenderList(
  source: readonly RenderItem[],
  view: Viewport,
  out: RenderItem[],
  options: ViewRenderListOptions = {},
): RenderItem[] {
  const mask = viewLayerMask(view);
  const frustum = options.frustum ?? null;
  let count = 0;
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index];
    if (!layersMatch(item.layers, mask)) {
      continue;
    }
    if (
      frustum !== null &&
      item.frustumCulled &&
      isOutsideFrustum(item, frustum)
    ) {
      continue;
    }
    out[count] = item;
    count += 1;
  }
  out.length = count;
  return out;
}

/**
 * Whether `item` lies wholly outside `frustum`.
 *
 * Prefers {@link RenderItem.worldBounds} when the builders published one
 * (today: a particle system with live AABB). Otherwise derives the sphere
 * from the item's geometry, which is the ordinary mesh / sprite path.
 */
function isOutsideFrustum(item: RenderItem, frustum: Frustum): boolean {
  const published = item.worldBounds;
  if (published !== undefined && published !== null) {
    return !frustum.intersectsSphere(published.center, published.radius);
  }
  return (
    computeWorldBoundingSphere(
      item.geometry,
      item.worldMatrix,
      scratchSphere,
    ) && !frustum.intersectsSphere(scratchSphere.center, scratchSphere.radius)
  );
}

/**
 * Measures every item's distance along `viewMatrix`'s forward axis, sorts the
 * list with §66's **sort key 4** in place, and returns it (R-10 key 4, 2026-08-09).
 *
 * ```ts
 * buildViewRenderList(frameList, view, viewList, { frustum });
 * sortRenderListByDepth(viewList, view.camera.viewMatrix);
 * ```
 *
 * ## Why this is a verb and not a default (decision, R-8)
 *
 * The same reason `groupRenderListByPipeline` is, and it is worth restating
 * because the reason is *correctness*, not caution. §61 fixes the depth
 * function at `LEQUAL`, so of two opaque surfaces at the same depth the one
 * submitted later wins — which is what makes a §58 stroke paint over its own
 * fill and a later sibling draw on top. All of this engine's 2D content sits at
 * one depth, so a depth key applied to it permutes co-planar draws whose order
 * *is* the picture: sorting a 2D scene by depth repaints it. §66 lists key 4
 * for content whose overlap the depth buffer resolves, and no property of a
 * render item distinguishes that content from a stack of flat shapes. So the
 * caller who knows their scene is depth-resolved asks for the key, and every
 * existing scene keeps the order it has had since 2026-08-06 — byte for byte,
 * since neither builder is edited by this function's existence.
 *
 * ## Why it is per-view, and why it could not be written before R-8
 *
 * Depth is measured along *a* camera. One list served every view until this
 * packet, so a depth key computed for one camera would have ordered every other
 * view of the same list by the wrong number: a key written then would have been
 * **wrong**, not merely disruptive (recorded 2026-08-09). Sorting a derived
 * list is what makes the measurement belong to the view that uses it — and it
 * is why this verb takes a view matrix rather than reading one off a camera the
 * list does not know about.
 *
 * ## Key 3 outranks key 4 (R-8 follow-up a)
 *
 * §66's order is layer → opaque/transparent → pipeline/material → depth →
 * explicit order. After writing `viewDepth`, this verb applies
 * {@link compareRenderItems} — the one comparator that carries every key.
 * Transparent items still sort back-to-front, but only *within* the same
 * pipeline and material. A scene that never calls this function is untouched:
 * the builders still sort with keys 1, 2 and 5 only.
 *
 * ## What is measured
 *
 * The item's **world-space origin** — the translation column of its
 * `worldMatrix` — transformed into view space, negated so that larger means
 * farther from the camera. Not the centroid of its bounds, and the difference
 * is worth stating because §66 asks for transparent sorting's limitations to be
 * documented: a long floor plane whose origin is at one corner sorts by that
 * corner, and two interpenetrating transparent surfaces cannot be ordered by
 * any single number at all. Per-triangle ordering, weighted-blended
 * transparency, and OIT are §66's own named extension points and none of them
 * is this function.
 *
 * A non-finite measurement — a `NaN` in a world matrix — is written as `0`
 * rather than propagated: a comparator that returns `NaN` makes
 * `Array.prototype.sort` produce an implementation-defined order, which would
 * turn one bad matrix into a scene-wide reordering.
 *
 * @param list a list to sort in place; normally the output of
 * {@link buildViewRenderList}, so that culled items cost no measurement.
 * @param viewMatrix the camera's view matrix (§47) — world space to camera
 * space, looking down `−Z` (§7a).
 */
export function sortRenderListByDepth(
  list: RenderItem[],
  viewMatrix: Matrix4,
): RenderItem[] {
  const e = viewMatrix.elements;
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    const m = item.worldMatrix.elements;
    // Only the third row of the view matrix is needed: view-space `z` of the
    // world point `(m[12], m[13], m[14])`. Negated, because §7a's cameras look
    // down `−Z`, so a more negative `z` is farther away.
    const depth = -(e[2] * m[12] + e[6] * m[13] + e[10] * m[14] + e[14]);
    item.viewDepth = Number.isFinite(depth) ? depth : 0;
  }
  list.sort(compareRenderItems);
  return list;
}
