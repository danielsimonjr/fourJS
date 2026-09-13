/**
 * Collision shapes (§24) and their §85 parameter validation.
 *
 * ## What ships (PH-22a, 2026-08-08)
 *
 * §24 requires seven 2D shapes (circle, rectangle, capsule, polygon, polyline,
 * chain, compound) and nine 3D shapes (sphere, box, capsule, cylinder, cone,
 * convex hull, triangle mesh, height field, compound). Phase 5 shipped the
 * primitive tier; PH-22a adds every remaining §24 shape a solver in this
 * repository can build *and* solve:
 *
 * | Dimension | Shipped                                                                                 |
 * | --------- | --------------------------------------------------------------------------------------- |
 * | `"2d"`    | circle, rectangle, capsule, polygon, polyline, chain                                      |
 * | `"3d"`    | sphere, box, capsule, cylinder, cone, convex-hull, triangle-mesh, height-field            |
 *
 * **`compound` is shipped as composition, not as a tag.** §24 lists it in both
 * dimensions, and it is the one §24 entry that is not a shape: it is *several*
 * shapes on one body. That is exactly what a body with several
 * {@link "./collider".Collider} components already is — and, since PH-5, what
 * `PhysicsWorld.addCollider` / `removeCollider` can assemble and take apart at
 * runtime. Rapier itself has no compound collider for the same reason. A
 * `{ type: "compound", parts: [...] }` tag would be a second way to say the
 * same thing, with its own offsets, its own material rules, and no second
 * simulation behind it, so it is deliberately absent (decision, 2026-08-08).
 *
 * ### Which shapes a §30 query may use
 *
 * Four of the shipped shapes are **composite** — `polyline`, `chain`,
 * `triangle-mesh`, `height-field`. They are legal collider shapes and illegal
 * *query* shapes: {@link validateQueryShape} refuses them for §30's `overlap`
 * and `shapeCast`. This is not conservatism. Measured against Rapier 0.19.3
 * (2026-08-08): a flat `Heightfield` placed at the centre of a 2×2×2 cuboid —
 * an unambiguous overlap — is reported by `World.intersectionsWithShape` as
 * **zero** intersections. A composite query shape does not fail, it answers
 * wrongly, which is the one outcome this repository does not ship. Every
 * convex shape stays available to both queries.
 *
 * ## Conventions (§7a, §7b)
 *
 * - The world is right-handed and **Y-up in both dimensions**; a `"2d"` shape
 *   lives in the world XY plane.
 * - Capsule and every other extent is expressed in **half** measures
 *   (`halfExtents`, `halfHeight`), matching the solvers this API sits above and
 *   removing the halving that a full-extent API repeats at every call site.
 * - A capsule's axis is **+Y**, so the same declaration means the same upright
 *   capsule in a 2D and a 3D world. A cylinder's and a cone's axis is **+Y**
 *   too, and a cone's **apex is at `+halfHeight`** — measured against Rapier
 *   0.19.3 by raycasting a `radius = 0.5`, `halfHeight = 1` cone along −X at
 *   three heights and reading the surface off at `x = 0.025 / 0.25 / 0.475`
 *   for `y = +0.9 / 0 / −0.9`, i.e. `r(y) = radius · (halfHeight − y) / (2 ·
 *   halfHeight)`.
 * - Shapes carry `Vector2`/`Vector3` instances, which are mutable (§7b). The
 *   descriptor holds a reference, not a copy: mutating a vector after the
 *   collider is created does not retroactively change the collider, and
 *   re-validating a shape you have mutated is the caller's job.
 *
 * Shapes are plain data. They have no identity, no lifecycle, and no solver
 * state — {@link CollisionShape} values may be shared between any number of
 * colliders.
 */

import { FourError } from "@fourjs/core";
import type { Vector2, Vector3 } from "@fourjs/math";

import type { PhysicsDimension } from "./types.js";

/**
 * Every shape validation failure is a caller error in the §85 sense ("invalid
 * geometry", "impossible mass/inertia values"), reported with the engine's
 * general invalid-input code (§89) — the same code the animation package uses
 * for malformed descriptors. There is no physics-specific code in §89's list,
 * and `PHYSICS_SOLVER_FAILED` means the *solver* failed, which is a different
 * event entirely.
 */
