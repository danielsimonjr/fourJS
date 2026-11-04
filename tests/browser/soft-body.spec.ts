/**
 * `examples/soft-body` in a real Chromium (W10.2; RFC 0011, §35a, §33).
 *
 * Asserts that the cloth, released from horizontal and pinned at two corners,
 * descends below its pins and then settles (the page's published lowest particle
 * stops moving), and that two headless runs of the same cloth produce
 * byte-identical geometry digests.
 */

import { expect, test, type Page } from "@playwright/test";

/** Restates `SOFT_BODY_PORT` in `playwright.config.ts` - the preview of `examples/soft-body`. */
const URL = "http://localhost:4185/";

declare global {
  interface Window {
    fourSoftDigest?: (steps: number) => string;
  }
}

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => {
    errors.push(`pageerror: ${e.name}: ${e.message}`);
  });
  await page.route("**/favicon.ico", (route) =>
    route.fulfill({ status: 200, contentType: "image/x-icon", body: "" }),
  );
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLElement>("#status")?.dataset["state"] ===
      "running",
    undefined,
    { timeout: 20_000 },
  );
  return errors;
}

async function clothLowestY(page: Page): Promise<number> {
  return page.evaluate(() =>
    Number(
      document.querySelector<HTMLElement>("#status")?.dataset["clothLowestY"],
    ),
  );
}

test("the cloth descends below its pins and settles", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await open(page);
  const first = await clothLowestY(page);
  // Pinned at y = 1.6; released flat, so it starts at (or just below) the pins.
  expect(first).toBeGreaterThan(0.9);

  await page.waitForFunction(
    () =>
      Number(
        document.querySelector<HTMLElement>("#status")?.dataset["clothLowestY"],
      ) < 0.2,
    undefined,
    { timeout: 30_000 },
  );
  const descended = await clothLowestY(page);
  expect(descended).toBeLessThan(first - 0.8);

  // Settled: the lowest particle moves by less than a millimetre over a second.
  await expect
    .poll(
      async () => {
        const a = await clothLowestY(page);
        await page.waitForTimeout(1000);
        const b = await clothLowestY(page);
        return Math.abs(a - b);
      },
      { timeout: 60_000, intervals: [0] },
    )
    .toBeLessThan(1e-3);
  const settled = await clothLowestY(page);
  // A 2 m curtain hung from y = 1.6 reaches about -0.5.
  expect(settled).toBeLessThan(-0.2);
  expect(settled).toBeGreaterThan(-0.9);
  // The rope settles hanging below its pin too.
  const rope = await page.evaluate(() =>
    Number(
      document.querySelector<HTMLElement>("#status")?.dataset["ropeLowestY"],
    ),
  );
  expect(rope).toBeLessThan(0);
  console.log(`soft-body: cloth lowest y ${first} -> ${settled}`);
  expect(errors).toEqual([]);
});

test("two runs give byte-identical geometry digests", async ({
  page,
  browser,
}) => {
  await open(page);
  const a = await page.evaluate(() => window.fourSoftDigest?.(300));
  const other = await browser.newPage();
  await open(other);
  const b = await other.evaluate(() => window.fourSoftDigest?.(300));
  const c = await other.evaluate(() => window.fourSoftDigest?.(301));
  await other.close();
  expect(a).toMatch(/^[0-9a-f]{8}$/);
  expect(a).toBe(b);
  expect(c).not.toBe(a);
});
