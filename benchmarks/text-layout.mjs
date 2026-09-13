/**
 * Glyph layout throughput — the CPU half of §86's *"animated glyphs: 20 000"*
 * row (§56 text at its MVP tier; §92's *"CPU time"* metric).
 *
 * ```sh
 * bun run build          # this script imports the built dist, not src
 * node benchmarks/text-layout.mjs
 * ```
 *
 * ## Which half of the row this is, and which half stays blocked
 *
 * §86 asks for 20 000 animated glyphs. Getting 20 000 glyphs onto a screen is
 * two costs, and only one of them is CPU work `@fourjs/text` does:
 *
 * 1. **Producing the quads** — `layoutText(string, atlas, options)` turning a
 *    string into one positioned, uv-mapped rectangle per drawn glyph. Pure
 *    arithmetic, no engine objects, no renderer, no DOM. That is this file.
 * 2. **Drawing them.** Blocked until 2026-08-13, and not on hardware: §56's
 *    bitmap tier shipped an atlas that could not be addressed per glyph, so the
 *    documented workaround (`examples/first-2d-scene`, `examples/ui-demo`) cut
 *    every glyph cell into its own `Texture` — a texture bind and a draw call
 *    per glyph. **R-29's §55 `frame` and R-28's `Text` node closed that**, and
 *    the second half of this script measures what replaced it: `Text` turns a
 *    layout into **one** indexed vertex buffer over **one** atlas material, so
 *    20 000 glyphs are one `drawElements` and the CPU cost is the buffer build.
 *
 * The *submission* of that draw is still GPU work a headless script cannot
 * measure, exactly as `render-batching.mjs` says of its own rows — so the row
 * moves from **feature**-blocked to **half**-measured in both halves' sense:
 * preparation measured, submission GPU-blocked.
 *
 * ## What "animated" costs, honestly
 *
 * A glyph that merely **moves** is laid out **once**: the quads are geometry,
 * and animating the node's transform never re-enters `layoutText`. Only text
 * whose **content** changes — a counter, a typewriter, a scrolling log, a
 * per-frame readout — pays this cost again. So the numbers here are the
 * **worst case** for §86's row, not its normal case, and reading them as the
 * price of 20 000 animated glyphs would overstate it. The row's normal case is
 * one layout at authoring time and 20 000 quads redrawn per frame, which is
 * cost (2) above.
 *
 * ## What is measured
 *
 * One iteration is **one `layoutText` call per string in the corpus** — a frame
 * in which every string's content changed. Corpora are sized by **total drawn
 * glyphs**, which is what §86 counts, not by characters: a space advances the
 * pen and emits no quad, so `quads.length` is below the character count and the
 * script asserts the exact expected value rather than assuming it.
 *
 * ## Attribution
 *
 * A total-glyph number cannot say whether a call or a glyph is the expensive
 * thing, so at {@link ATTRIBUTION_GLYPHS} glyphs the same work is re-measured
 * across four string lengths — {@link ATTRIBUTION_LENGTHS} — from 20 000
 * one-glyph calls to 100 two-hundred-glyph calls. Two of those rows solve
 * `total = calls · perCall + glyphs · perGlyph` exactly, and both terms are
 * recorded.
 *
 * A third term is visible from the source rather than from a clock:
 * `layoutText` **allocates and freezes one object per drawn glyph**, plus a
 * frozen array and a frozen result per call. At §86's 20 000 glyphs that is
 * 20 000 `Object.freeze` calls per frame. Its share is bounded by a **control
 * row** — {@link ATTRIBUTION_GLYPHS} plain object literals of the same eight
 * numeric fields, created and frozen in this file, touching no engine code at
 * all. It is labelled a control because that is what it is: a measurement of
 * the platform primitive, published so the per-glyph figure above it can be
 * read, and not a measurement of `@fourjs/text`.
 *
 * ## Determinism and wall clocks
 *
 * The corpus is generated from {@link SEED} through a small LCG, so two runs
 * lay out identical strings (§33). `layoutText` is pure — same string, same
 * atlas, same options, identical numbers — which the script asserts by
 * comparing a probe quad across the whole run. No clock reaches it;
 * `performance.now()` lives in `harness.mjs`.
 *
 * Recorded, never gated — see `benchmarks/README.md`.
 */

