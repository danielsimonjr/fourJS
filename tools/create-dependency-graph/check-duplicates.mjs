#!/usr/bin/env node
// check:duplicates — prevention gate for the CDG duplicate-symbols campaign.
//
// By default, regenerates the duplicate-symbol analysis (via
// create-dependency-graph.ts, the same generator `docs:deps` runs) and fails
// if any TRUE_DUPLICATE name exists beyond
// docs/Architecture/duplicate-baseline.json — the campaign's accepted,
// shrinking backlog. New unauthorized duplicates can't accumulate;
// consolidating an existing one and re-running
// `node tools/create-dependency-graph/gen-duplicate-baseline.mjs` shrinks the
// baseline.
//
// Wired into the pre-commit hook via `--no-regen` (see `check:duplicates:fast`
// in package.json / .husky/pre-commit): the hook's `precommit:refresh` step
// already regenerates docs/Architecture/duplicate-symbols.json as a side
// effect of `docs:deps` whenever a commit touches package `src/`, so this flag
// skips the (redundant, ~9min-if-it-also-rebuilt-wasm) regen and just reads
// that already-fresh report — the gate then adds only the JSON-diff cost
// (well under a second). Run WITHOUT `--no-regen` manually or from CI when you
// want a self-contained, always-fresh check.
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT_DIR = process.cwd();
const SKIP_REGEN = process.argv.includes("--no-regen");

// Fixed literal command — no user input is ever interpolated into it, so
// there is no shell-injection surface here. `shell` is required regardless
// because `npx` is a `.cmd` shim on Windows (Node cannot exec `.cmd`/`.bat`
// files without a shell — see Node docs on child_process on Windows); passing
// an argv ARRAY through `shell: true` instead (execFileSync) triggers Node's
// DEP0190 (args aren't escaped when a shell is involved), so this uses a
// single pre-built string with execSync instead, which is the documented-safe
// shape for that combination.
const REGEN_COMMAND =
  "npx tsx tools/create-dependency-graph/create-dependency-graph.ts --root=.";

function regenerateDuplicateSymbols() {
  execSync(REGEN_COMMAND, { cwd: ROOT_DIR, stdio: "pipe" });
}

function readJson(relPath) {
  return JSON.parse(readFileSync(join(ROOT_DIR, relPath), "utf-8"));
}

/** New TRUE_DUPLICATE names in `current` (kind => name => files) not present
 *  in `baseline` (kind => name => files). Returns a flat list of findings. */
function diffNewDuplicates(current, baseline) {
  const findings = [];
  for (const kind of ["runtime", "types"]) {
    const currentNames = current[kind] ?? {};
    const baselineNames = baseline[kind] ?? {};
    for (const [name, files] of Object.entries(currentNames)) {
      if (!(name in baselineNames)) {
        findings.push({ kind, name, files });
      }
    }
  }
  return findings;
}

function main() {
  if (SKIP_REGEN) {
    console.log(
      "check:duplicates --no-regen — reading existing duplicate-symbol analysis...",
    );
  } else {
    console.log("check:duplicates — regenerating duplicate-symbol analysis...");
    try {
      regenerateDuplicateSymbols();
    } catch (err) {
      console.error(
        "Failed to regenerate docs/Architecture/duplicate-symbols.json:",
      );
      console.error(err.message);
      process.exit(1);
    }
  }

  const report = readJson("docs/Architecture/duplicate-symbols.json");
  const baseline = readJson("docs/Architecture/duplicate-baseline.json");

  const current = {
    runtime: Object.fromEntries(
      report.runtime
        .filter((e) => e.tag === "TRUE_DUPLICATE")
        .map((e) => [e.name, e.definers.map((d) => d.file).sort()]),
    ),
    types: Object.fromEntries(
      report.types
        .filter((e) => e.tag === "TRUE_DUPLICATE")
        .map((e) => [e.name, e.definers.map((d) => d.file).sort()]),
    ),
  };

  const newDuplicates = diffNewDuplicates(current, baseline);

  const currentTotal =
    Object.keys(current.runtime).length + Object.keys(current.types).length;
  const baselineTotal =
    Object.keys(baseline.runtime ?? {}).length +
    Object.keys(baseline.types ?? {}).length;

  if (newDuplicates.length > 0) {
    console.error("");
    console.error(
      `FAIL: ${newDuplicates.length} new TRUE_DUPLICATE name(s) not in docs/Architecture/duplicate-baseline.json:`,
    );
    for (const f of newDuplicates) {
      console.error("");
      console.error(`  [${f.kind}] ${f.name}`);
      for (const file of f.files) console.error(`    - ${file}`);
      console.error(
        `    A new own-definition of \`${f.name}\` was added in >=2 files. Reuse the existing ` +
          `canonical definition (see the file list above; prefer the one already public/exported ` +
          `from a package's src/index.ts) instead of adding a new independent body. If this is ` +
          `legitimately independent (e.g. a hot-path guard, an AssemblyScript mirror, or a ` +
          `per-package VERSION string), add it to tools/create-dependency-graph/duplicate-allowlist.json ` +
          `instead. If it's an accepted new item in the consolidation backlog, re-run ` +
          `\`node tools/create-dependency-graph/gen-duplicate-baseline.mjs\` after review.`,
      );
    }
    console.error("");
    console.error(
      `check:duplicates: FAILED (${currentTotal} current TRUE_DUPLICATE vs ${baselineTotal} baselined)`,
    );
    process.exit(1);
  }

  console.log(
    `check:duplicates: PASSED (${currentTotal} current TRUE_DUPLICATE, ` +
      `${baselineTotal} baselined, 0 new)`,
  );
}

main();
