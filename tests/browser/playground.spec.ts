/**
 * Phase 5 browser gate: §108's *"mixed 2D/3D demo in which gravity, collisions,
 * impulses and sensors all go through one common API"*, measured from outside
 * the page (plan WP-5.8).
 *
 * `tests/determinism/phase5-physics.test.ts` proves the two solvers are
 * deterministic; `tests/integration/physics-rapier.test.ts` proves the stable
 * API composes with them. Neither answers the question §108 actually asks,
 * which is whether the composed thing *works in a browser*: whether the wasm
 * loads, whether a fixed-step simulation driven by a real animation frame loop
 * makes bodies fall and settle, whether a sensor notices them, and whether a
 * click reaches a body through picking and comes back as an impulse. Those are
 * the four things this file measures, in `examples/physics-playground` —
 * §108's demonstration — through Chromium's real framebuffer and Playwright's
 * real mouse.
 *
 * ```text
 * page load → Rapier wasm init → PhysicsSystem (2 worlds, 2 adapters)
 *   → fixed-step accumulator → node transforms → WebglRenderer → pixels
 *                                    ↑
 *   Chromium mouse → PointerInput → pick → applyImpulseAtPoint (§26)
 * ```
 *
 * ## The second site
 *
 * This spec drives a **different** server from every other file in this
 * directory: `playwright.config.ts` runs one `vite preview` per built example,
 * `first-2d-scene` on 4173 (the suite's `baseURL`) and `physics-playground` on
 * 4174. {@link PLAYGROUND_URL} restates that port for the reason the scene
 * constants below are restated rather than imported — see "Method notes".
 * Run `bun run playground:build` before `bun run test:browser`, or the preview server
 * has no `dist` to serve.
 *
 * ## What is measured, and against what
 *
 * | test | §  | assertion |
 * | ---- | -- | --------- |
 * | loads | §108 | `#status` reaches `data-state="running"`, i.e. both wasm images decoded and the loop started |
 * | gravity + settle | §22, §23 | body pixels in **both** halves fall to a centroid of y ≈ −2.5 ± 0.25 and then stop changing |
 * | sensors | §24, §29 | each zone's face repaints from its empty colour to its occupied colour, and `data-zone2d` / `data-zone3d` mirror the occupancy |
 * | impulse | §26, §71 | a real click on a located body sends it well above everything that was on screen, and the half re-settles afterwards |
 *
 * Every threshold below states the number the reference run measured and how
 * much margin the threshold leaves. Nothing here is a golden image: the gate
 * runs on SwiftShader, whose rasterisation differs from a GPU's, so every
 * assertion is a measurement with margin (§92).
 *
 * ## Method notes
 *
 * The scene's numbers are **restated** from the example rather than imported,
 * for the reason `smoothness.spec.ts` and `interaction.spec.ts` give: a browser
 * gate checks the built page from the outside, and importing the example's
 * constants would let a wrong scene agree with a wrong expectation.
 *
 * The PNG decoder is a copy of `example.spec.ts`'s, as in `smoothness.spec.ts`
 * and `interaction.spec.ts`: Playwright returns an encoded screenshot,
 * comparing compressed bytes would conflate "the picture changed" with "the
 * encoder picked different filters", the workspace pins no image library, and
 * this packet's file scope forbids editing a sibling spec to share one.
 *
 * The one place this file is *not* a pure outside-in pixel measurement is the
 * two `data-zone*` attributes, which the example mirrors onto `#status` on
 * purpose. They are asserted **alongside** the pixel transition, never instead
 * of it: the attribute says the §29 event fired, the pixels say the event
 * reached the screen, and only both together say the sensor works.
 */

import { inflateSync } from "node:zlib";

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  framesFor,
  installFrameCounter,
  waitForFrames,
  waitUntilFrameCount,
} from "./helpers/wait.js";

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

// --- the built page, restated from `examples/physics-playground` -------------

/**
 * Where the playground's `vite preview` server listens.
 *
 * Restated from `playwright.config.ts`'s `PLAYGROUND_PORT`, which is what
 * actually starts the server; `use.baseURL` belongs to the *other* site, so
 * every navigation in this file is absolute.
 */
const PLAYGROUND_URL = "http://localhost:4174/";

