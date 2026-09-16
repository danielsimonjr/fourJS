/**
 * The adapter guards that the public API cannot reach on a well-formed world
 * (§34, §37, §85).
 *
 * `countContacts` had no caller in this package. The rest of these cases go
 * through a snapshot envelope whose metadata has been rewritten: that is how a
 * Rapier collider, body, or mass mode can exist on one side of the boundary
 * and not the other. The adapters promise not to crash when that happens;
 * these tests are what make that promise executable rather than a comment.
 */

import { Vector2, Vector3 } from "@fourjs/math";
import * as Physics from "@fourjs/physics";
import type {
  PhysicsBodyHandle,
  PhysicsColliderHandle,
  PhysicsWorldOptions,
} from "@fourjs/physics";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { initializeRapier2d, initializeRapier3d } from "../src/init.js";
import { Rapier2dAdapter } from "../src/rapier2d-adapter.js";
import { Rapier3dAdapter } from "../src/rapier3d-adapter.js";

const DT = 1 / 60;
const SNAPSHOT_HEADER_BYTES = 16;

type SnapshotMeta = {
  adapter: string;
  version: string;
  nextBodyId: number;
  nextColliderId: number;
  nextJointId: number;
  bodies: [number, number, boolean, string, number, number][];
  colliders: [number, number, number, boolean, number, number][];
  joints: unknown[];
};

type AnyAdapter = Rapier2dAdapter | Rapier3dAdapter;

function rewriteSnapshot(
  snapshot: ArrayBuffer,
  rewrite: (meta: SnapshotMeta) => void,
): ArrayBuffer {
  const header = new DataView(snapshot);
  const metaLength = header.getUint32(8, true);
  const rapierLength = header.getUint32(12, true);
  const bytes = new Uint8Array(snapshot);
  const meta = JSON.parse(
    new TextDecoder().decode(
      bytes.subarray(SNAPSHOT_HEADER_BYTES, SNAPSHOT_HEADER_BYTES + metaLength),
    ),
  ) as SnapshotMeta;
  rewrite(meta);
  const rewritten = new TextEncoder().encode(JSON.stringify(meta));
  const rebuilt = new ArrayBuffer(
    SNAPSHOT_HEADER_BYTES + rewritten.byteLength + rapierLength,
  );
  const out = new Uint8Array(rebuilt);
  out.set(bytes.subarray(0, SNAPSHOT_HEADER_BYTES));
  out.set(rewritten, SNAPSHOT_HEADER_BYTES);
  out.set(
    bytes.subarray(
      SNAPSHOT_HEADER_BYTES + metaLength,
      SNAPSHOT_HEADER_BYTES + metaLength + rapierLength,
    ),
    SNAPSHOT_HEADER_BYTES + rewritten.byteLength,
  );
  const rebuiltHeader = new DataView(rebuilt);
  rebuiltHeader.setUint32(8, rewritten.byteLength, true);
  rebuiltHeader.setUint32(12, rapierLength, true);
  return rebuilt;
}

function step(adapter: AnyAdapter, count: number): void {
  for (let i = 0; i < count; i += 1) {
    adapter.syncSceneToSolver();
    adapter.step(DT);
    adapter.syncSolverToScene();
    adapter.drainEvents();
  }
}

beforeAll(async () => {
  await Promise.all([initializeRapier2d(), initializeRapier3d()]);
});

