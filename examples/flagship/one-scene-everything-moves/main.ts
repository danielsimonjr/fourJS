/**
 * fourJS — **"One Scene, Everything Moves"**, the §118 flagship demonstration.
 *
 * §118 is not a feature list, it is a claim: that fourJS is *one
 * motion-capable engine, not a graphics library with physics bolted on
 * afterward*. The way to prove that claim is to put everything the engine
 * pretends to be into **one scene graph, one fixed-step loop, and one frame** —
 * so this page has exactly one `Application`, one `Scene`, one camera, one
 * `PhysicsWorld`, and one `requestAnimationFrame` loop, and everything below
 * lives inside them.
 *
 * ## §118's list, and where each item is
 *
 * | §118 asks for              | where it is here                                                                                                   |
 * | -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
 * | a rotating 3D cube         | {@link CUBE_POSITION}: a `boxGeometry` under a **textured** `LitMaterial`, spun by a §38 `MotionComponent`            |
 * | a 2D vector orbit          | {@link ORBIT_POSITION}: flat `circleGeometry2D`/`planeGeometry` art — a dotted path, a radius **vector**, an orbiter — carried round by a second `MotionComponent` |
 * | a spring-connected pendulum| {@link PENDULUM_ANCHOR}: a §28 `SpringJoint` from a static anchor to a dynamic bob, swinging *and* bouncing on its spring |
 * | a bouncing rigid body      | {@link BALL_START}: a restitution-0.92 sphere the solver drops onto the slab, re-launched by an impulse on each landing |
 * | a world-space label        | two: the scene title above the horizon, and a live `bounces: N` readout that **rides the bouncing body**              |
 * | a screen-space control panel| a `@fourjs/ui` panel parented to the **camera**, so it is fixed in the viewport: three `Button`s and a `Slider`         |
 * | a timeline                 | a §16 `Timeline` sequencing two tweens on different nodes plus a lap marker, looping forever                          |
 * | a motorized hinge          | {@link ROTOR_POSITION}: a `HingeJoint` with an enabled §28 motor turning a rotor bar against gravity                  |
 * | collision events           | the ball's `collisionstart` (§29) drives the bounce counter, the label, a particle burst, and the impulse that keeps it alive |
 * | pause, slow motion, single-step | the three buttons and the slider: `app.pause()`, `scheduler.timeScale`, and one exact fixed step while paused    |
 *
 * Two things §118 does not ask for are here because they are what the scene is
 * *made of*: §36 **particles** (embers at the impact point and a burst per
 * collision) and §84/§113's **debug overlay** (velocity vectors and contact
 * points), which the third button switches on.
 *
 * ## What "one scene" means mechanically
 *
 * Every node below lives in the one scene graph — the control panel included,
 * since it hangs off the camera, which is itself a node in that graph — and
 * each is moved by a *different* system on the same clock. The §39 registry
 * runs them by priority, whatever order they were registered in:
 *
 * ```text
 *   app.step(elapsed)                                   §10 fixed-step accumulator
 *     ├─ fixedUpdate ×N   AnimationSystem  (300)        the timeline and its tweens
 *     │                   MotionSystem     (400)        cube spin, orbit spin
 *     │                   ParticleSystem   (500)        embers + sparks
 *     │                   PhysicsSystem    (600)        Rapier 3D: ball, bob, rotor
 *     │                   pose capture    (1000)        §43's previous/current states
 *     ├─ update           this file: spring visual, labels, overlay, #status
 *     └─ render           renderer.render(scene, views, interpolationAlpha)
 * ```
 *
 * No system knows about any other; the scene graph is the only thing they
 * share. That is the §118 claim in one paragraph, and the browser gate
 * (`tests/browser/one-scene-everything-moves.spec.ts`) measures it from the
 * outside — every object in its own hue, the motion in changed pixels, the
 * controls in what they change.
 *
 * ## Backends are *selected*, not constructed (§62, §37)
 *
 * This is the first shipped example to use the auto-selection registries
 * (2026-08-07, A-8/R-2/PH-19):
 *
 * ```ts
 * registerWebglRenderer();                       // the application names its backends
 * registerRapierSolver();
 * new Application({ renderer: "auto", … });      // §62 order: WebGPU, WebGL 2, 2D
 * new PhysicsWorld({ dimension: "3d", solver: "auto", … });
 * ```
 *
 * Registration is an explicit **call** and never an import side effect: all 24
 * packages declare `"sideEffects": false`, so a bundler is entitled to delete an
 * import whose bindings are unused, and a side-effect registration module would
 * vanish on the bundler's schedule. What the page actually got is published as
 * `data-backend` / `data-solver`, and any backend `"auto"` passed over is
 * reported through the two fallback callbacks rather than swallowed (§62's
 * diagnostics event, delivered as a callback because §3.1 gives `render` and
 * `physics` no diagnostics edge).
 *
 * **What the solver registry costs, measured.** `registerRapierSolver()` is
 * **one name** (`"rapier"`) for both §21 dimensions: `create` reads
 * `options.dimension` and builds the 2d or 3d adapter. A second call is
 * idempotent (same `isSupported` / `create`). The dimension is only known
 * when a world asks, so this bundle carries **both** wasm images even though
 * only the 3D one is ever decoded: 4.20 MB raw / 1.54 MB gzip, against
 * `examples/mechanism`'s 1.85 MB / 0.69 MB for a single `new Rapier2dAdapter()`.
 * Constructing `new Rapier3dAdapter()` here would roughly halve the download;
 * exercising the registry is the point of this page, so the cost is recorded
 * rather than avoided. Splitting into `"rapier-2d"` / `"rapier-3d"` is the
 * rejected alternative — §37 selects a solver, not a wasm image.
 *
 * ## Screen space, the standard way (§46, §47, §48)
 *
 * §118 wants a *screen-space* control panel, and this page draws one the way the
 * engine now says to (R-37/R-38, adopted here 2026-08-21):
 *
 * ```text
 * defineLayer("ui")                       — §46: a name, one bit
 * uiCamera = new ScreenCamera(…)          — §47: the projection is the pixel rect
 * views = [world view, ui view]           — §48: two full-surface viewports
 * view.layerMask / uiView.layerMask       — §48: each pass draws its own layer
 * ```
 *
 * so the panel is laid out in **pixels**, drawn exactly where its layout says,
 * and picked through the camera it is drawn with. One scene, one frame, two
 * passes over one render list — the arrangement
 * `tests/integration/screen-camera.test.ts` proves end to end.
 *
 * Until 2026-08-21 the panel was instead a *child of the `PerspectiveCamera`
 * node*, floating on a plane 2.2 world units in front of it, because §48's
 * `layerMask` and §46's layer registry did not exist and a second view would
 * have drawn the whole scene twice. That workaround was honest and it was
 * approximate: every layout number was a fraction of a world unit that a comment
 * had to translate into "≈ 329 CSS pixels", and finding a button on screen took
 * a perspective divide. Both are gone.
 *
 * ## The palette is an instrument
 *
 * §66 gives this tier no material state a screenshot can read back, so the
 * browser gate attributes every pixel to an object **by hue**, the discipline
 * `examples/particles-demo` established and `examples/first-3d-scene` extended
 * to lit surfaces. Every colour below states the bytes it produces at full
 * illumination, and adjacent classifiers are kept far apart on purpose:
 *
 * | object            | fully lit bytes | the classifier that owns it        |
 * | ----------------- | --------------- | ---------------------------------- |
 * | cube (both checker cells) | `(255, 149, 43)` / `(149, 57, 18)` | warm: `r ≥ 140`, `r − g ≥ 55`, `r − b ≥ 70` |
 * | bouncing ball     | `(149, 128, 255)` | violet: `b ≥ 110`, `b − r ≥ 40`, `b − g ≥ 40` |
 * | pendulum bob + spring | `(71, 220, 113)` | green: `g ≥ 120`, `g − r ≥ 55`, `g − b ≥ 45` |
 * | rotor bar         | `(65, 205, 241)` | cyan: `g ≥ 120`, `b ≥ 120`, `g − r ≥ 50`, `b − r ≥ 50` |
 * | 2D orbit art (unlit) | `(242, 64, 184)` / `(173, 41, 128)` | magenta: `r ≥ 140`, `b ≥ 120`, `g ≤ r − 70` |
 * | particles         | `(255, 235, 115)` | yellow: `r ≥ 150`, `g ≥ 120`, `b ≤ 120`, `r − g ≤ 70` |
 * | glyphs            | `(240, 240, 240)` | neutral: `min ≥ 170`, `max − min ≤ 24` |
 * | debug overlay     | `(255, 255, 0)`, `(255, 128, 0)`, `(0, 255, 0)`, `(255, 0, 0)` | saturated with **no blue**: `b ≤ 12` and `max(r, g) ≥ 200` |
 * | ground slab       | `(45, 46, 54)`  | none — it is the floor, and must trip nothing |
 * | background        | `(10, 11, 17)`  | none                                  |
 *
 * The UI panel's own surfaces are deliberately warm-grey and near-neutral so
 * that no widget can be mistaken for a scene object; the one exception — the
 * near-white focus ring and slider handle — is confined to the lower-right
 * quarter where the panel sits, which is why the gate counts *world* glyphs in
 * the upper 40 % of the frame and the panel's own text below it. The measured
 * separation the horizon test rests on: ground luminance 46.4, sky 11.2.
 *
 * ## Determinism (§33)
 *
 * Every seed is a constant, nothing reads `Math.random`, and the only clock
 * this file touches is the rAF timestamp handed to `app.step` — a
 * presentation-side measurement converted to seconds before it crosses into the
 * engine (§7a). Inside `step`, every system sees the same injected
 * `fixedDeltaTime`, so two runs reaching the same simulation step hold the same
 * state.
 */

