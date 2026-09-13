/**
 * Post-plan browser gate: §73–§75's retained-mode UI, proven in a browser
 * (closing the WP-11.5 packet-intent shortfall — "@fourjs/ui has node-level §72
 * coverage only; no example app imports it").
 *
 * `packages/ui/tests` pins the layout arithmetic, the state machines, and the
 * event contracts against synthetic pointer events. What none of that can
 * prove is the assembled claim of §73: that widgets are *scene nodes* — that a
 * `@fourjs/ui` tree, skinned by an application, laid out by the package, reaches
 * a real framebuffer, and that a real mouse aimed at a button's pixels reaches
 * that button's `uiactivate`. This suite drives `examples/ui-demo` with
 * Playwright's CDP-level mouse and keyboard and checks both accounts:
 *
 * ```text
 * Chromium mouse → canvas pointer event → PointerInput (NDC + Y flip)
 *   → pick (§71 ray vs. widget hit areas from collectPickables)
 *   → UIWidget state machine (§72 hover/press) → Button click → uiactivate
 *   → application listener → skin (WidgetSkin.onStateChange) → renderer → pixels
 *
 * Chromium keyboard → window keydown → KeyboardInput (normalize + route to the
 *   focused node) → §72 three-phase dispatch → @fourjs/ui traversal (Tab) or
 *   Button's Enter/Space → the same listener, source: "keyboard"
 * ```
 *
 * ## What is measured
 *
 * | test | § | assertion |
 * | ---- | - | --------- |
 * | loads | §45, §73, §74 | `data-state="running"`, and the framebuffer holds the panel background, three idle button faces, glyph ink, and a coral swatch — every one an application-skinned surface positioned by the package's layout |
 * | clicks | §71, §72 | clicking each button advances `data-clicks` by exactly one, recolours the swatch (DOM account *and* pixels), reports `source: "pointer"`, focuses the pressed button; a click on empty background changes nothing |
 * | hover | §72 | moving the pointer onto a button flips `data-hover` and repaints its face in the hover colour; leaving restores the idle colour |
 * | keyboard | §72, §75 | Tab walks the focus (`data-focused`), Shift-Tab walks it back, the focus ring is *drawn*, Enter and Space activate with `source: "keyboard"` and recolour the swatch |
 *
 * State that the page can report is asserted from `#status`'s `data-*`
 * attributes — the engine's own account, waited on with `waitForFunction`
 * rather than slept for — and the framebuffer is reserved for what only pixels
 * can prove: that the skins actually painted. Nothing here asserts a wall-clock
 * *lower* bound; every wait is either an event with a timeout budget or a poll
 * that stops early.
 *
 * ## The sixth site
 *
 * This spec drives the sixth `webServer` of `playwright.config.ts`:
 * `examples/ui-demo` built to `dist` and previewed on port 4178.
 * {@link UI_URL} restates the port for the reason every constant below is
 * restated rather than imported — see "Method notes". Run `bun run ui-demo:build`
 * before `bun run test:browser`, or the preview server has no `dist` to serve.
 *
 * ## Method notes
 *
 * The scene's numbers are **restated** from the example rather than imported,
 * for the reason every other spec here gives: a browser gate checks the built
 * page from the outside, and importing the example's constants would let a
 * wrong scene agree with a wrong expectation. The layout numbers below are the
 * §74 arithmetic done by hand (flex column, padding 0.3, gap 0.3; flex row,
 * gap 0.3, buttons 1.2 × 0.6), which is exactly the point: the package's
 * layout must land the buttons where the arithmetic says, or the clicks below
 * miss them.
 *
 * The PNG decoder is a copy of `example.spec.ts`'s, as in every other spec
 * here: Playwright returns an encoded screenshot, comparing compressed bytes
 * would conflate "the picture changed" with "the encoder picked different
 * filters", the workspace pins no image library, and this packet's file scope
 * forbids editing a sibling spec to share one.
 *
 * Nothing is a golden image: the gate runs on SwiftShader, whose rasterisation
 * differs from a GPU's, so every assertion is a count with margin (§92), and
 * every threshold states the number the probe run measured.
 */

