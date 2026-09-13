/**
 * Phase 3a exit evidence: §106a's "pointer events, picking, dragging, sprites
 * and labels work in a mixed 2D/3D example" (WP-3a.6).
 *
 * The WP-3.8 gate proves the example draws and the WP-3.9 suite proves it moves
 * smoothly. Neither touches the page. This suite does: every assertion below is
 * driven by Playwright's **real** mouse — CDP-level input that Chromium turns
 * into the same `pointerdown`/`pointermove`/`pointerup` the canvas would get
 * from a hand — and read back out of the framebuffer. Nothing is stubbed,
 * nothing is dispatched from page script, and no engine object is reached into.
 * What is under test is the whole assembled path:
 *
 * ```text
 * Chromium input → canvas pointer event → PointerInput (NDC + Y flip)
 *   → pick (§71 camera ray vs. oriented bounds) → scene propagation (§72)
 *   → application listener (recolour / DragManager + §42 authority handover)
 *   → renderer → pixels
 * ```
 *
 * A unit test can check any one of those links. Only a browser can check that
 * the pixel a human aims at is the object the ray finds — the composition of
 * the CSS rectangle, the DPR, the NDC convention, the Y flip, the projection,
 * and the camera's world matrix. A single sign error anywhere in that chain
 * still passes every unit test in `@fourjs/input` and puts the click in the wrong
 * quadrant, which is exactly the defect this file exists to catch.
 *
 * ## What is measured
 *
 * `examples/first-2d-scene/main.ts` (restated as constants below, never
 * imported — see "Method notes"):
 *
 * 1. **A click recolours the thing it lands on.** The tumbling box cycles a
 *    four-entry palette on `click`. Its colour is read as the mean of its own
 *    pixels, and must land on the *next* palette entry — not merely a different
 *    one, which would also be true if the event were delivered twice.
 * 2. **A click that hits nothing changes nothing.** Picking returning no hit
 *    dispatches no event at all (`PointerInput.#dispatch`), so a press on empty
 *    background must leave both shapes' colours alone. This is the half of
 *    propagation that a positive test cannot see: an over-eager fallback
 *    ("no hit → deliver to the root") passes test 1 and fails here.
 * 3. **A drag moves the box, and the box comes back.** The pointer is pressed
 *    on the box, walked across the canvas in eight steps, and released. The
 *    box's centroid must arrive at the world position the pointer walked to;
 *    the box must then resume tumbling (§42 handover back to `"kinematic"`),
 *    and must *stop* following the pointer (the capture was really released).
 * 4. **The label is legible.** The glyph sprites must put real ink in the label's
 *    world band, spread across most of the label's width — a text path that
 *    renders one glyph, or a row of missing-glyph boxes, fails the spread and
 *    the ink count respectively.
 * 5. **None of it logs an error.** Same collection as `example.spec.ts`, over a
 *    session that clicks, drags and releases.
 *
 * ## How a world position becomes a mouse position
 *
 * The camera is orthographic over x ∈ [-4, 4], y ∈ [-3, 3] and the canvas is
 * 800 × 600 CSS pixels, so the mapping either way is affine with no perspective
 * term. Two scales are in play and both are handled explicitly:
 *
 * - **Mouse coordinates are CSS pixels.** They are computed from the canvas's
 *   live `boundingBox()`, so the page's flex centring, the DPR and any future
 *   CSS size are all absorbed; nothing assumes 800 × 600 or an origin at 0, 0.
 * - **Screenshot coordinates are drawing-buffer pixels** — `renderer.resize(…,
 *   window.devicePixelRatio)` makes the buffer the CSS size times the DPR. Every
 *   measurement below therefore normalizes by `image.width`/`image.height`
 *   before un-projecting, so a run at DPR 1 and a run at DPR 2 produce the same
 *   world numbers. {@link expectMatchingAspect} pins the one assumption that
 *   remains: that the two rectangles describe the same view.
 *
 * ## Method notes
 *
 * Nothing here is a golden image. The gate runs on SwiftShader, whose
 * rasterisation and dithering differ from a GPU's, so every threshold is a
 * measurement with margin (§92) and every constant states where its number came
 * from.
 *
 * The scene's numbers are *restated* from the example rather than imported, for
 * the reason `smoothness.spec.ts` gives: a browser gate checks the built page
 * from the outside, and importing the example's constants would let a wrong
 * scene agree with a wrong expectation.
 *
 * The PNG decoder is a copy of `example.spec.ts`'s, as in `smoothness.spec.ts`:
 * Playwright returns an encoded screenshot, comparing compressed bytes would
 * conflate "the picture changed" with "the encoder picked different filters",
 * the workspace pins no image library, and this packet's file scope forbids
 * editing either sibling to share one.
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

async function grab(canvas: Locator): Promise<DecodedImage> {
  return decodePng(await canvas.screenshot());
}

// --- the scene under test ---------------------------------------------------

/*
 * Every constant below restates something `examples/first-2d-scene/main.ts`
 * declares. Duplicated, not imported: see this file's "Method notes".
 */

