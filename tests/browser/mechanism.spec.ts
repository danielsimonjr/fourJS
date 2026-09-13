/**
 * Phase 6 browser gate: §109's *"constraints remain stable under expected
 * real-time loads"*, measured from outside the page (plan WP-6.6).
 *
 * `tests/determinism/phase6-joints.test.ts` proves the joint pillar is
 * deterministic; `tests/integration/physics-joints.test.ts` proves each §28
 * joint matches its closed form. Neither answers the question §109 actually
 * asks, which is whether a *mechanism* — a closed kinematic loop with one
 * degree of freedom, driven by a motor, held together by three hinges and a
 * slider and loaded by a spring — keeps running in a browser, at a real frame
 * rate, while a user reconfigures it. Those are the things this file measures,
 * in `examples/mechanism` — §109's demonstration — through Chromium's real
 * framebuffer and Playwright's real mouse.
 *
 * ```text
 * page load → Rapier wasm init → PhysicsSystem (1 "2d" world, 6 joints)
 *   → fixed-step accumulator → node transforms → WebglRenderer → pixels
 *                                    ↑
 *   Chromium mouse → PointerInput → pick → HingeJoint.setMotor / enableMotor
 * ```
 *
 * ## The third site
 *
 * This spec drives a **third** server: `playwright.config.ts` runs one
 * `vite preview` per built example, `first-2d-scene` on 4173 (the suite's
 * `baseURL`), `physics-playground` on 4174 and `mechanism` on 4175.
 * {@link MECHANISM_URL} restates that port for the reason the scene constants
 * below are restated rather than imported — see "Method notes". Run
 * `bun run mechanism:build` before `bun run test:browser`, or the preview server has
 * no `dist` to serve.
 *
 * ## What is measured, and against what
 *
 * | test | §  | assertion |
 * | ---- | -- | --------- |
 * | loads | §109 | `#status` reaches `data-state="running"`, i.e. the wasm decoded and the loop started |
 * | steady operation | §28, §109 | both limit-switch counters climb, both lamps are *seen* latched, the mechanism's pixels change every frame while the control panel and the background do not change at all |
 * | motor toggle | §28 | a click releases the motor (`data-motor="off"`, the plate repaints), the mechanism coasts to less than half its driven switch cadence, and a second click restores it |
 * | speed control | §28 | two clicks on `+` raise the commanded rate, the switch cadence rises with it by more than a third, and two clicks on `−` bring both back |
 *
 * Every threshold below states the number the reference run measured and how
 * much margin the threshold leaves. Nothing here is a golden image: the gate
 * runs on SwiftShader, whose rasterisation differs from a GPU's, so every
 * assertion is a measurement with margin (§92).
 *
 * ## Method notes
 *
 * The scene's numbers are **restated** from the example rather than imported,
 * for the reason `smoothness.spec.ts`, `interaction.spec.ts` and
 * `playground.spec.ts` give: a browser gate checks the built page from the
 * outside, and importing the example's constants would let a wrong scene agree
 * with a wrong expectation.
 *
 * The PNG decoder is a copy of `example.spec.ts`'s, as in every other spec
 * here: Playwright returns an encoded screenshot, comparing compressed bytes
 * would conflate "the picture changed" with "the encoder picked different
 * filters", the workspace pins no image library, and this packet's file scope
 * forbids editing a sibling spec to share one.
 *
 * The **primary** signal in this file is the example's own data attributes —
 * `data-left-hits`, `data-right-hits`, `data-motor`, `data-target`,
 * `data-spin` — because they are what a limit switch *is* on that page: a
 * position sample latched in application code, mirrored onto `#status` on
 * purpose (the example says so itself). The pixel measurements corroborate
 * them: an attribute says the mechanism's state changed, the framebuffer says
 * the change reached the screen, and only both together say the mechanism runs.
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

// --- the built page, restated from `examples/mechanism` ----------------------

/**
 * Where the mechanism's `vite preview` server listens.
 *
 * Restated from `playwright.config.ts`'s `MECHANISM_PORT`, which is what
 * actually starts the server; `use.baseURL` belongs to the *first* site, so
 * every navigation in this file is absolute.
 */
