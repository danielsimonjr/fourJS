/**
 * Per-solver determinism (RFC 0010 decisions 7-8, wave 9): the same pile
 * scene runs on every solver adapter (`rapier`, `physjs`), twice in one
 * process, and must give byte-identical per-step digests and event streams;
 * a mid-run snapshot restore must re-derive the continuation exactly.
 *
 * No committed golden is compared: digests are solver-specific numbers, and
 * the Rapier goldens (`golden/phase5.json`) stay owned by `phase5-physics`.
 * Cross-process agreement for PhysJS is therefore NOT claimed here; the tier
 * is `same-runtime` (the adapter's declared determinism), proven in-process.
 */

import { Vector3 } from "@fourjs/math";
import { describe, expect, it } from "vitest";

import {
  DT,
  SOLVER_KITS,
  addBall,
  addGround,
  createRig,
  createWorld,
} from "../integration/helpers/physics-scenarios.js";

for (const kit of SOLVER_KITS) {
  describe(`determinism: ${kit.adapterName}`, () => {
    const run = async (): Promise<{ digests: number[]; events: string[] }> => {
      const rig = await createRig();
      try {
        const world = await createWorld(rig, kit);
        addGround(world, kit);
        const events: string[] = [];
        for (let i = 0; i < 5; i += 1) {
          const ball = addBall(world, kit, "dynamic", 0.4, {
            position: new Vector3(i * 0.3 - 0.6, 1 + i * 1.2, 0),
            restitution: 0.3,
          });
          ball.body.on("collisionstart", () => events.push(`s${i}`));
          ball.body.on("collisionend", () => events.push(`e${i}`));
        }
        const digests: number[] = [];
        for (let s = 0; s < 240; s += 1) {
          rig.app.step(DT);
          digests.push(world.checksum());
        }
        return { digests, events };
      } finally {
        rig.dispose();
      }
    };

    it("repeats digests and events exactly across two in-process runs", async () => {
      const a = await run();
      const b = await run();
      expect(b.digests).toEqual(a.digests);
      expect(b.events).toEqual(a.events);
      expect(new Set(a.digests).size).toBeGreaterThan(100);
      expect(a.events.length).toBeGreaterThan(4);
    });

    it("re-derives a continuation exactly after a snapshot restore", async () => {
      const rig = await createRig();
      try {
        const world = await createWorld(rig, kit);
        addGround(world, kit);
        for (let i = 0; i < 4; i += 1) {
          addBall(world, kit, "dynamic", 0.4, {
            position: new Vector3(i * 0.2, 1 + i, 0),
          });
        }
        for (let s = 0; s < 40; s += 1) rig.app.step(DT);
        const snapshot = world.createSnapshot();
        const tail = (): number[] => {
          const d: number[] = [];
          for (let s = 0; s < 80; s += 1) {
            rig.app.step(DT);
            d.push(world.checksum());
          }
          return d;
        };
        const first = tail();
        world.restoreSnapshot(snapshot);
        expect(tail()).toEqual(first);
      } finally {
        rig.dispose();
      }
    });
  });
}
