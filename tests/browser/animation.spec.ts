/**
 * Phase 4 exit evidence in a real browser: §107's authored animation — tweens,
 * a clip, and a timeline with a marker — reaching actual pixels (WP-4.8).
 *
 * `tests/determinism/phase4-animation.test.ts` proves the animation pillar is
 * deterministic; it proves nothing about whether any of it is *visible*. This
 * suite is the other half, and it is deliberately the same kind of gate as
 * `smoothness.spec.ts` and `interaction.spec.ts`: drive the built
 * `examples/first-2d-scene` in headless Chromium over SwiftShader, screenshot
 * it, and measure. Nothing is stubbed, no engine object is reached into, and
 * there are no golden images — every assertion is a threshold with a measured
 * provenance (§92).
 *
 * ## What is measured
 *
 * The example's "authored cluster" is two small shapes placed far out on either
 * side, each carrying §17 track value types (see that file's header):
 *
 * 1. **The diamond moves** — a `Tween` on its whole `transform.position`
 *    (§17 vector), `sine-in-out`, `yoyo`, forever. Measured as the y-centre of
 *    its pixel extent inside its own column of the frame.
 * 2. **The diamond's colour pulses** — a `Tween` on its material's RGBA
 *    (§17 colour) sequenced by the `Timeline`. Measured as the mean green
 *    channel of those same pixels, because green is the channel the two
 *    endpoint colours differ in most.
 * 3. **The vane turns and pops** — an `AnimationMixer` over a clip whose
 *    quaternion track is slerped (§17 quaternion), plus a `Timeline` tween on
 *    two components of its scale (§17 numeric). Measured as the vane's pixel
 *    count (scale) and its bounding-box aspect ratio (rotation — a *uniform*
 *    scale cannot change an aspect ratio, which is what separates the two).
 * 4. **The timeline's marker fires** — §16's discrete event, which steps the
 *    vane's material through a four-colour palette. Measured as plateaus in the
 *    vane's mean red channel over a window spanning at least two loops.
 * 5. **None of it disturbs the existing gates** — the WP-4.7 invariant, now a
 *    standing one: no pixel inside either cluster rectangle may satisfy
 *    `smoothness.spec.ts`'s orbiter classifier or `interaction.spec.ts`'s box
 *    classifier, whatever the animation is doing. Those two suites scan the
 *    *whole* frame for their shapes, so a cluster pixel that drifted into either
 *    gamut would silently corrupt a centroid three tests away.
 *
 * ## Sampling: simulation-bound watch, minimal screenshots
 *
 * The page's animation phase at load is not controllable — the timeline starts
 * when the bundle runs — so an assertion about "two frames 0.6 s apart" would be
 * a lottery: the diamond's `sine-in-out` tween is momentarily stationary at each
 * turning point, and two samples straddling one can legitimately differ by 0.1
 * world units.
 *
 * Every test therefore watches `#status`'s published cluster metrics on rAF until
 * §9's `data-sim` span reaches {@link SWEEP_MINIMUM_SECONDS} — long enough to
 * contain a full period of every animation in the cluster — and asserts over
 * that window. There is no retry loop and no dependence on where in the loop the
 * page happened to be: the sweep is bounded by simulation progress, not by how
 * fast the runner can encode PNGs. Screenshots are reserved for the classifier
 * contamination test, which must read the framebuffer, and even there only at
 * simulation milestones rather than every sample (the pattern
 * `blending.spec.ts` uses for `data-chain-y`).
 *
 * ## Method notes
 *
 * The scene's numbers are *restated* from the example rather than imported, for
 * the reason `smoothness.spec.ts` gives: a browser gate checks the built page
 * from the outside, and importing the example's constants would let a wrong
 * scene agree with a wrong expectation.
 *
 * The PNG decoder is a copy of `example.spec.ts`'s, as in `smoothness.spec.ts`
 * and `interaction.spec.ts`: Playwright returns an encoded screenshot, comparing
 * compressed bytes would conflate "the picture changed" with "the encoder picked
 * different filters", the workspace pins no image library, and this packet's
 * file scope forbids editing a sibling spec to share one.
 *
 * Every threshold below quotes the reference run measured by WP-4.8 on this
 * build, at 800 × 600 drawing-buffer pixels under `--use-angle=swiftshader`.
 */

import { inflateSync } from "node:zlib";

import { expect, test, type Locator, type Page } from "@playwright/test";

// --- PNG decoding (copied from example.spec.ts) -----------------------------

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

/** Decodes a non-interlaced 8-bit PNG into raw samples. Dependency-free. */
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

