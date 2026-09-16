/**
 * Descriptor validation (§85), for the physics half of the checklist.
 *
 * §85 requires development builds to detect, among other things: NaN and
 * infinite values, **invalid physics dimensions**, and **impossible
 * mass/inertia values**. This module is where the physics package does that,
 * once, at the boundary where a descriptor enters the engine — before a solver
 * turns a bad number into an exploding simulation three steps later, and before
 * a WebAssembly adapter turns it into an unreadable trap.
 *
 * ## Contract
 *
 * Every validator either returns `undefined` or throws a `FourError` (§89)
 * carrying `INVALID_APPLICATION_STATE`, a message that names the section it
 * enforces, and a `context` with the offending field and value. There is no
 * "collect all errors" mode: the first problem is reported with the detail
 * needed to fix it, which is what the animation package does for the same class
 * of failure.
 *
 * `INVALID_APPLICATION_STATE` and not `PHYSICS_SOLVER_FAILED` (§89): the solver
 * has not run and has not failed — the *caller* handed the engine something it
 * cannot simulate. §89's list is explicitly the engine's current vocabulary
 * rather than a closed set, so a dedicated physics-input code can be added
 * later without changing these call sites.
 *
 * ## Where validation runs
 *
 * At descriptor level, which is the last point where all of a body's or
 * collider's properties are visible together, and the point §37 hands them to
 * an adapter. §85's "production builds may disable expensive validation while
 * preserving essential safety checks" applies to the per-step paths, not to
 * these: creating a body is not a hot path, and everything here is a handful of
 * numeric comparisons.
 *
 * These functions are pure and take the world's dimension explicitly rather
 * than reading it from a world, so they can be used by a serializer, an editor,
 * or a test with no world in existence.
 */

import { FourError } from "@fourjs/core";
import type { Matrix3 } from "@fourjs/math";

import type {
  AngularJointMotor,
  ColliderDescriptor,
  JointDescriptor,
  JointLimits,
  LinearJointMotor,
  PhysicsWorldOptions,
  RigidBodyDescriptor,
  ShippedJointType,
  SphericalJointLimits,
} from "./descriptors.js";
import {
  JOINT_TYPES,
  SHIPPED_JOINT_TYPES,
  STAGED_JOINT_TYPES,
  jointTypeSupportsDimension,
  resolveGravity,
  resolveRotation,
} from "./descriptors.js";
import { validateCollisionShape } from "./shapes.js";
import type { BodyType, PhysicsDimension, Vector3Input } from "./types.js";
import {
  BODY_TYPES,
  CCD_MODES,
  DEFAULT_ENABLED_CCD_MODE,
  DETERMINISM_LEVELS,
  PHYSICS_DIMENSIONS,
} from "./types.js";

/** See the module header for why every failure here uses this §89 code. */
const VALIDATION_ERROR_CODE = "INVALID_APPLICATION_STATE";

/** Raises a §85 validation failure. */
function fail(message: string, context: Record<string, unknown>): never {
  throw new FourError(VALIDATION_ERROR_CODE, message, { context });
}

/** §85: "NaN and infinite values". */
function requireFinite(field: string, value: number): void {
  if (!Number.isFinite(value)) {
    fail(`${field} must be a finite number; got ${String(value)} (§85).`, {
      field,
      value,
    });
  }
}

/** §85: a coefficient that may be zero but never negative or non-finite. */
function requireNonNegative(field: string, value: number): void {
  requireFinite(field, value);
  if (value < 0) {
    fail(`${field} must be >= 0; got ${String(value)} (§85).`, {
      field,
      value,
    });
  }
}

/** §85: a parameter that must be strictly positive — a length, a stiffness. */
function requirePositive(field: string, value: number): void {
  requireFinite(field, value);
  if (value <= 0) {
    fail(`${field} must be > 0; got ${String(value)} (§85).`, {
      field,
      value,
    });
  }
}

