#!/usr/bin/env node
// Applies the §98 publish-name mapping to a staging copy of the workspace.
// Usage:
//   node tools/apply-publish-names.mjs             (check only — writes nothing)
//   node tools/apply-publish-names.mjs --out=<dir> (write the staging tree)
//   exit 0 = clean, 1 = problems
//
// The owner decided on 2026-07-29 (spec §98, revision 1.6) that the workspace
// keeps its short internal names — `four` and `@fourjs/*` — and that the published
// names live in the owner's personal npm scope: `four` → `@danielsimonjr/fourjs`
// and `@fourjs/<name>` → `@danielsimonjr/fourjs-<name>`. The spec says the mapping
// "is applied mechanically at release time"; this is that mechanism.
//
// Two rules shape the whole script:
//
//   1. **Never in place.** Renaming packages in the checkout would leave a
//      developer — or a half-finished CI job — with a tree whose imports no
//      longer match its manifests, and a `git status` that invites committing
//      the rename. Everything is written under `--out`; the workspace is only
//      ever read. The release workflow publishes *from* the staging tree.
//
//   2. **Rename and nothing else.** In the manifest the only fields touched are
//      `name`, the four dependency maps' workspace-owned keys, and the
//      `workspace:` ranges those keys carry (which npm cannot resolve — a workspace manager
//      rewrites them during its own publish, and publishing from a staging tree
//      means doing it here). In particular `exports` is copied through
//      untouched: the umbrella's 25 subpath entries are the §91 tree-shaking
//      contract, and a rewrite that quietly dropped or reordered one would be
//      invisible until a consumer's `import "@danielsimonjr/fourjs/scene"`
//      failed. `checkRewrite` asserts it.
//
// The emitted code is renamed too, and it has to be: `tsc` writes the workspace
// specifier straight through, so `packages/animation/dist/index.js` says
// `from "@fourjs/core"`. Publish that beside a manifest whose dependency is now
// `@danielsimonjr/fourjs-core` and every package resolves nothing — the rename
// would ship broken on the first release and look fine in review. `rewriteCode`
// therefore rewrites *quoted* workspace names in the staged `.js`/`.d.ts`: real
// specifiers, the per-package `PACKAGE_NAME` constants, and the `from "fourJS"`
// lines inside JSDoc examples, all of which name the package rather than talk
// about it. Unquoted prose (`` `@fourjs/animation` — the public surface … ``) is
// left alone, and so are READMEs, which already end with their own "Workspace
// name `@fourjs/x`; publishes as `…`" line. Rewriting prose mechanically is a
// different and much riskier job than rewriting a name, and it is not this
// tool's.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(HERE, "..");

/** Workspace name of the umbrella package (§98). */
export const WORKSPACE_UMBRELLA = "fourJS";
/** Scope prefix every non-umbrella workspace package uses. */
export const WORKSPACE_SCOPE = "@fourjs/";
/** Published name of the umbrella package (owner decision 2026-07-29). */
export const PUBLISH_UMBRELLA = "@danielsimonjr/fourjs";
/** Published-name prefix for every other package. */
export const PUBLISH_PREFIX = "@danielsimonjr/fourjs-";

/** The dependency maps npm resolves at install time, plus devDependencies. */
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

/**
 * Maps a workspace package name to its published name, or returns null for a
 * name this workspace does not own (`vite`, `@dimforge/rapier2d-compat`, …).
 */
export function publishName(name) {
  if (name === WORKSPACE_UMBRELLA) return PUBLISH_UMBRELLA;
  if (name.startsWith(WORKSPACE_SCOPE)) {
    return PUBLISH_PREFIX + name.slice(WORKSPACE_SCOPE.length);
  }
  return null;
}

/**
 * Resolves one `workspace:` range against the depended package's version, the
 * way workspace publish helpers substitute: bare `*` pins the exact version, `^`/`~`
 * become that prefix on it, and an explicit range is kept as written. Anything
 * that is not a `workspace:` protocol range passes through untouched.
 */
