/**
 * §12's **solver-backed** character controller — {@link SweptCharacterController}
 * and the {@link SweptCharacterSystem} that advances it (`PH-11b`, 2026-08-21).
 *
 * `PH-11` shipped the kinematic half in `@fourjs/motion`: a `CharacterController`
 * whose ground is a horizontal *plane*, which needs no collision query at all.
 * Its module note named what it staged and where the staged half had to live:
 *
 * > What is **staged, with its seam named**: capsule sweeps, slide-along-wall,
 * > step height, slope limits and moving platforms. Every one of them needs a
 * > shape cast against the collision world. `@fourjs/physics` already has one —
 * > `PhysicsWorld.shapeCast` (§30) — but §3.1's frozen dependency matrix gives
 * > `@fourjs/motion` only `core`, `math` and `scene`, and the edge runs the other
 * > way: **`physics` depends on `motion`.**
 *
 * This module is that packet. §30 promises the cast in as many words —
 * `world.shapeCast(shape, transform, direction, options)`, with "collision
 * groups; masks; ignored bodies; first hit; ... custom filters" — and
 * {@link SweptCharacterController} is that promise spent on the four features
 * §12 leaves a plane unable to express: a **capsule sweep**, **slide along
 * wall**, **step height** and a **slope limit**.
 *
 * ```ts
 * const player = new Group();
 * player.transformAuthority = "kinematic";               // §42 — required
 * const character = player.addComponent(
 *   new SweptCharacterController({
 *     world,                                             // the collision world
 *     radius: 0.35,
 *     halfHeight: 0.5,                                   // capsule, +Y axis (§24)
 *     moveSpeed: 4,
 *     stepHeight: 0.35,
 *     slopeLimit: Math.PI / 4,                           // radians (§7a)
 *   }),
 * );
 *
 * const characters = new SweptCharacterSystem();
 * characters.track(player);
 * app.systems.register(characters);                      // priority 400, §39 step 4
 * app.systems.register(new PhysicsSystem({ worlds: [world] }));   // 600
 * ```
 *
 * ## The recorded question: *extends* or *holds*? — **holds** (decision)
 *
 * `TODO.md` filed this packet with one open question: "whether the swept
 * controller *extends* the kinematic one or holds one". It **holds** one, and
 * the reason is a fact about the source rather than a taste:
 *
 * - `CharacterController`'s vertical state — `#verticalVelocity`, `#grounded`,
 *   `#headingDirty` — is **ES-private with no setters**. `jump()` and
 *   `ground()` are the only mutators, and neither can express "stopped by a
 *   ceiling", "walked off a ledge", or "landed on a 20° ramp at y = 1.37". A
 *   subclass overriding `step` therefore *cannot maintain the state its own
 *   inherited getters report*.
 * - And it should not want to. `CharacterController.grounded` is a promise
 *   about a **plane**: "the character is standing at `groundHeight`". A swept
 *   controller's `grounded` is a promise about **geometry**: "the last downward
 *   cast found a collider whose normal is within `slopeLimit`". Those are
 *   different propositions that happen to share a name.
 *
 * So `extends` would inherit a public API it cannot keep true — `grounded`,
 * `verticalVelocity`, `jump()`, `ground()`, `groundHeight` — which is precisely
 * the *accepted-and-ignored* failure this repository refuses elsewhere. The
 * rule worth keeping: **inherit only when you can keep every inherited
 * promise.**
 *
 * Holding gets what the gap analysis actually asked for ("reusing
 * `CharacterController`'s intent/heading/gravity state") without any of that.
 * The held instance is the **parameter, heading and intent store**, and every
 * member of it this class needs is public:
 *
 * | held for | reached through |
 * |---|---|
 * | heading | `yaw` (get/set), `turn(delta)` |
 * | planar intent, clamped to the unit disc | `setMoveIntent`, `stop`, `intentForward`, `intentRight` |
 * | locomotion and fall parameters, with their §85 refusals | `moveSpeed`, `gravity`, `jumpSpeed`, `maxFallSpeed` |
 *
 * Nothing is duplicated: the unit-disc clamp (and its recorded `Math.sqrt`
 * -not-`Math.hypot` §33 decision), the unbounded-yaw convention and every
 * `RangeError` in §85's authoring tier are **executed by the held object**, so
 * a swept character and a kinematic one cannot drift apart on what an intent,
 * a heading or a negative `moveSpeed` means. What this class adds is the
 * vertical integrator and the collision resolution — the half whose meaning
 * changed. The held controller's own `step` is never called and its
 * `groundHeight` is never read; neither is exposed.
 *
 * ## Collide and slide (§30), and why the iteration count is a constant
 *
 * One fixed step resolves in three phases, all of them shape casts of the same
 * capsule through {@link PhysicsWorld.shapeCast}:
 *
 * ```text
 * 1. horizontal   intent → velocity → Δ, then collide-and-slide, ≤ maxSlides casts
 *                 (+ up to 3 more for one step-up attempt)
 * 2. vertical     grounded → one downward probe (snap or leave the ground)
 *                 airborne → integrate gravity, one cast along the Δ
 * 3. write        one finiteness check, then position and rotation together
 * ```
 *
 * The horizontal phase is the classic collide-and-slide: cast the capsule along
 * what is left of the motion, advance to just short of the impact
 * ({@link SweptCharacterController.skinWidth} short), remove the component of
 * the remainder that points into the surface, and go again. Each iteration
 * either consumes distance or removes a degree of freedom, so a character in a
 * corner converges — but "converges" is not "terminates", and a cast that
 * reports a zero distance every time (a capsule that starts already overlapping,
 * which §30 says is reported as `distance: 0`) would spin forever. The loop is
 * therefore bounded by {@link SweptCharacterController.maxSlides}, a **stated
 * constant** rather than an epsilon: the worst case is a fixed number of solver
 * calls per character per step, which is what a fixed step (§10) needs from
 * everything inside it. Motion left over when the budget runs out is **dropped**
 * — the character stops — because the alternative is to move it into geometry.
 *
 * The step-up attempt is tried at most **once** per fixed step and only from a
 * grounded character blocked by a surface too steep to walk: cast up by
 * `stepHeight`, cast forward from up there **by at least one capsule radius**,
 * cast back down, and accept the result only if it lands on ground within
 * `slopeLimit` and no lower than it started. Three casts, bounded, and it
 * refuses rather than teleports. The radius floor on the forward reach is the
 * non-obvious part and it is load-bearing: a step that stopped with half the
 * capsule over the lip would contact the step's *edge*, and an edge's contact
 * normal is not the tread's — the flat surface underneath would read as too
 * steep to stand on and the character would jitter on the lip for ever. So a
 * step-up may deliberately over-step by up to one radius, at most once per
 * fixed step.
 *
 * ## §42: `"kinematic"`, even though it consults the solver (decision)
 *
 * §42 asks who **writes** a node's transform, and every query here is a *read*.
 * The pose is derived from the character's intent, its heading and the geometry
 * it swept through, and then written by this system; the solver never writes
 * this node and is never asked to. `"physics"` would be a false claim — it
 * would also make `PhysicsWorld`'s publish pass overwrite the character with a
 * solver pose that does not exist. §12's opening sentence has already settled
 * the tier for us: *"Kinematic controllers directly prescribe movement."* A
 * swept controller still prescribes; it merely consults geometry first about
 * what the prescription is allowed to be.
 *
 * ## §39: step 4, with the kinematics — *before* the solve (decision)
 *
 * {@link SweptCharacterSystem} defaults to `PRIORITY_KINEMATICS` (400), the
 * same §39 step 4 `KinematicSystem` occupies, and **not** a slot after the
 * solve. Three reasons, in order of force:
 *
 * 1. **A kinematic body is fed from the node transform at the top of
 *    `world.step`.** `PhysicsWorld`'s documented step order reads "1. per body
 *    … kinematic bodies: `setNextKinematicTransform`". So a character carrying
 *    a `"kinematic-position"` `RigidBody` — which is how dynamic objects come
 *    to collide with it at all — has *this step's* pose pushed into the solver
 *    if and only if it was written before step 6. Writing after the solve would
 *    delay the character's own collider by one full step behind the pose it
 *    just computed, and the sweep would then be resolving against a world in
 *    which the character is somewhere else.
 * 2. **The geometry it queries is start-of-step geometry, which is the only
 *    self-consistent reading.** At priority 400 every cast sees the world as
 *    the previous step's solve left it — exactly the convention
 *    `ForceFieldSystem` states for velocity ("the start-of-step value"), and it
 *    pairs correctly with (1): the character's collider and the geometry it
 *    swept against are then from the same instant.
 * 3. **It is a prescription, and step 4 is where prescriptions are written.**
 *    Reading the solved world instead would make the character a *reaction* to
 *    the solve, which is what §22's dynamic bodies are for.
 *
 * ## One authority, and the second system this could not avoid
 *
 * The `PH-11` rule stands: "one authority means one system, even when the
 * components are unrelated". This packet is the exception the rule's own
 * argument permits, and the reason is §3.1 rather than preference —
 * `KinematicSystem` lives in `@fourjs/motion`, which may not name
 * `PhysicsWorld`, so it *cannot* advance a solver-backed controller no matter
 * how much one would prefer it to. `@fourjs/physics` publishing a
 * `SimulationSystem` at a `@fourjs/motion` priority is the established shape here
 * (`ForceFieldSystem` at 500, `createPoseTargetCaptureSystem` before 300).
 *
 * What the rule was protecting against — *a second writer of one node that
 * nothing could catch* — is caught: the two systems dispatch on **disjoint
 * component types**, so a node reached by both is a node carrying both a
 * `CharacterController` and a `SweptCharacterController`, and
 * {@link SweptCharacterSystem.fixedUpdate} refuses to advance such a node and
 * says so once. Two locomotion components on one node is an authoring mistake,
 * not a layering.
 *
 * ## The frame: world space, by the same identification the publish pass makes
 *
 * A cast is world-space; `transform.position` is parent-local. This class
 * writes the second with the first, which is the identification
 * `PhysicsWorld`'s publish pass already makes when it reads a solver's world
 * pose straight into `node.transform.position`. So the rule is the tier's
 * existing one, restated: **a node driven by the physics tier lives in an
 * untransformed parent chain.** A character parented under a rotated or moved
 * ancestor is outside this contract — and is also the moving-platform case,
 * which is staged below.
 *
 * ## What is staged, and the seam for each
 *
 * - **Pushing dynamic bodies (PH-11c).** A horizontal slide hit against a
 *   `"dynamic"` `RigidBody` imparts an impulse at `ShapeCastHit.point` via
 *   `body.applyImpulseAtPoint`. The character is kinematic, so
 *   {@link SweptCharacterController.pushMass} (default 80 kg) is the mass used
 *   for the reduced-mass split only. Sleepers are woken (`body.wake()` before
 *   the impulse — `applyImpulse` does not wake). Static and kinematic hits
 *   receive nothing. Opt out with `pushDynamics: false` to restore the
 *   pre-PH-11c no-push behaviour.
 * - **Moving-platform carry.** A character *stands on* a dynamic or kinematic
 *   body perfectly well — grounding is a geometric fact and the probe reports
 *   it — but it is **not carried** when that body moves. Carry needs the
 *   platform's per-step delta, which means its previous pose (§43's
 *   `PoseBuffer`, captured at step 10 *after* this system runs) and a §42 story
 *   for a node whose motion is partly another node's. **Seam, made concrete:**
 *   {@link SweptCharacterController.groundBody} is published, so an application
 *   can difference the platform's transform itself and call
 *   {@link SweptCharacterController.translate} before the step that should
 *   carry it.
 * - **Coyote time and jump buffering.** Deliberately absent. Neither is a
 *   collision fact; both are input-feel policies expressed in *frames the
 *   player is forgiven*, and an application composes them from `grounded` in
 *   three lines. Absent beats accepted-and-ignored — `CharacterController`'s
 *   `maxAngularSpeed` argument, applied to a timer.
 * - **`"2d"` worlds.** Refused at construction (§85). A heading about `+Y` is
 *   the whole of this class's planar model and a 2D character has no heading —
 *   it has a facing and a single movement axis. That is a different class with
 *   a different intent surface, not a flag on this one.
 *
 * ## Determinism (§33)
 *
 * **`same-runtime`** — and note *why* it cannot be better here even though the
 * arithmetic below is ordinary: this controller consumes solver queries, so it
 * inherits the solver's tier. Rapier is compiled WebAssembly whose state
 * crosses the JS/wasm boundary as f64 → f32, so a shape cast's distance and
 * normal are runtime-bound before this file touches them. On top of that the
 * class calls `Math.sin`/`Math.cos` (the heading basis and the yaw quaternion),
 * `Math.sqrt` (never `Math.hypot` — only `sqrt` is specified exactly rounded)
 * and `Math.cos` once at construction for the slope limit. No clock, no
 * `Math.random`, no hash-ordered iteration, and no allocation after
 * construction beyond the hit arrays `PhysicsWorld.shapeCast` itself returns.
 * `tests/determinism/swept-character.test.ts` is the golden, on real Rapier 3D.
 */