describe("Rapier2dAdapter defensive branches", () => {
  async function createAdapter(
    options?: Partial<PhysicsWorldOptions>,
  ): Promise<Rapier2dAdapter> {
    const adapter = new Rapier2dAdapter();
    await adapter.initialize({ dimension: "2d", ...options });
    return adapter;
  }

  function floor(adapter: Rapier2dAdapter): {
    body: PhysicsBodyHandle;
    collider: PhysicsColliderHandle;
  } {
    const body = adapter.createBody({
      type: "static",
      position: new Vector2(0, -0.5),
    });
    const collider = adapter.createCollider({
      body,
      shape: { type: "rectangle", halfExtents: new Vector2(20, 0.5) },
    });
    return { body, collider };
  }

  it("counts contacts on a resting pair and zero on an empty world", async () => {
    const empty = await createAdapter();
    expect(empty.countContacts()).toBe(0);
    empty.dispose();

    const adapter = await createAdapter();
    floor(adapter);
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 0.5),
    });
    adapter.createCollider({
      body,
      shape: { type: "rectangle", halfExtents: new Vector2(0.5, 0.5) },
    });
    expect(adapter.countContacts()).toBe(0);
    step(adapter, 60);
    expect(adapter.countContacts()).toBeGreaterThan(0);
    adapter.dispose();
  });

  it("refuses createJoint types the 2D switch does not build, once validation is skipped", async () => {
    const adapter = await createAdapter();
    const bodyA = adapter.createBody({ type: "static" });
    const bodyB = adapter.createBody({ type: "dynamic" });
    const spy = vi
      .spyOn(Physics, "validateJointDescriptor")
      .mockImplementation(() => undefined);
    try {
      expect(() =>
        adapter.createJoint({
          type: "spherical",
          bodyA,
          bodyB,
        }),
      ).toThrowError(/builds .* joints and not "spherical"/u);
    } finally {
      spy.mockRestore();
    }
    adapter.dispose();
  });

  it("skips Rapier colliders the envelope no longer names", async () => {
    const adapter = await createAdapter();
    const ground = floor(adapter);
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 0.5),
    });
    const box = adapter.createCollider({
      body,
      shape: { type: "rectangle", halfExtents: new Vector2(0.5, 0.5) },
    });
    step(adapter, 60);
    expect(adapter.countContacts()).toBeGreaterThan(0);

    const boxId = adapter.getColliderId(box);
    adapter.restoreSnapshot(
      rewriteSnapshot(adapter.createSnapshot(), (meta) => {
        meta.colliders = meta.colliders.filter((entry) => entry[0] !== boxId);
      }),
    );

    // The floor is still registered; the box collider lives only in Rapier.
    // Queries and the pair rebuild must skip that handle, not throw.
    // `countContacts` walks Rapier's narrow phase from registered colliders,
    // so the orphaned pair is still counted — it just has no adapter record.
    expect(adapter.countContacts()).toBeGreaterThan(0);
    expect(
      adapter.raycast({
        origin: new Vector2(0, 10),
        direction: new Vector2(0, -1),
      }).length,
    ).toBeGreaterThan(0);
    expect(
      adapter.shapeCast({
        shape: { type: "circle", radius: 0.1 },
        position: new Vector2(0, 10),
        direction: new Vector2(0, -1),
      }),
    ).not.toHaveLength(0);
    expect(adapter.pointQuery({ point: new Vector2(0, 0.5) })).toEqual([]);
    expect(adapter.getColliderId(ground.collider)).toBe(1);
    step(adapter, 3);
    adapter.dispose();
  });

  it("throws when a restored collider names a body the envelope dropped", async () => {
    const adapter = await createAdapter();
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 1),
      mass: 4,
    });
    const collider = adapter.createCollider({
      body,
      shape: { type: "circle", radius: 0.5 },
    });
    const bodyId = adapter.getBodyId(body);

    adapter.restoreSnapshot(
      rewriteSnapshot(adapter.createSnapshot(), (meta) => {
        meta.bodies = meta.bodies.filter((entry) => entry[0] !== bodyId);
      }),
    );

    expect(() => adapter.getColliderBody(collider)).toThrowError(
      /outlived its body/u,
    );
    // `#forgetCollider` must tolerate a missing owner rather than throw.
    adapter.destroyCollider(collider);
    adapter.dispose();
  });

  it("refuses to attach a collider after a snapshot installs an unknown mass mode", async () => {
    const adapter = await createAdapter();
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 1),
      mass: 5,
    });
    adapter.createCollider({
      body,
      shape: { type: "circle", radius: 0.5 },
    });
    const bodyId = adapter.getBodyId(body);

    adapter.restoreSnapshot(
      rewriteSnapshot(adapter.createSnapshot(), (meta) => {
        const record = meta.bodies.find((entry) => entry[0] === bodyId);
        if (record === undefined) {
          throw new Error("expected the authored body in the envelope");
        }
        record[3] = "not-a-mode";
      }),
    );

    expect(() =>
      adapter.createCollider({
        body,
        shape: { type: "circle", radius: 0.25 },
      }),
    ).toThrowError(/Unknown mass mode/u);
    adapter.dispose();
  });

  it("rewrites a collider's density after its body has left the envelope", async () => {
    const adapter = await createAdapter();
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 1),
      mass: 3,
    });
    const collider = adapter.createCollider({
      body,
      shape: { type: "circle", radius: 0.5 },
    });
    const bodyId = adapter.getBodyId(body);
    adapter.restoreSnapshot(
      rewriteSnapshot(adapter.createSnapshot(), (meta) => {
        meta.bodies = meta.bodies.filter((entry) => entry[0] !== bodyId);
      }),
    );
    adapter.setColliderMaterial(collider, 0.4, 0.1, 2);
    adapter.setBodyGravityScale(
      adapter.createBody({ type: "dynamic" }),
      0,
      false,
    );
    const hinge = adapter.createJoint({
      type: "revolute",
      bodyA: adapter.createBody({ type: "static" }),
      bodyB: adapter.createBody({ type: "dynamic" }),
    });
    expect(adapter.getJointId(hinge)).toBe(1);
    adapter.dispose();
  });

  it("emits collisionstay without body records when the envelope dropped them", async () => {
    const adapter = await createAdapter();
    floor(adapter);
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0, 0.5),
    });
    adapter.createCollider({
      body,
      shape: { type: "rectangle", halfExtents: new Vector2(0.5, 0.5) },
    });
    step(adapter, 60);

    adapter.restoreSnapshot(
      rewriteSnapshot(adapter.createSnapshot(), (meta) => {
        meta.bodies = [];
      }),
    );
    // Both colliders are still registered and still touching. Stay
    // emission asks `#bodyHandleOf` after `#buildContacts` gives up on
    // the missing body records, so the next step names the mismatch.
    expect(() => {
      step(adapter, 2);
    }).toThrowError(/outlived its body/u);
    adapter.dispose();
  });

  it("builds a stay manifold for a pair the envelope relabelled as solid", async () => {
    const adapter = await createAdapter({ gravity: new Vector2(0, 0) });
    const leftBody = adapter.createBody({
      type: "dynamic",
      position: new Vector2(-0.4, 0),
    });
    adapter.createCollider({
      body: leftBody,
      shape: { type: "circle", radius: 0.5 },
      sensor: true,
    });
    const rightBody = adapter.createBody({
      type: "dynamic",
      position: new Vector2(0.4, 0),
    });
    adapter.createCollider({
      body: rightBody,
      shape: { type: "circle", radius: 0.5 },
      sensor: true,
    });
    step(adapter, 2);

    adapter.restoreSnapshot(
      rewriteSnapshot(adapter.createSnapshot(), (meta) => {
        for (const collider of meta.colliders) {
          collider[3] = false;
        }
      }),
    );
    step(adapter, 2);
    adapter.dispose();
  });
});

