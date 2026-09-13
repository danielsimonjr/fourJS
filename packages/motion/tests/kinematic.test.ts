import { isFourError } from "@fourjs/core";
import {
  Quaternion,
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@fourjs/math";
import { Group, type TransformAuthority } from "@fourjs/scene";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_FIXED_DELTA_TIME,
  createTimeState,
  type ReadonlyTimeState,
} from "../src/clock.js";
import {
  KINEMATIC_COMPLETION_TOLERANCE,
  KinematicController,
  KinematicSystem,
} from "../src/kinematic-controller.js";
import {
  PRIORITY_KINEMATICS,
  SystemRegistry,
  type FixedUpdateContext,
} from "../src/systems.js";
import { CircularTrajectory, type Trajectory } from "../src/trajectories.js";

/** Runs `run`, expecting a `FourError` with `INVALID_APPLICATION_STATE` (§83, §89). */
function expectDisposedError(run: () => void): Error {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(isFourError(caught)).toBe(true);
  expect((caught as { code: string }).code).toBe("INVALID_APPLICATION_STATE");
  return caught as Error;
}

const DT = DEFAULT_FIXED_DELTA_TIME;

/** A `FixedUpdateContext` whose time record has the given fixed step. */
function makeContext(fixedDeltaTime = DT): FixedUpdateContext {
  const time: ReadonlyTimeState = createTimeState({ fixedDeltaTime });
  return { time };
}

interface Scenario {
  node: Group;
  controller: KinematicController;
  system: KinematicSystem;
  step: (count?: number) => void;
}

/** A tracked node with a controller, at `kinematic` authority by default. */
function scenario(authority: TransformAuthority = "kinematic"): Scenario {
  const node = new Group();
  node.transformAuthority = authority;
  const controller = node.addComponent(new KinematicController());
  const system = new KinematicSystem();
  system.track(node);
  const context = makeContext();
  return {
    node,
    controller,
    system,
    step: (count = 1) => {
      for (let i = 0; i < count; i += 1) {
        system.fixedUpdate(context);
      }
    },
  };
}

/** Silences and records `console.warn` for one test. */
function spyOnWarn() {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** Rotation angle of a quaternion known to be about +Y, in radians. */
function angleAboutY(q: Quaternion): number {
  return 2 * Math.atan2(q.y, q.w);
}

/**
 * Textbook slerp, written out independently of `Quaternion.slerp` (no
 * near-parallel branch, no renormalization): the ground truth for the general
 * non-coaxial case.
 */
function groundTruthSlerp(
  from: Quaternion,
  to: Quaternion,
  u: number,
): Quaternion {
  let { x: bx, y: by, z: bz, w: bw } = to;
  let cosTheta = from.x * bx + from.y * by + from.z * bz + from.w * bw;
  if (cosTheta < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    cosTheta = -cosTheta;
  }
  const theta = Math.acos(cosTheta);
  const a = Math.sin((1 - u) * theta) / Math.sin(theta);
  const b = Math.sin(u * theta) / Math.sin(theta);
  return new Quaternion(
    from.x * a + bx * b,
    from.y * a + by * b,
    from.z * a + bz * b,
    from.w * a + bw * b,
  );
}

/** Component-wise closeness for quaternions, to `digits` decimal places. */
function expectQuaternionClose(
  actual: Quaternion,
  expected: Quaternion,
  digits = 12,
): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
  expect(actual.z).toBeCloseTo(expected.z, digits);
  expect(actual.w).toBeCloseTo(expected.w, digits);
}

