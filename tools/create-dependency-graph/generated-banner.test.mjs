import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// `repo-tools check . --docs=docs/Architecture` fails on every document that has
// neither a `## Verification` section nor the opt-out marker. The generator writes
// reports that hold no verifiable claim, so each one has to carry the marker and a
// do-not-edit banner. A hand-added marker would vanish at the next `bun run graph`,
// so this test pins the generator itself.

const MARKER = "<!-- repo-map:no-verification -->";
const GENERATOR = join(
  dirname(fileURLToPath(import.meta.url)),
  "create-dependency-graph.ts",
);

/** A two-file workspace with one source file and one test file. */
function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "cdg-banner-"));
  const write = (rel, text) => {
    const file = join(root, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  write(
    "package.json",
    JSON.stringify({ name: "fx", private: true, workspaces: ["packages/*"] }),
  );
  write(
    "packages/a/package.json",
    JSON.stringify({
      name: "@fx/a",
      version: "1.0.0",
      type: "module",
      main: "src/index.ts",
      exports: { ".": "./src/index.ts" },
    }),
  );
  write(
    "packages/a/src/index.ts",
    'import { double } from "./util.js";\nexport function add(a: number, b: number): number {\n  return double(a) + b;\n}\n',
  );
  write(
    "packages/a/src/util.ts",
    "export function double(n: number): number {\n  return n * 2;\n}\n",
  );
  write(
    "packages/a/tests/index.test.ts",
    'import { add } from "../src/index.js";\nconsole.log(add(1, 2));\n',
  );
  return root;
}

function generate(root, extraArgs = []) {
  const run = spawnSync("bun", [GENERATOR, `--root=${root}`, ...extraArgs], {
    encoding: "utf8",
  });
  assert.equal(
    run.status,
    0,
    `the generator exited ${run.status}\n${run.stdout}\n${run.stderr}`,
  );
  const dir = join(root, "docs", "Architecture");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
}

function assertBanner({ name, text }) {
  const lines = text.split(/\r?\n/);
  assert.equal(lines[0], MARKER, `${name}: line 1 is the opt-out marker`);
  assert.match(
    lines[1],
    /^<!-- GENERATED FILE -- do not edit by hand\.$/,
    `${name}: line 2 opens the do-not-edit banner`,
  );
  assert.match(
    lines[2],
    /^ {5}Regenerate with `bun run graph[^`]*`\. -->$/,
    `${name}: line 3 names the regenerate command`,
  );
  assert.equal(lines[3], "", `${name}: a blank line ends the banner`);
  assert.match(lines[4], /^# /, `${name}: the title follows the banner`);
}

test("every markdown report the generator writes opens with the opt-out marker and a banner", () => {
  const root = makeFixture();
  try {
    const docs = generate(root);
    const names = docs.map((d) => d.name).sort();
    assert.deepEqual(names, [
      "DEPENDENCY_GRAPH.md",
      "FILE_INVENTORY.md",
      "duplicate-symbols.md",
      "unused-analysis.md",
    ]);
    docs.forEach(assertBanner);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the test coverage report carries the banner when --include-tests writes it", () => {
  const root = makeFixture();
  try {
    const docs = generate(root, ["--include-tests"]);
    const coverage = docs.find((d) => d.name === "TEST_COVERAGE.md");
    assert.ok(coverage, "--include-tests writes TEST_COVERAGE.md");
    assertBanner(coverage);
    assert.match(
      coverage.text.split(/\r?\n/)[2],
      /bun run graph --include-tests/,
      "TEST_COVERAGE.md names the flag that produces it",
    );
    docs.forEach(assertBanner);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