const SHAPE_ERROR_CODE = "INVALID_APPLICATION_STATE";

/** A disc in the XY plane, `"2d"` only (§24). */
export interface CircleShape {
  readonly type: "circle";
  /** Distance from the centre to the rim, in world units. Must be > 0. */
  readonly radius: number;
}

/** An axis-aligned rectangle in the XY plane, `"2d"` only (§24). */
export interface RectangleShape {
  readonly type: "rectangle";
  /**
   * Half the width and half the height, measured from the centre along the
   * local X and Y axes. Both components must be > 0.
   */
  readonly halfExtents: Vector2;
}

/**
 * A capsule — a cylinder capped by hemispheres — with its axis along **+Y**
 * (§24). Valid in **both** dimensions: in a `"2d"` world it is the 2D
 * stadium/pill shape, in a `"3d"` world the 3D capsule. The parameters are the
 * same in both, which is exactly §21's parallel-naming rule.
 */
export interface CapsuleShape {
  readonly type: "capsule";
  /** Radius of the caps and of the cylindrical section. Must be > 0. */
  readonly radius: number;
  /**
   * Half the length of the **cylindrical section only**, along local Y —
   * excluding the caps. The total height of the shape is therefore
   * `2 * (halfHeight + radius)`. Must be > 0; a capsule with no cylindrical
   * section is a circle or a sphere and should be declared as one.
   */
  readonly halfHeight: number;
}

/**
 * A convex polygon in the XY plane, `"2d"` only (§24).
 *
 * **Convexity is required and validated.** §24 lists `polyline` and `chain`
 * separately for open and concave outlines (both staged, see the module
 * header), which leaves `polygon` as the closed convex primitive that solvers
 * accept directly. Passing a concave outline to a solver that assumes convexity
 * silently substitutes its convex hull — a wrong simulation that looks almost
 * right — so {@link validateCollisionShape} rejects it instead (decision,
 * WP-5.1).
 *
 * Either winding is accepted. Vertices are in the collider's local frame; the
 * polygon is implicitly closed from the last vertex back to the first.
 */
export interface PolygonShape {
  readonly type: "polygon";
  /**
   * At least three vertices, in order around the outline, with no two
   * consecutive vertices equal and no reflex corner.
   */
  readonly vertices: readonly Vector2[];
}

/**
 * An open strip of segments in the XY plane, `"2d"` only (§24).
 *
 * `N` vertices make `N − 1` segments; the outline is **not** closed. This is
 * §24's shape for a concave or open outline — a terrain silhouette, a wall
 * run, a track — where {@link PolygonShape} would have to be convex.
 *
 * A polyline is **composite**: it has no interior, so it cannot be a dynamic
 * body's only shape in any solver that derives mass from geometry, and it is
 * refused as a §30 query shape (see the module header). It is what static
 * level geometry is made of.
 */
export interface PolylineShape {
  readonly type: "polyline";
  /**
   * At least two vertices, in order along the strip, with no two consecutive
   * vertices equal. Vertices are in the collider's local frame.
   */
  readonly vertices: readonly Vector2[];
}

/**
 * A **closed** loop of segments in the XY plane, `"2d"` only (§24).
 *
 * The chain of §24's 2D list: `N` vertices make `N` segments, the last one
 * running from the final vertex back to the first. Everything
 * {@link PolylineShape} says about compositeness applies here too — a chain is
 * a boundary, not a filled region, which is what distinguishes it from
 * {@link PolygonShape} (convex, filled) and makes a concave closed outline
 * expressible at all.
 */
export interface ChainShape {
  readonly type: "chain";
  /**
   * At least three vertices, in order around the loop, with no two consecutive
   * vertices equal — including the closing pair (last, first). Vertices are in
   * the collider's local frame.
   */
  readonly vertices: readonly Vector2[];
}

/** A ball, `"3d"` only (§24). */
export interface SphereShape {
  readonly type: "sphere";
  /** Distance from the centre to the surface. Must be > 0. */
  readonly radius: number;
}

/** An axis-aligned box, `"3d"` only (§24). */
export interface BoxShape {
  readonly type: "box";
  /**
   * Half the size along each local axis, measured from the centre. All three
   * components must be > 0.
   */
  readonly halfExtents: Vector3;
}