import { UnlitMaterial } from "@fourjs/materials";
import { Texture } from "@fourjs/render";
import { buildGlyphAtlas, layoutText } from "@fourjs/text";
import { Text } from "fourJS";

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

/**
 * Total **drawn glyphs** per measured frame, in report order. 20 000 is §86's
 * row verbatim; 50 000 is there because the row is a floor rather than a
 * ceiling and the shape of the curve past it is worth one line.
 */
const GLYPH_COUNTS = [1000, 5000, 20000, 50000];

/** Glyph count the attribution rows all share — §86's own number. */
const ATTRIBUTION_GLYPHS = 20000;

/**
 * Characters per string in the attribution rows. `1` is the pathological
 * per-call case (one call per glyph); `200` is a paragraph. Both divide
 * {@link ATTRIBUTION_GLYPHS} exactly, so every row lays out the same number of
 * glyphs and only the call count changes.
 */
const ATTRIBUTION_LENGTHS = [1, 8, 25, 200];

/** Characters per string in the headline sweep — a label-sized string. */
const HEADLINE_LENGTH = 25;

/** Measured frames per scenario. */
const MEASURED_FRAMES = 120;

/** Unmeasured frames first, so the reported mean is steady-state. */
const WARMUP_FRAMES = 30;

/** Seed of the corpus LCG. Fixed: two runs lay out one corpus (§33). */
const SEED = 0x1f83d9ab;

/** World units per line. One value throughout: `size` scales nothing here. */
const TEXT_SIZE = 0.25;

/** Decimals kept for the per-frame millisecond statistics. */
const MS_DIGITS = 4;

/**
 * The frame budget at 60 Hz, in milliseconds.
 *
 * §86 states the animated-glyph row as a **count** and no rate; its neighbours
 * in the same table say "at 60 FPS". 60 Hz is this file's reading of the table,
 * said out loud, and not a rate the specification states for this row.
 */
const FRAME_BUDGET_MS = 1000 / 60;

/** A 32-bit LCG (Numerical Recipes constants), as the determinism suites use. */
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Every character the corpus draws from — all covered by the built-in face. */
const ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/**
 * `length` characters with **no spaces and no newlines**, so drawn glyphs and
 * characters are the same number and a glyph count is exact by construction.
 */
function makeRun(random, length) {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return out;
}

/**
 * The atlas, built once. Building it is **setup, not a per-frame cost**, so it
 * is timed separately and reported as a one-off rather than folded into any
 * throughput number.
 */
const atlasBuildBegan = process.hrtime.bigint();
const ATLAS = buildGlyphAtlas();
const ATLAS_BUILD_MS = Number(process.hrtime.bigint() - atlasBuildBegan) / 1e6;

/**
 * Builds a corpus of `Math.ceil(glyphs / length)` strings of `length` glyphs
 * each, and returns it with the exact number of quads a frame must produce.
 */
function buildCorpus(glyphs, length) {
  const random = createRandom(SEED);
  const strings = [];
  let drawn = 0;
  while (drawn < glyphs) {
    const size = Math.min(length, glyphs - drawn);
    strings.push(makeRun(random, size));
    drawn += size;
  }
  return { strings, drawnGlyphs: drawn };
}

