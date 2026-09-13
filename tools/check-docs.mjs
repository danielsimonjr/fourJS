#!/usr/bin/env node
// Mechanical doc-truth checks for the repository's prose.
// Usage: node tools/check-docs.mjs   (exit 0 = clean, 1 = violations)
//
// Sibling of tools/check-spec.mjs, and deliberately the same shape: a handful of
// checks that can be decided by reading files, no engine imports, no network.
//
// It exists because the 2026-08-05 documentation-truth sweep found claims that
// were false when written and stayed false for months — an example count nobody
// recounted, a "there are no golden images" doctrine that a later packet
// contradicted, a sort order the comparator never implemented. Each check below
// is a specific defect that was fixed by hand once; the check is what stops it
// coming back, since prose has no type checker and no test suite.
//
// Scope discipline: a check here must be *mechanical*. It may count files, match
// a fixed string, or compare a number in a document against the filesystem. It
// must never try to judge whether a paragraph is true in general — that is a
// review, and a gate that pretends to do it would be its own false claim.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

/** Reads a repo-relative file, or returns null if it is absent. */
function read(rel) {
  const path = join(root, rel);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** Every tracked path under `examples/`, from git — the source of truth for "exists". */
function trackedExampleFiles() {
  const out = execFileSync("git", ["ls-files", "examples/"], {
    cwd: root,
    encoding: "utf8",
  });
  return out.split("\n").filter(Boolean);
}

/** Repo-relative paths of every `.md` file under `docs/guides/`, plus the two root-ish READMEs. */
function docFiles() {
  const files = ["README.md", "examples/README.md"];
  const guides = join(root, "docs", "guides");
  if (existsSync(guides)) {
    for (const name of readdirSync(guides)) {
      if (name.endsWith(".md")) files.push(join("docs", "guides", name));
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// 1. Example directories: real ones have a main.ts; references to the others
//    must carry the placeholder marker.
//
//    An `examples/<name>` directory is REAL if git tracks a `main.ts` in it, and
//    a PLACEHOLDER otherwise (in practice: a lone `.gitkeep`). A doc may name a
//    placeholder — the §93 tables have to, to say what is missing — but only in
//    a paragraph that also says so, so a reader is never sent to an empty
//    directory expecting code.
// ---------------------------------------------------------------------------

// Matched against whitespace-collapsed text, so a marker that wraps across a
// line break in the source still counts. Two spellings are accepted: the
// canonical list/table marker, and the prose form a guide uses mid-sentence.
const PLACEHOLDER_MARKER = /not yet written|(the )?directory is a placeholder/i;

/** Collapses newlines and indentation so a wrapped sentence reads as one line. */
const flatten = (s) => s.replace(/\s+/g, " ");

const tracked = trackedExampleFiles();
/** Example directory name (possibly nested, e.g. `flagship/motor-digital-twin`) → has a main.ts. */
const exampleDirs = new Map();
for (const file of tracked) {
  const rest = file.slice("examples/".length);
  const parts = rest.split("/");
  if (parts.length < 2) continue; // examples/README.md, examples/tsconfig.json
  // `flagship/<demo>` nests one level; everything else is a single directory.
  const dir =
    parts[0] === "flagship" && parts.length > 2
      ? `${parts[0]}/${parts[1]}`
      : parts[0];
  const isMain = file.endsWith("/main.ts");
  exampleDirs.set(dir, (exampleDirs.get(dir) ?? false) || isMain);
}

const realExamples = [...exampleDirs]
  .filter(([, has]) => has)
  .map(([d]) => d)
  .sort((a, b) => a.localeCompare(b));
const placeholderExamples = [...exampleDirs]
  .filter(([, has]) => !has)
  .map(([d]) => d)
  .sort((a, b) => a.localeCompare(b));

if (realExamples.length === 0) {
  errors.push(
    "no examples/* directory has a tracked main.ts — is git ls-files working?",
  );
}

// A reference is "marked" if the placeholder marker appears in the mention's own
// Markdown block — the line itself plus its wrapped continuation lines. The
// window deliberately stops at the next table row, list item, heading or blank
// line: in a table of four consecutive placeholder rows, a fixed line window
// would let row 2's marker excuse a missing marker on row 1, which is exactly
// the kind of near-miss this gate exists to catch. Capped so a runaway block
// cannot swallow the rest of a file.
const REFERENCE_WINDOW_LINES = 6;

/** The mention's own block: `lines[i]` plus its continuation lines. */
function blockAt(lines, i) {
  const block = [lines[i]];
  for (
    let j = i + 1;
    j < lines.length && block.length <= REFERENCE_WINDOW_LINES;
    j += 1
  ) {
    const line = lines[j];
    if (line.trim() === "" || /^\s*([|\-*+#>]|\d+\.)/.test(line)) break;
    block.push(line);
  }
  return flatten(block.join("\n"));
}

for (const rel of docFiles()) {
  const text = read(rel);
  if (text === null) continue;
  const lines = text.split("\n");
  for (const dir of placeholderExamples) {
    lines.forEach((line, i) => {
      // `examples/<dir>` or, inside examples/README.md, a bare `` `<dir>/` `` link.
      const mentions =
        line.includes(`examples/${dir}`) ||
        (rel === "examples/README.md" && line.includes(`](${dir}/)`));
      if (!mentions) return;
      if (!PLACEHOLDER_MARKER.test(blockAt(lines, i))) {
        errors.push(
          `${rel}:${i + 1}: references empty example "examples/${dir}" without the ` +
            `placeholder marker ("not yet written; directory is a placeholder"). ` +
            `That directory holds a .gitkeep and no main.ts (docs/AUDIT-120.md S-8).`,
        );
      }
    });
  }
}

// Conversely: a real example must not be labelled a placeholder. A line that
// names a placeholder *and* points at its shipped stand-in ("…is a placeholder.
// Use `examples/physics-playground`") is the correct form and is skipped — the
// marker on such a line belongs to the placeholder, not to the real example.
for (const rel of docFiles()) {
  const text = read(rel);
  if (text === null) continue;
  const lines = text.split("\n");
  for (const dir of realExamples) {
    lines.forEach((line, i) => {
      if (!line.includes(`examples/${dir}`)) return;
      if (!PLACEHOLDER_MARKER.test(line)) return;
      const alsoNamesPlaceholder = placeholderExamples.some((p) =>
        line.includes(`examples/${p}`),
      );
      if (alsoNamesPlaceholder) return;
      errors.push(
        `${rel}:${i + 1}: calls "examples/${dir}" a placeholder, but it has a tracked main.ts`,
      );
    });
  }
}

// ---------------------------------------------------------------------------
// 2. docs/AUDIT-120.md's example count matches the filesystem.
//
//    The row said "10 example applications" for three days past the point anyone
//    could have counted six. The audit is the document most likely to be quoted,
//    so its count is pinned to git rather than to a reviewer's memory.
//
//    A nested example counts too: `examples/flagship/<demo>` is keyed by its
//    two-segment name above, so both flagships are among the directories this
//    count compares against (8 since 2026-08-07; 9 since 2026-08-08, when §119's
//    `flagship/motor-digital-twin` was written).
// ---------------------------------------------------------------------------

const auditRel = "docs/AUDIT-120.md";
const audit = read(auditRel);
if (audit === null) {
  errors.push(`${auditRel} is missing`);
} else {
  const row = audit.split("\n").find((l) => /^\| examples\s/.test(l));
  if (!row) {
    errors.push(`${auditRel}: no "| examples" row found in the tooling table`);
  } else {
    // The row states the count as `**N**` runnable examples.
    const m = row.match(/\*\*(\d+)\*\*\s+runnable example/);
    if (!m) {
      errors.push(
        `${auditRel}: the examples row must state its count as "**N** runnable example ` +
          `applications" so this check can compare it against git ls-files`,
      );
    } else if (Number(m[1]) !== realExamples.length) {
      errors.push(
        `${auditRel}: the examples row claims ${m[1]}, but ${realExamples.length} ` +
          `examples/* directories have a tracked main.ts (${realExamples.join(", ")})`,
      );
    }
    // And each named example must be one that exists.
    for (const name of row.matchAll(/`([a-z0-9-]+)`/g)) {
      if (!realExamples.includes(name[1])) {
        errors.push(
          `${auditRel}: the examples row names \`${name[1]}\`, which has no tracked main.ts`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Retired claims. Each entry is a claim that was verified false and fixed by
//    hand on the stated date; the regex matches the *original wording*, so a
//    revert, a copy-paste from an old revision, or a well-meaning "restore the
//    concise version" fails here instead of shipping.
//
//    `allow` lists files permitted to contain the string because they *quote* it
//    while correcting it — the house style is to keep the superseded wording
//    visible, so the corrections themselves would otherwise trip their own gate.
// ---------------------------------------------------------------------------

const RETIRED = [
  {
    re: /`?ScreenCamera`? is absent/i,
    where: [],
    allow: [
      "CHANGELOG.md",
      "MEMORY.md",
      "TODO.md",
      "docs/GAP ANALYSIS v0.md",
      "docs/GAP ANALYSIS v1.md",
    ],
    why: "R-37 closed 2026-08-21; both flagships draw UI through a second viewport under ScreenCamera",
  },
  {
    re: /nothing on this roadmap has shipped yet/i,
    where: ["ROADMAP.md"],
    allow: ["ROADMAP.md", "CHANGELOG.md"],
    why: "the implementation plan completed 2026-08-02 (docs/AUDIT-120.md)",
  },
  {
    re: /lighting is the single staged absence/i,
    where: ["README.md"],
    allow: ["README.md", "CHANGELOG.md"],
    why: "lighting shipped at its MVP tier 2026-08-04 (AUDIT-120 S-5); the audit is 43/43",
  },
  {
    re: /10 example applications/i,
    where: ["docs/AUDIT-120.md"],
    allow: ["docs/AUDIT-120.md", "CHANGELOG.md"],
    why:
      "nine examples/* directories have a main.ts (six until 2026-08-07, when " +
      "first-3d-scene and then §118's flagship were written; nine since " +
      "2026-08-08, when §119's motor digital twin was written); the remaining " +
      "three are .gitkeep (S-8)",
  },
  {
    re: /tests\/visual\/.*empty placeholder/i,
    where: ["docs/AUDIT-120.md"],
    allow: ["docs/AUDIT-120.md", "CHANGELOG.md", "tests/README.md"],
    why: "a golden-image suite landed in tests/visual/ on 2026-08-04",
  },
  {
    re: /§55; batched/,
    where: ["docs/AUDIT-120.md"],
    allow: ["CHANGELOG.md"],
    // The pin outlives R-9 (2026-08-09), which shipped §65 batching *opt-in*
    // (`createGlBatching()`/`createWgpuBatching()`): a default renderer still
    // draws one sprite per draw call, so the original unqualified wording this
    // regex matches stays false — a truthful sentence must say "opt-in", and
    // in saying so stops matching the retired form.
    why:
      "the WebGL backend draws one sprite per draw call unless batching is " +
      "opted into (§65 shipped opt-in as R-9, 2026-08-09); the unqualified " +
      '"batched" this pins was false when written and is still false of ' +
      "the default path",
  },
  {
    re: /There are no golden images/,
    where: ["playwright.config.ts"],
    allow: ["playwright.config.ts", "CHANGELOG.md"],
    why: "true of the chromium project only; the visual project compares committed goldens",
  },
  {
    re: /by render layer, then kind/i,
    where: ["docs/guides/materials-and-render-graph.md"],
    allow: ["docs/guides/materials-and-render-graph.md", "CHANGELOG.md"],
    why: "compareRenderItems sorts renderLayer then renderOrder, and nothing else",
  },
  {
    re: /three fixed, internal programs/i,
    where: ["docs/guides/custom-shaders.md"],
    allow: ["docs/guides/custom-shaders.md", "CHANGELOG.md"],
    why: "LitProgram made it four on 2026-08-04",
  },
  {
    re: /panel parented to the$|panel parented to the camera/i,
    where: ["examples/README.md"],
    allow: ["examples/README.md", "CHANGELOG.md"],
    why:
      "both flagships moved onto the standard §46/§47/§48 screen-space recipe " +
      'on 2026-08-21 (a "ui" layer, a second full-surface viewport with a ' +
      "ScreenCamera, layerMask per view); the camera-parenting workaround R-37 " +
      "unblocked is gone from examples/flagship/*",
  },
  {
    re: /render-webgpu\s+\(stub\)|render-webgpu is a (declared )?reserved stub/i,
    where: ["docs/Architecture/COMPONENTS.md", "docs/Architecture/OVERVIEW.md"],
    allow: [
      "CHANGELOG.md",
      "MEMORY.md",
      "TODO.md",
      "docs/GAP ANALYSIS v0.md",
      "docs/GAP ANALYSIS v1.md",
      "docs/GAP ANALYSIS v2.md",
      "docs/Architecture/COMPONENTS.md",
      "docs/Architecture/OVERVIEW.md",
    ],
    why: "R-1 closed 2026-08-29; @fourjs/render-webgpu is a shipped backend (WP-R1.1–R1.9)",
  },
];

// Documents whose *subject* is the false claims: a gap analysis or a review
// quotes the defective wording in order to report it, so scanning them would
// make the gate fire on the very document that found the problem. Excluded by
// name, deliberately short, and each entry needs a reason.
// Append-only records whose stated convention is to keep superseded wording
// visible — `MEMORY.md` says "never silently rewrite a recorded decision —
// supersede it with a new entry", and `CHANGELOG.md` does not rewrite history.
// Both therefore quote retired claims on purpose, so the retired-claim scan
// skips them. (They are still scanned by check 1: a record may not send a reader
// to an empty example directory either.)
const APPEND_ONLY_RECORDS = new Set(["CHANGELOG.md", "MEMORY.md"]);

const QUOTES_DEFECTS = new Set([
  // The doc-truth gap analysis: an inventory of these exact claims, with file
  // and line, written by the audit that produced the 2026-08-05 sweep.
  "docs/GAP ANALYSIS v0.md",
  // The pre-1.0 specification review: quotes superseded wording throughout.
  "docs/SPEC-REVIEW.md",
]);

// Files worth scanning: the repository's prose and the one config whose comment
// carries a claim. Kept explicit rather than walking the tree, so the gate stays
// fast and never reads node_modules, dist, or the generated API docs.
function prosePaths() {
  const paths = new Set([
    "README.md",
    "ROADMAP.md",
    "CHANGELOG.md",
    "MEMORY.md",
    "TODO.md",
    "AGENTS.md",
    "CLAUDE.md",
    "playwright.config.ts",
    "examples/README.md",
    "tests/README.md",
    "benchmarks/README.md",
  ]);
  for (const dir of [
    join("docs"),
    join("docs", "guides"),
    join("docs", "Architecture"),
  ]) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      const full = join(abs, name);
      if (statSync(full).isFile() && name.endsWith(".md")) {
        paths.add(relative(root, full).split("\\").join("/"));
      }
    }
  }
  const packages = join(root, "packages");
  if (existsSync(packages)) {
    for (const name of readdirSync(packages)) {
      const readme = join("packages", name, "README.md");
      if (existsSync(join(root, readme))) paths.add(readme);
    }
  }
  return [...paths].filter((p) => {
    if (!existsSync(join(root, p)) || QUOTES_DEFECTS.has(p)) return false;
    // Generated Architecture dumps quote whatever the tree said the day they
    // were regenerated; they are not prose we author by hand. DEPENDENCY*
    // is the graph dump (its header says "Last Updated", not "Generated").
    // TEST_COVERAGE.md, FILE_INVENTORY.md, duplicate-symbols.md and
    // unused-analysis.md stamp `**Generated**:` in the first lines.
    if (p.startsWith("docs/Architecture/DEPENDENCY")) return false;
    if (p.startsWith("docs/Architecture/dependency")) return false;
    if (p.startsWith("docs/Architecture/")) {
      const header = read(p)?.slice(0, 400) ?? "";
      if (/\*\*Generated\*\*:/.test(header)) return false;
    }
    return true;
  });
}

for (const rel of prosePaths()) {
  if (APPEND_ONLY_RECORDS.has(rel)) continue;
  const text = read(rel);
  if (text === null) continue;
  for (const claim of RETIRED) {
    if (claim.allow.includes(rel)) continue;
    text.split("\n").forEach((line, i) => {
      if (claim.re.test(line)) {
        errors.push(
          `${rel}:${i + 1}: retired claim ${claim.re} — ${claim.why}`,
        );
      }
    });
  }
  // Inside an `allow`ed file the claim may appear only alongside a dated
  // correction: the house style quotes the old wording and says when it stopped
  // being true. A bare reappearance is a revert.
  for (const claim of RETIRED) {
    if (!claim.allow.includes(rel) || !claim.where.includes(rel)) continue;
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (!claim.re.test(line)) return;
      const window = lines.slice(Math.max(0, i - 6), i + 7).join("\n");
      if (!/until 2026-|superseded|corrected 20\d\d-/i.test(window)) {
        errors.push(
          `${rel}:${i + 1}: retired claim ${claim.re} reappears without a dated ` +
            `correction nearby — ${claim.why}`,
        );
      }
    });
  }
}

// A fenced TypeScript block that drives an Application must start it.
//
// Found 2026-09-06 by extracting README.md's quick-start block verbatim, serving it
// and loading it in a browser. It threw before drawing anything:
//
//   FourError: Application.step() requires an initialized, started, undisposed
//   application: call `await app.initialize()` then `app.start()` (§45).
//
// The block awaited `initialize()` and went straight into a `requestAnimationFrame`
// loop calling `step()`. Every one of the ten `examples/*/main.ts` calls `start()`
// exactly once; only the README omitted it, so the first program a new reader runs
// was the one program in the repository that could not run. It survived because a
// fenced block is prose and prose has no type checker -- the paragraph under it
// called the snippet "illustrative", which is what licensed the rot.
//
// Mechanical, per this file's scope discipline: it matches fixed strings and judges
// no paragraph.
//
// Two details are load-bearing, both found by testing the check before trusting it:
//
//   - `\r?\n`, not `\n`. `core.autocrlf` gives a Windows working tree CRLF, and a
//     `\n` anchor matched zero blocks — the guard passed while catching nothing.
//   - It binds to the application's own identifier. Flagging any block with both
//     `.initialize()` and `.step()` hit four guides that step a *PhysicsWorld*
//     (`world.step(1 / 60)`) and rightly never call `app.start()`: four false
//     positives out of five hits. Only `new Application(...)`'s own variable counts.
const LIFECYCLE_FENCE = /```(?:ts|typescript)\r?\n([\s\S]*?)```/g;
const APPLICATION_BINDING = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new Application\(/;
for (const rel of prosePaths()) {
  const text = read(rel);
  if (text === null) continue;
  for (const match of text.matchAll(LIFECYCLE_FENCE)) {
    const body = match[1];
    const bound = APPLICATION_BINDING.exec(body);
    if (bound === null) continue;
    const app = bound[1];
    if (!new RegExp(`\\b${app}\\.step\\(`).test(body)) continue;
    if (new RegExp(`\\b${app}\\.start\\(`).test(body)) continue;
    const line = text.slice(0, match.index).split("\n").length;
    errors.push(
      `${rel}:${line}: this block drives \`${app}\` with ${app}.step() but never ` +
        `calls ${app}.start() — §45 rejects exactly that at runtime, so the snippet ` +
        `cannot run as written. Add ${app}.start() after await ${app}.initialize().`,
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Counts claimed in prose must match the filesystem.
//
//    Each pin extracts a bold number (`**N**`) from a known sentence or table
//    row and compares it to a directory listing. Adding a package, a suite, or
//    a browser spec without updating the sentence fails here, which is the
//    defect `tests/README.md` carried (8 determinism suites, 6+1 integration,
//    9 browser specs, `bun run test:suites`) until 2026-09-06.
// ---------------------------------------------------------------------------

/** Immediate child files of `rel` whose names end with `suffix`. */
function countDirect(rel, suffix) {
  const dir = join(root, rel);
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter(
    (name) => name.endsWith(suffix) && statSync(join(dir, name)).isFile(),
  ).length;
}

/** Files under `rel` (any depth) whose names end with `suffix`. */
function countNested(rel, suffix) {
  const dir = join(root, rel);
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      n += countNested(join(rel, name), suffix);
    } else if (name.endsWith(suffix)) {
      n += 1;
    }
  }
  return n;
}

const packageCount = existsSync(join(root, "packages"))
  ? readdirSync(join(root, "packages")).filter((name) =>
      existsSync(join(root, "packages", name, "package.json")),
    ).length
  : 0;

const determinismSuites = countDirect("tests/determinism", ".test.ts");
const determinismGoldens = countDirect("tests/determinism/golden", ".json");
const integrationSuites = countDirect("tests/integration", ".test.ts");
const browserSpecs = countDirect("tests/browser", ".spec.ts");
const visualSpecs = countDirect("tests/visual", ".spec.ts");
const visualGoldens = countNested("tests/visual", ".png");

const readme = read("README.md");
if (readme === null) {
  errors.push("README.md is missing");
} else {
  const claimed = readme.match(/(\d+) workspace packages/);
  if (claimed === null) {
    errors.push(
      'README.md: must claim "N workspace packages" so the count can be ' +
        "compared against packages/*/package.json",
    );
  } else if (Number(claimed[1]) !== packageCount) {
    errors.push(
      `README.md: claims ${claimed[1]} workspace packages, but ` +
        `packages/*/package.json counts ${String(packageCount)}`,
    );
  }
}

const testsReadmeRel = "tests/README.md";
const testsReadme = read(testsReadmeRel);
if (testsReadme === null) {
  errors.push(`${testsReadmeRel} is missing`);
} else {
  /**
   * The summary table's row for `dir` must state each count as `**N**` so this
   * check can read it without judging the surrounding prose.
   */
  function tableRow(dir) {
    const row = testsReadme.split("\n").find((l) => l.includes(`[\`${dir}/\`]`));
    if (row === undefined) {
      errors.push(`${testsReadmeRel}: no summary-table row for ${dir}/`);
      return null;
    }
    return row;
  }

  function boldNumbers(row) {
    return [...row.matchAll(/\*\*(\d+)\*\*/g)].map((m) => Number(m[1]));
  }

  const detRow = tableRow("determinism");
  if (detRow !== null) {
    const nums = boldNumbers(detRow);
    if (nums.length < 2) {
      errors.push(
        `${testsReadmeRel}: the determinism row must state its suite and ` +
          `golden counts as "**N** suites + **M** committed goldens"`,
      );
    } else {
      if (nums[0] !== determinismSuites) {
        errors.push(
          `${testsReadmeRel}: determinism row claims ${String(nums[0])} suites, ` +
            `but tests/determinism/*.test.ts counts ${String(determinismSuites)}`,
        );
      }
      if (nums[1] !== determinismGoldens) {
        errors.push(
          `${testsReadmeRel}: determinism row claims ${String(nums[1])} goldens, ` +
            `but tests/determinism/golden/*.json counts ${String(determinismGoldens)}`,
        );
      }
    }
  }

  const intRow = tableRow("integration");
  if (intRow !== null) {
    const nums = boldNumbers(intRow);
    if (nums.length < 1) {
      errors.push(
        `${testsReadmeRel}: the integration row must state its count as "**N** suites"`,
      );
    } else if (nums[0] !== integrationSuites) {
      errors.push(
        `${testsReadmeRel}: integration row claims ${String(nums[0])} suites, ` +
          `but tests/integration/*.test.ts counts ${String(integrationSuites)}`,
      );
    }
  }

  const broRow = tableRow("browser");
  if (broRow !== null) {
    const nums = boldNumbers(broRow);
    if (nums.length < 1) {
      errors.push(
        `${testsReadmeRel}: the browser row must state its count as "**N** Playwright specs"`,
      );
    } else if (nums[0] !== browserSpecs) {
      errors.push(
        `${testsReadmeRel}: browser row claims ${String(nums[0])} specs, ` +
          `but tests/browser/*.spec.ts counts ${String(browserSpecs)}`,
      );
    }
  }

  const visRow = tableRow("visual");
  if (visRow !== null) {
    const nums = boldNumbers(visRow);
    if (nums.length < 2) {
      errors.push(
        `${testsReadmeRel}: the visual row must state its spec and golden ` +
          `counts as "**N** specs, **M** committed PNG goldens"`,
      );
    } else {
      if (nums[0] !== visualSpecs) {
        errors.push(
          `${testsReadmeRel}: visual row claims ${String(nums[0])} specs, ` +
            `but tests/visual/*.spec.ts counts ${String(visualSpecs)}`,
        );
      }
      if (nums[1] !== visualGoldens) {
        errors.push(
          `${testsReadmeRel}: visual row claims ${String(nums[1])} goldens, ` +
            `but tests/visual/**/*.png counts ${String(visualGoldens)}`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 5. docs/AUDIT-120.md's verdict table is internally consistent.
//
//    The census is the file's own item tables (Scene through Tooling): each
//    row whose status cell is `shipped`, `shipped (MVP tier)`, or `staged`.
//    The verdict table above them states three bold totals that must sum to
//    that census. README.md's "43/43" is pinned only when the census is 43
//    and staged is 0 — decided by reading the audit's table, not by
//    inventing a verdict.
// ---------------------------------------------------------------------------

if (audit !== null) {
  const itemRow =
    /^\| (?![-: ])(?!\s*§120 item).+\| (shipped(?: \(MVP tier\))?|staged)\s+\|/;
  const items = audit.split("\n").filter((l) => itemRow.test(l));
  const stagedItems = items.filter((l) => /\|\s*staged\s+\|/.test(l)).length;
  const verdictTotals = [
    ...audit.matchAll(/\|\s+\*\*(\d+)\*\*\s+\|\s+of 43\s+\|/g),
  ].map((m) => Number(m[1]));
  const verdictSum = verdictTotals.reduce((a, b) => a + b, 0);

  if (items.length === 0) {
    errors.push(`${auditRel}: no §120 item rows with a shipped/staged status`);
  }
  if (verdictTotals.length !== 3) {
    errors.push(
      `${auditRel}: the Verdict table must state three bold totals as ` +
        `"**N** | of 43" (shipped / MVP-tier / staged)`,
    );
  } else if (verdictSum !== items.length) {
    errors.push(
      `${auditRel}: Verdict table sums to ${String(verdictSum)}, but the ` +
        `item tables list ${String(items.length)} rows`,
    );
  }

  if (readme !== null && /\b43\/43\b/.test(readme)) {
    if (items.length !== 43 || stagedItems !== 0) {
      errors.push(
        `README.md: claims 43/43, but ${auditRel}'s item tables list ` +
          `${String(items.length)} rows (${String(stagedItems)} staged)`,
      );
    }
  }
}

if (errors.length) {
  console.error(`check-docs: ${errors.length} problem(s)`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `check-docs: OK (${realExamples.length} runnable examples, ` +
    `${placeholderExamples.length} placeholders, ${RETIRED.length} retired claims pinned, ` +
    `${String(packageCount)} packages, ${String(determinismSuites)}/${String(integrationSuites)}/${String(browserSpecs)} suites)`,
);
