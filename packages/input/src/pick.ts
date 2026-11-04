/**
 * Picking and hit testing (§71) — the bounds tier.
 *
 * §71 asks for "one unified picking API [covering] 2D and 3D" over seven
 * strategies (analytic primitives, bounding volumes, path geometry,
 * ray/triangle, pixel alpha, GPU identifier buffer, custom callbacks). This
 * module ships the **bounding-volume** strategy, which is the one every other
 * strategy is built on top of: a camera ray from a normalized device
 * coordinate, tested against an axis-aligned box per candidate, nearest hit
 * first.
 *
 * ```ts
 * const hits: PickHit[] = [];            // allocated once, reused every pick
 * pick(camera, ndcX, ndcY, pickables, hits);
 * const nearest = hits[0];               // undefined when nothing was hit
 * ```
 *
 * ## Why the candidates are passed in (`Pickable`), not read off the scene
 *
 * `@fourjs/input` depends on `core`, `math`, and `scene` only (plan §3.1). It may
 * not import `@fourjs/render` or `@fourjs/geometry`, so it cannot see `Renderable`
 * or `BufferGeometry` and therefore cannot discover a node's bounds by itself —
 * and reversing that edge to let it try would put input below the renderer in
 * the layering, which the matrix forbids.
 *
 * The consequence is a better API rather than a worse one: picking takes a
 * **structural** candidate list, so anything with a box can be picked — a
 * renderable, a UI rectangle (§73), a collider's local AABB (§21), a hand-built
 * hot zone with no drawn geometry at all. The layer that *does* see geometry
 * builds the list:
 *
 * ```ts
 * // in the application, which may import @fourjs/geometry:
 * const bounds = renderable.geometry.computeBounds();
 * pickables.push({
 *   node: renderable,
 *   boundsMin: bounds.min,
 *   boundsMax: bounds.max,
 * });
 * ```
 *
 * `boundsMin`/`boundsMax` are **local** — the node's own space, before its
 * transform — which is exactly what `BufferGeometry.computeBounds()` returns
 * and exactly what a collider descriptor carries. Nothing has to be recomputed
 * when a node moves; a candidate list is rebuilt only when the *set* of
 * candidates changes.
 *
 * ## `node.hitTestMode` (§71; A-11's analytic tier, adopted RFC 0005 Q3)
 *
 * Since 2026-08-29 `Node.hitTestMode` exists and {@link pick} dispatches on it
 * per candidate:
 *
 * - **`null`** — the default, §71's *"the engine should select the cheapest
 *   valid method"*: the box test, refined by whatever data the candidate
 *   carries ({@link Pickable.triangles} first, then {@link Pickable.alphaMask}
 *   sampled at the refined distance). A candidate carrying neither is the
 *   plain bounds tier, byte-for-byte what it was before the field existed.
 * - **`"bounds"`** — the box alone; attached refinement data is deliberately
 *   ignored, because the author forced the cheapest method.
 * - **`"geometry"`** — exact ray/triangle against
 *   {@link Pickable.triangles}, which must be present (§85).
 * - **`"pixel"`** — the box hit must land on a present texel of
 *   {@link Pickable.alphaMask}, which must be present (§85).
 * - **`"gpu"`** — the candidate is skipped before its box is even tested:
 *   RFC 0005's id-buffer pass is that strategy's implementation, reached
 *   through {@link PickProvider}, and one pointer event must not resolve the
 *   node twice.
 *
 * A node absent from the candidate list is still not pickable at all — the
 * honest spelling of `hitTestMode = "none"`, unchanged.
 *
 * §71's remaining strategy names collapse into these tiers rather than into
 * code of their own. **Analytic primitive testing** and **path geometry
 * testing** are the `"geometry"` tier fed with a shape's tessellation: a §50
 * circle's parameters reach picking as the triangles `toPath()` + the fill
 * tessellator already produce for drawing, so what draws is what picks —
 * §51's flattening tolerance included — through one exact code path instead
 * of a per-primitive zoo. **Ray/triangle intersection** is that tier's own
 * name. The **GPU identifier buffer** landed with RFC 0005 (2026-08-28) in
 * `@fourjs/render` / `@fourjs/render-webgl`, adapted by `four`'s
 * `createPickProvider`; **pixel-alpha testing** for CPU-resident texels is
 * {@link Pickable.alphaMask} (alternative D). **Custom callbacks** are the
 * one §71 strategy still absent, and `HitTestMode` deliberately omits
 * `"custom"` until they exist.
 *
 * ## Why the box test runs in local space
 *
 * A candidate's box is tested by transforming the **ray** into the node's local
 * space (through the inverse of its world matrix) rather than by transforming
 * the **box** into world space. The two are not equivalent:
 *
 * - Transforming eight corners and taking their world-space extent produces an
 *   axis-aligned box that *contains* the rotated box and is strictly larger
 *   whenever the rotation is not a multiple of a quarter turn — a thin bar
 *   rotated 45° inflates into a square with roughly half its area empty.
 *   Everything in that empty margin becomes a false hit.
 * - Transforming the ray instead tests the true **oriented** box. It is exact
 *   under any affine transform — rotation, non-uniform scale, shear from a
 *   parent — and it costs one matrix inversion per candidate instead of eight
 *   point transforms plus a min/max fold.
 *
 * It also makes the returned distance come out right for free. The local ray
 * direction is deliberately **not** re-normalized: writing the local ray as
 * `O_local + t · D_local` with `D_local = M⁻¹ · d_world`, applying `M` gives
 * `O_world + t · d_world`, so with a unit `d_world` the parameter `t` solved in
 * local space *is* the world-space distance, whatever the node's scale. No
 * correction factor, no second transform to measure with.
 *
 * ## Allocation (plan D7)
 *
 * Both entry points are allocation-free in the steady state: module-level
 * scratch for the ray and the inverse matrix, and hit objects pooled per `out`
 * array exactly as `@fourjs/render`'s render list pools its items. Nothing here
 * is re-entrant — single-threaded input handling never calls user code
 * mid-pick.
 */

