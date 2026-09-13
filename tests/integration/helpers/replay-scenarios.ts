/**
 * The Phase 10 replay rig (plan §6i, WP-10.4; §33–34, §113) — one headless
 * 2D Rapier scenario with scripted inputs, plus **the `ReplayTarget` wrapper an
 * application is meant to copy**.
 *
 * `@fourjs/diagnostics` records and replays through a duck-typed contract
 * ({@link ReplayTarget}: `checksum`, `createSnapshot`, `restoreSnapshot`, and an
 * optional `applyInput`) because it may depend on `core`, `math` and `scene`
 * only and therefore cannot name `PhysicsWorld` (plan P10-1, §6h). This file is
 * the other end of that contract: the composition an application performs to
 * make its own simulation recordable.
 *
 * ## The wrapper pattern, and why there is a wrapper at all
 *
 * `PhysicsWorld` **already satisfies `ReplayTarget`** — three of the four
 * members are its own public methods with matching signatures, and the fourth is
 * optional. {@link PHYSICS_WORLD_AS_REPLAY_TARGET} states exactly that as a
 * compiling assignment, so a drift in either declaration fails
 * `bun run typecheck:tests` here.
 *
 * What `PhysicsWorld` does *not* have — and should not have — is
 * `applyInput(step, payload)`. A solver world has no idea what an application's
 * inputs *are*: "thrust 0.4", "jump", "spawn a crate" are the application's
 * vocabulary, and §34 stores them as opaque JSON precisely so the engine never
 * has to have an opinion about them. So the target an application records is
 * **its world plus its own input decoder**, which is what
 * {@link PhysicsReplayTarget} is: a three-line delegation to `PhysicsWorld` for
 * the §34 members, and one honest `applyInput` that turns a recorded JSON
 * payload back into the §26 call host script made live
 * (`RigidBody.applyImpulse`).
 *
 * Three properties make the pattern worth copying rather than re-inventing:
 *
 * 1. **One code path for live and replayed input.** The live run calls
 *    {@link PhysicsReplayTarget.applyInput} too (see {@link runRecordedRun}) —
 *    it does not apply impulses one way and replay them another. A decoder bug
 *    therefore breaks the *recording* as loudly as it breaks the replay, instead
 *    of hiding until someone opens a `.replay.json` six months later.
 * 2. **The payload is validated on the way back in.** `applyInput` receives
 *    `JsonValue`, not the application's type: the document may have come off
 *    disk. {@link decodeImpulseInput} is the narrowing, and it throws rather
 *    than silently applying a zero impulse (§42's "warn rather than silently
 *    overwrite" instinct, applied to input).
 * 3. **The two snapshot declarations are checked against each other.**
 *    `createSnapshot` returns `PhysicsWorld`'s `PhysicsSnapshot` where a
 *    `ReplaySnapshot` is demanded — that direction compiles as written, and
 *    a drift in either declaration fails `bun run typecheck:tests`. The consume
 *    direction does **not**, and saying it did was this header's own bug until
 *    2026-08-21: `ReplaySnapshot.configuration` is `unknown` where
 *    `PhysicsSnapshot.configuration` is `PhysicsSnapshotConfiguration`, for the
 *    package-boundary reason {@link asPhysicsSnapshot} records. That helper is
 *    the narrowing, and it is not trusted — §34's own refusal is.
 *
 * ## The stepping seam (WP-10.2's stated cost, exercised here)
 *
 * `ReplayPlayer` takes `stepFn` — "advance the host world by one fixed step" —
 * separately from `target`, and **nothing type-checks that the two describe the
 * same world**. {@link createReplayRig} therefore hands out both together
 * ({@link ReplayRig.target} and {@link ReplayRig.stepOnce}) so an application
 * that copies this file gets the pairing right by construction;
 * `../physics-replay.test.ts` also crosses the pairing on purpose, once, to show
 * what the failure actually looks like (a clean run and a `false` from
 * `verifyChecksum`, never a throw).
 *
 * ## Conventions (plan §1)
 *
 * Y-up (2D gravity is negative Y, §7a), radians, **seconds** everywhere, no
 * clock and no `Math.random` anywhere in a scenario (§33): every run is driven
 * by `Application.step(DT)` with a constant, injected delta, and every scripted
 * input is a pure function of the step index.
 */