import { AnimationSystem, Timeline, animate } from "fourJS/animation";
import { Application } from "fourJS/application";
import {
  DebugDrawBuffer,
  applyDebugDrawStreams,
  collectBodyOrigins,
  collectBodyVelocities,
  collectContactPoints,
  debugDrawStreams,
  type DebugDrawStreams,
  type DebugPhysicsEventLike,
} from "fourJS/diagnostics";
import {
  BufferGeometry,
  boxGeometry,
  circleGeometry2D,
  planeGeometry,
  sphereGeometry,
} from "fourJS/geometry";
import { KeyboardInput, PointerInput, type Pickable } from "fourJS/input";
import { LitMaterial, UnlitMaterial } from "fourJS/materials";
import { Quaternion, Vector3 } from "fourJS/math";
import { MotionComponent, MotionSystem } from "fourJS/motion";
import {
  ParticleEmitter,
  ParticleRenderable,
  ParticleSystem,
  dragField,
  uniformGravityField,
} from "fourJS/particles";
import {
  Collider,
  HingeJoint,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
  SpringJoint,
} from "fourJS/physics";
import { registerRapierSolver } from "fourJS/physics-rapier";
import { Renderable, Texture } from "fourJS/render";
import {
  registerParticlePipeline,
  registerWebglRenderer,
} from "fourJS/render-webgl";
import {
  DEFAULT_LAYER_MASK,
  DirectionalLight,
  Group,
  PerspectiveCamera,
  ScreenCamera,
  createFullscreenViewport,
  applyLayers,
  defineLayer,
  layerMask,
  resolveWorldTransform,
} from "fourJS/scene";
import { buildGlyphAtlas } from "fourJS/text";
import {
  Button,
  Label,
  Panel,
  Slider,
  collectPickables,
  focusedWidget,
  installKeyboardTraversal,
  keyboardFocusTarget,
  type UIWidget,
  type WidgetActivationSource,
  type WidgetSkin,
} from "fourJS/ui";
import { Text } from "fourJS";

// --- surface -----------------------------------------------------------------

/**
 * The one element matching `selector`, or a thrown error naming it.
 *
 * A helper rather than an inline null check because the handles are read from
 * inside callbacks, and TypeScript does not carry a module-level narrowing into
 * a closure (the reason every other example in this repository gives).
 */
function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`fourJS flagship: no ${selector} in the document.`);
  }
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#scene");
const status = requireElement<HTMLParagraphElement>("#status");

/** Layout size in CSS pixels; the drawing buffer is this times the DPR. */
const WIDTH = 960;
const HEIGHT = 600;

/** Straight (non-premultiplied) RGBA in 0…1 (§60a, §66). */
type Rgba = readonly [number, number, number, number];

// --- camera and view (§47, §48) ----------------------------------------------

/** Full **vertical** field of view in radians (§7a) — 45°. */
const FIELD_OF_VIEW = Math.PI / 4;

/** Where the camera stands, in world units (metres, §40). */
const CAMERA_POSITION = new Vector3(0, 3.1, 12.4);

/**
 * Downward pitch in radians: a negative rotation about +X tips the camera's −Z
 * look axis toward −Y (§7a). Small — the horizon then falls just below the
 * middle of the frame, which is what puts the ground under the physics and the
 * world-space title against the cleared background.
 */
const CAMERA_PITCH = -0.1;

const camera = new PerspectiveCamera({
  fieldOfView: FIELD_OF_VIEW,
  aspect: WIDTH / HEIGHT,
  near: 0.1,
  far: 120,
});
camera.name = "camera";
camera.transform.position.copy(CAMERA_POSITION);
camera.transform.rotation.setFromAxisAngle(new Vector3(1, 0, 0), CAMERA_PITCH);
camera.updateProjectionMatrix();

/**
 * §46's two layers, and the masks that separate the world pass from the
 * screen-space pass (R-38's masking half, R-37's camera half).
 *
 * The world keeps the **default** layer rather than being moved onto a named
 * one: a layer is identity, and nothing about a cube or a rigid body is
 * "world-ish" except that it is not UI. So exactly one thing is declared here —
 * what the UI *is* — and the world view simply excludes it by asking for
 * {@link DEFAULT_LAYER_MASK}. The alternative (`defineLayer("world")` and a mask
 * on every renderable in the file) would have to be maintained by every future
 * packet that adds a mesh, and the first one that forgot would lose its mesh
 * from both views.
 */
defineLayer("ui");
const UI_LAYER = layerMask("ui");

const view = createFullscreenViewport(camera, "world");
/** Near-black, and far from every classifier in the browser gate. */
view.clearColor = [0.04, 0.045, 0.065, 1];
// Everything that is not on the "ui" layer — see {@link UI_LAYER}.
view.layerMask = DEFAULT_LAYER_MASK;

/**
 * §47's screen camera: the projection **is** the surface's pixel rectangle, so
 * a widget's world position is its position on the canvas and the panel below
 * is laid out in pixels.
 *
 * `origin: "bottom-left"` rather than §7a's default `"top-left"`, and the reason
 * is §74: a `@fourjs/ui` layout writes its children at `(left, −top)` — a Y-**up**
 * frame with downward offsets expressed as negative numbers. Under a top-left
 * origin the projection flips Y, and every one of those offsets would climb the
 * screen instead of descending it. `"bottom-left"` is the origin a widget tree
 * is already authored for; `"top-left"` is right for content authored the way
 * CSS is.
 *
 * The size is handed over once here and maintained by `Application.resize`
 * afterwards, which feeds any camera in its views that declares
 * `setSurfaceSize` (§45's structural `SurfaceSizedCamera` opt-in) — so this page
 * never touches the projection again.
 */
const uiCamera = new ScreenCamera({
  origin: "bottom-left",
  width: WIDTH,
  height: HEIGHT,
  resolution: window.devicePixelRatio,
});
uiCamera.name = "ui-camera";
uiCamera.updateProjectionMatrix();

/**
 * The second full-surface viewport: same canvas, same frame, the "ui" layer
 * only, and **no `clearColor`** — a view that cleared would erase the world pass
 * that drew before it (§48).
 */
const uiView = createFullscreenViewport(uiCamera, "ui");
uiView.layerMask = UI_LAYER;

// --- backends, selected rather than constructed (§62, §37) -------------------

// Explicit calls, never side-effect imports — see the module header.
registerWebglRenderer();
registerRapierSolver();
// §36's instanced particle pipeline is a registration seam on WebGL 2
// (2026-09-11), the skinning/picking shape: the embers and sparks below are
// skipped with one warning unless the application links it here.
registerParticlePipeline();

/** Backends `"auto"` passed over, as `"<backend>: <reason>"` (§62, §37). */
const fallbacks: string[] = [];

const app = new Application({
  // §45's string form. The umbrella package still imports no backend: the
  // registration above is what put WebGL 2 within reach of this string.
  renderer: "auto",
  canvas,
  views: [view, uiView],
  // The application owns the surface size (A-7): it forwards this to the
  // renderer it resolves and keeps the perspective camera's `aspect` in step,
  // so nothing here calls `renderer.resize`.
  width: WIDTH,
  height: HEIGHT,
  resolution: window.devicePixelRatio,
  onRendererFallback: (report) => {
    fallbacks.push(`${report.backend}: ${report.reason}`);
  },
});

app.scene.add(camera);
app.scene.add(uiCamera);

// --- light (§68) --------------------------------------------------------------

/** The scene-wide ambient term — what keeps an unlit face readable, not black. */
const AMBIENT_LIGHT: Rgba = [0.16, 0.17, 0.21, 1];

app.scene.ambientLight[0] = AMBIENT_LIGHT[0];
app.scene.ambientLight[1] = AMBIENT_LIGHT[1];
app.scene.ambientLight[2] = AMBIENT_LIGHT[2];

/**
 * The sun's aim, as the two rotations that produce it (§68: a directional light
 * shines along its node's −Z world axis, so it is aimed by rotating the node).
 * Composed yaw-after-pitch the light travels `(0.345, −0.751, −0.563)` — down,
 * to the right, and away from the viewer — the key-light placement that puts a
 * bright upper-left and a dim lower-right on every curved surface here.
 */
const SUN_PITCH = -0.85;
const SUN_YAW = -0.55;

const sun = new DirectionalLight({
  color: [1, 0.96, 0.9],
  intensity: 1.25,
});
sun.name = "sun";
sun.transform.rotation
  .setFromAxisAngle(new Vector3(0, 1, 0), SUN_YAW)
  .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), SUN_PITCH));
app.scene.add(sun);

// --- palette ------------------------------------------------------------------

/** The ground slab: near-neutral, and dark enough to trip no classifier. */
const GROUND_COLOR: Rgba = [0.16, 0.17, 0.2, 1];

/** Anything bolted to the world — the pendulum's anchor, the rotor's post. */
const STATIC_COLOR: Rgba = [0.13, 0.14, 0.18, 1];

/** The cube's checker cells: warm at both ends of the pattern. */
const CUBE_LIGHT_CELL: Rgba = [0.95, 0.42, 0.12, 1];
const CUBE_DARK_CELL: Rgba = [0.42, 0.16, 0.05, 1];

