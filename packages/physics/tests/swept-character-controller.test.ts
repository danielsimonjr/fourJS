/**
 * §12's solver-backed character controller (`PH-11b`, 2026-08-21; §12, §24,
 * §30, §33, §39, §42, §85).
 *
 * ## The double, and what it is a double *of*
 *
 * These tests drive `SweptCharacterController` against a **scripted world**: an
 * object carrying the four members the controller actually consults —
 * `dimension`, `adapter.capabilities`, `getBodyHandle` and `shapeCast` — whose
 * cast answers a per-call script. That is the fake-GL/`FakeSolverAdapter`
 * pattern one level up, and it is the right level for this class: what is under
 * test here is the **resolver** — which casts it issues, in what order, with
 * what origins and distances, and what arithmetic it does with the answers —
 * and a real solver would make every one of those assertions indirect.
 *
 * The evidence that the resolver works against *actual geometry* is elsewhere,
 * on real Rapier 3D, and deliberately so:
 * `tests/integration/swept-character.test.ts` walks a capsule into a wall, up a
 * step and onto a ramp too steep to stand on, and
 * `tests/determinism/swept-character.test.ts` pins a 300-step run to a golden.
 */

import { isFourError } from "@fourjs/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Vector3 } from "@fourjs/math";
import {
  CharacterController,
  PRIORITY_KINEMATICS,
  createTimeState,
  type FixedUpdateContext,
} from "@fourjs/motion";
import { Group } from "@fourjs/scene";

import { Collider } from "../src/collider.js";
import { RigidBody } from "../src/rigid-body.js";
import {
  DEFAULT_GROUND_SNAP_DISTANCE,
  DEFAULT_MAX_SLIDES,
  DEFAULT_SKIN_WIDTH,
  DEFAULT_SLOPE_LIMIT,
  DEFAULT_STEP_HEIGHT,
  SweptCharacterController,
  SweptCharacterSystem,
} from "../src/swept-character-controller.js";
import type { ShapeCastQuery } from "../src/queries.js";
import type { PhysicsWorld, WorldShapeCastHit } from "../src/world.js";

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

/** The fixed step every test below uses, in seconds (§7a: never milliseconds). */
const DT = 1 / 60;

/** A recorded cast: the query's origin, direction and reach, as plain numbers. */
interface RecordedCast {
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
  maxDistance: number;
  ignored: number;
}

/** What a test's script returns for one cast. */
type CastScript = (
  cast: RecordedCast,
  index: number,
) => WorldShapeCastHit[] | undefined;

/** A `PhysicsWorld`-shaped double; see the module header. */
interface ScriptedWorld {
  world: PhysicsWorld;
  casts: RecordedCast[];
  script: CastScript;
  handle: number | undefined;
  shapeCastSupported: boolean;
}

/** A hit whose components are real: the controller only reads `body`. */
function hit(
  distance: number,
  normal: Vector3,
  body = new RigidBody({ type: "static" }),
): WorldShapeCastHit {
  return {
    body,
    collider: new Collider({ shape: { type: "sphere", radius: 1 } }),
    point: new Vector3(),
    normal,
    distance,
  };
}

/** Straight up — the normal of walkable ground under any slope limit. */
function up(): Vector3 {
  return new Vector3(0, 1, 0);
}

/** Builds the double. `script` may be replaced between steps. */
function scriptedWorld(): ScriptedWorld {
  const state: ScriptedWorld = {
    casts: [],
    script: () => undefined,
    handle: undefined,
    shapeCastSupported: true,
    world: undefined as unknown as PhysicsWorld,
  };
  state.world = {
    dimension: "3d",
    adapter: {
      name: "scripted",
      get capabilities() {
        return {
          queries: {
            raycast: true,
            shapeCast: state.shapeCastSupported,
            overlap: true,
            point: true,
          },
        };
      },
    },
    getBodyHandle: () => state.handle,
    shapeCast(query: ShapeCastQuery): WorldShapeCastHit[] {
      const position = query.position as Vector3;
      const direction = query.direction as Vector3;
      const cast: RecordedCast = {
        ox: position.x,
        oy: position.y,
        oz: position.z,
        dx: direction.x,
        dy: direction.y,
        dz: direction.z,
        maxDistance: query.maxDistance ?? Number.POSITIVE_INFINITY,
        ignored: query.ignoredBodies?.length ?? 0,
      };
      const index = state.casts.length;
      state.casts.push(cast);
      return state.script(cast, index) ?? [];
    },
  } as unknown as PhysicsWorld;
  return state;
}