import {
  DebugDrawBuffer,
  ReplayRecorder,
  collectBodyOrigins,
  collectBodyVelocities,
  collectCentersOfMass,
  collectContactImpulses,
  collectContactPoints,
  solverStatistics,
  type JsonValue,
  type ReplayRecording,
  type ReplaySnapshot,
  type ReplayTarget,
  type SolverStatistics,
} from "@fourjs/diagnostics";
import { Vector2, Vector3 } from "@fourjs/math";
import {
  Collider,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
  type CollisionShape,
  type PhysicsSnapshot,
  type RigidBodyCollisionEvent,
  type WorldPhysicsEvent,
} from "@fourjs/physics";
import { Rapier2dAdapter } from "@fourjs/physics-rapier";
import { Group, type Node } from "@fourjs/scene";
import { Application } from "fourJS/application";

/**
 * The one narrowing the §34 snapshot round trip needs, and why it is a named
 * helper rather than an inline cast.
 *
 * `ReplaySnapshot.configuration` is `unknown` **by design**:
 * `@fourjs/diagnostics` may not import `@fourjs/physics`, so it cannot name
 * `PhysicsSnapshotConfiguration` (`packages/diagnostics/src/recorder.ts`
 * says so at the field). `PhysicsSnapshot.configuration` *is* that type. The
 * two declarations are therefore assignable in the **produce** direction
 * (`createSnapshot`) and not in the **consume** direction — which the tests
 * typecheck gate (2026-08-21) is what first made visible; before it, nothing
 * compiled this directory at all.
 *
 * The cast is safe because nothing trusts it: `PhysicsWorld.restoreSnapshot`
 * validates adapter name, adapter version and — when the field is present —
 * the configuration field by field, and refuses a mismatch (§34). A snapshot
 * carrying a foreign `configuration` is rejected at run time by the code under
 * test, which is precisely what these scenarios assert. No assertion is
 * weakened by spelling the conversion here.
 */
function asPhysicsSnapshot(snapshot: ReplaySnapshot): PhysicsSnapshot {
  return snapshot as PhysicsSnapshot;
}

// ---------------------------------------------------------------------------
// Scenario constants (§7a: seconds and world units, never milliseconds)
// ---------------------------------------------------------------------------

/** One fixed step in **seconds** (§7a, §10; Appendix A's 1/60). */
export const DT = 1 / 60;

/** Fixed steps the scenario runs — 4 s at {@link DT}. */
export const STEP_COUNT = 240;

/** §34 periodic snapshot cadence handed to {@link ReplayRecorder}. */
export const SNAPSHOT_INTERVAL_STEPS = 30;

/**
 * Periodic snapshots {@link SNAPSHOT_INTERVAL_STEPS} produces over
 * {@link STEP_COUNT} clean one-step frames: one at every multiple of the
 * interval, the initial snapshot excluded (it is a separate §34 field).
 */
export const SNAPSHOT_COUNT = STEP_COUNT / SNAPSHOT_INTERVAL_STEPS;

/** The §33 RNG seed recorded in the document. Nothing here draws from it. */
export const SEED = 1337;

/** Bodies the scenario registers: the ground plus {@link BALLS}. */
export const BODY_COUNT = 4;

/**
 * The static ground: 16 units wide, half a unit thick, centred so its **top
 * surface sits at y = 0**, which is the datum every height below is measured
 * from.
 */
export const GROUND = { halfWidth: 8, halfHeight: 0.5, centerY: -0.5 };

/**
 * The three falling balls, in registration order — which is §33's checksum
 * order, so reordering this array changes every digest in the suite.
 *
 * Masses are **authored** so the scripted impulses below read as `Δv = J / m`
 * rather than as numbers only the solver knows (§23, §26). The staggered
 * heights make the three landings land on three different fixed steps, which is
 * what gives the frame-stepping case a collision window worth stepping through.
 */
export const BALLS = [
  { name: "ball-0", x: -1.5, y: 1.2, radius: 0.3 },
  { name: "ball-1", x: 0, y: 2.1, radius: 0.3 },
  { name: "ball-2", x: 1.5, y: 3, radius: 0.3 },
] as const;

/** Authored mass of every ball, in kilograms (§23). */
export const BALL_MASS = 1;

/** §24 restitution of every ball — bouncy enough to leave the ground again. */
export const BALL_RESTITUTION = 0.3;

/** §24 friction of every ball. */
export const BALL_FRICTION = 0.5;

