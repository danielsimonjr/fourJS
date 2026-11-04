/**
 * Shared builders for the Phase 5 cross-integration suite (WP-5.6): one
 * headless {@link Application}, one {@link PhysicsSystem}, and real Rapier
 * worlds in both §21 dimensions.
 *
 * Everything here goes through the **public API** — `four/application`,
 * `@fourjs/physics`, `@fourjs/physics-rapier` — because that is what the packet is
 * for: `@fourjs/physics` has its own structural fake solver and
 * `@fourjs/physics-rapier` has its own wasm-backed unit tests, and neither proves
 * that the two halves compose. This file builds the composition once so each
 * case in `../physics-rapier.test.ts` states only its own physics.
 *
 * ## The one thing this file asserts by existing (§37, WP-5.5)
 *
 * {@link DimensionKit.createAdapter} is declared to return
 * `PhysicsWorldAdapter` — `@fourjs/physics`'s `PhysicsSolverAdapter &
 * SolverBodyAccess` — and {@link KIT_2D} and {@link KIT_3D} return a
 * `Rapier2dAdapter` and a `Rapier3dAdapter` from it. `@fourjs/physics-rapier`
 * declares its own `RapierBodyAccess` (it may not import `@fourjs/physics`), so
 * the two per-handle interfaces are only *structurally* identical, and nothing
 * had checked the 3D one. These two functions are that check: if
 * `Rapier3dAdapter` drifted from `SolverBodyAccess` by one signature,
 * `tests/tsconfig.json`'s `tsc --noEmit` would fail here rather than in a
 * runtime surprise. The `PHYSICS_WORLD_ADAPTERS` constant below states it a
 * second time in a form that cannot be optimized away by a reader.
 *
 * ## Conventions this file obeys (plan §1)
 *
 * Y-up in both dimensions, radians, **seconds** everywhere, and no clock and no
 * `Math.random` anywhere in a scenario (§33): every run is driven by
 * `Application.step(DT)` with a constant, injected delta.
 */

import { Quaternion, Vector2, Vector3 } from "@fourjs/math";
import {
  Collider,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
  type CollisionShape,
  type PhysicsDimension,
  type PhysicsWorldAdapter,
  type WorldPhysicsEvent,
} from "@fourjs/physics";
import {
  PHYSJS_CAPABILITIES,
  PhysJSAdapter2D,
  PhysJSAdapter3D,
} from "@fourjs/physics-physjs";
import { Rapier2dAdapter, Rapier3dAdapter } from "@fourjs/physics-rapier";
import { Group, type Node } from "@fourjs/scene";
import { Application } from "fourJS/application";

/** One fixed step in **seconds** (§7a, §10; Appendix A's 1/60). */
export const DT = 1 / 60;

/** Appendix A world gravity on Y, in m/s² — negative Y in *both* dimensions (§7a). */
export const GRAVITY_Y = -9.81;

/**
 * Rapier 0.19.3's default `World.numSolverIterations`.
 *
 * `World.step` is not one semi-implicit Euler step: it runs `SUBSTEPS` substeps
 * of `dt / SUBSTEPS`. Established and verified against the real wasm by WP-5.4
 * and WP-5.5 (`packages/physics-rapier/tests/rapier{2,3}d-adapter.test.ts`);
 * reused verbatim here rather than re-derived.
 */
export const SUBSTEPS = 4;

/**
 * Free-fall **displacement** after `steps` fixed steps, in Rapier's substepped
 * form (WP-5.4's derivation):
 *
 * ```text
 * h = DT / SUBSTEPS,  K = steps * SUBSTEPS
 * Δy = g * h² * K(K + 1) / 2        (NOT g * DT² * N(N+1)/2)
 * v  = g * h * K = g * DT * steps   (identical to the single-step form)
 * ```
 *
 * Add it to the body's starting Y to get the predicted position.
 */
export function fallDistance(steps: number, gravity = GRAVITY_Y): number {
  const h = DT / SUBSTEPS;
  const k = steps * SUBSTEPS;
  return (gravity * h * h * k * (k + 1)) / 2;
}

/** Free-fall **velocity** after `steps` fixed steps. See {@link fallDistance}. */
export function fallVelocity(steps: number, gravity = GRAVITY_Y): number {
  return gravity * DT * steps;
}

/**
 * Everything a scenario needs to be written once and run in both §21
 * dimensions: the dimension itself, a solver for it, and the shapes whose names
 * differ between the two ("circle"/"sphere", "rectangle"/"box").
 */
