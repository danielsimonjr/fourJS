# The engineering dashboard

§119 positions fourJS for engineering: mechanisms with motors, sensors,
controllers, and live instrumentation. This guide composes the shipped pieces
into that shape — a motorized joint under PID control, limit switches, and a
dashboard the outside world can read. `examples/mechanism` is the running
model; this guide adds the control loop.

## The parts and where they come from

| dashboard part   | engine feature                                                 |
| ---------------- | -------------------------------------------------------------- |
| actuator         | §28 joint motors (`HingeJoint.setMotor`, rad/s)                |
| controller       | `PIDController` (`four/motion`), run per fixed step            |
| smooth setpoints | `SpringDamper` (`four/motion`) — exact, unconditionally stable |
| limit switches   | position sampling per frame (see `examples/mechanism` for why) |
| live readouts    | body/joint state mirrored onto DOM `data-*` attributes         |
| pause / replay   | §34 recording — see [the digital twin](digital-twin.md)        |

## PID speed and position control

`PIDController` is a scalar controller with conditional-integration
anti-windup and derivative-on-measurement by default (kick-free). Gains:
`kp`, `ki` (per second), `kd` (seconds); output clamped by `outputLimits`.
The canonical actuation cascade on a motorized hinge: **PID output becomes
the motor's `targetVelocity`; `maxTorque` stays fixed as the effort bound.**

```ts
import { PIDController } from "fourJS/motion";
import { HingeJoint } from "fourJS/physics";
import { Quaternion } from "fourJS/math";

// A crank position controller: drive the crank to a commanded ANGLE by
// commanding a shaft SPEED. Radians and seconds, as everywhere (§7a).
const pid = new PIDController({
  kp: 8,
  ki: 2, // per second
  kd: 0.4, // seconds; acts on the measurement, so no setpoint kick
  outputLimits: [-6, 6], // commanded speed bound, rad/s
});

let targetAngle = Math.PI / 2;

/** Signed rotation about +Z — every 2D rotation has this form (§21). */
function angleAboutZ(q: Quaternion): number {
  return 2 * Math.atan2(q.z, q.w);
}

app.on("fixedUpdate", (time) => {
  const measured = angleAboutZ(crank.node.transform.rotation);
  const speed = pid.update(targetAngle, measured, time.fixedDeltaTime);
  // §28 live reconfiguration: queued, drained into the solver next step.
  shaftHinge.setMotor({ enabled: true, targetVelocity: speed, maxTorque: 400 });
});
```

Two solver facts to hold while tuning (both measured, recorded in MEMORY and
the API docs):

- On Rapier 0.20.0, `maxTorque` is a force-based **gain**, not a torque
  ceiling — if you modulate it, it becomes part of your loop gain. Hold it
  fixed and command velocity.
- A velocity written after `world.addBody` reaches no solver; author initial
  velocities on the descriptor.

`PIDController.reset()` clears integral and derivative state — call it when
the operator changes mode, or the wound-up integral answers the new setpoint.
For setpoint shaping, run the operator's raw command through a
`SpringDamper` (exact zero-order-hold step, stable at any stiffness) and feed
the smoothed value to the PID.

## Limit switches and interlocks

A real limit switch is application logic over sampled positions — exactly
what an encoder-fed switch is. Sample per frame, latch on the open→closed
edge, and count edges, not frames (`examples/mechanism` implements this in
~20 lines: `sampleSwitches`). Wire interlocks the same way: a latched switch
sets `hinge.enableMotor(false)`, and the mechanism **coasts** — on Rapier a
disabled motor is measured bit-identical to one that never existed, so
release really is release, not braking.

## Publishing the dashboard

The examples' pattern: mirror every number a human (or a test) needs onto
one status element as `data-*` attributes, once per frame — the engine's own
numbers, not pixel inference:

```ts
function syncDashboard(): void {
  const data = status.dataset;
  data["target"] = targetAngle.toFixed(3);
  data["angle"] = angleAboutZ(crank.node.transform.rotation).toFixed(3);
  data["spin"] = crank.body.angularVelocity.z.toFixed(3);
  data["motor"] = motorEnabled ? "on" : "off";
  data["leftHits"] = String(leftHits);
}
```

For waveform charts (§119 names them), keep a ring buffer of samples in the
`fixedUpdate` listener and draw it however you like — a DOM canvas beside the
scene, or quads in the scene itself. Honest state: no chart widget ships;
`@fourjs/ui` provides panels, labels, buttons, and layout (§73–§74), with
visuals supplied by your `WidgetSkin` (see `examples/ui-demo`), so a chart is
application code either way.

For deeper instrumentation, `four/diagnostics` ships `solverStatistics` /
`solverJointStatistics` (body/joint counts, sleep states, over duck-typed
debug access) and `DebugDrawBuffer` for contact/shape overlays — with the
honest caveat that several §84 visualizations (center-of-mass display, joint
anchors, force vectors) are **staged**, enumerated in the exported
`DEBUG_DRAW_STAGED` record with dated reasons.

## Honest state

- Everything above ships and is what `examples/mechanism` + the Phase 8
  integration suites exercise (the PID→`setMotor` hinge scenario is a tested
  reference).
- Not yet: §40's `UnitSystem` display record (convert at the edge — see
  [units](units-and-numerical-stability.md)), §28 joint reaction readouts on
  Rapier (no bindings), robotic joint-command conveniences (declined MAY,
  Phase 8), charts/gauges as widgets.

## Cross-references

- §28 (motors, limits), §119 (the demonstration this builds toward), §84
  (diagnostics), §73–§75 (UI).
- `examples/mechanism` — motor, switches, live retuning;
  `examples/ui-demo` — the widget/skin seam for control panels.