import { FourError } from "@fourjs/core";
import { Matrix4, Vector3, type DepthRange } from "@fourjs/math";
import { resolveWorldTransform, type Camera, type Node } from "@fourjs/scene";

/**
 * Clip-space depth convention assumed when a caller does not pass one: OpenGL's
 * `[-1, 1]` (plan D8), matching `Camera.updateProjectionMatrix`'s default and
 * the WebGL 2 MVP (§120).
 */
const DEFAULT_DEPTH_RANGE: DepthRange = "negative-one-to-one";

/** {@link intersectBox}'s "no intersection" sentinel; every hit has `t >= 0`. */
const MISS = -1;

/** Combined `cameraWorld · inverseProjection`, rebuilt by every ray. */
const unprojection = new Matrix4();

/** Far-plane unprojection, subtracted from the origin to get the direction. */
const farPoint = new Vector3();

/** The pick ray, in world space. */
const rayOrigin = new Vector3();
const rayDirection = new Vector3();

/** The pick ray, in the candidate's local space. */
const localOrigin = new Vector3();
const localDirection = new Vector3();

/** Inverse world matrix of the candidate under test. */
const inverseWorld = new Matrix4();

/**
 * Slab test of the ray `origin + t · direction` against the axis-aligned box
 * `[min, max]`, returning the smallest `t >= 0` inside the box, or
 * {@link MISS}.
 *
 * The comparisons are written as `t1 > tMin ? t1 : tMin` rather than
 * `Math.max(tMin, t1)` on purpose: a direction component of exactly zero makes
 * `(min - origin) * Infinity` evaluate to `NaN` when the origin sits precisely
 * on that slab's plane, and every `NaN` comparison is false, so the ternary
 * form *ignores* the degenerate slab instead of poisoning the interval the way
 * `Math.max` would. An axis-parallel ray therefore behaves as it should:
 * unconstrained by the slab it runs inside, rejected by the slab it runs
 * outside.
 *
 * `tMin` starts at 0, so a box the ray only meets behind its origin is a miss
 * and a ray starting *inside* a box hits it at distance 0 — picking never
 * selects what is behind the near plane, and a camera inside an object is
 * touching it.
 */
function intersectBox(
  origin: Vector3,
  direction: Vector3,
  min: Vector3,
  max: Vector3,
): number {
  let tMin = 0;
  let tMax = Infinity;

  const inverseX = 1 / direction.x;
  let near = (min.x - origin.x) * inverseX;
  let far = (max.x - origin.x) * inverseX;
  if (near > far) {
    const swap = near;
    near = far;
    far = swap;
  }
  tMin = near > tMin ? near : tMin;
  tMax = far < tMax ? far : tMax;

  const inverseY = 1 / direction.y;
  near = (min.y - origin.y) * inverseY;
  far = (max.y - origin.y) * inverseY;
  if (near > far) {
    const swap = near;
    near = far;
    far = swap;
  }
  tMin = near > tMin ? near : tMin;
  tMax = far < tMax ? far : tMax;

  const inverseZ = 1 / direction.z;
  near = (min.z - origin.z) * inverseZ;
  far = (max.z - origin.z) * inverseZ;
  if (near > far) {
    const swap = near;
    near = far;
    far = swap;
  }
  tMin = near > tMin ? near : tMin;
  tMax = far < tMax ? far : tMax;

  return tMax >= tMin ? tMin : MISS;
}