/**
 * One scripted external input: which body it acts on, and the §26 impulse in
 * newton-seconds.
 *
 * A `type` alias rather than an `interface` on purpose: TypeScript gives type
 * aliases an implicit index signature, so this is assignable to
 * `@fourjs/diagnostics`'s `JsonValue` (an interface is not), which is what lets a
 * scenario hand its own payload type straight to `ReplayRecorder.recordInput`.
 */
export type ReplayInputPayload = {
  /** {@link BALLS} name of the body the impulse is applied to. */
  readonly body: string;
  /** Newton-seconds on X, Y, Z (§26). Z is 0 in a `"2d"` world (§21). */
  readonly impulse: readonly [number, number, number];
};

/** One entry of {@link INPUT_SCHEDULE}: a payload and the step it applies to. */
export interface ScheduledInput {
  /** 0-based simulation step the input is applied *before* (§34). */
  readonly step: number;
  /** What to apply. */
  readonly payload: ReplayInputPayload;
}

/**
 * The scripted inputs, in **insertion order** (plan §1, §34): two share step 20,
 * which is what makes "several inputs may share a step, and they replay in the
 * order they were recorded" a claim this suite actually tests.
 *
 * The steps are chosen around the scenario's own events: 20 is before any ball
 * has landed, 75 is mid-bounce, and 140 is after everything has settled, so a
 * dropped or reordered input changes the checksum stream from that step onwards
 * rather than being absorbed by a collision.
 */
export const INPUT_SCHEDULE: readonly ScheduledInput[] = [
  { step: 20, payload: { body: "ball-0", impulse: [0.6, 3.2, 0] } },
  { step: 20, payload: { body: "ball-1", impulse: [-0.4, 2, 0] } },
  { step: 75, payload: { body: "ball-2", impulse: [0.9, 4, 0] } },
  { step: 140, payload: { body: "ball-0", impulse: [-1.1, 1.5, 0] } },
];

/**
 * 0-based step of the scenario's **first** §29 contact — measured from a run
 * (not derived), and asserted against every run in `../physics-replay.test.ts`
 * so it cannot rot silently.
 */
export const FIRST_CONTACT_STEP = 35;

/**
 * The window the frame-stepping case single-steps through: two quiet steps, the
 * first landing at {@link FIRST_CONTACT_STEP}, the six-step bounce that follows
 * it (contact-free again — the part a "why did it not collide?" investigation
 * cares about), and then the second ball arriving, which briefly puts two pairs
 * in contact at once.
 */
export const CONTACT_WINDOW = { start: 34, end: 50 } as const;

/**
 * Segments {@link collectContactPoints} appends per contact point at its
 * defaults: three for the cross at `pointOnA`, one for the normal.
 */
export const SEGMENTS_PER_CONTACT = 4;

// ---------------------------------------------------------------------------
// The ReplayTarget wrapper — the pattern applications copy
// ---------------------------------------------------------------------------

/**
 * `PhysicsWorld` satisfies {@link ReplayTarget} structurally, stated as an
 * assignment the compiler has to accept (see the module header).
 *
 * A world used this way records and replays perfectly well — it simply cannot
 * carry recorded *inputs*, because `applyInput` is where an application's own
 * vocabulary lives. `ReplayPlayer`'s constructor refuses a recording that has
 * inputs when the target has no `applyInput`, so the limitation surfaces at
 * construction rather than as a silent divergence.
 */
export const PHYSICS_WORLD_AS_REPLAY_TARGET = (
  world: PhysicsWorld,
): ReplayTarget => world;

/**
 * Narrows a recorded §34 payload back to {@link ReplayInputPayload}.
 *
 * `ReplayTarget.applyInput` receives `JsonValue`, never the application's own
 * type: the document may have been read from disk, written by an older build,
 * or hand-edited. Every field is therefore checked, and a bad payload throws —
 * applying a partially understood input would produce a replay that diverges
 * for a reason no checksum can explain.
 *
 * @throws TypeError if `payload` is not `{ body: string, impulse: [x, y, z] }`
 * with three finite numbers
 */