/** The orthographic camera's world extents: 16 × 9 units over a 16:9 canvas. */
const VIEW_LEFT = -8;
const VIEW_RIGHT = 8;
const VIEW_TOP = 4.5;
const VIEW_BOTTOM = -4.5;

/**
 * CSS pixels per world unit at the example's authored 960 × 540 layout size —
 * the map WP-5.7 measured, `px = (x + 8) · 60`, `py = (4.5 − y) · 60`.
 *
 * Used **only** to turn world tolerances into pixel tolerances for reporting;
 * every measurement below normalizes by `image.width`/`image.height` first, so
 * a run at DPR 2 produces the same world numbers as a run at DPR 1.
 */
const PIXELS_PER_UNIT = 60;

/** Centre of each half: the 2D world is drawn at x = −4, the 3D one at x = +4. */
const HALF_CENTER_X = 4;

/** Top surface of each half's static floor — the datum settling is measured from. */
const FLOOR_TOP_Y = -3;

/**
 * The §24 sensor zone of a half, in world units: `x ∈ cx ± 1.2`,
 * `y ∈ [−2.9, −1.6]`.
 *
 * The colour is sampled over an **inset** of this rectangle so that no
 * antialiased border pixel reaches the mean; the inset is still 2.0 × 1.05
 * world units, which is 7 560 pixels at DPR 1 — a large enough sample that one
 * stray pixel cannot move the mean by a byte.
 */
const ZONE_HALF_WIDTH = 1.2;
const ZONE_TOP_Y = -1.6;
const ZONE_BOTTOM_Y = -2.9;
const ZONE_SAMPLE_INSET = 0.2;

/**
 * The zone's two face colours as framebuffer bytes, measured by WP-5.7 and
 * reproduced exactly by the reference run of this file.
 *
 * They are the example's `ZONE_EMPTY_COLOR` and `ZONE_OCCUPIED_COLOR` after the
 * renderer's own conversion, which is why they are stated as *measurements*
 * rather than derived from the authored 0…1 floats.
 */
const ZONE_EMPTY_RGB: readonly [number, number, number] = [41, 36, 87];
const ZONE_OCCUPIED_RGB: readonly [number, number, number] = [26, 133, 115];

/**
 * How far a measured mean colour may sit from one of those, per byte.
 *
 * The repository convention (`interaction.spec.ts`) is 24, and the two colours
 * here differ by 97 in green alone, so 24 cannot confuse them: it is a quarter
 * of the separation, and the reference run measured a residual of **0** in
 * every channel because the sample excludes body pixels and the face is flat.
 */
const COLOR_MATCH_TOLERANCE = 24;

/**
 * Sum of the three channels at or above which a pixel belongs to a dynamic
 * body rather than to scenery.
 *
 * WP-5.7 measured the classifier's two populations: every body colour sums to
 * at least 357 and every piece of scenery — floors, walls, divider, and both
 * zone faces — to at most 274. 320 sits between them with 37 of margin below
 * and 46 above, so no rasterisation or dithering difference can move a pixel
 * across it.
 */
const BODY_BRIGHTNESS_MINIMUM = 320;

// --- tolerances --------------------------------------------------------------

/**
 * Seconds to wait for `#status` to reach `data-state="running"`.
 *
 * The reference run reached it 459 ms after `load`, which includes decoding
 * *two* Rapier wasm images. 45 s is a hundred times that: it is not a
 * performance assertion, it is a "the wasm never arrived" assertion, and a
 * cold, contended CI machine must not fail it for being slow.
 */
const READY_TIMEOUT_MS = 45_000;

/**
 * Where a settled half's body-pixel centroid must be, in world Y.
 *
 * The five bodies come to rest in a pile on a floor whose top is
 * {@link FLOOR_TOP_Y}. Rapier 0.19's reference run measured −2.508 (2D) and
 * −2.510 (3D); 0.20's CI pile sits a little higher (≈ −2.29). The assertion
 * is the ±0.25 world-unit band — 15 pixels, half the smallest body's
 * diameter — which is loose enough for that rest-pose shift and far tighter
 * than the ≈ +0.8 the same measurement gives while the bodies are still in
 * the air. A `toBeCloseTo(..., 1)` (±0.05) would reject the 0.20 pose.
 */
