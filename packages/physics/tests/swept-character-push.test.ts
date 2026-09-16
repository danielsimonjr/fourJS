/**
 * PH-11c — character / dynamics push.
 *
 * The resolver is driven against a scripted `shapeCast` so the impulse
 * arithmetic is assertable without a solver, then against a `PhysicsWorld` on
 * the fake adapter so a queued impulse actually displaces a body.
 */

import { Vector3 } from "@fourjs/math";
import { Group } from "@fourjs/scene";
import { describe, expect, it } from "vitest";

import { Collider } from "../src/collider.js";
import { RigidBody } from "../src/rigid-body.js";
import {
  DEFAULT_PUSH_IMPULSE_SCALE,
  DEFAULT_PUSH_MASS,
  SweptCharacterController,
} from "../src/swept-character-controller.js";
import { PhysicsWorld } from "../src/world.js";
import type { WorldShapeCastHit } from "../src/world.js";
import { FakeSolverAdapter } from "./fake-adapter.js";

const DT = 1 / 60;

function hit(
  distance: number,
  normal: Vector3,
  body: RigidBody,
  point = new Vector3(0, 0.5, -0.4),
): WorldShapeCastHit {
  return {
    body,
    collider: new Collider({ shape: { type: "sphere", radius: 1 } }),
    point,
    normal,
    distance,
  };
}

function scriptedWorld(): {
  world: PhysicsWorld;
  setHit: (next: WorldShapeCastHit | undefined) => void;
} {
  let next: WorldShapeCastHit | undefined;
  const world = {
    dimension: "3d",
    adapter: {
      name: "scripted",
      capabilities: {
        queries: {
          raycast: true,
          shapeCast: true,
          overlap: true,
          point: true,
        },
      },
    },
    getBodyHandle: () => undefined,
    shapeCast(): WorldShapeCastHit[] {
      return next === undefined ? [] : [next];
    },
  } as unknown as PhysicsWorld;
  return {
    world,
    setHit(value) {
      next = value;
    },
  };
}

function makeController(
  world: PhysicsWorld,
  options: Partial<
    ConstructorParameters<typeof SweptCharacterController>[0]
  > = {},
): SweptCharacterController {
  return new SweptCharacterController({
    world,
    radius: 0.5,
    halfHeight: 0.5,
    moveSpeed: 6,
    skinWidth: 0.1,
    stepHeight: 0,
    ...options,
  });
}

function characterNode(controller: SweptCharacterController): Group {
  const node = new Group();
  node.transformAuthority = "kinematic";
  node.transform.position.set(0, 1, 0);
  node.addComponent(controller);
  return node;
}

describe("SweptCharacterController — PH-11c push options", () => {
  it("defaults pushMass to 80 kg, scale 1, and pushDynamics on", () => {
    const controller = new SweptCharacterController({
      radius: 0.5,
      halfHeight: 0.5,
    });
    expect(controller.pushMass).toBe(DEFAULT_PUSH_MASS);
    expect(controller.pushImpulseScale).toBe(DEFAULT_PUSH_IMPULSE_SCALE);
    expect(controller.pushDynamics).toBe(true);
  });

  it("refuses a non-positive pushMass (§85)", () => {
    expect(
      () =>
        new SweptCharacterController({
          radius: 0.5,
          halfHeight: 0.5,
          pushMass: 0,
        }),
    ).toThrow(RangeError);
  });
});

