/**
 * fourJS — the §36 particle demonstration (Phase 9, §112; plan §6h, WP-9.4).
 *
 * The smallest program that shows a particle system doing all four things §36
 * asks of the MVP tier, and shows them *in a browser*, on a real WebGL 2
 * surface:
 *
 * - **Simulated on the CPU, per fixed step.** A `ParticleSystem` is registered
 *   on the application's §39 registry at priority 500 and steps the emitters
 *   with the injected `fixedDeltaTime`. Nothing here reads a clock into the
 *   simulation (§33). The rAF timestamp handed to `app.step` is presentation-
 *   side by construction (§10). Two more `performance.now()` reads wrap the
 *   particle step and `renderer.render` so `#status` can publish **simulate**
 *   and **present** as separate seconds (R-33's measurement split). Those
 *   readings never enter `fixedDeltaTime` or an emitter. The split has landed;
 *   §112's exit still needs a run on **non-SwiftShader** hardware — this page
 *   does not claim that exit.
 * - **Driven by §27 force fields.** The fountain runs under uniform gravity, a
 *   linear drag and a vortex about +Z, evaluated in that order (the order is
 *   part of the contract — floating-point addition is not associative).
 * - **Collided, at §36's MVP tier.** The fountain has a `collisionPlaneY` with
 *   restitution, so its particles bounce off a floor rather than falling out of
 *   the world.
 * - **Drawn batched.** Each `ParticleRenderable` becomes exactly **one**
 *   `RenderItem`, and `@fourjs/render-webgl` turns that into exactly one
 *   `drawArraysInstanced` — the property §112's 100 000-particle target rests
 *   on. This page is deliberately ~2 000 particles, not 100 000: the browser
 *   gate runs under SwiftShader (software GL) with no GPU, and plan §6h asks for
 *   *a size SwiftShader can sustain* here, with the 100 000 number measured
 *   headlessly in `benchmarks/particles-100k.mjs` instead.
 *
 * ## Non-wasm, on purpose
 *
 * There is no physics package on this page and therefore no WebAssembly image:
 * plan §6h notes that a fifth Playwright web server is only cheap if the site it
 * serves is cheap, and this one is the `first-2d-scene` tier (a few tens of kB
 * gzip) rather than the `physics-playground` tier (~670 kB, two Rapier images).
 * §36 particles need `scene`, `math`, `particles` and a renderer, and nothing
 * else.
 *
 * ## The two systems, and why the second one exists
 *
 * | node       | emitter                                         | what it demonstrates                        |
 * | ---------- | ----------------------------------------------- | ------------------------------------------- |
 * | `fountain` | continuous rate, warm ramp, 3 fields, plane      | steady-state simulation and §27 fields      |
 * | `burst`    | rate 0, cool ramp, gravity only, fired on click | §36 bursts, and a second batched draw call  |
 *
 * They are two nodes rather than one because that is what makes "one draw call
 * *per system*" visible: the render list carries exactly two particle items, and
 * the backend issues exactly two instanced draws, whatever the particle counts
 * are.
 *
 * ## R-33 — simulate vs present, published separately
 *
 * §112's exit is *"100k simple particles simulated **and** rendered at
 * interactive rates on suitable hardware"*. This Cloud / CI host is SwiftShader
 * and is **not** that hardware, so the page never folds the two halves into one
 * number and never claims a 16.6 ms budget. After each host frame `#status`
 * carries:
 *
 * | attribute        | unit     | what it is                                              |
 * | ---------------- | -------- | ------------------------------------------------------- |
 * | `data-simulate`  | seconds  | wall-clock cost of `ParticleSystem.fixedUpdate` for the frame's fixed-step burst |
 * | `data-present`   | seconds  | wall-clock cost of `renderer.render` (list + upload + draw) |
 *
 * Seconds, not milliseconds: every engine time is seconds (§7a). The visible
 * sentence shows milliseconds so a human can read it; the attributes stay in
 * seconds, the way `examples/first-2d-scene` publishes `data-alpha` /
 * `data-dropped` / `data-substeps`. A later hardware run fills the numbers;
 * this file only lands the split.
 *
 * ## Colour discipline
 *
 * The browser gate (`tests/browser/particles.spec.ts`) has to attribute a pixel
 * to one system or the other from the outside, and §66 gives this tier no
 * material state to label them with. So hue is the channel:
 *
 * - the **fountain** is warm — red leads blue by a wide margin at every point of
 *   its ramp;
 * - the **burst** is cool — blue leads red by a wide margin at every point of
 *   its ramp;
 * - the **background** (`#0d0f14`, bytes `13, 15, 23`) is dark and nearly
 *   neutral, so neither classifier can fire on it however a particle's alpha
 *   fades into it.
 *
 * Both ramps end at alpha 0, so a particle fades out rather than popping; a
 * half-faded particle blends toward the background, which moves it *away* from
 * both classifiers rather than across them.
 *
 * ## The click, and what it deliberately does not do
 *
 * A click fires a burst from a **fixed** world position, not from the pointer.
 * That is a limitation of the MVP tier stated rather than worked around:
 * `ParticleEmitterOptions.position` is read once, in the constructor (WP-9.1
 * stages runtime re-authoring, because §36 gives no invalidation rules for the
 * derived cone basis and the burst schedule). The alternative — moving the
 * *node* to the pointer — would work, and would also drag every still-live
 * burst particle with it, because particles simulate in the node's local space
 * (that is the documented semantics, and it is what makes a moving emitter carry
 * its particles). A rapid second click would then teleport the first burst. A
 * fixed origin has no such artefact, and the interaction being demonstrated is
 * §36's burst, not pointer picking — §71/§72 picking already has its own
 * demonstration in `examples/first-2d-scene`.
 *
 * ## Layout, in world units
 *
 * One orthographic camera shows 8 × 6 world units over an 800 × 600 canvas:
 * **100 CSS pixels per world unit**, `px = (x + 4) × 100` and
 * `py = (3 − y) × 100`. +Y is up, angles are radians, times are seconds (§7a).
 * The README tabulates every landmark in both spaces.
 */

