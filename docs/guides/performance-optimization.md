# Performance optimization

§86 states the engineering targets; the committed benchmarks state what has
been measured. This guide covers both, plus the practices the engine's own
hot paths use — which are the same ones your application code should.

## Targets vs. measurements

§86's headline targets (100 000 batched sprites, 5 000 rigid bodies, 150 kB
gzip minimal payload, …) are benchmark goals, not guarantees. What the
committed benchmark records (`benchmarks/`, run on a 4-core CI Xeon) actually
say:

- **Particles:** 100 000 particles + 3 force fields = **16.54 ms/step mean**
  — 99.2 % of the 60 Hz budget, p95 over it. The integrator alone is 1.35 ms;
  each polymorphic §27 `sample()` call site costs ~5.3 ms per 100 k. Fewer,
  cheaper fields is the lever.
- **Physics:** contacts + event derivation are **~88 % of a physics step**.
  Fewer touching pairs (filtering, sleeping, sensor discipline) buys more
  than any micro-optimization.
- **Scene:** a clean world-transform pass is only ~3× cheaper than a full
  recompute — dirty-tracking helps but is not free; scene depth is
  recursion-limited around ~8 k.
- **Payload:** the §86 gate holds the minimal 2D app at **36.79 kB gzip** of
  its 150 kB budget (32.13 kB when this line was written; the example has
  gained scene content since, and 0.48 kB of the current figure came back off
  it when the production build mode landed — see below). Solver wasm is outside
  the budget by its wording (~670 kB gzip per Rapier dimension) — load it async
  and show a loading state, as every physics example does.

## Draw calls: batching is per system, not per particle

A `ParticleRenderable` is exactly **one** instanced draw whatever its count.
The demo below simulates thousands of particles in two draw calls; scaling
the numbers up changes fill rate, not call count:

```ts
import { Application } from "fourJS/application";
import { Vector3 } from "fourJS/math";
import {
  ParticleEmitter,
  ParticleRenderable,
  ParticleSystem,
  uniformGravityField,
} from "fourJS/particles";
import { WebglRenderer, registerParticlePipeline } from "fourJS/render-webgl";
import { OrthographicCamera, createFullscreenViewport } from "fourJS/scene";

const canvas = document.querySelector<HTMLCanvasElement>("#scene");
if (canvas === null) throw new Error("no canvas");

// WebGL 2 draws particles through a registered pipeline (2026-09-11) — the
// same seam as skinning and picking. One explicit call links the instanced
// billboard program; without it every `ParticleRenderable` is skipped with a
// single development warning naming this line.
registerParticlePipeline();

const camera = new OrthographicCamera({
  left: -4,
  right: 4,
  bottom: -3,
  top: 3,
  near: 0.1,
  far: 20,
});
camera.transform.position.set(0, 0, 10);
camera.updateProjectionMatrix();

const renderer = new WebglRenderer();
const app = new Application({
  renderer,
  canvas,
  views: [createFullscreenViewport(camera)],
});
renderer.resize(800, 600, window.devicePixelRatio);
app.scene.add(camera);

function fountain(x: number, seed: number): ParticleEmitter {
  return new ParticleEmitter({
    maxParticles: 3000, // capacity is part of the RNG stream — size it once
    seed,
    position: new Vector3(x, -2, 0),
    emissionRate: 1200,
    lifetime: { min: 1.2, max: 2 },
    initialSpeed: { min: 4, max: 6 },
    direction: new Vector3(0, 1, 0),
    spreadAngle: 0.25,
    size: { start: 0.06, end: 0.02 },
    color: {
      start: { r: 1, g: 0.7, b: 0.3, a: 1 },
      end: { r: 1, g: 0.2, b: 0.1, a: 0 },
    },
    // One constant acceleration? Use the emitter's own gravity option —
    // it costs no per-particle virtual call, a field does (~5 ms/100k each):
    gravity: new Vector3(0, -9.81, 0),
  });
}

const left = fountain(-1.5, 101);
const right = fountain(1.5, 102);
app.scene.add(new ParticleRenderable(left)); // draw call 1
app.scene.add(new ParticleRenderable(right)); // draw call 2

const particles = new ParticleSystem();
app.systems.register(particles);
particles.track(left);
particles.track(right);

let last: number | null = null;
function frame(now: number): void {
  if (last !== null) app.step((now - last) / 1000);
  last = now;
  requestAnimationFrame(frame);
}
app.initialize().then(() => {
  app.start();
  requestAnimationFrame(frame);
});
```

