#!/usr/bin/env node
// Generates the live-declaration halves of docs/COMPATIBILITY.md (§90, §102, §62).
// Usage:
//   node tools/generate-compatibility.mjs           (rewrite the generated blocks)
//   node tools/generate-compatibility.mjs --check   (exit 1 if the doc is stale)
//
// Sibling of tools/check-spec.mjs and tools/check-docs.mjs in spirit — plain
// Node ESM, no dependencies, no network — but with one deliberate difference:
// those two only *read*, and this one writes a block of Markdown.
//
// ## Why a generator rather than a hand-written table
//
// §37: *"Capability declarations drive `solver: "auto"` selection (§20) and the
// compatibility tables of §90."* A hand-written §90 table restates a
// declaration that already exists in the adapter, in a file nobody edits when
// the adapter changes, and a stale capability table is worse than none: it is
// the exact failure mode `PhysicsCapabilities`' own documentation calls out —
// "declaring a capability an adapter does not have converts a clear
// construction-time error into a wrong simulation". So the table is read off
// the shipped adapters instead, and `--check` is what stops the committed
// document drifting away from them.
//
// ## Where the numbers come from
//
// Everything in the generated block is observed, never assumed:
//
//   - the capability rows come from a **constructed adapter instance**'s
//     `capabilities` — the same object `PhysicsWorld` validates against, read
//     before `initialize` (both Rapier adapters document it as readable there,
//     and no wasm image is loaded until initialization);
//   - the solver build column comes from the package's own `dependencies`;
//   - the `SolverBodyAccess` / `SolverJointAccess` rows are **structural**:
//     the member names are parsed out of `@fourjs/physics`'s emitted
//     `body-access.d.ts` and probed on the instance, because those two seams
//     are detected structurally rather than declared (see §37's note on
//     `PhysicsCapabilities.jointTypes`);
//   - reserved solver packages are the `packages/physics-*` directories that
//     export no adapter class at all (§102).
//
// Adding a third adapter therefore adds a column with no edit to this file.
//
// ## Requires a built tree
//
// The adapters are imported from `dist/`, so `bun run build` has to have run.
// That is deliberate: parsing the capability object literal out of the
// TypeScript source would re-implement a const evaluator and would quietly
// disagree with what an application actually gets.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docPath = join(root, "docs", "COMPATIBILITY.md");
const docRelative = "docs/COMPATIBILITY.md";

/** Solver-adapter block (§37 / §102). Everything outside the markers is hand-written. */
const SOLVER_BEGIN = "<!-- BEGIN GENERATED: solver-adapters -->";
const SOLVER_END = "<!-- END GENERATED: solver-adapters -->";

/** Renderer-backend block (§62). Read off constructed instances before initialize. */
const RENDERER_BEGIN = "<!-- BEGIN GENERATED: renderer-backends -->";
const RENDERER_END = "<!-- END GENERATED: renderer-backends -->";

const check = process.argv.includes("--check");

