/**
 * fourJS — first 2D scene, the interaction demo of §106a, and the authored
 * animation of §107.
 *
 * The smallest program that shows three of the four pillars cooperating over
 * one scene graph:
 *
 * - **Scene** — every object below is a node in a single graph: the camera, the
 *   ground, the circle, the box, the diamond, the vane, and the letters of the
 *   label. There is no separate "2D layer": the circle is a flat XY shape and
 *   the box is a solid, and they share the same right-handed, Y-up world (§7a).
 * - **Render** — one `WebglRenderer` draws that graph through one viewport
 *   (§48, §62). Nothing in the scene names WebGL; swapping the backend is a
 *   one-line change at this file's top.
 * - **Motion** — three different ways of moving something, side by side. The
 *   circle follows a prescribed path (`KinematicController` + a §13
 *   trajectory); the box integrates an angular velocity (`MotionComponent`);
 *   the diamond and the vane are driven by *authored curves* — tweens, a clip,
 *   and a timeline (§15–§17). All three are components or players advanced by
 *   systems registered on the application (§39), and the §39 order runs
 *   animation (priority 300) before kinematics (400), which is what §19's
 *   blending pipeline will need in Phase 5.
 *
 * The fourth pillar, **Physics**, arrives in Phase 5 — and will attach to these
 * same nodes as one more component, under one more transform authority (§42).
 *
 * ## What you can do to it (§71, §72, §55, §56)
 *
 * - **Click** the circle or the box: each cycles its material colour through a
 *   small palette. The click is picked with a camera ray against the node's own
 *   bounds and delivered as a scene event that propagates through the graph.
 * - **Drag** the box: the pointer's motion is converted to a world-space
 *   displacement and applied to the node's position — under an authority
 *   handover the drag performs explicitly (see "Dragging and §42" below).
 * - The **label** above the scene is real geometry, not DOM: a bitmap glyph
 *   atlas, laid out into quads, drawn as **one** textured `Text` node in the
 *   same graph as everything else.
 * - The **diamond** on the right and the **vane** on the left are not
 *   interactive at all: they are running authored animation, and the section
 *   below says exactly which kind.
 *
 * ## The authored cluster (§15, §16, §17 — the §107 exit criterion)
 *
 * Phase 4's exit asks for every §17 track value type to reach the screen. Two
 * small shapes, deliberately off to the sides, carry one each:
 *
 * | kind           | what animates                        | who drives it       |
 * | -------------- | ------------------------------------ | ------------------- |
 * | **vector**     | the diamond's `transform.position`   | a yoyo `Tween`      |
 * | **quaternion** | the vane's `transform.rotation`      | an `AnimationMixer` over a clip |
 * | **color**      | the diamond's material RGBA          | a `Tween` on the `Timeline` |
 * | **numeric**    | the vane's `transform.scale` x and y | a `Tween` on the `Timeline` |
 *
 * and one `Timeline` sequences the last two, with a marker (§16) at its "beat"
 * label that steps the vane's colour through a palette. The vector tween moves
 * a whole `Vector3` rather than two numbers — `to({ "transform.position": … })`,
 * not `to({ x, y })` — so the value really is the §17 *vector* kind and not two
 * scalar tracks wearing a costume. The quaternion track interpolates with
 * `slerp` (three keys 120° apart, so every span takes the short way round).
 *
 * Both shapes declare `transformAuthority = "animation"` (§42) and neither is
 * pickable or draggable: an animation owns their transforms outright, and a
 * click-to-recolour would fight the colour tween's §16 property claim rather
 * than demonstrate anything. The box and the circle are correspondingly *not*
 * animated — they stay under `"kinematic"`, and the drag's authority handover
 * below is unaffected.
 *
 * ## Fixed-step simulation, variable-rate rendering (§10, §43)
 *
 * The loop at the bottom feeds real elapsed seconds to `app.step(...)`. Inside,
 * simulation advances in fixed 1/60 s steps regardless of how fast the display
 * refreshes, and the frame is drawn from *interpolated* poses — which is why
 * `app.poses.track(...)` is called for every moving node. On a 144 Hz screen
 * that is what keeps the motion smooth instead of showing each simulation step
 * two or three times.
 *
 * ## Dragging and §42, in full
 *
 * §42 gives exactly one system authority over a node's transform. The box is
 * normally `"kinematic"`: the `MotionSystem` integrates its angular velocity and
 * owns its transform. A drag wants to write that same transform from the
 * application, which is `"manual"` authority — so the drag *hands ownership
 * over* rather than writing behind the owner's back:
 *
 * ```text
 * dragStart:  motionSystem.untrack(box);  box.transformAuthority = "manual"
 * drag:       box.transform.position.set(… + worldDelta …) ← application writes
 * dragEnd:    box.transformAuthority = "kinematic";  motionSystem.track(box)
 * ```
 *
 * So the box stops tumbling while it is dragged and resumes when it is dropped,
 * and at no instant do two systems claim it. Setting the authority alone would
 * be enough for §42's *enforcement* — `MotionSystem` would refuse the write and
 * warn once (`warnAuthorityConflict`) — but leaving it tracked would mean asking
 * a system every step to do something it is not allowed to do. Untracking says
 * the same thing without the warning, which is what a handover actually is
 * (decision, WP-3a.5).
 *
 * ## What the label costs (§49, §56 — and what it used to cost)
 *
 * One `Text` node: **one geometry, one texture, one draw call**, whatever the
 * string says. §53's per-vertex `uvs` address a different atlas cell for every
 * glyph out of a single buffer, which is the thing that makes a label a
 * rectangle-list rather than a pile of nodes.
 *
 * It is worth recording what stood here until 2026-08-21, because the paragraph
 * was the evidence for a backlog item and the item is now closed. `Sprite`
 * derives its texture coordinates affinely from its own quad — the whole texture
 * across the whole sprite — so there was no way to point one at a *cell* of an
 * atlas, and this file cut every distinct cell out into its own 6 × 12 texel
 * `Texture` and drew one `Sprite` per glyph: ~20 textures and 36 draw calls for
 * a 37-character label. R-28's `Text` node (2026-08-13) replaced all of it with
 * three lines, and the count this page now reports is **1**.
 */

