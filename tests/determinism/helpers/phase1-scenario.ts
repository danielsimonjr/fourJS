/**
 * The Phase 1 exit scenario (§104 exit criterion, §33 determinism, plan
 * WP-1.14) — one headless run of a 100-node scene stepped 1000 times, reduced
 * to a handful of uint32 checksums.
 *
 * §104's exit criterion is "a scene graph can be deterministically stepped
 * without a renderer". This module *is* that sentence, executable: it builds an
 * {@link Application} (scene + fixed-step scheduler + §39 system registry, no
 * renderer anywhere in the import graph), registers a system that mutates
 * transforms from the injected `TimeState` and from seeded RNG streams, drives
 * 1000 host-injected frames with a ragged
 * elapsed sequence, and checksums every world matrix after every frame.
 *
 * ## Why this file is `.ts` and imported by *both* runtimes
 *
 * The determinism gate (plan §8) demands the same scenario run twice
 * in-process **and** once in a fresh `node` child process. Those two runs are
 * only evidence if they execute *identical code*, so the scenario lives in one
 * file that both can load:
 *
 * - **Vitest** loads it through Vite, as it loads any `.ts` under `tests/`.
 * - **Plain `node`** loads it directly: this repository pins Node ≥ 20 and runs
 *   on Node 22.22 (`process.features.typescript === "strip"`), where
 *   type-stripping is on by default, and bare `@fourjs/*` specifiers resolve from
 *   this file's directory up to the workspace `node_modules` symlinks into each
 *   package's built `dist`.
 *
 * The packet's fallback suggestion — write the scenario as a `.mjs` runner and
 * have the `.ts` test import that — was rejected because it would put the
 * scenario outside TypeScript entirely (no `strict` checking of the very code
 * that defines the golden values) for a portability problem that this Node
 * version does not have. The cost of the choice is recorded honestly: **this
 * file must stay within Node's erasable-syntax subset** — type annotations,
 * `interface`, `type`, and `import type` are fine; `enum`, `namespace`,
 * constructor parameter properties, and decorators are not. Nothing here needs
 * them. If a future Node/toolchain change breaks direct `.ts` loading, the fix
 * is a build step or a `.mjs` transpile of this file — not two copies of the
 * scenario.
 *
 * ## Determinism tier reached (§33)
 *
 * **`same-runtime`**, which is §33's stated initial target and exactly what the
 * Phase 1 exit needs. Everything that *selects* behaviour here is exact integer
 * arithmetic — a 32-bit LCG through `Math.imul`, so structure, the elapsed
 * sequence, and every random increment are bit-identical on any engine. The
 * arithmetic that *computes* transforms is not: `Quaternion.setFromAxisAngle`
 * calls `Math.sin`/`Math.cos`, whose results may legally differ between JS
 * engines, which is precisely the hazard §33 names for the `same-platform`
 * tier. A rotation driven by `simulationTime` is what the packet specifies and
 * what a scene graph actually does, so the transcendental stays and the tier is
 * documented rather than hidden. The checksum itself (D6) is exact and
 * cross-platform; only its inputs are runtime-bound.
 *
 * ## What the scenario deliberately exercises
 *
 * | Phase 1 mechanism | how it is reached |
 * |---|---|
 * | fixed-step accumulator (§10) | 1000 ragged frames, 0..5 fixed steps each |
 * | sub-step clamp + `droppedTime` (§9, §10) | two 0.5 s frames (indices 249, 749) |
 * | §39 system registry ordering | the mutator registers at `PRIORITY_KINEMATICS` |
 * | dirty/version propagation (§7) | every node mutated every fixed step |
 * | world-transform resolution (§7) | `Application`'s `onUpdate` resolve, read in `update` |
 * | mixed hierarchy depth (§6) | LCG-chosen chains, star hubs, and new roots |
 * | insertion-order traversal (§33) | `Scene.traverse`, depth-first, insertion order |
 */

