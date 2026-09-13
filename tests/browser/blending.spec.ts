/**
 * Phase 7 browser gate: §110's *"a character or machine can move between
 * animated, kinematic, and physical control without abrupt discontinuities"*,
 * measured from outside the page (plan WP-7.7).
 *
 * `tests/determinism/phase7-blending.test.ts` proves §19's blend pipeline is
 * deterministic, and `tests/integration/physics-blending.test.ts` proves each of
 * §19's four worked examples matches its closed form. Neither answers the
 * question §110 actually asks, which is whether a *character* — an articulated
 * chain driven by a looping clip, handed to a solver on a click, and blended
 * back onto an animation that never stopped — keeps looking continuous in a
 * browser, at a real frame rate, while a user cycles its control mode. That is
 * what this file measures, in `examples/blending` — §110's demonstration —
 * through Chromium's real framebuffer and Playwright's real mouse.
 *
 * ```text
 * page load → Rapier wasm init → 3 systems (capture 299, animation 300, physics 600)
 *   → fixed-step accumulator → §19 blend → node transforms → WebglRenderer → pixels
 *                                    ↑
 *   Chromium mouse → PointerInput → pick → world.setBodyControlMode / §19 weights
 * ```
 *
 * ## The fourth site
 *
 * This spec drives a **fourth** server: `playwright.config.ts` runs one
 * `vite preview` per built example, `first-2d-scene` on 4173 (the suite's
 * `baseURL`), `physics-playground` on 4174, `mechanism` on 4175 and `blending`
 * on 4176. {@link BLENDING_URL} restates that port for the reason the scene
 * constants below are restated rather than imported — see "Method notes". Run
 * `bun run blending:build` before `bun run test:browser`, or the preview server has no
 * `dist` to serve.
 *
 * ## What is measured, and against what
 *
 * | test | §  | assertion |
 * | ---- | -- | --------- |
 * | loads | §45, §110 | `#status` reaches `data-state="running"` and the page starts in `data-mode="animated"` with no cycles behind it |
 * | ANIMATED | §16, §19 | a few framebuffer pairs show the chain's band changing while the ground slab and an empty corner of background do not change **at all**; the wave's span is read from `data-chain-y` until it is met |
 * | RAGDOLL | §19, §22, §110 | a click on the MODE plate reaches `data-mode="ragdoll"`, the plate repaints, and `data-chain-y` *descends* past the floor line without a teleport |
 * | RECOVER | §19, §110 | a second click reaches `"recovering"` and then `"animated"`, the sweep really takes its 1.5 s rather than snapping, the cycle counter increments, and `data-chain-y` is back inside the wave's band and swinging |
 *
 * Every threshold below states the number the reference run measured and how
 * much margin the threshold leaves. Nothing here is a golden image: the gate
 * runs on SwiftShader, whose rasterisation differs from a GPU's, so every
 * assertion is a measurement with margin (§92).
 *
 * ## Method notes
 *
 * The scene's numbers are **restated** from the example rather than imported,
 * for the reason `smoothness.spec.ts`, `interaction.spec.ts`,
 * `playground.spec.ts` and `mechanism.spec.ts` give: a browser gate checks the
 * built page from the outside, and importing the example's constants would let a
 * wrong scene agree with a wrong expectation.
 *
 * The PNG decoder is a copy of `example.spec.ts`'s, as in every other spec here:
 * Playwright returns an encoded screenshot, comparing compressed bytes would
 * conflate "the picture changed" with "the encoder picked different filters",
 * the workspace pins no image library, and this packet's file scope forbids
 * editing a sibling spec to share one.
 *
 * The **primary** signal in this file is split, on purpose. The page's own data
 * attributes — `data-mode`, `data-cycles`, `data-weight`, `data-entry`,
 * `data-step`, `data-worst`, `data-chain-y` — say what §19 did, because they are
 * the engine-side quantities §110 is stated over (`data-entry` and `data-step`
 * are per-*fixed-step* node displacements, which no screenshot cadence can
 * measure). The pixel measurements say that it reached the screen: an attribute
 * claims the chain collapsed, the framebuffer shows its bright pixels two world
 * units lower, and only both together say the demonstration works. Note that
 * `dataset["chainY"]` in the example is the attribute **`data-chain-y`** — the
 * DOM's own camelCase-to-dashed mapping, and a real trap when reading a page
 * from outside.
 */

import { inflateSync } from "node:zlib";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { framesFor, waitForFrames } from "./helpers/wait.js";

/** A decoded, unfiltered 8-bit image: `pixels` is `width * height` samples. */
interface DecodedImage {
  readonly width: number;
  readonly height: number;
  /** Bytes per pixel — 3 for RGB screenshots, 4 for RGBA. */
  readonly bytesPerPixel: number;
  readonly pixels: Buffer;
}

const PNG_SIGNATURE = 0x89504e47;

/** Samples per pixel for the PNG colour types Chromium emits. */
function channelsForColorType(colorType: number): number {
  switch (colorType) {
    case 0:
      return 1; // greyscale
    case 2:
      return 3; // truecolour
    case 4:
      return 2; // greyscale + alpha
    case 6:
      return 4; // truecolour + alpha
    default:
      throw new Error(`Unsupported PNG colour type ${String(colorType)}.`);
  }
}

/** Undoes one PNG scanline filter byte (RFC 2083 §6). */
function unfilterByte(
  filter: number,
  raw: number,
  left: number,
  above: number,
  upperLeft: number,
): number {
  switch (filter) {
    case 0:
      return raw;
    case 1:
      return raw + left;
    case 2:
      return raw + above;
    case 3:
      return raw + ((left + above) >> 1);
    case 4: {
      const estimate = left + above - upperLeft;
      const dLeft = Math.abs(estimate - left);
      const dAbove = Math.abs(estimate - above);
      const dUpperLeft = Math.abs(estimate - upperLeft);
      if (dLeft <= dAbove && dLeft <= dUpperLeft) return raw + left;
      return dAbove <= dUpperLeft ? raw + above : raw + upperLeft;
    }
    default:
      throw new Error(`Unsupported PNG filter type ${String(filter)}.`);
  }
}