import {
  AnimationClip,
  AnimationMixer,
  AnimationSystem,
  AnimationTrack,
  Timeline,
  animate,
  quaternionAdapter,
  tween,
} from "fourJS/animation";
import { Application } from "fourJS/application";
import { boxGeometry, circleGeometry2D, planeGeometry } from "fourJS/geometry";
import { DragManager, PointerInput, type Pickable } from "fourJS/input";
import { UnlitMaterial } from "fourJS/materials";
import { Quaternion, Vector3 } from "fourJS/math";
import {
  CircularTrajectory,
  KinematicController,
  KinematicSystem,
  MotionComponent,
  MotionSystem,
} from "fourJS/motion";
import { Renderable, Texture } from "fourJS/render";
import { WebglRenderer } from "fourJS/render-webgl";
import { OrthographicCamera, createFullscreenViewport } from "fourJS/scene";
import { buildGlyphAtlas } from "fourJS/text";
import { Text } from "fourJS";

declare global {
  interface Window {
    /** Injected by the smoothness gate: hold virtual time after the next app.step. */
    __fourPauseAfterStep?: boolean;
    /** Injected by the smoothness gate: freeze the virtual rAF clock. */
    __fourPauseRaf?: boolean;
  }
}

// --- surface ---------------------------------------------------------------

const canvas = document.querySelector<HTMLCanvasElement>("#scene");
if (canvas === null) {
  throw new Error('fourJS example: no <canvas id="scene"> in the document.');
}

const statusOrNull = document.querySelector<HTMLParagraphElement>("#status");
if (statusOrNull === null) {
  throw new Error('fourJS example: no <p id="status"> in the document.');
}
const status: HTMLParagraphElement = statusOrNull;

/** Layout size in CSS pixels; the drawing buffer is this times the DPR. */
const WIDTH = 800;
const HEIGHT = 600;

// --- camera and view (§47, §48) --------------------------------------------

// An orthographic camera showing 8 × 6 world units — the same 4:3 shape as the
// canvas, so nothing is stretched. +Y is up here exactly as it is in 3D (§7a).
const camera = new OrthographicCamera({
  left: -4,
  right: 4,
  bottom: -3,
  top: 3,
  near: 0.1,
  far: 10,
});
// A camera is a node, so it is placed with its transform. `Vector3.set` is a
// mutator and announces itself, so no `markDirty()` is needed (§7b).
camera.transform.position.set(0, 0, 5);
// Nothing recomputes implicitly: after changing projection parameters, say so.
camera.updateProjectionMatrix();

