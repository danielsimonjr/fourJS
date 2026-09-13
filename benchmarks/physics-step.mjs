/**
 * §86's *"active rigid bodies: 5 000 simple bodies baseline"* row, measured
 * headlessly through the Rapier 3D adapter (§20–32, §37; §92's *"simulation
 * time … contacts"* metrics; plan §6j P11-4, WP-11.4).
 *
 * ```sh
 * bun run build          # this script imports the built dist, not src
 * node benchmarks/physics-step.mjs
 * ```
 *
 * ## The §86 row this speaks to, and exactly how far it goes
 *
 * §86 targets *"5 000 simple bodies baseline"* of **active** rigid bodies on
 * *"suitable modern desktop hardware"*. Two words in that sentence decide what
 * this script had to do:
 *
 * - **active.** §32 sleeping is enabled by default (Appendix A), and a settled
 *   pile of boxes goes to sleep within a second — after which "5 000 bodies"
 *   costs almost nothing and the number would be a lie by omission. So every
 *   scenario here runs with `sleeping: { enabled: false }`: all N bodies are
 *   awake and solved on every step, for the whole run. This is the *expensive*
 *   reading of §86's row and the only honest one.
 * - **suitable modern desktop hardware.** The recorded host is a shared CI
 *   container with no GPU. As in `particles-100k.mjs` (plan §6h), a slower
 *   result here is not a failed §86 and a faster one is not a passed one.
 *   Nothing in CI asserts on these timings.
 *
 * ## What one measured iteration is
 *
 * `PhysicsWorld.step(fixedDeltaTime)` — §39's steps 1–6: command drain,
 * kinematic feed, scene→solver sync, the solver step itself, solver→scene sync,
 * and the write-back of every body's pose and velocity into its node. That is
 * the whole per-fixed-step cost of the physics pillar for the scenario, and it
 * is measured against the **16.667 ms** a 60 Hz fixed step has to spend
 * (Appendix A's `fixedTimeStep`).
 *
 * §39 step 9 — `dispatchEvents()` — is run as the harness's **untimed
 * `prepare`** hook immediately before the next step instead. The world has no
 * listeners registered, so nothing observes the reordering; it exists so the
 * timed region is exactly the solve, and so the event queue cannot grow across
 * a run and turn the benchmark into a memory experiment. The events are still
 * counted before they are drained, and reported as `eventsPerStep` — §92's
 * *contacts* metric in the form this API actually exposes (§29
 * `collisionstart`/`collisionend`, not raw contact manifolds).
 *
 * ## The scenario
 *
 * One static floor and N dynamic unit boxes on a lattice above it, dropped and
 * left to pile up. Boxes rather than spheres because box-box contact manifolds
 * are the realistic case; a lattice rather than a random cloud because §33
 * forbids an RNG here and because a reader can reproduce a lattice exactly. The
 * warm-up steps are the pile landing; the measured steps are a resting-but-
 * awake pile, which is the steady state §86's row describes.
 *
 * `finalChecksum` is `world.checksum()` (§33) after the last step: it is not a
 * timing, it is the scenario's fingerprint, so a future run whose numbers moved
 * can be told apart from a future run whose *scene* moved.
 *
 * ## The attribution run
 *
 * A single "N bodies cost X ms" number is uninterpretable, exactly as plan §6h
 * found for particles. So every body count is measured **twice**: once as the
 * pile above, and once in **free fall** — the same N bodies on the same
 * lattice, with no floor, so they never touch, produce no contacts and queue no
 * §29 events. The difference is the whole cost of contact generation, contact
 * solving, and event translation; the free-fall figure is broad phase,
 * integration, and the per-body scene write-back alone.
 *
 * Both halves are worth having. The free-fall column says what N bodies cost
 * when nothing is happening — which is what a scene of independently moving
 * props actually is — and the difference says what a pile costs, which is what
 * a stress test actually is. Quoting either one as "the" cost of N bodies would
 * be a choice disguised as a measurement.
 *
 * ## Wall clocks (plan §1 ground rule)
 *
 * The simulation is driven by the constant {@link FIXED_DELTA_TIME} and by
 * nothing else. `performance.now()` lives in `harness.mjs` and nothing it
 * returns reaches the world; `PhysicsWorld.step` itself reads no clock (§33).
 * Delete every timer and the run produces the identical `finalChecksum`.
 *
 * ## What is *not* measured
 *
 * The 2D adapter (`Rapier2dAdapter`), joints (§28), queries (§30), and the
 * §19 blending pipeline. Each is its own cost with its own shape, and this
 * script is scoped to the one §86 row it can name. Recorded, never gated.
 */