/** The bouncing body: violet, blue leading both other channels wherever it is lit. */
const BALL_COLOR: Rgba = [0.42, 0.36, 0.92, 1];

/** The pendulum bob, and the spring drawn between it and its anchor. */
const BOB_COLOR: Rgba = [0.2, 0.62, 0.32, 1];
const SPRING_COLOR: Rgba = [0.16, 0.5, 0.26, 1];

/** The motorised rotor: cyan — green and blue together, well clear of both. */
const ROTOR_COLOR: Rgba = [0.18, 0.58, 0.68, 1];

/** The 2D orbit: unlit magenta, bright for the moving parts, dim for the path. */
const ORBIT_VECTOR_COLOR: Rgba = [0.95, 0.25, 0.72, 1];
const ORBIT_PATH_COLOR: Rgba = [0.68, 0.16, 0.5, 1];

/** Glyph tint: deliberately neutral, so no hue classifier can claim text. */
const LABEL_TINT: Rgba = [0.94, 0.94, 0.94, 1];

// --- the physics world (§20, §21, §37) ---------------------------------------

const physics = new PhysicsSystem();
app.systems.register(physics);

/** Solvers `"auto"` passed over, as `"<solver>: <reason>"` (§37). */
const solverRejections: string[] = [];

/**
 * The one world: `"3d"`, resolved through the §37 registry, sharing the
 * application's §43 pose buffer so every dynamic body draws interpolated.
 *
 * §32 sleeping is **off**: the ball, the bob and the rotor are meant to keep
 * moving for as long as the page is open, and a body the solver had put to
 * sleep would make the demonstration look broken. Three dynamic bodies cost
 * nothing to keep awake.
 */
const world = physics.track(
  new PhysicsWorld({
    dimension: "3d",
    solver: "auto",
    poses: app.poses,
    sleeping: { enabled: false },
    onSolverReject: (report) => {
      solverRejections.push(`${report.name}: ${report.reason}`);
    },
  }),
);

// --- building blocks ----------------------------------------------------------

/**
 * A `width × height` RGBA8 checkerboard, as a renderer `Texture` (§77).
 *
 * Procedural rather than loaded: an example that fetched a PNG would be
 * demonstrating `@fourjs/assets`, and this one is demonstrating that a
 * `LitMaterial` samples a map with the geometry's uvs (§53, R-19) — the
 * cheapest way to make a rotating cube's rotation legible, since a flat-shaded
 * cube face and its neighbour differ only by their Lambert term.
 */
function checkerTexture(
  size: number,
  cells: number,
  a: Rgba,
  b: Rgba,
): Texture {
  const data = new Uint8Array(size * size * 4);
  const cell = size / cells;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const even = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      const color = even ? a : b;
      const at = (y * size + x) * 4;
      data[at] = Math.round(color[0] * 255);
      data[at + 1] = Math.round(color[1] * 255);
      data[at + 2] = Math.round(color[2] * 255);
      data[at + 3] = 255;
    }
  }
  return new Texture({ width: size, height: size, data });
}

// --- the ground (§23, §24) ----------------------------------------------------

/** Half-extents of the slab everything lands on; its top face is `y = 0`. */
const GROUND_HALF = new Vector3(20, 0.5, 20);

const ground = new Renderable(
  boxGeometry({
    width: GROUND_HALF.x * 2,
    height: GROUND_HALF.y * 2,
    depth: GROUND_HALF.z * 2,
  }),
  new LitMaterial({ color: GROUND_COLOR }),
);
ground.name = "ground";
ground.transform.position.set(0, -GROUND_HALF.y, 0);
ground.transformAuthority = "physics";
ground.addComponent(new RigidBody({ type: "static" }));
// The drawn box and the collider are built from **one** pair of numbers, which
// is the only way a floor and the floor the solver sees stay the same thing.
ground.addComponent(
  new Collider({
    shape: { type: "box", halfExtents: GROUND_HALF },
    friction: 0.9,
    restitution: 0.1,
  }),
);
app.scene.add(ground);

// --- §118: the rotating 3D cube (§38, §53, §57, R-19) ------------------------

/** Where the cube floats, in world units. */
const CUBE_POSITION = new Vector3(-1.9, 2.9, -0.6);

/** Edge length of the cube, in metres. */
const CUBE_SIZE = 1.35;

const cube = new Renderable(
  boxGeometry({ width: CUBE_SIZE, height: CUBE_SIZE, depth: CUBE_SIZE }),
  // White base colour, so what is seen is the texture times the lighting and
  // nothing else. 64 texels over 4 cells: big enough to read at this size,
  // small enough that the whole texture is 16 kB.
  new LitMaterial({
    color: [1, 1, 1, 1],
    map: checkerTexture(64, 4, CUBE_LIGHT_CELL, CUBE_DARK_CELL),
  }),
);
cube.name = "cube";
cube.transform.position.copy(CUBE_POSITION);
// §42: exactly one system may write a node's transform, and it must say so.
cube.transformAuthority = "kinematic";
cube.addComponent(
  new MotionComponent({ angularVelocity: new Vector3(0.45, 0.8, 0) }),
);
app.scene.add(cube);

// --- §118: the bouncing rigid body (§23, §25, §29) ---------------------------

/** Radius of the bouncing sphere, in metres. */
const BALL_RADIUS = 0.42;

/** Where it is released; it is re-launched to about this height on every landing. */
const BALL_START = new Vector3(-4.6, 4.6, 0.3);

/**
 * Rebound speed in m/s the application tops the ball up to on each landing.
 *
 * A restitution of 0.92 still loses 15 % of the energy per bounce, so a ball
 * left alone settles within a few seconds and the demonstration goes quiet. The
 * §29 `collisionstart` handler therefore applies the §26 impulse `m · Δv` that
 * restores this speed — momentum, not a teleport, and queued as a command the
 * world drains at the next fixed step (§26). `√(2 g h)` with `h ≈ 2.8 m`.
 */
const BALL_REBOUND_SPEED = 7.4;

const ball = new Renderable(
  sphereGeometry({
    radius: BALL_RADIUS,
    widthSegments: 40,
    heightSegments: 20,
  }),
  new LitMaterial({ color: BALL_COLOR }),
);
ball.name = "bouncing-ball";
ball.transform.position.copy(BALL_START);
ball.transformAuthority = "physics";
ball.addComponent(new RigidBody({ type: "dynamic" }));
ball.addComponent(
  new Collider({
    shape: { type: "sphere", radius: BALL_RADIUS },
    // A lively ball: most of the energy comes back, and the rest is the
    // impulse's job.
    restitution: 0.92,
    friction: 0.15,
  }),
);
app.scene.add(ball);

// --- §118: the spring-connected pendulum (§28) -------------------------------

/** Where the pendulum hangs from — a static body, so the spring has a fixed end. */
const PENDULUM_ANCHOR = new Vector3(0.9, 5.2, 0);

/** Where the bob starts: displaced sideways, which is how a pendulum is released. */
const BOB_START = new Vector3(2.1, 3.3, 0);

/** Radius of the bob, in metres. */
const BOB_RADIUS = 0.34;

/**
 * The §28 spring: rest length in metres, stiffness in N/m, damping in N·s/m.
 *
 * The numbers are chosen so that **both** motions are visible and neither is a
 * numerical accident. The bob's derived mass is ≈ 0.16 kg (density 1 × the
 * sphere's volume), so the spring's own period is `2π√(m/k)` ≈ 0.5 s — thirty
 * fixed steps, comfortably resolved — while the pendulum period `2π√(L/g)` is
 * ≈ 2.9 s. The spring therefore *bounces* about six times per swing, which is
 * what makes it read as a spring rather than as a rod. Damping is deliberately
 * tiny: it takes the numerical noise out without stopping the demonstration.
 */
const SPRING_REST_LENGTH = 2.1;
const SPRING_STIFFNESS = 26;
const SPRING_DAMPING = 0.12;

/** How wide the spring is drawn, in world units. */
const SPRING_WIDTH = 0.11;

const pendulumAnchor = new Renderable(
  boxGeometry({ width: 0.42, height: 0.28, depth: 0.42 }),
  new LitMaterial({ color: STATIC_COLOR }),
);
pendulumAnchor.name = "pendulum-anchor";
pendulumAnchor.transform.position.copy(PENDULUM_ANCHOR);
pendulumAnchor.transformAuthority = "physics";
// A static body with **no collider**: a joint's fixed side has to be a body,
// and nothing in this scene is meant to collide with the ceiling.
pendulumAnchor.addComponent(new RigidBody({ type: "static" }));
app.scene.add(pendulumAnchor);

const bob = new Renderable(
  sphereGeometry({ radius: BOB_RADIUS, widthSegments: 32, heightSegments: 16 }),
  new LitMaterial({ color: BOB_COLOR }),
);
bob.name = "pendulum-bob";
bob.transform.position.copy(BOB_START);
bob.transformAuthority = "physics";
bob.addComponent(new RigidBody({ type: "dynamic", linearDamping: 0.02 }));
bob.addComponent(
  new Collider({ shape: { type: "sphere", radius: BOB_RADIUS } }),
);
app.scene.add(bob);

/**
 * The drawn spring.
 *
 * A `SpringJoint` is a distance spring — it has no shape — so the bar between
 * the anchor and the bob is a *visual*, rebuilt every frame in
 * {@link updateSpringVisual} from the two positions and touching nothing the
 * solver reads. One unit tall so its Y scale **is** the spring's length.
 */