/**
 * Writes the world-space picking ray through the normalized device coordinate
 * `(ndcX, ndcY)` into `outOrigin` and `outDirection` (§71).
 *
 * NDC runs `[-1, 1]` on both axes with **+Y up** (§7a), so `(-1, -1)` is the
 * bottom-left of the viewport and `(0, 0)` its centre; converting a pointer
 * position in CSS pixels into NDC is the pointer source's job (§72), not this
 * function's. The ray starts on the **near plane** and points into the scene,
 * `outDirection` normalized, and it is correct for both projections: a
 * perspective camera's rays fan out from the eye, an orthographic camera's are
 * all parallel and start at different places on the near plane.
 *
 * ```ts
 * const origin = new Vector3();
 * const direction = new Vector3();
 * createPickRay(camera, ndcX, ndcY, origin, direction);
 * ```
 *
 * The camera's **world matrix is resolved on demand**
 * (`resolveWorldTransform`), so a camera that has just moved — or that hangs
 * off a spring arm which has just moved — produces a correct ray without the
 * caller sequencing a resolve pass first. That walk is O(depth) and
 * version-cached, so on the normal path (the frame already resolved the scene)
 * it costs one comparison per ancestor.
 *
 * The camera's **projection is taken as-is**. `inverseProjectionMatrix` is
 * written by `Camera.updateProjectionMatrix`, which §47/WP-3.1 make explicit:
 * after changing a field like `aspect` on a resize, call it. Picking cannot do
 * that itself without guessing the `depthRange` the renderer used.
 *
 * `depthRange` (plan D8) says which clip-space depth convention that projection
 * was built with, and only affects **where along the ray the origin lands** —
 * the near plane's NDC depth is `-1` under `"negative-one-to-one"` and `0`
 * under `"zero-to-one"`. Passing the wrong one still yields the same ray
 * *line*, so hits are unaffected and only reported distances shift by a
 * constant; passing the right one makes them distances from the near plane. It
 * defaults to `"negative-one-to-one"` to match `updateProjectionMatrix`, so
 * WebGL 2 callers never pass it and WebGPU callers pass `"zero-to-one"`
 * (decision, WP-3a.1 — a camera does not store its depth range, because it
 * belongs to the renderer that draws the camera, and the same camera may feed
 * two backends).
 *
 * Allocates nothing. A degenerate projection (a zero-sized view volume,
 * `near === far`) leaves `outDirection` zero-length rather than `NaN`; see
 * {@link pick}, which treats such a ray as hitting nothing.
 */
export function createPickRay(
  camera: Camera,
  ndcX: number,
  ndcY: number,
  outOrigin: Vector3,
  outDirection: Vector3,
  depthRange: DepthRange = DEFAULT_DEPTH_RANGE,
): void {
  // clip -> camera -> world, in one matrix: unprojecting is then a single
  // transform plus a perspective divide per point.
  unprojection
    .copy(resolveWorldTransform(camera))
    .multiply(camera.inverseProjectionMatrix);

  const nearZ = depthRange === "zero-to-one" ? 0 : -1;
  outOrigin.set(ndcX, ndcY, nearZ).applyProjection(unprojection);
  farPoint.set(ndcX, ndcY, 1).applyProjection(unprojection);

  outDirection.copy(farPoint).sub(outOrigin).normalize();
}

/**
 * A picking result provider this package does not implement (§71's `"gpu"` /
 * `"pixel"` id-buffer tier; RFC 0005, 2026-08-28) — the structural seam that
 * lets §72's event propagation dispatch on a pixel-picked target without
 * `@fourjs/input` gaining a render dependency.
 *
 * The whole contract: two normalized device coordinates in (the same
 * `[-1, 1]`, +Y-up pair {@link pick} takes), a `Node.id` out — or
 * `undefined` for "nothing there" — **asynchronously**, because every honest
 * GPU read-back is (RFC 0005 §4; a §9-tier explanation lives on
 * `@fourjs/render`'s `PickingService`, which is one implementation of this
 * seam via `@fourjs/four`'s `createPickProvider`). It names no render type, no
 * target, no texture, no scene — the fourth instance of the `FetchLike` /
 * `SurfaceSizedCamera` move — so a test satisfies it with a `Map` lookup and
 * no GPU at all:
 *
 * ```ts
 * const provider: PickProvider = {
 *   pick: (x, y) => Promise.resolve(x > 0 ? "node-3" : undefined),
 * };
 * ```
 *
 * The synchronous {@link pick} below is not changed and not deprecated: the
 * bounds tier stays the cheap default, and a provider is what a pointer
 * handler consults when bounds are not precise enough.
 */
