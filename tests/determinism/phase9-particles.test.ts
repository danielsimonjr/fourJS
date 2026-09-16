/**
 * Phase 9 determinism test (plan §6h P9-4, WP-9.4; §112, §36, §27, §33, §92).
 *
 * §112 closes Phase 9 on scale and rendering — *"≥100,000 simple particles
 * simulated and rendered at interactive rates"* — and plan §6h splits the
 * evidence three ways: `benchmarks/particles-100k.mjs` records the 100 000-
 * particle CPU cost, `tests/browser/particles.spec.ts` shows a system reaching a
 * real framebuffer and responding to a user, and **this file** discharges P9-4:
 * *"§36 emitters use SeededRandom; particle iteration insertion order; a
 * determinism golden pins a 100-particle scenario"*.
 *
 * It follows the four forms WP-1.14, WP-2.7, WP-4.8, WP-5.8, WP-6.6 and WP-7.7
 * established:
 *
 * 1. **Headless.** The scenario imports `@fourjs/particles`, `@fourjs/motion`,
 *    `@fourjs/math`, `@fourjs/diagnostics` and `four/application` — no renderer
 *    package, no canvas, no DOM. As in the phases before it the application
 *    comes from the `four/application` subpath, so "nothing renderer-shaped is
 *    loaded" is a property of the import graph and not only of behaviour. The
 *    presentation *repack* is still exercised: a `ParticleRenderable` is in the
 *    scene and `updateParticleInstances()` is called every step, exactly as
 *    `buildRenderList` would, and its output is hashed separately.
 * 2. **Deterministic in-process.** Two independent runs in one process — each on
 *    its own emitter and its own seeded stream — produce byte-identical per-step
 *    digests and identical records.
 * 3. **Deterministic across processes, against a committed golden.** A fresh
 *    `node` child process — new heap, new module graph, new JIT state — running
 *    *the same helper file* reproduces the same 600 digests and matches
 *    `golden/phase9.json`.
 * 4. **Correct where correctness is checkable without re-deriving the engine.**
 *    The pool really saturates and really drops spawns; particles really bounce
 *    off §36's plane; the seeded stream really advanced by four draws per
 *    spawned particle; and the ramps really moved.
 *
 * ## The cross-package check only this file can make
 *
 * `@fourjs/particles` may not import `@fourjs/motion` (the §3.1 matrix), so
 * `ParticleSystem` implements §39's `SimulationSystem` **structurally** and
 * restates `PRIORITY_FORCES` as its own `PRIORITY_PARTICLES` — the same
 * arrangement `ParticleRenderable` has with `@fourjs/render`'s `ParticleDrawable`.
 * Nothing type-checks those declarations against each other, in either
 * direction. This suite is the one place in the repository that can, because the
 * root `tests/` project sees every package:
 *
 * - **assignability**, by *registering* the system on a real `SystemRegistry`
 *   (the scenario does this, and a `ParticleSystem` that did not satisfy §39
 *   would fail to compile here or throw at registration); and
 * - **the constant**, by comparing `PRIORITY_PARTICLES` against the imported
 *   `PRIORITY_FORCES` — the assertion below is the reason the duplicate is safe
 *   to keep.
 *
 * ## What the golden pins beyond three hashes
 *
 * A hash says "something changed" and nothing else. So the golden also carries
 * five readable counts — spawned, dropped, final live, bounces, peak live —
 * which say *what kind* of change a red test found: a changed emission
 * schedule, a changed capacity policy, a lost collision, or a genuinely
 * different trajectory under the same schedule. The per-step digests localise it
 * to a step.
 *
 * ## The golden file is immutable
 *
 * `golden/phase9.json` is evidence, not configuration. **Never regenerate it to
 * make this test pass.** A mismatch is a real finding: engine behaviour changed
 * between the run that produced the golden and the run under test. The correct
 * response is to identify the change and decide whether it is intended — and
 * only then, as a reviewed and recorded decision (CHANGELOG.md, MEMORY.md),
 * write new values.
 *
 * ## Why the child process runs a `.ts` file directly
 *
 * Identical to every phase before: the in-process and fresh-process runs must
 * execute the same code, so both load `helpers/phase9-scenario.ts` — Vitest
 * through Vite, plain `node` through its default type-stripping (Node ≥ 22.18;
 * this repo pins Node ≥ 20 and runs 22.22). The child is launched with
 * `--input-type=module -e`, importing the helper by absolute `file:` URL, so
 * there is no second runner file to drift out of sync with this one.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PRIORITY_FORCES } from "@fourjs/motion";
import {
  PARTICLE_DRAWS_PER_SPAWN,
  PRIORITY_PARTICLES,
} from "@fourjs/particles";
import { beforeAll, describe, expect, test } from "vitest";

import {
  DRAWS_PER_SPAWN,
  EMITTER,
  FIXED_TIME_STEP,
  PARTICLE_CAPACITY,
  PROBE_STEP_END,
  PROBE_STEP_ONE_SECOND,
  SIMULATED_SECONDS,
  STEP_COUNT,
  runPhase9Scenario,
  type Phase9ScenarioResult,
  type Phase9Summary,
} from "./helpers/phase9-scenario.js";

/** The committed golden, plus the underscore-prefixed prose fields it carries. */
interface GoldenFile extends Phase9Summary {
  _warning: string;
  _scenario: string;
  _tier: string;
}