describe("KinematicController (§12) — component shape", () => {
  it("is a component keyed `kinematic-controller` (plan D2)", () => {
    expect(KinematicController.typeName).toBe("kinematic-controller");
    const node = new Group();
    const controller = node.addComponent(new KinematicController());
    expect(node.getComponent(KinematicController)).toBe(controller);
    expect(controller.host).toBe(node);
  });

  it("starts idle, with no commands issued", () => {
    const controller = new KinematicController();
    expect(controller.translationActive).toBe(false);
    expect(controller.rotationActive).toBe(false);
    expect(controller.commandGeneration).toBe(0);
    expect(controller.host).toBeNull();
  });

  it("counts every issued command in `commandGeneration`", () => {
    const { controller } = scenario();
    controller.moveTo(new Vector3(1, 0, 0), { duration: 1 });
    expect(controller.commandGeneration).toBe(1);
    controller.rotateTo(new Quaternion(), { duration: 1 });
    expect(controller.commandGeneration).toBe(2);
    controller.followPath(
      new CircularTrajectory({
        center: new Vector3(),
        radius: 1,
        angularVelocity: 1,
      }),
    );
    expect(controller.commandGeneration).toBe(3);
    controller.cancel();
    expect(controller.commandGeneration).toBe(5);
  });

  it("does not advance `commandGeneration` when a command completes", () => {
    const { controller, step } = scenario();
    controller.moveTo(new Vector3(1, 0, 0));
    const generation = controller.commandGeneration;
    step(2);
    expect(controller.translationActive).toBe(false);
    expect(controller.commandGeneration).toBe(generation);
  });

  it("rejects a duration that is not a finite number of seconds >= 0", () => {
    const controller = new KinematicController();
    const target = new Vector3(1, 0, 0);
    expect(() => controller.moveTo(target, { duration: -1 })).toThrow(
      RangeError,
    );
    expect(() => controller.moveTo(target, { duration: NaN })).toThrow(
      RangeError,
    );
    expect(() =>
      controller.moveTo(target, { duration: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
    expect(() =>
      controller.rotateTo(new Quaternion(), { duration: -0.5 }),
    ).toThrow(RangeError);
    expect(controller.translationActive).toBe(false);
    expect(controller.rotationActive).toBe(false);
  });
});

describe("KinematicController.moveTo (§12)", () => {
  it("arrives exactly at the target after `duration` (60 steps of 1/60)", () => {
    const { node, controller, step } = scenario();
    controller.moveTo(new Vector3(10, -4, 2), { duration: 1 });

    step(59);
    expect(controller.translationActive).toBe(true);
    expect(node.transform.position.x).toBeLessThan(10);

    step();
    expect(controller.translationActive).toBe(false);
    expect(node.transform.position.x).toBe(10);
    expect(node.transform.position.y).toBe(-4);
    expect(node.transform.position.z).toBe(2);
  });

  it("is at the midpoint after half the duration", () => {
    const { node, controller, step } = scenario();
    controller.moveTo(new Vector3(10, 0, 0), { duration: 1 });
    step(30);
    expect(node.transform.position.x).toBeCloseTo(5, 12);
    expect(controller.translationActive).toBe(true);
  });

  it("interpolates linearly across the whole move", () => {
    const { node, controller, step } = scenario();
    controller.moveTo(new Vector3(6, 0, 0), { duration: 1 });
    for (let n = 1; n <= 59; n += 1) {
      step();
      expect(node.transform.position.x).toBeCloseTo((6 * n) / 60, 10);
    }
  });

  it("captures the start pose at the first step, not when the command is issued", () => {
    const { node, controller, step } = scenario();
    controller.moveTo(new Vector3(0, 0, 0), { duration: 1 });
    // Issued between fixed steps; application code then moves the node.
    node.transform.position.set(0, 10, 0);
    step(30);
    expect(node.transform.position.y).toBeCloseTo(5, 12);
    step(30);
    expect(node.transform.position.y).toBe(0);
  });

  it("snaps on the next step with the default zero duration", () => {
    const { node, controller, step } = scenario();
    controller.moveTo(new Vector3(3, 4, 5));
    // Not a synchronous teleport: the write happens in the system.
    expect(node.transform.position.x).toBe(0);
    step();
    expect(node.transform.position.x).toBe(3);
    expect(node.transform.position.y).toBe(4);
    expect(node.transform.position.z).toBe(5);
    expect(controller.translationActive).toBe(false);
  });

  it("copies its target, so the caller may reuse the vector", () => {
    const { node, controller, step } = scenario();
    const target = new Vector3(1, 2, 3);
    controller.moveTo(target);
    target.set(99, 99, 99);
    step();
    expect(node.transform.position.equalsApprox(new Vector3(1, 2, 3))).toBe(
      true,
    );
  });

  it("restarts from the current pose when replaced mid-flight", () => {
    const { node, controller, step } = scenario();
    controller.moveTo(new Vector3(10, 0, 0), { duration: 1 });
    step(30);
    expect(node.transform.position.x).toBeCloseTo(5, 12);

    controller.moveTo(new Vector3(0, 0, 0), { duration: 1 });
    step(30);
    // Half way back from 5, not from 10 and not from 0.
    expect(node.transform.position.x).toBeCloseTo(2.5, 12);
    step(30);
    expect(node.transform.position.x).toBe(0);
    expect(controller.translationActive).toBe(false);
  });

  it("stops where it is when cancelled", () => {
    const { node, controller, step } = scenario();
    controller.moveTo(new Vector3(10, 0, 0), { duration: 1 });
    step(30);
    controller.cancelTranslation();
    const x = node.transform.position.x;
    step(60);
    expect(controller.translationActive).toBe(false);
    expect(node.transform.position.x).toBe(x);
  });

  it("bumps `Transform.version` once per moved step and not at all when idle", () => {
    const { node, controller, step } = scenario();
    const before = node.transform.version;
    step(5);
    expect(node.transform.version).toBe(before);

    controller.moveTo(new Vector3(1, 0, 0), { duration: 1 });
    step(3);
    expect(node.transform.version).toBe(before + 3);
  });
});

describe("KinematicController.rotateTo (§12)", () => {
  /** Rotation of `angle` radians about +Y. */
  function aboutY(angle: number): Quaternion {
    return new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle);
  }

  it("slerps about a fixed axis at a constant angular rate", () => {
    const { node, controller, step } = scenario();
    const target = aboutY(Math.PI / 2);
    controller.rotateTo(target, { duration: 1 });

    // Coaxial ground truth: slerp between two rotations about one axis is the
    // rotation about that axis at the linearly interpolated angle. `1/3` and
    // `2/3` are where normalized lerp would visibly disagree.
    step(20);
    expect(angleAboutY(node.transform.rotation)).toBeCloseTo(Math.PI / 6, 12);
    step(20);
    expect(angleAboutY(node.transform.rotation)).toBeCloseTo(Math.PI / 3, 12);
    expect(controller.rotationActive).toBe(true);

    step(20);
    expect(controller.rotationActive).toBe(false);
    expect(node.transform.rotation.x).toBe(target.x);
    expect(node.transform.rotation.y).toBe(target.y);
    expect(node.transform.rotation.z).toBe(target.z);
    expect(node.transform.rotation.w).toBe(target.w);
  });

  it("matches textbook slerp for a non-coaxial pair", () => {
    const start = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.7);
    const target = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.3);

    for (const steps of [15, 30, 45]) {
      const run = scenario();
      run.node.transform.rotation.copy(start);
      run.controller.rotateTo(target, { duration: 1 });
      run.step(steps);
      expectQuaternionClose(
        run.node.transform.rotation,
        groundTruthSlerp(start, target, steps / 60),
      );
    }
  });

  it("takes the shortest arc when the target's dot product is negative (D8)", () => {
    const { node, controller, step } = scenario();
    const quarter = aboutY(Math.PI / 2);
    // Same rotation, opposite components: the long way round would sweep 3π/2.
    const negated = new Quaternion(
      -quarter.x,
      -quarter.y,
      -quarter.z,
      -quarter.w,
    );
    controller.rotateTo(negated, { duration: 1 });
    step(30);
    // Half of the *short* arc is π/4 about -Y in negated components, i.e. an
    // angle of magnitude π/4 either way.
    expect(Math.abs(angleAboutY(node.transform.rotation))).toBeCloseTo(
      Math.PI / 4,
      12,
    );

    step(30);
    // The completing step writes the requested components verbatim.
    expect(node.transform.rotation.y).toBe(negated.y);
    expect(node.transform.rotation.w).toBe(negated.w);
  });

  it("snaps on the next step with the default zero duration", () => {
    const { node, controller, step } = scenario();
    const target = aboutY(1.1);
    controller.rotateTo(target);
    expect(node.transform.rotation.w).toBe(1);
    step();
    expect(node.transform.rotation.w).toBe(target.w);
    expect(controller.rotationActive).toBe(false);
  });

  it("restarts from the current orientation when replaced mid-flight", () => {
    const { node, controller, step } = scenario();
    controller.rotateTo(aboutY(Math.PI / 2), { duration: 1 });
    step(30);
    const midway = angleAboutY(node.transform.rotation);
    expect(midway).toBeCloseTo(Math.PI / 4, 12);

    controller.rotateTo(aboutY(0), { duration: 1 });
    step(30);
    expect(angleAboutY(node.transform.rotation)).toBeCloseTo(midway / 2, 12);
  });
});