export interface DimensionKit {
  /** The §21 dimension this kit builds worlds for. */
  readonly dimension: PhysicsDimension;

  /** `PhysicsSolverAdapter.name` of {@link DimensionKit.createAdapter}'s result. */
  readonly adapterName: string;

  /**
   * A fresh, uninitialized Rapier adapter for {@link DimensionKit.dimension}.
   *
   * Declared as `PhysicsWorldAdapter` on purpose — see the module header.
   */
  createAdapter(): PhysicsWorldAdapter;

  /** A ball: §24's `circle` in 2D, `sphere` in 3D. */
  ball(radius: number): CollisionShape;

  /**
   * A slab: §24's `rectangle` in 2D, `box` in 3D. `halfDepth` is the Z half
   * extent and is ignored by the 2D form, which has no third axis (§21).
   */
  slab(
    halfWidth: number,
    halfHeight: number,
    halfDepth: number,
  ): CollisionShape;
}

/** The 2D kit: `Rapier2dAdapter`, circles and rectangles (§21). */
export const KIT_2D: DimensionKit = {
  dimension: "2d",
  adapterName: "rapier2d",
  createAdapter(): PhysicsWorldAdapter {
    return new Rapier2dAdapter();
  },
  ball(radius: number): CollisionShape {
    return { type: "circle", radius };
  },
  slab(halfWidth: number, halfHeight: number): CollisionShape {
    return {
      type: "rectangle",
      halfExtents: new Vector2(halfWidth, halfHeight),
    };
  },
};

/** The 3D kit: `Rapier3dAdapter`, spheres and boxes (§21). */
export const KIT_3D: DimensionKit = {
  dimension: "3d",
  adapterName: "rapier3d",
  createAdapter(): PhysicsWorldAdapter {
    return new Rapier3dAdapter();
  },
  ball(radius: number): CollisionShape {
    return { type: "sphere", radius };
  },
  slab(
    halfWidth: number,
    halfHeight: number,
    halfDepth: number,
  ): CollisionShape {
    return {
      type: "box",
      halfExtents: new Vector3(halfWidth, halfHeight, halfDepth),
    };
  },
};

/** Both kits, 2D first — the order every `describe` loop below iterates. */
export const DIMENSION_KITS: readonly DimensionKit[] = [KIT_2D, KIT_3D];

/**
 * The §37 seam restated as data (see the module header): both Rapier adapters,
 * typed as the adapter `PhysicsWorld` demands. WP-5.4 had the compiler check
 * the 2D one; this is where the 3D one is checked.
 */
export const PHYSICS_WORLD_ADAPTERS: readonly (() => PhysicsWorldAdapter)[] = [
  (): PhysicsWorldAdapter => new Rapier2dAdapter(),
  (): PhysicsWorldAdapter => new Rapier3dAdapter(),
];

/**
 * A composed, running application: §45's composition root plus the one §39
 * system this packet is about.
 *
 * `poseInterpolation` is on, so `Application` registers the §39 step-10
 * snapshot system and `app.poses` is a real §43 buffer — which is what the
 * physics worlds are handed and what the §43 case reads back.
 */
export interface PhysicsRig {
  /** The headless application (no renderer anywhere in the import graph). */
  readonly app: Application;
  /** The one registered {@link PhysicsSystem}; every world is tracked on it. */
  readonly system: PhysicsSystem;
  /** Worlds created through {@link createWorld}, in creation order. */
  readonly worlds: PhysicsWorld[];
  /** Disposes every world (and its adapter), then the application (§83). */
  dispose(): void;
}

/**
 * Builds and starts a headless application with one {@link PhysicsSystem}
 * registered at §39's `PRIORITY_PHYSICS_SOLVE`.
 *
 * Awaited because `Application.initialize` is (§45); nothing here loads wasm —
 * that happens in {@link createWorld}, where the adapter is initialized.
 */
export async function createRig(): Promise<PhysicsRig> {
  const app = new Application({
    fixedTimeStep: DT,
    // Headless, but with the §43 capture running: `poseInterpolation` defaults
    // to `false` without a renderer, and the §42/§43 case needs the snapshot
    // system that this flag registers.
    poseInterpolation: true,
  });
  const system = new PhysicsSystem();
  app.systems.register(system);
  await app.initialize();
  app.start();

  const worlds: PhysicsWorld[] = [];
  return {
    app,
    system,
    worlds,
    dispose(): void {
      for (let i = worlds.length - 1; i >= 0; i -= 1) {
        worlds[i].dispose();
      }
      worlds.length = 0;
      app.dispose();
    },
  };
}

