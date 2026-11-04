# Evidence memo: making §65 batching default-on

**Decision (2026-11-04, owner-delegated to the program lead):** batching stays **opt-in**. The constant ~2 kB gzip per `WebglRenderer` bundle would put `particles-demo` over its budget and buys nothing for the common lit-mesh case (R-22 is not in). Default-on is revisited only if R-22 lands and the four conditions at the end of this memo are met.

Status: evidence for an owner decision (TODO row "Batching follow-ups", clause (c)). No engine change.
Measured 2026-11-04 on the wave-4 worktree, Intel Xeon 2.1 GHz x4, node v22, linux x64.

## What "default-on" means here

Batching is opt-in: `renderer.batching = createGlBatching()` (field defaults to `null`,
`webgl-renderer.ts`). An app that never calls it does not link `gl-batch.ts`. Default-on would
put that module (plus the `RenderBatcher` planner it pulls in) into every bundle that imports
`WebglRenderer`. No example registers it today.

## Method

1. `bun run examples:build` as-is; gzip bytes of each budgeted example's `dist/assets/*.js`
   (`gzip -9` of the concatenated chunks; absolute values differ ~0.4 kB from size-limit's
   figure, deltas are comparable).
2. Same build with a TEMPORARY two-line append to each `main.ts`
   (`import { createGlBatching } ...; globalThis.__b = createGlBatching();`), sources reverted
   afterwards (`git status examples` is clean), dist rebuilt as-is.
3. `node benchmarks/render-batching.mjs` for draw calls.

## 1. Bundle delta (gzip bytes)

| Budget row                 | As-is     | With batching | Delta  | size-limit now | Limit   | Headroom now | Headroom after      |
| -------------------------- | --------- | ------------- | ------ | -------------- | ------- | ------------ | ------------------- |
| first-2d-scene             | 59 688    | 61 581        | +1 893 | 60.18 kB       | 150 kB  | 89.8 kB      | 87.9 kB             |
| first-3d-scene             | 42 268    | 44 157        | +1 889 | 42.61 kB       | 46 kB   | 3.39 kB      | **1.50 kB**         |
| particles-demo             | 44 003    | 45 911        | +1 908 | 44.43 kB       | 46 kB   | 1.57 kB      | **-0.34 kB (over)** |
| ui-demo                    | 51 765    | 53 635        | +1 870 | 52.22 kB       | 54.5 kB | 2.28 kB      | **0.41 kB**         |
| one-scene-everything-moves | 1 990 478 | 1 992 545     | +2 067 | 1.98 MB        | 2.05 MB | ~70 kB       | ~68 kB              |
| motor-digital-twin         | 1 227 378 | 1 229 403     | +2 025 | 1.22 MB        | 1.25 MB | ~30 kB       | ~28 kB              |
| character-controller       | 1 157 535 | 1 159 614     | +2 079 | 1.15 MB        | 1.20 MB | ~50 kB       | ~48 kB              |

The cost is near-constant, 1.87-2.08 kB per bundle (top of the 0.75-1.9 kB range in the TODO row;
the flagship rows pay slightly more because they link more of the planner). Reasoning from
one example would have been safe; all seven were measured.

## 2. Draw-call delta (`benchmarks/render-batching.mjs`)

No example has many like consecutive items (the budgeted demos draw tens of nodes), so the
draw-call win is measured on the synthetic scenes only:

| Scenario | Nodes   | Draws unbatched | Draws batched |
| -------- | ------- | --------------- | ------------- |
| sprites  | 10 000  | 10 000          | 1             |
| sprites  | 50 000  | 50 000          | 4             |
| sprites  | 100 000 | 100 000         | 7             |
| shapes   | 5 000   | 5 000           | 1             |
| shapes   | 25 000  | 25 000          | 2             |
| shapes   | 50 000  | 50 000          | 4             |

CPU preparation is the price on the same scenes: 100k sprites cost 93.8 ms (29.2 ms list +
64.6 ms batching), 50k shapes 47.6 ms; both are OVER a 16.7 ms frame on this host, so the
preparation half does not fit 60 Hz at those counts (submission is GPU-blocked and unmeasured).
At 10k sprites batching is 3.5 ms (30 % of a frame). Batching does not help scenes below a few
hundred like items: the per-item cost is ~0.5-1 us of vertex baking, which exceeds the
saved per-draw state cost there.

## 3. The trade

- Who pays: every `WebglRenderer` app, ~1.9-2.1 kB gzip, including apps that draw 20 nodes and
  never batch anything. Three of four small-example budgets lose most or all headroom.
- Who gains: apps with thousands of consecutive items over one material (sprite/particle-like
  sheets, shape UIs, bitmap labels). Gain is 3-5 orders of magnitude fewer draw calls, GPU-side.
- Shaded (lit) meshes do not batch yet (`R-22`: a baked batch has no normals), so the common 3D
  case gains nothing.

## 4. Recommendation

Do not flip the default to always-linked. Keep the field `null` by default and add it to the
runtime `register*` family (e.g. `registerGlBatching()`), consistent with the 2026-09-16
correction in the TODO row (default-on is a who-pays decision, not a blocked one).

If the owner still wants default-on, it is safe for the budgets only when all of these hold:

1. `particles-demo` limit raised from 46 kB to >= 47 kB (it goes 0.34 kB over), and
   `ui-demo` (0.41 kB left) and `first-3d-scene` (1.50 kB left) either accept ~2 % headroom or
   are raised by 1 kB each, per the budget-rationale convention in `tools/size-budgets.mjs`
   (keep ~1.3-2 % margin: that implies ui-demo >= 55.5 kB, first-3d >= 46.5 kB).
2. `tools/size-budgets.mjs` records the +1.9 kB law as an intended line item.
3. The module is still tree-shaken for apps that never construct a `WebglRenderer`
   (check `first-2d-scene`-style non-GL bundles stay unchanged).

Alternative that costs nothing now: leave opt-in and enable it in the examples that actually
carry many like items when one exists.
