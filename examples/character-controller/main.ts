/**
 * fourJS — the §12 character-controller example: a first-person walk through
 * a small arena, exercising the whole §12 controller family at once.
 *
 * `PH-11` (2026-08-21) shipped `CharacterController` + `FirstPersonLook` in
 * `@fourjs/motion` and `PH-11b` shipped `SweptCharacterController` +
 * `SweptCharacterSystem` in `@fourjs/physics`, and until this page the only
 * first-person camera and the only swept capsule in the repository lived in
 * tests. This example is the recorded follow-up: one page that exercises all
 * three components and the §39 ordering they depend on.
 *
 * ## What you steer (§12, §30, §42, §44)
 *
 * | thing | component | what it shows |
 * | ----- | --------- | ------------- |
 * | **you** | `SweptCharacterController` (`@fourjs/physics`) | a capsule swept through `PhysicsWorld.shapeCast` (§30): walls stop you by *sliding* you along them, three stair risers are climbed by the step-up (each under its `stepHeight`), jumping and landing are casts, not a plane |
 * | **your eye** | `FirstPersonLook` on a **child** node | §44's first-person decomposition: the character owns yaw (its heading), the eye adds pitch and nothing else, and the camera's world orientation is `yaw ∘ pitch` by ordinary parent-child composition — two nodes, one §42 writer each |
 * | **the patroller** | `CharacterController` (`@fourjs/motion`) | the plane-tier kinematic controller, walking a circle with **no physics body and no world**: its ground is `groundHeight`, its driver is two lines of intent per step, and it needs nothing from the solver |
 * | **the balls** | `RigidBody` (`"dynamic"`) | ordinary §22 dynamics in the same world your capsule sweeps through — they fall, bounce and settle, and your kinematic-position body is real geometry to them |
 *
 * ## Controls
 *
 * WASD moves (intent clamped to the unit disc, so diagonals are not faster);
 * ←/→ turn the character (yaw); ↑/↓ pitch the eye; **drag** the canvas for
 * mouse-look; Space jumps. The arrows apply a fixed radians-per-second rate
 * inside the fixed step, the drag applies the deltas the pointer produced —
 * both are legal because `turn`/`look` take deltas the application chose
 * (the recorded no-rate-limit decision in `character-controller.ts`).
 *
 * ## The §39 ordering, spelled out
 *
 * Four registered systems, in priority order, all inside one fixed step:
 *
 * ```text
 * 100  ControlSystem          keys → intent, turn, look        (§39 step 1)
 * 200  PatrolSystem           the NPC's scripted intent        (§39 step 2)
 * 400  KinematicSystem        advances the NPC and the eye     (§39 step 4)
 * 400  SweptCharacterSystem   sweeps and writes the player     (§39 step 4)
 * 600  PhysicsSystem          steps the Rapier world           (§39 step 6)
 * ```
 *
 * The two step-4 systems share a priority on purpose: they dispatch on
 * disjoint component types, which is the arrangement `PH-11b` recorded
 * (`swept-character-controller.ts`, "One authority, and the second system this
 * could not avoid"). The player writes **before** the solve because its
 * `"kinematic-position"` `RigidBody` is fed from the node transform at the top
 * of `world.step` — write after 600 and the capsule the balls collide with
 * would trail the pose you see by one full step.
 *
 * ## What the browser gate reads
 *
 * The page mirrors the engine's own account of the character onto `#status`
 * (`data-px/py/pz`, `data-grounded`, `data-yaw`, `data-pitch`,
 * `data-stepups`, `data-npcx/npcz`), the pattern every example gate here uses:
 * the attribute says what the simulation believes, the pixels say what reached
 * the screen, and `tests/browser/character-controller.spec.ts` asserts both.
 *
 * ## Numbers that must agree
 *
 * The stair risers are **0.24** and the controller's `stepHeight` is **0.32**:
 * every riser is climbable without jumping, and the browser gate asserts the
 * platform height (`0.72` = three risers) is reached with ≥ 3 accepted
 * step-ups. The capsule is §24's parameterization — total height
 * `2 · (halfHeight + radius)` = 1.7 m — and the collider registered for the
 * player is built from the same two numbers as the controller, so the shape
 * the balls hit and the shape the sweeps cast are the same shape.
 */