export function decodeImpulseInput(payload: JsonValue): ReplayInputPayload {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new TypeError(
      `Replay input payload must be an object, got ${JSON.stringify(payload)}.`,
    );
  }
  const record = payload as { readonly [key: string]: JsonValue };
  const body = record.body;
  if (typeof body !== "string") {
    throw new TypeError(
      `Replay input payload.body must be a body name, got ${JSON.stringify(body)}.`,
    );
  }
  const impulse = record.impulse;
  if (!Array.isArray(impulse)) {
    throw new TypeError(
      `Replay input payload.impulse must be [x, y, z], got ${JSON.stringify(impulse)}.`,
    );
  }
  // `Array.isArray`'s predicate is `any[]`, which would poison everything read
  // out of it; re-state the element type the format actually guarantees (§34:
  // a payload is JSON) and check each component below.
  const components: readonly JsonValue[] = impulse;
  if (components.length !== 3) {
    throw new TypeError(
      `Replay input payload.impulse must be [x, y, z], got ${JSON.stringify(impulse)}.`,
    );
  }
  const x = components[0];
  const y = components[1];
  const z = components[2];
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof z !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z)
  ) {
    throw new TypeError(
      `Replay input payload.impulse must hold three finite numbers, got ${JSON.stringify(impulse)}.`,
    );
  }
  return { body, impulse: [x, y, z] };
}

/**
 * The reference {@link ReplayTarget}: one `PhysicsWorld` plus the application's
 * own input vocabulary.
 *
 * The three §34 members delegate verbatim — including
 * `PhysicsWorld.restoreSnapshot`'s adapter-name and adapter-version refusal, so
 * a replay against the wrong solver still fails where §34 says it must. Only
 * `applyInput` is the application's, and it is deliberately tiny: decode, look
 * up, apply through the ordinary §26 component API. Everything a
 * `fixedUpdate` listener would have done live, replay does identically.
 */
export class PhysicsReplayTarget implements ReplayTarget {
  readonly #world: PhysicsWorld;

  readonly #bodies: ReadonlyMap<string, RigidBody>;

  /** Impulse scratch, so replaying an input allocates nothing (§7b). */
  readonly #impulse = new Vector3();

  #inputsApplied = 0;

  /**
   * @param world the world whose §33 checksum and §34 snapshots are recorded
   * @param bodies the §26 command-buffer components a payload may name, by the
   * stable names {@link BALLS} gives them — **not** node references, because a
   * recording outlives the objects it was taken from
   */
  constructor(world: PhysicsWorld, bodies: ReadonlyMap<string, RigidBody>) {
    this.#world = world;
    this.#bodies = bodies;
  }

  /** The world this target records; handed out for the diagnostics reads. */
  get world(): PhysicsWorld {
    return this.#world;
  }

  /** Inputs applied since construction, live and replayed alike. */
  get inputsApplied(): number {
    return this.#inputsApplied;
  }

  /** §33's per-step checksum, straight from the world. */
  checksum(): number {
    return this.#world.checksum();
  }

  /**
   * §34's capture. The returned `PhysicsSnapshot` is assigned to
   * `ReplaySnapshot` here — one half of the structural check this class makes
   * (module header).
   */
  createSnapshot(): ReplaySnapshot {
    return this.#world.createSnapshot();
  }

  /**
   * §34's restore, refusal included. The `ReplaySnapshot` is narrowed to a
   * `PhysicsSnapshot` by {@link asPhysicsSnapshot} — see that helper for why
   * the consume direction needs one and why the narrowing is not trusted.
   */
  restoreSnapshot(snapshot: ReplaySnapshot): void {
    this.#world.restoreSnapshot(asPhysicsSnapshot(snapshot));
  }

  /**
   * Replays one recorded input (§34) — and applies one live one, because the
   * scenario drives its live impulses through this same method.
   *
   * @param step the simulation step the input belongs to; unused by this
   * application beyond diagnostics, and deliberately not trusted as an index
   * @param payload the recorded JSON, narrowed by {@link decodeImpulseInput}
   * @throws TypeError if the payload is malformed or names an unknown body
   */
  applyInput(step: number, payload: JsonValue): void {
    const input = decodeImpulseInput(payload);
    const body = this.#bodies.get(input.body);
    if (body === undefined) {
      throw new TypeError(
        `Replay input at step ${String(step)} names body ${JSON.stringify(input.body)}, which this scene does not contain.`,
      );
    }
    this.#impulse.set(input.impulse[0], input.impulse[1], input.impulse[2]);
    // §26: queued on the component, drained by the world at the top of the next
    // step — exactly what host script does live.
    body.applyImpulse(this.#impulse);
    this.#inputsApplied += 1;
  }
}

// ---------------------------------------------------------------------------
// The rig
// ---------------------------------------------------------------------------

/** A node plus the two §6a components a physics body is made of. */
interface BodyParts {
  readonly node: Node;
  readonly body: RigidBody;
  readonly collider: Collider;
}

/** How {@link addBody} authors one body. */
interface BodyOptions {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  /** Kilograms (§23); omitted for a static body. */
  readonly mass?: number;
  readonly restitution?: number;
  readonly friction?: number;
}

/**
 * Registers one body with `world` and returns its node and components.
 *
 * The node carries no descriptor pose: `PhysicsWorld.addBody` reads the node's
 * local transform when the descriptor has none, which is the path an
 * application actually takes.
 */
function addBody(
  world: PhysicsWorld,
  scene: Node,
  type: "dynamic" | "static",
  shape: CollisionShape,
  options: BodyOptions,
): BodyParts {
  const node = new Group();
  node.name = options.name;
  node.transform.position.set(options.x, options.y, 0);
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
  });
  node.addComponent(collider);

  scene.add(node);
  world.addBody(node);
  return { node, body, collider };
}