/** Fails the run with a message a reader can act on. */
function fail(message) {
  console.error(`generate-compatibility: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. The seam member lists, parsed from @fourjs/physics's emitted declarations.
//
//    `SolverBodyAccess` and `SolverJointAccess` are structural: an adapter
//    implements them by having the methods, and `PhysicsWorld` narrows to them
//    at runtime. Reading the member names out of the `.d.ts` rather than
//    hardcoding them here means a member added to either interface immediately
//    tightens this tool's probe.
// ---------------------------------------------------------------------------

const bodyAccessDeclaration = join(
  root,
  "packages",
  "physics",
  "dist",
  "body-access.d.ts",
);

/** Member names declared directly on `export interface <name>` in a `.d.ts`. */
function interfaceMembers(declarationText, name) {
  const opening = `export interface ${name} {`;
  const start = declarationText.indexOf(opening);
  if (start < 0) return null;
  const end = declarationText.indexOf("\n}", start);
  if (end < 0) return null;
  const members = [];
  // TypeScript emits one member per line at a single indent level; nested
  // object types would indent further and are skipped by the anchor.
  const memberRe = /^ {4}(?:readonly )?([A-Za-z_$][\w$]*)\??\s*[(<:]/;
  for (const line of declarationText.slice(start, end).split("\n").slice(1)) {
    const m = memberRe.exec(line);
    if (m) members.push(m[1]);
  }
  return members.length > 0 ? members : null;
}

if (!existsSync(bodyAccessDeclaration)) {
  fail(
    "packages/physics/dist/body-access.d.ts is missing — run `bun run build` " +
      "(this tool reads the shipped declarations, not the TypeScript source)",
  );
}
const bodyAccessText = readFileSync(bodyAccessDeclaration, "utf8");
const SEAMS = [
  ["SolverBodyAccess", interfaceMembers(bodyAccessText, "SolverBodyAccess")],
  ["SolverJointAccess", interfaceMembers(bodyAccessText, "SolverJointAccess")],
];
for (const [name, members] of SEAMS) {
  if (members === null) {
    fail(
      `could not parse interface ${name} out of packages/physics/dist/body-access.d.ts`,
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Discover the solver packages and their adapters (§102).
// ---------------------------------------------------------------------------

const packagesDir = join(root, "packages");
const solverPackageDirs = readdirSync(packagesDir)
  .filter((name) => name.startsWith("physics-"))
  .sort();

if (solverPackageDirs.length === 0) {
  fail("no packages/physics-* directory found — is the workspace intact?");
}

/** One adapter: its declared name, capabilities, seams, and provenance. */
const adapters = [];
/** Solver packages that export no adapter class — §102's reserved stubs. */
const reserved = [];

for (const dir of solverPackageDirs) {
  const packageDir = join(packagesDir, dir);
  const manifest = JSON.parse(
    readFileSync(join(packageDir, "package.json"), "utf8"),
  );
  const barrel = join(packageDir, "dist", "index.js");
  if (!existsSync(barrel)) {
    fail(
      `${manifest.name} is not built (${dir}/dist/index.js is missing) — run \`bun run build\``,
    );
  }
  const module = await import(pathToFileURL(barrel).href);
  const exportNames = Object.keys(module).sort();

  // Adapter *classes* only: the name must end in "Adapter" AND start with an
  // upper-case letter. The second check exists because 191ee41 (the §37 solver
  // registry) added the factory `createRapierAdapter(options)`, which ends in
  // "Adapter" but is not a constructor — `new createRapierAdapter()` threw and
  // turned this gate red (found by the §118 flagship packet, 2026-08-07).
  const adapterExports = exportNames.filter(
    (name) =>
      name.endsWith("Adapter") &&
      name[0] === name[0].toUpperCase() &&
      typeof module[name] === "function",
  );

  if (adapterExports.length === 0) {
    reserved.push({
      package: manifest.name,
      exportNames,
    });
    continue;
  }

  for (const exportName of adapterExports) {
    let instance;
    try {
      instance = new module[exportName]();
    } catch (error) {
      fail(
        `${manifest.name}'s ${exportName} could not be constructed without ` +
          `arguments, so its §37 capabilities cannot be read: ${String(error)}`,
      );
    }
    const capabilities = instance.capabilities;
    if (typeof capabilities !== "object" || capabilities === null) {
      fail(
        `${manifest.name}'s ${exportName} exposes no \`capabilities\` object ` +
          "— §37 requires one, readable before `initialize`",
      );
    }
    const dependencies = manifest.dependencies ?? {};
    // The underlying solver build: the dependency whose name contains the
    // adapter's own §37 `name` (`rapier2d` → `@dimforge/rapier2d-compat`).
    const solverDependency =
      Object.keys(dependencies)
        .sort()
        .find((dependency) => dependency.includes(String(instance.name))) ??
      null;
    adapters.push({
      exportName,
      declaredName: String(instance.name),
      package: manifest.name,
      solver: solverDependency,
      solverVersion: solverDependency ? dependencies[solverDependency] : null,
      capabilities,
      reportsJointReactions: instance.reportsJointReactions,
      seams: Object.fromEntries(
        SEAMS.map(([name, members]) => [
          name,
          members.every((member) => member in instance),
        ]),
      ),
    });
  }
}

if (adapters.length === 0) {
  fail("no solver package exports an adapter class — nothing to tabulate");
}
adapters.sort((a, b) =>
  a.package === b.package
    ? a.exportName.localeCompare(b.exportName)
    : a.package.localeCompare(b.package),
);

// ---------------------------------------------------------------------------
// 3. Render the block.
//
//    Tables are padded the way Prettier pads them (each column to its widest
//    cell, minimum three so the separator row stays a valid delimiter), so a
//    regenerated document is already `prettier --check` clean and `--check`
//    compares like with like.
// ---------------------------------------------------------------------------

