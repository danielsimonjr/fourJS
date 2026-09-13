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
import { MotionComponent, MotionSystem } from "../src/motion-component.js";
import {
  PRIORITY_KINEMATICS,
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
  const time: ReadonlyTimeState = createTimeState({ fixedDeltaTime });
  return { time };
}

/** A tracked node carrying `motion`, plus the system that advances it. */
function scenario(
  options: ConstructorParameters<typeof MotionComponent>[0] = {},
): {
  node: Group;
  motion: MotionComponent;
  system: MotionSystem;
  step: (count?: number) => void;
} {
  const node = new Group();
  // §42: the system writes as `kinematic`, and nodes default to `manual`, so a
  // node has to hand it the transform before it will be advanced.
  node.transformAuthority = "kinematic";
  const motion = node.addComponent(new MotionComponent(options));
  const system = new MotionSystem();
  system.track(node);
  const context = makeContext();
  return {
    node,
    motion,
    system,
    step: (count = 1) => {
      for (let i = 0; i < count; i += 1) {
        system.fixedUpdate(context);
      }
    },
  };
}

describe("MotionComponent (§11)", () => {
  it("is a component keyed `motion` (plan D2)", () => {
    expect(MotionComponent.typeName).toBe("motion");
    const node = new Group();
    const motion = node.addComponent(new MotionComponent());
    expect(node.getComponent(MotionComponent)).toBe(motion);
    expect(motion.host).toBe(node);
  });

  it("defaults every §11 field", () => {
    const motion = new MotionComponent();
    expect(motion.linearVelocity.equalsApprox(new Vector3())).toBe(true);
    expect(motion.angularVelocity.equalsApprox(new Vector3())).toBe(true);
    expect(motion.linearAcceleration.equalsApprox(new Vector3())).toBe(true);
    expect(motion.angularAcceleration.equalsApprox(new Vector3())).toBe(true);
    expect(motion.damping).toBe(0);
    expect(motion.angularDamping).toBe(0);
    expect(motion.maxSpeed).toBeUndefined();
    expect(motion.maxAngularSpeed).toBeUndefined();
    expect(motion.host).toBeNull();
  });

  it("copies the vectors it is given, as §11's example constructs them", () => {
    const linearVelocity = new Vector3(2, 0, 0);
    const angularVelocity = new Vector3(0, 1, 0);
    const motion = new MotionComponent({
      linearVelocity,
      angularVelocity,
      linearAcceleration: new Vector3(0, -9.81, 0),
      angularAcceleration: new Vector3(0, 0, 0.5),
      damping: 0.1,
      angularDamping: 0.2,
      maxSpeed: 12,
      maxAngularSpeed: 3,
    });
    expect(motion.linearVelocity).not.toBe(linearVelocity);
    linearVelocity.set(99, 99, 99);
    angularVelocity.set(99, 99, 99);
    expect(motion.linearVelocity.equalsApprox(new Vector3(2, 0, 0))).toBe(true);
    expect(motion.angularVelocity.equalsApprox(new Vector3(0, 1, 0))).toBe(
      true,
    );
    expect(motion.linearAcceleration.y).toBeCloseTo(-9.81, 12);
    expect(motion.angularAcceleration.z).toBe(0.5);
    expect(motion.damping).toBe(0.1);
    expect(motion.angularDamping).toBe(0.2);
    expect(motion.maxSpeed).toBe(12);
    expect(motion.maxAngularSpeed).toBe(3);
  });

  it("resets velocities and accelerations but keeps limits", () => {
    const motion = new MotionComponent({
      linearVelocity: new Vector3(1, 2, 3),
      angularVelocity: new Vector3(1, 0, 0),
      linearAcceleration: new Vector3(0, -1, 0),
      angularAcceleration: new Vector3(0, 1, 0),
      damping: 0.5,
      maxSpeed: 4,
    });
    expect(motion.reset()).toBe(motion);
    expect(motion.linearVelocity.equalsApprox(new Vector3())).toBe(true);
    expect(motion.angularVelocity.equalsApprox(new Vector3())).toBe(true);
    expect(motion.linearAcceleration.equalsApprox(new Vector3())).toBe(true);
    expect(motion.angularAcceleration.equalsApprox(new Vector3())).toBe(true);
    expect(motion.damping).toBe(0.5);
    expect(motion.maxSpeed).toBe(4);
  });
});

