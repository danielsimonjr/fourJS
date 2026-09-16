import {
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@fourjs/math";
import {
  Camera,
  Group,
  OrthographicCamera,
  PerspectiveCamera,
  resolveWorldTransform,
} from "@fourjs/scene";
import { describe, expect, it } from "vitest";

import {
  createPickRay,
  pick,
  type PickHit,
  type Pickable,
} from "../src/pick.js";

const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);

function expectVector(
  actual: Vector3,
  x: number,
  y: number,
  z: number,
  precision = 12,
): void {
  expect(actual.x).toBeCloseTo(x, precision);
  expect(actual.y).toBeCloseTo(y, precision);
  expect(actual.z).toBeCloseTo(z, precision);
}

/**
 * Orthographic camera showing world `[-2, 2]²` at the origin, looking down −Z.
 * Its rays are therefore `origin = (2·ndcX, 2·ndcY, -1)` and `direction =
 * (0, 0, -1)` — every expectation below is derived from that by hand.
 */
function orthoCamera(): OrthographicCamera {
  return new OrthographicCamera({
    left: -2,
    right: 2,
    bottom: -2,
    top: 2,
    near: 1,
    far: 21,
  });
}

/** A camera whose projection cannot unproject anything. */
class ZeroProjectionCamera extends Camera {
  constructor() {
    super();
    this.updateProjectionMatrix();
  }

  override updateProjectionMatrix(): void {
    const zeros = new Array<number>(16).fill(0);
    this.projectionMatrix.fromArray(zeros);
    this.inverseProjectionMatrix.fromArray(zeros);
  }
}

/** A node at `(x, y, z)` carrying a local box of the given half extents. */
function boxAt(
  x: number,
  y: number,
  z: number,
  halfX = 0.5,
  halfY = 0.5,
  halfZ = 0.5,
): Pickable {
  const node = new Group();
  node.transform.position.set(x, y, z);
  return {
    node,
    boundsMin: new Vector3(-halfX, -halfY, -halfZ),
    boundsMax: new Vector3(halfX, halfY, halfZ),
  };
}

/**
 * The world-space AABB a naive picking implementation would build: the extent
 * of the eight transformed corners of a candidate's local box. Test-only — the
 * whole point of `pick` is that it never computes this.
 */
function worldAabb(pickable: Pickable): { min: Vector3; max: Vector3 } {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const e = resolveWorldTransform(pickable.node).elements;

  for (let corner = 0; corner < 8; corner += 1) {
    const x = (corner & 1) === 0 ? pickable.boundsMin.x : pickable.boundsMax.x;
    const y = (corner & 2) === 0 ? pickable.boundsMin.y : pickable.boundsMax.y;
    const z = (corner & 4) === 0 ? pickable.boundsMin.z : pickable.boundsMax.z;
    const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
    const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
    const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
    min.set(Math.min(min.x, wx), Math.min(min.y, wy), Math.min(min.z, wz));
    max.set(Math.max(max.x, wx), Math.max(max.y, wy), Math.max(max.z, wz));
  }
  return { min, max };
}

