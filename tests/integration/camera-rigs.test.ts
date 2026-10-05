/**
 * §44's camera rigs and §42's `"constraint"` authority, across the packages
 * that have to agree (R-36 rig half + PH-11, 2026-08-13).
 *
 * `ConstraintSystem` is the first producing system §42's `"constraint"`
 * authority has ever had, and the claims that no unit test inside
 * `@fourjs/motion` can make are about what happens *between* packages:
 *
 * 1. **The refusal is the one §42 describes.** A node owned by `"physics"`
 *    carrying a targeted rig is refused every step, warned about **once**, in a
 *    message naming both the writer and the owner — and the instant the
 *    application grants the authority, the very next step writes, with no
 *    second warning. That is `@fourjs/scene`'s `warnAuthorityConflict` and
 *    `@fourjs/motion`'s system agreeing about a rule neither of them owns alone.
 * 2. **§44's path-animated camera is two nodes, and works.** §42 allows exactly
 *    one owner per transform, so a camera that flies a §13 trajectory *and*
 *    aims at a subject cannot be one node: it is a path-driven parent under
 *    `"kinematic"` (`KinematicController.followPath`) carrying an aimed child
 *    under `"constraint"`. This file flies one for 120 fixed steps and checks
 *    the subject lands dead centre of the frame on **every** step, through
 *    `viewMatrix · projectionMatrix` — the §47 chain, not the rig's own
 *    arithmetic.
 * 3. **§44's physics attachment is not just the priority numbers.** A
 *    `FollowRig` + `LookAtConstraint` under `"constraint"` authority chase a
 *    Rapier 3D dynamic body stepped at `PRIORITY_PHYSICS_SOLVE` (600); the
 *    camera writes at 700, so it sees the pose the solver produced this step.
 *    Until 2026-08-30 this file faked the solver by writing `body.position`
 *    by hand.
 */

import { Vector3 } from "@fourjs/math";
import {
  CircularTrajectory,
  ConstraintSystem,
  FollowRig,
  KinematicController,
  KinematicSystem,
  LookAtConstraint,
  OrbitRig,
  PRIORITY_CONSTRAINTS,
  PRIORITY_KINEMATICS,
  PRIORITY_PHYSICS_SOLVE,
  SystemRegistry,
  createTimeState,
} from "@fourjs/motion";
import {
  Collider,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
} from "@fourjs/physics";
import { Rapier3dAdapter } from "@fourjs/physics-rapier";
import {
  Group,
  PerspectiveCamera,
  Scene,
  runOwnedTransformWrite,
} from "@fourjs/scene";
import * as four from "fourJS";
import { afterEach, describe, expect, it, vi } from "vitest";

const DT = 1 / 60;

