/**
 * §65 batching throughput — the CPU half of §86's *"batched sprites: 100 000 at
 * 60 FPS"* and *"simple batched shapes: 50 000 at 60 FPS"* rows (R-9,
 * 2026-08-09; §64 stages 4–6, §92's *"CPU time"* and *"draw calls"* metrics).
 *
 * ```sh
 * bun run build          # this script imports the built dist, not src
 * node benchmarks/render-batching.mjs
 * ```
 *
 * ## Which half of the rows this is, and which half it is not
 *
 * Both rows are a *rate*: N sprites, or N shapes, at 60 FPS. A frame of that
 * costs two things — **preparing the draws** and **issuing them**. This script
 * measures the first half only, which is exactly what `@fourjs/render` does per
 * frame and is pure CPU work:
 *
 * ```text
 * buildRenderList(scene, list)      §64 stages 1–2 and 4–5
 * batcher.next(list, i)             §64 stage 6 — plan the run, bake its vertices
 * ```
 *
 * The second half is `bufferSubData` + `drawElements` against a driver, and a
 * headless container has no GPU to issue them to. Until this script existed
 * `benchmarks/README.md` filed both rows under **feature** — "there is no sprite
 * batching", "there is no shape system to batch" — and both statements are now
 * out of date; they become **half** rows, joining `ui-layout.mjs` and
 * `text-layout.mjs` in the category A-27 opened for exactly this shape of
 * result.
 *
 * ## What one iteration is
 *
 * One iteration is **one frame's preparation**: `resolveWorldTransforms`, then
 * `buildRenderList` into a reused array, then a left-to-right pass calling
 * `RenderBatcher.next` and skipping the items each batch consumes. That pass
 * writes every merged vertex — the world transform of each item baked into a
 * `Float32Array` — so the number below includes the whole cost a backend would
 * hand to `bufferSubData`, not just the decision to batch.
 *
 * A second scenario per row measures `buildRenderList` **alone**, with no
 * batcher, so a reader can separate the list from the batching. It is not a
 * measurement of the unbatched *frame*: the per-item uniform uploads and draw
 * calls that frame would issue are backend work this script cannot see.
 *
 * ## What the draw-call numbers mean
 *
 * `drawCallsUnbatched` is the number of draw calls the WebGL 2 backend issues
 * for the scene today with no batcher assigned — one per render item, which is
 * a fact about `webgl-renderer.ts`'s loop and needs no GPU to count.
 * `drawCallsBatched` is what the same scene costs with one: one call per batch
 * the planner produced. Their ratio is the whole point of §65 and is the one
 * number here that is not a timing.
 *
 * ## Determinism and wall clocks
 *
 * The scenes are authored from {@link SEED} through a small LCG, so two runs
 * build the identical graph (§33); no clock reaches the engine. `measure` from
 * `harness.mjs` owns the only `performance.now()`, and deleting it would leave
 * every vertex this script produces bit-identical.
 *
 * Recorded, never gated — see `benchmarks/README.md`.
 */

import { SpriteMaterial, UnlitMaterial } from "@fourjs/materials";
import {
  RenderBatcher,
  Rectangle,
  Sprite,
  Texture,
  buildRenderList,
} from "@fourjs/render";
import { Scene, resolveWorldTransforms } from "@fourjs/scene";

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

/** Sprite counts measured, in report order. 100 000 is §86's row verbatim. */
const SPRITE_COUNTS = [10000, 50000, 100000];

/** Shape counts measured, in report order. 50 000 is §86's row verbatim. */
const SHAPE_COUNTS = [5000, 25000, 50000];

/** Measured frames per scenario. */
const MEASURED_FRAMES = 30;

/** Unmeasured frames first, so the reported mean is steady-state. */
const WARMUP_FRAMES = 10;

/** Seed of the LCG that places the nodes. Fixed: two runs build one scene (§33). */
const SEED = 0x1d3b7f05;

/** Decimals kept for the per-frame millisecond statistics. */
const MS_DIGITS = 4;

/**
 * The frame budget at 60 Hz, in milliseconds — the rate both §86 rows state
 * explicitly, unlike the retained-UI and glyph rows `ui-layout.mjs` and
 * `text-layout.mjs` had to interpret.
 */
const FRAME_BUDGET_MS = 1000 / 60;

/** A 32-bit LCG (Numerical Recipes constants), as every other script here uses. */
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * §86's sprite row as a scene: `count` sprites over **one** `SpriteMaterial`,
 * which is the authoring an atlas implies (§55's `frame` addresses cells of one
 * texture, R-29) and the authoring §65 is written for.
 */
