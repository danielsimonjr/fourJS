/**
 * The shared benchmark runner (§92 performance tests, §86 targets; plan §6j,
 * P11-4, WP-11.4).
 *
 * ```sh
 * bun run build               # every script here imports the built dist
 * node benchmarks/harness.mjs  # prints the suite index and how to run it
 * ```
 *
 * `benchmarks/particles-100k.mjs` (WP-9.4) was the first script in this
 * directory and deliberately shipped without a framework — plan §6h's note that
 * *"a harness designed around one script is a harness designed around
 * nothing"*. Phase 11 has four more scripts to write, so the shape that script
 * arrived at is extracted here **unchanged in substance**: warm up, measure a
 * fixed number of iterations, reduce the durations to order statistics, stamp
 * the host, write one JSON record per benchmark, print a human report.
 *
 * This module is that extraction and nothing more. It adds no dependency, no
 * configuration file, no CLI framework, and no scheduling: a benchmark here is
 * still a plain `node` script that happens to import six small functions.
 *
 * ## What this harness is not
 *
 * **It is not a gate.** Nothing in CI asserts on a timing produced through it,
 * and {@link MEASUREMENT_NOTE} is written into every record so a reader who
 * finds one of these files out of context is told so on the first line. The
 * reasons are in `benchmarks/README.md`: CI containers are shared, have no GPU,
 * and vary run to run by tens of percent, so a wall-clock assertion would be a
 * flake generator that also happens to be dishonest about what it proves.
 *
 * **It is not a statistical package.** It reports mean, median, p95, p99, min
 * and max over the raw per-iteration durations, by nearest rank — every printed
 * number is a duration some iteration actually took, never an interpolation
 * between two of them. There is no outlier rejection: on a shared host the
 * outliers *are* the finding.
 *
 * ## Wall clocks: measurement, never simulation (plan §1 ground rule)
 *
 * `performance.now()` appears in {@link measure} and must appear nowhere else
 * in a benchmark. It is a **measurement instrument**: nothing it returns is fed
 * back into an engine call. Every script here drives simulation with a constant
 * injected delta (§10, §33) exactly as `Application`'s fixed-step accumulator
 * would, so deleting every timer from a benchmark must leave the simulated
 * result bit-identical. The ISO timestamp {@link hostRecord} does not carry —
 * `recordedAt` is written by each script from `new Date()` — dates the record
 * and likewise never enters a run.
 *
 * ## The two-file contract of a benchmark
 *
 * A script owns its scenario, its constants and its record's domain fields; the
 * harness owns the timing loop, the statistics, the host block and the writer.
 * A record is therefore `{ _note, benchmark, specification, recordedAt, …the
 * script's own fields…, ...hostRecord(), hostCaveat }` — the host block last,
 * because it is the part a reader must check before quoting anything above it.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

/** This directory, resolved from this file rather than from `process.cwd()`. */
const BENCHMARKS_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * The `_note` every record carries, verbatim.
 *
 * It exists because a JSON file travels: pasted into an issue, diffed in a
 * review, or read a year later, a record has to say what it is without its
 * README. Scripts with more to say (the particle script's §112 caveat, for
 * instance) append to it rather than replacing it.
 */
export const MEASUREMENT_NOTE =
  "Recorded measurement, not a gate. Nothing in CI asserts on these timings; see benchmarks/README.md for how the numbers are to be read and why this host is not 'suitable hardware'.";

/**
 * The suite, in the order `benchmarks/README.md` documents it and
 * `run-all.mjs` runs it.
 *
 * Exported because there must be exactly one list: `node benchmarks/harness.mjs`
 * prints it as the index, and the runner drives it. A script that exists in the
 * tree and not here is one nobody runs, which is why the runner checks the two
 * against each other rather than trusting either (2026-08-08, A-27).
 *
 * `record` is the `results/<record>.json` each script writes — spelled out
 * rather than derived from the filename, because the two are related only by
 * each script's own `writeResult` call.
 */
