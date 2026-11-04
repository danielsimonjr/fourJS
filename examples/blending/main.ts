/**
 * fourJS — the blending example, and the §110 demonstration.
 *
 * §110 asks that
 *
 * > a character or machine can move between animated, kinematic, and physical
 * > control without abrupt discontinuities.
 *
 * This page is one articulated chain that does exactly that, on a click:
 *
 * | mode           | who owns the pose                                                                                       |
 * | -------------- | ------------------------------------------------------------------------------------------------------- |
 * | **ANIMATED**   | a looping clip drives each link's `PoseTarget`; the links are `"kinematic-position"`, animation weight 1 |
 * | **RAGDOLL**    | `setBodyControlMode("dynamic", { inheritVelocityFrom })` hands the chain to Rapier, physics weight 1      |
 * | **RECOVERING** | the two §19 weights sweep back over 1.5 s, then the links are re-typed kinematic and the wave resumes     |
 *
 * Every pose you see is the **output of §19's blend**: `lerp`/`slerp` between the
 * pose the animation asked for and the pose the solver produced, weighted by the
 * `RigidBody`'s `animationWeight` / `physicsWeight` and written by the world
 * under the `"blended"` transform authority (§42). Nothing in this file ever
 * writes a link's transform.
 *
 * ## The §19 pipeline, and the one system an application must register
 *
 * Three systems run per fixed step, in §39 priority order regardless of the
 * order they are registered in:
 *
 * ```text
 * 299  createPoseTargetCaptureSystem(physics.worlds)   §19 history: previous ← current
 * 300  AnimationSystem                                 the mixers write PoseTargets
 * 600  PhysicsSystem                                   feed targets → solve → publish blend
 * ```
 *
 * The capture system is **not** registered by `Application`, and it is not
 * optional here: `setBodyControlMode`'s velocity inheritance finite-differences
 * `PoseTarget.position` against `PoseTarget.previousPosition` over one fixed
 * step, and without the capture that history never moves — the switch would
 * divide the target's *total* animated displacement by one fixed delta and
 * inherit an absurd velocity (measured at 60 m/s from a 2 m/s animation,
 * WP-7.5). One line, and the ragdoll activation is honest.
 *
 * ## What the click actually does, step by step
 *
 * ```text
 * ANIMATED ──click──▶ RAGDOLL ──click──▶ RECOVERING ──1.5 s──▶ ANIMATED  (+1 cycle)
 *
 * ANIMATED    type kinematic-position   weights 0 / 1   the solver is fed the target
 * RAGDOLL     type dynamic              weights 1 / 0   the solver owns the chain
 * RECOVERING  type dynamic              weights 1−w / w   w = i/90, one notch per step
 *             …then type kinematic-position, weights 0 / 1
 * ```
 *
 * Two details are load-bearing, and both are WP-7.5's:
 *
 * - **Both** weights are written during the sweep (`1 − w` and `w`), not just
 *   the animation one: `normalizedWeights` divides by their sum, so leaving
 *   `physicsWeight` at 1 would ramp the published animation share as
 *   `w / (1 + w)` — only ½ at `w = 1`. Writing both makes the published share
 *   exactly `w`, and the per-step weight change exactly `1/90`.
 * - The re-type to `"kinematic-position"` happens **after** a step that already
 *   published at full animation weight. At that point the node has been
 *   following the target alone for a step, so re-typing teleports the *solver
 *   body* onto the target and cannot move the node at all. That ordering is the
 *   whole reason the sweep comes first, and it is what makes the second switch
 *   continuous rather than a scripted snap.
 *
 * ## Where this deviates from WP-7.5's integration rig (and what it costs)
 *
 * The integration suite re-seeds each `PoseTarget` from the pose the ragdoll
 * landed in before sweeping, so the crossfade is short by construction. This
 * page deliberately does **not**: the wave keeps playing all the way through the
 * ragdoll (at animation weight 0 it is invisible, but it is running), so the
 * chain blends from where it fell back onto a wave that never stopped — the
 * get-up is a genuine metres-wide crossfade, and you can watch it happen against
 * the target ghosts. The cost is a larger per-step displacement during the
 * sweep, bounded by `gap / 90 + the wave's own speed`; it is measured, and it is
 * the largest number the page reports (`data-step`).
 *
 * ## The wave is a real clip, sampled from forward kinematics
 *
 * Each link's target is driven by an `AnimationMixer` playing a looping
 * `AnimationClip` with a `position` and a `rotation` track — the ordinary §16/§17
 * path, aimed at a `PoseTarget` instead of a transform (which is the only thing
 * §19 changes about animating something). The keys are sampled from the closed
 * form
 *
 * ```text
 * aᵢ(t) = BASE_ANGLE + AMPLITUDE · sin(ωt − i · PHASE_LAG)      ω = 2π / PERIOD
 * p₀ = anchor,  pᵢ₊₁ = pᵢ + 2·halfLength·(sin aᵢ, −cos aᵢ)
 * ```
 *
 * — i.e. the chain's own forward kinematics, so **every hinge is exactly
 * satisfied at every key**. A link's node origin is its *proximal joint*, not its
 * centre (the collider is pushed one half-length down by its §24 offset), which
 * is what makes that true: rotating a link about its own origin is a pure
 * rotation, and WP-7.5's door showed what the alternative costs — a centre-origin
 * rig animated along a chord violates its own hinge by millimetres, and a
 * solver-corrected millimetre is exactly the kind of jump §110 is asking about.
 *
 * The one place the rig is not exact is *between* keys: a `position` track
 * interpolates linearly along the chord while the `rotation` track slerps, so a
 * mid-key pose sits inside the arc by `r · Δa² / 8`. At 48 keys per 3.6 s period
 * and this amplitude that is under 0.3 mm, which is why the key count is 48 and
 * not 8.
 *
 * ## Colour discipline (§66: no blending in this tier, so hue is the channel)
 *
 * The playground's and the mechanism's rule, restated for a scene that has to
 * show *two* poses of the same body at once:
 *
 * 1. everything static or scenery is dark and near-neutral — max channel < 0.2,
 *    and no channel differs from another by more than 0.04;
 * 2. every link is bright — max channel > 0.94 — and any two links differ by at
 *    least 0.35 in some channel;
 * 3. a link's **target ghost** is that link's own colour at
 *    {@link GHOST_BRIGHTNESS} — same hue, so it is obvious *whose* target it is;
 *    0.6, so it differs from its own link by at least 0.35 in some channel, and
 *    from every scenery colour by at least 0.35 in some channel too. The ghosts
 *    are the one moving thing that is not bright, and a classifier separates the
 *    two tiers by max channel alone (bodies > 0.94, ghosts < 0.6);
 * 4. the three mode colours the plate switches between differ pairwise by at
 *    least 0.5 in **two** channels, so "the mode changed" survives any
 *    reasonable threshold — and each of them differs from every link and ghost
 *    colour by at least 0.35 in some channel, because the plate and the chain
 *    share a frame.
 *
 * The background is the one deliberate exception to rule 1's separability: it is
 * darker than the scenery (13,15,23 against 48,48,48 and 31,31,33 as framebuffer
 * bytes) but not by 0.35, and nothing measured needs to tell the backdrop from
 * the floor.
 *
 * ## Known approximations and honest limitations
 *
 * - **Velocity inheritance is redundant on this solver, and is passed anyway.**
 *   WP-7.5 measured it: a Rapier `"kinematic-position"` body that is being driven
 *   to per-step targets already carries the velocity Rapier derived from those
 *   targets, and `setBodyType` keeps it, so `inheritVelocityFrom` and no flag at
 *   all travel the same distance to within 2e-6 m. §19's finite difference and
 *   Rapier's own derivation agree; the flag is passed because it is the API's
 *   documented way to say "keep the motion the animation had", and because
 *   another solver — or a target driven by something other than a kinematic
 *   body — would need it.
 * - **The anchor block carries no collider.** It is a `"static"` body because a
 *   joint's fixed side is a body, not a point (§28); nothing should ever contact
 *   it, and giving it contact geometry would let the falling chain slap into it.
 * - **The ghosts are drawn, not simulated.** They are plain scene nodes with no
 *   components, whose transform this file copies from each `PoseTarget` once per
 *   frame. They are narrower than the links and drawn behind them, so while the
 *   chain is animated they are exactly hidden — the ghosts appear precisely when
 *   the pose and the target diverge, which is the only time they mean anything.
 * - **No transparency.** This renderer tier enables `GL_BLEND` for sprites only
 *   (finding, WP-4.7), so overlap is resolved by depth alone: bodies sit at
 *   z = 0 as §21 requires, ghosts and scenery are pushed behind them, and the
 *   plate's mark in front of the plate.
 * - **Sleeping is left on** (§32, unlike `examples/mechanism`). A settled ragdoll
 *   that Rapier puts to sleep is a feature here — it stops jittering on the floor
 *   — and every transition out of that state goes through `setBodyControlMode`,
 *   which wakes the body by default.
 */