function spriteScene(count) {
  const random = createRandom(SEED);
  const scene = new Scene();
  const material = new SpriteMaterial({
    texture: new Texture({ width: 64, height: 64 }),
  });
  for (let i = 0; i < count; i += 1) {
    const node = new Sprite(material, { width: 0.2, height: 0.2 });
    node.transform.position.set(random() * 32 - 16, random() * 18 - 9, 0);
    scene.add(node);
  }
  return scene;
}

/**
 * §86's shape row as a scene: `count` §50 rectangles over one
 * `UnlitMaterial` — "simple shapes", tessellated once at construction (R-23)
 * and merged here.
 */
function shapeScene(count) {
  const random = createRandom(SEED);
  const scene = new Scene();
  const material = new UnlitMaterial({ color: [0.2, 0.6, 1, 1] });
  for (let i = 0; i < count; i += 1) {
    const node = new Rectangle({ material, width: 0.3, height: 0.2 });
    node.transform.position.set(random() * 32 - 16, random() * 18 - 9, 0);
    scene.add(node);
  }
  return scene;
}

/**
 * One frame's preparation, with or without §65 batching, returning the number
 * of draw calls a backend would issue for it.
 *
 * The `batcher === null` arm is `buildRenderList` and nothing else, so the two
 * arms differ by exactly the batching pass.
 */
function prepareFrame(scene, list, batcher) {
  resolveWorldTransforms(scene);
  const items = buildRenderList(scene, list);
  if (batcher === null) {
    return items.length;
  }
  let draws = 0;
  for (let i = 0; i < items.length; i += 1) {
    const batch = batcher.next(items, i);
    if (batch === null) {
      draws += 1;
      continue;
    }
    // Touch the assembled stream so no engine may elide the work that built it.
    keepAlive(batch.vertices[0]);
    draws += 1;
    i += batch.items - 1;
  }
  return draws;
}

/** Measures one scenario and returns its row. */
function runScenario(label, count, scene) {
  const list = [];
  const batcher = new RenderBatcher();
  const drawCallsUnbatched = prepareFrame(scene, list, null);
  const drawCallsBatched = prepareFrame(scene, list, batcher);

  const listOnly = measure(
    () => {
      keepAlive(prepareFrame(scene, list, null));
    },
    {
      warmupIterations: WARMUP_FRAMES,
      measuredIterations: MEASURED_FRAMES,
    },
  );
  const batched = measure(
    () => {
      keepAlive(prepareFrame(scene, list, batcher));
    },
    {
      warmupIterations: WARMUP_FRAMES,
      measuredIterations: MEASURED_FRAMES,
    },
  );

  const listSummary = summarize(listOnly.measured);
  const batchedSummary = summarize(batched.measured);
  return {
    scenario: label,
    nodes: count,
    drawCallsUnbatched,
    drawCallsBatched,
    drawCallReduction: round(drawCallsUnbatched / drawCallsBatched, 1),
    listMedianMsPerFrame: round(listSummary.medianMs, MS_DIGITS),
    batchedMedianMsPerFrame: round(batchedSummary.medianMs, MS_DIGITS),
    batchedP95MsPerFrame: round(batchedSummary.p95Ms, MS_DIGITS),
    batchingMedianMsPerFrame: round(
      batchedSummary.medianMs - listSummary.medianMs,
      MS_DIGITS,
    ),
    batchedNanosecondsPerNode: round(
      (batchedSummary.medianMs * 1e6) / count,
      1,
    ),
    batchedInsideFrameBudgetAtP95: batchedSummary.p95Ms < FRAME_BUDGET_MS,
  };
}

// --- the run -----------------------------------------------------------------

const rows = [
  ...SPRITE_COUNTS.map((count) =>
    runScenario("sprites", count, spriteScene(count)),
  ),
  ...SHAPE_COUNTS.map((count) =>
    runScenario("shapes", count, shapeScene(count)),
  ),
];

const spriteTarget = rows.find(
  (row) => row.scenario === "sprites" && row.nodes === 100000,
);
const shapeTarget = rows.find(
  (row) => row.scenario === "shapes" && row.nodes === 50000,
);

// Structural assertions: a green exit means the run measured what it claims.
// Both rows are about *merging*, so a run that merged nothing is a broken
// benchmark rather than a slow one.
for (const row of rows) {
  if (row.drawCallsBatched >= row.drawCallsUnbatched) {
    throw new Error(
      `${row.scenario} ${String(row.nodes)}: batching produced ${String(
        row.drawCallsBatched,
      )} draw calls against ${String(row.drawCallsUnbatched)} unbatched`,
    );
  }
  if (row.drawCallsUnbatched !== row.nodes) {
    throw new Error(
      `${row.scenario} ${String(row.nodes)}: expected one unbatched draw call ` +
        `per node, counted ${String(row.drawCallsUnbatched)}`,
    );
  }
}

