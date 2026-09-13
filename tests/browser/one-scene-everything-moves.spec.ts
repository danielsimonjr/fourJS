/**
 * Browser gate for **§118's flagship demonstration**, `examples/flagship/
 * one-scene-everything-moves` (2026-08-07, `docs/AUDIT-120.md` S-8).
 *
 * §118 asks for one scene containing a rotating 3D cube, a 2D vector orbit, a
 * spring-connected pendulum, a bouncing rigid body, a world-space label, a
 * screen-space control panel, a timeline, a motorised hinge, collision events,
 * and pause / slow-motion / single-step controls — and states its success
 * criterion as a *feeling*: "it must feel like one motion-capable engine, not a
 * graphics library with physics bolted on afterward". A feeling cannot be
 * asserted, so this file measures the two things that produce it:
 *
 * 1. **Everything is in the same frame.** Each object owns a hue, and one
 *    screenshot is counted object by object. A page that drew the 3D scene but
 *    lost the 2D art, the particles or the text fails on a count, not on a
 *    class name.
 * 2. **Everything moves, on one clock, and the clock is controllable.** Pixels
 *    change while running; pause freezes them *exactly* (the measured number is
 *    zero); one single-step advances simulation time by exactly one
 *    `fixedDeltaTime` and changes the picture; the slider's slow motion changes
 *    the *rate* at which simulated time accumulates. All four are properties of
 *    §10's accumulator, not of any one system.
 *
 * ```text
 *  registerWebglRenderer() ─┐                       ┌─ MotionSystem   cube, orbit
 *  registerRapierSolver()  ─┤                       ├─ AnimationSystem timeline
 *                           ├─ Application.step ────┼─ ParticleSystem  embers, sparks
 *  renderer: "auto" ────────┤   §10 accumulator     ├─ PhysicsSystem   Rapier 3D
 *  solver:   "auto" ────────┘                       └─ PoseBuffer      §43 capture
 *                                   │
 *                                   └── renderer.render(scene, views, alpha) → pixels
 * ```
 *
 * ## What is measured, and why each measurement is falsifiable
 *
 * | test | § | assertion |
 * | ---- | - | --------- |
 * | loads | §45, §62, §37 | `#status` reaches `running`; the page reports the backend and solver the registries *chose* (`webgl2`, `rapier3d`) with no fallbacks; six bodies and two joints; no console error or unhandled rejection |
 * | one scene | §118 | six objects and two text layers are counted in **one** screenshot, each by its own hue, over a lit ground with a dark sky above it |
 * | everything moves | §10, §16, §29 | two frames 400 ms apart differ over a large area, simulated time advances, the §16 timeline reports laps, and §29 has reported landings |
 * | the panel is screen-space | §46, §47, §48, §71, §72 | the panel's own glyphs land in the lower-right quadrant of the second, `ScreenCamera` viewport, and pointing at each control the page publishes flips `data-hover` to that control's name |
 * | pause, single-step, overlay | §10, §113 | pause freezes the framebuffer (measured: **0** changed pixels) and simulated time; one step advances `sim` by exactly `1/60` s and redraws; the overlay's own colours appear where there were none |
 * | slow motion and the keyboard | §75, §9 | Tab reaches the slider, `Home` sets `timeScale` to its minimum, and simulated time then accumulates ~20× slower over the same wall-clock second; `Enter` activates the focused button and the activation reports `source: "keyboard"` |
 *
 * ## Method notes
 *
 * The scene's numbers are **restated** from the example rather than imported,
 * for the reason every other spec here gives: a browser gate checks the built
 * page from the outside, and importing the example's constants would let a
 * wrong scene agree with a wrong expectation.
 *
 * The **control positions are the exception, and are read from the page**
 * (`data-controls`). Recomputing where §74's flex layout puts a button would be
 * testing this file's copy of the layout algorithm rather than the engine's, so
 * the page publishes what it believes and this file checks that belief before
 * trusting it: it points at each published position and requires `data-hover`
 * to name that control. A page that published nonsense fails there.
 *
 * The PNG decoder is a copy of `example.spec.ts`'s, as in every other spec
 * here: Playwright returns an encoded screenshot, comparing compressed bytes
 * would conflate "the picture changed" with "the encoder picked different
 * filters", the workspace pins no image library, and a shared helper would mean
 * editing a sibling spec.
 *
 * Nothing here is a golden image: the gate runs on SwiftShader, whose
 * rasterisation differs from a GPU's, so every assertion is a measurement with
 * a stated margin (§92). Each threshold below quotes what the probe measured.
 */

import { inflateSync } from "node:zlib";

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  framesFor,
  waitForFrames,
  waitForSimulationTime,
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