export const SUITE = Object.freeze(
  [
    {
      file: "shader-uniform-block.mjs",
      record: "shader-uniform-block",
      what: "RFC 0001 std140 upload-call and byte comparison",
    },
    {
      file: "text-shaping-init.mjs",
      record: "text-shaping-init",
      what: "RFC 0008 wasm initialization and warm shaping",
    },
    {
      file: "path-planning.mjs",
      record: "path-planning",
      what: "RFC 0007 waypoint A* on open and serpentine 256x256 graphs",
    },
    {
      file: "math-ops.mjs",
      record: "math-ops",
      what: "§7b math throughput and per-op allocation (§83, §92)",
    },
    {
      file: "scene-propagation.mjs",
      record: "scene-propagation",
      what: "§7 world-transform resolution over deep+wide trees",
    },
    {
      file: "physics-step.mjs",
      record: "physics-step",
      what: "§86's 5 000-rigid-body row, stepped through Rapier 3D",
    },
    {
      file: "animation-sampling.mjs",
      record: "animation-sampling",
      what: "§17 mixer sampling of a multi-track clip at N instances",
    },
    {
      file: "particles-100k.mjs",
      record: "particles-100k",
      what: "§112's 100 000-particle CPU budget (WP-9.4)",
    },
    {
      file: "ui-layout.mjs",
      record: "ui-layout",
      what: "§86's 5 000-retained-UI-node row, layout-and-state half",
    },
    {
      file: "text-layout.mjs",
      record: "text-layout",
      what: "§86's 20 000-animated-glyph row, layout half",
    },
    {
      file: "geometry-updates.mjs",
      record: "geometry-updates",
      what: "§53 dynamic geometry uploads: GL call/object counts and CPU preparation",
    },
    {
      file: "render-batching.mjs",
      record: "render-batching",
      what: "§86's batched-sprite and batched-shape rows, preparation half",
    },
    {
      file: "view-culling.mjs",
      record: "view-culling",
      what: "§64's per-view lists and §87's frustum cull, preparation half",
    },
    {
      file: "skinning-resolve.mjs",
      record: "skinning-resolve",
      what: "RFC 0003 bones-as-nodes resolve (60 ×1/×10) and 180-channel controller vs mixer",
    },
    {
      file: "pick-latency.mjs",
      record: "pick-latency",
      what: "RFC 0005 id-pass cost vs the flagship/R-8 list and fence-vs-stall pick latency",
    },
  ].map((entry) => Object.freeze(entry)),
);

/**
 * Rounds to `digits` decimals, so a record is readable and its `git diff` is
 * about the measurement rather than about float formatting.
 */
export function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/** Arithmetic mean of an array-like of numbers. */
export function mean(values) {
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    total += values[i];
  }
  return total / values.length;
}

/**
 * The `q`-quantile by **nearest rank** over an already-sorted array-like.
 *
 * `p95` of 600 samples is "the 570th slowest", an observed duration and not an
 * interpolation between two of them. Interpolating would invent a duration no
 * iteration actually took, which is the wrong thing to print next to a budget.
 */
export function quantile(sorted, q) {
  const rank = Math.ceil(q * sorted.length);
  const index = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[index];
}

/**
 * Reduces per-iteration durations (milliseconds) to the order statistics every
 * record in this directory publishes.
 *
 * The input is copied before sorting, so a caller may keep and re-read its own
 * durations array afterwards.
 *
 * @param durations per-iteration milliseconds, in iteration order
 * @returns `{ samples, meanMs, medianMs, p95Ms, p99Ms, minMs, maxMs }`
 */
export function summarize(durations) {
  if (durations.length === 0) {
    throw new Error("summarize: no samples");
  }
  const sorted = Float64Array.from(durations).sort();
  return {
    samples: sorted.length,
    meanMs: mean(durations),
    medianMs: quantile(sorted, 0.5),
    p95Ms: quantile(sorted, 0.95),
    p99Ms: quantile(sorted, 0.99),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
  };
}

/**
 * Rounds a {@link summarize} result into the `…MsPer<unit>` fields a record
 * publishes, so five scripts spell the same six statistics the same way.
 *
 * @param summary a {@link summarize} result
 * @param unit singular name of one iteration — `"Step"`, `"Batch"`, `"Pass"`
 * @param digits decimals to keep (default 4, the particle script's precedent)
 */
