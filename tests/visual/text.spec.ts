/**
 * §92 visual: §49/§56's `Text` node, glyph for glyph (R-28, 2026-08-13).
 *
 * ## What a golden adds over `tests/browser/text.spec.ts`
 *
 * That gate counts ink and checks the *shape* of a two-line label, which is
 * everything a threshold can honestly say. It cannot say that the letters are
 * **the right letters**, and the failure modes it lets through are exactly the
 * ones a bitmap text tier is prone to:
 *
 * - every glyph drawn upside down (a v-flip in either the atlas packer or the
 *   quad builder — the two flips that must cancel, `glyph-atlas.ts`);
 * - every glyph one atlas cell off (a `u0`/`u1` swapped, a padding change not
 *   reflected in the uv table), which draws the same amount of ink in the same
 *   place out of the wrong cells;
 * - the whole string reversed, or a line's alignment applied to the wrong line.
 *
 * All three keep the ink count, the row structure and the draw count intact. A
 * golden does not, which is why this is the one text assertion that is a pixel
 * match.
 *
 * ## Why a golden is sound here (the category's own argument)
 *
 * The shared Playwright config forces ANGLE-over-SwiftShader unconditionally,
 * so this image is compared SwiftShader-to-SwiftShader — the same rasteriser on
 * a developer sandbox and in CI. See `ui-demo.spec.ts` for the full argument;
 * the extra condition it names is that the frame must be **static at rest**,
 * and this one is: the fixture's scene holds no clock, no animation and no
 * physics, so every rAF draws identical pixels forever.
 *
 * ## The page
 *
 * The fixture `tests/browser/fixtures/text-page.ts`, bundled with Vite's
 * JavaScript API and injected into a page served by the first site's server —
 * R-9's technique, and the reason it is shared with the `chromium` gate rather
 * than copied is that a golden of a *different* page would guard a different
 * thing.
 *
 * ## Refreshing the golden
 *
 * ```sh
 * bun run examples:build
 * npx playwright test --project=visual --update-snapshots
 * ```
 *
 * Review the diff image Playwright writes on failure before refreshing: for
 * this spec a real diff is a text rendering bug, not anti-aliasing drift.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import { build } from "vite";

/** Restates `PORT` in `playwright.config.ts` — the site whose origin is borrowed. */
const PORT = 4173;

/**
 * Anti-aliasing allowance: 0.1% of the 320 × 240 canvas, the fraction
 * `ui-demo.spec.ts` uses. Same-version SwiftShader reproduces exactly; the
 * allowance exists for minor ANGLE point releases only.
 */
const MAX_DIFF_PIXELS = 77;

/** Bundles the fixture — the `chromium` gate's `bundleFixture`, verbatim. */
async function bundleFixture(): Promise<string> {
  const entry = fileURLToPath(
    new URL("../browser/fixtures/text-page.ts", import.meta.url),
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
      lib: { entry, formats: ["es"], fileName: "text-page" },
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

test.describe("§92 visual: a text label's glyphs (R-28)", () => {
  test("a two-line, centre-aligned label matches its golden", async ({
    page,
  }) => {
    const code = await bundleFixture();
    await page.goto(`http://localhost:${String(PORT)}/`);
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: code, type: "module" });
    await page.waitForSelector("body[data-text-ready='1']", {
      timeout: 30_000,
    });

    // `"nearest"` is the mode a bitmap face is meant to be drawn in (§77,
    // R-30), and it is also the one whose golden is most diagnostic: every
    // texel is a hard square, so a half-texel uv error is visible rather than
    // smeared.
    await page.evaluate(() => {
      window.fourTextHold?.("nearest");
    });
    // Two frames: the first starts the loop, the second is the one composited.
    await page.evaluate(
      async () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
        }),
    );

    await expect(page.locator("#text-canvas")).toHaveScreenshot(
      "text-label-nearest.png",
      { maxDiffPixels: MAX_DIFF_PIXELS },
    );
  });
});
