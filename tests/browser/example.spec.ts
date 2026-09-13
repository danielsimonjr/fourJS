/**
 * Browser gate for `examples/first-2d-scene` (WP-3.8).
 *
 * Phase 3's exit asks whether moving primitives actually reach a real WebGL 2
 * surface, which no unit test can answer. These three tests answer it from the
 * outside: the page loads without a single console error or unhandled
 * rejection, the canvas holds a drawn scene rather than a cleared buffer, and
 * that scene changes over time.
 *
 * Everything is measured, nothing is matched. The gate runs against SwiftShader
 * (software GL) whose rasterisation differs from a GPU's, so there are no
 * golden images and every threshold sits far below what a working frame
 * produces and far above what a blank one does (§92).
 *
 * The PNG decoder below exists because Playwright hands back an encoded
 * screenshot: comparing the *compressed* bytes would conflate "the picture
 * changed" with "the encoder chose different filters". Decoding keeps the
 * assertions about pixels.
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

/**
 * A scene of flat-shaded shapes on a cleared background: three primitives plus
 * antialiased edges measured eight to ten colours here, so four separates a
 * drawn frame from a blank one with room to spare.
 */
const MINIMUM_DISTINCT_COLORS = 4;

/**
 * Two frames 300 ms apart differed by roughly 14 000 of 480 000 pixels (~3 %).
 * A hundred is far below that and far above the zero a stalled loop gives.
 */
const MINIMUM_CHANGED_PIXELS = 100;

/** Errors seen since the page was created, in the order the browser saw them. */
type ErrorLog = readonly string[];

/**
 * Opens the example and returns the page plus its live error log.
 *
 * `favicon.ico` is served rather than 404-ed: the browser asks for it on its
 * own, the example ships none, and the resulting "failed to load resource"
 * console error would otherwise have to be excused by an allowlist — which
 * would also excuse a real 404 for a real asset.
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

/** Seconds to keep screenshotting before giving up on a first drawn frame. */
const DRAW_BUDGET_SECONDS = 5;

/** Seconds between the two frames the animation test compares. */
const FRAME_GAP_SECONDS = 0.3;

/**
 * Screenshots the canvas until it holds a drawn frame or the budget runs out,
 * and returns the last frame taken either way.
 *
 * Returning a blank frame instead of throwing is deliberate: "still blank" is a
 * result the caller asserts on, and spending the whole budget is what lets the
 * error-log test see a loop that dies on a late first frame.
 */
async function waitForDrawnFrame(canvas: Locator): Promise<DecodedImage> {
  const deadline = Date.now() + DRAW_BUDGET_SECONDS * 1000;
  let frame = await grab(canvas);
  while (distinctColors(frame) < MINIMUM_DISTINCT_COLORS) {
    if (Date.now() >= deadline) break;
    frame = await grab(canvas);
  }
  return frame;
}

test.describe("examples/first-2d-scene", () => {
  test("loads without console errors or page errors", async ({ page }) => {
    const errors = await openExample(page);
    const canvas = page.locator("#scene");
    await expect(canvas).toBeVisible();
    // A render loop fails on its first frames, not on first paint, so wait for
    // drawing to start — and, when it never does, wait out the whole budget so
    // a late throw is still collected.
    await waitForDrawnFrame(canvas);
    await waitForFrames(page, framesFor(FRAME_GAP_SECONDS));
    expect(errors).toEqual([]);
  });

  test("draws a non-blank scene into #scene", async ({ page }) => {
    await openExample(page);
    const canvas = page.locator("#scene");
    await expect(canvas).toBeVisible();

    // The example owns its WebGL 2 context and a second `getContext` call for a
    // different type would return null, so the browser's capability is probed
    // on a throwaway canvas instead. Whether the *example's* context is live is
    // what the pixels below answer.
    const rendererName = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (gl === null) return null;
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      const parameter =
        info === null ? gl.RENDERER : info.UNMASKED_RENDERER_WEBGL;
      return String(gl.getParameter(parameter));
    });
    expect(rendererName, "browser has no WebGL 2 context").not.toBeNull();

    const drawingBuffer = await canvas.evaluate(
      (element: HTMLCanvasElement) => ({
        width: element.width,
        height: element.height,
      }),
    );
    expect(drawingBuffer.width).toBeGreaterThan(0);
    expect(drawingBuffer.height).toBeGreaterThan(0);

    const frame = await waitForDrawnFrame(canvas);
    expect(
      distinctColors(frame),
      `canvas is blank on ${rendererName ?? "unknown renderer"}`,
    ).toBeGreaterThanOrEqual(MINIMUM_DISTINCT_COLORS);
  });

  test("animates: two frames 0.3 s apart differ", async ({ page }) => {
    await openExample(page);
    const canvas = page.locator("#scene");
    const first = await waitForDrawnFrame(canvas);
    expect(
      distinctColors(first),
      "canvas never drew, so there is nothing to animate",
    ).toBeGreaterThanOrEqual(MINIMUM_DISTINCT_COLORS);

    await waitForFrames(page, framesFor(FRAME_GAP_SECONDS));
    const second = await grab(canvas);

    const changed = changedPixels(first, second);
    expect(
      changed,
      "the scene is static — the fixed-step loop or the render loop stalled",
    ).toBeGreaterThanOrEqual(MINIMUM_CHANGED_PIXELS);
  });
});