import { Application } from "fourJS/application";
import { Vector3 } from "fourJS/math";
import {
  ParticleEmitter,
  ParticleRenderable,
  ParticleSystem,
  dragField,
  uniformGravityField,
  vortexField,
  type ParticleFixedUpdateContext,
} from "fourJS/particles";
import { WebglRenderer, registerParticlePipeline } from "fourJS/render-webgl";
import { OrthographicCamera, createFullscreenViewport } from "fourJS/scene";

// --- surface ---------------------------------------------------------------

/**
 * The one element matching `selector`, or a thrown error naming it.
 *
 * A helper rather than two inline null checks because both handles are read
 * from inside callbacks, and TypeScript does not carry a narrowing from a
 * module-level `if` into a closure — returning a non-nullable type is the
 * honest way to say "the page guarantees this", instead of a `!` per use.
 */
function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`fourJS example: no ${selector} in the document.`);
  }
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#scene");
const status = requireElement<HTMLParagraphElement>("#status");

/**
 * Presentation-side clock in **seconds** (§7a). `performance.now()` is
 * milliseconds; divide here so every stored duration matches engine time.
 * Never handed to `app.step` or an emitter.
 */
function nowSeconds(): number {
  return performance.now() / 1000;
}

/**
 * Wall-clock seconds spent inside `ParticleSystem.fixedUpdate` for the host
 * frame that just finished — every fixed step of that frame, summed.
 *
 * Reset to `0` at the top of each `app.step` so a frame that ran no fixed
 * step publishes `0` rather than last frame's number. A later hardware run
 * reads this; SwiftShader numbers are not an §112 claim.
 */
let lastSimulateSeconds = 0;

/**
 * Wall-clock seconds spent inside `renderer.render` for the host frame that
 * just finished — list build (including `updateParticleInstances`), instance
 * upload, and the two instanced draws. Separate from {@link lastSimulateSeconds}
 * on purpose: folding them would hide which half is the cost.
 */