const code = (text) => `\`${text}\``;
const yesNo = (value) =>
  value === true ? "yes" : value === false ? "no" : "—";
const list = (values) =>
  values.length === 0 ? "none" : values.map(code).join(", ");

/** Escapes the one character a Markdown table cell cannot carry literally. */
const cell = (text) => String(text).replace(/\|/g, "\\|");

/** A Prettier-shaped Markdown table from a header row plus body rows. */
function table(header, rows) {
  const all = [header, ...rows].map((row) => row.map(cell));
  const widths = header.map((_, column) =>
    Math.max(3, ...all.map((row) => row[column].length)),
  );
  const line = (row) =>
    `| ${row.map((text, i) => text.padEnd(widths[i])).join(" | ")} |`;
  const separator = `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`;
  return [line(all[0]), separator, ...all.slice(1).map(line)].join("\n");
}

/** One capability row: a label plus one cell per adapter. */
const rows = [];
const row = (label, project) => {
  rows.push([label, ...adapters.map(project)]);
};

row("Package (§98)", (a) => code(a.package));
row("Exported class", (a) => code(a.exportName));
row("Underlying solver", (a) =>
  a.solver === null ? "—" : `${code(a.solver)} ${a.solverVersion}`,
);
row("`dimensions` (§21)", (a) => list([...a.capabilities.dimensions]));
row("`determinism` (§33)", (a) => code(a.capabilities.determinism));
row("`snapshots` (§34)", (a) => yesNo(a.capabilities.snapshots));
row("`ccdModes` (§31)", (a) => list([...a.capabilities.ccdModes]));
row("`jointTypes` (§28)", (a) => list([...a.capabilities.jointTypes]));
for (const query of ["raycast", "shapeCast", "overlap", "point"]) {
  row(`\`queries.${query}\` (§30)`, (a) =>
    yesNo(a.capabilities.queries[query]),
  );
}
for (const [tunable, section] of [
  ["rollingFriction", "§25"],
  ["spinningFriction", "§25"],
  ["sleepThresholds", "§32"],
]) {
  row(`\`tuning.${tunable}\` (${section})`, (a) =>
    a.capabilities.tuning === undefined
      ? "not declared"
      : yesNo(a.capabilities.tuning[tunable]),
  );
}
row("`reportsJointReactions` (§28)", (a) => yesNo(a.reportsJointReactions));
for (const [seam] of SEAMS) {
  row(`\`${seam}\` implemented`, (a) => yesNo(a.seams[seam]));
}

const capabilityTable = table(
  ["Declaration", ...adapters.map((a) => code(a.declaredName))],
  rows,
);

const reservedLines = reserved.map((entry) => {
  const only =
    entry.exportNames.length === 1
      ? `exports ${code(entry.exportNames[0])} only`
      : `exports ${String(entry.exportNames.length)} bindings, none of them an adapter class`;
  return `- ${code(entry.package)} — reserved stub (§102): the package builds and ${only}.`;
});

const generatedSolverBlock = [
  SOLVER_BEGIN,
  "",
  "<!-- Generated by tools/generate-compatibility.mjs from the adapters' own §37",
  "     capability declarations. Do not edit by hand: run",
  "     `node tools/generate-compatibility.mjs`, and",
  "     `node tools/generate-compatibility.mjs --check` to verify. -->",
  "",
  capabilityTable,
  "",
  ...(reservedLines.length > 0
    ? ["Solver packages that declare no adapter:", "", ...reservedLines, ""]
    : []),
  SOLVER_END,
].join("\n");

// ---------------------------------------------------------------------------
// 4. Renderer backends (§62) — same observation rule as the solver table.
//
//    Constructed instances, before `initialize`. WebGL's static members are
//    complete at construct; `maxTextureSize` and most WebGPU fields stay at
//    the construction-time floor until a context/device exists. Those floors
//    mean "not yet queried", not "this backend cannot" — the same third state
//    `undefined` already carries on WebGL's `maxUniformBufferBytes` /
//    `maxBindings`. The generated comment restates that so a reader of the
//    table is not told WebGPU has no compute.
// ---------------------------------------------------------------------------