describe("SweptCharacterController — PH-11c impulse policy", () => {
  it("imparts a reduced-mass impulse at the hit point and wakes the body", () => {
    const box = new RigidBody({ type: "dynamic", mass: 1 });
    const scripted = scriptedWorld();
    const controller = makeController(scripted.world);
    const node = characterNode(controller);
    controller.setMoveIntent(1, 0);
    scripted.setHit(hit(0.2, new Vector3(0, 0, 1), box));

    controller.step(node, DT);

    expect(box.commands.sleepCommand).toBe("wake");
    expect(box.commands.pointImpulseCount).toBe(1);
    const load = box.commands.pointImpulses[0];
    const speed = 6;
    const mu = (80 * 1) / (80 + 1);
    const expected = mu * speed; // closing speed = 6, −n = (0,0,−1)
    expect(load.value.x).toBeCloseTo(0, 12);
    expect(load.value.y).toBeCloseTo(0, 12);
    expect(load.value.z).toBeCloseTo(-expected, 12);
    expect(load.point.z).toBe(-0.4);
  });

  it("skips a static floor", () => {
    const floor = new RigidBody({ type: "static" });
    const scripted = scriptedWorld();
    const controller = makeController(scripted.world);
    const node = characterNode(controller);
    controller.setMoveIntent(1, 0);
    scripted.setHit(hit(0.2, new Vector3(0, 0, 1), floor));

    controller.step(node, DT);

    expect(floor.commands.pointImpulseCount).toBe(0);
    expect(floor.commands.sleepCommand).toBeNull();
  });

  it("skips a kinematic body", () => {
    const slab = new RigidBody({ type: "kinematic-position" });
    const scripted = scriptedWorld();
    const controller = makeController(scripted.world);
    const node = characterNode(controller);
    controller.setMoveIntent(1, 0);
    scripted.setHit(hit(0.2, new Vector3(0, 0, 1), slab));

    controller.step(node, DT);

    expect(slab.commands.pointImpulseCount).toBe(0);
  });

  it("leaves the box still when pushDynamics is false", () => {
    const box = new RigidBody({ type: "dynamic", mass: 1 });
    const scripted = scriptedWorld();
    const controller = makeController(scripted.world, {
      world: scripted.world,
      radius: 0.5,
      halfHeight: 0.5,
      pushDynamics: false,
    });
    const node = characterNode(controller);
    controller.setMoveIntent(1, 0);
    scripted.setHit(hit(0.2, new Vector3(0, 0, 1), box));

    controller.step(node, DT);

    expect(box.commands.pointImpulseCount).toBe(0);
    expect(box.commands.sleepCommand).toBeNull();
  });

  it("skips a massless or infinite-mass body", () => {
    const massless = new RigidBody({ type: "dynamic" });
    const scripted = scriptedWorld();
    const controller = makeController(scripted.world);
    const node = characterNode(controller);
    controller.setMoveIntent(1, 0);
    scripted.setHit(hit(0.2, new Vector3(0, 0, 1), massless));

    controller.step(node, DT);

    expect(massless.commands.pointImpulseCount).toBe(0);
  });

  it("skips when pushImpulseScale is 0 or the character is receding", () => {
    const box = new RigidBody({ type: "dynamic", mass: 1 });
    const scripted = scriptedWorld();
    const controller = makeController(scripted.world, {
      world: scripted.world,
      radius: 0.5,
      halfHeight: 0.5,
      pushImpulseScale: 0,
    });
    const node = characterNode(controller);
    controller.setMoveIntent(1, 0);
    scripted.setHit(hit(0.2, new Vector3(0, 0, 1), box));

    controller.step(node, DT);
    expect(box.commands.pointImpulseCount).toBe(0);

    const receding = new RigidBody({ type: "dynamic", mass: 1 });
    const recedingWorld = scriptedWorld();
    const recedingController = makeController(recedingWorld.world);
    const recedingNode = characterNode(recedingController);
    recedingController.setMoveIntent(1, 0);
    // Normal points along the walk, so −dot(v, n) is negative → closing 0.
    recedingWorld.setHit(hit(0.2, new Vector3(0, 0, -1), receding));
    recedingController.step(recedingNode, DT);
    expect(receding.commands.pointImpulseCount).toBe(0);
  });

  it("gives a heavier box a smaller velocity change at the same closing speed", () => {
    const light = new RigidBody({ type: "dynamic", mass: 1 });
    const heavy = new RigidBody({ type: "dynamic", mass: 80 });
    const scriptedLight = scriptedWorld();
    const scriptedHeavy = scriptedWorld();
    const lightController = makeController(scriptedLight.world);
    const heavyController = makeController(scriptedHeavy.world);
    const lightNode = characterNode(lightController);
    const heavyNode = characterNode(heavyController);
    lightController.setMoveIntent(1, 0);
    heavyController.setMoveIntent(1, 0);
    scriptedLight.setHit(hit(0.2, new Vector3(0, 0, 1), light));
    scriptedHeavy.setHit(hit(0.2, new Vector3(0, 0, 1), heavy));

    lightController.step(lightNode, DT);
    heavyController.step(heavyNode, DT);

    const jLight = Math.abs(light.commands.pointImpulses[0].value.z);
    const jHeavy = Math.abs(heavy.commands.pointImpulses[0].value.z);
    const dvLight = jLight / 1;
    const dvHeavy = jHeavy / 80;
    expect(dvHeavy).toBeLessThan(dvLight);
  });
});

