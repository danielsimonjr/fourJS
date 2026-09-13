import { ComponentRegistry, isFourError } from "@fourjs/core";
import { Vector2, Vector3 } from "@fourjs/math";
import { Group, Transform } from "@fourjs/scene";
import { describe, expect, it, vi } from "vitest";

import type { ColliderOptions, ColliderTriggerEvent } from "../src/collider.js";
import { Collider } from "../src/collider.js";
import {
  DEFAULT_DENSITY,
  DEFAULT_FRICTION,
  DEFAULT_RESTITUTION,
  PhysicsMaterial,
} from "../src/material.js";
import { ALL_COLLISION_GROUPS } from "../src/queries.js";
import { RigidBody } from "../src/rigid-body.js";
import type { PhysicsBodyHandle } from "../src/types.js";

/** Runs `run` and asserts it threw the §85 validation error. */
function expectValidationError(run: () => void): Error & { code: string } {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(isFourError(caught)).toBe(true);
  const error = caught as Error & { code: string };
  expect(error.code).toBe("INVALID_APPLICATION_STATE");
  return error;
}

function makeBodyHandle(id: string): PhysicsBodyHandle {
  return { id } as unknown as PhysicsBodyHandle;
}

/**
 * Component-wise vector assertion. `toEqual` cannot be used on a `Transform`'s
 * vectors: they carry the plan-D3 `onChanged` hook, which a freshly built
 * `Vector3` does not.
 */
function expectVector(actual: Vector3, x: number, y: number, z: number): void {
  expect([actual.x, actual.y, actual.z]).toEqual([x, y, z]);
}

/** A 3D collider, the common case in these tests. */
function sphereCollider(overrides: Partial<ColliderOptions> = {}): Collider {
  return new Collider({ shape: { type: "sphere", radius: 0.5 }, ...overrides });
}

describe("Collider construction (§24)", () => {
  it("applies the §24 defaults for every omitted field", () => {
    const collider = sphereCollider();

    expect(collider.shape).toEqual({ type: "sphere", radius: 0.5 });
    expectVector(collider.offset.position, 0, 0, 0);
    expect(collider.material).toBeUndefined();
    expect(collider.friction).toBeUndefined();
    expect(collider.restitution).toBeUndefined();
    expect(collider.density).toBeUndefined();
    expect(collider.sensor).toBe(false);
    expect(collider.collisionGroups).toBe(ALL_COLLISION_GROUPS);
    expect(collider.collisionMask).toBe(ALL_COLLISION_GROUPS);
  });

  it("keeps every §24 field it is given", () => {
    const material = new PhysicsMaterial({ friction: 0.2 });
    const collider = sphereCollider({
      material,
      friction: 0.9,
      restitution: 0.4,
      density: 7800,
      sensor: true,
      collisionGroups: 0b0010,
      collisionMask: 0b0110,
    });

    expect(collider.material).toBe(material);
    expect(collider.friction).toBe(0.9);
    expect(collider.restitution).toBe(0.4);
    expect(collider.density).toBe(7800);
    expect(collider.sensor).toBe(true);
    expect(collider.collisionGroups).toBe(0b0010);
    expect(collider.collisionMask).toBe(0b0110);
  });

  it("copies the offset's position and rotation, ignoring scale and pivot", () => {
    const offset = new Transform();
    offset.position.set(1, 2, 3);
    offset.rotation.setFromAxisAngle(new Vector3(0, 1, 0), 0.5);
    offset.scale.set(2, 2, 2);
    offset.pivot.set(9, 9, 9);

    const collider = sphereCollider({ offset });
    expect(collider.offset).not.toBe(offset);
    expectVector(collider.offset.position, 1, 2, 3);
    expect([
      collider.offset.rotation.x,
      collider.offset.rotation.y,
      collider.offset.rotation.z,
      collider.offset.rotation.w,
    ]).toEqual([
      offset.rotation.x,
      offset.rotation.y,
      offset.rotation.z,
      offset.rotation.w,
    ]);
    expectVector(collider.offset.scale, 1, 1, 1);
    expectVector(collider.offset.pivot, 0, 0, 0);

    offset.position.set(0, 0, 0);
    expectVector(collider.offset.position, 1, 2, 3);
  });

  it("rejects a malformed shape on its own terms (§24, §85)", () => {
    expectValidationError(() =>
      sphereCollider({ shape: { type: "sphere", radius: 0 } }),
    );
    expectValidationError(() =>
      sphereCollider({
        shape: {
          type: "polygon",
          vertices: [new Vector2(0, 0), new Vector2(1, 0)],
        },
      }),
    );
  });

  it("rejects malformed §24 field values", () => {
    expectValidationError(() => sphereCollider({ friction: -1 }));
    expectValidationError(() => sphereCollider({ restitution: Number.NaN }));
    expectValidationError(() => sphereCollider({ density: -0.5 }));
    expectValidationError(() => sphereCollider({ collisionGroups: 1.5 }));
    expectValidationError(() => sphereCollider({ collisionMask: -1 }));
  });

  it("checks the offset against the dimension the shape implies", () => {
    const offset = new Transform();
    offset.position.set(0, 0, 1);

    // A circle is 2D-only, so an out-of-plane offset is wrong on its face.
    const error = expectValidationError(
      () => new Collider({ shape: { type: "circle", radius: 1 }, offset }),
    );
    expect(error.message).toContain("offset.position.z");

    // A capsule is legal in both dimensions, so construction stays permissive
    // and the plane constraint waits for the world (validateFor).
    expect(() => {
      new Collider({
        shape: { type: "capsule", radius: 0.5, halfHeight: 1 },
        offset,
      });
    }).not.toThrow();
  });
});