import { Application } from "fourJS/application";
import {
  boxGeometry,
  capsuleGeometry,
  sphereGeometry,
  type BufferGeometry,
} from "fourJS/geometry";
import { LitMaterial } from "fourJS/materials";
import { Vector3 } from "fourJS/math";
import {
  CharacterController,
  FirstPersonLook,
  KinematicSystem,
  PRIORITY_COMMANDS,
  PRIORITY_INPUT,
  type FixedUpdateContext,
  type SimulationSystem,
} from "fourJS/motion";
import {
  Collider,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
  SweptCharacterController,
  SweptCharacterSystem,
} from "fourJS/physics";
import { Rapier3dAdapter } from "fourJS/physics-rapier";
import { Renderable } from "fourJS/render";
import { WebglRenderer } from "fourJS/render-webgl";
import { KeyboardState } from "fourJS/input";
import {
  DirectionalLight,
  Group,
  PerspectiveCamera,
  createFullscreenViewport,
} from "fourJS/scene";

// --- surface -----------------------------------------------------------------

/**
 * Resolves one required element of the page — `physics-playground`'s helper,
 * for its reason: the status element is touched from inside callbacks, and
 * TypeScript does not carry a module-level narrowing into a closure.
 */
function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(
      `fourJS character example: no ${selector} in the document.`,
    );
  }
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#scene");
const status = requireElement<HTMLParagraphElement>("#status");

/** Layout size in CSS pixels; the drawing buffer is this times the DPR. */
const WIDTH = 960;
const HEIGHT = 540;

// --- the player's capsule and tuning (§12, §24) ------------------------------

/** Radius of the player's capsule, in metres (§24). */
const PLAYER_RADIUS = 0.35;

/**
 * Half the capsule's **cylindrical** section (§24's parameterization), so the
 * capsule's total height is `2 · (0.5 + 0.35)` = 1.7 m and its centre stands
 * 0.85 m above its feet.
 */
const PLAYER_HALF_HEIGHT = 0.5;

/** Where the capsule's centre sits when its feet are on the floor (top y = 0). */
const STANDING_CENTER_Y = PLAYER_HALF_HEIGHT + PLAYER_RADIUS;

/** Walking speed at full intent, in m/s. */
const MOVE_SPEED = 3.5;

/** Upward speed a jump imparts, in m/s — ≈ 1.03 m of rise under −9.81. */
const JUMP_SPEED = 4.5;

/**
 * Largest riser the player climbs without jumping, in metres. Deliberately
 * **above** {@link STAIR_RISE} and stated next to it: the stairs are climbable
 * because 0.24 < 0.32, and if either number moves the browser gate's platform
 * assertion says so.
 */
const STEP_HEIGHT = 0.32;

/** Steepest walkable ground, in radians (§7a) — the genre's 45°. */
const SLOPE_LIMIT = Math.PI / 4;

/** The eye's height above the capsule's centre — eye level ≈ 1.4 m standing. */
const EYE_LOCAL_Y = 0.55;

/** Where the player starts: on the floor, four and a half metres before the stairs. */
const SPAWN = new Vector3(0, STANDING_CENTER_Y + 0.1, 4.5);

// --- input rates -------------------------------------------------------------

/** Yaw rate while ← or → is held, in rad/s — a quarter turn in ~1 s. */
const TURN_RATE = 1.6;

/** Pitch rate while ↑ or ↓ is held, in rad/s. */
const LOOK_RATE = 1.1;

/** Radians of yaw/pitch per CSS pixel of pointer drag. */
const DRAG_LOOK_GAIN = 0.005;

