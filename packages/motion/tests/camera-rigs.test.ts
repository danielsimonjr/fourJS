/**
 * §44's camera rigs — `OrbitRig`, `FollowRig` — and the placement primitives
 * they share (`rig-target.ts`), R-36 rig half.
 *
 * What is proved here, in order: the spherical placement and its clamps, the
 * two follow frames, the spring arm, §85's authoring refusals, and that none of
 * it allocates per step (plan D7).
 */

import {
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@fourjs/math";
import { Group } from "@fourjs/scene";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_ORBIT_MIN_DISTANCE,
  DEFAULT_ORBIT_PITCH_LIMIT,
  FollowRig,
  OrbitRig,
} from "../src/camera-rigs.js";
import {
  placeAtWorldPosition,
  resolveTargetPosition,
  worldPositionOf,
} from "../src/rig-target.js";
import { SpringDamper } from "../src/spring-damper.js";

const DT = 1 / 60;

/** The node's world-space origin — the translation column of its world matrix. */
function worldPosition(node: Group): Vector3 {
  return worldPositionOf(node, new Vector3());
}

describe("rig targets and placement (§44)", () => {
  it("reads a Vector3 target as it stands and a Node target through its world matrix", () => {
    const out = new Vector3();
    expect(resolveTargetPosition(new Vector3(1, 2, 3), out)).toBe(true);
    expect(out.equalsApprox(new Vector3(1, 2, 3), 0)).toBe(true);

    const parent = new Group();
    parent.position.set(10, 0, 0);
    const child = new Group();
    child.position.set(0, 4, 0);
    parent.add(child);
    expect(resolveTargetPosition(child, out)).toBe(true);
    expect(out.equalsApprox(new Vector3(10, 4, 0), 0)).toBe(true);
  });

  it("refuses a target whose world position is not finite", () => {
    const out = new Vector3();
    expect(resolveTargetPosition(new Vector3(Number.NaN, 0, 0), out)).toBe(
      false,
    );

    const node = new Group();
    node.position.set(Number.POSITIVE_INFINITY, 0, 0);
    expect(resolveTargetPosition(node, out)).toBe(false);
  });

  it("places a root node directly and a child through its parent's inverse", () => {
    const root = new Group();
    expect(placeAtWorldPosition(root, 1, -2, 3)).toBe(true);
    expect(root.position.equalsApprox(new Vector3(1, -2, 3), 0)).toBe(true);

    const parent = new Group();
    parent.position.set(5, 0, 0);
    parent.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    parent.scale.set(2, 2, 2);
    const child = new Group();
    parent.add(child);

    expect(placeAtWorldPosition(child, 5, 3, 4)).toBe(true);
    expect(worldPosition(child).equalsApprox(new Vector3(5, 3, 4), 1e-12)).toBe(
      true,
    );
    // The local position is genuinely in the parent's frame, not a copy of the
    // world point: a half-scale, quarter-turn frame moves it.
    expect(child.position.equalsApprox(new Vector3(5, 3, 4), 1e-6)).toBe(false);
  });

  it("lands a pivoted node's origin on the point, not its pivot", () => {
    // `Matrix4.compose` folds the pivot into the translation column, so a
    // placement written straight into `position` would be off by (I − R·S)·pivot.
    const node = new Group();
    node.transform.pivot.set(1, 2, 3);
    node.rotation.setFromAxisAngle(new Vector3(0, 0, 1), 0.7);
    node.scale.set(3, 3, 3);

    expect(placeAtWorldPosition(node, -4, 6, 2)).toBe(true);
    expect(worldPosition(node).equalsApprox(new Vector3(-4, 6, 2), 1e-12)).toBe(
      true,
    );
    expect(node.position.equalsApprox(new Vector3(-4, 6, 2), 1e-6)).toBe(false);
  });

  it("refuses a singular parent rather than writing a plausible wrong pose", () => {
    const parent = new Group();
    parent.scale.set(0, 1, 1);
    const child = new Group();
    parent.add(child);
    child.position.set(7, 7, 7);

    expect(placeAtWorldPosition(child, 1, 1, 1)).toBe(false);
    expect(child.position.equalsApprox(new Vector3(7, 7, 7), 0)).toBe(true);
  });

  it("refuses a parent carrying NaN, which survives the determinant test", () => {
    const parent = new Group();
    parent.scale.set(Number.NaN, 1, 1);
    const child = new Group();
    parent.add(child);

    expect(placeAtWorldPosition(child, 1, 1, 1)).toBe(false);
    expect(Number.isFinite(child.position.x)).toBe(true);
  });
});

