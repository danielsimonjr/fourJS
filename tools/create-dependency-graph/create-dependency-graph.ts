#!/usr/bin/env bun

/**
 * Generic Dependency Graph Generator
 *
 * Scans a TypeScript codebase and generates:
 * - docs/Architecture/DEPENDENCY_GRAPH.md (human-readable)
 * - docs/Architecture/dependency-graph.json (machine-readable)
 * - docs/Architecture/dependency-graph.yaml (compact, ~40% smaller than JSON)
 * - docs/Architecture/unused-analysis.md (unused exports + DORMANT FILES)
 *
 * Usage: bun tools/create-dependency-graph/create-dependency-graph.ts --root=.
 *
 * This tool is generic and does not depend on any codebase-specific functions.
 * It dynamically discovers the project structure from the filesystem.
 *
 * Reachability model. A file is "reachable" if a path of imports leads to it
 * from a seeded ROOT. Roots are each package's `src/index.ts` plus every build
 * entry the tool can discover: `exports` subpath targets, `bin` targets, extra
 * `tsup src/*.ts` entries and secondary `tsc -p <cfg>` includes parsed from the
 * package scripts. Edges are followed through four import forms — `import … from`,
 * bare side-effect `import '…'`, inline `import('…')` type expressions, and
 * npm-scoped workspace imports. Files reachable from none of these are DORMANT,
 * split in unused-analysis.md into "orphaned" (reachable from no root and no
 * test — delete/wire candidates) and "test-only" (exercised by a test, ships
 * nothing). `.d.ts` ambient declarations are excluded from the dormant count.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import yaml from "js-yaml";
import { basename, dirname, join, relative } from "path";

// Types
interface Dependency {
  file: string;
  imports: string[];
  reExport?: boolean;
  typeOnly?: boolean; // Track type-only imports
}

interface ExternalDependency {
  package: string;
  imports: string[];
}

interface NodeDependency {
  module: string;
  imports: string[];
}

interface FileExports {
  named: string[];
  default: string | null;
  types: string[];
  interfaces: string[];
  enums: string[];
  classes: string[];
  functions: string[];
  constants: string[];
  reExported: string[]; // Track re-exported symbols
}

interface ParsedFile {
  path: string;
  name: string;
  externalDependencies: ExternalDependency[];
  nodeDependencies: NodeDependency[];
  internalDependencies: Dependency[];
  workspaceDependencies: WorkspaceDependency[];
  packageName: string | null;
  exports: FileExports;
  description: string | null;
}

interface DependencyMatrix {
  [path: string]: {
    importsFrom: string[];
    exportsTo: string[];
  };
}

interface Statistics {
  totalTypeScriptFiles: number;
  totalModules: number;
  totalLinesOfCode: number;
  totalExports: number;
  totalClasses: number;
  totalInterfaces: number;
  totalFunctions: number;
  totalTypeGuards: number;
  totalEnums: number;
  totalConstants: number;
  totalReExports: number;
  totalTypeOnlyImports: number;
  runtimeCircularDeps: number; // Excludes type-only cycles
  typeOnlyCircularDeps: number; // Type-only cycles (not runtime issues)
  unusedFilesCount: number;
  unusedExportsCount: number;
}

interface UnusedExport {
  file: string;
  name: string;
  type:
    "function" | "class" | "interface" | "type" | "constant" | "enum" | "other";
  // How many times the symbol is referenced WITHIN its own file beyond its export
  // definition. > 0 means it's a type contract / helper backing live exports in the
  // same module (not deletable in isolation); 0 means unreferenced anywhere — the
  // true deletion candidates. This split is what makes the report legible.
  inFileRefs: number;
}

interface UnusedAnalysis {
  unusedFiles: string[];
  unusedExports: UnusedExport[];
}

interface ModuleMap {
  [moduleName: string]: {
    [filePath: string]: ParsedFile;
  };
}

interface PackageJson {
  name: string;
  version: string;
}

interface WorkspacePackage {
  name: string; // npm name, e.g., "@danielsimonjr/mathts-core"
  directory: string; // relative dir, e.g., "core"
  srcDir: string; // relative src dir, e.g., "core/src"
  // Source files of package.json `exports` subpath entries other than "." —
  // e.g. core's `"./internal"` → "core/src/internal.ts". These are PUBLIC roots
  // exactly like src/index.ts; without them every symbol reachable only through
  // a subpath entry is false-flagged as unused.
  extraEntries: string[];
}

interface WorkspaceDependency {
  package: string; // workspace package name
  directory: string; // workspace package directory
  imports: string[]; // imported symbols
  // Set when the import specifier targeted an `exports` subpath entry rather than
  // the package root — e.g. `@danielsimonjr/mathts-core/internal` → "internal".
  subpath?: string;
}

// CLI options interface
interface CLIOptions {
  root: string;
  includeTests: boolean;
  all: boolean;
  checkCensus: boolean;
}

// Constants - support CLI argument or current working directory for portability
function parseCliOptions(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    root: process.cwd(),
    includeTests: false,
    all: false,
    checkCensus: false,
  };

  for (const arg of args) {
    if (arg.startsWith("--root=")) {
      options.root = arg.slice(7);
    } else if (arg === "--include-tests" || arg === "-t") {
      options.includeTests = true;
    } else if (arg === "--all" || arg === "-a") {
      options.all = true;
    } else if (arg === "--check-census") {
      options.checkCensus = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Dependency Graph Generator

Usage:
  create-dependency-graph [options] [project-root]

Options:
  --root=<path>      Project root directory (default: current directory)
  --include-tests    Include test files in dependency analysis
  -t                 Short form of --include-tests
  --all, -a          Include dormant/unreachable files (monorepo mode)
  --help, -h         Show this help

Monorepo Support:
  When run from a monorepo root with workspaces in package.json,
  automatically scans all workspace packages and builds a unified graph.
  By default, only files reachable from each package src/index.ts are
  included. Use --all to include dormant code too.

Examples:
  create-dependency-graph                         # Use current directory
  create-dependency-graph ./my-project            # Specify project path
  create-dependency-graph --include-tests         # Include test file analysis
  create-dependency-graph --all                   # Include dormant code
  create-dependency-graph --root=C:/projects/my-app -t
`);
      process.exit(0);
    } else if (!arg.startsWith("-") && existsSync(arg)) {
      // First non-flag argument is the project root
      options.root = arg;
    }
  }

  return options;
}

function getProjectRoot(): string {
  return parseCliOptions().root;
}

const ROOT_DIR = getProjectRoot();
const SRC_DIR = join(ROOT_DIR, "src");
const OUTPUT_DIR = join(ROOT_DIR, "docs", "Architecture");

// Read package.json for version and name
let packageJson: PackageJson = { name: "unknown", version: "0.0.0" };
try {
  packageJson = JSON.parse(
    readFileSync(join(ROOT_DIR, "package.json"), "utf-8"),
  ) as PackageJson;
} catch {
  console.warn("Warning: Could not read package.json, using defaults");
}

// Module-level workspace map (set in main() for monorepo mode)
let workspaceMap: Map<string, WorkspacePackage> = new Map();

/**
 * Detect workspace packages from a monorepo root.
 * Returns a Map keyed by npm package name.
 * Returns empty map if no workspaces field (backward compat with single packages).
 */
/**
 * Bundler entry points declared in a package's config-driven `tsup.config.ts`
 * (`entry: [ 'src/index.ts', 'src/render-file.ts', … ]`), returned as
 * repo-relative source paths (e.g. "plot/src/render-file.ts").
 *
 * Needed because tsup can take its entries EITHER on the command line
 * (`tsup src/index.ts src/worker.ts`, parsed from the build-script string in
 * `exportsSubpathEntries`) OR from `tsup.config.ts` when the script is a bare
 * `tsup`. plot/workbook moved their multi-entry lists into `tsup.config.ts`,
 * which the script-string parser can't see — a build-root REGRESSION that
 * silently dropped `plot/src/render-file.ts` and `workbook/src/run-worker.ts`
 * from the module graph (1088 → 1086). This restores them by reading the config.
 */