/** §24: `collisionGroups` and `collisionMask` are 32-bit bit sets. */
function requireBitSet(field: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    fail(
      `${field} must be an integer bit set in [0, 0xffffffff]; got ${String(value)} (§24, §85).`,
      { field, value },
    );
  }
}

/**
 * §21/§85: a positional input must be finite, and in a `"2d"` world it must lie
 * in the XY plane. A `Vector2` always does; a `Vector3` must say so.
 */
function requirePlanarVector(
  field: string,
  value: Vector3Input,
  dimension: PhysicsDimension,
): void {
  requireFinite(`${field}.x`, value.x);
  requireFinite(`${field}.y`, value.y);
  if (!("z" in value)) {
    return;
  }
  requireFinite(`${field}.z`, value.z);
  if (dimension === "2d" && value.z !== 0) {
    fail(
      `A "2d" world simulates in the XY plane, so ${field}.z must be 0; got ${String(value.z)} (§21, §85). Pass a Vector2 to say the same thing.`,
      { field, dimension, z: value.z },
    );
  }
}

/**
 * §23's mass rule: *"`mass` must be positive on dynamic bodies (validated,
 * §85); non-simulated mass is expressed through the static and kinematic body
 * types, never `mass = 0`."*
 *
 * Exported because the `RigidBody` component's `mass` setter (WP-5.2) enforces
 * the same rule on assignment, and there must be exactly one statement of it.
 * An omitted mass is legal at any body type — §23 derives it from collider
 * density then (§24, §25).
 */
export function validateMass(bodyType: BodyType, mass?: number): void {
  if (mass === undefined) {
    return;
  }
  requireFinite("mass", mass);
  if (bodyType === "dynamic" && mass <= 0) {
    fail(
      `A dynamic body's mass must be positive; got ${String(mass)} (§23, §85). Use the "static" or a kinematic body type for a body that does not respond to forces — never mass = 0.`,
      { field: "mass", bodyType, mass },
    );
  }
  if (mass < 0) {
    fail(`mass must not be negative; got ${String(mass)} (§23, §85).`, {
      field: "mass",
      bodyType,
      mass,
    });
  }
}

/**
 * §85's "impossible mass/inertia values" for the inertia tensor (§23).
 *
 * Every entry must be finite and the three diagonal entries — the principal
 * moments — must be non-negative, because a negative moment of inertia
 * describes no physical body and makes the angular solve diverge. Off-diagonal
 * products of inertia are legitimately signed and are only checked for
 * finiteness.
 *
 * In a `"2d"` world only the Z diagonal entry is used (§23), so the rest is
 * still checked for sanity but cannot affect the simulation.
 */
export function validateInertiaTensor(tensor: Matrix3): void {
  const { elements } = tensor;
  for (let i = 0; i < 9; i += 1) {
    requireFinite(`inertiaTensor[${String(i)}]`, elements[i]);
  }
  // Column-major (§7b): the diagonal is elements 0, 4, 8.
  for (const index of [0, 4, 8]) {
    if (elements[index] < 0) {
      fail(
        `inertiaTensor[${String(index)}] is a principal moment of inertia and must be >= 0; got ${String(elements[index])} (§23, §85).`,
        { field: `inertiaTensor[${String(index)}]`, value: elements[index] },
      );
    }
  }
}

/**
 * Validates a body descriptor against §22, §23, §31, and the §21 plane
 * constraint of a `"2d"` world.
 *
 * Checked: the body type is one of §22's four; the §23 mass rule; the inertia
 * tensor; every positional and velocity input is finite and in-plane; damping
 * and gravity scale; and that
 * `continuousCollisionDetection` and `ccdMode` do not contradict each other
 * (§23 carries the switch, §31 the mode — see `RigidBodyDescriptor.ccdMode`).
 */
