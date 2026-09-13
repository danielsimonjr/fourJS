/**
 * Phase 3 exit evidence: §106's "render **smoothly** despite fixed-step
 * simulation" (WP-3.9).
 *
 * The WP-3.8 gate proves the canvas is not blank and that *something* changes
 * between two frames. Neither answers §106's actual question, which is about
 * the *character* of the change: a render loop that stalls, that skips, or that
 * reads a stale simulation state also makes two frames differ. This suite
 * measures the motion instead of merely detecting it.
 *
 * ## What is measured
 *
 * `examples/first-2d-scene` orbits an orange circle around the world origin on
 * a `CircularTrajectory` — radius 2 world units, ω = π/2 rad/s, XY plane, phase
 * 0 (`examples/first-2d-scene/main.ts`). The camera is an `OrthographicCamera`
 * covering x ∈ [-4, 4], y ∈ [-3, 3], so canvas pixels map back to world units
 * by an affine transform with no perspective term. That makes the orbiter's
 * *world* position recoverable from a screenshot: find the orange pixels,
 * take their centroid, and un-project. A disc's projected centroid is its
 * centre, and the orbiter is never clipped by the viewport and never occluded
 * (the only other geometry is behind it or 3.2 world units away), so the
 * centroid is unbiased.
 *
 * Six equally spaced intervals are then checked for four properties, and a
 * fourth test (below) checks a fifth:
 *
 * 1. **Nothing stalls** — every consecutive frame pair differs in pixels.
 * 2. **The rate is right** — each interval's angular displacement matches
 *    ω × (elapsed wall-clock) to within a factor of {@link RATE_TOLERANCE}.
 *    Both directions matter: too large is a jump (a dropped or double-applied
 *    step), too small is a stutter or a partially stalled loop.
 * 3. **Nothing teleports or freezes** — the six displacements agree with each
 *    other to within {@link UNIFORMITY_TOLERANCE}. Equally spaced samples of a
 *    constant-rate path must sweep equal angles, and unlike (2) this comparison
 *    is unaffected by how long a screenshot takes.
 * 4. **Nothing reverses** — every interval sweeps the same way, and the
 *    centroid stays on the radius-2 circle, so the recovered path really is the
 *    trajectory the scene describes rather than an artefact of the detector.
 *
 * ## Interpolation, and why the last test injects a clock
 *
 * The three properties above would also hold for a renderer that drew the last
 * simulated pose and interpolated nothing — which is the half of §106 that
 * "despite fixed-step simulation" is actually about. Worse, it cannot be
 * observed here by default: this machine's frame rate *equals* the 60 Hz fixed
 * step, so the accumulator's leftover stays near zero and every drawn pose
 * coincides with a simulated one whether or not §43 is wired up.
 *
 * The fourth test therefore makes `requestAnimationFrame` report a virtual
 * clock ticking 1.5 fixed steps per frame — nothing else is stubbed — which
 * forces `interpolationAlpha` to alternate 0.5 and 0.0. The alpha-0.5 frames
 * must then put the orbiter exactly half a step past the last simulated pose,
 * a position the simulation never computes. That is the observable signature of
 * interpolated rendering, and no amount of unit testing over `PoseBuffer` can
 * establish that the assembled application, renderer and GL backend deliver it.
 *
 * The interpolation sampler is **frame-synchronised**, not wall-clock
 * synchronised. A time-spaced screenshot loop aliases against the two-frame
 * alpha cycle: if a consistently even number of virtual frames elapses between
 * captures, every sample lands on the same phase and `midStep` is 0 even
 * though §43 is working. After the clock is installed, the test waits for a
 * known number of rAF callbacks (1, 2, 3, … so both phases appear) and then
 * screenshots. None of this resolves single-frame judder.
 *
 * ## Method notes
 *
 * Nothing here is a golden image. The gate runs on SwiftShader, whose
 * rasterisation differs from a GPU's, so every threshold is a measurement with
 * margin (§92).
 *
 * The PNG decoder is a copy of the one in `example.spec.ts`: Playwright returns
 * an encoded screenshot, comparing compressed bytes would conflate "the picture
 * changed" with "the encoder picked different filters", and neither spec may
 * edit the other under this packet's file scope. The workspace pins no image
 * library and a browser gate must not be the reason one is added.
 */