import {
  AnimationClip,
  AnimationMixer,
  AnimationSystem,
  AnimationTrack,
  quaternionAdapter,
  vector3Adapter,
  type AnimationTrackLike,
} from "fourJS/animation";
import { Application } from "fourJS/application";
import { circleGeometry2D, planeGeometry } from "fourJS/geometry";
import { PointerInput, type Pickable } from "fourJS/input";
import { UnlitMaterial } from "fourJS/materials";
import { Quaternion, Vector2, Vector3 } from "fourJS/math";
import {
  Collider,
  HingeJoint,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
  createPoseTargetCaptureSystem,
} from "fourJS/physics";
import { Rapier2dAdapter } from "fourJS/physics-rapier";
import { Renderable } from "fourJS/render";
import { WebglRenderer } from "fourJS/render-webgl";
import {
  Group,
  OrthographicCamera,
  PoseTarget,
  createFullscreenViewport,
} from "fourJS/scene";

// --- surface -----------------------------------------------------------------

/**
 * Resolves one required element of the page.
 *
 * A function rather than a module-level `const` + guard because this file
 * touches the status element from inside hoisted function declarations, and
 * TypeScript does not carry a module-level narrowing into one of those (the
 * mechanism's reason, unchanged).
 */
function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`fourJS blending: no ${selector} in the document.`);
  }
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#scene");

/** The one line of page chrome: the loading state, then the instructions. */
const status = requireElement<HTMLParagraphElement>("#status");