/** The colour of pixel `index`, packed into one comparable integer. */
function colorAt(image: DecodedImage, index: number): number {
  return image.pixels.readUIntBE(
    index * image.bytesPerPixel,
    image.bytesPerPixel,
  );
}

/** How many distinct colours the image contains. A cleared canvas has one. */
function distinctColors(image: DecodedImage): number {
  const colors = new Set<number>();
  for (let i = 0; i < image.width * image.height; i++) {
    colors.add(colorAt(image, i));
  }
  return colors.size;
}

async function grab(canvas: Locator): Promise<DecodedImage> {
  return decodePng(await canvas.screenshot());
}

// --- the scene under test ---------------------------------------------------

/*
 * Every constant below restates something `examples/first-2d-scene/main.ts`
 * declares. Duplicated, not imported: see this file's "Method notes".
 */

/** `OrthographicCamera` extents, in world units. */
const VIEW_LEFT = -4;
const VIEW_RIGHT = 4;
const VIEW_BOTTOM = -3;
const VIEW_TOP = 3;

/** The diamond ("beacon"): fixed x, its radius, and the two ends of its tween. */
const BEACON_X = 3.35;
const BEACON_RADIUS = 0.22;
const BEACON_LOW_Y = 0.05;
const BEACON_HIGH_Y = 1.7;

/** The vane: where it sits, its radius, and the scale its pop reaches. */
const VANE_X = -3.25;
const VANE_Y = -0.75;
const VANE_RADIUS = 0.26;

/**
 * `Timeline.loop` is infinite and one iteration is 2.2 s (the label `"beat"`
 * sits at 2.2 and the colour tween's yoyo is 2 × 1.1 s), so the marker that
 * steps the vane's palette fires every 2.2 s.
 */
const TIMELINE_ITERATION_SECONDS = 2.2;

/** The diamond's tween: 2.2 s up, `yoyo` back — a 4.4 s period. */
const BEACON_PERIOD_SECONDS = 2 * 2.2;

/** The vane clip's `TURN_SECONDS`: one full turn about +Z. */
const VANE_TURN_SECONDS = 3;

// --- measurement regions ----------------------------------------------------

/**
 * The diamond's own column of the world, as `[minX, minY, maxX, maxY]`.
 *
 * X: the shape spans `3.35 ± 0.22` = `[3.13, 3.57]`, so `[3.0, 3.7]` clears it
 * by 0.13 on each side. It is also clear of everything else: the orbiting disc
 * reaches x = 2.45 at most (`ORBIT_RADIUS + ORBITER_RADIUS`), 0.55 to the left
 * of this band.
 *
 * Y: the shape's extremes are `0.05 − 0.22 = −0.17` and `1.7 + 0.22 = 1.92`, so
 * `[−0.6, 2.2]` contains every pose with ≥ 0.28 to spare. The ground plane's top
 * edge is at y = −1.75 and the label's lowest ink at y = 2.607, so neither can
 * enter the band.
 */
const BEACON_REGION = [3.0, -0.6, 3.7, 2.2] as const;

/**
 * The vane's own region, same convention.
 *
 * At its 1.35 scale pop the triangle's circumradius is `0.26 × 1.35 = 0.351`, so
 * it spans `[−3.601, −2.899] × [−1.101, −0.399]`. `[−3.75, −2.75] × [−1.35,
 * −0.15]` contains that with ≥ 0.14 to spare on every side, sits inside the
 * camera's left edge (−4), stays 0.3 clear of the orbiting disc's leftmost reach
 * (−2.45), and stays 0.4 above the ground plane's top edge (−1.75).
 */
const VANE_REGION = [-3.75, -1.35, -2.75, -0.15] as const;

// --- classifying pixels ------------------------------------------------------

/**
 * Sum of the three channels at or above which a pixel belongs to a shape rather
 * than to the background — `interaction.spec.ts`'s bar, unchanged.
 *
 * Inside these two regions the only things present are the clear colour
 * (13, 15, 23), summing to 51, and the cluster shapes: the diamond is
 * (173, 107, 41) summing to 321 at one end of its colour tween and
 * (168, 153, 51) summing to 372 at the other, and the vane's four palette
 * entries sum to 271, 346, 261 and 250. 200 sits between 51 and 250 with more
 * than a factor of four of margin on the background side and a factor of 1.25 on
 * the dimmest shape, so no rasterisation or dithering difference moves a pixel
 * across it — while a blended rim pixel, which is mostly background, falls below
 * it and cannot bias a mean.
 */
const SHAPE_BRIGHTNESS_MINIMUM = 200;