describe("MotionSystem — linear motion (analytic)", () => {
  it("moves at constant velocity: 2 units/s for 1 s", () => {
    const { node, step } = scenario({ linearVelocity: new Vector3(2, 0, 0) });
    step(60);
    expect(node.transform.position.x).toBeCloseTo(2, 12);
    expect(node.transform.position.y).toBe(0);
    expect(node.transform.position.z).toBe(0);
  });

  it("integrates constant acceleration with semi-implicit Euler", () => {
    const { node, motion, step } = scenario({
      linearAcceleration: new Vector3(0, -10, 0),
    });
    step(60);
    const t = 60 * DT;
    // Semi-implicit Euler leads the exact 0.5·a·t² by 0.5·a·t·dt (§38).
    expect(node.transform.position.y).toBeCloseTo(
      0.5 * -10 * (t * t + t * DT),
      12,
    );
    expect(motion.linearVelocity.y).toBeCloseTo(-10 * t, 12);
  });

  it("advances by exactly v·dt in one step, after the velocity update", () => {
    const { node, motion, step } = scenario({
      linearVelocity: new Vector3(1, 0, 0),
      linearAcceleration: new Vector3(2, 0, 0),
    });
    step();
    const expectedVelocity = 1 + 2 * DT;
    expect(motion.linearVelocity.x).toBeCloseTo(expectedVelocity, 15);
    expect(node.transform.position.x).toBeCloseTo(expectedVelocity * DT, 15);
  });

  it("damps toward zero as 1 / (1 + c·dt)ⁿ", () => {
    const damping = 2;
    const { node, motion, step } = scenario({
      linearVelocity: new Vector3(1, 0, 0),
      damping,
    });
    const steps = 60;
    step(steps);
    const factor = 1 / (1 + damping * DT);
    expect(motion.linearVelocity.x).toBeCloseTo(factor ** steps, 12);
    // Position is the geometric sum dt·v₀·(f + f² + … + fⁿ).
    const expected = DT * ((factor * (1 - factor ** steps)) / (1 - factor));
    expect(node.transform.position.x).toBeCloseTo(expected, 12);
  });

  it("damping halts the drift of a constant-acceleration body at the terminal velocity", () => {
    const { motion, step } = scenario({
      linearAcceleration: new Vector3(0, -10, 0),
      damping: 5,
    });
    step(6000);
    // v → a / damping once the damping factor balances the acceleration.
    expect(motion.linearVelocity.y).toBeCloseTo(-10 / 5, 6);
  });

  it("clamps the speed to maxSpeed, preserving direction", () => {
    const { motion, step } = scenario({
      linearVelocity: new Vector3(6, 8, 0),
      maxSpeed: 5,
    });
    step();
    expect(motion.linearVelocity.length()).toBeCloseTo(5, 12);
    expect(motion.linearVelocity.x).toBeCloseTo(3, 12);
    expect(motion.linearVelocity.y).toBeCloseTo(4, 12);
  });

  it("leaves a velocity at or below maxSpeed untouched", () => {
    const { motion, step } = scenario({
      linearVelocity: new Vector3(3, 4, 0),
      maxSpeed: 5,
    });
    step();
    expect(motion.linearVelocity.x).toBe(3);
    expect(motion.linearVelocity.y).toBe(4);
  });

  it("holds an accelerating body at maxSpeed", () => {
    const { node, motion, step } = scenario({
      linearAcceleration: new Vector3(100, 0, 0),
      maxSpeed: 3,
    });
    step(60);
    expect(motion.linearVelocity.x).toBeCloseTo(3, 12);
    // Only the very first step is below the limit, so the distance is just
    // under 3 units after 1 s.
    expect(node.transform.position.x).toBeLessThan(3);
    expect(node.transform.position.x).toBeGreaterThan(2.9);
  });
});

