import { Vector2 } from "@fourjs/math";
import { describe, expect, it } from "vitest";

import { Box2dAdapter } from "../src/index.js";

describe("contact pair end/begin within one step", () => {
  it("a bouncing pile steps 300 frames without losing pair bookkeeping", () => {
    const a = new Box2dAdapter();
    a.initialize({ dimension: "2d", gravity: new Vector2(0, -9.81) });
    const floor = a.createBody({
      type: "static",
      position: new Vector2(0, -0.5),
    });
    a.createCollider({
      body: floor,
      shape: { type: "rectangle", halfExtents: new Vector2(50, 0.5) },
      density: 1,
      friction: 0.6,
      restitution: 0,
      sensor: false,
    });
    for (let i = 0; i < 12; i += 1) {
      const b = a.createBody({
        type: "dynamic",
        position: new Vector2(-1 + (i % 4) * 0.55, 2 + i * 0.6),
      });
      a.createCollider({
        body: b,
        shape: { type: "circle", radius: 0.25 + 0.02 * (i % 3) },
        density: 1,
        friction: 0.4,
        restitution: 0.2,
        sensor: false,
      });
    }
    let started = 0;
    let ended = 0;
    for (let i = 0; i < 300; i += 1) {
      a.step(1 / 60);
      for (const e of a.drainEvents()) {
        if (e.type === "collisionstart") started += 1;
        if (e.type === "collisionend") ended += 1;
      }
    }
    expect(started).toBeGreaterThan(0);
    expect(started).toBeGreaterThanOrEqual(ended);
  });
});
