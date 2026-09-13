/**
 * A-4 — §85's development/production build split, proven at the bundle
 * (2026-08-07).
 *
 * §85 closes with *"Production builds may disable expensive validation while
 * preserving essential safety checks."* `@fourjs/core`'s `DEV` is the mechanism;
 * `packages/core/tests/dev.test.ts` proves its *semantics* by evaluating both
 * builds. That is not the same claim as the one this packet actually makes,
 * which is about **bytes**: that a real bundler, given
 * `define: { __FOUR_DEV__: "false" }`, folds the guard to a literal and deletes
 * the guarded code, so §84's statistics wiring and §6a's duplicate-component
 * warning stop being shipped to users who will never read them.
 *
 * Only a bundler can answer that, so this file runs one — the same Vite the
 * examples build with, twice over the same entry, and compares.
 *
 * The second half is the rule that keeps the mechanism safe. Determinism
 * (§33–§34) is defined over the simulation and a replay recorded in a
 * development build must reproduce bit-exactly in a production one, so **no
 * value that reaches a solver, an integrator, a checksum, a snapshot, or a
 * serialized document may depend on `DEV`**. That is a prose rule, and prose
 * rules decay; {@link GATED} turns it into a list. A new file that gates on the
 * flag fails this suite until someone adds it there, which is the moment the
 * §33 argument has to be made out loud.
 */

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";

import { build } from "vite";
import { afterAll, describe, expect, it } from "vitest";

const repositoryRoot = join(import.meta.dirname, "..", "..");

/**
 * Where the throwaway bundle entry is written.
 *
 * Inside the repository, because Node's resolution walks up from the *entry
 * file* and an entry in the system temp directory cannot see the workspace's
 * `four` symlink; under `node_modules/`, because that is already ignored by
 * git, ESLint, and Prettier, so a crashed run cannot leave a file the gates
 * would then complain about.
 */
const scratchDirectory = join(
  repositoryRoot,
  "node_modules",
  ".four-dev-build-mode",
);

/**
 * The program the bundles are built from: the smallest thing that touches every
 * path this packet gated. `stats: true` asks for §84 explicitly — a production
 * build has to drop the wiring *despite* being asked, which is the interesting
 * case — and `addComponent` twice reaches §6a's duplicate warning.
 */
const ENTRY_SOURCE = `
import { Application } from "fourJS/application";
import { Group } from "fourJS/scene";

class Marker {
  static readonly typeName = "probe.marker";
}

export function boot(): Application {
  const app = new Application({ stats: true });
  const node = new Group();
  node.addComponent(new Marker());
  node.addComponent(new Marker());
  app.scene.add(node);
  return app;
}
`;

/**
 * Strings that exist **only** on a gated path, one per gated cost.
 *
 * Each is a literal that survives minification (a property name a record is
 * built with, or message text), so finding it in the output means the code that
 * produces it was shipped. They are deliberately specific: `drawCalls` would
 * have been a bad probe, because `@fourjs/render`'s own statistics record uses
 * that name on a path this packet does *not* gate.
 */
const GATED_MARKERS: ReadonlyArray<readonly [string, string]> = [
  ["cpuFrameTime", "§84's FrameStats record (A-1)"],
  [
    "textureMemory",
    "§84's memory counters, and with them §83's accounting readers (A-5)",
  ],
  ["already attached", "§6a's duplicate-component warning"],
  [
    "performance",
    "the §84 monotonic clock — the last thing holding @fourjs/diagnostics in",
  ],
];

interface Bundles {
  readonly development: string;
  readonly production: string;
}