// --- the patroller (§12's plane tier) ----------------------------------------

/** The NPC's walking speed, in m/s. */
const NPC_SPEED = 1.2;

/**
 * The NPC's constant turn rate, in rad/s. Full intent at {@link NPC_SPEED}
 * under a constant turn walks a circle of radius `v / ω` ≈ 1.33 m.
 */
const NPC_TURN_RATE = 0.9;

/** Centre of the patrol, west of the stair corridor. */
const NPC_START = new Vector3(-4, STANDING_CENTER_Y, 3);

// --- the arena, in world units (§7a: +Y up, −Z into the screen) --------------

/** Inner faces of the four walls: x ∈ ±7, z ∈ [−3.5, 6.5]. Floor top is y = 0. */
const ARENA_HALF_X = 7;
const ARENA_MIN_Z = -3.5;
const ARENA_MAX_Z = 6.5;

/** Wall half-thickness and half-height (walls run from y = 0 to y = 3). */
const WALL_HALF_THICKNESS = 0.25;
const WALL_HALF_HEIGHT = 1.5;

/** Height of each stair riser, in metres — see {@link STEP_HEIGHT}. */
const STAIR_RISE = 0.24;

/** Half-width of the stair corridor on X. */
const STAIR_HALF_WIDTH = 1.4;

/** Half-depth of one tread on Z. */
const STAIR_HALF_DEPTH = 0.35;

/** Front face of the first riser — where the climb begins. */
const STAIR_FRONT_Z = 1.35;

/** Top of the landing the three risers reach: `3 × 0.24`. */
const PLATFORM_TOP_Y = 3 * STAIR_RISE;

// --- palette (first-3d-scene's discipline: hue is the classifier) ------------

/** Straight RGBA in 0…1 (§60a). */
type Color = readonly [number, number, number, number];

/** The floor: near-neutral grey, bright enough to show it is lit from above. */
const FLOOR_COLOR: Color = [0.17, 0.175, 0.19, 1];

/** The walls: darker slate, so the arena's bounds read as bounds. */
const WALL_COLOR: Color = [0.13, 0.14, 0.17, 1];

/** The stairs and platform: warm, the eye-catcher straight ahead of spawn. */
const STAIR_COLOR: Color = [0.85, 0.48, 0.2, 1];

/** The patroller: green, no other surface leads with green. */
const NPC_COLOR: Color = [0.24, 0.85, 0.42, 1];

/** The dynamic balls: violet, blue leading red along the whole shading ramp. */
const BALL_COLOR: Color = [0.52, 0.44, 0.95, 1];

// --- camera: the eye (§44, §47) ----------------------------------------------

/** Full vertical field of view, in radians (§7a) — 60°. */
const FIELD_OF_VIEW = Math.PI / 3;

const eye = new PerspectiveCamera({
  fieldOfView: FIELD_OF_VIEW,
  aspect: WIDTH / HEIGHT,
  near: 0.1,
  far: 100,
});
eye.name = "eye";
eye.transform.position.set(0, EYE_LOCAL_Y, 0);
// §42: the eye's local rotation is written by `FirstPersonLook` under the
// `"kinematic"` authority — its own node's, distinct from the player's.
eye.transformAuthority = "kinematic";
const look = eye.addComponent(new FirstPersonLook());
eye.updateProjectionMatrix();

const view = createFullscreenViewport(eye);
view.clearColor = [0.045, 0.05, 0.075, 1];

// --- application (§45) -------------------------------------------------------

const renderer = new WebglRenderer();
const app = new Application({
  renderer,
  canvas,
  views: [view],
  // Spelled out for the playground's reason: the solver and the controllers
  // advance at fixed 1/60 s steps while the display draws at its own rate from
  // §43-interpolated poses.
  poseInterpolation: true,
});
renderer.resize(WIDTH, HEIGHT, window.devicePixelRatio);

