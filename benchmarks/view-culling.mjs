/**
 * §64's per-view render lists and §87's frustum cull — what a viewport costs
 * (R-8, 2026-08-09; §92's *"CPU time"* and *"draw calls"* metrics).
 *
 * ```sh
 * bun run build          # this script imports the built dist, not src
 * node benchmarks/view-culling.mjs
 * ```
 *
 * ## The question this exists to answer
 *
 * R-8 had two shapes to choose between, and the choice is the packet's main
 * design decision:
 *
 * - **derive** — traverse the scene **once** into the frame's list, then filter
 *   that list into a per-view list for each viewport (what shipped);
 * - **rebuild** — call `buildRenderList(root, list, mask)` once **per view**
 *   (the rejected alternative).
 *
 * The argument for deriving was partly structural — traversal has side effects
 * (a particle system repacks its instances, a sprite rebuilds its quad), and
 * §69's shadow map is frame state that must not be filtered by any one view —
 * and partly a cost claim: `render-batching.mjs` measures list construction at
 * roughly 40% of a 100 000-sprite frame's preparation, and multiplying that by
 * the viewport count to answer a question that differs between viewports by a
 * bitmask and six planes is the wrong trade. This script measures the cost
 * claim rather than asserting it, at one, two and four views.
 *
 * ## What one iteration is
 *
 * One iteration is **one frame's list work** for `views` viewports:
 *
 * ```text
 * derive:   resolveWorldTransforms + buildRenderList + views × buildViewRenderList
 * rebuild:  resolveWorldTransforms + views × buildRenderList
 * ```
 *
 * Both arms end with the same per-view lists, so the difference is exactly the
 * design choice. Neither arm draws anything: submission needs a GPU, which a
 * headless CI container does not have, so — like `render-batching.mjs` — this
 * measures preparation only.
 *
 * A third arm measures the derivation **without** a frustum, so a reader can
 * separate §46's layer filter (one bitwise AND per item) from §87's cull (a
 * bounding sphere and up to six plane tests per item).
 *
 * ## What the draw-call number means
 *
 * `drawCallsCulled` is how many items survive into one view, and
 * `drawCallsUnculled` how many the same view drew before this packet: the scene
 * is authored so that a fixed fraction is off screen, which is what makes the
 * ratio a statement about culling rather than about the scene's size.
 *
 * ## Determinism and wall clocks
 *
 * The scene is authored from {@link SEED} through a small LCG, so two runs
 * build the identical graph (§33); no clock reaches the engine. `measure` from
 * `harness.mjs` owns the only `performance.now()`.
 *
 * Recorded, never gated — see `benchmarks/README.md`.
 */

import { Frustum, Matrix4 } from "@fourjs/math";
import { UnlitMaterial } from "@fourjs/materials";
import { Rectangle, buildRenderList, buildViewRenderList } from "@fourjs/render";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
} from "@fourjs/scene";

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

/** Node counts measured, in report order. */
const NODE_COUNTS = [10000, 50000, 100000];

/** Viewport counts measured, in report order: one view, split-screen, a quad view. */
const VIEW_COUNTS = [1, 2, 4];

/** Measured frames per scenario. */
const MEASURED_FRAMES = 30;

/** Unmeasured frames first, so the reported median is steady-state. */
const WARMUP_FRAMES = 10;

/** Seed of the LCG that places the nodes. Fixed: two runs build one scene (§33). */
const SEED = 0x1d3b7f05;

/** Decimals kept for the per-frame millisecond statistics. */
const MS_DIGITS = 4;

/** The frame budget at 60 Hz, in milliseconds. */
const FRAME_BUDGET_MS = 1000 / 60;

/** Half-width of the camera's box; the scene is authored twice this wide. */
const VIEW_HALF_WIDTH = 16;

/** Half-height of the camera's box. */
const VIEW_HALF_HEIGHT = 9;

/** A 32-bit LCG (Numerical Recipes constants), as every other script here uses. */
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * `count` §50 rectangles over one `UnlitMaterial`, spread over **four times**
 * the camera's area — so roughly a quarter of them are on screen and the cull
 * has a real decision to make on every item rather than a foregone one.
 */
function wideScene(count) {
  const random = createRandom(SEED);
  const scene = new Scene();
  const material = new UnlitMaterial({ color: [0.2, 0.6, 1, 1] });
  for (let i = 0; i < count; i += 1) {
    const node = new Rectangle({ material, width: 0.3, height: 0.2 });
    node.transform.position.set(
      random() * VIEW_HALF_WIDTH * 4 - VIEW_HALF_WIDTH * 2,
      random() * VIEW_HALF_HEIGHT * 4 - VIEW_HALF_HEIGHT * 2,
      0,
    );
    scene.add(node);
  }
  return scene;
}