/** A tracked, `"kinematic"` node carrying `controller`. */
function characterNode(controller: SweptCharacterController): Group {
  const node = new Group();
  node.transformAuthority = "kinematic";
  node.addComponent(controller);
  return node;
}

/** A controller on the double, with test-friendly round parameters. */
function makeController(
  scripted: ScriptedWorld,
  options: Partial<{
    moveSpeed: number;
    gravity: number;
    jumpSpeed: number;
    maxFallSpeed: number;
    stepHeight: number;
    slopeLimit: number;
    skinWidth: number;
    groundSnapDistance: number;
    maxSlides: number;
    grounded: boolean;
    verticalVelocity: number;
    yaw: number;
  }> = {},
): SweptCharacterController {
  return new SweptCharacterController({
    world: scripted.world,
    radius: 0.5,
    halfHeight: 0.5,
    moveSpeed: 60,
    skinWidth: 0.1,
    ...options,
  });
}

/** A `FixedUpdateContext` carrying nothing but §10's fixed delta. */
function fixedContext(): FixedUpdateContext {
  return { time: createTimeState({ fixedDeltaTime: DT }) };
}

describe("SweptCharacterController — §85 authoring refusals", () => {
  const world = scriptedWorld().world;
  const base = { world, radius: 0.5, halfHeight: 0.5 };

  it("refuses a capsule with no size (§24)", () => {
    expect(() => new SweptCharacterController({ ...base, radius: 0 })).toThrow(
      RangeError,
    );
    expect(
      () => new SweptCharacterController({ ...base, halfHeight: -1 }),
    ).toThrow(RangeError);
    expect(
      () =>
        new SweptCharacterController({
          ...base,
          radius: Number.POSITIVE_INFINITY,
        }),
    ).toThrow(/finite/);
  });

  it("refuses a negative step height, skin or snap distance", () => {
    expect(
      () => new SweptCharacterController({ ...base, stepHeight: -0.1 }),
    ).toThrow(RangeError);
    expect(
      () => new SweptCharacterController({ ...base, skinWidth: 0 }),
    ).toThrow(RangeError);
    expect(
      () => new SweptCharacterController({ ...base, groundSnapDistance: -1 }),
    ).toThrow(RangeError);
  });

  it("refuses a skin as thick as the capsule, because it would invert every sweep", () => {
    expect(
      () => new SweptCharacterController({ ...base, skinWidth: 0.5 }),
    ).toThrow(/less than radius/);
  });

  it("refuses a slope limit outside [0, π/2)", () => {
    expect(
      () => new SweptCharacterController({ ...base, slopeLimit: -0.1 }),
    ).toThrow(RangeError);
    expect(
      () => new SweptCharacterController({ ...base, slopeLimit: Number.NaN }),
    ).toThrow(RangeError);
    expect(
      () => new SweptCharacterController({ ...base, slopeLimit: Math.PI / 2 }),
    ).toThrow(/vertical wall counts as walkable/);
  });

  it("refuses a slide budget that is not an integer >= 1", () => {
    expect(
      () => new SweptCharacterController({ ...base, maxSlides: 0 }),
    ).toThrow(RangeError);
    expect(
      () => new SweptCharacterController({ ...base, maxSlides: 2.5 }),
    ).toThrow(RangeError);
  });

  it("refuses a non-finite initial vertical velocity", () => {
    expect(
      () =>
        new SweptCharacterController({
          ...base,
          verticalVelocity: Number.NaN,
        }),
    ).toThrow(RangeError);
  });

  it('refuses a "2d" world: a 2D character has no heading (§21)', () => {
    const flat = scriptedWorld();
    (flat.world as unknown as { dimension: string }).dimension = "2d";
    expect(
      () => new SweptCharacterController({ ...base, world: flat.world }),
    ).toThrow(/"3d" PhysicsWorld/);
  });

  it("refuses a non-finite translate (§85)", () => {
    const controller = new SweptCharacterController(base);
    expect(() => {
      controller.translate(1, Number.NaN, 0);
    }).toThrow(RangeError);
  });

  it("accepts a controller with no world at all — §79 restores one", () => {
    const controller = new SweptCharacterController({
      radius: 0.5,
      halfHeight: 0.5,
    });
    expect(controller.world).toBeUndefined();
    expect(controller.step(characterNode(controller), DT)).toBe(false);
  });
});

