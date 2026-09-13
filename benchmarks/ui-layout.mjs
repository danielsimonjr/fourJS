/**
 * Retained-UI layout cost — §86's *"retained UI nodes: 5 000"* row, measured on
 * the half of it that is CPU work (§73 widgets, §74 layout, §56 text
 * measurement; §92's *"CPU time"* metric).
 *
 * ```sh
 * bun run build          # this script imports the built dist, not src
 * node benchmarks/ui-layout.mjs
 * ```
 *
 * ## Which half of the row this is, and which half it is not
 *
 * §86 asks for 5 000 retained UI nodes. A frame of that costs two things:
 * **laying the tree out** and **drawing it**. `@fourjs/ui`'s frozen dependency
 * matrix gives it `core`, `math`, `scene`, `input` and `text` and no renderer —
 * widgets own hierarchy, size, hit area and state, and the application supplies
 * every pixel through a `WidgetSkin` — so the two halves are separable in the
 * engine, not merely in this file.
 *
 * This script measures the first half only: `root.layout()` over a retained
 * tree of N widgets, which is the whole of what `@fourjs/ui` does per frame. The
 * drawing half is not measured here and is not measurable headless: the shipped
 * skin path turns each glyph cell into its own `Texture` (§55's `frame`
 * sub-rectangle has not landed) and issues a draw call per quad, so a headless
 * number for it would be a number about a workaround. Until 2026-08-08
 * `benchmarks/README.md` filed this whole row under *"hardware"* on that
 * reasoning; the reasoning holds for the draw and never held for the layout,
 * which is why this file exists.
 *
 * ## What is measured
 *
 * One iteration is **`root.layout()`** — §74's two passes over the whole tree:
 * a bottom-up `measure()` (each `Label` measuring its text through
 * `@fourjs/text`, each `Panel` the extent of its children) and a top-down
 * `arrange()` that writes every widget's position into its `Transform`.
 *
 * There is **no dirty tracking in §74's layout**: `layout()` always measures
 * and always arranges, whatever changed. The one memo in the pass is
 * `Label.textLayout`, invalidated by a write to `text`, `atlas`, `size` or
 * `letterSpacing`. So the three passes below are the three states a real
 * application's frame can be in, and their spread is that memo's whole effect:
 *
 * | pass          | invalidated before the pass         | what it stands for                      |
 * | ------------- | ----------------------------------- | --------------------------------------- |
 * | `cold`        | every `Label`                       | first frame, or a re-themed UI          |
 * | `incremental` | {@link INCREMENTAL_LABELS} `Label`s | a normal frame — a few captions changed |
 * | `warm`        | nothing                             | a frame where only layout inputs moved  |
 *
 * `cold − warm` is therefore the text-measurement share of a layout, and `warm`
 * alone is the cost of the walk §74 cannot avoid. Invalidation happens in the
 * harness's **untimed** `prepare` hook, so no measured duration includes the
 * property writes that caused it.
 *
 * The `cold` pass alternates each label between two strings of **equal glyph
 * count**, so the cache is genuinely invalidated while every resolved size in
 * the tree stays identical — the pass is more expensive, not differently
 * shaped, which is what lets the probe assertion below hold across all three.
 *
 * ## The state row
 *
 * A retained UI also pays for **state**: values change, controls enable and
 * disable, and each write dispatches §6b's `uivaluechange` / `uistatechange`.
 * At {@link ATTRIBUTION_WIDGETS} widgets that churn is measured separately
 * (`stateChurn…`) with **no listeners attached**, so the number is the setter
 * and the dispatch and not an application's handlers. It is reported next to
 * the layout numbers because the interesting fact is the ratio between them,
 * and it is deliberately not folded into them.
 *
 * ## Determinism and wall clocks
 *
 * The tree, the label strings and the churned values all come from {@link SEED}
 * through a small LCG, so two runs build the identical UI (§33). No clock
 * reaches `@fourjs/ui`: `performance.now()` lives in `harness.mjs`, `layout()`
 * takes no time argument at all, and deleting every timer would leave every
 * resolved position bit-identical.
 *
 * Recorded, never gated — see `benchmarks/README.md`.
 */