const springVisual = new Renderable(
  planeGeometry({ width: SPRING_WIDTH, height: 1 }),
  new UnlitMaterial({ color: SPRING_COLOR }),
);
springVisual.name = "spring";
app.scene.add(springVisual);

// --- §118: the motorized hinge (§28) -----------------------------------------

/** Where the rotor turns, in world units. */
const ROTOR_POSITION = new Vector3(5, 1.45, 0);

/** Half-extents of the rotor bar. */
const ROTOR_HALF = new Vector3(1.05, 0.09, 0.16);

/**
 * §28's `maxTorque`, which on Rapier 0.19.3 is the motor's **gain**, not a
 * ceiling: the bindings expose no force limit, so the adapter maps it to the
 * motor's stiffness in a force-based model. A bigger number is a stronger
 * motor — §28's monotone intent — and this file names it for what it is
 * (`examples/mechanism` records the same finding at length).
 */
const MOTOR_GAIN = 600;

/** Commanded shaft speed in rad/s (§7a) — a little under half a turn a second. */
const MOTOR_SPEED = 2.6;

const rotorPost = new Renderable(
  boxGeometry({ width: 0.4, height: ROTOR_POSITION.y * 2, depth: 0.4 }),
  new LitMaterial({ color: STATIC_COLOR }),
);
rotorPost.name = "rotor-post";
rotorPost.transform.position.set(
  ROTOR_POSITION.x,
  ROTOR_POSITION.y / 2,
  ROTOR_POSITION.z,
);
rotorPost.transformAuthority = "physics";
rotorPost.addComponent(new RigidBody({ type: "static" }));
app.scene.add(rotorPost);

const rotor = new Renderable(
  boxGeometry({
    width: ROTOR_HALF.x * 2,
    height: ROTOR_HALF.y * 2,
    depth: ROTOR_HALF.z * 2,
  }),
  new LitMaterial({ color: ROTOR_COLOR }),
);
rotor.name = "rotor";
rotor.transform.position.copy(ROTOR_POSITION);
rotor.transformAuthority = "physics";
rotor.addComponent(new RigidBody({ type: "dynamic" }));
rotor.addComponent(
  new Collider({ shape: { type: "box", halfExtents: ROTOR_HALF } }),
);
app.scene.add(rotor);

// --- §118: the 2D vector orbit (§50, §38) ------------------------------------

/** Where the orbit assembly sits, in world units — flat art, facing the camera. */
const ORBIT_POSITION = new Vector3(2.4, 1.15, 3.2);

/** How high the timeline lifts the whole assembly, and the radius it orbits at. */
const ORBIT_LIFT = 0.62;
const ORBIT_RADIUS = 0.72;

/** How many dots draw the orbit's path. */
const ORBIT_PATH_DOTS = 16;

/**
 * The orbit's root: moved by the §16 timeline, so its authority is
 * `"animation"`. Everything 2D hangs off it.
 */
const orbitRoot = new Group();
orbitRoot.name = "orbit";
orbitRoot.transform.position.copy(ORBIT_POSITION);
orbitRoot.transformAuthority = "animation";
app.scene.add(orbitRoot);

/** The dotted path — scaled by the timeline, so it is a node of its own. */
const orbitPath = new Group();
orbitPath.name = "orbit-path";
orbitPath.transformAuthority = "animation";
orbitRoot.add(orbitPath);

const orbitDotGeometry = circleGeometry2D({ radius: 0.05, segments: 12 });
const orbitDotMaterial = new UnlitMaterial({ color: ORBIT_PATH_COLOR });
for (let i = 0; i < ORBIT_PATH_DOTS; i += 1) {
  const angle = (i / ORBIT_PATH_DOTS) * Math.PI * 2;
  const dot = new Renderable(orbitDotGeometry, orbitDotMaterial);
  dot.name = `orbit-dot-${String(i)}`;
  dot.transform.position.set(
    Math.cos(angle) * ORBIT_RADIUS,
    Math.sin(angle) * ORBIT_RADIUS,
    0,
  );
  orbitPath.add(dot);
}

/**
 * The rotating frame: a `MotionComponent` integrates its angular velocity about
 * +Z once per fixed step, and the radius vector and the orbiter are its
 * children — so the orbit is a *transform*, not a per-frame `sin`/`cos` in
 * application code.
 */
const orbitPivot = new Group();
orbitPivot.name = "orbit-pivot";
orbitPivot.transformAuthority = "kinematic";
orbitPivot.addComponent(
  new MotionComponent({ angularVelocity: new Vector3(0, 0, 1.1) }),
);
orbitRoot.add(orbitPivot);

const orbitVector = new Renderable(
  planeGeometry({ width: ORBIT_RADIUS, height: 0.05 }),
  new UnlitMaterial({ color: ORBIT_VECTOR_COLOR }),
);
orbitVector.name = "orbit-vector";
// Half a radius along +X, so the bar spans centre → orbiter.
orbitVector.transform.position.set(ORBIT_RADIUS / 2, 0, 0.01);
orbitPivot.add(orbitVector);

const orbiter = new Renderable(
  circleGeometry2D({ radius: 0.17, segments: 28 }),
  new UnlitMaterial({ color: ORBIT_VECTOR_COLOR }),
);
orbiter.name = "orbiter";
orbiter.transform.position.set(ORBIT_RADIUS, 0, 0.02);
orbitPivot.add(orbiter);

// --- §36 particles ------------------------------------------------------------

/** Seeds are constants, never entropy — §33 forbids an unseeded default. */
const EMBER_SEED = 118_001;
const SPARK_SEED = 118_002;

/** Where the ball lands, and therefore where both emitters live. */
const IMPACT_POINT = new Vector3(BALL_START.x, 0.06, BALL_START.z);

/**
 * The embers: a continuous, modest fountain at the impact point, so the frame
 * always contains particles whether or not the ball happens to be landing.
 */
const emberEmitter = new ParticleEmitter({
  maxParticles: 900,
  seed: EMBER_SEED,
  position: IMPACT_POINT,
  emissionRate: 260,
  lifetime: { min: 1, max: 1.8 },
  initialSpeed: { min: 1.6, max: 3.2 },
  direction: new Vector3(0, 1, 0),
  spreadAngle: 0.55,
  size: { start: 0.08, end: 0.02 },
  color: {
    start: { r: 1, g: 0.92, b: 0.45, a: 1 },
    end: { r: 1, g: 0.75, b: 0.25, a: 0 },
  },
  // §27 fields, sampled and summed in exactly this order (floating-point
  // addition is not associative, so the order is part of the contract).
  fields: [uniformGravityField(new Vector3(0, -6.5, 0)), dragField(0.4)],
  collisionPlaneY: 0.02,
  restitution: 0.25,
});
const embers = new ParticleRenderable(emberEmitter);
embers.name = "embers";
app.scene.add(embers);

/**
 * The sparks: silent until the ball lands, then §36's burst.
 *
 * `ParticleEmitterOptions.position` is read once, in the constructor (WP-9.1
 * stages runtime re-authoring), so the burst originates at a fixed point rather
 * than at the contact. That is a stated limitation of the MVP tier, not an
 * oversight: the ball lands within a few centimetres of the same place every
 * time, and moving the *node* instead would drag every still-live particle with
 * it (particles simulate in the node's local space).
 */
const sparkEmitter = new ParticleEmitter({
  maxParticles: 1400,
  seed: SPARK_SEED,
  position: new Vector3(IMPACT_POINT.x, 0.3, IMPACT_POINT.z),
  emissionRate: 0,
  lifetime: { min: 0.7, max: 1.3 },
  initialSpeed: { min: 2.4, max: 4.4 },
  direction: new Vector3(0, 1, 0),
  spreadAngle: 1.1,
  size: { start: 0.1, end: 0.02 },
  color: {
    start: { r: 1, g: 0.95, b: 0.6, a: 1 },
    end: { r: 1, g: 0.6, b: 0.2, a: 0 },
  },
  gravity: new Vector3(0, -9.81, 0),
});
const sparks = new ParticleRenderable(sparkEmitter);
sparks.name = "sparks";
// Drawn after the embers within the same layer (§66 sort key 5).
sparks.renderOrder = 1;
app.scene.add(sparks);

/** Particles per landing. Comfortably inside the pool. */
const SPARKS_PER_BOUNCE = 320;

// --- §118: world-space labels (§55, §56) --------------------------------------

/**
 * The font, packed once into one RGBA8 buffer with a uv rectangle per glyph.
 * ASCII only: the built-in 6 × 12 face covers U+0020…U+007E, and anything else
 * — an em dash, say — draws the missing-glyph box.
 */
const atlas = buildGlyphAtlas();

/**
 * The whole sheet as one texture, sampled with §77's `"nearest"` filter (R-30):
 * the face is a bitmap, and a linear filter blends each texel with its
 * neighbours — at a cell's edge, with the neighbouring *glyph*.
 */
const font = new Texture({ ...atlas, filter: "nearest" });

/**
 * One material behind **every** label on this page, world-space and UI alike.
 *
 * §57 puts a label's colour on the material, so one shared material is also one
 * colour — which is what the gate's neutral glyph classifier wants — and
 * consecutive `Text` nodes over one material are the run §65's batcher merges.
 *
 * Until 2026-08-21 this section held `examples/first-2d-scene`'s workaround: one
 * cut-out `Texture` per distinct glyph cell and one `Sprite` per drawn glyph,
 * because a sprite maps its whole texture across its whole quad and §55's frame
 * sub-rectangle never landed. R-28's `Text` node addresses the cells with §53
 * per-vertex uvs instead, so a label is one node, one geometry and one draw.
 */