describe("SweptCharacterController — defaults and the held §12 state", () => {
  it("takes Appendix A's gravity and this module's stated defaults", () => {
    const controller = new SweptCharacterController({
      radius: 0.5,
      halfHeight: 0.5,
    });
    expect(controller.stepHeight).toBe(DEFAULT_STEP_HEIGHT);
    expect(controller.slopeLimit).toBe(DEFAULT_SLOPE_LIMIT);
    expect(controller.skinWidth).toBe(DEFAULT_SKIN_WIDTH);
    expect(controller.groundSnapDistance).toBe(DEFAULT_GROUND_SNAP_DISTANCE);
    expect(controller.maxSlides).toBe(DEFAULT_MAX_SLIDES);
    expect(controller.gravity).toBeCloseTo(-9.81, 10);
    expect(controller.moveSpeed).toBe(1);
    expect(controller.jumpSpeed).toBe(4);
    expect(controller.maxFallSpeed).toBe(Number.POSITIVE_INFINITY);
    expect(controller.collisionGroups).toBe(0xffffffff);
    expect(controller.collisionMask).toBe(0xffffffff);
    expect(controller.groundBody).toBeUndefined();
  });

  it("forwards heading, intent and locomotion parameters to the held controller", () => {
    const controller = new SweptCharacterController({
      radius: 0.5,
      halfHeight: 0.5,
      yaw: 0.25,
    });
    expect(controller.yaw).toBe(0.25);
    controller.turn(0.25);
    expect(controller.yaw).toBe(0.5);
    controller.yaw = 1;
    expect(controller.yaw).toBe(1);

    controller.moveSpeed = 3;
    controller.gravity = -1;
    controller.jumpSpeed = 9;
    expect(controller.moveSpeed).toBe(3);
    expect(controller.gravity).toBe(-1);
    expect(controller.jumpSpeed).toBe(9);

    // The unit-disc clamp is the held class's, executed once (§33).
    controller.setMoveIntent(1, 1);
    expect(controller.intentForward).toBeCloseTo(Math.SQRT1_2, 12);
    expect(controller.intentRight).toBeCloseTo(Math.SQRT1_2, 12);
    controller.stop();
    expect(controller.intentForward).toBe(0);
    expect(controller.intentRight).toBe(0);

    // …including its §85 refusals.
    expect(() => {
      controller.moveSpeed = -1;
    }).toThrow(RangeError);
    expect(() => {
      controller.yaw = Number.NaN;
    }).toThrow(RangeError);
    expect(() => {
      controller.gravity = Number.NaN;
    }).toThrow(RangeError);
    expect(() => {
      controller.jumpSpeed = -1;
    }).toThrow(RangeError);
  });

  it("gates writes: a grounded, still, unturned character is idle", () => {
    const scripted = scriptedWorld();
    const controller = makeController(scripted, { grounded: true });
    scripted.script = (cast) => (cast.dy === -1 ? [hit(0.1, up())] : []);
    expect(controller.active).toBe(true); // heading not yet written
    controller.step(characterNode(controller), DT);
    expect(controller.active).toBe(false);
    controller.setMoveIntent(1, 0);
    expect(controller.active).toBe(true);
    controller.stop();
    expect(controller.active).toBe(false);
    controller.turn(0.1);
    expect(controller.active).toBe(true);
  });

  it("jumps only from the ground, and only with a jump speed", () => {
    const scripted = scriptedWorld();
    const airborne = makeController(scripted);
    expect(airborne.jump()).toBe(false);

    const grounded = makeController(scripted, { grounded: true });
    expect(grounded.jump()).toBe(true);
    expect(grounded.verticalVelocity).toBe(4);
    expect(grounded.grounded).toBe(false);
    expect(grounded.groundBody).toBeUndefined();
    expect(grounded.jump()).toBe(false);

    const cannot = makeController(scripted, {
      grounded: true,
      jumpSpeed: 0,
    });
    expect(cannot.jump()).toBe(false);
    expect(cannot.verticalVelocity).toBe(0);
  });

  it("ground() asserts the ground a probe has yet to confirm", () => {
    const controller = makeController(scriptedWorld(), {
      verticalVelocity: -7,
    });
    controller.ground();
    expect(controller.grounded).toBe(true);
    expect(controller.verticalVelocity).toBe(0);
  });
});

