/**
 * Browser gate for §93's **first 3D scene** — the first browser-level evidence
 * that fourJS's 3D tier draws (2026-08-07, `docs/AUDIT-120.md` S-8).
 *
 * Three things had shipped, been unit-tested against fake GL contexts, and never
 * been seen in a browser: the §47 `PerspectiveCamera`, the §68 lighting MVP
 * (`LitMaterial` + one `DirectionalLight` + scene ambient), and the §53 3D
 * primitives (`sphereGeometry`, `torusGeometry`, `capsuleGeometry`, R-19/R-20).
 * `examples/first-3d-scene` is the page that uses all three at once, and this
 * file measures it from the outside:
 *
 * ```text
 * page load → WebGL 2 context → PerspectiveCamera + DirectionalLight + ambient
 *   → LitProgram: color × (ambient + lightColor · max(N·−L, 0)) → pixels
 *                            ↑                         ↑
 *          §38 MotionComponent spins the torus    §15 Tween bobs the capsule
 * ```
 *
 * ## What is measured, and why each measurement is falsifiable
 *
 * | test | § | assertion |
 * | ---- | - | --------- |
 * | loads | §45, §61 | `#status` reaches `data-state="running"`, the drawing buffer is non-zero, the page's own account says perspective camera + 1 light + 5 meshes, and no console error or unhandled rejection is recorded |
 * | draws | §53, §57 | all four meshes reach the framebuffer in their own hue, and the lit ground is far brighter than the cleared background above the horizon |
 * | shades | §68 | each sphere's **upper-left** is several times brighter than its **lower-right**, and its dark side is still brighter than the background — Lambert diffuse plus a non-zero ambient term, neither of which a flat fill can imitate |
 * | perspective | §47 | the two spheres share a geometry *instance* and a material *instance*, so the only thing that can make the near one cover ~4× the pixels of the far one is the projection. **An orthographic camera scores exactly 1.0 here** |
 * | moves | §10, §38, §15 | two frames 300 ms apart differ over a large area, and the page's frame and simulated-time counters both advance |
 *
 * The perspective test is the one worth reading twice: it is not "the class is
 * named `PerspectiveCamera`" (the status attribute says that, and a string is
 * not evidence) but "objects farther away are smaller", measured in pixels.
 *
 * ## The seventh site
 *
 * `playwright.config.ts` runs one `vite preview` per built example;
 * `first-3d-scene` is the seventh, on port 4179. {@link SCENE_3D_URL} restates
 * that port for the reason the scene constants below are restated rather than
 * imported — see "Method notes". Run `bun run examples:build` (or
 * `bun run first-3d-scene:build`) before `bun run test:browser`, or the preview server
 * has no `dist` to serve.
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
 * Nothing here is a golden image: the gate runs on SwiftShader, whose
 * rasterisation differs from a GPU's, so every assertion is a measurement with a
 * stated margin (§92). Each threshold below quotes what the probe measured.
 */

import { inflateSync } from "node:zlib";

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  framesFor,
  waitForFrames,
  waitForSimulationTime,
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

// ---------------------------------------------------------------------------
// The scene, restated (see "Method notes")
// ---------------------------------------------------------------------------

/** `examples/first-3d-scene`, the seventh `webServer` of `playwright.config.ts`. */
const SCENE_3D_URL = "http://localhost:4179/";

/** Canvas size in CSS pixels. The camera's `aspect` is built from this shape. */
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

/** The example's full vertical field of view, in radians (§7a) — 45°. */
const FIELD_OF_VIEW = Math.PI / 4;

/**
 * The near sphere is left of the canvas midline, the far sphere right of it —
 * the whole reason the two can be counted separately with one classifier. The
 * probe measured the near sphere spanning x 117…247 and the far one 502…566, so
 * neither comes within 150 px of the divide.
 */
const MIDLINE = CANVAS_WIDTH / 2;

// ---------------------------------------------------------------------------
// Pixel classifiers (see the example's "colour discipline")
// ---------------------------------------------------------------------------

