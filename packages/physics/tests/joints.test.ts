import { isFourError } from "@fourjs/core";
import { Quaternion, Vector2, Vector3 } from "@fourjs/math";
import { describe, expect, it } from "vitest";

import type {
  JointBinding,
  JointDescriptor,
  PhysicsBodyHandle,
  PhysicsDimension,
} from "../src/index.js";
import {
  BallJoint,
  FixedJoint,
  HingeJoint,
  JOINT_TYPES,
  PrismaticJoint,
  RevoluteJoint,
  RigidBody,
  RopeJoint,
  SHIPPED_JOINT_TYPES,
  SHIPPED_JOINT_TYPES_2D,
  SHIPPED_JOINT_TYPES_3D,
  STAGED_JOINT_TYPES,
  SliderJoint,
  SphericalJoint,
  SpringJoint,
  jointTypeSupportsDimension,
  validateAngularJointMotor,
  validateJointBreakThreshold,
  validateJointDescriptor,
  validateJointLimits,
  validateLinearJointMotor,
  validateSphericalJointLimits,
  worldAnchorToLocal,
  worldAxisToLocal,
} from "../src/index.js";

/** A handle a descriptor can carry without a solver behind it. */
function makeBodyHandle(tag: string): PhysicsBodyHandle {
  return { tag } as unknown as PhysicsBodyHandle;
}

const HANDLE_A = makeBodyHandle("a");
const HANDLE_B = makeBodyHandle("b");

/** A binding a class can be asked for a descriptor with, outside any world. */
function binding(overrides: Partial<JointBinding> = {}): JointBinding {
  return {
    bodyA: HANDLE_A,
    bodyB: HANDLE_B,
    anchorA: new Vector3(),
    anchorB: new Vector3(),
    axis: new Vector3(0, 0, 1),
    ...overrides,
  };
}

/** Two distinct dynamic bodies, which every joint needs (§28). */
function bodies(): { a: RigidBody; b: RigidBody } {
  return {
    a: new RigidBody({ type: "dynamic" }),
    b: new RigidBody({ type: "dynamic" }),
  };
}

/** Runs `run` and returns the `FourError` it threw. */
function expectFourError(run: () => void): Error & { code: string } {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(isFourError(caught)).toBe(true);
  return caught as Error & { code: string };
}

describe("the shipped joint tier (§28, plan P6-1)", () => {
  it("ships six of §28's nine types and stages two", () => {
    expect(SHIPPED_JOINT_TYPES).toEqual([
      "fixed",
      "spring",
      "revolute",
      "prismatic",
      "spherical",
      "rope",
    ]);
    expect(STAGED_JOINT_TYPES).toEqual(["distance", "gear"]);
    // §28's vocabulary is unchanged: the tier narrows what is *built*.
    for (const type of [...SHIPPED_JOINT_TYPES, ...STAGED_JOINT_TYPES]) {
      expect(JOINT_TYPES).toContain(type);
    }
    // "motorized" is the ninth name, and is a field rather than a type.
    expect(JOINT_TYPES).toContain("motorized");
    expect(SHIPPED_JOINT_TYPES).not.toContain("motorized");
  });

  it("puts spherical in 3d only (§21)", () => {
    expect(SHIPPED_JOINT_TYPES_2D).not.toContain("spherical");
    expect(SHIPPED_JOINT_TYPES_3D).toContain("spherical");
    expect(jointTypeSupportsDimension("spherical", "2d")).toBe(false);
    expect(jointTypeSupportsDimension("spherical", "3d")).toBe(true);
    for (const type of SHIPPED_JOINT_TYPES_2D) {
      expect(jointTypeSupportsDimension(type, "2d")).toBe(true);
      expect(jointTypeSupportsDimension(type, "3d")).toBe(true);
    }
  });
});

describe("world → local conversion (§28, WP-6.1)", () => {
  it("subtracts the body position and undoes its rotation", () => {
    const position = new Vector3(1, 2, 0);
    const quarterTurn = new Quaternion().setFromAxisAngle(
      new Vector3(0, 0, 1),
      Math.PI / 2,
    );
    const local = worldAnchorToLocal(
      position,
      quarterTurn,
      new Vector3(1, 3, 0),
    );
    // The anchor sits one unit +Y of the body, which is -X in its own frame
    // after a quarter turn about +Z.
    expect(local.x).toBeCloseTo(1, 12);
    expect(local.y).toBeCloseTo(0, 12);
    expect(local.z).toBeCloseTo(0, 12);
  });

  it("writes into `out` when given and allocates otherwise (§7b, D7)", () => {
    const out = new Vector3();
    const scratch = new Quaternion();
    const returned = worldAnchorToLocal(
      new Vector3(0, 1, 0),
      new Quaternion(),
      new Vector2(2, 3),
      out,
      scratch,
    );
    expect(returned).toBe(out);
    expect([out.x, out.y, out.z]).toEqual([2, 2, 0]);
  });

  it("normalizes an axis and keeps a planar one exactly planar (§21)", () => {
    const spin = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.723);
    const axis = worldAxisToLocal(spin, new Vector3(0, 0, 4));
    expect([axis.x, axis.y, axis.z]).toEqual([0, 0, 1]);

    const planar = worldAxisToLocal(spin, new Vector3(2, 0, 0));
    expect(planar.z).toBe(0);
    expect(planar.length()).toBeCloseTo(1, 12);
  });

  it("leaves a zero axis at zero rather than producing NaN", () => {
    const axis = worldAxisToLocal(new Quaternion(), new Vector3(0, 0, 0));
    expect([axis.x, axis.y, axis.z]).toEqual([0, 0, 0]);
  });
});