/** Layout size in CSS pixels; the drawing buffer is this times the DPR. */
const WIDTH = 960;
const HEIGHT = 540;

// --- the view, in world units (§47, §48) -------------------------------------

/** Half-width of the camera's view: 16 world units across a 960 px canvas. */
const VIEW_HALF_WIDTH = 8;

/** Half-height of the camera's view. 16 × 9 units over a 16:9 canvas. */
const VIEW_HALF_HEIGHT = 4.5;

// --- the chain, in world units (§7a: +Y is up, metres, radians) --------------

/** How many links the chain has (WP-7.5's `LINK_COUNT`). */
const LINK_COUNT = 3;

/** Half the length of one link, in metres: the joint-to-joint distance is 2 ×. */
const LINK_HALF_LENGTH = 0.8;

/** Half the thickness of one link, in metres. */
const LINK_HALF_THICKNESS = 0.17;

/** Where the chain hangs from — the node origin of link 0, and never moves. */
const ANCHOR_X = -5.6;
const ANCHOR_Y = 1.8;

/** The static block drawn at the anchor. Carries no collider — see the header. */
const ANCHOR_BLOCK = 0.6;

/**
 * The top surface of the ground slab, in metres.
 *
 * 0.3 m **above** the lowest point a chain hanging straight down could reach
 * (`ANCHOR_Y − CHAIN_REACH = −3.0`), so the collapsed chain drapes against the
 * floor and rests there rather than swinging free forever. A slab the chain
 * could not reach would make the floor scenery; this one is a §24 collider the
 * ragdoll actually lands on.
 */
const GROUND_TOP = -2.7;

/** The ground slab: wider than the view, and thick enough to be unmissable. */
const GROUND_HALF_WIDTH = 8.2;
const GROUND_HALF_HEIGHT = 0.75;

// --- the wave (§16/§17 clips, sampled from the chain's forward kinematics) ----

/**
 * The angle every link is animated about, measured from the hanging direction.
 *
 * A rotation of `a` about +Z takes the link's own −Y axis to
 * `(sin a, −cos a)`, so `π/2` points the chain along **+X**: an articulated arm
 * held out horizontally, which is the pose a collapse is most visible from.
 */
const BASE_ANGLE = Math.PI / 2;

/** How far each link swings either side of {@link BASE_ANGLE}, in radians. */
const WAVE_AMPLITUDE = 0.18;

/** One full loop of the wave, in seconds (§7a: seconds, never milliseconds). */
const WAVE_PERIOD = 3.6;

/** Angular frequency of the wave, in rad/s. */
const WAVE_OMEGA = (2 * Math.PI) / WAVE_PERIOD;

/**
 * Phase lag between neighbouring links, in radians.
 *
 * Non-zero is what makes it a *travelling* wave rather than three links
 * swinging as one rigid bar — and it also keeps the links' angular velocities
 * out of phase, which halves the tip speed a fully-aligned chain would reach.
 */
const WAVE_PHASE_LAG = 1;

/**
 * Keys sampled per link per loop. See the module header for why 48: the
 * mid-key chord error is `r · Δa² / 8`, under 0.3 mm here.
 */
const WAVE_KEYS = 48;

// --- the mode cycle ----------------------------------------------------------

/** How long the §19 weight sweep back onto the animation takes, in seconds. */
const RECOVERY_SECONDS = 1.5;

/** The three control modes the plate cycles through, as `data-mode` reports them. */
type Mode = "animated" | "ragdoll" | "recovering";

// --- depth (§21 pins bodies to z = 0; scenery goes behind, marks in front) ---

/** The target ghosts, drawn behind the links whose targets they are. */
const GHOST_Z = -0.4;

/** The ground slab and the anchor block. */
const SCENERY_Z = -0.8;

/** The plate's mark, drawn in front of the plate it labels. */
const GLYPH_Z = 0.2;

// --- palette (see "Colour discipline" in the module header) ------------------

/** Straight (non-premultiplied) RGBA in 0…1 (§60a, §66). */
type Color = readonly [number, number, number, number];

/** The anchor block. Rule 1: dark and near-neutral. */
const ANCHOR_COLOR: Color = [0.12, 0.12, 0.13, 1];

/** The ground slab: lighter than the anchor, still rule 1. */
const GROUND_COLOR: Color = [0.19, 0.19, 0.19, 1];

/**
 * One colour per link, root to tip. Rule 2: max channel > 0.94, and pairwise
 * ≥ 0.35 apart (yellow↔sky 0.72 on red, yellow↔magenta 0.63 on blue,
 * sky↔magenta 0.69 on red).
 */
const LINK_COLORS: readonly Color[] = [
  [0.98, 0.88, 0.22, 1],
  [0.26, 0.72, 0.98, 1],
  [0.95, 0.35, 0.85, 1],
];

/**
 * How bright a link's target ghost is relative to the link. Rule 3: low enough
 * that the max channel separates the two tiers, high enough that every ghost
 * still differs from every scenery colour by ≥ 0.35 in some channel.
 */
const GHOST_BRIGHTNESS = 0.6;

/** The plate while the chain is animated: green. Rule 4. */
const MODE_ANIMATED_COLOR: Color = [0.2, 0.9, 0.35, 1];

/** The plate while the chain is a ragdoll: red (Δ 0.75 red, 0.65 green). */
const MODE_RAGDOLL_COLOR: Color = [0.95, 0.25, 0.3, 1];