import { Vector3 } from "@fourjs/math";
import { Collider, PhysicsWorld, RigidBody } from "@fourjs/physics";
import { Rapier3dAdapter } from "@fourjs/physics-rapier";
import { Group } from "@fourjs/scene";

import {
  MEASUREMENT_NOTE,
  hostLines,
  hostRecord,
  measure,
  printReport,
  round,
  summarize,
  writeResult,
} from "./harness.mjs";

/** §45 `fixedTimeStep`, in seconds (§7a: never milliseconds). */
const FIXED_DELTA_TIME = 1 / 60;

/** The budget one fixed step has at 60 Hz, in milliseconds. */
const FIXED_STEP_BUDGET_MS = FIXED_DELTA_TIME * 1000;

/** Body counts measured, ending on §86's stated baseline. */
const BODY_COUNTS = [500, 1000, 2500, 5000];

/** Measured fixed steps per scenario (2 s of simulation at 60 Hz). */
const MEASURED_STEPS = 120;

/**
 * Unmeasured fixed steps first (1 s). Two jobs at once: V8 warm-up, and the
 * lattice falling onto the floor — so the measured window is a resting-but-
 * awake pile rather than free fall, which are different workloads.
 */
const WARMUP_STEPS = 60;

/** Half-extent of every dynamic box, in metres. */
const BOX_HALF_EXTENT = 0.5;

/** Lattice spacing, in metres — wide enough that nothing overlaps at spawn. */
const SPACING = 1.4;

/** Height of the lowest lattice layer above the floor, in metres. */
const DROP_HEIGHT = 1.2;

/** Decimals kept for the millisecond statistics. */
const MS_DIGITS = 4;

/** Half-extents of the static floor slab, in metres. */
const FLOOR_HALF = new Vector3(120, 0.5, 120);

/**
 * Builds one scenario: a 3D world with sleeping disabled, `bodyCount` dynamic
 * boxes on a lattice, and — when `withFloor` — a static floor beneath them.
 *
 * Without the floor the lattice falls forever and nothing ever touches: that is
 * the attribution variant described in the header.
 *
 * Bodies take the §25 density-derived mass path (no explicit `mass`), which is
 * what "simple bodies" means and what an application writes by default.
 * Registration order is creation order, which is also §33's checksum order.
 */
async function buildWorld(bodyCount, withFloor) {
  const world = new PhysicsWorld({
    dimension: "3d",
    adapter: new Rapier3dAdapter(),
    // §32 sleeping off: §86's row says *active* bodies. See the header.
    sleeping: { enabled: false },
  });
  await world.initialize();

  const root = new Group();
  root.name = `physics-step-${bodyCount}`;

  if (withFloor) {
    const floor = new Group();
    floor.name = "floor";
    floor.transform.position.set(0, -FLOOR_HALF.y, 0);
    floor.transformAuthority = "manual";
    floor.addComponent(new RigidBody({ type: "static" }));
    floor.addComponent(
      new Collider({ shape: { type: "box", halfExtents: FLOOR_HALF } }),
    );
    root.add(floor);
    world.addBody(floor);
  }

  // A square lattice in x/z, stacked in y — deterministic and reproducible,
  // and §33 forbids reaching for an RNG to scatter it.
  const perSide = Math.ceil(Math.sqrt(bodyCount / 8));
  const origin = -((perSide - 1) * SPACING) / 2;
  for (let i = 0; i < bodyCount; i += 1) {
    const layer = Math.floor(i / (perSide * perSide));
    const within = i % (perSide * perSide);
    const node = new Group();
    node.name = `box-${i}`;
    node.transform.position.set(
      origin + (within % perSide) * SPACING,
      DROP_HEIGHT + layer * (SPACING + 2 * BOX_HALF_EXTENT),
      origin + Math.floor(within / perSide) * SPACING,
    );
    node.transformAuthority = "physics";
    node.addComponent(new RigidBody({ type: "dynamic" }));
    node.addComponent(
      new Collider({
        shape: {
          type: "box",
          halfExtents: new Vector3(
            BOX_HALF_EXTENT,
            BOX_HALF_EXTENT,
            BOX_HALF_EXTENT,
          ),
        },
        friction: 0.5,
        restitution: 0,
      }),
    );
    root.add(node);
    world.addBody(node);
  }

  const expected = withFloor ? bodyCount + 1 : bodyCount;
  if (world.size !== expected) {
    throw new Error(
      `physics-step setup failed: wanted ${expected} registered bodies, got ${world.size}`,
    );
  }
  return { world, perSide, registeredBodies: expected };
}