/** Silences and records `console.warn` for one test. */
function spyOnWarn() {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Projects `point` through a camera's view and projection matrices and returns
 * its normalized device coordinates — the test's own arithmetic, so nothing
 * here can agree with the engine by sharing a helper with it.
 */
function projectToNdc(camera: PerspectiveCamera, point: Vector3): Vector3 {
  const v = camera.viewMatrix.elements;
  const cx = v[0] * point.x + v[4] * point.y + v[8] * point.z + v[12];
  const cy = v[1] * point.x + v[5] * point.y + v[9] * point.z + v[13];
  const cz = v[2] * point.x + v[6] * point.y + v[10] * point.z + v[14];

  const p = camera.projectionMatrix.elements;
  const clipX = p[0] * cx + p[4] * cy + p[8] * cz + p[12];
  const clipY = p[1] * cx + p[5] * cy + p[9] * cz + p[13];
  const clipZ = p[2] * cx + p[6] * cy + p[10] * cz + p[14];
  const clipW = p[3] * cx + p[7] * cy + p[11] * cz + p[15];
  return new Vector3(clipX / clipW, clipY / clipW, clipZ / clipW);
}

describe("§42's constraint authority, end to end", () => {
  it("refuses a rig on a physics-owned node, warns once, then writes the step authority is granted", () => {
    const warn = spyOnWarn();
    const scene = new Scene();
    const subject = new Group();
    subject.position.set(0, 0, -4);
    const camera = new PerspectiveCamera({ aspect: 16 / 9 });
    // The body is the solver's; the rig is not allowed to move it.
    camera.transformAuthority = "physics";
    camera.addComponent(new OrbitRig({ target: subject, distance: 3 }));
    const aim = camera.addComponent(new LookAtConstraint({ target: subject }));
    scene.add(subject, camera);

    const registry = new SystemRegistry();
    const constraints = new ConstraintSystem();
    registry.register(constraints);
    constraints.track(camera);
    const time = createTimeState({ fixedDeltaTime: DT });

    for (let step = 0; step < 5; step += 1) {
      registry.runFixedStep(time);
    }

    expect(camera.position.equalsApprox(new Vector3(0, 0, 0), 0)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain("§42");
    expect(message).toContain('"constraint"');
    expect(message).toContain('"physics"');
    // Refused is not skipped: the two states are deliberately distinguishable.
    expect(aim.skippedSteps).toBe(0);

    // The application hands the transform over; the next step writes.
    camera.transformAuthority = "constraint";
    registry.runFixedStep(time);

    expect(camera.position.equalsApprox(new Vector3(0, 0, -1), 1e-12)).toBe(
      true,
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("lets a physics-owned target drive a constraint-owned camera", () => {
    // The other half of §42's one-owner rule: two nodes, two authorities, no
    // conflict — the rig only ever writes its own node.
    const warn = spyOnWarn();
    const scene = new Scene();
    const body = new Group();
    body.transformAuthority = "physics";
    const camera = new PerspectiveCamera({ aspect: 1 });
    camera.transformAuthority = "constraint";
    camera.addComponent(
      new FollowRig({ target: body, offset: new Vector3(0, 2, 6) }),
    );
    camera.addComponent(new LookAtConstraint({ target: body }));
    scene.add(body, camera);

    const constraints = new ConstraintSystem();
    constraints.track(camera);
    const registry = new SystemRegistry();
    registry.register(constraints);
    const time = createTimeState({ fixedDeltaTime: DT });

    for (let step = 1; step <= 30; step += 1) {
      // The physics owner writing its own node — the stand-in for the solver.
      // An unwrapped `position.set` is an application write and warns in DEV.
      runOwnedTransformWrite(() => {
        body.position.set(step * 0.1, 0, 0);
      });
      registry.runFixedStep(time);
      camera.updateViewMatrix();

      expect(
        camera.position.equalsApprox(new Vector3(step * 0.1, 2, 6), 1e-12),
      ).toBe(true);
      const ndc = projectToNdc(camera, body.position);
      expect(ndc.x).toBeCloseTo(0, 12);
      expect(ndc.y).toBeCloseTo(0, 12);
    }
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("§44 path animation, composed from two nodes", () => {
  it("flies a camera around a circle while it keeps the subject centred", () => {
    const warn = spyOnWarn();
    const scene = new Scene();

    // The subject the camera watches, standing still at the circle's centre
    // height so the aim is never parallel to +Y.
    const subject = new Group();
    subject.position.set(0, 1.5, 0);

    // Node 1: the dolly, owned by `"kinematic"`, driven along §13's circle.
    const dolly = new Group();
    dolly.transformAuthority = "kinematic";
    const controller = dolly.addComponent(new KinematicController());
    controller.followPath(
      new CircularTrajectory({
        center: new Vector3(0, 0, 0),
        radius: 8,
        angularVelocity: 0.9,
      }),
      { loop: true },
    );

    // Node 2: the camera, owned by `"constraint"`, aimed every step. It rides
    // the dolly, at its own height offset, so both authorities write in the
    // same step without ever touching the same transform.
    const camera = new PerspectiveCamera({ aspect: 16 / 9 });
    camera.position.set(0, 3, 0);
    camera.transformAuthority = "constraint";
    camera.addComponent(new LookAtConstraint({ target: subject }));

    dolly.add(camera);
    scene.add(subject, dolly);

    const registry = new SystemRegistry();
    const kinematics = new KinematicSystem();
    const constraints = new ConstraintSystem();
    registry.register(kinematics);
    registry.register(constraints);
    kinematics.track(dolly);
    constraints.track(camera);
    expect(kinematics.priority).toBe(PRIORITY_KINEMATICS);
    expect(constraints.priority).toBe(PRIORITY_CONSTRAINTS);
    expect(PRIORITY_KINEMATICS).toBeLessThan(PRIORITY_CONSTRAINTS);

    const time = createTimeState({ fixedDeltaTime: DT });
    const positions: number[] = [];
    for (let step = 1; step <= 120; step += 1) {
      registry.runFixedStep(time);
      camera.updateViewMatrix();

      const ndc = projectToNdc(camera, subject.position);
      expect(ndc.x).toBeCloseTo(0, 12);
      expect(ndc.y).toBeCloseTo(0, 12);
      // In front of the camera, inside the frustum.
      expect(ndc.z).toBeGreaterThan(-1);
      expect(ndc.z).toBeLessThan(1);

      positions.push(dolly.position.x);
    }

    // The camera really flew: the dolly swept a full circle, and the camera
    // rode it rather than sitting where it started.
    expect(Math.max(...positions) - Math.min(...positions)).toBeGreaterThan(8);
    expect(camera.position.y).toBe(3);
    // Two authorities, two nodes, no conflict to report.
    expect(warn).not.toHaveBeenCalled();
  });

  it("exposes the rigs and the system through the umbrella (§97a)", () => {
    expect(four.motion.OrbitRig).toBe(OrbitRig);
    expect(four.motion.FollowRig).toBe(FollowRig);
    expect(four.motion.LookAtConstraint).toBe(LookAtConstraint);
    expect(four.motion.ConstraintSystem).toBe(ConstraintSystem);
    expect(four.motion.DEFAULT_ORBIT_PITCH_LIMIT).toBe(Math.PI / 2 - 1e-3);
  });

  it("lets a FollowRig chase a live Rapier dynamic body (§44 physics attachment)", async () => {
    const world = new PhysicsWorld({
      dimension: "3d",
      adapter: new Rapier3dAdapter(),
    });
    await world.initialize();
    try {
      const body = new Group();
      body.transformAuthority = "physics";
      body.position.set(0, 4, 0);
      body.addComponent(new RigidBody({ type: "dynamic", mass: 1 }));
      body.addComponent(
        new Collider({ shape: { type: "sphere", radius: 0.5 } }),
      );
      world.addBody(body);

      const camera = new PerspectiveCamera({ aspect: 1 });
      camera.transformAuthority = "constraint";
      const offset = new Vector3(0, 2, 6);
      camera.addComponent(new FollowRig({ target: body, offset }));
      camera.addComponent(new LookAtConstraint({ target: body }));

      const scene = new Scene();
      scene.add(body, camera);

      const physics = new PhysicsSystem({ worlds: [world] });
      const constraints = new ConstraintSystem();
      constraints.track(camera);
      const registry = new SystemRegistry();
      registry.register(physics);
      registry.register(constraints);
      expect(physics.priority).toBe(PRIORITY_PHYSICS_SOLVE);
      expect(constraints.priority).toBe(PRIORITY_CONSTRAINTS);
      expect(PRIORITY_PHYSICS_SOLVE).toBeLessThan(PRIORITY_CONSTRAINTS);

      const time = createTimeState({ fixedDeltaTime: DT });
      const startY = body.position.y;
      for (let step = 0; step < 30; step += 1) {
        registry.runFixedStep(time);
      }

      expect(body.position.y).toBeLessThan(startY - 0.5);
      expect(camera.position.x).toBeCloseTo(body.position.x + offset.x, 5);
      expect(camera.position.y).toBeCloseTo(body.position.y + offset.y, 5);
      expect(camera.position.z).toBeCloseTo(body.position.z + offset.z, 5);

      camera.updateViewMatrix();
      const ndc = projectToNdc(camera, body.position);
      expect(ndc.x).toBeCloseTo(0, 4);
      expect(ndc.y).toBeCloseTo(0, 4);
    } finally {
      world.dispose();
    }
  });
});
