# Benchmarks

Benchmark harness tracking the performance targets of §86 (e.g. 100k batched sprites @60fps,
50k batched shapes, 5k active rigid bodies, 25k CPU / 100k+ GPU particles, near-zero idle
work) and the metrics of §92: CPU/GPU/simulation time, draw calls, contacts, memory,
allocations, loading throughput.

**The harness landed in Phase 11 (§113a, plan §6j P11-4, WP-11.4).** `harness.mjs` is a
library — warm up, measure, reduce to order statistics, stamp the host, write one JSON
record, print a report — extracted unchanged in substance from `particles-100k.mjs`, the
Phase 9 script that was deliberately written without a framework until there was more than
one script to design around. A benchmark here is still a plain `node` script that imports a
handful of small functions; `run-all.mjs` drives every registered benchmark and is the whole of the
scheduling. (Until 2026-08-08 this paragraph read _"There is still no runner and no CI
integration"_; the runner landed with A-27's two CPU benchmarks, and **CI integration is
still absent** — see [The runner](#the-runner).)

```sh
bun run build               # every script imports the built dist, not src
bun run bench                   # runs every registered benchmark, one process each
node benchmarks/harness.mjs  # prints the suite index and how to run it
```

`node benchmarks/harness.mjs` runs nothing; it is the suite's index and the smoke test that
the module loads. The whole suite takes about **77 s** on the recorded host, dominated by
`physics-step.mjs` (~40 s) and `particles-100k.mjs` (~15 s).

| script                                                                                        | what it measures                                                                | §86 row                                                                                   |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [`shader-uniform-block.mjs`](shader-uniform-block.mjs)                                        | RFC 0001: individual versus std140 upload calls and payload bytes               | instrumented calls, no GPU timing claim                                                   |
| [`path-planning.mjs`](path-planning.mjs)                                                      | RFC 0007: A* on open and serpentine 65,536-node waypoint graphs                 | CPU planning; construction excluded                                                       |
| [`text-shaping-init.mjs`](text-shaping-init.mjs)                                              | RFC 0008: explicit WASM initialization and warm real-font shaping               | CPU initialization and shaping; no rasterization claim                                    |
| [`geometry-updates.mjs`](#geometry-updatesmjs--dynamic-webgl-geometry)                        | Geometry-cache GL call/object counts and CPU preparation, dirty/static controls | no GPU or FPS claim                                                                       |
| [`math-ops.mjs`](#math-opsmjs--7b-math-throughput-and-allocation)                             | `Vector3`/`Quaternion`/`Matrix4` throughput **and per-operation allocation**    | none — the foundation the rows sit on                                                     |
| [`scene-propagation.mjs`](#scene-propagationmjs--7-world-transform-resolution)                | `resolveWorldTransforms` over deep and wide trees, dirty and clean              | _idle scene_, for the scene graph                                                         |
| [`physics-step.mjs`](#physics-stepmjs--86s-5-000-active-rigid-bodies)                         | Rapier 3D fixed step at 500–5 000 **active** bodies                             | **active rigid bodies: 5 000 simple bodies baseline**                                     |
| [`animation-sampling.mjs`](#animation-samplingmjs--17-mixer-sampling)                         | `AnimationMixer.advance` over N instances of a 4-track clip                     | none — _animated glyphs_ is a text row, not a mixer row                                   |
| [`particles-100k.mjs`](#particles-100kmjs--112s-particle-budget-wp-94-phase-9)                | 100 000 CPU particles under a 3-field §27 stack                                 | **CPU particles** (at 4× §86's 25 000 baseline, per §112)                                 |
| [`ui-layout.mjs`](#ui-layoutmjs--86s-5-000-retained-ui-nodes-cpu-half)                        | `Panel.layout()` over 500–5 000 retained widgets, cold/incremental/warm         | **retained UI nodes: 5 000** — the layout-and-state half                                  |
| [`text-layout.mjs`](#text-layoutmjs--86s-20-000-animated-glyphs-cpu-half)                     | `layoutText` and §49 `Text` geometry at 1 000–50 000 drawn glyphs per frame     | **animated glyphs: 20 000** — both CPU halves (R-28, 2026-08-13)                          |
| [`text-layout.mjs`](#text-layoutmjs--86s-20-000-animated-glyphs-cpu-half)                     | `layoutText` at 1 000–50 000 drawn glyphs per frame                             | **animated glyphs: 20 000** — the layout half                                             |
| [`render-batching.mjs`](#render-batchingmjs--86s-batched-sprites-and-shapes-preparation-half) | render-list build plus §65 batch assembly at 5 000–100 000 nodes                | **batched sprites: 100 000** and **simple batched shapes: 50 000** — the preparation half |
| [`view-culling.mjs`](#view-cullingmjs--64s-per-view-lists-and-87s-frustum-cull)               | per-view list derivation and §87 culling at 10 000–100 000 nodes × 1–4 views    | none — §86 has no culling row; this measures a design decision                            |
| [`skinning-resolve.mjs`](#skinning-resolvemjs--rfc-0003-bones-as-nodes-and-180-channels)      | 60-bone resolve vs Groups (×1 / ×10) and 180-channel controller vs mixer        | **none yet** — proposes a skinned-mesh row from the measurement                           |
| [`pick-latency.mjs`](#pick-latencymjs--rfc-0005-id-pass-and-fence-vs-stall-pick)              | id-pass vs list (flagship-order + R-8) and fence-vs-stall pick                  | **none yet** — proposes the RFC 0005 §86 picking row                                      |

Six §86 rows have honest headless numbers today — active rigid bodies, CPU particles, and
the CPU halves of retained UI nodes, animated glyphs, batched sprites and batched shapes.
The first two are **over** the 60 Hz fixed-step budget on this host; the retained-UI and
glyph halves are **inside** a 60 Hz frame on it; the two batching halves are **over** it at
their §86 counts (2026-08-09, R-9 — see the script). None of them is a whole row. §86's clause is _"suitable modern desktop
hardware"_, which a shared CI container without a GPU is not, so no result here is a §86
verdict; see each script's header.

### The unmeasured §86 rows, and why

Until 2026-08-05 this section said the remaining rows "are GPU-bound, UI-tier or already
covered elsewhere — the payload row is gated by `bun run size`, and the GPU rows need a GPU".
That reads as though a GPU is the only thing missing. It is not: **four of these rows name
a feature the engine does not have**, so there is nothing to measure even on ideal
hardware. The distinction matters when planning work — a **hardware** row becomes a
benchmark the day it runs on a workstation; a **feature** row needs a packet first.

**Amended 2026-08-08 (A-27).** Two rows below moved. _Retained UI nodes_ read
_"`@fourjs/ui` ships and lays out; the row is a rendering-throughput number, so it needs a
real GPU rather than SwiftShader"_ and was filed under **hardware**; that was right about
the drawing and wrong about the layout, which is pure CPU work and is now measured by
[`ui-layout.mjs`](#ui-layoutmjs--86s-5-000-retained-ui-nodes-cpu-half). _Animated glyphs_
kept a **feature** block for its drawing half until 2026-08-13, when R-28's `Text` node
removed the per-glyph texture cut the block was about; both of its CPU halves — layout and
geometry build — are now measured in
[`text-layout.mjs`](#text-layoutmjs--86s-20-000-animated-glyphs-cpu-half), and what is left
of the row is GPU submission. Both rows are
**partly** measured — a half-row is stated as a half-row here and in each script's record.

| §86 row                 | blocked by  | detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 100 000 batched sprites | **half**    | **Amended 2026-08-09 (R-9).** Read _"There is no sprite batching"_ until then, which stopped being true when `RenderBatcher` and `createGlBatching` landed: consecutive sprites over one atlas material now merge into one `drawElements`. The **preparation** half is measured by [`render-batching.mjs`](#render-batchingmjs--86s-batched-sprites-and-shapes-preparation-half); the **submission** half needs a GPU. §55's `frame` landed with R-29                                                                                                                                                              |
| 50 000 batched shapes   | **half**    | **Amended 2026-08-09 (R-9).** Read _"There is no shape system to batch"_ until then; §50's catalogue landed with R-23/R-24/R-25 and §58's paints with R-16, and consecutive shapes over one material merge exactly as sprites do. Same split: preparation measured, submission GPU-blocked                                                                                                                                                                                                                                                                                                                         |
| mesh instances          | **feature** | Instancing exists **only** in the particle path (`drawArraysInstanced`, one call per system). No instanced draw path exists for `Renderable`s, so there is no instance count to sweep                                                                                                                                                                                                                                                                                                                                                                                                                              |
| animated glyphs         | **half**    | **Amended 2026-08-13 (R-28).** Read _"the draw half stays **feature**-blocked — §56 ships a bitmap tier whose atlas cannot be addressed per glyph"_ until then; §55's `frame` (R-29) and §49's `Text` node closed that, and 20 000 glyphs are now **one** `drawElements` over one atlas material instead of 20 000 texture binds. Both CPU halves are measured by `text-layout.mjs` — `layoutText` producing the quads, and the `Text` geometry rebuild that turns them into vertex buffers; the **submission** half needs a GPU, exactly as the two batching rows say of theirs. Shaping and SDF are staged (S-6) |
| 100 000+ GPU particles  | hardware    | The CPU path is measured by `particles-100k.mjs`. A GPU/compute path is not implemented **and** would need a GPU to measure; count it as blocked twice                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| retained UI nodes       | **half**    | The **layout-and-state** half is measured (`ui-layout.mjs`): `@fourjs/ui` has no renderer dependency by design, so §74's two passes over the tree are the whole of what the package does per frame. The **draw** half needs a real GPU rather than SwiftShader. It no longer pays the per-glyph texture cut the row above used to (R-28, 2026-08-13), though a `WidgetSkin` has to be rewritten onto `Text` to stop paying it                                                                                                                                                                                      |
| bundle payload          | —           | Not unmeasured: gated by `bun run size` (size-limit) in CI, the one §86 row that _is_ enforced                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| idle scene / near-zero  | —           | Not unmeasured: `scene-propagation.mjs` covers the scene-graph half                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| §86 row                 | blocked by  | detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | ----------- | -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------                                                                                                                                                              |
| 100 000 batched sprites | **half**    | **Amended 2026-08-09 (R-9).** Read _"There is no sprite batching"_ until then, which stopped being true when `RenderBatcher` and `createGlBatching` landed: consecutive sprites over one atlas material now merge into one `drawElements`. The **preparation** half is measured by [`render-batching.mjs`](#render-batchingmjs--86s-batched-sprites-and-shapes-preparation-half); the **submission** half needs a GPU. §55's `frame` landed with R-29                                                                                                                                                              |
| 50 000 batched shapes   | **half**    | **Amended 2026-08-09 (R-9).** Read _"There is no shape system to batch"_ until then; §50's catalogue landed with R-23/R-24/R-25 and §58's paints with R-16, and consecutive shapes over one material merge exactly as sprites do. Same split: preparation measured, submission GPU-blocked                                                                                                                                                                                                                                                                                                                         |
| mesh instances          | **feature** | Instancing exists **only** in the particle path (`drawArraysInstanced`, one call per system). No instanced draw path exists for `Renderable`s, so there is no instance count to sweep                                                                                                                                                                                                                                                                                                                                                                                                                              |
| animated glyphs         | **half**    | The **layout** half is measured (`text-layout.mjs`): `layoutText` produces the quads on the CPU. The **draw** half stays **feature**-blocked — §56 ships a bitmap tier whose atlas cannot be addressed per glyph, so drawing one cell means cutting it into its own `Texture` (the documented workaround in `examples/first-2d-scene` and `examples/ui-demo`) and a glyph is a texture bind and a draw call. Shaping and SDF are staged (S-6)                                                                                                                                                                      |
| 100 000+ GPU particles  | hardware    | The CPU path is measured by `particles-100k.mjs`. A GPU/compute path is not implemented **and** would need a GPU to measure; count it as blocked twice                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| retained UI nodes       | **half**    | The **layout-and-state** half is measured (`ui-layout.mjs`): `@fourjs/ui` has no renderer dependency by design, so §74's two passes over the tree are the whole of what the package does per frame. The **draw** half needs a real GPU rather than SwiftShader, and pays the same per-glyph texture cut as the row above                                                                                                                                                                                                                                                                                           |
| bundle payload          | —           | Not unmeasured: gated by `bun run size` (size-limit) in CI, the one §86 row that _is_ enforced                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| idle scene / near-zero  | —           | Not unmeasured: `scene-propagation.mjs` covers the scene-graph half                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

So the honest summary is: one §86 row is gated, seven are measured or partly measured, one
waits on hardware, and one waits on an engine feature (mesh instancing). That sentence read
_"five … and three wait on engine features"_ until 2026-08-09, when R-9's batching moved the
two batching rows out of the **feature** column and into **half**. Measuring the feature-blocked rows
headless today would produce numbers about the wrong thing — a per-sprite draw loop timed
as if it were a batch is worse than no number.

Counting rows this way is deliberately conservative: a row whose CPU half is measured and
whose draw half is not is **not** a row §86 can be judged on, and neither `ui-layout.mjs`
nor `text-layout.mjs` claims otherwise. What changed on 2026-08-08 is that two absences
stopped being unexamined. The targets are unchanged, and both rows remain unmet as whole
rows.

## What a script here is, and is not

A benchmark here **records** numbers. It is never a gate.

- **Nothing in CI asserts on a timing.** The verification stack (plan §8) gates types, unit
  tests, root suites, lint, spec integrity, docs, the example build, the §86 payload budget,
  and determinism. Wall-clock speed is not on that list and must not be added to it by the
  back door: CI containers are shared, have no GPU, and vary run to run by tens of percent.
- **Every number is a statement about the machine that produced it.** Each script prints its
  host (CPU model, core count, Node version, platform) and writes it into its result file.
  Quoting a number without its host is a misquote.
- **A script is standalone Node with no new dependencies.** It imports the built `dist`
  through the workspace package names, so `bun run build` has to have run first. Phase 11
  answered the "adopt a benchmarking framework?" question with `harness.mjs` — under 400 lines of
  plain ESM, still no new dependency.
- **Wall clocks are the instrument, never the simulation.** `performance.now()` lives in
  `harness.mjs`'s `measure` and nowhere else; nothing it returns may ever be fed back into
  the engine. Simulation is always driven by a constant injected `fixedDeltaTime` (§10,
  §33) — delete every timer from a script here and it must produce the identical state.
- **A micro-benchmark must prove it measured something.** The optimiser is entitled to
  delete work nothing observes. `harness.mjs` exports `keepAlive`, whose accumulator each
  script prints; `math-ops.mjs` additionally publishes a `baseline (no op)` row and varies
  its operands per iteration. A row at the baseline is a deleted operation, not a fast one.

## The harness

`harness.mjs` exports, and nothing else:

| export                                                                   | what it does                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUITE`                                                                  | the suite index — `{ file, record, what }` per script, in run order. One list, read by `node harness.mjs` (the printed index) and by `run-all.mjs` (what to run)                                                                                                                         |
| `measure(iteration, { warmupIterations, measuredIterations, prepare? })` | times each call; returns `{ warmup, measured }` as `Float64Array` milliseconds. `iteration` gets a **globally monotonic index** so a script can derive simulation time from it. `prepare(index)` runs **untimed** before each iteration, for per-iteration setup that is not the subject |
| `summarize(durations)`                                                   | `{ samples, meanMs, medianMs, p95Ms, p99Ms, minMs, maxMs }`, quantiles by **nearest rank** — every printed number is a duration some iteration actually took                                                                                                                             |
| `summaryFields(summary, unit)` / `summaryLines(summary, unit)`           | those six statistics as record fields / as report lines                                                                                                                                                                                                                                  |
| `hostRecord()` / `hostLines(host, caveat)`                               | the host block every record ends with                                                                                                                                                                                                                                                    |
| `writeResult(name, record)` / `resultsPath(name)`                        | writes `results/<name>.json`, two-space JSON, trailing newline; returns the path                                                                                                                                                                                                         |
| `printReport(lines)`                                                     | newline-joined stdout                                                                                                                                                                                                                                                                    |
| `keepAlive(value)` / `keepAliveTotal()`                                  | cross-module accumulator that keeps measured work observable                                                                                                                                                                                                                             |
| `mean`, `quantile`, `round`, `MEASUREMENT_NOTE`                          | the primitives the above are built from                                                                                                                                                                                                                                                  |

A record is `{ _note, benchmark, specification, recordedAt, …the script's own fields…,
...hostRecord(), hostCaveat }` — the host block last, because it is the part a reader must
check before quoting anything above it.

## The runner

`run-all.mjs` (2026-08-08, A-27) runs the suite. It is the smallest thing that deserves the
name: no configuration, no new dependency, no scheduling beyond a `for` loop.

```sh
bun run bench                        # all eight, in SUITE order
bun run bench ui-layout text-layout  # a subset, named by record or by filename
bun run bench --list                 # what would run, and which record each writes
```

- **A process per script.** Every benchmark here is a program with top-level side effects,
  its own warm-up and its own JIT profile. In one process the first script's optimisation
  would pay for the second's, one script's heap would set another's GC pauses, and one
  `RangeError` would take the whole run's records with it. ~100 ms of Node start-up buys
  independence for numbers that are read against each other.
- **Their stdio is inherited**, so each script prints its own report as it runs. The runner
  adds a summary and removes nothing.
- **It asserts on no timing, and its exit code says one thing.** `1` means a script _failed_
  — a structural assertion tripped, or the build had not been run. (`2` is reserved for the
  operator's own mistakes: an unknown benchmark name, or a script missing from the index.
  Those print one line, not a stack trace.) A benchmark that got slower is a finding for a
  reader; a benchmark that threw is a broken benchmark. Adding a timing threshold here would
  be the back door this file's doctrine forbids.
- **`results/suite.json` is a manifest, not a summary.** Which scripts ran, whether each
  succeeded, wall-clock seconds each, and the `benchmark`/`recordedAt` of the record each
  wrote. It copies no measurement out of those records: one number in two files is one
  number that can disagree with itself. `wallSeconds` includes Node start-up, loading the
  built `dist`, scenario construction and every warm-up, so it is not a measurement of
  anything under test.
- **It refuses to start if the tree and `SUITE` disagree** — a `*.mjs` here that no index
  entry names is a benchmark nobody runs, and therefore nobody maintains.

**There is still no CI integration and no trend.** The gap that filed this work (A-27) also
asked for a non-gating job on `main` that runs the suite and posts a delta comment; that
part is unbuilt, so a regression between two commits is still something a person notices by
reading `git diff` over `results/`, not something the repository tells anyone. Stated here
rather than left implied.

## Results

`results/` holds one JSON record per benchmark, **committed** (`.gitignore` does not cover
it). That is deliberate: plan §6h asks Phase 9 for _recorded_ numbers, and a committed record
makes `git diff` after a run the honest way to see what changed and on which host. Each
record carries a `recordedAt` timestamp, the full host description, and a `_note` restating
that it is a measurement rather than a gate.

Re-running a script rewrites its record. Committing the rewrite is right when the intent is
"here is today's measurement on this machine"; committing it silently after moving to a
different machine is not — the host fields exist so a reader can tell the two apart.

One mechanical constraint, learned the hard way (2026-08-08): committed records are checked
by **Prettier**, which collapses a short array of scalars onto one line while
`JSON.stringify(record, null, 2)` expands it — so a field like `[5000]` fails `prettier
--check` the moment it is written. Prettier leaves objects as it finds them, so a record
field that maps a few keys to a few numbers must be an **object**, not an array. Arrays of
long objects (`scenarios`, `attribution`) are unaffected.

## Scripts

Every script below prints a report, writes `results/<name>.json`, and asserts something
structural about its own run so a green exit means more than "it finished". The findings
quoted are the shape of the result, not its exact values — see the JSON for the run under
record, and its host fields before quoting it.

### `math-ops.mjs` — §7b math throughput and allocation

```sh
node benchmarks/math-ops.mjs
```

Sixteen rows — a `baseline (no op)` floor plus fifteen `Vector3`/`Quaternion`/`Matrix4`
operations — each run as 40 measured batches of 100 000 calls over 8 rotating operand sets.
Reports median ms/batch, ns/op, Mop/s, **and allocations per batch** from `@fourjs/math`'s own
`constructionCount()` (§83).

**The durable finding is the allocation column: zero, on every row, across 1.6 million
calls.** §7b requires that steady-state engine code never allocates a math object, and this
is that requirement measured rather than asserted. It is also the one number here that is
host-independent — a non-zero row would be a hot-path defect on any machine.

The throughput column is softer and is bounded by two honesty devices. Mutating operations
are timed as `out.copy(src).op(...)`, so their rows include a copy of the same type and the
`copy` rows are the subtrahend; and the `baseline` row does the operand indexing and the
result read and no math at all. An earlier draft with fixed operands reported `Vector3.copy`
at 3.6 ns against `Vector3.add` at 51 ns — the copy loop had been hoisted out entirely. That
is why operands vary per iteration now, and why the floor is published.

On the recorded host the operations land between roughly 8 ns (`copy`) and 130 ns
(`Quaternion.slerp`, `Matrix4.decompose` — both transcendental-heavy), with `Matrix4.multiply`
and `Quaternion.multiply` near 45 ns including their copy reset.

### `scene-propagation.mjs` — §7 world-transform resolution

```sh
node benchmarks/scene-propagation.mjs
```

`resolveWorldTransforms(root)` runs twice per frame in a rendering application — before
physics synchronisation and before render-item generation — so its cost scales with node
count whatever else is happening. Four scene shapes (a flat 1 001-node root, an 11 111-node
and a 111 111-node ten-way tree, a 2 001-deep chain), each measured in the **three states a
real frame produces**:

| pass     | what is dirty | asserted                               |
| -------- | ------------- | -------------------------------------- |
| `full`   | the root      | `recomputed === visited === nodeCount` |
| `sparse` | 64 leaves     | `recomputed === 64`                    |
| `cached` | nothing       | `recomputed === 0`                     |

The assertions matter as much as the timings: a green run is itself evidence that §7's
version-based caching does what its documentation claims. Dirtying happens in the harness's
**untimed** `prepare` hook, so the measured region is resolution alone.

Two findings, both stable across runs:

- A **clean pass is only about 3× cheaper than a full recompute**, not free. §86's
  _"idle scene — near-zero unnecessary uploads and simulation work"_ holds for the
  arithmetic (zero matrices are multiplied) but the _walk_ is not free: on the order of
  120 ns per visited node, dominated by the per-node `WeakMap` lookup and the three version
  comparisons. At 111 111 nodes that is ~13 ms per pass, twice per frame, for a scene where
  nothing moved. A dirty-subtree skip list is the obvious follow-up and is not in scope here.
- The resolver **recurses once per level**, so scene depth is bounded by the JS stack. Probed
  once while authoring (not per run, and stated as such in the script): 8 000 deep resolves,
  12 000 throws `RangeError`. The deep scenario is 2 000, comfortably inside.

### `physics-step.mjs` — §86's 5 000 active rigid bodies

```sh
node benchmarks/physics-step.mjs
```

§86 targets _"active rigid bodies: 5 000 simple bodies baseline"_. Two words decide the
benchmark. **Active**: §32 sleeping is disabled in every scenario, because Appendix A's
default would put a settled pile to sleep within a second and make the number meaningless.
**Suitable modern desktop hardware**: not this container, so nothing here is a §86 verdict.

A static floor and N dynamic unit boxes on a lattice, dropped and left to pile up, at
N = 500 / 1 000 / 2 500 / 5 000. One measured iteration is `PhysicsWorld.step(dt)` — §39
steps 1–6. §39 step 9 (`dispatchEvents`) runs as the untimed `prepare` hook on a
listener-free world, so the timed region is the solve and the event queue cannot grow across
the run. `finalChecksum` is `world.checksum()` (§33): the scenario's fingerprint, so a future
run that is merely slower can be told from one whose _scene_ changed.

Every count is measured **twice** — piled, and in **free fall** with no floor, where nothing
ever touches. The recorded findings:

- At 5 000 active bodies the piled step costs on the order of **130 ms**, roughly **8× the
  16.667 ms** a 60 Hz fixed step has to spend, on this host.
- The same 5 000 bodies in free fall cost about **16 ms** — broad phase, integration and the
  per-body scene write-back alone, with zero events. So **~88 % of the piled figure is
  contact generation, contact solving and §29 event translation**, not per-body integration,
  and the split is stable across all four counts.
- The pile queues roughly **0.9 §29 events per body per step** (4 600 at 5 000 bodies), each
  translated into an object inside the timed region. How much of the 88 % is the solver and
  how much is the event seam is _not_ separated here — doing so needs an API to suppress
  event collection, which does not exist and is a decision, not a benchmark change.

### `animation-sampling.mjs` — §17 mixer sampling

```sh
node benchmarks/animation-sampling.mjs
```

One measured iteration is `mixer.advance(dt)` over every one of N mixers — a frame of
`AnimationSystem`'s work — at N = 250 / 1 000 / 5 000 / 20 000, on a shared 4-track clip
(`transform.position`, `.rotation`, `.scale`, `.pivot`; 8 linear keys over 2 s). Every node
is `transformAuthority: "animation"`: with the default `"manual"` the mixer refuses its own
transform writes and warns (§42), so a benchmark left on the default would measure the
refusal path. The clip and its tracks are **one shared immutable object set** (§17), as an
application animating a crowd would have it.

On the recorded host a mixer costs on the order of **1 µs per step** with this clip
(~200–290 ns per track sample), so 20 000 animated instances land around 23 ms — over a 60 Hz
budget on their own, and 5 000 sit comfortably inside it. An attribution run at 5 000
instances with 1, 2 and 4 tracks puts the marginal track at roughly **175–250 ns per instance
per step**.

The script also publishes its own **noise floor**: the 5 000 × 4 configuration is measured
twice, independently, in one process, and the two means have disagreed by 20–50 % between
runs on this host. That number is printed next to the results deliberately — it is the scale
below which nothing in this file is a finding.

### `particles-100k.mjs` — §112's particle budget (WP-9.4, Phase 9)

```sh
bun run build
node benchmarks/particles-100k.mjs
```

Steps **100 000 live particles** for 600 fixed steps (10 s at 60 Hz) under the §27 field
stack of uniform gravity, linear drag and a vortex, and reports **milliseconds per fixed
step** — mean and p95 — against the 16.667 ms a 60 Hz step has to spend. A 60-step warm-up
runs first and is reported separately. It then repeats the run with 0, 1 and 2 fields, so the
headline number can be attributed rather than merely quoted. Writes
`results/particles-100k.json`.

WP-11.4 moved this script's plumbing into `harness.mjs` — the timing loop, the statistics,
the host block, the writer, the printer. What is measured did not change, and the record's
fields and their order are unchanged; the extraction was verified by diffing the record's key
order before and after.

**How §112 is read.** §112's exit is _"≥100,000 simple particles simulated and rendered at
interactive rates on suitable hardware"_. Plan §6h interprets that for this environment and
splits it three ways, because no single artefact can honestly carry it:

| half of §112                      | where the evidence is                                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 100 000 particles **simulated**   | this script — recorded ms/step, no CI assertion                                                                       |
| **rendered** in one draw call     | `@fourjs/render`'s `particles.ts` contract and `@fourjs/render-webgl`'s instanced path, pinned by their unit suites   |
| at **interactive rates**, visibly | `examples/particles-demo` + `tests/browser/particles.spec.ts`, at ~1 800 particles — the size SwiftShader can sustain |
| **deterministically** (P9-4)      | `tests/determinism/phase9-particles.test.ts` + `golden/phase9.json`                                                   |

"Suitable hardware" is the phrase this environment cannot satisfy, and the script says so
rather than pretending otherwise: the recorded host is a **CI container with no GPU**, shared
with other work, and the script measures the **CPU half only** — no GL context is created,
nothing is uploaded, nothing is drawn.

**What the recorded numbers say** (see `results/particles-100k.json` for the run under
record; the shape of the result, not its exact values, is the durable part):

- The **integrator alone** — semi-implicit Euler, ageing, expiry, swap-remove compaction,
  over 100 000 particles — costs on the order of **1 ms per step**, well inside a 60 Hz
  budget.
- Each **§27 force field** adds on the order of **5–6 ms per step per 100 000 particles**.
  That is the cost of a virtual `sample()` call per particle per field across a polymorphic
  call site (`emitter.ts`'s field loop), not the cost of the arithmetic inside the fields.
- So the three-field headline stack lands **around** the 16.667 ms budget on this host, and
  which side of it a given run lands on is mostly a statement about the container.

The finding is recorded rather than acted on: batching the §27 seam (sampling a lane per
call, or specialising the common built-ins) is a real optimisation with a real API cost, and
it belongs to a packet that is scoped to make that trade, not to the packet that measured it.

### `ui-layout.mjs` — §86's 5 000 retained UI nodes (CPU half)

```sh
node benchmarks/ui-layout.mjs
```

§86 asks for **5 000 retained UI nodes**. That frame costs two things — laying the tree out
and drawing it — and `@fourjs/ui`'s frozen dependency matrix (`core`, `math`, `scene`,
`input`, `text`; no renderer) separates them in the engine, not merely in this file. This
script measures the layout, which is the whole of what the package does per frame; the draw
is the application's, goes through a `WidgetSkin`, and is not measurable here.

A flex column of section panels, each a flex row of title label, button with its own caption
label, checkbox, slider and progress bar, built to **exactly** the requested widget count
(§86's row is a count, so an approximate tree would answer a different question). Widget
counts 500 / 1 000 / 2 500 / 5 000, each measured in the three states a real frame produces:

| pass          | invalidated before the pass | stands for                              |
| ------------- | --------------------------- | --------------------------------------- |
| `cold`        | every `Label`               | first frame, or a re-themed UI          |
| `incremental` | 64 `Label`s                 | a normal frame — a few captions changed |
| `warm`        | nothing                     | a frame where only layout inputs moved  |

Invalidation runs in the harness's **untimed** `prepare` hook, and the two alternating
caption strings have equal glyph count — so the resolved geometry is identical across all
three passes, which the script asserts rather than assumes. It also asserts the widget count
and that every laid-out widget carries §74's `"constraint"` authority: under any other
authority `applyLayout` warns instead of writing, and the benchmark would be timing the
refusal path.

The findings, in the shape that outlives a given run (see `results/ui-layout.json` for the
run under record, and its host block before quoting it):

- **§86's 5 000 widgets lay out inside a 60 Hz frame on this host, and not by much.** A cold
  pass lands on the order of **10–13 ms** against 16.667 ms, a warm one **8–11 ms**. §86
  states this row as a count and no rate; 60 Hz is this file's reading of the table's
  neighbouring rows, said out loud rather than smuggled in.
- **Layout has no dirty tracking.** `layout()` measures and arranges the whole tree whatever
  changed — the only memo in the pass is `Label.textLayout`. That is why `warm` is most of
  `cold`: across the runs recorded so far **text measurement is 15–25 %** of a cold pass, and
  the rest is a walk §74 performs unconditionally. A dirty-subtree skip is the obvious
  follow-up and is not in scope here (the same finding `scene-propagation.mjs` records for
  `resolveWorldTransforms`, in a second subsystem).
- **State is cheap next to layout.** ~2 100 slider/progress/checkbox writes with their §6b
  dispatch, no listeners attached, cost on the order of **0.5–0.8 ms** — 250–350 ns a write,
  and well under a tenth of the layout pass they accompany.
- **Per-widget cost is not flat**: warm ns/widget rises two- to two-and-a-half-fold between
  500 and 5 000 widgets. The pass is O(n) by inspection — each widget measured once and arranged once,
  O(1) work at each — so this is a memory-hierarchy effect on this host rather than an
  algorithmic term. Recorded, not explained away; `perWidgetCostSpread` carries it.
- **The noise floor is published from the data.** `incremental` contains `warm` plus 64 text
  re-measurements, so a row where it measures _faster_ is arithmetically impossible and is
  this host's run-to-run spread showing through. `inversionRows` names any row where that
  happened; nothing smaller than that gap is a finding.

### `text-layout.mjs` — §86's 20 000 animated glyphs (CPU half)

```sh
node benchmarks/text-layout.mjs
```

§86 asks for **20 000 animated glyphs**. Producing the quads is CPU work `@fourjs/text` does;
turning them into vertex buffers is CPU work §49's `Text` node does; submitting the draw is
the GPU's. This script measures the first two.

**Amended 2026-08-13 (R-28).** It read _"drawing them is not [CPU work the engine does], and
stays blocked on a **feature** rather than on hardware — the §56 bitmap atlas cannot be
addressed per glyph, so the shipped path cuts one `Texture` per glyph cell and issues a draw
call each"_. That stopped being true when R-29's §55 `frame` and R-28's `Text` node landed:
a label is now **one** indexed vertex buffer over **one** atlas material, so 20 000 glyphs
are one `drawElements` rather than 20 000 texture binds, and the `geometry half` rows below
measure what a frame pays to build them.

**What "animated" costs, honestly.** A glyph that only _moves_ is laid out **once**: the
quads are geometry, and animating a node's transform never re-enters `layoutText`. Only text
whose _content_ changes — a counter, a typewriter, a scrolling log — pays this again. The
numbers here are therefore the **worst case** for the row, not its normal case, and reading
them as the price of 20 000 animated glyphs would overstate it.

One iteration is one `layoutText` call per string in the corpus. Corpora are sized by
**drawn glyphs**, which is what §86 counts — a space advances the pen and emits no quad — and
each row asserts `quads.length` against the number it claims. `layoutText` is documented pure
(§33), and the script holds it to that by comparing a probe quad across the whole run.

The findings:

- **20 000 glyphs lay out in roughly 2 ms** on this host — comfortably inside a 60 Hz frame,
  at about **95–120 ns per drawn glyph**, and flat from 5 000 glyphs to 50 000.
- **The per-call cost matters at small strings.** Holding the glyph count at 20 000 and
  varying the string length from 1 to 200 characters, `total ≈ calls · perCall + glyphs ·
perGlyph` fits with **perCall on the order of 120–140 ns** and perGlyph as above. So 20 000
  one-glyph labels cost more than twice what 100 paragraphs of the same text do. The two
  terms are fitted from the two extreme rows and `modelResidual` records how far that misses
  the rows it did not see — published so the split reads as a description of the data rather
  than a claim about it.
- **Most of a glyph is allocate-and-freeze, not arithmetic.** `layoutText` allocates and
  `Object.freeze`s one `TextQuad` per drawn glyph, plus a frozen array and a frozen result
  per call: 20 000 frozen objects per frame at §86's count. A control row — 20 000 plain
  object literals of the same eight numeric fields, created and frozen in the benchmark
  itself, touching no engine code — costs **on the order of 80–90 % of the whole 20 000-glyph
  row**. That is an upper bound rather than a split (the control writes constants where
  `layoutText` computes coordinates), and it is where a future optimisation would have to
  look: a flat `Float32Array` of quad coordinates, not faster arithmetic. Unlike §7b's math
  types this path is not allocation-free and is not required to be — the quads _are_ the
  return value.
- **The geometry half is the expensive half, and that is the finding.** Assigning a new
  string to every `Text` node and reading its `geometry` back — one `layoutText` plus one
  positions/uv/index rebuild per node — costs **roughly 14 ms at 20 000 glyphs** on this
  host, about 700 ns per glyph, against ~2 ms for the layout alone. So closing the draw-call
  gap moved the bottleneck rather than removing it, exactly as `render-batching.mjs` found
  for sprites: what a content-changing text frame pays is three typed-array allocations and
  a scan per label, not a draw call. Text that only _moves_ pays none of it.
- **The draw-call number is the closed blocker, and it is not a millisecond.** 20 000 glyphs
  over one atlas material are **one** `drawElements` under §65 batching (`drawCallsBatched`),
  one per label without it (`drawCallsUnbatched`), and were **20 000** before R-28
  (`drawCallsBeforeR28`). Submitting them is GPU work this host cannot measure.
- **Building the atlas is setup, and is timed as such**: `buildGlyphAtlas()` on the built-in
  6 × 12 face costs a couple of milliseconds once, and is deliberately excluded from every
  throughput number above.

### `render-batching.mjs` — §86's batched sprites and shapes (preparation half)

```sh
node benchmarks/render-batching.mjs
```

Six scenarios — 10 000 / 50 000 / 100 000 sprites over one atlas material, and 5 000 /
25 000 / 50 000 §50 rectangles over one `UnlitMaterial` — each measured twice: the render
list alone (`buildRenderList`, §64 stages 1–2 and 4–5) and the same frame **plus** §65's
batch assembly (`RenderBatcher.next` over the whole list, writing every merged vertex). The
difference between the two is the batching pass, reported as its own column.

The one number here that is not a timing is the draw-call collapse: `drawCallsUnbatched` is
one call per render item, which is what `webgl-renderer.ts` issues today with no batcher
assigned, and `drawCallsBatched` is one per batch the planner produced. Counting it needs no
GPU.

Findings, as shapes rather than values (2026-08-09, first record):

- **The draw-call reduction is four orders of magnitude.** 100 000 sprites become **7**
  draw calls and 50 000 rectangles become **4** — one per `DEFAULT_MAX_BATCH_VERTICES`
  (65 536) worth of vertices, which is the only thing that splits a run of one material.
- **Preparation, not submission, is now the bound on this host.** Both §86 counts are
  **over** a 16.667 ms frame in preparation alone, and roughly half of that cost is
  `buildRenderList` — which the unbatched frame pays too. The batching pass adds about the
  same again, because it transforms every vertex on the CPU (`batch.ts` states that
  trade-off and why the tier makes it).
- **The cost is linear in the node count** — the per-node figure moves by well under a
  factor of two across a 10× sweep in both scenarios, so nothing here is super-linear. Its
  absolute value is not stable enough to quote: two consecutive runs on this shared host
  put the 100 000-sprite row at 61 ms and 78 ms (600 and 780 ns per node), which is the
  "tens of percent" spread this file warns about, measured.
- A number this file cannot give: whether either row meets §86 on **suitable modern desktop
  hardware** with a real driver on the other side of `drawElements`. Both remain half-rows.

### `view-culling.mjs` — §64's per-view lists and §87's frustum cull

```sh
node benchmarks/view-culling.mjs
```

**Not a §86 row.** §86 lists no culling target, and this script exists for a different
purpose: R-8 had a design decision to make and this is the measurement behind it. Nine
scenarios — 10 000 / 50 000 / 100 000 §50 rectangles spread over **four times** the
camera's area, drawn into 1, 2 and 4 viewports — each measured three ways:

| arm          | what it does                                                       |
| ------------ | ------------------------------------------------------------------ |
| `filter ms`  | one traversal, then one `buildViewRenderList` per view, no frustum |
| `derive ms`  | the same, with §87's cull — so `derive − filter` is the cull alone |
| `rebuild ms` | the rejected alternative: `buildRenderList` once **per view**      |

`filter` and `rebuild` produce the **same** per-view lists, so their ratio is the design
decision and nothing else. The cull is reported separately because either design would have
paid it.

Findings, as shapes rather than values (2026-08-09, first record):

- **Deriving wins as soon as there is more than one viewport, and only then.** At one view
  the two arms are within noise of each other — both traverse once, and deriving adds one
  linear pass. At two views the rejected alternative costs roughly 1.35×, and at four views
  1.85–2.85×, because traversal is the expensive stage and it is the one being multiplied.
  The structural arguments for deriving (traversal has side effects; §69's shadow map is
  frame state no view may filter) are what make the decision at one view; this is what makes
  it at four.
- **The cull is not free, and its price is comparable to a traversal.** On this host the
  frustum test costs roughly 0.3–0.5 µs per item per view — a `computeBounds` read, nine
  multiply-adds for the world sphere, one `sqrt`, and up to six plane tests. It buys back a
  draw call and its uniform uploads per removed item, which is backend work this script
  cannot see, so nothing here says culling is a net win at a given node count; what it says
  is what the CPU side costs.
- **The run-to-run spread is the one this file warns about.** The `rebuild/filter` column
  moves between 0.74× and 0.95× at one view across node counts, which is noise around 1.0,
  not a trend. Read the column's growth with view count, not its absolute values.

### `skinning-resolve.mjs` — RFC 0003 bones-as-nodes and 180 channels

```sh
node benchmarks/skinning-resolve.mjs
```

**Not a §86 row — it proposes one.** RFC 0003's prototype section owed the cost of
decision (b) (bones as nodes at 60 ×1 and ×10) and the 180-channel controller versus
the mixer path. This script is those two measurements. Alternative A (a private
transform array) returns only if the bone walk is the expensive part; the record
says whether that happened on the host that wrote it. The proposed §86 sentence is
derived from resolve + palette + controller on this host, and is not a gate.

### `pick-latency.mjs` — RFC 0005 id-pass and fence-vs-stall pick

```sh
bun run build
node benchmarks/pick-latency.mjs
```

**Not a CI gate, and not a §86 verdict.** RFC 0005's prototype section owed
the id-pass cost against the flagship list (and R-8's 10 000 / 50 000 /
100 000) and measured fence-versus-stall pick latency. This script is those
two measurements.

The §118 flagship is O(10²) id-pass candidates; the 1× row is **64**
rectangles (that order of magnitude; particle systems are omitted so
the ratio is not mixed with `ParticleIdProgram`). One arm is
`PickingService.update`; the other is `buildRenderList` +
`buildViewRenderList`, which is the list the pass itself builds.

`pick()` is timed on the fence sequence (`PIXEL_PACK_BUFFER` + `fenceSync`)
and on the stalling `readPixels` fallback when both sequences are reachable.
This host typically has **no WebGL 2**, so both arms run on the same
counting GL seam the unit tests use: JavaScript plus that seam, not GPU or
driver time. `clientWaitSync` answers `ALREADY_SIGNALED`, so neither path
waits a frame (`extraFrames` is 0). WebGPU has `mapAsync` for §61
`readPixels` but **no** `PickingService`; that second GPU pick path is not
invented. Recorded, never gated.

## `geometry-updates.mjs` — dynamic WebGL geometry

`node benchmarks/geometry-updates.mjs` measures 1,000 geometries per iteration,
100 warm-up iterations and 200 measured iterations, for position-only, indexed
quad and all-attribute layouts. A counting GL seam records API calls, object
creation/deletion and uploaded bytes. Array mutation and counter resets happen
outside the clock; static acquisitions are the zero-call control. The script
is registered in `harness.mjs` and writes `results/geometry-updates.json`.

For a same-checkout comparison, preserve the old built `gl-geometry.js` beside
its original `gl-program.js` before rebuilding, then run:

```sh
node benchmarks/geometry-updates.mjs --baseline=packages/render-webgl/dist/gl-geometry.baseline.js
```

The committed comparison uses main `6a22580a960858fc96d39a7852d6008598f259d2`
as the baseline. Dirty acquisitions issue **11 → 5**, **15 → 7**, and
**45 → 17** GL calls respectively. Reused layouts create/delete no GL handles;
full upload bytes remain **36**, **60**, and **300** per geometry. These exact
counts are the primary result. Wall times include the counting seam, JIT and GC,
not a driver or GPU; they are **not FPS or GPU-time measurements**.

`tests/browser/geometry-refresh.spec.ts` supplies the separate real-driver
regression: old and new versions are drawn into adjacent viewports before any
readback, then compared pixel-for-pixel against independent fresh allocations.
Resizing, index widening/narrowing and attribute add/remove are exercised.
