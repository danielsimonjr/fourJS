# fourJS

**One scene. Every dimension. Everything moves.**

fourJS is a unified JavaScript/TypeScript framework for building interactive
applications that combine 2D, 2.5D, and 3D graphics with animation, motion systems, and
physics in a single shared scene model. 2D shapes, 3D meshes, sprites, text, UI widgets,
rigid bodies, joints, and particle emitters are all nodes and components in one scene
graph, over one fixed-step simulation loop with interpolated rendering.

The full implementation plan (§103–§113a) is complete: 24 workspace packages build,
test (≈3,000 unit tests, coverage ≥95% per package, browser-verified rendering and
input), and lint. The §120 MVP audit stands at **43/43 shipped-or-MVP** — this line read
"42/43 … lighting is the single staged absence" until 2026-08-05, which stopped being
true when the lighting packet landed 2026-08-04 (`docs/AUDIT-120.md`, S-5). Six of the 43
ship at a pinned MVP tier with a dated widening staged; see that audit's staged lines
before quoting the count. The packages are not yet published to npm.

## Quick start (§93)

Until first publish, clone the repository and build the workspace
(`bun install && bun run build`), then run any example with
`bunx vite examples/first-2d-scene`. The smallest program looks like this:

```ts
import { Application } from "fourJS/application";
import { circleGeometry2D } from "fourJS/geometry";
import { UnlitMaterial } from "fourJS/materials";
import { OrthographicCamera, createFullscreenViewport } from "fourJS/scene";
import { Renderable } from "fourJS/render";
import { WebglRenderer } from "fourJS/render-webgl";

const canvas = document.querySelector("canvas")!;
const renderer = new WebglRenderer();

// A world-unit view: right-handed, Y-up (§7a), radians and seconds everywhere.
const camera = new OrthographicCamera({
  left: -4,
  right: 4,
  bottom: -3,
  top: 3,
  near: 0.1,
  far: 10,
});
camera.position.set(0, 0, 5);

const app = new Application({
  renderer,
  canvas,
  views: [createFullscreenViewport(camera)],
});
renderer.resize(800, 600, window.devicePixelRatio);
app.scene.add(camera);

// One node: a flat 2D circle in the same graph a 3D mesh would join.
const circle = new Renderable(
  circleGeometry2D({ radius: 1 }),
  new UnlitMaterial({ color: [1, 0.5, 0.2, 1] }),
);
app.scene.add(circle);

// Simulation advances in fixed 1/60 s steps; rendering interpolates (§10).
app.poses.track(circle);
app.on("update", (time) => {
  circle.position.set(
    Math.cos(time.simulationTime),
    Math.sin(time.simulationTime),
    0,
  );
});

await app.initialize();
app.start();
let last = performance.now();
requestAnimationFrame(function frame(now) {
  app.step(Math.max(0, now - last) / 1000);
  last = now;
  requestAnimationFrame(frame);
});
```

> The snippet is illustrative; the compiling, running version of every idea in it is
> `examples/first-2d-scene/main.ts`, which adds picking, dragging, sprites, text, and
> authored animation on top. Start there.

**One rule to know before you animate anything (§42).** Exactly one system owns a node's
transform. The snippet above writes `circle.position` by hand, which works because the default
owner is `"manual"` — but the moment a tween, an `AnimationMixer` or a motion system should
move that node instead, say so:

```
circle.transformAuthority = "animation";   // or "kinematic", "physics", "manual"
```

Without it the write is **refused, not applied**: the node simply does not move, and the engine
explains why on the console (`a "animation" system tried to write the transform of node … owned
by "manual" authority`). The refusal is deliberate — two systems writing one transform is how a
replay stops reproducing (§33) — but it is easier to read here than to meet at runtime.

## Examples

Each example is a small Vite app; build them all with `bun run examples:build` or serve one
directly with `bunx vite examples/<name>`.