/**
 * Runs one body count in one variant and returns its measured statistics.
 *
 * @param bodyCount dynamic bodies on the lattice
 * @param withFloor `true` for the pile, `false` for the free-fall attribution
 */
async function runVariant(bodyCount, withFloor) {
  const { world, perSide, registeredBodies } = await buildWorld(
    bodyCount,
    withFloor,
  );

  let measuredEventCount = 0;
  const { warmup, measured } = measure(
    () => {
      world.step(FIXED_DELTA_TIME);
    },
    {
      warmupIterations: WARMUP_STEPS,
      measuredIterations: MEASURED_STEPS,
      // §39 step 9, untimed and listener-free — see the header.
      prepare: (index) => {
        if (index > WARMUP_STEPS) {
          measuredEventCount += world.queuedEvents.length;
        }
        world.dispatchEvents();
      },
    },
  );
  // The last measured step's events, which no `prepare` ran after.
  measuredEventCount += world.queuedEvents.length;
  world.dispatchEvents();

  const summary = summarize(measured);
  const warmupSummary = summarize(warmup);
  const finalChecksum = world.checksum();
  world.dispose();

  return {
    latticePerSide: perSide,
    registeredBodies,
    warmupMeanMsPerStep: round(warmupSummary.meanMs, MS_DIGITS),
    meanMsPerStep: round(summary.meanMs, MS_DIGITS),
    medianMsPerStep: round(summary.medianMs, MS_DIGITS),
    p95MsPerStep: round(summary.p95Ms, MS_DIGITS),
    p99MsPerStep: round(summary.p99Ms, MS_DIGITS),
    minMsPerStep: round(summary.minMs, MS_DIGITS),
    maxMsPerStep: round(summary.maxMs, MS_DIGITS),
    meanFractionOfFixedStepBudget: round(
      summary.meanMs / FIXED_STEP_BUDGET_MS,
      4,
    ),
    p95FractionOfFixedStepBudget: round(
      summary.p95Ms / FIXED_STEP_BUDGET_MS,
      4,
    ),
    microsecondsPerBodyStep: round((summary.meanMs * 1000) / bodyCount, 3),
    bodyStepsPerSecond: Math.round((bodyCount / summary.meanMs) * 1000),
    eventsPerStep: round(measuredEventCount / MEASURED_STEPS, 2),
    totalMeasuredEvents: measuredEventCount,
    finalChecksum,
    insideBudgetAtP95: summary.p95Ms <= FIXED_STEP_BUDGET_MS,
  };
}

/** Runs both variants of one body count and returns its record row. */
async function runScenario(bodyCount) {
  const piled = await runVariant(bodyCount, true);
  const freefall = await runVariant(bodyCount, false);
  return {
    bodies: bodyCount,
    sleepingEnabled: false,
    measuredSteps: MEASURED_STEPS,
    warmupSteps: WARMUP_STEPS,
    piled,
    freefall,
    contactAndEventMsPerStep: round(
      piled.meanMsPerStep - freefall.meanMsPerStep,
      MS_DIGITS,
    ),
    contactAndEventShareOfPiled: round(
      (piled.meanMsPerStep - freefall.meanMsPerStep) / piled.meanMsPerStep,
      4,
    ),
  };
}

// --- the run -----------------------------------------------------------------

const rows = [];
for (const bodyCount of BODY_COUNTS) {
  rows.push(await runScenario(bodyCount));
}

const baselineRow = rows.find((row) => row.bodies === 5000);

// --- the record --------------------------------------------------------------