/** How {@link createWorld} configures the solver world (§20's own options). */
export interface WorldOptions {
  /** World gravity in m/s². Defaults to Appendix A's `(0, -9.81, 0)`. */
  gravity?: Vector3;
  /** §32 sleeping, merged over Appendix A's defaults. */
  sleeping?: { enabled?: boolean };
  /** Whether to hand the rig's §43 pose buffer to the world. Default `true`. */
  poses?: boolean;
  /** Whether to track the world on the rig's system. Default `true`. */
  track?: boolean;
}

/**
 * Creates a {@link PhysicsWorld} on a fresh Rapier adapter, initializes it
 * (wasm loads here, cached per process), tracks it on the rig's system, and
 * records it for teardown.
 */
export async function createWorld(
  rig: PhysicsRig,
  kit: DimensionKit,
  options: WorldOptions = {},
): Promise<PhysicsWorld> {
  const world = new PhysicsWorld({
    dimension: kit.dimension,
    adapter: kit.createAdapter(),
    ...(options.gravity === undefined ? {} : { gravity: options.gravity }),
    ...(options.sleeping === undefined ? {} : { sleeping: options.sleeping }),
    ...(options.poses === false ? {} : { poses: rig.app.poses }),
  });
  await world.initialize();
  rig.worlds.push(world);
  if (options.track !== false) {
    rig.system.track(world);
  }
  return world;
}

/** A node plus the two §6a components a physics body is made of. */
export interface BodyParts {
  /** The scene node; `transformAuthority` is `"physics"` for dynamic bodies. */
  readonly node: Node;
  /** The §23 body component. */
  readonly body: RigidBody;
  /** The §24 collider component. */
  readonly collider: Collider;
}

/**
 * Density in kg/m³ (3D) or kg/m² (2D) that a collider here is given when it
 * names none — `@fourjs/physics`'s `DEFAULT_DENSITY`, restated rather than
 * imported so the expected masses below can be read next to the shapes that
 * produce them (§24, §25).
 *
 * With it, a ball of radius `r` registered with **no authored mass** ends up
 * with the §23 density-derived mass {@link derivedBallMass} computes.
 */
export const DEFAULT_DENSITY = 1;

/**
 * The §23 mass a {@link addBall} with no authored mass ends up with, in
 * kilograms: density times the ball's area in 2D and its volume in 3D.
 *
 * Not measured from the solver — derived from §23–§25 and then *checked*
 * against the solver in `../physics-rapier.test.ts`, which is the point of the
 * density path being reachable at all (WP-5.2-fix1).
 */
export function derivedBallMass(
  dimension: PhysicsDimension,
  radius: number,
  density = DEFAULT_DENSITY,
): number {
  return dimension === "2d"
    ? density * Math.PI * radius * radius
    : (density * 4 * Math.PI * radius * radius * radius) / 3;
}

/** How {@link addBall} and {@link addSlab} author a body. */
export interface BodyOptions {
  /** Node name, so an authority warning names something readable. */
  name?: string;
  /**
   * Mass in kilograms (§23), or omitted — the default — to let the solver
   * derive it from collider density times volume, which is §23's documented
   * behaviour and the only path `Collider.density` feeds.
   *
   * Authored only where a case genuinely needs a *known* mass (the §26 impulse
   * case, where `v = J/m` is the assertion). Every other body here goes down
   * the derived path on purpose: that path was unreachable through the
   * component API until WP-5.2-fix1, and exercising it is what keeps it
   * reachable.
   */
  mass?: number;
  /** World position; Y is up in both dimensions (§7a). Defaults to the origin. */
  position?: Vector3;
  /** §24 restitution on the collider. */
  restitution?: number;
  /** §24 friction on the collider. */
  friction?: number;
  /** §24 sensor flag — a sensor exerts no force and emits triggers (§29). */
  sensor?: boolean;
  /**
   * §42 authority for the node. Defaults to `"physics"` for a dynamic body
   * (which is what lets the solver write its transform) and is left at
   * `"manual"` otherwise.
   */
  authority?: Node["transformAuthority"];
}