const MECHANISM_URL = "http://localhost:4175/";

/** The orthographic camera's world extents: 16 × 9 units over a 16:9 canvas. */
const VIEW_LEFT = -8;
const VIEW_RIGHT = 8;
const VIEW_TOP = 4.5;
const VIEW_BOTTOM = -4.5;

/**
 * A rectangle of the world, `[x0, y0, x1, y1]` with `+Y` up (§7a).
 *
 * Every region below is stated in **world units** and converted with the
 * example's own map — `px = (x + 8) · 60`, `py = (4.5 − y) · 60` at its
 * authored 960 × 540 layout size — normalized by `image.width`/`image.height`,
 * so a run at DPR 2 produces the same numbers as a run at DPR 1.
 */
type WorldBox = readonly [number, number, number, number];

/**
 * The band the mechanism moves in: the crank's disc at x = −5.4, the rod, and
 * the carriage's stroke around x = −3. Its top stops **below** the two lamps at
 * y = 1.9 so that "the mechanism moved" is about moving parts and not about a
 * lamp repainting.
 */
const MECHANISM_REGION: WorldBox = [-6.6, -0.6, -1.9, 1.6];

/** The control panel: the motor plate and the two speed plates, nothing else. */
const PANEL_REGION: WorldBox = [1.0, 2.1, 5.4, 3.1];

/** A corner of empty background, far from every part of the scene. */
const BACKGROUND_REGION: WorldBox = [-7.6, -4.2, -6.6, -3.2];

/**
 * The two limit-switch lamps: 0.44-unit squares centred one crank radius either
 * side of the stroke centre (x = −3 ± 0.85) at y = 1.9. Sampled over a ±0.15
 * inset so no antialiased border pixel reaches the mean.
 */
const LEFT_LAMP_REGION: WorldBox = [-4.0, 1.75, -3.7, 2.05];
const RIGHT_LAMP_REGION: WorldBox = [-2.3, 1.75, -2.0, 2.05];

/** The motor plate, 1.4 × 0.9 at (1.6, 2.6), sampled over an inset of it. */
const MOTOR_PLATE_REGION: WorldBox = [1.1, 2.3, 2.1, 2.9];

/** Where the mouse aims for each plate: the plate's centre, in world units. */
const MOTOR_PLATE_POINT = { x: 1.6, y: 2.6 };
const SLOWER_PLATE_POINT = { x: 3.4, y: 2.6 };
const FASTER_PLATE_POINT = { x: 4.8, y: 2.6 };

// --- colours, as framebuffer bytes -------------------------------------------

/** An RGB colour as framebuffer bytes. */
type Rgb = readonly [number, number, number];

/**
 * The four indicator colours this file reads, measured through SwiftShader by
 * the WP-6.6 probe and identical on both of its runs.
 *
 * They are the example's `SWITCH_OPEN_COLOR`, `SWITCH_CLOSED_COLOR`,
 * `MOTOR_ON_COLOR` and `MOTOR_OFF_COLOR` after the renderer's own conversion,
 * which is why they are stated as *measurements* rather than derived from the
 * authored 0…1 floats.
 */
const LAMP_OPEN_RGB: Rgb = [46, 51, 71];
const LAMP_LATCHED_RGB: Rgb = [255, 74, 158];
const MOTOR_ON_RGB: Rgb = [61, 217, 115];
const MOTOR_OFF_RGB: Rgb = [107, 82, 76];

/**
 * How far a measured mean colour may sit from one of those, per byte.
 *
 * The repository convention (`interaction.spec.ts`, `playground.spec.ts`) is
 * 24. Nothing here is closer than 133 in some channel (open vs latched differ by
 * 209 in red; motor on vs off by 135 in green), so 24 cannot confuse a pair —
 * and the probe measured a residual of **0** in every channel, because each
 * plate and lamp is a flat unlit quad sampled over its interior.
 */
const COLOR_MATCH_TOLERANCE = 24;

// --- tolerances --------------------------------------------------------------