import { inflateSync } from "node:zlib";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { framesFor, waitForFrames } from "./helpers/wait.js";

declare global {
  interface Window {
    /** rAF callbacks delivered by {@link useVirtualFrameClock}. */
    __fourVirtualFrames?: number;
    /**
     * When true, the injected clock holds the next virtual frame so a
     * screenshot cannot advance `interpolationAlpha` underneath the sampler.
     */
    __fourPauseRaf?: boolean;
    /**
     * The browser's own `requestAnimationFrame`, captured before the virtual
     * clock replaced it. Waits and GPU flushes must use this: pumping the
     * patched function increments `__fourVirtualFrames` without running the
     * example's loop, which aliases the period-2 alpha cycle (even frames
     * only → every sample on-step).
     */
    __fourHostRaf?: typeof requestAnimationFrame;
  }
}

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

function pixelCount(image: DecodedImage): number {
  return image.width * image.height;
}

/** How many distinct colours the image contains. A cleared canvas has one. */
function distinctColors(image: DecodedImage): number {
  const colors = new Set<number>();
  for (let i = 0; i < pixelCount(image); i++) colors.add(colorAt(image, i));
  return colors.size;
}

/** How many pixels differ between two same-sized frames. */
function changedPixels(before: DecodedImage, after: DecodedImage): number {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error("Frames have different sizes.");
  }
  let changed = 0;
  for (let i = 0; i < pixelCount(before); i++) {
    if (colorAt(before, i) !== colorAt(after, i)) changed += 1;
  }
  return changed;
}

async function grab(canvas: Locator): Promise<DecodedImage> {
  return decodePng(await canvas.screenshot());
}

// --- the scene under test ---------------------------------------------------

/*
 * Every constant below restates something `examples/first-2d-scene/main.ts`
 * declares. They are duplicated rather than imported because the point of a
 * browser gate is to check the built page from the outside; importing the
 * example's numbers would let a wrong scene agree with a wrong expectation.
 */

/** `OrthographicCamera` extents, in world units. */
const VIEW_LEFT = -4;
const VIEW_RIGHT = 4;
const VIEW_BOTTOM = -3;
const VIEW_TOP = 3;

/** `CircularTrajectory` centre (world units) and radius. */
const ORBIT_CENTER_X = 0;
const ORBIT_CENTER_Y = 0;
const ORBIT_RADIUS = 2;

/** `CircularTrajectory.angularVelocity`, radians per second. */
const ORBIT_ANGULAR_VELOCITY = Math.PI / 2;

/**
 * `DEFAULT_FIXED_DELTA_TIME` — the simulation step the example leaves at its
 * default, in seconds.
 */
const FIXED_DELTA_SECONDS = 1 / 60;

/**
 * How far the orbiter advances in one fixed step, radians.
 *
 * The whole orbit is `2π / STEP_ANGLE` = 240 steps exactly, so an angle's
 * position *within* a step survives the `atan2` wrap at ±π unchanged — which is
 * what {@link fractionalStep} relies on.
 */
const STEP_ANGLE = ORBIT_ANGULAR_VELOCITY * FIXED_DELTA_SECONDS;

// --- tolerances -------------------------------------------------------------

/**
 * Minimum distinct colours for a frame to count as drawn. A cleared canvas has
 * one; this scene's three flat-shaded shapes plus antialiased edges measure
 * eight to ten. Same threshold, same reasoning, as the WP-3.8 gate.
 */
const MINIMUM_DISTINCT_COLORS = 4;

/**
 * Minimum pixels that must differ between consecutive samples for the frame to
 * count as having moved. In ~150 ms the orbiter sweeps ~0.24 rad along a
 * 200-pixel-radius arc and the tumbler rotates, which measures in the thousands
 * of pixels; 100 sits far below that and far above the zero a stalled loop
 * gives.
 */
const MINIMUM_CHANGED_PIXELS = 100;