/** Bundles {@link ENTRY_SOURCE} once per build mode and returns both outputs. */
async function bundleBothModes(): Promise<Bundles> {
  mkdirSync(scratchDirectory, { recursive: true });
  const entry = join(scratchDirectory, "entry.ts");
  writeFileSync(entry, ENTRY_SOURCE);

  const run = async (define: Record<string, string>): Promise<string> => {
    const result = await build({
      root: repositoryRoot,
      // `configFile: false` so the repository's own Vite config (if one ever
      // appears) cannot quietly change what this test measures.
      configFile: false,
      logLevel: "silent",
      define,
      build: {
        write: false,
        minify: true,
        lib: { entry, formats: ["es"], fileName: "probe" },
      },
    });
    const outputs = Array.isArray(result) ? result[0].output : [];
    const chunk = outputs.find((output) => output.type === "chunk");
    if (chunk === undefined || chunk.type !== "chunk") {
      throw new Error("the probe build produced no chunk");
    }
    return chunk.code;
  };

  return {
    development: await run({}),
    production: await run({ __FOUR_DEV__: "false" }),
  };
}

const bundles = await bundleBothModes();

afterAll(() => {
  rmSync(scratchDirectory, { recursive: true, force: true });
});

describe("A-4 — the production define strips what it says it strips", () => {
  it.each(GATED_MARKERS)(
    "drops %s from a production bundle",
    (marker, what) => {
      expect(
        bundles.development,
        `${what} should ship in development`,
      ).toContain(marker);
      expect(
        bundles.production,
        `${what} should not ship in production`,
      ).not.toContain(marker);
    },
  );

  it("leaves the identifier itself out of both bundles' runtime path", () => {
    // Development keeps the `typeof __FOUR_DEV__` guard, which is what makes
    // bare consumption safe: the global is never *read*, so a host that has
    // never heard of the define does not get a ReferenceError.
    expect(bundles.development).toContain("__FOUR_DEV__");
    expect(bundles.development).toContain("typeof");
    // Production has no trace of it at all — the ternary folded to a literal.
    expect(bundles.production).not.toContain("__FOUR_DEV__");
  });

  it("is smaller, by more than a rounding error", () => {
    // The measured saving on this entry was ~2.2 kB raw / ~0.5 kB gzip, which
    // is A-1's recorded "~0.4 kB gzip per example" plus §6a's warning and the
    // clock. The assertion is a floor, not the measurement: it fails if the
    // gating silently stops working, and does not have to be edited when an
    // unrelated packet moves the number.
    expect(bundles.production.length).toBeLessThan(
      bundles.development.length - 1024,
    );
  });
});

/**
 * Every package source that may gate on §85's build flag, with the reason it is
 * allowed to — and, for each, why the gated work cannot reach a simulation.
 *
 * Adding a file here is a deliberate act. Before you do, answer the §33
 * question in one sentence: *if this block never ran, would any number the
 * engine computes change?* If the answer is anything but "no", the code does
 * not belong behind the flag.
 */