/** The flagship, the eighth `webServer` of `playwright.config.ts`. */
const FLAGSHIP_URL = "http://localhost:4180/";

/** Canvas size in CSS pixels. The camera's `aspect` is built from this shape. */
const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 600;

/** The example's fixed simulation step, in seconds (§10, Appendix A). */
const FIXED_DELTA_TIME = 1 / 60;

/**
 * The x below which a pixel is definitely *not* the control panel.
 *
 * The panel is drawn by a second, screen-space viewport whose §47 `ScreenCamera`
 * makes its layout numbers pixels, and it is placed in the lower-right quarter;
 * the probe measured its background starting at x = 592 exactly — which is what
 * "the layout says 592" now means. 590 is just left of that, so "outside the
 * panel" is a statement about the scene. (Before 2026-08-21 the panel was
 * parented to the perspective camera and the same edge landed at x ≈ 592 by
 * arithmetic through a perspective divide.)
 */
const PANEL_LEFT_EDGE = 590;

// ---------------------------------------------------------------------------
// Pixel classifiers (see the example's "the palette is an instrument")
// ---------------------------------------------------------------------------

/**
 * The **cube**: warm, from a checkerboard whose two cells are `(255, 149, 43)`
 * and `(149, 57, 18)` at full illumination. `r − g ≥ 55` is what keeps the
 * yellow particles out (theirs is ≈ 20).
 */
function isCubePixel(r: number, g: number, b: number): boolean {
  return r >= 140 && r - g >= 55 && r - b >= 70;
}

/**
 * The **bouncing body**: violet, `(149, 128, 255)` fully lit — blue ahead of
 * both other channels. Both margins are needed: the rotor's cyan also leads on
 * blue, and only `b − g` separates them.
 */
function isBallPixel(r: number, g: number, b: number): boolean {
  return b >= 110 && b - r >= 40 && b - g >= 40;
}

/** The **pendulum bob and its spring**: green, `(71, 220, 113)` fully lit. */
function isBobPixel(r: number, g: number, b: number): boolean {
  return g >= 120 && g - r >= 55 && g - b >= 45;
}

/** The **motorised rotor**: cyan, `(65, 205, 241)` fully lit — green *and* blue. */
function isRotorPixel(r: number, g: number, b: number): boolean {
  return g >= 120 && b >= 120 && g - r >= 50 && b - r >= 50;
}

/**
 * The **2D orbit**: unlit magenta, `(242, 64, 184)` for the vector and the
 * orbiter, `(173, 41, 128)` for the path dots. Red and blue together with green
 * far behind both, which no lit surface in this scene produces.
 */
function isOrbitPixel(r: number, g: number, b: number): boolean {
  return r >= 140 && b >= 120 && g <= r - 70 && g <= b - 60;
}

/** **Particles**: yellow, `(255, 235, 115)` at spawn — red and green together. */
function isParticlePixel(r: number, g: number, b: number): boolean {
  return r >= 150 && g >= 120 && b <= 120 && r - g <= 70;
}

/**
 * **Text**: the glyph tint is deliberately neutral `(240, 240, 240)`, so a
 * bright pixel with almost no hue is a glyph (or the near-white focus ring and
 * slider handle, which live inside the panel and are counted separately).
 */
function isGlyphPixel(r: number, g: number, b: number): boolean {
  const low = Math.min(r, g, b);
  return low >= 170 && Math.max(r, g, b) - low <= 24;
}

/**
 * A **debug-overlay** line: §113's palette is fully saturated with *no blue* —
 * yellow velocity `(255, 255, 0)`, orange angular `(255, 128, 0)`, green origin
 * crosses and contact normals `(0, 255, 0)`, red contact points `(255, 0, 0)`.
 *
 * `b ≤ 12` is what makes it exclusive: the warmest thing in the scene otherwise
 * is the cube's lit cell at `b = 43`, and the yellow particles are at `b ≥ 64`.
 * The probe measured **0** such pixels with the overlay off and 315 with it on.
 */
function isOverlayPixel(r: number, g: number, b: number): boolean {
  return b <= 12 && Math.max(r, g) >= 200;
}

/** Rec. 709 relative luminance of one sample, in the same 0…255 units. */
function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** What one frame contains, by classifier. */
interface FrameCounts {
  readonly cube: number;
  readonly ball: number;
  readonly bob: number;
  readonly rotor: number;
  readonly orbit: number;
  readonly particles: number;
  /** Glyphs outside the panel column: world-space labels and left-side HUD. */
  readonly worldGlyphs: number;
  /** Bright neutral pixels in the panel column (x ≥ {@link PANEL_LEFT_EDGE}). */
  readonly panelGlyphs: number;
  /** Left-most and top-most panel-chrome pixel, for the screen-space claim. */
  readonly panelLeft: number;
  readonly panelTop: number;
  /** Debug-overlay line pixels, and how many of them fall outside the panel. */
  readonly overlay: number;
  readonly overlayOutsidePanel: number;
}