const ink = new UnlitMaterial({
  map: font,
  transparent: true,
  color: [LABEL_TINT[0], LABEL_TINT[1], LABEL_TINT[2], LABEL_TINT[3]],
  // A label is alpha coverage over rectangles, and a depth-only pass writes
  // geometry rather than alpha — `Text` therefore defaults `castShadow` off,
  // and this material is never a shadow caster either (§69, R-28).
});

/**
 * Builds a world-space label centred on its own origin.
 *
 * `renderLayer: 1` draws it after the opaque scene — it blends, and blending
 * needs what is behind it already in the framebuffer (§66). Centring is a
 * subtraction of a number the node reports: a `Text`'s origin is the first
 * line's baseline at its left edge (§56).
 */
function worldLabel(name: string, text: string, size: number): Text {
  const label = new Text(atlas, ink, { text, size, renderLayer: 1 });
  label.name = name;
  return label;
}

/** World units per line of the title — `layoutText`'s `size`, not an em size. */
const TITLE_SIZE = 0.34;

/** Where the title's baseline sits, above the horizon and clear of every object. */
const TITLE_BASELINE = new Vector3(0, 5.55, 0);

const titleLabel = worldLabel(
  "title-label",
  "one scene - everything moves",
  TITLE_SIZE,
);
titleLabel.transform.position.set(
  TITLE_BASELINE.x - titleLabel.layout.width / 2,
  TITLE_BASELINE.y,
  TITLE_BASELINE.z,
);
app.scene.add(titleLabel);

/** Size of the label that rides the ball, and how far above it that label floats. */
const BALL_LABEL_SIZE = 0.26;
const BALL_LABEL_OFFSET = 0.85;

/**
 * The second world-space label: a live readout of §29's collision count that
 * **follows the bouncing body**.
 *
 * Its quads are rebuilt only when the count changes — a few times a second at
 * most, and lazily, on the next read of the geometry — while its position is
 * written every frame from the body's transform, which is why the node is
 * `"manual"`: the application moves it, not a system.
 */
const ballLabel = worldLabel("ball-label", "", BALL_LABEL_SIZE);
ballLabel.transformAuthority = "manual";
app.scene.add(ballLabel);

// --- §84/§113: the debug overlay ---------------------------------------------

/**
 * The overlay's line buffer, and the two `Float32Array`s it publishes.
 *
 * `@fourjs/diagnostics` has no `geometry` edge in the frozen §3.1 matrix, so it
 * emits streams whose field names spread straight into `BufferGeometryOptions`
 * and the assembly happens here — the one place that may see both packages
 * (R-35, 2026-08-07). This page is the first *example* to do it.
 */
const overlayBuffer = new DebugDrawBuffer();

/** Collision events dispatched during the most recent fixed step, for the overlay. */
const stepCollisions: DebugPhysicsEventLike[] = [];

/** Reused across frames, so a steady segment count reallocates nothing. */
let overlayStreams: DebugDrawStreams | undefined;

/** The overlay, once the world holds its bodies. `null` until `main` runs. */
let overlay: { node: Renderable; geometry: BufferGeometry } | null = null;

/** The overlay's geometry and node, built once the world holds its bodies. */
function buildOverlay(): { node: Renderable; geometry: BufferGeometry } {
  collectOverlaySegments();
  overlayStreams = debugDrawStreams(overlayBuffer);
  const geometry = new BufferGeometry({
    positions: overlayStreams.positions,
    colors: overlayStreams.colors,
    mode: "lines",
  });
  const node = new Renderable(
    geometry,
    // One draw call for the whole overlay, whatever its segment count: the
    // colours ride the geometry, not the material (R-19/R-35).
    new UnlitMaterial({ color: [1, 1, 1, 1], vertexColors: true }),
  );
  node.name = "debug-overlay";
  node.visible = false;
  // After the opaque scene, so the lines are not lost inside the bodies they
  // describe.
  node.renderLayer = 1;
  app.scene.add(node);
  return { node, geometry };
}

/**
 * Colour of the §113 body-origin crosses.
 *
 * Overridden from `DEBUG_DRAW_DEFAULT_COLORS.origin` (cyan) for the palette's
 * sake: the rotor is cyan, and an overlay that borrowed a scene object's hue
 * would make the browser gate's classifiers lie. Pure green shares its hue with
 * the contact normals, which are both "overlay", so nothing is lost. Every
 * other overlay colour here is §113's default.
 */
const OVERLAY_ORIGIN_COLOR: readonly [number, number, number, number] = [
  0, 1, 0, 1,
];

/** Refills {@link overlayBuffer} from the live world (§113's cheapest views). */
function collectOverlaySegments(): void {
  overlayBuffer.clear();
  // `world.adapter` is a `SolverBodyAccess`, which satisfies the diagnostics
  // package's structural `DebugBodyAccess` without either package importing the
  // other — so an application can assemble the overlay while §3.1 stays frozen.
  // The documented default (`CollectBodyOriginsOptions.size`, 0.1 world units)
  // is shorter than these bodies (ball radius 0.42, bob 0.34), so a default
  // cross is hidden by the depth test. The arms here are 0.55 m — longer than
  // the meshes they mark. Measured: at 0.18 the crosses contributed exactly
  // zero pixels.
  collectBodyOrigins(world.adapter, overlayBuffer, {
    size: 0.55,
    color: OVERLAY_ORIGIN_COLOR,
  });
  // Half a second of travel per vector, and the angular vectors too — this is a
  // 3D world, where they are not degenerate the way §21's ±Z ones are.
  collectBodyVelocities(world.adapter, overlayBuffer, {
    scale: 0.5,
    includeAngular: true,
  });
  collectContactPoints(stepCollisions, overlayBuffer);
}

// --- the screen-space control panel (§73–§75) --------------------------------

/**
 * §74 layout numbers, in **logical pixels** — because the UI camera's world unit
 * *is* a logical pixel (see {@link uiCamera}). The button row is
 * `3 × 100 + 2 × 10 = 320` wide, so with padding the panel resolves to
 * `348 × 140`, and it is placed so its top-left corner is at
 * {@link PANEL_ORIGIN} — the lower-**right** quarter of the frame, where the
 * only thing behind it is the ground slab.
 *
 * Until 2026-08-21 these were fractions of a world unit on a plane 2.2 units in
 * front of the camera, and the comment here had to explain that one UI unit was
 * "≈ 329 CSS pixels" so that a reader could tell how big a 0.045-unit label
 * would come out. That arithmetic is gone: 15 is fifteen pixels.
 */
const PANEL_PADDING = 14;
const PANEL_GAP = 10;
const BUTTON_WIDTH = 100;
const BUTTON_HEIGHT = 34;
const SLIDER_WIDTH = 320;
const SLIDER_HEIGHT = 18;
const TITLE_TEXT_SIZE = 16;
const BUTTON_TEXT_SIZE = 15;
const STATUS_TEXT_SIZE = 14;

/**
 * Top-left corner of the panel, in canvas pixels measured from the **bottom**
 * left (the origin {@link uiCamera} was built with).
 *
 * `z = 0`: the screen camera's slab is `−1000 … 1000`, so content authored on
 * the plane the camera sits on is visible without moving either.
 */
const PANEL_ORIGIN = new Vector3(592, 221, 0);

/** Widget surfaces: warm-grey and near-neutral, so no hue classifier claims them. */
const PANEL_COLOR: Rgba = [0.13, 0.14, 0.17, 1];
const BUTTON_IDLE_COLOR: Rgba = [0.3, 0.28, 0.24, 1];
const BUTTON_HOVER_COLOR: Rgba = [0.44, 0.42, 0.36, 1];
const BUTTON_PRESSED_COLOR: Rgba = [0.62, 0.6, 0.52, 1];
const BUTTON_LATCHED_COLOR: Rgba = [0.52, 0.46, 0.3, 1];
const FOCUS_RING_COLOR: Rgba = [0.92, 0.94, 0.98, 1];
const SLIDER_TRACK_COLOR: Rgba = [0.18, 0.19, 0.22, 1];
const SLIDER_FILL_COLOR: Rgba = [0.35, 0.55, 0.62, 1];
const SLIDER_HANDLE_COLOR: Rgba = [0.92, 0.94, 0.98, 1];

/*
 * Widgets are coplanar — §74 layout writes (left, −top) and preserves z — so
 * the *visuals* separate by depth: panel background under focus ring under
 * button face under glyphs.
 */
const PANEL_QUAD_Z = 0;
const FOCUS_RING_Z = 1;
const WIDGET_QUAD_Z = 2;
const SLIDER_FILL_Z = 3;
const SLIDER_HANDLE_Z = 4;
const UI_GLYPH_Z = 5;

/** How far the focus ring extends past a widget's box on every side, in pixels. */
const FOCUS_RING_MARGIN = 4;

/** Builds one unit quad the skins scale into place. */
function skinQuad(name: string, color: Rgba): Renderable<UnlitMaterial> {
  const quad = new Renderable(
    planeGeometry({ width: 1, height: 1 }),
    new UnlitMaterial({ color: [color[0], color[1], color[2], color[3]] }),
  );
  quad.name = name;
  // §46 is self, not subtree: a skin's quad is a child of a widget but its
  // membership is its own, so every node this function makes says which pass
  // draws it. Missing it is the one mistake this arrangement can make, which is
  // why there is exactly one place to make it.
  quad.layers = UI_LAYER;
  return quad;
}