const host = hostRecord();
const record = {
  _note: MEASUREMENT_NOTE,
  benchmark: "physics-step",
  specification:
    "§86 (active rigid bodies: 5 000 simple bodies baseline), §20–32, §37, §39, §92; plan §6j P11-4, WP-11.4",
  recordedAt: new Date().toISOString(),
  solver:
    "rapier3d (@fourjs/physics-rapier Rapier3dAdapter) through @fourjs/physics",
  dimension: "3d",
  fixedDeltaTimeSeconds: round(FIXED_DELTA_TIME, 9),
  fixedStepBudgetMs: round(FIXED_STEP_BUDGET_MS, 4),
  scenario: `static floor + N dynamic ${2 * BOX_HALF_EXTENT} m boxes on a lattice (spacing ${SPACING} m), density-derived mass, friction 0.5, restitution 0`,
  sleepingNote:
    "§32 sleeping is DISABLED in every scenario. §86's row says *active* bodies, and Appendix A's default would put a settled pile to sleep within a second and make the measurement meaningless. This is the expensive reading of the row.",
  timedRegionNote:
    "One measured iteration is PhysicsWorld.step(dt) — §39 steps 1–6. §39 step 9 (dispatchEvents) runs as the harness's untimed prepare hook before the next step; the world has no listeners, so nothing observes the reordering and the queue cannot grow across the run.",
  eventsNote:
    "eventsPerStep counts §29 events queued by the step (collisionstart/collisionstay/collisionend), which is what this API exposes of §92's 'contacts' metric — it is not a raw contact-manifold count.",
  attributionNote:
    "Every body count is measured twice. `piled` is the §86 scenario (floor, contacts, events). `freefall` is the same lattice with no floor, so nothing ever touches: broad phase, integration and the per-body scene write-back alone, with zero events. contactAndEventMsPerStep is the difference — contact generation, contact solving and §29 event translation together.",
  checksumNote:
    "finalChecksum is world.checksum() (§33) after the last step: the scenario's fingerprint, not a timing. A future run with different numbers but the same checksum moved on speed only.",
  scenarios: rows,
  ...host,
  hostCaveat:
    "CI container, no GPU, shared host; run-to-run spread is large. §86's 'suitable modern desktop hardware' is NOT this machine, so a row over budget here is not a failed §86 and a row under it is not a passed one. Recorded, never gated — nothing in CI asserts on these timings.",
};

const path = writeResult("physics-step", record);

// --- the report --------------------------------------------------------------

printReport([
  "fourJS — Rapier 3D fixed-step cost vs §86's 5 000-active-body row (§20–32, §37, §92)",
  "  scenario                static floor + N dynamic boxes on a lattice, §32 sleeping DISABLED (all N awake)",
  `  steps                   ${MEASURED_STEPS} measured, ${WARMUP_STEPS} warm-up (the pile landing), per variant`,
  `  60 Hz budget            ${round(FIXED_STEP_BUDGET_MS, 3)} ms/step`,
  "",
  "    bodies   piled ms      p95 ms   % of budget   events/step   free-fall ms   contacts+events ms",
  ...rows.map((row) =>
    [
      String(row.bodies).padStart(10),
      String(row.piled.meanMsPerStep).padStart(11),
      String(row.piled.p95MsPerStep).padStart(12),
      `${round(row.piled.meanFractionOfFixedStepBudget * 100, 1)}%`.padStart(
        14,
      ),
      String(row.piled.eventsPerStep).padStart(14),
      String(row.freefall.meanMsPerStep).padStart(15),
      `${row.contactAndEventMsPerStep} (${round(row.contactAndEventShareOfPiled * 100, 1)}%)`.padStart(
        21,
      ),
    ].join(""),
  ),
  "",
  `  §86 baseline row        5 000 active bodies, piled: ${baselineRow.piled.meanMsPerStep} ms/step mean, ${baselineRow.piled.p95MsPerStep} ms at p95 —`,
  `                          ${round(baselineRow.piled.meanFractionOfFixedStepBudget * 100, 1)}% of the 60 Hz budget at the mean, ${
    baselineRow.piled.insideBudgetAtP95
      ? "inside it at p95"
      : "over it at p95 (recorded, not gated)"
  }`,
  '                          on a shared CI container, which is not §86\'s "suitable modern desktop hardware".',
  `  the same 5 000 bodies   in free fall (no contacts, no §29 events): ${baselineRow.freefall.meanMsPerStep} ms/step, ${round(baselineRow.freefall.meanFractionOfFixedStepBudget * 100, 1)}% of budget.`,
  `                          So ${round(baselineRow.contactAndEventShareOfPiled * 100, 1)}% of the piled figure is contacts, contact solving and event translation,`,
  "                          not the per-body integration — the attribution, not a conclusion about which to fix.",
  `  fingerprints            ${rows.map((row) => `${row.bodies}:${row.piled.finalChecksum}`).join("  ")}  (§33 checksums of the piled runs, not timings)`,
  "",
  ...hostLines(
    host,
    "CI container, no GPU, shared host; §86's hardware clause is not satisfied here.",
  ),
  "",
  `  written                 ${path}`,
]);