/**
 * Counts every classifier over one frame in a single pass.
 *
 * The chain is an `else if` on purpose: a pixel belongs to at most one object,
 * so a classifier that started claiming another's pixels would show up as a
 * *fall* in the other's count rather than as two inflated numbers.
 */
function measure(image: DecodedImage): FrameCounts {
  let cube = 0;
  let ball = 0;
  let bob = 0;
  let rotor = 0;
  let orbit = 0;
  let particles = 0;
  let worldGlyphs = 0;
  let panelGlyphs = 0;
  let panelLeft = image.width;
  let panelTop = image.height;
  let overlay = 0;
  let overlayOutsidePanel = 0;

  const upperBand = image.height * 0.4;
  const stride = image.bytesPerPixel;
  for (let y = 0; y < image.height; y++) {
    const rowStart = y * image.width * stride;
    for (let x = 0; x < image.width; x++) {
      const at = rowStart + x * stride;
      const r = image.pixels[at];
      const g = image.pixels[at + 1];
      const b = image.pixels[at + 2];
      if (isOverlayPixel(r, g, b)) {
        overlay += 1;
        if (x < PANEL_LEFT_EDGE) overlayOutsidePanel += 1;
      } else if (isCubePixel(r, g, b)) {
        cube += 1;
      } else if (isBallPixel(r, g, b)) {
        ball += 1;
      } else if (isBobPixel(r, g, b)) {
        bob += 1;
      } else if (isRotorPixel(r, g, b)) {
        rotor += 1;
      } else if (isOrbitPixel(r, g, b)) {
        orbit += 1;
      } else if (isParticlePixel(r, g, b)) {
        particles += 1;
      } else if (isGlyphPixel(r, g, b)) {
        // World / HUD labels also sit in the lower 60 % (cube caption, orbit
        // readouts). Only glyphs in the panel column count as panel chrome —
        // otherwise `panelLeft` walks to x ≈ 170 and the screen-space claim
        // fails even though the panel itself is still at x ≥ 590.
        if (y < upperBand || x < PANEL_LEFT_EDGE) {
          worldGlyphs += 1;
        } else {
          panelGlyphs += 1;
          if (x < panelLeft) panelLeft = x;
          if (y < panelTop) panelTop = y;
        }
      }
    }
  }
  return {
    cube,
    ball,
    bob,
    rotor,
    orbit,
    particles,
    worldGlyphs,
    panelGlyphs,
    panelLeft,
    panelTop,
    overlay,
    overlayOutsidePanel,
  };
}

/** How many pixels differ between two same-sized frames. */
function changedPixels(
  before: DecodedImage,
  after: DecodedImage,
  maximumX = Number.POSITIVE_INFINITY,
): number {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error("Frames have different sizes.");
  }
  let changed = 0;
  const stride = before.bytesPerPixel;
  for (let y = 0; y < before.height; y++) {
    for (let x = 0; x < Math.min(before.width, maximumX); x++) {
      const at = (y * before.width + x) * stride;
      if (
        before.pixels[at] !== after.pixels[at] ||
        before.pixels[at + 1] !== after.pixels[at + 1] ||
        before.pixels[at + 2] !== after.pixels[at + 2]
      ) {
        changed += 1;
      }
    }
  }
  return changed;
}

/** The luminance of one pixel of a decoded frame. */
function luminanceAt(image: DecodedImage, x: number, y: number): number {
  const at = (y * image.width + x) * image.bytesPerPixel;
  return luminance(
    image.pixels[at],
    image.pixels[at + 1],
    image.pixels[at + 2],
  );
}

async function grab(canvas: Locator): Promise<DecodedImage> {
  return decodePng(await canvas.screenshot());
}

// ---------------------------------------------------------------------------
// Thresholds — each states the probe's measurement and the margin it leaves
// ---------------------------------------------------------------------------