describe("OrbitRig (§44 orbit)", () => {
  it("places the node on a sphere around its target", () => {
    const node = new Group();
    const rig = new OrbitRig({ target: new Vector3(0, 1, 0), distance: 4 });

    expect(rig.apply(node)).toBe(true);
    // yaw 0, pitch 0 is the target's +Z side.
    expect(worldPosition(node).equalsApprox(new Vector3(0, 1, 4), 1e-12)).toBe(
      true,
    );

    rig.yaw = Math.PI / 2;
    rig.apply(node);
    expect(worldPosition(node).equalsApprox(new Vector3(4, 1, 0), 1e-12)).toBe(
      true,
    );

    rig.yaw = 0;
    rig.pitch = Math.PI / 6;
    rig.apply(node);
    const expected = new Vector3(
      0,
      1 + 4 * Math.sin(Math.PI / 6),
      4 * Math.cos(Math.PI / 6),
    );
    expect(worldPosition(node).equalsApprox(expected, 1e-12)).toBe(true);
    // The distance from the pivot is the rig's distance, at any angle.
    expect(
      Math.hypot(
        worldPosition(node).x,
        worldPosition(node).y - 1,
        worldPosition(node).z,
      ),
    ).toBeCloseTo(4, 12);
  });

  it("tracks a moving Node target", () => {
    const subject = new Group();
    const node = new Group();
    const rig = new OrbitRig({ target: subject, distance: 2 });

    rig.apply(node);
    expect(worldPosition(node).equalsApprox(new Vector3(0, 0, 2), 1e-12)).toBe(
      true,
    );

    subject.position.set(10, 0, 0);
    rig.apply(node);
    expect(worldPosition(node).equalsApprox(new Vector3(10, 0, 2), 1e-12)).toBe(
      true,
    );
  });

  it("clamps pitch to its limits and counts the clamps", () => {
    const rig = new OrbitRig();

    rig.pitch = 10;
    expect(rig.pitch).toBe(DEFAULT_ORBIT_PITCH_LIMIT);
    expect(rig.pitchLimitHits).toBe(1);

    rig.pitch = -10;
    expect(rig.pitch).toBe(-DEFAULT_ORBIT_PITCH_LIMIT);
    expect(rig.pitchLimitHits).toBe(2);

    rig.pitch = 0.25;
    expect(rig.pitch).toBe(0.25);
    expect(rig.pitchLimitHits).toBe(2);

    // The default limit is one milliradian short of the pole, which is exactly
    // the aim `Node.lookAt` refuses with the default +Y up.
    expect(DEFAULT_ORBIT_PITCH_LIMIT).toBe(Math.PI / 2 - 1e-3);
    expect(DEFAULT_ORBIT_PITCH_LIMIT).toBeLessThan(Math.PI / 2);
  });

  it("clamps distance to its limits, and starts on them when authored outside", () => {
    const rig = new OrbitRig({ minDistance: 2, maxDistance: 6, distance: 4 });

    rig.distance = 100;
    expect(rig.distance).toBe(6);
    rig.distance = 0.5;
    expect(rig.distance).toBe(2);
    rig.distance = 3;
    expect(rig.distance).toBe(3);

    // Authored outside its own limits: clamped, and the counter is clean —
    // construction is the rig's initial state, not a live clamp.
    const clamped = new OrbitRig({ pitch: 4, distance: 1e6, maxDistance: 9 });
    expect(clamped.pitch).toBe(DEFAULT_ORBIT_PITCH_LIMIT);
    expect(clamped.distance).toBe(9);
    expect(clamped.pitchLimitHits).toBe(0);
    expect(new OrbitRig().minDistance).toBe(DEFAULT_ORBIT_MIN_DISTANCE);
    expect(new OrbitRig().maxDistance).toBe(Number.POSITIVE_INFINITY);
  });

  it("orbits and dollies by deltas, through the same clamps", () => {
    const rig = new OrbitRig({ distance: 5, minDistance: 1, maxDistance: 8 });

    rig.orbit(0.5, 0.25);
    expect(rig.yaw).toBeCloseTo(0.5, 15);
    expect(rig.pitch).toBeCloseTo(0.25, 15);

    rig.orbit(-1, 100);
    expect(rig.yaw).toBeCloseTo(-0.5, 15);
    expect(rig.pitch).toBe(DEFAULT_ORBIT_PITCH_LIMIT);
    expect(rig.pitchLimitHits).toBe(1);

    rig.dolly(2);
    expect(rig.distance).toBe(7);
    rig.dolly(-100);
    expect(rig.distance).toBe(1);
  });

  it("keeps yaw unwrapped, so orbiting never jumps at a seam", () => {
    const rig = new OrbitRig();
    for (let i = 0; i < 8; i += 1) {
      rig.orbit(1, 0);
    }
    expect(rig.yaw).toBeCloseTo(8, 12);
    expect(rig.yaw).toBeGreaterThan(2 * Math.PI);
  });

  it("is idle without a target, and counts a skip on a degenerate one", () => {
    const node = new Group();
    const rig = new OrbitRig();

    expect(rig.apply(node)).toBe(false);
    expect(rig.skippedSteps).toBe(0);

    rig.target = new Vector3(Number.NaN, 0, 0);
    expect(rig.apply(node)).toBe(false);
    expect(rig.skippedSteps).toBe(1);

    const parent = new Group();
    parent.scale.set(0, 0, 0);
    const child = new Group();
    parent.add(child);
    rig.target = new Vector3(0, 0, 0);
    expect(rig.apply(child)).toBe(false);
    expect(rig.skippedSteps).toBe(2);
  });

  it("refuses impossible parameters at authoring (§85)", () => {
    expect(() => new OrbitRig({ yaw: Number.NaN })).toThrow(RangeError);
    expect(() => new OrbitRig({ pitch: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    );
    expect(() => new OrbitRig({ distance: 0 })).toThrow(RangeError);
    expect(() => new OrbitRig({ distance: -1 })).toThrow(RangeError);
    expect(() => new OrbitRig({ minPitch: Number.NaN })).toThrow(RangeError);
    expect(() => new OrbitRig({ maxPitch: Number.NaN })).toThrow(RangeError);
    expect(() => new OrbitRig({ minDistance: 0 })).toThrow(RangeError);
    expect(() => new OrbitRig({ minPitch: 1, maxPitch: -1 })).toThrow(
      /minPitch must not exceed maxPitch/,
    );
    expect(() => new OrbitRig({ maxDistance: Number.NaN })).toThrow(
      /maxDistance/,
    );
    expect(() => new OrbitRig({ minDistance: 5, maxDistance: 1 })).toThrow(
      /maxDistance/,
    );

    const rig = new OrbitRig();
    expect(() => (rig.yaw = Number.NaN)).toThrow(RangeError);
    expect(() => (rig.pitch = Number.NaN)).toThrow(RangeError);
    expect(() => (rig.distance = Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("allocates nothing per step (D7)", () => {
    const node = new Group();
    const parent = new Group();
    parent.scale.set(2, 2, 2);
    parent.add(node);
    const subject = new Group();
    const rig = new OrbitRig({ target: subject, distance: 3 });

    rig.apply(node);
    resetConstructionCount();
    for (let i = 0; i < 200; i += 1) {
      rig.orbit(0.01, 0.001);
      rig.dolly(0.001);
      rig.apply(node);
    }
    expect(constructionCount()).toBe(0);
  });
});

describe("FollowRig (§44 follow rig and spring arm)", () => {
  it("holds a world-axis offset, ignoring the target's own turning", () => {
    const subject = new Group();
    const node = new Group();
    const rig = new FollowRig({
      target: subject,
      offset: new Vector3(0, 2, 5),
    });

    expect(rig.apply(node, DT)).toBe(true);
    expect(worldPosition(node).equalsApprox(new Vector3(0, 2, 5), 1e-12)).toBe(
      true,
    );

    subject.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    subject.position.set(1, 0, 0);
    rig.apply(node, DT);
    expect(worldPosition(node).equalsApprox(new Vector3(1, 2, 5), 1e-12)).toBe(
      true,
    );
  });

  it("swings a target-frame offset around behind the target", () => {
    const subject = new Group();
    const node = new Group();
    const rig = new FollowRig({
      target: subject,
      offset: new Vector3(0, 2, 5),
      frame: "target",
    });

    rig.apply(node, DT);
    expect(worldPosition(node).equalsApprox(new Vector3(0, 2, 5), 1e-12)).toBe(
      true,
    );

    // A quarter turn about +Y takes the target's +Z to world +X.
    subject.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    rig.apply(node, DT);
    expect(worldPosition(node).equalsApprox(new Vector3(5, 2, 0), 1e-12)).toBe(
      true,
    );
  });

  it("does not stretch a target-frame arm with the target's scale", () => {
    const subject = new Group();
    subject.scale.set(4, 4, 4);
    const node = new Group();
    const rig = new FollowRig({
      target: subject,
      offset: new Vector3(0, 0, 5),
      frame: "target",
    });

    rig.apply(node, DT);
    expect(worldPosition(node).equalsApprox(new Vector3(0, 0, 5), 1e-12)).toBe(
      true,
    );
  });

  it("falls back to world axes for a Vector3 target, which has no frame", () => {
    const node = new Group();
    const rig = new FollowRig({
      target: new Vector3(1, 0, 0),
      offset: new Vector3(0, 0, 5),
      frame: "target",
    });

    expect(rig.apply(node, DT)).toBe(true);
    expect(worldPosition(node).equalsApprox(new Vector3(1, 0, 5), 1e-12)).toBe(
      true,
    );
  });

  it("skips a target-frame step whose basis has collapsed", () => {
    const subject = new Group();
    subject.scale.set(1, 0, 1);
    const node = new Group();
    const rig = new FollowRig({
      target: subject,
      offset: new Vector3(0, 0, 5),
      frame: "target",
    });

    expect(rig.apply(node, DT)).toBe(false);
    expect(rig.skippedSteps).toBe(1);
    expect(node.position.equalsApprox(new Vector3(0, 0, 0), 0)).toBe(true);
  });

  it("springs towards the goal instead of snapping, and settles on it", () => {
    const subject = new Group();
    subject.position.set(10, 0, 0);
    const node = new Group();
    const rig = new FollowRig({
      target: subject,
      spring: new SpringDamper({ frequencyHz: 2, dampingRatio: 1 }),
    });

    expect(rig.smoothing).toBe(false);
    rig.apply(node, DT);
    expect(rig.smoothing).toBe(true);
    // One step in: moving, nowhere near there.
    expect(worldPosition(node).x).toBeGreaterThan(0);
    expect(worldPosition(node).x).toBeLessThan(1);

    for (let i = 0; i < 300; i += 1) {
      rig.apply(node, DT);
    }
    expect(worldPosition(node).x).toBeCloseTo(10, 6);
    // Critically damped: it never went past the target on the way.
    expect(worldPosition(node).x).toBeLessThanOrEqual(10);
  });

  it("re-captures its state after resetSmoothing, so a teleport does not sail", () => {
    const subject = new Group();
    const node = new Group();
    const rig = new FollowRig({
      target: subject,
      spring: new SpringDamper({ stiffness: 100, damping: 20 }),
    });

    rig.apply(node, DT);
    subject.position.set(1000, 0, 0);
    node.position.set(1000, 0, 0);
    rig.resetSmoothing();
    expect(rig.smoothing).toBe(false);
    rig.apply(node, DT);
    // Captured at the node's new position: the goal is already there.
    expect(worldPosition(node).x).toBeCloseTo(1000, 9);
  });

  it("is idle without a target, and counts a skip on a degenerate one", () => {
    const node = new Group();
    const rig = new FollowRig();

    expect(rig.apply(node, DT)).toBe(false);
    expect(rig.skippedSteps).toBe(0);

    rig.target = new Vector3(0, Number.NaN, 0);
    expect(rig.apply(node, DT)).toBe(false);
    expect(rig.skippedSteps).toBe(1);
  });

  it("counts a skip on a zero-length step instead of throwing (frame-1 crash)", () => {
    const subject = new Group();
    subject.position.set(10, 0, 0);
    const node = new Group();
    const rig = new FollowRig({
      target: subject,
      spring: new SpringDamper({ stiffness: 100, damping: 20 }),
    });

    // A zero-length step is well defined -- nothing has advanced -- but the spring
    // deliberately rejects 0 (see spring-damper's `rejects deltaSeconds` cases), and
    // `apply` used to hand its delta straight over. The RangeError escaped through
    // `Application.step()` and killed the caller's requestAnimationFrame loop for
    // good: one bad frame, and the app never rendered again.
    //
    // The zero is not exotic. The README's loop is
    // `app.step(Math.max(0, now - last) / 1000)`, and rAF's frame timestamp can
    // precede the `performance.now()` captured just before the loop, so the clamp
    // yields exactly 0 on the first frame.
    expect(() => rig.apply(node, 0)).not.toThrow();
    expect(rig.apply(node, 0)).toBe(false);
    expect(rig.skippedSteps).toBeGreaterThan(0);

    // The rig is not poisoned by the skip: a real step still follows the target.
    rig.apply(node, DT);
    expect(worldPosition(node).x).toBeGreaterThan(0);
  });

  it("counts a skip when a spring step cannot be written to a singular parent", () => {
    const parent = new Group();
    parent.scale.set(0, 1, 1);
    const node = new Group();
    parent.add(node);
    const rig = new FollowRig({
      target: new Vector3(1, 2, 3),
      spring: new SpringDamper({ frequencyHz: 1, dampingRatio: 1 }),
    });

    expect(rig.apply(node, DT)).toBe(false);
    expect(rig.skippedSteps).toBe(1);
    // The smoother still captured and advanced: the goal is a property of the
    // target, not of the write.
    expect(rig.smoothing).toBe(true);
  });

  it("copies its offset and keeps its spring by reference", () => {
    const offset = new Vector3(1, 2, 3);
    const spring = new SpringDamper({ stiffness: 4, damping: 4 });
    const rig = new FollowRig({ offset, spring });

    offset.set(9, 9, 9);
    expect(rig.offset.equalsApprox(new Vector3(1, 2, 3), 0)).toBe(true);
    expect(rig.spring).toBe(spring);
    expect(rig.frame).toBe("world");
    expect(new FollowRig().spring).toBe(null);
    expect(new FollowRig().target).toBe(null);
  });

  it("allocates nothing per step (D7)", () => {
    const subject = new Group();
    const parent = new Group();
    parent.scale.set(2, 2, 2);
    const node = new Group();
    parent.add(node);
    const rig = new FollowRig({
      target: subject,
      offset: new Vector3(0, 1, 4),
      frame: "target",
      spring: new SpringDamper({ frequencyHz: 3, dampingRatio: 1 }),
    });

    rig.apply(node, DT);
    resetConstructionCount();
    for (let i = 0; i < 200; i += 1) {
      subject.position.set(i * 0.01, 0, 0);
      rig.apply(node, DT);
    }
    expect(constructionCount()).toBe(0);
  });

  it("keeps its placement under a scaled, rotated parent", () => {
    const parent = new Group();
    parent.position.set(-3, 1, 2);
    parent.rotation.setFromAxisAngle(new Vector3(0, 1, 0), 0.9);
    parent.scale.set(0.5, 0.5, 0.5);
    const node = new Group();
    parent.add(node);
    const subject = new Group();
    subject.position.set(6, 2, -1);
    const rig = new FollowRig({
      target: subject,
      offset: new Vector3(0, 3, 0),
    });

    expect(rig.apply(node, DT)).toBe(true);
    expect(worldPosition(node).equalsApprox(new Vector3(6, 5, -1), 1e-12)).toBe(
      true,
    );
  });
});
