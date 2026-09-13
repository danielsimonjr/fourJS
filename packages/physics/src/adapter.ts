/**
 * The solver adapter contract (§37) — the seam every physics backend
 * implements.
 *
 * §20's promise is that "users should not need to write solver-specific
 * application code for common tasks". This interface is how that promise is
 * kept: `@fourjs/physics` is the stable API, and a concrete engine — Rapier,
 * Box2D, or a bespoke engineering solver — reaches it only through
 * {@link PhysicsSolverAdapter}. Nothing above this line names a solver type,
 * which is what lets the solver be swapped, compared against another, or left
 * out entirely.
 *
 * The interface below is §37's, member for member, with its abstract type names
 * bound to this package's concrete ones. Two shapes depart from §37's literal
 * text, both deliberately:
 *
 * - **`readonly` capability fields.** §37 writes `jointTypes: string[]`;
 *   {@link PhysicsCapabilities} makes the arrays and fields `readonly`. An
 *   adapter publishes its capabilities once and callers only read them — the
 *   same treatment `RendererCapabilities` (§62) got in `@fourjs/render`, and for
 *   the same reason: a capability set that could be edited after negotiation
 *   would make the negotiation meaningless.
 * - **Handles are opaque.** §37's `PhysicsBodyHandle` and friends are named but
 *   not defined; `types.ts` makes them branded, unforgeable types. An adapter
 *   casts its own solver object to one and back; nobody else can.
 * - **One additive capability field.** §37 lists six; {@link
 *   PhysicsCapabilities} carries an optional seventh, `tuning`, because §25's
 *   rolling/spinning friction and §32's sleeping thresholds are accepted by the
 *   stable API and honoured by no shipped solver. The field makes that visible
 *   instead of silent (see {@link PhysicsTuningCapabilities}); it adds no
 *   requirement to an adapter that never declares it.
 *
 * ## The call order the physics package guarantees (§37, §39)
 *
 * Per fixed step, and never in another order:
 *
 * 1. {@link PhysicsSolverAdapter.syncSceneToSolver} — scene-authored state goes
 *    in: kinematic targets, teleports, property changes.
 * 2. {@link PhysicsSolverAdapter.step} — the solver advances by one fixed
 *    delta.
 * 3. {@link PhysicsSolverAdapter.syncSolverToScene} — solved transforms come
 *    back out.
 * 4. {@link PhysicsSolverAdapter.drainEvents} — the step's contacts, triggers,
 *    and sleep transitions are collected, normalized (§101), and dispatched
 *    **after** the step (§6b, §29, §39 step 9).
 *
 * The pre-step body pose is retained by the physics package as the "previous"
 * pose for §43 render interpolation; interpolated poses are presentation-only
 * and are never written back into the solver (§43).
 *
 * ## What an adapter must never do
 *
 * - **Never invoke user callbacks** (§37). Events are returned from
 *   `drainEvents` and dispatched by the physics package, so a listener can
 *   safely create and destroy bodies without re-entering a running solver.
 * - **Never read the wall clock or `Math.random`** in the simulation path
 *   (§33). Time arrives as `step`'s argument; randomness comes from a seeded
 *   generator.
 * - **Never iterate in an order that is not insertion order** where that order
 *   can reach a result (§33).
 *
 * This module is types only — it ships no runtime code. The structural test
 * double that proves the interface is implementable is `FakeSolverAdapter`
 * (WP-5.3), alongside the world that drives it.
 */

import type { Disposable } from "@fourjs/core";

import type {
  ColliderDescriptor,
  JointDescriptor,
  PhysicsWorldOptions,
  RigidBodyDescriptor,
} from "./descriptors.js";
import type { PhysicsEvent } from "./events.js";
import type {
  OverlapHit,
  OverlapQuery,
  PointHit,
  PointQuery,
  RaycastHit,
  RaycastQuery,
  ShapeCastHit,
  ShapeCastQuery,
} from "./queries.js";
import type {
  CCDMode,
  DeterminismLevel,
  PhysicsBodyHandle,
  PhysicsColliderHandle,
  PhysicsDimension,
  PhysicsJointHandle,
} from "./types.js";

/**
 * Which queries an adapter implements (§37).
 *
 * Split out of {@link PhysicsCapabilities} only because §37 nests it there;
 * naming the type lets an adapter build its record with the compiler checking
 * that all four flags are answered.
 */
export interface PhysicsQueryCapabilities {
  /** Whether `raycast` is implemented (§30). */
  readonly raycast: boolean;
  /** Whether `shapeCast` is implemented (§30). */
  readonly shapeCast: boolean;
  /** Whether `overlap` is implemented (§30). */
  readonly overlap: boolean;
  /** Whether `pointQuery` is implemented (§30). */
  readonly point: boolean;
}