import { buildGlyphAtlas } from "@fourjs/text";
import {
  Button,
  Checkbox,
  Label,
  Panel,
  ProgressIndicator,
  Slider,
  UIWidget,
  UI_LAYOUT_AUTHORITY,
} from "@fourjs/ui";

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
 * Widget counts measured, in report order. 5 000 is §86's row verbatim; the
 * three below it are there so a reader can see whether the cost is linear
 * before reading the row itself.
 */
const WIDGET_COUNTS = [500, 1000, 2500, 5000];

/** Widget count used for the state-churn attribution run — §86's own number. */
const ATTRIBUTION_WIDGETS = 5000;

/** Measured `layout()` calls per scenario per pass kind. */
const MEASURED_PASSES = 60;

/** Unmeasured passes first, so the reported mean is steady-state. */
const WARMUP_PASSES = 20;

/**
 * `Label`s whose text is invalidated before an `incremental` pass — a plausible
 * "a few captions changed this frame", and the same 64 `scene-propagation.mjs`
 * uses for its sparse row so the two read alike.
 */
const INCREMENTAL_LABELS = 64;

/** Seed of the LCG that authors the tree. Fixed: two runs build one UI (§33). */
const SEED = 0x5f2c81a3;

/** Layout units per line for a caption. */
const CAPTION_SIZE = 16;

/** Layout units per line for a section title. */
const TITLE_SIZE = 20;

/** Decimals kept for the per-pass millisecond statistics. */
const MS_DIGITS = 4;

/**
 * The frame budget at 60 Hz, in milliseconds.
 *
 * §86 states the retained-UI row as a **count** and no rate. Its neighbours in
 * the same table say "at 60 FPS", so 60 Hz is the reference used here — that is
 * this file's reading of the table, said out loud, and not a target the
 * specification wrote.
 */
const FRAME_BUDGET_MS = 1000 / 60;

/** The built-in 6 × 12 face, packed once. Building it is setup, never measured. */
const ATLAS = buildGlyphAtlas();

/**
 * A 32-bit LCG (Numerical Recipes constants) — the same shape the determinism
 * suites use. Seeded, so the authored UI is a function of {@link SEED} alone.
 */
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Caption vocabulary — ASCII only, which is all the built-in face covers. */
const WORDS = [
  "motor",
  "torque",
  "rpm",
  "coolant",
  "pressure",
  "valve",
  "spindle",
  "feed",
  "axis",
  "load",
  "bearing",
  "gearbox",
];

/**
 * Two caption strings of **identical length**, so alternating between them
 * invalidates `Label.textLayout` without changing a single measured size.
 */
function captionPair(random) {
  const word = WORDS[Math.floor(random() * WORDS.length)];
  const value = 100 + Math.floor(random() * 900);
  return [`${word} ${value}`, `${word} ${value + 0}`.replace(" ", "-")];
}

/**
 * Builds a retained UI of exactly `widgetCount` widgets and returns it with the
 * handles the passes need.
 *
 * The shape is a flex **column** of section panels, each a flex **row** of a
 * repeating control group — title label, button with its own caption label,
 * checkbox, slider, progress bar. Seven widgets per section (the row panel plus
 * six controls); the last section is topped up with plain labels so the total
 * is the requested count exactly rather than approximately, because §86's row
 * *is* a count.
 *
 * `interactive: false` on the containers mirrors `examples/ui-demo`: a panel
 * that needs no pointer state stays out of the §71 candidate list.
 */