| Example                               | Shows                                                                                                                                                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `first-2d-scene`                      | Scene/render/motion pillars, §13 trajectories, tweens/clips/timelines, picking, dragging, text                                                                                                                  |
| `first-3d-scene`                      | Perspective camera, §53 3D primitives, §68 directional light + ambient, lit materials                                                                                                                           |
| `physics-playground`                  | Rigid bodies on the Rapier adapter, mixed 2D/3D worlds, §42 authority                                                                                                                                           |
| `mechanism`                           | §28 joints: a slider-crank driven by a motor, with live limits                                                                                                                                                  |
| `blending`                            | §19 physics-animation blending: animated ↔ ragdoll ↔ recovering, in-place re-typing                                                                                                                             |
| `particles-demo`                      | SoA particle core, §27 force fields, one-draw-call instanced rendering                                                                                                                                          |
| `ui-demo`                             | @fourjs/ui widgets (panel/buttons/labels), app-supplied skins, keyboard focus, §72 pointer events                                                                                                               |
| `gltf-model`                          | §78 glTF: `createGltfLoader` + `instantiateGltf`, and the `{ fetch }` an external `.bin` needs                                                                                                                  |
| `flagship/one-scene-everything-moves` | **§118's flagship**: 2D art, lit 3D meshes, bodies, joints, particles, world text and a screen-space UI panel in one scene; pause/slow-motion/step; §62/§37 `"auto"`                                            |
| `flagship/motor-digital-twin`         | **§119's flagship**: a motorised, bearing-constrained rotor on a sprung mount; PID speed control, fault injection, §40 unit readouts, §84 statistics, waveform charts, §34 record/seek/replay and §79 save/load |

## The four pillars

- **Scene** — one graph (`@fourjs/scene`): nodes, typed events (§6b), components (§6a),
  transform authority (§42), cameras and viewports.
- **Render** — a backend-independent interface (`@fourjs/render`) with a WebGL 2 backend
  (`@fourjs/render-webgl`); WebGPU/Canvas/SVG tiers are reserved interfaces (§62).
- **Motion** — integrators, trajectories, kinematic control, steering, PID, springs,
  seeded randomness (`@fourjs/motion`), and authored animation (`@fourjs/animation`).
- **Physics** — a stable API (`@fourjs/physics`) over pluggable solver adapters (§37);
  `@fourjs/physics-rapier` ships 2D and 3D Rapier solvers with determinism goldens,
  snapshots, and bit-identical replay (§33–§34, `@fourjs/diagnostics`).

Conventions everywhere: right-handed **Y-up world in both 2D and 3D**, radians, **all
times in seconds**, fixed-step simulation with render interpolation (§10). See
`docs/guides/` for prose guides and `CLAUDE.md`/`AGENTS.md` for contributor orientation.

## Development

```sh
bun install --frozen-lockfile   # workspace install (Bun >= 1.2; RFC 0006)
bun run build                   # tsc -b across packages/* (sequential)
bun run test                    # per-package unit tests (Vitest)
bun run test:suites             # cross-package integration + determinism suites
bun run test:browser            # Playwright + SwiftShader browser gates
bun run lint                    # oxlint (type-aware, via tsgolint/TypeScript 7)
bun run docs                    # TypeDoc API reference
bun run check-spec              # specification consistency checks
bun run graph                   # regenerate docs/Architecture (dependency graph)
bun run size                    # §86 payload budget (150 kB gzip ceiling)
```

## Specification

See [docs/SPECIFICATION.md](docs/SPECIFICATION.md) — the working reference for this
repository (parts I–XIII, sections 1–120 plus lettered insertions and appendices, no
duplicates). Its amendments table records each revision. The original
[docs/archive/four-js-specification.pdf](docs/archive/four-js-specification.pdf) is
preserved unchanged and **frozen at the pre-1.0 text**; [docs/ERRATA.md](docs/ERRATA.md)
documents its known defects and the old-to-new numbering map.

Publish naming (§98): the umbrella package publishes as `@danielsimonjr/fourjs`, the
sub-packages as `@danielsimonjr/fourjs-<name>`; workspace names remain `four`/`@fourjs/*`.

## Compatibility

[docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) carries §90's five tables — browser and
runtime support (what is _tested_ versus what is merely expected), the §62 render-backend
tiers, the physics solver adapters, the scene/replay/snapshot format versions, and the
plugin API (n/a: §81 is unimplemented). The solver-adapter block is generated from the
adapters' own §37 capability declarations by `node tools/generate-compatibility.mjs`;
`--check` fails if the committed document has drifted from them.

## License

MIT — see [LICENSE](LICENSE).
