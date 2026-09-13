/**
 * World-transform propagation over deep and wide scene graphs (§7 resolution,
 * §7b; §92's *"CPU time"* metric; plan §6j P11-4, WP-11.4).
 *
 * ```sh
 * bun run build          # this script imports the built dist, not src
 * node benchmarks/scene-propagation.mjs
 * ```
 *
 * ## What is measured
 *
 * `resolveWorldTransforms(root)` is the single writer of every
 * `Transform.worldMatrix` (§7) and runs **twice per frame** in a rendering
 * application — once before physics synchronisation and once before render-item
 * generation. It is therefore the one scene-graph cost that scales with node
 * count no matter what the renderer or the solver is doing, which is what makes
 * it worth a benchmark of its own.
 *
 * Each scenario is measured in the **three states a real frame produces**,
 * because the resolver's whole design is that they cost wildly different
 * amounts and a single number would hide that:
 *
 * | pass | what is dirty | what the resolver must do |
 * |---|---|---|
 * | `full` | the root | recompute **every** node — a `Matrix4` multiply each |
 * | `sparse` | {@link SPARSE_DIRTY_NODES} leaves | recompute exactly those leaves |
 * | `cached` | nothing | walk and compare versions; **zero** arithmetic |
 *
 * The `cached` row is the interesting one: §86's *"idle scene — near-zero
 * unnecessary uploads and simulation work"* is a claim about exactly this, and
 * the row measures what an idle frame actually costs per node. The script
 * asserts `recomputed === 0` on it, so the number is a measurement of the
 * caching working rather than of a coincidence.
 *
 * ## Scene shapes
 *
 * Four (see {@link SCENARIOS}): a flat 1 000-child root, a 10 000-node and a
 * 111 111-node ten-way tree, and a 2 000-deep chain. Depth and width are varied
 * separately because they stress different things — width is throughput,
 * depth is the dependency chain that forces a recompute to the leaves.
 *
 * ## An authoring-time finding about depth, recorded here
 *
 * `resolveWorldTransforms` walks the subtree by **recursion, one JS frame per
 * node of depth**, so maximum scene depth is bounded by the JS stack rather
 * than by memory. Probed once while writing this script (2026-08-02, node
 * v22.22.2, the host in this file's record, default stack): a **8 000-deep**
 * chain resolves; a **12 000-deep** chain throws `RangeError: Maximum call
 * stack size exceeded`. That is not measured on every run — it is a one-off
 * observation stated because it belongs next to these numbers — and the deep
 * scenario here is 2 000, comfortably inside it. Deep scenes are unusual and
 * nothing in the engine is documented as supporting unbounded depth, so this is
 * recorded as a finding, not treated as a defect by this packet.
 *
 * ## Wall clocks and §86
 *
 * No simulation runs here: the scenes are mutated by direct writes and by
 * `Transform.markDirty()`, never by a clock, and `performance.now()` lives in
 * `harness.mjs` where nothing under test can read it. §86 has **no
 * transform-propagation row**. The two rows it does have that are node-count
 * shaped — *"simple mesh instances: 100 000 visible instances where GPU-bound
 * limits permit"* and *"retained UI nodes: 5 000"* — are statements about
 * drawing and about UI, not about this pass; the 111 111-node scenario is sized
 * to the first of them so a reader can see what the scene-graph half of such a
 * scene costs, and that is the whole of the relationship. Recorded, never
 * gated.
 */

import { Group, resolveWorldTransforms } from "@fourjs/scene";

import {
  MEASUREMENT_NOTE,
  hostLines,
  hostRecord,
  keepAlive,
  keepAliveTotal,
  measure,
  printReport,
  round,
  summarize,
  writeResult,
} from "./harness.mjs";

/** Measured passes per scenario per pass kind. */
const MEASURED_PASSES = 30;

/** Unmeasured passes first, so the reported mean is steady-state. */
const WARMUP_PASSES = 6;