import { inflateSync } from "node:zlib";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { framesFor, waitForFrames } from "./helpers/wait.js";

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

async function grab(canvas: Locator): Promise<DecodedImage> {
  return decodePng(await canvas.screenshot());
}

// ---------------------------------------------------------------------------
// The scene, restated (see "Method notes")
// ---------------------------------------------------------------------------

/** `examples/ui-demo`, the sixth `webServer` of `playwright.config.ts`. */
const UI_URL = "http://localhost:4178/";

/** Canvas size in CSS pixels. */
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

/** `OrthographicCamera` extents, in world units — 100 CSS px per unit. */
const VIEW_LEFT = -4;
const VIEW_RIGHT = 4;
const VIEW_BOTTOM = -3;
const VIEW_TOP = 3;

/**
 * The panel's world rectangle: the example places its top-left corner at
 * (−3.8, 1.6), and its resolved size is the §74 arithmetic — width
 * `3 × 1.2 + 2 × 0.3 (row) + 2 × 0.3 (padding) = 4.8`, height
 * `0.3 + 0.28 + 0.3 + 0.6 + 0.3 + 0.24 + 0.3 = 2.32`.
 */
const PANEL_LEFT = -3.8;
const PANEL_TOP = 1.6;
const PANEL_WIDTH = 4.8;
const PANEL_HEIGHT = 2.32;

/**
 * Button centres, from the same arithmetic: the row starts
 * `0.3 + 0.28 + 0.3 = 0.88` below the panel top at `0.3` from its left edge,
 * buttons are 1.2 × 0.6 with a 0.3 gap, so centre `k` is at world
 * `x = −3.8 + 0.3 + 0.6 + 1.5 k`, `y = 1.6 − (0.88 + 0.3)`. The probe run
 * confirmed all three to the pixel (idle-face counts 3 623 … 3 716 in rects
 * this file derives from these centres).
 */
const BUTTON_CENTERS_X = [-2.9, -1.4, 0.1] as const;
const BUTTON_CENTER_Y = 0.42;
const BUTTON_WIDTH = 1.2;
const BUTTON_HEIGHT = 0.6;

/** The buttons' names in order — also the swatch options they select. */
const BUTTON_NAMES = ["coral", "mint", "azure"] as const;

/** The swatch quad: 1.4 × 1.4 world units centred at (2.6, 0.4). */
const SWATCH_CENTER_X = 2.6;
const SWATCH_CENTER_Y = 0.4;
const SWATCH_HALF = 0.7;

/**
 * Where a click is aimed when it must hit nothing: below the panel (bottom
 * −0.72) and the swatch (bottom −0.3), over bare background.
 */
const EMPTY_POINT_X = 0;
const EMPTY_POINT_Y = -2.2;

/** An RGB colour as framebuffer bytes. */
type Rgb = readonly [number, number, number];

/**
 * The example's colours, as the bytes they reach the framebuffer as —
 * `UnlitMaterial` writes its colour straight out with no tone mapping (the
 * finding `smoothness.spec.ts` records), so a byte is the material component
 * times 255, nominal to ±1 of rounding.
 */
const PANEL_COLOR: Rgb = [41, 46, 61]; // 0.16, 0.18, 0.24
const BUTTON_IDLE: Rgb = [61, 87, 133]; // 0.24, 0.34, 0.52
const BUTTON_HOVER: Rgb = [92, 128, 184]; // 0.36, 0.50, 0.72
const FOCUS_RING: Rgb = [242, 204, 76]; // 0.95, 0.80, 0.30

/** The three swatch colours, keyed by the button that selects each. */
const SWATCH_COLORS: Record<(typeof BUTTON_NAMES)[number], Rgb> = {
  coral: [235, 92, 64], // 0.92, 0.36, 0.25
  mint: [56, 209, 128], // 0.22, 0.82, 0.50
  azure: [71, 143, 242], // 0.28, 0.56, 0.95
};

