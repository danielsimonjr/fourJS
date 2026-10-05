/**
 * §12's character controllers and §44's first-person look (PH-11 residue,
 * 2026-08-21).
 *
 * Covers the component surfaces, the §85 refusals at authoring, the counted
 * transient mid-step, the §42 gating `KinematicSystem` applies to all three of
 * its components, and the §79 serializers.
 */

import { Vector3 } from "@fourjs/math";
import { Group } from "@fourjs/scene";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  CHARACTER_CONTROLLER_SERIALIZER,
  CharacterController,
  DEFAULT_CHARACTER_GRAVITY,
  DEFAULT_FIRST_PERSON_PITCH_LIMIT,
  FIRST_PERSON_LOOK_SERIALIZER,
  FirstPersonLook,
  KinematicController,
  KinematicSystem,
  PRIORITY_KINEMATICS,
  SystemRegistry,
  createTimeState,
} from "../src/index.js";

/** The fixed step every test uses, in seconds (§7a). */
const DT = 1 / 60;

/** A node with a controller on it, under `"kinematic"` authority (§42). */
function makeCharacter(
  options: ConstructorParameters<typeof CharacterController>[0] = {},
): { node: Group; character: CharacterController } {
  const node = new Group();
  node.transformAuthority = "kinematic";
  const character = node.addComponent(new CharacterController(options));
  return { node, character };
}