describe("MotionSystem — angular motion (analytic)", () => {
  it("turns π/2 about +Y after 1 s at ω = (0, π/2, 0)", () => {
    const { node, step } = scenario({
      angularVelocity: new Vector3(0, Math.PI / 2, 0),
    });
    step(60);
    const expected = new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      Math.PI / 2,
    );
    const { rotation } = node.transform;
    expect(rotation.x).toBeCloseTo(expected.x, 12);
    expect(rotation.y).toBeCloseTo(expected.y, 12);
    expect(rotation.z).toBeCloseTo(expected.z, 12);
    expect(rotation.w).toBeCloseTo(expected.w, 12);

    // +X maps to -Z under a right-handed quarter turn about +Y (§7a).
    const axis = new Vector3(1, 0, 0);
    rotation.rotateVector3(axis, axis);
    expect(axis.x).toBeCloseTo(0, 12);
    expect(axis.y).toBeCloseTo(0, 12);
    expect(axis.z).toBeCloseTo(-1, 12);
  });

  it("keeps the rotation a unit quaternion over thousands of steps", () => {
    const { node, step } = scenario({
      angularVelocity: new Vector3(0.3, 1.1, -0.7),
    });
    step(10_000);
    const { x, y, z, w } = node.transform.rotation;
    expect(Math.sqrt(x * x + y * y + z * z + w * w)).toBeCloseTo(1, 12);
  });

  it("premultiplies, so ω is expressed in the parent frame", () => {
    // Start facing +Z after a quarter turn about +Y, then spin about +X. A
    // parent-frame (premultiplied) ω leaves the +X axis untouched by the second
    // rotation only if it were body-frame; here the composed rotation must equal
    // Rx · Ry, not Ry · Rx.
    const node = new Group();
    node.transformAuthority = "kinematic";
    node.transform.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    node.addComponent(
      new MotionComponent({ angularVelocity: new Vector3(Math.PI / 2, 0, 0) }),
    );
    const system = new MotionSystem();
    system.track(node);
    const context = makeContext();
    for (let i = 0; i < 60; i += 1) {
      system.fixedUpdate(context);
    }
    const expected = new Quaternion()
      .setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
      .multiply(
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2),
      );
    expect(node.transform.rotation.x).toBeCloseTo(expected.x, 12);
    expect(node.transform.rotation.y).toBeCloseTo(expected.y, 12);
    expect(node.transform.rotation.z).toBeCloseTo(expected.z, 12);
    expect(node.transform.rotation.w).toBeCloseTo(expected.w, 12);
  });

  it("applies angular acceleration, damping and maxAngularSpeed", () => {
    const damping = 1.5;
    const { motion, step } = scenario({
      angularVelocity: new Vector3(0, 4, 0),
      angularDamping: damping,
    });
    const steps = 30;
    step(steps);
    expect(motion.angularVelocity.y).toBeCloseTo(
      4 * (1 / (1 + damping * DT)) ** steps,
      12,
    );

    const clamped = scenario({
      angularAcceleration: new Vector3(0, 50, 0),
      maxAngularSpeed: 1,
    });
    clamped.step(60);
    expect(clamped.motion.angularVelocity.y).toBeCloseTo(1, 12);
    // One second capped at 1 rad/s, minus the sub-limit first step.
    expect(clamped.node.transform.rotation.y).toBeCloseTo(
      Math.sin(0.5 * (1 - DT + 50 * DT * DT)),
      6,
    );
  });

  it("leaves the rotation untouched when ω is zero", () => {
    const { node, step } = scenario({ linearVelocity: new Vector3(1, 0, 0) });
    const before = node.transform.version;
    step();
    // One version bump for the position write, none for the rotation.
    expect(node.transform.version).toBe(before + 1);
    expect(node.transform.rotation.w).toBe(1);
  });

  it("bumps the transform version once per written channel (plan D3)", () => {
    const { node, step } = scenario({
      linearVelocity: new Vector3(1, 0, 0),
      angularVelocity: new Vector3(0, 1, 0),
    });
    const before = node.transform.version;
    step(10);
    expect(node.transform.version).toBe(before + 20);
  });
});