/**
 * `smoothness.spec.ts`'s orbiter classifier, restated verbatim.
 *
 * It must find **nothing** in either cluster region: the example keeps every
 * cluster colour at `red ≤ 0.68` (173 of 255), seven below this test's 180, and
 * the classifier is used here only to prove that.
 */
function isOrbiterPixel(r: number, g: number, b: number): boolean {
  return r >= 180 && r - b >= 90 && g > b;
}

/**
 * `interaction.spec.ts`'s box classifier, restated verbatim — and likewise used
 * here only to prove it finds nothing. Every cluster colour keeps red at least
 * 110 above blue, so `b + 20 ≥ r` fails by a wide margin.
 */
function isBoxPixel(r: number, g: number, b: number): boolean {
  return r + g + b >= SHAPE_BRIGHTNESS_MINIMUM && b + 20 >= r;
}

// --- thresholds --------------------------------------------------------------

/**
 * Minimum distinct colours for a frame to count as drawn. A cleared canvas has
 * one; this scene measures eight to ten. Same threshold, same reasoning, as the
 * WP-3.8, WP-3.9 and WP-3a.6 gates.
 */
const MINIMUM_DISTINCT_COLORS = 4;

/** Seconds to keep screenshotting before giving up on a first drawn frame. */
const DRAW_BUDGET_SECONDS = 5;

/**
 * Floor on published-metric samples before the sweep-length assertion runs.
 *
 * These reads are cheap — one DOM attribute per rAF — so the floor is "did the
 * watch actually run" rather than "did the runner encode N PNGs".
 */
const MINIMUM_PUBLISHED_SAMPLES = 8;

/** Milliseconds allowed for a published-metric watch to finish. */
const CLUSTER_WATCH_DEADLINE_MS = 30_000;

/**
 * Seconds a sweep must span for its extremes to be the animation's extremes.
 *
 * The longest period in the cluster is the diamond's 4.4 s tween; the vane's
 * turn is 3 s and the timeline's iteration 2.2 s. Requiring 6 s of
 * `data-sim` guarantees a full period of each with margin. This is asserted
 * on simulation time rather than wall clock so a slow machine grows the window
 * instead of failing a screenshot count about the runner.
 */
const SWEEP_MINIMUM_SECONDS = 6;

/**
 * Simulation seconds between classifier-contamination framebuffer grabs.
 *
 * Five grabs over 6 s of simulation cover the cluster's palette and poses
 * without the 22-screenshot sweep that starved Windows SwiftShader runs.
 */
const CLASSIFIER_SIM_GAP_SECONDS = 1.5;

/**
 * Minimum separation, in seconds, between the two samples whose diamond
 * positions are compared — the packet's "two times ≥ 0.6 s apart".
 *
 * 0.6 s is 14 % of the tween's period. Requiring it means the assertion cannot
 * be satisfied by two adjacent frames differing through render interpolation
 * alone; it has to be simulation actually advancing.
 */
const MOTION_PAIR_MINIMUM_SECONDS = 0.6;

/**
 * How far the diamond's y-extent centre must move between two samples at least
 * {@link MOTION_PAIR_MINIMUM_SECONDS} apart, in world units.
 *
 * The tween travels `BEACON_HIGH_Y − BEACON_LOW_Y` = 1.65 world units. The
 * reference run measured the extent centre spanning **0.055 … 1.700**, a span of
 * 1.645 (the missing 0.005 is the sampling landing up to 0.15 s off each
 * turning point, where `sine-in-out` is flat), and its best pair ≥ 0.6 s apart
 * moved the whole 1.645 at a 2.10 s gap. The centroid of the same pixels agreed
 * to three decimals, the diamond being centrally symmetric.
 *
 * 0.8 world units is under half of that. In screenshot pixels it is
 * `0.8 × height / 6` = 80 px at 600 px of drawing buffer, and the threshold is
 * expressed in world units precisely so it stays 0.8 at any DPR. A frozen
 * diamond (0.000), or one whose transform was written but never reached the
 * frame, fails by two orders of magnitude.
 */
const BEACON_MOTION_MINIMUM_WORLD = 0.8;