// One viewport covering the whole canvas, cleared to a dark background. A
// second entry in `app.views` would be split-screen or a minimap (§48).
const view = createFullscreenViewport(camera);
view.clearColor = [0.05, 0.06, 0.09, 1];

// --- application (§45) ------------------------------------------------------

// The backend is constructed here and handed over: the application drives it,
// but the code that created it owns it (§83).
const renderer = new WebglRenderer();
const app = new Application({ renderer, canvas, views: [view] });

// Draw at the display's true pixel density; the CSS size stays 800 × 600.
renderer.resize(WIDTH, HEIGHT, window.devicePixelRatio);

app.scene.add(camera);

// --- the scene --------------------------------------------------------------

// (1) A static plane, one unit behind the movers — a ground reference, and the
// proof that depth still works in a "2D" scene: the orbiting circle passes in
// front of it.
const ground = new Renderable(
  planeGeometry({ width: 7.6, height: 1.2 }),
  new UnlitMaterial({ color: [0.1, 0.13, 0.19, 1] }),
);
ground.name = "ground";
ground.transform.position.set(0, -2.35, -1);
app.scene.add(ground);

// (2) An orbiting circle — a 2D shape driven by a *prescribed* path (§12, §13).
// The trajectory states where the node is as a function of time; the
// `KinematicSystem` evaluates it once per fixed step and writes the position.
const orbiter = new Renderable(
  circleGeometry2D({ radius: 0.45, segments: 48 }),
  new UnlitMaterial({ color: [1, 0.45, 0.2, 1] }),
);
orbiter.name = "orbiter";
// §42: exactly one system may write a node's transform, and it must say so.
orbiter.transformAuthority = "kinematic";
const orbit = orbiter.addComponent(new KinematicController());
orbit.followPath(
  new CircularTrajectory({
    center: new Vector3(0, 0, 0),
    radius: 2,
    // Radians per second (§7a: radians and seconds everywhere) — a quarter
    // turn per second, so one lap takes four seconds.
    angularVelocity: Math.PI / 2,
  }),
  { loop: true },
);
app.scene.add(orbiter);

// (3) A tumbling box — a 3D solid in the same graph, moved by *derived* motion
// (§11): a `MotionComponent` holds an angular velocity, and the `MotionSystem`
// integrates it into the node's rotation each fixed step. Two non-zero axes so
// the tumble reads as a tumble rather than a spin.
const tumbler = new Renderable(
  boxGeometry({ width: 0.9, height: 0.9, depth: 0.9 }),
  new UnlitMaterial({ color: [0.25, 0.7, 1, 1] }),
);
tumbler.name = "tumbler";
tumbler.transform.position.set(-2.7, 1.8, 0);
tumbler.transformAuthority = "kinematic";
tumbler.addComponent(
  new MotionComponent({ angularVelocity: new Vector3(0.7, 1.1, 0) }),
);
app.scene.add(tumbler);

// (4) and (5) the animated pair — see the header's "authored cluster" table.
// Nothing here says what they do; the "authored animation" section below is
// where the curves live, exactly as the two nodes above say nothing about how
// the motion systems move them.

/**
 * The diamond's starting colour — and the rule every colour in this cluster,
 * animated or not, obeys.
 *
 * The browser gate identifies the two interactive shapes by colour alone and
 * scans the *whole* frame for them (`tests/browser/interaction.spec.ts`): a
 * pixel is the orbiter when `red ≥ 180` and red beats blue by 90, and it is the
 * box when it is bright and `blue + 20 ≥ red`. Every colour in this cluster
 * therefore keeps `red ≤ 0.68` (173 of 255, so never the orbiter however it is
 * antialiased) *and* a red-minus-blue gap above 110 (so never the box, and the
 * gap is wide enough that a rim pixel blended down toward the background falls
 * below the gate's brightness bar long before it falls below the 20 that would
 * make it box-coloured). Warm, mid-bright, and unmistakable for either — the
 * same discipline {@link ORBITER_COLORS} follows, one cluster further out
 * (decision, WP-4.7).
 */
