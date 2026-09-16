import { ComponentRegistry } from "@fourjs/core";
import { Vector3 } from "@fourjs/math";
import { describe, expect, it } from "vitest";

import { Group, NODE_SPACE_SERIALIZER, NodeSpace } from "../src/index.js";

describe("NodeSpace (§8, PH-12)", () => {
  it("defaults to world with +Z plane normal", () => {
    const space = new NodeSpace();
    expect(space.space).toBe("world");
    expect(space.planeNormal.x).toBe(0);
    expect(space.planeNormal.y).toBe(0);
    expect(space.planeNormal.z).toBe(1);
    expect(space.host).toBeNull();
    expect(NodeSpace.typeName).toBe("NodeSpace");
  });

  it("attaches and detaches through the host registry (one per type)", () => {
    const node = new Group();
    const first = node.addComponent(new NodeSpace({ space: "screen" }));
    expect(node.getComponent(NodeSpace)).toBe(first);
    expect(first.host).toBe(node);

    const second = node.addComponent(new NodeSpace({ space: "viewport" }));
    expect(node.getComponent(NodeSpace)).toBe(second);
    expect(first.host).toBeNull();

    expect(node.removeComponent(second)).toBe(true);
    expect(node.getComponent(NodeSpace)).toBeUndefined();
  });

  it("refuses an unknown mode", () => {
    const space = new NodeSpace();
    expect(() => {
      space.space = "not-a-mode" as NodeSpace["space"];
    }).toThrow(/must be one of/);
  });

  it("copies the authored plane normal", () => {
    const authored = new Vector3(0, 1, 0);
    const space = new NodeSpace({
      space: "local-plane",
      planeNormal: authored,
    });
    authored.set(9, 9, 9);
    expect(space.planeNormal.y).toBe(1);
    expect(space.planeNormal.x).toBe(0);
  });

  it("round-trips through NODE_SPACE_SERIALIZER and omits defaults", () => {
    expect(NODE_SPACE_SERIALIZER.serialize(new NodeSpace())).toEqual({});

    const authored = new NodeSpace({
      space: "billboard",
      planeNormal: new Vector3(0, 1, 0),
    });
    const payload = NODE_SPACE_SERIALIZER.serialize(authored);
    expect(payload).toEqual({ space: "billboard", planeNormal: [0, 1, 0] });

    const restored = NODE_SPACE_SERIALIZER.deserialize(payload);
    expect(restored.space).toBe("billboard");
    expect(restored.planeNormal.y).toBe(1);
  });

  it("deserializes a malformed payload as the world default", () => {
    const restored = NODE_SPACE_SERIALIZER.deserialize(null);
    expect(restored.space).toBe("world");
    expect(restored.planeNormal.z).toBe(1);
  });

  it("is keyed in a ComponentRegistry by typeName", () => {
    const registry = new ComponentRegistry();
    const space = new NodeSpace({ space: "camera" });
    registry.add(space);
    expect(registry.get(NodeSpace)?.space).toBe("camera");
  });
});