/** Everything a case needs to record, replay, or inspect the scenario. */
export interface ReplayRig {
  /** The headless application (no renderer anywhere in the import graph). */
  readonly app: Application;
  /** The one §39 system, at `PRIORITY_PHYSICS_SOLVE`. */
  readonly system: PhysicsSystem;
  /** The one 2D Rapier world. */
  readonly world: PhysicsWorld;
  /** The recordable target over {@link ReplayRig.world}. */
  readonly target: PhysicsReplayTarget;
  /** The §26 command buffers a scripted input may name, by {@link BALLS} name. */
  readonly bodies: ReadonlyMap<string, RigidBody>;
  /** Every registered body's node, in registration order (§33). */
  readonly nodes: readonly Node[];
  /**
   * One fixed step of *this* rig's application — the closure `ReplayPlayer`
   * wants as `stepFn`, handed out beside {@link ReplayRig.target} so the pairing
   * WP-10.2 cannot type-check is right by construction.
   */
  stepOnce(): void;
  /**
   * The §29 collision events dispatched since the previous call, in dispatch
   * order, and clears the buffer.
   *
   * Collected through listeners rather than `PhysicsWorld.queuedEvents`, which
   * `PhysicsSystem` has already drained by the time `Application.step` returns
   * (§39 steps 6 and 9). §29 dispatches a collision on **both** participants, so
   * a ball landing on the ground contributes two events carrying the same
   * manifold; that doubling is uniform across every run here and is what the
   * per-step segment counts are measured against.
   */
  drainEvents(): WorldPhysicsEvent[];
  /** Disposes the world and then the application (§83). */
  dispose(): void;
}

/**
 * Builds the scenario: a headless {@link Application}, one {@link PhysicsSystem},
 * one 2D Rapier world, the ground, and {@link BALLS}.
 *
 * Registration order is fixed and is part of every digest: §33's checksum visits
 * bodies in ascending solver id, which is creation order.
 *
 * Awaited twice over — `Application.initialize` (§45) and `PhysicsWorld.initialize`
 * (where Rapier's wasm image loads, cached per process).
 */