const BEACON_COLOR: [number, number, number, number] = [0.68, 0.42, 0.16, 1];

/** Where the diamond's vector tween starts and ends, in world units. */
const BEACON_X = 3.35;
const BEACON_LOW_Y = 0.05;
const BEACON_HIGH_Y = 1.7;

// (4) A small diamond — `circleGeometry2D` with four segments *is* a diamond,
// since rim vertex `i` sits at angle 2πi/4. It sits far to the right: the
// orbiting disc sweeps the annulus 2 ± 0.45, so x = 3.35 is clear of it by more
// than half a world unit, and the label's ink starts at y = 2.6, well above the
// top of this shape's travel.
const beacon = new Renderable(
  circleGeometry2D({ radius: 0.22, segments: 4 }),
  new UnlitMaterial({ color: BEACON_COLOR }),
);
beacon.name = "beacon";
beacon.transform.position.set(BEACON_X, BEACON_LOW_Y, 0);
// §42: an animation owns this transform, and the tween below writes as
// `"animation"` — the two have to agree or the write is refused and warns.
beacon.transformAuthority = "animation";
app.scene.add(beacon);

// (5) A triangle, three segments of the same primitive, on the opposite side —
// equally clear of the orbit, of the box's corner, and of the ground's top edge
// at y = -1.75. Its colour is `VANE_COLORS[0]` spelled out, because that array
// belongs with the marker that steps through it and is declared further down.
const vane = new Renderable(
  circleGeometry2D({ radius: 0.26, segments: 3 }),
  new UnlitMaterial({ color: [0.62, 0.3, 0.14, 1] }),
);
vane.name = "vane";
vane.transform.position.set(-3.25, -0.75, 0);
vane.transformAuthority = "animation";
app.scene.add(vane);

// --- systems (§39) ----------------------------------------------------------

// Systems do the per-fixed-step work; components are just the state they read.
// Registration order does not matter — the registry runs them by priority.
const motionSystem = new MotionSystem();
const kinematicSystem = new KinematicSystem();
// §39 step 3, priority 300 — the registry runs it *before* `MotionSystem`
// (step 4, priority 400) whatever order they are registered in, which is the
// order §19's animation → kinematics → physics pipeline needs.
const animationSystem = new AnimationSystem();
app.systems.register(motionSystem);
app.systems.register(kinematicSystem);
app.systems.register(animationSystem);

motionSystem.track(tumbler);
kinematicSystem.track(orbiter);

// Interpolate the movers between simulation states when drawing (§43). The
// ground never moves, so it is left untracked and simply draws from its live
// transform. The pose buffer carries position and rotation; the vane's animated
// *scale* is read live from its transform by the render list, so a scale tween
// steps at the fixed rate while its rotation still interpolates.
app.poses.track(orbiter);
app.poses.track(tumbler);
app.poses.track(beacon);
app.poses.track(vane);

// --- picking and pointer events (§71, §72) ----------------------------------

// The candidate list picking tests against. `@fourjs/input` never reads geometry
// — it may not depend on `@fourjs/render` or `@fourjs/geometry` — so the layer that
// *does* see geometry states each node's box, in that node's own **local**
// space, which is exactly what `computeBounds()` returns. The ray is
// transformed into local space per candidate, so the box is tested oriented
// (the tumbling box is picked as a tumbling box, not as its inflated
// world-space extent).
//
// The list is built once because the *set* of pickable nodes never changes
// here; nothing has to be rebuilt when they move, and the bounds vectors are
// live views onto geometries this example never edits.
const pickables: readonly Pickable[] = [orbiter, tumbler].map((node) => {
  const bounds = node.geometry.computeBounds();
  return { node, boundsMin: bounds.min, boundsMax: bounds.max };
});

// A real `HTMLCanvasElement` satisfies `PointerSurface` structurally — the
// three members `PointerInput` touches (`addEventListener`,
// `removeEventListener`, `getBoundingClientRect`) are all on it — so no adapter
// and no cast is needed. Platform pixels become normalized device coordinates
// through the canvas rectangle, including the Y flip that turns the platform's
// downward Y into §7a's upward Y.
const pointerInput = new PointerInput(canvas, {
  camera,
  pickables: () => pickables,
});

/** An RGBA colour in 0…1, straight (non-premultiplied) alpha (§66). */
type Palette = readonly (readonly [number, number, number, number])[];