let lastPresentSeconds = 0;

/**
 * `ParticleSystem` that accumulates the last frame's integration cost.
 *
 * A subclass rather than assigning over `fixedUpdate`: class methods are not
 * writable under `tsc`, and a listener on `fixedUpdate` would fire *after*
 * the systems (§45), missing the integration it claimed to time.
 */
class TimedParticleSystem extends ParticleSystem {
  override fixedUpdate(context: ParticleFixedUpdateContext): void {
    const started = nowSeconds();
    super.fixedUpdate(context);
    lastSimulateSeconds += nowSeconds() - started;
  }
}

/**
 * `WebglRenderer` that records list + upload + draw as `lastPresentSeconds`.
 *
 * `#draw` is the last thing in `Application.step`, after the `render`
 * listeners, so a listener cannot see that cost. Overriding `render` is the
 * seam that can.
 */
class TimedWebglRenderer extends WebglRenderer {
  override render(
    ...args: Parameters<WebglRenderer["render"]>
  ): ReturnType<WebglRenderer["render"]> {
    const started = nowSeconds();
    const result = super.render(...args);
    lastPresentSeconds = nowSeconds() - started;
    return result;
  }
}

/** Layout size in CSS pixels; the drawing buffer is this times the DPR. */
const WIDTH = 800;
const HEIGHT = 600;

/** Half-extents of the orthographic view, in world units (8 × 6 units shown). */
const VIEW_HALF_WIDTH = 4;
const VIEW_HALF_HEIGHT = 3;

// --- camera and view (§47, §48) --------------------------------------------

// The camera sits far enough back, with a deep enough frustum, that the whole
// spherical burst stays inside it: a particle can travel a few units along ±Z,
// and an orthographic depth range costs nothing to widen.
const camera = new OrthographicCamera({
  left: -VIEW_HALF_WIDTH,
  right: VIEW_HALF_WIDTH,
  bottom: -VIEW_HALF_HEIGHT,
  top: VIEW_HALF_HEIGHT,
  near: 0.1,
  far: 20,
});
camera.transform.position.set(0, 0, 10);
camera.updateProjectionMatrix();

const view = createFullscreenViewport(camera);
view.clearColor = [0.051, 0.059, 0.078, 1];

// --- application (§45) ------------------------------------------------------

// §36's instanced particle pipeline is a registration seam on WebGL 2
// (2026-09-11): an explicit call, never an import side effect, links the
// billboard program and its batch caches into this bundle — without it every
// `ParticleRenderable` is skipped with one development warning.
registerParticlePipeline();

const renderer = new TimedWebglRenderer();
const app = new Application({ renderer, canvas, views: [view] });

renderer.resize(WIDTH, HEIGHT, window.devicePixelRatio);
app.scene.add(camera);

// --- the fountain (§36, §27) ------------------------------------------------

/** World `y` of the floor the fountain bounces off (§36 collision, MVP tier). */
const FLOOR_Y = -2.4;

/** Seeds are constants, never entropy — §33 forbids an unseeded default. */
const FOUNTAIN_SEED = 90_401;
const BURST_SEED = 90_402;

/**
 * Fountain capacity. Steady state is `emissionRate × mean lifetime` ≈
 * `900 × 2 = 1800`, so 2 600 leaves room for the peak of the spread without the
 * emitter ever dropping a spawn — a dropped spawn is counted, not silent, and
 * `#status` publishes the count so the page can be checked rather than trusted.
 */
const FOUNTAIN_CAPACITY = 2600;