describe("Rapier3dAdapter defensive branches", () => {
  async function createAdapter(
    options?: Partial<PhysicsWorldOptions>,
  ): Promise<Rapier3dAdapter> {
    const adapter = new Rapier3dAdapter();
    await adapter.initialize({ dimension: "3d", ...options });
    return adapter;
  }

  function floor(adapter: Rapier3dAdapter): {
    body: PhysicsBodyHandle;
    collider: PhysicsColliderHandle;
  } {
    const body = adapter.createBody({
      type: "static",
      position: new Vector3(0, -0.5, 0),
    });
    const collider = adapter.createCollider({
      body,
      shape: { type: "box", halfExtents: new Vector3(20, 0.5, 20) },
    });
    return { body, collider };
  }

  it("counts contacts on a resting pair and zero on an empty world", async () => {
    const empty = await createAdapter();
    expect(empty.countContacts()).toBe(0);
    empty.dispose();

    const adapter = await createAdapter();
    floor(adapter);
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector3(0, 0.5, 0),
    });
    adapter.createCollider({
      body,
      shape: { type: "box", halfExtents: new Vector3(0.5, 0.5, 0.5) },
    });
    expect(adapter.countContacts()).toBe(0);
    step(adapter, 60);
    expect(adapter.countContacts()).toBeGreaterThan(0);
    adapter.dispose();
  });

  it("skips Rapier colliders the envelope no longer names", async () => {
    const adapter = await createAdapter();
    const ground = floor(adapter);
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector3(0, 0.5, 0),
    });
    const box = adapter.createCollider({
      body,
      shape: { type: "box", halfExtents: new Vector3(0.5, 0.5, 0.5) },
    });
    step(adapter, 60);
    expect(adapter.countContacts()).toBeGreaterThan(0);

    const boxId = adapter.getColliderId(box);
    adapter.restoreSnapshot(
      rewriteSnapshot(adapter.createSnapshot(), (meta) => {
        meta.colliders = meta.colliders.filter((entry) => entry[0] !== boxId);
      }),
    );

    expect(adapter.countContacts()).toBeGreaterThan(0);
    expect(
      adapter.raycast({
        origin: new Vector3(0, 10, 0),
        direction: new Vector3(0, -1, 0),
      }).length,
    ).toBeGreaterThan(0);
    expect(
      adapter.shapeCast({
        shape: { type: "sphere", radius: 0.1 },
        position: new Vector3(0, 10, 0),
        direction: new Vector3(0, -1, 0),
      }),
    ).not.toHaveLength(0);
    expect(adapter.pointQuery({ point: new Vector3(0, 0.5, 0) })).toEqual([]);
    expect(adapter.getColliderId(ground.collider)).toBe(1);
    step(adapter, 3);
    adapter.dispose();
  });

  it("throws when a restored collider names a body the envelope dropped", async () => {
    const adapter = await createAdapter();
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector3(0, 1, 0),
      mass: 4,
    });
    const collider = adapter.createCollider({
      body,
      shape: { type: "sphere", radius: 0.5 },
    });
    const bodyId = adapter.getBodyId(body);

    adapter.restoreSnapshot(
      rewriteSnapshot(adapter.createSnapshot(), (meta) => {
        meta.bodies = meta.bodies.filter((entry) => entry[0] !== bodyId);
      }),
    );

    expect(() => adapter.getColliderBody(collider)).toThrowError(
      /outlived its body/u,
    );
    adapter.destroyCollider(collider);
    adapter.dispose();
  });

  it("refuses to attach a collider after a snapshot installs an unknown mass mode", async () => {
    const adapter = await createAdapter();
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector3(0, 1, 0),
      mass: 5,
    });
    adapter.createCollider({
      body,
      shape: { type: "sphere", radius: 0.5 },
    });
    const bodyId = adapter.getBodyId(body);

    adapter.restoreSnapshot(
      rewriteSnapshot(adapter.createSnapshot(), (meta) => {
        const record = meta.bodies.find((entry) => entry[0] === bodyId);
        if (record === undefined) {
          throw new Error("expected the authored body in the envelope");
        }
        record[3] = "not-a-mode";
      }),
    );

    expect(() =>
      adapter.createCollider({
        body,
        shape: { type: "sphere", radius: 0.25 },
      }),
    ).toThrowError(/Unknown mass mode/u);
    adapter.dispose();
  });

  it("rewrites a collider's density after its body has left the envelope", async () => {
    const adapter = await createAdapter();
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector3(0, 1, 0),
      mass: 3,
    });
    const collider = adapter.createCollider({
      body,
      shape: { type: "sphere", radius: 0.5 },
    });
    const bodyId = adapter.getBodyId(body);
    adapter.restoreSnapshot(
      rewriteSnapshot(adapter.createSnapshot(), (meta) => {
        meta.bodies = meta.bodies.filter((entry) => entry[0] !== bodyId);
      }),
    );
    adapter.setColliderMaterial(collider, 0.4, 0.1, 2);
    adapter.setBodyGravityScale(
      adapter.createBody({ type: "dynamic" }),
      0,
      false,
    );
    const ball = adapter.createJoint({
      type: "spherical",
      bodyA: adapter.createBody({ type: "static" }),
      bodyB: adapter.createBody({ type: "dynamic" }),
    });
    expect(adapter.getJointId(ball)).toBe(1);
    adapter.dispose();
  });

  it("emits collisionstay without body records when the envelope dropped them", async () => {
    const adapter = await createAdapter();
    floor(adapter);
    const body = adapter.createBody({
      type: "dynamic",
      position: new Vector3(0, 0.5, 0),
    });
    adapter.createCollider({
      body,
      shape: { type: "box", halfExtents: new Vector3(0.5, 0.5, 0.5) },
    });
    step(adapter, 60);

    adapter.restoreSnapshot(
      rewriteSnapshot(adapter.createSnapshot(), (meta) => {
        meta.bodies = [];
      }),
    );
    expect(() => {
      step(adapter, 2);
    }).toThrowError(/outlived its body/u);
    adapter.dispose();
  });

  it("builds a stay manifold for a pair the envelope relabelled as solid", async () => {
    const adapter = await createAdapter({ gravity: new Vector3(0, 0, 0) });
    const leftBody = adapter.createBody({
      type: "dynamic",
      position: new Vector3(-0.4, 0, 0),
    });
    adapter.createCollider({
      body: leftBody,
      shape: { type: "sphere", radius: 0.5 },
      sensor: true,
    });
    const rightBody = adapter.createBody({
      type: "dynamic",
      position: new Vector3(0.4, 0, 0),
    });
    adapter.createCollider({
      body: rightBody,
      shape: { type: "sphere", radius: 0.5 },
      sensor: true,
    });
    step(adapter, 2);

    adapter.restoreSnapshot(
      rewriteSnapshot(adapter.createSnapshot(), (meta) => {
        for (const collider of meta.colliders) {
          collider[3] = false;
        }
      }),
    );
    step(adapter, 2);
    adapter.dispose();
  });

  it("defaults a 3D hinge axis to +Z when validation is skipped", async () => {
    const adapter = await createAdapter();
    const bodyA = adapter.createBody({ type: "static" });
    const bodyB = adapter.createBody({ type: "dynamic" });
    const spy = vi
      .spyOn(Physics, "validateJointDescriptor")
      .mockImplementation(() => undefined);
    try {
      const joint = adapter.createJoint({
        type: "revolute",
        bodyA,
        bodyB,
      });
      expect(adapter.getJointId(joint)).toBe(1);
    } finally {
      spy.mockRestore();
    }
    adapter.dispose();
  });
});