/**
 * Colours the orbiter cycles through, starting at the one it was built with.
 *
 * All four are *warm* — a bright red channel well clear of the blue one —
 * because the browser gate identifies the orbiter by exactly that signature
 * (`tests/browser/smoothness.spec.ts`) in order to recover its world position
 * from a screenshot. Keeping the whole palette inside that gamut means a click
 * changes what the demo looks like without changing what the gate can measure
 * (decision, WP-3a.5).
 */
const ORBITER_COLORS: Palette = [
  [1, 0.45, 0.2, 1],
  [1, 0.72, 0.15, 1],
  [0.95, 0.25, 0.15, 1],
  [1, 0.55, 0.35, 1],
];

/**
 * Colours the tumbler cycles through — all *cool*, and for the mirror-image
 * reason: none of them may be mistaken for the orbiter by that same detector.
 */
const TUMBLER_COLORS: Palette = [
  [0.25, 0.7, 1, 1],
  [0.35, 0.85, 0.55, 1],
  [0.55, 0.45, 0.95, 1],
  [0.85, 0.85, 0.9, 1],
];

/**
 * Advances `node`'s colour one step through `palette` on every click.
 *
 * `click` is synthesized by the pointer source, not by the platform: a press
 * and a release on the same node with no drag in between (§72). So dragging the
 * box does *not* recolour it, which is the behaviour a user expects and the
 * reason the two interactions can share one node at all.
 *
 * The listener is registered with the node's own event API — `Node` extends
 * §6b's typed `EventEmitter`, and `@fourjs/input` widens its event map, so there
 * is one `on` for hierarchy events and pointer events alike.
 */
function recolorOnClick(node: Renderable, palette: Palette): void {
  let index = 0;
  node.on("click", () => {
    index = (index + 1) % palette.length;
    const [red, green, blue, alpha] = palette[index];
    node.material.setColor(red, green, blue, alpha);
  });
}

recolorOnClick(orbiter, ORBITER_COLORS);
recolorOnClick(tumbler, TUMBLER_COLORS);

// --- dragging, and the §42 handover -----------------------------------------

/** Keeps a dragged node inside the camera's view, in world units. */
const DRAG_LIMIT_X = 3.4;
const DRAG_LIMIT_Y = 2.2;

// `DragManager` computes the one thing only it can compute — the world-space
// displacement matching the pointer's motion, exact under this orthographic
// camera — and hands it to the application. It never writes a transform: input
// has no §42 authority, and what a drag *means* (move it, push it, refuse it)
// is the application's decision. See this file's header for the handover.
const drags = new DragManager({
  pointerInput,
  onDragStart: (node) => {
    // The previous owner stops being asked to write, and the application takes
    // the transform. The box's angular velocity is untouched, so the tumble
    // resumes from where it paused.
    motionSystem.untrack(node);
    node.transformAuthority = "manual";
  },
  onDrag: (node, worldDelta) => {
    const position = node.transform.position;
    // One clamped write rather than `add` + a correction: `Vector3.set`
    // announces the change once, which is what advances `Transform.version`
    // (§7) and what the §43 pose capture reads on the next fixed step.
    position.set(
      Math.min(
        DRAG_LIMIT_X,
        Math.max(-DRAG_LIMIT_X, position.x + worldDelta.x),
      ),
      Math.min(
        DRAG_LIMIT_Y,
        Math.max(-DRAG_LIMIT_Y, position.y + worldDelta.y),
      ),
      position.z,
    );
  },
  onDragEnd: (node) => {
    node.transformAuthority = "kinematic";
    motionSystem.track(node);
  },
});
drags.makeDraggable(tumbler);

// Neither the pointer source nor the drag manager is disposed here: both live
// exactly as long as the page does, and §83 puts disposal on whoever created a
// resource *when it is finished with it*. A widget that comes and goes calls
// `pointerInput.dispose()` / `drags.dispose()`; a demo that ends with the tab
// does not.

// --- authored animation (§15, §16, §17) -------------------------------------

