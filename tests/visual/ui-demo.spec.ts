/**
 * Visual regression seed (§92 `tests/visual/`, 2026-08-04) — golden-image
 * comparison of the built `examples/ui-demo` canvas.
 *
 * ## Why golden images are sound here, when `tests/browser` forbids them
 *
 * The browser gates' doctrine ("every assertion is a threshold, never a pixel
 * match") exists because SwiftShader rasterises slightly differently from a
 * GPU. That comparison never happens in this suite: the shared Playwright
 * config forces ANGLE-over-SwiftShader unconditionally, so a golden captured
 * here is compared SwiftShader-to-SwiftShader — same rasteriser on the
 * developer sandbox and in CI. The residual drift risk is a Chromium/ANGLE
 * version bump changing anti-aliasing by a pixel, which is what the small
 * `maxDiffPixels` allowance absorbs; a bigger jump legitimately fails the
 * suite and asks a human to look before refreshing.
 *
 * ## Why the UI demo seeds the category
 *
 * A visual golden needs a frame that is a pure function of page state, and
 * `examples/ui-demo` is the one site that is **static at rest**: no clock
 * drives any node, so every rAF draws identical pixels until an interaction
 * changes widget state — and interactions are deterministic. The animated
 * sites (orbits, physics, particles) draw a pose that depends on wall-clock
 * timing at screenshot time; giving them goldens needs an app-side
 * deterministic stepping hook first (recorded as the category's next step).
 *
 * ## Refreshing goldens
 *
 * ```sh
 * bun run examples:build
 * npx playwright test --project visual --update-snapshots
 * ```
 *
 * Goldens live next to this spec (`ui-demo.spec.ts-snapshots/`) and are
 * committed; review the diff image Playwright writes on failure before
 * refreshing.
 *
 * Constants are restated from the demo for the reason every browser spec
 * restates them: this gate checks the built page from the outside.
 */

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/** Restates `UI_PORT` in `playwright.config.ts`. */
const UI_PORT = 4178;
const UI_URL = `http://localhost:${String(UI_PORT)}/`;

/** The demo's orthographic view box (world units), as in `ui.spec.ts`. */
const VIEW_LEFT = -4;
const VIEW_RIGHT = 4;
const VIEW_BOTTOM = -3;
const VIEW_TOP = 3;

/** Centre of the middle ("mint") button, world units. */
const MINT_BUTTON_X = -1.4;
const BUTTON_CENTER_Y = 0.42;

/**
 * Anti-aliasing allowance: 0.1% of the 800 × 600 canvas. Same-version
 * SwiftShader reproduces exactly (measured 0 differing pixels across runs);
 * the allowance exists for minor ANGLE point releases only.
 */
const MAX_DIFF_PIXELS = 480;

interface CssRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function cssRectOf(canvas: Locator): Promise<CssRect> {
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error("ui-demo visual: the canvas has no layout box.");
  }
  return box;
}

function worldToClientX(rect: CssRect, worldX: number): number {
  return rect.x + ((worldX - VIEW_LEFT) / (VIEW_RIGHT - VIEW_LEFT)) * rect.width;
}

function worldToClientY(rect: CssRect, worldY: number): number {
  return (
    rect.y + ((VIEW_TOP - worldY) / (VIEW_TOP - VIEW_BOTTOM)) * rect.height
  );
}

/** Loads the demo and waits for the readiness gate the page publishes. */
async function openDemo(page: Page): Promise<{ canvas: Locator; rect: CssRect }> {
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
  return { canvas, rect: await cssRectOf(canvas) };
}

/** Waits until at least two more frames have been drawn since `from`. */
async function settleFrames(page: Page, from: number): Promise<void> {
  await page.waitForFunction(
    (baseline) => {
      const status = document.querySelector<HTMLElement>("#status");
      return Number(status?.dataset["frames"] ?? "0") >= baseline + 2;
    },
    from,
    { timeout: 10_000 },
  );
}

async function frameCount(page: Page): Promise<number> {
  return Number(
    await page.locator("#status").getAttribute("data-frames"),
  );
}

test.describe("§92 visual: the UI demo canvas matches its goldens", () => {
  test("idle layout", async ({ page }) => {
    const { canvas } = await openDemo(page);
    // Park the pointer off-canvas so no hover state colours a button.
    await page.mouse.move(1, 1);
    await settleFrames(page, await frameCount(page));

    await expect(canvas).toHaveScreenshot("ui-demo-idle.png", {
      maxDiffPixels: MAX_DIFF_PIXELS,
    });
  });

  test("after activating the mint button", async ({ page }) => {
    const { canvas, rect } = await openDemo(page);
    await page.mouse.click(
      worldToClientX(rect, MINT_BUTTON_X),
      worldToClientY(rect, BUTTON_CENTER_Y),
    );
    await expect(page.locator("#status")).toHaveAttribute("data-swatch", "mint");
    // Park the pointer again: the golden captures focus (a press outcome,
    // deterministic) but must not capture hover (a pointer-position artefact).
    await page.mouse.move(1, 1);
    await settleFrames(page, await frameCount(page));

    await expect(canvas).toHaveScreenshot("ui-demo-mint-activated.png", {
      maxDiffPixels: MAX_DIFF_PIXELS,
    });
  });
});
