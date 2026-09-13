/**
 * Browser gate for **§119's engineering flagship**,
 * `examples/flagship/motor-digital-twin` (2026-08-08, `docs/AUDIT-120.md` S-8).
 *
 * §119 asks for an electric-motor digital twin — a 3D motor model, an animated
 * rotor, torque and angular-velocity visualization, bearing constraints, a
 * motorized shaft, vibration simulation, temperature indicators, waveform
 * charts, fault injection, a PID speed controller, pause and replay, and force
 * and torque vector overlays — and states its purpose rather than a success
 * criterion: *"This example establishes fourJS as useful for engineering,
 * education, simulation, and digital twins."*
 *
 * "Useful for engineering" is not a feeling, which makes §119 easier to gate
 * than §118. An engineer's test of a twin is whether its numbers are *true*, and
 * that decomposes into four measurable claims, which are what this file checks:
 *
 * 1. **The machine really moves, and the solver moves it.** The rotor's rotation
 *    is measured in changed pixels inside a cropped machine bay, and the shaft
 *    angle the page publishes advances with it.
 * 2. **The loop closes, and the readouts are the engine's own state.** The PID
 *    reaches the setpoint within a stated margin, and every §40 display value is
 *    checked against the engine-unit value published beside it — so a readout
 *    cannot be a plausible-looking second number.
 * 3. **The run is reproducible (§33), and the recording reproduces it (§34).**
 *    Two independent page loads reaching the same simulation step publish the
 *    *same* uint32 checksum; a seek into the recording lands on the checksum the
 *    live run published at that step, bit for bit; and the replay verifies
 *    against the recorder's final checksum.
 * 4. **The state is expressible (§79).** Saving the scene, reloading it, and
 *    re-saving the reload reproduces the original bytes exactly.
 *
 * ## What is measured, and why each measurement is falsifiable
 *
 * | test | § | assertion |
 * | ---- | - | --------- |
 * | loads | §45, §37, §84, §40 | `#status` reaches `running`; the backend is `webgl2` and the solver `rapier3d`; **four** bodies, **five** joints and **five** colliders read off the world itself; §84 statistics are on and report measured numbers where a producer exists and `nan` where none does; the declared §40 symbols are `° \| mm \| ms`; no console error or unhandled rejection |
 * | the machine turns | §28, §53 | inside the machine bay: amber rotor pixels and steel frame pixels are both present, and the largest of three samples 180 ms apart differs over thousands of pixels while the published shaft angle advances |
 * | the loop closes | §111, §40 | after {@link MARK_STEP} steps the shaft is within {@link SPEED_TOLERANCE_RPM} of the 200 rpm setpoint, and `rpm`, `angledeg` and `vibrationmm` each equal the engine-unit value beside them put through the declared conversion |
 * | two runs are identical | §33 | two page loads publish the same non-zero `data-markchecksum` |
 * | the charts draw | §119, `R-24` | all four traces are found by hue in their own chart, and the traces change between two frames |
 * | fault injection | §28, §29 | the rub fault moves the magenta caliper down by ≥ 20 px, raises the winding temperature by ≥ 10 K and drives the command above the measured speed; releasing it returns the fault to `none`. The drive sag leaves a standing speed error ≥ 5 rad/s against a published actuator ceiling of 14 rad/s |
 * | pause and single step | §10 | pause freezes the framebuffer (measured: **0** changed pixels) and the step counter; one single step advances `data-steps` by exactly **1** and `data-sim` by exactly `1/60` s, and redraws |
 * | record, seek, replay, save | §34, §33, §79 | the recording closes at {@link RECORD_STEPS}; a seek re-simulates fewer than {@link SNAPSHOT_INTERVAL_STEPS} steps and lands on the live run's checksum; the replay verifies; the live world is restored; and the §79 save round-trips byte-identically |
 * | the overlay and the controls | §113, §48, §71, §75 | the overlay's saturated no-blue colours appear in the machine bay where there were none; pointing at each published control position flips `data-hover` to that control; Tab reaches a control and Enter activates it with `source: "keyboard"` |
 *
 * ## Method notes
 *
 * **Regions, not one global palette.** The §118 flagship could classify the
 * whole frame by hue because it was one scene. This page is two instruments side
 * by side — a machine bay on the left, an instrument column on the right — and
 * the same hue means different things in each (amber is the rotor on the left
 * and would be the temperature trace on the right). So every classifier below is
 * used inside a stated crop, and the crops are derived from the example's own
 * layout constants and were confirmed against a probe screenshot.
 *
 * **The two speed traces overlap when the controller is working.** Measured
 * speed and commanded speed coincide at steady state — that is what a closed
 * loop looks like — so the trace drawn second wins those pixels and the cyan
 * count is much smaller than the yellow. The threshold below is set at "never
 * drew anything", not at "typical", and the fault test asserts the *separation*
 * that a disturbance produces instead.
 *
 * The scene's numbers are **restated** from the example rather than imported,
 * for the reason every other spec here gives: a browser gate checks the built
 * page from the outside, and importing the example's constants would let a wrong
 * scene agree with a wrong expectation. The **control positions are the
 * exception and are read from the page** (`data-controls`), because recomputing
 * where §74's flex layout puts a button would be testing this file's copy of the
 * layout algorithm; the page's claim is checked via `data-hover` before it is
 * trusted.
 *
 * The PNG decoder is a copy of `example.spec.ts`'s, as in every other spec here:
 * Playwright returns an encoded screenshot, comparing compressed bytes would
 * conflate "the picture changed" with "the encoder picked different filters",
 * the workspace pins no image library, and a shared helper would mean editing a
 * sibling spec.
 *
 * Nothing here is a golden image: the gate runs on SwiftShader, whose
 * rasterisation differs from a GPU's, so every assertion is a measurement with a
 * stated margin (§92). Each threshold below quotes what the probe measured.
 */