const SETTLED_CENTROID_Y = -2.5;
const SETTLED_CENTROID_TOLERANCE = 0.25;

/**
 * Body pixels a half must contain for its centroid to be trusted.
 *
 * Each half's five bodies cover ≈ 6 650 (2D) and ≈ 6 765 (3D) pixels at DPR 1,
 * both while falling and once settled. 2 000 is a third of that — it survives
 * a classifier that drops every antialiased edge and a body that rolls out of
 * frame — while a half that drew nothing, or whose colours drifted past
 * {@link BODY_BRIGHTNESS_MINIMUM}, cannot reach it.
 */
const MINIMUM_BODY_PIXELS = 2000;

/**
 * Seconds after `load` before the two "has it settled?" frames are taken, and
 * the gap between them.
 *
 * The reference run's centroid stopped moving at ≈ 3.4 s and its frames stopped
 * changing at ≈ 3.9 s; 5.0 s is 1.1 s of margin on the slower of the two, and
 * the packet asks for both samples at least 4.5 s after load.
 */
const SETTLE_SAMPLE_SECONDS = 5;
const SETTLE_GAP_SECONDS = 0.6;

/**
 * Pixels that may differ between those two frames and still count as settled.
 *
 * The reference run measured **0**, at 5 s and at every later sample — every
 * body is asleep (§32) and nothing in the scene animates once they are. The
 * same frame-to-frame comparison taken over the second *ending* at 4 s, while
 * the last body was still rocking, gave 603, and over the second ending at 3 s,
 * 3 513. 200 is therefore a third of what a still-settling scene produces over
 * a longer gap and infinitely above the measured value, which is the margin a
 * software rasteriser deserves.
 */
const SETTLE_CHANGED_MAXIMUM = 200;

/**
 * Minimum area, in pixels, for a connected blob to be treated as a body the
 * mouse can aim at.
 *
 * The free 3D sphere — the isolated cluster this test ends up clicking, and the
 * only one small enough for the threshold to matter — measured 1 154 px on the
 * reference run. 200 keeps it with a factor of five to spare and rejects the
 * stray specks a rasteriser leaves at a silhouette's edge.
 */
const MINIMUM_CLUSTER_PIXELS = 200;

/**
 * How far above the pre-click topmost body row some body pixel must appear
 * after the poke, in world units.
 *
 * The example's poke imparts 6.5 m/s upward, which is a 2.15 m rise under
 * −9.81. Rapier 0.19's clicked sphere rose 2.13 world units and cleared the
 * pre-click top row by **1.37**. 0.20's pile sits slightly higher and the
 * rightmost cluster is closer to that top row, so the same poke cleared it by
 * **0.85** on CI. Requiring 0.5 still rejects a settling wobble (≈ 0.15) and
 * leaves ~40 % of margin on the 0.20 measurement.
 */
const IMPULSE_RISE_WORLD = 0.5;

/**
 * Seconds to keep sampling for that rise after the click.
 *
 * The apex is reached in ≈ 0.66 s (6.5 / 9.81) and the reference run's best
 * frame landed at 762 ms. 2.5 s covers the whole flight three times over, and
 * the loop samples as fast as it can screenshot (≈ 130 ms), so several frames
 * fall inside the ±0.28 s window in which the body is within 0.37 units of its
 * apex.
 */
const IMPULSE_WATCH_SECONDS = 2.5;

/** Seconds to let the poked half come back to rest before re-measuring it. */
const RESETTLE_SECONDS = 3;

// --- opening the page --------------------------------------------------------

/** Errors seen since the page was created, in the order the browser saw them. */
type ErrorLog = readonly string[];

/**
 * Opens the playground and returns its live error log plus the moment `load`
 * fired, which every "seconds after load" threshold above is measured from.
 *
 * `favicon.ico` is served rather than 404-ed, exactly as `example.spec.ts` does
 * it: the browser asks for it on its own, the example ships none, and the
 * resulting "failed to load resource" console error would otherwise have to be
 * excused by an allowlist — which would also excuse a real 404 for a real
 * asset.
 *
 * Note what is *not* filtered: Rapier's wasm loader writes a "using deprecated
 * parameters" notice through `console.warn`, and a warning is not an error, so
 * the log below stays empty without anyone having to say so.
 */