export function validateRigidBodyDescriptor(
  desc: RigidBodyDescriptor,
  dimension: PhysicsDimension,
): void {
  if (!BODY_TYPES.includes(desc.type)) {
    fail(
      `Unknown body type ${JSON.stringify(desc.type)}; expected one of ${BODY_TYPES.join(", ")} (§22).`,
      { field: "type", value: desc.type },
    );
  }

  validateMass(desc.type, desc.mass);

  if (desc.inertiaTensor !== undefined) {
    validateInertiaTensor(desc.inertiaTensor);
  }

  if (desc.position !== undefined) {
    requirePlanarVector("position", desc.position, dimension);
  }
  if (desc.centerOfMass !== undefined) {
    requirePlanarVector("centerOfMass", desc.centerOfMass, dimension);
  }
  if (desc.linearVelocity !== undefined) {
    requirePlanarVector("linearVelocity", desc.linearVelocity, dimension);
  }

  if (desc.rotation !== undefined) {
    // resolveRotation carries the §21 "rotation is about +Z in 2d" rule and the
    // finiteness check for the scalar form; reusing it keeps one statement of
    // the rule. The resolved quaternion is discarded — this is a check.
    resolveRotation(dimension, desc.rotation);
  }

  if (desc.angularVelocity !== undefined) {
    const angular = desc.angularVelocity;
    if (typeof angular === "number") {
      requireFinite("angularVelocity", angular);
    } else {
      requireFinite("angularVelocity.x", angular.x);
      requireFinite("angularVelocity.y", angular.y);
      requireFinite("angularVelocity.z", angular.z);
      if (dimension === "2d" && (angular.x !== 0 || angular.y !== 0)) {
        fail(
          `A "2d" world spins about +Z only, so angularVelocity.x and .y must be 0; got (${String(angular.x)}, ${String(angular.y)}) (§21, §85).`,
          { field: "angularVelocity", dimension },
        );
      }
    }
  }

  if (desc.linearDamping !== undefined) {
    requireNonNegative("linearDamping", desc.linearDamping);
  }
  if (desc.angularDamping !== undefined) {
    requireNonNegative("angularDamping", desc.angularDamping);
  }
  if (desc.gravityScale !== undefined) {
    requireFinite("gravityScale", desc.gravityScale);
  }

  if (desc.ccdMode !== undefined) {
    if (!CCD_MODES.includes(desc.ccdMode)) {
      fail(
        `Unknown CCD mode ${JSON.stringify(desc.ccdMode)}; expected one of ${CCD_MODES.join(", ")} (§31).`,
        { field: "ccdMode", value: desc.ccdMode },
      );
    }
    if (
      desc.continuousCollisionDetection === false &&
      desc.ccdMode !== "disabled"
    ) {
      fail(
        `continuousCollisionDetection is false but ccdMode is ${JSON.stringify(desc.ccdMode)} (§23, §31). Drop one of the two rather than leaving the engine to guess which you meant.`,
        { field: "ccdMode", value: desc.ccdMode },
      );
    }
  }

  if (desc.ccdPredictionDistance !== undefined) {
    const distance = desc.ccdPredictionDistance;
    if (!Number.isFinite(distance) || distance <= 0) {
      fail(
        `ccdPredictionDistance must be a positive finite distance in world units (§31); got ${String(distance)} (§85).`,
        { field: "ccdPredictionDistance", value: distance },
      );
    }
    // The distance parameterizes speculative contact generation and nothing
    // else, so giving it with any other resolved mode is the same class of
    // contradiction as the switch/mode conflict above.
    const speculative =
      desc.ccdMode === "speculative" ||
      (desc.ccdMode === undefined &&
        desc.continuousCollisionDetection === true &&
        DEFAULT_ENABLED_CCD_MODE === "speculative");
    if (!speculative) {
      fail(
        `ccdPredictionDistance only parameterizes "speculative" CCD, but the resolved mode is not speculative (§31). Set ccdMode: "speculative", or drop the distance.`,
        { field: "ccdPredictionDistance", value: distance },
      );
    }
  }
}