/**
 * Pixels each object must cover in the census frame.
 *
 * Measured over 14 samples 450 ms apart, from 1.9 s to 11.4 s of simulation:
 *
 * | object | measured | threshold |
 * | ------ | -------- | --------- |
 * | cube | 1 692…4 939 — it tumbles, and its dark checker cell leaves the classifier when a face turns away from the sun | 700 |
 * | ball | 1 197…1 299 | 500 |
 * | bob | 1 218…1 283 | 500 |
 * | rotor | 2 059…3 319 — a bar seen edge-on covers less than one seen flat | 1 200 |
 * | orbit | 444…1 535 — the timeline lifts and scales the whole assembly | 250 |
 * | particles | 830…4 631 across the samples, and **399** in one census run | 150 |
 * | world glyphs | 633…755 | 300 |
 *
 * The particle spread is the one worth explaining, because it is why its
 * threshold is proportionally the lowest: the count swings by a factor of five
 * with the burst phase (a fresh spark is a large opaque quad, a dying one is a
 * two-pixel ghost blending into the floor), and the census frame lands wherever
 * the ball's bounce cycle happens to be. A run that caught the scene between
 * bursts measured 399, which is why 400 was wrong and 150 is right: what this
 * assertion has to catch is a particle system that never ran, not a frame
 * photographed at a quiet moment.
 *
 * Every other threshold is under half the smallest measurement, for the same
 * reason — these assertions catch an object that stopped being drawn at all (a
 * lost draw call, a lost system, a lost package), not a few pixels of
 * rasteriser drift.
 */
const MINIMUM_CUBE_PIXELS = 700;
const MINIMUM_BALL_PIXELS = 500;
const MINIMUM_BOB_PIXELS = 500;
const MINIMUM_ROTOR_PIXELS = 1_200;
const MINIMUM_ORBIT_PIXELS = 250;
const MINIMUM_PARTICLE_PIXELS = 150;
const MINIMUM_WORLD_GLYPH_PIXELS = 300;

/** The panel's own text and chrome: the probe measured 784…885 pixels. */
const MINIMUM_PANEL_GLYPH_PIXELS = 300;

/**
 * The lit ground's luminance along the bottom edge. The probe measured 46.4
 * (bytes `(45, 46, 54)`); 30 keeps its distance from the sky without pinning a
 * software rasteriser.
 */
const MINIMUM_GROUND_LUMINANCE = 30;

/**
 * The cleared background's luminance at the top corners. The probe measured
 * 11.2 (bytes `(10, 11, 17)`); 20 sits between it and the ground's 46.
 */
const MAXIMUM_SKY_LUMINANCE = 20;

/**
 * Pixels that must differ between two frames 400 ms apart while running. The
 * probe measured 26 842…28 075 — the rotor, the ball, the cube, the pendulum,
 * the orbit and two particle systems all move. 3 000 is a ninth of that and
 * unreachable by a static image.
 */
const MINIMUM_CHANGED_PIXELS = 3_000;

/**
 * Pixels allowed to differ between two frames 400 ms apart while **paused**.
 *
 * The probe measured **exactly 0**, three runs out of three: pause is
 * `timeScale = 0` for the frame (§10), the render pose interpolation therefore
 * resolves to the same state, and the page's own per-frame writes (the status
 * label's text) do not change while paused. 40 leaves room for a single
 * dithered glyph edge without admitting a scene that is still moving — the
 * running frame differs by ~27 000.
 */
const MAXIMUM_PAUSED_CHANGED_PIXELS = 40;

/**
 * Pixels one single fixed step must change. The probe measured 13 450…13 649:
 * at 60 Hz one step moves the rotor by 2.5°, the ball by ~12 cm and ~300
 * particles. 2 000 is a seventh of that.
 */
const MINIMUM_SINGLE_STEP_CHANGED_PIXELS = 2_000;

/**
 * Overlay-line pixels once the overlay is switched on, and how many of them
 * fall outside the panel. The probe measured 315 and 161 against **0** and
 * **0** with the overlay off.
 */
const MINIMUM_OVERLAY_PIXELS = 80;
const MINIMUM_OVERLAY_PIXELS_OUTSIDE_PANEL = 40;

/**
 * Simulated seconds that must accumulate over one wall-clock second at the two
 * ends of the slider.
 *
 * The probe measured **1.000 s** at `timeScale = 1` and **0.050 s** at the
 * slider's minimum of 0.05 — the ratio is the dial, exactly. 0.7 and 0.2 are
 * far enough apart that no frame-rate wobble can reorder them, and a page that
 * ignored `timeScale` would score ~1.0 in both.
 */
const MINIMUM_FULL_SPEED_SIMULATION_SECONDS = 0.7;
const MAXIMUM_SLOW_MOTION_SIMULATION_SECONDS = 0.2;

/** Seconds between the two frames the motion tests compare. */
const FRAME_GAP_SECONDS = 0.4;

// ---------------------------------------------------------------------------
// Page plumbing
// ---------------------------------------------------------------------------

/** Errors seen since the page was created, in the order the browser saw them. */
type ErrorLog = readonly string[];