describe("SweptCharacterController — the horizontal resolve (§30)", () => {
  let scripted: ScriptedWorld;

  beforeEach(() => {
    scripted = scriptedWorld();
  });

  it("moves freely when nothing is hit, and writes the yaw quaternion", () => {
    const controller = makeController(scripted, { grounded: true });
    controller.setMoveIntent(1, 0);
    const node = characterNode(controller);

    expect(controller.step(node, DT)).toBe(true);
    // Forward at yaw 0 is −Z; 60 m/s over 1/60 s is one metre.
    expect(node.transform.position.z).toBeCloseTo(-1, 12);
    expect(node.transform.position.x).toBeCloseTo(0, 12);
    expect(node.transform.rotation.w).toBeCloseTo(1, 12);
    // One horizontal cast, then the grounded probe.
    expect(scripted.casts).toHaveLength(2);
    expect(scripted.casts[0].maxDistance).toBeCloseTo(1.1, 12);
    expect(scripted.casts[1].dy).toBe(-1);
  });

  it("stops short of a wall by the skin width and slides along it", () => {
    const controller = makeController(scripted);
    controller.setMoveIntent(1, 0); // −Z
    const node = characterNode(controller);
    // A wall facing +Z half a metre ahead, then clear air.
    scripted.script = (_cast, index) =>
      index === 0 ? [hit(0.5, new Vector3(0, 0, 1))] : [];

    controller.step(node, DT);
    // 0.5 − skin = 0.4 travelled into the wall's normal direction…
    expect(node.transform.position.z).toBeCloseTo(-0.4, 12);
    // …and the remaining 0.6 m was projected onto the wall, which is
    // perpendicular to it, so nothing is left to move along.
    expect(node.transform.position.x).toBeCloseTo(0, 12);
    expect(controller.slideCount).toBe(1);
  });

  it("carries the unspent motion along an angled wall", () => {
    const controller = makeController(scripted);
    controller.setMoveIntent(1, 0);
    const node = characterNode(controller);
    const diagonal = new Vector3(Math.SQRT1_2, 0, Math.SQRT1_2);
    scripted.script = (_cast, index) =>
      index === 0 ? [hit(0.5, diagonal)] : [];

    controller.step(node, DT);
    // Half the remaining 0.6 m is redirected onto +X by the 45° wall.
    expect(node.transform.position.x).toBeCloseTo(0.3, 10);
    expect(node.transform.position.z).toBeCloseTo(-0.7, 10);
  });

  it("takes the nearest hit when an adapter returns several (§30)", () => {
    const controller = makeController(scripted);
    controller.setMoveIntent(1, 0);
    const node = characterNode(controller);
    scripted.script = (_cast, index) =>
      index === 0
        ? [hit(0.9, new Vector3(0, 0, 1)), hit(0.3, new Vector3(0, 0, 1))]
        : [];

    controller.step(node, DT);
    expect(node.transform.position.z).toBeCloseTo(-0.2, 12);
  });

  it("spends its slide budget and then drops the rest rather than tunnelling", () => {
    const controller = makeController(scripted, { maxSlides: 2 });
    controller.setMoveIntent(1, 0);
    const node = characterNode(controller);
    // Every cast is an immediate zero-distance contact against the *same* 45°
    // surface: the first iteration projects the motion onto it, the second
    // finds nothing left to project, and neither advances — the degenerate
    // configuration the budget exists for.
    const diagonal = new Vector3(Math.SQRT1_2, 0, Math.SQRT1_2);
    scripted.script = (cast) => (cast.dy === 0 ? [hit(0, diagonal)] : []);

    controller.step(node, DT);
    expect(controller.budgetExhaustedSteps).toBe(1);
    expect(controller.slideCount).toBe(2);
    expect(node.transform.position.z).toBe(0);
  });

  it("spends the motion when a hit's normal is purely vertical", () => {
    const controller = makeController(scripted);
    controller.setMoveIntent(1, 0);
    const node = characterNode(controller);
    scripted.script = (cast) => (cast.dy === 0 ? [hit(0.5, up())] : []);

    controller.step(node, DT);
    expect(node.transform.position.z).toBeCloseTo(-0.4, 12);
    expect(controller.budgetExhaustedSteps).toBe(0);
  });

  it("does not slide along a surface the motion is already leaving", () => {
    const controller = makeController(scripted);
    controller.setMoveIntent(1, 0);
    const node = characterNode(controller);
    // A normal pointing the same way as the motion: the dot product is
    // positive, so there is nothing to project out.
    scripted.script = (cast, index) =>
      cast.dy === 0 && index === 0 ? [hit(0.5, new Vector3(0, 0, -1))] : [];

    controller.step(node, DT);
    expect(node.transform.position.z).toBeCloseTo(-1, 12);
  });

  it("issues no cast at all for a motionless grounded character", () => {
    const controller = makeController(scripted, { grounded: true });
    controller.step(characterNode(controller), DT);
    // Only the ground probe: the horizontal loop broke on MINIMUM_MOTION.
    expect(scripted.casts).toHaveLength(1);
    expect(scripted.casts[0].dy).toBe(-1);
  });

  it("excludes its own body from every cast (§30 ignored bodies)", () => {
    const controller = makeController(scripted, { grounded: true });
    controller.setMoveIntent(1, 0);
    scripted.handle = 7;
    controller.step(characterNode(controller), DT);
    expect(scripted.casts.every((cast) => cast.ignored === 1)).toBe(true);
  });

  it("applies an un-swept translate before resolving (the platform-carry seam)", () => {
    const controller = makeController(scripted, { grounded: true });
    controller.translate(2, 3, 4);
    const node = characterNode(controller);
    controller.step(node, DT);
    expect(node.transform.position.x).toBeCloseTo(2, 12);
    expect(node.transform.position.y).toBeCloseTo(3, 12);
    expect(node.transform.position.z).toBeCloseTo(4, 12);
    // Queued, not sticky: the next step does not repeat it.
    controller.step(node, DT);
    expect(node.transform.position.x).toBeCloseTo(2, 12);
  });
});