/** @returns {Record<string, number>} keys are `<stat><unit>`, built dynamically */
export function summaryFields(summary, unit, digits = 4) {
  return {
    [`meanMsPer${unit}`]: round(summary.meanMs, digits),
    [`medianMsPer${unit}`]: round(summary.medianMs, digits),
    [`p95MsPer${unit}`]: round(summary.p95Ms, digits),
    [`p99MsPer${unit}`]: round(summary.p99Ms, digits),
    [`minMsPer${unit}`]: round(summary.minMs, digits),
    [`maxMsPer${unit}`]: round(summary.maxMs, digits),
  };
}

/**
 * Runs `iteration` `warmupIterations + measuredIterations` times, timing each
 * call, and returns the two runs' durations separately.
 *
 * `iteration` receives a **globally monotonic index**, warm-up included, so a
 * script that derives simulation time from the index (`(index + 1) * dt`)
 * produces exactly the sequence an uninterrupted run would — the warm-up is
 * part of the simulation, only its timings are reported apart.
 *
 * `options.prepare(index)` — optional — runs immediately before each iteration
 * and **outside the clock**. It exists for benchmarks whose subject needs a
 * particular state set up per iteration (marking a scene dirty, re-arming a
 * pool) where that setup is emphatically not the thing being measured. Folding
 * it into `iteration` would silently add it to every reported duration.
 *
 * Warm-up is reported rather than discarded silently. The gap between the two
 * means *is* V8's optimisation cost, and hiding it would misattribute a slow
 * first second to the code under test.
 *
 * The durations arrays are preallocated and the clock is read immediately
 * around the call, so the measurement does not measure its own bookkeeping.
 *
 * @param iteration `(index: number) => void`, one unit of work
 * @param options `{ warmupIterations = 0, measuredIterations, prepare? }`
 * @returns `{ warmup, measured }`, both `Float64Array` of milliseconds
 */
export function measure(iteration, options) {
  const warmupIterations = options.warmupIterations ?? 0;
  const measuredIterations = options.measuredIterations;
  const prepare = options.prepare;
  if (!Number.isInteger(measuredIterations) || measuredIterations < 1) {
    throw new Error(
      `measure: measuredIterations must be a positive integer, got ${measuredIterations}`,
    );
  }
  if (!Number.isInteger(warmupIterations) || warmupIterations < 0) {
    throw new Error(
      `measure: warmupIterations must be a non-negative integer, got ${warmupIterations}`,
    );
  }

  const warmup = new Float64Array(warmupIterations);
  const measured = new Float64Array(measuredIterations);
  let index = 0;

  for (let i = 0; i < warmupIterations; i += 1, index += 1) {
    if (prepare !== undefined) {
      prepare(index);
    }
    const began = performance.now();
    iteration(index);
    warmup[i] = performance.now() - began;
  }
  for (let i = 0; i < measuredIterations; i += 1, index += 1) {
    if (prepare !== undefined) {
      prepare(index);
    }
    const began = performance.now();
    iteration(index);
    measured[i] = performance.now() - began;
  }
  return { warmup, measured };
}

/** Module-level accumulator behind {@link keepAlive}. */
let keptAlive = 0;

/**
 * Folds `value` into a module-level accumulator so the optimiser cannot decide
 * a measured computation is unobserved and delete it.
 *
 * Micro-benchmarks are the one place where dead-code elimination silently turns
 * a measurement into a measurement of nothing. Reading the result through a
 * cross-module function whose accumulator is printed at the end of the run
 * makes the work observable. It is deliberately cheap — one add — and the
 * printed total is not a checksum and carries no meaning beyond "the work
 * happened".
 */
export function keepAlive(value) {
  keptAlive += value;
  if (!Number.isFinite(keptAlive)) {
    keptAlive = 0;
  }
}

/** The {@link keepAlive} accumulator, for a script's closing line. */
export function keepAliveTotal() {
  return keptAlive;
}

/**
 * The host block every record ends with: what machine produced the numbers
 * above it.
 *
 * Quoting a benchmark number without its host is a misquote, so these fields
 * are not optional and not abbreviated. They are returned as a fresh object for
 * spreading last into a record.
 */