describe("Joint construction (§28)", () => {
  it("rejects a joint from a body to itself", () => {
    const { a } = bodies();
    expect(
      expectFourError(() => new FixedJoint({ bodyA: a, bodyB: a })).message,
    ).toContain("two different bodies");
  });

  it("uses `anchor` for both bodies and lets each side override it", () => {
    const { a, b } = bodies();
    const shared = new FixedJoint({
      bodyA: a,
      bodyB: b,
      anchor: new Vector2(1, 2),
    });
    expect([shared.anchorA?.x, shared.anchorA?.y, shared.anchorA?.z]).toEqual([
      1, 2, 0,
    ]);
    expect([shared.anchorB?.x, shared.anchorB?.y]).toEqual([1, 2]);

    const split = new FixedJoint({
      bodyA: a,
      bodyB: b,
      anchor: new Vector3(1, 2, 3),
      anchorB: new Vector3(4, 5, 6),
    });
    expect(split.anchorA?.x).toBe(1);
    expect(split.anchorB?.x).toBe(4);
  });

  it("leaves the anchors undefined when none was given", () => {
    const { a, b } = bodies();
    const joint = new FixedJoint({ bodyA: a, bodyB: b });
    expect(joint.anchorA).toBeUndefined();
    expect(joint.anchorB).toBeUndefined();
  });

  it("copies the anchor, so a later mutation cannot leak in", () => {
    const { a, b } = bodies();
    const anchor = new Vector3(1, 0, 0);
    const joint = new FixedJoint({ bodyA: a, bodyB: b, anchor });
    anchor.set(9, 9, 9);
    expect(joint.anchorA?.x).toBe(1);
  });

  it("rejects a non-finite anchor (§85)", () => {
    const { a, b } = bodies();
    expect(
      expectFourError(
        () =>
          new FixedJoint({
            bodyA: a,
            bodyB: b,
            anchor: new Vector3(Number.NaN, 0, 0),
          }),
      ).message,
    ).toContain("anchorA must be finite");
  });

  it("defaults collisionEnabled to false and takes it from options (§28)", () => {
    const { a, b } = bodies();
    expect(new FixedJoint({ bodyA: a, bodyB: b }).collisionEnabled).toBe(false);
    expect(
      new FixedJoint({ bodyA: a, bodyB: b, collisionEnabled: true })
        .collisionEnabled,
    ).toBe(true);
  });

  it("starts unregistered, unbroken, and with an empty command queue", () => {
    const { a, b } = bodies();
    const joint = new FixedJoint({ bodyA: a, bodyB: b });
    expect(joint.registered).toBe(false);
    expect(joint.broken).toBe(false);
    expect(joint.id).toBeUndefined();
    expect(joint.commands).toEqual({
      limitsDirty: false,
      motorDirty: false,
      collisionDirty: false,
      anchorsDirty: false,
    });
    expect(joint.breakable).toBe(false);
  });
});

describe("break thresholds (§28, plan P6-2)", () => {
  it("accepts positive thresholds and reports breakable", () => {
    const { a, b } = bodies();
    const joint = new FixedJoint({
      bodyA: a,
      bodyB: b,
      breakForce: 10,
      breakTorque: 4,
    });
    expect(joint.breakForce).toBe(10);
    expect(joint.breakTorque).toBe(4);
    expect(joint.breakable).toBe(true);
  });

  it.each([
    ["breakForce", { breakForce: 0 }],
    ["breakTorque", { breakTorque: -1 }],
  ])("rejects a non-positive %s at construction", (field, options) => {
    const { a, b } = bodies();
    expect(
      expectFourError(() => new FixedJoint({ bodyA: a, bodyB: b, ...options }))
        .message,
    ).toContain(`${field} must be positive`);
  });

  it("is settable afterwards, in both directions", () => {
    const { a, b } = bodies();
    const joint = new FixedJoint({ bodyA: a, bodyB: b });
    joint.breakForce = 5;
    joint.breakTorque = 6;
    expect(joint.breakable).toBe(true);
    expect(
      expectFourError(() => {
        joint.breakForce = Number.POSITIVE_INFINITY;
      }).message,
    ).toContain("finite");
    expect(
      expectFourError(() => {
        joint.breakTorque = 0;
      }).message,
    ).toContain("must be positive");
    joint.breakForce = undefined;
    joint.breakTorque = undefined;
    expect(joint.breakable).toBe(false);
  });
});