export function resolveWorkspaceRange(range, version) {
  if (!range.startsWith("workspace:")) return range;
  const rest = range.slice("workspace:".length);
  if (rest === "*") return version;
  if (rest === "^") return `^${version}`;
  if (rest === "~") return `~${version}`;
  return rest;
}

/**
 * Returns a rewritten copy of `manifest`. `versions` maps workspace name →
 * version, and must contain every workspace package the manifest depends on.
 * Key order is preserved so a staged manifest diffs cleanly against its source.
 */
export function rewriteManifest(manifest, versions) {
  const out = {};
  for (const [key, value] of Object.entries(manifest)) {
    if (key === "name") {
      out.name = publishName(value) ?? value;
    } else if (
      DEPENDENCY_FIELDS.includes(key) &&
      value &&
      typeof value === "object"
    ) {
      const deps = {};
      for (const [dep, range] of Object.entries(value)) {
        const renamed = publishName(dep);
        deps[renamed ?? dep] =
          renamed === null
            ? range
            : resolveWorkspaceRange(range, versions.get(dep) ?? "0.0.0");
      }
      out[key] = deps;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Compares a rewritten manifest against its source and returns human-readable
 * problems. These are the invariants a release depends on, checked per package
 * rather than trusted: the rename is total, the export surface is identical,
 * and nothing npm will install still points at a workspace-only name or range.
 */
export function checkRewrite(source, rewritten) {
  const problems = [];
  const expected = publishName(source.name);
  if (expected === null) {
    problems.push(
      `"${source.name}" is not a workspace-owned name (expected "four" or "@fourjs/*")`,
    );
  } else if (rewritten.name !== expected) {
    problems.push(`name is "${rewritten.name}", expected "${expected}"`);
  }

  // The §91 tree-shaking contract. Compared as text so a reordered or retyped
  // condition ("import" → "default") counts as a change, not just a lost key.
  const sourceExports = JSON.stringify(source.exports ?? null);
  const rewrittenExports = JSON.stringify(rewritten.exports ?? null);
  if (sourceExports !== rewrittenExports) {
    problems.push(
      "`exports` changed — subpath entries must survive the rewrite byte for byte",
    );
  }

  for (const field of DEPENDENCY_FIELDS) {
    for (const [dep, range] of Object.entries(rewritten[field] ?? {})) {
      if (publishName(dep) !== null) {
        problems.push(`${field}."${dep}" still carries a workspace-only name`);
      }
      if (typeof range === "string" && range.startsWith("workspace:")) {
        problems.push(
          `${field}."${dep}" still carries the unresolvable range "${range}"`,
        );
      }
    }
  }

  // Backstop for anything the field-by-field walk above does not know about:
  // a future manifest field holding a workspace name (a `bin` map, a
  // `publishConfig.directory`, an `imports` alias) would slip past it.
  const residue = JSON.stringify(rewritten).match(/@fourjs\//g);
  if (residue) {
    problems.push(
      `${residue.length} "@fourjs/" string(s) survive in the rewritten manifest`,
    );
  }
  if (!Array.isArray(rewritten.files) || rewritten.files.length === 0) {
    problems.push(
      "no `files` array — the staging copy would not know what to publish",
    );
  }
  return problems;
}

/** File extensions whose contents carry module specifiers worth rewriting. */
const CODE_EXTENSIONS = [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"];

// A quoted scoped workspace name is unmistakable, so it is rewritten wherever it
// appears. The umbrella's bare `four` is an ordinary English word, so it is
// rewritten only in the three positions where a string is a module specifier.
// Subpaths included: `"@fourjs/render-webgl/register"` is as real a specifier as
// `"@fourjs/render-webgl"`, and the validator below flags both. Matching only the bare
// name left every subpath token behind and failed the run it was meant to protect.
const SCOPED_STRING = /(["'])@fourjs\/([a-z0-9-]+(?:\/[a-z0-9-]+)*)\1/g;
const BARE_SPECIFIER =
  /(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(["'])fourJS((?:\/[a-z0-9-]+)*)\2/g;

/**
 * Rewrites workspace names inside emitted code. Returns the new text and the
 * number of substitutions, which the CLI reports so a release cannot silently
 * stage a tree where nothing was renamed.
 */
export function rewriteCode(text) {
  let count = 0;
  let out = text.replace(BARE_SPECIFIER, (_m, lead, quote, subpath) => {
    count += 1;
    return `${lead}${quote}${PUBLISH_UMBRELLA}${subpath}${quote}`;
  });
  out = out.replace(SCOPED_STRING, (_m, quote, name) => {
    count += 1;
    return `${quote}${PUBLISH_PREFIX}${name}${quote}`;
  });
  return { text: out, count };
}

/** Every file under `dir`, recursively. */
function walkFiles(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...walkFiles(path));
    else found.push(path);
  }
  return found;
}

/**
 * Expands root `package.json`'s `workspaces` list (RFC 0006 / Bun). Deliberately
 * understands only the two forms this repository uses — a literal directory and
 * a `dir/*` glob — and fails loudly on anything else rather than guessing,
 * because a silently mis-expanded pattern here means a package quietly missing
 * from a release.
 */
export function workspacePatterns(root) {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const raw = manifest.workspaces;
  if (Array.isArray(raw)) return raw.map(String);
  if (raw && typeof raw === "object" && Array.isArray(raw.packages)) {
    return raw.packages.map(String);
  }
  throw new Error(
    'root package.json must declare "workspaces": ["packages/*"] (or { packages: [...] })',
  );
}

/** Reads every workspace package: `{ relDir, dir, manifest }`, sorted by directory. */
export function readWorkspacePackages(root = DEFAULT_ROOT) {
  const dirs = [];
  for (const pattern of workspacePatterns(root)) {
    if (pattern.includes("**") || pattern.startsWith("!")) {
      throw new Error(
        `apply-publish-names understands only "dir" and "dir/*" workspace patterns; ` +
          `package.json workspaces carries "${pattern}"`,
      );
    }
    if (pattern.endsWith("/*")) {
      const parent = join(root, pattern.slice(0, -2));
      if (!existsSync(parent)) continue;
      for (const name of readdirSync(parent)) {
        const dir = join(parent, name);
        if (
          statSync(dir).isDirectory() &&
          existsSync(join(dir, "package.json"))
        ) {
          dirs.push(dir);
        }
      }
    } else if (existsSync(join(root, pattern, "package.json"))) {
      dirs.push(join(root, pattern));
    }
  }
  return dirs
    .sort((a, b) => a.localeCompare(b))
    .map((dir) => ({
      dir,
      relDir: relative(root, dir).split("\\").join("/"),
      manifest: JSON.parse(readFileSync(join(dir, "package.json"), "utf8")),
    }));
}

/**
 * Copies one package's publishable content into `<outDir>/<name>/`: the rewritten
 * manifest, everything its `files` array names, README, LICENSE and CHANGELOG.
 * npm always packs README and LICENSE regardless of `files`, but NOT CHANGELOG.md,
 * so a staged CHANGELOG is added to the staged manifest's `files` (TODO 972). A
 * package with no LICENSE of its own inherits the repository's, which is what
 * workspace publish helpers do and npm alone does not.
 */
function stagePackage(root, pkg, rewritten, outDir) {
  const problems = [];
  const dest = join(
    outDir,
    rewritten.name.replace(/^@/, "").split("/").join("__"),
  );
  mkdirSync(dest, { recursive: true });
  const shipsChangelog =
    existsSync(join(pkg.dir, "CHANGELOG.md")) &&
    !(rewritten.files ?? []).includes("CHANGELOG.md");
  const manifest = shipsChangelog
    ? { ...rewritten, files: [...rewritten.files, "CHANGELOG.md"] }
    : rewritten;
  writeFileSync(
    join(dest, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  for (const entry of rewritten.files ?? []) {
    const from = join(pkg.dir, entry);
    if (!existsSync(from)) {
      problems.push(
        `${pkg.relDir}: files entry "${entry}" does not exist (build before staging)`,
      );
      continue;
    }
    cpSync(from, join(dest, entry), { recursive: true });
  }
  for (const name of ["README.md", "CHANGELOG.md", "LICENSE"]) {
    const from = join(pkg.dir, name);
    if (existsSync(from)) cpSync(from, join(dest, name));
    else if (name === "LICENSE" && existsSync(join(root, "LICENSE"))) {
      cpSync(join(root, "LICENSE"), join(dest, name));
    }
  }

  let rewrites = 0;
  for (const file of walkFiles(dest)) {
    if (!CODE_EXTENSIONS.some((ext) => file.endsWith(ext))) continue;
    const { text, count } = rewriteCode(readFileSync(file, "utf8"));
    if (count > 0) writeFileSync(file, text);
    rewrites += count;
    // Residue check on the staged bytes themselves, not on what the rewrite
    // believed it did: a quoted workspace name left in a shipped file is the
    // one failure mode of this tool that a consumer discovers instead of CI.
    if (/(["'])@fourjs\//.test(text)) {
      problems.push(
        `${relative(outDir, file)}: a quoted "@fourjs/" name survives in the staged file`,
      );
    }
  }
  return { problems, rewrites };
}

/** Runs the whole pass. Returns `{ problems, notes, staged, rewrites }`. */
export function applyPublishNames({ root = DEFAULT_ROOT, outDir = null } = {}) {
  const packages = readWorkspacePackages(root);
  const versions = new Map(
    packages.map((p) => [p.manifest.name, p.manifest.version]),
  );
  const problems = [];
  const notes = [];
  const staged = [];

  for (const pkg of packages) {
    // Private workspaces are build tools, never release candidates. Keep them
    // in version discovery so a public dependency on one is still validated.
    if (pkg.manifest.private === true) continue;
    const rewritten = rewriteManifest(pkg.manifest, versions);
    for (const problem of checkRewrite(pkg.manifest, rewritten)) {
      problems.push(`${pkg.relDir}: ${problem}`);
    }
    staged.push({ ...pkg, rewritten });
  }

  const unversioned = staged.filter((p) => p.manifest.version === "0.0.0");
  if (unversioned.length) {
    notes.push(
      `${unversioned.length} package(s) are still at 0.0.0 — \`changeset version\` must run ` +
        `before a real publish, or every resolved workspace range pins 0.0.0`,
    );
  }

  let rewrites = 0;
  if (outDir !== null && problems.length === 0) {
    mkdirSync(outDir, { recursive: true });
    for (const pkg of staged) {
      const result = stagePackage(root, pkg, pkg.rewritten, outDir);
      problems.push(...result.problems);
      rewrites += result.rewrites;
    }
  }
  return { problems, notes, staged, rewrites };
}

// --- CLI -------------------------------------------------------------------

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const outArg = process.argv.slice(2).find((a) => a.startsWith("--out="));
  const unknown = process.argv.slice(2).filter((a) => !a.startsWith("--out="));
  if (unknown.length) {
    console.error(
      `apply-publish-names: unknown argument(s): ${unknown.join(" ")}`,
    );
    console.error("usage: node tools/apply-publish-names.mjs [--out=<dir>]");
    process.exit(1);
  }

  const outDir = outArg ? outArg.slice("--out=".length) : null;
  const { problems, notes, staged, rewrites } = applyPublishNames({ outDir });

  for (const note of notes) console.log(`apply-publish-names: note — ${note}`);
  if (problems.length) {
    console.error(`apply-publish-names: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  for (const pkg of staged)
    console.log(`  ${pkg.manifest.name} → ${pkg.rewritten.name}`);
  const umbrella = staged.find((p) => p.manifest.name === WORKSPACE_UMBRELLA);
  const exportCount = Object.keys(umbrella?.rewritten.exports ?? {}).length;
  console.log(
    outDir === null
      ? `apply-publish-names: OK (${staged.length} packages check clean, ` +
          `${exportCount} umbrella exports preserved; nothing written)`
      : `apply-publish-names: OK (${staged.length} packages staged in ${outDir}, ` +
          `${exportCount} umbrella exports preserved, ${rewrites} code specifiers rewritten)`,
  );
}
