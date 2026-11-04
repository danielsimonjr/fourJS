/**
 * §65 batching against a real WebGL 2 driver (R-9, 2026-08-09) — the pixel
 * half of the packet the fake-GL suites prove the call sequence of.
 *
 * ## What only a browser can answer
 *
 * `packages/render-webgl/tests` proves the GL *sequence* a batch issues and
 * `tests/integration/render-batching.test.ts` proves the *stream* it uploads is
 * the world-space geometry of the draws it replaced. Neither rasterises
 * anything. The claim left over is the one §65 exists for and the one a fake
 * context cannot make: **merging N draws into one produces the same picture**.
 * GL's guarantee that primitives within a draw call rasterise in submission
 * order — and therefore blend, depth-test and depth-write in that order — is a
 * property of the driver, so it is checked here, on the same
 * ANGLE-over-SwiftShader rasteriser every other gate in this directory uses.
 *
 * ## Why this spec builds its own page
 *
 * Every other browser gate drives a built site in `examples/`. This one has no
 * site to drive: batching is opt-in per renderer (`gl-batch.ts` records why),
 * and adding a tenth example — plus a tenth preview server — to demonstrate one
 * renderer field would cost the suite a server and the repository a page nobody
 * would visit. So the fixture (`fixtures/batching-page.ts`) is bundled here with
 * Vite's JavaScript API and injected into a page served by the first site's
 * server, which supplies the `http:` origin a WebGL context wants.
 *
 * The build is the fixture's own, not a copy of an example's config: the only
 * thing it needs is workspace resolution, and it deliberately leaves
 * `__FOUR_DEV__` undefined so the fixture runs the development build (A-4's
 * default) rather than the shipped one.
 *
 * ## The comparison, and its tolerance
 *
 * The probe renders one scene twice into one canvas and reads the framebuffer
 * back inside each call. The two frames are **not** required to be bit-equal,
 * and `batch.ts` says why: a batch has one model matrix, so world transforms
 * are baked on the CPU instead of being applied by the vertex stage, and the
 * two evaluations of the same product differ in the last bits. What is asserted
 * is that the difference is confined to anti-aliased edges — {@link
 * MAX_DIFFERING_PIXELS} of the canvas, none of them by more than
 * {@link MAX_CHANNEL_DELTA} per channel — which is the same allowance
 * `tests/visual/` gives a Chromium version bump, and orders of magnitude
 * tighter than the difference a *misordered* or *misplaced* batch would make.
 *
 * **Measured on the first run (2026-08-09, ANGLE/SwiftShader): 0 of 76 800
 * pixels differ, over 25 717 non-background pixels, with the sprite row spun
 * about +Z so the batch bakes a rotation.** The allowance above is kept
 * nonetheless — it is a statement about what the design guarantees, not about
 * what this rasteriser happened to produce, and a run that starts needing it is
 * still a run that batched correctly.
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

/**
 * Draw calls the scene costs unbatched: six rectangles, six sprites, one lone
 * renderable. Restated from the fixture for the reason above.
 */
const UNBATCHED_DRAW_CALLS = 13;

/**
 * Draw calls the same scene costs batched: one for the rectangle run, one for
 * the sprite run, one for the renderable that can join neither.
 */
const BATCHED_DRAW_CALLS = 3;

/**
 * Pixels allowed to differ between the batched and unbatched frames — 0.5% of
 * the canvas, which is roughly the perimeter of the thirteen quads and is where
 * a sub-ulp vertex difference can land. A batch drawn in the wrong order, at
 * the wrong place, or with the wrong uv moves whole *fills*, which is tens of
 * percent.
 */
const MAX_DIFFERING_PIXELS = Math.round(WIDTH * HEIGHT * 0.005);

/** How far one channel of a differing pixel may move. */
const MAX_CHANNEL_DELTA = 8;

interface Probe {
  readonly pixels: number[];
  readonly drawCalls: number;
}