/**
 * A **sphere** pixel: violet — blue ahead of *both* other channels.
 *
 * The example's spheres run from `(187, 154, 255)` fully lit to `(21, 19, 51)`
 * at ambient only, so `blue − red` is 68 at the bright end and 30 at the dark
 * end and `blue − green` is 101 and 32; margins of 22 hold across the whole
 * ramp. The `blue − green` clause is not redundant: the capsule's lit green is
 * `(86, 255, 143)`, whose blue leads its *red* by 57, and without that clause a
 * green capsule would be counted as a violet sphere (measured — the first probe
 * run attributed 5 287 capsule pixels to the far sphere).
 */
function isSpherePixel(r: number, g: number, b: number): boolean {
  return b >= 45 && b - r >= 22 && b - g >= 22;
}

/** A **torus** pixel: warm — lit orange is `(255, 147, 48)`, red leading blue by 207. */
function isTorusPixel(r: number, g: number, b: number): boolean {
  return r >= 70 && r - b >= 45;
}

/** A **capsule** pixel: green leading both other channels; lit it is `(86, 255, 143)`. */
function isCapsulePixel(r: number, g: number, b: number): boolean {
  return g >= 90 && g - r >= 45 && g - b >= 35;
}

/** Rec. 709 relative luminance of one sample, in the same 0…255 units. */
function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** A pixel rectangle, inclusive on all four edges. */
interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** What one frame contains, by classifier. */
interface FrameStats {
  /** Sphere pixels left of {@link MIDLINE} — the near sphere. */
  readonly nearSphere: number;
  /** Sphere pixels right of {@link MIDLINE} — the far sphere. */
  readonly farSphere: number;
  readonly torus: number;
  readonly capsule: number;
  /** Bounding box of the near sphere's pixels, or `null` if it drew none. */
  readonly nearSphereBox: Box | null;
  /** Bounding box of the far sphere's pixels, or `null`. */
  readonly farSphereBox: Box | null;
}

/** Accumulates a bounding box without allocating one per pixel. */
class BoxAccumulator {
  x0 = Number.POSITIVE_INFINITY;
  y0 = Number.POSITIVE_INFINITY;
  x1 = Number.NEGATIVE_INFINITY;
  y1 = Number.NEGATIVE_INFINITY;

  add(x: number, y: number): void {
    if (x < this.x0) this.x0 = x;
    if (y < this.y0) this.y0 = y;
    if (x > this.x1) this.x1 = x;
    if (y > this.y1) this.y1 = y;
  }

  box(): Box | null {
    if (this.x1 < this.x0) return null;
    return { x0: this.x0, y0: this.y0, x1: this.x1, y1: this.y1 };
  }
}

function measure(image: DecodedImage): FrameStats {
  let nearSphere = 0;
  let farSphere = 0;
  let torus = 0;
  let capsule = 0;
  const nearBox = new BoxAccumulator();
  const farBox = new BoxAccumulator();
  const stride = image.bytesPerPixel;
  for (let y = 0; y < image.height; y++) {
    const rowStart = y * image.width * stride;
    for (let x = 0; x < image.width; x++) {
      const at = rowStart + x * stride;
      const r = image.pixels[at];
      const g = image.pixels[at + 1];
      const b = image.pixels[at + 2];
      if (isSpherePixel(r, g, b)) {
        if (x < MIDLINE) {
          nearSphere += 1;
          nearBox.add(x, y);
        } else {
          farSphere += 1;
          farBox.add(x, y);
        }
      } else if (isTorusPixel(r, g, b)) {
        torus += 1;
      } else if (isCapsulePixel(r, g, b)) {
        capsule += 1;
      }
    }
  }
  return {
    nearSphere,
    farSphere,
    torus,
    capsule,
    nearSphereBox: nearBox.box(),
    farSphereBox: farBox.box(),
  };
}

/** The mean luminance of the sphere pixels in two opposite quadrants of `box`. */
interface Gradient {
  /** Mean luminance of the upper-left quadrant — the side facing the light. */
  readonly upperLeft: number;
  /** Mean luminance of the lower-right quadrant — the side facing away. */
  readonly lowerRight: number;
  /** How many pixels each mean was taken over, so an empty mean cannot pass. */
  readonly upperLeftSamples: number;
  readonly lowerRightSamples: number;
}

/**
 * Measures a sphere's shading gradient across its own bounding box.
 *
 * Only pixels the sphere classifier claims are averaged, so the background and
 * the ground inside the box (a disc does not fill its bounding rectangle)
 * cannot drag either mean.
 */