describe("createPickRay (§71)", () => {
  it("shoots an orthographic ray from the near plane through the NDC centre", () => {
    const camera = orthoCamera();
    const origin = new Vector3();
    const direction = new Vector3();

    createPickRay(camera, 0, 0, origin, direction);

    expectVector(origin, 0, 0, -1);
    expectVector(direction, 0, 0, -1);
  });

  it("offsets an orthographic ray across the view volume, +Y up", () => {
    const camera = orthoCamera();
    const origin = new Vector3();
    const direction = new Vector3();

    createPickRay(camera, 0.5, -0.25, origin, direction);

    // NDC +Y is up (§7a): -0.25 lands a quarter of the way below centre.
    expectVector(origin, 1, -0.5, -1);
    expectVector(direction, 0, 0, -1);
  });

  it("fans perspective rays out from the eye, exactly as the frustum implies", () => {
    // 90° vertical FOV, square aspect, near = 1: the near plane is the square
    // [-1, 1]² at z = -1, so the corner rays are (±1, ±1, -1) normalized.
    const camera = new PerspectiveCamera({
      fieldOfView: Math.PI / 2,
      aspect: 1,
      near: 1,
      far: 100,
    });
    const origin = new Vector3();
    const direction = new Vector3();
    const unit = 1 / Math.sqrt(3);

    createPickRay(camera, 1, 1, origin, direction);
    expectVector(origin, 1, 1, -1);
    expectVector(direction, unit, unit, -unit);
    expect(direction.length()).toBeCloseTo(1, 12);

    createPickRay(camera, -1, -1, origin, direction);
    expectVector(origin, -1, -1, -1);
    expectVector(direction, -unit, -unit, -unit);

    createPickRay(camera, 0, 0, origin, direction);
    expectVector(origin, 0, 0, -1);
    expectVector(direction, 0, 0, -1);
  });

  it("widens perspective rays with the aspect ratio", () => {
    // aspect 2 doubles the horizontal half-extent at the near plane.
    const camera = new PerspectiveCamera({
      fieldOfView: Math.PI / 2,
      aspect: 2,
      near: 1,
      far: 100,
    });
    const origin = new Vector3();
    const direction = new Vector3();

    createPickRay(camera, 1, 0, origin, direction);

    expectVector(origin, 2, 0, -1);
    const length = Math.sqrt(5);
    expectVector(direction, 2 / length, 0, -1 / length);
  });

  it("resolves the camera's world transform on demand, through its parents", () => {
    const rig = new Group();
    rig.transform.position.set(5, 3, 0);
    const camera = orthoCamera();
    rig.add(camera);

    const origin = new Vector3();
    const direction = new Vector3();

    // No resolveWorldTransforms pass anywhere: picking must not need one.
    createPickRay(camera, 0, 0, origin, direction);

    expectVector(origin, 5, 3, -1);
    expectVector(direction, 0, 0, -1);
  });

  it("rotates with the camera", () => {
    const camera = orthoCamera();
    camera.transform.rotation.setFromAxisAngle(AXIS_Y, Math.PI / 2);

    const origin = new Vector3();
    const direction = new Vector3();

    createPickRay(camera, 0, 0, origin, direction);

    // A quarter turn about +Y takes the camera's −Z onto −X.
    expectVector(origin, -1, 0, 0);
    expectVector(direction, -1, 0, 0);
  });

  it("puts the origin on the near plane for a zero-to-one projection", () => {
    const camera = orthoCamera();
    camera.updateProjectionMatrix("zero-to-one");

    const origin = new Vector3();
    const direction = new Vector3();
    createPickRay(camera, 0, 0, origin, direction, "zero-to-one");
    expectVector(origin, 0, 0, -1);
    expectVector(direction, 0, 0, -1);

    // Assuming the wrong convention keeps the same ray *line* — same direction,
    // origin displaced along it — so hits are unaffected and only distances
    // shift by a constant.
    const wrongOrigin = new Vector3();
    const wrongDirection = new Vector3();
    createPickRay(camera, 0, 0, wrongOrigin, wrongDirection);
    expectVector(wrongDirection, 0, 0, -1);
    // z_ndc = -1 under a zero-to-one orthographic projection unprojects to
    // z_view = (far - near) - near = 19, i.e. behind the camera — still on the
    // same line, hence the same direction.
    expect(wrongOrigin.z).toBeCloseTo(19, 12);
  });

  it("yields a zero-length direction rather than NaN for a degenerate projection", () => {
    const camera = new ZeroProjectionCamera();
    const origin = new Vector3();
    const direction = new Vector3();

    createPickRay(camera, 0.5, 0.5, origin, direction);

    expectVector(origin, 0, 0, 0);
    expectVector(direction, 0, 0, 0);
  });
});