/**
 * Adds a ball — a §24 circle in 2D, a sphere in 3D — to `world` and returns its
 * node and components.
 *
 * The node carries no explicit descriptor pose: `PhysicsWorld.addBody` reads
 * the node's local transform when the descriptor has none (WP-5.3), which is
 * the path an application actually takes.
 */
export function addBall(
  world: PhysicsWorld,
  kit: DimensionKit,
  type: "dynamic" | "static" | "kinematic-position",
  radius: number,
  options: BodyOptions = {},
): BodyParts {
  return addBody(world, type, kit.ball(radius), options);
}

/** Adds a slab — a §24 rectangle in 2D, a box in 3D. See {@link addBall}. */
export function addSlab(
  world: PhysicsWorld,
  kit: DimensionKit,
  type: "dynamic" | "static" | "kinematic-position",
  halfExtents: Vector3,
  options: BodyOptions = {},
): BodyParts {
  return addBody(
    world,
    type,
    kit.slab(halfExtents.x, halfExtents.y, halfExtents.z),
    options,
  );
}

/**
 * The ground every falling-body scenario lands on: a static slab 20 units wide
 * whose **top surface sits at y = 0**.
 */
export function addGround(
  world: PhysicsWorld,
  kit: DimensionKit,
  options: BodyOptions = {},
): BodyParts {
  return addSlab(world, kit, "static", new Vector3(20, 0.5, 20), {
    name: "ground",
    position: new Vector3(0, -0.5, 0),
    ...options,
  });
}