/**
 * Seconds to wait for `#status` to reach `data-state="running"`.
 *
 * The reference run reached it **33 ms** after `load` — the mechanism is one
 * `"2d"` world, so it decodes one Rapier wasm image rather than the
 * playground's two. 45 s is a thousand times that: it is not a performance
 * assertion, it is a "the wasm never arrived" assertion, and a cold, contended
 * CI machine must not fail it for being slow.
 */
const READY_TIMEOUT_MS = 45_000;

/**
 * Seconds of steady running the switch counters are watched over.
 *
 * At the authored 6 rad/s the crank turns once every 1.05 s and each lamp
 * latches once per turn, so six seconds is about 5.7 closures per lamp: the
 * probe measured **7 left and 6 right** on one run and 7/6 again on the next.
 */
const WATCH_SECONDS = 6;

/**
 * Closures each lamp must record over that window.
 *
 * 3 is under half the measured 6–7, which leaves room for a CI machine so slow
 * that the page's simulation runs at half speed — and is still impossible for a
 * mechanism that has stalled, seized, or lost its slider.
 */
const MINIMUM_HITS_PER_LAMP = 3;

/**
 * How long the lamps may be watched for a latched sighting, in seconds.
 *
 * A lamp is latched for only ~13 % of a revolution (the switch trips 0.07 m
 * short of a 0.85 m throw, which the carriage crosses at nearly zero speed), so
 * a screenshot has about a one-in-eight chance of catching one. The loop
 * samples as fast as it can screenshot (~150 ms) and stops as soon as **both**
 * lamps have been caught; the probe caught both within the first six seconds on
 * both runs, and 15 s is ~100 samples, i.e. ~13 expected sightings per lamp.
 */
const LAMP_WATCH_SECONDS = 15;

/**
 * Least mean per-pixel channel-sum difference, between two frames 200 ms apart,
 * for the mechanism's band to count as moving.
 *
 * The metric is `Σ(|Δr| + |Δg| + |Δb|) / pixels` over
 * {@link MECHANISM_REGION}. The probe measured **66.8** while driven (and 65.5
 * while coasting, which is why this file never uses the pixel delta to tell
 * driven from coasting — the data attributes do that). 2.0 is a thirtieth of
 * the measured value: it passes a mechanism turning at a third of the speed on
 * a machine drawing a third as many frames, and fails a frozen scene.
 */
const MOVING_REGION_DELTA_MINIMUM = 2;

/**
 * Pixels that may differ between those two frames inside a region that must not
 * change at all.
 *
 * The panel is 15 840 px and the background corner 3 600 px at DPR 1, and the
 * probe measured **0** changed pixels in both, on both runs and in both the
 * driven and the coasting window — they are flat unlit quads that nothing
 * animates. 8 is an insurance allowance against a rasteriser that dithers, and
 * is still 0.05 % of the panel.
 */
const STATIC_REGION_CHANGED_MAXIMUM = 8;

/**
 * Seconds each cadence measurement runs for.
 *
 * Four seconds is ~3.8 revolutions at the authored rate, i.e. ~7 combined
 * closures — enough that one closure landing outside the window moves the
 * measured rate by 14 %, which every ratio below has an order of magnitude of
 * margin on.
 */
const CADENCE_SECONDS = 4;

/**
 * The fraction of the driven cadence a coasting mechanism must fall below.
 *
 * Releasing the motor is not braking (WP-6.2-fix1): the crank keeps turning and
 * slows only as the spring's damper takes the energy out. The probe measured
 * **0 closures in the first four seconds of coasting** — the mechanism is down
 * to 0.04–0.39 rad/s by the end of them — against 1.83 Hz combined while
 * driven. Half the driven rate is therefore ~7 closures of margin.
 */
const COAST_RATE_FRACTION = 0.5;

/**
 * Combined closures the re-engaged mechanism must record in {@link WATCH_SECONDS}.
 *
 * The probe measured **11** (6 left, 5 right) in the six seconds after the
 * second click. 3 is under a third of that.
 */
const MINIMUM_RESUMED_HITS = 3;