const GATED: ReadonlyMap<string, string> = new Map([
  [
    join("packages", "core", "src", "dev.ts"),
    "declares the flag — DEV, devWarn, devWarnOnce, devAssert (A-4)",
  ],
  [join("packages", "core", "src", "index.ts"), "re-exports them; no logic"],
  [
    join("packages", "core", "src", "component.ts"),
    "§6a's duplicate-component warning. The *replacement* is unconditional; only the console message moves with the flag",
  ],
  [
    join("packages", "diagnostics", "src", "resource-audit.ts"),
    "§83's leaked-resource audit — a function the author calls, whose only output is text",
  ],
  [
    join("packages", "diagnostics", "src", "dev-warnings.ts"),
    "§83's disposed-in-use, detached-listener, stale-handle, and per-frame allocation warnings — message only",
  ],
  [
    join("packages", "diagnostics", "src", "allocation-audit.ts"),
    "§83's per-frame allocation audit — a function the author calls. Production returns the frozen empty report without reading the counters; the only output is a console message. No simulation number moves with the flag",
  ],
  [
    join("packages", "core", "src", "leak-registry.ts"),
    "§83's FinalizationRegistry leak bookkeeping — every public function is a no-op when DEV is false; the only output is a warning text. Core, not simulation: geometry / render / materials call it at construction so they never import @fourjs/diagnostics",
  ],
  [
    join("packages", "geometry", "src", "resource-memory.ts"),
    "§83 FinalizationRegistry helpers beside the always-on live-geometry counters. The counts do not branch on DEV; only trackGeometryDisposable / releaseGeometryDisposable do, and their only output is a later warning text. Geometry is not a simulation package",
  ],
  [
    join("packages", "render", "src", "resource-memory.ts"),
    "§83 FinalizationRegistry helpers beside the always-on texture / render-target counters. The counts do not branch on DEV; only trackRenderDisposable / releaseRenderDisposable do. Rendering is outside the §33 envelope",
  ],
  [
    join("packages", "materials", "src", "resource-memory.ts"),
    "§83 FinalizationRegistry helpers beside the always-on live-material counter. The count does not branch on DEV; only trackMaterialDisposable / releaseMaterialDisposable do. Materials are render state, not simulation",
  ],
  [
    join("packages", "render", "src", "lights.ts"),
    "§68's punctual-light overflow notice (2026-09-06). Message only: the walk still takes the first MAX_PUNCTUAL_LIGHTS in scene-graph order and skips the rest in both builds — the skip is unconditional, and only which console path names it moves with the flag. Rendering is outside the §33 envelope; nothing a frame shades re-enters simulation state (§42/§43)",
  ],
  [
    join("packages", "render", "src", "resource-warnings.ts"),
    "§83's disposed-in-use helper for render resources — a no-op in production; the draw is skipped identically either way and only the message moves with the flag",
  ],
  [
    join("packages", "diagnostics", "src", "validation.ts"),
    "§85's validation catalogue — named checks and devAssert scans; no simulation numbers",
  ],
  [
    join("packages", "fourjs", "src", "application.ts"),
    "§84's statistics wiring (A-1). Measurement only: `stats` is read by nobody inside the engine, and the frame's event order, transforms and draw calls are identical either way",
  ],
  [
    join("packages", "input", "src", "keyboard-input.ts"),
    "KeyboardInput's malformed-options refusal (2026-09-06). Refusal only, and it is unreachable from any well-formed call: the constructor requires (surface, { focusTarget }) in both builds, and every caller that passes a function keeps running identically whatever the flag says. What the guard drops is the *diagnostic* for a call that could not have worked anyway — a production build answers it with the same TypeError the field access always raised. Gated because the message names the call shape, `@fourjs/ui`'s keyboardFocusTarget and the DOM-listener alternative, and shipping that prose put examples/ui-demo 245 B over its §86 budget. `@fourjs/input` is not a simulation package: no number a replay reproduces passes through it (§33)",
  ],
  [
    join("packages", "render", "src", "render-list.ts"),
    "§85's layer-mask refusal (R-38). Refusal only: a well-formed mask — the only kind `layerMask()` can build — passes the check untouched, so the list, its order, and every item in it are identical either way. What the guard drops is the *diagnostic* for a `NaN` or fractional mask, which a production build answers with the empty view it would have drawn anyway. `@fourjs/scene`'s `assertLayerMask` is unconditional, because §33 forbids that package from branching on the build mode at all; this is the render tier's copy of the call, gated because it costs ~115 B gzip in every shipped bundle. R-23 (2026-08-28) added §67's clip-on-a-non-drawable warning under the same rule: the clip is inert in both builds — the subtree is not narrowed either way — and only the message moves with the flag",
  ],
  [
    join("packages", "render", "src", "clip.ts"),
    "§67's plane-exhaustion diagnostic (R-23, 2026-08-28). Message only: `allocate` returns `null` for the ninth clip in both builds — the over-limit clip is dropped and its subtree keeps the eight that fit, identically, whatever the flag says — so the list, its order, its stencil records, and every GL call derived from them are the same either way. If the gated block never ran, no number the engine computes would change; what the guard drops is the console.warn naming the first refused clip",
  ],
  [
    join("packages", "render-webgl", "src", "gl-texture.ts"),
    "§83's disposed-texture warning when acquire meets a disposed texture — draw skipped identically in both builds; message only",
  ],
  [
    join("packages", "render-webgl", "src", "webgl-renderer.ts"),
    "§67's clip-without-a-stencil-buffer warning (R-23, 2026-08-28). Diagnostic only, and O(1): mask draws sort to the head of the frame list, so the check is one read of the first item, issues no GL call, and writes no value any later code reads — a production build draws the identical (unclipped) frame silently, which is the same fail-toward-drawing behaviour the warning describes. RFC 0001 (2026-08-28) added two §60 warnings under the same rule: the unregistered-node-pipeline notice and the unresolvable-node-texture notice — in both builds the draw is skipped identically (absence, never a flat-coloured stand-in), and only the message naming the fix moves with the flag",
  ],
  [
    join("packages", "render-webgpu", "src", "webgpu-renderer.ts"),
    "§67's clip-into-a-stencil-less-render-target warning (WP-R1.6, 2026-08-28) — the WebGPU restatement of the GL entry above, reachable only off screen (the on-screen attachment always widens to carry stencil). Diagnostic only, and O(1): the check is one read of the frame's first item beside the target record's `stencil` flag, records no command, and writes no value any later code reads — a production build draws the identical (unclipped) frame silently, the same fail-toward-drawing behaviour the warning describes. WP-R1.9 (2026-08-29) added §60's unregistered-node-pipeline notice under the GL entry's rule: the draws are skipped identically in both builds (absence, never a flat-coloured stand-in), and only the message naming registerWebgpuNodeMaterialPipeline() moves with the flag. RFC 0003 (2026-09-09) added the same two notices for the skinned colour pair: unregistered (`registerSkinningPipeline()`) and factory-compile failure — skipped identically, never a bind pose, only the message moves. Rendering is outside the §33 envelope regardless; nothing a frame draws re-enters simulation state (§42/§43)",
  ],
  [
    join("packages", "render-webgpu", "src", "wgpu-node-program.ts"),
    "§60's three node-store notices (WP-R1.9, 2026-08-29) — the WebGPU twin of gl-node-program.ts's entry: the per-graph emission-failure latch (latched `null` in both builds; the latch is the behaviour, only the console.warn moves), the unresolvable-node-texture notice (the draw is skipped identically), and the missing-vertex-stream notice (skipped identically — the recorded GL divergence's diagnostic). Rendering is outside the §33 envelope regardless; nothing a shader draws re-enters simulation state (§42/§43)",
  ],
  [
    join("packages", "render-webgl", "src", "gl-picking.ts"),
    "§71's id-program compile-failure notice (RFC 0005, 2026-08-28). Message only: the failure is latched per context era in both builds — picking passes are skipped identically, and `pick` refuses identically for want of an id buffer — and only the console.warn carrying §89's log moves with the flag. Picking is outside the §33 envelope regardless: a pick is a §34 *input*, its result never enters a checksum, and nothing an id pass draws re-enters simulation state (§42/§43)",
  ],
  [
    join("packages", "render-webgpu", "src", "wgpu-picking.ts"),
    "§71's id-pipeline compile-failure notices (RFC 0005, 2026-09-09) — the WebGPU twin of gl-picking.ts's entry: mesh and particle id pipelines each latch a per-device failure in both builds, picking passes are skipped identically, and only the console.warn carrying §89's log moves with the flag. Picking is outside the §33 envelope regardless: a pick is a §34 *input*, its result never enters a checksum, and nothing an id pass draws re-enters simulation state (§42/§43)",
  ],
  [
    join("packages", "assets", "src", "asset-manager.ts"),
    "§83's settled-slot duplicate-load warning (2026-09-06). Message only: a second load of a decoded (url, loader) slot still returns the same cached promise in both builds — in-flight coalescing is silent and unconditional — and only the console.warn naming the pair moves with the flag. `@fourjs/assets` is IO, not a simulation package: no number a replay reproduces passes through it (§33)",
  ],
  [
    join("packages", "assets", "src", "gltf.ts"),
    "§78's ignored-feature notices (A-19, 2026-08-29). Message only: every ignored feature is recorded unconditionally in GltfAsset.ignored — the §33 evidence is the determinism suite's pinned digest, which is computed over the parse output and holds in both builds — and only the console.warn naming each feature moves with the flag. Parsing is IO, runs before any fixed step, and its output is a pure function of the input bytes either way",
  ],
  [
    join("packages", "fourjs", "src", "gltf.ts"),
    "§78's ignored-texture-slot warning at instantiation (A-19, 2026-08-29). Message only: the instantiated nodes, materials (factors applied, unsampleable slots absent), and clips are identical in both builds — the slot list itself is parse data on the material record — and only the console.warn saying the base map is the one sampled moves with the flag. Assembly runs outside the fixed step and writes nothing any simulation reads",
  ],
  [
    join("packages", "render-webgl", "src", "gl-node-program.ts"),
    "§60's per-graph compile-failure notice (RFC 0001, 2026-08-28). Message only: the cache latches the failed graph `null` in both builds — its draws are skipped identically, the latch is the behaviour and it is unconditional — and only the console.warn carrying §89's log moves with the flag. Rendering is outside the §33 envelope regardless; nothing a shader draws re-enters simulation state (§42/§43)",
  ],
]);