/**
 * How far the diamond's mean green channel must move across the sweep, in
 * framebuffer bytes.
 *
 * The colour tween runs between `[0.68, 0.42, 0.16, 1]` and
 * `[0.66, 0.60, 0.20, 1]`; `UnlitMaterial` writes its colour straight out with
 * no tone mapping (the finding `smoothness.spec.ts` records), so green runs
 * between `0.42 × 255 = 107` and `0.60 × 255 = 153`. The reference run measured
 * exactly **107 … 153** — a 46-byte span, and 46 bytes was also the best pair
 * ≥ 0.6 s apart.
 *
 * 20 bytes is 43 % of that, and twenty times the ≤ 1-byte measurement residual
 * `interaction.spec.ts` records for a flat fill read this way. A material whose
 * colour was tweened in place but never re-uploaded — the failure mode WP-4.7
 * had to check for — measures 0.
 */
const BEACON_GREEN_CHANGE_MINIMUM = 20;

/**
 * Ratio between the vane's largest and smallest scale-area (`sx × sy`) across
 * the sweep.
 *
 * The timeline's numeric tween takes `transform.scale.x` and `.y` to 1.35, which
 * is an *area* factor of `1.35² = 1.82`; the reference run measured **876 …
 * 1684** pixels, a ratio of 1.922 (a shade above 1.82 because `back-out`
 * overshoots past 1.35 before settling). The published `data-vane-sx` /
 * `data-vane-sy` track the same motion without a framebuffer grab per sample.
 *
 * 1.35 is well under the 1.82 the scale alone must produce, so the assertion
 * survives a differently-timed sweep, an antialiasing change, or a tween that
 * only reached three quarters of its amplitude — while a vane whose scale never
 * animated measures a ratio of 1.00.
 */
const VANE_SCALE_AREA_RATIO_MINIMUM = 1.35;

/**
 * Span the vane's bounding-box aspect ratio must cover across the sweep.
 *
 * This is the assertion that isolates the **quaternion** track from the scale
 * one: the scale tween writes x and y by the same factor, and a uniform scale
 * cannot change an aspect ratio, so anything measured here is rotation.
 *
 * An equilateral triangle of circumradius r has a bounding box of
 * `1.732r × 1.5r` point-up and `1.5r × 1.732r` point-right, so its aspect ratio
 * sweeps `0.866 … 1.155` — a span of 0.289 — once every 60° of turn. The
 * reference run measured **0.864 … 1.130**, a span of 0.266; the missing 0.023
 * is exactly the quantisation of a ~43-pixel box (1/43 = 0.023).
 *
 * 0.12 is 45 % of the measured span and five times that quantisation, so a
 * stationary vane (span 0) fails and a vane turning at any plausible rate
 * passes.
 */
const VANE_ASPECT_SPAN_MINIMUM = 0.12;

/**
 * How far the vane's mean red channel must move for the sample to count as a
 * *new* plateau rather than noise — §16's marker, seen from the framebuffer.
 *
 * The marker steps the vane through four colours whose red channels are
 * `0.62/0.68/0.58/0.64 × 255` = 158, 173, 148, 163, visited in that cyclic
 * order. The three transitions a sweep of this length reaches are therefore 15,
 * 25 and 15 bytes (the fourth, 163 → 158, is only 5 and is deliberately *not*
 * relied on — which is why the assertion below asks for at least two plateaus
 * and not for four).
 *
 * 8 bytes sits below the smallest transition this test depends on (15) by
 * roughly a factor of two, and eight times above the ≤ 1-byte residual of a flat
 * fill. The reference run recovered the same four plateaus — **158 → 173 → 148
 * → 163** — at every tolerance from 3 to 8, so the choice is not delicate.
 */
const VANE_PLATEAU_STEP_MINIMUM = 8;

/** Distinct palette plateaus the vane's red channel must show. */
const VANE_MINIMUM_PLATEAUS = 2;

/**
 * Total span the vane's mean red must cover, in bytes — the same fact as the
 * plateaus, stated as one number so a failure says how far it got.
 *
 * The reference run measured **148 … 173**, a span of 25. 12 is under half.
 */
const VANE_RED_SPAN_MINIMUM = 12;

// --- measuring ---------------------------------------------------------------

/** A world rectangle as `[minX, minY, maxX, maxY]`. */
type WorldRegion = readonly [number, number, number, number];

/** A half-open pixel rectangle inside a screenshot. */
interface PixelBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Screenshot row → world Y. */
function imageToWorldY(image: DecodedImage, row: number): number {
  return VIEW_TOP - ((row + 0.5) / image.height) * (VIEW_TOP - VIEW_BOTTOM);
}

