import { noteConstruction } from "./alloc-counter.js";
import type { DepthRange, Matrix4 } from "./matrix4.js";
import type { Vector3 } from "./vector3.js";

/**
 * The six clip planes of a view-projection matrix (§87) — the primitive a
 * frustum cull tests against.
 *
 * ```ts
 * viewProjection.copy(camera.projectionMatrix).multiply(camera.viewMatrix);
 * frustum.setFromViewProjection(viewProjection);
 * if (frustum.intersectsSphere(center, radius)) draw(item);
 * ```
 *
 * §87 lists the spatial *structures* a culler may sit on — AABB tree, quadtree,
 * octree, BVH, grid, the physics broad phase — and is silent about the test at
 * the bottom of all of them, which is this: a bounding volume against the six
 * half-spaces that bound what a camera can see. This class is that test and
 * nothing else. It builds no index, holds no scene, and caches nothing, so it
 * is equally the leaf of a future BVH walk and the whole of the linear scan
 * `@fourjs/render`'s per-view list does today.
 *
 * ## Why a sphere is the only volume it accepts
 *
 * A sphere is invariant under rotation, so a world-space bounding sphere is one
 * point transform and one scalar — where a world-space AABB has to be
 * *re-derived* from the local box every time the node turns. That makes the
 * per-item cost of culling a constant that does not depend on the item's
 * orientation, which is what lets the cull run over every item of every view
 * every frame. The price is that a sphere around a long thin box is loose, so
 * this test keeps some items a box test would have rejected. It never rejects
 * one a box test would have kept: **a false keep costs a draw, a false reject
 * costs a missing object**, and only one of those is a bug.
 *
 * `@fourjs/render`'s `computeWorldBoundingSphere` is the producer; it derives the
 * sphere from §53's cached local AABB.
 *
 * ## Storage
 *
 * Six planes in one `Float64Array(24)`, four numbers each — `(nx, ny, nz, d)`,
 * the plane `n · p + d = 0` with `n` a **unit** normal pointing *into* the
 * frustum, so `n · p + d` is a signed distance in world units and can be
 * compared against a radius directly. The order is left, right, bottom, top,
 * near, far; nothing outside this class depends on it, and the flat array is
 * what keeps a build allocation-free (§7b, plan D7).
 *
 * ## Determinism (§33)
 *
 * **`same-runtime`**, and no better: normalizing a plane needs `Math.sqrt`,
 * whose result is exactly specified by IEEE-754 but which sits in the same
 * `Math` family §33's `same-platform` tier tells simulation paths to avoid.
 * That is not a problem here and is worth stating precisely rather than
 * quietly: nothing this class computes reaches a solver, a checksum, or a
 * snapshot. A cull decision changes *which draws are submitted*, never a
 * number the simulation carries forward, so a replay recorded on one engine
 * reproduces bit-exactly on another even if the two disagree about whether one
 * marginal item was drawn.
 *
 * ## Validation (§85, §61)
 *
 * Nothing here throws — `@fourjs/math` validates nothing (the rule
 * `Matrix4.setPerspective` states), and this class is read inside a frame,
 * where §61 forbids throwing outright. Instead **every degenerate input fails
 * towards drawing**: a plane whose normal has no length (a singular or
 * non-projection matrix) is written as the everything-inside plane, and a
 * `NaN` centre or radius makes {@link Frustum.intersectsSphere} answer `true`.
 * A frustum nobody configured therefore culls nothing, which is the only safe
 * direction for a filter that removes draws.
 */
export class Frustum {
  /**
   * The six planes, packed `(nx, ny, nz, d)` each — see the class
   * documentation. The array itself is never replaced, only rewritten.
   */
  readonly planes: Float64Array = new Float64Array(24);

  /**
   * Reports to the §83 allocation audit like every other math constructor.
   *
   * Without this the counter has a blind spot exactly the shape of this class:
   * a `new Frustum()` on a per-view path allocates a `Float64Array(24)` and
   * `constructionCount()` stays flat, so the instrument that exists to catch
   * per-frame allocation would pass the one case it was pointed at. A gauge
   * that cannot move is dead, not stable. Every `Frustum` the engine owns is a
   * module-level or per-renderer singleton, so this adds construction events at
   * setup time and none inside a step.
   */
  constructor() {
    noteConstruction();
  }

