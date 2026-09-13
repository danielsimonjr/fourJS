/**
 * Phase 9 browser gate: §112's particle demonstration, measured from outside the
 * page (plan §6h, WP-9.4).
 *
 * §112 asks for *"≥100,000 simple particles simulated and rendered at
 * interactive rates on suitable hardware"*, and plan §6h splits that honestly
 * for this environment: the 100 000-particle **CPU** cost is measured headlessly
 * and recorded by `benchmarks/particles-100k.mjs`, never asserted on wall time
 * in CI; the **rendering** half — one batched draw call per system — is pinned
 * structurally by `@fourjs/render`'s and `@fourjs/render-webgl`'s suites; and *this*
 * file answers the remaining question, which neither of those can: does a
 * particle system actually reach a real WebGL 2 framebuffer, keep moving, obey
 * §36's collision plane, and respond to a user?
 *
 * It runs against `examples/particles-demo` at a size SwiftShader can sustain
 * (~1 800 live particles, plan §6h), not at 100 000. That substitution is the
 * whole of the interpretation, and it is stated rather than hidden: a software
 * rasteriser with no GPU is not "suitable hardware", and a CI gate that asserted
 * 100 000 particles at 60 fps on one would be measuring the rasteriser.
 *
 * R-33's **simulate / present split** has landed on `#status` (`data-simulate`
 * and `data-present`, seconds, §7a). This file asserts those attributes exist,
 * are finite, are non-negative, and are **two attributes** — not one folded
 * number, and **not** a 16.6 ms / 60 fps budget. §112's exit still needs a
 * run on non-SwiftShader hardware.
 *
 * ```text
 * page load → WebGL 2 context → ParticleSystem (§39 priority 500)
 *   → ParticleEmitter.step(fixedDeltaTime) → §27 fields → plane collision
 *   → buildRenderList repacks instances → 1 drawArraysInstanced per system → pixels
 *                                   ↑
 *   Chromium mouse → pointerdown → burstEmitter.emit(900)
 * ```
 *
 * ## The fifth site
 *
 * This spec drives a **fifth** server: `playwright.config.ts` runs one
 * `vite preview` per built example, `first-2d-scene` on 4173 (the suite's
 * `baseURL`), `physics-playground` on 4174, `mechanism` on 4175, `blending` on
 * 4176 and `particles-demo` on 4177. {@link PARTICLES_URL} restates that port
 * for the reason the scene constants below are restated rather than imported —
 * see "Method notes". Run `bun run particles-demo:build` before
 * `bun run test:browser`, or the preview server has no `dist` to serve.
 *
 * The site is deliberately the cheap tier: no physics package, therefore no
 * WebAssembly image, ~19 kB gzip of JavaScript. Plan §6h weighed a fifth
 * web server against adding a gated region to the playground and chose the
 * fifth server *because* it could be this small.
 *
 * ## What is measured, and against what
 *
 * | test | § | assertion |
 * | ---- | - | --------- |
 * | loads | §45, §61 | `#status` reaches `data-state="running"`, the drawing buffer is non-zero, and no console error or unhandled rejection is recorded |
 * | simulates | §36 | the live count settles into a band around `emissionRate × mean lifetime`, and **no spawn is ever dropped** |
 * | draws and moves | §36, §64 | thousands of warm (fountain-coloured) pixels are on screen, and two frames 300 ms apart differ over a large area |
 * | collides | §36 | every warm pixel stays **above** the collision plane's row — the fountain rests on its floor instead of falling out of the world |
 * | burst | §36 | before a click there is not one cool (burst-coloured) pixel; a click raises `data-bursts`, puts 900 particles in the burst pool, and paints thousands of cool pixels; and the burst then **expires** on its own |
 * | simulate vs present | R-33 | `#status` publishes `data-simulate` and `data-present` as two finite, non-negative **seconds**; they are distinct attributes. **No** 16.6 ms / 60 fps assertion — SwiftShader is not suitable hardware; §112's exit is not claimed |
 *
 * Every threshold below states the number the WP-9.4 probe measured and the
 * margin it leaves. Nothing here is a golden image: the gate runs on
 * SwiftShader, whose rasterisation differs from a GPU's, so every assertion is a
 * measurement with margin (§92).
 *
 * ## Method notes
 *
 * The scene's numbers are **restated** from the example rather than imported,
 * for the reason every other spec here gives: a browser gate checks the built
 * page from the outside, and importing the example's constants would let a wrong
 * scene agree with a wrong expectation.
 *
 * The PNG decoder is a copy of `example.spec.ts`'s, as in every other spec here:
 * Playwright returns an encoded screenshot, comparing compressed bytes would
 * conflate "the picture changed" with "the encoder picked different filters",
 * the workspace pins no image library, and this packet's file scope forbids
 * editing a sibling spec to share one.
 *
 * **The instrument is slower than the effect.** One `canvas.screenshot()` costs
 * about 284 ms under SwiftShader at 800 × 600 (measured), so a burst that lived
 * half a second would be a race between the effect and the camera rather than a
 * test of the effect. Two things follow, and both are design rather than
 * tolerance: the example's burst lifetime is 1.6–2.4 s, and the burst assertion
 * **polls** — it screenshots until the cool pixels appear or a budget expires,
 * and asserts on the peak — instead of sleeping a guessed interval and
 * screenshotting once.
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

// ---------------------------------------------------------------------------
// The scene, restated (see "Method notes")
// ---------------------------------------------------------------------------

/** `examples/particles-demo`, the fifth `webServer` of `playwright.config.ts`. */
const PARTICLES_URL = "http://localhost:4177/";