function shadingGradient(image: DecodedImage, box: Box): Gradient {
  const centreX = (box.x0 + box.x1) / 2;
  const centreY = (box.y0 + box.y1) / 2;
  let upper = 0;
  let upperCount = 0;
  let lower = 0;
  let lowerCount = 0;
  const stride = image.bytesPerPixel;
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const at = (y * image.width + x) * stride;
      const r = image.pixels[at];
      const g = image.pixels[at + 1];
      const b = image.pixels[at + 2];
      if (!isSpherePixel(r, g, b)) continue;
      if (x < centreX && y < centreY) {
        upper += luminance(r, g, b);
        upperCount += 1;
      } else if (x > centreX && y > centreY) {
        lower += luminance(r, g, b);
        lowerCount += 1;
      }
    }
  }
  return {
    upperLeft: upper / Math.max(1, upperCount),
    lowerRight: lower / Math.max(1, lowerCount),
    upperLeftSamples: upperCount,
    lowerRightSamples: lowerCount,
  };
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
 * Pixels the near sphere must cover. The probe measured 13 042 (a disc of
 * radius ≈ 65 px); 5 000 is well under half of that and unreachable by a scene
 * that failed to draw one.
 */
const MINIMUM_NEAR_SPHERE_PIXELS = 5_000;

/**
 * Pixels the far sphere must cover. The probe measured 3 228 (radius ≈ 32 px);
 * 1 000 leaves the same kind of margin, and the ratio test below is what
 * actually constrains the two counts against each other.
 */
const MINIMUM_FAR_SPHERE_PIXELS = 1_000;

/** Torus pixels: the probe measured 16 785…17 037 as it tumbles. */
const MINIMUM_TORUS_PIXELS = 6_000;

/** Capsule pixels: the probe measured 5 287…5 296 through the bob. */
const MINIMUM_CAPSULE_PIXELS = 2_000;

/**
 * How much bigger the near sphere must be than the identical far one.
 *
 * The two are the same geometry instance and the same material instance at
 * depths of ≈ 5.0 and ≈ 10.2 world units from the camera, so a pinhole
 * projection scales their radii by ≈ 2.03 and their areas by ≈ 4.1; the probe
 * measured 13 042 / 3 228 = **4.04**. An orthographic camera would score
 * exactly **1.0**, so 2.0 is the midpoint of "perspective" and "not", not a
 * tolerance around the measurement.
 */
const MINIMUM_SPHERE_AREA_RATIO = 2;

/**
 * The same statement in one dimension: the near sphere's bounding box must be
 * this much wider than the far one's. The probe measured 131 px against 65 px —
 * a ratio of 2.02 against the projection's predicted 2.03.
 */
const MINIMUM_SPHERE_WIDTH_RATIO = 1.5;

/**
 * How much brighter a sphere's lit quadrant must be than its shadowed one.
 *
 * The light travels `(0.345, −0.751, −0.563)`, so the upper-left of each sphere
 * faces it and the lower-right faces away. The probe measured 154.5 against
 * 41.5 on the near sphere (3.72×) and 149.1 against 49.2 on the far one
 * (3.03×). A flat unlit fill scores exactly 1.0.
 */
const MINIMUM_SHADING_RATIO = 2;

/**
 * The dimmest a sphere's shadowed quadrant may be.
 *
 * §68's ambient term is `(0.16, 0.17, 0.21)` and the sphere's colour is
 * `(0.52, 0.44, 0.95)`, so its unlit side is `(21, 19, 51)` — luminance ≈ 22.4
 * — against a background luminance of ≈ 13.0. The probe measured 41.5 and 49.2
 * (the shadowed *quadrant* still catches some grazing light). 25 says "the
 * ambient term reached the shader" and would fail if it were dropped, without
 * pinning a software rasteriser to the byte.
 */
const MINIMUM_SHADOWED_LUMINANCE = 25;

/**
 * Sphere pixels each quadrant mean must be taken over, so an empty quadrant
 * cannot pass by dividing by one. The probe measured 3 099 / 3 119 on the near
 * sphere and 768 / 772 on the far one.
 */