// ---------------------------------------------------------------------------
// Tolerances — each states the probe run's measurement and the margin left
// ---------------------------------------------------------------------------

/**
 * Per-channel distance within which a pixel counts as "this colour".
 *
 * The example keeps adjacent interaction states ≥ 30 bytes apart per channel
 * (idle → hover is (31, 41, 51)), so 18 can never claim a pixel for two states
 * at once; the probe measured flat fills exact to the byte, so 18 is pure
 * margin over SwiftShader dithering.
 */
const COLOR_TOLERANCE = 18;

/**
 * Swatch-coloured pixels the sampling rect must hold. The rect is the swatch
 * inset by 0.15 world units (110 × 110 px = 12 100), and the probe measured
 * every one of them on-colour; 6 000 is half.
 */
const MINIMUM_SWATCH_PIXELS = 6_000;

/**
 * Panel-background pixels inside the panel's rectangle. The panel is
 * 480 × 232 px = 111 360, of which the probe measured 86 855 background (the
 * rest is buttons and glyph ink); 30 000 is a third of that.
 */
const MINIMUM_PANEL_PIXELS = 30_000;

/**
 * Face-coloured pixels inside a button's sampling rect (the face inset by
 * 0.1 world units, 100 × 40 px = 4 000). The probe measured 3 623 … 3 716
 * idle and 3 720 hovered — the shortfall from 4 000 is the caption's glyphs —
 * so 1 500 is a wide margin that still fails on a face wearing the wrong
 * state's colour, whose pixels count as zero here (see
 * {@link COLOR_TOLERANCE}).
 */
const MINIMUM_BUTTON_PIXELS = 1_500;

/**
 * Glyph-ink pixels inside the panel: a pixel whose channel sum reaches 550 is
 * label tint (sum 730) at ≥ ~70 % coverage, over any surface in the panel.
 * The probe measured 1 376 across the three labels and three captions; 400 is
 * a third, and a text path that rendered nothing measures zero.
 */
const INK_SUM_MINIMUM = 550;
const MINIMUM_INK_PIXELS = 400;

/**
 * Focus-ring pixels around a focused button. The ring extends 0.06 world
 * units past the face on every side, so its visible border is
 * `132 × 72 − 120 × 60 = 2 304` px — the probe measured exactly that. 800 is
 * a third; an invisible ring measures zero.
 */
const MINIMUM_RING_PIXELS = 800;

/** Seconds to keep polling screenshots for an expected repaint. */
const REPAINT_BUDGET_SECONDS = 8;

/**
 * Seconds the page is given to *not* react after a click that must change
 * nothing — an upper bound on event delivery, not a performance floor. The
 * listeners run synchronously inside the event; 0.3 s is ~18 frames at 60 Hz.
 */
const SETTLE_SECONDS = 0.3;

/** Budget for `waitForFunction` on the page's own `data-*` account. */
const STATE_TIMEOUT_MILLISECONDS = 15_000;

// ---------------------------------------------------------------------------
// Coordinates and pixel counting
// ---------------------------------------------------------------------------

/** A rectangle in CSS pixels, as `Locator.boundingBox` reports one. */
interface CssRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A half-open pixel rectangle inside a screenshot. */
interface PixelBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
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

/** World X → viewport CSS X, through the canvas's live rectangle. */
function worldToClientX(rect: CssRect, worldX: number): number {
  return (
    rect.x + ((worldX - VIEW_LEFT) / (VIEW_RIGHT - VIEW_LEFT)) * rect.width
  );
}

/** World Y → viewport CSS Y. Y flips: world +Y is up, client +Y is down. */
function worldToClientY(rect: CssRect, worldY: number): number {
  return (
    rect.y + ((VIEW_TOP - worldY) / (VIEW_TOP - VIEW_BOTTOM)) * rect.height
  );
}

