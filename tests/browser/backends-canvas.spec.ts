/**
 * `@fourjs/render-canvas` in a real Chromium (W3.1; §62 backend 3, §33).
 *
 * Unit tests drive a recording fake context, so they cannot say whether a real
 * 2D context ends up with pixels. This spec bundles `examples/canvas-backend`
 * (the same module the size budget measures), borrows the first site's origin
 * as `screen-camera.spec.ts` does, and asserts three things:
 *
 * 1. the scene lights pixels, against a **meshes-removed control** that lights
 *    none (dogfood cycle 9 measured 35,851 lit pixels for its 82 triangles;
 *    this scene is its own, so the assertion is "well above zero", with the
 *    measured number printed for the record);
 * 2. the draw statistics count what was submitted;
 * 3. two runs produce a **byte-identical `toDataURL()`** (§33).
 */

import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import { build } from "vite";

/** Restates `PORT` in `playwright.config.ts` - the site whose origin is borrowed. */
const PORT = 4173;

interface Probe {
  readonly dataUrl: string;
  readonly litPixels: number;
  readonly drawCalls: number;
  readonly triangles: number;
}

declare global {
  interface Window {
    fourCanvasProbe?: (withMeshes: boolean) => Probe;
  }
}

async function bundleExample(): Promise<string> {
  const entry = fileURLToPath(
    new URL("../../examples/canvas-backend/main.ts", import.meta.url),
  );
  const result = await build({
    logLevel: "error",
    configFile: false,
    build: {
      write: false,
      minify: false,
      target: "es2022",
      lib: { entry, formats: ["es"], fileName: "canvas-backend" },
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
  if (code === "") throw new Error("the example bundled to nothing");
  return code;
}

test.describe("Canvas 2D backend (W3.1)", () => {
  test("draws lit pixels against a control, byte-identically twice", async ({
    page,
  }) => {
    const code = await bundleExample();
    await page.goto(`http://localhost:${String(PORT)}/`);
    await page.setContent(
      "<!doctype html><body><canvas id='scene' width='400' height='300'></canvas></body>",
    );
    await page.addScriptTag({ content: code, type: "module" });
    await page.waitForSelector("body[data-canvas-ready='1']", {
      timeout: 30_000,
    });

    const first = (await page.evaluate(() =>
      window.fourCanvasProbe?.(true),
    )) as Probe;
    const control = (await page.evaluate(() =>
      window.fourCanvasProbe?.(false),
    )) as Probe;
    const second = (await page.evaluate(() =>
      window.fourCanvasProbe?.(true),
    )) as Probe;

    console.log(
      `canvas2d lit=${String(first.litPixels)} control=${String(control.litPixels)} ` +
        `drawCalls=${String(first.drawCalls)} triangles=${String(first.triangles)}`,
    );

    // 400 x 300 = 120,000 px; a disc of radius 1.5 on an 8 x 6 view alone is
    // ~ pi * (1.5 * 50)^2 = 17.6 k px.
    expect(first.litPixels).toBeGreaterThan(20_000);
    expect(control.litPixels).toBe(0);
    expect(first.drawCalls).toBe(2);
    // 64 disc triangles + 12 box triangles.
    expect(first.triangles).toBe(76);
    expect(control.drawCalls).toBe(0);

    expect(second.dataUrl).toBe(first.dataUrl);
    expect(second.litPixels).toBe(first.litPixels);
    expect(control.dataUrl).not.toBe(first.dataUrl);
  });
});
