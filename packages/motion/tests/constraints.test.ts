/**
 * §12's `LookAtConstraint` and the §39 step-7 `ConstraintSystem` — the first
 * producing system §42's `"constraint"` authority has ever had (PH-11).
 *
 * The three claims that matter: an aim inside a fixed step never throws where
 * `Node.lookAt` would (§85), the slew limit is a shortest-arc rate limit that
 * arrives and stops, and the §42 check is byte-for-byte the one `MotionSystem`
 * and `KinematicSystem` make — refuse the write, warn once, leave the node's
 * owner alone.
 */

import { isFourError } from "@fourjs/core";
import {
  Quaternion,
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@fourjs/math";
import { Group, type TransformAuthority } from "@fourjs/scene";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FollowRig, OrbitRig } from "../src/camera-rigs.js";
import { ConstraintSystem, LookAtConstraint } from "../src/constraints.js";
import { DEFAULT_FIXED_DELTA_TIME, createTimeState } from "../src/clock.js";
import {
  PRIORITY_CONSTRAINTS,
  SystemRegistry,
  type FixedUpdateContext,
} from "../src/systems.js";

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
  return { time: createTimeState({ fixedDeltaTime }) };
}

/** Silences and records `console.warn` for one test. */
function spyOnWarn() {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** Where the node's −Z axis points, in world space. */
function forward(node: Group): Vector3 {
  return node.getWorldDirection(new Vector3());
}

/** A quaternion's four components, for an exact "unchanged" comparison. */
function components(q: Quaternion): readonly number[] {
  return [q.x, q.y, q.z, q.w];
}

/** Shortest-arc angle between two unit quaternions, in radians. */
function angleBetween(a: Quaternion, b: Quaternion): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  return 2 * Math.acos(Math.min(1, Math.abs(dot)));
}

