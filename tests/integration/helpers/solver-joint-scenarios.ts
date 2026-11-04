/** Small solver-agnostic joint builders for `physics-solvers.test.ts`. */
import { Vector3 } from "@fourjs/math";
import { HingeJoint, type PhysicsWorld } from "@fourjs/physics";

import { addBall, type DimensionKit } from "./physics-scenarios.js";
import { addAnchor } from "./joint-scenarios.js";

/** Static anchor body at `position` (shared with the Rapier joint suite). */
export function addAnchorFor(
  world: PhysicsWorld,
  position: Vector3,
): ReturnType<typeof addAnchor> {
  return addAnchor(world, position, "anchor");
}

/** A hinge pendulum: pivot at the origin, bob 1 m away at 0.2 rad. */
export function buildHinge(
  world: PhysicsWorld,
  kit: DimensionKit,
): { radialError(): number } {
  const pivot = new Vector3(0, 0, 0);
  const anchor = addAnchor(world, pivot, "pivot");
  const bob = addBall(world, kit, "dynamic", 0.02, {
    position: new Vector3(Math.sin(0.2), -Math.cos(0.2), 0),
  });
  world.addJoint(
    new HingeJoint({
      bodyA: anchor.body,
      bodyB: bob.body,
      anchor: pivot,
      axis: new Vector3(0, 0, 1),
    }),
  );
  return {
    radialError(): number {
      return Math.abs(bob.node.transform.position.length() - 1);
    },
  };
}