/** `OrthographicCamera` extents, in world units. */
const VIEW_LEFT = -4;
const VIEW_RIGHT = 4;
const VIEW_BOTTOM = -3;
const VIEW_TOP = 3;

/** The tumbling box: world position it starts at, and its edge length. */
const BOX_HOME_X = -2.7;
const BOX_HOME_Y = 1.8;
const BOX_SIZE = 0.9;

/**
 * Half the box's longest projected extent — the half-diagonal of the cube,
 * `0.9 · √3 / 2 ≈ 0.78`. The box tumbles, so this is the radius of the disc its
 * silhouette always fits inside whatever its orientation.
 */
const BOX_SILHOUETTE_RADIUS = (BOX_SIZE * Math.sqrt(3)) / 2;

/** `CircularTrajectory` radius, and the orbiting disc's own radius. */
const ORBIT_RADIUS = 2;
const ORBITER_RADIUS = 0.45;

/**
 * The four colours the box cycles through on `click`, in cycle order, as the
 * bytes they reach the framebuffer as.
 *
 * `UnlitMaterial` writes its colour straight out with no tone mapping (the
 * finding `smoothness.spec.ts` records), so a byte is the material component
 * times 255: `[0.25, 0.7, 1]` → `(64, 179, 255)`. A component that lands on a
 * half-byte rounds either way — 0.7 × 255 = 178.5 rasterises as 178 here — so
 * these are nominal to ±1, which {@link COLOR_MATCH_TOLERANCE} covers twenty
 * times over.
 */
const BOX_PALETTE: readonly (readonly [number, number, number])[] = [
  [64, 179, 255], // 0.25, 0.70, 1.00 — the colour it is built with
  [89, 217, 140], // 0.35, 0.85, 0.55
  [140, 115, 242], // 0.55, 0.45, 0.95
  [217, 217, 230], // 0.85, 0.85, 0.90
];

/** The four colours the orbiting circle cycles through, same convention. */
const ORBITER_PALETTE: readonly (readonly [number, number, number])[] = [
  [255, 115, 51], // 1.00, 0.45, 0.20 — the colour it is built with
  [255, 184, 38], // 1.00, 0.72, 0.15
  [242, 64, 38], // 0.95, 0.25, 0.15
  [255, 140, 89], // 1.00, 0.55, 0.35
];

/** `layoutText` size (world units per line) and the font's cell geometry. */
const LABEL_SIZE = 0.26;
const FONT_CELL_WIDTH = 6;
const FONT_LINE_HEIGHT = 12;

/** `LABEL_TEXT.length` — "fourJS - click a shape, drag the box". */
const LABEL_CHARACTERS = 37;

/**
 * Width of the label in world units: 37 monospace cells of 6 font pixels, at
 * `size / lineHeight` world units per font pixel. The label group is placed at
 * `-width / 2`, so the text spans `[-2.405, 2.405]`.
 */
const LABEL_WIDTH_WORLD =
  (LABEL_CHARACTERS * FONT_CELL_WIDTH * LABEL_SIZE) / FONT_LINE_HEIGHT;

/**
 * The world band the label's ink occupies, as the packet fixes it.
 *
 * The baseline sits at y = 2.65 and one font pixel is `0.26 / 12` world units.
 * Glyph rows 1…7 carry every letterform's body, i.e. y from `2.65 + 1 · scale`
 * = 2.672 up to `2.65 + 7 · scale` = 2.802, with descenders reaching down to
 * 2.607. `[2.62, 2.80]` is therefore strictly *inside* the ink: it cannot
 * over-count by picking up something else, and the ~2 % of ink outside it only
 * makes the count threshold more conservative.
 */
const LABEL_BAND_LOW_Y = 2.62;
const LABEL_BAND_HIGH_Y = 2.8;

// --- geometry of the interactions -------------------------------------------

/**
 * Where the drag drops the box: the orbit's centre.
 *
 * The choice is forced by measurability, not by taste. The box's centroid is
 * only recoverable while nothing overlaps it, and the orbiting disc sweeps the
 * annulus `2 ± 0.45`. Two bands are safe: inside it (`d < 2 − 0.45 − 0.78 =
 * 0.77`) or outside it (`d > 3.23`, which the ±3.4/±2.2 drag clamp barely
 * allows). The origin is the deepest point of the inner band, is 2.7 × 1.8
 * world units from the box's home — a large, unambiguous displacement — and is
 * clear of the ground (y ≤ −1.75) and of the label (y ≥ 2.6).
 */
const DRAG_TARGET_X = 0;
const DRAG_TARGET_Y = 0;

/**
 * Where a click is aimed when it must hit nothing: 3.06 world units from the
 * origin, so outside the orbiting disc's reach (2.45), well clear of the box at
 * home, and over background rather than the (unpickable) ground plane.
 */
const EMPTY_POINT_X = 3;
const EMPTY_POINT_Y = -0.6;

