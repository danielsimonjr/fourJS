# RFC 0006: TypeScript-on-Bun toolchain

- **Status:** accepted
- **Date:** 2026-09-05
- **Owner decision:** accepted 2026-09-05 (migration requested)
- **Spec sections affected:** §91 (Coding Standards and Toolchain), §103 (Phase 0 deliverables list)

## Context

The repository's recommended toolchain (§91) names a **pnpm workspace**, optional
Turborepo/Nx orchestration, and Vitest. The working tree already dropped Turborepo
(2026-08-03) in favour of `pnpm -r`. Bun ships a single TypeScript-native runtime,
package manager, and script runner that can replace pnpm + Node for day-to-day
install/build/test orchestration while keeping the same ESM + strict TypeScript
package surface.

This change is architecturally significant under §95: it rewrites the monorepo's
install/CI contract and the Phase 0 deliverable list (§103), and it amends the
§91 recommended baseline. It does **not** change the public `@fourjs/*` API, scene
format, solver adapters, or plugin surface.

## Proposed decision

1. **Bun is the workspace package manager and script runner.** Contributors and
   CI use `bun install --frozen-lockfile` and `bun run <script>`. The lockfile is
   the text `bun.lock` (committed). `pnpm-workspace.yaml` and `pnpm-lock.yaml`
   are removed; root `package.json` carries a `"workspaces": ["packages/*"]`
   field (same membership as before).
2. **TypeScript remains the source language; `tsc -b` remains the package
   compiler.** Bun's native TypeScript loader may run tools and tests, but
   published `dist/*.js` + `dist/*.d.ts` continue to come from the composite
   project references already in each package. No switch to `bun build` for
   library emit in this RFC.
3. **Vitest remains the unit/suite test runner for this landing.** ~3,000
   colocated tests and the cross-package suites keep their `vitest` imports and
   configs. A follow-up may migrate suites to `bun:test` once API parity for
   mocks/timers/coverage is proven against the ≥95% gate; that migration is
   **out of scope** here.
4. **Playwright, ESLint, Prettier, TypeDoc, Vite, Changesets, and size-limit
   stay.** They are invoked through Bun's script runner (`bun run` / `bunx`)
   rather than `pnpm` / `npx`.
5. **§91 baseline wording** becomes: Bun workspace (replacing "pnpm workspace");
   drop "Turborepo or Nx" (orchestration is Bun `--filter` / `--workspaces`);
   keep Vitest (with an optional note that `bun:test` is a staged alternative).
6. **§103 Phase 0 deliverables** list `bun.lock` (and `bunfig.toml` when present)
   instead of `pnpm-workspace.yaml`.

## Alternatives

| Alternative | Why it loses |
|---|---|
| Keep pnpm; add Bun only as an optional runtime | Leaves two install contracts and does not deliver the requested migration. |
| Migrate tests to `bun:test` in the same change | Couples a lockfile/CI cutover to rewriting every `vitest` import and re-proving coverage; high blast radius. |
| Emit packages with `bun build` instead of `tsc -b` | Would change declaration emit, composite references, and TypeDoc input in one step; deferred. |
| Dual lockfiles (pnpm + Bun) | Guarantees drift; rejected. |

## Consequences

**Easier:** one binary for install + script running + native TS tool execution;
faster cold installs; CI setup shrinks to `oven-sh/setup-bun`.

**Harder / committed:** contributors need Bun ≥ 1.2; docs and agent orientation
must stop saying `pnpm`; Architecture prose regenerated from live commands will
name `bun run …`; any remaining `node tools/*.mjs` invocations are fine (Bun
and Node both run them) but root scripts prefer `bun`.

**Not changed:** package dependency matrix (§3.1), `.js` import suffixes,
Vitest coverage thresholds, Playwright browser gate, publish-name mapping.

## Compatibility analysis

No §90 compatibility table rows move. No solver `capabilities` change; do not
regenerate `docs/COMPATIBILITY.md` for this RFC. Published package names and
exports are untouched.

## Prototype / benchmark

Landing criterion: `bun install --frozen-lockfile`, `bun run build`,
`bun run test` (or a representative package subset), `bun run lint`, and
`bun run check-spec` succeed on the migration branch. Full CI job set in
`.github/workflows/ci.yml` must be green before merge.

## Post-acceptance corrections (2026-09-10 review pass)

Verified against the tree 2026-09-10 (accepted and applied 2026-09-05):

- **"Playwright, ESLint, Prettier, TypeDoc, Vite, Changesets, and size-limit
  stay".** ESLint and typescript-eslint were removed with the TypeScript 7
  move; linting is **Oxlint** (`"lint": "bunx oxlint --type-aware"`). Spec
  revision 1.14's row and §91 still say ESLint — an amendment-note item.
- **`"workspaces": ["packages/*"]` "(same membership as before)".** Now
  `["packages/*", "tools/docs"]` — TypeDoc is isolated in `tools/docs`.
- **"contributors need Bun ≥ 1.2".** `engines.bun` is `>=1.4.2`,
  `packageManager` `bun@1.4.2`, CI pins 1.4.2.
- **"docs and agent orientation must stop saying `pnpm`".** Unfulfilled in
  `benchmarks/README.md`, `benchmarks/harness.mjs`, `docs/COMPATIBILITY.md`
  (§1 still claims `packageManager` pins `pnpm@10.33.0`),
  `docs/Architecture/TEST_COVERAGE.md`, and four example READMEs. Tracked in
  `TODO.md`.
- Consistent: `bun install --frozen-lockfile`, `bun.lock` + `bunfig.toml`,
  `tsc -b` retained, no `pnpm-workspace.yaml`/`pnpm-lock.yaml`, CI on
  `oven-sh/setup-bun@v2`.