describe("FixedJoint (§28)", () => {
  it("describes itself with the binding's frames", () => {
    const { a, b } = bodies();
    const joint = new FixedJoint({
      bodyA: a,
      bodyB: b,
      collisionEnabled: true,
      breakForce: 3,
      breakTorque: 2,
    });
    const anchorA = new Vector3(1, 0, 0);
    const descriptor = joint.toDescriptor(binding({ anchorA }));
    expect(descriptor).toEqual({
      type: "fixed",
      bodyA: HANDLE_A,
      bodyB: HANDLE_B,
      anchorA,
      anchorB: new Vector3(),
      collisionEnabled: true,
      breakForce: 3,
      breakTorque: 2,
    });
    expect(joint.type).toBe("fixed");
  });

  it("omits the thresholds that were never set", () => {
    const { a, b } = bodies();
    const descriptor = new FixedJoint({ bodyA: a, bodyB: b }).toDescriptor(
      binding(),
    );
    expect("breakForce" in descriptor).toBe(false);
    expect("breakTorque" in descriptor).toBe(false);
  });

  it("has no axis of its own", () => {
    const { a, b } = bodies();
    const out = new Vector3(1, 1, 1);
    new FixedJoint({ bodyA: a, bodyB: b }).worldAxis("3d", out);
    expect([out.x, out.y, out.z]).toEqual([0, 0, 0]);
  });
});

