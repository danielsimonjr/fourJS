/**
 * `AnimationMixer` sampling cost — a multi-track clip evaluated on N instances
 * per fixed step (§17 tracks, §16, §42; §92's *"CPU time"* metric; plan §6j
 * P11-4, WP-11.4).
 *
 * ```sh
 * bun run build          # this script imports the built dist, not src
 * node benchmarks/animation-sampling.mjs
 * ```
 *
 * ## What is measured
 *
 * One measured iteration is **`mixer.advance(fixedDeltaTime)` on every one of N
 * mixers** — the work `AnimationSystem` does once per frame. Per mixer that is:
 * advance the clip clock, resolve the loop iteration, sample every track at the
 * new clip-local time (§17 interpolation), check §42 authority once, and write
 * each sampled value through its binding into the node's `Transform`.
 *
 * The mixers are advanced directly rather than through `AnimationSystem`,
 * because the system's own per-frame work is a fixed cost over the list and
 * this benchmark is about what one animated object costs. The delta is the
 * constant {@link FIXED_DELTA_TIME}.
 *
 * ## The clip
 *
 * Four tracks, all bound into the node's own `Transform`, eight keys each over
 * {@link CLIP_DURATION_SECONDS} seconds, `linear` interpolation:
 * `transform.position`, `transform.rotation` (whose linear mode *is* slerp),
 * `transform.scale` and `transform.pivot`. Four is a plausible authored clip
 * for a moving prop, and keeping every track on the transform means the §42
 * authority gate is exercised on every instance on every step, which is part of
 * the real cost and is not something to measure with the gate switched off.
 *
 * Every node's `transformAuthority` is therefore `"animation"`. With the
 * default `"manual"` the mixer would refuse the writes and warn (§42), so the
 * benchmark would measure a refusal path N times per step and print a wall of
 * warnings — worth stating, because it is exactly the kind of detail that
 * quietly turns a benchmark into fiction.
 *
 * Clips and tracks are **immutable data and shared by every instance** (§17):
 * one clip object, N mixers. That is how an application animates a crowd, and
 * it means the numbers here are sampling and binding cost, not authoring cost.
 *
 * ## The attribution run
 *
 * The headline number alone cannot say whether a mixer is expensive or whether
 * *four tracks* are, so at {@link ATTRIBUTION_INSTANCES} instances the same
 * measurement is repeated with 1, 2 and 4 tracks. The 1-track figure is a
 * mixer's fixed per-step overhead plus one track; the slope between them is the
 * marginal cost of a track. Both are recorded; neither is acted on here.
 *
 * ## Wall clocks and §86
 *
 * No clock reaches the animation: `advance` is handed the constant
 * {@link FIXED_DELTA_TIME}, and `performance.now()` lives in `harness.mjs`.
 * Deleting every timer leaves the final poses bit-identical.
 *
 * §86 has **no mixer row**. Its nearest entry, *"animated glyphs: 20 000"*, is
 * about text rendering rather than about clip evaluation — a glyph is not a
 * mixer and 20 000 animated glyphs are usually one animated node. The 20 000
 * instance count here is chosen to sit at that same order of magnitude so the
 * two can be read side by side, and that is the whole of the relationship.
 * Recorded, never gated.
 */

import {
  AnimationClip,
  AnimationMixer,
  AnimationTrack,
  quaternionAdapter,
  vector3Adapter,
} from "@fourjs/animation";
import { Quaternion, Vector3 } from "@fourjs/math";
import { Group } from "@fourjs/scene";

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

/** §45 `fixedTimeStep`, in seconds (§7a: never milliseconds). */
const FIXED_DELTA_TIME = 1 / 60;

/** The budget one fixed step has at 60 Hz, in milliseconds. */
const FIXED_STEP_BUDGET_MS = FIXED_DELTA_TIME * 1000;

/** Instance counts measured with the full four-track clip. */
const INSTANCE_COUNTS = [250, 1000, 5000, 20000];

/** Instances used for the track-count attribution run. */
const ATTRIBUTION_INSTANCES = 5000;

/** Track counts compared at {@link ATTRIBUTION_INSTANCES}. */
const ATTRIBUTION_TRACK_COUNTS = [1, 2, 4];

/** Measured fixed steps per scenario (2 s of animation at 60 Hz). */
const MEASURED_STEPS = 120;

