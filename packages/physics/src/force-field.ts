/**
 * §27 force fields for rigid bodies, through §26's force API (PH-8,
 * 2026-08-09) — the engine occupant of §39's step 5, "force generation".
 *
 * ```ts
 * import { ForceFieldSystem } from "@fourjs/physics";
 * import { dragField, radialField } from "@fourjs/particles";
 *
 * const forces = new ForceFieldSystem({ worlds: [world] });
 * forces.addField(radialField(sunPosition, -6.7e2), "acceleration");
 * forces.addField(dragField(0.4), "acceleration");
 * app.systems.register(forces);          // priority 500, before the solve at 600
 * app.systems.register(new PhysicsSystem({ worlds: [world] }));
 * ```
 *
 * §26 declares six force and impulse methods and then lists the *generators*
 * that should drive them — "gravity; drag; springs; buoyancy; wind; magnetic
 * approximations; attractors; repulsors; custom fields". §27 gives those
 * generators one shape:
 *
 * ```ts
 * interface ForceField {
 *   sample(position: Vector3, velocity: Vector3, time: number, out?: Vector3): Vector3;
 * }
 * ```
 *
 * Both halves already existed on their own: `RigidBody` has had the six §26
 * methods since Phase 5, and `@fourjs/particles` has had §27's built-in field set
 * since WP-9.2. Nothing joined them — a field could push a *particle* and not a
 * *body*. {@link ForceFieldSystem} is the join, and it is the whole of this
 * module: sample every registered field at every dynamic body once per fixed
 * step, sum, and hand the total to `RigidBody.applyForce`.
 *
 * ## Why a system and not a step inside `PhysicsWorld`
 *
 * Because §39 already says where this goes. Step 5 is "force generation" and
 * step 6 is "physics solve"; `@fourjs/motion` publishes them as
 * `PRIORITY_FORCES` (500) and `PRIORITY_PHYSICS_SOLVE` (600), and
 * `PhysicsSystem` occupies the second. So force generation is a **separate
 * system at the priority §39 gave it**, and three properties follow for free:
 *
 * 1. **`world.step` is not edited.** Fields reach the solver through the same
 *    §26 command buffer user code uses, which the world drains at the top of
 *    its next step. Every existing determinism golden is untouched *by
 *    construction* rather than by measurement, and an application that does not
 *    register this system issues exactly the solver-call sequence it issued
 *    before this module existed.
 * 2. **Time is injected, never read from a clock (§33).** §27's `time` argument
 *    is `context.time.simulationTime` — §9's simulation domain, the same clock
 *    the particle path samples fields on.
 * 3. **Ordering is explicit and configurable**, which is what §39 asks for: a
 *    second field system at `PRIORITY_FORCES + 10` runs after this one, and a
 *    force generator that must observe another's result can be ordered against
 *    it without either knowing the other exists.
 *
 * ## The cross-package contract: structural, with no new dependency edge
 *
 * {@link ForceField} is §27's interface transcribed member-for-member — the
 * same transcription `@fourjs/particles`' `ParticleForceField` carries, whose own
 * module note anticipated this packet: *"if a later packet lands a general
 * `ForceField` in another package, the two can be reconciled without a rename
 * churn here. They are structurally identical, so any §27 field satisfies this
 * type without an adapter."* That is the reconciliation, and it is structural:
 * the frozen §3.1 dependency matrix has no `physics → particles` edge and this
 * module adds none. Every built-in field in `@fourjs/particles` —
 * `uniformGravityField`, `radialField`, `vortexField`, `windField`,
 * `dragField`, `turbulenceField`, and `volumeField`'s inclusion wrapper — is
 * assignable to {@link ForceField} with no adapter, no cast, and no import in
 * either direction. `tests/integration/physics-force-fields.test.ts` is where
 * the two declarations are type-checked against each other, because it is the
 * only place both packages are importable.
 *
 * §27's "volume-based inclusion and filtering" needs nothing here for the same
 * reason: inclusion is a property of a *field*, and `volumeField(inner, volume)`
 * already composes it onto any conforming field.
 *
 * ## Units: `"force"` or `"acceleration"`, stated at registration (§41)
 *
 * {@link ForceFieldSystem.addField} takes the units as a **required** argument.
 * §27's own built-in list mixes the two — "uniform gravity" and "radial
 * gravity" are accelerations (m/s²), "wind" and "drag volume" are forces (N) —
 * and the two differ by a factor of the body's mass, which is 1 for a particle
 * and anything at all for a body. `@fourjs/particles` documents its fields as
 * accelerations because MVP particles carry no mass channel; handing one of
 * them to a system that assumed newtons would be a silent unit error on exactly
 * the reuse path this module advertises. A required argument makes that error
 * unwritable rather than merely documented, which is §41's SI envelope applied
 * to a seam instead of to a number.
 *
 * Everything here is SI (§41, §7a): newtons, kilograms, m/s², seconds, radians,
 * right-handed Y-up in 2D and 3D alike. §40's unit system is display-only and
 * is not consulted.
 *
 * ## What this module deliberately does not do
 *
 * - **Torque is optional.** §27's `sample` stays one linear vector so a
 *   particle field remains assignable. {@link ForceField.sampleTorque} is
 *   the angular channel, always in N·m, omitted by every built-in that has
 *   no reason to twist a body.
 * - **No transform writes, and no §42 authority check.** A force is not a
 *   transform write: the solver stays the single writer under `"physics"`
 *   authority and §26 is the sanctioned channel for influencing it (`RigidBody`
 *   says so in as many words). Warning here would fire on the one legitimate
 *   way to push a physics-owned body.
 * - **Sleeping bodies stay asleep unless an entry opts in.** See
 *   {@link ForceFieldAddOptions.wakesSleepingBodies}.
 * - **No `"local-plane"` sampling (§8).** A body's sample point is its
 *   world-space centre of mass, because that is the frame every registered body
 *   is in — `PhysicsWorld.addBody` refuses any other (PH-12).
 */