/** The plate during the weight sweep: blue (Δ ≥ 0.55 in two channels from both). */
const MODE_RECOVERING_COLOR: Color = [0.35, 0.3, 0.98, 1];

/** The plate's mark: near-white, distinct from every colour above. */
const GLYPH_COLOR: Color = [0.92, 0.94, 0.98, 1];

/** The page background, and the viewport's clear colour. */
const CLEAR_COLOR: Color = [0.05, 0.06, 0.09, 1];

// --- the control plate, in world units ---------------------------------------

/** The one click plate. Far from the chain's reach, so the two never overlap. */
const MODE_PLATE = { x: 4.6, y: 3.2, width: 2.2, height: 1 };

/** Radius of the disc drawn on the plate. */
const GLYPH_RADIUS = 0.22;

// --- camera and application (§45, §47) ---------------------------------------

// 16 × 9 world units over a 16:9 canvas: 60 CSS pixels per world unit, and no
// stretch — `px = (x + 8) × 60`, `py = (4.5 − y) × 60`. +Y is up here exactly as
// it is in the physics world (§7a).
const camera = new OrthographicCamera({
  left: -VIEW_HALF_WIDTH,
  right: VIEW_HALF_WIDTH,
  bottom: -VIEW_HALF_HEIGHT,
  top: VIEW_HALF_HEIGHT,
  near: 0.1,
  far: 100,
});
camera.transform.position.set(0, 0, 20);
camera.updateProjectionMatrix();

const view = createFullscreenViewport(camera);
// Matches the page background, so the canvas has no visible edge. Copied
// component-wise because a §48 viewport owns a mutable clear colour and the
// palette above is `readonly` (the copy is what keeps both true).
view.clearColor = [
  CLEAR_COLOR[0],
  CLEAR_COLOR[1],
  CLEAR_COLOR[2],
  CLEAR_COLOR[3],
];

const renderer = new WebglRenderer();
const app = new Application({
  renderer,
  canvas,
  views: [view],
  // The default with a renderer, spelled out because the arrangement below
  // depends on it: the solver steps at a fixed 1/60 s while the display draws
  // at its own rate from §43-interpolated poses.
  poseInterpolation: true,
});
renderer.resize(WIDTH, HEIGHT, window.devicePixelRatio);
app.scene.add(camera);

// §39 step 3 (priority 300): the mixers that write the pose targets.
const animation = new AnimationSystem();
app.systems.register(animation);

// §39 step 6 (priority 600): the solve, and §19's blend around it.
const physics = new PhysicsSystem();
app.systems.register(physics);

// §39 step 3 − 1 (priority 299): the pose-target history. Not registered by
// `Application`, and not optional here — see the module header.
app.systems.register(createPoseTargetCaptureSystem(physics.worlds));

/**
 * The one world: `"2d"`, on a Rapier 2D adapter, with §32 sleeping left on.
 *
 * `poses` is the application's §43 buffer, so every blended node's pose is
 * captured each step and the frame is drawn from an interpolation between the
 * previous one and the current one — whichever control mode produced it.
 */
const world = physics.track(
  new PhysicsWorld({
    dimension: "2d",
    adapter: new Rapier2dAdapter(),
    poses: app.poses,
  }),
);

// --- the wave's closed form --------------------------------------------------

/** The +Z axis: §21's only rotational freedom in a `"2d"` world. */
const Z_AXIS = new Vector3(0, 0, 1);

/** The angle of link `index` at clip-local time `seconds`, in radians. */
function linkAngle(index: number, seconds: number): number {
  return (
    BASE_ANGLE +
    WAVE_AMPLITUDE * Math.sin(WAVE_OMEGA * seconds - index * WAVE_PHASE_LAG)
  );
}

/** One link's pose at one instant: the joint it hangs from, and its rotation. */
interface LinkPose {
  readonly position: Vector3;
  readonly rotation: Quaternion;
}

/**
 * The whole chain's pose at `seconds`, by forward kinematics from the anchor.
 *
 * Every hinge is satisfied exactly by construction: joint `i + 1` is placed one
 * link-length along link `i`'s own axis, which is what a hinge constrains.
 */
function sampleWave(seconds: number): readonly LinkPose[] {
  const poses: LinkPose[] = [];
  let x = ANCHOR_X;
  let y = ANCHOR_Y;
  for (let index = 0; index < LINK_COUNT; index += 1) {
    const angle = linkAngle(index, seconds);
    poses.push({
      // z is always 0: §21 requires a `"2d"` body to lie in the XY plane.
      position: new Vector3(x, y, 0),
      rotation: new Quaternion().setFromAxisAngle(Z_AXIS, angle),
    });
    x += 2 * LINK_HALF_LENGTH * Math.sin(angle);
    y -= 2 * LINK_HALF_LENGTH * Math.cos(angle);
  }
  return poses;
}

/**
 * The looping clip for one link: a `position` track and a `rotation` track,
 * sampled from {@link sampleWave} at {@link WAVE_KEYS} keys per period.
 *
 * The last key repeats the first exactly (`sin` is periodic and both are
 * evaluated from the same closed form), so the loop seam is continuous in both
 * channels — a mixer wrapping from `duration` to `0` sees no step.
 */