/** Unmeasured fixed steps first, so the reported mean is steady-state. */
const WARMUP_STEPS = 30;

/** Clip length in **seconds** (§7a — never milliseconds, tweens included). */
const CLIP_DURATION_SECONDS = 2;

/** Keyframes per track. */
const KEYS_PER_TRACK = 8;

/** Decimals kept for the millisecond statistics. */
const MS_DIGITS = 4;

/** Keyframe times: evenly spaced, strictly increasing, in seconds. */
const TIMES = Array.from(
  { length: KEYS_PER_TRACK },
  (_unused, i) => (i * CLIP_DURATION_SECONDS) / (KEYS_PER_TRACK - 1),
);

/** `KEYS_PER_TRACK` distinct vector keys, deterministic and well-conditioned. */
function vectorKeys(phase) {
  return TIMES.map(
    (t) =>
      new Vector3(
        Math.sin(t * 3 + phase) * 2,
        Math.cos(t * 2 + phase) * 1.5,
        0.5 + t * 0.25,
      ),
  );
}

/** `KEYS_PER_TRACK` unit quaternion keys about a fixed axis. */
function rotationKeys() {
  const axis = new Vector3(0.267, 0.535, 0.802);
  return TIMES.map((t) =>
    new Quaternion().setFromAxisAngle(axis, (t / CLIP_DURATION_SECONDS) * 4),
  );
}

/**
 * The four tracks, in the order a clip takes them. Track `k` of a `trackCount`
 * clip is `TRACKS[k]`, so the 1- and 2-track attribution clips are prefixes of
 * the 4-track headline clip rather than different clips.
 */
const TRACKS = [
  new AnimationTrack({
    path: "transform.position",
    adapter: vector3Adapter,
    times: TIMES,
    values: vectorKeys(0),
    interpolation: "linear",
  }),
  new AnimationTrack({
    path: "transform.rotation",
    adapter: quaternionAdapter,
    times: TIMES,
    values: rotationKeys(),
    interpolation: "linear",
  }),
  new AnimationTrack({
    path: "transform.scale",
    adapter: vector3Adapter,
    times: TIMES,
    values: vectorKeys(1.1).map((v) => v.set(1 + 0.1 * v.x, 1.05, 0.95)),
    interpolation: "linear",
  }),
  new AnimationTrack({
    path: "transform.pivot",
    adapter: vector3Adapter,
    times: TIMES,
    values: vectorKeys(2.3),
    interpolation: "linear",
  }),
];

/** One shared, immutable clip per track count (§17) — never one per instance. */
const CLIPS = new Map(
  ATTRIBUTION_TRACK_COUNTS.concat(TRACKS.length).map((count) => [
    count,
    new AnimationClip({
      name: `bench-${count}-track`,
      duration: CLIP_DURATION_SECONDS,
      tracks: TRACKS.slice(0, count),
    }),
  ]),
);

/**
 * Builds `instances` nodes, each with its own mixer playing the shared clip on
 * an endless loop, and returns the mixers.
 *
 * `transformAuthority` is `"animation"` on every node: see the header — the
 * default would make the mixer refuse its own writes.
 */
function buildMixers(instances, trackCount) {
  const clip = CLIPS.get(trackCount);
  const root = new Group();
  root.name = `animation-sampling-${instances}x${trackCount}`;
  const mixers = [];
  for (let i = 0; i < instances; i += 1) {
    const node = new Group();
    node.name = `instance-${i}`;
    node.transformAuthority = "animation";
    root.add(node);
    const mixer = new AnimationMixer(node).play(clip, { loop: Infinity });
    // Stagger the phase so the instances are not all sampling the same
    // keyframe segment on the same step — a real crowd is not in lockstep, and
    // one shared segment would measure a warmer branch than the engine sees.
    mixer.seek(((i % 97) / 97) * CLIP_DURATION_SECONDS);
    mixers.push(mixer);
  }
  // Held so the nodes cannot be collected mid-run while the mixers live on.
  return { mixers, root };
}