/** Bundles the fixture once for the whole file. */
async function bundleFixture(): Promise<string> {
  const entry = fileURLToPath(
    new URL("fixtures/batching-page.ts", import.meta.url),
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
      lib: { entry, formats: ["es"], fileName: "batching-page" },
    },
  });
  // Vite's `build` returns one of three shapes depending on how it was
  // configured; only the rolled-up chunks are wanted, and they are read
  // defensively rather than through a cast, so a Vite upgrade that changes the
  // shape fails here loudly instead of injecting an empty script.
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

test.describe("§65 batching draws the same picture (R-9)", () => {
  test("a batched frame matches the unbatched one, in three draw calls instead of thirteen", async ({
    page,
  }) => {
    const code = await bundleFixture();
    // The first site's server supplies an `http:` origin; the page itself is
    // replaced, so nothing of that example is under test here.
    await page.goto(`http://localhost:${String(PORT)}/`);
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: code, type: "module" });
    await page.waitForSelector("body[data-batching-ready='1']", {
      timeout: 30_000,
    });

    const unbatched = (await page.evaluate(() =>
      window.fourBatchingProbe?.(false),
    )) as Probe;
    const batched = (await page.evaluate(() =>
      window.fourBatchingProbe?.(true),
    )) as Probe;

    expect(unbatched.drawCalls).toBe(UNBATCHED_DRAW_CALLS);
    expect(batched.drawCalls).toBe(BATCHED_DRAW_CALLS);
    expect(batched.pixels).toHaveLength(WIDTH * HEIGHT * 4);

    let differing = 0;
    let worstDelta = 0;
    let drawn = 0;
    for (let i = 0; i < batched.pixels.length; i += 4) {
      let pixelDelta = 0;
      for (let c = 0; c < 4; c += 1) {
        pixelDelta = Math.max(
          pixelDelta,
          Math.abs(batched.pixels[i + c] - unbatched.pixels[i + c]),
        );
      }
      if (pixelDelta > 0) differing += 1;
      worstDelta = Math.max(worstDelta, pixelDelta);
      // Something has to be on screen for the comparison to mean anything.
      if (
        unbatched.pixels[i] > 8 ||
        unbatched.pixels[i + 1] > 8 ||
        unbatched.pixels[i + 2] > 8
      ) {
        drawn += 1;
      }
    }

    console.log(
      `batched vs unbatched: ${String(differing)} of ${String(
        WIDTH * HEIGHT,
      )} pixels differ (worst channel Δ ${String(worstDelta)}); ` +
        `${String(drawn)} pixels are non-background`,
    );

    // A blank canvas would pass every comparison above.
    expect(drawn).toBeGreaterThan(WIDTH * HEIGHT * 0.05);
    expect(differing).toBeLessThanOrEqual(MAX_DIFFERING_PIXELS);
    expect(worstDelta).toBeLessThanOrEqual(MAX_CHANNEL_DELTA);
  });
});

/** R-22: 10 shaded meshes unbatched; two instanced runs (lit, standard) batched. */
const SHADED_UNBATCHED_DRAW_CALLS = 10;
const SHADED_INSTANCED_DRAW_CALLS = 2;

/** 0.01% of the canvas, per the R-22 equivalence gate. */
const SHADED_MAX_DIFFERING_PIXELS = Math.round(WIDTH * HEIGHT * 0.0001);