/**
 * Leaves marked dirty for the `sparse` pass — a plausible "a few things moved"
 * frame. Chosen small relative to every scenario's node count so the row is
 * about the *walk*, which is the cost the resolver cannot avoid.
 */
const SPARSE_DIRTY_NODES = 64;

/** Decimals kept for the per-pass millisecond statistics. */
const MS_DIGITS = 4;

/**
 * The scene shapes, in report order.
 *
 * `branching` children per node for `depth` levels below the root, so the node
 * count is `1 + b + b² + … + b^depth`; `branching: 1` is a chain.
 */
const SCENARIOS = [
  {
    name: "flat-1k",
    what: "one root, 1 000 direct children — the shallowest useful scene",
    branching: 1000,
    depth: 1,
  },
  {
    name: "tree-11k",
    what: "ten-way tree, 4 levels — a mid-sized mixed 2D/3D scene",
    branching: 10,
    depth: 4,
  },
  {
    name: "tree-111k",
    what: "ten-way tree, 5 levels — sized to §86's 100 000-instance row",
    branching: 10,
    depth: 5,
  },
  {
    name: "chain-2k",
    what: "2 000-deep chain — the dependency-chain shape, not a realistic scene",
    branching: 1,
    depth: 2000,
  },
];

/**
 * Builds one scene and returns its root, its leaves, and its node count.
 *
 * Every node gets a distinct non-identity local transform, so no node hits a
 * degenerate path and the `full` pass does a real `Matrix4` multiply per node.
 * The tree is built iteratively (the *resolver* recurses; the builder must not,
 * or a deep scenario would fail to build before it could be measured).
 */
function buildScene(branching, depth) {
  const root = new Group();
  root.name = "root";
  // Non-identity, so the `keepAlive` fold of the root's world translation is a
  // number that could only have come from a resolve that actually ran.
  root.transform.position.set(0.25, -0.5, 0.75);
  const leaves = [];
  let level = [root];
  let count = 1;

  for (let d = 0; d < depth; d += 1) {
    const next = [];
    for (let p = 0; p < level.length; p += 1) {
      const parent = level[p];
      for (let c = 0; c < branching; c += 1) {
        const child = new Group();
        // Deterministic, well-conditioned, and different for every node: a
        // uniform transform would let a reader wonder whether some equality
        // fast path was being measured instead of the multiply.
        const t = count * 0.0007;
        child.transform.position.set(0.5 + t, -1.25 + t, 0.75 - t);
        child.transform.scale.set(1 + 0.001 * (c + 1), 1.002, 0.999);
        parent.add(child);
        next.push(child);
        count += 1;
      }
    }
    level = next;
  }
  // The last level built is the leaf level for every shape used here.
  leaves.push(...level);
  return { root, leaves, nodeCount: count };
}

/**
 * Reused stats object, per §7b's `out` policy — passing it makes every measured
 * pass allocation-free, which is the way engine-internal callers use the API.
 */
const stats = { visited: 0, recomputed: 0 };

/**
 * Times {@link MEASURED_PASSES} passes of one kind and returns the summary plus
 * the last pass's stats.
 *
 * `dirty()` sets the pass's dirty state and is handed to the harness as its
 * untimed `prepare` hook, so it runs **outside the clock**: this benchmark
 * measures resolution, not `markDirty`.
 */
function timePasses(root, dirty) {
  let lastVisited = 0;
  let lastRecomputed = 0;
  const { warmup, measured } = measure(
    () => {
      resolveWorldTransforms(root, stats);
      lastVisited = stats.visited;
      lastRecomputed = stats.recomputed;
      keepAlive(root.transform.worldMatrix.elements[12]);
    },
    {
      warmupIterations: WARMUP_PASSES,
      measuredIterations: MEASURED_PASSES,
      prepare: dirty,
    },
  );
  return {
    summary: summarize(measured),
    warmupSummary: summarize(warmup),
    visited: lastVisited,
    recomputed: lastRecomputed,
  };
}