/**
 * Decodes a non-interlaced 8-bit PNG — the only kind Playwright produces — into
 * raw samples. Deliberately dependency-free: the workspace pins no image
 * library, and the gate must not be the reason one is added.
 */
function decodePng(png: Buffer): DecodedImage {
  if (png.length < 8 || png.readUInt32BE(0) !== PNG_SIGNATURE) {
    throw new Error("Screenshot is not a PNG.");
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let seenHeader = false;
  const dataChunks: Buffer[] = [];

  for (let offset = 8; offset + 8 <= png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      if (body[12] !== 0) throw new Error("Interlaced PNGs are not supported.");
      seenHeader = true;
    } else if (type === "IDAT") {
      dataChunks.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12; // length + type + data + CRC
  }
  if (!seenHeader) throw new Error("PNG has no IHDR chunk.");
  if (bitDepth !== 8) {
    throw new Error(`Unsupported PNG bit depth ${String(bitDepth)}.`);
  }

  const bytesPerPixel = channelsForColorType(colorType);
  const stride = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(dataChunks));
  if (raw.length < height * (stride + 1)) {
    throw new Error("Truncated PNG image data.");
  }

  const pixels = Buffer.alloc(height * stride);
  let read = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[read];
    read += 1;
    const rowStart = y * stride;
    const previousStart = rowStart - stride;
    for (let x = 0; x < stride; x++) {
      const left =
        x >= bytesPerPixel ? pixels[rowStart + x - bytesPerPixel] : 0;
      const above = y > 0 ? pixels[previousStart + x] : 0;
      const upperLeft =
        y > 0 && x >= bytesPerPixel
          ? pixels[previousStart + x - bytesPerPixel]
          : 0;
      pixels[rowStart + x] =
        unfilterByte(filter, raw[read + x], left, above, upperLeft) & 0xff;
    }
    read += stride;
  }
  return { width, height, bytesPerPixel, pixels };
}

// --- the built page, restated from `examples/blending` -----------------------

/**
 * Where the blending example's `vite preview` server listens.
 *
 * Restated from `playwright.config.ts`'s `BLENDING_PORT`, which is what actually
 * starts the server; `use.baseURL` belongs to the *first* site, so every
 * navigation in this file is absolute.
 */
const BLENDING_URL = "http://localhost:4176/";

/** The orthographic camera's world extents: 16 × 9 units over a 16:9 canvas. */
const VIEW_LEFT = -8;
const VIEW_RIGHT = 8;
const VIEW_TOP = 4.5;
const VIEW_BOTTOM = -4.5;

/**
 * A rectangle of the world, `[x0, y0, x1, y1]` with `+Y` up (§7a).
 *
 * Every region below is stated in **world units** and converted with the
 * example's own map — `px = (x + 8) · 60`, `py = (4.5 − y) · 60` at its authored
 * 960 × 540 layout size — normalized by `image.width`/`image.height`, so a run
 * at DPR 2 produces the same numbers as a run at DPR 1.
 */
type WorldBox = readonly [number, number, number, number];

/**
 * The band the animated chain moves in: three 1.6 m links hanging from the
 * anchor at (−5.6, 1.8) and held out along +X by the wave.
 *
 * Measured over 4 s of wave, every bright chain pixel sat inside
 * `x ∈ [−5.63, −0.82]`, `y ∈ [1.05, 2.57]`, so this box clears the extremes by
 * ~0.3 world units on each side. It is used for the "the chain is moving"
 * delta; the wider {@link SCENE_REGION} is what follows the chain once it falls
 * out of this band.
 */
const CHAIN_BAND: WorldBox = [-6.1, 0.7, -0.5, 2.9];

/**
 * Everything the chain can reach, which is the whole visible world **except**
 * the control plate (which starts at x = 3.5 and is bright in all three of its
 * colours).
 *
 * Wide on purpose: a ragdoll swings, and a centroid computed over a box the
 * chain leaves would report the box's edge rather than the chain's motion.
 * Measured, the chain never left this one.
 */
const SCENE_REGION: WorldBox = [-8.0, -4.5, 3.4, 4.5];

/** A stretch of the ground slab well clear of where the chain lands. */
const GROUND_REGION: WorldBox = [2.0, -3.4, 6.0, -2.85];

/** A corner of empty background, far from every part of the scene. */
const BACKGROUND_REGION: WorldBox = [6.4, -1.5, 7.6, -0.3];

/**
 * The MODE plate, 2.2 × 1 at (4.6, 3.2), sampled over an inset that **excludes
 * the near-white disc** drawn on it (radius 0.22 about the plate's centre, i.e.
 * `x ∈ [4.38, 4.82]`) — so the mean below is the plate's own flat colour rather
 * than a blend of plate and mark.
 */
const PLATE_REGION: WorldBox = [3.7, 2.85, 4.3, 3.55];

/** Where the mouse aims for the plate: its centre, in world units. */
const PLATE_POINT = { x: 4.6, y: 3.2 };

// --- colours, as framebuffer bytes -------------------------------------------

/** An RGB colour as framebuffer bytes. */
type Rgb = readonly [number, number, number];

/**
 * The three mode colours this file reads, measured through SwiftShader by the
 * WP-7.7 probe and identical on all four of its runs.
 *
 * They are the example's `MODE_ANIMATED_COLOR`, `MODE_RAGDOLL_COLOR` and
 * `MODE_RECOVERING_COLOR` after the renderer's own conversion, which is why they
 * are stated as *measurements* rather than derived from the authored 0…1 floats.
 * (They happen to agree with `round(channel × 255)` exactly — this tier writes
 * unlit colours straight through — but that agreement is an observation, not an
 * assumption this file relies on.)
 */
