/**
 * Condition waits for the browser gates, replacing `page.waitForTimeout`
 * (2026-09-11 audit: 77 fixed sleeps across 14 specs were the flake source the
 * tracker records under CI load).
 *
 * A fixed sleep asks "has enough wall clock passed?", which is the wrong
 * question on a loaded runner: a second of wall clock can be sixty frames or
 * six, and every threshold tuned on an idle machine breaks on the second kind.
 * The waits here ask the question the sleep stood in for:
 *
 * - {@link waitForFrames} — *N more animation frames have been drawn*. The
 *   counter is a `requestAnimationFrame` tick installed on the page by the
 *   test (the same device `context-loss.spec.ts`'s probe uses), because the
 *   engine's own loop is rAF-driven (`packages/fourjs/src/application.ts`) and
 *   headless Chromium paces rAF at no more than 60 Hz: `ceil(t · 60)` frames
 *   is therefore *at least* `t` seconds of wall clock **and** at least that
 *   many render passes, which is what a sleep before a screenshot pair was
 *   relying on and could not guarantee.
 * - {@link waitForSimulationTime} / {@link waitForSimulationSeconds} — *the
 *   page's own simulated clock has reached `t`*, for the examples that publish
 *   `data-sim` on `#status`. A sleep that existed so a real-time animation
 *   could advance by `t` seconds becomes exactly that condition.
 * - {@link waitForProbe} — any predicate over the `#status` dataset every
 *   example publishes.
 *
 * Nothing here touches `packages/` or the examples: the frame counter is a
 * page-side global the test installs, read back by name.
 */

import { expect, type Page } from "@playwright/test";

declare global {
  interface Window {
    /** Animation frames drawn since {@link installFrameCounter} ran on this document. */
    __fourjsFrameCount?: number;
  }
}

/**
 * The rAF ceiling headless Chromium paces to. A wait of `ceil(t · 60)` frames
 * can never finish in less than `t` seconds of wall clock, and finishes later
 * only when the page is drawing more slowly — the direction a fixed sleep
 * gets wrong.
 */
const NOMINAL_FRAMES_PER_SECOND = 60;

/** Frames a fixed sleep of `seconds` stood in for: `ceil(seconds · 60)`, at least one. */
export function framesFor(seconds: number): number {
  return Math.max(1, Math.ceil(seconds * NOMINAL_FRAMES_PER_SECOND));
}

/** Timeout for a frame wait: generous for a page drawing at 5 fps, never under 30 s. */
function frameTimeout(frames: number): number {
  return Math.max(30_000, frames * 200);
}

/**
 * Installs the page-side frame counter if this document has none yet, and
 * returns its current value. Idempotent, and self-healing across a navigation
 * (a fresh document has no counter, so it gets a fresh one).
 */
export async function installFrameCounter(page: Page): Promise<number> {
  return page.evaluate(() => {
    if (typeof window.__fourjsFrameCount === "number") {
      return window.__fourjsFrameCount;
    }
    window.__fourjsFrameCount = 0;
    const tick = (): void => {
      window.__fourjsFrameCount = (window.__fourjsFrameCount ?? 0) + 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return 0;
  });
}

/** The page-side frame counter, installing it on first use. */
export async function readFrameCount(page: Page): Promise<number> {
  return installFrameCounter(page);
}

/** Blocks until the page-side frame counter is at least `total`. */
export async function waitUntilFrameCount(
  page: Page,
  total: number,
): Promise<void> {
  const current = await installFrameCounter(page);
  const remaining = total - current;
  if (remaining <= 0) return;
  await page.waitForFunction(
    (target: number) => (window.__fourjsFrameCount ?? 0) >= target,
    total,
    { timeout: frameTimeout(remaining), polling: "raf" },
  );
}

/**
 * Blocks until `frames` more animation frames have been drawn, counted from
 * the moment of the call.
 */
export async function waitForFrames(page: Page, frames: number): Promise<void> {
  const start = await installFrameCounter(page);
  await waitUntilFrameCount(page, start + Math.max(1, Math.ceil(frames)));
}

/** What every example publishes on `#status`: its `data-*` attributes. */
export type StatusData = Readonly<Record<string, string | undefined>>;

/** Reads `#status`'s dataset, or an empty record when there is no such element. */
export async function readStatusData(page: Page): Promise<StatusData> {
  return page.evaluate(() => {
    const element = document.querySelector<HTMLElement>("#status");
    return element === null ? {} : Object.assign({}, element.dataset);
  });
}

/** Options for {@link waitForProbe}. */
export interface ProbeOptions {
  /** Milliseconds before the wait fails (default 30 s). */
  readonly timeout?: number;
  /** What was being waited for, for the failure message. */
  readonly message?: string;
}

/**
 * Polls `#status`'s dataset until `predicate` holds. The predicate runs in the
 * test process, so it may close over anything.
 */
export async function waitForProbe(
  page: Page,
  predicate: (status: StatusData) => boolean,
  options: ProbeOptions = {},
): Promise<void> {
  await expect
    .poll(async () => predicate(await readStatusData(page)), {
      timeout: options.timeout ?? 30_000,
      intervals: [16, 33, 50],
      message: options.message ?? "the #status probe never met the condition",
    })
    .toBe(true);
}

/** `data-sim` as a number, `NaN` when the page publishes none. */
export async function readSimulationTime(page: Page): Promise<number> {
  const status = await readStatusData(page);
  return status["sim"] === undefined ? Number.NaN : Number(status["sim"]);
}

/**
 * Blocks until the page's published simulated clock (`data-sim`, seconds) is
 * at least `seconds`.
 */
export async function waitForSimulationTime(
  page: Page,
  seconds: number,
): Promise<void> {
  await waitForProbe(page, (status) => Number(status["sim"]) >= seconds, {
    timeout: Math.max(30_000, seconds * 10_000),
    message: `data-sim never reached ${String(seconds)} s`,
  });
}

/**
 * Blocks until the page's simulated clock has advanced by `seconds` from its
 * value at the call, and returns that starting value.
 */
export async function waitForSimulationSeconds(
  page: Page,
  seconds: number,
): Promise<number> {
  const start = await readSimulationTime(page);
  expect(start, "the page publishes no numeric data-sim").not.toBeNaN();
  await waitForSimulationTime(page, start + seconds);
  return start;
}