const MINIMUM_QUADRANT_SAMPLES = 200;

/**
 * The lit ground's luminance at the bottom corners of the frame. The probe
 * measured `(48, 48, 51)` — luminance 48.2. 30 keeps the distance from the
 * background without pinning the rasteriser.
 */
const MINIMUM_GROUND_LUMINANCE = 30;

/**
 * The cleared background's luminance above the horizon. The probe measured
 * `(11, 13, 19)` — luminance 13.0. 20 sits between it and the ground's 48.
 */
const MAXIMUM_BACKGROUND_LUMINANCE = 20;

/**
 * Pixels that must differ between two frames 300 ms apart. The probe measured
 * 26 826…27 077. 2 000 is under 8 % of that and unreachable by a static image.
 */
const MINIMUM_CHANGED_PIXELS = 2_000;

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
  frames?: string;
  camera?: string;
  fov?: string;
  aspect?: string;
  lights?: string;
  meshes?: string;
  sim?: string;
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
 * Opens the demo, waits until it is running, and returns the page's live error
 * log.
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
  await page.goto(SCENE_3D_URL, { waitUntil: "load" });

  // Readiness is the page's own claim, not a sleep: `data-state` flips to
  // "running" on the first `update` event. 20 s is the budget for a cold
  // software-GL start.
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLElement>("#status")?.dataset["state"] ===
      "running",
    undefined,
    { timeout: 20_000 },
  );
  return errors;
}