/**
 * Which *accepted* tunables an adapter actually applies (§25, §32, §37).
 *
 * §37 fixes {@link PhysicsCapabilities}'s six fields, so this is an **additive
 * seventh** rather than a re-shaping of them: every field here answers for a
 * value the stable API already accepts and validates, and whose only other
 * possible fate is to be taken and dropped. Silent accept-and-ignore is the one
 * outcome this repository does not allow — a coefficient a solver never reads
 * is a simulation that differs from the one that was authored, with nothing on
 * screen or in the log to say so — so an adapter answers here and
 * `PhysicsWorld` warns once when an authored value meets an adapter that cannot
 * honour it.
 *
 * `false` is not a defect: no Rapier 0.19.3 build exposes rolling or spinning
 * friction, or any sleeping threshold (both verified against the typings and
 * the wasm — see `physics-rapier`'s adapter headers). It is a statement of
 * where the value stops.
 */
export interface PhysicsTuningCapabilities {
  /** Whether `PhysicsMaterial.rollingFriction` reaches the solver (§25). */
  readonly rollingFriction: boolean;
  /** Whether `PhysicsMaterial.spinningFriction` reaches the solver (§25). */
  readonly spinningFriction: boolean;
  /**
   * Whether `PhysicsWorldOptions.sleeping`'s three **thresholds**
   * (`linearThreshold`, `angularThreshold`, `timeThreshold`) reach the solver
   * (§32).
   *
   * `SleepingConfig.enabled` is deliberately not part of this: an adapter that
   * cannot turn sleeping off can always refuse it outright, and both Rapier
   * adapters do honour `enabled` (`RigidBodyDesc.setCanSleep`).
   */
  readonly sleepThresholds: boolean;

  /**
   * Whether a §28 joint motor's `maxTorque` / `maxForce` is a **hard ceiling**
   * on the effort the motor may apply (PH-22e, 2026-08-08).
   *
   * The odd one out of this record, and deliberately so: the other three
   * answer "does this value reach the solver at all", and this one answers
   * "does it mean what §28 says it means". Both Rapier adapters take the value
   * — it is not dropped — and hand it to `configureMotorVelocity` as a
   * `ForceBased` strength **gain**, so a motor authored with `maxTorque: 50`
   * is stronger than one authored with `maxTorque: 5` but does not stall at
   * 50 N·m. Rapier 0.19.3 exposes no motor-force ceiling in JS, so no
   * declaration of `true` is available there.
   *
   * A solver whose motor limit is a genuine cap — Box2D's `maxMotorTorque` is
   * the canonical one — declares `true`, and §90's compatibility tables then
   * show the difference instead of burying it in an adapter's prose. This is
   * the only member of {@link PhysicsTuningCapabilities} whose `false` means
   * "applied, differently" rather than "not applied", which is why it carries
   * its own paragraph rather than a one-line entry.
   */
  readonly jointMotorEffortCap: boolean;
}

/**
 * The all-`false` reading of a {@link PhysicsCapabilities.tuning} that was
 * never declared.
 *
 * "Undeclared" cannot mean "supported": an adapter that has not answered has
 * given no evidence that it applies anything, and assuming it does is exactly
 * the silent accept-and-ignore the declaration exists to expose. An adapter
 * that does honour one of these says so.
 */
export const NO_TUNING_CAPABILITIES: PhysicsTuningCapabilities = Object.freeze({
  rollingFriction: false,
  spinningFriction: false,
  sleepThresholds: false,
  jointMotorEffortCap: false,
});

/**
 * `capabilities.tuning`, or {@link NO_TUNING_CAPABILITIES} when the adapter did
 * not declare one. See {@link PhysicsTuningCapabilities}.
 */
export function resolveTuningCapabilities(
  capabilities: PhysicsCapabilities,
): PhysicsTuningCapabilities {
  return capabilities.tuning ?? NO_TUNING_CAPABILITIES;
}

/**
 * What a solver can do (§37).
 *
 * §37: *"Capability declarations drive `solver: "auto"` selection (§20) and the
 * compatibility tables of §90."* They also decide what a world may ask for — a
 * world that requests a determinism tier or a CCD mode the adapter does not
 * declare fails at construction rather than degrading quietly (WP-5.3).
 *
 * Declarations must be **honest**. Declaring a capability an adapter does not
 * have converts a clear construction-time error into a wrong simulation, which
 * is the failure mode this whole record exists to prevent.
 */
