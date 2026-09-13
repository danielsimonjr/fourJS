import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { defineConfig } from "@playwright/test";

/**
 * Playwright configuration for the browser gates (WP-3.8, extended by WP-5.8,
 * WP-6.6, WP-7.7, WP-9.4, the post-plan UI proof and the §93 first-3D-scene
 * proof).
 *
 * The suite drives **ten built example sites** in headless Chromium (six until
 * 2026-08-07, when `first-3d-scene` and then the §118 flagship joined; nine on
 * 2026-08-08, when §119's motor digital twin joined; ten on 2026-08-29, when
 * the §12 character-controller example joined):
 *
 * | site | port | specs | what it gates |
 * | ---- | ---- | ----- | ------------- |
 * | `examples/first-2d-scene` | {@link PORT} | `example`, `smoothness`, `animation`, `interaction` | the page loads clean, the canvas is not blank, it animates smoothly, and the pointer reaches it (§106, §106a) |
 * | `examples/first-3d-scene` | {@link SCENE_3D_PORT} | `first-3d-scene` | §93's first 3D scene: a `PerspectiveCamera` over `LitMaterial` meshes under a `DirectionalLight` plus scene ambient — the first browser evidence for the §47 perspective path, the §68 lighting MVP and the §53 3D primitives |
 * | `examples/physics-playground` | {@link PLAYGROUND_PORT} | `playground`, `sensor-tally` | §108's mixed 2D/3D physics demo: gravity, collisions, impulses and sensors through one API — since 2026-08-29 with §39's step-8/step-9 split (`PhysicsEventSystem` + a `PRIORITY_SENSOR_UPDATE` tally, PH-21's seam occupied) |
 * | `examples/character-controller` | {@link CHARACTER_PORT} | `character-controller` | the §12 controller family: `SweptCharacterController` (§30 capsule sweeps, step-up, wall slide), `FirstPersonLook` on a child eye (§44's yaw ∘ pitch decomposition) and the plane-tier `CharacterController` on patrol, under the §39 input → kinematics → solve ordering |
 * | `examples/mechanism` | {@link MECHANISM_PORT} | `mechanism` | §109's jointed mechanism: a motorised shaft, three hinges, a limited slider, a spring and two limit switches, stable under a real-time load and reconfigurable while running |
 * | `examples/blending` | {@link BLENDING_PORT} | `blending` | §110's physics-animation blending: an animated chain handed to the solver as a ragdoll and blended back onto its animation, without abrupt discontinuities |
 * | `examples/particles-demo` | {@link PARTICLES_PORT} | `particles` | §112's particle demonstration: a seeded CPU fountain under §27 fields bouncing off a collision plane, plus a click burst, each drawn as one instanced draw call |
 * | `examples/ui-demo` | {@link UI_PORT} | `ui` | §73–§75's retained-mode UI: a `@fourjs/ui` panel of buttons and labels laid out by the package, skinned by the application, driven by real pointer and keyboard input (the WP-11.5 packet-intent closure) |
 * | `examples/flagship/one-scene-everything-moves` | {@link FLAGSHIP_PORT} | `one-scene-everything-moves` | §118's flagship: one scene holding 2D art, lit 3D meshes, rigid bodies, two joints, particles, world-space text and a screen-space UI panel, with pause / slow-motion / single-step controls |
 * | `examples/flagship/motor-digital-twin` | {@link TWIN_PORT} | `motor-digital-twin` | §119's engineering flagship: a motorised shaft on two bearing hinges inside a sprung stator, a `PIDController` closing the speed loop, §40 unit readouts, §84 statistics, fault injection, and §34 record/seek/replay with §79 save-and-reload |
 *
 * **In the `chromium` project there are no golden images** — SwiftShader
 * rasterises slightly differently from a GPU, so every assertion in
 * `tests/browser` is a threshold, never a pixel match (§92). This sentence was
 * unqualified ("There are no golden images") until 2026-08-05, which stopped
 * being true when the `visual` project below landed on 2026-08-04: that project
 * runs `tests/visual` and *does* compare committed PNG goldens, legitimately,
 * because both sides of its comparison are SwiftShader. See the comment on the
 * `visual` project for the scope of the exception.
 *
 * Run **all ten** builds first — or just `bun run examples:build`, which is the
 * one place they are listed: the web servers below serve the *built* `dist`
 * directories, which are gitignored and may be absent.
 *
 * ```sh
 * bun run example:build          # examples/first-2d-scene/dist
 * bun run first-3d-scene:build   # examples/first-3d-scene/dist
 * bun run playground:build       # examples/physics-playground/dist
 * bun run mechanism:build        # examples/mechanism/dist
 * bun run blending:build         # examples/blending/dist
 * bun run particles-demo:build   # examples/particles-demo/dist
 * bun run ui-demo:build          # examples/ui-demo/dist
 * bun run flagship:build         # examples/flagship/one-scene-everything-moves/dist
 * bun run twin:build             # examples/flagship/motor-digital-twin/dist
 * bun run character:build        # examples/character-controller/dist
 * bun run test:browser
 * ```
 *
 * `use.baseURL` stays the first site's, so every pre-existing spec keeps
 * navigating with `page.goto("/")` unchanged; `first-3d-scene.spec.ts`,
 * `playground.spec.ts`,
 * `mechanism.spec.ts`, `blending.spec.ts`, `particles.spec.ts` and `ui.spec.ts`
 * name their own absolute URLs, and restate {@link SCENE_3D_PORT} /
 * {@link PLAYGROUND_PORT} /
 * {@link MECHANISM_PORT} / {@link BLENDING_PORT} / {@link PARTICLES_PORT} /
 * {@link UI_PORT} / {@link FLAGSHIP_PORT} / {@link TWIN_PORT} for the reason the other specs restate the example's
 * scene constants — a browser gate checks the built page from the outside, and
 * a spec that imported this file would drag a second copy of the config into
 * every worker.
 */