import { inflateSync } from "node:zlib";

import { expect, test, type Page } from "@playwright/test";

import {
  framesFor,
  waitForFrames,
  waitForSimulationSeconds,
} from "./helpers/wait.js";

// ---------------------------------------------------------------------------
// PNG decoding (see "Method notes")
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// The scene, restated (see "Method notes")
// ---------------------------------------------------------------------------

/** The motor twin, the ninth `webServer` of `playwright.config.ts`. */
const TWIN_URL = "http://localhost:4181/";

/** Canvas size in CSS pixels. The camera's `aspect` is built from this shape. */
const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 600;

/** The example's fixed simulation step, in seconds (§10, Appendix A). */
const FIXED_DELTA_TIME = 1 / 60;

/** The step whose §33 checksum the page publishes as `data-markchecksum`. */
const MARK_STEP = 360;

/** Steps the twin records before closing its §34 document. */
const RECORD_STEPS = 600;

/** Steps between the recording's periodic snapshots. */
const SNAPSHOT_INTERVAL_STEPS = 60;

/** The twin's default speed setpoint, in revolutions per minute. */
const SETPOINT_RPM = 200;

/**
 * How far from the setpoint a settled shaft may sit, in RPM.
 *
 * Not a controller tolerance so much as a *plant* one: the rotor carries a
 * deliberate unbalance on a compliant mount, so its speed ripples by roughly
 * ±1 rpm at steady state (probe: 198.8…201.5 over ten seconds). Four is that
 * with room, and is still a twentieth of the setpoint.
 */
const SPEED_TOLERANCE_RPM = 4;

/** The actuator ceiling the drive-sag fault imposes, in rad/s. */
const SAG_CEILING = 14;

// ---------------------------------------------------------------------------
// Regions (see "Method notes": every classifier is used inside a crop)
// ---------------------------------------------------------------------------

/** A rectangle of the canvas, in device pixels, as `[x0, y0, x1, y1]`. */
type Region = readonly [number, number, number, number];

/**
 * The machine bay: the left 44 % of the frame, below the nameplate.
 *
 * The machine stands at world x = −2.35 in a frustum 8.2 m wide at its depth, so
 * the frame spans roughly x 80…340 of 960; 422 is well clear of it and well left
 * of the instrument column, whose left edge is at x ≈ 513.
 */
const MACHINE_BAY: Region = [0, 120, 422, 540];

/** Chart A (speed), derived from the example's instrument-plane layout. */
const CHART_A: Region = [514, 12, 941, 102];

/** Chart B (vibration and temperature). */
const CHART_B: Region = [514, 126, 941, 213];

/** The temperature bar, whose *length* is the reading. */
const TEMPERATURE_BAR: Region = [514, 358, 941, 374];

// ---------------------------------------------------------------------------
// Pixel classifiers (see the example's "the palette is an instrument")
// ---------------------------------------------------------------------------

/** The **rotor**: amber, `(255, 158, 43)` at full illumination (probe). */
function isRotorPixel(r: number, g: number, b: number): boolean {
  return r >= 150 && r - g >= 60 && r - b >= 110;
}

/**
 * The **frame**: steel blue. The probe found three lighting levels —
 * `(103, 128, 208)`, `(71, 88, 149)` and `(67, 84, 141)` — and the bench slab
 * `(43, 45, 53)`, which `b >= 100` excludes.
 */
function isFramePixel(r: number, g: number, b: number): boolean {
  return b >= 100 && b - r >= 45 && b - g >= 35;
}