/**
 * Half-extent of the square region the box's own motion is measured in, world
 * units.
 *
 * It has to contain the box in any orientation — {@link BOX_SILHOUETTE_RADIUS}
 * = 0.78 — and it has to stay clear of the orbiting disc, whose inner edge is
 * `ORBIT_RADIUS − ORBITER_RADIUS` = 1.55 from the origin and whose nearest
 * approach to a square of half-extent `h` centred there is at the corner,
 * `h · √2`. So `h` must lie in `[0.78, 1.096]`, and the midpoint of that
 * interval is as far from either failure as the geometry allows.
 */
const BOX_REGION_HALF_WORLD =
  (BOX_SILHOUETTE_RADIUS + (ORBIT_RADIUS - ORBITER_RADIUS) / Math.SQRT2) / 2;

/** Pointer moves the drag is split into, so it is a drag and not a teleport. */
const DRAG_STEPS = 8;

/** Pause between those moves, seconds — a ~0.24 s gesture in total. */
const DRAG_STEP_SECONDS = 0.03;

// --- tolerances -------------------------------------------------------------

/**
 * Minimum distinct colours for a frame to count as drawn. A cleared canvas has
 * one; this scene measures eight to ten. Same threshold, same reasoning, as the
 * WP-3.8 and WP-3.9 gates.
 */
const MINIMUM_DISTINCT_COLORS = 4;

/**
 * Sum of the three channels at or above which a pixel belongs to a shape rather
 * than to the background.
 *
 * The two background colours are the clear (13, 15, 23) summing to 51 and the
 * ground (26, 33, 48) summing to 107; the *dimmest* palette entry of either
 * shape is (89, 217, 140), summing to 446. 200 sits between 107 and 446 with
 * more than a factor of two of margin on both sides, so no rasterisation or
 * dithering difference can move a pixel across it. Applied to the label band it
 * means the same thing with the same margin: a glyph texel there is tint
 * (224, 235, 255, sum 714) blended over the clear colour, so 200 counts a pixel
 * as ink once its coverage passes ~22 %.
 */
const SHAPE_BRIGHTNESS_MINIMUM = 200;

/**
 * Rows above this world Y are excluded from every *shape* measurement, because
 * the label's near-white tint (224, 235, 255) is within 30 units of the box's
 * fourth palette entry (217, 217, 230) — no colour classifier can separate
 * them, so the label is excluded by position instead.
 *
 * 2.5 sits below the label's lowest ink (2.607) and above the orbiter's highest
 * reach (2.45). It is 0.08 below the box's highest possible extent at home
 * (1.8 + 0.78 = 2.58), so a rotation that presents the cube corner-up loses a
 * sliver of ≲250 px² off a ≳8000 px² silhouette; that shifts the centroid by
 * under 0.03 world units, an order of magnitude inside
 * {@link BOX_POSITION_TOLERANCE_WORLD}. At the drag target the box is nowhere
 * near the cut and the bias is exactly zero.
 */
const SHAPE_SEARCH_TOP_Y = 2.5;

/**
 * Fraction of the canvas a shape must cover for its measurement to be trusted.
 *
 * The box is 0.9 world units on a side across a 8 × 6 world view — between 1.7 %
 * (face-on) and 2.6 % (corner-on) of the pixels — and the disc is ~1.3 %.
 * Requiring 0.3 % tolerates a classifier that drops every antialiased edge
 * pixel and still rejects a stray speck. Same threshold and same reasoning as
 * `smoothness.spec.ts`'s orbiter coverage.
 */
const MINIMUM_SHAPE_COVERAGE = 0.003;

/**
 * How far a measured mean colour may sit from a palette entry, in RGB byte
 * distance, and still be called that entry.
 *
 * The closest two entries within a palette are 70 units apart (the orbiter's
 * (255, 115, 51) and (255, 140, 89)), so anything below 35 cannot mis-identify
 * an entry. Measured error on the reference run was 1 byte or less: the
 * classifiers' brightness bar excludes blended edge pixels outright, so every
 * pixel that reaches the mean carries the flat fill, and the whole residual is
 * the material's own rounding (0.7 × 255 = 178.5 rasterised as 178). 24 is
 * twenty times that and half of what could mis-identify an entry.
 */
const COLOR_MATCH_TOLERANCE = 24;

/**
 * How far apart two mean colours must be to count as "the colour changed".
 *
 * Consecutive palette entries are 70 units apart at the closest (orbiter) and
 * 123 at the closest for the box; the reference run measured the box's first
 * click as a move of 124.0 bytes, and a colour that did *not* change as a move
 * of 0.0. 40 sits between those with a factor of three of margin on the change
 * and no plausible way for a static colour to reach it.
 */
const COLOR_CHANGE_MINIMUM = 40;

/**
 * How far the box's measured centroid may sit from where the pointer put it,
 * in world units.
 *
 * The centroid is unbiased in principle — a cube is centrally symmetric, so its
 * orthographic silhouette is too, and the silhouette's centroid is the
 * projection of its centre whatever the rotation. What is left is measurement
 * and input noise: pixel quantisation (0.01 world at DPR 1), Chromium rounding
 * client coordinates to whole CSS pixels at both ends of the gesture (0.01),
 * and up to one fixed step of pose interpolation lag if a frame is caught
 * mid-flight (which the settle wait removes). The reference run measured 0.000
 * at both ends of the gesture — the orthographic drag delta is exact — so 0.15
 * world units (15 CSS pixels, a sixth of the box) is pure margin, and it is far
 * below the 3.24 world units the box is asked to travel, so a drag that applied
 * half the delta, doubled it, or flipped a sign fails.
 */
