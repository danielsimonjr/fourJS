/**
 * RFC 0003's owed prototype measurements — bones-as-nodes resolve cost and
 * the 180-channel controller vs mixer path (§54, §17, §18, §86).
 *
 * ```sh
 * bun run build
 * node benchmarks/skinning-resolve.mjs
 * ```
 *
 * ## What is measured
 *
 * RFC 0003 §Prototype listed four numbers. Two of them are already other
 * packets' work (the unskinned GL byte-identity gate, the
 * `registerSkinningPipeline` bundle A/B). This script is the other two:
 *
 * 1. **Bones as nodes.** `resolveWorldTransforms` on a 60-bone chain versus
 *    the same topology built from ordinary `Group`s, and the same pair at
 *    10 rigs. Alternative A (a private transform array) comes back only if
 *    the bone walk costs more than the rest of the skinning path.
 * 2. **Controller channel cost.** One 60-bone clip pins 180 channels
 *    (position + rotation + scale per bone). The same clip is advanced once
 *    through `AnimationMixer` and once through `AnimationController`, which
 *    is the permanent shape under PH-9's purity rule.
 *
 * `Skeleton.update` is timed beside the resolve so the palette rewrite is
 * not silently folded into "the bone walk".
 *
 * ## Wall clocks and §86
 *
 * No clock reaches the scene: `advance` is handed a constant
 * {@link FIXED_DELTA_TIME}, dirtying happens in `prepare`, and
 * `performance.now()` lives in `harness.mjs`. §86 has **no skinned-mesh
 * row**; this record proposes one from the numbers rather than inheriting
 * a guess. Recorded, never gated.
 */

import {
  AnimationClip,
  AnimationController,
  AnimationMixer,
  AnimationTrack,
  quaternionAdapter,
  vector3Adapter,
} from "@fourjs/animation";
import { Quaternion, Vector3 } from "@fourjs/math";
import { Bone, Group, Skeleton, resolveWorldTransforms } from "@fourjs/scene";

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
  summaryFields,
  writeResult,
} from "./harness.mjs";

/** RFC 0003's representative rig. */
const BONES_PER_RIG = 60;

/** The ×10 comparison the RFC asked for. */
const RIG_COUNTS = [1, 10];

/** 60 bones × position / rotation / scale. */
const CHANNELS_PER_RIG = BONES_PER_RIG * 3;

/** §45 `fixedTimeStep`, in seconds. */
const FIXED_DELTA_TIME = 1 / 60;

const FIXED_STEP_BUDGET_MS = FIXED_DELTA_TIME * 1000;

const MEASURED_PASSES = 120;
const WARMUP_PASSES = 30;

const CLIP_DURATION_SECONDS = 2;
const KEYS_PER_TRACK = 8;
const MS_DIGITS = 4;

const TIMES = Array.from(
  { length: KEYS_PER_TRACK },
  (_unused, i) => (i * CLIP_DURATION_SECONDS) / (KEYS_PER_TRACK - 1),
);

function vectorKeys(phase) {
  return TIMES.map(
    (t) =>
      new Vector3(
        Math.sin(t * 3 + phase) * 0.05,
        0.05 + Math.cos(t * 2 + phase) * 0.02,
        0,
      ),
  );
}

function rotationKeys(phase) {
  const axis = new Vector3(0.267, 0.535, 0.802);
  return TIMES.map((t) =>
    new Quaternion().setFromAxisAngle(
      axis,
      (t / CLIP_DURATION_SECONDS) * 0.4 + phase * 0.01,
    ),
  );
}

function scaleKeys(phase) {
  return TIMES.map(
    (t) => new Vector3(1, 1 + Math.sin(t * 2 + phase) * 0.02, 1),
  );
}

/**
 * A chain of `count` nodes under `root`, each a `Bone` or a `Group`.
 * Distinct non-identity locals so the full resolve does a real multiply.
 */
function buildChain(root, count, makeNode) {
  const nodes = [];
  let parent = root;
  for (let i = 0; i < count; i += 1) {
    const node = makeNode(i);
    node.name = `${node.constructor.name.toLowerCase()}-${i}`;
    node.transform.position.set(0.01 * i, 0.05, 0);
    node.transformAuthority = "animation";
    parent.add(node);
    nodes.push(node);
    parent = node;
  }
  return nodes;
}

function buildRigs(rigCount, makeNode) {
  const world = new Group();
  world.name = `world-${rigCount}`;
  const rigs = [];
  for (let r = 0; r < rigCount; r += 1) {
    const root = new Group();
    root.name = `skin-root-${r}`;
    root.transform.position.set(r * 2, 0, 0);
    world.add(root);
    const nodes = buildChain(root, BONES_PER_RIG, makeNode);
    const bones = makeNode === boneFactory ? nodes : [];
    const skeleton =
      bones.length === 0 ? null : new Skeleton(/** @type {Bone[]} */ (bones));
    rigs.push({ root, nodes, skeleton });
  }
  return { world, rigs };
}