describe("MotionSystem — tracking and lifecycle", () => {
  it("advances only tracked nodes", () => {
    const tracked = new Group();
    const untracked = new Group();
    tracked.transformAuthority = "kinematic";
    untracked.transformAuthority = "kinematic";
    tracked.addComponent(
      new MotionComponent({ linearVelocity: new Vector3(1, 0, 0) }),
    );
    untracked.addComponent(
      new MotionComponent({ linearVelocity: new Vector3(1, 0, 0) }),
    );
    const system = new MotionSystem();
    system.track(tracked);
    system.fixedUpdate(makeContext());
    expect(tracked.transform.position.x).toBeGreaterThan(0);
    expect(untracked.transform.position.x).toBe(0);
  });

  it("follows the component being added and removed via Node (§6a)", () => {
    const node = new Group();
    node.transformAuthority = "kinematic";
    const system = new MotionSystem();
    system.track(node);
    const context = makeContext();

    // Tracked, but no component yet: nothing moves.
    system.fixedUpdate(context);
    expect(node.transform.position.x).toBe(0);

    const motion = node.addComponent(
      new MotionComponent({ linearVelocity: new Vector3(3, 0, 0) }),
    );
    system.fixedUpdate(context);
    const moved = node.transform.position.x;
    expect(moved).toBeCloseTo(3 * DT, 15);

    expect(node.removeComponent(motion)).toBe(true);
    system.fixedUpdate(context);
    expect(node.transform.position.x).toBe(moved);
  });

  it("skips disabled nodes (§6)", () => {
    const { node, step } = scenario({ linearVelocity: new Vector3(1, 0, 0) });
    node.enabled = false;
    step(10);
    expect(node.transform.position.x).toBe(0);
    node.enabled = true;
    step();
    expect(node.transform.position.x).toBeCloseTo(DT, 15);
  });

  it("tracks, untracks, and reports membership", () => {
    const system = new MotionSystem();
    const a = new Group();
    const b = new Group();
    expect(system.size).toBe(0);
    expect(system.track(a)).toBe(a);
    system.track(b);
    system.track(a); // idempotent
    expect(system.size).toBe(2);
    expect(system.has(a)).toBe(true);
    expect([...system.nodes]).toEqual([a, b]);
    expect(system.untrack(a)).toBe(true);
    expect(system.untrack(a)).toBe(false);
    expect(system.has(a)).toBe(false);
    system.clear();
    expect(system.size).toBe(0);
  });

  it("iterates in insertion order (§33)", () => {
    const system = new MotionSystem();
    const order: string[] = [];
    const nodes = [new Group(), new Group(), new Group()];
    for (const [index, node] of nodes.entries()) {
      node.name = `n${String(index)}`;
      node.transformAuthority = "kinematic";
      node.addComponent(new MotionComponent());
      node.transform.position.onChanged = () => {
        order.push(node.name);
      };
      system.track(node);
    }
    system.fixedUpdate(makeContext());
    expect(order).toEqual(["n0", "n1", "n2"]);
  });

  it("registers with the §39 registry at the kinematic slot (plan D5)", () => {
    const registry = new SystemRegistry();
    const system = new MotionSystem();
    expect(system.priority).toBe(PRIORITY_KINEMATICS);
    const node = new Group();
    node.transformAuthority = "kinematic";
    node.addComponent(
      new MotionComponent({ linearVelocity: new Vector3(0, 2, 0) }),
    );
    system.track(node);
    const unregister = registry.register(system);
    registry.runFixedStep(createTimeState());
    expect(node.transform.position.y).toBeCloseTo(2 * DT, 15);
    unregister();
    // `dispose` dropped the tracked set.
    expect(system.size).toBe(0);
  });

  it("accepts a custom priority", () => {
    expect(new MotionSystem({ priority: 42 }).priority).toBe(42);
  });
});

