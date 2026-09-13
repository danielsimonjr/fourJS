/**
 * Browser gate for §61's context-loss contract (A-24, 2026-08-08).
 *
 * The unit suite in `packages/render-webgl/tests` and the cross-package suite
 * in `tests/integration/renderer-context-loss.test.ts` both drive the loss path
 * with a double: they dispatch `webglcontextlost` at a listener list they own
 * and read the GL calls off a tape. That is what makes call *order* and handle
 * *identity* assertable, and it is the tier the contract is gated at.
 *
 * What a double cannot answer is whether the browser agrees. Three things in
 * §61's loss path are the browser's behaviour and not the engine's:
 *
 * 1. **`preventDefault()` is the price of a restore.** Chromium fires
 *    `webglcontextrestored` only for a page that prevented the default on the
 *    loss event. The backend does it (`webgl-renderer.ts`), and a double can
 *    only check that it *called* the method — here the restore either arrives
 *    or it does not.
 * 2. **A real lost context makes every entry point a no-op**, rather than
 *    recording it. A frame that slipped through the `#contextLost` guard is a
 *    silent no-op in the double and a stream of `INVALID_OPERATION` console
 *    errors here.
 * 3. **The application keeps running.** §61 calls loss "a first-class event,
 *    not an error case"; the observable form of that claim is a page whose
 *    `requestAnimationFrame` loop is still ticking, with an empty error log,
 *    while its GPU context is gone.
 *
 * The page is `examples/first-2d-scene` — the smallest site that owns a real
 * `WebglRenderer` and animates, so "it draws again" is checkable without a
 * golden image (there are none in this project; see `playwright.config.ts`).
 *
 * ## Why the screenshots are compared as encoded bytes
 *
 * `example.spec.ts` decodes PNGs because it asserts *how many colours* a frame
 * holds. This spec only ever asks whether two frames of the same canvas are the
 * same picture, and Chromium's encoder is deterministic: identical bytes mean
 * an identical image, which is the direction each assertion below relies on
 * (a frozen canvas stays byte-identical; a live one does not).
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

import { framesFor, waitForFrames } from "./helpers/wait.js";

/**
 * Seconds between two frames compared for "the loop is running" — spent as
 * `ceil(0.3 · 60)` animation frames, not as a wall-clock sleep (2026-09-11).
 * No wall-clock gap is needed anywhere in this spec: the loss and restore
 * events themselves are awaited with `expect.poll` against the probe's
 * counters, so the browser's own delivery latency is covered by a condition
 * wait rather than a timer.
 */
const FRAME_GAP_SECONDS = 0.3;

/** Milliseconds to wait for a context event the extension asked for. */
const CONTEXT_EVENT_TIMEOUT_MS = 10_000;

/** What the page records about its own context and loop. */
interface PageProbe {
  lost: number;
  restored: number;
  frames: number;
  errors: string[];
}

declare global {
  interface Window {
    __fourContextProbe?: PageProbe;
    /**
     * The example's own `WEBGL_lose_context`, captured while the context is
     * still live: `getExtension` on a *lost* context returns null, so the
     * handle that restores the context has to be taken before it is lost.
     */
    __fourLoseContext?: WEBGL_lose_context | null;
  }
}

/** Opens the example with an error log, as the other specs in this directory do. */
async function openExample(page: Page): Promise<string[]> {
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
  await page.goto("/", { waitUntil: "load" });
  return errors;
}

/**
 * Installs the page-side probe: counts `webglcontextlost` /
 * `webglcontextrestored` on the example's canvas and animation frames on the
 * window, so "the loop kept running while the context was gone" is a number
 * the page reports rather than something inferred from pixels.
 *
 * The listeners are added *after* the engine's own, so nothing here can change
 * whether the default was prevented.
 */