// --- the world (§21, §37) ----------------------------------------------------

// One `"3d"` world over a directly-constructed Rapier adapter — the
// motor-digital-twin's arrangement, and half the flagship's payload: one wasm
// image, not two, because this page needs no §37 registry and no 2D solver.
const world = new PhysicsWorld({
  dimension: "3d",
  adapter: new Rapier3dAdapter(),
  poses: app.poses,
});
const physics = new PhysicsSystem({ worlds: [world] });

// --- the player: a swept capsule with an eye on top (§12, §30, §42) ----------

const player = new Group();
player.name = "player";
player.transform.position.copy(SPAWN);
// §42: the swept controller prescribes this node's pose ("kinematic", even
// though it consults the solver — every query is a read; see the module note
// in swept-character-controller.ts).
player.transformAuthority = "kinematic";
// The player is real geometry to the dynamic bodies: a kinematic-position
// body whose pose is fed from this node at the top of every `world.step` —
// which is the §39 reason the character systems run *before* the solve.
player.addComponent(new RigidBody({ type: "kinematic-position" }));
player.addComponent(
  new Collider({
    shape: {
      type: "capsule",
      radius: PLAYER_RADIUS,
      halfHeight: PLAYER_HALF_HEIGHT,
    },
  }),
);
const controller = player.addComponent(
  new SweptCharacterController({
    world,
    radius: PLAYER_RADIUS,
    halfHeight: PLAYER_HALF_HEIGHT,
    moveSpeed: MOVE_SPEED,
    jumpSpeed: JUMP_SPEED,
    stepHeight: STEP_HEIGHT,
    slopeLimit: SLOPE_LIMIT,
  }),
);
// The eye rides the player: world orientation = player yaw ∘ eye pitch.
player.add(eye);
app.scene.add(player);

// --- the patroller: the plane-tier controller (§12) --------------------------

const npc = new Group();
npc.name = "patroller";
npc.transform.position.copy(NPC_START);
npc.transformAuthority = "kinematic";
const npcController = npc.addComponent(
  new CharacterController({
    moveSpeed: NPC_SPEED,
    // Its ground is a *plane* at the height its capsule centre stands — the
    // whole point of the plane tier: no world, no body, no query.
    groundHeight: STANDING_CENTER_Y,
    grounded: true,
  }),
);
// What the patroller looks like — a child mesh, so the controller writes the
// group and the drawing rides along.
const npcMesh = new Renderable(
  capsuleGeometry({
    radius: PLAYER_RADIUS,
    height: PLAYER_HALF_HEIGHT * 2,
    radialSegments: 24,
    capSegments: 8,
  }),
  new LitMaterial({ color: NPC_COLOR }),
);
npcMesh.name = "patroller-mesh";
npc.add(npcMesh);
app.scene.add(npc);

// --- systems (§39) -----------------------------------------------------------

const kinematics = new KinematicSystem();
kinematics.track(npc); // CharacterController
kinematics.track(eye); // FirstPersonLook

const characters = new SweptCharacterSystem();
characters.track(player);

/**
 * §39 step 1: sample the held keys into the controllers' intent surface.
 *
 * Key state comes from `@fourjs/input`'s {@link KeyboardState}, which owns the
 * two DOM listeners and clears itself on `blur`. This example kept its own
 * `Set` until 2026-09-07 — correctly, blur handler and all. That is exactly why
 * the helper now exists: the code was right and every consumer still had to
 * write it, so the ones that forgot the `blur` half walked forever after an
 * alt-tab. Deleting a correct copy is the point.
 *
 * This system *reads* that state once per fixed step, so a turn held across
 * three steps turns three steps' worth — the rate lives here, in rad/s × the
 * injected fixed delta, never in the event handler.
 */
class ControlSystem implements SimulationSystem {
  priority = PRIORITY_INPUT;

  /** Physical keys held right now, cleared automatically on focus loss. */
  readonly keys = new KeyboardState(window);