/** Runs one (glyphs × string length) scenario and returns its record row. */
function runScenario(glyphs, length) {
  const { strings, drawnGlyphs } = buildCorpus(glyphs, length);

  // One layout up front: the probe every measured frame must reproduce, and
  // the proof that the corpus draws the number of quads the row claims.
  let quadsPerFrame = 0;
  for (let i = 0; i < strings.length; i += 1) {
    quadsPerFrame += layoutText(strings[i], ATLAS, { size: TEXT_SIZE }).quads
      .length;
  }
  if (quadsPerFrame !== drawnGlyphs) {
    throw new Error(
      `text-layout invalid (${glyphs}×${length}): corpus draws ${quadsPerFrame} quads, expected ${drawnGlyphs}`,
    );
  }
  const reference = layoutText(strings[0], ATLAS, { size: TEXT_SIZE });

  let lastWidth = 0;
  let lastQuadX = 0;
  const { warmup, measured } = measure(
    () => {
      let width = 0;
      let firstX = 0;
      for (let i = 0; i < strings.length; i += 1) {
        const layout = layoutText(strings[i], ATLAS, { size: TEXT_SIZE });
        width += layout.width;
        if (i === 0) firstX = layout.quads[0].x1;
      }
      lastWidth = width;
      lastQuadX = firstX;
      keepAlive(width);
    },
    { warmupIterations: WARMUP_FRAMES, measuredIterations: MEASURED_FRAMES },
  );

  // `layoutText` is documented as pure (§33). If the last frame disagrees with
  // the reference, the corpus or the atlas moved under the benchmark and no
  // number in this row means anything.
  if (lastQuadX !== reference.quads[0].x1) {
    throw new Error(
      `text-layout invalid (${glyphs}×${length}): probe quad moved from ${reference.quads[0].x1} to ${lastQuadX} — layoutText is documented pure`,
    );
  }
  if (!(lastWidth > 0)) {
    throw new Error(
      `text-layout invalid (${glyphs}×${length}): total width ${lastWidth}, expected positive`,
    );
  }

  const summary = summarize(measured);
  return {
    glyphs: drawnGlyphs,
    charactersPerString: length,
    calls: strings.length,
    quadsPerFrame,
    measuredFrames: MEASURED_FRAMES,
    warmupFrames: WARMUP_FRAMES,
    warmupMeanMsPerFrame: round(summarize(warmup).meanMs, MS_DIGITS),
    meanMsPerFrame: round(summary.meanMs, MS_DIGITS),
    medianMsPerFrame: round(summary.medianMs, MS_DIGITS),
    p95MsPerFrame: round(summary.p95Ms, MS_DIGITS),
    p99MsPerFrame: round(summary.p99Ms, MS_DIGITS),
    minMsPerFrame: round(summary.minMs, MS_DIGITS),
    maxMsPerFrame: round(summary.maxMs, MS_DIGITS),
    nanosecondsPerGlyph: round((summary.medianMs * 1e6) / drawnGlyphs, 1),
    microsecondsPerCall: round((summary.medianMs * 1000) / strings.length, 3),
    millionGlyphsPerSecond: round(drawnGlyphs / summary.medianMs / 1000, 2),
    meanFractionOfFrameBudget: round(summary.meanMs / FRAME_BUDGET_MS, 4),
    insideFrameBudgetAtP95: summary.p95Ms <= FRAME_BUDGET_MS,
  };
}

/**
 * The freeze control: {@link ATTRIBUTION_GLYPHS} object literals of the same
 * eight numeric fields a `TextQuad` carries, pushed into an array and frozen,
 * with the array frozen at the end — `layoutText`'s allocation shape and
 * nothing else.
 *
 * **This measures the platform, not the engine.** It exists so the per-glyph
 * figures above can be read against the cost of the allocation-and-freeze they
 * necessarily contain. `math-ops.mjs`'s published `baseline (no op)` row is the
 * precedent for printing a floor next to the rows it bounds.
 */