describe("SweptCharacterController — PH-11c against a fake solver", () => {
  async function ready3d(): Promise<{
    adapter: FakeSolverAdapter;
    world: PhysicsWorld;
  }> {
    const adapter = new FakeSolverAdapter();
    const world = new PhysicsWorld({ dimension: "3d", adapter });
    await world.initialize();
    return { adapter, world };
  }

  function addBox(world: PhysicsWorld, mass: number, sleeping = false): Group {
    const box = new Group();
    box.transformAuthority = "physics";
    box.transform.position.set(0, 0.3, -1);
    box.addComponent(new RigidBody({ type: "dynamic", mass }));
    box.addComponent(
      new Collider({
        shape: { type: "box", halfExtents: new Vector3(0.3, 0.3, 0.3) },
      }),
    );
    world.addBody(box);
    if (sleeping) {
      box.getComponent(RigidBody)?.sleep();
      world.step(DT);
    }
    return box;
  }

  it("displaces a dynamic box and wakes a sleeper", async () => {
    const { adapter, world } = await ready3d();
    const box = addBox(world, 1, true);
    const body = box.getComponent(RigidBody)!;
    const controller = makeController(world);
    const node = characterNode(controller);
    controller.setMoveIntent(1, 0);

    const collider = [...adapter.colliders.values()][0];
    adapter.shapeCastHits = [
      {
        collider: collider.handle,
        body: collider.body.handle,
        point: new Vector3(0, 0.5, -0.7),
        normal: new Vector3(0, 0, 1),
        distance: 0.2,
      },
    ];

    // Map the world's shapeCast onto the registered body.
    const wrapped = world;
    controller.world = wrapped;
    // The scripted hit must name the registered component. World.shapeCast
    // remaps the adapter hit to `body`, so stepping the controller against
    // `world` is enough — but only after we point the controller at it.
    controller.step(node, DT);
    world.step(DT);

    expect(body.sleeping).toBe(false);
    expect(adapter.body(1).sleeping).toBe(false);
    expect(box.transform.position.z).toBeLessThan(-1);
    world.dispose();
  });

  it("does not move a static body", async () => {
    const { adapter, world } = await ready3d();
    const floor = new Group();
    floor.transformAuthority = "physics";
    floor.transform.position.set(0, 0, -1);
    floor.addComponent(new RigidBody({ type: "static" }));
    floor.addComponent(
      new Collider({
        shape: { type: "box", halfExtents: new Vector3(1, 0.1, 1) },
      }),
    );
    world.addBody(floor);
    const startZ = floor.transform.position.z;

    const controller = makeController(world);
    const node = characterNode(controller);
    controller.setMoveIntent(1, 0);
    const collider = [...adapter.colliders.values()][0];
    adapter.shapeCastHits = [
      {
        collider: collider.handle,
        body: collider.body.handle,
        point: new Vector3(0, 0.5, -0.7),
        normal: new Vector3(0, 0, 1),
        distance: 0.2,
      },
    ];
    controller.step(node, DT);
    world.step(DT);

    expect(floor.transform.position.z).toBe(startZ);
    world.dispose();
  });
});