export interface PickProvider {
  /** Resolves the front-most node id under `(ndcX, ndcY)`, or `undefined`. */
  pick(ndcX: number, ndcY: number): Promise<string | undefined>;
}

/**
 * §71's `"pixel"` strategy for the CPU-resident case (RFC 0005 alternative D,
 * adopted): the texels a candidate's visible shape comes from, so a bounds
 * hit can be confirmed — or rejected — by the alpha actually under the point.
 *
 * The common carrier is a §55 sprite: its `TextureSource.data` is already
 * CPU-side RGBA8, so a transparent corner of a quad stops picking **without a
 * renderer, a read-back, or a new package edge** — which is why this tier
 * lives here and the id-buffer tier does not. It composes with the box test
 * rather than replacing it: the box says *where* the ray meets the candidate,
 * the mask says whether that texel is really there.
 *
 * ## Sampling
 *
 * The box entry point's local `x`/`y` are normalized against the box extents
 * to `u`/`v` in `[0, 1]` (an axis of zero extent — a flat sprite's thickness
 * — reads as `0`), then nearest-sampled: `u` maps across
 * {@link PickableAlphaMask.region}'s columns, `v` across its rows, **row 0
 * being the box's −Y edge** — exactly the orientation `texImage2D` gives the
 * same array, so what picks is what shows. The hit is kept when the sampled
 * alpha is strictly greater than {@link PickableAlphaMask.threshold}.
 */
export interface PickableAlphaMask {
  /**
   * RGBA8 texels, row-major, 4 bytes per texel — `TextureSource.data`'s
   * layout, and usually that very array.
   */
  data: Uint8Array | Uint8ClampedArray;
  /** Width of `data` in texels. A positive integer (§85). */
  width: number;
  /** Height of `data` in texels. A positive integer (§85). */
  height: number;
  /**
   * The sub-rectangle of `data` the candidate's shape shows, in texels —
   * §55's frame, for a sprite that atlases. Absent means all of `data`.
   * Must lie inside `width` × `height` (§85).
   */
  region?: { x: number; y: number; width: number; height: number };
  /**
   * Alpha in `[0, 1]` a texel must **exceed** to count as present. Defaults
   * to `0` — any nonzero alpha picks, which is §71's reading of "pixel-alpha
   * testing"; raise it to ignore soft edges.
   */
  threshold?: number;
}

/**
 * §71's `"geometry"` strategy (A-11's analytic tier, 2026-08-29): the
 * tessellated triangles a candidate's true shape is made of, in the node's
 * **local space**, so a box hit can be confirmed — or rejected — by exact
 * ray/triangle intersection. The box stays the broad phase; the triangles are
 * what say a concave silhouette's notch, a circle's corner gap, or a mesh's
 * empty margin was *not* hit.
 *
 * The record is **structural** for the module header's reason: `@fourjs/input`
 * may not import `@fourjs/geometry` (plan §3.1), so the layout is
 * `BufferGeometry`'s own (`positions`/`indices`) without naming it, and the
 * layer that sees geometry builds the record in one line:
 *
 * ```ts
 * // in the application, which may import @fourjs/geometry:
 * pickable.triangles = { positions: geometry.positions, indices: geometry.indices };
 * ```
 *
 * ## The test
 *
 * Möller–Trumbore per triangle, in the candidate's local space with the
 * deliberately unnormalized local ray — so, exactly as the box test's, the
 * reported parameter *is* the world-space distance under any affine
 * transform. Triangles are tested in index order and the smallest `t >= 0`
 * wins; **winding does not matter** (no backface culling — §71 states no
 * winding rule, and a 2D shape must pick from either side of its plane). A
 * triangle the ray runs exactly parallel to is skipped, as is any triangle
 * whose arithmetic degenerates to `NaN` — the same fail-toward-miss
 * discipline the internal box test (`intersectBox`) documents.
 *
 * ## Validation (§85), once per record
 *
 * A record is checked the first time it is consulted — lengths in threes, and
 * every index inside `positions` ("invalid geometry indices", §85) — then
 * remembered, because re-scanning an index array per pick would put an O(n)
 * pass on a hot path (`BufferGeometry` validates on assignment for the same
 * reason). In-place edits after that first consult are therefore **not**
 * re-validated — `markDirty`'s own rule — and an index left dangling by one
 * reads as `NaN` arithmetic, which misses rather than crashes.
 */
export interface PickableTriangles {
  /**
   * Vertex positions, 3 floats per vertex, in the node's local space —
   * `BufferGeometry.positions`' layout, and usually that very array.
   */
  positions: Float32Array;
  /**
   * Triangle indices into `positions`, 3 per triangle —
   * `BufferGeometry.indices`' layout. Absent means non-indexed: consecutive
   * position triples are the triangles.
   */
  indices?: Uint16Array | Uint32Array;
}