// (a) VECTOR. The diamond's whole `transform.position`, up and back forever.
//
// The animated property is the vector, not two scalars: `to({ x, y })` against
// `beacon.transform.position` would bind two `number`s and run two independent
// number tweens, while the path below binds the `Vector3` itself and drives it
// through §17's vector kind. Naming the *node* as the target is also what lets
// the tween find the node whose §42 authority gates it — a bare `Vector3` has
// no back-reference to its owner, and would need `.authority(beacon)` spelled
// out. Seconds, as everywhere (§7a): 2.2 s up, and `yoyo` walks the same curve
// back rather than snapping to the start.
animationSystem.track(
  animate(beacon)
    .to({ "transform.position": new Vector3(BEACON_X, BEACON_HIGH_Y, 0) }, 2.2)
    .ease("sine-in-out")
    .yoyo()
    .repeat(Infinity)
    .play(),
);

// (b) QUATERNION. One turn of the vane about +Z every three seconds, authored
// as a §17 clip and played by a mixer.
//
// Three spans of 120° rather than one key at 0 and one at 2π: the quaternion
// adapter interpolates with `slerp`, which always takes the short way round, so
// a single 360° span would be a 0° span and the vane would not move at all.
// Each key is a *rotation*, and `q(2π)` is the identity rotation again (its
// components are negated, which is the same orientation), so the loop is
// seamless.
const SPIN_AXIS = new Vector3(0, 0, 1);
const TURN_SECONDS = 3;
const spin = new AnimationClip({
  name: "vane-spin",
  tracks: [
    new AnimationTrack({
      path: "transform.rotation",
      adapter: quaternionAdapter,
      times: [0, TURN_SECONDS / 3, (TURN_SECONDS * 2) / 3, TURN_SECONDS],
      values: [
        new Quaternion().setFromAxisAngle(SPIN_AXIS, 0),
        new Quaternion().setFromAxisAngle(SPIN_AXIS, (Math.PI * 2) / 3),
        new Quaternion().setFromAxisAngle(SPIN_AXIS, (Math.PI * 4) / 3),
        new Quaternion().setFromAxisAngle(SPIN_AXIS, Math.PI * 2),
      ],
      interpolation: "linear",
    }),
  ],
});
// The mixer's target is a node, so its §42 authority is inferred; `loop` counts
// total iterations (`Infinity` never ends), unlike `Tween.repeat`'s "extra
// cycles". Tracking it is what makes something advance it (§39).
animationSystem.track(new AnimationMixer(vane).play(spin, { loop: Infinity }));

/** The colour the diamond's material pulses toward, and back from. */
const BEACON_PULSE_COLOR: [number, number, number, number] = [
  0.66, 0.6, 0.2, 1,
];

/**
 * Colours the timeline's marker steps the vane through, obeying the gamut rule
 * {@link BEACON_COLOR} states — warm, `red ≤ 0.68`, blue far below red.
 */
const VANE_COLORS: Palette = [
  [0.62, 0.3, 0.14, 1],
  [0.68, 0.46, 0.22, 1],
  [0.58, 0.34, 0.1, 1],
  [0.64, 0.24, 0.1, 1],
];

/** Which entry of {@link VANE_COLORS} the vane is wearing. */
let beat = 0;

/**
 * The §16 marker: one discrete event on an otherwise continuous timeline.
 *
 * Markers are how a timeline does something that is not a value at a time —
 * spawn a puff of dust, play a sound, change a palette — and this one steps the
 * vane's colour on every loop, so the sequencing is visible rather than merely
 * asserted. It fires during playback only: a `seek` past it stays silent unless
 * the marker opts into replay, which is §16's rule and the reason scrubbing a
 * timeline does not re-trigger its side effects.
 */
function advanceVaneColor(): void {
  beat = (beat + 1) % VANE_COLORS.length;
  const [red, green, blue, alpha] = VANE_COLORS[beat];
  vane.material.setColor(red, green, blue, alpha);
}

