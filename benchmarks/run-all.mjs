/**
 * The suite runner — every benchmark in `harness.mjs`'s `SUITE`, in order, each
 * in its own process, and one combined record (§86 targets, §92 performance
 * tests; A-27).
 *
 * ```sh
 * bun run build       # every script imports the built dist, not src
 * bun run bench           # this file
 * bun run bench ui-layout text-layout      # a subset, by record name or filename
 * bun run bench --list                     # what would run, and in what order
 * ```
 *
 * ## Why a process each
 *
 * Every script here is a program with top-level side effects, its own warm-up
 * discipline and its own JIT profile. Importing them into one process would let
 * the first script's optimisation pay for the second's, let one script's heap
 * decide another's GC pauses, and let a `RangeError` in one delete the whole
 * run's records. A child process per script costs about 100 ms of Node start-up
 * and buys independence, which is the right trade for numbers that are read
 * against each other.
 *
 * Their stdio is **inherited**, so each script's own report prints as it runs.
 * The runner adds a summary at the end and takes nothing away.
 *
 * ## Still not a gate
 *
 * This runner asserts on **no timing whatsoever**, and adding one would be the
 * back door `benchmarks/README.md` forbids. Its exit code reports one thing: a
 * script that **failed** — a non-zero exit, which for these scripts means a
 * structural assertion tripped (a scene that did not resolve, a mixer that
 * stopped, a corpus that drew the wrong number of quads) or the build was not
 * run. A benchmark that got slower is a finding for a reader; a benchmark that
 * threw is a broken benchmark, and those are different things.
 *
 * ## The combined record
 *
 * `results/suite.json` is a **manifest, not a summary**: which scripts ran,
 * whether each succeeded, how long each took in wall-clock seconds, and the
 * `benchmark`/`recordedAt` of the record each one wrote. It deliberately copies
 * no measurement out of those records — one number in two files is one number
 * that can disagree with itself. To read a result, read its own record; to know
 * whether a whole suite ran on one host on one day, read this.
 *
 * `wallSeconds` is **not a measurement of the code under test**: it includes
 * Node start-up, module loading of the built `dist`, scenario construction, and
 * every warm-up. It is here so a reader knows what running the suite costs and
 * can see when one script's share changes.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MEASUREMENT_NOTE,
  SUITE,
  hostLines,
  hostRecord,
  printReport,
  resultsPath,
  round,
  writeResult,
} from "./harness.mjs";

/** This directory, resolved from this file rather than from `process.cwd()`. */
const BENCHMARKS_DIR = dirname(fileURLToPath(import.meta.url));

/** Files in this directory that are not benchmarks, for the drift check below. */
const NOT_BENCHMARKS = new Set(["harness.mjs", "run-all.mjs"]);

/**
 * Fails if a `*.mjs` in this directory is missing from {@link SUITE}.
 *
 * The index exists so that "run the suite" and "the scripts in the tree" are
 * the same set. Nothing else enforces that, and a benchmark nobody runs is a
 * benchmark nobody maintains — so the runner refuses to start rather than
 * silently skipping one.
 */
function assertSuiteCoversTree() {
  const known = new Set(SUITE.map((entry) => entry.file));
  const orphans = readdirSync(BENCHMARKS_DIR)
    .filter(
      (name) =>
        name.endsWith(".mjs") && !NOT_BENCHMARKS.has(name) && !known.has(name),
    )
    .sort();
  if (orphans.length > 0) {
    throw new Error(
      `run-all: ${orphans.join(", ")} ${orphans.length === 1 ? "is" : "are"} in benchmarks/ but not in harness.mjs's SUITE. ` +
        "Add an entry there (file, record, what) so the index, the README table and this runner agree.",
    );
  }
}

/** `--list`/`--help` text, and the selection rules. */
function usage() {
  const width = Math.max(...SUITE.map((entry) => entry.file.length));
  return [
    "fourJS benchmark suite runner (§86 targets, §92 performance tests)",
    "",
    "  bun run build          # required: every script imports the built dist",
    "  bun run bench              # the whole suite, in this order:",
    "",
    ...SUITE.map(
      (entry) =>
        `    ${entry.file.padEnd(width)}   ${entry.what}\n    ${" ".repeat(width)}   → results/${entry.record}.json`,
    ),
    "",
    "  bun run bench <name>…      # a subset, named by record ('ui-layout') or file",
    "  bun run bench --list       # this text",
    "",
    "  Each script runs in its own process, prints its own report, and rewrites its",
    "  own committed record. The runner writes results/suite.json — a manifest of what",
    "  ran, not a copy of any measurement — and asserts on no timing at all: it exits",
    "  non-zero only when a script itself failed. See benchmarks/README.md.",
  ];
}

