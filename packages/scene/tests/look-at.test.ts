import { FourError } from "@fourjs/core";
import {
  constructionCount,
  Matrix4,
  Quaternion,
  resetConstructionCount,
  Vector3,
} from "@fourjs/math";
import { describe, expect, it, vi } from "vitest";

import {
  DirectionalLight,
  Group,
  PerspectiveCamera,
  Scene,
  SpotLight,
  resolveWorldTransforms,
} from "../src/index.js";

const AXIS_Y = new Vector3(0, 1, 0);
const ORIGIN = new Vector3(0, 0, 0);

function expectVectorCloseTo(
  actual: Vector3,
  x: number,
  y: number,
  z: number,
  digits = 12,
): void {
  expect(actual.x).toBeCloseTo(x, digits);
  expect(actual.y).toBeCloseTo(y, digits);
  expect(actual.z).toBeCloseTo(z, digits);
}

describe("Node.getWorldDirection (§44/§47, R-36)", () => {
  it("faces −Z by default and writes into the supplied out", () => {
    const node = new Group();
    const out = new Vector3();

    expect(node.getWorldDirection(out)).toBe(out);
    expectVectorCloseTo(out, 0, 0, -1);
  });

  it("follows the node's own rotation", () => {
    const node = new Group();
    node.rotation.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);

    expectVectorCloseTo(node.getWorldDirection(new Vector3()), 0, -1, 0);
  });

  it("accumulates ancestor rotation", () => {
    const parent = new Group();
    const child = new Group();
    parent.add(child);
    parent.rotation.setFromAxisAngle(AXIS_Y, Math.PI / 2);

    expectVectorCloseTo(child.getWorldDirection(new Vector3()), -1, 0, 0);
  });

  it("normalizes away ancestor scale", () => {
    const parent = new Group();
    const child = new Group();
    parent.add(child);
    parent.scale.set(4, 4, 4);

    expectVectorCloseTo(child.getWorldDirection(new Vector3()), 0, 0, -1);
  });

  it("yields the zero vector rather than NaN under a zero scale", () => {
    const node = new Group();
    node.scale.set(0, 0, 0);

    expectVectorCloseTo(node.getWorldDirection(new Vector3()), 0, 0, 0);
  });

  it("serves lights, which read the same −Z axis (§68)", () => {
    const sun = new DirectionalLight();
    sun.rotation.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
    const spot = new SpotLight();
    spot.rotation.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);

    expectVectorCloseTo(sun.getWorldDirection(new Vector3()), 0, -1, 0);
    expectVectorCloseTo(spot.getWorldDirection(new Vector3()), 0, -1, 0);
  });
});