// (c), (d) and (e). One `Timeline` sequences a colour tween and a numeric one
// and fires the marker between them (§16).
//
// - **colour** — the diamond's material RGBA, animated *in place*: the tween
//   writes through the existing four-tuple rather than replacing it, which is
//   what keeps the reference the backend holds valid. `UnlitMaterial.version`
//   does not advance (only `setColor`/`markDirty` bump it) and does not need
//   to: the WebGL backend uploads `material.color` on every draw rather than
//   caching it against the version, so an in-place edit is picked up the next
//   frame. A material whose *pipeline* had to change with the colour would need
//   the version, and this one does not (finding, WP-4.7).
// - **numeric** — two scalars of the vane's scale, the plain `number` kind.
//   Alpha would have been the more obvious non-transform number, but this tier
//   enables `GL_BLEND` for sprites only, so an unlit material's alpha never
//   reaches a blend equation and animating it would be invisible (finding,
//   WP-4.7).
//
// Both children are handed over *unplayed* — `tween(...)` builds without
// playing, and the timeline owns playback, so the §16 property claims are taken
// when the timeline starts and released when it stops.
const pulse = new Timeline()
  .addLabel("beat", 2.2)
  .at(
    0,
    tween(beacon.material, { color: BEACON_PULSE_COLOR }, 1.1)
      .ease("sine-in-out")
      .yoyo()
      .repeat(1),
  )
  .at("beat", advanceVaneColor)
  .at(
    "beat",
    tween(vane, { "transform.scale.x": 1.35, "transform.scale.y": 1.35 }, 0.55)
      .ease("back-out")
      .yoyo()
      .repeat(1),
  )
  .loop(Infinity);
animationSystem.track(pulse.play());

// --- the label (§55, §56) ---------------------------------------------------

/** World units per line of text — `layoutText`'s `size`, not an em size. */
const LABEL_SIZE = 0.26;

/** Height of the label's baseline above the world origin, in world units. */
const LABEL_BASELINE_Y = 2.65;

/**
 * Tint multiplied into every glyph texel: a soft near-white, cool rather than
 * warm for the reason {@link ORBITER_COLORS} gives — text must never be
 * mistaken for the orbiter by the browser gate's colour classifier.
 */
const LABEL_TINT: readonly [number, number, number, number] = [
  0.88, 0.92, 1, 1,
];

/**
 * The label. ASCII only: the built-in 6 × 12 face covers U+0020…U+007E, and
 * anything else — an em dash, say — would draw the missing-glyph box.
 */
const LABEL_TEXT = "fourJS - click a shape, drag the box";

// The font, packed once into one RGBA8 buffer with a uv rectangle per glyph.
// White everywhere, alpha as coverage, so a filtered edge fades to transparent
// instead of to soot.
const atlas = buildGlyphAtlas();

/**
 * The whole sheet, sampled with §77's `"nearest"` filter (R-30).
 *
 * `"nearest"` and not the default `"linear"` because the face is a **bitmap**:
 * one texel is one pixel of the glyph, and a linear filter blends each texel
 * with its neighbours — including, at a cell's edge, the neighbouring *glyph*.
 * Nearest keeps a 6 × 12 face crisp at the size it was drawn for, which is what
 * the pixel golden in `tests/visual/text.spec.ts` photographs.
 */
const font = new Texture({ ...atlas, filter: "nearest" });

/**
 * One material for the whole label. `transparent: true` because the atlas
 * carries coverage in alpha, and §57's `color` is where a label's colour lives —
 * it multiplies into every texel, which is exactly what the per-glyph sprite
 * tint used to do.
 */
const ink = new UnlitMaterial({
  map: font,
  transparent: true,
  color: [LABEL_TINT[0], LABEL_TINT[1], LABEL_TINT[2], LABEL_TINT[3]],
});

/**
 * The label: **one node, one geometry, one draw call** (§49, §56).
 *
 * `renderLayer: 1` draws it after the opaque shapes — it blends, and blending
 * needs what is behind it already in the framebuffer (§66).
 *
 * The node's origin is the first line's baseline at its left edge, so centring
 * the block over the scene is one subtraction of a number the node itself
 * reports (`layout.width`) — the same arithmetic `layoutText` did here before,
 * now cached inside the node and recomputed only when the string changes.
 *
 * Until 2026-08-21 this was ~20 tiny `Texture`s — one per *distinct glyph cell*,
 * cut out of the atlas by hand — and one `Sprite` per drawn glyph, because
 * `Sprite` maps its whole texture across its whole quad and §55's frame
 * sub-rectangle had not landed. R-28's `Text` node made that workaround
 * unnecessary: §53's per-vertex `uvs` address twelve different atlas cells from
 * one buffer, which is the thing a sprite's affine uv could never express.
 */