import { createChecksum } from "@fourjs/diagnostics";
import { Vector3 } from "@fourjs/math";
import {
  PRIORITY_KINEMATICS,
  type FixedUpdateContext,
  type SimulationSystem,
} from "@fourjs/motion";
import { Group, type Node } from "@fourjs/scene";
import { Application } from "fourJS";

/** Seed of every RNG stream below: the ASCII bytes of `"FOUR"`. */
export const SCENARIO_SEED = 0x464f5552;

/** Nodes built under the scene root (the root itself is hashed too, so 101 matrices). */
export const NODE_COUNT = 100;

/** Host-injected frames driven through `Application.step`. */
export const STEP_COUNT = 1000;

/** §45 `fixedTimeStep`, in seconds (§7a: never milliseconds). */
export const FIXED_TIME_STEP = 1 / 60;

/**
 * Frame indices (0-based) given a deliberately long elapsed time, so the §10
 * sub-step clamp fires and `TimeState.droppedTime` advances. 0.5 s is 30 fixed
 * steps' worth of time against a clamp of 5.
 */
export const LONG_FRAME_INDICES: readonly number[] = [249, 749];

/** Elapsed time injected for a long frame, in seconds. */
export const LONG_FRAME_ELAPSED = 0.5;

/** Shortest ordinary frame, in seconds (240 Hz). */
const MIN_FRAME_ELAPSED = 1 / 240;

/** Longest ordinary frame, in seconds (30 Hz). */
const MAX_FRAME_ELAPSED = 1 / 30;

/** 1-based step number whose digest is published for diagnosis. */
export const PROBE_STEP = 500;

/** Numerical Recipes' 32-bit LCG multiplier. */
const LCG_MULTIPLIER = 1664525;

/** Numerical Recipes' 32-bit LCG increment. */
const LCG_INCREMENT = 1013904223;

/** 2^32 — the LCG modulus, and the divisor that maps state onto [0, 1). */
const TWO_POW_32 = 4294967296;

/** Knuth's 32-bit golden-ratio constant, used to decorrelate derived seeds. */
const GOLDEN_RATIO_32 = 2654435761;

/**
 * A seeded 32-bit linear congruential generator (§33 ground rule 5: no
 * `Math.random`, no wall clock).
 *
 * `Math.imul` makes the multiply exact modulo 2^32 and `>>> 0` keeps the state
 * an unsigned 32-bit integer, so the whole stream is exact integer arithmetic:
 * identical on every engine, on every platform, forever. The returned value is
 * `state / 2^32`, a double in `[0, 1)` with 32 bits of entropy.
 *
 * @param seed any number; coerced to uint32
 * @returns a generator advancing one step per call
 */
export function createLcg(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    return state / TWO_POW_32;
  };
}

/** The four numbers the golden file pins. */
export interface Phase1Summary {
  /** Checksum of all {@link STEP_COUNT} per-step digests, in step order. */
  summaryDigest: number;
  /** Digest after step 1. */
  firstStepDigest: number;
  /** Digest after step {@link PROBE_STEP}. */
  step500Digest: number;
  /** Digest after step {@link STEP_COUNT}. */
  lastStepDigest: number;
}

/** Everything one scenario run produces; `summary` is the part under golden lock. */
export interface Phase1ScenarioResult {
  summary: Phase1Summary;
  /** One uint32 per host frame, in step order. */
  digests: number[];
  /** Frames driven (always {@link STEP_COUNT}). */
  stepCount: number;
  /** Nodes built under the root (always {@link NODE_COUNT}). */
  nodeCount: number;
  /** Matrices hashed per step — the built nodes plus the scene root. */
  hashedNodeCount: number;
  /** Fixed steps the scheduler actually ran across the whole run (§10). */
  fixedStepCount: number;
  /** Simulation time discarded by the sub-step clamp, in seconds (§9). */
  droppedTime: number;
  /** Simulation time reached, in seconds (`fixedStepCount * FIXED_TIME_STEP`). */
  simulationTime: number;
  /** Deepest node depth built, root = 0 — evidence the hierarchy is not flat. */
  maximumDepth: number;
}