/** The **brake caliper**: magenta, `(250, 64, 178)` (probe). */
function isCaliperPixel(r: number, g: number, b: number): boolean {
  return r >= 150 && b >= 110 && g <= r - 100;
}

/** The **measured-speed** trace: cyan, `(61, 219, 240)` (probe). */
function isSpeedTracePixel(r: number, g: number, b: number): boolean {
  return g >= 140 && b >= 140 && g - r >= 80 && b - r >= 80;
}

/** The **commanded-speed** trace: yellow, `(255, 219, 79)` (probe). */
function isCommandTracePixel(r: number, g: number, b: number): boolean {
  return r >= 170 && g >= 150 && b <= 130;
}

/** The **vibration** trace: green, `(79, 230, 120)` (probe). */
function isVibrationTracePixel(r: number, g: number, b: number): boolean {
  return g >= 150 && g - r >= 80 && g - b >= 60;
}

/** The **temperature** trace: orange-red, `(255, 110, 51)` (probe). */
function isTemperatureTracePixel(r: number, g: number, b: number): boolean {
  return r >= 200 && r - g >= 100 && r - b >= 150;
}

/**
 * The §113 **overlay**: saturated, with essentially no blue — `(0, 255, 0)`
 * origins, `(255, 140, 0)` torque arc, `(255, 26, 26)` mount reaction.
 *
 * `b <= 30` is what keeps the amber rotor out, and the margin was computed
 * rather than eyeballed: amber is `(1, 0.59, 0.16)` before lighting, so a pixel
 * dark enough to have `b <= 30` has `r <= 187` and fails the second clause.
 */
function isOverlayPixel(r: number, g: number, b: number): boolean {
  return b <= 30 && Math.max(r, g) >= 200;
}

/** Text: near-neutral and bright — `(236, 239, 246)` (probe). */
function isGlyphPixel(r: number, g: number, b: number): boolean {
  const low = Math.min(r, g, b);
  return low >= 170 && Math.max(r, g, b) - low <= 22;
}

/** The chart and bar background, `(18, 19, 26)`, and the page's `(8, 9, 14)`. */
function isInstrumentBackgroundPixel(r: number, g: number, b: number): boolean {
  return r <= 30 && g <= 30 && b <= 40;
}

// ---------------------------------------------------------------------------
// Pixel helpers
// ---------------------------------------------------------------------------

type Classifier = (r: number, g: number, b: number) => boolean;

/** Counts pixels of `image` inside `region` that `matches` accepts. */
function countIn(
  image: DecodedImage,
  region: Region,
  matches: Classifier,
): number {
  const [x0, y0, x1, y1] = region;
  let total = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const at = (y * image.width + x) * image.bytesPerPixel;
      if (
        matches(image.pixels[at], image.pixels[at + 1], image.pixels[at + 2])
      ) {
        total += 1;
      }
    }
  }
  return total;
}

/** The mean y of the pixels `matches` accepts, or `NaN` when there are none. */
function centroidY(
  image: DecodedImage,
  region: Region,
  matches: Classifier,
): number {
  const [x0, y0, x1, y1] = region;
  let total = 0;
  let sum = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const at = (y * image.width + x) * image.bytesPerPixel;
      if (
        matches(image.pixels[at], image.pixels[at + 1], image.pixels[at + 2])
      ) {
        total += 1;
        sum += y;
      }
    }
  }
  return total === 0 ? Number.NaN : sum / total;
}

/** How many pixels of `region` differ between `a` and `b` by more than `slack`. */
function changedIn(
  a: DecodedImage,
  b: DecodedImage,
  region: Region,
  slack = 8,
): number {
  const [x0, y0, x1, y1] = region;
  let changed = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const at = (y * a.width + x) * a.bytesPerPixel;
      const dr = Math.abs(a.pixels[at] - b.pixels[at]);
      const dg = Math.abs(a.pixels[at + 1] - b.pixels[at + 1]);
      const db = Math.abs(a.pixels[at + 2] - b.pixels[at + 2]);
      if (Math.max(dr, dg, db) > slack) changed += 1;
    }
  }
  return changed;
}

/** The whole canvas, as a region. */
const WHOLE_CANVAS: Region = [0, 0, CANVAS_WIDTH, CANVAS_HEIGHT];

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

/** Everything `#status` publishes, as strings. */
type Status = Record<string, string>;

async function readStatus(page: Page): Promise<Status> {
  return await page.evaluate(() => {
    const element = document.querySelector<HTMLElement>("#status");
    if (element === null) throw new Error("no #status element");
    return Object.assign({}, element.dataset) as Record<string, string>;
  });
}

/** A decoded screenshot of the canvas alone. */
async function shoot(page: Page): Promise<DecodedImage> {
  return decodePng(await page.locator("#scene").screenshot());
}