function buildUI(widgetCount) {
  const random = createRandom(SEED);
  const root = new Panel({
    name: `ui-layout-${widgetCount}`,
    interactive: false,
    layout: { type: "flex", direction: "column", gap: 8, padding: 12 },
  });
  // §42: the application places a root; nothing lays it out, so it is the one
  // widget in the tree that does not carry the layout authority (ui-demo's
  // rule, and widget.ts prescribes it).
  root.transformAuthority = "manual";

  const labels = [];
  const captions = [];
  const sliders = [];
  const progresses = [];
  const checkboxes = [];
  let count = 1; // the root

  const addLabel = (parent, size) => {
    const [a, b] = captionPair(random);
    const label = new Label({ text: a, atlas: ATLAS, size });
    parent.add(label);
    labels.push(label);
    captions.push([a, b]);
    count += 1;
    return label;
  };

  while (count + 7 <= widgetCount) {
    const section = new Panel({
      interactive: false,
      layout: { type: "flex", direction: "row", gap: 6, align: "center" },
    });
    root.add(section);
    count += 1;

    addLabel(section, TITLE_SIZE);

    const button = new Button({ width: 120, height: 32 });
    section.add(button);
    count += 1;
    addLabel(button, CAPTION_SIZE);

    const checkbox = new Checkbox({ width: 20, height: 20 });
    section.add(checkbox);
    checkboxes.push(checkbox);
    count += 1;

    const slider = new Slider({ width: 160, height: 24, min: 0, max: 100 });
    section.add(slider);
    sliders.push(slider);
    count += 1;

    const progress = new ProgressIndicator({ width: 140, height: 12 });
    section.add(progress);
    progresses.push(progress);
    count += 1;
  }

  // Top-up, so the tree holds the requested count exactly.
  const tail =
    count < widgetCount
      ? new Panel({
          interactive: false,
          layout: { type: "flex", direction: "row", gap: 6 },
        })
      : null;
  if (tail !== null) {
    root.add(tail);
    count += 1;
    while (count < widgetCount) {
      addLabel(tail, CAPTION_SIZE);
    }
  }

  return { root, labels, captions, sliders, progresses, checkboxes };
}

/** Every {@link UIWidget} in the subtree rooted at `widget`, counted. */
function countWidgets(widget) {
  let total = 1;
  const children = widget.children;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child instanceof UIWidget) {
      total += countWidgets(child);
    }
  }
  return total;
}

/**
 * Times {@link MEASURED_PASSES} `layout()` calls with `invalidate` as the
 * harness's untimed `prepare` hook, and returns the two summaries.
 */
function timePasses(root, invalidate) {
  const { warmup, measured } = measure(
    () => {
      root.layout();
      keepAlive(root.measuredWidth + root.measuredHeight);
    },
    {
      warmupIterations: WARMUP_PASSES,
      measuredIterations: MEASURED_PASSES,
      prepare: invalidate,
    },
  );
  return { summary: summarize(measured), warmupSummary: summarize(warmup) };
}

/** The six statistics of one pass kind, prefixed with the pass's name. */
function passFields(label, pass, widgetCount) {
  return {
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
    [`${label}NanosecondsPerWidget`]: round(
      (pass.summary.medianMs * 1e6) / widgetCount,
      1,
    ),
    [`${label}MeanFractionOfFrameBudget`]: round(
      pass.summary.meanMs / FRAME_BUDGET_MS,
      4,
    ),
  };
}