/** A flat background filling the widget's box — the panel's skin. */
function panelSkin(color: Rgba, z: number): WidgetSkin {
  let quad: Renderable<UnlitMaterial> | null = null;
  return {
    onAttach(widget) {
      quad = skinQuad(`${widget.name}-background`, color);
      widget.add(quad);
    },
    onLayout(widget) {
      if (quad === null) return;
      // The widget's box has its origin at the top-left and y down, so the
      // centre of the box is `(w/2, −h/2)`.
      quad.transform.position.set(
        widget.measuredWidth / 2,
        -widget.measuredHeight / 2,
        z,
      );
      quad.transform.scale.set(widget.measuredWidth, widget.measuredHeight, 1);
    },
    onDetach(widget) {
      if (quad !== null) widget.remove(quad);
      quad = null;
    },
  };
}

/**
 * A button's face and focus ring, plus a **latched** colour this page adds.
 *
 * Two of the three buttons are toggles ("pause" and "debug"), and §73's
 * `Button` is not a checkable widget, so what is latched is application state.
 * The skin reads it through a callback rather than inventing a widget state.
 */
function buttonSkin(latched: () => boolean): WidgetSkin {
  let face: Renderable<UnlitMaterial> | null = null;
  let ring: Renderable<UnlitMaterial> | null = null;
  const repaint = (widget: UIWidget): void => {
    if (face === null || ring === null) return;
    const [red, green, blue, alpha] = widget.pressed
      ? BUTTON_PRESSED_COLOR
      : widget.hovered
        ? BUTTON_HOVER_COLOR
        : latched()
          ? BUTTON_LATCHED_COLOR
          : BUTTON_IDLE_COLOR;
    face.material.setColor(red, green, blue, alpha);
    ring.visible = widget.focused;
  };
  return {
    onAttach(widget) {
      ring = skinQuad(`${widget.name}-focus-ring`, FOCUS_RING_COLOR);
      ring.visible = false;
      widget.add(ring);
      face = skinQuad(`${widget.name}-face`, BUTTON_IDLE_COLOR);
      widget.add(face);
    },
    onLayout(widget) {
      if (face === null || ring === null) return;
      const width = widget.measuredWidth;
      const height = widget.measuredHeight;
      face.transform.position.set(width / 2, -height / 2, WIDGET_QUAD_Z);
      face.transform.scale.set(width, height, 1);
      ring.transform.position.set(width / 2, -height / 2, FOCUS_RING_Z);
      ring.transform.scale.set(
        width + 2 * FOCUS_RING_MARGIN,
        height + 2 * FOCUS_RING_MARGIN,
        1,
      );
      repaint(widget);
    },
    onStateChange: repaint,
    onDetach(widget) {
      if (face !== null) widget.remove(face);
      if (ring !== null) widget.remove(ring);
      face = null;
      ring = null;
    },
  };
}

/**
 * A slider's track, fill and handle (§73, A-12).
 *
 * `onContentChange` is the hook the value moves through: the widget's *box* is
 * exactly what did not change when a drag or an arrow key moves the number, so
 * neither `onLayout` nor `onStateChange` is the right place — that asymmetry is
 * why the fourth hook exists.
 */
function sliderSkin(): WidgetSkin {
  let track: Renderable<UnlitMaterial> | null = null;
  let fill: Renderable<UnlitMaterial> | null = null;
  let handle: Renderable<UnlitMaterial> | null = null;
  let ring: Renderable<UnlitMaterial> | null = null;

  const place = (widget: UIWidget): void => {
    if (track === null || fill === null || handle === null || ring === null) {
      return;
    }
    const width = widget.measuredWidth;
    const height = widget.measuredHeight;
    const fraction = widget instanceof Slider ? widget.fraction : 0;
    track.transform.position.set(width / 2, -height / 2, WIDGET_QUAD_Z);
    track.transform.scale.set(width, height * 0.5, 1);
    fill.transform.position.set(
      (width * fraction) / 2,
      -height / 2,
      SLIDER_FILL_Z,
    );
    fill.transform.scale.set(width * fraction, height * 0.5, 1);
    handle.transform.position.set(
      width * fraction,
      -height / 2,
      SLIDER_HANDLE_Z,
    );
    handle.transform.scale.set(height * 0.42, height, 1);
    ring.transform.position.set(width / 2, -height / 2, FOCUS_RING_Z);
    ring.transform.scale.set(
      width + 2 * FOCUS_RING_MARGIN,
      height + 2 * FOCUS_RING_MARGIN,
      1,
    );
    ring.visible = widget.focused;
  };

  return {
    onAttach(widget) {
      ring = skinQuad(`${widget.name}-focus-ring`, FOCUS_RING_COLOR);
      ring.visible = false;
      widget.add(ring);
      track = skinQuad(`${widget.name}-track`, SLIDER_TRACK_COLOR);
      widget.add(track);
      fill = skinQuad(`${widget.name}-fill`, SLIDER_FILL_COLOR);
      widget.add(fill);
      handle = skinQuad(`${widget.name}-handle`, SLIDER_HANDLE_COLOR);
      widget.add(handle);
    },
    onLayout: place,
    onStateChange: place,
    onContentChange: place,
    onDetach(widget) {
      for (const node of [track, fill, handle, ring]) {
        if (node !== null) widget.remove(node);
      }
      track = null;
      fill = null;
      handle = null;
      ring = null;
    },
  };
}

/**
 * A label's glyphs — one `Text` node per label, over the shared atlas material.
 *
 * The node sits at `(0, −textBaselineTop)` because a `Text`'s origin is the
 * first line's baseline at its left edge while the widget's origin is its
 * top-left corner. `size` and `letterSpacing` are written only when they change:
 * neither setter has an equality check of its own (`text` does), so an
 * unconditional write on every `layout()` pass would rebuild vertex buffers that
 * did not move.
 */
function labelSkin(): WidgetSkin {
  let glyphs: Text | null = null;
  return {
    onAttach(widget) {
      glyphs = new Text(atlas, ink, { renderLayer: 1 });
      glyphs.name = `${widget.name}-glyphs`;
      glyphs.layers = UI_LAYER;
      widget.add(glyphs);
    },
    onLayout(widget) {
      if (glyphs === null || !(widget instanceof Label)) return;
      glyphs.transform.position.set(0, -widget.textBaselineTop, UI_GLYPH_Z);
      glyphs.text = widget.text;
      if (glyphs.size !== widget.size) glyphs.size = widget.size;
      if (glyphs.letterSpacing !== widget.letterSpacing) {
        glyphs.letterSpacing = widget.letterSpacing;
      }
    },
    onDetach(widget) {
      if (glyphs !== null) {
        // The node owns its quad buffers; the atlas, texture and material are
        // shared and outlive it (§83).
        widget.remove(glyphs);
        glyphs.dispose();
      }
      glyphs = null;
    },
  };
}

// --- the controls' state (§118: pause, slow motion, single-step) -------------

/** Whether the simulation is paused (§10). Mirrored onto `#status`. */
let paused = false;

/** Whether the §113 overlay is switched on. */
let overlayVisible = false;

/** Fixed steps run by the most recent single-step click; `0` before the first. */
let lastSingleStepCount = 0;

/** Single-step clicks since the page loaded. */
let singleSteps = 0;

/** Widget activations (pointer or keyboard) since the page loaded. */
let activations = 0;

/** What caused the most recent activation; `"none"` before the first. */
let lastSource: WidgetActivationSource | "none" = "none";

/** Landings the ball has reported through §29 since the page loaded. */
let bounces = 0;

/** Loops the §16 timeline has completed. */
let laps = 0;

/**
 * The smallest and largest simulation speeds the slider commands, and its step.
 *
 * The minimum is 0.05 rather than 0 because a `timeScale` of zero is what
 * `paused` already means (§10 defines pause as exactly `timeScale = 0` for the
 * frame, with `timeScale` preserved), and two controls meaning the same thing
 * is how a UI lies about its state.
 */
const TIME_SCALE_MIN = 0.05;
const TIME_SCALE_MAX = 1.5;
const TIME_SCALE_STEP = 0.05;

// --- the widget tree ----------------------------------------------------------

const uiRoot = new Panel({
  name: "panel",
  // Containers opt out of §71 picking so a click inside a button cannot tie
  // with its coplanar ancestor — `collectPickables` documents the tie and this
  // is its recommended resolution.
  interactive: false,
  layout: {
    type: "flex",
    direction: "column",
    gap: PANEL_GAP,
    padding: PANEL_PADDING,
  },
});
// §42: the application places the root; every descendant stays under the
// `"constraint"` authority its parent's layout writes with.
uiRoot.transformAuthority = "manual";
uiRoot.transform.position.copy(PANEL_ORIGIN);
// An ordinary child of the scene: what makes it screen-space is the view it is
// drawn through, not who its parent is (§47, §48).
app.scene.add(uiRoot);

const panelTitle = new Label({
  name: "panel-title",
  text: "fourJS flagship",
  atlas,
  size: TITLE_TEXT_SIZE,
});

const buttonRow = new Panel({
  name: "button-row",
  interactive: false,
  layout: { type: "flex", direction: "row", gap: PANEL_GAP },
});

const statusLabel = new Label({
  name: "panel-status",
  text: "running - speed 1.00",
  atlas,
  size: STATUS_TEXT_SIZE,
});

uiRoot.add(panelTitle);
uiRoot.add(buttonRow);

