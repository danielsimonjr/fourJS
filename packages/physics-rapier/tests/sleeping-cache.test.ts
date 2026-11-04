/**
 * H3: `isBodySleeping` is served from a per-record cache refreshed by the
 * step's event collection and invalidated by every body mutator.
 */
import { Vector2, Vector3 } from "@fourjs/math";
import type { PhysicsBodyHandle } from "@fourjs/physics";
import { describe, expect, it } from "vitest";

import { Rapier2dAdapter } from "../src/rapier2d-adapter.js";
import { Rapier3dAdapter } from "../src/rapier3d-adapter.js";

interface Harness {
  adapter: Rapier2dAdapter | Rapier3dAdapter;
  body: PhysicsBodyHandle;
  /** Number of Wasm `isSleeping` calls observed so far. */
  calls: () => number;
  step: (n: number) => void;
}

async function build(dim: "2d" | "3d"): Promise<Harness> {
  const adapter = dim === "2d" ? new Rapier2dAdapter() : new Rapier3dAdapter();
  await adapter.initialize({ dimension: dim });
  const two = dim === "2d";
  const pos = (y: number): never =>
    (two ? new Vector2(0, y) : new Vector3(0, y, 0)) as never;
  const floor = adapter.createBody({ type: "static", position: pos(-0.5) });
  adapter.createCollider({
    body: floor,
    shape: (two
      ? { type: "rectangle", halfExtents: new Vector2(20, 0.5) }
      : { type: "box", halfExtents: new Vector3(20, 0.5, 20) }) as never,
  });
  const body = adapter.createBody({ type: "dynamic", position: pos(0.5) });
  adapter.createCollider({
    body,
    shape: (two
      ? { type: "rectangle", halfExtents: new Vector2(0.5, 0.5) }
      : { type: "box", halfExtents: new Vector3(0.5, 0.5, 0.5) }) as never,
  });
  let count = 0;
  for (const h of [body, floor]) {
    const rb = (h as unknown as { body: { isSleeping: () => boolean } }).body;
    const original = rb.isSleeping.bind(rb);
    rb.isSleeping = (): boolean => {
      count += 1;
      return original();
    };
  }
  const step = (n: number): void => {
    for (let i = 0; i < n; i += 1) {
      adapter.syncSceneToSolver();
      adapter.step(1 / 60);
      adapter.syncSolverToScene();
      adapter.drainEvents();
    }
  };
  return { adapter, body, calls: () => count, step };
}

describe.each(["2d", "3d"] as const)("isBodySleeping cache (%s)", (dim) => {
  it("adds no Wasm read after a step and reads through once when invalid", async () => {
    const h = await build(dim);
    h.step(300);
    const before = h.calls();
    for (let i = 0; i < 5; i += 1) {
      expect(h.adapter.isBodySleeping(h.body)).toBe(true);
    }
    expect(h.calls()).toBe(before);
    h.adapter.applyImpulse(h.body, new Vector3(0, 0, 0));
    expect(h.adapter.isBodySleeping(h.body)).toBe(
      h.adapter.isBodySleeping(h.body),
    );
    expect(h.calls()).toBe(before + 1);
    h.adapter.dispose();
  });

  it("wakeBody and sleepBody are visible without a step", async () => {
    const h = await build(dim);
    h.step(300);
    expect(h.adapter.isBodySleeping(h.body)).toBe(true);
    h.adapter.wakeBody(h.body);
    expect(h.adapter.isBodySleeping(h.body)).toBe(false);
    h.adapter.sleepBody(h.body);
    expect(h.adapter.isBodySleeping(h.body)).toBe(true);
    h.adapter.dispose();
  });

  it("every mutator invalidates the cache", async () => {
    const h = await build(dim);
    const a = h.adapter;
    const v = new Vector3(0, 1, 0);
    const mutators: Array<() => void> = [
      () => a.setBodyTransform(h.body, v, undefined as never),
      () => a.setBodyVelocities(h.body, v, v),
      () => a.applyForce(h.body, v),
      () => a.applyForceAtPoint(h.body, v, v),
      () => a.applyTorque(h.body, v),
      () => a.applyImpulse(h.body, v),
      () => a.applyImpulseAtPoint(h.body, v, v),
      () => a.applyAngularImpulse(h.body, v),
      () => a.resetForces(h.body),
      () => a.setBodyType(h.body, "kinematic-position"),
      () => a.setBodyDamping(h.body, 0.1, 0.1),
      () => a.setBodyGravityScale(h.body, 1, true),
    ];
    for (const mutate of mutators) {
      h.step(300);
      a.isBodySleeping(h.body);
      const before = h.calls();
      try {
        mutate();
      } catch {
        // argument shape differences are irrelevant; invalidation precedes the call
      }
      a.isBodySleeping(h.body);
      expect(h.calls()).toBe(before + 1);
    }
    a.dispose();
  });
});