/**
 * Fraction of the canvas the orbiter's strongly-orange interior must cover for
 * a centroid to be trusted. The disc is 0.45 world units across a 8 × 6 world
 * view, i.e. ~1.3 % of the pixels; requiring 0.3 % tolerates the antialiased
 * rim being excluded and still rejects a stray orange speck.
 */
const MINIMUM_ORBITER_COVERAGE = 0.003;

/**
 * How far a sample's recovered radius may sit from the trajectory's, in world
 * units. Half a pixel of centroid error is 0.005 world units here, so 0.25
 * is ~50× the measurement floor while still excluding a centroid that has
 * wandered off the path (a quarter of the disc's own diameter).
 */
const RADIUS_TOLERANCE_WORLD = 0.25;

/**
 * Multiplicative slack on each interval's angular displacement, applied to an
 * elapsed-time *bracket* rather than a point estimate (see
 * {@link angleBracketFor}). A factor of 2 is deliberately loose: SwiftShader
 * renders in software on a shared CI CPU, so the browser can miss frames, and
 * the gate is looking for teleports and stalls, not for jitter. A render loop
 * that skips a whole 150 ms sample or double-applies its motion lands well
 * outside it.
 */
const RATE_TOLERANCE = 2;

/**
 * Multiplicative slack on how far one interval's sweep may sit from the median
 * interval's.
 *
 * This is the sharper of the two rate checks and the one that actually catches
 * a jump. {@link angleBracketFor}'s bracket has to span the whole screenshot
 * latency — under SwiftShader a canvas capture costs longer than the wait
 * between samples, so the true spacing is only known to within a factor of
 * three — whereas the samples are all spaced the same way, so their
 * displacements should agree with each other regardless of what that spacing
 * is. One interval that teleported or froze while its neighbours did not shows
 * up here even though the loose absolute bracket would swallow it.
 *
 * Same factor of 2, and for the same reason: this must not fail on a missed
 * frame or two. Measured spread on the reference run was ±8 % of the median.
 */
const UNIFORMITY_TOLERANCE = 2;

/**
 * Virtual frame length used by the interpolation test, as a multiple of the
 * fixed step.
 *
 * 1.5 makes the §10 accumulator's leftover alternate half a step and none:
 * a 1.5-step frame runs one step and keeps 0.5 over, the next brings the total
 * to 2.0 and runs two with nothing over. So `interpolationAlpha` alternates
 * 0.5, 0.0, 0.5, 0.0 …, and every alpha-0.5 frame must draw the orbiter exactly
 * half a step past the last simulated pose — a position no fixed step ever
 * produces.
 */
const VIRTUAL_FRAME_RATIO = 1.5;

/**
 * Window, in fractions of a fixed step, that counts as "drawn between two
 * simulation states".
 *
 * Wide because it only has to exclude the alpha-0 frames: the alternation puts
 * every other sample at 0.5 and the rest at 0.0, and centroid noise is under
 * 0.01 of a step, so anything in the middle 60 % is unambiguously mid-step.
 */
const MID_STEP_LOW = 0.2;
const MID_STEP_HIGH = 0.8;

/**
 * How many of the {@link INTERPOLATION_SAMPLE_COUNT} frames must land mid-step.
 *
 * Half of them should: the sampler now advances one virtual frame at a time,
 * so the 0.5 / 0.0 alternation is *chosen*. Requiring 2 still leaves room for
 * a missed odd frame while remaining impossible for a renderer that snaps to
 * the latest fixed step, which would score 0.
 */
const MINIMUM_MID_STEP_FRAMES = 2;

/** Frames sampled by the interpolation test. */
const INTERPOLATION_SAMPLE_COUNT = 12;

/** Nominal spacing between samples, seconds. */
const SAMPLE_INTERVAL_SECONDS = 0.15;

/** How many samples to take. Six intervals over ~0.9 s, a quarter of a lap. */
const SAMPLE_COUNT = 7;

/** Seconds to keep screenshotting before giving up on a first drawn frame. */
const DRAW_BUDGET_SECONDS = 5;

// --- measurement ------------------------------------------------------------