describe("LookAtConstraint (§12)", () => {
  it("aims the node's −Z axis at its target", () => {
    const node = new Group();
    node.position.set(0, 0, 5);
    const aim = new LookAtConstraint({ target: new Vector3(0, 0, 0) });

    expect(aim.apply(node, DT)).toBe(true);
    expect(forward(node).equalsApprox(new Vector3(0, 0, -1), 1e-12)).toBe(true);

    node.position.set(4, 0, 0);
    aim.apply(node, DT);
    expect(forward(node).equalsApprox(new Vector3(-1, 0, 0), 1e-12)).toBe(true);
  });

  it("tracks a Node target as it moves", () => {
    const subject = new Group();
    subject.position.set(0, 0, -10);
    const node = new Group();
    const aim = new LookAtConstraint({ target: subject });

    aim.apply(node, DT);
    expect(forward(node).equalsApprox(new Vector3(0, 0, -1), 1e-12)).toBe(true);

    subject.position.set(10, 0, 0);
    aim.apply(node, DT);
    expect(forward(node).equalsApprox(new Vector3(1, 0, 0), 1e-12)).toBe(true);
  });

  it("counts, rather than throws, on the aims Node.lookAt refuses (§85)", () => {
    const node = new Group();
    const aim = new LookAtConstraint({ target: new Vector3(0, 0, 0) });
    const before = node.rotation.clone();

    // 1. the target coincides with the node's own world position
    expect(aim.apply(node, DT)).toBe(false);
    expect(aim.skippedSteps).toBe(1);

    // 2. `up` is parallel to the aim — the straight-down look
    node.position.set(0, 5, 0);
    expect(aim.apply(node, DT)).toBe(false);
    expect(aim.skippedSteps).toBe(2);

    // 3. the target is not finite
    aim.target = new Vector3(Number.NaN, 0, 0);
    expect(aim.apply(node, DT)).toBe(false);
    expect(aim.skippedSteps).toBe(3);

    // Nothing was written on any of them.
    expect(components(node.rotation)).toEqual(components(before));

    // The same node, with an `up` that is not parallel, aims fine.
    aim.target = new Vector3(0, 0, 0);
    aim.up.set(0, 0, -1);
    expect(aim.apply(node, DT)).toBe(true);
    expect(aim.skippedSteps).toBe(3);
  });

  it("is idle without a target and counts no skip for it", () => {
    const node = new Group();
    const aim = new LookAtConstraint();

    expect(aim.apply(node, DT)).toBe(false);
    expect(aim.skippedSteps).toBe(0);
    expect(aim.target).toBe(null);
    expect(aim.up.equalsApprox(new Vector3(0, 1, 0), 0)).toBe(true);
    expect(aim.maxAngularSpeed).toBe(undefined);
  });

  it("limits the turn rate, never overshoots, and arrives on time", () => {
    const node = new Group();
    const maxAngularSpeed = 1.5;
    const aim = new LookAtConstraint({
      target: new Vector3(0, 0, -1),
      maxAngularSpeed,
    });
    // Start facing +X, i.e. a quarter turn away from the target.
    node.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);

    const start = node.rotation.clone();
    aim.apply(node, DT);
    expect(angleBetween(start, node.rotation)).toBeCloseTo(
      maxAngularSpeed * DT,
      12,
    );

    // θ / rate seconds to arrive, then it stops there rather than oscillating.
    const steps = Math.ceil(Math.PI / 2 / (maxAngularSpeed * DT));
    for (let i = 0; i < steps; i += 1) {
      aim.apply(node, DT);
    }
    expect(forward(node).equalsApprox(new Vector3(0, 0, -1), 1e-9)).toBe(true);

    const settled = node.rotation.clone();
    aim.apply(node, DT);
    expect(angleBetween(settled, node.rotation)).toBeLessThan(1e-12);
  });

  it("snaps within the limit when the remaining angle is small enough", () => {
    const node = new Group();
    const aim = new LookAtConstraint({
      target: new Vector3(0, 0, -1),
      maxAngularSpeed: 1000,
    });
    node.rotation.setFromAxisAngle(new Vector3(0, 1, 0), 0.01);

    aim.apply(node, DT);
    expect(forward(node).equalsApprox(new Vector3(0, 0, -1), 1e-12)).toBe(true);
  });

  it("refuses impossible parameters at authoring (§85)", () => {
    expect(() => new LookAtConstraint({ up: new Vector3(0, 0, 0) })).toThrow(
      RangeError,
    );
    expect(
      () => new LookAtConstraint({ up: new Vector3(Number.NaN, 0, 0) }),
    ).toThrow(RangeError);
    expect(() => new LookAtConstraint({ maxAngularSpeed: 0 })).toThrow(
      RangeError,
    );
    expect(() => new LookAtConstraint({ maxAngularSpeed: -1 })).toThrow(
      RangeError,
    );
    expect(() => new LookAtConstraint({ maxAngularSpeed: Number.NaN })).toThrow(
      /maxAngularSpeed/,
    );

    const aim = new LookAtConstraint({ up: new Vector3(0, 0, 1) });
    expect(aim.up.equalsApprox(new Vector3(0, 0, 1), 0)).toBe(true);
  });

  it("allocates nothing per step (D7)", () => {
    const subject = new Group();
    const node = new Group();
    node.position.set(0, 2, 6);
    const aim = new LookAtConstraint({ target: subject, maxAngularSpeed: 0.5 });

    aim.apply(node, DT);
    resetConstructionCount();
    for (let i = 0; i < 200; i += 1) {
      subject.position.set(Math.sin(i * 0.1) * 4, 0, 0);
      aim.apply(node, DT);
    }
    expect(constructionCount()).toBe(0);
  });
});