const timeScaleSlider = new Slider({
  name: "speed",
  width: SLIDER_WIDTH,
  height: SLIDER_HEIGHT,
  min: TIME_SCALE_MIN,
  max: TIME_SCALE_MAX,
  step: TIME_SCALE_STEP,
  value: 1,
  accessibility: {
    role: "slider",
    label: "Simulation speed",
    tabIndex: 3,
  },
});
uiRoot.add(timeScaleSlider);
uiRoot.add(statusLabel);

/** What each button does, in tab order. */
interface Control {
  readonly name: string;
  readonly caption: string;
  readonly activate: () => void;
  readonly latched: () => boolean;
}

const controls: readonly Control[] = [
  {
    name: "pause",
    caption: "pause",
    activate: () => {
      paused = !paused;
      // A pure proxy for `scheduler.paused`: the loop keeps calling `step`, the
      // render callbacks keep running, and the accumulator simply stops
      // accumulating (§10).
      if (paused) app.pause();
      else app.resume();
    },
    latched: () => paused,
  },
  {
    name: "step",
    caption: "step",
    activate: singleStep,
    latched: () => false,
  },
  {
    name: "debug",
    caption: "debug",
    activate: () => {
      overlayVisible = !overlayVisible;
      if (overlay !== null) overlay.node.visible = overlayVisible;
    },
    latched: () => overlayVisible,
  },
];

const buttons: Button[] = controls.map((control, index) => {
  const button = new Button({
    name: control.name,
    width: BUTTON_WIDTH,
    height: BUTTON_HEIGHT,
    layout: {
      type: "flex",
      direction: "row",
      justify: "center",
      align: "center",
    },
    accessibility: {
      role: "button",
      label: control.caption,
      tabIndex: index,
    },
  });
  const caption = new Label({
    name: `${control.name}-caption`,
    text: control.caption,
    atlas,
    size: BUTTON_TEXT_SIZE,
  });
  button.add(caption);
  buttonRow.add(button);

  // One event whatever the source: a §72 click synthesized by the pointer
  // source, or the Enter/Space the button reads off §72's key events.
  button.on("uiactivate", (event) => {
    activations += 1;
    lastSource = event.source;
    control.activate();
  });

  button.skin = buttonSkin(control.latched);
  caption.skin = labelSkin();
  return button;
});

timeScaleSlider.on("uivaluechange", (event) => {
  // §10's own dial: the accumulator absorbs `elapsed × timeScale`, so this is
  // slow motion for *everything* the fixed step drives — physics, particles,
  // motion and animation alike — and not a per-system fudge.
  app.scheduler.timeScale = event.current;
});
timeScaleSlider.skin = sliderSkin();

uiRoot.skin = panelSkin(PANEL_COLOR, PANEL_QUAD_Z);
panelTitle.skin = labelSkin();
statusLabel.skin = labelSkin();
uiRoot.layout();
// §46 is self, not subtree: skins already stamp `UI_LAYER` on their quads,
// but the panel widgets themselves stayed on the default layer. One walk
// after the tree (and its skins) exists puts the whole panel on the UI
// pass the viewport already masks to (`uiView.layerMask`).
applyLayers(uiRoot, UI_LAYER);

// --- picking, pointer and keyboard (§71, §72, §75) ---------------------------

/** Candidate scratch — `collectPickables` overwrites it per query, zero-alloc. */
const pickables: Pickable[] = [];

// A real `HTMLCanvasElement` satisfies `PointerSurface` structurally, and
// `window` satisfies `KeySurface` the same way. Both live exactly as long as
// the page does, so neither is disposed here (§83).
// The **UI** camera, not the world one: the §71 ray must be cast through the
// projection the panel is drawn with, or it would test a screen-space rectangle
// against a perspective ray and miss everything (§48, §71).
new PointerInput(canvas, {
  camera: uiCamera,
  pickables: () => collectPickables(uiRoot, pickables),
});
new KeyboardInput(window, { focusTarget: keyboardFocusTarget(uiRoot) });
installKeyboardTraversal(uiRoot);

// --- §118: the timeline (§16) -------------------------------------------------

/**
 * The §16 timeline: two tweens on **different** nodes, sequenced on one axis,
 * plus a marker.
 *
 * Two nodes rather than one because §16's conflict registry is per property:
 * two tweens claiming `orbitRoot.transform` would warn and the later one would
 * win. So the lift is the root's and the pulse is the path's, and the two
 * overlap in time exactly as a timeline is meant to let them.
 *
 * Each child is `yoyo().repeat(1)` — out and back — so one iteration returns
 * the scene to its start pose and `loop(Infinity)` is seamless rather than a
 * snap. The marker at 0 counts iterations, which is the cheapest proof that the
 * axis is being traversed rather than merely evaluated.
 */
const orbitTimeline = new Timeline()
  .at(
    0,
    animate(orbitRoot)
      .to(
        {
          "transform.position": new Vector3(
            ORBIT_POSITION.x,
            ORBIT_POSITION.y + ORBIT_LIFT,
            ORBIT_POSITION.z,
          ),
        },
        1.1,
      )
      .ease("sine-in-out")
      .yoyo()
      .repeat(1),
  )
  .at(
    0.55,
    animate(orbitPath)
      .to({ "transform.scale": new Vector3(1.22, 1.22, 1) }, 0.55)
      .ease("quadratic-in-out")
      .yoyo()
      .repeat(1),
  )
  .at(0, () => {
    laps += 1;
  })
  .loop(Infinity);

// --- systems (§39) ------------------------------------------------------------

const motionSystem = new MotionSystem();
const animationSystem = new AnimationSystem();
const particleSystem = new ParticleSystem();
app.systems.register(motionSystem);
app.systems.register(animationSystem);
app.systems.register(particleSystem);

motionSystem.track(cube);
motionSystem.track(orbitPivot);
animationSystem.track(orbitTimeline.play());
particleSystem.track(emberEmitter);
particleSystem.track(sparkEmitter);

// The physics world already tracks its dynamic bodies into `app.poses`; the two
// nodes the other systems move are tracked here so they interpolate too (§43).
app.poses.track(cube);
app.poses.track(orbitPivot);

// --- registering the bodies, the joints and §118's collision events ----------

/** Scratch for the §26 impulse. Module-level and reused (plan D7). */
const impulse = new Vector3();

/**
 * Hands the six nodes above to the solver, joints them, and wires §29.
 *
 * Deliberately a function called from {@link main} rather than six statements
 * at module scope: `PhysicsWorld.addBody` refuses to run before
 * `world.initialize()` has decoded the wasm image (§37 puts the load there), so
 * everything that touches the solver has to be on the far side of that `await`.
 * Building the *nodes* eagerly and registering them here is the split every
 * wasm-backed example in this repository makes.
 *
 * Order matters twice: a joint's anchors are world-space at `addJoint` and are
 * baked into body-local frames *there* (§28), so both of its bodies must exist
 * and be standing where they belong first.
 */
function registerPhysics(): void {
  world.addBody(ground);
  const ballBody = world.addBody(ball);
  const anchorBody = world.addBody(pendulumAnchor);
  const bobBody = world.addBody(bob);
  const rotorPostBody = world.addBody(rotorPost);
  const rotorBody = world.addBody(rotor);

  world.addJoint(
    new SpringJoint({
      bodyA: anchorBody,
      bodyB: bobBody,
      anchorA: PENDULUM_ANCHOR,
      anchorB: BOB_START,
      restLength: SPRING_REST_LENGTH,
      stiffness: SPRING_STIFFNESS,
      damping: SPRING_DAMPING,
    }),
  );

  // The hinge, with its §28 motor enabled from the first step. The axis is
  // `+Z` — required in a `"3d"` world, where a hinge has three axes to choose
  // between (a `"2d"` world has only one and fills it in) — so the rotor turns
  // in the camera's plane and its motion is legible rather than foreshortened.
  // It and the ball's landing impulse are the only two things in this scene
  // that put energy *in*; everything else spends what it was given.
  world.addJoint(
    new HingeJoint({
      bodyA: rotorPostBody,
      bodyB: rotorBody,
      anchor: ROTOR_POSITION,
      axis: new Vector3(0, 0, 1),
      motor: {
        enabled: true,
        targetVelocity: MOTOR_SPEED,
        maxTorque: MOTOR_GAIN,
      },
    }),
  );

  /*
   * Every landing: count it, spark it, and put the energy back.
   *
   * §29's events are dispatched **after** the fixed step that produced them
   * (§39 step 9), so the velocity read here is the post-bounce one and the
   * impulse queued here is drained by the *next* step (§26's commands, never
   * mutations). The horizontal term is a gentle recentring — a real bounce
   * walks sideways, and a demonstration that walked off screen would be a
   * worse kind of honest.
   */
  ballBody.on("collisionstart", (event) => {
    bounces += 1;
    stepCollisions.push(event);
    sparkEmitter.emit(SPARKS_PER_BOUNCE);

    const mass = ballBody.mass ?? 1;
    const upward = Math.max(0, BALL_REBOUND_SPEED - ballBody.linearVelocity.y);
    impulse.set(
      mass * (BALL_START.x - ball.transform.position.x) * 0.9,
      mass * upward,
      mass * (BALL_START.z - ball.transform.position.z) * 0.9,
    );
    ballBody.applyImpulse(impulse);
  });
}

// --- per-frame application work ----------------------------------------------

/** Scratch for the spring's endpoints. */
const springDelta = new Vector3();