/** Shared by {@link addBall} and {@link addSlab}. */
function addBody(
  world: PhysicsWorld,
  type: "dynamic" | "static" | "kinematic-position",
  shape: CollisionShape,
  options: BodyOptions,
): BodyParts {
  const node = new Group();
  if (options.name !== undefined) {
    node.name = options.name;
  }
  if (options.position !== undefined) {
    node.transform.position.copy(options.position);
  }
  node.transformAuthority =
    options.authority ?? (type === "dynamic" ? "physics" : "manual");

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

/**
 * Drives `frames` frames of exactly one fixed step each (§10).
 *
 * `DT` in, `DT` consumed: the scheduler's accumulator returns to exactly zero
 * every frame, so `frames` frames are `frames` fixed steps and nothing is
 * dropped. Nothing here reads a clock (§33).
 */
export function stepFrames(app: Application, frames: number): void {
  for (let i = 0; i < frames; i += 1) {
    app.step(DT);
  }
}

/**
 * Runs `frames` fixed steps and returns `world.checksum()` after each (§33).
 *
 * One checksum per step, in step order, which is the sequence two identical
 * runs must agree on element by element.
 */
export function stepAndChecksum(
  app: Application,
  world: PhysicsWorld,
  frames: number,
): number[] {
  const digests: number[] = [];
  for (let i = 0; i < frames; i += 1) {
    app.step(DT);
    digests.push(world.checksum());
  }
  return digests;
}

/** One recorded §29 event: its type and the components it named. */
export interface EventRecord {
  /** The §29 event name. */
  readonly type: WorldPhysicsEvent["type"];
  /** 1-based fixed step the event was dispatched on. */
  readonly step: number;
}

/**
 * Subscribes to `types` on a `RigidBody` or `Collider` emitter and returns the
 * growing record of what fired, in dispatch order.
 *
 * `stepOf` is read when an event arrives, so a record carries the step it was
 * dispatched on — which is how the ordering claims below are checked without
 * re-deriving the solver.
 */
export function recordEvents(
  emitter: RigidBody | Collider,
  types: readonly WorldPhysicsEvent["type"][],
  stepOf: () => number,
): EventRecord[] {
  const records: EventRecord[] = [];
  for (const type of types) {
    // The two emitters have disjoint event maps (§29: collisions on the body,
    // triggers on the sensor collider), so the subscription is narrowed per
    // emitter kind rather than by casting the union away.
    if (emitter instanceof RigidBody) {
      switch (type) {
        case "collisionstart":
        case "collisionstay":
        case "collisionend":
        case "sleep":
        case "wake":
          emitter.on(type, () => {
            records.push({ type, step: stepOf() });
          });
          break;
        default:
          break;
      }
      continue;
    }
    if (type === "triggerenter" || type === "triggerexit") {
      emitter.on(type, () => {
        records.push({ type, step: stepOf() });
      });
    }
  }
  return records;
}

/** The event types in `records`, in order — what the ordering assertions read. */
export function eventTypes(records: readonly EventRecord[]): string[] {
  return records.map((record) => record.type);
}

/** Collapses runs of the same event type, so `stay×40` reads as one entry. */
export function eventPhases(records: readonly EventRecord[]): string[] {
  const phases: string[] = [];
  for (const record of records) {
    if (phases[phases.length - 1] !== record.type) {
      phases.push(record.type);
    }
  }
  return phases;
}

/** Reusable scratch for {@link renderPose}, so a read allocates nothing (§7b). */
const RENDER_POSITION = new Vector3();

const RENDER_ROTATION = new Quaternion();

/**
 * The §43 interpolated render pose of `node` at `alpha`, or `undefined` when
 * the node is not tracked. The returned vector is **shared scratch** — read it
 * before the next call.
 */
export function renderPose(
  app: Application,
  node: Node,
  alpha: number,
): Vector3 | undefined {
  return app.poses.computeRenderPose(
    node,
    alpha,
    RENDER_POSITION,
    RENDER_ROTATION,
  )
    ? RENDER_POSITION
    : undefined;
}

// --- adapter parameterisation (RFC 0010 decisions 7-8, wave 9) ----------------

/** The solver adapters the conformance suites can run against. */
export type SolverId = "rapier" | "physjs";

/** Every solver, Rapier first. */
export const SOLVER_IDS: readonly SolverId[] = ["rapier", "physjs"];

/** A {@link DimensionKit} that remembers which solver it builds. */
export interface SolverKit extends DimensionKit {
  readonly solver: SolverId;
}

/**
 * What a solver can express, read from its capability record where one exists
 * and stated here (with the refusal's reason) where `PhysicsCapabilities` has no
 * field for it. Scenarios `skipIf` on these so a skip always carries a reason.
 */
export interface SolverSupport {
  /** Sensor (trigger-volume) colliders. */
  readonly sensors: boolean;
  /** Collider local offsets / rotations (needs a compound hull). */
  readonly colliderOffsets: boolean;
  /** `capabilities.queries.shapeCast`. */
  readonly shapeCast: boolean;
  /** `capabilities.jointTypes`. */
  readonly jointTypes: readonly string[];
  /** `capabilities.ccdModes` includes `"swept"`. */
  readonly sweptCcd: boolean;
  /** Per-joint limits and motors (PhysJS 0.5.0 has neither). */
  readonly jointLimitsMotors: boolean;
  /** Why unsupported things are unsupported, for skip messages. */
  readonly why: string;
}

/** Support record per solver. */
export const SOLVER_SUPPORT: Readonly<Record<SolverId, SolverSupport>> = {
  rapier: {
    sensors: true,
    colliderOffsets: true,
    shapeCast: true,
    jointTypes: [
      "fixed",
      "spring",
      "revolute",
      "spherical",
      "prismatic",
      "rope",
    ],
    sweptCcd: true,
    jointLimitsMotors: true,
    why: "",
  },
  physjs: {
    sensors: false,
    colliderOffsets: false,
    shapeCast: PHYSJS_CAPABILITIES.queries.shapeCast,
    jointTypes: PHYSJS_CAPABILITIES.jointTypes,
    sweptCcd: PHYSJS_CAPABILITIES.ccdModes.includes("swept"),
    jointLimitsMotors: false,
    why: "PhysJS 0.5.0 (RFC 0010 decision 5): no trigger volumes, no collider offsets, no shape casts, no swept CCD, no joint limits/motors, no prismatic/rope",
  },
};

/** Builds the 2D or 3D kit for a solver. */
export function kitFor(
  solver: SolverId,
  dimension: PhysicsDimension,
): SolverKit {
  const base = dimension === "2d" ? KIT_2D : KIT_3D;
  if (solver === "rapier") {
    return { ...base, solver };
  }
  return {
    ...base,
    solver,
    adapterName: dimension === "2d" ? "physjs2d" : "physjs3d",
    createAdapter(): PhysicsWorldAdapter {
      return dimension === "2d" ? new PhysJSAdapter2D() : new PhysJSAdapter3D();
    },
  };
}

/** Every solver x dimension kit, grouped by solver then 2D first. */
export const SOLVER_KITS: readonly SolverKit[] = SOLVER_IDS.flatMap(
  (solver) => [kitFor(solver, "2d"), kitFor(solver, "3d")],
);