/**
 * Locations of a Chromium executable inside a `PLAYWRIGHT_BROWSERS_PATH` tree,
 * as `[directory prefix, path of the binary inside it]`. The full browser is
 * listed first: it works headless *and* headed, so `--headed` debugging keeps
 * working. Layouts differ between Playwright releases, hence several
 * candidates.
 */
const CHROMIUM_BINARIES: readonly (readonly [string, string])[] = [
  ["chromium-", join("chrome-linux", "chrome")],
  [
    "chromium-",
    join("chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
  ],
  // Windows. Absent until 2026-09-06, which made `findPreinstalledChromium` unable to
  // resolve anything at all on this platform: a sandbox that sets
  // PLAYWRIGHT_BROWSERS_PATH got the same `undefined` as one that does not, and the
  // escape hatch this function exists to be simply was not there. Verified against a
  // real install tree — `chromium-<rev>/chrome-win64/chrome.exe` and
  // `chromium_headless_shell-<rev>/chrome-headless-shell-win64/chrome-headless-shell.exe`.
  ["chromium-", join("chrome-win64", "chrome.exe")],
  ["chromium-", join("chrome-win", "chrome.exe")],
  ["chromium_headless_shell-", join("chrome-linux", "headless_shell")],
  [
    "chromium_headless_shell-",
    join("chrome-headless-shell-linux64", "chrome-headless-shell"),
  ],
  [
    "chromium_headless_shell-",
    join("chrome-headless-shell-win64", "chrome-headless-shell.exe"),
  ],
];

/**
 * Finds a pre-installed Chromium when the sandbox ships a browser revision that
 * differs from the one this Playwright release downloads by default.
 *
 * Returns `undefined` when nothing usable is found — including when
 * `PLAYWRIGHT_BROWSERS_PATH` is unset, which is the CI case: there
 * `npx playwright install chromium` puts the matching revision where Playwright
 * looks for it, and Playwright's own resolution is correct.
 */
function findPreinstalledChromium(): string | undefined {
  const root = process.env["PLAYWRIGHT_BROWSERS_PATH"];
  if (root === undefined || root === "" || root === "0" || !existsSync(root)) {
    return undefined;
  }
  const entries = readdirSync(root).sort();
  for (const [prefix, binary] of CHROMIUM_BINARIES) {
    for (const entry of entries) {
      if (!entry.startsWith(prefix)) continue;
      const candidate = join(root, entry, binary);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * Launch arguments for the `webgpu` project.
 *
 * Non-Windows is **byte-identical to what CI runs today** (103/103 green): a Windows-only
 * defect must not change the argv of the platform that already works.
 *
 * On Windows, `--use-angle=swiftshader` is dropped and `--use-webgpu-adapter=swiftshader`
 * takes its place. That flag is what denies Dawn an adapter here — it governs ANGLE, which
 * is WebGL's rasteriser, and is still exactly right for the `chromium` and `visual`
 * projects. The replacement keeps the property the config actually cares about: the gate
 * measures a **software** adapter (`google` / `swiftshader`), not this machine's NVIDIA
 * one, so a developer box and CI still measure the same thing.
 */
function webgpuLaunchArgs(): string[] {
  if (process.platform !== "win32") {
    return ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-webgpu"];
  }
  return ["--use-gl=angle", "--enable-unsafe-webgpu", "--use-webgpu-adapter=swiftshader"];
}

/** Preview port for `examples/first-2d-scene` — the suite's `baseURL`. */
const PORT = 4173;

/**
 * Preview port for `examples/physics-playground`.
 *
 * A second port rather than a second run: the two sites are independent Vite
 * builds, `vite preview` serves exactly one `dist` each, and Playwright starts
 * every entry of a `webServer` array before the first test. 4174 is the next
 * free port above {@link PORT} and is restated verbatim in
 * `tests/browser/playground.spec.ts`.
 */
const PLAYGROUND_PORT = 4174;

/**
 * Preview port for `examples/mechanism` — §109's demonstration.
 *
 * A third entry rather than a third run, for {@link PLAYGROUND_PORT}'s reason:
 * `vite preview` serves exactly one `dist`, and Playwright starts every entry of
 * a `webServer` array before the first test. 4175 is the next free port above
 * the playground's and is restated verbatim in `tests/browser/mechanism.spec.ts`.
 */
const MECHANISM_PORT = 4175;

/**
 * Preview port for `examples/blending` — §110's demonstration.
 *
 * A fourth entry rather than a fourth run, for {@link PLAYGROUND_PORT}'s reason:
 * `vite preview` serves exactly one `dist`, and Playwright starts every entry of
 * a `webServer` array before the first test. 4176 is the next free port above
 * the mechanism's and is restated verbatim in `tests/browser/blending.spec.ts`.
 */
const BLENDING_PORT = 4176;

/**
 * Preview port for `examples/particles-demo` — §112's demonstration.
 *
 * A fifth entry rather than a fifth run, for {@link PLAYGROUND_PORT}'s reason:
 * `vite preview` serves exactly one `dist`, and Playwright starts every entry of
 * a `webServer` array before the first test. 4177 is the next free port above
 * the blending demo's and is restated verbatim in
 * `tests/browser/particles.spec.ts`.
 *
 * This site is the cheap tier deliberately (plan §6h): it carries no physics
 * package and therefore no WebAssembly image, so it bundles to ~20 kB gzip —
 * the `first-2d-scene` order of magnitude, not the playground's ~670 kB. A fifth
 * server is only worth its §86 cost if the site it serves is small.
 */
const PARTICLES_PORT = 4177;

/**
 * Preview port for `examples/ui-demo` — the §73–§75 UI demonstration.
 *
 * A sixth entry rather than a sixth run, for {@link PLAYGROUND_PORT}'s reason:
 * `vite preview` serves exactly one `dist`, and Playwright starts every entry of
 * a `webServer` array before the first test. 4178 is the next free port above
 * the particles demo's and is restated verbatim in `tests/browser/ui.spec.ts`.
 *
 * Like the particles demo, this site is the cheap tier: no physics package, no
 * WebAssembly image — `ui`, `input`, `text`, `scene` and the WebGL backend
 * bundle to ~25 kB gzip.
 */
const UI_PORT = 4178;

/**
 * Preview port for `examples/first-3d-scene` — §93's first 3D scene.
 *
 * A seventh entry rather than a seventh run, for {@link PLAYGROUND_PORT}'s
 * reason: `vite preview` serves exactly one `dist`, and Playwright starts every
 * entry of a `webServer` array before the first test. 4179 is the next free port
 * above the UI demo's and is restated verbatim in
 * `tests/browser/first-3d-scene.spec.ts`.
 *
 * The cheap tier again: no physics package and no WebAssembly image — `scene`,
 * `math`, `geometry`, `materials`, `motion`, `animation` and the WebGL backend
 * bundle to ~23 kB gzip. A seventh web server is only worth its cost if the site
 * it serves is small (plan §6h's rule).
 */
const SCENE_3D_PORT = 4179;

/**
 * Preview port for `examples/flagship/one-scene-everything-moves` — §118's
 * flagship demonstration.
 *
 * An eighth entry rather than an eighth run, for {@link PLAYGROUND_PORT}'s
 * reason: `vite preview` serves exactly one `dist`, and Playwright starts every
 * entry of a `webServer` array before the first test. 4180 is the next free port
 * above the first 3D scene's and is restated verbatim in
 * `tests/browser/one-scene-everything-moves.spec.ts`.
 *
 * The *expensive* tier: this site selects its solver through §37's registry
 * (`solver: "auto"`), and `registerRapierSolver()` names both Rapier adapters —
 * so the bundle carries **both** wasm images, like the playground's, and weighs
 * ~1.54 MB gzip (measured 2026-08-07). A dimension-specific adapter would halve
 * it; exercising the registry is the point of this page, and the cost is
 * recorded rather than avoided.
 */
const FLAGSHIP_PORT = 4180;

/**
 * Preview port for `examples/flagship/motor-digital-twin` — §119's engineering
 * flagship.
 *
 * A ninth entry rather than a ninth run, for {@link PLAYGROUND_PORT}'s reason:
 * `vite preview` serves exactly one `dist`, and Playwright starts every entry of
 * a `webServer` array before the first test. 4181 is the next free port above
 * the §118 flagship's and is restated verbatim in
 * `tests/browser/motor-digital-twin.spec.ts`.
 *
 * A middle tier, and the reason it is one: the site constructs
 * `new Rapier3dAdapter()` directly rather than taking §37's registry, so it
 * carries **one** wasm image instead of the §118 flagship's two — but it is the
 * only example built with `__FOUR_DEV__` left at its default `true`, because
 * §84's `Application.stats` is gated on it (A-4) and this page's subject is
 * instrumentation. Measured 2026-08-08: 2.52 MB raw / 0.93 MB gzip, against the
 * flagship's 4.20 MB / 1.54 MB.
 */
const TWIN_PORT = 4181;

/**
 * Preview port for `examples/character-controller` — the §12 controller-family
 * example (the PH-11/PH-11b follow-up, 2026-08-29).
 *
 * A tenth entry rather than a tenth run, for {@link PLAYGROUND_PORT}'s reason:
 * `vite preview` serves exactly one `dist`, and Playwright starts every entry
 * of a `webServer` array before the first test. 4182 is the next free port
 * above the twin's and is restated verbatim in
 * `tests/browser/character-controller.spec.ts`.
 *
 * The mechanism's tier: one Rapier wasm image (a directly-constructed
 * `Rapier3dAdapter` — the page needs no §37 registry), measured 2.46 MB raw /
 * 0.90 MB gzip at landing.
 */
const CHARACTER_PORT = 4182;

/**
 * Preview port for `examples/gltf-model` — §78's loader, demonstrated.
 *
 * An eleventh entry rather than an eleventh run, for {@link PLAYGROUND_PORT}'s
 * reason: `vite preview` serves exactly one `dist`. 4183 is the next free port
 * above the character controller's and is restated verbatim in
 * `tests/browser/gltf-model.spec.ts`.
 *
 * No wasm image here — the page fetches `quad.gltf` and the `quad.bin` beside
 * it, both a few hundred bytes — so this server needs no widened timeout.
 */
const GLTF_MODEL_PORT = 4183;

export default defineConfig({
  testDir: "tests/browser",
  // Failure artifacts (traces, error context) live inside the already-ignored
  // `node_modules`, so a failed run never leaves untracked files in the tree.
  outputDir: "node_modules/.playwright/test-results",
  // Two of the three tests compare frames over wall-clock time; sharing a CPU
  // with a parallel worker makes those thresholds noisy under SwiftShader.
  workers: 1,
  fullyParallel: false,
  forbidOnly: process.env["CI"] !== undefined,
  retries: 0,
  reporter: process.env["CI"] !== undefined ? "list" : "line",
  // 120 s has no margin on Windows SwiftShader for screenshot-bound specs.
  // 180 s on win32 gives those machines room without hiding a hang on CI/Linux.
  timeout: process.platform === "win32" ? 180_000 : 120_000,
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    // Software rasterisation is the point: CI machines have no GPU, and a GPU
    // that *is* present must not change what the gate measures. ANGLE over
    // SwiftShader gives a real WebGL 2 context in both cases.
    launchOptions: {
      executablePath: findPreinstalledChromium(),
      args: ["--use-gl=angle", "--use-angle=swiftshader"],
    },
  },
  projects: [
    {
      name: "chromium",
      testDir: "tests/browser",
      // `tests/browser/webgpu` is the third project's, below. Ignored here so
      // one spec is not run twice under two project names.
      testIgnore: "webgpu/**",
      use: { browserName: "chromium" },
    },
    // §92's visual category (seeded 2026-08-04): golden-image comparison of
    // pages that are static at rest, compared SwiftShader-to-SwiftShader —
    // the launch args below force that rasteriser everywhere, so the
    // "no golden images" doctrine above (about SwiftShader-vs-GPU drift)
    // does not apply to this project. Goldens live next to the specs and are
    // committed; refresh with `npx playwright test --project visual
    // --update-snapshots` after reviewing the failure diff.
    {
      name: "visual",
      testDir: "tests/visual",
      use: { browserName: "chromium" },
    },
    // §62's second backend (WP-R1.1, 2026-08-21). A separate project rather
    // than more specs in `chromium`, for one reason: these specs **skip
    // themselves** when `requestAdapter()` resolves `null`, and a project
    // boundary is what makes "the WebGPU gate skipped entirely" legible in a
    // report instead of scattered through the WebGL results. They borrow the
    // first site's origin — WebGPU is absent on `about:blank`, so a gate page
    // must be served (recorded gotcha) — and, per §5 of the R-1 plan, they
    // compare no pixels against WebGL and carry no goldens: a WebGPU golden,
    // if one is ever justified, belongs in the `visual` project's
    // WebGPU-to-WebGPU snapshot directory.
    {
      name: "webgpu",
      testDir: "tests/browser/webgpu",
      use: {
        browserName: "chromium",
        // `--enable-unsafe-webgpu` is what turns `requestAdapter()` from
        // `null` into a SwiftShader adapter: Dawn resolves the
        // `libvk_swiftshader.so` that ships inside both browser trees, so no
        // Vulkan flag soup is needed — measured, one flag is enough.
        //
        // **Per project, not global**, and the reason is measured rather than
        // cautious. The R-1 plan recommended setting it globally on the
        // evidence that a `webgl2` context still initialises alongside it,
        // which is true — but context creation is not the whole gate:
        // `one-scene-everything-moves.spec.ts`'s slow-motion assertion
        // (§75, §9) fails with the flag on and passes without it, reproducibly
        // and on an idle machine. Initialising Dawn changes the frame pacing
        // the flagship measures. A flag that only the WebGPU specs need has no
        // business being in the other two projects' browsers, and confining it
        // keeps every landed WebGL and visual gate launching exactly the
        // browser it launched before (WP-R1.1, 2026-08-21).
        launchOptions: {
          executablePath: findPreinstalledChromium(),
          args: webgpuLaunchArgs(),
        },
      },
    },
  ],
  // All ten sites are started before the first test and torn down after the
  // last, so one `bun run test:browser` run covers every spec in `testDir`. The
  // entries use different ports, so they coexist rather than race for one.
  webServer: [
    {
      command: `npx vite preview examples/first-2d-scene --port ${String(PORT)} --strictPort`,
      url: `http://localhost:${String(PORT)}`,
      // A stale server could be serving an older build than the one just built.
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npx vite preview examples/physics-playground --port ${String(PLAYGROUND_PORT)} --strictPort`,
      url: `http://localhost:${String(PLAYGROUND_PORT)}`,
      reuseExistingServer: false,
      // The playground's bundle carries two Rapier wasm images and is ~4 MB, so
      // the *first* request is slower than the example's; the server itself
      // still starts in well under a second.
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npx vite preview examples/mechanism --port ${String(MECHANISM_PORT)} --strictPort`,
      url: `http://localhost:${String(MECHANISM_PORT)}`,
      reuseExistingServer: false,
      // One Rapier wasm image rather than two (the mechanism is a `"2d"` world),
      // so this bundle is about half the playground's.
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npx vite preview examples/blending --port ${String(BLENDING_PORT)} --strictPort`,
      url: `http://localhost:${String(BLENDING_PORT)}`,
      reuseExistingServer: false,
      // One Rapier wasm image, like the mechanism's: `examples/blending` is a
      // single `"2d"` world, plus the animation package the other examples that
      // animate already pull in.
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npx vite preview examples/particles-demo --port ${String(PARTICLES_PORT)} --strictPort`,
      url: `http://localhost:${String(PARTICLES_PORT)}`,
      reuseExistingServer: false,
      // No wasm at all: this bundle is ~20 kB gzip, so the first request is the
      // fastest of the six. The generous timeout is kept for uniformity.
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npx vite preview examples/ui-demo --port ${String(UI_PORT)} --strictPort`,
      url: `http://localhost:${String(UI_PORT)}`,
      reuseExistingServer: false,
      // The particles demo's tier: no wasm, ~25 kB gzip of JavaScript.
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npx vite preview examples/first-3d-scene --port ${String(SCENE_3D_PORT)} --strictPort`,
      url: `http://localhost:${String(SCENE_3D_PORT)}`,
      reuseExistingServer: false,
      // The same cheap tier: no wasm, ~23 kB gzip of JavaScript.
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npx vite preview examples/flagship/one-scene-everything-moves --port ${String(FLAGSHIP_PORT)} --strictPort`,
      url: `http://localhost:${String(FLAGSHIP_PORT)}`,
      reuseExistingServer: false,
      // The playground's tier and then some: two Rapier wasm images reach this
      // bundle through the §37 registry, so it is ~4.2 MB raw and the *first*
      // request is the slowest of the ten. The server itself still starts in
      // well under a second.
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npx vite preview examples/flagship/motor-digital-twin --port ${String(TWIN_PORT)} --strictPort`,
      url: `http://localhost:${String(TWIN_PORT)}`,
      reuseExistingServer: false,
      // One Rapier wasm image (a directly-constructed `Rapier3dAdapter`) plus a
      // development build of the engine: ~2.5 MB raw, between the mechanism's
      // tier and the §118 flagship's.
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npx vite preview examples/character-controller --port ${String(CHARACTER_PORT)} --strictPort`,
      url: `http://localhost:${String(CHARACTER_PORT)}`,
      reuseExistingServer: false,
      // One Rapier wasm image, the mechanism's tier: ~2.5 MB raw, so the first
      // request is slower than the page's own start.
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npx vite preview examples/gltf-model --port ${String(GLTF_MODEL_PORT)} --strictPort`,
      url: `http://localhost:${String(GLTF_MODEL_PORT)}`,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