function waveClip(index: number): AnimationClip {
  const times: number[] = [];
  const positions: Vector3[] = [];
  const rotations: Quaternion[] = [];
  for (let key = 0; key <= WAVE_KEYS; key += 1) {
    const seconds = (key * WAVE_PERIOD) / WAVE_KEYS;
    const pose = sampleWave(seconds)[index];
    times.push(seconds);
    positions.push(pose.position);
    rotations.push(pose.rotation);
  }
  const position: AnimationTrackLike = new AnimationTrack({
    path: "position",
    adapter: vector3Adapter,
    times,
    values: positions,
  });
  const rotation: AnimationTrackLike = new AnimationTrack({
    path: "rotation",
    adapter: quaternionAdapter,
    times,
    values: rotations,
  });
  return new AnimationClip({
    name: `wave-${String(index)}`,
    tracks: [position, rotation],
    duration: WAVE_PERIOD,
  });
}

// --- building blocks ---------------------------------------------------------

/** One link of the chain: everything the loop and the click handler need. */
interface Link {
  /** The blended node, whose origin is the link's **proximal joint**. */
  readonly node: Group;
  /** The §23 body carrying §19's two weights. */
  readonly body: RigidBody;
  /** The §19 target pose the mixer writes; never the transform (§42). */
  readonly target: PoseTarget;
  /** The dark bar drawn at {@link Link.target}, updated once per frame. */
  readonly ghost: Group;
}

/** Paints one node's unlit material (§60a straight RGBA). */
function paint(node: Renderable, color: Color): void {
  node.material.setColor(color[0], color[1], color[2], color[3]);
}

/** `color` scaled towards black, alpha untouched — rule 3's ghost tier. */
function dim(color: Color, factor: number): Color {
  return [color[0] * factor, color[1] * factor, color[2] * factor, color[3]];
}

/**
 * Adds one bar whose **origin is one end of it**: the quad is a child pushed
 * one half-length down the local −Y axis.
 *
 * Both the link and its ghost are built this way, because the whole rig depends
 * on the origin sitting at the joint (see the module header).
 */
function addBar(
  name: string,
  halfLength: number,
  halfThickness: number,
  z: number,
  color: Color,
): Group {
  const node = new Group();
  node.name = name;
  const quad = new Renderable(
    planeGeometry({ width: halfThickness * 2, height: halfLength * 2 }),
    new UnlitMaterial({ color }),
  );
  quad.name = `${name}-quad`;
  quad.transform.position.set(0, -halfLength, z);
  node.add(quad);
  return node;
}

/**
 * Adds one link: a `"blended"` node with the §19 trio — a `RigidBody`, a
 * `Collider` offset to hang below the joint, and a `PoseTarget`.
 *
 * The target is seeded with `copyFrom(node.transform)`, which seeds the
 * *history* as well, so the first fixed step differences to zero instead of
 * reading the seeding itself as motion.
 *
 * No mass is authored: the collider carries the default density of 1, the solver
 * derives mass from density × area, and `PhysicsWorld.addBody` reads it back
 * onto the component (§23, §25).
 */
function addLink(index: number, pose: LinkPose): Link {
  const color = LINK_COLORS[index];
  const node = addBar(
    `link-${String(index)}`,
    LINK_HALF_LENGTH,
    LINK_HALF_THICKNESS,
    0,
    color,
  );
  node.transform.position.copy(pose.position);
  node.transform.rotation.copy(pose.rotation);
  // §42: §19's pipeline is this node's single transform owner. Animation writes
  // the PoseTarget below; nothing in this file writes the transform.
  node.transformAuthority = "blended";

  const body = node.addComponent(new RigidBody({ type: "kinematic-position" }));
  // §19's weights: fully animated to start with.
  body.physicsWeight = 0;
  body.animationWeight = 1;

  const collider = node.addComponent(
    new Collider({
      shape: {
        type: "rectangle",
        halfExtents: new Vector2(LINK_HALF_THICKNESS, LINK_HALF_LENGTH),
      },
      friction: 0.7,
      restitution: 0,
    }),
  );
  // The leaf hangs below the joint, exactly as the drawn quad does.
  collider.offset.position.set(0, -LINK_HALF_LENGTH, 0);

  const target = node.addComponent(new PoseTarget()).copyFrom(node.transform);

  const ghost = addBar(
    `ghost-${String(index)}`,
    LINK_HALF_LENGTH,
    LINK_HALF_THICKNESS * 0.6,
    0,
    dim(color, GHOST_BRIGHTNESS),
  );
  ghost.transform.position.copy(pose.position);
  ghost.transform.rotation.copy(pose.rotation);
  ghost.transform.position.z = GHOST_Z;

  app.scene.add(ghost);
  app.scene.add(node);
  world.addBody(node);
  return { node, body, target, ghost };
}

/**
 * Adds one immovable block, with or without contact geometry.
 *
 * The anchor takes none — nothing may contact it (see the module header) — and
 * §23 permits a body without a collider. A static body still has to exist
 * because a joint's fixed side is a body, not a point.
 */