async function installProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (canvas === null) throw new Error("the example has no canvas");
    const probe: PageProbe = { lost: 0, restored: 0, frames: 0, errors: [] };
    window.__fourContextProbe = probe;
    // `getContext("webgl2")` on a canvas that already has one returns that
    // same context — which is what makes the loss below a real loss of the
    // renderer's own device, and not of a throwaway one.
    window.__fourLoseContext =
      canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context") ?? null;
    canvas.addEventListener("webglcontextlost", () => {
      probe.lost += 1;
    });
    canvas.addEventListener("webglcontextrestored", () => {
      probe.restored += 1;
    });
    const tick = (): void => {
      probe.frames += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Reads the probe. */
async function readProbe(page: Page): Promise<PageProbe> {
  return page.evaluate(() => {
    const probe = window.__fourContextProbe;
    if (probe === undefined) throw new Error("the probe was never installed");
    return { ...probe, errors: [...probe.errors] };
  });
}

/**
 * Calls `loseContext()` on the extension {@link installProbe} captured.
 *
 * Returns `false` when the browser has no such extension, which is the one
 * honest reason to skip this gate.
 */
async function loseContext(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const extension = window.__fourLoseContext ?? null;
    if (extension === null) return false;
    extension.loseContext();
    return true;
  });
}

/** Calls `restoreContext()` on the same extension object. */
async function restoreContext(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__fourLoseContext?.restoreContext();
  });
}

/** Whether the example's context currently reports itself lost. */
async function contextIsLost(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const gl = canvas?.getContext("webgl2") ?? null;
    return gl?.isContextLost() ?? true;
  });
}

/** A canvas screenshot, encoded (see the header for why it is not decoded). */
async function frame(canvas: Locator): Promise<string> {
  return (await canvas.screenshot()).toString("base64");
}

test.describe("§61 context loss and restore, against a real driver", () => {
  test("loses and regains a real WebGL 2 context without an error or a stall", async ({
    page,
  }) => {
    const errors = await openExample(page);
    const canvas = page.locator("#scene");
    await expect(canvas).toBeVisible();
    await installProbe(page);
    // A drawn, animating starting point: two frames apart must differ, or the
    // rest of this test would be comparing a page that never worked.
    const first = await frame(canvas);
    await waitForFrames(page, framesFor(FRAME_GAP_SECONDS));
    expect(await frame(canvas)).not.toBe(first);

    const supported = await loseContext(page);
    test.skip(!supported, "browser has no WEBGL_lose_context extension");

    // (1) The loss reaches the page, and the context really is gone.
    await expect
      .poll(async () => (await readProbe(page)).lost, {
        timeout: CONTEXT_EVENT_TIMEOUT_MS,
      })
      .toBe(1);
    expect(await contextIsLost(page)).toBe(true);

    // (2) The application is still running, and quiet: §61's "first-class
    // event, not an error case", in the only form a browser can show it. A
    // backend that threw from `render` while lost would stop the loop and fill
    // the error log; one that kept issuing GL calls would fill it too.
    const framesWhileLost = (await readProbe(page)).frames;
    await waitForFrames(page, framesFor(FRAME_GAP_SECONDS));
    const lostFrame = await frame(canvas);
    await waitForFrames(page, framesFor(FRAME_GAP_SECONDS));
    const stillLost = await readProbe(page);
    expect(stillLost.frames).toBeGreaterThan(framesWhileLost);
    expect(errors).toEqual([]);
    // Nothing is being drawn into it either — the canvas is frozen, which is
    // what "the frame is skipped" looks like from outside.
    expect(await frame(canvas)).toBe(lostFrame);

    // (3) The restore arrives — which it can only do because the backend
    // called `preventDefault()` on the loss event — and the engine rebuilds.
    await restoreContext(page);
    await expect
      .poll(async () => (await readProbe(page)).restored, {
        timeout: CONTEXT_EVENT_TIMEOUT_MS,
      })
      .toBe(1);
    expect(await contextIsLost(page)).toBe(false);

    // (4) It draws again, and it animates again: the pipelines, the geometry
    // buffers and the uniforms all came back, on a real driver.
    await expect
      .poll(async () => frame(canvas), { timeout: CONTEXT_EVENT_TIMEOUT_MS })
      .not.toBe(lostFrame);
    const restored = await frame(canvas);
    await waitForFrames(page, framesFor(FRAME_GAP_SECONDS));
    expect(await frame(canvas)).not.toBe(restored);
    expect(errors).toEqual([]);
  });
});