import { DEV_WARNING_PREFIX, FourError } from "@fourjs/core";
import type { Component, ComponentHost } from "@fourjs/core";
import { Vector3 } from "@fourjs/math";
import {
  CharacterController,
  PRIORITY_KINEMATICS,
  type FixedUpdateContext,
  type SimulationSystem,
} from "@fourjs/motion";
import { warnAuthorityConflict, type Node } from "@fourjs/scene";

import { ALL_COLLISION_GROUPS } from "./queries.js";
import type { RigidBody } from "./rigid-body.js";
import type { CollisionShape } from "./shapes.js";
import type { PhysicsBodyHandle } from "./types.js";
import type { PhysicsWorld, WorldShapeCastHit } from "./world.js";

/**
 * §42 authority this controller writes under — `"kinematic"`, the same one
 * `KinematicController` and `CharacterController` write under. See the module
 * note for why consulting the solver does not make it `"physics"`.
 */
const KINEMATIC_AUTHORITY = "kinematic";

/**
 * Default {@link SweptCharacterController.slopeLimit}, in radians (§7a):
 * `π/4`, forty-five degrees.
 *
 * The angle at which "a ramp you walk up" becomes "a wall you slide down" is a
 * genre convention rather than a physical constant, and 45° is the one every
 * engine in the genre ships. Stated as a radian because §7a admits no other
 * angular unit.
 */