describe("Node.lookAt (§44/§47, R-36)", () => {
  it("aims the node's −Z at a world-space target and returns this", () => {
    const node = new Group();
    node.position.set(0, 0, 5);

    expect(node.lookAt(ORIGIN)).toBe(node);
    expectVectorCloseTo(node.getWorldDirection(new Vector3()), 0, 0, -1);
  });

  it("aims along each world axis", () => {
    const cases: readonly (readonly [number, number, number])[] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
      [2, -3, 6],
    ];
    const node = new Group();
    const out = new Vector3();
    for (const [x, y, z] of cases) {
      node.position.set(0, 0, 0);
      node.lookAt(new Vector3(x, y, z));
      const unit = new Vector3(x, y, z).normalize();
      expectVectorCloseTo(node.getWorldDirection(out), unit.x, unit.y, unit.z);
    }
  });

  it("uses world +Y as the default up (§7a)", () => {
    const explicit = new Group();
    explicit.position.set(3, 1, -2);
    explicit.lookAt(ORIGIN, AXIS_Y);

    const implicit = new Group();
    implicit.position.set(3, 1, -2);
    implicit.lookAt(ORIGIN);

    expect(implicit.rotation.x).toBeCloseTo(explicit.rotation.x, 15);
    expect(implicit.rotation.y).toBeCloseTo(explicit.rotation.y, 15);
    expect(implicit.rotation.z).toBeCloseTo(explicit.rotation.z, 15);
    expect(implicit.rotation.w).toBeCloseTo(explicit.rotation.w, 15);
  });

  it("honours a custom up, which is what a top-down aim needs", () => {
    const node = new Group();
    node.position.set(0, 10, 0);
    node.lookAt(ORIGIN, new Vector3(0, 0, -1));

    expectVectorCloseTo(node.getWorldDirection(new Vector3()), 0, -1, 0);
    // Local +Y ends up along world −Z, the up that was asked for.
    const localUp = node.rotation.rotateVector3(AXIS_Y, new Vector3());
    expectVectorCloseTo(localUp, 0, 0, -1);
  });

  it("writes only the rotation, leaving position, scale and pivot alone", () => {
    const node = new Group();
    node.position.set(1, 2, 3);
    node.scale.set(2, 3, 4);
    node.transform.pivot.set(0.5, 0, 0);

    node.lookAt(new Vector3(1, 2, -3));

    expect([node.position.x, node.position.y, node.position.z]).toEqual([
      1, 2, 3,
    ]);
    expect([node.scale.x, node.scale.y, node.scale.z]).toEqual([2, 3, 4]);
    expect([
      node.transform.pivot.x,
      node.transform.pivot.y,
      node.transform.pivot.z,
    ]).toEqual([0.5, 0, 0]);
  });

  it("bumps the transform version exactly once (plan D3)", () => {
    const node = new Group();
    node.position.set(0, 0, 4);
    const before = node.transform.version;

    node.lookAt(ORIGIN);

    expect(node.transform.version).toBe(before + 1);
  });

  it("allocates nothing per call (§7b)", () => {
    const node = new Group();
    node.position.set(2, 3, 4);
    const target = new Vector3(0, 0, 0);
    node.lookAt(target);

    resetConstructionCount();
    node.lookAt(target);
    expect(constructionCount()).toBe(0);
  });

  it("aims correctly through a rotated, translated parent", () => {
    const parent = new Group();
    parent.position.set(10, -4, 7);
    parent.rotation.setFromAxisAngle(AXIS_Y, 0.9);
    const child = new Group();
    child.position.set(1, 2, -3);
    parent.add(child);

    const target = new Vector3(-6, 5, 2);
    child.lookAt(target);

    // The child's world −Z must point from its world position at the target.
    const world = new Matrix4();
    resolveWorldTransforms(parent);
    world.copy(child.transform.worldMatrix);
    const aim = new Vector3(
      target.x - world.elements[12],
      target.y - world.elements[13],
      target.z - world.elements[14],
    ).normalize();
    expectVectorCloseTo(
      child.getWorldDirection(new Vector3()),
      aim.x,
      aim.y,
      aim.z,
    );
  });

  it("aims correctly through a uniformly scaled parent chain", () => {
    const root = new Group();
    root.scale.set(3, 3, 3);
    root.rotation.setFromAxisAngle(new Vector3(1, 1, 0), 0.6);
    const mid = new Group();
    mid.position.set(2, 0, 1);
    const leaf = new Group();
    leaf.position.set(0, 1, 0);
    root.add(mid);
    mid.add(leaf);

    const target = new Vector3(4, 4, 4);
    leaf.lookAt(target);

    const world = leaf.transform.worldMatrix;
    resolveWorldTransforms(root);
    const aim = new Vector3(
      target.x - world.elements[12],
      target.y - world.elements[13],
      target.z - world.elements[14],
    ).normalize();
    expectVectorCloseTo(
      leaf.getWorldDirection(new Vector3()),
      aim.x,
      aim.y,
      aim.z,
    );
  });

  it("falls back to the world aim under a zero-scaled parent", () => {
    const parent = new Group();
    parent.scale.set(0, 0, 0);
    const child = new Group();
    parent.add(child);

    child.lookAt(new Vector3(0, 0, -1));

    // The parent decomposes to the identity rotation, so the local rotation is
    // the world one — here, the identity.
    expect(child.rotation.x).toBeCloseTo(0, 15);
    expect(child.rotation.y).toBeCloseTo(0, 15);
    expect(child.rotation.z).toBeCloseTo(0, 15);
    expect(child.rotation.w).toBeCloseTo(1, 15);
  });

  it("means the same thing under any parent, because the target is world-space", () => {
    const scene = new Scene();
    const loose = new PerspectiveCamera();
    loose.position.set(0, 0, 6);
    scene.add(loose);

    // A rig turned a quarter turn about +Y maps local (-6, 0, 0) to world
    // (0, 0, 6) — the same world position the loose camera has.
    const rig = new Group();
    rig.rotation.setFromAxisAngle(AXIS_Y, Math.PI / 2);
    const rigged = new PerspectiveCamera();
    rigged.position.set(-6, 0, 0);
    scene.add(rig);
    rig.add(rigged);

    const target = new Vector3(1, 1, 1);
    loose.lookAt(target);
    rigged.lookAt(target);

    const looseDirection = loose.getWorldDirection(new Vector3());
    const riggedDirection = rigged.getWorldDirection(new Vector3());
    expectVectorCloseTo(
      riggedDirection,
      looseDirection.x,
      looseDirection.y,
      looseDirection.z,
    );
    // …and the two local rotations genuinely differ: the rig's quarter turn
    // was divided out rather than ignored.
    expect(rigged.rotation.y).not.toBeCloseTo(loose.rotation.y, 6);
  });

  it("warns once in DEV when the owner is not manual, and still writes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      for (const authority of ["physics", "kinematic", "animation"] as const) {
        const node = new Group();
        node.transformAuthority = authority;
        node.position.set(0, 0, 3);
        node.lookAt(ORIGIN);
        expect(node.position.z).toBe(3);
      }
      expect(warn).toHaveBeenCalledTimes(3);
    } finally {
      warn.mockRestore();
    }
  });

  it("refuses a target on the node's own world position (§85)", () => {
    const node = new Group();
    node.position.set(1, 2, 3);

    expect(() => {
      node.lookAt(new Vector3(1, 2, 3));
    }).toThrow(FourError);
    try {
      node.lookAt(new Vector3(1, 2, 3));
    } catch (error) {
      expect((error as FourError).code).toBe("INVALID_SCENE_GRAPH");
      expect((error as FourError).context?.node).toBe(node.id);
    }
  });

  it("refuses a non-finite target (§85)", () => {
    const node = new Group();
    expect(() => {
      node.lookAt(new Vector3(Number.NaN, 0, 0));
    }).toThrow(FourError);
  });

  it("refuses an up that leaves the roll undetermined (§85)", () => {
    const node = new Group();
    node.position.set(0, 10, 0);

    for (const bad of [
      new Vector3(0, 0, 0),
      AXIS_Y,
      new Vector3(0, -1, 0),
      new Vector3(Number.NaN, 1, 0),
    ]) {
      expect(() => {
        node.lookAt(ORIGIN, bad);
      }).toThrow(FourError);
    }
  });

  it("writes nothing when it refuses", () => {
    const node = new Group();
    node.position.set(0, 4, 0);
    node.rotation.setFromAxisAngle(new Vector3(1, 0, 0), 0.25);
    const before = node.rotation.clone();
    const version = node.transform.version;

    expect(() => {
      node.lookAt(ORIGIN);
    }).toThrow(FourError);

    expect([node.rotation.x, node.rotation.y, node.rotation.z]).toEqual([
      before.x,
      before.y,
      before.z,
    ]);
    expect(node.transform.version).toBe(version);
  });
});

