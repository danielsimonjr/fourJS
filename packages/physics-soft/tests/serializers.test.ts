import { FourError, type JsonValue } from "@fourjs/core";
import { describe, expect, it } from "vitest";

import {
  SOFT_BODY_SERIALIZER,
  SoftBody,
  type SoftBodyDescriptor,
} from "../src/index.js";

const tetra: SoftBodyDescriptor = {
  kind: "pressure",
  positions: new Float32Array([1, 1, 1, -1, -1, 1, -1, 1, -1, 1, -1, -1]),
  indices: new Uint32Array([0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2]),
  pressure: 1.5,
  pressureStiffness: 0.5,
  mass: 2,
};
const descriptors: SoftBodyDescriptor[] = [
  { kind: "rope", segments: 5, length: 2, pinned: [0, 4], damping: 0.3 },
  { kind: "rope", segments: 3, length: 1 },
  { kind: "cloth", columns: 3, rows: 2, width: 1, height: 1, pinned: [0, 2] },
  { kind: "cloth", columns: 2, rows: 2, width: 1, height: 1, substeps: 2 },
  tetra,
];

function viaJson(v: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(v)) as JsonValue;
}

describe("SOFT_BODY_SERIALIZER", () => {
  for (const d of descriptors) {
    it(`round-trips a ${d.kind} descriptor through JSON text`, () => {
      const body = new SoftBody(d);
      const json = viaJson(SOFT_BODY_SERIALIZER.serialize(body));
      const back = SOFT_BODY_SERIALIZER.deserialize(json, null);
      expect(back).toBeInstanceOf(SoftBody);
      expect(viaJson(SOFT_BODY_SERIALIZER.serialize(back))).toEqual(json);
      expect(back.particleCount).toBe(body.particleCount);
      if (d.kind === "pressure" && back.descriptor.kind === "pressure") {
        expect(Array.from(back.descriptor.positions)).toEqual(
          Array.from(d.positions),
        );
        expect(back.descriptor.pressure).toBe(1.5);
      }
    });
  }

  it("writes plain arrays, not typed arrays, for pressure meshes", () => {
    const json = SOFT_BODY_SERIALIZER.serialize(new SoftBody(tetra)) as {
      positions: unknown;
    };
    expect(Array.isArray(json.positions)).toBe(true);
  });

  const bad: [string, JsonValue][] = [
    ["a non-object", 3],
    ["an array", []],
    ["an unknown kind", { kind: "jelly" }],
    ["a missing rope field", { kind: "rope", segments: 4 }],
    ["a non-numeric field", { kind: "rope", segments: "4", length: 1 }],
    [
      "a non-numeric tuning field",
      { kind: "rope", segments: 4, length: 1, mass: "x" },
    ],
    ["a non-array pinned", { kind: "rope", segments: 4, length: 1, pinned: 0 }],
    [
      "a non-numeric pinned",
      { kind: "rope", segments: 4, length: 1, pinned: ["a"] },
    ],
    ["a pressure mesh without arrays", { kind: "pressure" }],
    ["an out-of-range value", { kind: "rope", segments: 1, length: 1 }],
    [
      "an out-of-range pin",
      { kind: "rope", segments: 4, length: 1, pinned: [9] },
    ],
    [
      "an out-of-range index",
      {
        kind: "pressure",
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        indices: [0, 1, 9],
      },
    ],
  ];
  for (const [label, payload] of bad) {
    it(`refuses ${label}`, () => {
      try {
        SOFT_BODY_SERIALIZER.deserialize(payload, null);
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(FourError);
        expect((e as FourError).code).toBe("UNTRUSTED_INPUT_REJECTED");
      }
    });
  }
});