const rendererCapabilitiesDeclaration = join(
  root,
  "packages",
  "render",
  "dist",
  "renderer.d.ts",
);
if (!existsSync(rendererCapabilitiesDeclaration)) {
  fail(
    "packages/render/dist/renderer.d.ts is missing — run `bun run build` " +
      "(this tool reads the shipped declarations, not the TypeScript source)",
  );
}
const rendererCapabilityMembers = interfaceMembers(
  readFileSync(rendererCapabilitiesDeclaration, "utf8"),
  "RendererCapabilities",
);
if (rendererCapabilityMembers === null) {
  fail(
    "could not parse interface RendererCapabilities out of packages/render/dist/renderer.d.ts",
  );
}

const renderers = [];
const reservedRenderers = [];

const renderBarrel = join(packagesDir, "render", "dist", "index.js");
if (!existsSync(renderBarrel)) {
  fail(
    "@fourjs/render is not built (render/dist/index.js is missing) — run `bun run build`",
  );
}
const renderModule = await import(pathToFileURL(renderBarrel).href);
if (typeof renderModule.NullRenderer !== "function") {
  fail("@fourjs/render does not export NullRenderer — the headless §62 tier is missing");
}
{
  const instance = new renderModule.NullRenderer();
  const capabilities = instance.capabilities;
  if (typeof capabilities !== "object" || capabilities === null) {
    fail("NullRenderer exposes no `capabilities` object");
  }
  renderers.push({
    exportName: "NullRenderer",
    package: "@fourjs/render",
    capabilities,
  });
}

const rendererPackageDirs = readdirSync(packagesDir)
  .filter((name) => name.startsWith("render-"))
  .sort();

for (const dir of rendererPackageDirs) {
  const packageDir = join(packagesDir, dir);
  const manifest = JSON.parse(
    readFileSync(join(packageDir, "package.json"), "utf8"),
  );
  const barrel = join(packageDir, "dist", "index.js");
  if (!existsSync(barrel)) {
    fail(
      `${manifest.name} is not built (${dir}/dist/index.js is missing) — run \`bun run build\``,
    );
  }
  const module = await import(pathToFileURL(barrel).href);
  const exportNames = Object.keys(module).sort();
  const rendererExports = exportNames.filter(
    (name) =>
      name.endsWith("Renderer") &&
      name[0] === name[0].toUpperCase() &&
      typeof module[name] === "function",
  );

  if (rendererExports.length === 0) {
    reservedRenderers.push({
      package: manifest.name,
      exportNames,
    });
    continue;
  }

  for (const exportName of rendererExports) {
    let instance;
    try {
      instance = new module[exportName]();
    } catch (error) {
      fail(
        `${manifest.name}'s ${exportName} could not be constructed without ` +
          `arguments, so its §62 capabilities cannot be read: ${String(error)}`,
      );
    }
    const capabilities = instance.capabilities;
    if (typeof capabilities !== "object" || capabilities === null) {
      fail(
        `${manifest.name}'s ${exportName} exposes no \`capabilities\` object ` +
          "— §62 requires one, readable before `initialize`",
      );
    }
    renderers.push({
      exportName,
      package: manifest.name,
      capabilities,
    });
  }
}

if (renderers.length === 0) {
  fail("no renderer class could be constructed — nothing to tabulate");
}
renderers.sort((a, b) =>
  a.package === b.package
    ? a.exportName.localeCompare(b.exportName)
    : a.package.localeCompare(b.package),
);

const capabilityValue = (value) => {
  if (value === undefined) return "not reported";
  if (value === true) return "yes";
  if (value === false) return "no";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return code(value);
  if (Array.isArray(value)) return list([...value]);
  return String(value);
};

const rendererRows = [];
const rendererRow = (label, project) => {
  rendererRows.push([label, ...renderers.map(project)]);
};
rendererRow("Package (§98)", (r) => code(r.package));
rendererRow("Exported class", (r) => code(r.exportName));
for (const member of rendererCapabilityMembers) {
  rendererRow(`\`${member}\``, (r) => capabilityValue(r.capabilities[member]));
}

const rendererTable = table(
  [
    "Declaration",
    ...renderers.map((r) =>
      code(
        typeof r.capabilities.backend === "string"
          ? r.capabilities.backend
          : r.exportName,
      ),
    ),
  ],
  rendererRows,
);

const reservedRendererLines = reservedRenderers.map((entry) => {
  const only =
    entry.exportNames.length === 1
      ? `exports ${code(entry.exportNames[0])} only`
      : `exports ${String(entry.exportNames.length)} bindings, none of them a renderer class`;
  return `- ${code(entry.package)} — reserved stub (§62): the package builds and ${only}.`;
});

