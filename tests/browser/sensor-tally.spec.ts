/**
 * Browser gate for the playground's **step-8 sensor bookkeeping** — the PH-21
 * follow-up (2026-08-29): §39's `PRIORITY_SENSOR_UPDATE` slot occupied by a
 * real system, between a real solve and real listeners, in a real browser.
 *
 * `packages/physics/tests/physics-event-system.test.ts` proves the split
 * dispatch mechanism; what nothing proved until this file is the *pattern* the
 * split exists for, running end to end in `examples/physics-playground`:
 *
 * ```text
 * 600  PhysicsSystem({ dispatchEvents: false })   both worlds step, events queue
 * 800  ZoneTallySystem                            overlapBox over each zone (§30)
 * 900  PhysicsEventSystem                         §29 triggers fire; the listeners
 *                                                 repaint from the step-8 tally
 * ```
 *
 * `playground.spec.ts` (untouched by this packet) keeps gating the observable
 * §29 behaviour — the empty→occupied repaint and the `data-zone*` counters —
 * which is itself the proof that the split *changed nothing the §29 contract
 * promises*. This file adds the two claims that are new:
 *
 * | test | § | assertion |
 * | ---- | -- | --------- |
 * | split + agreement | §30, §39 | the page runs the step-9 dispatch split (`data-dispatch="step-9"`), and once settled the step-8 query tally and the step-9 event counter tell the same story in both halves |
 *
 * ## Why "the same story" is a ±1 band, not equality
 *
 * The event counter is a delta accumulation over §29 transitions; the tally is
 * an absolute §30 re-measure of the same volume. The reference run (2026-08-29)
 * measured **3 = 3** in both halves at rest — exact agreement — but the
 * settled stack's top body rests with its underside mathematically *on* the
 * zone's top face (the example's drop layout puts it at exactly y = −1.6), and
 * a body touching a boundary is precisely where an intersection graph and an
 * overlap test may legitimately disagree by one. The assertion therefore
 * requires each count ≥ 1 and |tally − counter| ≤ 1: tight enough that a dead
 * tally system (0 vs 3) or an undrained event queue (3 vs 0) fails loudly,
 * loose enough that a borderline contact is not a flake.
 *
 * ## Method notes
 *
 * Attributes only, no pixels: the pixel evidence for the sensor pattern —
 * that the repaint reaches the screen — is `playground.spec.ts`'s existing
 * "each sensor zone repaints" test, which now exercises the tally-driven
 * repaint by construction (the listener's colour is `tally > 0`). Restating
 * that measurement here would gate the same pixels twice. The port is restated
 * from `playwright.config.ts` for the sibling specs' reason.
 */

import { expect, test, type Page } from "@playwright/test";

import {
  framesFor,
  installFrameCounter,
  waitUntilFrameCount,
} from "./helpers/wait.js";

/** Where the playground's `vite preview` server listens (`PLAYGROUND_PORT`). */
const PLAYGROUND_URL = "http://localhost:4174/";

/**
 * Seconds to wait for `data-state="running"` — `playground.spec.ts`'s value,
 * for its reason: two Rapier wasm images, and this is a "the wasm never
 * arrived" assertion, not a performance one.
 */
const READY_TIMEOUT_MS = 45_000;

/**
 * Seconds after `load` before the settled comparison is read.
 *
 * `playground.spec.ts` measured the scene still at 5 s and every later
 * sample; the same margin is reused because the comparison below is only
 * meaningful once nothing is crossing a zone boundary mid-read.
 */
const SETTLE_SECONDS = 5;

/**
 * Largest allowed |tally − event counter| per half at rest — see the module
 * note. The reference run measured 0 in both halves.
 */
const AGREEMENT_BAND = 1;

/** Opens the playground; the error log is the sibling spec's arrangement. */
async function openPlayground(
  page: Page,
): Promise<{ errors: readonly string[]; loadedAt: number }> {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console.error: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.name}: ${error.message}`);
  });
  await page.route("**/favicon.ico", (route) =>
    route.fulfill({ status: 200, contentType: "image/x-icon", body: "" }),
  );
  await page.goto(PLAYGROUND_URL, { waitUntil: "load" });
  // `loadedAt` is a frame count, not a wall-clock instant: "N seconds since
  // load" is measured in animation frames drawn since this point.
  return { errors, loadedAt: await installFrameCounter(page) };
}

/** Reads one numeric `data-*` attribute off `#status`. */
async function readCount(page: Page, name: string): Promise<number> {
  const value = await page.locator("#status").getAttribute(`data-${name}`);
  expect(value, `#status has no data-${name}`).not.toBeNull();
  const parsed = Number(value);
  expect(Number.isInteger(parsed), `data-${name}=${String(value)}`).toBe(true);
  return parsed;
}

test.describe("§39 step 8: sensor bookkeeping between the solve and the listeners", () => {
  test("the dispatch split is live, and the step-8 tally agrees with the step-9 events (§30, §39)", async ({
    page,
  }) => {
    const { errors, loadedAt } = await openPlayground(page);
    const status = page.locator("#status");
    await expect(status).toHaveAttribute("data-state", "running", {
      timeout: READY_TIMEOUT_MS,
    });

    // The page says which arrangement it is running: solve at 600, dispatch
    // moved to 900. If a future edit quietly reverts to the combined default,
    // this is the line that says so — the agreement below would still pass,
    // because at step 6 there is simply nothing between the solve and the
    // listeners to disagree with.
    await expect(status).toHaveAttribute("data-dispatch", "step-9");

    // §29 fired at least once per half (the same wait `playground.spec.ts`
    // uses) — and the moment it did, the listener also mirrored the tally,
    // because the mirror *is* the listener: consumed at 900, by construction.
    await expect(status).toHaveAttribute("data-zone2d", /[1-9]/, {
      timeout: READY_TIMEOUT_MS,
    });
    await expect(status).toHaveAttribute("data-zone3d", /[1-9]/, {
      timeout: READY_TIMEOUT_MS,
    });
    await expect(status).toHaveAttribute("data-tally2d", /\d/);
    await expect(status).toHaveAttribute("data-tally3d", /\d/);

    // Once everything is at rest, the two accounts must tell the same story:
    // the delta-accumulated §29 counter and the absolute §30 re-measure.
    // Reference run: 3 = 3 in both halves.
    // `loadedAt` is the frame count at load, so this is "SETTLE_SECONDS of
    // frames since load" — at least that much wall clock, never fewer frames.
    await waitUntilFrameCount(page, loadedAt + framesFor(SETTLE_SECONDS));
    for (const half of ["2d", "3d"] as const) {
      const counter = await readCount(page, `zone${half}`);
      const tally = await readCount(page, `tally${half}`);
      expect(
        counter,
        `${half}: no body is inside the zone at rest`,
      ).toBeGreaterThanOrEqual(1);
      expect(
        tally,
        `${half}: the step-8 overlap query found nothing in an occupied zone`,
      ).toBeGreaterThanOrEqual(1);
      expect(
        Math.abs(tally - counter),
        `${half}: tally ${String(tally)} vs event counter ${String(counter)} — ` +
          "the step-8 bookkeeping and the step-9 events disagree",
      ).toBeLessThanOrEqual(AGREEMENT_BAND);
    }

    expect(errors).toEqual([]);
  });
});