Sprites and glyphs are **not** batched yet (each is a draw; the §55
frame-region + §65 batching backlog) — keep label counts modest and cache
materials per distinct texture, as the examples do.

## Allocation discipline (§7b)

The math types are mutable with `out`-parameter hot paths, and the engine's
own systems allocate nothing per step. Do the same in yours:

```ts
const impulse = new Vector3(); // module-level scratch
node.on("click", (event) => {
  impulse.set(0, 6.5 * (body.mass ?? 1), 0); // reuse; no per-event allocation
  body.wake();
  body.applyImpulse(impulse);
});
```

Prefer `position.set(...)` over building new vectors; one clamped `set` also
advances the transform version once instead of twice. Diagnostics helpers
follow the same convention (`solverStatistics(access, out)` reuses `out`).

## Development and production builds (§85)

§85 ends with a permission: _"Production builds may disable expensive
validation while preserving essential safety checks."_ The engine acts on it
through one build-time define.

```ts
// vite.config.ts (esbuild, Rollup and webpack all spell this the same way)
export default defineConfig({
  define: { __FOUR_DEV__: "false" },
});
```

**You opt out, not in.** `__FOUR_DEV__` is a global that need not exist. The
engine reads it as `typeof __FOUR_DEV__ !== "undefined" ? __FOUR_DEV__ : true`,
in one place (`@fourjs/core`'s `dev.ts`), so a program that never configures a
bundler — a `<script type="module">`, a Vitest run, `node` — is a development
build and gets every warning. Define it as `"false"` and the ternary folds to a
literal at build time, every `if (DEV)` in every package becomes dead code, and
the tree-shaker deletes it.

What a production build stops shipping today, measured on the repository's own
examples:

| Example        | development | production | saved   |
| -------------- | ----------- | ---------- | ------- |
| first-2d-scene | 37.27 kB    | 36.79 kB   | 0.48 kB |
| first-3d-scene | 25.50 kB    | 25.04 kB   | 0.46 kB |
| particles-demo | 23.56 kB    | 23.04 kB   | 0.52 kB |
| ui-demo        | 30.96 kB    | 30.46 kB   | 0.50 kB |

(gzip, `bun run size`. The flagship is unchanged at 1.54 MB — its payload is
Rapier's two wasm images, which dwarf half a kilobyte.)

Three things go, and they are all things only an author reads:

- **§84's statistics wiring.** `app.stats` is `null` in a production build even
  if you passed `stats: true`, and `@fourjs/diagnostics` leaves the bundle
  entirely. The option and the member keep their types in both builds, so
  `app.stats?.drawCalls` compiles and runs either way — it simply answers
  `undefined`. Measure in development.
- **§6a's duplicate-component warning.** The _behaviour_ — one component of a
  type per node, the old one detached — is unconditional; only the
  `console.warn` moves.
- **§83's leak audit.** `auditResourceLeaks` returns `NO_RESOURCE_LEAKS`
  without looking at its arguments.

**What never moves:** every `FourError` the engine throws. §85 calls those the
"essential safety checks", and a production build performs all of them —
scene-graph cycles, serialization version mismatches, invalid geometry indices,
lifecycle misuse. If a check must hold in the field, it is a throw, not a
warning.

**And nothing the simulation computes may depend on it** (§33). A replay
recorded in a development build has to reproduce bit-exactly in a production
one, so the flag is confined to warnings, assertions and measurement.
`tests/integration/dev-build-mode.test.ts` enforces that mechanically: it lists
every file allowed to gate on the flag, and fails when a new one appears
without a recorded argument.

### Writing your own gated code

`@fourjs/core` exports the flag and three helpers:

```ts
import { DEV, devWarn, devWarnOnce, devAssert } from "fourJS/core";

if (DEV && node.scale.x === 0) {
  devWarnOnce(
    `degenerate:${String(node.id)}`,
    "a zero scale is not invertible (§85).",
  );
}
```

Guard at the **call site**, not only inside the helper. Each helper begins with
its own `if (!DEV) return;`, but that only stops the console write — the
message you passed was still built. `if (DEV) devWarn(…)` deletes the whole
statement, message included.

`devAssert(condition, code, message)` throws a `FourError` in development and
does nothing in production, which is §85's "expensive validation" exactly. Use
it for scans an author must fix before shipping; never for a condition a
shipped program is expected to hit, and never where the code below it depends
on the throw having fired.

### Auditing for leaked resources (§83)

The §83 accounting is a set of process-wide counters, and the audit over them is
a function you call around a span you expect to balance — not a watcher, because
only you know which span was supposed to end where it began:

```ts
import { liveGeometryCount, geometryMemoryBytes } from "fourJS/geometry";
import {
  liveTextureCount,
  liveRenderTargetCount,
  textureMemoryBytes,
} from "fourJS/render";
import { auditResourceLeaks } from "fourJS/diagnostics";

const read = () => ({
  geometries: liveGeometryCount(),
  bufferBytes: geometryMemoryBytes(),
  textures: liveTextureCount(),
  renderTargets: liveRenderTargetCount(),
  textureBytes: textureMemoryBytes(),
});

const before = read();
level.dispose();
auditResourceLeaks(before, read(), { label: "level teardown" });
```

It warns once per label. A resource the collector reclaimed without a
`dispose()` call still counts as leaked — §83's contract is that lifetimes are
explicit, and a total that healed itself would hide the leak it exists to
reveal.

## The checklist

- **Track poses only for movers** (§43). Untracked static nodes draw from
  their live transform and cost nothing per step.
- **Let bodies sleep** (§32) unless the scene needs them responsive;
  `examples/mechanism` disables sleeping for five bodies and says why —
  don't copy that into a 500-body scene. (Honest gap: sleep _thresholds_
  have no Rapier binding yet; only `enabled` maps.)
- **Filter aggressively** (groups/masks, sensors) — contacts dominate the
  step; a pair that cannot collide costs nothing in the narrow phase.
- **Build pick candidate lists once** when the pickable set is static; the
  bounds vectors are live views onto the geometry.
- **Reuse geometries and materials**: GPU caches key on object identity +
  version, so two nodes sharing a `BufferGeometry` share buffers.
- **Idle scenes should idle** (§86): no unnecessary uploads or simulation.
  Untrack finished tweens (the `AnimationSystem` auto-untracks); don't
  repaint materials every frame when only edges change (see the limit-switch
  repaint in `examples/mechanism`).
- **Measure with the engine's numbers first** — `Emitter.particleCount`,
  `droppedCount`, `TimeState.droppedTime`, checksummed step times — before
  reaching for a profiler, and keep `benchmarks/` as the model for a fair
  headless measurement.
- **Ship a production build** (§85): `define: { __FOUR_DEV__: "false" }`, which
  is what the examples do and what `bun run size` measures.

## Cross-references

- §86 (targets), §87 (spatial indexing — honest state: staged; steering uses
  brute-force neighbours today), §65 (batching), §32 (sleeping), §85
  (development vs. production builds), §83 (resource lifetimes), §84
  (statistics).
- `benchmarks/` (committed records), `examples/particles-demo` (batching made
  visible, with its own honest scale note).