const PLATE_ANIMATED_RGB: Rgb = [51, 230, 89];
const PLATE_RAGDOLL_RGB: Rgb = [242, 64, 76];
const PLATE_RECOVERING_RGB: Rgb = [89, 76, 250];

/**
 * How far a measured mean colour may sit from one of those, per byte.
 *
 * The repository convention (`interaction.spec.ts`, `playground.spec.ts`,
 * `mechanism.spec.ts`) is 24. The closest pair of mode colours here differs by
 * **153** in some channel (ragdoll vs recovering, in red; animated vs ragdoll
 * differ by 191 and animated vs recovering by 161), so 24 cannot confuse a pair
 * — and the probe measured a residual of **0** in every channel, because the
 * plate is a flat unlit quad sampled over a glyph-free inset.
 */
const COLOR_MATCH_TOLERANCE = 24;

/**
 * Max-channel byte at which a pixel counts as a chain link rather than a target
 * ghost or scenery.
 *
 * The example's colour discipline makes this a wide gap, and the probe measured
 * both sides of it: a link's brightest channel is **242–250** (yellow 250, sky
 * 250, magenta 242), a ghost's is at most **150** (0.6 × its link), the ground
 * slab is 48 and the background 23. 200 sits in the 92-byte gap between the two
 * moving tiers, so the centroid below follows the *bodies* and never their
 * targets — which matters exactly when the two diverge, i.e. during the ragdoll.
 */
const BRIGHT_THRESHOLD = 200;

// --- tolerances --------------------------------------------------------------

/**
 * Milliseconds to wait for `#status` to reach `data-state="running"`.
 *
 * The reference runs reached it **45–92 ms** after `load` — one `"2d"` world, so
 * one Rapier wasm image. 45 s is five hundred times that: it is not a
 * performance assertion, it is a "the wasm never arrived" assertion, and a cold,
 * contended CI machine must not fail it for being slow.
 */
const READY_TIMEOUT_MS = 45_000;

/** Milliseconds between the paired frames every motion measurement compares. */
const FRAME_GAP_MS = 200;

/**
 * Deadline for a published-attribute watch, milliseconds.
 *
 * Generous on purpose: the exit condition is "enough samples **and** the wave
 * span / floor drop has been seen". A fixed 4 s wall-clock window is what made
 * the span assertion measure dropped simulation time rather than the wave.
 */
const CHAIN_WATCH_DEADLINE_MS = 30_000;

/**
 * The sample floor for the §16 wave watch, matching the `>= 8` its assertion wants.
 *
 * These samples are `data-chain-y` reads, not screenshots: the count is no longer
 * a measure of how fast the runner can encode a PNG.
 */
const WAVE_MINIMUM_SAMPLES = 8;

/** Least published-height span that counts as a travelling wave, world units. */
const WAVE_SPAN_MINIMUM = 0.2;

/** Framebuffer pairs that prove the wave reached the pixels. */
const PIXEL_PROOF_PAIRS = 3;

/**
 * Least mean per-pixel channel-sum difference, between two frames
 * {@link FRAME_GAP_MS} apart, for the chain's band to count as moving.
 *
 * The metric is `Σ(|Δr| + |Δg| + |Δb|) / pixels` over {@link CHAIN_BAND}. Across
 * four probe runs the *smallest* 200 ms interval measured **19.60** and the
 * largest 102.83 — the spread is the wave's own speed, which passes through zero
 * twice a period. 6 is under a third of the smallest: it passes a page animating
 * at a third of the speed on a machine drawing a third as many frames, and fails
 * a frozen scene.
 */
const MOVING_REGION_DELTA_MINIMUM = 6;

/**
 * Pixels that may differ between two frames inside a region that must not change
 * at all.
 *
 * The ground stretch is 7 920 px and the background corner 5 184 px at DPR 1,
 * and the probe measured **0** changed pixels in both, on every run and every
 * interval — they are flat unlit quads that nothing animates. 8 is an insurance
 * allowance against a rasteriser that dithers, and is still 0.1 % of the ground
 * stretch.
 */
const STATIC_REGION_CHANGED_MAXIMUM = 8;

/**
 * The band the animated chain's bright centroid stays inside, in world Y.
 *
 * Measured over four runs and several wave periods: **1.469 … 2.147**. The
 * bounds below clear that by ~0.45 either way, and the thing they have to
 * exclude is unmissable — a collapsed chain's centroid sits at **−0.5**, two
 * world units below the lower bound.
 */
const WAVE_BAND_MINIMUM_Y = 1.0;
const WAVE_BAND_MAXIMUM_Y = 2.6;

/**
 * How far the chain's centroid must fall for the ragdoll to count as a collapse,
 * and how low it must get.
 *
 * Measured: the centroid starts wherever the wave had it (1.59 … 1.75) and
 * reaches **−0.499 … −0.517** within about a second, a drop of ~2.1 world units.
 * A drop of 1.0 and a floor of 0.6 are both about half of what was measured, and
 * neither is reachable by a chain that is still being animated (whose centroid
 * never leaves {@link WAVE_BAND_MINIMUM_Y} … {@link WAVE_BAND_MAXIMUM_Y}).
 */
const RAGDOLL_MINIMUM_DROP = 1.0;
const RAGDOLL_FLOOR_Y = 0.6;

/**
 * The sample floor for {@link watchPublishedChain} during the ragdoll, above the
 * `> 10` its assertions want.
 *
 * These are `data-chain-y` reads paced by rAF, so the floor is "did the watch
 * actually run" rather than "did the runner encode twelve PNGs".
 */
const RAGDOLL_MINIMUM_SAMPLES = 12;