export const DEFAULT_SLOPE_LIMIT = Math.PI / 4;

/**
 * Default {@link SweptCharacterController.stepHeight}, in metres: `0.3`.
 *
 * A stair riser, near enough — high enough to climb ordinary steps and kerbs,
 * low enough that a character does not silently levitate over knee-high
 * geometry an author meant as an obstacle. `0` disables step-up entirely and is
 * legal.
 */
export const DEFAULT_STEP_HEIGHT = 0.3;

/**
 * Default {@link SweptCharacterController.skinWidth}, in metres: `0.01`.
 *
 * The gap the capsule is kept from every surface it touches. It exists because
 * a sweep that stops *exactly* on contact leaves the next step's cast starting
 * in an overlap, which §30 reports as `distance: 0` — a state the resolver can
 * make no progress from. One centimetre is far below the smallest capsule this
 * class accepts and far above the f32 noise a wasm solver returns (see §33
 * above).
 */
export const DEFAULT_SKIN_WIDTH = 0.01;

/**
 * Default {@link SweptCharacterController.groundSnapDistance}, in metres:
 * `0.1`.
 *
 * How far below its feet a **grounded** character will look for the ground
 * before admitting it has left it. Without it a character walking down any
 * ramp leaves the ground on every step, falls a fraction of a millimetre, lands,
 * and repeats — visible as a stutter and audible as a landing sound sixty times
 * a second. This is a collision fact (the ground *is* there, just lower), which
 * is why it ships while coyote time does not.
 */
export const DEFAULT_GROUND_SNAP_DISTANCE = 0.1;

/**
 * Default {@link SweptCharacterController.maxSlides}: `4`.
 *
 * Four is the smallest budget that resolves the cases a character actually
 * meets: one wall (1), an inside corner (2), a corner with a slope (3), and one
 * spare so that reaching the cap is a genuinely degenerate configuration rather
 * than an ordinary Tuesday. Every unit above it is a solver call per character
 * per step.
 */
export const DEFAULT_MAX_SLIDES = 4;

/**
 * Default {@link SweptCharacterController.pushMass}, in kilograms: `80`.
 *
 * The controller is kinematic and is not a solver body; this is the mass used
 * only for the PH-11c reduced-mass push against a dynamic hit.
 */
export const DEFAULT_PUSH_MASS = 80;

/**
 * Default {@link SweptCharacterController.pushImpulseScale}: `1`.
 *
 * A dimensionless gain on the PH-11c push impulse. `0` disables the impulse
 * while still allowing the character to slide; prefer `pushDynamics: false`
 * when the whole interaction should be off.
 */
export const DEFAULT_PUSH_IMPULSE_SCALE = 1;

/**
 * Horizontal or vertical motion at or below this many metres in one step is
 * treated as none at all, in metres.
 *
 * Not a tolerance on the *result* — it is the guard that stops the resolver
 * casting with a direction it would have to normalize by a denormal. A
 * micrometre per fixed step is 60 µm/s, which no character is trying to
 * express.
 */
const MINIMUM_MOTION = 1e-6;

/** Throws unless `value` is a finite number `> 0`. */
function assertPositive(value: number, what: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `${what} must be a finite number > 0 (§85); received ${String(value)}`,
    );
  }
}

