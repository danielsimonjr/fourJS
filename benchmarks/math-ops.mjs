/**
 * `@fourjs/math` operation throughput and per-operation allocation (§7b, §83;
 * §92's *"CPU time … allocations"* metrics; plan §6j P11-4, WP-11.4).
 *
 * ```sh
 * bun run build          # this script imports the built dist, not src
 * node benchmarks/math-ops.mjs
 * ```
 *
 * ## What is measured, and why these two numbers together
 *
 * §7b makes two claims about the math types, and this script measures one and
 * checks the other on the same run:
 *
 * 1. **They are fast enough to be called per node per frame.** The reported
 *    figure per operation is **nanoseconds per operation**, derived from the
 *    measured milliseconds per batch of {@link OPERATIONS_PER_BATCH}.
 * 2. **They do not allocate in steady state.** `@fourjs/math`'s own
 *    `constructionCount()` (§83's allocation instrumentation — every math
 *    constructor reports itself) is read across one extra batch per operation,
 *    so `allocationsPerOperation` is a *measured* zero rather than a claimed
 *    one. A non-zero entry here is a real defect in the hot path, not a
 *    performance opinion, and is the one thing in this file worth acting on
 *    immediately.
 *
 * The second number is why this script exists at all: a throughput figure on a
 * shared CI container is weak evidence, but "these operations allocated exactly
 * nothing across a million calls each" is a strong, host-independent statement
 * and is exactly the §92 *allocations* metric.
 *
 * ## Three deliberate defences against measuring nothing
 *
 * A micro-benchmark's characteristic failure is that the optimiser removes the
 * work and the script reports a beautiful number for an empty loop. Three
 * things here exist only to prevent that, and a reader should check all three
 * before believing any row:
 *
 * 1. **Varying operands.** Every operation reads its inputs from
 *    {@link VARIANTS}-long arrays indexed by the iteration counter, so no call
 *    is loop-invariant and none can be hoisted out. An earlier draft of this
 *    script used fixed operands and reported `Vector3.copy` at 3.6 ns against
 *    `Vector3.add` at 51 ns — the copy loop had been hoisted to a single store.
 *    That draft is why this paragraph exists.
 * 2. **The `baseline` row.** It performs the array indexing and the result read
 *    and *no math operation at all*. It is the floor: an operation row that
 *    lands at the baseline is not a fast operation, it is a deleted one.
 * 3. **`keepAlive`.** Each batch folds one scalar of its result through the
 *    harness's cross-module accumulator, printed at the end, so the results are
 *    observed and the calls cannot be dropped as dead.
 *
 * ## The `copy(...)` reset, stated rather than hidden
 *
 * The math types mutate in place (§7b) — `a.add(b)` writes into `a`. Measuring
 * a mutating operation in a loop therefore has to reset the receiver, or it
 * measures a drifting receiver instead (denormals, collapsing cross products,
 * quaternions leaving the unit sphere). This script resets with
 * `out.copy(src)`, and **measures `copy` itself as its own row** so the
 * overhead can be subtracted rather than trusted. The `includesCopyReset`
 * field of each row says which rows carry it; the operations that take an
 * explicit `out` parameter (`Quaternion.rotateVector3`, `Matrix4.compose`,
 * `Matrix4.decompose`) and the pure query `Vector3.dot` need no reset and carry
 * none.
 *
 * So, per row: `operation alone ≈ row − same-type copy row` for a prefixed row,
 * and `≈ row − baseline` for an unprefixed one. Both subtractions are noisy on
 * a shared host; they are stated as attribution, not as precision.
 *
 * ## Wall clocks and §86
 *
 * There is no simulation here at all — no clock, no delta, no state that
 * advances — so the plan §1 ground rule is satisfied trivially: `performance
 * .now()` lives in `harness.mjs`'s `measure` and nothing it returns is read by
 * anything under test. §86 has **no row for math-operation throughput**; this
 * script measures the foundation those rows all sit on and claims nothing about
 * them. Recorded, never gated.
 */