function runFreezeControl() {
  const { warmup, measured } = measure(
    (index) => {
      const bias = index * 1e-6;
      const quads = [];
      for (let i = 0; i < ATTRIBUTION_GLYPHS; i += 1) {
        quads.push(
          Object.freeze({
            x0: i + bias,
            y0: -1,
            x1: i + 1,
            y1: 1,
            u0: 0,
            v0: 0,
            u1: 1,
            v1: 1,
          }),
        );
      }
      Object.freeze(quads);
      keepAlive(quads[ATTRIBUTION_GLYPHS - 1].x0);
    },
    { warmupIterations: WARMUP_FRAMES, measuredIterations: MEASURED_FRAMES },
  );
  const summary = summarize(measured);
  return {
    objects: ATTRIBUTION_GLYPHS,
    what: "plain object literals with a TextQuad's eight numeric fields, each Object.freeze'd, collected into one frozen array — no engine code",
    measuredFrames: MEASURED_FRAMES,
    warmupMeanMsPerFrame: round(summarize(warmup).meanMs, MS_DIGITS),
    medianMsPerFrame: round(summary.medianMs, MS_DIGITS),
    p95MsPerFrame: round(summary.p95Ms, MS_DIGITS),
    nanosecondsPerObject: round(
      (summary.medianMs * 1e6) / ATTRIBUTION_GLYPHS,
      1,
    ),
  };
}

/**
 * The geometry half of §86's row (R-28, 2026-08-13) — what it costs to turn a
 * layout into the vertex buffers a frame actually draws, and how many draw
 * calls that is.
 *
 * One iteration is: assign a new string to every `Text` node in the corpus and
 * read `geometry` back, which is one `layoutText` plus one positions / uv /
 * index rebuild per node. That is the **whole** CPU cost of an animated-glyph
 * frame whose content changed — the row's worst case, for the reason the
 * module header gives — and it is strictly more than the layout rows above,
 * which stop at the quads.
 *
 * The number that closes the old blocker is not a millisecond, though: it is
 * `drawCalls`. Twenty thousand glyphs over one atlas material are **one**
 * `drawElements`, where the pre-R-28 workaround was one texture bind and one
 * draw call each. Submitting that draw is GPU work this script cannot measure,
 * which is what keeps the row at `half`.
 */
function runGeometryScenario(glyphs, length) {
  const { strings, drawnGlyphs } = buildCorpus(glyphs, length);
  const alternate = buildCorpus(glyphs, length).strings.map(
    (text) => `${text.slice(1)}${text[0]}`,
  );

  // One atlas, one texture, one material — shared by every node, which is what
  // makes the whole corpus a single §65 batchable run.
  const material = new UnlitMaterial({
    map: new Texture({ ...ATLAS, filter: "nearest" }),
    transparent: true,
  });
  const nodes = strings.map(
    (text) => new Text(ATLAS, material, { text, size: TEXT_SIZE }),
  );

  let vertices = 0;
  for (const node of nodes) vertices += node.geometry.vertexCount;
  if (vertices !== drawnGlyphs * 4) {
    throw new Error(
      `text-layout invalid (geometry ${glyphs}×${length}): ${vertices} vertices, expected ${drawnGlyphs * 4}`,
    );
  }

  let lastVertices = 0;
  const { warmup, measured } = measure(
    (index) => {
      const source = index % 2 === 0 ? alternate : strings;
      let total = 0;
      for (let i = 0; i < nodes.length; i += 1) {
        nodes[i].text = source[i];
        total += nodes[i].geometry.vertexCount;
      }
      lastVertices = total;
      keepAlive(total);
    },
    { warmupIterations: WARMUP_FRAMES, measuredIterations: MEASURED_FRAMES },
  );

  if (lastVertices !== drawnGlyphs * 4) {
    throw new Error(
      `text-layout invalid (geometry ${glyphs}×${length}): rebuilt to ${lastVertices} vertices, expected ${drawnGlyphs * 4}`,
    );
  }

  for (const node of nodes) node.dispose();
  material.map.dispose();
  material.dispose();

  const summary = summarize(measured);
  return {
    glyphs: drawnGlyphs,
    charactersPerString: length,
    nodes: nodes.length,
    verticesPerFrame: drawnGlyphs * 4,
    indicesPerFrame: drawnGlyphs * 6,
    // The number that closed the blocker: one draw per `Text`, and one for the
    // whole corpus once §65 batching is switched on (they share a material).
    drawCallsUnbatched: nodes.length,
    drawCallsBatched: 1,
    drawCallsBeforeR28: drawnGlyphs,
    measuredFrames: MEASURED_FRAMES,
    warmupMeanMsPerFrame: round(summarize(warmup).meanMs, MS_DIGITS),
    medianMsPerFrame: round(summary.medianMs, MS_DIGITS),
    p95MsPerFrame: round(summary.p95Ms, MS_DIGITS),
    nanosecondsPerGlyph: round((summary.medianMs * 1e6) / drawnGlyphs, 1),
    meanFractionOfFrameBudget: round(summary.meanMs / FRAME_BUDGET_MS, 4),
    insideFrameBudgetAtP95: summary.p95Ms <= FRAME_BUDGET_MS,
  };
}