export function hostRecord() {
  const host = cpus();
  return {
    hostNode: process.version,
    hostPlatform: `${process.platform} ${process.arch}`,
    hostCpuModel: host.length > 0 ? host[0].model : "unknown",
    hostCpuCount: host.length,
    hostTotalMemoryGb: round(totalmem() / 1024 ** 3, 1),
  };
}

/** Absolute path of the committed record for benchmark `name`. */
export function resultsPath(name) {
  return join(BENCHMARKS_DIR, "results", `${name}.json`);
}

/**
 * Writes `record` to `results/<name>.json` — two-space JSON with a trailing
 * newline, the format the committed records already use — and returns the path.
 *
 * `results/` is committed (`.gitignore` does not cover it), so a run's diff is
 * the honest way to see what changed and on which host. Re-running a script
 * rewrites its record; that is intended, and the host fields are what let a
 * reader tell "today's measurement on this machine" from "a measurement moved
 * to a different machine".
 */
export function writeResult(name, record) {
  const path = resultsPath(name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return path;
}

/**
 * Writes `lines` to stdout, newline-separated, with a trailing newline.
 *
 * Reports here are plain aligned text on purpose: they are read in a terminal
 * and pasted into issues, and the machine-readable copy is the JSON record.
 */
export function printReport(lines) {
  process.stdout.write(`${lines.join("\n")}\n`);
}

/**
 * The six statistics as report lines, aligned to the column the scripts use.
 *
 * @param summary a {@link summarize} result
 * @param unit what one iteration is, for the unit suffix — `"step"`, `"batch"`
 * @param digits decimals to print (default 4)
 */
export function summaryLines(summary, unit, digits = 4) {
  return [
    `  mean                    ${round(summary.meanMs, digits)} ms/${unit}`,
    `  median                  ${round(summary.medianMs, digits)} ms/${unit}`,
    `  p95                     ${round(summary.p95Ms, digits)} ms/${unit}`,
    `  p99                     ${round(summary.p99Ms, digits)} ms/${unit}`,
    `  min / max               ${round(summary.minMs, digits)} / ${round(summary.maxMs, digits)} ms/${unit}`,
  ];
}

/**
 * The host and caveat report lines every script closes with.
 *
 * @param host a {@link hostRecord} result
 * @param caveat the script's own one-line caveat, already written for stdout
 */
export function hostLines(host, caveat) {
  return [
    `  host                    ${host.hostCpuModel} × ${host.hostCpuCount}, node ${host.hostNode}, ${host.hostPlatform}`,
    `  caveat                  ${caveat}`,
    "                          Recorded, never gated — see benchmarks/README.md.",
  ];
}

/** The text `node benchmarks/harness.mjs` prints. */
function usage() {
  const width = Math.max(...SUITE.map((entry) => entry.file.length));
  return [
    "fourJS benchmark harness (§92 performance tests, §86 targets; plan §6j, WP-11.4)",
    "",
    "  This file is a library, not a runner: it has no scheduler and runs nothing.",
    "  Each benchmark is a standalone Node script that imports it.",
    "",
    "  Build first — every script imports the built dist, not src:",
    "",
    "    bun run build",
    "",
    "  Then run the whole suite,",
    "",
    "    bun run bench                 # node benchmarks/run-all.mjs",
    "",
    "  or one script at a time:",
    "",
    ...SUITE.map(
      (entry) =>
        `    node benchmarks/${entry.file.padEnd(width)}   ${entry.what}`,
    ),
    "",
    "  Each writes benchmarks/results/<name>.json, which is committed. Every number",
    "  describes the machine that produced it and is recorded, never gated: nothing",
    "  in CI asserts on a timing here. See benchmarks/README.md.",
    "",
    "  Exports: SUITE, measure (warmup/measured, optional untimed prepare), summarize,",
    "           summaryFields, summaryLines, mean, quantile,",
    "           round, hostRecord, hostLines, writeResult, resultsPath, printReport,",
    "           keepAlive, keepAliveTotal, MEASUREMENT_NOTE",
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  printReport(usage());
}