import {
  Matrix4,
  Quaternion,
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@fourjs/math";

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
 * Operations timed as one measured iteration.
 *
 * Large enough that a batch of the cheapest operation still lasts hundreds of
 * microseconds — far above the clock's resolution and above the cost of the two
 * `performance.now()` calls around it.
 */
const OPERATIONS_PER_BATCH = 100_000;

/** Measured batches per operation. */
const MEASURED_BATCHES = 40;

/** Unmeasured batches per operation, so the reported mean is steady-state. */
const WARMUP_BATCHES = 8;

/**
 * Distinct operand sets each operation cycles through, a power of two so the
 * index is a mask rather than a modulo.
 *
 * Small enough to stay in L1 (eight `Matrix4`s are 512 bytes of `Float64Array`
 * plus headers) — the point is to defeat hoisting, not to measure the cache.
 */
const VARIANTS = 8;

/** Mask for the variant index. */
const VARIANT_MASK = VARIANTS - 1;

/** Decimals kept for the per-batch millisecond statistics. */
const MS_DIGITS = 4;

// --- operands ----------------------------------------------------------------
// Built once, before anything is timed, and reused by every batch: the §7b
// hot-path style this file is measuring is precisely "no allocation inside the
// loop", so allocating operands inside one would measure the opposite thing.

/** `VARIANTS` well-conditioned vectors — none zero, none axis-aligned. */
function makeVectors(seedOffset) {
  const out = [];
  for (let i = 0; i < VARIANTS; i += 1) {
    const t = i + seedOffset;
    out.push(new Vector3(Math.sin(t) * 2.3, Math.cos(t * 1.7) * 1.9, 0.5 + t));
  }
  return out;
}

/** `VARIANTS` unit quaternions about assorted axes. */
function makeQuaternions(seedOffset) {
  const out = [];
  for (let i = 0; i < VARIANTS; i += 1) {
    const t = i + seedOffset;
    const axis = new Vector3(
      Math.sin(t * 0.9),
      Math.cos(t * 1.3),
      Math.sin(t * 2.1),
    ).normalize();
    out.push(new Quaternion().setFromAxisAngle(axis, 0.3 + t * 0.41));
  }
  return out;
}

/** `VARIANTS` invertible affine matrices (no zero scale, no shear). */
function makeMatrices(positions, rotations, seedOffset) {
  const out = [];
  for (let i = 0; i < VARIANTS; i += 1) {
    const t = i + seedOffset;
    out.push(
      new Matrix4().compose(
        positions[i],
        rotations[i],
        new Vector3(0.7 + 0.1 * t, 1.1 + 0.05 * t, 0.9 + 0.13 * t),
        ZERO,
      ),
    );
  }
  return out;
}

/** Pivot for every `compose` here: §7's field is required and has no default. */
const ZERO = new Vector3(0, 0, 0);

/** Unit scale, for the `compose` row. */
const UNIT_SCALE = new Vector3(1, 1, 1);

const VECTORS_A = makeVectors(0);
const VECTORS_B = makeVectors(11);
const QUATERNIONS_A = makeQuaternions(0);
const QUATERNIONS_B = makeQuaternions(7);
const MATRICES_A = makeMatrices(VECTORS_A, QUATERNIONS_A, 0);
const MATRICES_B = makeMatrices(VECTORS_B, QUATERNIONS_B, 3);

/** The receivers every timed operation writes into. Never reallocated. */
const vectorOut = new Vector3();
const quaternionOut = new Quaternion();
const matrixOut = new Matrix4();
const decomposedPosition = new Vector3();
const decomposedRotation = new Quaternion();
const decomposedScale = new Vector3();

/**
 * The operations under measurement, in report order.
 *
 * Each `run(i)` takes the iteration index, selects its operands with
 * `i & VARIANT_MASK`, and returns one scalar of its result for the fold.
 */
const OPERATIONS = [
  {
    name: "baseline (no op)",
    type: "—",
    prefixed: false,
    run(i) {
      return VECTORS_A[i & VARIANT_MASK].x;
    },
  },
  {
    name: "Vector3.copy",
    type: "Vector3",
    prefixed: false,
    run(i) {
      return vectorOut.copy(VECTORS_A[i & VARIANT_MASK]).x;
    },
  },
  {
    name: "Vector3.add",
    type: "Vector3",
    prefixed: true,
    run(i) {
      const v = i & VARIANT_MASK;
      return vectorOut.copy(VECTORS_A[v]).add(VECTORS_B[v]).x;
    },
  },
  {
    name: "Vector3.dot",
    type: "Vector3",
    prefixed: false,
    run(i) {
      const v = i & VARIANT_MASK;
      return VECTORS_A[v].dot(VECTORS_B[v]);
    },
  },
  {
    name: "Vector3.cross",
    type: "Vector3",
    prefixed: true,
    run(i) {
      const v = i & VARIANT_MASK;
      return vectorOut.copy(VECTORS_A[v]).cross(VECTORS_B[v]).x;
    },
  },
  {
    name: "Vector3.normalize",
    type: "Vector3",
    prefixed: true,
    run(i) {
      return vectorOut.copy(VECTORS_A[i & VARIANT_MASK]).normalize().x;
    },
  },
  {
    name: "Vector3.lerp",
    type: "Vector3",
    prefixed: true,
    run(i) {
      const v = i & VARIANT_MASK;
      return vectorOut.copy(VECTORS_A[v]).lerp(VECTORS_B[v], 0.35).x;
    },
  },
  {
    name: "Quaternion.copy",
    type: "Quaternion",
    prefixed: false,
    run(i) {
      return quaternionOut.copy(QUATERNIONS_A[i & VARIANT_MASK]).x;
    },
  },
  {
    name: "Quaternion.multiply",
    type: "Quaternion",
    prefixed: true,
    run(i) {
      const v = i & VARIANT_MASK;
      return quaternionOut.copy(QUATERNIONS_A[v]).multiply(QUATERNIONS_B[v]).x;
    },
  },
  {
    name: "Quaternion.slerp",
    type: "Quaternion",
    prefixed: true,
    run(i) {
      const v = i & VARIANT_MASK;
      return quaternionOut.copy(QUATERNIONS_A[v]).slerp(QUATERNIONS_B[v], 0.35)
        .x;
    },
  },
  {
    name: "Quaternion.rotateVector3",
    type: "Quaternion",
    prefixed: false,
    run(i) {
      const v = i & VARIANT_MASK;
      return QUATERNIONS_A[v].rotateVector3(VECTORS_A[v], vectorOut).x;
    },
  },
  {
    name: "Matrix4.copy",
    type: "Matrix4",
    prefixed: false,
    run(i) {
      return matrixOut.copy(MATRICES_A[i & VARIANT_MASK]).elements[0];
    },
  },
  {
    name: "Matrix4.multiply",
    type: "Matrix4",
    prefixed: true,
    run(i) {
      const v = i & VARIANT_MASK;
      return matrixOut.copy(MATRICES_A[v]).multiply(MATRICES_B[v]).elements[0];
    },
  },
  {
    name: "Matrix4.invert",
    type: "Matrix4",
    prefixed: true,
    run(i) {
      return matrixOut.copy(MATRICES_A[i & VARIANT_MASK]).invert().elements[0];
    },
  },
  {
    name: "Matrix4.compose",
    type: "Matrix4",
    prefixed: false,
    run(i) {
      const v = i & VARIANT_MASK;
      return matrixOut.compose(VECTORS_A[v], QUATERNIONS_A[v], UNIT_SCALE, ZERO)
        .elements[0];
    },
  },
  {
    name: "Matrix4.decompose",
    type: "Matrix4",
    prefixed: false,
    run(i) {
      return MATRICES_A[i & VARIANT_MASK].decompose(
        decomposedPosition,
        decomposedRotation,
        decomposedScale,
      ).elements[0];
    },
  },
];

/** Runs one batch of `operation`, folding a result scalar through `keepAlive`. */
function runBatch(operation) {
  let fold = 0;
  for (let i = 0; i < OPERATIONS_PER_BATCH; i += 1) {
    fold += operation.run(i);
  }
  keepAlive(fold);
}

/**
 * Math objects constructed across one extra batch of `operation` (§83).
 *
 * Run after the timed batches, so it observes the same optimised code the
 * timings did rather than a cold path. `keepAlive` and `constructionCount`
 * allocate nothing themselves, so the count is the operation's alone.
 */
function allocationsPerBatch(operation) {
  resetConstructionCount();
  runBatch(operation);
  return constructionCount();
}

// --- the run -----------------------------------------------------------------

const rows = [];
for (const operation of OPERATIONS) {
  const { warmup, measured } = measure(() => runBatch(operation), {
    warmupIterations: WARMUP_BATCHES,
    measuredIterations: MEASURED_BATCHES,
  });
  const summary = summarize(measured);
  const warmupSummary = summarize(warmup);
  const allocations = allocationsPerBatch(operation);
  rows.push({
    operation: operation.name,
    type: operation.type,
    includesCopyReset: operation.prefixed,
    warmupMeanMsPerBatch: round(warmupSummary.meanMs, MS_DIGITS),
    meanMsPerBatch: round(summary.meanMs, MS_DIGITS),
    medianMsPerBatch: round(summary.medianMs, MS_DIGITS),
    p95MsPerBatch: round(summary.p95Ms, MS_DIGITS),
    p99MsPerBatch: round(summary.p99Ms, MS_DIGITS),
    minMsPerBatch: round(summary.minMs, MS_DIGITS),
    maxMsPerBatch: round(summary.maxMs, MS_DIGITS),
    nanosecondsPerOperation: round(
      (summary.medianMs * 1e6) / OPERATIONS_PER_BATCH,
      2,
    ),
    millionOperationsPerSecond: round(
      OPERATIONS_PER_BATCH / summary.medianMs / 1000,
      2,
    ),
    allocationsPerBatch: allocations,
    allocationsPerOperation: round(allocations / OPERATIONS_PER_BATCH, 6),
  });
}

const baselineRow = rows[0];
const allocatingRows = rows.filter((row) => row.allocationsPerBatch !== 0);

// --- the record --------------------------------------------------------------

const host = hostRecord();
const record = {
  _note: MEASUREMENT_NOTE,
  benchmark: "math-ops",
  specification:
    "§7b (math conventions), §83 (allocation policy), §92 (CPU time, allocations); plan §6j P11-4, WP-11.4",
  recordedAt: new Date().toISOString(),
  operationsPerBatch: OPERATIONS_PER_BATCH,
  measuredBatches: MEASURED_BATCHES,
  warmupBatches: WARMUP_BATCHES,
  operandVariants: VARIANTS,
  baselineNote:
    "The `baseline (no op)` row does the operand indexing and the result read and no math at all. It is the floor: a row at the baseline is a deleted operation, not a fast one. Operands vary per iteration for the same reason — with fixed operands V8 hoisted the copy loop and reported 3.6 ns for a store that ran once.",
  copyResetNote:
    "Rows with includesCopyReset=true time `out.copy(src).<op>(...)`; subtract the same type's copy row for the operation alone. §7b types mutate in place, so a repeated in-place op would otherwise measure a drifting receiver. Unprefixed rows take an explicit out parameter (or are pure queries); subtract the baseline row instead.",
  allocationNote:
    "allocationsPerBatch is @fourjs/math's own constructionCount() (§83) across one extra batch run after the timed batches. Zero is the §7b requirement; any non-zero row is a hot-path defect, not a performance opinion.",
  allocatingOperations: allocatingRows.map((row) => row.operation),
  baselineNanosecondsPerOperation: baselineRow.nanosecondsPerOperation,
  operations: rows,
  keepAliveTotal: keepAliveTotal(),
  ...host,
  hostCaveat:
    "CI container, shared host; throughput figures describe this machine and vary run to run by tens of percent. The allocation counts do not — they are exact and host-independent. §86 has no math-throughput row; nothing here is compared against one.",
};

const path = writeResult("math-ops", record);

// --- the report --------------------------------------------------------------

const nameWidth = Math.max(...rows.map((row) => row.operation.length));
printReport([
  "fourJS — @fourjs/math operation throughput and allocation (§7b, §83, §92)",
  `  batch                   ${OPERATIONS_PER_BATCH.toLocaleString("en-US")} operations over ${VARIANTS} operand sets; ${MEASURED_BATCHES} measured batches, ${WARMUP_BATCHES} warm-up`,
  "",
  `  ${"operation".padEnd(nameWidth)}   median ms/batch      ns/op     Mop/s   alloc/batch`,
  ...rows.map((row) =>
    [
      `  ${row.operation.padEnd(nameWidth)}`,
      String(row.medianMsPerBatch).padStart(15),
      String(row.nanosecondsPerOperation).padStart(11),
      String(row.millionOperationsPerSecond).padStart(9),
      String(row.allocationsPerBatch).padStart(14),
      row.includesCopyReset ? "  (incl. copy reset)" : "",
    ].join(""),
  ),
  "",
  `  allocation (§7b, §83)   ${
    allocatingRows.length === 0
      ? `zero across all ${rows.length} rows × ${OPERATIONS_PER_BATCH.toLocaleString("en-US")} calls — the steady-state requirement holds`
      : `NON-ZERO in ${allocatingRows.length} row(s): ${allocatingRows.map((row) => row.operation).join(", ")}`
  }`,
  `  floor                   ${baselineRow.nanosecondsPerOperation} ns/op does the indexing and the read only; a row at the floor was optimised away, not fast`,
  '  copy reset              rows marked "incl. copy reset" include a copy of the same type; subtract that type\'s copy row',
  `  keep-alive fold         ${keepAliveTotal()} (proof the batches were not optimised away; not a checksum)`,
  "",
  ...hostLines(
    host,
    "shared CI container; throughput varies run to run, the allocation counts do not.",
  ),
  "",
  `  written                 ${path}`,
]);