/**
 * World rectangle → the screenshot pixels covering it, clipped to the image.
 * Normalizing by the image's own size keeps every measurement DPR-agnostic.
 */
function worldBoxToPixels(
  image: DecodedImage,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): PixelBox {
  const toColumn = (x: number): number =>
    Math.round(((x - VIEW_LEFT) / (VIEW_RIGHT - VIEW_LEFT)) * image.width);
  const toRow = (y: number): number =>
    Math.round(((VIEW_TOP - y) / (VIEW_TOP - VIEW_BOTTOM)) * image.height);
  return {
    left: Math.max(0, toColumn(minX)),
    right: Math.min(image.width, toColumn(maxX)),
    // World +Y is up, rows count down, so the *top* row comes from `maxY`.
    top: Math.max(0, toRow(maxY)),
    bottom: Math.min(image.height, toRow(minY)),
  };
}

/** How many pixels inside `box` sit within {@link COLOR_TOLERANCE} of `color`. */
function countNear(image: DecodedImage, box: PixelBox, color: Rgb): number {
  let count = 0;
  for (let y = box.top; y < box.bottom; y++) {
    const rowStart = y * image.width * image.bytesPerPixel;
    for (let x = box.left; x < box.right; x++) {
      const at = rowStart + x * image.bytesPerPixel;
      if (
        Math.abs(image.pixels[at] - color[0]) <= COLOR_TOLERANCE &&
        Math.abs(image.pixels[at + 1] - color[1]) <= COLOR_TOLERANCE &&
        Math.abs(image.pixels[at + 2] - color[2]) <= COLOR_TOLERANCE
      ) {
        count += 1;
      }
    }
  }
  return count;
}

/** How many pixels inside `box` are glyph ink (channel sum ≥ the ink bar). */
function countInk(image: DecodedImage, box: PixelBox): number {
  let count = 0;
  for (let y = box.top; y < box.bottom; y++) {
    const rowStart = y * image.width * image.bytesPerPixel;
    for (let x = box.left; x < box.right; x++) {
      const at = rowStart + x * image.bytesPerPixel;
      const sum =
        image.pixels[at] + image.pixels[at + 1] + image.pixels[at + 2];
      if (sum >= INK_SUM_MINIMUM) count += 1;
    }
  }
  return count;
}

/** The swatch's sampling rectangle: the quad inset by 0.15 world units. */
function swatchBox(image: DecodedImage): PixelBox {
  return worldBoxToPixels(
    image,
    SWATCH_CENTER_X - SWATCH_HALF + 0.15,
    SWATCH_CENTER_Y - SWATCH_HALF + 0.15,
    SWATCH_CENTER_X + SWATCH_HALF - 0.15,
    SWATCH_CENTER_Y + SWATCH_HALF - 0.15,
  );
}

/** A button's face sampling rectangle: the face inset by 0.1 world units. */
function buttonBox(image: DecodedImage, centerX: number): PixelBox {
  return worldBoxToPixels(
    image,
    centerX - BUTTON_WIDTH / 2 + 0.1,
    BUTTON_CENTER_Y - BUTTON_HEIGHT / 2 + 0.1,
    centerX + BUTTON_WIDTH / 2 - 0.1,
    BUTTON_CENTER_Y + BUTTON_HEIGHT / 2 - 0.1,
  );
}

/** The rectangle that contains a button's focus ring, with margin. */
function ringBox(image: DecodedImage, centerX: number): PixelBox {
  return worldBoxToPixels(
    image,
    centerX - BUTTON_WIDTH / 2 - 0.1,
    BUTTON_CENTER_Y - BUTTON_HEIGHT / 2 - 0.1,
    centerX + BUTTON_WIDTH / 2 + 0.1,
    BUTTON_CENTER_Y + BUTTON_HEIGHT / 2 + 0.1,
  );
}