/** A screenshot plus the wall-clock window its pixels were captured within. */
interface Sample {
  readonly image: DecodedImage;
  /** Milliseconds, before `screenshot()` was called. */
  readonly startedAt: number;
  /** Milliseconds, after `screenshot()` resolved. */
  readonly finishedAt: number;
}

/** World-space position recovered from a sample. */
interface OrbiterFix {
  readonly x: number;
  readonly y: number;
  /** Distance from the orbit centre, world units. */
  readonly radius: number;
  /** `atan2` of the offset from the orbit centre, radians in (-π, π]. */
  readonly angle: number;
  /** Pixels that matched the orbiter's colour. */
  readonly matched: number;
}

/**
 * Whether a pixel is the orbiter's interior.
 *
 * The scene's four colours are the orange orbiter (255, 115, 51), the blue
 * tumbler (64, 179, 255), the dark ground (26, 33, 48) and the darker clear
 * (13, 15, 23) — the shaders write `UnlitMaterial.color` straight to the
 * framebuffer with no tone mapping, so the bytes are the material's components
 * times 255. Requiring a bright red channel that dominates blue by a wide
 * margin selects the orbiter and nothing else, and rejects the rim pixels where
 * antialiasing has mixed orange with the background. Rejecting the rim is
 * wanted: it is symmetric about the disc, so dropping it leaves the centroid
 * where it was and makes the classifier insensitive to how SwiftShader blends.
 */
function isOrbiterPixel(r: number, g: number, b: number): boolean {
  return r >= 180 && r - b >= 90 && g > b;
}

/** Recovers the orbiter's world position from one frame, or `null` if absent. */
function locateOrbiter(image: DecodedImage): OrbiterFix | null {
  if (image.bytesPerPixel < 3) return null;
  let sumX = 0;
  let sumY = 0;
  let matched = 0;
  for (let y = 0; y < image.height; y++) {
    const rowStart = y * image.width * image.bytesPerPixel;
    for (let x = 0; x < image.width; x++) {
      const at = rowStart + x * image.bytesPerPixel;
      if (
        !isOrbiterPixel(
          image.pixels[at],
          image.pixels[at + 1],
          image.pixels[at + 2],
        )
      ) {
        continue;
      }
      sumX += x + 0.5;
      sumY += y + 0.5;
      matched += 1;
    }
  }
  if (matched === 0) return null;

  // Un-project the pixel centroid through the orthographic camera: x runs left
  // to right, y runs bottom to top while image rows run top to bottom.
  const u = sumX / matched / image.width;
  const v = sumY / matched / image.height;
  const x = VIEW_LEFT + u * (VIEW_RIGHT - VIEW_LEFT);
  const y = VIEW_TOP - v * (VIEW_TOP - VIEW_BOTTOM);

  const dx = x - ORBIT_CENTER_X;
  const dy = y - ORBIT_CENTER_Y;
  return {
    x,
    y,
    radius: Math.hypot(dx, dy),
    angle: Math.atan2(dy, dx),
    matched,
  };
}

/**
 * Where an orbiter angle sits inside its fixed step, as a fraction in [0, 1).
 *
 * 0 means the drawn pose is exactly a simulated one; anything else means the
 * draw used a pose the simulation never computed — which is the definition of
 * §43 interpolation. The `atan2` wrap is harmless because a lap is a whole
 * number of steps (see {@link STEP_ANGLE}).
 */
function fractionalStep(angle: number): number {
  const wrapped = angle < 0 ? angle + 2 * Math.PI : angle;
  const steps = wrapped / STEP_ANGLE;
  return steps - Math.floor(steps);
}

/** Median of a non-empty list; the lower of the two middles when even. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1];
}

/** Signed difference between two angles, wrapped into (-π, π]. */
function angleDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  return delta;
}

/**
 * The angular displacement an interval between two samples may show.
 *
 * A screenshot's pixels are captured at an unknown instant inside the
 * `screenshot()` call, so the true gap between two captures is only known to
 * lie between "end of the first call to start of the second" and "start of the
 * first to end of the second". Bracketing keeps screenshot latency — which
 * under software rasterisation is neither small nor constant — out of the
 * tolerance, so {@link RATE_TOLERANCE} covers only the engine's behaviour.
 */