async function openPlayground(
  page: Page,
): Promise<{ errors: ErrorLog; loadedAt: number }> {
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
  await page.goto(PLAYGROUND_URL, { waitUntil: "load" });
  // `loadedAt` is a frame count, not a wall-clock instant: "N seconds since
  // load" is measured in animation frames drawn since this point.
  return { errors, loadedAt: await installFrameCounter(page) };
}

/**
 * Waits for the example to announce that both wasm images are in and the loop
 * is running (§45's composition root finished `initialize`).
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

/**
 * Blocks until `ceil(seconds · 60)` animation frames have been drawn since
 * `loadedAt` (the frame count {@link openPlayground} returned) — at least
 * `seconds` of wall clock, and at least that many frames of simulation.
 */
async function waitUntilSinceLoad(
  page: Page,
  loadedAt: number,
  seconds: number,
): Promise<void> {
  await waitUntilFrameCount(page, loadedAt + framesFor(seconds));
}

async function grab(canvas: Locator): Promise<DecodedImage> {
  return decodePng(await canvas.screenshot());
}

// --- reading the framebuffer -------------------------------------------------

/** An RGB colour as framebuffer bytes. */
type Rgb = readonly [number, number, number];

/** A half-open column range of a screenshot. */
interface ColumnRange {
  readonly from: number;
  readonly to: number;
}

/** Screenshot column → world X, DPR-agnostic. */
function imageToWorldX(image: DecodedImage, column: number): number {
  return VIEW_LEFT + ((column + 0.5) / image.width) * (VIEW_RIGHT - VIEW_LEFT);
}

/** Screenshot row → world Y. */
function imageToWorldY(image: DecodedImage, row: number): number {
  return VIEW_TOP - ((row + 0.5) / image.height) * (VIEW_TOP - VIEW_BOTTOM);
}

/** World X → screenshot column. */
function worldToColumn(image: DecodedImage, worldX: number): number {
  return Math.round(
    ((worldX - VIEW_LEFT) / (VIEW_RIGHT - VIEW_LEFT)) * image.width,
  );
}

/** World Y → screenshot row (world +Y is up, rows count down). */
function worldToRow(image: DecodedImage, worldY: number): number {
  return Math.round(
    ((VIEW_TOP - worldY) / (VIEW_TOP - VIEW_BOTTOM)) * image.height,
  );
}

/** The columns belonging to one half of the canvas. */
function halfColumns(image: DecodedImage, centerX: number): ColumnRange {
  return centerX < 0
    ? { from: 0, to: Math.round(image.width / 2) }
    : { from: Math.round(image.width / 2), to: image.width };
}

/** The colour of one pixel. */
function rgbAt(image: DecodedImage, column: number, row: number): Rgb {
  const at = (row * image.width + column) * image.bytesPerPixel;
  return [image.pixels[at], image.pixels[at + 1], image.pixels[at + 2]];
}

/** Whether a pixel belongs to a dynamic body — see {@link BODY_BRIGHTNESS_MINIMUM}. */
function isBodyPixel(
  image: DecodedImage,
  column: number,
  row: number,
): boolean {
  const [r, g, b] = rgbAt(image, column, row);
  return r + g + b > BODY_BRIGHTNESS_MINIMUM;
}

/** The largest per-channel difference between two colours. */
function colorDistance(a: Rgb, b: Rgb): number {
  return Math.max(
    Math.abs(a[0] - b[0]),
    Math.abs(a[1] - b[1]),
    Math.abs(a[2] - b[2]),
  );
}

/** What one half's body pixels say about where its bodies are. */
interface BodyFix {
  /** How many pixels matched. */
  readonly count: number;
  /** Their centroid, in world units. */
  readonly centroidY: number;
  /** The topmost row any of them occupies, and that row as a world Y. */
  readonly topRow: number;
  readonly topY: number;
}

/**
 * Finds one half's dynamic bodies and returns where they are, or `null` when
 * the half holds no body pixels at all.
 *
 * The centroid is over every matched pixel with no erosion: an antialiased edge
 * pixel is mostly scenery, so it fails the brightness bar before it can bias
 * anything, and the classifier's two populations are 83 apart in channel sum.
 */