// --- the run -----------------------------------------------------------------

const headline = GLYPH_COUNTS.map((glyphs) =>
  runScenario(glyphs, HEADLINE_LENGTH),
);
const attribution = ATTRIBUTION_LENGTHS.map((length) =>
  runScenario(ATTRIBUTION_GLYPHS, length),
);
const freezeControl = runFreezeControl();
const geometry = GLYPH_COUNTS.map((glyphs) =>
  runGeometryScenario(glyphs, HEADLINE_LENGTH),
);

const shortest = attribution.find(
  (row) => row.charactersPerString === ATTRIBUTION_LENGTHS[0],
);
const longest = attribution.find(
  (row) =>
    row.charactersPerString ===
    ATTRIBUTION_LENGTHS[ATTRIBUTION_LENGTHS.length - 1],
);

/**
 * `total = calls · perCall + glyphs · perGlyph`, solved from the two extreme
 * attribution rows: both lay out {@link ATTRIBUTION_GLYPHS} glyphs, so the
 * glyph term cancels and the difference is entirely the extra calls.
 */
const nanosecondsPerCall = round(
  ((shortest.medianMsPerFrame - longest.medianMsPerFrame) * 1e6) /
    (shortest.calls - longest.calls),
  1,
);
const nanosecondsPerGlyph = round(
  (longest.medianMsPerFrame * 1e6 - longest.calls * nanosecondsPerCall) /
    ATTRIBUTION_GLYPHS,
  1,
);

/**
 * How well the two-term model reproduces the attribution rows it was **not**
 * fitted to, as the largest relative deviation across all of them.
 *
 * The fit uses two points and there are four; publishing the residual is what
 * keeps `perCall` and `perGlyph` a description of the data rather than a claim
 * about it. On a shared container a residual at the scale of the run-to-run
 * spread is the expected outcome, not a defect in the model.
 */
const modelResidual = round(
  Math.max(
    ...attribution.map((row) => {
      const predictedMs =
        (row.calls * nanosecondsPerCall +
          ATTRIBUTION_GLYPHS * nanosecondsPerGlyph) /
        1e6;
      return (
        Math.abs(predictedMs - row.medianMsPerFrame) / row.medianMsPerFrame
      );
    }),
  ),
  4,
);

const target = headline.find((row) => row.glyphs === ATTRIBUTION_GLYPHS);
const geometryTarget = geometry.find(
  (row) => row.glyphs === ATTRIBUTION_GLYPHS,
);

/**
 * The freeze control as a fraction of the per-glyph cost at the same count. An
 * upper bound on the allocate-and-freeze share, not an exact split: the control
 * writes constants where `layoutText` computes eight coordinates.
 */
const freezeShare = round(
  freezeControl.medianMsPerFrame / target.medianMsPerFrame,
  3,
);

// --- the record --------------------------------------------------------------