describe("HingeJoint (§28's example)", () => {
  it("round-trips §28's sketch into a revolute descriptor", () => {
    const { a, b } = bodies();
    const hinge = new HingeJoint({
      bodyA: a,
      bodyB: b,
      anchor: new Vector3(0, 2, 0),
      axis: new Vector3(0, 0, 1),
      limits: { min: -Math.PI / 2, max: Math.PI / 2 },
      motor: { enabled: true, targetVelocity: 2, maxTorque: 50 },
    });
    const descriptor = hinge.toDescriptor(binding());
    expect(descriptor.type).toBe("revolute");
    expect(descriptor.limits).toEqual({ min: -Math.PI / 2, max: Math.PI / 2 });
    expect(descriptor.motor).toEqual({
      enabled: true,
      targetVelocity: 2,
      maxTorque: 50,
    });
    expect(hinge.type).toBe("revolute");
  });

  it("is the same class as RevoluteJoint (§28 names it twice)", () => {
    expect(RevoluteJoint).toBe(HingeJoint);
    const { a, b } = bodies();
    expect(new RevoluteJoint({ bodyA: a, bodyB: b })).toBeInstanceOf(
      HingeJoint,
    );
  });

  it("defaults its axis to +Z in 2d and to zero in 3d (§21)", () => {
    const { a, b } = bodies();
    const hinge = new HingeJoint({ bodyA: a, bodyB: b });
    const out = new Vector3();
    expect([...toTuple(hinge.worldAxis("2d", out))]).toEqual([0, 0, 1]);
    expect([...toTuple(hinge.worldAxis("3d", out))]).toEqual([0, 0, 0]);

    const authored = new HingeJoint({
      bodyA: a,
      bodyB: b,
      axis: new Vector3(0, 1, 0),
    });
    expect([...toTuple(authored.worldAxis("3d", out))]).toEqual([0, 1, 0]);
  });

  it("copies limits and motor, and hands out copies", () => {
    const { a, b } = bodies();
    const limits = { min: 0, max: 1 };
    const motor = { targetVelocity: 1, maxTorque: 2 };
    const hinge = new HingeJoint({ bodyA: a, bodyB: b, limits, motor });
    limits.max = 99;
    motor.maxTorque = 99;
    expect(hinge.limits).toEqual({ min: 0, max: 1 });
    // `enabled` defaults to true (§28's example enables it explicitly).
    expect(hinge.motor).toEqual({
      enabled: true,
      targetVelocity: 1,
      maxTorque: 2,
    });
    const read = hinge.limits;
    expect(read).not.toBe(hinge.limits);
  });

  it("has no limits or motor when none was authored", () => {
    const { a, b } = bodies();
    const hinge = new HingeJoint({ bodyA: a, bodyB: b });
    expect(hinge.limits).toBeUndefined();
    expect(hinge.motor).toBeUndefined();
    const descriptor = hinge.toDescriptor(binding());
    expect("limits" in descriptor).toBe(false);
    expect("motor" in descriptor).toBe(false);
  });

  it("queues a limit or motor change (§26's command rule, applied to §28)", () => {
    const { a, b } = bodies();
    const hinge = new HingeJoint({
      bodyA: a,
      bodyB: b,
      limits: { min: 0, max: 1 },
      motor: { targetVelocity: 1, maxTorque: 2 },
    });
    expect(hinge.commands.limitsDirty).toBe(false);

    hinge.setLimits(-1, 1);
    expect(hinge.limits).toEqual({ min: -1, max: 1 });
    expect(hinge.commands.limitsDirty).toBe(true);

    hinge.setMotor({ targetVelocity: 4, maxTorque: 8 });
    expect(hinge.commands.motorDirty).toBe(true);
    expect(hinge.motor?.targetVelocity).toBe(4);

    hinge.enableMotor(false);
    expect(hinge.motor?.enabled).toBe(false);
  });

  it("rejects inverted limits and a negative motor effort (§85)", () => {
    const { a, b } = bodies();
    const hinge = new HingeJoint({ bodyA: a, bodyB: b });
    expect(expectFourError(() => hinge.setLimits(1, -1)).message).toContain(
      "limits.min must be <=",
    );
    expect(
      expectFourError(() =>
        hinge.setMotor({ targetVelocity: 1, maxTorque: -1 }),
      ).message,
    ).toContain("motor.maxTorque must be >= 0");
    expect(expectFourError(() => hinge.enableMotor(true)).message).toContain(
      "needs a motor to enable",
    );
  });

  it("rejects limits or a motor added to a registered joint", () => {
    const { a, b } = bodies();
    const hinge = new HingeJoint({ bodyA: a, bodyB: b });
    pretendRegistered(hinge);
    expect(expectFourError(() => hinge.setLimits(0, 1)).message).toContain(
      "limits cannot be added",
    );
    expect(
      expectFourError(() => hinge.setMotor({ targetVelocity: 1, maxTorque: 1 }))
        .message,
    ).toContain("motor cannot be added");
  });

  it("allows reconfiguring limits and motor that already exist", () => {
    const { a, b } = bodies();
    const hinge = new HingeJoint({
      bodyA: a,
      bodyB: b,
      limits: { min: 0, max: 1 },
      motor: { targetVelocity: 1, maxTorque: 1 },
    });
    pretendRegistered(hinge);
    hinge.setLimits(0, 2);
    hinge.setMotor({ targetVelocity: 3, maxTorque: 4 });
    expect(hinge.limits).toEqual({ min: 0, max: 2 });
    expect(hinge.motor?.maxTorque).toBe(4);
  });

  it("queues a collisionEnabled change once registered (§28, PH-22f)", () => {
    const { a, b } = bodies();
    const hinge = new HingeJoint({ bodyA: a, bodyB: b });
    hinge.collisionEnabled = true;
    // Unregistered, the write is immediate and queues nothing to drain.
    expect(hinge.commands.collisionDirty).toBe(false);

    pretendRegistered(hinge);
    hinge.collisionEnabled = false;
    expect(hinge.collisionEnabled).toBe(false);
    expect(hinge.commands.collisionDirty).toBe(true);
  });

  it("queues nothing when collisionEnabled is set to what it already is", () => {
    const { a, b } = bodies();
    const hinge = new HingeJoint({
      bodyA: a,
      bodyB: b,
      collisionEnabled: true,
    });
    pretendRegistered(hinge);
    hinge.collisionEnabled = true;
    expect(hinge.commands.collisionDirty).toBe(false);
  });

  it("treats setAnchors as body-local and queues once registered (PH-22f)", () => {
    const { a, b } = bodies();
    const hinge = new HingeJoint({
      bodyA: a,
      bodyB: b,
      anchor: new Vector3(1, 2, 0),
    });
    expect(hinge.anchorsAreLocal).toBe(false);
    hinge.setAnchors(new Vector3(0.5, 0, 0), new Vector2(0, 0.25));
    // Unregistered: the write is immediate and queues nothing.
    expect(hinge.anchorsAreLocal).toBe(true);
    expect(hinge.commands.anchorsDirty).toBe(false);
    expect([hinge.anchorA?.x, hinge.anchorA?.y, hinge.anchorA?.z]).toEqual([
      0.5, 0, 0,
    ]);
    expect([hinge.anchorB?.x, hinge.anchorB?.y, hinge.anchorB?.z]).toEqual([
      0, 0.25, 0,
    ]);

    pretendRegistered(hinge);
    hinge.setAnchors(new Vector3(1, 0, 0), new Vector3(0, 1, 0));
    expect(hinge.commands.anchorsDirty).toBe(true);
    expect(hinge.anchorA?.x).toBe(1);
    expect(hinge.anchorB?.y).toBe(1);
  });

  it("queues nothing when setAnchors repeats the stored local frames", () => {
    const { a, b } = bodies();
    const joint = new FixedJoint({ bodyA: a, bodyB: b });
    pretendRegistered(joint);
    joint.setAnchors(new Vector3(1, 0, 0), undefined);
    expect(joint.commands.anchorsDirty).toBe(true);
    (joint.commands as { anchorsDirty: boolean }).anchorsDirty = false;
    joint.setAnchors(new Vector3(1, 0, 0), undefined);
    expect(joint.commands.anchorsDirty).toBe(false);
    // Omitted and the origin are the same frame.
    joint.setAnchors(new Vector3(1, 0, 0), new Vector3(0, 0, 0));
    expect(joint.commands.anchorsDirty).toBe(false);
  });

  it("field-sets anchors through setAnchors (PH-22f)", () => {
    const { a, b } = bodies();
    const joint = new FixedJoint({ bodyA: a, bodyB: b });
    pretendRegistered(joint);
    joint.anchorA = new Vector3(2, 0, 0);
    joint.anchorB = new Vector3(0, 3, 0);
    expect(joint.anchorsAreLocal).toBe(true);
    expect(joint.commands.anchorsDirty).toBe(true);
    expect(joint.anchorA?.x).toBe(2);
    expect(joint.anchorB?.y).toBe(3);
  });

  it("rejects a non-finite live anchor (§85)", () => {
    const { a, b } = bodies();
    const joint = new FixedJoint({ bodyA: a, bodyB: b });
    expect(
      expectFourError(() =>
        joint.setAnchors(
          new Vector3(Number.POSITIVE_INFINITY, 0, 0),
          undefined,
        ),
      ).message,
    ).toContain("anchorA must be finite");
  });
});