/** Opens the demo and returns one settled frame, plus its statistics. */
async function settledFrame(
  page: Page,
): Promise<{ image: DecodedImage; stats: FrameStats }> {
  await openDemo(page);
  // A second and a half in, the capsule has left its starting pose and the
  // torus has turned far enough to present its ring rather than its rim.
  await waitForSimulationTime(page, 1.5);
  const image = await grab(page.locator("#scene"));
  return { image, stats: measure(image) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("examples/first-3d-scene (§93, §47, §57, §68)", () => {
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

    // The page's own account of what it built. A string is not evidence that
    // the projection is a perspective one — the ratio test below is — but it
    // does pin the scene this file's thresholds were measured against, so a
    // silent change to the camera or the light count fails here first.
    const status = await readStatus(page);
    expect(status.camera).toBe("perspective");
    expect(statusNumber(status.fov)).toBeCloseTo(FIELD_OF_VIEW, 3);
    expect(statusNumber(status.aspect)).toBeCloseTo(
      CANVAS_WIDTH / CANVAS_HEIGHT,
      3,
    );
    expect(statusNumber(status.lights)).toBe(1);
    expect(statusNumber(status.meshes)).toBe(5);

    // A render loop fails on its first frames, not on first paint: keep the
    // page alive long enough for a throw in `step`/`render` to be recorded.
    await waitForFrames(page, framesFor(FRAME_GAP_SECONDS));
    expect(errors).toEqual([]);
  });

  test("draws every lit primitive, over a lit ground (§53, §57)", async ({
    page,
  }) => {
    const { image, stats } = await settledFrame(page);

    expect(
      stats.nearSphere,
      "the near sphere drew nothing — sphereGeometry never reached the framebuffer",
    ).toBeGreaterThanOrEqual(MINIMUM_NEAR_SPHERE_PIXELS);
    expect(
      stats.farSphere,
      "the far sphere drew nothing",
    ).toBeGreaterThanOrEqual(MINIMUM_FAR_SPHERE_PIXELS);
    expect(stats.torus, "the torus drew nothing").toBeGreaterThanOrEqual(
      MINIMUM_TORUS_PIXELS,
    );
    expect(stats.capsule, "the capsule drew nothing").toBeGreaterThanOrEqual(
      MINIMUM_CAPSULE_PIXELS,
    );

    // The ground plane fills the bottom of the frame and the cleared background
    // the top: a horizon, which is also the cheapest proof that the plane's
    // +Y normals face the light rather than away from it.
    const groundLeft = luminanceAt(image, 2, CANVAS_HEIGHT - 3);
    const groundRight = luminanceAt(image, CANVAS_WIDTH - 3, CANVAS_HEIGHT - 3);
    const skyLeft = luminanceAt(image, 2, 2);
    const skyRight = luminanceAt(image, CANVAS_WIDTH - 3, 2);
    expect(groundLeft).toBeGreaterThanOrEqual(MINIMUM_GROUND_LUMINANCE);
    expect(groundRight).toBeGreaterThanOrEqual(MINIMUM_GROUND_LUMINANCE);
    expect(skyLeft).toBeLessThanOrEqual(MAXIMUM_BACKGROUND_LUMINANCE);
    expect(skyRight).toBeLessThanOrEqual(MAXIMUM_BACKGROUND_LUMINANCE);
  });

  test("the directional light shades the spheres (§68 Lambert + ambient)", async ({
    page,
  }) => {
    const { image, stats } = await settledFrame(page);

    for (const [name, box] of [
      ["near sphere", stats.nearSphereBox],
      ["far sphere", stats.farSphereBox],
    ] as const) {
      expect(box, `${name}: nothing to measure`).not.toBeNull();
      if (box === null) continue;

      const gradient = shadingGradient(image, box);
      expect(gradient.upperLeftSamples).toBeGreaterThanOrEqual(
        MINIMUM_QUADRANT_SAMPLES,
      );
      expect(gradient.lowerRightSamples).toBeGreaterThanOrEqual(
        MINIMUM_QUADRANT_SAMPLES,
      );

      // Lambert: the side facing the light is much brighter than the side
      // facing away. A flat fill — an unlit material, or a lit one the light
      // never reached — scores exactly 1.
      expect(
        gradient.upperLeft / gradient.lowerRight,
        `${name}: no shading gradient — the surface is lit flat, not by N·−L`,
      ).toBeGreaterThanOrEqual(MINIMUM_SHADING_RATIO);

      // …and the ambient term is genuinely added, so the shadowed side is a
      // dim violet rather than the background.
      expect(
        gradient.lowerRight,
        `${name}: the shadowed side is as dark as the background — the ambient term is missing`,
      ).toBeGreaterThanOrEqual(MINIMUM_SHADOWED_LUMINANCE);
    }
  });

  test("the perspective camera makes the nearer of two identical spheres bigger (§47)", async ({
    page,
  }) => {
    const { stats } = await settledFrame(page);

    expect(stats.nearSphereBox).not.toBeNull();
    expect(stats.farSphereBox).not.toBeNull();
    if (stats.nearSphereBox === null || stats.farSphereBox === null) return;

    // The two spheres share one geometry instance and one material instance, so
    // nothing but their transforms differs. Under an orthographic projection
    // both ratios below would be 1.0 whatever the depths.
    expect(
      stats.nearSphere / stats.farSphere,
      "the two spheres cover the same area — the projection is not a perspective one",
    ).toBeGreaterThanOrEqual(MINIMUM_SPHERE_AREA_RATIO);

    const nearWidth = stats.nearSphereBox.x1 - stats.nearSphereBox.x0 + 1;
    const farWidth = stats.farSphereBox.x1 - stats.farSphereBox.x0 + 1;
    expect(
      nearWidth / farWidth,
      "the two spheres are the same width on screen",
    ).toBeGreaterThanOrEqual(MINIMUM_SPHERE_WIDTH_RATIO);
  });

  test("the scene keeps moving under both clocks (§10, §38, §15)", async ({
    page,
  }) => {
    await openDemo(page);
    await waitForSimulationTime(page, 1);

    const before = await readStatus(page);
    const first = await grab(page.locator("#scene"));

    await waitForFrames(page, framesFor(FRAME_GAP_SECONDS));
    const second = await grab(page.locator("#scene"));
    const after = await readStatus(page);

    // The pixels' account: the tumbling torus and the bobbing capsule move.
    expect(
      changedPixels(first, second),
      "the scene is static — the fixed-step loop, the motion system or the tween stalled",
    ).toBeGreaterThanOrEqual(MINIMUM_CHANGED_PIXELS);

    // The engine's own account: frames are being drawn and simulated time is
    // advancing. Both are needed — a page can draw frames without stepping
    // (a stalled accumulator), and time can advance with nothing drawn.
    expect(statusNumber(after.frames)).toBeGreaterThan(
      statusNumber(before.frames),
    );
    expect(statusNumber(after.sim)).toBeGreaterThan(statusNumber(before.sim));
  });
});