/**
 * Validates a collider descriptor against §24, §25, and the world's dimension
 * (§21).
 *
 * The shape is checked by `validateCollisionShape`, including that it belongs
 * to `dimension` — a `"circle"` in a 3D world is rejected here rather than
 * silently promoted to a sphere.
 */
export function validateColliderDescriptor(
  desc: ColliderDescriptor,
  dimension: PhysicsDimension,
): void {
  validateCollisionShape(desc.shape, dimension);

  if (desc.friction !== undefined) {
    requireNonNegative("friction", desc.friction);
  }
  if (desc.restitution !== undefined) {
    requireNonNegative("restitution", desc.restitution);
  }
  if (desc.density !== undefined) {
    requireNonNegative("density", desc.density);
  }
  if (desc.collisionGroups !== undefined) {
    requireBitSet("collisionGroups", desc.collisionGroups);
  }
  if (desc.collisionMask !== undefined) {
    requireBitSet("collisionMask", desc.collisionMask);
  }
  if (desc.offset !== undefined) {
    requirePlanarVector("offset.position", desc.offset.position, dimension);
    resolveRotation(dimension, desc.offset.rotation);
  }
}

/**
 * Validates a joint's travel limits (§28 "limits"): finite bounds with
 * `min <= max`.
 *
 * Exported because the `HingeJoint` and `SliderJoint` setters enforce the same
 * rule on assignment, and there must be exactly one statement of it. Radians or
 * metres depending on the joint; the rule is the same either way.
 */
export function validateJointLimits(field: string, limits: JointLimits): void {
  requireFinite(`${field}.min`, limits.min);
  requireFinite(`${field}.max`, limits.max);
  if (limits.min > limits.max) {
    fail(
      `${field}.min must be <= ${field}.max; got [${String(limits.min)}, ${String(limits.max)}] (§28, §85). Equal bounds lock the axis.`,
      { field, min: limits.min, max: limits.max },
    );
  }
}

/**
 * Validates a ball joint's swing cone and optional twist (§28 "limits").
 *
 * The cone half-angle must be in `(0, π]`: zero would weld the swing — which
 * is a fixed joint, not a limited ball joint — and more than π is not a cone.
 */
export function validateSphericalJointLimits(
  field: string,
  limits: SphericalJointLimits,
): void {
  requireFinite(`${field}.coneAngle`, limits.coneAngle);
  if (limits.coneAngle <= 0 || limits.coneAngle > Math.PI) {
    fail(
      `${field}.coneAngle is a half-angle in radians and must be in (0, π]; got ${String(limits.coneAngle)} (§28, §85). Use a FixedJoint to remove the swing entirely.`,
      { field: `${field}.coneAngle`, value: limits.coneAngle },
    );
  }
  if (limits.twist !== undefined) {
    validateJointLimits(`${field}.twist`, limits.twist);
  }
}

/** Validates a revolute joint's velocity motor (§28 "motors"). */
export function validateAngularJointMotor(
  field: string,
  motor: AngularJointMotor,
): void {
  requireFinite(`${field}.targetVelocity`, motor.targetVelocity);
  requireNonNegative(`${field}.maxTorque`, motor.maxTorque);
}

/** Validates a prismatic joint's velocity motor (§28 "motors"). */
export function validateLinearJointMotor(
  field: string,
  motor: LinearJointMotor,
): void {
  requireFinite(`${field}.targetVelocity`, motor.targetVelocity);
  requireNonNegative(`${field}.maxForce`, motor.maxForce);
}

/**
 * Validates a §28 break threshold: finite and **positive**.
 *
 * Zero is rejected rather than read as "breaks immediately": a joint that
 * cannot survive its own creation is never what a caller meant, and omitting
 * the threshold is how "never breaks" is expressed (plan P6-2).
 */
export function validateJointBreakThreshold(
  field: string,
  value: number,
): void {
  requireFinite(field, value);
  if (value <= 0) {
    fail(
      `${field} must be positive; got ${String(value)} (§28, §85). Omit it for a joint that never breaks.`,
      { field, value },
    );
  }
}