describe("SliderJoint (§28)", () => {
  it("is the same class as PrismaticJoint and needs an axis", () => {
    expect(PrismaticJoint).toBe(SliderJoint);
    const { a, b } = bodies();
    expect(
      expectFourError(
        () =>
          new SliderJoint({
            bodyA: a,
            bodyB: b,
            axis: undefined as unknown as Vector3,
          }),
      ).message,
    ).toContain("axis is required");
  });

  it("describes itself with the binding's local axis", () => {
    const { a, b } = bodies();
    const slider = new SliderJoint({
      bodyA: a,
      bodyB: b,
      axis: new Vector3(1, 0, 0),
      limits: { min: -1, max: 1 },
      motor: { targetVelocity: 0.5, maxForce: 20 },
    });
    const axis = new Vector3(1, 0, 0);
    const descriptor = slider.toDescriptor(binding({ axis }));
    expect(descriptor.type).toBe("prismatic");
    expect(descriptor.axis).toBe(axis);
    expect(descriptor.limits).toEqual({ min: -1, max: 1 });
    expect(descriptor.motor).toEqual({
      enabled: true,
      targetVelocity: 0.5,
      maxForce: 20,
    });
    const out = new Vector3();
    expect([...toTuple(slider.worldAxis("2d", out))]).toEqual([1, 0, 0]);
  });

  it("queues limit and motor changes and rejects additions once registered", () => {
    const { a, b } = bodies();
    const slider = new SliderJoint({
      bodyA: a,
      bodyB: b,
      axis: new Vector3(1, 0, 0),
    });
    expect(slider.limits).toBeUndefined();
    expect(slider.motor).toBeUndefined();
    slider.setLimits(0, 2);
    expect(slider.limits).toEqual({ min: 0, max: 2 });
    slider.setMotor({ targetVelocity: 1, maxForce: 5 });
    expect(slider.commands).toEqual({
      limitsDirty: true,
      motorDirty: true,
      collisionDirty: false,
      anchorsDirty: false,
    });
    slider.enableMotor(false);
    expect(slider.motor?.enabled).toBe(false);

    const bare = new SliderJoint({
      bodyA: a,
      bodyB: b,
      axis: new Vector3(1, 0, 0),
    });
    pretendRegistered(bare);
    expect(expectFourError(() => bare.setLimits(0, 1)).message).toContain(
      "limits cannot be added",
    );
    expect(
      expectFourError(() => bare.setMotor({ targetVelocity: 1, maxForce: 1 }))
        .message,
    ).toContain("motor cannot be added");
    expect(expectFourError(() => bare.enableMotor(true)).message).toContain(
      "needs a motor to enable",
    );
  });

  it("validates its limits and motor (§85)", () => {
    const { a, b } = bodies();
    expect(
      expectFourError(
        () =>
          new SliderJoint({
            bodyA: a,
            bodyB: b,
            axis: new Vector3(1, 0, 0),
            limits: { min: 2, max: 1 },
          }),
      ).message,
    ).toContain("limits.min must be <=");
    expect(
      expectFourError(
        () =>
          new SliderJoint({
            bodyA: a,
            bodyB: b,
            axis: new Vector3(1, 0, 0),
            motor: { targetVelocity: Number.NaN, maxForce: 1 },
          }),
      ).message,
    ).toContain("motor.targetVelocity");
  });
});

describe("RopeJoint and SpringJoint (§28)", () => {
  it("describes a rope by its maximum length", () => {
    const { a, b } = bodies();
    const rope = new RopeJoint({ bodyA: a, bodyB: b, maxLength: 3 });
    expect(rope.maxLength).toBe(3);
    expect(rope.toDescriptor(binding())).toMatchObject({
      type: "rope",
      maxLength: 3,
    });
  });

  it("rejects a non-positive rope length (§85)", () => {
    const { a, b } = bodies();
    expect(
      expectFourError(() => new RopeJoint({ bodyA: a, bodyB: b, maxLength: 0 }))
        .message,
    ).toContain("maxLength must be a finite positive number");
  });

  it("describes a spring by rest length, stiffness, and damping", () => {
    const { a, b } = bodies();
    const spring = new SpringJoint({
      bodyA: a,
      bodyB: b,
      restLength: 1,
      stiffness: 100,
      damping: 5,
    });
    expect(spring.toDescriptor(binding())).toMatchObject({
      type: "spring",
      restLength: 1,
      stiffness: 100,
      damping: 5,
    });
    const undamped = new SpringJoint({
      bodyA: a,
      bodyB: b,
      restLength: 0,
      stiffness: 1,
    });
    expect(undamped.damping).toBe(0);
  });

  it.each([
    ["restLength", { restLength: -1, stiffness: 1 }],
    ["stiffness", { restLength: 0, stiffness: 0 }],
    ["damping", { restLength: 0, stiffness: 1, damping: -1 }],
  ])("rejects an impossible spring %s (§85)", (field, options) => {
    const { a, b } = bodies();
    expect(
      expectFourError(() => new SpringJoint({ bodyA: a, bodyB: b, ...options }))
        .message,
    ).toContain(field);
  });
});