export interface PhysicsCapabilities {
  /** The §21 dimensions this adapter can simulate; at least one. */
  readonly dimensions: readonly PhysicsDimension[];

  /**
   * The §28 joint types this adapter implements, by name.
   *
   * `string` rather than the engine's `JointType` union, per §37 — an adapter
   * may expose a solver-specific constraint the engine has no name for. An
   * adapter declares exactly the `ShippedJointType`s it builds (plan P6-1);
   * `[]` means `createJoint` throws `NOT_IMPLEMENTED`, which is where the two
   * Rapier adapters stand until WP-6.2/6.3.
   *
   * This declaration is about *which* types an adapter builds. Whether the
   * engine can talk to its joints at all — ids, reactions, live reconfiguration
   * — is the separate `SolverJointAccess` seam, detected structurally rather
   * than declared here, because §37 fixes this record's six fields.
   */
  readonly jointTypes: readonly string[];

  /**
   * The §31 CCD modes this adapter implements. Always contains `"disabled"`,
   * since doing nothing is always available.
   */
  readonly ccdModes: readonly CCDMode[];

  /**
   * The strongest §33 tier this adapter can actually achieve. Not an
   * aspiration: the §92 determinism tests are written against it.
   */
  readonly determinism: DeterminismLevel;

  /**
   * Whether {@link PhysicsSolverAdapter.createSnapshot} and
   * {@link PhysicsSolverAdapter.restoreSnapshot} are implemented (§34).
   */
  readonly snapshots: boolean;

  /** Which of §30's queries are implemented. */
  readonly queries: PhysicsQueryCapabilities;

  /**
   * Which accepted §25/§32 tunables this adapter actually applies.
   *
   * Optional because §37 fixes the six fields above and an adapter written
   * against that list cannot have answered; omitting it reads as
   * {@link NO_TUNING_CAPABILITIES} — "none of them reach the solver" — through
   * {@link resolveTuningCapabilities}, which is the reading that produces a
   * warning rather than the one that hides a dropped coefficient.
   */
  readonly tuning?: PhysicsTuningCapabilities;
}

/**
 * A concrete physics engine, bound to the fourJS API (§37).
 *
 * ```ts
 * const adapter: PhysicsSolverAdapter = new RapierAdapter2D();
 * await adapter.initialize({ dimension: "2d", gravity: new Vector2(0, -9.81) });
 * const body = adapter.createBody({ type: "dynamic", position: new Vector2(0, 5) });
 * adapter.createCollider({ body, shape: { type: "circle", radius: 0.5 } });
 * // …per fixed step: syncSceneToSolver → step → syncSolverToScene → drainEvents
 * adapter.dispose();
 * ```
 *
 * Extends `Disposable` (§83) rather than re-declaring `dispose()`, which §37
 * lists; the member is restated below only to carry the physics-specific
 * contract.
 */
/** The derived-event interests a world can switch off (see {@link PhysicsSolverAdapter.setEventInterest}). */
export interface PhysicsEventInterest {
  /** Whether any registered body listens for `collisionstay`. */
  readonly collisionstay: boolean;
}

export interface PhysicsSolverAdapter extends Disposable {
  /**
   * Stable identifier of the backing solver, e.g. `"rapier2d"`. Recorded in
   * snapshots and replays (§34), which refuse to run against a different
   * solver.
   */
  readonly name: string;

  /**
   * Version of the backing solver. Part of a snapshot's validity key (§34): a
   * snapshot is opaque adapter data, valid only for the same adapter, adapter
   * version, and world configuration that produced it.
   */
  readonly version: string;

  /** What this adapter can do (§37). Readable before `initialize`. */
  readonly capabilities: PhysicsCapabilities;

  /**
   * Creates the solver's world from `options` (§37).
   *
   * May return a promise — WebAssembly-backed solvers load their module here —
   * or nothing when the solver is synchronous; §37 allows both, and the
   * physics package awaits the result either way. Calling it twice is an
   * implementation-defined error, not a second world.
   */
  initialize(options: PhysicsWorldOptions): Promise<void> | void;

  /** Creates a body and returns its opaque handle (§37, §23). */
  createBody(desc: RigidBodyDescriptor): PhysicsBodyHandle;

  /**
   * Destroys a body and everything attached to it (§37).
   *
   * The handle is invalid afterwards. §33's checksum orders bodies by an
   * engine-assigned monotonic id precisely so that destruction cannot perturb
   * that order.
   */
  destroyBody(handle: PhysicsBodyHandle): void;

  /** Creates a collider on `desc.body` and returns its handle (§37, §24). */
  createCollider(desc: ColliderDescriptor): PhysicsColliderHandle;