/**
 * Rejects a §28 joint type this phase does not build, with the reason (plan
 * P6-1).
 *
 * Three ways to fail, three different messages, because they need three
 * different fixes: a *staged* type (`distance`, `gear`) is a type no solver
 * here can honour; `motorized` is a type that exists as the `motor` field of
 * another joint; anything else is not a §28 type at all.
 */
function failUnshippedJointType(type: string): never {
  if (type === "motorized") {
    fail(
      'A "motorized" joint is not a type of its own: §28\'s own example drives a hinge through its `motor` field, so use a revolute or prismatic joint with `motor: { enabled, targetVelocity, maxTorque | maxForce }` (§28, plan P6-1).',
      { field: "type", value: type },
    );
  }
  if ((STAGED_JOINT_TYPES as readonly string[]).includes(type)) {
    fail(
      `Joint type ${JSON.stringify(type)} is staged and does not ship in this phase (plan P6-1): no solver here can honour it — Rapier has no rigid distance joint (its rope caps a maximum distance only) and no gear joint, and emulating either would misrepresent §28. This phase ships ${SHIPPED_JOINT_TYPES.join(", ")}.`,
      { field: "type", value: type, staged: [...STAGED_JOINT_TYPES] },
    );
  }
  fail(
    `Unknown joint type ${JSON.stringify(type)}; §28 names ${JOINT_TYPES.join(", ")} and this phase ships ${SHIPPED_JOINT_TYPES.join(", ")} (plan P6-1).`,
    { field: "type", value: type },
  );
}

/**
 * §21/§28: a joint axis must be a real direction, and the dimension decides
 * which directions exist.
 *
 * In a `"2d"` world the two rules are mirror images: a **revolute** joint turns
 * about the plane normal, so its axis must be along ±Z, while a **prismatic**
 * joint slides *within* the plane, so its axis must have `z === 0`. In a `"3d"`
 * world any non-zero direction will do — and the zero vector is precisely how a
 * hinge that was never given an axis arrives here, which is why the message
 * says so.
 */
function requireJointAxis(
  type: ShippedJointType,
  field: string,
  value: Vector3Input,
  dimension: PhysicsDimension,
): void {
  requireFinite(`${field}.x`, value.x);
  requireFinite(`${field}.y`, value.y);
  const z = "z" in value ? value.z : 0;
  requireFinite(`${field}.z`, z);

  if (dimension === "2d") {
    if (type === "revolute") {
      if (value.x !== 0 || value.y !== 0 || z === 0) {
        fail(
          `A "2d" world rotates about +Z only, so a revolute joint's ${field} must be along ±Z; got (${String(value.x)}, ${String(value.y)}, ${String(z)}) (§21, §28). Omit the axis to accept the default.`,
          { field, dimension, type },
        );
      }
      return;
    }
    if (z !== 0 || (value.x === 0 && value.y === 0)) {
      fail(
        `A "2d" world slides in the XY plane, so a prismatic joint's ${field} must be a non-zero direction with z = 0; got (${String(value.x)}, ${String(value.y)}, ${String(z)}) (§21, §28).`,
        { field, dimension, type },
      );
    }
    return;
  }

  if (value.x === 0 && value.y === 0 && z === 0) {
    fail(
      `A ${type} joint's ${field} must be a non-zero direction; got the zero vector (§28, §85). In a "3d" world the axis has no default — name the axis the joint turns or slides along.`,
      { field, dimension, type },
    );
  }
}

/**
 * Validates a joint descriptor against §28, plan P6-1's shipped tier, and the
 * world's dimension (§21).
 *
 * Checked, in this order: the type ships at all (staged and unknown types fail
 * loudly here, so a JavaScript caller cannot slip past the compile-time
 * narrowing of `JointDescriptor`); the type is legal in this dimension
 * (`spherical` is `"3d"` only); the two bodies differ; the anchors lie in the
 * world's plane; the break thresholds are positive; and every parameter the
 * specific type carries — axis direction, limit ordering, motor effort, rope
 * length, spring constants, cone half-angle.
 *
 * Anchors and axes are in **body-local** space here — see `JointDescriptorBase`
 * — because that is the space a descriptor is stated in; the world-space
 * conversion happens before this is ever called.
 */