  initialize(): void {
    // Intentionally empty: `KeyboardState` owns the listeners.
  }

  fixedUpdate(context: FixedUpdateContext): void {
    const dt = context.time.fixedDeltaTime;
    const held = this.keys;
    const forward =
      (held.isDown("KeyW") ? 1 : 0) - (held.isDown("KeyS") ? 1 : 0);
    const right = (held.isDown("KeyD") ? 1 : 0) - (held.isDown("KeyA") ? 1 : 0);
    controller.setMoveIntent(forward, right);
    // ← is +yaw and → is −yaw: yaw is measured from +Z towards +X (§7a), so a
    // negative delta swings the forward axis towards the character's right —
    // the same sign the drag handler and the doc example use.
    const turn =
      (held.isDown("ArrowLeft") ? 1 : 0) - (held.isDown("ArrowRight") ? 1 : 0);
    if (turn !== 0) {
      controller.turn(turn * TURN_RATE * dt);
    }
    const pitch =
      (held.isDown("ArrowUp") ? 1 : 0) - (held.isDown("ArrowDown") ? 1 : 0);
    if (pitch !== 0) {
      look.look(pitch * LOOK_RATE * dt);
    }
  }

  dispose(): void {
    this.keys.dispose();
  }
}

/**
 * §39 step 2: the patroller's two-line brain. Full forward intent under a
 * constant turn is a circle; the intent is a *state*, so setting it every step
 * is idempotent and stopping the system stops the walk.
 */
class PatrolSystem implements SimulationSystem {
  priority = PRIORITY_COMMANDS;

  initialize(): void {
    npcController.setMoveIntent(1, 0);
  }

  fixedUpdate(context: FixedUpdateContext): void {
    npcController.turn(NPC_TURN_RATE * context.time.fixedDeltaTime);
  }

  dispose(): void {
    npcController.stop();
  }
}

const controls = new ControlSystem();
app.systems.register(controls); // 100
app.systems.register(new PatrolSystem()); // 200
app.systems.register(kinematics); // 400
app.systems.register(characters); // 400, disjoint component types
app.systems.register(physics); // 600

// The kinematic movers are §43-interpolated exactly as the dynamic bodies are
// (the world tracks those itself through `poses: app.poses`).
app.poses.track(player);
app.poses.track(eye);
app.poses.track(npc);

// --- DOM input: keys and drag-look -------------------------------------------

window.addEventListener("keydown", (event) => {
  // Space is an *edge*, not a state: `jump()` answers "can I jump right now?"
  // itself, so a held or repeated Space simply keeps asking and keeps being
  // told no until the character lands.
  if (event.code === "Space") {
    controller.jump();
    event.preventDefault();
    return;
  }
  if (event.code.startsWith("Arrow")) {
    event.preventDefault();
  }
});
// No `keyup` or `blur` listener here any more: `KeyboardState` registers both,
// including the release-everything-on-blur that keeps a backgrounded tab from
// walking into a wall forever. The `keydown` listener above stays because it
// does two things state cannot: Space is an EDGE (`jump()` answers "can I?"
// itself) and the arrows need `preventDefault` so the page does not scroll.

// Drag-look: yaw to the character, pitch to the eye — the exact split the
// component doc-comment shows, with the platform's downward-positive deltas
// negated into §7a's conventions.
canvas.addEventListener("pointermove", (event) => {
  if (event.buttons === 0) {
    return;
  }
  controller.turn(-event.movementX * DRAG_LOOK_GAIN);
  look.look(-event.movementY * DRAG_LOOK_GAIN);
});

// --- the arena ---------------------------------------------------------------