import { DEV_WARNING_PREFIX } from "@fourjs/core";
import { Vector3 } from "@fourjs/math";
import {
  PRIORITY_FORCES,
  type FixedUpdateContext,
  type SimulationSystem,
} from "@fourjs/motion";

import type { RigidBody } from "./rigid-body.js";
import type { PhysicsWorld } from "./world.js";

/**
 * §27's `ForceField`, transcribed member-for-member.
 *
 * ```ts
 * const wind: ForceField = {
 *   sample(_position, _velocity, time, out) {
 *     const target = out ?? new Vector3();
 *     return target.set(Math.sin(time) * 40, 0, 0);
 *   },
 * };
 * ```
 *
 * Structurally identical to `@fourjs/particles`' `ParticleForceField`, so a field
 * written for either pillar works in both (module header). Contract for an
 * implementation, restated from §27 and the particle transcription so that a
 * reader of this package alone has all of it:
 *
 * - **Do not mutate `position` or `velocity`.** They are the caller's scratch
 *   copies of the body's live state.
 * - **Write into `out` when it is supplied and return it** — the system always
 *   supplies one, and doing so is what keeps the step allocation-free (§7b).
 *   Returning a *different* vector is legal (the caller reads the return value,
 *   never `out`), but that vector must stay valid until the next call.
 * - **`out` is not zeroed** by the caller. Write every component.
 * - **Be a pure function of its arguments** (§33). No clock — the absolute
 *   simulation time arrives as `time`, in seconds. No `Math.random` — take a
 *   `SeededRandom` at construction if the field is procedural.
 *
 * A field that returns a non-finite component poisons the body it is sampled
 * at; nothing here checks, for the same reason nothing checks in the particle
 * path — the check would run per body per field per step, and §85's place for
 * it is the field's own constructor.
 *
 * {@link ForceField.sampleAll} is the optional §27 batch fast path (R-34's
 * particle spelling, reused here so a field written for either pillar keeps
 * one identity). {@link ForceFieldSystem} calls it when a field offers it;
 * {@link ForceField.sample} stays the required §27 entry point.
 */
export interface ForceField {
  /**
   * The contribution at `position`, for a body moving at `velocity`, at
   * absolute simulation time `time` (seconds). Whether the vector is read as
   * newtons or as m/s² is declared by the caller — see {@link ForceFieldUnits}.
   */
  sample(
    position: Vector3,
    velocity: Vector3,
    time: number,
    out?: Vector3,
  ): Vector3;