const host = hostRecord();
const record = {
  _note: MEASUREMENT_NOTE,
  benchmark: "render-batching",
  specification:
    "§86 batched sprites (100 000 at 60 FPS) and simple batched shapes (50 000 at 60 FPS), CPU half; §64 stages 4–6; §65; §92 CPU time and draw calls",
  recordedAt: new Date().toISOString(),
  iteration:
    "resolveWorldTransforms + buildRenderList + RenderBatcher.next over the whole list, writing every merged vertex",
  rowNote:
    "HALF of each row: the preparation is measured, the submission is not. Issuing the merged draws needs a GPU, which a headless CI container does not have.",
  measuredFramesPerScenario: MEASURED_FRAMES,
  warmupFramesPerScenario: WARMUP_FRAMES,
  frameBudgetMs: round(FRAME_BUDGET_MS, 3),
  maxBatchVertices: new RenderBatcher().maxVertices,
  scenarios: rows,
  spriteRow: spriteTarget,
  shapeRow: shapeTarget,
  batchingNote:
    "batchingMedianMsPerFrame is the batching pass alone (batched − list-only): planning every run and baking every world transform into the interleaved stream.",
  keepAliveTotal: round(keepAliveTotal(), 6),
  ...host,
  hostCaveat:
    "CI container, no GPU, shared host; run-to-run spread is tens of percent. §86's 'suitable modern desktop hardware' is not this machine, so nothing here is a §86 verdict — and the submission half of both rows is not measured at all.",
};

const path = writeResult("render-batching", record);

// --- the report --------------------------------------------------------------

printReport([
  "fourJS — §65 batching throughput (§86 batched sprites and shapes, CPU half; §64, §92)",
  `  iteration               resolveWorldTransforms + buildRenderList + RenderBatcher.next over the list`,
  `  frames                  ${MEASURED_FRAMES} measured, ${WARMUP_FRAMES} warm-up, per scenario`,
  `  60 Hz frame budget      ${round(FRAME_BUDGET_MS, 3)} ms (both rows state the rate themselves)`,
  "",
  "  scenario     nodes   draws→   list ms   batch ms   batching ms   ns/node   % of frame",
  ...rows.map((row) =>
    [
      row.scenario.padStart(10),
      String(row.nodes).padStart(9),
      `${String(row.drawCallsBatched)}`.padStart(8),
      String(row.listMedianMsPerFrame).padStart(10),
      String(row.batchedMedianMsPerFrame).padStart(11),
      String(row.batchingMedianMsPerFrame).padStart(14),
      String(row.batchedNanosecondsPerNode).padStart(10),
      `${round((row.batchedMedianMsPerFrame / FRAME_BUDGET_MS) * 100, 1)}%`.padStart(
        13,
      ),
    ].join(""),
  ),
  "",
  `  §86 sprite row          ${spriteTarget.nodes.toLocaleString("en-US")} sprites prepare in ${spriteTarget.batchedMedianMsPerFrame} ms and draw in ${spriteTarget.drawCallsBatched} call(s)`,
  `                          instead of ${spriteTarget.drawCallsUnbatched.toLocaleString("en-US")} — a ${spriteTarget.drawCallReduction}× reduction; ${spriteTarget.batchedInsideFrameBudgetAtP95 ? "inside" : "OVER"} the budget at p95, preparation only`,
  `  §86 shape row           ${shapeTarget.nodes.toLocaleString("en-US")} shapes prepare in ${shapeTarget.batchedMedianMsPerFrame} ms and draw in ${shapeTarget.drawCallsBatched} call(s)`,
  `                          instead of ${shapeTarget.drawCallsUnbatched.toLocaleString("en-US")} — a ${shapeTarget.drawCallReduction}× reduction; ${shapeTarget.batchedInsideFrameBudgetAtP95 ? "inside" : "OVER"} the budget at p95, preparation only`,
  `  what is NOT here        submitting those draws. No GPU, so both rows stay half-rows.`,
  `  keep-alive fold         ${round(keepAliveTotal(), 6)} (proof the passes were not optimised away; not a checksum)`,
  "",
  ...hostLines(
    host,
    "shared CI container; the submission half of both §86 rows is not measured here — see the record's rowNote.",
  ),
  "",
  `  written                 ${path}`,
]);