  /** Destroys a collider (§37). The handle is invalid afterwards. */
  destroyCollider(handle: PhysicsColliderHandle): void;

  /**
   * Creates a joint and returns its handle (§37, §28).
   *
   * `desc` is the full plan P6-1 discriminated union (WP-6.1); anchors and axes
   * in it are **body-local**, already converted from the world-space frames the
   * `Joint` classes are authored in. An adapter that does not build the type it
   * is handed throws `FourError("NOT_IMPLEMENTED")` and declares that by
   * leaving the type out of `capabilities.jointTypes`.
   *
   * An adapter with joints also implements `SolverJointAccess`, without which
   * `PhysicsWorld.addJoint` refuses to register anything: §37's two methods mint
   * and release a handle but cannot answer for the joint afterwards.
   */
  createJoint(desc: JointDescriptor): PhysicsJointHandle;

  /**
   * Destroys a joint (§37). The handle is invalid afterwards.
   *
   * The physics package destroys a joint before either of its bodies and before
   * disposal, so an adapter never has to guess what a constraint on a dead body
   * means (§83).
   */
  destroyJoint(handle: PhysicsJointHandle): void;

  /**
   * Advances the simulation by exactly `delta` **seconds** (§7a, §10).
   *
   * Called once per fixed step with the world's fixed delta; the accumulator,
   * the sub-step clamp, and the dropped time are §10's business, not the
   * adapter's. An adapter must not sub-divide the step on its own except as
   * part of CCD, and must not read a clock to decide how far to advance (§33).
   */
  step(delta: number): void;

  /**
   * Tells the adapter which *derived* events anyone is listening for, so it
   * can skip building the ones nobody will read (2026-09-11). Optional and
   * additive: an adapter that omits it behaves as if every interest were
   * `true`. `PhysicsWorld` calls it before `step` whenever the answer changes
   * (never every step), computed from the registered bodies' listener counts.
   *
   * Today the one interest is `collisionstay`: Rapier reports start/end pairs
   * itself, but a *stay* event is synthesised per touching pair per step
   * (pair key, contact points, world-space vectors), which the physics
   * benchmark attributes most of a piled-body step to. Start/end events,
   * trigger events, the §33 event order, and the solver's own state are not
   * affected — the interest gates *translation*, never simulation.
   */
  setEventInterest?(interest: PhysicsEventInterest): void;

  /**
   * Returns and clears the events accumulated during the preceding `step`
   * (§37).
   *
   * Order must be deterministic for a given step. Returning an empty array is
   * normal. The physics package normalizes these into node-facing events (§101)
   * and dispatches them after the step (§6b, §29) — an adapter never calls user
   * code itself.
   */
  drainEvents(): PhysicsEvent[];

  /**
   * Pushes scene-authored state into the solver (§37): kinematic targets,
   * teleports, and property changes made since the last step.
   */
  syncSceneToSolver(): void;

  /**
   * Publishes solved body transforms back to the scene (§37), which the
   * physics package writes under `"physics"` transform authority (§42).
   */
  syncSolverToScene(): void;

  /** Casts a ray (§30). Requires `capabilities.queries.raycast`. */
  raycast(query: RaycastQuery): RaycastHit[];

  /** Sweeps a shape (§30). Requires `capabilities.queries.shapeCast`. */
  shapeCast(query: ShapeCastQuery): ShapeCastHit[];

  /** Tests a static shape for overlaps (§30). Requires `capabilities.queries.overlap`. */
  overlap(query: OverlapQuery): OverlapHit[];

  /** Tests a point (§30). Requires `capabilities.queries.point`. */
  pointQuery(query: PointQuery): PointHit[];

  /**
   * Serializes the solver's world (§34). Optional in §37, and present only when
   * `capabilities.snapshots` is `true`.
   *
   * The buffer is **opaque adapter data**: valid only for the same adapter,
   * the same adapter version, and the same world configuration that produced
   * it. The replay format records the adapter name and version and refuses to
   * run against a different solver (§34).
   */
  createSnapshot?(): ArrayBuffer;

  /**
   * Restores a world previously captured by
   * {@link PhysicsSolverAdapter.createSnapshot} (§34). Body identity and
   * ordering survive the round trip, so §33's checksums remain comparable
   * across a restore.
   */
  restoreSnapshot?(snapshot: ArrayBuffer): void;

  /**
   * Releases the solver's world and every resource this adapter owns (§37,
   * §83). Must be idempotent and terminal; handles minted by this adapter are
   * invalid afterwards.
   */
  dispose(): void;
}