/** Runs the three pass kinds over one widget count. */
function runScenario(widgetCount) {
  const { root, labels, captions } = buildUI(widgetCount);

  const actual = countWidgets(root);
  if (actual !== widgetCount) {
    throw new Error(
      `ui-layout invalid: built ${actual} widgets, expected ${widgetCount}`,
    );
  }
  for (let i = 0; i < labels.length; i += 1) {
    if (labels[i].transformAuthority !== UI_LAYOUT_AUTHORITY) {
      throw new Error(
        `ui-layout invalid: label ${i} is "${labels[i].transformAuthority}", expected "${UI_LAYOUT_AUTHORITY}" — a laid-out widget under any other authority makes §74 warn instead of writing, and the benchmark would measure the refusal path`,
      );
    }
  }

  // --- warm: nothing is invalidated, so every text layout stays cached -------
  const warm = timePasses(root, () => {});

  // The resolved geometry after a warm pass is the reference every other pass
  // must reproduce: the invalidation below changes what is recomputed, never
  // what is computed.
  const probe = labels[labels.length - 1];
  const probeX = probe.transform.position.x;
  const probeY = probe.transform.position.y;
  const rootWidth = root.measuredWidth;
  const rootHeight = root.measuredHeight;
  if (!(rootWidth > 0) || !(rootHeight > 0)) {
    throw new Error(
      `ui-layout invalid: root measured ${rootWidth} × ${rootHeight}, expected a positive intrinsic size`,
    );
  }

  // --- cold: every label's text layout is invalidated before every pass -----
  let flip = 0;
  const cold = timePasses(root, () => {
    flip ^= 1;
    for (let i = 0; i < labels.length; i += 1) {
      labels[i].text = captions[i][flip];
    }
  });

  // --- incremental: a handful of captions changed ---------------------------
  const incrementalCount = Math.min(INCREMENTAL_LABELS, labels.length);
  let step = 0;
  const incremental = timePasses(root, () => {
    step ^= 1;
    for (let i = 0; i < incrementalCount; i += 1) {
      labels[i].text = captions[i][step];
    }
  });

  // Both alternating strings have the same glyph count, so a pass that
  // recomputed more must still have resolved the identical tree. If this fires,
  // the two pass kinds are not measuring the same layout and nothing above may
  // be compared.
  if (
    root.measuredWidth !== rootWidth ||
    root.measuredHeight !== rootHeight ||
    probe.transform.position.x !== probeX ||
    probe.transform.position.y !== probeY
  ) {
    throw new Error(
      `ui-layout invalid: geometry moved between pass kinds (root ${rootWidth}×${rootHeight} → ${root.measuredWidth}×${root.measuredHeight})`,
    );
  }
  keepAlive(probeX + probeY);

  return {
    widgets: widgetCount,
    labels: labels.length,
    sections: root.children.length,
    measuredPasses: MEASURED_PASSES,
    warmupPasses: WARMUP_PASSES,
    incrementalLabels: incrementalCount,
    rootMeasuredWidth: round(rootWidth, 4),
    rootMeasuredHeight: round(rootHeight, 4),
    ...passFields("cold", cold, widgetCount),
    ...passFields("incremental", incremental, widgetCount),
    ...passFields("warm", warm, widgetCount),
    textMeasurementShareMs: round(
      cold.summary.medianMs - warm.summary.medianMs,
      MS_DIGITS,
    ),
    coldOverWarmRatio: round(cold.summary.medianMs / warm.summary.medianMs, 2),
    /**
     * `incremental` does strictly more work than `warm` — the same walk plus
     * {@link INCREMENTAL_LABELS} text re-measurements — so a ratio below 1 is
     * arithmetically impossible and is this host's run-to-run spread showing
     * through. Published rather than smoothed: it is the scale below which no
     * two numbers in this row may be compared.
     */
    incrementalOverWarmRatio: round(
      incremental.summary.medianMs / warm.summary.medianMs,
      3,
    ),
    widgetsPerSecondWarm: Math.round(
      (widgetCount / warm.summary.medianMs) * 1000,
    ),
    warmInsideFrameBudgetAtP95: warm.summary.p95Ms <= FRAME_BUDGET_MS,
    coldInsideFrameBudgetAtP95: cold.summary.p95Ms <= FRAME_BUDGET_MS,
  };
}

/**
 * Measures one pass of **state churn** over the attribution tree: every slider
 * and progress bar takes a new value and every checkbox flips, each write
 * dispatching its §6b event into a tree with no listeners.
 */
