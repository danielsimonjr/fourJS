# Migration: TypeScript-on-Bun

**Status as of 2026-09-08 — the migration is DONE for the root.** The workspace root
runs **TypeScript 7.0.2 on Bun 1.4.2**, with no second compiler above it. What remains
is bounded and named below, and none of it blocks the root.

An earlier revision of this document said the opposite. It is kept honest by saying so:
it concluded _"we cannot yet run one TypeScript"_, because it had proved each half
separately and not yet put them together. Both halves landed on 2026-09-08.

> **What changed.** `typescript@6.0.3` had exactly **two** consumers — TypeDoc and
> typescript-eslint — so removing either alone left the other holding the root.
> **typescript-eslint was replaced by Oxlint**, whose type-aware mode _requires_
> TypeScript 7; **TypeDoc was isolated** into a workspace package that owns its own
> compiler. Neither on its own would have moved the root.

| Layer              | Before                                                     | Now                                                 |
| ------------------ | ---------------------------------------------------------- | --------------------------------------------------- |
| Package manager    | Bun 1.4.2                                                  | unchanged                                           |
| Type check + build | TS 7.0.2                                                   | unchanged                                           |
| **Lint**           | ESLint 9 + typescript-eslint (**pinned root to TS < 6.1**) | **Oxlint + oxlint-tsgolint (requires TS 7)**        |
| **API docs**       | TypeDoc at root (**pinned root to TS ≤ 6.0**)              | **`tools/docs` workspace package, TS 6.0.3 nested** |
| Root `typescript`  | 6.0.3                                                      | **7.0.2, and nothing constrains it**                |
| Test runner        | Vitest 3.2.7                                               | **Vitest 5.0.0** — see section 5                    |

