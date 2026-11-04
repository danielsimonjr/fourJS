import { describe, expect, it } from "vitest";

/**
 * Barrel-wiring proof (WP-4.0-fix1): the umbrella's per-package barrels are
 * pure `export *` files, so nothing else executes them — the smoke test
 * imports the underlying `@fourjs/*` packages directly. Importing each barrel
 * from `src/` verifies the re-export actually resolves and re-exports at
 * least one named symbol, and gives the coverage gate a truthful signal
 * instead of a blanket exclude.
 *
 * Imports are lazy: starting every dynamic import at module load made the
 * first `await` pay the whole cold-start cost (physics-rapier wasm included)
 * and hit the 5 s default timeout on Windows even when this package ran alone.
 */
const barrels: ReadonlyArray<readonly [string, () => Promise<object>]> = [
  ["animation", () => import("../src/animation.js")],
  ["assets", () => import("../src/assets.js")],
  ["core", () => import("../src/core.js")],
  ["diagnostics", () => import("../src/diagnostics.js")],
  ["geometry", () => import("../src/geometry.js")],
  ["input", () => import("../src/input.js")],
  ["materials", () => import("../src/materials.js")],
  ["math", () => import("../src/math.js")],
  ["motion", () => import("../src/motion.js")],
  ["particles", () => import("../src/particles.js")],
  ["physics", () => import("../src/physics.js")],
  ["physics-box2d", () => import("../src/physics-box2d.js")],
  ["physics-physjs", () => import("../src/physics-physjs.js")],
  ["physics-rapier", () => import("../src/physics-rapier.js")],
  ["physics-soft", () => import("../src/physics-soft.js")],
  ["render", () => import("../src/render.js")],
  ["render-canvas", () => import("../src/render-canvas.js")],
  ["render-svg", () => import("../src/render-svg.js")],
  ["render-webgl", () => import("../src/render-webgl.js")],
  ["render-webgpu", () => import("../src/render-webgpu.js")],
  ["scene", () => import("../src/scene.js")],
  ["serialization", () => import("../src/serialization.js")],
  ["text", () => import("../src/text.js")],
  ["text/harfbuzz", () => import("../src/text-harfbuzz.js")],
  ["ui", () => import("../src/ui.js")],
  ["application", () => import("../src/application.js")],
  ["index", () => import("../src/index.js")],
];

describe("umbrella barrels", { timeout: 30_000 }, () => {
  for (const [name, load] of barrels) {
    it(`re-exports at least one symbol from ${name}`, async () => {
      const module_ = await load();
      expect(Object.keys(module_).length).toBeGreaterThan(0);
    });
  }
});
