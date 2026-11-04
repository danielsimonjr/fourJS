/**
 * Canvas/SVG picture agreement: the same scene drawn by `@fourjs/render-canvas`
 * and `@fourjs/render-svg` (rasterized through an `Image`) differs in at most
 * 0.01% of pixels.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import { build } from "vite";

/** Restates `PORT` in `playwright.config.ts`. */
const PORT = 4173;

async function bundleFixture(): Promise<string> {
  const entry = fileURLToPath(
    new URL("fixtures/backends-agreement-page.ts", import.meta.url),
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
      lib: { entry, formats: ["es"], fileName: "backends-agreement-page" },
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

test.describe("Canvas 2D and SVG backends agree", () => {
  test("same scene differs in at most 0.01% of pixels", async ({ page }) => {
    const code = await bundleFixture();
    await page.goto(`http://localhost:${String(PORT)}/`);
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: code, type: "module" });
    await page.waitForSelector("body[data-agreement-ready='1']", {
      state: "attached",
      timeout: 30_000,
    });
    const r = await page.evaluate(async () => {
      const fn = (
        window as unknown as { fourAgreementProbe?: () => Promise<unknown> }
      ).fourAgreementProbe;
      return (await fn?.()) as {
        total: number;
        differing: number;
        exact: number;
        litCanvas: number;
        litSvg: number;
      };
    });
    console.log(
      `agreement: ${String(r.differing)} / ${String(r.total)} differ (tolerance 16/255; ${String(r.exact)} differ at all); lit canvas ${String(r.litCanvas)}, svg ${String(r.litSvg)}`,
    );
    expect(r.litCanvas).toBeGreaterThan(1000);
    expect(r.litSvg).toBeGreaterThan(1000);
    expect(r.differing / r.total).toBeLessThanOrEqual(0.0001);
  });
});