/** Throws unless `value` is a finite number `>= 0`. */
function assertNonNegative(value: number, what: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${what} must be a finite number >= 0 (§85); received ${String(value)}`,
    );
  }
}

/** Options for {@link SweptCharacterController} (§12, §24, §30). */
export interface SweptCharacterControllerOptions {
  /**
   * The collision world every sweep is cast against (§30). Optional so a
   * component restored from a §79 document can be re-bound afterwards, exactly
   * as a reloaded `RigidBody` is registered afterwards; a controller with no
   * world writes nothing.
   *
   * Must be a `"3d"` world — see the module note on `"2d"`.
   */
  world?: PhysicsWorld;

  /** Radius of the swept capsule, in metres (§24). Finite and `> 0`. */
  radius: number;

  /**
   * Half the length of the capsule's **cylindrical** section, in metres — §24's
   * own parameterization, so the total height is `2 · (halfHeight + radius)`
   * and the axis is `+Y`. Finite and `> 0`.
   */
  halfHeight: number;

  /** Initial heading in radians (§7a). Default `0`. */
  yaw?: number;

  /** Speed a full move intent produces, in m/s. Default `1`. */
  moveSpeed?: number;

  /** Vertical acceleration in m/s² while airborne. Default `−9.81`. */
  gravity?: number;

  /** Upward speed {@link SweptCharacterController.jump} imparts, in m/s. Default `4`. */
  jumpSpeed?: number;

  /** Terminal downward speed in m/s, or `Infinity` (the default) for none. */
  maxFallSpeed?: number;

  /** Initial vertical velocity in m/s — what §79 restores. Default `0`. */
  verticalVelocity?: number;

  /** Whether the character starts grounded. Default `false`. */
  grounded?: boolean;

  /**
   * Largest rise the character climbs without jumping, in metres. Finite and
   * `>= 0`; `0` disables step-up. Default {@link DEFAULT_STEP_HEIGHT}.
   */
  stepHeight?: number;

  /**
   * Steepest ground the character stands on, in radians from horizontal (§7a).
   * `0 <= slopeLimit < π/2`. Default {@link DEFAULT_SLOPE_LIMIT}.
   */
  slopeLimit?: number;

  /**
   * Gap kept between the capsule and every surface, in metres. Finite, `> 0`,
   * and **less than `radius`**. Default {@link DEFAULT_SKIN_WIDTH}.
   */
  skinWidth?: number;

  /**
   * How far a grounded character looks down for its ground, in metres. Finite
   * and `>= 0`. Default {@link DEFAULT_GROUND_SNAP_DISTANCE}.
   */
  groundSnapDistance?: number;

  /**
   * Collide-and-slide iteration budget for one step. An integer `>= 1`.
   * Default {@link DEFAULT_MAX_SLIDES}.
   */
  maxSlides?: number;

  /** §30 bit set the character's own casts belong to. Defaults to every bit. */
  collisionGroups?: number;

  /** §30 bit set the character's casts may hit. Defaults to every bit. */
  collisionMask?: number;

  /**
   * Mass, in kilograms, used only for the PH-11c reduced-mass push against a
   * dynamic hit. The controller is kinematic and is not a solver body.
   * Finite and `> 0`. Default {@link DEFAULT_PUSH_MASS}.
   */
  pushMass?: number;

  /**
   * Dimensionless gain on the push impulse. Finite and `>= 0`.
   * Default {@link DEFAULT_PUSH_IMPULSE_SCALE}.
   */
  pushImpulseScale?: number;

  /**
   * Whether a horizontal slide against a `"dynamic"` body imparts an impulse.
   * Default `true`. `false` restores the pre-PH-11c no-push behaviour.
   */
  pushDynamics?: boolean;
}

/**
 * §12's character controller resolved against the **collision world** — a
 * capsule swept through {@link PhysicsWorld.shapeCast} (§30), sliding along
 * walls, stepping over risers up to {@link SweptCharacterController.stepHeight}
 * and standing only on ground within
 * {@link SweptCharacterController.slopeLimit}.
 *
 * Written under §42's `"kinematic"` authority by {@link SweptCharacterSystem}
 * at §39 step 4. See the module note for the *holds*-not-*extends* decision,
 * the §39 placement argument, and everything this tier stages.
 *
 * ## Parameters are fixed at construction (§85)
 *
 * The capsule, the skin, the slide budget, the step height and the slope limit
 * are `readonly`: a retuned character is a new character (`OrbitRig`'s rule).
 * Every one of them changes what a *query* means, so a mid-run change would
 * silently make this step's casts incomparable with the last's — and it keeps
 * every §85 refusal in one place, the constructor, refusing rather than
 * clamping. The locomotion parameters that do not touch a query — `moveSpeed`,
 * `gravity`, `jumpSpeed`, `yaw` — stay writable, and their refusals are the
 * held `CharacterController`'s.
 */
export class SweptCharacterController implements Component {
  /** Component key (plan D2) and §79 serialization name. */
  static readonly typeName = "swept-character-controller";

  /**
   * The node this component is attached to, or `null`. Written by the
   * `ComponentRegistry` alone (§6a); never assign it.
   */
  host: ComponentHost | null = null;

  /**
   * The collision world every sweep is cast against, or `undefined`.
   *
   * Writable so a controller restored from a §79 document can be bound to the
   * world the application builds — the same "reloading a scene is not restoring
   * a simulation" step `registerPhysicsSerializers` documents for bodies.
   * A controller with no world is skipped, once-warned, by the system.
   */
  world: PhysicsWorld | undefined;

  /** Radius of the swept capsule, in metres (§24). */
  readonly radius: number;

  /** Half the capsule's cylindrical length, in metres (§24). */
  readonly halfHeight: number;

  /** Largest rise climbed without jumping, in metres; `0` disables step-up. */
  readonly stepHeight: number;

  /** Steepest walkable ground, in radians from horizontal (§7a). */
  readonly slopeLimit: number;

  /** Gap kept between the capsule and every surface, in metres. */
  readonly skinWidth: number;

  /** How far a grounded character looks down for its ground, in metres. */
  readonly groundSnapDistance: number;

  /** Collide-and-slide iteration budget for one fixed step. */
  readonly maxSlides: number;

  /** §30 bit set this controller's casts belong to. */
  readonly collisionGroups: number;

  /** §30 bit set this controller's casts may hit. */
  readonly collisionMask: number;

  /**
   * Mass, in kilograms, used only for the PH-11c reduced-mass push.
   * The controller is kinematic and is not a solver body.
   */
  readonly pushMass: number;

  /** Dimensionless gain on the PH-11c push impulse. */
  readonly pushImpulseScale: number;

  /**
   * Whether a horizontal slide against a `"dynamic"` body imparts an impulse.
   * `false` preserves the pre-PH-11c no-push behaviour.
   */
  readonly pushDynamics: boolean;

  /**
   * Steps on which the controller declined to write because the pose it
   * computed was not finite — `CharacterController.skippedSteps`' contract, for
   * the same reason: §85's refusals govern *authoring*, and a value that goes
   * bad mid-step is a transient a fixed step must survive rather than throw in.
   */
  skippedSteps = 0;

  /** Collide-and-slide iterations that ended in an impact, over the run. */
  slideCount = 0;

  /** Step-up attempts that were **accepted**, over the run. */
  stepUpCount = 0;

  /**
   * Steps on which the slide budget ran out with motion still unspent — the
   * evidence that {@link SweptCharacterController.maxSlides} bit. Non-zero is
   * not an error; it is a character in a corner.
   */
  budgetExhaustedSteps = 0;

  /** The §12 half this class holds rather than inherits — see the module note. */
  readonly #motion: CharacterController;

  /** `cos(slopeLimit)`, the number every walkability test actually compares. */
  readonly #cosSlopeLimit: number;

  /** The capsule, built once (§24: axis `+Y`, same meaning in 2D and 3D). */
  readonly #shape: CollisionShape;

  /** Vertical velocity in m/s, positive up. */
  #verticalVelocity: number;

  /** Whether the last resolved step ended standing on walkable ground. */
  #grounded: boolean;

  /** The body the character is standing on, or `undefined`. */
  #groundBody: RigidBody | undefined;

  /** Whether the heading changed since the last successful write. */
  #headingDirty = true;

  /** Sweep origin scratch (§7b/D7: nothing is allocated per step). */
  readonly #origin = new Vector3();

  /** Sweep direction scratch. */
  readonly #direction = new Vector3();

  /** PH-11c impulse scratch — one Vector3 for the life of the controller. */
  readonly #pushImpulse = new Vector3();

  /** One-entry ignore list: the character's own body (§30 "ignored bodies"). */
  readonly #ignored: PhysicsBodyHandle[] = [];

  /** Un-swept displacement queued by {@link SweptCharacterController.translate}. */
  #pendingX = 0;

  /** @see SweptCharacterController.translate */
  #pendingY = 0;

  /** @see SweptCharacterController.translate */
  #pendingZ = 0;

  /** Accepted step-up result, read back by `step` — see `#tryStepUp`. */
  #stepUpX = 0;

  /** @see SweptCharacterController.stepUpCount */
  #stepUpY = 0;

  /** @see SweptCharacterController.stepUpCount */
  #stepUpZ = 0;

  /** Fraction of the remaining horizontal motion an accepted step-up consumed. */
  #stepUpConsumed = 0;

  /**
   * @throws RangeError if any parameter is outside §85's stated range, or if
   * `world` is a `"2d"` world (see the module note).
   */
  constructor(options: SweptCharacterControllerOptions) {
    const radius = options.radius;
    const halfHeight = options.halfHeight;
    const stepHeight = options.stepHeight ?? DEFAULT_STEP_HEIGHT;
    const slopeLimit = options.slopeLimit ?? DEFAULT_SLOPE_LIMIT;
    const skinWidth = options.skinWidth ?? DEFAULT_SKIN_WIDTH;
    const snap = options.groundSnapDistance ?? DEFAULT_GROUND_SNAP_DISTANCE;
    const maxSlides = options.maxSlides ?? DEFAULT_MAX_SLIDES;
    const pushMass = options.pushMass ?? DEFAULT_PUSH_MASS;
    const pushImpulseScale =
      options.pushImpulseScale ?? DEFAULT_PUSH_IMPULSE_SCALE;

    assertPositive(radius, "SweptCharacterControllerOptions.radius");
    assertPositive(halfHeight, "SweptCharacterControllerOptions.halfHeight");
    assertNonNegative(stepHeight, "SweptCharacterControllerOptions.stepHeight");
    assertPositive(skinWidth, "SweptCharacterControllerOptions.skinWidth");
    assertNonNegative(
      snap,
      "SweptCharacterControllerOptions.groundSnapDistance",
    );
    // A skin as thick as the capsule inverts every sweep: the advance
    // `distance − skinWidth` would be negative for every contact, so the
    // character would be pushed backwards out of motion it never made.
    if (skinWidth >= radius) {
      throw new RangeError(
        `SweptCharacterControllerOptions.skinWidth must be less than radius (§85); received ${String(skinWidth)} >= ${String(radius)}`,
      );
    }
    // `>= π/2` would make a vertical wall "walkable": the character would stand
    // on walls and never slide, which is not a tuning, it is a different
    // controller.
    if (!Number.isFinite(slopeLimit) || slopeLimit < 0) {
      throw new RangeError(
        `SweptCharacterControllerOptions.slopeLimit must be a finite number >= 0 radians (§85); received ${String(slopeLimit)}`,
      );
    }
    if (slopeLimit >= Math.PI / 2) {
      throw new RangeError(
        `SweptCharacterControllerOptions.slopeLimit must be less than π/2 radians (§85): at π/2 a vertical wall counts as walkable ground; received ${String(slopeLimit)}`,
      );
    }
    if (!Number.isInteger(maxSlides) || maxSlides < 1) {
      throw new RangeError(
        `SweptCharacterControllerOptions.maxSlides must be an integer >= 1 (§85); received ${String(maxSlides)}`,
      );
    }
    assertPositive(pushMass, "SweptCharacterControllerOptions.pushMass");
    assertNonNegative(
      pushImpulseScale,
      "SweptCharacterControllerOptions.pushImpulseScale",
    );
    if (options.world !== undefined && options.world.dimension !== "3d") {
      throw new RangeError(
        "SweptCharacterControllerOptions.world must be a \"3d\" PhysicsWorld (§21, §85): this controller's planar model is a heading about +Y, which a 2D character does not have. Drive a 2D character with @fourjs/motion's CharacterController.",
      );
    }

    // Every locomotion parameter goes through the §12 controller, so its §85
    // refusals run here rather than being restated (and re-diverged) above.
    this.#motion = new CharacterController({
      yaw: options.yaw,
      moveSpeed: options.moveSpeed,
      gravity: options.gravity,
      jumpSpeed: options.jumpSpeed,
      maxFallSpeed: options.maxFallSpeed,
    });

    this.world = options.world;
    this.radius = radius;
    this.halfHeight = halfHeight;
    this.stepHeight = stepHeight;
    this.slopeLimit = slopeLimit;
    this.skinWidth = skinWidth;
    this.groundSnapDistance = snap;
    this.maxSlides = maxSlides;
    this.collisionGroups = options.collisionGroups ?? ALL_COLLISION_GROUPS;
    this.collisionMask = options.collisionMask ?? ALL_COLLISION_GROUPS;
    this.pushMass = pushMass;
    this.pushImpulseScale = pushImpulseScale;
    this.pushDynamics = options.pushDynamics ?? true;
    this.#cosSlopeLimit = Math.cos(slopeLimit);
    this.#shape = { type: "capsule", halfHeight, radius };

    const verticalVelocity = options.verticalVelocity ?? 0;
    if (!Number.isFinite(verticalVelocity)) {
      throw new RangeError(
        `SweptCharacterControllerOptions.verticalVelocity must be a finite number (§85); received ${String(verticalVelocity)}`,
      );
    }
    this.#verticalVelocity = verticalVelocity;
    this.#grounded = options.grounded ?? false;
  }

  /** The character's heading in radians (§7a). @see CharacterController.yaw */
  get yaw(): number {
    return this.#motion.yaw;
  }

  set yaw(value: number) {
    this.#motion.yaw = value;
    this.#headingDirty = true;
  }

  /** Speed a full move intent produces, in m/s. */
  get moveSpeed(): number {
    return this.#motion.moveSpeed;
  }

  set moveSpeed(value: number) {
    this.#motion.moveSpeed = value;
  }

  /** Vertical acceleration in m/s² applied while airborne. */
  get gravity(): number {
    return this.#motion.gravity;
  }

  set gravity(value: number) {
    this.#motion.gravity = value;
  }

  /** Upward speed {@link SweptCharacterController.jump} imparts, in m/s. */
  get jumpSpeed(): number {
    return this.#motion.jumpSpeed;
  }

  set jumpSpeed(value: number) {
    this.#motion.jumpSpeed = value;
  }

  /** Terminal downward speed in m/s, or `Infinity` for none. Read-only. */
  get maxFallSpeed(): number {
    return this.#motion.maxFallSpeed;
  }

  /** Forward component of the current move intent, in `[−1, 1]`. */
  get intentForward(): number {
    return this.#motion.intentForward;
  }

  /** Rightward component of the current move intent, in `[−1, 1]`. */
  get intentRight(): number {
    return this.#motion.intentRight;
  }

  /** Vertical velocity in m/s, positive up; `0` while grounded. */
  get verticalVelocity(): number {
    return this.#verticalVelocity;
  }

  /**
   * Whether the last resolved step ended standing on ground within
   * {@link SweptCharacterController.slopeLimit}.
   *
   * A **geometric** claim, unlike `CharacterController.grounded`'s claim about a
   * plane: it means the downward probe found a collider whose contact normal is
   * no steeper than the limit. A character on a 60° face with a 45° limit is
   * *not* grounded — it slides — which is the whole point of the parameter.
   */
  get grounded(): boolean {
    return this.#grounded;
  }

  /**
   * The `RigidBody` the character is currently standing on, or `undefined`.
   *
   * Published because it is free — the ground probe's hit already carries it —
   * and because it is the named seam for **moving-platform carry**, which this
   * tier stages: difference the platform's transform between steps and hand the
   * delta to {@link SweptCharacterController.translate}.
   */
  get groundBody(): RigidBody | undefined {
    return this.#groundBody;
  }

  /**
   * Whether the next step would write anything — the gate
   * {@link SweptCharacterSystem} applies **before** the §42 authority check, so
   * a grounded, still, unturned character neither bumps `Transform.version`,
   * nor casts a single query, nor reports a conflict on a node it does not own.
   *
   * `CharacterController.active`'s rule and its recorded corollary: with
   * `gravity: 0` a character that has never touched ground stays ungrounded and
   * therefore stays active — it is falling at zero speed, and pretending
   * otherwise would let {@link SweptCharacterController.jump} succeed in mid-air.
   */
  get active(): boolean {
    return (
      !this.#grounded ||
      this.#headingDirty ||
      this.#motion.intentForward !== 0 ||
      this.#motion.intentRight !== 0
    );
  }

  /** Adds `delta` radians to the heading. @see CharacterController.turn */
  turn(delta: number): void {
    this.#motion.turn(delta);
    this.#headingDirty = true;
  }

  /**
   * Sets the planar move intent, clamped to the unit disc.
   *
   * @see CharacterController.setMoveIntent — this forwards to it, so the clamp,
   * its `Math.sqrt` and its §85 refusals are that class's, executed once.
   */
  setMoveIntent(forward: number, right: number): void {
    this.#motion.setMoveIntent(forward, right);
  }

  /** Clears the move intent. Vertical motion and heading are untouched. */
  stop(): void {
    this.#motion.stop();
  }

  /**
   * Launches the character upwards at {@link SweptCharacterController.jumpSpeed}.
   *
   * @returns whether the jump was taken — `false`, with nothing changed, for a
   * character that is airborne or whose `jumpSpeed` is `0`.
   */
  jump(): boolean {
    if (!this.#grounded || this.#motion.jumpSpeed === 0) {
      return false;
    }
    this.#verticalVelocity = this.#motion.jumpSpeed;
    this.#grounded = false;
    this.#groundBody = undefined;
    return true;
  }

  /**
   * Declares the character grounded and clears its vertical velocity — what a
   * teleport or a respawn needs so the character does not resume the fall it
   * was in when it was moved.
   *
   * Unlike the swept resolution this asserts rather than measures: the next
   * step's probe is what confirms or corrects it, within
   * {@link SweptCharacterController.groundSnapDistance}.
   */
  ground(): void {
    this.#verticalVelocity = 0;
    this.#grounded = true;
  }

  /**
   * Moves the character by `(x, y, z)` metres **without** sweeping, and marks
   * it as needing a write.
   *
   * The escape hatch for motion this controller does not model — the named seam
   * for moving-platform carry above being the motivating one. It is
   * deliberately *not* resolved against geometry: the caller is asserting that
   * the displacement is legitimate (the floor moved under the character), and
   * sweeping it would be resolving the platform's motion as if it were the
   * character's.
   *
   * @throws RangeError if any component is not finite (§85).
   */
  translate(x: number, y: number, z: number): void {
    if (!Number.isFinite(x + y + z)) {
      throw new RangeError(
        `SweptCharacterController.translate requires finite metres (§85); received (${String(x)}, ${String(y)}, ${String(z)})`,
      );
    }
    this.#pendingX += x;
    this.#pendingY += y;
    this.#pendingZ += z;
    this.#headingDirty = true;
  }

  /**
   * Advances the character by `deltaSeconds` and writes the resolved pose onto
   * `node`'s transform.
   *
   * Called by {@link SweptCharacterSystem} once per fixed step, **after** the
   * §42 authority check. It takes the `Node` rather than the `Transform`
   * `CharacterController.step` takes, and needs to: a swept controller must
   * exclude its own body from every cast (§30 "ignored bodies"), and only the
   * node identifies it to {@link PhysicsWorld.getBodyHandle}.
   *
   * Both writes commit or neither does: the whole pose is computed into locals
   * and checked for finiteness before `position.set`, so a `NaN` arriving from
   * anywhere leaves the transform *and* the vertical state untouched and counts
   * one {@link SweptCharacterController.skippedSteps}.
   *
   * @returns whether the pose was written.
   */
  step(node: Node, deltaSeconds: number): boolean {
    const world = this.world;
    if (world === undefined) {
      return false;
    }

    const ignored = this.#ignored;
    ignored.length = 0;
    const handle = world.getBodyHandle(node);
    if (handle !== undefined) {
      ignored.push(handle);
    }

    const position = node.transform.position;
    let px = position.x;
    let py = position.y;
    let pz = position.z;

    // --- planar intent, in the heading's frame -------------------------------
    // Identical basis to `CharacterController.step`: yaw about +Y maps +Z to
    // (sin, 0, cos) and +X to (cos, 0, −sin), so forward is (−sin, 0, −cos).
    const yaw = this.#motion.yaw;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const speed = this.#motion.moveSpeed;
    const forward = this.#motion.intentForward * speed;
    const right = this.#motion.intentRight * speed;
    let rx = (right * cos - forward * sin) * deltaSeconds + this.#pendingX;
    let rz = (-right * sin - forward * cos) * deltaSeconds + this.#pendingZ;
    const pendingY = this.#pendingY;
    this.#pendingX = 0;
    this.#pendingY = 0;
    this.#pendingZ = 0;
    py += pendingY;

    const wasGrounded = this.#grounded;
    let verticalVelocity = this.#verticalVelocity;
    let grounded = wasGrounded;
    let groundBody = this.#groundBody;

    // --- 1. horizontal collide-and-slide -------------------------------------
    let steppedUp = false;
    let slides = 0;
    for (; slides < this.maxSlides; slides += 1) {
      const length = Math.sqrt(rx * rx + rz * rz);
      if (length <= MINIMUM_MOTION) {
        rx = 0;
        rz = 0;
        break;
      }
      const hit = this.#sweep(world, px, py, pz, rx, 0, rz, length, ignored);
      if (hit === undefined) {
        px += rx;
        pz += rz;
        rx = 0;
        rz = 0;
        break;
      }
      this.slideCount += 1;
      this.#pushDynamic(hit, rx / deltaSeconds, rz / deltaSeconds);
      const advance = hit.distance - this.skinWidth;
      if (advance > 0) {
        const consumed = advance / length;
        px += rx * consumed;
        pz += rz * consumed;
        rx -= rx * consumed;
        rz -= rz * consumed;
      }
      const walkable = hit.normal.y >= this.#cosSlopeLimit;
      if (!steppedUp && !walkable && wasGrounded && this.stepHeight > 0) {
        steppedUp = true;
        if (this.#tryStepUp(world, px, py, pz, rx, rz, ignored)) {
          this.stepUpCount += 1;
          px = this.#stepUpX;
          py = this.#stepUpY;
          pz = this.#stepUpZ;
          // Clamped at zero: an accepted step-up may deliberately reach
          // further than this step's motion (see `#tryStepUp`), and a negative
          // remainder would walk the character backwards.
          const left = Math.max(0, 1 - this.#stepUpConsumed);
          rx *= left;
          rz *= left;
          continue;
        }
      }
      // Slide: remove the part of the remainder that points into the surface.
      // Only the horizontal footprint of the normal matters — a hit whose
      // normal is purely vertical (a floor or a ceiling met head-on) offers no
      // direction to slide along, and the motion is spent.
      const nx = hit.normal.x;
      const nz = hit.normal.z;
      const nLengthSquared = nx * nx + nz * nz;
      if (nLengthSquared <= MINIMUM_MOTION) {
        rx = 0;
        rz = 0;
        break;
      }
      const into = (rx * nx + rz * nz) / nLengthSquared;
      if (into < 0) {
        rx -= into * nx;
        rz -= into * nz;
      }
    }
    if (rx !== 0 || rz !== 0) {
      // The budget ran out with motion unspent. Dropping it stops the
      // character; spending it would move the capsule into geometry.
      this.budgetExhaustedSteps += 1;
    }

    // --- 2. vertical ---------------------------------------------------------
    if (wasGrounded) {
      // A grounded character does not integrate gravity; it probes for the
      // ground it believes it is on, which is what both keeps it on a ramp it
      // just walked down and takes it off a ledge it just walked over.
      verticalVelocity = 0;
      const probe = this.groundSnapDistance + this.skinWidth;
      const hit = this.#sweep(world, px, py, pz, 0, -probe, 0, probe, ignored);
      if (hit !== undefined && hit.normal.y >= this.#cosSlopeLimit) {
        const drop = hit.distance - this.skinWidth;
        if (drop > 0) {
          py -= drop;
        }
        grounded = true;
        groundBody = hit.body;
      } else {
        grounded = false;
        groundBody = undefined;
      }
    } else {
      verticalVelocity += this.#motion.gravity * deltaSeconds;
      const terminal = this.#motion.maxFallSpeed;
      if (verticalVelocity < -terminal) {
        verticalVelocity = -terminal;
      }
      const dy = verticalVelocity * deltaSeconds;
      const length = Math.abs(dy);
      if (length > MINIMUM_MOTION) {
        const hit = this.#sweep(world, px, py, pz, 0, dy, 0, length, ignored);
        if (hit === undefined) {
          py += dy;
        } else {
          const advance = hit.distance - this.skinWidth;
          if (advance > 0) {
            py += dy < 0 ? -advance : advance;
          }
          // Stopped by geometry, going either way: a ceiling ends a jump as
          // surely as a floor ends a fall.
          verticalVelocity = 0;
          if (dy < 0 && hit.normal.y >= this.#cosSlopeLimit) {
            grounded = true;
            groundBody = hit.body;
          }
        }
      }
    }

    // --- 3. one write, or none ----------------------------------------------
    if (!Number.isFinite(px + py + pz + verticalVelocity)) {
      this.skippedSteps += 1;
      return false;
    }
    this.#verticalVelocity = verticalVelocity;
    this.#grounded = grounded;
    this.#groundBody = groundBody;
    position.set(px, py, pz);
    const half = yaw * 0.5;
    node.transform.rotation.set(0, Math.sin(half), 0, Math.cos(half));
    this.#headingDirty = false;
    return true;
  }

  /**
   * The nearest impact of the capsule swept from `(px, py, pz)` along
   * `(dx, dy, dz)` (whose length is `length`), or `undefined` (§30).
   *
   * `mode: "first"` is what §30 calls the nearest hit for a sweep, and it is
   * also all Rapier's `castShape` can produce — both adapters state that
   * multiplicity limit rather than hiding it. The scan below therefore costs
   * nothing in practice and keeps this method correct against an adapter that
   * one day returns more.
   *
   * The sweep is extended by `skinWidth` beyond the motion so that a surface
   * the character would end up resting *against* is found this step rather than
   * next.
   */
  #sweep(
    world: PhysicsWorld,
    px: number,
    py: number,
    pz: number,
    dx: number,
    dy: number,
    dz: number,
    length: number,
    ignored: readonly PhysicsBodyHandle[],
  ): WorldShapeCastHit | undefined {
    const hits = world.shapeCast({
      shape: this.#shape,
      position: this.#origin.set(px, py, pz),
      direction: this.#direction.set(dx / length, dy / length, dz / length),
      maxDistance: length + this.skinWidth,
      mode: "first",
      collisionGroups: this.collisionGroups,
      collisionMask: this.collisionMask,
      ignoredBodies: ignored,
    });
    let nearest: WorldShapeCastHit | undefined;
    for (let i = 0; i < hits.length; i += 1) {
      if (nearest === undefined || hits[i].distance < nearest.distance) {
        nearest = hits[i];
      }
    }
    return nearest;
  }

  /**
   * PH-11c: when a horizontal slide hits a `"dynamic"` body, impart
   * `J = μ · closingSpeed · (−n) · pushImpulseScale` at the witness point.
   *
   * μ is the reduced mass of {@link SweptCharacterController.pushMass} and
   * the hit body. Static / kinematic / massless / infinite-mass hits are
   * skipped. Sleepers are woken first — `applyImpulseAtPoint` does not wake.
   */
  #pushDynamic(
    hit: WorldShapeCastHit,
    velocityX: number,
    velocityZ: number,
  ): void {
    if (!this.pushDynamics) {
      return;
    }
    const body = hit.body;
    if (body.type !== "dynamic") {
      return;
    }
    const mass = body.mass;
    if (mass === undefined || !Number.isFinite(mass) || mass <= 0) {
      return;
    }
    const closing = Math.max(
      0,
      -(velocityX * hit.normal.x + velocityZ * hit.normal.z),
    );
    if (closing === 0 || this.pushImpulseScale === 0) {
      return;
    }
    const mu = (this.pushMass * mass) / (this.pushMass + mass);
    const scale = mu * closing * this.pushImpulseScale;
    this.#pushImpulse.set(
      -hit.normal.x * scale,
      -hit.normal.y * scale,
      -hit.normal.z * scale,
    );
    body.wake();
    body.applyImpulseAtPoint(this.#pushImpulse, hit.point);
  }

  /**
   * One step-up attempt: up, forward, down — accepted only if it lands on
   * walkable ground no lower than it started (§12 "step height").
   *
   * Writes its result into `#stepUpX/Y/Z` and `#stepUpConsumed` and returns
   * whether it was accepted; on refusal nothing is written and the caller falls
   * through to an ordinary slide. Three casts, tried at most once per fixed
   * step, so a character grinding along a wall costs a bounded amount.
   *
   * Refusing to step onto *nothing* is deliberate: a down-cast that finds no
   * ground means the far side is a drop, and a character that stepped over a
   * kerb into a chasm would be teleporting rather than walking.
   */
  #tryStepUp(
    world: PhysicsWorld,
    px: number,
    py: number,
    pz: number,
    rx: number,
    rz: number,
    ignored: readonly PhysicsBodyHandle[],
  ): boolean {
    const forwardLength = Math.sqrt(rx * rx + rz * rz);
    if (forwardLength <= MINIMUM_MOTION) {
      return false;
    }
    // 1. up
    let rise = this.stepHeight;
    const ceiling = this.#sweep(world, px, py, pz, 0, rise, 0, rise, ignored);
    if (ceiling !== undefined) {
      rise = ceiling.distance - this.skinWidth;
    }
    if (rise <= this.skinWidth) {
      return false;
    }
    // 2. forward, from up there — by at least one capsule radius, whatever the
    // step's own motion was. A step is taken only if the character can put its
    // feet *on* the tread: stopping with half a capsule over the lip is the
    // configuration that produces corner contact normals, and a corner normal
    // is not the surface's — the flat tread underneath would then read as
    // unwalkable and the character would jitter on the edge for ever. The
    // honest cost is a deliberate over-step of at most one radius, at most once
    // per fixed step.
    const lifted = py + rise;
    const reach = Math.max(forwardLength, this.radius + this.skinWidth);
    let advance = reach;
    const wall = this.#sweep(world, px, lifted, pz, rx, 0, rz, reach, ignored);
    if (wall !== undefined) {
      advance = wall.distance - this.skinWidth;
    }
    if (advance < this.radius) {
      // Not enough tread to stand on.
      return false;
    }
    const consumed = advance / forwardLength;
    const ax = px + rx * consumed;
    const az = pz + rz * consumed;
    // 3. back down onto the step
    const drop = rise + this.skinWidth;
    const ground = this.#sweep(
      world,
      ax,
      lifted,
      az,
      0,
      -drop,
      0,
      drop,
      ignored,
    );
    if (ground === undefined || ground.normal.y < this.#cosSlopeLimit) {
      return false;
    }
    const fallen = ground.distance - this.skinWidth;
    const landing = fallen > 0 ? lifted - fallen : lifted;
    if (landing < py - this.skinWidth) {
      // Not a step up — a step down, which the ordinary ground probe handles
      // with the snap distance the author chose.
      return false;
    }
    this.#stepUpX = ax;
    this.#stepUpY = landing;
    this.#stepUpZ = az;
    this.#stepUpConsumed = consumed;
    return true;
  }
}