const BOX_POSITION_TOLERANCE_WORLD = 0.15;

/**
 * Minimum pixels that must change inside the box's own region between two
 * frames 0.2 s apart for it to count as tumbling again.
 *
 * The box rotates at (0.7, 1.1, 0) rad/s, so 0.2 s turns it ~0.14/0.22 rad and
 * sweeps its 90 × 90 px silhouette edges across thousands of pixels; the
 * reference run measured 2108. 100 is twenty times below that and far above the
 * zero a box left under `"manual"` authority — the §42 handover never given
 * back — would produce.
 */
const MINIMUM_TUMBLE_PIXELS = 100;

/**
 * Minimum ink pixels in the label band, as the packet fixes it.
 *
 * 30 of the 37 characters are non-blank, each a 5 × 7 letterform on a 6 × 12
 * cell scaled to ~2.17 CSS pixels per font pixel (≈ 4.7 px² per font pixel).
 * A typical letterform lights ~15–20 of its 35 cells, so ~2000–2800 is expected
 * at DPR 1 and four times that at DPR 2; the reference run measured 2628. 500
 * is a factor of five below that — it survives a change of font or of tint —
 * while a label that renders a single glyph (~90 px) or no glyphs at all cannot
 * reach it.
 */
const LABEL_MINIMUM_INK_PIXELS = 500;

/**
 * Minimum horizontal spread of that ink, as a fraction of the label's width.
 *
 * The ink really spans 4.790 of the label's 4.810 world units — the reference
 * run's measurement, the missing 0.02 being the last cell's inter-glyph column
 * — so requiring half is a factor of two of margin. It
 * is the assertion that distinguishes laid-out text from a pile of glyphs at
 * one position: a layout that ignored `advance` would stack every quad at x = 0
 * and spread 0.13 world units.
 */
const LABEL_MINIMUM_SPREAD_FRACTION = 0.5;

/** Seconds to keep screenshotting before giving up on a first drawn frame. */
const DRAW_BUDGET_SECONDS = 5;

/**
 * Seconds to let the page settle after an input before measuring.
 *
 * The listeners run synchronously inside the event, so one frame would do; 0.25 s
 * is ~15 frames at 60 Hz, which is margin for SwiftShader's slower ones and for
 * the pose buffer's one-fixed-step interpolation lag after a transform write.
 */
const SETTLE_SECONDS = 0.25;

/** Seconds between the two frames the "still tumbling" check compares. */
const TUMBLE_GAP_SECONDS = 0.2;

// --- coordinate mapping ------------------------------------------------------

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

/** An RGB colour as framebuffer bytes. */
type Rgb = readonly [number, number, number];

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
 * Screenshot column → world X. Normalizing by `image.width` first is what makes
 * every measurement here DPR-agnostic (see the header).
 */
function imageToWorldX(image: DecodedImage, column: number): number {
  return VIEW_LEFT + ((column + 0.5) / image.width) * (VIEW_RIGHT - VIEW_LEFT);
}

/** Screenshot row → world Y. */
function imageToWorldY(image: DecodedImage, row: number): number {
  return VIEW_TOP - ((row + 0.5) / image.height) * (VIEW_TOP - VIEW_BOTTOM);
}

/** World rectangle → the screenshot pixels covering it, clipped to the image. */
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

/**
 * Fails unless the screenshot and the CSS rectangle describe the same view.
 *
 * The two are allowed to differ in scale — that is the DPR — but not in shape.
 * If they ever did, every world position computed from one and pointed at with
 * the other would be silently wrong, which is precisely the class of defect
 * this suite exists to catch, so it is checked rather than assumed.
 */
function expectMatchingAspect(image: DecodedImage, rect: CssRect): void {
  const imageAspect = image.width / image.height;
  const cssAspect = rect.width / rect.height;
  expect(
    Math.abs(imageAspect - cssAspect),
    `the screenshot is ${String(image.width)}×${String(image.height)} but the canvas ` +
      `is ${String(rect.width)}×${String(rect.height)} CSS px — mouse coordinates and ` +
      `pixel measurements would disagree`,
  ).toBeLessThan(0.01);
}

// --- classifying pixels ------------------------------------------------------

/**
 * Whether a pixel belongs to the box.
 *
 * Every colour the box can be is *cool* — blue at least as strong as red — and
 * every colour the orbiter can be is warm by a margin of at least 166 (the
 * example keeps the two palettes in disjoint gamuts on purpose, so that the
 * gates can tell the shapes apart whatever a click has done). Requiring
 * `b + 20 ≥ r` accepts all four box entries (margins 191, 51, 102, 13) and
 * rejects all four orbiter entries by more than 140. The brightness bar removes
 * the ground and the clear colour; the label is removed by position, see
 * {@link SHAPE_SEARCH_TOP_Y}.
 */