/**
 * Redraws the spring between the anchor and the bob.
 *
 * The quad is one unit tall, so its Y scale **is** the spring's current length;
 * the rotation is the angle of the anchor→bob vector about +Z, which is exact
 * because the pendulum swings in the XY plane. Purely presentational: nothing
 * here is read by the solver.
 *
 * Written from the bodies' **live** transforms rather than their §43
 * interpolated poses, so at a render rate above 60 Hz the bar leads the bob it
 * connects by up to one fixed step. Visible only if you look for it, and stated
 * rather than hidden — `examples/mechanism` makes the same trade.
 */
function updateSpringVisual(): void {
  const from = pendulumAnchor.transform.position;
  const to = bob.transform.position;
  springDelta.copy(to).sub(from);
  const length = Math.max(1e-4, springDelta.length());
  springVisual.transform.position.set(
    (from.x + to.x) / 2,
    (from.y + to.y) / 2,
    (from.z + to.z) / 2,
  );
  springVisual.transform.scale.set(1, length, 1);
  // `atan2(x, −y)`: the quad is authored along +Y, and the spring hangs down.
  springVisual.transform.rotation.setFromAxisAngle(
    new Vector3(0, 0, 1),
    Math.atan2(springDelta.x, -springDelta.y),
  );
}

/** The bounce count the ball's label currently shows. */
let labelledBounces = -1;

/** Moves the ball's label, and rewrites it when the count has changed. */
function updateBallLabel(): void {
  if (labelledBounces !== bounces) {
    labelledBounces = bounces;
    ballLabel.text = `bounces ${String(bounces)}`;
  }
  const position = ball.transform.position;
  // Centred on the ball: the label's own laid-out width, read back from the
  // node rather than recomputed here (§56).
  ballLabel.transform.position.set(
    position.x - ballLabel.layout.width / 2,
    position.y + BALL_LABEL_OFFSET,
    position.z,
  );
}

/** Rebuilds the overlay's line geometry from the live world. */
function updateOverlay(): void {
  if (overlay === null || !overlayVisible) return;
  collectOverlaySegments();
  overlayStreams = debugDrawStreams(overlayBuffer, overlayStreams);
  // The three-assignment order inside `applyDebugDrawStreams` is what makes a
  // *shrinking* overlay legal: a geometry validates new positions against the
  // colours it still holds (§85 index alignment).
  applyDebugDrawStreams(overlayStreams, overlay.geometry);
}

// --- §118: single-step -------------------------------------------------------

/** Slack added to the single-step delta so the accumulator's `>=` cannot miss. */
const STEP_EPSILON = 1e-6;

/**
 * Advances the simulation by **exactly one** fixed step while paused.
 *
 * §10's accumulator is what makes this exact rather than approximate: the
 * scheduler publishes its unconsumed time, so the delta that runs one step and
 * no more is `fixedDeltaTime − accumulator`. Time scale is neutralized for the
 * duration (a slow-motion single-step would be a fraction of a step), pause is
 * lifted and restored around it, and the number of steps that actually ran is
 * published as `data-substeps` so the claim can be checked instead of trusted.
 *
 * Stepping while *running* would be meaningless — the loop is already doing it
 * — so the button does nothing then, and says so through `data-substeps = 0`.
 */
function singleStep(): void {
  const scheduler = app.scheduler;
  if (!scheduler.paused) {
    lastSingleStepCount = 0;
    return;
  }
  const savedScale = scheduler.timeScale;
  scheduler.timeScale = 1;
  scheduler.paused = false;
  app.step(
    Math.max(0, scheduler.fixedDeltaTime - scheduler.accumulator) +
      STEP_EPSILON,
  );
  scheduler.paused = true;
  scheduler.timeScale = savedScale;
  lastSingleStepCount = scheduler.fixedStepsLastFrame;
  singleSteps += 1;
}

// --- what the page publishes --------------------------------------------------

/** Frames rendered since the loop started. */
let frameCount = 0;

/**
 * Where the centre of `widget`'s box lands on the canvas, in CSS pixels.
 *
 * The page publishes these as `data-controls` because a browser gate should not
 * have to re-derive §74's layout arithmetic to find a button: the panel's
 * resolved boxes are the layout's business, and a test that recomputed them
 * would be testing its own copy of the algorithm. What the gate *does* check is
 * that the page's claim is true — it moves the pointer to the published point
 * and reads `data-hover` back before clicking.
 *
 * **This function used to be twenty lines** (2026-08-21): with the panel
 * parented to the perspective camera it had to transform the widget's centre
 * into camera space through an inverted world matrix, divide by −z, and scale
 * by the frustum's half-extents at that depth. Under {@link uiCamera} a widget's
 * world position **is** its position on the canvas, and the only conversion left
 * is the one between the camera's bottom-left origin and the DOM's top-left one.
 * That collapse is the whole argument for the screen camera, stated as code.
 */
function controlPixels(widget: UIWidget): { x: number; y: number } {
  // A widget sits inside a row inside the panel, so its *world* transform is
  // what carries the pixels; the panel's own layout is a chain of parents. No
  // widget is rotated or scaled, so the translation columns are the whole
  // answer (§7b: column-major, elements 12 and 13).
  const world = resolveWorldTransform(widget).elements;
  return {
    x: world[12] + widget.measuredWidth / 2,
    y: HEIGHT - (world[13] - widget.measuredHeight / 2),
  };
}

/** `name:x,y` for every control, as the page believes them to be on screen. */
function publishControlPositions(): string {
  const parts: string[] = [];
  for (const widget of [...buttons, timeScaleSlider]) {
    const point = controlPixels(widget);
    parts.push(`${widget.name}:${point.x.toFixed(1)},${point.y.toFixed(1)}`);
  }
  return parts.join("|");
}

/**
 * Mirrors the running scene onto `#status`, so a browser gate can read the
 * engine's own account of the frame instead of inferring everything from
 * pixels — and so the two accounts can be checked against each other.
 */
function publish(): void {
  const data = status.dataset;
  const scheduler = app.scheduler;
  data["state"] = "running";
  data["frames"] = String(frameCount);
  data["sim"] = scheduler.time.simulationTime.toFixed(4);
  data["steps"] = String(scheduler.time.simulationStep);
  data["paused"] = paused ? "true" : "false";
  data["timescale"] = scheduler.timeScale.toFixed(2);
  data["substeps"] = String(lastSingleStepCount);
  data["singlesteps"] = String(singleSteps);
  data["bounces"] = String(bounces);
  data["laps"] = String(laps);
  data["overlay"] = overlayVisible ? "on" : "off";
  data["particles"] = String(
    emberEmitter.particleCount + sparkEmitter.particleCount,
  );
  data["focused"] = focusedWidget(app.scene)?.name ?? "none";
  data["hover"] = buttons.find((button) => button.hovered)?.name ?? "none";
  data["activations"] = String(activations);
  data["source"] = lastSource;
  data["speed"] = timeScaleSlider.value.toFixed(2);
  data["controls"] = publishControlPositions();

  statusLabel.text = `${paused ? "paused" : "running"} - speed ${scheduler.timeScale.toFixed(2)}`;
  // §74's layout is explicit and one-pass: a changed text is a changed
  // intrinsic size, so the panel is re-laid-out rather than left stale.
  uiRoot.layout();

  status.textContent =
    `${paused ? "paused" : "running"} — ` +
    `${String(bounces)} bounces, ${String(laps)} timeline laps, ` +
    `${String(emberEmitter.particleCount + sparkEmitter.particleCount)} particles — ` +
    "click or Tab to the panel: pause, step, debug overlay, speed";
}

app.on("update", () => {
  frameCount += 1;
  updateSpringVisual();
  updateBallLabel();
  updateOverlay();
  publish();
  // The overlay consumes the step's collisions; the counter above already has
  // them. Cleared after the frame that drew them so a landing is visible for
  // exactly the frame it happened in.
  stepCollisions.length = 0;
});

// --- the frame loop -----------------------------------------------------------

/**
 * Drives the application from `requestAnimationFrame`.
 *
 * Seeded from the FIRST rAF timestamp rather than a `now()` taken earlier: rAF
 * hands the frame-*start* time, and a negative first delta would make
 * `app.step` throw and kill the loop (the bug WP-3.7-fix1 fixed).
 */
let last: number | null = null;

function frame(now: number): void {
  if (last !== null) {
    app.step((now - last) / 1000);
  }
  last = now;
  requestAnimationFrame(frame);
}

const LOADING_TEXT = "loading (WebGL 2 context and the WebAssembly solver)…";

async function main(): Promise<void> {
  status.textContent = LOADING_TEXT;

  // Resolves and initializes the backend §62 chose (§45).
  await app.initialize();
  // Decodes the Rapier 3D wasm image; §37 allows `initialize` to be async for
  // exactly this.
  await world.initialize();

  // Everything that touches the solver lives on this side of the await.
  registerPhysics();
  overlay = buildOverlay();
  updateSpringVisual();
  updateBallLabel();

  status.dataset["backend"] = app.renderer?.capabilities.backend ?? "none";
  status.dataset["solver"] = world.adapter.name;
  status.dataset["fallbacks"] = String(fallbacks.length);
  status.dataset["rejections"] = String(solverRejections.length);
  // Read off the world rather than typed in: `size` is its registered-body
  // count and `jointCount` its §28 joints, so the numbers the browser gate
  // checks cannot drift from what was actually registered.
  status.dataset["bodies"] = String(world.size);
  status.dataset["joints"] = String(world.jointCount);

  app.start();
  requestAnimationFrame(frame);
}

main().catch((error: unknown) => {
  status.dataset["state"] = "error";
  status.textContent = "failed to start — see the console";
  console.error("fourJS flagship: failed to start.", error);
});
