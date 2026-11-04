import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Shared coverage gate for the per-package unit suites.
//
// This config is never used by `bun run test`: the per-package `test` scripts
// keep running plain `vitest run --passWithNoTests`, so the normal path pays no
// instrumentation cost. The root `coverage` script runs each `packages/*`
// package against this file via `tools/run-in-packages.mjs` instead — every
// package sits at the same depth, so the relative path
// `../../vitest.coverage.config.ts` is uniform, and Vitest's project root stays
// the package directory the command was executed in.
//
// The `include` glob is therefore package-relative: `src/**/*.ts` is the
// package's own source. `coverage.all` (Vitest's default) keeps files that no
// test ever imports in the denominator, so a package cannot pass by shipping
// untested modules.
//
// Two gates, stacked (measured 2026-09-06 against all 24 packages; 25 since 2026-11-04, physics-physjs):
//
// 1. Package aggregate ≥ 95% lines / statements / functions / branches — the
//    existing CI threshold. Do not raise this; a strong file may still lift a
//    package average.
// 2. Per-file floor 80% lines / functions / statements. A 0% file can no longer
//    hide behind that average. Branches are omitted here: `math/src/alloc-counter.ts`
//    is 75% branches on the `Number.MAX_SAFE_INTEGER` wrap, and a four-branch
//    file's percentage is too volatile for a per-file branch gate. The package
//    95% still covers branches in aggregate.
//
// Why a reporter, not `thresholds.perFile: true`: Vitest applies that flag to
// the *same* numbers as the package gate, so enabling it would require every
// file ≥ 95% (or would force the package numbers down). The Istanbul reporter
// in `tools/per-file-coverage-floor.cjs` keeps the 80% per-file floor as a
// separate check. The split dates from the 3.2.7 pin; it is still the one
// this repo uses on Vitest 5.0.0.
//
// Weakest intentional file: `physics-rapier/src/init.ts` at 86.95% lines — the
// transcribed Rapier wasm typings / load cache (§37). 80% sits just below that
// with a few points of remapping headroom. No other measured file is below 95%
// lines or functions. Stubs (`physics-box2d`, `physics-soft`, `render-canvas`,
// `render-svg`) stay *included*: each is a one-line `PACKAGE_NAME` export with a
// smoke test at 100%. Type-only modules are empty (0 statements → skipped by
// the reporter, 100% in the table). There is no generated `src/`. Vitest's
// default exclude already drops `**/*.d.ts`.
export default defineConfig({
  test: {
    passWithNoTests: true,
    // Instrumented runs are far slower than plain ones, and the default 5 s
    // timeout does not account for it. Measured 2026-08-21 on the >65 536-vertex
    // index-widening test in packages/render:
    //
    //     plain           242 ms
    //     with coverage  3222 ms   (13x)
    //     on CI          5590 ms   -> exceeded the 5 s default, red build
    //
    // The test was not flaky and not slow: it was systematically near the limit
    // once instrumented, and the CI runner is slower than a workstation, so it
    // crossed there and passed here. Raising the timeout for THIS config only is
    // the fix -- the plain `test` scripts keep the 5 s default, so a genuine
    // performance regression on the normal path still fails fast. This is a
    // timeout, not a budget: a hung test still fails, it just takes longer.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Text plus the per-file floor reporter (writes nothing). Vitest's default
      // reporter set also writes `html`, `clover`, and `json` into
      // `packages/*/coverage/`; that directory is gitignored but NOT ignored by
      // `eslint.config.js`, so the generated `block-navigation.js` and friends
      // turn `bun run lint` red after any coverage run. This gate only needs the
      // terminal table, the package threshold check, and the per-file floor.
      reporter: [
        "text",
        [
          fileURLToPath(
            new URL("./tools/per-file-coverage-floor.cjs", import.meta.url),
          ),
          {
            lines: 80,
            functions: 80,
            statements: 80,
          },
        ],
      ],
      thresholds: {
        lines: 95,
        statements: 95,
        functions: 95,
        branches: 95,
      },
    },
  },
});