function angleBracketFor(
  before: Sample,
  after: Sample,
): { readonly minimum: number; readonly maximum: number } {
  const shortestSeconds = Math.max(
    0,
    (after.startedAt - before.finishedAt) / 1000,
  );
  const longestSeconds = (after.finishedAt - before.startedAt) / 1000;
  return {
    minimum: (ORBIT_ANGULAR_VELOCITY * shortestSeconds) / RATE_TOLERANCE,
    maximum: ORBIT_ANGULAR_VELOCITY * longestSeconds * RATE_TOLERANCE,
  };
}

// --- page driving -----------------------------------------------------------

/**
 * Opens the example, failing the test on any console error or unhandled
 * rejection the run produces. `favicon.ico` is served rather than 404-ed
 * because the browser requests it unprompted and the example ships none.
 */
async function openExample(page: Page): Promise<readonly string[]> {
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

/**
 * Makes `requestAnimationFrame` report a virtual clock that advances
 * `frameSeconds` per callback, before any of the page's own scripts run.
 *
 * Only the *timestamp* changes: the browser still schedules frames when it
 * likes, still rasterises with SwiftShader, and the example's loop, the
 * fixed-step accumulator, the pose buffer and the GL draw are all untouched
 * production code. Injecting time rather than reading a wall clock is the same
 * discipline §33 imposes on simulation code, and it is the only way to put the
 * render rate at a known ratio to the fixed step on a machine whose real frame
 * rate happens to equal it.
 */
async function useVirtualFrameClock(
  page: Page,
  frameSeconds: number,
): Promise<void> {
  await page.addInitScript((milliseconds: number) => {
    const schedule = globalThis.requestAnimationFrame.bind(globalThis);
    let virtualTime = 0;
    let frames = 0;
    let paused = false;
    Object.defineProperty(globalThis, "__fourVirtualFrames", {
      get: () => frames,
      configurable: true,
    });
    Object.defineProperty(globalThis, "__fourPauseRaf", {
      get: () => paused,
      set(value: boolean) {
        paused = Boolean(value);
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, "__fourHostRaf", {
      value: schedule,
      configurable: true,
    });
    // While paused the host rAF keeps the example's loop alive, but virtual
    // time does not advance. Playwright screenshots take long enough on
    // SwiftShader that an unpaused clock delivers 2+ extra 1.5Δ frames and
    // aliases the period-2 alpha cycle — every sample then lands on-step.
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
      schedule(function pump() {
        if (paused) {
          schedule(pump);
          return;
        }
        virtualTime += milliseconds;
        frames += 1;
        callback(virtualTime);
      });
  }, frameSeconds * 1000);
}

/**
 * Screenshots with the virtual clock held so the PNG encode cannot sneak
 * extra 1.5Δ frames between the wait and the pixels.
 */
async function grabWithClockPaused(
  page: Page,
  canvas: Locator,
): Promise<DecodedImage> {
  await page.evaluate(() => {
    window.__fourPauseRaf = true;
  });
  try {
    // Two host frames let SwiftShader present the last unpaused draw. Must
    // not go through the patched rAF — that would increment the virtual
    // clock (and skip the example's loop) while we are trying to hold it.
    await pumpHostAnimationFrame(page);
    await pumpHostAnimationFrame(page);
    return await grab(canvas);
  } finally {
    await page.evaluate(() => {
      window.__fourPauseRaf = false;
    });
  }
}

/** How many virtual frames the injected clock has delivered. */
async function virtualFrameCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__fourVirtualFrames ?? 0);
}

/**
 * How long {@link waitForVirtualFrameCount} will wait for the next virtual
 * frame before failing. One delivered frame is a browser rAF (~16 ms); fifteen
 * seconds is a hung clock, not a slow runner.
 */
const VIRTUAL_FRAME_WAIT_BUDGET_MS = 15_000;

/**
 * Waits until the injected clock has delivered at least `minimum` virtual
 * frames. Each poll pumps one **host** `requestAnimationFrame` turn so
 * headless SwiftShader advances the example's patched loop between checks
 * without the wait itself incrementing `__fourVirtualFrames`.
 *
 * Playwright's `waitForFunction` (default `polling: "raf"`) deadlocks against
 * this test's `requestAnimationFrame` override — CI hung 120 s on `b55a8c1`
 * even though `page.evaluate` could read `__fourVirtualFrames`. Waiting for
 * `start + 1` avoids parity-matching races when two increments land per pump.
 *
 * Pumping the *patched* rAF (2026-09-09, `d2f36a5`) added one extra virtual
 * frame per sample on top of the example's own loop. Combined with pause-
 * during-grab that produced only even frame numbers — alpha 0.0 every time.
 */
async function waitForVirtualFrameCount(
  page: Page,
  minimum: number,
): Promise<number> {
  const deadline = Date.now() + VIRTUAL_FRAME_WAIT_BUDGET_MS;
  while (Date.now() < deadline) {
    const n = await virtualFrameCount(page);
    if (n >= minimum) {
      return n;
    }
    await pumpHostAnimationFrame(page);
  }
  const stuck = await virtualFrameCount(page);
  throw new Error(
    `virtual frame ${String(minimum)} not reached within ${String(VIRTUAL_FRAME_WAIT_BUDGET_MS / 1000)} s ` +
      `(stuck at ${String(stuck)})`,
  );
}

/** One real display frame, bypassing the virtual clock. */
async function pumpHostAnimationFrame(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const host = window.__fourHostRaf;
        if (host === undefined) {
          requestAnimationFrame(() => resolve());
          return;
        }
        host(() => resolve());
      }),
  );
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