/**
 * Screenshots until `count` reaches `minimum` or the budget runs out, and
 * returns the last count — the caller asserts on it, so a failure carries the
 * real number. Polling with an early exit rather than sleeping a guessed
 * interval: a screenshot costs ~250 ms under SwiftShader, so the poll is
 * self-pacing and a fast machine exits on its first frame.
 */
async function pollForPixels(
  canvas: Locator,
  count: (image: DecodedImage) => number,
  minimum: number,
): Promise<number> {
  const deadline = Date.now() + REPAINT_BUDGET_SECONDS * 1000;
  let last = 0;
  do {
    last = count(await grab(canvas));
    if (last >= minimum) break;
  } while (Date.now() < deadline);
  return last;
}

// ---------------------------------------------------------------------------
// Page plumbing
// ---------------------------------------------------------------------------

/** Errors seen since the page was created, in the order the browser saw them. */
type ErrorLog = readonly string[];

/** The `#status` element's data attributes, as the page publishes them. */
interface StatusData {
  state?: string;
  frames?: string;
  swatch?: string;
  clicks?: string;
  source?: string;
  label?: string;
  focused?: string;
  hover?: string;
}

async function readStatus(page: Page): Promise<StatusData> {
  return page
    .locator("#status")
    .evaluate((element: HTMLElement) => Object.assign({}, element.dataset));
}

/**
 * Waits until one `#status` data attribute reports `expected` — the page's own
 * account of the interaction, flipped by the frame after the event, so this is
 * an event wait with a budget rather than a sleep.
 */
async function waitForStatus(
  page: Page,
  key: string,
  expected: string,
): Promise<void> {
  await page.waitForFunction(
    ([k, value]) =>
      document.querySelector<HTMLElement>("#status")?.dataset[k] === value,
    [key, expected] as const,
    { timeout: STATE_TIMEOUT_MILLISECONDS },
  );
}

/**
 * Opens the demo and waits for its readiness gate: `data-state="running"` is
 * set on the first `update` event and `data-frames` counts host frames, so
 * both together mean the loop is really rendering.
 *
 * `favicon.ico` is served rather than 404-ed, for `example.spec.ts`'s reason:
 * the browser asks for it on its own, the example ships none, and the
 * resulting console error would otherwise need an allowlist that would also
 * excuse a real 404.
 */
async function openDemo(
  page: Page,
): Promise<{ canvas: Locator; rect: CssRect; errors: ErrorLog }> {
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
  await page.goto(UI_URL, { waitUntil: "load" });

  await page.waitForFunction(
    () => {
      const status = document.querySelector<HTMLElement>("#status");
      return (
        status?.dataset["state"] === "running" &&
        Number(status.dataset["frames"] ?? "0") > 0
      );
    },
    undefined,
    { timeout: 20_000 },
  );

  const canvas = page.locator("#scene");
  await expect(canvas).toBeVisible();
  const rect = await cssRectOf(canvas);
  return { canvas, rect, errors };
}