describe("SphericalJoint (§28, 3d only)", () => {
  it("is the same class as BallJoint and defaults its axis to +Y (§7a)", () => {
    expect(BallJoint).toBe(SphericalJoint);
    const { a, b } = bodies();
    const ball = new SphericalJoint({ bodyA: a, bodyB: b });
    const out = new Vector3();
    expect([...toTuple(ball.worldAxis("3d", out))]).toEqual([0, 1, 0]);
    const tilted = new SphericalJoint({
      bodyA: a,
      bodyB: b,
      axis: new Vector3(1, 0, 0),
    });
    expect([...toTuple(tilted.worldAxis("3d", out))]).toEqual([1, 0, 0]);
  });

  it("carries a swing cone and an optional twist, copied", () => {
    const { a, b } = bodies();
    const limits = { coneAngle: 0.5, twist: { min: -1, max: 1 } };
    const ball = new SphericalJoint({ bodyA: a, bodyB: b, limits });
    limits.coneAngle = 99;
    limits.twist.max = 99;
    expect(ball.limits).toEqual({
      coneAngle: 0.5,
      twist: { min: -1, max: 1 },
    });
    const descriptor = ball.toDescriptor(binding());
    expect(descriptor.limits).toEqual({
      coneAngle: 0.5,
      twist: { min: -1, max: 1 },
    });
    expect(descriptor.limits).not.toBe(ball.limits);
  });

  it("omits limits when the ball rotates freely", () => {
    const { a, b } = bodies();
    const descriptor = new SphericalJoint({ bodyA: a, bodyB: b }).toDescriptor(
      binding(),
    );
    expect("limits" in descriptor).toBe(false);
  });

  it.each([0, -1, Math.PI + 0.1, Number.NaN])(
    "rejects a cone half-angle of %s (§85)",
    (coneAngle) => {
      const { a, b } = bodies();
      expect(
        expectFourError(
          () =>
            new SphericalJoint({ bodyA: a, bodyB: b, limits: { coneAngle } }),
        ).message,
      ).toContain("coneAngle");
    },
  );
});

describe("validateJointDescriptor — the type tier (§28, plan P6-1)", () => {
  const base = { bodyA: HANDLE_A, bodyB: HANDLE_B };

  it.each(["distance", "gear"])("rejects the staged type %s", (type) => {
    const error = expectFourError(() => {
      validateJointDescriptor(
        { ...base, type } as unknown as JointDescriptor,
        "3d",
      );
    });
    expect(error.message).toContain("staged");
    expect(error.message).toContain("P6-1");
  });

  it("points a motorized joint at the motor field", () => {
    expect(
      expectFourError(() => {
        validateJointDescriptor(
          { ...base, type: "motorized" } as unknown as JointDescriptor,
          "3d",
        );
      }).message,
    ).toContain("not a type of its own");
  });

  it("rejects a type §28 never named", () => {
    expect(
      expectFourError(() => {
        validateJointDescriptor(
          { ...base, type: "wormhole" } as unknown as JointDescriptor,
          "3d",
        );
      }).message,
    ).toContain("Unknown joint type");
  });

  it('rejects a spherical joint in a "2d" world (§21)', () => {
    expect(
      expectFourError(() => {
        validateJointDescriptor({ ...base, type: "spherical" }, "2d");
      }).message,
    ).toContain('not valid in a "2d" world');
  });

  it("still rejects a joint from a body to itself", () => {
    expect(
      expectFourError(() => {
        validateJointDescriptor(
          { type: "fixed", bodyA: HANDLE_A, bodyB: HANDLE_A },
          "3d",
        );
      }).message,
    ).toContain("two different bodies");
  });

  it("applies the §21 plane rule to the anchors and the thresholds", () => {
    expect(
      expectFourError(() => {
        validateJointDescriptor(
          { ...base, type: "fixed", anchorA: new Vector3(0, 0, 1) },
          "2d",
        );
      }).message,
    ).toContain("anchorA");
    expect(
      expectFourError(() => {
        validateJointDescriptor(
          { ...base, type: "fixed", anchorB: new Vector3(0, 0, 1) },
          "2d",
        );
      }).message,
    ).toContain("anchorB");
    expect(
      expectFourError(() => {
        validateJointDescriptor(
          { ...base, type: "fixed", breakForce: -1 },
          "3d",
        );
      }).message,
    ).toContain("breakForce");
    expect(
      expectFourError(() => {
        validateJointDescriptor(
          { ...base, type: "fixed", breakTorque: 0 },
          "3d",
        );
      }).message,
    ).toContain("breakTorque");
  });
});