/** Runs one (instances × trackCount) scenario and returns its statistics. */
function runScenario(instances, trackCount) {
  const { mixers, root } = buildMixers(instances, trackCount);
  const { warmup, measured } = measure(
    () => {
      for (let i = 0; i < mixers.length; i += 1) {
        mixers[i].advance(FIXED_DELTA_TIME);
      }
    },
    { warmupIterations: WARMUP_STEPS, measuredIterations: MEASURED_STEPS },
  );

  // Read one animated value back, so nothing about the sampling can be treated
  // as unobserved, and assert the run actually animated.
  const probe = mixers[0].target.transform.position;
  keepAlive(probe.x + probe.y + probe.z);
  for (let i = 0; i < mixers.length; i += 1) {
    if (mixers[i].state !== "running") {
      throw new Error(
        `animation-sampling invalid: mixer ${i} is "${mixers[i].state}", expected "running"`,
      );
    }
  }
  keepAlive(root.children.length);

  const summary = summarize(measured);
  const warmupSummary = summarize(warmup);
  const trackSamplesPerStep = instances * trackCount;
  return {
    instances,
    tracksPerClip: trackCount,
    keysPerTrack: KEYS_PER_TRACK,
    interpolation: "linear",
    clipDurationSeconds: CLIP_DURATION_SECONDS,
    measuredSteps: MEASURED_STEPS,
    warmupSteps: WARMUP_STEPS,
    warmupMeanMsPerStep: round(warmupSummary.meanMs, MS_DIGITS),
    meanMsPerStep: round(summary.meanMs, MS_DIGITS),
    medianMsPerStep: round(summary.medianMs, MS_DIGITS),
    p95MsPerStep: round(summary.p95Ms, MS_DIGITS),
    p99MsPerStep: round(summary.p99Ms, MS_DIGITS),
    minMsPerStep: round(summary.minMs, MS_DIGITS),
    maxMsPerStep: round(summary.maxMs, MS_DIGITS),
    meanFractionOfFixedStepBudget: round(
      summary.meanMs / FIXED_STEP_BUDGET_MS,
      4,
    ),
    p95FractionOfFixedStepBudget: round(
      summary.p95Ms / FIXED_STEP_BUDGET_MS,
      4,
    ),
    microsecondsPerMixerStep: round((summary.meanMs * 1000) / instances, 3),
    nanosecondsPerTrackSample: round(
      (summary.meanMs * 1e6) / trackSamplesPerStep,
      1,
    ),
    trackSamplesPerSecond: Math.round(
      (trackSamplesPerStep / summary.meanMs) * 1000,
    ),
    insideBudgetAtP95: summary.p95Ms <= FIXED_STEP_BUDGET_MS,
  };
}

// --- the run -----------------------------------------------------------------

const headline = INSTANCE_COUNTS.map((instances) =>
  runScenario(instances, TRACKS.length),
);

const attribution = ATTRIBUTION_TRACK_COUNTS.map((trackCount) =>
  runScenario(ATTRIBUTION_INSTANCES, trackCount),
);

const oneTrack = attribution.find((row) => row.tracksPerClip === 1);
const fourTrack = attribution.find((row) => row.tracksPerClip === 4);
const perTrackMs = round(
  (fourTrack.meanMsPerStep - oneTrack.meanMsPerStep) / 3,
  MS_DIGITS,
);

/**
 * The headline run and the attribution run both measure 5 000 instances × 4
 * tracks, independently and minutes apart. Their disagreement is a free,
 * in-run estimate of this host's run-to-run spread and is published rather than
 * quietly averaged away — it is the scale at which any two numbers in this file
 * may be compared at all.
 */
const repeatHeadline = headline.find(
  (row) => row.instances === ATTRIBUTION_INSTANCES,
);
const repeatabilitySpread =
  repeatHeadline === undefined
    ? null
    : round(
        Math.abs(repeatHeadline.meanMsPerStep - fourTrack.meanMsPerStep) /
          Math.min(repeatHeadline.meanMsPerStep, fourTrack.meanMsPerStep),
        4,
      );

// --- the record --------------------------------------------------------------