/**
 * How much faster the switch cadence must get after two clicks on `+`.
 *
 * The example steps the commanded rate by 2 rad/s per click within [2, 12], so
 * two clicks take it from 6 to 10 — a factor of 1.67 in commanded speed. The
 * probe measured **3.25 Hz against 1.83 Hz, a ratio of 1.77**, on both runs.
 * 1.3 is well below that and well above the ±14 % a single closure landing
 * outside a four-second window can move either number by.
 */
const CADENCE_RATIO_MINIMUM = 1.3;

/**
 * How far below the fast cadence the restored one must fall after two clicks on
 * `−`.
 *
 * The probe measured 1.75–2.00 Hz restored against 3.25 Hz fast, i.e. 0.54–0.61
 * of it. 0.8 leaves a third of the gap as margin, and pairing it with
 * {@link MINIMUM_RESUMED_HITS} keeps "slower" from being satisfied by a
 * mechanism that stopped.
 */
const RESTORED_RATE_FRACTION = 0.8;

/** The commanded rates the `data-target` attribute reports, as it formats them. */
const TARGET_DEFAULT = "6.0";
const TARGET_AFTER_TWO_FASTER = "10.0";

// --- opening the page --------------------------------------------------------

/** Errors seen since the page was created, in the order the browser saw them. */
type ErrorLog = readonly string[];

/**
 * Opens the mechanism page and returns its live error log.
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
async function openMechanism(page: Page): Promise<ErrorLog> {
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
  await page.goto(MECHANISM_URL, { waitUntil: "load" });
  return errors;
}

/**
 * Waits for the example to announce that the wasm is in, the mechanism is
 * assembled and the loop is running (§45's composition root finished
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

/** The two §109 limit-switch counters, as the page publishes them. */
interface SwitchCounters {
  readonly left: number;
  readonly right: number;
}

/** Their sum — the cadence measurements below are all combined ones. */
function combined(counters: SwitchCounters): number {
  return counters.left + counters.right;
}

/**
 * Reads `data-left-hits` / `data-right-hits`.
 *
 * These are the example's *own* limit switches: a position sample latched in
 * application code on the open→closed edge, which is what an encoder-fed limit
 * switch is and what the example's header says it is. They are the primary
 * signal in this file; the lamp pixels corroborate them.
 */
async function readCounters(page: Page): Promise<SwitchCounters> {
  const status = page.locator("#status");
  const left = await status.getAttribute("data-left-hits");
  const right = await status.getAttribute("data-right-hits");
  expect(left, "the page publishes no data-left-hits").not.toBeNull();
  expect(right, "the page publishes no data-right-hits").not.toBeNull();
  return { left: Number(left), right: Number(right) };
}

/** One cadence measurement: closures per second over a measured window. */
interface Cadence {
  /** Combined closures observed. */
  readonly hits: number;
  /** Seconds the window actually lasted (wall clock, so never assumed). */
  readonly seconds: number;
  /** `hits / seconds`. */
  readonly rate: number;
}