/**
 * The fastest the chain's bright centroid may travel between two consecutive
 * screenshots, in world units per second.
 *
 * This is the "no teleport" assertion, and it is stated as a **speed** rather
 * than as a distance because the sampling interval is whatever the machine can
 * screenshot at (measured 110–172 ms): a slower machine legitimately sees larger
 * gaps, and a bound that ignored that would be a bound on the CI machine rather
 * than on the page.
 *
 * Two measurements set it. The page's own `data-worst` — the largest distance
 * any link moved in one **fixed step** — is 0.131–0.135 m over the whole cycle,
 * i.e. at most 8.1 world units per second, and nothing drawn can move faster
 * than the fastest link. The centroid itself peaked at **5.6** units/s (a
 * 0.4621-unit jump across a 130 ms gap, at the top of the fall). 12 is 1.5× the
 * link bound and 2.1× the measured centroid speed.
 *
 * What it still catches at the observed cadence: the collapse spans ~2.1 world
 * units, so a chain that *teleported* from the wave band to the floor between
 * two frames would have to do it in ≥ 175 ms to slip through — longer than the
 * measured screenshot interval.
 */
const MAX_CENTROID_SPEED = 12;

/**
 * Bright pixels the chain must keep showing, so a "descending centroid" can
 * never be an artefact of the chain disappearing.
 *
 * Measured: ~5 860 while animated, and never below **4 405** during the ragdoll
 * (the dip is links overlapping each other as the chain folds). 1 000 is under a
 * quarter of the worst case.
 */
const MINIMUM_BRIGHT_PIXELS = 1000;

/**
 * Milliseconds allowed for the recovery to run `"recovering"` → `"animated"`.
 *
 * The sweep is 90 fixed steps = 1.5 s of simulation; the probe measured
 * **1 422–1 617 ms** of wall clock. 15 s is ten times that.
 */
const RECOVERY_TIMEOUT_MS = 15_000;

/**
 * Least wall-clock milliseconds the recovery may take.
 *
 * The sweep is a *timed* blend, not a scripted snap: 90 fixed steps at 1/60 s
 * cannot finish in less than 1.5 s of simulation, and simulation time never runs
 * ahead of the wall clock (§10 drops time, it never invents it). 1 000 ms is
 * two-thirds of that floor, so it fails only a page that skipped the sweep.
 */
const RECOVERY_MINIMUM_MS = 1000;

/**
 * Milliseconds allowed for the chain to collapse onto the floor before the
 * recovery is requested. A ceiling for `expect.poll`, not a fixed wait: the
 * fall takes ~1 s of simulation, and polling stops the moment the centroid
 * crosses the floor line.
 */
const COLLAPSE_TIMEOUT_MS = 10_000;

/**
 * Largest per-fixed-step link displacement, in metres, that either control-mode
 * switch may cost — §110's criterion in the page's own units (`data-entry`).
 *
 * Measured across four runs: **0.0055, 0.0069, 0.0081, 0.0104** at the ragdoll
 * activation and **0.0079, 0.0099, 0.0108, 0.0146** at the re-type. Both are at
 * or under the wave's *own* largest per-step displacement, 0.0146 m — which is
 * the honest statement of §110 here: neither switch costs more than the
 * animation was already spending. 0.05 is 3.4× the largest of those eight
 * numbers, and a teleport would be orders of magnitude past it.
 */
const ENTRY_STEP_MAXIMUM = 0.05;

/**
 * Bounds on `data-worst`, the largest per-fixed-step link displacement since the
 * page loaded, once a full cycle has run.
 *
 * Measured **0.1314–0.1346 m**, all of it inside the physical phase (the
 * animated phases spend 0.0146). The lower bound asserts the ragdoll really
 * moved — a page that never left its animation would report 0.0146 — and the
 * upper bound is a stability ceiling a diverging solve would blow through.
 */
const WORST_STEP_MINIMUM = 0.05;
const WORST_STEP_MAXIMUM = 0.5;

/**
 * Largest per-fixed-step displacement the wave alone spends, in metres, plus
 * margin.
 *
 * The page reports 0.0146 m in every animated phase, on every run — the same
 * number `tests/determinism/golden/phase7.json` records as
 * `maxStepAnimatedMicro: 14626`, from a headless run of the same rig. 0.03 is
 * about twice it.
 */
const ANIMATED_STEP_MAXIMUM = 0.03;

// --- opening the page --------------------------------------------------------

/** Errors seen since the page was created, in the order the browser saw them. */
type ErrorLog = readonly string[];

/**
 * Opens the blending page and returns its live error log.
 *
 * `favicon.ico` is served rather than 404-ed, exactly as the other specs do it:
 * the browser asks for it on its own, the example ships none, and the resulting
 * "failed to load resource" console error would otherwise have to be excused by
 * an allowlist — which would also excuse a real 404 for a real asset.
 *
 * Note what is *not* filtered: Rapier's wasm loader writes a "using deprecated
 * parameters" notice through `console.warn`, and a warning is not an error, so
 * the log below stays empty without anyone having to say so.
 */
async function openBlending(page: Page): Promise<ErrorLog> {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console.error: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.name}: ${error.message}`);
  });
  await page.route("**/favicon.ico", (route) =>
    route.fulfill({ status: 200, contentType: "image/x-icon", body: "" }),
  );
  await page.goto(BLENDING_URL, { waitUntil: "load" });
  return errors;
}

/**
 * Waits for the example to announce that the wasm is in, the chain is assembled
 * and hinged, and the loop is running (§45's composition root finished
 * `initialize`).
 *
 * This is the readiness gate every other measurement hangs off: before it, the
 * canvas has never been drawn into, and "the scene has not started" and "the
 * scene is broken" look identical from the framebuffer.
 */
async function waitForRunning(page: Page): Promise<void> {
  await expect(page.locator("#status")).toHaveAttribute(
    "data-state",
    "running",
    { timeout: READY_TIMEOUT_MS },
  );
}

async function grab(canvas: Locator): Promise<DecodedImage> {
  return decodePng(await canvas.screenshot());
}

// --- reading the example's own state ----------------------------------------

/**
 * Reads one of `#status`'s data attributes as a number.
 *
 * `key` is the **attribute** spelling: the example writes `dataset["chainY"]`,
 * which the DOM publishes as `data-chain-y`.
 */