export async function createReplayRig(): Promise<ReplayRig> {
  const app = new Application({
    fixedTimeStep: DT,
    // §43 pose capture is a render concern and never feeds back into physics
    // state (§10, §42); off, so every number here is the solver's alone.
    poseInterpolation: false,
  });
  const system = new PhysicsSystem();
  app.systems.register(system);
  await app.initialize();

  const world = new PhysicsWorld({
    dimension: "2d",
    adapter: new Rapier2dAdapter(),
  });
  await world.initialize();
  system.track(world);

  const bodies = new Map<string, RigidBody>();
  const nodes: Node[] = [];
  const events: WorldPhysicsEvent[] = [];
  const watch = (parts: BodyParts): BodyParts => {
    for (const type of [
      "collisionstart",
      "collisionstay",
      "collisionend",
    ] as const) {
      parts.body.on(type, (event: RigidBodyCollisionEvent) => {
        events.push(event);
      });
    }
    nodes.push(parts.node);
    return parts;
  };

  watch(
    addBody(
      world,
      app.scene,
      "static",
      {
        type: "rectangle",
        halfExtents: new Vector2(GROUND.halfWidth, GROUND.halfHeight),
      },
      { name: "ground", x: 0, y: GROUND.centerY, friction: 0.8 },
    ),
  );
  for (const ball of BALLS) {
    const parts = watch(
      addBody(
        world,
        app.scene,
        "dynamic",
        { type: "circle", radius: ball.radius },
        {
          name: ball.name,
          x: ball.x,
          y: ball.y,
          mass: BALL_MASS,
          restitution: BALL_RESTITUTION,
          friction: BALL_FRICTION,
        },
      ),
    );
    bodies.set(ball.name, parts.body);
  }

  app.start();

  return {
    app,
    system,
    world,
    target: new PhysicsReplayTarget(world, bodies),
    bodies,
    nodes,
    stepOnce(): void {
      app.step(DT);
    },
    drainEvents(): WorldPhysicsEvent[] {
      const drained = events.slice();
      events.length = 0;
      return drained;
    },
    dispose(): void {
      world.dispose();
      app.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

/** Contacts and checksums one straight run of the scenario produced. */
export interface ScenarioRun {
  /** `world.checksum()` after every fixed step, in step order (§33). */
  readonly checksums: readonly number[];
  /**
   * §29 contact points dispatched during each step, indexed by 0-based step —
   * the quantity {@link SEGMENTS_PER_CONTACT} segments are drawn per.
   */
  readonly contactsPerStep: readonly number[];
  /** Fixed steps the scheduler ran; must equal {@link STEP_COUNT}. */
  readonly fixedStepCount: number;
  /** Simulation time the §10 clamp discarded; must be 0 on clean frames. */
  readonly droppedTime: number;
}

/** A recorded run: everything {@link ScenarioRun} has, plus the §34 document. */
export interface RecordedRun extends ScenarioRun {
  /** The canonical §34 recording. */
  readonly recording: ReplayRecording;
}

/** Sums the contact points carried by one step's dispatched §29 events. */
function countContacts(events: readonly WorldPhysicsEvent[]): number {
  let total = 0;
  for (const event of events) {
    if ("contacts" in event) {
      total += event.contacts.length;
    }
  }
  return total;
}

/**
 * Drives the scenario for {@link STEP_COUNT} clean frames, applying
 * {@link INPUT_SCHEDULE} through `rig.target.applyInput` and — when `recorder`
 * is given — recording each input and frame into a §34 document.
 *
 * Every injected frame is exactly {@link DT}, so §10's accumulator runs exactly
 * one fixed step per frame and drops nothing; the recorded frame records say so
 * (`stepCount: 1`, `droppedTime: 0`), which is what makes
 * `ReplayPlayer.advanceFrame` and `stepOnce` interchangeable here.
 *
 * The per-frame `stepCount` and `droppedTime` handed to the recorder are read as
 * **differences** of `TimeState.simulationStep` and `TimeState.droppedTime`,
 * which are cumulative (§9); the recorder wants this frame's share.
 */
export function driveScenario(
  rig: ReplayRig,
  recorder?: ReplayRecorder,
): ScenarioRun {
  const checksums: number[] = [];
  const contactsPerStep: number[] = [];
  let previousSteps = 0;
  let previousDropped = 0;

  for (let step = 0; step < STEP_COUNT; step += 1) {
    for (const entry of INPUT_SCHEDULE) {
      if (entry.step !== step) {
        continue;
      }
      // The live path *is* the replay path: same method, same decoder.
      rig.target.applyInput(step, entry.payload);
      recorder?.recordInput(step, entry.payload);
    }
    // Empty in steady state (the previous iteration drained), but stated so the
    // count below is unambiguously *this* step's.
    rig.drainEvents();
    rig.stepOnce();
    const time = rig.app.time;
    recorder?.recordFrame(
      time.simulationStep - previousSteps,
      time.droppedTime - previousDropped,
    );
    previousSteps = time.simulationStep;
    previousDropped = time.droppedTime;
    contactsPerStep.push(countContacts(rig.drainEvents()));
    checksums.push(rig.world.checksum());
  }

  return {
    checksums,
    contactsPerStep,
    fixedStepCount: rig.app.time.simulationStep,
    droppedTime: rig.app.time.droppedTime,
  };
}

/**
 * Runs the scenario once on a fresh rig, with no recorder attached, and disposes
 * it — the control run every recorded run is compared against.
 */
export async function runPlainRun(): Promise<ScenarioRun> {
  const rig = await createReplayRig();
  try {
    return driveScenario(rig);
  } finally {
    rig.dispose();
  }
}

/**
 * Runs the scenario once on a fresh rig **with** a {@link ReplayRecorder} and
 * returns the §34 document beside the run's own numbers.
 *
 * The recorder takes the initial snapshot at `begin` and a periodic one every
 * {@link SNAPSHOT_INTERVAL_STEPS} steps; both are reads, so a recorded run must
 * produce exactly the checksums an unrecorded one does — which
 * `../physics-replay.test.ts` asserts rather than assumes.
 */
export async function runRecordedRun(): Promise<RecordedRun> {
  const rig = await createReplayRig();
  const recorder = new ReplayRecorder();
  try {
    recorder.begin(rig.target, {
      fixedDeltaTime: DT,
      seed: SEED,
      snapshotIntervalSteps: SNAPSHOT_INTERVAL_STEPS,
      metadata: { scenario: "phase10-2d-drop", steps: STEP_COUNT },
    });
    const run = driveScenario(rig, recorder);
    return { ...run, recording: recorder.end() };
  } finally {
    recorder.abort();
    rig.dispose();
  }
}

// ---------------------------------------------------------------------------
// Frame-by-frame inspection (§113)
// ---------------------------------------------------------------------------

/** What one single-stepped frame of a replay showed (§113). */
export interface InspectedStep {
  /** 0-based simulation step that just ran. */
  readonly step: number;
  /** §29 contact points dispatched during it. */
  readonly contacts: number;
  /** Segments {@link collectContactPoints} appended for them. */
  readonly segments: number;
  /** Segments {@link collectContactImpulses} appended (one per contact). */
  readonly impulseSegments: number;
  /** Segments {@link collectBodyOrigins} appended (three per body). */
  readonly originSegments: number;
  /** Segments {@link collectCentersOfMass} appended (three per body). */
  readonly comSegments: number;
  /** Segments {@link collectBodyVelocities} appended (one per body). */
  readonly velocitySegments: number;
  /** {@link DebugDrawBuffer.lineCount} after all collections. */
  readonly lineCount: number;
  /** The §33 checksum after the step. */
  readonly checksum: number;
  /** {@link solverStatistics} read after the step — a copy, not the scratch. */
  readonly statistics: SolverStatistics;
}

/**
 * Reads one step's worth of §113 diagnostic data out of `rig` into `buffer`.
 *
 * Call it immediately after the step ran and before anything else touches the
 * rig: contacts are a per-step quantity, and the buffer is cleared here so the
 * overlay shows this step rather than history.
 *
 * The `WorldPhysicsEvent[]` handed to `collectContactPoints` is the one
 * cross-package check this suite can make about the two event declarations:
 * `@fourjs/diagnostics` transcribes §29's `ContactPoint` as its own
 * `DebugContactPoint` because it may not import `@fourjs/physics`, and nothing
 * type-checks the transcription — except this call.
 */
export function inspectStep(
  rig: ReplayRig,
  step: number,
  buffer: DebugDrawBuffer,
  statistics: SolverStatistics,
): InspectedStep {
  const events = rig.drainEvents();
  buffer.clear();
  const segments = collectContactPoints(events, buffer);
  // Every remaining body-level provider runs against the same live Rapier
  // adapter (recorded Phase 10 verifier note: these were exercised via fakes
  // only). `skipZero: false` keeps the impulse count = contact count even for
  // a resting contact whose normal impulse rounds to zero.
  const impulseSegments = collectContactImpulses(events, buffer, {
    skipZero: false,
  });
  const originSegments = collectBodyOrigins(rig.world.adapter, buffer);
  const comSegments = collectCentersOfMass(rig.world.adapter, buffer);
  const velocitySegments = collectBodyVelocities(rig.world.adapter, buffer);
  solverStatistics(rig.world.adapter, statistics);
  return {
    step,
    contacts: countContacts(events),
    segments,
    impulseSegments,
    originSegments,
    comSegments,
    velocitySegments,
    lineCount: buffer.lineCount,
    checksum: rig.world.checksum(),
    statistics: { ...statistics },
  };
}

/** A zeroed {@link SolverStatistics} record to reuse across steps (§7b). */
export function createSolverStatistics(): SolverStatistics {
  return {
    bodyCount: 0,
    sleepingCount: 0,
    awakeCount: 0,
    colliderCount: 0,
    maxBodyId: -1,
    contactCount: Number.NaN,
  };
}