describe("KinematicController.followPath (§12, §13)", () => {
  /** One revolution per second, radius 2, centred on the origin (XY plane). */
  function circle(): CircularTrajectory {
    return new CircularTrajectory({
      center: new Vector3(),
      radius: 2,
      angularVelocity: 2 * Math.PI,
    });
  }

  it("tracks a circular trajectory across a full revolution", () => {
    const path = circle();
    expect(path.duration).toBeCloseTo(1, 15);
    const { node, controller, step } = scenario();
    controller.followPath(path);

    const expected = new Vector3();
    for (let n = 1; n <= 59; n += 1) {
      step();
      path.samplePosition(n / 60, expected);
      expect(node.transform.position.x).toBeCloseTo(expected.x, 9);
      expect(node.transform.position.y).toBeCloseTo(expected.y, 9);
      expect(node.transform.position.z).toBeCloseTo(expected.z, 9);
    }
    expect(controller.translationActive).toBe(true);
  });

  it("clamps at `duration` and completes when not looping", () => {
    const path = circle();
    const { node, controller, step } = scenario();
    controller.followPath(path);

    step(60);
    expect(controller.translationActive).toBe(false);
    const end = node.transform.position.clone();
    const expected = path.samplePosition(path.duration);
    expect(end.x).toBeCloseTo(expected.x, 12);
    expect(end.y).toBeCloseTo(expected.y, 12);

    // Idle afterwards: the node stays exactly where the clamp left it.
    step(30);
    expect(node.transform.position.equalsApprox(end, 0)).toBe(true);
  });

  it("wraps at `duration` when looping, and never completes", () => {
    const path = circle();
    const { node, controller, step } = scenario();
    controller.followPath(path, { loop: true });

    step(90); // one and a half revolutions
    const expected = path.samplePosition(0.5);
    expect(node.transform.position.x).toBeCloseTo(expected.x, 9);
    expect(node.transform.position.y).toBeCloseTo(expected.y, 9);
    expect(controller.translationActive).toBe(true);

    step(30); // back to the start of the circle
    const start = path.samplePosition(0);
    expect(node.transform.position.x).toBeCloseTo(start.x, 9);
    expect(node.transform.position.y).toBeCloseTo(start.y, 9);
    expect(controller.translationActive).toBe(true);
  });

  it("never clamps a trajectory of infinite duration", () => {
    const endless: Trajectory = {
      duration: Number.POSITIVE_INFINITY,
      samplePosition: (time, out) => (out ?? new Vector3()).set(time, 0, 0),
      sampleVelocity: (_time, out) => (out ?? new Vector3()).set(1, 0, 0),
      sampleAcceleration: (_time, out) => (out ?? new Vector3()).set(0, 0, 0),
    };
    const { node, controller, step } = scenario();
    controller.followPath(endless);
    step(120);
    expect(node.transform.position.x).toBeCloseTo(2, 9);
    expect(controller.translationActive).toBe(true);
  });

  it("claims the translation channel: it replaces and is replaced by moveTo", () => {
    const { node, controller, step } = scenario();
    controller.moveTo(new Vector3(100, 0, 0), { duration: 1 });
    step(10);

    controller.followPath(circle(), { loop: true });
    step(15); // a quarter revolution
    expect(node.transform.position.x).toBeCloseTo(0, 9);
    expect(node.transform.position.y).toBeCloseTo(2, 9);

    controller.moveTo(new Vector3(0, 0, 0), { duration: 1 });
    step(60);
    expect(node.transform.position.x).toBe(0);
    expect(node.transform.position.y).toBe(0);
    expect(controller.translationActive).toBe(false);
  });
});