function boneFactory() {
  return new Bone();
}

function groupFactory() {
  return new Group();
}

function dirtyWorld(world) {
  world.transform.markDirty();
}

function runResolve(world, rigs, withPalette) {
  const { warmup, measured } = measure(
    () => {
      resolveWorldTransforms(world);
      if (withPalette) {
        for (let i = 0; i < rigs.length; i += 1) {
          const skeleton = rigs[i].skeleton;
          if (skeleton !== null) {
            skeleton.update(rigs[i].root);
          }
        }
      }
    },
    {
      warmupIterations: WARMUP_PASSES,
      measuredIterations: MEASURED_PASSES,
      prepare: () => dirtyWorld(world),
    },
  );
  const tip = rigs[0].nodes[rigs[0].nodes.length - 1].transform.worldMatrix;
  keepAlive(tip.elements[12] + tip.elements[13] + tip.elements[14]);
  if (withPalette && rigs[0].skeleton !== null) {
    keepAlive(rigs[0].skeleton.jointMatrices[0]);
  }
  return {
    warmupMeanMsPerPass: round(summarize(warmup).meanMs, MS_DIGITS),
    ...summaryFields(summarize(measured), "Pass", MS_DIGITS),
  };
}

function skeletalClip() {
  const tracks = [];
  for (let i = 0; i < BONES_PER_RIG; i += 1) {
    tracks.push(
      new AnimationTrack({
        path: `bones.${String(i)}.transform.position`,
        adapter: vector3Adapter,
        times: TIMES,
        values: vectorKeys(i),
        interpolation: "linear",
      }),
      new AnimationTrack({
        path: `bones.${String(i)}.transform.rotation`,
        adapter: quaternionAdapter,
        times: TIMES,
        values: rotationKeys(i),
        interpolation: "linear",
      }),
      new AnimationTrack({
        path: `bones.${String(i)}.transform.scale`,
        adapter: vector3Adapter,
        times: TIMES,
        values: scaleKeys(i),
        interpolation: "linear",
      }),
    );
  }
  return new AnimationClip({
    name: "rfc0003-60-bone",
    duration: CLIP_DURATION_SECONDS,
    tracks,
  });
}

function runAdvance(label, advance) {
  const { warmup, measured } = measure(() => advance(FIXED_DELTA_TIME), {
    warmupIterations: WARMUP_PASSES,
    measuredIterations: MEASURED_PASSES,
  });
  return {
    path: label,
    warmupMeanMsPerStep: round(summarize(warmup).meanMs, MS_DIGITS),
    ...summaryFields(summarize(measured), "Step", MS_DIGITS),
    meanFractionOfFixedStepBudget: round(
      summarize(measured).meanMs / FIXED_STEP_BUDGET_MS,
      4,
    ),
  };
}

// --- resolve: bones vs groups, ×1 and ×10 ------------------------------------

const resolveRows = [];
for (const rigCount of RIG_COUNTS) {
  const bones = buildRigs(rigCount, boneFactory);
  const groups = buildRigs(rigCount, groupFactory);
  const boneResolve = runResolve(bones.world, bones.rigs, false);
  const bonePalette = runResolve(bones.world, bones.rigs, true);
  const groupResolve = runResolve(groups.world, groups.rigs, false);
  resolveRows.push({
    rigs: rigCount,
    bones: BONES_PER_RIG,
    nodes: 1 + rigCount * (1 + BONES_PER_RIG),
    boneResolve,
    boneResolvePlusPalette: bonePalette,
    groupResolve,
    boneOverGroupMs: round(
      boneResolve.meanMsPerPass - groupResolve.meanMsPerPass,
      MS_DIGITS,
    ),
    paletteMs: round(
      bonePalette.meanMsPerPass - boneResolve.meanMsPerPass,
      MS_DIGITS,
    ),
  });
}

// --- 180 channels: mixer vs controller ---------------------------------------

const clip = skeletalClip();
if (clip.tracks.length !== CHANNELS_PER_RIG) {
  throw new Error(
    `skinning-resolve: clip has ${String(clip.tracks.length)} tracks, expected ${String(CHANNELS_PER_RIG)}`,
  );
}

const mixerWorld = buildRigs(1, boneFactory);
const mixerSkeleton = mixerWorld.rigs[0].skeleton;
const mixer = new AnimationMixer(mixerSkeleton).play(clip, { loop: Infinity });
const mixerRow = runAdvance("mixer", (dt) => mixer.advance(dt));
keepAlive(mixerSkeleton.bones[0].transform.position.y);