function isBoxPixel(r: number, g: number, b: number): boolean {
  return r + g + b >= SHAPE_BRIGHTNESS_MINIMUM && b + 20 >= r;
}

/**
 * Whether a pixel belongs to the orbiting circle — `smoothness.spec.ts`'s
 * classifier, unchanged, and for the same reason: a bright red channel that
 * dominates blue selects all four of the orbiter's warm palette entries
 * (margins 204, 217, 204, 166) and nothing else in the scene, and it rejects
 * the antialiased rim symmetrically so the centroid stays put.
 */
function isOrbiterPixel(r: number, g: number, b: number): boolean {
  return r >= 180 && r - b >= 90 && g > b;
}

/** What one shape measurement recovers from a frame. */
interface ShapeFix {
  /** Centroid of the matched pixels, in world units. */
  readonly x: number;
  readonly y: number;
  /** Mean colour of those pixels, as framebuffer bytes. */
  readonly color: Rgb;
  /** How many pixels matched, and what fraction of the canvas that is. */
  readonly matched: number;
  readonly coverage: number;
}

/**
 * Finds one shape's pixels, and returns where they are and what colour they
 * are, or `null` when the shape is not on screen.
 *
 * The mean colour is taken over every matched pixel, with no erosion of the
 * shape's edge: a blended edge pixel is mostly background, so it fails the
 * classifier's brightness bar before it can bias anything, and the measured
 * mean on the reference run was the flat fill to within a byte. A mean whose
 * residual bias is stated and measured is easier to reason about than a filter
 * whose behaviour depends on how the rasteriser antialiases.
 */
function measureShape(
  image: DecodedImage,
  matches: (r: number, g: number, b: number) => boolean,
): ShapeFix | null {
  if (image.bytesPerPixel < 3) return null;
  const firstRow = worldBoxToPixels(
    image,
    VIEW_LEFT,
    VIEW_BOTTOM,
    VIEW_RIGHT,
    SHAPE_SEARCH_TOP_Y,
  ).top;

  let sumX = 0;
  let sumY = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let matched = 0;
  for (let y = firstRow; y < image.height; y++) {
    const rowStart = y * image.width * image.bytesPerPixel;
    for (let x = 0; x < image.width; x++) {
      const at = rowStart + x * image.bytesPerPixel;
      const r = image.pixels[at];
      const g = image.pixels[at + 1];
      const b = image.pixels[at + 2];
      if (!matches(r, g, b)) continue;
      sumX += x;
      sumY += y;
      sumR += r;
      sumG += g;
      sumB += b;
      matched += 1;
    }
  }
  if (matched === 0) return null;
  return {
    x: imageToWorldX(image, sumX / matched),
    y: imageToWorldY(image, sumY / matched),
    color: [sumR / matched, sumG / matched, sumB / matched],
    matched,
    coverage: matched / pixelCount(image),
  };
}