async function readNumber(page: Page, key: string): Promise<number> {
  const raw = await page.locator("#status").getAttribute(`data-${key}`);
  expect(raw, `the page publishes no data-${key}`).not.toBeNull();
  return Number(raw);
}

// --- reading the framebuffer -------------------------------------------------

/** A half-open pixel rectangle of a screenshot. */
interface PixelBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** A world rectangle as screenshot pixels, DPR-agnostic (see the map above). */
function pixelBox(image: DecodedImage, box: WorldBox): PixelBox {
  const toColumn = (worldX: number): number =>
    Math.round(((worldX - VIEW_LEFT) / (VIEW_RIGHT - VIEW_LEFT)) * image.width);
  const toRow = (worldY: number): number =>
    Math.round(((VIEW_TOP - worldY) / (VIEW_TOP - VIEW_BOTTOM)) * image.height);
  return {
    left: toColumn(box[0]),
    right: toColumn(box[2]),
    top: toRow(box[3]),
    bottom: toRow(box[1]),
  };
}

/** The largest per-channel difference between two colours. */
function colorDistance(a: Rgb, b: Rgb): number {
  return Math.max(
    Math.abs(a[0] - b[0]),
    Math.abs(a[1] - b[1]),
    Math.abs(a[2] - b[2]),
  );
}

/** The mean colour of one world rectangle. */
function meanColor(image: DecodedImage, box: WorldBox): Rgb {
  const area = pixelBox(image, box);
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  for (let row = area.top; row < area.bottom; row += 1) {
    for (let column = area.left; column < area.right; column += 1) {
      const at = (row * image.width + column) * image.bytesPerPixel;
      sumR += image.pixels[at];
      sumG += image.pixels[at + 1];
      sumB += image.pixels[at + 2];
      count += 1;
    }
  }
  expect(count, "an empty sample region cannot have a colour").toBeGreaterThan(
    0,
  );
  return [
    Math.round(sumR / count),
    Math.round(sumG / count),
    Math.round(sumB / count),
  ];
}

/** How much two frames differ inside one world rectangle. */
interface RegionDelta {
  /** Mean of `|Δr| + |Δg| + |Δb|` over the region's pixels. */
  readonly mean: number;
  /** How many of them differ at all. */
  readonly changed: number;
  /** How many there are. */
  readonly pixels: number;
}

/** Measures {@link RegionDelta} between two same-sized frames. */
function regionDelta(
  before: DecodedImage,
  after: DecodedImage,
  box: WorldBox,
): RegionDelta {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error("Frames have different sizes.");
  }
  const area = pixelBox(before, box);
  let sum = 0;
  let changed = 0;
  let pixels = 0;
  for (let row = area.top; row < area.bottom; row += 1) {
    for (let column = area.left; column < area.right; column += 1) {
      const at = (row * before.width + column) * before.bytesPerPixel;
      const delta =
        Math.abs(before.pixels[at] - after.pixels[at]) +
        Math.abs(before.pixels[at + 1] - after.pixels[at + 1]) +
        Math.abs(before.pixels[at + 2] - after.pixels[at + 2]);
      sum += delta;
      if (delta > 0) changed += 1;
      pixels += 1;
    }
  }
  expect(pixels, "an empty region cannot be compared").toBeGreaterThan(0);
  return { mean: sum / pixels, changed, pixels };
}

/** Where the chain's bright pixels are, and how many of them there are. */
interface Centroid {
  /** Bright pixels found; 0 means the chain is not in the region at all. */
  readonly count: number;
  /** Their mean world Y (+Y up), or `NaN` when there are none. */
  readonly y: number;
}

/**
 * The centroid of the *links* inside `box`, in world Y.
 *
 * "Links" rather than "everything drawn": {@link BRIGHT_THRESHOLD} keeps the
 * target ghosts out, which is the whole point — during the ragdoll the ghosts
 * are still up in the wave band while the bodies are on the floor, and a
 * centroid over both would report the average of two different stories.
 */
function brightCentroid(image: DecodedImage, box: WorldBox): Centroid {
  const area = pixelBox(image, box);
  let sumRow = 0;
  let count = 0;
  for (let row = area.top; row < area.bottom; row += 1) {
    for (let column = area.left; column < area.right; column += 1) {
      const at = (row * image.width + column) * image.bytesPerPixel;
      const max = Math.max(
        image.pixels[at],
        image.pixels[at + 1],
        image.pixels[at + 2],
      );
      if (max >= BRIGHT_THRESHOLD) {
        sumRow += row;
        count += 1;
      }
    }
  }
  if (count === 0) {
    return { count: 0, y: Number.NaN };
  }
  return {
    count,
    y: VIEW_TOP - (sumRow / count / image.height) * (VIEW_TOP - VIEW_BOTTOM),
  };
}

/** One timed `data-chain-y` sample. */
interface ChainYSample {
  readonly y: number;
  /** Milliseconds since the watch began, from the wall clock (never assumed). */
  readonly at: number;
}

/** Yields until the page's next animation frame, so the simulation can run. */
async function nextAnimationFrame(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      }),
  );
}

/** Span of published chain heights in `samples`. */
function chainYSpan(samples: readonly ChainYSample[]): number {
  const values = samples.map((sample) => sample.y);
  return Math.max(...values) - Math.min(...values);
}

/**
 * Samples `#status[data-chain-y]` until `enough` is true **or** the deadline.
 *
 * No screenshots: a framebuffer grab is what starved the simulation and made a
 * 4 s wall-clock watch shorter than one 3.6 s wave period. One rAF between
 * reads so the loop cannot outrun the page. The deadline is a ceiling, not a
 * window that then asserts a count — a machine that never publishes enough
 * motion fails the caller's assertion, not a sample-count floor about the
 * runner.
 */