/**
 * Runs the three pass kinds over one scenario.
 *
 * Each kind's dirtying runs as the harness's untimed `prepare` hook, so every
 * measured resolve is entered in exactly the state its row claims.
 */
function runScenario(scenario) {
  const { root, leaves, nodeCount } = buildScene(
    scenario.branching,
    scenario.depth,
  );
  const dirtyLeaves = leaves.slice(0, SPARSE_DIRTY_NODES);

  // --- full: the root is dirty, so every descendant must be recomputed -------
  const full = timePasses(root, () => {
    root.transform.markDirty();
  });
  if (full.recomputed !== full.visited || full.visited !== nodeCount) {
    throw new Error(
      `scene-propagation invalid (${scenario.name}, full): visited ${full.visited}, recomputed ${full.recomputed}, expected both ${nodeCount}`,
    );
  }

  // --- cached: nothing is dirty, so nothing may be recomputed ---------------
  const cached = timePasses(root, () => {});
  if (cached.recomputed !== 0 || cached.visited !== nodeCount) {
    throw new Error(
      `scene-propagation invalid (${scenario.name}, cached): visited ${cached.visited}, recomputed ${cached.recomputed}, expected ${nodeCount} and 0`,
    );
  }

  // --- sparse: a handful of leaves moved ------------------------------------
  const sparse = timePasses(root, () => {
    for (let i = 0; i < dirtyLeaves.length; i += 1) {
      dirtyLeaves[i].transform.markDirty();
    }
  });
  if (
    sparse.recomputed !== dirtyLeaves.length ||
    sparse.visited !== nodeCount
  ) {
    throw new Error(
      `scene-propagation invalid (${scenario.name}, sparse): visited ${sparse.visited}, recomputed ${sparse.recomputed}, expected ${nodeCount} and ${dirtyLeaves.length}`,
    );
  }

  const passFields = (label, pass, recomputedNodes) => ({
    [`${label}WarmupMeanMsPerPass`]: round(
      pass.warmupSummary.meanMs,
      MS_DIGITS,
    ),
    [`${label}MeanMsPerPass`]: round(pass.summary.meanMs, MS_DIGITS),
    [`${label}MedianMsPerPass`]: round(pass.summary.medianMs, MS_DIGITS),
    [`${label}P95MsPerPass`]: round(pass.summary.p95Ms, MS_DIGITS),
    [`${label}P99MsPerPass`]: round(pass.summary.p99Ms, MS_DIGITS),
    [`${label}MinMsPerPass`]: round(pass.summary.minMs, MS_DIGITS),
    [`${label}MaxMsPerPass`]: round(pass.summary.maxMs, MS_DIGITS),
    [`${label}RecomputedNodes`]: recomputedNodes,
    [`${label}NanosecondsPerVisitedNode`]: round(
      (pass.summary.medianMs * 1e6) / nodeCount,
      1,
    ),
  });

  return {
    scenario: scenario.name,
    shape: scenario.what,
    branching: scenario.branching,
    depth: scenario.depth,
    nodeCount,
    measuredPasses: MEASURED_PASSES,
    warmupPasses: WARMUP_PASSES,
    ...passFields("full", full, full.recomputed),
    ...passFields("sparse", sparse, sparse.recomputed),
    ...passFields("cached", cached, 0),
    fullMillionNodesPerSecond: round(
      nodeCount / full.summary.medianMs / 1000,
      2,
    ),
    cachedMillionNodesPerSecond: round(
      nodeCount / cached.summary.medianMs / 1000,
      2,
    ),
    fullOverCachedRatio: round(
      full.summary.medianMs / cached.summary.medianMs,
      2,
    ),
  };
}

// --- the run -----------------------------------------------------------------

const rows = SCENARIOS.map(runScenario);