/** The `#status` element's data attributes, as the page publishes them. */
interface StatusData {
  state?: string;
  frames?: string;
  sim?: string;
  steps?: string;
  paused?: string;
  timescale?: string;
  substeps?: string;
  singlesteps?: string;
  bounces?: string;
  laps?: string;
  overlay?: string;
  particles?: string;
  focused?: string;
  hover?: string;
  activations?: string;
  source?: string;
  speed?: string;
  controls?: string;
  backend?: string;
  solver?: string;
  fallbacks?: string;
  rejections?: string;
  bodies?: string;
  joints?: string;
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

/** A point in the browser's viewport coordinates — what `page.mouse` takes. */
interface ViewportPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Parses `data-controls` (`"pause:654.5,435.0|…"`) into viewport points.
 *
 * The page publishes **canvas** pixels, and the mouse takes **viewport** ones,
 * so the canvas's own layout box is added — the canvas is centred in the page,
 * and the probe measured its origin at (160, 6) in a 1280 × 720 viewport. That
 * offset is the whole difference between clicking a button and clicking the
 * page background, so it is computed rather than assumed.
 */
async function controlPoints(
  page: Page,
  canvas: Locator,
): Promise<Map<string, ViewportPoint>> {
  const box = await canvas.boundingBox();
  expect(
    box,
    "the canvas has no layout box, so it cannot be pointed at",
  ).not.toBeNull();
  const origin = box as { x: number; y: number };
  const published = (await readStatus(page)).controls ?? "";
  const points = new Map<string, ViewportPoint>();
  for (const part of published.split("|")) {
    const [name, pair] = part.split(":");
    if (name === undefined || pair === undefined) continue;
    const [x, y] = pair.split(",").map(Number);
    points.set(name, { x: origin.x + x, y: origin.y + y });
  }
  expect(
    [...points.keys()].sort(),
    "the page did not publish its four controls",
  ).toEqual(["debug", "pause", "speed", "step"]);
  return points;
}

/**
 * Opens the demo, waits until it is running, and returns the page's live error
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
  await page.goto(FLAGSHIP_URL, { waitUntil: "load" });
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLElement>("#status")?.dataset["state"] ===
      "running",
    undefined,
    { timeout: 30_000 },
  );
  return errors;
}

/**
 * Presses Tab until `name` holds the §75 focus, and fails if it never does.
 *
 * A loop rather than a fixed number of presses because the focus may already
 * have been moved by an earlier click in the same test — traversal is a
 * property of the tree, not of a count this file would have to keep in step
 * with the panel.
 */
async function focusControl(page: Page, name: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if ((await readStatus(page)).focused === name) return;
    await page.keyboard.press("Tab");
    await waitForFrames(page, framesFor(0.08));
  }
  expect(
    (await readStatus(page)).focused,
    `Tab never reached the ${name} control`,
  ).toBe(name);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("examples/flagship/one-scene-everything-moves (§118)", () => {
  test("loads with the backend and solver the registries chose (§45, §62, §37)", async ({
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
    // `ApplicationOptions.width/height/resolution` reached the renderer the
    // registry built, so the drawing buffer is at least the CSS size.
    expect(drawingBuffer.width).toBeGreaterThanOrEqual(CANVAS_WIDTH);
    expect(drawingBuffer.height).toBeGreaterThanOrEqual(CANVAS_HEIGHT);

    // What `"auto"` actually resolved to, on both sides. These are the page's
    // own account — the pixels below are the evidence that it drew — but they
    // pin the two registry paths this example exists to exercise: a §62
    // renderer selection and a §37 solver selection, neither of which any other
    // shipped example uses.
    const status = await readStatus(page);
    expect(status.backend).toBe("webgl2");
    expect(status.solver).toBe("rapier3d");
    expect(statusNumber(status.fallbacks)).toBe(0);
    expect(statusNumber(status.rejections)).toBe(0);
    expect(statusNumber(status.bodies)).toBe(6);
    expect(statusNumber(status.joints)).toBe(2);

    // A render loop fails on its first frames, not on first paint: keep the
    // page alive long enough for a throw in `step`/`render` to be recorded.
    await waitForFrames(page, framesFor(1));
    expect(errors).toEqual([]);
  });

  test("one scene holds 2D art, lit 3D meshes, bodies, particles and text (§118)", async ({
    page,
  }) => {
    await openDemo(page);
    // Two and a half seconds in, the ball has landed at least once, the sparks
    // have fired, the cube has turned away from its start pose and the timeline
    // has completed an iteration.
    await waitForSimulationTime(page, 2.5);

    const image = await grab(page.locator("#scene"));
    const counts = measure(image);

    expect(
      counts.cube,
      "the textured lit cube is missing from the frame",
    ).toBeGreaterThanOrEqual(MINIMUM_CUBE_PIXELS);
    expect(
      counts.ball,
      "the bouncing rigid body is missing from the frame",
    ).toBeGreaterThanOrEqual(MINIMUM_BALL_PIXELS);
    expect(
      counts.bob,
      "the spring pendulum is missing from the frame",
    ).toBeGreaterThanOrEqual(MINIMUM_BOB_PIXELS);
    expect(
      counts.rotor,
      "the motorised rotor is missing from the frame",
    ).toBeGreaterThanOrEqual(MINIMUM_ROTOR_PIXELS);
    expect(
      counts.orbit,
      "the 2D vector orbit is missing from the frame",
    ).toBeGreaterThanOrEqual(MINIMUM_ORBIT_PIXELS);
    expect(
      counts.particles,
      "no particles reached the framebuffer",
    ).toBeGreaterThanOrEqual(MINIMUM_PARTICLE_PIXELS);
    expect(
      counts.worldGlyphs,
      "no world-space label reached the framebuffer",
    ).toBeGreaterThanOrEqual(MINIMUM_WORLD_GLYPH_PIXELS);

    // The horizon: a lit ground below, the cleared background above. It is also
    // the cheapest proof that the slab's normals face the light rather than
    // away from it (§68).
    expect(
      luminanceAt(image, 3, CANVAS_HEIGHT - 4),
      "the ground is not lit",
    ).toBeGreaterThanOrEqual(MINIMUM_GROUND_LUMINANCE);
    expect(
      luminanceAt(image, CANVAS_WIDTH - 4, CANVAS_HEIGHT - 4),
    ).toBeGreaterThanOrEqual(MINIMUM_GROUND_LUMINANCE);
    expect(
      luminanceAt(image, 3, 3),
      "the sky is as bright as the ground — there is no horizon",
    ).toBeLessThanOrEqual(MAXIMUM_SKY_LUMINANCE);
    expect(luminanceAt(image, CANVAS_WIDTH - 4, 3)).toBeLessThanOrEqual(
      MAXIMUM_SKY_LUMINANCE,
    );

    // Nothing draws the overlay until the third button is pressed.
    expect(counts.overlay, "the debug overlay is on by default").toBe(0);
  });

  test("everything moves on one clock, and the events fire (§10, §16, §29)", async ({
    page,
  }) => {
    await openDemo(page);
    await waitForSimulationTime(page, 2.5);

    const canvas = page.locator("#scene");
    const before = await readStatus(page);
    const first = await grab(canvas);
    await waitForFrames(page, framesFor(FRAME_GAP_SECONDS));
    const second = await grab(canvas);
    const after = await readStatus(page);

    // The pixels' account.
    expect(
      changedPixels(first, second),
      "the scene is static — the fixed-step loop or every system in it stalled",
    ).toBeGreaterThanOrEqual(MINIMUM_CHANGED_PIXELS);

    // The engine's own account: frames are drawn *and* simulated time advances.
    // Both are needed — a page can draw frames without stepping (a stalled
    // accumulator), and time can advance with nothing drawn.
    expect(statusNumber(after.frames)).toBeGreaterThan(
      statusNumber(before.frames),
    );
    expect(statusNumber(after.sim)).toBeGreaterThan(statusNumber(before.sim));

    // §29: the ball has landed on the slab and the handler ran. The probe
    // measured 2…4 landings in the first four seconds.
    expect(
      statusNumber(after.bounces),
      "no collision event was dispatched — the ball never landed, or §29 never fired",
    ).toBeGreaterThanOrEqual(1);

    // §16: the timeline is being *traversed*, not merely evaluated — the lap
    // counter is incremented by a marker crossing. The probe measured 2 laps by
    // 2.4 s (one iteration is 2.2 s).
    expect(
      statusNumber(after.laps),
      "the §16 timeline never completed an iteration",
    ).toBeGreaterThanOrEqual(1);

    // §36: particles are alive, which is the emitters being stepped rather than
    // merely constructed. The probe measured 366…684.
    expect(statusNumber(after.particles)).toBeGreaterThanOrEqual(50);
  });

  test("the control panel is screen-space and the pointer reaches it (§48, §71, §72)", async ({
    page,
  }) => {
    await openDemo(page);
    await waitForSimulationTime(page, 1.5);

    const canvas = page.locator("#scene");
    const counts = measure(await grab(canvas));

    // The panel is drawn, and it is where a screen-space HUD is supposed to be:
    // the lower-right quadrant of a 960 × 600 frame. Since 2026-08-21 that
    // placement is exact rather than approximate: the panel's top-left corner is
    // authored as the pixel pair (592, 221) under a §47 `ScreenCamera`.
    expect(
      counts.panelGlyphs,
      "the UI panel drew no text",
    ).toBeGreaterThanOrEqual(MINIMUM_PANEL_GLYPH_PIXELS);
    expect(
      counts.panelLeft,
      "the panel is not in the right half of the frame",
    ).toBeGreaterThanOrEqual(CANVAS_WIDTH / 2);
    expect(
      counts.panelTop,
      "the panel is not in the bottom half of the frame",
    ).toBeGreaterThanOrEqual(CANVAS_HEIGHT / 2);

    // Pointing at each control the page publishes must reach *that* control:
    // this is the §71 ray, cast through the **screen** camera the panel is drawn
    // with, hitting a widget whose world position is its position on the canvas
    // — and the check that makes the published positions trustworthy for the
    // tests below.
    const points = await controlPoints(page, canvas);
    for (const name of ["pause", "step", "debug"]) {
      const point = points.get(name);
      expect(point).toBeDefined();
      if (point === undefined) continue;
      await page.mouse.move(point.x, point.y);
      await waitForFrames(page, framesFor(0.15));
      expect(
        (await readStatus(page)).hover,
        `pointing at the published position of "${name}" hovered something else`,
      ).toBe(name);
    }
  });

  test("pause freezes the frame, one step advances exactly one, and the overlay draws (§10, §113)", async ({
    page,
  }) => {
    await openDemo(page);
    await waitForSimulationTime(page, 1.5);

    const canvas = page.locator("#scene");
    const points = await controlPoints(page, canvas);
    const pause = points.get("pause");
    const step = points.get("step");
    const debug = points.get("debug");
    expect(pause).toBeDefined();
    expect(step).toBeDefined();
    expect(debug).toBeDefined();
    if (pause === undefined || step === undefined || debug === undefined) {
      return;
    }

    // --- pause ---------------------------------------------------------
    await page.mouse.click(pause.x, pause.y);
    await waitForFrames(page, framesFor(0.3));
    const paused = await readStatus(page);
    expect(paused.paused).toBe("true");

    const firstPausedFrame = await grab(canvas);
    await waitForFrames(page, framesFor(FRAME_GAP_SECONDS));
    const secondPausedFrame = await grab(canvas);
    expect(
      changedPixels(firstPausedFrame, secondPausedFrame),
      "the scene kept moving after pause",
    ).toBeLessThanOrEqual(MAXIMUM_PAUSED_CHANGED_PIXELS);
    // Frames keep being drawn while paused (§10: a paused frame is exactly a
    // `timeScale = 0` frame), so a frozen picture must not be a frozen loop.
    const stillPaused = await readStatus(page);
    expect(statusNumber(stillPaused.frames)).toBeGreaterThan(
      statusNumber(paused.frames),
    );
    expect(statusNumber(stillPaused.sim)).toBeCloseTo(
      statusNumber(paused.sim),
      6,
    );

    // --- one single step ------------------------------------------------
    const beforeStep = await readStatus(page);
    await page.mouse.click(step.x, step.y);
    await waitForFrames(page, framesFor(0.25));
    const afterStep = await readStatus(page);

    expect(
      statusNumber(afterStep.steps) - statusNumber(beforeStep.steps),
      "the step button ran something other than exactly one fixed step",
    ).toBe(1);
    expect(statusNumber(afterStep.substeps)).toBe(1);
    // Three decimals, not four: the page publishes `data-sim` rounded to four
    // (`toFixed(4)`), so a difference of two rounded readings carries up to
    // 1e-4 of rounding error — more than `toBeCloseTo(…, 4)`'s 5e-5 tolerance,
    // which would make this assertion fail on the rounding rather than on the
    // engine. 5e-4 still separates one step (0.0167) from two (0.0333) by a
    // factor of thirty.
    expect(
      statusNumber(afterStep.sim) - statusNumber(beforeStep.sim),
      "one step did not advance simulated time by exactly one fixedDeltaTime",
    ).toBeCloseTo(FIXED_DELTA_TIME, 3);

    const beforeSecondStep = await grab(canvas);
    await page.mouse.click(step.x, step.y);
    await waitForFrames(page, framesFor(0.25));
    const afterSecondStep = await grab(canvas);
    expect(
      changedPixels(beforeSecondStep, afterSecondStep),
      "a single step changed nothing on screen",
    ).toBeGreaterThanOrEqual(MINIMUM_SINGLE_STEP_CHANGED_PIXELS);

    // --- the §113 overlay, measured on a frozen scene --------------------
    // Pausing first is what makes this measurement clean: the only thing that
    // can change outside the panel is the overlay itself.
    const beforeOverlay = await grab(canvas);
    expect(measure(beforeOverlay).overlay).toBe(0);
    await page.mouse.click(debug.x, debug.y);
    await waitForFrames(page, framesFor(0.3));
    const afterOverlay = await grab(canvas);
    const overlayCounts = measure(afterOverlay);

    expect((await readStatus(page)).overlay).toBe("on");
    expect(
      overlayCounts.overlay,
      "the debug overlay drew no lines",
    ).toBeGreaterThanOrEqual(MINIMUM_OVERLAY_PIXELS);
    expect(
      overlayCounts.overlayOutsidePanel,
      "the overlay drew nothing over the scene itself",
    ).toBeGreaterThanOrEqual(MINIMUM_OVERLAY_PIXELS_OUTSIDE_PANEL);
    expect(
      changedPixels(beforeOverlay, afterOverlay, PANEL_LEFT_EDGE),
      "switching the overlay on changed nothing outside the panel",
    ).toBeGreaterThanOrEqual(MINIMUM_OVERLAY_PIXELS_OUTSIDE_PANEL);
  });

  test("the keyboard drives slow motion and activation (§75, §9)", async ({
    page,
  }) => {
    await openDemo(page);
    await waitForSimulationTime(page, 1.5);

    // --- how fast simulated time runs at full speed ----------------------
    // Sixty frames is at least a second of wall clock (rAF is paced at 60 Hz
    // at most), so the lower bound below is measured over no less than the
    // second it was tuned for — and over more frames, never fewer, when the
    // runner is slow.
    const fullSpeedStart = statusNumber((await readStatus(page)).sim);
    await waitForFrames(page, framesFor(1));
    const fullSpeedEnd = statusNumber((await readStatus(page)).sim);
    expect(
      fullSpeedEnd - fullSpeedStart,
      "simulated time is not keeping up with the wall clock at timeScale 1",
    ).toBeGreaterThanOrEqual(MINIMUM_FULL_SPEED_SIMULATION_SECONDS);

    // --- Tab to the slider and take it to its minimum --------------------
    await focusControl(page, "speed");
    // §75: Home jumps a slider to its lower bound. The example's is 0.05, which
    // is deliberately not zero — zero is what pause means.
    await page.keyboard.press("Home");
    await waitForFrames(page, framesFor(0.2));
    const slow = await readStatus(page);
    expect(statusNumber(slow.speed)).toBeCloseTo(0.05, 5);
    expect(statusNumber(slow.timescale)).toBeCloseTo(0.05, 5);

    // The window here is an *upper* bound on simulated time, so it is measured
    // on the page's own clock: one wall second at timeScale 0.05 is 0.05 s of
    // simulation, and waiting for exactly that advance cannot overshoot the
    // 0.2 s ceiling however slowly the runner draws — a frame or wall-clock
    // wait could.
    const slowStart = statusNumber(slow.sim);
    await waitForSimulationTime(page, slowStart + 0.05);
    const slowEnd = statusNumber((await readStatus(page)).sim);
    expect(
      slowEnd - slowStart,
      "the slider moved the number but not the clock — timeScale is not reaching §10",
    ).toBeLessThanOrEqual(MAXIMUM_SLOW_MOTION_SIMULATION_SECONDS);
    // …and time did not stop, which would be pause rather than slow motion.
    expect(slowEnd).toBeGreaterThan(slowStart);

    // §75: End jumps to the upper bound, and an arrow key steps by `step`.
    await page.keyboard.press("End");
    await waitForFrames(page, framesFor(0.15));
    expect(statusNumber((await readStatus(page)).speed)).toBeCloseTo(1.45, 5);
    await page.keyboard.press("ArrowLeft");
    await waitForFrames(page, framesFor(0.15));
    expect(statusNumber((await readStatus(page)).speed)).toBeCloseTo(1.4, 5);

    // --- Enter activates the focused button ------------------------------
    await focusControl(page, "pause");
    const beforeEnter = await readStatus(page);
    await page.keyboard.press("Enter");
    await waitForFrames(page, framesFor(0.2));
    const afterEnter = await readStatus(page);

    expect(
      statusNumber(afterEnter.activations) -
        statusNumber(beforeEnter.activations),
      "Enter on the focused button did not activate it exactly once",
    ).toBe(1);
    // The same listener a click reaches, told apart only by the event's source.
    expect(afterEnter.source).toBe("keyboard");
    expect(afterEnter.paused).not.toBe(beforeEnter.paused);
  });
});