/** Every `.ts` file under `packages/<name>/src`, repository-relative. */
function packageSources(): string[] {
  const found: string[] = [];
  const packagesDirectory = join(repositoryRoot, "packages");
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".ts")) found.push(relative(repositoryRoot, path));
    }
  };
  for (const pkg of readdirSync(packagesDirectory)) {
    const source = join(packagesDirectory, pkg, "src");
    try {
      if (!statSync(source).isDirectory()) continue;
    } catch {
      continue;
    }
    walk(source);
  }
  return found;
}

/**
 * Whether `file` *imports* one of the flag's names — an import, not a text
 * match, so a module header that merely explains the rule (as `stats.ts` does)
 * is not mistaken for a module that follows it.
 */
function importsTheFlag(file: string): boolean {
  const source = readFileSync(join(repositoryRoot, file), "utf8");
  const imports = source.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g,
  );
  for (const match of imports) {
    if (/\b(?:DEV|devWarn|devWarnOnce|devAssert)\b/.test(match[1])) return true;
  }
  // `dev.ts` itself declares them rather than importing them.
  return /export const DEV\b/.test(source);
}

describe("§33 — the flag stays out of everything deterministic", () => {
  it("is gated only in files that have argued for it", () => {
    const unexpected = packageSources().filter(
      (file) => importsTheFlag(file) && !GATED.has(file),
    );
    expect(
      unexpected,
      "these files gate on §85's build flag without a recorded §33 argument; add them to GATED with one, or take the flag out",
    ).toEqual([]);
  });

  it("has no stale allowlist entries", () => {
    const sources = new Set(packageSources());
    const gone = [...GATED.keys()].filter((file) => !sources.has(file));
    expect(gone, "GATED names files that no longer exist").toEqual([]);
  });

  it("names no simulation package", () => {
    // The blunt half of the rule, stated as a list rather than as a judgement:
    // these are the packages a replay's numbers come out of, and none of them
    // may branch on the build mode at all.
    const simulation = [
      "math",
      "motion",
      "scene",
      "physics",
      "animation",
      "particles",
    ];
    for (const file of GATED.keys()) {
      const pkg = file.split(sep)[1];
      expect(
        simulation,
        `${file} is in a simulation package (§33)`,
      ).not.toContain(pkg);
    }
  });
});

describe("every example builds in production mode", () => {
  it("defines __FOUR_DEV__ as false", () => {
    // The examples are what `bun run size` measures against §86's payload
    // budget, so an example that forgot the define would quietly measure a
    // development bundle and report a number no user experiences.
    const configs: string[] = [];
    const walk = (directory: string): void => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (name === "node_modules" || name === "dist") continue;
        if (statSync(path).isDirectory()) walk(path);
        else if (name === "vite.config.ts") configs.push(path);
      }
    };
    walk(join(repositoryRoot, "examples"));
    expect(configs.length).toBeGreaterThan(0);
    for (const config of configs) {
      expect(
        readFileSync(config, "utf8"),
        `${relative(repositoryRoot, config)} must build in production mode`,
      ).toContain('__FOUR_DEV__: "false"');
    }
  });
});