/**
 * A right circular cylinder with its axis along **+Y**, `"3d"` only (§24).
 *
 * The 3D shape a capsule is often mistaken for: flat end caps rather than
 * hemispherical ones, so it rests on a plane on its full circular face.
 */
export interface CylinderShape {
  readonly type: "cylinder";
  /** Radius of the circular cross-section. Must be > 0. */
  readonly radius: number;
  /**
   * Half the total height along local Y. The cylinder spans
   * `[-halfHeight, +halfHeight]`. Must be > 0.
   */
  readonly halfHeight: number;
}

/**
 * A right circular cone with its axis along **+Y** and its **apex at
 * `+halfHeight`**, `"3d"` only (§24).
 *
 * The base disc sits at `-halfHeight` (see the module header for the measured
 * profile). A cone is convex, so it is a legal §30 query shape.
 */
export interface ConeShape {
  readonly type: "cone";
  /** Radius of the base disc, at `-halfHeight`. Must be > 0. */
  readonly radius: number;
  /**
   * Half the total height along local Y. The cone spans
   * `[-halfHeight, +halfHeight]`. Must be > 0.
   */
  readonly halfHeight: number;
}

/**
 * The convex hull of a point cloud, `"3d"` only (§24).
 *
 * The 3D counterpart of {@link PolygonShape} — and, unlike it, **not** checked
 * for degeneracy here. A 2D outline's degeneracy is a sign test this package
 * can do exactly; a 3D cloud's is the hull computation itself, and the solver
 * is already running one. Re-implementing it above the solver would produce a
 * second, differently-rounded verdict, so a cloud that encloses no volume is
 * refused by the adapter that tried to build it, naming the shape
 * (decision, PH-22a).
 */
export interface ConvexHullShape {
  readonly type: "convex-hull";
  /**
   * At least four points, all finite, in the collider's local frame. Order is
   * irrelevant — the hull is computed. Interior points are allowed and simply
   * do not survive it.
   */
  readonly points: readonly Vector3[];
}

/**
 * A triangle mesh, `"3d"` only (§24) — arbitrary, possibly concave static
 * geometry.
 *
 * Composite (see the module header): no interior, no derived mass, refused as
 * a §30 query shape. This is what a level's collision mesh is.
 */
export interface TriangleMeshShape {
  readonly type: "triangle-mesh";
  /** At least three finite vertices, in the collider's local frame. */
  readonly vertices: readonly Vector3[];
  /**
   * Three indices into {@link TriangleMeshShape.vertices} per triangle, so the
   * length is a positive multiple of three. Every entry must be an integer in
   * `[0, vertices.length)`.
   */
  readonly indices: readonly number[];
}

/**
 * A height field, `"3d"` only (§24) — a regular grid of heights along local Y.
 *
 * ## Layout (measured, not assumed)
 *
 * `rows` and `columns` are **sample counts**, not subdivisions, because a
 * caller counts the numbers they have. `heights.length` is therefore
 * `rows * columns`, and the adapter hands the solver `rows - 1` / `columns - 1`
 * (Rapier's `heightfield(nrows, ncols, …)` takes subdivisions and wants
 * `(nrows + 1) * (ncols + 1)` heights — verified 2026-08-08 by reading
 * `nrows`/`ncols`/`heights.length` back off a built collider).
 *
 * `heights` is **column-major**: the sample at grid position
 * `(row, column)` is `heights[row + column * rows]`. Which world axis each
 * index walks was measured, again against Rapier 0.19.3, by building a 2×2
 * field with heights `[0, 1, 2, 3]` and `scale = (2, 1, 2)` and raycasting
 * down at its four corners:
 *
 * | Corner            | Height read | Grid position   |
 * | ----------------- | ----------- | --------------- |
 * | `x = −1, z = −1`  | `0`         | `(0, 0)`        |
 * | `x = −1, z = +1`  | `1`         | `(1, 0)`        |
 * | `x = +1, z = −1`  | `2`         | `(0, 1)`        |
 * | `x = +1, z = +1`  | `3`         | `(1, 1)`        |
 *
 * So **`row` walks local Z and `column` walks local X**, which is the opposite
 * of the guess a "rows are horizontal" reading produces. The field is centred
 * on the collider origin and spans `scale.x` in X and `scale.z` in Z, with
 * every height multiplied by `scale.y`.
 *
 * Composite: refused as a §30 query shape (see the module header).
 */
