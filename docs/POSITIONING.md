# Why fourJS exists

One page, outward-facing. The specification says _what_ fourJS is; this says _why anyone
would use it_. Companion to [`SPECIFICATION.md`](SPECIFICATION.md) §1–5.

## The problem

Today, an interactive 2D/3D application on the web is an integration project. A typical
stack glues together three.js (3D scene + rendering), Pixi or hand-rolled Canvas (2D),
Rapier or Matter (physics), GSAP or Theatre (animation/timelines), and a DOM overlay for
UI — five libraries, five scene models, five clocks, five coordinate conventions. The glue
is where projects bleed: physics bodies chased by render meshes a frame late, tweens
fighting physics for the same transform, 2D overlays that can't participate in picking,
milliseconds in one API and seconds in another, and no story at all for determinism or
replay.

## The bet

**The integration itself is the product.** fourJS puts 2D shapes, 3D meshes, text, UI,
rigid bodies, joints, and particle emitters in _one_ scene graph with _one_ clock, _one_
transform-authority model, _one_ event system, and _one_ set of conventions (Y-up, radians,
seconds — everywhere). Motion, animation, and physics are coequal with rendering, not
bolted on. Deterministic fixed-step simulation with snapshots and replay is a first-class
requirement (§33–34), which the glue-stack approach structurally cannot offer.

## Who it's for, in order

1. **Engineering/simulation web apps and digital twins** — dashboards, education, robotics
   visualization (§119). They need determinism, replay, explicit units, mixed 2D diagrams +
   3D models, and text/UI in-scene. This audience is underserved and is the beachhead.
2. **Interactive-content developers** (data-viz, explorables, playful sites) who currently
   pay the five-library tax for modest scenes.
3. **Game developers** — served, but not first; mature engines exist for pure games.

## What we are not claiming

Not a three.js replacement for photoreal rendering, not a Unity competitor, not a CAD/FEM
kernel (§5). Where an ecosystem is excellent (Rapier for solving, glTF for assets), fourJS
adapts to it rather than reinventing (§37).

## Migration story (to be proven)

three.js users should find the scene-graph idioms familiar (§7 transforms, §98 layering
deliberately rhyme with what they know); the pitch is "keep your mental model, gain a
clock, physics, and determinism." A `three.js → fourJS` guide with side-by-side snippets
is part of the §93 documentation plan, and API-ergonomics review against this audience is a
standing gate before 1.0.

## Demo-first principle

Credibility for this bet is demonstrated, not specified: the §118 "One Scene, Everything
Moves" demo is the forcing function, and a public interactive demo ships at the end of
Phase 3a (see `docs/plans/IMPLEMENTATION_PLAN.md`) — before physics, before most of the
spec is implemented — precisely to test whether the unified-scene pitch lands.

## Open risks, stated plainly

- **Scope**: the spec promises more than any small team ships; the MVP tiers (§56, §120)
  and phase gates exist to force cuts early. Kill criteria beat zombie scope.
- **Naming**: npm `four` is occupied (§98 publish-names note); resolved before release 0.1.
- **Incumbent gravity**: three.js's ecosystem is enormous; fourJS wins only where
  integration pain (determinism, mixed 2D/3D, physics-animation blending) dominates
  ecosystem breadth.