function runStateChurn() {
  const { root, sliders, progresses, checkboxes } =
    buildUI(ATTRIBUTION_WIDGETS);
  root.layout();
  const random = createRandom(SEED ^ 0x9e3779b9);
  const values = Array.from({ length: 64 }, () => random() * 100);

  const { warmup, measured } = measure(
    (index) => {
      const base = index * 7;
      for (let i = 0; i < sliders.length; i += 1) {
        sliders[i].value = values[(base + i) & 63];
      }
      for (let i = 0; i < progresses.length; i += 1) {
        progresses[i].value = values[(base + i) & 63] / 100;
      }
      for (let i = 0; i < checkboxes.length; i += 1) {
        checkboxes[i].checked = ((index + i) & 1) === 0;
      }
    },
    { warmupIterations: WARMUP_PASSES, measuredIterations: MEASURED_PASSES },
  );

  const summary = summarize(measured);
  const writes = sliders.length + progresses.length + checkboxes.length;
  keepAlive(sliders[0].value + progresses[0].value);
  return {
    widgets: ATTRIBUTION_WIDGETS,
    writes,
    listeners: 0,
    measuredPasses: MEASURED_PASSES,
    warmupMeanMsPerPass: round(summarize(warmup).meanMs, MS_DIGITS),
    meanMsPerPass: round(summary.meanMs, MS_DIGITS),
    medianMsPerPass: round(summary.medianMs, MS_DIGITS),
    p95MsPerPass: round(summary.p95Ms, MS_DIGITS),
    nanosecondsPerWrite: round((summary.medianMs * 1e6) / writes, 1),
  };
}

// --- the run -----------------------------------------------------------------

const rows = WIDGET_COUNTS.map(runScenario);
const stateChurn = runStateChurn();

const target = rows.find((row) => row.widgets === ATTRIBUTION_WIDGETS);

/**
 * Rows where the `incremental` pass measured **faster** than the `warm` pass it
 * strictly contains. Each one is a direct reading of this host's noise floor,
 * and the count is recorded so a reader knows how much of the table to distrust
 * before quoting a difference from it.
 */
const inversions = rows.filter((row) => row.incrementalOverWarmRatio < 1);

/**
 * The largest per-widget cost divided by the smallest across the sweep. The
 * pass is O(n) by inspection — every widget is measured once and arranged once,
 * with O(1) work at each — so a value above 1 is a memory-hierarchy effect on
 * this host, not an algorithmic term. Recorded, not explained away.
 */
const perWidgetSpread = round(
  Math.max(...rows.map((row) => row.warmNanosecondsPerWidget)) /
    Math.min(...rows.map((row) => row.warmNanosecondsPerWidget)),
  2,
);

// --- the record --------------------------------------------------------------

const host = hostRecord();
const record = {
  _note: MEASUREMENT_NOTE,
  benchmark: "ui-layout",
  specification:
    "§86 (retained UI nodes: 5 000 — CPU half), §73, §74, §56, §92 (CPU time)",
  recordedAt: new Date().toISOString(),
  iteration:
    "one iteration is root.layout() — §74's bottom-up measure pass plus top-down arrange pass over the whole retained tree",
  rowNote:
    "This is the layout-and-state half of §86's retained-UI row. The drawing half is not measured: @fourjs/ui has no renderer dependency by design, and the shipped skin path cuts one Texture per glyph cell (§55 frame sub-rectangle unshipped), so a headless draw number would describe the workaround rather than the engine.",
  targetNote:
    "§86 gives this row a count (5 000) and no rate; 60 Hz is this file's reading of the table's neighbouring rows, not a rate the specification states for this row.",
  passKinds: {
    cold: "every Label's text is rewritten before the pass, so every text layout is recomputed",
    incremental: `${INCREMENTAL_LABELS} Labels are rewritten before the pass — a normal frame`,
    warm: "nothing is invalidated; every Label.textLayout is served from its cache",
  },
  dirtyTrackingNote:
    "§74's layout has no dirty tracking: layout() always measures and always arranges. Label.textLayout is the only memo in the pass, which is what the cold/warm spread measures.",
  invalidationNote:
    "The two alternating caption strings have equal glyph count, so the resolved geometry is identical across all three pass kinds — asserted, not assumed.",
  frameBudgetMs: round(FRAME_BUDGET_MS, 4),
  seed: SEED,
  scenarios: rows,
  noiseFloorNote:
    "An `incremental` pass contains a `warm` pass plus INCREMENTAL_LABELS text re-measurements, so incrementalOverWarmRatio < 1 is impossible by construction and is this host's run-to-run spread. inversionRows maps each widget count where it happened on this run to the ratio it reached; an empty object means no inversion.",
  inversionRows: Object.fromEntries(
    inversions.map((row) => [row.widgets, row.incrementalOverWarmRatio]),
  ),
  perWidgetCostSpread: perWidgetSpread,
  perWidgetCostNote:
    "Ratio of the highest to the lowest warm ns/widget across the sweep. §74's pass is O(n) by inspection (each widget measured once, arranged once, O(1) each), so a spread above 1 is a memory-hierarchy effect on this host rather than an algorithmic term.",
  stateChurn,
  stateChurnNote:
    "Sliders, progress bars and checkboxes rewritten once per pass with no listeners attached: the §6b setter and dispatch cost only. Not included in the layout numbers above.",
  keepAliveTotal: round(keepAliveTotal(), 6),
  ...host,
  hostCaveat:
    "CI container, no GPU, shared host; run-to-run spread is tens of percent. §86's 'suitable modern desktop hardware' is not this machine, so nothing here is a §86 verdict — and this row's drawing half is not measured at all.",
};