const host = hostRecord();
const record = {
  _note: MEASUREMENT_NOTE,
  benchmark: "animation-sampling",
  specification:
    "§17 (tracks and interpolation), §16, §42 (transform authority), §92; plan §6j P11-4, WP-11.4",
  recordedAt: new Date().toISOString(),
  iteration:
    "one iteration is mixer.advance(fixedDeltaTime) over every instance — what AnimationSystem does per frame",
  fixedDeltaTimeSeconds: round(FIXED_DELTA_TIME, 9),
  fixedStepBudgetMs: round(FIXED_STEP_BUDGET_MS, 4),
  clip: `${TRACKS.length} tracks (${TRACKS.map((track) => track.path).join(", ")}), ${KEYS_PER_TRACK} linear keys over ${CLIP_DURATION_SECONDS} s, shared by every instance`,
  authorityNote:
    'Every node is transformAuthority "animation" (§42). With the default "manual" the mixer refuses its transform writes and warns, so a benchmark left on the default would measure the refusal path, not sampling.',
  sharingNote:
    "One clip object and one track object per track index, shared across all instances (§17 tracks are immutable data). These numbers are sampling and binding cost, not authoring cost.",
  attributionNote: `The same ${ATTRIBUTION_INSTANCES} instances measured with 1, 2 and 4 tracks: the 1-track row is a mixer's fixed per-step overhead plus one track, and the slope is the marginal cost of a track.`,
  scenarios: headline,
  attribution,
  attributionInstances: ATTRIBUTION_INSTANCES,
  marginalMsPerTrackPerInstanceSet: perTrackMs,
  marginalNanosecondsPerTrackPerInstance: round(
    (perTrackMs * 1e6) / ATTRIBUTION_INSTANCES,
    1,
  ),
  repeatabilityNote: `The ${ATTRIBUTION_INSTANCES}-instance headline row and the 4-track attribution row measure the same configuration independently; repeatabilitySpread is the relative gap between their means, and is this host's run-to-run noise floor. Do not read a difference smaller than it as a finding.`,
  repeatabilitySpread,
  keepAliveTotal: keepAliveTotal(),
  ...host,
  hostCaveat:
    "CI container, no GPU, shared host; run-to-run spread is large. §86 has no mixer row — its 'animated glyphs: 20 000' entry is about text rendering, not clip evaluation — so nothing here is compared against a §86 target. Recorded, never gated.",
};

const path = writeResult("animation-sampling", record);

// --- the report --------------------------------------------------------------

printReport([
  "fourJS — AnimationMixer sampling cost (§17, §16, §42, §92; plan §6j P11-4)",
  `  clip                    ${TRACKS.length} tracks, ${KEYS_PER_TRACK} linear keys over ${CLIP_DURATION_SECONDS} s, shared by every instance`,
  `  iteration               advance(${round(FIXED_DELTA_TIME, 6)} s) over every mixer — one frame of AnimationSystem's work`,
  `  steps                   ${MEASURED_STEPS} measured, ${WARMUP_STEPS} warm-up`,
  `  60 Hz budget            ${round(FIXED_STEP_BUDGET_MS, 3)} ms/step`,
  "",
  " instances    mean ms   median ms      p95 ms   % of budget   µs/mixer   ns/track sample",
  ...headline.map((row) =>
    [
      String(row.instances).padStart(10),
      String(row.meanMsPerStep).padStart(11),
      String(row.medianMsPerStep).padStart(12),
      String(row.p95MsPerStep).padStart(12),
      `${round(row.meanFractionOfFixedStepBudget * 100, 1)}%`.padStart(14),
      String(row.microsecondsPerMixerStep).padStart(11),
      String(row.nanosecondsPerTrackSample).padStart(18),
    ].join(""),
  ),
  "",
  `  where it goes           at ${ATTRIBUTION_INSTANCES.toLocaleString("en-US")} instances: ${attribution
    .map(
      (row) =>
        `${row.tracksPerClip} track${row.tracksPerClip === 1 ? "" : "s"} ${row.meanMsPerStep} ms`,
    )
    .join("; ")}`,
  `                          ≈ ${perTrackMs} ms per extra track per ${ATTRIBUTION_INSTANCES.toLocaleString("en-US")} instances (${record.marginalNanosecondsPerTrackPerInstance} ns per track per instance)`,
  `  noise floor             the ${ATTRIBUTION_INSTANCES.toLocaleString("en-US")}×4 configuration is measured twice above (${repeatHeadline.meanMsPerStep} and ${fourTrack.meanMsPerStep} ms):`,
  `                          ${round(repeatabilitySpread * 100, 1)}% apart on this host. Nothing smaller than that is a finding.`,
  `  keep-alive fold         ${round(keepAliveTotal(), 6)} (proof the advances were not optimised away; not a checksum)`,
  "",
  ...hostLines(
    host,
    "shared CI container; §86 has no mixer row, so nothing here is measured against a target.",
  ),
  "",
  `  written                 ${path}`,
]);