/** Canvas size in CSS pixels, and the world the orthographic camera shows. */
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PIXELS_PER_UNIT = 100;

/** World `y` of the fountain's collision plane (§36 collision, MVP tier). */
const FLOOR_Y = -2.4;

/** `py = (3 − y) × 100` — the example's documented pixel map. */
function pixelY(worldY: number): number {
  return (CANVAS_HEIGHT / 2 / PIXELS_PER_UNIT - worldY) * PIXELS_PER_UNIT;
}

/** The screenshot row the collision plane sits on: `py(−2.4) = 540`. */
const FLOOR_ROW = pixelY(FLOOR_Y);

/**
 * Rows below the floor that a warm pixel may still occupy.
 *
 * A particle is drawn as a screen-aligned quad of its *current* size centred on
 * its position, so a particle resting exactly on the plane paints up to half a
 * quad below it: 0.075 world units at spawn is 7.5 px, so 4 px below the plane's
 * row. The probe measured the lowest warm pixel at row 543, three below the
 * floor's 540; 20 is a wide margin that still fails loudly if the plane stops
 * holding and the spray drains off the bottom of the canvas (row 599).
 */
const FLOOR_PIXEL_TOLERANCE = 20;

/** Fountain steady state: `emissionRate 900 × mean lifetime 2 s` ≈ 1 800. */
const EXPECTED_LIVE_PARTICLES = 1800;

/** Particles one click emits, and the pool that holds them. */
const BURST_COUNT = 900;

// ---------------------------------------------------------------------------
// Pixel classifiers (see the example's "colour discipline")
// ---------------------------------------------------------------------------

/**
 * A **fountain** pixel: bright red, and red leading blue by a wide margin.
 *
 * The fountain ramps warm-yellow → red and the burst ramps cyan → blue, so the
 * two classifiers cannot both fire on one pixel. The background is `13, 15, 20`
 * — blue *ahead* of red by 7 — so no unlit pixel is warm however a particle
 * fades into it.
 */
function isFountainPixel(r: number, g: number, b: number): boolean {
  void g;
  return r >= 90 && r - b >= 45;
}

/** A **burst** pixel: bright blue, and blue leading red by the same margin. */
function isBurstPixel(r: number, g: number, b: number): boolean {
  void g;
  return b >= 90 && b - r >= 45;
}

/** What one frame contains, by classifier. */
interface FrameStats {
  /** Pixels matching {@link isFountainPixel}. */
  readonly fountain: number;
  /** Pixels matching {@link isBurstPixel}. */
  readonly burst: number;
  /** Lowest (largest-`y`) row holding a fountain pixel, or `-1`. */
  readonly lowestFountainRow: number;
}

function measure(image: DecodedImage): FrameStats {
  let fountain = 0;
  let burst = 0;
  let lowestFountainRow = -1;
  const stride = image.bytesPerPixel;
  for (let y = 0; y < image.height; y++) {
    const rowStart = y * image.width * stride;
    for (let x = 0; x < image.width; x++) {
      const at = rowStart + x * stride;
      const r = image.pixels[at];
      const g = image.pixels[at + 1];
      const b = image.pixels[at + 2];
      if (isFountainPixel(r, g, b)) {
        fountain += 1;
        if (y > lowestFountainRow) lowestFountainRow = y;
      } else if (isBurstPixel(r, g, b)) {
        burst += 1;
      }
    }
  }
  return { fountain, burst, lowestFountainRow };
}