/** Adds one immovable lit box: a §24 collider and the mesh drawn for it. */
function addStaticBox(
  name: string,
  center: Vector3,
  halfExtents: Vector3,
  color: Color,
): void {
  const geometry: BufferGeometry = boxGeometry({
    width: halfExtents.x * 2,
    height: halfExtents.y * 2,
    depth: halfExtents.z * 2,
  });
  const node = new Renderable(geometry, new LitMaterial({ color }));
  node.name = name;
  node.transform.position.copy(center);
  node.addComponent(new RigidBody({ type: "static" }));
  node.addComponent(
    new Collider({ shape: { type: "box", halfExtents: halfExtents.clone() } }),
  );
  app.scene.add(node);
  world.addBody(node);
}

/** Adds one dynamic ball to the world the player sweeps through. */
function addBall(name: string, center: Vector3, radius: number): void {
  const node = new Renderable(
    sphereGeometry({ radius, widthSegments: 32, heightSegments: 16 }),
    new LitMaterial({ color: BALL_COLOR }),
  );
  node.name = name;
  node.transform.position.copy(center);
  node.transformAuthority = "physics";
  node.addComponent(new RigidBody({ type: "dynamic" }));
  node.addComponent(
    new Collider({ shape: { type: "sphere", radius }, restitution: 0.4 }),
  );
  app.scene.add(node);
  world.addBody(node);
}

/**
 * Builds the arena into the live world. Called after `world.initialize()`,
 * because `addBody` registers into a live solver (the playground's rule).
 */
function buildArena(): void {
  const midZ = (ARENA_MIN_Z + ARENA_MAX_Z) / 2;
  const halfZ = (ARENA_MAX_Z - ARENA_MIN_Z) / 2;

  // The floor: top surface exactly at y = 0, the datum every height above is
  // measured from — and generous enough that nothing walks off its edge.
  addStaticBox(
    "floor",
    new Vector3(0, -0.5, midZ),
    new Vector3(ARENA_HALF_X + 0.5, 0.5, halfZ + 0.5),
    FLOOR_COLOR,
  );

  // The four walls. The player slides along them (§30's collide-and-slide),
  // and the north wall is what the browser gate walks into to prove a blocked
  // character stops instead of tunnelling.
  addStaticBox(
    "wall-north",
    new Vector3(0, WALL_HALF_HEIGHT, ARENA_MIN_Z - WALL_HALF_THICKNESS),
    new Vector3(ARENA_HALF_X + 0.5, WALL_HALF_HEIGHT, WALL_HALF_THICKNESS),
    WALL_COLOR,
  );
  addStaticBox(
    "wall-south",
    new Vector3(0, WALL_HALF_HEIGHT, ARENA_MAX_Z + WALL_HALF_THICKNESS),
    new Vector3(ARENA_HALF_X + 0.5, WALL_HALF_HEIGHT, WALL_HALF_THICKNESS),
    WALL_COLOR,
  );
  addStaticBox(
    "wall-west",
    new Vector3(-ARENA_HALF_X - WALL_HALF_THICKNESS, WALL_HALF_HEIGHT, midZ),
    new Vector3(WALL_HALF_THICKNESS, WALL_HALF_HEIGHT, halfZ),
    WALL_COLOR,
  );
  addStaticBox(
    "wall-east",
    new Vector3(ARENA_HALF_X + WALL_HALF_THICKNESS, WALL_HALF_HEIGHT, midZ),
    new Vector3(WALL_HALF_THICKNESS, WALL_HALF_HEIGHT, halfZ),
    WALL_COLOR,
  );

  // Three risers and a landing, straight ahead of spawn. Each tread's top is
  // `n × STAIR_RISE`; each box's half-height is half that, its centre half
  // that again — the boxes stand on the floor, not float.
  for (let n = 1; n <= 3; n += 1) {
    const top = n * STAIR_RISE;
    addStaticBox(
      `stair-${String(n)}`,
      new Vector3(
        0,
        top / 2,
        STAIR_FRONT_Z - STAIR_HALF_DEPTH - (n - 1) * STAIR_HALF_DEPTH * 2,
      ),
      new Vector3(STAIR_HALF_WIDTH, top / 2, STAIR_HALF_DEPTH),
      STAIR_COLOR,
    );
  }
  // The landing runs from the last tread to the north wall, so a climbed
  // character can be walked into the wall without ever stepping down.
  const platformMinZ = ARENA_MIN_Z;
  const platformMaxZ = STAIR_FRONT_Z - 6 * STAIR_HALF_DEPTH;
  addStaticBox(
    "platform",
    new Vector3(0, PLATFORM_TOP_Y / 2, (platformMinZ + platformMaxZ) / 2),
    new Vector3(
      STAIR_HALF_WIDTH,
      PLATFORM_TOP_Y / 2,
      (platformMaxZ - platformMinZ) / 2,
    ),
    STAIR_COLOR,
  );

  // Two dynamic balls east of the corridor: §22 dynamics in the same world,
  // settling in view of the spawn.
  addBall("ball-near", new Vector3(4.2, 1.6, 3.2), 0.3);
  addBall("ball-far", new Vector3(4.7, 2.6, 2.4), 0.35);
}