describe("SweptCharacterController — step height (§12)", () => {
  let scripted: ScriptedWorld;

  beforeEach(() => {
    scripted = scriptedWorld();
  });

  /** A steep wall on the first horizontal cast; everything else scripted. */
  function blockedByWall(rest: CastScript): CastScript {
    return (cast, index) => {
      if (index === 0) {
        return [hit(0.2, new Vector3(0, 0, 1))];
      }
      return rest(cast, index);
    };
  }

  it("steps up onto a riser and keeps the rest of its motion", () => {
    const controller = makeController(scripted, {
      grounded: true,
      stepHeight: 0.4,
    });
    controller.setMoveIntent(1, 0);
    const node = characterNode(controller);
    scripted.script = blockedByWall((cast, index) => {
      if (index === 1) return []; // clear overhead
      if (index === 2) return []; // clear forward, up there
      if (index === 3) return [hit(0.2, up())]; // ground 0.1 below the lift
      return [];
    });

    controller.step(node, DT);
    expect(controller.stepUpCount).toBe(1);
    // Lifted 0.4, then dropped 0.2 − skin = 0.1 → +0.3 m.
    expect(node.transform.position.y).toBeCloseTo(0.3, 10);
    // 0.1 travelled before the wall, then the whole 0.9 remainder up there.
    expect(node.transform.position.z).toBeCloseTo(-1, 10);
  });

  it("refuses to step when there is no headroom", () => {
    const controller = makeController(scripted, {
      grounded: true,
      stepHeight: 0.4,
    });
    controller.setMoveIntent(1, 0);
    const node = characterNode(controller);
    scripted.script = blockedByWall((_cast, index) =>
      index === 1 ? [hit(0.05, new Vector3(0, -1, 0))] : [],
    );

    controller.step(node, DT);
    expect(controller.stepUpCount).toBe(0);
    expect(node.transform.position.y).toBeCloseTo(0, 12);
  });

  it("refuses to step when the way forward is blocked up there too", () => {
    const controller = makeController(scripted, {
      grounded: true,
      stepHeight: 0.4,
    });
    controller.setMoveIntent(1, 0);
    const node = characterNode(controller);
    scripted.script = blockedByWall((_cast, index) =>
      index === 2 ? [hit(0.05, new Vector3(0, 0, 1))] : [],
    );

    controller.step(node, DT);
    expect(controller.stepUpCount).toBe(0);
  });

  it("refuses to step into thin air, or onto ground too steep to stand on", () => {
    const controller = makeController(scripted, {
      grounded: true,
      stepHeight: 0.4,
    });
    controller.setMoveIntent(1, 0);
    scripted.script = blockedByWall(() => []);
    controller.step(characterNode(controller), DT);
    expect(controller.stepUpCount).toBe(0);

    const steep = makeController(scripted, { grounded: true, stepHeight: 0.4 });
    steep.setMoveIntent(1, 0);
    scripted.casts.length = 0;
    scripted.script = blockedByWall((_cast, index) =>
      index === 3 ? [hit(0.2, new Vector3(0.9, 0.4, 0).normalize())] : [],
    );
    steep.step(characterNode(steep), DT);
    expect(steep.stepUpCount).toBe(0);
  });

  it("lands on the lift height itself when the step is flush with it", () => {
    const controller = makeController(scripted, {
      grounded: true,
      stepHeight: 0.4,
    });
    controller.setMoveIntent(1, 0);
    const node = characterNode(controller);
    // The down-cast contacts inside the skin, so there is nothing to fall:
    // the character stands at the full lift height.
    scripted.script = blockedByWall((_cast, index) =>
      index === 3 ? [hit(0.05, up())] : [],
    );

    controller.step(node, DT);
    expect(controller.stepUpCount).toBe(1);
    expect(node.transform.position.y).toBeCloseTo(0.4, 10);
  });

  it("refuses a landing lower than it started — that is a step down", () => {
    const controller = makeController(scripted, {
      grounded: true,
      stepHeight: 0.4,
    });
    controller.setMoveIntent(1, 0);
    scripted.script = blockedByWall((_cast, index) =>
      index === 3 ? [hit(0.8, up())] : [],
    );
    controller.step(characterNode(controller), DT);
    expect(controller.stepUpCount).toBe(0);
  });

  it("never steps up while airborne, nor with stepHeight 0, nor twice in a step", () => {
    const airborne = makeController(scripted, { stepHeight: 0.4 });
    airborne.setMoveIntent(1, 0);
    scripted.script = blockedByWall(() => []);
    airborne.step(characterNode(airborne), DT);
    expect(airborne.stepUpCount).toBe(0);
    // The wall cast and the vertical cast, and nothing else: no step-up triple,
    // and no second slide iteration because the perpendicular wall consumed the
    // whole remainder.
    expect(scripted.casts).toHaveLength(2);

    scripted.casts.length = 0;
    const flat = makeController(scripted, { grounded: true, stepHeight: 0 });
    flat.setMoveIntent(1, 0);
    flat.step(characterNode(flat), DT);
    expect(flat.stepUpCount).toBe(0);
  });

  it("declines a step-up whose remaining motion is already spent", () => {
    const controller = makeController(scripted, {
      grounded: true,
      stepHeight: 0.4,
    });
    controller.setMoveIntent(1, 0);
    // Contact at exactly the skin width leaves no remainder to carry forward.
    scripted.script = (_cast, index) =>
      index === 0 ? [hit(1.1, new Vector3(0, 0, 1))] : [];
    controller.step(characterNode(controller), DT);
    expect(controller.stepUpCount).toBe(0);
  });
});