export function validateJointDescriptor(
  desc: JointDescriptor,
  dimension: PhysicsDimension,
): void {
  const type: string = desc.type;
  if (!(SHIPPED_JOINT_TYPES as readonly string[]).includes(type)) {
    failUnshippedJointType(type);
  }
  if (!jointTypeSupportsDimension(desc.type, dimension)) {
    fail(
      `A ${desc.type} joint is not valid in a "${dimension}" world (§21, §28, plan P6-1). A ball joint's swing degrees of freedom do not exist in a plane; use a revolute joint.`,
      { field: "type", value: desc.type, dimension },
    );
  }

  if (desc.bodyA === desc.bodyB) {
    fail(
      "A joint must connect two different bodies; bodyA and bodyB are the same handle (§28).",
      { field: "bodyB" },
    );
  }
  if (desc.anchorA !== undefined) {
    requirePlanarVector("anchorA", desc.anchorA, dimension);
  }
  if (desc.anchorB !== undefined) {
    requirePlanarVector("anchorB", desc.anchorB, dimension);
  }
  if (desc.breakForce !== undefined) {
    validateJointBreakThreshold("breakForce", desc.breakForce);
  }
  if (desc.breakTorque !== undefined) {
    validateJointBreakThreshold("breakTorque", desc.breakTorque);
  }

  switch (desc.type) {
    case "fixed":
      return;
    case "revolute":
      if (desc.axis === undefined) {
        if (dimension === "3d") {
          fail(
            'A revolute joint in a "3d" world must name the axis it turns about (§28); only a "2d" world has a default (+Z, §21).',
            { field: "axis", dimension },
          );
        }
      } else {
        requireJointAxis("revolute", "axis", desc.axis, dimension);
      }
      if (desc.limits !== undefined) {
        validateJointLimits("limits", desc.limits);
      }
      if (desc.motor !== undefined) {
        validateAngularJointMotor("motor", desc.motor);
      }
      return;
    case "prismatic":
      requireJointAxis("prismatic", "axis", desc.axis, dimension);
      if (desc.limits !== undefined) {
        validateJointLimits("limits", desc.limits);
      }
      if (desc.motor !== undefined) {
        validateLinearJointMotor("motor", desc.motor);
      }
      return;
    case "rope":
      requirePositive("maxLength", desc.maxLength);
      return;
    case "spring":
      requireNonNegative("restLength", desc.restLength);
      requirePositive("stiffness", desc.stiffness);
      if (desc.damping !== undefined) {
        requireNonNegative("damping", desc.damping);
      }
      return;
    default:
      if (desc.axis !== undefined) {
        requireJointAxis("spherical", "axis", desc.axis, dimension);
      }
      if (desc.limits !== undefined) {
        validateSphericalJointLimits("limits", desc.limits);
      }
      return;
  }
}

/**
 * Validates a world's options against §21, §32, and §33 — §85's "invalid
 * physics dimensions" in particular.
 *
 * Gravity is validated through `resolveGravity`, which owns the §21 rule that a
 * `"2d"` world has no z gravity; the resolved vector is discarded.
 */