/**
 * The one system this scenario registers (§39, plan D5): it advances every
 * node's transform once per fixed step.
 *
 * Two independent sources of motion, as the packet specifies:
 *
 * - **Rotation is a pure function of `TimeState.simulationTime`** — the same
 *   simulation time always yields the same pose, so a replay that lands on the
 *   same step lands on the same rotation regardless of how the host chopped up
 *   real time.
 * - **Translation is a per-node LCG random walk** — path-dependent state, which
 *   is the harder determinism case: it only reproduces if *every* fixed step
 *   ran, in order, exactly once. A dropped or duplicated step shows up
 *   immediately as a diverged checksum, which is exactly what the clamp frames
 *   are there to probe.
 *
 * Nodes are visited from a flat array captured in construction order (§33:
 * insertion order only), never from a `Set` or object keys.
 */
class TransformMutatorSystem implements SimulationSystem {
  /** §39 kinematics slot: this system moves transforms directly (§42 `kinematic`). */
  priority = PRIORITY_KINEMATICS;

  readonly #nodes: readonly Node[];

  /** Rotation axis per node; need not be unit length (`setFromAxisAngle` normalizes). */
  readonly #axes: readonly Vector3[];

  /** Angular rate per node, in radians per second (§7a). */
  readonly #rates: readonly number[];

  /** Random-walk step size per node, in units. */
  readonly #walkScales: readonly number[];

  /** One LCG stream per node, keyed by node index. */
  readonly #walkStreams: readonly (() => number)[];

  /** Fixed steps this system has run — read back as a run statistic. */
  fixedStepCount = 0;

  constructor(
    nodes: readonly Node[],
    axes: readonly Vector3[],
    rates: readonly number[],
    walkScales: readonly number[],
    walkStreams: readonly (() => number)[],
  ) {
    this.#nodes = nodes;
    this.#axes = axes;
    this.#rates = rates;
    this.#walkScales = walkScales;
    this.#walkStreams = walkStreams;
  }

  initialize(): void {
    // Nothing to prepare: every per-node array is built before registration.
  }

  fixedUpdate(context: FixedUpdateContext): void {
    const simulationTime = context.time.simulationTime;
    const nodes = this.#nodes;
    for (let i = 0; i < nodes.length; i += 1) {
      const transform = nodes[i].transform;
      transform.rotation.setFromAxisAngle(
        this.#axes[i],
        simulationTime * this.#rates[i],
      );
      const next = this.#walkStreams[i];
      const scale = this.#walkScales[i];
      const position = transform.position;
      position.set(
        position.x + (next() - 0.5) * scale,
        position.y + (next() - 0.5) * scale,
        position.z + (next() - 0.5) * scale,
      );
    }
    this.fixedStepCount += 1;
  }

  dispose(): void {
    // No owned resources.
  }
}

/** A node's depth below the scene root, root = 0. */
function depthOf(node: Node): number {
  let depth = 0;
  let current: Node | null = node.parent;
  while (current !== null) {
    depth += 1;
    current = current.parent;
  }
  return depth;
}

/**
 * Runs the Phase 1 exit scenario once, from scratch, and returns its checksums.
 *
 * Every run of this function in any process is independent: it builds its own
 * `Application`, its own scene, and its own RNG streams from
 * {@link SCENARIO_SEED}, and disposes the application before returning. Nothing
 * is cached at module scope, so calling it twice in one process is a genuine
 * second run rather than a replay of the first.
 *
 * @returns the run's summary, its per-step digests, and run statistics
 */