describe("SweptCharacterController — the vertical resolve (§12, §30)", () => {
  let scripted: ScriptedWorld;

  beforeEach(() => {
    scripted = scriptedWorld();
  });

  it("snaps a grounded character down onto the ground it walked off the top of", () => {
    const controller = makeController(scripted, { grounded: true });
    controller.setMoveIntent(1, 0);
    const node = characterNode(controller);
    const floor = new RigidBody({ type: "static" });
    scripted.script = (cast) =>
      cast.dy === -1 ? [hit(0.15, up(), floor)] : [];

    controller.step(node, DT);
    expect(node.transform.position.y).toBeCloseTo(-0.05, 12);
    expect(controller.grounded).toBe(true);
    expect(controller.groundBody).toBe(floor);
    expect(controller.verticalVelocity).toBe(0);
  });

  it("leaves the ground when the probe finds nothing, or nothing walkable", () => {
    const controller = makeController(scripted, { grounded: true });
    controller.setMoveIntent(1, 0);
    controller.step(characterNode(controller), DT);
    expect(controller.grounded).toBe(false);
    expect(controller.groundBody).toBeUndefined();
    expect(controller.verticalVelocity).toBe(0);

    const steep = makeController(scripted, { grounded: true });
    steep.setMoveIntent(1, 0);
    scripted.script = (cast) =>
      cast.dy === -1 ? [hit(0.05, new Vector3(0.9, 0.4, 0).normalize())] : [];
    steep.step(characterNode(steep), DT);
    expect(steep.grounded).toBe(false);
  });

  it("does not move a grounded character whose ground is exactly underfoot", () => {
    const controller = makeController(scripted, { grounded: true });
    controller.setMoveIntent(1, 0);
    const node = characterNode(controller);
    scripted.script = (cast) => (cast.dy === -1 ? [hit(0.1, up())] : []);
    controller.step(node, DT);
    expect(node.transform.position.y).toBe(0);
    expect(controller.grounded).toBe(true);
  });

  it("integrates gravity while airborne and lands on walkable ground", () => {
    const controller = makeController(scripted, { gravity: -60 });
    const node = characterNode(controller);
    // Falls 60 · dt = 1 m/s → 1/60 m this step; nothing in the way.
    controller.step(node, DT);
    expect(controller.verticalVelocity).toBeCloseTo(-1, 12);
    expect(node.transform.position.y).toBeCloseTo(-1 / 60, 12);
    expect(controller.grounded).toBe(false);

    const floor = new RigidBody({ type: "static" });
    scripted.script = (cast) =>
      cast.dy === -1 ? [hit(0.12, up(), floor)] : [];
    controller.step(node, DT);
    expect(controller.grounded).toBe(true);
    expect(controller.groundBody).toBe(floor);
    expect(controller.verticalVelocity).toBe(0);
    expect(node.transform.position.y).toBeCloseTo(-1 / 60 - 0.02, 10);
  });

  it("ends a jump against a ceiling without grounding on it", () => {
    const controller = makeController(scripted, {
      grounded: true,
      jumpSpeed: 60,
      gravity: 0,
    });
    expect(controller.jump()).toBe(true);
    const node = characterNode(controller);
    scripted.script = (cast) =>
      cast.dy === 1 ? [hit(0.3, new Vector3(0, -1, 0))] : [];
    controller.step(node, DT);
    expect(node.transform.position.y).toBeCloseTo(0.2, 12);
    expect(controller.verticalVelocity).toBe(0);
    expect(controller.grounded).toBe(false);
  });

  it("clamps the fall at maxFallSpeed", () => {
    const controller = makeController(scripted, {
      gravity: -600,
      maxFallSpeed: 6,
    });
    const node = characterNode(controller);
    controller.step(node, DT);
    controller.step(node, DT);
    expect(controller.verticalVelocity).toBe(-6);
  });

  it("does not cast for a vertical step below the motion floor", () => {
    const controller = makeController(scripted, { gravity: 0 });
    controller.setMoveIntent(0, 0);
    controller.turn(0.1);
    controller.step(characterNode(controller), DT);
    expect(scripted.casts).toHaveLength(0);
    expect(controller.verticalVelocity).toBe(0);
  });

  it("stops exactly on contact when the gap is already the skin width", () => {
    const controller = makeController(scripted, { gravity: -60 });
    const node = characterNode(controller);
    scripted.script = (cast) => (cast.dy === -1 ? [hit(0.05, up())] : []);
    controller.step(node, DT);
    // 0.05 − 0.1 is negative: the character is already inside the skin, so it
    // holds its ground rather than being pushed backwards.
    expect(node.transform.position.y).toBe(0);
    expect(controller.grounded).toBe(true);
  });
});