export function validatePhysicsWorldOptions(
  options: PhysicsWorldOptions,
): void {
  if (!PHYSICS_DIMENSIONS.includes(options.dimension)) {
    fail(
      `Unknown physics dimension ${JSON.stringify(options.dimension)}; expected one of ${PHYSICS_DIMENSIONS.join(", ")} (§21, §85).`,
      { field: "dimension", value: options.dimension },
    );
  }

  if (options.gravity !== undefined) {
    requireFinite("gravity.x", options.gravity.x);
    requireFinite("gravity.y", options.gravity.y);
    if ("z" in options.gravity) {
      requireFinite("gravity.z", options.gravity.z);
    }
    resolveGravity(options.dimension, options.gravity);
  }

  if (options.determinism !== undefined) {
    if (!DETERMINISM_LEVELS.includes(options.determinism)) {
      fail(
        `Unknown determinism level ${JSON.stringify(options.determinism)}; expected one of ${DETERMINISM_LEVELS.join(", ")} (§33).`,
        { field: "determinism", value: options.determinism },
      );
    }
  }

  if (options.solverIterations !== undefined) {
    const iterations = options.solverIterations;
    if (!Number.isSafeInteger(iterations) || iterations < 1) {
      fail(
        `solverIterations must be a positive integer (§28 "solver iterations" is a per-step count); got ${String(iterations)} (§85).`,
        { field: "solverIterations", value: iterations },
      );
    }
  }

  const sleeping = options.sleeping;
  if (sleeping !== undefined) {
    if (sleeping.linearThreshold !== undefined) {
      requireNonNegative("sleeping.linearThreshold", sleeping.linearThreshold);
    }
    if (sleeping.angularThreshold !== undefined) {
      requireNonNegative(
        "sleeping.angularThreshold",
        sleeping.angularThreshold,
      );
    }
    if (sleeping.timeThreshold !== undefined) {
      // Seconds (§7a) — nothing in this engine takes milliseconds.
      requireNonNegative("sleeping.timeThreshold", sleeping.timeThreshold);
    }
  }

  const units = options.units;
  if (units !== undefined) {
    requirePositive("units.scale.lengthToMeters", units.scale.lengthToMeters);
    requirePositive("units.scale.massToKilograms", units.scale.massToKilograms);
  }

  const plane = options.localPlane;
  if (plane !== undefined) {
    requireFinite("localPlane.origin.x", plane.origin.x);
    requireFinite("localPlane.origin.y", plane.origin.y);
    if ("z" in plane.origin) {
      requireFinite("localPlane.origin.z", plane.origin.z);
    }
    requireFinite("localPlane.normal.x", plane.normal.x);
    requireFinite("localPlane.normal.y", plane.normal.y);
    if ("z" in plane.normal) {
      requireFinite("localPlane.normal.z", plane.normal.z);
    }
    const nx = plane.normal.x;
    const ny = plane.normal.y;
    const nz = "z" in plane.normal ? plane.normal.z : 0;
    if (nx === 0 && ny === 0 && nz === 0) {
      fail("localPlane.normal must be a non-zero vector (§21, §85).", {
        field: "localPlane.normal",
        x: nx,
        y: ny,
        z: nz,
      });
    }
    if (plane.xAxis !== undefined) {
      requireFinite("localPlane.xAxis.x", plane.xAxis.x);
      requireFinite("localPlane.xAxis.y", plane.xAxis.y);
      if ("z" in plane.xAxis) {
        requireFinite("localPlane.xAxis.z", plane.xAxis.z);
      }
      const xx = plane.xAxis.x;
      const xy = plane.xAxis.y;
      const xz = "z" in plane.xAxis ? plane.xAxis.z : 0;
      if (xx === 0 && xy === 0 && xz === 0) {
        fail("localPlane.xAxis must be a non-zero vector (§21, §85).", {
          field: "localPlane.xAxis",
          x: xx,
          y: xy,
          z: xz,
        });
      }
      // Same parallel test `resolveLocalPlane` uses after Gram-Schmidt:
      // xAxis × normal == 0 means no in-plane +X.
      const cx = xy * nz - xz * ny;
      const cy = xz * nx - xx * nz;
      const cz = xx * ny - xy * nx;
      if (cx === 0 && cy === 0 && cz === 0) {
        fail(
          "localPlane.xAxis is parallel to normal, so the plane has no in-plane +X (§21, §85).",
          { field: "localPlane.xAxis", x: xx, y: xy, z: xz },
        );
      }
    }
  }
}