const path = writeResult("ui-layout", record);

// --- the report --------------------------------------------------------------

printReport([
  "fourJS — retained-UI layout cost (§86 retained UI nodes, CPU half; §73, §74, §56, §92)",
  `  iteration               root.layout() — §74 measure + arrange over the whole tree`,
  `  passes                  ${MEASURED_PASSES} measured, ${WARMUP_PASSES} warm-up, per pass kind`,
  `  60 Hz frame budget      ${round(FRAME_BUDGET_MS, 3)} ms (this file's reading; §86 states a count, not a rate)`,
  "",
  "   widgets    cold ms   incr. ms    warm ms   warm ns/widget   cold % of frame",
  ...rows.map((row) =>
    [
      String(row.widgets).padStart(10),
      String(row.coldMedianMsPerPass).padStart(11),
      String(row.incrementalMedianMsPerPass).padStart(11),
      String(row.warmMedianMsPerPass).padStart(11),
      String(row.warmNanosecondsPerWidget).padStart(17),
      `${round(row.coldMeanFractionOfFrameBudget * 100, 1)}%`.padStart(18),
    ].join(""),
  ),
  "",
  `  §86's row               ${ATTRIBUTION_WIDGETS.toLocaleString("en-US")} widgets lay out in ${target.coldMedianMsPerPass} ms cold, ${target.incrementalMedianMsPerPass} ms incremental, ${target.warmMedianMsPerPass} ms warm`,
  `                          ${target.coldInsideFrameBudgetAtP95 ? "inside" : "OVER"} the 16.667 ms frame budget at p95 cold; ${target.warmInsideFrameBudgetAtP95 ? "inside" : "OVER"} it warm`,
  `  where it goes           text measurement is ${target.textMeasurementShareMs} ms of the cold pass (${target.coldOverWarmRatio}× warm);`,
  `                          the remaining ${target.warmMedianMsPerPass} ms is the two-pass walk §74 performs whatever changed`,
  `  state churn             ${stateChurn.writes.toLocaleString("en-US")} value/checked writes + §6b dispatch: ${stateChurn.medianMsPerPass} ms (${stateChurn.nanosecondsPerWrite} ns per write, no listeners)`,
  `  per-widget spread       warm ns/widget varies ${perWidgetSpread}× across the sweep though the pass is O(n) by`,
  `                          inspection — a memory-hierarchy effect on this host, recorded not explained`,
  `  noise floor             ${
    inversions.length === 0
      ? "no inversions: every incremental pass cost at least its warm pass"
      : `${inversions.length} row(s) measured incremental FASTER than warm (${inversions
          .map((row) => `${row.widgets}: ${row.incrementalOverWarmRatio}×`)
          .join(", ")}),`
  }`,
  ...(inversions.length === 0
    ? []
    : [
        "                          which is impossible by construction. Nothing smaller than that gap is a finding.",
      ]),
  `  keep-alive fold         ${round(keepAliveTotal(), 6)} (proof the passes were not optimised away; not a checksum)`,
  "",
  ...hostLines(
    host,
    "shared CI container; §86's drawing half of this row is not measured here — see the record's rowNote.",
  ),
  "",
  `  written                 ${path}`,
]);
