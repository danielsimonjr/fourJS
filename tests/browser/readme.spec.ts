/**
 * Browser gate for README.md's Quick start TypeScript block.
 *
 * `tools/check-docs.mjs` already matches `start()` / `step()` pairing in
 * fenced `Application` blocks. That is a text check. This spec runs the
 * restated snippet (`fixtures/readme-page.ts`) on a real WebGL 2 surface
 * and answers the two questions a new reader cares about: the page loads
 * without a console error or unhandled rejection, and the canvas holds a
 * drawn scene rather than a cleared buffer — the same spirit as
 * `example.spec.ts`, with no golden image.
 *
 * ## Why this spec builds its own page
 *
 * `batching.spec.ts`'s argument: there is no examples/ site for the README
 * snippet, and adding one would cost the suite a server and the repository
 * a page nobody would visit. The fixture is bundled with Vite's JavaScript
 * API and injected into a page served by the first site's server, which
 * supplies the `http:` origin a WebGL context wants. No new `webServer`.
 *
 * The snippet is restated as constants in the fixture, not extracted from
 * README.md at runtime, for the reason every sibling spec restates its
 * example: a gate that imported the source under test would let a wrong
 * snippet agree with a wrong page. `check-docs.mjs` still pins the README
 * fence's lifecycle pairing.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

import { expect, test, type Locator, type Page } from "@playwright/test";
import { build } from "vite";

/** Restates `PORT` in `playwright.config.ts` — the site whose origin is borrowed. */
const PORT = 4173;

/**
 * Drawing-buffer size the README snippet passes to `renderer.resize`.
 * Restated from the fixture (a gate checks a page from the outside).
 */
const WIDTH = 800;
const HEIGHT = 600;

/**
 * A single unlit circle on a uniform clear is two colours (fill +
 * background). `example.spec.ts` asks for four because that page draws
 * several primitives plus antialiased edges; this snippet has one fill, so
 * two separates a drawn frame from a cleared buffer.
 */
const MINIMUM_DISTINCT_COLORS = 2;

/** Seconds to keep screenshotting before giving up on a first drawn frame. */
const DRAW_BUDGET_SECONDS = 5;

/** A decoded, unfiltered 8-bit image: `pixels` is `width * height` samples. */
interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly bytesPerPixel: number;
  readonly pixels: Buffer;
}

const PNG_SIGNATURE = 0x89504e47;

function channelsForColorType(colorType: number): number {
  switch (colorType) {
    case 0:
      return 1;
    case 2:
      return 3;
    case 4:
      return 2;
    case 6:
      return 4;
    default:
      throw new Error(`Unsupported PNG colour type ${String(colorType)}.`);
  }
}

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
 * Decodes a non-interlaced 8-bit PNG — the only kind Playwright produces.
 * Copied from `example.spec.ts` (that file's argument: the workspace pins
 * no image library, and comparing compressed bytes would conflate "the
 * picture changed" with "the encoder chose different filters").
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
    offset += length + 12;
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

function colorAt(image: DecodedImage, index: number): number {
  return image.pixels.readUIntBE(
    index * image.bytesPerPixel,
    image.bytesPerPixel,
  );
}

function distinctColors(image: DecodedImage): number {
  const colors = new Set<number>();
  const count = image.width * image.height;
  for (let i = 0; i < count; i++) colors.add(colorAt(image, i));
  return colors.size;
}

async function grab(canvas: Locator): Promise<DecodedImage> {
  return decodePng(await canvas.screenshot());
}

async function waitForDrawnFrame(canvas: Locator): Promise<DecodedImage> {
  const deadline = Date.now() + DRAW_BUDGET_SECONDS * 1000;
  let frame = await grab(canvas);
  while (distinctColors(frame) < MINIMUM_DISTINCT_COLORS) {
    if (Date.now() >= deadline) break;
    frame = await grab(canvas);
  }
  return frame;
}

/** Bundles the fixture once for the whole file. */
async function bundleFixture(): Promise<string> {
  const entry = fileURLToPath(
    new URL("fixtures/readme-page.ts", import.meta.url),
  );
  if (!existsSync(entry)) {
    throw new Error(`fixture missing: ${entry}`);
  }
  const result = await build({
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      target: "es2022",
      lib: { entry, formats: ["es"], fileName: "readme-page" },
    },
  });
  const outputs: unknown = Array.isArray(result) ? result[0] : result;
  const chunks: unknown[] =
    typeof outputs === "object" && outputs !== null && "output" in outputs
      ? (outputs as { output: unknown[] }).output
      : [];
  let code = "";
  for (const chunk of chunks) {
    if (typeof chunk === "object" && chunk !== null && "code" in chunk) {
      code += `${String(chunk.code)}\n`;
    }
  }
  if (code === "") {
    throw new Error("the fixture bundled to nothing");
  }
  return code;
}

/**
 * Serves the fixture on the first site's origin and returns the live error
 * log. `favicon.ico` is fulfilled rather than 404-ed — `example.spec.ts`'s
 * reason: the browser asks for it on its own and the resulting console
 * error would otherwise have to be excused by an allowlist.
 */
async function openReadmePage(page: Page): Promise<readonly string[]> {
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

  const code = await bundleFixture();
  await page.goto(`http://localhost:${String(PORT)}/`);
  await page.setContent(
    `<!doctype html><body><canvas width="${String(WIDTH)}" height="${String(HEIGHT)}"></canvas></body>`,
  );
  await page.addScriptTag({ content: code, type: "module" });
  await page.waitForSelector("body[data-readme-ready='1']", {
    timeout: 30_000,
  });
  return errors;
}

test.describe("README.md Quick start snippet", () => {
  test("loads without console errors or page errors", async ({ page }) => {
    const errors = await openReadmePage(page);
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();
    await waitForDrawnFrame(canvas);
    expect(errors).toEqual([]);
  });

  test("draws a non-blank scene into the canvas", async ({ page }) => {
    await openReadmePage(page);
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();

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
});