/** World rectangle → the screenshot pixels covering it, clipped to the image. */
function worldRegionToPixels(
  image: DecodedImage,
  region: WorldRegion,
): PixelBox {
  const toColumn = (x: number): number =>
    Math.round(((x - VIEW_LEFT) / (VIEW_RIGHT - VIEW_LEFT)) * image.width);
  const toRow = (y: number): number =>
    Math.round(((VIEW_TOP - y) / (VIEW_TOP - VIEW_BOTTOM)) * image.height);
  return {
    left: Math.max(0, toColumn(region[0])),
    right: Math.min(image.width, toColumn(region[2])),
    // World +Y is up, rows count down, so the *top* row comes from `maxY`.
    top: Math.max(0, toRow(region[3])),
    bottom: Math.min(image.height, toRow(region[1])),
  };
}

/** What one region measurement recovers from a frame. */
interface RegionFix {
  /** Pixels brighter than {@link SHAPE_BRIGHTNESS_MINIMUM} in the region. */
  readonly matched: number;
  /** That count as a fraction of the whole canvas. */
  readonly coverage: number;
  /** Midpoint of the topmost and bottommost matched rows, in world units. */
  readonly extentCenterY: number;
  /** Bounding box of the matched pixels, in screenshot pixels. */
  readonly boxWidth: number;
  readonly boxHeight: number;
  /** Mean colour of the matched pixels, as framebuffer bytes. */
  readonly red: number;
  readonly green: number;
  /** Pixels in the region that satisfy the two foreign classifiers. */
  readonly orbiterHits: number;
  readonly boxHits: number;
}

/**
 * Measures one cluster region: how many shape pixels it holds, where they are,
 * how big their bounding box is, what colour they are on average, and — always —
 * how many of them the orbiter and box classifiers would claim.
 *
 * The mean is taken over every matched pixel with no erosion, for the reason
 * `interaction.spec.ts` gives: a blended rim pixel is mostly background and
 * fails the brightness bar before it can bias anything. The reference run bears
 * that out — every mean measured here landed on an exact palette byte.
 */
function measureRegion(image: DecodedImage, region: WorldRegion): RegionFix {
  const box = worldRegionToPixels(image, region);
  let matched = 0;
  let sumR = 0;
  let sumG = 0;
  let minColumn = Number.POSITIVE_INFINITY;
  let maxColumn = Number.NEGATIVE_INFINITY;
  let minRow = Number.POSITIVE_INFINITY;
  let maxRow = Number.NEGATIVE_INFINITY;
  let orbiterHits = 0;
  let boxHits = 0;

  for (let y = box.top; y < box.bottom; y++) {
    const rowStart = y * image.width * image.bytesPerPixel;
    for (let x = box.left; x < box.right; x++) {
      const at = rowStart + x * image.bytesPerPixel;
      const r = image.pixels[at];
      const g = image.pixels[at + 1];
      const b = image.pixels[at + 2];
      if (isOrbiterPixel(r, g, b)) orbiterHits += 1;
      if (isBoxPixel(r, g, b)) boxHits += 1;
      if (r + g + b < SHAPE_BRIGHTNESS_MINIMUM) continue;
      matched += 1;
      sumR += r;
      sumG += g;
      if (x < minColumn) minColumn = x;
      if (x > maxColumn) maxColumn = x;
      if (y < minRow) minRow = y;
      if (y > maxRow) maxRow = y;
    }
  }

  if (matched === 0) {
    return {
      matched: 0,
      coverage: 0,
      extentCenterY: Number.NaN,
      boxWidth: 0,
      boxHeight: 0,
      red: Number.NaN,
      green: Number.NaN,
      orbiterHits,
      boxHits,
    };
  }
  return {
    matched,
    coverage: matched / (image.width * image.height),
    extentCenterY:
      (imageToWorldY(image, minRow) + imageToWorldY(image, maxRow)) / 2,
    boxWidth: maxColumn - minColumn + 1,
    boxHeight: maxRow - minRow + 1,
    red: sumR / matched,
    green: sumG / matched,
    orbiterHits,
    boxHits,
  };
}

/** One published-metric sample from `#status`. */
interface PublishedSample {
  /** §9 simulation time, seconds. */
  readonly sim: number;
  readonly beaconY: number;
  readonly beaconGreen: number;
  readonly vaneSx: number;
  readonly vaneSy: number;
  readonly vaneAspect: number;
  readonly vaneRed: number;
}

/** One classifier framebuffer grab at a simulation milestone. */
interface ClassifierGrab {
  readonly sim: number;
  readonly beacon: RegionFix;
  readonly vane: RegionFix;
}

// --- page driving -----------------------------------------------------------

/** Errors seen since the page was created, in the order the browser saw them. */
type ErrorLog = readonly string[];