/**
 * A picking candidate: a node plus the box, **in that node's local space**,
 * that stands in for its shape (§71's bounding-volume strategy).
 *
 * Local rather than world bounds is what makes the candidate list cheap to keep
 * — see the module header — and what makes the hit test exact under rotation.
 * `BufferGeometry.computeBounds()` returns exactly this pair; a candidate whose
 * box is empty or inverted (`min > max` on any axis, the empty-geometry
 * convention) is never hit.
 */
export interface Pickable {
  /** The node the box belongs to, and the node a hit reports. */
  node: Node;
  /** Lower corner of the box, in `node`'s local space. */
  boundsMin: Vector3;
  /** Upper corner of the box, in `node`'s local space. */
  boundsMax: Vector3;
  /**
   * §71's `"pixel"` refinement (RFC 0005 alternative D): confirm a box hit
   * against these texels' alpha before reporting it. Absent — every candidate
   * before this field existed — means the box alone decides, which keeps the
   * bounds tier byte-for-byte what it was.
   */
  alphaMask?: PickableAlphaMask;
  /**
   * §71's `"geometry"` refinement (A-11's analytic tier): confirm a box hit
   * by exact ray/triangle intersection against these local-space triangles,
   * refining the hit's distance and point to the actual surface. Absent —
   * every candidate before this field existed — means the box (and any
   * {@link Pickable.alphaMask}) decides as before. Consulted under
   * `hitTestMode` `null` and `"geometry"`; see {@link PickableTriangles}.
   */
  triangles?: PickableTriangles;
}

/** One intersection between a pick ray and a {@link Pickable}. */
export interface PickHit {
  /** The candidate's node. */
  node: Node;
  /**
   * World-space distance from the ray origin (the near plane) to
   * {@link PickHit.point}. Zero when the ray starts inside the box.
   */
  distance: number;
  /**
   * World-space entry point. A **pooled** vector owned by the hit — read it or
   * copy it, never keep it across the next {@link pick} into the same array.
   */
  point: Vector3;
}

/** Pooled backing store for one `out` array. */
interface HitPool {
  /** Hit objects, indexed by generation order, not by final sorted order. */
  readonly hits: PickHit[];
}

/**
 * Pools, keyed by the `out` array they serve — the same arrangement
 * `@fourjs/render`'s render list uses, and for the same reason: two independent
 * live result lists (a hover query and a drag query) each keep their own hits,
 * and a discarded array takes its pool with it.
 */
const pools = new WeakMap<readonly PickHit[], HitPool>();

function poolFor(out: PickHit[]): HitPool {
  let pool = pools.get(out);
  if (pool === undefined) {
    pool = { hits: [] };
    pools.set(out, pool);
  }
  return pool;
}

/**
 * Returns pooled hit `index`, creating it — once, ever, for this `out` array —
 * with its own `point` vector. Every field is overwritten by the caller.
 */
function hitAt(pool: HitPool, index: number, node: Node): PickHit {
  let hit = pool.hits[index];
  if (hit === undefined) {
    hit = { node, distance: 0, point: new Vector3() };
    pool.hits[index] = hit;
  }
  return hit;
}

/** Nearest first (§71). Ties keep candidate-list order, since `sort` is stable. */
function compareHits(a: PickHit, b: PickHit): number {
  return a.distance - b.distance;
}

/**
 * Refuses a malformed {@link PickableAlphaMask} (§85) — a dimension that is
 * not a positive integer, a `data` too short for it, or a `region` outside
 * it. Refused rather than skipped, because a candidate that *asked* for
 * alpha testing and silently fell back to the box would pick texels the
 * author declared transparent; and refused from here — the call that can see
 * the mistake — because the mask is only ever read when its box is hit.
 *
 * @throws FourError `INVALID_APPLICATION_STATE`.
 */
function assertAlphaMask(mask: PickableAlphaMask, node: Node): void {
  const { width, height, data, region } = mask;
  if (
    !(Number.isInteger(width) && width > 0) ||
    !(Number.isInteger(height) && height > 0) ||
    data.length < width * height * 4
  ) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      `§71: malformed alphaMask on "${node.id}" (§85).`,
      { context: { node: node.id, width, height, dataLength: data.length } },
    );
  }
  if (
    region !== undefined &&
    (!(Number.isInteger(region.x) && region.x >= 0) ||
      !(Number.isInteger(region.y) && region.y >= 0) ||
      !(Number.isInteger(region.width) && region.width > 0) ||
      !(Number.isInteger(region.height) && region.height > 0) ||
      region.x + region.width > width ||
      region.y + region.height > height)
  ) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      `§71: alphaMask region outside the mask on "${node.id}" (§85).`,
      { context: { node: node.id, region: { ...region }, width, height } },
    );
  }
}

