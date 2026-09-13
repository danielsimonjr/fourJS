/**
 * `examples/gltf-model` — §78's loader, demonstrated and gated.
 *
 * The example exists because §78 shipped tested but undemonstrated; this gate
 * exists so the demonstration cannot rot into a page that loads nothing. It
 * asserts the two claims the example is there to make: that the document AND
 * the external buffer beside it were fetched and assembled into live nodes, and
 * that the result actually reaches the screen.
 *
 * 4183 is restated verbatim from `playwright.config.ts`'s `GLTF_MODEL_PORT`,
 * for the reason every sibling spec restates its own port: the config owns the
 * server, and a spec that imported from it would couple the two files for one
 * number.
 */
import { expect, test } from "@playwright/test";

import { waitForFrames } from "./helpers/wait.js";

/** Where `vite preview` serves `examples/gltf-model/dist`. */
const PAGE = "http://localhost:4183/";

/**
 * Pixels whose channel sum exceeds this are "lit" — drawn, rather than the
 * page's near-black background (`#0d0f14`, sum 48).
 */
const LIT_PIXEL_SUM = 60;

/**
 * Lit pixels a drawn frame must exceed.
 *
 * The quad fills a good part of a 640 × 400 view at z = 3; the reference run
 * measured **13 340**. 4 000 is under a third of that — far above the zero a
 * blank canvas gives, and far below anything a correct draw produces.
 */
const MINIMUM_LIT_PIXELS = 4_000;

test.describe("examples/gltf-model (§78)", () => {
  test("loads quad.gltf and its external buffer, and draws it", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(String(error)));

    await page.goto(PAGE);

    // The status element flips to `running` only after `assets.load` resolved
    // and `instantiateGltf` returned — so this waits on the load, not a timer.
    await expect(page.locator("#status")).toHaveAttribute(
      "data-state",
      "running",
      { timeout: 20_000 },
    );

    // Assembly happened: the fixture's scene carries more than a bare root.
    // A loader that resolved the JSON but not `quad.bin` cannot reach this.
    const nodes = Number(
      await page.locator("#status").getAttribute("data-nodes"),
    );
    expect(nodes, "the glTF assembled no nodes").toBeGreaterThan(1);

    // And it reached the screen, which is the half a load-only check misses.
    //
    // Read from a SCREENSHOT, not from the live canvas. Drawing a WebGL canvas
    // into a 2D context after the frame has been composited yields a blank
    // image unless the context was created with `preserveDrawingBuffer` -- this
    // gate measured 0 lit pixels that way while the model was plainly drawn.
    //
    // The sibling specs decode the PNG with a local `decodePng`, a ~241-line
    // block each of them carries its own copy of. One assertion does not earn a
    // sixth copy, so the page decodes its own screenshot instead: the browser
    // already has a PNG decoder, and `Image` + a 2D canvas is the whole of it.
    // WAIT FOR A DRAWN FRAME, not merely a loaded model. `data-state="running"`
    // proves `assets.load` resolved and the scene assembled; it says nothing
    // about whether the renderer has presented anything yet. On a GPU the first
    // frame is already composited by the time we get here, so this gate passed
    // locally while failing in CI, where SwiftShader rasterises in software and
    // loses the race - reported as "the model loaded but nothing was drawn",
    // which reads like a rendering fault and was a test race.
    await waitForFrames(page, 2);

    const shot = (await page.locator("#scene").screenshot()).toString("base64");
    const lit = await page.evaluate(
      async ([png, litSum]: readonly [string, number]) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const surface = document.createElement("canvas");
        surface.width = image.width;
        surface.height = image.height;
        const context = surface.getContext("2d");
        if (context === null) throw new Error("no 2D context for the readback");
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, surface.width, surface.height);
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          const sum = (data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0);
          if (sum > litSum) count += 1;
        }
        return count;
      },
      [shot, LIT_PIXEL_SUM] as const,
    );
    expect(lit, "the model loaded but nothing was drawn").toBeGreaterThan(
      MINIMUM_LIT_PIXELS,
    );

    expect(errors, "the page logged errors").toEqual([]);
  });
});