async function watchPublishedChain(
  page: Page,
  enough: (samples: readonly ChainYSample[]) => boolean,
  minimumSamples: number,
  deadlineMs: number = CHAIN_WATCH_DEADLINE_MS,
): Promise<readonly ChainYSample[]> {
  const samples: ChainYSample[] = [];
  const startedAt = Date.now();
  do {
    samples.push({
      y: await readNumber(page, "chain-y"),
      at: Date.now() - startedAt,
    });
    if (samples.length >= minimumSamples && enough(samples)) {
      break;
    }
    await nextAnimationFrame(page);
  } while (Date.now() - startedAt < deadlineMs);
  return samples;
}

/** A rectangle in CSS pixels, as `Locator.boundingBox` reports one. */
interface CssRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The canvas's CSS rectangle — where the mouse has to aim. */
async function cssRectOf(canvas: Locator): Promise<CssRect> {
  const box = await canvas.boundingBox();
  expect(
    box,
    "the canvas has no layout box, so it cannot be pointed at",
  ).not.toBeNull();
  return box as CssRect;
}

/**
 * Clicks a world point with a real Chromium mouse, as `interaction.spec.ts` does
 * it: the canvas's CSS rectangle turns a world coordinate into a viewport one,
 * DPR and page layout included.
 */
async function clickWorldPoint(
  page: Page,
  rect: CssRect,
  point: { x: number; y: number },
): Promise<void> {
  await page.mouse.click(
    rect.x + ((point.x - VIEW_LEFT) / (VIEW_RIGHT - VIEW_LEFT)) * rect.width,
    rect.y + ((VIEW_TOP - point.y) / (VIEW_TOP - VIEW_BOTTOM)) * rect.height,
  );
}

/** Asserts the plate is showing `expected`, and names what it read if not. */
async function expectPlate(
  canvas: Locator,
  expected: Rgb,
  label: string,
): Promise<void> {
  const measured = meanColor(await grab(canvas), PLATE_REGION);
  expect(
    colorDistance(measured, expected),
    `the MODE plate reads ${JSON.stringify(measured)} while ${label}, not ${JSON.stringify(expected)}`,
  ).toBeLessThanOrEqual(COLOR_MATCH_TOLERANCE);
}

// --- tests -------------------------------------------------------------------