/**
 * Whether the box hit at parameter `t` lands on a present texel of `mask`
 * (§71's `"pixel"` strategy; see {@link PickableAlphaMask} for the sampling
 * contract). Reads the module's local-ray scratch, so it must run while that
 * still describes this candidate — immediately after {@link intersectBox}.
 */
function passesAlphaMask(
  mask: PickableAlphaMask,
  min: Vector3,
  max: Vector3,
  t: number,
): boolean {
  const regionX = mask.region?.x ?? 0;
  const regionY = mask.region?.y ?? 0;
  const regionWidth = mask.region?.width ?? mask.width;
  const regionHeight = mask.region?.height ?? mask.height;

  // The entry point, in the candidate's local space — the same
  // parameterization the world-space `hit.point` uses, one transform earlier.
  const hitX = localOrigin.x + t * localDirection.x;
  const hitY = localOrigin.y + t * localDirection.y;
  const extentX = max.x - min.x;
  const extentY = max.y - min.y;
  // A zero-extent axis (a flat sprite's thickness, a degenerate box the
  // caller still gave a mask) reads as 0 rather than dividing to NaN.
  const u = extentX > 0 ? (hitX - min.x) / extentX : 0;
  const v = extentY > 0 ? (hitY - min.y) / extentY : 0;

  // Nearest sample, clamped so the box's far edges land on the last texel
  // rather than one past it (a hit exactly on the max edge has `u = 1`, and
  // float error can put it a hair outside `[0, 1]`).
  const sampleIndex = (value: number, count: number): number =>
    value <= 0 ? 0 : value >= 1 ? count - 1 : Math.floor(value * count);
  const column = regionX + sampleIndex(u, regionWidth);
  const row = regionY + sampleIndex(v, regionHeight);

  const alpha = mask.data[(row * mask.width + column) * 4 + 3] / 255;
  return alpha > (mask.threshold ?? 0);
}

/**
 * Records already validated by {@link assertTriangles}, so the O(n) index scan
 * runs once per record rather than once per pick — see the §85 section on
 * {@link PickableTriangles} for why (and for the in-place-edit caveat that
 * cache buys). A `WeakSet`, so a discarded record takes its entry with it.
 */
const validatedTriangles = new WeakSet<PickableTriangles>();

/**
 * Refuses a malformed {@link PickableTriangles} (§85) — a `positions` or
 * `indices` length that is not whole triangles, or an index outside
 * `positions` (§85's "invalid geometry indices"; the typed index arrays
 * cannot hold a negative or fractional one, so the upper bound is the whole
 * check). Refused rather than skipped, for {@link assertAlphaMask}'s reason:
 * a candidate that *asked* for exact testing and silently fell back to the
 * box would pick where the author's real shape is not. Validated where the
 * triangles are first consulted, then cached — see {@link validatedTriangles}.
 *
 * @throws FourError `INVALID_APPLICATION_STATE`.
 */
function assertTriangles(triangles: PickableTriangles, node: Node): void {
  if (validatedTriangles.has(triangles)) {
    return;
  }
  const { positions, indices } = triangles;
  const vertexCount = positions.length / 3;
  if (
    positions.length % 3 !== 0 ||
    (indices === undefined ? vertexCount % 3 !== 0 : indices.length % 3 !== 0)
  ) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      `§71: malformed triangles on "${node.id}" — not whole triangles (§85).`,
      {
        context: {
          node: node.id,
          positionsLength: positions.length,
          indicesLength: indices?.length ?? null,
        },
      },
    );
  }
  if (indices !== undefined) {
    for (let i = 0; i < indices.length; i += 1) {
      if (indices[i] >= vertexCount) {
        throw new FourError(
          "INVALID_APPLICATION_STATE",
          `§71: triangle index outside positions on "${node.id}" (§85).`,
          { context: { node: node.id, index: indices[i], vertexCount } },
        );
      }
    }
  }
  validatedTriangles.add(triangles);
}

/**
 * Smallest `t >= 0` at which the module's local ray meets a triangle of
 * `triangles`, or {@link MISS} — §71's ray/triangle strategy, Möller–Trumbore
 * per triangle (see {@link PickableTriangles} for the contract: unnormalized
 * local direction so `t` is world distance, index-order iteration so the
 * result is §33-deterministic, no backface culling).
 *
 * The `u`/`v`/`t` guards are written in the **accepting** direction
 * (`!(u >= 0 && …)`) so a `NaN` produced by degenerate data fails toward a
 * miss — {@link intersectBox}'s discipline. An exactly-parallel ray makes
 * `det === 0` and skips the triangle; a merely near-parallel one survives the
 * division and is discarded by the barycentric bounds, since `1 / det` blows
 * `u` and `v` far outside `[0, 1]`.
 *
 * Reads the module's local-ray scratch, so it must run while that still
 * describes this candidate — immediately after {@link intersectBox}, exactly
 * as {@link passesAlphaMask} must.
 */
