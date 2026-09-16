# fourJS Implementation Plan — revision 2.1

Phase 0 deliverable per §103 of [`docs/SPECIFICATION.md`](../SPECIFICATION.md)
(current revision: see the spec's amendments table). **Revision 2.1 (2026-07-29)** adds the "Phase −1" smoke-test corrections
(split dev/build tsconfigs, pnpm build-script allowance, validated ESLint config, example
wiring — the full §3.2 pin set was installed and run together successfully), the spec-1.5
phases 3a and 11, the publish-name caveat, CI supply-chain audit, and the visual-test GPU
strategy. **Revision 2 (2026-07-29)** applied the findings of a five-way stress test
(Haiku dry-run of WP-0.1; executability, spec-fidelity, orchestration, and technical-design
adversarial reviews — ~85 findings): all versions and configs are now pinned, the build
template is `tsc -b`-correct, the dependency matrix is explicit, Phase 2 is in full packet
format, and the orchestration protocol covers git, retries, reviews, and governance.

**Execution model.** An orchestrator session dispatches small, self-contained **work
packets** to worker agents. **[H]** packets are fully pre-decided and mechanical — a
Haiku-class agent executes them by following steps (validated by dry run). **[S]** packets
need judgment and go to a stronger model. A packet is done only when its `Done` commands
pass. The §98 directory tree exists and is verified; packets fill directories, never create
packages.

---

## 1. Ground rules (include verbatim in every worker prompt)

1. **Conventions (§7a):** right-handed, **Y-up in both 2D and 3D** (2D gravity is negative
   Y). All angles **radians**. All times **seconds** — durations too; nothing takes
   milliseconds.
2. **Math (§7b, D7):** math types are mutable; instance methods mutate in place and return
   `this`. Result-producing methods take `out?`; when `out` is omitted they may allocate
   (authoring convenience), but engine-internal per-frame code always passes `out`. Only
   `clone()`/factories/omitted-`out` allocate.
3. **Components (§6a, D1/D2):** one component per type per node; `RigidBody`, colliders,
   `MotionComponent` are components (classes, not Node subclasses). Lifecycle
   `onAttach`/`onDetach`/`dispose`.
4. **Events (§6b):** `on` returns an unsubscriber; registration-order dispatch; physics
   events dispatch after the fixed step (§39 step 9), never during it.
5. **Determinism (§33):** no `Math.random`/`Date.now`/wall clock in simulation code —
   inject time, use seeded RNG. Iterate collections in insertion order only.
6. **Authority (§42):** exactly one system writes a node's transform; conflicts warn in dev
   builds.
7. **Toolchain (§91, §3.2):** strict TypeScript **5.9.x — never 7.x**, ESM only, named
   exports only, pnpm workspace, Turborepo, Vitest, Node ≥ 20. Use only the §3.2 pinned
   versions; never install or upgrade anything yourself.
8. **Imports:** relative imports inside packages end in **`.js`** (NodeNext resolution),
   e.g. `import { Vector3 } from "./vector3.js"` — even though the source file is `.ts`.
   Cross-package imports use the bare package name (`@fourjs/math`), never relative paths.
9. **Dependency direction:** exactly the §3.1 matrix — never add or reverse an edge.
10. **Frozen:** never edit `docs/SPECIFICATION.md`; never add packages (§98/E-3); § numbering
    1–120 is frozen.
11. **Scope:** touch only the files your packet's `Files` names. Never run `pnpm install`
    or modify `pnpm-lock.yaml` (the orchestrator owns installs). If the packet seems to
    require more, **stop and report** — do not improvise.
12. **Honesty:** report every decision the packet forced you to guess, and every step you
    could not complete. Do not commit; the orchestrator commits.

## 2. Packet format and orchestration protocol

```
WP-<phase>.<n> [H|S] <title>
Depends: <packet ids or ->
Reads:   <files/§ to read first>
Files:   <exact files to create or edit>
Steps:   <numbered, imperative>
Done:    <shell commands that must succeed>
```

**Dispatch.** One packet per worker: §1 verbatim + the packet verbatim. For **[S]** packets,
`Reads` MUST include the source files produced by every packet in `Depends` — signatures
come from real code, never guessed from spec prose.

**Parallelism.** Packets may run concurrently only if (a) no dependency edge connects them,
(b) their `Files` sets are disjoint, and (c) they sit in the same wave of the §3.1 matrix.
When parallel workers share a package or directory, use worktrees: one branch per packet,
merged **serially in Depends order by the orchestrator**; a merge conflict kicks the later
packet back as a retry.

**Installs and git.** Only the orchestrator runs `pnpm install` (once per wave, before Done
checks that need it). One commit per packet, by the orchestrator, `git add` restricted to
the packet's `Files` (plus the lockfile when the orchestrator refreshed it), message
`WP-<id>: <title>`. Push at least once per phase.

**Retries and escalation.** On a failed Done: reset the packet's `Files` to their
pre-attempt state, re-dispatch to the same worker **with the failure output appended**; max
two retries. On escalation the orchestrator first re-validates the Done check itself
against the `Reads` sources (a wrong check is a plan bug, not a worker bug), then
reassigns to a stronger model. Any packet the orchestrator revises is **edited in place in
this file with a dated note before redispatch** — the plan stays the single source of truth.

**Review.** Every **[S]** packet gets an independent second-agent review (diff against
`Reads` + §1 ground rules) before its Done is accepted. [H] packets are covered by their
mechanical checks plus phase-exit invariant tests.

**Phase exits.** Exit packets verify and **fix nothing**: they file a defect list naming
corrective packets `WP-<phase>.<n>-fix<k>`; the orchestrator dispatches fixes, then re-runs
the exit packet. A phase is closed by: exit green → orchestrator updates
`MEMORY.md`/`TODO.md`/`CHANGELOG.md` (workers never touch tracking files) and records every
[S] packet's decided API surface in MEMORY.md → push. Never start phase N+1 before phase N
closes.

**Governance (rolling wave).** Phases 3–10 packets are written by the orchestrator when
their predecessor phase closes — but any packet that fixes a **new cross-package API
surface not already pinned by the spec or §3.5** requires owner sign-off (RFC/ADR per §95
and AGENTS.md rule 5) before dispatch.

## 3. Pinned technical decisions

### 3.1 Package dependency matrix (frozen; WP-0.4 copies it verbatim)

Direct workspace dependencies only (transitives implied). Wave = parallel dispatch group.

| Wave | Package          | Direct deps                            |
| ---- | ---------------- | -------------------------------------- |
| 1    | `core`           | —                                      |
| 1    | `math`           | —                                      |
| 2    | `scene`          | core, math                             |
| 2    | `geometry`       | core, math                             |
| 2    | `materials`      | core, math                             |
| 2    | `assets`         | core                                   |
| 3    | `motion`         | core, math, scene                      |
| 3    | `input`          | core, math, scene                      |
| 3    | `serialization`  | core, math, scene                      |
| 3    | `diagnostics`    | core, math, scene                      |
| 3    | `particles`      | core, math, scene                      |
| 3    | `text`           | core, math, geometry                   |
| 3    | `render`         | core, math, scene, geometry, materials |
| 4    | `animation`      | core, math, scene, motion              |
| 4    | `physics`        | core, math, scene, motion              |
| 4    | `render-webgpu`  | core, math, render                     |
| 4    | `render-webgl`   | core, math, render                     |
| 4    | `render-canvas`  | core, math, render                     |
| 4    | `render-svg`     | core, math, render                     |
| 4    | `ui`             | core, math, scene, input, text         |
| 5    | `physics-rapier` | physics                                |
| 5    | `physics-box2d`  | physics                                |
| 5    | `physics-soft`   | physics                                |
| 6    | `four`           | all 23 above                           |

_Dated note (2026-08-01, orchestrator):_ `physics-rapier` additionally declares
`@fourjs/core` + `@fourjs/math` directly (WP-5.4-fix1) — the adapter imports both
(`FourError`, `Vector3`), and "transitives implied" should not hide a genuine direct
import. No new edge: both were already transitively present via `physics`.

### 3.2 Toolchain pins (verified against the registry 2026-07-29)

`typescript@5.9.3` (NOT 7.x — the native rewrite is a different toolchain),
`typescript-eslint@8.65.0`, `eslint@9.39.5`, `prettier@3.9.6`, `vitest@3.2.7`,
`turbo@2.10.7`, `@changesets/cli@2.31.1`, `size-limit@13.0.2`,
`@size-limit/preset-small-lib@13.0.2`, `vite@8.1.5`, `typedoc@0.28.20`, `yaml@2.9.0`.
Exact pins, no ranges. If an install or peer conflict arises, **the orchestrator** (never a
worker) adjusts a pin and updates this table with a dated note.
_(Added 2026-08-01 by the orchestrator: `@vitest/coverage-v8@3.2.7` — coverage measurement
joins the phase-exit gates from Phase 1 on, per the session goal of ≥95% coverage. Added 2026-08-01: `@playwright/test@1.57.0` for the WP-3.8 browser gate — the environment provides Chromium at PLAYWRIGHT_BROWSERS_PATH.)_
**Validated together 2026-07-29** by the Phase −1 smoke: install (no peer conflicts),
`tsc -b` reference chain, cross-package Vitest, type-checked ESLint, TypeDoc packages
mode, Vite 8 example build, and size-limit all passed as one workspace. pnpm 10 blocks
dependency build scripts by default — the root manifest allowlists `esbuild`
(`"pnpm": { "onlyBuiltDependencies": ["esbuild"] }`).
**Publish names (spec §98, rev 1.6 — decided):** umbrella `@danielsimonjr/fourjs`,
sub-packages `@danielsimonjr/fourjs-<name>`, published from the owner's personal npm
scope. Workspace names stay `four`/`@fourjs/*`; the mechanical publish mapping is part of
the release-workflow packet at first publish (§94, 0.1).

### 3.3 `tsconfig.base.json` (WP-0.2 pastes exactly this)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "composite": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "useDefineForClassFields": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

(`noUncheckedIndexedAccess` is deliberately off — indexed math hot paths; revisit pre-1.0.)

### 3.4 Per-package template (WP-0.4 copies; only names/deps vary)

`package.json` (name `@fourjs/<P>`; the umbrella is plain `four`):

```json
{
  "name": "@fourjs/P",
  "version": "0.0.0",
  "type": "module",
  "license": "MIT",
  "sideEffects": false,
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "files": ["dist"],
  "scripts": { "build": "tsc -b", "test": "vitest run --passWithNoTests" },
  "dependencies": { "<each §3.1 dep>": "workspace:*" }
}
```

Each package carries **two tsconfigs** (validated by the Phase −1 smoke — a single config
cannot serve both declaration-emitting builds and type-checked linting of tests):

- `tsconfig.json` (dev/lint/editor): `{ "extends": "../../tsconfig.base.json",
"compilerOptions": { "composite": false, "declaration": false,
"declarationMap": false, "noEmit": true }, "include": ["src", "tests"] }`
- `tsconfig.build.json` (emit): `{ "extends": "../../tsconfig.base.json",
"compilerOptions": { "rootDir": "src", "outDir": "dist" }, "include": ["src"],
"references": [<one per §3.1 dep, path "../<dep>/tsconfig.build.json">] }`

The build script is **`tsc -b tsconfig.build.json`** (build mode; plain `tsc -p` ignores
references and fails once real imports exist). Tests import `../src/index.js` (Vitest
resolves it to the `.ts` source). The `four` package additionally exposes one subpath
export per §3.1 package (`"./scene": { "types": "./dist/scene.d.ts", "import":
"./dist/scene.js" }`, …) per §98/§91.

### 3.5 Design decisions (D1–D8; pre-decided so no packet re-litigates them)

- **D1 Node inheritance:** `abstract class Node extends EventEmitter<NodeEventMap>` —
  single inheritance, **no TS mixins** (declaration-emit and generic-widening hazards).
  Components live in an internal `ComponentRegistry` field; Node delegates
  `addComponent/getComponent/removeComponent`.
- **D2 Component identity:** components are classes carrying
  `static readonly typeName: string`; `ComponentType<T> = { readonly typeName: string;
new (...args: never[]): T }`; registry keyed by `typeName` (also the §79 serialization
  name). `MotionComponent` is a class implementing the §11 fields.
- **D3 Transform dirty channel:** math mutating methods invoke an internal optional
  `changed` hook; `Transform` installs hooks on its own `position`/`rotation`/`scale`/
  `pivot` so `version` increments on method-based mutation (§7). Direct field writes
  (`v.x = 1`) are legal only if followed by `transform.markDirty()`.
- **D4 Loop ownership:** the `Application` composition root lives in the **`four`** package
  (§98 rev 1.4; §45). `@fourjs/motion`'s scheduler is an event-free `step(elapsedSeconds)`
  state machine; Application drives it (rAF or manual stepping for headless) and re-emits
  `fixedUpdate`/`update`/`render` (§6b/§10).
- **D5 System ordering:** the §39 `SimulationSystem` priority registry is built in Phase 1
  (WP-1.11); every later feature **registers a system** — nothing ever edits the scheduler.
- **D6 Checksum utility:** `@fourjs/diagnostics` provides FNV-1a over quantized floats:
  `q = Math.round(x * 1e6)` encoded as two uint32 words (high/low of the 53-bit integer),
  `-0` normalized to `+0`, `NaN` throws. Phase exits compare against **committed golden
  hashes**, and the second determinism run executes in a **fresh process**.
- **D7 `out` policy:** as ground rule 2. Methods with multiple outputs (e.g. `decompose`)
  take required out objects.
- **D8 Projections & slerp:** `perspective(fovYRadians, aspect, near, far, depthRange)` and
  `orthographic(left, right, bottom, top, near, far, depthRange)` with
  `depthRange: "negative-one-to-one" | "zero-to-one"`, default `"negative-one-to-one"`
  (WebGL 2 MVP; WebGPU passes `"zero-to-one"`). Quaternion `slerp` takes the shortest arc
  (negate one input when the dot product is negative).

---

## 4. Phase 0 — Project Foundation (§103)

Exit: monorepo installs; all packages compile; tests run; docs build; example app starts.

**WP-0.1 [H] Root manifests** — Depends: —. Reads: §91, §103, §3.2.
Files: `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `.npmrc`.
Steps: root `package.json`: `"name": "four.js-monorepo"`, `"private": true`,
`"version": "0.0.0"`, `"license": "MIT"`, `"type": "module"`,
`"engines": {"node": ">=20"}`, `"packageManager": "pnpm@10.33.0"`; **exact scripts**:
`"build": "turbo run build"`, `"test": "turbo run test"`,
`"test:suites": "vitest run --config vitest.suites.config.ts --passWithNoTests"`,
`"lint": "eslint ."`, `"format": "prettier --write ."`,
`"check-spec": "node tools/check-spec.mjs"`, `"docs": "typedoc"`,
`"example:build": "vite build examples/first-2d-scene"`, `"size": "size-limit"`;
devDependencies: every §3.2 pin exactly; `"pnpm": { "onlyBuiltDependencies":
["esbuild"] }` (§3.2 note). `pnpm-workspace.yaml`: `packages: ["packages/*"]`.
`.gitignore`: `node_modules`, `dist`, `coverage`, `.turbo`, `docs/api`,
`examples/**/dist`, `.claude/worktrees`. `.npmrc`: `engine-strict=true`.
Done: `pnpm install` exits 0 (orchestrator-run); lockfile present.

**WP-0.2 [H] TypeScript base config** — Depends: WP-0.1. Files: `tsconfig.base.json`.
Steps: paste §3.3 exactly.
Done: `node -e "const c=require('./tsconfig.base.json').compilerOptions; process.exit(c.module==='NodeNext'&&c.moduleResolution==='NodeNext'&&c.strict===true&&c.composite===true?0:1)"`
exits 0. _(Revised 2026-07-31: the original `tsc --showConfig` check hits TS18003 while the
repo has no `.ts` files — a base config is only ever extended, never compiled directly.
Found during execution; content requirement unchanged.)_

**WP-0.3 [H] Turborepo pipeline** — Depends: WP-0.1. Files: `turbo.json`.
Steps: tasks `build` (dependsOn `["^build"]`, outputs `["dist/**"]`), `test` (dependsOn
`["build"]`), `lint` (no deps); local caching only.
Done: `pnpm turbo run build --dry-run` exits 0 (package count asserted later, WP-0.15).

**WP-0.4 [H] Per-package scaffolding — fan-out ×23 (all except `four`)** —
Depends: WP-0.2, WP-0.3. Reads: §3.1 (this package's row), §3.4, the package `README.md`.
Files (per package P): `packages/P/package.json`, `packages/P/tsconfig.json`,
`packages/P/tsconfig.build.json`, `packages/P/src/index.ts`,
`packages/P/tests/smoke.test.ts`. _(Files line corrected 2026-07-31: `tsconfig.build.json`
was mandated by §3.4 but missing here; caught by the math-instance worker.)_
Steps: instantiate §3.4 verbatim with P's name and §3.1 deps/references;
`src/index.ts`: `export const PACKAGE_NAME = "@fourjs/P";`; smoke test imports
`../src/index.js` and asserts the name. Dispatch by §3.1 wave (waves 1→5); within a wave,
parallel.
Done (per package, after the wave's orchestrator install):
`pnpm --filter @fourjs/P run build && pnpm --filter @fourjs/P run test` exits 0.

**WP-0.5 [H] Umbrella package `four`** — Depends: all WP-0.4. Reads: §3.1, §3.4, §98.
Files: `packages/fourjs/{package.json,tsconfig.json,tsconfig.build.json,src/index.ts,src/<p>.ts ×23,tests/smoke.test.ts}`.
_(Files line corrected 2026-07-31: `tsconfig.build.json` was missing, same omission as
WP-0.4's; noted by the Phase-0 exit verifier. The landed package is complete.)_
Steps: §3.4 template, name `four`, deps = all 23; one `src/<p>.ts` re-export module per
package (`export * from "@fourjs/scene";`) plus matching subpath exports (§3.4); root
`src/index.ts` uses **namespace re-exports** (`export * as core from "@fourjs/core";`,
dashes camelCased) — flat `export *` of all packages would collide on shared symbol names
_(refined 2026-07-31 at dispatch)_; smoke test imports `PACKAGE_NAME` **from every one of
the 23 packages** (the Phase-0 cross-package integration check).
Done: `pnpm --filter four run build && pnpm --filter four run test` exits 0.

**WP-0.6 [H] Lockfile refresh (orchestrator)** — Depends: WP-0.5. Files: `pnpm-lock.yaml`.
Steps: `pnpm install`.
Done: `pnpm install --frozen-lockfile` exits 0.

**WP-0.7 [H] Lint and format config** — Depends: WP-0.2, WP-0.6.
Files: `eslint.config.js`, `.prettierrc.json`, `.prettierignore`.
Steps: use the smoke-validated config verbatim: `tseslint.config(` ignores
(`**/dist/**`, `**/node_modules/**`, `docs/**`), `...recommendedTypeChecked`,
`projectService: { allowDefaultProject: ["*.js", "*.mjs"] }` +
`tsconfigRootDir: import.meta.dirname`, a `disableTypeChecked` block for
`**/*.js`/`**/*.mjs`, `no-restricted-properties` banning `Date.now`/`Math.random`
(off under `**/tests/**`), plus a no-default-export rule. `.prettierrc.json`: `{}`.
Done: `pnpm lint` exits 0.

**WP-0.8 [H] Example placeholder (Vite)** — Depends: WP-0.6. Reads: §103, §93.
Files: `examples/first-2d-scene/{index.html,main.ts,vite.config.ts}`, root
`package.json` (devDeps add `"four": "workspace:*"`; orchestrator reinstalls after).
Steps: `main.ts` imports from `four/scene` and `four/math` subpaths and writes the imported
`PACKAGE_NAME`s into the DOM; `vite.config.ts` minimal with outDir `dist`.
Done: `pnpm example:build` exits 0 and emits `examples/first-2d-scene/dist/index.html`.

**WP-0.9 [H] Payload budget gate** — Depends: WP-0.8. Reads: §86 payload row.
Files: `.size-limit.json`.
Steps: one entry: `{"path": "examples/first-2d-scene/dist/assets/*.js",
"limit": "150 kB", "gzip": true}` (§86 specifies gzip; the preset defaults to brotli).
The built example is the §86 "minimal 2D application" proxy — solver wasm stays out per
MEMORY 2026-07-29.
Done: `pnpm build && pnpm example:build && pnpm size` exits 0.

**WP-0.10 [H] TypeDoc** — Depends: WP-0.6. Files: `typedoc.json`.
Steps: entry-point strategy `packages`, entry points `packages/*`, out `docs/api`.
Done: `pnpm run docs` exits 0 and `docs/api/index.html` exists. _(Revised 2026-07-31:
`pnpm docs` without `run` is a pnpm builtin that exits 0 without invoking the script —
vacuous check; caught by the WP-0.10 worker. `run docs` also requires a prior build.)_

**WP-0.11 [H] Root test-suite wiring** — Depends: WP-0.6.
Files: `vitest.suites.config.ts`, `package.json` (devDeps add: every `@fourjs/*` as
`workspace:*` — orchestrator refreshes lockfile after).
Steps: vitest config with `include: ["tests/**/*.test.ts"]`.
Done: `pnpm test:suites` exits 0 (passWithNoTests).

**WP-0.12 [H] CI workflow** — Depends: WP-0.7–0.11.
Files: `.github/workflows/ci.yml`.
Steps: on push/PR to the default branch: checkout, pnpm/Node 20 setup,
`pnpm install --frozen-lockfile`, `pnpm build`, `pnpm turbo run test`, `pnpm lint`,
`pnpm check-spec`, `pnpm run docs` (build must precede it; `pnpm docs` without `run` is a
pnpm builtin no-op), `pnpm example:build`, `pnpm size`, `pnpm test:suites`,
plus a supply-chain step `pnpm audit --audit-level=high` marked `continue-on-error: true`
(visibility without blocking on unfixable advisories; §96 covers runtime content, this
covers dependencies).
Done: `node -e "const y=require('yaml'),f=require('fs');y.parse(f.readFileSync('.github/workflows/ci.yml','utf8'))"`
exits 0.

**WP-0.13 [H] Community files** — Depends: —. Reads: §95.
Files: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`.
Steps: CONTRIBUTING: repo state, §2 packet workflow, RFC/ADR rule (§95), spec-amendment
rule; CODE_OF_CONDUCT: Contributor Covenant 2.1.
Done: `test -s CONTRIBUTING.md -a -s CODE_OF_CONDUCT.md` exits 0.

**WP-0.14 [H] ROADMAP.md** — Depends: —. Reads: §94, §120. Files: `ROADMAP.md`.
Steps: one line per §94 release 0.1–1.0; MVP pointer to §120; dates set per-release.
Done: `node -e "const t=require('fs').readFileSync('ROADMAP.md','utf8');['0.1','0.2','0.3','0.4','0.5','0.6','0.7','0.8','0.9','1.0'].forEach(v=>{if(!t.includes(v))process.exit(1)})"`
exits 0.

**WP-0.15 [S] Phase 0 exit** — Depends: all WP-0.*.
Steps: run the full matrix (`pnpm install --frozen-lockfile`; `pnpm build` — assert turbo
reports 24 packages; `turbo run test`; `lint`; `check-spec`; `docs`; `example:build`;
`size`; `test:suites`), warm and cold (`--force`). **Fix nothing** — file a defect list as
`WP-0.<n>-fix<k>` packets.
Done: all commands exit 0 twice; defect list empty.

---

## 5. Phase 1 — Math, Scene, and Time (§104)

Exit: a scene graph deterministically steps without a renderer. APIs are pinned by the spec
and §3.5 — workers implement, not design. Every packet's `Files` includes its package's
`src/index.ts` (add the new exports; never remove existing ones).

**WP-1.1 [H] Vector2/3/4** — Depends: Phase 0. Reads: §7b, D3, D7.
Files: `packages/math/src/{vector2,vector3,vector4,alloc-counter}.ts`, `src/index.ts`,
`packages/math/tests/vectors.test.ts`.
Steps: mutable classes with plain `x/y/z/w` fields; methods
`set/copy/clone/add/sub/scale/dot/lengthSq/length/normalize/lerp/equalsApprox(v,eps)`
(+`cross` on Vector3) per rule 2; each mutator calls the internal `changed` hook (D3);
`alloc-counter.ts`: dev-mode module counter incremented in every constructor, exported for
tests.
Done: `pnpm --filter @fourjs/math run build && pnpm --filter @fourjs/math run test` green,
including a test asserting **zero constructions** across 1000 chained ops on scratch
objects (D6-style counter, not identity checks).

**WP-1.2 [H] Quaternion** — Depends: WP-1.1.
Files: `packages/math/src/quaternion.ts`, `src/index.ts`, `tests/quaternion.test.ts`.
Steps: identity, `setFromAxisAngle` (radians), `multiply`, `conjugate`, `normalize`,
`slerp` (shortest arc per D8), `rotateVector3(v, out)` (`out` required — result is not
`this`); `changed` hook on mutators.
Done: package build+test green incl. slerp endpoint/midpoint values and shortest-arc sign
case.

**WP-1.3 [H] Matrix3/Matrix4** — Depends: WP-1.1, WP-1.2.
Files: `packages/math/src/{matrix3,matrix4}.ts`, `src/index.ts`, `tests/matrices.test.ts`.
Steps: column-major `Float64Array(9|16)` elements; `identity/copy/clone/multiply/invert/
determinant`; `compose(position, rotation, scale, pivot)` = §7's `T·Tp·R·S·Tp⁻¹`;
`decompose(outPosition, outRotation, outScale)` (documented: pivot not recovered; positive
scale assumed); `perspective`/`orthographic` per D8.
Done: build+test green incl.: compose-vs-**hand-constructed raw-number matrices** (not
`multiply` chains); round-trip `decompose(compose(p,r,s,pivot=0))` ≡ inputs; both depth
ranges of each projection helper against known values.

**WP-1.4 [H] EventEmitter** — Depends: Phase 0. Reads: §6b.
Files: `packages/core/src/events.ts`, `src/index.ts`, `tests/events.test.ts`.
Steps: §6b interface plus `emit<K extends keyof EventMap>(type: K, event: EventMap[K]):
void`.
Done: build+test green covering the four emitter-local rules: unsubscribe-fn + `once`;
registration order; add/remove during dispatch deferred to next dispatch; no re-entrant
dispatch of the same event.

**WP-1.5 [H] Component model** — Depends: Phase 0. Reads: §6a, D2.
Files: `packages/core/src/component.ts`, `src/index.ts`, `tests/component.test.ts`.
Steps: `Component` interface (`host: ComponentHost | null`, lifecycle per §6a);
`ComponentType<T>` per D2 (`typeName`-keyed); `ComponentRegistry` class implementing
add/get/remove with one-per-type + replace-warns (scene's Node delegates to it, D1).
Done: build+test green: one-per-type, replacement warning, lifecycle order, detach ≠
dispose.

**WP-1.6 [H] FourError + Disposable** — Depends: Phase 0. Reads: §83, §89.
Files: `packages/core/src/{errors,disposable}.ts`, `src/index.ts`, `tests/errors.test.ts`.
Steps: `FourError` (`code` from the §89 union incl. `CONTEXT_LOST`/`DEVICE_LOST`,
`context?`, `cause?`); `Disposable` + `disposeAll`.
Done: build+test green.

**WP-1.7 [H] Transform** — Depends: WP-1.3. Reads: §7 (all bullets), D3.
Files: `packages/scene/src/transform.ts`, `src/index.ts`, `tests/transform.test.ts`.
Steps: §7 fields; installs D3 hooks on its own math members so `version` increments on
method-based mutation; `markDirty()`; `matrixAutoUpdate=false` → user owns `localMatrix`,
no back-derivation.
Done: build+test green: pivot affects rotation/scale not position; version counts method
mutations and `markDirty`; manual-matrix mode.

**WP-1.8 [S] Node/Group/Scene** — Depends: WP-1.4, WP-1.5, WP-1.7.
Reads: §6, §6a, §46, D1, D2 **+ the source files of WP-1.4/1.5/1.7**.
Files: `packages/scene/src/{node,group,scene}.ts`, `src/index.ts`, `tests/scene.test.ts`.
Steps: D1 — `abstract class Node extends EventEmitter<NodeEventMap>`, internal
`ComponentRegistry`; §6 API; cycle prevention throws `INVALID_SCENE_GRAPH`; Scene
`findById/Name/Tag/Type/Component` (§46; selector syntax deferred to Phase 7+).
Done: build+test green: hierarchy ops, cycle prevention, all five lookups, component
lifecycle through Node.

**WP-1.9 [S] Clock + fixed-step scheduler** — Depends: WP-1.4.
Reads: §9, §10 (clamp + pause paragraphs), Appendix A, D4 **+ WP-1.4 source**.
Files: `packages/motion/src/{clock,scheduler}.ts`, `src/index.ts`,
`tests/scheduler.test.ts`.
Steps: `TimeState` with all §9 fields; **event-free** `Scheduler.step(elapsedSeconds)`
implementing §10 verbatim (timeScale on accumulation; `maximumSubSteps` clamp default 5;
excess → `droppedTime`; paused freezes accumulator, `deltaTime = 0`, `unscaledDeltaTime`
continues); invokes injected callbacks `onFixedStep/onUpdate/onRender` in order (D4 — the
Application re-emits these as events later).
Done: build+test green: clamp drops exactly per §10; alpha ∈ [0,1]; pause ≡ `timeScale=0`
except timeScale preserved; two runs with identical injected times → identical TimeState
sequences.

**WP-1.10 [S] World-transform resolution** — Depends: WP-1.8.
Reads: §7 semantics, WP-1.7/1.8 source.
Files: `packages/scene/src/world-transforms.ts`, `src/index.ts`,
`tests/world-transforms.test.ts`.
Steps: lazy, version-cached `resolveWorldTransforms(scene)` (per fixed step + pre-render
per §7) and on-demand single-node resolve.
Done: build+test green: ancestor moves propagate; untouched subtrees not recomputed
(resolution counter); mid-frame on-demand query correct.

**WP-1.11 [S] SimulationSystem registry** — Depends: WP-1.9. Reads: §39, D5 + WP-1.9 source.
Files: `packages/motion/src/systems.ts`, `src/index.ts`, `tests/systems.test.ts`.
Steps: `SimulationSystem` (§39 interface) + priority-ordered registry executed inside the
scheduler's fixed step; priorities follow the §39 ordering (documented constants); nothing
else ever edits the scheduler (D5).
Done: build+test green: ordering respected, insertion-order stable within equal priority,
dispose removes.

**WP-1.12 [S] Application composition root** — Depends: WP-1.9, WP-1.10, WP-1.11.
Reads: §45, §6b, §10, D4 + WP-1.9/1.10/1.11 source.
Files: `packages/fourjs/src/application.ts`, `src/index.ts`, `tests/application.test.ts`.
Steps: minimal `Application` (§45 subset): owns a Scene, a Scheduler, the system registry;
`initialize/start/stop/pause/resume/step/dispose`; emits `fixedUpdate`/`update`/`render`
(§6b) from scheduler callbacks; manual `step(elapsed)` mode for headless (renderer arrives
Phase 3).
Done: build+test green: lifecycle transitions; events fire in §10 order; headless stepping
drives `resolveWorldTransforms`.

**WP-1.13 [H] Checksum utility** — Depends: Phase 0. Reads: §33, D6.
Files: `packages/diagnostics/src/checksum.ts`, `src/index.ts`, `tests/checksum.test.ts`.
Steps: D6 exactly (FNV-1a-32; quantize ×1e6, two-uint32 encoding, −0→+0, NaN throws);
`hashFloats(iterable)` + incremental hasher.
Done: build+test green incl. committed known-answer vectors and −0/NaN cases.

**WP-1.14 [S] Phase 1 exit** — Depends: all WP-1.*.
Files: `tests/determinism/phase1-headless-stepping.test.ts`,
`tests/determinism/golden/phase1.json`.
Steps: 100-node scene, transforms mutated from registered fixed-step systems, 1000 steps;
hash all world matrices per step with `@fourjs/diagnostics` (D6); run once in-process, once
in a **fresh child process**; compare both against the committed golden hash. Fix nothing;
defect list as `WP-1.<n>-fix<k>`.
Done: `pnpm test:suites` green twice (warm/cold); golden file committed.

---

## 6. Phase 2 — Motion Foundation (§105)

Exit: motion is deterministic, renderer-independent, unit tested.

**WP-2.1 [H] Integrator functions** — Depends: Phase 1. Reads: §38.
Files: `packages/motion/src/integrators.ts`, `src/index.ts`, `tests/integrators.test.ts`.
Steps: `type IntegratorState = { position: Vector3; velocity: Vector3 }`;
`type IntegratorFn = (state: IntegratorState, acceleration: (s: IntegratorState,
t: number, out: Vector3) => Vector3, t: number, dt: number) => void` (mutates state
in place); implement the five §38 integrators under those exact names.
Done: build+test green: constant-acceleration analytic check per integrator; energy drift
ordering (explicit-euler > semi-implicit) on a spring.

**WP-2.2 [H] MotionComponent** — Depends: WP-2.1. Reads: §11, D2, D5.
Files: `packages/motion/src/motion-component.ts`, `src/index.ts`,
`tests/motion-component.test.ts`.
Steps: class per D2 with §11 fields; a `MotionSystem` (registered per D5, §39 kinematic
slot) advances each component per fixed step with semi-implicit Euler (§38 default):
`v += a·dt; v *= 1/(1 + damping·dt); clamp to maxSpeed; x += v·dt` (same shape for
angular).
Done: build+test green: analytic constant-velocity/acceleration positions at t = 1 s;
damping halts drift; component add/remove via Node.

**WP-2.3 [S] Transform authority** — Depends: WP-2.2.
Reads: §42, §19, D1 + WP-1.8/2.2 source.
Files: `packages/scene/src/authority.ts`, `packages/scene/src/index.ts`,
`packages/motion/src/motion-component.ts` (enforcement), `tests/authority.test.ts`.
Steps: `TransformAuthority` enum (§42 incl. `blended`) + `node.transformAuthority` field
live in `@fourjs/scene` (the §42 API is on Node); motion systems check ownership before
writing and emit the §42 dev warning (once per node per offending system) on conflict.
Done: build+test green: single-owner writes pass; conflicting writer warns and does not
write; `blended` reserved (throws `NOT_IMPLEMENTED` until Phase 7 — note: this code is not
yet in `FourErrorCode`; WP-2.3's Files must include `packages/core/src/errors.ts` to add
it, flagged by the WP-1.6 worker 2026-07-31).

**WP-2.4 [H] Trajectories** — Depends: Phase 1. Reads: §13, D7, D8.
Files: `packages/motion/src/trajectories.ts`, `src/index.ts`,
`tests/trajectories.test.ts`.
Steps: `Trajectory` interface per §13 (`out?` per D7). Pinned constructors —
`LinearTrajectory({from, to, duration})`;
`CircularTrajectory({center, radius, angularVelocity, phase = 0})` (XY plane, Y-up);
`EllipticalTrajectory({center, radiusX, radiusY, angularVelocity, phase = 0})`;
`ParabolicTrajectory({from, initialVelocity, acceleration})` (ballistic = alias with
gravity default `(0,-9.81,0)`);
`CubicBezierTrajectory({p0, p1, p2, p3, duration})`;
`CatmullRomTrajectory({points, duration, alpha = 0.5})` (centripetal);
`DampedSpringTrajectory({from, to, frequencyHz, dampingRatio})` (spring math lives here);
`ParametricTrajectory({position: (t, out) => Vector3, duration})` (§13 "custom
parametric"). Velocity/acceleration analytic where closed-form, else central difference
(h = 1e-4 s, documented).
Done: build+test green: each built-in checked at t = 0, t = duration/2 analytically;
sampling allocates nothing when `out` passed (counter).

**WP-2.5 [S] Kinematic controller** — Depends: WP-2.3, WP-2.4.
Reads: §12 + WP-2.3/2.4 source.
Files: `packages/motion/src/kinematic-controller.ts`, `src/index.ts`,
`tests/kinematic.test.ts`.
Steps: component (D2) with `moveTo/rotateTo/followPath` over trajectories; registers a
system (D5); writes under `kinematic` authority.
Done: build+test green: `moveTo` arrives within tolerance at duration; `followPath` tracks
a circular trajectory; authority respected.

**WP-2.6 [S] Interpolation buffers** — Depends: WP-2.2. Reads: §43, §37 (previous-pose
sentence), D4 + WP-1.10/2.2 source.
Files: `packages/scene/src/interpolation.ts`, `src/index.ts`,
`tests/interpolation.test.ts`.
Steps: the **single** previous/current pose store, scene-side (§37: one owner — physics
will write into this same store in Phase 5); captured per fixed step post-systems;
`computeRenderPose(node, alpha, out)` — positions lerp, **rotations slerp** (§43); render
poses are presentation-only, never written back.
Done: build+test green: alpha 0/0.5/1 poses correct; slerp used (non-linear midpoint
rotation asserted); scene transforms untouched by interpolation.

**WP-2.7 [S] Phase 2 exit** — Depends: all WP-2.*.
Files: `tests/determinism/phase2-motion.test.ts`, `tests/determinism/golden/phase2.json`.
Steps: the §105 demonstration set (constant velocity, constant acceleration, circular,
spline, damped spring) asserted against closed-form positions at t = 1 s (constructors are
pinned in WP-2.4, so values are derivable); fresh-process determinism double run vs
committed golden hash. Fix nothing; `WP-2.<n>-fix<k>` defect list.
Done: `pnpm test:suites` green twice; golden committed.

---

## 6a. Phase 3 — Renderer Foundation (§106; decomposed 2026-08-01 per §2 rolling wave)

Exit: moving 2D and 3D primitives render smoothly despite fixed-step simulation.
All surfaces spec-pinned (§47–48, §61–64, §49 subset, D8, rev-1.3 context-loss); no RFC
triggered. MVP tier: unlit colored geometry, WebGL 2 only, `"negative-one-to-one"` depth.

- **WP-3.1/3.2 [S] Cameras + Viewport** (`@fourjs/scene`, batched: shared barrel) — §47
  `Camera` abstract Node subclass (near/far/projection/inverseProjection/view matrices;
  view = inverse world), `PerspectiveCamera` (fovY radians/aspect/near/far),
  `OrthographicCamera`; projections via Matrix4 D8 helpers with `depthRange` argument at
  update time; §48 `Viewport` (id, camera, rect, normalized?, clearColor) minimal. Tests vs
  math ground truth incl. view = world⁻¹ under hierarchy.
- **WP-3.3 [S] Geometry/material/renderable lite** (batched across `@fourjs/geometry`,
  `@fourjs/materials`, `@fourjs/render`) — `BufferGeometry` (positions Float32Array, optional
  indices, bounds), `boxGeometry/planeGeometry/circleGeometry2D` builders;
  `UnlitMaterial` (RGBA color); `Renderable` Node subclass (§49 subset: geometry, material,
  renderLayer/renderOrder) + `buildRenderList(scene, camera)` (§64 subset → compact items)
  with an interpolation-aware variant composing PoseBuffer local render poses down the
  hierarchy (§43 application; documented O(n)).
- **WP-3.4 [S] Renderer interface** (`@fourjs/render`) — §61 interface verbatim + rev-1.3
  context-loss contract (`contextlost`/`contextrestored` events, engine-resource
  re-creation policy), `RendererCapabilities` minimal, shared clear/viewport semantics.
- **WP-3.5 [S] WebGL 2 backend** (`@fourjs/render-webgl`) — implements §61 for unlit colored
  geometry: context acquisition, one shader pair, VAO per geometry (cached, disposed),
  camera VP uniform, per-item model matrix, §48 viewport rects + clears, context-loss
  wiring to the §61 events, `"negative-one-to-one"` depth. Unit-testable parts split from
  GL calls (command building pure; GL layer thin) so coverage stays honest without a GPU.
- **WP-3.6 [S] Application renderer integration** (`four`) — `renderer: "webgl2" | false`
  - `canvas` options; `initialize()` constructs the backend (async per §45);
    `render` event drives `renderer.render(scene, views)` with interpolation-aware lists;
    optional rAF driver (`start` stays headless-safe; manual stepping unchanged).
- **WP-3.7 [H] Real example** — `examples/first-2d-scene` becomes moving shapes
  (MotionComponent + KinematicController) rendered via WebGL; the §86 size gate becomes
  meaningful from here.
- **WP-3.8 [S] Browser test** — Playwright against the pre-installed Chromium/SwiftShader:
  example loads, canvas non-blank, animates (two frame grabs differ), zero console errors;
  root `test:browser` script + CI step. (Orchestrator pin addition at dispatch:
  `@playwright/test`.)
- **WP-3.9 [S] Phase 3 exit** — independent verifier: full matrix + browser evidence of
  smooth motion under fixed-step (frame-delta assertions), coverage ≥95% on touched
  packages, §106 criterion verdict, defect list.

## 6b. Phase 3a — Interaction, Sprites, and Text MVP (§106a; decomposed 2026-08-01)

Exit: pointer events, picking, dragging, sprites, and text labels work in a mixed 2D/3D
example — and the exit ships the demo-ready build (public deployment is an owner step).

- **WP-3a.1 [S] Picking** (`@fourjs/input`) — §71 bounds+analytic tier: camera ray from NDC
  (unproject via inverse projection + camera world), plane/circle analytic hits (2D),
  transformed-AABB hits from geometry bounds (3D), nearest-first ordering, `pick(scene,
camera, ndcX, ndcY)` returning hits with node/distance/point.
- **WP-3a.2 [S] Pointer input + propagation + dragging** (`@fourjs/input`) — §72 subset:
  structural DOM pointer source, normalized events (down/up/move/click/enter/leave) with
  NDC coords, capture→target→bubble through the scene graph (§6b input exception), pointer
  capture, drag manager (§120: down on node → move deltas in world → up releases) writing
  under `"manual"`-authority rules via a callback (no direct transform writes by input).
- **WP-3a.3 [S] Textures + sprites** (`@fourjs/render`, `@fourjs/render-webgl`,
  `@fourjs/materials`) — minimal §55/§61 tier: `Texture` + `Renderer.createTexture`
  (structural ImageBitmap-like source), `SpriteMaterial` (texture + tint), `Sprite`
  renderable (anchor, world sizing), webgl textured-quad program + texture cache
  (loss-aware like the VAO cache).
- **WP-3a.4 [S] Text MVP** (`@fourjs/text`) — §56 MVP tier: runtime glyph atlas via an
  injected structural rasterizer (canvas-like), Latin subset, `Text` producing textured
  quads through the sprite path; no shaping/bidi (staged per spec §56 note).
- **WP-3a.5 [H] Example upgrade** — interactive: click recolors, drag moves, a live text
  label; composes input+sprites+text.
- **WP-3a.6 [S] Browser interaction gate** — Playwright: synthetic pointer events hit,
  drag moves pixels, text renders legibly (pixel-region assertions).
- **WP-3a.7 [S] Phase 3a exit** — independent verifier: full matrix + interaction gates,
  coverage ≥95% on touched packages, demo-ready build artifact confirmed; §106a verdict.

## 6c. Phase 4 — Animation Core (§107; decomposed 2026-08-01)

Exit (§107): any numeric, vector, quaternion, color, or transform property can be animated.

Phase-level pinned decisions (so no packet re-litigates them):

- **P4-1 Fixed-step animation.** `AnimationSystem` is a §39 simulation system advancing
  tweens/timelines/mixers on the **fixed step** with the scaled simulation delta,
  registered **before** `MotionSystem` (§19 pipeline order: animation pose → kinematic →
  physics). Transform writes happen under `"animation"` authority (§42) and reach the
  screen through the existing §43 pose interpolation; non-transform properties step at
  the fixed rate (acceptable at 60 Hz; revisit if a variable-rate tier is ever needed).
  Rationale: §16 deterministic evaluation, §34 replay, and the Phase 7 blend pipeline.
- **P4-2 Color values.** The `color` tween/track type targets the materials-style mutable
  RGBA 4-tuple (componentwise lerp, no clamping — §60a extended range); there is no Color
  class (WP-3.3 decision).
- **P4-3 Staging.** Morph-weight and skeletal-joint tracks (§17), state machines/blend
  trees (§18), IK, and spring _simulation_ beyond the §15 spring easing are **not** Phase 4
  (§107 does not list them; they arrive with later phases). `AnimationClip.events` ships
  now, with §16 marker semantics.
- **P4-4 Facade.** `@fourjs/animation` owns `animate()`/`tween()`/`Timeline`/clip types; the
  `four` umbrella re-exports through its existing subpath pattern (`four/animation`).
  §15's `Four.animate(...)` reads as the umbrella namespace import.
- **P4-5 Barrel discipline.** WP-4.1/WP-4.2 run in parallel and do **not** touch
  `src/index.ts` (tests import relatively); WP-4.3 assembles the barrel, later serial
  packets extend it.

Packets:

- **WP-4.0 [S] Tooling chores (Phase 3a exit notes)** — `examples/tsconfig.json` +
  root `typecheck:examples` script (`tsc --noEmit`, NodeNext, strict) wired into CI;
  per-package vitest coverage via a shared config (v8 provider, `src/**/*.ts` include,
  ≥95% thresholds on lines/statements/functions/branches) exposed as a root
  `coverage` task so the gate is tooling-enforced, not review-enforced.
- **WP-4.1 [S] Easing library** (`@fourjs/animation`) — §15's 12 families with in/out/in-out
  variants; string registry ("cubic-out"-style keys, bare "linear"); pinned documented
  constants for back/elastic/spring parameters; pure `(t) => number` on [0,1] with exact
  0→0/1→1 endpoints; closed-form value tests.
- **WP-4.2 [S] Bindings + value adapters** (`@fourjs/animation`) — §16 typed property
  references; string-path convenience resolved once at creation (FourError on bad paths);
  adapters: number, Vector2/3/4 (out-param lerp), Quaternion (shortest-arc slerp), RGBA
  4-tuple, boolean/discrete (step); zero per-frame allocation after setup.
- **WP-4.3 [S] Tween core** (`@fourjs/animation`) — §15 builder API
  (`animate(target).to(props, seconds).ease(name).play()` plus `from`/delay/repeat/yoyo/
  speed/pause/resume/seek/stop); value evaluation a pure function of local time;
  last-started-wins on a shared property with a dev warning (§16); transform targets
  require `"animation"` authority — refusal warns and skips the whole write (WP-2.3
  semantics). Assembles the package barrel (P4-5).
- **WP-4.4 [S] Timeline** (`@fourjs/animation`) — §16: `.at(time, tween | timeline |
callback)`, nesting, labels, markers (fire exactly once per forward crossing; seek/scrub
  suppress by default with per-marker `replayOnSeek`), parallel tracks, sequencing, loop,
  reverse, scrub, playback speed, pause/resume; mid-timeline restore positions playback
  without re-firing crossed markers.
- **WP-4.5 [S] Clips + tracks** (`@fourjs/animation`) — §17: `AnimationClip { name, duration,
tracks, events }`; scalar/vector/quaternion/color/boolean/discrete/custom-property
  tracks (morph + skeletal staged per P4-3); interpolation step/linear/cubic/Hermite +
  slerp; binary-search keyframe sampling, pure in clip-local time (§9).
- **WP-4.6 [S] Mixer + AnimationSystem** (`@fourjs/animation`) — mixer resolves clip tracks
  onto a target via WP-4.2 bindings; playback controls (play/pause/stop/speed/loop); clip
  event markers with §16 crossing semantics; `AnimationSystem` per P4-1 (fixed step,
  ordered before MotionSystem, `"animation"` authority, insertion-order updates,
  auto-removal of finished items).
- **WP-4.7 [H] Umbrella + example upgrade** — `four/animation` subpath + umbrella
  re-export; the example gains §107-coverage animations (vector position tween,
  quaternion slerp clip, color track on a material, numeric tween, one timeline with a
  marker); §86 size gate stays ≤150 kB gzip.
- **WP-4.8 [S] Animation gates** — `tests/determinism/` phase4 golden scenario (timeline +
  mixer over 1000 fixed steps, digest in-process + fresh child process); browser spec
  asserting animated motion/color in pixels; marker seek-suppression determinism test.
- **WP-4.9 [S] Phase 4 exit** — independent verifier: full matrix + animation gates +
  tooling-enforced coverage (WP-4.0), §107 verdict, fix nothing.

Dependencies: 4.0 ∥ 4.1 ∥ 4.2 (disjoint files); 4.3 ← 4.1+4.2; 4.4 ← 4.3; 4.5 ← 4.2
(∥ 4.4, files disjoint, barrel untouched per P4-5); 4.6 ← 4.4+4.5; 4.7 ← 4.6;
4.8 ← 4.7; 4.9 last.

## 6d. Phase 5 — Physics API + Rapier Adapter (§108; decomposed 2026-08-01)

Exit (§108): a mixed 2D/3D demonstration supports gravity, collisions, impulses, and
sensors through the common API.

Phase-level pinned decisions:

- **P5-1 Rapier pins.** `@dimforge/rapier2d-compat@0.19.3` + `@dimforge/rapier3d-compat@0.19.3`
  (registry-checked 2026-08-01). The `-compat` variants are official @dimforge builds with
  base64-embedded wasm — they load in Node/vitest and bundlers alike with an async
  `init()`, which §37's `initialize(): Promise<void> | void` was designed for. This
  refines MEMORY 2026-07-29 ("official wasm packages") — dated note at phase close.
  Solver wasm stays outside the §86 budget (per MEMORY); the physics example's size is
  recorded but not gated.
- **P5-2 System slot.** `PhysicsSystem` runs at the existing `PRIORITY_PHYSICS_SOLVE`
  (600). Per §37/§39: syncSceneToSolver → step → syncSolverToScene → drainEvents →
  normalize → dispatch AFTER the fixed step (§6b/§29, never during). The pre-step body
  pose feeds the WP-2.6 PoseBuffer as "previous" for §43 interpolation. Solved transforms
  write under `"physics"` authority (§42).
- **P5-3 §21 typing.** Public API typed once in 3D (`Vector3`/`Quaternion`); a `"2d"`
  world constrains motion to XY + rotation to Z and accepts `Vector2` convenience
  arguments widening to `z = 0`. Y-up, gravity −Y in both.
- **P5-4 Joints staged.** §108 lists no joints; Phase 6 owns them. Phase 5 ships the §37
  `createJoint`/`destroyJoint` signatures with adapters throwing `NOT_IMPLEMENTED` and
  `capabilities.jointTypes: []`.
- **P5-5 Adapter injection.** `PhysicsWorld` takes a `PhysicsSolverAdapter` INSTANCE
  (mirrors the renderer-instance decision); §20's `solver: "auto"` string selection joins
  the §45 registry backlog item.
- **P5-6 Shape tier.** Phase 5 ships 2D circle/rectangle/capsule/polygon and 3D
  sphere/box/capsule; the remaining §24 shapes (polyline/chain/cylinder/cone/convex
  hull/trimesh/heightfield/compound) are validated-out with clear errors and staged
  (capability-declared). Rapier supports them — later packets widen the tier.
- **P5-7 Example.** New `examples/physics-playground` (own vite build + browser spec)
  demonstrates §108: one app stepping a `"3d"` world and a `"2d"` world through the one
  API — gravity falls, collisions settle, click applies an impulse, a sensor zone
  reacts. `first-2d-scene` and its §86 gate are untouched.

Packets:

- **WP-5.1 [S] Physics types + §37 contract** (`@fourjs/physics`) — all §20–§34 public
  types: dimension/body-type/CCD/determinism/combine unions, `RigidBodyDescriptor`,
  `ColliderDescriptor` + the P5-6 shape unions, minimal `JointDescriptor` (P5-4),
  `PhysicsMaterial` (§25 combine rules + density-fallback doc), §29 event payload
  types + `PhysicsEvent` union, §30 query option/result types, `PhysicsCapabilities`,
  `PhysicsSolverAdapter` (§37 verbatim shape), opaque handle types, §23/§85 validation
  helpers (positive dynamic mass, shape parameter checks). Types + validators only; no
  system. Starts the package barrel.
- **WP-5.2 [S] RigidBody/Collider components + material** (`@fourjs/physics`) — §6a
  components: `RigidBody` (§23 fields incl. derived `inverseMass`, force/impulse
  command queue applied at the next fixed step, `wake()`/`sleep()`, §29 typed events on
  the component emitter), `Collider` (§24 fields, sensor flag, groups/mask),
  `PhysicsMaterial` class; §25 combine + density fallback logic; mass-from-density
  derivation (§23) for the P5-6 shapes.
  _Dated note (2026-08-01, orchestrator):_ mass-from-density derivation (§23) is
  **delegated to the solver** — Rapier derives mass from collider densities natively,
  and duplicating a volume model in `@fourjs/physics` risks disagreeing with it. The
  WP-5.2 worker correctly stopped rather than improvise; `inverseMass` reads `NaN`
  until the solver derives mass, and WP-5.3 refreshes the component's mass properties
  from the adapter after registration.
- **WP-5.3 [S] PhysicsWorld + PhysicsSystem + fake-adapter seam** (`@fourjs/physics`) —
  world lifecycle (component registration → adapter handles, monotonic body ids §33),
  P5-2 fixed-step pipeline, pose-store integration, `"physics"` authority writes, §30
  query surface with §21 2D semantics, §32 sleeping config, §33 checksum (FNV-1a via
  @fourjs/diagnostics, 1e-6, ascending body id), §34 snapshot passthrough with
  adapter/version validity metadata; tests against a structural `FakeSolverAdapter`
  (scripted events + recorded calls — the fake-GL pattern).
  _Dated note (2026-08-01, orchestrator):_ the §33 checksum could not "reuse WP-1.13"
  as the §7 table suggested — the frozen §3.1 matrix gives `physics` no `diagnostics`
  edge. Resolution: FNV-1a is re-implemented privately in `world.ts`, pinned
  byte-for-byte against an independent reference implementation in its tests. Accepted
  duplication; preferable to widening the dependency matrix for one hash function.
- **WP-5.4 [S] Rapier adapter, 2D** (`@fourjs/physics-rapier`) — P5-1 deps (package.json
  edit; ORCHESTRATOR runs the install), shared init plumbing, 2D adapter: bodies,
  colliders (P5-6 tier), step, EventQueue → §37 `drainEvents`, queries, snapshot via
  Rapier serialization, honest `PhysicsCapabilities` (verify CCD-mode mapping against
  Rapier docs and report); unit tests against real wasm.
- **WP-5.5 [S] Rapier adapter, 3D** (`@fourjs/physics-rapier`) — same contract for
  rapier3d; shared code factored with the 2D adapter where honest.
- **WP-5.6 [S] Cross-integration** — `@fourjs/physics` + Rapier end-to-end in both
  dimensions: gravity fall vs closed form (tolerance documented), restitution bounce,
  impulses, sensors (enter/exit), raycast/overlap, §29 event normalization, §33
  checksum repeatability in-process, §42 authority + pose interpolation seam.
- **WP-5.7 [H] Physics example + umbrella** — `examples/physics-playground` per P5-7;
  `four/physics` + `four/physics-rapier` umbrella subpaths verified; record bundle size
  (not §86-gated, wasm outside budget).
- **WP-5.8 [S] Phase 5 gates** — determinism golden phase5 (2D + 3D Rapier worlds,
  1000 fixed steps, §33 checksums, in-process + fresh child process — same-runtime
  tier), browser spec for the playground (fall/settle pixels, impulse reaction, sensor
  reaction), suites/browser pickup.
- **WP-5.9 [S] Phase 5 exit** — independent verifier: full matrix + physics gates +
  coverage, §108 verdict, fix nothing.

Dependencies: 5.1 → (5.2 ∥ 5.4); 5.3 ← 5.2; 5.5 ← 5.4; 5.6 ← 5.3 + 5.5; 5.7 ← 5.6;
5.8 ← 5.7; 5.9 last. (5.2/5.3 live in `physics`, 5.4/5.5 in `physics-rapier` — different
packages, so the pairs run in parallel without worktrees.)

## 6e. Phase 6 — Joints and Constraints (§28, §109; decomposed 2026-08-01)

Exit (§109): constraints remain stable under expected real-time loads — made measurable
as: the §109 mechanism demo runs ≥3600 fixed steps with bounded positions, no NaN, joint
constraint drift below documented tolerances, and the browser demo visibly stable.

Phase-level pinned decisions:

- **P6-1 Joint tier** (checked against installed rapier-compat 0.19.3 typings):
  **fixed, revolute/hinge (motors + limits), prismatic/slider (motors + limits), rope,
  spring** in both dimensions, **spherical/ball (limits)** in 3D. **Staged out with
  loud validation errors:** `distance` (Rapier has no rigid distance joint — rope caps
  max distance only; emulating with a stiff spring would misrepresent §28) and `gear`
  (no Rapier support). `capabilities.jointTypes` lists exactly what each adapter ships.
- **P6-2 Break thresholds** live at the `@fourjs/physics` layer: the world monitors joint
  reaction impulses each step and destroys joints exceeding `breakForce`/`breakTorque`,
  emitting a `jointbreak` event — IF the adapter can report reaction impulses (workers
  verify against 0.19.3; if unavailable, breakage is staged with a dated note, not
  faked).
- **P6-3 API shape** per §28's sketch: typed joint classes (`HingeJoint({bodyA, bodyB,
anchor, axis, limits, motor})`-style) over the §37 `JointDescriptor`; joints register
  through the world (`world.addJoint(joint)`), not as node components (a joint spans
  two bodies; §6a's one-per-node model does not fit it).
- **P6-4 Demo**: a new `examples/mechanism` (§109 list: rotating shaft, hinge, slider,
  spring, motor, limit switches) with its own vite build, third Playwright webServer,
  and browser spec. The playground is untouched (its pixel gates stay valid).

Packets:

- **WP-6.1 [S] Joint API** (`@fourjs/physics`) — full `JointDescriptor` discriminated
  unions for the P6-1 tier (+ staged types rejected in validation with P6-1 cited),
  §28 joint classes with limits/motor/spring params + break thresholds + collision
  enable/disable, world.addJoint/removeJoint plumbing to adapter handles, `jointbreak`
  event type, extended fake-adapter coverage.
- **WP-6.2 [S] Rapier 2D joints** + **WP-6.3 [S] Rapier 3D joints**
  (`@fourjs/physics-rapier`, parallel after 6.1) — JointData mapping, motors
  (targetVelocity/maxTorque → Rapier motor model — verify configureMotor* APIs),
  limits, reaction-impulse reporting for P6-2 (verify; report honestly),
  capabilities.jointTypes updated, wasm-backed tests incl. pendulum period vs closed
  form and motor-driven steady state.
- **WP-6.4 [S] Integration + breakage** — cross-package suite: hinge pendulum,
  motorized shaft reaching commanded speed, slider with limits, spring
  oscillation/damping vs closed form, rope constraint, spherical cone (3D), breakage
  under load (per P6-2's verified mechanism), §33 checksums stable with joints, both
  dimensions.
- **WP-6.5 [H] Mechanism example** (P6-4) — §109's engineering mechanism composed from
  the landed API; probe measurements seed WP-6.6.
- **WP-6.6 [S] Phase 6 gates** — determinism golden phase6 (mechanism scenario,
  cross-process) + mechanism browser spec (third webServer).
- **WP-6.7 [S] Phase 6 exit** — independent verifier, §109 verdict per the measurable
  criterion above, fix nothing.

Dependencies: 6.1 → (6.2 ∥ 6.3); 6.4 ← 6.2 + 6.3; 6.5 ← 6.4; 6.6 ← 6.5; 6.7 last.

## 6f. Phase 7 — Physics-Animation Blending (§19, §42, §110; decomposed 2026-08-02)

Exit (§110): a character or machine can move between animated, kinematic, and physical
control without abrupt discontinuities — made measurable as: across every control-mode
switch in the integration scenarios, the per-step node displacement stays bounded by a
documented continuity tolerance (no teleport step), plus the §19 pipeline order proven.

Phase-level pinned decisions:

- **P7-1 Pose targets.** Animation drives _target poses_, not owned transforms, under
  `"blended"`: a `PoseTarget` component lives in `@fourjs/scene` (position/rotation/
  scale? — position+rotation MVP), bindable by tweens/mixers like any object. Neither
  `animation` nor `physics` may import the other (§3.1) — scene is the shared home.
- **P7-2 Weights.** §19 sketch verbatim: `physicsWeight`/`animationWeight` on
  `RigidBody`, independent settables normalized at use (warn when both 0). Blend =
  lerp(position)/slerp(rotation) of target pose vs solver pose.
- **P7-3 Transitions.** Verify Rapier's runtime `setBodyType` (both dims); extend
  `SolverBodyAccess` with `setBodyType(handle, type, wake)`; `world.setBodyControlMode`
  retypes IN PLACE (ids/checksum order preserved) with optional velocity inheritance
  from finite-differenced target-pose history (ragdoll activation).
- **P7-4 Blend pipeline.** A `BlendSystem` in `@fourjs/physics` at a priority after
  PRIORITY_PHYSICS_SOLVE (§19 steps 1–5): before the solve it feeds targets to
  kinematic bodies (animation-weighted); after it, for `"blended"` nodes, writes the
  weighted combination of target and solver pose under the `"blended"` authority
  (unlocking WP-2.3's reserved value). Render interpolation stays downstream (§43).
- **P7-5 Root motion MVP** (`@fourjs/animation`): a mixer `rootMotion` option extracting
  per-step TRANSLATION deltas from a designated track onto a designated node;
  rotational root motion staged with a dated note. Seek does not accumulate (§16).

Packets:

- **WP-7.1 [S] PoseTarget + weights** — `@fourjs/scene` PoseTarget component;
  `physicsWeight`/`animationWeight` on RigidBody (validation, §19 sketch); tween/mixer
  binding proof.
- **WP-7.2 [S] Retype + transitions** — SolverBodyAccess.setBodyType (verify Rapier
  both dims; ids preserved), world.setBodyControlMode with velocity inheritance.
- **WP-7.3 [S] BlendSystem** — P7-4 pipeline, "blended" authority writes, continuity
  clamps documented; fake-adapter tests.
- **WP-7.4 [S] Root motion MVP** — P7-5 in the mixer; unit + determinism-safe tests.
  _Dated note (2026-08-02, exit verifier, P7-4 structural amendment):_ no separate
  `BlendSystem` exists — the shipped design runs both blend halves inside
  `PhysicsWorld.step` (pre-solve feed, post-solve publish, within the system at 600)
  plus `createPoseTargetCaptureSystem` at 299, which the plan had not anticipated.
  The §19 ordering guarantee is fully satisfied; recorded here so the plan stays
  truthful about the shape.
  _Dated note (2026-08-02, orchestrator, P7-4 amendment):_ the kinematic target feed is
  **unweighted** (WP-7.3): weighting both the feed and the publish would apply
  `animationWeight` twice — an unrequested low-pass filter — and for
  `kinematic-position` bodies the solver pose equals the target regardless. Weights
  apply once, at the publish blend. Also accepted: blending covers every §22 body type
  under `"blended"` (a dynamic-only rule would freeze blended kinematic nodes), and the
  missing-trio error throws from the step rather than warn-skipping.
- **WP-7.5 [S] Integration** — §19's four examples as scenarios (animated door,
  hinged door, commanded arm, ragdoll character): full mode-cycle
  animated→kinematic→dynamic→blended→animated with the continuity tolerance asserted
  at every switch, both dims where types allow; §33 checksums with blending.
- **WP-7.6 [H] Blending example** — new `examples/blending` (fourth webServer):
  an arm/door scene cycling control modes on click; probe seeds WP-7.7.
- **WP-7.7 [S] Phase 7 gates** — determinism golden phase7 (mode-cycling scenario,
  cross-process) + blending browser spec.
- **WP-7.8 [S] Phase 7 exit** — independent verifier, §110 verdict per the measurable
  criterion, fix nothing.

Dependencies: 7.1 → (7.2 ∥ 7.4); 7.3 ← 7.1+7.2; 7.5 ← 7.3+7.4; 7.6 ← 7.5; 7.7 ← 7.6;
7.8 last.

## 6g. Phase 8 — Advanced Motion (§111; decomposed 2026-08-02)

Exit (plan-defined; §111 sets none — owner to confirm, recorded since revision 2):
the PID utility and steering behaviors pass analytic tests, and a demo scenario
composes them with the existing motion/physics stack.

Phase-level pinned decisions:

- **P8-1 Tier.** Phase 8 ships: §111's **PID controller utility** (the §111 sketch
  verbatim: kp/ki/kd, outputLimits, plus the standard anti-windup + derivative-on-
  measurement decisions documented), **spring-damper controllers** (§13's damped
  spring generalized to a controller form), **steering behaviors** (§12's classic
  set: seek, flee, arrive, pursue, evade, wander(deterministic seeded), separation/
  cohesion/alignment = flocking over a neighbor query), and **trajectory prediction**
  (ballistic + constant-velocity lead, closed-form). **Staged with dated notes:**
  path-planning adapters (needs an adapter RFC), full IK (two-bone analytic IK MAY
  ship if it stays small — worker decides honestly; CCD/FABRIK staged), robotic
  joint commands (§119's domain — a thin command mapping over Phase 6 motors MAY
  ship as a utility if honest).
- **P8-2 Home.** Everything lands in `@fourjs/motion` (steering/PID/prediction are
  motion utilities over core+math+scene; no new deps). Steering integrates as
  forces/accelerations feeding MotionComponent or as target velocities — pinned:
  steering outputs an ACCELERATION (out-param), applied by the caller (composable
  with §38 integrators); a `SteeringAgent` convenience component MAY wrap it.
- **P8-3 Determinism.** Wander uses the seeded RNG from @fourjs/core (verify one
  exists — else a small xorshift utility in motion with a documented seed contract);
  flocking neighbor iteration in insertion order.

Packets:

- **WP-8.1 [S] PID + spring-damper controllers** (`@fourjs/motion`) — §111 sketch
  verbatim + anti-windup/derivative-on-measurement (documented decisions), reset(),
  closed-form analytic tests (step response of a known plant vs discrete solution).
- **WP-8.2 [S] Steering + flocking** (`@fourjs/motion`) — P8-1 set, acceleration
  out-params, seeded wander, neighbor-query interface (brute-force MVP, spatial
  hash staged), analytic tests (arrive slows to zero at target; pursuit intercept
  on a closed form; flock cohesion bounded).
- **WP-8.3 [S] Trajectory prediction + optional two-bone IK** (`@fourjs/motion`) —
  ballistic/lead closed forms; two-bone IK only if honest (else staged note).
- **WP-8.4 [S] Integration + demo scenario** — root suite: PID drives a §111-style
  speed controller on a Phase 6 motorized hinge (closed-loop reaches setpoint;
  analytic tolerance documented); steering agents in a bounded arena with physics
  obstacles; determinism goldens NOT needed (no new solver state) — §33 checksum
  stability with steering active asserted instead.
- **WP-8.5 [S] Phase 8 exit** — independent verifier, plan-defined criterion,
  fix nothing. (No new example site: §111 is engine-internal; the demo lives in the
  suite. Owner may request a visual demo later — recorded.)

Dependencies: 8.1 ∥ 8.2 ∥ 8.3 (disjoint files); 8.4 ← all three; 8.5 last.

## 6h. Phase 9 — Particles (§27, §36, §112; decomposed 2026-08-02)

Exit (§112): ≥100,000 simple particles simulated and rendered at interactive rates on
suitable hardware — interpreted honestly for this environment: the CPU simulation
must step 100k particles within a fixed-step budget measured and documented in a
benchmark (not CI-gated on wall time; recorded numbers), and the renderer must draw
them via a batched path (one draw call), with a browser demo proving interactive
behavior at a size SwiftShader can sustain (documented; the 100k number measured
headlessly and in the benchmark, not asserted in CI pixels).

Phase-level pinned decisions:

- **P9-1 Tier.** CPU simulation ships (SoA Float32Array pools, zero per-frame
  allocation, seeded randomness only); **GPU compute simulation is STAGED** (dated:
  requires the WebGPU backend, which is itself a stub tier — §62 backlog) with the
  §36 "simulation: 'gpu'" option validated-out loudly. Collision options: MVP =
  §36's plane/ground collision only ("depth-buffer" and full solver coupling staged).
  Trails: MVP = position-history ribbon data (rendering via the sprite path; staged
  if dishonest — worker reports).
- **P9-2 Home.** `@fourjs/particles` (deps core/math/scene per §3.1). Force fields
  (§27's ForceField interface — sample(position, velocity, time, out)) ship in
  particles as the §27 built-in set MVP (uniform gravity, drag, wind, vortex, radial,
  turbulence via SeededRandom-driven curl noise — honest subset, report), reusable
  by motion later.
- **P9-3 Rendering.** A `ParticleRenderable` producing ONE batched render item
  (instanced quads or a single dynamic geometry — worker verifies what the §61
  renderer interface + webgl backend can honestly batch today; a new RenderItem kind
  may be needed — that is a cross-package API surface: keep it minimal and report).
- **P9-4 Determinism.** §36 emitters use SeededRandom; particle iteration insertion
  order; a determinism golden pins a 100-particle scenario.

Packets:

- **WP-9.1 [S] Particle core** (`@fourjs/particles`) — SoA pool, ParticleEmitter (§36
  options subset: maxParticles, emission rate/burst, lifetime, velocity
  distributions (seeded), color/size over lifetime curves), CPU integrator step,
  plane collision, force-field application; zero-alloc; unit tests + closed forms.
- **WP-9.2 [S] Force fields** (`@fourjs/particles`) — §27 interface + built-in set
  (P9-2), volume inclusion/filtering MVP; tests.
- **WP-9.3 [S] Particle rendering** (`@fourjs/render` + `@fourjs/render-webgl` +
  `@fourjs/particles`) — P9-3 batched path; fake-GL tests + structural render-item
  tests.
  _Dated note (2026-08-02, orchestrator, P9-3 governance):_ `ParticleRenderable`
  cannot subclass `Renderable` — the frozen §3.1 matrix gives `particles` only
  core/math/scene, and `particles`/`render` share a wave. The shipped seam is a
  duck-typed structural contract (`ParticleDrawable` declared in `@fourjs/render`,
  satisfied by `particles`' Node subclass; drift caught by tests, not the compiler —
  same shape as `SolverBodyAccess`). Accepted as a cross-package surface; the module
  header in `packages/render/src/particles.ts` carries the full rationale. Likewise
  accepted: WP-9.1's reproducible-swap-remove reading of P9-4 "insertion order"
  (layout is a deterministic function of history), and type-level absence as the
  rejection tier for §36's `simulation:"gpu"`/`collisions:"depth-buffer"`.
- **WP-9.4 [S] Integration + benchmark + gates** — ParticleSystem into the §39 loop;
  benchmarks/ harness measuring 100k CPU step time (recorded numbers, documented
  hardware caveat); determinism golden phase9 (100-particle scenario, cross-process);
  browser spec on a demo scene added to the playground OR a small fifth example
  (worker decides honestly against the §86/webServer cost — report; playground
  regions are gated, prefer a new tiny example page reusing the first-2d-scene
  non-wasm pattern).
- **WP-9.5 [S] Phase 9 exit** — independent verifier, the honest §112 reading above,
  fix nothing.

Dependencies: 9.1 → (9.2 ∥ 9.3); 9.4 ← 9.2+9.3; 9.5 last.

## 6i. Phase 10 — Replay, Snapshots, and Diagnostics (§33–34, §113; decomposed

2026-08-02)

Exit (§113): a physics defect can be captured, replayed, and inspected frame by
frame — made concrete: record a session (initial state + settings + seed + inputs by
step + step counts/dropped time per §34), replay it to bit-identical §33 checksums,
restore a mid-run snapshot and continue identically, and step/pause/slow-motion the
replay while reading diagnostic data (§113's visualization list ships as DATA
proveyors + a debug overlay MVP on the existing render path — full visual polish is
§118 flagship territory).

Pinned decisions:

- **P10-1 Home.** Recording/replay in `@fourjs/diagnostics` (deps core/math/scene —
  NOTE: it cannot import physics/motion (same-wave); the recorder therefore records
  through INTERFACES the app supplies (a `ReplayTarget` contract: checksum(),
  createSnapshot(), restoreSnapshot(), applyInput(step, payload)) — PhysicsWorld
  already satisfies the shape structurally (the established duck-type pattern);
  document per the §6h precedent).
- **P10-2 §34 format.** JSON envelope {formatVersion, adapterName/Version, seed?,
  fixedDeltaTime, initialSnapshot (base64), inputs: [{step, payload}...], stepCounts/
  droppedTime per frame, periodicSnapshots?: [{step, data}], finalChecksum}; replay
  refuses mismatched adapter/version (§34).
- **P10-3 Inspection.** A `ReplayPlayer` driving the scheduler manually: play/pause/
  stepOnce/speed (slow motion = timeScale on the replay clock)/seekToStep (nearest
  periodic snapshot + re-simulate); diagnostics overlay MVP = a DebugDrawSource
  contract emitting line/point primitives (contacts, joint anchors, center-of-mass,
  velocity vectors from SolverBodyAccess reads + §29 events; solver statistics as
  data) rendered via a "debug-lines" render item OR reusing unlit geometry —
  worker verifies what is honest; visualization completeness is data-first.
- **P10-4 Gates.** Determinism golden phase10 (record → replay bit-identity,
  cross-process); no new example site (the §113 exit is provable headless + the
  existing five sites; a debug-overlay browser assertion MAY ride an existing spec if
  cheap — worker reports).

Packets: **WP-10.1 [S]** Recorder + §34 format + ReplayTarget contract
(@fourjs/diagnostics; fake-target unit tests). **WP-10.2 [S]** ReplayPlayer +
inspection controls (+ integration with the real Application/scheduler).
**WP-10.3 [S]** Debug-draw data providers + overlay MVP (render seam per P10-3).
**WP-10.4 [S]** Integration + phase10 golden: record a Rapier scenario with scripted
inputs → replay bit-identical → mid-run snapshot restore → frame-step inspection;
the §113 exit demonstrated end-to-end. **WP-10.5 [S]** exit verifier.
Dependencies: 10.1 → 10.2 ∥ 10.3; 10.4 ← both; 10.5 last.

## 6j. Phase 11 — Assets, Serialization, UI, and Tooling (§113a; decomposed 2026-08-02)

Exit (§113a): a scene can be saved, reloaded, and benchmarked, and the §120 tooling
list is complete — MVP tiers throughout; the website/guides half of §93 delivers as
in-repo documentation (typedoc API reference already lives; a public website is a
deployment/owner step per the POSITIONING precedent).

Pinned decisions:

- **P11-1 Serialization MVP** (`@fourjs/serialization`, deps core/math/scene): a JSON
  scene format {formatVersion, nodes (tree: id/name/transform/authority), components
  by typeName with per-type serializers registered via a `ComponentSerializer`
  registry (the §6a typeName registry is the natural key)} + §80 migration hooks
  (formatVersion + registered migration steps). Physics/animation component
  serializers live where the components live? NO — matrix forbids; the REGISTRY
  pattern lets each package register its own serializer at app level; Phase 11 ships
  the registry + scene/transform/PoseTarget serializers + ONE cross-package reference
  registration (RigidBody/Collider) done at the tests/app layer. Round-trip
  save→load→§33-checksum-relevant state equality is the gate.
- **P11-2 Assets MVP** (`@fourjs/assets`, deps core): AssetManager {load(url, loader),
  cache, refcounts, dispose; structural fetch injection for testability}; loaders:
  JSON, text, binary (ArrayBuffer), image (structural ImageBitmap-like — browser
  gated). glTF (§76-78) is STAGED with a dated note (a real glTF pipeline needs the
  §55 texture tier + materials beyond unlit — dishonest to ship as a stub).
- **P11-3 UI MVP** (`@fourjs/ui`, deps core/math/scene/input/text): retained-mode
  Panel/Label/Button over the existing sprite/text path with §72 pointer routing;
  accessibility MIRROR staged with a dated note (needs DOM integration policy).
  Enough §73-75 to prove the layer composes; completeness staged.
- **P11-4 Benchmarks** (`benchmarks/`): the harness pattern from particles-100k
  generalized — a runner + per-suite scripts (math ops, scene propagation, physics
  step, animation sampling) writing results JSON records (measured-not-gated); §86
  table rows measured where honest.
- **P11-5 §120 tooling list**: audit §120 against reality; anything unshipped gets a
  dated staged note in the plan — the exit's "complete" reads as
  "shipped-or-staged-with-note", consistent with every prior phase.

Packets: **WP-11.1 [S]** serialization (P11-1). **WP-11.2 [S]** assets (P11-2).
**WP-11.3 [S]** UI MVP (P11-3). **WP-11.4 [S]** benchmarks harness (P11-4) + §120
audit doc (docs/AUDIT-120.md). **WP-11.5 [S]** integration: save→reload→checksum
round trip on a Rapier scene + a UI browser assertion riding an existing spec or a
tiny addition (worker reports). **WP-11.6 [S]** exit verifier (§113a verdict + a
WHOLE-PLAN completion audit: every phase closed, every § component
shipped-or-staged, tracking files coherent).
Dependencies: 11.1 ∥ 11.2 ∥ 11.3 ∥ 11.4 (disjoint packages/dirs); 11.5 ← 11.1+11.3;
11.6 last.

## 7. Phases 3–10 — rolling-wave planning

Decomposed by the orchestrator only when the predecessor phase closes, in this packet
format, under the §2 governance rule (owner RFC for new unpinned cross-package API
surfaces). Scope and anchors are fixed; exits are spec-quoted except where noted.

| Phase | Scope (spec)                                                                        | Exit criterion                                                                                        | Notes / likely seams                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3     | Renderer interface, WebGL 2 backend, cameras, viewports (§61–62, §47–48, §106)      | Moving 2D/3D primitives render smoothly despite fixed-step simulation                                 | interface / context-loss (§61) / projections (D8) / render list / buffers / interpolation-aware draw; camera+viewport types live in `@fourjs/scene` (§98 rev 1.3); **revisit the size gate** — real example replaces placeholder. **GPU in CI:** browser tests run Playwright against the pre-installed Chromium with SwiftShader (software GL) for WebGL 2; visual baselines are per-backend with perceptual tolerance (§92) |
| 3a    | Input, picking, dragging, sprites, MVP-tier text (§106a; §71–72, §55, §56 MVP tier) | Pointer events, picking, dragging, sprites, and labels work in a mixed 2D/3D example                  | input routing / picking strategies / sprite batching / SDF Latin text; Playwright setup lands here; **exit ships a public demo** (demo-first, TODO 2026-07-29)                                                                                                                                                                                                                                                                |
| 4     | Tween, easing, Timeline, clips/tracks, bindings (§15–17, §107)                      | Any numeric/vector/quaternion/color/transform property animatable                                     | easing table / tween core / timeline+markers (§16 semantics incl. replay/restore) / tracks / binding resolution                                                                                                                                                                                                                                                                                                               |
| 5     | Physics API + Rapier adapter (§20–32, §37, §108)                                    | Mixed 2D/3D demo: gravity, collisions, impulses, sensors via common API                               | descriptors / world API / §37 contract incl. `drainEvents` + capabilities / rapier2d+3d wasm (pins per MEMORY) / event normalization / sync into the WP-2.6 pose store; §33 checksum reuses WP-1.13                                                                                                                                                                                                                           |
| 6     | Joints (§28, §109)                                                                  | Constraints remain stable under expected real-time loads                                              | per-joint packets / motors+limits / break thresholds                                                                                                                                                                                                                                                                                                                                                                          |
| 7     | Physics-animation blending (§19, §42, §110)                                         | Animated↔kinematic↔physical control without abrupt discontinuities                                    | `blended` authority (unlocks WP-2.3's reserved value) / pose pipeline / ragdoll                                                                                                                                                                                                                                                                                                                                               |
| 8     | Advanced motion (§111)                                                              | **Plan-defined, owner to confirm** (§111 sets none): PID utility + steering demos pass analytic tests | steering / IK / PID                                                                                                                                                                                                                                                                                                                                                                                                           |
| 9     | Particles CPU+GPU (§36, §112)                                                       | ≥100k simple particles simulated and rendered at interactive rates on suitable hardware               | emitter model / CPU sim / GPU compute path                                                                                                                                                                                                                                                                                                                                                                                    |
| 10    | Replay, snapshots, diagnostics (§33–34, §113)                                       | A physics defect can be captured, replayed, inspected frame by frame                                  | snapshot API / §34 replay format (incl. step counts + dropped time) / §33 checksums via WP-1.13 / overlays                                                                                                                                                                                                                                                                                                                    |
| 11    | Assets, serialization, UI, benchmark harness, docs (§113a; §73–80, §92–93)          | Scene saves/reloads/benchmarks; §120 tooling list complete                                            | asset manager / glTF / scene format + migration / UI MVP subset / `benchmarks/` harness against §86 / guides + website; release workflow (Changesets) lands at first publish per §94 0.1                                                                                                                                                                                                                                      |

---

## 8. Verification stack

| Level              | Command                                                                 | Gate                     |
| ------------------ | ----------------------------------------------------------------------- | ------------------------ |
| Types + emit       | `pnpm build` (`tsc -b` via turbo)                                       | every packet             |
| Unit               | `pnpm turbo run test`                                                   | every packet             |
| Root suites        | `pnpm test:suites`                                                      | phase exits              |
| Lint               | `pnpm lint`                                                             | every packet             |
| Spec integrity     | `pnpm check-spec`                                                       | any docs-touching packet |
| Docs               | `pnpm run docs` (after build; bare `pnpm docs` is a pnpm builtin no-op) | Phase 0 on (CI)          |
| Example            | `pnpm example:build`                                                    | Phase 0 on (CI)          |
| Payload (§86)      | `pnpm size` — built example ≤ 150 kB gzip                               | Phase 0 on (CI)          |
| Determinism        | fresh-process double run vs committed golden hash (D6)                  | phase exits from 1 on    |
| Independent review | second agent, diff vs Reads + §1                                        | every [S] packet         |

Workers never widen scope, never install, never commit. When in doubt: stop and report.