const label = new Text(atlas, ink, {
  text: LABEL_TEXT,
  size: LABEL_SIZE,
  renderLayer: 1,
});
label.name = "label";
label.transform.position.set(0 - label.layout.width / 2, LABEL_BASELINE_Y, 0);
app.scene.add(label);

// --- status for browser gates (§107) ----------------------------------------

/** Local scratch for {@link vaneBoundingAspect}. */
const aspectScratch = new Vector3();

/**
 * Axis-aligned bounding-box aspect of the vane's three rim vertices in world
 * space — the same quantity `tests/browser/animation.spec.ts` recovers from
 * pixels when it needs a framebuffer proof, published here so the gate can
 * watch §17 quaternion motion without screenshotting every sample.
 */
function vaneBoundingAspect(): number {
  const scale = vane.transform.scale.x;
  const radius = 0.26 * scale;
  const rotation = vane.transform.rotation;
  const origin = vane.transform.position;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let segment = 0; segment < 3; segment += 1) {
    const angle = (2 * Math.PI * segment) / 3;
    aspectScratch.set(radius * Math.cos(angle), radius * Math.sin(angle), 0);
    rotation.rotateVector3(aspectScratch, aspectScratch);
    const worldX = origin.x + aspectScratch.x;
    const worldY = origin.y + aspectScratch.y;
    if (worldX < minX) minX = worldX;
    if (worldX > maxX) maxX = worldX;
    if (worldY < minY) minY = worldY;
    if (worldY > maxY) maxY = worldY;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  return width / height;
}

/**
 * Mirrors the animated cluster onto `#status` as data attributes.
 *
 * Everything a browser gate would otherwise infer from a long framebuffer sweep
 * is here: the diamond's authored position and green channel, the vane's scale,
 * bounding-box aspect and red channel, and §9's simulation clock. The gate reads
 * these on rAF and reserves screenshots for the cases that truly need pixels.
 */
function syncStatus(): void {
  const beaconMaterial = beacon.material;
  const vaneMaterial = vane.material;
  status.dataset["state"] = "running";
  status.dataset["beaconY"] = beacon.transform.position.y.toFixed(4);
  status.dataset["beaconGreen"] = String(
    Math.round(beaconMaterial.color[1] * 255),
  );
  status.dataset["vaneSx"] = vane.transform.scale.x.toFixed(4);
  status.dataset["vaneSy"] = vane.transform.scale.y.toFixed(4);
  status.dataset["vaneAspect"] = vaneBoundingAspect().toFixed(4);
  status.dataset["vaneRed"] = String(Math.round(vaneMaterial.color[0] * 255));
  status.dataset["sim"] = app.time.simulationTime.toFixed(4);
  status.dataset["alpha"] = app.time.interpolationAlpha.toFixed(4);
  status.dataset["dropped"] = app.time.droppedTime.toFixed(6);
  status.dataset["substeps"] = String(app.scheduler.fixedStepsLastFrame);
  status.dataset["frames"] = String(appFrames);
}

// --- the frame loop ---------------------------------------------------------

/**
 * Drives the application from `requestAnimationFrame`.
 *
 * `performance.now()`/the rAF timestamp is a *presentation-side* clock, which
 * is the one place a wall clock is allowed: it measures how long the display
 * took, and is converted to seconds before it crosses into the engine (§7a).
 * Simulation itself never sees it — inside `app.step` the fixed-step
 * accumulator hands every system the same injected `fixedDeltaTime` (§10, §33).
 */
// Seeded from the FIRST rAF timestamp, not performance.now(): rAF hands the
// frame-start time, which can precede a now() taken moments earlier — a
// negative first delta would make app.step throw and kill the loop
// (WP-3.7-fix1, caught by the WP-3.8 browser gate).
let last: number | null = null;
let appFrames = 0;

function frame(now: number): void {
  if (last !== null) {
    app.step((now - last) / 1000);
    appFrames += 1;
    syncStatus();
    if (window.__fourPauseAfterStep === true) {
      window.__fourPauseRaf = true;
    }
  }
  last = now;
  requestAnimationFrame(frame);
}

async function main(): Promise<void> {
  // Acquires the WebGL 2 context. A failure here rejects rather than leaving a
  // half-started application (§45).
  await app.initialize();
  app.start();
  syncStatus();
  requestAnimationFrame(frame);
}

main().catch((error: unknown) => {
  console.error("fourJS example: failed to start.", error);
});