/**
 * Takes {@link SAMPLE_COUNT} timestamped screenshots ~{@link
 * SAMPLE_INTERVAL_SECONDS} apart.
 *
 * The wait is measured from the end of the previous capture, so a slow
 * screenshot lengthens the interval rather than eating it — the bracket in
 * {@link angleBracketFor} then accounts for the real spacing.
 */
async function collectSamples(
  page: Page,
  canvas: Locator,
): Promise<readonly Sample[]> {
  const samples: Sample[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    if (i > 0) await waitForFrames(page, framesFor(SAMPLE_INTERVAL_SECONDS));
    const startedAt = Date.now();
    const image = await grab(canvas);
    samples.push({ image, startedAt, finishedAt: Date.now() });
  }
  return samples;
}

// --- tests ------------------------------------------------------------------

test.describe("§106: moving primitives render smoothly under fixed-step simulation", () => {
  test("motion never stalls: six consecutive ~150 ms frame pairs all differ", async ({
    page,
  }) => {
    const errors = await openExample(page);
    const canvas = page.locator("#scene");
    await expect(canvas).toBeVisible();
    await waitForDrawnFrame(canvas);

    const samples = await collectSamples(page, canvas);
    expect(samples).toHaveLength(SAMPLE_COUNT);

    const differences = samples
      .slice(1)
      .map((sample, index) =>
        changedPixels(samples[index].image, sample.image),
      );
    console.log(`changed pixels per interval: ${differences.join(", ")}`);

    for (const [index, changed] of differences.entries()) {
      expect(
        changed,
        `interval ${String(index)} is frozen — the render or simulation loop stalled`,
      ).toBeGreaterThanOrEqual(MINIMUM_CHANGED_PIXELS);
    }
    // A loop that throws part-way through still produces differing frames for a
    // while, so the error log is part of this test's verdict.
    expect(errors).toEqual([]);
  });

  test("motion is continuous: each interval's angular displacement matches ω × elapsed", async ({
    page,
  }) => {
    const errors = await openExample(page);
    const canvas = page.locator("#scene");
    await expect(canvas).toBeVisible();
    const first = await waitForDrawnFrame(canvas);
    expect(
      distinctColors(first),
      "canvas never drew, so there is no motion to measure",
    ).toBeGreaterThanOrEqual(MINIMUM_DISTINCT_COLORS);

    const samples = await collectSamples(page, canvas);

    // 1. The orbiter is findable and on its circle in every sample.
    const fixes = samples.map((sample, index) => {
      const fix = locateOrbiter(sample.image);
      expect(
        fix,
        `sample ${String(index)}: no orange orbiter pixels — the scene lost its 2D primitive`,
      ).not.toBeNull();
      const found = fix as OrbiterFix;
      const coverage = found.matched / pixelCount(sample.image);
      expect(
        coverage,
        `sample ${String(index)}: only ${String(found.matched)} orange pixels, too few to trust as the orbiter`,
      ).toBeGreaterThanOrEqual(MINIMUM_ORBITER_COVERAGE);
      expect(
        Math.abs(found.radius - ORBIT_RADIUS),
        `sample ${String(index)}: recovered radius ${found.radius.toFixed(3)} is not the trajectory's ${String(ORBIT_RADIUS)}`,
      ).toBeLessThanOrEqual(RADIUS_TOLERANCE_WORLD);
      return found;
    });

    console.log(
      `orbiter positions (world): ${fixes
        .map(
          (f) =>
            `(${f.x.toFixed(3)}, ${f.y.toFixed(3)}) r=${f.radius.toFixed(3)} θ=${f.angle.toFixed(4)}`,
        )
        .join(" | ")}`,
    );

    // 2. Each interval's sweep is within RATE_TOLERANCE of ω × elapsed.
    const deltas: number[] = [];
    for (let i = 1; i < fixes.length; i++) {
      const delta = angleDelta(fixes[i - 1].angle, fixes[i].angle);
      const bracket = angleBracketFor(samples[i - 1], samples[i]);
      const elapsedMs = samples[i].finishedAt - samples[i - 1].startedAt;
      console.log(
        `interval ${String(i - 1)}: Δθ=${delta.toFixed(4)} rad over ≤${String(elapsedMs)} ms, ` +
          `allowed [${bracket.minimum.toFixed(4)}, ${bracket.maximum.toFixed(4)}]`,
      );
      expect(
        Math.abs(delta),
        `interval ${String(i - 1)}: swept ${delta.toFixed(4)} rad, less than ω × elapsed / ${String(RATE_TOLERANCE)} — the loop stuttered or stalled`,
      ).toBeGreaterThanOrEqual(bracket.minimum);
      expect(
        Math.abs(delta),
        `interval ${String(i - 1)}: swept ${delta.toFixed(4)} rad, more than ω × elapsed × ${String(RATE_TOLERANCE)} — the orbiter teleported`,
      ).toBeLessThanOrEqual(bracket.maximum);
      deltas.push(delta);
    }

    // 3. Equally spaced samples sweep equal angles — the sharp check for a
    //    single interval that jumped or froze while its neighbours did not.
    const magnitudes = deltas.map((d) => Math.abs(d));
    const typical = median(magnitudes);
    console.log(
      `median interval sweep ${typical.toFixed(4)} rad ` +
        `(implied spacing ${(typical / ORBIT_ANGULAR_VELOCITY).toFixed(3)} s); ` +
        `spread ${magnitudes.map((m) => `${(((m - typical) / typical) * 100).toFixed(1)}%`).join(", ")}`,
    );
    for (const [index, magnitude] of magnitudes.entries()) {
      expect(
        magnitude,
        `interval ${String(index)} swept ${magnitude.toFixed(4)} rad against a median of ${typical.toFixed(4)} — the motion is not uniform`,
      ).toBeGreaterThanOrEqual(typical / UNIFORMITY_TOLERANCE);
      expect(
        magnitude,
        `interval ${String(index)} swept ${magnitude.toFixed(4)} rad against a median of ${typical.toFixed(4)} — the orbiter jumped`,
      ).toBeLessThanOrEqual(typical * UNIFORMITY_TOLERANCE);
    }

    // 4. The sweep never reverses: a sign flip would mean the recovered path is
    //    an artefact, or that the simulation ran time backwards.
    const forward = deltas.filter((d) => d > 0).length;
    expect(
      forward,
      `the orbit changed direction: ${deltas.map((d) => d.toFixed(4)).join(", ")}`,
    ).toBe(deltas.length);

    expect(errors).toEqual([]);
  });

  test("frames are drawn between simulation states, not snapped to them", async ({
    page,
  }) => {
    // Report frames at 1.5x the fixed step, so `interpolationAlpha` alternates
    // 0.5 and 0.0 no matter what the machine's real refresh rate is. Without
    // this the two rates are equal here and alpha never leaves ~0, which is
    // exactly the case §106's "despite fixed-step simulation" is not about.
    // Samples are taken after 1, 2, 3, … virtual frames — not after a wall-clock
    // interval — so the phase is chosen instead of inherited.
    await useVirtualFrameClock(page, VIRTUAL_FRAME_RATIO * FIXED_DELTA_SECONDS);
    const errors = await openExample(page);
    const canvas = page.locator("#scene");
    await expect(canvas).toBeVisible();
    await waitForDrawnFrame(canvas);

    expect(
      await virtualFrameCount(page),
      "the injected virtual clock never delivered a frame",
    ).toBeGreaterThan(0);

    const fractions: number[] = [];
    const frameNumbers: number[] = [];
    for (let i = 0; i < INTERPOLATION_SAMPLE_COUNT; i++) {
      // One new virtual frame per sample — consecutive counts alternate parity,
      // so both alpha 0.5 and 0.0 appear without a wall-clock alias. The wait
      // pumps host rAF so it cannot increment the virtual clock itself (that
      // plus pause produced even frames only on `d2f36a5`). The screenshot is
      // taken with the clock paused: otherwise SwiftShader encode time advances
      // 1.5Δ frames and a stable stride of 3 aliases every sample onto an
      // on-step pose (the 2026-09-08 same-commit flake).
      const start = await virtualFrameCount(page);
      frameNumbers.push(await waitForVirtualFrameCount(page, start + 1));
      const image = await grabWithClockPaused(page, canvas);
      const fix = locateOrbiter(image);
      expect(
        fix,
        `sample ${String(i)}: no orange orbiter pixels to measure`,
      ).not.toBeNull();
      const found = fix as OrbiterFix;
      // The sub-step reading is only meaningful if the centroid really is the
      // orbiter, so re-run the same identity checks the continuity test makes.
      expect(
        found.matched / pixelCount(image),
        `sample ${String(i)}: only ${String(found.matched)} orange pixels, too few to trust as the orbiter`,
      ).toBeGreaterThanOrEqual(MINIMUM_ORBITER_COVERAGE);
      expect(
        Math.abs(found.radius - ORBIT_RADIUS),
        `sample ${String(i)}: recovered radius ${found.radius.toFixed(3)} is not the trajectory's ${String(ORBIT_RADIUS)}`,
      ).toBeLessThanOrEqual(RADIUS_TOLERANCE_WORLD);
      fractions.push(fractionalStep(found.angle));
    }

    const midStep = fractions.filter(
      (f) => f >= MID_STEP_LOW && f <= MID_STEP_HIGH,
    ).length;
    console.log(
      `virtual frames: ${frameNumbers.join(", ")}; ` +
        `position within fixed step: ${fractions.map((f) => f.toFixed(3)).join(", ")}`,
    );
    console.log(
      `frames drawn strictly between simulation states: ${String(midStep)}/${String(INTERPOLATION_SAMPLE_COUNT)}`,
    );
    const status = page.locator("#status");
    console.log(
      `clock diagnostics: alpha=${(await status.getAttribute("data-alpha")) ?? "?"} ` +
        `dropped=${(await status.getAttribute("data-dropped")) ?? "?"} ` +
        `substeps=${(await status.getAttribute("data-substeps")) ?? "?"}`,
    );

    expect(
      midStep,
      `every frame landed on an exact fixed-step pose — the draw is snapping to the ` +
        `simulation instead of interpolating (§43), so motion would judder whenever ` +
        `the display rate and the fixed step disagree`,
    ).toBeGreaterThanOrEqual(MINIMUM_MID_STEP_FRAMES);
    expect(errors).toEqual([]);
  });
});