const fountainEmitter = new ParticleEmitter({
  maxParticles: FOUNTAIN_CAPACITY,
  seed: FOUNTAIN_SEED,
  // Just above the floor, so the first bounce is a bounce and not a spawn
  // already below the plane.
  position: new Vector3(0, FLOOR_Y + 0.05, 0),
  emissionRate: 900,
  lifetime: { min: 1.6, max: 2.4 },
  initialSpeed: { min: 5.4, max: 7 },
  direction: new Vector3(0, 1, 0),
  // A narrow cone: wide enough to read as a fountain, narrow enough that the
  // spray stays inside the 8 × 6 view.
  spreadAngle: 0.3,
  size: { start: 0.075, end: 0.02 },
  color: {
    start: { r: 1, g: 0.74, b: 0.28, a: 1 },
    end: { r: 0.95, g: 0.22, b: 0.08, a: 0 },
  },
  // §27 fields, sampled and summed in exactly this order.
  fields: [
    uniformGravityField(new Vector3(0, -9.81, 0)),
    // Air resistance: 1/0.35 s ≈ 2.9 s e-folding time, so the spray is shaped
    // rather than damped away. `c · dt = 0.0058` at 60 Hz, far inside the
    // stability bound `c · dt < 1`.
    dragField(0.35),
    // A swirl about +Z — the axis pointing at the viewer, so the vortex is
    // visible in a 2D view instead of turning the spray edge-on. `minDistance`
    // is raised to 0.6 so the core (where the acceleration goes as 1/d) does not
    // fling the particles that spawn nearest the axis.
    vortexField(new Vector3(0, -0.4, 0), new Vector3(0, 0, 1), 2.2, {
      minDistance: 0.6,
    }),
  ],
  collisionPlaneY: FLOOR_Y,
  // A soft floor: the spray piles and slides rather than rebounding to height.
  restitution: 0.35,
});

const fountain = new ParticleRenderable(fountainEmitter);
fountain.name = "fountain";
app.scene.add(fountain);

// --- the click burst (§36) --------------------------------------------------

/** Particles per click. Comfortably inside the burst pool's capacity. */
const BURST_COUNT = 900;

/** Burst capacity: two overlapping bursts fit without a single dropped spawn. */
const BURST_CAPACITY = 1900;

/** Where a burst originates, in world units (see the README's layout table). */
const BURST_ORIGIN = new Vector3(0, 0.8, 0);

const burstEmitter = new ParticleEmitter({
  maxParticles: BURST_CAPACITY,
  seed: BURST_SEED,
  position: BURST_ORIGIN,
  // Nothing continuous: this emitter is silent until `emit` is called.
  emissionRate: 0,
  // Long enough that the burst is on screen for well over a second. A browser
  // gate can only sample the framebuffer as fast as SwiftShader can encode a
  // screenshot (~200 ms measured), so a half-second burst would be a race
  // between the effect and the instrument rather than a test of the effect.
  lifetime: { min: 1.6, max: 2.4 },
  initialSpeed: { min: 1.6, max: 3.2 },
  direction: new Vector3(0, 1, 0),
  // A full sphere — `spreadAngle` is the cone *half*-angle, so π is everything.
  spreadAngle: Math.PI,
  size: { start: 0.09, end: 0.025 },
  color: {
    start: { r: 0.4, g: 0.86, b: 1, a: 1 },
    end: { r: 0.16, g: 0.36, b: 1, a: 0 },
  },
  // Gravity through the emitter's own option rather than a field: there is
  // exactly one constant acceleration here, and the option costs no virtual
  // call per particle (the benchmark measures that difference — it is ~5 ms per
  // field per 100 000 particles). Weaker than the fountain's on purpose: at
  // −9.81 a two-second burst would fall 20 world units, i.e. out of a 6-unit
  // view within half a second, and a burst that leaves before it can be
  // photographed demonstrates nothing.
  gravity: new Vector3(0, -3, 0),
});

const burst = new ParticleRenderable(burstEmitter);
burst.name = "burst";
// Draw the burst after the fountain within the same layer (§66 sort key 5).
// Both are blended and this tier has no transparency sort, so `renderOrder` and
// sibling order are the whole of the control an author has.
burst.renderOrder = 1;
app.scene.add(burst);

// --- systems (§39) ----------------------------------------------------------

// One system steps both emitters, at §39 step 5 (force generation, priority
// 500). It tracks *emitters*, not renderables: the renderable's own per-frame
// job — repacking the instance array — is done by `buildRenderList`, on the
// render clock, not on the fixed-step clock.
const particles = new TimedParticleSystem();
app.systems.register(particles);
particles.track(fountainEmitter);
particles.track(burstEmitter);