/** Resolves the command line to the entries to run, in {@link SUITE} order. */
function select(argv) {
  if (argv.length === 0) return SUITE;
  const wanted = new Set(argv.map((name) => name.replace(/\.mjs$/, "")));
  const chosen = SUITE.filter(
    (entry) =>
      wanted.has(entry.record) || wanted.has(entry.file.replace(/\.mjs$/, "")),
  );
  const matched = new Set(
    chosen.flatMap((entry) => [entry.record, entry.file.replace(/\.mjs$/, "")]),
  );
  const unknown = [...wanted]
    .filter((name) => !matched.has(name))
    .sort((a, b) => a.localeCompare(b));
  if (unknown.length > 0) {
    throw new Error(
      `run-all: no benchmark named ${unknown.join(", ")}. Run 'bun run bench --list' for the suite.`,
    );
  }
  return chosen;
}

/** The `benchmark` and `recordedAt` a script wrote, or `null` if it wrote none. */
function readRecordStamp(name) {
  const path = resultsPath(name);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return {
      benchmark: parsed.benchmark ?? null,
      recordedAt: parsed.recordedAt ?? null,
    };
  } catch (cause) {
    // A record that does not parse is worth reporting, not worth aborting on:
    // the run happened, and the summary should say which file is unreadable.
    return { benchmark: null, recordedAt: null, unreadable: String(cause) };
  }
}

// --- the run -----------------------------------------------------------------

const argv = process.argv.slice(2);
if (argv.includes("--list") || argv.includes("--help") || argv.includes("-h")) {
  printReport(usage());
  process.exit(0);
}

/**
 * Selection and index errors are the operator's mistakes, not the engine's, so
 * they get one readable line and exit 2 rather than a stack trace. Exit 2 keeps
 * them distinct from exit 1, which means *a benchmark failed* — the only thing
 * this runner's non-zero status is otherwise allowed to say.
 */
let entries;
try {
  assertSuiteCoversTree();
  entries = select(argv);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(2);
}

printReport([
  `fourJS — running ${entries.length} benchmark${entries.length === 1 ? "" : "s"}, one process each.`,
  "Recorded, never gated: no timing below is asserted on. See benchmarks/README.md.",
  "",
]);

const suiteBegan = process.hrtime.bigint();
const results = [];

for (const entry of entries) {
  const began = process.hrtime.bigint();
  const child = spawnSync(
    process.execPath,
    [join(BENCHMARKS_DIR, entry.file)],
    {
      stdio: "inherit",
    },
  );
  const wallMs = Number(process.hrtime.bigint() - began) / 1e6;
  const failure =
    child.error !== undefined
      ? String(child.error)
      : child.signal !== null
        ? `killed by ${child.signal}`
        : null;
  results.push({
    script: entry.file,
    record: entry.record,
    status: failure === null && child.status === 0 ? "ok" : "failed",
    exitCode: child.status,
    failure,
    wallSeconds: round(wallMs / 1000, 2),
    wrote:
      failure === null && child.status === 0
        ? readRecordStamp(entry.record)
        : null,
  });
  printReport([""]);
}

const totalWallMs = Number(process.hrtime.bigint() - suiteBegan) / 1e6;
const failed = results.filter((result) => result.status !== "ok");

// --- the record --------------------------------------------------------------

const host = hostRecord();
const record = {
  _note: MEASUREMENT_NOTE,
  benchmark: "suite",
  specification: "§86 (performance targets), §92 (performance tests); A-27",
  recordedAt: new Date().toISOString(),
  runner: "node benchmarks/run-all.mjs",
  manifestNote:
    "A manifest of what ran, not a summary of what was measured: no number is copied out of a script's own record, because one number in two files is one number that can disagree with itself. Read results/<name>.json for a result.",
  wallSecondsNote:
    "Wall-clock per child process. NOT a measurement of the code under test: it includes Node start-up, loading the built dist, scenario construction and every warm-up.",
  scriptsRequested: entries.length,
  scriptsInSuite: SUITE.length,
  scriptsFailed: failed.length,
  totalWallSeconds: round(totalWallMs / 1000, 2),
  scripts: results,
  ...host,
  hostCaveat:
    "CI container, no GPU, shared host. Every script's own record carries the same host block and its own caveat; this file records only that they ran together, here, on this date.",
};

const path = writeResult("suite", record);

// --- the report --------------------------------------------------------------

const width = Math.max(...results.map((result) => result.script.length));
printReport([
  "fourJS — benchmark suite summary (§86 targets, §92 performance tests)",
  "",
  ...results.map((result) =>
    [
      `  ${result.script.padEnd(width)}`,
      `  ${result.status === "ok" ? "ok    " : "FAILED"}`,
      `  ${String(result.wallSeconds).padStart(7)} s wall`,
      result.wrote?.recordedAt !== undefined &&
      result.wrote?.recordedAt !== null
        ? `   results/${result.record}.json @ ${result.wrote.recordedAt}`
        : `   ${result.failure ?? `exit ${result.exitCode}`}`,
    ].join(""),
  ),
  "",
  `  total                   ${round(totalWallMs / 1000, 2)} s wall for ${results.length} script${results.length === 1 ? "" : "s"} (start-up and warm-up included; not a measurement)`,
  `  failures                ${failed.length}`,
  "",
  ...hostLines(
    host,
    "shared CI container; the runner asserts on no timing — a non-zero exit means a script failed, never that one got slower.",
  ),
  "",
  `  written                 ${path}`,
]);

if (failed.length > 0) {
  process.exitCode = 1;
}