// --- light (§68) — first-3d-scene's key-light recipe -------------------------

app.scene.ambientLight[0] = 0.16;
app.scene.ambientLight[1] = 0.17;
app.scene.ambientLight[2] = 0.21;

const sun = new DirectionalLight({ color: [1, 0.96, 0.9], intensity: 1.2 });
sun.name = "sun";
sun.transform.position.set(-6, 9, 7);
sun.lookAt(new Vector3(0, 0, 0));
app.scene.add(sun);

// --- what the page publishes -------------------------------------------------

/** Frames rendered since the loop started; mirrored onto `#status`. */
let frameCount = 0;

/**
 * Mirrors the character's state onto `#status`, once per host frame — the
 * repository's gate pattern: the engine's own account beside the pixels.
 */
function publish(): void {
  const position = player.transform.position;
  status.dataset["px"] = position.x.toFixed(3);
  status.dataset["py"] = position.y.toFixed(3);
  status.dataset["pz"] = position.z.toFixed(3);
  status.dataset["grounded"] = String(controller.grounded);
  status.dataset["yaw"] = controller.yaw.toFixed(4);
  status.dataset["pitch"] = look.pitch.toFixed(4);
  status.dataset["stepups"] = String(controller.stepUpCount);
  status.dataset["slides"] = String(controller.slideCount);
  status.dataset["npcx"] = npc.transform.position.x.toFixed(3);
  status.dataset["npcz"] = npc.transform.position.z.toFixed(3);
  status.dataset["frames"] = String(frameCount);
}

app.on("update", () => {
  frameCount += 1;
  publish();
});

// --- the frame loop ----------------------------------------------------------

/** Seeded from the FIRST rAF timestamp — WP-3.7-fix1's negative-delta rule. */
let last: number | null = null;

function frame(now: number): void {
  if (last !== null) {
    app.step((now - last) / 1000);
  }
  last = now;
  requestAnimationFrame(frame);
}

const LOADING_TEXT = "loading physics (WebAssembly solver)…";
const RUNNING_TEXT =
  "WASD walks, ←/→ turn, ↑/↓ and dragging look, Space jumps. The stairs " +
  "ahead are climbed by the swept controller's step-up; the walls slide you; " +
  "the green capsule is a plane-tier CharacterController on patrol.";

async function main(): Promise<void> {
  status.textContent = LOADING_TEXT;
  status.dataset["state"] = "loading";

  await app.initialize();
  // Decodes the one wasm image (§37 allows `initialize` to be async for this).
  await world.initialize();

  buildArena();

  status.textContent = RUNNING_TEXT;
  status.dataset["state"] = "running";

  app.start();
  requestAnimationFrame(frame);
}

main().catch((error: unknown) => {
  status.textContent =
    "fourJS character example: failed to start — see the console.";
  status.dataset["state"] = "error";
  console.error("fourJS character example: failed to start.", error);
});