  /**
   * **Optional fast path**: the same contribution as {@link ForceField.sample},
   * for `count` bodies at once, **added into** `out` (stride-3 `xyz`).
   *
   * This is `@fourjs/particles`' `ParticleForceField.sampleAll` transcribed
   * member-for-member so every built-in particle field is a batched
   * {@link ForceField} with no adapter. Contract, restated from that
   * transcription:
   *
   * - **Add, do not assign.** The caller owns `out` and may hand over a
   *   zeroed buffer or a running sum; overwriting it deletes whatever was
   *   already there.
   * - **`out` is binary64.** The scalar path accumulates in JavaScript
   *   numbers; a binary32 accumulator would make a batched step differ from
   *   a scalar one in the last bits, and §33 does not permit that.
   * - **Be bit-identical to `sample`.** Same arithmetic, same order, same
   *   special cases. Positions and velocities are `xyz` at stride 3, valid
   *   for `[0, 3 · count)`. **Read, never write.**
   * - Same purity rules as `sample`: no clock, no `Math.random`.
   *
   * A field that omits this is not penalised: the system falls back to
   * {@link ForceField.sample} for that field alone, in the same registration
   * order, with the same result.
   */
  sampleAll?(
    positions: ArrayLike<number>,
    velocities: ArrayLike<number>,
    count: number,
    time: number,
    out: Float64Array,
  ): void;

  /**
   * **Optional angular channel** (PH-8 remainder, 2026-09-06). Torque in
   * newton-metres at the same sample point {@link ForceField.sample} uses.
   *
   * §27's `sample` stays one linear vector so a `ParticleForceField` remains
   * assignable without an adapter. Torque is a second, optional method:
   *
   * - **Always N·m.** {@link ForceFieldUnits} scale the linear sample only.
   *   An `"acceleration"` reading would need the inertia tensor, which a
   *   field does not have and which is not a scalar.
   * - Same purity and `out` rules as {@link ForceField.sample}. Do not
   *   mutate `position`, `velocity`, or `angularVelocity`.
   * - A field that omits this contributes no torque.
   */
  sampleTorque?(
    position: Vector3,
    velocity: Vector3,
    angularVelocity: Vector3,
    time: number,
    out?: Vector3,
  ): Vector3;
}

/**
 * How a {@link ForceField}'s sampled vector is read (§26, §41).
 *
 * - `"force"` — newtons, applied as-is. What §27's wind, drag, spring and
 *   magnetic entries are naturally authored in.
 * - `"acceleration"` — m/s², multiplied by the body's mass before it is
 *   applied, so every body accelerates equally. What §27's uniform and radial
 *   *gravity* entries are naturally authored in, and what every built-in field
 *   in `@fourjs/particles` documents itself as.
 *
 * There is no default: see the module header for why the choice is a required
 * argument rather than a documented convention.
 */
export type ForceFieldUnits = "force" | "acceleration";

/** Options for one {@link ForceFieldSystem.addField} call. */
export interface ForceFieldAddOptions {
  /**
   * When `true`, this entry also samples **sleeping** dynamic bodies and
   * calls {@link RigidBody.wake} when its linear or torque contribution is
   * non-zero. Default `false`.
   *
   * Policy when two entries disagree (2026-09-06): **per-entry OR**. A
   * field without the flag never sees a sleeper, even if a sibling has it.
   * Persistent gravity therefore cannot defeat §32 just because an
   * explosion field is also registered. A waking field that samples zero
   * still leaves the body asleep — zero is not an alarm clock.
   */
  wakesSleepingBodies?: boolean;
}

/** One registered field and the units its samples are read in. */
export interface ForceFieldEntry {
  /** The field itself. */
  readonly field: ForceField;
  /** How {@link ForceFieldEntry.field}'s samples are read. */
  readonly units: ForceFieldUnits;
  /**
   * Whether this entry visits sleeping dynamics. Stored as a boolean so
   * a reader never has to distinguish "absent" from `false`.
   */
  readonly wakesSleepingBodies: boolean;
}

/** Options for {@link ForceFieldSystem}. */
export interface ForceFieldSystemOptions {
  /**
   * Execution order key (§39). Defaults to `PRIORITY_FORCES` (500) — step 5,
   * "force generation", which runs before `PhysicsSystem`'s solve at 600. Read
   * once, at registration, like every other system's priority.
   */
  priority?: number;

  /**
   * Worlds to track immediately, in order. Equivalent to calling
   * {@link ForceFieldSystem.track} for each, which is what the constructor
   * does.
   */
  worlds?: Iterable<PhysicsWorld>;