/**
 * Opens the twin, waits until it is running, and returns the page's live error
 * log.
 *
 * `favicon.ico` is served rather than 404-ed, for `example.spec.ts`'s reason:
 * the browser asks for it on its own, the example ships none, and the resulting
 * console error would otherwise need an allowlist that would also excuse a real
 * 404.
 *
 * 30 s rather than the sibling specs' 20 s: this page decodes a Rapier
 * WebAssembly image before it reports `running`, and it does it on a container
 * with no GPU.
 */
async function openTwin(page: Page): Promise<string[]> {
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
  await page.goto(TWIN_URL, { waitUntil: "load" });
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLElement>("#status")?.dataset["state"] ===
      "running",
    undefined,
    { timeout: 30_000 },
  );
  return errors;
}

/** Waits until the twin has run at least `steps` fixed steps. */
async function runTo(page: Page, steps: number): Promise<void> {
  await page.waitForFunction(
    (target: number) =>
      Number(
        document.querySelector<HTMLElement>("#status")?.dataset["steps"] ?? "0",
      ) >= target,
    steps,
    { timeout: 45_000 },
  );
}

/** Where the page believes each control is, in canvas pixels. */
async function controlPoints(
  page: Page,
): Promise<Map<string, { x: number; y: number }>> {
  const status = await readStatus(page);
  const points = new Map<string, { x: number; y: number }>();
  for (const entry of (status["controls"] ?? "").split("|")) {
    const [name, pair] = entry.split(":");
    const [x, y] = (pair ?? "").split(",");
    points.set(name, { x: Number(x), y: Number(y) });
  }
  expect(
    [...points.keys()].sort(),
    "the page did not publish its seven controls",
  ).toEqual(["audit", "overlay", "pause", "rub", "sag", "setpoint", "step"]);
  return points;
}

/**
 * Clicks the control the page says is at `name`, after checking the claim.
 *
 * The pointer is moved first and `data-hover` read back: the page publishes
 * where it *believes* its controls are, and a gate that clicked a published
 * point without checking would pass on a page that published nonsense.
 * `page.mouse` works in viewport coordinates, so the canvas's bounding box has
 * to be added — the trap the §118 flagship's gate documented.
 */
async function clickControl(page: Page, name: string): Promise<void> {
  const points = await controlPoints(page);
  const point = points.get(name);
  expect(point, `no published position for the ${name} control`).toBeDefined();
  const box = await page.locator("#scene").boundingBox();
  expect(box, "the canvas has no bounding box").not.toBeNull();
  if (point === undefined || box === null) return;

  await page.mouse.move(box.x + point.x, box.y + point.y);
  await waitForFrames(page, framesFor(0.15));
  if (name !== "setpoint") {
    expect(
      (await readStatus(page))["hover"],
      `pointing at the published ${name} position did not hover it`,
    ).toBe(name);
  }
  await page.mouse.down();
  await waitForFrames(page, framesFor(0.06));
  await page.mouse.up();
  await waitForFrames(page, framesFor(0.15));
}

