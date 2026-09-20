// Unit tests for tools/apply-publish-names.mjs.
// Usage: node --test tools/apply-publish-names.test.mjs   (bun run publish-names:test)
//
// Half of these run against fixtures and half against the real workspace. The
// real-workspace half is the point: the §98 mapping has exactly one chance to be
// right — the first publish — and the failure it would produce (a package whose
// subpath exports or workspace deps changed shape during the rename) is not
// visible in a diff of the checkout, because the tool never writes to it.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PUBLISH_PREFIX,
  PUBLISH_UMBRELLA,
  applyPublishNames,
  checkRewrite,
  publishName,
  readWorkspacePackages,
  resolveWorkspaceRange,
  rewriteCode,
  rewriteManifest,
  strippedOfComments,
} from "./apply-publish-names.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- name mapping ----------------------------------------------------------

test("publishName maps the umbrella and the scoped packages, and only those", () => {
  assert.equal(publishName("fourJS"), "@danielsimonjr/fourjs");
  assert.equal(publishName("@fourjs/core"), "@danielsimonjr/fourjs-core");
  assert.equal(
    publishName("@fourjs/physics-rapier"),
    "@danielsimonjr/fourjs-physics-rapier",
  );
  assert.equal(publishName("@dimforge/rapier2d-compat"), null);
  assert.equal(publishName("vite"), null);
  assert.equal(publishName("fourjs"), null); // lowercase is NOT the umbrella name
  assert.equal(publishName("fourier"), null); // a prefix is not the name
});

test("resolveWorkspaceRange reproduces workspace publish-time substitution", () => {
  assert.equal(resolveWorkspaceRange("workspace:*", "0.1.0"), "0.1.0");
  assert.equal(resolveWorkspaceRange("workspace:^", "0.1.0"), "^0.1.0");
  assert.equal(resolveWorkspaceRange("workspace:~", "0.1.0"), "~0.1.0");
  assert.equal(resolveWorkspaceRange("workspace:^1.2.3", "0.1.0"), "^1.2.3");
  assert.equal(resolveWorkspaceRange("^0.19.3", "0.1.0"), "^0.19.3"); // registry dep
});

// --- manifest rewrite ------------------------------------------------------

const FIXTURE = {
  name: "@fourjs/render-webgl",
  version: "0.1.0",
  exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  files: ["dist"],
  dependencies: { "@fourjs/core": "workspace:*", "gl-matrix": "^3.4.3" },
  devDependencies: { fourJS: "workspace:^", vitest: "3.2.7" },
};

test("rewriteManifest renames keys, resolves workspace ranges, and leaves the rest alone", () => {
  const versions = new Map([
    ["@fourjs/core", "0.1.0"],
    ["fourJS", "0.1.0"],
  ]);
  const out = rewriteManifest(FIXTURE, versions);
  assert.equal(out.name, "@danielsimonjr/fourjs-render-webgl");
  assert.deepEqual(out.dependencies, {
    "@danielsimonjr/fourjs-core": "0.1.0",
    "gl-matrix": "^3.4.3",
  });
  assert.deepEqual(out.devDependencies, {
    "@danielsimonjr/fourjs": "^0.1.0",
    vitest: "3.2.7",
  });
  assert.deepEqual(out.exports, FIXTURE.exports);
  assert.deepEqual(out.files, FIXTURE.files);
  assert.equal(out.version, "0.1.0");
  assert.deepEqual(Object.keys(out), Object.keys(FIXTURE)); // key order preserved
  assert.equal(FIXTURE.name, "@fourjs/render-webgl"); // source untouched
});

test("checkRewrite rejects a lost export, a missed rename, and an unresolved range", () => {
  const versions = new Map([["@fourjs/core", "0.1.0"]]);
  const good = rewriteManifest(FIXTURE, versions);
  assert.deepEqual(checkRewrite(FIXTURE, good), []);

  const droppedExport = { ...good, exports: {} };
  assert.match(checkRewrite(FIXTURE, droppedExport)[0], /`exports` changed/);

  const missedRename = {
    ...good,
    dependencies: { "@fourjs/core": "workspace:*" },
  };
  const problems = checkRewrite(FIXTURE, missedRename);
  assert.ok(
    problems.some((p) => /still carries a workspace-only name/.test(p)),
  );
  assert.ok(
    problems.some((p) => /still carries the unresolvable range/.test(p)),
  );

  const noFiles = { ...good, files: [] };
  assert.ok(
    checkRewrite(FIXTURE, noFiles).some((p) => /no `files` array/.test(p)),
  );
});