const host = hostRecord();
const record = {
  _note: MEASUREMENT_NOTE,
  benchmark: "text-layout",
  specification:
    "§86 (animated glyphs: 20 000 — CPU half), §56 (text, MVP tier), §92 (CPU time)",
  recordedAt: new Date().toISOString(),
  iteration:
    "one iteration is one layoutText call per string in the corpus — a frame in which every string's content changed",
  rowNote:
    "Both CPU halves of §86's animated-glyph row. The layout half (scenarios/attribution) is layoutText producing quads; the geometry half (geometryScenarios, R-28 2026-08-13) is §49's Text node turning those quads into one indexed vertex buffer over one atlas material. The row moved from feature-blocked to half-measured on 2026-08-13: what remains unmeasured is GPU submission, exactly as render-batching.mjs says of its own rows. Before R-28 the shipped path cut one Texture per glyph cell and issued a draw call each; it is now one drawElements per label, and one for a whole run of labels under §65 batching.",
  animationNote:
    "A glyph that only moves is laid out once — animating a node's transform never re-enters layoutText. These numbers are the worst case for the row (content changing every frame), not its normal case.",
  targetNote:
    "§86 gives this row a count (20 000) and no rate; 60 Hz is this file's reading of the table's neighbouring rows, not a rate the specification states for this row.",
  corpusNote: `Headline rows use ${HEADLINE_LENGTH}-character label-sized strings; attribution rows hold the glyph count fixed at ${ATTRIBUTION_GLYPHS} and vary the string length. No corpus contains a space or a newline, so drawn glyphs equal characters exactly — asserted per row against quads.length.`,
  allocationNote:
    "layoutText allocates and Object.freeze's one TextQuad per drawn glyph, plus a frozen array and a frozen result per call: at 20 000 glyphs, 20 000 frozen objects per frame. Unlike §7b's math types this path is not allocation-free, and it is not required to be — the quads are the return value.",
  frameBudgetMs: round(FRAME_BUDGET_MS, 4),
  textSizeWorldUnitsPerLine: TEXT_SIZE,
  seed: SEED,
  atlasBuildMs: round(ATLAS_BUILD_MS, 4),
  atlasBuildNote: `buildGlyphAtlas() on the built-in 6 × 12 face, ${ATLAS.width} × ${ATLAS.height} texels, ${ATLAS.glyphs.size} covered characters. One-off setup, deliberately excluded from every throughput number.`,
  scenarios: headline,
  geometryScenarios: geometry,
  geometryNote:
    "One iteration assigns a new string to every Text node and reads its geometry back: one layoutText plus one positions/uv/index rebuild per node, which is the whole CPU cost of a frame whose text content changed. drawCallsBeforeR28 is what the same frame cost through the pre-R-28 workaround (one Texture and one draw per glyph cell); drawCallsBatched is what it costs today with §65 batching switched on, since every node shares one material.",
  attributionNote: `The same ${ATTRIBUTION_GLYPHS} glyphs laid out as ${ATTRIBUTION_LENGTHS.map((n) => `${ATTRIBUTION_GLYPHS / n} × ${n}`).join(", ")} characters. The glyph term is identical across the rows, so their spread is the per-call cost.`,
  nanosecondsPerCall,
  nanosecondsPerGlyph,
  modelResidual,
  modelResidualNote:
    "Largest relative deviation of `calls · perCall + glyphs · perGlyph` from the measured attribution rows. The two terms are fitted from the two extreme rows only, so this is how far the model misses the rows it did not see — published so the split is read as a description of the data, not a claim about it.",
  freezeControl,
  freezeControlShareOfHeadline: freezeShare,
  freezeControlNote:
    "An upper bound on the allocate-and-freeze share of a glyph, measured on plain object literals in this file rather than on engine code. The control writes constants where layoutText computes eight coordinates, so the true share is below it.",
  keepAliveTotal: round(keepAliveTotal(), 6),
  ...host,
  hostCaveat:
    "CI container, no GPU, shared host; run-to-run spread is tens of percent. §86's 'suitable modern desktop hardware' is not this machine, so nothing here is a §86 verdict — and this row's GPU submission is not measured at all.",
};

const path = writeResult("text-layout", record);

// --- the report --------------------------------------------------------------