export interface HeightFieldShape {
  readonly type: "height-field";
  /** Number of height samples along local **Z**. An integer ≥ 2. */
  readonly rows: number;
  /** Number of height samples along local **X**. An integer ≥ 2. */
  readonly columns: number;
  /**
   * `rows * columns` finite heights in column-major order: the sample at
   * `(row, column)` is `heights[row + column * rows]`.
   */
  readonly heights: readonly number[];
  /**
   * The field's extent in local X and Z, and the multiplier applied to every
   * height along local Y. All three components must be > 0.
   */
  readonly scale: Vector3;
}

/** The shapes a `"2d"` world accepts (§24, PH-22a). */
export type CollisionShape2D =
  | CircleShape
  | RectangleShape
  | CapsuleShape
  | PolygonShape
  | PolylineShape
  | ChainShape;

/** The shapes a `"3d"` world accepts (§24, PH-22a). */
export type CollisionShape3D =
  | SphereShape
  | BoxShape
  | CapsuleShape
  | CylinderShape
  | ConeShape
  | ConvexHullShape
  | TriangleMeshShape
  | HeightFieldShape;

/**
 * Every shape this build ships, discriminated by `type` (§24, PH-22a).
 *
 * A value of this type is not necessarily legal in a given world:
 * {@link shapeSupportsDimension} and {@link validateCollisionShape} decide
 * that, because `"circle"` in a `"3d"` world is a dimension mismatch rather
 * than a malformed shape.
 */
export type CollisionShape = CollisionShape2D | CollisionShape3D;

/** The `type` tag of any shipped {@link CollisionShape}. */
export type CollisionShapeType = CollisionShape["type"];

/** The shipped `"2d"` shape tags, in §24's order. */
export const COLLISION_SHAPE_TYPES_2D = [
  "circle",
  "rectangle",
  "capsule",
  "polygon",
  "polyline",
  "chain",
] as const satisfies readonly CollisionShape2D["type"][];

/** The shipped `"3d"` shape tags, in §24's order. */
export const COLLISION_SHAPE_TYPES_3D = [
  "sphere",
  "box",
  "capsule",
  "cylinder",
  "cone",
  "convex-hull",
  "triangle-mesh",
  "height-field",
] as const satisfies readonly CollisionShape3D["type"][];

/**
 * The shipped **composite** shape tags — the ones with a boundary but no
 * interior (§24, PH-22a).
 *
 * Listed rather than derived because compositeness is a property of the shape,
 * not of a dimension: it decides both what may be a §30 query shape
 * ({@link validateQueryShape}) and what a caller should not expect to derive a
 * mass from (§23, §25 — a composite collider's density integrates to nothing).
 */
export const COMPOSITE_COLLISION_SHAPE_TYPES = [
  "polyline",
  "chain",
  "triangle-mesh",
  "height-field",
] as const satisfies readonly CollisionShapeType[];

/**
 * Whether `shape` encloses a volume (§24).
 *
 * `false` for the four {@link COMPOSITE_COLLISION_SHAPE_TYPES}. See the module
 * header for why a composite shape is refused by §30's queries.
 */
export function shapeIsConvex(shape: CollisionShape): boolean {
  const composite: readonly CollisionShapeType[] =
    COMPOSITE_COLLISION_SHAPE_TYPES;
  return !composite.includes(shape.type);
}

/**
 * Whether `shape` may be used in a world of `dimension` (§21, §24).
 *
 * A capsule answers `true` for both dimensions; every other shipped shape
 * belongs to exactly one.
 */
export function shapeSupportsDimension(
  shape: CollisionShape,
  dimension: PhysicsDimension,
): boolean {
  const tags: readonly CollisionShapeType[] =
    dimension === "2d" ? COLLISION_SHAPE_TYPES_2D : COLLISION_SHAPE_TYPES_3D;
  return tags.includes(shape.type);
}