test.describe("§110: animated ↔ kinematic ↔ physical control in the browser", () => {
  test("loads, decodes the wasm solver, and starts the chain animated", async ({
    page,
  }) => {
    const errors = await openBlending(page);
    const canvas = page.locator("#scene");
    await expect(canvas).toBeVisible();

    // The readiness gate itself: `data-state` goes `loading` → `running` only
    // after `Application.initialize` and `PhysicsWorld.initialize` resolved and
    // the chain was assembled, hinged and given its mixers.
    await waitForRunning(page);

    const status = page.locator("#status");
    // §19's opening state: fully animated, nothing cycled yet.
    await expect(status).toHaveAttribute("data-mode", "animated");
    await expect(status).toHaveAttribute("data-cycles", "0");
    await expect(status).toHaveAttribute("data-weight", "1.000");
    await expectPlate(canvas, PLATE_ANIMATED_RGB, "animated");

    // The drawing buffer is real, and it is the 16:9 view the map assumes.
    const drawingBuffer = await canvas.evaluate(
      (element: HTMLCanvasElement) => ({
        width: element.width,
        height: element.height,
      }),
    );
    expect(drawingBuffer.width).toBeGreaterThan(0);
    expect(drawingBuffer.height).toBeGreaterThan(0);

    const frame = await grab(canvas);
    const rect = await cssRectOf(canvas);
    // The screenshot and the CSS rectangle may differ in scale — that is the
    // DPR — but not in shape, or every pixel measured from one and pointed at
    // with the other would be silently wrong.
    expect(
      Math.abs(frame.width / frame.height - rect.width / rect.height),
      `the screenshot is ${String(frame.width)}×${String(frame.height)} but the canvas ` +
        `is ${String(rect.width)}×${String(rect.height)} CSS px`,
    ).toBeLessThan(0.01);
    expect(
      frame.width / frame.height,
      "the canvas is not the 16:9 view every world↔pixel conversion here assumes",
    ).toBeCloseTo((VIEW_RIGHT - VIEW_LEFT) / (VIEW_TOP - VIEW_BOTTOM), 2);

    // The chain is drawn, and it is where the wave puts it.
    const centroid = brightCentroid(frame, SCENE_REGION);
    expect(
      centroid.count,
      "no link pixels at all — the chain was never drawn",
    ).toBeGreaterThan(MINIMUM_BRIGHT_PIXELS);
    expect(centroid.y).toBeGreaterThan(WAVE_BAND_MINIMUM_Y);
    expect(centroid.y).toBeLessThan(WAVE_BAND_MAXIMUM_Y);

    // A loop that throws on its first frames does so after `running`, so keep
    // the page alive long enough for that to be collected.
    await waitForFrames(page, framesFor(1));
    expect(errors).toEqual([]);
  });

  test("ANIMATED: the wave moves the chain while the scenery stays still (§16, §19)", async ({
    page,
  }) => {
    const errors = await openBlending(page);
    const canvas = page.locator("#scene");
    const status = page.locator("#status");
    await waitForRunning(page);

    let previous = await grab(canvas);
    const bandDeltas: number[] = [];
    // A handful of framebuffer pairs prove the wave reached the pixels and the
    // scenery did not. The wave *period* is watched below via `data-chain-y`:
    // screenshotting for that long is what starved the simulation.
    // Capture all required pairs. Screenshot latency is not simulation time;
    // the test's timeout already bounds a stalled browser.
    for (let pair = 0; pair < PIXEL_PROOF_PAIRS; pair += 1) {
      await page.waitForTimeout(FRAME_GAP_MS);
      const frame = await grab(canvas);

      // The chain's band changed — it is being animated, right now.
      const moving = regionDelta(previous, frame, CHAIN_BAND);
      bandDeltas.push(moving.mean);
      expect(
        moving.mean,
        `the chain's band changed by a mean of ${moving.mean.toFixed(2)} per pixel over ` +
          `${String(FRAME_GAP_MS)} ms (${String(moving.changed)} of ${String(moving.pixels)} pixels) — the wave is not running`,
      ).toBeGreaterThan(MOVING_REGION_DELTA_MINIMUM);

      // …and the parts that must not move did not. This is what makes the
      // measurement above a statement about the *chain* rather than about the
      // page repainting.
      for (const [label, region] of [
        ["ground slab", GROUND_REGION],
        ["background", BACKGROUND_REGION],
      ] as const) {
        const still = regionDelta(previous, frame, region);
        expect(
          still.changed,
          `${label}: ${String(still.changed)} of ${String(still.pixels)} pixels changed in a region that never animates`,
        ).toBeLessThanOrEqual(STATIC_REGION_CHANGED_MAXIMUM);
      }

      // The chain is drawn, and it is where the wave puts it.
      const centroid = brightCentroid(frame, SCENE_REGION);
      expect(centroid.count).toBeGreaterThan(MINIMUM_BRIGHT_PIXELS);
      expect(centroid.y).toBeGreaterThan(WAVE_BAND_MINIMUM_Y);
      expect(centroid.y).toBeLessThan(WAVE_BAND_MAXIMUM_Y);

      previous = frame;
    }
    expect(bandDeltas.length).toBeGreaterThanOrEqual(PIXEL_PROOF_PAIRS);

    // The travelling-wave assertion is a published height, not a PNG: sample
    // until the span is met or the deadline, so a slow machine grows the
    // window instead of failing a count about the runner.
    const wave = await watchPublishedChain(
      page,
      (samples) => chainYSpan(samples) > WAVE_SPAN_MINIMUM,
      WAVE_MINIMUM_SAMPLES,
    );
    expect(wave.length).toBeGreaterThanOrEqual(WAVE_MINIMUM_SAMPLES);
    for (const sample of wave) {
      expect(sample.y).toBeGreaterThan(WAVE_BAND_MINIMUM_Y);
      expect(sample.y).toBeLessThan(WAVE_BAND_MAXIMUM_Y);
    }
    expect(
      chainYSpan(wave),
      "the chain's published height never moved: this is a still pose, not a wave",
    ).toBeGreaterThan(WAVE_SPAN_MINIMUM);

    // The page stayed animated throughout, and §110's per-fixed-step number for
    // an animated phase is the wave's own — 0.0146 m, the same figure
    // golden/phase7.json records as `maxStepAnimatedMicro`.
    await expect(status).toHaveAttribute("data-mode", "animated");
    expect(await readNumber(page, "step")).toBeLessThanOrEqual(
      ANIMATED_STEP_MAXIMUM,
    );
    expect(errors).toEqual([]);
  });

  test("RAGDOLL: a click hands the chain to the solver and it falls, without a teleport (§19, §22, §110)", async ({
    page,
  }) => {
    const errors = await openBlending(page);
    const canvas = page.locator("#scene");
    const status = page.locator("#status");
    await waitForRunning(page);

    const before = brightCentroid(await grab(canvas), SCENE_REGION);
    expect(before.y).toBeGreaterThan(WAVE_BAND_MINIMUM_Y);

    // §19's first switch — `setBodyControlMode("dynamic", { inheritVelocityFrom })`
    // — reached through §71/§72 picking: a real Chromium click on the plate.
    const rect = await cssRectOf(canvas);
    await clickWorldPoint(page, rect, PLATE_POINT);
    await expect(status).toHaveAttribute("data-mode", "ragdoll");
    // The click reached the screen as well as the state.
    await expectPlate(canvas, PLATE_RAGDOLL_RGB, "a ragdoll");
    // §19's weights went the other way with it.
    await expect(status).toHaveAttribute("data-weight", "0.000");

    const samples = await watchPublishedChain(
      page,
      (seen) => Math.min(...seen.map((sample) => sample.y)) < RAGDOLL_FLOOR_Y,
      RAGDOLL_MINIMUM_SAMPLES,
    );
    expect(samples.length).toBeGreaterThan(10);

    // The chain is still drawn after the fall, so "the height dropped" cannot
    // be an artefact of the links vanishing from the page's own account.
    const after = brightCentroid(await grab(canvas), SCENE_REGION);
    expect(after.count).toBeGreaterThan(MINIMUM_BRIGHT_PIXELS);

    // It descended — out of the wave band and past the floor line.
    const lowest = Math.min(...samples.map((sample) => sample.y));
    expect(
      lowest,
      `the chain's lowest published height over the collapse was ${lowest.toFixed(3)}, ` +
        `starting from ${before.y.toFixed(3)}`,
    ).toBeLessThan(RAGDOLL_FLOOR_Y);
    expect(before.y - lowest).toBeGreaterThan(RAGDOLL_MINIMUM_DROP);

    // …and it got there continuously. Each consecutive pair is compared against
    // the wall-clock gap that actually separated it, so a slow machine gets a
    // proportionally larger allowance rather than a spurious failure.
    for (let i = 1; i < samples.length; i += 1) {
      const gapSeconds = (samples[i].at - samples[i - 1].at) / 1000;
      const jump = Math.abs(samples[i].y - samples[i - 1].y);
      expect(
        jump,
        `the chain's published height moved ${jump.toFixed(4)} world units in ` +
          `${(gapSeconds * 1000).toFixed(0)} ms (${(jump / gapSeconds).toFixed(2)} units/s) ` +
          `at ${String(samples[i].at)} ms into the collapse — that is a teleport, not a fall`,
      ).toBeLessThanOrEqual(MAX_CENTROID_SPEED * gapSeconds);
    }

    // §110 in the page's own units: the *first fixed step* of the new control
    // mode, which is the only step a hand-over can teleport on, and which no
    // screenshot cadence can see. Measured 0.0055–0.0104 m — at or under what
    // the wave itself spends per step.
    const entry = await readNumber(page, "entry");
    expect(
      entry,
      `the ragdoll activation moved a link ${entry.toFixed(4)} m in its first fixed step`,
    ).toBeLessThanOrEqual(ENTRY_STEP_MAXIMUM);

    // Still a ragdoll: the page does not recover on its own.
    await expect(status).toHaveAttribute("data-mode", "ragdoll");
    expect(errors).toEqual([]);
  });

  test("RECOVER: a second click blends the chain back onto its animation (§19, §110)", async ({
    page,
  }) => {
    const errors = await openBlending(page);
    const canvas = page.locator("#scene");
    const status = page.locator("#status");
    await waitForRunning(page);
    const rect = await cssRectOf(canvas);

    // Into the ragdoll, and let it collapse onto the floor. Polled rather than
    // a fixed wait: under SwiftShader CPU contention a fixed pause can catch
    // the chain mid-fall, and the assertion needs "it got there", not "it got
    // there on schedule".
    await clickWorldPoint(page, rect, PLATE_POINT);
    await expect(status).toHaveAttribute("data-mode", "ragdoll");
    await expect
      .poll(async () => readNumber(page, "chain-y"), {
        message:
          "the chain never left the wave band, so there is nothing to recover from",
        timeout: COLLAPSE_TIMEOUT_MS,
      })
      .toBeLessThan(RAGDOLL_FLOOR_Y);
    const cyclesBefore = await readNumber(page, "cycles");

    // §19's second switch: the weight sweep, then the re-type. The clock
    // starts BEFORE the click that starts the sweep: the click→"animated"
    // interval is then a strict superset of the 1.5 s sweep, so the
    // RECOVERY_MINIMUM_MS lower bound below is deterministic. (It used to
    // start after `expectPlate`, whose SwiftShader screenshot could swallow
    // 500+ ms of the sweep — the recorded 1-in-3 hard fail of this spec.)
    const sweepStartedAt = Date.now();
    await clickWorldPoint(page, rect, PLATE_POINT);
    await expect(status).toHaveAttribute("data-mode", "recovering");
    await expectPlate(canvas, PLATE_RECOVERING_RGB, "recovering");

    await expect(status).toHaveAttribute("data-mode", "animated", {
      timeout: RECOVERY_TIMEOUT_MS,
    });
    const sweepMs = Date.now() - sweepStartedAt;

    // The sweep is a timed 1.5 s blend, not a scripted snap: 90 fixed steps
    // cannot pass in less wall clock than that (§10 drops time, never invents
    // it). Measured 1 422–1 617 ms.
    expect(
      sweepMs,
      `the recovery finished in ${String(sweepMs)} ms — too fast to be a 1.5 s weight sweep`,
    ).toBeGreaterThanOrEqual(RECOVERY_MINIMUM_MS);

    // One full ANIMATED → RAGDOLL → RECOVERING → ANIMATED cycle completed.
    expect(await readNumber(page, "cycles")).toBe(cyclesBefore + 1);
    await expect(status).toHaveAttribute("data-weight", "1.000");
    await expectPlate(canvas, PLATE_ANIMATED_RGB, "animated again");

    // §110 at the re-type: the first fixed step under kinematic control again.
    const entry = await readNumber(page, "entry");
    expect(
      entry,
      `the re-type moved a link ${entry.toFixed(4)} m in its first fixed step`,
    ).toBeLessThanOrEqual(ENTRY_STEP_MAXIMUM);

    // The chain is back on the wave — measured until the published height
    // spans more than {@link WAVE_SPAN_MINIMUM}, so "back in the band" means
    // it is riding the wave and not resting at one height that happens to be
    // inside it. Screenshots here starved the simulation: 4 s of wall clock
    // was less than one 3.6 s period once §10 dropped time.
    const wave = await watchPublishedChain(
      page,
      (samples) => chainYSpan(samples) > WAVE_SPAN_MINIMUM,
      WAVE_MINIMUM_SAMPLES,
    );
    expect(wave.length).toBeGreaterThanOrEqual(WAVE_MINIMUM_SAMPLES);
    expect(
      chainYSpan(wave),
      "the chain came back but stopped moving: the wave did not resume",
    ).toBeGreaterThan(WAVE_SPAN_MINIMUM);

    // The page's own height stayed inside the wave band (measured 1.55–2.05 m).
    expect(Math.min(...wave.map((sample) => sample.y))).toBeGreaterThan(
      WAVE_BAND_MINIMUM_Y,
    );
    expect(Math.max(...wave.map((sample) => sample.y))).toBeLessThan(
      WAVE_BAND_MAXIMUM_Y,
    );

    // One framebuffer check: the pixels agree with the published height.
    const recovered = brightCentroid(await grab(canvas), SCENE_REGION);
    expect(recovered.count).toBeGreaterThan(MINIMUM_BRIGHT_PIXELS);
    expect(
      recovered.y,
      `the chain's centroid is at ${recovered.y.toFixed(3)} after the recovery, not back in the wave band`,
    ).toBeGreaterThan(WAVE_BAND_MINIMUM_Y);
    expect(recovered.y).toBeLessThan(WAVE_BAND_MAXIMUM_Y);

    // And the whole cycle's §110 worst case: 0.131–0.135 m, all of it in the
    // physical phase. The lower bound says the ragdoll really happened; the
    // upper bound is the stability ceiling a diverging solve would blow past.
    const worst = await readNumber(page, "worst");
    expect(worst).toBeGreaterThan(WORST_STEP_MINIMUM);
    expect(worst).toBeLessThan(WORST_STEP_MAXIMUM);

    // §106a's session assertion, restated for §19: two clicks, two control-mode
    // switches, a full weight sweep, ~12 s of simulation, and not one console
    // error.
    expect(errors).toEqual([]);
  });
});