describe("pick — bounds tier (§71)", () => {
  it("hits a unit box on the axis of an orthographic camera", () => {
    const camera = orthoCamera();
    const box = boxAt(0, 0, -5);
    const hits: PickHit[] = [];

    pick(camera, 0, 0, [box], hits);

    expect(hits).toHaveLength(1);
    expect(hits[0].node).toBe(box.node);
    // The ray starts at z = -1; the box's front face sits at z = -4.5.
    expect(hits[0].distance).toBeCloseTo(3.5, 12);
    expectVector(hits[0].point, 0, 0, -4.5);
  });

  it("returns hits nearest first, whatever order the candidates arrive in", () => {
    const camera = orthoCamera();
    const far = boxAt(0, 0, -5);
    const near = boxAt(0, 0, -3);
    const hits: PickHit[] = [];

    pick(camera, 0, 0, [far, near], hits);

    expect(hits).toHaveLength(2);
    expect(hits[0].node).toBe(near.node);
    expect(hits[0].distance).toBeCloseTo(1.5, 12);
    expect(hits[1].node).toBe(far.node);
    expect(hits[1].distance).toBeCloseTo(3.5, 12);
  });

  it("tests the true oriented box, not its inflated world AABB", () => {
    // A thin bar, 4 × 0.2 × 1 in local space, rotated 45° about +Z at z = -5.
    // Its world AABB is a ~2.97-wide square; the bar fills a fraction of it,
    // and the difference is exactly what a world-space AABB test gets wrong.
    const bar = boxAt(0, 0, -5, 2, 0.1, 0.5);
    bar.node.transform.rotation.setFromAxisAngle(AXIS_Z, Math.PI / 4);

    const camera = orthoCamera();
    const hits: PickHit[] = [];

    // (a) Straight up from the bar's centre: inside the world AABB, well
    // outside the bar itself (local y = 0.707, half-thickness 0.1). A miss.
    const missX = 0;
    const missY = 1;
    pick(camera, missX / 2, missY / 2, [bar], hits);
    expect(hits).toHaveLength(0);

    // ...and the world AABB really would have reported a hit: build it from the
    // eight transformed corners, exactly as the naive strategy would.
    const aabb = worldAabb(bar);
    expect(missX).toBeGreaterThan(aabb.min.x);
    expect(missX).toBeLessThan(aabb.max.x);
    expect(missY).toBeGreaterThan(aabb.min.y);
    expect(missY).toBeLessThan(aabb.max.y);

    // (b) Along the bar's own long axis, 1.5 units out: local (1.5, 0, 0),
    // inside the bar. A hit, at the same depth as an unrotated box.
    const hitX = 1.5 * Math.SQRT1_2;
    const hitY = 1.5 * Math.SQRT1_2;
    pick(camera, hitX / 2, hitY / 2, [bar], hits);
    expect(hits).toHaveLength(1);
    expect(hits[0].distance).toBeCloseTo(3.5, 12);
    expectVector(hits[0].point, hitX, hitY, -4.5);
  });

  it("reports a world distance for a scaled node", () => {
    // Local half extent 0.5, scale 2 ⇒ the front face is at z = -4, one unit
    // nearer than the unscaled case. Solving against a renormalized local
    // direction would have reported 1.75.
    const box = boxAt(0, 0, -5);
    box.node.transform.scale.set(2, 2, 2);

    const hits: PickHit[] = [];
    pick(orthoCamera(), 0, 0, [box], hits);

    expect(hits).toHaveLength(1);
    expect(hits[0].distance).toBeCloseTo(3, 12);
    expectVector(hits[0].point, 0, 0, -4);
  });

  it("hits along a diagonal perspective ray, every direction component negative", () => {
    // The corner ray of a 90° square frustum: origin (-1, -1, -1), direction
    // -(1, 1, 1)/√3, so every slab's near/far pair arrives reversed. The target
    // is a slab-shaped box whose +x face at x = -3.5 is the entry, reached at
    // t = 2.5·√3.
    const camera = new PerspectiveCamera({
      fieldOfView: Math.PI / 2,
      aspect: 1,
      near: 1,
      far: 100,
    });
    const box = boxAt(-4, -4, -4, 0.5, 2, 2);
    const hits: PickHit[] = [];

    pick(camera, -1, -1, [box], hits);

    expect(hits).toHaveLength(1);
    expect(hits[0].distance).toBeCloseTo(2.5 * Math.sqrt(3), 12);
    expectVector(hits[0].point, -3.5, -3.5, -3.5);

    // The same box turned on its side: now the y slab, not the x slab, decides
    // where the ray enters — the same answer by a different path through the
    // test.
    const onItsSide = boxAt(-4, -4, -4, 2, 0.5, 2);
    pick(camera, -1, -1, [onItsSide], hits);

    expect(hits).toHaveLength(1);
    expect(hits[0].distance).toBeCloseTo(2.5 * Math.sqrt(3), 12);
    expectVector(hits[0].point, -3.5, -3.5, -3.5);
  });

  it("follows a node through its parent's transform", () => {
    const rig = new Group();
    rig.transform.position.set(1, 0, -5);
    const box = boxAt(0, 0, 0);
    rig.add(box.node);

    const hits: PickHit[] = [];
    pick(orthoCamera(), 0.5, 0, [box], hits);

    expect(hits).toHaveLength(1);
    expect(hits[0].distance).toBeCloseTo(3.5, 12);
    expectVector(hits[0].point, 1, 0, -4.5);
  });

  it("misses when the ray passes beside the box", () => {
    const camera = orthoCamera();
    const box = boxAt(0, 0, -5);
    const hits: PickHit[] = [];

    const result = pick(camera, 0.5, 0, [box], hits);

    expect(result).toBe(hits);
    expect(hits).toHaveLength(0);
  });

  it("never hits anything behind the ray origin", () => {
    const camera = orthoCamera();
    const behind = boxAt(0, 0, 5);
    const hits: PickHit[] = [];

    pick(camera, 0, 0, [behind], hits);

    expect(hits).toHaveLength(0);
  });

  it("hits a box the ray starts inside at distance zero", () => {
    const camera = orthoCamera();
    // Spans z ∈ [-1.5, -0.5]; the ray origin is at z = -1.
    const around = boxAt(0, 0, -1);
    const hits: PickHit[] = [];

    pick(camera, 0, 0, [around], hits);

    expect(hits).toHaveLength(1);
    expect(hits[0].distance).toBe(0);
    expectVector(hits[0].point, 0, 0, -1);
  });

  it("handles an axis-parallel ray grazing a slab boundary", () => {
    // The ray's x and y direction components are exactly zero, so two of the
    // three slab tests divide by zero — and at world y = 0.5 the ray runs along
    // the box's own boundary plane, making that slab's arithmetic 0 × ∞ = NaN.
    // The degenerate slab must be ignored, not allowed to reject the hit.
    const camera = orthoCamera();
    const box = boxAt(0, 0, -5);
    const hits: PickHit[] = [];

    pick(camera, 0, 0.25, [box], hits);

    expect(hits).toHaveLength(1);
    expect(hits[0].distance).toBeCloseTo(3.5, 12);
  });

  it("skips candidates whose bounds are empty or inverted", () => {
    const camera = orthoCamera();
    const empty: Pickable = {
      node: new Group(),
      // The empty-geometry convention of BufferGeometry.computeBounds().
      boundsMin: new Vector3(Infinity, Infinity, Infinity),
      boundsMax: new Vector3(-Infinity, -Infinity, -Infinity),
    };
    empty.node.transform.position.set(0, 0, -5);
    const inverted = boxAt(0, 0, -5, -1, -1, -1);
    const hits: PickHit[] = [];

    pick(camera, 0, 0, [empty, inverted], hits);

    expect(hits).toHaveLength(0);
  });

  it("skips candidates whose world matrix is singular", () => {
    const camera = orthoCamera();
    const collapsed = boxAt(0, 0, -5);
    collapsed.node.transform.scale.set(0, 1, 1);
    const hits: PickHit[] = [];

    pick(camera, 0, 0, [collapsed], hits);

    expect(hits).toHaveLength(0);
  });

  it("returns nothing when the camera cannot produce a ray", () => {
    const hits: PickHit[] = [];

    pick(new ZeroProjectionCamera(), 0, 0, [boxAt(0, 0, -5)], hits);

    expect(hits).toHaveLength(0);
  });

  it("allocates a result array when `out` is omitted", () => {
    const box = boxAt(0, 0, -5);

    const hits = pick(orthoCamera(), 0, 0, [box]);

    expect(hits).toHaveLength(1);
    expect(hits[0].node).toBe(box.node);
  });

  it("reuses pooled hits and their points, keyed on the out array", () => {
    const camera = orthoCamera();
    const near = boxAt(0, 0, -3);
    const far = boxAt(0, 0, -5);
    const hits: PickHit[] = [];

    pick(camera, 0, 0, [near, far], hits);
    const firstHit = hits[0];
    const firstPoint = hits[0].point;
    const secondHit = hits[1];

    pick(camera, 0, 0, [near, far], hits);

    expect(hits[0]).toBe(firstHit);
    expect(hits[0].point).toBe(firstPoint);
    expect(hits[1]).toBe(secondHit);

    // A second array gets its own pool, so two live result lists never share
    // hit objects.
    const other: PickHit[] = [];
    pick(camera, 0, 0, [near, far], other);
    expect(other[0]).not.toBe(firstHit);

    // Shrinking truncates rather than leaving stale hits behind...
    pick(camera, 0, 0, [near], hits);
    expect(hits).toHaveLength(1);
    // ...and growing again hands back the same pooled objects.
    pick(camera, 0, 0, [near, far], hits);
    expect(hits[1]).toBe(secondHit);
  });

  it("allocates no math objects in the steady state (D7)", () => {
    const camera = orthoCamera();
    // Two hits and one miss, so the loop exercises both paths.
    const pickables = [boxAt(0, 0, -3), boxAt(2, 0, -5), boxAt(0, 0, -9)];
    const hits: PickHit[] = [];
    const origin = new Vector3();
    const direction = new Vector3();

    // Warm up: the first pick grows the pool and resolves every transform once.
    pick(camera, 0, 0, pickables, hits);
    createPickRay(camera, 0, 0, origin, direction);
    expect(hits).toHaveLength(2);

    let accumulator = 0;
    resetConstructionCount();
    for (let i = 0; i < 100; i += 1) {
      createPickRay(camera, 0, 0, origin, direction);
      pick(camera, 0, 0, pickables, hits);
      accumulator += hits.length + direction.z;
    }

    expect(constructionCount()).toBe(0);
    expect(accumulator).toBeCloseTo(100, 12);
  });
});