describe("Collider §25 material resolution", () => {
  it("prefers the explicit field, then the material, then the default", () => {
    const material = new PhysicsMaterial({
      friction: 0.2,
      restitution: 0.7,
      density: 1100,
    });

    const bare = sphereCollider();
    expect(bare.effectiveFriction).toBe(DEFAULT_FRICTION);
    expect(bare.effectiveRestitution).toBe(DEFAULT_RESTITUTION);
    expect(bare.effectiveDensity).toBe(DEFAULT_DENSITY);

    const shared = sphereCollider({ material });
    expect(shared.effectiveFriction).toBe(0.2);
    expect(shared.effectiveRestitution).toBe(0.7);
    expect(shared.effectiveDensity).toBe(1100);

    const explicit = sphereCollider({
      material,
      friction: 0.9,
      restitution: 0,
      density: 0,
    });
    expect(explicit.effectiveFriction).toBe(0.9);
    expect(explicit.effectiveRestitution).toBe(0);
    // Zero is a *set* density and still beats the material (§25).
    expect(explicit.effectiveDensity).toBe(0);
  });
});

describe("Collider body resolution (§23, §24, §6a)", () => {
  it("finds the RigidBody on its own node, whatever the attach order", () => {
    const first = new Group();
    const bodyFirst = first.addComponent(new RigidBody({ type: "dynamic" }));
    const colliderFirst = first.addComponent(sphereCollider());
    expect(colliderFirst.body).toBe(bodyFirst);
    expect(colliderFirst.requireBody()).toBe(bodyFirst);

    const second = new Group();
    const colliderSecond = second.addComponent(sphereCollider());
    expect(colliderSecond.body).toBeUndefined();
    const bodySecond = second.addComponent(new RigidBody({ type: "dynamic" }));
    expect(colliderSecond.body).toBe(bodySecond);
  });

  it("walks up to the nearest ancestor's body, so one body carries several", () => {
    const root = new Group();
    const body = root.addComponent(new RigidBody({ type: "dynamic" }));
    const middle = new Group();
    const leaf = new Group();
    root.add(middle);
    middle.add(leaf);

    const onBody = root.addComponent(sphereCollider());
    const onLeaf = leaf.addComponent(sphereCollider());
    expect(onBody.body).toBe(body);
    expect(onLeaf.body).toBe(body);

    // A nearer body wins over a farther one.
    const nearer = middle.addComponent(new RigidBody({ type: "static" }));
    expect(onLeaf.body).toBe(nearer);

    // Detaching the subtree leaves the leaf collider without a body again.
    middle.parent = null;
    nearer.host?.removeComponent(nearer);
    expect(onLeaf.body).toBeUndefined();
  });

  it("resolves against its own host only when that host is not a node", () => {
    const registry = new ComponentRegistry();
    const collider = registry.add(sphereCollider());
    expect(collider.body).toBeUndefined();

    const body = registry.add(new RigidBody({ type: "dynamic" }));
    expect(collider.body).toBe(body);
  });

  it("has no body while it is unattached", () => {
    expect(sphereCollider().body).toBeUndefined();
  });

  it("explains the missing body with an INVALID_SCENE_GRAPH error", () => {
    const collider = sphereCollider();
    let caught: unknown;
    try {
      collider.requireBody();
    } catch (error) {
      caught = error;
    }
    expect(isFourError(caught)).toBe(true);
    const error = caught as Error & {
      code: string;
      context?: Record<string, unknown>;
    };
    expect(error.code).toBe("INVALID_SCENE_GRAPH");
    expect(error.message).toContain("RigidBody");
    expect(error.context).toEqual({ attached: false, shape: "sphere" });
  });
});