describe("KinematicController — channel independence (WP-2.5)", () => {
  it("runs a move and a rotation concurrently, each on its own clock", () => {
    const { node, controller, step } = scenario();
    const target = new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      Math.PI / 2,
    );
    controller.moveTo(new Vector3(10, 0, 0), { duration: 1 });
    controller.rotateTo(target, { duration: 0.5 });

    step(30);
    // The rotation is done; the move is at its midpoint.
    expect(controller.rotationActive).toBe(false);
    expect(node.transform.rotation.y).toBe(target.y);
    expect(controller.translationActive).toBe(true);
    expect(node.transform.position.x).toBeCloseTo(5, 12);

    step(30);
    expect(controller.translationActive).toBe(false);
    expect(node.transform.position.x).toBe(10);
    expect(node.transform.rotation.y).toBe(target.y);
  });

  it("leaves the rotation channel alone when the translation channel is replaced", () => {
    const { controller, step } = scenario();
    controller.rotateTo(
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1),
      { duration: 1 },
    );
    step(30);
    controller.moveTo(new Vector3(1, 0, 0), { duration: 1 });
    controller.cancelTranslation();
    expect(controller.rotationActive).toBe(true);
    step(30);
    expect(controller.rotationActive).toBe(false);
  });

  it("follows a path and rotates at the same time", () => {
    const { node, controller, step } = scenario();
    const path = new CircularTrajectory({
      center: new Vector3(),
      radius: 3,
      angularVelocity: 2 * Math.PI,
    });
    controller.followPath(path, { loop: true });
    controller.rotateTo(
      new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2),
      { duration: 1 },
    );
    step(60);
    const expected = path.samplePosition(1);
    expect(node.transform.position.x).toBeCloseTo(expected.x, 9);
    expect(controller.translationActive).toBe(true);
    expect(controller.rotationActive).toBe(false);
  });
});