/**
 * The largest extent of `shape` from its own origin, in world units (§41).
 *
 * One number that stands in for "how big is this", for the §41 world-scale
 * diagnostic — not a bounding radius anybody should simulate against, which is
 * why it is deliberately cheap: half-extents and radii are read directly, and a
 * vertex list is walked once for its farthest point (Chebyshev distance, so no
 * square roots on a mesh with a hundred thousand vertices).
 *
 * A shape with no vertices at all answers `0`; every such shape is rejected by
 * {@link validateCollisionShape} long before this is asked.
 */
export function shapeMaximumExtent(shape: CollisionShape): number {
  switch (shape.type) {
    case "circle":
    case "sphere":
      return shape.radius;
    case "rectangle":
      return Math.max(shape.halfExtents.x, shape.halfExtents.y);
    case "box":
      return Math.max(
        shape.halfExtents.x,
        shape.halfExtents.y,
        shape.halfExtents.z,
      );
    case "capsule":
      return shape.halfHeight + shape.radius;
    case "cylinder":
    case "cone":
      return Math.max(shape.halfHeight, shape.radius);
    case "polygon":
    case "polyline":
    case "chain":
      return farthest2(shape.vertices);
    case "convex-hull":
      return farthest3(shape.points);
    case "triangle-mesh":
      return farthest3(shape.vertices);
    case "height-field":
      return Math.max(
        shape.scale.x / 2,
        shape.scale.z / 2,
        ...shape.heights.map((height) => Math.abs(height * shape.scale.y)),
      );
  }
}

/** The Chebyshev distance from the origin to the farthest 2D vertex. */
function farthest2(vertices: readonly Vector2[]): number {
  let farthest = 0;
  for (const vertex of vertices) {
    farthest = Math.max(farthest, Math.abs(vertex.x), Math.abs(vertex.y));
  }
  return farthest;
}

/** The Chebyshev distance from the origin to the farthest 3D point. */
function farthest3(points: readonly Vector3[]): number {
  let farthest = 0;
  for (const point of points) {
    farthest = Math.max(
      farthest,
      Math.abs(point.x),
      Math.abs(point.y),
      Math.abs(point.z),
    );
  }
  return farthest;
}

/**
 * Validates one shape parameter that must be a finite positive number (§85:
 * "NaN and infinite values", "unstable scales and extreme ratios").
 */
function requirePositive(
  shapeType: CollisionShapeType,
  field: string,
  value: number,
): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new FourError(
      SHAPE_ERROR_CODE,
      `${shapeType} shape: ${field} must be a finite positive number; got ${String(value)} (§24, §85).`,
      { context: { shape: shapeType, field, value } },
    );
  }
}

/** Validates the components of a 2D half-extent vector. */
function requirePositiveExtents2(
  shapeType: CollisionShapeType,
  field: string,
  value: Vector2,
): void {
  requirePositive(shapeType, `${field}.x`, value.x);
  requirePositive(shapeType, `${field}.y`, value.y);
}

/** Validates the components of a 3D half-extent vector. */
function requirePositiveExtents3(
  shapeType: CollisionShapeType,
  field: string,
  value: Vector3,
): void {
  requirePositive(shapeType, `${field}.x`, value.x);
  requirePositive(shapeType, `${field}.y`, value.y);
  requirePositive(shapeType, `${field}.z`, value.z);
}

/**
 * Validates a {@link PolygonShape}'s outline: enough vertices, all finite, no
 * repeated consecutive vertex, no reflex corner (§24, §85).
 *
 * Convexity is decided from the sign of the 2D cross product at every corner.
 * A zero cross product is a collinear corner — a redundant vertex, harmless and
 * accepted — so only the non-zero signs have to agree. A polygon whose corners
 * are *all* collinear encloses no area and is rejected by the same test, since
 * no sign is ever seen and the outline is degenerate.
 */