function addStatic(
  name: string,
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
  color: Color,
  solid: boolean,
): RigidBody {
  const node = new Group();
  node.name = name;
  // z is always 0 on the body itself: §21 requires a `"2d"` body to lie in the
  // XY plane, and the world refuses one that does not. The depth this scenery
  // is drawn at therefore lives on the **child** quad, which carries no physics
  // (the rule MEMORY records: 2D bodies at z = 0, visuals on child nodes).
  node.transform.position.set(x, y, 0);
  const quad = new Renderable(
    planeGeometry({ width: halfWidth * 2, height: halfHeight * 2 }),
    new UnlitMaterial({ color }),
  );
  quad.name = `${name}-quad`;
  quad.transform.position.set(0, 0, SCENERY_Z);
  node.add(quad);
  const body = node.addComponent(new RigidBody({ type: "static" }));
  if (solid) {
    node.addComponent(
      new Collider({
        shape: {
          type: "rectangle",
          halfExtents: new Vector2(halfWidth, halfHeight),
        },
        friction: 0.7,
        restitution: 0,
      }),
    );
  }
  app.scene.add(node);
  world.addBody(node);
  return body;
}

/** Adds one quad that belongs to no world: the plate, and its mark. */
function addScenery(
  name: string,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  color: Color,
): Renderable {
  const node = new Renderable(
    planeGeometry({ width, height }),
    new UnlitMaterial({ color }),
  );
  node.name = name;
  node.transform.position.set(x, y, z);
  app.scene.add(node);
  return node;
}

// --- the scene ---------------------------------------------------------------

/** Everything the frame loop, the fixed step, and the click handler need. */
interface Scene {
  readonly links: readonly Link[];
  readonly plate: Renderable;
  /** The plate as a §71 pick candidate. */
  readonly pickables: readonly Pickable[];
}

/**
 * Assembles the chain, its anchor, the ground, the plate, and the mixers.
 *
 * Bodies first, then joints: `world.addJoint` converts each **world-space**
 * anchor into body-local frames against the pose the solver holds at that
 * moment (§28), so every body has to be registered, and standing where it
 * belongs, before the first joint is added. The chain is built at the wave's
 * `t = 0` pose for the same reason, one level up: the clip's first key is that
 * pose, so nothing moves on the first step.
 */
function buildScene(): Scene {
  const anchor = addStatic(
    "anchor-block",
    ANCHOR_X,
    ANCHOR_Y,
    ANCHOR_BLOCK / 2,
    ANCHOR_BLOCK / 2,
    ANCHOR_COLOR,
    false,
  );
  addStatic(
    "ground",
    0,
    GROUND_TOP - GROUND_HALF_HEIGHT,
    GROUND_HALF_WIDTH,
    GROUND_HALF_HEIGHT,
    GROUND_COLOR,
    true,
  );

  const start = sampleWave(0);
  const links: Link[] = [];
  for (let index = 0; index < LINK_COUNT; index += 1) {
    links.push(addLink(index, start[index]));
  }

  // The hinges: the anchor to link 0, then link to link. None names an axis —
  // a hinge in a `"2d"` world has exactly one possible one (+Z, §21) and the
  // joint fills it in. Jointed bodies do not collide (§28 default), which is
  // what lets neighbouring links overlap at a shared joint.
  world.addJoint(
    new HingeJoint({
      bodyA: anchor,
      bodyB: links[0].body,
      anchor: new Vector3(ANCHOR_X, ANCHOR_Y, 0),
    }),
  );
  for (let index = 1; index < links.length; index += 1) {
    world.addJoint(
      new HingeJoint({
        bodyA: links[index - 1].body,
        bodyB: links[index].body,
        anchor: links[index].node.transform.position.clone(),
      }),
    );
  }

  // One mixer per link, aimed at the link's PoseTarget rather than at a node:
  // §19's "animation produces a target pose", using nothing but §16/§17.
  for (let index = 0; index < links.length; index += 1) {
    animation.track(
      new AnimationMixer(links[index].target).play(waveClip(index), {
        loop: Number.POSITIVE_INFINITY,
      }),
    );
  }

  const plate = addScenery(
    "mode-plate",
    MODE_PLATE.x,
    MODE_PLATE.y,
    0,
    MODE_PLATE.width,
    MODE_PLATE.height,
    MODE_ANIMATED_COLOR,
  );
  const mark = new Renderable(
    circleGeometry2D({ radius: GLYPH_RADIUS, segments: 32 }),
    new UnlitMaterial({ color: GLYPH_COLOR }),
  );
  mark.name = "mode-mark";
  mark.transform.position.set(0, 0, GLYPH_Z);
  plate.add(mark);

  // §71/§72 picking: `@fourjs/input` never reads geometry, so the layer that does
  // states each candidate's **local** bounds. The plate never moves, so this is
  // computed once.
  const bounds = plate.geometry.computeBounds();
  return {
    links,
    plate,
    pickables: [{ node: plate, boundsMin: bounds.min, boundsMax: bounds.max }],
  };
}

// --- live state --------------------------------------------------------------

/** Which control mode the chain is in; mirrored onto `data-mode`. */
let mode: Mode = "animated";

/** How many full ANIMATED → RAGDOLL → RECOVERING → ANIMATED cycles have run. */
let cycles = 0;

/** Fixed steps elapsed in the current recovery sweep; `0` outside one. */
let recoverySteps = 0;

/** The §19 animation weight every link currently carries. */
let animationWeight = 1;

/** Previous fixed step's link origins, flattened, for the §110 measurement. */
const previousPositions = new Float64Array(LINK_COUNT * 3);