const controllerWorld = buildRigs(1, boneFactory);
const controllerSkeleton = controllerWorld.rigs[0].skeleton;
const controller = new AnimationController({
  target: controllerSkeleton,
  states: { bind: clip },
}).play();
const controllerRow = runAdvance("controller", (dt) => controller.advance(dt));
keepAlive(controllerSkeleton.bones[0].transform.position.y);

if (mixer.state !== "running") {
  throw new Error(`skinning-resolve: mixer is "${mixer.state}"`);
}

const oneRig = resolveRows.find((row) => row.rigs === 1);
const tenRigs = resolveRows.find((row) => row.rigs === 10);
const proposedCharactersInsideBudget = Math.max(
  1,
  Math.floor(
    FIXED_STEP_BUDGET_MS /
      Math.max(
        controllerRow.meanMsPerStep +
          oneRig.boneResolvePlusPalette.meanMsPerPass,
        1e-6,
      ),
  ),
);

const host = hostRecord();
const record = {
  _note: MEASUREMENT_NOTE,
  benchmark: "skinning-resolve",
  specification:
    "RFC 0003 prototype: bones-as-nodes resolve (60 ×1 / ×10) and 180-channel controller vs mixer; §54, §17, §18, §86",
  recordedAt: new Date().toISOString(),
  bonesPerRig: BONES_PER_RIG,
  channelsPerRig: CHANNELS_PER_RIG,
  fixedDeltaTimeSeconds: round(FIXED_DELTA_TIME, 9),
  fixedStepBudgetMs: round(FIXED_STEP_BUDGET_MS, 4),
  measuredPasses: MEASURED_PASSES,
  warmupPasses: WARMUP_PASSES,
  resolve: resolveRows,
  channels: {
    clipTracks: clip.tracks.length,
    mixer: mixerRow,
    controller: controllerRow,
    controllerOverMixerMs: round(
      controllerRow.meanMsPerStep - mixerRow.meanMsPerStep,
      MS_DIGITS,
    ),
  },
  proposedSection86:
    `${String(proposedCharactersInsideBudget)} independently animated 60-bone ` +
    `characters inside one 60 Hz fixed step on this host (resolve + palette + ` +
    `controller). Not a gate — this host is not §86's "suitable hardware".`,
  alternativeA:
    tenRigs.boneOverGroupMs <= 0.05
      ? `A 60-bone Bone chain is within noise of the same Group chain at ×10 (${String(tenRigs.boneOverGroupMs)} ms). The ×1 gap (${String(oneRig.boneOverGroupMs)} ms) does not grow with rig count. Alternative A (a private transform array) does not return on cost.`
      : `A 60-bone Bone chain costs ${String(tenRigs.boneOverGroupMs)} ms more than Groups at ×10; revisit alternative A if that gap exceeds the palette + channel work.`,
  keepAliveTotal: keepAliveTotal(),
  ...host,
  hostCaveat:
    "CI container, no GPU, shared host. §86 has no skinned-mesh row yet; the proposal above is from this measurement, not a verdict.",
};

const path = writeResult("skinning-resolve", record);

printReport([
  "fourJS — RFC 0003 bones-as-nodes and 180-channel cost (§54, §17, §18)",
  `  rig                     ${BONES_PER_RIG} bones, chain, Y-up locals`,
  `  channels                ${CHANNELS_PER_RIG} (position + rotation + scale per bone)`,
  `  60 Hz budget            ${round(FIXED_STEP_BUDGET_MS, 3)} ms/step`,
  "",
  " rigs   bone resolve   + palette   group resolve   bone−group   palette",
  ...resolveRows.map((row) =>
    [
      String(row.rigs).padStart(5),
      String(row.boneResolve.meanMsPerPass).padStart(14),
      String(row.boneResolvePlusPalette.meanMsPerPass).padStart(12),
      String(row.groupResolve.meanMsPerPass).padStart(16),
      String(row.boneOverGroupMs).padStart(13),
      String(row.paletteMs).padStart(10),
    ].join(""),
  ),
  "",
  `  180-channel mixer       ${mixerRow.meanMsPerStep} ms/step`,
  `  180-channel controller  ${controllerRow.meanMsPerStep} ms/step  (Δ ${record.channels.controllerOverMixerMs} ms)`,
  `  alternative A           ${record.alternativeA}`,
  `  proposed §86            ${record.proposedSection86}`,
  `  10-rig resolve          ${tenRigs.boneResolvePlusPalette.meanMsPerPass} ms (palette included)`,
  "",
  ...hostLines(host, "shared CI container; recorded, never gated."),
  "",
  `  written                 ${path}`,
]);