function tsupConfigEntries(rootDir: string, pkgDir: string): string[] {
  const cfgPath = join(rootDir, pkgDir, "tsup.config.ts");
  if (!existsSync(cfgPath)) return [];
  let code: string;
  try {
    code = readFileSync(cfgPath, "utf-8");
  } catch {
    return [];
  }
  // Grab the `entry: [ … ]` array literal, then pull its string literals that
  // end in `.ts` (each is a build root emitting its own bundle). Only the array
  // form is supported (the idiom these packages use); an object-map `entry` form
  // would need extending here if a package adopts it.
  const arr = /entry\s*:\s*\[([^\]]*)\]/.exec(code);
  if (!arr) return [];
  const out: string[] = [];
  for (const m of arr[1].matchAll(/['"`]([^'"`]+\.ts)['"`]/g)) {
    out.push(join(pkgDir, m[1]).replace(/\\/g, "/"));
  }
  return out;
}

/**
 * Source files of a package's `exports` subpath entries other than "." —
 * `"./internal": { import: "./dist/internal.js" }` maps to `src/internal.ts`.
 * Returned paths are repo-relative (e.g. "core/src/internal.ts").
 */
function exportsSubpathEntries(
  rootDir: string,
  pkgDir: string,
  pkg: {
    exports?: Record<string, unknown>;
    bin?: Record<string, string> | string;
    scripts?: Record<string, string>;
  },
): string[] {
  const entries: string[] = [];
  const addIfExists = (srcPath: string): void => {
    const norm = srcPath.replace(/\\/g, "/");
    if (existsSync(join(rootDir, srcPath)) && !entries.includes(norm)) {
      entries.push(norm);
    }
  };
  if (pkg.exports && typeof pkg.exports === "object") {
    for (const key of Object.keys(pkg.exports)) {
      if (key === "." || !key.startsWith("./")) continue;
      const name = key.slice(2); // "./internal" → "internal"
      addIfExists(join(pkgDir, "src", `${name}.ts`));
    }
  }
  // `bin` entries (e.g. workbook's mtsw CLI → "./dist/cli.js" → src/cli.ts) are build
  // roots too: nothing imports them, so without seeding them the whole CLI subtree is
  // excluded from the graph and everything it consumes gets false-flagged as unused.
  const binValues =
    typeof pkg.bin === "string"
      ? [pkg.bin]
      : pkg.bin
        ? Object.values(pkg.bin)
        : [];
  for (const bin of binValues) {
    const m = /(?:\.\/)?dist\/(.+)\.[cm]?js$/.exec(bin);
    if (m) addIfExists(join(pkgDir, "src", `${m[1]}.ts`));
  }
  // Bundler entry points declared in the `build`/`dev` scripts — e.g.
  // `tsup src/index.ts src/worker.ts` or `... src/cli.ts`. Each additional
  // `src/*.ts` argument is a BUILD ROOT emitting its own bundle (worker scripts
  // loaded at runtime via `new URL('./worker.js', import.meta.url)`, multi-entry
  // CLIs). Nothing imports them, so they were false-dormant.
  const allScripts = Object.values(pkg.scripts ?? {});
  for (const script of allScripts) {
    if (!script) continue;
    // Direct tsup/build entry args: `... src/foo.ts src/bar.ts ...`
    for (const m of script.matchAll(/(?:^|\s)(src\/[\w./-]+\.ts)\b/g)) {
      addIfExists(join(pkgDir, m[1]));
    }
    // Secondary `tsc -p <tsconfig>` builds (e.g. AssemblyScript JS bindings via
    // `tsc -p tsconfig.bindings.json`): seed that tsconfig's `files`/`include`
    // roots — they are compiled separately and shipped, but nothing imports them.
    for (const m of script.matchAll(/tsc\s+-p\s+([\w./-]+\.json)/g)) {
      seedTsconfigEntries(rootDir, pkgDir, m[1], addIfExists);
    }
  }
  // Config-driven tsup: a `build`/`dev` script that invokes `tsup` with NO
  // explicit `src/*.ts` entry arg reads its entries from `tsup.config.ts`
  // instead — the script-string parse above finds none, so also read the config.
  const buildDevScripts = [pkg.scripts?.build, pkg.scripts?.dev].filter(
    (s): s is string => Boolean(s),
  );
  const hasConfigDrivenTsup = buildDevScripts.some(
    (s) =>
      /(?:^|\s|&|\|)tsup(?:\s|$|&|\|)/.test(s) &&
      !/(?:^|\s)src\/[\w./-]+\.ts\b/.test(s),
  );
  if (hasConfigDrivenTsup) {
    for (const entry of tsupConfigEntries(rootDir, pkgDir)) addIfExists(entry);
  }
  return entries;
}

/**
 * Source files pulled into a bundle by a root-level build/test config through a
 * path the module graph never surfaces — specifically a `new URL('./…/src/x.ts',
 * import.meta.url)` reference, the idiom for a bundler ALIAS or entry target
 * (e.g. `vitest.config.browser.ts` aliasing `workerpool` to a browser shim).
 *
 * Deliberately narrow: it matches ONLY `new URL(...)` source references, NOT
 * arbitrary quoted strings. A config's coverage `include` / test `include` lists
 * name dozens of `src/*.ts` files that are measured or matched, not bundle
 * roots — seeding those would falsely mark their whole import closure reachable
 * and hide genuine dormancy.
 */
function configReferencedEntries(rootDir: string): string[] {
  const out = new Set<string>();
  let names: string[];
  try {
    names = readdirSync(rootDir);
  } catch {
    return [];
  }
  const isConfig = (n: string): boolean =>
    /\.config(\.[\w-]+)?\.(m?[jt]s)$/.test(n) ||
    /^(vite|vitest|rollup|webpack|tsup)\./.test(n);
  for (const name of names) {
    if (!isConfig(name)) continue;
    let code: string;
    try {
      code = readFileSync(join(rootDir, name), "utf-8");
    } catch {
      continue;
    }
    // `new URL('<path ending in src/….ts>', …)` only. Normalize a leading `./`
    // away to match parsedFiles' repo-relative paths.
    for (const m of code.matchAll(
      /new\s+URL\(\s*['"`]([^'"`]*?src\/[\w./-]+\.ts)['"`]/g,
    )) {
      out.add(m[1].replace(/^\.\//, ""));
    }
  }
  return [...out];
}

/**
 * Seed the entry files of a secondary tsconfig (`tsc -p <cfg>`): its explicit
 * `files`, plus non-glob `include` paths that point at a concrete `.ts`. Glob
 * includes (`src/bindings/**`) are expanded to every `.ts` under the base dir,
 * so a whole separately-compiled subtree is treated as reachable rather than
 * false-dormant.
 */
function seedTsconfigEntries(
  rootDir: string,
  pkgDir: string,
  cfgRel: string,
  add: (srcPath: string) => void,
): void {
  const cfgPath = join(rootDir, pkgDir, cfgRel);
  if (!existsSync(cfgPath)) return;
  let cfg: { files?: string[]; include?: string[] };
  try {
    cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
  } catch {
    return;
  }
  const cfgDir = dirname(join(pkgDir, cfgRel));
  const seedPath = (p: string): void => {
    if (p.includes("*")) {
      const base = join(rootDir, cfgDir, p.replace(/\/?\*.*$/, ""));
      if (existsSync(base)) {
        for (const f of getAllSourceTsFiles(base)) {
          add(relative(rootDir, f).replace(/\\/g, "/"));
        }
      }
    } else if (p.endsWith(".ts")) {
      add(join(cfgDir, p));
    }
  };
  for (const f of cfg.files ?? []) seedPath(f);
  for (const inc of cfg.include ?? []) seedPath(inc);
}

/**
 * Workspace globs for a monorepo root, from whichever manifest declares them.
 *
 * Checked in order:
 *  1. `package.json` `workspaces` — npm/yarn. Accepts the array form and yarn's
 *     `{ packages: [...] }` object form.
 *  2. `pnpm-workspace.yaml` `packages` — pnpm keeps its globs out of package.json
 *     entirely, so a pnpm monorepo looks like a single package without this.
 *
 * Negated globs (`!packages/legacy`) are pnpm-only and are dropped rather than
 * honoured: treating one as a literal directory name would silently scan nothing.
 */
function readWorkspacePatterns(rootDir: string): string[] {
  try {
    const rootPkg = JSON.parse(
      readFileSync(join(rootDir, "package.json"), "utf-8"),
    );
    const ws = rootPkg.workspaces;
    const patterns: string[] | undefined = Array.isArray(ws)
      ? ws
      : ws?.packages;
    if (patterns?.length) return patterns.filter((p) => !p.startsWith("!"));
  } catch {
    /* no package.json, or it is not valid JSON — fall through to pnpm */
  }

  try {
    const cfg = yaml.load(
      readFileSync(join(rootDir, "pnpm-workspace.yaml"), "utf-8"),
    ) as { packages?: string[] } | undefined;
    if (Array.isArray(cfg?.packages))
      return cfg.packages.filter((p) => !p.startsWith("!"));
  } catch {
    /* no pnpm-workspace.yaml — single-package repo */
  }

  return [];
}

function detectWorkspaces(rootDir: string): Map<string, WorkspacePackage> {
  const workspaces = new Map<string, WorkspacePackage>();

  try {
    const wsPatterns: string[] = readWorkspacePatterns(rootDir);
    if (wsPatterns.length === 0) return workspaces;

    for (const pattern of wsPatterns) {
      if (pattern.endsWith("/*")) {
        // Glob pattern like "packages/*"
        const parentDir = pattern.slice(0, -2);
        const fullParent = join(rootDir, parentDir);
        if (!existsSync(fullParent)) continue;

        const entries = readdirSync(fullParent);
        for (const entry of entries) {
          const pkgDir = join(parentDir, entry);
          const pkgJsonPath = join(rootDir, pkgDir, "package.json");
          if (existsSync(pkgJsonPath)) {
            try {
              const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
              if (pkg.name) {
                const srcDir = join(pkgDir, "src");
                workspaces.set(pkg.name, {
                  name: pkg.name,
                  directory: pkgDir.replace(/\\/g, "/"),
                  srcDir: srcDir.replace(/\\/g, "/"),
                  extraEntries: exportsSubpathEntries(rootDir, pkgDir, pkg),
                });
              }
            } catch {
              /* skip invalid package.json */
            }
          }
        }
      } else {
        // Direct path like "core", "matrix"
        const pkgJsonPath = join(rootDir, pattern, "package.json");
        if (existsSync(pkgJsonPath)) {
          try {
            const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
            if (pkg.name) {
              const srcDir = join(pattern, "src");
              workspaces.set(pkg.name, {
                name: pkg.name,
                directory: pattern.replace(/\\/g, "/"),
                srcDir: srcDir.replace(/\\/g, "/"),
                extraEntries: exportsSubpathEntries(rootDir, pattern, pkg),
              });
            }
          } catch {
            /* skip invalid package.json */
          }
        }
      }
    }
  } catch {
    /* no package.json or no workspaces field */
  }

  return workspaces;
}

/**
 * Recursively get all TypeScript files in a directory
 */
function getAllTsFiles(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) {
    return files;
  }

  const entries = readdirSync(dir);

  for (const entry of entries) {
    // Skip node_modules directories
    if (entry === "node_modules") {
      continue;
    }

    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      getAllTsFiles(fullPath, files);
    } else if (
      entry.endsWith(".ts") &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".spec.ts")
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Recursively get all test files (.test.ts, .spec.ts) in a directory
 */
/** Recursively collect non-test, non-declaration `.ts` source files under `dir`. */
function getAllSourceTsFiles(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      getAllSourceTsFiles(fullPath, files);
    } else if (
      entry.endsWith(".ts") &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".spec.ts") &&
      !entry.endsWith(".d.ts")
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

function getAllTestFiles(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) {
    return files;
  }

  const entries = readdirSync(dir);

  for (const entry of entries) {
    // Skip node_modules directories
    if (entry === "node_modules") {
      continue;
    }

    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      getAllTestFiles(fullPath, files);
    } else if (entry.endsWith(".test.ts") || entry.endsWith(".spec.ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

// Test coverage analysis interfaces
interface TestCoverageAnalysis {
  sourceFiles: string[];
  testFiles: ParsedFile[];
  coverageMap: Map<string, string[]>; // source file -> test files that import it
  testedFiles: string[];
  untestedFiles: string[];
  testToSourceMap: Map<string, string[]>; // test file -> source files it imports
  policy: CoveragePolicy | null;
  policyBreakdown: CategoryBreakdown;
}

// Coverage-policy support (loaded from docs/Architecture/coverage-policy.json
// if present). Categorises untested files into "intentionally indirect"
// buckets so the headline metric can carry an "effective coverage" companion
// number alongside the raw direct-import figure. See
// docs/Architecture/COVERAGE_POLICY.md for the policy.

interface CoveragePolicyCategory {
  label: string;
  rationale: string;
  pathPrefixes?: string[];
  exactPaths?: string[];
}

interface CoveragePolicy {
  description?: string;
  updated?: string;
  categories: Record<string, CoveragePolicyCategory>;
}

// Per-untested-file classification result. `null` category = active gap (real).
type ClassifiedUntested = { file: string; category: string | null };

// Aggregate breakdown returned alongside the raw counts.
interface CategoryBreakdown {
  // count by category id; key 'active_untested' covers files that match NO policy category.
  byCategory: Record<string, number>;
  // total source files matched by any policy category — these are excluded from the "active" count.
  excludedTotal: number;
  // active reachable file count (sourceFiles.length - excludedTotal).
  activeFiles: number;
  // tested active files (active files - active_untested).
  testedActive: number;
  // effective coverage percent of active code, 1 decimal place.
  effectivePercent: string;
  // per-file classification list (for the JSON output; the markdown summarises).
  classifiedUntested: ClassifiedUntested[];
}

/**
 * Load coverage-policy.json from the project's docs/Architecture/ if present.
 * Returns null when the file is missing — the tool stays backwards-compatible
 * (the breakdown collapses to "active_untested = untestedCount" with no other
 * categories).
 */
function loadCoveragePolicy(rootDir: string): CoveragePolicy | null {
  const policyPath = join(
    rootDir,
    "docs",
    "Architecture",
    "coverage-policy.json",
  );
  if (!existsSync(policyPath)) return null;
  try {
    const raw = readFileSync(policyPath, "utf8");
    const parsed = JSON.parse(raw) as CoveragePolicy;
    if (!parsed.categories || typeof parsed.categories !== "object")
      return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Classify one path against the policy. Returns the category id (e.g.
 * 'synced_mathjs_functions') if it matches any, or null otherwise.
 * `exactPaths` wins over `pathPrefixes` — a file listed by name doesn't
 * get reclassified because some directory it happens to live under is
 * also covered by a prefix.
 */
function classifyAgainstPolicy(
  filePath: string,
  policy: CoveragePolicy | null,
): string | null {
  if (!policy) return null;
  for (const [categoryId, cat] of Object.entries(policy.categories)) {
    if (cat.exactPaths?.includes(filePath)) return categoryId;
  }
  for (const [categoryId, cat] of Object.entries(policy.categories)) {
    if (cat.pathPrefixes) {
      for (const prefix of cat.pathPrefixes) {
        if (filePath.startsWith(prefix)) return categoryId;
      }
    }
  }
  return null;
}

/**
 * Build the per-untested-file classification and aggregate counts.
 * Note: the policy applies to ALL source files (so we can compute how many
 * synced files are also tested, e.g. via the typed/ layer), but the
 * effective-coverage metric is computed over the active (non-excluded) set
 * only.
 */
function buildCategoryBreakdown(
  sourceFiles: string[],
  testedFiles: string[],
  untestedFiles: string[],
  policy: CoveragePolicy | null,
): CategoryBreakdown {
  const byCategory: Record<string, number> = {};
  if (policy) {
    for (const id of Object.keys(policy.categories)) byCategory[id] = 0;
  }
  byCategory.active_untested = 0;

  const classifiedUntested: ClassifiedUntested[] = [];
  for (const f of untestedFiles) {
    const cat = classifyAgainstPolicy(f, policy);
    if (cat) {
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    } else {
      byCategory.active_untested = (byCategory.active_untested ?? 0) + 1;
    }
    classifiedUntested.push({ file: f, category: cat });
  }

  // The "excluded" denominator is every SOURCE file (tested or not) that
  // matches a policy category. For the active-tested calculation we also
  // need to know how many tested files fall inside excluded categories —
  // they shouldn't count toward the active-tested numerator.
  let excludedTotal = 0;
  let testedExcluded = 0;
  const testedSet = new Set(testedFiles);
  for (const f of sourceFiles) {
    const cat = classifyAgainstPolicy(f, policy);
    if (cat) {
      excludedTotal++;
      if (testedSet.has(f)) testedExcluded++;
    }
  }
  const activeFiles = sourceFiles.length - excludedTotal;
  const testedActive = testedFiles.length - testedExcluded;
  const effectivePercent =
    activeFiles > 0 ? ((testedActive / activeFiles) * 100).toFixed(1) : "0";

  return {
    byCategory,
    excludedTotal,
    activeFiles,
    testedActive,
    effectivePercent,
    classifiedUntested,
  };
}

// Re-export map: barrel file -> source files it re-exports from
type ReExportMap = Map<string, Set<string>>;

/**
 * Build a map of barrel files to the source files they re-export from.
 * This allows tracing imports through barrel files (index.ts) to find
 * the actual source files being tested.
 */
function buildReExportMap(sourceFiles: ParsedFile[]): ReExportMap {
  const reExportMap: ReExportMap = new Map();
  const sourceFilePaths = new Set(sourceFiles.map((f) => f.path));

  // Find all barrel files (files with re-exports)
  for (const file of sourceFiles) {
    const reExportedSources = new Set<string>();

    for (const dep of file.internalDependencies) {
      if (dep.reExport) {
        // This file re-exports from another file
        const resolved = resolvePath(file.path, dep.file);
        if (sourceFilePaths.has(resolved)) {
          reExportedSources.add(resolved);
        }
      }
    }

    if (reExportedSources.size > 0) {
      reExportMap.set(file.path, reExportedSources);
    }
  }

  // Recursively expand re-exports (handle chains like types/index.ts -> types/types.ts)
  let changed = true;
  while (changed) {
    changed = false;
    for (const [barrelPath, sources] of reExportMap) {
      const expanded = new Set(sources);
      for (const source of sources) {
        // If a source is itself a barrel, add its sources too
        const nestedSources = reExportMap.get(source);
        if (nestedSources) {
          for (const nested of nestedSources) {
            if (!expanded.has(nested)) {
              expanded.add(nested);
              changed = true;
            }
          }
        }
      }
      reExportMap.set(barrelPath, expanded);
    }
  }

  return reExportMap;
}

/**
 * Get all source files that are ultimately imported through a barrel file chain.
 * Given an import to a barrel file, returns all source files it re-exports.
 */
function traceReExports(
  importedPath: string,
  reExportMap: ReExportMap,
): Set<string> {
  const result = new Set<string>();
  result.add(importedPath); // Always include the directly imported file

  const sources = reExportMap.get(importedPath);
  if (sources) {
    for (const source of sources) {
      result.add(source);
    }
  }

  return result;
}

/**
 * Analyze test coverage by mapping source files to test files.
 * Traces imports through barrel files (index.ts) to find all source files
 * that are indirectly tested through re-exports.
 */
function analyzeTestCoverage(
  sourceFiles: ParsedFile[],
  testFiles: ParsedFile[],
): TestCoverageAnalysis {
  const sourceFilePaths = new Set(sourceFiles.map((f) => f.path));
  const coverageMap = new Map<string, string[]>();
  const testToSourceMap = new Map<string, string[]>();

  // Build re-export map to trace imports through barrel files
  const reExportMap = buildReExportMap(sourceFiles);

  // Initialize coverage map with empty arrays
  for (const source of sourceFiles) {
    coverageMap.set(source.path, []);
  }

  // Helper to add test coverage for a source file
  const addCoverage = (
    sourcePath: string,
    testPath: string,
    importedSources: string[],
  ) => {
    if (!importedSources.includes(sourcePath)) {
      importedSources.push(sourcePath);
    }
    const tests = coverageMap.get(sourcePath) || [];
    if (!tests.includes(testPath)) {
      tests.push(testPath);
      coverageMap.set(sourcePath, tests);
    }
  };

  // Analyze each test file to see which source files it imports
  for (const testFile of testFiles) {
    const importedSources: string[] = [];

    for (const dep of testFile.internalDependencies) {
      // Resolve the import path relative to the test file
      const resolvedPath = resolvePath(testFile.path, dep.file);

      // Check if it's a source file (in src/)
      if (sourceFilePaths.has(resolvedPath)) {
        // Add the directly imported file
        addCoverage(resolvedPath, testFile.path, importedSources);

        // Trace through barrel re-exports to find underlying source files
        const reExportedSources = traceReExports(resolvedPath, reExportMap);
        for (const reExportedPath of reExportedSources) {
          if (sourceFilePaths.has(reExportedPath)) {
            addCoverage(reExportedPath, testFile.path, importedSources);
          }
        }
      }

      // Also check without .ts extension variations
      const withoutTs = resolvedPath.replace(/\.ts$/, "");
      const withTs = withoutTs + ".ts";
      if (sourceFilePaths.has(withTs)) {
        addCoverage(withTs, testFile.path, importedSources);

        // Trace through barrel re-exports
        const reExportedSources = traceReExports(withTs, reExportMap);
        for (const reExportedPath of reExportedSources) {
          if (sourceFilePaths.has(reExportedPath)) {
            addCoverage(reExportedPath, testFile.path, importedSources);
          }
        }
      }
    }

    testToSourceMap.set(testFile.path, importedSources);
  }

  // Determine tested and untested files
  const testedFiles: string[] = [];
  const untestedFiles: string[] = [];

  for (const [sourcePath, tests] of coverageMap) {
    if (tests.length > 0) {
      testedFiles.push(sourcePath);
    } else {
      untestedFiles.push(sourcePath);
    }
  }

  const policy = loadCoveragePolicy(ROOT_DIR);
  const sourcePaths = sourceFiles.map((f) => f.path);
  const policyBreakdown = buildCategoryBreakdown(
    sourcePaths,
    testedFiles,
    untestedFiles,
    policy,
  );

  return {
    sourceFiles: sourcePaths,
    testFiles,
    coverageMap,
    testedFiles,
    untestedFiles,
    testToSourceMap,
    policy,
    policyBreakdown,
  };
}

/**
 * Parse a TypeScript file for imports and exports
 */
function parseFile(filePath: string): ParsedFile {
  const content = readFileSync(filePath, "utf-8");
  const relativePath = relative(ROOT_DIR, filePath).replace(/\\/g, "/");

  // Determine which workspace package this file belongs to
  let detectedPackageName: string | null = null;
  for (const [name, ws] of workspaceMap) {
    if (relativePath.startsWith(ws.directory + "/")) {
      detectedPackageName = name;
      break;
    }
  }

  // Strip comments for import/export parsing (prevents picking up imports in JSDoc examples)
  const code = content
    .replace(/\/\*[\s\S]*?\*\//g, "") // Remove block comments (/** ... */ and /* ... */)
    .replace(/\/\/.*$/gm, ""); // Remove single-line comments

  const result: ParsedFile = {
    path: relativePath,
    name: basename(filePath, ".ts"),
    externalDependencies: [],
    nodeDependencies: [],
    internalDependencies: [],
    workspaceDependencies: [],
    packageName: detectedPackageName,
    exports: {
      named: [],
      default: null,
      types: [],
      interfaces: [],
      enums: [],
      classes: [],
      functions: [],
      constants: [],
      reExported: [],
    },
    description: extractDescription(content),
  };

  // Parse imports - enhanced to detect type-only imports
  // Matches: import type { ... }, import { type X, Y }, import X from, import * as X from
  const importRegex =
    /import\s+(type\s+)?(?:(?:{([^}]+)}|(\w+)|\*\s+as\s+(\w+))(?:\s*,\s*(?:{([^}]+)}|(\w+)))?)\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  const nodeBuiltins = [
    "fs",
    "path",
    "url",
    "crypto",
    "util",
    "stream",
    "events",
    "buffer",
    "os",
    "child_process",
    "http",
    "https",
    "net",
    "dns",
    "tls",
    "zlib",
    "readline",
    "assert",
    "cluster",
    "dgram",
    "domain",
    "inspector",
    "module",
    "perf_hooks",
    "process",
    "punycode",
    "querystring",
    "repl",
    "string_decoder",
    "timers",
    "tty",
    "v8",
    "vm",
    "worker_threads",
  ];

  while ((match = importRegex.exec(code)) !== null) {
    const isTypeOnlyImport = !!match[1]; // "import type" prefix
    const namedImports = match[2] || match[5] || "";
    const defaultImport = match[3] || match[6] || "";
    const namespaceImport = match[4] || "";
    const source = match[7];

    const imports: string[] = [];
    let hasRuntimeImport = !isTypeOnlyImport;

    if (namedImports) {
      const importItems = namedImports.split(",").map((s) => s.trim());
      for (const item of importItems) {
        // Check for inline type imports: import { type Foo, Bar }
        const isInlineType = item.startsWith("type ");
        const name = item
          .replace(/^type\s+/, "")
          .split(" as ")[0]
          .trim();
        if (name) {
          imports.push(name);
          // If any import is NOT a type, it's a runtime import
          if (!isInlineType && !isTypeOnlyImport) {
            hasRuntimeImport = true;
          }
        }
      }
    }
    if (defaultImport) imports.push(defaultImport);
    if (namespaceImport) imports.push(`* as ${namespaceImport}`);

    const typeOnly = isTypeOnlyImport || !hasRuntimeImport;

    // Check if source is a workspace package import (root or `exports` subpath)
    const wsResolved = resolveWorkspaceSource(source);

    if (source.startsWith(".")) {
      result.internalDependencies.push({
        file: source,
        imports: imports,
        typeOnly: typeOnly,
      });
    } else if (wsResolved) {
      result.workspaceDependencies.push({
        package: wsResolved.ws.name,
        directory: wsResolved.ws.directory,
        imports: imports,
        ...(wsResolved.subpath ? { subpath: wsResolved.subpath } : {}),
      });
    } else if (
      source.startsWith("node:") ||
      nodeBuiltins.includes(source.split("/")[0])
    ) {
      result.nodeDependencies.push({
        module: source.replace("node:", ""),
        imports: imports,
      });
    } else {
      result.externalDependencies.push({
        package: source,
        imports: imports,
      });
    }
  }

  // Bare side-effect imports: `import './register-backends.js';` (no bindings,
  // no `from`). These are real runtime edges — the module runs for its effects
  // (backend registration, polyfills) — but the binding-oriented importRegex
  // above never matches them, so without this pass such modules were
  // false-flagged as dormant. Relative specifiers only (a bare `import 'pkg'`
  // is an external side-effect and irrelevant to reachability here).
  const sideEffectImportRegex = /(?:^|\n)\s*import\s+['"](\.[^'"]+)['"]\s*;?/g;
  while ((match = sideEffectImportRegex.exec(code)) !== null) {
    const source = match[1];
    if (!result.internalDependencies.some((d) => d.file === source)) {
      result.internalDependencies.push({
        file: source,
        imports: [],
        typeOnly: false,
      });
    }
  }

  // Inline import-type expressions: `import('./type/local/Decimal.ts').Decimal`
  // and `typeof import('../foo.js')`. These are type-position dynamic-import
  // references — a real dependency edge (the module supplies the referenced
  // type), but they use neither `from` nor a bare statement, so both regexes
  // above miss them and the referenced module was false-flagged dormant. Record
  // as a type-only edge (it carries no runtime import).
  // The quote class includes the BACKTICK. A dynamic import's argument is an
  // expression, so `import(`./foo.js`)` is legal and is how a specifier gets
  // written when it sits beside interpolated ones; a `['"]`-only class reads it
  // as absent and false-flags the target dormant — the same assumption that let
  // a workspace package name inside a template literal ship twice through
  // `tools/apply-publish-names.mjs` (2026-09-13, 2026-09-19). `entryPoints`
  // above (`/['"`]([^'"`]+\.ts)['"`]/`) already spells the class this way, so
  // the omission here was an inconsistency, not a decision. A specifier with an
  // actual `${…}` in it is still skipped, and correctly: it names no one
  // module. No file in this tree uses the backtick form today, so this changes
  // no generated report — it closes the hole before one does.
  const inlineImportRegex = /\bimport\s*\(\s*['"`](\.[^'"`${]+)['"`]\s*\)/g;
  while ((match = inlineImportRegex.exec(code)) !== null) {
    const source = match[1];
    if (!result.internalDependencies.some((d) => d.file === source)) {
      result.internalDependencies.push({
        file: source,
        imports: [],
        typeOnly: true,
      });
    }
  }

  // Parse exports
  // Named exports: `export { foo, bar as baz }` — record the *exported* name
  // (the alias after `as`), not the local name, so the inventory reflects the
  // public surface (`export { mapSlices as apply }` exports `apply`, not `mapSlices`).
  const namedExportRegex = /export\s*{\s*([^}]+)\s*}/g;
  while ((match = namedExportRegex.exec(code)) !== null) {
    const exports = match[1]
      .split(",")
      .map((s) => {
        const parts = s.split(" as ");
        return cleanExportName(parts[parts.length - 1]);
      })
      .filter(Boolean);
    result.exports.named.push(...exports);
  }

  // Export declarations
  // export const/let/var
  const constExportRegex = /export\s+(?:const|let|var)\s+(\w+)/g;
  while ((match = constExportRegex.exec(code)) !== null) {
    result.exports.constants.push(match[1]);
    result.exports.named.push(match[1]);
  }

  // export function
  const funcExportRegex = /export\s+(?:async\s+)?function\s+(\w+)/g;
  while ((match = funcExportRegex.exec(code)) !== null) {
    result.exports.functions.push(match[1]);
    result.exports.named.push(match[1]);
  }

  // export class
  const classExportRegex = /export\s+class\s+(\w+)/g;
  while ((match = classExportRegex.exec(code)) !== null) {
    result.exports.classes.push(match[1]);
    result.exports.named.push(match[1]);
  }

  // export interface
  const interfaceExportRegex = /export\s+interface\s+(\w+)/g;
  while ((match = interfaceExportRegex.exec(code)) !== null) {
    result.exports.interfaces.push(match[1]);
    result.exports.types.push(match[1]);
  }

  // export type
  const typeExportRegex = /export\s+type\s+(\w+)/g;
  while ((match = typeExportRegex.exec(code)) !== null) {
    result.exports.types.push(match[1]);
  }

  // export enum
  const enumExportRegex = /export\s+enum\s+(\w+)/g;
  while ((match = enumExportRegex.exec(code)) !== null) {
    result.exports.enums.push(match[1]);
    result.exports.named.push(match[1]);
  }

  // export default
  const defaultExportRegex =
    /export\s+default\s+(?:class|function|const|let|var)?\s*(\w+)?/;
  const defaultMatch = code.match(defaultExportRegex);
  if (defaultMatch) {
    result.exports.default = defaultMatch[1] || "default";
  }

  // Re-exports: export * from
  const reExportAllRegex = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = reExportAllRegex.exec(code)) !== null) {
    const reSource = match[1];
    const reWs = resolveWorkspaceSource(reSource);
    if (reWs) {
      result.workspaceDependencies.push({
        package: reWs.ws.name,
        directory: reWs.ws.directory,
        imports: ["*"],
        ...(reWs.subpath ? { subpath: reWs.subpath } : {}),
      });
    } else {
      result.internalDependencies.push({
        file: reSource,
        imports: ["*"],
        reExport: true,
      });
    }
    result.exports.reExported.push(`* from ${reSource}`);
  }

  // Re-exports: export { foo } from
  const reExportNamedRegex =
    /export\s*{\s*([^}]+)\s*}\s*from\s+['"]([^'"]+)['"]/g;
  while ((match = reExportNamedRegex.exec(code)) !== null) {
    const exports = match[1]
      .split(",")
      .map((s) => cleanExportName(s.split(" as ")[0]))
      .filter(Boolean);
    const reSource = match[2];
    const reWs = resolveWorkspaceSource(reSource);
    if (reWs) {
      result.workspaceDependencies.push({
        package: reWs.ws.name,
        directory: reWs.ws.directory,
        imports: exports,
        ...(reWs.subpath ? { subpath: reWs.subpath } : {}),
      });
    } else {
      result.internalDependencies.push({
        file: reSource,
        imports: exports,
        reExport: true,
      });
    }
    result.exports.named.push(...exports);
    result.exports.reExported.push(...exports);
  }

  // Re-exports: export type { foo } from (named type-only re-exports). The plain
  // named regex above only matches `export {` (not `export type {`), so without
  // this every re-exported type/interface looked unused — the bulk of the
  // unused-analysis false positives.
  const reExportTypeNamedRegex =
    /export\s+type\s*{\s*([^}]+)\s*}\s*from\s+['"]([^'"]+)['"]/g;
  while ((match = reExportTypeNamedRegex.exec(code)) !== null) {
    const exports = match[1]
      .split(",")
      .map((s) => cleanExportName(s.split(" as ")[0]))
      .filter(Boolean);
    const reSource = match[2];
    const reWs = resolveWorkspaceSource(reSource);
    if (reWs) {
      result.workspaceDependencies.push({
        package: reWs.ws.name,
        directory: reWs.ws.directory,
        imports: exports,
        ...(reWs.subpath ? { subpath: reWs.subpath } : {}),
      });
    } else {
      result.internalDependencies.push({
        file: reSource,
        imports: exports,
        reExport: true,
        typeOnly: true,
      });
    }
    result.exports.named.push(...exports);
    result.exports.reExported.push(...exports);
  }

  // Re-exports: export type * from (type-only re-exports)
  const reExportTypeAllRegex = /export\s+type\s+\*\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = reExportTypeAllRegex.exec(code)) !== null) {
    const reSource = match[1];
    const reWs = resolveWorkspaceSource(reSource);
    if (reWs) {
      result.workspaceDependencies.push({
        package: reWs.ws.name,
        directory: reWs.ws.directory,
        imports: ["*"],
        ...(reWs.subpath ? { subpath: reWs.subpath } : {}),
      });
    } else {
      result.internalDependencies.push({
        file: reSource,
        imports: ["*"],
        reExport: true,
        typeOnly: true,
      });
    }
    result.exports.reExported.push(`type * from ${match[1]}`);
  }

  // Dedupe exports
  result.exports.named = [...new Set(result.exports.named)];
  result.exports.types = [...new Set(result.exports.types)];
  result.exports.reExported = [...new Set(result.exports.reExported)];

  return result;
}

/**
 * Extract file description from comments
 */

/**
 * Generate a meaningful fallback description from file metadata
 */
function generateFallbackDescription(file: ParsedFile): string {
  const fileName = basename(file.path, ".ts");

  // For index files, describe what they re-export
  if (fileName === "index") {
    if (file.exports.reExported.length > 0) {
      const pkgName =
        file.packageName || dirname(file.path).split("/").pop() || "";
      return `Package entry point for ${pkgName || "module"} (re-exports ${file.exports.reExported.length} symbols)`;
    }
    if (file.exports.named.length > 0) {
      return `Entry point exporting ${file.exports.named.length} symbols`;
    }
    return `Package entry point`;
  }

  // For type-only files
  const hasOnlyTypes =
    file.exports.named.length === 0 &&
    !file.exports.default &&
    (file.exports.interfaces.length > 0 || file.exports.types.length > 0);
  if (hasOnlyTypes) {
    return `Type definitions (${file.exports.interfaces.length} interfaces, ${file.exports.types.filter((t) => !file.exports.interfaces.includes(t)).length} type aliases)`;
  }

  return `${fileName} module`;
}

function extractDescription(content: string): string | null {
  // Try to find JSDoc comment at the top
  const jsdocMatch = content.match(/\/\*\*\s*\n([^*]*(?:\*(?!\/)[^*]*)*)\*\//);
  if (jsdocMatch) {
    const lines = jsdocMatch[1]
      .split("\n")
      .map((line) => line.replace(/^\s*\*\s?/, "").trim())
      .map((line) => {
        // Extract description from @scope/package - description lines
        if (line.startsWith("@") && line.includes(" - ")) {
          return line.split(" - ").slice(1).join(" - ").trim();
        }
        return line;
      })
      .filter((line) => !line.startsWith("@") && line.length > 0)
      .filter((line) => !/^[=\-*~#_]{3,}$/.test(line));
    if (lines.length > 0) {
      return lines[0].slice(0, 120);
    }
  }

  // Try single-line comment
  const singleLineMatch = content.match(/^\/\/\s*(.+)$/m);
  if (singleLineMatch) {
    const desc = singleLineMatch[1].trim();
    if (/^[=\-*~#_]{3,}$/.test(desc)) return null;
    return desc.slice(0, 120);
  }

  return null;
}

/**
 * Clean export name by stripping inline comments and whitespace
 */
function cleanExportName(name: string): string {
  // Remove single-line comments
  let cleaned = name.replace(/\/\/.*$/gm, "");
  // Remove multi-line comments
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, "");
  // Collapse whitespace to single space, then trim
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  // Strip leading type keyword for non-type exports
  if (cleaned.startsWith("type ") && !cleaned.includes("{")) {
    cleaned = cleaned.slice(5).trim();
  }
  return cleaned;
}

/**
 * Dynamically discover and categorize files into modules based on directory structure
 */
function categorizeFiles(
  files: ParsedFile[],
  isMonorepo: boolean = false,
): ModuleMap {
  const modules: ModuleMap = {};

  if (isMonorepo) {
    // Monorepo mode: first level = workspace package directory, second = submodule
    for (const file of files) {
      // Determine package key from path
      let pkgKey = "unknown";
      for (const [, ws] of workspaceMap) {
        if (file.path.startsWith(ws.directory + "/")) {
          pkgKey = ws.directory;
          break;
        }
      }

      // Determine submodule within the package
      const pkgParts = pkgKey.split("/");
      const parts = file.path.split("/");
      const afterPkg = parts.slice(pkgParts.length); // e.g., ['src', 'types', 'Complex.ts']

      if (afterPkg.length >= 2 && afterPkg[0] === "src") {
        if (afterPkg.length === 2) {
          // File directly in src/ (e.g., core/src/index.ts)
          if (!modules[pkgKey]) modules[pkgKey] = {};
          modules[pkgKey][file.path] = file;
        } else {
          // File in subdirectory (e.g., core/src/types/Complex.ts)
          const subModule = `${pkgKey}/${afterPkg[1]}`;
          if (!modules[subModule]) modules[subModule] = {};
          modules[subModule][file.path] = file;
        }
      } else {
        if (!modules[pkgKey]) modules[pkgKey] = {};
        modules[pkgKey][file.path] = file;
      }
    }
  } else {
    // Single-package mode: original behavior
    for (const file of files) {
      const relativePath = file.path;

      // Handle entry point (src/index.ts)
      if (relativePath === "src/index.ts") {
        if (!modules.entry) modules.entry = {};
        modules.entry[relativePath] = file;
        continue;
      }

      // Extract the module name from path (first directory after src/)
      const parts = relativePath.split("/");
      if (parts.length >= 2 && parts[0] === "src") {
        const moduleName = parts[1].replace(".ts", "");

        // If it's a file directly in src/, categorize by filename
        if (parts.length === 2) {
          if (!modules.root) modules.root = {};
          modules.root[relativePath] = file;
        } else {
          // It's in a subdirectory
          if (!modules[moduleName]) modules[moduleName] = {};
          modules[moduleName][relativePath] = file;
        }
      }
    }
  }

  // Remove empty modules
  for (const key of Object.keys(modules)) {
    if (Object.keys(modules[key]).length === 0) {
      delete modules[key];
    }
  }
  return modules;
}

/**
 * Build dependency matrix
 */
function buildDependencyMatrix(files: ParsedFile[]): DependencyMatrix {
  const matrix: DependencyMatrix = {};

  for (const file of files) {
    const importedFrom = new Set<string>();
    const exportsTo = new Set<string>();

    // Find what this file imports from
    for (const dep of file.internalDependencies) {
      importedFrom.add(dep.file);
    }

    // Find what files export to this file
    for (const other of files) {
      if (other.path === file.path) continue;
      for (const dep of other.internalDependencies) {
        const resolvedPath = resolvePath(other.path, dep.file);
        if (
          resolvedPath === file.path ||
          resolvedPath === file.path.replace(".ts", "")
        ) {
          exportsTo.add(other.path);
        }
      }
    }

    matrix[file.path] = {
      importsFrom: [...importedFrom],
      exportsTo: [...exportsTo],
    };
  }

  return matrix;
}

/**
 * Resolve relative path
 */
function resolvePath(fromPath: string, relativePath: string): string {
  const dir = dirname(fromPath);
  let resolved = join(dir, relativePath);

  // Remove .js extension if present
  resolved = resolved.replace(/\.js$/, "");

  // Add .ts extension if not present
  if (!resolved.endsWith(".ts")) {
    resolved = resolved + ".ts";
  }

  // Normalize path separators
  resolved = resolved.replace(/\\/g, "/");

  return resolved;
}

/**
 * Find all files reachable from entry points via internal dependencies (BFS).
 * Used in monorepo mode to distinguish active from dormant code.
 */
function findReachableFiles(
  entryPoints: string[],
  allFiles: ParsedFile[],
): Set<string> {
  const fileMap = new Map<string, ParsedFile>();
  for (const f of allFiles) fileMap.set(f.path, f);

  const reachable = new Set<string>();
  const queue = [...entryPoints];

  while (queue.length > 0) {
    const current = queue.pop()!;
    if (reachable.has(current)) continue;
    reachable.add(current);

    const file = fileMap.get(current);
    if (!file) continue;

    for (const dep of file.internalDependencies) {
      const resolved = resolvePath(current, dep.file);
      if (fileMap.has(resolved) && !reachable.has(resolved)) {
        queue.push(resolved);
      }
    }

    // Workspace (cross-package, scoped-name) imports also reach into
    // the imported package's entry-point file. Without this edge,
    // packages consumed only via their npm-scoped name (e.g.
    // `@danielsimonjr/mathts-workerpool` from `parallel/`) get
    // false-flagged as unused/dormant.
    for (const ws of file.workspaceDependencies) {
      // Subpath imports (`pkg/internal`) reach the subpath entry file, not index.
      const sub = ws.subpath
        ? workspaceEntryPath(ws.package, ws.subpath)
        : undefined;
      const target =
        sub && fileMap.has(sub) ? sub : workspaceEntryPath(ws.package);
      if (target && fileMap.has(target) && !reachable.has(target)) {
        queue.push(target);
      }
    }
  }

  return reachable;
}

/**
 * Resolve a workspace package name to its entry-point file path
 * (`<srcDir>/index.ts`). Returns undefined if the package isn't a
 * known workspace member.
 */
function workspaceEntryPath(
  packageName: string,
  subpath?: string,
): string | undefined {
  const ws = workspaceMap.get(packageName);
  if (!ws) return undefined;
  return `${ws.srcDir}/${subpath ?? "index"}.ts`;
}

/**
 * Resolve an import specifier to a workspace package, including `exports`
 * subpath entries (`@scope/pkg/internal` → pkg + subpath "internal"). A bare
 * `workspaceMap.get(source)` misses subpath imports entirely, so they were
 * misclassified as EXTERNAL dependencies and their imported symbols never
 * registered as usage — the root cause of the number.ts/object.ts
 * unused-analysis false positives.
 */
function resolveWorkspaceSource(
  source: string,
): { ws: WorkspacePackage; subpath?: string } | undefined {
  const exact = workspaceMap.get(source);
  if (exact) return { ws: exact };
  if (source.startsWith(".")) return undefined;
  for (const [name, ws] of workspaceMap) {
    if (source.startsWith(name + "/")) {
      return { ws, subpath: source.slice(name.length + 1) };
    }
  }
  return undefined;
}

interface CircularDependencyResult {
  all: string[][];
  runtime: string[][]; // Non-type-only cycles (real runtime issues)
  typeOnly: string[][]; // Type-only cycles (safe, no runtime impact)
}

/**
 * Detect circular dependencies, distinguishing runtime from type-only cycles
 */
function detectCircularDependencies(
  files: ParsedFile[],
): CircularDependencyResult {
  const filePaths = new Set(files.map((f) => f.path));

  // Build both runtime-only and all-dependencies graphs
  const runtimeGraph = new Map<string, string[]>();
  const allGraph = new Map<string, string[]>();

  for (const file of files) {
    const runtimeDeps: string[] = [];
    const allDeps: string[] = [];

    for (const d of file.internalDependencies) {
      const resolved = resolvePath(file.path, d.file);
      if (filePaths.has(resolved)) {
        allDeps.push(resolved);
        // Only add to runtime graph if NOT type-only
        if (!d.typeOnly) {
          runtimeDeps.push(resolved);
        }
      }
    }
    runtimeGraph.set(file.path, runtimeDeps);
    allGraph.set(file.path, allDeps);
  }

  function findCycles(graph: Map<string, string[]>): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();

    function dfs(node: string, path: string[]): void {
      if (inStack.has(node)) {
        const cycleStart = path.indexOf(node);
        if (cycleStart !== -1) {
          const cycle = path.slice(cycleStart);
          cycle.push(node);
          const cycleKey = [...cycle].sort().join("->");
          if (!cycles.some((c) => [...c].sort().join("->") === cycleKey)) {
            cycles.push(cycle);
          }
        }
        return;
      }

      if (visited.has(node)) return;

      visited.add(node);
      inStack.add(node);
      path.push(node);

      const neighbors = graph.get(node) || [];
      for (const neighbor of neighbors) {
        dfs(neighbor, path);
      }

      path.pop();
      inStack.delete(node);
    }

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        dfs(node, []);
      }
    }

    return cycles;
  }

  const allCycles = findCycles(allGraph);
  const runtimeCycles = findCycles(runtimeGraph);

  // Type-only cycles = cycles in all but not in runtime
  const runtimeCycleKeys = new Set(
    runtimeCycles.map((c) => [...c].sort().join("->")),
  );
  const typeOnlyCycles = allCycles.filter(
    (c) => !runtimeCycleKeys.has([...c].sort().join("->")),
  );

  return {
    all: allCycles,
    runtime: runtimeCycles,
    typeOnly: typeOnlyCycles,
  };
}

interface PublicSurface {
  /** Files whose ENTIRE export list is public (reached by a wildcard `export *`
   *  chain from a package root, or is itself a root). */
  publicWildcardFiles: Set<string>;
  /** `${path}::${name}` for individually named-re-exported public exports. */
  publicNamed: Set<string>;
  /** Public roots beyond each package's `src/index.ts`: `exports` subpath
   *  entries, `bin` targets, and config-referenced bundle entries. */
  extraEntryPaths: Set<string>;
}

/**
 * Compute the package public-API surface: any export surfaced through a
 * package `src/index.ts` (or an equally-public root — an `exports` subpath
 * entry, a `bin` target, or a config-referenced bundle entry) — directly, or
 * re-exported into one via `export … from` (transitively) — is the package's
 * external surface. Shared by `detectUnused` (a public export isn't "unused")
 * and `buildDuplicateEntries` (a public export is a real canonical-candidate
 * signal; an internal one that merely shares a name elsewhere is not).
 */
function computePublicSurface(files: ParsedFile[]): PublicSurface {
  const byPath = new Map(files.map((f) => [f.path, f] as const));
  const publicWildcardFiles = new Set<string>();
  const publicNamed = new Set<string>();

  const markPublic = (file: ParsedFile, seen: Set<string>): void => {
    if (seen.has(file.path)) return;
    seen.add(file.path);
    publicWildcardFiles.add(file.path); // the file's own exports are public
    for (const dep of file.internalDependencies) {
      if (!dep.reExport) continue;
      const target = byPath.get(resolvePath(file.path, dep.file));
      if (!target) continue;
      if (dep.imports.includes("*")) {
        markPublic(target, seen); // export * → every export of the source is public
      } else {
        for (const name of dep.imports)
          publicNamed.add(`${target.path}::${name}`);
      }
    }
  };

  // Public roots: every package src/index.ts PLUS every package.json `exports`
  // subpath entry (e.g. core's `./internal` → core/src/internal.ts). A subpath
  // entry is exactly as public as the index — without seeding it, everything it
  // re-exports (`export * from './number.js'`) is false-flagged as unused.
  const extraEntryPaths = new Set<string>();
  for (const ws of workspaceMap.values()) {
    for (const entry of ws.extraEntries) extraEntryPaths.add(entry);
  }
  // Config-referenced roots (bundler alias / entry targets, e.g. the browser
  // shim aliased in by vitest.config.browser.ts) are entry points too — nothing
  // imports them by design, so they must not be flagged as "unused files".
  for (const entry of configReferencedEntries(ROOT_DIR))
    extraEntryPaths.add(entry);
  for (const file of files) {
    if (
      file.path === "src/index.ts" ||
      file.path.endsWith("/src/index.ts") ||
      extraEntryPaths.has(file.path)
    ) {
      markPublic(file, new Set());
    }
  }

  return { publicWildcardFiles, publicNamed, extraEntryPaths };
}

/**
 * Detect unused files and exports
 */
function detectUnused(
  files: ParsedFile[],
  testFiles: ParsedFile[] = [],
): UnusedAnalysis {
  const filePaths = new Set(files.map((f) => f.path));

  // Build a set of all imported files
  const importedFiles = new Set<string>();
  // Build a map of all imported symbols per file
  const importedSymbols = new Map<string, Set<string>>();

  // Walk source files + test files (when supplied) so that test-only
  // imports (e.g. `resetPolyWasm`, `WASM_TRIDIAG_THRESHOLD`) register as
  // legitimate consumers and don't false-flag exported test helpers.
  for (const file of [...files, ...testFiles]) {
    for (const dep of file.internalDependencies) {
      const resolved = resolvePath(file.path, dep.file);
      if (filePaths.has(resolved)) {
        importedFiles.add(resolved);

        // Track which symbols are imported
        if (!importedSymbols.has(resolved)) {
          importedSymbols.set(resolved, new Set());
        }
        const symbols = importedSymbols.get(resolved)!;
        for (const imp of dep.imports) {
          if (imp === "*" || imp.startsWith("* as ")) {
            // Wildcard OR namespace import (`import * as X`) — every export of the
            // source is reachable (X.foo), so mark all as used. Stripping the alias
            // and recording it as a named symbol false-flagged every namespace-
            // imported module's exports as unused (e.g. dense/arithmetic.ts).
            symbols.add("*");
          } else {
            symbols.add(imp);
          }
        }
      }
    }

    // Cross-package workspace imports count as use of the imported
    // package's entry-point file (and the symbols listed in the
    // import). Without this, every workspace-only consumer looks like
    // dead code to the unused-export detector.
    for (const ws of file.workspaceDependencies) {
      // Subpath imports (`pkg/internal`) mark usage on the subpath entry file.
      const sub = ws.subpath
        ? workspaceEntryPath(ws.package, ws.subpath)
        : undefined;
      const target =
        sub && filePaths.has(sub) ? sub : workspaceEntryPath(ws.package);
      if (!target || !filePaths.has(target)) continue;
      importedFiles.add(target);
      if (!importedSymbols.has(target)) importedSymbols.set(target, new Set());
      const symbols = importedSymbols.get(target)!;
      for (const imp of ws.imports) {
        if (imp === "*" || imp.startsWith("* as ")) {
          symbols.add("*"); // namespace import — all exports reachable via the alias
        } else {
          symbols.add(imp);
        }
      }
    }
  }

  // Public-API surface: any export surfaced through a package `src/index.ts` —
  // directly, or re-exported into one via `export … from` (transitively) — is the
  // package's external surface, consumed by downstream packages / end users, not
  // internal files. Flagging it as "unused" is a false positive (the bulk of the
  // list). Collect it and exclude it below. (Also reused by the duplicate-symbol
  // detector's per-file public flag — see `computePublicSurface`.)
  const { publicWildcardFiles, publicNamed, extraEntryPaths } =
    computePublicSurface(files);

  // Find unused files (excluding entry point and index files which are re-export hubs)
  const unusedFiles: string[] = [];
  for (const file of files) {
    if (file.path === "src/index.ts") continue; // Entry point is always "used"
    if (file.name === "index" && file.exports.reExported.length > 0) continue; // Re-export hubs
    // `exports` subpath / `bin` entry files are roots — nothing imports them by
    // design (e.g. workerpool's worker.ts, loaded at runtime via `new URL(...)`).
    if (extraEntryPaths.has(file.path)) continue;
    if (!importedFiles.has(file.path)) {
      unusedFiles.push(file.path);
    }
  }

  // Find unused exports
  const unusedExports: UnusedExport[] = [];
  for (const file of files) {
    // Package public-API hub: all its exports are the external surface.
    if (publicWildcardFiles.has(file.path)) continue;

    const usedSymbols = importedSymbols.get(file.path);
    const isWildcardImported = usedSymbols?.has("*");

    // Skip if file is not imported at all (already reported as unused file)
    // or if it's wildcard imported (all exports considered used)
    if (!usedSymbols || isWildcardImported) continue;

    // A named export that is re-exported into a package index is public API.
    const isPublic = (name: string): boolean =>
      usedSymbols.has(name) || publicNamed.has(`${file.path}::${name}`);

    // In-file reference count: occurrences of the symbol in its own file beyond
    // the export definition. Splits "type contract / helper backing live exports"
    // (refs > 0) from "unreferenced anywhere" (refs = 0, the deletion candidates).
    let fileContent: string | undefined;
    const inFileRefs = (name: string): number => {
      if (fileContent === undefined) {
        try {
          fileContent = readFileSync(join(ROOT_DIR, file.path), "utf-8");
        } catch {
          fileContent = "";
        }
      }
      const all = (fileContent.match(new RegExp(`\\b${name}\\b`, "g")) || [])
        .length;
      const defs = (
        fileContent.match(
          new RegExp(
            `export\\s+(?:async\\s+)?(?:function|const|let|var|class|interface|type|enum)\\s+${name}\\b`,
            "g",
          ),
        ) || []
      ).length;
      return Math.max(0, all - defs);
    };
    const push = (name: string, type: UnusedExport["type"]): void => {
      unusedExports.push({
        file: file.path,
        name,
        type,
        inFileRefs: inFileRefs(name),
      });
    };

    // Check each export
    for (const fn of file.exports.functions) {
      if (!isPublic(fn)) push(fn, "function");
    }
    for (const cls of file.exports.classes) {
      if (!isPublic(cls)) push(cls, "class");
    }
    for (const iface of file.exports.interfaces) {
      if (!isPublic(iface)) push(iface, "interface");
    }
    for (const type of file.exports.types) {
      if (!isPublic(type) && !file.exports.interfaces.includes(type))
        push(type, "type");
    }
    for (const en of file.exports.enums) {
      if (!isPublic(en)) push(en, "enum");
    }
    for (const constant of file.exports.constants) {
      if (!isPublic(constant)) push(constant, "constant");
    }
  }

  return { unusedFiles, unusedExports };
}

/**
 * Generate statistics from parsed files
 */
function generateStatistics(
  files: ParsedFile[],
  modules: ModuleMap,
  circularDeps: CircularDependencyResult,
  unusedAnalysis: UnusedAnalysis,
): Statistics {
  let totalExports = 0;
  let totalClasses = 0;
  let totalInterfaces = 0;
  let totalFunctions = 0;
  let totalTypeGuards = 0;
  let totalEnums = 0;
  let totalConstants = 0;
  let totalLines = 0;
  let totalReExports = 0;
  let totalTypeOnlyImports = 0;

  for (const file of files) {
    totalExports += file.exports.named.length;
    totalClasses += file.exports.classes.length;
    totalInterfaces += file.exports.interfaces.length;
    totalFunctions += file.exports.functions.length;
    totalEnums += file.exports.enums.length;
    totalConstants += file.exports.constants.length;
    totalReExports += file.exports.reExported.length;

    // Count type-only imports
    totalTypeOnlyImports += file.internalDependencies.filter(
      (d) => d.typeOnly,
    ).length;

    // Count type guards (functions starting with 'is')
    totalTypeGuards += file.exports.functions.filter((f) =>
      f.startsWith("is"),
    ).length;

    // Count lines
    try {
      const content = readFileSync(join(ROOT_DIR, file.path), "utf-8");
      totalLines += content.split("\n").length;
    } catch {
      // Ignore
    }
  }

  return {
    totalTypeScriptFiles: files.length,
    totalModules: Object.keys(modules).length,
    totalLinesOfCode: totalLines,
    totalExports,
    totalClasses,
    totalInterfaces,
    totalFunctions,
    totalTypeGuards,
    totalEnums,
    totalConstants,
    totalReExports,
    totalTypeOnlyImports,
    runtimeCircularDeps: circularDeps.runtime.length,
    typeOnlyCircularDeps: circularDeps.typeOnly.length,
    unusedFilesCount: unusedAnalysis.unusedFiles.length,
    unusedExportsCount: unusedAnalysis.unusedExports.length,
  };
}

/**
 * Generate JSON output
 */
function generateJSON(
  files: ParsedFile[],
  modules: ModuleMap,
  stats: Statistics,
  circularDeps: CircularDependencyResult,
): object {
  const today = new Date().toISOString().split("T")[0];

  // Convert modules to JSON-friendly format
  const modulesJson: Record<string, Record<string, object>> = {};
  for (const [category, categoryFiles] of Object.entries(modules)) {
    modulesJson[category] = {};
    for (const [path, file] of Object.entries(categoryFiles)) {
      const fileData: Record<string, unknown> = {
        description: file.description || generateFallbackDescription(file),
        externalDependencies: file.externalDependencies,
        nodeDependencies: file.nodeDependencies,
        internalDependencies: file.internalDependencies.map((d) => ({
          file: d.file,
          imports: d.imports,
          ...(d.reExport ? { reExport: true } : {}),
          ...(d.typeOnly ? { typeOnly: true } : {}),
        })),
        // Cross-package workspace imports (e.g. `@danielsimonjr/mathts-matrix`). Computed
        // and used for the package-level dependency table, but previously dropped from
        // the per-file JSON, so file-level cross-package edges (tensor→matrix,
        // autograd→tensor, …) were invisible to consumers of dependency-graph.json.
        workspaceDependencies: file.workspaceDependencies,
        exports: file.exports.named,
        reExported:
          file.exports.reExported.length > 0
            ? file.exports.reExported
            : undefined,
        classes:
          file.exports.classes.length > 0 ? file.exports.classes : undefined,
        interfaces:
          file.exports.interfaces.length > 0
            ? file.exports.interfaces
            : undefined,
        functions:
          file.exports.functions.length > 0
            ? file.exports.functions
            : undefined,
        enums: file.exports.enums.length > 0 ? file.exports.enums : undefined,
        constants:
          file.exports.constants.length > 0
            ? file.exports.constants
            : undefined,
      };

      // Clean up undefined values
      Object.keys(fileData).forEach((key) => {
        if (fileData[key] === undefined) {
          delete fileData[key];
        }
      });

      modulesJson[category][path] = fileData;
    }
  }

  // Build layers from modules
  const layers = Object.keys(modules)
    .map((name) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      files: Object.keys(modules[name]),
    }))
    .filter((l) => l.files.length > 0);

  return {
    metadata: {
      name: packageJson.name,
      version: packageJson.version,
      lastUpdated: today,
      totalFiles: stats.totalTypeScriptFiles,
      totalModules: stats.totalModules,
      totalExports: stats.totalExports,
    },
    entryPoints: files
      .filter((f) => f.path.endsWith("src/index.ts"))
      .map((f) => ({
        file: f.path,
        type: "main",
        description: f.description || "Entry Point",
      })),
    modules: modulesJson,
    dependencyGraph: {
      circularDependencies: {
        runtime: circularDeps.runtime,
        typeOnly: circularDeps.typeOnly,
        total: circularDeps.all.length,
        runtimeCount: circularDeps.runtime.length,
        typeOnlyCount: circularDeps.typeOnly.length,
      },
      layers,
    },
    statistics: stats,
  };
}

/**
 * Generate a dynamic Mermaid diagram from actual dependencies
 */
function generateMermaidDiagram(
  modules: ModuleMap,
  files: ParsedFile[],
): string {
  const lines: string[] = [];
  lines.push("```mermaid");
  lines.push("graph TD");

  // Create subgraphs for each module
  const moduleNames = Object.keys(modules);
  const nodeIds = new Map<string, string>();
  let nodeCounter = 0;

  for (const moduleName of moduleNames) {
    const title = moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
    lines.push(`    subgraph ${title}`);

    const moduleFiles = Object.keys(modules[moduleName]);
    for (const filePath of moduleFiles.slice(0, 10)) {
      // Limit to 10 files per module
      const name = basename(filePath, ".ts");
      const nodeId = `N${nodeCounter++}`;
      nodeIds.set(filePath, nodeId);
      lines.push(`        ${nodeId}[${name}]`);
    }

    if (moduleFiles.length > 10) {
      const nodeId = `N${nodeCounter++}`;
      lines.push(`        ${nodeId}[...${moduleFiles.length - 10} more]`);
    }

    lines.push("    end");
    lines.push("");
  }

  // Add edges for dependencies (limited for readability)
  const addedEdges = new Set<string>();
  let edgeCount = 0;
  const maxEdges = 75;

  for (const file of files) {
    const sourceId = nodeIds.get(file.path);
    if (!sourceId) continue;

    for (const dep of file.internalDependencies) {
      if (edgeCount >= maxEdges) break;

      const resolved = resolvePath(file.path, dep.file);
      const targetId = nodeIds.get(resolved);

      if (targetId && sourceId !== targetId) {
        const edgeKey = `${sourceId}-${targetId}`;
        if (!addedEdges.has(edgeKey)) {
          lines.push(`    ${sourceId} --> ${targetId}`);
          addedEdges.add(edgeKey);
          edgeCount++;
        }
      }
    }
  }

  lines.push("```");
  return lines.join("\n");
}

/**
 * Generate Markdown output
 */
function generateMarkdown(
  files: ParsedFile[],
  modules: ModuleMap,
  stats: Statistics,
  circularDeps: CircularDependencyResult,
  matrix: DependencyMatrix,
): string {
  const today = new Date().toISOString().split("T")[0];
  const lines: string[] = [];
  const projectName = packageJson.name || "Project";

  lines.push(`# ${projectName} - Dependency Graph`);
  lines.push("");
  lines.push(
    `**Version**: ${packageJson.version} | **Last Updated**: ${today}`,
  );
  lines.push("");
  lines.push(
    "This document provides a comprehensive dependency graph of all files, components, imports, functions, and variables in the codebase.",
  );
  lines.push("");
  lines.push("---");
  lines.push("");

  // Table of Contents
  lines.push("## Table of Contents");
  lines.push("");
  lines.push("1. [Overview](#overview)");
  lines.push("2. [Package Dependencies](#package-dependencies)");
  let tocIndex = 3;
  for (const category of Object.keys(modules)) {
    const title =
      category.charAt(0).toUpperCase() + category.slice(1).replace(/-/g, " ");
    const slug = category
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    lines.push(`${tocIndex}. [${title} Dependencies](#${slug}-dependencies)`);
    tocIndex++;
  }
  lines.push(`${tocIndex}. [Dependency Matrix](#dependency-matrix)`);
  lines.push(
    `${tocIndex + 1}. [Circular Dependency Analysis](#circular-dependency-analysis)`,
  );
  lines.push(
    `${tocIndex + 2}. [Visual Dependency Graph](#visual-dependency-graph)`,
  );
  lines.push(`${tocIndex + 3}. [Summary Statistics](#summary-statistics)`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Overview
  lines.push('<a id="overview"></a>');
  lines.push("## Overview");
  lines.push("");
  lines.push("The codebase is organized into the following modules:");
  lines.push("");
  for (const [moduleName, moduleFiles] of Object.entries(modules)) {
    const fileCount = Object.keys(moduleFiles).length;
    lines.push(
      `- **${moduleName}**: ${fileCount} file${fileCount !== 1 ? "s" : ""}`,
    );
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // Generate sections for each module category
  for (const [category, categoryFiles] of Object.entries(modules)) {
    const title =
      category.charAt(0).toUpperCase() + category.slice(1).replace(/-/g, " ");
    const sectionSlug = category
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    lines.push(`<a id="${sectionSlug}-dependencies"></a>`);
    lines.push("");
    lines.push(`## ${title} Dependencies`);
    lines.push("");

    for (const [path, file] of Object.entries(categoryFiles)) {
      lines.push(
        `### \`${path}\` - ${file.description || generateFallbackDescription(file)}`,
      );
      lines.push("");

      // External dependencies
      if (file.externalDependencies.length > 0) {
        lines.push("**External Dependencies:**");
        lines.push("| Package | Import |");
        lines.push("|---------|--------|");
        for (const dep of file.externalDependencies) {
          lines.push(`| \`${dep.package}\` | \`${dep.imports.join(", ")}\` |`);
        }
        lines.push("");
      }

      // Workspace (cross-package) dependencies — imports from other monorepo packages
      // (e.g. tensor → matrix, autograd → tensor). Rendered so the per-file sections
      // reflect cross-package edges, not just the package-level table.
      if (file.workspaceDependencies.length > 0) {
        lines.push("**Workspace Dependencies:**");
        lines.push("| Package | Import |");
        lines.push("|---------|--------|");
        for (const dep of file.workspaceDependencies) {
          lines.push(`| \`${dep.package}\` | \`${dep.imports.join(", ")}\` |`);
        }
        lines.push("");
      }

      // Node dependencies
      if (file.nodeDependencies.length > 0) {
        lines.push("**Node.js Built-in Dependencies:**");
        lines.push("| Module | Import |");
        lines.push("|--------|--------|");
        for (const dep of file.nodeDependencies) {
          lines.push(`| \`${dep.module}\` | \`${dep.imports.join(", ")}\` |`);
        }
        lines.push("");
      }

      // Internal dependencies
      if (file.internalDependencies.length > 0) {
        lines.push("**Internal Dependencies:**");
        lines.push("| File | Imports | Type |");
        lines.push("|------|---------|------|");
        for (const dep of file.internalDependencies) {
          let usage = dep.reExport ? "Re-export" : "Import";
          if (dep.typeOnly) usage += " (type-only)";
          lines.push(
            `| \`${dep.file}\` | \`${dep.imports.join(", ")}\` | ${usage} |`,
          );
        }
        lines.push("");
      }

      // Exports
      if (
        file.exports.named.length > 0 ||
        file.exports.default ||
        file.exports.reExported.length > 0 ||
        file.exports.interfaces.length > 0 ||
        file.exports.types.length > 0
      ) {
        lines.push("**Exports:**");
        if (file.exports.classes.length > 0) {
          lines.push(`- Classes: \`${file.exports.classes.join("`, `")}\``);
        }
        if (file.exports.interfaces.length > 0) {
          lines.push(
            `- Interfaces: \`${file.exports.interfaces.join("`, `")}\``,
          );
        }
        const typeAliases = file.exports.types.filter(
          (t) => !file.exports.interfaces.includes(t),
        );
        if (typeAliases.length > 0) {
          lines.push(`- Types: \`${typeAliases.join("`, `")}\``);
        }
        if (file.exports.enums.length > 0) {
          lines.push(`- Enums: \`${file.exports.enums.join("`, `")}\``);
        }
        if (file.exports.functions.length > 0) {
          lines.push(`- Functions: \`${file.exports.functions.join("`, `")}\``);
        }
        if (file.exports.constants.length > 0) {
          lines.push(`- Constants: \`${file.exports.constants.join("`, `")}\``);
        }
        if (file.exports.reExported.length > 0) {
          lines.push(
            `- Re-exports: \`${file.exports.reExported.join("`, `")}\``,
          );
        }
        if (file.exports.default) {
          lines.push(`- Default: \`${file.exports.default}\``);
        }
        lines.push("");
      }

      lines.push("---");
      lines.push("");
    }
  }

  // Dependency Matrix
  lines.push('<a id="dependency-matrix"></a>');
  lines.push("## Dependency Matrix");
  lines.push("");
  lines.push("### File Import/Export Matrix");
  lines.push("");
  lines.push("| File | Imports From | Exports To |");
  lines.push("|------|--------------|------------|");

  const matrixEntries = Object.entries(matrix)
    .sort(
      (a, b) =>
        b[1].importsFrom.length +
        b[1].exportsTo.length -
        (a[1].importsFrom.length + a[1].exportsTo.length),
    )
    .slice(0, 40); // Top 40 by connectivity
  for (const [filePath, deps] of matrixEntries) {
    // Use relative path (e.g., "core/src/typed/mathts-typed") instead of just basename
    const shortPath = filePath.replace(/\.ts$/, "");
    const importsCount = deps.importsFrom.length;
    const exportsCount = deps.exportsTo.length;
    lines.push(
      `| \`${shortPath}\` | ${importsCount} file${importsCount !== 1 ? "s" : ""} | ${exportsCount} file${exportsCount !== 1 ? "s" : ""} |`,
    );
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // Circular Dependencies
  lines.push('<a id="circular-dependency-analysis"></a>');
  lines.push("## Circular Dependency Analysis");
  lines.push("");
  if (circularDeps.all.length === 0) {
    lines.push("**No circular dependencies detected.**");
  } else {
    lines.push(
      `**${circularDeps.all.length} circular dependencies detected:**`,
    );
    lines.push("");
    lines.push(
      `- **Runtime cycles**: ${circularDeps.runtime.length} (require attention)`,
    );
    lines.push(
      `- **Type-only cycles**: ${circularDeps.typeOnly.length} (safe, no runtime impact)`,
    );
    lines.push("");

    if (circularDeps.runtime.length > 0) {
      lines.push("### Runtime Circular Dependencies");
      lines.push("");
      lines.push("These cycles involve runtime imports and may cause issues:");
      lines.push("");
      for (const cycle of circularDeps.runtime.slice(0, 10)) {
        lines.push(`- ${cycle.join(" -> ")}`);
      }
      if (circularDeps.runtime.length > 10) {
        lines.push(`- ... and ${circularDeps.runtime.length - 10} more`);
      }
      lines.push("");
    }

    if (circularDeps.typeOnly.length > 0) {
      lines.push("### Type-Only Circular Dependencies");
      lines.push("");
      lines.push(
        "These cycles only involve type imports and are safe (erased at runtime):",
      );
      lines.push("");
      for (const cycle of circularDeps.typeOnly.slice(0, 10)) {
        lines.push(`- ${cycle.join(" -> ")}`);
      }
      if (circularDeps.typeOnly.length > 10) {
        lines.push(`- ... and ${circularDeps.typeOnly.length - 10} more`);
      }
      lines.push("");
    }
  }
  lines.push("---");
  lines.push("");

  // Visual Dependency Graph
  lines.push('<a id="visual-dependency-graph"></a>');
  lines.push("## Visual Dependency Graph");
  lines.push("");
  lines.push(generateMermaidDiagram(modules, files));
  lines.push("");
  lines.push("---");
  lines.push("");

  // Summary Statistics
  lines.push('<a id="summary-statistics"></a>');
  lines.push("## Summary Statistics");
  lines.push("");
  lines.push("| Category | Count |");
  lines.push("|----------|-------|");
  lines.push(`| Total TypeScript Files | ${stats.totalTypeScriptFiles} |`);
  lines.push(`| Total Modules | ${stats.totalModules} |`);
  lines.push(`| Total Lines of Code | ${stats.totalLinesOfCode} |`);
  lines.push(`| Total Exports | ${stats.totalExports} |`);
  lines.push(`| Total Re-exports | ${stats.totalReExports} |`);
  lines.push(`| Total Classes | ${stats.totalClasses} |`);
  lines.push(`| Total Interfaces | ${stats.totalInterfaces} |`);
  lines.push(`| Total Functions | ${stats.totalFunctions} |`);
  lines.push(`| Total Type Guards | ${stats.totalTypeGuards} |`);
  lines.push(`| Total Enums | ${stats.totalEnums} |`);
  lines.push(`| Type-only Imports | ${stats.totalTypeOnlyImports} |`);
  lines.push(`| Runtime Circular Deps | ${stats.runtimeCircularDeps} |`);
  lines.push(`| Type-only Circular Deps | ${stats.typeOnlyCircularDeps} |`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`*Last Updated*: ${today}`);
  lines.push(`*Version*: ${packageJson.version}`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Generate compact summary for LLM consumption (~10KB target)
 * Uses CTON-style compression: no whitespace, abbreviated keys
 */
function generateCompactSummary(
  files: ParsedFile[],
  modules: ModuleMap,
  stats: Statistics,
  circularDeps: CircularDependencyResult,
): string {
  // Abbreviate module names and create compact structure
  const summary = {
    m: {
      // metadata
      n: packageJson.name,
      v: packageJson.version,
      d: new Date().toISOString().split("T")[0],
      f: stats.totalTypeScriptFiles,
      e: stats.totalExports,
      re: stats.totalReExports,
    },
    s: {
      // statistics
      loc: stats.totalLinesOfCode,
      cls: stats.totalClasses,
      int: stats.totalInterfaces,
      fn: stats.totalFunctions,
      tg: stats.totalTypeGuards,
      en: stats.totalEnums,
      co: stats.totalConstants,
      toi: stats.totalTypeOnlyImports,
    },
    c: {
      // circular deps
      rt: circularDeps.runtime.length,
      to: circularDeps.typeOnly.length,
      // Only include first 5 runtime cycles (if any) for context
      rtp: circularDeps.runtime
        .slice(0, 5)
        .map((c) =>
          c.map((p) => p.split("/").pop()?.replace(".ts", "")).join("→"),
        ),
    },
    mod: {} as Record<
      string,
      { f: number; exp: string[]; cls?: string[]; int?: string[] }
    >,
    // Hot paths: files with most dependencies
    hp: [] as { p: string; i: number; o: number }[],
  };

  // Compact module summary
  for (const [modName, modFiles] of Object.entries(modules)) {
    const fileList = Object.values(modFiles);
    const exports = fileList
      .flatMap((f) => f.exports.named)
      .map(cleanExportName)
      .filter(Boolean)
      .slice(0, 20);
    const classes = fileList.flatMap((f) => f.exports.classes);
    const interfaces = fileList
      .flatMap((f) => f.exports.interfaces)
      .slice(0, 10);

    summary.mod[modName] = {
      f: Object.keys(modFiles).length,
      exp: [...new Set(exports)],
    };
    if (classes.length > 0) summary.mod[modName].cls = [...new Set(classes)];
    if (interfaces.length > 0)
      summary.mod[modName].int = [...new Set(interfaces)];
  }

  // Find hot paths (files with highest connectivity)
  const connectivity = files
    .map((f) => ({
      p: f.path.split("/").slice(-2).join("/"),
      i: f.internalDependencies.length,
      o: files.filter((other) =>
        other.internalDependencies.some((d) => {
          const resolved = resolvePath(other.path, d.file);
          return resolved === f.path;
        }),
      ).length,
    }))
    .sort((a, b) => b.i + b.o - (a.i + a.o));

  summary.hp = connectivity.slice(0, 15);

  // Output as minified JSON (CTON-style: no whitespace)
  return JSON.stringify(summary);
}

/**
 * Generate test coverage analysis markdown
 */
function generateTestCoverageMarkdown(coverage: TestCoverageAnalysis): string {
  const lines: string[] = [];
  const today = new Date().toISOString().split("T")[0];

  lines.push("# Test Coverage Analysis");
  lines.push("");
  lines.push(`**Generated**: ${today}`);
  lines.push("");

  // Summary statistics
  const totalSource = coverage.sourceFiles.length;
  const totalTested = coverage.testedFiles.length;
  const totalUntested = coverage.untestedFiles.length;
  const coveragePercent =
    totalSource > 0 ? ((totalTested / totalSource) * 100).toFixed(1) : "0";

  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("|--------|-------|");
  lines.push(`| Total Source Files | ${totalSource} |`);
  lines.push(`| Total Test Files | ${coverage.testFiles.length} |`);
  lines.push(`| Source Files with Tests | ${totalTested} |`);
  lines.push(`| Source Files without Tests | ${totalUntested} |`);
  lines.push(`| Coverage (raw, direct-import) | **${coveragePercent}%** |`);

  // Effective-coverage companion metric — only emitted when a
  // coverage-policy.json was loaded successfully.
  const b = coverage.policyBreakdown;
  if (coverage.policy) {
    lines.push(
      `| Coverage (effective, active code only) | **${b.effectivePercent}%** (${b.testedActive} / ${b.activeFiles}) |`,
    );
    lines.push("");
    lines.push(
      "> The raw figure counts every source file the CDG tool finds, including code that is intentionally not direct-imported by a vitest `*.test.ts` (synced mathjs categories, AssemblyScript sources, type-only barrels, …). The **effective** figure excludes those per `docs/Architecture/coverage-policy.json` so the number reflects the genuinely-active hand-written code only. See [`COVERAGE_POLICY.md`](./COVERAGE_POLICY.md) for the policy.",
    );
    lines.push("");

    // Category breakdown table
    lines.push("### Untested-file breakdown by category");
    lines.push("");
    lines.push("| Category | Count | Why it is intentionally untested |");
    lines.push("|---|---:|---|");
    for (const [id, cat] of Object.entries(coverage.policy.categories)) {
      const count = b.byCategory[id] ?? 0;
      if (count === 0) continue;
      lines.push(
        `| **${cat.label}** | ${count} | ${cat.rationale.split(".")[0]}. |`,
      );
    }
    const activeUntested = b.byCategory.active_untested ?? 0;
    lines.push(
      `| **Active (real gap — needs a test)** | ${activeUntested} | These are the files that should grow a direct-import test. |`,
    );
    lines.push("");
  }
  lines.push("---");
  lines.push("");

  // Untested files (the main deliverable)
  lines.push("## Source Files Without Test Coverage");
  lines.push("");
  if (coverage.untestedFiles.length === 0) {
    lines.push("**All source files have test coverage!** 🎉");
  } else {
    lines.push(
      `The following ${coverage.untestedFiles.length} source files are not directly imported by any test file:`,
    );
    lines.push("");

    // Group by module
    const byModule = new Map<string, string[]>();
    for (const file of coverage.untestedFiles) {
      const parts = file.split("/");
      const module = parts.length >= 3 ? parts[1] : "root";
      if (!byModule.has(module)) byModule.set(module, []);
      byModule.get(module)!.push(file);
    }

    for (const [module, files] of byModule) {
      lines.push(`### ${module}/`);
      lines.push("");
      for (const file of files.sort()) {
        const fileName = basename(file, ".ts");
        lines.push(
          `- \`${file}\` → Expected test: \`tests/unit/${module}/${fileName}.test.ts\``,
        );
      }
      lines.push("");
    }
  }
  lines.push("---");
  lines.push("");

  // Files with tests
  lines.push("## Source Files With Test Coverage");
  lines.push("");
  lines.push("| Source File | Test Files |");
  lines.push("|-------------|------------|");

  const sortedTested = [...coverage.testedFiles].sort();
  for (const sourcePath of sortedTested) {
    const tests = coverage.coverageMap.get(sourcePath) || [];
    const shortSource = sourcePath.split("/").slice(-2).join("/");
    const shortTests = tests.map((t) => `\`${basename(t)}\``).join(", ");
    lines.push(`| \`${shortSource}\` | ${shortTests} |`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // Test file details
  lines.push("## Test File Details");
  lines.push("");
  lines.push("| Test File | Imports from Source |");
  lines.push("|-----------|---------------------|");

  for (const [testPath, sources] of coverage.testToSourceMap) {
    const shortTest = testPath.split("/").slice(-2).join("/");
    const sourceCount = sources.length;
    lines.push(`| \`${shortTest}\` | ${sourceCount} files |`);
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Generate test coverage JSON
 */
function generateTestCoverageJson(coverage: TestCoverageAnalysis): object {
  const coverageMapObj: Record<string, string[]> = {};
  for (const [source, tests] of coverage.coverageMap) {
    coverageMapObj[source] = tests;
  }

  const testToSourceObj: Record<string, string[]> = {};
  for (const [test, sources] of coverage.testToSourceMap) {
    testToSourceObj[test] = sources;
  }

  const b = coverage.policyBreakdown;
  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      totalSourceFiles: coverage.sourceFiles.length,
      totalTestFiles: coverage.testFiles.length,
      testedCount: coverage.testedFiles.length,
      untestedCount: coverage.untestedFiles.length,
      coveragePercent:
        coverage.sourceFiles.length > 0
          ? (
              (coverage.testedFiles.length / coverage.sourceFiles.length) *
              100
            ).toFixed(1)
          : "0",
      // Companion 'effective' coverage — the same direct-import metric but
      // computed over the active (non-policy-excluded) file set only. When
      // no coverage-policy.json is present, this collapses to the raw figure.
      effectiveCoverage: {
        policyLoaded: coverage.policy !== null,
        activeFiles: b.activeFiles,
        testedActive: b.testedActive,
        activeUntested: b.byCategory.active_untested ?? 0,
        excludedTotal: b.excludedTotal,
        percent: b.effectivePercent,
        breakdown: b.byCategory,
      },
    },
    untestedFiles: coverage.untestedFiles.sort(),
    testedFiles: coverage.testedFiles.sort(),
    coverageMap: coverageMapObj,
    testToSourceMap: testToSourceObj,
    // Per-file classification of every untested file. category=null means
    // the file is a genuine gap (not matched by any policy category).
    classifiedUntested: b.classifiedUntested
      .slice()
      .sort((a, c) => a.file.localeCompare(c.file)),
  };
}

/**
 * Generate package-level dependency markdown section for monorepo mode.
 */
function generatePackageDependencySection(
  parsedFiles: ParsedFile[],
  workspaces: Map<string, WorkspacePackage>,
  reachableFiles?: Set<string>,
  dormantFiles?: Set<string>,
): string {
  const lines: string[] = [];

  lines.push('<a id="package-dependencies"></a>');
  lines.push("## Package Dependencies");
  lines.push("");

  // Build package-level dependency map from workspace deps
  const pkgDeps = new Map<string, Set<string>>();
  for (const [name] of workspaces) pkgDeps.set(name, new Set());

  for (const file of parsedFiles) {
    if (!file.packageName) continue;
    // Only count deps from reachable (active) files, not dormant ones
    if (reachableFiles && !reachableFiles.has(file.path)) continue;
    for (const wsDep of file.workspaceDependencies) {
      // Skip self-references (package importing itself by npm name)
      if (wsDep.package !== file.packageName) {
        pkgDeps.get(file.packageName)?.add(wsDep.package);
      }
    }
  }

  // Package dependency table
  lines.push("| Package | Depends On | Files (Active) | Files (Dormant) |");
  lines.push("|---------|------------|----------------|-----------------|");

  for (const [name, ws] of workspaces) {
    const deps = pkgDeps.get(name);
    const depStr =
      deps && deps.size > 0
        ? [...deps].map((d) => `\`${d}\``).join(", ")
        : "(none)";

    const pkgFiles = parsedFiles.filter((f) => f.packageName === name);
    const activeCount = reachableFiles
      ? pkgFiles.filter((f) => reachableFiles.has(f.path)).length
      : pkgFiles.length;
    const dormantCount = dormantFiles
      ? pkgFiles.filter((f) => dormantFiles.has(f.path)).length
      : 0;

    lines.push(
      `| \`${name}\` (\`${ws.directory}/\`) | ${depStr} | ${activeCount} | ${dormantCount} |`,
    );
  }

  lines.push("");

  // Mermaid package-level diagram
  lines.push("### Package Dependency Diagram");
  lines.push("");
  lines.push("```mermaid");
  lines.push("graph LR");

  // Create short IDs for packages
  const pkgIds = new Map<string, string>();
  let idx = 0;
  for (const [name, ws] of workspaces) {
    const id = `P${idx++}`;
    pkgIds.set(name, id);
    const shortName = ws.directory;
    lines.push(`    ${id}[${shortName}]`);
  }

  // Add edges
  for (const [name, deps] of pkgDeps) {
    const sourceId = pkgIds.get(name);
    if (!sourceId || !deps) continue;
    for (const dep of deps) {
      const targetId = pkgIds.get(dep);
      if (targetId) {
        lines.push(`    ${sourceId} --> ${targetId}`);
      }
    }
  }

  lines.push("```");
  lines.push("");
  lines.push("---");
  lines.push("");

  return lines.join("\n");
}

/**
 * WASM-accelerator ↔ function pairing analysis.
 *
 * Scans the `functions` package's public typed API (`functions/src/typed/*.ts`)
 * and determines, per `mathTyped` export, whether it routes to a WASM bridge
 * (a `*Dispatch` call inside its definition) or runs pure-JS. This makes the
 * "which functions are WASM-accelerated" map a generated artifact instead of a
 * hand-maintained doc (see docs/Architecture/WASM_ACCELERATION.md).
 */
type Routing = "wasm" | "parallel" | "wasm+parallel" | "js-only";
/** Whether a wasm-routed function actually executes wasm on the *bundled* binary
 * (the AssemblyScript `mathts-as.wasm` the functions package loads by default),
 * or its dispatch bridge falls back to JS (it has no AS-managed execution path —
 * e.g. the poly-fit / Airy / argsort+rank kernels deliberately kept on JS pending
 * AS kernel-stabilization fixes). `unknown` when the bundled wasm or the
 * dispatch's bridge couldn't be resolved (e.g. dist not built). */
type EffectiveBackend = "wasm" | "js-fallback" | "unknown";
interface WasmPairingEntry {
  name: string;
  file: string;
  routing: Routing;
  dispatch: string[];
  effectiveBackend: EffectiveBackend;
}
/** Static export-table probe of the built AssemblyScript `.wasm` binary. */
interface WasmBinaryProbe {
  path: string;
  total: number;
  functions: number;
  globals: number;
  memory: number;
  sourceFiles: number;
  byCategory: Array<{ category: string; count: number }>;
}
interface WasmPairing {
  generated: string;
  total: number;
  acceleratedCount: number; // routes to wasm (wasm or wasm+parallel)
  parallelOnlyCount: number; // worker-parallel, no wasm
  jsOnlyCount: number;
  /** Of acceleratedCount, how many actually run wasm vs fall back to JS on the
   * bundled binary (runtime probe of functions/dist/wasm/mathts-as.wasm — the AS
   * binary the functions package loads; AssemblyScript is the sole WASM backend). */
  bundledBackend: "assemblyscript" | "unknown";
  wasmEffectiveCount: number;
  jsFallbackCount: number;
  /** Detection is per-mathTyped-block direct references; routing reached only
   * through helper functions outside the block is not traced (under-reports). */
  accelerated: WasmPairingEntry[];
  parallelOnly: WasmPairingEntry[];
  jsOnly: string[];
  byFile: Record<string, { wasm: number; parallel: number; jsOnly: number }>;
  /** Static export-table probe of the built `.wasm` binary (null if not built). */
  binary: WasmBinaryProbe | null;
}

/**
 * Runtime-effectiveness probe (the dynamic complement to the static routing scan).
 * A function may *route* to a `*Dispatch` yet still run JS at runtime, because the
 * dispatch's bridge has no AS-managed execution path (post Phase 5 functions
 * cutover the bridges dispatch AS→JS only; several `*Dispatch` deliberately stay
 * on JS — poly fits, Airy, argsort/rank — pending the Phase 6 AS-kernel fixes).
 * Determines, per `*Dispatch`, whether it actually executes wasm on the *bundled*
 * binary, by combining:
 *   (a) the bundled AS wasm's export list — does it have `__new`? (read
 *       synchronously via WebAssembly.Module.exports, no instantiation), and
 *   (b) whether each `*Dispatch`'s own body invokes a real AS execution helper
 *       (`withAsF64`/`withAsI32`/`runUnaryPtr`/`runChainPtr`/`makeUnaryArrayDispatch`,
 *       directly or via another in-file `*Dispatch` it delegates to).
 */
/**
 * Read a `.wasm` module's export-name table without instantiating it
 * (`WebAssembly.Module.exports` is a parse-only static read — no memory, no
 * imports, no start function). Returns the set of exported names, or `null` if
 * the file is missing or can't be parsed (e.g. dist not built). Used by the
 * runtime-effectiveness probe.
 */
function readWasmExports(path: string): Set<string> | null {
  // Reference the WebAssembly global via a typed shim — the tool's tsconfig
  // doesn't include the DOM lib, so the global `WebAssembly` name isn't in scope.
  interface WasmModuleCtor {
    new (bytes: Uint8Array): object;
    exports(m: object): Array<{ name: string }>;
  }
  const WAModule = (
    globalThis as unknown as { WebAssembly?: { Module: WasmModuleCtor } }
  ).WebAssembly?.Module;
  if (!WAModule || !existsSync(path)) return null;
  try {
    const mod = new WAModule(readFileSync(path));
    return new Set(WAModule.exports(mod).map((e) => e.name));
  } catch {
    return null;
  }
}

function analyzeWasmRuntime(rootDir: string): {
  bundledBackend: "assemblyscript" | "unknown";
  dispatchWasm: Map<string, boolean | null>;
} {
  const dispatchWasm = new Map<string, boolean | null>();

  // AssemblyScript is the sole WASM backend; the functions package loads
  // mathts-as.wasm. The probe confirms the managed runtime (`__new`) is present.
  const wasmPath = join(rootDir, "functions", "dist", "wasm", "mathts-as.wasm");
  const exports = readWasmExports(wasmPath);
  const bundledHasNew: boolean | null =
    exports === null ? null : exports.has("__new");
  const bundledBackend: "assemblyscript" | "unknown" =
    bundledHasNew === true ? "assemblyscript" : "unknown";

  const wasmDir = join(rootDir, "functions", "src", "wasm");
  if (!existsSync(wasmDir)) return { bundledBackend, dispatchWasm };
  // A `*Dispatch` actually executes wasm iff its own body invokes one of the AS
  // execution helpers (directly or via another in-file `*Dispatch` it delegates
  // to). The bridges are AS→JS only post Phase 5, so this single marker set
  // captures the genuine wasm path; dispatches with no marker (poly fits, Airy,
  // argsort/rank) are honest js-fallback.
  const asExecRe =
    /\b(?:withAsF64|withAsI32|runUnaryPtr|runChainPtr|makeUnaryArrayDispatch)\b/;
  const defRe = /\b(?:function|const)\s+(\w+Dispatch)\b/g;
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts")) {
        const src = readFileSync(p, "utf-8");
        // Slice the file into per-`*Dispatch` segments (def start → next def start).
        const segs: { name: string; body: string }[] = [];
        let dm: RegExpExecArray | null;
        defRe.lastIndex = 0;
        const marks: { name: string; idx: number }[] = [];
        while ((dm = defRe.exec(src)) !== null)
          marks.push({ name: dm[1], idx: dm.index });
        for (let i = 0; i < marks.length; i++) {
          const end = i + 1 < marks.length ? marks[i + 1].idx : src.length;
          segs.push({
            name: marks[i].name,
            body: src.slice(marks[i].idx, end),
          });
        }
        // Initial: does the segment invoke an AS execution helper directly?
        const usesAs = new Map<string, boolean>();
        for (const s of segs) usesAs.set(s.name, asExecRe.test(s.body));
        // Propagate through in-file delegation (e.g. besselJDispatch →
        // besselOrderDispatch). Fixpoint; depth here is ≤ 2, 3 passes is safe.
        for (let pass = 0; pass < 3; pass++) {
          for (const s of segs) {
            if (usesAs.get(s.name)) continue;
            for (const other of segs) {
              if (
                other.name !== s.name &&
                usesAs.get(other.name) &&
                s.body.includes(other.name)
              ) {
                usesAs.set(s.name, true);
                break;
              }
            }
          }
        }
        for (const s of segs) {
          // Unknown when we couldn't read the bundled binary; otherwise the AS
          // binary has __new, so wasm runs iff the dispatch has an AS exec path.
          const runsWasm =
            bundledHasNew === null
              ? null
              : bundledHasNew && usesAs.get(s.name)!;
          dispatchWasm.set(s.name, runsWasm);
        }
      }
    }
  };
  walk(wasmDir);
  return { bundledBackend, dispatchWasm };
}

/** Export-name-prefix category for a WASM binary function export (the AS naming
 *  convention: `array_*`, `matrix_*`, `complex_*`/`complex_array_*`, `fft`/`rfft`). */
function categorizeWasmExport(name: string): string {
  if (/^array_/.test(name)) return "Array";
  if (/^matrix_/.test(name)) return "Matrix";
  if (/^complex/.test(name))
    return /(_array|Array)/.test(name) ? "Complex array" : "Complex scalar";
  if (/^(fft|ifft|rfft|irfft)$/.test(name)) return "FFT";
  return "Scalar & special (f64)";
}

function countAssemblySourceFiles(rootDir: string): number {
  const dir = join(rootDir, "assembly", "src");
  if (!existsSync(dir)) return 0;
  let n = 0;
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name.endsWith(".ts")) n++;
    }
  };
  walk(dir);
  return n;
}

/**
 * Probe the built AssemblyScript WASM binary's export table via
 * `WebAssembly.Module.exports()` (a parse-only static read — no instantiation) so the
 * binary export counts in ARCHITECTURE.md §6a stop being hand-maintained. Prefers the
 * canonical build output (`assembly/build/mathts.wasm`), falling back to the bundled
 * copies. Returns `null` if no binary is built (run `npm run build:wasm` first).
 */
function probeWasmBinary(rootDir: string): WasmBinaryProbe | null {
  interface WasmModuleCtor {
    new (bytes: Uint8Array): object;
    exports(m: object): Array<{ name: string; kind: string }>;
  }
  const WAModule = (
    globalThis as unknown as { WebAssembly?: { Module: WasmModuleCtor } }
  ).WebAssembly?.Module;
  if (!WAModule) return null;
  const candidates = [
    join(rootDir, "assembly", "build", "mathts.wasm"),
    join(rootDir, "functions", "dist", "wasm", "mathts-as.wasm"),
    join(rootDir, "matrix", "dist", "wasm", "mathts-as.wasm"),
  ];
  const path = candidates.find((p) => existsSync(p));
  if (!path) return null;
  let ex: Array<{ name: string; kind: string }>;
  try {
    ex = WAModule.exports(new WAModule(readFileSync(path)));
  } catch {
    return null;
  }
  const fns = ex.filter((e) => e.kind === "function");
  const cats = new Map<string, number>();
  for (const f of fns)
    cats.set(
      categorizeWasmExport(f.name),
      (cats.get(categorizeWasmExport(f.name)) ?? 0) + 1,
    );
  const ORDER = [
    "Scalar & special (f64)",
    "Array",
    "Matrix",
    "Complex scalar",
    "Complex array",
    "FFT",
  ];
  const byCategory = [
    ...ORDER.filter((c) => cats.has(c)),
    ...[...cats.keys()].filter((c) => !ORDER.includes(c)).sort(),
  ].map((category) => ({ category, count: cats.get(category) as number }));
  return {
    path: relative(rootDir, path).replace(/\\/g, "/"),
    total: ex.length,
    functions: fns.length,
    globals: ex.filter((e) => e.kind === "global").length,
    memory: ex.filter((e) => e.kind === "memory").length,
    sourceFiles: countAssemblySourceFiles(rootDir),
    byCategory,
  };
}

function analyzeWasmPairing(rootDir: string): WasmPairing | null {
  const candidates = [
    join(rootDir, "functions", "src", "typed"),
    join(rootDir, "src", "typed"),
  ];
  const typedDir = candidates.find((d) => existsSync(d));
  if (!typedDir) return null;

  const { bundledBackend, dispatchWasm } = analyzeWasmRuntime(rootDir);
  const effectiveOf = (
    isWasm: boolean,
    dispatch: string[],
  ): EffectiveBackend => {
    if (!isWasm) return "unknown";
    const vals = dispatch.map((d) => dispatchWasm.get(d));
    if (vals.some((v) => v === undefined || v === null)) return "unknown";
    return vals.every((v) => v === true) ? "wasm" : "js-fallback";
  };

  const accelerated: WasmPairingEntry[] = [];
  const parallelOnly: WasmPairingEntry[] = [];
  const jsOnly: string[] = [];
  const byFile: Record<
    string,
    { wasm: number; parallel: number; jsOnly: number }
  > = {};

  for (const fname of readdirSync(typedDir)) {
    if (!fname.endsWith(".ts")) continue;
    const src = readFileSync(join(typedDir, fname), "utf-8");
    const re = /export const (\w+) = mathTyped\(\s*'\w+'\s*,\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const name = m[1];
      // Brace-match the mathTyped({...}) object literal starting at its `{`.
      let depth = 0;
      const start = m.index + m[0].length - 1;
      let end = start;
      for (let i = start; i < src.length; i++) {
        const c = src[i];
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const block = src.slice(start, end + 1);
      const dispatch = Array.from(
        new Set(block.match(/\b\w+Dispatch\b/g) ?? []),
      ).sort();
      const isWasm = dispatch.length > 0;
      const isParallel = /\b(computePool|shouldParallelize)\b/.test(block);
      const routing: Routing = isWasm
        ? isParallel
          ? "wasm+parallel"
          : "wasm"
        : isParallel
          ? "parallel"
          : "js-only";
      if (!byFile[fname]) byFile[fname] = { wasm: 0, parallel: 0, jsOnly: 0 };
      const entry: WasmPairingEntry = {
        name,
        file: fname,
        routing,
        dispatch,
        effectiveBackend: effectiveOf(isWasm, dispatch),
      };
      if (isWasm) {
        accelerated.push(entry);
        byFile[fname].wasm++;
      } else if (isParallel) {
        parallelOnly.push(entry);
        byFile[fname].parallel++;
      } else {
        jsOnly.push(name);
        byFile[fname].jsOnly++;
      }
    }
  }

  accelerated.sort((a, b) => a.name.localeCompare(b.name));
  parallelOnly.sort((a, b) => a.name.localeCompare(b.name));
  jsOnly.sort();
  return {
    generated: new Date().toISOString().split("T")[0],
    total: accelerated.length + parallelOnly.length + jsOnly.length,
    acceleratedCount: accelerated.length,
    parallelOnlyCount: parallelOnly.length,
    jsOnlyCount: jsOnly.length,
    bundledBackend,
    wasmEffectiveCount: accelerated.filter((e) => e.effectiveBackend === "wasm")
      .length,
    jsFallbackCount: accelerated.filter(
      (e) => e.effectiveBackend === "js-fallback",
    ).length,
    accelerated,
    parallelOnly,
    jsOnly,
    byFile,
    binary: probeWasmBinary(rootDir),
  };
}

function generateWasmPairingMarkdown(p: WasmPairing): string {
  let md = "# WASM Accelerator ↔ Function Pairing\n\n";
  md += `**Generated**: ${p.generated} (by tools/create-dependency-graph)\n\n`;
  md += `Per public \`mathTyped\` function in \`functions/src/typed/\`, its acceleration `;
  md += `routing: **wasm** (a \`*Dispatch\` bridge), **parallel** (worker pool via `;
  md += `\`computePool\`/\`shouldParallelize\`), or **js-only**. WASM engages for `;
  md += `\`Float64Array\` inputs above threshold; the functions dispatch is AS → JS.\n\n`;
  md += `> Detection is per-\`mathTyped\`-block direct references; routing reached only via `;
  md += `helper functions outside the block is not traced, so this can under-report.\n\n`;
  md += `| Routing (static) | Count |\n| --- | --: |\n`;
  md += `| WASM (incl. wasm+parallel) | ${p.acceleratedCount} |\n`;
  md += `| Parallel only (worker pool) | ${p.parallelOnlyCount} |\n`;
  md += `| JS-only | ${p.jsOnlyCount} |\n`;
  md += `| **Total** | **${p.total}** |\n\n`;
  md += `**Runtime effectiveness** (probe of the bundled \`functions/dist/wasm/mathts-as.wasm\`, `;
  md += `backend: **${p.bundledBackend}**): of the ${p.acceleratedCount} wasm-routed functions, `;
  md += `**${p.wasmEffectiveCount} actually execute wasm**, **${p.jsFallbackCount} fall back to JS** `;
  md += `(their \`*Dispatch\` has no AS-managed execution path — the poly-fit / Airy / argsort+rank `;
  md += `kernels are deliberately kept on JS pending AS kernel-stabilization fixes).\n\n`;
  md += `## WASM-accelerated functions\n\n| Function | Routing | Effective | Bridge dispatch | Module |\n| --- | --- | --- | --- | --- |\n`;
  for (const e of p.accelerated) {
    md += `| \`${e.name}\` | ${e.routing} | ${e.effectiveBackend} | \`${e.dispatch.join("`, `")}\` | ${e.file.replace(/\.ts$/, "")} |\n`;
  }
  md += `\n## Parallel-only functions (worker pool, not WASM)\n\n| Function | Module |\n| --- | --- |\n`;
  for (const e of p.parallelOnly) {
    md += `| \`${e.name}\` | ${e.file.replace(/\.ts$/, "")} |\n`;
  }
  md += `\n## Per-module counts\n\n| Module | WASM | Parallel | JS-only |\n| --- | --: | --: | --: |\n`;
  for (const f of Object.keys(p.byFile).sort()) {
    md += `| ${f.replace(/\.ts$/, "")} | ${p.byFile[f].wasm} | ${p.byFile[f].parallel} | ${p.byFile[f].jsOnly} |\n`;
  }
  md += `\n> Notes: the \`matrix\` package backend runs the AssemblyScript binary separately from the `;
  md += `typed-API dispatch counted here. After the 2026-07 WASM audit that backend is scoped to `;
  md += `**SIMD matmul (≥256 elems)** + the **LU/QR/Cholesky/inverse/determinant** decompositions; `;
  md += `element-wise/transpose/reductions and eig/svd run on JS (measured 0.2–6× slower on WASM — `;
  md += `memory-bound or scalar; the eig/svd AS kernels were deleted). The elementwise transcendentals `;
  md += `(abs/sin/cos/tan/exp/log) plus the AS special/poly/sort/signal/interp kernels are the `;
  md += `wasm-effective set here. The formerly-parked kernels (poly fits, Airy, argsort/rank) were `;
  md += `fixed and repointed to AS in Phase 6 (Airy truncation-cap: AS vs JS ≈4e-16; poly fits attempt the AS kernel ≥1024 points with a validated-JS rank-deficiency fallback) — G2 closed 2026-07-04.
`;

  // Binary export table — probed from the built .wasm so ARCHITECTURE.md §6a no
  // longer hand-maintains these counts.
  md += `\n## WASM binary exports\n\n`;
  if (!p.binary) {
    md += `> WASM binary not built — run \`npm run build:wasm\` then \`npm run docs:deps\` to `;
    md += `populate this section (probed via \`WebAssembly.Module.exports()\`).\n`;
  } else {
    const b = p.binary;
    md += `Probed from \`${b.path}\` via \`WebAssembly.Module.exports()\` (a parse-only static `;
    md += `read — no instantiation; rebuild with \`npm run build:wasm\`).\n\n`;
    md += `**${b.total} total exports** = **${b.functions} functions** + **${b.globals} globals** `;
    md += `(numeric constants such as \`PI\`/\`E\`) + **${b.memory} memory** (the shared linear `;
    md += `memory), compiled from **${b.sourceFiles} AssemblyScript source files** under `;
    md += `\`assembly/src/\`.\n\n`;
    md += `| Category (by export-name prefix) | Function exports |\n| --- | --: |\n`;
    for (const c of b.byCategory) md += `| ${c.category} | ${c.count} |\n`;
    md += `| **Total** | **${b.functions}** |\n`;
  }
  return md;
}

/**
 * WebGPU accelerator ↔ function pairing analysis.
 *
 * The GPU analog of {@link analyzeWasmPairing}. Scans the SAME public typed API
 * (`functions/src/typed/*.ts`) for a WebGPU-routing marker — a `*GpuDispatch`
 * bridge (mirroring the `*Dispatch` WASM convention) or a GPU pool/backend
 * reference (`gpuPool` / `getGlobalGPUBackend` / `GPUBackend`).
 *
 * WebGPU acceleration is NOT yet wired into the functions typed layer (only
 * matrix's experimental `GPUBackend.matmul` exists), so this reports 0 today. It
 * exists so the WebGPU tier is TRACKED the same way WASM is, once it lands (see
 * ROADMAP "WebGPU acceleration tier"): route through the `*GpuDispatch` convention
 * and this report auto-populates.
 */
interface WebGPUPairingEntry {
  name: string;
  file: string;
  routing: "gpu" | "none";
  markers: string[];
}
interface WebGPUPairing {
  generated: string;
  status: string;
  total: number;
  gpuAcceleratedCount: number;
  noneCount: number;
  gpuAccelerated: WebGPUPairingEntry[];
  none: string[];
  byFile: Record<string, { gpu: number; none: number }>;
  /**
   * GPU-accelerated functions that are NOT `mathTyped` typed-dispatch entries —
   * standalone exports like `fuseUnaryChainAsync` or `gpuMatmul`.
   *
   * This is a separate bucket on purpose. The GPU only pays off where work is
   * amortized over the upload/readback (a fused chain, a large matmul); a single
   * typed op like `sin(xs)` would be transfer-dominated and SLOWER on the GPU.
   * So the typed-layer count above is expected to stay 0, and these standalone
   * entries are where the real GPU acceleration lives.
   */
  standaloneAcceleratedCount: number;
  standaloneAccelerated: WebGPUPairingEntry[];
}

/** Brace-match a block starting at `startBrace` (index of its `{`). */
function matchBraceBlock(src: string, startBrace: number): string {
  let depth = 0;
  for (let i = startBrace; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(startBrace, i + 1);
    }
  }
  return src.slice(startBrace);
}

function analyzeWebGPUPairing(rootDir: string): WebGPUPairing | null {
  const candidates = [
    join(rootDir, "functions", "src", "typed"),
    join(rootDir, "src", "typed"),
  ];
  const typedDir = candidates.find((d) => existsSync(d));
  if (!typedDir) return null;

  const gpuAccelerated: WebGPUPairingEntry[] = [];
  const none: string[] = [];
  const byFile: Record<string, { gpu: number; none: number }> = {};
  // WebGPU-routing markers: a `*GpuDispatch` bridge (the GPU analog of the
  // `*Dispatch` WASM bridge), or a direct GPU pool / backend / device reference.
  const gpuDispatchRe = /\b\w+GpuDispatch\b/g;
  const gpuRefRe =
    /\b(?:gpuPool|getGlobalGPUBackend|GPUBackend|gpuMatrixBackend|getGpuDevice)\b/;

  for (const fname of readdirSync(typedDir)) {
    if (!fname.endsWith(".ts")) continue;
    const src = readFileSync(join(typedDir, fname), "utf-8");
    const re = /export const (\w+) = mathTyped\(\s*'\w+'\s*,\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const name = m[1];
      // Brace-match the mathTyped({...}) object literal starting at its `{`.
      let depth = 0;
      const start = m.index + m[0].length - 1;
      let end = start;
      for (let i = start; i < src.length; i++) {
        const c = src[i];
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const block = src.slice(start, end + 1);
      const markers = Array.from(new Set(block.match(gpuDispatchRe) ?? []));
      const refMatch = block.match(gpuRefRe);
      if (refMatch) markers.push(refMatch[0]);
      const uniq = Array.from(new Set(markers)).sort();
      if (!byFile[fname]) byFile[fname] = { gpu: 0, none: 0 };
      if (uniq.length > 0) {
        gpuAccelerated.push({
          name,
          file: fname,
          routing: "gpu",
          markers: uniq,
        });
        byFile[fname].gpu++;
      } else {
        none.push(name);
        byFile[fname].none++;
      }
    }
  }

  // --- Standalone (non-mathTyped) GPU-accelerated exports -------------------
  //
  // The GPU wins only where the work amortizes the upload/readback: a FUSED
  // CHAIN of ops, or a large matmul. Those do not live behind `mathTyped`
  // per-function dispatch (a single `sin(xs)` on the GPU would be
  // transfer-dominated and slower), so scanning only `mathTyped` blocks misses
  // every GPU path the library actually ships. Scan plain exported functions too.
  const standaloneAccelerated: WebGPUPairingEntry[] = [];
  const standaloneDirs = [
    join(rootDir, "functions", "src", "typed"),
    join(rootDir, "functions", "src", "gpu"),
  ].filter((d) => existsSync(d));

  // Match BOTH exported and private functions: a public function often reaches the
  // GPU through a same-file helper (e.g. `elementwiseChainGpuDispatch` calls a
  // private `getResources()` that owns the `getGpuDevice()` call). Scanning only the
  // exported body would miss it and under-report — which is exactly what happened.
  const anyFnRe = /(export\s+)?(?:async\s+)?function\s+(\w+)/g;
  for (const dir of standaloneDirs) {
    const rel = relative(join(rootDir, "functions", "src"), dir).replace(
      /\\/g,
      "/",
    );
    for (const fname of readdirSync(dir)) {
      if (!fname.endsWith(".ts")) continue;
      const src = readFileSync(join(dir, fname), "utf-8");

      // Pass 1 — every function in the file, its body, and its own direct markers.
      const fns: Array<{
        name: string;
        exported: boolean;
        body: string;
        markers: string[];
      }> = [];
      let m: RegExpExecArray | null;
      anyFnRe.lastIndex = 0;
      while ((m = anyFnRe.exec(src)) !== null) {
        const brace = src.indexOf("{", m.index + m[0].length);
        if (brace === -1) continue;
        const body = matchBraceBlock(src, brace);
        const markers = Array.from(new Set(body.match(gpuDispatchRe) ?? []));
        const refMatch = body.match(gpuRefRe);
        if (refMatch) markers.push(refMatch[0]);
        fns.push({
          name: m[2],
          exported: Boolean(m[1]),
          body,
          markers: Array.from(new Set(markers)),
        });
      }

      // Pass 2 — propagate a callee's markers up to its callers, TRANSITIVELY.
      //
      // One level is not enough, and assuming it was caused a real miscount. A public
      // entry point may sit several hops above the GPU call:
      //
      //   elementwiseChainGpuDispatch  ->  chainGpuDispatchImpl  ->  getResources
      //     (thin serializing wrapper)      (no DIRECT marker)        (getGpuDevice)
      //
      // A one-level pass looks at the wrapper, sees a callee whose *own direct* markers
      // are empty, and drops it — silently reporting a GPU-routed public function as
      // not GPU-routed. So iterate to a fixed point over ALL functions (not just the
      // exported ones — a private middleman must be able to carry markers upward), then
      // emit the exported ones.
      const markersOf = new Map(fns.map((f) => [f.name, new Set(f.markers)]));
      const callsRe = new Map(
        fns.map((f) => [f.name, new RegExp(`\\b${f.name}\\s*\\(`)]),
      );
      for (let changed = true; changed;) {
        changed = false;
        for (const caller of fns) {
          const into = markersOf.get(caller.name)!;
          for (const callee of fns) {
            if (callee.name === caller.name) continue;
            const from = markersOf.get(callee.name)!;
            if (from.size === 0) continue;
            if (!callsRe.get(callee.name)!.test(caller.body)) continue;
            for (const k of from) {
              if (!into.has(k)) {
                into.add(k);
                changed = true;
              }
            }
          }
        }
      }

      for (const f of fns) {
        if (!f.exported) continue;
        const uniq = Array.from(markersOf.get(f.name)!).sort();
        if (uniq.length > 0) {
          standaloneAccelerated.push({
            name: f.name,
            file: `${rel}/${fname}`,
            routing: "gpu",
            markers: uniq,
          });
        }
      }
    }
  }

  gpuAccelerated.sort((a, b) => a.name.localeCompare(b.name));
  standaloneAccelerated.sort((a, b) => a.name.localeCompare(b.name));
  none.sort();

  const typedCount = gpuAccelerated.length;
  const standaloneCount = standaloneAccelerated.length;
  const status =
    typedCount === 0 && standaloneCount === 0
      ? 'No WebGPU accelerators are wired yet — forward-looking tracker (see ROADMAP "WebGPU acceleration tier").'
      : `${standaloneCount} standalone function(s) route to WebGPU; ${typedCount} of ${typedCount + none.length} typed-dispatch functions do — see the note in webgpu-pairing.md for why that number is deliberately small.`;

  return {
    generated: new Date().toISOString().split("T")[0],
    status,
    total: typedCount + none.length,
    gpuAcceleratedCount: typedCount,
    noneCount: none.length,
    gpuAccelerated,
    none,
    byFile,
    standaloneAcceleratedCount: standaloneCount,
    standaloneAccelerated,
  };
}

function generateWebGPUPairingMarkdown(p: WebGPUPairing): string {
  let md = "# WebGPU Accelerator ↔ Function Pairing\n\n";
  md += `**Generated**: ${p.generated} (by tools/create-dependency-graph)\n\n`;
  md += `The GPU analog of \`wasm-pairing.md\`. Which functions route to a **WebGPU** path — `;
  md += `detected via a \`*GpuDispatch\` bridge (mirroring the \`*Dispatch\` WASM convention) `;
  md += `or a direct GPU backend/device reference (\`GPUBackend\` / \`gpuMatrixBackend\` / `;
  md += `\`getGpuDevice\`).\n\n`;
  md += `> **Status:** ${p.status}\n\n`;

  md += `## WebGPU-accelerated functions (${p.standaloneAcceleratedCount})\n\n`;
  if (p.standaloneAccelerated.length > 0) {
    md += `Standalone exports — this is where the GPU acceleration actually lives.\n\n`;
    md += `| Function | Markers | Module |\n| --- | --- | --- |\n`;
    for (const e of p.standaloneAccelerated) {
      md += `| \`${e.name}\` | \`${e.markers.join("`, `")}\` | ${e.file.replace(/\.ts$/, "")} |\n`;
    }
    md += `\n`;
  } else {
    md += `_None yet._\n\n`;
  }

  md += `## Typed-dispatch layer: ${p.gpuAcceleratedCount} of ${p.total}\n\n`;
  md += `> **A SMALL count here is EXPECTED and correct — it is a design decision, not a gap.**\n>\n`;
  md += `> A GPU dispatch costs an upload and a readback. A *single* typed op (\`sin(xs)\`) is `;
  md += `therefore pure transfer tax and would be **slower** on the GPU than JS or WASM — the `;
  md += `same economics that retired element-wise ops from the WASM backend. The GPU only pays `;
  md += `off where the work amortizes that transfer: a **fused chain** of ops `;
  md += `(\`fuseUnaryChainAsync\`, 3.2–8.3× over WASM, measured) a large **matmul**, or an **FFT** (parallelFFT/parallelIFFT above 262,144 points: log2(n) passes amortize the upload, ~2.2-3.4x measured). `;
  md += `functions, listed above.\n>\n`;
  md += `> Wiring every \`mathTyped\` function to a GPU path would make this number look better `;
  md += `and make the library slower. So we don't.\n\n`;
  md += `| Routing (static) | Count |\n| --- | --: |\n`;
  md += `| WebGPU | ${p.gpuAcceleratedCount} |\n`;
  md += `| None | ${p.noneCount} |\n`;
  md += `| **Total** | **${p.total}** |\n\n`;
  if (p.gpuAccelerated.length > 0) {
    md += `### Typed functions routing to WebGPU\n\n| Function | Markers | Module |\n| --- | --- | --- |\n`;
    for (const e of p.gpuAccelerated) {
      md += `| \`${e.name}\` | \`${e.markers.join("`, `")}\` | ${e.file.replace(/\.ts$/, "")} |\n`;
    }
    md += `\n`;
  }
  md += `## Per-module counts (typed layer)\n\n| Module | WebGPU | None |\n| --- | --: | --: |\n`;
  for (const f of Object.keys(p.byFile).sort()) {
    md += `| ${f.replace(/\.ts$/, "")} | ${p.byFile[f].gpu} | ${p.byFile[f].none} |\n`;
  }
  return md;
}

/**
 * Parallel (worker-pool) ↔ function pairing analysis.
 *
 * The parallel analog of {@link analyzeWasmPairing}. Scans the `functions`
 * package's public typed API (`functions/src/typed/*.ts`) and determines, per
 * `mathTyped` export, whether it dispatches to the worker pool — via a
 * `computePool.<op>()` call (a named op with a tunable threshold) or a generic
 * kernel path (`applyKernel` / `mapArray` / a bare `parallel*` helper / a
 * `shouldParallelize` gate). Crucially, unlike WASM routing, a function can be
 * *wired* to the pool yet still always run inline JS because its op's threshold
 * in `DEFAULT_THRESHOLD_BY_OP` is `'never'` — the parallel equivalent of a
 * WASM js-fallback. This report pairs each function against the canonical
 * thresholds parsed straight from `parallel/src/ComputePool.ts`, so the
 * "which functions are effectively parallelized" map is a generated artifact.
 */
type ParallelEffectiveness = "effective" | "disabled";
interface ParallelPairingEntry {
  name: string;
  file: string;
  /** computePool op names + the `applyKernel` pseudo-op when a generic path exists. */
  ops: string[];
  /** Resolved threshold display, parallel to `ops` (e.g. `'4096'`, `'never'`, `'50000 (global)'`). */
  thresholds: string[];
  effectiveness: ParallelEffectiveness;
}
/** One row of the canonical threshold table (parsed from ComputePool.ts). */
interface ParallelOpRow {
  op: string;
  threshold: string; // 'never' | 'always' | numeric string | 'N (global)'
  active: boolean; // threshold !== 'never'
  functions: string[]; // typed functions dispatching through this op
}
/** Canonical per-op thresholds, parsed from `parallel/src/ComputePool.ts`. */
interface ParallelThresholds {
  byOp: Map<string, string>; // op -> 'never' | 'always' | numeric string
  global: number; // thresholdElements fallback for ops absent from the map
}
interface ParallelPairing {
  generated: string;
  total: number; // all mathTyped functions scanned
  parallelizedCount: number; // route to computePool / generic kernel
  effectiveCount: number; // parallelized AND at least one op active
  disabledCount: number; // parallelized but every op is 'never'
  nonParallelCount: number; // no worker-pool reference
  globalThreshold: number; // thresholdElements fallback
  /** Whether ComputePool.ts thresholds were parsed (false ⇒ table degraded). */
  thresholdsResolved: boolean;
  /** Detection is per-`mathTyped`-block direct references; parallelism reached
   * only through helper functions outside the block is not traced (under-reports). */
  parallelized: ParallelPairingEntry[];
  nonParallel: string[];
  byOp: ParallelOpRow[];
  byFile: Record<string, { effective: number; disabled: number; none: number }>;
}

/**
 * Parse the canonical per-op parallelization thresholds directly from
 * `parallel/src/ComputePool.ts` — the `DEFAULT_THRESHOLD_BY_OP` object literal
 * plus the `thresholdElements` global fallback — so the pairing table is
 * generated rather than a hand-copied snapshot. Line comments are stripped
 * before parsing so values in trailing `//` comments (e.g. `// (4,096 …)`)
 * can't leak in. Returns `null` if the source can't be located.
 */
function readParallelThresholds(rootDir: string): ParallelThresholds | null {
  const candidates = [
    join(rootDir, "parallel", "src", "ComputePool.ts"),
    join(rootDir, "src", "ComputePool.ts"),
  ];
  const path = candidates.find((p) => existsSync(p));
  if (!path) return null;
  const src = readFileSync(path, "utf-8");

  // Brace-match the DEFAULT_THRESHOLD_BY_OP object literal.
  const anchor = src.indexOf("DEFAULT_THRESHOLD_BY_OP");
  if (anchor < 0) return null;
  const eq = src.indexOf("=", anchor);
  const braceStart = src.indexOf("{", eq);
  if (eq < 0 || braceStart < 0) return null;
  let depth = 0;
  let end = braceStart;
  for (let i = braceStart; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  // Strip line comments so commented example numbers don't get parsed as values.
  const body = src
    .slice(braceStart, end + 1)
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");

  const byOp = new Map<string, string>();
  const re = /(\w+)\s*:\s*(?:'(never|always)'|([\d_]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const op = m[1];
    const value = m[2] ?? m[3].replace(/_/g, "");
    byOp.set(op, value);
  }

  const gm = src.match(/thresholdElements:\s*(\d+)/);
  const global = gm ? parseInt(gm[1], 10) : 50_000;
  return { byOp, global };
}

function analyzeParallelPairing(rootDir: string): ParallelPairing | null {
  const candidates = [
    join(rootDir, "functions", "src", "typed"),
    join(rootDir, "src", "typed"),
  ];
  const typedDir = candidates.find((d) => existsSync(d));
  if (!typedDir) return null;

  const thresholds = readParallelThresholds(rootDir);
  const byOpMap = thresholds?.byOp ?? new Map<string, string>();
  const globalThreshold = thresholds?.global ?? 50_000;

  // Resolve an op to its threshold display. Ops absent from the map fall back to
  // the global `thresholdElements` at runtime (so they are active). The generic
  // `applyKernel` pseudo-op is gated by the same global threshold.
  const resolve = (op: string): string => {
    if (op === "applyKernel") return `${globalThreshold} (global kernel)`;
    const v = byOpMap.get(op);
    return v ?? `${globalThreshold} (global)`;
  };
  const isActive = (op: string): boolean => resolve(op) !== "never";

  // computePool methods that are infrastructure, not dispatchable ops. `applyKernel`
  // is handled separately (it is the generic-kernel parallel path).
  const INFRA = new Set([
    "shouldParallelize",
    "terminate",
    "getStats",
    "isReady",
    "configure",
    "warmup",
    "dispose",
    "getConfig",
    "setConfig",
    "execute",
    "on",
  ]);

  const parallelized: ParallelPairingEntry[] = [];
  const nonParallel: string[] = [];
  const byFile: Record<
    string,
    { effective: number; disabled: number; none: number }
  > = {};
  const opUsers = new Map<string, Set<string>>();

  for (const fname of readdirSync(typedDir)) {
    if (!fname.endsWith(".ts")) continue;
    const src = readFileSync(join(typedDir, fname), "utf-8");
    const re = /export const (\w+) = mathTyped\(\s*'\w+'\s*,\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const name = m[1];
      // Brace-match the mathTyped({...}) object literal starting at its `{`.
      let depth = 0;
      const start = m.index + m[0].length - 1;
      let end = start;
      for (let i = start; i < src.length; i++) {
        const c = src[i];
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const block = src.slice(start, end + 1);

      // Named computePool ops (excluding infra) + generic-kernel detection.
      const ops = new Set<string>();
      let generic = false;
      for (const cm of block.matchAll(/computePool\.(\w+)\s*\(/g)) {
        const method = cm[1];
        if (method === "applyKernel") generic = true;
        else if (!INFRA.has(method)) ops.add(method);
      }
      // Generic worker-pool paths that don't map to a single named op: the
      // `mapArray` helper (wraps computePool.applyKernel), a `shouldParallelize`
      // gate, or a bare `parallel*` signal/reduction helper.
      if (/\bmapArray\s*\(/.test(block)) generic = true;
      if (/\bcomputePool\.shouldParallelize\s*\(/.test(block)) generic = true;
      if (/\bparallel[A-Z]\w+\s*\(/.test(block)) generic = true;
      if (generic) ops.add("applyKernel");

      if (!byFile[fname])
        byFile[fname] = { effective: 0, disabled: 0, none: 0 };
      if (ops.size === 0) {
        nonParallel.push(name);
        byFile[fname].none++;
        continue;
      }
      const opList = [...ops].sort();
      const effective = opList.some((op) => isActive(op));
      for (const op of opList) {
        if (!opUsers.has(op)) opUsers.set(op, new Set());
        opUsers.get(op)!.add(name);
      }
      parallelized.push({
        name,
        file: fname,
        ops: opList,
        thresholds: opList.map((op) => resolve(op)),
        effectiveness: effective ? "effective" : "disabled",
      });
      if (effective) byFile[fname].effective++;
      else byFile[fname].disabled++;
    }
  }

  parallelized.sort((a, b) => a.name.localeCompare(b.name));
  nonParallel.sort();

  // Canonical threshold table: every op in DEFAULT_THRESHOLD_BY_OP (source of
  // truth) plus any extra op detected in the typed API (resolves to global).
  const allOps = new Set<string>([...byOpMap.keys(), ...opUsers.keys()]);
  const byOp: ParallelOpRow[] = [...allOps].sort().map((op) => ({
    op,
    threshold: resolve(op),
    active: isActive(op),
    functions: [...(opUsers.get(op) ?? [])].sort(),
  }));

  const effectiveCount = parallelized.filter(
    (e) => e.effectiveness === "effective",
  ).length;
  const disabledCount = parallelized.filter(
    (e) => e.effectiveness === "disabled",
  ).length;
  return {
    generated: new Date().toISOString().split("T")[0],
    total: parallelized.length + nonParallel.length,
    parallelizedCount: parallelized.length,
    effectiveCount,
    disabledCount,
    nonParallelCount: nonParallel.length,
    globalThreshold,
    thresholdsResolved: thresholds !== null,
    parallelized,
    nonParallel,
    byOp,
    byFile,
  };
}

function generateParallelPairingMarkdown(p: ParallelPairing): string {
  let md = "# Parallel (Worker-Pool) ↔ Function Pairing\n\n";
  md += `**Generated**: ${p.generated} (by tools/create-dependency-graph)\n\n`;
  md += `Per public \`mathTyped\` function in \`functions/src/typed/\`, its worker-pool `;
  md += `routing: a **named op** (\`computePool.<op>()\`, which consults a tunable threshold) `;
  md += `or a **generic kernel** path (\`applyKernel\`/\`mapArray\`/\`shouldParallelize\`/a bare `;
  md += `\`parallel*\` helper — gated by the global \`thresholdElements\`). A function counts as `;
  md += `**effective** when at least one of its ops has a threshold ≠ \`'never'\`, and **disabled** `;
  md += `when every op it touches is \`'never'\` (wired to the pool but always runs inline JS — `;
  md += `the parallel analog of a WASM js-fallback).\n\n`;
  md += `> Detection is per-\`mathTyped\`-block direct references; parallelism reached only via `;
  md += `helper functions outside the block is not traced, so this can under-report. Thresholds are `;
  md += `parsed from \`parallel/src/ComputePool.ts\` (\`DEFAULT_THRESHOLD_BY_OP\` + \`thresholdElements\`).`;
  if (!p.thresholdsResolved) {
    md += ` **⚠ ComputePool.ts could not be parsed — thresholds degraded to the ${p.globalThreshold} global default.**`;
  }
  md += `\n\n`;
  md += `| Routing | Count |\n| --- | --: |\n`;
  md += `| Parallel — effective (op threshold active) | ${p.effectiveCount} |\n`;
  md += `| Parallel — disabled (all ops \`'never'\`) | ${p.disabledCount} |\n`;
  md += `| Non-parallel (no worker-pool path) | ${p.nonParallelCount} |\n`;
  md += `| **Total** | **${p.total}** |\n\n`;
  md += `Global fallback threshold (\`thresholdElements\`, for ops absent from the per-op map): `;
  md += `**${p.globalThreshold}** elements.\n\n`;

  md += `## Effectively parallelized functions\n\n`;
  md += `| Function | Ops | Thresholds (elements) | Module |\n| --- | --- | --- | --- |\n`;
  for (const e of p.parallelized.filter(
    (x) => x.effectiveness === "effective",
  )) {
    md += `| \`${e.name}\` | \`${e.ops.join("`, `")}\` | ${e.thresholds.join(", ")} | ${e.file.replace(/\.ts$/, "")} |\n`;
  }

  md += `\n## Disabled parallel paths (wired but always inline JS)\n\n`;
  md += `These route to the worker pool but every op resolves to \`'never'\` — overhead dominated `;
  md += `at all benchmarked sizes, so they always run inline JS today. Kept wired so a future `;
  md += `threshold retune (\`tools/benchmark/parallel/run.ts\`) can switch them on without code churn.\n\n`;
  md += `| Function | Ops (all \`'never'\`) | Module |\n| --- | --- | --- |\n`;
  for (const e of p.parallelized.filter(
    (x) => x.effectiveness === "disabled",
  )) {
    md += `| \`${e.name}\` | \`${e.ops.join("`, `")}\` | ${e.file.replace(/\.ts$/, "")} |\n`;
  }

  md += `\n## Per-module counts\n\n| Module | Effective | Disabled | Non-parallel |\n| --- | --: | --: | --: |\n`;
  for (const f of Object.keys(p.byFile).sort()) {
    md += `| ${f.replace(/\.ts$/, "")} | ${p.byFile[f].effective} | ${p.byFile[f].disabled} | ${p.byFile[f].none} |\n`;
  }

  // Canonical threshold table — the parallel analog of the WASM binary export
  // table. Parsed from ComputePool.ts so ARCHITECTURE docs stop hand-maintaining it.
  md += `\n## Canonical op thresholds\n\n`;
  md += `Parsed from \`parallel/src/ComputePool.ts\` (\`DEFAULT_THRESHOLD_BY_OP\`). \`# functions\` `;
  md += `counts public typed functions dispatching through each op (0 ⇒ the op is exposed by the `;
  md += `pool but not reached from the scanned typed API — e.g. used only by the matrix package or `;
  md += `internal helpers). \`applyKernel\` is the synthetic generic-kernel path.\n\n`;
  md += `| Op | Threshold (elements) | Active? | # functions |\n| --- | --- | :-: | --: |\n`;
  for (const r of p.byOp) {
    md += `| \`${r.op}\` | ${r.threshold} | ${r.active ? "✓" : "—"} | ${r.functions.length} |\n`;
  }

  md += `\n## Non-parallel functions (no worker-pool path)\n\n`;
  md += `Pure-JS or WASM-only typed functions — see \`wasm-pairing.md\` for their WASM routing.\n\n`;
  md += p.nonParallel.length
    ? p.nonParallel.map((n) => `\`${n}\``).join(", ") + "\n"
    : "_(none)_\n";

  md += `\n> Notes: element-wise arithmetic/transcendental ops (\`add\`/\`sin\`/\`exp\`/…) and the `;
  md += `signal/reduction ops are \`'never'\` — the 2026-05 parallel benchmark found worker `;
  md += `overhead dominates at every tested size for memory-bound element-wise work. The active `;
  md += `set is the compute-bound ops (tensordot, matmul, matrixPower, characteristicPolynomial, `;
  md += `the hypothesis tests, and the special functions erfc/besselJ/spectrogram/sampleChunk) `;
  md += `plus any generic \`applyKernel\` path above the ${p.globalThreshold}-element global `;
  md += `threshold. Re-tune via \`tools/benchmark/parallel/run.ts\`.\n`;
  return md;
}

/**
 * Duplicate-symbol detection: the recurring MathTS "multiple implementations of
 * one name across packages/files" problem — three `fft`s; `sum`/`distance`/
 * `cumsum`/`variance` duplicated across the typed/factory/compat layers;
 * `fftshift`/`ifftshift` defined independently in both
 * `functions/src/signal/fft.ts` (generic `<T>`) and
 * `functions/src/signal/fft-helpers.ts` (`number[]`). This is the measurement
 * that scopes a consolidation campaign — later it can gate CI directly.
 *
 * A "definer" is a file that OWNS a symbol's implementation body — the name is
 * in that file's own `functions`/`constants`/`classes` (runtime) or
 * `interfaces`/`types`/`enums` (type) export list AND is NOT also in that
 * file's `reExported` list. `reExported` already captures every re-export FORM
 * the parser recognises for a named export — `export { x } from './y'`,
 * `export type { x } from './y'`, and their workspace-scoped equivalents
 * (`export { x } from '@scope/pkg'`) all push the exported name into
 * `exports.reExported` regardless of destination (see `parseFile`). A name
 * landing there is a FORWARD, not an independent body, so it is excluded here
 * without needing to walk the barrel re-export map — that map resolves
 * *relative-import chains* for reachability tracing, a different concern from
 * "does this file's own export list represent a real definition."
 *
 * NOT detected here: typed-dispatch polymorphism, e.g. a single public name
 * (`abs`) registered with multiple typed overloads for different argument
 * shapes (`abs(number)` vs `abs(matrix)`) — that requires call-graph/signature
 * analysis, out of scope. A flagged name may be a genuine duplicate OR a
 * legitimate typed-dispatch/factory variant; a human triages using the
 * recorded defining files + public flags (see `DUPLICATE_SYMBOLS_NOTE`).
 */
type RuntimeSymbolCategory = "function" | "constant" | "class";
type TypeSymbolCategory = "interface" | "type" | "enum";
type DupExportKey =
  "functions" | "constants" | "classes" | "interfaces" | "types" | "enums";

/**
 * Per-definer classification (see the big comment above `buildDuplicateEntries`
 * for the full decision model):
 * - `ALLOWLISTED` — matches `duplicate-allowlist.json` (human-curated: hot-path
 *   `is*` guards, AssemblyScript mirrors, per-package `VERSION` strings).
 * - `DISPATCH_VARIANT` — `export const X = mathTyped('X', {...})`, a public
 *   typed-dispatch registration, not a copy-paste body.
 * - `ALIAS_DELEGATION` — `export const X = Y` where `Y` is bound by an
 *   `import` in the same file — a forward, not an independent body.
 * - `PLAIN` — none of the above; a genuine own-defined body.
 */
type DupDefinerTag =
  "ALLOWLISTED" | "DISPATCH_VARIANT" | "ALIAS_DELEGATION" | "PLAIN";

/**
 * Entry-level (per-name) classification, derived from its definers'
 * `DupDefinerTag`s — see `buildDuplicateEntries`.
 */
type DupEntryTag =
  "TRUE_DUPLICATE" | "DISPATCH_VARIANT" | "ALIAS_DELEGATION" | "ALLOWLISTED";

interface DuplicateDefiner {
  file: string;
  package: string;
  public: boolean;
  /** This definer's own classification (see `DupDefinerTag`). */
  tag: DupDefinerTag;
  /** Present when `tag === 'ALLOWLISTED'` — the matching allowlist entry's reason. */
  reason?: string;
}

interface DuplicateSymbolEntry {
  name: string;
  /** Distinct own-definition categories across definers, '+'-joined (e.g.
   *  "function" or "constant+function" — the latter when e.g. one file
   *  assigns `export const fft = createFft(...)` and another declares
   *  `export function fft`, as with the real `fft` case). */
  category: string;
  definers: DuplicateDefiner[];
  /** File path of the sole PUBLIC definer, `'AMBIGUOUS'` (>=2 public
   *  definers), or `'internal-only'` (0 public definers). A hint, not a
   *  verdict — a human still confirms before consolidating. */
  canonicalHint: string;
  /** Entry-level classification (see `DupEntryTag`). Only `TRUE_DUPLICATE`
   *  is the actionable merge-target bucket. */
  tag: DupEntryTag;
}

interface DuplicateSymbolsReport {
  generated: string;
  note: string;
  summary: {
    /** Count of `TRUE_DUPLICATE`-tagged runtime entries — the actionable number. */
    runtimeDuplicates: number;
    /** Count of `TRUE_DUPLICATE`-tagged type entries. */
    typeDuplicates: number;
    runtimeByTag: Record<DupEntryTag, number>;
    typeByTag: Record<DupEntryTag, number>;
  };
  runtime: DuplicateSymbolEntry[];
  types: DuplicateSymbolEntry[];
}

const RUNTIME_DUP_CATEGORIES: Array<{
  cat: RuntimeSymbolCategory;
  key: DupExportKey;
}> = [
  { cat: "function", key: "functions" },
  { cat: "constant", key: "constants" },
  { cat: "class", key: "classes" },
];

const TYPE_DUP_CATEGORIES: Array<{
  cat: TypeSymbolCategory;
  key: DupExportKey;
}> = [
  { cat: "interface", key: "interfaces" },
  { cat: "type", key: "types" },
  { cat: "enum", key: "enums" },
];

const DUPLICATE_SYMBOLS_NOTE =
  "This report groups names by OWN definition, not by call graph, then classifies each " +
  "flagged name (see DupEntryTag): TRUE_DUPLICATE (the actionable merge targets), " +
  "DISPATCH_VARIANT (>=2 mathTyped(...) registrations of the same public name — distinct " +
  "dispatch surfaces, Bucket C delegation candidates, not copy-paste bodies), " +
  "ALIAS_DELEGATION (a const-alias forward to an imported symbol, not an independent body — " +
  "excluded once fewer than 2 real bodies remain), and ALLOWLISTED (matches " +
  "duplicate-allowlist.json: hot-path is* guards, AssemblyScript mirrors, per-package " +
  "VERSION strings). NOT detected: same-file typed-dispatch overload polymorphism for " +
  "different argument shapes within one registration — a human still triages TRUE_DUPLICATE " +
  "entries using the defining files + public flags before merging anything.";

interface DuplicateAllowlistEntry {
  /** Symbol-name patterns. A trailing `*` is a prefix match; the literal `*` matches any name. */
  names: string[];
  /** File-path patterns, repo-relative. A trailing `/**` is a directory-prefix match; anything
   *  else must match the file path exactly. */
  filesGlob: string[];
  reason: string;
}

let duplicateAllowlistCache: DuplicateAllowlistEntry[] | undefined;

/**
 * Load `tools/create-dependency-graph/duplicate-allowlist.json` — the
 * human-curated set of legitimately-independent own-definitions (hot-path
 * `is*` guards kept local per project-all-libraries-build-on-core,
 * AssemblyScript mirrors that can't import core, per-package `VERSION`
 * strings). Missing/unparseable file → empty allowlist (fail open to
 * "nothing allowlisted", not a crash).
 */
function loadDuplicateAllowlist(): DuplicateAllowlistEntry[] {
  if (duplicateAllowlistCache) return duplicateAllowlistCache;
  const path = join(
    ROOT_DIR,
    "tools",
    "create-dependency-graph",
    "duplicate-allowlist.json",
  );
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as {
      entries?: DuplicateAllowlistEntry[];
    };
    duplicateAllowlistCache = parsed.entries ?? [];
  } catch {
    duplicateAllowlistCache = [];
  }
  return duplicateAllowlistCache;
}

/** `pattern` against `value`: literal `*` matches anything, a trailing `/**`
 *  is a directory-prefix match, a trailing `*` is a plain prefix match,
 *  otherwise exact string equality. */
function globMatchSingle(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("/**")) return value.startsWith(pattern.slice(0, -2)); // keep the trailing '/'
  if (pattern.endsWith("*")) return value.startsWith(pattern.slice(0, -1));
  return value === pattern;
}

function findAllowlistMatch(
  allowlist: DuplicateAllowlistEntry[],
  name: string,
  filePath: string,
): DuplicateAllowlistEntry | undefined {
  return allowlist.find(
    (e) =>
      e.names.some((n) => globMatchSingle(n, name)) &&
      e.filesGlob.some((f) => globMatchSingle(f, filePath)),
  );
}

const rawFileContentCache = new Map<string, string>();

/** Raw (unstripped) source of a repo-relative file path, cached. Used only by
 *  the duplicate-classification regexes below — separate from `parseFile`'s
 *  own comment-stripped `code` (not retained on `ParsedFile`). */
function getRawFileContent(relPath: string): string {
  const cached = rawFileContentCache.get(relPath);
  if (cached !== undefined) return cached;
  let content = "";
  try {
    content = readFileSync(join(ROOT_DIR, relPath), "utf-8");
  } catch {
    content = "";
  }
  rawFileContentCache.set(relPath, content);
  return content;
}

function stripCommentsForClassification(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function escapeRegExpLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `export const NAME = mathTyped('NAME', {...` (optional generic args) — a
 *  typed-function dispatch registration: a distinct public dispatch surface,
 *  not a copy-paste duplicate body. */
function isDispatchVariantBody(code: string, name: string): boolean {
  const re = new RegExp(
    `export\\s+const\\s+${escapeRegExpLiteral(name)}\\s*(?::[^=]+)?=\\s*mathTyped\\s*(?:<[^>]*>)?\\s*\\(`,
  );
  return re.test(code);
}

/** Every LOCAL binding name introduced by an `import` statement in `code`
 *  (comment-stripped) — the alias after `as` for named imports, the
 *  default-import binding, or the namespace-import binding. Deliberately
 *  ignores WHERE the import resolves (relative vs workspace-scoped) — for
 *  alias-delegation purposes we only need to know the RHS identifier is
 *  imported, not same-file-local. */
function collectImportedLocalNames(code: string): Set<string> {
  const names = new Set<string>();
  const importRegex =
    /import\s+(?:type\s+)?(?:(?:\{([^}]+)\}|(\w+)|\*\s+as\s+(\w+))(?:\s*,\s*(?:\{([^}]+)\}|(\w+)))?)\s+from\s+['"][^'"]+['"]/g;
  let m: RegExpExecArray | null;
  while ((m = importRegex.exec(code)) !== null) {
    const named = m[1] || m[4] || "";
    const def = m[2] || m[5] || "";
    const ns = m[3] || "";
    if (named) {
      for (const item of named.split(",")) {
        const trimmed = item.trim().replace(/^type\s+/, "");
        if (!trimmed) continue;
        const parts = trimmed.split(/\s+as\s+/);
        const local = parts[parts.length - 1].trim();
        if (local) names.add(local);
      }
    }
    if (def) names.add(def);
    if (ns) names.add(ns);
  }
  return names;
}

/** `export const NAME = someIdentifier;` (optional type annotation) where the
 *  RHS is a BARE identifier bound by an `import` elsewhere in the file — a
 *  delegation/re-export, not an independent body (e.g. `compat/src/shims.ts`'s
 *  `export const abs = _abs;`, `_abs` imported as `abs as _abs`). */
function isAliasDelegationBody(
  code: string,
  name: string,
  importedLocalNames: Set<string>,
): boolean {
  const re = new RegExp(
    `export\\s+const\\s+${escapeRegExpLiteral(name)}\\s*(?::[^=]+)?=\\s*([A-Za-z_$][\\w$]*)\\s*;`,
  );
  const m = code.match(re);
  return !!m && importedLocalNames.has(m[1]);
}

/**
 * Classify a single definer. Allowlist wins first (explicit human curation);
 * then, for `constant`-category definers only (the shape `export const X =
 * ...` — the only shape ALIAS_DELEGATION/DISPATCH_VARIANT can apply to),
 * check for a dispatch registration or an alias forward. Everything else is
 * `PLAIN` — a genuine own-defined body.
 */
function classifyDefiner(
  file: ParsedFile,
  name: string,
  category: string,
  allowlist: DuplicateAllowlistEntry[],
): { tag: DupDefinerTag; reason?: string } {
  const allowMatch = findAllowlistMatch(allowlist, name, file.path);
  if (allowMatch) return { tag: "ALLOWLISTED", reason: allowMatch.reason };

  if (category === "constant") {
    const raw = getRawFileContent(file.path);
    if (raw) {
      const code = stripCommentsForClassification(raw);
      if (isDispatchVariantBody(code, name)) return { tag: "DISPATCH_VARIANT" };
      if (isAliasDelegationBody(code, name, collectImportedLocalNames(code))) {
        return { tag: "ALIAS_DELEGATION" };
      }
    }
  }
  return { tag: "PLAIN" };
}

/**
 * Collect every OWN definition of every symbol name across `files`, keyed by
 * name. A definer is recorded only when the name is in the file's own export
 * list for that category AND absent from `file.exports.reExported`.
 */
function collectOwnDefiners(
  files: ParsedFile[],
  categories: Array<{ cat: string; key: DupExportKey }>,
): Map<string, Array<{ file: ParsedFile; category: string }>> {
  const byName = new Map<
    string,
    Array<{ file: ParsedFile; category: string }>
  >();
  for (const file of files) {
    const reExported = new Set(file.exports.reExported);
    for (const { cat, key } of categories) {
      for (const name of file.exports[key]) {
        if (reExported.has(name)) continue; // forward, not an own body
        // `exports.types` also contains every interface name (the parser
        // pushes interfaces into both `interfaces` and `types`) — skip so an
        // interface isn't double-counted as its own "type" duplicate too.
        if (key === "types" && file.exports.interfaces.includes(name)) continue;
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name)!.push({ file, category: cat });
      }
    }
  }
  return byName;
}

/**
 * Turn per-name definer lists into report entries, keeping only names with
 * >=2 DISTINCT defining files (the candidate-duplicate threshold), resolving
 * each definer's public-surface flag and a canonical-candidate hint.
 *
 * Public is resolved per FILE (not per package-name-union): a definer is
 * public iff its own file is in `publicSurface.publicWildcardFiles` (reached
 * by a wildcard `export *` chain from a package root) OR its specific name is
 * in `publicSurface.publicNamed` (`${file}::${name}`, a NAMED re-export chain
 * to a root). This is what correctly resolves cases like `fftshift`, which is
 * OWN-defined in both `functions/src/signal/fft.ts` and
 * `functions/src/signal/fft-helpers.ts` — only the latter is named-re-exported
 * by `functions/src/index.ts`, so only it is flagged public; a coarser "is the
 * NAME present anywhere in the package's export surface" check would wrongly
 * call both public (package-export-surfaces.json is a flat per-package name
 * set, not file-scoped) and report AMBIGUOUS instead of a clean canonical hint.
 */
const DUP_ENTRY_TAG_SORT_ORDER: Record<DupEntryTag, number> = {
  TRUE_DUPLICATE: 0,
  DISPATCH_VARIANT: 1,
  ALIAS_DELEGATION: 2,
  ALLOWLISTED: 3,
};

function finalizeDuplicateEntry(
  name: string,
  categories: Set<string>,
  definers: DuplicateDefiner[],
  tag: DupEntryTag,
): DuplicateSymbolEntry {
  const publicDefiners = definers.filter((d) => d.public);
  const canonicalHint =
    publicDefiners.length === 1
      ? publicDefiners[0].file
      : publicDefiners.length > 1
        ? "AMBIGUOUS"
        : "internal-only";
  return {
    name,
    category: [...categories].sort().join("+"),
    definers,
    canonicalHint,
    tag,
  };
}

/**
 * Turn per-name definer lists into classified report entries, keeping only
 * names with >=2 DISTINCT defining files (the candidate-duplicate threshold),
 * resolving each definer's public-surface flag, a canonical-candidate hint,
 * and — the classification-aware extension — an entry-level `DupEntryTag`:
 *
 * 1. Classify every definer (`classifyDefiner`): ALLOWLISTED > DISPATCH_VARIANT
 *    / ALIAS_DELEGATION (constant-shape only) > PLAIN.
 * 2. Exclude ALIAS_DELEGATION definers first — a const-alias forward is not an
 *    independent body at all. If fewer than 2 non-alias definers remain, the
 *    "duplication" was illusory (one real body, the rest just forwards to
 *    it) — tag the whole entry ALIAS_DELEGATION (still reported, for
 *    transparency, but excluded from the actionable count).
 * 3. Of the non-alias definers, exclude ALLOWLISTED ones. If fewer than 2
 *    remain, the duplication is fully explained by the allowlist (e.g. the
 *    `is*` guard family, or an AssemblyScript mirror paired with exactly one
 *    JS definer) — tag ALLOWLISTED.
 * 4. Otherwise, if >=2 of the remaining definers are DISPATCH_VARIANT, the
 *    name is a shared public dispatch surface across packages (e.g. `abs`/
 *    `add` registered independently by `functions` and `matrix`) — a Bucket C
 *    delegation candidate, not a blind merge target — tag DISPATCH_VARIANT.
 * 5. Otherwise it's a real TRUE_DUPLICATE — the actionable merge target.
 *
 * Public is resolved per FILE (not per package-name-union): a definer is
 * public iff its own file is in `publicSurface.publicWildcardFiles` (reached
 * by a wildcard `export *` chain from a package root) OR its specific name is
 * in `publicSurface.publicNamed` (`${file}::${name}`, a NAMED re-export chain
 * to a root). This is what correctly resolves cases like `fftshift`, which is
 * OWN-defined in both `functions/src/signal/fft.ts` and
 * `functions/src/signal/fft-helpers.ts` — only the latter is named-re-exported
 * by `functions/src/index.ts`, so only it is flagged public; a coarser "is the
 * NAME present anywhere in the package's export surface" check would wrongly
 * call both public (package-export-surfaces.json is a flat per-package name
 * set, not file-scoped) and report AMBIGUOUS instead of a clean canonical hint.
 */
function buildDuplicateEntries(
  byName: Map<string, Array<{ file: ParsedFile; category: string }>>,
  publicSurface: PublicSurface,
  allowlist: DuplicateAllowlistEntry[],
): DuplicateSymbolEntry[] {
  const isFilePublic = (file: ParsedFile, name: string): boolean =>
    publicSurface.publicWildcardFiles.has(file.path) ||
    publicSurface.publicNamed.has(`${file.path}::${name}`);

  const entries: DuplicateSymbolEntry[] = [];
  for (const [name, defs] of byName) {
    const byFile = new Map<string, { file: ParsedFile; category: string }>();
    for (const d of defs) {
      if (!byFile.has(d.file.path)) byFile.set(d.file.path, d);
    }
    if (byFile.size < 2) continue;

    const categories = new Set<string>();
    const definers: DuplicateDefiner[] = [];
    for (const { file, category } of byFile.values()) {
      categories.add(category);
      const { tag, reason } = classifyDefiner(file, name, category, allowlist);
      definers.push({
        file: file.path,
        package: file.packageName ?? "unknown",
        public: isFilePublic(file, name),
        tag,
        ...(reason ? { reason } : {}),
      });
    }
    definers.sort((a, b) => a.file.localeCompare(b.file));

    const nonAlias = definers.filter((d) => d.tag !== "ALIAS_DELEGATION");
    if (nonAlias.length < 2) {
      entries.push(
        finalizeDuplicateEntry(name, categories, definers, "ALIAS_DELEGATION"),
      );
      continue;
    }

    const nonAllowlisted = nonAlias.filter((d) => d.tag !== "ALLOWLISTED");
    let entryTag: DupEntryTag;
    if (nonAllowlisted.length < 2) {
      entryTag = "ALLOWLISTED";
    } else {
      const dispatchCount = nonAllowlisted.filter(
        (d) => d.tag === "DISPATCH_VARIANT",
      ).length;
      entryTag = dispatchCount >= 2 ? "DISPATCH_VARIANT" : "TRUE_DUPLICATE";
    }
    entries.push(finalizeDuplicateEntry(name, categories, definers, entryTag));
  }
  entries.sort(
    (a, b) =>
      DUP_ENTRY_TAG_SORT_ORDER[a.tag] - DUP_ENTRY_TAG_SORT_ORDER[b.tag] ||
      b.definers.length - a.definers.length ||
      a.name.localeCompare(b.name),
  );
  return entries;
}

function tallyByTag(
  entries: DuplicateSymbolEntry[],
): Record<DupEntryTag, number> {
  const tally: Record<DupEntryTag, number> = {
    TRUE_DUPLICATE: 0,
    DISPATCH_VARIANT: 0,
    ALIAS_DELEGATION: 0,
    ALLOWLISTED: 0,
  };
  for (const e of entries) tally[e.tag]++;
  return tally;
}

function detectDuplicateSymbols(
  files: ParsedFile[],
  publicSurface: PublicSurface,
): { runtime: DuplicateSymbolEntry[]; types: DuplicateSymbolEntry[] } {
  const allowlist = loadDuplicateAllowlist();
  return {
    runtime: buildDuplicateEntries(
      collectOwnDefiners(files, RUNTIME_DUP_CATEGORIES),
      publicSurface,
      allowlist,
    ),
    types: buildDuplicateEntries(
      collectOwnDefiners(files, TYPE_DUP_CATEGORIES),
      publicSurface,
      allowlist,
    ),
  };
}

function generateDuplicateSymbolsMarkdown(
  report: DuplicateSymbolsReport,
): string {
  let md = "# Duplicate Symbols\n\n";
  md += `**Generated**: ${report.generated} (by tools/create-dependency-graph)\n\n`;
  md += `Names that are OWN-DEFINED (not merely re-exported) by >= 2 distinct files across `;
  md += `the monorepo, then CLASSIFIED (see \`DupEntryTag\`) so the actionable subset is clear: `;
  md += `\`TRUE_DUPLICATE\` (real merge targets) vs \`DISPATCH_VARIANT\` (>=2 \`mathTyped(...)\` `;
  md += `registrations of the same public name — distinct dispatch surfaces, Bucket C delegation `;
  md += `candidates, not copy-paste bodies), \`ALIAS_DELEGATION\` (a \`const X = importedY\` `;
  md += `forward, excluded once <2 real bodies remain), and \`ALLOWLISTED\` (matches `;
  md += `\`duplicate-allowlist.json\`: hot-path \`is*\` guards, AssemblyScript mirrors, `;
  md += `per-package \`VERSION\` strings).\n\n`;
  md += `> **Note:** ${report.note}\n\n`;

  const summaryTable = (
    byTag: Record<DupEntryTag, number>,
    total: number,
  ): string =>
    `| Category | Count |\n| --- | --: |\n` +
    `| **TRUE_DUPLICATE** (actionable) | ${byTag.TRUE_DUPLICATE} |\n` +
    `| DISPATCH_VARIANT | ${byTag.DISPATCH_VARIANT} |\n` +
    `| ALIAS_DELEGATION | ${byTag.ALIAS_DELEGATION} |\n` +
    `| ALLOWLISTED | ${byTag.ALLOWLISTED} |\n` +
    `| _Total flagged names_ | ${total} |\n\n`;

  md += `## Summary — runtime (function/constant/class)\n\n`;
  md += summaryTable(report.summary.runtimeByTag, report.runtime.length);
  md += `## Summary — types (interface/type/enum)\n\n`;
  md += summaryTable(report.summary.typeByTag, report.types.length);

  const renderTable = (entries: DuplicateSymbolEntry[]): string => {
    if (entries.length === 0) return "_None._\n\n";
    let out =
      "| Name | Category | Defining files (package, public?, sub-tag) | Canonical hint |\n";
    out += "| --- | --- | --- | --- |\n";
    for (const e of entries) {
      const files = e.definers
        .map((d) => {
          const reasonSuffix = d.reason ? `: ${d.reason}` : "";
          return `\`${d.file}\` (${d.package}, ${d.public ? "public" : "internal"}, ${d.tag}${reasonSuffix})`;
        })
        .join("<br>");
      const hint =
        e.canonicalHint === "AMBIGUOUS"
          ? "**AMBIGUOUS**"
          : `\`${e.canonicalHint}\``;
      out += `| \`${e.name}\` | ${e.category} | ${files} | ${hint} |\n`;
    }
    out += "\n";
    return out;
  };

  const renderTaggedSection = (
    title: string,
    entries: DuplicateSymbolEntry[],
    tag: DupEntryTag,
  ): string =>
    `### ${title}\n\n${renderTable(entries.filter((e) => e.tag === tag))}`;

  md += `## Runtime duplicates\n\n`;
  md += renderTaggedSection(
    "TRUE_DUPLICATE — actionable merge targets",
    report.runtime,
    "TRUE_DUPLICATE",
  );
  md += renderTaggedSection(
    "DISPATCH_VARIANT — distinct public typed-dispatch surfaces (Bucket C candidates)",
    report.runtime,
    "DISPATCH_VARIANT",
  );
  md += renderTaggedSection(
    "ALIAS_DELEGATION — const-alias forwards (not independent bodies)",
    report.runtime,
    "ALIAS_DELEGATION",
  );
  md += renderTaggedSection(
    "ALLOWLISTED — accepted layering (see duplicate-allowlist.json)",
    report.runtime,
    "ALLOWLISTED",
  );

  md += `## Type duplicates (lower priority)\n\n`;
  md += renderTaggedSection("TRUE_DUPLICATE", report.types, "TRUE_DUPLICATE");
  md += renderTaggedSection(
    "DISPATCH_VARIANT",
    report.types,
    "DISPATCH_VARIANT",
  );
  md += renderTaggedSection(
    "ALIAS_DELEGATION",
    report.types,
    "ALIAS_DELEGATION",
  );
  md += renderTaggedSection("ALLOWLISTED", report.types, "ALLOWLISTED");

  return md;
}

// ── Complete file census ────────────────────────────────────────────────────
//
// A whole-repo inventory of EVERY tracked `.ts` file — not just package src/tests
// but ALSO the repo-root cross-package `tests/`, `tools/`, build/test `*.config.ts`,
// `examples/`, and `docs/` reference sources — each tagged with a disposition. The
// point is completeness: no `.ts` in the repo may be silently missing from the docs.
//
// Two DIFFERENT walks, on purpose (an earlier version had both share a per-package
// blind spot, so the gate could not catch a scoping gap):
//   - The CENSUS discovers via ENUMERATED roots (each workspace dir + the specific
//     root dirs tests/tools/examples/docs + root-level config files) and classifies
//     each file (`buildFileInventory`).
//   - The GATE (`verifyFileCensus`) uses a MAXIMAL, location-agnostic walk from the
//     repo root (`walkRepoTsFiles`) as the authoritative ground truth. Any `.ts` the
//     maximal walk finds that the census does not account for — e.g. a `.ts` in a NEW
//     top-level dir the census doesn't enumerate — HARD-FAILS the build. So the gate's
//     ground truth is strictly broader than the census's discovery and cannot share
//     its blind spot.
//
// Both walks exclude only `node_modules`, `dist`, `*.d.ts`, and dot-directories
// (`.git`, `.remember`, `.changeset`, …; tooling/transients, not source). That set
// equals the git-tracked `.ts` files, so there is provably no silent blind spot.

type FileDisposition =
  | "reachable"
  | "build-entry"
  | "test-only"
  | "orphan"
  | "test"
  | "tool"
  | "config"
  | "example";

type FileArea = "src" | "tests" | "tools" | "config" | "examples" | "docs";

interface FileInventoryRow {
  file: string;
  package: string;
  area: FileArea;
  disposition: FileDisposition;
  loc: number;
}

interface FileInventory {
  generated: string;
  totalFiles: number;
  byDisposition: Record<string, number>;
  byArea: Record<string, number>;
  byPackage: Record<string, number>;
  files: FileInventoryRow[];
}

/** MAXIMAL repo walk — every `.ts` (except `.d.ts`) under `rootDir`, skipping
 *  `node_modules`, `dist`, and any dot-directory (`.git`/`.remember`/`.changeset`
 *  — tooling/transients, matching the git-tracked set). Repo-relative, sorted.
 *  This is the GATE's authoritative ground truth; it walks from the repo root and
 *  is location-agnostic, so a `.ts` in any NEW top-level dir is caught. */
function walkRepoTsFiles(rootDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (
        e.name === "node_modules" ||
        e.name === "dist" ||
        e.name.startsWith(".")
      )
        continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) {
        out.push(relative(rootDir, p).replace(/\\/g, "/"));
      }
    }
  };
  walk(rootDir);
  return out.sort();
}

/** The CENSUS's file discovery: ENUMERATED source roots only — each workspace
 *  package directory, the repo-root cross-package dirs (`tests`/`tools`/`examples`/
 *  `docs`), and root-level `.ts` config files. Deliberately narrower than
 *  `walkRepoTsFiles` (it never sees a brand-new top-level dir), so the maximal gate
 *  can catch a scoping gap between them. Same exclusions (node_modules/dist/dot-dirs).
 */
function collectCensusFiles(
  rootDir: string,
  workspaces: Map<string, WorkspacePackage>,
): string[] {
  const set = new Set<string>();
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (
        e.name === "node_modules" ||
        e.name === "dist" ||
        e.name.startsWith(".")
      )
        continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) {
        set.add(relative(rootDir, p).replace(/\\/g, "/"));
      }
    }
  };
  for (const [, ws] of workspaces) walk(join(rootDir, ws.directory));
  for (const d of ["tests", "tools", "examples", "docs"])
    walk(join(rootDir, d));
  // Root-level `.ts` files (vitest.config.ts, vitest.config.browser.ts, …).
  for (const e of readdirSync(rootDir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) {
      set.add(e.name);
    }
  }
  return [...set];
}

/** Classify a repo-relative `.ts` path into an AREA purely by location/name —
 *  independent of the module graph. Order matters: `tools/` and `*.config.ts` win
 *  before the `tests/` and `src` checks. */
function classifyArea(rel: string): FileArea {
  if (/(^|\/)tools\//.test(rel)) return "tools";
  // `*.config.ts` and its variants (`vitest.config.browser.ts`, `*.config.bench.ts`).
  if (/\.config(\.[\w-]+)?\.[cm]?ts$/.test(rel)) return "config";
  if (/\.(test|spec)\.ts$/.test(rel) || /(^|\/)tests\//.test(rel))
    return "tests";
  if (/^examples\//.test(rel)) return "examples";
  if (/^docs\//.test(rel)) return "docs";
  return "src";
}

/** The workspace package a file belongs to (nearest directory prefix), or
 *  `(root)` for repo-root files (root tests/tools/examples/docs/config). */
function packageOf(
  rel: string,
  workspaces: Map<string, WorkspacePackage>,
): string {
  for (const [name, ws] of workspaces) {
    if (rel.startsWith(ws.directory + "/")) return name;
  }
  return "(root)";
}

function countLoc(rootDir: string, relPath: string): number {
  try {
    return readFileSync(join(rootDir, relPath), "utf-8").split("\n").length;
  } catch {
    return 0;
  }
}

/**
 * Build the complete file inventory over the ENUMERATED census roots. Disposition:
 * for a `src` file — build-entry (a seeded root: index/subpath/bin/config/tsup/worker
 * entry) > reachable (in the module graph from a root) > test-only (reachable only
 * from a test) > orphan (reachable from nothing). Non-`src` areas map straight to
 * their kind: `tests → test`, `tools → tool`, `config → config`, `examples`/`docs`
 * → `example`. Every tracked `.ts` therefore gets a visible disposition (inclusion
 * over exclusion — there is no silent allowlist).
 */
function buildFileInventory(
  rootDir: string,
  workspaces: Map<string, WorkspacePackage>,
  roots: Set<string>,
  reachable: Set<string>,
  testReachable: Set<string>,
): FileInventory {
  const rows: FileInventoryRow[] = [];
  for (const rel of collectCensusFiles(rootDir, workspaces)) {
    const area = classifyArea(rel);
    let disposition: FileDisposition;
    if (area === "src") {
      disposition = roots.has(rel)
        ? "build-entry"
        : reachable.has(rel)
          ? "reachable"
          : testReachable.has(rel)
            ? "test-only"
            : "orphan";
    } else if (area === "tests") {
      disposition = "test";
    } else if (area === "tools") {
      disposition = "tool";
    } else if (area === "config") {
      disposition = "config";
    } else {
      disposition = "example"; // examples | docs
    }
    rows.push({
      file: rel,
      package: packageOf(rel, workspaces),
      area,
      disposition,
      loc: countLoc(rootDir, rel),
    });
  }
  rows.sort((a, b) => a.file.localeCompare(b.file));

  const byDisposition: Record<string, number> = {
    reachable: 0,
    "build-entry": 0,
    "test-only": 0,
    orphan: 0,
    test: 0,
    tool: 0,
    config: 0,
    example: 0,
  };
  const byArea: Record<string, number> = {};
  const byPackage: Record<string, number> = {};
  for (const r of rows) {
    byDisposition[r.disposition] = (byDisposition[r.disposition] ?? 0) + 1;
    byArea[r.area] = (byArea[r.area] ?? 0) + 1;
    byPackage[r.package] = (byPackage[r.package] ?? 0) + 1;
  }

  return {
    generated: new Date().toISOString().split("T")[0],
    totalFiles: rows.length,
    byDisposition,
    byArea,
    byPackage,
    files: rows,
  };
}

const FILE_DISPOSITION_LEGEND: Array<[FileDisposition, string]> = [
  ["reachable", "A `src/` file in the module graph, reachable from a root."],
  [
    "build-entry",
    "A detected build/subpath/`bin`/worker/`tsup.config` root (index, internal, cli, render-file, run-worker, …).",
  ],
  [
    "test-only",
    "A `src/` file not reachable from src roots but imported by a test.",
  ],
  [
    "orphan",
    "A `src/` file reachable from nothing — a delete/wire candidate (hard-fails the gate).",
  ],
  [
    "test",
    "A test source file (under a `tests/` dir, or a `*.test.ts`/`*.spec.ts`).",
  ],
  [
    "tool",
    "A file under `tools/` — agent-only meta-tooling (CDG/QDG/benchmarks).",
  ],
  [
    "config",
    "A build/test config source (`*.config.ts`: vitest/tsup, per-package or root).",
  ],
  ["example", "An `examples/` or `docs/` reference/illustration source."],
];

function generateFileInventoryMarkdown(inv: FileInventory): string {
  const lines: string[] = [];
  lines.push("# Complete File Inventory");
  lines.push("");
  lines.push(
    `**Generated**: ${inv.generated} (by tools/create-dependency-graph)`,
  );
  lines.push("");
  lines.push(
    "Every tracked `.ts` file in the repo — package `src/` and `tests/`, the repo-root " +
      "cross-package `tests/`, `tools/`, build/test `*.config.ts`, `examples/`, and `docs/` " +
      "reference sources — tagged with a disposition. A completeness census: no `.ts` may be " +
      "silently missing. The self-check gate (`verifyFileCensus`) does a MAXIMAL, " +
      "location-agnostic repo walk (broader than this census’s enumerated discovery) and " +
      "HARD-FAILS `npm run docs:deps` if any `.ts` on disk is unaccounted, or if any `orphan` exists.",
  );
  lines.push("");
  lines.push(
    "**Excluded by design (not source):** `node_modules/`, `dist/`, `*.d.ts` ambient " +
      "declarations, and dot-directories (`.git/`, `.remember/`, `.changeset/`, …). The " +
      "walk set equals the git-tracked `.ts` files, so there is no silent allowlist — every " +
      "tracked `.ts` appears below with an explicit disposition.",
  );
  lines.push("");
  lines.push(`**Total files**: ${inv.totalFiles}`);
  lines.push("");
  lines.push("## Disposition counts");
  lines.push("");
  lines.push("| Disposition | Count | Meaning |");
  lines.push("| --- | --: | --- |");
  for (const [disp, meaning] of FILE_DISPOSITION_LEGEND) {
    lines.push(
      `| \`${disp}\` | ${inv.byDisposition[disp] ?? 0} | ${meaning} |`,
    );
  }
  lines.push(`| **Total** | **${inv.totalFiles}** | |`);
  lines.push("");
  lines.push("## Per-area counts");
  lines.push("");
  lines.push("| Area | Files |");
  lines.push("| --- | --: |");
  for (const area of Object.keys(inv.byArea).sort()) {
    lines.push(`| \`${area}\` | ${inv.byArea[area]} |`);
  }
  lines.push("");
  lines.push("## Per-package counts");
  lines.push("");
  lines.push("| Package | Files |");
  lines.push("| --- | --: |");
  for (const pkg of Object.keys(inv.byPackage).sort()) {
    lines.push(`| \`${pkg}\` | ${inv.byPackage[pkg]} |`);
  }
  lines.push("");
  lines.push("## All files");
  lines.push("");
  lines.push("| file | package | area | disposition |");
  lines.push("| --- | --- | --- | --- |");
  for (const r of inv.files) {
    lines.push(
      `| \`${r.file}\` | ${r.package} | ${r.area} | ${r.disposition} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Self-check gate. The ground truth is a MAXIMAL, location-agnostic repo walk
 * (`walkRepoTsFiles`) — strictly broader than the census's enumerated discovery,
 * so it CANNOT share the census's blind spot (the defect an earlier per-package
 * version shipped). Three independent failure conditions, each HARD-FAILS the run
 * (throws → non-zero exit):
 *
 *   1. **Unaccounted on disk** — a `.ts` the maximal walk finds that the census
 *      does not list (e.g. a file in a NEW top-level dir the census doesn't
 *      enumerate). This is the scoping-gap catcher.
 *   2. **Stale in census** — a census entry with no file on disk.
 *   3. **Orphans present** — any file the census tagged `orphan` (a `src/` file
 *      reachable from no root and no test) — almost always a build/worker/subpath
 *      root the tool failed to detect (the render-file/run-worker regression class),
 *      so a fresh orphan must stop the build. The inventory is written before the
 *      throw, so the offending row is visible in FILE_INVENTORY.md.
 */
function verifyFileCensus(rootDir: string, inventory: FileInventory): void {
  const onDisk = new Set(walkRepoTsFiles(rootDir));
  const census = new Set(inventory.files.map((f) => f.file));
  const missingFromCensus = [...onDisk].filter((f) => !census.has(f)).sort();
  const missingFromDisk = [...census].filter((f) => !onDisk.has(f)).sort();
  const orphans = inventory.files
    .filter((f) => f.disposition === "orphan")
    .map((f) => f.file)
    .sort();

  if (
    missingFromCensus.length > 0 ||
    missingFromDisk.length > 0 ||
    orphans.length > 0
  ) {
    let msg = "FILE CENSUS SELF-CHECK FAILED.\n";
    if (missingFromCensus.length > 0) {
      msg += `  ${missingFromCensus.length} file(s) on disk but ABSENT from the census (scoping/discovery gap — teach the census to enumerate this location):\n`;
      msg += missingFromCensus.map((f) => `    + ${f}`).join("\n") + "\n";
    }
    if (missingFromDisk.length > 0) {
      msg += `  ${missingFromDisk.length} file(s) in the census but MISSING on disk (stale entry — regenerate with \`npm run docs:deps\`):\n`;
      msg += missingFromDisk.map((f) => `    - ${f}`).join("\n") + "\n";
    }
    if (orphans.length > 0) {
      msg += `  ${orphans.length} ORPHAN file(s) — a src file reachable from no root and no test. Each is a\n`;
      msg += `  build/worker/subpath root the tool did not detect (wire it / seed it — see\n`;
      msg += `  tools/create-dependency-graph tsup.config / exports / bin root handling), or dead\n`;
      msg += `  code to delete:\n`;
      msg += orphans.map((f) => `    ! ${f}`).join("\n") + "\n";
    }
    throw new Error(msg);
  }
  console.log(
    `File census self-check passed: ${inventory.totalFiles} files == maximal repo walk (independent), 0 orphans.`,
  );
}

/**
 * `--check-census` (no-regen) entry: verify the ALREADY-GENERATED
 * `file-inventory.json` against a fresh maximal repo walk WITHOUT re-running the
 * graph scan (the standing gate, analogous to `check:duplicates:fast`). Throws
 * (→ non-zero exit) if the committed census is stale vs the disk — this is what
 * catches a `.ts` added anywhere in the repo after the last `docs:deps`.
 */
function runCensusCheckNoRegen(rootDir: string): void {
  const invPath = join(rootDir, "docs", "Architecture", "file-inventory.json");
  if (!existsSync(invPath)) {
    throw new Error(
      `file-census check: ${invPath} not found — run \`npm run docs:deps\` first to generate it.`,
    );
  }
  const inventory = JSON.parse(readFileSync(invPath, "utf-8")) as FileInventory;
  verifyFileCensus(rootDir, inventory);
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const cliOptions = parseCliOptions();

  // Standing no-regen census gate: verify the committed file-inventory.json against
  // a fresh MAXIMAL repo walk without re-running the (expensive) graph scan. Catches
  // a `.ts` added anywhere in the repo since the last `docs:deps`. Throws → exit 1.
  if (cliOptions.checkCensus) {
    runCensusCheckNoRegen(ROOT_DIR);
    console.log(
      "file-census check passed (no-regen): committed inventory matches the repo.",
    );
    return;
  }

  console.log("Scanning codebase for dependencies...");
  if (cliOptions.includeTests) {
    console.log("Test file analysis enabled");
  }

  // Detect workspace packages
  workspaceMap = detectWorkspaces(ROOT_DIR);
  const isMonorepo = workspaceMap.size > 0;

  if (isMonorepo) {
    console.log(`Monorepo detected: ${workspaceMap.size} workspace packages`);
    for (const [name, ws] of workspaceMap) {
      console.log(`  - ${name} (${ws.directory}/)`);
    }
    if (cliOptions.all) {
      console.log("Including dormant/unreachable files (--all)");
    }
  }

  // Ensure output directory exists
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`Created output directory: ${OUTPUT_DIR}`);
  }

  // Get all TypeScript files
  let tsFiles: string[];
  if (isMonorepo) {
    // Scan each workspace package's src/ directory
    tsFiles = [];
    for (const [, ws] of workspaceMap) {
      const srcDir = join(ROOT_DIR, ws.srcDir);
      const pkgFiles = getAllTsFiles(srcDir);
      tsFiles.push(...pkgFiles);
      console.log(`  ${ws.directory}/src: ${pkgFiles.length} files`);
    }
  } else {
    tsFiles = getAllTsFiles(SRC_DIR);
  }
  console.log(`Found ${tsFiles.length} TypeScript files total`);

  if (tsFiles.length === 0) {
    console.error("No TypeScript files found");
    process.exit(1);
  }

  // Parse all files
  const parsedFiles = tsFiles.map(parseFile);
  console.log("Parsed all files");

  // Reachability analysis (monorepo only)
  let reachableSet: Set<string> | undefined;
  let dormantSet: Set<string> | undefined;
  let activeParsedFiles = parsedFiles;
  // Seeded roots (index/subpath/bin/config/tsup/worker entries) — captured for the
  // file census's `build-entry` disposition.
  let censusRoots = new Set<string>();

  if (isMonorepo) {
    // Find entry points: each package's src/index.ts PLUS its `exports` subpath and
    // `bin` entry files (e.g. core/src/internal.ts, workbook/src/cli.ts) — build
    // roots that nothing imports but that are just as alive as the index.
    const entryPoints: string[] = [];
    for (const [, ws] of workspaceMap) {
      const candidates = [
        `${ws.srcDir}/index.ts`.replace(/\\/g, "/"),
        ...ws.extraEntries,
      ];
      for (const entryPath of candidates) {
        const found = parsedFiles.find((f) => f.path === entryPath);
        // Dedupe: a config-driven `tsup.config.ts` entry list re-lists index.ts
        // (already the package root) / cli.ts (already a `bin` root), so the same
        // path can arrive twice — count it once.
        if (found && !entryPoints.includes(found.path)) {
          entryPoints.push(found.path);
        }
      }
    }

    // Config-referenced source files are roots too. Build/test config at the repo
    // root (vitest/vite/tsup/rollup/webpack) can pull a source file into a bundle
    // via a path reference the module graph never shows — most commonly a bundler
    // ALIAS target (e.g. `vitest.config.browser.ts` aliasing `workerpool` to a
    // browser shim through `new URL('./…/src/shim.ts', import.meta.url)`). Seed
    // any `src/*.ts` path mentioned by a root-level config file.
    for (const cfgEntry of configReferencedEntries(ROOT_DIR)) {
      if (
        parsedFiles.some((f) => f.path === cfgEntry) &&
        !entryPoints.includes(cfgEntry)
      ) {
        entryPoints.push(cfgEntry);
      }
    }

    console.log(`Entry points: ${entryPoints.length}`);
    censusRoots = new Set(entryPoints);
    reachableSet = findReachableFiles(entryPoints, parsedFiles);
    dormantSet = new Set(
      parsedFiles.filter((f) => !reachableSet!.has(f.path)).map((f) => f.path),
    );
    console.log(`Reachable files: ${reachableSet.size}`);
    console.log(`Dormant files: ${dormantSet.size}`);

    if (!cliOptions.all) {
      activeParsedFiles = parsedFiles.filter((f) => reachableSet!.has(f.path));
      console.log(
        `Analyzing ${activeParsedFiles.length} reachable files (use --all to include dormant)`,
      );
    } else {
      activeParsedFiles = parsedFiles;
      console.log(
        `Analyzing all ${activeParsedFiles.length} files (including dormant)`,
      );
    }
  }

  // Categorize into modules
  const modules = categorizeFiles(activeParsedFiles, isMonorepo);
  console.log(`Categorized into ${Object.keys(modules).length} modules`);

  // Detect circular dependencies
  const circularDeps = detectCircularDependencies(activeParsedFiles);
  console.log(
    `Found ${circularDeps.all.length} circular dependencies (${circularDeps.runtime.length} runtime, ${circularDeps.typeOnly.length} type-only)`,
  );

  // Parse test files up-front UNCONDITIONALLY so the unused-analysis always sees
  // test-only consumers (a test importing `initWasm` or `resetPolyWasm` is a
  // legitimate consumer). This used to be gated on --include-tests — but docs:deps
  // runs without that flag, so every test-only-consumed export was false-flagged.
  // The flag now gates only the test-coverage REPORT generation below.
  const testFilePaths: string[] = [];
  if (isMonorepo) {
    for (const [, ws] of workspaceMap) {
      const testDir = join(ROOT_DIR, ws.directory, "tests");
      const srcDir = join(ROOT_DIR, ws.srcDir);
      testFilePaths.push(...getAllTestFiles(testDir));
      testFilePaths.push(...getAllTestFiles(srcDir));
    }
    const rootTestDir = join(ROOT_DIR, "tests");
    testFilePaths.push(...getAllTestFiles(rootTestDir));
  } else {
    const testDir = join(ROOT_DIR, "tests");
    testFilePaths.push(
      ...getAllTestFiles(testDir),
      ...getAllTestFiles(SRC_DIR),
    );
  }
  const parsedTestFiles: ParsedFile[] = testFilePaths.map(parseFile);

  // Detect unused files and exports
  const unusedAnalysis = detectUnused(activeParsedFiles, parsedTestFiles);

  // Generate statistics
  const stats = generateStatistics(
    activeParsedFiles,
    modules,
    circularDeps,
    unusedAnalysis,
  );
  console.log("Generated statistics");

  // Build dependency matrix
  const matrix = buildDependencyMatrix(activeParsedFiles);
  console.log("Built dependency matrix");

  // Generate outputs
  const json = generateJSON(activeParsedFiles, modules, stats, circularDeps);
  let markdown = generateMarkdown(
    activeParsedFiles,
    modules,
    stats,
    circularDeps,
    matrix,
  );

  // Insert package-level section for monorepo mode
  if (isMonorepo) {
    const pkgSection = generatePackageDependencySection(
      parsedFiles,
      workspaceMap,
      reachableSet,
      dormantSet,
    );
    // Insert after the Overview section
    const overviewMarker = "## Overview";
    const overviewIdx = markdown.indexOf(overviewMarker);
    if (overviewIdx !== -1) {
      // Find the '---' separator after Overview
      const sepIdx = markdown.indexOf(
        "\n---\n",
        overviewIdx + overviewMarker.length,
      );
      if (sepIdx !== -1) {
        const insertPoint = sepIdx + 5; // after '\n---\n'
        markdown =
          markdown.slice(0, insertPoint) +
          "\n" +
          pkgSection +
          markdown.slice(insertPoint);
      }
    }
  }

  // Write outputs
  writeFileSync(
    join(OUTPUT_DIR, "dependency-graph.json"),
    JSON.stringify(json, null, 2),
  );
  console.log("Written: docs/Architecture/dependency-graph.json");

  // Write YAML output (more compact, ~40% smaller than JSON)
  const yamlOutput = yaml.dump(json, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false,
  });
  writeFileSync(join(OUTPUT_DIR, "dependency-graph.yaml"), yamlOutput);
  console.log("Written: docs/Architecture/dependency-graph.yaml");

  writeFileSync(join(OUTPUT_DIR, "DEPENDENCY_GRAPH.md"), markdown);
  console.log("Written: docs/Architecture/DEPENDENCY_GRAPH.md");

  // Write compact summary for LLM consumption (CTON-style, ~10KB)
  const compactSummary = generateCompactSummary(
    activeParsedFiles,
    modules,
    stats,
    circularDeps,
  );
  writeFileSync(
    join(OUTPUT_DIR, "dependency-summary.compact.json"),
    compactSummary,
  );
  const compactSize = Buffer.byteLength(compactSummary, "utf8");
  console.log(
    `Written: docs/Architecture/dependency-summary.compact.json (${(compactSize / 1024).toFixed(1)}KB)`,
  );

  // Per-package public export surface — the union of names reachable from each
  // package's public entrypoints (`src/index.ts`, explicit `exports` subpaths,
  // `bin` targets, and config-referenced bundle entries). This is the
  // independent static-source ground truth that
  // `generate-functions-reference.mjs --check` reconciles the runtime `dist`
  // surface against (a shipped name with no source origin here is real drift).
  // Internal helper exports that are reachable only by relative imports inside a
  // package must not appear here.
  const pkgOf = (moduleKey: string): string =>
    moduleKey.startsWith("packages/")
      ? moduleKey.split("/").slice(0, 2).join("/")
      : moduleKey.split("/")[0];
  const surfaceSets: Record<string, Set<string>> = {};
  for (const [mkey, filesObj] of Object.entries(modules)) {
    const pkg = pkgOf(mkey);
    surfaceSets[pkg] ??= new Set<string>();
    const files = Object.values(filesObj);
    const publicSurface = computePublicSurface(files);
    for (const f of files) {
      for (const n of f.exports.named) {
        if (
          publicSurface.publicWildcardFiles.has(f.path) ||
          publicSurface.publicNamed.has(`${f.path}::${n}`)
        ) {
          surfaceSets[pkg].add(n);
        }
      }
    }
  }
  const surfaces: Record<string, string[]> = {};
  for (const pkg of Object.keys(surfaceSets).sort())
    surfaces[pkg] = [...surfaceSets[pkg]].sort((a, b) => a.localeCompare(b));
  writeFileSync(
    join(OUTPUT_DIR, "package-export-surfaces.json"),
    JSON.stringify(
      { generated: new Date().toISOString().split("T")[0], surfaces },
      null,
      2,
    ),
  );
  console.log("Written: docs/Architecture/package-export-surfaces.json");

  // Duplicate-symbol detection — the measurement that scopes the "multiple
  // implementations of one name across packages" dedup campaign (three `fft`s;
  // `fftshift`/`ifftshift` defined independently in fft.ts and fft-helpers.ts).
  // Own-definition dedup; re-export forwards excluded. Public/internal is
  // resolved per FILE via the same public-surface walk `detectUnused` uses (NOT
  // the flat package-export-surfaces.json above, which can't disambiguate two
  // same-package same-name definitions). See detectDuplicateSymbols doc comment
  // above for the full model.
  const dup = detectDuplicateSymbols(
    activeParsedFiles,
    computePublicSurface(activeParsedFiles),
  );
  const runtimeByTag = tallyByTag(dup.runtime);
  const typeByTag = tallyByTag(dup.types);
  const duplicateReport: DuplicateSymbolsReport = {
    generated: new Date().toISOString().split("T")[0],
    note: DUPLICATE_SYMBOLS_NOTE,
    summary: {
      runtimeDuplicates: runtimeByTag.TRUE_DUPLICATE,
      typeDuplicates: typeByTag.TRUE_DUPLICATE,
      runtimeByTag,
      typeByTag,
    },
    runtime: dup.runtime,
    types: dup.types,
  };
  writeFileSync(
    join(OUTPUT_DIR, "duplicate-symbols.json"),
    JSON.stringify(duplicateReport, null, 2),
  );
  writeFileSync(
    join(OUTPUT_DIR, "duplicate-symbols.md"),
    generateDuplicateSymbolsMarkdown(duplicateReport),
  );
  console.log(
    `Written: docs/Architecture/duplicate-symbols.md ` +
      `(${duplicateReport.summary.runtimeDuplicates} runtime TRUE_DUPLICATE / ` +
      `${dup.runtime.length} runtime flagged, ` +
      `${duplicateReport.summary.typeDuplicates} type TRUE_DUPLICATE / ` +
      `${dup.types.length} type flagged)`,
  );

  // Test coverage analysis (when --include-tests is specified)
  let testCoverage: TestCoverageAnalysis | null = null;
  if (cliOptions.includeTests) {
    console.log("\nAnalyzing test coverage...");
    // Test files were parsed up-front so the unused-analysis could
    // also see them; reuse those parses here.
    console.log(`Found ${testFilePaths.length} test files`);

    // Analyze test coverage
    testCoverage = analyzeTestCoverage(activeParsedFiles, parsedTestFiles);

    // Generate test coverage outputs
    const testCoverageMarkdown = generateTestCoverageMarkdown(testCoverage);
    const testCoverageJson = generateTestCoverageJson(testCoverage);

    // Write test coverage outputs
    writeFileSync(join(OUTPUT_DIR, "TEST_COVERAGE.md"), testCoverageMarkdown);
    console.log("Written: docs/Architecture/TEST_COVERAGE.md");

    writeFileSync(
      join(OUTPUT_DIR, "test-coverage.json"),
      JSON.stringify(testCoverageJson, null, 2),
    );
    console.log("Written: docs/Architecture/test-coverage.json");
  }

  console.log("\nDependency graph generation complete!");
  if (isMonorepo) {
    console.log(`  - ${workspaceMap.size} workspace packages scanned`);
    if (reachableSet) {
      console.log(
        `  - ${reachableSet.size} reachable files, ${dormantSet?.size || 0} dormant files`,
      );
    }
  }
  console.log(`  - ${stats.totalTypeScriptFiles} files analyzed`);
  console.log(
    `  - ${stats.totalExports} exports found (${stats.totalReExports} re-exports)`,
  );
  console.log(`  - ${stats.totalTypeOnlyImports} type-only imports detected`);
  console.log(`  - ${circularDeps.all.length} circular dependencies:`);
  console.log(
    `      ${circularDeps.runtime.length} runtime (require attention)`,
  );
  console.log(`      ${circularDeps.typeOnly.length} type-only (safe)`);
  console.log(
    `  - ${unusedAnalysis.unusedFiles.length} potentially unused files`,
  );
  console.log(
    `  - ${unusedAnalysis.unusedExports.length} potentially unused exports`,
  );

  // Print unused files if any
  if (unusedAnalysis.unusedFiles.length > 0) {
    console.log("\nPotentially unused files:");
    for (const file of unusedAnalysis.unusedFiles.slice(0, 20)) {
      console.log(`  - ${file}`);
    }
    if (unusedAnalysis.unusedFiles.length > 20) {
      console.log(`  ... and ${unusedAnalysis.unusedFiles.length - 20} more`);
    }
  }

  // Print unused exports if any (grouped by file)
  if (unusedAnalysis.unusedExports.length > 0) {
    console.log("\nPotentially unused exports:");
    const byFile = new Map<string, UnusedExport[]>();
    for (const exp of unusedAnalysis.unusedExports) {
      if (!byFile.has(exp.file)) byFile.set(exp.file, []);
      byFile.get(exp.file)!.push(exp);
    }
    let shown = 0;
    for (const [file, exports] of byFile) {
      if (shown >= 10) {
        console.log(
          `  ... and ${byFile.size - 10} more files with unused exports`,
        );
        break;
      }
      console.log(`  ${file}:`);
      for (const exp of exports.slice(0, 5)) {
        console.log(`    - ${exp.name} (${exp.type})`);
      }
      if (exports.length > 5) {
        console.log(`    ... and ${exports.length - 5} more`);
      }
      shown++;
    }
  }

  // Write full unused analysis to a separate file
  const unusedReportPath = join(OUTPUT_DIR, "unused-analysis.md");
  let unusedReport = "# Unused Files and Exports Analysis\n\n";
  unusedReport += `**Generated**: ${new Date().toISOString().split("T")[0]}\n\n`;
  const deadExports = unusedAnalysis.unusedExports.filter(
    (e) => e.inFileRefs === 0,
  );
  const contractExports = unusedAnalysis.unusedExports.filter(
    (e) => e.inFileRefs > 0,
  );
  // Dormant files: on disk under a package `src/`, runtime code (not `.d.ts`
  // ambient declarations), NOT reachable from any seeded root (index, `exports`
  // subpaths, `bin`, or build-script entries). The file-granularity analog of
  // the unused-export list. Split into:
  //   - test-only: reachable from a test file (exercised but ships nothing —
  //     e.g. functions/src/signal/fft.ts, kept for its direct test)
  //   - orphaned: reachable from nothing at all — the true delete/wire candidates.
  const testReachable = dormantSet
    ? findReachableFiles(
        parsedTestFiles.map((f) => f.path),
        [...parsedFiles, ...parsedTestFiles],
      )
    : new Set<string>();
  const dormantAll = dormantSet
    ? [...dormantSet]
        .filter((f) => /(^|\/)src\//.test(f) && !f.endsWith(".d.ts"))
        .sort()
    : [];
  const orphaned = dormantAll.filter((f) => !testReachable.has(f));
  const testOnly = dormantAll.filter((f) => testReachable.has(f));

  const groupByPkg = (files: string[]): Map<string, string[]> => {
    const m = new Map<string, string[]>();
    for (const f of files) {
      let pkg = "(root)";
      for (const [, ws] of workspaceMap) {
        if (f.startsWith(ws.directory + "/")) {
          pkg = ws.directory;
          break;
        }
      }
      if (!m.has(pkg)) m.set(pkg, []);
      m.get(pkg)!.push(f);
    }
    return m;
  };

  unusedReport += `## Summary\n\n`;
  unusedReport += `- **Potentially unused files**: ${unusedAnalysis.unusedFiles.length}\n`;
  unusedReport += `- **Dormant files** (runtime code on disk, unreachable from any entry/build root): ${dormantAll.length}\n`;
  unusedReport += `  - **Orphaned (reachable from nothing — delete/wire candidates)**: ${orphaned.length}\n`;
  unusedReport += `  - **Test-only (exercised by a test, ships nothing)**: ${testOnly.length}\n`;
  unusedReport += `- **Potentially unused exports**: ${unusedAnalysis.unusedExports.length}\n`;
  unusedReport += `  - **Unreferenced anywhere (deletion candidates)**: ${deadExports.length}\n`;
  unusedReport += `  - **Referenced in-module (type contracts / helpers backing live exports)**: ${contractExports.length}\n\n`;

  const renderDormant = (files: string[]): string => {
    if (files.length === 0) return `_None._\n\n`;
    let out = "";
    for (const [pkg, fs] of [...groupByPkg(files)].sort()) {
      out += `### \`${pkg}\` (${fs.length})\n\n`;
      for (const f of fs) out += `- \`${f}\`\n`;
      out += "\n";
    }
    return out;
  };

  unusedReport += `## Dormant Files — Orphaned (delete/wire candidates)\n\n`;
  unusedReport += `Runtime source files reachable from NO root and NO test. Each is either dead code\n`;
  unusedReport += `to delete, or a root the tool cannot see (a new build/worker entry, a\n`;
  unusedReport += `\`new URL()\`-loaded script, or a side-effect-only module) — in which case wire it\n`;
  unusedReport += `or seed it. Verify before deleting.\n\n`;
  unusedReport += renderDormant(orphaned);

  unusedReport += `## Dormant Files — Test-only (ships nothing, but exercised)\n\n`;
  unusedReport += `Not reachable from any package entry point, but imported by a test — deliberately\n`;
  unusedReport += `kept, standalone-tested code (e.g. legacy signal kernels) or a helper a test drives\n`;
  unusedReport += `directly. Not dead; not shipped. No action needed.\n\n`;
  unusedReport += renderDormant(testOnly);

  unusedReport += `## Potentially Unused Files\n\n`;
  unusedReport += `These files are not imported by any other file in the codebase:\n\n`;
  for (const file of unusedAnalysis.unusedFiles) {
    unusedReport += `- \`${file}\`\n`;
  }

  const renderByFile = (
    exports: UnusedExport[],
    note?: (e: UnusedExport) => string,
  ): string => {
    let out = "";
    const byFile = new Map<string, UnusedExport[]>();
    for (const exp of exports) {
      if (!byFile.has(exp.file)) byFile.set(exp.file, []);
      byFile.get(exp.file)!.push(exp);
    }
    for (const [file, exps] of byFile) {
      out += `### \`${file}\`\n\n`;
      for (const exp of exps) {
        out += `- \`${exp.name}\` (${exp.type})${note ? note(exp) : ""}\n`;
      }
      out += "\n";
    }
    return out;
  };

  unusedReport += `\n## Unreferenced Anywhere (deletion candidates)\n\n`;
  unusedReport += `Not imported by any other file AND not referenced within their own module — `;
  unusedReport += `the true dead-code candidates. Verify each isn't consumed by a mechanism the\n`;
  unusedReport += `parser can't see (dynamic access, docs examples, published-API contract) before deleting.\n\n`;
  unusedReport += renderByFile(deadExports);

  unusedReport += `\n## Referenced In-Module (type contracts / helpers backing live exports)\n\n`;
  unusedReport += `Not imported cross-file, but referenced within their own module — they type or\n`;
  unusedReport += `support exports that ARE used, so they cannot be deleted in isolation. Mostly\n`;
  unusedReport += `interfaces typing live guards and per-package API completeness, not rot.\n\n`;
  unusedReport += renderByFile(
    contractExports,
    (e) => ` — ${e.inFileRefs} in-file ref${e.inFileRefs === 1 ? "" : "s"}`,
  );

  writeFileSync(unusedReportPath, unusedReport);
  console.log(`\nWritten: ${unusedReportPath}`);

  // Complete file census (every tracked .ts in the repo — package src/tests, plus
  // repo-root tests/tools/config/examples/docs) with a disposition, plus a MAXIMAL
  // independent repo-walk self-check that HARD-FAILS this run if anything on disk is
  // unaccounted or any orphan exists. Monorepo only (needs the workspace/reachability
  // model).
  if (isMonorepo && reachableSet) {
    const inventory = buildFileInventory(
      ROOT_DIR,
      workspaceMap,
      censusRoots,
      reachableSet,
      testReachable,
    );
    writeFileSync(
      join(OUTPUT_DIR, "file-inventory.json"),
      JSON.stringify(inventory, null, 2),
    );
    writeFileSync(
      join(OUTPUT_DIR, "FILE_INVENTORY.md"),
      generateFileInventoryMarkdown(inventory),
    );
    console.log(
      `Written: docs/Architecture/FILE_INVENTORY.md (${inventory.totalFiles} files: ` +
        Object.entries(inventory.byDisposition)
          .map(([k, v]) => `${v} ${k}`)
          .join(", ") +
        ")",
    );
    // Fail loudly if the census and the maximal repo walk disagree (throws → non-zero exit).
    verifyFileCensus(ROOT_DIR, inventory);
  }

  // WASM accelerator <-> function pairing (generated artifact; replaces the
  // formerly hand-maintained docs/Architecture/WASM_ACCELERATION.md map).
  const wasmPairing = analyzeWasmPairing(ROOT_DIR);
  if (wasmPairing) {
    writeFileSync(
      join(OUTPUT_DIR, "wasm-pairing.json"),
      JSON.stringify(wasmPairing, null, 2),
    );
    writeFileSync(
      join(OUTPUT_DIR, "wasm-pairing.md"),
      generateWasmPairingMarkdown(wasmPairing),
    );
    console.log(
      `Written: ${join(OUTPUT_DIR, "wasm-pairing.md")} ` +
        `(${wasmPairing.acceleratedCount}/${wasmPairing.total} WASM-accelerated)`,
    );
  }

  // Parallel (worker-pool) <-> function pairing (generated artifact; the parallel
  // analog of wasm-pairing — pairs each typed function against the canonical
  // DEFAULT_THRESHOLD_BY_OP thresholds parsed from parallel/src/ComputePool.ts).
  const parallelPairing = analyzeParallelPairing(ROOT_DIR);
  if (parallelPairing) {
    writeFileSync(
      join(OUTPUT_DIR, "parallel-pairing.json"),
      JSON.stringify(parallelPairing, null, 2),
    );
    writeFileSync(
      join(OUTPUT_DIR, "parallel-pairing.md"),
      generateParallelPairingMarkdown(parallelPairing),
    );
    console.log(
      `Written: ${join(OUTPUT_DIR, "parallel-pairing.md")} ` +
        `(${parallelPairing.effectiveCount}/${parallelPairing.parallelizedCount} effectively parallelized, ` +
        `${parallelPairing.disabledCount} disabled)`,
    );
  }

  // WebGPU (browser, flag-gated) <-> function pairing — the GPU analog of
  // wasm-pairing. Forward-looking tracker: 0 until functions route to a
  // *GpuDispatch bridge / GPU pool/backend (see ROADMAP "WebGPU acceleration tier").
  const webgpuPairing = analyzeWebGPUPairing(ROOT_DIR);
  if (webgpuPairing) {
    writeFileSync(
      join(OUTPUT_DIR, "webgpu-pairing.json"),
      JSON.stringify(webgpuPairing, null, 2),
    );
    writeFileSync(
      join(OUTPUT_DIR, "webgpu-pairing.md"),
      generateWebGPUPairingMarkdown(webgpuPairing),
    );
    console.log(
      `Written: ${join(OUTPUT_DIR, "webgpu-pairing.md")} ` +
        `(${webgpuPairing.standaloneAcceleratedCount} standalone + ${webgpuPairing.gpuAcceleratedCount}/${webgpuPairing.total} typed WebGPU-accelerated)`,
    );
  }

  // Print test coverage summary if enabled
  if (testCoverage) {
    const coveragePercent =
      testCoverage.sourceFiles.length > 0
        ? (
            (testCoverage.testedFiles.length /
              testCoverage.sourceFiles.length) *
            100
          ).toFixed(1)
        : "0";

    console.log("\n=== Test Coverage Analysis ===");
    console.log(`  - ${testCoverage.testFiles.length} test files analyzed`);
    console.log(
      `  - ${testCoverage.testedFiles.length}/${testCoverage.sourceFiles.length} source files have tests (${coveragePercent}%)`,
    );
    console.log(
      `  - ${testCoverage.untestedFiles.length} source files without tests`,
    );

    if (testCoverage.untestedFiles.length > 0) {
      console.log("\nSource files without test coverage:");
      for (const file of testCoverage.untestedFiles.slice(0, 15)) {
        console.log(`  - ${file}`);
      }
      if (testCoverage.untestedFiles.length > 15) {
        console.log(
          `  ... and ${testCoverage.untestedFiles.length - 15} more (see TEST_COVERAGE.md for full list)`,
        );
      }
    }
  }
}

// Only run the generator when executed directly (e.g. `npx tsx … .ts` or the
// compiled `dist/…js`). When imported by another module this guard keeps the
// heavy codebase scan from running.
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