// --- interaction ------------------------------------------------------------

/** Bursts fired since the page loaded; mirrored onto `#status`. */
let burstCount = 0;

canvas.addEventListener("pointerdown", () => {
  burstEmitter.emit(BURST_COUNT);
  burstCount += 1;
});

// --- what the page publishes ------------------------------------------------

/** Frames rendered since the loop started; mirrored onto `#status`. */
let frameCount = 0;

/**
 * Mirrors the live simulation onto `#status`, so a browser gate can read the
 * engine's own numbers instead of inferring everything from pixels.
 *
 * Called after `app.step` returns — once per host frame, after every fixed
 * step *and* the draw of that frame have run — because `data-simulate` /
 * `data-present` are costs a *frame* observes, not quantities a fixed step
 * produces. Counts (`data-fountain`, …) move here with them so one write
 * owns the element, the way `examples/first-2d-scene` publishes `data-alpha`
 * / `data-dropped` / `data-substeps` after `step`.
 *
 * `data-simulate` and `data-present` are **seconds** (§7a). The visible
 * sentence shows milliseconds. R-33's split has landed; §112's exit still
 * needs non-SwiftShader hardware.
 */
function publish(): void {
  status.dataset["state"] = "running";
  status.dataset["fountain"] = String(fountainEmitter.particleCount);
  status.dataset["burst"] = String(burstEmitter.particleCount);
  status.dataset["bursts"] = String(burstCount);
  status.dataset["frames"] = String(frameCount);
  status.dataset["dropped"] = String(
    fountainEmitter.droppedCount + burstEmitter.droppedCount,
  );
  // Seconds, six digits — same precision `first-2d-scene` uses for
  // `data-dropped` (a duration). Two attributes, never one folded number.
  status.dataset["simulate"] = lastSimulateSeconds.toFixed(6);
  status.dataset["present"] = lastPresentSeconds.toFixed(6);
  const simulateMs = lastSimulateSeconds * 1000;
  const presentMs = lastPresentSeconds * 1000;
  status.textContent =
    `${String(fountainEmitter.particleCount)} fountain + ` +
    `${String(burstEmitter.particleCount)} burst particles — ` +
    `2 draw calls — simulate ${simulateMs.toFixed(2)} ms / ` +
    `present ${presentMs.toFixed(2)} ms — click for a burst`;
}

// --- the frame loop ---------------------------------------------------------

/**
 * Drives the application from `requestAnimationFrame`.
 *
 * The rAF timestamp is a *presentation-side* clock, which is the one place a
 * wall clock is allowed: it measures how long the display took, and is converted
 * to seconds before it crosses into the engine (§7a). Simulation never sees it —
 * inside `app.step` the fixed-step accumulator hands every system the same
 * injected `fixedDeltaTime` (§10, §33).
 *
 * Seeded from the FIRST rAF timestamp rather than a `now()` taken earlier: rAF
 * hands the frame-*start* time, and a negative first delta would make
 * `app.step` throw and kill the loop (the bug WP-3.7-fix1 fixed).
 */
let last: number | null = null;

function frame(now: number): void {
  if (last !== null) {
    // A new host frame: drop last burst's costs so a 0-substep or skipped-draw
    // frame publishes `0` rather than a stale number. TimedParticleSystem
    // adds simulate per fixed step; TimedWebglRenderer overwrites present
    // when `#draw` runs.
    lastSimulateSeconds = 0;
    lastPresentSeconds = 0;
    app.step((now - last) / 1000);
    frameCount += 1;
    publish();
  }
  last = now;
  requestAnimationFrame(frame);
}

async function main(): Promise<void> {
  await app.initialize();
  app.start();
  requestAnimationFrame(frame);
}

main().catch((error: unknown) => {
  status.dataset["state"] = "error";
  status.textContent = "failed to start — see the console";
  console.error("fourJS example: failed to start.", error);
});