  /**
   * Extracts the six planes from `viewProjection` (`projection · view`) and
   * returns `this`.
   *
   * The extraction is the standard one: a point is inside the frustum exactly
   * when its clip coordinates satisfy `-w ≤ x, y ≤ w` and the depth convention's
   * own bounds on `z`, and each of those inequalities is a row of the matrix
   * added to or subtracted from the `w` row. The planes are then normalized, so
   * the dot product against a world point is a distance rather than an
   * arbitrary multiple of one.
   *
   * @param viewProjection the camera's projection times its view matrix. It is
   * read, never written, and never retained.
   * @param depthRange the clip-space depth convention `viewProjection` was
   * built with — only the near plane differs between them. Defaults to
   * `"negative-one-to-one"`, matching `Matrix4.setPerspective` and the WebGL 2
   * backend (§120); a WebGPU backend passes `"zero-to-one"` exactly as it does
   * to the camera.
   */
  setFromViewProjection(
    viewProjection: Matrix4,
    depthRange: DepthRange = "negative-one-to-one",
  ): this {
    const e = viewProjection.elements;
    // Rows of a column-major matrix: row `i` is `e[column * 4 + i]`.
    const r0x = e[0];
    const r0y = e[4];
    const r0z = e[8];
    const r0w = e[12];
    const r1x = e[1];
    const r1y = e[5];
    const r1z = e[9];
    const r1w = e[13];
    const r2x = e[2];
    const r2y = e[6];
    const r2z = e[10];
    const r2w = e[14];
    const r3x = e[3];
    const r3y = e[7];
    const r3z = e[11];
    const r3w = e[15];

    // `x ≥ -w` and `x ≤ w`, then the same for `y`.
    this.#writePlane(0, r3x + r0x, r3y + r0y, r3z + r0z, r3w + r0w);
    this.#writePlane(4, r3x - r0x, r3y - r0y, r3z - r0z, r3w - r0w);
    this.#writePlane(8, r3x + r1x, r3y + r1y, r3z + r1z, r3w + r1w);
    this.#writePlane(12, r3x - r1x, r3y - r1y, r3z - r1z, r3w - r1w);
    // The near plane is the one the depth convention moves: `z ≥ -w` under
    // OpenGL clip space, `z ≥ 0` under WebGPU's. The far plane is `z ≤ w` in
    // both.
    if (depthRange === "zero-to-one") {
      this.#writePlane(16, r2x, r2y, r2z, r2w);
    } else {
      this.#writePlane(16, r3x + r2x, r3y + r2y, r3z + r2z, r3w + r2w);
    }
    this.#writePlane(20, r3x - r2x, r3y - r2y, r3z - r2z, r3w - r2w);
    return this;
  }

  /**
   * Whether the world-space sphere `(center, radius)` is at least partly inside
   * this frustum — i.e. whether anything bounded by it may be visible.
   *
   * Conservative in one direction only: `true` for every sphere that touches
   * the volume, and `true` for some that only touch the *intersection of the
   * six half-spaces* outside the corners. `false` means the sphere lies wholly
   * beyond one plane, which is a proof of invisibility rather than an estimate.
   *
   * A `NaN` or infinite component in either argument makes every comparison
   * below `false`, so the answer is `true` — an item whose bounds could not be
   * computed is drawn. That is not an accident of IEEE comparison; it is the
   * behaviour this method is required to have, and the tests pin it.
   */
  intersectsSphere(center: Vector3, radius: number): boolean {
    const p = this.planes;
    const x = center.x;
    const y = center.y;
    const z = center.z;
    for (let i = 0; i < 24; i += 4) {
      if (p[i] * x + p[i + 1] * y + p[i + 2] * z + p[i + 3] < -radius) {
        return false;
      }
    }
    return true;
  }

  /**
   * Normalizes `(a, b, c, d)` into plane slot `offset`.
   *
   * A normal of zero length — which a singular matrix, an all-zero matrix, or
   * anything that is not a projection produces — cannot be normalized, and
   * dividing by it would write `NaN`s that make {@link Frustum.intersectsSphere}
   * answer `false` for **every** sphere, emptying every view built from that
   * matrix. The everything-inside plane `(0, 0, 0, +Infinity)` is written
   * instead: its distance is `+Infinity` for every point, so the plane admits
   * everything and the degenerate frustum culls nothing. Same treatment for a
   * `NaN` length, which is where a matrix carrying `NaN`s lands.
   */
  #writePlane(
    offset: number,
    a: number,
    b: number,
    c: number,
    d: number,
  ): void {
    const p = this.planes;
    const length = Math.sqrt(a * a + b * b + c * c);
    if (!(length > 0) || !Number.isFinite(length)) {
      p[offset] = 0;
      p[offset + 1] = 0;
      p[offset + 2] = 0;
      p[offset + 3] = Infinity;
      return;
    }
    const inverse = 1 / length;
    p[offset] = a * inverse;
    p[offset + 1] = b * inverse;
    p[offset + 2] = c * inverse;
    p[offset + 3] = d * inverse;
  }
}