describe("Node.lookAt and Camera.viewMatrix (§47)", () => {
  /** The classic gluLookAt view matrix, built independently of the engine. */
  function referenceView(
    eye: Vector3,
    target: Vector3,
    up: Vector3,
  ): Float64Array {
    const z = eye.clone().sub(target).normalize();
    const x = up.clone().cross(z).normalize();
    const y = z.clone().cross(x);
    const e = new Float64Array(16);
    e[0] = x.x;
    e[1] = y.x;
    e[2] = z.x;
    e[3] = 0;
    e[4] = x.y;
    e[5] = y.y;
    e[6] = z.y;
    e[7] = 0;
    e[8] = x.z;
    e[9] = y.z;
    e[10] = z.z;
    e[11] = 0;
    e[12] = -x.dot(eye);
    e[13] = -y.dot(eye);
    e[14] = -z.dot(eye);
    e[15] = 1;
    return e;
  }

  it("produces exactly the view matrix updateViewMatrix inverts to", () => {
    const eye = new Vector3(3, 4, 5);
    const target = new Vector3(-1, 0.5, 2);
    const camera = new PerspectiveCamera();
    camera.position.copy(eye);
    camera.lookAt(target);
    camera.updateViewMatrix();

    const reference = referenceView(eye, target, AXIS_Y);
    for (let i = 0; i < 16; i += 1) {
      expect(camera.viewMatrix.elements[i]).toBeCloseTo(reference[i], 12);
    }
  });

  it("puts the target on the camera's −Z axis in camera space", () => {
    const camera = new PerspectiveCamera();
    camera.position.set(-2, 6, 1);
    const target = new Vector3(4, -1, 3);
    camera.lookAt(target);
    camera.updateViewMatrix();

    // view · target — the target expressed in camera space.
    const e = camera.viewMatrix.elements;
    const cx = e[0] * target.x + e[4] * target.y + e[8] * target.z + e[12];
    const cy = e[1] * target.x + e[5] * target.y + e[9] * target.z + e[13];
    const cz = e[2] * target.x + e[6] * target.y + e[10] * target.z + e[14];
    expect(cx).toBeCloseTo(0, 12);
    expect(cy).toBeCloseTo(0, 12);
    expect(cz).toBeLessThan(0);
    expect(cz).toBeCloseTo(-camera.position.clone().sub(target).length(), 12);
  });

  it("aims a rig-parented camera without the rig's rotation leaking in", () => {
    const rig = new Group();
    rig.rotation.setFromAxisAngle(AXIS_Y, 1.2);
    rig.position.set(4, 0, -2);
    const camera = new PerspectiveCamera();
    camera.position.set(0, 2, 6);
    rig.add(camera);

    const target = new Vector3(0, 0, 0);
    camera.lookAt(target);
    camera.updateViewMatrix();

    const e = camera.viewMatrix.elements;
    const cx = e[0] * target.x + e[4] * target.y + e[8] * target.z + e[12];
    const cy = e[1] * target.x + e[5] * target.y + e[9] * target.z + e[13];
    expect(cx).toBeCloseTo(0, 12);
    expect(cy).toBeCloseTo(0, 12);
  });

  it("aims a directional light the same way it aims a camera (§68)", () => {
    const sun = new DirectionalLight();
    sun.position.set(5, 10, 5);
    sun.lookAt(ORIGIN);

    const direction = sun.getWorldDirection(new Vector3());
    const expected = new Vector3(-5, -10, -5).normalize();
    expectVectorCloseTo(direction, expected.x, expected.y, expected.z);
  });
});

describe("Node.lookAt determinism (§33 same-runtime)", () => {
  it("is a pure function of its inputs — repeated calls are bit-identical", () => {
    const first = new Group();
    first.position.set(1.25, -3.5, 7.75);
    first.lookAt(new Vector3(-2.5, 0.75, 4));

    const second = new Group();
    second.position.set(1.25, -3.5, 7.75);
    second.lookAt(new Vector3(-2.5, 0.75, 4));

    expect(second.rotation.x).toBe(first.rotation.x);
    expect(second.rotation.y).toBe(first.rotation.y);
    expect(second.rotation.z).toBe(first.rotation.z);
    expect(second.rotation.w).toBe(first.rotation.w);
  });

  it("re-aiming an already-aimed node is idempotent to the bit", () => {
    const node = new Group();
    node.position.set(0, 2, 9);
    const target = new Vector3(3, -1, 0);
    node.lookAt(target);
    const once = new Quaternion().copy(node.rotation);
    node.lookAt(target);

    expect(node.rotation.x).toBe(once.x);
    expect(node.rotation.y).toBe(once.y);
    expect(node.rotation.z).toBe(once.z);
    expect(node.rotation.w).toBe(once.w);
  });
});