printReport([
  "fourJS — glyph layout throughput (§86 animated glyphs, CPU half; §56, §92)",
  `  iteration               one layoutText call per string — a frame where every string's content changed`,
  `  corpus                  ${HEADLINE_LENGTH}-character strings, no spaces, built-in 6 × 12 face at size ${TEXT_SIZE}`,
  `  frames                  ${MEASURED_FRAMES} measured, ${WARMUP_FRAMES} warm-up`,
  `  60 Hz frame budget      ${round(FRAME_BUDGET_MS, 3)} ms (this file's reading; §86 states a count, not a rate)`,
  "",
  "    glyphs      calls   median ms      p95 ms   ns/glyph   Mglyph/s   % of frame",
  ...headline.map((row) =>
    [
      String(row.glyphs).padStart(10),
      String(row.calls).padStart(11),
      String(row.medianMsPerFrame).padStart(12),
      String(row.p95MsPerFrame).padStart(12),
      String(row.nanosecondsPerGlyph).padStart(11),
      String(row.millionGlyphsPerSecond).padStart(11),
      `${round(row.meanFractionOfFrameBudget * 100, 1)}%`.padStart(13),
    ].join(""),
  ),
  "",
  `  §86's row               ${ATTRIBUTION_GLYPHS.toLocaleString("en-US")} glyphs lay out in ${target.medianMsPerFrame} ms — ${target.insideFrameBudgetAtP95 ? "inside" : "OVER"} the 16.667 ms frame budget at p95,`,
  `                          and only for text whose content changes every frame (see the record's animationNote)`,
  `  where it goes           at ${ATTRIBUTION_GLYPHS.toLocaleString("en-US")} glyphs: ${attribution
    .map(
      (row) =>
        `${row.calls}×${row.charactersPerString} ${row.medianMsPerFrame} ms`,
    )
    .join("; ")}`,
  `                          ≈ ${nanosecondsPerCall} ns per layoutText call + ${nanosecondsPerGlyph} ns per glyph`,
  `                          (fitted from the two extreme rows; misses the others by up to ${round(modelResidual * 100, 1)}%)`,
  `  freeze control          ${ATTRIBUTION_GLYPHS.toLocaleString("en-US")} frozen object literals, no engine code: ${freezeControl.medianMsPerFrame} ms (${freezeControl.nanosecondsPerObject} ns each)`,
  `                          — an upper bound of ${round(freezeShare * 100, 1)}% on the allocate-and-freeze share of the row above`,
  "",
  "  geometry half (R-28): Text nodes rebuilt from changed strings",
  "    glyphs      nodes   median ms      p95 ms   ns/glyph        draws now   draws pre-R-28",
  ...geometry.map((row) =>
    [
      String(row.glyphs).padStart(10),
      String(row.nodes).padStart(11),
      String(row.medianMsPerFrame).padStart(12),
      String(row.p95MsPerFrame).padStart(12),
      String(row.nanosecondsPerGlyph).padStart(11),
      `${row.drawCallsUnbatched} (${row.drawCallsBatched} batched)`.padStart(
        17,
      ),
      String(row.drawCallsBeforeR28).padStart(17),
    ].join(""),
  ),
  `  the closed blocker      ${ATTRIBUTION_GLYPHS.toLocaleString("en-US")} glyphs are ${geometryTarget.drawCallsUnbatched} draw calls (1 batched), not ${geometryTarget.drawCallsBeforeR28}`,
  `                          rebuild costs ${geometryTarget.medianMsPerFrame} ms — ${geometryTarget.insideFrameBudgetAtP95 ? "inside" : "OVER"} the 16.667 ms budget at p95; submission is GPU work, unmeasured`,
  "",
  `  atlas build             ${round(ATLAS_BUILD_MS, 3)} ms once, for ${ATLAS.width} × ${ATLAS.height} texels — setup, not in any number above`,
  `  keep-alive fold         ${round(keepAliveTotal(), 6)} (proof the layouts were not optimised away; not a checksum)`,
  "",
  ...hostLines(
    host,
    "shared CI container; the GPU submission of this row's draws is not measured — see the record's rowNote.",
  ),
  "",
  `  written                 ${path}`,
]);