describe("validateJointDescriptor — axes (§21, §28)", () => {
  const base = { bodyA: HANDLE_A, bodyB: HANDLE_B };

  it('requires a hinge axis in "3d" and defaults it in "2d"', () => {
    expect(
      expectFourError(() => {
        validateJointDescriptor({ ...base, type: "revolute" }, "3d");
      }).message,
    ).toContain("must name the axis it turns about");
    expect(() => {
      validateJointDescriptor({ ...base, type: "revolute" }, "2d");
    }).not.toThrow();
  });

  it('makes a "2d" hinge axis ±Z and a "2d" slider axis planar', () => {
    expect(() => {
      validateJointDescriptor(
        { ...base, type: "revolute", axis: new Vector3(0, 0, -1) },
        "2d",
      );
    }).not.toThrow();
    expect(
      expectFourError(() => {
        validateJointDescriptor(
          { ...base, type: "revolute", axis: new Vector3(0, 1, 0) },
          "2d",
        );
      }).message,
    ).toContain("must be along ±Z");
    expect(
      expectFourError(() => {
        validateJointDescriptor(
          { ...base, type: "revolute", axis: new Vector2(1, 0) },
          "2d",
        );
      }).message,
    ).toContain("must be along ±Z");

    expect(() => {
      validateJointDescriptor(
        { ...base, type: "prismatic", axis: new Vector2(1, 0) },
        "2d",
      );
    }).not.toThrow();
    expect(
      expectFourError(() => {
        validateJointDescriptor(
          { ...base, type: "prismatic", axis: new Vector3(0, 0, 1) },
          "2d",
        );
      }).message,
    ).toContain("must be a non-zero direction with z = 0");
    expect(
      expectFourError(() => {
        validateJointDescriptor(
          { ...base, type: "prismatic", axis: new Vector2(0, 0) },
          "2d",
        );
      }).message,
    ).toContain("must be a non-zero direction with z = 0");
  });

  it('rejects a zero axis in "3d", naming the hinge that never got one', () => {
    expect(
      expectFourError(() => {
        validateJointDescriptor(
          { ...base, type: "revolute", axis: new Vector3(0, 0, 0) },
          "3d",
        );
      }).message,
    ).toContain("must be a non-zero direction");
    expect(
      expectFourError(() => {
        validateJointDescriptor(
          { ...base, type: "prismatic", axis: new Vector3(0, 0, 0) },
          "3d",
        );
      }).message,
    ).toContain("must be a non-zero direction");
  });

  it("rejects a non-finite axis component (§85)", () => {
    expect(
      expectFourError(() => {
        validateJointDescriptor(
          {
            ...base,
            type: "prismatic",
            axis: new Vector3(Number.POSITIVE_INFINITY, 0, 0),
          },
          "3d",
        );
      }).message,
    ).toContain("axis.x");
  });

  it("checks a spherical joint's optional axis and cone", () => {
    expect(
      expectFourError(() => {
        validateJointDescriptor(
          { ...base, type: "spherical", axis: new Vector3(0, 0, 0) },
          "3d",
        );
      }).message,
    ).toContain("must be a non-zero direction");
    expect(
      expectFourError(() => {
        validateJointDescriptor(
          { ...base, type: "spherical", limits: { coneAngle: 4 } },
          "3d",
        );
      }).message,
    ).toContain("coneAngle");
    expect(() => {
      validateJointDescriptor(
        {
          ...base,
          type: "spherical",
          axis: new Vector3(0, 1, 0),
          limits: { coneAngle: 0.4, twist: { min: -1, max: 1 } },
        },
        "3d",
      );
    }).not.toThrow();
  });
});