  /**
   * Fields to register immediately, in order. Equivalent to calling
   * {@link ForceFieldSystem.addField} for each. `wakesSleepingBodies`
   * defaults to `false` when omitted, matching {@link ForceFieldAddOptions}.
   */
  fields?: Iterable<{
    field: ForceField;
    units: ForceFieldUnits;
    wakesSleepingBodies?: boolean;
  }>;
}

/**
 * Applies §27 force fields to every dynamic rigid body of every tracked world,
 * once per fixed step (§39 step 5, §26, §27).
 *
 * See the module header for the design: why this is a system rather than a step
 * inside `PhysicsWorld`, why the cross-package field contract is structural,
 * and why the units are a required argument.
 */
export class ForceFieldSystem implements SimulationSystem {
  /** Execution order key (§39); default `PRIORITY_FORCES`. */
  priority: number;

  /** Tracked worlds in insertion order (§33: deterministic iteration). */
  readonly #worlds: PhysicsWorld[] = [];

  /** Registered fields in registration order — part of the §33 contract. */
  readonly #fields: ForceFieldEntry[] = [];

  /** The body's velocity, copied so a field cannot corrupt the component's mirror. */
  readonly #velocity = new Vector3();

  /**
   * The body's sample point, copied out of the SoA gather so a scalar-fallback
   * field in the batch path cannot alias the packed arrays.
   */
  readonly #position = new Vector3();

  /** Scratch handed to `ForceField.sample` as its `out`. */
  readonly #sample = new Vector3();

  /** The body's angular velocity, copied for {@link ForceField.sampleTorque}. */
  readonly #angularVelocity = new Vector3();

  /** Scratch handed to `ForceField.sampleTorque` as its `out`. */
  readonly #torqueSample = new Vector3();

  /** Running sum of one body's torque contributions, in newton-metres. */
  readonly #torque = new Vector3();

  /** Running sum of one body's field contributions, in newtons. */
  readonly #total = new Vector3();

  /**
   * SoA scratch for the batched field path, grown to the next power of two
   * that covers `world.size` and then reused. Empty until a registered field
   * offers {@link ForceField.sampleAll} — a system that only ever sees
   * scalar fields never pays for them.
   */
  #capacity = 0;
  #positions = new Float64Array(0);
  #velocities = new Float64Array(0);
  /** Per-field raw samples, binary64, before the units scale. */
  #fieldScratch = new Float64Array(0);
  /** Running newton sum for every gathered body. */
  #newtonAcc = new Float64Array(0);
  #massFactors = new Float64Array(0);
  readonly #bodies: RigidBody[] = [];

  /**
   * Node ids already reported by {@link ForceFieldSystem.fixedUpdate}'s
   * massless-body warning, so each body is reported once. Allocated on the
   * first warning, so a system that never warns carries nothing — the
   * once-per-subject idiom `RigidBody` uses, and `console.warn` rather than
   * `devWarn` because §33 forbids a simulation package from branching on §85's
   * build flag at all (`tests/integration/dev-build-mode.test.ts`).
   */
  #masslessWarned?: Set<string>;

  constructor(options: ForceFieldSystemOptions = {}) {
    this.priority = options.priority ?? PRIORITY_FORCES;
    if (options.worlds !== undefined) {
      for (const world of options.worlds) {
        this.track(world);
      }
    }
    if (options.fields !== undefined) {
      for (const entry of options.fields) {
        this.addField(entry.field, entry.units, {
          wakesSleepingBodies: entry.wakesSleepingBodies,
        });
      }
    }
  }

  /** The tracked worlds, in the order their bodies are visited. */
  get worlds(): readonly PhysicsWorld[] {
    return this.#worlds;
  }

  /**
   * The registered fields, in registration order — which is the order they are
   * summed in, and therefore part of the determinism contract (§33: floating
   * point addition is not associative).
   */
  get fields(): readonly ForceFieldEntry[] {
    return this.#fields;
  }

  /**
   * Adds `world` to the end of the visit order, or leaves the order alone if it
   * is already tracked. Returns the world, so a tracking call can be inlined.
   */
  track(world: PhysicsWorld): PhysicsWorld {
    if (!this.#worlds.includes(world)) {
      this.#worlds.push(world);
    }
    return world;
  }

  /** Whether `world` is tracked. */
  tracks(world: PhysicsWorld): boolean {
    return this.#worlds.includes(world);
  }

