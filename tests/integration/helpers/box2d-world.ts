/**
 * Small public-API kit for the Box2D conformance (W8.4) and determinism
 * suites: a headless 2D `PhysicsWorld` on `"box2d"` (resolved through a private
 * `SolverRegistry`), plus ball / slab builders. Deliberately separate from
 * `physics-scenarios.ts`, which is Rapier-shaped and being made
 * adapter-parameterisable elsewhere.
 */

import { Vector2, Vector3 } from "@fourjs/math";
import {
  Collider,
  PhysicsWorld,
  RigidBody,
  SolverRegistry,
} from "@fourjs/physics";
import { registerBox2dSolver } from "@fourjs/physics-box2d";
import { Group } from "@fourjs/scene";

export const DT = 1 / 60;

export interface Part {
  readonly node: Group;
  readonly body: RigidBody;
  readonly collider: Collider;
}

export interface PartOptions {
  position?: Vector3;
  type?: "static" | "dynamic";
  restitution?: number;
  friction?: number;
  sensor?: boolean;
  mass?: number;
}

/** A fresh registry holding only `box2d`. */
export function box2dRegistry(): SolverRegistry {
  const registry = new SolverRegistry();
  registerBox2dSolver(registry);
  return registry;
}

/** Initialized 2D world on box2d; extra options merge over the defaults. */
export type Box2dWorldExtra = Partial<
  ConstructorParameters<typeof PhysicsWorld>[0]
>;

export async function createBox2dWorld(
  extra: Box2dWorldExtra = {},
): Promise<PhysicsWorld> {
  const world = new PhysicsWorld({
    dimension: "2d",
    solver: "box2d",
    solverRegistry: box2dRegistry(),
    ...extra,
  });
  await world.initialize();
  return world;
}

function part(
  world: PhysicsWorld,
  shape: ConstructorParameters<typeof Collider>[0]["shape"],
  options: PartOptions,
): Part {
  const node = new Group();
  const type = options.type ?? "dynamic";
  node.transform.position.copy(options.position ?? new Vector3(0, 0, 0));
  node.transformAuthority = type === "dynamic" ? "physics" : "manual";
  const body = new RigidBody({
    type,
    ...(options.mass === undefined ? {} : { mass: options.mass }),
  });
  node.addComponent(body);
  const collider = new Collider({
    shape,
    ...(options.restitution === undefined
      ? {}
      : { restitution: options.restitution }),
    ...(options.friction === undefined ? {} : { friction: options.friction }),
    ...(options.sensor === undefined ? {} : { sensor: options.sensor }),
  });
  node.addComponent(collider);
  world.addBody(node);
  return { node, body, collider };
}

export function ball(
  world: PhysicsWorld,
  radius: number,
  options: PartOptions = {},
): Part {
  return part(world, { type: "circle", radius }, options);
}

export function slab(
  world: PhysicsWorld,
  halfWidth: number,
  halfHeight: number,
  options: PartOptions = {},
): Part {
  return part(
    world,
    { type: "rectangle", halfExtents: new Vector2(halfWidth, halfHeight) },
    options,
  );
}

/** Static ground whose top face is at y = 0. */
export function ground(world: PhysicsWorld, options: PartOptions = {}): Part {
  return slab(world, 50, 0.5, {
    ...options,
    type: "static",
    position: new Vector3(0, -0.5, 0),
  });
}

/** `n` fixed steps, dispatching events after each (§39 step 9). */
export function run(world: PhysicsWorld, n: number): void {
  for (let i = 0; i < n; i += 1) {
    world.step(DT);
    world.dispatchEvents();
  }
}