/** Whether {@link previousPositions} has been filled at least once. */
let havePrevious = false;

/** Largest per-fixed-step link displacement since the current mode began, in m. */
let modeStep = 0;

/**
 * The displacement of the **first** fixed step of the current mode, in metres.
 *
 * §110's criterion lives at the switches, and this is the one number that is
 * entirely about a switch: everything else in a mode is ordinary motion. Kept
 * separately from {@link modeStep}, which the physical phases dominate within a
 * few steps.
 */
let entryStep = 0;

/** Whether the next measured step is the first of the current mode. */
let entryPending = false;

/** Largest per-fixed-step link displacement since the page loaded, in m. */
let worstStep = 0;

// --- the fixed step's application work (§110's measurement, and the sweep) ---

/**
 * The signed rotation about +Z carried by `rotation`, in radians.
 *
 * `q = (0, 0, sin(θ/2), cos(θ/2))` for a pure-Z rotation, so `θ = 2·atan2(z, w)`
 * — the `atan2` form rather than `2·asin`, because it stays exact past a quarter
 * turn. Every rotation in a `"2d"` world is of that form (§21).
 */
function angleAboutZ(rotation: Quaternion): number {
  return 2 * Math.atan2(rotation.z, rotation.w);
}

/** The world-space free end of the chain: one link-length past the last joint. */
function chainTipY(scene: Scene): number {
  const last = scene.links[scene.links.length - 1].node.transform;
  return (
    last.position.y -
    2 * LINK_HALF_LENGTH * Math.cos(angleAboutZ(last.rotation))
  );
}

/**
 * §110's criterion, measured live: the largest distance any link's origin moved
 * during the fixed step that just finished.
 *
 * Sampled from the `fixedUpdate` event, which the application emits **after**
 * every §39 system has run — so the pose read here is the one §19's blend just
 * published, never a §43 render interpolation of it (that is downstream, and
 * never feeds back). A per-step number is the only honest place to look for a
 * teleport: a per-*frame* number would fold several steps together.
 */
function measureContinuity(scene: Scene): void {
  let worst = 0;
  for (let index = 0; index < scene.links.length; index += 1) {
    const position = scene.links[index].node.transform.position;
    const base = index * 3;
    if (havePrevious) {
      worst = Math.max(
        worst,
        Math.hypot(
          position.x - previousPositions[base],
          position.y - previousPositions[base + 1],
          position.z - previousPositions[base + 2],
        ),
      );
    }
    previousPositions[base] = position.x;
    previousPositions[base + 1] = position.y;
    previousPositions[base + 2] = position.z;
  }
  havePrevious = true;
  if (entryPending) {
    entryStep = worst;
    entryPending = false;
  }
  modeStep = Math.max(modeStep, worst);
  worstStep = Math.max(worstStep, worst);
}

/** Writes §19's two weights onto every link, as the one value `w` implies. */
function setWeights(scene: Scene, weight: number): void {
  animationWeight = weight;
  for (const link of scene.links) {
    // Both, not just the animation one: `normalizedWeights` divides by the sum,
    // so leaving `physicsWeight` at 1 would cap the published share at ½.
    link.body.physicsWeight = 1 - weight;
    link.body.animationWeight = weight;
  }
}

/** Enters a mode, repaints the plate, and restarts the per-mode measurement. */
function enterMode(scene: Scene, next: Mode): void {
  mode = next;
  modeStep = 0;
  entryStep = 0;
  entryPending = true;
  paint(
    scene.plate,
    next === "animated"
      ? MODE_ANIMATED_COLOR
      : next === "ragdoll"
        ? MODE_RAGDOLL_COLOR
        : MODE_RECOVERING_COLOR,
  );
}

/**
 * Advances the §19 weight sweep by one fixed step, and closes it out.
 *
 * The weights written here take effect on the **next** step's publish, which is
 * why the re-type waits one step past `w = 1`: by then a step has already
 * published at full animation weight, the node is following the target alone,
 * and `setBodyControlMode` can only move the solver body.
 */
function advanceRecovery(scene: Scene, fixedDeltaSeconds: number): void {
  const total = Math.max(1, Math.round(RECOVERY_SECONDS / fixedDeltaSeconds));
  recoverySteps += 1;
  if (recoverySteps > total) {
    for (const link of scene.links) {
      // Switch 2: back under kinematic control, in place (§22, plan P7-3).
      world.setBodyControlMode(link.node, "kinematic-position");
    }
    setWeights(scene, 1);
    recoverySteps = 0;
    cycles += 1;
    enterMode(scene, "animated");
    return;
  }
  setWeights(scene, Math.min(1, recoverySteps / total));
}

// --- the frame's application work --------------------------------------------

/** Moves each ghost onto its link's current `PoseTarget`. Presentation only. */
function updateGhosts(scene: Scene): void {
  for (const link of scene.links) {
    link.ghost.transform.position.copy(link.target.position);
    link.ghost.transform.position.z = GHOST_Z;
    link.ghost.transform.rotation.copy(link.target.rotation);
  }
}

/**
 * Mirrors the chain's state onto the status element as data attributes.
 *
 * Everything a browser gate would otherwise have to infer from pixels is here:
 * the mode, the cycle counter, the live §19 weight, how low the chain hangs,
 * and §110's own numbers — the displacement of the first step after the switch
 * (`data-entry`), and the largest per-fixed-step displacement both since this
 * mode began (`data-step`) and since the page loaded (`data-worst`).
 */