function validatePolygon(shape: PolygonShape): void {
  const { vertices } = shape;
  if (vertices.length < 3) {
    throw new FourError(
      SHAPE_ERROR_CODE,
      `polygon shape: needs at least 3 vertices; got ${String(vertices.length)} (§24, §85).`,
      { context: { shape: "polygon", vertexCount: vertices.length } },
    );
  }

  for (let i = 0; i < vertices.length; i += 1) {
    const vertex = vertices[i];
    if (!Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) {
      throw new FourError(
        SHAPE_ERROR_CODE,
        `polygon shape: vertex ${String(i)} must be finite; got (${String(vertex.x)}, ${String(vertex.y)}) (§85).`,
        { context: { shape: "polygon", index: i } },
      );
    }
  }

  let sign = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const c = vertices[(i + 2) % vertices.length];

    const abx = b.x - a.x;
    const aby = b.y - a.y;
    if (abx === 0 && aby === 0) {
      throw new FourError(
        SHAPE_ERROR_CODE,
        `polygon shape: vertices ${String(i)} and ${String((i + 1) % vertices.length)} are identical, which makes a zero-length edge (§24, §85).`,
        { context: { shape: "polygon", index: i } },
      );
    }

    const cross = abx * (c.y - b.y) - aby * (c.x - b.x);
    if (cross === 0) {
      continue;
    }
    const crossSign = cross > 0 ? 1 : -1;
    if (sign === 0) {
      sign = crossSign;
    } else if (crossSign !== sign) {
      throw new FourError(
        SHAPE_ERROR_CODE,
        `polygon shape: outline is not convex — corner ${String((i + 1) % vertices.length)} turns the other way. §24 lists polyline (open) and chain (closed) for concave outlines; use one of those.`,
        { context: { shape: "polygon", index: (i + 1) % vertices.length } },
      );
    }
  }

  if (sign === 0) {
    throw new FourError(
      SHAPE_ERROR_CODE,
      "polygon shape: every vertex is collinear, so the outline encloses no area (§24, §85).",
      { context: { shape: "polygon", vertexCount: vertices.length } },
    );
  }
}

/**
 * Validates a {@link PolylineShape} or {@link ChainShape} outline (§24, §85).
 *
 * The two differ in one thing — whether the run of segments closes — so they
 * share this walk: `minimum` vertices, every vertex finite, and no zero-length
 * segment. Convexity is deliberately *not* checked; being able to express a
 * concave outline is the whole point of these two shapes.
 */
function validateSegmentRun(
  shapeType: "polyline" | "chain",
  vertices: readonly Vector2[],
  minimum: number,
  closed: boolean,
): void {
  if (vertices.length < minimum) {
    throw new FourError(
      SHAPE_ERROR_CODE,
      `${shapeType} shape: needs at least ${String(minimum)} vertices; got ${String(vertices.length)} (§24, §85).`,
      { context: { shape: shapeType, vertexCount: vertices.length } },
    );
  }

  for (let i = 0; i < vertices.length; i += 1) {
    const vertex = vertices[i];
    if (!Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) {
      throw new FourError(
        SHAPE_ERROR_CODE,
        `${shapeType} shape: vertex ${String(i)} must be finite; got (${String(vertex.x)}, ${String(vertex.y)}) (§85).`,
        { context: { shape: shapeType, index: i } },
      );
    }
  }

  const segments = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < segments; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    if (a.x === b.x && a.y === b.y) {
      throw new FourError(
        SHAPE_ERROR_CODE,
        `${shapeType} shape: vertices ${String(i)} and ${String((i + 1) % vertices.length)} are identical, which makes a zero-length segment (§24, §85).`,
        { context: { shape: shapeType, index: i } },
      );
    }
  }
}

/**
 * Validates a {@link ConvexHullShape}'s point cloud (§24, §85).
 *
 * Count and finiteness only — see {@link ConvexHullShape} for why degeneracy
 * is the adapter's verdict rather than a second one taken here.
 */
/**
 * Ceiling on the points a hull or mesh shape may carry (§96): a scene
 * document reaches these through the physics serializers, and a solver's
 * hull / BVH build is superlinear in the count. 2^20 is far above any
 * authored collider and far below what would stall a step.
 */
export const MAXIMUM_SHAPE_POINTS = 1_048_576;