function intersectTriangles(triangles: PickableTriangles): number {
  const positions = triangles.positions;
  const indices = triangles.indices;
  const triangleCount =
    (indices === undefined ? positions.length / 3 : indices.length) / 3;
  const ox = localOrigin.x;
  const oy = localOrigin.y;
  const oz = localOrigin.z;
  const dx = localDirection.x;
  const dy = localDirection.y;
  const dz = localDirection.z;

  let best = MISS;
  for (let i = 0; i < triangleCount; i += 1) {
    const corner = 3 * i;
    const a = 3 * (indices === undefined ? corner : indices[corner]);
    const b = 3 * (indices === undefined ? corner + 1 : indices[corner + 1]);
    const c = 3 * (indices === undefined ? corner + 2 : indices[corner + 2]);
    const ax = positions[a];
    const ay = positions[a + 1];
    const az = positions[a + 2];

    const edge1x = positions[b] - ax;
    const edge1y = positions[b + 1] - ay;
    const edge1z = positions[b + 2] - az;
    const edge2x = positions[c] - ax;
    const edge2y = positions[c + 1] - ay;
    const edge2z = positions[c + 2] - az;

    // p = direction × edge2; det = edge1 · p.
    const px = dy * edge2z - dz * edge2y;
    const py = dz * edge2x - dx * edge2z;
    const pz = dx * edge2y - dy * edge2x;
    const det = edge1x * px + edge1y * py + edge1z * pz;
    if (det === 0) {
      continue;
    }
    const inverseDet = 1 / det;

    const sx = ox - ax;
    const sy = oy - ay;
    const sz = oz - az;
    const u = (sx * px + sy * py + sz * pz) * inverseDet;
    if (!(u >= 0 && u <= 1)) {
      continue;
    }

    // q = s × edge1.
    const qx = sy * edge1z - sz * edge1y;
    const qy = sz * edge1x - sx * edge1z;
    const qz = sx * edge1y - sy * edge1x;
    const v = (dx * qx + dy * qy + dz * qz) * inverseDet;
    if (!(v >= 0 && u + v <= 1)) {
      continue;
    }

    const t = (edge2x * qx + edge2y * qy + edge2z * qz) * inverseDet;
    if (t >= 0 && (best === MISS || t < best)) {
      best = t;
    }
  }
  return best;
}

/**
 * Refuses a candidate whose node demanded a strategy its `Pickable` carries
 * no data for (§85) — `"geometry"` without {@link Pickable.triangles},
 * `"pixel"` without {@link Pickable.alphaMask}. Refused rather than fallen
 * back, because an explicit `hitTestMode` is precisely the author saying the
 * box is *not* an acceptable answer; and refused from here — after the box
 * gate, where the data would first be consulted — matching where a malformed
 * mask or triangle record is caught.
 *
 * @throws FourError `INVALID_APPLICATION_STATE`.
 */
function refuseMissingModeData(node: Node, mode: string, field: string): never {
  throw new FourError(
    "INVALID_APPLICATION_STATE",
    `§71: hitTestMode "${mode}" on "${node.id}" but its candidate carries no ${field} (§85).`,
    { context: { node: node.id, mode, field } },
  );
}