// --- code rewrite ----------------------------------------------------------

test("rewriteCode renames quoted workspace names in emitted code", () => {
  const source = [
    'import { Node } from "@fourjs/scene";',
    'export * from "@fourjs/math";',
    'const mod = await import("fourJS");',
    'export const PACKAGE_NAME = "@fourjs/core";',
    ' * import { Application } from "fourJS";',
  ].join("\n");
  const { text, count } = rewriteCode(source);
  assert.equal(count, 5);
  assert.ok(!/["']@four\//.test(text));
  assert.ok(text.includes(`from "${PUBLISH_PREFIX}scene"`));
  assert.ok(text.includes(`import("${PUBLISH_UMBRELLA}")`));
  assert.ok(text.includes(`PACKAGE_NAME = "${PUBLISH_PREFIX}core"`));
});

test("rewriteCode leaves the English word `four` and unquoted prose alone", () => {
  const source = [
    'const label = "four";',
    'assert.equal(count, "four");',
    " * `@fourjs/animation` — the public surface of the animation pillar.",
  ].join("\n");
  const { text, count } = rewriteCode(source);
  assert.equal(count, 0);
  assert.equal(text, source);
});

// --- the real workspace ----------------------------------------------------

const workspace = readWorkspacePackages(root);
const packages = workspace.filter((p) => p.manifest.private !== true);
const versions = new Map(
  packages.map((p) => [p.manifest.name, p.manifest.version]),
);

test("every publishable workspace package maps to a published name and checks clean", () => {
  assert.ok(
    packages.length >= 24,
    `found only ${packages.length} workspace packages`,
  );
  for (const pkg of packages) {
    const expected = publishName(pkg.manifest.name);
    assert.notEqual(
      expected,
      null,
      `${pkg.relDir}: name "${pkg.manifest.name}" is unmapped`,
    );
    const rewritten = rewriteManifest(pkg.manifest, versions);
    assert.equal(rewritten.name, expected);
    assert.deepEqual(
      checkRewrite(pkg.manifest, rewritten),
      [],
      `${pkg.relDir} rewrites cleanly`,
    );
  }
});

test("no @fourjs/ string survives in any rewritten package.json", () => {
  for (const pkg of packages) {
    const json = JSON.stringify(rewriteManifest(pkg.manifest, versions));
    assert.ok(
      !json.includes("@fourjs/"),
      `${pkg.relDir} still carries an @fourjs/ name`,
    );
    assert.ok(
      !json.includes('"fourJS"'),
      `${pkg.relDir} still carries the bare name "fourJS"`,
    );
  }
});

test("the umbrella's subpath exports survive the rewrite intact (§91 tree-shaking)", () => {
  const umbrella = packages.find((p) => p.manifest.name === "fourJS");
  assert.ok(umbrella, "workspace package `fourJS` not found");
  const rewritten = rewriteManifest(umbrella.manifest, versions);

  // Byte for byte: same keys, same order, same condition objects.
  assert.equal(
    JSON.stringify(rewritten.exports),
    JSON.stringify(umbrella.manifest.exports),
  );
  const keys = Object.keys(rewritten.exports);
  assert.ok(
    keys.length >= 25,
    `umbrella has ${keys.length} exports, expected at least 25`,
  );
  for (const subpath of [
    ".",
    "./scene",
    "./physics-rapier",
    "./render-webgl",
    "./application",
    "./text/harfbuzz",
  ]) {
    assert.ok(keys.includes(subpath), `umbrella export "${subpath}" was lost`);
    assert.equal(
      rewritten.exports[subpath].import,
      umbrella.manifest.exports[subpath].import,
    );
    assert.equal(
      rewritten.exports[subpath].types,
      umbrella.manifest.exports[subpath].types,
    );
  }

  // Every subpath other than "." and "./application" names a package the
  // umbrella depends on, so a renamed dependency map and an unrenamed export
  // map cannot drift apart unnoticed.
  const deps = new Set(Object.keys(rewritten.dependencies));
  for (const subpath of keys) {
    if (subpath === "." || subpath === "./application") continue;
    assert.ok(
      deps.has(PUBLISH_PREFIX + subpath.slice(2).split("/")[0]),
      `umbrella subpath "${subpath}" has no matching published dependency`,
    );
  }
});

test("a check-only run of the whole workspace reports no problems and writes nothing", () => {
  const { problems, staged } = applyPublishNames({ root });
  assert.deepEqual(problems, []);
  assert.equal(staged.length, packages.length);
  for (const pkg of packages) {
    const onDisk = JSON.parse(
      readFileSync(join(pkg.dir, "package.json"), "utf8"),
    );
    assert.equal(
      onDisk.name,
      pkg.manifest.name,
      "the checkout must not be rewritten in place",
    );
  }
});

test("private documentation workspace is discovered but never staged for publication", () => {
  const docs = workspace.find((p) => p.relDir === "tools/docs");
  assert.ok(docs);
  assert.equal(docs.manifest.private, true);
  const { problems, staged, notes } = applyPublishNames({ root });
  assert.deepEqual(problems, []);
  assert.ok(staged.every((p) => p.manifest.private !== true));
  assert.ok(!staged.some((p) => p.manifest.name === docs.manifest.name));
  assert.ok(!notes.some((note) => note.includes("@fourjs-tools/docs")));
});

test("code rewrite preserves nested shaping entry-point specifiers", () => {
  const { text, count } = rewriteCode('export * from "@fourjs/text/harfbuzz";');
  assert.equal(count, 1);
  assert.equal(text, 'export * from "@danielsimonjr/fourjs-text/harfbuzz";');
});

test("code rewrite preserves nested umbrella imports without matching other package names", () => {
  const source = [
    'import { HarfBuzzShapingEngine } from "fourJS/text/harfbuzz";',
    'const mod = await import("fourJS/text/harfbuzz");',
    'import { value } from "fourJS-extra";',
  ].join("\n");
  const { text, count } = rewriteCode(source);
  assert.equal(count, 2);
  assert.ok(text.includes('from "@danielsimonjr/fourjs/text/harfbuzz"'));
  assert.ok(text.includes('import("@danielsimonjr/fourjs/text/harfbuzz")'));
  assert.ok(text.includes('from "fourJS-extra"'));
});

test("a staged package that carries CHANGELOG.md lists it in `files`, so npm packs it", () => {
  // npm always packs package.json, README and LICENSE, but NOT CHANGELOG.md: modern npm dropped it
  // from the always-included set. `npm pack --dry-run` on the staged 0.1.0 tree showed CHANGELOG.md
  // present on disk and absent from the tarball (TODO 972).
  const out = mkdtempSync(join(tmpdir(), "fourjs-stage-"));
  try {
    const { problems, staged } = applyPublishNames({ root, outDir: out });
    assert.deepEqual(problems, []);
    let withChangelog = 0;
    for (const dir of readdirSync(out)) {
      const manifest = JSON.parse(
        readFileSync(join(out, dir, "package.json"), "utf8"),
      );
      if (!existsSync(join(out, dir, "CHANGELOG.md"))) continue;
      withChangelog++;
      assert.ok(
        manifest.files.includes("CHANGELOG.md"),
        `${dir}: CHANGELOG.md staged but not in files`,
      );
    }
    assert.ok(
      withChangelog > 0,
      "control: at least one staged package carries a CHANGELOG",
    );
    assert.equal(staged.length, readdirSync(out).length);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

// The 2026-09-19 dogfood finding: a workspace name inside a TEMPLATE LITERAL is
// invisible to `rewriteCode` (which matches `"` and `'` only, on purpose) and
// was invisible to the staging residue check too. `strippedOfComments` is what
// lets that check tell a runtime message from JSDoc prose.
test("strippedOfComments keeps runtime strings and drops prose", () => {
  const source = [
    "/** A doc comment naming `@fourjs/math` in prose. */",
    "const message = `§83: ${n} @fourjs/math object(s) were constructed`;",
    "// a line comment about @fourjs/render",
    "const ok = `§83: ${n} math object(s) were constructed`;",
  ].join("\n");
  const offenders = strippedOfComments(source)
    .split("\n")
    .filter((line) => /@fourjs\//.test(line));
  assert.equal(
    offenders.length,
    1,
    "only the template-literal message remains",
  );
  assert.match(offenders[0], /object\(s\)/);
  // Control: without the strip, the same scan blames all three lines, which is
  // why the check could not simply widen its quote class.
  assert.equal(
    source.split("\n").filter((line) => /@fourjs\//.test(line)).length,
    3,
  );
  // Control: a file naming only PUBLISHED packages yields nothing.
  assert.equal(
    strippedOfComments('const x = "@danielsimonjr/fourjs-math";')
      .split("\n")
      .filter((line) => /@fourjs\//.test(line)).length,
    0,
  );
});