export async function runPhase1Scenario(): Promise<Phase1ScenarioResult> {
  const application = new Application({ fixedTimeStep: FIXED_TIME_STEP });
  // `maximumSubSteps` is deliberately left at the Appendix A default (5) — the
  // clamp behaviour under test is the *default* one (packet: "default clamp").

  // --- Structure (§6): chains, star hubs, and extra roots, all LCG-chosen ---
  const structure = createLcg(SCENARIO_SEED);
  const scene = application.scene;
  const nodes: Node[] = [];
  const axes: Vector3[] = [];
  const rates: number[] = [];
  const walkScales: number[] = [];
  const walkStreams: (() => number)[] = [];
  let maximumDepth = 0;

  for (let i = 0; i < NODE_COUNT; i += 1) {
    const node = new Group();
    node.name = `node-${String(i)}`;

    // Parent choice. The three arms are what makes depth mixed rather than
    // uniform: "chain" grows a spine, "hub" fans a star off an arbitrary
    // earlier node, "root" starts a fresh branch under the scene.
    const roll = structure();
    let parent: Node;
    if (i === 0 || roll < 0.15) {
      parent = scene;
    } else if (roll < 0.6) {
      parent = nodes[i - 1];
    } else {
      parent = nodes[Math.floor(structure() * i)];
    }
    parent.add(node);

    // Initial pose: a non-degenerate spread, so world matrices differ from the
    // start and a mis-parented node cannot hash the same as a correct one.
    node.transform.position.set(
      structure() * 2 - 1,
      structure() * 2 - 1,
      structure() * 2 - 1,
    );

    axes.push(
      new Vector3(
        structure() * 2 - 1,
        structure() * 2 - 1,
        structure() * 2 - 1,
      ),
    );
    rates.push(0.5 + structure() * 2.5);
    walkScales.push(0.002 + structure() * 0.008);
    // Per-node stream, keyed by index so streams stay independent of the order
    // in which nodes happen to be visited.
    walkStreams.push(
      createLcg(SCENARIO_SEED ^ Math.imul(i + 1, GOLDEN_RATIO_32)),
    );

    nodes.push(node);
    const depth = depthOf(node);
    if (depth > maximumDepth) {
      maximumDepth = depth;
    }
  }

  const mutator = new TransformMutatorSystem(
    nodes,
    axes,
    rates,
    walkScales,
    walkStreams,
  );
  application.systems.register(mutator);

  // --- Hashing (§33, D6) ---------------------------------------------------
  // `update` fires once per host frame, after every fixed step of that frame
  // and after `Application` resolved world transforms (§7). Reading world
  // matrices here is therefore reading resolved state, not stale state.
  const digests: number[] = [];
  application.on("update", () => {
    const checksum = createChecksum();
    scene.traverse((node) => {
      checksum.addFloats(node.transform.worldMatrix.elements);
    });
    digests.push(checksum.digest());
  });

  await application.initialize();
  application.start();

  // --- Drive (§10) ---------------------------------------------------------
  const frames = createLcg(SCENARIO_SEED ^ GOLDEN_RATIO_32);
  for (let step = 0; step < STEP_COUNT; step += 1) {
    // The frame stream is advanced on *every* iteration, long frame or not, so
    // the ordinary frames after a long one are unaffected by it.
    const ordinary =
      MIN_FRAME_ELAPSED + frames() * (MAX_FRAME_ELAPSED - MIN_FRAME_ELAPSED);
    const elapsed = LONG_FRAME_INDICES.includes(step)
      ? LONG_FRAME_ELAPSED
      : ordinary;
    application.step(elapsed);
  }

  const time = application.time;
  const summaryChecksum = createChecksum();
  for (let i = 0; i < digests.length; i += 1) {
    // Digests are uint32s; `addFloat` quantizes by 1e6, so the largest possible
    // value maps to 4.29e15 — inside the 53-bit-safe range the hasher requires.
    summaryChecksum.addFloat(digests[i]);
  }

  const result: Phase1ScenarioResult = {
    summary: {
      summaryDigest: summaryChecksum.digest(),
      firstStepDigest: digests[0],
      step500Digest: digests[PROBE_STEP - 1],
      lastStepDigest: digests[digests.length - 1],
    },
    digests,
    stepCount: STEP_COUNT,
    nodeCount: NODE_COUNT,
    hashedNodeCount: NODE_COUNT + 1,
    fixedStepCount: mutator.fixedStepCount,
    droppedTime: time.droppedTime,
    simulationTime: time.simulationTime,
    maximumDepth,
  };

  application.dispose();
  return result;
}