  /**
   * Stops visiting `world`'s bodies. Returns whether it was tracked, so a
   * teardown path may call it unconditionally. The world itself is untouched:
   * forces already queued on its bodies are still drained by its next step,
   * because they are §26 commands like any other.
   */
  untrack(world: PhysicsWorld): boolean {
    const index = this.#worlds.indexOf(world);
    if (index < 0) {
      return false;
    }
    this.#worlds.splice(index, 1);
    return true;
  }

  /**
   * Registers `field`, sampled in `units`, at the end of the summation order.
   *
   * The same field object may be registered twice — with different units, or
   * with the same ones — and is then sampled twice per body per step. Nothing
   * deduplicates: a field is a pure function (§33), two registrations of one
   * function are two terms of the sum, and silently collapsing them would make
   * `2 × drag` unspellable.
   *
   * @returns `field`, so a construction call can be inlined
   */
  addField(
    field: ForceField,
    units: ForceFieldUnits,
    options?: ForceFieldAddOptions,
  ): ForceField {
    this.#fields.push({
      field,
      units,
      wakesSleepingBodies: options?.wakesSleepingBodies === true,
    });
    return field;
  }

  /**
   * Removes the **first** registration of `field`, preserving the order of the
   * rest. Returns whether one was found.
   */
  removeField(field: ForceField): boolean {
    const index = this.#fields.findIndex((entry) => entry.field === field);
    if (index < 0) {
      return false;
    }
    this.#fields.splice(index, 1);
    return true;
  }

  /** §39 lifecycle: nothing to prepare. */
  initialize(): void {
    // Deliberately empty: the system holds no solver state and allocates its
    // scratch at construction.
  }

  /**
   * Samples every registered field at every dynamic body of every tracked world
   * and queues the total through §26 (§39 step 5).
   *
   * ```text
   * for each tracked world, in tracking order:
   *   world.forEachActiveBody: every dynamic, awake body, in registration order (§33)
   *     point    = the visit's world-space centre of mass  (§25)
   *     velocity = body.linearVelocity, copied             (start-of-step value)
   *     total    = Σ over fields, in registration order:
   *                  sample(point, velocity, simulationTime) × (units === "acceleration" ? mass : 1)
   *     if total ≠ 0: body.applyForce(total)
   * ```
   *
   * ## The sample point is the centre of mass, not the transform origin
   *
   * §26 splits `applyForce` from `applyForceAtPoint`, and this is the former:
   * the force acts at the centre of mass and induces no torque. Sampling at the
   * point the force acts at is the only choice that keeps a field's answer and
   * its effect describing the same place — for an off-centre or compound body
   * (§24) the transform origin can be anywhere, including outside the shape.
   * `PhysicsWorld.forEachActiveBody` reads it from the solver, and is also
   * where the "dynamic and awake" filter and its §22/§32 arguments live.
   *
   * ## Velocity is the start-of-step value, and it is copied
   *
   * `RigidBody.linearVelocity` is refreshed from the solver in the previous
   * step's publish pass, so a velocity-dependent field (drag, wind) sees the
   * state the step begins in — the same rule the particle path states, and what
   * makes a drag field's closed form checkable. The copy costs one vector write
   * per body and makes §27's "do not mutate `velocity`" advisory rather than
   * load-bearing: a badly written field corrupts this system's scratch instead
   * of the component's mirror of solver state.
   *
   * ## Sleeping and non-dynamic bodies are skipped unless an entry opts in
   *
   * By `forEachActiveBody`, which states the argument: a force on a static or
   * kinematic body does nothing, and `RigidBody.applyForce` does **not**
   * implicitly wake a sleeper (WP-5.2). A persistent field (gravity, wind)
   * that visited every sleeper and then called `wake()` would defeat §32.
   * The opt-in is per-entry {@link ForceFieldAddOptions.wakesSleepingBodies}:
   * only those fields walk `forEachSleepingDynamicBody`, and only a non-zero
   * contribution calls `RigidBody.wake()`. Two entries that disagree do not
   * share a visit — the flag is not a system-wide OR.
   *
   * ## Allocation and cost
   *
   * Nothing is allocated after construction except the batched SoA scratch,
   * which grows to the next power of two that covers `world.size` the first
   * time a {@link ForceField.sampleAll} field meets that many registrations
   * and is then reused. A system with no fields, or with no tracked world,
   * does no solver call at all: the field list is tested before the worlds
   * are walked, so registering the system and using it later costs one
   * array-length comparison per step.
   *
   * ## Batching (optional {@link ForceField.sampleAll})
   *
   * When at least one registered field offers `sampleAll`, that world's
   * active bodies are gathered into stride-3 SoA buffers (binary64, so the
   * packed values equal `centerOfMass` / `linearVelocity` bit-for-bit) and
   * each such field is invoked once per step instead of once per body. A
   * field without the fast path is still sampled with {@link
   * ForceField.sample}, in its own place in the registration order, into
   * the same newton accumulator — one custom field neither reorders the
   * sum nor disables batching for its neighbours. Per-body summation order
   * is unchanged: field 0 then field 1 then field 2, which is why the
   * `force-fields` golden does not move.
   */
  fixedUpdate(context: FixedUpdateContext): void {
    if (this.#fields.length === 0 || this.#worlds.length === 0) {
      return;
    }
    const time = context.time.simulationTime;
    const batched = this.#hasBatchedField();
    const waking = this.#hasWakingField();
    for (let w = 0; w < this.#worlds.length; w += 1) {
      const world = this.#worlds[w];
      if (batched) {
        this.#applyToWorldBatched(world, time);
      } else {
        this.#applyToWorld(world, time);
      }
      if (waking) {
        world.forEachSleepingDynamicBody((body, node, centerOfMass) => {
          this.#applyToBody(body, node.id, centerOfMass, time, true);
        });
      }
    }
  }

  /** Whether any registered field visits sleeping dynamics. */
  #hasWakingField(): boolean {
    const fields = this.#fields;
    for (let f = 0; f < fields.length; f += 1) {
      if (fields[f].wakesSleepingBodies) {
        return true;
      }
    }
    return false;
  }

  /** Whether any registered field offers the §27 batch entry point. */
  #hasBatchedField(): boolean {
    const fields = this.#fields;
    for (let f = 0; f < fields.length; f += 1) {
      if (fields[f].field.sampleAll !== undefined) {
        return true;
      }
    }
    return false;
  }

  /** One world's active bodies, in registration order (§33). */
  #applyToWorld(world: PhysicsWorld, time: number): void {
    world.forEachActiveBody((body, node, centerOfMass) => {
      this.#applyToBody(body, node.id, centerOfMass, time);
    });
  }

  /**
   * Gathers one world's active bodies into SoA scratch and samples every
   * field across the whole set before applying one force per body.
   */
  #applyToWorldBatched(world: PhysicsWorld, time: number): void {
    this.#ensureCapacity(world.size);
    const positions = this.#positions;
    const velocities = this.#velocities;
    const bodies = this.#bodies;
    const massFactors = this.#massFactors;
    let count = 0;
    let needsMass = false;
    const fields = this.#fields;
    for (let f = 0; f < fields.length; f += 1) {
      if (fields[f].units === "acceleration") {
        needsMass = true;
        break;
      }
    }

    world.forEachActiveBody((body, node, centerOfMass) => {
      const base = count * 3;
      positions[base] = centerOfMass.x;
      positions[base + 1] = centerOfMass.y;
      positions[base + 2] = centerOfMass.z;
      const velocity = body.linearVelocity;
      velocities[base] = velocity.x;
      velocities[base + 1] = velocity.y;
      velocities[base + 2] = velocity.z;
      bodies[count] = body;
      if (needsMass) {
        massFactors[count] = this.#massFactor(body, node.id);
      }
      count += 1;
    });

    // Drop slots past this gather immediately: a quieter world (or a body
    // that left) must not stay reachable from the system (§83). Cleared
    // again in `finally` so a throw mid-apply cannot leak the live set.
    bodies.length = count;
    if (count === 0) {
      return;
    }

    const live = count * 3;
    const newtonAcc = this.#newtonAcc;
    newtonAcc.fill(0, 0, live);

    try {
      for (let f = 0; f < fields.length; f += 1) {
        this.#accumulateField(fields[f], count, time);
      }

      const total = this.#total;
      const hasTorque = this.#hasTorqueField();
      for (let i = 0; i < count; i += 1) {
        const base = i * 3;
        const x = newtonAcc[base];
        const y = newtonAcc[base + 1];
        const z = newtonAcc[base + 2];
        if (x !== 0 || y !== 0 || z !== 0) {
          total.set(x, y, z);
          bodies[i].applyForce(total);
        }
        if (hasTorque) {
          this.#position.set(
            positions[base],
            positions[base + 1],
            positions[base + 2],
          );
          this.#applyTorqueToBody(bodies[i], this.#position, time, false);
        }
      }
    } finally {
      bodies.length = 0;
    }
  }

  /** Whether any registered field offers {@link ForceField.sampleTorque}. */
  #hasTorqueField(): boolean {
    const fields = this.#fields;
    for (let f = 0; f < fields.length; f += 1) {
      if (fields[f].field.sampleTorque !== undefined) {
        return true;
      }
    }
    return false;
  }

  /**
   * Sums {@link ForceField.sampleTorque} over the fields that should run for
   * this body and queues the total through §26. Torque is always N·m.
   */
  #applyTorqueToBody(
    body: RigidBody,
    centerOfMass: Vector3,
    time: number,
    wakingOnly: boolean,
  ): boolean {
    const velocity = this.#velocity.copy(body.linearVelocity);
    const torque = this.#torque.set(0, 0, 0);
    let angularCopied = false;
    for (let f = 0; f < this.#fields.length; f += 1) {
      const entry = this.#fields[f];
      if (wakingOnly && !entry.wakesSleepingBodies) {
        continue;
      }
      const field = entry.field;
      if (field.sampleTorque === undefined) {
        continue;
      }
      if (!angularCopied) {
        this.#angularVelocity.copy(body.angularVelocity);
        angularCopied = true;
      }
      const sampled = field.sampleTorque(
        centerOfMass,
        velocity,
        this.#angularVelocity,
        time,
        this.#torqueSample,
      );
      torque.set(
        torque.x + sampled.x,
        torque.y + sampled.y,
        torque.z + sampled.z,
      );
    }
    if (torque.x === 0 && torque.y === 0 && torque.z === 0) {
      return false;
    }
    body.applyTorque(torque);
    return true;
  }

  /**
   * Adds one field's contribution, in newtons, into `#newtonAcc`.
   *
   * Uses {@link ForceField.sampleAll} when the field offers it; otherwise
   * walks the gathered bodies with {@link ForceField.sample}. Units are
   * applied here so the accumulator is always newtons and a mix of
   * `"force"` and `"acceleration"` fields still sums in registration order.
   */
  #accumulateField(entry: ForceFieldEntry, count: number, time: number): void {
    const scaleIsMass = entry.units === "acceleration";
    const field = entry.field;
    if (field.sampleAll !== undefined) {
      const scratch = this.#fieldScratch;
      scratch.fill(0, 0, count * 3);
      field.sampleAll(this.#positions, this.#velocities, count, time, scratch);
      this.#scaleAdd(count, scratch, scaleIsMass);
      return;
    }

    const position = this.#position;
    const velocity = this.#velocity;
    const sample = this.#sample;
    const positions = this.#positions;
    const velocities = this.#velocities;
    const newtonAcc = this.#newtonAcc;
    const massFactors = this.#massFactors;
    for (let i = 0; i < count; i += 1) {
      const base = i * 3;
      const scale = scaleIsMass ? massFactors[i] : 1;
      if (scale === 0) {
        continue;
      }
      position.set(positions[base], positions[base + 1], positions[base + 2]);
      velocity.set(
        velocities[base],
        velocities[base + 1],
        velocities[base + 2],
      );
      const sampled = entry.field.sample(position, velocity, time, sample);
      newtonAcc[base] += sampled.x * scale;
      newtonAcc[base + 1] += sampled.y * scale;
      newtonAcc[base + 2] += sampled.z * scale;
    }
  }

  /**
   * `newtonAcc += samples · scale`, with `scale` either 1 or the body's
   * kilograms. Component arithmetic rather than a vector helper so a
   * binary64 lane is never rounded through a `Vector3`.
   */
  #scaleAdd(count: number, samples: Float64Array, scaleIsMass: boolean): void {
    const newtonAcc = this.#newtonAcc;
    const massFactors = this.#massFactors;
    for (let i = 0; i < count; i += 1) {
      const scale = scaleIsMass ? massFactors[i] : 1;
      if (scale === 0) {
        continue;
      }
      const base = i * 3;
      newtonAcc[base] += samples[base] * scale;
      newtonAcc[base + 1] += samples[base + 1] * scale;
      newtonAcc[base + 2] += samples[base + 2] * scale;
    }
  }

  /**
   * Grows the SoA scratch to a power of two that covers `needed` bodies.
   * Gather always follows a grow in the same step, so a resized buffer
   * does not have to copy a partial gather.
   */
  #ensureCapacity(needed: number): void {
    if (needed <= this.#capacity) {
      return;
    }
    let next = this.#capacity === 0 ? 16 : this.#capacity;
    while (next < needed) {
      next *= 2;
    }
    const floats = next * 3;
    this.#positions = new Float64Array(floats);
    this.#velocities = new Float64Array(floats);
    this.#fieldScratch = new Float64Array(floats);
    this.#newtonAcc = new Float64Array(floats);
    this.#massFactors = new Float64Array(next);
    this.#capacity = next;
  }

  /** Sums every field at one body and queues the total through §26. */
  #applyToBody(
    body: RigidBody,
    nodeId: string,
    centerOfMass: Vector3,
    time: number,
    wakingOnly = false,
  ): void {
    const velocity = this.#velocity.copy(body.linearVelocity);
    const total = this.#total.set(0, 0, 0);
    // Resolved at most once per body, and only when an acceleration-unit field
    // is actually registered: a negative sentinel rather than `undefined`,
    // because 0 is a meaningful answer ("this body has no mass").
    let massFactor = -1;

    for (let f = 0; f < this.#fields.length; f += 1) {
      const entry = this.#fields[f];
      if (wakingOnly && !entry.wakesSleepingBodies) {
        continue;
      }
      let scale = 1;
      if (entry.units === "acceleration") {
        if (massFactor < 0) {
          massFactor = this.#massFactor(body, nodeId);
        }
        scale = massFactor;
      }
      if (scale === 0) {
        continue;
      }
      const sampled = entry.field.sample(
        centerOfMass,
        velocity,
        time,
        this.#sample,
      );
      // Component arithmetic rather than `scale` + `add`, because §27 lets a
      // field return a vector that is not `out` — and scaling a field's own
      // scratch in place would corrupt whatever it hands back next. Multiplying
      // by an exact 1 changes no bit, so `"force"` needs no second code path.
      total.set(
        total.x + sampled.x * scale,
        total.y + sampled.y * scale,
        total.z + sampled.z * scale,
      );
    }

    let applied = false;
    if (total.x !== 0 || total.y !== 0 || total.z !== 0) {
      body.applyForce(total);
      applied = true;
    }
    if (this.#applyTorqueToBody(body, centerOfMass, time, wakingOnly)) {
      applied = true;
    }
    // applyForce / applyTorque do not wake (§26 / WP-5.2). A waking field
    // that actually contributed must ask.
    if (applied && wakingOnly) {
      body.wake();
    }
  }

  /**
   * The kilograms an `"acceleration"` sample is multiplied by, or `0` when the
   * body has no mass to multiply with.
   *
   * `RigidBody.mass` is the authored mass or the solver's density derivation
   * (§23, §25), and it is `undefined` for exactly one reachable state: a
   * dynamic body with no authored mass and no collider to derive one from. That
   * body cannot be accelerated by anything — the solver has no mass for it
   * either — so the contribution is dropped rather than turned into a `NaN`
   * force that would poison the step and every checksum after it. It is
   * reported once per body, because it is an authoring mistake that would
   * otherwise repeat sixty times a second.
   *
   * A returned `0` is unambiguous: §23/§85 refuse a non-positive authored mass
   * and the world only mirrors a solver-derived mass when it is finite and
   * positive, so no legitimately-massed body can answer `0` here.
   */
  #massFactor(body: RigidBody, nodeId: string): number {
    const mass = body.mass;
    if (mass !== undefined) {
      return mass;
    }
    const warned = (this.#masslessWarned ??= new Set<string>());
    if (!warned.has(nodeId)) {
      warned.add(nodeId);
      console.warn(
        `${DEV_WARNING_PREFIX} ForceFieldSystem sampled an "acceleration" field at the dynamic RigidBody on node ${nodeId}, which has no mass: none was authored and it has no collider to derive one from (§23, §25). The contribution is dropped rather than turned into a NaN force. Author body.mass or attach a Collider. Further occurrences on this body are suppressed.`,
      );
    }
    return 0;
  }

  /**
   * §39 lifecycle: forgets every world and every field.
   *
   * The worlds are **not** disposed — a world outlives the systems that read it
   * (`PhysicsSystem` says the same), and this one never owned any of them.
   */
  dispose(): void {
    this.#worlds.length = 0;
    this.#fields.length = 0;
    this.#bodies.length = 0;
    this.#masslessWarned = undefined;
  }
}