/**
 * Opens the example and returns its live error log.
 *
 * `favicon.ico` is served rather than 404-ed, for the reason `example.spec.ts`
 * and `interaction.spec.ts` give: the browser asks for it on its own, the
 * example ships none, and excusing the resulting console error with an allowlist
 * would also excuse a real 404.
 */
async function openExample(page: Page): Promise<ErrorLog> {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error")
      errors.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.name}: ${error.message}`);
  });
  await page.route("**/favicon.ico", (route) =>
    route.fulfill({ status: 200, contentType: "image/x-icon", body: "" }),
  );
  await page.goto("/", { waitUntil: "load" });
  return errors;
}

/** Screenshots until a drawn frame appears or the budget runs out. */
async function waitForDrawnFrame(canvas: Locator): Promise<DecodedImage> {
  const deadline = Date.now() + DRAW_BUDGET_SECONDS * 1000;
  let frame = await grab(canvas);
  while (distinctColors(frame) < MINIMUM_DISTINCT_COLORS) {
    if (Date.now() >= deadline) break;
    frame = await grab(canvas);
  }
  return frame;
}

/** The canvas, once it is visible and has drawn something. */
async function openDrawnExample(
  page: Page,
): Promise<{ canvas: Locator; errors: ErrorLog }> {
  const errors = await openExample(page);
  const canvas = page.locator("#scene");
  await expect(canvas).toBeVisible();
  const frame = await waitForDrawnFrame(canvas);
  expect(
    distinctColors(frame),
    "the canvas never drew, so there is nothing to measure",
  ).toBeGreaterThanOrEqual(MINIMUM_DISTINCT_COLORS);
  return { canvas, errors };
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

/** Reads one published cluster sample from `#status`. */
async function readPublishedSample(page: Page): Promise<PublishedSample> {
  const status = page.locator("#status");
  const read = async (key: string): Promise<number> => {
    const raw = await status.getAttribute(`data-${key}`);
    expect(raw, `the page publishes no data-${key}`).not.toBeNull();
    return Number(raw);
  };
  return {
    sim: await read("sim"),
    beaconY: await read("beacon-y"),
    beaconGreen: await read("beacon-green"),
    vaneSx: await read("vane-sx"),
    vaneSy: await read("vane-sy"),
    vaneAspect: await read("vane-aspect"),
    vaneRed: await read("vane-red"),
  };
}

/** Span of simulation time covered by `samples`. */
function simulationSpan(samples: readonly PublishedSample[]): number {
  return samples[samples.length - 1].sim - samples[0].sim;
}

/**
 * Samples `#status` on rAF until `enough` is true or the deadline.
 *
 * No screenshots: a framebuffer grab is what starved the simulation on Windows
 * SwiftShader and made a wall-clock sweep shorter than one animation period.
 */
async function watchPublishedCluster(
  page: Page,
  enough: (samples: readonly PublishedSample[]) => boolean,
  minimumSamples: number = MINIMUM_PUBLISHED_SAMPLES,
  deadlineMs: number = CLUSTER_WATCH_DEADLINE_MS,
): Promise<readonly PublishedSample[]> {
  const samples: PublishedSample[] = [];
  const startedAt = Date.now();
  do {
    samples.push(await readPublishedSample(page));
    if (samples.length >= minimumSamples && enough(samples)) {
      break;
    }
    await nextAnimationFrame(page);
  } while (Date.now() - startedAt < deadlineMs);
  return samples;
}

/**
 * Grabs the cluster regions at simulation milestones for the classifier test.
 *
 * Waits for each milestone on published `data-sim`, then screenshots once — five
 * grabs over {@link SWEEP_MINIMUM_SECONDS}, not twenty-two.
 */
async function classifierGrabsAtSimMilestones(
  page: Page,
  canvas: Locator,
): Promise<readonly ClassifierGrab[]> {
  const grabs: ClassifierGrab[] = [];
  let nextSim = 0;
  while (nextSim <= SWEEP_MINIMUM_SECONDS) {
    await expect
      .poll(
        async () => readPublishedSample(page).then((sample) => sample.sim),
        {
          message: `simulation never reached ${String(nextSim)} s for a classifier grab`,
          timeout: CLUSTER_WATCH_DEADLINE_MS,
        },
      )
      .toBeGreaterThanOrEqual(nextSim);
    const sample = await readPublishedSample(page);
    const image = await grab(canvas);
    grabs.push({
      sim: sample.sim,
      beacon: measureRegion(image, BEACON_REGION),
      vane: measureRegion(image, VANE_REGION),
    });
    nextSim += CLASSIFIER_SIM_GAP_SECONDS;
    if (nextSim <= SWEEP_MINIMUM_SECONDS) {
      await nextAnimationFrame(page);
    }
  }
  return grabs;
}