/** Options for {@link SweptCharacterSystem}. */
export interface SweptCharacterSystemOptions {
  /**
   * §39 execution order. Defaults to `PRIORITY_KINEMATICS` (400) — step 4, with
   * the kinematics and before the solve at 600. See the module note for why
   * that, and not a slot after the solve.
   */
  priority?: number;
}

/**
 * Advances every tracked node's {@link SweptCharacterController} once per fixed
 * step, under §42's `"kinematic"` authority (§39 step 4).
 *
 * `KinematicSystem`'s shape exactly — insertion-ordered tracking (§33), an idle
 * component skipped *before* the authority check so a still character reports
 * no conflict, and a refused write that leaves the node alone. What it adds is
 * two once-per-node refusals of its own, both of which write nothing:
 *
 * - a node carrying **both** a `CharacterController` and a
 *   `SweptCharacterController` — two locomotion writers of one transform, which
 *   is the only way the two §39-step-4 systems can reach the same node;
 * - a controller whose world's adapter declares
 *   `capabilities.queries.shapeCast: false` (§30, §37) — presence is the
 *   capability, and a solver that cannot sweep cannot drive this controller.
 *   Reported rather than thrown, because a fixed step is not a place to throw
 *   (§61/§85) and because the answer would be the same sixty times a second.
 */