/** How many pixels differ between two same-sized frames. */
function changedPixels(before: DecodedImage, after: DecodedImage): number {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error("Frames have different sizes.");
  }
  let changed = 0;
  const stride = before.bytesPerPixel;
  for (let i = 0; i < before.width * before.height; i++) {
    const at = i * stride;
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

async function grab(canvas: Locator): Promise<DecodedImage> {
  return decodePng(await canvas.screenshot());
}

// ---------------------------------------------------------------------------
// Thresholds — each states the probe's measurement and the margin it leaves
// ---------------------------------------------------------------------------

/**
 * Fountain pixels a running frame must hold.
 *
 * The probe measured 21 972 … 22 608 across eight steady frames. 6 000 is
 * roughly a quarter of that — far below anything the simulation produces, far
 * above the zero a stalled loop or an unbound instance buffer gives.
 */
const MINIMUM_FOUNTAIN_PIXELS = 6_000;

/**
 * Pixels that must differ between two frames 300 ms apart.
 *
 * The probe measured 34 052 over 250 ms. 2 000 is 6 % of that and still
 * unreachable by a static image (a stalled loop changes nothing at all).
 */
const MINIMUM_CHANGED_PIXELS = 2_000;

/**
 * Burst pixels a click must produce, at the peak of the polling window.
 *
 * The probe measured a peak of 33 191 and 10 600 in the *first* screenshot after
 * the click (which lands ~500 ms late purely because of screenshot latency).
 * 4 000 is below even that first sample.
 */
const MINIMUM_BURST_PIXELS = 4_000;

/**
 * Burst pixels tolerated once the burst pool has drained.
 *
 * The probe measured exactly 0 with the pool empty, and 3 while 435 particles
 * were still alive but faded and mostly below the canvas. 100 distinguishes
 * "the burst expired" from "the burst is still on screen" without pinning a
 * software rasteriser to the byte.
 */
const MAXIMUM_RESIDUAL_BURST_PIXELS = 100;

/** Seconds to keep screenshotting while waiting for the burst to appear. */
const BURST_POLL_SECONDS = 4;

/** Seconds between the two frames the motion test compares. */
const FRAME_GAP_SECONDS = 0.3;

// ---------------------------------------------------------------------------
// Page plumbing
// ---------------------------------------------------------------------------

/** Errors seen since the page was created, in the order the browser saw them. */
type ErrorLog = readonly string[];

/** The `#status` element's data attributes, as the page publishes them. */
interface StatusData {
  state?: string;
  fountain?: string;
  burst?: string;
  bursts?: string;
  frames?: string;
  dropped?: string;
  /**
   * Wall-clock seconds of particle integration for the last host frame's
   * fixed-step burst (R-33). Distinct from {@link StatusData.present}.
   */
  simulate?: string;
  /**
   * Wall-clock seconds of list + upload + draw for the last host frame
   * (R-33). Distinct from {@link StatusData.simulate}.
   */
  present?: string;
}

async function readStatus(page: Page): Promise<StatusData> {
  return page
    .locator("#status")
    .evaluate((element: HTMLElement) => Object.assign({}, element.dataset));
}

/** A `#status` number, or `NaN` when the attribute is missing. */
function statusNumber(value: string | undefined): number {
  return value === undefined ? Number.NaN : Number(value);
}

/**
 * Opens the demo, waits until it is running with particles alive, and returns
 * the page's live error log.
 *
 * `favicon.ico` is served rather than 404-ed, for `example.spec.ts`'s reason:
 * the browser asks for it on its own, the example ships none, and the resulting
 * console error would otherwise need an allowlist that would also excuse a real
 * 404.
 */
async function openDemo(page: Page): Promise<ErrorLog> {
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
  await page.goto(PARTICLES_URL, { waitUntil: "load" });

  // Readiness is the page's own claim, not a sleep: `data-state` flips to
  // "running" after the first completed `app.step` (fixed steps + draw), and
  // `data-fountain` is non-zero once the emitter has actually spawned. The
  // probe measured 126 ms; 20 s is the budget for a cold software-GL start.
  await page.waitForFunction(
    () => {
      const status = document.querySelector<HTMLElement>("#status");
      return (
        status?.dataset["state"] === "running" &&
        Number(status.dataset["fountain"] ?? "0") > 0
      );
    },
    undefined,
    { timeout: 20_000 },
  );
  return errors;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("examples/particles-demo (§112, §36)", () => {
  test("loads onto a real WebGL 2 surface without console or page errors", async ({
    page,
  }) => {
    const errors = await openDemo(page);
    const canvas = page.locator("#scene");
    await expect(canvas).toBeVisible();

    const drawingBuffer = await canvas.evaluate(
      (element: HTMLCanvasElement) => ({
        width: element.width,
        height: element.height,
      }),
    );
    // `renderer.resize(800, 600, devicePixelRatio)` ran, so the drawing buffer
    // is at least the CSS size.
    expect(drawingBuffer.width).toBeGreaterThanOrEqual(CANVAS_WIDTH);
    expect(drawingBuffer.height).toBeGreaterThanOrEqual(CANVAS_HEIGHT);

    // A render loop fails on its first frames, not on first paint: keep the page
    // alive long enough for a throw in `step`/`render` to be recorded.
    await waitForFrames(page, framesFor(FRAME_GAP_SECONDS));
    expect(errors).toEqual([]);
  });

  test("simulates a steady population and never drops a spawn (§36)", async ({
    page,
  }) => {
    await openDemo(page);
    // Two mean lifetimes in, the population is at its steady state rather than
    // still filling.
    await waitForFrames(page, framesFor(4));

    const status = await readStatus(page);
    const live = statusNumber(status.fountain);

    // `emissionRate × mean lifetime = 900 × 2 = 1800`; the probe measured
    // 1 803 … 1 811. The band is deliberately wide — it is checking that the
    // emitter reached *a* steady state, not reproducing its arithmetic, which
    // `packages/particles/tests/emitter.test.ts` already pins exactly.
    expect(live).toBeGreaterThan(EXPECTED_LIVE_PARTICLES * 0.6);
    expect(live).toBeLessThan(EXPECTED_LIVE_PARTICLES * 1.4);

    // The pools are sized with headroom, so a dropped spawn means the page is
    // not simulating what it claims to (the emitter counts them; it never
    // fails silently).
    expect(statusNumber(status.dropped)).toBe(0);

    // The loop is really running at frame rate, not stepping once.
    expect(statusNumber(status.frames)).toBeGreaterThan(30);
  });

  test("draws the fountain and keeps it moving", async ({ page }) => {
    await openDemo(page);
    await waitForFrames(page, framesFor(3));

    const first = await grab(page.locator("#scene"));
    const firstStats = measure(first);
    expect(
      firstStats.fountain,
      "the fountain drew nothing — the batched particle draw never reached the framebuffer",
    ).toBeGreaterThanOrEqual(MINIMUM_FOUNTAIN_PIXELS);

    await waitForFrames(page, framesFor(FRAME_GAP_SECONDS));
    const second = await grab(page.locator("#scene"));

    expect(
      changedPixels(first, second),
      "the scene is static — the fixed-step loop, the repack, or the render loop stalled",
    ).toBeGreaterThanOrEqual(MINIMUM_CHANGED_PIXELS);
  });

  test("the collision plane holds the spray up (§36 collision, MVP tier)", async ({
    page,
  }) => {
    await openDemo(page);
    await waitForFrames(page, framesFor(3));

    const stats = measure(await grab(page.locator("#scene")));
    expect(stats.fountain).toBeGreaterThanOrEqual(MINIMUM_FOUNTAIN_PIXELS);

    // Without `collisionPlaneY` the spray would fall past row 540 and drain off
    // the bottom of the canvas (row 599) within a second. With it, the lowest
    // fountain pixel is the bottom edge of a quad resting on the plane — the
    // probe measured row 543 against the plane's 540.
    expect(
      stats.lowestFountainRow,
      "the fountain fell through its collision plane",
    ).toBeLessThanOrEqual(FLOOR_ROW + FLOOR_PIXEL_TOLERANCE);
    expect(stats.lowestFountainRow).toBeGreaterThan(0);
  });

  test("a click bursts, and the burst expires on its own (§36 bursts)", async ({
    page,
  }) => {
    await openDemo(page);
    const canvas = page.locator("#scene");
    await waitForFrames(page, framesFor(3));

    // The burst emitter has `emissionRate: 0`, so before a click there is not
    // one burst-coloured pixel anywhere — which is also what makes the
    // classifier's separation of the two systems a measurement rather than an
    // assumption.
    const before = measure(await grab(canvas));
    expect(before.burst).toBe(0);
    const beforeStatus = await readStatus(page);
    expect(statusNumber(beforeStatus.bursts)).toBe(0);
    expect(statusNumber(beforeStatus.burst)).toBe(0);

    await canvas.click({
      position: { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 },
    });

    // The engine's own account of the click. Waited for rather than read
    // immediately, and the distinction is a real property of the page rather
    // than flake tolerance: `emit()` happens in the `pointerdown` listener, but
    // `#status` is rewritten after `app.step` returns — once per host frame.
    // So between the click returning and the next frame publishing, the DOM
    // still says zero bursts. One frame under SwiftShader is tens of
    // milliseconds against a burst lifetime of 1.6 s, so the count read
    // afterwards is still the full 900.
    await page.waitForFunction(
      () =>
        Number(
          document.querySelector<HTMLElement>("#status")?.dataset["bursts"] ??
            "0",
        ) === 1,
      undefined,
      { timeout: 10_000 },
    );
    const clicked = await readStatus(page);
    expect(statusNumber(clicked.bursts)).toBe(1);
    expect(statusNumber(clicked.burst)).toBe(BURST_COUNT);

    // …and the pixels' account of the same click. Polled rather than slept: one
    // screenshot costs ~284 ms here, so the peak is found by sampling, and the
    // *peak* is what is asserted.
    let peakBurstPixels = 0;
    const deadline = Date.now() + BURST_POLL_SECONDS * 1000;
    while (Date.now() < deadline) {
      const stats = measure(await grab(canvas));
      if (stats.burst > peakBurstPixels) peakBurstPixels = stats.burst;
      if (peakBurstPixels >= MINIMUM_BURST_PIXELS) break;
    }
    expect(
      peakBurstPixels,
      "the burst never reached the framebuffer",
    ).toBeGreaterThanOrEqual(MINIMUM_BURST_PIXELS);

    // §36 lifetimes: the burst is a burst, not a leak. Wait for the pool to
    // drain — the longest lifetime is 2.4 s — and confirm the screen agrees.
    await page.waitForFunction(
      () =>
        Number(
          document.querySelector<HTMLElement>("#status")?.dataset["burst"] ??
            "1",
        ) === 0,
      undefined,
      { timeout: 15_000 },
    );
    const after = measure(await grab(canvas));
    expect(after.burst).toBeLessThanOrEqual(MAXIMUM_RESIDUAL_BURST_PIXELS);

    // The fountain never stopped while all that happened.
    expect(after.fountain).toBeGreaterThanOrEqual(MINIMUM_FOUNTAIN_PIXELS);
  });

  test("publishes simulate and present as separate finite seconds (R-33 split; no fps budget)", async ({
    page,
  }) => {
    await openDemo(page);

    // After `openDemo` the first completed `app.step` has already written both
    // attributes. Read the raw attribute *names* as well as the values — the
    // whole of the assertion is that the split exists and is honest, not that
    // it beats 16.6 ms.
    const published = await page.locator("#status").evaluate((element) => ({
      names: [...element.attributes]
        .map((attribute) => attribute.name)
        .filter((name) => name.startsWith("data-")),
      simulate: element.getAttribute("data-simulate"),
      present: element.getAttribute("data-present"),
    }));
    expect(
      published.names.includes("data-simulate"),
      "data-simulate is missing — the R-33 split did not land",
    ).toBe(true);
    expect(
      published.names.includes("data-present"),
      "data-present is missing — present was folded into simulate, or not published",
    ).toBe(true);
    expect(
      published.names.indexOf("data-simulate"),
      "simulate and present must be two attributes, not one name",
    ).not.toBe(published.names.indexOf("data-present"));

    const simulate = statusNumber(published.simulate ?? undefined);
    const present = statusNumber(published.present ?? undefined);
    expect(Number.isFinite(simulate), `data-simulate=${published.simulate ?? ""}`).toBe(
      true,
    );
    expect(Number.isFinite(present), `data-present=${published.present ?? ""}`).toBe(
      true,
    );
    expect(simulate).toBeGreaterThanOrEqual(0);
    expect(present).toBeGreaterThanOrEqual(0);

    // Deliberately no `toBeLessThan(1 / 60)` (or 16.6 ms). This gate runs on
    // SwiftShader. §112's "interactive rates on suitable hardware" exit is
    // not claimed here.
  });
});