/** Presses Tab until `name` holds the §75 focus, and fails if it never does. */
async function focusControl(page: Page, name: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if ((await readStatus(page))["focused"] === name) return;
    await page.keyboard.press("Tab");
    await waitForFrames(page, framesFor(0.08));
  }
  expect(
    (await readStatus(page))["focused"],
    `Tab never reached the ${name} control`,
  ).toBe(name);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("examples/flagship/motor-digital-twin (§119)", () => {
  test("loads the machine, the solver, §84 statistics and §40 units", async ({
    page,
  }) => {
    const errors = await openTwin(page);
    const canvas = page.locator("#scene");
    await expect(canvas).toBeVisible();

    const drawingBuffer = await canvas.evaluate(
      (element: HTMLCanvasElement) => ({
        width: element.width,
        height: element.height,
      }),
    );
    expect(drawingBuffer.width).toBeGreaterThanOrEqual(CANVAS_WIDTH);
    expect(drawingBuffer.height).toBeGreaterThanOrEqual(CANVAS_HEIGHT);

    await runTo(page, 60);
    const status = await readStatus(page);

    // §45/§37: the backend and the directly-constructed 3D adapter.
    expect(status["backend"]).toBe("webgl2");
    expect(status["solver"]).toBe("rapier3d");

    // The machine, read off the world rather than typed into the page: the
    // bench, the stator, the rotor and the brake pad; the mount's slider and
    // spring, the two bearing hinges and the brake actuator; and five colliders,
    // because the rotor carries two (§119's "bearing constraints" and the
    // unbalance that makes the vibration).
    expect(status["bodies"]).toBe("4");
    expect(status["joints"]).toBe("5");
    expect(status["colliders"]).toBe("5");

    // §119's "bearing constraints", read back off the two joints: a coaxial
    // pair, of which exactly one carries the §28 motor. A twin with one bearing
    // would still spin; it would not be the machine §119 describes.
    expect(status["bearings"]).toBe("driven/free");
    expect(status["mounttravel"]).toBe("-0.060,0.060");

    // §84 (A-1): this is the first example to read `app.stats`, so the gate
    // checks both halves of §84's rule — a producer's number is a number, and a
    // counter with no producer stays `nan` rather than quietly becoming 0.
    expect(status["stats"]).toBe("on");
    expect(Number(status["drawcalls"])).toBeGreaterThan(0);
    expect(Number(status["triangles"])).toBeGreaterThan(0);
    expect(Number(status["cpuframe"])).toBeGreaterThan(0);
    expect(Number(status["bufferbytes"])).toBeGreaterThan(0);
    // §32's awake set, filled by the application because §45 has no
    // `app.physics` yet (gap `A-6`): four bodies, none asleep.
    expect(status["activebodies"]).toBe("4");
    // `recordSolverStatistics` now writes `SolverStatistics.contactCount`
    // (A-5 / #76). `NaN` would mean "not measured"; a finite count — including
    // zero — means the producer ran. The twin is joint-held, so this is often
    // 0, but CI has also seen a handful of resting contacts.
    expect(
      Number.isFinite(Number(status["contacts"])),
      `contacts must be a finite count, got ${status["contacts"]}`,
    ).toBe(true);
    expect(Number(status["contacts"])).toBeGreaterThanOrEqual(0);
    // §84's GPU-frame row is a CAPABILITY, not a contract: it needs
    // `timestamp-query` (WebGPU) or `EXT_disjoint_timer_query` (WebGL), and
    // whether a runner offers them is not something this repo controls. This
    // line used to assert the sentinel outright, on the assumption that
    // SwiftShader/CI never has them — until CI returned `0.015531` on
    // 2026-09-07 and turned `main` red for a working feature. `A-1 (c)` had
    // shipped `Renderer.lastGpuFrameTimeSeconds` the day before; the driver
    // simply started answering.
    //
    // So assert what §84 actually promises, the same shape as `contacts`
    // above: either the "not measured" sentinel, or a real positive duration.
    // What must never happen is a counter with no producer quietly reading 0.
    const gpuFrame = status["gpuframe"];
    if (gpuFrame !== "nan") {
      expect(
        Number.isFinite(Number(gpuFrame)),
        `gpuframe must be "nan" or a finite duration, got ${gpuFrame}`,
      ).toBe(true);
      expect(Number(gpuFrame)).toBeGreaterThan(0);
    }

    // §40: the declared display units, and the fixed step in the declared time
    // unit. The engine is still seconds — this is the conversion at the edge.
    expect(status["unitsymbols"]).toBe("°|mm|ms");
    expect(Number(status["stepms"])).toBeCloseTo(1000 / 60, 4);

    expect(errors, "the page logged errors").toEqual([]);
  });

  test("the rotor turns, and the solver is what turns it (§28, §53)", async ({
    page,
  }) => {
    await openTwin(page);
    await runTo(page, 120);

    const before = await shoot(page);
    const angleBefore = Number((await readStatus(page))["angle"]);

    // Both parts of the machine are on screen: an amber rotor inside a steel
    // frame. A page that drew the frame but lost the rotor fails on a count.
    expect(
      countIn(before, MACHINE_BAY, isRotorPixel),
      "no amber rotor pixels in the machine bay",
    ).toBeGreaterThan(2000);
    expect(
      countIn(before, MACHINE_BAY, isFramePixel),
      "no steel frame pixels in the machine bay",
    ).toBeGreaterThan(8000);

    // The rotation, in pixels — sampled three times rather than once, and the
    // **largest** difference taken, because the rotor is six-fold symmetric.
    // At 200 rpm a whole number of twentieths of a second is a whole number of
    // 60° steps, so a single badly-timed sample can find the vanes almost back
    // where they started and see only the balance weight move (measured: 1 911
    // changed pixels at that phase, against ~9 000 half a vane-pitch away).
    // Three samples 180 ms apart cannot all land on a repeat.
    let changed = 0;
    let angleAfter = angleBefore;
    for (let sample = 0; sample < 3; sample += 1) {
      await waitForFrames(page, framesFor(0.18));
      const after = await shoot(page);
      changed = Math.max(changed, changedIn(before, after, MACHINE_BAY));
      angleAfter = Number((await readStatus(page))["angle"]);
    }
    expect(
      changed,
      "the machine bay did not change while the rotor turned",
    ).toBeGreaterThan(2500);

    // And the same rotation, in the engine's own account of it. The shaft angle
    // wraps at 2π, so the assertion is that it *moved*, not that it increased.
    expect(Math.abs(angleAfter - angleBefore)).toBeGreaterThan(0.05);

    // The nameplate is drawn: §55/§56 text in the same frame as the machine.
    expect(countIn(before, MACHINE_BAY, isGlyphPixel)).toBeGreaterThan(50);
  });

  test("the PID reaches the setpoint, and the readouts are the engine's own state (§111, §40)", async ({
    page,
  }) => {
    await openTwin(page);
    await runTo(page, MARK_STEP);
    const status = await readStatus(page);

    // §111: the loop closes. The scripted rub fault fires between steps 180 and
    // 240, so by step 360 this is also a statement that the controller recovered
    // from a disturbance.
    const rpm = Number(status["rpm"]);
    expect(
      Math.abs(rpm - SETPOINT_RPM),
      `the shaft settled at ${String(rpm)} rpm, not ${String(SETPOINT_RPM)}`,
    ).toBeLessThan(SPEED_TOLERANCE_RPM);
    expect(Number(status["setpointrpm"])).toBeCloseTo(SETPOINT_RPM, 3);

    // §40: every display value is the engine value put through the declared unit
    // system. This is the assertion that a readout cannot be a second number
    // that merely looks plausible.
    const omega = Number(status["omega"]);
    expect(Number(status["rpm"])).toBeCloseTo((omega * 60) / (Math.PI * 2), 2);
    expect(Number(status["commandrpm"])).toBeCloseTo(
      (Number(status["command"]) * 60) / (Math.PI * 2),
      2,
    );
    expect(Number(status["angledeg"])).toBeCloseTo(
      (Number(status["angle"]) * 180) / Math.PI,
      2,
    );
    expect(Number(status["vibrationmm"])).toBeCloseTo(
      Number(status["vibration"]) * 1000,
      3,
    );

    // The machine really is vibrating, and really is warming: both are emergent,
    // and both would read zero if the unbalance or the thermal model were gone.
    expect(Number(status["vibrationmm"])).toBeGreaterThan(2);
    expect(Number(status["temperature"])).toBeGreaterThan(30);
    expect(status["tripped"]).toBe("false");
  });

  test("two runs reaching the same step hold the same state (§33)", async ({
    page,
  }) => {
    await openTwin(page);
    await runTo(page, MARK_STEP + 5);
    const first = (await readStatus(page))["markchecksum"];
    expect(first, "no checksum was published at the mark step").not.toBe("0");

    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLElement>("#status")?.dataset["state"] ===
        "running",
      undefined,
      { timeout: 30_000 },
    );
    await runTo(page, MARK_STEP + 5);
    const second = (await readStatus(page))["markchecksum"];

    // Two independent runs of the same build, on the same runtime: §33's
    // same-runtime determinism tier, measured from outside the engine. Frame
    // timing differs between the runs — the number of fixed steps each frame
    // consumes is a function of the browser's rAF, not of the simulation — which
    // is exactly why the fingerprint is taken at a *step index* and not at a
    // wall-clock moment.
    expect(second, "two runs diverged by step 360").toBe(first);
  });

  test("the waveform charts draw all four traces and scroll (§119, R-24)", async ({
    page,
  }) => {
    await openTwin(page);
    await runTo(page, 240);

    const before = await shoot(page);

    // Chart A holds both speed traces. The thresholds are asymmetric on purpose:
    // measured and commanded speed coincide when the controller is working, so
    // the trace drawn second wins those pixels (probe: 857 yellow, 165 cyan).
    expect(
      countIn(before, CHART_A, isCommandTracePixel),
      "no commanded-speed trace in chart A",
    ).toBeGreaterThan(200);
    expect(
      countIn(before, CHART_A, isSpeedTracePixel),
      "no measured-speed trace in chart A",
    ).toBeGreaterThan(30);

    // Chart B holds vibration and temperature (probe: 865 green, 854 orange).
    expect(
      countIn(before, CHART_B, isVibrationTracePixel),
      "no vibration trace in chart B",
    ).toBeGreaterThan(200);
    expect(
      countIn(before, CHART_B, isTemperatureTracePixel),
      "no temperature trace in chart B",
    ).toBeGreaterThan(200);

    // A strip chart scrolls. Half a second is 15 of the 90 samples in the
    // window, so a sixth of every trace is new.
    await waitForSimulationSeconds(page, 0.6);
    const after = await shoot(page);
    expect(
      changedIn(before, after, CHART_A) + changedIn(before, after, CHART_B),
      "the charts did not scroll",
    ).toBeGreaterThan(100);

    // The temperature bar reads as a length, not a hue: its fill is whatever is
    // neither the track nor the page background.
    const filled = countIn(
      after,
      TEMPERATURE_BAR,
      (r, g, b) => !isInstrumentBackgroundPixel(r, g, b),
    );
    expect(filled, "the temperature bar is empty").toBeGreaterThan(200);
  });

  test("injecting a bearing rub loads the machine, and a drive sag caps it (§28, §119)", async ({
    page,
  }) => {
    await openTwin(page);
    // Past the scripted rub, so the manual one is measured against a settled
    // machine rather than against the script's own recovery.
    await runTo(page, 300);

    const healthy = await readStatus(page);
    const parked = await shoot(page);
    const parkedCaliper = centroidY(parked, MACHINE_BAY, isCaliperPixel);
    expect(parkedCaliper, "the caliper is not on screen").not.toBeNaN();

    await clickControl(page, "rub");
    await waitForSimulationSeconds(page, 2.5);

    const rubbing = await readStatus(page);
    const pressed = await shoot(page);
    expect(rubbing["fault"]).toContain("rub");

    // The fault is physical: a §28 slider motor drove the caliper down onto the
    // rotor. Measured as the magenta centroid falling — down the screen is +y —
    // by most of its 0.24 m stroke (probe: ~28 px of 960 × 600).
    expect(
      centroidY(pressed, MACHINE_BAY, isCaliperPixel) - parkedCaliper,
      "the caliper did not travel",
    ).toBeGreaterThan(20);

    // And its consequences are the ones an engineer would predict: the loop
    // pushes the command above the measured speed to hold the setpoint against
    // the drag, and the winding heats.
    expect(Number(rubbing["command"])).toBeGreaterThan(
      Number(rubbing["omega"]) + 3,
    );
    expect(
      Number(rubbing["temperature"]) - Number(healthy["temperature"]),
      "the winding did not warm under load",
    ).toBeGreaterThan(10);

    await clickControl(page, "rub");
    await waitForSimulationSeconds(page, 1.2);
    expect((await readStatus(page))["fault"]).toBe("none");

    // The second fault: a supply sag, expressed as a controller whose actuator
    // ceiling is below the setpoint. The signature is a standing speed error —
    // one no amount of integration can close, and (because §111's own
    // anti-windup is doing the work) one that is stable rather than growing.
    await clickControl(page, "sag");
    await waitForSimulationSeconds(page, 2.5);
    const sagging = await readStatus(page);
    expect(sagging["fault"]).toContain("sag");
    expect(Number(sagging["ceiling"])).toBeCloseTo(SAG_CEILING, 3);
    expect(
      Number(sagging["speederror"]),
      "the sag left no standing speed error",
    ).toBeGreaterThan(5);
    expect(Number(sagging["rpm"])).toBeLessThan(SETPOINT_RPM * 0.75);
  });

  test("pause freezes the frame exactly, and one step is one step (§10)", async ({
    page,
  }) => {
    await openTwin(page);
    await runTo(page, 120);

    await clickControl(page, "pause");
    expect((await readStatus(page))["paused"]).toBe("true");

    const frozen = await shoot(page);
    await waitForFrames(page, framesFor(0.4));
    const stillFrozen = await shoot(page);
    // Exactly zero, not "few": the accumulator stops accumulating, every system
    // sees no fixed step, and the renderer draws the same interpolated pose.
    expect(
      changedIn(stillFrozen, frozen, WHOLE_CANVAS, 0),
      "pause did not freeze the framebuffer",
    ).toBe(0);

    const before = await readStatus(page);
    await clickControl(page, "step");
    const after = await readStatus(page);

    expect(after["substeps"], "the single step ran the wrong step count").toBe(
      "1",
    );
    expect(Number(after["steps"]) - Number(before["steps"])).toBe(1);
    expect(
      Number(after["sim"]) - Number(before["sim"]),
      "one step is one fixedDeltaTime",
    ).toBeCloseTo(FIXED_DELTA_TIME, 3);
    expect(after["paused"], "the step left the twin running").toBe("true");

    const stepped = await shoot(page);
    expect(
      changedIn(stepped, frozen, WHOLE_CANVAS),
      "one fixed step changed nothing on screen",
    ).toBeGreaterThan(20);
  });

  test("the recording seeks, replays and saves — bit for bit (§34, §33, §79)", async ({
    page,
  }) => {
    await openTwin(page);

    // The §34 document is a fixed ten seconds of the machine's life, closed at a
    // frame boundary so its final checksum is the state at the end of a recorded
    // frame.
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLElement>("#status")?.dataset["recording"] ===
        "closed",
      undefined,
      { timeout: 45_000 },
    );
    const recorded = await readStatus(page);
    expect(Number(recorded["recorded"])).toBeGreaterThanOrEqual(RECORD_STEPS);

    await clickControl(page, "audit");
    const audited = await readStatus(page);

    // 1. The seek is exact: the world's §33 checksum after seeking to step 305
    //    equals the checksum the *live* run published when it passed step 305.
    expect(audited["seekchecksum"]).not.toBe("0");
    expect(
      audited["seekmatch"],
      "seeking into the recording did not reproduce the live checksum",
    ).toBe("true");

    // 2. The seek is cheap, which is the entire reason §34 has periodic
    //    snapshots: fewer than one snapshot interval of re-simulation.
    const resimulated = Number(audited["seekresim"]);
    expect(resimulated).toBeGreaterThanOrEqual(0);
    expect(resimulated).toBeLessThan(SNAPSHOT_INTERVAL_STEPS);

    // 3. The replay reproduces the recorded run end to end, and the envelope is
    //    a real, encodable document rather than an in-memory convenience.
    expect(audited["replayverified"]).toBe("true");
    expect(Number(audited["replaybytes"])).toBeGreaterThan(10_000);

    // 4. The audit is a pure read: the live machine is put back exactly.
    expect(
      audited["liverestored"],
      "the audit did not restore the live world",
    ).toBe("true");

    // 5. §79: the scene saves, reloads, and re-saves to the same bytes.
    expect(
      audited["saveroundtrip"],
      "the §79 document did not round-trip byte-identically",
    ).toBe("true");
    expect(Number(audited["savebytes"])).toBeGreaterThan(5_000);
    // A floor against a document that saved nothing, not a pinned count. It was
    // `> 100` until 2026-08-21, when every label became **one** `Text` node
    // instead of one `Sprite` per drawn glyph (R-28): the scene lost sprites and
    // the audit now reports 96. Lowered with that measurement, and deliberately
    // still far above the handful of nodes a broken writer would emit.
    expect(
      Number(audited["savenodes"]),
      "the saved document is suspiciously small",
    ).toBeGreaterThan(80);

    // And the twin keeps running afterwards.
    const before = Number((await readStatus(page))["steps"]);
    await waitForSimulationSeconds(page, 0.6);
    expect(Number((await readStatus(page))["steps"])).toBeGreaterThan(before);
  });

  test("the overlay draws, and the controls are screen-space and reachable (§113, §48, §71, §75)", async ({
    page,
  }) => {
    await openTwin(page);
    await runTo(page, 120);

    const plain = await shoot(page);
    expect(
      countIn(plain, MACHINE_BAY, isOverlayPixel),
      "the overlay was already drawing before it was switched on",
    ).toBe(0);

    await clickControl(page, "overlay");
    expect((await readStatus(page))["overlay"]).toBe("on");
    const overlaid = await shoot(page);
    expect(
      countIn(overlaid, MACHINE_BAY, isOverlayPixel),
      "the overlay drew nothing in the machine bay",
    ).toBeGreaterThan(100);

    await clickControl(page, "overlay");
    expect((await readStatus(page))["overlay"]).toBe("off");

    // §48/§71: the panel is a child of the camera, so it is screen-space, and it
    // is picked by the same ray as everything else. `clickControl` has already
    // verified `data-hover` for every control it pressed; this checks the two it
    // has not.
    const box = await page.locator("#scene").boundingBox();
    expect(box).not.toBeNull();
    if (box === null) return;
    const points = await controlPoints(page);
    for (const name of ["sag", "audit"]) {
      const point = points.get(name);
      if (point === undefined) continue;
      await page.mouse.move(box.x + point.x, box.y + point.y);
      await waitForFrames(page, framesFor(0.15));
      expect((await readStatus(page))["hover"]).toBe(name);
    }
    // Every control the page publishes is inside the canvas and in its right
    // half — which is what "screen-space instrument column" means from outside.
    for (const [name, point] of points) {
      expect(point.x, `${name} is off the canvas`).toBeGreaterThan(
        CANVAS_WIDTH * 0.5,
      );
      expect(point.x).toBeLessThan(CANVAS_WIDTH);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(CANVAS_HEIGHT);
    }

    // §75: the panel is operable without a pointer.
    await focusControl(page, "pause");
    const before = await readStatus(page);
    await page.keyboard.press("Enter");
    await waitForFrames(page, framesFor(0.2));
    const after = await readStatus(page);
    expect(Number(after["activations"])).toBe(
      Number(before["activations"]) + 1,
    );
    expect(
      after["source"],
      "the activation did not come from the keyboard",
    ).toBe("keyboard");
    expect(after["paused"]).toBe("true");
  });
});