function measureBodies(image: DecodedImage, half: ColumnRange): BodyFix | null {
  if (image.bytesPerPixel < 3) return null;
  let count = 0;
  let sumRow = 0;
  let topRow = -1;
  for (let row = 0; row < image.height; row += 1) {
    for (let column = half.from; column < half.to; column += 1) {
      if (!isBodyPixel(image, column, row)) continue;
      if (topRow < 0) topRow = row;
      count += 1;
      sumRow += row;
    }
  }
  if (count === 0) return null;
  return {
    count,
    centroidY: imageToWorldY(image, sumRow / count),
    topRow,
    topY: imageToWorldY(image, topRow),
  };
}

/**
 * The mean colour of one half's sensor-zone face, taken over the zone's
 * interior **excluding** body pixels.
 *
 * Excluding them is what makes the measurement meaningful at all: the zone is
 * drawn behind the bodies, so once they settle inside it roughly a third of the
 * rectangle is body colour, and a mean over everything would report a colour
 * neither state ever has.
 */
function zoneMeanColor(image: DecodedImage, centerX: number): Rgb {
  const left = worldToColumn(
    image,
    centerX - ZONE_HALF_WIDTH + ZONE_SAMPLE_INSET,
  );
  const right = worldToColumn(
    image,
    centerX + ZONE_HALF_WIDTH - ZONE_SAMPLE_INSET,
  );
  const top = worldToRow(image, ZONE_TOP_Y - ZONE_SAMPLE_INSET);
  const bottom = worldToRow(image, ZONE_BOTTOM_Y + ZONE_SAMPLE_INSET);
  let matched = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (let row = top; row < bottom; row += 1) {
    for (let column = left; column < right; column += 1) {
      if (isBodyPixel(image, column, row)) continue;
      const [r, g, b] = rgbAt(image, column, row);
      sumR += r;
      sumG += g;
      sumB += b;
      matched += 1;
    }
  }
  expect(
    matched,
    "the sensor zone's interior is entirely covered by bodies, so its colour cannot be read",
  ).toBeGreaterThan(0);
  return [
    Math.round(sumR / matched),
    Math.round(sumG / matched),
    Math.round(sumB / matched),
  ];
}

/** How many pixels differ between two same-sized frames. */
function changedPixels(before: DecodedImage, after: DecodedImage): number {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error("Frames have different sizes.");
  }
  let changed = 0;
  for (let i = 0; i < before.width * before.height; i += 1) {
    const at = i * before.bytesPerPixel;
    if (
      before.pixels[at] !== after.pixels[at] ||
      before.pixels[at + 1] !== after.pixels[at + 1] ||
      before.pixels[at + 2] !== after.pixels[at + 2]
    ) {
      changed += 1;
    }
  }
  return changed;
}

/** One connected blob of body pixels. */
interface Cluster {
  readonly area: number;
  /** Centroid in screenshot pixels — where the mouse aims. */
  readonly column: number;
  readonly row: number;
  /** Topmost row the blob occupies. */
  readonly top: number;
}

/**
 * Four-connected blobs of body pixels inside `half`, largest first, with specks
 * below {@link MINIMUM_CLUSTER_PIXELS} discarded.
 *
 * This is how the impulse test *locates* something to click instead of trusting
 * the example's layout: a body is wherever the framebuffer says a body is, and
 * a blob's centroid is inside it for every shape this scene contains.
 */
