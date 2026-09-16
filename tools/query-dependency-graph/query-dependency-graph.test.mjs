import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  resolveRoot,
  resolveSpec,
  buildForward,
  invert,
  computeTaint,
  reachableFrom,
  findLeaks,
  browserSafePackages,
} from "./query-dependency-graph.mjs";

// Fixture mirrors the real render-file.ts scenario:
//   plot/src/index.ts → a, b            (public entry)
//   a → c
//   b uses node:fs                      (node file reachable from index → LEAK)
//   node-only uses node:child_process, imported by NOBODY (only via subpath)
const entries = [
  [
    "plot/src/index.ts",
    {
      internalDependencies: [{ file: "./a.js" }, { file: "./b.js" }],
      nodeDependencies: [],
    },
  ],
  [
    "plot/src/a.ts",
    { internalDependencies: [{ file: "./c.js" }], nodeDependencies: [] },
  ],
  [
    "plot/src/b.ts",
    { internalDependencies: [], nodeDependencies: [{ module: "fs" }] },
  ],
  ["plot/src/c.ts", { internalDependencies: [], nodeDependencies: [] }],
  [
    "plot/src/node-only.ts",
    {
      internalDependencies: [],
      nodeDependencies: [{ module: "child_process" }],
    },
  ],
];
const allFiles = new Set(entries.map(([f]) => f));

test("resolveSpec maps ./x.js relative import to the sibling .ts file", () => {
  assert.equal(
    resolveSpec("plot/src/index.ts", "./a.js", allFiles),
    "plot/src/a.ts",
  );
  assert.equal(
    resolveSpec("plot/src/a.ts", "./c.js", allFiles),
    "plot/src/c.ts",
  );
  assert.equal(resolveSpec("plot/src/index.ts", "node:fs", allFiles), null); // bare specifier
  assert.equal(
    resolveSpec("plot/src/index.ts", "./missing.js", allFiles),
    null,
  ); // unresolvable
});

test("buildForward + invert produce correct reverse edges", () => {
  const forward = buildForward(entries, allFiles);
  assert.deepEqual([...forward.get("plot/src/index.ts")].sort(), [
    "plot/src/a.ts",
    "plot/src/b.ts",
  ]);
  const rev = invert(forward);
  assert.deepEqual(rev["plot/src/a.ts"], ["plot/src/index.ts"]);
  assert.deepEqual(rev["plot/src/c.ts"], ["plot/src/a.ts"]);
  assert.equal(rev["plot/src/node-only.ts"], undefined); // imported by nobody
});

test("computeTaint marks direct + transitive node: users", () => {
  const forward = buildForward(entries, allFiles);
  const { taint, direct } = computeTaint(forward, entries);
  assert.equal(direct.get("plot/src/b.ts"), true);
  assert.equal(direct.get("plot/src/a.ts"), false);
  assert.equal(taint.get("plot/src/index.ts"), true); // imports b (node:)
  assert.equal(taint.get("plot/src/a.ts"), false); // a → c, neither node:
  assert.equal(taint.get("plot/src/node-only.ts"), true);
});

test("reachableFrom the public entry excludes the subpath-only node file", () => {
  const forward = buildForward(entries, allFiles);
  const reach = reachableFrom("plot/src/index.ts", forward);
  assert.ok(reach.has("plot/src/c.ts"));
  assert.ok(!reach.has("plot/src/node-only.ts")); // not imported by index → not reachable
});

test("findLeaks flags node: files reachable from . but not subpath-only ones", () => {
  const forward = buildForward(entries, allFiles);
  const { direct } = computeTaint(forward, entries);
  const leaks = findLeaks("plot", forward, direct);
  assert.deepEqual(leaks, ["plot/src/b.ts"]); // b leaks; node-only.ts does not (unreachable from .)
});

test("browserSafePackages = main entries minus Node runtimes (workbook)", () => {
  const graph = {
    entryPoints: [
      { file: "plot/src/index.ts", type: "main" },
      { file: "core/src/index.ts", type: "main" },
      { file: "workbook/src/index.ts", type: "main" },
      { file: "packages/typed-function/src/index.ts", type: "main" },
      { file: "plot/src/render-file.ts", type: "subpath" }, // non-main → ignored
    ],
  };
  const bsp = browserSafePackages(graph);
  assert.ok(bsp.includes("plot"));
  assert.ok(bsp.includes("core"));
  assert.ok(bsp.includes("packages/typed-function"));
  assert.ok(!bsp.includes("workbook")); // Node runtime excluded
  assert.ok(!bsp.includes("plot/src/render-file")); // non-main entry not a package
});

// --root lets the tool point at a package that is not the directory two levels
// above the script. llm-wiki keeps CDG/QDG at the repo root but its TypeScript
// lives in pipeline/ and memory/, so the graph is written to <pkg>/docs/Architecture
// rather than <repo>/docs/Architecture.
test("resolveRoot: defaults to two levels above the script directory", () => {
  const dir = resolve("/repo/tools/query-dependency-graph");
  assert.equal(resolveRoot([], dir), resolve("/repo"));
});

test("resolveRoot: --root=<path> overrides the default", () => {
  const dir = resolve("/repo/tools/query-dependency-graph");
  assert.equal(
    resolveRoot(["--root=/elsewhere/pipeline"], dir),
    resolve("/elsewhere/pipeline"),
  );
});

test("resolveRoot: a relative --root resolves against cwd", () => {
  const dir = resolve("/repo/tools/query-dependency-graph");
  assert.equal(
    resolveRoot(["--root=pipeline"], dir),
    resolve(process.cwd(), "pipeline"),
  );
});

test("resolveRoot: --root is consumed, not left to be read as a command", () => {
  const dir = resolve("/repo/tools/query-dependency-graph");
  const argv = ["--root=/x", "cycles"];
  resolveRoot(argv, dir);
  assert.deepEqual(
    argv.filter((a) => !a.startsWith("--root=")),
    ["cycles"],
  );
});