/** A real click at a world position: move there, press, release. */
async function clickWorld(
  page: Page,
  rect: CssRect,
  worldX: number,
  worldY: number,
): Promise<void> {
  await page.mouse.click(
    worldToClientX(rect, worldX),
    worldToClientY(rect, worldY),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("examples/ui-demo (§73–§75): @fourjs/ui in a rendered scene", () => {
  test("loads: the package-laid-out, application-skinned UI reaches the framebuffer", async ({
    page,
  }) => {
    const { canvas, errors } = await openDemo(page);

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

    // The page's initial account of itself: nothing clicked, nothing focused,
    // nothing hovered, the first option selected.
    const status = await readStatus(page);
    expect(status.swatch).toBe("coral");
    expect(status.clicks).toBe("0");
    expect(status.source).toBe("none");
    expect(status.focused).toBe("none");
    expect(status.hover).toBe("none");
    expect(status.label).toBe("swatch: coral");

    // The framebuffer's account: every surface below is drawn by an
    // application skin at a position §74's layout resolved, so together they
    // are the composed §73 claim. The probe measured 12 100 / 86 855 /
    // 3 623+ / 1 376 respectively.
    const image = await grab(canvas);
    expect(
      countNear(image, swatchBox(image), SWATCH_COLORS.coral),
      "the swatch quad did not render coral",
    ).toBeGreaterThanOrEqual(MINIMUM_SWATCH_PIXELS);

    const panel = worldBoxToPixels(
      image,
      PANEL_LEFT,
      PANEL_TOP - PANEL_HEIGHT,
      PANEL_LEFT + PANEL_WIDTH,
      PANEL_TOP,
    );
    expect(
      countNear(image, panel, PANEL_COLOR),
      "the panel's background skin never painted",
    ).toBeGreaterThanOrEqual(MINIMUM_PANEL_PIXELS);

    for (const centerX of BUTTON_CENTERS_X) {
      expect(
        countNear(image, buttonBox(image, centerX), BUTTON_IDLE),
        `the button at world x = ${String(centerX)} is not wearing its idle face`,
      ).toBeGreaterThanOrEqual(MINIMUM_BUTTON_PIXELS);
    }

    expect(
      countInk(image, panel),
      "no glyph ink inside the panel — the label skins drew no text",
    ).toBeGreaterThanOrEqual(MINIMUM_INK_PIXELS);

    expect(errors).toEqual([]);
  });

  test("clicking each button activates it exactly once and recolours the swatch; a miss changes nothing", async ({
    page,
  }) => {
    const { canvas, rect, errors } = await openDemo(page);

    // Click the three buttons in an order that changes the selection every
    // time (the first option is already selected, so start with the second).
    const order = [1, 2, 0] as const;
    for (const [step, index] of order.entries()) {
      const name = BUTTON_NAMES[index];
      await clickWorld(page, rect, BUTTON_CENTERS_X[index], BUTTON_CENTER_Y);

      // The page's account: the swatch switched, the click was delivered
      // exactly once (`data-clicks` is a total, so a double delivery fails
      // the equality), the source was the pointer, and §72's focus-on-press
      // left the pressed button focused.
      await waitForStatus(page, "swatch", name);
      await waitForStatus(page, "clicks", String(step + 1));
      const status = await readStatus(page);
      expect(status.source).toBe("pointer");
      expect(status.focused).toBe(name);
      expect(status.label).toBe(`swatch: ${name}`);

      // The pixels' account: the swatch quad really repainted.
      const swatchPixels = await pollForPixels(
        canvas,
        (image) => countNear(image, swatchBox(image), SWATCH_COLORS[name]),
        MINIMUM_SWATCH_PIXELS,
      );
      expect(
        swatchPixels,
        `the swatch never repainted ${name} after its button was clicked`,
      ).toBeGreaterThanOrEqual(MINIMUM_SWATCH_PIXELS);
    }

    // A click that hits nothing must change nothing: picking returns no hit,
    // so no event is dispatched at all. The wait is an upper bound on event
    // delivery, not a performance floor.
    await clickWorld(page, rect, EMPTY_POINT_X, EMPTY_POINT_Y);
    await waitForFrames(page, framesFor(SETTLE_SECONDS));
    const after = await readStatus(page);
    expect(
      after.clicks,
      "a click on empty background activated something",
    ).toBe(String(order.length));
    expect(after.swatch).toBe(BUTTON_NAMES[order[order.length - 1]]);

    expect(errors).toEqual([]);
  });

  test("hovering a button restyles its face, and leaving restores it (§72)", async ({
    page,
  }) => {
    const { canvas, rect, errors } = await openDemo(page);
    const mintX = BUTTON_CENTERS_X[1];

    // Move onto the middle button: `pointerenter` flips the widget's hover
    // flag, the skin repaints the face, and the page reports both.
    await page.mouse.move(
      worldToClientX(rect, mintX),
      worldToClientY(rect, BUTTON_CENTER_Y),
    );
    await waitForStatus(page, "hover", "mint");
    const hoverPixels = await pollForPixels(
      canvas,
      (image) => countNear(image, buttonBox(image, mintX), BUTTON_HOVER),
      MINIMUM_BUTTON_PIXELS,
    );
    expect(
      hoverPixels,
      "the hovered button's face never repainted in the hover colour",
    ).toBeGreaterThanOrEqual(MINIMUM_BUTTON_PIXELS);

    // Move off it: `pointerleave` clears the flag and the face goes idle.
    await page.mouse.move(
      worldToClientX(rect, EMPTY_POINT_X),
      worldToClientY(rect, EMPTY_POINT_Y),
    );
    await waitForStatus(page, "hover", "none");
    const idlePixels = await pollForPixels(
      canvas,
      (image) => countNear(image, buttonBox(image, mintX), BUTTON_IDLE),
      MINIMUM_BUTTON_PIXELS,
    );
    expect(
      idlePixels,
      "the button's face never returned to the idle colour after the pointer left",
    ).toBeGreaterThanOrEqual(MINIMUM_BUTTON_PIXELS);

    expect(errors).toEqual([]);
  });

  test("Tab walks the focus, the ring is drawn, and Enter activates (§72, §75)", async ({
    page,
  }) => {
    const { canvas, errors } = await openDemo(page);

    // First Tab: nothing is focused, so `keyboardFocusTarget` routes the key to
    // the UI root, the package's traversal listener hears it and focuses the
    // first button, and the skin shows the ring. Every step of that is the
    // engine's as of A-10/A-13 — the page installs a `KeyboardInput` on
    // `window` and maps no keys itself.
    await page.keyboard.press("Tab");
    await waitForStatus(page, "focused", "coral");
    const ringPixels = await pollForPixels(
      canvas,
      (image) =>
        countNear(image, ringBox(image, BUTTON_CENTERS_X[0]), FOCUS_RING),
      MINIMUM_RING_PIXELS,
    );
    expect(
      ringPixels,
      "the focused button's ring never reached the framebuffer",
    ).toBeGreaterThanOrEqual(MINIMUM_RING_PIXELS);

    // Second and third Tab: the focus moves — and with it the
    // one-owner-per-scene-root guarantee: the page reports a single focused
    // widget. Shift-Tab then walks back, which the hand-written handler this
    // replaced could not do at all.
    await page.keyboard.press("Tab");
    await waitForStatus(page, "focused", "mint");
    await page.keyboard.press("Tab");
    await waitForStatus(page, "focused", "azure");
    await page.keyboard.press("Shift+Tab");
    await waitForStatus(page, "focused", "mint");

    // Enter activates the focused button through `Button`'s own key listener —
    // same `uiactivate` as a click, distinguished only by its source.
    await page.keyboard.press("Enter");
    await waitForStatus(page, "swatch", "mint");
    const status = await readStatus(page);
    expect(status.clicks).toBe("1");
    expect(status.source).toBe("keyboard");
    expect(status.label).toBe("swatch: mint");

    const swatchPixels = await pollForPixels(
      canvas,
      (image) => countNear(image, swatchBox(image), SWATCH_COLORS.mint),
      MINIMUM_SWATCH_PIXELS,
    );
    expect(
      swatchPixels,
      "the swatch never repainted after a keyboard activation",
    ).toBeGreaterThanOrEqual(MINIMUM_SWATCH_PIXELS);

    // Space is the other §75 activation key, on the same path. Tab first, so
    // the selection actually changes and `data-swatch` can prove it.
    await page.keyboard.press("Tab");
    await waitForStatus(page, "focused", "azure");
    await page.keyboard.press(" ");
    await waitForStatus(page, "swatch", "azure");
    const afterSpace = await readStatus(page);
    expect(afterSpace.clicks).toBe("2");
    expect(afterSpace.source).toBe("keyboard");

    expect(errors).toEqual([]);
  });
});