test.describe("§65 instanced shaded meshes draw the same picture (R-22)", () => {
  test("an instanced lit + standard frame matches the unbatched one in two draw calls", async ({
    page,
  }) => {
    const code = await bundleFixture();
    await page.goto(`http://localhost:${String(PORT)}/`);
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: code, type: "module" });
    await page.waitForSelector("body[data-shaded-batching-ready='1']", {
      timeout: 30_000,
    });

    const plain = (await page.evaluate(() =>
      window.fourShadedBatchingProbe?.(false),
    )) as Probe;
    const instanced = (await page.evaluate(() =>
      window.fourShadedBatchingProbe?.(true),
    )) as Probe;

    expect(plain.drawCalls).toBe(SHADED_UNBATCHED_DRAW_CALLS);
    expect(instanced.drawCalls).toBe(SHADED_INSTANCED_DRAW_CALLS);

    let differing = 0;
    let drawn = 0;
    for (let i = 0; i < instanced.pixels.length; i += 4) {
      let delta = 0;
      for (let c = 0; c < 4; c += 1) {
        delta = Math.max(
          delta,
          Math.abs(instanced.pixels[i + c] - plain.pixels[i + c]),
        );
      }
      if (delta > 0) differing += 1;
      if (
        plain.pixels[i] > 8 ||
        plain.pixels[i + 1] > 8 ||
        plain.pixels[i + 2] > 8
      ) {
        drawn += 1;
      }
    }
    console.log(
      `instanced vs unbatched shaded: ${String(differing)} of ${String(
        WIDTH * HEIGHT,
      )} pixels differ; ${String(drawn)} non-background`,
    );
    expect(drawn).toBeGreaterThan(WIDTH * HEIGHT * 0.05);
    expect(differing).toBeLessThanOrEqual(SHADED_MAX_DIFFERING_PIXELS);
  });
});

/** W11.4: eight sprites, eight textures, two samplers. */
const ATLAS_UNBATCHED_DRAW_CALLS = 8;
const ATLAS_BATCHED_DRAW_CALLS = 2;

interface AtlasProbe extends Probe {
  readonly uploads: number;
  readonly stats: {
    pages: number;
    textures: number;
    runs: number;
    drawsSaved: number;
  } | null;
}

test.describe("§65 atlas grouping draws the same picture (W11.4)", () => {
  test("eight distinct textures batch over two atlas pages with 0 differing pixels and no re-upload", async ({
    page,
  }) => {
    const code = await bundleFixture();
    await page.goto(`http://localhost:${String(PORT)}/`);
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: code, type: "module" });
    await page.waitForSelector("body[data-atlas-ready='1']", {
      timeout: 30_000,
    });

    const plain = (await page.evaluate(() =>
      window.fourAtlasProbe?.(false, 1),
    )) as AtlasProbe;
    const first = (await page.evaluate(() =>
      window.fourAtlasProbe?.(true, 1),
    )) as AtlasProbe;
    // A still scene: the third frame must upload nothing at all.
    const still = (await page.evaluate(() =>
      window.fourAtlasProbe?.(true, 3),
    )) as AtlasProbe;

    expect(plain.drawCalls).toBe(ATLAS_UNBATCHED_DRAW_CALLS);
    expect(first.drawCalls).toBe(ATLAS_BATCHED_DRAW_CALLS);
    expect(still.drawCalls).toBe(ATLAS_BATCHED_DRAW_CALLS);
    expect(first.uploads).toBeGreaterThan(0);
    expect(still.uploads).toBe(0);
    expect(still.stats).toMatchObject({ pages: 2, textures: 8 });

    let differing = 0;
    let drawn = 0;
    for (let i = 0; i < still.pixels.length; i += 4) {
      let delta = 0;
      for (let c = 0; c < 4; c += 1) {
        delta = Math.max(
          delta,
          Math.abs(still.pixels[i + c] - plain.pixels[i + c]),
        );
      }
      if (delta > 0) differing += 1;
      if (plain.pixels[i] > 8 || plain.pixels[i + 1] > 8) drawn += 1;
    }
    console.log(
      `atlas vs unbatched: ${String(differing)} of ${String(
        WIDTH * HEIGHT,
      )} pixels differ; ${String(drawn)} non-background; ` +
        `first-frame uploads ${String(first.uploads)}`,
    );
    expect(drawn).toBeGreaterThan(WIDTH * HEIGHT * 0.05);
    expect(differing).toBe(0);
  });
});