describe("KinematicSystem — transform authority (§42)", () => {
  it("moves a node whose authority is `kinematic` without warning", () => {
    const warn = spyOnWarn();
    const { node, controller, step } = scenario("kinematic");
    controller.moveTo(new Vector3(1, 0, 0));
    step();
    expect(node.transform.position.x).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("refuses to write a node owned by another authority, and warns once", () => {
    const warn = spyOnWarn();
    const { node, controller, step } = scenario("manual");
    controller.moveTo(new Vector3(10, 0, 0), { duration: 1 });
    step(30);
    expect(node.transform.position.x).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("§42");
  });

  it("freezes a refused command instead of consuming it", () => {
    spyOnWarn();
    const { node, controller, step } = scenario("animation");
    controller.moveTo(new Vector3(10, 0, 0), { duration: 1 });
    step(30);
    expect(node.transform.position.x).toBe(0);

    node.transformAuthority = "kinematic";
    step(30);
    // The command runs its full duration from the moment it is allowed to.
    expect(node.transform.position.x).toBeCloseTo(5, 12);
    step(30);
    expect(node.transform.position.x).toBe(10);
  });

  it("does not warn for an idle controller", () => {
    const warn = spyOnWarn();
    const { step } = scenario("physics");
    step(10);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn for a tracked node with no controller", () => {
    const warn = spyOnWarn();
    const node = new Group(); // authority `manual`, no component
    const system = new KinematicSystem();
    system.track(node);
    system.fixedUpdate(makeContext());
    expect(warn).not.toHaveBeenCalled();
  });

  it("skips a disabled node and freezes its command (§6)", () => {
    const warn = spyOnWarn();
    const { node, controller, step } = scenario();
    controller.moveTo(new Vector3(10, 0, 0), { duration: 1 });
    node.enabled = false;
    step(60);
    expect(node.transform.position.x).toBe(0);
    expect(warn).not.toHaveBeenCalled();

    node.enabled = true;
    step(60);
    expect(node.transform.position.x).toBe(10);
  });

  it("warns once per node, not once per step", () => {
    const warn = spyOnWarn();
    const { controller, step } = scenario("constraint");
    controller.moveTo(new Vector3(1, 0, 0), { duration: 5 });
    step(50);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("KinematicSystem — registration and tracking (§39, D5)", () => {
  it("defaults to the §39 kinematic-motion slot", () => {
    expect(new KinematicSystem().priority).toBe(PRIORITY_KINEMATICS);
    expect(new KinematicSystem({ priority: 450 }).priority).toBe(450);
  });

  it("tracks nodes in insertion order, idempotently", () => {
    const system = new KinematicSystem();
    const a = new Group();
    const b = new Group();
    expect(system.track(a)).toBe(a);
    system.track(b);
    system.track(a); // no reordering
    expect(system.size).toBe(2);
    expect([...system.nodes]).toEqual([a, b]);
    expect(system.has(a)).toBe(true);
    expect(system.untrack(a)).toBe(true);
    expect(system.untrack(a)).toBe(false);
    expect(system.has(a)).toBe(false);
    system.clear();
    expect(system.size).toBe(0);
  });

  it("runs through the §39 registry and stops after dispose", () => {
    const node = new Group();
    node.transformAuthority = "kinematic";
    const controller = node.addComponent(new KinematicController());
    const system = new KinematicSystem();
    system.track(node);

    const registry = new SystemRegistry();
    registry.register(system);
    controller.moveTo(new Vector3(6, 0, 0), { duration: 0.1 });
    const time = createTimeState();
    registry.runFixedStep(time);
    expect(node.transform.position.x).toBeCloseTo(1, 12);

    registry.dispose();
    expect(system.size).toBe(0);
    registry.runFixedStep(time);
    expect(node.transform.position.x).toBeCloseTo(1, 12);
  });

  it("advances nodes in tracking order", () => {
    const order: string[] = [];
    const system = new KinematicSystem();
    for (const name of ["a", "b", "c"]) {
      const node = new Group();
      node.name = name;
      node.transformAuthority = "kinematic";
      const controller = node.addComponent(new KinematicController());
      controller.moveTo(new Vector3(1, 0, 0), { duration: 1 });
      // Chain the recorder in front of `Transform`'s own dirty hook (plan D3)
      // rather than replacing it, so versioning keeps working.
      const markDirty = node.transform.position.onChanged;
      node.transform.position.onChanged = () => {
        order.push(name);
        markDirty?.();
      };
      system.track(node);
    }
    system.fixedUpdate(makeContext());
    expect(order).toEqual(["a", "b", "c"]);
  });
});

describe("KinematicController — determinism and allocation (§33, D7)", () => {
  /** Quantized digest of a run's positions, per D6's quantization rule. */
  function digest(): string {
    const { node, controller, step } = scenario();
    const path = new CircularTrajectory({
      center: new Vector3(1, 2, 3),
      radius: 2.5,
      angularVelocity: 1.7,
    });
    const parts: string[] = [];
    controller.moveTo(new Vector3(4, -1, 0.5), { duration: 0.37 });
    controller.rotateTo(
      new Quaternion().setFromAxisAngle(new Vector3(0.3, 1, -0.2), 2.1),
      { duration: 0.61 },
    );
    for (let i = 0; i < 200; i += 1) {
      if (i === 40) {
        controller.followPath(path, { loop: true });
      }
      step();
      const p = node.transform.position;
      const r = node.transform.rotation;
      parts.push(
        `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)},${Math.round(p.z * 1e6)},` +
          `${Math.round(r.x * 1e6)},${Math.round(r.y * 1e6)},${Math.round(r.z * 1e6)},${Math.round(r.w * 1e6)}`,
      );
    }
    return parts.join("|");
  }

  it("produces an identical digest on a second run", () => {
    const first = digest();
    const second = digest();
    expect(second).toBe(first);
    expect(first.length).toBeGreaterThan(0);
  });

  it("allocates nothing per fixed step", () => {
    const { controller, step } = scenario();
    controller.followPath(
      new CircularTrajectory({
        center: new Vector3(),
        radius: 2,
        angularVelocity: 2 * Math.PI,
      }),
      { loop: true },
    );
    controller.rotateTo(
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI),
      { duration: 1000 },
    );
    step(); // warm up
    resetConstructionCount();
    step(100);
    expect(constructionCount()).toBe(0);
  });

  it("completes within the documented relative tolerance", () => {
    expect(KINEMATIC_COMPLETION_TOLERANCE).toBe(1e-9);
    // 120 steps of 1/120 sum to slightly *under* 1 s; an exact `>=` test would
    // leave the move one step short of its target.
    const node = new Group();
    node.transformAuthority = "kinematic";
    const controller = node.addComponent(new KinematicController());
    const system = new KinematicSystem();
    system.track(node);
    const context = makeContext(1 / 120);
    controller.moveTo(new Vector3(1, 0, 0), { duration: 1 });
    for (let i = 0; i < 120; i += 1) {
      system.fixedUpdate(context);
    }
    expect(controller.translationActive).toBe(false);
    expect(node.transform.position.x).toBe(1);
  });
});

describe("KinematicController.step (direct use)", () => {
  it("advances a controller without a system and without an authority check", () => {
    const node = new Group(); // stays `manual`
    const controller = new KinematicController();
    controller.moveTo(new Vector3(2, 0, 0), { duration: 1 });
    for (let i = 0; i < 60; i += 1) {
      controller.step(node.transform, DT);
    }
    expect(node.transform.position.x).toBe(2);
  });
});

describe("KinematicSystem disposal (§83 stability audit, 2026-09-11)", () => {
  it("disposes idempotently and refuses tracking and stepping afterwards", () => {
    const system = new KinematicSystem();
    const node = new Group();
    expect(system.disposed).toBe(false);
    system.track(node);
    expect(system.size).toBe(1);

    system.dispose();
    expect(system.disposed).toBe(true);
    expect(system.size).toBe(0);
    // A second dispose is a no-op (§83: idempotent), not an error.
    expect(() => system.dispose()).not.toThrow();
    expect(system.disposed).toBe(true);

    // Disposal is terminal (§83): the mutating entry points refuse with §89's
    // INVALID_APPLICATION_STATE instead of silently working on a dead system.
    expect(expectDisposedError(() => system.track(node)).message).toMatch(
      /KinematicSystem is disposed.*§83/s,
    );
    expectDisposedError(() => system.fixedUpdate(makeContext()));
    expect(system.size).toBe(0);
    // Reads stay answerable, so teardown code can still inspect the system.
    expect(system.has(node)).toBe(false);
  });
});