describe("Collider world registration (§21, §37)", () => {
  it("validates the shape against the world's dimension", () => {
    const disc = new Collider({ shape: { type: "circle", radius: 1 } });
    expect(() => {
      disc.validateFor("2d");
    }).not.toThrow();
    const error = expectValidationError(() => {
      disc.validateFor("3d");
    });
    expect(error.message).toContain("circle");

    const ball = sphereCollider();
    expect(() => {
      ball.validateFor("3d");
    }).not.toThrow();
    expectValidationError(() => {
      ball.validateFor("2d");
    });
  });

  it("validates the offset plane at registration for a both-dimension shape", () => {
    const offset = new Transform();
    offset.position.set(0, 0, 1);
    const capsule = new Collider({
      shape: { type: "capsule", radius: 0.5, halfHeight: 1 },
      offset,
    });

    expect(() => {
      capsule.validateFor("3d");
    }).not.toThrow();
    expectValidationError(() => {
      capsule.validateFor("2d");
    });
  });

  it("catches a field corrupted after construction", () => {
    const collider = sphereCollider();
    collider.friction = -1;
    expectValidationError(() => {
      collider.validateFor("3d");
    });
  });

  it("produces the descriptor an adapter is handed, with §25 resolved", () => {
    const material = new PhysicsMaterial({ friction: 0.2, density: 1100 });
    const collider = sphereCollider({
      material,
      restitution: 0.4,
      sensor: true,
      collisionGroups: 0b0001,
      collisionMask: 0b0011,
    });
    const handle = makeBodyHandle("body-1");

    const descriptor = collider.toDescriptor(handle);
    expect(descriptor.body).toBe(handle);
    expect(descriptor.shape).toBe(collider.shape);
    expect(descriptor.offset).toBe(collider.offset);
    expect(descriptor.material).toBe(material);
    expect(descriptor.friction).toBe(0.2);
    expect(descriptor.restitution).toBe(0.4);
    expect(descriptor.density).toBe(1100);
    expect(descriptor.sensor).toBe(true);
    expect(descriptor.collisionGroups).toBe(0b0001);
    expect(descriptor.collisionMask).toBe(0b0011);

    const bare = sphereCollider().toDescriptor(handle);
    expect("material" in bare).toBe(false);
    expect(bare.friction).toBe(DEFAULT_FRICTION);
    expect(bare.restitution).toBe(DEFAULT_RESTITUTION);
    expect(bare.density).toBe(DEFAULT_DENSITY);
  });
});

describe("Collider events (§29, §6b)", () => {
  it("delivers §29 trigger payloads to the sensor's subscribers", () => {
    const node = new Group();
    const body = node.addComponent(new RigidBody({ type: "static" }));
    const sensor = node.addComponent(sphereCollider({ sensor: true }));
    const other = sphereCollider();
    const otherBody = new RigidBody({ type: "dynamic" });

    const seen: ColliderTriggerEvent[] = [];
    const unsubscribe = sensor.on("triggerenter", (event) => {
      seen.push(event);
    });
    sensor.on("triggerexit", (event) => {
      seen.push(event);
    });

    const enter: ColliderTriggerEvent = {
      type: "triggerenter",
      sensor,
      sensorBody: body,
      other,
      otherBody,
    };
    sensor.emit("triggerenter", enter);
    sensor.emit("triggerexit", { ...enter, type: "triggerexit" });
    expect(seen.map((event) => event.type)).toEqual([
      "triggerenter",
      "triggerexit",
    ]);
    expect(seen[0].sensorBody).toBe(body);

    unsubscribe();
    sensor.emit("triggerenter", enter);
    expect(seen).toHaveLength(2);
  });
});

describe("Collider as a §6a component", () => {
  it("attaches to a node and is found by type", () => {
    const node = new Group();
    const collider = node.addComponent(sphereCollider());

    expect(collider.host).toBe(node);
    expect(node.getComponent(Collider)).toBe(collider);
    expect(node.removeComponent(collider)).toBe(true);
    expect(collider.host).toBeNull();
  });

  it("is one per node: a second collider replaces the first with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const node = new Group();
    const first = node.addComponent(sphereCollider());
    const second = node.addComponent(sphereCollider());

    expect(node.getComponent(Collider)).toBe(second);
    expect(first.host).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("drops listeners on dispose (§83)", () => {
    const registry = new ComponentRegistry();
    const collider = registry.add(sphereCollider());
    collider.on("triggerenter", () => undefined);

    registry.disposeAll();

    expect(collider.host).toBeNull();
    expect(collider.listenerCount("triggerenter")).toBe(0);
  });
});

describe("Collider disposal (§83 stability audit, 2026-09-11)", () => {
  it("disposes idempotently and refuses registration afterwards", () => {
    const collider = sphereCollider();
    collider.on("triggerenter", vi.fn());
    expect(collider.disposed).toBe(false);

    collider.dispose();
    expect(collider.disposed).toBe(true);
    expect(collider.listenerCount("triggerenter")).toBe(0);
    // A second dispose is a no-op (§83: idempotent), not an error.
    expect(() => collider.dispose()).not.toThrow();
    expect(collider.disposed).toBe(true);

    // Disposal is terminal (§83): the world's registration gate — validateFor
    // then toDescriptor, in `addBody` / `addCollider` — refuses with §89's
    // INVALID_APPLICATION_STATE.
    expect(
      expectValidationError(() => collider.validateFor("3d")).message,
    ).toMatch(/Collider is disposed.*§83/s);
    expectValidationError(() => collider.toDescriptor(makeBodyHandle("b")));
    // Plain reads stay answerable for teardown code.
    expect(collider.shape).toEqual({ type: "sphere", radius: 0.5 });
  });
});