describe("ConstraintSystem (§39 step 7, §42)", () => {
  it("sits at §39's constraint slot, after the solve", () => {
    expect(new ConstraintSystem().priority).toBe(PRIORITY_CONSTRAINTS);
    expect(PRIORITY_CONSTRAINTS).toBe(700);
    expect(new ConstraintSystem({ priority: 42 }).priority).toBe(42);
  });

  it("places then aims, so the aim reads the pose written this step", () => {
    const subject = new Group();
    subject.position.set(0, 0, -3);
    const camera = new Group();
    camera.transformAuthority = "constraint";
    camera.addComponent(new OrbitRig({ target: subject, distance: 4 }));
    camera.addComponent(new LookAtConstraint({ target: subject }));

    const system = new ConstraintSystem();
    system.track(camera);
    system.fixedUpdate(makeContext());

    // Placed on the target's +Z side …
    expect(camera.position.equalsApprox(new Vector3(0, 0, 1), 1e-12)).toBe(
      true,
    );
    // … and aimed from *there*, not from where it was before the step.
    expect(forward(camera).equalsApprox(new Vector3(0, 0, -1), 1e-12)).toBe(
      true,
    );
  });

  it("runs the follow rig after the orbit rig", () => {
    const camera = new Group();
    camera.transformAuthority = "constraint";
    camera.addComponent(new OrbitRig({ target: new Vector3(0, 0, 0) }));
    camera.addComponent(
      new FollowRig({
        target: new Vector3(5, 0, 0),
        offset: new Vector3(0, 1, 0),
      }),
    );

    const system = new ConstraintSystem();
    system.track(camera);
    system.fixedUpdate(makeContext());

    expect(camera.position.equalsApprox(new Vector3(5, 1, 0), 1e-12)).toBe(
      true,
    );
  });

  it("refuses a node owned by another authority, warns once, and writes nothing", () => {
    const warn = spyOnWarn();
    const subject = new Group();
    subject.position.set(0, 0, -3);
    const camera = new Group();
    camera.transformAuthority = "physics";
    const aim = camera.addComponent(new LookAtConstraint({ target: subject }));
    const before = camera.rotation.clone();

    const system = new ConstraintSystem();
    system.track(camera);
    const context = makeContext();
    for (let i = 0; i < 3; i += 1) {
      system.fixedUpdate(context);
    }

    expect(components(camera.rotation)).toEqual(components(before));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("§42");
    expect(warn.mock.calls[0][0]).toContain("constraint");
    expect(warn.mock.calls[0][0]).toContain("physics");
    // A refused step is not a skipped aim: the two states stay distinguishable.
    expect(aim.skippedSteps).toBe(0);
  });

  it.each<TransformAuthority>(["manual", "kinematic", "animation", "network"])(
    "refuses to place a node owned by %s authority",
    (authority) => {
      spyOnWarn();
      const camera = new Group();
      camera.transformAuthority = authority;
      const rig = camera.addComponent(
        new OrbitRig({ target: new Vector3(0, 0, 0), distance: 3 }),
      );

      const system = new ConstraintSystem();
      system.track(camera);
      const context = makeContext();
      for (let i = 0; i < 5; i += 1) {
        system.fixedUpdate(context);
      }

      expect(camera.position.equalsApprox(new Vector3(0, 0, 0), 0)).toBe(true);
      expect(rig.skippedSteps).toBe(0);
    },
  );

  it("writes the step after authority is granted, with no second warning", () => {
    const warn = spyOnWarn();
    const camera = new Group();
    camera.transformAuthority = "manual";
    camera.addComponent(
      new OrbitRig({ target: new Vector3(0, 0, 0), distance: 2 }),
    );

    const system = new ConstraintSystem();
    system.track(camera);
    const context = makeContext();
    system.fixedUpdate(context);
    expect(camera.position.equalsApprox(new Vector3(0, 0, 0), 0)).toBe(true);

    camera.transformAuthority = "constraint";
    system.fixedUpdate(context);
    expect(camera.position.equalsApprox(new Vector3(0, 0, 2), 1e-12)).toBe(
      true,
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("stays quiet for an idle node, whatever it owns", () => {
    const warn = spyOnWarn();
    const context = makeContext();
    const system = new ConstraintSystem();

    // No components at all.
    const bare = new Group();
    bare.transformAuthority = "physics";
    system.track(bare);

    // Components, but every one of them untargeted.
    const untargeted = new Group();
    untargeted.transformAuthority = "physics";
    untargeted.addComponent(new OrbitRig());
    untargeted.addComponent(new FollowRig());
    untargeted.addComponent(new LookAtConstraint());
    system.track(untargeted);

    // One targeted component at a time, each on its own node, so the three
    // halves of the idle test are each reached.
    const orbitOnly = new Group();
    orbitOnly.transformAuthority = "constraint";
    orbitOnly.addComponent(new OrbitRig({ target: new Vector3(0, 0, 0) }));
    system.track(orbitOnly);

    const followOnly = new Group();
    followOnly.transformAuthority = "constraint";
    followOnly.addComponent(new OrbitRig());
    followOnly.addComponent(new FollowRig({ target: new Vector3(3, 0, 0) }));
    system.track(followOnly);

    const aimOnly = new Group();
    aimOnly.transformAuthority = "constraint";
    aimOnly.addComponent(new FollowRig());
    aimOnly.addComponent(
      new LookAtConstraint({ target: new Vector3(0, 0, 9) }),
    );
    system.track(aimOnly);

    system.fixedUpdate(context);

    expect(warn).not.toHaveBeenCalled();
    expect(orbitOnly.position.equalsApprox(new Vector3(0, 0, 1), 1e-12)).toBe(
      true,
    );
    expect(followOnly.position.equalsApprox(new Vector3(3, 0, 0), 1e-12)).toBe(
      true,
    );
    expect(forward(aimOnly).equalsApprox(new Vector3(0, 0, 1), 1e-12)).toBe(
      true,
    );
  });

  it("skips a disabled node and resumes when it is re-enabled", () => {
    const camera = new Group();
    camera.transformAuthority = "constraint";
    camera.enabled = false;
    camera.addComponent(
      new OrbitRig({ target: new Vector3(0, 0, 0), distance: 2 }),
    );

    const system = new ConstraintSystem();
    system.track(camera);
    const context = makeContext();
    system.fixedUpdate(context);
    expect(camera.position.equalsApprox(new Vector3(0, 0, 0), 0)).toBe(true);

    camera.enabled = true;
    system.fixedUpdate(context);
    expect(camera.position.equalsApprox(new Vector3(0, 0, 2), 1e-12)).toBe(
      true,
    );
  });

  it("tracks in insertion order, idempotently, and lets go", () => {
    const system = new ConstraintSystem();
    const a = new Group();
    const b = new Group();

    expect(system.track(a)).toBe(a);
    system.track(b);
    system.track(a);
    expect(system.size).toBe(2);
    expect([...system.nodes]).toEqual([a, b]);
    expect(system.has(a)).toBe(true);
    expect(system.untrack(a)).toBe(true);
    expect(system.untrack(a)).toBe(false);
    expect(system.has(a)).toBe(false);
    system.clear();
    expect(system.size).toBe(0);
  });

  it("registers with the §39 registry and drops its nodes on dispose", () => {
    const registry = new SystemRegistry();
    const system = new ConstraintSystem();
    const camera = new Group();
    camera.transformAuthority = "constraint";
    camera.addComponent(
      new OrbitRig({ target: new Vector3(1, 0, 0), distance: 2 }),
    );
    system.track(camera);

    registry.register(system);
    registry.runFixedStep(createTimeState({ fixedDeltaTime: DT }));
    expect(camera.position.equalsApprox(new Vector3(1, 0, 2), 1e-12)).toBe(
      true,
    );

    registry.dispose();
    expect(system.size).toBe(0);
  });

  it("allocates nothing per step (D7)", () => {
    const subject = new Group();
    const camera = new Group();
    camera.transformAuthority = "constraint";
    camera.addComponent(new OrbitRig({ target: subject, distance: 5 }));
    camera.addComponent(new LookAtConstraint({ target: subject }));
    const system = new ConstraintSystem();
    system.track(camera);
    const context = makeContext();

    system.fixedUpdate(context);
    resetConstructionCount();
    for (let i = 0; i < 200; i += 1) {
      subject.position.set(Math.sin(i * 0.05) * 3, 0, 0);
      system.fixedUpdate(context);
    }
    expect(constructionCount()).toBe(0);
  });
});

describe("ConstraintSystem disposal (§83 stability audit, 2026-09-11)", () => {
  it("disposes idempotently and refuses tracking and stepping afterwards", () => {
    const system = new ConstraintSystem();
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
      /ConstraintSystem is disposed.*§83/s,
    );
    expectDisposedError(() => system.fixedUpdate(makeContext()));
    expect(system.size).toBe(0);
    // Reads stay answerable, so teardown code can still inspect the system.
    expect(system.has(node)).toBe(false);
  });
});