/** Euclidean distance between two colours, in RGB byte units. */
function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Index of the palette entry a measured colour is closest to. */
function nearestPaletteIndex(palette: readonly Rgb[], color: Rgb): number {
  let best = 0;
  let bestDistance = Infinity;
  for (const [index, entry] of palette.entries()) {
    const distance = colorDistance(entry, color);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

/** `(64.0, 179.0, 255.0)` — for messages. */
function formatColor(color: Rgb): string {
  return `(${color[0].toFixed(1)}, ${color[1].toFixed(1)}, ${color[2].toFixed(1)})`;
}

/** How many pixels differ between two frames inside `box`. */
function changedPixelsIn(
  before: DecodedImage,
  after: DecodedImage,
  box: PixelBox,
): number {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error("Frames have different sizes.");
  }
  let changed = 0;
  for (let y = box.top; y < box.bottom; y++) {
    const row = y * before.width;
    for (let x = box.left; x < box.right; x++) {
      if (colorAt(before, row + x) !== colorAt(after, row + x)) changed += 1;
    }
  }
  return changed;
}

// --- page driving -----------------------------------------------------------

/** Errors seen since the page was created, in the order the browser saw them. */
type ErrorLog = readonly string[];

/**
 * Opens the example and returns its live error log.
 *
 * `favicon.ico` is served rather than 404-ed: the browser asks for it on its
 * own, the example ships none, and the resulting "failed to load resource"
 * console error would otherwise have to be excused by an allowlist — which
 * would also excuse a real 404 for a real asset. Same routing, same reasoning,
 * as `example.spec.ts`.
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

/** The canvas, once it is visible and has drawn something. */
async function openDrawnExample(
  page: Page,
): Promise<{ canvas: Locator; rect: CssRect; errors: ErrorLog }> {
  const errors = await openExample(page);
  const canvas = page.locator("#scene");
  await expect(canvas).toBeVisible();
  const frame = await waitForDrawnFrame(canvas);
  expect(
    distinctColors(frame),
    "the canvas never drew, so there is nothing to interact with",
  ).toBeGreaterThanOrEqual(MINIMUM_DISTINCT_COLORS);
  const rect = await cssRectOf(canvas);
  expectMatchingAspect(frame, rect);
  return { canvas, rect, errors };
}

/** Measures a shape, failing with a legible message when it is not found. */
function requireShape(
  image: DecodedImage,
  matches: (r: number, g: number, b: number) => boolean,
  what: string,
): ShapeFix {
  const fix = measureShape(image, matches);
  expect(fix, `no ${what} pixels — the scene lost it`).not.toBeNull();
  const found = fix as ShapeFix;
  expect(
    found.coverage,
    `only ${String(found.matched)} ${what} pixels, too few to trust`,
  ).toBeGreaterThanOrEqual(MINIMUM_SHAPE_COVERAGE);
  return found;
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

// --- tests ------------------------------------------------------------------

test.describe("§106a: pointer events, picking, dragging and labels in the browser", () => {
  test("clicking the box recolours it to the next palette entry", async ({
    page,
  }) => {
    const { canvas, rect, errors } = await openDrawnExample(page);

    const before = requireShape(await grab(canvas), isBoxPixel, "box");
    const beforeIndex = nearestPaletteIndex(BOX_PALETTE, before.color);
    console.log(
      `box pixels: ${String(before.matched)} (${(before.coverage * 100).toFixed(2)} % of the canvas)`,
    );
    expect(
      colorDistance(BOX_PALETTE[beforeIndex], before.color),
      `the box measured ${formatColor(before.color)}, which is not one of its palette entries`,
    ).toBeLessThanOrEqual(COLOR_MATCH_TOLERANCE);

    // The centre of the box is inside its silhouette whatever its rotation, so
    // this pixel is the box for the picker as well as for a human.
    await clickWorld(page, rect, BOX_HOME_X, BOX_HOME_Y);
    await waitForFrames(page, framesFor(SETTLE_SECONDS));

    const after = requireShape(await grab(canvas), isBoxPixel, "box");
    const afterIndex = nearestPaletteIndex(BOX_PALETTE, after.color);
    console.log(
      `box colour ${formatColor(before.color)} (entry ${String(beforeIndex)}) → ` +
        `${formatColor(after.color)} (entry ${String(afterIndex)}), ` +
        `moved ${colorDistance(before.color, after.color).toFixed(1)} bytes`,
    );

    expect(
      colorDistance(before.color, after.color),
      "the box's colour did not change — the click never reached it (picking, " +
        "NDC conversion, propagation, or the click synthesis)",
    ).toBeGreaterThanOrEqual(COLOR_CHANGE_MINIMUM);
    expect(
      colorDistance(BOX_PALETTE[afterIndex], after.color),
      `the box measured ${formatColor(after.color)}, which is not one of its palette entries`,
    ).toBeLessThanOrEqual(COLOR_MATCH_TOLERANCE);
    // Not merely "a different entry": one click must advance the cycle by
    // exactly one, which is what fails if the event is delivered twice — once
    // by capture and once by bubble, say.
    expect(
      afterIndex,
      `one click advanced the palette from ${String(beforeIndex)} to ${String(afterIndex)}; ` +
        "one step was expected, so the click was delivered more than once",
    ).toBe((beforeIndex + 1) % BOX_PALETTE.length);

    // Dragging must not recolour, and a click is a press and release with no
    // drag between them — so the box's position must be exactly where it was.
    expect(
      Math.hypot(after.x - BOX_HOME_X, after.y - BOX_HOME_Y),
      `clicking moved the box to (${after.x.toFixed(3)}, ${after.y.toFixed(3)})`,
    ).toBeLessThanOrEqual(BOX_POSITION_TOLERANCE_WORLD);

    expect(errors).toEqual([]);
  });

  test("clicking empty background changes nothing", async ({ page }) => {
    const { canvas, rect, errors } = await openDrawnExample(page);

    const first = await grab(canvas);
    const boxBefore = requireShape(first, isBoxPixel, "box");
    const orbiterBefore = requireShape(first, isOrbiterPixel, "orbiter");

    await clickWorld(page, rect, EMPTY_POINT_X, EMPTY_POINT_Y);
    await waitForFrames(page, framesFor(SETTLE_SECONDS));

    const second = await grab(canvas);
    const boxAfter = requireShape(second, isBoxPixel, "box");
    const orbiterAfter = requireShape(second, isOrbiterPixel, "orbiter");
    console.log(
      `after a background click: box ${formatColor(boxBefore.color)} → ${formatColor(boxAfter.color)}, ` +
        `orbiter ${formatColor(orbiterBefore.color)} → ${formatColor(orbiterAfter.color)}`,
    );

    // A miss has no propagation path at all (`PointerInput.#dispatch`), so
    // neither shape may hear anything. The orbiter has moved on by now — only
    // its colour is comparable — while the box has not moved at all.
    expect(
      colorDistance(boxBefore.color, boxAfter.color),
      "a click on empty background recoloured the box: a miss is being " +
        "delivered to something",
    ).toBeLessThan(COLOR_CHANGE_MINIMUM);
    expect(
      colorDistance(orbiterBefore.color, orbiterAfter.color),
      "a click on empty background recoloured the orbiter: a miss is being " +
        "delivered to something",
    ).toBeLessThan(COLOR_CHANGE_MINIMUM);
    expect(
      Math.hypot(boxAfter.x - BOX_HOME_X, boxAfter.y - BOX_HOME_Y),
      "a click on empty background moved the box",
    ).toBeLessThanOrEqual(BOX_POSITION_TOLERANCE_WORLD);

    // Stated as palette entries as well as as a distance, so that a scene which
    // recoloured *both* shapes by the same amount cannot pass the two
    // comparisons above.
    expect(
      nearestPaletteIndex(BOX_PALETTE, boxAfter.color),
      "the box left its first palette entry without being clicked",
    ).toBe(0);
    expect(
      nearestPaletteIndex(ORBITER_PALETTE, orbiterAfter.color),
      "the orbiter left its first palette entry without being clicked",
    ).toBe(0);
    expect(
      colorDistance(ORBITER_PALETTE[0], orbiterAfter.color),
      `the orbiter measured ${formatColor(orbiterAfter.color)}, which is not its first palette entry`,
    ).toBeLessThanOrEqual(COLOR_MATCH_TOLERANCE);

    expect(errors).toEqual([]);
  });

  test("dragging the box moves it, and it tumbles again once dropped", async ({
    page,
  }) => {
    const { canvas, rect, errors } = await openDrawnExample(page);

    const start = requireShape(await grab(canvas), isBoxPixel, "box");
    console.log(
      `box starts at world (${start.x.toFixed(3)}, ${start.y.toFixed(3)})`,
    );
    expect(
      Math.hypot(start.x - BOX_HOME_X, start.y - BOX_HOME_Y),
      "the box is not where the example puts it, so the drag cannot be aimed",
    ).toBeLessThanOrEqual(BOX_POSITION_TOLERANCE_WORLD);

    // Press on the box, walk to the target, release. Every event here is a real
    // Chromium input event; the engine sees exactly what a hand would produce.
    await page.mouse.move(
      worldToClientX(rect, BOX_HOME_X),
      worldToClientY(rect, BOX_HOME_Y),
    );
    await page.mouse.down();
    for (let step = 1; step <= DRAG_STEPS; step++) {
      const fraction = step / DRAG_STEPS;
      await page.mouse.move(
        worldToClientX(
          rect,
          BOX_HOME_X + (DRAG_TARGET_X - BOX_HOME_X) * fraction,
        ),
        worldToClientY(
          rect,
          BOX_HOME_Y + (DRAG_TARGET_Y - BOX_HOME_Y) * fraction,
        ),
      );
      await waitForFrames(page, framesFor(DRAG_STEP_SECONDS));
    }
    await page.mouse.up();
    await waitForFrames(page, framesFor(SETTLE_SECONDS));

    const dropped = requireShape(await grab(canvas), isBoxPixel, "box");
    const error = Math.hypot(
      dropped.x - DRAG_TARGET_X,
      dropped.y - DRAG_TARGET_Y,
    );
    console.log(
      `box dropped at world (${dropped.x.toFixed(3)}, ${dropped.y.toFixed(3)}) = CSS ` +
        `(${worldToClientX(rect, dropped.x).toFixed(1)}, ${worldToClientY(rect, dropped.y).toFixed(1)}); ` +
        `target (${String(DRAG_TARGET_X)}, ${String(DRAG_TARGET_Y)}), error ${error.toFixed(3)} world units`,
    );
    expect(
      error,
      `the pointer walked to (${String(DRAG_TARGET_X)}, ${String(DRAG_TARGET_Y)}) but the box ` +
        `ended at (${dropped.x.toFixed(3)}, ${dropped.y.toFixed(3)}) — the world delta the drag ` +
        "derived from the pointer's motion is wrong",
    ).toBeLessThanOrEqual(BOX_POSITION_TOLERANCE_WORLD);

    // The box's own neighbourhood — see {@link BOX_REGION_HALF_WORLD} for why
    // it is the size it is.
    const boxRegion = worldBoxToPixels(
      await grab(canvas),
      dropped.x - BOX_REGION_HALF_WORLD,
      dropped.y - BOX_REGION_HALF_WORLD,
      dropped.x + BOX_REGION_HALF_WORLD,
      dropped.y + BOX_REGION_HALF_WORLD,
    );

    // §42 handover, second half: the drag gave the transform back to the
    // motion system, so the box must be turning again.
    const firstFrame = await grab(canvas);
    await waitForFrames(page, framesFor(TUMBLE_GAP_SECONDS));
    const secondFrame = await grab(canvas);
    const changed = changedPixelsIn(firstFrame, secondFrame, boxRegion);
    console.log(
      `pixels changed in the box's region over ${String(TUMBLE_GAP_SECONDS)} s after the drop: ${String(changed)}`,
    );
    expect(
      changed,
      "the box is frozen after the drop — its transform authority was never " +
        "handed back to the motion system (§42)",
    ).toBeGreaterThanOrEqual(MINIMUM_TUMBLE_PIXELS);

    // …and the release really released: moving the pointer afterwards must not
    // drag anything, which is what a leaked pointer capture would do.
    await page.mouse.move(
      worldToClientX(rect, EMPTY_POINT_X),
      worldToClientY(rect, EMPTY_POINT_Y),
    );
    await waitForFrames(page, framesFor(SETTLE_SECONDS));
    const afterRelease = requireShape(await grab(canvas), isBoxPixel, "box");
    expect(
      Math.hypot(afterRelease.x - dropped.x, afterRelease.y - dropped.y),
      `the box followed the pointer after the release, to ` +
        `(${afterRelease.x.toFixed(3)}, ${afterRelease.y.toFixed(3)}) — the drag never ended`,
    ).toBeLessThanOrEqual(BOX_POSITION_TOLERANCE_WORLD);

    expect(errors).toEqual([]);
  });

  test("the label draws legible ink across its world band", async ({
    page,
  }) => {
    const { canvas, errors } = await openDrawnExample(page);
    const image = await grab(canvas);

    const band = worldBoxToPixels(
      image,
      VIEW_LEFT,
      LABEL_BAND_LOW_Y,
      VIEW_RIGHT,
      LABEL_BAND_HIGH_Y,
    );
    expect(
      band.bottom - band.top,
      "the label band is empty in pixels — the world-to-pixel mapping is wrong",
    ).toBeGreaterThan(0);

    let ink = 0;
    let minColumn = image.width;
    let maxColumn = -1;
    for (let y = band.top; y < band.bottom; y++) {
      const rowStart = y * image.width * image.bytesPerPixel;
      for (let x = band.left; x < band.right; x++) {
        const at = rowStart + x * image.bytesPerPixel;
        const brightness =
          image.pixels[at] + image.pixels[at + 1] + image.pixels[at + 2];
        if (brightness < SHAPE_BRIGHTNESS_MINIMUM) continue;
        ink += 1;
        if (x < minColumn) minColumn = x;
        if (x > maxColumn) maxColumn = x;
      }
    }

    console.log(
      `label band rows ${String(band.top)}…${String(band.bottom)}: ${String(ink)} ink pixels`,
    );
    expect(
      ink,
      "the label's world band is empty — the glyph atlas, the sprite path or " +
        "the layout produced nothing visible",
    ).toBeGreaterThanOrEqual(LABEL_MINIMUM_INK_PIXELS);

    const spread =
      imageToWorldX(image, maxColumn) - imageToWorldX(image, minColumn);
    console.log(
      `label ink spans world x ${imageToWorldX(image, minColumn).toFixed(3)}…` +
        `${imageToWorldX(image, maxColumn).toFixed(3)} (${spread.toFixed(3)} of ` +
        `${LABEL_WIDTH_WORLD.toFixed(3)} world units)`,
    );
    expect(
      spread,
      `the label's ink spans only ${spread.toFixed(3)} of its ${LABEL_WIDTH_WORLD.toFixed(3)} ` +
        "world units — the glyphs are not being laid out along the line",
    ).toBeGreaterThan(LABEL_WIDTH_WORLD * LABEL_MINIMUM_SPREAD_FRACTION);

    expect(errors).toEqual([]);
  });

  test("a full click, miss and drag session logs no errors", async ({
    page,
  }) => {
    const { canvas, rect, errors } = await openDrawnExample(page);

    await clickWorld(page, rect, BOX_HOME_X, BOX_HOME_Y);
    await clickWorld(page, rect, EMPTY_POINT_X, EMPTY_POINT_Y);

    await page.mouse.move(
      worldToClientX(rect, BOX_HOME_X),
      worldToClientY(rect, BOX_HOME_Y),
    );
    await page.mouse.down();
    for (let step = 1; step <= DRAG_STEPS; step++) {
      const fraction = step / DRAG_STEPS;
      await page.mouse.move(
        worldToClientX(
          rect,
          BOX_HOME_X + (DRAG_TARGET_X - BOX_HOME_X) * fraction,
        ),
        worldToClientY(
          rect,
          BOX_HOME_Y + (DRAG_TARGET_Y - BOX_HOME_Y) * fraction,
        ),
      );
      await waitForFrames(page, framesFor(DRAG_STEP_SECONDS));
    }
    await page.mouse.up();

    // A drag that leaves the box under the wrong authority makes the *next*
    // fixed step warn or throw, so keep stepping after the gesture ends.
    await waitForFrames(page, framesFor(SETTLE_SECONDS));
    const frame = await grab(canvas);
    expect(
      distinctColors(frame),
      "the canvas stopped drawing during the interaction session",
    ).toBeGreaterThanOrEqual(MINIMUM_DISTINCT_COLORS);
    // The scene must still hold both shapes: an interaction that removed one
    // would otherwise look like a clean run.
    requireShape(frame, isBoxPixel, "box");
    requireShape(frame, isOrbiterPixel, "orbiter");

    expect(errors).toEqual([]);
  });
});