function validateConvexHull(shape: ConvexHullShape): void {
  const { points } = shape;
  if (points.length < 4) {
    throw new FourError(
      SHAPE_ERROR_CODE,
      `convex-hull shape: needs at least 4 points to enclose a volume; got ${String(points.length)} (§24, §85).`,
      { context: { shape: "convex-hull", pointCount: points.length } },
    );
  }
  if (points.length > MAXIMUM_SHAPE_POINTS) {
    throw new FourError(
      "UNTRUSTED_INPUT_REJECTED",
      `convex-hull shape: point count ${String(points.length)} is over the ${String(MAXIMUM_SHAPE_POINTS)} limit (§96).`,
      { context: { shape: "convex-hull", limitName: "MAXIMUM_SHAPE_POINTS", limit: MAXIMUM_SHAPE_POINTS, observed: points.length } },
    );
  }
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isFinite(point.z)
    ) {
      throw new FourError(
        SHAPE_ERROR_CODE,
        `convex-hull shape: point ${String(i)} must be finite; got (${String(point.x)}, ${String(point.y)}, ${String(point.z)}) (§85).`,
        { context: { shape: "convex-hull", index: i } },
      );
    }
  }
}

/**
 * Validates a {@link TriangleMeshShape}: finite vertices, a whole number of
 * triangles, and every index in range (§24, §85).
 *
 * An out-of-range index is checked here rather than left to the solver because
 * it is the one malformed-mesh failure that reads memory: a solver handed
 * `indices = [0, 1, 9]` for three vertices either traps in wasm or builds a
 * triangle out of whatever followed the buffer.
 */
function validateTriangleMesh(shape: TriangleMeshShape): void {
  const { vertices, indices } = shape;
  if (vertices.length < 3) {
    throw new FourError(
      SHAPE_ERROR_CODE,
      `triangle-mesh shape: needs at least 3 vertices; got ${String(vertices.length)} (§24, §85).`,
      { context: { shape: "triangle-mesh", vertexCount: vertices.length } },
    );
  }
  if (vertices.length > MAXIMUM_SHAPE_POINTS) {
    throw new FourError(
      "UNTRUSTED_INPUT_REJECTED",
      `triangle-mesh shape: vertex count ${String(vertices.length)} is over the ${String(MAXIMUM_SHAPE_POINTS)} limit (§96).`,
      { context: { shape: "triangle-mesh", limitName: "MAXIMUM_SHAPE_POINTS", limit: MAXIMUM_SHAPE_POINTS, observed: vertices.length } },
    );
  }
  for (let i = 0; i < vertices.length; i += 1) {
    const vertex = vertices[i];
    if (
      !Number.isFinite(vertex.x) ||
      !Number.isFinite(vertex.y) ||
      !Number.isFinite(vertex.z)
    ) {
      throw new FourError(
        SHAPE_ERROR_CODE,
        `triangle-mesh shape: vertex ${String(i)} must be finite; got (${String(vertex.x)}, ${String(vertex.y)}, ${String(vertex.z)}) (§85).`,
        { context: { shape: "triangle-mesh", index: i } },
      );
    }
  }
  if (indices.length === 0 || indices.length % 3 !== 0) {
    throw new FourError(
      SHAPE_ERROR_CODE,
      `triangle-mesh shape: needs three indices per triangle, so "indices" must be a positive multiple of 3; got ${String(indices.length)} (§24, §85).`,
      { context: { shape: "triangle-mesh", indexCount: indices.length } },
    );
  }
  for (let i = 0; i < indices.length; i += 1) {
    const index = indices[i];
    if (!Number.isInteger(index) || index < 0 || index >= vertices.length) {
      throw new FourError(
        SHAPE_ERROR_CODE,
        `triangle-mesh shape: index ${String(i)} is ${String(index)}, which is not an integer in [0, ${String(vertices.length)}) (§24, §85).`,
        { context: { shape: "triangle-mesh", index: i, value: index } },
      );
    }
  }
}

/**
 * Validates a {@link HeightFieldShape}: a grid of at least 2×2 samples, the
 * matching number of finite heights, and a positive scale (§24, §85).
 */