const generatedRendererBlock = [
  RENDERER_BEGIN,
  "",
  "<!-- Generated by tools/generate-compatibility.mjs from constructed renderer",
  "     instances, before `initialize`. Do not edit by hand: run",
  "     `node tools/generate-compatibility.mjs`, and",
  "     `node tools/generate-compatibility.mjs --check` to verify.",
  "     Device-derived members (`maxTextureSize` on both GPU backends; most",
  "     WebGPU fields) stay at the construction-time floor until a context",
  "     exists. Those floors mean \"not yet queried\", not \"this backend cannot\". -->",
  "",
  rendererTable,
  "",
  ...(reservedRendererLines.length > 0
    ? [
        "Renderer packages that declare no renderer class:",
        "",
        ...reservedRendererLines,
        "",
      ]
    : []),
  RENDERER_END,
].join("\n");

// ---------------------------------------------------------------------------
// 5. Splice both blocks into the document, or compare against what is committed.
// ---------------------------------------------------------------------------

/** Replaces one marker-bounded block, or fails if the markers are missing. */
function spliceBlock(source, beginMarker, endMarker, generated) {
  const begin = source.indexOf(beginMarker);
  const end = source.indexOf(endMarker);
  if (begin < 0 || end < 0 || end < begin) {
    fail(
      `${docRelative} does not contain the marker pair ${beginMarker} … ${endMarker}`,
    );
  }
  return {
    next: `${source.slice(0, begin)}${generated}${source.slice(end + endMarker.length)}`,
    committed: source.slice(begin, end + endMarker.length),
    generated,
  };
}

if (!existsSync(docPath)) {
  fail(
    `${docRelative} does not exist — this tool refreshes a section, it does not create the document`,
  );
}
// Normalised to LF before anything compares it. `core.autocrlf=true` is the
// Windows git default and this repo ships no .gitattributes, so a Windows
// checkout materialises this file with CRLF while git and this generator both
// use LF. The check below splits on "\n", which leaves a trailing "\r" on
// every committed line and makes EVERY line compare unequal - so `--check`
// failed on any Windows clone, and printed a "first difference" whose two
// lines looked identical because the "\r" is invisible. That is a
// line-ending REPRESENTATION difference being reported as content drift.
const doc = readFileSync(docPath, "utf8").replace(/\r\n/g, "\n");
const solverSplice = spliceBlock(doc, SOLVER_BEGIN, SOLVER_END, generatedSolverBlock);
const rendererSplice = spliceBlock(
  solverSplice.next,
  RENDERER_BEGIN,
  RENDERER_END,
  generatedRendererBlock,
);
const next = rendererSplice.next;

if (check) {
  if (next !== doc) {
    const pairs = [
      ["solver-adapter", solverSplice],
      ["renderer-backend", rendererSplice],
    ];
    for (const [label, splice] of pairs) {
      if (splice.committed === splice.generated) continue;
      const committed = splice.committed.split("\n");
      const expected = splice.generated.split("\n");
      const at = expected.findIndex((line, i) => committed[i] !== line);
      console.error(
        `generate-compatibility: ${docRelative} is stale — the ${label} block ` +
          "no longer matches the live declarations.",
      );
      if (at >= 0) {
        console.error(
          `  first difference, generated-block line ${String(at + 1)}:`,
        );
        console.error(`    committed: ${committed[at] ?? "(missing)"}`);
        console.error(`    generated: ${expected[at]}`);
      }
    }
    console.error(
      "  run `node tools/generate-compatibility.mjs` and commit the result",
    );
    process.exit(1);
  }
  console.log(
    `generate-compatibility: OK (${String(adapters.length)} adapter(s), ` +
      `${String(reserved.length)} reserved solver package(s), ` +
      `${String(renderers.length)} renderer(s), ` +
      `${String(reservedRenderers.length)} reserved renderer package(s); ` +
      `${docRelative} is current)`,
  );
} else {
  if (next !== doc) writeFileSync(docPath, next);
  console.log(
    `generate-compatibility: wrote ${docRelative} ` +
      `(${String(adapters.length)} adapter(s), ${String(reserved.length)} reserved solver package(s), ` +
      `${String(renderers.length)} renderer(s), ${String(reservedRenderers.length)} reserved renderer package(s))`,
  );
}