export class SweptCharacterSystem implements SimulationSystem {
  /** Execution order key (§39); default `PRIORITY_KINEMATICS`. */
  priority: number;

  /** Tracked nodes in insertion order (§33: deterministic iteration). */
  readonly #tracked = new Set<Node>();

  /** Node ids already warned about, so a per-step mistake is reported once. */
  #warned: Set<string> | undefined;

  /** Set by {@link SweptCharacterSystem.dispose}; disposal is terminal (§83). */
  #disposed = false;

  /**
   * Whether {@link SweptCharacterSystem.dispose} has run. Disposal is terminal
   * (§83): a disposed system refuses its mutating entry points with
   * `INVALID_APPLICATION_STATE` (§89) rather than silently working.
   */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** §83's "disposed resource still in use", made loud (§89). */
  #requireLive(): void {
    if (this.#disposed) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        "SweptCharacterSystem is disposed; advancing nodes through a disposed system is a " +
          "lifetime mistake (§83), and a new system is a new " +
          "SweptCharacterSystem.",
        { context: { system: "SweptCharacterSystem" } },
      );
    }
  }

  constructor(options: SweptCharacterSystemOptions = {}) {
    this.priority = options.priority ?? PRIORITY_KINEMATICS;
  }

  /** Number of tracked nodes. */
  get size(): number {
    return this.#tracked.size;
  }

  /** Tracked nodes, in the order they will be advanced. */
  get nodes(): IterableIterator<Node> {
    return this.#tracked.values();
  }

  /**
   * Starts advancing `node`. Idempotent — tracking a node twice keeps its
   * original position in the iteration order. Returns `node`.
   *
   * The node need not carry a controller yet; it is looked up every step.
   */
  track(node: Node): Node {
    this.#requireLive();
    this.#tracked.add(node);
    return node;
  }

  /** Stops advancing `node`. Returns whether it was tracked. */
  untrack(node: Node): boolean {
    return this.#tracked.delete(node);
  }

  /** Whether `node` is tracked. */
  has(node: Node): boolean {
    return this.#tracked.has(node);
  }

  /** Stops advancing every node. The system stays registered. */
  clear(): void {
    this.#tracked.clear();
  }

  /** No per-registration setup is needed (§39). */
  initialize(): void {
    // Intentionally empty: the system owns no resources until nodes are tracked.
  }

  /** Advances every tracked, enabled, active controller by `fixedDeltaTime`. */
  fixedUpdate(context: FixedUpdateContext): void {
    this.#requireLive();
    const dt = context.time.fixedDeltaTime;
    for (const node of this.#tracked) {
      if (!node.enabled) {
        continue;
      }
      const controller = node.getComponent(SweptCharacterController);
      if (controller === undefined || !controller.active) {
        // Idle or absent: no write, so no §42 conflict to report.
        continue;
      }
      if (node.getComponent(CharacterController) !== undefined) {
        this.#warn(
          node,
          `node ${node.id} carries both a CharacterController and a SweptCharacterController. Both prescribe this node's transform under §42's "kinematic" authority, so the two would be a second writer nothing could catch; the swept controller was not advanced. Remove one.`,
        );
        continue;
      }
      const world = controller.world;
      if (world === undefined) {
        this.#warn(
          node,
          `the SweptCharacterController on node ${node.id} has no PhysicsWorld, so it has nothing to sweep against (§30) and was not advanced. Assign controller.world — a controller restored from a §79 document is re-bound by the application, exactly as a reloaded RigidBody is registered.`,
        );
        continue;
      }
      if (!world.adapter.capabilities.queries.shapeCast) {
        this.#warn(
          node,
          `the SweptCharacterController on node ${node.id} is bound to a world whose adapter ${JSON.stringify(world.adapter.name)} declares capabilities.queries.shapeCast: false (§30, §37), so it was not advanced.`,
        );
        continue;
      }
      // §42: this system writes as `kinematic`; anything else owns the
      // transform, so the write is refused and the character is left frozen.
      if (node.transformAuthority !== KINEMATIC_AUTHORITY) {
        warnAuthorityConflict(node, KINEMATIC_AUTHORITY);
        continue;
      }
      controller.step(node, dt);
    }
  }

  /** Reports one authoring mistake per node, once (simulation-tier policy). */
  #warn(node: Node, message: string): void {
    const warned = (this.#warned ??= new Set<string>());
    if (warned.has(node.id)) {
      return;
    }
    warned.add(node.id);
    console.warn(
      `${DEV_WARNING_PREFIX} SweptCharacterSystem: ${message} Further occurrences on this node are suppressed.`,
    );
  }

  /** Drops every tracked node (§39 teardown). */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#tracked.clear();
    this.#warned = undefined;
  }
}