const GOLDEN_URL = new URL("./golden/phase9.json", import.meta.url);
const HELPER_URL = new URL("./helpers/phase9-scenario.ts", import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const golden = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as GoldenFile;

/** Generous ceiling: one scenario run is well under a second; a cold child adds process start. */
const RUN_TIMEOUT_MS = 120_000;

/**
 * Tolerance for the one comparison that is arithmetic rather than exact: the
 * scheduler's accumulated simulation time against `STEP_COUNT × FIXED_TIME_STEP`.
 *
 * Summing `1/60` six hundred times drifts from the exact quotient by a few ULP
 * of 10. 1e-9 is far above that and eight orders below one fixed step, so it
 * distinguishes "floating-point summation" from "a step was dropped".
 */
const TIME_TOLERANCE = 1e-9;

/**
 * The index of the first differing digest, or `-1` when the two arrays are
 * identical. Reported on failure so a divergence names a step rather than just
 * a mismatched summary hash.
 */
function firstDivergence(a: readonly number[], b: readonly number[]): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    if (a[i] !== b[i]) {
      return i;
    }
  }
  return a.length === b.length ? -1 : shared;
}

/**
 * Runs the scenario in a fresh `node` process and parses what it printed.
 *
 * The child inherits no state from Vitest beyond the environment: no Vite, no
 * transform pipeline, no test globals. It writes exactly one JSON object to
 * stdout; anything on stderr is surfaced in the failure message.
 */
function runScenarioInChildProcess(): Phase9ScenarioResult {
  const source =
    `const scenario = await import(${JSON.stringify(HELPER_URL.href)});\n` +
    `const result = await scenario.runPhase9Scenario();\n` +
    `process.stdout.write(JSON.stringify(result));\n`;

  const child = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", source],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: RUN_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  if (child.error !== undefined) {
    throw new Error(
      `Failed to spawn the fresh-process determinism run: ${child.error.message}`,
    );
  }
  if (child.status !== 0) {
    throw new Error(
      `Fresh-process determinism run exited with status ${String(child.status)} ` +
        `(signal ${String(child.signal)}).\n--- stderr ---\n${child.stderr}\n` +
        `--- stdout ---\n${child.stdout}`,
    );
  }

  return JSON.parse(child.stdout) as Phase9ScenarioResult;
}