/** Fails unless the watch spans enough simulation time for its extremes to mean anything. */
function expectUsableSweep(samples: readonly PublishedSample[]): void {
  expect(samples.length).toBeGreaterThanOrEqual(MINIMUM_PUBLISHED_SAMPLES);
  const span = simulationSpan(samples);
  console.log(
    `sweep: ${String(samples.length)} published samples over ${span.toFixed(2)} s of simulation`,
  );
  expect(
    span,
    `the sweep spanned only ${span.toFixed(2)} s of simulation, less than the longest ` +
      `animation period in the cluster (${String(BEACON_PERIOD_SECONDS)} s)`,
  ).toBeGreaterThanOrEqual(SWEEP_MINIMUM_SECONDS);
}

/** Fails unless the diamond stayed inside its authored travel band. */
function expectBeaconPresent(samples: readonly PublishedSample[]): void {
  for (const [index, sample] of samples.entries()) {
    expect(
      sample.beaconY,
      `sample ${String(index)}: beacon y=${sample.beaconY.toFixed(3)} left the tween band`,
    ).toBeGreaterThanOrEqual(BEACON_LOW_Y - BEACON_RADIUS);
    expect(sample.beaconY).toBeLessThanOrEqual(BEACON_HIGH_Y + BEACON_RADIUS);
  }
}

/** Fails unless the vane stayed at plausible scale throughout. */
function expectVanePresent(samples: readonly PublishedSample[]): void {
  for (const [index, sample] of samples.entries()) {
    expect(
      sample.vaneSx,
      `sample ${String(index)}: vane scale collapsed`,
    ).toBeGreaterThan(0.5);
    expect(sample.vaneSy).toBeGreaterThan(0.5);
  }
}

/** `min … max (span)` of a series, for log lines. */
function describeSpan(values: readonly number[]): string {
  const low = Math.min(...values);
  const high = Math.max(...values);
  return `${low.toFixed(3)} … ${high.toFixed(3)} (span ${(high - low).toFixed(3)})`;
}