/** A camera that sees the middle of {@link wideScene}, and its viewport. */
function createView(id) {
  const camera = new OrthographicCamera({
    left: -VIEW_HALF_WIDTH,
    right: VIEW_HALF_WIDTH,
    bottom: -VIEW_HALF_HEIGHT,
    top: VIEW_HALF_HEIGHT,
  });
  camera.transform.position.set(0, 0, 5);
  camera.updateProjectionMatrix();
  camera.updateViewMatrix();
  const frustum = new Frustum().setFromViewProjection(
    new Matrix4().copy(camera.projectionMatrix).multiply(camera.viewMatrix),
  );
  return { view: createFullscreenViewport(camera, id), frustum };
}

/** The shipped design: one traversal, one derivation per view. */
function deriveFrame(scene, frameList, views, viewLists, cull) {
  resolveWorldTransforms(scene);
  const items = buildRenderList(scene, frameList);
  let drawn = 0;
  for (let i = 0; i < views.length; i += 1) {
    const derived = buildViewRenderList(items, views[i].view, viewLists[i], {
      frustum: cull ? views[i].frustum : null,
    });
    drawn += derived.length;
  }
  return drawn;
}

/** The rejected alternative: one traversal per view. */
function rebuildFrame(scene, views, viewLists) {
  resolveWorldTransforms(scene);
  let drawn = 0;
  for (let i = 0; i < views.length; i += 1) {
    drawn += buildRenderList(scene, viewLists[i]).length;
  }
  return drawn;
}

/** Measures one scenario and returns its row. */
function runScenario(count, viewCount) {
  const scene = wideScene(count);
  const views = [];
  const viewLists = [];
  const rebuildLists = [];
  for (let i = 0; i < viewCount; i += 1) {
    views.push(createView(`view-${String(i)}`));
    viewLists.push([]);
    rebuildLists.push([]);
  }
  const frameList = [];

  const drawnCulled = deriveFrame(scene, frameList, views, viewLists, true);
  const drawnUnculled = deriveFrame(scene, frameList, views, viewLists, false);

  const derived = measure(
    () => {
      keepAlive(deriveFrame(scene, frameList, views, viewLists, true));
    },
    { warmupIterations: WARMUP_FRAMES, measuredIterations: MEASURED_FRAMES },
  );
  const derivedNoCull = measure(
    () => {
      keepAlive(deriveFrame(scene, frameList, views, viewLists, false));
    },
    { warmupIterations: WARMUP_FRAMES, measuredIterations: MEASURED_FRAMES },
  );
  const rebuilt = measure(
    () => {
      keepAlive(rebuildFrame(scene, views, rebuildLists));
    },
    { warmupIterations: WARMUP_FRAMES, measuredIterations: MEASURED_FRAMES },
  );

  const derivedSummary = summarize(derived.measured);
  const noCullSummary = summarize(derivedNoCull.measured);
  const rebuiltSummary = summarize(rebuilt.measured);
  return {
    nodes: count,
    views: viewCount,
    drawCallsUnculled: drawnUnculled,
    drawCallsCulled: drawnCulled,
    drawCallReduction: round(drawnUnculled / Math.max(drawnCulled, 1), 2),
    deriveMedianMsPerFrame: round(derivedSummary.medianMs, MS_DIGITS),
    deriveP95MsPerFrame: round(derivedSummary.p95Ms, MS_DIGITS),
    deriveNoCullMedianMsPerFrame: round(noCullSummary.medianMs, MS_DIGITS),
    rebuildMedianMsPerFrame: round(rebuiltSummary.medianMs, MS_DIGITS),
    cullMedianMsPerFrame: round(
      derivedSummary.medianMs - noCullSummary.medianMs,
      MS_DIGITS,
    ),
    rebuildOverDeriveNoCull: round(
      rebuiltSummary.medianMs / noCullSummary.medianMs,
      2,
    ),
    cullNanosecondsPerNodePerView: round(
      ((derivedSummary.medianMs - noCullSummary.medianMs) * 1e6) /
        (count * viewCount),
      1,
    ),
    deriveInsideFrameBudgetAtP95: derivedSummary.p95Ms < FRAME_BUDGET_MS,
  };
}