describe("SweptCharacterController — transients (§85)", () => {
  it("writes nothing and counts the step when the pose goes non-finite", () => {
    const scripted = scriptedWorld();
    const controller = makeController(scripted, { grounded: true });
    controller.setMoveIntent(1, 0);
    const node = characterNode(controller);
    // `CharacterController`'s own reachable case, verbatim: "an already-`NaN`
    // position, a `NaN` fed in from elsewhere".
    node.transform.position.set(Number.NaN, 4, 5);
    scripted.script = (cast) => (cast.dy === -1 ? [hit(0.1, up())] : []);

    expect(controller.step(node, DT)).toBe(false);
    expect(controller.skippedSteps).toBe(1);
    expect(node.transform.position.x).toBeNaN();
    expect(node.transform.position.y).toBe(4);
    expect(node.transform.position.z).toBe(5);
    // The vertical state is untouched too: both writes commit, or neither does.
    expect(controller.grounded).toBe(true);
  });
});

describe("SweptCharacterSystem — §39 step 4, §42 kinematic", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("occupies §39's step 4 and tracks nodes in insertion order (§33)", () => {
    const system = new SweptCharacterSystem();
    expect(system.priority).toBe(PRIORITY_KINEMATICS);
    expect(new SweptCharacterSystem({ priority: 401 }).priority).toBe(401);

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
    system.initialize();
    system.clear();
    expect(system.size).toBe(0);
    system.track(b);
    system.dispose();
    expect(system.size).toBe(0);
  });

  it("advances a tracked character and skips disabled, absent and idle ones", () => {
    const scripted = scriptedWorld();
    const controller = makeController(scripted, { grounded: true });
    controller.setMoveIntent(1, 0);
    const node = characterNode(controller);
    const bare = new Group();
    const disabled = characterNode(makeController(scripted));
    disabled.enabled = false;

    const system = new SweptCharacterSystem();
    system.track(node);
    system.track(bare);
    system.track(disabled);
    system.fixedUpdate(fixedContext());

    expect(node.transform.position.z).toBeCloseTo(-1, 12);
    expect(disabled.transform.position.z).toBe(0);

    // Now idle: no cast, no version bump.
    const before = scripted.casts.length;
    controller.stop();
    controller.ground();
    system.fixedUpdate(fixedContext());
    expect(scripted.casts).toHaveLength(before);
  });

  it("refuses a node carrying both locomotion components, once", () => {
    const scripted = scriptedWorld();
    const node = characterNode(makeController(scripted));
    node.addComponent(new CharacterController());
    const system = new SweptCharacterSystem();
    system.track(node);

    system.fixedUpdate(fixedContext());
    system.fixedUpdate(fixedContext());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/both a CharacterController/);
    expect(node.transform.position.y).toBe(0);
  });

  it("refuses a controller with no world, once", () => {
    const controller = new SweptCharacterController({
      radius: 0.5,
      halfHeight: 0.5,
    });
    const system = new SweptCharacterSystem();
    system.track(characterNode(controller));
    system.fixedUpdate(fixedContext());
    system.fixedUpdate(fixedContext());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/has no PhysicsWorld/);
  });

  it("refuses an adapter that cannot sweep — presence is the capability (§37)", () => {
    const scripted = scriptedWorld();
    scripted.shapeCastSupported = false;
    const system = new SweptCharacterSystem();
    system.track(characterNode(makeController(scripted)));
    system.fixedUpdate(fixedContext());
    system.fixedUpdate(fixedContext());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/shapeCast: false/);
    expect(scripted.casts).toHaveLength(0);
  });

  it("refuses to write a node owned by another authority (§42)", () => {
    const scripted = scriptedWorld();
    const controller = makeController(scripted, { grounded: true });
    controller.setMoveIntent(1, 0);
    const node = characterNode(controller);
    node.transformAuthority = "physics";

    const system = new SweptCharacterSystem();
    system.track(node);
    system.fixedUpdate(fixedContext());

    expect(node.transform.position.z).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/"kinematic"/);
  });
});

describe("SweptCharacterSystem disposal (§83 stability audit, 2026-09-11)", () => {
  it("disposes idempotently and refuses tracking and stepping afterwards", () => {
    const system = new SweptCharacterSystem();
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
      /SweptCharacterSystem is disposed.*§83/s,
    );
    expectDisposedError(() => system.fixedUpdate(fixedContext()));
    expect(system.size).toBe(0);
    // Reads stay answerable, so teardown code can still inspect the system.
    expect(system.has(node)).toBe(false);
  });
});