describe("validateJointDescriptor — parameters (§28, §85)", () => {
  const base = { bodyA: HANDLE_A, bodyB: HANDLE_B };

  it("checks a hinge's limits and motor", () => {
    expect(
      expectFourError(() => {
        validateJointDescriptor(
          { ...base, type: "revolute", limits: { min: 1, max: 0 } },
          "2d",
        );
      }).message,
    ).toContain("limits.min must be <=");
    expect(
      expectFourError(() => {
        validateJointDescriptor(
          {
            ...base,
            type: "revolute",
            motor: { targetVelocity: 1, maxTorque: -1 },
          },
          "2d",
        );
      }).message,
    ).toContain("motor.maxTorque");
  });

  it("checks a slider's limits and motor", () => {
    const axis = new Vector2(1, 0);
    expect(
      expectFourError(() => {
        validateJointDescriptor(
          { ...base, type: "prismatic", axis, limits: { min: 1, max: 0 } },
          "2d",
        );
      }).message,
    ).toContain("limits.min must be <=");
    expect(
      expectFourError(() => {
        validateJointDescriptor(
          {
            ...base,
            type: "prismatic",
            axis,
            motor: { targetVelocity: 1, maxForce: Number.NaN },
          },
          "2d",
        );
      }).message,
    ).toContain("motor.maxForce");
  });

  it("checks rope and spring parameters", () => {
    expect(
      expectFourError(() => {
        validateJointDescriptor({ ...base, type: "rope", maxLength: 0 }, "2d");
      }).message,
    ).toContain("maxLength must be > 0");
    expect(
      expectFourError(() => {
        validateJointDescriptor(
          { ...base, type: "spring", restLength: -1, stiffness: 1 },
          "2d",
        );
      }).message,
    ).toContain("restLength must be >= 0");
    expect(
      expectFourError(() => {
        validateJointDescriptor(
          { ...base, type: "spring", restLength: 0, stiffness: 0 },
          "2d",
        );
      }).message,
    ).toContain("stiffness must be > 0");
    expect(
      expectFourError(() => {
        validateJointDescriptor(
          { ...base, type: "spring", restLength: 0, stiffness: 1, damping: -1 },
          "2d",
        );
      }).message,
    ).toContain("damping must be >= 0");
    expect(() => {
      validateJointDescriptor(
        { ...base, type: "spring", restLength: 1, stiffness: 2, damping: 0 },
        "3d",
      );
    }).not.toThrow();
  });

  it("accepts a fully specified joint in each shipped type", () => {
    const cases: readonly [JointDescriptor, PhysicsDimension][] = [
      [{ ...base, type: "fixed" }, "2d"],
      [{ ...base, type: "revolute", axis: new Vector3(0, 0, 1) }, "2d"],
      [{ ...base, type: "prismatic", axis: new Vector3(1, 0, 0) }, "2d"],
      [{ ...base, type: "rope", maxLength: 2 }, "2d"],
      [{ ...base, type: "spring", restLength: 1, stiffness: 3 }, "2d"],
      [{ ...base, type: "spherical" }, "3d"],
    ];
    for (const [descriptor, dimension] of cases) {
      expect(() => {
        validateJointDescriptor(descriptor, dimension);
      }).not.toThrow();
    }
  });
});

describe("the standalone joint validators (§28, §85)", () => {
  it("states each rule once, for the classes and the descriptors alike", () => {
    expect(() => {
      validateJointLimits("limits", { min: -1, max: 1 });
    }).not.toThrow();
    expect(
      expectFourError(() => {
        validateJointLimits("limits", { min: Number.NaN, max: 1 });
      }).message,
    ).toContain("limits.min");
    expect(
      expectFourError(() => {
        validateJointLimits("limits", { min: 0, max: Number.NaN });
      }).message,
    ).toContain("limits.max");

    expect(() => {
      validateAngularJointMotor("motor", { targetVelocity: 1, maxTorque: 0 });
    }).not.toThrow();
    expect(() => {
      validateLinearJointMotor("motor", { targetVelocity: 1, maxForce: 0 });
    }).not.toThrow();
    expect(() => {
      validateSphericalJointLimits("limits", { coneAngle: Math.PI });
    }).not.toThrow();
    expect(
      expectFourError(() => {
        validateSphericalJointLimits("limits", {
          coneAngle: 1,
          twist: { min: 1, max: 0 },
        });
      }).message,
    ).toContain("limits.twist.min");
    expect(
      expectFourError(() => {
        validateJointBreakThreshold("breakForce", Number.NaN);
      }).message,
    ).toContain("breakForce");
  });
});

/** The three components of a vector, for an exact tuple comparison. */
function toTuple(v: Vector3): [number, number, number] {
  return [v.x, v.y, v.z];
}

/**
 * Puts a joint in the state a world would leave it in, without a world.
 *
 * `bindJoint` is package-internal and outside the barrel (nothing but a
 * `PhysicsWorld` may claim a joint), so the registration-only rules are
 * exercised here through the same private field the world writes.
 * `world-joints.test.ts` covers the real path.
 */
function pretendRegistered(joint: object): void {
  (joint as { id: number | undefined }).id = 1;
}

describe("Joint disposal (§83 stability audit, 2026-09-11)", () => {
  it("disposes idempotently and refuses registration afterwards", () => {
    const { a, b } = bodies();
    const joint = new HingeJoint({
      bodyA: a,
      bodyB: b,
      axis: new Vector3(0, 0, 1),
    });
    expect(joint.disposed).toBe(false);
    expect(joint.toDescriptor(binding()).type).toBe("revolute");

    joint.dispose();
    expect(joint.disposed).toBe(true);
    // A second dispose is a no-op (§83: idempotent), not an error.
    expect(() => joint.dispose()).not.toThrow();
    expect(joint.disposed).toBe(true);

    // Disposal is terminal (§83): every shipped joint's `toDescriptor` runs
    // through `describeBase`, which is what `world.addJoint` builds from, so
    // registering a disposed joint refuses with §89's INVALID_APPLICATION_STATE.
    const error = expectFourError(() => joint.toDescriptor(binding()));
    expect(error.code).toBe("INVALID_APPLICATION_STATE");
    expect(error.message).toMatch(/revolute joint is disposed.*§83/s);
    // Plain reads stay answerable for teardown code.
    expect(joint.registered).toBe(false);
    expect(joint.bodyA).toBe(a);
  });
});