// --- tests ------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("§107: authored animation reaches the screen", () => {
  test("the diamond's vector tween moves it, and its colour tween pulses", async ({
    page,
  }) => {
    const { errors } = await openDrawnExample(page);
    const samples = await watchPublishedCluster(
      page,
      (seen) => simulationSpan(seen) >= SWEEP_MINIMUM_SECONDS,
    );
    expectUsableSweep(samples);
    expectBeaconPresent(samples);

    let bestMove = 0;
    let bestGap = 0;
    for (let i = 0; i < samples.length; i++) {
      for (let j = i + 1; j < samples.length; j++) {
        const gap = samples[j].sim - samples[i].sim;
        if (gap < MOTION_PAIR_MINIMUM_SECONDS) continue;
        const move = Math.abs(samples[j].beaconY - samples[i].beaconY);
        if (move > bestMove) {
          bestMove = move;
          bestGap = gap;
        }
      }
    }
    console.log(
      `diamond y: ${describeSpan(samples.map((s) => s.beaconY))} world; ` +
        `best move over a ≥ ${String(MOTION_PAIR_MINIMUM_SECONDS)} s sim gap: ` +
        `${bestMove.toFixed(3)} world at a ${bestGap.toFixed(2)} s gap`,
    );
    expect(
      bestMove,
      `the diamond's y moved at most ${bestMove.toFixed(3)} world units ` +
        `between samples ≥ ${String(MOTION_PAIR_MINIMUM_SECONDS)} s of simulation apart`,
    ).toBeGreaterThanOrEqual(BEACON_MOTION_MINIMUM_WORLD);

    const lows = samples.map((s) => s.beaconY);
    expect(Math.min(...lows)).toBeGreaterThanOrEqual(
      BEACON_LOW_Y - BEACON_RADIUS,
    );
    expect(Math.max(...lows)).toBeLessThanOrEqual(
      BEACON_HIGH_Y + BEACON_RADIUS,
    );

    const greens = samples.map((s) => s.beaconGreen);
    const greenSpan = Math.max(...greens) - Math.min(...greens);
    console.log(`diamond green: ${describeSpan(greens)} bytes`);
    expect(
      greenSpan,
      `the diamond's green moved only ${greenSpan.toFixed(1)} bytes across the sweep`,
    ).toBeGreaterThanOrEqual(BEACON_GREEN_CHANGE_MINIMUM);

    expect(errors).toEqual([]);
  });

  test("the vane's clip turns it and its scale tween pops it", async ({
    page,
  }) => {
    const { errors } = await openDrawnExample(page);
    const samples = await watchPublishedCluster(
      page,
      (seen) => simulationSpan(seen) >= SWEEP_MINIMUM_SECONDS,
    );
    expectUsableSweep(samples);
    expectVanePresent(samples);

    const areas = samples.map((s) => s.vaneSx * s.vaneSy);
    const ratio = Math.max(...areas) / Math.min(...areas);
    console.log(
      `vane scale area: ${describeSpan(areas)} (ratio ${ratio.toFixed(3)})`,
    );
    expect(
      ratio,
      `the vane's scale area varied by only ${ratio.toFixed(3)}× across the sweep`,
    ).toBeGreaterThanOrEqual(VANE_SCALE_AREA_RATIO_MINIMUM);

    const aspects = samples.map((s) => s.vaneAspect);
    const aspectSpan = Math.max(...aspects) - Math.min(...aspects);
    console.log(
      `vane bbox aspect: ${describeSpan(aspects)} over a ${String(VANE_TURN_SECONDS)} s turn`,
    );
    expect(
      aspectSpan,
      `the vane's bounding-box aspect spanned only ${aspectSpan.toFixed(3)}`,
    ).toBeGreaterThanOrEqual(VANE_ASPECT_SPAN_MINIMUM);

    expect(errors).toEqual([]);
  });

  test("the timeline's marker steps the vane through its palette", async ({
    page,
  }) => {
    const { errors } = await openDrawnExample(page);
    const samples = await watchPublishedCluster(
      page,
      (seen) => simulationSpan(seen) >= SWEEP_MINIMUM_SECONDS,
    );
    expectUsableSweep(samples);
    expectVanePresent(samples);

    const reds = samples.map((s) => s.vaneRed);
    const plateaus: number[] = [];
    for (const red of reds) {
      if (
        plateaus.length === 0 ||
        Math.abs(red - plateaus[plateaus.length - 1]) >
          VANE_PLATEAU_STEP_MINIMUM
      ) {
        plateaus.push(red);
      }
    }
    const redSpan = Math.max(...reds) - Math.min(...reds);
    const simSpan = simulationSpan(samples);
    console.log(
      `vane red: ${describeSpan(reds)} bytes; plateaus ` +
        `${plateaus.map((p) => p.toFixed(1)).join(" → ")}`,
    );

    expect(
      simSpan / TIMELINE_ITERATION_SECONDS,
      "the sweep did not span two timeline iterations",
    ).toBeGreaterThanOrEqual(2);
    expect(
      plateaus.length,
      `the vane's colour showed ${String(plateaus.length)} plateau(s) across ` +
        `${simSpan.toFixed(1)} s of simulation`,
    ).toBeGreaterThanOrEqual(VANE_MINIMUM_PLATEAUS);
    expect(
      redSpan,
      `the vane's red spanned only ${redSpan.toFixed(1)} bytes`,
    ).toBeGreaterThanOrEqual(VANE_RED_SPAN_MINIMUM);

    expect(errors).toEqual([]);
  });

  test("the animated cluster is invisible to the orbiter and box classifiers", async ({
    page,
  }) => {
    const { canvas, errors } = await openDrawnExample(page);
    const grabs = await classifierGrabsAtSimMilestones(page, canvas);
    expect(grabs.length).toBeGreaterThanOrEqual(4);

    let orbiterHits = 0;
    let boxHits = 0;
    for (const grab of grabs) {
      orbiterHits += grab.beacon.orbiterHits + grab.vane.orbiterHits;
      boxHits += grab.beacon.boxHits + grab.vane.boxHits;
    }
    console.log(
      `classifier hits inside the two cluster regions over ${String(grabs.length)} grabs: ` +
        `orbiter ${String(orbiterHits)}, box ${String(boxHits)}`,
    );
    expect(
      orbiterHits,
      "a pixel inside the animated cluster satisfies the orbiter classifier",
    ).toBe(0);
    expect(
      boxHits,
      "a pixel inside the animated cluster satisfies the box classifier",
    ).toBe(0);

    const last = grabs[grabs.length - 1];
    expect(last.beacon.matched).toBeGreaterThan(0);
    expect(last.vane.matched).toBeGreaterThan(0);
    console.log(
      `cluster geometry restated from the example: diamond at x=${String(BEACON_X)}, ` +
        `vane at (${String(VANE_X)}, ${String(VANE_Y)}) with radius ${String(VANE_RADIUS)}`,
    );

    expect(errors).toEqual([]);
  });
});