// --- the run -----------------------------------------------------------------

const rows = [];
for (const count of NODE_COUNTS) {
  for (const viewCount of VIEW_COUNTS) {
    rows.push(runScenario(count, viewCount));
  }
}

// Structural assertions: a green exit means the run measured what it claims.
// The whole point is that culling removes work, so a run that culled nothing is
// a broken benchmark rather than a fast one.
for (const row of rows) {
  if (row.drawCallsUnculled !== row.nodes * row.views) {
    throw new Error(
      `${String(row.nodes)} nodes × ${String(row.views)} views: expected ` +
        `${String(row.nodes * row.views)} unculled draws, counted ` +
        String(row.drawCallsUnculled),
    );
  }
  if (row.drawCallsCulled >= row.drawCallsUnculled) {
    throw new Error(
      `${String(row.nodes)} nodes × ${String(row.views)} views: culling kept ` +
        `${String(row.drawCallsCulled)} of ${String(row.drawCallsUnculled)}`,
    );
  }
}

const host = hostRecord();
const record = {
  _note: MEASUREMENT_NOTE,
  benchmark: "view-culling",
  specification:
    "§64 stages 2-3 (per-view visibility, layer filtering and frustum culling); §87 spatial indexing and culling; §92 CPU time and draw calls",
  recordedAt: new Date().toISOString(),
  iteration:
    "derive: resolveWorldTransforms + buildRenderList + views x buildViewRenderList; rebuild: resolveWorldTransforms + views x buildRenderList",
  rowNote:
    "Preparation only. Issuing the surviving draws needs a GPU, which a headless CI container does not have.",
  sceneNote:
    "The scene covers four times the camera's area, so roughly a quarter of the nodes are on screen and every item is a real decision.",
  measuredFramesPerScenario: MEASURED_FRAMES,
  warmupFramesPerScenario: WARMUP_FRAMES,
  frameBudgetMs: round(FRAME_BUDGET_MS, 3),
  scenarios: rows,
  designNote:
    "rebuildOverDeriveNoCull compares like with like: both arms produce the same layer-filtered per-view lists, one by traversing per view and one by deriving. cullMedianMsPerFrame is the frustum test alone (derived-with-cull minus derived-without) and is NOT part of that comparison, because the rejected alternative would have paid it too.",
  keepAliveTotal: round(keepAliveTotal(), 6),
  ...host,
  hostCaveat:
    "CI container, no GPU, shared host; run-to-run spread is tens of percent. Nothing here is a §86 verdict — §86 has no culling row.",
};

const path = writeResult("view-culling", record);

// --- the report --------------------------------------------------------------

const lines = [
  "fourJS — §64 per-view render lists and §87 frustum culling (R-8)",
  "",
  `  iteration               one frame's list work for N views: derive vs. rebuild`,
  `  frames                  ${String(MEASURED_FRAMES)} measured, ${String(
    WARMUP_FRAMES,
  )} warm-up, per scenario`,
  `  scene                   4x the camera's area, so ~1/4 of the nodes are visible`,
  "",
  "   nodes   views    draws→   derive ms   cull ms   filter ms   rebuild ms   rebuild/filter",
];
for (const row of rows) {
  lines.push(
    `  ${String(row.nodes).padStart(6)}  ${String(row.views).padStart(
      6,
    )}  ${String(row.drawCallsCulled).padStart(8)}  ${String(
      row.deriveMedianMsPerFrame,
    ).padStart(10)}  ${String(row.cullMedianMsPerFrame).padStart(
      8,
    )}  ${String(row.deriveNoCullMedianMsPerFrame).padStart(10)}  ${String(
      row.rebuildMedianMsPerFrame,
    ).padStart(11)}  ${String(row.rebuildOverDeriveNoCull).padStart(14)}x`,
  );
}
lines.push(
  "",
  `  the design decision     'filter ms' and 'rebuild ms' produce the SAME per-view lists,`,
  `                          one by deriving and one by traversing per view; the last column`,
  `                          is what the rejected alternative would have cost. The cull is`,
  `                          separate and would have been paid by either design.`,
  `  what is NOT here        submitting the surviving draws. No GPU, so this is preparation only.`,
  `  keep-alive fold         ${String(round(keepAliveTotal(), 6))} (proof the passes were not optimised away; not a checksum)`,
  "",
  ...hostLines(
    host,
    "shared CI container; §86 has no culling row, so nothing here is a §86 verdict.",
  ),
  "",
  `  written                 ${path}`,
);
printReport(lines);