// --- the record --------------------------------------------------------------

const host = hostRecord();
const record = {
  _note: MEASUREMENT_NOTE,
  benchmark: "scene-propagation",
  specification:
    "§7 (world-transform resolution), §7b, §92 (CPU time); plan §6j P11-4, WP-11.4",
  recordedAt: new Date().toISOString(),
  entryPoint: "resolveWorldTransforms(root, out) from @fourjs/scene",
  passKinds: {
    full: "the root is marked dirty before every pass, so every node is recomputed (asserted: recomputed === visited === nodeCount)",
    sparse: `${SPARSE_DIRTY_NODES} leaves are marked dirty before every pass (asserted: recomputed === ${SPARSE_DIRTY_NODES})`,
    cached:
      "nothing is dirty (asserted: recomputed === 0) — this is §86's idle-scene row for the scene graph",
  },
  mutationNote:
    "markDirty() runs outside the timed region: this benchmark measures resolution, not dirtying.",
  depthNote:
    "resolveWorldTransforms recurses once per level, so scene depth is bounded by the JS stack. Probed once while authoring this script (2026-08-02, node v22.22.2, this host, default stack), NOT measured per run: 8 000 deep resolves, 12 000 throws RangeError. The chain scenario here is 2 000.",
  scenarios: rows,
  keepAliveTotal: keepAliveTotal(),
  ...host,
  hostCaveat:
    "CI container, shared host; timings vary run to run by tens of percent. The visited/recomputed counts do not — they are exact and are asserted, so a green run is itself evidence the §7 caching behaves as documented. §86 has no transform-propagation row; the 111 111-node scenario is sized to §86's mesh-instance row for scale only, and says nothing about drawing it.",
};

const path = writeResult("scene-propagation", record);

// --- the report --------------------------------------------------------------

const nameWidth = Math.max(...rows.map((row) => row.scenario.length));
printReport([
  "fourJS — world-transform propagation (§7, §92; plan §6j P11-4)",
  `  passes                  ${MEASURED_PASSES} measured, ${WARMUP_PASSES} warm-up, per scenario per pass kind`,
  `  sparse pass             ${SPARSE_DIRTY_NODES} dirty leaves`,
  "",
  `  ${"scenario".padEnd(nameWidth)}     nodes   depth    full ms   sparse ms   cached ms   full ns/node`,
  ...rows.map((row) =>
    [
      `  ${row.scenario.padEnd(nameWidth)}`,
      row.nodeCount.toLocaleString("en-US").padStart(10),
      String(row.depth).padStart(8),
      String(row.fullMedianMsPerPass).padStart(11),
      String(row.sparseMedianMsPerPass).padStart(12),
      String(row.cachedMedianMsPerPass).padStart(12),
      String(row.fullNanosecondsPerVisitedNode).padStart(15),
    ].join(""),
  ),
  "",
  ...rows.map(
    (row) =>
      `  ${row.scenario.padEnd(nameWidth)}   ${row.fullMillionNodesPerSecond} M nodes/s recomputing, ${row.cachedMillionNodesPerSecond} M nodes/s cached (${row.fullOverCachedRatio}× cheaper when clean)`,
  ),
  "",
  "  asserted per pass       full: recomputed === visited === nodeCount",
  `                          sparse: recomputed === ${SPARSE_DIRTY_NODES}`,
  "                          cached: recomputed === 0  (§86's idle-scene row, for the scene graph)",
  "  depth                   the resolver recurses per level; ~8 000 deep resolves and ~12 000 overflows the",
  "                          JS stack on this host (authoring-time probe, not measured per run — see the header)",
  `  keep-alive fold         ${round(keepAliveTotal(), 6)} (proof the passes were not optimised away; not a checksum)`,
  "",
  ...hostLines(
    host,
    "shared CI container; timings vary run to run, the visited/recomputed counts do not.",
  ),
  "",
  `  written                 ${path}`,
]);