describe("Phase 9: particle simulation is deterministic (§112, §36, §33)", () => {
  let first: Phase9ScenarioResult;
  let second: Phase9ScenarioResult;
  let child: Phase9ScenarioResult;

  beforeAll(async () => {
    first = await runPhase9Scenario();
    second = await runPhase9Scenario();
    child = runScenarioInChildProcess();
  }, RUN_TIMEOUT_MS);

  test("the scenario runs the clean 600-step schedule the golden assumes", () => {
    // Guards on the *inputs*. A scenario that quietly stopped stepping, or
    // started dropping time, could otherwise satisfy the digest tests with a
    // degenerate run.
    expect(first.frameCount).toBe(STEP_COUNT);
    expect(first.fixedStepCount).toBe(STEP_COUNT);
    expect(first.digests).toHaveLength(STEP_COUNT);
    expect(first.instanceDigests).toHaveLength(STEP_COUNT);

    // Exactly one fixed step per frame: nothing clamped, nothing dropped, and
    // no partial step left in the accumulator (§9, §10).
    expect(first.droppedTime).toBe(0);
    expect(first.maximumInterpolationAlpha).toBe(0);
    expect(
      Math.abs(first.simulationTime - STEP_COUNT * FIXED_TIME_STEP),
    ).toBeLessThanOrEqual(TIME_TOLERANCE);
    expect(STEP_COUNT * FIXED_TIME_STEP).toBeCloseTo(SIMULATED_SECONDS, 9);

    // §42: nothing fought over a transform. The particle system writes no node
    // transform at all — it writes pool channels — so this is a measured zero
    // rather than a hopeful one.
    expect(first.authorityWarningCount).toBe(0);

    // Exactly one system registered: the §39 order is not in question here, but
    // a second system appearing would change what a step means.
    expect(first.registeredSystemCount).toBe(1);

    // Not a stuck pool: every step's state is distinct.
    expect(new Set(first.digests).size).toBe(STEP_COUNT);
    expect(new Set(first.instanceDigests).size).toBe(STEP_COUNT);
  });

  test("ParticleSystem is a real §39 system at PRIORITY_FORCES (cross-package)", () => {
    // The check the packages cannot make about each other — see this file's
    // header. `PRIORITY_PARTICLES` is `@fourjs/particles`'s restatement of
    // `@fourjs/motion`'s `PRIORITY_FORCES`; if the original ever moves, this
    // fails here rather than silently reordering a simulation.
    expect(PRIORITY_PARTICLES).toBe(PRIORITY_FORCES);
    expect(first.particlePriority).toBe(PRIORITY_FORCES);
    expect(first.forcesPriority).toBe(PRIORITY_FORCES);

    // §39 step 5 sits after animation (300) and kinematics (400) and before the
    // physics solve (600) — the ordering `particle-system.ts` documents.
    expect(PRIORITY_PARTICLES).toBeGreaterThan(400);
    expect(PRIORITY_PARTICLES).toBeLessThan(600);

    // The scenario registered the system on a real `SystemRegistry` and the
    // registry stepped it 600 times; that is the assignability check.
    expect(first.fixedStepCount).toBe(STEP_COUNT);
  });

  test("the run exercises what §36 and §27 asked it to", () => {
    // Evidence that the digests are over the scenario §112/P9-4 describes,
    // rather than over a hash of an emitter that never emitted.
    const start = first.atOneSecond;
    const end = first.atEnd;

    // The pool saturated and stayed saturated: this is what makes
    // `maxParticles` part of the determinism contract (see `emitter.ts`).
    expect(first.summary.peakAliveCount).toBe(PARTICLE_CAPACITY);
    expect(end.aliveCount).toBe(PARTICLE_CAPACITY);
    expect(first.summary.droppedCount).toBeGreaterThan(0);

    // Emission ran throughout, not only as the opening burst.
    expect(start.emittedCount).toBeGreaterThan(EMITTER.burstCount);
    expect(end.emittedCount).toBeGreaterThan(start.emittedCount);

    // §36 collision, MVP tier: particles really reached the plane and were
    // really projected onto it.
    expect(first.summary.bounceCount).toBeGreaterThan(0);

    // §33: the seeded stream advanced by exactly four draws per *successful*
    // spawn — dropped spawns consume none, which is the clause `emitter.ts`
    // pins and the reason capacity is part of the contract.
    expect(DRAWS_PER_SPAWN).toBe(PARTICLE_DRAWS_PER_SPAWN);
    expect(first.randomStreamPosition).toBe(
      first.summary.emittedCount * PARTICLE_DRAWS_PER_SPAWN,
    );

    // The §36 ramps moved: a probe particle's drawn size is strictly inside its
    // start/end endpoints, and its alpha has come off 1.
    const sample = start.particles[0];
    expect(start.particles.length).toBeGreaterThan(0);
    expect(sample.size).toBeLessThan(EMITTER.size.start);
    expect(sample.size).toBeGreaterThan(EMITTER.size.end);
    expect(sample.color[3]).toBeLessThan(1);
    expect(sample.color[3]).toBeGreaterThan(0);

    // Lifetimes came out of the authored range, and ages are inside them.
    expect(sample.lifetime).toBeGreaterThanOrEqual(EMITTER.lifetime.min);
    expect(sample.lifetime).toBeLessThanOrEqual(EMITTER.lifetime.max);
    expect(sample.age).toBeLessThan(sample.lifetime);

    // The probes really are the steps they claim to be.
    expect(PROBE_STEP_ONE_SECOND).toBe(60);
    expect(PROBE_STEP_END).toBe(STEP_COUNT);
  });

  test("two in-process runs produce identical digests and samples", () => {
    expect(firstDivergence(first.digests, second.digests)).toBe(-1);
    expect(firstDivergence(first.instanceDigests, second.instanceDigests)).toBe(
      -1,
    );
    expect(second.summary).toEqual(first.summary);
    expect(second.atOneSecond).toEqual(first.atOneSecond);
    expect(second.atEnd).toEqual(first.atEnd);
    expect(second.randomStreamPosition).toBe(first.randomStreamPosition);
    expect(second.fixedStepCount).toBe(first.fixedStepCount);
    expect(second.droppedTime).toBe(first.droppedTime);
  });

  test("the in-process run matches the committed golden", () => {
    // If this fails: DO NOT edit golden/phase9.json. See this file's header.
    expect(first.summary.firstStepDigest).toBe(golden.firstStepDigest);
    expect(first.summary.lastStepDigest).toBe(golden.lastStepDigest);
    expect(first.summary.summaryDigest).toBe(golden.summaryDigest);

    // The readable half of the golden: not "the hash matches" but "727 spawned,
    // 213 dropped, 100 alive at the end, 395 plane contacts".
    expect(first.summary.emittedCount).toBe(golden.emittedCount);
    expect(first.summary.droppedCount).toBe(golden.droppedCount);
    expect(first.summary.finalAliveCount).toBe(golden.finalAliveCount);
    expect(first.summary.bounceCount).toBe(golden.bounceCount);
    expect(first.summary.peakAliveCount).toBe(golden.peakAliveCount);

    // The published probes really are the digests they claim to be.
    expect(first.digests[0]).toBe(first.summary.firstStepDigest);
    expect(first.digests[STEP_COUNT - 1]).toBe(first.summary.lastStepDigest);
  });

  test("a fresh node process reproduces the same digests and the golden", () => {
    expect(firstDivergence(child.digests, first.digests)).toBe(-1);
    expect(firstDivergence(child.instanceDigests, first.instanceDigests)).toBe(
      -1,
    );
    expect(child.summary).toEqual(first.summary);
    expect(child.summary.summaryDigest).toBe(golden.summaryDigest);
    expect(child.summary.firstStepDigest).toBe(golden.firstStepDigest);
    expect(child.summary.lastStepDigest).toBe(golden.lastStepDigest);

    // The child ran the same simulation, not just the same hash.
    expect(child.atOneSecond).toEqual(first.atOneSecond);
    expect(child.atEnd).toEqual(first.atEnd);
    expect(child.fixedStepCount).toBe(first.fixedStepCount);
    expect(child.droppedTime).toBe(first.droppedTime);
    expect(child.authorityWarningCount).toBe(0);
    expect(child.particlePriority).toBe(first.particlePriority);
  });

  test("the golden file carries its immutability warning and tier", () => {
    expect(golden._warning).toMatch(/DO NOT REGENERATE/i);
    expect(golden._tier).toMatch(/same-runtime/i);
    expect(golden._scenario.length).toBeGreaterThan(0);
  });
});