Everything below is measured on this repository. Commands to re-measure are in
[section 7](#7-how-to-re-measure).

---

## 1. What "TypeScript-on-Bun" actually means

The phrase covers five independent layers. They are usually said in one breath, but
they succeed and fail separately, so this document scores them separately.

| #   | Layer                            | Today              | Can Bun own it?                         |
| --- | -------------------------------- | ------------------ | --------------------------------------- |
| L1  | **Package manager / workspaces** | Bun 1.4.2          | **Yes — already does**                  |
| L2  | **Type checking**                | TypeScript 7.0.2   | not Bun's job — this is `tsc`           |
| L3  | **Library build (JS + `.d.ts`)** | `tsc -b`, TS 7.0.2 | **No** — section 4.1                    |
| L4  | **Test runner**                  | Vitest 5.0.0       | **No** — section 4.2                    |
| L5  | **Example bundling**             | Vite 8             | **Probably — but do not** — section 4.3 |

A sixth concern, **API docs and lint**, is not Bun's business at all — but it was the
thing pinning the second TypeScript, and it is now resolved: lint moved to Oxlint
(section 4a) and TypeDoc was isolated (section 3.1b). **L1 and L2 are done; L3, L4 and
L5 stay on `tsc`, Vitest and Vite by choice, for the reasons in section 4.**

---

## 2. What is already done (2026-09-08)

**The root migration is complete.** Landed in three steps on one day:

1. **TypeScript 7.0.2 + Bun 1.4.2** for build and type-check.
2. **Oxlint replaced ESLint + typescript-eslint** — the linter stopped being a TS 7
   blocker and became a TS 7 _consumer_.
3. **TypeDoc moved to `tools/docs`** with its own `typescript@6.0.3`.

Result: `bun install --frozen-lockfile` resolves root `typescript` to **7.0.2** and
`tools/docs/node_modules/typescript` to **6.0.3**, and every gate is green.

- **TypeScript 7.0.2** builds and type-checks the library.
- **Bun 1.4.2** locally, in `packageManager`, in `engines`, and in all five
  workflows. Before this, local ran 1.4.0 while CI ran 1.4.2 — every local gate ran
  on a different runtime from the one that gated merges.

Evidence, taken from a clean tree rather than from an exit code:

| Check                              | Result                                 |
| ---------------------------------- | -------------------------------------- |
| Packages built from scratch        | **24**                                 |
| Emitted                            | **315 `.js` + 315 `.d.ts`**            |
| Suite against TS-7-built artifacts | **7,246 tests / 282 files, 0 failing** |
| Injected type error (`TS2322`)     | **Caught, correct line**               |
| CI (Linux), Docs, Release          | **All green**                          |

The injected-error check matters. A compiler that silently checks nothing also exits
zero. This green is a real check.

---

## 3. The root cause: TypeScript 7 removed the compiler API

_(This section explains the constraint that shaped everything above. It is no longer
a blocker for this repository — it is why the solution has the shape it does.)_

TypeScript 7 is the **Go port**. It is not TypeScript 6 plus features. It is a
different program that accepts the same language.

The problem is visible in one line of the published package — its `"."` export:

```
"exports": {
  ".":               "./lib/version.cjs",     <-- the whole JS API is now a version string
  "./unstable/ast":  "./dist/ast/index.js",
  "./unstable/sync": "./dist/api/sync/api.js",
  ...
}
```

`typescript@7.0.2` is **2.4 MB** and ships **per-platform Go binaries** as optional
dependencies (`@typescript/typescript-win32-x64`, `-linux-x64`, and 18 more). Its
`bin` contains **only `tsc`** — there is no `tsserver`. There is no
`import ts from "typescript"` giving `ts.createProgram`, `ts.SyntaxKind` or
`ts.PropertyDeclaration`. Those now sit behind `unstable/*` entry points, with a
different shape and a stability warning in the path name itself.

**Every type-aware tool consumes that deleted API.** They therefore do not warn or
degrade. They crash or refuse:

| Tool                  | Version          | Result on TypeScript 7.0.2 | Failure                                                                          |
| --------------------- | ---------------- | -------------------------- | -------------------------------------------------------------------------------- |
| **TypeDoc**           | 0.28.20 (latest) | crash                      | `TypeError: Cannot read properties of undefined (reading 'PropertyDeclaration')` |
| **typescript-eslint** | 8.70.0 (latest)  | refuses                    | `Error: typescript-eslint does not support TS 7.0.`                              |

Both lines were produced by running the tools against this repository. Neither is a
guess, and neither is a peer-range warning. `typescript-eslint` ships a
purpose-built error message for TypeScript 7, which is a stronger signal than any
version range: the maintainers know, and their answer is "not yet".

### 3.1 Why the peer ranges are not the real constraint

It is tempting to read this as a version-range problem:

```
typedoc@0.28.20          peers typescript: "5.0.x || ... || 5.9.x || 6.0.x"
typescript-eslint@8.70.0 peers typescript: ">=4.8.4 <6.1.0"
```

That reading produced the previous, wrong policy in `COMPATIBILITY.md` — _"do not
lift the pin until TypeDoc accepts 7.x"_ — which put this library's compiler on
another project's release schedule.

**A peer range constrains the tool, not the compiler that builds the library.** The
ranges are a symptom. The deleted API is the cause. Widening a range changes
nothing, because the call still throws.

### 3.1a TypeDoc's own timeline, and why waiting is not a plan

**Researched 2026-09-08.** [TypeStrong/typedoc#3098](https://github.com/TypeStrong/typedoc/issues/3098)
is **open**, with no fix and no date. The maintainer's own account of the work:

- TypeScript 7's API is _"a complete rewrite"_, and TypeDoc _"heavily depends on some
  internal features in TypeScript 6 which are not present in the TypeScript 7 API"_ —
  so this is not a peer-range bump, it is a port.
- The plan is a **feature freeze** once TS 7.0 ships, then the port.
- _"There is no timeline for how long this will take"_, as the work happens _"during
  free time on weekends, usually an hour or two per week."_

Depending on **internal** APIs is the important detail. Those carry no compatibility
promise even between minor versions, so there is no shortcut and no shim.

**Conclusion: "wait for TypeDoc" is an open-ended bet, not a schedule.** If a single
root TypeScript is ever a hard requirement, TypeDoc has to be isolated or replaced.

### 3.1b Isolating or replacing the docs step

Two options exist, and one is already proven by a shipping package:

1. **Isolate TypeDoc with its own nested TypeScript.** `@microsoft/api-extractor`
   demonstrates the pattern: it declares `typescript: 5.9.3` as a **direct
   dependency**, not a peer, so it resolves its own compiler and constrains nothing
   above it. Moving TypeDoc into its own workspace tool package with
   `typescript@6.0.3` as a direct dependency would free the root entirely.
2. **Replace TypeDoc with API Extractor + API Documenter.** These consume the
   emitted `.d.ts` rather than the source graph, and bundle their own TypeScript by
   construction — so they are immune to the root compiler version.

**What about `bunx`, and does Bun have its own docs generator?** Both asked and both
answered by measurement on 2026-09-08.

**Bun ships no documentation generator.** Checked three ways: `bun --help` on 1.4.2
lists 24 commands and none generates docs; `bun pm --help` has 11 subcommands and none
is doc-related; [Bun's own documentation](https://bun.com/docs) covers runtime, package
manager, test runner and bundler, and no docgen. The doc-generation work in the Bun repo
([#18024](https://github.com/oven-sh/bun/pull/18024),
[#19024](https://github.com/oven-sh/bun/pull/19024)) points the other way — it makes
Bun's own types _consumable by_ an external generator. **Bun is not in this race**, so
the isolation below is not a stopgap waiting for it to catch up.

> ⚠ **A test that lied.** Running `bun docs` did **not** error — it ran this repo's own
> `docs` **script**, because Bun falls back to `package.json` scripts for unknown
> commands. That "success" said nothing about a built-in. Use `bun --help`, not the
> absence of an error.

**`bunx` genuinely can isolate — but not here, and not for a gate.** In a clean
directory it resolves the peer correctly, auto-installing a satisfying compiler:

```
$ bunx typedoc --version
TypeDoc 0.28.20
Using TypeScript 6.0.3 from .../bunx-74065123-typedoc@latest/node_modules/typescript
```

Inside this repository the bare command **crashes** on `PropertyDeclaration`. Bun's docs
state the rule — `bunx` _"checks for a locally installed package first, then falls back
to auto-installing it from npm"_ — and Bun hoists the `tools/docs` TypeDoc to the root
`node_modules`, where it resolves the root's TypeScript 7.

**An explicit version bypasses that, and it works.** Measured in this repository:

```
$ bunx typedoc@0.28.20 --version
TypeDoc 0.28.20
Using TypeScript 6.0.3 from .../bunx-74065123-typedoc@0.28.20/node_modules/typescript
```

So `bunx typedoc@<version>` is a **real alternative** to the `tools/docs` package, not a
dead end — an earlier draft of this section said the version was unpinnable, which was
wrong. Three reasons `tools/docs` is still the better instrument for a **gate**:

1. **Not covered by `bun.lock`.** The gate's compiler would be resolved outside the
   lockfile, so `--frozen-lockfile` proves nothing about it.
2. **Needs the network on a cold cache.** CI would fetch TypeDoc and a TypeScript on
   every fresh runner.
3. **The peer resolution that makes it work is undocumented.** Bun's `bunx` page
   describes local-first resolution, pinning and caching, but says nothing about peer
   dependencies. That it picks 6.0.3 is an observation, not a contract — and a silent
   change there would break docs with no version bump to point at.

`tools/docs` is pinned, lockfile-covered, offline-reproducible and auditable. `bunx
typedoc@0.28.20` is the right tool for a **one-off local run** when you want the docs
without the repo's own wiring.

> **Footgun, recorded because the error message does not explain itself:** typing
> `bunx typedoc` at the repository root fails with
> `Cannot read properties of undefined (reading 'PropertyDeclaration')`. Nothing is
> broken — it is the hoisted TypeDoc meeting the root's TS 7. **Use `bun run docs`**,
> which runs in the `tools/docs` working directory and resolves the nested 6.0.3.

**Option 1 was tested on this repository on 2026-09-08, and it works.** This is no
longer a sketch:

- A workspace package `tools/docs-isolated` declaring `typedoc@0.28.20` +
  `typescript@6.0.3` as its own dependencies.
- Root moved to `typescript@7.0.2` with TypeDoc removed from it entirely.
- Bun nested the conflicting version rather than hoisting it: root resolved
  **7.0.2**, the tool package resolved **6.0.3**.
- The nested TypeDoc, run against the repo's real `typedoc.json`, produced
  **exit 0, 0 errors, 24 warnings** and generated the HTML — **identical to the
  current baseline**.

So the TypeDoc blocker is solvable today, at the cost of one small tool package.

**But isolating TypeDoc alone buys nothing**, and that is the part worth
understanding before scheduling it. With TypeDoc isolated and the root on TS 7,
the root immediately fails elsewhere:

```
typescript-eslint does not support TS 7.0.
```

`typescript@6.0.3` has **two** consumers. Removing one leaves the other holding the
root exactly where it was. **The two changes only pay off together:**

| Change                                 | Alone                                  | Together                               |
| -------------------------------------- | -------------------------------------- | -------------------------------------- |
| Isolate TypeDoc (proven, section 3.1b) | root still pinned by typescript-eslint | ←                                      |
| Swap to Oxlint (proven, section 4a)    | root still pinned by TypeDoc           | **root becomes TypeScript 7.0.2 only** |

Combined, `typescript@6.0.3` disappears from the root entirely and survives only
inside one isolated docs tool. Both halves are independently verified on this
repository; neither has been landed, because the Oxlint half is a gate-semantics
change that needs a rule-parity diff and an explicit decision.

### 3.2 The consequence: one root compiler, one isolated one

| Where                                | Version   | Serves                                                             |
| ------------------------------------ | --------- | ------------------------------------------------------------------ |
| root `typescript`                    | **7.0.2** | `bun run build`, every `typecheck:*`, and Oxlint's type-aware mode |
| `tools/docs/node_modules/typescript` | **6.0.3** | TypeDoc, and nothing else                                          |

An earlier arrangement installed TypeScript 7 under an alias (`ts7`) alongside a root
`typescript@6.0.3`, because two tools needed the old API. That alias is **gone** — with
Oxlint in place and TypeDoc isolated, the root name is free, and keeping the same
package installed twice under two names was a second source of truth.

**Every `tsc` call still names its compiler by path** (`node
../../node_modules/typescript/bin/tsc`). That is not left over from the alias: a
workspace member can hoist a `tsc` binary, so `node_modules/.bin/tsc` is not
guaranteed to be the root's. Naming the path is what makes the compiler a decision
rather than an install-order accident — which it silently was on 2026-09-08, when the
build ran on TypeScript 7 while `typescript` resolved to 6.0.3.

### 3.3 Two compilers over one source will diverge, so that is gated

Running two compilers over the same code creates a second source of truth about
types. It must be watched, not trusted. `typecheck:ts6` is a CI gate for exactly
this, and it found a divergence within minutes of existing:

> TypeScript **6.0.3** rejects `import "../first-2d-scene/main.ts"` with **TS5097**
> (_"An import path can only end with a '.ts' extension when
> 'allowImportingTsExtensions' is enabled"_). TypeScript **5.9.3 and 7.0.2 both
> accept it.**

Three section-93 example entries do this. Without the gate, the examples would have
quietly become TS7-only, and nobody would have learned until the next compiler move.
Fixed with `allowImportingTsExtensions` on the examples project, which is `noEmit`
and bundled by Vite.

### 3.4 A trap this created, worth knowing

Both packages ship a binary named `tsc`. `node_modules/.bin/tsc` is therefore
decided by **install order** — and it was pointing at TypeScript 7 while
`typescript` resolved to 6.0.3. The build had already switched compilers by
accident rather than by decision.

Every `tsc` invocation now names its compiler by path
(`node ../../node_modules/ts7/bin/tsc`). Nothing uses the ambiguous shim.

---

## 4. Why Bun does not own the build, tests, or bundling

### 4.1 L3 — `bun build` cannot emit `.d.ts` (hard blocker)

fourJS is a **library**. Its product is not only JavaScript. It is JavaScript plus
**315 declaration files** that every consumer's editor and type-checker reads.

`bun build --help` lists **60 flags**. **None emits declarations.** There is no
`--dts` and no `--declaration`.

The build is also not a flat transpile. `tsconfig.base.json` sets
`"composite": true`, and **22 of 24 packages declare `references`**, so `tsc -b`
builds a dependency-ordered project graph and reuses prior outputs. Bun has no
equivalent.

**Verdict: blocked today, but the gap is smaller than it looks.** This paragraph
originally read "not by a small gap". That was wrong, and is corrected here after
measuring rather than reasoning.

There is a real path, and it does not wait on Bun. `oxc-transform`, `tsdown` and
`rolldown-plugin-dts` all emit declarations from **`isolatedDeclarations`** — a mode
that needs no type-checker, only explicit annotations at the module boundary. So the
question is not "can Bun emit `.d.ts`" but "does this codebase satisfy
`isolatedDeclarations`". Measured across all 24 packages with TypeScript 7:

| Result                         | Count                               |
| ------------------------------ | ----------------------------------- |
| Packages already **clean**     | **9** (including `core` and `math`) |
| Packages with violations       | 15                                  |
| **Total violations repo-wide** | **107**                             |

Worst offenders: `render-webgpu` (28), `physics` (19), `geometry` (16), `ui` (9).
Almost all are missing explicit return types — mechanical, not architectural.

The honest verdict: **about 107 annotations stand between this repo and a tsc-free
declaration emit.** That is a bounded task, not a blocker.

Whether it is worth doing is a different question, and the answer today is probably
no. `tsc -b` under TypeScript 7 already builds a package in **211–401 ms**, which is
where the speed people expect from Bun actually arrived. Project references are still
tsc-only. The case for switching is thinner than the case for keeping it.

### 4.2 L4 — `bun test` is not a drop-in for this suite (blocked today)

Bun's runner is genuinely fast and _partly_ compatible. Measured, not assumed:

| Package         | `bun test` result             |
| --------------- | ----------------------------- |
| `packages/math` | **209 pass, 0 fail, 115 ms**  |
| `packages/core` | **186 pass, 29 fail, 305 ms** |

The failures are a **missing API surface**, not broken tests:

| Missing API           | Failures caused | Uses in this repo |
| --------------------- | --------------- | ----------------- |
| `vi.unstubAllGlobals` | 29              | **22**            |
| `vi.stubGlobal`       | 9               | **24**            |
| `vi.resetModules`     | 1               | **22**            |

**375 test files** import from `vitest`. `vi.spyOn` (194 uses) and `vi.fn` (73 uses)
do work. The global-stubbing and module-registry APIs do not.

A second obstacle is larger, and no shim fixes it: **`bun test` has no coverage
thresholds.** It offers `--coverage`, `--coverage-reporter` and `--coverage-dir`,
and nothing that fails a build on a number. fourJS gates on a deliberate two-tier
rule: **95% package aggregate** plus an **80% per-file floor**. Moving to `bun test`
would silently delete that gate. That is a downgrade wearing a speed improvement.

**Verdict: blocked** on `stubGlobal` / `unstubAllGlobals` / `resetModules`, and on
coverage thresholds. The first three are plausible near-term Bun features. The
fourth is a design gap.

### 4.3 L5 — Vite is the replaceable one

The example configs are thin. `examples/first-2d-scene/vite.config.ts` is:

```ts
export default defineConfig({
  define: { __FOUR_DEV__: "false" },
  build: { outDir: "dist" },
});
```

`bun build` has `--define` and an output directory. Nothing here needs Vite's plugin
system.

**Verdict: probably possible, and not recommended now.** This is the layer with the
least to gain — these are demos, not the shipped artifact — and moving it would cost
the 14 examples' browser gate a known-good bundler. It is the only layer where the
answer is "we could, and chose not to."

### 4.4 What is _not_ a blocker

Stated so that nobody re-investigates them:

- **The codebase itself.** TypeScript 7 type-checks every project with **zero
  errors**. No syntax, library type, or `lib` setting had to change.
- **Windows.** The TypeScript 7 Go binary runs natively;
  `@typescript/typescript-win32-x64` resolves.
- **Linux CI.** Verified green, including the per-platform binary and the explicit
  relative compiler path.
- **Vitest's version.** Vitest declares **no `typescript` peer**. It was never
  blocked by TypeDoc, despite a tracker row that said so for months.

---

## 4a. Oxlint: the one blocker with a real, available answer

**Researched and tested on this repository, 2026-09-08.** Of the three blockers,
exactly one has a shipping alternative today, and it inverts the problem rather than
working around it.

`typescript-eslint` cannot run on TypeScript 7. **Oxlint's type-aware mode
_requires_ TypeScript 7.** It is powered by `oxlint-tsgolint`, described by its own
package as _"High-performance type-aware TypeScript linter powered by
typescript-go"_ — and `typescript-go` **is** TypeScript 7. Its version line
(`7.0.2001`) tracks the compiler it binds to.

So swapping the linter does not merely tolerate the migration. **It removes one of
the two reasons `typescript@6.0.3` is installed at all.**

### 4a.1 What was verified here, not read

| Question                                      | Result                                                                                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Does type-aware linting actually work?        | **Yes** — an injected `JSON.parse("{}")` misuse is caught as `typescript(no-unsafe-call)` and `no-unsafe-member-access` at the right positions |
| Rule coverage vs typescript-eslint            | **59 of 61** type-aware rules (upstream docs)                                                                                                  |
| Whole-repo run, no type-awareness             | **4.4 s**                                                                                                                                      |
| Whole-repo run, **with** `--type-aware`       | **13 s**                                                                                                                                       |
| Current `bun run lint` (eslint, type-checked) | **3 min 56 s**                                                                                                                                 |
| False alarms against this codebase            | **none** — the 27 findings all came from rules this repo does not enable, and each was inspected                                               |

That is roughly **18x faster with type-awareness on**, and **53x** without.

### 4a.2 The three repo-specific guards all survive

`eslint.config.js` is lean — `recommendedTypeChecked` plus two custom rules — but
those two rules are load-bearing. Each was reproduced in Oxlint and verified against
a probe file:

| Guard                | Why it exists                       | Oxlint                        |
| -------------------- | ----------------------------------- | ----------------------------- |
| ban `Date.now`       | §33/§34 determinism                 | ✅ `no-restricted-properties` |
| ban `Math.random`    | §33/§34 determinism                 | ✅ `no-restricted-properties` |
| ban `export default` | named exports only (plan §1 rule 7) | ✅ `import/no-default-export` |

### 4a.3 The one genuine gap

**Oxlint does not implement `no-restricted-syntax`.** This is not inference — Oxlint
says so itself when the rule appears in a config:

```
Failed to parse oxlint configuration file.
  x Rule 'no-restricted-syntax' not found in plugin 'eslint'
```

This repo uses that rule for exactly one thing: banning `ExportDefaultDeclaration`.
`import/no-default-export` covers it, and covers it **better** — a purpose-built rule
rather than a raw AST selector. So the gap is real but does not bite here.

It would bite a config that used `no-restricted-syntax` for arbitrary AST patterns.
Check before assuming this transfers to another repository.

### 4a.4 What was landed, and the parity evidence

**Adopted 2026-09-08.** ESLint and typescript-eslint were removed from the repository;
`.oxlintrc.json` replaces `eslint.config.js`. The swap was treated as a
gate-semantics change, so parity was established before the old config was deleted:

| Parity check                                                              | Result                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------- |
| `recommendedTypeChecked` rules reproduced                                 | **47 of 47** — every rule name accepted by Oxlint |
| Rules **mutation-verified** (a real violation injected, must be reported) | **16**, covering every type-aware rule in use     |
| Findings on the tree, old config                                          | 0 errors                                          |
| Findings on the tree, new config                                          | **0 errors**                                      |
| Lint wall-clock                                                           | **3 m 56 s → 13 s**                               |

The four scoped overrides in `eslint.config.js` are reproduced in `.oxlintrc.json`:

| Override                                        | Why it exists                            | Ported as                                            |
| ----------------------------------------------- | ---------------------------------------- | ---------------------------------------------------- |
| `disableTypeChecked` for `**/*.js,mjs,cjs`      | plain JS has no types to check           | 43 `typescript/*` rules `"off"` for those globs      |
| `no-restricted-properties` off in `**/tests/**` | tests may use `Date.now` / `Math.random` | same override                                        |
| `no-restricted-syntax` off in `*.config.*`      | tooling configs need default exports     | `import/no-default-export` off                       |
| `disableTypeChecked` for `examples/**`          | examples were outside every tsconfig     | not needed — `examples/tsconfig.json` types them now |

**The JS override is the one that mattered, and it was found by measurement rather
than by reading.** Omitting it produced **1,612 findings**, 97% of them `no-unsafe-*`
in `tools/*.mjs` and `benchmarks/*.mjs` — plain JavaScript being type-linted with no
types. With it: **0 errors**. A port that had been eyeballed rather than run would
have shipped that.

**One deliberate difference from ESLint.** Oxlint's default `correctness` category
enables rules `recommendedTypeChecked` did not, which originally surfaced **42
warnings**. **Triaged 2026-09-09 to zero:** real findings were fixed (`Array.from`,
`localeCompare`, computed quaternion `w`, a JSDoc that contained `*/`); deliberate
test/tool probes were explicitly allowed (`no-self-assign` on the rigid-body
no-op-write test, `no-control-regex` on NUL-delimited guide slots,
`no-unsafe-optional-chaining` off under `**/tests/**`). `bun run lint` is clean.

**The one genuine gap remains `no-restricted-syntax`**, which Oxlint does not
implement. It was used here for exactly one thing — banning `export default` — and
`import/no-default-export` covers that better. A repo using it for arbitrary AST
selectors would not port this cleanly.

---

## 5. Adjacent finding: the coverage gate is partly illusory

While testing whether Vitest 5 could land (3.2.7 is two majors behind 5.0.0), the
runner half proved clean: **all 7,246 tests pass on Vitest 5**, plus `test:suites`,
with no API breakage.

What blocks that bump is the coverage gate — and **the gate is what turned out to be
wrong**. Vitest 4 and later remap V8 coverage accurately; Vitest 3 over-reports.
Proven on one file rather than asserted:

> `packages/render/src/resource-warnings.ts` reports **100% under Vitest 3** and
> **66.66% statements under Vitest 5**. The file contains `if (!DEV) return;`, and
> **no test sets `DEV` false**. 100% was impossible. Vitest 3 was over-reporting.

Under honest measurement, six thresholds fail across five packages: global branch
coverage in **physics (92.1%)**, **render-webgl (92.1%)** and **text (94.64%)**,
plus per-file failures in `physics-rapier/src/init.ts`,
`render/src/resource-warnings.ts` and `render-webgl/src/gl-particles.ts`.

**Do the coverage work first; the Vitest bump then falls out for free.** Bumping
first converts a real quality gap into a red build with no owner.

**Landed 2026-09-09.** The five-package campaign closed every honest gap
without lowering the 95% gate. Re-measured under Vitest 5.0.0:

| Package        | Branches         |
| -------------- | ---------------- |
| physics        | 97.27%           |
| render-webgl   | 95.57%           |
| text           | 100%             |
| render         | 97.59%           |
| physics-rapier | 95.26% (724/760) |

`physics-rapier` was the last holdout among those five. The remaining
adapter misses are unreachable through a well-formed public API
(`localContactPoint` null, `colliderIds` that do not resolve). The tests
that got the package over the line go through a rewritten snapshot
envelope — the only way a Rapier collider or mass mode can exist on one
side of the boundary and not the other. `vitest` and `@vitest/coverage-v8`
are both 5.0.0.

**Same-day CI follow-up.** The campaign only re-measured the five named
failures. `bun run coverage` then failed on **`@fourjs/particles` at
92.1% branches** (455/494) — ramp-stop validation, empty/NaN lifetime
ramps, trail store guards, and `computeBounds` non-positive lifetime
were real misses. Re-measured **97.16% (480/494)**. Gate unchanged.

---

## 6. What is left, and what unblocks it

The root is done. Three items remain, none of which blocks it:

| Item                                 | Status                                                 | Unblocked when                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Drop `typescript@6.0.3` entirely** | isolated in `tools/docs`; costs one dependency         | TypeDoc ships TS 7 support ([#3098](https://github.com/TypeStrong/typedoc/issues/3098), open, no timeline) — or is replaced by API Extractor, which bundles its own compiler |
| **Vitest 3 → 5**                     | **done 2026-09-09** — both packages at 5.0.0           | —                                                                                                                                                                            |
| **Triage the 42 Oxlint warnings**    | **done 2026-09-09** — 0 warnings                       | —                                                                                                                                                                            |
| `bun build` replaces `tsc -b`        | possible, ~107 `isolatedDeclarations` annotations away | not recommended — `tsc -b` on TS 7 builds a package in 211–401 ms and project references are tsc-only                                                                        |
| `bun test` replaces Vitest           | blocked                                                | three `vi.*` APIs (68 uses) exist **and** `bun test` can fail a build on a coverage threshold                                                                                |

The Vitest bump and the Oxlint triage are done. What remains is other
projects' roadmaps or deliberate choices.

---

## 7. How to re-measure

Do not trust this document's numbers after the tools move. A measurement expires
when its instrument changes.

```bash
# Which TypeScript is where
node -p "require('./node_modules/typescript/package.json').version"              # root -> 7.0.2
node -p "require('./tools/docs/node_modules/typescript/package.json').version"   # docs -> 6.0.3

# Does TypeScript 7 still type-check everything?
bun run typecheck:tests && bun run typecheck:examples && bun run typecheck:config

# Do the two compilers still agree? (the isolated 6.0.3 over the same projects)
bun run typecheck:ts6

# Lint, and its wall-clock
time bun run lint

# Docs still build from the isolated package?
bun run docs

# Can the root move off the second compiler yet?  (TypeDoc is the only holdout)
npm view typedoc peerDependencies --json

# Why a workspace package and not `bun add --dev typedoc`: a PEER resolves from the
# root, so bun satisfies it with the hoisted 7.0.2 and TypeDoc crashes. Reproduce:
#   bun add --dev typedoc && bunx typedoc   ->  Cannot read properties of undefined

# Can Bun emit declarations yet?
bun build --help | grep -iE "dts|declaration"

# How far off is bun test?
cd packages/core && bun test
```

---

## 8. Summary

**fourJS runs TypeScript 7.0.2 on Bun 1.4.2, with one compiler at the root.**

The migration turned on a single observation: `typescript@6.0.3` had **two**
consumers, so neither could be removed alone. Both were addressed on the same day —
the linter by **replacing** it with one that requires TS 7, the docs tool by
**isolating** it where its own compiler cannot constrain anything else.

What is deliberately _not_ Bun:

1. **The build stays `tsc -b`.** `bun build` cannot emit `.d.ts`, and a library ships
   315 of them. A tsc-free path exists (`isolatedDeclarations`, ~107 annotations away)
   but buys little — TS 7 already builds a package in 211–401 ms, and project
   references are tsc-only.
2. **The tests stay Vitest.** `bun test` lacks three `vi.*` APIs this suite uses 68
   times, and cannot fail a build on a coverage threshold. Losing that gate would be a
   downgrade wearing a speed improvement.
3. **The examples stay Vite.** Replaceable, and not worth the churn.

Each of those is a choice with a measured reason, not a blocker.