function bodyClusters(image: DecodedImage, half: ColumnRange): Cluster[] {
  const seen = new Uint8Array(image.width * image.height);
  const stack: number[] = [];
  const clusters: Cluster[] = [];
  for (let row = 0; row < image.height; row += 1) {
    for (let column = half.from; column < half.to; column += 1) {
      const start = row * image.width + column;
      if (seen[start] === 1 || !isBodyPixel(image, column, row)) continue;
      seen[start] = 1;
      stack.push(start);
      let area = 0;
      let sumColumn = 0;
      let sumRow = 0;
      let top = row;
      while (stack.length > 0) {
        const index = stack.pop() ?? 0;
        const currentRow = Math.floor(index / image.width);
        const currentColumn = index % image.width;
        area += 1;
        sumColumn += currentColumn;
        sumRow += currentRow;
        if (currentRow < top) top = currentRow;
        const neighbours = [
          [currentColumn + 1, currentRow],
          [currentColumn - 1, currentRow],
          [currentColumn, currentRow + 1],
          [currentColumn, currentRow - 1],
        ];
        for (const [nc, nr] of neighbours) {
          if (nc < half.from || nc >= half.to) continue;
          if (nr < 0 || nr >= image.height) continue;
          const next = nr * image.width + nc;
          if (seen[next] === 1 || !isBodyPixel(image, nc, nr)) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
      if (area >= MINIMUM_CLUSTER_PIXELS) {
        clusters.push({
          area,
          column: sumColumn / area,
          row: sumRow / area,
          top,
        });
      }
    }
  }
  return clusters.sort((a, b) => b.area - a.area);
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
 * Fails unless the screenshot and the CSS rectangle describe the same view.
 *
 * The two are allowed to differ in scale — that is the DPR — but not in shape.
 * If they ever did, every pixel measured from one and pointed at with the other
 * would be silently wrong. `interaction.spec.ts` checks the same thing for the
 * same reason.
 */
function expectMatchingAspect(image: DecodedImage, rect: CssRect): void {
  expect(
    Math.abs(image.width / image.height - rect.width / rect.height),
    `the screenshot is ${String(image.width)}×${String(image.height)} but the canvas ` +
      `is ${String(rect.width)}×${String(rect.height)} CSS px`,
  ).toBeLessThan(0.01);
}

// --- tests -------------------------------------------------------------------

test.describe("§108: gravity, collisions, impulses and sensors in the browser", () => {
  test("loads, decodes both wasm solvers, and starts the loop", async ({
    page,
  }) => {
    const { errors } = await openPlayground(page);
    const canvas = page.locator("#scene");
    await expect(canvas).toBeVisible();

    // The readiness gate itself: `data-state` goes `loading` → `running` only
    // after `Application.initialize` resolved, which awaits both Rapier worlds.
    await waitForRunning(page);

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
    expectMatchingAspect(frame, await cssRectOf(canvas));
    expect(
      frame.width / frame.height,
      "the canvas is not the 16:9 view every world↔pixel conversion here assumes",
    ).toBeCloseTo((VIEW_RIGHT - VIEW_LEFT) / (VIEW_TOP - VIEW_BOTTOM), 2);

    // A loop that throws on its first frames does so after `running`, so keep
    // the page alive long enough for that to be collected.
    await waitForFrames(page, framesFor(1));
    expect(errors).toEqual([]);
  });

  test("gravity pulls both halves' bodies down, and they settle (§22, §23)", async ({
    page,
  }) => {
    const { errors, loadedAt } = await openPlayground(page);
    const canvas = page.locator("#scene");
    await waitForRunning(page);

    // Before gravity has had time to work, the bodies are still in the air —
    // measured centroid +0.81 on the reference run. Without this the settled
    // assertion below would also pass on a scene that was *born* on the floor.
    const early = await grab(canvas);
    for (const centerX of [-HALF_CENTER_X, HALF_CENTER_X]) {
      const fix = measureBodies(early, halfColumns(early, centerX));
      expect(
        fix,
        `no bodies drawn in the ${String(centerX)} half`,
      ).not.toBeNull();
      expect((fix as BodyFix).centroidY).toBeGreaterThan(FLOOR_TOP_Y + 1);
    }

    await waitUntilSinceLoad(page, loadedAt, SETTLE_SAMPLE_SECONDS);
    const settled = await grab(canvas);
    await waitForFrames(page, framesFor(SETTLE_GAP_SECONDS));
    const later = await grab(canvas);

    for (const [label, centerX] of [
      ["2d", -HALF_CENTER_X],
      ["3d", HALF_CENTER_X],
    ] as const) {
      const fix = measureBodies(settled, halfColumns(settled, centerX));
      expect(fix, `no bodies drawn in the ${label} half`).not.toBeNull();
      const bodies = fix as BodyFix;
      expect(
        bodies.count,
        `${label}: too few body pixels to trust`,
      ).toBeGreaterThan(MINIMUM_BODY_PIXELS);
      // §7a: gravity is −Y in *both* dimensions, so both halves end up on the
      // floor. This is the assertion that would fail if the 2D world had been
      // given a Z-up or a downward-positive convention.
      expect(
        Math.abs(bodies.centroidY - SETTLED_CENTROID_Y),
        `${label}: the pile settled at ${bodies.centroidY.toFixed(3)}, not near ${String(SETTLED_CENTROID_Y)} (±${String(SETTLED_CENTROID_TOLERANCE)})`,
      ).toBeLessThanOrEqual(SETTLED_CENTROID_TOLERANCE);
      // Nothing fell through the floor.
      expect(bodies.centroidY).toBeGreaterThan(FLOOR_TOP_Y);
    }

    // …and stayed there: §32 puts settled bodies to sleep, and a sleeping scene
    // draws the same frame twice.
    expect(
      changedPixels(settled, later),
      "the scene is still moving 5 s in — the bodies never came to rest",
    ).toBeLessThanOrEqual(SETTLE_CHANGED_MAXIMUM);

    expect(errors).toEqual([]);
  });

  test("each sensor zone repaints when a body enters it (§24, §29)", async ({
    page,
  }) => {
    const { errors, loadedAt } = await openPlayground(page);
    const canvas = page.locator("#scene");
    const status = page.locator("#status");
    await waitForRunning(page);

    // The zones start empty: the lowest body has to fall ~0.6 world units before
    // it reaches one, which is ~0.36 s of simulation, and the readiness gate
    // above fires at the top of the very first frame. That window is real
    // but short, and under CI load the grab can land after a body has already
    // entered (2026-09-11: two failures in three runs on unchanged content).
    // So the emptiness proof is gated on the page's own §29 occupancy mirror,
    // read on both sides of the grab: a zone the example reports empty before
    // and after the screenshot must paint the empty colour; a zone already
    // entered is proven by the occupied half below instead of by a race.
    const occupancyOf = async (): Promise<readonly [string, string]> =>
      status.evaluate((element) => [
        element.getAttribute("data-zone2d") ?? "",
        element.getAttribute("data-zone3d") ?? "",
      ] as [string, string]);
    const beforeGrab = await occupancyOf();
    const empty = await grab(canvas);
    const afterGrab = await occupancyOf();
    for (const [index, label, centerX] of [
      [0, "2d", -HALF_CENTER_X],
      [1, "3d", HALF_CENTER_X],
    ] as const) {
      const entered = /[1-9]/.test(beforeGrab[index]) || /[1-9]/.test(afterGrab[index]);
      if (entered) {
        continue; // a body was already inside during the grab — nothing to prove empty
      }
      const color = zoneMeanColor(empty, centerX);
      expect(
        colorDistance(color, ZONE_EMPTY_RGB),
        `${label}: the zone reads ${JSON.stringify(color)} before any body reached it, not the empty colour`,
      ).toBeLessThanOrEqual(COLOR_MATCH_TOLERANCE);
    }

    // §29 fired: the example mirrors each zone's occupancy onto `#status`.
    await expect(status).toHaveAttribute("data-zone2d", /[1-9]/, {
      timeout: READY_TIMEOUT_MS,
    });
    await expect(status).toHaveAttribute("data-zone3d", /[1-9]/, {
      timeout: READY_TIMEOUT_MS,
    });

    // …and the event reached the screen. Sampled once the scene has settled, so
    // the frame is not caught mid-repaint.
    await waitUntilSinceLoad(page, loadedAt, SETTLE_SAMPLE_SECONDS);
    const occupied = await grab(canvas);
    for (const [label, centerX] of [
      ["2d", -HALF_CENTER_X],
      ["3d", HALF_CENTER_X],
    ] as const) {
      const color = zoneMeanColor(occupied, centerX);
      expect(
        colorDistance(color, ZONE_OCCUPIED_RGB),
        `${label}: the zone reads ${JSON.stringify(color)} with bodies inside it, not the occupied colour`,
      ).toBeLessThanOrEqual(COLOR_MATCH_TOLERANCE);
      expect(
        colorDistance(color, ZONE_EMPTY_RGB),
        `${label}: the zone never repainted`,
      ).toBeGreaterThan(COLOR_MATCH_TOLERANCE);
    }

    const occupancy2d = await status.getAttribute("data-zone2d");
    const occupancy3d = await status.getAttribute("data-zone3d");
    expect(Number(occupancy2d)).toBeGreaterThanOrEqual(1);
    expect(Number(occupancy3d)).toBeGreaterThanOrEqual(1);

    expect(errors).toEqual([]);
  });

  test("clicking a settled body launches it, and the half re-settles (§26, §71)", async ({
    page,
  }) => {
    const { errors, loadedAt } = await openPlayground(page);
    const canvas = page.locator("#scene");
    await waitForRunning(page);
    await waitUntilSinceLoad(page, loadedAt, SETTLE_SAMPLE_SECONDS);

    const before = await grab(canvas);
    const rect = await cssRectOf(canvas);
    expectMatchingAspect(before, rect);

    // Locate something to click *by measurement*: the rightmost blob of body
    // pixels in the 3D half is the free sphere the layout drops outside the
    // stack, and its centroid is a point inside it.
    const half = halfColumns(before, HALF_CENTER_X);
    const clusters = bodyClusters(before, half);
    expect(
      clusters.length,
      "no body clusters found in the 3D half to click",
    ).toBeGreaterThan(0);
    const target = clusters.reduce((a, b) => (b.column > a.column ? b : a));
    // It really is in the 3D half, and right of that half's centre — i.e. the
    // free sphere, not part of the stack.
    expect(
      imageToWorldX(before, target.column),
      "the located cluster is not in the 3D half",
    ).toBeGreaterThan(HALF_CENTER_X);

    const topBefore = measureBodies(before, half);
    expect(topBefore, "the 3D half drew no bodies").not.toBeNull();
    const topRowBefore = (topBefore as BodyFix).topRow;
    // The rise below is only evidence if the clicked body is not already the
    // highest thing on screen.
    expect(
      target.top,
      "the clicked cluster is the topmost thing in the half, so a rise would prove nothing",
    ).toBeGreaterThan(topRowBefore);

    // A real Chromium mouse click, as `interaction.spec.ts` does it: the CSS
    // rectangle turns a screenshot pixel into a viewport coordinate, DPR and
    // page layout included.
    const scaleX = rect.width / before.width;
    const scaleY = rect.height / before.height;
    await page.mouse.click(
      rect.x + (target.column + 0.5) * scaleX,
      rect.y + (target.row + 0.5) * scaleY,
    );

    // Watch the flight. Sampling is as fast as a screenshot allows (~130 ms),
    // so several frames land near the apex.
    const deadline = Date.now() + IMPULSE_WATCH_SECONDS * 1000;
    let highestRow = topRowBefore;
    while (Date.now() < deadline) {
      const frame = await grab(canvas);
      const fix = measureBodies(frame, half);
      if (fix !== null && fix.topRow < highestRow) {
        highestRow = fix.topRow;
      }
    }

    const risenWorld =
      ((topRowBefore - highestRow) / before.height) * (VIEW_TOP - VIEW_BOTTOM);
    expect(
      risenWorld,
      `the poked body rose ${risenWorld.toFixed(2)} world units above the pre-click ` +
        `top row (${String(Math.round(IMPULSE_RISE_WORLD * PIXELS_PER_UNIT))} px is the ` +
        `threshold) — the click did not become an impulse`,
    ).toBeGreaterThanOrEqual(IMPULSE_RISE_WORLD);

    // What goes up comes down: the half is at rest again a few seconds later.
    await waitForFrames(page, framesFor(RESETTLE_SECONDS));
    const restA = await grab(canvas);
    await waitForFrames(page, framesFor(SETTLE_GAP_SECONDS));
    const restB = await grab(canvas);
    expect(
      changedPixels(restA, restB),
      "the poked half never came back to rest",
    ).toBeLessThanOrEqual(SETTLE_CHANGED_MAXIMUM);

    const settledAgain = measureBodies(restB, half);
    expect(settledAgain, "the 3D half lost its bodies").not.toBeNull();
    expect(
      Math.abs((settledAgain as BodyFix).centroidY - SETTLED_CENTROID_Y),
      `the poked half re-settled at ${(settledAgain as BodyFix).centroidY.toFixed(3)}, not near ${String(SETTLED_CENTROID_Y)}`,
    ).toBeLessThanOrEqual(SETTLED_CENTROID_TOLERANCE);

    // §106a's session assertion, restated for a physics session: a click, a
    // pick, an impulse and a re-settle, and not one console error.
    expect(errors).toEqual([]);
  });
});