describe("CharacterController: authoring refusals (§85)", () => {
  test("every non-finite option is refused", () => {
    expect(() => new CharacterController({ yaw: Number.NaN })).toThrow(
      RangeError,
    );
    expect(
      () => new CharacterController({ gravity: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
    expect(() => new CharacterController({ groundHeight: Number.NaN })).toThrow(
      RangeError,
    );
    expect(
      () => new CharacterController({ verticalVelocity: Number.NaN }),
    ).toThrow(RangeError);
  });

  test("negative speeds are refused, zero is not", () => {
    expect(() => new CharacterController({ moveSpeed: -1 })).toThrow(
      RangeError,
    );
    expect(() => new CharacterController({ jumpSpeed: -1 })).toThrow(
      RangeError,
    );
    expect(() => new CharacterController({ maxFallSpeed: -1 })).toThrow(
      RangeError,
    );
    expect(() => new CharacterController({ maxFallSpeed: Number.NaN })).toThrow(
      RangeError,
    );
    expect(new CharacterController({ moveSpeed: 0 }).moveSpeed).toBe(0);
    expect(new CharacterController({ jumpSpeed: 0 }).jumpSpeed).toBe(0);
    // Infinity is the honest spelling of "no terminal velocity".
    expect(new CharacterController().maxFallSpeed).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  test("the setters refuse what the constructor refuses", () => {
    const character = new CharacterController();
    expect(() => {
      character.yaw = Number.NaN;
    }).toThrow(RangeError);
    expect(() => {
      character.moveSpeed = -1;
    }).toThrow(RangeError);
    expect(() => {
      character.gravity = Number.NaN;
    }).toThrow(RangeError);
    expect(() => {
      character.jumpSpeed = -1;
    }).toThrow(RangeError);
    expect(() => {
      character.setMoveIntent(Number.NaN, 0);
    }).toThrow(RangeError);
    expect(() => {
      character.setMoveIntent(0, Number.NaN);
    }).toThrow(RangeError);
  });

  test("defaults are Appendix A's gravity and a metre-per-second walk", () => {
    const character = new CharacterController();
    expect(character.gravity).toBe(DEFAULT_CHARACTER_GRAVITY);
    expect(character.moveSpeed).toBe(1);
    expect(character.groundHeight).toBe(0);
    expect(character.yaw).toBe(0);
    expect(character.grounded).toBe(false);
    expect(character.verticalVelocity).toBe(0);
    expect(character.skippedSteps).toBe(0);
  });
});

describe("CharacterController: intent (§12)", () => {
  test("a magnitude above 1 is scaled back to the unit disc", () => {
    const character = new CharacterController();
    character.setMoveIntent(1, 1);
    const expected = 1 / Math.sqrt(2);
    expect(character.intentForward).toBeCloseTo(expected, 15);
    expect(character.intentRight).toBeCloseTo(expected, 15);
    expect(
      Math.sqrt(character.intentForward ** 2 + character.intentRight ** 2),
    ).toBeCloseTo(1, 15);
  });

  test("a magnitude at or below 1 is kept exactly", () => {
    const character = new CharacterController();
    character.setMoveIntent(0.5, -0.25);
    expect(character.intentForward).toBe(0.5);
    expect(character.intentRight).toBe(-0.25);
    character.setMoveIntent(1, 0);
    expect(character.intentForward).toBe(1);
  });

  test("intent persists until it is replaced, and `stop` clears it", () => {
    const character = new CharacterController();
    character.setMoveIntent(1, 0);
    character.stop();
    expect(character.intentForward).toBe(0);
    expect(character.intentRight).toBe(0);
  });
});

describe("CharacterController: heading and locomotion", () => {
  test("yaw 0 walks along −Z, the node's forward (§44/R-36)", () => {
    const { node, character } = makeCharacter({
      moveSpeed: 3,
      gravity: 0,
      grounded: true,
    });
    character.setMoveIntent(1, 0);
    character.step(node.transform, DT);
    expect(node.transform.position.x).toBeCloseTo(0, 15);
    expect(node.transform.position.z).toBeCloseTo(-3 * DT, 15);
  });

  test("a quarter turn walks along −X, and right is +X", () => {
    const { node, character } = makeCharacter({
      moveSpeed: 2,
      gravity: 0,
      grounded: true,
      yaw: Math.PI / 2,
    });
    character.setMoveIntent(1, 0);
    character.step(node.transform, DT);
    expect(node.transform.position.x).toBeCloseTo(-2 * DT, 12);
    expect(node.transform.position.z).toBeCloseTo(0, 12);

    const strafe = makeCharacter({ moveSpeed: 2, gravity: 0, grounded: true });
    strafe.character.setMoveIntent(0, 1);
    strafe.character.step(strafe.node.transform, DT);
    expect(strafe.node.transform.position.x).toBeCloseTo(2 * DT, 15);
  });

  test("the rotation written is yaw-only: no pitch, no roll", () => {
    const { node, character } = makeCharacter({ grounded: true, yaw: 0.7 });
    character.step(node.transform, DT);
    const r = node.transform.rotation;
    expect(r.x).toBe(0);
    expect(r.z).toBe(0);
    expect(r.y).toBeCloseTo(Math.sin(0.35), 15);
    expect(r.w).toBeCloseTo(Math.cos(0.35), 15);
  });

  test("`turn` accumulates without wrapping and marks the heading dirty", () => {
    const { node, character } = makeCharacter({ grounded: true });
    character.step(node.transform, DT);
    expect(character.active).toBe(false);
    character.turn(7);
    expect(character.yaw).toBe(7);
    expect(character.active).toBe(true);
    expect(() => {
      character.turn(Number.NaN);
    }).toThrow(RangeError);
  });
});

describe("CharacterController: gravity, ground and jumping", () => {
  test("a character above the plane falls and lands on it", () => {
    const { node, character } = makeCharacter();
    node.transform.position.set(0, 1, 0);
    let steps = 0;
    while (!character.grounded && steps < 1000) {
      character.step(node.transform, DT);
      steps += 1;
    }
    expect(character.grounded).toBe(true);
    expect(node.transform.position.y).toBe(0);
    expect(character.verticalVelocity).toBe(0);
    // ~0.45 s of free fall from 1 m, so the landing is physical, not a snap.
    expect(steps).toBeGreaterThan(20);
  });

  test("a grounded character does not integrate gravity at all", () => {
    const { node, character } = makeCharacter({ grounded: true });
    character.setMoveIntent(1, 0);
    character.step(node.transform, DT);
    expect(character.verticalVelocity).toBe(0);
    expect(node.transform.position.y).toBe(0);
  });

  test("`maxFallSpeed` is a terminal velocity", () => {
    const { node, character } = makeCharacter({ maxFallSpeed: 2 });
    node.transform.position.set(0, 100, 0);
    for (let i = 0; i < 120; i += 1) {
      character.step(node.transform, DT);
    }
    expect(character.verticalVelocity).toBe(-2);
    expect(character.grounded).toBe(false);
  });

  test("jumping needs the ground and a jump speed", () => {
    const { node, character } = makeCharacter({ jumpSpeed: 5 });
    expect(character.jump()).toBe(false); // airborne at construction
    character.ground();
    expect(character.grounded).toBe(true);
    expect(character.jump()).toBe(true);
    expect(character.verticalVelocity).toBe(5);
    expect(character.grounded).toBe(false);
    expect(character.jump()).toBe(false); // already in the air

    const cannot = new CharacterController({ jumpSpeed: 0, grounded: true });
    expect(cannot.jump()).toBe(false);
    expect(cannot.verticalVelocity).toBe(0);
    expect(node.transform.position.y).toBe(0);
  });

  test("a jump rises, falls, and lands back on the plane", () => {
    const { node, character } = makeCharacter({
      jumpSpeed: 4,
      grounded: true,
    });
    character.jump();
    let peak = 0;
    for (let i = 0; i < 200 && !character.grounded; i += 1) {
      character.step(node.transform, DT);
      peak = Math.max(peak, node.transform.position.y);
    }
    // v²/2g ≈ 0.815 m for 4 m/s under −9.81; a discrete integrator is close.
    expect(peak).toBeGreaterThan(0.7);
    expect(peak).toBeLessThan(0.9);
    expect(character.grounded).toBe(true);
    expect(node.transform.position.y).toBe(0);
  });

  test("`groundHeight` moves the plane", () => {
    const { node, character } = makeCharacter({ groundHeight: 3 });
    node.transform.position.set(0, 4, 0);
    for (let i = 0; i < 200 && !character.grounded; i += 1) {
      character.step(node.transform, DT);
    }
    expect(node.transform.position.y).toBe(3);
  });

  test("with zero gravity a character above the plane hovers, ungrounded", () => {
    const { node, character } = makeCharacter({ gravity: 0 });
    node.transform.position.set(0, 2, 0);
    for (let i = 0; i < 10; i += 1) {
      character.step(node.transform, DT);
    }
    expect(node.transform.position.y).toBe(2);
    expect(character.grounded).toBe(false);
    expect(character.jump()).toBe(false);
  });
});

describe("CharacterController: the counted transient (§61/§85)", () => {
  test("a non-finite pose is refused, counted, and leaves the transform alone", () => {
    const { node, character } = makeCharacter({ grounded: true });
    node.transform.position.set(Number.NaN, 0, 0);
    character.setMoveIntent(1, 0);
    expect(character.step(node.transform, DT)).toBe(false);
    expect(character.skippedSteps).toBe(1);
    expect(Number.isNaN(node.transform.position.x)).toBe(true);
    // Nothing was accrued: state is exactly where it was.
    expect(character.verticalVelocity).toBe(0);
    expect(character.grounded).toBe(true);
  });
});

describe("CharacterController: the write gate", () => {
  test("a grounded, still, unturned character is idle", () => {
    const { node, character } = makeCharacter({ grounded: true });
    expect(character.active).toBe(true); // the initial heading write
    character.step(node.transform, DT);
    expect(character.active).toBe(false);
    character.setMoveIntent(0.1, 0);
    expect(character.active).toBe(true);
    character.stop();
    expect(character.active).toBe(false);
    character.setMoveIntent(0, 0.1);
    expect(character.active).toBe(true);
    character.stop();
    character.jump();
    expect(character.active).toBe(true); // airborne
  });
});

describe("FirstPersonLook (§44)", () => {
  test("limits are refused when inverted, and default to the pole guard", () => {
    expect(() => new FirstPersonLook({ minPitch: 1, maxPitch: 0 })).toThrow(
      RangeError,
    );
    expect(() => new FirstPersonLook({ minPitch: Number.NaN })).toThrow(
      RangeError,
    );
    expect(() => new FirstPersonLook({ maxPitch: Number.NaN })).toThrow(
      RangeError,
    );
    expect(() => new FirstPersonLook({ pitch: Number.NaN })).toThrow(
      RangeError,
    );
    const look = new FirstPersonLook();
    expect(look.maxPitch).toBe(DEFAULT_FIRST_PERSON_PITCH_LIMIT);
    expect(look.minPitch).toBe(-DEFAULT_FIRST_PERSON_PITCH_LIMIT);
    expect(DEFAULT_FIRST_PERSON_PITCH_LIMIT).toBeLessThan(Math.PI / 2);
  });

  test("pitch clamps on assignment and counts the clamp", () => {
    const look = new FirstPersonLook({ minPitch: -0.5, maxPitch: 0.5 });
    look.look(2);
    expect(look.pitch).toBe(0.5);
    expect(look.pitchLimitHits).toBe(1);
    look.look(-4);
    expect(look.pitch).toBe(-0.5);
    expect(look.pitchLimitHits).toBe(2);
    look.pitch = 0.25;
    expect(look.pitchLimitHits).toBe(2);
    expect(() => {
      look.look(Number.NaN);
    }).toThrow(RangeError);
  });

  test("a construction clamp is state, not user error", () => {
    const look = new FirstPersonLook({
      pitch: 9,
      minPitch: -0.2,
      maxPitch: 0.2,
    });
    expect(look.pitch).toBe(0.2);
    expect(look.pitchLimitHits).toBe(0);
  });

  test("the step writes a pitch-only rotation, and positive pitch looks up", () => {
    const node = new Group();
    const look = node.addComponent(new FirstPersonLook({ pitch: 0.4 }));
    expect(look.active).toBe(true);
    expect(look.step(node.transform)).toBe(true);
    expect(look.active).toBe(false);
    const r = node.transform.rotation;
    expect(r.y).toBe(0);
    expect(r.z).toBe(0);
    expect(r.x).toBeCloseTo(Math.sin(0.2), 15);
    expect(r.w).toBeCloseTo(Math.cos(0.2), 15);

    // −Z rotated about +X by +p is (0, sin p, −cos p): up.
    const forward = node.getWorldDirection(new Vector3());
    expect(forward.y).toBeCloseTo(Math.sin(0.4), 12);
    expect(forward.z).toBeCloseTo(-Math.cos(0.4), 12);
    look.look(0.1);
    expect(look.active).toBe(true);
  });
});

describe("KinematicSystem drives all three components (§39 step 4, §42)", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  /** Steps `registry` once with a fresh injected time record (§33). */
  function stepOnce(registry: SystemRegistry, step: number): void {
    const time = createTimeState({ fixedDeltaTime: DT });
    time.simulationStep = step;
    time.simulationTime = step * DT;
    registry.runFixedStep(time);
  }

  test("a character and its eye are advanced under one authority", () => {
    const system = new KinematicSystem();
    expect(system.priority).toBe(PRIORITY_KINEMATICS);
    const registry = new SystemRegistry();
    registry.register(system);

    const { node, character } = makeCharacter({
      moveSpeed: 2,
      gravity: 0,
      grounded: true,
    });
    const eye = new Group();
    eye.transformAuthority = "kinematic";
    const look = eye.addComponent(new FirstPersonLook());
    node.add(eye);
    system.track(node);
    system.track(eye);

    character.setMoveIntent(1, 0);
    character.turn(0.3);
    look.look(-0.2);
    stepOnce(registry, 1);

    expect(node.transform.position.z).toBeLessThan(0);
    expect(node.transform.rotation.y).toBeCloseTo(Math.sin(0.15), 15);
    expect(eye.transform.rotation.x).toBeCloseTo(Math.sin(-0.1), 15);
    expect(warn).not.toHaveBeenCalled();
  });

  test("an idle character never warns, and a wrongly-owned one warns once", () => {
    const system = new KinematicSystem();
    const registry = new SystemRegistry();
    registry.register(system);

    const idle = new Group();
    const idleCharacter = idle.addComponent(
      new CharacterController({ grounded: true }),
    );
    idleCharacter.step(idle.transform, DT); // clear the initial heading write
    idle.transformAuthority = "physics";
    system.track(idle);
    stepOnce(registry, 1);
    expect(warn).not.toHaveBeenCalled();

    // Now it wants to write, and does not own the transform (§42).
    idleCharacter.setMoveIntent(1, 0);
    const before = idle.transform.position.z;
    stepOnce(registry, 2);
    stepOnce(registry, 3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(idle.transform.position.z).toBe(before);
    expect(idleCharacter.skippedSteps).toBe(0); // a refusal is not a transient
  });

  test("a disabled node is skipped, and an absent component is not a write", () => {
    const system = new KinematicSystem();
    const registry = new SystemRegistry();
    registry.register(system);

    const { node, character } = makeCharacter({
      moveSpeed: 2,
      gravity: 0,
      grounded: true,
    });
    character.setMoveIntent(1, 0);
    node.enabled = false;
    system.track(node);
    system.track(new Group()); // no components at all
    stepOnce(registry, 1);
    expect(node.transform.position.z).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  test("a command runs after locomotion and wins the step", () => {
    const system = new KinematicSystem();
    const registry = new SystemRegistry();
    registry.register(system);

    const { node, character } = makeCharacter({
      moveSpeed: 5,
      gravity: 0,
      grounded: true,
    });
    const commands = node.addComponent(new KinematicController());
    character.setMoveIntent(1, 0);
    commands.moveTo(node.transform.position.clone().set(9, 0, 9));
    system.track(node);
    stepOnce(registry, 1);
    // The snap target, not the walk: the command channel writes last.
    expect(node.transform.position.x).toBe(9);
    expect(node.transform.position.z).toBe(9);
  });
});

describe("§79 serializers", () => {
  test("a character round-trips its configuration and vertical state", () => {
    const character = new CharacterController({
      yaw: 1.25,
      moveSpeed: 6,
      gravity: -3.72,
      groundHeight: -2,
      jumpSpeed: 5.5,
      maxFallSpeed: 40,
      verticalVelocity: -1.5,
      grounded: false,
    });
    character.setMoveIntent(1, 0);
    const payload = CHARACTER_CONTROLLER_SERIALIZER.serialize(character);
    const restored = CHARACTER_CONTROLLER_SERIALIZER.deserialize(payload, null);
    expect(restored.yaw).toBe(1.25);
    expect(restored.moveSpeed).toBe(6);
    expect(restored.gravity).toBe(-3.72);
    expect(restored.groundHeight).toBe(-2);
    expect(restored.jumpSpeed).toBe(5.5);
    expect(restored.maxFallSpeed).toBe(40);
    expect(restored.verticalVelocity).toBe(-1.5);
    expect(restored.grounded).toBe(false);
    // The live intent is this frame's input and is deliberately dropped.
    expect(restored.intentForward).toBe(0);
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  test("an unbounded fall speed is written by omission", () => {
    const payload = CHARACTER_CONTROLLER_SERIALIZER.serialize(
      new CharacterController({ grounded: true }),
    );
    const record = payload as { readonly [key: string]: unknown };
    expect("maxFallSpeed" in record).toBe(false);
    expect(record.grounded).toBe(true);
    const restored = CHARACTER_CONTROLLER_SERIALIZER.deserialize(payload, null);
    expect(restored.maxFallSpeed).toBe(Number.POSITIVE_INFINITY);
    expect(restored.grounded).toBe(true);
  });

  test("a corrupt payload restores the documented defaults", () => {
    const restored = CHARACTER_CONTROLLER_SERIALIZER.deserialize(
      { yaw: "north", moveSpeed: null },
      null,
    );
    expect(restored.yaw).toBe(0);
    expect(restored.moveSpeed).toBe(1);
    expect(restored.gravity).toBe(DEFAULT_CHARACTER_GRAVITY);
    expect(restored.jumpSpeed).toBe(4);
    expect(restored.grounded).toBe(false);
    expect(CHARACTER_CONTROLLER_SERIALIZER.deserialize(42, null).yaw).toBe(0);
  });

  test("a first-person look round-trips its pitch and both limits", () => {
    const look = new FirstPersonLook({
      pitch: 0.3,
      minPitch: -0.4,
      maxPitch: 0.6,
    });
    const payload = FIRST_PERSON_LOOK_SERIALIZER.serialize(look);
    const restored = FIRST_PERSON_LOOK_SERIALIZER.deserialize(payload, null);
    expect(restored.pitch).toBe(0.3);
    expect(restored.minPitch).toBe(-0.4);
    expect(restored.maxPitch).toBe(0.6);
    expect(restored.pitchLimitHits).toBe(0);

    const empty = FIRST_PERSON_LOOK_SERIALIZER.deserialize({}, null);
    expect(empty.pitch).toBe(0);
    expect(empty.maxPitch).toBe(DEFAULT_FIRST_PERSON_PITCH_LIMIT);
    expect(empty.minPitch).toBe(-DEFAULT_FIRST_PERSON_PITCH_LIMIT);
  });

  test("the component type names are the §79 keys", () => {
    expect(CharacterController.typeName).toBe("character-controller");
    expect(FirstPersonLook.typeName).toBe("first-person-look");
  });
});