function validateHeightField(shape: HeightFieldShape): void {
  const { rows, columns, heights, scale } = shape;
  for (const [field, value] of [
    ["rows", rows],
    ["columns", columns],
  ] as const) {
    if (!Number.isInteger(value) || value < 2) {
      throw new FourError(
        SHAPE_ERROR_CODE,
        `height-field shape: ${field} must be an integer ≥ 2 — a grid needs two samples per axis to span anything; got ${String(value)} (§24, §85).`,
        { context: { shape: "height-field", field, value } },
      );
    }
  }
  if (heights.length !== rows * columns) {
    throw new FourError(
      SHAPE_ERROR_CODE,
      `height-field shape: "heights" must hold rows × columns = ${String(rows * columns)} samples; got ${String(heights.length)} (§24, §85).`,
      {
        context: {
          shape: "height-field",
          expected: rows * columns,
          received: heights.length,
        },
      },
    );
  }
  for (let i = 0; i < heights.length; i += 1) {
    if (!Number.isFinite(heights[i])) {
      throw new FourError(
        SHAPE_ERROR_CODE,
        `height-field shape: height ${String(i)} must be finite; got ${String(heights[i])} (§85).`,
        { context: { shape: "height-field", index: i } },
      );
    }
  }
  requirePositiveExtents3("height-field", "scale", scale);
}

/**
 * Refuses a shape that §30's `overlap` and `shapeCast` cannot answer for
 * (§24, §30, §85).
 *
 * Runs {@link validateCollisionShape} first — a query shape is still a shape —
 * and then the one extra rule a query has: it must enclose a volume. See the
 * module header for the measurement behind that rule.
 */
export function validateQueryShape(
  shape: CollisionShape,
  dimension?: PhysicsDimension,
): void {
  validateCollisionShape(shape, dimension);
  if (!shapeIsConvex(shape)) {
    throw new FourError(
      SHAPE_ERROR_CODE,
      `${shape.type} shape has a boundary but no interior, so §30's overlap and shapeCast have no defined answer for it; query with a convex shape (§24, §30).`,
      { context: { shape: shape.type } },
    );
  }
}

/**
 * Validates a shape's parameters, and — when `dimension` is given — that the
 * shape belongs to that dimension (§24, §21, §85).
 *
 * Throws a `FourError` with `INVALID_APPLICATION_STATE`; returns nothing on
 * success. Call it once, when the collider is created: this walks a polygon's
 * whole outline and is not meant for a per-step path.
 *
 * `dimension` is optional so a shape can be checked on its own — in a
 * serializer, an editor, or a unit test — before any world exists.
 */
export function validateCollisionShape(
  shape: CollisionShape,
  dimension?: PhysicsDimension,
): void {
  if (dimension !== undefined && !shapeSupportsDimension(shape, dimension)) {
    throw new FourError(
      SHAPE_ERROR_CODE,
      `${shape.type} shape is not valid in a "${dimension}" world (§21, §24).`,
      { context: { shape: shape.type, dimension } },
    );
  }

  switch (shape.type) {
    case "circle":
    case "sphere":
      requirePositive(shape.type, "radius", shape.radius);
      return;
    case "rectangle":
      requirePositiveExtents2(shape.type, "halfExtents", shape.halfExtents);
      return;
    case "box":
      requirePositiveExtents3(shape.type, "halfExtents", shape.halfExtents);
      return;
    case "capsule":
    case "cylinder":
    case "cone":
      requirePositive(shape.type, "radius", shape.radius);
      requirePositive(shape.type, "halfHeight", shape.halfHeight);
      return;
    case "polygon":
      validatePolygon(shape);
      return;
    case "polyline":
      validateSegmentRun("polyline", shape.vertices, 2, false);
      return;
    case "chain":
      validateSegmentRun("chain", shape.vertices, 3, true);
      return;
    case "convex-hull":
      validateConvexHull(shape);
      return;
    case "triangle-mesh":
      validateTriangleMesh(shape);
      return;
    case "height-field":
      validateHeightField(shape);
      return;
    default: {
      /*
       * Unreachable for well-typed callers — the switch is exhaustive over
       * `CollisionShape`. It is here for JavaScript callers and for a shape
       * assembled from untyped data: an unknown tag must fail loudly rather
       * than be silently accepted as valid.
       */
      const unknownShape: never = shape;
      throw new FourError(
        SHAPE_ERROR_CODE,
        `Unknown collision shape ${JSON.stringify(unknownShape)}. This build ships ${COLLISION_SHAPE_TYPES_2D.join(", ")} (2d) and ${COLLISION_SHAPE_TYPES_3D.join(", ")} (3d); §24's "compound" is several colliders on one body, not a tag (PH-22a).`,
        { context: { shape: unknownShape } },
      );
    }
  }
}