/** Counts limit-switch closures over `seconds` of wall clock. */
async function measureCadence(page: Page, seconds: number): Promise<Cadence> {
  const before = await readCounters(page);
  const startedAt = Date.now();
  await waitForFrames(page, framesFor(seconds));
  const after = await readCounters(page);
  const elapsed = (Date.now() - startedAt) / 1000;
  const hits = combined(after) - combined(before);
  return { hits, seconds: elapsed, rate: hits / elapsed };
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

/** The colour of one pixel. */
function rgbAt(image: DecodedImage, column: number, row: number): Rgb {
  const at = (row * image.width + column) * image.bytesPerPixel;
  return [image.pixels[at], image.pixels[at + 1], image.pixels[at + 2]];
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
      const [r, g, b] = rgbAt(image, column, row);
      sumR += r;
      sumG += g;
      sumB += b;
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
 * Clicks a world point with a real Chromium mouse, as `interaction.spec.ts`
 * does it: the canvas's CSS rectangle turns a world coordinate into a viewport
 * one, DPR and page layout included.
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

// --- tests -------------------------------------------------------------------

test.describe("§109: a jointed mechanism, running and reconfigurable in the browser", () => {
  test("loads, decodes the wasm solver, and starts the mechanism", async ({
    page,
  }) => {
    const errors = await openMechanism(page);
    const canvas = page.locator("#scene");
    await expect(canvas).toBeVisible();

    // The readiness gate itself: `data-state` goes `loading` → `running` only
    // after `Application.initialize` and `PhysicsWorld.initialize` resolved and
    // the mechanism was assembled and jointed.
    await waitForRunning(page);

    const status = page.locator("#status");
    // The mechanism starts driven, at the rate the example authors.
    await expect(status).toHaveAttribute("data-motor", "on");
    await expect(status).toHaveAttribute("data-target", TARGET_DEFAULT);

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

    // A loop that throws on its first frames does so after `running`, so keep
    // the page alive long enough for that to be collected.
    await waitForFrames(page, framesFor(1));
    expect(errors).toEqual([]);
  });

  test("runs steadily: both limit switches latch and the mechanism moves (§28, §109)", async ({
    page,
  }) => {
    const errors = await openMechanism(page);
    const canvas = page.locator("#scene");
    await waitForRunning(page);

    const before = await readCounters(page);
    // Counters start where a freshly built mechanism's do — this is the guard
    // that makes every increment below an increment.
    expect(before.left).toBe(0);
    expect(before.right).toBe(0);

    // Two frames 200 ms apart, taken while the mechanism is driven.
    const firstFrame = await grab(canvas);
    await waitForFrames(page, framesFor(0.2));
    const secondFrame = await grab(canvas);

    const moving = regionDelta(firstFrame, secondFrame, MECHANISM_REGION);
    expect(
      moving.mean,
      `the mechanism's band changed by a mean of ${moving.mean.toFixed(2)} per pixel over ` +
        `200 ms (${String(moving.changed)} of ${String(moving.pixels)} pixels) — it is not turning`,
    ).toBeGreaterThan(MOVING_REGION_DELTA_MINIMUM);

    // …and the parts that must not move did not: the control panel and an empty
    // corner of the background. This is what makes the measurement above a
    // statement about the *mechanism* rather than about the page repainting.
    for (const [label, region] of [
      ["control panel", PANEL_REGION],
      ["background", BACKGROUND_REGION],
    ] as const) {
      const still = regionDelta(firstFrame, secondFrame, region);
      expect(
        still.changed,
        `${label}: ${String(still.changed)} of ${String(still.pixels)} pixels changed in a region that never animates`,
      ).toBeLessThanOrEqual(STATIC_REGION_CHANGED_MAXIMUM);
    }

    // Watch the lamps until both have been caught latched, and for at least the
    // counter window. A lamp is latched for ~13 % of a revolution, so this
    // samples as fast as it can screenshot rather than on a fixed cadence.
    const startedAt = Date.now();
    const deadline = startedAt + LAMP_WATCH_SECONDS * 1000;
    let leftLatchedSeen = false;
    let rightLatchedSeen = false;
    let leftOpenSeen = false;
    let rightOpenSeen = false;
    let samples = 0;
    while (
      Date.now() < deadline &&
      (!leftLatchedSeen ||
        !rightLatchedSeen ||
        Date.now() - startedAt < WATCH_SECONDS * 1000)
    ) {
      const frame = await grab(canvas);
      samples += 1;
      const left = meanColor(frame, LEFT_LAMP_REGION);
      const right = meanColor(frame, RIGHT_LAMP_REGION);
      leftLatchedSeen ||=
        colorDistance(left, LAMP_LATCHED_RGB) <= COLOR_MATCH_TOLERANCE;
      rightLatchedSeen ||=
        colorDistance(right, LAMP_LATCHED_RGB) <= COLOR_MATCH_TOLERANCE;
      leftOpenSeen ||=
        colorDistance(left, LAMP_OPEN_RGB) <= COLOR_MATCH_TOLERANCE;
      rightOpenSeen ||=
        colorDistance(right, LAMP_OPEN_RGB) <= COLOR_MATCH_TOLERANCE;
    }
    const watched = (Date.now() - startedAt) / 1000;

    // Both lamps were seen in **both** states, so each one is a switch and not
    // a quad that happens to be painted magenta.
    expect(
      leftLatchedSeen,
      `the left lamp never showed its latched colour in ${String(samples)} samples over ${watched.toFixed(1)} s`,
    ).toBe(true);
    expect(
      rightLatchedSeen,
      `the right lamp never showed its latched colour in ${String(samples)} samples over ${watched.toFixed(1)} s`,
    ).toBe(true);
    expect(leftOpenSeen).toBe(true);
    expect(rightOpenSeen).toBe(true);

    // The primary signal: both counters climbed while that was happening.
    const after = await readCounters(page);
    expect(watched).toBeGreaterThanOrEqual(WATCH_SECONDS);
    expect(
      after.left - before.left,
      `the left limit switch closed ${String(after.left - before.left)} times in ${watched.toFixed(1)} s`,
    ).toBeGreaterThanOrEqual(MINIMUM_HITS_PER_LAMP);
    expect(
      after.right - before.right,
      `the right limit switch closed ${String(after.right - before.right)} times in ${watched.toFixed(1)} s`,
    ).toBeGreaterThanOrEqual(MINIMUM_HITS_PER_LAMP);
    // A slider–crank reciprocates: the two ends are hit alternately, so the
    // counts can differ by at most one closure.
    expect(
      Math.abs(after.left - before.left - (after.right - before.right)),
      "one end of the stroke is being reached and the other is not",
    ).toBeLessThanOrEqual(1);

    expect(errors).toEqual([]);
  });

  test("clicking the motor plate releases the drive, and clicking it again restores it (§28)", async ({
    page,
  }) => {
    const errors = await openMechanism(page);
    const canvas = page.locator("#scene");
    const status = page.locator("#status");
    await waitForRunning(page);

    // How fast the switches close while the motor is driving — the baseline the
    // coast is compared against, measured on this machine rather than assumed.
    const driven = await measureCadence(page, CADENCE_SECONDS);
    expect(
      driven.hits,
      `only ${String(driven.hits)} closures in ${driven.seconds.toFixed(1)} s while driven`,
    ).toBeGreaterThanOrEqual(MINIMUM_HITS_PER_LAMP);

    const plateWhileOn = meanColor(await grab(canvas), MOTOR_PLATE_REGION);
    expect(
      colorDistance(plateWhileOn, MOTOR_ON_RGB),
      `the motor plate reads ${JSON.stringify(plateWhileOn)} while driving, not the on colour`,
    ).toBeLessThanOrEqual(COLOR_MATCH_TOLERANCE);

    // §28's `enableMotor(false)`, reached through §71/§72 picking: a real
    // Chromium click on the plate.
    const rect = await cssRectOf(canvas);
    await clickWorldPoint(page, rect, MOTOR_PLATE_POINT);
    await expect(status).toHaveAttribute("data-motor", "off");

    // The click reached the screen as well as the state.
    const plateWhileOff = meanColor(await grab(canvas), MOTOR_PLATE_REGION);
    expect(
      colorDistance(plateWhileOff, MOTOR_OFF_RGB),
      `the motor plate reads ${JSON.stringify(plateWhileOff)} after the release, not the off colour`,
    ).toBeLessThanOrEqual(COLOR_MATCH_TOLERANCE);
    expect(
      colorDistance(plateWhileOff, MOTOR_ON_RGB),
      "the motor plate never repainted",
    ).toBeGreaterThan(COLOR_MATCH_TOLERANCE);

    // Releasing is not braking (WP-6.2-fix1): the mechanism coasts and the
    // spring's damper takes the energy out over the next few seconds, so the
    // switch cadence collapses rather than stopping instantly.
    const coasting = await measureCadence(page, CADENCE_SECONDS);
    expect(
      coasting.rate,
      `the mechanism kept closing switches at ${coasting.rate.toFixed(2)} Hz while coasting, ` +
        `against ${driven.rate.toFixed(2)} Hz driven — the motor was not released`,
    ).toBeLessThan(driven.rate * COAST_RATE_FRACTION);

    // And it comes back: a second click re-engages the same motor record with
    // its target and effort intact (§28).
    await clickWorldPoint(page, rect, MOTOR_PLATE_POINT);
    await expect(status).toHaveAttribute("data-motor", "on");
    const resumed = await measureCadence(page, WATCH_SECONDS);
    expect(
      resumed.hits,
      `only ${String(resumed.hits)} closures in ${resumed.seconds.toFixed(1)} s after re-engaging the motor`,
    ).toBeGreaterThanOrEqual(MINIMUM_RESUMED_HITS);

    const plateAgain = meanColor(await grab(canvas), MOTOR_PLATE_REGION);
    expect(
      colorDistance(plateAgain, MOTOR_ON_RGB),
      "the motor plate did not go back to its on colour",
    ).toBeLessThanOrEqual(COLOR_MATCH_TOLERANCE);

    expect(errors).toEqual([]);
  });

  test("the − and + plates retune the motor, and the cadence follows (§28)", async ({
    page,
  }) => {
    const errors = await openMechanism(page);
    const canvas = page.locator("#scene");
    const status = page.locator("#status");
    await waitForRunning(page);
    const rect = await cssRectOf(canvas);

    const baseline = await measureCadence(page, CADENCE_SECONDS);
    expect(baseline.hits).toBeGreaterThanOrEqual(MINIMUM_HITS_PER_LAMP);

    // Two clicks on `+`: the example steps the commanded rate by 2 rad/s per
    // click within [2, 12], so 6 → 8 → 10, pushed into the live hinge through
    // §28's `setMotor` command queue.
    await clickWorldPoint(page, rect, FASTER_PLATE_POINT);
    await clickWorldPoint(page, rect, FASTER_PLATE_POINT);
    await expect(status).toHaveAttribute(
      "data-target",
      TARGET_AFTER_TWO_FASTER,
    );
    // Let the shaft reach the new rate before timing it (measured: it is there
    // within a few frames, and the probe allowed 800 ms).
    await waitForFrames(page, framesFor(0.8));

    const fast = await measureCadence(page, CADENCE_SECONDS);
    expect(
      fast.rate / baseline.rate,
      `the switch cadence went from ${baseline.rate.toFixed(2)} Hz at 6 rad/s to ` +
        `${fast.rate.toFixed(2)} Hz at 10 rad/s — a ratio of ` +
        `${(fast.rate / baseline.rate).toFixed(2)}`,
    ).toBeGreaterThan(CADENCE_RATIO_MINIMUM);

    // The solver really is turning the shaft faster, not just being asked to:
    // `data-spin` is the crank body's measured angular velocity (§28's motor
    // holds it to within ~0.1 rad/s of the command).
    const fastSpin = Number(await status.getAttribute("data-spin"));
    expect(fastSpin).toBeGreaterThan(8);

    // Two clicks on `−` put it back where it started.
    await clickWorldPoint(page, rect, SLOWER_PLATE_POINT);
    await clickWorldPoint(page, rect, SLOWER_PLATE_POINT);
    await expect(status).toHaveAttribute("data-target", TARGET_DEFAULT);
    await waitForFrames(page, framesFor(0.8));

    const restoredSpin = Number(await status.getAttribute("data-spin"));
    expect(restoredSpin).toBeLessThan(8);
    expect(restoredSpin).toBeGreaterThan(2);

    const restored = await measureCadence(page, CADENCE_SECONDS);
    expect(
      restored.rate,
      `the cadence stayed at ${restored.rate.toFixed(2)} Hz after two clicks on −, ` +
        `against ${fast.rate.toFixed(2)} Hz at the faster command`,
    ).toBeLessThan(fast.rate * RESTORED_RATE_FRACTION);
    // …and it is still running, which "slower" alone would not say.
    expect(restored.hits).toBeGreaterThanOrEqual(MINIMUM_HITS_PER_LAMP);

    // §106a's session assertion, restated for a mechanism: four clicks, two
    // live §28 reconfigurations, ~20 s of simulation, and not one console error.
    expect(errors).toEqual([]);
  });
});
