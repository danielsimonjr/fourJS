/**
 * The SVG backend (`@fourjs/render-svg`, §62) against a real `<svg>` in
 * Chromium: the element count against an empty-scene control (one background
 * `<rect>` plus one `<polygon>` per triangle) and §33 determinism — the
 * serialized markup is byte-identical over two runs.
 *
 * The Canvas/SVG picture-agreement check is added with `render-canvas`.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import { build } from "vite";

/** Restates `PORT` in `playwright.config.ts` — the site whose origin is borrowed. */
const PORT = 4173;

interface Run {
  readonly elementCount: number;
  readonly outerHTML: string;
}

interface Probe {
  readonly runs: readonly [Run, Run];
  readonly polygons: number;
  readonly rects: number;
}

async function bundleFixture(): Promise<string> {
  const entry = fileURLToPath(
    new URL("fixtures/backends-svg-page.ts", import.meta.url),
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
      lib: { entry, formats: ["es"], fileName: "backends-svg-page" },
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

test.describe("SVG backend (§62) in a real browser", () => {
  test("element count against the control, and byte-identical markup", async ({
    page,
  }) => {
    const code = await bundleFixture();
    await page.goto(`http://localhost:${String(PORT)}/`);
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: code, type: "module" });
    await page.waitForSelector("body[data-svg-ready='1']", {
      state: "attached",
      timeout: 30_000,
    });

    const probe = (planes: number): Promise<Probe> =>
      page.evaluate(async (n) => {
        const fn = (
          window as unknown as {
            fourSvgProbe?: (n: number) => Promise<unknown>;
          }
        ).fourSvgProbe;
        return (await fn?.(n)) as never;
      }, planes);

    const control = await probe(0);
    expect(control.rects).toBe(1);
    expect(control.polygons).toBe(0);
    expect(control.runs[0].elementCount).toBe(1);

    const scene = await probe(6);
    // Six planes = twelve triangles, plus the one background rect.
    expect(scene.rects).toBe(1);
    expect(scene.polygons).toBe(12);
    expect(scene.runs[0].elementCount).toBe(13);
    expect(scene.runs[0].elementCount).toBeGreaterThan(
      control.runs[0].elementCount,
    );

    // §33: two runs of the same scene serialize to the same bytes.
    expect(scene.runs[1].outerHTML).toBe(scene.runs[0].outerHTML);
    expect(control.runs[1].outerHTML).toBe(control.runs[0].outerHTML);
  });
});
