/**
 * §54's GPU skinning against a real WebGL 2 driver (RFC 0003 — gaps PH-10 +
 * R-22, 2026-08-28) — the pixel half of the skinned pipeline.
 *
 * ## What only a browser can answer
 *
 * The unit and integration suites prove everything down to the individual
 * uploads on fake contexts: the influence streams land at locations 4/5, the
 * skinned programs compile lazily, and the palette carries the bones' motion.
 * What no double can prove is that the **vertex stage arithmetic means what
 * we think** on a real driver — that `weights.x * jointMatrices[int(joints.x)]`
 * over a non-normalized `UNSIGNED_SHORT` attribute actually moves the
 * vertices. So a skinned mesh must *visibly deform* here, on the same
 * ANGLE/SwiftShader rasteriser as every other gate in this directory.
 *
 * ## Why there is no golden
 *
 * The claim is geometric, and the `chromium` project's rule is that every
 * assertion is a measurement (§92): a two-segment column bent 90° at its
 * elbow occupies two world rectangles the bind pose cannot — orange appears
 * beside the elbow and vanishes from the column's top — and both are counted
 * exactly, with margins. Every bind-pose failure mode (an ignored palette, an
 * identity skin matrix, a skipped upload) renders the same picture at both
 * angles and fails both counts at once.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import { build } from "vite";

/** Restates `PORT` in `playwright.config.ts` — the site whose origin is borrowed. */
const PORT = 4173;

/** Canvas size, restated from the fixture (a gate checks a page from outside). */
const WIDTH = 320;
const HEIGHT = 240;

/** The scene's world extents, restated from the fixture. */
const VIEW_WIDTH = 8;
const VIEW_HEIGHT = 6;

/** Device pixels per world unit, both axes (320/8 = 240/6 = 40). */
const SCALE = WIDTH / VIEW_WIDTH;

/** World x = −4 maps to pixel 0; world y = −3 maps to row 0 (readPixels is bottom-up). */
function pixelX(worldX: number): number {
  return Math.round((worldX + VIEW_WIDTH / 2) * SCALE);
}

function pixelY(worldY: number): number {
  return Math.round((worldY + VIEW_HEIGHT / 2) * SCALE);
}

/**
 * The two probe rectangles, in world units, each safely inside the region it
 * measures (half a unit of margin from every edge the geometry defines):
 *
 * - **ARM**: where the bent upper segment lands — it maps to
 *   x ∈ [0, 1.5] × y ∈ [1, 2] under a −π/2 turn about the elbow at (0, 1.5) —
 *   and where the upright column never reaches (its width is x ∈ [−0.5, 0.5]).
 * - **TOP**: the column's own top — x ∈ [−0.5, 0.5] × y ∈ [2, 3] upright,
 *   and empty once the upper segment has swung away.
 */
const ARM = { x0: 0.85, x1: 1.35, y0: 1.2, y1: 1.8 };
const TOP = { x0: -0.35, x1: 0.35, y0: 2.35, y1: 2.85 };

interface Probe {
  readonly pixels: number[];
  readonly drawCalls: number;
}

/** Bundles the fixture once for the whole file — `clipping.spec.ts`'s shape. */
async function bundleFixture(): Promise<string> {
  const entry = fileURLToPath(
    new URL("fixtures/skinning-page.ts", import.meta.url),
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
      lib: { entry, formats: ["es"], fileName: "skinning-page" },
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

/** Whether a pixel is the column's orange rather than the black clear. */
function isOrange(pixels: readonly number[], index: number): boolean {
  return pixels[index] > 120 && pixels[index + 2] < 120;
}

/** Orange pixels inside a world-space rectangle. */
function orangeIn(
  pixels: readonly number[],
  rect: { x0: number; x1: number; y0: number; y1: number },
): number {
  let count = 0;
  for (let y = pixelY(rect.y0); y < pixelY(rect.y1); y += 1) {
    for (let x = pixelX(rect.x0); x < pixelX(rect.x1); x += 1) {
      if (isOrange(pixels, (y * WIDTH + x) * 4)) {
        count += 1;
      }
    }
  }
  return count;
}

/** A probe rectangle's own area, in device pixels. */
function areaOf(rect: {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}): number {
  return (
    (pixelX(rect.x1) - pixelX(rect.x0)) * (pixelY(rect.y1) - pixelY(rect.y0))
  );
}

for (const mode of ["gpu", "texture"] as const) {
  test.describe(`§54 skinning deforms on a real driver (RFC 0003) — ${mode} palette`, () => {
    test("bending the elbow moves the upper segment, in one draw", async ({
      page,
    }) => {
      const code = await bundleFixture();
      // The first site's server supplies an `http:` origin; the page itself is
      // replaced, so nothing of that example is under test here.
      await page.goto(`http://localhost:${String(PORT)}/`);
      await page.setContent("<!doctype html><body></body>");
      await page.addScriptTag({
        content: `window.fourSkinningMode = ${JSON.stringify(mode)};`,
      });
      await page.addScriptTag({ content: code, type: "module" });
      await page.waitForSelector("body[data-skinning-ready='1']", {
        timeout: 30_000,
      });

      const bind = (await page.evaluate(() =>
        window.fourSkinningProbe?.(0),
      )) as Probe;
      const bent = (await page.evaluate(() =>
        window.fourSkinningProbe?.(-Math.PI / 2),
      )) as Probe;

      // One skinned mesh is one draw, both poses — the palette changed, not the
      // submission.
      expect(bind.drawCalls).toBe(1);
      expect(bent.drawCalls).toBe(1);
      expect(bind.pixels).toHaveLength(WIDTH * HEIGHT * 4);

      const bindArm = orangeIn(bind.pixels, ARM);
      const bindTop = orangeIn(bind.pixels, TOP);
      const bentArm = orangeIn(bent.pixels, ARM);
      const bentTop = orangeIn(bent.pixels, TOP);
      console.log(
        `skinning: arm region ${String(bindArm)} → ${String(bentArm)} orange ` +
          `pixels (area ${String(areaOf(ARM))}), top region ` +
          `${String(bindTop)} → ${String(bentTop)} (area ${String(areaOf(TOP))})`,
      );

      // Upright: the column fills its top and nothing reaches beside the elbow.
      expect(bindTop).toBeGreaterThan(areaOf(TOP) * 0.9);
      expect(bindArm).toBeLessThan(areaOf(ARM) * 0.02);

      // Bent 90°: the upper segment fills the arm region and has left the top.
      // Both must flip — a bind-pose picture at the bent angle fails both.
      expect(bentArm).toBeGreaterThan(areaOf(ARM) * 0.9);
      expect(bentTop).toBeLessThan(areaOf(TOP) * 0.02);
    });
  });
}