/**
 * Tests the picking ray through `(ndcX, ndcY)` against every candidate and
 * returns the hits, **nearest first** (§71).
 *
 * ```ts
 * const hits: PickHit[] = [];                 // reused
 * pick(camera, ndcX, ndcY, pickables, hits);
 * if (hits.length > 0) select(hits[0].node);  // hits[0] is the front-most
 * ```
 *
 * Each candidate is tested in **its own local space** — the ray is transformed
 * by the inverse of the node's world matrix, so a rotated or non-uniformly
 * scaled box is tested exactly rather than as an inflated world-space AABB (see
 * the module header). World matrices are resolved on demand per candidate, so
 * the result is correct mid-frame without a preceding resolve pass.
 *
 * Every hit reports the **entry** point: the first intersection at or after the
 * ray origin. A ray that starts inside a box hits it at distance 0; a box
 * entirely behind the near plane is not hit at all. `out` is truncated to the
 * number of hits, so an empty array means nothing was picked.
 *
 * Skipped rather than reported, in both cases because no meaningful answer
 * exists: a candidate with an **empty or inverted** box (the `min = +Infinity`
 * convention of an empty geometry), and one whose world matrix is **singular**
 * (a zero scale somewhere up its chain), which cannot be inverted and describes
 * a node collapsed to nothing. A degenerate camera whose ray has no direction
 * yields no hits at all.
 *
 * `node.hitTestMode` selects each candidate's strategy — the module header
 * has the full table. In brief: `null` (the default) refines the box hit by
 * whatever the candidate carries; `"bounds"`, `"geometry"` and `"pixel"`
 * force one strategy, the latter two **throwing** `FourError`
 * (`INVALID_APPLICATION_STATE`, §85) when their box is hit but the candidate
 * carries no {@link Pickable.triangles} / {@link Pickable.alphaMask}; and a
 * `"gpu"` candidate is never tested here at all. A geometry-refined hit
 * reports the distance and point of the triangle actually under the pointer,
 * not the box entry.
 *
 * Allocation follows plan D7: pass `out` and the steady state allocates
 * nothing — the hits are pooled per array and rewritten in place, which is why
 * a hit (and its `point`) read after the next `pick` into the same array
 * describes a different intersection. Omitting `out` allocates a fresh array
 * for authoring convenience.
 *
 * `depthRange` is forwarded to {@link createPickRay}; see there.
 */
export function pick(
  camera: Camera,
  ndcX: number,
  ndcY: number,
  pickables: readonly Pickable[],
  out: PickHit[] = [],
  depthRange: DepthRange = DEFAULT_DEPTH_RANGE,
): PickHit[] {
  const pool = poolFor(out);
  createPickRay(camera, ndcX, ndcY, rayOrigin, rayDirection, depthRange);

  let count = 0;
  // A zero-length (or non-finite) direction means the camera could not produce
  // a ray; `> 0` is false for NaN too, which is the point.
  if (rayDirection.lengthSq() > 0) {
    for (let i = 0; i < pickables.length; i += 1) {
      const pickable = pickables[i];
      const mode = pickable.node.hitTestMode;
      // §71's "gpu" strategy is the id-buffer pass's to answer (RFC 0005),
      // reached through a PickProvider — the ray tier stands aside before the
      // box is even tested, so one pointer event cannot resolve the node
      // twice.
      if (mode === "gpu") {
        continue;
      }
      const min = pickable.boundsMin;
      const max = pickable.boundsMax;
      if (!(min.x <= max.x && min.y <= max.y && min.z <= max.z)) {
        continue;
      }

      const world = resolveWorldTransform(pickable.node);
      if (world.determinant() === 0) {
        continue;
      }
      inverseWorld.copy(world).invert();

      localOrigin.copy(rayOrigin).applyMatrix4(inverseWorld);
      localDirection.copy(rayDirection).transformDirection(inverseWorld);

      // `t` is a world-space distance despite being solved in local space —
      // the local direction is deliberately left unnormalized.
      let t = intersectBox(localOrigin, localDirection, min, max);
      if (t === MISS) {
        continue;
      }

      // §71's refinements, dispatched on `node.hitTestMode` (module header):
      // the default `null` applies whatever the candidate carries — triangles
      // first, the mask sampled at the refined distance — which is exactly
      // the pre-field behaviour for every candidate that carries neither; an
      // explicit mode selects one strategy and requires its data (§85);
      // "bounds" runs neither block. Validated here — the first moment each
      // record is actually consulted.
      const triangles =
        mode === null || mode === "geometry" ? pickable.triangles : undefined;
      if (triangles === undefined) {
        if (mode === "geometry") {
          refuseMissingModeData(pickable.node, mode, "triangles");
        }
      } else {
        // §71's `"geometry"` refinement (A-11's analytic tier): the exact
        // surface distance replaces the box-entry distance, so the reported
        // hit lies on the triangle actually under the pointer.
        assertTriangles(triangles, pickable.node);
        t = intersectTriangles(triangles);
        if (t === MISS) {
          continue;
        }
      }
      const mask =
        mode === null || mode === "pixel" ? pickable.alphaMask : undefined;
      if (mask === undefined) {
        if (mode === "pixel") {
          refuseMissingModeData(pickable.node, mode, "alphaMask");
        }
      } else {
        // §71's `"pixel"` refinement (RFC 0005 alternative D): a candidate
        // that carries texels is hit only where they are present.
        assertAlphaMask(mask, pickable.node);
        if (!passesAlphaMask(mask, min, max, t)) {
          continue;
        }
      }

      const hit = hitAt(pool, count, pickable.node);
      hit.node = pickable.node;
      hit.distance = t;
      hit.point.copy(rayDirection).scale(t).add(rayOrigin);
      out[count] = hit;
      count += 1;
    }
  }

  out.length = count;
  out.sort(compareHits);
  return out;
}