describe("MotionSystem — transform authority (§42)", () => {
  /** Silences and records `console.warn` for one test. */
  function spyOnWarn() {
    return vi.spyOn(console, "warn").mockImplementation(() => undefined);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A tracked node with a moving component, at the given §42 authority. */
  function tracked(authority: TransformAuthority): {
    node: Group;
    system: MotionSystem;
    step: (count?: number) => void;
  } {
    const node = new Group();
    node.transformAuthority = authority;
    node.addComponent(
      new MotionComponent({ linearVelocity: new Vector3(1, 0, 0) }),
    );
    const system = new MotionSystem();
    system.track(node);
    const context = makeContext();
    return {
      node,
      system,
      step: (count = 1) => {
        for (let i = 0; i < count; i += 1) {
          system.fixedUpdate(context);
        }
      },
    };
  }

  it("moves a node whose authority is `kinematic`", () => {
    const warn = spyOnWarn();
    const { node, step } = tracked("kinematic");
    step(60);
    expect(node.transform.position.x).toBeCloseTo(1, 12);
    expect(warn).not.toHaveBeenCalled();
  });

  it("refuses to write a node owned by another authority, and warns once", () => {
    const warn = spyOnWarn();
    const { node, step } = tracked("manual");
    step();
    expect(node.transform.position.x).toBe(0);
    expect(node.transform.version).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("§42");
  });

  it("warns once per node per writer, not once per step", () => {
    const warn = spyOnWarn();
    const { node, step } = tracked("physics");
    step(120);
    expect(node.transform.position.x).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warns once for each conflicting node", () => {
    const warn = spyOnWarn();
    const system = new MotionSystem();
    const nodes = [new Group(), new Group()];
    for (const node of nodes) {
      node.transformAuthority = "animation";
      node.addComponent(
        new MotionComponent({ linearVelocity: new Vector3(1, 0, 0) }),
      );
      system.track(node);
    }
    const context = makeContext();
    system.fixedUpdate(context);
    system.fixedUpdate(context);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(nodes.every((node) => node.transform.position.x === 0)).toBe(true);
  });

  it("freezes the whole component while the write is refused, and resumes on hand-off", () => {
    const warn = spyOnWarn();
    const node = new Group();
    const motion = node.addComponent(
      new MotionComponent({
        linearVelocity: new Vector3(1, 0, 0),
        linearAcceleration: new Vector3(2, 0, 0),
      }),
    );
    const system = new MotionSystem();
    system.track(node);
    const context = makeContext();

    for (let i = 0; i < 10; i += 1) {
      system.fixedUpdate(context);
    }
    // Velocity is not integrated either, so nothing accumulates behind the
    // refusal and no teleport is queued up.
    expect(motion.linearVelocity.x).toBe(1);
    expect(node.transform.position.x).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);

    node.transformAuthority = "kinematic";
    system.fixedUpdate(context);
    expect(motion.linearVelocity.x).toBeCloseTo(1 + 2 * DT, 15);
    expect(node.transform.position.x).toBeCloseTo((1 + 2 * DT) * DT, 15);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not warn for a tracked node that has no MotionComponent", () => {
    const warn = spyOnWarn();
    const node = new Group(); // authority `manual`, no component
    const system = new MotionSystem();
    system.track(node);
    system.fixedUpdate(makeContext());
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn for a disabled node (§6 skips it before the check)", () => {
    const warn = spyOnWarn();
    const { node, step } = tracked("manual");
    node.enabled = false;
    step(5);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("MotionSystem — determinism and allocation (§33, §7b)", () => {
  /** Positions and rotations of a fixed scenario after `steps` steps. */
  function runScenario(steps: number): number[] {
    const system = new MotionSystem();
    const nodes = [new Group(), new Group(), new Group()];
    const velocities = [
      new Vector3(1, 0.25, -0.5),
      new Vector3(-2, 3, 0.125),
      new Vector3(0, 0, 7),
    ];
    const spins = [
      new Vector3(0, 1, 0),
      new Vector3(0.5, -0.25, 2),
      new Vector3(-1, 0, 0.75),
    ];
    for (const [index, node] of nodes.entries()) {
      node.transformAuthority = "kinematic";
      node.addComponent(
        new MotionComponent({
          linearVelocity: velocities[index],
          angularVelocity: spins[index],
          linearAcceleration: new Vector3(0, -9.81, 0),
          damping: 0.05 * index,
          angularDamping: 0.01 * index,
          maxSpeed: 25,
        }),
      );
      system.track(node);
    }
    const context = makeContext();
    for (let i = 0; i < steps; i += 1) {
      system.fixedUpdate(context);
    }
    return nodes.flatMap((node) => [
      node.transform.position.x,
      node.transform.position.y,
      node.transform.position.z,
      node.transform.rotation.x,
      node.transform.rotation.y,
      node.transform.rotation.z,
      node.transform.rotation.w,
    ]);
  }

  it("produces bit-identical results on a second run", () => {
    const first = runScenario(120);
    const second = runScenario(120);
    expect(second).toEqual(first);
    expect(first.every((value) => Number.isFinite(value))).toBe(true);
  });

  it("allocates nothing per fixed step", () => {
    const { step } = scenario({
      linearVelocity: new Vector3(1, 2, 3),
      angularVelocity: new Vector3(0, 1, 0),
      linearAcceleration: new Vector3(0, -9.81, 0),
      damping: 0.5,
      maxSpeed: 10,
      maxAngularSpeed: 4,
    });
    step(); // warm up
    resetConstructionCount();
    step(100);
    expect(constructionCount()).toBe(0);
  });
});

describe("MotionSystem disposal (§83 stability audit, 2026-09-11)", () => {
  it("disposes idempotently and refuses tracking and stepping afterwards", () => {
    const system = new MotionSystem();
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
      /MotionSystem is disposed.*§83/s,
    );
    expectDisposedError(() => system.fixedUpdate(makeContext()));
    expect(system.size).toBe(0);
    // Reads stay answerable, so teardown code can still inspect the system.
    expect(system.has(node)).toBe(false);
  });
});
