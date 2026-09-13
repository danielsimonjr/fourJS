import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { build } from "vite";

test("PNG uses a capped Wasm heap and validates checksums in Chromium", async ({
  page,
}) => {
  const result = await build({
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      target: "es2022",
      lib: {
        entry: fileURLToPath(
          new URL("fixtures/bounded-png-page.ts", import.meta.url),
        ),
        formats: ["es"],
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!("output" in output)) throw new Error("Missing PNG fixture bundle");
  const code = output.output
    .filter((chunk) => chunk.type === "chunk")
    .map((chunk) => chunk.code)
    .join("\n");
  await page.goto("http://localhost:4173/");
  await page.setContent("<!doctype html><body></body>");
  await page.addScriptTag({ type: "module", content: code });
  await page.waitForSelector("body[data-bounded-png-ready='1']", {
    state: "attached",
  });
  const wasm = Array.from(
    readFileSync(
      new URL(
        "../../packages/assets/tests/fixtures/squoosh-png-3.1.1.wasm",
        import.meta.url,
      ),
    ),
  );
  const png = Array.from(
    readFileSync(
      new URL("../../packages/assets/tests/fixtures/red.png", import.meta.url),
    ),
  );
  const run = (working: number) =>
    page.evaluate(
      ({ wasm, png, working }) => window.fourBoundedPng!(wasm, png, working),
      { wasm, png, working },
    );
  expect(await run(8 * 1024 * 1024)).toEqual([255, 0, 0, 255]);
  // The codec's initial heap fits, but its allocator cannot grow enough to decode.
  expect(await run(18 * 65536)).toBe("UNTRUSTED_INPUT_REJECTED");
  png[29] ^= 1;
  expect(await run(8 * 1024 * 1024)).toBe("UNTRUSTED_INPUT_REJECTED");
});