function syncStatus(scene: Scene): void {
  const data = status.dataset;
  data["mode"] = mode;
  data["cycles"] = String(cycles);
  data["weight"] = animationWeight.toFixed(3);
  data["tipY"] = chainTipY(scene).toFixed(3);
  data["chainY"] = (
    scene.links.reduce((sum, link) => sum + link.node.transform.position.y, 0) /
    scene.links.length
  ).toFixed(3);
  data["entry"] = entryStep.toFixed(4);
  data["step"] = modeStep.toFixed(4);
  data["worst"] = worstStep.toFixed(4);
}

// --- interaction (§72 picking, §19 control-mode transitions) -----------------

/**
 * Cycles the control mode.
 *
 * A click always lands **between** fixed steps — `app.step` runs every substep
 * synchronously inside the rAF callback — so the pose-target history the
 * activation differences is one complete step old, which is exactly what
 * `inheritVelocityFrom` expects. A click during the sweep is ignored: the sweep
 * is a timed transition, and interrupting it half-way would be a fourth mode
 * this page does not claim to demonstrate.
 */
function cycleMode(scene: Scene): void {
  if (mode === "animated") {
    for (const link of scene.links) {
      // Switch 1: the ragdoll activation (§19, §110). The velocity comes from
      // the target's one-step history — see the header for what it is worth on
      // this solver.
      world.setBodyControlMode(link.node, "dynamic", {
        inheritVelocityFrom: link.target,
      });
    }
    setWeights(scene, 0);
    enterMode(scene, "ragdoll");
    return;
  }
  if (mode === "ragdoll") {
    recoverySteps = 0;
    enterMode(scene, "recovering");
  }
}

/**
 * The pick candidates, filled by {@link main} once the plate exists.
 *
 * The pointer source reads them through a callback, so it can be constructed
 * before there is anything to pick.
 */
let pickables: readonly Pickable[] = [];

// A real `HTMLCanvasElement` satisfies `PointerSurface` structurally, so no
// adapter and no cast is needed. It is never disposed: it lives exactly as long
// as the page does (§83).
new PointerInput(canvas, { camera, pickables: () => pickables });

// Counts every pointerdown the canvas receives, so a gate can tell a platform
// event that never arrived from one the page received and ignored.
let presses = 0;
canvas.addEventListener(
  "pointerdown",
  () => {
    presses += 1;
    status.dataset["presses"] = String(presses);
  },
  { capture: true },
);

// --- the frame loop ----------------------------------------------------------

/** The scene, once `main` has built it. `null` until then. */
let scene: Scene | null = null;

// Registered before the scene exists, because the application is constructed at
// module scope and the listener is cheap to guard.
app.on("fixedUpdate", (time) => {
  if (scene === null) {
    return;
  }
  measureContinuity(scene);
  if (mode === "recovering") {
    advanceRecovery(scene, time.fixedDeltaTime);
  }
});

/**
 * Seeded from the FIRST rAF timestamp rather than `performance.now()`: rAF hands
 * the frame-start time, which can precede a `now()` taken moments earlier, and a
 * negative first delta would make `app.step` throw and kill the loop
 * (WP-3.7-fix1, caught by the WP-3.8 browser gate).
 */
let last: number | null = null;

function frame(now: number): void {
  if (last !== null && scene !== null) {
    // The one place a wall clock is allowed: a presentation-side measurement,
    // converted to **seconds** before it crosses into the engine (§7a, §33).
    app.step((now - last) / 1000);
    updateGhosts(scene);
    syncStatus(scene);
  }
  last = now;
  requestAnimationFrame(frame);
}

/** What the page says while the wasm is decoding, and after. */
const LOADING_TEXT = "loading physics (WebAssembly solver)…";
const RUNNING_TEXT =
  "A three-link chain hangs from the block on the left. A looping clip drives " +
  "each link's pose target in a travelling wave while §19's blend publishes the " +
  "chain's pose. Click the plate to drop the chain into a ragdoll — the solver " +
  "takes over, keeping the velocity the animation had, and the chain collapses " +
  "onto the floor. The dim bars that appear are the pose targets the animation " +
  "is still asking for. Click again to blend back onto them over 1.5 seconds, " +
  "after which the links are re-typed kinematic and the wave resumes.";

async function main(): Promise<void> {
  status.textContent = LOADING_TEXT;
  status.dataset["state"] = "loading";

  // Acquires the WebGL 2 context (§45).
  await app.initialize();
  // Decodes the Rapier 2D wasm image (§37 allows `initialize` to be async for
  // exactly this).
  await world.initialize();

  const built = buildScene();
  pickables = built.pickables;
  built.plate.on("click", () => {
    cycleMode(built);
  });
  updateGhosts(built);
  syncStatus(built);
  scene = built;

  status.textContent = RUNNING_TEXT;
  status.dataset["state"] = "running";

  app.start();
  requestAnimationFrame(frame);
}

main().catch((error: unknown) => {
  status.textContent = "fourJS blending: failed to start — see the console.";
  status.dataset["state"] = "error";
  console.error("fourJS blending: failed to start.", error);
});
